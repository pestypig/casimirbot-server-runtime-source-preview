import type { HelixTheoryFrontierVectorFieldToolReceiptV1 } from "../../../shared/contracts/helix-theory-frontier-vector-field-tool-receipt.v1";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../shared/theory/nhm2-theory-badges";
import { runHelixTheoryFrontierVectorFieldTool } from "../../../shared/theory/theory-frontier-vector-field-tool";

export type RunAskLevelTheoryFrontierVectorFieldToolInput = {
  query: string;
  originBadgeIds?: string[];
  maxDepth?: number;
  basisVersion?: string;
  scoringVersion?: string;
  searchSeed?: string;
  turnId: string;
  threadId?: string | null;
  generatedAt?: string;
  admissionReason?: string;
};

export function runAskLevelTheoryFrontierVectorFieldTool(
  input: RunAskLevelTheoryFrontierVectorFieldToolInput,
): HelixTheoryFrontierVectorFieldToolReceiptV1 {
  return runHelixTheoryFrontierVectorFieldTool({
    graph: buildNhm2TheoryBadgeGraphV1(),
    query: input.query,
    originBadgeIds: input.originBadgeIds,
    maxDepth: input.maxDepth,
    basisVersion: input.basisVersion,
    scoringVersion: input.scoringVersion,
    searchSeed: input.searchSeed,
    turnId: input.turnId,
    threadId: input.threadId ?? null,
    generatedAt: input.generatedAt,
    admissionReason: input.admissionReason ?? "helix_ask_frontier_vector_field_capability",
  });
}
