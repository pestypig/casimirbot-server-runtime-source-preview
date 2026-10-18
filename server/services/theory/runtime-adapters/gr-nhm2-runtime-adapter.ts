import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  buildTheoryRuntimeReceiptV1,
  validateTheoryRuntimeOutputManifestV1,
  type TheoryRuntimeArtifactEvidenceV1,
  type TheoryRuntimeOutputManifestV1,
  type TheoryRuntimeGateStatus,
  type TheoryRuntimeReceiptStatus,
  type TheoryRuntimeReceiptV1,
} from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { isNhm2LeanCampaignCertificateV1 } from "../../../../shared/contracts/nhm2-lean-campaign-certificate.v1";
import { NHM2_EXPERIMENT_READY_THEORY_CLOSURE_CONTRACT_VERSION } from "../../../../shared/contracts/nhm2-experiment-ready-theory-closure.v1";
import {
  NHM2_ALPHA07_EXPECTED_CERTIFICATE_PIN_IDS,
  NHM2_ALPHA07_EXPECTED_PACKAGE_ARTIFACTS,
  NHM2_ALPHA07_HISTORICAL_RUNTIME_ID,
  NHM2_ALPHA07_IMPORT_MANIFEST_GENERATED_AT,
  NHM2_ALPHA07_IMPORT_MANIFEST_PATH,
  NHM2_ALPHA07_PACKAGE_DIRECTORY,
  NHM2_ALPHA07_PROFILE_ID,
  NHM2_ALPHA07_SOURCE_COMMIT,
} from "../../../../shared/theory/nhm2-alpha07-historical-import-governance";
import { buildStaticGrTensorTraceV1 } from "../../../../shared/theory/runtime-traces/static-gr-tensor-trace";
import type {
  TheoryRuntimeAdapter,
  TheoryRuntimeAdapterInput,
} from "./theory-runtime-adapter-types";
import { readJsonArtifactFile } from "./json-artifact-reader";
import {
  evaluateNhm2ExperimentReadyTheoryClosureFilesystem,
  type Nhm2TheoryClosureFilesystemEvaluationV1,
} from "../nhm2-experiment-ready-theory-closure-evaluator";

export const GR_NHM2_RUNTIME_ADAPTER_ID = "gr_nhm2.artifact_reader" as const;
export const GR_NHM2_LANE_ID = "warp_gr_nhm2" as const;

export const GR_NHM2_SUPPORTED_BADGE_IDS = [
  "physics.gr.einstein_field_equation",
  "physics.gr.stress_energy_conservation",
  "physics.gr.3p1_decomposition",
  "nhm2.geometry.lapse_shift_profile",
  "nhm2.source.energy_density_proxy",
  "nhm2.closure.source_residual",
  "nhm2.source.wall_t00_trace",
  "nhm2.tensor.full_authority_gate",
  "nhm2.tensor.same_chart_full_tensor",
  "nhm2.natario.curvature_invariants",
  "nhm2.natario.invariant_audit",
  "nhm2.energy_condition.observer_robust_gate",
  "nhm2.energy_condition.diagnostic_gate",
  "nhm2.formal.lean_certificate",
  "nhm2.formal.certificate_hashes_pinned",
  "nhm2.formal.diagnostic_campaign_admissible",
  "nhm2.formal.claim_locks_closed",
  "nhm2.formal.negative_fixtures_fail_closed",
  "nhm2.mechanical.support_retention_overlap",
  "nhm2.meta.experiment_ready_theory_closure",
  "nhm2.claim_boundary.diagnostic_only",
] as const;

export const GR_NHM2_ARTIFACT_ROOTS = [
  "artifacts/research/full-solve/selected-family/nhm2-shift-lapse",
  "artifacts/research/full-solve/profile-campaign-runs/stage1_centerline_alpha_0p7000_observer_compatible_source_campaign_screen_v1",
  "artifacts/research/full-solve/theory-closure-evaluations",
  "docs/audits/research/selected-family/nhm2-shift-lapse",
] as const;

export const GR_NHM2_ALPHA07_SOURCE_COMMIT = NHM2_ALPHA07_SOURCE_COMMIT;
export const GR_NHM2_ALPHA07_HISTORICAL_MANIFEST_PATH =
  NHM2_ALPHA07_IMPORT_MANIFEST_PATH;
const GR_NHM2_FORMAL_BADGE_IDS = new Set([
  "nhm2.formal.lean_certificate",
  "nhm2.formal.certificate_hashes_pinned",
  "nhm2.formal.diagnostic_campaign_admissible",
  "nhm2.formal.claim_locks_closed",
  "nhm2.formal.negative_fixtures_fail_closed",
]);
const GR_NHM2_ALPHA07_EXPECTED_PIN_IDS = new Set(
  NHM2_ALPHA07_EXPECTED_CERTIFICATE_PIN_IDS,
);
const GR_NHM2_THEORY_CLOSURE_BADGE_ID =
  "nhm2.meta.experiment_ready_theory_closure" as const;

const REQUIRED_GATE_IDS = [
  "source_closure",
  "qei_applicability",
  "observer_audit",
  "hard_constraints",
  "certificate_issued",
  "certificate_integrity",
] as const;

const SCALAR_KEYS = [
  "curvatureRatio",
  "marginRatio",
  "qeiMargin",
  "tauSelected",
  "sourceClosureResidualRms",
  "sourceClosureResidualMax",
  "sourceClosureWallT00RelLInf",
  "wallT00RelLInf",
  "properTimeS",
  "savedDays",
  "betaOverAlphaMax",
  "wallHorizonMargin",
  "weylScalar",
  "ricciInvariant",
] as const;

type RequiredGateId = (typeof REQUIRED_GATE_IDS)[number];
type ParsedArtifact = {
  relativePath: string;
  data: unknown;
  sha256: string;
};

type HistoricalArtifact = ParsedArtifact & {
  sha256: string;
  hashMatchesManifest: boolean;
};

type HistoricalAlpha07Package = {
  manifest: TheoryRuntimeOutputManifestV1;
  artifacts: HistoricalArtifact[];
  artifactEvidence: TheoryRuntimeArtifactEvidenceV1[];
  gates: Record<string, TheoryRuntimeGateStatus>;
  issues: string[];
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeGateStatuses(
  statuses: TheoryRuntimeGateStatus[],
): TheoryRuntimeGateStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("review")) return "review";
  if (statuses.includes("not_ready")) return "not_ready";
  if (statuses.includes("unknown")) return "unknown";
  if (statuses.includes("pass")) return "pass";
  if (statuses.includes("not_applicable")) return "not_applicable";
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isPortableRepoPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.split("/").includes("..")
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function statusFromBoolean(value: unknown): TheoryRuntimeGateStatus {
  return value === true ? "pass" : value === false ? "fail" : "not_ready";
}

function walk(
  value: unknown,
  visit: (key: string, entry: unknown, keyPath: string) => void,
  prefix = "",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, `${prefix}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    visit(key, entry, keyPath);
    walk(entry, visit, keyPath);
  }
}

function candidateValueFromRecord(value: Record<string, unknown>): unknown {
  for (const key of [
    "status",
    "state",
    "verdict",
    "result",
    "passed",
    "pass",
    "ok",
    "valid",
    "issued",
  ]) {
    if (key in value) return value[key];
  }
  return undefined;
}

function gateStatusFromValue(value: unknown): TheoryRuntimeGateStatus {
  if (isRecord(value))
    return gateStatusFromValue(candidateValueFromRecord(value));
  if (typeof value === "boolean") return value ? "pass" : "fail";
  if (typeof value !== "string") return "unknown";
  const normalized = normalizeKey(value);
  if (
    [
      "pass",
      "passed",
      "ok",
      "valid",
      "issued",
      "complete",
      "completed",
      "admissible",
    ].includes(normalized)
  ) {
    return "pass";
  }
  if (
    ["fail", "failed", "false", "inadmissible", "invalid"].includes(normalized)
  )
    return "fail";
  if (["review", "auditreview", "diagnostic"].includes(normalized))
    return "review";
  if (
    [
      "missing",
      "notready",
      "notrun",
      "blocked",
      "unavailable",
      "notissued",
      "none",
      "null",
    ].includes(normalized)
  ) {
    return "not_ready";
  }
  if (["notapplicable", "na"].includes(normalized)) return "not_applicable";
  return "unknown";
}

function hasExplicitUnknownGateValue(value: unknown): boolean {
  const candidate = isRecord(value) ? candidateValueFromRecord(value) : value;
  return typeof candidate === "string" && normalizeKey(candidate) === "unknown";
}

function gateIdForKey(
  fieldName: string,
  keyPath: string,
): RequiredGateId | null {
  const field = normalizeKey(fieldName);
  const key = normalizeKey(keyPath);
  const statusBearingField =
    /status|state|verdict|result|passed|pass|ok|valid|issued|complete|satisfied|admissible/.test(
      field,
    );
  if (
    /certificate.*integrity|integrity.*certificate/.test(key) &&
    (statusBearingField || /integrity/.test(field))
  ) {
    return "certificate_integrity";
  }
  if (
    /certissued|certificateissued|certificatestatus|certificatediagnosticcampaignadmissible/.test(
      key,
    ) &&
    statusBearingField
  ) {
    return "certificate_issued";
  }
  if (
    /sourceclosure|closureresidual|sourceresidual/.test(key) &&
    (statusBearingField ||
      ["sourceclosure", "closureresidual", "sourceresidual"].includes(field))
  ) {
    return "source_closure";
  }
  if (
    /qei/.test(key) &&
    (statusBearingField || ["qei", "qeiapplicability"].includes(field))
  ) {
    return "qei_applicability";
  }
  if (
    /observer|dualtensor|timelikeobserver|nullobserver/.test(key) &&
    (statusBearingField || ["observeraudit", "observerrobust"].includes(field))
  ) {
    return "observer_audit";
  }
  if (
    /hardconstraints|hardconstraint|hardgate|constraintsverdict/.test(key) &&
    (statusBearingField ||
      ["hardconstraints", "hardconstraint", "hardgate"].includes(field))
  ) {
    return "hard_constraints";
  }
  return null;
}

function collectGates(
  artifacts: ParsedArtifact[],
): Record<string, TheoryRuntimeGateStatus> {
  const candidates = new Map<RequiredGateId, TheoryRuntimeGateStatus[]>();
  const sourceClosureAggregate: TheoryRuntimeGateStatus[] = [];
  const sourceClosureArtifacts: TheoryRuntimeGateStatus[] = [];
  const observerAggregate: TheoryRuntimeGateStatus[] = [];
  const observerArtifacts: TheoryRuntimeGateStatus[] = [];
  for (const artifact of artifacts) {
    walk(artifact.data, (key, entry, keyPath) => {
      const gateId = gateIdForKey(key, keyPath);
      if (!gateId) return;
      const status = gateStatusFromValue(entry);
      if (status === "unknown" && !hasExplicitUnknownGateValue(entry)) return;
      const statuses = candidates.get(gateId) ?? [];
      statuses.push(status);
      candidates.set(gateId, statuses);
      const artifactLevel =
        /artifact(?:refs?|evidence|status)|supportingartifact/i.test(keyPath);
      if (gateId === "source_closure") {
        (artifactLevel ? sourceClosureArtifacts : sourceClosureAggregate).push(
          status,
        );
      }
      if (gateId === "observer_audit") {
        (artifactLevel ? observerArtifacts : observerAggregate).push(status);
      }
    });
  }
  const gates = Object.fromEntries(
    Array.from(candidates.entries()).map(([gateId, statuses]) => [
      gateId,
      mergeGateStatuses(statuses),
    ]),
  ) as Record<string, TheoryRuntimeGateStatus>;
  if (sourceClosureAggregate.length > 0) {
    gates.source_closure_aggregate = mergeGateStatuses(sourceClosureAggregate);
  }
  if (sourceClosureArtifacts.length > 0) {
    gates.source_closure_artifact = mergeGateStatuses(sourceClosureArtifacts);
  }
  if (observerAggregate.length > 0) {
    gates.observer_audit_aggregate = mergeGateStatuses(observerAggregate);
  }
  if (observerArtifacts.length > 0) {
    gates.observer_audit_artifact = mergeGateStatuses(observerArtifacts);
  }
  return gates;
}

async function collectExperimentReadyTheoryClosureGate(
  projectRoot: string,
  artifacts: ParsedArtifact[],
): Promise<Nhm2TheoryClosureFilesystemEvaluationV1 | null> {
  const closureArtifacts = artifacts.filter(
    (artifact) =>
      isRecord(artifact.data) &&
      artifact.data.contractVersion ===
        NHM2_EXPERIMENT_READY_THEORY_CLOSURE_CONTRACT_VERSION,
  );
  if (closureArtifacts.length === 0) return null;
  if (closureArtifacts.length > 1) {
    return {
      status: "not_ready",
      gateStatus: "fail",
      filesystemVerified: false,
      candidateManifestValidated: false,
      evidenceAdapterCoverageComplete: false,
      blockers: ["duplicate_theory_closure_artifacts"],
      artifactPath: closureArtifacts
        .map((artifact) => artifact.relativePath)
        .join(","),
    };
  }
  const artifact = closureArtifacts[0];
  return evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
    projectRoot,
    artifactPath: artifact.relativePath,
    artifact: artifact.data,
  });
}

function requestsExperimentReadyTheoryClosure(
  input: TheoryRuntimeAdapterInput,
): boolean {
  return (
    !input.badgeIds?.length ||
    input.badgeIds.includes(GR_NHM2_THEORY_CLOSURE_BADGE_ID)
  );
}

function collectScalars(
  artifacts: ParsedArtifact[],
): Record<string, number | string | boolean | null> {
  const scalarByNormalizedKey = new Map(
    SCALAR_KEYS.map((key) => [normalizeKey(key), key] as const),
  );
  const scalars: Record<string, number | string | boolean | null> = {};
  for (const artifact of artifacts) {
    walk(artifact.data, (key, entry) => {
      if (!(
        entry === null ||
        typeof entry === "number" ||
        typeof entry === "string" ||
        typeof entry === "boolean"
      )) {
        return;
      }
      const scalarKey = scalarByNormalizedKey.get(normalizeKey(key));
      if (scalarKey && !(scalarKey in scalars)) {
        scalars[scalarKey] = entry as number | string | boolean | null;
      }
    });
  }
  return scalars;
}

function missingSignalsForGates(
  gates: Record<string, TheoryRuntimeGateStatus>,
): string[] {
  return REQUIRED_GATE_IDS.flatMap((gateId) => {
    const status = gates[gateId];
    if (status === "review") return [`${gateId}_review`];
    if (
      !status ||
      status === "unknown" ||
      status === "not_ready" ||
      status === "not_applicable"
    ) {
      return [`${gateId}_missing`];
    }
    return [];
  });
}

function promotionBlockedBy(
  gates: Record<string, TheoryRuntimeGateStatus>,
  missingSignals: string[],
): string[] {
  return unique([
    ...missingSignals.map((signal) =>
      signal.replace(/_(?:missing|review)$/, ""),
    ),
    ...REQUIRED_GATE_IDS.filter((gateId) => gates[gateId] === "fail").map(
      (gateId) => `${gateId}_failed`,
    ),
  ]);
}

function receiptStatus(args: {
  artifactCount: number;
  parseFailed: boolean;
  missingSignals: string[];
}): TheoryRuntimeReceiptStatus {
  if (args.parseFailed) return "failed";
  if (args.artifactCount === 0) return "not_run";
  if (args.missingSignals.length > 0) return "blocked";
  return "completed";
}

async function readJsonArtifacts(
  projectRoot: string,
): Promise<ParsedArtifact[]> {
  return readJsonArtifactsUncached(projectRoot);
}

async function readJsonArtifactsUncached(
  projectRoot: string,
): Promise<ParsedArtifact[]> {
  const patterns = GR_NHM2_ARTIFACT_ROOTS.map(
    (root) => `${root.replace(/\\/g, "/")}/**/*.json`,
  );
  const paths = await fg(patterns, {
    cwd: projectRoot,
    onlyFiles: true,
    dot: false,
    unique: true,
    followSymbolicLinks: false,
  });
  const artifacts: ParsedArtifact[] = [];
  for (const relativePath of paths) {
    const absolutePath = path.resolve(projectRoot, relativePath);
    const bytes = await fs.readFile(absolutePath);
    artifacts.push({
      relativePath: normalizeRelativePath(relativePath),
      data: await readJsonArtifactFile(absolutePath),
      sha256: sha256(bytes),
    });
  }
  return artifacts;
}

function buildReadOnlyArtifactEvidence(
  artifacts: ParsedArtifact[],
): TheoryRuntimeArtifactEvidenceV1[] {
  return artifacts.map((artifact) => {
    const gates = collectGates([artifact]);
    return {
      path: artifact.relativePath,
      sha256: artifact.sha256,
      freshness: "preexisting",
      status: mergeGateStatuses(Object.values(gates)),
      gates,
    };
  });
}

async function readHistoricalAlpha07Package(
  projectRoot: string,
): Promise<HistoricalAlpha07Package> {
  const { validateNhm2Alpha07HistoricalImportManifest } =
    await import("../../../../tools/nhm2/govern-alpha07-historical-import");
  const issues = await validateNhm2Alpha07HistoricalImportManifest({
    repoRoot: projectRoot,
  });
  const manifestAbsolutePath = path.resolve(
    projectRoot,
    ...NHM2_ALPHA07_IMPORT_MANIFEST_PATH.split("/"),
  );
  const manifestValue: unknown = JSON.parse(
    await fs.readFile(manifestAbsolutePath, "utf8"),
  );
  const contractIssues = validateTheoryRuntimeOutputManifestV1(manifestValue);
  if (contractIssues.length > 0 || !isRecord(manifestValue)) {
    throw new Error(
      `Governed alpha=0.7 manifest contract failed: ${contractIssues.join("; ") || "not an object"}`,
    );
  }
  const manifest = manifestValue as TheoryRuntimeOutputManifestV1;
  const expectedEntryPaths = new Set(
    NHM2_ALPHA07_EXPECTED_PACKAGE_ARTIFACTS.map(
      (fileName) => `${NHM2_ALPHA07_PACKAGE_DIRECTORY}/${fileName}`,
    ),
  );
  const actualEntryPaths = new Set(manifest.entries.map((entry) => entry.path));
  if (
    expectedEntryPaths.size !== actualEntryPaths.size ||
    [...expectedEntryPaths].some(
      (entryPath) => !actualEntryPaths.has(entryPath),
    )
  ) {
    issues.push(
      "historical manifest inventory does not match the governed alpha=0.7 package",
    );
  }
  if (
    manifest.generatedAt !== NHM2_ALPHA07_IMPORT_MANIFEST_GENERATED_AT ||
    manifest.runtimeId !== NHM2_ALPHA07_HISTORICAL_RUNTIME_ID ||
    manifest.gitSha !== NHM2_ALPHA07_SOURCE_COMMIT ||
    manifest.outputDirectory !== NHM2_ALPHA07_PACKAGE_DIRECTORY ||
    manifest.manifestPath !== NHM2_ALPHA07_IMPORT_MANIFEST_PATH ||
    manifest.boundToExecution !== false ||
    manifest.requestId !== null ||
    manifest.startedAt !== null ||
    manifest.completedAt !== null ||
    manifest.manifestSha256 !== null
  ) {
    issues.push(
      "historical manifest identity or execution-boundary fields are not governed values",
    );
  }

  const packageDirectory = path.resolve(
    projectRoot,
    ...NHM2_ALPHA07_PACKAGE_DIRECTORY.split("/"),
  );
  const [realProjectRoot, realPackageDirectory] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(packageDirectory),
  ]);
  if (
    !isPathInside(realProjectRoot, realPackageDirectory) ||
    realPackageDirectory === realProjectRoot
  ) {
    throw new Error("Governed alpha=0.7 package escaped the repository root.");
  }

  const artifacts: HistoricalArtifact[] = [];
  for (const entry of manifest.entries) {
    if (!isPortableRepoPath(entry.path)) {
      issues.push(`historical manifest path is not portable: ${entry.path}`);
      continue;
    }
    const absolutePath = path.resolve(projectRoot, ...entry.path.split("/"));
    if (!isPathInside(packageDirectory, absolutePath)) {
      issues.push(
        `historical manifest entry escaped the package: ${entry.path}`,
      );
      continue;
    }
    const fileStat = await fs.lstat(absolutePath);
    if (fileStat.isSymbolicLink()) {
      issues.push(
        `historical manifest entry is a symbolic link: ${entry.path}`,
      );
      continue;
    }
    const realArtifactPath = await fs.realpath(absolutePath);
    if (!isPathInside(realPackageDirectory, realArtifactPath)) {
      issues.push(
        `historical manifest entry resolved outside the package: ${entry.path}`,
      );
      continue;
    }
    const bytes = await fs.readFile(absolutePath);
    const actualSha256 = sha256(bytes);
    const hashMatchesManifest =
      actualSha256 === entry.sha256 && bytes.byteLength === entry.sizeBytes;
    if (!hashMatchesManifest)
      issues.push(`historical artifact hash/size mismatch: ${entry.path}`);
    artifacts.push({
      relativePath: entry.path,
      data: await readJsonArtifactFile(absolutePath),
      sha256: actualSha256,
      hashMatchesManifest,
    });
  }

  const certificateArtifact = artifacts.find((artifact) =>
    artifact.relativePath.endsWith("/nhm2-lean-campaign-certificate.json"),
  );
  const certificate = certificateArtifact?.data;
  const certificateValid = isNhm2LeanCampaignCertificateV1(certificate);
  if (!certificateValid)
    issues.push("historical Lean campaign certificate contract is invalid");
  const pinIds = certificateValid
    ? new Set(certificate.artifactHashes.map((entry) => entry.artifactId))
    : new Set<string>();
  const certificatePinsComplete =
    certificateValid &&
    pinIds.size === GR_NHM2_ALPHA07_EXPECTED_PIN_IDS.size &&
    [...GR_NHM2_ALPHA07_EXPECTED_PIN_IDS].every((pinId) => pinIds.has(pinId));
  if (!certificatePinsComplete)
    issues.push("historical Lean certificate pin IDs are incomplete");
  const claimLocksClosed =
    certificateValid &&
    Object.values(certificate.claimLocks).every(
      (allowed) => allowed === false,
    ) &&
    certificate.clocking.routeEtaCertified === false;
  if (!claimLocksClosed)
    issues.push("historical Lean certificate claim locks are not all closed");

  const sourceClosureArtifact = artifacts.find((artifact) =>
    artifact.relativePath.endsWith(
      "/nhm2-regional-source-closure-evidence.json",
    ),
  );
  const sourceClosureData = isRecord(sourceClosureArtifact?.data)
    ? sourceClosureArtifact.data
    : null;
  const sourceClosureStatus = gateStatusFromValue(
    sourceClosureData?.overallState,
  );
  const integrityOk =
    issues.length === 0 &&
    artifacts.length === manifest.entries.length &&
    artifacts.every((artifact) => artifact.hashMatchesManifest);
  const gates: Record<string, TheoryRuntimeGateStatus> = {
    ...collectGates(artifacts),
    source_closure: sourceClosureStatus,
    source_closure_aggregate: sourceClosureStatus,
    source_closure_artifact: sourceClosureStatus,
    qei_applicability: certificateValid
      ? statusFromBoolean(certificate.qei.qeiReceiptsPass)
      : "not_ready",
    observer_audit: certificateValid
      ? statusFromBoolean(
          certificate.observer.observerFamilyPass &&
            certificate.observer.robustCheckComplete &&
            !certificate.observer.anyViolation,
        )
      : "not_ready",
    certificate_issued: certificateValid
      ? statusFromBoolean(certificate.certificate.diagnosticCampaignAdmissible)
      : "not_ready",
    certificate_integrity: integrityOk ? "pass" : "fail",
    formal_certificate_hashes_pinned:
      certificatePinsComplete && integrityOk ? "pass" : "fail",
    formal_claim_locks_closed: claimLocksClosed ? "pass" : "fail",
    formal_diagnostic_campaign_admissible: certificateValid
      ? statusFromBoolean(certificate.certificate.diagnosticCampaignAdmissible)
      : "not_ready",
    runtime_execution_provenance: "not_ready",
    runtime_artifact_freshness: "not_ready",
  };

  const artifactEvidence = artifacts.map((artifact) => {
    const artifactGates = collectGates([artifact]);
    if (artifact === sourceClosureArtifact)
      artifactGates.source_closure_artifact = sourceClosureStatus;
    if (artifact === certificateArtifact) {
      artifactGates.formal_certificate_contract = certificateValid
        ? "pass"
        : "fail";
      artifactGates.formal_claim_locks_closed = claimLocksClosed
        ? "pass"
        : "fail";
    }
    artifactGates.artifact_hash_integrity = artifact.hashMatchesManifest
      ? "pass"
      : "fail";
    const semanticStatuses = Object.entries(artifactGates)
      .filter(([gateId]) => gateId !== "artifact_hash_integrity")
      .map(([, status]) => status);
    return {
      path: artifact.relativePath,
      sha256: artifact.sha256,
      freshness: "preexisting" as const,
      status: artifact.hashMatchesManifest
        ? mergeGateStatuses(semanticStatuses)
        : ("fail" as const),
      gates: artifactGates,
    };
  });

  return {
    manifest,
    artifacts,
    artifactEvidence,
    gates,
    issues: unique(issues),
  };
}

function requestsGovernedAlpha07(input: TheoryRuntimeAdapterInput): boolean {
  return Boolean(
    input.badgeIds?.some((badgeId) => GR_NHM2_FORMAL_BADGE_IDS.has(badgeId)),
  );
}

function buildHistoricalAlpha07Receipt(input: {
  adapterInput: TheoryRuntimeAdapterInput;
  historical: HistoricalAlpha07Package;
}): TheoryRuntimeReceiptV1 {
  const generatedAt =
    input.adapterInput.generatedAt ?? new Date().toISOString();
  const gates = { ...input.historical.gates };
  if (requestsExperimentReadyTheoryClosure(input.adapterInput)) {
    gates.experiment_ready_theory_closure = "not_ready";
  }
  const missingSignals = unique([
    ...missingSignalsForGates(gates),
    requestsExperimentReadyTheoryClosure(input.adapterInput)
      ? "experiment_ready_theory_closure_missing"
      : "",
    "runtime_execution_provenance_unbound",
    "runtime_artifact_freshness_unbound",
    ...input.historical.issues.map(
      (_, index) => `alpha07_governance_issue_${index + 1}`,
    ),
  ]);
  const failedGates = Object.entries(gates)
    .filter(([, status]) => status === "fail")
    .map(([gateId]) => `${gateId}_failed`);
  const promotionBlocked = unique([
    ...promotionBlockedBy(gates, missingSignals),
    ...failedGates,
    "historical_import_not_execution_bound",
  ]);
  const warnings = unique([
    "Governed historical alpha=0.7 package; no backend runtime was executed.",
    "All package artifacts are preexisting and bound to a historical import manifest, not to a fresh execution interval.",
    ...input.historical.issues.map(
      (issue) => `Historical import governance: ${issue}`,
    ),
  ]);
  return buildTheoryRuntimeReceiptV1({
    generatedAt,
    receiptId: `runtime:${GR_NHM2_RUNTIME_ADAPTER_ID}:alpha07:${Date.now().toString(36)}`,
    runtimeId: GR_NHM2_RUNTIME_ADAPTER_ID,
    graphId: input.adapterInput.graphId ?? "nhm2-theory-badge-graph",
    badgeIds: input.adapterInput.badgeIds?.length
      ? input.adapterInput.badgeIds
      : [...GR_NHM2_FORMAL_BADGE_IDS],
    command: null,
    args: {
      adapter: GR_NHM2_RUNTIME_ADAPTER_ID,
      requestedRuntimeId: input.adapterInput.runtimeId ?? null,
      historicalRuntimeId: input.historical.manifest.runtimeId,
      artifactRoot: NHM2_ALPHA07_PACKAGE_DIRECTORY,
      manifestPath: NHM2_ALPHA07_IMPORT_MANIFEST_PATH,
    },
    status: "blocked",
    outputs: {
      artifacts: input.historical.artifacts.map(
        (artifact) => artifact.relativePath,
      ),
      scalars: collectScalars(input.historical.artifacts),
      units: {},
      gates,
      missingSignals,
      warnings,
      artifactManifest: input.historical.manifest,
      artifactEvidence: input.historical.artifactEvidence,
    },
    provenance: {
      gitSha: input.historical.manifest.gitSha,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed: false,
      promotionBlockedBy: promotionBlocked,
    },
  });
}

function buildReceipt(input: {
  adapterInput: TheoryRuntimeAdapterInput;
  artifacts: ParsedArtifact[];
  parseError: string | null;
  theoryClosureEvaluation?: Nhm2TheoryClosureFilesystemEvaluationV1 | null;
}): TheoryRuntimeReceiptV1 {
  const generatedAt =
    input.adapterInput.generatedAt ?? new Date().toISOString();
  const graphId = input.adapterInput.graphId ?? "nhm2-theory-badge-graph";
  const badgeIds = input.adapterInput.badgeIds?.length
    ? input.adapterInput.badgeIds
    : [...GR_NHM2_SUPPORTED_BADGE_IDS];
  const gates: Record<string, TheoryRuntimeGateStatus> = input.parseError
    ? {}
    : collectGates(input.artifacts);
  const theoryClosureRequested = requestsExperimentReadyTheoryClosure(
    input.adapterInput,
  );
  if (theoryClosureRequested) {
    gates.experiment_ready_theory_closure = input.parseError
      ? "not_ready"
      : (input.theoryClosureEvaluation?.gateStatus ?? "not_ready");
  }
  gates.runtime_artifact_freshness = "not_ready";
  gates.runtime_execution_provenance = "not_ready";
  const scalars = input.parseError ? {} : collectScalars(input.artifacts);
  const missingSignals = input.parseError
    ? ["artifact_parse_failed"]
    : [
        ...missingSignalsForGates(gates),
        ...(theoryClosureRequested &&
        gates.experiment_ready_theory_closure === "not_ready"
          ? [
              input.theoryClosureEvaluation == null
                ? "experiment_ready_theory_closure_missing"
                : "experiment_ready_theory_closure_filesystem_unverified",
            ]
          : []),
        ...(input.theoryClosureEvaluation?.blockers.map(
          (blocker) => `experiment_ready_theory_closure:${blocker}`,
        ) ?? []),
        "runtime_artifact_freshness_unbound",
      ];
  const status = receiptStatus({
    artifactCount: input.artifacts.length,
    parseFailed: Boolean(input.parseError),
    missingSignals,
  });
  const blockedBy =
    status === "failed"
      ? ["artifact_parse_failed"]
      : unique([
          ...promotionBlockedBy(gates, missingSignals),
          ...(gates.experiment_ready_theory_closure === "fail"
            ? ["experiment_ready_theory_closure_failed"]
            : []),
        ]);
  const promotionAllowed = false;
  const warnings = unique([
    "Read-only GR/NHM2 artifact adapter; no backend runtime executed.",
    "Artifacts are not bound to a run-specific output manifest; freshness and execution provenance remain unbound.",
    input.artifacts.length === 0 && !input.parseError
      ? "No GR/NHM2 artifacts were found."
      : "",
    input.parseError ?? "",
    ...missingSignals.map(
      (signal) => `${signal.replace(/_/g, " ")}; claim promotion blocked.`,
    ),
    ...REQUIRED_GATE_IDS.filter((gateId) => gates[gateId] === "fail").map(
      (gateId) =>
        `${gateId.replace(/_/g, " ")} failed; claim promotion blocked.`,
    ),
    gates.experiment_ready_theory_closure === "fail"
      ? "Experiment-ready theory-closure evidence is falsified; claim promotion blocked."
      : "",
    ...(input.theoryClosureEvaluation?.blockers.map(
      (blocker) => `Theory-closure verification: ${blocker}.`,
    ) ?? []),
  ]);

  return buildTheoryRuntimeReceiptV1({
    generatedAt,
    receiptId: `runtime:${GR_NHM2_RUNTIME_ADAPTER_ID}:${Date.now().toString(36)}`,
    runtimeId: GR_NHM2_RUNTIME_ADAPTER_ID,
    graphId,
    badgeIds,
    command: null,
    args: {
      adapter: GR_NHM2_RUNTIME_ADAPTER_ID,
      artifactRoots: [...GR_NHM2_ARTIFACT_ROOTS],
      requestedRuntimeId: input.adapterInput.runtimeId ?? null,
    },
    status,
    outputs: {
      artifacts: input.artifacts.map((artifact) => artifact.relativePath),
      scalars,
      units: {},
      gates,
      missingSignals,
      warnings,
      artifactEvidence: input.parseError
        ? []
        : buildReadOnlyArtifactEvidence(input.artifacts),
    },
    provenance: {
      gitSha: null,
      startedAt: null,
      completedAt: generatedAt,
      durationMs: null,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed,
      promotionBlockedBy: blockedBy,
    },
  });
}

export async function readGrNhm2RuntimeArtifacts(
  input: TheoryRuntimeAdapterInput = {},
): Promise<TheoryRuntimeReceiptV1> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  try {
    if (requestsGovernedAlpha07(input)) {
      const historical = await readHistoricalAlpha07Package(projectRoot);
      return buildHistoricalAlpha07Receipt({ adapterInput: input, historical });
    }
    const artifacts = await readJsonArtifacts(projectRoot);
    const theoryClosureEvaluation = requestsExperimentReadyTheoryClosure(input)
      ? await collectExperimentReadyTheoryClosureGate(projectRoot, artifacts)
      : null;
    return buildReceipt({
      adapterInput: input,
      artifacts,
      parseError: null,
      theoryClosureEvaluation,
    });
  } catch (error) {
    return buildReceipt({
      adapterInput: input,
      artifacts: [],
      parseError:
        error instanceof Error
          ? error.message
          : "GR/NHM2 artifact parse failed.",
    });
  }
}

export const grNhm2RuntimeAdapter: TheoryRuntimeAdapter = {
  runtimeId: GR_NHM2_RUNTIME_ADAPTER_ID,
  family: "warp_full_solve",
  laneId: GR_NHM2_LANE_ID,
  capabilities: ["static_reference", "artifact_reader"],
  supportedBadgeIds: [...GR_NHM2_SUPPORTED_BADGE_IDS],
  canHandle: (input) =>
    input.runtimeId === GR_NHM2_RUNTIME_ADAPTER_ID ||
    input.laneId === GR_NHM2_LANE_ID ||
    Boolean(
      input.badgeIds?.some((badgeId) =>
        GR_NHM2_SUPPORTED_BADGE_IDS.includes(
          badgeId as (typeof GR_NHM2_SUPPORTED_BADGE_IDS)[number],
        ),
      ),
    ),
  buildReferenceTrace: (input) =>
    buildStaticGrTensorTraceV1({
      runtimeId: GR_NHM2_RUNTIME_ADAPTER_ID,
      graphId: input.graphId ?? "nhm2-theory-badge-graph",
      badgeIds: input.badgeIds?.length
        ? input.badgeIds
        : [...GR_NHM2_SUPPORTED_BADGE_IDS],
      generatedAt: input.generatedAt ?? undefined,
    }),
  readArtifacts: readGrNhm2RuntimeArtifacts,
};
