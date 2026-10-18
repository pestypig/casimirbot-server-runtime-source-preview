import { z } from "zod";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";
import { civilizationInfrastructureKindSchema } from "./osm-infrastructure-evidence";
import { civilizationProposedCorridorQuerySchema } from "./proposed-corridor-screen";

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
const bboxSchema = z.tuple([
  z.number().min(-180).max(180), z.number().min(-90).max(90),
  z.number().min(-180).max(180), z.number().min(-90).max(90),
]);

export const civilizationCorridorScalePlanQuerySchema = z.object({
  vertices: z.array(pointSchema).min(2).max(64),
  intendedUse: z.string().trim().min(3).max(120),
  countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).default([]),
  mappedInfrastructureKinds: z.array(civilizationInfrastructureKindSchema).max(6).default([]),
  contemplatedModes: civilizationProposedCorridorQuerySchema.shape.contemplatedModes,
  includeTerrainPointObservations: z.boolean().default(false),
  includeGlobalReliefObservations: z.boolean().default(false),
  evaluatedAt: z.string().datetime({ offset: true }),
  maxWindows: z.number().int().min(1).max(96).default(48),
}).strict();
export type CivilizationCorridorScalePlanQuery = z.infer<typeof civilizationCorridorScalePlanQuerySchema>;

export const civilizationCorridorScaleWindowSchema = z.object({
  sequence: z.number().int().positive(),
  sketchSegmentIndex: z.number().int().nonnegative(),
  from: pointSchema,
  to: pointSchema,
  bbox: bboxSchema,
  proposedCorridorScreenInput: z.object({
    bbox: bboxSchema,
    vertices: z.tuple([pointSchema, pointSchema]),
    intendedUse: z.string().min(3),
    countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)).max(2),
    mappedInfrastructureKinds: z.array(civilizationInfrastructureKindSchema).max(6),
    contemplatedModes: civilizationProposedCorridorQuerySchema.shape.contemplatedModes,
    includeTerrainPointObservations: z.boolean(),
    includeGlobalReliefObservations: z.boolean(),
    evaluatedAt: z.string().datetime({ offset: true }),
  }).strict(),
  geographicMeaning: z.literal("straight_sketch_segment_local_survey_window"),
  suggestedReadOrder: z.array(z.enum([
    "helix_civilization_proposed_corridor_screen",
    "helix_civilization_infrastructure_evidence",
    "helix_civilization_route_options",
  ])).length(3),
}).strict();

export const civilizationCorridorScalePlanOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_evidence_plan/v1"),
  query: civilizationCorridorScalePlanQuerySchema,
  coverage: z.object({
    status: z.enum(["all_sketch_segments_planned", "window_budget_exhausted"]),
    plannedWindowCount: z.number().int().nonnegative(),
    requiredWindowCount: z.number().int().positive(),
    unplannedWindowCount: z.number().int().nonnegative(),
    plannedThroughSketchSegmentIndex: z.number().int().nonnegative().nullable(),
    evidenceAcquired: z.literal(false),
    missingEvidence: z.array(z.string()),
  }).strict(),
  windows: z.array(civilizationCorridorScaleWindowSchema),
  interpretation: z.literal("Windows follow the caller's straight sketch segments. They are local source-read requests, not a continuous mapped route, a route search, jurisdiction finding, land survey, or evidence that the corridor is feasible or permitted."),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScalePlan = z.infer<typeof civilizationCorridorScalePlanOutputSchema>;

type Point = z.infer<typeof pointSchema>;
type Part = { from: Point; to: Point; segmentIndex: number };

function splitAtDateLine(from: Point, to: Point, segmentIndex: number): Part[] {
  let endLon = to.lon;
  const difference = endLon - from.lon;
  if (difference > 180) endLon -= 360;
  else if (difference < -180) endLon += 360;
  if (from.lat === to.lat && from.lon === endLon) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Adjacent corridor sketch vertices refer to the same geographic point.");
  }
  const seam = endLon > 180 ? 180 : endLon < -180 ? -180 : null;
  if (seam === null) {
    return [{ from, to: { lat: to.lat, lon: endLon }, segmentIndex }];
  }
  if (from.lon === seam) {
    return [{ from: { ...from, lon: seam === 180 ? -180 : 180 }, to, segmentIndex }];
  }
  const fraction = (seam - from.lon) / (endLon - from.lon);
  const seamLat = from.lat + (to.lat - from.lat) * fraction;
  const otherSeam = seam === 180 ? -180 : 180;
  return [
    { from, to: { lat: seamLat, lon: seam }, segmentIndex },
    { from: { lat: seamLat, lon: otherSeam }, to, segmentIndex },
  ];
}

function bboxFor(from: Point, to: Point): z.infer<typeof bboxSchema> {
  const pad = 0.05;
  return [
    Math.max(-180, Math.min(from.lon, to.lon) - pad),
    Math.max(-90, Math.min(from.lat, to.lat) - pad),
    Math.min(180, Math.max(from.lon, to.lon) + pad),
    Math.min(90, Math.max(from.lat, to.lat) + pad),
  ];
}

export function planCivilizationCorridorScaleEvidence(input: unknown): CivilizationCorridorScalePlan {
  const parsed = civilizationCorridorScalePlanQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Corridor scale evidence plan query is invalid.");
  const query = parsed.data;
  if (new Set(query.countryIso3s).size !== query.countryIso3s.length ||
      new Set(query.mappedInfrastructureKinds).size !== query.mappedInfrastructureKinds.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Country and infrastructure selections must be unique.");
  }
  const parts: Part[] = [];
  for (let index = 0; index < query.vertices.length - 1; index++) {
    const from = query.vertices[index];
    const to = query.vertices[index + 1];
    if (from.lat === to.lat && from.lon === to.lon) {
      throw new CivilizationGeospatialSourceError("invalid_query", "Adjacent corridor sketch vertices must differ.");
    }
    parts.push(...splitAtDateLine(from, to, index));
  }
  const windows: CivilizationCorridorScalePlan["windows"] = [];
  let requiredWindowCount = 0;
  for (const part of parts) {
    const steps = Math.max(1, Math.ceil(Math.max(
      Math.abs(part.to.lat - part.from.lat), Math.abs(part.to.lon - part.from.lon),
    ) / 0.8));
    requiredWindowCount += steps;
    for (let step = 0; step < steps && windows.length < query.maxWindows; step++) {
      const interpolate = (fraction: number): Point => ({
        lat: part.from.lat + (part.to.lat - part.from.lat) * fraction,
        lon: part.from.lon + (part.to.lon - part.from.lon) * fraction,
      });
      const from = interpolate(step / steps);
      const to = interpolate((step + 1) / steps);
      const bbox = bboxFor(from, to);
      windows.push({
        sequence: windows.length + 1,
        sketchSegmentIndex: part.segmentIndex,
        from, to,
        bbox,
        proposedCorridorScreenInput: {
          bbox, vertices: [from, to], intendedUse: query.intendedUse,
          countryIso3s: query.countryIso3s,
          mappedInfrastructureKinds: query.mappedInfrastructureKinds,
          contemplatedModes: query.contemplatedModes,
          includeTerrainPointObservations: query.includeTerrainPointObservations,
          includeGlobalReliefObservations: query.includeGlobalReliefObservations,
          evaluatedAt: query.evaluatedAt,
        },
        geographicMeaning: "straight_sketch_segment_local_survey_window",
        suggestedReadOrder: [
          "helix_civilization_proposed_corridor_screen",
          "helix_civilization_infrastructure_evidence",
          "helix_civilization_route_options",
        ],
      });
    }
  }
  const unplannedWindowCount = requiredWindowCount - windows.length;
  return {
    schemaVersion: "civilization_corridor_scale_evidence_plan/v1",
    query,
    coverage: {
      status: unplannedWindowCount ? "window_budget_exhausted" : "all_sketch_segments_planned",
      plannedWindowCount: windows.length,
      requiredWindowCount,
      unplannedWindowCount,
      plannedThroughSketchSegmentIndex: windows.length ? windows[windows.length - 1].sketchSegmentIndex : null,
      evidenceAcquired: false,
      missingEvidence: [
        "No live map, network, natural-system, country, port, or engineering source has been read by this planner.",
        "Each local window needs independent source reads; adjoining local route candidates do not establish a continuous international connection.",
        "The straight sketch and 0.05-degree window padding do not screen alternate alignments or the full affected landscape.",
        "Selected country depictions are limited to two; possible third-country contacts require separate jurisdiction and affected-party review.",
        ...(unplannedWindowCount ? [`${unplannedWindowCount} required local windows exceed this request's maxWindows budget; the remaining sketch is unplanned.`] : []),
      ],
    },
    windows,
    interpretation: "Windows follow the caller's straight sketch segments. They are local source-read requests, not a continuous mapped route, a route search, jurisdiction finding, land survey, or evidence that the corridor is feasible or permitted.",
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  };
}
