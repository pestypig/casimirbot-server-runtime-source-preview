import { z } from "zod";
import {
  civilizationCorridorScaleNetworkOutputSchema,
  readCivilizationCorridorScaleNetworkTopology,
} from "./corridor-scale-network-topology";
import {
  civilizationCorridorScalePathScreenQuerySchema,
  civilizationCorridorScalePathScreenOutputSchema,
  civilizationCorridorScalePathReviewLeadSchema,
  readCivilizationCorridorScalePathScreen,
} from "./corridor-scale-path-screen";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

export const civilizationCorridorScalePathBatchQuerySchema = z.object({
  path: civilizationCorridorScalePathScreenQuerySchema,
  maxPieces: z.number().int().min(1).max(3).default(3),
}).strict();

const pieceSchema = z.object({
  screen: civilizationCorridorScalePathScreenOutputSchema.shape.screen,
}).strict();

export const civilizationCorridorScalePathBatchOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_path_batch/v1"),
  query: civilizationCorridorScalePathBatchQuerySchema,
  network: civilizationCorridorScaleNetworkOutputSchema,
  diplomaticContext: civilizationCorridorScalePathScreenOutputSchema.shape.diplomaticContext,
  pieces: z.array(pieceSchema).min(1).max(3),
  coverage: z.object({
    pathSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    totalPathSegments: z.number().int().positive().nullable(),
    startSegmentIndex: z.number().int().nonnegative(),
    screenedSegmentCount: z.number().int().nonnegative(),
    nextSegmentIndex: z.number().int().nonnegative().nullable(),
    status: z.enum(["path_not_screenable", "source_piece_unavailable", "more_pieces_needed", "batch_reached_path_end"]),
    allPathGeometryPiecesReadInThisBatch: z.boolean(),
    unavailableSources: z.array(z.string()),
    possiblyTruncatedSources: z.array(z.string()),
    interpretation: z.literal("Complete geometric piece coverage is distinct from complete source coverage, operating service, legal rights, ecological or community effects, consent, and comparable outcomes."),
  }).strict(),
  reviewLeads: z.object({
    countryDepictions: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/).nullable(),
      editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/), name: z.string(), sourceFeatureId: z.string(),
      sourceUrl: z.string().url() }).strict()),
    naturalFeatures: z.array(z.object({ kind: z.string(), featureId: z.string(), label: z.string(),
      sourceUrl: z.string().url(), pathSegmentIndices: z.array(z.number().int().nonnegative()) }).strict()),
    nextEvidenceRequests: civilizationCorridorScalePathReviewLeadSchema.shape.nextEvidenceRequests,
    meaning: z.literal("Only available pieces in this batch contribute review leads; a missing lead is not evidence of no contact, affected party, or effect."),
  }).strict(),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScalePathBatch = z.infer<typeof civilizationCorridorScalePathBatchOutputSchema>;

export async function readCivilizationCorridorScalePathBatch(input: unknown): Promise<CivilizationCorridorScalePathBatch> {
  const parsed = civilizationCorridorScalePathBatchQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Corridor path batch query is invalid.");
  const query = parsed.data;
  const network = await readCivilizationCorridorScaleNetworkTopology(query.path.network);
  const pieces: CivilizationCorridorScalePathBatch["pieces"] = [];
  const countryDepictions = new Map<string, CivilizationCorridorScalePathBatch["reviewLeads"]["countryDepictions"][number]>();
  const naturalFeatures = new Map<string, CivilizationCorridorScalePathBatch["reviewLeads"]["naturalFeatures"][number]>();
  const requests = new Map<string, CivilizationCorridorScalePathBatch["reviewLeads"]["nextEvidenceRequests"][number]>();
  const unavailableSources = new Set<string>();
  const possiblyTruncatedSources = new Set<string>();
  let nextSegmentIndex: number | null = query.path.startSegmentIndex;
  let screenedSegmentCount = 0;
  let diplomaticContext: CivilizationCorridorScalePathBatch["diplomaticContext"] = { status: "not_requested" };
  let stoppedStatus: "path_not_screenable" | "source_piece_unavailable" | null = null;
  for (let index = 0; index < query.maxPieces && nextSegmentIndex !== null; index++) {
    const currentIndex: number = nextSegmentIndex;
    const result = await readCivilizationCorridorScalePathScreen({
      network: query.path.network, startSegmentIndex: currentIndex,
      expectedPathSha256: index === 0 ? query.path.expectedPathSha256 :
        network.route.status === "mapped_topology_candidate" ? network.route.pathSha256 : undefined,
      diplomaticIssueId: index === 0 ? query.path.diplomaticIssueId : undefined,
    }, async () => network);
    if (index === 0) diplomaticContext = result.diplomaticContext;
    pieces.push({ screen: result.screen });
    if (result.screen.status === "not_screenable") {
      stoppedStatus = "path_not_screenable";
      break;
    }
    if (result.screen.status === "unavailable") {
      stoppedStatus = "source_piece_unavailable";
      break;
    }
    const screen = result.screen;
    screenedSegmentCount += screen.screenedSegmentCount;
    nextSegmentIndex = screen.nextSegmentIndex;
    for (const country of screen.reviewLeads.countryDepictions) {
      countryDepictions.set(`${country.sourceFeatureId}:${country.sourceUrl}`, {
        countryIso3: country.countryIso3, editorialAdm0A3: country.editorialAdm0A3,
        name: country.name, sourceFeatureId: country.sourceFeatureId, sourceUrl: country.sourceUrl,
      });
    }
    for (const feature of screen.reviewLeads.naturalFeatures) {
      const key = `${feature.kind}:${feature.featureId}:${feature.sourceUrl}`;
      const absoluteIndices = feature.pieceSegmentIndices.map((segmentIndex) => screen.startSegmentIndex + segmentIndex);
      const prior = naturalFeatures.get(key);
      if (prior) prior.pathSegmentIndices = [...new Set([...prior.pathSegmentIndices, ...absoluteIndices])].sort((a, b) => a - b);
      else naturalFeatures.set(key, { kind: feature.kind, featureId: feature.featureId, label: feature.label,
        sourceUrl: feature.sourceUrl, pathSegmentIndices: absoluteIndices });
    }
    for (const request of screen.reviewLeads.nextEvidenceRequests) {
      const prior = requests.get(request.actorClass);
      if (prior) prior.contextSourceUrls = [...new Set([...prior.contextSourceUrls, ...request.contextSourceUrls])];
      else requests.set(request.actorClass, { ...request, contextSourceUrls: [...request.contextSourceUrls] });
    }
    screen.reviewLeads.unavailableSources.forEach((source) => unavailableSources.add(source));
    screen.reviewLeads.possiblyTruncatedSources.forEach((source) => possiblyTruncatedSources.add(source));
  }
  const pathSha256 = network.route.status === "mapped_topology_candidate" ? network.route.pathSha256 : null;
  const totalPathSegments = network.route.status === "mapped_topology_candidate" ? network.route.mappedSegmentCount : null;
  const allPathGeometryPiecesReadInThisBatch = stoppedStatus === null && query.path.startSegmentIndex === 0 &&
    nextSegmentIndex === null && screenedSegmentCount === totalPathSegments;
  return {
    schemaVersion: "civilization_corridor_scale_path_batch/v1", query, network, diplomaticContext,
    pieces,
    coverage: { pathSha256, totalPathSegments, startSegmentIndex: query.path.startSegmentIndex,
      screenedSegmentCount, nextSegmentIndex,
      status: stoppedStatus ?? (nextSegmentIndex === null ? "batch_reached_path_end" : "more_pieces_needed"),
      allPathGeometryPiecesReadInThisBatch,
      unavailableSources: [...unavailableSources].sort(), possiblyTruncatedSources: [...possiblyTruncatedSources].sort(),
      interpretation: "Complete geometric piece coverage is distinct from complete source coverage, operating service, legal rights, ecological or community effects, consent, and comparable outcomes." },
    reviewLeads: { countryDepictions: [...countryDepictions.values()], naturalFeatures: [...naturalFeatures.values()],
      nextEvidenceRequests: [...requests.values()],
      meaning: "Only available pieces in this batch contribute review leads; a missing lead is not evidence of no contact, affected party, or effect." },
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  };
}
