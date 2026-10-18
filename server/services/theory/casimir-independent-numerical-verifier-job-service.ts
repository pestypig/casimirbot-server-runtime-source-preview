import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HelixAccountType } from "../../../shared/helix-account-session";
import { validateCasimirIndependentNumericalReplayPolicyIntegrityV1 } from "../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import {
  validateCasimirIndependentNumericalVerificationRequestIntegrityV1,
  type CasimirIndependentNumericalVerificationCertificateV1,
} from "../../../shared/contracts/casimir-independent-numerical-verification.v1";
import { computeCasimirSpecValueSha256V1 } from "../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import {
  THEORY_EXPERIMENT_PROCEDURE_HASH_DOMAIN,
  validateTheoryExperimentProcedureV1,
  type TheoryExperimentProcedureV1,
} from "../../../shared/contracts/theory-experiment-procedure.v1";
import type { CasimirFormalLeanProcessRunnerV1 } from "./casimir-formal-lean-replay";
import {
  cloneCasimirIndependentNumericalSealedInputV1,
  computeCasimirIndependentNumericalSealedInputSha256V1,
  isCasimirIndependentNumericalExecutionCatalogResolutionErrorV1,
  type CasimirIndependentNumericalSealedInputV1,
  type TrustedCasimirIndependentNumericalExecutionCatalogResolverV1,
} from "./casimir-independent-numerical-execution-catalog";
import {
  replayCasimirIndependentNumericalRequestV1,
  validateCasimirIndependentNumericalEvidenceChainV1,
} from "./casimir-independent-numerical-replay";
import {
  createRuntimeToolConfirmationReceiptVerifierV1,
  type TrustedRuntimeToolConfirmationReplayLedgerV1,
  type TrustedRuntimeToolConfirmationVerifierV1,
} from "./runtime-tool-confirmation-receipt-verifier";
import {
  createInMemoryCasimirTheoryExecutionStateStoreV1,
  type CasimirTheoryExecutionStateStoreV1,
} from "./casimir-theory-execution-state-store";

export const CASIMIR_INDEPENDENT_NUMERICAL_PLAN_SCHEMA =
  "casimir.independent_numerical_verifier.plan.v1" as const;
export const CASIMIR_INDEPENDENT_NUMERICAL_PREPARED_REQUEST_SCHEMA =
  "casimir.independent_numerical_verifier.prepared_request.v1" as const;
export const CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA =
  "casimir.independent_numerical_verifier.job_receipt.v1" as const;
export const CASIMIR_INDEPENDENT_NUMERICAL_RESULT_SCHEMA =
  "casimir.independent_numerical_verifier.result.v1" as const;
export const CASIMIR_INDEPENDENT_NUMERICAL_RUNTIME_INSPECTION_SCHEMA =
  "casimir.independent_numerical_verifier.runtime_inspection.v1" as const;

export type { CasimirIndependentNumericalSealedInputV1 } from "./casimir-independent-numerical-execution-catalog";

type EvidenceAuthority = {
  outputRole: "evidence_for_bounded_synthesis";
  frozenNumericalComparisonChecked: false;
  independentImplementationCompared: false;
  validatesSemanticIntent: false;
  validatesTheory: false;
  validatesGeneratedCode: false;
  validatesNumericalImplementation: false;
  validatesEmpiricalClaim: false;
  validatesPhysicalMechanism: false;
  formalPropositionChecked: false;
  assistantAnswer: false;
  terminalEligible: false;
  promotionAllowed: false;
  postToolModelStepRequired: true;
};

export type CasimirIndependentNumericalPlanV1 = {
  schema: typeof CASIMIR_INDEPENDENT_NUMERICAL_PLAN_SCHEMA;
  ok: boolean;
  status: "ready" | "blocked";
  preparedRequestId: string | null;
  planId: string | null;
  requestId: string | null;
  requestArtifactSha256: string | null;
  policyArtifactSha256: string | null;
  sealedInputSha256: string | null;
  issues: string[];
  confirmationRequired: true;
  nextCapability:
    | "theory-independent-numerical-verifier.start"
    | "repair_independent_numerical_inputs";
  authority: EvidenceAuthority;
};

export type CasimirIndependentNumericalPreparedRequestV1 = {
  schema: typeof CASIMIR_INDEPENDENT_NUMERICAL_PREPARED_REQUEST_SCHEMA;
  ok: boolean;
  status: "prepared" | "blocked";
  preparedRequestId: string | null;
  catalogEntryId: string | null;
  requestId: string | null;
  requestArtifactSha256: string | null;
  policyArtifactSha256: string | null;
  sealedInputSha256: string | null;
  issues: string[];
  nextCapability:
    | "theory-independent-numerical-verifier.plan"
    | "repair_independent_numerical_catalog";
  authority: EvidenceAuthority;
};

export type CasimirIndependentNumericalJobReceiptV1 = {
  schema: typeof CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA;
  ok: boolean;
  status: "running" | "needs_confirmation" | "blocked";
  planId: string | null;
  jobId: string | null;
  requestId: string | null;
  issues: string[];
  nextCapability:
    | "theory-independent-numerical-verifier.read_result"
    | "request_user_confirmation"
    | "repair_independent_numerical_inputs";
  authority: EvidenceAuthority;
};

export type CasimirIndependentNumericalResultV1 = {
  schema: typeof CASIMIR_INDEPENDENT_NUMERICAL_RESULT_SCHEMA;
  ok: boolean;
  status: "running" | "completed" | "failed" | "blocked";
  jobId: string | null;
  planId: string | null;
  requestId: string | null;
  certificate: CasimirIndependentNumericalVerificationCertificateV1 | null;
  issues: string[];
  authority: EvidenceAuthority;
};

export type CasimirIndependentNumericalRuntimeInspectionV1 = {
  schema: typeof CASIMIR_INDEPENDENT_NUMERICAL_RUNTIME_INSPECTION_SCHEMA;
  executionCatalogConfigured: boolean;
  sandboxExecutorConfigured: boolean;
  trustedReceiptVerifierConfigured: boolean;
  durableReplayLedgerConfigured: boolean;
  durableJobStateStoreConfigured: boolean;
  readyForConfirmedExecution: boolean;
  assistantAnswer: false;
  terminalEligible: false;
};

type JobRecord = {
  jobId: string;
  planId: string;
  ownerKey: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  certificate: CasimirIndependentNumericalVerificationCertificateV1 | null;
  issues: string[];
};

type PreparedRequestRecord = {
  preparedRequestId: string;
  catalogEntryId: string;
  ownerKey: string;
  sealedInputSha256: string;
  sealedInput: CasimirIndependentNumericalSealedInputV1;
};

type PlanRecord = {
  planId: string;
  preparedRequestId: string;
  ownerKey: string;
  sealedInputSha256: string;
};

export type CasimirIndependentNumericalVerifierJobServiceDependenciesV1 = {
  /**
   * @deprecated Harness paths are authority-bearing and now come only from
   * the resolved sealed catalog entry.
   */
  resolveHarnessSourcePath?: () => string | null;
  /**
   * @deprecated Harness paths are authority-bearing and now come only from
   * the resolved sealed catalog entry.
   */
  resolveHarnessExecutablePath?: () => string | null;
  /**
   * @deprecated A bare process runner is not sandbox authority and is ignored.
   * Install an exact capability-bound sandbox executor resolver instead.
   */
  runner?: CasimirFormalLeanProcessRunnerV1;
  resolveSandboxedExecutor?: (input: {
    capabilityId: string;
    artifactSha256: string;
  }) =>
    | Promise<{
        capabilityId: string;
        artifactSha256: string;
        runner: CasimirFormalLeanProcessRunnerV1;
      } | null>
    | {
        capabilityId: string;
        artifactSha256: string;
        runner: CasimirFormalLeanProcessRunnerV1;
      }
    | null;
  verifyTrustedRuntimeReceipt?: TrustedRuntimeToolConfirmationVerifierV1;
  confirmationReplayLedger?: TrustedRuntimeToolConfirmationReplayLedgerV1;
  resolveTrustedExecutionCatalogEntry?: TrustedCasimirIndependentNumericalExecutionCatalogResolverV1;
  stateStore?: CasimirTheoryExecutionStateStoreV1;
  now?: () => number;
};

const authority = (): EvidenceAuthority => ({
  outputRole: "evidence_for_bounded_synthesis",
  frozenNumericalComparisonChecked: false,
  independentImplementationCompared: false,
  validatesSemanticIntent: false,
  validatesTheory: false,
  validatesGeneratedCode: false,
  validatesNumericalImplementation: false,
  validatesEmpiricalClaim: false,
  validatesPhysicalMechanism: false,
  formalPropositionChecked: false,
  assistantAnswer: false,
  terminalEligible: false,
  promotionAllowed: false,
  postToolModelStepRequired: true,
});

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const ownerKey = (
  accountType: HelixAccountType,
  profileId?: string | null,
): string => `${accountType}:${profileId?.trim() || "unbound"}`;
const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const requestRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const CURRENT_TURN_ARTIFACT_SCHEMA = "helix.current_turn_artifact.v1";
const PROCEDURE_OBSERVATION_SCHEMA =
  "casimir.theory_experiment_procedure.observation.v1";

async function validateCurrentTurnProcedureIntegrity(
  procedure: TheoryExperimentProcedureV1,
): Promise<boolean> {
  if (validateTheoryExperimentProcedureV1(procedure).length > 0) return false;
  const {
    procedureSha256: _procedureSha256,
    artifactId: _artifactId,
    schemaVersion: _schemaVersion,
    ...unsigned
  } = procedure;
  const expected = await computeCasimirSpecValueSha256V1({
    domain: THEORY_EXPERIMENT_PROCEDURE_HASH_DOMAIN,
    value: unsigned,
  });
  return procedure.procedureSha256 === expected;
}

async function admitCurrentTurnProcedure(input: {
  turnId: string;
  procedureId: string;
  procedureSha256: string;
  authoritativeEvidenceArtifacts?: unknown[];
}): Promise<
  | { ok: true }
  | {
      ok: false;
      issue:
        | "numerical_authoritative_evidence_artifacts_required"
        | "numerical_authoritative_procedure_artifact_not_admitted"
        | "numerical_authoritative_procedure_artifact_ambiguous"
        | "numerical_authoritative_procedure_artifact_invalid";
    }
> {
  if (!Array.isArray(input.authoritativeEvidenceArtifacts)) {
    return {
      ok: false,
      issue: "numerical_authoritative_evidence_artifacts_required",
    };
  }
  const candidates = input.authoritativeEvidenceArtifacts
    .map(requestRecord)
    .filter(
      (envelope) =>
        envelope.schema === CURRENT_TURN_ARTIFACT_SCHEMA &&
        optionalString(envelope.turn_id ?? envelope.turnId) === input.turnId &&
        envelope.assistant_answer === false &&
        envelope.terminal_eligible === false,
    )
    .map((envelope) => {
      const payload = requestRecord(envelope.payload);
      return {
        payload,
        procedure: requestRecord(payload.procedure),
      };
    })
    .filter(
      (candidate) =>
        candidate.payload.schema === PROCEDURE_OBSERVATION_SCHEMA &&
        candidate.payload.status === "succeeded" &&
        candidate.payload.assistant_answer === false &&
        candidate.payload.terminal_eligible === false &&
        candidate.procedure.procedureId === input.procedureId &&
        candidate.procedure.procedureSha256 === input.procedureSha256,
    );
  if (candidates.length === 0) {
    return {
      ok: false,
      issue: "numerical_authoritative_procedure_artifact_not_admitted",
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      issue: "numerical_authoritative_procedure_artifact_ambiguous",
    };
  }
  if (
    !(await validateCurrentTurnProcedureIntegrity(
      candidates[0].procedure as TheoryExperimentProcedureV1,
    ))
  ) {
    return {
      ok: false,
      issue: "numerical_authoritative_procedure_artifact_invalid",
    };
  }
  return { ok: true };
}

async function inspectFile(
  filePath: string | null,
  label: string,
): Promise<
  { absolutePath: string; artifactSha256: string } | { issue: string }
> {
  if (!filePath) return { issue: `${label}_not_configured` };
  if (!path.isAbsolute(filePath))
    return { issue: `${label}_path_not_absolute` };
  const absolutePath = path.resolve(filePath);
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink())
      return { issue: `${label}_not_regular_file` };
    const realPath = await fs.realpath(absolutePath);
    const same =
      process.platform === "win32"
        ? realPath.toLowerCase() === absolutePath.toLowerCase()
        : realPath === absolutePath;
    if (!same) return { issue: `${label}_path_alias_forbidden` };
    return {
      absolutePath,
      artifactSha256: sha256(await fs.readFile(absolutePath)),
    };
  } catch {
    return { issue: `${label}_unreadable` };
  }
}

async function cleanupTempRoot(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (
    !resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) ||
    !path.basename(resolvedRoot).startsWith("casimir-numerical-verifier-")
  ) {
    return;
  }
  await fs.rm(resolvedRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

export function createCasimirIndependentNumericalVerifierJobService(
  dependencies: CasimirIndependentNumericalVerifierJobServiceDependenciesV1 = {},
) {
  const stateStore =
    dependencies.stateStore ??
    createInMemoryCasimirTheoryExecutionStateStoreV1();
  const activeJobIds = new Set<string>();
  const confirmationReceipts = createRuntimeToolConfirmationReceiptVerifierV1({
    verifyTrustedRuntimeReceipt: dependencies.verifyTrustedRuntimeReceipt,
    replayLedger: dependencies.confirmationReplayLedger,
    requireDurableReplayProtection: Boolean(
      dependencies.verifyTrustedRuntimeReceipt,
    ),
    now: dependencies.now,
  });
  const inspectConfiguration =
    (): CasimirIndependentNumericalRuntimeInspectionV1 => {
      const executionCatalogConfigured =
        typeof dependencies.resolveTrustedExecutionCatalogEntry === "function";
      const sandboxExecutorConfigured =
        typeof dependencies.resolveSandboxedExecutor === "function";
      const trustedReceiptVerifierConfigured =
        typeof dependencies.verifyTrustedRuntimeReceipt === "function";
      const durableReplayLedgerConfigured = Boolean(
        dependencies.confirmationReplayLedger,
      );
      const durableJobStateStoreConfigured =
        stateStore.durability === "durable_postgres";
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_RUNTIME_INSPECTION_SCHEMA,
        executionCatalogConfigured,
        sandboxExecutorConfigured,
        trustedReceiptVerifierConfigured,
        durableReplayLedgerConfigured,
        durableJobStateStoreConfigured,
        readyForConfirmedExecution:
          executionCatalogConfigured &&
          sandboxExecutorConfigured &&
          trustedReceiptVerifierConfigured &&
          durableReplayLedgerConfigured &&
          durableJobStateStoreConfigured,
        assistantAnswer: false,
        terminalEligible: false,
      };
    };
  const prepareRequest = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    turnId?: string | null;
    authoritativeEvidenceArtifacts?: unknown[];
    catalogEntryId?: string | null;
    procedureId?: string | null;
    procedureSha256?: string | null;
  }): Promise<CasimirIndependentNumericalPreparedRequestV1> => {
    const catalogEntryId = input.catalogEntryId?.trim() ?? "";
    const procedureId = input.procedureId?.trim() ?? "";
    const procedureSha256 = input.procedureSha256?.trim() ?? "";
    const blocked = (
      issue: string | readonly string[],
    ): CasimirIndependentNumericalPreparedRequestV1 => ({
      schema: CASIMIR_INDEPENDENT_NUMERICAL_PREPARED_REQUEST_SCHEMA,
      ok: false,
      status: "blocked",
      preparedRequestId: null,
      catalogEntryId: catalogEntryId || null,
      requestId: null,
      requestArtifactSha256: null,
      policyArtifactSha256: null,
      sealedInputSha256: null,
      issues: [...new Set(Array.isArray(issue) ? issue : [issue])].sort(),
      nextCapability: "repair_independent_numerical_catalog",
      authority: authority(),
    });
    if (input.accountType !== "developer")
      return blocked("developer_account_required");
    if (!input.profileId?.trim()) return blocked("developer_profile_required");
    if (!catalogEntryId)
      return blocked("numerical_execution_catalog_entry_id_required");
    if (!procedureId) return blocked("numerical_procedure_id_required");
    if (!/^[a-f0-9]{64}$/.test(procedureSha256))
      return blocked("numerical_procedure_hash_required");
    const turnId = input.turnId?.trim() ?? "";
    if (!turnId) return blocked("numerical_current_turn_id_required");
    const procedureAdmission = await admitCurrentTurnProcedure({
      turnId,
      procedureId,
      procedureSha256,
      authoritativeEvidenceArtifacts: input.authoritativeEvidenceArtifacts,
    });
    if (!procedureAdmission.ok) return blocked(procedureAdmission.issue);
    if (!dependencies.resolveTrustedExecutionCatalogEntry)
      return blocked("numerical_execution_catalog_unconfigured");

    let resolved: CasimirIndependentNumericalSealedInputV1 | null;
    try {
      resolved =
        (await dependencies.resolveTrustedExecutionCatalogEntry({
          accountType: input.accountType,
          profileId: input.profileId?.trim() || null,
          catalogEntryId,
          procedureId,
          procedureSha256,
        })) ?? null;
    } catch (error) {
      if (
        isCasimirIndependentNumericalExecutionCatalogResolutionErrorV1(error)
      ) {
        return blocked(error.issueCodes);
      }
      return blocked("numerical_execution_catalog_resolution_failed");
    }
    if (!resolved)
      return blocked("numerical_execution_catalog_entry_not_found");

    let sealedInput: CasimirIndependentNumericalSealedInputV1;
    let sealedInputSha256: string;
    try {
      sealedInput = cloneCasimirIndependentNumericalSealedInputV1(resolved);
      sealedInputSha256 =
        await computeCasimirIndependentNumericalSealedInputSha256V1(
          sealedInput,
        );
    } catch {
      return blocked("numerical_execution_catalog_entry_invalid");
    }
    if (
      sealedInput.procedure.procedureId !== procedureId ||
      sealedInput.procedure.procedureSha256 !== procedureSha256
    ) {
      return blocked("numerical_procedure_binding_mismatch");
    }
    const preparedRequestId = `casimir-independent-numerical-prepared:${randomBytes(
      32,
    ).toString("base64url")}`;
    await stateStore.put<PreparedRequestRecord>(
      "prepared",
      preparedRequestId,
      {
      preparedRequestId,
      catalogEntryId,
      ownerKey: ownerKey(input.accountType, input.profileId),
      sealedInputSha256,
      sealedInput,
      },
    );
    return {
      schema: CASIMIR_INDEPENDENT_NUMERICAL_PREPARED_REQUEST_SCHEMA,
      ok: true,
      status: "prepared",
      preparedRequestId,
      catalogEntryId,
      requestId: optionalString(requestRecord(sealedInput.request).requestId),
      requestArtifactSha256: optionalString(
        requestRecord(sealedInput.request).artifactSha256,
      ),
      policyArtifactSha256: optionalString(
        requestRecord(sealedInput.policy).artifactSha256,
      ),
      sealedInputSha256,
      issues: [],
      nextCapability: "theory-independent-numerical-verifier.plan",
      authority: authority(),
    };
  };

  const plan = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    preparedRequestId?: string | null;
  }): Promise<CasimirIndependentNumericalPlanV1> => {
    const issues: string[] = [];
    if (input.accountType !== "developer")
      issues.push("developer_account_required");
    const preparedRequestId = input.preparedRequestId?.trim() ?? "";
    const prepared = await stateStore.get<PreparedRequestRecord>(
      "prepared",
      preparedRequestId,
    );
    if (
      !prepared ||
      prepared.ownerKey !== ownerKey(input.accountType, input.profileId)
    ) {
      issues.push("numerical_prepared_request_not_found");
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_PLAN_SCHEMA,
        ok: false,
        status: "blocked",
        preparedRequestId: preparedRequestId || null,
        planId: null,
        requestId: null,
        requestArtifactSha256: null,
        policyArtifactSha256: null,
        sealedInputSha256: null,
        issues: [...new Set(issues)].sort(),
        confirmationRequired: true,
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    }
    const sealedInput = prepared.sealedInput;
    const requestIssues =
      await validateCasimirIndependentNumericalVerificationRequestIntegrityV1(
        sealedInput.request,
      );
    const policyIssues =
      await validateCasimirIndependentNumericalReplayPolicyIntegrityV1(
        sealedInput.policy,
      );
    issues.push(
      ...requestIssues.map((issue) => `request:${issue}`),
      ...policyIssues.map((issue) => `policy:${issue}`),
    );
    if (requestIssues.length > 0 || policyIssues.length > 0) {
      const request = requestRecord(sealedInput.request);
      const policy = requestRecord(sealedInput.policy);
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_PLAN_SCHEMA,
        ok: false,
        status: "blocked",
        preparedRequestId,
        planId: null,
        requestId: optionalString(request.requestId),
        requestArtifactSha256: optionalString(request.artifactSha256),
        policyArtifactSha256: optionalString(policy.artifactSha256),
        sealedInputSha256: null,
        issues: [...new Set(issues)].sort(),
        confirmationRequired: true,
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    }

    const request = sealedInput.request;
    const policy = sealedInput.policy;
    issues.push(
      ...(await validateCasimirIndependentNumericalEvidenceChainV1(
        sealedInput,
      )),
    );
    for (const lane of ["primary", "independent"] as const) {
      const requested =
        lane === "primary"
          ? request.primaryImplementation
          : request.independentImplementation;
      const bound = policy.lanes[lane];
      if (bound.implementationId !== requested.implementationId)
        issues.push(`${lane}_implementation_id_mismatch`);
      if (bound.lineageId !== requested.lineageId)
        issues.push(`${lane}_lineage_id_mismatch`);
      if (bound.sourceSha256 !== requested.sourceSha256)
        issues.push(`${lane}_source_hash_mismatch`);
      if (bound.buildManifestSha256 !== requested.buildManifestSha256)
        issues.push(`${lane}_build_manifest_hash_mismatch`);
      for (const key of [
        "environmentId",
        "toolchainSha256",
        "runtimeSha256",
        "platformSha256",
      ] as const) {
        if (bound.environment[key] !== request.environments[lane][key])
          issues.push(`${lane}_environment_${key}_mismatch`);
      }
    }
    if (
      request.comparisonPolicy.minimumRefinementLevels >
      policy.execution.maximumRefinementLevels
    ) {
      issues.push("requested_refinement_levels_exceed_policy");
    }
    if (
      JSON.stringify(request.executionPolicy) !==
      JSON.stringify({
        replayCount: policy.execution.replayCount,
        networkAllowed: policy.execution.networkAllowed,
        arbitraryCommandAllowed: policy.execution.arbitraryCommandAllowed,
        outerObservedProcessRequired:
          policy.execution.outerObservedProcessRequired,
      })
    ) {
      issues.push("request_execution_policy_mismatch");
    }
    if (
      !sealedInput.executorCapability.capabilityId.trim() ||
      !/^[a-f0-9]{64}$/.test(sealedInput.executorCapability.artifactSha256)
    ) {
      issues.push("numerical_sandbox_executor_capability_invalid");
    } else if (!dependencies.resolveSandboxedExecutor) {
      issues.push("numerical_sandbox_executor_unconfigured");
    } else {
      try {
        const sandboxedExecutor = await dependencies.resolveSandboxedExecutor(
          sealedInput.executorCapability,
        );
        if (
          !sandboxedExecutor ||
          sandboxedExecutor.capabilityId !==
            sealedInput.executorCapability.capabilityId ||
          sandboxedExecutor.artifactSha256 !==
            sealedInput.executorCapability.artifactSha256 ||
          typeof sandboxedExecutor.runner !== "function"
        ) {
          issues.push("numerical_sandbox_executor_capability_mismatch");
        }
      } catch {
        issues.push("numerical_sandbox_executor_resolution_failed");
      }
    }

    const inspections = {
      harnessSource: await inspectFile(
        sealedInput.harnessSourcePath,
        "harness_source",
      ),
      harnessExecutable: await inspectFile(
        sealedInput.harnessExecutablePath,
        "harness_executable",
      ),
      primarySource: await inspectFile(
        sealedInput.primarySourcePath,
        "primary_source",
      ),
      primaryBuildManifest: await inspectFile(
        sealedInput.primaryBuildManifestPath,
        "primary_build_manifest",
      ),
      primaryExecutable: await inspectFile(
        sealedInput.primaryExecutablePath,
        "primary_executable",
      ),
      independentSource: await inspectFile(
        sealedInput.independentSourcePath,
        "independent_source",
      ),
      independentBuildManifest: await inspectFile(
        sealedInput.independentBuildManifestPath,
        "independent_build_manifest",
      ),
      independentExecutable: await inspectFile(
        sealedInput.independentExecutablePath,
        "independent_executable",
      ),
    };
    const expectedHashes: Record<keyof typeof inspections, string> = {
      harnessSource: policy.harness.sourceSha256,
      harnessExecutable: policy.harness.executableSha256,
      primarySource: policy.lanes.primary.sourceSha256,
      primaryBuildManifest: policy.lanes.primary.buildManifestSha256,
      primaryExecutable: policy.lanes.primary.executableSha256,
      independentSource: policy.lanes.independent.sourceSha256,
      independentBuildManifest: policy.lanes.independent.buildManifestSha256,
      independentExecutable: policy.lanes.independent.executableSha256,
    };
    for (const [key, inspection] of Object.entries(inspections) as Array<
      [keyof typeof inspections, (typeof inspections)[keyof typeof inspections]]
    >) {
      if ("issue" in inspection) issues.push(inspection.issue);
      else if (inspection.artifactSha256 !== expectedHashes[key])
        issues.push(`${key}_hash_mismatch`);
    }
    const uniqueIssues = [...new Set(issues)].sort();
    const normalizedPaths = Object.fromEntries(
      Object.entries(inspections).map(([key, inspection]) => [
        key,
        "absolutePath" in inspection ? inspection.absolutePath : null,
      ]),
    );
    const observedSealedInputSha256 =
      await computeCasimirIndependentNumericalSealedInputSha256V1(sealedInput);
    if (observedSealedInputSha256 !== prepared.sealedInputSha256)
      uniqueIssues.push("numerical_prepared_request_integrity_mismatch");
    const finalIssues = [...new Set(uniqueIssues)].sort();
    const sealedInputSha256 =
      finalIssues.length === 0 ? observedSealedInputSha256 : null;
    const planId =
      finalIssues.length === 0
        ? await computeCasimirSpecValueSha256V1({
            domain: "casimir-independent-numerical-verifier-plan/v1",
            owner: ownerKey(input.accountType, input.profileId),
            preparedRequestId,
            sealedInputSha256,
            requestArtifactSha256: request.artifactSha256,
            policyArtifactSha256: policy.artifactSha256,
            paths: normalizedPaths,
          })
        : null;
    if (planId && sealedInputSha256) {
      await stateStore.put<PlanRecord>("plan", planId, {
        planId,
        preparedRequestId,
        ownerKey: ownerKey(input.accountType, input.profileId),
        sealedInputSha256,
      });
    }
    return {
      schema: CASIMIR_INDEPENDENT_NUMERICAL_PLAN_SCHEMA,
      ok: finalIssues.length === 0,
      status: finalIssues.length === 0 ? "ready" : "blocked",
      preparedRequestId,
      planId,
      requestId: request.requestId,
      requestArtifactSha256: request.artifactSha256,
      policyArtifactSha256: policy.artifactSha256,
      sealedInputSha256,
      issues: finalIssues,
      confirmationRequired: true,
      nextCapability:
        finalIssues.length === 0
          ? "theory-independent-numerical-verifier.start"
          : "repair_independent_numerical_inputs",
      authority: authority(),
    };
  };

  const start = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    planId?: string | null;
    sessionId?: string | null;
    turnId?: string | null;
    approvalReceipt?: unknown;
    approvalToken?: string | null;
  }): Promise<CasimirIndependentNumericalJobReceiptV1> => {
    const requestedPlanId = input.planId?.trim() ?? "";
    const owner = ownerKey(input.accountType, input.profileId);
    const storedPlan = await stateStore.get<PlanRecord>(
      "plan",
      requestedPlanId,
    );
    if (!storedPlan || storedPlan.ownerKey !== owner)
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: requestedPlanId || null,
        jobId: null,
        requestId: null,
        issues: ["independent_numerical_plan_not_found"],
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    const prepared = await stateStore.get<PreparedRequestRecord>(
      "prepared",
      storedPlan.preparedRequestId,
    );
    if (!prepared || prepared.ownerKey !== owner)
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: requestedPlanId,
        jobId: null,
        requestId: null,
        issues: ["numerical_prepared_request_not_found"],
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    const planned = await plan({
      accountType: input.accountType,
      profileId: input.profileId,
      preparedRequestId: storedPlan.preparedRequestId,
    });
    if (!planned.ok || !planned.planId)
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: planned.planId,
        jobId: null,
        requestId: planned.requestId,
        issues: planned.issues,
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    if (
      requestedPlanId !== planned.planId ||
      planned.sealedInputSha256 !== storedPlan.sealedInputSha256
    )
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: planned.planId,
        jobId: null,
        requestId: planned.requestId,
        issues: ["independent_numerical_plan_id_mismatch"],
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    const sealedInput = prepared.sealedInput;
    const profileId = input.profileId?.trim() ?? "";
    const sessionId = input.sessionId?.trim() ?? "";
    const turnId = input.turnId?.trim() ?? "";
    if (
      input.approvalReceipt &&
      (!profileId || !sessionId || !turnId || !planned.sealedInputSha256)
    )
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: planned.planId,
        jobId: null,
        requestId: planned.requestId,
        issues: ["runtime_approval_receipt_binding_context_missing"],
        nextCapability: "repair_independent_numerical_inputs",
        authority: authority(),
      };
    const confirmation = await confirmationReceipts.consume({
      receipt: input.approvalReceipt,
      legacyApprovalToken: input.approvalToken,
      expectedBinding: {
        capabilityId: "theory-independent-numerical-verifier.start",
        planId: planned.planId,
        accountType: input.accountType,
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 ?? "",
      },
    });
    if (!confirmation.ok)
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: false,
        status:
          confirmation.status === "needs_confirmation"
            ? "needs_confirmation"
            : "blocked",
        planId: planned.planId,
        jobId: null,
        requestId: planned.requestId,
        issues: confirmation.issues,
        nextCapability:
          confirmation.status === "needs_confirmation"
            ? "request_user_confirmation"
            : "repair_independent_numerical_inputs",
        authority: authority(),
      };
    const existing = (await stateStore.list<JobRecord>("job")).find(
      (job: JobRecord) =>
        job.planId === planned.planId && job.ownerKey === owner,
    );
    if (existing)
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
        ok: true,
        status: "running",
        planId: existing.planId,
        jobId: existing.jobId,
        requestId: existing.requestId,
        issues: [],
        nextCapability: "theory-independent-numerical-verifier.read_result",
        authority: authority(),
      };
    const job: JobRecord = {
      jobId: `casimir-independent-numerical:${randomUUID()}`,
      planId: planned.planId,
      ownerKey: owner,
      requestId: sealedInput.request.requestId,
      status: "running",
      certificate: null,
      issues: [],
    };
    activeJobIds.add(job.jobId);
    await stateStore.put<JobRecord>("job", job.jobId, job);
    void (async () => {
      let tempRoot: string | null = null;
      try {
        const sandboxedExecutor = await dependencies.resolveSandboxedExecutor?.(
          sealedInput.executorCapability,
        );
        if (
          !sandboxedExecutor ||
          sandboxedExecutor.capabilityId !==
            sealedInput.executorCapability.capabilityId ||
          sandboxedExecutor.artifactSha256 !==
            sealedInput.executorCapability.artifactSha256 ||
          typeof sandboxedExecutor.runner !== "function"
        ) {
          throw new Error("numerical_sandbox_executor_capability_unavailable");
        }
        tempRoot = await fs.mkdtemp(
          path.join(os.tmpdir(), "casimir-numerical-verifier-"),
        );
        job.certificate = await replayCasimirIndependentNumericalRequestV1({
          ...cloneCasimirIndependentNumericalSealedInputV1(sealedInput),
          outputRoot: path.join(tempRoot, "sealed-replay"),
          runner: sandboxedExecutor.runner,
        });
        job.status = "completed";
      } catch (error) {
        job.status = "failed";
        job.issues = [
          error instanceof Error ? error.message : "numerical_replay_failed",
        ];
      } finally {
        if (tempRoot)
          try {
            await cleanupTempRoot(tempRoot);
          } catch {
            job.issues.push("numerical_replay_temp_cleanup_failed");
          }
        await stateStore.put<JobRecord>("job", job.jobId, job);
        activeJobIds.delete(job.jobId);
      }
    })();
    return {
      schema: CASIMIR_INDEPENDENT_NUMERICAL_JOB_RECEIPT_SCHEMA,
      ok: true,
      status: "running",
      planId: planned.planId,
      jobId: job.jobId,
      requestId: job.requestId,
      issues: [],
      nextCapability: "theory-independent-numerical-verifier.read_result",
      authority: authority(),
    };
  };

  const readResult = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    jobId?: string | null;
  }): Promise<CasimirIndependentNumericalResultV1> => {
    if (input.accountType !== "developer")
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_RESULT_SCHEMA,
        ok: false,
        status: "blocked",
        jobId: input.jobId?.trim() || null,
        planId: null,
        requestId: null,
        certificate: null,
        issues: ["developer_account_required"],
        authority: authority(),
      };
    const jobId = input.jobId?.trim() ?? "";
    const job = await stateStore.get<JobRecord>("job", jobId);
    if (!job || job.ownerKey !== ownerKey(input.accountType, input.profileId))
      return {
        schema: CASIMIR_INDEPENDENT_NUMERICAL_RESULT_SCHEMA,
        ok: false,
        status: "blocked",
        jobId: jobId || null,
        planId: null,
        requestId: null,
        certificate: null,
        issues: ["independent_numerical_job_not_found"],
        authority: authority(),
      };
    if (job.status === "running" && !activeJobIds.has(job.jobId)) {
      job.status = "failed";
      job.issues = ["numerical_job_interrupted_by_server_restart"];
      await stateStore.put<JobRecord>("job", job.jobId, job);
    }
    return {
      schema: CASIMIR_INDEPENDENT_NUMERICAL_RESULT_SCHEMA,
      ok: job.status !== "failed",
      status: job.status,
      jobId: job.jobId,
      planId: job.planId,
      requestId: job.requestId,
      certificate: job.certificate,
      issues: [...job.issues],
      authority: authority(),
    };
  };
  return {
    inspectConfiguration,
    prepareRequest,
    plan,
    start,
    readResult,
    reset: async () => {
      activeJobIds.clear();
      await stateStore.clear();
      confirmationReceipts.reset();
    },
  };
}

let defaultService = createCasimirIndependentNumericalVerifierJobService();

/**
 * Server-bootstrap installation point. This is intentionally not exposed
 * through a route or tool argument: only trusted server composition may
 * install the catalog and runtime-receipt verifier dependencies.
 */
export const installCasimirIndependentNumericalVerifierDependenciesForServerV1 =
  (
    dependencies: CasimirIndependentNumericalVerifierJobServiceDependenciesV1,
  ): void => {
    defaultService =
      createCasimirIndependentNumericalVerifierJobService(dependencies);
  };

export const prepareCasimirIndependentNumericalVerifierRequestV1 = (
  input: Parameters<typeof defaultService.prepareRequest>[0],
) => defaultService.prepareRequest(input);
export const inspectCasimirIndependentNumericalVerifierRuntimeV1 = () =>
  defaultService.inspectConfiguration();
export const planCasimirIndependentNumericalVerifierJobV1 = (
  input: Parameters<typeof defaultService.plan>[0],
) => defaultService.plan(input);
export const startCasimirIndependentNumericalVerifierJobV1 = (
  input: Parameters<typeof defaultService.start>[0],
) => defaultService.start(input);
export const readCasimirIndependentNumericalVerifierJobResultV1 = (
  input: Parameters<typeof defaultService.readResult>[0],
) => defaultService.readResult(input);
export const resetCasimirIndependentNumericalVerifierJobsForTests = (): void =>
  defaultService.reset();
