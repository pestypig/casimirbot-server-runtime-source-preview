import type {
  CasimirArtifactGenerationReceiptV1,
  CasimirArtifactGenerationRequestV1,
} from "../../../shared/contracts/casimir-artifact-generation.v1";
import type { CasimirIndependentNumericalReplayPolicyV1 } from "../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import type { CasimirIndependentNumericalVerificationRequestV1 } from "../../../shared/contracts/casimir-independent-numerical-verification.v1";
import { computeCasimirSpecValueSha256V1 } from "../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import type { HelixAccountType } from "../../../shared/helix-account-session";

/**
 * The executable paths and replay policy in this packet are authority-bearing.
 * They must originate from a server-installed catalog resolver, never from a
 * model or workstation-tool argument.
 */
export type CasimirIndependentNumericalSealedInputV1 = {
  procedure: {
    schemaVersion: "theory_experiment_procedure/v1";
    procedureId: string;
    procedureSha256: string;
  };
  executorCapability: {
    capabilityId: string;
    artifactSha256: string;
  };
  request: CasimirIndependentNumericalVerificationRequestV1;
  policy: CasimirIndependentNumericalReplayPolicyV1;
  primaryGenerationRequest: CasimirArtifactGenerationRequestV1;
  primaryProducerReceipt: CasimirArtifactGenerationReceiptV1;
  independentGenerationRequest: CasimirArtifactGenerationRequestV1;
  independentProducerReceipt: CasimirArtifactGenerationReceiptV1;
  harnessSourcePath: string;
  harnessExecutablePath: string;
  primarySourcePath: string;
  primaryBuildManifestPath: string;
  primaryExecutablePath: string;
  independentSourcePath: string;
  independentBuildManifestPath: string;
  independentExecutablePath: string;
};

export type CasimirIndependentNumericalExecutionCatalogResolveInputV1 = {
  accountType: HelixAccountType;
  profileId: string | null;
  catalogEntryId: string;
  procedureId: string;
  procedureSha256: string;
};

const SAFE_CATALOG_RESOLUTION_ISSUE_CODE =
  /^numerical_[a-z0-9_]+(?::[a-z0-9_]+)?$/;

/**
 * Provider-neutral, redacted failure from a trusted catalog resolver.
 * Only bounded issue codes cross into tool observations; implementation
 * messages, paths, and exception details remain server-internal.
 */
export class CasimirIndependentNumericalExecutionCatalogResolutionErrorV1 extends Error {
  readonly issueCodes: string[];

  constructor(issueCodes: readonly string[]) {
    super("trusted numerical execution catalog resolution failed");
    this.name = "CasimirIndependentNumericalExecutionCatalogResolutionErrorV1";
    const safeCodes = issueCodes.filter(
      (issue) =>
        issue.length <= 160 && SAFE_CATALOG_RESOLUTION_ISSUE_CODE.test(issue),
    );
    this.issueCodes =
      safeCodes.length > 0
        ? [...new Set(safeCodes)].sort()
        : ["numerical_execution_catalog_entry_invalid"];
  }
}

export const isCasimirIndependentNumericalExecutionCatalogResolutionErrorV1 = (
  value: unknown,
): value is CasimirIndependentNumericalExecutionCatalogResolutionErrorV1 =>
  value instanceof CasimirIndependentNumericalExecutionCatalogResolutionErrorV1;

/**
 * This dependency is installed by trusted server composition. The public tool
 * rail receives only an opaque catalog entry id and cannot author the returned
 * policy, paths, or executable identities.
 */
export type TrustedCasimirIndependentNumericalExecutionCatalogResolverV1 = (
  input: CasimirIndependentNumericalExecutionCatalogResolveInputV1,
) =>
  | Promise<CasimirIndependentNumericalSealedInputV1 | null>
  | CasimirIndependentNumericalSealedInputV1
  | null;

export const cloneCasimirIndependentNumericalSealedInputV1 = (
  value: CasimirIndependentNumericalSealedInputV1,
): CasimirIndependentNumericalSealedInputV1 =>
  structuredClone(value) as CasimirIndependentNumericalSealedInputV1;

export async function computeCasimirIndependentNumericalSealedInputSha256V1(
  value: CasimirIndependentNumericalSealedInputV1,
): Promise<string> {
  return computeCasimirSpecValueSha256V1({
    domain: "casimir-independent-numerical-verifier-sealed-input/v1",
    procedure: value.procedure,
    executorCapability: value.executorCapability,
    request: value.request,
    policy: value.policy,
    primaryGenerationRequest: value.primaryGenerationRequest,
    primaryProducerReceipt: value.primaryProducerReceipt,
    independentGenerationRequest: value.independentGenerationRequest,
    independentProducerReceipt: value.independentProducerReceipt,
    harnessSourcePath: value.harnessSourcePath,
    harnessExecutablePath: value.harnessExecutablePath,
    primarySourcePath: value.primarySourcePath,
    primaryBuildManifestPath: value.primaryBuildManifestPath,
    primaryExecutablePath: value.primaryExecutablePath,
    independentSourcePath: value.independentSourcePath,
    independentBuildManifestPath: value.independentBuildManifestPath,
    independentExecutablePath: value.independentExecutablePath,
  });
}
