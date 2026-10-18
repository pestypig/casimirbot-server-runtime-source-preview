import { z } from "zod";
import snapshot from "../../assets/civilization/ramsar-pilot-boundaries.v1.json";
import { segmentContact } from "./route-boundary-line-review";

type Point = { lat: number; lon: number };
type AlignmentOrigin = "caller_supplied_sketch" | "mapped_network_candidate" | "mapped_component_gap_hypothesis";
const coordinateSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const featureSchema = z.object({
  siteNumber: z.number().int().positive(), countryIso3: z.enum(["ARM", "AZE"]),
  name: z.string().min(1), sourceFeatureId: z.string().min(1),
  geometry: z.object({ type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(coordinateSchema).min(4)).min(1)).min(1),
  }).strict(),
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal("civilization_ramsar_pilot_boundaries/v1"),
  sourcePublisher: z.literal("Ramsar Sites Information Service"),
  sourceUrl: z.string().url(), sourceLayer: z.literal("ramsar_sdi:features_published"),
  sourceLicenseUrl: z.string().url(), sourceLicense: z.string().min(1),
  acquiredAt: z.string().datetime({ offset: true }), rawResponseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  querySiteNumbers: z.array(z.number().int().positive()),
  missingBoundarySiteNumbers: z.array(z.number().int().positive()),
  coordinateReferenceSystem: z.literal("EPSG:4326 GeoJSON longitude-latitude"),
  features: z.array(featureSchema), interpretationLimit: z.string().min(1),
}).strict().superRefine((value, context) => {
  const expected = [620, 621, 1075, 1076, 1989];
  const found = new Set(value.features.map((feature) => feature.siteNumber));
  if (JSON.stringify(value.querySiteNumbers) !== JSON.stringify(expected) ||
      JSON.stringify(value.missingBoundarySiteNumbers) !== JSON.stringify(expected.filter((id) => !found.has(id)))) {
    context.addIssue({ code: "custom", message: "Pilot site coverage does not match the source response." });
  }
  for (const feature of value.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          context.addIssue({ code: "custom", message: `Unclosed ring in ${feature.sourceFeatureId}.` });
        }
      }
    }
  }
});
const data = snapshotSchema.parse(snapshot);

export const civilizationRamsarMapOverlaySchema = z.object({
  schemaVersion: z.literal("civilization_ramsar_map_overlay/v1"),
  coverageScope: z.literal("five_armenia_azerbaijan_pilot_ramsar_sites_only"),
  source: z.object({ url: z.string().url(), licenseUrl: z.string().url(),
    acquiredAt: z.string().datetime({ offset: true }), rawResponseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    missingBoundarySiteNumbers: z.array(z.number().int().positive()),
    geometryEffectiveAt: z.null(), interpretationLimit: z.string() }).strict(),
  geojson: z.object({ type: z.literal("FeatureCollection"), features: z.array(z.object({
    type: z.literal("Feature"), id: z.string(),
    properties: featureSchema.pick({ siteNumber: true, countryIso3: true, name: true, sourceFeatureId: true }),
    geometry: featureSchema.shape.geometry,
  }).strict()) }).strict(),
}).strict();

export function readPilotRamsarMapOverlay() {
  return civilizationRamsarMapOverlaySchema.parse({
    schemaVersion: "civilization_ramsar_map_overlay/v1",
    coverageScope: "five_armenia_azerbaijan_pilot_ramsar_sites_only",
    source: { url: data.sourceUrl, licenseUrl: data.sourceLicenseUrl,
      acquiredAt: data.acquiredAt, rawResponseSha256: data.rawResponseSha256,
      missingBoundarySiteNumbers: data.missingBoundarySiteNumbers,
      geometryEffectiveAt: null, interpretationLimit: data.interpretationLimit },
    geojson: { type: "FeatureCollection", features: data.features.map((feature) => ({
      type: "Feature", id: feature.sourceFeatureId,
      properties: { siteNumber: feature.siteNumber, countryIso3: feature.countryIso3,
        name: feature.name, sourceFeatureId: feature.sourceFeatureId },
      geometry: feature.geometry,
    })) },
  });
}

const siteSchema = z.object({
  siteNumber: z.number().int().positive(), countryIso3: z.enum(["ARM", "AZE"]), name: z.string(),
  boundaryStatus: z.enum(["available", "not_in_source_response"]),
  relation: z.enum(["intersects_published_depiction", "no_contact_in_published_depiction", "unknown_no_boundary"]),
  sourceFeatureIds: z.array(z.string()), alignmentSegmentIndices: z.array(z.number().int().nonnegative()),
}).strict();
export const civilizationRamsarWetlandBoundaryScreenSchema = z.object({
  schemaVersion: z.literal("civilization_ramsar_wetland_boundary_screen/v2"),
  coverageScope: z.literal("five_armenia_azerbaijan_pilot_ramsar_sites_only"),
  alignmentOrigin: z.enum(["caller_supplied_sketch", "mapped_network_candidate", "mapped_component_gap_hypothesis"]),
  source: z.object({ publisher: z.literal("Ramsar Sites Information Service"),
    url: z.string().url(), layer: z.literal("ramsar_sdi:features_published"),
    acquiredAt: z.string().datetime({ offset: true }), rawResponseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    license: z.string(), licenseUrl: z.string().url(), geometryEffectiveAt: z.null(),
  }).strict(),
  geometryMethod: z.literal("straight_wgs84_alignment_vs_planar_published_multipolygons"),
  sites: z.array(siteSchema).length(5),
  missingEvidence: z.array(z.string()),
  interpretationLimit: z.string(),
}).strict();
export type CivilizationRamsarWetlandBoundaryScreen = z.infer<typeof civilizationRamsarWetlandBoundaryScreenSchema>;

function inRing(point: Point, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point.lat) !== (yj > point.lat) &&
        point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(point: Point, polygon: [number, number][][]): boolean {
  return inRing(point, polygon[0]) && !polygon.slice(1).some((hole) => inRing(point, hole));
}

const indexedFeatures = data.features.map((feature) => {
  const points = feature.geometry.coordinates.flat(2);
  return { feature, bounds: {
    west: Math.min(...points.map((point) => point[0])), east: Math.max(...points.map((point) => point[0])),
    south: Math.min(...points.map((point) => point[1])), north: Math.max(...points.map((point) => point[1])),
  } };
});

function segmentTouchesFeature(a: Point, b: Point, indexed: typeof indexedFeatures[number]): boolean {
  const { feature, bounds } = indexed;
  if (Math.max(a.lon, b.lon) < bounds.west || Math.min(a.lon, b.lon) > bounds.east ||
      Math.max(a.lat, b.lat) < bounds.south || Math.min(a.lat, b.lat) > bounds.north) return false;
  const geometry = feature.geometry;
  for (const polygon of geometry.coordinates) {
    if (inPolygon(a, polygon) || inPolygon(b, polygon)) return true;
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        if (segmentContact(a, b, { lon: ring[i - 1][0], lat: ring[i - 1][1] },
          { lon: ring[i][0], lat: ring[i][1] })) return true;
      }
    }
  }
  return false;
}

export function screenPilotRamsarWetlands(vertices: Point[], alignmentOrigin: AlignmentOrigin): CivilizationRamsarWetlandBoundaryScreen {
  const labels = new Map<number, { countryIso3: "ARM" | "AZE"; name: string }>([
    [620, { countryIso3: "ARM", name: "Lake Sevan" }],
    [621, { countryIso3: "ARM", name: "Lake Arpi" }],
    [1075, { countryIso3: "AZE", name: "Agh-Ghol" }],
    [1076, { countryIso3: "AZE", name: "Gizil-Agaj" }],
    [1989, { countryIso3: "ARM", name: "Khor Virap Marsh" }],
  ]);
  const sites = data.querySiteNumbers.map((siteNumber) => {
    const features = indexedFeatures.filter(({ feature }) => feature.siteNumber === siteNumber);
    const segments = new Set<number>();
    for (const indexed of features) {
      for (let i = 1; i < vertices.length; i++) {
        if (segmentTouchesFeature(vertices[i - 1], vertices[i], indexed)) segments.add(i - 1);
      }
    }
    const label = labels.get(siteNumber)!;
    return {
      siteNumber, ...label,
      boundaryStatus: features.length ? "available" as const : "not_in_source_response" as const,
      relation: !features.length ? "unknown_no_boundary" as const
        : segments.size ? "intersects_published_depiction" as const : "no_contact_in_published_depiction" as const,
      sourceFeatureIds: features.map(({ feature }) => feature.sourceFeatureId),
      alignmentSegmentIndices: [...segments].sort((a, b) => a - b),
    };
  });
  return civilizationRamsarWetlandBoundaryScreenSchema.parse({
    schemaVersion: "civilization_ramsar_wetland_boundary_screen/v2",
    coverageScope: "five_armenia_azerbaijan_pilot_ramsar_sites_only",
    alignmentOrigin,
    source: { publisher: data.sourcePublisher, url: data.sourceUrl, layer: data.sourceLayer,
      acquiredAt: data.acquiredAt, rawResponseSha256: data.rawResponseSha256,
      license: data.sourceLicense, licenseUrl: data.sourceLicenseUrl, geometryEffectiveAt: null },
    geometryMethod: "straight_wgs84_alignment_vs_planar_published_multipolygons",
    sites,
    missingEvidence: ["agh_ghol_site_1075_boundary_absent_from_published_wfs_response",
      "published_geometry_effective_date_and_topology_not_independently_verified",
      "site_management_rules_ecological_impact_and_consultation_unassessed",
      "geometry_contact_or_noncontact_is_not_route_clearance",
      "other_ramsar_sites_and_protected_areas_not_screened"],
    interpretationLimit: data.interpretationLimit,
  });
}
