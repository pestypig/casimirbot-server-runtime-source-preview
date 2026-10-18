import {
  validateCasimirFormalSandboxExecutorCapabilityV1,
  type CasimirFormalSandboxExecutorCapabilityV1,
} from "../../../shared/contracts/casimir-formal-sandbox-executor-capability.v1";
import {
  validateCasimirFormalExecutionEnrollmentIntegrityV2,
  type CasimirFormalExecutionEnrollmentV2,
} from "../../../shared/contracts/casimir-formal-execution-enrollment.v2";
import {
  validateCasimirFormalVerificationRequestV2Integrity,
  type CasimirFormalVerificationRequestV2,
} from "../../../shared/contracts/casimir-formal-verification-request.v2";
import { computeCasimirSpecValueSha256V1 } from "../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import type { HelixAccountType } from "../../../shared/helix-account-session";

export type CasimirFormalVerificationSealedExecutionV2 = {
  executionCatalogEntryId: string;
  procedure: {
    procedureId: string;
    procedureSha256: string;
  };
  request: CasimirFormalVerificationRequestV2;
  executorCapability: CasimirFormalSandboxExecutorCapabilityV1;
  sourceBundle: {
    bundleId: string;
    artifactSha256: string;
    formalSourceSha256: string;
    importClosureSha256: string;
    resolverRef: string;
  };
};

export type CasimirFormalVerificationExecutionCatalogEntryV2 = {
  enrollment: CasimirFormalExecutionEnrollmentV2;
  sealedExecution: CasimirFormalVerificationSealedExecutionV2;
};

export type TrustedCasimirFormalExecutionEnrollmentVerifierV2 = (input: {
  enrollment: CasimirFormalExecutionEnrollmentV2;
  sealedExecution: CasimirFormalVerificationSealedExecutionV2;
}) => boolean | Promise<boolean>;

export type CasimirFormalVerificationExecutionCatalogDependenciesV2 = {
  verifyEnrollmentRegistration?: TrustedCasimirFormalExecutionEnrollmentVerifierV2;
};

export type CasimirFormalVerificationExecutionCatalogResolveInputV2 = {
  accountType: HelixAccountType;
  profileId: string;
  executionCatalogEntryId: string;
  procedureId: string;
  procedureSha256: string;
};

export type TrustedCasimirFormalVerificationExecutionCatalogResolverV2 = (
  input: CasimirFormalVerificationExecutionCatalogResolveInputV2,
) =>
  | CasimirFormalVerificationSealedExecutionV2
  | null
  | Promise<CasimirFormalVerificationSealedExecutionV2 | null>;

export type CasimirFormalVerificationExecutionCatalogInspectionV2 = {
  schema: "casimir.formal_verification_execution_catalog.v2";
  configured: boolean;
  entryCount: number;
  entries: Array<{
    executionCatalogEntryId: string;
    enrollmentId: string;
    enrollmentArtifactSha256: string;
    procedureId: string;
    procedureSha256: string;
    requestId: string;
    requestArtifactSha256: string;
    sealedInputSha256: string;
    executorCapabilityId: string;
    executorCapabilitySha256: string;
    generatorRegistrationId: string;
    generatorRevisionSha256: string;
  }>;
  issues: string[];
  authority: {
    serverInstalledCatalogOnly: true;
    callerSuppliedExecutionAuthority: false;
    assistantAnswer: false;
    terminalEligible: false;
  };
};

export type CasimirFormalVerificationExecutionCatalogV2 = {
  inspect(): CasimirFormalVerificationExecutionCatalogInspectionV2;
  resolve: TrustedCasimirFormalVerificationExecutionCatalogResolverV2;
};

const SHA256 = /^[a-f0-9]{64}$/;
const OPAQUE_BUNDLE_RESOLVER_REF =
  /^casimir-formal-bundle:[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/;
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const exactKeys = (
  value: object,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
};

export const cloneCasimirFormalVerificationSealedExecutionV2 = (
  value: CasimirFormalVerificationSealedExecutionV2,
): CasimirFormalVerificationSealedExecutionV2 =>
  structuredClone(value) as CasimirFormalVerificationSealedExecutionV2;

export async function validateCasimirFormalVerificationSealedExecutionV2(
  value: CasimirFormalVerificationSealedExecutionV2,
): Promise<string[]> {
  const issues: string[] = [];
  if (
    !exactKeys(value, [
      "executionCatalogEntryId",
      "procedure",
      "request",
      "executorCapability",
      "sourceBundle",
    ])
  )
    issues.push("formal_execution_catalog_entry_shape_invalid");
  if (!nonEmpty(value.executionCatalogEntryId))
    issues.push("formal_execution_catalog_entry_id_invalid");
  if (
    !exactKeys(value.procedure ?? {}, [
      "procedureId",
      "procedureSha256",
    ]) ||
    !nonEmpty(value.procedure?.procedureId) ||
    !SHA256.test(String(value.procedure?.procedureSha256))
  )
    issues.push("formal_execution_procedure_binding_invalid");
  issues.push(
    ...(await validateCasimirFormalVerificationRequestV2Integrity(
      value.request,
    )).map((issue) => `formal_request_v2:${issue}`),
    ...(await validateCasimirFormalSandboxExecutorCapabilityV1(
      value.executorCapability,
    )).map((issue) => `formal_executor_capability:${issue}`),
  );
  const bundle = value.sourceBundle;
  if (
    !exactKeys(bundle ?? {}, [
      "bundleId",
      "artifactSha256",
      "formalSourceSha256",
      "importClosureSha256",
      "resolverRef",
    ]) ||
    !nonEmpty(bundle?.bundleId) ||
    !OPAQUE_BUNDLE_RESOLVER_REF.test(String(bundle?.resolverRef)) ||
    !SHA256.test(String(bundle?.artifactSha256)) ||
    !SHA256.test(String(bundle?.formalSourceSha256)) ||
    !SHA256.test(String(bundle?.importClosureSha256))
  )
    issues.push("formal_source_bundle_binding_invalid");
  if (
    value.request?.executionPolicy?.sandboxExecutorCapabilityId !==
      value.executorCapability?.capabilityId ||
    value.request?.executionPolicy?.sandboxExecutorCapabilitySha256 !==
      value.executorCapability?.artifactSha256
  )
    issues.push("formal_executor_capability_binding_mismatch");
  if (
    value.request?.formalArtifact?.sourceSha256 !==
      bundle?.formalSourceSha256 ||
    value.request?.formalEnvironment?.importClosureSha256 !==
      bundle?.importClosureSha256
  )
    issues.push("formal_source_bundle_request_mismatch");
  if (
    value.request?.executionPolicy?.maxMemoryBytes >
      value.executorCapability?.resourceCeilings?.maxMemoryBytes ||
    value.request?.executionPolicy?.timeoutMs >
      value.executorCapability?.resourceCeilings?.timeoutMs ||
    value.request?.executionPolicy?.maxOutputBytes >
      value.executorCapability?.resourceCeilings?.maxOutputBytes
  )
    issues.push("formal_request_exceeds_executor_resource_ceilings");
  return [...new Set(issues)].sort();
}

export async function computeCasimirFormalVerificationSealedExecutionSha256V2(
  value: CasimirFormalVerificationSealedExecutionV2,
): Promise<string> {
  return computeCasimirSpecValueSha256V1({
    domain: "casimir-formal-verification-sealed-execution/v2",
    value,
  });
}

type StoredExecutionCatalogEntryV2 = {
  sealedInputSha256: string;
  enrollment: CasimirFormalExecutionEnrollmentV2;
  sealedExecution: CasimirFormalVerificationSealedExecutionV2;
};

export async function createCasimirFormalVerificationExecutionCatalogV2(
  entries: readonly CasimirFormalVerificationExecutionCatalogEntryV2[] = [],
  dependencies: CasimirFormalVerificationExecutionCatalogDependenciesV2 = {},
): Promise<CasimirFormalVerificationExecutionCatalogV2> {
  const stored: StoredExecutionCatalogEntryV2[] = [];
  const issues: string[] = [];
  const seenEntryIds = new Set<string>();
  const seenEnrollmentIds = new Set<string>();
  const seenProcedureBindings = new Set<string>();
  for (const [index, source] of entries.entries()) {
    const sealedExecution =
      cloneCasimirFormalVerificationSealedExecutionV2(
        source.sealedExecution,
      );
    const enrollment = structuredClone(
      source.enrollment,
    ) as CasimirFormalExecutionEnrollmentV2;
    const entryId =
      sealedExecution.executionCatalogEntryId?.trim() ||
      `entry:${index}`;
    const sealedInputSha256 =
      await computeCasimirFormalVerificationSealedExecutionSha256V2(
        sealedExecution,
      );
    const entryIssues = [
      ...(await validateCasimirFormalExecutionEnrollmentIntegrityV2(
        enrollment,
      )).map((issue) => `formal_execution_enrollment:${issue}`),
      ...(
      await validateCasimirFormalVerificationSealedExecutionV2(
        sealedExecution,
      )
      ),
    ];
    if (
      enrollment.executionCatalogEntryId !== entryId ||
      enrollment.sealedExecutionSha256 !== sealedInputSha256
    ) {
      entryIssues.push("formal_execution_enrollment_sealed_input_mismatch");
    }
    if (
      enrollment.procedure.procedureId !==
        sealedExecution.procedure.procedureId ||
      enrollment.procedure.procedureSha256 !==
        sealedExecution.procedure.procedureSha256
    ) {
      entryIssues.push("formal_execution_enrollment_procedure_mismatch");
    }
    if (
      enrollment.request.requestId !== sealedExecution.request.requestId ||
      enrollment.request.artifactSha256 !==
        sealedExecution.request.artifactSha256
    ) {
      entryIssues.push("formal_execution_enrollment_request_mismatch");
    }
    const request = sealedExecution.request;
    if (
      enrollment.sourceLineage.sourceAuditArtifactSha256 !==
        request.formalArtifact.sourceAuditArtifactSha256 ||
      enrollment.sourceLineage.formalSource.sha256 !==
        request.formalArtifact.sourceSha256 ||
      enrollment.sourceLineage.formalSource.moduleName !==
        request.formalArtifact.theoremModule ||
      enrollment.theorem.formalArtifactId !==
        request.formalArtifact.formalArtifactId ||
      enrollment.theorem.theoremName !==
        request.formalArtifact.theoremName ||
      enrollment.theorem.theoremModule !==
        request.formalArtifact.theoremModule ||
      enrollment.theorem.declarationSha256 !==
        request.formalArtifact.declarationSha256 ||
      enrollment.theorem.propositionSourceSha256 !==
        request.formalArtifact.propositionSourceSha256 ||
      enrollment.theorem.observedTheoremTypeSha256 !==
        request.formalArtifact.observedTheoremTypeSha256
    ) {
      entryIssues.push("formal_execution_enrollment_source_theorem_mismatch");
    }
    if (
      enrollment.semanticBinding.bindingId !==
        request.semanticToLeanBinding.bindingId ||
      enrollment.semanticBinding.artifactSha256 !==
        request.semanticToLeanBinding.artifactSha256 ||
      enrollment.semanticBinding.status !==
        request.semanticToLeanBinding.status ||
      enrollment.semanticBinding.claimId !==
        request.semanticToLeanBinding.claimId ||
      enrollment.semanticBinding.semanticPropositionSha256 !==
        request.semanticToLeanBinding.semanticPropositionSha256
    ) {
      entryIssues.push("formal_execution_enrollment_semantic_binding_mismatch");
    }
    if (
      enrollment.graph.graphId !== request.theoryGraph.graphId ||
      enrollment.graph.snapshotSha256 !==
        request.theoryGraph.snapshotSha256
    ) {
      entryIssues.push("formal_execution_enrollment_graph_mismatch");
    }
    if (
      enrollment.environment.policyId !==
        request.formalEnvironment.environmentPolicyId ||
      enrollment.environment.policySha256 !==
        request.formalEnvironment.environmentPolicySha256 ||
      enrollment.environment.pinnedVersion !==
        request.formalEnvironment.pinnedVersion ||
      enrollment.environment.kernelBinarySha256 !==
        request.formalEnvironment.kernelBinarySha256 ||
      enrollment.environment.dependencyLockSha256 !==
        request.formalEnvironment.dependencyLockSha256 ||
      enrollment.environment.importClosureSha256 !==
        request.formalEnvironment.importClosureSha256
    ) {
      entryIssues.push("formal_execution_enrollment_environment_mismatch");
    }
    if (
      JSON.stringify(enrollment.sourceBundle) !==
        JSON.stringify(sealedExecution.sourceBundle) ||
      enrollment.executorCapability.capabilityId !==
        sealedExecution.executorCapability.capabilityId ||
      enrollment.executorCapability.artifactSha256 !==
        sealedExecution.executorCapability.artifactSha256
    ) {
      entryIssues.push("formal_execution_enrollment_execution_binding_mismatch");
    }
    if (!dependencies.verifyEnrollmentRegistration) {
      entryIssues.push(
        "formal_execution_enrollment_registration_verifier_unconfigured",
      );
    } else {
      try {
        if (
          !(await dependencies.verifyEnrollmentRegistration({
            enrollment,
            sealedExecution,
          }))
        ) {
          entryIssues.push(
            "formal_execution_enrollment_registration_rejected",
          );
        }
      } catch {
        entryIssues.push(
          "formal_execution_enrollment_registration_verification_failed",
        );
      }
    }
    issues.push(
      ...entryIssues.map(
        (issue) => `${entryId}:${issue}`,
      ),
    );
    if (seenEntryIds.has(entryId))
      issues.push(`${entryId}:formal_execution_catalog_entry_id_duplicate`);
    seenEntryIds.add(entryId);
    if (seenEnrollmentIds.has(enrollment.enrollmentId))
      issues.push(
        `${entryId}:formal_execution_enrollment_id_duplicate`,
      );
    seenEnrollmentIds.add(enrollment.enrollmentId);
    const procedureBinding = JSON.stringify([
      sealedExecution.procedure?.procedureId,
      sealedExecution.procedure?.procedureSha256,
    ]);
    if (seenProcedureBindings.has(procedureBinding))
      issues.push(
        `${entryId}:formal_execution_catalog_procedure_binding_duplicate`,
      );
    seenProcedureBindings.add(procedureBinding);
    stored.push({
      sealedInputSha256,
      enrollment,
      sealedExecution,
    });
  }
  const catalogIssues = [...new Set(issues)].sort();
  const inspect = () => ({
    schema:
      "casimir.formal_verification_execution_catalog.v2" as const,
    configured: catalogIssues.length === 0 && stored.length > 0,
    entryCount: catalogIssues.length === 0 ? stored.length : 0,
    entries:
      catalogIssues.length === 0
        ? stored
            .map(({ enrollment, sealedExecution, sealedInputSha256 }) => ({
              executionCatalogEntryId:
                sealedExecution.executionCatalogEntryId,
              enrollmentId: enrollment.enrollmentId,
              enrollmentArtifactSha256: enrollment.artifactSha256,
              procedureId: sealedExecution.procedure.procedureId,
              procedureSha256:
                sealedExecution.procedure.procedureSha256,
              requestId: sealedExecution.request.requestId,
              requestArtifactSha256:
                sealedExecution.request.artifactSha256,
              sealedInputSha256,
              executorCapabilityId:
                sealedExecution.executorCapability.capabilityId,
              executorCapabilitySha256:
                sealedExecution.executorCapability.artifactSha256,
              generatorRegistrationId:
                enrollment.sourceLineage.generator.registrationId,
              generatorRevisionSha256:
                enrollment.sourceLineage.generator
                  .generatorRevisionSha256,
            }))
            .sort((left, right) =>
              left.executionCatalogEntryId.localeCompare(
                right.executionCatalogEntryId,
                "en",
              ),
            )
        : [],
    issues: [...catalogIssues],
    authority: {
      serverInstalledCatalogOnly: true as const,
      callerSuppliedExecutionAuthority: false as const,
      assistantAnswer: false as const,
      terminalEligible: false as const,
    },
  });
  const resolve: TrustedCasimirFormalVerificationExecutionCatalogResolverV2 =
    async (input) => {
      if (
        catalogIssues.length > 0 ||
        input.accountType !== "developer" ||
        !input.profileId.trim()
      )
        return null;
      const match = stored.find(
        ({ sealedExecution }) =>
          sealedExecution.executionCatalogEntryId ===
            input.executionCatalogEntryId &&
          sealedExecution.procedure.procedureId ===
            input.procedureId &&
          sealedExecution.procedure.procedureSha256 ===
            input.procedureSha256,
      );
      if (!match) return null;
      const currentHash =
        await computeCasimirFormalVerificationSealedExecutionSha256V2(
          match.sealedExecution,
        );
      if (currentHash !== match.sealedInputSha256) return null;
      return cloneCasimirFormalVerificationSealedExecutionV2(
        match.sealedExecution,
      );
    };
  return { inspect, resolve };
}
