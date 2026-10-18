import { z } from "zod";
import {
  civilizationMappedPathOptionReviewQuerySchema,
  readCivilizationMappedPathOptionReview,
} from "./mapped-path-option-review";

const citedAssertionSchema = z.object({ id: z.string(), text: z.string(), sourceUrl: z.string().url(),
  sourcePage: z.number().int().positive(), speechDate: z.string(), uncertainty: z.string() }).strict();
const boundedSourceLeadSchema = z.object({ sourceUrls: z.array(z.string().url()),
  omittedSourceUrlCount: z.number().int().nonnegative() }).strict();

export const civilizationMappedOptionReasoningBriefOutputSchema = z.object({
  schemaVersion: z.literal("civilization_mapped_option_reasoning_brief/v1"),
  query: civilizationMappedPathOptionReviewQuerySchema,
  fullReceiptTool: z.literal("helix_civilization_mapped_path_option_review"),
  fullReceiptSchemaVersion: z.literal("civilization_mapped_path_option_review/v12"),
  corpusCoverage: z.object({ indexedDelegationPages: z.number().int().nonnegative(),
    selectedBriefDelegationPages: z.number().int().nonnegative(),
    selectedReviewedAssertionCount: z.number().int().nonnegative(),
    fullSpeechReview: z.literal("not_issued_in_current_manifest") }).strict(),
  conditionalOption: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_available"), reason: z.string(),
      interpretation: z.literal("No stable mapped path enters this brief; inspect the full receipt and other conditional scenario options.") }).strict(),
    z.object({ status: z.literal("review_question_only"), id: z.string(), networkKind: z.string(),
      pathSha256: z.string().regex(/^[a-f0-9]{64}$/), mappedLengthKm: z.number().nonnegative(),
      question: z.string(),
      pathCoverage: z.object({ screenedSegments: z.number().int().nonnegative(),
        totalSegments: z.number().int().positive().nullable(), wholePathGeometryRead: z.boolean(),
        sourceGapsReported: z.boolean(), unavailableSources: z.array(z.string()),
        possiblyTruncatedSources: z.array(z.string()) }).strict(),
      networkSourceCoverage: z.object({ networkReadCount: z.number().int().positive(),
        status: z.enum(["no_reported_network_source_gap", "reported_network_source_gap"]),
        unavailableWindowSequences: z.array(z.number().int().positive()),
        possiblyTruncatedWindowSequences: z.array(z.number().int().positive()),
        graphSegmentLimitReached: z.boolean(), source: boundedSourceLeadSchema }).strict(),
      snappedEndpoints: z.object({ start: z.object({ lat: z.number(), lon: z.number() }).strict(),
        end: z.object({ lat: z.number(), lon: z.number() }).strict(),
        originSnapDistanceKm: z.number().nonnegative(), destinationSnapDistanceKm: z.number().nonnegative(),
        selectedCountryRelations: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
          startRelation: z.string(), endRelation: z.string() }).strict()).length(2),
        countryDepictionSourceUrl: z.string().url(),
        meaning: z.literal("editorial_point_depiction_not_surveyed_or_legal_jurisdiction") }).strict(),
      governments: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
        selectedAssertion: citedAssertionSchema.nullable(),
        exactAlignmentPosition: z.literal("unverified"),
        possibleGain: z.literal("unquantified"), possibleLoss: z.literal("unquantified") }).strict()).length(2),
      sameFamilyConcepts: z.array(z.object({ optionId: z.string(), family: z.string(),
        rationale: z.string().nullable(), citedAssertionPages: z.array(z.object({ countryIso3: z.string(),
          assertionId: z.string(), sourceUrl: z.string().url(), sourcePage: z.number().int().positive(),
          role: z.string() }).strict()),
        governmentRecordSources: z.array(z.object({ recordId: z.string(), sourceUrl: z.string().url(),
          role: z.string() }).strict()),
        selectedGovernmentResponses: z.array(z.object({ countryIso3: z.string(),
          conceptPositionStatus: z.string(), exactMappedAlignmentPosition: z.literal("not_established") }).strict()).length(2),
        relation: z.literal("same_family_not_same_alignment_or_agreement") }).strict()),
      thirdCountryLeads: z.object({ totalCount: z.number().int().nonnegative(),
        omittedCount: z.number().int().nonnegative(), entries: z.array(z.object({
          countryIso3: z.string().regex(/^[A-Z]{3}$/), depictionNames: z.array(z.string()),
          depictionSources: boundedSourceLeadSchema,
          selectedPublicAssertion: citedAssertionSchema.nullable(),
          namedCounterpartReferenceCount: z.number().int().nonnegative(),
          relationshipRecordCount: z.number().int().nonnegative(),
          currentPosition: z.literal("not_obtained_for_this_option"),
          relationshipEffect: z.literal("unassessed"), rightsAndConsent: z.literal("unverified"),
          reviewQuestion: z.string(),
        }).strict()).max(12), unattributedDepictionCount: z.number().int().nonnegative(),
        meaning: z.literal("source_depiction_and_dated_context_only_not_affected_party_or_obstacle") }).strict(),
      naturalSystemLeads: z.object({ totalCount: z.number().int().nonnegative(),
        omittedCount: z.number().int().nonnegative(), entries: z.array(z.object({
          kind: z.string(), label: z.string(), sourceUrl: z.string().url(),
          pathSegmentIndices: z.array(z.number().int().nonnegative()),
        }).strict()).max(30), meaning: z.literal("mapped_feature_contact_not_ecological_effect_or_permission") }).strict(),
      comparison: z.object({ noBuildPolicyReviewOptionId: z.string().nullable(),
        commonBasisQuestion: z.string(), objectives: z.array(z.object({ objective: z.string(),
          mappedPathStatus: z.string(), peerOptionIds: z.array(z.string()),
          measurementQuestion: z.string(), actorToConsult: z.string(),
          outcomeComparison: z.literal("not_established") }).strict()),
        status: z.literal("outcomes_permissions_and_common_scope_missing") }).strict(),
      gates: z.array(z.object({ id: z.string(), status: z.literal("unverified"),
        evidenceNeeded: z.string() }).strict()).length(6),
      missingEvidence: z.object({ totalCount: z.number().int().nonnegative(),
        omittedCount: z.number().int().nonnegative(), entries: z.array(z.string()).max(80) }).strict(),
      eligibility: z.literal("undetermined"),
      interpretation: z.literal("A source-grounded review agenda, not a preferred, agreed, permitted, operating, or beneficial route; consult the full receipt for every contact and citation.")
    }).strict(),
  ]),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationMappedOptionReasoningBrief = z.infer<typeof civilizationMappedOptionReasoningBriefOutputSchema>;

function boundedSources(urls: string[], max: number) {
  const distinct = [...new Set(urls)];
  return { sourceUrls: distinct.slice(0, max), omittedSourceUrlCount: Math.max(0, distinct.length - max) };
}

export async function readCivilizationMappedOptionReasoningBrief(input: unknown): Promise<CivilizationMappedOptionReasoningBrief> {
  const full = await readCivilizationMappedPathOptionReview(input);
  const corpus = full.scenario.corpusCoverage;
  const base = { schemaVersion: "civilization_mapped_option_reasoning_brief/v1" as const,
    query: full.query, fullReceiptTool: "helix_civilization_mapped_path_option_review" as const,
    fullReceiptSchemaVersion: "civilization_mapped_path_option_review/v12" as const,
    corpusCoverage: { indexedDelegationPages: corpus.indexedDelegationPages,
      selectedBriefDelegationPages: corpus.delegationPagesWithHashMatchedSelectedBrief,
      selectedReviewedAssertionCount: corpus.selectedReviewedAssertionCount,
      fullSpeechReview: corpus.fullSpeechAssertionReviewStatus },
    authority: { assistant_answer: false as const, terminal_eligible: false as const,
      execution_permission: false as const, policy_finality: false as const } };
  const option = full.conditionalOption;
  if (option.status === "not_available") return civilizationMappedOptionReasoningBriefOutputSchema.parse({
    ...base, conditionalOption: { status: "not_available", reason: option.reason,
      interpretation: "No stable mapped path enters this brief; inspect the full receipt and other conditional scenario options." },
  });
  const missingEvidence = [...new Set(option.missingEvidence)];
  const network = option.networkSourceSummary;
  return civilizationMappedOptionReasoningBriefOutputSchema.parse({
    ...base, conditionalOption: { status: "review_question_only", id: option.id,
      networkKind: option.networkKind, pathSha256: option.pathSha256,
      mappedLengthKm: option.mappedLengthKm, question: option.question,
      pathCoverage: { screenedSegments: option.pathCoverage.screenedSegmentCount,
        totalSegments: option.pathCoverage.totalPathSegments,
        wholePathGeometryRead: "wholePathGeometryRead" in option.pathCoverage
          ? option.pathCoverage.wholePathGeometryRead : option.pathCoverage.allPathGeometryPiecesReadInThisBatch,
        sourceGapsReported: "sourceGapsReported" in option.pathCoverage
          ? option.pathCoverage.sourceGapsReported :
            option.pathCoverage.unavailableSources.length > 0 || option.pathCoverage.possiblyTruncatedSources.length > 0,
        unavailableSources: option.pathCoverage.unavailableSources,
        possiblyTruncatedSources: option.pathCoverage.possiblyTruncatedSources },
      networkSourceCoverage: { networkReadCount: network.networkReadCount, status: network.status,
        unavailableWindowSequences: network.unavailableWindowSequences,
        possiblyTruncatedWindowSequences: network.possiblyTruncatedWindowSequences,
        graphSegmentLimitReached: network.graphSegmentLimitReached,
        source: boundedSources(network.sourceUrls, 8) },
      snappedEndpoints: { start: option.snappedEndpointDepictionReview.start.point,
        end: option.snappedEndpointDepictionReview.end.point,
        originSnapDistanceKm: option.snappedEndpointDepictionReview.originSnapDistanceKm,
        destinationSnapDistanceKm: option.snappedEndpointDepictionReview.destinationSnapDistanceKm,
        selectedCountryRelations: option.snappedEndpointDepictionReview.selectedCountries,
        countryDepictionSourceUrl: option.snappedEndpointDepictionReview.start.sourceRecordUrl,
        meaning: "editorial_point_depiction_not_surveyed_or_legal_jurisdiction" },
      governments: option.selectedCountryViews.map((view) => ({ countryIso3: view.countryIso3,
        selectedAssertion: view.reviewedAssertion,
        exactAlignmentPosition: view.optionSpecificPosition,
        possibleGain: view.possibleGain, possibleLoss: view.possibleLoss })),
      sameFamilyConcepts: option.sameFamilyConceptContext.matchedOptions.map((match) => ({
        optionId: match.optionId, family: match.conceptFamily,
        rationale: match.discussionBasis?.rationale ?? null,
        citedAssertionPages: match.discussionBasis?.reviewedPositionBasis.map((basis) => ({
          countryIso3: basis.countryIso3, assertionId: basis.assertionId,
          sourceUrl: basis.sourceUrl, sourcePage: basis.sourcePage, role: basis.role })) ?? [],
        governmentRecordSources: match.discussionBasis?.governmentRecordBasis.map((basis) => ({
          recordId: basis.recordId, sourceUrl: basis.sourceUrl, role: basis.role })) ?? [],
        selectedGovernmentResponses: match.selectedGovernmentResponses.map((response) => ({
          countryIso3: response.countryIso3, conceptPositionStatus: response.conceptPositionStatus,
          exactMappedAlignmentPosition: response.exactMappedAlignmentPosition })),
        relation: "same_family_not_same_alignment_or_agreement" as const })),
      thirdCountryLeads: { totalCount: option.candidateThirdCountryReviewLeads.length,
        omittedCount: Math.max(0, option.candidateThirdCountryReviewLeads.length - 12),
        entries: option.candidateThirdCountryReviewLeads.slice(0, 12).map((lead) => ({
          countryIso3: lead.countryIso3, depictionNames: lead.depictionNames,
          depictionSources: boundedSources(lead.sourceUrls, 3),
          selectedPublicAssertion: lead.selectedPublicPositionContext.assertion,
          namedCounterpartReferenceCount: lead.namedCounterpartReferences.length,
          relationshipRecordCount: lead.relationshipRecordContext.length,
          currentPosition: lead.currentPosition, relationshipEffect: lead.relationshipEffect,
          rightsAndConsent: lead.rightsAndConsent, reviewQuestion: lead.reviewQuestion })),
        unattributedDepictionCount: option.unattributedCountryDepictionCount,
        meaning: "source_depiction_and_dated_context_only_not_affected_party_or_obstacle" },
      naturalSystemLeads: { totalCount: option.naturalFeatureLeads.length,
        omittedCount: Math.max(0, option.naturalFeatureLeads.length - 30),
        entries: option.naturalFeatureLeads.slice(0, 30).map((lead) => ({
          kind: lead.kind, label: lead.label, sourceUrl: lead.sourceUrl,
          pathSegmentIndices: lead.pathSegmentIndices })),
        meaning: "mapped_feature_contact_not_ecological_effect_or_permission" },
      comparison: { noBuildPolicyReviewOptionId: option.comparisonHandoff.noBuildBaseline.optionId,
        commonBasisQuestion: option.comparisonHandoff.basisQuestion,
        objectives: option.comparisonHandoff.objectives.map((objective) => ({
          objective: objective.objective, mappedPathStatus: objective.mappedPathStatus,
          peerOptionIds: objective.scenarioInfrastructureOptions.map((peer) => peer.optionId),
          measurementQuestion: objective.measurementQuestion,
          actorToConsult: objective.actorToConsult,
          outcomeComparison: objective.outcomeComparison })),
        status: "outcomes_permissions_and_common_scope_missing" },
      gates: option.gates.map((gate) => ({ id: gate.id, status: gate.status,
        evidenceNeeded: gate.evidenceNeeded })),
      missingEvidence: { totalCount: missingEvidence.length,
        omittedCount: Math.max(0, missingEvidence.length - 80), entries: missingEvidence.slice(0, 80) },
      eligibility: option.eligibility,
      interpretation: "A source-grounded review agenda, not a preferred, agreed, permitted, operating, or beneficial route; consult the full receipt for every contact and citation." },
  });
}
