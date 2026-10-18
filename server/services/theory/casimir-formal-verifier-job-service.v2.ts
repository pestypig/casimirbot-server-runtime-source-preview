import { randomBytes } from "node:crypto";

import {
  validateCasimirFormalVerificationCertificateV2AgainstRequest,
  type CasimirFormalVerificationCertificateV2,
} from "../../../shared/contracts/casimir-formal-verification-certificate.v2";
import {
  validateTheoryExperimentProcedureV1,
  type TheoryExperimentProcedureV1,
} from "../../../shared/contracts/theory-experiment-procedure.v1";
import { computeCasimirSpecValueSha256V1 } from "../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import type { HelixAccountType } from "../../../shared/helix-account-session";
import {
  THEORY_EXPERIMENT_PROCEDURE_HASH_DOMAIN,
} from "../../../shared/contracts/theory-experiment-procedure.v1";
import {
  cloneCasimirFormalVerificationSealedExecutionV2,
  computeCasimirFormalVerificationSealedExecutionSha256V2,
  validateCasimirFormalVerificationSealedExecutionV2,
  type CasimirFormalVerificationExecutionCatalogInspectionV2,
  type CasimirFormalVerificationSealedExecutionV2,
  type TrustedCasimirFormalVerificationExecutionCatalogResolverV2,
} from "./casimir-formal-verification-execution-catalog.v2";
import {
  createRuntimeToolConfirmationReceiptVerifierV1,
  type TrustedRuntimeToolConfirmationReplayLedgerV1,
  type TrustedRuntimeToolConfirmationVerifierV1,
} from "./runtime-tool-confirmation-receipt-verifier";
import {
  createInMemoryCasimirTheoryExecutionStateStoreV1,
  type CasimirTheoryExecutionStateStoreV1,
} from "./casimir-theory-execution-state-store";

export const CASIMIR_FORMAL_VERIFIER_PREPARED_REQUEST_SCHEMA_V2 =
  "casimir.theory_formal_verifier.prepared_request.v2" as const;
export const CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA_V2 =
  "casimir.theory_formal_verifier.plan.v2" as const;
export const CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA_V2 =
  "casimir.theory_formal_verifier.job_receipt.v2" as const;
export const CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA_V2 =
  "casimir.theory_formal_verifier.result.v2" as const;
export const CASIMIR_FORMAL_VERIFIER_RUNTIME_READINESS_SCHEMA_V2 =
  "casimir.theory_formal_verifier.runtime_readiness.v2" as const;
export const CASIMIR_FORMAL_VERIFIER_START_CAPABILITY_ID =
  "theory-formal-verifier.start" as const;
export const CASIMIR_FORMAL_VERIFIER_READ_RESULT_CAPABILITY_ID =
  "theory-formal-verifier.read_result" as const;

type EvidenceAuthorityV2 = {
  outputRole: "evidence_for_bounded_synthesis";
  externalSandboxOnly: true;
  formalPropositionChecked: false;
  validatesScientificTruth: false;
  validatesTheory: false;
  validatesGeneratedCode: false;
  validatesNumericalImplementation: false;
  validatesEmpiricalClaim: false;
  validatesPhysicalMechanism: false;
  assistantAnswer: false;
  terminalEligible: false;
  promotionAllowed: false;
  postToolModelStepRequired: true;
};

export type CasimirFormalVerifierPreparedRequestV2 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_PREPARED_REQUEST_SCHEMA_V2;
  ok: boolean;
  status: "prepared" | "blocked";
  preparedRequestId: string | null;
  executionCatalogEntryId: string | null;
  requestId: string | null;
  requestArtifactSha256: string | null;
  sealedInputSha256: string | null;
  issues: string[];
  nextCapability:
    | "theory-formal-verifier.plan"
    | "repair_formal_verification_catalog";
  authority: EvidenceAuthorityV2;
};

export type CasimirFormalVerifierPlanV2 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA_V2;
  ok: boolean;
  status: "ready" | "blocked";
  preparedRequestId: string | null;
  planId: string | null;
  requestId: string | null;
  requestArtifactSha256: string | null;
  sealedInputSha256: string | null;
  issues: string[];
  confirmationRequired: true;
  nextCapability:
    | "theory-formal-verifier.start"
    | "repair_formal_verification_inputs";
  authority: EvidenceAuthorityV2;
};

export type CasimirFormalVerifierJobReceiptV2 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA_V2;
  ok: boolean;
  status: "running" | "needs_confirmation" | "blocked";
  planId: string | null;
  sealedInputSha256: string | null;
  jobId: string | null;
  requestId: string | null;
  issues: string[];
  nextCapability:
    | "theory-formal-verifier.read_result"
    | "request_user_confirmation"
    | "repair_formal_verification_inputs";
  authority: EvidenceAuthorityV2;
};

export type CasimirFormalVerifierResultV2 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA_V2;
  ok: boolean;
  status: "running" | "completed" | "failed" | "blocked";
  jobId: string | null;
  planId: string | null;
  sealedInputSha256: string | null;
  requestId: string | null;
  certificate: CasimirFormalVerificationCertificateV2 | null;
  issues: string[];
  authority: EvidenceAuthorityV2;
};

export type CasimirFormalVerifierRuntimeReadinessV2 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_RUNTIME_READINESS_SCHEMA_V2;
  status: "configured" | "blocked";
  composition: {
    executionCatalogResolverConfigured: boolean;
    executionCatalogInspectorConfigured: boolean;
    externalSandboxExecutorResolverConfigured: boolean;
    trustedReceiptVerifierConfigured: boolean;
    durableReplayLedgerConfigured: boolean;
    durableJobStateStoreConfigured: boolean;
  };
  catalog: {
    configured: boolean;
    entryCount: number;
    issues: string[];
  };
  configuredForExactResolutionAttempt: boolean;
  blockerCodes: string[];
  authority: EvidenceAuthorityV2 & {
    configurationEvidenceOnly: true;
    exactCatalogEntryResolved: false;
    exactExecutorResolved: false;
  };
};

export type CasimirFormalExternalSandboxExecutorV2 = {
  capabilityId: string;
  artifactSha256: string;
  execute(input: {
    jobId: string;
    planId: string;
    sealedInputSha256: string;
    sealedExecution: CasimirFormalVerificationSealedExecutionV2;
  }): Promise<CasimirFormalVerificationCertificateV2>;
};

export type CasimirFormalVerifierJobServiceDependenciesV2 = {
  resolveTrustedExecutionCatalogEntry?: TrustedCasimirFormalVerificationExecutionCatalogResolverV2;
  inspectTrustedExecutionCatalog?: () =>
    CasimirFormalVerificationExecutionCatalogInspectionV2;
  resolveExternalSandboxExecutor?: (input: {
    capabilityId: string;
    artifactSha256: string;
  }) =>
    | CasimirFormalExternalSandboxExecutorV2
    | null
    | Promise<CasimirFormalExternalSandboxExecutorV2 | null>;
  verifyTrustedRuntimeReceipt?: TrustedRuntimeToolConfirmationVerifierV1;
  confirmationReplayLedger?: TrustedRuntimeToolConfirmationReplayLedgerV1;
  stateStore?: CasimirTheoryExecutionStateStoreV1;
  now?: () => number;
};

type PreparedRecord = {
  ownerKey: string;
  sealedInputSha256: string;
  sealedExecution: CasimirFormalVerificationSealedExecutionV2;
};
type PlanRecord = {
  ownerKey: string;
  preparedRequestId: string;
  sealedInputSha256: string;
};
type JobRecord = {
  ownerKey: string;
  jobId: string;
  planId: string;
  sealedInputSha256: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  certificate: CasimirFormalVerificationCertificateV2 | null;
  issues: string[];
};

const CURRENT_TURN_ARTIFACT_SCHEMA = "helix.current_turn_artifact.v1";
const PROCEDURE_OBSERVATION_SCHEMA =
  "casimir.theory_experiment_procedure.observation.v1";
const SHA256 = /^[a-f0-9]{64}$/;

const authority = (): EvidenceAuthorityV2 => ({
  outputRole: "evidence_for_bounded_synthesis",
  externalSandboxOnly: true,
  formalPropositionChecked: false,
  validatesScientificTruth: false,
  validatesTheory: false,
  validatesGeneratedCode: false,
  validatesNumericalImplementation: false,
  validatesEmpiricalClaim: false,
  validatesPhysicalMechanism: false,
  assistantAnswer: false,
  terminalEligible: false,
  promotionAllowed: false,
  postToolModelStepRequired: true,
});
const ownerKey = (
  accountType: HelixAccountType,
  profileId?: string | null,
): string => `${accountType}:${profileId?.trim() || "unbound"}`;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const opaqueId = (prefix: string): string =>
  `${prefix}:${randomBytes(32).toString("base64url")}`;

async function procedureIntegrity(
  value: TheoryExperimentProcedureV1,
): Promise<boolean> {
  if (validateTheoryExperimentProcedureV1(value).length > 0) return false;
  const {
    procedureSha256: _procedureSha256,
    artifactId: _artifactId,
    schemaVersion: _schemaVersion,
    ...unsigned
  } = value;
  return (
    value.procedureSha256 ===
    (await computeCasimirSpecValueSha256V1({
      domain: THEORY_EXPERIMENT_PROCEDURE_HASH_DOMAIN,
      value: unsigned,
    }))
  );
}

async function admitCurrentTurnProcedure(input: {
  turnId: string;
  procedureId: string;
  procedureSha256: string;
  authoritativeEvidenceArtifacts?: unknown[];
}): Promise<{
  procedure: TheoryExperimentProcedureV1 | null;
  issue: string | null;
}> {
  if (!Array.isArray(input.authoritativeEvidenceArtifacts))
    return {
      procedure: null,
      issue: "formal_authoritative_evidence_artifacts_required",
    };
  const matches = input.authoritativeEvidenceArtifacts
    .map(record)
    .filter(
      (envelope) =>
        envelope.schema === CURRENT_TURN_ARTIFACT_SCHEMA &&
        string(envelope.turn_id ?? envelope.turnId) === input.turnId &&
        envelope.assistant_answer === false &&
        envelope.terminal_eligible === false,
    )
    .map((envelope) => {
      const payload = record(envelope.payload);
      return { payload, procedure: record(payload.procedure) };
    })
    .filter(
      ({ payload, procedure }) =>
        payload.schema === PROCEDURE_OBSERVATION_SCHEMA &&
        payload.status === "succeeded" &&
        payload.assistant_answer === false &&
        payload.terminal_eligible === false &&
        procedure.procedureId === input.procedureId &&
        procedure.procedureSha256 === input.procedureSha256,
    );
  if (matches.length === 0)
    return {
      procedure: null,
      issue: "formal_authoritative_procedure_artifact_not_admitted",
    };
  if (matches.length > 1)
    return {
      procedure: null,
      issue: "formal_authoritative_procedure_artifact_ambiguous",
    };
  const procedure =
    matches[0].procedure as TheoryExperimentProcedureV1;
  return (await procedureIntegrity(procedure))
    ? { procedure, issue: null }
    : {
        procedure: null,
        issue: "formal_authoritative_procedure_artifact_invalid",
      };
}

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

async function validateSealedExecutionAgainstProcedure(input: {
  sealedExecution: CasimirFormalVerificationSealedExecutionV2;
  procedure: TheoryExperimentProcedureV1;
}): Promise<string[]> {
  const { sealedExecution, procedure } = input;
  const request = sealedExecution.request;
  const issues: string[] = [];
  const [masterProblemArtifactSha256, derivationProgramArtifactSha256] =
    await Promise.all([
      computeCasimirSpecValueSha256V1(procedure.masterProblem),
      computeCasimirSpecValueSha256V1(procedure.derivationProgram),
    ]);
  if (
    request.masterProblem.planId !== procedure.masterProblem.planId ||
    request.masterProblem.artifactSha256 !==
      masterProblemArtifactSha256
  )
    issues.push("formal_execution_master_problem_lineage_mismatch");
  if (
    request.derivationProgram.programId !==
      procedure.derivationProgram.programId ||
    request.derivationProgram.sourceMasterProblemPlanId !==
      procedure.derivationProgram.sourceMasterProblemPlanId ||
    request.derivationProgram.artifactSha256 !==
      derivationProgramArtifactSha256
  )
    issues.push("formal_execution_derivation_program_lineage_mismatch");
  if (request.theoryGraph.graphId !== procedure.graphId)
    issues.push("formal_execution_graph_identity_mismatch");
  const candidateBadgeIds = sortedUnique([
    ...procedure.request.selectedBadgeIds,
    ...procedure.request.comparisonBadgeIds,
  ]);
  if (
    JSON.stringify(request.semanticClaim.candidateBadgeIds) !==
    JSON.stringify(candidateBadgeIds)
  )
    issues.push("formal_execution_candidate_badge_lineage_mismatch");
  const semanticMatches = procedure.evidenceBindings.filter((binding) => {
    const lineage = binding.lineage;
    const claim = lineage?.claims.find(
      (candidate) =>
        candidate.claimId === request.semanticClaim.claimId &&
        candidate.propositionSha256 ===
          request.semanticClaim.propositionSha256,
    );
    return (
      binding.kind === "semantic_admission" &&
      lineage?.sourceKind === "semantic_claim_ir" &&
      lineage.casimirSpecId === request.casimirSpec.specId &&
      lineage.casimirSpecSemanticSha256 ===
        request.casimirSpec.semanticSha256 &&
      lineage.casimirSpecArtifactSha256 ===
        request.casimirSpec.artifactSha256 &&
      lineage.sourceGraphId === request.theoryGraph.graphId &&
      lineage.sourceGraphSnapshotSha256 ===
        request.theoryGraph.snapshotSha256 &&
      JSON.stringify(sortedUnique(lineage.candidateBadgeIds)) ===
        JSON.stringify(candidateBadgeIds) &&
      Boolean(claim)
    );
  });
  if (semanticMatches.length === 0)
    issues.push("formal_execution_semantic_lineage_mismatch");
  if (semanticMatches.length > 1)
    issues.push("formal_execution_semantic_lineage_ambiguous");
  return [...new Set(issues)].sort();
}

export function createCasimirFormalVerifierJobServiceV2(
  dependencies: CasimirFormalVerifierJobServiceDependenciesV2 = {},
) {
  const stateStore =
    dependencies.stateStore ??
    createInMemoryCasimirTheoryExecutionStateStoreV1();
  const activeJobIds = new Set<string>();
  const confirmations = createRuntimeToolConfirmationReceiptVerifierV1({
    verifyTrustedRuntimeReceipt: dependencies.verifyTrustedRuntimeReceipt,
    replayLedger: dependencies.confirmationReplayLedger,
    requireDurableReplayProtection: Boolean(
      dependencies.verifyTrustedRuntimeReceipt,
    ),
    now: dependencies.now,
  });
  const inspectConfiguration =
    (): CasimirFormalVerifierRuntimeReadinessV2 => {
      const composition = {
        executionCatalogResolverConfigured:
          typeof dependencies.resolveTrustedExecutionCatalogEntry ===
          "function",
        executionCatalogInspectorConfigured:
          typeof dependencies.inspectTrustedExecutionCatalog ===
          "function",
        externalSandboxExecutorResolverConfigured:
          typeof dependencies.resolveExternalSandboxExecutor ===
          "function",
        trustedReceiptVerifierConfigured:
          typeof dependencies.verifyTrustedRuntimeReceipt === "function",
        durableReplayLedgerConfigured: Boolean(
          dependencies.confirmationReplayLedger,
        ),
        durableJobStateStoreConfigured:
          stateStore.durability === "durable_postgres",
      };
      const blockerCodes: string[] = [];
      let catalog = {
        configured: false,
        entryCount: 0,
        issues: [] as string[],
      };
      if (!composition.executionCatalogResolverConfigured)
        blockerCodes.push("formal_execution_catalog_unconfigured");
      if (!composition.executionCatalogInspectorConfigured) {
        blockerCodes.push(
          "formal_execution_catalog_inspector_unconfigured",
        );
      } else {
        try {
          const inspected =
            dependencies.inspectTrustedExecutionCatalog?.();
          if (
            !inspected ||
            inspected.schema !==
              "casimir.formal_verification_execution_catalog.v2" ||
            typeof inspected.configured !== "boolean" ||
            !Number.isSafeInteger(inspected.entryCount) ||
            inspected.entryCount < 0 ||
            !Array.isArray(inspected.entries) ||
            inspected.entries.length !== inspected.entryCount ||
            !Array.isArray(inspected.issues)
          ) {
            blockerCodes.push(
              "formal_execution_catalog_inspection_invalid",
            );
          } else {
            catalog = {
              configured: inspected.configured,
              entryCount: inspected.entryCount,
              issues: [...new Set(inspected.issues)].sort(),
            };
            if (
              !catalog.configured ||
              catalog.entryCount === 0 ||
              catalog.issues.length > 0
            ) {
              blockerCodes.push(
                "formal_execution_catalog_empty_or_invalid",
              );
            }
          }
        } catch {
          blockerCodes.push(
            "formal_execution_catalog_inspection_failed",
          );
        }
      }
      if (!composition.externalSandboxExecutorResolverConfigured)
        blockerCodes.push(
          "formal_external_sandbox_executor_unconfigured",
        );
      if (!composition.trustedReceiptVerifierConfigured)
        blockerCodes.push(
          "runtime_approval_receipt_issuer_unconfigured",
        );
      if (!composition.durableReplayLedgerConfigured)
        blockerCodes.push(
          "runtime_approval_receipt_replay_ledger_unconfigured",
        );
      if (!composition.durableJobStateStoreConfigured)
        blockerCodes.push(
          "formal_durable_job_state_store_unconfigured",
        );
      const configuredForExactResolutionAttempt =
        blockerCodes.length === 0;
      return {
        schema: CASIMIR_FORMAL_VERIFIER_RUNTIME_READINESS_SCHEMA_V2,
        status: configuredForExactResolutionAttempt
          ? "configured"
          : "blocked",
        composition,
        catalog,
        configuredForExactResolutionAttempt,
        blockerCodes,
        authority: {
          ...authority(),
          configurationEvidenceOnly: true,
          exactCatalogEntryResolved: false,
          exactExecutorResolved: false,
        },
      };
    };

  const blockedPreparation = (
    executionCatalogEntryId: string | null,
    issue: string | string[],
  ): CasimirFormalVerifierPreparedRequestV2 => ({
    schema: CASIMIR_FORMAL_VERIFIER_PREPARED_REQUEST_SCHEMA_V2,
    ok: false,
    status: "blocked",
    preparedRequestId: null,
    executionCatalogEntryId,
    requestId: null,
    requestArtifactSha256: null,
    sealedInputSha256: null,
    issues: [...new Set(Array.isArray(issue) ? issue : [issue])].sort(),
    nextCapability: "repair_formal_verification_catalog",
    authority: authority(),
  });

  const prepareRequest = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    turnId?: string | null;
    authoritativeEvidenceArtifacts?: unknown[];
    executionCatalogEntryId?: string | null;
    procedureId?: string | null;
    procedureSha256?: string | null;
  }): Promise<CasimirFormalVerifierPreparedRequestV2> => {
    const profileId = input.profileId?.trim() ?? "";
    const turnId = input.turnId?.trim() ?? "";
    const executionCatalogEntryId =
      input.executionCatalogEntryId?.trim() ?? "";
    const procedureId = input.procedureId?.trim() ?? "";
    const procedureSha256 = input.procedureSha256?.trim() ?? "";
    if (input.accountType !== "developer")
      return blockedPreparation(
        executionCatalogEntryId || null,
        "developer_account_required",
      );
    if (!profileId)
      return blockedPreparation(
        executionCatalogEntryId || null,
        "developer_profile_required",
      );
    if (!turnId)
      return blockedPreparation(
        executionCatalogEntryId || null,
        "formal_current_turn_id_required",
      );
    if (!executionCatalogEntryId)
      return blockedPreparation(
        null,
        "formal_execution_catalog_entry_id_required",
      );
    if (!procedureId)
      return blockedPreparation(
        executionCatalogEntryId,
        "formal_procedure_id_required",
      );
    if (!SHA256.test(procedureSha256))
      return blockedPreparation(
        executionCatalogEntryId,
        "formal_procedure_hash_required",
      );
    const admission = await admitCurrentTurnProcedure({
      turnId,
      procedureId,
      procedureSha256,
      authoritativeEvidenceArtifacts:
        input.authoritativeEvidenceArtifacts,
    });
    if (admission.issue || !admission.procedure)
      return blockedPreparation(
        executionCatalogEntryId,
        admission.issue ??
          "formal_authoritative_procedure_artifact_invalid",
      );
    if (!dependencies.resolveTrustedExecutionCatalogEntry)
      return blockedPreparation(
        executionCatalogEntryId,
        "formal_execution_catalog_unconfigured",
      );
    let resolved: CasimirFormalVerificationSealedExecutionV2 | null;
    try {
      resolved =
        (await dependencies.resolveTrustedExecutionCatalogEntry({
          accountType: input.accountType,
          profileId,
          executionCatalogEntryId,
          procedureId,
          procedureSha256,
        })) ?? null;
    } catch {
      return blockedPreparation(
        executionCatalogEntryId,
        "formal_execution_catalog_resolution_failed",
      );
    }
    if (!resolved)
      return blockedPreparation(
        executionCatalogEntryId,
        "formal_execution_catalog_entry_not_found",
      );
    const sealedExecution =
      cloneCasimirFormalVerificationSealedExecutionV2(resolved);
    const issues =
      await validateCasimirFormalVerificationSealedExecutionV2(
        sealedExecution,
      );
    issues.push(
      ...(await validateSealedExecutionAgainstProcedure({
        sealedExecution,
        procedure: admission.procedure,
      })),
    );
    if (
      sealedExecution.executionCatalogEntryId !==
        executionCatalogEntryId ||
      sealedExecution.procedure.procedureId !== procedureId ||
      sealedExecution.procedure.procedureSha256 !== procedureSha256
    )
      issues.push("formal_execution_catalog_binding_mismatch");
    if (issues.length > 0)
      return blockedPreparation(executionCatalogEntryId, issues);
    const sealedInputSha256 =
      await computeCasimirFormalVerificationSealedExecutionSha256V2(
        sealedExecution,
      );
    const preparedRequestId = opaqueId(
      "casimir-formal-verifier-prepared-v2",
    );
    await stateStore.put<PreparedRecord>("prepared", preparedRequestId, {
      ownerKey: ownerKey(input.accountType, profileId),
      sealedInputSha256,
      sealedExecution,
    });
    return {
      schema: CASIMIR_FORMAL_VERIFIER_PREPARED_REQUEST_SCHEMA_V2,
      ok: true,
      status: "prepared",
      preparedRequestId,
      executionCatalogEntryId,
      requestId: sealedExecution.request.requestId,
      requestArtifactSha256:
        sealedExecution.request.artifactSha256,
      sealedInputSha256,
      issues: [],
      nextCapability: "theory-formal-verifier.plan",
      authority: authority(),
    };
  };

  const plan = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    preparedRequestId?: string | null;
  }): Promise<CasimirFormalVerifierPlanV2> => {
    const preparedRequestId =
      input.preparedRequestId?.trim() ?? "";
    const entry = await stateStore.get<PreparedRecord>(
      "prepared",
      preparedRequestId,
    );
    const issues: string[] = [];
    if (input.accountType !== "developer")
      issues.push("developer_account_required");
    if (
      !entry ||
      entry.ownerKey !== ownerKey(input.accountType, input.profileId)
    )
      issues.push("formal_prepared_request_not_found");
    if (entry) {
      issues.push(
        ...(await validateCasimirFormalVerificationSealedExecutionV2(
          entry.sealedExecution,
        )),
      );
      const currentHash =
        await computeCasimirFormalVerificationSealedExecutionSha256V2(
          entry.sealedExecution,
        );
      if (currentHash !== entry.sealedInputSha256)
        issues.push("formal_prepared_request_integrity_mismatch");
      if (!dependencies.resolveExternalSandboxExecutor)
        issues.push("formal_external_sandbox_executor_unconfigured");
      else {
        try {
          const executor =
            await dependencies.resolveExternalSandboxExecutor({
              capabilityId:
                entry.sealedExecution.executorCapability.capabilityId,
              artifactSha256:
                entry.sealedExecution.executorCapability.artifactSha256,
            });
          if (
            !executor ||
            executor.capabilityId !==
              entry.sealedExecution.executorCapability.capabilityId ||
            executor.artifactSha256 !==
              entry.sealedExecution.executorCapability.artifactSha256
          )
            issues.push(
              "formal_external_sandbox_executor_capability_mismatch",
            );
        } catch {
          issues.push(
            "formal_external_sandbox_executor_resolution_failed",
          );
        }
      }
    }
    const unique = [...new Set(issues)].sort();
    const planId =
      entry && unique.length === 0
        ? await computeCasimirSpecValueSha256V1({
            domain: "casimir-formal-verifier-plan/v2",
            owner: entry.ownerKey,
            preparedRequestId,
            sealedInputSha256: entry.sealedInputSha256,
          })
        : null;
    if (entry && planId)
      await stateStore.put<PlanRecord>("plan", planId, {
        ownerKey: entry.ownerKey,
        preparedRequestId,
        sealedInputSha256: entry.sealedInputSha256,
      });
    return {
      schema: CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA_V2,
      ok: Boolean(entry && planId && unique.length === 0),
      status:
        entry && planId && unique.length === 0 ? "ready" : "blocked",
      preparedRequestId: preparedRequestId || null,
      planId,
      requestId: entry?.sealedExecution.request.requestId ?? null,
      requestArtifactSha256:
        entry?.sealedExecution.request.artifactSha256 ?? null,
      sealedInputSha256: entry?.sealedInputSha256 ?? null,
      issues: unique,
      confirmationRequired: true,
      nextCapability:
        entry && planId && unique.length === 0
          ? "theory-formal-verifier.start"
          : "repair_formal_verification_inputs",
      authority: authority(),
    };
  };

  const start = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    preparedRequestId?: string | null;
    planId?: string | null;
    sessionId?: string | null;
    turnId?: string | null;
    approvalReceipt?: unknown;
    approvalToken?: string | null;
  }): Promise<CasimirFormalVerifierJobReceiptV2> => {
    const planned = await plan(input);
    const blocked = (
      issues: string[],
      status: "blocked" | "needs_confirmation" = "blocked",
    ): CasimirFormalVerifierJobReceiptV2 => ({
      schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA_V2,
      ok: false,
      status,
      planId: planned.planId,
      sealedInputSha256: planned.sealedInputSha256,
      jobId: null,
      requestId: planned.requestId,
      issues,
      nextCapability:
        status === "needs_confirmation"
          ? "request_user_confirmation"
          : "repair_formal_verification_inputs",
      authority: authority(),
    });
    if (!planned.ok || !planned.planId)
      return blocked(planned.issues);
    if (input.planId?.trim() !== planned.planId)
      return blocked(["formal_verifier_plan_id_mismatch"]);
    const preparedRequestId =
      input.preparedRequestId?.trim() ?? "";
    const [entry, planRecord] = await Promise.all([
      stateStore.get<PreparedRecord>("prepared", preparedRequestId),
      stateStore.get<PlanRecord>("plan", planned.planId),
    ]);
    if (
      !entry ||
      !planRecord ||
      planRecord.preparedRequestId !== preparedRequestId ||
      planRecord.ownerKey !== entry.ownerKey ||
      planRecord.sealedInputSha256 !== entry.sealedInputSha256
    )
      return blocked(["formal_verifier_plan_binding_invalid"]);
    const confirmation = await confirmations.consume({
      receipt: input.approvalReceipt,
      legacyApprovalToken: input.approvalToken,
      expectedBinding: {
        capabilityId: CASIMIR_FORMAL_VERIFIER_START_CAPABILITY_ID,
        planId: planned.planId,
        accountType: input.accountType,
        profileId: input.profileId?.trim() ?? "",
        sessionId: input.sessionId?.trim() ?? "",
        turnId: input.turnId?.trim() ?? "",
        sealedInputSha256: entry.sealedInputSha256,
      },
    });
    if (!confirmation.ok)
      return blocked(
        confirmation.issues,
        confirmation.status === "needs_confirmation"
          ? "needs_confirmation"
          : "blocked",
      );
    const existing = (await stateStore.list<JobRecord>("job")).find(
      (job: JobRecord) =>
        job.planId === planned.planId &&
        job.ownerKey === entry.ownerKey,
    );
    if (existing)
      return {
        schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA_V2,
        ok: true,
        status: "running",
        planId: existing.planId,
        sealedInputSha256: existing.sealedInputSha256,
        jobId: existing.jobId,
        requestId: existing.requestId,
        issues: [],
        nextCapability:
          CASIMIR_FORMAL_VERIFIER_READ_RESULT_CAPABILITY_ID,
        authority: authority(),
      };
    const job: JobRecord = {
      ownerKey: entry.ownerKey,
      jobId: opaqueId("casimir-formal-verifier-job-v2"),
      planId: planned.planId,
      sealedInputSha256: entry.sealedInputSha256,
      requestId: entry.sealedExecution.request.requestId,
      status: "running",
      certificate: null,
      issues: [],
    };
    activeJobIds.add(job.jobId);
    await stateStore.put<JobRecord>("job", job.jobId, job);
    void (async () => {
      try {
        const executor =
          await dependencies.resolveExternalSandboxExecutor?.({
            capabilityId:
              entry.sealedExecution.executorCapability.capabilityId,
            artifactSha256:
              entry.sealedExecution.executorCapability.artifactSha256,
          });
        if (
          !executor ||
          executor.capabilityId !==
            entry.sealedExecution.executorCapability.capabilityId ||
          executor.artifactSha256 !==
            entry.sealedExecution.executorCapability.artifactSha256
        )
          throw new Error(
            "formal_external_sandbox_executor_capability_unavailable",
          );
        const certificate = await executor.execute({
          jobId: job.jobId,
          planId: job.planId,
          sealedInputSha256: job.sealedInputSha256,
          sealedExecution:
            cloneCasimirFormalVerificationSealedExecutionV2(
              entry.sealedExecution,
            ),
        });
        const issues =
          await validateCasimirFormalVerificationCertificateV2AgainstRequest(
            certificate,
            entry.sealedExecution.request,
          );
        if (
          certificate.sandbox.sandboxPolicySha256 !==
            entry.sealedExecution.executorCapability
              .sandboxPolicySha256 ||
          certificate.sandbox.attestationSha256 !==
            entry.sealedExecution.executorCapability.attestation
              .evidenceSha256 ||
          certificate.sandbox.processLimit >
            entry.sealedExecution.executorCapability.resourceCeilings
              .maxProcessCount
        )
          issues.push("formal_certificate_executor_attestation_mismatch");
        if (issues.length > 0) {
          job.status = "failed";
          job.issues = [...new Set(issues)].sort();
          await stateStore.put<JobRecord>("job", job.jobId, job);
          return;
        }
        job.certificate = certificate;
        job.status = "completed";
        await stateStore.put<JobRecord>("job", job.jobId, job);
      } catch (error) {
        job.status = "failed";
        job.issues = [
          error instanceof Error
            ? error.message
            : "formal_external_sandbox_execution_failed",
        ];
        await stateStore.put<JobRecord>("job", job.jobId, job);
      } finally {
        activeJobIds.delete(job.jobId);
      }
    })();
    return {
      schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA_V2,
      ok: true,
      status: "running",
      planId: job.planId,
      sealedInputSha256: job.sealedInputSha256,
      jobId: job.jobId,
      requestId: job.requestId,
      issues: [],
      nextCapability:
        CASIMIR_FORMAL_VERIFIER_READ_RESULT_CAPABILITY_ID,
      authority: authority(),
    };
  };

  const readResult = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    jobId?: string | null;
  }): Promise<CasimirFormalVerifierResultV2> => {
    const jobId = input.jobId?.trim() ?? "";
    const job = await stateStore.get<JobRecord>("job", jobId);
    if (
      input.accountType !== "developer" ||
      !job ||
      job.ownerKey !== ownerKey(input.accountType, input.profileId)
    )
      return {
        schema: CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA_V2,
        ok: false,
        status: "blocked",
        jobId: jobId || null,
        planId: null,
        sealedInputSha256: null,
        requestId: null,
        certificate: null,
        issues: [
          input.accountType !== "developer"
            ? "developer_account_required"
            : "formal_verifier_job_not_found",
        ],
        authority: authority(),
      };
    if (job.status === "running" && !activeJobIds.has(job.jobId)) {
      job.status = "failed";
      job.issues = ["formal_job_interrupted_by_server_restart"];
      await stateStore.put<JobRecord>("job", job.jobId, job);
    }
    return {
      schema: CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA_V2,
      ok: job.status !== "failed",
      status: job.status,
      jobId: job.jobId,
      planId: job.planId,
      sealedInputSha256: job.sealedInputSha256,
      requestId: job.requestId,
      certificate: job.certificate,
      issues: [...job.issues],
      authority: authority(),
    };
  };

  const reset = async (): Promise<void> => {
    activeJobIds.clear();
    await stateStore.clear();
    confirmations.reset();
  };

  return {
    inspectConfiguration,
    prepareRequest,
    plan,
    start,
    readResult,
    reset,
  };
}

let defaultService = createCasimirFormalVerifierJobServiceV2();

export const installCasimirFormalVerifierDependenciesForServerV2 = (
  dependencies: CasimirFormalVerifierJobServiceDependenciesV2,
): void => {
  defaultService = createCasimirFormalVerifierJobServiceV2(dependencies);
};
export const inspectCasimirFormalVerifierRuntimeReadinessV2 = () =>
  defaultService.inspectConfiguration();
export const prepareCasimirFormalVerifierRequestV2 = (
  input: Parameters<typeof defaultService.prepareRequest>[0],
) => defaultService.prepareRequest(input);
export const planCasimirFormalVerifierJobV2 = (
  input: Parameters<typeof defaultService.plan>[0],
) => defaultService.plan(input);
export const startCasimirFormalVerifierJobV2 = (
  input: Parameters<typeof defaultService.start>[0],
) => defaultService.start(input);
export const readCasimirFormalVerifierJobResultV2 = (
  input: Parameters<typeof defaultService.readResult>[0],
) => defaultService.readResult(input);
export const resetCasimirFormalVerifierJobsForTestsV2 = (): Promise<void> =>
  defaultService.reset();
