import { z } from "zod";
import { CIVILIZATION_TRAVERSABILITY_ROUTE_MODES } from "@shared/civilization-traversability-atlas";
import type { CivilizationBoundaryClaimV1 } from "@shared/civilization-traversability-atlas";
import {
  civilizationBoundaryEvidenceOutputSchema,
  readGeoboundariesEvidence,
  type CivilizationBoundaryEvidence,
} from "./geoboundaries-evidence";
import {
  civilizationNaturalEarthBoundaryLineOutputSchema,
  readNaturalEarthBoundaryLines,
  type CivilizationNaturalEarthBoundaryLineEvidence,
} from "./natural-earth-boundary-lines";
import {
  civilizationNaturalEarthHydrographyOutputSchema,
  readNaturalEarthHydrography,
  type CivilizationNaturalEarthHydrographyEvidence,
} from "./natural-earth-hydrography";
import { readNaturalEarthLakes, type CivilizationNaturalEarthLakesEvidence } from "./natural-earth-lakes";
import { civilizationRouteLakeReviewSchema, reviewLakeContacts } from "./route-lake-review";
import { civilizationCountryDepictionCandidateSchema, screenCountryDepictionCandidates } from "./natural-earth-country-candidates";
import { civilizationCountryGeometryScreenSchema, screenCountryDepictionGeometry } from "./natural-earth-country-geometry";
import {
  civilizationInfrastructureKindSchema,
  civilizationOsmInfrastructureOutputSchema,
  readOsmInfrastructureEvidence,
  type CivilizationOsmInfrastructureEvidence,
} from "./osm-infrastructure-evidence";
import { segmentContact } from "./route-boundary-line-review";
import { civilizationRamsarWetlandBoundaryScreenSchema, screenPilotRamsarWetlands } from "./ramsar-wetland-boundary-screen";
import { readRamsarSitesInArea, type CivilizationRamsarSitesAreaEvidence } from "./ramsar-sites-area";
import { civilizationOsmTerrestrialOutputSchema, readTiledOsmTerrestrialEvidence,
  type CivilizationOsmTerrestrialEvidence } from "./osm-terrestrial-evidence";
import { civilizationRamsarRouteReviewSchema, reviewRamsarRoute } from "./ramsar-route-review";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";
import {
  civilizationElevationPointOutputSchema,
  readUsgsElevationPointEvidence,
  type CivilizationElevationPointEvidence,
} from "./usgs-elevation-point-evidence";
import {
  civilizationEtopoReliefOutputSchema,
  readNoaaEtopoReliefEvidence,
  type CivilizationEtopoReliefEvidence,
} from "./noaa-etopo-relief-evidence";

const MAX_CONTACTS = 100;
const MAX_COMPARISONS = 500_000;
const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
type Point = z.infer<typeof pointSchema>;

export const civilizationProposedCorridorQuerySchema = z.object({
  bbox: z.tuple([
    z.number().min(-180).max(180), z.number().min(-90).max(90),
    z.number().min(-180).max(180), z.number().min(-90).max(90),
  ]),
  vertices: z.array(pointSchema).min(2).max(12),
  sketchOrigin: z.enum(["caller_supplied_sketch", "mapped_component_gap_hypothesis", "mapped_network_candidate"]).default("caller_supplied_sketch"),
  intendedUse: z.string().trim().min(3).max(120),
  contemplatedModes: z.array(z.enum(CIVILIZATION_TRAVERSABILITY_ROUTE_MODES)).max(9).default([]),
  countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).default([]),
  mappedInfrastructureKinds: z.array(civilizationInfrastructureKindSchema).max(6).default([]),
  includeTerrainPointObservations: z.boolean().default(false),
  includeGlobalReliefObservations: z.boolean().default(false),
  maxGlobalReliefSamples: z.number().int().min(2).max(12).default(12),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();
export type CivilizationProposedCorridorQuery = z.infer<typeof civilizationProposedCorridorQuerySchema>;

const contactPositionSchema = pointSchema;
const boundaryContactSchema = z.object({
  sketchSegmentIndex: z.number().int().nonnegative(),
  lineId: z.string().min(1),
  lineLabel: z.string().min(1),
  recordCategory: z.string().min(1),
  adjacentAdministrativeIso3: z.tuple([z.string().nullable(), z.string().nullable()]),
  contactKind: z.enum(["point", "overlap"]),
  position: contactPositionSchema,
  sourceRecordUrl: z.string().url(),
  sourceRevisionAt: z.string().datetime({ offset: true }),
  sourceEffectiveAt: z.null(),
  viewpointClassifications: z.record(z.string(), z.string()),
}).strict();
const hydrographyContactSchema = z.object({
  sketchSegmentIndex: z.number().int().nonnegative(),
  lineId: z.string().min(1),
  lineLabel: z.string().min(1),
  featureKind: z.enum(["river", "lake_centerline"]),
  contactKind: z.enum(["point", "overlap"]),
  position: contactPositionSchema,
  sourceRecordUrl: z.string().url(),
  sourceEffectiveAt: z.null(),
}).strict();
const administrativeContactSchema = z.object({
  sketchSegmentIndex: z.number().int().nonnegative(),
  boundaryId: z.string().min(1),
  countryIso3: z.string().regex(/^[A-Z]{3}$/),
  contactKind: z.enum(["point", "overlap"]),
  position: contactPositionSchema,
  sourceRecordUrl: z.string().url(),
  sourceYearRepresented: z.string(),
  sourceVersion: z.string(),
}).strict();
const administrativeVertexSchema = z.object({
  sketchVertexIndex: z.number().int().nonnegative(),
  relationship: z.enum(["inside_depiction", "outside_depiction", "on_outline", "unknown"]),
  boundaryId: z.string().min(1).nullable(),
  sourceRecordUrl: z.string().url().nullable(),
}).strict();
const administrativeSpanSchema = z.object({
  sketchSegmentIndex: z.number().int().nonnegative(),
  fromFraction: z.number().min(0).max(1),
  toFraction: z.number().min(0).max(1),
  start: pointSchema,
  end: pointSchema,
  relationship: z.enum(["inside_depiction", "outside_depiction", "unknown"]),
  boundaryId: z.string().min(1).nullable(),
  sourceRecordUrl: z.string().url().nullable(),
}).strict();
const infrastructureContactSchema = z.object({
  sketchSegmentIndex: z.number().int().nonnegative(),
  edgeId: z.string().min(1),
  networkKind: civilizationInfrastructureKindSchema,
  contactKind: z.enum(["point", "overlap"]),
  position: contactPositionSchema,
  sourceRecordUrl: z.string().url(),
  sourceEditedAt: z.string().datetime({ offset: true }).nullable(),
  evidenceRefs: z.array(z.string()),
}).strict();
const infrastructureSectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("area_too_large"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationOsmInfrastructureOutputSchema.shape.source,
    coverage: civilizationOsmInfrastructureOutputSchema.shape.coverage,
    contacts: z.array(infrastructureContactSchema).max(MAX_CONTACTS),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);
const terrestrialContactSchema = z.object({
  sketchSegmentIndex: z.number().int().nonnegative(), featureId: z.string().min(1),
  featureKind: civilizationOsmTerrestrialOutputSchema.shape.features.element.shape.kind,
  geometryRole: civilizationOsmTerrestrialOutputSchema.shape.features.element.shape.geometryRole,
  featureName: z.string().nullable(), relation: z.enum(["boundary_contact", "sketch_vertex_inside_depiction"]),
  contactKind: z.enum(["point", "overlap"]).nullable(), position: pointSchema,
  sourceRecordUrl: z.string().url(), sourceEditedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
const terrestrialSectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("area_too_large"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("available"), source: civilizationOsmTerrestrialOutputSchema.shape.source,
    coverage: civilizationOsmTerrestrialOutputSchema.shape.coverage,
    contacts: z.array(terrestrialContactSchema).max(MAX_CONTACTS), possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()) }).strict(),
]);
const administrativeSectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), countryIso3: z.string().regex(/^[A-Z]{3}$/), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"),
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    source: civilizationBoundaryEvidenceOutputSchema.shape.source,
    coverage: civilizationBoundaryEvidenceOutputSchema.shape.coverage,
    contacts: z.array(administrativeContactSchema).max(MAX_CONTACTS),
    vertexCoverage: z.array(administrativeVertexSchema).min(2).max(12),
    vertexCoverageMethod: z.literal("planar_point_in_polygon_with_holes"),
    spanCoverage: z.array(administrativeSpanSchema).min(1).max(150),
    spanCoverageMethod: z.literal("outline_contact_partition_and_planar_midpoint"),
    comparisons: z.number().int().nonnegative(),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);
const boundarySectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationNaturalEarthBoundaryLineOutputSchema.shape.source,
    coverage: civilizationNaturalEarthBoundaryLineOutputSchema.shape.coverage,
    contacts: z.array(boundaryContactSchema).max(MAX_CONTACTS),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);
const hydrographySectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationNaturalEarthHydrographyOutputSchema.shape.source,
    coverage: civilizationNaturalEarthHydrographyOutputSchema.shape.coverage,
    contacts: z.array(hydrographyContactSchema).max(MAX_CONTACTS),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);
const terrainSectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationElevationPointOutputSchema.shape.source,
    observations: civilizationElevationPointOutputSchema.shape.observations,
    missingEvidence: z.array(z.string()),
  }).strict(),
]);
const globalReliefSectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationEtopoReliefOutputSchema.shape.source,
    observations: civilizationEtopoReliefOutputSchema.shape.observations,
    samplePlan: z.array(z.object({
      sketchSegmentIndex: z.number().int().nonnegative(),
      segmentFraction: z.number().min(0).max(1),
      point: pointSchema,
      originalVertexIndex: z.number().int().nonnegative().nullable(),
    }).strict()).min(2).max(12),
    sampleMethod: z.literal("all_vertices_then_bisect_longest_geodesic_estimate_on_straight_wgs84_sketch_segments"),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);

export const civilizationProposedCorridorOutputSchema = z.object({
  schemaVersion: z.literal("civilization_proposed_corridor_screen/v12"),
  query: civilizationProposedCorridorQuerySchema,
  collectedAt: z.string().datetime({ offset: true }),
  geometryMethod: z.literal("straight_segments_in_wgs84_lon_lat"),
  routeFindingPerformed: z.literal(false),
  infrastructureAssumed: z.literal(false),
  sourceValidityAtEvaluation: z.literal("unverified"),
  boundaryLines: boundarySectionSchema,
  administrativeBoundaries: z.array(administrativeSectionSchema).max(2).default([]),
  countryDepictionCandidates: civilizationCountryDepictionCandidateSchema,
  countryGeometryScreen: civilizationCountryGeometryScreenSchema,
  mappedInfrastructure: infrastructureSectionSchema,
  terrestrialDepictions: terrestrialSectionSchema,
  hydrography: hydrographySectionSchema,
  lakeReview: civilizationRouteLakeReviewSchema,
  designatedWetlands: civilizationRamsarWetlandBoundaryScreenSchema,
  ramsarAreaReview: civilizationRamsarRouteReviewSchema,
  terrainPoints: terrainSectionSchema,
  globalReliefPoints: globalReliefSectionSchema,
  unresolved: z.array(z.string()),
  authority: z.object({
    assistant_answer: z.literal(false),
    terminal_eligible: z.literal(false),
    execution_permission: z.literal(false),
    policy_finality: z.literal(false),
  }).strict(),
}).strict();
export type CivilizationProposedCorridorScreen = z.infer<typeof civilizationProposedCorridorOutputSchema>;

type Readers = {
  boundaryLines?: (query: unknown) => Promise<CivilizationNaturalEarthBoundaryLineEvidence>;
  country?: (query: unknown) => Promise<CivilizationBoundaryEvidence>;
  infrastructure?: (query: unknown) => Promise<CivilizationOsmInfrastructureEvidence>;
  terrestrial?: (query: unknown) => Promise<CivilizationOsmTerrestrialEvidence>;
  hydrography?: (query: unknown) => CivilizationNaturalEarthHydrographyEvidence | Promise<CivilizationNaturalEarthHydrographyEvidence>;
  lakes?: (query: unknown) => CivilizationNaturalEarthLakesEvidence | Promise<CivilizationNaturalEarthLakesEvidence>;
  ramsarArea?: (query: unknown) => Promise<CivilizationRamsarSitesAreaEvidence>;
  terrainPoints?: (query: unknown) => Promise<CivilizationElevationPointEvidence>;
  globalReliefPoints?: (query: unknown) => Promise<CivilizationEtopoReliefEvidence>;
};

function errorCode(error: unknown): string {
  return error instanceof CivilizationGeospatialSourceError ? error.code : "source_unavailable";
}

type ReliefSample = {
  sketchSegmentIndex: number;
  segmentFraction: number;
  point: Point;
  originalVertexIndex: number | null;
};

function sphericalDistanceKm(a: Point, b: Point): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const latA = a.lat * radians;
  const latB = b.lat * radians;
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function planGlobalReliefSamples(vertices: Point[], maxSamples: number): ReliefSample[] {
  const pointAt = (segmentIndex: number, fraction: number): Point => {
    const start = vertices[segmentIndex];
    const end = vertices[segmentIndex + 1];
    return { lat: start.lat + (end.lat - start.lat) * fraction,
      lon: start.lon + (end.lon - start.lon) * fraction };
  };
  const intervalKm = (segmentIndex: number, fromFraction: number, toFraction: number): number =>
    sphericalDistanceKm(pointAt(segmentIndex, fromFraction), pointAt(segmentIndex, toFraction));
  const samples: ReliefSample[] = vertices.map((point, index) => ({
    sketchSegmentIndex: index === 0 ? 0 : index - 1,
    segmentFraction: index === 0 ? 0 : 1,
    point, originalVertexIndex: index,
  }));
  const intervals = vertices.slice(0, -1).map((_, segmentIndex) => ({
    sketchSegmentIndex: segmentIndex, fromFraction: 0, toFraction: 1,
    estimatedKm: intervalKm(segmentIndex, 0, 1),
  }));
  while (samples.length < maxSamples) {
    const longest = intervals.reduce((best, candidate) => candidate.estimatedKm > best.estimatedKm ? candidate : best);
    const fraction = (longest.fromFraction + longest.toFraction) / 2;
    samples.push({
      sketchSegmentIndex: longest.sketchSegmentIndex, segmentFraction: fraction,
      point: pointAt(longest.sketchSegmentIndex, fraction),
      originalVertexIndex: null,
    });
    intervals.splice(intervals.indexOf(longest), 1,
      { sketchSegmentIndex: longest.sketchSegmentIndex, fromFraction: longest.fromFraction,
        toFraction: fraction, estimatedKm: intervalKm(longest.sketchSegmentIndex, longest.fromFraction, fraction) },
      { sketchSegmentIndex: longest.sketchSegmentIndex, fromFraction: fraction,
        toFraction: longest.toFraction, estimatedKm: intervalKm(longest.sketchSegmentIndex, fraction, longest.toFraction) });
  }
  return samples.sort((a, b) => a.sketchSegmentIndex - b.sketchSegmentIndex || a.segmentFraction - b.segmentFraction);
}

function screenContacts<T extends { lineId: string; lineParts: Point[][] }, U>(
  vertices: Point[], lines: T[], project: (line: T, sketchSegmentIndex: number, hit: NonNullable<ReturnType<typeof segmentContact>>) => U,
): { contacts: U[]; truncated: boolean } {
  const contacts: U[] = [];
  const seen = new Set<string>();
  let comparisons = 0;
  let truncated = false;
  outer: for (let sketchSegmentIndex = 0; sketchSegmentIndex < vertices.length - 1; sketchSegmentIndex++) {
    for (const line of lines) {
      for (const part of line.lineParts) {
        for (let index = 1; index < part.length; index++) {
          if (++comparisons > MAX_COMPARISONS) { truncated = true; break outer; }
          const hit = segmentContact(vertices[sketchSegmentIndex], vertices[sketchSegmentIndex + 1], part[index - 1], part[index]);
          if (!hit) continue;
          const key = `${sketchSegmentIndex}:${line.lineId}:${hit.position.lon.toFixed(6)}:${hit.position.lat.toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (contacts.length >= MAX_CONTACTS) { truncated = true; break outer; }
          contacts.push(project(line, sketchSegmentIndex, hit));
        }
      }
    }
  }
  return { contacts, truncated };
}

function screenAdministrativeContacts(vertices: Point[], claims: CivilizationBoundaryClaimV1[]) {
  const contacts: z.infer<typeof administrativeContactSchema>[] = [];
  const seen = new Set<string>();
  let comparisons = 0;
  let truncated = false;
  let datelineEdgesSkipped = false;
  outer: for (let sketchSegmentIndex = 0; sketchSegmentIndex < vertices.length - 1; sketchSegmentIndex++) {
    const routeStart = vertices[sketchSegmentIndex];
    const routeEnd = vertices[sketchSegmentIndex + 1];
    for (const claim of claims) {
      for (const polygon of claim.polygons) {
        for (const ring of polygon) {
          if (ring.length < 2) continue;
          const closed = ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon;
          const edgeCount = closed ? ring.length - 1 : ring.length;
          for (let index = 0; index < edgeCount; index++) {
            const boundaryStart = ring[index];
            const boundaryEnd = ring[(index + 1) % ring.length];
            if (Math.abs(boundaryEnd.lon - boundaryStart.lon) > 180) {
              datelineEdgesSkipped = true;
              continue;
            }
            if (++comparisons > MAX_COMPARISONS) { truncated = true; break outer; }
            const hit = segmentContact(routeStart, routeEnd, boundaryStart, boundaryEnd);
            if (!hit) continue;
            const key = `${sketchSegmentIndex}:${claim.boundaryId}:${hit.position.lon.toFixed(6)}:${hit.position.lat.toFixed(6)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (contacts.length >= MAX_CONTACTS) { truncated = true; break outer; }
            contacts.push({
              sketchSegmentIndex, boundaryId: claim.boundaryId, countryIso3: claim.countryIso3,
              contactKind: hit.kind, position: hit.position, sourceRecordUrl: claim.sourceRecordUrl,
              sourceYearRepresented: claim.sourceYearRepresented, sourceVersion: claim.sourceVersion,
            });
          }
        }
      }
    }
  }
  return { contacts, comparisons, truncated: truncated || datelineEdgesSkipped, datelineEdgesSkipped };
}

function ringCrossesAntimeridian(ring: Point[]): boolean {
  return ring.some((point, index) => index > 0 && Math.abs(point.lon - ring[index - 1].lon) > 180) ||
    ring.length > 1 && Math.abs(ring[0].lon - ring[ring.length - 1].lon) > 180;
}

function pointOnRing(point: Point, ring: Point[]): boolean {
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const cross = (point.lon - a.lon) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lon - a.lon);
    if (Math.abs(cross) > 1e-9) continue;
    if (point.lon >= Math.min(a.lon, b.lon) - 1e-9 && point.lon <= Math.max(a.lon, b.lon) + 1e-9 &&
        point.lat >= Math.min(a.lat, b.lat) - 1e-9 && point.lat <= Math.max(a.lat, b.lat) + 1e-9) return true;
  }
  return false;
}

function pointInRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    if ((a.lat > point.lat) === (b.lat > point.lat)) continue;
    const crossingLon = a.lon + (point.lat - a.lat) * (b.lon - a.lon) / (b.lat - a.lat);
    if (point.lon < crossingLon) inside = !inside;
  }
  return inside;
}

export function screenOsmTerrestrialDepictions(
  vertices: Point[], evidence: CivilizationOsmTerrestrialEvidence,
): Extract<CivilizationProposedCorridorScreen["terrestrialDepictions"], { status: "available" }> {
  const lines = evidence.features.filter((feature) => !ringCrossesAntimeridian(feature.ring))
    .map((feature) => ({ ...feature, lineId: feature.featureId, lineParts: [feature.ring] }));
  const screened = screenContacts(vertices, lines, (feature, sketchSegmentIndex, hit) => ({
    sketchSegmentIndex, featureId: feature.featureId, featureKind: feature.kind,
    featureName: feature.name, geometryRole: feature.geometryRole, relation: "boundary_contact" as const,
    contactKind: hit.kind, position: hit.position,
    sourceRecordUrl: feature.sourceRecordUrl, sourceEditedAt: feature.sourceEditedAt,
  }));
  const contacts: z.infer<typeof terrestrialContactSchema>[] = screened.contacts;
  let vertexTruncated = false;
  outer: for (const feature of lines.filter((item) => item.geometryRole === "closed_way_area"))
    for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex++) {
    if (!pointInRing(vertices[vertexIndex], feature.ring)) continue;
    if (contacts.length >= MAX_CONTACTS) { vertexTruncated = true; break outer; }
    contacts.push({ sketchSegmentIndex: Math.min(vertexIndex, vertices.length - 2),
      featureId: feature.featureId, featureKind: feature.kind, featureName: feature.name,
      geometryRole: feature.geometryRole,
      relation: "sketch_vertex_inside_depiction", contactKind: null, position: vertices[vertexIndex],
      sourceRecordUrl: feature.sourceRecordUrl, sourceEditedAt: feature.sourceEditedAt });
  }
  return { status: "available", source: evidence.source, coverage: evidence.coverage,
    contacts, possiblyTruncated: screened.truncated || vertexTruncated || evidence.coverage.possiblyTruncated,
    missingEvidence: [...evidence.coverage.missingEvidence,
      "osm_polygon_contact_not_current_land_cover_or_verified_protected_status",
      ...(evidence.coverage.usableRelationFragments ? ["relation_fragments_screened_as_lines_not_filled_areas_or_holes"] : []),
      "legal_ecological_and_community_effects_require_independent_review",
      ...(lines.length < evidence.features.length ? ["antimeridian_terrestrial_geometry_not_compared"] : []),
      ...(screened.truncated || vertexTruncated ? ["additional_terrestrial_contacts_not_returned"] : [])] };
}

function classifyAdministrativePoint(point: Point, claims: CivilizationBoundaryClaimV1[], datelineGeometry: boolean) {
  const reference = claims[0];
  if (!reference || datelineGeometry) return {
    relationship: "unknown" as const,
    boundaryId: reference?.boundaryId ?? null,
    sourceRecordUrl: reference?.sourceRecordUrl ?? null,
  };
  for (const claim of claims) {
    for (const polygon of claim.polygons) {
      if (polygon.some((ring) => pointOnRing(point, ring))) return {
        relationship: "on_outline" as const,
        boundaryId: claim.boundaryId,
        sourceRecordUrl: claim.sourceRecordUrl,
      };
      const outerRing = polygon[0];
      if (outerRing && pointInRing(point, outerRing) &&
          !polygon.slice(1).some((hole) => pointInRing(point, hole))) return {
        relationship: "inside_depiction" as const,
        boundaryId: claim.boundaryId,
        sourceRecordUrl: claim.sourceRecordUrl,
      };
    }
  }
  return {
    relationship: "outside_depiction" as const,
    boundaryId: reference.boundaryId,
    sourceRecordUrl: reference.sourceRecordUrl,
  };
}

function screenAdministrativeVertices(vertices: Point[], claims: CivilizationBoundaryClaimV1[]) {
  const datelineGeometry = claims.some((claim) => claim.polygons.some((polygon) =>
    polygon.some(ringCrossesAntimeridian)));
  return vertices.map((point, sketchVertexIndex): z.infer<typeof administrativeVertexSchema> => ({
    sketchVertexIndex, ...classifyAdministrativePoint(point, claims, datelineGeometry),
  }));
}

function screenAdministrativeSpans(
  vertices: Point[], claims: CivilizationBoundaryClaimV1[],
  screened: ReturnType<typeof screenAdministrativeContacts>,
): z.infer<typeof administrativeSpanSchema>[] {
  const datelineGeometry = claims.some((claim) => claim.polygons.some((polygon) =>
    polygon.some(ringCrossesAntimeridian)));
  const cannotPartition = screened.truncated || datelineGeometry || claims.length === 0;
  const reference = claims[0];
  const spans: z.infer<typeof administrativeSpanSchema>[] = [];
  for (let sketchSegmentIndex = 0; sketchSegmentIndex < vertices.length - 1; sketchSegmentIndex++) {
    const start = vertices[sketchSegmentIndex];
    const end = vertices[sketchSegmentIndex + 1];
    const dx = end.lon - start.lon;
    const dy = end.lat - start.lat;
    const lengthSquared = dx * dx + dy * dy;
    const contacts = screened.contacts.filter((contact) => contact.sketchSegmentIndex === sketchSegmentIndex);
    const overlapsOutline = contacts.some((contact) => contact.contactKind === "overlap");
    const fraction = (point: Point) => Math.max(0, Math.min(1,
      ((point.lon - start.lon) * dx + (point.lat - start.lat) * dy) / lengthSquared));
    const interiorCuts = cannotPartition || overlapsOutline ? [] : contacts
      .map((contact) => fraction(contact.position))
      .filter((value) => value > 1e-9 && value < 1 - 1e-9)
      .sort((a, b) => a - b)
      .filter((value, index, all) => index === 0 || value - all[index - 1] > 1e-9);
    const cuts = [0, ...interiorCuts, 1];
    const interpolate = (t: number): Point => ({ lat: start.lat + t * dy, lon: start.lon + t * dx });
    for (let index = 1; index < cuts.length; index++) {
      const fromFraction = cuts[index - 1];
      const toFraction = cuts[index];
      if (toFraction - fromFraction <= 1e-9) continue;
      const midpoint = interpolate((fromFraction + toFraction) / 2);
      const classification = cannotPartition || overlapsOutline
        ? { relationship: "unknown" as const, boundaryId: reference?.boundaryId ?? null,
          sourceRecordUrl: reference?.sourceRecordUrl ?? null }
        : classifyAdministrativePoint(midpoint, claims, datelineGeometry);
      spans.push({
        sketchSegmentIndex, fromFraction, toFraction,
        start: interpolate(fromFraction), end: interpolate(toFraction),
        relationship: classification.relationship === "on_outline" ? "unknown" : classification.relationship,
        boundaryId: classification.boundaryId, sourceRecordUrl: classification.sourceRecordUrl,
      });
    }
  }
  return spans;
}

export async function readProposedCorridorScreen(input: unknown, readers: Readers = {}): Promise<CivilizationProposedCorridorScreen> {
  const parsed = civilizationProposedCorridorQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Proposed corridor screen query is invalid.");
  const query = parsed.data;
  if (new Set(query.countryIso3s).size !== query.countryIso3s.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Country selections must be unique.");
  }
  if (new Set(query.mappedInfrastructureKinds).size !== query.mappedInfrastructureKinds.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Mapped infrastructure kinds must be unique.");
  }
  if (query.includeGlobalReliefObservations && query.maxGlobalReliefSamples < query.vertices.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Global relief sample limit must cover every sketch vertex.");
  }
  const [west, south, east, north] = query.bbox;
  if (west >= east || south >= north || east - west > 5 || north - south > 5 ||
      query.vertices.some((point) => point.lon < west || point.lon > east || point.lat < south || point.lat > north) ||
      query.vertices.some((point, index) => index > 0 && point.lon === query.vertices[index - 1].lon && point.lat === query.vertices[index - 1].lat)) {
    throw new CivilizationGeospatialSourceError("invalid_bbox", "Use a non-degenerate sketch within a 5° by 5° area that does not cross the date line.");
  }
  const infrastructureRequested = query.mappedInfrastructureKinds.length > 0;
  const infrastructureAreaValid = east - west <= 1 && north - south <= 1;
  const terrestrialAreaValid = east - west <= 1 && north - south <= 1;
  const countryDepictionCandidates = screenCountryDepictionCandidates(query.vertices);
  const countryGeometryScreen = screenCountryDepictionGeometry(query.vertices);
  const globalReliefSamplePlan = query.includeGlobalReliefObservations
    ? planGlobalReliefSamples(query.vertices, query.maxGlobalReliefSamples) : [];
  const [boundaryResult, hydrographyResult, lakeResult, infrastructureResult, terrestrialResult, terrainResult, globalReliefResult, ramsarResult, ...countryResults] = await Promise.allSettled([
    Promise.resolve().then(() => (readers.boundaryLines ?? readNaturalEarthBoundaryLines)({ bbox: query.bbox, maxLines: 75 })),
    Promise.resolve().then(() => (readers.hydrography ?? readNaturalEarthHydrography)({ bbox: query.bbox, maxLines: 100 })),
    Promise.resolve().then(() => (readers.lakes ?? readNaturalEarthLakes)({ bbox: query.bbox, maxLakes: 100 })),
    infrastructureRequested && infrastructureAreaValid
      ? Promise.resolve().then(() => (readers.infrastructure ?? readOsmInfrastructureEvidence)({
        bbox: query.bbox, kinds: query.mappedInfrastructureKinds, maxWays: 200,
      })) : Promise.resolve(null),
    terrestrialAreaValid
      ? Promise.resolve().then(() => (readers.terrestrial ?? readTiledOsmTerrestrialEvidence)({ bbox: query.bbox, maxWays: 100 }))
      : Promise.resolve(null),
    query.includeTerrainPointObservations
      ? Promise.resolve().then(() => (readers.terrainPoints ?? readUsgsElevationPointEvidence)({ points: query.vertices }))
      : Promise.resolve(null),
    query.includeGlobalReliefObservations
      ? Promise.resolve().then(() => (readers.globalReliefPoints ?? readNoaaEtopoReliefEvidence)({
        points: globalReliefSamplePlan.map((sample) => sample.point),
      }))
      : Promise.resolve(null),
    Promise.resolve().then(() => (readers.ramsarArea ?? readRamsarSitesInArea)({ bbox: query.bbox, maxFeatures: 30 })),
    ...query.countryIso3s.map((countryIso3) => Promise.resolve().then(() =>
      (readers.country ?? readGeoboundariesEvidence)({ countryIso3 }))),
  ]);
  const administrativeBoundaries: CivilizationProposedCorridorScreen["administrativeBoundaries"] =
    countryResults.map((result, index) => {
      const countryIso3 = query.countryIso3s[index];
      if (result.status === "rejected") return {
        status: "unavailable", countryIso3, errorCode: errorCode(result.reason),
        missingEvidence: ["selected_administrative_boundary_source_unavailable"],
      };
      const evidence = result.value as CivilizationBoundaryEvidence;
      const claims = evidence.atlas.boundaryClaims ?? [];
      const screened = screenAdministrativeContacts(query.vertices, claims);
      const vertexCoverage = screenAdministrativeVertices(query.vertices, claims);
      const spanCoverage = screenAdministrativeSpans(query.vertices, claims, screened);
      return {
        status: "available", countryIso3, source: evidence.source, coverage: evidence.coverage,
        contacts: screened.contacts, comparisons: screened.comparisons, possiblyTruncated: screened.truncated,
        vertexCoverage, vertexCoverageMethod: "planar_point_in_polygon_with_holes",
        spanCoverage, spanCoverageMethod: "outline_contact_partition_and_planar_midpoint",
        missingEvidence: [
          ...evidence.coverage.missingEvidence,
          "administrative_depiction_contact_not_legal_border_crossing",
          "sovereignty_effective_control_and_permission_unassessed",
          "unselected_countries_not_assessed_by_this_geoboundaries_source",
          "planar_contact_has_no_survey_accuracy_guarantee",
          "vertex_inside_depiction_is_not_jurisdiction_or_permission",
          "span_coverage_is_cartographic_depiction_not_legal_jurisdiction",
          "span_midpoint_classification_has_no_survey_accuracy_guarantee",
          ...(spanCoverage.some((item) => item.relationship === "unknown") ? ["administrative_span_classification_incomplete"] : []),
          "source_polygon_topology_not_independently_validated",
          ...(vertexCoverage.some((item) => item.relationship === "unknown") ? ["vertex_coverage_unknown_for_antimeridian_or_missing_polygon"] : []),
          ...(screened.datelineEdgesSkipped ? ["antimeridian_boundary_edges_not_compared"] : []),
          ...(screened.truncated ? ["administrative_contact_comparison_incomplete"] : []),
        ],
      };
    });
  const mappedInfrastructure: CivilizationProposedCorridorScreen["mappedInfrastructure"] = !infrastructureRequested
    ? { status: "not_requested", missingEvidence: ["mapped_infrastructure_inventory_not_requested"] }
    : !infrastructureAreaValid
      ? { status: "area_too_large", missingEvidence: ["overpass_one_degree_inventory_limit", "mapped_infrastructure_contact_not_assessed"] }
      : infrastructureResult.status === "rejected"
        ? { status: "unavailable", errorCode: errorCode(infrastructureResult.reason), missingEvidence: ["mapped_infrastructure_source_unavailable"] }
        : (() => {
          const evidence = infrastructureResult.value as CivilizationOsmInfrastructureEvidence;
          const lines = (evidence.atlas.infrastructureEdges ?? []).map((edge) => ({
            ...edge, lineId: edge.edgeId, lineParts: [edge.coordinates],
          }));
          const screened = screenContacts(query.vertices, lines, (edge, sketchSegmentIndex, hit) => ({
            sketchSegmentIndex, edgeId: edge.edgeId, networkKind: edge.networkKind,
            contactKind: hit.kind, position: hit.position, sourceRecordUrl: edge.sourceRecordUrl,
            sourceEditedAt: edge.sourceEditedAt ?? null, evidenceRefs: edge.evidenceRefs,
          }));
          return {
            status: "available" as const, source: evidence.source, coverage: evidence.coverage,
            contacts: screened.contacts as z.infer<typeof infrastructureContactSchema>[],
            possiblyTruncated: screened.truncated || evidence.coverage.possiblyTruncated,
            missingEvidence: [
              ...evidence.coverage.missingEvidence,
              "mapped_way_contact_does_not_verify_asset_operation_or_connection",
              "capacity_ownership_permission_and_transfer_compatibility_unassessed",
              "other_unmapped_or_unselected_infrastructure_unassessed",
              ...(screened.truncated ? ["additional_mapped_way_contacts_not_returned"] : []),
            ],
          };
        })();
  const terrestrialDepictions: CivilizationProposedCorridorScreen["terrestrialDepictions"] = !terrestrialAreaValid
    ? { status: "area_too_large", missingEvidence: ["osm_terrestrial_one_degree_tiled_inventory_limit",
        "forest_and_protected_area_depictions_not_screened"] }
    : terrestrialResult.status === "rejected"
      ? { status: "unavailable", errorCode: errorCode(terrestrialResult.reason),
          missingEvidence: ["osm_terrestrial_source_unavailable", "forest_and_protected_area_depictions_not_screened"] }
      : screenOsmTerrestrialDepictions(query.vertices, terrestrialResult.value as CivilizationOsmTerrestrialEvidence);
  const boundaryLines: CivilizationProposedCorridorScreen["boundaryLines"] = boundaryResult.status === "rejected"
    ? { status: "unavailable", errorCode: errorCode(boundaryResult.reason), missingEvidence: ["boundary_line_source_unavailable"] }
    : (() => {
      const evidence = boundaryResult.value;
      const screened = screenContacts(query.vertices, evidence.atlas.boundaryLineAssertions ?? [], (line, sketchSegmentIndex, hit) => ({
        sketchSegmentIndex, lineId: line.lineId, lineLabel: line.label, recordCategory: line.recordCategory,
        adjacentAdministrativeIso3: line.adjacentAdministrativeIso3,
        contactKind: hit.kind, position: hit.position, sourceRecordUrl: line.sourceRecordUrl,
        sourceRevisionAt: line.sourceRevisionAt, sourceEffectiveAt: null,
        viewpointClassifications: line.viewpointClassifications,
      }));
      return {
        status: "available" as const, source: evidence.source, coverage: evidence.coverage,
        contacts: screened.contacts,
        possiblyTruncated: screened.truncated || evidence.coverage.possiblyTruncated,
        missingEvidence: [...evidence.coverage.missingEvidence, "editorial_line_contact_not_legal_crossing",
          "other_boundary_sources_and_effective_control_unassessed",
          ...(screened.truncated ? ["additional_boundary_contacts_not_returned"] : [])],
      };
    })();
  const hydrography: CivilizationProposedCorridorScreen["hydrography"] = hydrographyResult.status === "rejected"
    ? { status: "unavailable", errorCode: errorCode(hydrographyResult.reason), missingEvidence: ["hydrography_source_unavailable"] }
    : (() => {
      const evidence = hydrographyResult.value;
      const screened = screenContacts(query.vertices, evidence.atlas.hydrographicLines ?? [], (line, sketchSegmentIndex, hit) => ({
        sketchSegmentIndex, lineId: line.lineId, lineLabel: line.label, featureKind: line.featureKind,
        contactKind: hit.kind, position: hit.position, sourceRecordUrl: line.sourceRecordUrl, sourceEffectiveAt: null,
      }));
      return {
        status: "available" as const, source: evidence.source, coverage: evidence.coverage,
        contacts: screened.contacts,
        possiblyTruncated: screened.truncated || evidence.coverage.possiblyTruncated,
        missingEvidence: [...evidence.coverage.missingEvidence, "cartographic_water_contact_not_crossing_design",
          "discharge_seasonality_navigability_and_water_rights_unassessed",
          ...(screened.truncated ? ["additional_hydrography_contacts_not_returned"] : [])],
      };
    })();
  const lakeReview: CivilizationProposedCorridorScreen["lakeReview"] = lakeResult.status === "rejected"
    ? { status: "unavailable", errorCode: errorCode(lakeResult.reason),
      missingEvidence: ["lake_source_unavailable", "lake_outline_contacts_unassessed"] }
    : reviewLakeContacts(query.vertices.slice(0, -1).map((start, segmentIndex) => ({
      candidateId: query.sketchOrigin, segmentIndex, mappedEdgeId: null,
      start, end: query.vertices[segmentIndex + 1], routeEvidenceRefs: [],
    })), lakeResult.value);
  const ramsarAreaReview: CivilizationProposedCorridorScreen["ramsarAreaReview"] = ramsarResult.status === "rejected"
    ? { status: "unavailable", errorCode: errorCode(ramsarResult.reason),
      missingEvidence: ["ramsar_area_source_unavailable", "published_site_alignment_contact_unassessed"] }
    : reviewRamsarRoute(query.vertices, ramsarResult.value as CivilizationRamsarSitesAreaEvidence);
  const terrainPoints: CivilizationProposedCorridorScreen["terrainPoints"] = !query.includeTerrainPointObservations
    ? { status: "not_requested", missingEvidence: ["terrain_point_observations_not_requested"] }
    : terrainResult.status === "rejected"
      ? { status: "unavailable", errorCode: errorCode(terrainResult.reason), missingEvidence: ["usgs_elevation_point_source_unavailable"] }
      : (() => {
        const evidence = terrainResult.value as CivilizationElevationPointEvidence;
        const aligned = evidence.observations.length === query.vertices.length &&
          evidence.observations.every((observation, index) =>
            observation.pointIndex === index &&
            Math.abs(observation.point.lat - query.vertices[index].lat) < 0.000000001 &&
            Math.abs(observation.point.lon - query.vertices[index].lon) < 0.000000001);
        if (!aligned) return { status: "unavailable" as const, errorCode: "sample_alignment_invalid",
          missingEvidence: ["usgs_elevation_sample_alignment_unverified"] };
        return { status: "available" as const, source: evidence.source,
          observations: evidence.observations, missingEvidence: evidence.missingEvidence };
      })();
  const globalReliefPoints: CivilizationProposedCorridorScreen["globalReliefPoints"] = !query.includeGlobalReliefObservations
    ? { status: "not_requested", missingEvidence: ["global_relief_point_observations_not_requested"] }
    : globalReliefResult.status === "rejected"
      ? { status: "unavailable", errorCode: errorCode(globalReliefResult.reason), missingEvidence: ["noaa_etopo_grid_source_unavailable"] }
      : (() => {
        const evidence = globalReliefResult.value as CivilizationEtopoReliefEvidence;
        const aligned = evidence.observations.length === globalReliefSamplePlan.length &&
          evidence.observations.every((observation, index) =>
            observation.pointIndex === index &&
            Math.abs(observation.requestedPoint.lat - globalReliefSamplePlan[index].point.lat) < 0.000000001 &&
            Math.abs(observation.requestedPoint.lon - globalReliefSamplePlan[index].point.lon) < 0.000000001);
        if (!aligned) return { status: "unavailable" as const, errorCode: "sample_alignment_invalid",
          missingEvidence: ["noaa_etopo_sample_alignment_unverified"] };
        return { status: "available" as const, source: evidence.source,
          observations: evidence.observations, samplePlan: globalReliefSamplePlan,
          sampleMethod: "all_vertices_then_bisect_longest_geodesic_estimate_on_straight_wgs84_sketch_segments" as const,
          missingEvidence: [...evidence.missingEvidence,
            "relief_between_sampled_cells_and_local_extrema_unassessed",
            ...(query.vertices.length === query.maxGlobalReliefSamples ? ["sample_budget_exhausted_by_sketch_vertices_no_interior_cells"] : [])] };
      })();
  return civilizationProposedCorridorOutputSchema.parse({
    schemaVersion: "civilization_proposed_corridor_screen/v12",
    query, collectedAt: new Date().toISOString(), geometryMethod: "straight_segments_in_wgs84_lon_lat",
    routeFindingPerformed: false, infrastructureAssumed: false, sourceValidityAtEvaluation: "unverified",
    boundaryLines, administrativeBoundaries, countryDepictionCandidates, countryGeometryScreen,
    mappedInfrastructure, terrestrialDepictions, hydrography, lakeReview,
    designatedWetlands: screenPilotRamsarWetlands(query.vertices, query.sketchOrigin),
    ramsarAreaReview, terrainPoints, globalReliefPoints,
    unresolved: [...new Set([
      "sketch_is_not_an_optimized_or_engineered_route", "between_point_terrain_and_land_cover_unassessed",
      "infrastructure_existences_connections_and_capacity_unassessed", "construction_feasibility_and_cost_unassessed",
      "jurisdictional_permission_treaties_and_effective_control_unassessed",
      "environmental_impact_and_protected_areas_unassessed", "source_validity_at_evaluation_unverified",
      ...(administrativeBoundaries.length === 0 ? ["administrative_countries_not_selected"] : []),
      ...administrativeBoundaries.flatMap((section) => section.missingEvidence),
      ...countryDepictionCandidates.missingEvidence, ...countryGeometryScreen.missingEvidence,
      ...mappedInfrastructure.missingEvidence, ...terrestrialDepictions.missingEvidence,
      ...boundaryLines.missingEvidence, ...hydrography.missingEvidence, ...lakeReview.missingEvidence,
      ...ramsarAreaReview.missingEvidence,
      ...terrainPoints.missingEvidence, ...globalReliefPoints.missingEvidence,
    ])],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  });
}
