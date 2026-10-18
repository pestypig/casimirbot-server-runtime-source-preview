import { z } from "zod";
import indexData from "../../assets/civilization/natural-earth-50m-country-bbox-index.v1.json";

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
const entrySchema = z.object({
  editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/),
  isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
  name: z.string().min(1),
  sourceFeatureId: z.string().min(1),
  partBboxes: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).min(1),
}).strict();
const indexSchema = z.object({
  schemaVersion: z.literal("civilization_natural_earth_50m_country_bbox_index/v1"),
  generatedAt: z.string().datetime({ offset: true }),
  source: z.object({
    datasetId: z.literal("ne_50m_admin_0_countries"), datasetVersion: z.literal("5.1.1"),
    sourceUrl: z.string().url(), sourceVersionId: z.string().min(1),
    sourceArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
    licenseId: z.string(), licenseUrl: z.string().url(), editorialPolicyUrl: z.string().url(),
  }).strict(),
  method: z.string(), entries: z.array(entrySchema).length(242),
}).strict();

const index = indexSchema.parse(indexData);
const sourceRecordUrl = `${index.source.sourceUrl}?versionId=${encodeURIComponent(index.source.sourceVersionId)}`;

export const civilizationCountryDepictionCandidateSchema = z.object({
  status: z.literal("bbox_shortlist_only"),
  method: z.literal("polyline_segment_bbox_overlaps_country_polygon_part_bbox"),
  source: z.object({
    sourceRecordUrl: z.string().url(), datasetVersion: z.string(), sourceArchiveSha256: z.string(),
    depictedEntityCount: z.number().int().positive(), polygonPartCount: z.number().int().positive(),
    licenseId: z.string(), editorialPolicyUrl: z.string().url(),
  }).strict(),
  candidates: z.array(z.object({
    editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/),
    isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
    name: z.string(), sourceFeatureId: z.string(),
    possibleSegmentCount: z.number().int().positive(),
  }).strict()),
  possiblyTruncated: z.literal(false),
  antimeridianReviewNeeded: z.boolean(),
  missingEvidence: z.array(z.string()),
}).strict();
export type CivilizationCountryDepictionCandidates = z.infer<typeof civilizationCountryDepictionCandidateSchema>;

/** Over-inclusive global screening. Neither a hit nor a miss establishes jurisdiction. */
export function screenCountryDepictionCandidates(vertices: Array<{ lat: number; lon: number }>): CivilizationCountryDepictionCandidates {
  const points = z.array(pointSchema).min(2).parse(vertices);
  const segments = points.slice(1).map((point, index) => {
    const prior = points[index];
    return [Math.min(prior.lon, point.lon), Math.min(prior.lat, point.lat),
      Math.max(prior.lon, point.lon), Math.max(prior.lat, point.lat)] as const;
  });
  const antimeridianReviewNeeded = segments.some(([west, , east]) => east - west > 180);
  const candidates = index.entries.flatMap((entry) => {
    let possibleSegmentCount = 0;
    for (const [west, south, east, north] of segments) {
      if (entry.partBboxes.some(([partWest, partSouth, partEast, partNorth]) =>
        west <= partEast && east >= partWest && south <= partNorth && north >= partSouth)) {
        possibleSegmentCount++;
      }
    }
    return possibleSegmentCount ? [{
      editorialAdm0A3: entry.editorialAdm0A3, isoA3: entry.isoA3, name: entry.name,
      sourceFeatureId: entry.sourceFeatureId, possibleSegmentCount,
    }] : [];
  });
  return civilizationCountryDepictionCandidateSchema.parse({
    status: "bbox_shortlist_only", method: "polyline_segment_bbox_overlaps_country_polygon_part_bbox",
    source: { sourceRecordUrl, datasetVersion: index.source.datasetVersion,
      sourceArchiveSha256: index.source.sourceArchiveSha256,
      depictedEntityCount: index.entries.length,
      polygonPartCount: index.entries.reduce((count, entry) => count + entry.partBboxes.length, 0),
      licenseId: index.source.licenseId, editorialPolicyUrl: index.source.editorialPolicyUrl },
    candidates, possiblyTruncated: false, antimeridianReviewNeeded,
    missingEvidence: ["exact_polygon_contact_not_assessed", "legal_jurisdiction_effective_control_and_transit_consent_not_assessed",
      ...(antimeridianReviewNeeded ? ["antimeridian_segment_requires_separate_review"] : [])],
  });
}
