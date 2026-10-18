import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  civilizationCorridorScalePathBatchQuerySchema,
  civilizationCorridorScalePathBatchOutputSchema,
  readCivilizationCorridorScalePathBatch,
} from "./corridor-scale-path-batch";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

export const civilizationCorridorScalePathLedgerQuerySchema = z.object({
  batch: civilizationCorridorScalePathBatchQuerySchema,
  maxBatches: z.number().int().min(1).max(4).default(3),
}).strict().superRefine((query, context) => {
  if (!query.batch.path.expectedPathSha256) {
    context.addIssue({ code: "custom", message: "A path ledger requires an expected mapped path hash, including at segment zero." });
  }
});

const countryLeadSchema = civilizationCorridorScalePathBatchOutputSchema.shape.reviewLeads.shape.countryDepictions;
const naturalLeadSchema = civilizationCorridorScalePathBatchOutputSchema.shape.reviewLeads.shape.naturalFeatures;
const requestSchema = civilizationCorridorScalePathBatchOutputSchema.shape.reviewLeads.shape.nextEvidenceRequests;

export const civilizationPathNetworkSourceSummarySchema = z.object({
  networkReadCount: z.number().int().positive(),
  unavailableWindowSequences: z.array(z.number().int().positive()),
  possiblyTruncatedWindowSequences: z.array(z.number().int().positive()),
  graphSegmentLimitReached: z.boolean(),
  mappedNetworkMissingEvidence: z.array(z.string()),
  sourceUrls: z.array(z.string().url()),
  status: z.enum(["no_reported_network_source_gap", "reported_network_source_gap"]),
  interpretation: z.literal("These are source and graph limits across mapped-network reads; a stable path hash does not establish a complete infrastructure inventory or operating service."),
}).strict();
export type CivilizationPathNetworkSourceSummary = z.infer<typeof civilizationPathNetworkSourceSummarySchema>;

export function summarizeCivilizationPathNetworkSources(
  batches: Array<z.infer<typeof civilizationCorridorScalePathBatchOutputSchema>>,
): CivilizationPathNetworkSourceSummary {
  const unavailableWindowSequences = [...new Set(batches.flatMap((batch) => batch.network.sourceWindows
    .filter((window) => window.status === "unavailable").map((window) => window.windowSequence)))].sort((a, b) => a - b);
  const possiblyTruncatedWindowSequences = [...new Set(batches.flatMap((batch) => batch.network.sourceWindows
    .filter((window) => window.possiblyTruncated === true).map((window) => window.windowSequence)))].sort((a, b) => a - b);
  const graphSegmentLimitReached = batches.some((batch) => batch.network.coverage.graphSegmentLimitReached);
  const mappedNetworkMissingEvidence = [...new Set(batches.flatMap((batch) => batch.network.coverage.missingEvidence))].sort();
  const sourceUrls = [...new Set(batches.flatMap((batch) => batch.network.sourceWindows
    .flatMap((window) => window.sourceUrl ? [window.sourceUrl] : [])))].sort();
  return { networkReadCount: batches.length, unavailableWindowSequences,
    possiblyTruncatedWindowSequences, graphSegmentLimitReached, mappedNetworkMissingEvidence,
    sourceUrls, status: unavailableWindowSequences.length || possiblyTruncatedWindowSequences.length ||
      graphSegmentLimitReached || batches.some((batch) => batch.network.coverage.possiblyTruncated)
      ? "reported_network_source_gap" : "no_reported_network_source_gap",
    interpretation: "These are source and graph limits across mapped-network reads; a stable path hash does not establish a complete infrastructure inventory or operating service." };
}

export function combineCivilizationPathNetworkSourceSummaries(
  summaries: CivilizationPathNetworkSourceSummary[],
): CivilizationPathNetworkSourceSummary {
  return civilizationPathNetworkSourceSummarySchema.parse({
    networkReadCount: summaries.reduce((sum, item) => sum + item.networkReadCount, 0),
    unavailableWindowSequences: [...new Set(summaries.flatMap((item) => item.unavailableWindowSequences))].sort((a, b) => a - b),
    possiblyTruncatedWindowSequences: [...new Set(summaries.flatMap((item) => item.possiblyTruncatedWindowSequences))].sort((a, b) => a - b),
    graphSegmentLimitReached: summaries.some((item) => item.graphSegmentLimitReached),
    mappedNetworkMissingEvidence: [...new Set(summaries.flatMap((item) => item.mappedNetworkMissingEvidence))].sort(),
    sourceUrls: [...new Set(summaries.flatMap((item) => item.sourceUrls))].sort(),
    status: summaries.some((item) => item.status === "reported_network_source_gap")
      ? "reported_network_source_gap" : "no_reported_network_source_gap",
    interpretation: "These are source and graph limits across mapped-network reads; a stable path hash does not establish a complete infrastructure inventory or operating service.",
  });
}

export const civilizationCorridorScalePathLedgerOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_path_ledger/v2"),
  receiptId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  query: civilizationCorridorScalePathLedgerQuerySchema,
  batches: z.array(civilizationCorridorScalePathBatchOutputSchema).min(1).max(4),
  networkSourceSummary: civilizationPathNetworkSourceSummarySchema,
  coverage: z.object({
    pathSha256: z.string().regex(/^[a-f0-9]{64}$/),
    totalPathSegments: z.number().int().positive().nullable(),
    startSegmentIndex: z.number().int().nonnegative(),
    screenedSegmentCount: z.number().int().nonnegative(),
    nextSegmentIndex: z.number().int().nonnegative().nullable(),
    status: z.enum(["path_changed_or_unavailable", "source_gap", "more_batches_needed", "reached_path_end"]),
    wholePathGeometryRead: z.boolean(),
    sourceGapsReported: z.boolean(),
    unavailableSources: z.array(z.string()),
    possiblyTruncatedSources: z.array(z.string()),
    interpretation: z.literal("This ledger joins freshly read consecutive batches under one path hash. Geometric coverage does not establish complete source coverage, operations, rights, effects, consent, or comparative outcomes."),
  }).strict(),
  reviewLeads: z.object({
    countryDepictions: countryLeadSchema,
    naturalFeatures: naturalLeadSchema,
    nextEvidenceRequests: requestSchema,
    meaning: z.literal("Only available pieces in these batches contribute review leads; absence of a lead is not evidence of no contact, affected party, or effect."),
  }).strict(),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScalePathLedger = z.infer<typeof civilizationCorridorScalePathLedgerOutputSchema>;

const RECEIPT_TTL_MS = 60 * 60 * 1000;
const MAX_STORED_RECEIPTS = 32;
export type StoredCivilizationPathLedgerReceipt = Pick<CivilizationCorridorScalePathLedger,
  "receiptId" | "issuedAt" | "expiresAt" | "query" | "coverage" | "reviewLeads" | "networkSourceSummary"> & {
    networkIdentity: string;
    diplomaticContext: CivilizationCorridorScalePathLedger["batches"][number]["diplomaticContext"];
    routeSummary: { networkKind: string; mappedLengthKm: number; mappedWayRecordUrls: string[];
    mappedWayRecordUrlsOmitted: number; snappedEndpoints: { start: { lat: number; lon: number };
      end: { lat: number; lon: number }; originSnapDistanceKm: number; destinationSnapDistanceKm: number } | null } | null;
  };
const storedReceipts = new Map<string, StoredCivilizationPathLedgerReceipt>();

function expireOldReceipts(now: number) {
  for (const [id, receipt] of storedReceipts) {
    if (Date.parse(receipt.expiresAt) <= now) storedReceipts.delete(id);
  }
  while (storedReceipts.size > MAX_STORED_RECEIPTS) {
    const oldest = storedReceipts.keys().next().value;
    if (!oldest) break;
    storedReceipts.delete(oldest);
  }
}

export function readStoredCivilizationPathLedgerReceipt(id: string): StoredCivilizationPathLedgerReceipt | null {
  expireOldReceipts(Date.now());
  return storedReceipts.get(id) ?? null;
}

export async function readCivilizationCorridorScalePathLedger(input: unknown): Promise<CivilizationCorridorScalePathLedger> {
  const parsed = civilizationCorridorScalePathLedgerQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Corridor path ledger query is invalid.");
  const query = parsed.data;
  const pathSha256 = query.batch.path.expectedPathSha256!;
  const batches: CivilizationCorridorScalePathLedger["batches"] = [];
  const countries = new Map<string, CivilizationCorridorScalePathLedger["reviewLeads"]["countryDepictions"][number]>();
  const natural = new Map<string, CivilizationCorridorScalePathLedger["reviewLeads"]["naturalFeatures"][number]>();
  const requests = new Map<string, CivilizationCorridorScalePathLedger["reviewLeads"]["nextEvidenceRequests"][number]>();
  const unavailableSources = new Set<string>();
  const possiblyTruncatedSources = new Set<string>();
  let nextSegmentIndex: number | null = query.batch.path.startSegmentIndex;
  let screenedSegmentCount = 0;
  let totalPathSegments: number | null = null;
  let stopped: "path_changed_or_unavailable" | "source_gap" | null = null;
  for (let index = 0; index < query.maxBatches && nextSegmentIndex !== null; index++) {
    const batch = await readCivilizationCorridorScalePathBatch({
      ...query.batch,
      path: { ...query.batch.path, startSegmentIndex: nextSegmentIndex, expectedPathSha256: pathSha256,
        ...(index > 0 ? { diplomaticIssueId: undefined } : {}) },
    });
    batches.push(batch);
    if (batch.coverage.pathSha256 !== pathSha256 || batch.coverage.startSegmentIndex !== nextSegmentIndex ||
        (totalPathSegments !== null && batch.coverage.totalPathSegments !== totalPathSegments) ||
        batch.coverage.status === "path_not_screenable") {
      stopped = "path_changed_or_unavailable";
      break;
    }
    totalPathSegments = batch.coverage.totalPathSegments;
    screenedSegmentCount += batch.coverage.screenedSegmentCount;
    nextSegmentIndex = batch.coverage.nextSegmentIndex;
    batch.coverage.unavailableSources.forEach((source) => unavailableSources.add(source));
    batch.coverage.possiblyTruncatedSources.forEach((source) => possiblyTruncatedSources.add(source));
    for (const country of batch.reviewLeads.countryDepictions) {
      countries.set(`${country.sourceFeatureId}:${country.sourceUrl}`, country);
    }
    for (const feature of batch.reviewLeads.naturalFeatures) {
      const key = `${feature.kind}:${feature.featureId}:${feature.sourceUrl}`;
      const prior = natural.get(key);
      if (prior) prior.pathSegmentIndices = [...new Set([...prior.pathSegmentIndices, ...feature.pathSegmentIndices])].sort((a, b) => a - b);
      else natural.set(key, { ...feature, pathSegmentIndices: [...feature.pathSegmentIndices] });
    }
    for (const request of batch.reviewLeads.nextEvidenceRequests) {
      const prior = requests.get(request.actorClass);
      if (prior) prior.contextSourceUrls = [...new Set([...prior.contextSourceUrls, ...request.contextSourceUrls])];
      else requests.set(request.actorClass, { ...request, contextSourceUrls: [...request.contextSourceUrls] });
    }
    if (batch.coverage.status === "source_piece_unavailable") {
      stopped = "source_gap";
      break;
    }
    if (batch.coverage.screenedSegmentCount === 0 && nextSegmentIndex !== null) {
      stopped = "source_gap";
      break;
    }
  }
  const status = stopped ?? (nextSegmentIndex === null ? "reached_path_end" : "more_batches_needed");
  const wholePathGeometryRead = status === "reached_path_end" && query.batch.path.startSegmentIndex === 0 &&
    totalPathSegments !== null && screenedSegmentCount === totalPathSegments;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(issuedAt) + RECEIPT_TTL_MS).toISOString();
  const receiptId = randomUUID();
  const result: CivilizationCorridorScalePathLedger = {
    schemaVersion: "civilization_corridor_scale_path_ledger/v2", receiptId, issuedAt, expiresAt, query, batches,
    networkSourceSummary: summarizeCivilizationPathNetworkSources(batches),
    coverage: { pathSha256, totalPathSegments, startSegmentIndex: query.batch.path.startSegmentIndex,
      screenedSegmentCount, nextSegmentIndex, status, wholePathGeometryRead,
      sourceGapsReported: unavailableSources.size > 0 || possiblyTruncatedSources.size > 0 || stopped === "source_gap",
      unavailableSources: [...unavailableSources].sort(), possiblyTruncatedSources: [...possiblyTruncatedSources].sort(),
      interpretation: "This ledger joins freshly read consecutive batches under one path hash. Geometric coverage does not establish complete source coverage, operations, rights, effects, consent, or comparative outcomes." },
    reviewLeads: { countryDepictions: [...countries.values()], naturalFeatures: [...natural.values()],
      nextEvidenceRequests: [...requests.values()],
      meaning: "Only available pieces in these batches contribute review leads; absence of a lead is not evidence of no contact, affected party, or effect." },
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  };
  expireOldReceipts(Date.now());
  const route = batches[0].network.route;
  storedReceipts.set(receiptId, {
    receiptId, issuedAt, expiresAt, query, coverage: result.coverage, reviewLeads: result.reviewLeads,
    networkSourceSummary: result.networkSourceSummary,
    networkIdentity: createHash("sha256").update(JSON.stringify(query.batch.path.network)).digest("hex"),
    diplomaticContext: batches[0].diplomaticContext,
    routeSummary: route.status === "mapped_topology_candidate" ? {
      networkKind: query.batch.path.network.networkKind,
      mappedLengthKm: route.mappedLengthKm,
      mappedWayRecordUrls: route.mappedWayRecordUrls,
      mappedWayRecordUrlsOmitted: route.mappedWayRecordUrlsOmitted,
      snappedEndpoints: route.pathGeometry.status === "complete" ? {
        start: route.pathGeometry.segments[0].from,
        end: route.pathGeometry.segments[route.pathGeometry.segments.length - 1].to,
        originSnapDistanceKm: route.originSnapDistanceKm,
        destinationSnapDistanceKm: route.destinationSnapDistanceKm,
      } : null,
    } : null,
  });
  expireOldReceipts(Date.now());
  return result;
}
