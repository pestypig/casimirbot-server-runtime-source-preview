import { z } from "zod";
import { civilizationPairGlanceOutputSchema, readCivilizationPairGlance } from "../civilization-diplomacy/pair-glance";
import { planCivilizationCorridorScaleEvidence } from "./corridor-scale-evidence-plan";
import {
  civilizationCorridorScaleNetworkQuerySchema,
  civilizationCorridorScaleNetworkOutputSchema,
  readCivilizationCorridorScaleNetworkTopology,
} from "./corridor-scale-network-topology";
import { civilizationProposedCorridorOutputSchema, readProposedCorridorScreen } from "./proposed-corridor-screen";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

const MAX_SEGMENTS_PER_SCREEN = 11;
const reviewLeadSchema = z.object({
  countryDepictions: z.array(z.object({
    sourceFeatureId: z.string(), countryIso3: z.string().regex(/^[A-Z]{3}$/).nullable(),
    editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/), name: z.string(), sourceUrl: z.string().url(),
    boundaryContactSegments: z.number().int().nonnegative(), interiorSegments: z.number().int().nonnegative(),
    meaning: z.literal("cartographic_contact_not_jurisdiction_or_government_position"),
  }).strict()),
  naturalFeatures: z.array(z.object({
    kind: z.enum(["waterway", "lake", "published_wetland", "terrestrial_depiction"]),
    featureId: z.string(), label: z.string(), sourceUrl: z.string().url(),
    pieceSegmentIndices: z.array(z.number().int().nonnegative()),
    meaning: z.literal("source_depiction_contact_not_impact_or_permission"),
  }).strict()),
  unavailableSources: z.array(z.string()), possiblyTruncatedSources: z.array(z.string()),
  nextEvidenceRequests: z.array(z.object({
    actorClass: z.enum(["competent_country_authorities", "environmental_and_water_authorities",
      "land_and_conservation_authorities", "infrastructure_operators_and_engineers",
      "affected_communities_and_rights_holders"]),
    question: z.string().min(1), contextSourceUrls: z.array(z.string().url()),
    status: z.literal("needed_not_obtained"),
  }).strict()),
  interpretation: z.literal("These are review leads from one mapped path piece, not identified affected parties, current impacts, legal rights, consent, or option outcomes."),
}).strict();
export const civilizationCorridorScalePathReviewLeadSchema = reviewLeadSchema;

export const civilizationCorridorScalePathScreenQuerySchema = z.object({
  network: civilizationCorridorScaleNetworkQuerySchema,
  startSegmentIndex: z.number().int().min(0).max(999),
  expectedPathSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  diplomaticIssueId: z.enum(["regional_connectivity", "natural_system_cooperation", "humanitarian_cooperation"]).optional(),
}).strict().superRefine((query, context) => {
  if (query.startSegmentIndex > 0 && !query.expectedPathSha256) {
    context.addIssue({ code: "custom", message: "A continuation requires the expected mapped path hash." });
  }
  if (query.diplomaticIssueId && query.network.plan.countryIso3s.length !== 2) {
    context.addIssue({ code: "custom", message: "Diplomatic context requires two selected country affiliations." });
  }
});

export const civilizationCorridorScalePathScreenOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_path_screen/v3"),
  query: civilizationCorridorScalePathScreenQuerySchema,
  network: civilizationCorridorScaleNetworkOutputSchema,
  diplomaticContext: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_requested") }).strict(),
    z.object({ status: z.literal("available"), pairGlance: civilizationPairGlanceOutputSchema,
      relationToMappedPath: z.literal("selected_public_position_context_not_alignment_support_or_permission"),
      nextQuestion: z.string().min(1) }).strict(),
    z.object({ status: z.literal("unavailable"), reason: z.string().min(1) }).strict(),
  ]),
  screen: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), windowSequence: z.number().int().positive(),
      startSegmentIndex: z.number().int().nonnegative(), screenedSegmentCount: z.number().int().min(1).max(MAX_SEGMENTS_PER_SCREEN),
      nextSegmentIndex: z.number().int().nonnegative().nullable(),
      evidence: civilizationProposedCorridorOutputSchema, reviewLeads: reviewLeadSchema }).strict(),
    z.object({ status: z.literal("unavailable"), windowSequence: z.number().int().positive(),
      startSegmentIndex: z.number().int().nonnegative(), screenedSegmentCount: z.number().int().min(1).max(MAX_SEGMENTS_PER_SCREEN),
      nextSegmentIndex: z.number().int().nonnegative().nullable(), reason: z.string().min(1) }).strict(),
    z.object({ status: z.literal("not_screenable"), reason: z.enum([
      "no_mapped_path", "path_geometry_exceeds_response_limit", "mapped_path_changed",
    ]) }).strict(),
  ]),
  relationToWholePath: z.literal("one_bounded_exact_osm_node_piece_other_path_segments_and_source_gaps_remain_unreviewed"),
  missingEvidence: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScalePathScreen = z.infer<typeof civilizationCorridorScalePathScreenOutputSchema>;

function deriveReviewLeads(evidence: z.infer<typeof civilizationProposedCorridorOutputSchema>,
  pathSourceUrls: string[]): z.infer<typeof reviewLeadSchema> {
  const countryDepictions = evidence.countryGeometryScreen.contacts.map((contact) => ({
    sourceFeatureId: contact.sourceFeatureId, countryIso3: contact.isoA3,
    editorialAdm0A3: contact.editorialAdm0A3, name: contact.name,
    sourceUrl: evidence.countryGeometryScreen.sourceRecordUrl,
    boundaryContactSegments: contact.boundaryContactSegments, interiorSegments: contact.interiorSegments,
    meaning: "cartographic_contact_not_jurisdiction_or_government_position" as const,
  }));
  const naturalFeatures: z.infer<typeof reviewLeadSchema>["naturalFeatures"] = [];
  const addFeature = (kind: typeof naturalFeatures[number]["kind"], featureId: string, label: string,
    sourceUrl: string, segmentIndex: number) => {
    const prior = naturalFeatures.find((feature) => feature.kind === kind && feature.featureId === featureId);
    if (prior) {
      if (!prior.pieceSegmentIndices.includes(segmentIndex)) prior.pieceSegmentIndices.push(segmentIndex);
    } else naturalFeatures.push({ kind, featureId, label, sourceUrl, pieceSegmentIndices: [segmentIndex],
      meaning: "source_depiction_contact_not_impact_or_permission" });
  };
  if (evidence.hydrography.status === "available") for (const contact of evidence.hydrography.contacts) {
    addFeature("waterway", contact.lineId, contact.lineLabel, contact.sourceRecordUrl, contact.sketchSegmentIndex);
  }
  if (evidence.lakeReview.status === "available") for (const contact of evidence.lakeReview.contacts) {
    addFeature("lake", String(contact.lakeFeatureId), contact.lakeLabel, contact.sourceRecordUrl, contact.segmentIndex);
  }
  if (evidence.ramsarAreaReview.status === "available") for (const site of evidence.ramsarAreaReview.sites) {
    if (site.relation !== "intersects_published_depiction") continue;
    for (const segmentIndex of site.alignmentSegmentIndices) {
      addFeature("published_wetland", String(site.siteNumber), site.name, site.sourceRecordUrl, segmentIndex);
    }
  }
  for (const site of evidence.designatedWetlands.sites) {
    if (site.relation !== "intersects_published_depiction") continue;
    for (const segmentIndex of site.alignmentSegmentIndices) {
      addFeature("published_wetland", String(site.siteNumber), site.name,
        evidence.designatedWetlands.source.url, segmentIndex);
    }
  }
  if (evidence.terrestrialDepictions.status === "available") for (const contact of evidence.terrestrialDepictions.contacts) {
    addFeature("terrestrial_depiction", contact.featureId, contact.featureName ?? contact.featureKind,
      contact.sourceRecordUrl, contact.sketchSegmentIndex);
  }
  const unavailableSources = [
    ...(["boundaryLines", "hydrography", "lakeReview", "terrestrialDepictions", "ramsarAreaReview"] as const)
      .filter((key) => evidence[key].status === "unavailable"),
    ...evidence.administrativeBoundaries.filter((country) => country.status === "unavailable")
      .map((country) => `administrativeBoundary:${country.countryIso3}`),
  ];
  const possiblyTruncatedSources = [
    ...(["boundaryLines", "hydrography", "lakeReview", "terrestrialDepictions", "ramsarAreaReview"] as const)
      .filter((key) => "possiblyTruncated" in evidence[key] && evidence[key].possiblyTruncated === true),
    ...(evidence.countryGeometryScreen.possiblyTruncated ? ["countryGeometryScreen"] : []),
    ...evidence.administrativeBoundaries.filter((country) => country.status === "available" && country.possiblyTruncated)
      .map((country) => `administrativeBoundary:${country.countryIso3}`),
  ];
  const featureUrls = (kinds: typeof naturalFeatures[number]["kind"][]) =>
    [...new Set(naturalFeatures.filter((feature) => kinds.includes(feature.kind)).map((feature) => feature.sourceUrl))];
  const nextEvidenceRequests: z.infer<typeof reviewLeadSchema>["nextEvidenceRequests"] = [
    { actorClass: "infrastructure_operators_and_engineers", question: "Verify current asset identity, physical continuity, compatible transfers, operation, direction, capacity, and usable access along this exact mapped piece.",
      contextSourceUrls: pathSourceUrls, status: "needed_not_obtained" },
    { actorClass: "affected_communities_and_rights_holders", question: "Identify people and rights holders along the actual alignment and obtain their views and applicable consultation records before assessing distributional effects.",
      contextSourceUrls: pathSourceUrls, status: "needed_not_obtained" },
    ...(countryDepictions.length || evidence.boundaryLines.status === "available" && evidence.boundaryLines.contacts.length
      ? [{ actorClass: "competent_country_authorities" as const,
      question: "Verify current legal boundaries, jurisdiction, crossing terms, and any required permissions for this exact alignment; a cartographic contact alone decides none of them.",
      contextSourceUrls: [...new Set([...countryDepictions.map((country) => country.sourceUrl),
        ...(evidence.boundaryLines.status === "available" ? evidence.boundaryLines.contacts.map((contact) => contact.sourceRecordUrl) : [])])],
      status: "needed_not_obtained" as const }] : []),
    ...(featureUrls(["waterway", "lake", "published_wetland"]).length ? [{ actorClass: "environmental_and_water_authorities" as const,
      question: "Check current water, wetland, and protected-site extent, management rules, crossings, ecological effects, and any required assessment for this alignment.",
      contextSourceUrls: featureUrls(["waterway", "lake", "published_wetland"]), status: "needed_not_obtained" as const }] : []),
    ...(featureUrls(["terrestrial_depiction"]).length ? [{ actorClass: "land_and_conservation_authorities" as const,
      question: "Check current land cover, designation, property and use rights, habitat, and ecological effects with competent sources and affected communities.",
      contextSourceUrls: featureUrls(["terrestrial_depiction"]), status: "needed_not_obtained" as const }] : []),
  ];
  return { countryDepictions, naturalFeatures, unavailableSources, possiblyTruncatedSources,
    nextEvidenceRequests,
    interpretation: "These are review leads from one mapped path piece, not identified affected parties, current impacts, legal rights, consent, or option outcomes." };
}

export async function readCivilizationCorridorScalePathScreen(
  input: unknown,
  networkReader: typeof readCivilizationCorridorScaleNetworkTopology = readCivilizationCorridorScaleNetworkTopology,
  screenReader: typeof readProposedCorridorScreen = readProposedCorridorScreen,
): Promise<CivilizationCorridorScalePathScreen> {
  const parsed = civilizationCorridorScalePathScreenQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Corridor path screen query is invalid.");
  const query = parsed.data;
  const network = await networkReader(query.network);
  const plan = planCivilizationCorridorScaleEvidence(network.query.plan);
  const diplomaticContext: CivilizationCorridorScalePathScreen["diplomaticContext"] = query.diplomaticIssueId
    ? (() => {
      try {
        const pairGlance = readCivilizationPairGlance({ firstCountryIso3: query.network.plan.countryIso3s[0],
          secondCountryIso3: query.network.plan.countryIso3s[1], issueId: query.diplomaticIssueId });
        return { status: "available" as const, pairGlance,
          relationToMappedPath: "selected_public_position_context_not_alignment_support_or_permission" as const,
          nextQuestion: `Would ${query.network.plan.countryIso3s[0]} and ${query.network.plan.countryIso3s[1]} each consider a defined ${query.network.networkKind} option along this mapped area, and what terms, third parties, and locally affected people would need review?` };
      } catch {
        return { status: "unavailable" as const, reason: "selected_pair_position_context_unavailable" };
      }
    })() : { status: "not_requested" };
  const base = {
    schemaVersion: "civilization_corridor_scale_path_screen/v3" as const, query, network, diplomaticContext,
    relationToWholePath: "one_bounded_exact_osm_node_piece_other_path_segments_and_source_gaps_remain_unreviewed" as const,
    missingEvidence: [
      "The local source screen compares only the returned OSM node segments in this piece; other path segments need their own reads.",
      "Map contacts are source-depiction leads, not ecological impacts, legal jurisdiction, construction rights, or affected-party consent.",
      "Current operation, compatible transfers, capacity, direction, access, finance, and distributional outcomes remain unverified.",
      ...network.coverage.missingEvidence,
    ],
    authority: { assistant_answer: false as const, terminal_eligible: false as const,
      execution_permission: false as const, policy_finality: false as const },
  };
  if (network.route.status !== "mapped_topology_candidate") return {
    ...base, screen: { status: "not_screenable", reason: "no_mapped_path" },
  };
  if (query.expectedPathSha256 && query.expectedPathSha256 !== network.route.pathSha256) return {
    ...base, screen: { status: "not_screenable", reason: "mapped_path_changed" },
  };
  if (network.route.pathGeometry.status !== "complete") return {
    ...base, screen: { status: "not_screenable", reason: "path_geometry_exceeds_response_limit" },
  };
  const segments = network.route.pathGeometry.segments;
  if (query.startSegmentIndex >= segments.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Start segment is outside the mapped path.");
  }
  const first = segments[query.startSegmentIndex];
  const window = plan.windows[first.windowSequence - 1];
  if (!window) throw new CivilizationGeospatialSourceError("source_unavailable", "Mapped path window is unavailable.");
  const piece: typeof segments = [];
  for (const segment of segments.slice(query.startSegmentIndex, query.startSegmentIndex + MAX_SEGMENTS_PER_SCREEN)) {
    if (segment.windowSequence !== first.windowSequence) break;
    piece.push(segment);
  }
  const next = query.startSegmentIndex + piece.length;
  const nextSegmentIndex = next < segments.length ? next : null;
  const vertices = [piece[0].from, ...piece.map((segment) => segment.to)];
  const screenInput = {
    ...window.proposedCorridorScreenInput, vertices,
    sketchOrigin: "mapped_network_candidate" as const,
    mappedInfrastructureKinds: [],
    includeTerrainPointObservations: false,
    includeGlobalReliefObservations: false,
  };
  try {
    const evidence = await screenReader(screenInput);
    const reviewLeads = deriveReviewLeads(evidence, [...new Set(piece.map((segment) => segment.sourceRecordUrl))]);
    return { ...base, screen: { status: "available", windowSequence: first.windowSequence,
      startSegmentIndex: query.startSegmentIndex, screenedSegmentCount: piece.length, nextSegmentIndex, evidence, reviewLeads } };
  } catch (error) {
    return { ...base, screen: { status: "unavailable", windowSequence: first.windowSequence,
      startSegmentIndex: query.startSegmentIndex, screenedSegmentCount: piece.length, nextSegmentIndex,
      reason: error instanceof CivilizationGeospatialSourceError ? error.code : "local_path_source_screen_unavailable" } };
  }
}
