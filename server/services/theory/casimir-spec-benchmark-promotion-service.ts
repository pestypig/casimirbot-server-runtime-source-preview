import trustRegistryJson from "../../../configs/research/casimir-spec-benchmark-trust-registry.v1.json";
import {
  assessCasimirSpecBenchmarkPromotionV1,
  type CasimirSpecBenchmarkPromotionGateV1,
  type CasimirSpecBenchmarkRequiredTamperFixtureFamilyV1,
  type CasimirSpecBenchmarkSafetyGroupOutcomeV1,
  type CasimirSpecBenchmarkSealedPopulationReceiptV1,
  type CasimirSpecBenchmarkTrustedReceiptAuthenticationV1,
} from "../../../shared/contracts/casimir-spec-benchmark-promotion-gate.v1";
import type { CasimirSpecBenchmarkPairedBinaryEpisodesV1 } from "../../../shared/contracts/casimir-spec-benchmark-statistics.v1";

const TRUST_REGISTRY_SCHEMA_VERSION =
  "casimir_spec_benchmark_trust_registry/v1" as const;

type TrustRegistryV1 = {
  schemaVersion: typeof TRUST_REGISTRY_SCHEMA_VERSION;
  authenticatedPopulationReceipts: Array<{
    receiptSha256: string;
    trustRegistrySha256: string;
  }>;
};

const trustRegistry = trustRegistryJson as unknown as TrustRegistryV1;

function resolveTrustedAuthentication(
  receipt: CasimirSpecBenchmarkSealedPopulationReceiptV1,
): CasimirSpecBenchmarkTrustedReceiptAuthenticationV1 {
  if (
    trustRegistry.schemaVersion !== TRUST_REGISTRY_SCHEMA_VERSION ||
    !Array.isArray(trustRegistry.authenticatedPopulationReceipts)
  ) {
    throw new Error("Casimir Spec benchmark trust registry is invalid");
  }
  const admitted = trustRegistry.authenticatedPopulationReceipts.find(
    (entry) =>
      entry.receiptSha256 === receipt.receiptSha256 &&
      entry.trustRegistrySha256 === receipt.trustRegistrySha256,
  );
  return {
    status: "verified",
    verificationBoundary: "server_owned_out_of_band_trust_registry",
    receiptSha256: admitted?.receiptSha256 ?? "0".repeat(64),
    trustRegistrySha256: admitted?.trustRegistrySha256 ?? "0".repeat(64),
  };
}

export async function assessServerTrustedCasimirSpecBenchmarkPromotionV1(input: {
  assessedAt: string;
  sealedPopulationReceipt: CasimirSpecBenchmarkSealedPopulationReceiptV1;
  pairedEpisodes: CasimirSpecBenchmarkPairedBinaryEpisodesV1;
  safetyGroupOutcomes: CasimirSpecBenchmarkSafetyGroupOutcomeV1[];
  bootstrapSeedMaterial: string;
  hardGateRegressions: string[];
  detectedTamperFixtureFamilies: CasimirSpecBenchmarkRequiredTamperFixtureFamilyV1[];
  pdeLanyonEffectReportedSeparately: boolean;
  replayArtifactsReproducible: boolean;
}): Promise<CasimirSpecBenchmarkPromotionGateV1> {
  return assessCasimirSpecBenchmarkPromotionV1({
    ...input,
    trustedReceiptAuthentication: resolveTrustedAuthentication(
      input.sealedPopulationReceipt,
    ),
  });
}
