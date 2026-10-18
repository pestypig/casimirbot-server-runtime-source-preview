import { z } from "zod";
import {
  civilizationCorridorScalePlanQuerySchema,
  civilizationCorridorScalePlanOutputSchema,
  civilizationCorridorScaleWindowSchema,
  planCivilizationCorridorScaleEvidence,
} from "./corridor-scale-evidence-plan";
import {
  civilizationProposedCorridorOutputSchema,
  readProposedCorridorScreen,
} from "./proposed-corridor-screen";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

export const civilizationCorridorScaleWindowEvidenceQuerySchema = z.object({
  plan: civilizationCorridorScalePlanQuerySchema,
  windowSequence: z.number().int().positive(),
}).strict();

export const civilizationCorridorScaleWindowEvidenceOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_window_evidence/v1"),
  query: civilizationCorridorScaleWindowEvidenceQuerySchema,
  planCoverage: civilizationCorridorScalePlanOutputSchema.shape.coverage,
  window: civilizationCorridorScaleWindowSchema,
  screen: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), evidence: civilizationProposedCorridorOutputSchema }).strict(),
    z.object({ status: z.literal("unavailable"), reason: z.string().min(1) }).strict(),
  ]),
  relationToWholeCorridor: z.literal("one_local_straight_sketch_piece_no_end_to_end_route_or_impact_inference"),
  authority: z.object({
    assistant_answer: z.literal(false),
    terminal_eligible: z.literal(false),
    execution_permission: z.literal(false),
    policy_finality: z.literal(false),
  }).strict(),
}).strict();
export type CivilizationCorridorScaleWindowEvidence = z.infer<typeof civilizationCorridorScaleWindowEvidenceOutputSchema>;

export async function readCivilizationCorridorScaleWindowEvidence(
  input: unknown,
  screenReader: typeof readProposedCorridorScreen = readProposedCorridorScreen,
): Promise<CivilizationCorridorScaleWindowEvidence> {
  const parsed = civilizationCorridorScaleWindowEvidenceQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Corridor-scale window evidence query is invalid.");
  }
  const query = parsed.data;
  const plan = planCivilizationCorridorScaleEvidence(query.plan);
  const window = plan.windows[query.windowSequence - 1];
  if (!window) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Window sequence is outside the returned plan budget.");
  }
  const screen = await Promise.resolve().then(() => screenReader(window.proposedCorridorScreenInput))
    .then((evidence) => ({ status: "available" as const, evidence }),
      (error: unknown) => ({
        status: "unavailable" as const,
        reason: error instanceof CivilizationGeospatialSourceError ? error.code : "local_source_screen_unavailable",
      }));
  return {
    schemaVersion: "civilization_corridor_scale_window_evidence/v1",
    query,
    planCoverage: plan.coverage,
    window,
    screen,
    relationToWholeCorridor: "one_local_straight_sketch_piece_no_end_to_end_route_or_impact_inference",
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  };
}
