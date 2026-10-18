import { z } from "zod";
import {
  civilizationMappedNetworkRouteQuerySchema,
  civilizationMappedNetworkRouteOutputSchema,
  civilizationMappedNetworkGapHypothesisSchema,
  readMappedNetworkRouteOptions,
  type CivilizationMappedNetworkRouteOptions,
} from "./mapped-network-route-options";
import {
  civilizationBoundaryEvidenceOutputSchema,
  readGeoboundariesEvidence,
  type CivilizationBoundaryEvidence,
} from "./geoboundaries-evidence";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";
import { civilizationCountryDepictionCandidateSchema, screenCountryDepictionCandidates } from "./natural-earth-country-candidates";
import { civilizationCountryGeometryScreenSchema, screenCountryDepictionGeometry } from "./natural-earth-country-geometry";
import { civilizationRamsarWetlandBoundaryScreenSchema, screenPilotRamsarWetlands } from "./ramsar-wetland-boundary-screen";
import { readRamsarSitesInArea, type CivilizationRamsarSitesAreaEvidence } from "./ramsar-sites-area";
import { readNaturalEarthBoundaryLines } from "./natural-earth-boundary-lines";
import { readNaturalEarthHydrography } from "./natural-earth-hydrography";
import { readNaturalEarthLakes } from "./natural-earth-lakes";
import { readTiledOsmTerrestrialEvidence, type CivilizationOsmTerrestrialEvidence } from "./osm-terrestrial-evidence";
import { civilizationRamsarRouteReviewSchema, reviewRamsarRoute } from "./ramsar-route-review";
import {
  civilizationRouteAdministrativeBoundaryReviewSchema,
  reviewRouteAdministrativeBoundaryEncounters,
} from "./route-administrative-boundary-review";
import {
  civilizationProposedCorridorQuerySchema,
  civilizationProposedCorridorOutputSchema,
  readProposedCorridorScreen,
  screenOsmTerrestrialDepictions,
  type CivilizationProposedCorridorScreen,
} from "./proposed-corridor-screen";

const MAX_SEGMENT_RECORDS = 50;
const MAX_NETWORK_TRANSITIONS = 50;
const MAX_PIPELINE_WAYS = 50;

export const civilizationDiplomaticCorridorQuerySchema = z.object({
  question: z.string().trim().min(5).max(1000),
  route: civilizationMappedNetworkRouteQuerySchema.omit({
    includeBoundaryLineReview: true,
    includeHydrographyReview: true,
    includeLakeReview: true,
  }),
  countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).default([]),
  proposedSketch: civilizationProposedCorridorQuerySchema.pick({
    vertices: true,
    intendedUse: true,
    contemplatedModes: true,
    mappedInfrastructureKinds: true,
    includeTerrainPointObservations: true,
    includeGlobalReliefObservations: true,
    maxGlobalReliefSamples: true,
  }).optional(),
}).strict();
export type CivilizationDiplomaticCorridorQuery = z.infer<typeof civilizationDiplomaticCorridorQuerySchema>;

const sourceRecordSchema = z.object({
  sourceId: z.string().min(1),
  status: z.enum(["available", "unavailable", "not_queried_no_candidate", "not_queried_route_unavailable"]),
  sourceRecordUrl: z.string().url().nullable(),
  datasetVersion: z.string().nullable(),
  sourceTime: z.string().nullable(),
  sourceTimeMeaning: z.enum(["source_snapshot", "repository_revision", "local_acquisition", "represented_year", "unknown"]),
  retrievedAt: z.string().datetime({ offset: true }).nullable(),
  license: z.string().nullable(),
  missingEvidence: z.array(z.string()),
}).strict();

const temporalReviewSchema = z.object({
  sourceId: z.string().min(1),
  sourceTime: z.string().nullable(),
  sourceTimeMeaning: sourceRecordSchema.shape.sourceTimeMeaning,
  metadataRelationToEvaluation: z.enum(["before", "after", "same_calendar_day", "same_calendar_year", "unknown"]),
  validityAtEvaluation: z.literal("unverified"),
  limitation: z.enum([
    "source_time_unknown",
    "represented_year_not_effective_interval",
    "local_acquisition_not_observation_time",
    "metadata_time_not_feature_validity",
  ]),
}).strict();

const candidateSummarySchema = z.object({
  candidateId: z.string().min(1),
  optionIndex: z.number().int().positive(),
  generation: z.enum(["shortest_for_snapped_pair", "detour_excluding_mapped_way"]),
  pathKind: z.literal("topological_alignment"),
  claimTier: z.literal("hypothetical"),
  evaluatedAt: z.string().datetime({ offset: true }),
  networkKinds: z.array(z.string()),
  mappedDistanceKm: z.number().nonnegative(),
  originSnapDistanceKm: z.number().nonnegative(),
  destinationSnapDistanceKm: z.number().nonnegative(),
  segmentCount: z.number().int().nonnegative(),
  networkTransitionCount: z.number().int().nonnegative(),
  networkTransitions: z.array(z.object({
    alignmentSegmentIndex: z.number().int().positive(),
    fromKind: z.string().min(1), toKind: z.string().min(1), nodeRef: z.string().min(1),
    position: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
    fromSourceRecordUrl: z.string().url(), toSourceRecordUrl: z.string().url(),
    relation: z.literal("shared_osm_node_only"), facilityStatus: z.literal("unverified"),
  }).strict()).max(MAX_NETWORK_TRANSITIONS),
  networkTransitionsOmitted: z.boolean(),
  pipelineTagReview: z.object({
    status: z.enum(["not_applicable", "all_untagged", "partially_tagged", "all_tagged_same_text", "tagged_values_differ"]),
    wayCount: z.number().int().nonnegative(), untaggedWayCount: z.number().int().nonnegative(),
    distinctSubstanceTags: z.array(z.string()),
    ways: z.array(z.object({ edgeId: z.string(), sourceRecordUrl: z.string().url(), substanceTag: z.string().nullable() }).strict()).max(MAX_PIPELINE_WAYS),
    waysOmitted: z.boolean(), productCompatibility: z.literal("unverified"), flowDirection: z.literal("unverified"),
  }).strict(),
  sourceSegments: z.array(z.object({
    edgeId: z.string().min(1),
    networkKind: z.string().min(1),
    sourceRecordUrl: z.string().url(),
    evidenceRefs: z.array(z.string()),
  }).strict()).max(MAX_SEGMENT_RECORDS),
  sourceSegmentsOmitted: z.boolean(),
  evidenceRefs: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  countryDepictionCandidates: civilizationCountryDepictionCandidateSchema,
  countryGeometryScreen: civilizationCountryGeometryScreenSchema,
  designatedWetlands: civilizationRamsarWetlandBoundaryScreenSchema,
  ramsarAreaReview: civilizationRamsarRouteReviewSchema,
  terrestrialDepictions: civilizationProposedCorridorOutputSchema.shape.terrestrialDepictions,
  operationalStatus: z.literal("unknown"),
  capacityStatus: z.literal("unknown"),
  physicalFeasibility: z.literal("unknown"),
  jurisdictionalPermission: z.literal("unknown"),
  hazardAssessment: z.literal("unknown"),
}).strict();

const routeSectionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"),
    errorCode: z.string().min(1),
    missingEvidence: z.array(z.string()),
  }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationMappedNetworkRouteOutputSchema.shape.source,
    coverage: civilizationMappedNetworkRouteOutputSchema.shape.coverage,
    candidates: z.array(candidateSummarySchema).max(3),
    gapReview: civilizationMappedNetworkRouteOutputSchema.shape.gapReview,
    boundaryLineReview: civilizationMappedNetworkRouteOutputSchema.shape.boundaryLineReview,
    hydrographyReview: civilizationMappedNetworkRouteOutputSchema.shape.hydrographyReview,
    lakeReview: civilizationMappedNetworkRouteOutputSchema.shape.lakeReview,
  }).strict(),
]);

const countrySectionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"),
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    errorCode: z.string().min(1),
    missingEvidence: z.array(z.string()),
  }).strict(),
  z.object({
    status: z.literal("available"),
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    source: civilizationBoundaryEvidenceOutputSchema.shape.source,
    boundaryClaims: z.array(z.object({
      boundaryId: z.string().min(1),
      label: z.string().min(1),
      boundaryKind: z.literal("administrative_coverage"),
      claimTier: z.literal("source_backed_observation"),
      sourceRecordUrl: z.string().url(),
      sourceYearRepresented: z.string(),
      sourceName: z.string(),
      sourceLicense: z.string(),
      evidenceRefs: z.array(z.string()),
      missingEvidence: z.array(z.string()),
    }).strict()),
    coverage: civilizationBoundaryEvidenceOutputSchema.shape.coverage,
    routeGeometryReview: civilizationRouteAdministrativeBoundaryReviewSchema,
  }).strict(),
]);

const proposedSectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("available"), screen: civilizationProposedCorridorOutputSchema,
    countryDepictionCandidates: civilizationCountryDepictionCandidateSchema,
    countryGeometryScreen: civilizationCountryGeometryScreenSchema }).strict(),
]);

const mappedGapScreenSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), hypothesis: civilizationMappedNetworkGapHypothesisSchema,
    errorCode: z.string().min(1), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("available"), hypothesis: civilizationMappedNetworkGapHypothesisSchema,
    screen: civilizationProposedCorridorOutputSchema }).strict(),
]);

export const civilizationDiplomaticCorridorPacketSchema = z.object({
  schemaVersion: z.literal("civilization_diplomatic_corridor_packet/v17"),
  query: civilizationDiplomaticCorridorQuerySchema,
  collectedAt: z.string().datetime({ offset: true }),
  route: routeSectionSchema,
  countries: z.array(countrySectionSchema).max(2),
  proposedCorridor: proposedSectionSchema,
  mappedGapScreens: z.array(mappedGapScreenSchema).max(3),
  sourceLedger: z.array(sourceRecordSchema),
  temporalReview: z.array(temporalReviewSchema).optional(),
  unresolved: z.array(z.string()),
  interpretationLimits: z.array(z.string()),
  authority: z.object({
    assistant_answer: z.literal(false),
    terminal_eligible: z.literal(false),
    execution_permission: z.literal(false),
    policy_finality: z.literal(false),
  }).strict(),
}).strict();
export type CivilizationDiplomaticCorridorPacket = z.infer<typeof civilizationDiplomaticCorridorPacketSchema>;

type Readers = {
  routeReader?: (query: unknown) => Promise<CivilizationMappedNetworkRouteOptions>;
  countryReader?: (query: unknown) => Promise<CivilizationBoundaryEvidence>;
  proposedReader?: (query: unknown) => Promise<CivilizationProposedCorridorScreen>;
  ramsarAreaReader?: (query: unknown) => Promise<CivilizationRamsarSitesAreaEvidence>;
  terrestrialReader?: (query: unknown) => Promise<CivilizationOsmTerrestrialEvidence>;
};

function errorCode(error: unknown): string {
  return error instanceof CivilizationGeospatialSourceError ? error.code : "source_unavailable";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function reviewSourceTime(
  entry: z.infer<typeof sourceRecordSchema>, evaluatedAt: string,
): z.infer<typeof temporalReviewSchema> {
  const year = new Date(evaluatedAt).getUTCFullYear();
  let relation: z.infer<typeof temporalReviewSchema>["metadataRelationToEvaluation"] = "unknown";
  if (entry.sourceTime) {
    if (entry.sourceTimeMeaning === "represented_year" && /^\d{4}$/u.test(entry.sourceTime)) {
      const representedYear = Number(entry.sourceTime);
      relation = representedYear < year ? "before" : representedYear > year ? "after" : "same_calendar_year";
    } else if (entry.sourceTimeMeaning !== "represented_year") {
      const sourceTime = Date.parse(entry.sourceTime);
      if (Number.isFinite(sourceTime)) {
        relation = new Date(sourceTime).toISOString().slice(0, 10) === evaluatedAt.slice(0, 10)
          ? "same_calendar_day" : sourceTime < Date.parse(evaluatedAt) ? "before" : "after";
      }
    }
  }
  return {
    sourceId: entry.sourceId,
    sourceTime: entry.sourceTime,
    sourceTimeMeaning: entry.sourceTimeMeaning,
    metadataRelationToEvaluation: relation,
    validityAtEvaluation: "unverified",
    limitation: !entry.sourceTime ? "source_time_unknown"
      : entry.sourceTimeMeaning === "represented_year" ? "represented_year_not_effective_interval"
        : entry.sourceTimeMeaning === "local_acquisition" ? "local_acquisition_not_observation_time"
          : "metadata_time_not_feature_validity",
  };
}

export async function readDiplomaticCorridorPacket(
  input: unknown,
  readers: Readers = {},
): Promise<CivilizationDiplomaticCorridorPacket> {
  const parsed = civilizationDiplomaticCorridorQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Diplomatic corridor packet query is invalid.");
  }
  const query = parsed.data;
  if (new Set(query.countryIso3s).size !== query.countryIso3s.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Country ISO3 selections must be unique.");
  }
  const [west, south, east, north] = query.route.bbox;
  if (west >= east || south >= north || east - west > 1 || north - south > 1) {
    throw new CivilizationGeospatialSourceError("invalid_bbox", "Corridor area must be increasing, at most 1° on each axis, and not cross the date line.");
  }
  const inside = (point: { lat: number; lon: number }) =>
    point.lon >= west && point.lon <= east && point.lat >= south && point.lat <= north;
  if (!inside(query.route.origin) || !inside(query.route.destination) ||
      new Set(query.route.networkKinds).size !== query.route.networkKinds.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Route endpoints must lie inside the corridor and network kinds must be unique.");
  }
  if (query.proposedSketch) {
    const vertices = query.proposedSketch.vertices;
    const samePoint = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
      Math.abs(a.lat - b.lat) <= 1e-6 && Math.abs(a.lon - b.lon) <= 1e-6;
    if (!samePoint(vertices[0], query.route.origin) ||
        !samePoint(vertices[vertices.length - 1], query.route.destination)) {
      throw new CivilizationGeospatialSourceError("invalid_query", "Proposed sketch must share the mapped route endpoints.");
    }
  }
  const routeReader = readers.routeReader ?? readMappedNetworkRouteOptions;
  const countryReader = readers.countryReader ?? readGeoboundariesEvidence;
  const ramsarAreaReader = readers.ramsarAreaReader ?? readRamsarSitesInArea;
  const pendingCountries = query.countryIso3s.map((countryIso3) =>
    Promise.resolve().then(() => countryReader({ countryIso3 })));
  let sharedRamsar: Promise<CivilizationRamsarSitesAreaEvidence> | null = null;
  const getSharedRamsar = () => sharedRamsar ??= Promise.resolve().then(() =>
    ramsarAreaReader({ bbox: query.route.bbox, maxFeatures: 30 }));
  let sharedBoundaryLines: ReturnType<typeof readNaturalEarthBoundaryLines> | null = null;
  let sharedHydrography: Promise<ReturnType<typeof readNaturalEarthHydrography>> | null = null;
  let sharedLakes: Promise<ReturnType<typeof readNaturalEarthLakes>> | null = null;
  let sharedTerrestrial: Promise<CivilizationOsmTerrestrialEvidence> | null = null;
  const terrestrialReader = readers.terrestrialReader ?? readTiledOsmTerrestrialEvidence;
  const getSharedTerrestrial = () => sharedTerrestrial ??= Promise.resolve().then(() =>
    terrestrialReader({ bbox: query.route.bbox, maxWays: 100 }));
  const proposedReader = readers.proposedReader ?? ((input: unknown) =>
    readProposedCorridorScreen(input, {
      ramsarArea: getSharedRamsar,
      boundaryLines: (sourceQuery) => sharedBoundaryLines ??= readNaturalEarthBoundaryLines(sourceQuery),
      hydrography: (sourceQuery) => sharedHydrography ??= Promise.resolve().then(() => readNaturalEarthHydrography(sourceQuery)),
      lakes: (sourceQuery) => sharedLakes ??= Promise.resolve().then(() => readNaturalEarthLakes(sourceQuery)),
      terrestrial: () => getSharedTerrestrial(),
      country: (sourceQuery) => {
        const countryIso3 = (sourceQuery as { countryIso3?: string }).countryIso3;
        const index = query.countryIso3s.findIndex((code) => code === countryIso3);
        return index >= 0 ? pendingCountries[index] : countryReader(sourceQuery);
      },
    }));
  const routeRequest = {
    ...query.route,
    includeBoundaryLineReview: true,
    includeHydrographyReview: true,
    includeLakeReview: true,
  };
  const pendingRoute = Promise.resolve().then(() => routeReader(routeRequest));
  const pendingProposed = query.proposedSketch
    ? Promise.resolve().then(() => proposedReader({
        ...query.proposedSketch,
        bbox: query.route.bbox,
        countryIso3s: query.countryIso3s,
        evaluatedAt: query.route.evaluatedAt,
      }))
    : null;
  const [[routeResult], countryResults, proposedResults] = await Promise.all([
    Promise.allSettled([pendingRoute]),
    Promise.allSettled(pendingCountries),
    pendingProposed ? Promise.allSettled([pendingProposed]) : Promise.resolve([]),
  ]);
  const proposedResult = proposedResults[0];
  const gapHypotheses = routeResult.status === "fulfilled" && routeResult.value.candidates.length === 0
    ? routeResult.value.gapReview.hypotheses : [];
  const pendingGaps = gapHypotheses.map((hypothesis) => Promise.resolve().then(() => proposedReader({
    bbox: query.route.bbox,
    vertices: [hypothesis.from, hypothesis.to],
    sketchOrigin: "mapped_component_gap_hypothesis",
    intendedUse: `Examine possible ${hypothesis.networkKind} interconnection`,
    contemplatedModes: [], mappedInfrastructureKinds: [],
    includeTerrainPointObservations: false,
    includeGlobalReliefObservations: true,
    maxGlobalReliefSamples: 5,
    countryIso3s: query.countryIso3s,
    evaluatedAt: query.route.evaluatedAt,
  })));
  const mappedTerrestrialAreaValid = east - west <= 1 && north - south <= 1;
  const [mappedRamsarResults, gapResults, mappedTerrestrialResults] = await Promise.all([
    routeResult.status === "fulfilled" && routeResult.value.candidates.length > 0
      ? Promise.allSettled([getSharedRamsar()]) : Promise.resolve([]),
    Promise.allSettled(pendingGaps),
    routeResult.status === "fulfilled" && routeResult.value.candidates.length > 0 && mappedTerrestrialAreaValid
      ? Promise.allSettled([getSharedTerrestrial()]) : Promise.resolve([]),
  ]);
  const mappedRamsarResult = mappedRamsarResults[0] ?? null;
  const mappedTerrestrialResult = mappedTerrestrialResults[0] ?? null;
  const mappedGapScreens: CivilizationDiplomaticCorridorPacket["mappedGapScreens"] = gapHypotheses.map((hypothesis, index) => {
    const result = gapResults[index];
    return result?.status === "fulfilled"
      ? { status: "available", hypothesis, screen: result.value }
      : { status: "unavailable", hypothesis,
          errorCode: errorCode(result?.status === "rejected" ? result.reason : null),
          missingEvidence: ["mapped_gap_natural_and_jurisdictional_screen_unavailable"] };
  });
  const proposedCorridor: CivilizationDiplomaticCorridorPacket["proposedCorridor"] = !query.proposedSketch
    ? { status: "not_requested", missingEvidence: ["proposed_sketch_not_requested"] }
    : proposedResult?.status === "fulfilled"
      ? { status: "available", screen: proposedResult.value,
          countryDepictionCandidates: proposedResult.value.countryDepictionCandidates,
          countryGeometryScreen: proposedResult.value.countryGeometryScreen }
      : { status: "unavailable", errorCode: errorCode(proposedResult?.status === "rejected" ? proposedResult.reason : null),
          missingEvidence: ["proposed_sketch_comparison_unavailable"] };
  const route: CivilizationDiplomaticCorridorPacket["route"] = routeResult.status === "fulfilled"
    ? {
      status: "available",
      source: routeResult.value.source,
      coverage: routeResult.value.coverage,
      gapReview: routeResult.value.gapReview,
      candidates: routeResult.value.candidates.map((candidate) => {
        const sourceSegments = [...new Map(candidate.segments.map((segment) =>
          [segment.edgeId, {
            edgeId: segment.edgeId,
            networkKind: segment.networkKind,
            sourceRecordUrl: segment.sourceRecordUrl,
            evidenceRefs: segment.evidenceRefs,
          }])).values()];
        const networkTransitions = candidate.segments.flatMap((segment, index) => {
          const previous = candidate.segments[index - 1];
          if (!previous || previous.networkKind === segment.networkKind) return [];
          return [{
            alignmentSegmentIndex: index, fromKind: previous.networkKind, toKind: segment.networkKind,
            nodeRef: segment.fromNodeRef, position: candidate.coordinates[index],
            fromSourceRecordUrl: previous.sourceRecordUrl, toSourceRecordUrl: segment.sourceRecordUrl,
            relation: "shared_osm_node_only" as const, facilityStatus: "unverified" as const,
          }];
        });
        return {
          candidateId: candidate.candidateId,
          optionIndex: candidate.optionIndex,
          generation: candidate.generation,
          pathKind: candidate.pathKind,
          claimTier: "hypothetical" as const,
          evaluatedAt: candidate.evaluatedAt,
          networkKinds: candidate.networkKinds,
          mappedDistanceKm: candidate.distanceKm,
          originSnapDistanceKm: candidate.originSnapDistanceKm,
          destinationSnapDistanceKm: candidate.destinationSnapDistanceKm,
          segmentCount: candidate.segments.length,
          networkTransitionCount: networkTransitions.length,
          networkTransitions: networkTransitions.slice(0, MAX_NETWORK_TRANSITIONS),
          networkTransitionsOmitted: networkTransitions.length > MAX_NETWORK_TRANSITIONS,
          pipelineTagReview: {
            status: candidate.pipelineTagReview?.status ?? "not_applicable",
            wayCount: candidate.pipelineTagReview?.wayCount ?? 0,
            untaggedWayCount: candidate.pipelineTagReview?.untaggedWayCount ?? 0,
            distinctSubstanceTags: candidate.pipelineTagReview?.distinctSubstanceTags ?? [],
            ways: candidate.pipelineTagReview?.ways.slice(0, MAX_PIPELINE_WAYS) ?? [],
            waysOmitted: (candidate.pipelineTagReview?.wayCount ?? 0) > MAX_PIPELINE_WAYS,
            productCompatibility: "unverified" as const, flowDirection: "unverified" as const,
          },
          sourceSegments: sourceSegments.slice(0, MAX_SEGMENT_RECORDS),
          sourceSegmentsOmitted: sourceSegments.length > MAX_SEGMENT_RECORDS,
          evidenceRefs: candidate.evidenceRefs,
          missingEvidence: [...candidate.missingEvidence,
            ...(networkTransitions.length > MAX_NETWORK_TRANSITIONS ? ["additional_network_transitions_omitted_from_packet"] : [])],
          countryDepictionCandidates: screenCountryDepictionCandidates(candidate.coordinates),
          countryGeometryScreen: screenCountryDepictionGeometry(candidate.coordinates),
          designatedWetlands: screenPilotRamsarWetlands(candidate.coordinates, "mapped_network_candidate"),
          ramsarAreaReview: mappedRamsarResult?.status === "fulfilled"
            ? reviewRamsarRoute(candidate.coordinates, mappedRamsarResult.value)
            : { status: "unavailable" as const,
              errorCode: mappedRamsarResult?.status === "rejected" ? errorCode(mappedRamsarResult.reason) : "source_not_queried",
              missingEvidence: ["ramsar_area_source_unavailable", "mapped_alignment_site_contact_unassessed"] },
          terrestrialDepictions: !mappedTerrestrialAreaValid
            ? { status: "area_too_large" as const, missingEvidence: ["osm_terrestrial_one_degree_tiled_inventory_limit",
                "mapped_alignment_terrestrial_depictions_not_screened"] }
            : mappedTerrestrialResult?.status === "fulfilled"
              ? screenOsmTerrestrialDepictions(candidate.coordinates, mappedTerrestrialResult.value)
              : { status: "unavailable" as const,
                  errorCode: errorCode(mappedTerrestrialResult?.status === "rejected" ? mappedTerrestrialResult.reason : null),
                  missingEvidence: ["osm_terrestrial_source_unavailable", "mapped_alignment_terrestrial_depictions_not_screened"] },
          operationalStatus: candidate.operationalStatus,
          capacityStatus: candidate.capacityStatus,
          physicalFeasibility: candidate.physicalFeasibility,
          jurisdictionalPermission: candidate.jurisdictionalPermission,
          hazardAssessment: candidate.hazardAssessment,
        };
      }),
      boundaryLineReview: routeResult.value.boundaryLineReview,
      hydrographyReview: routeResult.value.hydrographyReview,
      lakeReview: routeResult.value.lakeReview,
    }
    : {
      status: "unavailable",
      errorCode: errorCode(routeResult.reason),
      missingEvidence: ["mapped_route_source_unavailable", "route_and_contact_review_not_performed"],
    };
  const countries: CivilizationDiplomaticCorridorPacket["countries"] = countryResults.map((result, index) => {
    const countryIso3 = query.countryIso3s[index];
    return result.status === "fulfilled"
      ? {
        status: "available",
        countryIso3,
        source: result.value.source,
        boundaryClaims: (result.value.atlas.boundaryClaims ?? []).map((claim) => ({
          boundaryId: claim.boundaryId,
          label: claim.label,
          boundaryKind: claim.boundaryKind,
          claimTier: "source_backed_observation" as const,
          sourceRecordUrl: claim.sourceRecordUrl,
          sourceYearRepresented: claim.sourceYearRepresented,
          sourceName: claim.sourceName,
          sourceLicense: claim.sourceLicense,
          evidenceRefs: claim.evidenceRefs,
          missingEvidence: claim.missingEvidence,
        })),
        coverage: result.value.coverage,
        routeGeometryReview: routeResult.status === "rejected"
          ? { status: "route_unavailable" as const, missingEvidence: ["mapped_route_source_unavailable", "administrative_outline_contact_not_assessed"] }
          : reviewRouteAdministrativeBoundaryEncounters(routeResult.value.candidates, result.value),
      }
      : {
        status: "unavailable",
        countryIso3,
        errorCode: errorCode(result.reason),
        missingEvidence: ["administrative_depiction_source_unavailable", "sovereignty_and_dispute_unassessed"],
      };
  });
  const sourceLedger: CivilizationDiplomaticCorridorPacket["sourceLedger"] = [];
  const addReliefLedger = (sourceId: string, relief: CivilizationProposedCorridorScreen["globalReliefPoints"]) => {
    if (relief.status === "not_requested") return;
    sourceLedger.push(relief.status === "available" ? {
      sourceId, status: "available", sourceRecordUrl: relief.source.citationUrl,
      datasetVersion: relief.source.modelVersion, sourceTime: null, sourceTimeMeaning: "unknown",
      retrievedAt: relief.observations[0]?.fetchedAt ?? null,
      license: relief.source.licenseBoundary, missingEvidence: relief.missingEvidence,
    } : {
      sourceId, status: "unavailable", sourceRecordUrl: null, datasetVersion: null,
      sourceTime: null, sourceTimeMeaning: "unknown", retrievedAt: null, license: null,
      missingEvidence: relief.missingEvidence,
    });
  };
  const addTerrestrialLedger = (sourceId: string, section: CivilizationProposedCorridorScreen["terrestrialDepictions"]) => {
    sourceLedger.push(section.status === "available" ? {
      sourceId, status: "available", sourceRecordUrl: section.source.sourceUrl,
      datasetVersion: null, sourceTime: section.source.sourceSnapshotAt,
      sourceTimeMeaning: section.source.sourceSnapshotAt ? "source_snapshot" : "unknown",
      retrievedAt: section.source.fetchedAt, license: section.source.licenseId,
      missingEvidence: section.missingEvidence,
    } : {
      sourceId, status: "unavailable", sourceRecordUrl: null,
      datasetVersion: null, sourceTime: null, sourceTimeMeaning: "unknown",
      retrievedAt: null, license: null, missingEvidence: section.missingEvidence,
    });
  };
  const firstAvailableGapScreen = mappedGapScreens.find((gap) => gap.status === "available");
  sourceLedger.push({
    sourceId: "natural_earth_50m_admin0_country_bbox_index",
    status: route.status === "available" && route.candidates.length || proposedCorridor.status === "available" || firstAvailableGapScreen
      ? "available" : route.status === "available" ? "not_queried_no_candidate" : "not_queried_route_unavailable",
    sourceRecordUrl: route.status === "available" && route.candidates.length ? route.candidates[0].countryDepictionCandidates.source.sourceRecordUrl
      : proposedCorridor.status === "available" ? proposedCorridor.countryDepictionCandidates.source.sourceRecordUrl
        : firstAvailableGapScreen?.status === "available" ? firstAvailableGapScreen.screen.countryDepictionCandidates.source.sourceRecordUrl : null,
    datasetVersion: "5.1.1", sourceTime: null, sourceTimeMeaning: "unknown",
    retrievedAt: null, license: "Public Domain",
    missingEvidence: ["generalized_editorial_polygon_contact_requires_independent_detailed_geometry_and_legal_review"],
  });
  if (route.status === "available") {
    sourceLedger.push({
      sourceId: route.source.sourceId,
      status: "available",
      sourceRecordUrl: route.source.sourceUrl,
      datasetVersion: null,
      sourceTime: route.source.sourceSnapshotAt,
      sourceTimeMeaning: route.source.sourceSnapshotAt ? "source_snapshot" : "unknown",
      retrievedAt: route.source.fetchedAt,
      license: route.source.licenseId,
      missingEvidence: route.coverage.missingEvidence,
    });
    const boundary = route.boundaryLineReview;
    sourceLedger.push(boundary.status === "available" ? {
      sourceId: boundary.source.sourceId,
      status: "available",
      sourceRecordUrl: boundary.source.sourceRecordUrl,
      datasetVersion: boundary.source.datasetVersion,
      sourceTime: boundary.source.sourceRevisionAt,
      sourceTimeMeaning: "repository_revision",
      retrievedAt: boundary.source.fetchedAt,
      license: boundary.source.licenseId,
      missingEvidence: boundary.missingEvidence,
    } : {
      sourceId: "natural_earth_disputed_boundary_lines",
      status: boundary.status === "unavailable" ? "unavailable" : "not_queried_no_candidate",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null, retrievedAt: null, license: null,
      sourceTimeMeaning: "unknown",
      missingEvidence: boundary.missingEvidence,
    });
    const hydrography = route.hydrographyReview;
    sourceLedger.push(hydrography.status === "available" ? {
      sourceId: hydrography.source.sourceId,
      status: "available",
      sourceRecordUrl: hydrography.source.sourceArchiveUrl,
      datasetVersion: hydrography.source.datasetVersion,
      sourceTime: hydrography.source.snapshotAcquiredAt,
      sourceTimeMeaning: "local_acquisition",
      retrievedAt: hydrography.source.readAt,
      license: hydrography.source.licenseId,
      missingEvidence: hydrography.missingEvidence,
    } : {
      sourceId: "natural_earth_50m_rivers_lake_centerlines",
      status: hydrography.status === "unavailable" ? "unavailable" : "not_queried_no_candidate",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null, retrievedAt: null, license: null,
      sourceTimeMeaning: "unknown",
      missingEvidence: hydrography.missingEvidence,
    });
    const lakes = route.lakeReview;
    sourceLedger.push(lakes.status === "available" ? {
      sourceId: lakes.source.sourceId,
      status: "available", sourceRecordUrl: lakes.source.sourceArchiveUrl,
      datasetVersion: lakes.source.datasetVersion,
      sourceTime: lakes.source.snapshotAcquiredAt, sourceTimeMeaning: "local_acquisition",
      retrievedAt: lakes.source.readAt, license: lakes.source.licenseId,
      missingEvidence: lakes.missingEvidence,
    } : {
      sourceId: "natural_earth_50m_lakes", status: lakes.status === "unavailable" ? "unavailable" : "not_queried_no_candidate",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null, sourceTimeMeaning: "unknown",
      retrievedAt: null, license: null, missingEvidence: lakes.missingEvidence,
    });
  } else {
    sourceLedger.push({
      sourceId: "osm_overpass",
      status: "unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null, retrievedAt: null, license: null,
      sourceTimeMeaning: "unknown",
      missingEvidence: route.missingEvidence,
    });
    for (const sourceId of [
      "natural_earth_disputed_boundary_lines",
      "natural_earth_50m_rivers_lake_centerlines",
      "natural_earth_50m_lakes",
    ]) {
      sourceLedger.push({
        sourceId,
        status: "not_queried_route_unavailable",
        sourceRecordUrl: null, datasetVersion: null, sourceTime: null, retrievedAt: null, license: null,
        sourceTimeMeaning: "unknown",
        missingEvidence: ["mapped_route_source_unavailable", "route_contact_comparison_not_performed"],
      });
    }
  }
  for (const country of countries) {
    sourceLedger.push(country.status === "available" ? {
      sourceId: `geoboundaries_gbopen_adm0:${country.countryIso3}`,
      status: "available",
      sourceRecordUrl: country.source.metadataUrl,
      datasetVersion: country.source.releaseRevision,
      sourceTime: country.source.representedYear,
      sourceTimeMeaning: "represented_year",
      retrievedAt: country.source.fetchedAt,
      license: `${country.source.distributionLicense}; original ${country.source.originalSourceLicense}`,
      missingEvidence: country.coverage.missingEvidence,
    } : {
      sourceId: `geoboundaries_gbopen_adm0:${country.countryIso3}`,
      status: "unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null, retrievedAt: null, license: null,
      sourceTimeMeaning: "unknown",
      missingEvidence: country.missingEvidence,
    });
  }
  const wetlands = proposedCorridor.status === "available" ? proposedCorridor.screen.designatedWetlands
    : route.status === "available" && route.candidates.length > 0 ? route.candidates[0].designatedWetlands
      : firstAvailableGapScreen?.status === "available" ? firstAvailableGapScreen.screen.designatedWetlands : null;
  if (wetlands) {
    sourceLedger.push({
      sourceId: "ramsar_published_wetland_boundaries_pilot",
      status: "available", sourceRecordUrl: wetlands.source.url,
      datasetVersion: `snapshot_sha256:${wetlands.source.rawResponseSha256}`,
      sourceTime: wetlands.source.acquiredAt, sourceTimeMeaning: "local_acquisition",
      retrievedAt: wetlands.source.acquiredAt, license: wetlands.source.license,
      missingEvidence: wetlands.missingEvidence,
    });
  }
  if (route.status === "available" && route.candidates.length > 0) {
    for (const candidate of route.candidates) {
      addTerrestrialLedger(`osm_overpass_terrestrial_elements:mapped_candidate:${candidate.optionIndex}`,
        candidate.terrestrialDepictions);
    }
    const ramsar = route.candidates[0].ramsarAreaReview;
    sourceLedger.push(ramsar.status === "available" ? {
      sourceId: "ramsar_sdi_features_published:mapped_alternatives", status: "available",
      sourceRecordUrl: ramsar.source.requestUrl, datasetVersion: ramsar.source.layer,
      sourceTime: null, sourceTimeMeaning: "unknown", retrievedAt: ramsar.source.fetchedAt,
      license: ramsar.source.license, missingEvidence: ramsar.missingEvidence,
    } : {
      sourceId: "ramsar_sdi_features_published:mapped_alternatives", status: "unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null,
      sourceTimeMeaning: "unknown", retrievedAt: null, license: null,
      missingEvidence: ramsar.missingEvidence,
    });
  } else {
    sourceLedger.push({
      sourceId: "ramsar_sdi_features_published:mapped_alternatives",
      status: route.status === "available" ? "not_queried_no_candidate" : "not_queried_route_unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null,
      sourceTimeMeaning: "unknown", retrievedAt: null, license: null,
      missingEvidence: [route.status === "available" ? "no_mapped_candidate_to_screen"
        : "mapped_route_unavailable_site_contact_not_assessed"],
    });
  }
  if (proposedCorridor.status === "available") {
    const ramsar = proposedCorridor.screen.ramsarAreaReview;
    sourceLedger.push(ramsar.status === "available" ? {
      sourceId: "ramsar_sdi_features_published:proposed_sketch", status: "available",
      sourceRecordUrl: ramsar.source.requestUrl, datasetVersion: ramsar.source.layer,
      sourceTime: null, sourceTimeMeaning: "unknown", retrievedAt: ramsar.source.fetchedAt,
      license: ramsar.source.license, missingEvidence: ramsar.missingEvidence,
    } : {
      sourceId: "ramsar_sdi_features_published:proposed_sketch", status: "unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null,
      sourceTimeMeaning: "unknown", retrievedAt: null, license: null,
      missingEvidence: ramsar.missingEvidence,
    });
    const lakes = proposedCorridor.screen.lakeReview;
    sourceLedger.push(lakes.status === "available" ? {
      sourceId: `${lakes.source.sourceId}:proposed_sketch`,
      status: "available", sourceRecordUrl: lakes.source.sourceArchiveUrl,
      datasetVersion: lakes.source.datasetVersion,
      sourceTime: lakes.source.snapshotAcquiredAt, sourceTimeMeaning: "local_acquisition",
      retrievedAt: lakes.source.readAt, license: lakes.source.licenseId,
      missingEvidence: lakes.missingEvidence,
    } : {
      sourceId: "natural_earth_50m_lakes:proposed_sketch", status: "unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null, sourceTimeMeaning: "unknown",
      retrievedAt: null, license: null, missingEvidence: lakes.missingEvidence,
    });
    addReliefLedger("noaa_etopo_2022:proposed_sketch", proposedCorridor.screen.globalReliefPoints);
    addTerrestrialLedger("osm_overpass_terrestrial_elements:proposed_sketch", proposedCorridor.screen.terrestrialDepictions);
  }
  for (const [gapIndex, mappedGapScreen] of mappedGapScreens.entries()) {
  if (mappedGapScreen.status === "available") {
    const gap = mappedGapScreen.screen;
    for (const [sourceId, section] of [
      ["natural_earth_boundary_lines:mapped_gap", gap.boundaryLines],
      ["natural_earth_hydrography:mapped_gap", gap.hydrography],
      ["natural_earth_lakes:mapped_gap", gap.lakeReview],
      ["ramsar_sdi_features_published:mapped_gap", gap.ramsarAreaReview],
    ] as const) {
      sourceLedger.push({
        sourceId: `${sourceId}:${gapIndex + 1}`, status: section.status === "available" ? "available" : "unavailable",
        sourceRecordUrl: section.status === "available"
          ? "sourceRecordUrl" in section.source ? section.source.sourceRecordUrl
            : "sourceArchiveUrl" in section.source ? section.source.sourceArchiveUrl
              : section.source.requestUrl : null,
        datasetVersion: section.status === "available"
          ? "datasetVersion" in section.source ? section.source.datasetVersion
            : "layer" in section.source ? section.source.layer : null : null,
        sourceTime: section.status === "available"
          ? "sourceRevisionAt" in section.source ? section.source.sourceRevisionAt
            : "snapshotAcquiredAt" in section.source ? section.source.snapshotAcquiredAt : null : null,
        sourceTimeMeaning: section.status === "available"
          ? "sourceRevisionAt" in section.source ? "repository_revision"
            : "snapshotAcquiredAt" in section.source ? "local_acquisition" : "unknown" : "unknown",
        retrievedAt: section.status === "available"
          ? "fetchedAt" in section.source ? section.source.fetchedAt
            : "readAt" in section.source ? section.source.readAt : null : null,
        license: section.status === "available"
          ? "licenseId" in section.source ? section.source.licenseId : section.source.license : null,
        missingEvidence: section.missingEvidence,
      });
    }
    addReliefLedger(`noaa_etopo_2022:mapped_gap:${gapIndex + 1}`, gap.globalReliefPoints);
    addTerrestrialLedger(`osm_overpass_terrestrial_elements:mapped_gap:${gapIndex + 1}`, gap.terrestrialDepictions);
  } else if (mappedGapScreen.status === "unavailable") {
    sourceLedger.push({
      sourceId: `mapped_gap_corridor_screen:${gapIndex + 1}`, status: "unavailable",
      sourceRecordUrl: null, datasetVersion: null, sourceTime: null,
      sourceTimeMeaning: "unknown", retrievedAt: null, license: null,
      missingEvidence: mappedGapScreen.missingEvidence,
    });
  }
  }
  const temporalReview = sourceLedger.map((entry) => reviewSourceTime(entry, query.route.evaluatedAt));
  const unresolved = unique([
    "legal_sovereignty_and_recognition",
    "effective_control_and_border_operations",
    "jurisdictional_permission_and_treaty_rights",
    "infrastructure_operation_capacity_and_transfer_compatibility",
    "natural_hazards_discharge_seasonality_and_crossing_design",
    "source_temporal_alignment_with_requested_evaluation_time",
    ...(temporalReview.some((item) => item.metadataRelationToEvaluation === "after")
      ? ["source_metadata_postdates_requested_evaluation"] : []),
    "independent_current_primary_diplomatic_records",
    ...sourceLedger.flatMap((entry) => entry.missingEvidence),
    ...countries.flatMap((country) => country.status === "available"
      ? country.routeGeometryReview.missingEvidence : []),
    ...(route.status === "available" ? route.candidates.flatMap((candidate) =>
      [...candidate.missingEvidence, ...candidate.countryDepictionCandidates.missingEvidence,
        ...candidate.countryGeometryScreen.missingEvidence, ...candidate.terrestrialDepictions.missingEvidence]) : []),
    ...(proposedCorridor.status === "available" ? [...proposedCorridor.countryDepictionCandidates.missingEvidence,
      ...proposedCorridor.countryGeometryScreen.missingEvidence] : []),
    ...(proposedCorridor.status === "available" ? proposedCorridor.screen.unresolved
      : proposedCorridor.status === "unavailable" ? proposedCorridor.missingEvidence : []),
    ...mappedGapScreens.flatMap((gap) => gap.status === "available"
      ? [...gap.hypothesis.missingEvidence, ...gap.screen.unresolved]
      : gap.missingEvidence),
    ...(route.status === "available" && !route.gapReview.searchExhaustive ? ["mapped_gap_search_incomplete"] : []),
  ]);
  const packet = {
    schemaVersion: "civilization_diplomatic_corridor_packet/v17" as const,
    query,
    collectedAt: new Date().toISOString(),
    route,
    countries,
    proposedCorridor,
    mappedGapScreens,
    sourceLedger,
    temporalReview,
    unresolved,
    interpretationLimits: [
      "source_depictions_are_not_sovereignty_determinations",
      "source_time_may_be_revision_snapshot_or_represented_year_not_effective_date",
      "geometric_contacts_are_not_legal_or_engineering_crossing_findings",
      "country_bbox_shortlist_over_includes_and_is_not_exact_polygon_contact_or_jurisdiction",
      "country_polygon_contact_is_a_1_50m_editorial_depiction_not_a_legal_border_or_survey",
      "mapped_topology_is_not_an_operational_trade_route",
      ...(mappedGapScreens.length > 0 ? [
        "mapped_gap_straight_link_is_not_an_engineered_alignment_or_evidence_that_construction_is_needed",
      ] : []),
      ...(query.proposedSketch ? [
        "proposed_sketch_is_a_caller_supplied_scenario_not_an_existing_or_engineered_route",
        "source_ledger_covers_mapped_route_and_country_sections_proposed_sketch_sources_are_in_attached_screen",
      ] : []),
      "no_contact_or_no_route_in_bounded_sources_does_not_prove_absence",
      "this_packet_is_evidence_for_human_and_codex_review_not_a_policy_decision",
    ],
    authority: {
      assistant_answer: false as const,
      terminal_eligible: false as const,
      execution_permission: false as const,
      policy_finality: false as const,
    },
  };
  return civilizationDiplomaticCorridorPacketSchema.parse(packet);
}
