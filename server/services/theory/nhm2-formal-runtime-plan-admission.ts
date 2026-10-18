import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isDeepStrictEqual } from "node:util";

import {
  isNhm2ExperimentReadyTheoryCandidateManifest,
  nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest,
  nhm2ExperimentReadyTheoryFormalInvocation,
  type Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1,
  type Nhm2ExperimentReadyTheoryCandidateExpectedEvidenceOutputV1,
  type Nhm2ExperimentReadyTheoryCandidateHashedBindingV1,
  type Nhm2ExperimentReadyTheoryCandidateManifestV1,
} from "../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_FORMAL_PRODUCER_BUNDLE_ARTIFACT_ID,
  NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_ARTIFACT_ID,
} from "../../../shared/contracts/nhm2-formal-producer-bundle.v1";
import {
  NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION,
  NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ROLE,
} from "./nhm2-formal-outer-observation-evidence-adapter";
import {
  verifyNhm2FormalProducerBundleAdmission,
  type Nhm2FormalProducerBundleAdmissionV1,
} from "./nhm2-formal-producer-bundle-admission";
import {
  verifyNhm2FormalApprovedToolchainPolicy,
  type Nhm2FormalApprovedToolchainVerificationV1,
} from "./nhm2-formal-approved-toolchain-policy-verifier";
import {
  presealNhm2ExperimentReadyTheoryFormalRun,
  type PresealNhm2ExperimentReadyTheoryFormalRunResult,
} from "../../../tools/nhm2/preseal-experiment-ready-theory-formal-run";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
} from "../../../tools/nhm2/run-experiment-ready-theory-formal";
import { NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME } from "./nhm2-formal-kernel-executor";

const execFileAsync = promisify(execFile);

export const NHM2_FORMAL_RUNTIME_ID =
  "nhm2.experiment_ready_theory.formal" as const;
export const NHM2_FORMAL_RUNTIME_ADMISSION_LIMITS = {
  maxCandidateManifestBytes: 16 * 1024 * 1024,
  maxDescriptorBytes: 32 * 1024 * 1024,
  maxFormalRunSpecBytes: 256 * 1024 * 1024,
} as const;

export type Nhm2FormalRuntimeLaunchInput = {
  candidateManifestPath: string;
};

export type Nhm2FormalRuntimePinnedFileV1 = {
  label: string;
  path: string;
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
};

export type Nhm2FormalRuntimeSourceStateV1 = {
  head: string;
  treeSha256: string;
  fullClean: boolean;
  trackedClean: boolean;
};

export type Nhm2FormalServerPolicyResolutionV1 = {
  approvedPolicy: unknown;
  trustedFormalProjectRoot: string;
  trustedToolchainRoot: string;
  trustedLeanExecutablePath: string;
  trustedLakeExecutablePath: string;
};

export type Nhm2FormalServerPolicyResolverV1 = (input: {
  workspaceRoot: string;
  candidateManifestPath: string;
  candidateManifestSha256: string;
  manifestId: string;
  requestId: string;
  runId: string;
  runtimeId: typeof NHM2_FORMAL_RUNTIME_ID;
}) =>
  | Nhm2FormalServerPolicyResolutionV1
  | Promise<Nhm2FormalServerPolicyResolutionV1>;

export type Nhm2FormalRuntimePlanAdmissionV1 = {
  workspaceRoot: string;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1;
  manifestPath: string;
  manifestRawSha256: string;
  manifestSizeBytes: number;
  plan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
  expectedEvidence: Nhm2ExperimentReadyTheoryCandidateExpectedEvidenceOutputV1;
  outputDirectory: string;
  formalRunSpecPath: string;
  stagingRoot: string;
  pinnedInputs: Nhm2FormalRuntimePinnedFileV1[];
  formalProducerBundle: Nhm2FormalProducerBundleAdmissionV1;
  preseal: PresealNhm2ExperimentReadyTheoryFormalRunResult;
  approvedToolchain: Nhm2FormalApprovedToolchainVerificationV1 & {
    resolutionAuthority: "server_resolved";
  };
  sourceState: Nhm2FormalRuntimeSourceStateV1;
  logicalEnvironment: Record<string, string>;
  claimBoundary: {
    formalAdmissionOnly: true;
    numericalPhysicsValidated: false;
    theoryClosureEstablished: false;
    empiricalValidationEstablished: false;
    physicalViabilityEstablished: false;
    transportEstablished: false;
    propulsionEstablished: false;
    routeEtaEstablished: false;
    speedAuthorityEstablished: false;
  };
};

export type Nhm2FormalRuntimeAdmissionDependenciesV1 = {
  projectRoot?: string;
  resolveServerPolicy?: Nhm2FormalServerPolicyResolverV1;
  resolveSourceState?: (
    workspaceRoot: string,
  ) => Promise<Nhm2FormalRuntimeSourceStateV1>;
  verifyProducerBundle?: typeof verifyNhm2FormalProducerBundleAdmission;
  preseal?: typeof presealNhm2ExperimentReadyTheoryFormalRun;
  verifyApprovedToolchain?: typeof verifyNhm2FormalApprovedToolchainPolicy;
  now?: () => Date;
};

export class Nhm2FormalRuntimeAdmissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Nhm2FormalRuntimeAdmissionError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;
type FileIdentity = {
  dev: string;
  ino: string;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
};

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const fail = (code: string, message: string): never => {
  throw new Nhm2FormalRuntimeAdmissionError(code, message);
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

const identity = (
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): FileIdentity => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  mode: Number(stat.mode),
  size: Number(stat.size),
  mtimeMs: Number(stat.mtimeMs),
  ctimeMs: Number(stat.ctimeMs),
  nlink: Number(stat.nlink),
});

const portableRepoPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !path.posix.isAbsolute(value) &&
  !path.win32.isAbsolute(value) &&
  !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
  value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );

const inside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const samePath = (left: string, right: string): boolean => {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
};

async function assertWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const stat = await fs.lstat(workspaceRoot);
  const real = await fs.realpath(workspaceRoot);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    path.resolve(real) !== workspaceRoot
  ) {
    fail(
      "workspace_invalid",
      "Formal runtime workspace must be a real non-aliased directory.",
    );
  }
  return real;
}

async function readPinnedJson(input: {
  workspaceRoot: string;
  realWorkspaceRoot: string;
  repoPath: string;
  label: string;
  maxBytes: number;
  expectedSha256?: string;
  canonical: "pretty" | "compact";
}): Promise<{
  pin: Nhm2FormalRuntimePinnedFileV1;
  value: unknown;
  bytes: Buffer;
}> {
  if (!portableRepoPath(input.repoPath)) {
    fail("path_invalid", `${input.label} path is not repository-relative.`);
  }
  const absolutePath = path.resolve(input.workspaceRoot, input.repoPath);
  if (!inside(input.workspaceRoot, absolutePath)) {
    fail("path_escape", `${input.label} escaped the workspace.`);
  }
  const beforeStat = await fs
    .lstat(absolutePath)
    .catch((error: unknown) =>
      fail(
        "input_missing",
        `${input.label} is missing: ${(error as NodeJS.ErrnoException).code ?? "unreadable"}.`,
      ),
    );
  const before = identity(beforeStat);
  if (
    !beforeStat.isFile() ||
    beforeStat.isSymbolicLink() ||
    beforeStat.nlink !== 1 ||
    beforeStat.size <= 0 ||
    beforeStat.size > input.maxBytes
  ) {
    fail(
      "input_not_regular",
      `${input.label} must be a bounded regular single-link file.`,
    );
  }
  const realPath = await fs.realpath(absolutePath);
  if (
    path.resolve(realPath) !== absolutePath ||
    !inside(input.realWorkspaceRoot, realPath)
  ) {
    fail("input_alias", `${input.label} resolves through an alias.`);
  }
  const bytes = await fs.readFile(absolutePath);
  const afterStat = await fs.lstat(absolutePath);
  const digest = sha256(bytes);
  if (
    !isDeepStrictEqual(before, identity(afterStat)) ||
    bytes.byteLength !== beforeStat.size ||
    (input.expectedSha256 != null &&
      digest !== input.expectedSha256.toLowerCase())
  ) {
    fail(
      "input_changed",
      `${input.label} changed or failed its SHA-256 binding.`,
    );
  }
  let value: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return fail("json_invalid", `${input.label} is not valid UTF-8 JSON.`);
  }
  const canonical =
    input.canonical === "pretty"
      ? `${JSON.stringify(value, null, 2)}\n`
      : JSON.stringify(value);
  if (text !== canonical) {
    fail(
      "json_not_canonical",
      `${input.label} is not ${
        input.canonical === "pretty" ? "pretty-2-space-newline" : "compact"
      } canonical JSON.`,
    );
  }
  return {
    pin: {
      label: input.label,
      path: input.repoPath,
      absolutePath,
      sha256: digest,
      sizeBytes: bytes.byteLength,
    },
    value,
    bytes,
  };
}

function validateLaunchInput(
  value: unknown,
): asserts value is Nhm2FormalRuntimeLaunchInput {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["candidateManifestPath"]) ||
    !portableRepoPath(value.candidateManifestPath)
  ) {
    fail(
      "launch_input_schema_invalid",
      "Formal launch input accepts exactly candidateManifestPath; roots, specs, outputs, and policy are server-owned.",
    );
  }
}

export async function resolveNhm2FormalRuntimeSourceState(
  workspaceRoot: string,
): Promise<Nhm2FormalRuntimeSourceStateV1> {
  const [headResult, treeResult, fullStatusResult, trackedStatusResult] =
    await Promise.all([
      execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        windowsHide: true,
      }),
      execFileAsync("git", ["rev-parse", "--verify", "HEAD^{tree}"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        windowsHide: true,
      }),
      execFileAsync(
        "git",
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        {
          cwd: workspaceRoot,
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
        },
      ),
      execFileAsync(
        "git",
        ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
        {
          cwd: workspaceRoot,
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
        },
      ),
    ]);
  const head = String(headResult.stdout).trim().toLowerCase();
  const treeSha256 = String(treeResult.stdout).trim().toLowerCase();
  if (!GIT_SHA.test(head) || !GIT_SHA.test(treeSha256)) {
    fail(
      "git_identity_invalid",
      "Formal runtime could not resolve Git HEAD/tree.",
    );
  }
  return {
    head,
    treeSha256,
    fullClean: String(fullStatusResult.stdout).length === 0,
    trackedClean: String(trackedStatusResult.stdout).length === 0,
  };
}

const expectedLogicalEnvironment = (input: {
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1;
  manifestSha256: string;
  plan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
}): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const entry of input.plan.expectedInvocation.environment) {
    result[entry.name] =
      entry.valueKind === "candidate_manifest_raw_sha256"
        ? input.manifestSha256
        : (entry.value ?? "");
  }
  return result;
};

const bindingInputs = (
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1,
  plan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1,
): Array<{
  label: string;
  binding: Nhm2ExperimentReadyTheoryCandidateHashedBindingV1;
  identity: Record<string, string>;
}> => [
  {
    label: "candidate definition",
    binding: manifest.bindings.candidate,
    identity: { candidateId: manifest.bindings.candidate.candidateId },
  },
  {
    label: "selected profile",
    binding: manifest.bindings.profile,
    identity: {
      selectedProfileId: manifest.bindings.profile.selectedProfileId,
    },
  },
  {
    label: "chart definition",
    binding: manifest.bindings.chart,
    identity: { chartId: manifest.bindings.chart.chartId },
  },
  {
    label: "mask atlas",
    binding: manifest.bindings.atlas,
    identity: { atlasId: manifest.bindings.atlas.atlasId },
  },
  {
    label: "units definition",
    binding: manifest.bindings.units,
    identity: { unitsId: manifest.bindings.units.unitsId },
  },
  {
    label: "normalization definition",
    binding: manifest.bindings.normalization,
    identity: {
      normalizationId: manifest.bindings.normalization.normalizationId,
    },
  },
  {
    label: "formal solver descriptor",
    binding: plan.solver,
    identity: {
      planRole: "formal_kernel",
      solverId: plan.solver.solverId,
      solverVersion: plan.solver.solverVersion,
      implementationId: plan.solver.implementationId,
      sourceCommitSha: plan.sourceCommitSha,
    },
  },
  {
    label: "formal environment descriptor",
    binding: plan.environmentLock,
    identity: {
      planRole: "formal_kernel",
      environmentId: plan.environmentLock.environmentId,
      sourceCommitSha: plan.sourceCommitSha,
    },
  },
];

const exactFormalBundleIdentity = (
  candidateDescriptor: unknown,
  solverDescriptor: unknown,
): void => {
  if (
    !isRecord(candidateDescriptor) ||
    !isRecord(candidateDescriptor.formalProducerBundle) ||
    !isRecord(candidateDescriptor.formalProducerBundle.bundleRef) ||
    !isRecord(candidateDescriptor.formalProducerBundle.buildMetadataRef) ||
    candidateDescriptor.formalProducerBundle.bundleRef.artifactId !==
      NHM2_FORMAL_PRODUCER_BUNDLE_ARTIFACT_ID ||
    candidateDescriptor.formalProducerBundle.buildMetadataRef.artifactId !==
      NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_ARTIFACT_ID ||
    !isRecord(solverDescriptor) ||
    !isRecord(solverDescriptor.bundleRef) ||
    !isRecord(solverDescriptor.bundleBuildMetadataRef) ||
    solverDescriptor.bundleRef.artifactId !==
      NHM2_FORMAL_PRODUCER_BUNDLE_ARTIFACT_ID ||
    solverDescriptor.bundleBuildMetadataRef.artifactId !==
      NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_ARTIFACT_ID
  ) {
    fail(
      "formal_bundle_identity_invalid",
      "Formal admission rejects primary or generic producer-bundle substitution.",
    );
  }
};

async function assertMissingContainedDirectory(input: {
  workspaceRoot: string;
  realWorkspaceRoot: string;
  repoPath: string;
  label: string;
}): Promise<void> {
  if (!portableRepoPath(input.repoPath)) {
    fail("path_invalid", `${input.label} path is not portable.`);
  }
  const absolutePath = path.resolve(input.workspaceRoot, input.repoPath);
  if (!inside(input.workspaceRoot, absolutePath)) {
    fail("path_escape", `${input.label} escaped the workspace.`);
  }
  try {
    await fs.lstat(absolutePath);
    fail("path_preexists", `${input.label} must not exist before admission.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let ancestor = path.dirname(absolutePath);
  while (true) {
    try {
      const stat = await fs.lstat(ancestor);
      const real = await fs.realpath(ancestor);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (real !== input.realWorkspaceRoot &&
          !inside(input.realWorkspaceRoot, real))
      ) {
        fail("path_ancestor_invalid", `${input.label} has an unsafe ancestor.`);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = path.dirname(ancestor);
    if (next === ancestor) {
      fail("path_ancestor_invalid", `${input.label} has no safe ancestor.`);
    }
    ancestor = next;
  }
}

let installedServerPolicyResolver: Nhm2FormalServerPolicyResolverV1 | null =
  null;

/** Installs process-local server policy authority. Workstation requests cannot set it. */
export function installNhm2FormalServerPolicyResolver(
  resolver: Nhm2FormalServerPolicyResolverV1,
): () => void {
  if (installedServerPolicyResolver != null) {
    fail(
      "policy_resolver_already_installed",
      "A formal server policy resolver is already installed.",
    );
  }
  installedServerPolicyResolver = resolver;
  return () => {
    if (installedServerPolicyResolver === resolver) {
      installedServerPolicyResolver = null;
    }
  };
}

export async function admitNhm2FormalRuntimePlan(
  input: Nhm2FormalRuntimeLaunchInput,
  dependencies: Nhm2FormalRuntimeAdmissionDependenciesV1 = {},
): Promise<Nhm2FormalRuntimePlanAdmissionV1> {
  validateLaunchInput(input);
  const resolveServerPolicy =
    dependencies.resolveServerPolicy ??
    installedServerPolicyResolver ??
    fail(
      "not_configured",
      "NHM2 formal execution is not configured with a server-owned approved toolchain policy resolver.",
    );

  const workspaceRoot = path.resolve(dependencies.projectRoot ?? process.cwd());
  const realWorkspaceRoot = await assertWorkspaceRoot(workspaceRoot);
  const candidateObservation = await readPinnedJson({
    workspaceRoot,
    realWorkspaceRoot,
    repoPath: input.candidateManifestPath,
    label: "candidate manifest",
    maxBytes: NHM2_FORMAL_RUNTIME_ADMISSION_LIMITS.maxCandidateManifestBytes,
    canonical: "pretty",
  });
  if (
    !isNhm2ExperimentReadyTheoryCandidateManifest(candidateObservation.value)
  ) {
    fail(
      "candidate_manifest_invalid",
      "Candidate manifest failed its exact frozen v1 contract.",
    );
  }
  const manifest =
    candidateObservation.value as Nhm2ExperimentReadyTheoryCandidateManifestV1;
  if (
    manifest.readiness.status !== "pre_run_manifest_ready" ||
    !manifest.readiness.preRunManifestReady
  ) {
    fail("candidate_not_ready", "Candidate manifest is not pre-run ready.");
  }
  const now = (dependencies.now ?? (() => new Date()))();
  if (
    !Number.isFinite(now.getTime()) ||
    Date.parse(manifest.frozenAt) >= now.getTime()
  ) {
    fail(
      "candidate_freeze_invalid",
      "Candidate manifest must be frozen before formal admission.",
    );
  }

  const formalPlans = manifest.executionPlans.filter(
    (entry) => entry.planRole === "formal_kernel",
  );
  if (formalPlans.length !== 1) {
    fail(
      "formal_plan_cardinality_invalid",
      "Candidate must contain exactly one formal-kernel plan.",
    );
  }
  const plan = formalPlans[0];
  const expectedRequestId = `${manifest.manifestId}-formal-kernel-request-v1`;
  const expectedRunId = `${manifest.manifestId}-formal-kernel-run-v1`;
  const expectedReceiptId =
    nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest(
      NHM2_FORMAL_RUNTIME_ID,
      expectedRequestId,
    );
  if (
    plan.runtimeId !== NHM2_FORMAL_RUNTIME_ID ||
    plan.requestId !== expectedRequestId ||
    plan.runId !== expectedRunId ||
    plan.receiptId !== expectedReceiptId
  ) {
    fail(
      "formal_request_identity_invalid",
      "Formal request, run, receipt, and runtime identities are not the server-recomputed candidate identities.",
    );
  }
  const candidateDirectory = path.posix.dirname(input.candidateManifestPath);
  const expectedOutputDirectory = path.posix.join(
    candidateDirectory,
    "runs",
    plan.runId,
  );
  if (plan.expectedInvocation.outputDirectory !== expectedOutputDirectory) {
    fail(
      "formal_output_binding_invalid",
      "Formal output directory is not the exact candidate-local run directory.",
    );
  }
  let invocation: ReturnType<typeof nhm2ExperimentReadyTheoryFormalInvocation>;
  try {
    invocation = nhm2ExperimentReadyTheoryFormalInvocation({
      candidateManifestPath: input.candidateManifestPath,
      outputDirectory: plan.expectedInvocation.outputDirectory,
      runId: plan.runId,
    });
  } catch (error) {
    return fail(
      "formal_plan_invocation_invalid",
      error instanceof Error ? error.message : "Formal invocation is invalid.",
    );
  }
  if (
    plan.expectedInvocation.entrypoint !== invocation.entrypoint ||
    plan.expectedInvocation.command !== invocation.command ||
    !isDeepStrictEqual(plan.expectedInvocation.args, invocation.args) ||
    plan.expectedInvocation.cwd !== invocation.cwd
  ) {
    fail(
      "formal_plan_invocation_invalid",
      "Formal plan invocation is not the exact governed producer invocation.",
    );
  }
  const stagingRoot = path.posix.dirname(invocation.formalRunSpecPath);
  const expectedStagingRoot = path.posix.join(
    candidateDirectory,
    "formal-preseal",
    plan.runId,
  );
  if (stagingRoot !== expectedStagingRoot) {
    fail(
      "formal_staging_binding_invalid",
      "Formal preseal directory is not the exact plan-derived staging root.",
    );
  }
  const evidence = manifest.expectedEvidenceOutputs.filter(
    (entry) =>
      entry.evidenceRole === NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ROLE,
  );
  const expectedEvidencePath = `${plan.expectedInvocation.outputDirectory}/evidence/formal_manifest_certificate.json`;
  if (
    evidence.length !== 1 ||
    evidence[0].contractVersion !==
      NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION ||
    evidence[0].outputPath !== expectedEvidencePath ||
    evidence[0].requestId !== plan.requestId ||
    evidence[0].runId !== plan.runId ||
    evidence[0].receiptId !== plan.receiptId ||
    evidence[0].runtimeId !== plan.runtimeId
  ) {
    fail(
      "formal_evidence_binding_invalid",
      "Candidate must bind exactly one canonical v2 formal evidence output.",
    );
  }

  await assertMissingContainedDirectory({
    workspaceRoot,
    realWorkspaceRoot,
    repoPath: plan.expectedInvocation.outputDirectory,
    label: "formal output directory",
  });
  await assertMissingContainedDirectory({
    workspaceRoot,
    realWorkspaceRoot,
    repoPath: stagingRoot,
    label: "formal staging directory",
  });

  const sourceState = await (
    dependencies.resolveSourceState ?? resolveNhm2FormalRuntimeSourceState
  )(workspaceRoot);
  if (
    !GIT_SHA.test(sourceState.head) ||
    !GIT_SHA.test(sourceState.treeSha256) ||
    !sourceState.fullClean ||
    !sourceState.trackedClean ||
    sourceState.head.toLowerCase() !== plan.sourceCommitSha.toLowerCase()
  ) {
    fail(
      "source_state_not_admissible",
      "Formal admission requires the exact committed plan SHA and a clean source tree.",
    );
  }

  const pinnedInputs: Nhm2FormalRuntimePinnedFileV1[] = [
    candidateObservation.pin,
  ];
  let candidateDescriptor: unknown = null;
  let solverDescriptor: unknown = null;
  let environmentDescriptor: unknown = null;
  for (const descriptor of bindingInputs(manifest, plan)) {
    const observed = await readPinnedJson({
      workspaceRoot,
      realWorkspaceRoot,
      repoPath: descriptor.binding.path,
      label: descriptor.label,
      maxBytes: NHM2_FORMAL_RUNTIME_ADMISSION_LIMITS.maxDescriptorBytes,
      expectedSha256: descriptor.binding.sha256,
      canonical: "pretty",
    });
    if (!isRecord(observed.value)) {
      fail(
        "descriptor_identity_invalid",
        `${descriptor.label} does not match its exact manifest identity.`,
      );
    }
    const descriptorValue = observed.value as JsonRecord;
    if (
      descriptorValue.artifactId !== descriptor.binding.artifactId ||
      descriptorValue.contractVersion !== descriptor.binding.contractVersion ||
      Object.entries(descriptor.identity).some(
        ([key, expected]) => descriptorValue[key] !== expected,
      )
    ) {
      fail(
        "descriptor_identity_invalid",
        `${descriptor.label} does not match its exact manifest identity.`,
      );
    }
    pinnedInputs.push(observed.pin);
    if (descriptor.label === "candidate definition") {
      candidateDescriptor = descriptorValue;
    } else if (descriptor.label === "formal solver descriptor") {
      solverDescriptor = descriptorValue;
    } else if (descriptor.label === "formal environment descriptor") {
      environmentDescriptor = descriptorValue;
    }
  }
  exactFormalBundleIdentity(candidateDescriptor, solverDescriptor);

  let formalProducerBundle: Nhm2FormalProducerBundleAdmissionV1;
  try {
    formalProducerBundle = await (
      dependencies.verifyProducerBundle ??
      verifyNhm2FormalProducerBundleAdmission
    )({
      projectRoot: workspaceRoot,
      frozenAt: manifest.frozenAt,
      candidateDescriptor,
      solverDescriptor,
      environmentDescriptor,
    });
  } catch (error) {
    return fail(
      "formal_producer_bundle_not_admitted",
      error instanceof Error
        ? error.message
        : "Formal bundle admission failed.",
    );
  }

  const policyResolution = await resolveServerPolicy({
    workspaceRoot,
    candidateManifestPath: input.candidateManifestPath,
    candidateManifestSha256: candidateObservation.pin.sha256,
    manifestId: manifest.manifestId,
    requestId: plan.requestId,
    runId: plan.runId,
    runtimeId: NHM2_FORMAL_RUNTIME_ID,
  });
  if (
    !isRecord(policyResolution) ||
    typeof policyResolution.trustedFormalProjectRoot !== "string" ||
    typeof policyResolution.trustedToolchainRoot !== "string" ||
    typeof policyResolution.trustedLeanExecutablePath !== "string" ||
    typeof policyResolution.trustedLakeExecutablePath !== "string"
  ) {
    fail(
      "server_policy_resolution_invalid",
      "Server policy resolver did not return the complete trusted formal closure.",
    );
  }

  let preseal: PresealNhm2ExperimentReadyTheoryFormalRunResult;
  try {
    preseal = await (
      dependencies.preseal ?? presealNhm2ExperimentReadyTheoryFormalRun
    )({
      workspaceRoot,
      candidateManifestPath: input.candidateManifestPath,
      stagingRoot,
      trustedFormalProjectRoot: policyResolution.trustedFormalProjectRoot,
      trustedToolchainRoot: policyResolution.trustedToolchainRoot,
      trustedLeanExecutablePath: policyResolution.trustedLeanExecutablePath,
      trustedLakeExecutablePath: policyResolution.trustedLakeExecutablePath,
      now: dependencies.now,
    });
  } catch (error) {
    return fail(
      "formal_preseal_failed",
      error instanceof Error ? error.message : "Formal preseal failed.",
    );
  }
  if (
    preseal.formalRunSpecPath !== invocation.formalRunSpecPath ||
    preseal.stagingRoot !== stagingRoot ||
    !SHA256.test(preseal.formalRunSpecSha256) ||
    !Number.isSafeInteger(preseal.formalRunSpecSizeBytes) ||
    preseal.formalRunSpecSizeBytes <= 0
  ) {
    fail(
      "formal_preseal_binding_invalid",
      "Preseal result does not match the exact plan-derived spec and staging paths.",
    );
  }
  const runSpecObservation = await readPinnedJson({
    workspaceRoot,
    realWorkspaceRoot,
    repoPath: invocation.formalRunSpecPath,
    label: "formal run spec",
    maxBytes: NHM2_FORMAL_RUNTIME_ADMISSION_LIMITS.maxFormalRunSpecBytes,
    expectedSha256: preseal.formalRunSpecSha256,
    canonical: "compact",
  });
  if (
    runSpecObservation.pin.sizeBytes !== preseal.formalRunSpecSizeBytes ||
    !isDeepStrictEqual(runSpecObservation.value, preseal.runSpec)
  ) {
    fail(
      "formal_preseal_binding_invalid",
      "Reopened formal run spec differs from the preseal result.",
    );
  }
  const runSpec = preseal.runSpec;
  const outputRoot = path.resolve(
    workspaceRoot,
    plan.expectedInvocation.outputDirectory,
  );
  const stagingAbsolute = path.resolve(workspaceRoot, stagingRoot);
  const expectedRunSpecIdentity = {
    candidateId: manifest.bindings.candidate.candidateId,
    candidateManifestId: manifest.manifestId,
    candidateManifestSha256: candidateObservation.pin.sha256,
    candidateFrozenAt: manifest.frozenAt,
    requestId: plan.requestId,
    runId: plan.runId,
    receiptId: plan.receiptId,
    runtimeId: plan.runtimeId,
    sourceCommitSha: plan.sourceCommitSha,
  };
  const exactFormalClaimLocks = {
    formalLogicReplayOnly: true,
    outerObservedExecutionOnly: true,
    numericalPhysicsValidated: false,
    empiricalValidationEstablished: false,
    experimentReadyTheoryClosureClaimAllowed: false,
    physicalViabilityClaimAllowed: false,
    transportClaimAllowed: false,
    propulsionClaimAllowed: false,
    routeEtaClaimAllowed: false,
    speedAuthorityClaimAllowed: false,
  } as const;
  if (
    runSpec.artifactId !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID ||
    runSpec.contractVersion !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION ||
    !isDeepStrictEqual(runSpec.identity, expectedRunSpecIdentity) ||
    !isDeepStrictEqual(runSpec.planBinding, plan) ||
    runSpec.theoremName !== NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME ||
    runSpec.executor.theoremName !== NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME ||
    !samePath(runSpec.executor.outputRoot, outputRoot) ||
    !isDeepStrictEqual(
      runSpec.executor.replayWorkdirs.map((entry) => path.resolve(entry)),
      [
        path.join(outputRoot, "replay-one"),
        path.join(outputRoot, "replay-two"),
      ],
    ) ||
    runSpec.outerArtifactPath !==
      `${plan.expectedInvocation.outputDirectory}/${NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME}` ||
    !samePath(
      runSpec.formalSourceBindings.projectRoot,
      path.join(stagingAbsolute, "formal-source"),
    ) ||
    !samePath(
      runSpec.toolchainBindings.toolchainRoot,
      path.join(stagingAbsolute, "lean-toolchain"),
    ) ||
    !samePath(
      runSpec.executor.ledgers.input.rootPath,
      path.join(stagingAbsolute, "candidate-input"),
    ) ||
    !isDeepStrictEqual(runSpec.claimBoundary, exactFormalClaimLocks)
  ) {
    fail(
      "formal_run_spec_binding_invalid",
      "Formal run spec does not exactly bind the server-computed candidate identity, staging closure, output roots, and closed claims.",
    );
  }
  pinnedInputs.push(runSpecObservation.pin);

  let approvedToolchain: Nhm2FormalApprovedToolchainVerificationV1;
  try {
    approvedToolchain = (
      dependencies.verifyApprovedToolchain ??
      verifyNhm2FormalApprovedToolchainPolicy
    )({
      approvedPolicy: policyResolution.approvedPolicy,
      formalRunSpec: runSpecObservation.value,
      workspaceRoot,
    });
  } catch (error) {
    return fail(
      "approved_toolchain_policy_mismatch",
      error instanceof Error
        ? error.message
        : "Approved toolchain policy verification failed.",
    );
  }
  if (
    approvedToolchain.status !== "pass_approved_diagnostic_toolchain_match" ||
    typeof approvedToolchain.policyId !== "string" ||
    approvedToolchain.policyId.trim().length === 0 ||
    !SHA256.test(approvedToolchain.policySemanticSha256) ||
    !SHA256.test(approvedToolchain.toolchainLedger.aggregateSha256) ||
    approvedToolchain.toolchainLedger.entryCount < 2 ||
    approvedToolchain.toolchainLedger.aggregateBytes <= 0 ||
    approvedToolchain.toolchainLedger.aggregateSha256 !==
      runSpec.executor.ledgers.toolchain.ledgerSha256 ||
    approvedToolchain.toolchainLedger.entryCount !==
      runSpec.executor.ledgers.toolchain.entries.length ||
    approvedToolchain.toolchainLedger.aggregateBytes !==
      runSpec.executor.ledgers.toolchain.entries.reduce(
        (total, entry) => total + entry.sizeBytes,
        0,
      )
  ) {
    fail(
      "approved_toolchain_policy_mismatch",
      "Approved toolchain verification omitted its exact policy or full-ledger commitment.",
    );
  }

  const candidateAfter = await readPinnedJson({
    workspaceRoot,
    realWorkspaceRoot,
    repoPath: input.candidateManifestPath,
    label: "candidate manifest after preseal",
    maxBytes: NHM2_FORMAL_RUNTIME_ADMISSION_LIMITS.maxCandidateManifestBytes,
    expectedSha256: candidateObservation.pin.sha256,
    canonical: "pretty",
  });
  if (!candidateAfter.bytes.equals(candidateObservation.bytes)) {
    fail(
      "input_changed",
      "Candidate manifest changed during formal admission.",
    );
  }

  return {
    workspaceRoot,
    manifest,
    manifestPath: input.candidateManifestPath,
    manifestRawSha256: candidateObservation.pin.sha256,
    manifestSizeBytes: candidateObservation.pin.sizeBytes,
    plan,
    expectedEvidence: evidence[0],
    outputDirectory: plan.expectedInvocation.outputDirectory,
    formalRunSpecPath: invocation.formalRunSpecPath,
    stagingRoot,
    pinnedInputs,
    formalProducerBundle,
    preseal,
    approvedToolchain: {
      ...approvedToolchain,
      resolutionAuthority: "server_resolved",
    },
    sourceState: {
      ...sourceState,
      head: sourceState.head.toLowerCase(),
      treeSha256: sourceState.treeSha256.toLowerCase(),
    },
    logicalEnvironment: expectedLogicalEnvironment({
      manifest,
      manifestSha256: candidateObservation.pin.sha256,
      plan,
    }),
    claimBoundary: {
      formalAdmissionOnly: true,
      numericalPhysicsValidated: false,
      theoryClosureEstablished: false,
      empiricalValidationEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      speedAuthorityEstablished: false,
    },
  };
}
