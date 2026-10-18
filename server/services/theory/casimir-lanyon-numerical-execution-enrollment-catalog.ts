import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES,
  CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID,
  CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID,
  CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID,
  CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID,
  type CasimirIndependentNumericalExecutionEnrollmentV1,
  type CasimirIndependentNumericalExecutorCapabilityV1,
  type CasimirLanyonPeriodic1dBundleArtifactRoleV1,
  validateCasimirIndependentNumericalExecutionEnrollmentIntegrityV1,
  validateCasimirIndependentNumericalExecutorCapabilityIntegrityV1,
} from "../../../shared/contracts/casimir-independent-numerical-execution-enrollment.v1";
import { validateCasimirIndependentNumericalReplayPolicyIntegrityV1 } from "../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import type { CasimirIndependentNumericalReplayPolicyV1 } from "../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import { validateCasimirIndependentNumericalVerificationRequestIntegrityV1 } from "../../../shared/contracts/casimir-independent-numerical-verification.v1";
import {
  CasimirIndependentNumericalExecutionCatalogResolutionErrorV1,
  cloneCasimirIndependentNumericalSealedInputV1,
  computeCasimirIndependentNumericalSealedInputSha256V1,
  type CasimirIndependentNumericalSealedInputV1,
  type TrustedCasimirIndependentNumericalExecutionCatalogResolverV1,
} from "./casimir-independent-numerical-execution-catalog";
import { validateCasimirIndependentNumericalEvidenceChainV1 } from "./casimir-independent-numerical-replay";

export type CasimirLanyonNumericalExecutionEnrollmentCatalogEntryV1 = {
  enrollment: CasimirIndependentNumericalExecutionEnrollmentV1;
  bundleRoot: string;
  sealedInput: CasimirIndependentNumericalSealedInputV1;
  executorCapability: CasimirIndependentNumericalExecutorCapabilityV1;
};

export type CasimirLanyonNumericalBundleArtifactObservationV1 = {
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export type TrustedCasimirNumericalExecutorCapabilityVerifierV1 = (input: {
  enrollment: CasimirIndependentNumericalExecutionEnrollmentV1;
  capability: CasimirIndependentNumericalExecutorCapabilityV1;
}) => Promise<boolean> | boolean;

export type CasimirLanyonNumericalExecutionEnrollmentCatalogDependenciesV1 = {
  verifyExecutorCapability?: TrustedCasimirNumericalExecutorCapabilityVerifierV1;
  inspectBundleArtifact?: (input: {
    bundleRoot: string;
    relativePath: string;
  }) =>
    | Promise<CasimirLanyonNumericalBundleArtifactObservationV1>
    | CasimirLanyonNumericalBundleArtifactObservationV1;
  platform?: string;
  architecture?: string;
};

export class CasimirLanyonNumericalExecutionEnrollmentAdmissionError extends CasimirIndependentNumericalExecutionCatalogResolutionErrorV1 {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues);
    this.name = "CasimirLanyonNumericalExecutionEnrollmentAdmissionError";
    this.issues = [...new Set(issues)].sort();
  }
}

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const samePath = (left: string, right: string): boolean => {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
};

const containedBy = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
};

const underOrEqual = (root: string, candidate: string): boolean =>
  samePath(root, candidate) || containedBy(root, candidate);

const assertPersistentBundleRoot = (bundleRoot: string): string => {
  if (!path.isAbsolute(bundleRoot)) {
    throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError([
      "numerical_bundle_root_not_absolute",
    ]);
  }
  const resolved = path.resolve(bundleRoot);
  if (underOrEqual(os.tmpdir(), resolved)) {
    throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError([
      "numerical_bundle_root_must_not_be_os_temporary",
    ]);
  }
  return resolved;
};

const inspectBundleArtifact = async (input: {
  bundleRoot: string;
  relativePath: string;
}): Promise<CasimirLanyonNumericalBundleArtifactObservationV1> => {
  const absolutePath = path.resolve(
    input.bundleRoot,
    ...input.relativePath.split("/"),
  );
  if (!containedBy(input.bundleRoot, absolutePath)) {
    throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError([
      "numerical_bundle_artifact_path_escape",
    ]);
  }
  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError([
      "numerical_bundle_artifact_not_regular_file",
    ]);
  }
  const realPath = await fs.realpath(absolutePath);
  if (!samePath(realPath, absolutePath)) {
    throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError([
      "numerical_bundle_artifact_path_alias_forbidden",
    ]);
  }
  const bytes = await fs.readFile(absolutePath);
  return {
    absolutePath,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
    bytes,
  };
};

const parseJsonObject = (
  bytes: Uint8Array,
  issue: string,
): Record<string, unknown> => {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // The typed issue below is intentionally stable.
  }
  throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError([issue]);
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const artifactByRole = (
  enrollment: CasimirIndependentNumericalExecutionEnrollmentV1,
) =>
  new Map(
    enrollment.bundle.artifacts.map((artifact) => [artifact.role, artifact]),
  );

const expectedSealedPaths = (
  sealedInput: CasimirIndependentNumericalSealedInputV1,
): Record<
  Exclude<
    CasimirLanyonPeriodic1dBundleArtifactRoleV1,
    "harness_runtime_manifest" | "lanyon_upstream_source"
  >,
  string
> => ({
  analytic_reference_build_manifest: sealedInput.independentBuildManifestPath,
  analytic_reference_executable: sealedInput.independentExecutablePath,
  analytic_reference_source: sealedInput.independentSourcePath,
  harness_executable: sealedInput.harnessExecutablePath,
  harness_source: sealedInput.harnessSourcePath,
  primary_build_manifest: sealedInput.primaryBuildManifestPath,
  primary_driver_source: sealedInput.primarySourcePath,
  primary_executable: sealedInput.primaryExecutablePath,
});

const exactExecutorEnforcement = (
  capability: CasimirIndependentNumericalExecutorCapabilityV1,
): boolean =>
  capability.enforcement.networkIsolationEnforced === true &&
  capability.enforcement.filesystemWriteIsolationEnforced === true &&
  capability.enforcement.processTreeContainmentEnforced === true &&
  capability.enforcement.wallTimeoutEnforced === true &&
  capability.enforcement.outputByteLimitEnforced === true;

const manifestLinkageIssues = (input: {
  enrollment: CasimirIndependentNumericalExecutionEnrollmentV1;
  policy: CasimirIndependentNumericalReplayPolicyV1;
  primaryManifest: Record<string, unknown>;
  referenceManifest: Record<string, unknown>;
  harnessManifest: Record<string, unknown>;
}): string[] => {
  const issues: string[] = [];
  const { enrollment, policy } = input;
  const primaryUpstream = record(input.primaryManifest.upstream);
  const primaryDriver = record(input.primaryManifest.driver);
  const primaryOutput = record(input.primaryManifest.output);
  if (
    input.primaryManifest.implementation_id !==
      enrollment.primaryLane.implementationId ||
    input.primaryManifest.lineage_id !== enrollment.primaryLane.lineageId ||
    primaryUpstream.repository !== enrollment.lanyon.repositoryUri ||
    primaryUpstream.commit !== enrollment.lanyon.commitSha ||
    primaryUpstream.sha256 !== enrollment.lanyon.generatedSourceSha256 ||
    primaryDriver.sha256 !== enrollment.primaryLane.sourceSha256 ||
    primaryOutput.sha256 !== enrollment.primaryLane.executableSha256
  ) {
    issues.push("primary_build_manifest_enrollment_mismatch");
  }

  const referenceSource = record(input.referenceManifest.source);
  const referenceOutput = record(input.referenceManifest.output);
  const referenceBoundary = record(input.referenceManifest.claim_boundary);
  if (
    input.referenceManifest.implementation_id !==
      enrollment.comparisonLane.implementationId ||
    input.referenceManifest.lineage_id !==
      enrollment.comparisonLane.lineageId ||
    referenceSource.sha256 !== enrollment.comparisonLane.sourceSha256 ||
    referenceOutput.sha256 !== enrollment.comparisonLane.executableSha256 ||
    referenceBoundary.is_independent_numerical_solver !== false
  ) {
    issues.push("analytic_reference_build_manifest_enrollment_mismatch");
  }

  const harnessSource = record(input.harnessManifest.source);
  const harnessRuntime = record(input.harnessManifest.runtime);
  const harnessExecution = record(input.harnessManifest.execution);
  if (
    input.harnessManifest.protocol !== policy.harness.protocol ||
    input.harnessManifest.launch_mode !== policy.harness.launchMode ||
    harnessSource.sha256 !== policy.harness.sourceSha256 ||
    harnessRuntime.executable_sha256 !== policy.harness.executableSha256 ||
    harnessExecution.network_allowed !== false ||
    harnessExecution.arbitrary_command_allowed !== false
  ) {
    issues.push("harness_manifest_enrollment_mismatch");
  }
  return issues;
};

async function admitEntry(input: {
  entry: CasimirLanyonNumericalExecutionEnrollmentCatalogEntryV1;
  request: {
    catalogEntryId: string;
    procedureId: string;
    procedureSha256: string;
  };
  dependencies: CasimirLanyonNumericalExecutionEnrollmentCatalogDependenciesV1;
}): Promise<CasimirIndependentNumericalSealedInputV1> {
  const { entry, dependencies } = input;
  const issues = [
    ...(
      await validateCasimirIndependentNumericalExecutionEnrollmentIntegrityV1(
        entry.enrollment,
      )
    ).map((issue) => `enrollment:${issue}`),
    ...(
      await validateCasimirIndependentNumericalExecutorCapabilityIntegrityV1(
        entry.executorCapability,
      )
    ).map((issue) => `executor_capability:${issue}`),
    ...(
      await validateCasimirIndependentNumericalVerificationRequestIntegrityV1(
        entry.sealedInput.request,
      )
    ).map((issue) => `request:${issue}`),
    ...(
      await validateCasimirIndependentNumericalReplayPolicyIntegrityV1(
        entry.sealedInput.policy,
      )
    ).map((issue) => `policy:${issue}`),
    ...(await validateCasimirIndependentNumericalEvidenceChainV1(
      entry.sealedInput,
    )),
  ];
  const enrollment = entry.enrollment;
  const sealedInput = entry.sealedInput;
  const runtimePlatform = dependencies.platform ?? process.platform;
  const runtimeArchitecture = dependencies.architecture ?? process.arch;
  const observedSealedInputSha256 =
    await computeCasimirIndependentNumericalSealedInputSha256V1(sealedInput);

  if (enrollment.catalogEntryId !== input.request.catalogEntryId)
    issues.push("catalog_entry_id_mismatch");
  if (
    enrollment.procedure.procedureId !== input.request.procedureId ||
    enrollment.procedure.procedureSha256 !== input.request.procedureSha256 ||
    sealedInput.procedure.procedureId !== input.request.procedureId ||
    sealedInput.procedure.procedureSha256 !== input.request.procedureSha256
  ) {
    issues.push("numerical_procedure_binding_mismatch");
  }
  if (
    enrollment.procedure.schemaVersion !== sealedInput.procedure.schemaVersion
  ) {
    issues.push("numerical_procedure_schema_mismatch");
  }
  if (enrollment.sealedInputSha256 !== observedSealedInputSha256)
    issues.push("numerical_enrolled_sealed_input_hash_mismatch");
  if (
    enrollment.request.requestId !== sealedInput.request.requestId ||
    enrollment.request.artifactSha256 !== sealedInput.request.artifactSha256
  ) {
    issues.push("numerical_enrolled_request_mismatch");
  }
  if (
    enrollment.replayPolicy.policyId !== sealedInput.policy.policyId ||
    enrollment.replayPolicy.artifactSha256 !== sealedInput.policy.artifactSha256
  ) {
    issues.push("numerical_enrolled_policy_mismatch");
  }
  if (
    enrollment.platform.platform !== runtimePlatform ||
    enrollment.platform.architecture !== runtimeArchitecture ||
    entry.executorCapability.platform !== runtimePlatform ||
    entry.executorCapability.architecture !== runtimeArchitecture
  ) {
    issues.push("numerical_enrolled_platform_mismatch");
  }
  if (
    sealedInput.request.primaryImplementation.implementationId !==
      CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID ||
    sealedInput.request.primaryImplementation.lineageId !==
      CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID ||
    sealedInput.request.independentImplementation.implementationId !==
      CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID ||
    sealedInput.request.independentImplementation.lineageId !==
      CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID
  ) {
    issues.push("numerical_enrolled_lane_identity_mismatch");
  }
  if (
    enrollment.primaryLane.sourceSha256 !==
      sealedInput.policy.lanes.primary.sourceSha256 ||
    enrollment.primaryLane.buildManifestSha256 !==
      sealedInput.policy.lanes.primary.buildManifestSha256 ||
    enrollment.primaryLane.executableSha256 !==
      sealedInput.policy.lanes.primary.executableSha256 ||
    enrollment.comparisonLane.sourceSha256 !==
      sealedInput.policy.lanes.independent.sourceSha256 ||
    enrollment.comparisonLane.buildManifestSha256 !==
      sealedInput.policy.lanes.independent.buildManifestSha256 ||
    enrollment.comparisonLane.executableSha256 !==
      sealedInput.policy.lanes.independent.executableSha256
  ) {
    issues.push("numerical_enrolled_lane_hash_mismatch");
  }
  if (
    entry.executorCapability.capabilityId !==
      enrollment.executorCapability.capabilityId ||
    entry.executorCapability.artifactSha256 !==
      enrollment.executorCapability.artifactSha256 ||
    sealedInput.executorCapability.capabilityId !==
      enrollment.executorCapability.capabilityId ||
    sealedInput.executorCapability.artifactSha256 !==
      enrollment.executorCapability.artifactSha256
  ) {
    issues.push("numerical_executor_capability_binding_mismatch");
  }
  if (!exactExecutorEnforcement(entry.executorCapability)) {
    issues.push("numerical_executor_sandbox_capability_insufficient");
  }
  if (!dependencies.verifyExecutorCapability) {
    issues.push("numerical_executor_capability_verifier_unconfigured");
  } else {
    try {
      if (
        !(await dependencies.verifyExecutorCapability({
          enrollment,
          capability: entry.executorCapability,
        }))
      ) {
        issues.push("numerical_executor_capability_attestation_rejected");
      }
    } catch {
      issues.push("numerical_executor_capability_verification_failed");
    }
  }

  const bundleRoot = assertPersistentBundleRoot(entry.bundleRoot);
  const artifacts = artifactByRole(enrollment);
  const observations = new Map<
    CasimirLanyonPeriodic1dBundleArtifactRoleV1,
    CasimirLanyonNumericalBundleArtifactObservationV1
  >();
  const inspect = dependencies.inspectBundleArtifact ?? inspectBundleArtifact;
  for (const role of CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES) {
    const artifact = artifacts.get(role);
    if (!artifact) {
      issues.push(`numerical_bundle_artifact_missing:${role}`);
      continue;
    }
    try {
      const observation = await inspect({
        bundleRoot,
        relativePath: artifact.relativePath,
      });
      const expectedPath = path.resolve(
        bundleRoot,
        ...artifact.relativePath.split("/"),
      );
      if (
        !samePath(observation.absolutePath, expectedPath) ||
        !containedBy(bundleRoot, observation.absolutePath)
      ) {
        issues.push(`numerical_bundle_artifact_path_mismatch:${role}`);
      }
      if (
        observation.sha256 !== artifact.sha256 ||
        observation.sizeBytes !== artifact.sizeBytes ||
        sha256(observation.bytes) !== artifact.sha256 ||
        observation.bytes.byteLength !== artifact.sizeBytes
      ) {
        issues.push(`numerical_bundle_artifact_drift:${role}`);
      }
      observations.set(role, observation);
    } catch (error) {
      if (
        error instanceof CasimirLanyonNumericalExecutionEnrollmentAdmissionError
      ) {
        issues.push(...error.issues.map((issue) => `${issue}:${role}`));
      } else {
        issues.push(`numerical_bundle_artifact_unreadable:${role}`);
      }
    }
  }

  const sealedPaths = expectedSealedPaths(sealedInput);
  for (const [role, sealedPath] of Object.entries(sealedPaths) as Array<
    [keyof typeof sealedPaths, string]
  >) {
    const artifact = artifacts.get(role);
    if (!artifact) continue;
    const expectedPath = path.resolve(
      bundleRoot,
      ...artifact.relativePath.split("/"),
    );
    if (!samePath(sealedPath, expectedPath)) {
      issues.push(`numerical_sealed_path_not_bundle_bound:${role}`);
    }
  }

  const primaryManifest = observations.get("primary_build_manifest");
  const referenceManifest = observations.get(
    "analytic_reference_build_manifest",
  );
  const harnessManifest = observations.get("harness_runtime_manifest");
  if (primaryManifest && referenceManifest && harnessManifest) {
    issues.push(
      ...manifestLinkageIssues({
        enrollment,
        policy: sealedInput.policy,
        primaryManifest: parseJsonObject(
          primaryManifest.bytes,
          "primary_build_manifest_json_invalid",
        ),
        referenceManifest: parseJsonObject(
          referenceManifest.bytes,
          "analytic_reference_build_manifest_json_invalid",
        ),
        harnessManifest: parseJsonObject(
          harnessManifest.bytes,
          "harness_runtime_manifest_json_invalid",
        ),
      }),
    );
  }

  const lanyonSource = artifacts.get("lanyon_upstream_source");
  if (
    !lanyonSource ||
    lanyonSource.sha256 !== enrollment.lanyon.generatedSourceSha256
  ) {
    issues.push("lanyon_upstream_source_enrollment_mismatch");
  }
  const harnessSource = artifacts.get("harness_source");
  const harnessExecutable = artifacts.get("harness_executable");
  if (
    !harnessSource ||
    harnessSource.sha256 !== sealedInput.policy.harness.sourceSha256 ||
    !harnessExecutable ||
    harnessExecutable.sha256 !== sealedInput.policy.harness.executableSha256
  ) {
    issues.push("numerical_harness_enrollment_mismatch");
  }

  if (issues.length > 0) {
    throw new CasimirLanyonNumericalExecutionEnrollmentAdmissionError(issues);
  }
  return cloneCasimirIndependentNumericalSealedInputV1(sealedInput);
}

export function createCasimirLanyonNumericalExecutionEnrollmentCatalogV1(
  entries: readonly CasimirLanyonNumericalExecutionEnrollmentCatalogEntryV1[],
  dependencies: CasimirLanyonNumericalExecutionEnrollmentCatalogDependenciesV1 = {},
): {
  resolve: TrustedCasimirIndependentNumericalExecutionCatalogResolverV1;
  entryIds: readonly string[];
} {
  const byId = new Map<
    string,
    CasimirLanyonNumericalExecutionEnrollmentCatalogEntryV1
  >();
  for (const entry of entries) {
    const id = entry.enrollment.catalogEntryId;
    if (byId.has(id)) {
      throw new Error(`duplicate_numerical_catalog_entry_id:${id}`);
    }
    byId.set(id, entry);
  }
  return {
    entryIds: Object.freeze([...byId.keys()].sort()),
    resolve: async (input) => {
      if (input.accountType !== "developer" || !input.profileId?.trim()) {
        return null;
      }
      const entry = byId.get(input.catalogEntryId);
      if (!entry) return null;
      return admitEntry({
        entry,
        request: {
          catalogEntryId: input.catalogEntryId,
          procedureId: input.procedureId,
          procedureSha256: input.procedureSha256,
        },
        dependencies,
      });
    },
  };
}

export const EMPTY_CASIMIR_LANYON_NUMERICAL_EXECUTION_CATALOG_V1 =
  createCasimirLanyonNumericalExecutionEnrollmentCatalogV1([]);
