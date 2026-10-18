import { z } from "zod";
import sourceData from "../../assets/civilization/natural-earth-50m-lakes-v5.0.0.json";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

const SOURCE_SHA256 = "f28d42c286d96b57a17aac2cbeb432f8c65532c20063495711fbc64e24666df3";
type SourceFeature = {
  id: number; name: string | null; nameEn: string | null; featureClass: string;
  scaleRank: number; minZoom: number; bbox: [number, number, number, number];
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};
const source = sourceData as unknown as Omit<typeof sourceData, "features"> & { features: SourceFeature[] };

export const civilizationNaturalEarthLakesQuerySchema = z.object({
  bbox: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90),
    z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  maxLakes: z.number().int().min(1).max(100).default(50),
}).strict();
export type CivilizationNaturalEarthLakesQuery = z.infer<typeof civilizationNaturalEarthLakesQuerySchema>;

export const civilizationNaturalEarthLakesOutputSchema = z.object({
  schemaVersion: z.literal("civilization_natural_earth_lakes/v1"),
  query: civilizationNaturalEarthLakesQuerySchema,
  source: z.object({
    sourceId: z.literal("natural_earth_50m_lakes"),
    sourceArchiveUrl: z.string().url(), sourcePageUrl: z.string().url(),
    sourceArchiveSha256: z.literal(SOURCE_SHA256), datasetVersion: z.literal("5.0.0"),
    snapshotAcquiredAt: z.string().date(), readAt: z.string().datetime({ offset: true }),
    licenseId: z.literal("Public Domain"), licenseUrl: z.string().url(),
    spatialScale: z.literal("1:50m generalized cartography"),
    sourceEffectiveAt: z.null(),
  }).strict(),
  coverage: z.object({
    sourceFeatures: z.number().int().nonnegative(), matchingBboxCandidates: z.number().int().nonnegative(),
    returnedLakes: z.number().int().nonnegative(), possiblyTruncated: z.boolean(),
    spatialSelection: z.literal("feature_bbox_intersection_only"), missingEvidence: z.array(z.string()),
  }).strict(),
  lakes: z.array(z.object({
    featureId: z.number().int(), label: z.string(), featureClass: z.string(),
    scaleRank: z.number(), minZoom: z.number(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    geometry: z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.any() }).strict(),
    sourceRecordUrl: z.string().url(), sourceEffectiveAt: z.null(),
    interpretation: z.literal("generalized_lake_depiction_not_current_shoreline_or_impact_assessment"),
  }).strict()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false) }).strict(),
}).strict();
export type CivilizationNaturalEarthLakesEvidence = z.infer<typeof civilizationNaturalEarthLakesOutputSchema>;

function overlaps(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function readNaturalEarthLakes(input: unknown): CivilizationNaturalEarthLakesEvidence {
  const parsed = civilizationNaturalEarthLakesQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Natural Earth lakes query is invalid.");
  const query = parsed.data;
  const [west, south, east, north] = query.bbox;
  if (west >= east || south >= north || east - west > 20 || north - south > 20) {
    throw new CivilizationGeospatialSourceError("invalid_bbox", "Lakes area must be increasing, at most 20° on each axis, and not cross the date line.");
  }
  if (source.schemaVersion !== "civilization_natural_earth_lakes_source/v1" ||
      source.datasetId !== "ne_50m_lakes" || source.datasetVersion !== "5.0.0" ||
      source.sourceArchiveSha256 !== SOURCE_SHA256 || !Array.isArray(source.features)) {
    throw new CivilizationGeospatialSourceError("source_invalid", "Pinned Natural Earth lakes snapshot is invalid.");
  }
  const readAt = new Date().toISOString();
  const matches = source.features.filter((feature) => overlaps(feature.bbox, query.bbox))
    .sort((a, b) => a.scaleRank - b.scaleRank || a.id - b.id);
  const selected = matches.slice(0, query.maxLakes);
  return civilizationNaturalEarthLakesOutputSchema.parse({
    schemaVersion: "civilization_natural_earth_lakes/v1", query,
    source: {
      sourceId: "natural_earth_50m_lakes", sourceArchiveUrl: source.sourceArchiveUrl,
      sourcePageUrl: source.sourcePageUrl, sourceArchiveSha256: SOURCE_SHA256,
      datasetVersion: "5.0.0", snapshotAcquiredAt: source.acquiredAt, readAt,
      licenseId: "Public Domain", licenseUrl: source.licenseUrl,
      spatialScale: "1:50m generalized cartography", sourceEffectiveAt: null,
    },
    coverage: {
      sourceFeatures: source.features.length, matchingBboxCandidates: matches.length,
      returnedLakes: selected.length, possiblyTruncated: matches.length > selected.length,
      spatialSelection: "feature_bbox_intersection_only",
      missingEvidence: [
        "generalized_lakes_omit_smaller_waterbodies", "source_effective_shoreline_date_unknown",
        "current_lake_extent_level_and_water_quality_unmeasured", "water_rights_ecology_and_community_effects_unassessed",
        "aral_sea_outline_may_exceed_current_extent_per_source",
        ...(matches.length > selected.length ? ["additional_bbox_candidates_not_returned"] : []),
        ...(matches.length === 0 ? ["no_source_candidate_does_not_prove_absence_of_lake"] : []),
      ],
    },
    lakes: selected.map((feature) => ({
      featureId: feature.id, label: feature.nameEn ?? feature.name ?? `Lake ${feature.id}`,
      featureClass: feature.featureClass, scaleRank: feature.scaleRank, minZoom: feature.minZoom,
      bbox: feature.bbox, geometry: feature.geometry, sourceRecordUrl: source.sourceArchiveUrl,
      sourceEffectiveAt: null,
      interpretation: "generalized_lake_depiction_not_current_shoreline_or_impact_assessment",
    })),
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  });
}
