import { z } from "zod";
import {
  civilizationCorridorScalePlanQuerySchema,
  civilizationCorridorScalePlanOutputSchema,
  civilizationCorridorScaleWindowSchema,
  planCivilizationCorridorScaleEvidence,
} from "./corridor-scale-evidence-plan";
import {
  civilizationCorridorScaleWindowEvidenceOutputSchema,
  readCivilizationCorridorScaleWindowEvidence,
} from "./corridor-scale-window-evidence";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

export const civilizationCorridorScaleBatchQuerySchema = z.object({
  plan: civilizationCorridorScalePlanQuerySchema,
  startWindowSequence: z.number().int().positive(),
  maxWindows: z.number().int().min(1).max(3).default(2),
}).strict();

const windowReadSchema = z.object({
  window: civilizationCorridorScaleWindowSchema,
  screen: civilizationCorridorScaleWindowEvidenceOutputSchema.shape.screen,
  sourceSummary: z.object({
    countryDepictionCodes: z.array(z.string()),
    mappedInfrastructureContactCount: z.number().int().nonnegative().nullable(),
    terrestrialContactCount: z.number().int().nonnegative().nullable(),
    hydrographyContactCount: z.number().int().nonnegative().nullable(),
    intersectingPublishedWetlandCount: z.number().int().nonnegative().nullable(),
    unavailableSources: z.array(z.string()),
    possiblyTruncatedSources: z.array(z.string()),
    sourceRecordUrls: z.array(z.string().url()),
  }).strict(),
}).strict();

const seamSchema = z.object({
  firstWindowSequence: z.number().int().positive(),
  secondWindowSequence: z.number().int().positive(),
  sketchGeometryRelation: z.enum(["same_endpoint", "date_line_equivalent_endpoint", "unresolved_endpoint"]),
  bothLocalScreensAvailable: z.boolean(),
  sharedMappedWayRecordUrls: z.array(z.string().url()),
  mappedNetworkContinuity: z.literal("unverified"),
  missingEvidence: z.array(z.string()),
}).strict();

export const civilizationCorridorScaleBatchOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_batch_evidence/v1"),
  query: civilizationCorridorScaleBatchQuerySchema,
  planCoverage: civilizationCorridorScalePlanOutputSchema.shape.coverage,
  batchCoverage: z.object({
    returnedWindowCount: z.number().int().min(1).max(3),
    availableLocalScreenCount: z.number().int().nonnegative(),
    unavailableLocalScreenCount: z.number().int().nonnegative(),
    nextWindowSequence: z.number().int().positive().nullable(),
    plannedWindowsNotReadInThisBatch: z.number().int().nonnegative(),
    unplannedWindowCount: z.number().int().nonnegative(),
    allPlannedWindowsReadInThisBatch: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
  windows: z.array(windowReadSchema).min(1).max(3),
  seams: z.array(seamSchema).max(2),
  interpretation: z.literal("This batch compares at most three sequential source screens along a caller sketch. Shared mapped-way citations and adjoining sketch endpoints are review leads, not mapped-network continuity, valid operating connections, ecological impact, legal jurisdiction, permission, or a feasible international route."),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScaleBatchEvidence = z.infer<typeof civilizationCorridorScaleBatchOutputSchema>;

function sameEndpoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }):
  "same_endpoint" | "date_line_equivalent_endpoint" | "unresolved_endpoint" {
  if (Math.abs(a.lat - b.lat) > 1e-8) return "unresolved_endpoint";
  if (Math.abs(a.lon - b.lon) <= 1e-8) return "same_endpoint";
  if (Math.abs(Math.abs(a.lon - b.lon) - 360) <= 1e-8) return "date_line_equivalent_endpoint";
  return "unresolved_endpoint";
}

export async function readCivilizationCorridorScaleBatchEvidence(input: unknown): Promise<CivilizationCorridorScaleBatchEvidence> {
  const parsed = civilizationCorridorScaleBatchQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Corridor-scale batch query is invalid.");
  const query = parsed.data;
  const plan = planCivilizationCorridorScaleEvidence(query.plan);
  if (query.startWindowSequence > plan.windows.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Start window is outside the returned plan budget.");
  }
  const selected = plan.windows.slice(query.startWindowSequence - 1,
    query.startWindowSequence - 1 + query.maxWindows);
  const windows: CivilizationCorridorScaleBatchEvidence["windows"] = [];
  for (const window of selected) {
    const result = await readCivilizationCorridorScaleWindowEvidence({
      plan: plan.query, windowSequence: window.sequence,
    });
    const screen = result.screen;
    if (screen.status === "unavailable") {
      windows.push({ window, screen, sourceSummary: {
        countryDepictionCodes: [], mappedInfrastructureContactCount: null,
        terrestrialContactCount: null, hydrographyContactCount: null,
        intersectingPublishedWetlandCount: null,
        unavailableSources: ["local_source_screen"], possiblyTruncatedSources: [], sourceRecordUrls: [],
      } });
      continue;
    }
    const evidence = screen.evidence;
    const unavailableSources = [
      ...(["boundaryLines", "mappedInfrastructure", "terrestrialDepictions", "hydrography", "lakeReview",
        "ramsarAreaReview", "terrainPoints", "globalReliefPoints"] as const)
        .filter((key) => evidence[key].status === "unavailable"),
      ...evidence.administrativeBoundaries.filter((entry) => entry.status === "unavailable")
        .map((entry) => `administrativeBoundary:${entry.countryIso3}`),
    ];
    const possiblyTruncatedSources = [
      ...(["boundaryLines", "mappedInfrastructure", "terrestrialDepictions", "hydrography", "lakeReview", "ramsarAreaReview"] as const)
        .filter((key) => "possiblyTruncated" in evidence[key] && evidence[key].possiblyTruncated === true),
      ...(evidence.countryGeometryScreen.possiblyTruncated ? ["countryGeometryScreen"] : []),
      ...evidence.administrativeBoundaries.filter((entry) => entry.status === "available" && entry.possiblyTruncated)
        .map((entry) => `administrativeBoundary:${entry.countryIso3}`),
    ];
    const sourceRecordUrls = new Set<string>([
      evidence.countryGeometryScreen.sourceRecordUrl,
      ...(evidence.boundaryLines.status === "available" ? [evidence.boundaryLines.source.sourceRecordUrl] : []),
      ...(evidence.mappedInfrastructure.status === "available" ? [evidence.mappedInfrastructure.source.sourceUrl] : []),
      ...(evidence.mappedInfrastructure.status === "available" ? evidence.mappedInfrastructure.contacts.map((contact) => contact.sourceRecordUrl) : []),
      ...(evidence.terrestrialDepictions.status === "available" ? [evidence.terrestrialDepictions.source.sourceUrl] : []),
      ...(evidence.terrestrialDepictions.status === "available" ? evidence.terrestrialDepictions.contacts.map((contact) => contact.sourceRecordUrl) : []),
      ...(evidence.hydrography.status === "available" ? evidence.hydrography.contacts.map((contact) => contact.sourceRecordUrl) : []),
      ...(evidence.lakeReview.status === "available" ? [evidence.lakeReview.source.sourcePageUrl] : []),
      ...(evidence.lakeReview.status === "available" ? evidence.lakeReview.contacts.map((contact) => contact.sourceRecordUrl) : []),
      ...(evidence.ramsarAreaReview.status === "available" ? evidence.ramsarAreaReview.sites.map((site) => site.sourceRecordUrl) : []),
    ]);
    windows.push({ window, screen, sourceSummary: {
      countryDepictionCodes: [...new Set(evidence.countryGeometryScreen.contacts.map((contact) =>
        contact.isoA3 ?? contact.editorialAdm0A3))].sort(),
      mappedInfrastructureContactCount: evidence.mappedInfrastructure.status === "available" ? evidence.mappedInfrastructure.contacts.length : null,
      terrestrialContactCount: evidence.terrestrialDepictions.status === "available" ? evidence.terrestrialDepictions.contacts.length : null,
      hydrographyContactCount: evidence.hydrography.status === "available" ? evidence.hydrography.contacts.length : null,
      intersectingPublishedWetlandCount: evidence.ramsarAreaReview.status === "available" ? evidence.ramsarAreaReview.sites.filter((site) =>
        site.relation === "intersects_published_depiction").length : null,
      unavailableSources, possiblyTruncatedSources, sourceRecordUrls: [...sourceRecordUrls].sort(),
    } });
  }
  const seams: CivilizationCorridorScaleBatchEvidence["seams"] = [];
  for (let index = 0; index < windows.length - 1; index++) {
    const first = windows[index];
    const second = windows[index + 1];
    const firstContacts = first.screen.status === "available" && first.screen.evidence.mappedInfrastructure.status === "available"
      ? first.screen.evidence.mappedInfrastructure.contacts : [];
    const secondContacts = second.screen.status === "available" && second.screen.evidence.mappedInfrastructure.status === "available"
      ? second.screen.evidence.mappedInfrastructure.contacts : [];
    const secondUrls = new Set(secondContacts.map((contact) => contact.sourceRecordUrl));
    const sharedMappedWayRecordUrls = [...new Set(firstContacts.map((contact) => contact.sourceRecordUrl)
      .filter((url) => secondUrls.has(url)))].sort();
    seams.push({
      firstWindowSequence: first.window.sequence,
      secondWindowSequence: second.window.sequence,
      sketchGeometryRelation: sameEndpoint(first.window.to, second.window.from),
      bothLocalScreensAvailable: first.screen.status === "available" && second.screen.status === "available",
      sharedMappedWayRecordUrls,
      mappedNetworkContinuity: "unverified",
      missingEvidence: [
        "Matching sketch endpoints do not establish a mapped network connection or a buildable crossing.",
        "Shared OSM way citations, if any, do not verify through-service, capacity, access, flow direction, or rights.",
        "Source completeness, dates, affected parties, and conditions must be reconciled on both sides of the seam.",
      ],
    });
  }
  const lastSequence = selected[selected.length - 1].sequence;
  const availableLocalScreenCount = windows.filter((window) => window.screen.status === "available").length;
  return {
    schemaVersion: "civilization_corridor_scale_batch_evidence/v1",
    query,
    planCoverage: plan.coverage,
    batchCoverage: {
      returnedWindowCount: windows.length,
      availableLocalScreenCount,
      unavailableLocalScreenCount: windows.length - availableLocalScreenCount,
      nextWindowSequence: lastSequence < plan.windows.length ? lastSequence + 1 : null,
      plannedWindowsNotReadInThisBatch: plan.windows.length - windows.length,
      unplannedWindowCount: plan.coverage.unplannedWindowCount,
      allPlannedWindowsReadInThisBatch: query.startWindowSequence === 1 && windows.length === plan.windows.length,
      missingEvidence: [
        "Only this bounded batch was read; other planned windows may be unread or unavailable.",
        "A local screen can contain independent source failures or truncation even when its overall status is available.",
        "No mapped-network continuity, operating service, legal route, ecological effect, consent, or optimum has been established.",
      ],
    },
    windows, seams,
    interpretation: "This batch compares at most three sequential source screens along a caller sketch. Shared mapped-way citations and adjoining sketch endpoints are review leads, not mapped-network continuity, valid operating connections, ecological impact, legal jurisdiction, permission, or a feasible international route.",
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  };
}
