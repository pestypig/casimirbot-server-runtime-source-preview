import { z } from "zod";
import sourceData from "../../assets/civilization/natural-earth-50m-rivers-v5.0.0.json";
import {
  buildCivilizationTraversabilityAtlasV1,
  validateCivilizationTraversabilityAtlasV1,
  type CivilizationHydrographicLineV1,
  type CivilizationTraversabilityAtlasV1,
} from "@shared/civilization-traversability-atlas";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

type Point = { lat: number; lon: number };
type Bbox = [number, number, number, number];
type SourceFeature = {
  id: number;
  name: string | null;
  nameEn: string | null;
  kind: "river" | "lake_centerline";
  scaleRank: number;
  minZoom: number;
  parts: number[][][];
};
const source = sourceData as unknown as Omit<typeof sourceData, "features"> & { features: SourceFeature[] };
const DATASET_ID = "ne_50m_rivers_lake_centerlines";
const SOURCE_VERSION = "5.0.0";
const SOURCE_SHA256 = "c607d9d7e7702827a7996fff6dc17b87a338c5ed3b52d12c402e0c9669cc7b56";
const CATEGORIES = ["river", "lake_centerline"] as const;

export const civilizationNaturalEarthHydrographyQuerySchema = z.object({
  bbox: z.tuple([
    z.number().min(-180).max(180), z.number().min(-90).max(90),
    z.number().min(-180).max(180), z.number().min(-90).max(90),
  ]),
  kinds: z.array(z.enum(CATEGORIES)).min(1).max(2).default([...CATEGORIES]),
  maxLines: z.number().int().min(1).max(100).default(50),
}).strict();
export type CivilizationNaturalEarthHydrographyQuery = z.infer<typeof civilizationNaturalEarthHydrographyQuerySchema>;

export const civilizationNaturalEarthHydrographyOutputSchema = z.object({
  schemaVersion: z.literal("civilization_natural_earth_hydrography/v1"),
  query: civilizationNaturalEarthHydrographyQuerySchema,
  source: z.object({
    sourceId: z.literal("natural_earth_50m_rivers_lake_centerlines"),
    sourceArchiveUrl: z.string().url(),
    sourcePageUrl: z.string().url(),
    sourceArchiveSha256: z.literal(SOURCE_SHA256),
    datasetVersion: z.literal(SOURCE_VERSION),
    snapshotAcquiredAt: z.string(),
    readAt: z.string().datetime({ offset: true }),
    licenseId: z.literal("Public Domain"),
    licenseUrl: z.string().url(),
    spatialScale: z.literal("1:50m generalized cartography"),
  }).strict(),
  coverage: z.object({
    sourceFeatures: z.number().int().nonnegative(),
    excludedCanals: z.number().int().nonnegative(),
    matchingLines: z.number().int().nonnegative(),
    returnedLines: z.number().int().nonnegative(),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
  atlas: z.any(),
  authority: z.object({
    assistant_answer: z.literal(false),
    terminal_eligible: z.literal(false),
    execution_permission: z.literal(false),
  }).strict(),
}).strict();

export type CivilizationNaturalEarthHydrographyEvidence = {
  schemaVersion: "civilization_natural_earth_hydrography/v1";
  query: CivilizationNaturalEarthHydrographyQuery;
  source: z.infer<typeof civilizationNaturalEarthHydrographyOutputSchema>["source"];
  coverage: z.infer<typeof civilizationNaturalEarthHydrographyOutputSchema>["coverage"];
  atlas: CivilizationTraversabilityAtlasV1;
  authority: { assistant_answer: false; terminal_eligible: false; execution_permission: false };
};

function validBbox(bbox: Bbox): boolean {
  const [west, south, east, north] = bbox;
  return west < east && south < north && east - west <= 20 && north - south <= 20;
}

function segmentIntersectsBbox(a: Point, b: Point, bbox: Bbox): boolean {
  const [west, south, east, north] = bbox;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const p = [-dx, dx, -dy, dy];
  const q = [a.lon - west, east - a.lon, a.lat - south, north - a.lat];
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 4; index++) {
    if (p[index] === 0) {
      if (q[index] < 0) return false;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return false;
  }
  return true;
}

function intersects(feature: SourceFeature, bbox: Bbox): boolean {
  return feature.parts.some((part) => part.some((raw, index) => index > 0 &&
    segmentIntersectsBbox(
      { lon: part[index - 1][0], lat: part[index - 1][1] },
      { lon: raw[0], lat: raw[1] },
      bbox,
    )));
}

function normalize(feature: SourceFeature, readAt: string): CivilizationHydrographicLineV1 {
  const evidenceRef = `natural-earth:${DATASET_ID}:${feature.id}`;
  return {
    lineId: `hydrography:natural-earth:${feature.id}`,
    label: feature.nameEn ?? feature.name ?? `${feature.kind} ${feature.id}`,
    featureKind: feature.kind,
    geometryRef: {
      refId: `geometry:natural-earth:hydrography:${feature.id}`,
      kind: "polyline",
      description: "Natural Earth generalized 1:50m line in WGS84",
      sourceRefs: [evidenceRef, `natural-earth:archive-sha256:${SOURCE_SHA256}`],
    },
    lineParts: feature.parts.map((part) => part.map(([lon, lat]) => ({ lon, lat }))),
    sourceFeatureId: String(feature.id),
    sourceDatasetId: DATASET_ID,
    sourceVersion: SOURCE_VERSION,
    sourceArchiveSha256: SOURCE_SHA256,
    sourceRecordUrl: source.sourceArchiveUrl,
    sourceSnapshotAcquiredAt: source.acquiredAt,
    sourceEffectiveAt: null,
    fetchedAt: readAt,
    sourceLicense: "Public Domain",
    scaleRank: feature.scaleRank,
    navigabilityStatus: "unknown",
    dischargeStatus: "unknown",
    seasonalStatus: "unknown",
    evidenceRefs: [evidenceRef, `natural-earth:archive-sha256:${SOURCE_SHA256}`],
    missingEvidence: [
      "source_effective_date", "current_course_and_width", "seasonal_flow",
      "discharge_and_flood_stage", "navigability", "crossing_engineering",
      "water_rights_and_permissions", "small_waterways_omitted_by_scale",
    ],
    claimTier: "source_backed_observation",
  };
}

export function readNaturalEarthHydrography(input: unknown): CivilizationNaturalEarthHydrographyEvidence {
  const parsed = civilizationNaturalEarthHydrographyQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Natural Earth hydrography query is invalid.");
  }
  const query = parsed.data;
  if (!validBbox(query.bbox)) {
    throw new CivilizationGeospatialSourceError("invalid_bbox", "Hydrography area must be increasing, at most 20° on each axis, and not cross the date line.");
  }
  if (new Set(query.kinds).size !== query.kinds.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Hydrography kinds must be unique.");
  }
  if (source.schemaVersion !== "civilization_natural_earth_hydrography_source/v1" ||
      source.datasetId !== DATASET_ID || source.datasetVersion !== SOURCE_VERSION ||
      source.sourceArchiveSha256 !== SOURCE_SHA256 || !Array.isArray(source.features)) {
    throw new CivilizationGeospatialSourceError("source_invalid", "Pinned Natural Earth hydrography snapshot is invalid.");
  }
  const readAt = new Date().toISOString();
  const matches = source.features.filter((feature) => query.kinds.includes(feature.kind) &&
    intersects(feature, query.bbox));
  const selected = matches.slice(0, query.maxLines).map((feature) => normalize(feature, readAt));
  const possiblyTruncated = matches.length > selected.length;
  const atlas = buildCivilizationTraversabilityAtlasV1({
    generatedAt: readAt,
    atlasId: `civilization-traversability:natural-earth-hydrography:${readAt}`,
    scenarioId: "pinned_natural_earth_hydrography",
    title: "Natural Earth generalized river and lake centerline depictions",
    temporalFrame: { observedAt: readAt, cadence: "static" },
    fieldLayers: [],
    infrastructureNodes: [],
    hydrographicLines: selected,
    routeCandidates: [],
    observedFlows: [],
  });
  const issues = validateCivilizationTraversabilityAtlasV1(atlas);
  if (issues.length > 0) {
    throw new CivilizationGeospatialSourceError("atlas_invalid", issues.join("; "));
  }
  return {
    schemaVersion: "civilization_natural_earth_hydrography/v1",
    query,
    source: {
      sourceId: "natural_earth_50m_rivers_lake_centerlines",
      sourceArchiveUrl: source.sourceArchiveUrl,
      sourcePageUrl: source.sourcePageUrl,
      sourceArchiveSha256: SOURCE_SHA256,
      datasetVersion: SOURCE_VERSION,
      snapshotAcquiredAt: source.acquiredAt,
      readAt,
      licenseId: "Public Domain",
      licenseUrl: source.licenseUrl,
      spatialScale: "1:50m generalized cartography",
    },
    coverage: {
      sourceFeatures: source.features.length,
      excludedCanals: source.excludedCanals,
      matchingLines: matches.length,
      returnedLines: selected.length,
      possiblyTruncated,
      missingEvidence: [
        "generalized_1_to_50m_cartography_omits_small_waterways",
        "waterway_location_and_effective_date_unverified",
        "no_discharge_navigability_or_crossing_assessment",
        ...(possiblyTruncated ? ["additional_matching_lines_not_returned"] : []),
        ...(matches.length === 0 ? ["absence_of_mapped_line_does_not_prove_no_waterway"] : []),
      ],
    },
    atlas,
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  };
}
