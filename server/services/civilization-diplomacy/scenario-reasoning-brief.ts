import { z } from "zod";
import { civilizationScenarioComparisonOutputSchema, readCivilizationScenarioComparison } from "./scenario-comparison";
import { civilizationCorridorScalePlanQuerySchema } from "../civilization-live-sources/corridor-scale-evidence-plan";
import { readUnga81CountryEvidence } from "./unga81-evidence";

const full = civilizationScenarioComparisonOutputSchema;
const mapScreens = full.shape.options.element.shape.sourceScreens;
const bounded = <T extends z.ZodTypeAny>(item: T, max: number) => z.object({
  totalCount: z.number().int().nonnegative(), omittedCount: z.number().int().nonnegative(),
  entries: z.array(item).max(max),
}).strict();

const citedPosition = z.object({
  countryIso3: z.string().regex(/^[A-Z]{3}$/), assertionId: z.string(),
  text: z.string(), sourceUrl: z.string().url(), sourcePage: z.number().int().positive(),
  speechDate: z.string(), uncertainty: z.string(),
}).strict();

export const civilizationScenarioReasoningBriefOutputSchema = z.object({
  schemaVersion: z.literal("civilization_scenario_reasoning_brief/v15"),
  query: full.shape.query,
  collectedAt: z.string().datetime({ offset: true }),
  fullReceiptTool: z.literal("helix_civilization_scenario_comparison"),
  fullReceiptSchemaVersion: z.literal("civilization_diplomatic_scenario_comparison/v130"),
  corpusCoverage: z.object({
    indexedDelegationPages: z.number().int().nonnegative(),
    selectedBriefDelegationPages: z.number().int().nonnegative(),
    selectedReviewedAssertionCount: z.number().int().nonnegative(),
    fullSpeechReview: z.literal("not_issued_in_current_manifest"),
    selectedCountries: z.array(full.shape.corpusCoverage.shape.selectedCountries.element).length(2),
  }).strict(),
  timeFrame: z.object({ goodsObservationYear: z.number().int(), planningHorizonYear: z.number().int(),
    sourceTimeline: bounded(full.shape.timeFrame.shape.sourceTimeline.element, 20) }).strict(),
  issueFacets: z.array(z.object({ issueId: z.string(),
    facets: bounded(z.object({ id: z.string(), label: z.string(), comparison: z.string(),
      contrast: full.shape.issueComparison.shape.facets.element.shape.contrast,
      positions: bounded(citedPosition, 8), unansweredQuestion: z.string() }).strict(), 16),
  }).strict()).length(3),
  directedPairPerspectives: bounded(full.shape.relationshipNetwork.shape.statedPairPerspectives.element, 20),
  relationshipContext: z.object({
    records: bounded(z.object({
      id: z.string(), fromIso3: z.string().regex(/^[A-Z]{3}$/), toIso3: z.string().regex(/^[A-Z]{3}$/),
      relationKind: full.shape.relationshipNetwork.shape.relations.element.shape.relationKind,
      eventDate: z.string().date().nullable(), measuredYear: z.number().int().nullable(),
      legalStatus: z.string().nullable(), statusAsOf: z.string().date().nullable(),
      tradeStatus: z.string().nullable(), reportedGoodsValueUsd: z.number().nonnegative().nullable(),
      reportedByProvider: z.boolean().nullable(), providerAggregate: z.boolean().nullable(),
      applicability: full.shape.relationshipNetwork.shape.relations.element.shape.applicability,
      sourceUrls: bounded(z.string().url(), 8), conditions: bounded(z.string(), 8),
      thirdPartyDependencies: bounded(full.shape.relationshipNetwork.shape.relations.element.shape.thirdPartyDependencies.element, 8),
      interpretationLimit: z.string(),
    }).strict(), 20),
    multilateralRecords: bounded(full.shape.relationshipNetwork.shape.multilateralGovernmentRecords.element, 12),
    assessedCooperation: z.literal("unassessed"),
    possibleCooperation: z.literal("not_ranked_without_objectives_and_constraints"),
  }).strict(),
  options: bounded(z.object({
    id: z.string(), comparisonDomain: z.string(), kind: z.string(), evidenceState: z.string(),
    conceptFamily: z.string().nullable(), policyQuestion: z.string().nullable(),
    mappedDistanceKm: z.number().nonnegative().nullable(),
    discussionBasis: full.shape.optionDiscussionBasis.element,
    reviewedPositionEvidence: bounded(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/), assertionId: z.string(),
      role: full.shape.optionDiscussionBasis.element.shape.reviewedPositionBasis.element.shape.role,
      sourceUrl: z.string().url(), sourcePage: z.number().int().positive(),
      reviewRevision: z.number().int().positive(),
      resolution: z.enum(["resolved_in_full_issue_facets", "resolved_in_selected_country_brief",
        "position_text_unavailable_after_source_review"]),
      text: z.string().nullable(), speechDate: z.string().nullable(), uncertainty: z.string().nullable(),
    }).strict(), 24),
    decisionReadiness: z.string(),
    selectedPartyDistribution: full.shape.optionEvidenceLedgers.element.shape.selectedPartyDistribution,
    possibleThirdParties: bounded(full.shape.optionEvidenceLedgers.element.shape.potentialThirdPartyOutcomeGaps.element, 12),
    thirdPartyDependencies: z.object({
      optionSpecificEffectStatus: z.literal("unassessed"),
      conditionalFrameworkParties: bounded(full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.conditionalFrameworkParties.element, 12),
      regionalStatementPerspectives: bounded(full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.regionalStatementPerspectives.element, 12),
      reportedTransitDependencies: bounded(full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.reportedTransitDependencies.element, 12),
      operatorContextSources: bounded(full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.operatorContextSources.element, 8),
      geometryContactPositionCoverage: bounded(full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.geometryContactPositionCoverage.element, 12),
      geometryContactStatus: full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.geometryContactStatus,
      interpretation: full.shape.optionEvidenceLedgers.element.shape.thirdPartyContextReview.shape.interpretation,
    }).strict(),
    mapEvidence: z.object({
      infrastructure: z.object({ status: mapScreens.shape.mappedInfrastructure.shape.status,
        networkKinds: z.array(z.string()), mappedSegmentCount: z.number().int().nonnegative().nullable(),
        possiblyTruncated: z.boolean(), sourceUrls: bounded(z.string().url(), 8),
        mappedWays: bounded(mapScreens.shape.mappedInfrastructure.shape.mappedWays.element, 8),
        sketchContacts: bounded(mapScreens.shape.mappedInfrastructure.shape.sketchContacts.element, 8),
        networkTransitionCount: z.number().int().nonnegative(),
        pipelineTagStatus: mapScreens.shape.mappedInfrastructure.shape.pipelineTagReview.shape.status,
        productCompatibility: z.literal("unverified"), flowDirection: z.literal("unverified") }).strict(),
      selectedCountryDepictions: mapScreens.shape.administrativeDepictionContacts,
      thirdCountryDepictions: z.object({ status: mapScreens.shape.thirdCountryPolygonContacts.shape.status,
        countries: bounded(mapScreens.shape.thirdCountryPolygonContacts.shape.countries.element, 12),
        sourceUrl: z.string().url().nullable(), possiblyTruncated: z.boolean(),
        indeterminateFeatureCount: z.number().int().nonnegative(), antimeridianReviewNeeded: z.boolean() }).strict(),
      claimReferenceLines: mapScreens.shape.claimReferenceLineContacts,
      waterways: z.object({ status: mapScreens.shape.generalizedWaterwayContacts.shape.status,
        sourceContactCount: z.number().int().nonnegative().nullable(), possiblyTruncated: z.boolean(),
        contacts: bounded(mapScreens.shape.generalizedWaterwayContacts.shape.contacts.element, 8),
        sourceUrls: bounded(z.string().url(), 8),
        reviewedStatementLinks: bounded(full.shape.optionEvidenceLedgers.element.shape.naturalSystemScreen.shape.reviewedStatementWaterwayLinks.element, 12) }).strict(),
      lakes: z.object({ status: mapScreens.shape.generalizedLakeContacts.shape.status,
        sourceContactCount: z.number().int().nonnegative().nullable(), possiblyTruncated: z.boolean(),
        contacts: bounded(mapScreens.shape.generalizedLakeContacts.shape.contacts.element, 8),
        sourceUrls: bounded(z.string().url(), 8) }).strict(),
      terrestrial: z.object({ status: mapScreens.shape.terrestrialDepictions.shape.status,
        sourceContactCount: z.number().int().nonnegative().nullable(), possiblyTruncated: z.boolean(),
        contacts: bounded(mapScreens.shape.terrestrialDepictions.shape.contacts.element, 8),
        sourceUrls: bounded(z.string().url(), 8), missingEvidence: bounded(z.string(), 12) }).strict(),
      publishedWetlands: z.discriminatedUnion("status", [
        z.object({ status: z.literal("not_screened") }).strict(),
        z.object({ status: z.literal("unavailable"), errorCode: z.string(),
          missingEvidence: bounded(z.string(), 12) }).strict(),
        z.object({ status: z.literal("available"),
          source: mapScreens.shape.liveRamsarReview.unwrap().options[1].shape.source,
          coverage: mapScreens.shape.liveRamsarReview.unwrap().options[1].shape.coverage,
          sites: bounded(z.object({ siteNumber: z.number().int().positive(), name: z.string(),
            countryIso3: z.string().nullable(), sourceRecordUrl: z.string().url(),
            relation: z.enum(["intersects_published_depiction", "no_contact_in_returned_depiction", "indeterminate_comparison_limit"]),
            alignmentSegmentIndices: z.array(z.number().int().nonnegative()) }).strict(), 8),
          possiblyTruncated: z.boolean(), missingEvidence: bounded(z.string(), 12) }).strict(),
      ]),
      modeledRelief: z.object({ status: mapScreens.shape.reliefModel.shape.status,
        sampleCount: z.number().int().nonnegative().nullable(),
        sourceModel: mapScreens.shape.reliefModel.shape.sourceModel,
        samples: bounded(mapScreens.shape.reliefModel.shape.samples.element, 8),
        missingEvidence: bounded(z.string(), 12) }).strict(),
      environmentalImpact: mapScreens.shape.environmentalImpact,
      communityEffects: mapScreens.shape.communityEffects,
      meaning: z.literal("Map contacts and model samples are source depictions, not current service, surveyed jurisdiction, ecological or community effects, engineering feasibility, or permission.")
    }).strict(),
    gates: full.shape.optionEvidenceLedgers.element.shape.gates,
    objectiveEvidencePlans: full.shape.optionEvidenceLedgers.element.shape.objectiveEvidencePlans,
    nextEvidenceRequests: bounded(full.shape.optionEvidenceLedgers.element.shape.nextEvidenceRequests.element, 16)
      .extend({ selectionMethod: z.literal("named_waterway_then_distinct_map_triggers_and_actors_then_source_order") }),
    reviewActors: bounded(full.shape.reviewActorGraph.shape.links.element, 24),
    unidentifiedAffectedActors: full.shape.optionEvidenceLedgers.element.shape.unidentifiedAffectedActors,
    missingEvidence: bounded(z.string(), 20), eligibility: z.string(),
  }).strict(), 40),
  optionInteractions: z.object({
    links: bounded(full.shape.optionInteractionReview.shape.links.element, 30),
    interpretation: full.shape.optionInteractionReview.shape.interpretation,
  }).strict(),
  frontierReadiness: full.shape.frontierReadiness,
  comparisonStatus: z.literal("evidence_incomplete_no_optimum_inferred"),
  unresolved: bounded(z.string(), 40),
  readOnlyHandoffs: z.object({
    issueDetails: z.array(z.object({
      tool: z.literal("helix_civilization_issue_comparison"),
      input: z.object({ firstCountryIso3: z.string().regex(/^[A-Z]{3}$/),
        secondCountryIso3: z.string().regex(/^[A-Z]{3}$/),
        issueId: z.enum(["regional_connectivity", "natural_system_cooperation", "humanitarian_cooperation"]) }).strict(),
      purpose: z.literal("Inspect uncapped cited positions and issue-specific gaps before interpreting an option."),
    }).strict()).length(3),
    selectedCountrySourceReview: z.array(z.object({
      tool: z.literal("helix_civilization_unga81_submitted_page_leads"),
      input: z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/), batchOffset: z.literal(0) }).strict(),
      admittedSelectedAssertionCount: z.number().int().nonnegative(),
      purpose: z.literal("Find hash-checked submitted source pages for further human review; page cues are not admitted positions."),
    }).strict()).length(2),
    corridorPlan: z.discriminatedUnion("status", [
      z.object({ status: z.literal("caller_sketch_missing"),
        nextQuestion: z.literal("Define a caller-supplied geographic sketch before planning local corridor evidence reads.") }).strict(),
      z.object({ status: z.literal("caller_sketch_available"),
        tool: z.literal("helix_civilization_corridor_scale_plan"),
        input: civilizationCorridorScalePlanQuerySchema,
        purpose: z.literal("Plan bounded local map-source reads; the sketch is not an approved or feasible route.") }).strict(),
    ]),
  }).strict(),
  interpretation: z.literal("This is a bounded source-grounded review agenda, not a diplomatic mood score, current national policy, agreement, feasibility finding, or optimum. Open the full receipt for omitted evidence and map detail."),
  authority: full.shape.authority,
}).strict();

export type CivilizationScenarioReasoningBrief = z.infer<typeof civilizationScenarioReasoningBriefOutputSchema>;

function cap<T>(entries: T[], maximum: number) {
  return { totalCount: entries.length, omittedCount: Math.max(0, entries.length - maximum),
    entries: entries.slice(0, maximum) };
}

type EvidenceRequest = z.infer<typeof full>["optionEvidenceLedgers"][number]["nextEvidenceRequests"][number];
function selectEvidenceRequests(requests: EvidenceRequest[]) {
  const maximum = 16;
  const selected: EvidenceRequest[] = [];
  const selectedIds = new Set<string>();
  const add = (request: EvidenceRequest) => {
    if (selected.length < maximum && !selectedIds.has(request.id)) {
      selected.push(request);
      selectedIds.add(request.id);
    }
  };
  const namedWaterway = requests.find((request) => request.id === "named_waterway_source_scope");
  if (namedWaterway) add(namedWaterway);
  const genericTriggers = new Set<EvidenceRequest["trigger"]>([
    "dated_observation", "policy_only_option", "built_option",
  ]);
  const seenMapTriggers = new Set<EvidenceRequest["trigger"]>();
  for (const request of requests) {
    if (!genericTriggers.has(request.trigger) && !seenMapTriggers.has(request.trigger)) {
      add(request);
      seenMapTriggers.add(request.trigger);
    }
  }
  const seenActors = new Set(selected.map((request) => request.actorToConsult));
  for (const request of requests) {
    if (!seenActors.has(request.actorToConsult)) {
      add(request);
      seenActors.add(request.actorToConsult);
    }
  }
  requests.forEach(add);
  return { totalCount: requests.length, omittedCount: requests.length - selected.length,
    entries: selected,
    selectionMethod: "named_waterway_then_distinct_map_triggers_and_actors_then_source_order" as const };
}

export async function readCivilizationScenarioReasoningBrief(input: unknown): Promise<CivilizationScenarioReasoningBrief> {
  const receipt = await readCivilizationScenarioComparison(input);
  const issueComparisons = [receipt.issueComparison, receipt.naturalSystemIssueComparison,
    receipt.humanitarianIssueComparison];
  const allReviewedPositions = issueComparisons.flatMap((comparison) => comparison.facets)
    .flatMap((facet) => facet.positions);
  const selectedCountryBriefs = new Map([receipt.query.firstCountryIso3, receipt.query.secondCountryIso3]
    .map((countryIso3) => [countryIso3, readUnga81CountryEvidence({ countryIso3 }).reviewedBrief] as const));
  const basisByOption = new Map(receipt.optionDiscussionBasis.map((basis) => [basis.optionId, basis]));
  const ledgerByOption = new Map(receipt.optionEvidenceLedgers.map((ledger) => [ledger.optionId, ledger]));
  const actorLinksByOption = new Map<string, typeof receipt.reviewActorGraph.links>();
  for (const link of receipt.reviewActorGraph.links) {
    const links = actorLinksByOption.get(link.optionId) ?? [];
    links.push(link);
    actorLinksByOption.set(link.optionId, links);
  }
  const options = receipt.options.map((option) => {
    const discussionBasis = basisByOption.get(option.id);
    const ledger = ledgerByOption.get(option.id);
    if (!discussionBasis || !ledger) throw new Error(`Scenario option evidence missing for ${option.id}`);
    const screens = option.sourceScreens;
    const wetlands = screens.liveRamsarReview;
    return { id: option.id, comparisonDomain: option.comparisonDomain, kind: option.kind,
      evidenceState: option.evidenceState, conceptFamily: option.concept?.family ?? null,
      policyQuestion: option.policyReview?.question ?? null, mappedDistanceKm: option.mappedDistanceKm,
      discussionBasis, decisionReadiness: ledger.decisionReadiness,
      reviewedPositionEvidence: cap(discussionBasis.reviewedPositionBasis.map((basis) => {
        const position = allReviewedPositions.find((candidate) =>
          candidate.countryIso3 === basis.countryIso3 && candidate.id === basis.assertionId &&
          candidate.sourceUrl === basis.sourceUrl && candidate.sourcePage === basis.sourcePage &&
          candidate.reviewRevision === basis.reviewRevision);
        const brief = selectedCountryBriefs.get(basis.countryIso3);
        const selectedAssertion = !position && brief?.revision === basis.reviewRevision
          ? brief.assertions.find((assertion) => assertion.id === basis.assertionId &&
            assertion.sourceUrl === basis.sourceUrl && assertion.sourcePage === basis.sourcePage)
          : undefined;
        return { ...basis, resolution: position ? "resolved_in_full_issue_facets" as const
          : selectedAssertion ? "resolved_in_selected_country_brief" as const
            : "position_text_unavailable_after_source_review" as const,
          text: position?.text ?? selectedAssertion?.text ?? null,
          speechDate: position?.speechDate ?? (selectedAssertion ? brief?.speechDate ?? null : null),
          uncertainty: position?.uncertainty ?? selectedAssertion?.uncertainty ?? null };
      }), 24),
      selectedPartyDistribution: ledger.selectedPartyDistribution,
      possibleThirdParties: cap(ledger.potentialThirdPartyOutcomeGaps, 12),
      thirdPartyDependencies: {
        optionSpecificEffectStatus: ledger.thirdPartyContextReview.optionSpecificEffectStatus,
        conditionalFrameworkParties: cap(ledger.thirdPartyContextReview.conditionalFrameworkParties, 12),
        regionalStatementPerspectives: cap(ledger.thirdPartyContextReview.regionalStatementPerspectives, 12),
        reportedTransitDependencies: cap(ledger.thirdPartyContextReview.reportedTransitDependencies, 12),
        operatorContextSources: cap(ledger.thirdPartyContextReview.operatorContextSources, 8),
        geometryContactPositionCoverage: cap(ledger.thirdPartyContextReview.geometryContactPositionCoverage, 12),
        geometryContactStatus: ledger.thirdPartyContextReview.geometryContactStatus,
        interpretation: ledger.thirdPartyContextReview.interpretation,
      },
      mapEvidence: {
        infrastructure: { status: screens.mappedInfrastructure.status,
          networkKinds: screens.mappedInfrastructure.networkKinds,
          mappedSegmentCount: screens.mappedInfrastructure.mappedSegmentCount,
          possiblyTruncated: screens.mappedInfrastructure.possiblyTruncated,
          sourceUrls: cap(screens.mappedInfrastructure.sourceUrls, 8),
          mappedWays: cap(screens.mappedInfrastructure.mappedWays, 8),
          sketchContacts: cap(screens.mappedInfrastructure.sketchContacts, 8),
          networkTransitionCount: screens.mappedInfrastructure.networkTransitionCount,
          pipelineTagStatus: screens.mappedInfrastructure.pipelineTagReview.status,
          productCompatibility: screens.mappedInfrastructure.pipelineTagReview.productCompatibility,
          flowDirection: screens.mappedInfrastructure.pipelineTagReview.flowDirection },
        selectedCountryDepictions: screens.administrativeDepictionContacts,
        thirdCountryDepictions: { status: screens.thirdCountryPolygonContacts.status,
          countries: cap(screens.thirdCountryPolygonContacts.countries, 12),
          sourceUrl: screens.thirdCountryPolygonContacts.sourceUrl,
          possiblyTruncated: screens.thirdCountryPolygonContacts.possiblyTruncated,
          indeterminateFeatureCount: screens.thirdCountryPolygonContacts.indeterminateFeatureIds.length,
          antimeridianReviewNeeded: screens.thirdCountryPolygonContacts.antimeridianReviewNeeded },
        claimReferenceLines: screens.claimReferenceLineContacts,
        waterways: { status: screens.generalizedWaterwayContacts.status,
          sourceContactCount: screens.generalizedWaterwayContacts.contactCount,
          possiblyTruncated: screens.generalizedWaterwayContacts.possiblyTruncated,
          contacts: cap(screens.generalizedWaterwayContacts.contacts, 8),
          sourceUrls: cap(screens.generalizedWaterwayContacts.sourceUrls, 8),
          reviewedStatementLinks: cap(ledger.naturalSystemScreen.reviewedStatementWaterwayLinks, 12) },
        lakes: { status: screens.generalizedLakeContacts.status,
          sourceContactCount: screens.generalizedLakeContacts.contactCount,
          possiblyTruncated: screens.generalizedLakeContacts.possiblyTruncated,
          contacts: cap(screens.generalizedLakeContacts.contacts, 8),
          sourceUrls: cap(screens.generalizedLakeContacts.sourceUrls, 8) },
        terrestrial: { status: screens.terrestrialDepictions.status,
          sourceContactCount: screens.terrestrialDepictions.contactCount,
          possiblyTruncated: screens.terrestrialDepictions.possiblyTruncated,
          contacts: cap(screens.terrestrialDepictions.contacts, 8),
          sourceUrls: cap(screens.terrestrialDepictions.sourceUrls, 8),
          missingEvidence: cap(screens.terrestrialDepictions.missingEvidence, 12) },
        publishedWetlands: !wetlands ? { status: "not_screened" as const } : wetlands.status === "unavailable"
          ? { status: "unavailable" as const, errorCode: wetlands.errorCode,
            missingEvidence: cap(wetlands.missingEvidence, 12) }
          : { status: "available" as const, source: wetlands.source, coverage: wetlands.coverage,
            sites: cap(wetlands.sites, 8),
            possiblyTruncated: wetlands.possiblyTruncated,
            missingEvidence: cap(wetlands.missingEvidence, 12) },
        modeledRelief: { status: screens.reliefModel.status, sampleCount: screens.reliefModel.sampleCount,
          sourceModel: screens.reliefModel.sourceModel,
          samples: cap(screens.reliefModel.samples, 8),
          missingEvidence: cap(screens.reliefModel.missingEvidence, 12) },
        environmentalImpact: screens.environmentalImpact,
        communityEffects: screens.communityEffects,
        meaning: "Map contacts and model samples are source depictions, not current service, surveyed jurisdiction, ecological or community effects, engineering feasibility, or permission." as const,
      }, gates: ledger.gates,
      objectiveEvidencePlans: ledger.objectiveEvidencePlans,
      nextEvidenceRequests: selectEvidenceRequests(ledger.nextEvidenceRequests),
      reviewActors: cap(actorLinksByOption.get(option.id) ?? [], 24),
      unidentifiedAffectedActors: ledger.unidentifiedAffectedActors,
      missingEvidence: cap(option.missingEvidence, 20), eligibility: option.eligibility };
  });
  return civilizationScenarioReasoningBriefOutputSchema.parse({
    schemaVersion: "civilization_scenario_reasoning_brief/v15", query: receipt.query,
    collectedAt: receipt.collectedAt, fullReceiptTool: "helix_civilization_scenario_comparison",
    fullReceiptSchemaVersion: receipt.schemaVersion,
    corpusCoverage: { indexedDelegationPages: receipt.corpusCoverage.indexedDelegationPages,
      selectedBriefDelegationPages: receipt.corpusCoverage.delegationPagesWithHashMatchedSelectedBrief,
      selectedReviewedAssertionCount: receipt.corpusCoverage.selectedReviewedAssertionCount,
      fullSpeechReview: receipt.corpusCoverage.fullSpeechAssertionReviewStatus,
      selectedCountries: receipt.corpusCoverage.selectedCountries },
    timeFrame: { goodsObservationYear: receipt.timeFrame.goodsObservationYear,
      planningHorizonYear: receipt.timeFrame.planningHorizonYear,
      sourceTimeline: cap(receipt.timeFrame.sourceTimeline, 20) },
    issueFacets: issueComparisons.map((comparison) => ({ issueId: comparison.query.issueId,
      facets: cap(comparison.facets.map((facet) => ({ id: facet.id, label: facet.label,
        comparison: facet.comparison, contrast: facet.contrast,
        positions: cap(facet.positions.map((position) => ({ countryIso3: position.countryIso3,
          assertionId: position.id, text: position.text, sourceUrl: position.sourceUrl,
          sourcePage: position.sourcePage, speechDate: position.speechDate,
          uncertainty: position.uncertainty })), 8), unansweredQuestion: facet.unansweredQuestion })), 16) })),
    directedPairPerspectives: cap(receipt.relationshipNetwork.statedPairPerspectives, 20),
    relationshipContext: {
      records: cap(receipt.relationshipNetwork.relations.map((record) => ({
        id: record.id, fromIso3: record.fromIso3, toIso3: record.toIso3,
        relationKind: record.relationKind, eventDate: record.eventDate,
        measuredYear: record.measuredYear, legalStatus: record.legalStatus,
        statusAsOf: record.statusAsOf, tradeStatus: record.tradeStatus,
        reportedGoodsValueUsd: record.reportedGoodsValueUsd,
        reportedByProvider: record.reportedByProvider,
        providerAggregate: record.providerAggregate,
        applicability: record.applicability, sourceUrls: cap(record.sourceUrls, 8),
        conditions: cap(record.conditions, 8),
        thirdPartyDependencies: cap(record.thirdPartyDependencies, 8),
        interpretationLimit: record.interpretationLimit,
      })), 20),
      multilateralRecords: cap(receipt.relationshipNetwork.multilateralGovernmentRecords, 12),
      assessedCooperation: receipt.relationshipNetwork.assessedCooperation,
      possibleCooperation: receipt.relationshipNetwork.possibleCooperation,
    },
    options: cap(options, 40),
    optionInteractions: { links: cap(receipt.optionInteractionReview.links, 30),
      interpretation: receipt.optionInteractionReview.interpretation },
    frontierReadiness: receipt.frontierReadiness,
    comparisonStatus: receipt.comparisonStatus, unresolved: cap(receipt.unresolved, 40),
    readOnlyHandoffs: {
      issueDetails: issueComparisons.map((comparison) => ({
        tool: "helix_civilization_issue_comparison" as const,
        input: comparison.query,
        purpose: "Inspect uncapped cited positions and issue-specific gaps before interpreting an option." as const,
      })),
      selectedCountrySourceReview: receipt.corpusCoverage.selectedCountries.map((country) => ({
        tool: "helix_civilization_unga81_submitted_page_leads" as const,
        input: { countryIso3: country.countryIso3, batchOffset: 0 as const },
        admittedSelectedAssertionCount: country.reviewedAssertionCount,
        purpose: "Find hash-checked submitted source pages for further human review; page cues are not admitted positions." as const,
      })),
      corridorPlan: receipt.query.corridorScaleSketch
        ? { status: "caller_sketch_available" as const,
          tool: "helix_civilization_corridor_scale_plan" as const,
          input: receipt.query.corridorScaleSketch,
          purpose: "Plan bounded local map-source reads; the sketch is not an approved or feasible route." as const }
        : { status: "caller_sketch_missing" as const,
          nextQuestion: "Define a caller-supplied geographic sketch before planning local corridor evidence reads." as const },
    },
    interpretation: "This is a bounded source-grounded review agenda, not a diplomatic mood score, current national policy, agreement, feasibility finding, or optimum. Open the full receipt for omitted evidence and map detail.",
    authority: receipt.authority,
  });
}
