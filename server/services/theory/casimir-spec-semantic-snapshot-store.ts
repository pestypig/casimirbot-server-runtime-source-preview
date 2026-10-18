import snapshotStoreJson from "../../../configs/research/casimir-spec-semantic-snapshot-store.v1.json";
import type { CasimirSpecScientificClaimIrV1 } from "../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import type {
  CasimirSpecRegisteredIdentityBindingV1,
  CasimirSpecSemanticCatalogSnapshotV1,
  CasimirSpecSemanticGraphSnapshotV1,
} from "./casimir-spec-semantic-admission";

export const CASIMIR_SPEC_SEMANTIC_SNAPSHOT_STORE_SCHEMA_VERSION =
  "casimir_spec_semantic_snapshot_store/v1" as const;

type CasimirSpecSemanticSnapshotStoreV1 = {
  schemaVersion: typeof CASIMIR_SPEC_SEMANTIC_SNAPSHOT_STORE_SCHEMA_VERSION;
  catalogSnapshots: CasimirSpecSemanticCatalogSnapshotV1[];
  registeredIdentityBindings: CasimirSpecRegisteredIdentityBindingV1[];
  graphSnapshots: CasimirSpecSemanticGraphSnapshotV1[];
};

const snapshotStore =
  snapshotStoreJson as unknown as CasimirSpecSemanticSnapshotStoreV1;

function assertSnapshotStoreIdentity(): void {
  if (
    snapshotStore.schemaVersion !==
      CASIMIR_SPEC_SEMANTIC_SNAPSHOT_STORE_SCHEMA_VERSION ||
    !Array.isArray(snapshotStore.catalogSnapshots) ||
    !Array.isArray(snapshotStore.registeredIdentityBindings) ||
    !Array.isArray(snapshotStore.graphSnapshots)
  ) {
    throw new Error(
      "server-owned Casimir Spec semantic snapshot store invalid",
    );
  }
}

export function resolveServerOwnedCasimirSpecSemanticSnapshotsV1(
  claimIr: CasimirSpecScientificClaimIrV1,
): {
  catalogSnapshots: CasimirSpecSemanticCatalogSnapshotV1[];
  registeredIdentityBindings: CasimirSpecRegisteredIdentityBindingV1[];
  graphSnapshot: CasimirSpecSemanticGraphSnapshotV1 | null;
} {
  assertSnapshotStoreIdentity();
  const requiredCatalogIds = new Set(
    claimIr.catalogBindings.map((binding) => binding.catalogId),
  );
  const requiredBindingIds = new Set(
    claimIr.symbols.flatMap((symbol) =>
      symbol.identity.kind === "registered" ? [symbol.identity.bindingId] : [],
    ),
  );
  return {
    catalogSnapshots: snapshotStore.catalogSnapshots.filter((snapshot) =>
      requiredCatalogIds.has(snapshot.catalogId),
    ),
    registeredIdentityBindings: snapshotStore.registeredIdentityBindings.filter(
      (binding) => requiredBindingIds.has(binding.bindingId),
    ),
    graphSnapshot:
      claimIr.world.graphId === null
        ? null
        : (snapshotStore.graphSnapshots.find(
            (snapshot) => snapshot.graphId === claimIr.world.graphId,
          ) ?? null),
  };
}
