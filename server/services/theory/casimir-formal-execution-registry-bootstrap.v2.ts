import {
  createCasimirFormalVerificationExecutionCatalogV2,
  type CasimirFormalVerificationExecutionCatalogEntryV2,
  type TrustedCasimirFormalExecutionEnrollmentVerifierV2,
} from "./casimir-formal-verification-execution-catalog.v2";
import type {
  CasimirFormalExternalSandboxExecutorV2,
  CasimirFormalVerifierJobServiceDependenciesV2,
} from "./casimir-formal-verifier-job-service.v2";
import {
  installCasimirFormalExecutionDependenciesForServerV2,
} from "./casimir-theory-execution-server-composition";

export const CASIMIR_FORMAL_EXECUTION_REGISTRY_BOOTSTRAP_STATUS_SCHEMA_V2 =
  "casimir.formal_execution_registry.bootstrap_status.v2" as const;

type ExternalSandboxExecutorResolverV2 = NonNullable<
  CasimirFormalVerifierJobServiceDependenciesV2["resolveExternalSandboxExecutor"]
>;

export type CasimirFormalExecutionRegistryBootstrapStatusV2 = {
  schema: typeof CASIMIR_FORMAL_EXECUTION_REGISTRY_BOOTSTRAP_STATUS_SCHEMA_V2;
  configured: boolean;
  catalogConfigured: boolean;
  catalogEntryCount: number;
  enrollmentRegistrationVerifierConfigured: boolean;
  externalSandboxExecutorResolverConfigured: boolean;
  executorCapabilitiesRequired: number;
  executorCapabilitiesPreflighted: number;
  catalogIssues: string[];
  blockerCodes: string[];
  authority: {
    trustedServerCompositionOnly: true;
    executesJobs: false;
    validatesScientificTruth: false;
    validatesTheory: false;
    validatesGeneratedCode: false;
    validatesNumericalImplementation: false;
    validatesEmpiricalClaim: false;
    validatesPhysicalMechanism: false;
    assistantAnswer: false;
    terminalEligible: false;
  };
};

export type CasimirFormalExecutionRegistryBootstrapInputV2 = {
  entries?: readonly CasimirFormalVerificationExecutionCatalogEntryV2[];
  verifyEnrollmentRegistration?: TrustedCasimirFormalExecutionEnrollmentVerifierV2;
  resolveExternalSandboxExecutor?: ExternalSandboxExecutorResolverV2;
};

const authority =
  (): CasimirFormalExecutionRegistryBootstrapStatusV2["authority"] => ({
    trustedServerCompositionOnly: true,
    executesJobs: false,
    validatesScientificTruth: false,
    validatesTheory: false,
    validatesGeneratedCode: false,
    validatesNumericalImplementation: false,
    validatesEmpiricalClaim: false,
    validatesPhysicalMechanism: false,
    assistantAnswer: false,
    terminalEligible: false,
  });

const exactExecutorCapability = (
  executor: CasimirFormalExternalSandboxExecutorV2 | null | undefined,
  expected: {
    capabilityId: string;
    artifactSha256: string;
  },
): boolean =>
  Boolean(
    executor &&
      executor.capabilityId === expected.capabilityId &&
      executor.artifactSha256 === expected.artifactSha256 &&
      typeof executor.execute === "function",
  );

/**
 * Trusted bootstrap-only installation boundary for the formal execution
 * registry. It is deliberately not exported through an HTTP route or agent
 * tool. Every invocation first clears lane-specific catalog/executor
 * authority while preserving shared approval trust, then installs a new
 * registry only after catalog integrity and every distinct executor
 * capability have passed preflight. Preflight resolves identity only; it
 * never submits or executes a job.
 */
export const installCasimirFormalExecutionRegistryAtServerBootstrapV2 =
  async (
    input: CasimirFormalExecutionRegistryBootstrapInputV2 = {},
  ): Promise<CasimirFormalExecutionRegistryBootstrapStatusV2> => {
    installCasimirFormalExecutionDependenciesForServerV2({});

    const entries = input.entries ?? [];
    const catalog =
      await createCasimirFormalVerificationExecutionCatalogV2(
        entries,
        {
          verifyEnrollmentRegistration:
            input.verifyEnrollmentRegistration,
        },
      );
    const inspection = catalog.inspect();
    const enrollmentRegistrationVerifierConfigured =
      typeof input.verifyEnrollmentRegistration === "function";
    const externalSandboxExecutorResolverConfigured =
      typeof input.resolveExternalSandboxExecutor === "function";
    const blockerCodes: string[] = [];
    if (entries.length === 0)
      blockerCodes.push("formal_execution_registry_entries_required");
    if (!enrollmentRegistrationVerifierConfigured)
      blockerCodes.push(
        "formal_execution_enrollment_registration_verifier_unconfigured",
      );
    if (!inspection.configured || inspection.entryCount === 0)
      blockerCodes.push("formal_execution_catalog_empty_or_invalid");
    if (!externalSandboxExecutorResolverConfigured)
      blockerCodes.push(
        "formal_external_sandbox_executor_unconfigured",
      );

    const requiredCapabilities = new Map<
      string,
      { capabilityId: string; artifactSha256: string }
    >();
    if (inspection.configured) {
      for (const entry of inspection.entries) {
        requiredCapabilities.set(
          JSON.stringify([
            entry.executorCapabilityId,
            entry.executorCapabilitySha256,
          ]),
          {
            capabilityId: entry.executorCapabilityId,
            artifactSha256: entry.executorCapabilitySha256,
          },
        );
      }
    }

    let executorCapabilitiesPreflighted = 0;
    if (
      inspection.configured &&
      externalSandboxExecutorResolverConfigured
    ) {
      for (const expected of requiredCapabilities.values()) {
        try {
          const executor =
            await input.resolveExternalSandboxExecutor?.(expected);
          if (!exactExecutorCapability(executor, expected)) {
            blockerCodes.push(
              "formal_external_sandbox_executor_capability_mismatch",
            );
            continue;
          }
          executorCapabilitiesPreflighted += 1;
        } catch {
          blockerCodes.push(
            "formal_external_sandbox_executor_preflight_failed",
          );
        }
      }
    }

    if (
      requiredCapabilities.size !== executorCapabilitiesPreflighted
    ) {
      blockerCodes.push(
        "formal_external_sandbox_executor_preflight_incomplete",
      );
    }
    const uniqueBlockers = [...new Set(blockerCodes)].sort();
    const configured =
      inspection.configured &&
      inspection.entryCount > 0 &&
      inspection.issues.length === 0 &&
      requiredCapabilities.size > 0 &&
      requiredCapabilities.size === executorCapabilitiesPreflighted &&
      uniqueBlockers.length === 0;

    if (configured && input.resolveExternalSandboxExecutor) {
      installCasimirFormalExecutionDependenciesForServerV2({
        resolveTrustedExecutionCatalogEntry: catalog.resolve,
        inspectTrustedExecutionCatalog: catalog.inspect,
        resolveExternalSandboxExecutor:
          input.resolveExternalSandboxExecutor,
      });
    }

    return {
      schema:
        CASIMIR_FORMAL_EXECUTION_REGISTRY_BOOTSTRAP_STATUS_SCHEMA_V2,
      configured,
      catalogConfigured: inspection.configured,
      catalogEntryCount: inspection.entryCount,
      enrollmentRegistrationVerifierConfigured,
      externalSandboxExecutorResolverConfigured,
      executorCapabilitiesRequired: requiredCapabilities.size,
      executorCapabilitiesPreflighted,
      catalogIssues: [...inspection.issues],
      blockerCodes: uniqueBlockers,
      authority: authority(),
    };
  };
