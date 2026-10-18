import { z } from "zod";
import {
  civilizationNaturalEarthLakesOutputSchema,
  type CivilizationNaturalEarthLakesEvidence,
} from "./natural-earth-lakes";
import { segmentContact } from "./route-boundary-line-review";

const MAX_CONTACTS = 150;
const MAX_COMPARISONS = 500_000;
type Point = { lat: number; lon: number };
export type LakeReviewSegment = {
  candidateId: string; segmentIndex: number; mappedEdgeId: string | null;
  start: Point; end: Point; routeEvidenceRefs: string[];
};

const contactSchema = z.object({
  candidateId: z.string().min(1), segmentIndex: z.number().int().nonnegative(),
  mappedEdgeId: z.string().nullable(), lakeFeatureId: z.number().int(), lakeLabel: z.string(),
  contactKind: z.enum(["outline_point", "outline_overlap", "inside_depiction"]),
  position: z.object({ lat: z.number(), lon: z.number() }).strict(),
  sourceRecordUrl: z.string().url(), routeEvidenceRefs: z.array(z.string()),
  interpretation: z.literal("generalized_polygon_contact_not_current_water_or_effect"),
}).strict();
export const civilizationRouteLakeReviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("no_candidate"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), errorCode: z.string(), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"), source: civilizationNaturalEarthLakesOutputSchema.shape.source,
    sourceCoverage: civilizationNaturalEarthLakesOutputSchema.shape.coverage,
    contacts: z.array(contactSchema).max(MAX_CONTACTS), possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);
export type CivilizationRouteLakeReview = z.infer<typeof civilizationRouteLakeReviewSchema>;

function pointInRing(point: Point, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    if ((a[1] > point.lat) === (b[1] > point.lat)) continue;
    if (point.lon < a[0] + (point.lat - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

function insidePolygon(point: Point, polygon: number[][][]): boolean {
  return !!polygon[0] && pointInRing(point, polygon[0]) &&
    !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function segmentOverlapsBbox(segment: LakeReviewSegment, bbox: readonly number[]): boolean {
  return Math.min(segment.start.lon, segment.end.lon) <= bbox[2] &&
    Math.max(segment.start.lon, segment.end.lon) >= bbox[0] &&
    Math.min(segment.start.lat, segment.end.lat) <= bbox[3] &&
    Math.max(segment.start.lat, segment.end.lat) >= bbox[1];
}

export function reviewLakeContacts(
  segments: LakeReviewSegment[], evidence: CivilizationNaturalEarthLakesEvidence,
): CivilizationRouteLakeReview {
  const contacts: z.infer<typeof contactSchema>[] = [];
  let comparisons = 0;
  let comparisonLimitReached = false;
  let contactLimitReached = false;
  outer: for (const segment of segments) {
    for (const lake of evidence.lakes) {
      if (!segmentOverlapsBbox(segment, lake.bbox)) continue;
      const polygons = lake.geometry.type === "Polygon"
        ? [lake.geometry.coordinates as number[][][]]
        : lake.geometry.coordinates as number[][][][];
      let contact: { kind: "outline_point" | "outline_overlap" | "inside_depiction"; position: Point } | null = null;
      for (const polygon of polygons) {
        for (const ring of polygon) {
          const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] &&
            ring[0][1] === ring[ring.length - 1][1];
          const edgeCount = closed ? ring.length - 1 : ring.length;
          for (let index = 0; index < edgeCount; index++) {
            comparisons++;
            if (comparisons > MAX_COMPARISONS) {
              comparisonLimitReached = true;
              break outer;
            }
            const hit = segmentContact(segment.start, segment.end,
              { lon: ring[index][0], lat: ring[index][1] },
              { lon: ring[(index + 1) % ring.length][0], lat: ring[(index + 1) % ring.length][1] });
            if (hit) {
              contact = { kind: hit.kind === "point" ? "outline_point" : "outline_overlap", position: hit.position };
              break;
            }
          }
          if (contact) break;
        }
        if (contact) break;
        const midpoint = { lat: (segment.start.lat + segment.end.lat) / 2,
          lon: (segment.start.lon + segment.end.lon) / 2 };
        if (insidePolygon(midpoint, polygon)) {
          contact = { kind: "inside_depiction", position: midpoint };
          break;
        }
      }
      if (!contact) continue;
      if (contacts.length >= MAX_CONTACTS) { contactLimitReached = true; break outer; }
      contacts.push({
        candidateId: segment.candidateId, segmentIndex: segment.segmentIndex,
        mappedEdgeId: segment.mappedEdgeId, lakeFeatureId: lake.featureId,
        lakeLabel: lake.label, contactKind: contact.kind, position: contact.position,
        sourceRecordUrl: lake.sourceRecordUrl, routeEvidenceRefs: segment.routeEvidenceRefs,
        interpretation: "generalized_polygon_contact_not_current_water_or_effect",
      });
    }
  }
  const possiblyTruncated = evidence.coverage.possiblyTruncated || comparisonLimitReached || contactLimitReached;
  return {
    status: "available", source: evidence.source, sourceCoverage: evidence.coverage,
    contacts, possiblyTruncated,
    missingEvidence: [
      ...evidence.coverage.missingEvidence,
      "planar_generalized_polygon_contact_not_current_shoreline_or_impact_finding",
      ...(comparisonLimitReached ? ["geometry_comparison_limit_reached"] : []),
      ...(contactLimitReached ? ["additional_lake_contacts_not_returned"] : []),
    ],
  };
}
