import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  buildTheoryRuntimeReceiptV1,
  isTheoryRuntimeReceiptV1,
  type TheoryRuntimeArtifactEvidenceV1,
  type TheoryRuntimeOutputManifestV1,
  type TheoryRuntimeReceiptV1,
} from "../../../shared/contracts/theory-runtime-receipt.v1";
import { THEORY_RUNTIME_WORKSTATION_GRAPH_ID } from "../../../shared/theory/runtime-execution-policy";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_NPM_SCRIPT,
  nhm2ExperimentReadyTheoryFormalInvocation,
} from "../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  type Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1,
} from "../../../tools/nhm2/run-experiment-ready-theory-formal";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_CANDIDATE_EVIDENCE_RELATIVE_PATH,
  isExactNhm2FormalOuterObservationEvidenceV2,
} from "../../../tools/nhm2/run-experiment-ready-theory-formal-candidate";
import type {
  TheoryRuntimeCommandV1,
  TheoryRuntimeExecutionResult,
  TheoryRuntimeSpawnExecutor,
} from "./runtime-adapters";
import { executeTheoryRuntimeCommand } from "./runtime-adapters";
import { buildNhm2FormalOuterObservationEvidence } from "./nhm2-formal-outer-observation-evidence-adapter";
import { NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME } from "./nhm2-formal-kernel-executor";
import {
  admitNhm2FormalRuntimePlan,
  resolveNhm2FormalRuntimeSourceState,
  type Nhm2FormalRuntimeLaunchInput,
  type Nhm2FormalRuntimePlanAdmissionV1,
  type Nhm2FormalRuntimePinnedFileV1,
  type Nhm2FormalRuntimeSourceStateV1,
} from "./nhm2-formal-runtime-plan-admission";
import {
  writeTheoryRuntimeReceiptArtifact,
  type TheoryRuntimePersistedReceiptRefV1,
} from "./theory-runtime-receipt-store";
import {
  buildTheoryRuntimeFreshnessProof,
  classifyTheoryRuntimeArtifacts,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
  writeTheoryRuntimePreSpawnSnapshotCommitment,
  type TheoryRuntimeArtifactSnapshot,
} from "./runtime-artifact-manifest";
import { verifyTheoryRuntimeReceiptFilesystem } from "./theory-runtime-receipt-filesystem-verifier";

export const NHM2_FORMAL_RUNTIME_ATTEMPT_ROOT =
  "artifacts/research/nhm2-formal-runtime-attempts" as const;
export const NHM2_FORMAL_RUNTIME_OUTPUT_PATHS = [
  "evidence/formal_manifest_certificate.json",
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  "replay-one/proof.olean",
  "replay-two/proof.olean",
] as const;
export const NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS = {
  maxFileCount: 4,
  maxDirectoryCount: 3,
  maxPathDepth: 2,
  maxFileBytes: 512 * 1024 * 1024,
  maxAggregateBytes: 1024 * 1024 * 1024,
  maxEvidenceBytes: 64 * 1024 * 1024,
  maxOuterArtifactBytes: 512 * 1024 * 1024,
  freshnessToleranceMs: 2_000,
} as const;

export type Nhm2FormalRuntimeAttemptClaimV1 = {
  artifactId: "nhm2.formal_runtime_attempt_claim";
  contractVersion: "nhm2_formal_runtime_attempt_claim/v1";
  createdAt: string;
  requestId: string;
  runId: string;
  receiptId: string;
  runtimeId: string;
  candidateManifestPath: string;
  candidateManifestSha256: string;
  approvedPolicyId: string;
  approvedPolicySemanticSha256: string;
  path: string;
  sha256: string;
  sizeBytes: number;
};

export type ExecuteNhm2FormalRuntimeResultV1 = {
  requestId: string;
  runtimeId: string;
  command: TheoryRuntimeCommandV1;
  execution: TheoryRuntimeExecutionResult;
  receiptV1: TheoryRuntimeReceiptV1;
  receiptArtifact: TheoryRuntimePersistedReceiptRefV1;
  attemptClaim: Nhm2FormalRuntimeAttemptClaimV1;
};

export type Nhm2FormalRuntimeExecutorDependenciesV1 = {
  projectRoot?: string;
  admit?: (
    input: Nhm2FormalRuntimeLaunchInput,
  ) => Promise<Nhm2FormalRuntimePlanAdmissionV1>;
  spawnExecutor?: TheoryRuntimeSpawnExecutor;
  resolveSourceState?: (
    workspaceRoot: string,
  ) => Promise<Nhm2FormalRuntimeSourceStateV1>;
  resolveWorktreeStatus?: (
    workspaceRoot: string,
  ) => Promise<Nhm2FormalRuntimeWorktreeStatusV1>;
  persistReceipt?: typeof writeTheoryRuntimeReceiptArtifact;
  now?: () => Date;
};

export type Nhm2FormalRuntimeWorktreeStatusV1 = {
  algorithm: "git_status_porcelain_v1_z_untracked_all_sha256/v1";
  rawSha256: string;
  records: string[];
  clean: boolean;
};

type Nhm2FormalRuntimeWorktreeEvidenceV1 = {
  baseline: Nhm2FormalRuntimeWorktreeStatusV1;
  preSpawn: Nhm2FormalRuntimeWorktreeStatusV1;
  finalized: Nhm2FormalRuntimeWorktreeStatusV1 | null;
  preSpawnAuthorizedUntrackedPaths: string[];
  finalizedAuthorizedUntrackedPaths: string[];
};

export class Nhm2FormalRuntimeExecutorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Nhm2FormalRuntimeExecutorError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;
type ObservedOutput = {
  relativePath: string;
  repoPath: string;
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
  mtimeMs: number;
  freshness: "new" | "preexisting";
};

const SHA256 = /^[a-f0-9]{64}$/;
const WORKTREE_STATUS_ALGORITHM =
  "git_status_porcelain_v1_z_untracked_all_sha256/v1" as const;

const fail = (code: string, message: string): never => {
  throw new Nhm2FormalRuntimeExecutorError(code, message);
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const isRecord = (value: unknown): value is JsonRecord =>
  value != null && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: JsonRecord, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    actual.length === sorted.length &&
    actual.every((entry, index) => entry === sorted[index])
  );
};

const canonicalTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;

const inside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const portable = (root: string, absolutePath: string): string =>
  path.relative(root, absolutePath).split(path.sep).join("/");

const unique = (values: readonly string[]): string[] =>
  Array.from(new Set(values.filter((entry) => entry.length > 0)));

const normalizeRepoPath = (value: string): string =>
  value.replace(/\\/g, "/").replace(/^\.\//, "");

async function gitPorcelainBytes(workspaceRoot: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {
        cwd: workspaceRoot,
        encoding: null,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error != null) {
          reject(error);
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

export async function resolveNhm2FormalRuntimeWorktreeStatus(
  workspaceRoot: string,
): Promise<Nhm2FormalRuntimeWorktreeStatusV1> {
  const raw = await gitPorcelainBytes(workspaceRoot);
  if (raw.byteLength > 0 && raw[raw.byteLength - 1] !== 0) {
    fail(
      "worktree_status_invalid",
      "Git porcelain status did not end with its required NUL delimiter.",
    );
  }
  const recordBuffers =
    raw.byteLength === 0
      ? []
      : raw
          .subarray(0, raw.byteLength - 1)
          .toString("binary")
          .split("\0");
  const records = recordBuffers.map((record) =>
    Buffer.from(record, "binary").toString("utf8"),
  );
  for (let index = 0; index < recordBuffers.length; index += 1) {
    const original = Buffer.from(recordBuffers[index], "binary");
    if (!Buffer.from(records[index], "utf8").equals(original)) {
      fail(
        "worktree_status_path_encoding_invalid",
        "Git porcelain status contains a path that is not canonical UTF-8.",
      );
    }
  }
  return {
    algorithm: WORKTREE_STATUS_ALGORITHM,
    rawSha256: sha256(raw),
    records,
    clean: raw.byteLength === 0,
  };
}

function validateWorktreeStatus(
  status: Nhm2FormalRuntimeWorktreeStatusV1,
  phase: string,
): void {
  const reconstructed = Buffer.concat(
    status.records.map((record) => Buffer.from(`${record}\0`, "utf8")),
  );
  if (
    status.algorithm !== WORKTREE_STATUS_ALGORITHM ||
    !SHA256.test(status.rawSha256) ||
    !Array.isArray(status.records) ||
    status.records.some(
      (record) =>
        typeof record !== "string" ||
        record.length === 0 ||
        record.includes("\0"),
    ) ||
    status.clean !== (status.records.length === 0) ||
    status.rawSha256 !== sha256(reconstructed)
  ) {
    fail(
      "worktree_status_invalid",
      `${phase} Git porcelain status evidence is malformed.`,
    );
  }
}

function assertAuthorizedWorktreeDelta(input: {
  status: Nhm2FormalRuntimeWorktreeStatusV1;
  phase: string;
  authorizedRepoPaths: readonly string[];
}): string[] {
  validateWorktreeStatus(input.status, input.phase);
  const authorized = new Set(input.authorizedRepoPaths.map(normalizeRepoPath));
  const observed: string[] = [];
  for (const record of input.status.records) {
    if (!record.startsWith("?? ")) {
      fail(
        "worktree_delta_unauthorized",
        `${input.phase} Git porcelain status contains a tracked, staged, renamed, or otherwise unauthorized delta.`,
      );
    }
    const rawRepoPath = record.slice(3);
    const repoPath = normalizeRepoPath(rawRepoPath);
    if (
      rawRepoPath.includes("\\") ||
      repoPath.length === 0 ||
      path.posix.isAbsolute(repoPath) ||
      repoPath.split("/").some((part) => part === "" || part === "..") ||
      !authorized.has(repoPath) ||
      observed.includes(repoPath)
    ) {
      fail(
        "worktree_delta_unauthorized",
        `${input.phase} Git porcelain status contains an unauthorized untracked path: ${repoPath || "<empty>"}.`,
      );
    }
    observed.push(repoPath);
  }
  return observed;
}

const exactLaunchInput = (
  value: unknown,
): value is Nhm2FormalRuntimeLaunchInput =>
  isRecord(value) &&
  exactKeys(value, ["candidateManifestPath"]) &&
  typeof value.candidateManifestPath === "string" &&
  value.candidateManifestPath.length > 0;

async function ensureSafeDirectoryChain(input: {
  workspaceRoot: string;
  relativeDirectory: string;
}): Promise<string> {
  const components = input.relativeDirectory.split("/");
  if (
    components.length === 0 ||
    components.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    fail("attempt_store_invalid", "Formal attempt store path is invalid.");
  }
  const realWorkspaceRoot = await fs.realpath(input.workspaceRoot);
  let current = input.workspaceRoot;
  for (const component of components) {
    current = path.join(current, component);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = await fs.lstat(current);
    const real = await fs.realpath(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !inside(realWorkspaceRoot, real)
    ) {
      fail(
        "attempt_store_invalid",
        "Formal attempt store has an unsafe directory ancestor.",
      );
    }
  }
  return current;
}

async function createAttemptClaim(input: {
  workspaceRoot: string;
  admission: Nhm2FormalRuntimePlanAdmissionV1;
  now: () => Date;
}): Promise<Nhm2FormalRuntimeAttemptClaimV1> {
  const directory = await ensureSafeDirectoryChain({
    workspaceRoot: input.workspaceRoot,
    relativeDirectory: NHM2_FORMAL_RUNTIME_ATTEMPT_ROOT,
  });
  const token = sha256(
    `${input.admission.plan.runtimeId}\0${input.admission.plan.requestId}`,
  );
  const absolutePath = path.join(directory, `attempt-${token}.v1.json`);
  const createdAt = input.now().toISOString();
  const semantic = {
    artifactId: "nhm2.formal_runtime_attempt_claim" as const,
    contractVersion: "nhm2_formal_runtime_attempt_claim/v1" as const,
    createdAt,
    requestId: input.admission.plan.requestId,
    runId: input.admission.plan.runId,
    receiptId: input.admission.plan.receiptId,
    runtimeId: input.admission.plan.runtimeId,
    candidateManifestPath: input.admission.manifestPath,
    candidateManifestSha256: input.admission.manifestRawSha256,
    approvedPolicyId: input.admission.approvedToolchain.policyId,
    approvedPolicySemanticSha256:
      input.admission.approvedToolchain.policySemanticSha256,
  };
  const bytes = Buffer.from(`${JSON.stringify(semantic, null, 2)}\n`, "utf8");
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(absolutePath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
  } catch (error) {
    if (handle != null) await handle.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail(
        "request_already_launched",
        `Formal request ${input.admission.plan.requestId} is single-use and already has an immutable attempt claim.`,
      );
    }
    throw error;
  }
  const observed = await fs.readFile(absolutePath);
  if (!observed.equals(bytes)) {
    fail("attempt_claim_changed", "Formal attempt claim changed after write.");
  }
  return {
    ...semantic,
    path: portable(input.workspaceRoot, absolutePath),
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
}

async function assertMissingOutputRoot(
  workspaceRoot: string,
  outputDirectory: string,
): Promise<void> {
  const absolutePath = path.resolve(workspaceRoot, outputDirectory);
  if (!inside(workspaceRoot, absolutePath)) {
    fail("output_escape", "Formal output directory escaped the workspace.");
  }
  try {
    await fs.lstat(absolutePath);
    fail(
      "output_preexists",
      "Formal output directory must remain absent until the producer starts.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function allAdmissionPins(
  admission: Nhm2FormalRuntimePlanAdmissionV1,
): Nhm2FormalRuntimePinnedFileV1[] {
  const pins: Nhm2FormalRuntimePinnedFileV1[] = [
    ...admission.pinnedInputs,
    {
      label: "standalone formal producer bundle",
      path: admission.formalProducerBundle.bundle.path,
      absolutePath: admission.formalProducerBundle.bundle.absolutePath,
      sha256: admission.formalProducerBundle.bundle.sha256,
      sizeBytes: admission.formalProducerBundle.bundle.sizeBytes,
    },
    {
      label: "formal producer build metadata",
      path: admission.formalProducerBundle.buildMetadata.path,
      absolutePath: path.resolve(
        admission.workspaceRoot,
        admission.formalProducerBundle.buildMetadata.path,
      ),
      sha256: admission.formalProducerBundle.buildMetadata.sha256,
      sizeBytes: admission.formalProducerBundle.buildMetadata.sizeBytes,
    },
    ...admission.formalProducerBundle.sourceFiles.map((entry) => ({
      label: `formal producer source ${entry.path}`,
      path: entry.path,
      absolutePath: entry.absolutePath,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
    })),
  ];
  for (const ledger of Object.values(
    admission.preseal.runSpec.executor.ledgers,
  )) {
    for (const entry of ledger.entries) {
      pins.push({
        label: `sealed ${ledger.kind} ${entry.relativePath}`,
        path: portable(
          admission.workspaceRoot,
          path.resolve(ledger.rootPath, ...entry.relativePath.split("/")),
        ),
        absolutePath: path.resolve(
          ledger.rootPath,
          ...entry.relativePath.split("/"),
        ),
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      });
    }
  }
  const byAbsolutePath = new Map<string, Nhm2FormalRuntimePinnedFileV1>();
  for (const pin of pins) {
    const key =
      process.platform === "win32"
        ? path.resolve(pin.absolutePath).toLowerCase()
        : path.resolve(pin.absolutePath);
    const existing = byAbsolutePath.get(key);
    if (
      existing != null &&
      (existing.sha256 !== pin.sha256 || existing.sizeBytes !== pin.sizeBytes)
    ) {
      fail("input_binding_conflict", `${pin.label} has conflicting bindings.`);
    }
    byAbsolutePath.set(key, pin);
  }
  return [...byAbsolutePath.values()];
}

async function assertPinsCurrent(
  pins: readonly Nhm2FormalRuntimePinnedFileV1[],
  phase: "pre_spawn" | "post_spawn",
): Promise<void> {
  for (const pin of pins) {
    const stat = await fs.lstat(pin.absolutePath);
    const real = await fs.realpath(pin.absolutePath);
    const bytes = await fs.readFile(pin.absolutePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      path.resolve(real) !== path.resolve(pin.absolutePath) ||
      stat.size !== pin.sizeBytes ||
      bytes.byteLength !== pin.sizeBytes ||
      sha256(bytes) !== pin.sha256
    ) {
      fail(
        "input_binding_changed",
        `${phase} immutable binding changed: ${pin.label}.`,
      );
    }
  }
}

async function launcherBindings(input: {
  admission: Nhm2FormalRuntimePlanAdmissionV1;
}): Promise<NonNullable<TheoryRuntimeCommandV1["launcherBindings"]>> {
  const host = input.admission.formalProducerBundle.hostNodeRuntime;
  const bundle = input.admission.formalProducerBundle.bundle;
  const result: NonNullable<TheoryRuntimeCommandV1["launcherBindings"]> = [
    {
      role: "node_runtime",
      path: host.executablePath,
      sha256: host.sha256,
      sizeBytes: host.sizeBytes,
    },
    {
      role: "standalone_bundle",
      path: bundle.absolutePath,
      sha256: bundle.sha256,
      sizeBytes: bundle.sizeBytes,
    },
  ];
  for (const binding of result) {
    const stat = await fs.lstat(binding.path);
    const real = await fs.realpath(binding.path);
    const bytes = await fs.readFile(binding.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      path.resolve(real) !== path.resolve(binding.path) ||
      binding.sizeBytes == null ||
      stat.size !== binding.sizeBytes ||
      bytes.byteLength !== binding.sizeBytes ||
      sha256(bytes) !== binding.sha256
    ) {
      fail("launcher_binding_changed", `${binding.role} binding changed.`);
    }
  }
  return result;
}

async function assertLauncherBindingsCurrent(
  command: TheoryRuntimeCommandV1,
  phase: "pre_spawn" | "post_spawn",
): Promise<void> {
  const bindings = command.launcherBindings ?? [];
  if (
    bindings.length !== 2 ||
    bindings[0].role !== "node_runtime" ||
    bindings[1].role !== "standalone_bundle"
  ) {
    fail("launcher_binding_invalid", `${phase} launcher inventory is invalid.`);
  }
  for (const binding of bindings) {
    const stat = await fs.lstat(binding.path);
    const real = await fs.realpath(binding.path);
    const bytes = await fs.readFile(binding.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      path.resolve(real) !== path.resolve(binding.path) ||
      binding.sizeBytes == null ||
      stat.size !== binding.sizeBytes ||
      bytes.byteLength !== binding.sizeBytes ||
      sha256(bytes) !== binding.sha256
    ) {
      fail(
        "launcher_binding_changed",
        `${phase} ${binding.role} launcher binding changed.`,
      );
    }
  }
}

async function buildCommand(
  admission: Nhm2FormalRuntimePlanAdmissionV1,
): Promise<TheoryRuntimeCommandV1> {
  const invocation = nhm2ExperimentReadyTheoryFormalInvocation({
    candidateManifestPath: admission.manifestPath,
    outputDirectory: admission.outputDirectory,
    runId: admission.plan.runId,
  });
  if (
    invocation.formalRunSpecPath !== admission.formalRunSpecPath ||
    !isDeepStrictEqual(admission.plan.expectedInvocation.args, invocation.args)
  ) {
    fail("logical_invocation_changed", "Admitted formal invocation changed.");
  }
  const timeoutMs = admission.preseal.runSpec.executor.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 3_600_000
  ) {
    fail(
      "timeout_invalid",
      "Presealed formal timeout is outside server bounds.",
    );
  }
  return {
    command: admission.formalProducerBundle.hostNodeRuntime.executablePath,
    args: [
      admission.formalProducerBundle.bundle.absolutePath,
      ...invocation.cliArgs,
    ],
    cwd: admission.workspaceRoot,
    npmScript: NHM2_EXPERIMENT_READY_THEORY_FORMAL_NPM_SCRIPT,
    timeoutMs,
    env: { ...admission.logicalEnvironment },
    inheritProcessEnv: false,
    launcherBindings: await launcherBindings({ admission }),
  };
}

async function observeOutput(input: {
  workspaceRoot: string;
  outputDirectory: string;
  startedAt: string | null;
  completedAt: string | null;
}): Promise<{ files: ObservedOutput[]; directories: string[] }> {
  const root = path.resolve(input.workspaceRoot, input.outputDirectory);
  let rootStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { files: [], directories: [] };
    }
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail(
      "output_root_invalid",
      "Formal output root is not a regular directory.",
    );
  }
  const realWorkspaceRoot = await fs.realpath(input.workspaceRoot);
  const realRoot = await fs.realpath(root);
  if (!inside(realWorkspaceRoot, realRoot)) {
    fail("output_escape", "Formal output root escaped the workspace.");
  }
  const files: ObservedOutput[] = [];
  const directories: string[] = [];
  let aggregateBytes = 0;
  const startedMs = canonicalTimestamp(input.startedAt)
    ? Date.parse(input.startedAt)
    : Number.NaN;
  const completedMs = canonicalTimestamp(input.completedAt)
    ? Date.parse(input.completedAt)
    : Number.NaN;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxPathDepth) {
      fail("output_path_depth_exceeded", "Formal output path depth exceeded.");
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = portable(root, absolutePath);
      if (entry.isSymbolicLink()) {
        fail(
          "output_symlink_forbidden",
          `Formal output is a symlink: ${relativePath}.`,
        );
      }
      if (entry.isDirectory()) {
        directories.push(relativePath);
        if (
          directories.length >
          NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxDirectoryCount
        ) {
          fail(
            "output_directory_count_exceeded",
            "Formal output has extra directories.",
          );
        }
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        fail(
          "output_not_regular",
          `Formal output is not regular: ${relativePath}.`,
        );
      }
      if (files.length >= NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxFileCount) {
        fail("output_file_count_exceeded", "Formal output has extra files.");
      }
      const stat = await fs.lstat(absolutePath);
      const real = await fs.realpath(absolutePath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        !inside(realRoot, real) ||
        stat.size <= 0 ||
        stat.size > NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxFileBytes
      ) {
        fail("output_not_regular", `Formal output is unsafe: ${relativePath}.`);
      }
      aggregateBytes += stat.size;
      if (
        aggregateBytes > NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxAggregateBytes
      ) {
        fail(
          "output_aggregate_exceeded",
          "Formal output exceeds its byte budget.",
        );
      }
      const bytes = await fs.readFile(absolutePath);
      const after = await fs.lstat(absolutePath);
      if (
        bytes.byteLength !== stat.size ||
        stat.size !== after.size ||
        stat.mtimeMs !== after.mtimeMs ||
        stat.ctimeMs !== after.ctimeMs
      ) {
        fail(
          "output_changed",
          `Formal output changed while hashing: ${relativePath}.`,
        );
      }
      const fresh =
        Number.isFinite(startedMs) &&
        Number.isFinite(completedMs) &&
        stat.mtimeMs >=
          startedMs - NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.freshnessToleranceMs &&
        stat.mtimeMs <=
          completedMs + NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.freshnessToleranceMs;
      files.push({
        relativePath,
        repoPath: portable(input.workspaceRoot, absolutePath),
        absolutePath,
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
        freshness: fresh ? "new" : "preexisting",
      });
    }
  };
  await visit(root, 0);
  return {
    files: files.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
    directories: directories.sort(),
  };
}

async function readCompactJson(
  output: ObservedOutput,
  maxBytes: number,
): Promise<unknown> {
  if (output.sizeBytes > maxBytes) {
    fail(
      "output_json_too_large",
      `${output.relativePath} exceeds its JSON limit.`,
    );
  }
  const bytes = await fs.readFile(output.absolutePath);
  if (
    bytes.byteLength !== output.sizeBytes ||
    sha256(bytes) !== output.sha256
  ) {
    fail("output_changed", `${output.relativePath} changed before validation.`);
  }
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return fail(
      "output_json_invalid",
      `${output.relativePath} is invalid JSON.`,
    );
  }
  if (text !== JSON.stringify(value)) {
    fail(
      "output_json_not_canonical",
      `${output.relativePath} is not compact canonical JSON.`,
    );
  }
  return value;
}

const outerInventorySha256 = (
  entries: readonly { path: string; sha256: string; sizeBytes: number }[],
): string =>
  sha256(
    `nhm2_formal_outer_inventory/v1\0${JSON.stringify(
      entries.map((entry) => [entry.path, entry.sha256, entry.sizeBytes]),
    )}`,
  );

async function validateExactOutputs(input: {
  admission: Nhm2FormalRuntimePlanAdmissionV1;
  observed: { files: ObservedOutput[]; directories: string[] };
}): Promise<void> {
  const expectedPaths = [...NHM2_FORMAL_RUNTIME_OUTPUT_PATHS].sort();
  const actualPaths = input.observed.files.map((entry) => entry.relativePath);
  if (
    !isDeepStrictEqual(actualPaths, expectedPaths) ||
    !isDeepStrictEqual(input.observed.directories, [
      "evidence",
      "replay-one",
      "replay-two",
    ]) ||
    input.observed.files.some((entry) => entry.freshness !== "new")
  ) {
    fail(
      "formal_output_inventory_invalid",
      "Formal runtime requires exactly four fresh outputs and no extra directory or file.",
    );
  }
  const byPath = new Map(
    input.observed.files.map((entry) => [entry.relativePath, entry]),
  );
  const outerOutput = byPath.get(
    NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  )!;
  const evidenceOutput = byPath.get(
    NHM2_EXPERIMENT_READY_THEORY_FORMAL_CANDIDATE_EVIDENCE_RELATIVE_PATH,
  )!;
  const replayEntries = [
    "replay-one/proof.olean",
    "replay-two/proof.olean",
  ].map((relativePath) => {
    const output = byPath.get(relativePath)!;
    return {
      path: relativePath,
      sha256: output.sha256,
      sizeBytes: output.sizeBytes,
    };
  });
  const outer = await readCompactJson(
    outerOutput,
    NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxOuterArtifactBytes,
  );
  const evidence = await readCompactJson(
    evidenceOutput,
    NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxEvidenceBytes,
  );
  const spec = input.admission.preseal.runSpec;
  if (
    !isRecord(outer) ||
    !exactKeys(outer, [
      "artifactId",
      "contractVersion",
      "generatedAt",
      "identity",
      "inputs",
      "planRole",
      "theoremName",
      "replayOutputInventory",
      "executionObservation",
      "claimBoundary",
    ]) ||
    outer.artifactId !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID ||
    outer.contractVersion !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION ||
    outer.planRole !== "formal_kernel" ||
    outer.theoremName !== NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME ||
    !isDeepStrictEqual(outer.identity, spec.identity) ||
    !isRecord(outer.inputs) ||
    !isRecord(outer.inputs.candidateManifest) ||
    !isRecord(outer.inputs.formalRunSpec) ||
    outer.inputs.candidateManifest.path !== input.admission.manifestPath ||
    outer.inputs.candidateManifest.sha256 !==
      input.admission.manifestRawSha256 ||
    outer.inputs.candidateManifest.sizeBytes !==
      input.admission.manifestSizeBytes ||
    outer.inputs.formalRunSpec.path !== input.admission.formalRunSpecPath ||
    outer.inputs.formalRunSpec.sha256 !==
      input.admission.preseal.formalRunSpecSha256 ||
    outer.inputs.formalRunSpec.sizeBytes !==
      input.admission.preseal.formalRunSpecSizeBytes ||
    !isRecord(outer.executionObservation) ||
    !isDeepStrictEqual(outer.claimBoundary, spec.claimBoundary) ||
    !isRecord(outer.replayOutputInventory) ||
    outer.replayOutputInventory.algorithm !==
      "sha256_canonical_tuple_list/v1" ||
    !isDeepStrictEqual(outer.replayOutputInventory.entries, replayEntries) ||
    outer.replayOutputInventory.inventorySha256 !==
      outerInventorySha256(replayEntries)
  ) {
    fail(
      "formal_outer_artifact_invalid",
      "Formal outer artifact is not exactly bound to the candidate, spec, and two replay outputs.",
    );
  }
  const executionArtifact =
    outer as unknown as Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1;
  const independentlyDerived = buildNhm2FormalOuterObservationEvidence({
    executionArtifact,
    executionObservation: executionArtifact.executionObservation,
    trustedContext: {
      candidate: {
        candidateId: input.admission.manifest.bindings.candidate.candidateId,
        candidateManifestId: input.admission.manifest.manifestId,
        candidateManifestPath: input.admission.manifestPath,
        candidateManifestSha256: input.admission.manifestRawSha256,
        candidateManifestSizeBytes: input.admission.manifestSizeBytes,
        candidateFrozenAt: input.admission.manifest.frozenAt,
        claimBoundary: input.admission.manifest.claimBoundary,
      },
      formalPlan: input.admission.plan,
      formalRunSpec: {
        path: input.admission.formalRunSpecPath,
        sha256: input.admission.preseal.formalRunSpecSha256,
        sizeBytes: input.admission.preseal.formalRunSpecSizeBytes,
        value: spec,
      },
    },
  });
  if (
    !isExactNhm2FormalOuterObservationEvidenceV2(evidence) ||
    !isDeepStrictEqual(evidence, independentlyDerived) ||
    evidence.status !== "pass" ||
    evidence.identity.candidateId !==
      input.admission.manifest.bindings.candidate.candidateId ||
    evidence.identity.candidateManifestId !==
      input.admission.manifest.manifestId ||
    evidence.identity.candidateManifestSha256 !==
      input.admission.manifestRawSha256 ||
    evidence.identity.requestId !== input.admission.plan.requestId ||
    evidence.identity.runId !== input.admission.plan.runId ||
    evidence.identity.receiptId !== input.admission.plan.receiptId ||
    evidence.identity.runtimeId !== input.admission.plan.runtimeId ||
    evidence.identity.sourceCommitSha !== input.admission.plan.sourceCommitSha
  ) {
    fail(
      "formal_evidence_not_ready",
      "Formal v2 evidence is malformed, failed, or not exactly run-bound.",
    );
  }
}

function buildReceipt(input: {
  admission: Nhm2FormalRuntimePlanAdmissionV1;
  command: TheoryRuntimeCommandV1;
  execution: TheoryRuntimeExecutionResult;
  attemptClaim: Nhm2FormalRuntimeAttemptClaimV1;
  observed: ObservedOutput[];
  artifactManifest: TheoryRuntimeOutputManifestV1 | null;
  finalizationErrors: string[];
  stableGitSha: string | null;
  worktreeEvidence: Nhm2FormalRuntimeWorktreeEvidenceV1;
}): TheoryRuntimeReceiptV1 {
  const processSucceeded =
    input.execution.exitCode === 0 &&
    !input.execution.timedOut &&
    input.execution.error == null;
  const completed =
    processSucceeded &&
    input.artifactManifest != null &&
    input.finalizationErrors.length === 0;
  const missingSignals = completed
    ? []
    : unique([
        ...(input.execution.timedOut ? ["formal_runtime_timeout"] : []),
        ...(input.execution.exitCode !== 0 ? ["formal_child_nonzero"] : []),
        ...(input.execution.error != null ? ["formal_runtime_error"] : []),
        ...input.finalizationErrors.map((_, index) =>
          index === 0
            ? "formal_runtime_finalization_not_ready"
            : `formal_runtime_finalization_not_ready_${index + 1}`,
        ),
      ]);
  const artifactEvidence: TheoryRuntimeArtifactEvidenceV1[] =
    input.observed.map((entry) => ({
      path: entry.repoPath,
      sha256: entry.sha256,
      freshness: entry.freshness,
      status: completed ? "pass" : "not_ready",
      gates: {
        run_bound_hash: completed ? "pass" : "not_ready",
        runtime_freshness: entry.freshness === "new" ? "pass" : "not_ready",
      },
    }));
  const policy = input.admission.approvedToolchain;
  const receipt = buildTheoryRuntimeReceiptV1({
    generatedAt: new Date().toISOString(),
    receiptId: input.admission.plan.receiptId,
    runtimeId: input.admission.plan.runtimeId,
    graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
    badgeIds: ["nhm2.formal.lean_certificate"],
    command: input.command.command,
    args: {
      adapter: "nhm2_formal_runtime_executor/v1",
      serverPolicyResolution: "server_resolved",
      approvedPolicyId: policy.policyId,
      approvedPolicySemanticSha256: policy.policySemanticSha256,
      approvedToolchainLedgerSha256: policy.toolchainLedger.aggregateSha256,
      approvedToolchainLedgerEntryCount: policy.toolchainLedger.entryCount,
      approvedToolchainLedgerAggregateBytes:
        policy.toolchainLedger.aggregateBytes,
      requestId: input.admission.plan.requestId,
      runId: input.admission.plan.runId,
      receiptId: input.admission.plan.receiptId,
      candidateId: input.admission.manifest.bindings.candidate.candidateId,
      selectedProfileId:
        input.admission.manifest.bindings.profile.selectedProfileId,
      chartId: input.admission.manifest.bindings.chart.chartId,
      candidateManifestPath: input.admission.manifestPath,
      candidateManifestSha256: input.admission.manifestRawSha256,
      atlasSha256: input.admission.manifest.bindings.atlas.sha256,
      unitsSha256: input.admission.manifest.bindings.units.sha256,
      normalizationSha256:
        input.admission.manifest.bindings.normalization.sha256,
      formalRunSpecPath: input.admission.formalRunSpecPath,
      formalRunSpecSha256: input.admission.preseal.formalRunSpecSha256,
      outputDirectory: input.admission.outputDirectory,
      attemptClaimPath: input.attemptClaim.path,
      attemptClaimSha256: input.attemptClaim.sha256,
      logicalEntrypoint: input.admission.plan.expectedInvocation.entrypoint,
      logicalArgsJson: JSON.stringify(
        input.admission.plan.expectedInvocation.args,
      ),
      logicalEnvironmentJson: JSON.stringify(
        input.admission.logicalEnvironment,
      ),
      actualLauncherArgsJson: JSON.stringify(input.command.args),
      actualLauncherBindingsJson: JSON.stringify(
        input.command.launcherBindings ?? [],
      ),
      outputInventoryJson: JSON.stringify(
        input.observed.map((entry) => ({
          path: entry.repoPath,
          sha256: entry.sha256,
          sizeBytes: entry.sizeBytes,
          freshness: entry.freshness,
        })),
      ),
      worktreeStatusAlgorithm: input.worktreeEvidence.baseline.algorithm,
      baselinePorcelainSha256: input.worktreeEvidence.baseline.rawSha256,
      baselinePorcelainRecordsJson: JSON.stringify(
        input.worktreeEvidence.baseline.records,
      ),
      preSpawnPorcelainSha256: input.worktreeEvidence.preSpawn.rawSha256,
      preSpawnPorcelainRecordsJson: JSON.stringify(
        input.worktreeEvidence.preSpawn.records,
      ),
      preSpawnAuthorizedUntrackedPathsJson: JSON.stringify(
        input.worktreeEvidence.preSpawnAuthorizedUntrackedPaths,
      ),
      finalizedPorcelainSha256:
        input.worktreeEvidence.finalized?.rawSha256 ?? null,
      finalizedPorcelainRecordsJson: JSON.stringify(
        input.worktreeEvidence.finalized?.records ?? [],
      ),
      finalizedAuthorizedUntrackedPathsJson: JSON.stringify(
        input.worktreeEvidence.finalizedAuthorizedUntrackedPaths,
      ),
      worktreeEvidenceCaptureBoundary:
        "after_output_manifest_before_receipt_persistence",
    },
    status: completed ? "completed" : "failed",
    outputs: {
      artifacts: input.observed.map((entry) => entry.repoPath),
      artifactEvidence,
      ...(input.artifactManifest != null
        ? { artifactManifest: input.artifactManifest }
        : {}),
      scalars: {
        exactRunOutputCount: input.observed.length,
        approvedToolchainLedgerEntryCount: policy.toolchainLedger.entryCount,
        approvedToolchainLedgerAggregateBytes:
          policy.toolchainLedger.aggregateBytes,
        serverPolicyResolved: true,
        outputRootAbsentBeforeSpawn: true,
        baselineWorktreeClean: input.worktreeEvidence.baseline.clean,
        authorizedWorktreeDeltaVerified:
          input.worktreeEvidence.preSpawnAuthorizedUntrackedPaths.length ===
            input.worktreeEvidence.preSpawn.records.length &&
          input.worktreeEvidence.finalized != null &&
          input.worktreeEvidence.finalizedAuthorizedUntrackedPaths.length ===
            input.worktreeEvidence.finalized.records.length,
        inheritedProcessEnvironment: false,
        formalDiagnosticReplayObserved: completed,
        numericalPhysicsValidated: false,
        theoryClosureEstablished: false,
        empiricalValidationEstablished: false,
        physicalViabilityEstablished: false,
        transportEstablished: false,
        propulsionEstablished: false,
        routeEtaEstablished: false,
        speedAuthorityEstablished: false,
      },
      units: {},
      gates: {
        approved_toolchain_policy: completed ? "pass" : "not_ready",
        runtime_execution: processSucceeded ? "pass" : "not_ready",
        runtime_execution_provenance:
          input.stableGitSha != null &&
          input.worktreeEvidence.baseline.clean &&
          input.worktreeEvidence.finalized != null &&
          canonicalTimestamp(input.execution.startedAt) &&
          canonicalTimestamp(input.execution.completedAt) &&
          input.execution.durationMs != null
            ? "pass"
            : "not_ready",
        runtime_artifact_freshness: completed ? "pass" : "not_ready",
        formal_v2_evidence: completed ? "pass" : "not_ready",
        formal_runtime_completion: completed ? "pass" : "not_ready",
        numerical_physics: "not_ready",
        experiment_ready_theory_closure: "not_ready",
        empirical_validation: "not_ready",
        physical_viability: "not_ready",
        transport: "not_ready",
        propulsion: "not_ready",
        route_eta: "not_ready",
        speed_authority: "not_ready",
      },
      missingSignals,
      warnings: completed
        ? [
            "Two cold direct-Lean replays produced exact fresh v2 formal diagnostic evidence; numerical, theory-closure, empirical, physical, transport, propulsion, ETA, and speed authority remain false.",
            "The approved policy and full toolchain-ledger commitment were resolved by the server, not supplied by the launch request.",
            "Git porcelain bytes were captured at the clean baseline, immediately before spawn, and after output-manifest finalization; immutable receipt persistence occurs after the final capture and is separately hash-bound.",
          ]
        : unique([
            input.finalizationErrors[0] ??
              input.execution.error ??
              "Formal runtime did not complete its fail-closed diagnostic lane.",
            "A failed formal runtime is not physical falsification and cannot complete theory closure.",
          ]),
    },
    provenance: {
      gitSha: input.stableGitSha,
      startedAt: input.execution.startedAt,
      completedAt: input.execution.completedAt,
      durationMs: input.execution.durationMs,
    },
    execution: {
      command: input.command.command,
      args: [...input.command.args],
      cwd: input.command.cwd,
      environment: { ...(input.command.env ?? {}) },
      outputDirectory: input.admission.outputDirectory,
      outputDirectoryBound: true,
      exitCode: input.execution.exitCode,
      stdout: input.execution.stdout,
      stderr: input.execution.stderr,
      timedOut: input.execution.timedOut,
      error: input.execution.error,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "diagnostic",
      promotionAllowed: false,
      promotionBlockedBy: unique([
        "formal_replay_is_not_numerical_or_physical_authority",
        "independent_numerical_and_empirical_receipts_required",
        ...missingSignals,
      ]),
    },
  });
  if (!isTheoryRuntimeReceiptV1(receipt)) {
    fail("receipt_invalid", "Formal runtime built an invalid v1 receipt.");
  }
  return receipt;
}

export async function executeNhm2FormalRuntime(
  input: Nhm2FormalRuntimeLaunchInput,
  dependencies: Nhm2FormalRuntimeExecutorDependenciesV1 = {},
): Promise<ExecuteNhm2FormalRuntimeResultV1> {
  if (!exactLaunchInput(input)) {
    fail(
      "launch_input_schema_invalid",
      "Formal execution accepts exactly candidateManifestPath.",
    );
  }
  const workspaceRoot = path.resolve(dependencies.projectRoot ?? process.cwd());
  const admission = await (
    dependencies.admit ??
    ((launchInput: Nhm2FormalRuntimeLaunchInput) =>
      admitNhm2FormalRuntimePlan(launchInput, { projectRoot: workspaceRoot }))
  )(input);
  if (path.resolve(admission.workspaceRoot) !== workspaceRoot) {
    fail(
      "admission_workspace_mismatch",
      "Formal admission and executor workspace roots differ.",
    );
  }
  const now = dependencies.now ?? (() => new Date());
  const resolveWorktreeStatus =
    dependencies.resolveWorktreeStatus ??
    resolveNhm2FormalRuntimeWorktreeStatus;
  const preSource = await (
    dependencies.resolveSourceState ?? resolveNhm2FormalRuntimeSourceState
  )(workspaceRoot);
  if (
    preSource.head.toLowerCase() !== admission.sourceState.head ||
    preSource.treeSha256.toLowerCase() !== admission.sourceState.treeSha256 ||
    !preSource.fullClean ||
    !preSource.trackedClean
  ) {
    fail(
      "source_state_changed",
      "Git HEAD/tree or admitted clean state changed before formal spawn.",
    );
  }
  const baselineWorktree = await resolveWorktreeStatus(workspaceRoot);
  validateWorktreeStatus(baselineWorktree, "baseline");
  if (!baselineWorktree.clean) {
    fail(
      "worktree_baseline_not_clean",
      "Formal runtime requires byte-digested clean porcelain status before creating run artifacts.",
    );
  }
  const beforeSnapshot: TheoryRuntimeArtifactSnapshot = new Map();
  const beforeCapturedAt = new Date().toISOString();
  await assertMissingOutputRoot(workspaceRoot, admission.outputDirectory);
  const attemptClaim = await createAttemptClaim({
    workspaceRoot,
    admission,
    now,
  });
  const pins = [
    ...allAdmissionPins(admission),
    {
      label: "immutable formal attempt claim",
      path: attemptClaim.path,
      absolutePath: path.resolve(workspaceRoot, attemptClaim.path),
      sha256: attemptClaim.sha256,
      sizeBytes: attemptClaim.sizeBytes,
    },
  ];
  await assertPinsCurrent(pins, "pre_spawn");
  const beforeCommitment = await writeTheoryRuntimePreSpawnSnapshotCommitment({
    projectRoot: workspaceRoot,
    requestId: admission.plan.requestId,
    runtimeId: admission.plan.runtimeId,
    outputDirectory: path.resolve(workspaceRoot, admission.outputDirectory),
    beforeCapturedAt,
    gitSha: preSource.head.toLowerCase(),
    sourceTreeSha256: sha256(
      `${preSource.head.toLowerCase()}\0${preSource.treeSha256.toLowerCase()}\0${baselineWorktree.rawSha256}`,
    ),
    worktreeClean: baselineWorktree.clean,
    before: beforeSnapshot,
  });
  const preSpawnWorktree = await resolveWorktreeStatus(workspaceRoot);
  const preSpawnAuthorizedUntrackedPaths = assertAuthorizedWorktreeDelta({
    status: preSpawnWorktree,
    phase: "pre-spawn",
    authorizedRepoPaths: [attemptClaim.path, beforeCommitment.path],
  });
  const command = await buildCommand(admission);

  let execution: TheoryRuntimeExecutionResult;
  const spawnStartedMs = now().getTime();
  try {
    await assertLauncherBindingsCurrent(command, "pre_spawn");
    execution = await (
      dependencies.spawnExecutor ?? executeTheoryRuntimeCommand
    )(command);
  } catch (error) {
    const completedMs = now().getTime();
    execution = {
      startedAt: new Date(spawnStartedMs).toISOString(),
      completedAt: new Date(completedMs).toISOString(),
      durationMs: Math.max(0, completedMs - spawnStartedMs),
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const finalizationErrors: string[] = [];
  try {
    await assertLauncherBindingsCurrent(command, "post_spawn");
  } catch (error) {
    finalizationErrors.push(
      error instanceof Error ? error.message : "Launcher rehash failed.",
    );
  }
  try {
    await assertPinsCurrent(pins, "post_spawn");
  } catch (error) {
    finalizationErrors.push(
      error instanceof Error ? error.message : "Input rehash failed.",
    );
  }
  let stableGitSha: string | null = null;
  try {
    const postSource = await (
      dependencies.resolveSourceState ?? resolveNhm2FormalRuntimeSourceState
    )(workspaceRoot);
    if (
      postSource.head.toLowerCase() === preSource.head.toLowerCase() &&
      postSource.treeSha256.toLowerCase() ===
        preSource.treeSha256.toLowerCase() &&
      postSource.trackedClean
    ) {
      stableGitSha = postSource.head.toLowerCase();
    } else {
      finalizationErrors.push(
        "Tracked Git HEAD/tree changed during formal execution.",
      );
    }
  } catch (error) {
    finalizationErrors.push(
      error instanceof Error ? error.message : "Post-run Git check failed.",
    );
  }
  const executionIntervalValid =
    canonicalTimestamp(execution.startedAt) &&
    canonicalTimestamp(execution.completedAt) &&
    execution.durationMs != null &&
    Number.isFinite(execution.durationMs) &&
    execution.durationMs >= 0 &&
    Date.parse(execution.completedAt) >= Date.parse(execution.startedAt) &&
    execution.durationMs ===
      Date.parse(execution.completedAt) - Date.parse(execution.startedAt) &&
    Date.parse(attemptClaim.createdAt) <= Date.parse(execution.startedAt) &&
    Date.parse(beforeCapturedAt) <= Date.parse(execution.startedAt) &&
    Date.parse(beforeCommitment.committedAt) <= Date.parse(execution.startedAt);
  if (!executionIntervalValid) {
    finalizationErrors.push(
      "Formal execution interval is incomplete or invalid.",
    );
  }

  let observed: ObservedOutput[] = [];
  let exactOutputsValidated = false;
  try {
    const output = await observeOutput({
      workspaceRoot,
      outputDirectory: admission.outputDirectory,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    });
    observed = output.files;
    if (
      execution.exitCode === 0 &&
      !execution.timedOut &&
      execution.error == null
    ) {
      await validateExactOutputs({ admission, observed: output });
      exactOutputsValidated = true;
    } else {
      finalizationErrors.push(
        "Formal child process did not exit successfully; evidence remains not ready.",
      );
    }
  } catch (error) {
    finalizationErrors.push(
      error instanceof Error
        ? error.message
        : "Formal output validation failed.",
    );
  }

  let artifactManifest: TheoryRuntimeOutputManifestV1 | null = null;
  if (
    exactOutputsValidated &&
    executionIntervalValid &&
    stableGitSha != null &&
    finalizationErrors.length === 0
  ) {
    try {
      const afterSnapshot = await snapshotTheoryRuntimeOutput({
        projectRoot: workspaceRoot,
        outputDirectory: path.resolve(workspaceRoot, admission.outputDirectory),
      });
      const afterCapturedAt = new Date().toISOString();
      const entries = classifyTheoryRuntimeArtifacts({
        before: beforeSnapshot,
        after: afterSnapshot,
      });
      const observedInventory = observed.map((entry) => ({
        path: entry.repoPath,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        modifiedAt: entry.modifiedAt,
        freshness: entry.freshness,
      }));
      if (
        Date.parse(afterCapturedAt) < Date.parse(execution.completedAt!) ||
        entries.length !== NHM2_FORMAL_RUNTIME_OUTPUT_LIMITS.maxFileCount ||
        entries.some((entry) => entry.freshness !== "new") ||
        !isDeepStrictEqual(entries, observedInventory)
      ) {
        fail(
          "freshness_snapshot_invalid",
          "Formal post-run snapshot did not exactly preserve the four observed outputs.",
        );
      }
      artifactManifest = await writeTheoryRuntimeOutputManifest({
        projectRoot: workspaceRoot,
        outputDirectory: path.resolve(workspaceRoot, admission.outputDirectory),
        requestId: admission.plan.requestId,
        runtimeId: admission.plan.runtimeId,
        gitSha: stableGitSha,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        generatedAt: afterCapturedAt,
        entries,
        freshnessProof: buildTheoryRuntimeFreshnessProof({
          before: beforeSnapshot,
          after: afterSnapshot,
          beforeCapturedAt,
          afterCapturedAt,
          beforeCommitmentPath: beforeCommitment.path,
          beforeCommitmentSha256: beforeCommitment.sha256,
        }),
      });
    } catch (error) {
      finalizationErrors.push(
        error instanceof Error
          ? error.message
          : "Formal output-manifest construction failed.",
      );
    }
  } else if (finalizationErrors.length === 0) {
    finalizationErrors.push(
      "Formal output manifest lacks validated execution, source, or freshness bindings.",
    );
  }

  let finalizedWorktree: Nhm2FormalRuntimeWorktreeStatusV1 | null = null;
  let finalizedAuthorizedUntrackedPaths: string[] = [];
  try {
    const finalSource = await (
      dependencies.resolveSourceState ?? resolveNhm2FormalRuntimeSourceState
    )(workspaceRoot);
    if (
      finalSource.head.toLowerCase() !== preSource.head.toLowerCase() ||
      finalSource.treeSha256.toLowerCase() !==
        preSource.treeSha256.toLowerCase() ||
      !finalSource.trackedClean
    ) {
      stableGitSha = null;
      throw new Error(
        "Tracked Git HEAD/tree changed before formal receipt finalization.",
      );
    }
    finalizedWorktree = await resolveWorktreeStatus(workspaceRoot);
    const authorizedFinalPaths = [
      attemptClaim.path,
      beforeCommitment.path,
      ...NHM2_FORMAL_RUNTIME_OUTPUT_PATHS.map((relativePath) =>
        normalizeRepoPath(`${admission.outputDirectory}/${relativePath}`),
      ),
      ...(artifactManifest?.manifestPath != null
        ? [artifactManifest.manifestPath]
        : []),
    ];
    finalizedAuthorizedUntrackedPaths = assertAuthorizedWorktreeDelta({
      status: finalizedWorktree,
      phase: "finalized",
      authorizedRepoPaths: authorizedFinalPaths,
    });
  } catch (error) {
    stableGitSha = null;
    finalizationErrors.push(
      error instanceof Error
        ? error.message
        : "Final Git porcelain verification failed.",
    );
  }
  const worktreeEvidence: Nhm2FormalRuntimeWorktreeEvidenceV1 = {
    baseline: baselineWorktree,
    preSpawn: preSpawnWorktree,
    finalized: finalizedWorktree,
    preSpawnAuthorizedUntrackedPaths,
    finalizedAuthorizedUntrackedPaths,
  };

  let receiptV1 = buildReceipt({
    admission,
    command,
    execution,
    attemptClaim,
    observed,
    artifactManifest,
    finalizationErrors: unique(finalizationErrors),
    stableGitSha,
    worktreeEvidence,
  });
  if (receiptV1.status === "completed") {
    const filesystem = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot: workspaceRoot,
      receipt: receiptV1,
    });
    if (!filesystem.ok || !filesystem.freshnessProofVerified) {
      finalizationErrors.push(
        ...filesystem.blockers.map(
          (blocker) => `runtime_receipt_filesystem:${blocker}`,
        ),
      );
      if (!filesystem.freshnessProofVerified) {
        finalizationErrors.push(
          "runtime_receipt_filesystem:freshness_proof_unverified",
        );
      }
      receiptV1 = buildReceipt({
        admission,
        command,
        execution,
        attemptClaim,
        observed,
        artifactManifest,
        finalizationErrors: unique(finalizationErrors),
        stableGitSha,
        worktreeEvidence,
      });
    }
  }
  const receiptArtifact = await (
    dependencies.persistReceipt ?? writeTheoryRuntimeReceiptArtifact
  )({
    projectRoot: workspaceRoot,
    requestId: admission.plan.requestId,
    receipt: receiptV1,
  });
  const receiptAbsolutePath = path.resolve(workspaceRoot, receiptArtifact.path);
  const outputAbsolutePath = path.resolve(
    workspaceRoot,
    admission.outputDirectory,
  );
  if (
    !SHA256.test(receiptArtifact.sha256) ||
    inside(outputAbsolutePath, receiptAbsolutePath) ||
    receiptAbsolutePath === outputAbsolutePath
  ) {
    fail(
      "receipt_persistence_invalid",
      "Immutable formal receipt must be hash-bound outside the run output directory.",
    );
  }
  return {
    requestId: admission.plan.requestId,
    runtimeId: admission.plan.runtimeId,
    command,
    execution,
    receiptV1,
    receiptArtifact,
    attemptClaim,
  };
}
