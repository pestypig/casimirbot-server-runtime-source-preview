import { createHash } from "node:crypto";
import path from "node:path";

import {
  NHM2_FORMAL_APPROVED_TOOLCHAIN_BLOCKERS,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_CLAIM_BOUNDARY,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_LIMITS,
  Nhm2FormalApprovedToolchainPolicyContractError,
  assertNhm2FormalApprovedToolchainPolicy,
  compareNhm2FormalApprovedToolchainUtf8,
  computeNhm2FormalApprovedToolchainLedgerSha256,
  isNhm2FormalApprovedToolchainPortableRelativePath,
  type Nhm2FormalApprovedToolchainLedgerEntryV1,
  type Nhm2FormalApprovedToolchainPolicyV1,
} from "../../../shared/contracts/nhm2-formal-approved-toolchain-policy.v1";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
} from "../../../tools/nhm2/run-experiment-ready-theory-formal";

export const NHM2_FORMAL_APPROVED_TOOLCHAIN_VERIFICATION_STATUS =
  "pass_approved_diagnostic_toolchain_match" as const;

export type Nhm2FormalApprovedToolchainVerificationV1 = {
  status: typeof NHM2_FORMAL_APPROVED_TOOLCHAIN_VERIFICATION_STATUS;
  policyId: string;
  policySemanticSha256: string;
  target: Nhm2FormalApprovedToolchainPolicyV1["target"];
  releases: Nhm2FormalApprovedToolchainPolicyV1["releases"];
  formalProjectToolchainFile: Nhm2FormalApprovedToolchainPolicyV1["formalProjectToolchainFile"];
  toolchainLedger: {
    rootIndependent: true;
    aggregateSha256: string;
    entryCount: number;
    aggregateBytes: number;
  };
  executables: Nhm2FormalApprovedToolchainPolicyV1["executables"];
  approvedEnvironmentAllowlist: string[];
  authorityBasis: {
    hostPlatformExact: true;
    hostArchitectureExact: true;
    formalProjectToolchainFileExact: true;
    fullToolchainLedgerExact: true;
    leanExecutableExact: true;
    lakeExecutableExact: true;
    toolchainBindingInventoryExact: true;
    environmentExact: true;
    callerSuppliedReleaseLabelsUsed: false;
  };
  blockers: [...typeof NHM2_FORMAL_APPROVED_TOOLCHAIN_BLOCKERS];
  claimBoundary: typeof NHM2_FORMAL_APPROVED_TOOLCHAIN_CLAIM_BOUNDARY;
};

export type VerifyNhm2FormalApprovedToolchainPolicyInput = {
  approvedPolicy: unknown;
  formalRunSpec: unknown;
  workspaceRoot: string;
};

export class Nhm2FormalApprovedToolchainPolicyVerifierError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Nhm2FormalApprovedToolchainPolicyVerifierError";
    this.code = code;
  }
}

type LedgerEntry = {
  relativePath: string;
  sha256: string;
  sizeBytes: number;
};

type SealedLedger = {
  kind: "source" | "toolchain";
  rootPath: string;
  entries: LedgerEntry[];
  ledgerSha256: string;
};

type FormalSourceBinding = {
  sourceRole: string;
  path: string;
  sha256: string;
  sizeBytes: number;
};

type ToolchainBinding = {
  toolchainRole: "lean_executable" | "lake_executable" | "runtime_dependency";
  path: string;
  sha256: string;
  sizeBytes: number;
};

type ExecutableBinding = {
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
};

const SHA256 = /^[a-f0-9]{64}$/;

const fail = (code: string, message: string): never => {
  throw new Nhm2FormalApprovedToolchainPolicyVerifierError(code, message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort(
    compareNhm2FormalApprovedToolchainUtf8,
  );
  const sortedExpected = [...expected].sort(
    compareNhm2FormalApprovedToolchainUtf8,
  );
  return JSON.stringify(actual) === JSON.stringify(sortedExpected);
};

const requireAbsoluteLocalPath = (value: string, label: string): string => {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    (process.platform === "win32" &&
      (/^\\\\/.test(value) || /^\\\\\?\\/.test(value)))
  ) {
    fail("absolute_local_path_required", `${label} must be an absolute local path.`);
  }
  return path.resolve(value);
};

const normalizePath = (value: string): string => {
  let normalized = path.normalize(value);
  if (process.platform === "win32") {
    normalized = normalized
      .replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\/, "")
      .toLowerCase();
  }
  return normalized;
};

const samePath = (left: string, right: string): boolean =>
  normalizePath(left) === normalizePath(right);

const containedBy = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
};

const pathKey = (value: string): string =>
  process.platform === "win32"
    ? normalizePath(value).toLowerCase()
    : normalizePath(value);

const resolveWorkspaceBinding = (
  workspaceRoot: string,
  relativePath: string,
  label: string,
): string => {
  if (!isNhm2FormalApprovedToolchainPortableRelativePath(relativePath)) {
    fail("binding_path_invalid", `${label} must be a portable workspace path.`);
  }
  const absolutePath = path.resolve(
    workspaceRoot,
    ...relativePath.split("/"),
  );
  if (!containedBy(workspaceRoot, absolutePath)) {
    fail("binding_path_escape", `${label} escapes the server workspace root.`);
  }
  return absolutePath;
};

const isLedgerEntry = (value: unknown): value is LedgerEntry =>
  isRecord(value) &&
  hasOnlyKeys(value, ["relativePath", "sha256", "sizeBytes"]) &&
  typeof value.relativePath === "string" &&
  isNhm2FormalApprovedToolchainPortableRelativePath(value.relativePath) &&
  typeof value.sha256 === "string" &&
  SHA256.test(value.sha256) &&
  Number.isSafeInteger(value.sizeBytes) &&
  (value.sizeBytes as number) >= 0 &&
  (value.sizeBytes as number) <=
    NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_LIMITS.maxLedgerEntryBytes;

const computeSealedLedgerSha256 = (
  kind: "source" | "toolchain",
  entries: readonly LedgerEntry[],
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        domain: "nhm2_formal_kernel_sealed_ledger/v1",
        kind,
        entries: entries.map((entry) => ({
          relativePath: entry.relativePath,
          sha256: entry.sha256,
          sizeBytes: entry.sizeBytes,
        })),
      }),
    )
    .digest("hex");

const parseLedger = (
  value: unknown,
  kind: "source" | "toolchain",
  workspaceRoot: string,
): SealedLedger => {
  if (!isRecord(value)) {
    fail(
      "formal_run_spec_ledger_invalid",
      `Formal run-spec ${kind} ledger is malformed or unbounded.`,
    );
  }
  const ledger = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(ledger, ["entries", "kind", "ledgerSha256", "rootPath"]) ||
    ledger.kind !== kind ||
    typeof ledger.rootPath !== "string" ||
    !Array.isArray(ledger.entries) ||
    ledger.entries.length === 0 ||
    ledger.entries.length >
      NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_LIMITS.maxLedgerEntryCount ||
    !ledger.entries.every(isLedgerEntry) ||
    typeof ledger.ledgerSha256 !== "string" ||
    !SHA256.test(ledger.ledgerSha256)
  ) {
    fail(
      "formal_run_spec_ledger_invalid",
      `Formal run-spec ${kind} ledger is malformed or unbounded.`,
    );
  }
  const rootPath = requireAbsoluteLocalPath(
    ledger.rootPath as string,
    `${kind} ledger root`,
  );
  if (!containedBy(workspaceRoot, rootPath)) {
    fail(
      "formal_run_spec_ledger_root_escape",
      `${kind} ledger root is outside the server workspace.`,
    );
  }
  const entries = ledger.entries as LedgerEntry[];
  const caseInsensitive = process.platform === "win32";
  const pathKeys = entries.map((entry) =>
    caseInsensitive ? entry.relativePath.toLowerCase() : entry.relativePath,
  );
  if (
    entries.some(
      (entry, index) =>
        index > 0 &&
        compareNhm2FormalApprovedToolchainUtf8(
          entries[index - 1].relativePath,
          entry.relativePath,
        ) >= 0,
    ) ||
    new Set(pathKeys).size !== entries.length
  ) {
    fail(
      "formal_run_spec_ledger_path_alias",
      `${kind} ledger paths are not exact, sorted, and alias-free.`,
    );
  }
  const aggregateBytes = entries.reduce(
    (total, entry) => total + entry.sizeBytes,
    0,
  );
  if (
    !Number.isSafeInteger(aggregateBytes) ||
    aggregateBytes >
      NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_LIMITS.maxLedgerAggregateBytes ||
    ledger.ledgerSha256 !== computeSealedLedgerSha256(kind, entries)
  ) {
    fail(
      "formal_run_spec_ledger_commitment_invalid",
      `${kind} ledger commitment or aggregate size is invalid.`,
    );
  }
  return {
    kind,
    rootPath,
    entries,
    ledgerSha256: ledger.ledgerSha256 as string,
  };
};

const parseExecutableBinding = (
  value: unknown,
  role: "Lean" | "Lake",
): ExecutableBinding => {
  if (!isRecord(value)) {
    fail(
      "formal_run_spec_executable_invalid",
      `${role} executable binding is malformed.`,
    );
  }
  const executable = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(executable, ["absolutePath", "sha256", "sizeBytes"]) ||
    typeof executable.absolutePath !== "string" ||
    typeof executable.sha256 !== "string" ||
    !SHA256.test(executable.sha256) ||
    !Number.isSafeInteger(executable.sizeBytes) ||
    (executable.sizeBytes as number) <= 0
  ) {
    fail(
      "formal_run_spec_executable_invalid",
      `${role} executable binding is malformed.`,
    );
  }
  return {
    absolutePath: requireAbsoluteLocalPath(
      executable.absolutePath as string,
      `${role} executable`,
    ),
    sha256: executable.sha256 as string,
    sizeBytes: executable.sizeBytes as number,
  };
};

const validateHostTarget = (
  policy: Nhm2FormalApprovedToolchainPolicyV1,
): void => {
  if (policy.target.platform !== process.platform) {
    fail(
      "approved_toolchain_platform_mismatch",
      `Approved policy targets ${policy.target.platform}; server host is ${process.platform}.`,
    );
  }
  if (policy.target.architecture !== process.arch) {
    fail(
      "approved_toolchain_architecture_mismatch",
      `Approved policy targets ${policy.target.architecture}; server host is ${process.arch}.`,
    );
  }
};

const validateFormalProjectToolchainFile = (input: {
  policy: Nhm2FormalApprovedToolchainPolicyV1;
  workspaceRoot: string;
  formalSourceBindings: unknown;
  sourceLedger: SealedLedger;
}): void => {
  if (!isRecord(input.formalSourceBindings)) {
    fail(
      "formal_source_bindings_invalid",
      "Formal source bindings are malformed.",
    );
  }
  const sourceBindings = input.formalSourceBindings as Record<string, unknown>;
  if (
    !hasOnlyKeys(sourceBindings, [
      "authority",
      "entries",
      "projectRoot",
    ]) ||
    sourceBindings.authority !== "server_owned_formal_project" ||
    typeof sourceBindings.projectRoot !== "string" ||
    !Array.isArray(sourceBindings.entries)
  ) {
    fail(
      "formal_source_bindings_invalid",
      "Formal source bindings are malformed.",
    );
  }
  const projectRoot = requireAbsoluteLocalPath(
    sourceBindings.projectRoot as string,
    "formal source project root",
  );
  if (!samePath(projectRoot, input.sourceLedger.rootPath)) {
    fail(
      "formal_source_root_mismatch",
      "Formal source bindings and source ledger do not share the exact root.",
    );
  }
  const sourceEntries = input.sourceLedger.entries.filter(
    (entry) => entry.relativePath === "lean-toolchain",
  );
  const expectedFile = input.policy.formalProjectToolchainFile;
  if (
    sourceEntries.length !== 1 ||
    sourceEntries[0].sha256 !== expectedFile.sha256 ||
    sourceEntries[0].sizeBytes !== expectedFile.sizeBytes
  ) {
    fail(
      "formal_lean_toolchain_file_mismatch",
      "Presealed formal source does not contain the exact approved lean-toolchain bytes.",
    );
  }
  const rawBindings = sourceBindings.entries as unknown[];
  if (
    rawBindings.some(
      (entry) =>
        !isRecord(entry) ||
        !hasOnlyKeys(entry, ["path", "sha256", "sizeBytes", "sourceRole"]) ||
        typeof entry.sourceRole !== "string" ||
        entry.sourceRole.length === 0 ||
        typeof entry.path !== "string" ||
        !isNhm2FormalApprovedToolchainPortableRelativePath(entry.path) ||
        typeof entry.sha256 !== "string" ||
        !SHA256.test(entry.sha256) ||
        !Number.isSafeInteger(entry.sizeBytes) ||
        (entry.sizeBytes as number) <= 0,
    )
  ) {
    fail(
      "formal_source_bindings_invalid",
      "Formal source binding inventory contains a malformed entry.",
    );
  }
  const allBindings = rawBindings as FormalSourceBinding[];
  const resolvedBindingKeys = allBindings.map((binding) =>
    pathKey(
      resolveWorkspaceBinding(
        input.workspaceRoot,
        binding.path,
        "formal source binding",
      ),
    ),
  );
  if (new Set(resolvedBindingKeys).size !== resolvedBindingKeys.length) {
    fail(
      "formal_source_binding_alias",
      "Formal source binding inventory contains aliased paths.",
    );
  }
  const bindings = allBindings.filter(
    (entry) => entry.sourceRole === "lean_toolchain",
  );
  if (bindings.length !== 1) {
    fail(
      "formal_lean_toolchain_binding_mismatch",
      "Formal source must expose exactly one lean_toolchain role.",
    );
  }
  const binding = bindings[0];
  const bindingAbsolutePath = resolveWorkspaceBinding(
    input.workspaceRoot,
    binding.path,
    "formal lean-toolchain binding",
  );
  const expectedAbsolutePath = path.resolve(projectRoot, "lean-toolchain");
  if (
    !samePath(bindingAbsolutePath, expectedAbsolutePath) ||
    binding.sha256 !== expectedFile.sha256 ||
    binding.sizeBytes !== expectedFile.sizeBytes
  ) {
    fail(
      "formal_lean_toolchain_binding_mismatch",
      "Formal lean_toolchain role is not bound to the exact staged source entry.",
    );
  }
};

const validateExactToolchainLedger = (input: {
  policy: Nhm2FormalApprovedToolchainPolicyV1;
  ledger: SealedLedger;
}): void => {
  const expected = input.policy.toolchainLedger;
  if (
    input.ledger.ledgerSha256 !== expected.aggregateSha256 ||
    input.ledger.entries.length !== expected.entryCount ||
    input.ledger.entries.reduce(
      (total, entry) => total + entry.sizeBytes,
      0,
    ) !== expected.aggregateBytes ||
    JSON.stringify(input.ledger.entries) !== JSON.stringify(expected.entries) ||
    computeNhm2FormalApprovedToolchainLedgerSha256(
      input.ledger.entries as Nhm2FormalApprovedToolchainLedgerEntryV1[],
    ) !== expected.aggregateSha256
  ) {
    fail(
      "approved_toolchain_ledger_mismatch",
      "Presealed run-spec toolchain has missing, extra, reordered, or changed entries.",
    );
  }
};

const validateToolchainBindings = (input: {
  policy: Nhm2FormalApprovedToolchainPolicyV1;
  workspaceRoot: string;
  ledger: SealedLedger;
  toolchainBindings: unknown;
}): void => {
  if (!isRecord(input.toolchainBindings)) {
    fail(
      "formal_toolchain_bindings_invalid",
      "Formal toolchain bindings are malformed or incomplete.",
    );
  }
  const toolchainBindings = input.toolchainBindings as Record<string, unknown>;
  if (
    !hasOnlyKeys(toolchainBindings, [
      "authority",
      "entries",
      "toolchainRoot",
    ]) ||
    toolchainBindings.authority !== "sealed_lean_toolchain" ||
    typeof toolchainBindings.toolchainRoot !== "string" ||
    !Array.isArray(toolchainBindings.entries) ||
    toolchainBindings.entries.length !== input.ledger.entries.length
  ) {
    fail(
      "formal_toolchain_bindings_invalid",
      "Formal toolchain bindings are malformed or incomplete.",
    );
  }
  const bindingRoot = requireAbsoluteLocalPath(
    toolchainBindings.toolchainRoot as string,
    "toolchain binding root",
  );
  if (!samePath(bindingRoot, input.ledger.rootPath)) {
    fail(
      "formal_toolchain_root_mismatch",
      "Toolchain bindings and sealed ledger do not share the exact root.",
    );
  }
  const expectedByAbsolutePath = new Map(
    input.ledger.entries.map((entry) => [
      pathKey(path.resolve(bindingRoot, ...entry.relativePath.split("/"))),
      entry,
    ]),
  );
  const observedPaths = new Set<string>();
  for (const rawBinding of toolchainBindings.entries as unknown[]) {
    if (
      !isRecord(rawBinding) ||
      !hasOnlyKeys(rawBinding, ["path", "sha256", "sizeBytes", "toolchainRole"]) ||
      (rawBinding.toolchainRole !== "lean_executable" &&
        rawBinding.toolchainRole !== "lake_executable" &&
        rawBinding.toolchainRole !== "runtime_dependency") ||
      typeof rawBinding.path !== "string" ||
      typeof rawBinding.sha256 !== "string" ||
      !SHA256.test(rawBinding.sha256) ||
      !Number.isSafeInteger(rawBinding.sizeBytes) ||
      (rawBinding.sizeBytes as number) < 0
    ) {
      fail(
        "formal_toolchain_bindings_invalid",
        "Formal toolchain binding entry is malformed.",
      );
    }
    const binding = rawBinding as ToolchainBinding;
    const absolutePath = resolveWorkspaceBinding(
      input.workspaceRoot,
      binding.path,
      "formal toolchain binding",
    );
    const key = pathKey(absolutePath);
    const ledgerEntry =
      expectedByAbsolutePath.get(key) ??
      fail(
        "formal_toolchain_binding_alias_or_extra",
        "Toolchain binding aliases another file or is not in the approved ledger.",
      );
    if (observedPaths.has(key)) {
      fail(
        "formal_toolchain_binding_alias_or_extra",
        "Toolchain binding aliases another file or is not in the approved ledger.",
      );
    }
    observedPaths.add(key);
    const expectedRole =
      ledgerEntry.relativePath === input.policy.executables.lean.relativePath
        ? "lean_executable"
        : ledgerEntry.relativePath === input.policy.executables.lake.relativePath
          ? "lake_executable"
          : "runtime_dependency";
    if (
      binding.toolchainRole !== expectedRole ||
      binding.sha256 !== ledgerEntry.sha256 ||
      binding.sizeBytes !== ledgerEntry.sizeBytes
    ) {
      fail(
        "formal_toolchain_binding_mismatch",
        "Caller role labels do not match the server-approved path/hash authority.",
      );
    }
  }
  if (observedPaths.size !== expectedByAbsolutePath.size) {
    fail(
      "formal_toolchain_binding_inventory_mismatch",
      "Toolchain binding inventory has missing or extra entries.",
    );
  }
};

const validateExecutables = (input: {
  policy: Nhm2FormalApprovedToolchainPolicyV1;
  ledgerRoot: string;
  executables: unknown;
}): void => {
  if (!isRecord(input.executables)) {
    fail(
      "formal_run_spec_executables_invalid",
      "Formal run spec must bind exactly Lean and Lake executables.",
    );
  }
  const executables = input.executables as Record<string, unknown>;
  if (
    !hasOnlyKeys(executables, ["lake", "lean"])
  ) {
    fail(
      "formal_run_spec_executables_invalid",
      "Formal run spec must bind exactly Lean and Lake executables.",
    );
  }
  const lean = parseExecutableBinding(executables.lean, "Lean");
  const lake = parseExecutableBinding(executables.lake, "Lake");
  const expectedLean = input.policy.executables.lean;
  const expectedLake = input.policy.executables.lake;
  const expectedLeanPath = path.resolve(
    input.ledgerRoot,
    ...expectedLean.relativePath.split("/"),
  );
  const expectedLakePath = path.resolve(
    input.ledgerRoot,
    ...expectedLake.relativePath.split("/"),
  );
  if (samePath(lean.absolutePath, lake.absolutePath)) {
    fail(
      "formal_toolchain_executable_alias",
      "Lean and Lake executable bindings alias the same file.",
    );
  }
  if (
    !samePath(lean.absolutePath, expectedLeanPath) ||
    lean.sha256 !== expectedLean.sha256 ||
    lean.sizeBytes !== expectedLean.sizeBytes
  ) {
    fail(
      "approved_lean_executable_mismatch",
      "Lean executable does not match the server-approved ledger entry.",
    );
  }
  if (
    !samePath(lake.absolutePath, expectedLakePath) ||
    lake.sha256 !== expectedLake.sha256 ||
    lake.sizeBytes !== expectedLake.sizeBytes
  ) {
    fail(
      "approved_lake_executable_mismatch",
      "Lake executable does not match the server-approved ledger entry.",
    );
  }
};

const validateEnvironment = (
  policy: Nhm2FormalApprovedToolchainPolicyV1,
  executor: Record<string, unknown>,
): void => {
  if (
    !Array.isArray(executor.environmentAllowlist) ||
    !isRecord(executor.environment)
  ) {
    fail(
      "formal_environment_invalid",
      "Formal environment allowlist and values are required.",
    );
  }
  const expectedAllowlist = policy.approvedEnvironment.allowlist;
  const expectedValues = Object.fromEntries(
    policy.approvedEnvironment.values.map((entry) => [entry.name, entry.value]),
  );
  const actualEnvironment = executor.environment as Record<string, unknown>;
  if (Object.values(actualEnvironment).some((value) => typeof value !== "string")) {
    fail(
      "formal_environment_invalid",
      "Formal environment values must be strings.",
    );
  }
  const actualValues = Object.fromEntries(
    Object.entries(actualEnvironment).sort(([left], [right]) =>
      compareNhm2FormalApprovedToolchainUtf8(left, right),
    ),
  );
  if (
    JSON.stringify(executor.environmentAllowlist) !==
      JSON.stringify(expectedAllowlist) ||
    JSON.stringify(actualValues) !== JSON.stringify(expectedValues)
  ) {
    fail(
      "formal_environment_not_approved",
      "Formal process environment differs from the exact server allowlist.",
    );
  }
};

/**
 * Verifies only server-owned toolchain admission. It intentionally ignores
 * caller-controlled solver/version labels in the candidate plan: release
 * identity comes from the approved full-ledger and executable hashes.
 */
export function verifyNhm2FormalApprovedToolchainPolicy(
  input: VerifyNhm2FormalApprovedToolchainPolicyInput,
): Nhm2FormalApprovedToolchainVerificationV1 {
  try {
    assertNhm2FormalApprovedToolchainPolicy(input.approvedPolicy);
  } catch (error) {
    if (error instanceof Nhm2FormalApprovedToolchainPolicyContractError) {
      fail(error.code, error.message);
    }
    throw error;
  }
  const policy = input.approvedPolicy;
  validateHostTarget(policy);
  const workspaceRoot = requireAbsoluteLocalPath(
    input.workspaceRoot,
    "server workspace root",
  );
  const spec = input.formalRunSpec;
  if (!isRecord(spec)) {
    fail(
      "formal_run_spec_identity_invalid",
      "Toolchain admission requires the exact presealed formal run-spec contract.",
    );
  }
  const specRecord = spec as Record<string, unknown>;
  if (
    specRecord.artifactId !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID ||
    specRecord.contractVersion !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION ||
    !isRecord(specRecord.executor)
  ) {
    fail(
      "formal_run_spec_identity_invalid",
      "Toolchain admission requires the exact presealed formal run-spec contract.",
    );
  }
  const executor = specRecord.executor as Record<string, unknown>;
  if (!isRecord(executor.ledgers)) {
    fail(
      "formal_run_spec_identity_invalid",
      "Toolchain admission requires sealed source and toolchain ledgers.",
    );
  }
  const ledgers = executor.ledgers as Record<string, unknown>;
  const sourceLedger = parseLedger(
    ledgers.source,
    "source",
    workspaceRoot,
  );
  const toolchainLedger = parseLedger(
    ledgers.toolchain,
    "toolchain",
    workspaceRoot,
  );
  validateFormalProjectToolchainFile({
    policy,
    workspaceRoot,
    formalSourceBindings: specRecord.formalSourceBindings,
    sourceLedger,
  });
  validateExactToolchainLedger({ policy, ledger: toolchainLedger });
  validateToolchainBindings({
    policy,
    workspaceRoot,
    ledger: toolchainLedger,
    toolchainBindings: specRecord.toolchainBindings,
  });
  validateExecutables({
    policy,
    ledgerRoot: toolchainLedger.rootPath,
    executables: executor.executables,
  });
  validateEnvironment(policy, executor);

  return {
    status: NHM2_FORMAL_APPROVED_TOOLCHAIN_VERIFICATION_STATUS,
    policyId: policy.policyId,
    policySemanticSha256: policy.semanticSha256,
    target: { ...policy.target },
    releases: {
      lean: { ...policy.releases.lean },
      lake: { ...policy.releases.lake },
    },
    formalProjectToolchainFile: {
      ...policy.formalProjectToolchainFile,
    },
    toolchainLedger: {
      rootIndependent: true,
      aggregateSha256: policy.toolchainLedger.aggregateSha256,
      entryCount: policy.toolchainLedger.entryCount,
      aggregateBytes: policy.toolchainLedger.aggregateBytes,
    },
    executables: {
      lean: { ...policy.executables.lean },
      lake: { ...policy.executables.lake },
    },
    approvedEnvironmentAllowlist: [...policy.approvedEnvironment.allowlist],
    authorityBasis: {
      hostPlatformExact: true,
      hostArchitectureExact: true,
      formalProjectToolchainFileExact: true,
      fullToolchainLedgerExact: true,
      leanExecutableExact: true,
      lakeExecutableExact: true,
      toolchainBindingInventoryExact: true,
      environmentExact: true,
      callerSuppliedReleaseLabelsUsed: false,
    },
    blockers: [...NHM2_FORMAL_APPROVED_TOOLCHAIN_BLOCKERS],
    claimBoundary: { ...NHM2_FORMAL_APPROVED_TOOLCHAIN_CLAIM_BOUNDARY },
  };
}
