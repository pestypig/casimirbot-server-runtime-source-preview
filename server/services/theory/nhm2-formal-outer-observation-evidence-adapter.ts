import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1,
  Nhm2ExperimentReadyTheoryCandidateManifestV1,
} from "../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
  NHM2_FORMAL_KERNEL_EXECUTION_OBSERVATION_CONTRACT_VERSION,
  NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
  NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
  computeNhm2FormalKernelLedgerSha256,
  type Nhm2FormalKernelExecutionObservationV1,
  type Nhm2FormalKernelLedgerEntryV1,
  type Nhm2FormalKernelLedgerKind,
  type Nhm2FormalKernelOutputObservationV1,
} from "./nhm2-formal-kernel-executor";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
  type Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1,
  type Nhm2ExperimentReadyTheoryFormalRunSpecV1,
} from "../../../tools/nhm2/run-experiment-ready-theory-formal";

/**
 * This is the superseding formal_manifest_certificate evidence contract.  It
 * deliberately has no dependency on the legacy, self-authored replay-manifest
 * contract: its only proof authority is the outer-observed process artifact.
 */
export const NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ARTIFACT_ID =
  "nhm2.formal_manifest_certificate" as const;
export const NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION =
  "nhm2_formal_manifest_certificate/v2" as const;
export const NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ROLE =
  "formal_manifest_certificate" as const;
export const NHM2_FORMAL_OUTER_OBSERVATION_SUPERSEDED_CONTRACTS = [
  "nhm2_formal_manifest_certificate/v1",
  "nhm2_formal_kernel_replay_manifest/v1",
] as const;

export const NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS = [
  "outer_artifact_observation_exact",
  "trusted_candidate_and_plan_bindings_exact",
  "direct_lean_command_exact",
  "two_distinct_cold_replays_exact",
  "native_theorem_and_axiom_transcripts_exact",
  "sealed_source_toolchain_input_ledgers_stable",
  "replay_transcripts_and_outputs_identical",
  "fresh_output_inventory_exact",
  "pre_experimental_claim_locks_closed",
] as const;

export type Nhm2FormalOuterObservationCheckId =
  (typeof NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS)[number];
export type Nhm2FormalOuterObservationStatus = "pass" | "fail";

export type Nhm2FormalOuterObservationCandidateClaimBoundary =
  Nhm2ExperimentReadyTheoryCandidateManifestV1["claimBoundary"];

export type Nhm2FormalOuterObservationTrustedContextV2 = {
  candidate: {
    candidateId: string;
    candidateManifestId: string;
    candidateManifestPath: string;
    candidateManifestSha256: string;
    candidateManifestSizeBytes: number;
    candidateFrozenAt: string;
    claimBoundary: Nhm2FormalOuterObservationCandidateClaimBoundary;
  };
  formalPlan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
  formalRunSpec: {
    path: string;
    sha256: string;
    sizeBytes: number;
    value: Nhm2ExperimentReadyTheoryFormalRunSpecV1;
  };
};

export type Nhm2FormalOuterObservationEvidenceCheckV2 = {
  checkId: Nhm2FormalOuterObservationCheckId;
  status: Nhm2FormalOuterObservationStatus;
  blockers: string[];
};

export type Nhm2FormalOuterObservationEvidenceV2 = {
  artifactId: typeof NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ARTIFACT_ID;
  contractVersion: typeof NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION;
  evidenceRole: typeof NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ROLE;
  supersedesContractVersions: readonly [
    "nhm2_formal_manifest_certificate/v1",
    "nhm2_formal_kernel_replay_manifest/v1",
  ];
  generatedAt: string;
  status: Nhm2FormalOuterObservationStatus;
  diagnosticTier: "diagnostic";
  authority: "outer_observed_direct_lean_two_cold_replays";
  identity: {
    candidateId: string;
    candidateManifestId: string;
    candidateManifestSha256: string;
    requestId: string;
    runId: string;
    receiptId: string;
    runtimeId: string;
    sourceCommitSha: string;
  };
  formalClaim: {
    theoremName: typeof NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME;
    theoremResult: "proved" | "not_certified";
    nativeAxiomAudit: "no_axioms" | "not_certified";
    replayCount: number;
    replayTranscriptSha256: [string | null, string | null];
    replayOutputInventorySha256: [string | null, string | null];
    sourceLedgerSha256: string | null;
    toolchainLedgerSha256: string | null;
    inputLedgerSha256: string | null;
  };
  checks: Nhm2FormalOuterObservationEvidenceCheckV2[];
  blockers: string[];
  claimBoundary: {
    formalLogicReplayOnly: true;
    outerObservedExecutionOnly: true;
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

export type BuildNhm2FormalOuterObservationEvidenceInput = {
  executionArtifact: Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1;
  executionObservation: Nhm2FormalKernelExecutionObservationV1;
  trustedContext: Nhm2FormalOuterObservationTrustedContextV2;
};

const SHA256 = /^[a-f0-9]{64}$/;
const FRESHNESS_CLOCK_TOLERANCE_MS = 2_000;

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const utf8Compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const exact = (left: unknown, right: unknown): boolean =>
  isDeepStrictEqual(left, right);

const validTime = (value: string): boolean =>
  Number.isFinite(Date.parse(value));

const filesystemPathKey = (value: string): string => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const sameFilesystemPath = (left: string, right: string): boolean =>
  filesystemPathKey(left) === filesystemPathKey(right);

const isPortableRelativePath = (value: string): boolean =>
  value.length > 0 &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !path.posix.isAbsolute(value) &&
  value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );

const executableIsLedgerBound = (input: {
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
  ledgerRoot: string;
  ledgerEntries: readonly Nhm2FormalKernelLedgerEntryV1[];
}): boolean => {
  const relative = path
    .relative(path.resolve(input.ledgerRoot), path.resolve(input.absolutePath))
    .split(path.sep)
    .join("/");
  if (
    relative.length === 0 ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
    return false;
  }
  return input.ledgerEntries.some(
    (entry) =>
      entry.relativePath === relative &&
      entry.sha256 === input.sha256 &&
      entry.sizeBytes === input.sizeBytes,
  );
};

const outputInventorySha256 = (
  entries: readonly Nhm2FormalKernelOutputObservationV1[],
): string =>
  sha256(
    JSON.stringify({
      domain: "nhm2_formal_kernel_output_inventory/v1",
      entries: entries.map(({ relativePath, sha256: digest, sizeBytes }) => ({
        relativePath,
        sha256: digest,
        sizeBytes,
      })),
    }),
  );

const outerInventorySha256 = (
  entries: readonly { path: string; sha256: string; sizeBytes: number }[],
): string =>
  sha256(
    `nhm2_formal_outer_inventory/v1\0${JSON.stringify(
      entries.map((entry) => [entry.path, entry.sha256, entry.sizeBytes]),
    )}`,
  );

const transcriptAuthorityLines = (stdout: string, stderr: string): string[] =>
  `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith("NHM2_FORMAL_THEOREM ") ||
        line === NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
    );

const computeReplayTranscriptSha256 = (
  stdout: string,
  stderr: string,
): string =>
  sha256(
    JSON.stringify({
      domain: "nhm2_formal_outer_observed_transcript/v1",
      stdout,
      stderr,
    }),
  );

const processTranscriptExact = (
  replay: Nhm2FormalKernelExecutionObservationV1["replays"][number],
): boolean => {
  const process = replay.process;
  const stdoutBytes = Buffer.byteLength(process.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(process.stderr, "utf8");
  const expectedAuthorityLines = [
    NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
    NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
  ];
  const authorityLines = transcriptAuthorityLines(
    process.stdout,
    process.stderr,
  );
  return (
    authorityLines.length === expectedAuthorityLines.length &&
    expectedAuthorityLines.every(
      (marker) => authorityLines.filter((line) => line === marker).length === 1,
    ) &&
    process.stdoutBytes === stdoutBytes &&
    process.stderrBytes === stderrBytes &&
    process.stdoutSha256 === sha256(Buffer.from(process.stdout, "utf8")) &&
    process.stderrSha256 === sha256(Buffer.from(process.stderr, "utf8")) &&
    replay.transcript?.theoremMarker ===
      NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER &&
    replay.transcript?.axiomMarker ===
      NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER
  );
};

const processSucceeded = (
  replay: Nhm2FormalKernelExecutionObservationV1["replays"][number],
): boolean => {
  const process = replay.process;
  const started = Date.parse(process.startedAt);
  const completed = Date.parse(process.completedAt);
  return (
    validTime(process.startedAt) &&
    validTime(process.completedAt) &&
    completed >= started &&
    Number.isFinite(process.durationMs) &&
    process.durationMs >= 0 &&
    process.exitCode === 0 &&
    process.signal === null &&
    process.spawnError === null &&
    process.timedOut === false &&
    process.outputLimitExceeded === false
  );
};

const expectedCandidateClaimBoundary: Nhm2FormalOuterObservationCandidateClaimBoundary =
  {
    preRunManifestOnly: true,
    evaluatorMustVerifyFrozenAtBeforeExecutionStart: true,
    evaluatorMustResolveCandidateManifestRawShaBeforeSpawn: true,
    postRunTimingAndArtifactHashesForbiddenHere: true,
    detachedPolicyArtifactMustValidate: true,
    manifestReadinessCannotEstablishTheoryClosure: true,
    experimentReadyTheoryClosureClaimAllowed: false,
    physicalViabilityStatus: "blocked_pending_empirical_receipts",
    physicalViabilityClaimAllowed: false,
    transportClaimAllowed: false,
    propulsionClaimAllowed: false,
    routeEtaClaimAllowed: false,
    speedAuthorityClaimAllowed: false,
    empiricalReceiptsRequiredForPhysicalPromotion: true,
  };

const expectedFormalClaimBoundary = {
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

const expectedObservationClaimBoundary = {
  formalLogicReplayOnly: true,
  numericalPhysicsValidated: false,
  empiricalValidationEstablished: false,
  physicalViabilityClaimAllowed: false,
  transportClaimAllowed: false,
  propulsionClaimAllowed: false,
  routeEtaClaimAllowed: false,
  speedAuthorityClaimAllowed: false,
  operatingSystemHermeticityAsserted: false,
  filesystemSandboxAsserted: false,
} as const;

const checkLedger = (input: {
  kind: Nhm2FormalKernelLedgerKind;
  observation: Nhm2FormalKernelExecutionObservationV1;
  spec: Nhm2ExperimentReadyTheoryFormalRunSpecV1;
}): boolean => {
  const expected = input.spec.executor.ledgers[input.kind];
  const pre = input.observation.preRunLedgers?.[input.kind];
  if (pre == null) return false;
  const expectedDigest = computeNhm2FormalKernelLedgerSha256({
    kind: input.kind,
    entries: expected.entries,
  });
  const preExact =
    expected.kind === input.kind &&
    expected.ledgerSha256 === expectedDigest &&
    pre.kind === input.kind &&
    pre.entryCount === expected.entries.length &&
    pre.ledgerSha256 === expectedDigest &&
    exact(pre.entries, expected.entries);
  if (!preExact) return false;
  return input.observation.replays.every((replay) => {
    const post = replay.postRunLedgers?.[input.kind];
    return (
      post != null &&
      post.kind === input.kind &&
      post.entryCount === expected.entries.length &&
      post.ledgerSha256 === expectedDigest &&
      exact(post.entries, expected.entries)
    );
  });
};

const replayOutputsFreshAndExact = (input: {
  replay: Nhm2FormalKernelExecutionObservationV1["replays"][number];
  expectedOutputPaths: readonly string[];
}): boolean => {
  const { replay } = input;
  if (
    !exact(
      replay.outputs.map((entry) => entry.relativePath),
      input.expectedOutputPaths,
    ) ||
    replay.outputs.length === 0 ||
    replay.outputs.some(
      (entry) =>
        entry.freshness !== "new" ||
        !SHA256.test(entry.sha256) ||
        !Number.isSafeInteger(entry.sizeBytes) ||
        entry.sizeBytes <= 0 ||
        !validTime(entry.modifiedAt),
    )
  ) {
    return false;
  }
  const started = Date.parse(replay.process.startedAt);
  const completed = Date.parse(replay.process.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return false;
  if (
    replay.outputs.some((entry) => {
      const modified = Date.parse(entry.modifiedAt);
      return (
        modified < started - FRESHNESS_CLOCK_TOLERANCE_MS ||
        modified > completed + FRESHNESS_CLOCK_TOLERANCE_MS
      );
    })
  ) {
    return false;
  }
  return replay.outputInventorySha256 === outputInventorySha256(replay.outputs);
};

const check = (
  checkId: Nhm2FormalOuterObservationCheckId,
  passed: boolean,
  blocker: string,
): Nhm2FormalOuterObservationEvidenceCheckV2 => ({
  checkId,
  status: passed ? "pass" : "fail",
  blockers: passed ? [] : [blocker],
});

/**
 * Derives a diagnostic certificate from an already outer-observed execution.
 * This function never executes Lean and never accepts child-authored proof
 * receipts. The trusted context must come from the server-side candidate/run
 * admission path that read the frozen candidate and formal run spec.
 */
export function buildNhm2FormalOuterObservationEvidence(
  input: BuildNhm2FormalOuterObservationEvidenceInput,
): Nhm2FormalOuterObservationEvidenceV2 {
  const artifact = input.executionArtifact;
  const observation = input.executionObservation;
  const trusted = input.trustedContext;
  const spec = trusted.formalRunSpec.value;
  const plan = trusted.formalPlan;
  const candidate = trusted.candidate;

  const outerContractsExact =
    artifact.artifactId ===
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID &&
    artifact.contractVersion ===
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION &&
    artifact.generatedAt === observation.generatedAt &&
    artifact.planRole === "formal_kernel" &&
    artifact.theoremName === NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME &&
    observation.artifactId === "nhm2.formal_kernel_execution_observation" &&
    observation.contractVersion ===
      NHM2_FORMAL_KERNEL_EXECUTION_OBSERVATION_CONTRACT_VERSION &&
    observation.status === "pass" &&
    observation.theoremName === NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME &&
    exact(artifact.executionObservation, observation);

  const specBytes = Buffer.from(JSON.stringify(spec), "utf8");
  const expectedIdentity = {
    candidateId: candidate.candidateId,
    candidateManifestId: candidate.candidateManifestId,
    candidateManifestSha256: candidate.candidateManifestSha256,
    candidateFrozenAt: candidate.candidateFrozenAt,
    requestId: plan.requestId,
    runId: plan.runId,
    receiptId: plan.receiptId,
    runtimeId: plan.runtimeId,
    sourceCommitSha: plan.sourceCommitSha,
  };
  const bindingsExact =
    plan.planRole === "formal_kernel" &&
    spec.artifactId ===
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID &&
    spec.contractVersion ===
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION &&
    spec.theoremName === NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME &&
    spec.executor.theoremName === NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME &&
    exact(spec.identity, expectedIdentity) &&
    exact(spec.planBinding, plan) &&
    exact(artifact.identity, expectedIdentity) &&
    artifact.inputs.candidateManifest.path ===
      candidate.candidateManifestPath &&
    artifact.inputs.candidateManifest.sha256 ===
      candidate.candidateManifestSha256 &&
    artifact.inputs.candidateManifest.sizeBytes ===
      candidate.candidateManifestSizeBytes &&
    artifact.inputs.formalRunSpec.path === trusted.formalRunSpec.path &&
    artifact.inputs.formalRunSpec.sha256 === trusted.formalRunSpec.sha256 &&
    artifact.inputs.formalRunSpec.sizeBytes ===
      trusted.formalRunSpec.sizeBytes &&
    trusted.formalRunSpec.sha256 === sha256(specBytes) &&
    trusted.formalRunSpec.sizeBytes === specBytes.byteLength &&
    SHA256.test(candidate.candidateManifestSha256) &&
    Number.isSafeInteger(candidate.candidateManifestSizeBytes) &&
    candidate.candidateManifestSizeBytes > 0 &&
    validTime(candidate.candidateFrozenAt) &&
    validTime(spec.sealedAt) &&
    Date.parse(spec.sealedAt) >= Date.parse(candidate.candidateFrozenAt);

  const replayArray = Array.isArray(observation.replays)
    ? observation.replays
    : [];
  const hasTwoReplays = replayArray.length === 2;
  const replays = hasTwoReplays
    ? (replayArray as Nhm2FormalKernelExecutionObservationV1["replays"])
    : null;
  const workdirs = spec.executor.replayWorkdirs;
  const distinctWorkdirs =
    Array.isArray(workdirs) &&
    workdirs.length === 2 &&
    !sameFilesystemPath(workdirs[0], workdirs[1]);

  const directLeanExact =
    spec.executor.executableRole === "lean" &&
    observation.executableRole === "lean" &&
    !sameFilesystemPath(
      spec.executor.executables.lean.absolutePath,
      spec.executor.executables.lake.absolutePath,
    ) &&
    executableIsLedgerBound({
      ...spec.executor.executables.lean,
      ledgerRoot: spec.executor.ledgers.toolchain.rootPath,
      ledgerEntries: spec.executor.ledgers.toolchain.entries,
    }) &&
    exact(observation.executables, spec.executor.executables) &&
    spec.executor.executableArguments.length === 3 &&
    path.isAbsolute(spec.executor.executableArguments[0]) &&
    spec.executor.executableArguments[1] === "-o" &&
    spec.executor.expectedOutputPaths.length === 1 &&
    isPortableRelativePath(spec.executor.expectedOutputPaths[0]) &&
    spec.executor.executableArguments[2] ===
      spec.executor.expectedOutputPaths[0] &&
    (replays?.every(
      (replay) =>
        replay.executableRole === "lean" &&
        replay.process.executableRole === "lean" &&
        replay.process.command ===
          spec.executor.executables.lean.absolutePath &&
        exact(replay.process.args, spec.executor.executableArguments) &&
        exact(replay.process.environment, spec.executor.environment),
    ) ??
      false);

  const twoReplaysExact =
    replays != null &&
    distinctWorkdirs &&
    replays[0].replayIndex === 1 &&
    replays[1].replayIndex === 2 &&
    replays[0].process.cwd === workdirs[0] &&
    replays[1].process.cwd === workdirs[1] &&
    !sameFilesystemPath(replays[0].process.cwd, replays[1].process.cwd) &&
    replays.every(processSucceeded) &&
    Date.parse(replays[1].process.startedAt) >=
      Date.parse(replays[0].process.completedAt) &&
    validTime(observation.generatedAt) &&
    Date.parse(observation.generatedAt) >=
      Date.parse(replays[1].process.completedAt) &&
    replays.every(
      (replay) =>
        Date.parse(replay.process.startedAt) >= Date.parse(spec.sealedAt),
    );

  const transcriptsExact =
    replays != null &&
    replays.every(processTranscriptExact) &&
    replays[0].process.stdout === replays[1].process.stdout &&
    replays[0].process.stderr === replays[1].process.stderr &&
    replays[0].process.stdoutSha256 === replays[1].process.stdoutSha256 &&
    replays[0].process.stderrSha256 === replays[1].process.stderrSha256;

  const ledgersExact =
    replays != null &&
    (["source", "toolchain", "input"] as const).every((kind) =>
      checkLedger({ kind, observation, spec }),
    );

  const replayAgreementExact = exact(observation.replayAgreement, {
    executableRolesExact: true,
    commandsExact: true,
    environmentsExact: true,
    transcriptsExact: true,
    outputInventoriesExact: true,
    sealedLedgersStable: true,
  });
  const identicalOutputs =
    replays != null &&
    exact(
      replays[0].outputs.map(({ relativePath, sha256: digest, sizeBytes }) => ({
        relativePath,
        sha256: digest,
        sizeBytes,
      })),
      replays[1].outputs.map(({ relativePath, sha256: digest, sizeBytes }) => ({
        relativePath,
        sha256: digest,
        sizeBytes,
      })),
    ) &&
    replays[0].outputInventorySha256 === replays[1].outputInventorySha256;

  const freshReplayOutputs =
    replays != null &&
    replays.every((replay) =>
      replayOutputsFreshAndExact({
        replay,
        expectedOutputPaths: spec.executor.expectedOutputPaths,
      }),
    );
  const expectedOuterEntries =
    replays == null
      ? []
      : replays
          .flatMap((replay, index) =>
            replay.outputs.map((entry) => ({
              path: `${path.basename(workdirs[index])}/${entry.relativePath}`,
              sha256: entry.sha256,
              sizeBytes: entry.sizeBytes,
            })),
          )
          .sort((left, right) => utf8Compare(left.path, right.path));
  const outerInventoryExact =
    artifact.replayOutputInventory.algorithm ===
      "sha256_canonical_tuple_list/v1" &&
    exact(artifact.replayOutputInventory.entries, expectedOuterEntries) &&
    artifact.replayOutputInventory.inventorySha256 ===
      outerInventorySha256(expectedOuterEntries);

  const claimLocksClosed =
    exact(candidate.claimBoundary, expectedCandidateClaimBoundary) &&
    exact(spec.claimBoundary, expectedFormalClaimBoundary) &&
    exact(artifact.claimBoundary, expectedFormalClaimBoundary) &&
    exact(observation.claimBoundary, expectedObservationClaimBoundary);

  const checks = [
    check(
      "outer_artifact_observation_exact",
      outerContractsExact,
      "formal_outer_artifact_or_observation_contract_mismatch",
    ),
    check(
      "trusted_candidate_and_plan_bindings_exact",
      bindingsExact,
      "formal_candidate_run_request_receipt_runtime_or_plan_binding_mismatch",
    ),
    check(
      "direct_lean_command_exact",
      directLeanExact,
      "formal_direct_lean_role_or_command_mismatch",
    ),
    check(
      "two_distinct_cold_replays_exact",
      twoReplaysExact,
      "formal_two_distinct_cold_replays_missing_or_failed",
    ),
    check(
      "native_theorem_and_axiom_transcripts_exact",
      transcriptsExact,
      "formal_native_theorem_or_no_axiom_transcript_mismatch",
    ),
    check(
      "sealed_source_toolchain_input_ledgers_stable",
      ledgersExact,
      "formal_sealed_source_toolchain_or_input_ledger_mismatch",
    ),
    check(
      "replay_transcripts_and_outputs_identical",
      transcriptsExact && identicalOutputs && replayAgreementExact,
      "formal_cold_replay_agreement_mismatch",
    ),
    check(
      "fresh_output_inventory_exact",
      freshReplayOutputs && outerInventoryExact,
      "formal_fresh_output_inventory_mismatch",
    ),
    check(
      "pre_experimental_claim_locks_closed",
      claimLocksClosed,
      "formal_or_physical_claim_lock_opened",
    ),
  ] satisfies Nhm2FormalOuterObservationEvidenceCheckV2[];

  const blockers = checks.flatMap((entry) => entry.blockers);
  const status: Nhm2FormalOuterObservationStatus =
    blockers.length === 0 ? "pass" : "fail";
  const replayTranscriptSha256: [string | null, string | null] = [
    replays == null
      ? null
      : computeReplayTranscriptSha256(
          replays[0].process.stdout,
          replays[0].process.stderr,
        ),
    replays == null
      ? null
      : computeReplayTranscriptSha256(
          replays[1].process.stdout,
          replays[1].process.stderr,
        ),
  ];
  const replayOutputInventoryDigests: [string | null, string | null] = [
    replays?.[0]?.outputInventorySha256 ?? null,
    replays?.[1]?.outputInventorySha256 ?? null,
  ];

  return {
    artifactId: NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ARTIFACT_ID,
    contractVersion: NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION,
    evidenceRole: NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_ROLE,
    supersedesContractVersions:
      NHM2_FORMAL_OUTER_OBSERVATION_SUPERSEDED_CONTRACTS,
    generatedAt: observation.generatedAt,
    status,
    diagnosticTier: "diagnostic",
    authority: "outer_observed_direct_lean_two_cold_replays",
    identity: {
      candidateId: candidate.candidateId,
      candidateManifestId: candidate.candidateManifestId,
      candidateManifestSha256: candidate.candidateManifestSha256,
      requestId: plan.requestId,
      runId: plan.runId,
      receiptId: plan.receiptId,
      runtimeId: plan.runtimeId,
      sourceCommitSha: plan.sourceCommitSha,
    },
    formalClaim: {
      theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
      theoremResult: status === "pass" ? "proved" : "not_certified",
      nativeAxiomAudit: status === "pass" ? "no_axioms" : "not_certified",
      replayCount: replayArray.length,
      replayTranscriptSha256,
      replayOutputInventorySha256: replayOutputInventoryDigests,
      sourceLedgerSha256:
        observation.preRunLedgers?.source?.ledgerSha256 ?? null,
      toolchainLedgerSha256:
        observation.preRunLedgers?.toolchain?.ledgerSha256 ?? null,
      inputLedgerSha256: observation.preRunLedgers?.input?.ledgerSha256 ?? null,
    },
    checks,
    blockers,
    claimBoundary: {
      formalLogicReplayOnly: true,
      outerObservedExecutionOnly: true,
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
