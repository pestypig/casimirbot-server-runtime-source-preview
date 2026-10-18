import { z } from "zod";
import polygonData from "../../assets/civilization/natural-earth-50m-country-polygons.v1.json";
import { segmentContact } from "./route-boundary-line-review";
import { screenCountryDepictionCandidates } from "./natural-earth-country-candidates";

type Point = { lat: number; lon: number };
type Ring = number[][];
type Polygon = Ring[];
type PolygonEntry = { sourceFeatureId: string; polygons: Polygon[] };
const asset = polygonData as { schemaVersion: string; sourceArchiveSha256: string;
  coordinateOrder: string; entries: PolygonEntry[] };
if (asset.schemaVersion !== "civilization_natural_earth_50m_country_polygons/v1" ||
    asset.coordinateOrder !== "longitude_latitude_wgs84" || asset.entries.length !== 242) {
  throw new Error("Natural Earth polygon asset metadata is invalid");
}
const byFeatureId = new Map(asset.entries.map((entry) => [entry.sourceFeatureId, entry]));
if (byFeatureId.size !== asset.entries.length) throw new Error("Natural Earth polygon feature IDs are not unique");

const MAX_COMPARISONS = 2_000_000;

export const civilizationCountryGeometryScreenSchema = z.object({
  status: z.literal("source_depiction_geometry_screen"),
  method: z.literal("planar_polyline_against_natural_earth_50m_polygon_rings"),
  sourceRecordUrl: z.string().url(),
  sourceArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  contacts: z.array(z.object({
    editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/), isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
    name: z.string(), sourceFeatureId: z.string(),
    boundaryContactSegments: z.number().int().nonnegative(),
    interiorSegments: z.number().int().nonnegative(),
  }).strict()),
  bboxCandidatesRejected: z.array(z.string().min(1)),
  indeterminateFeatureIds: z.array(z.string().min(1)),
  comparisons: z.number().int().nonnegative(),
  possiblyTruncated: z.boolean(),
  antimeridianReviewNeeded: z.boolean(),
  missingEvidence: z.array(z.string()),
}).strict();
export type CivilizationCountryGeometryScreen = z.infer<typeof civilizationCountryGeometryScreenSchema>;

export const civilizationCountryDepictionPointSchema = z.object({
  point: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
  sourceRecordUrl: z.string().url(), sourceArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  contacts: z.array(z.object({ editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/),
    isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(), name: z.string(), sourceFeatureId: z.string(),
    relation: z.enum(["inside_depiction", "boundary_contact"]),
  }).strict()),
  indeterminateFeatureIds: z.array(z.string()),
  interpretation: z.literal("A snapped OSM endpoint compared with generalized editorial polygons does not establish legal jurisdiction, ownership, a surveyed endpoint, or permission; absent or ambiguous contacts are not exclusions."),
}).strict();
export type CivilizationCountryDepictionPoint = z.infer<typeof civilizationCountryDepictionPointSchema>;

function pointInRing(point: Point, ring: Ring): boolean {
  let inside = false;
  for (let index = 0, priorIndex = ring.length - 1; index < ring.length; priorIndex = index++) {
    const [x1, y1] = ring[priorIndex];
    const [x2, y2] = ring[index];
    if ((y1 > point.lat) !== (y2 > point.lat) &&
        point.lon < (x2 - x1) * (point.lat - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Point, polygon: Polygon): boolean {
  return !!polygon.length && pointInRing(point, polygon[0]) &&
    !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function ringCrossesAntimeridian(ring: Ring): boolean {
  return ring.some((vertex, index) => Math.abs(vertex[0] - ring[(index + 1) % ring.length][0]) > 180);
}

function pointOnRing(point: Point, ring: Ring): boolean {
  return ring.some((first, index) => {
    const second = ring[(index + 1) % ring.length];
    const cross = (point.lon - first[0]) * (second[1] - first[1]) -
      (point.lat - first[1]) * (second[0] - first[0]);
    return Math.abs(cross) <= 1e-9 && point.lon >= Math.min(first[0], second[0]) - 1e-9 &&
      point.lon <= Math.max(first[0], second[0]) + 1e-9 &&
      point.lat >= Math.min(first[1], second[1]) - 1e-9 && point.lat <= Math.max(first[1], second[1]) + 1e-9;
  });
}

/** Snapped map-node point against editorial depictions, not a legal border or endpoint survey. */
export function screenCountryDepictionPoint(point: Point): CivilizationCountryDepictionPoint {
  const shortlist = screenCountryDepictionCandidates([point, point]);
  if (asset.sourceArchiveSha256 !== shortlist.source.sourceArchiveSha256) {
    throw new Error("Natural Earth polygon and bounding-box assets have different source archives");
  }
  const contacts: CivilizationCountryDepictionPoint["contacts"] = [];
  const indeterminateFeatureIds: string[] = [];
  for (const candidate of shortlist.candidates) {
    const feature = byFeatureId.get(candidate.sourceFeatureId);
    if (!feature) throw new Error(`Natural Earth polygon missing feature ${candidate.sourceFeatureId}`);
    let boundary = false;
    let inside = false;
    let indeterminate = false;
    for (const polygon of feature.polygons) {
      if (!overlaps([point.lon, point.lat, point.lon, point.lat], ringBox(polygon[0]))) continue;
      if (polygon.some((ring) => ringCrossesAntimeridian(ring))) { indeterminate = true; continue; }
      if (polygon.some((ring) => pointOnRing(point, ring))) boundary = true;
      else if (pointInPolygon(point, polygon)) inside = true;
    }
    if (indeterminate) indeterminateFeatureIds.push(candidate.sourceFeatureId);
    if (boundary || inside) contacts.push({ editorialAdm0A3: candidate.editorialAdm0A3,
      isoA3: candidate.isoA3, name: candidate.name, sourceFeatureId: candidate.sourceFeatureId,
      relation: boundary ? "boundary_contact" : "inside_depiction" });
  }
  return civilizationCountryDepictionPointSchema.parse({ point,
    sourceRecordUrl: shortlist.source.sourceRecordUrl,
    sourceArchiveSha256: shortlist.source.sourceArchiveSha256,
    contacts, indeterminateFeatureIds,
    interpretation: "A snapped OSM endpoint compared with generalized editorial polygons does not establish legal jurisdiction, ownership, a surveyed endpoint, or permission; absent or ambiguous contacts are not exclusions." });
}

function overlaps(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function ringBox(ring: Ring): [number, number, number, number] {
  return ring.reduce<[number, number, number, number]>((box, point) => [
    Math.min(box[0], point[0]), Math.min(box[1], point[1]),
    Math.max(box[2], point[0]), Math.max(box[3], point[1]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

/** A geometric contact with an editorial country depiction, not a jurisdictional finding. */
export function screenCountryDepictionGeometry(vertices: Point[]): CivilizationCountryGeometryScreen {
  const shortlist = screenCountryDepictionCandidates(vertices);
  if (asset.sourceArchiveSha256 !== shortlist.source.sourceArchiveSha256) {
    throw new Error("Natural Earth polygon and bounding-box assets have different source archives");
  }
  const segmentBoxes = vertices.slice(1).map((point, index) => {
    const prior = vertices[index];
    return [Math.min(prior.lon, point.lon), Math.min(prior.lat, point.lat),
      Math.max(prior.lon, point.lon), Math.max(prior.lat, point.lat)] as const;
  });
  let comparisons = 0;
  let limitReached = false;
  let antimeridianReviewNeeded = shortlist.antimeridianReviewNeeded;
  const contacts: CivilizationCountryGeometryScreen["contacts"] = [];
  const bboxCandidatesRejected: string[] = [];
  const indeterminateFeatureIds: string[] = [];

  for (const candidate of shortlist.candidates) {
    const feature = byFeatureId.get(candidate.sourceFeatureId);
    if (!feature) throw new Error(`Natural Earth polygon missing feature ${candidate.sourceFeatureId}`);
    const polygons = feature.polygons.map((polygon) => ({
      rings: polygon.map((ring) => ({ points: ring, box: ringBox(ring) })),
      box: ringBox(polygon[0]),
      source: polygon,
    }));
    let boundaryContactSegments = 0;
    let interiorSegments = 0;
    let indeterminate = false;
    for (let segmentIndex = 0; segmentIndex < segmentBoxes.length; segmentIndex++) {
      const segmentBox = segmentBoxes[segmentIndex];
      if (segmentBox[2] - segmentBox[0] > 180) {
        indeterminate = true;
        antimeridianReviewNeeded = true;
        continue;
      }
      const start = vertices[segmentIndex];
      const end = vertices[segmentIndex + 1];
      let boundaryContact = false;
      let interior = false;
      for (const polygon of polygons) {
        if (boundaryContact) break;
        if (!overlaps(segmentBox, polygon.box)) continue;
        for (const ring of polygon.rings) {
          if (boundaryContact) break;
          if (!overlaps(segmentBox, ring.box)) continue;
          const points = ring.points;
          const edgeCount = points.length > 1 && points[0][0] === points[points.length - 1][0] &&
            points[0][1] === points[points.length - 1][1] ? points.length - 1 : points.length;
          for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
            const first = points[edgeIndex];
            const second = points[(edgeIndex + 1) % points.length];
            if (Math.abs(first[0] - second[0]) > 180) {
              indeterminate = true;
              antimeridianReviewNeeded = true;
              continue;
            }
            comparisons++;
            if (comparisons > MAX_COMPARISONS) { limitReached = true; indeterminate = true; break; }
            if (!overlaps(segmentBox, [Math.min(first[0], second[0]), Math.min(first[1], second[1]),
              Math.max(first[0], second[0]), Math.max(first[1], second[1])])) continue;
            if (segmentContact(start, end, { lon: first[0], lat: first[1] },
              { lon: second[0], lat: second[1] })) { boundaryContact = true; break; }
          }
          if (limitReached) break;
        }
        if (limitReached) break;
        if (!indeterminate && (pointInPolygon(start, polygon.source) || pointInPolygon(end, polygon.source))) interior = true;
      }
      if (boundaryContact) boundaryContactSegments++;
      else if (interior) interiorSegments++;
      if (limitReached) break;
    }
    if (boundaryContactSegments || interiorSegments) contacts.push({
      editorialAdm0A3: candidate.editorialAdm0A3, isoA3: candidate.isoA3,
      name: candidate.name, sourceFeatureId: candidate.sourceFeatureId,
      boundaryContactSegments, interiorSegments,
    });
    else if (indeterminate) indeterminateFeatureIds.push(candidate.sourceFeatureId);
    else bboxCandidatesRejected.push(candidate.sourceFeatureId);
    if (limitReached) {
      for (const unreviewed of shortlist.candidates.slice(shortlist.candidates.indexOf(candidate) + 1)) {
        indeterminateFeatureIds.push(unreviewed.sourceFeatureId);
      }
      break;
    }
  }
  return civilizationCountryGeometryScreenSchema.parse({
    status: "source_depiction_geometry_screen",
    method: "planar_polyline_against_natural_earth_50m_polygon_rings",
    sourceRecordUrl: shortlist.source.sourceRecordUrl,
    sourceArchiveSha256: shortlist.source.sourceArchiveSha256,
    contacts, bboxCandidatesRejected, indeterminateFeatureIds, comparisons,
    possiblyTruncated: limitReached, antimeridianReviewNeeded,
    missingEvidence: ["editorial_geometry_is_not_legal_jurisdiction_or_effective_control",
      "route_width_survey_accuracy_and_transit_consent_unassessed",
      ...(limitReached ? ["geometry_comparison_limit_reached"] : []),
      ...(antimeridianReviewNeeded ? ["antimeridian_geometry_requires_separate_review"] : [])],
  });
}
