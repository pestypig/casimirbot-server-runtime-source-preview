import { createHash } from "node:crypto";

import type { HelixAccountType } from "../../../shared/helix-account-session";
import { buildCasimirFormalVerificationRequestV1 } from "../../../shared/contracts/casimir-formal-verification-request.v1";
import {
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_ARTIFACT_ID,
  resolveCasimirFormalRuntimeSelfTestCatalogEntryV1,
  type CasimirFormalRuntimeSelfTestCatalogEntryV1,
} from "./casimir-formal-environment-policy-catalog";
import {
  createCasimirFormalVerifierJobService,
  type CasimirFormalVerifierSealedInputV1,
} from "./casimir-formal-verifier-job-service";
import type { CasimirFormalLeanProcessRunnerV1 } from "./casimir-formal-lean-replay";
import type {
  TrustedRuntimeToolConfirmationReplayLedgerV1,
  TrustedRuntimeToolConfirmationVerifierV1,
} from "./runtime-tool-confirmation-receipt-verifier";

export const THEORY_RUNTIME_CANARY_INSPECT_CAPABILITY =
  "theory-runtime-canary.inspect" as const;
export const THEORY_RUNTIME_CANARY_PLAN_CAPABILITY =
  "theory-runtime-canary.plan" as const;
export const THEORY_RUNTIME_CANARY_START_CAPABILITY =
  "theory-runtime-canary.start" as const;
export const THEORY_RUNTIME_CANARY_READ_RESULT_CAPABILITY =
  "theory-runtime-canary.read_result" as const;

export const CASIMIR_FORMAL_RUNTIME_CANARY_INSPECTION_SCHEMA =
  "casimir.formal_runtime_canary.inspection.v1" as const;
export const CASIMIR_FORMAL_RUNTIME_CANARY_PLAN_SCHEMA =
  "casimir.formal_runtime_canary.plan.v1" as const;
export const CASIMIR_FORMAL_RUNTIME_CANARY_JOB_RECEIPT_SCHEMA =
  "casimir.formal_runtime_canary.job_receipt.v1" as const;
export const CASIMIR_FORMAL_RUNTIME_CANARY_RESULT_SCHEMA =
  "casimir.formal_runtime_canary.result.v1" as const;
export const CASIMIR_FORMAL_RUNTIME_CANARY_REPLAY_REPORT_SCHEMA =
  "casimir.formal_runtime_canary.replay_report.v1" as const;

export type CasimirFormalRuntimeCanaryAuthorityV1 = {
  outputRole: "non_scientific_runtime_readiness_evidence";
  nonScientificRuntimeSelfTest: true;
  semanticBindingRegistered: false;
  theoremTypeIdentityRegistered: false;
  theoryGraphBindingRegistered: false;
  theoryExperimentFormalClosureEligible: false;
  validatesScientificClaim: false;
  validatesPhysicalTruth: false;
  validatesNumericalImplementation: false;
  certificatePromotionAllowed: false;
  assistantAnswer: false;
  terminalEligible: false;
  postToolModelStepRequired: true;
};

type RuntimeSelfTestIdentityV1 = {
  formalArtifactId: typeof CASIMIR_FORMAL_RUNTIME_SELF_TEST_ARTIFACT_ID;
  theoremName: string;
  theoremModule: string;
  sourceRepoPath: string;
  sourceSha256: string;
  environmentPolicyId: string;
  environmentLockSha256: string;
  leanKernelBinarySha256: string;
  importCount: 0;
};

export type CasimirFormalRuntimeCanaryInspectionV1 = {
  schema: typeof CASIMIR_FORMAL_RUNTIME_CANARY_INSPECTION_SCHEMA;
  ok: boolean;
  status: "ready" | "blocked";
  issues: string[];
  dependencies: {
    runtimeApprovalHostConfigured: boolean;
    repositoryRootConfigured: boolean;
    leanExecutableConfigured: boolean;
    trustedReceiptVerifierConfigured: boolean;
    durableReplayLedgerConfigured: boolean;
  };
  selfTest: RuntimeSelfTestIdentityV1 | null;
  nextCapability:
    | typeof THEORY_RUNTIME_CANARY_PLAN_CAPABILITY
    | "configure_formal_runtime_canary_dependencies";
  authority: CasimirFormalRuntimeCanaryAuthorityV1;
};

export type CasimirFormalRuntimeCanaryPlanV1 = {
  schema: typeof CASIMIR_FORMAL_RUNTIME_CANARY_PLAN_SCHEMA;
  ok: boolean;
  status: "ready" | "blocked";
  planId: string | null;
  sealedInputSha256: string | null;
  issues: string[];
  confirmationRequired: true;
  selfTest: RuntimeSelfTestIdentityV1 | null;
  nextCapability:
    | typeof THEORY_RUNTIME_CANARY_START_CAPABILITY
    | "configure_formal_runtime_canary_dependencies";
  authority: CasimirFormalRuntimeCanaryAuthorityV1;
};

export type CasimirFormalRuntimeCanaryJobReceiptV1 = {
  schema: typeof CASIMIR_FORMAL_RUNTIME_CANARY_JOB_RECEIPT_SCHEMA;
  ok: boolean;
  status: "running" | "needs_confirmation" | "blocked";
  planId: string | null;
  sealedInputSha256: string | null;
  jobId: string | null;
  issues: string[];
  nextCapability:
    | typeof THEORY_RUNTIME_CANARY_READ_RESULT_CAPABILITY
    | "request_user_confirmation"
    | "configure_formal_runtime_canary_dependencies";
  authority: CasimirFormalRuntimeCanaryAuthorityV1;
};

export type CasimirFormalRuntimeCanaryResultV1 = {
  schema: typeof CASIMIR_FORMAL_RUNTIME_CANARY_RESULT_SCHEMA;
  ok: boolean;
  status: "running" | "completed" | "failed" | "blocked";
  planId: string | null;
  sealedInputSha256: string | null;
  jobId: string | null;
  issues: string[];
  runtimeReplayReport: {
    schema: typeof CASIMIR_FORMAL_RUNTIME_CANARY_REPLAY_REPORT_SCHEMA;
    status: "passed" | "failed" | "blocked";
    certificateArtifactSha256: string;
    aggregateTranscriptSha256: string;
    requiredReplayCount: number;
    completedReplayCount: number;
    byteIdentical: boolean;
    blockerCodes: string[];
  } | null;
  selfTest: RuntimeSelfTestIdentityV1 | null;
  authority: CasimirFormalRuntimeCanaryAuthorityV1;
};

export type CasimirFormalRuntimeCanaryDependenciesV1 = {
  resolveRepositoryRoot?: () => string | null;
  resolveLeanExecutablePath?: () => string | null;
  isRuntimeApprovalHostConfigured?: () => boolean;
  verifyTrustedRuntimeReceipt?: TrustedRuntimeToolConfirmationVerifierV1;
  confirmationReplayLedger?: TrustedRuntimeToolConfirmationReplayLedgerV1;
  runner?: CasimirFormalLeanProcessRunnerV1;
  now?: () => number;
};

const SELF_TEST_ONLY_STATEMENT_SHA256 = createHash("sha256")
  .update(
    "Casimir non-scientific Lean runtime self-test label; no semantic claim binding",
  )
  .digest("hex");

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const uniqueIssues = (issues: string[]): string[] => [...new Set(issues)];

const authority = (): CasimirFormalRuntimeCanaryAuthorityV1 => ({
  outputRole: "non_scientific_runtime_readiness_evidence",
  nonScientificRuntimeSelfTest: true,
  semanticBindingRegistered: false,
  theoremTypeIdentityRegistered: false,
  theoryGraphBindingRegistered: false,
  theoryExperimentFormalClosureEligible: false,
  validatesScientificClaim: false,
  validatesPhysicalTruth: false,
  validatesNumericalImplementation: false,
  certificatePromotionAllowed: false,
  assistantAnswer: false,
  terminalEligible: false,
  postToolModelStepRequired: true,
});

const selfTestIdentity = (
  entry: CasimirFormalRuntimeSelfTestCatalogEntryV1,
): RuntimeSelfTestIdentityV1 => ({
  formalArtifactId: entry.formalArtifactId,
  theoremName: entry.theorem.theoremName,
  theoremModule: entry.theorem.theoremModule,
  sourceRepoPath: entry.theorem.sourceRepoPath,
  sourceSha256: entry.theorem.sourceSha256,
  environmentPolicyId: entry.environmentPolicyId,
  environmentLockSha256: entry.environmentLockSha256,
  leanKernelBinarySha256:
    entry.environment.toolchainIdentity.kernelBinarySha256,
  importCount: 0,
});

async function buildRuntimeSelfTestSealedInput(
  selfTest: CasimirFormalRuntimeSelfTestCatalogEntryV1,
): Promise<CasimirFormalVerifierSealedInputV1> {
  const environment = selfTest.environment;
  const request = await buildCasimirFormalVerificationRequestV1({
    generatedAt: "2026-07-26T00:00:00.000Z",
    requestId: "formal-runtime-canary:self-test-only",
    casimirSpec: {
      specId: "runtime-self-test-only:no-scientific-spec",
      schemaVersion: "casimir_spec_scientific_claim_ir/v1",
      semanticSha256: sha256("runtime-self-test-only:semantic-placeholder"),
      artifactSha256: sha256("runtime-self-test-only:artifact-placeholder"),
    },
    claim: {
      claimId: "runtime-self-test-only:not-a-scientific-claim",
      propositionSha256: SELF_TEST_ONLY_STATEMENT_SHA256,
    },
    formalArtifact: {
      theoremName: selfTest.theorem.theoremName,
      theoremModule: selfTest.theorem.theoremModule,
      statementSha256: SELF_TEST_ONLY_STATEMENT_SHA256,
      sourceSha256: selfTest.theorem.sourceSha256,
      emitterId: "casimir.runtime-self-test-only",
      emitterRevisionSha256: selfTest.theorem.sourceSha256,
    },
    masterProblem: {
      schemaVersion: "theory_master_problem/v1",
      planId: "runtime-self-test-only:no-master-problem",
      artifactSha256: sha256("runtime-self-test-only:no-master-problem"),
    },
    derivationProgram: {
      schemaVersion: "theory_derivation_program/v1",
      programId: "runtime-self-test-only:no-derivation-program",
      sourceMasterProblemPlanId: "runtime-self-test-only:no-master-problem",
      artifactSha256: sha256("runtime-self-test-only:no-derivation-program"),
    },
    theoryGraph: {
      graphId: "runtime-self-test-only:no-theory-graph",
      snapshotSha256: sha256("runtime-self-test-only:no-theory-graph"),
    },
    catalogSnapshots: [
      {
        catalogId: "casimir.formal.runtime-self-test-environment/v1",
        snapshotSha256: selfTest.environmentLockSha256,
      },
    ],
    formalEnvironment: {
      prover: "lean4",
      toolchainPolicyId: environment.policyId,
      toolchainPolicySha256: environment.policyArtifactSha256,
      pinnedVersion: environment.policy.pinnedVersion,
      imports: [],
      declaredAxiomIds: [],
      allowedAxiomIds: [],
    },
    executionPolicy: {
      replayCount: 2,
      timeoutMs: environment.policy.resourceCeilings.timeoutMs,
      maxMemoryBytes: environment.policy.resourceCeilings.maxMemoryBytes,
      maxOutputBytes: environment.policy.resourceCeilings.maxOutputBytes,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  return {
    request,
    policy: environment.policy,
    theoremSourcePath: selfTest.theorem.absoluteSourcePath,
    importSourcePaths: {},
  };
}

type ReadinessResolution = {
  issues: string[];
  dependencies: CasimirFormalRuntimeCanaryInspectionV1["dependencies"];
  selfTest: CasimirFormalRuntimeSelfTestCatalogEntryV1 | null;
  sealedInput: CasimirFormalVerifierSealedInputV1 | null;
};

const readDependency = <T>(
  resolver: (() => T) | undefined,
): T | null => {
  if (!resolver) return null;
  try {
    return resolver();
  } catch {
    return null;
  }
};

export function createCasimirFormalRuntimeCanaryService(
  dependencies: CasimirFormalRuntimeCanaryDependenciesV1 = {},
) {
  const verifier = createCasimirFormalVerifierJobService({
    resolveLeanExecutablePath: dependencies.resolveLeanExecutablePath,
    verifyTrustedRuntimeReceipt: dependencies.verifyTrustedRuntimeReceipt,
    confirmationReplayLedger: dependencies.confirmationReplayLedger,
    runner: dependencies.runner,
    runtimeApprovalCapabilityId: THEORY_RUNTIME_CANARY_START_CAPABILITY,
    readResultCapabilityId: THEORY_RUNTIME_CANARY_READ_RESULT_CAPABILITY,
    now: dependencies.now,
  });
  const acceptedJobs = new Map<
    string,
    {
      selfTest: RuntimeSelfTestIdentityV1;
      sealedInputSha256: string;
    }
  >();

  const resolveReadiness = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
  }): Promise<ReadinessResolution> => {
    const issues: string[] = [];
    if (input.accountType !== "developer") {
      issues.push("developer_account_required");
    }
    if (!input.profileId?.trim()) {
      issues.push("developer_profile_id_required");
    }

    const runtimeApprovalHostConfigured =
      readDependency(dependencies.isRuntimeApprovalHostConfigured) === true;
    const repositoryRoot = readDependency(dependencies.resolveRepositoryRoot);
    const leanExecutablePath = readDependency(
      dependencies.resolveLeanExecutablePath,
    );
    const repositoryRootConfigured =
      typeof repositoryRoot === "string" && Boolean(repositoryRoot.trim());
    const leanExecutableConfigured =
      typeof leanExecutablePath === "string" &&
      Boolean(leanExecutablePath.trim());
    const trustedReceiptVerifierConfigured =
      typeof dependencies.verifyTrustedRuntimeReceipt === "function";
    const durableReplayLedgerConfigured = Boolean(
      dependencies.confirmationReplayLedger,
    );

    if (!runtimeApprovalHostConfigured) {
      issues.push("runtime_approval_host_unconfigured");
    }
    if (!repositoryRootConfigured) {
      issues.push("formal_runtime_canary_repository_root_unconfigured");
    }
    if (!leanExecutableConfigured) {
      issues.push("lean_executable_not_configured");
    }
    if (!trustedReceiptVerifierConfigured) {
      issues.push("runtime_approval_receipt_issuer_unconfigured");
    }
    if (!durableReplayLedgerConfigured) {
      issues.push("runtime_approval_receipt_replay_ledger_unconfigured");
    }

    let selfTest: CasimirFormalRuntimeSelfTestCatalogEntryV1 | null = null;
    let sealedInput: CasimirFormalVerifierSealedInputV1 | null = null;
    if (repositoryRootConfigured && leanExecutableConfigured) {
      try {
        selfTest =
          await resolveCasimirFormalRuntimeSelfTestCatalogEntryV1({
            repositoryRoot: repositoryRoot as string,
            leanExecutablePath: leanExecutablePath as string,
          });
        sealedInput = await buildRuntimeSelfTestSealedInput(selfTest);
      } catch (error) {
        issues.push(
          error instanceof Error
            ? error.message
            : "formal_runtime_canary_self_test_resolution_failed",
        );
      }
    }

    return {
      issues: uniqueIssues(issues),
      dependencies: {
        runtimeApprovalHostConfigured,
        repositoryRootConfigured,
        leanExecutableConfigured,
        trustedReceiptVerifierConfigured,
        durableReplayLedgerConfigured,
      },
      selfTest,
      sealedInput,
    };
  };

  const inspect = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
  }): Promise<CasimirFormalRuntimeCanaryInspectionV1> => {
    const resolved = await resolveReadiness(input);
    const ready =
      resolved.issues.length === 0 &&
      Boolean(resolved.selfTest && resolved.sealedInput);
    return {
      schema: CASIMIR_FORMAL_RUNTIME_CANARY_INSPECTION_SCHEMA,
      ok: ready,
      status: ready ? "ready" : "blocked",
      issues: resolved.issues,
      dependencies: resolved.dependencies,
      selfTest: resolved.selfTest
        ? selfTestIdentity(resolved.selfTest)
        : null,
      nextCapability: ready
        ? THEORY_RUNTIME_CANARY_PLAN_CAPABILITY
        : "configure_formal_runtime_canary_dependencies",
      authority: authority(),
    };
  };

  const plan = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
  }): Promise<CasimirFormalRuntimeCanaryPlanV1> => {
    const resolved = await resolveReadiness(input);
    if (
      resolved.issues.length > 0 ||
      !resolved.selfTest ||
      !resolved.sealedInput
    ) {
      return {
        schema: CASIMIR_FORMAL_RUNTIME_CANARY_PLAN_SCHEMA,
        ok: false,
        status: "blocked",
        planId: null,
        sealedInputSha256: null,
        issues: resolved.issues,
        confirmationRequired: true,
        selfTest: resolved.selfTest
          ? selfTestIdentity(resolved.selfTest)
          : null,
        nextCapability: "configure_formal_runtime_canary_dependencies",
        authority: authority(),
      };
    }
    const planned = await verifier.plan({
      accountType: input.accountType,
      profileId: input.profileId,
      sealedInput: resolved.sealedInput,
    });
    return {
      schema: CASIMIR_FORMAL_RUNTIME_CANARY_PLAN_SCHEMA,
      ok: planned.ok,
      status: planned.ok ? "ready" : "blocked",
      planId: planned.planId,
      sealedInputSha256: planned.sealedInputSha256,
      issues: planned.issues,
      confirmationRequired: true,
      selfTest: selfTestIdentity(resolved.selfTest),
      nextCapability: planned.ok
        ? THEORY_RUNTIME_CANARY_START_CAPABILITY
        : "configure_formal_runtime_canary_dependencies",
      authority: authority(),
    };
  };

  const start = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    sessionId?: string | null;
    turnId?: string | null;
    planId?: string | null;
    approvalReceipt?: unknown;
    approvalToken?: string | null;
  }): Promise<CasimirFormalRuntimeCanaryJobReceiptV1> => {
    const resolved = await resolveReadiness(input);
    if (
      resolved.issues.length > 0 ||
      !resolved.selfTest ||
      !resolved.sealedInput
    ) {
      return {
        schema: CASIMIR_FORMAL_RUNTIME_CANARY_JOB_RECEIPT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: input.planId?.trim() || null,
        sealedInputSha256: null,
        jobId: null,
        issues: resolved.issues,
        nextCapability: "configure_formal_runtime_canary_dependencies",
        authority: authority(),
      };
    }
    const started = await verifier.start({
      accountType: input.accountType,
      profileId: input.profileId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      planId: input.planId,
      sealedInput: resolved.sealedInput,
      approvalReceipt: input.approvalReceipt,
      approvalToken: input.approvalToken,
    });
    if (
      started.status === "running" &&
      started.jobId &&
      started.sealedInputSha256
    ) {
      acceptedJobs.set(started.jobId, {
        selfTest: selfTestIdentity(resolved.selfTest),
        sealedInputSha256: started.sealedInputSha256,
      });
    }
    return {
      schema: CASIMIR_FORMAL_RUNTIME_CANARY_JOB_RECEIPT_SCHEMA,
      ok: started.ok,
      status: started.status,
      planId: started.planId,
      sealedInputSha256: started.sealedInputSha256,
      jobId: started.jobId,
      issues: started.issues,
      nextCapability:
        started.status === "running"
          ? THEORY_RUNTIME_CANARY_READ_RESULT_CAPABILITY
          : started.status === "needs_confirmation"
            ? "request_user_confirmation"
            : "configure_formal_runtime_canary_dependencies",
      authority: authority(),
    };
  };

  const readResult = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    jobId?: string | null;
  }): Promise<CasimirFormalRuntimeCanaryResultV1> => {
    const jobId = input.jobId?.trim() || "";
    const acceptedJob = acceptedJobs.get(jobId);
    if (input.accountType !== "developer") {
      return {
        schema: CASIMIR_FORMAL_RUNTIME_CANARY_RESULT_SCHEMA,
        ok: false,
        status: "blocked",
        planId: null,
        sealedInputSha256: null,
        jobId: jobId || null,
        issues: ["developer_account_required"],
        runtimeReplayReport: null,
        selfTest: null,
        authority: authority(),
      };
    }
    const result = verifier.readResult({
      accountType: input.accountType,
      profileId: input.profileId,
      jobId,
    });
    const certificate = result.certificate;
    const replayPassed =
      result.status === "completed" &&
      certificate?.status === "passed" &&
      certificate.blockers.length === 0;
    const completedWithFailedCertificate =
      result.status === "completed" && certificate !== null && !replayPassed;
    const status = completedWithFailedCertificate
      ? "failed"
      : result.status;
    const certificateIssues = completedWithFailedCertificate
      ? [
          "formal_runtime_canary_replay_failed",
          ...certificate.blockers.map((blocker) => blocker.code),
        ]
      : [];
    const runtimeReplayReport = certificate
      ? {
          schema: CASIMIR_FORMAL_RUNTIME_CANARY_REPLAY_REPORT_SCHEMA,
          status: certificate.status,
          certificateArtifactSha256: certificate.artifactSha256,
          aggregateTranscriptSha256:
            certificate.replay.aggregateTranscriptSha256,
          requiredReplayCount: certificate.replay.requiredReplayCount,
          completedReplayCount: certificate.replay.completedReplayCount,
          byteIdentical: certificate.replay.byteIdentical,
          blockerCodes: certificate.blockers.map((blocker) => blocker.code),
        }
      : null;
    return {
      schema: CASIMIR_FORMAL_RUNTIME_CANARY_RESULT_SCHEMA,
      ok: result.ok && !completedWithFailedCertificate,
      status,
      planId: result.planId,
      sealedInputSha256:
        result.sealedInputSha256 ??
        acceptedJob?.sealedInputSha256 ??
        null,
      jobId: result.jobId,
      issues: uniqueIssues([...result.issues, ...certificateIssues]),
      runtimeReplayReport,
      selfTest: acceptedJob?.selfTest ?? null,
      authority: authority(),
    };
  };

  const reset = (): void => {
    acceptedJobs.clear();
    verifier.reset();
  };

  return { inspect, plan, start, readResult, reset };
}

let defaultFormalRuntimeCanaryService =
  createCasimirFormalRuntimeCanaryService();

/**
 * Trusted server-composition seam only. It accepts resolvers, a receipt
 * verifier, and an atomic replay ledger, but never a signer or approval
 * decision. With no installation the production singleton remains blocked.
 */
export const installCasimirFormalRuntimeCanaryDependenciesForServerV1 = (
  dependencies: CasimirFormalRuntimeCanaryDependenciesV1,
): void => {
  defaultFormalRuntimeCanaryService =
    createCasimirFormalRuntimeCanaryService(dependencies);
};

export const inspectCasimirFormalRuntimeCanaryV1 = (
  input: Parameters<typeof defaultFormalRuntimeCanaryService.inspect>[0],
) => defaultFormalRuntimeCanaryService.inspect(input);

export const planCasimirFormalRuntimeCanaryV1 = (
  input: Parameters<typeof defaultFormalRuntimeCanaryService.plan>[0],
) => defaultFormalRuntimeCanaryService.plan(input);

export const startCasimirFormalRuntimeCanaryV1 = (
  input: Parameters<typeof defaultFormalRuntimeCanaryService.start>[0],
) => defaultFormalRuntimeCanaryService.start(input);

export const readCasimirFormalRuntimeCanaryResultV1 = (
  input: Parameters<typeof defaultFormalRuntimeCanaryService.readResult>[0],
) => defaultFormalRuntimeCanaryService.readResult(input);

export const resetCasimirFormalRuntimeCanaryForTests = (): void =>
  defaultFormalRuntimeCanaryService.reset();

export const resetCasimirFormalRuntimeCanaryDependenciesForTestsV1 =
  (): void => {
    defaultFormalRuntimeCanaryService =
      createCasimirFormalRuntimeCanaryService();
  };
