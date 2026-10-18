import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  computeNhm2ExperimentReadyTheoryCandidateNonNumericCheckPolicySha256,
  computeNhm2ExperimentReadyTheoryCandidateNumericPolicyEntrySha256,
  isNhm2ExperimentReadyTheoryCandidateManifest,
  isNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact,
  nhm2ExperimentReadyTheoryFormalRunSpecPath,
  type Nhm2ExperimentReadyTheoryCandidateHashedBindingV1,
  type Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1,
  type Nhm2ExperimentReadyTheoryCandidateManifestV1,
  type Nhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifactV1,
} from "../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS,
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_NUMERIC_CHECK_POLICIES,
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS,
  isNhm2ExperimentReadyTheoryClosureArtifact,
  type Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1,
  type Nhm2ExperimentReadyTheoryClosureArtifactV1,
  type Nhm2ExperimentReadyTheoryClosureEvidenceId,
  type Nhm2ExperimentReadyTheoryClosureEvidenceV1,
} from "../../../shared/contracts/nhm2-experiment-ready-theory-closure.v1";
import { isNhm2PredictionFalsifierFreeze } from "../../../shared/contracts/nhm2-prediction-falsifier-freeze.v1";
import { isNhm2SemiclassicalStateRealizabilityV2 as isNhm2SemiclassicalStateRealizability } from "../../../shared/contracts/nhm2-semiclassical-state-realizability.v2";
import { isNhm2ContinuousObserverOptimizer } from "../../../shared/contracts/nhm2-continuous-observer-optimizer.v1";
import { isNhm2WorldlineQeiCoverage } from "../../../shared/contracts/nhm2-worldline-qei-coverage.v1";
import { isNhm2CovariantConservation } from "../../../shared/contracts/nhm2-covariant-conservation.v1";
import { isNhm2DynamicBackreactionStabilityCausality } from "../../../shared/contracts/nhm2-dynamic-backreaction-stability-causality.v1";
import { isNhm2FullApparatusSourceTensor } from "../../../shared/contracts/nhm2-full-apparatus-source-tensor.v1";
import { isCasimirFiniteTemperatureFiniteGeometryMaxwellStress } from "../../../shared/contracts/casimir-finite-temperature-finite-geometry-maxwell-stress.v1";
import { isNhm2MechanicalSupportControlMargin } from "../../../shared/contracts/nhm2-mechanical-support-control-margin.v1";
import {
  NHM2_INDEPENDENT_NUMERICAL_REPLICATION_SERVER_REPLAY_BLOCKERS,
  isNhm2IndependentNumericalReplication,
} from "../../../shared/contracts/nhm2-independent-numerical-replication.v1";
import type { Nhm2FormalManifestCertificateV1 } from "../../../shared/contracts/nhm2-formal-manifest-certificate.v1";
import {
  NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_THEOREM_ID,
  isNhm2FormalKernelReplayManifest,
  verifyNhm2FormalKernelReplayManifest,
  type Nhm2FormalKernelReplayArtifactRefV1,
  type Nhm2FormalKernelReplayIdentityV1,
  type Nhm2FormalKernelReplayManifestV1,
} from "../../../shared/contracts/nhm2-formal-kernel-replay-manifest.v1";
import type { TheoryRuntimeReceiptV1 } from "../../../shared/contracts/theory-runtime-receipt.v1";
import {
  verifyTheoryRuntimeReceiptFilesystem,
  type TheoryRuntimeReceiptFilesystemVerificationV1,
  type VerifiedTheoryRuntimeFileV1,
} from "./theory-runtime-receipt-filesystem-verifier";
import {
  verifyNhm2EvidenceNestedReferences,
  type Nhm2EvidenceNestedReferenceRunIdentity,
  type Nhm2EvidenceNestedReferenceVerifiedPriorRunOutput,
} from "./nhm2-evidence-nested-reference-verifier";
import {
  NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS,
  NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION,
  buildNhm2FormalOuterObservationEvidence,
  type Nhm2FormalOuterObservationEvidenceV2,
  type Nhm2FormalOuterObservationTrustedContextV2,
} from "./nhm2-formal-outer-observation-evidence-adapter";
import { computeNhm2FormalKernelLedgerSha256 } from "./nhm2-formal-kernel-executor";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_REQUIRED_SOURCE_ROLES,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
  type Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1,
  type Nhm2ExperimentReadyTheoryFormalRunSpecV1,
} from "../../../tools/nhm2/run-experiment-ready-theory-formal";

const execFileAsync = promisify(execFile);
const PERSISTED_RECEIPT_PATH =
  /^artifacts\/research\/theory-runtime-receipts\/receipt-[A-Za-z0-9_-]{43}\.v1\.json$/;
const FORMAL_V2_MAX_RUN_SPEC_BYTES = 64 * 1024 * 1024;
const FORMAL_V2_MAX_OUTER_ARTIFACT_BYTES = 256 * 1024 * 1024;
const FORMAL_V2_MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const FORMAL_V2_MAX_REPLAY_OUTPUT_BYTES = 512 * 1024 * 1024;
const FORMAL_V2_FRESHNESS_CLOCK_TOLERANCE_MS = 2_000;

export type Nhm2TheoryClosureFilesystemEvaluationV1 = {
  status: "not_ready" | "falsified" | "experiment_ready_theory_closed";
  gateStatus: "not_ready" | "fail" | "pass";
  filesystemVerified: boolean;
  candidateManifestValidated: boolean;
  evidenceAdapterCoverageComplete: boolean;
  blockers: string[];
  artifactPath: string;
};

type BoundFile = {
  repoPath: string;
  absolutePath: string;
  sha256: string;
  bytes: Buffer;
};

type BoundJsonFile = BoundFile & {
  data: unknown;
};

export type Nhm2FormalKernelReplayEvaluatorContextV1 = {
  manifestArtifact: Nhm2FormalKernelReplayArtifactRefV1;
  identity: Nhm2FormalKernelReplayIdentityV1;
  preRunSources: Nhm2FormalKernelReplayArtifactRefV1[];
  requiredPreRunSources: Nhm2FormalKernelReplayArtifactRefV1[];
  kernel: Nhm2FormalKernelReplayManifestV1["kernel"];
  preRunSourceLedger: Nhm2FormalKernelReplayArtifactRefV1;
  theoremReplayLedger: Nhm2FormalKernelReplayArtifactRefV1;
  usedAxiomLedger: Nhm2FormalKernelReplayArtifactRefV1;
  usedAssumptionLedger: Nhm2FormalKernelReplayArtifactRefV1;
  aggregateReplayTranscript: Nhm2FormalKernelReplayArtifactRefV1;
  claimLockProof: Nhm2FormalKernelReplayArtifactRefV1;
  claimLockTranscript: Nhm2FormalKernelReplayArtifactRefV1;
  receiptInterval: {
    startedAt: string | null;
    completedAt: string | null;
  };
};

export type Nhm2FormalKernelReplayFilesystemVerificationV1 = {
  valid: boolean;
  manifestParsed: boolean;
  expectedBindingsValid: boolean;
  referencedArtifactBytesVerified: boolean;
  invokedLean: false;
  blockers: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const unique = (values: string[]): string[] => Array.from(new Set(values));

const normalizeRepoPath = (value: string): string =>
  value.replace(/\\/g, "/").replace(/^\.\//, "");

const withoutFragment = (value: string): string => value.split("#", 1)[0];

const normalizeSha256 = (value: string): string =>
  value.toLowerCase().replace(/^sha256:/, "");

const isSha256 = (value: string): boolean =>
  /^[a-f0-9]{64}$/i.test(normalizeSha256(value));

const isPortableRepoPath = (value: string): boolean =>
  value.length > 0 &&
  !value.includes("\\") &&
  !path.posix.isAbsolute(value) &&
  !path.win32.isAbsolute(value) &&
  !value.split("/").includes("..") &&
  !/(^|\/)latest(?:\.|\/|$)/i.test(value);

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]),
  );
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(stable(left)) === JSON.stringify(stable(right));

async function readBoundJsonFile(input: {
  projectRoot: string;
  repoPath: string;
  expectedSha256?: string;
  maxBytes?: number;
}): Promise<{ file: BoundJsonFile | null; blocker: string | null }> {
  if (!isPortableRepoPath(input.repoPath)) {
    return { file: null, blocker: `path_not_pinned:${input.repoPath}` };
  }
  const absolutePath = path.resolve(input.projectRoot, input.repoPath);
  if (!isInside(input.projectRoot, absolutePath)) {
    return { file: null, blocker: `path_outside_project:${input.repoPath}` };
  }
  try {
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink())
      return { file: null, blocker: `symlink_forbidden:${input.repoPath}` };
    if (!stat.isFile())
      return { file: null, blocker: `regular_file_required:${input.repoPath}` };
    if (input.maxBytes != null && stat.size > input.maxBytes) {
      return {
        file: null,
        blocker: `resource_limit_exceeded:${input.repoPath}`,
      };
    }
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(input.projectRoot),
      fs.realpath(absolutePath),
    ]);
    if (!isInside(realRoot, realFile)) {
      return { file: null, blocker: `realpath_escape:${input.repoPath}` };
    }
    const handle = await fs.open(absolutePath, "r");
    let bytes: Buffer;
    try {
      const beforeStat = await handle.stat();
      bytes = await handle.readFile();
      const afterStat = await handle.stat();
      if (
        beforeStat.size !== afterStat.size ||
        beforeStat.mtimeMs !== afterStat.mtimeMs
      ) {
        return {
          file: null,
          blocker: `file_changed_while_reading:${input.repoPath}`,
        };
      }
      if (input.maxBytes != null && bytes.byteLength > input.maxBytes) {
        return {
          file: null,
          blocker: `resource_limit_exceeded:${input.repoPath}`,
        };
      }
    } finally {
      await handle.close();
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      input.expectedSha256 != null &&
      sha256 !== normalizeSha256(input.expectedSha256)
    ) {
      return { file: null, blocker: `sha256_mismatch:${input.repoPath}` };
    }
    return {
      file: {
        repoPath: normalizeRepoPath(input.repoPath),
        absolutePath,
        sha256,
        bytes,
        data: JSON.parse(bytes.toString("utf8")) as unknown,
      },
      blocker: null,
    };
  } catch (error) {
    return {
      file: null,
      blocker: `file_unreadable:${input.repoPath}:${(error as NodeJS.ErrnoException).code ?? "invalid_json"}`,
    };
  }
}

async function readBoundBytesFile(input: {
  projectRoot: string;
  repoPath: string;
  expectedSha256: string;
}): Promise<{ file: BoundFile | null; blocker: string | null }> {
  if (!isPortableRepoPath(input.repoPath)) {
    return { file: null, blocker: `path_not_pinned:${input.repoPath}` };
  }
  const absolutePath = path.resolve(input.projectRoot, input.repoPath);
  if (!isInside(input.projectRoot, absolutePath)) {
    return { file: null, blocker: `path_outside_project:${input.repoPath}` };
  }
  try {
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      return { file: null, blocker: `symlink_forbidden:${input.repoPath}` };
    }
    if (!stat.isFile()) {
      return { file: null, blocker: `regular_file_required:${input.repoPath}` };
    }
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(input.projectRoot),
      fs.realpath(absolutePath),
    ]);
    if (!isInside(realRoot, realFile)) {
      return { file: null, blocker: `realpath_escape:${input.repoPath}` };
    }
    const handle = await fs.open(absolutePath, "r");
    let bytes: Buffer;
    try {
      const beforeStat = await handle.stat();
      bytes = await handle.readFile();
      const afterStat = await handle.stat();
      if (
        beforeStat.size !== afterStat.size ||
        beforeStat.mtimeMs !== afterStat.mtimeMs
      ) {
        return {
          file: null,
          blocker: `file_changed_while_reading:${input.repoPath}`,
        };
      }
    } finally {
      await handle.close();
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== normalizeSha256(input.expectedSha256)) {
      return { file: null, blocker: `sha256_mismatch:${input.repoPath}` };
    }
    return {
      file: {
        repoPath: normalizeRepoPath(input.repoPath),
        absolutePath,
        sha256,
        bytes,
      },
      blocker: null,
    };
  } catch (error) {
    return {
      file: null,
      blocker: `file_unreadable:${input.repoPath}:${(error as NodeJS.ErrnoException).code ?? "unknown"}`,
    };
  }
}

const sameFormalReplayArtifact = (
  left: Nhm2FormalKernelReplayArtifactRefV1,
  right: Nhm2FormalKernelReplayArtifactRefV1,
): boolean =>
  normalizeRepoPath(left.path) === normalizeRepoPath(right.path) &&
  normalizeSha256(left.sha256) === normalizeSha256(right.sha256);

/**
 * Replays the formal manifest contract against exact filesystem bytes. This
 * verifier deliberately never launches Lean: process execution belongs to the
 * formal runtime receipt, while this pass checks its frozen inputs, ledgers,
 * proof outputs, transcript outputs, and false claim-lock theorem bindings.
 */
export async function verifyNhm2FormalKernelReplayFilesystem(input: {
  projectRoot: string;
  context: Nhm2FormalKernelReplayEvaluatorContextV1;
}): Promise<Nhm2FormalKernelReplayFilesystemVerificationV1> {
  const blockers: string[] = [];
  const manifestRead = await readBoundJsonFile({
    projectRoot: input.projectRoot,
    repoPath: input.context.manifestArtifact.path,
    expectedSha256: input.context.manifestArtifact.sha256,
  });
  if (manifestRead.blocker != null || manifestRead.file == null) {
    return {
      valid: false,
      manifestParsed: false,
      expectedBindingsValid: false,
      referencedArtifactBytesVerified: false,
      invokedLean: false,
      blockers: [
        `formal_replay_manifest:${manifestRead.blocker ?? "unreadable"}`,
      ],
    };
  }
  if (!isNhm2FormalKernelReplayManifest(manifestRead.file.data)) {
    return {
      valid: false,
      manifestParsed: false,
      expectedBindingsValid: false,
      referencedArtifactBytesVerified: false,
      invokedLean: false,
      blockers: ["formal_replay_manifest_schema_invalid"],
    };
  }
  const manifest = manifestRead.file.data;
  const receiptStartedMs = Date.parse(
    input.context.receiptInterval.startedAt ?? "",
  );
  const receiptCompletedMs = Date.parse(
    input.context.receiptInterval.completedAt ?? "",
  );
  const replayGeneratedMs = Date.parse(manifest.generatedAt);
  if (
    !Number.isFinite(receiptStartedMs) ||
    !Number.isFinite(receiptCompletedMs) ||
    !Number.isFinite(replayGeneratedMs) ||
    replayGeneratedMs < receiptStartedMs ||
    replayGeneratedMs > receiptCompletedMs
  ) {
    blockers.push("formal_replay_generated_at_outside_receipt_interval");
  }

  for (const required of input.context.requiredPreRunSources) {
    if (
      !manifest.preRunSourceCommitment.entries.some((entry) =>
        sameFormalReplayArtifact(entry, required),
      )
    ) {
      blockers.push(
        `formal_replay_required_pre_run_source_missing:${required.path}`,
      );
    }
  }

  const bytesByPath = new Map<string, Buffer>();
  bytesByPath.set(
    normalizeRepoPath(input.context.manifestArtifact.path),
    manifestRead.file.bytes,
  );
  const expectedHashByPath = new Map<string, string>();
  expectedHashByPath.set(
    normalizeRepoPath(input.context.manifestArtifact.path),
    normalizeSha256(input.context.manifestArtifact.sha256),
  );
  for (const reference of collectHashedRefs(manifest)) {
    const repoPath = normalizeRepoPath(reference.path);
    const expectedSha256 = normalizeSha256(reference.sha256);
    const priorHash = expectedHashByPath.get(repoPath);
    if (priorHash != null && priorHash !== expectedSha256) {
      blockers.push(`formal_replay_reference_hash_conflict:${repoPath}`);
      continue;
    }
    expectedHashByPath.set(repoPath, expectedSha256);
    if (bytesByPath.has(repoPath)) continue;
    const read = await readBoundBytesFile({
      projectRoot: input.projectRoot,
      repoPath,
      expectedSha256,
    });
    if (read.blocker != null || read.file == null) {
      blockers.push(
        `formal_replay_reference:${read.blocker ?? `unreadable:${repoPath}`}`,
      );
    } else {
      bytesByPath.set(repoPath, read.file.bytes);
    }
  }

  const contractVerification = verifyNhm2FormalKernelReplayManifest({
    manifest,
    expected: {
      manifestArtifact: input.context.manifestArtifact,
      identity: input.context.identity,
      preRunSources: input.context.preRunSources,
      kernel: input.context.kernel,
      // The manifest contract validates the exact sorted theorem and
      // dependency ledgers; the enclosing certificate independently binds
      // their artifacts and the claim-lock theorem below.
      theorems: manifest.theoremReplay.entries,
      usedAxioms: manifest.dependencyLedgers.usedAxioms,
      usedAssumptions: manifest.dependencyLedgers.usedAssumptions,
    },
    readArtifact: (repoPath) => bytesByPath.get(normalizeRepoPath(repoPath)),
  });
  blockers.push(
    ...contractVerification.blockers.map(
      (blocker) => `formal_replay_contract:${blocker}`,
    ),
  );

  const exactArtifactBindings: Array<
    [
      Nhm2FormalKernelReplayArtifactRefV1,
      Nhm2FormalKernelReplayArtifactRefV1,
      string,
    ]
  > = [
    [
      manifest.preRunSourceCommitment.ledgerArtifact,
      input.context.preRunSourceLedger,
      "source_ledger",
    ],
    [
      manifest.theoremReplay.ledgerArtifact,
      input.context.theoremReplayLedger,
      "theorem_ledger",
    ],
    [
      manifest.dependencyLedgers.usedAxiomLedgerArtifact,
      input.context.usedAxiomLedger,
      "used_axiom_ledger",
    ],
    [
      manifest.dependencyLedgers.usedAssumptionLedgerArtifact,
      input.context.usedAssumptionLedger,
      "used_assumption_ledger",
    ],
    [
      manifest.replay.aggregateTranscript,
      input.context.aggregateReplayTranscript,
      "aggregate_transcript",
    ],
  ];
  for (const [actual, expected, label] of exactArtifactBindings) {
    if (!sameFormalReplayArtifact(actual, expected)) {
      blockers.push(`formal_replay_certificate_${label}_binding_mismatch`);
    }
  }
  const claimLockTheorem = manifest.theoremReplay.entries.find(
    (entry) =>
      entry.theoremId ===
      NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_THEOREM_ID,
  );
  if (claimLockTheorem == null) {
    blockers.push("formal_replay_claim_lock_theorem_missing");
  } else {
    if (
      !sameFormalReplayArtifact(
        claimLockTheorem.proofArtifact,
        input.context.claimLockProof,
      )
    ) {
      blockers.push("formal_replay_certificate_claim_lock_proof_mismatch");
    }
    if (
      !sameFormalReplayArtifact(
        claimLockTheorem.transcriptArtifact,
        input.context.claimLockTranscript,
      )
    ) {
      blockers.push("formal_replay_certificate_claim_lock_transcript_mismatch");
    }
  }

  const uniqueBlockers = unique(blockers);
  return {
    valid: uniqueBlockers.length === 0,
    manifestParsed: true,
    expectedBindingsValid:
      contractVerification.expectedBindingsValid &&
      !uniqueBlockers.some(
        (blocker) =>
          blocker.startsWith("formal_replay_certificate_") ||
          blocker.includes("required_pre_run_source_missing") ||
          blocker.includes("generated_at_outside_receipt_interval"),
      ),
    referencedArtifactBytesVerified:
      contractVerification.artifactContentValid &&
      !uniqueBlockers.some(
        (blocker) =>
          blocker.startsWith("formal_replay_reference:") ||
          blocker.startsWith("formal_replay_reference_hash_conflict:"),
      ),
    invokedLean: false,
    blockers: uniqueBlockers,
  };
}

function collectHashedRefs(
  value: unknown,
): Array<{ path: string; sha256: string }> {
  const refs: Array<{ path: string; sha256: string }> = [];
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!isRecord(entry)) return;
    const refPath =
      typeof entry.ref === "string"
        ? entry.ref
        : typeof entry.path === "string"
          ? entry.path
          : null;
    if (
      refPath != null &&
      typeof entry.sha256 === "string" &&
      isSha256(entry.sha256)
    ) {
      refs.push({
        path: withoutFragment(refPath),
        sha256: normalizeSha256(entry.sha256),
      });
    }
    Object.values(entry).forEach(visit);
  };
  visit(value);
  return refs;
}

async function verifyPreRunReferenceClosure(input: {
  projectRoot: string;
  seeds: BoundJsonFile[];
  explicitRefs?: Array<{ path: string; sha256: string }>;
}): Promise<{ verified: Map<string, string>; blockers: string[] }> {
  const blockers: string[] = [];
  const verified = new Map<string, string>();
  const expected = new Map<string, string>();
  const queue: Array<{ path: string; sha256: string }> = [];
  const enqueue = (ref: { path: string; sha256: string }): void => {
    const repoPath = normalizeRepoPath(withoutFragment(ref.path));
    const sha256 = normalizeSha256(ref.sha256);
    const prior = expected.get(repoPath);
    if (prior != null && prior !== sha256) {
      blockers.push(`pre_run_ref_hash_conflict:${repoPath}`);
      return;
    }
    if (prior == null) {
      expected.set(repoPath, sha256);
      queue.push({ path: repoPath, sha256 });
    }
  };

  for (const seed of input.seeds) {
    const prior = verified.get(seed.repoPath);
    if (prior != null && prior !== seed.sha256) {
      blockers.push(`pre_run_seed_hash_conflict:${seed.repoPath}`);
      continue;
    }
    verified.set(seed.repoPath, seed.sha256);
    collectHashedRefs(seed.data).forEach(enqueue);
  }
  (input.explicitRefs ?? []).forEach(enqueue);

  let index = 0;
  while (index < queue.length) {
    if (queue.length > 10_000) {
      blockers.push("pre_run_reference_closure_limit_exceeded");
      break;
    }
    const ref = queue[index++];
    const already = verified.get(ref.path);
    if (already != null) {
      if (already !== ref.sha256) {
        blockers.push(`pre_run_ref_hash_conflict:${ref.path}`);
      }
      continue;
    }
    const read = await readBoundBytesFile({
      projectRoot: input.projectRoot,
      repoPath: ref.path,
      expectedSha256: ref.sha256,
    });
    if (read.blocker != null || read.file == null) {
      blockers.push(`pre_run_ref:${read.blocker ?? ref.path}`);
      continue;
    }
    verified.set(read.file.repoPath, read.file.sha256);
    if (read.file.repoPath.toLowerCase().endsWith(".json")) {
      try {
        const data = JSON.parse(read.file.bytes.toString("utf8")) as unknown;
        collectHashedRefs(data).forEach(enqueue);
      } catch {
        blockers.push(`pre_run_ref_json_invalid:${read.file.repoPath}`);
      }
    }
  }
  return { verified, blockers: unique(blockers) };
}

function receiptFileMap(
  verification: TheoryRuntimeReceiptFilesystemVerificationV1,
): Map<string, VerifiedTheoryRuntimeFileV1> {
  return new Map(
    verification.files.map((entry) => [normalizeRepoPath(entry.path), entry]),
  );
}

function descriptorBindingBlockers(input: {
  binding: Nhm2ExperimentReadyTheoryCandidateHashedBindingV1;
  data: unknown;
  identityFields?: Readonly<Record<string, string>>;
}): string[] {
  const { binding, data, identityFields = {} } = input;
  if (!isRecord(data)) {
    return [`candidate_binding_descriptor_invalid:${binding.artifactId}`];
  }
  const blockers: string[] = [];
  if (data.artifactId !== binding.artifactId) {
    blockers.push(
      `candidate_binding_artifact_id_mismatch:${binding.artifactId}`,
    );
  }
  if (data.contractVersion !== binding.contractVersion) {
    blockers.push(
      `candidate_binding_contract_version_mismatch:${binding.artifactId}`,
    );
  }
  for (const [field, expected] of Object.entries(identityFields)) {
    if (data[field] !== expected) {
      blockers.push(
        `candidate_binding_identity_mismatch:${binding.artifactId}:${field}`,
      );
    }
  }
  return blockers;
}

type NullableHashedArtifact = {
  path: string | null;
  sha256: string | null;
};

type RunBoundEvidenceIdentity = {
  candidateId: string | null;
  candidateManifestSha256: string | null;
  preRunManifest: NullableHashedArtifact;
  laneId: string | null;
  runId: string | null;
  requestId: string | null;
  receiptId: string | null;
  runtimeId?: string | null;
  selectedProfileId: string | null;
  selectedProfile?: NullableHashedArtifact;
  chartId: string | null;
  atlas: NullableHashedArtifact;
  units: NullableHashedArtifact;
  normalization: NullableHashedArtifact;
  gitSha: string | null;
};

type RunBoundEvidenceProvenance = {
  producerId: string | null;
  implementationId: string | null;
  solverId: string | null;
  solverVersion: string | null;
  solver: NullableHashedArtifact;
  environment: NullableHashedArtifact;
  invocation: NullableHashedArtifact;
  command: string | null;
  argv: string[];
  workingDirectory: string | null;
  inputManifest: NullableHashedArtifact;
  outputDirectory?: string | null;
  runId: string | null;
  requestId: string | null;
  receiptId: string | null;
  runtimeId?: string | null;
  gitSha: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  deterministicSeed: string | null;
  runSpecificOutput: boolean | null;
};

/**
 * The runtime receipt owns the outer process interval. Raw evidence records the
 * producer-observed computation interval, which must be contained by that
 * process interval; a child cannot know the executor's post-exit timestamp.
 */
export const theoryRuntimeReceiptContainsProducerInterval = (input: {
  receiptStartedAt: string | null | undefined;
  receiptCompletedAt: string | null | undefined;
  producerStartedAt: string | null | undefined;
  producerCompletedAt: string | null | undefined;
}): boolean => {
  const receiptStartedMs = Date.parse(input.receiptStartedAt ?? "");
  const receiptCompletedMs = Date.parse(input.receiptCompletedAt ?? "");
  const producerStartedMs = Date.parse(input.producerStartedAt ?? "");
  const producerCompletedMs = Date.parse(input.producerCompletedAt ?? "");
  return (
    Number.isFinite(receiptStartedMs) &&
    Number.isFinite(receiptCompletedMs) &&
    Number.isFinite(producerStartedMs) &&
    Number.isFinite(producerCompletedMs) &&
    receiptStartedMs <= producerStartedMs &&
    producerStartedMs <= producerCompletedMs &&
    producerCompletedMs <= receiptCompletedMs
  );
};

const hashedArtifactMatches = (
  artifact: NullableHashedArtifact,
  expectedPath: string | null | undefined,
  expectedSha256: string | null | undefined,
): boolean =>
  artifact.path != null &&
  expectedPath != null &&
  normalizeRepoPath(withoutFragment(artifact.path)) ===
    normalizeRepoPath(expectedPath) &&
  artifact.sha256 != null &&
  expectedSha256 != null &&
  normalizeSha256(artifact.sha256) === normalizeSha256(expectedSha256);

type NullableRefArtifact = {
  ref: string | null;
  sha256: string | null;
};

const hashedRefArtifactMatches = (
  artifact: NullableRefArtifact,
  expectedPath: string | null | undefined,
  expectedSha256: string | null | undefined,
): boolean =>
  artifact.ref != null &&
  expectedPath != null &&
  normalizeRepoPath(withoutFragment(artifact.ref)) ===
    normalizeRepoPath(expectedPath) &&
  artifact.sha256 != null &&
  expectedSha256 != null &&
  normalizeSha256(artifact.sha256) === normalizeSha256(expectedSha256);

export const NHM2_SEMICLASSICAL_V2_SERVER_CONTENT_REPLAY_BLOCKER =
  "semiclassical_v2_server_content_replay_missing" as const;

/**
 * V2 producer metrics cannot authorize themselves. Both stochastic-response
 * references must bind to the registered dynamic evidence artifact, and a
 * future server-owned replay must recompute the noise-kernel PSD/ratio and
 * constraint-bracket residuals from the referenced numerical bytes.
 */
export function nhm2SemiclassicalV2AuthorityBlockers(input: {
  metricResponseEvidence: NullableRefArtifact;
  stabilityEvidence: NullableRefArtifact;
  dynamicEvidence:
    { artifactPath: string | null; sha256: string | null } | null | undefined;
}): string[] {
  const blockers: string[] = [
    NHM2_SEMICLASSICAL_V2_SERVER_CONTENT_REPLAY_BLOCKER,
  ];
  if (
    !hashedRefArtifactMatches(
      input.metricResponseEvidence,
      input.dynamicEvidence?.artifactPath,
      input.dynamicEvidence?.sha256,
    )
  ) {
    blockers.push(
      "semiclassical_state_noise_kernel_metric_response_dynamic_binding_mismatch",
    );
  }
  if (
    !hashedRefArtifactMatches(
      input.stabilityEvidence,
      input.dynamicEvidence?.artifactPath,
      input.dynamicEvidence?.sha256,
    )
  ) {
    blockers.push(
      "semiclassical_state_noise_kernel_stability_dynamic_binding_mismatch",
    );
  }
  return blockers;
}

type RawDescriptorBinding = NullableHashedArtifact & {
  artifactId: string | null;
  contractVersion: string | null;
};

const descriptorArtifactMatches = (
  binding: RawDescriptorBinding,
  expected:
    Nhm2ExperimentReadyTheoryCandidateHashedBindingV1 | null | undefined,
): boolean =>
  expected != null &&
  binding.artifactId === expected.artifactId &&
  binding.contractVersion === expected.contractVersion &&
  hashedArtifactMatches(binding, expected.path, expected.sha256);

const completeFormalReplayArtifact = (value: {
  path: string | null;
  sha256: string | null;
}): Nhm2FormalKernelReplayArtifactRefV1 | null =>
  value.path != null && value.sha256 != null
    ? { path: value.path, sha256: normalizeSha256(value.sha256) }
    : null;

export function nhm2FormalReplayEvaluatorContextFromCertificate(input: {
  certificate: Nhm2FormalManifestCertificateV1;
  candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1 | null;
  receipt: TheoryRuntimeReceiptV1 | null;
}): {
  context: Nhm2FormalKernelReplayEvaluatorContextV1 | null;
  blockers: string[];
} {
  const formalPlan = input.manifest?.executionPlans.find(
    (entry) => entry.planRole === "formal_kernel",
  );
  if (formalPlan == null || input.receipt == null || input.manifest == null) {
    return {
      context: null,
      blockers: ["formal_replay_evaluator_context_missing"],
    };
  }
  const refs = {
    manifestArtifact: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.manifest,
    ),
    preRunSourceLedger: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.preRunSourceLedger,
    ),
    theoremReplayLedger: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.theoremReplayLedger,
    ),
    usedAxiomLedger: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.usedAxiomLedger,
    ),
    usedAssumptionLedger: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.usedAssumptionLedger,
    ),
    aggregateReplayTranscript: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.aggregateReplayTranscript,
    ),
    claimLockProof: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.claimLockProof,
    ),
    claimLockTranscript: completeFormalReplayArtifact(
      input.certificate.formalKernelReplay.claimLockTranscript,
    ),
  };
  const preRunSources =
    input.certificate.formalKernelReplay.preRunSourceArtifacts.map(
      completeFormalReplayArtifact,
    );
  if (
    Object.values(refs).some((ref) => ref == null) ||
    preRunSources.some((ref) => ref == null)
  ) {
    return {
      context: null,
      blockers: ["formal_replay_evaluator_artifact_binding_incomplete"],
    };
  }
  const requiredPreRunSources: Nhm2FormalKernelReplayArtifactRefV1[] = [
    {
      path: input.candidate.candidateManifestPath,
      sha256: input.candidate.candidateManifestSha256,
    },
    {
      path: input.candidate.numericPolicySetPath,
      sha256: input.candidate.numericPolicySetSha256,
    },
    ...[
      input.manifest.bindings.profile,
      input.manifest.bindings.chart,
      input.manifest.bindings.atlas,
      input.manifest.bindings.units,
      input.manifest.bindings.normalization,
      formalPlan.solver,
      formalPlan.environmentLock,
    ].map((binding) => ({
      path: binding.path,
      sha256: binding.sha256,
    })),
  ];
  return {
    context: {
      manifestArtifact: refs.manifestArtifact!,
      identity: {
        candidateId: input.candidate.candidateId,
        candidateManifestSha256: input.candidate.candidateManifestSha256,
        requestId: formalPlan.requestId,
        runId: formalPlan.runId,
        runtimeId: formalPlan.runtimeId,
        sourceCommitSha: formalPlan.sourceCommitSha,
      },
      preRunSources: preRunSources as Nhm2FormalKernelReplayArtifactRefV1[],
      requiredPreRunSources,
      kernel: {
        proofAssistant: "Lean",
        kernelId: formalPlan.solver.solverId,
        kernelVersion: formalPlan.solver.solverVersion,
        binary: {
          path: formalPlan.solver.path,
          sha256: formalPlan.solver.sha256,
        },
        environmentLock: {
          path: formalPlan.environmentLock.path,
          sha256: formalPlan.environmentLock.sha256,
        },
      },
      preRunSourceLedger: refs.preRunSourceLedger!,
      theoremReplayLedger: refs.theoremReplayLedger!,
      usedAxiomLedger: refs.usedAxiomLedger!,
      usedAssumptionLedger: refs.usedAssumptionLedger!,
      aggregateReplayTranscript: refs.aggregateReplayTranscript!,
      claimLockProof: refs.claimLockProof!,
      claimLockTranscript: refs.claimLockTranscript!,
      receiptInterval: {
        startedAt: input.receipt.provenance.startedAt,
        completedAt: input.receipt.provenance.completedAt,
      },
    },
    blockers: [],
  };
}

type Nhm2FormalOuterObservationFilesystemVerificationV2 = {
  valid: boolean;
  blockers: string[];
};

const timestampInsideInterval = (input: {
  timestamp: unknown;
  startedAt: string | null | undefined;
  completedAt: string | null | undefined;
  toleranceMs?: number;
}): boolean => {
  const timestampMs =
    typeof input.timestamp === "string" ? Date.parse(input.timestamp) : NaN;
  const startedMs = Date.parse(input.startedAt ?? "");
  const completedMs = Date.parse(input.completedAt ?? "");
  const toleranceMs = input.toleranceMs ?? 0;
  return (
    Number.isFinite(timestampMs) &&
    Number.isFinite(startedMs) &&
    Number.isFinite(completedMs) &&
    startedMs <= completedMs &&
    timestampMs >= startedMs - toleranceMs &&
    timestampMs <= completedMs + toleranceMs
  );
};

const canonicalIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
};

const canonicalJsonBytesMatch = (bytes: Buffer, value: unknown): boolean => {
  try {
    return bytes.equals(Buffer.from(JSON.stringify(value), "utf8"));
  } catch {
    return false;
  }
};

const portableChildPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !path.posix.isAbsolute(value) &&
  value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );

const exactRecordKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => sameJson(Object.keys(value).sort(), [...expected].sort());

const formalRunSpecStructuralBlockers = (input: {
  rawSpec: Record<string, unknown>;
  spec: Nhm2ExperimentReadyTheoryFormalRunSpecV1;
  projectRoot: string;
  plan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
  candidateManifestPath: string;
  candidateManifestSha256: string;
  candidateManifestSizeBytes: number;
}): string[] => {
  const blockers: string[] = [];
  if (
    !exactRecordKeys(input.rawSpec, [
      "artifactId",
      "contractVersion",
      "generatedAt",
      "sealedAt",
      "identity",
      "planBinding",
      "theoremName",
      "formalSourceBindings",
      "toolchainBindings",
      "executor",
      "outerArtifactPath",
      "claimBoundary",
    ]) ||
    !sameJson(input.spec.planBinding, input.plan) ||
    !canonicalIsoTimestamp(input.rawSpec.generatedAt) ||
    !canonicalIsoTimestamp(input.rawSpec.sealedAt) ||
    Date.parse(input.rawSpec.generatedAt) >
      Date.parse(input.rawSpec.sealedAt) ||
    !isRecord(input.rawSpec.identity) ||
    !exactRecordKeys(input.rawSpec.identity, [
      "candidateId",
      "candidateManifestId",
      "candidateManifestSha256",
      "candidateFrozenAt",
      "requestId",
      "runId",
      "receiptId",
      "runtimeId",
      "sourceCommitSha",
    ])
  ) {
    blockers.push("formal_v2_run_spec_exact_shape_or_plan_binding_mismatch");
  }
  const executor = isRecord(input.rawSpec.executor)
    ? input.rawSpec.executor
    : null;
  const sourceBindings = isRecord(input.rawSpec.formalSourceBindings)
    ? input.rawSpec.formalSourceBindings
    : null;
  const toolchainBindings = isRecord(input.rawSpec.toolchainBindings)
    ? input.rawSpec.toolchainBindings
    : null;
  if (
    executor == null ||
    sourceBindings == null ||
    toolchainBindings == null ||
    !isRecord(executor.ledgers) ||
    !isRecord(executor.executables) ||
    !exactRecordKeys(executor, [
      "theoremName",
      "executableRole",
      "executables",
      "ledgers",
      "outputRoot",
      "replayWorkdirs",
      "environmentAllowlist",
      "environment",
      "executableArguments",
      "expectedOutputPaths",
      "timeoutMs",
      "maxCapturedOutputBytes",
    ]) ||
    !exactRecordKeys(executor.ledgers, ["source", "toolchain", "input"]) ||
    !exactRecordKeys(executor.executables, ["lean", "lake"]) ||
    !exactRecordKeys(sourceBindings, ["authority", "projectRoot", "entries"]) ||
    !exactRecordKeys(toolchainBindings, [
      "authority",
      "toolchainRoot",
      "entries",
    ])
  ) {
    return unique([...blockers, "formal_v2_run_spec_nested_shape_invalid"]);
  }

  const expectedOutputRoot = path.resolve(
    input.projectRoot,
    input.plan.expectedInvocation.outputDirectory,
  );
  if (
    executor.executableRole !== "lean" ||
    executor.outputRoot !== expectedOutputRoot ||
    !Array.isArray(executor.replayWorkdirs) ||
    executor.replayWorkdirs.length !== 2 ||
    executor.replayWorkdirs[0] !==
      path.join(expectedOutputRoot, "replay-one") ||
    executor.replayWorkdirs[1] !==
      path.join(expectedOutputRoot, "replay-two") ||
    !Array.isArray(executor.expectedOutputPaths) ||
    executor.expectedOutputPaths.length !== 1 ||
    !portableChildPath(executor.expectedOutputPaths[0]) ||
    !Array.isArray(executor.executableArguments) ||
    executor.executableArguments.length !== 3 ||
    executor.executableArguments[1] !== "-o" ||
    executor.executableArguments[2] !== executor.expectedOutputPaths[0] ||
    !Number.isSafeInteger(executor.timeoutMs) ||
    (executor.timeoutMs as number) <= 0 ||
    (executor.timeoutMs as number) > 3_600_000 ||
    !Number.isSafeInteger(executor.maxCapturedOutputBytes) ||
    (executor.maxCapturedOutputBytes as number) <= 0 ||
    (executor.maxCapturedOutputBytes as number) > 64 * 1024 * 1024
  ) {
    blockers.push("formal_v2_executor_contract_invalid");
  }

  const ledgerByKind = new Map<
    string,
    {
      rootPath: string;
      entries: Array<{
        relativePath: string;
        sha256: string;
        sizeBytes: number;
      }>;
    }
  >();
  for (const kind of ["source", "toolchain", "input"] as const) {
    const rawLedger = isRecord(executor.ledgers[kind])
      ? executor.ledgers[kind]
      : null;
    if (
      rawLedger == null ||
      rawLedger.kind !== kind ||
      typeof rawLedger.rootPath !== "string" ||
      !path.isAbsolute(rawLedger.rootPath) ||
      !isInside(input.projectRoot, rawLedger.rootPath) ||
      !Array.isArray(rawLedger.entries) ||
      typeof rawLedger.ledgerSha256 !== "string" ||
      !exactRecordKeys(rawLedger, [
        "kind",
        "rootPath",
        "entries",
        "ledgerSha256",
      ])
    ) {
      blockers.push(`formal_v2_${kind}_ledger_invalid`);
      continue;
    }
    const entries: Array<{
      relativePath: string;
      sha256: string;
      sizeBytes: number;
    }> = [];
    for (const rawEntry of rawLedger.entries) {
      if (
        !isRecord(rawEntry) ||
        !exactRecordKeys(rawEntry, ["relativePath", "sha256", "sizeBytes"]) ||
        !portableChildPath(rawEntry.relativePath) ||
        typeof rawEntry.sha256 !== "string" ||
        !isSha256(rawEntry.sha256) ||
        !Number.isSafeInteger(rawEntry.sizeBytes) ||
        (rawEntry.sizeBytes as number) < (kind === "toolchain" ? 0 : 1)
      ) {
        blockers.push(`formal_v2_${kind}_ledger_entry_invalid`);
        continue;
      }
      entries.push({
        relativePath: rawEntry.relativePath,
        sha256: normalizeSha256(rawEntry.sha256),
        sizeBytes: rawEntry.sizeBytes as number,
      });
    }
    const sortedPaths = entries.map((entry) => entry.relativePath);
    if (
      entries.length !== rawLedger.entries.length ||
      new Set(sortedPaths).size !== sortedPaths.length ||
      !sameJson(sortedPaths, [...sortedPaths].sort()) ||
      normalizeSha256(rawLedger.ledgerSha256) !==
        computeNhm2FormalKernelLedgerSha256({ kind, entries })
    ) {
      blockers.push(`formal_v2_${kind}_ledger_commitment_mismatch`);
    }
    ledgerByKind.set(kind, { rootPath: rawLedger.rootPath, entries });
  }

  const inputLedger = ledgerByKind.get("input");
  if (
    inputLedger == null ||
    !inputLedger.entries.some(
      (entry) =>
        entry.relativePath === input.candidateManifestPath &&
        entry.sha256 === input.candidateManifestSha256 &&
        entry.sizeBytes === input.candidateManifestSizeBytes,
    )
  ) {
    blockers.push("formal_v2_candidate_manifest_not_in_sealed_input_ledger");
  }

  const sourceEntries = Array.isArray(sourceBindings.entries)
    ? sourceBindings.entries
    : [];
  const sourceRoles = sourceEntries.map((entry) =>
    isRecord(entry) && typeof entry.sourceRole === "string"
      ? entry.sourceRole
      : "",
  );
  if (
    sourceBindings.authority !== "server_owned_formal_project" ||
    typeof sourceBindings.projectRoot !== "string" ||
    !path.isAbsolute(sourceBindings.projectRoot) ||
    !isInside(input.projectRoot, sourceBindings.projectRoot) ||
    sourceEntries.some(
      (entry) =>
        !isRecord(entry) ||
        !exactRecordKeys(entry, ["sourceRole", "path", "sha256", "sizeBytes"]),
    ) ||
    sourceRoles.some(
      (role) =>
        role !== "supporting_source" &&
        !NHM2_EXPERIMENT_READY_THEORY_FORMAL_REQUIRED_SOURCE_ROLES.includes(
          role as (typeof NHM2_EXPERIMENT_READY_THEORY_FORMAL_REQUIRED_SOURCE_ROLES)[number],
        ),
    ) ||
    !NHM2_EXPERIMENT_READY_THEORY_FORMAL_REQUIRED_SOURCE_ROLES.every(
      (role) => sourceRoles.filter((entry) => entry === role).length === 1,
    )
  ) {
    blockers.push("formal_v2_required_source_roles_not_exact");
  }
  const sourceLedger = ledgerByKind.get("source");
  if (
    sourceLedger == null ||
    sourceLedger.rootPath !== sourceBindings.projectRoot ||
    sourceEntries.length !== sourceLedger.entries.length ||
    sourceEntries.some((rawEntry) => {
      if (
        !isRecord(rawEntry) ||
        typeof rawEntry.path !== "string" ||
        typeof rawEntry.sha256 !== "string" ||
        !Number.isSafeInteger(rawEntry.sizeBytes)
      ) {
        return true;
      }
      const absoluteBindingPath = path.isAbsolute(rawEntry.path)
        ? rawEntry.path
        : path.resolve(input.projectRoot, rawEntry.path);
      if (!isInside(input.projectRoot, absoluteBindingPath)) return true;
      const relativePath = path
        .relative(sourceLedger.rootPath, absoluteBindingPath)
        .split(path.sep)
        .join("/");
      const digest = normalizeSha256(rawEntry.sha256);
      return !sourceLedger.entries.some(
        (entry) =>
          entry.relativePath === relativePath &&
          entry.sha256 === digest &&
          entry.sizeBytes === rawEntry.sizeBytes,
      );
    })
  ) {
    blockers.push("formal_v2_source_bindings_not_exactly_ledger_bound");
  }

  const toolchainEntries = Array.isArray(toolchainBindings.entries)
    ? toolchainBindings.entries
    : [];
  const toolchainRoles = toolchainEntries.map((entry) =>
    isRecord(entry) && typeof entry.toolchainRole === "string"
      ? entry.toolchainRole
      : "",
  );
  const toolchainLedger = ledgerByKind.get("toolchain");
  if (
    toolchainBindings.authority !== "sealed_lean_toolchain" ||
    typeof toolchainBindings.toolchainRoot !== "string" ||
    !path.isAbsolute(toolchainBindings.toolchainRoot) ||
    !isInside(input.projectRoot, toolchainBindings.toolchainRoot) ||
    toolchainEntries.some(
      (entry) =>
        !isRecord(entry) ||
        !exactRecordKeys(entry, [
          "toolchainRole",
          "path",
          "sha256",
          "sizeBytes",
        ]),
    ) ||
    toolchainRoles.some(
      (role) =>
        role !== "lean_executable" &&
        role !== "lake_executable" &&
        role !== "runtime_dependency",
    ) ||
    toolchainRoles.filter((entry) => entry === "lean_executable").length !==
      1 ||
    toolchainRoles.filter((entry) => entry === "lake_executable").length !==
      1 ||
    toolchainLedger == null ||
    toolchainLedger.rootPath !== toolchainBindings.toolchainRoot ||
    toolchainEntries.length !== toolchainLedger.entries.length ||
    toolchainEntries.some((rawEntry) => {
      if (
        !isRecord(rawEntry) ||
        typeof rawEntry.path !== "string" ||
        typeof rawEntry.sha256 !== "string" ||
        !Number.isSafeInteger(rawEntry.sizeBytes)
      ) {
        return true;
      }
      const absoluteBindingPath = path.isAbsolute(rawEntry.path)
        ? rawEntry.path
        : path.resolve(input.projectRoot, rawEntry.path);
      if (!isInside(input.projectRoot, absoluteBindingPath)) return true;
      const relativePath = path
        .relative(toolchainLedger.rootPath, absoluteBindingPath)
        .split(path.sep)
        .join("/");
      const digest = normalizeSha256(rawEntry.sha256);
      return !toolchainLedger.entries.some(
        (entry) =>
          entry.relativePath === relativePath &&
          entry.sha256 === digest &&
          entry.sizeBytes === rawEntry.sizeBytes,
      );
    })
  ) {
    blockers.push("formal_v2_toolchain_bindings_not_exactly_ledger_bound");
  }
  const executables = isRecord(executor.executables)
    ? executor.executables
    : null;
  const exactExecutable = (
    executableName: "lean" | "lake",
    bindingRole: "lean_executable" | "lake_executable",
  ): boolean => {
    const executable =
      executables != null && isRecord(executables[executableName])
        ? executables[executableName]
        : null;
    const binding = toolchainEntries.find(
      (entry) => isRecord(entry) && entry.toolchainRole === bindingRole,
    );
    return (
      executable != null &&
      exactRecordKeys(executable, ["absolutePath", "sha256", "sizeBytes"]) &&
      isRecord(binding) &&
      typeof binding.path === "string" &&
      executable.absolutePath ===
        (path.isAbsolute(binding.path)
          ? binding.path
          : path.resolve(input.projectRoot, binding.path)) &&
      executable.sha256 === binding.sha256 &&
      executable.sizeBytes === binding.sizeBytes
    );
  };
  const replayDriver = sourceEntries.find(
    (entry) => isRecord(entry) && entry.sourceRole === "replay_driver",
  );
  if (
    !exactExecutable("lean", "lean_executable") ||
    !exactExecutable("lake", "lake_executable") ||
    !isRecord(replayDriver) ||
    typeof replayDriver.path !== "string" ||
    !Array.isArray(executor.executableArguments) ||
    executor.executableArguments[0] !==
      (path.isAbsolute(replayDriver.path)
        ? replayDriver.path
        : path.resolve(input.projectRoot, replayDriver.path))
  ) {
    blockers.push("formal_v2_executables_or_driver_not_sealed");
  }
  return unique(blockers);
};

/**
 * Rebuilds formal v2 evidence from the receipt-bound outer observation and the
 * exact presealed run spec. A published certificate is never trusted as an
 * authority source: its canonical bytes must equal this independent rebuild.
 */
async function verifyNhm2FormalOuterObservationV2Filesystem(input: {
  projectRoot: string;
  candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1;
  candidateManifest: Nhm2ExperimentReadyTheoryCandidateManifestV1 | null;
  candidateManifestFile: BoundJsonFile | null;
  evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1;
  publishedData: unknown;
  publishedFile: VerifiedTheoryRuntimeFileV1;
  receipt: TheoryRuntimeReceiptV1 | null;
  receiptVerification: TheoryRuntimeReceiptFilesystemVerificationV1 | null;
}): Promise<Nhm2FormalOuterObservationFilesystemVerificationV2> {
  const blockers: string[] = [];
  const fail = (
    blocker: string,
  ): Nhm2FormalOuterObservationFilesystemVerificationV2 => ({
    valid: false,
    blockers: unique([...blockers, blocker]),
  });

  if (
    !isRecord(input.publishedData) ||
    input.publishedData.contractVersion !==
      NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION
  ) {
    return fail("formal_v2_required_legacy_or_unknown_contract_rejected");
  }
  if (input.publishedFile.bytes.byteLength > FORMAL_V2_MAX_EVIDENCE_BYTES) {
    return fail("formal_v2_evidence_resource_limit_exceeded");
  }
  if (
    input.candidateManifest == null ||
    input.candidateManifestFile == null ||
    input.receipt == null ||
    input.receiptVerification == null
  ) {
    return fail("formal_v2_trusted_context_missing");
  }

  const formalPlans = input.candidateManifest.executionPlans.filter(
    (entry) => entry.planRole === "formal_kernel",
  );
  if (formalPlans.length !== 1) {
    return fail("formal_v2_exact_formal_plan_missing");
  }
  const formalPlan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1 =
    formalPlans[0];
  if (
    input.evidence.receiptId !== formalPlan.receiptId ||
    input.evidence.runId !== formalPlan.runId ||
    input.evidence.gitSha !== formalPlan.sourceCommitSha ||
    input.evidence.implementationId !== formalPlan.solver.implementationId ||
    input.receipt.receiptId !== formalPlan.receiptId ||
    input.receipt.runtimeId !== formalPlan.runtimeId ||
    input.receipt.provenance.gitSha !== formalPlan.sourceCommitSha ||
    input.receipt.execution?.outputDirectory !==
      formalPlan.expectedInvocation.outputDirectory
  ) {
    blockers.push("formal_v2_plan_receipt_wrapper_binding_mismatch");
  }
  if (
    !input.receiptVerification.ok ||
    !input.receiptVerification.freshnessProofVerified
  ) {
    blockers.push("formal_v2_receipt_filesystem_or_freshness_unverified");
  }

  let formalRunSpecPath: string;
  try {
    formalRunSpecPath = nhm2ExperimentReadyTheoryFormalRunSpecPath({
      outputDirectory: formalPlan.expectedInvocation.outputDirectory,
      runId: formalPlan.runId,
    });
  } catch {
    return fail("formal_v2_plan_derived_run_spec_path_invalid");
  }
  const plannedArgs = formalPlan.expectedInvocation.args;
  const exactArgumentBinding = (flag: string, value: string): boolean => {
    const positions = plannedArgs
      .map((entry, index) => (entry === flag ? index : -1))
      .filter((index) => index >= 0);
    return positions.length === 1 && plannedArgs[positions[0] + 1] === value;
  };
  if (
    !exactArgumentBinding(
      "--candidate-manifest",
      input.candidate.candidateManifestPath,
    ) ||
    !exactArgumentBinding("--formal-run-spec", formalRunSpecPath)
  ) {
    blockers.push("formal_v2_plan_run_spec_invocation_binding_mismatch");
  }
  const specRead = await readBoundJsonFile({
    projectRoot: input.projectRoot,
    repoPath: formalRunSpecPath,
    maxBytes: FORMAL_V2_MAX_RUN_SPEC_BYTES,
  });
  if (specRead.file == null || specRead.blocker != null) {
    return fail(`formal_v2_run_spec:${specRead.blocker ?? "unreadable"}`);
  }
  if (!canonicalJsonBytesMatch(specRead.file.bytes, specRead.file.data)) {
    return fail("formal_v2_run_spec_not_canonical_json");
  }
  const rawSpec = specRead.file.data;
  if (
    !isRecord(rawSpec) ||
    rawSpec.artifactId !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID ||
    rawSpec.contractVersion !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION ||
    !isRecord(rawSpec.executor) ||
    !isRecord(rawSpec.identity) ||
    !isRecord(rawSpec.claimBoundary)
  ) {
    return fail("formal_v2_run_spec_schema_invalid");
  }
  const spec = rawSpec as unknown as Nhm2ExperimentReadyTheoryFormalRunSpecV1;
  blockers.push(
    ...formalRunSpecStructuralBlockers({
      rawSpec,
      spec,
      projectRoot: input.projectRoot,
      plan: formalPlan,
      candidateManifestPath: input.candidate.candidateManifestPath,
      candidateManifestSha256: input.candidate.candidateManifestSha256,
      candidateManifestSizeBytes: input.candidateManifestFile.bytes.byteLength,
    }),
  );
  const receiptStartedAt = input.receipt.provenance.startedAt;
  const receiptCompletedAt = input.receipt.provenance.completedAt;
  if (
    !timestampInsideInterval({
      timestamp: receiptStartedAt,
      startedAt: receiptStartedAt,
      completedAt: receiptCompletedAt,
    }) ||
    typeof spec.sealedAt !== "string" ||
    Date.parse(spec.sealedAt) > Date.parse(receiptStartedAt ?? "")
  ) {
    blockers.push("formal_v2_preseal_or_receipt_interval_invalid");
  }

  const outputDirectory = normalizeRepoPath(
    formalPlan.expectedInvocation.outputDirectory,
  ).replace(/\/$/, "");
  const expectedOutputPaths = spec.executor.expectedOutputPaths;
  if (
    !Array.isArray(expectedOutputPaths) ||
    expectedOutputPaths.length !== 1 ||
    !portableChildPath(expectedOutputPaths[0])
  ) {
    return fail("formal_v2_replay_output_contract_invalid");
  }
  const replayOutput = expectedOutputPaths[0];
  const expectedOuterPath = `${outputDirectory}/${NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME}`;
  const expectedEvidencePath = `${outputDirectory}/evidence/formal_manifest_certificate.json`;
  const expectedReceiptPaths = [
    expectedOuterPath,
    `${outputDirectory}/replay-one/${replayOutput}`,
    `${outputDirectory}/replay-two/${replayOutput}`,
    expectedEvidencePath,
  ].sort();
  if (
    spec.outerArtifactPath !== expectedOuterPath ||
    input.evidence.artifactPath !== expectedEvidencePath
  ) {
    blockers.push("formal_v2_output_path_binding_mismatch");
  }
  const verifiedFiles = input.receiptVerification.files;
  const actualReceiptPaths = verifiedFiles
    .map((entry) => normalizeRepoPath(entry.path))
    .sort();
  if (
    verifiedFiles.length !== 4 ||
    new Set(actualReceiptPaths).size !== 4 ||
    !sameJson(actualReceiptPaths, expectedReceiptPaths)
  ) {
    blockers.push("formal_v2_exact_four_output_inventory_required");
  }
  for (const entry of verifiedFiles) {
    const normalizedPath = normalizeRepoPath(entry.path);
    const maxBytes =
      normalizedPath === expectedEvidencePath
        ? FORMAL_V2_MAX_EVIDENCE_BYTES
        : normalizedPath === expectedOuterPath
          ? FORMAL_V2_MAX_OUTER_ARTIFACT_BYTES
          : FORMAL_V2_MAX_REPLAY_OUTPUT_BYTES;
    if (
      entry.freshness !== "new" ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes <= 0 ||
      entry.sizeBytes > maxBytes ||
      !timestampInsideInterval({
        timestamp: entry.modifiedAt,
        startedAt: receiptStartedAt,
        completedAt: receiptCompletedAt,
        toleranceMs: FORMAL_V2_FRESHNESS_CLOCK_TOLERANCE_MS,
      })
    ) {
      blockers.push(`formal_v2_output_not_fresh_or_bounded:${normalizedPath}`);
    }
    try {
      const stat = await fs.lstat(entry.absolutePath);
      const declaredModifiedAtMs = Date.parse(entry.modifiedAt);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size !== entry.sizeBytes ||
        !Number.isFinite(declaredModifiedAtMs) ||
        Math.abs(stat.mtimeMs - declaredModifiedAtMs) > 1 ||
        !timestampInsideInterval({
          timestamp: new Date(stat.mtimeMs).toISOString(),
          startedAt: receiptStartedAt,
          completedAt: receiptCompletedAt,
          toleranceMs: FORMAL_V2_FRESHNESS_CLOCK_TOLERANCE_MS,
        })
      ) {
        blockers.push(`formal_v2_output_stat_mismatch:${normalizedPath}`);
      }
    } catch {
      blockers.push(`formal_v2_output_stat_unavailable:${normalizedPath}`);
    }
  }

  const fileByPath = receiptFileMap(input.receiptVerification);
  const outerFile = fileByPath.get(expectedOuterPath);
  const publishedFile = fileByPath.get(expectedEvidencePath);
  if (
    outerFile == null ||
    publishedFile == null ||
    publishedFile.sha256 !== input.publishedFile.sha256 ||
    !publishedFile.bytes.equals(input.publishedFile.bytes)
  ) {
    return fail("formal_v2_receipt_bound_outer_or_evidence_missing");
  }
  if (outerFile.bytes.byteLength > FORMAL_V2_MAX_OUTER_ARTIFACT_BYTES) {
    return fail("formal_v2_outer_artifact_resource_limit_exceeded");
  }
  let rawOuter: unknown;
  try {
    rawOuter = JSON.parse(outerFile.bytes.toString("utf8")) as unknown;
  } catch {
    return fail("formal_v2_outer_artifact_json_invalid");
  }
  if (!canonicalJsonBytesMatch(outerFile.bytes, rawOuter)) {
    return fail("formal_v2_outer_artifact_not_canonical_json");
  }
  if (
    !isRecord(rawOuter) ||
    rawOuter.artifactId !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID ||
    rawOuter.contractVersion !==
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION ||
    !isRecord(rawOuter.executionObservation) ||
    !isRecord(rawOuter.identity) ||
    !isRecord(rawOuter.inputs) ||
    !isRecord(rawOuter.claimBoundary)
  ) {
    return fail("formal_v2_outer_artifact_schema_invalid");
  }
  const executionArtifact =
    rawOuter as unknown as Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1;
  if (
    !timestampInsideInterval({
      timestamp: executionArtifact.generatedAt,
      startedAt: receiptStartedAt,
      completedAt: receiptCompletedAt,
    }) ||
    !timestampInsideInterval({
      timestamp: executionArtifact.executionObservation.generatedAt,
      startedAt: receiptStartedAt,
      completedAt: receiptCompletedAt,
    })
  ) {
    blockers.push("formal_v2_outer_generated_at_outside_receipt_interval");
  }
  const rawReplays = executionArtifact.executionObservation.replays;
  if (!Array.isArray(rawReplays) || rawReplays.length !== 2) {
    blockers.push("formal_v2_two_replay_intervals_required");
  } else {
    for (const [index, replay] of rawReplays.entries()) {
      if (
        !isRecord(replay) ||
        !isRecord(replay.process) ||
        !theoryRuntimeReceiptContainsProducerInterval({
          receiptStartedAt,
          receiptCompletedAt,
          producerStartedAt:
            typeof replay.process.startedAt === "string"
              ? replay.process.startedAt
              : null,
          producerCompletedAt:
            typeof replay.process.completedAt === "string"
              ? replay.process.completedAt
              : null,
        })
      ) {
        blockers.push(`formal_v2_replay_interval_unbound:${index + 1}`);
      }
    }
  }

  const trustedContext: Nhm2FormalOuterObservationTrustedContextV2 = {
    candidate: {
      candidateId: input.candidate.candidateId,
      candidateManifestId: input.candidate.candidateManifestId,
      candidateManifestPath: input.candidate.candidateManifestPath,
      candidateManifestSha256: input.candidate.candidateManifestSha256,
      candidateManifestSizeBytes: input.candidateManifestFile.bytes.byteLength,
      candidateFrozenAt: input.candidateManifest.frozenAt,
      claimBoundary: input.candidateManifest.claimBoundary,
    },
    formalPlan,
    formalRunSpec: {
      path: formalRunSpecPath,
      sha256: specRead.file.sha256,
      sizeBytes: specRead.file.bytes.byteLength,
      value: spec,
    },
  };
  let rebuilt: Nhm2FormalOuterObservationEvidenceV2;
  try {
    rebuilt = buildNhm2FormalOuterObservationEvidence({
      executionArtifact,
      executionObservation: executionArtifact.executionObservation,
      trustedContext,
    });
  } catch {
    return fail("formal_v2_rebuild_malformed_input");
  }
  const rebuiltBytes = Buffer.from(JSON.stringify(rebuilt), "utf8");
  if (!publishedFile.bytes.equals(rebuiltBytes)) {
    blockers.push("formal_v2_published_bytes_do_not_match_rebuild");
  }
  if (
    rebuilt.status !== "pass" ||
    input.evidence.verdict !== "pass" ||
    !sameJson(
      rebuilt.checks.map((entry) => entry.checkId),
      NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS,
    ) ||
    !sameJson(
      Object.keys(input.evidence.checks).sort(),
      [...NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS].sort(),
    ) ||
    rebuilt.claimBoundary.numericalPhysicsValidated !== false ||
    rebuilt.claimBoundary.theoryClosureEstablished !== false ||
    rebuilt.claimBoundary.empiricalValidationEstablished !== false ||
    rebuilt.claimBoundary.physicalViabilityEstablished !== false ||
    rebuilt.claimBoundary.transportEstablished !== false ||
    rebuilt.claimBoundary.propulsionEstablished !== false ||
    rebuilt.claimBoundary.routeEtaEstablished !== false ||
    rebuilt.claimBoundary.speedAuthorityEstablished !== false
  ) {
    blockers.push("formal_v2_pass_and_claim_boundary_required");
  }

  const uniqueBlockers = unique(blockers);
  return { valid: uniqueBlockers.length === 0, blockers: uniqueBlockers };
}

function runBoundEvidenceBlockers(input: {
  evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1;
  identity: RunBoundEvidenceIdentity;
  provenance: RunBoundEvidenceProvenance;
  candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1 | null;
  receipt: TheoryRuntimeReceiptV1 | null;
}): string[] {
  const { evidence, identity, provenance, candidate, manifest, receipt } =
    input;
  const blockers: string[] = [];
  const plan = manifest?.executionPlans.find(
    (entry) => entry.receiptId === evidence.receiptId,
  );
  if (
    identity.candidateId !== candidate.candidateId ||
    identity.candidateManifestSha256 == null ||
    normalizeSha256(identity.candidateManifestSha256) !==
      candidate.candidateManifestSha256 ||
    identity.laneId !== candidate.laneId ||
    identity.runId !== evidence.runId ||
    identity.requestId !== plan?.requestId ||
    identity.receiptId !== evidence.receiptId ||
    (identity.runtimeId !== undefined &&
      (identity.runtimeId !== plan?.runtimeId ||
        identity.runtimeId !== receipt?.runtimeId)) ||
    identity.selectedProfileId !== candidate.selectedProfileId ||
    identity.chartId !== candidate.chartId ||
    identity.gitSha !== evidence.gitSha
  ) {
    blockers.push("raw_identity_mismatch");
  }
  if (
    !hashedArtifactMatches(
      identity.preRunManifest,
      candidate.candidateManifestPath,
      candidate.candidateManifestSha256,
    ) ||
    !hashedArtifactMatches(
      identity.atlas,
      candidate.atlasPath,
      candidate.atlasSha256,
    ) ||
    !hashedArtifactMatches(
      identity.units,
      manifest?.bindings.units.path,
      candidate.unitsSha256,
    ) ||
    !hashedArtifactMatches(
      identity.normalization,
      manifest?.bindings.normalization.path,
      candidate.normalizationSha256,
    ) ||
    (identity.selectedProfile !== undefined &&
      !hashedArtifactMatches(
        identity.selectedProfile,
        manifest?.bindings.profile.path,
        manifest?.bindings.profile.sha256,
      ))
  ) {
    blockers.push("raw_identity_artifact_binding_mismatch");
  }
  if (
    plan == null ||
    receipt == null ||
    provenance.producerId !== evidence.producerId ||
    provenance.implementationId !== evidence.implementationId ||
    provenance.solverId !== plan.solver.solverId ||
    provenance.solverVersion !== plan.solver.solverVersion ||
    provenance.runId !== evidence.runId ||
    provenance.requestId !== plan.requestId ||
    provenance.receiptId !== evidence.receiptId ||
    (provenance.runtimeId !== undefined &&
      provenance.runtimeId !== plan.runtimeId) ||
    provenance.gitSha !== evidence.gitSha ||
    provenance.command !== receipt.execution?.command ||
    !sameJson(provenance.argv, receipt.execution?.args) ||
    provenance.workingDirectory !== receipt.execution?.cwd ||
    (provenance.outputDirectory !== undefined &&
      (provenance.outputDirectory !== plan.expectedInvocation.outputDirectory ||
        provenance.outputDirectory !== receipt.execution?.outputDirectory)) ||
    !theoryRuntimeReceiptContainsProducerInterval({
      receiptStartedAt: receipt.provenance.startedAt,
      receiptCompletedAt: receipt.provenance.completedAt,
      producerStartedAt: provenance.startedAt,
      producerCompletedAt: provenance.completedAt,
    }) ||
    provenance.runSpecificOutput !== true
  ) {
    blockers.push("raw_provenance_runtime_binding_mismatch");
  }
  if (
    !hashedArtifactMatches(
      provenance.solver,
      plan?.solver.path,
      plan?.solver.sha256,
    ) ||
    !hashedArtifactMatches(
      provenance.environment,
      plan?.environmentLock.path,
      plan?.environmentLock.sha256,
    ) ||
    !hashedArtifactMatches(
      provenance.inputManifest,
      candidate.candidateManifestPath,
      candidate.candidateManifestSha256,
    )
  ) {
    blockers.push("raw_provenance_artifact_binding_mismatch");
  }
  return blockers;
}

type CycleSafeFlatRunBinding = {
  candidateId: string | null;
  candidateManifestPath: string | null;
  candidateManifestSha256: string | null;
  preRunManifestPath: string | null;
  preRunManifestSha256: string | null;
  numericPolicySetPath: string | null;
  numericPolicySetRawSha256: string | null;
  numericPolicySetSemanticSha256: string | null;
  laneId: string | null;
  runId: string | null;
  requestId: string | null;
  receiptId: string | null;
  runtimeId: string | null;
  selectedProfileId: string | null;
  chartId: string | null;
  atlasPath: string | null;
  atlasSha256: string | null;
  unitsPath: string | null;
  unitsSha256: string | null;
  normalizationPath: string | null;
  normalizationSha256: string | null;
  gitSha: string | null;
};

function cycleSafeFlatRunBoundEvidenceBlockers(input: {
  evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1;
  binding: CycleSafeFlatRunBinding;
  provenance: RunBoundEvidenceProvenance;
  candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1 | null;
  receipt: TheoryRuntimeReceiptV1 | null;
}): string[] {
  const { evidence, binding, provenance, candidate, manifest, receipt } = input;
  const blockers = runBoundEvidenceBlockers({
    evidence,
    identity: {
      candidateId: binding.candidateId,
      candidateManifestSha256: binding.candidateManifestSha256,
      preRunManifest: {
        path: binding.preRunManifestPath,
        sha256: binding.preRunManifestSha256,
      },
      laneId: binding.laneId,
      runId: binding.runId,
      requestId: binding.requestId,
      receiptId: binding.receiptId,
      runtimeId: binding.runtimeId,
      selectedProfileId: binding.selectedProfileId,
      chartId: binding.chartId,
      atlas: { path: binding.atlasPath, sha256: binding.atlasSha256 },
      units: { path: binding.unitsPath, sha256: binding.unitsSha256 },
      normalization: {
        path: binding.normalizationPath,
        sha256: binding.normalizationSha256,
      },
      gitSha: binding.gitSha,
    },
    provenance,
    candidate,
    manifest,
    receipt,
  });
  if (
    binding.candidateManifestPath !== candidate.candidateManifestPath ||
    binding.numericPolicySetPath !== candidate.numericPolicySetPath ||
    binding.numericPolicySetRawSha256 !== candidate.numericPolicySetSha256 ||
    binding.numericPolicySetSemanticSha256 !==
      candidate.numericPolicySetSemanticSha256
  ) {
    blockers.push("raw_flat_candidate_policy_binding_mismatch");
  }
  return blockers;
}

type CompactCycleSafeFlatRunBinding = {
  candidateId: string | null;
  candidateManifestPath: string | null;
  candidateManifestSha256: string | null;
  preRunManifestPath: string | null;
  preRunManifestSha256: string | null;
  runId: string | null;
  requestId: string | null;
  receiptId: string | null;
  runtimeId: string | null;
  plannedOutputDirectory: string | null;
  laneId: string | null;
  selectedProfileId: string | null;
  chartId: string | null;
  atlasPath: string | null;
  atlasSha256: string | null;
  unitsPath: string | null;
  unitsSha256: string | null;
  normalizationPath: string | null;
  normalizationSha256: string | null;
  gitSha: string | null;
};

type CompactCycleSafeFlatRunProvenance = {
  producerId: string | null;
  producerVersion: string | null;
  solverId: string | null;
  solverVersion: string | null;
  solver: NullableHashedArtifact;
  environment: NullableHashedArtifact;
  invocation: NullableHashedArtifact;
  inputManifest: NullableHashedArtifact;
  startedAt: string | null;
  completedAt: string | null;
  runSpecificOutput: boolean | null;
};

function compactCycleSafeFlatRunBoundEvidenceBlockers(input: {
  evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1;
  binding: CompactCycleSafeFlatRunBinding;
  provenance: CompactCycleSafeFlatRunProvenance;
  candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1 | null;
  receipt: TheoryRuntimeReceiptV1 | null;
}): string[] {
  const { evidence, binding, provenance, candidate, manifest, receipt } = input;
  const blockers: string[] = [];
  const plan = manifest?.executionPlans.find(
    (entry) => entry.receiptId === evidence.receiptId,
  );
  if (
    binding.candidateId !== candidate.candidateId ||
    binding.candidateManifestPath !== candidate.candidateManifestPath ||
    binding.candidateManifestSha256 == null ||
    normalizeSha256(binding.candidateManifestSha256) !==
      candidate.candidateManifestSha256 ||
    binding.preRunManifestPath !== candidate.candidateManifestPath ||
    binding.preRunManifestSha256 == null ||
    normalizeSha256(binding.preRunManifestSha256) !==
      candidate.candidateManifestSha256 ||
    binding.runId !== evidence.runId ||
    binding.requestId !== plan?.requestId ||
    binding.receiptId !== evidence.receiptId ||
    binding.runtimeId !== plan?.runtimeId ||
    binding.runtimeId !== receipt?.runtimeId ||
    binding.plannedOutputDirectory !==
      plan?.expectedInvocation.outputDirectory ||
    binding.plannedOutputDirectory !== receipt?.execution?.outputDirectory ||
    binding.laneId !== candidate.laneId ||
    binding.selectedProfileId !== candidate.selectedProfileId ||
    binding.chartId !== candidate.chartId ||
    binding.atlasPath !== candidate.atlasPath ||
    binding.atlasSha256 !== candidate.atlasSha256 ||
    binding.unitsPath !== manifest?.bindings.units.path ||
    binding.unitsSha256 !== candidate.unitsSha256 ||
    binding.normalizationPath !== manifest?.bindings.normalization.path ||
    binding.normalizationSha256 !== candidate.normalizationSha256 ||
    binding.gitSha !== evidence.gitSha
  ) {
    blockers.push("raw_flat_binding_mismatch");
  }
  if (
    plan == null ||
    receipt == null ||
    provenance.producerId !== evidence.producerId ||
    provenance.producerVersion !== evidence.implementationId ||
    provenance.solverId !== plan.solver.solverId ||
    provenance.solverVersion !== plan.solver.solverVersion ||
    !theoryRuntimeReceiptContainsProducerInterval({
      receiptStartedAt: receipt.provenance.startedAt,
      receiptCompletedAt: receipt.provenance.completedAt,
      producerStartedAt: provenance.startedAt,
      producerCompletedAt: provenance.completedAt,
    }) ||
    provenance.runSpecificOutput !== true
  ) {
    blockers.push("raw_flat_provenance_runtime_binding_mismatch");
  }
  if (
    !hashedArtifactMatches(
      provenance.solver,
      plan?.solver.path,
      plan?.solver.sha256,
    ) ||
    !hashedArtifactMatches(
      provenance.environment,
      plan?.environmentLock.path,
      plan?.environmentLock.sha256,
    ) ||
    !hashedArtifactMatches(
      provenance.inputManifest,
      candidate.candidateManifestPath,
      candidate.candidateManifestSha256,
    )
  ) {
    blockers.push("raw_flat_provenance_artifact_binding_mismatch");
  }
  return blockers;
}

type RawDerivedCheck = {
  checkId: string;
  status: "pass" | "blocked" | "fail";
  pass?: boolean;
  metricValue: number | null;
  tolerance: number | null;
  unit: string | null;
};

function exactRawCheckBlockers(input: {
  evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1;
  requiredCheckIds: readonly string[];
  rawChecks: readonly RawDerivedCheck[];
}): string[] {
  const blockers: string[] = [];
  const rawById = new Map(
    input.rawChecks.map((check) => [check.checkId, check]),
  );
  for (const checkId of input.requiredCheckIds) {
    const raw = rawById.get(checkId);
    const wrapper = input.evidence.checks[checkId];
    if (raw == null || raw.status === "blocked") {
      blockers.push(`raw_check_incomplete:${checkId}`);
      continue;
    }
    const numericComparator = (
      NHM2_EXPERIMENT_READY_THEORY_CLOSURE_NUMERIC_CHECK_POLICIES as Record<
        string,
        string | undefined
      >
    )[checkId];
    if (
      wrapper == null ||
      (numericComparator == null &&
        wrapper.pass !== (raw.pass ?? raw.status === "pass")) ||
      wrapper.metricValue !== raw.metricValue ||
      wrapper.tolerance !== raw.tolerance ||
      wrapper.units !== raw.unit
    ) {
      blockers.push(`raw_check_binding_mismatch:${checkId}`);
    }
  }
  return blockers;
}

const SEMICLASSICAL_GATE_BY_CLOSURE_CHECK = {
  field_model_and_state_construction_explicit: "field_state_construction",
  hadamard_or_equivalent_state_admissible: "state_admissibility",
  renormalization_scheme_counterterms_fixed: "renormalization_counterterms",
  renormalized_expectation_value_constructed: "renormalized_stress_tensor",
  ward_identity_pass: "ward_identity_conservation",
  boundary_switching_preparation_compatible:
    "preparation_switching_compatibility",
  qei_applicability_bound_to_same_state: "qei_same_state_worldline_binding",
  rset_uncertainty_budget_bounded: "uncertainty_bounds",
  connected_stress_noise_kernel_same_state_renormalized_and_bounded:
    "stress_fluctuation_noise_kernel",
  semiclassical_constraint_algebra_anomaly_residual_bounded:
    "constraint_formulation_consistency",
} as const;

function evidenceArtifactValidation(input: {
  evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1;
  data: unknown;
  candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1 | null;
  receipt: TheoryRuntimeReceiptV1 | null;
  allEvidence: readonly Nhm2ExperimentReadyTheoryClosureEvidenceV1[];
  allEvidenceData: ReadonlyMap<
    Nhm2ExperimentReadyTheoryClosureEvidenceId,
    unknown
  >;
}): { supported: boolean; valid: boolean; blockers: string[] } {
  const {
    evidence,
    data,
    candidate,
    manifest,
    receipt,
    allEvidence,
    allEvidenceData,
  } = input;
  if (evidence.evidenceId === "full_apparatus_source_tensor") {
    if (!isNhm2FullApparatusSourceTensor(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["full_apparatus_source_tensor_schema_invalid"],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked") {
      blockers.push("full_apparatus_source_tensor_incomplete");
    }
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push("full_apparatus_source_tensor_wrapper_verdict_mismatch");
    }
    blockers.push(
      ...runBoundEvidenceBlockers({
        evidence,
        identity: data.identity,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map((blocker) => `full_apparatus_source_tensor:${blocker}`),
    );
    const numericMetricIds = {
      nondegenerate_metric_signal_above_numerical_floor:
        "metric_signal_norm_si",
      independent_metric_route_and_grid_convergence:
        "cross_grid_relative_difference_upper95",
      uncertainty_aware_absolute_relative_residuals_pass:
        "relative_residual_upper95",
    } as const;
    const rawChecks = new Map(
      data.checks.map((check) => [check.checkId, check]),
    );
    for (const checkId of NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.full_apparatus_source_tensor) {
      const raw = rawChecks.get(checkId);
      const wrapper = evidence.checks[checkId];
      if (raw == null || raw.status === "blocked") {
        blockers.push(`full_source_raw_check_incomplete:${checkId}`);
        continue;
      }
      if (checkId in numericMetricIds) {
        const metricId =
          numericMetricIds[checkId as keyof typeof numericMetricIds];
        const metric = raw.metrics.find((entry) => entry.metricId === metricId);
        if (
          metric == null ||
          wrapper?.metricValue !== metric.value ||
          wrapper.tolerance !== metric.tolerance ||
          wrapper.units !== metric.unit
        ) {
          blockers.push(`full_source_raw_metric_binding_mismatch:${checkId}`);
        }
      } else if (wrapper?.pass !== (raw.status === "pass")) {
        blockers.push(`full_source_raw_check_result_mismatch:${checkId}`);
      }
    }
    const materialEvidence = allEvidence.find(
      (entry) =>
        entry.evidenceId ===
        "finite_temperature_finite_geometry_maxwell_stress",
    );
    const materialTerm = data.sourceTensor.terms.find(
      (entry) => entry.term === "casimir_material_field",
    );
    if (
      materialEvidence == null ||
      materialTerm == null ||
      !hashedArtifactMatches(
        materialTerm.sourceField,
        materialEvidence.artifactPath,
        materialEvidence.sha256,
      )
    ) {
      blockers.push("full_source_material_evidence_binding_mismatch");
    }
    const mechanicalEvidence = allEvidence.find(
      (entry) => entry.evidenceId === "mechanical_support_control_margin",
    );
    const mechanicalData = allEvidenceData.get(
      "mechanical_support_control_margin",
    );
    if (
      mechanicalEvidence == null ||
      !isNhm2MechanicalSupportControlMargin(mechanicalData) ||
      !hashedArtifactMatches(
        mechanicalData.apparatusStressEnergy.candidateSourceTensor,
        data.sourceTensor.rawTotalTensorArray.path,
        data.sourceTensor.rawTotalTensorArray.sha256,
      )
    ) {
      blockers.push("full_source_mechanical_total_binding_mismatch");
    } else {
      const termMap = {
        mechanical_structure: "mechanical_return",
        supports: "supports",
        controls: "controls",
        thermal: "thermal_return",
      } as const;
      for (const [mechanicalTermId, fullSourceTermId] of Object.entries(
        termMap,
      )) {
        const mechanicalTerm = mechanicalData.apparatusStressEnergy.terms.find(
          (entry) => entry.termId === mechanicalTermId,
        );
        const fullSourceTerm = data.sourceTensor.terms.find(
          (entry) => entry.term === fullSourceTermId,
        );
        if (
          mechanicalTerm == null ||
          fullSourceTerm == null ||
          !hashedArtifactMatches(
            fullSourceTerm.sourceField,
            mechanicalEvidence.artifactPath,
            mechanicalEvidence.sha256,
          ) ||
          !hashedArtifactMatches(
            fullSourceTerm.rawTensorArray,
            mechanicalTerm.tensor.path,
            mechanicalTerm.tensor.sha256,
          )
        ) {
          blockers.push(
            `full_source_mechanical_term_binding_mismatch:${mechanicalTermId}`,
          );
        }
      }
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "semiclassical_state") {
    if (!isNhm2SemiclassicalStateRealizability(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["semiclassical_state_schema_invalid"],
      };
    }
    const blockers: string[] = [
      data.status === "blocked" ? "semiclassical_state_incomplete" : "",
      data.status === "pass" && evidence.verdict !== "pass"
        ? "semiclassical_state_wrapper_verdict_mismatch"
        : "",
      data.status === "fail" && evidence.verdict !== "fail"
        ? "semiclassical_state_wrapper_verdict_mismatch"
        : "",
    ].filter(Boolean);
    const plan = manifest?.executionPlans.find(
      (entry) => entry.receiptId === evidence.receiptId,
    );
    if (
      data.laneId !== candidate.laneId ||
      data.selectedProfileId !== candidate.selectedProfileId ||
      data.runId !== evidence.runId ||
      data.stressTensor.chartId !== candidate.chartId
    ) {
      blockers.push("semiclassical_state_candidate_identity_mismatch");
    }
    if (
      data.provenance.gitSha !== evidence.gitSha ||
      data.provenance.inputManifest.ref == null ||
      normalizeRepoPath(withoutFragment(data.provenance.inputManifest.ref)) !==
        candidate.candidateManifestPath ||
      data.provenance.inputManifest.sha256 == null ||
      normalizeSha256(data.provenance.inputManifest.sha256) !==
        candidate.candidateManifestSha256
    ) {
      blockers.push("semiclassical_state_candidate_manifest_binding_mismatch");
    }
    if (
      receipt == null ||
      plan == null ||
      plan.planRole !== "primary_numerical" ||
      !theoryRuntimeReceiptContainsProducerInterval({
        receiptStartedAt: receipt.provenance.startedAt,
        receiptCompletedAt: receipt.provenance.completedAt,
        producerStartedAt: data.provenance.startedAt,
        producerCompletedAt: data.provenance.completedAt,
      }) ||
      data.provenance.outputDirectory !==
        plan.expectedInvocation.outputDirectory ||
      data.provenance.outputDirectory !== receipt.execution?.outputDirectory ||
      data.provenance.requestId !== plan.requestId ||
      data.provenance.runId !== plan.runId ||
      data.provenance.receiptId !== plan.receiptId ||
      data.provenance.runtimeId !== plan.runtimeId ||
      data.provenance.implementationId !== plan.solver.implementationId ||
      data.provenance.solverId !== plan.solver.solverId ||
      data.provenance.solverVersion !== plan.solver.solverVersion ||
      data.provenance.command !== plan.expectedInvocation.command ||
      !sameJson(data.provenance.argv, plan.expectedInvocation.args) ||
      data.provenance.workingDirectory !== plan.expectedInvocation.cwd ||
      data.provenance.command !== receipt.execution?.command ||
      !sameJson(data.provenance.argv, receipt.execution?.args) ||
      data.provenance.workingDirectory !== receipt.execution?.cwd ||
      data.provenance.solver.ref == null ||
      normalizeRepoPath(withoutFragment(data.provenance.solver.ref)) !==
        normalizeRepoPath(plan.solver.path) ||
      data.provenance.solver.sha256 == null ||
      normalizeSha256(data.provenance.solver.sha256) !==
        normalizeSha256(plan.solver.sha256) ||
      data.provenance.environment.ref == null ||
      normalizeRepoPath(withoutFragment(data.provenance.environment.ref)) !==
        normalizeRepoPath(plan.environmentLock.path) ||
      data.provenance.environment.sha256 == null ||
      normalizeSha256(data.provenance.environment.sha256) !==
        normalizeSha256(plan.environmentLock.sha256)
    ) {
      blockers.push("semiclassical_state_runtime_envelope_binding_mismatch");
    }
    const gateById = new Map(data.gates.map((gate) => [gate.gateId, gate]));
    for (const [checkId, gateId] of Object.entries(
      SEMICLASSICAL_GATE_BY_CLOSURE_CHECK,
    )) {
      const rawGate = gateById.get(gateId);
      const wrapperCheck = evidence.checks[checkId];
      if (rawGate == null || rawGate.status === "blocked") {
        blockers.push(`semiclassical_state_raw_gate_incomplete:${checkId}`);
      } else if (
        checkId !== "rset_uncertainty_budget_bounded" &&
        wrapperCheck?.pass !== (rawGate.status === "pass")
      ) {
        blockers.push(
          `semiclassical_state_raw_gate_result_mismatch:${checkId}`,
        );
      }
    }
    const wardCheck = evidence.checks.ward_identity_pass;
    if (
      wardCheck?.metricValue !== data.wardIdentity.divergenceResidualLInf ||
      wardCheck?.tolerance !== data.wardIdentity.toleranceLInf
    ) {
      blockers.push("semiclassical_state_ward_metric_binding_mismatch");
    }
    const uncertaintyCheck = evidence.checks.rset_uncertainty_budget_bounded;
    if (
      uncertaintyCheck?.metricValue !==
      data.uncertaintyBudget.maximumRelativeHalfWidth95
    ) {
      blockers.push("semiclassical_state_uncertainty_metric_binding_mismatch");
    }
    const fluctuationCheck =
      evidence.checks
        .connected_stress_noise_kernel_same_state_renormalized_and_bounded;
    if (
      fluctuationCheck?.metricValue !==
        data.stressFluctuations.fluctuationToMeanRatioUpper95 ||
      fluctuationCheck?.tolerance !==
        data.stressFluctuations.fluctuationToMeanRatioTolerance
    ) {
      blockers.push("semiclassical_state_noise_kernel_metric_binding_mismatch");
    }
    const constraintAlgebraCheck =
      evidence.checks.semiclassical_constraint_algebra_anomaly_residual_bounded;
    if (
      constraintAlgebraCheck?.metricValue !==
        data.constraintConsistency.maximumAlgebraResidualUpper95 ||
      constraintAlgebraCheck?.tolerance !==
        data.constraintConsistency.algebraTolerance
    ) {
      blockers.push(
        "semiclassical_state_constraint_algebra_metric_binding_mismatch",
      );
    }
    const dynamicEvidence = allEvidence.find(
      (entry) =>
        entry.evidenceId === "dynamic_backreaction_stability_causality",
    );
    blockers.push(
      ...nhm2SemiclassicalV2AuthorityBlockers({
        metricResponseEvidence: data.stressFluctuations.metricResponseEvidence,
        stabilityEvidence: data.stressFluctuations.stabilityEvidence,
        dynamicEvidence,
      }),
    );
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "covariant_conservation") {
    if (!isNhm2CovariantConservation(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["covariant_conservation_schema_invalid"],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked")
      blockers.push("covariant_conservation_incomplete");
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push("covariant_conservation_wrapper_verdict_mismatch");
    }
    blockers.push(
      ...compactCycleSafeFlatRunBoundEvidenceBlockers({
        evidence,
        binding: data.binding,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map((blocker) => `covariant_conservation:${blocker}`),
      ...exactRawCheckBlockers({
        evidence,
        requiredCheckIds:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.covariant_conservation,
        rawChecks: data.checks,
      }).map((blocker) => `covariant_conservation:${blocker}`),
    );
    const fullSourceEvidence = allEvidence.find(
      (entry) => entry.evidenceId === "full_apparatus_source_tensor",
    );
    const fullSourceData = allEvidenceData.get("full_apparatus_source_tensor");
    if (
      fullSourceEvidence == null ||
      !isNhm2FullApparatusSourceTensor(fullSourceData) ||
      !hashedArtifactMatches(
        data.sourceBinding.sourceEvidence,
        fullSourceEvidence.artifactPath,
        fullSourceEvidence.sha256,
      ) ||
      !hashedArtifactMatches(
        data.sourceBinding.rawTotalSourceTensor,
        fullSourceData.sourceTensor.rawTotalTensorArray.path,
        fullSourceData.sourceTensor.rawTotalTensorArray.sha256,
      ) ||
      data.sourceBinding.candidateId !== candidate.candidateId ||
      data.sourceBinding.candidateManifestSha256 == null ||
      normalizeSha256(data.sourceBinding.candidateManifestSha256) !==
        candidate.candidateManifestSha256 ||
      data.sourceBinding.runId !== fullSourceEvidence.runId ||
      data.sourceBinding.chartId !== candidate.chartId
    ) {
      blockers.push("covariant_conservation_full_source_binding_mismatch");
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "dynamic_backreaction_stability_causality") {
    if (!isNhm2DynamicBackreactionStabilityCausality(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["dynamic_backreaction_stability_causality_schema_invalid"],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked") {
      blockers.push("dynamic_backreaction_stability_causality_incomplete");
    }
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push(
        "dynamic_backreaction_stability_causality_wrapper_verdict_mismatch",
      );
    }
    blockers.push(
      ...compactCycleSafeFlatRunBoundEvidenceBlockers({
        evidence,
        binding: data.binding,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map(
        (blocker) => `dynamic_backreaction_stability_causality:${blocker}`,
      ),
      ...exactRawCheckBlockers({
        evidence,
        requiredCheckIds:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.dynamic_backreaction_stability_causality,
        rawChecks: data.checks,
      }).map(
        (blocker) => `dynamic_backreaction_stability_causality:${blocker}`,
      ),
    );
    const fullSourceData = allEvidenceData.get("full_apparatus_source_tensor");
    const semiclassicalEvidence = allEvidence.find(
      (entry) => entry.evidenceId === "semiclassical_state",
    );
    const semiclassicalData = allEvidenceData.get("semiclassical_state");
    if (
      !isNhm2FullApparatusSourceTensor(fullSourceData) ||
      !hashedArtifactMatches(
        data.initialCoupling.sourceTensor,
        fullSourceData.sourceTensor.rawTotalTensorArray.path,
        fullSourceData.sourceTensor.rawTotalTensorArray.sha256,
      )
    ) {
      blockers.push("dynamic_initial_full_source_tensor_binding_mismatch");
    }
    if (
      semiclassicalEvidence == null ||
      !isNhm2SemiclassicalStateRealizability(semiclassicalData) ||
      !hashedArtifactMatches(
        data.semiclassicalBackreaction.evidence,
        semiclassicalEvidence.artifactPath,
        semiclassicalEvidence.sha256,
      ) ||
      !hashedArtifactMatches(
        data.semiclassicalBackreaction.renormalizedStressTensor,
        semiclassicalData.stressTensor.tensor.ref,
        semiclassicalData.stressTensor.tensor.sha256,
      )
    ) {
      blockers.push("dynamic_semiclassical_state_binding_mismatch");
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (
    evidence.evidenceId === "finite_temperature_finite_geometry_maxwell_stress"
  ) {
    if (!isCasimirFiniteTemperatureFiniteGeometryMaxwellStress(data)) {
      return {
        supported: true,
        valid: false,
        blockers: [
          "finite_temperature_finite_geometry_maxwell_stress_schema_invalid",
        ],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked") {
      blockers.push(
        "finite_temperature_finite_geometry_maxwell_stress_incomplete",
      );
    }
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push(
        "finite_temperature_finite_geometry_maxwell_stress_wrapper_verdict_mismatch",
      );
    }
    blockers.push(
      ...cycleSafeFlatRunBoundEvidenceBlockers({
        evidence,
        binding: data.binding,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map(
        (blocker) =>
          `finite_temperature_finite_geometry_maxwell_stress:${blocker}`,
      ),
      ...exactRawCheckBlockers({
        evidence,
        requiredCheckIds:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.finite_temperature_finite_geometry_maxwell_stress,
        rawChecks: data.checks,
      }).map(
        (blocker) =>
          `finite_temperature_finite_geometry_maxwell_stress:${blocker}`,
      ),
    );
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "mechanical_support_control_margin") {
    if (!isNhm2MechanicalSupportControlMargin(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["mechanical_support_control_margin_schema_invalid"],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked") {
      blockers.push("mechanical_support_control_margin_incomplete");
    }
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push(
        "mechanical_support_control_margin_wrapper_verdict_mismatch",
      );
    }
    blockers.push(
      ...cycleSafeFlatRunBoundEvidenceBlockers({
        evidence,
        binding: data.binding,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map((blocker) => `mechanical_support_control_margin:${blocker}`),
      ...exactRawCheckBlockers({
        evidence,
        requiredCheckIds:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.mechanical_support_control_margin,
        rawChecks: data.checks,
      }).map((blocker) => `mechanical_support_control_margin:${blocker}`),
    );
    const materialEvidence = allEvidence.find(
      (entry) =>
        entry.evidenceId ===
        "finite_temperature_finite_geometry_maxwell_stress",
    );
    if (
      materialEvidence == null ||
      normalizeRepoPath(data.forceGradientImport.sourceEvidence.path ?? "") !==
        materialEvidence.artifactPath ||
      data.forceGradientImport.sourceEvidence.sha256 == null ||
      normalizeSha256(data.forceGradientImport.sourceEvidence.sha256) !==
        normalizeSha256(materialEvidence.sha256) ||
      data.forceGradientImport.sourceCandidateId !== candidate.candidateId ||
      data.forceGradientImport.sourceCandidateManifestSha256 == null ||
      normalizeSha256(
        data.forceGradientImport.sourceCandidateManifestSha256,
      ) !== candidate.candidateManifestSha256 ||
      data.forceGradientImport.sourceRunId !== materialEvidence.runId
    ) {
      blockers.push("mechanical_material_force_gradient_binding_mismatch");
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "independent_numerical_replication") {
    if (!isNhm2IndependentNumericalReplication(data)) {
      return {
        supported: true,
        valid: false,
        blockers: [
          "independent_numerical_replication_schema_invalid",
          ...NHM2_INDEPENDENT_NUMERICAL_REPLICATION_SERVER_REPLAY_BLOCKERS,
        ],
      };
    }
    // The published replication artifact is producer-declared diagnostic
    // metadata. The current server content assessor is intentionally
    // `not_evaluable` and emits no replay receipt, so even schema-valid bytes
    // cannot promote closure. A future passing branch must independently read
    // the float64 arrays, bind the strict primary projection and independent
    // field manifests, and recompute all nine metrics server-side.
    const blockers: string[] = [
      ...NHM2_INDEPENDENT_NUMERICAL_REPLICATION_SERVER_REPLAY_BLOCKERS,
    ];
    if (data.status === "blocked") {
      blockers.push("independent_numerical_replication_incomplete");
    }
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push("independent_numerical_replication_verdict_mismatch");
    }
    const primaryPlan = manifest?.executionPlans.find(
      (entry) => entry.planRole === "primary_numerical",
    );
    const independentPlan = manifest?.executionPlans.find(
      (entry) => entry.planRole === "independent_numerical",
    );
    const primaryEvidence = allEvidence.find(
      (entry) => entry.evidenceId === "full_apparatus_source_tensor",
    );
    const identity = data.identity;
    if (
      manifest == null ||
      primaryPlan == null ||
      independentPlan == null ||
      primaryEvidence == null ||
      identity.candidateId !== candidate.candidateId ||
      identity.candidateManifestId !== candidate.candidateManifestId ||
      identity.candidateManifest.artifactId !== manifest.artifactId ||
      identity.candidateManifest.contractVersion !== manifest.contractVersion ||
      !hashedArtifactMatches(
        identity.candidateManifest,
        candidate.candidateManifestPath,
        candidate.candidateManifestSha256,
      ) ||
      identity.numericPolicySet.policySetId !==
        manifest.numericCheckPolicySet.policySetId ||
      !hashedArtifactMatches(
        identity.numericPolicySet,
        candidate.numericPolicySetPath,
        candidate.numericPolicySetSha256,
      ) ||
      identity.numericPolicySet.semanticSha256 !==
        candidate.numericPolicySetSemanticSha256 ||
      identity.laneId !== candidate.laneId ||
      !descriptorArtifactMatches(identity.profile, manifest.bindings.profile) ||
      identity.profile.selectedProfileId !== candidate.selectedProfileId ||
      !descriptorArtifactMatches(identity.chart, manifest.bindings.chart) ||
      identity.chart.chartId !== candidate.chartId ||
      !descriptorArtifactMatches(identity.atlas, manifest.bindings.atlas) ||
      identity.atlas.atlasId !== manifest.bindings.atlas.atlasId ||
      !descriptorArtifactMatches(identity.units, manifest.bindings.units) ||
      identity.units.unitsId !== manifest.bindings.units.unitsId ||
      !descriptorArtifactMatches(
        identity.normalization,
        manifest.bindings.normalization,
      ) ||
      identity.normalization.normalizationId !==
        manifest.bindings.normalization.normalizationId ||
      identity.candidateGitSha !== primaryPlan.sourceCommitSha
    ) {
      blockers.push("independent_replication_candidate_binding_mismatch");
    }
    if (
      primaryPlan == null ||
      primaryEvidence == null ||
      identity.primaryExecution.requestId !== primaryPlan.requestId ||
      identity.primaryExecution.runId !== primaryPlan.runId ||
      identity.primaryExecution.receiptId !== primaryPlan.receiptId ||
      identity.primaryExecution.runtimeId !== primaryPlan.runtimeId ||
      identity.primaryExecution.solverId !== primaryPlan.solver.solverId ||
      identity.primaryExecution.implementationId !==
        primaryPlan.solver.implementationId ||
      identity.primaryExecution.independenceGroup !==
        primaryEvidence.independenceGroup
    ) {
      blockers.push("independent_replication_primary_execution_mismatch");
    }
    if (
      independentPlan == null ||
      identity.independentPlan.planRole !== independentPlan.planRole ||
      identity.independentPlan.requestId !== independentPlan.requestId ||
      identity.independentPlan.runId !== evidence.runId ||
      identity.independentPlan.runId !== independentPlan.runId ||
      identity.independentPlan.receiptId !== evidence.receiptId ||
      identity.independentPlan.receiptId !== independentPlan.receiptId ||
      identity.independentPlan.runtimeId !== independentPlan.runtimeId ||
      identity.independentPlan.sourceCommitSha !== evidence.gitSha ||
      identity.independentPlan.sourceCommitSha !==
        independentPlan.sourceCommitSha ||
      identity.independentPlan.deterministicSeed !==
        independentPlan.deterministicSeedPolicy ||
      !descriptorArtifactMatches(
        identity.independentPlan.solver,
        independentPlan.solver,
      ) ||
      identity.independentPlan.solver.solverId !==
        independentPlan.solver.solverId ||
      identity.independentPlan.solver.solverVersion !==
        independentPlan.solver.solverVersion ||
      identity.independentPlan.solver.implementationId !==
        independentPlan.solver.implementationId ||
      identity.independentPlan.solver.implementationId !==
        evidence.implementationId ||
      identity.independentPlan.solver.independenceGroup !==
        evidence.independenceGroup ||
      !descriptorArtifactMatches(
        identity.independentPlan.environmentLock,
        independentPlan.environmentLock,
      ) ||
      identity.independentPlan.environmentLock.environmentId !==
        independentPlan.environmentLock.environmentId ||
      !sameJson(
        identity.independentPlan.expectedInvocation,
        independentPlan.expectedInvocation,
      )
    ) {
      blockers.push("independent_replication_planned_execution_mismatch");
    }
    blockers.push(
      ...exactRawCheckBlockers({
        evidence,
        requiredCheckIds:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.independent_numerical_replication,
        rawChecks: data.checks,
      }).map((blocker) => `independent_numerical_replication:${blocker}`),
    );
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "formal_manifest_certificate") {
    if (
      !isRecord(data) ||
      data.contractVersion !==
        NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION ||
      data.evidenceRole !== "formal_manifest_certificate" ||
      (data.status !== "pass" && data.status !== "fail") ||
      !Array.isArray(data.checks)
    ) {
      return {
        supported: true,
        valid: false,
        blockers: ["formal_v2_required_legacy_or_unknown_contract_rejected"],
      };
    }
    const rawChecks: RawDerivedCheck[] = data.checks
      .filter(isRecord)
      .map((check) => ({
        checkId: typeof check.checkId === "string" ? check.checkId : "",
        status:
          check.status === "pass" || check.status === "fail"
            ? check.status
            : "blocked",
        metricValue: null,
        tolerance: null,
        unit: null,
      }));
    const blockers = exactRawCheckBlockers({
      evidence,
      requiredCheckIds: NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS,
      rawChecks,
    }).map((blocker) => `formal_manifest_certificate:${blocker}`);
    if ((data.status === "pass") !== (evidence.verdict === "pass")) {
      blockers.push("formal_manifest_certificate:wrapper_verdict_mismatch");
    }
    if (
      !sameJson(
        rawChecks.map((entry) => entry.checkId),
        NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS,
      )
    ) {
      blockers.push("formal_manifest_certificate:v2_check_ids_not_exact");
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "continuous_observer_optimizer") {
    if (!isNhm2ContinuousObserverOptimizer(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["continuous_observer_optimizer_schema_invalid"],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked") {
      blockers.push("continuous_observer_optimizer_incomplete");
    }
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push("continuous_observer_optimizer_wrapper_verdict_mismatch");
    }
    blockers.push(
      ...runBoundEvidenceBlockers({
        evidence,
        identity: data.identity,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map((blocker) => `continuous_observer_optimizer:${blocker}`),
    );
    const fullSourceEvidence = allEvidence.find(
      (entry) => entry.evidenceId === "full_apparatus_source_tensor",
    );
    const fullSourceData = allEvidenceData.get("full_apparatus_source_tensor");
    if (
      fullSourceEvidence == null ||
      !isNhm2FullApparatusSourceTensor(fullSourceData) ||
      !hashedArtifactMatches(
        data.sourceBinding.sourceEvidence,
        fullSourceEvidence.artifactPath,
        fullSourceEvidence.sha256,
      ) ||
      !hashedArtifactMatches(
        data.sourceBinding.rawTotalSourceTensor,
        fullSourceData.sourceTensor.rawTotalTensorArray.path,
        fullSourceData.sourceTensor.rawTotalTensorArray.sha256,
      ) ||
      data.sourceBinding.candidateId !== candidate.candidateId ||
      data.sourceBinding.candidateManifestSha256 == null ||
      normalizeSha256(data.sourceBinding.candidateManifestSha256) !==
        candidate.candidateManifestSha256 ||
      data.sourceBinding.runId !== fullSourceEvidence.runId ||
      data.sourceBinding.chartId !== candidate.chartId
    ) {
      blockers.push("continuous_observer_full_source_binding_mismatch");
    }
    const rawChecks = new Map(
      data.checks.map((check) => [check.checkId, check]),
    );
    for (const checkId of NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.continuous_observer_optimizer) {
      const rawCheck = rawChecks.get(checkId);
      const wrapperCheck = evidence.checks[checkId];
      if (rawCheck == null || rawCheck.status === "blocked") {
        blockers.push(`continuous_observer_raw_check_incomplete:${checkId}`);
      } else if (wrapperCheck?.pass !== (rawCheck.status === "pass")) {
        blockers.push(
          `continuous_observer_raw_check_result_mismatch:${checkId}`,
        );
      }
    }
    const coverageCheck = evidence.checks.every_admitted_spatial_sample_covered;
    const coverageMetric =
      data.domain.admittedSpatialSampleCount != null &&
      data.domain.admittedSpatialSampleCount > 0 &&
      data.domain.optimizedSpatialSampleCount != null
        ? data.domain.optimizedSpatialSampleCount /
          data.domain.admittedSpatialSampleCount
        : null;
    if (coverageCheck?.metricValue !== coverageMetric) {
      blockers.push("continuous_observer_coverage_metric_binding_mismatch");
    }
    const optimizerCheck =
      evidence.checks.optimizer_convergence_and_globality_evidence;
    if (
      optimizerCheck?.metricValue !== data.optimizer.certifiedGlobalityGapMax ||
      optimizerCheck?.tolerance !== data.optimizer.globalityGapTolerance
    ) {
      blockers.push("continuous_observer_optimizer_metric_binding_mismatch");
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "worldline_qei") {
    if (!isNhm2WorldlineQeiCoverage(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["worldline_qei_schema_invalid"],
      };
    }
    const blockers: string[] = [];
    if (data.status === "blocked") blockers.push("worldline_qei_incomplete");
    if (
      (data.status === "pass") !== (evidence.verdict === "pass") &&
      data.status !== "blocked"
    ) {
      blockers.push("worldline_qei_wrapper_verdict_mismatch");
    }
    blockers.push(
      ...runBoundEvidenceBlockers({
        evidence,
        identity: data.identity,
        provenance: data.provenance,
        candidate,
        manifest,
        receipt,
      }).map((blocker) => `worldline_qei:${blocker}`),
    );
    const rawChecks = new Map(
      data.checks.map((check) => [check.checkId, check]),
    );
    for (const checkId of NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.worldline_qei) {
      const rawCheck = rawChecks.get(checkId);
      const wrapperCheck = evidence.checks[checkId];
      if (rawCheck == null || rawCheck.status === "blocked") {
        blockers.push(`worldline_qei_raw_check_incomplete:${checkId}`);
      } else if (
        !Object.hasOwn(
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_NUMERIC_CHECK_POLICIES,
          checkId,
        ) &&
        wrapperCheck?.pass !== (rawCheck.status === "pass")
      ) {
        blockers.push(`worldline_qei_raw_check_result_mismatch:${checkId}`);
      }
    }
    const velocityCheck = evidence.checks.four_velocity_normalization_verified;
    const velocityMetric =
      data.worldlines.length > 0
        ? Math.max(
            ...data.worldlines.map(
              (worldline) =>
                worldline.fourVelocity.normalizationResidualMax ?? Infinity,
            ),
          )
        : null;
    if (
      velocityCheck?.metricValue !== velocityMetric ||
      data.worldlines.some(
        (worldline) =>
          worldline.fourVelocity.normalizationTolerance !==
          velocityCheck?.tolerance,
      )
    ) {
      blockers.push("worldline_qei_velocity_metric_binding_mismatch");
    }
    const samplingCheck = evidence.checks.sampling_function_normalized;
    const samplingMetric =
      data.worldlines.length > 0
        ? Math.max(
            ...data.worldlines.map((worldline) =>
              worldline.samplingFunction.normalizedIntegral == null ||
              worldline.samplingFunction.normalizationAbsoluteUncertainty ==
                null
                ? Infinity
                : Math.abs(worldline.samplingFunction.normalizedIntegral - 1) +
                  worldline.samplingFunction.normalizationAbsoluteUncertainty,
            ),
          )
        : null;
    if (
      samplingCheck?.metricValue !== samplingMetric ||
      data.worldlines.some(
        (worldline) =>
          worldline.samplingFunction.normalizationTolerance !==
          samplingCheck?.tolerance,
      )
    ) {
      blockers.push("worldline_qei_sampling_metric_binding_mismatch");
    }
    const marginCheck = evidence.checks.all_margins_pass_with_uncertainty;
    const marginMetric =
      data.worldlines.length > 0
        ? Math.min(
            ...data.worldlines.map((worldline) =>
              worldline.integral.marginSI == null ||
              worldline.integral.marginAbsoluteUncertaintySI == null
                ? -Infinity
                : worldline.integral.marginSI -
                  worldline.integral.marginAbsoluteUncertaintySI,
            ),
          )
        : null;
    if (
      marginCheck?.metricValue !== marginMetric ||
      data.worldlines.some(
        (worldline) =>
          worldline.integral.minimumRequiredLowerMarginSI !==
          marginCheck?.tolerance,
      )
    ) {
      blockers.push("worldline_qei_margin_metric_binding_mismatch");
    }
    const numericalErrorCheck =
      evidence.checks.quadrature_and_interpolation_error_bounded;
    const maximumRelativeNumericalError =
      data.worldlines.length > 0
        ? Math.max(
            ...data.worldlines.map(
              (worldline) =>
                worldline.integral.combinedNumericalErrorRelative ?? Infinity,
            ),
          )
        : null;
    if (
      numericalErrorCheck?.metricValue !== maximumRelativeNumericalError ||
      numericalErrorCheck?.units !== "relative_error"
    ) {
      blockers.push("worldline_qei_relative_numerical_error_metric_mismatch");
    }
    const semiclassicalEvidence = allEvidence.find(
      (entry) => entry.evidenceId === "semiclassical_state",
    );
    const semiclassicalData = allEvidenceData.get("semiclassical_state");
    const qeiMinimumMargin =
      data.worldlines.length > 0 &&
      data.worldlines.every((worldline) => worldline.integral.marginSI != null)
        ? Math.min(
            ...data.worldlines.map(
              (worldline) => worldline.integral.marginSI as number,
            ),
          )
        : null;
    const qeiMaximumMarginUncertainty =
      data.worldlines.length > 0 &&
      data.worldlines.every(
        (worldline) => worldline.integral.marginAbsoluteUncertaintySI != null,
      )
        ? Math.max(
            ...data.worldlines.map(
              (worldline) =>
                worldline.integral.marginAbsoluteUncertaintySI as number,
            ),
          )
        : null;
    if (
      semiclassicalEvidence == null ||
      !isNhm2SemiclassicalStateRealizability(semiclassicalData) ||
      data.stateBinding.stateId !== semiclassicalData.fieldState.stateId ||
      data.stateBinding.stateSha256 == null ||
      semiclassicalData.fieldState.stateSha256 == null ||
      normalizeSha256(data.stateBinding.stateSha256) !==
        normalizeSha256(semiclassicalData.fieldState.stateSha256) ||
      !hashedArtifactMatches(
        data.stateBinding.stateArtifact,
        semiclassicalData.fieldState.stateArtifact.ref,
        semiclassicalData.fieldState.stateArtifact.sha256,
      ) ||
      !hashedArtifactMatches(
        data.stateBinding.renormalizedStressTensor,
        semiclassicalData.stressTensor.tensor.ref,
        semiclassicalData.stressTensor.tensor.sha256,
      ) ||
      !hashedArtifactMatches(
        data.stateBinding.renormalizationPrescription,
        semiclassicalData.renormalization.prescription.ref,
        semiclassicalData.renormalization.prescription.sha256,
      ) ||
      !hashedArtifactMatches(
        data.stateBinding.semiclassicalReceipt,
        semiclassicalEvidence.artifactPath,
        semiclassicalEvidence.sha256,
      ) ||
      semiclassicalData.qeiBinding.worldlineSet.ref == null ||
      normalizeRepoPath(
        withoutFragment(semiclassicalData.qeiBinding.worldlineSet.ref),
      ) !== normalizeRepoPath(data.coverage.worldlineSet.path ?? "") ||
      semiclassicalData.qeiBinding.worldlineSet.sha256 == null ||
      normalizeSha256(semiclassicalData.qeiBinding.worldlineSet.sha256) !==
        normalizeSha256(data.coverage.worldlineSet.sha256 ?? "") ||
      semiclassicalData.qeiBinding.worldlineCount !==
        data.coverage.admittedWorldlineCount ||
      semiclassicalData.qeiBinding.worldlineCount !==
        data.coverage.evaluatedWorldlineCount ||
      semiclassicalData.qeiBinding.worldlineCount !== data.worldlines.length ||
      semiclassicalData.qeiBinding.allWorldlinesEvaluated !== true ||
      semiclassicalData.qeiBinding.minimumMarginSI !== qeiMinimumMargin ||
      semiclassicalData.qeiBinding.marginAbsoluteUncertaintySI !==
        qeiMaximumMarginUncertainty
    ) {
      blockers.push("worldline_qei_semiclassical_state_binding_mismatch");
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  if (evidence.evidenceId === "prediction_falsifier_freeze") {
    if (!isNhm2PredictionFalsifierFreeze(data)) {
      return {
        supported: true,
        valid: false,
        blockers: ["prediction_freeze_schema_invalid"],
      };
    }
    const blockers: string[] = [
      !data.readiness.predictionFreezeReady
        ? "prediction_freeze_incomplete"
        : "",
      data.readiness.predictionFreezeReady && evidence.verdict !== "pass"
        ? "prediction_freeze_wrapper_verdict_mismatch"
        : "",
    ].filter(Boolean);
    const plan = manifest?.executionPlans.find(
      (entry) => entry.receiptId === evidence.receiptId,
    );
    const commitment = manifest?.predictionFreezeCommitment;
    const registration = data.registrationBinding;
    if (
      plan == null ||
      commitment == null ||
      data.laneId !== candidate.laneId ||
      data.selectedProfileId !== candidate.selectedProfileId ||
      data.model.sourceCommitSha !== evidence.gitSha ||
      data.analysisCode.sourceCommitSha !== evidence.gitSha ||
      data.contractVersion !== commitment.contractVersion ||
      data.semanticSha256 !== commitment.semanticSha256 ||
      data.frozenAt !== commitment.frozenAt ||
      registration.candidateId !== candidate.candidateId ||
      registration.candidateManifestPath !== candidate.candidateManifestPath ||
      registration.candidateManifestSha256 == null ||
      normalizeSha256(registration.candidateManifestSha256) !==
        candidate.candidateManifestSha256 ||
      registration.runId !== evidence.runId ||
      registration.runId !== plan.runId ||
      registration.requestId !== plan.requestId ||
      registration.receiptId !== evidence.receiptId ||
      registration.receiptId !== plan.receiptId ||
      registration.runtimeId !== plan.runtimeId ||
      registration.plannedOutputDirectory !==
        plan.expectedInvocation.outputDirectory ||
      registration.plannedOutputDirectory !==
        receipt?.execution?.outputDirectory
    ) {
      blockers.push("prediction_freeze_commitment_or_run_binding_mismatch");
    }
    if (
      receipt?.provenance.startedAt == null ||
      Date.parse(data.frozenAt) >= Date.parse(receipt.provenance.startedAt)
    ) {
      blockers.push("prediction_freeze_not_frozen_before_bound_run");
    }
    if (data.readiness.predictionFreezeReady) {
      for (const checkId of NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS.prediction_falsifier_freeze) {
        if (evidence.checks[checkId]?.pass !== true) {
          blockers.push(`prediction_freeze_wrapper_check_mismatch:${checkId}`);
        }
      }
    }
    return { supported: true, valid: blockers.length === 0, blockers };
  }
  return {
    supported: false,
    valid: false,
    blockers: [
      `evidence_adapter_unavailable:${evidence.evidenceId}:${evidence.artifactContractVersion}`,
    ],
  };
}

function compareCandidateManifest(input: {
  artifact: Nhm2ExperimentReadyTheoryClosureArtifactV1;
  manifest: Nhm2ExperimentReadyTheoryCandidateManifestV1;
  policyArtifact: Nhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifactV1;
}): string[] {
  const { artifact, manifest, policyArtifact } = input;
  const candidate = artifact.candidate;
  const blockers: string[] = [];
  const primaryPlan = manifest.executionPlans.find(
    (plan) => plan.planRole === "primary_numerical",
  );
  if (artifact.runtimeReceipts.length !== manifest.executionPlans.length) {
    blockers.push("candidate_execution_plan_receipt_count_mismatch");
  }
  for (const receipt of artifact.runtimeReceipts) {
    if (
      !manifest.executionPlans.some(
        (plan) => plan.receiptId === receipt.receiptId,
      )
    ) {
      blockers.push(`candidate_unplanned_receipt:${receipt.receiptId}`);
    }
  }
  if (artifact.evidence.length !== manifest.expectedEvidenceOutputs.length) {
    blockers.push("candidate_expected_evidence_count_mismatch");
  }
  const comparisons: Array<[boolean, string]> = [
    [
      manifest.manifestId === candidate.candidateManifestId,
      "candidate_manifest_id_mismatch",
    ],
    [
      manifest.contractVersion === candidate.candidateManifestContractVersion,
      "candidate_manifest_contract_version_mismatch",
    ],
    [
      manifest.bindings.candidate.candidateId === candidate.candidateId,
      "candidate_id_mismatch",
    ],
    [
      manifest.bindings.profile.selectedProfileId ===
        candidate.selectedProfileId,
      "candidate_profile_id_mismatch",
    ],
    [
      manifest.bindings.chart.chartId === candidate.chartId,
      "candidate_chart_id_mismatch",
    ],
    [
      manifest.bindings.atlas.path === candidate.atlasPath,
      "candidate_atlas_path_mismatch",
    ],
    [
      manifest.bindings.atlas.sha256 === candidate.atlasSha256,
      "candidate_atlas_hash_mismatch",
    ],
    [
      manifest.bindings.units.unitsId === candidate.unitsRef,
      "candidate_units_id_mismatch",
    ],
    [
      manifest.bindings.units.sha256 === candidate.unitsSha256,
      "candidate_units_hash_mismatch",
    ],
    [
      manifest.bindings.normalization.normalizationId ===
        candidate.normalizationRef,
      "candidate_normalization_id_mismatch",
    ],
    [
      manifest.bindings.normalization.sha256 === candidate.normalizationSha256,
      "candidate_normalization_hash_mismatch",
    ],
    [
      primaryPlan?.runId === candidate.primaryRunId,
      "candidate_primary_run_mismatch",
    ],
    [
      primaryPlan?.requestId === candidate.primaryRequestId,
      "candidate_primary_request_mismatch",
    ],
    [
      primaryPlan?.runtimeId === candidate.primaryRuntimeId,
      "candidate_primary_runtime_mismatch",
    ],
    [
      primaryPlan?.receiptId === candidate.primaryReceiptId,
      "candidate_primary_receipt_mismatch",
    ],
    [
      primaryPlan?.sourceCommitSha === candidate.primaryGitSha,
      "candidate_primary_git_sha_mismatch",
    ],
    [
      manifest.numericCheckPolicySet.artifactPath ===
        candidate.numericPolicySetPath,
      "candidate_numeric_policy_path_mismatch",
    ],
    [
      manifest.numericCheckPolicySet.artifactRawSha256 ===
        candidate.numericPolicySetSha256,
      "candidate_numeric_policy_hash_mismatch",
    ],
    [
      manifest.numericCheckPolicySet.semanticSha256 ===
        candidate.numericPolicySetSemanticSha256,
      "candidate_numeric_policy_semantic_hash_mismatch",
    ],
    [
      policyArtifact.policySetId === manifest.numericCheckPolicySet.policySetId,
      "candidate_numeric_policy_id_mismatch",
    ],
    [
      policyArtifact.semanticSha256 ===
        manifest.numericCheckPolicySet.semanticSha256,
      "candidate_numeric_policy_detached_semantic_hash_mismatch",
    ],
  ];
  for (const [pass, blocker] of comparisons) if (!pass) blockers.push(blocker);

  const expectedEvidence = new Map(
    manifest.expectedEvidenceOutputs.map((entry) => [
      entry.evidenceRole,
      entry,
    ]),
  );
  for (const evidence of artifact.evidence) {
    const expected = expectedEvidence.get(evidence.evidenceId);
    const receipt = artifact.runtimeReceipts.find(
      (entry) => entry.receiptId === evidence.receiptId,
    );
    if (
      expected == null ||
      expected.outputPath !== evidence.artifactPath ||
      expected.contractVersion !== evidence.artifactContractVersion ||
      expected.receiptId !== evidence.receiptId ||
      expected.runId !== evidence.runId ||
      expected.runtimeId !== receipt?.runtimeId ||
      expected.requestId !== receipt?.outputs.artifactManifest?.requestId
    ) {
      blockers.push(
        `candidate_manifest_evidence_binding_mismatch:${evidence.evidenceId}`,
      );
    }
  }

  const policyById = new Map(
    policyArtifact.policies.map((policy) => [policy.checkId, policy]),
  );
  for (const evidence of artifact.evidence) {
    for (const checkId of NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS[
      evidence.evidenceId
    ]) {
      const comparator = (
        NHM2_EXPERIMENT_READY_THEORY_CLOSURE_NUMERIC_CHECK_POLICIES as Record<
          string,
          "lt" | "lte" | "gt" | "gte" | undefined
        >
      )[checkId];
      const check = evidence.checks[checkId];
      const expectedFrozenPolicyId = `${evidence.evidenceId}.${checkId}`;
      if (comparator == null) {
        const nonNumericPolicySha256 =
          computeNhm2ExperimentReadyTheoryCandidateNonNumericCheckPolicySha256({
            evidenceRole: evidence.evidenceId,
            checkId,
          });
        if (
          check == null ||
          check.frozenPolicyId !== expectedFrozenPolicyId ||
          check.frozenPolicySha256 !== nonNumericPolicySha256 ||
          check.policySetSemanticSha256 !==
            manifest.numericCheckPolicySet.semanticSha256 ||
          check.policyManifestSha256 !== candidate.candidateManifestSha256 ||
          check.metricValue !== null ||
          check.tolerance !== null ||
          check.units !== null
        ) {
          blockers.push(
            `candidate_non_numeric_check_policy_binding_mismatch:${evidence.evidenceId}:${checkId}`,
          );
        }
        continue;
      }
      const policy = policyById.get(
        checkId as Nhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifactV1["policies"][number]["checkId"],
      );
      const policySha256 =
        policy == null
          ? null
          : computeNhm2ExperimentReadyTheoryCandidateNumericPolicyEntrySha256(
              policy,
            );
      if (
        check == null ||
        policy == null ||
        check.frozenPolicyId !== expectedFrozenPolicyId ||
        policy.evidenceRole !== evidence.evidenceId ||
        policy.comparator !== comparator ||
        check.tolerance !== policy.threshold ||
        check.units !== policy.unit ||
        check.frozenPolicySha256 !== policySha256 ||
        check.policySetSemanticSha256 !==
          manifest.numericCheckPolicySet.semanticSha256 ||
        check.policyManifestSha256 !== candidate.candidateManifestSha256
      ) {
        blockers.push(
          `candidate_numeric_policy_binding_mismatch:${evidence.evidenceId}:${checkId}`,
        );
        continue;
      }
      const metricValue = check.metricValue;
      const compareNumeric = (
        operator: string,
        value: number,
        threshold: number,
      ): boolean => {
        if (operator === "lt") return value < threshold;
        if (operator === "lte") return value <= threshold;
        if (operator === "gt") return value > threshold;
        return value >= threshold;
      };
      const numericPass =
        metricValue != null &&
        compareNumeric(comparator, metricValue, policy.threshold);
      if (metricValue == null || check.pass !== numericPass) {
        blockers.push(
          `candidate_numeric_policy_result_mismatch:${evidence.evidenceId}:${checkId}`,
        );
      }
    }
  }

  for (const plan of manifest.executionPlans) {
    const receipt = artifact.runtimeReceipts.find(
      (entry) => entry.receiptId === plan.receiptId,
    );
    const execution = receipt?.execution;
    const resolvedEnvironment = Object.fromEntries(
      plan.expectedInvocation.environment.map((entry) => [
        entry.name,
        entry.valueKind === "candidate_manifest_raw_sha256"
          ? candidate.candidateManifestSha256
          : entry.value,
      ]),
    );
    if (
      receipt == null ||
      receipt.runtimeId !== plan.runtimeId ||
      receipt.provenance.gitSha !== plan.sourceCommitSha ||
      receipt.outputs.artifactManifest?.requestId !== plan.requestId ||
      receipt.args.entrypointCommand !== plan.expectedInvocation.entrypoint ||
      execution?.command !== plan.expectedInvocation.command ||
      !sameJson(execution.args, plan.expectedInvocation.args) ||
      execution.cwd !== plan.expectedInvocation.cwd ||
      !sameJson(execution.environment, resolvedEnvironment) ||
      execution.outputDirectory !== plan.expectedInvocation.outputDirectory
    ) {
      blockers.push(`candidate_execution_plan_mismatch:${plan.planRole}`);
    }
    const startedAt = receipt?.provenance.startedAt;
    if (
      startedAt == null ||
      Date.parse(manifest.frozenAt) >= Date.parse(startedAt)
    ) {
      blockers.push(
        `candidate_manifest_not_frozen_before_run:${plan.planRole}`,
      );
    }
  }
  return blockers;
}

async function verifyGitCommit(
  projectRoot: string,
  gitSha: string,
): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${gitSha}^{commit}`], {
      cwd: projectRoot,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function evaluateNhm2ExperimentReadyTheoryClosureFilesystem(input: {
  projectRoot: string;
  artifactPath: string;
  artifact: unknown;
  verifyGitObjects?: boolean;
}): Promise<Nhm2TheoryClosureFilesystemEvaluationV1> {
  const projectRoot = path.resolve(input.projectRoot);
  const blockers: string[] = [];
  if (!isNhm2ExperimentReadyTheoryClosureArtifact(input.artifact)) {
    return {
      status: "not_ready",
      gateStatus: "not_ready",
      filesystemVerified: false,
      candidateManifestValidated: false,
      evidenceAdapterCoverageComplete: false,
      blockers: ["theory_closure_artifact_schema_invalid"],
      artifactPath: input.artifactPath,
    };
  }
  const artifact = input.artifact;

  const closureFile = await readBoundJsonFile({
    projectRoot,
    repoPath: input.artifactPath,
  });
  if (closureFile.blocker)
    blockers.push(`closure_artifact:${closureFile.blocker}`);
  if (closureFile.file != null && !sameJson(closureFile.file.data, artifact)) {
    blockers.push("closure_artifact_bytes_do_not_match_parsed_value");
  }

  const receiptVerification = new Map<
    string,
    TheoryRuntimeReceiptFilesystemVerificationV1
  >();
  for (const receipt of artifact.runtimeReceipts) {
    const verification = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });
    receiptVerification.set(receipt.receiptId, verification);
    blockers.push(
      ...verification.blockers.map(
        (blocker) => `receipt:${receipt.receiptId}:${blocker}`,
      ),
    );
    if (receipt.status !== "completed")
      blockers.push(`receipt_not_completed:${receipt.receiptId}`);
    if (receipt.execution?.exitCode !== 0)
      blockers.push(`receipt_exit_code_not_zero:${receipt.receiptId}`);
    if (receipt.claimBoundary.currentTier === "certified") {
      blockers.push(`receipt_certified_tier_forbidden:${receipt.receiptId}`);
    }
    if (receipt.claimBoundary.promotionAllowed) {
      blockers.push(
        `receipt_promotion_authority_forbidden:${receipt.receiptId}`,
      );
    }
    const evidenceBindings = artifact.evidence.filter(
      (evidence) => evidence.receiptId === receipt.receiptId,
    );
    const receiptPath =
      receipt.receiptId === artifact.candidate.primaryReceiptId
        ? artifact.candidate.primaryReceiptPath
        : evidenceBindings[0]?.receiptPath;
    const receiptSha256 =
      receipt.receiptId === artifact.candidate.primaryReceiptId
        ? artifact.candidate.primaryReceiptSha256
        : evidenceBindings[0]?.receiptSha256;
    if (receiptPath == null || receiptSha256 == null) {
      blockers.push(`receipt_persistence_binding_missing:${receipt.receiptId}`);
    } else {
      if (!PERSISTED_RECEIPT_PATH.test(receiptPath)) {
        blockers.push(
          `receipt_persistence_store_path_invalid:${receipt.receiptId}`,
        );
      }
      if (
        evidenceBindings.some(
          (evidence) =>
            evidence.receiptPath !== receiptPath ||
            evidence.receiptSha256 !== receiptSha256,
        )
      ) {
        blockers.push(
          `receipt_persistence_binding_inconsistent:${receipt.receiptId}`,
        );
      }
      const persisted = await readBoundJsonFile({
        projectRoot,
        repoPath: receiptPath,
        expectedSha256: receiptSha256,
      });
      if (persisted.blocker) {
        blockers.push(
          `receipt_persistence:${receipt.receiptId}:${persisted.blocker}`,
        );
      } else if (
        persisted.file != null &&
        !sameJson(persisted.file.data, receipt)
      ) {
        blockers.push(
          `receipt_persistence_content_mismatch:${receipt.receiptId}`,
        );
      }
    }
  }

  const candidateManifestBlockerStart = blockers.length;
  const preRunSeedFiles: BoundJsonFile[] = [];
  let verifiedPreRunReferences = new Map<string, string>();
  const manifestRead = await readBoundJsonFile({
    projectRoot,
    repoPath: artifact.candidate.candidateManifestPath,
    expectedSha256: artifact.candidate.candidateManifestSha256,
  });
  if (manifestRead.blocker)
    blockers.push(`candidate_manifest:${manifestRead.blocker}`);
  if (manifestRead.file != null) preRunSeedFiles.push(manifestRead.file);
  const candidateManifest =
    manifestRead.file != null &&
    isNhm2ExperimentReadyTheoryCandidateManifest(manifestRead.file.data)
      ? manifestRead.file.data
      : null;
  if (manifestRead.file != null && candidateManifest == null) {
    blockers.push("candidate_manifest_schema_invalid");
  }
  if (candidateManifest != null) {
    if (!candidateManifest.readiness.preRunManifestReady)
      blockers.push("candidate_manifest_not_ready");

    const ordinaryBindings: Array<{
      binding: Nhm2ExperimentReadyTheoryCandidateHashedBindingV1;
      identityFields: Record<string, string>;
    }> = [
      {
        binding: candidateManifest.bindings.candidate,
        identityFields: {
          candidateId: candidateManifest.bindings.candidate.candidateId,
        },
      },
      {
        binding: candidateManifest.bindings.profile,
        identityFields: {
          selectedProfileId:
            candidateManifest.bindings.profile.selectedProfileId,
        },
      },
      {
        binding: candidateManifest.bindings.chart,
        identityFields: { chartId: candidateManifest.bindings.chart.chartId },
      },
      {
        binding: candidateManifest.bindings.atlas,
        identityFields: { atlasId: candidateManifest.bindings.atlas.atlasId },
      },
      {
        binding: candidateManifest.bindings.units,
        identityFields: { unitsId: candidateManifest.bindings.units.unitsId },
      },
      {
        binding: candidateManifest.bindings.normalization,
        identityFields: {
          normalizationId:
            candidateManifest.bindings.normalization.normalizationId,
        },
      },
    ];
    for (const plan of candidateManifest.executionPlans) {
      ordinaryBindings.push(
        {
          binding: plan.solver,
          identityFields: {
            solverId: plan.solver.solverId,
            solverVersion: plan.solver.solverVersion,
            implementationId: plan.solver.implementationId,
          },
        },
        {
          binding: plan.environmentLock,
          identityFields: {
            environmentId: plan.environmentLock.environmentId,
          },
        },
      );
    }
    for (const { binding, identityFields } of ordinaryBindings) {
      const read = await readBoundJsonFile({
        projectRoot,
        repoPath: binding.path,
        expectedSha256: binding.sha256,
      });
      if (read.blocker) {
        blockers.push(
          `candidate_binding:${binding.artifactId}:${read.blocker}`,
        );
      } else if (read.file != null) {
        preRunSeedFiles.push(read.file);
        blockers.push(
          ...descriptorBindingBlockers({
            binding,
            data: read.file.data,
            identityFields,
          }),
        );
      }
    }

    const policySetRead = await readBoundJsonFile({
      projectRoot,
      repoPath: candidateManifest.numericCheckPolicySet.artifactPath,
      expectedSha256: candidateManifest.numericCheckPolicySet.artifactRawSha256,
    });
    let policyArtifact: Nhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifactV1 | null =
      null;
    if (policySetRead.blocker) {
      blockers.push(`candidate_numeric_policy_set:${policySetRead.blocker}`);
    } else if (policySetRead.file != null) {
      preRunSeedFiles.push(policySetRead.file);
      if (
        !isNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact(
          policySetRead.file.data,
        )
      ) {
        blockers.push("candidate_numeric_policy_set_schema_invalid");
      } else {
        policyArtifact = policySetRead.file.data;
      }
    }
    if (policyArtifact == null) {
      blockers.push("candidate_manifest_comparison_requires_valid_policy_set");
    } else {
      blockers.push(
        ...compareCandidateManifest({
          artifact,
          manifest: candidateManifest,
          policyArtifact,
        }),
      );
    }

    const supersessionRead = await readBoundJsonFile({
      projectRoot,
      repoPath: candidateManifest.supersession.policyPath,
      expectedSha256: candidateManifest.supersession.policySha256,
    });
    if (supersessionRead.blocker) {
      blockers.push(
        `candidate_supersession_policy:${supersessionRead.blocker}`,
      );
    } else if (supersessionRead.file != null) {
      preRunSeedFiles.push(supersessionRead.file);
      const policy = supersessionRead.file.data;
      if (
        !isRecord(policy) ||
        policy.policyId !== candidateManifest.supersession.policyId ||
        policy.contractVersion !==
          candidateManifest.supersession.policyContractVersion
      ) {
        blockers.push("candidate_supersession_policy_identity_mismatch");
      }
    }

    const preRunClosure = await verifyPreRunReferenceClosure({
      projectRoot,
      seeds: preRunSeedFiles,
    });
    verifiedPreRunReferences = preRunClosure.verified;
    blockers.push(
      ...preRunClosure.blockers.map((blocker) => `candidate_input:${blocker}`),
    );
  }
  const candidateManifestValidated =
    candidateManifest != null &&
    blockers.length === candidateManifestBlockerStart;

  const allEvidenceData = new Map<
    Nhm2ExperimentReadyTheoryClosureEvidenceId,
    unknown
  >();
  for (const evidence of artifact.evidence) {
    const verification = receiptVerification.get(evidence.receiptId);
    const file =
      verification == null
        ? null
        : receiptFileMap(verification).get(evidence.artifactPath);
    if (file == null) continue;
    try {
      allEvidenceData.set(
        evidence.evidenceId,
        JSON.parse(file.bytes.toString("utf8")) as unknown,
      );
    } catch {
      // The evidence loop below emits the typed JSON blocker.
    }
  }

  const primaryPlan = candidateManifest?.executionPlans.find(
    (entry) => entry.planRole === "primary_numerical",
  );
  const primaryReceipt =
    primaryPlan == null
      ? null
      : (artifact.runtimeReceipts.find(
          (entry) => entry.receiptId === primaryPlan.receiptId,
        ) ?? null);
  const primaryVerification =
    primaryPlan == null
      ? null
      : (receiptVerification.get(primaryPlan.receiptId) ?? null);
  const primaryEvidence = artifact.evidence.find(
    (entry) => entry.evidenceId === "full_apparatus_source_tensor",
  );
  const verifiedPrimaryRunIdentity: Nhm2EvidenceNestedReferenceRunIdentity | null =
    primaryPlan == null
      ? null
      : {
          receiptId: primaryPlan.receiptId,
          runId: primaryPlan.runId,
          runtimeId: primaryPlan.runtimeId,
        };
  const primaryRunEligibleForCrossRunEvidence =
    primaryPlan != null &&
    primaryReceipt != null &&
    primaryVerification != null &&
    primaryVerification.ok &&
    primaryVerification.freshnessProofVerified &&
    primaryReceipt.status === "completed" &&
    primaryReceipt.execution?.exitCode === 0 &&
    primaryReceipt.runtimeId === primaryPlan.runtimeId &&
    primaryReceipt.args.runId === primaryPlan.runId &&
    primaryReceipt.outputs.artifactManifest?.requestId ===
      primaryPlan.requestId &&
    primaryReceipt.outputs.artifactManifest?.runtimeId ===
      primaryPlan.runtimeId &&
    artifact.candidate.primaryReceiptId === primaryPlan.receiptId &&
    artifact.candidate.primaryRunId === primaryPlan.runId &&
    artifact.candidate.primaryRuntimeId === primaryPlan.runtimeId &&
    primaryEvidence?.receiptId === primaryPlan.receiptId &&
    primaryEvidence.runId === primaryPlan.runId;
  const verifiedPrimaryRunOutputs: Nhm2EvidenceNestedReferenceVerifiedPriorRunOutput[] =
    primaryRunEligibleForCrossRunEvidence &&
    primaryVerification != null &&
    verifiedPrimaryRunIdentity != null
      ? primaryVerification.files
          .filter((entry) => entry.freshness === "new")
          .map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
            sizeBytes: entry.sizeBytes,
            freshness: entry.freshness,
            ...verifiedPrimaryRunIdentity,
          }))
      : [];
  const verifiedPrimaryRunOutputSha256 = new Map(
    verifiedPrimaryRunOutputs.map((entry) => [
      normalizeRepoPath(entry.path),
      entry.sha256.toLowerCase(),
    ]),
  );

  let adapterCoverageComplete = true;
  for (const evidence of artifact.evidence) {
    const verification = receiptVerification.get(evidence.receiptId);
    const file =
      verification == null
        ? null
        : receiptFileMap(verification).get(evidence.artifactPath);
    if (file == null) {
      blockers.push(`evidence_not_in_verified_receipt:${evidence.evidenceId}`);
      adapterCoverageComplete = false;
      continue;
    }
    if (file.sha256.toLowerCase() !== evidence.sha256.toLowerCase()) {
      blockers.push(`evidence_hash_mismatch:${evidence.evidenceId}`);
    }
    if (file.freshness !== "new") {
      blockers.push(`evidence_not_new:${evidence.evidenceId}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(file.bytes.toString("utf8")) as unknown;
    } catch {
      blockers.push(`evidence_json_invalid:${evidence.evidenceId}`);
      adapterCoverageComplete = false;
      continue;
    }
    const expectedVersion =
      NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
        evidence.evidenceId
      ];
    if (evidence.artifactContractVersion !== expectedVersion) {
      blockers.push(
        `evidence_contract_version_mismatch:${evidence.evidenceId}`,
      );
    }
    const receipt =
      artifact.runtimeReceipts.find(
        (entry) => entry.receiptId === evidence.receiptId,
      ) ?? null;
    const validation = evidenceArtifactValidation({
      evidence,
      data,
      candidate: artifact.candidate,
      manifest: candidateManifest,
      allEvidence: artifact.evidence,
      allEvidenceData,
      receipt,
    });
    adapterCoverageComplete &&= validation.supported;
    if (!validation.valid) {
      adapterCoverageComplete = false;
      blockers.push(
        `evidence:${evidence.evidenceId}:adapter_validation_failed`,
      );
    }
    blockers.push(
      ...validation.blockers.map(
        (blocker) => `evidence:${evidence.evidenceId}:${blocker}`,
      ),
    );
    const fileByPath =
      verification == null ? new Map() : receiptFileMap(verification);
    const plan = candidateManifest?.executionPlans.find(
      (entry) => entry.receiptId === evidence.receiptId,
    );
    if (verification == null || plan == null) {
      blockers.push(
        `evidence_nested_reference_context_missing:${evidence.evidenceId}`,
      );
    } else {
      const nestedReferenceVerification =
        await verifyNhm2EvidenceNestedReferences({
          projectRoot,
          evidenceId: evidence.evidenceId,
          planOutputDirectory: plan.expectedInvocation.outputDirectory,
          allowedImmutableInputPaths: [...verifiedPreRunReferences.keys()],
          receiptManifestEntries: verification.files.map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
            sizeBytes: entry.sizeBytes,
            freshness: entry.freshness,
          })),
          owningRunIdentity: {
            receiptId: plan.receiptId,
            runId: plan.runId,
            runtimeId: plan.runtimeId,
          },
          expectedPriorRunIdentity:
            evidence.evidenceId === "independent_numerical_replication"
              ? (verifiedPrimaryRunIdentity ?? undefined)
              : undefined,
          verifiedPriorRunOutputs:
            evidence.evidenceId === "independent_numerical_replication"
              ? verifiedPrimaryRunOutputs
              : [],
          evidence: data,
        });
      blockers.push(
        ...nestedReferenceVerification.blockers.map(
          (blocker) =>
            `evidence_nested_reference:${evidence.evidenceId}:${blocker}`,
        ),
      );
      if (
        evidence.evidenceId === "formal_manifest_certificate" &&
        file != null
      ) {
        const formalV2Verification =
          await verifyNhm2FormalOuterObservationV2Filesystem({
            projectRoot,
            candidate: artifact.candidate,
            candidateManifest,
            candidateManifestFile: manifestRead.file,
            evidence,
            publishedData: data,
            publishedFile: file,
            receipt,
            receiptVerification: verification,
          });
        if (!formalV2Verification.valid) {
          adapterCoverageComplete = false;
          blockers.push(
            "evidence:formal_manifest_certificate:adapter_validation_failed",
          );
        }
        blockers.push(
          ...formalV2Verification.blockers.map(
            (blocker) => `evidence:formal_manifest_certificate:${blocker}`,
          ),
        );
      }
    }
    for (const ref of collectHashedRefs(data)) {
      const refPath = normalizeRepoPath(withoutFragment(ref.path));
      const bound = fileByPath.get(refPath);
      const preRunSha256 = verifiedPreRunReferences.get(refPath);
      const verifiedPriorSha256 =
        evidence.evidenceId === "independent_numerical_replication"
          ? verifiedPrimaryRunOutputSha256.get(refPath)
          : undefined;
      if (
        (bound == null || bound.sha256.toLowerCase() !== ref.sha256) &&
        preRunSha256 !== ref.sha256 &&
        verifiedPriorSha256 !== ref.sha256
      ) {
        blockers.push(
          `evidence_internal_ref_unbound:${evidence.evidenceId}:${refPath}`,
        );
      }
    }
  }

  if (input.verifyGitObjects !== false) {
    const commits = unique([
      artifact.candidate.primaryGitSha,
      ...artifact.runtimeReceipts
        .map(
          (receipt: TheoryRuntimeReceiptV1) => receipt.provenance.gitSha ?? "",
        )
        .filter(Boolean),
    ]);
    for (const gitSha of commits) {
      if (!(await verifyGitCommit(projectRoot, gitSha)))
        blockers.push(`git_commit_unavailable:${gitSha}`);
    }
  }

  const uniqueBlockers = unique(blockers);
  const filesystemVerified = uniqueBlockers.length === 0;
  const replayedStatus: Nhm2TheoryClosureFilesystemEvaluationV1["status"] =
    artifact.gates.some((gate) => gate.status === "fail")
      ? "falsified"
      : artifact.gates.every((gate) => gate.status === "pass")
        ? "experiment_ready_theory_closed"
        : "not_ready";
  const status = filesystemVerified ? replayedStatus : "not_ready";
  return {
    status,
    gateStatus:
      status === "experiment_ready_theory_closed"
        ? "pass"
        : status === "falsified"
          ? "fail"
          : "not_ready",
    filesystemVerified,
    candidateManifestValidated,
    evidenceAdapterCoverageComplete: adapterCoverageComplete,
    blockers: uniqueBlockers,
    artifactPath: input.artifactPath,
  };
}
