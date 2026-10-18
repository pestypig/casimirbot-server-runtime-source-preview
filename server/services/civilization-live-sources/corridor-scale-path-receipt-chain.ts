import { z } from "zod";
import { civilizationCorridorScalePathBatchOutputSchema } from "./corridor-scale-path-batch";
import { civilizationCorridorScaleNetworkQuerySchema } from "./corridor-scale-network-topology";
import {
  civilizationCorridorScalePathLedgerOutputSchema,
  civilizationPathNetworkSourceSummarySchema,
  combineCivilizationPathNetworkSourceSummaries,
  readStoredCivilizationPathLedgerReceipt,
  type StoredCivilizationPathLedgerReceipt,
} from "./corridor-scale-path-ledger";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

export const civilizationCorridorScalePathReceiptChainQuerySchema = z.object({
  receiptIds: z.array(z.string().uuid()).min(2).max(16),
}).strict().superRefine((query, context) => {
  if (new Set(query.receiptIds).size !== query.receiptIds.length) {
    context.addIssue({ code: "custom", message: "Each ledger receipt may appear only once." });
  }
});

export const civilizationCorridorScalePathReceiptChainOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_path_receipt_chain/v3"),
  query: civilizationCorridorScalePathReceiptChainQuerySchema,
  receipts: z.array(z.object({
    receiptId: z.string().uuid(), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
    coverage: civilizationCorridorScalePathLedgerOutputSchema.shape.coverage,
    networkSourceSummary: civilizationPathNetworkSourceSummarySchema,
  }).strict()).min(2).max(16),
  networkSourceSummary: civilizationPathNetworkSourceSummarySchema,
  networkQuery: civilizationCorridorScaleNetworkQuerySchema,
  networkKind: z.string(),
  mappedLengthKm: z.number().nonnegative(),
  snappedEndpoints: z.object({ start: z.object({ lat: z.number(), lon: z.number() }).strict(),
    end: z.object({ lat: z.number(), lon: z.number() }).strict(),
    originSnapDistanceKm: z.number().nonnegative(), destinationSnapDistanceKm: z.number().nonnegative() }).strict(),
  mappedWayRecordUrls: z.array(z.string().url()),
  mappedWayRecordUrlsOmitted: z.number().int().nonnegative(),
  diplomaticContext: civilizationCorridorScalePathBatchOutputSchema.shape.diplomaticContext,
  coverage: z.object({
    pathSha256: z.string().regex(/^[a-f0-9]{64}$/),
    totalPathSegments: z.number().int().positive(),
    startSegmentIndex: z.number().int().nonnegative(),
    screenedSegmentCount: z.number().int().nonnegative(),
    nextSegmentIndex: z.number().int().nonnegative().nullable(),
    status: z.enum(["source_gap", "more_receipts_needed", "reached_path_end"]),
    wholePathGeometryRead: z.boolean(),
    sourceGapsReported: z.boolean(),
    unavailableSources: z.array(z.string()),
    possiblyTruncatedSources: z.array(z.string()),
    earliestReadAt: z.string().datetime(),
    latestReadAt: z.string().datetime(),
    interpretation: z.literal("Server-held receipts prove a contiguous mapped geometry read during this server run. Reads occurred at different times; cartographic leads do not establish complete source coverage, service, rights, effects, consent, or comparative outcomes."),
  }).strict(),
  reviewLeads: civilizationCorridorScalePathLedgerOutputSchema.shape.reviewLeads,
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScalePathReceiptChain = z.infer<typeof civilizationCorridorScalePathReceiptChainOutputSchema>;

function invalidChain(message: string): never {
  throw new CivilizationGeospatialSourceError("invalid_query", message);
}

export function readCivilizationCorridorScalePathReceiptChain(input: unknown): CivilizationCorridorScalePathReceiptChain {
  const parsed = civilizationCorridorScalePathReceiptChainQuerySchema.safeParse(input);
  if (!parsed.success) invalidChain("Path receipt chain query is invalid.");
  const query = parsed.data;
  const receipts = query.receiptIds.map((id) => readStoredCivilizationPathLedgerReceipt(id));
  if (receipts.some((receipt) => !receipt)) invalidChain("A path ledger receipt has expired or is unavailable on this server; reread that path span.");
  const held = receipts as StoredCivilizationPathLedgerReceipt[];
  const first = held[0];
  const route = first.routeSummary;
  if (!route || first.coverage.totalPathSegments === null || first.coverage.status === "path_changed_or_unavailable") {
    invalidChain("The first receipt does not contain a stable mapped path.");
  }
  if (!route.snappedEndpoints) invalidChain("The mapped path must include complete snapped endpoint geometry.");
  const pathSha256 = first.coverage.pathSha256;
  const totalPathSegments = first.coverage.totalPathSegments;
  const countries = new Map<string, CivilizationCorridorScalePathReceiptChain["reviewLeads"]["countryDepictions"][number]>();
  const natural = new Map<string, CivilizationCorridorScalePathReceiptChain["reviewLeads"]["naturalFeatures"][number]>();
  const requests = new Map<string, CivilizationCorridorScalePathReceiptChain["reviewLeads"]["nextEvidenceRequests"][number]>();
  const unavailableSources = new Set<string>();
  const possiblyTruncatedSources = new Set<string>();
  let expectedStart = first.coverage.startSegmentIndex;
  let screenedSegmentCount = 0;
  for (const [index, receipt] of held.entries()) {
    const coverage = receipt.coverage;
    if (index > 0 && held[index - 1].coverage.nextSegmentIndex === null) {
      invalidChain("A path-end receipt cannot have a continuation.");
    }
    if (receipt.networkIdentity !== first.networkIdentity || coverage.pathSha256 !== pathSha256 ||
        coverage.totalPathSegments !== totalPathSegments || coverage.status === "path_changed_or_unavailable" ||
        !receipt.routeSummary || receipt.routeSummary.mappedLengthKm !== route.mappedLengthKm ||
        JSON.stringify(receipt.routeSummary.snappedEndpoints) !== JSON.stringify(route.snappedEndpoints) ||
        coverage.startSegmentIndex !== expectedStart) {
      invalidChain("Receipts must use one mapped network, path identity, total segment count, and consecutive ranges.");
    }
    const end = coverage.startSegmentIndex + coverage.screenedSegmentCount;
    if (coverage.nextSegmentIndex !== null && coverage.nextSegmentIndex !== end) {
      invalidChain("A receipt's continuation cursor does not match its screened segment range.");
    }
    if (coverage.nextSegmentIndex === null && (coverage.status !== "reached_path_end" || end !== totalPathSegments)) {
      invalidChain("A receipt reports the path end without covering the remaining mapped geometry.");
    }
    expectedStart = coverage.nextSegmentIndex ?? totalPathSegments;
    screenedSegmentCount += coverage.screenedSegmentCount;
    coverage.unavailableSources.forEach((source) => unavailableSources.add(source));
    coverage.possiblyTruncatedSources.forEach((source) => possiblyTruncatedSources.add(source));
    for (const country of receipt.reviewLeads.countryDepictions) {
      countries.set(`${country.sourceFeatureId}:${country.sourceUrl}`, country);
    }
    for (const feature of receipt.reviewLeads.naturalFeatures) {
      const key = `${feature.kind}:${feature.featureId}:${feature.sourceUrl}`;
      const prior = natural.get(key);
      if (prior) prior.pathSegmentIndices = [...new Set([...prior.pathSegmentIndices, ...feature.pathSegmentIndices])].sort((a, b) => a - b);
      else natural.set(key, { ...feature, pathSegmentIndices: [...feature.pathSegmentIndices] });
    }
    for (const request of receipt.reviewLeads.nextEvidenceRequests) {
      const prior = requests.get(request.actorClass);
      if (prior) prior.contextSourceUrls = [...new Set([...prior.contextSourceUrls, ...request.contextSourceUrls])];
      else requests.set(request.actorClass, { ...request, contextSourceUrls: [...request.contextSourceUrls] });
    }
  }
  const last = held[held.length - 1];
  const nextSegmentIndex = last.coverage.nextSegmentIndex;
  const status = nextSegmentIndex === null ? "reached_path_end" as const :
    last.coverage.status === "source_gap" ? "source_gap" as const : "more_receipts_needed" as const;
  const sourceGapsReported = held.some((receipt) => receipt.coverage.sourceGapsReported);
  const times = held.map((receipt) => receipt.issuedAt).sort();
  return {
    schemaVersion: "civilization_corridor_scale_path_receipt_chain/v3", query,
    receipts: held.map((receipt) => ({ receiptId: receipt.receiptId, issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt, coverage: receipt.coverage,
      networkSourceSummary: receipt.networkSourceSummary })),
    networkSourceSummary: combineCivilizationPathNetworkSourceSummaries(held.map((receipt) => receipt.networkSourceSummary)),
    networkQuery: first.query.batch.path.network,
    networkKind: route.networkKind, mappedLengthKm: route.mappedLengthKm,
    snappedEndpoints: route.snappedEndpoints,
    mappedWayRecordUrls: route.mappedWayRecordUrls, mappedWayRecordUrlsOmitted: route.mappedWayRecordUrlsOmitted,
    diplomaticContext: first.diplomaticContext,
    coverage: { pathSha256, totalPathSegments, startSegmentIndex: first.coverage.startSegmentIndex,
      screenedSegmentCount, nextSegmentIndex, status,
      wholePathGeometryRead: first.coverage.startSegmentIndex === 0 && nextSegmentIndex === null &&
        screenedSegmentCount === totalPathSegments,
      sourceGapsReported, unavailableSources: [...unavailableSources].sort(),
      possiblyTruncatedSources: [...possiblyTruncatedSources].sort(),
      earliestReadAt: times[0], latestReadAt: times[times.length - 1],
      interpretation: "Server-held receipts prove a contiguous mapped geometry read during this server run. Reads occurred at different times; cartographic leads do not establish complete source coverage, service, rights, effects, consent, or comparative outcomes." },
    reviewLeads: { countryDepictions: [...countries.values()], naturalFeatures: [...natural.values()],
      nextEvidenceRequests: [...requests.values()],
      meaning: "Only available pieces in these batches contribute review leads; absence of a lead is not evidence of no contact, affected party, or effect." },
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  };
}
