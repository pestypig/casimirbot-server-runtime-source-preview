import { z } from "zod";
import {
  civilizationScenarioComparisonQuerySchema,
  civilizationScenarioComparisonOutputSchema,
  readCivilizationScenarioComparison,
} from "./scenario-comparison";
import {
  civilizationCorridorScalePathBatchQuerySchema,
  civilizationCorridorScalePathBatchOutputSchema,
  readCivilizationCorridorScalePathBatch,
} from "../civilization-live-sources/corridor-scale-path-batch";
import {
  civilizationCorridorScalePathLedgerQuerySchema,
  civilizationCorridorScalePathLedgerOutputSchema,
  civilizationPathNetworkSourceSummarySchema,
  summarizeCivilizationPathNetworkSources,
  readCivilizationCorridorScalePathLedger,
} from "../civilization-live-sources/corridor-scale-path-ledger";
import {
  civilizationCorridorScalePathReceiptChainQuerySchema,
  civilizationCorridorScalePathReceiptChainOutputSchema,
  readCivilizationCorridorScalePathReceiptChain,
} from "../civilization-live-sources/corridor-scale-path-receipt-chain";
import { CivilizationGeospatialSourceError } from "../civilization-live-sources/usgs-geospatial-evidence";
import { civilizationCountryDepictionPointSchema, screenCountryDepictionPoint } from "../civilization-live-sources/natural-earth-country-geometry";
import { readUnga81CountryEvidence } from "./unga81-evidence";
import { readReviewedCounterpartReferences } from "./counterpart-references";

export const civilizationMappedPathOptionReviewQuerySchema = z.object({
  scenario: civilizationScenarioComparisonQuerySchema,
  pathBatch: civilizationCorridorScalePathBatchQuerySchema.optional(),
  pathLedger: civilizationCorridorScalePathLedgerQuerySchema.optional(),
  pathReceiptChain: civilizationCorridorScalePathReceiptChainQuerySchema.optional(),
}).strict().superRefine((query, context) => {
  if (Number(Boolean(query.pathBatch)) + Number(Boolean(query.pathLedger)) + Number(Boolean(query.pathReceiptChain)) !== 1) {
    context.addIssue({ code: "custom", message: "Supply exactly one path batch, path ledger, or server-held receipt chain query." });
    return;
  }
  const path = query.pathBatch?.path ?? query.pathLedger?.batch.path;
  if (!path) return;
  const selected = [query.scenario.firstCountryIso3, query.scenario.secondCountryIso3].sort();
  const pathCountries = [...path.network.plan.countryIso3s].sort();
  if (pathCountries.length !== 2 || selected.some((country, index) => country !== pathCountries[index])) {
    context.addIssue({ code: "custom", message: "The path must select the same two country affiliations as the scenario." });
  }
  if (!query.scenario.corridorScaleSketch ||
      JSON.stringify(query.scenario.corridorScaleSketch) !== JSON.stringify(path.network.plan)) {
    context.addIssue({ code: "custom", message: "The scenario and mapped path must use the same corridor-scale sketch plan." });
  }
});

const optionGateSchema = z.object({ id: z.enum(["selected_country_alignment_relevance", "jurisdiction_and_transit_terms", "asset_operation_and_interconnection",
  "environmental_and_community_review", "affected_party_consent", "finance_and_distribution"]),
  status: z.literal("unverified"), evidenceNeeded: z.string().min(1), contextSourceUrls: z.array(z.string().url()) }).strict();

export const civilizationMappedPathOptionReviewOutputSchema = z.object({
  schemaVersion: z.literal("civilization_mapped_path_option_review/v12"),
  query: civilizationMappedPathOptionReviewQuerySchema,
  scenario: civilizationScenarioComparisonOutputSchema,
  pathBatch: civilizationCorridorScalePathBatchOutputSchema.nullable(),
  pathLedger: civilizationCorridorScalePathLedgerOutputSchema.nullable(),
  pathReceiptChain: civilizationCorridorScalePathReceiptChainOutputSchema.nullable(),
  conditionalOption: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_available"), reason: z.enum(["no_mapped_topology_candidate", "path_identity_changed", "mapped_endpoint_geometry_unavailable"]),
      interpretation: z.literal("No mapped-path option is entered from an unavailable or changed topology result; the scenario's other conditional options remain separate.") }).strict(),
    z.object({ status: z.literal("review_question_only"), id: z.string().min(1),
      comparisonDomain: z.literal("connectivity_infrastructure"),
      networkKind: z.string(), pathSha256: z.string().regex(/^[a-f0-9]{64}$/),
      mappedLengthKm: z.number().nonnegative(),
      question: z.string().min(1),
      sourceStatus: z.literal("bounded_osm_topology_partial_or_complete_local_source_review"),
      pathCoverage: z.union([civilizationCorridorScalePathBatchOutputSchema.shape.coverage,
        civilizationCorridorScalePathLedgerOutputSchema.shape.coverage,
        civilizationCorridorScalePathReceiptChainOutputSchema.shape.coverage]),
      networkSourceSummary: civilizationPathNetworkSourceSummarySchema,
      selectedCountryViews: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
        reviewedAssertion: z.object({ id: z.string(), text: z.string(), sourceUrl: z.string().url(),
          sourcePage: z.number().int().positive(), speechDate: z.string(), uncertainty: z.string() }).strict().nullable(),
        sourceRole: z.literal("general_public_position_context_not_option_acceptance"),
        optionSpecificPosition: z.literal("unverified"),
        possibleGain: z.literal("unquantified"), possibleLoss: z.literal("unquantified") }).strict()).length(2),
      selectedCountryDepictionReview: z.object({ countries: z.array(z.object({
        countryIso3: z.string().regex(/^[A-Z]{3}$/),
        status: z.enum(["cartographic_contact_returned", "no_contact_returned_in_screened_pieces"]),
        sourceFeatureIds: z.array(z.string()), sourceUrls: z.array(z.string().url()),
        exactEndpointAndJurisdiction: z.literal("not_established"),
        reviewQuestion: z.string().min(1),
      }).strict()).length(2),
        interpretation: z.literal("Selected ISO3 affiliations label the question; returned generalized country depictions do not prove endpoint location, legal jurisdiction, asset ownership, or route permission, and missing contacts do not rule them out.")
      }).strict(),
      snappedEndpointDepictionReview: z.object({
        start: civilizationCountryDepictionPointSchema, end: civilizationCountryDepictionPointSchema,
        originSnapDistanceKm: z.number().nonnegative(), destinationSnapDistanceKm: z.number().nonnegative(),
        selectedCountries: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
          startRelation: z.enum(["inside_depiction", "boundary_contact", "not_returned_or_indeterminate"]),
          endRelation: z.enum(["inside_depiction", "boundary_contact", "not_returned_or_indeterminate"]),
        }).strict()).length(2),
        interpretation: z.literal("The first and last snapped OSM nodes are compared with generalized Natural Earth country polygons. These are cartographic endpoint leads, not surveyed endpoints, legal borders, asset ownership, affected parties, or transit permission."),
      }).strict(),
      countryDepictionLeads: civilizationCorridorScalePathBatchOutputSchema.shape.reviewLeads.shape.countryDepictions,
      candidateThirdCountryReviewLeads: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
        depictionNames: z.array(z.string()), sourceFeatureIds: z.array(z.string()),
        sourceUrls: z.array(z.string().url()),
        contactMeaning: z.literal("cartographic_depiction_review_lead_not_jurisdiction_or_affected_party_determination"),
        currentPosition: z.literal("not_obtained_for_this_option"),
        relationshipEffect: z.literal("unassessed"),
        rightsAndConsent: z.literal("unverified"), reviewQuestion: z.string().min(1),
        selectedPublicPositionContext: z.object({
          status: z.enum(["selected_reviewed_assertion", "reviewed_assertion_unavailable"]),
          assertion: z.object({ id: z.string(), text: z.string(), sourceUrl: z.string().url(),
            sourcePage: z.number().int().positive(), speechDate: z.string(), uncertainty: z.string() }).strict().nullable(),
          meaning: z.literal("general_selected_public_position_not_route_specific_or_current_policy"),
        }).strict(),
        namedCounterpartReferences: z.array(z.object({ fromIso3: z.string().regex(/^[A-Z]{3}$/),
          toIso3: z.string().regex(/^[A-Z]{3}$/), assertionId: z.string(), text: z.string(),
          sourceUrl: z.string().url(), sourcePage: z.number().int().positive(), speechDate: z.string(),
          uncertainty: z.string(), currentRelationEffect: z.literal("unassessed") }).strict()),
        counterpartReferenceMeaning: z.literal("explicit_named_references_in_selected_submitted_statements_not_option_acceptance_or_obstacle"),
        relationshipRecordContext: z.array(z.object({ recordId: z.string(),
          role: z.enum(["named_in_bilateral_record_dependency", "multilateral_record_party", "reported_transit_country"]),
          sourceUrls: z.array(z.string().url()).min(1),
          effectOnMappedOption: z.literal("unassessed") }).strict()),
        relationshipRecordMeaning: z.literal("dated_source_context_not_a_current_route_constraint_or_consent_determination"),
      }).strict()),
      unattributedCountryDepictionCount: z.number().int().nonnegative(),
      naturalFeatureLeads: civilizationCorridorScalePathBatchOutputSchema.shape.reviewLeads.shape.naturalFeatures,
      gates: z.array(optionGateSchema).length(6),
      objectiveReadiness: z.array(z.object({ objective: civilizationScenarioComparisonQuerySchema.innerType().shape.objectives.element,
        status: z.enum(["bounded_mapped_length_only", "unquantified"]), value: z.number().nonnegative().nullable(),
        unit: z.literal("km").nullable() }).strict()),
      comparison: z.object({ noBuildOptionId: z.string().nullable(),
        otherScenarioOptionIds: z.array(z.string()),
        status: z.literal("not_comparable_outcomes_permissions_and_scope_missing"),
        interpretation: z.literal("Mapped length is not a benefit, cost, environmental effect, service capacity, or common outcome against no-build and other options.") }).strict(),
      comparisonHandoff: z.object({
        basisQuestion: z.string().min(1),
        noBuildBaseline: z.object({ optionId: z.string().nullable(),
          scope: z.literal("policy_baseline_requires_same_service_endpoints_direction_and_planning_year") }).strict(),
        objectives: z.array(z.object({ objective: civilizationScenarioComparisonQuerySchema.innerType().shape.objectives.element,
          mappedPathStatus: z.enum(["bounded_mapped_length_only", "unquantified"]),
          scenarioInfrastructureOptions: z.array(z.object({ optionId: z.string(),
            status: civilizationScenarioComparisonOutputSchema.shape.options.element.shape.objectiveReadiness.element.shape.status }).strict()),
          measurementQuestion: z.string().min(1),
          actorToConsult: z.string().min(1),
          outcomeComparison: z.literal("not_established") }).strict()),
        interpretation: z.literal("These are evidence questions for comparable options, not measured outcomes or an option ranking.")
      }).strict(),
      sameFamilyConceptContext: z.object({
        matchedOptions: z.array(z.object({ optionId: z.string(), conceptFamily: z.string(),
          discussionBasis: civilizationScenarioComparisonOutputSchema.shape.optionDiscussionBasis.element.nullable(),
          selectedGovernmentResponses: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
            conceptPositionStatus: civilizationScenarioComparisonOutputSchema.shape.optionEvidenceLedgers.element.shape.selectedPartyDistribution.element.shape.optionPositionStatus,
            reviewedPositionAssertionIds: z.array(z.string()),
            exactMappedAlignmentPosition: z.literal("not_established"),
            reviewQuestion: z.string().min(1) }).strict()).length(2),
          relation: z.literal("same_infrastructure_family_not_same_alignment_or_agreement") }).strict()),
        interpretation: z.literal("Matching an infrastructure family links cited discussion context only; it does not establish that any statement or agreement names, accepts, funds, permits, or benefits this mapped alignment.")
      }).strict(),
      nextEvidenceRequests: civilizationCorridorScalePathBatchOutputSchema.shape.reviewLeads.shape.nextEvidenceRequests,
      missingEvidence: z.array(z.string()),
      eligibility: z.literal("undetermined"),
      interpretation: z.literal("This mapped path is a conditional discussion question, not an agreed, operating, buildable, beneficial, or preferred route.") }).strict(),
  ]),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationMappedPathOptionReview = z.infer<typeof civilizationMappedPathOptionReviewOutputSchema>;

export async function readCivilizationMappedPathOptionReview(input: unknown): Promise<CivilizationMappedPathOptionReview> {
  const parsed = civilizationMappedPathOptionReviewQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Mapped path option review query is invalid.");
  const query = parsed.data;
  const [scenario, source] = await Promise.all([
    readCivilizationScenarioComparison(query.scenario),
    query.pathReceiptChain ? readCivilizationCorridorScalePathReceiptChain(query.pathReceiptChain) :
      query.pathLedger ? readCivilizationCorridorScalePathLedger(query.pathLedger) :
        readCivilizationCorridorScalePathBatch(query.pathBatch!),
  ]);
  const pathReceiptChain = source.schemaVersion === "civilization_corridor_scale_path_receipt_chain/v3" ? source : null;
  const pathLedger = source.schemaVersion === "civilization_corridor_scale_path_ledger/v2" ? source : null;
  const pathBatch = source.schemaVersion === "civilization_corridor_scale_path_batch/v1" ? source : null;
  const basisBatch = pathBatch ?? pathLedger?.batches[0];
  const networkSourceSummary = pathReceiptChain?.networkSourceSummary ?? pathLedger?.networkSourceSummary ??
    summarizeCivilizationPathNetworkSources([pathBatch!]);
  const coverage = pathReceiptChain?.coverage ?? pathLedger?.coverage ?? pathBatch!.coverage;
  const leads = pathReceiptChain?.reviewLeads ?? pathLedger?.reviewLeads ?? pathBatch!.reviewLeads;
  const networkQuery = query.pathBatch?.path.network ?? query.pathLedger?.batch.path.network ?? pathReceiptChain!.networkQuery;
  const selected = [query.scenario.firstCountryIso3, query.scenario.secondCountryIso3].sort();
  const pathCountries = [...networkQuery.plan.countryIso3s].sort();
  if (pathCountries.length !== 2 || selected.some((country, index) => country !== pathCountries[index]) ||
      !query.scenario.corridorScaleSketch ||
      JSON.stringify(query.scenario.corridorScaleSketch) !== JSON.stringify(networkQuery.plan)) {
    throw new CivilizationGeospatialSourceError("invalid_query", "The receipt chain, selected countries, and scenario corridor sketch do not match.");
  }
  const base = { schemaVersion: "civilization_mapped_path_option_review/v12" as const,
    query, scenario, pathBatch, pathLedger, pathReceiptChain,
    authority: { assistant_answer: false as const, terminal_eligible: false as const,
      execution_permission: false as const, policy_finality: false as const } };
  const route = basisBatch?.network.route;
  const mappedRoute = route?.status === "mapped_topology_candidate" ? route : null;
  const snappedEndpoints = pathReceiptChain?.snappedEndpoints ??
    (mappedRoute?.pathGeometry.status === "complete" ? {
      start: mappedRoute.pathGeometry.segments[0].from,
      end: mappedRoute.pathGeometry.segments[mappedRoute.pathGeometry.segments.length - 1].to,
      originSnapDistanceKm: mappedRoute.originSnapDistanceKm,
      destinationSnapDistanceKm: mappedRoute.destinationSnapDistanceKm,
    } : null);
  const pathSha256 = pathReceiptChain?.coverage.pathSha256 ?? mappedRoute?.pathSha256 ?? null;
  const mappedLengthKm = pathReceiptChain?.mappedLengthKm ?? mappedRoute?.mappedLengthKm ?? null;
  const wholePathGeometryRead = "wholePathGeometryRead" in coverage ? coverage.wholePathGeometryRead :
    coverage.allPathGeometryPiecesReadInThisBatch;
  if (!pathSha256 || mappedLengthKm === null || !snappedEndpoints || coverage.status === "path_not_screenable" ||
      coverage.status === "path_changed_or_unavailable") return {
    ...base, conditionalOption: { status: "not_available", reason: !pathSha256
      ? "no_mapped_topology_candidate" : !snappedEndpoints ? "mapped_endpoint_geometry_unavailable" : "path_identity_changed",
      interpretation: "No mapped-path option is entered from an unavailable or changed topology result; the scenario's other conditional options remain separate." },
  };
  const diplomaticContext = pathReceiptChain?.diplomaticContext ?? basisBatch!.diplomaticContext;
  const directions = diplomaticContext.status === "available" ? diplomaticContext.pairGlance.directions : [];
  const selectedCountryViews = [query.scenario.firstCountryIso3, query.scenario.secondCountryIso3].map((countryIso3) => {
    const assertion = directions.find((direction) => direction.countryIso3 === countryIso3)?.assertion;
    return { countryIso3, reviewedAssertion: assertion ? {
      id: assertion.id, text: assertion.text, sourceUrl: assertion.sourceUrl,
      sourcePage: assertion.sourcePage, speechDate: assertion.speechDate, uncertainty: assertion.uncertainty,
    } : null,
    sourceRole: "general_public_position_context_not_option_acceptance" as const,
    optionSpecificPosition: "unverified" as const,
    possibleGain: "unquantified" as const, possibleLoss: "unquantified" as const };
  });
  const wayUrls = pathReceiptChain ? pathReceiptChain.mappedWayRecordUrls :
    mappedRoute!.pathGeometry.status === "complete"
      ? [...new Set(mappedRoute!.pathGeometry.segments.map((segment) => segment.sourceRecordUrl))]
      : mappedRoute!.mappedWayRecordUrls;
  const countryUrls = [...new Set(leads.countryDepictions.map((country) => country.sourceUrl))];
  const startDepiction = screenCountryDepictionPoint(snappedEndpoints.start);
  const endDepiction = screenCountryDepictionPoint(snappedEndpoints.end);
  const naturalUrls = [...new Set(leads.naturalFeatures.map((feature) => feature.sourceUrl))];
  const selectedCountries = new Set([query.scenario.firstCountryIso3, query.scenario.secondCountryIso3]);
  const selectedCountryDepictionReview = {
    countries: [...selectedCountries].map((countryIso3) => {
      const contacts = leads.countryDepictions.filter((country) => country.countryIso3 === countryIso3);
      return { countryIso3,
        status: contacts.length ? "cartographic_contact_returned" as const : "no_contact_returned_in_screened_pieces" as const,
        sourceFeatureIds: [...new Set(contacts.map((contact) => contact.sourceFeatureId))].sort(),
        sourceUrls: [...new Set(contacts.map((contact) => contact.sourceUrl))].sort(),
        exactEndpointAndJurisdiction: "not_established" as const,
        reviewQuestion: `Verify whether the actual route endpoints and alignment involve ${countryIso3}'s competent jurisdiction, infrastructure, people, or rights; what authoritative boundary and survey records support that conclusion?` };
    }),
    interpretation: "Selected ISO3 affiliations label the question; returned generalized country depictions do not prove endpoint location, legal jurisdiction, asset ownership, or route permission, and missing contacts do not rule them out." as const,
  };
  const endpointRelation = (countryIso3: string, screen: typeof startDepiction) =>
    screen.contacts.find((contact) => contact.isoA3 === countryIso3)?.relation ?? "not_returned_or_indeterminate" as const;
  const snappedEndpointDepictionReview = { start: startDepiction, end: endDepiction,
    originSnapDistanceKm: snappedEndpoints.originSnapDistanceKm,
    destinationSnapDistanceKm: snappedEndpoints.destinationSnapDistanceKm,
    selectedCountries: [...selectedCountries].map((countryIso3) => ({ countryIso3,
      startRelation: endpointRelation(countryIso3, startDepiction),
      endRelation: endpointRelation(countryIso3, endDepiction) })),
    interpretation: "The first and last snapped OSM nodes are compared with generalized Natural Earth country polygons. These are cartographic endpoint leads, not surveyed endpoints, legal borders, asset ownership, affected parties, or transit permission." as const,
  };
  const possibleThirdCountries = new Map<string, { names: Set<string>; featureIds: Set<string>; urls: Set<string> }>();
  let unattributedCountryDepictionCount = 0;
  for (const country of leads.countryDepictions) {
    if (!country.countryIso3) { unattributedCountryDepictionCount++; continue; }
    if (selectedCountries.has(country.countryIso3)) continue;
    const prior = possibleThirdCountries.get(country.countryIso3) ?? {
      names: new Set<string>(), featureIds: new Set<string>(), urls: new Set<string>(),
    };
    prior.names.add(country.name);
    prior.featureIds.add(country.sourceFeatureId);
    prior.urls.add(country.sourceUrl);
    possibleThirdCountries.set(country.countryIso3, prior);
  }
  const candidateThirdCountryReviewLeads = [...possibleThirdCountries.entries()]
    .sort(([left], [right]) => left.localeCompare(right)).map(([countryIso3, depictions]) => {
      const country = readUnga81CountryEvidence({ countryIso3 });
      const brief = country.reviewedBrief;
      const assertion = brief?.assertions[0];
      const namedCounterpartReferences = [...selectedCountries].flatMap((selectedIso3) => [
        ...readReviewedCounterpartReferences(countryIso3, selectedIso3),
        ...readReviewedCounterpartReferences(selectedIso3, countryIso3),
      ]).sort((left, right) => left.fromIso3.localeCompare(right.fromIso3) ||
        left.toIso3.localeCompare(right.toIso3) || left.id.localeCompare(right.id))
        .map((reference) => ({ fromIso3: reference.fromIso3, toIso3: reference.toIso3,
          assertionId: reference.id, text: reference.text, sourceUrl: reference.sourceUrl,
          sourcePage: reference.sourcePage, speechDate: reference.speechDate,
          uncertainty: reference.uncertainty, currentRelationEffect: "unassessed" as const }));
      const relationshipRecordContext = [
        ...scenario.relationshipNetwork.relations.filter((relation) =>
          relation.thirdPartyDependencies.some((dependency) => dependency.partyIso3 === countryIso3))
          .filter((relation) => relation.sourceUrls.length > 0)
          .map((relation) => ({ recordId: relation.id,
            role: "named_in_bilateral_record_dependency" as const,
            sourceUrls: relation.sourceUrls, effectOnMappedOption: "unassessed" as const })),
        ...scenario.relationshipNetwork.multilateralGovernmentRecords.filter((record) =>
          record.parties.includes(countryIso3) && record.sourceUrls.length > 0)
          .map((record) => ({ recordId: record.id, role: "multilateral_record_party" as const,
            sourceUrls: record.sourceUrls, effectOnMappedOption: "unassessed" as const })),
        ...scenario.relationshipNetwork.reportedTransportEvents.filter((event) =>
          event.reportedTransitCountryIso3s.includes(countryIso3))
          .map((event) => ({ recordId: event.id, role: "reported_transit_country" as const,
            sourceUrls: [event.sourceUrl, ...event.corroboratingOperationalSources.map((source) => source.sourceUrl)],
            effectOnMappedOption: "unassessed" as const })),
      ];
      return {
        countryIso3, depictionNames: [...depictions.names].sort(),
        sourceFeatureIds: [...depictions.featureIds].sort(), sourceUrls: [...depictions.urls].sort(),
        contactMeaning: "cartographic_depiction_review_lead_not_jurisdiction_or_affected_party_determination" as const,
        currentPosition: "not_obtained_for_this_option" as const,
        relationshipEffect: "unassessed" as const, rightsAndConsent: "unverified" as const,
        reviewQuestion: `Does the proposed alignment actually affect ${countryIso3}'s jurisdiction, people, rights, or infrastructure, and what is its current position on this exact option?`,
        selectedPublicPositionContext: { status: assertion ? "selected_reviewed_assertion" as const :
          "reviewed_assertion_unavailable" as const,
          assertion: assertion && brief ? { id: assertion.id, text: assertion.text,
            sourceUrl: assertion.sourceUrl, sourcePage: assertion.sourcePage,
            speechDate: brief.speechDate, uncertainty: assertion.uncertainty } : null,
          meaning: "general_selected_public_position_not_route_specific_or_current_policy" as const },
        namedCounterpartReferences,
        counterpartReferenceMeaning: "explicit_named_references_in_selected_submitted_statements_not_option_acceptance_or_obstacle" as const,
        relationshipRecordContext,
        relationshipRecordMeaning: "dated_source_context_not_a_current_route_constraint_or_consent_determination" as const,
      };
    });
  const gates: Array<z.infer<typeof optionGateSchema>> = [
    { id: "selected_country_alignment_relevance", status: "unverified",
      evidenceNeeded: "Verify surveyed endpoints and the actual alignment against authoritative current boundaries and asset records for both selected countries before treating this as their bilateral route option.",
      contextSourceUrls: countryUrls },
    { id: "jurisdiction_and_transit_terms", status: "unverified",
      evidenceNeeded: "Identify every competent government and obtain current jurisdiction, transit, land and construction terms for this exact alignment.",
      contextSourceUrls: countryUrls },
    { id: "asset_operation_and_interconnection", status: "unverified",
      evidenceNeeded: "Verify physical continuity, interconnections, product or mode compatibility, direction, actual service, access, capacity and safety with operators.",
      contextSourceUrls: wayUrls },
    { id: "environmental_and_community_review", status: "unverified",
      evidenceNeeded: "Complete current site-specific ecological, water and community review over the whole alignment with competent authorities and affected people.",
      contextSourceUrls: naturalUrls },
    { id: "affected_party_consent", status: "unverified",
      evidenceNeeded: "Identify third countries, communities, rights holders and operators actually affected, then obtain their positions and any legally required consent.",
      contextSourceUrls: [...new Set([...countryUrls, ...wayUrls])] },
    { id: "finance_and_distribution", status: "unverified",
      evidenceNeeded: "Obtain cost, demand, finance, capacity, and bounded gain-and-loss estimates for each party and community under the declared planning horizon.",
      contextSourceUrls: wayUrls },
  ];
  const noBuildOption = scenario.options.find((option) =>
    option.kind === "no_build_policy_review" && option.policyReview !== null);
  const infrastructureFrontier = scenario.frontierReadiness.domains.find((domain) =>
    domain.comparisonDomain === "connectivity_infrastructure");
  const scenarioInfrastructureOptions = scenario.options.filter((option) =>
    option.comparisonDomain === "connectivity_infrastructure" &&
    infrastructureFrontier?.optionIds.includes(option.id));
  const conceptFamiliesByNetworkKind: Record<string, string[]> = {
    rail: ["rail_restoration", "rail_connection"], road: ["road_link"],
    pipeline: ["pipeline_link"], power: ["electricity_link"],
    telecom: ["fiberoptic_link"], waterway: [],
  };
  const sameFamilyConceptOptions = scenarioInfrastructureOptions.filter((option) =>
    option.concept && conceptFamiliesByNetworkKind[networkQuery.networkKind]?.includes(option.concept.family));
  const conditionalOption = {
    status: "review_question_only" as const,
    id: `mapped_path:${networkQuery.networkKind}:${pathSha256.slice(0, 16)}`,
    comparisonDomain: "connectivity_infrastructure" as const,
    networkKind: networkQuery.networkKind, pathSha256,
    mappedLengthKm,
    question: `Could ${query.scenario.firstCountryIso3} and ${query.scenario.secondCountryIso3} define a mutually reviewable ${networkQuery.networkKind} option along this mapped-node path, subject to all affected parties' rights and current source review?`,
    sourceStatus: "bounded_osm_topology_partial_or_complete_local_source_review" as const,
    pathCoverage: coverage, networkSourceSummary, selectedCountryViews, selectedCountryDepictionReview,
    snappedEndpointDepictionReview,
    countryDepictionLeads: leads.countryDepictions,
    candidateThirdCountryReviewLeads, unattributedCountryDepictionCount,
    naturalFeatureLeads: leads.naturalFeatures,
    gates,
    objectiveReadiness: query.scenario.objectives.map((objective) => ({ objective,
      status: objective === "mapped_length" ? "bounded_mapped_length_only" as const : "unquantified" as const,
      value: objective === "mapped_length" ? mappedLengthKm : null,
      unit: objective === "mapped_length" ? "km" as const : null })),
    comparison: { noBuildOptionId: noBuildOption?.id ?? null,
      otherScenarioOptionIds: scenario.options.filter((option) => option.kind !== "documented_dated_interaction")
        .map((option) => option.id),
      status: "not_comparable_outcomes_permissions_and_scope_missing" as const,
      interpretation: "Mapped length is not a benefit, cost, environmental effect, service capacity, or common outcome against no-build and other options." as const },
    comparisonHandoff: {
      basisQuestion: infrastructureFrontier?.comparisonBasisQuestion ??
        "Define the same endpoints, service, direction, demand, planning year, and current network baseline before comparing route or mode options.",
      noBuildBaseline: { optionId: noBuildOption?.id ?? null,
        scope: "policy_baseline_requires_same_service_endpoints_direction_and_planning_year" as const },
      objectives: query.scenario.objectives.map((objective) => {
        const coverage = infrastructureFrontier?.objectiveCoverage.find((item) => item.objective === objective);
        const plan = coverage?.measurementPlans[0];
        return { objective,
          mappedPathStatus: objective === "mapped_length" ? "bounded_mapped_length_only" as const : "unquantified" as const,
          scenarioInfrastructureOptions: scenarioInfrastructureOptions.map((option) => ({ optionId: option.id,
            status: option.objectiveReadiness.find((item) => item.objective === objective)?.status ?? "not_quantified" as const })),
          measurementQuestion: plan?.measurementQuestion ??
            `What measured ${objective.replaceAll("_", " ")} outcome would this exact alignment produce against the same documented baseline?`,
          actorToConsult: plan?.actorToConsult ?? "competent_governments",
          outcomeComparison: "not_established" as const };
      }),
      interpretation: "These are evidence questions for comparable options, not measured outcomes or an option ranking." as const,
    },
    sameFamilyConceptContext: {
      matchedOptions: sameFamilyConceptOptions.map((option) => ({ optionId: option.id,
        conceptFamily: option.concept!.family,
        discussionBasis: scenario.optionDiscussionBasis.find((basis) => basis.optionId === option.id) ?? null,
        selectedGovernmentResponses: [query.scenario.firstCountryIso3, query.scenario.secondCountryIso3]
          .map((countryIso3) => {
            const party = scenario.optionEvidenceLedgers.find((ledger) => ledger.optionId === option.id)
              ?.selectedPartyDistribution.find((entry) => entry.countryIso3 === countryIso3);
            return { countryIso3,
              conceptPositionStatus: party?.optionPositionStatus ?? "no_option_specific_position_established" as const,
              reviewedPositionAssertionIds: party?.reviewedPositionAssertionIds ?? [],
              exactMappedAlignmentPosition: "not_established" as const,
              reviewQuestion: `What is ${countryIso3}'s current position on this exact ${networkQuery.networkKind} alignment, including its proposed terms, constraints, and response to the other government's concept?` };
          }),
        relation: "same_infrastructure_family_not_same_alignment_or_agreement" as const })),
      interpretation: "Matching an infrastructure family links cited discussion context only; it does not establish that any statement or agreement names, accepts, funds, permits, or benefits this mapped alignment." as const,
    },
    nextEvidenceRequests: leads.nextEvidenceRequests,
    missingEvidence: [
      ...networkSourceSummary.mappedNetworkMissingEvidence,
      ...networkSourceSummary.unavailableWindowSequences.map((sequence) => `mapped_network_window_${sequence}_source_unavailable`),
      ...networkSourceSummary.possiblyTruncatedWindowSequences.map((sequence) => `mapped_network_window_${sequence}_source_incomplete`),
      ...(networkSourceSummary.graphSegmentLimitReached ? ["mapped_network_graph_segment_limit_reached"] : []),
      ...coverage.unavailableSources.map((source) => `${source}_source_unavailable`),
      ...coverage.possiblyTruncatedSources.map((source) => `${source}_source_incomplete`),
      ...(!wholePathGeometryRead ? ["mapped_path_geometry_not_read_from_start_to_end"] : []),
      ...("sourceGapsReported" in coverage && coverage.sourceGapsReported ?
        ["source_gap_or_capped_response_reported_in_path_receipts"] : []),
      ...candidateThirdCountryReviewLeads.map((lead) =>
        `candidate_third_country_${lead.countryIso3}_route_specific_position_rights_and_effect_unverified`),
      ...selectedCountryDepictionReview.countries.filter((country) =>
        country.status === "no_contact_returned_in_screened_pieces").map((country) =>
        `selected_country_${country.countryIso3}_alignment_geographic_relevance_unverified`),
      "selected_country_route_endpoints_and_legal_jurisdiction_unverified",
      ...snappedEndpointDepictionReview.selectedCountries.filter((country) =>
        country.startRelation === "not_returned_or_indeterminate" && country.endRelation === "not_returned_or_indeterminate")
        .map((country) => `selected_country_${country.countryIso3}_not_depicted_at_either_snapped_endpoint`),
      ...(unattributedCountryDepictionCount > 0 ? ["unattributed_country_depiction_leads_need_source_review"] : []),
      "selected_public_statements_do_not_establish_option_specific_acceptance",
      "current_rights_service_capacity_finance_effects_and_consent_unverified",
    ],
    eligibility: "undetermined" as const,
    interpretation: "This mapped path is a conditional discussion question, not an agreed, operating, buildable, beneficial, or preferred route." as const,
  };
  return { ...base, conditionalOption };
}
