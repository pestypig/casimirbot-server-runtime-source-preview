import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HelixAccountType } from "../../../shared/helix-account-session";
import {
  validateCasimirFormalLeanReplayPolicyIntegrityV1,
  type CasimirFormalLeanReplayPolicyV1,
} from "../../../shared/contracts/casimir-formal-lean-replay-policy.v1";
import type { CasimirFormalVerificationCertificateV1 } from "../../../shared/contracts/casimir-formal-verification-certificate.v1";
import {
  validateCasimirFormalVerificationRequestIntegrityV1,
  type CasimirFormalVerificationRequestV1,
} from "../../../shared/contracts/casimir-formal-verification-request.v1";
import { computeCasimirSpecValueSha256V1 } from "../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import {
  replayCasimirFormalLeanRequestV1,
  type CasimirFormalLeanProcessRunnerV1,
} from "./casimir-formal-lean-replay";
import {
  createRuntimeToolConfirmationReceiptVerifierV1,
  type TrustedRuntimeToolConfirmationReplayLedgerV1,
  type TrustedRuntimeToolConfirmationVerifierV1,
} from "./runtime-tool-confirmation-receipt-verifier";

export const CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA =
  "casimir.theory_formal_verifier.plan.v1" as const;
export const CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA =
  "casimir.theory_formal_verifier.job_receipt.v1" as const;
export const CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA =
  "casimir.theory_formal_verifier.result.v1" as const;
export const CASIMIR_FORMAL_VERIFIER_START_CAPABILITY_ID =
  "theory-formal-verifier.start" as const;
export const CASIMIR_FORMAL_VERIFIER_READ_RESULT_CAPABILITY_ID =
  "theory-formal-verifier.read_result" as const;

export type CasimirFormalVerifierSealedInputV1 = {
  request: CasimirFormalVerificationRequestV1;
  policy: CasimirFormalLeanReplayPolicyV1;
  theoremSourcePath: string;
  importSourcePaths: Record<string, string>;
};

export type CasimirFormalVerifierPlanV1 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA;
  ok: boolean;
  status: "ready" | "blocked";
  planId: string | null;
  requestId: string | null;
  requestArtifactSha256: string | null;
  policyArtifactSha256: string | null;
  sealedInputSha256: string | null;
  issues: string[];
  confirmationRequired: true;
  nextCapability:
    | string
    | "repair_formal_verification_inputs";
  authority: CasimirFormalVerifierEvidenceAuthorityV1;
};

export type CasimirFormalVerifierJobReceiptV1 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA;
  ok: boolean;
  status: "running" | "needs_confirmation" | "blocked";
  planId: string | null;
  sealedInputSha256: string | null;
  jobId: string | null;
  requestId: string | null;
  issues: string[];
  nextCapability:
    | string
    | "request_user_confirmation"
    | "repair_formal_verification_inputs";
  authority: CasimirFormalVerifierEvidenceAuthorityV1;
};

export type CasimirFormalVerifierResultV1 = {
  schema: typeof CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA;
  ok: boolean;
  status: "running" | "completed" | "failed" | "blocked";
  jobId: string | null;
  planId: string | null;
  sealedInputSha256: string | null;
  requestId: string | null;
  certificate: CasimirFormalVerificationCertificateV1 | null;
  issues: string[];
  authority: CasimirFormalVerifierEvidenceAuthorityV1;
};

type CasimirFormalVerifierEvidenceAuthorityV1 = {
  outputRole: "evidence_for_bounded_synthesis";
  validatesSemanticIntent: false;
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

type JobRecord = {
  jobId: string;
  planId: string;
  sealedInputSha256: string;
  ownerKey: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  certificate: CasimirFormalVerificationCertificateV1 | null;
  issues: string[];
};

export type CasimirFormalVerifierJobServiceDependenciesV1 = {
  resolveLeanExecutablePath?: () => string | null;
  runner?: CasimirFormalLeanProcessRunnerV1;
  verifyTrustedRuntimeReceipt?: TrustedRuntimeToolConfirmationVerifierV1;
  confirmationReplayLedger?: TrustedRuntimeToolConfirmationReplayLedgerV1;
  runtimeApprovalCapabilityId?: string;
  readResultCapabilityId?: string;
  now?: () => number;
};

const evidenceAuthority = (): CasimirFormalVerifierEvidenceAuthorityV1 => ({
  outputRole: "evidence_for_bounded_synthesis",
  validatesSemanticIntent: false,
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

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const ownerKey = (
  accountType: HelixAccountType,
  profileId?: string | null,
): string => `${accountType}:${profileId?.trim() || "unbound"}`;

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readOptionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const cleanPathMap = (value: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value)
      .map(([moduleName, sourcePath]) => [moduleName.trim(), sourcePath.trim()])
      .sort(([left], [right]) => left.localeCompare(right)),
  );

async function inspectRegularFile(
  filePath: string,
  label: string,
): Promise<{ absolutePath: string; sha256: string } | { issue: string }> {
  if (!path.isAbsolute(filePath))
    return { issue: `${label}_path_not_absolute` };
  const absolutePath = path.resolve(filePath);
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { issue: `${label}_not_regular_file` };
    }
    const realPath = await fs.realpath(absolutePath);
    const same =
      process.platform === "win32"
        ? realPath.toLowerCase() === absolutePath.toLowerCase()
        : realPath === absolutePath;
    if (!same) return { issue: `${label}_path_alias_forbidden` };
    return { absolutePath, sha256: sha256(await fs.readFile(absolutePath)) };
  } catch {
    return { issue: `${label}_unreadable` };
  }
}

async function safelyRemoveReplayTempRoot(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTemp = path.resolve(os.tmpdir());
  const prefix = `${resolvedTemp}${path.sep}`;
  if (
    !resolvedRoot.startsWith(prefix) ||
    !path.basename(resolvedRoot).startsWith("casimir-formal-verifier-")
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

export function createCasimirFormalVerifierJobService(
  dependencies: CasimirFormalVerifierJobServiceDependenciesV1 = {},
) {
  if (dependencies.runner && process.env.NODE_ENV !== "test") {
    throw new Error("formal_verifier_test_runner_forbidden");
  }
  const jobs = new Map<string, JobRecord>();
  const runtimeApprovalCapabilityId =
    dependencies.runtimeApprovalCapabilityId?.trim() ||
    CASIMIR_FORMAL_VERIFIER_START_CAPABILITY_ID;
  const readResultCapabilityId =
    dependencies.readResultCapabilityId?.trim() ||
    CASIMIR_FORMAL_VERIFIER_READ_RESULT_CAPABILITY_ID;
  const confirmationReceipts = createRuntimeToolConfirmationReceiptVerifierV1({
    verifyTrustedRuntimeReceipt: dependencies.verifyTrustedRuntimeReceipt,
    replayLedger: dependencies.confirmationReplayLedger,
    requireDurableReplayProtection: Boolean(
      dependencies.verifyTrustedRuntimeReceipt,
    ),
    now: dependencies.now,
  });

  const resolveLeanExecutablePath = (): string | null =>
    dependencies.resolveLeanExecutablePath?.() ??
    process.env.CASIMIR_FORMAL_LEAN_EXECUTABLE?.trim() ??
    null;

  const plan = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    sealedInput: CasimirFormalVerifierSealedInputV1;
  }): Promise<CasimirFormalVerifierPlanV1> => {
    const issues: string[] = [];
    if (input.accountType !== "developer") {
      issues.push("developer_account_required");
    }
    const requestIssues =
      await validateCasimirFormalVerificationRequestIntegrityV1(
        input.sealedInput.request,
      );
    const policyIssues = await validateCasimirFormalLeanReplayPolicyIntegrityV1(
      input.sealedInput.policy,
    );
    issues.push(
      ...requestIssues.map((issue) => `request:${issue}`),
      ...policyIssues.map((issue) => `policy:${issue}`),
    );
    if (requestIssues.length > 0 || policyIssues.length > 0) {
      const requestRecord = readRecord(input.sealedInput.request);
      const policyRecord = readRecord(input.sealedInput.policy);
      return {
        schema: CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA,
        ok: false,
        status: "blocked",
        planId: null,
        requestId: readOptionalString(requestRecord.requestId),
        requestArtifactSha256: readOptionalString(requestRecord.artifactSha256),
        policyArtifactSha256: readOptionalString(policyRecord.artifactSha256),
        sealedInputSha256: null,
        issues: [...new Set(issues)].sort(),
        confirmationRequired: true,
        nextCapability: "repair_formal_verification_inputs",
        authority: evidenceAuthority(),
      };
    }

    const leanExecutablePath = resolveLeanExecutablePath();
    if (!leanExecutablePath) issues.push("lean_executable_not_configured");
    const executableInspection = leanExecutablePath
      ? await inspectRegularFile(leanExecutablePath, "lean_executable")
      : null;
    if (executableInspection && "issue" in executableInspection) {
      issues.push(executableInspection.issue);
    } else if (
      executableInspection &&
      executableInspection.sha256 !==
        input.sealedInput.policy.kernelBinarySha256
    ) {
      issues.push("lean_executable_hash_mismatch");
    }

    const sourceInspection = await inspectRegularFile(
      input.sealedInput.theoremSourcePath,
      "theorem_source",
    );
    if ("issue" in sourceInspection) {
      issues.push(sourceInspection.issue);
    } else if (
      sourceInspection.sha256 !==
      input.sealedInput.request.formalArtifact.sourceSha256
    ) {
      issues.push("theorem_source_hash_mismatch");
    }

    const importSourcePaths = cleanPathMap(
      input.sealedInput.importSourcePaths ?? {},
    );
    const expectedImports = new Map(
      input.sealedInput.request.formalEnvironment.imports.map((entry) => [
        entry.module,
        entry.sourceSha256,
      ]),
    );
    const policyAllowedImports = new Set(
      input.sealedInput.policy.allowedImportModules,
    );
    for (const moduleName of expectedImports.keys()) {
      if (!policyAllowedImports.has(moduleName)) {
        issues.push(`import_module_not_allowed:${moduleName}`);
      }
    }
    if (
      JSON.stringify(Object.keys(importSourcePaths)) !==
      JSON.stringify([...expectedImports.keys()].sort())
    ) {
      issues.push("import_source_path_set_mismatch");
    }
    for (const [moduleName, importPath] of Object.entries(importSourcePaths)) {
      const inspection = await inspectRegularFile(
        importPath,
        `import_source:${moduleName}`,
      );
      if ("issue" in inspection) {
        issues.push(inspection.issue);
      } else if (inspection.sha256 !== expectedImports.get(moduleName)) {
        issues.push(`import_source_hash_mismatch:${moduleName}`);
      }
    }

    if (
      input.sealedInput.request.formalEnvironment.toolchainPolicyId !==
      input.sealedInput.policy.policyId
    ) {
      issues.push("toolchain_policy_id_mismatch");
    }
    if (
      input.sealedInput.request.formalEnvironment.toolchainPolicySha256 !==
      input.sealedInput.policy.artifactSha256
    ) {
      issues.push("toolchain_policy_hash_mismatch");
    }

    const uniqueIssues = [...new Set(issues)].sort();
    const sealedInputSha256 =
      uniqueIssues.length === 0
        ? await computeCasimirSpecValueSha256V1({
            domain: "casimir-theory-formal-verifier-sealed-input/v1",
            request: input.sealedInput.request,
            policy: input.sealedInput.policy,
            theoremSourcePath:
              "absolutePath" in sourceInspection
                ? sourceInspection.absolutePath
                : path.resolve(input.sealedInput.theoremSourcePath),
            importSourcePaths,
            leanExecutablePath:
              executableInspection && !("issue" in executableInspection)
                ? executableInspection.absolutePath
                : null,
          })
        : null;
    const planId =
      uniqueIssues.length === 0
        ? await computeCasimirSpecValueSha256V1({
            domain: "casimir-theory-formal-verifier-plan/v1",
            owner: ownerKey(input.accountType, input.profileId),
            requestArtifactSha256: input.sealedInput.request.artifactSha256,
            policyArtifactSha256: input.sealedInput.policy.artifactSha256,
            theoremSourcePath: path.resolve(
              input.sealedInput.theoremSourcePath,
            ),
            importSourcePaths,
            leanExecutablePath:
              executableInspection && !("issue" in executableInspection)
                ? executableInspection.absolutePath
                : null,
          })
        : null;
    return {
      schema: CASIMIR_FORMAL_VERIFIER_PLAN_SCHEMA,
      ok: uniqueIssues.length === 0,
      status: uniqueIssues.length === 0 ? "ready" : "blocked",
      planId,
      requestId: input.sealedInput.request?.requestId ?? null,
      requestArtifactSha256: input.sealedInput.request?.artifactSha256 ?? null,
      policyArtifactSha256: input.sealedInput.policy?.artifactSha256 ?? null,
      sealedInputSha256,
      issues: uniqueIssues,
      confirmationRequired: true,
      nextCapability:
        uniqueIssues.length === 0
          ? runtimeApprovalCapabilityId
          : "repair_formal_verification_inputs",
      authority: evidenceAuthority(),
    };
  };

  const start = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    sealedInput: CasimirFormalVerifierSealedInputV1;
    planId?: string | null;
    sessionId?: string | null;
    turnId?: string | null;
    approvalReceipt?: unknown;
    approvalToken?: string | null;
  }): Promise<CasimirFormalVerifierJobReceiptV1> => {
    const planned = await plan(input);
    if (!planned.ok || !planned.planId) {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: planned.planId,
        sealedInputSha256: planned.sealedInputSha256,
        jobId: null,
        requestId: planned.requestId,
        issues: planned.issues,
        nextCapability: "repair_formal_verification_inputs",
        authority: evidenceAuthority(),
      };
    }
    if (input.planId?.trim() !== planned.planId) {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: planned.planId,
        sealedInputSha256: planned.sealedInputSha256,
        jobId: null,
        requestId: planned.requestId,
        issues: ["formal_verifier_plan_id_mismatch"],
        nextCapability: "repair_formal_verification_inputs",
        authority: evidenceAuthority(),
      };
    }
    const profileId = input.profileId?.trim() ?? "";
    const sessionId = input.sessionId?.trim() ?? "";
    const turnId = input.turnId?.trim() ?? "";
    if (
      input.approvalReceipt &&
      (!profileId || !sessionId || !turnId || !planned.sealedInputSha256)
    ) {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: planned.planId,
        sealedInputSha256: planned.sealedInputSha256,
        jobId: null,
        requestId: planned.requestId,
        issues: ["runtime_approval_receipt_binding_context_missing"],
        nextCapability: "repair_formal_verification_inputs",
        authority: evidenceAuthority(),
      };
    }
    const confirmation = await confirmationReceipts.consume({
      receipt: input.approvalReceipt,
      legacyApprovalToken: input.approvalToken,
      expectedBinding: {
        capabilityId: runtimeApprovalCapabilityId,
        planId: planned.planId,
        accountType: input.accountType,
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 ?? "",
      },
    });
    if (!confirmation.ok) {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA,
        ok: false,
        status:
          confirmation.status === "needs_confirmation"
            ? "needs_confirmation"
            : "blocked",
        planId: planned.planId,
        sealedInputSha256: planned.sealedInputSha256,
        jobId: null,
        requestId: planned.requestId,
        issues: confirmation.issues,
        nextCapability:
          confirmation.status === "needs_confirmation"
            ? "request_user_confirmation"
            : "repair_formal_verification_inputs",
        authority: evidenceAuthority(),
      };
    }

    const existing = [...jobs.values()].find(
      (job) =>
        job.planId === planned.planId &&
        job.ownerKey === ownerKey(input.accountType, input.profileId),
    );
    if (existing) {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA,
        ok: true,
        status: "running",
        planId: existing.planId,
        sealedInputSha256: existing.sealedInputSha256,
        jobId: existing.jobId,
        requestId: existing.requestId,
        issues: [],
        nextCapability: readResultCapabilityId,
        authority: evidenceAuthority(),
      };
    }

    const job: JobRecord = {
      jobId: `casimir-formal-verifier:${randomUUID()}`,
      planId: planned.planId,
      sealedInputSha256: planned.sealedInputSha256 as string,
      ownerKey: ownerKey(input.accountType, input.profileId),
      requestId: input.sealedInput.request.requestId,
      status: "running",
      certificate: null,
      issues: [],
    };
    jobs.set(job.jobId, job);
    const leanExecutablePath = resolveLeanExecutablePath();
    void (async () => {
      let tempRoot: string | null = null;
      try {
        if (!leanExecutablePath)
          throw new Error("lean_executable_not_configured");
        tempRoot = await fs.mkdtemp(
          path.join(os.tmpdir(), "casimir-formal-verifier-"),
        );
        job.certificate = await replayCasimirFormalLeanRequestV1({
          request: input.sealedInput.request,
          policy: input.sealedInput.policy,
          leanExecutablePath,
          theoremSourcePath: input.sealedInput.theoremSourcePath,
          importSourcePaths: cleanPathMap(
            input.sealedInput.importSourcePaths ?? {},
          ),
          outputRoot: path.join(tempRoot, "sealed-replay"),
          ...(dependencies.runner ? { runner: dependencies.runner } : {}),
        });
        job.status = "completed";
      } catch (error) {
        job.status = "failed";
        job.issues = [
          error instanceof Error ? error.message : "formal_replay_failed",
        ];
      } finally {
        if (tempRoot) {
          try {
            await safelyRemoveReplayTempRoot(tempRoot);
          } catch {
            job.issues.push("formal_replay_temp_cleanup_failed");
          }
        }
      }
    })();

    return {
      schema: CASIMIR_FORMAL_VERIFIER_JOB_RECEIPT_SCHEMA,
      ok: true,
      status: "running",
      planId: planned.planId,
      sealedInputSha256: job.sealedInputSha256,
      jobId: job.jobId,
      requestId: job.requestId,
      issues: [],
      nextCapability: readResultCapabilityId,
      authority: evidenceAuthority(),
    };
  };

  const readResult = (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    jobId?: string | null;
  }): CasimirFormalVerifierResultV1 => {
    if (input.accountType !== "developer") {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA,
        ok: false,
        status: "blocked",
        jobId: input.jobId?.trim() || null,
        planId: null,
        sealedInputSha256: null,
        requestId: null,
        certificate: null,
        issues: ["developer_account_required"],
        authority: evidenceAuthority(),
      };
    }
    const jobId = input.jobId?.trim() ?? "";
    const job = jobs.get(jobId);
    if (!job || job.ownerKey !== ownerKey(input.accountType, input.profileId)) {
      return {
        schema: CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA,
        ok: false,
        status: "blocked",
        jobId: jobId || null,
        planId: null,
        sealedInputSha256: null,
        requestId: null,
        certificate: null,
        issues: ["formal_verifier_job_not_found"],
        authority: evidenceAuthority(),
      };
    }
    return {
      schema: CASIMIR_FORMAL_VERIFIER_RESULT_SCHEMA,
      ok: job.status !== "failed",
      status: job.status,
      jobId: job.jobId,
      planId: job.planId,
      sealedInputSha256: job.sealedInputSha256,
      requestId: job.requestId,
      certificate: job.certificate,
      issues: [...job.issues],
      authority: evidenceAuthority(),
    };
  };

  const reset = (): void => {
    jobs.clear();
    confirmationReceipts.reset();
  };

  return { plan, start, readResult, reset };
}

let defaultFormalVerifierJobService = createCasimirFormalVerifierJobService();

/**
 * Trusted server-bootstrap installation point. This is intentionally not
 * exposed through any route or tool argument: only server composition may
 * supply the Lean resolver, process runner, or confirmation-receipt verifier.
 */
export const installCasimirFormalVerifierDependenciesForServerV1 = (
  dependencies: CasimirFormalVerifierJobServiceDependenciesV1,
): void => {
  defaultFormalVerifierJobService =
    createCasimirFormalVerifierJobService(dependencies);
};

export const planCasimirFormalVerifierJobV1 = (
  input: Parameters<typeof defaultFormalVerifierJobService.plan>[0],
) => defaultFormalVerifierJobService.plan(input);
export const startCasimirFormalVerifierJobV1 = (
  input: Parameters<typeof defaultFormalVerifierJobService.start>[0],
) => defaultFormalVerifierJobService.start(input);
export const readCasimirFormalVerifierJobResultV1 = (
  input: Parameters<typeof defaultFormalVerifierJobService.readResult>[0],
) => defaultFormalVerifierJobService.readResult(input);
export const resetCasimirFormalVerifierJobsForTests = (): void =>
  defaultFormalVerifierJobService.reset();
