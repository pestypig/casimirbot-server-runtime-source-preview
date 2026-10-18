import { z } from "zod";
import {
  civilizationIssueComparisonQuerySchema,
  readCivilizationIssueComparison,
} from "./issue-comparison";
import { readUnga81CountryEvidence, readUnga81PairEvidence, readUnga81CoverageLedger } from "./unga81-evidence";
import { readReviewedCounterpartReferences } from "./counterpart-references";

export const civilizationPairGlanceQuerySchema = civilizationIssueComparisonQuerySchema;

const glanceAssertionSchema = z.object({
  id: z.string(), claimType: z.string(), text: z.string(), sourceUrl: z.string().url(),
  sourcePage: z.number().int().positive(), speaker: z.string(), speechDate: z.string(),
  reviewRevision: z.number().int().positive(), uncertainty: z.string(),
  deliveryAlignment: z.enum(["topic_consistent", "wording_discrepancy", "not_reconciled"]),
  deliveryNote: z.string().nullable(),
}).strict();

export const civilizationPairGlanceOutputSchema = z.object({
  schemaVersion: z.literal("civilization_diplomatic_pair_glance/v18"),
  query: civilizationPairGlanceQuerySchema,
  directions: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/), counterpartIso3: z.string().regex(/^[A-Z]{3}$/),
    countryName: z.string().nullable(),
    sourceLanguage: z.string().nullable(),
    positionStatus: z.enum(["selected_issue_assertion", "general_reviewed_assertion_only", "reviewed_assertion_unavailable"]),
    leadBasis: z.enum(["explicit_counterpart_reference_in_selected_issue", "selected_issue_assertion",
      "explicit_counterpart_reference_outside_selected_issue", "general_reviewed_assertion", "unavailable"]),
    assertion: glanceAssertionSchema.nullable(),
    counterpartReference: z.object({
      status: z.enum(["issue_specific_reviewed_reference", "general_reviewed_reference_only", "not_identified_in_reviewed_selection"]),
      assertion: glanceAssertionSchema.nullable(),
      basis: z.literal("submitted_statement_explicitly_names_counterpart_or_bilateral_pair"),
    }).strict(),
    directCounterpartAssessment: z.literal("not_determined_from_selected_assertion"),
  }).strict()).length(2),
  sharedTopic: z.object({
    facetId: z.string(), label: z.string(),
    comparisonBasis: z.enum(["pair_specific_editorial_crosswalk", "parallel_reviewed_topic_inventory"]),
    sharedPublicTopic: z.string().nullable(),
    differenceInSubmittedClaims: z.string().nullable(),
    directTensionStatus: z.enum(["not_identified_in_selected_assertions", "not_assessable_from_selected_coverage",
      "reciprocal_security_allegations_unadjudicated"]),
    assertionIds: z.array(z.string()),
    unansweredQuestion: z.string(),
  }).strict().nullable(),
  corpusCoverage: z.object({
    indexedDelegationPages: z.number().int().nonnegative(),
    delegationPagesWithSelectedReviewedBrief: z.number().int().nonnegative(),
    selectedReviewedAssertionCount: z.number().int().nonnegative(),
    fullSpeechAssertionReviewStatus: z.literal("not_issued_in_current_manifest"),
    selectedIssueTopics: z.array(z.object({
      id: z.string(), label: z.string(), indexedDelegationPageCount: z.number().int().nonnegative(),
      countriesWithAdmittedSelectedAssertionsCount: z.number().int().nonnegative(),
      selectedPairCountriesWithAdmittedAssertions: z.array(z.string().regex(/^[A-Z]{3}$/)),
    }).strict()),
    selectedCountries: z.array(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/),
      officialPageCount: z.number().int().nonnegative(),
      reviewedAssertionCount: z.number().int().nonnegative(),
      submittedTextStatus: z.string(),
      deliveryStatus: z.string(),
      dateCrosscheck: z.object({
        officialPageDates: z.array(z.string().date()), provisionalTranscriptDates: z.array(z.string().date()),
        submittedDocumentDate: z.string().max(64).nullable(), submittedDocumentDatePageUrl: z.string().url().nullable(),
        submittedDocumentDateStatus: z.enum(["not_recorded", "source_not_admitted", "official_page_date_missing",
          "matches_official_page", "differs_from_official_page"]),
      }).strict(),
      nextReviewStage: z.string(),
      nextReviewReason: z.string(),
      sourceUrls: z.array(z.string().url()),
    }).strict()).length(2),
    interpretation: z.literal("Roster inclusion and a selected brief do not establish a complete national position, verified delivered speech, or current policy."),
  }).strict(),
  nextQuestions: z.array(z.object({ facetId: z.string(), question: z.string(),
    evidenceAssertionIds: z.array(z.string()) }).strict()),
  reviewFace: z.object({ assetMood: z.literal("question"),
    meaning: z.literal("evidence_review_needed_not_diplomatic_sentiment") }).strict(),
  interactionCue: z.object({
    status: z.enum(["dated_joint_public_record", "no_joint_public_record_in_current_evidence"]),
    assetMood: z.enum(["friend", "question"]),
    meaning: z.enum(["documented_joint_public_engagement_not_current_diplomatic_sentiment",
      "joint_public_engagement_not_established_by_current_selection"]),
    record: z.object({ id: z.string(), kind: z.string(), eventDate: z.string().date(),
      legalStatus: z.string(), parties: z.array(z.string().regex(/^[A-Z]{3}$/)).min(2),
      sourceUrl: z.string().url(), sourceUrls: z.array(z.string().url()).min(1), limits: z.string() }).strict().nullable(),
  }).strict(),
  relationshipAssessment: z.literal("unassessed"),
  limits: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();

export type CivilizationPairGlance = z.infer<typeof civilizationPairGlanceOutputSchema>;

export function readCivilizationPairGlance(input: unknown): CivilizationPairGlance {
  const query = civilizationPairGlanceQuerySchema.parse(input);
  const issue = readCivilizationIssueComparison(query);
  const pair = readUnga81PairEvidence({ firstCountryIso3: query.firstCountryIso3,
    secondCountryIso3: query.secondCountryIso3 });
  const coverage = readUnga81CoverageLedger();
  const countries = [query.firstCountryIso3, query.secondCountryIso3] as const;
  const jointRecord = [...pair.bilateralEvidence.records, ...pair.multilateralGovernmentEvidence.records]
    .filter((record) => record.parties.includes(countries[0]) && record.parties.includes(countries[1]) &&
      (record.kind === "joint_declaration" || record.kind === "trilateral_joint_statement"))
    .sort((left, right) => right.eventDate.localeCompare(left.eventDate))[0];
  const publicProjectMilestones = issue.datedProjectMilestones.filter((milestone) =>
    milestone.eventKind === "construction_launch_ceremony" ||
    milestone.eventKind === "government_joint_project_announcement");
  const twoGovernmentProject = publicProjectMilestones.find((milestone) =>
    countries.every((countryIso3) => publicProjectMilestones.some((candidate) =>
      candidate.projectId === milestone.projectId && candidate.sourceActorKind === "national_government" &&
      candidate.sourceActorCountryIso3 === countryIso3)));
  const projectSourceRecords = twoGovernmentProject
    ? publicProjectMilestones.filter((milestone) => milestone.projectId === twoGovernmentProject.projectId)
    : [];
  const leadFacetId = query.issueId === "humanitarian_cooperation" ? "missing_persons"
    : query.issueId === "natural_system_cooperation" ? "natural_system_topic" : "connectivity_and_transit";
  const orderedFacets = [...issue.facets].sort((left, right) =>
    Number(right.id === leadFacetId) - Number(left.id === leadFacetId));
  const sharedFacet = [...orderedFacets].sort((left, right) =>
    Number(right.comparisonBasis === "pair_specific_editorial_crosswalk") -
      Number(left.comparisonBasis === "pair_specific_editorial_crosswalk")).find((facet) =>
    countries.every((iso3) => facet.positions.some((position) => position.countryIso3 === iso3)));
  const presentationFacets = sharedFacet
    ? [sharedFacet, ...orderedFacets.filter((facet) => facet.id !== sharedFacet.id)] : orderedFacets;
  const directions = countries.map((countryIso3) => {
    const country = readUnga81CountryEvidence({ countryIso3 });
    const counterpartIso3 = countries.find((iso3) => iso3 !== countryIso3)!;
    const explicitIds = readReviewedCounterpartReferences(countryIso3, counterpartIso3).map((reference) => reference.id);
    const issuePositions = presentationFacets.flatMap((facet) => facet.positions);
    const counterpartIssuePosition = issuePositions
      .find((position) => position.countryIso3 === countryIso3 && explicitIds.includes(position.id));
    const issuePosition = counterpartIssuePosition ?? issuePositions
      .find((position) => position.countryIso3 === countryIso3);
    const counterpartGeneralAssertion = counterpartIssuePosition ? undefined : country.reviewedBrief?.assertions
      .find((item) => explicitIds.includes(item.id));
    const generalAssertion = !issuePosition
      ? counterpartGeneralAssertion ?? country.reviewedBrief?.assertions[0] : undefined;
    const reconciliation = generalAssertion ? country.reconciliation?.assertions
      .find((item) => item.assertionId === generalAssertion.id) : undefined;
    const assertion = issuePosition ? {
      id: issuePosition.id, claimType: issuePosition.claimType, text: issuePosition.text,
      sourceUrl: issuePosition.sourceUrl, sourcePage: issuePosition.sourcePage,
      speaker: issuePosition.speaker, speechDate: issuePosition.speechDate,
      reviewRevision: issuePosition.reviewRevision, uncertainty: issuePosition.uncertainty,
      deliveryAlignment: issuePosition.provisionalReconciliation.alignment,
      deliveryNote: issuePosition.provisionalReconciliation.note,
    } : generalAssertion && country.reviewedBrief ? {
      id: generalAssertion.id, claimType: generalAssertion.claimType, text: generalAssertion.text,
      sourceUrl: generalAssertion.sourceUrl, sourcePage: generalAssertion.sourcePage,
      speaker: country.reviewedBrief.speaker, speechDate: country.reviewedBrief.speechDate,
      reviewRevision: country.reviewedBrief.revision, uncertainty: generalAssertion.uncertainty,
      deliveryAlignment: reconciliation?.alignment ?? "not_reconciled" as const,
      deliveryNote: reconciliation?.note ?? null,
    } : null;
    const counterpartReconciliation = counterpartGeneralAssertion ? country.reconciliation?.assertions
      .find((item) => item.assertionId === counterpartGeneralAssertion.id) : undefined;
    const counterpartAssertion = counterpartIssuePosition ? {
      id: counterpartIssuePosition.id, claimType: counterpartIssuePosition.claimType,
      text: counterpartIssuePosition.text, sourceUrl: counterpartIssuePosition.sourceUrl,
      sourcePage: counterpartIssuePosition.sourcePage, speaker: counterpartIssuePosition.speaker,
      speechDate: counterpartIssuePosition.speechDate, reviewRevision: counterpartIssuePosition.reviewRevision,
      uncertainty: counterpartIssuePosition.uncertainty,
      deliveryAlignment: counterpartIssuePosition.provisionalReconciliation.alignment,
      deliveryNote: counterpartIssuePosition.provisionalReconciliation.note,
    } : counterpartGeneralAssertion && country.reviewedBrief ? {
      id: counterpartGeneralAssertion.id, claimType: counterpartGeneralAssertion.claimType,
      text: counterpartGeneralAssertion.text, sourceUrl: counterpartGeneralAssertion.sourceUrl,
      sourcePage: counterpartGeneralAssertion.sourcePage, speaker: country.reviewedBrief.speaker,
      speechDate: country.reviewedBrief.speechDate, reviewRevision: country.reviewedBrief.revision,
      uncertainty: counterpartGeneralAssertion.uncertainty,
      deliveryAlignment: counterpartReconciliation?.alignment ?? "not_reconciled" as const,
      deliveryNote: counterpartReconciliation?.note ?? null,
    } : null;
    return {
      countryIso3,
      counterpartIso3,
      countryName: country.countryName,
      sourceLanguage: country.reviewedBrief?.sourceLanguage ?? null,
      positionStatus: issuePosition ? "selected_issue_assertion" as const
        : generalAssertion ? "general_reviewed_assertion_only" as const
          : "reviewed_assertion_unavailable" as const,
      leadBasis: counterpartIssuePosition ? "explicit_counterpart_reference_in_selected_issue" as const
        : issuePosition ? "selected_issue_assertion" as const
          : counterpartGeneralAssertion ? "explicit_counterpart_reference_outside_selected_issue" as const
            : generalAssertion ? "general_reviewed_assertion" as const : "unavailable" as const,
      assertion,
      counterpartReference: {
        status: counterpartIssuePosition ? "issue_specific_reviewed_reference" as const
          : counterpartGeneralAssertion ? "general_reviewed_reference_only" as const
            : "not_identified_in_reviewed_selection" as const,
        assertion: counterpartAssertion,
        basis: "submitted_statement_explicitly_names_counterpart_or_bilateral_pair" as const,
      },
      directCounterpartAssessment: "not_determined_from_selected_assertion" as const,
    };
  });
  return civilizationPairGlanceOutputSchema.parse({
    schemaVersion: "civilization_diplomatic_pair_glance/v18", query, directions,
    sharedTopic: sharedFacet ? {
      facetId: sharedFacet.id, label: sharedFacet.label, comparisonBasis: sharedFacet.comparisonBasis,
      sharedPublicTopic: sharedFacet.contrast.sharedPublicTopic,
      differenceInSubmittedClaims: sharedFacet.contrast.differenceInSubmittedClaims,
      directTensionStatus: sharedFacet.contrast.directTensionStatus,
      assertionIds: sharedFacet.positions.map((position) => position.id),
      unansweredQuestion: sharedFacet.unansweredQuestion,
    } : null,
    corpusCoverage: {
      indexedDelegationPages: coverage.rosterReconciliation.officialDelegationPageCount,
      delegationPagesWithSelectedReviewedBrief: coverage.positionCoverage.delegationPagesWithHashMatchedSelectedBrief,
      selectedReviewedAssertionCount: coverage.positionCoverage.selectedReviewedAssertionCount,
      fullSpeechAssertionReviewStatus: coverage.positionCoverage.fullSpeechAssertionReviewStatus,
      selectedIssueTopics: coverage.positionCoverage.topics.filter((topic) => topic.issueId === query.issueId)
        .map((topic) => ({
          id: topic.id, label: topic.label, indexedDelegationPageCount: topic.indexedDelegationPageCount,
          countriesWithAdmittedSelectedAssertionsCount: topic.countriesWithAdmittedSelectedAssertions.length,
          selectedPairCountriesWithAdmittedAssertions: countries.filter((countryIso3) =>
            topic.countriesWithAdmittedSelectedAssertions.some((country) => country.countryIso3 === countryIso3)),
        })),
      selectedCountries: countries.map((countryIso3) => {
        const row = coverage.rows.find((item) => item.countryIso3 === countryIso3);
        const next = coverage.reviewQueue.find((item) => item.countryIso3 === countryIso3);
        return {
          countryIso3,
          officialPageCount: row?.officialPageCount ?? 0,
          reviewedAssertionCount: row?.reviewedAssertionCount ?? 0,
          submittedTextStatus: row?.sourceVerification.submittedText ?? "missing_or_unavailable",
          deliveryStatus: row?.sourceVerification.delivery ?? "provisional_segment_missing",
          dateCrosscheck: {
            officialPageDates: row?.officialDates ?? [], provisionalTranscriptDates: row?.provisionalDates ?? [],
            submittedDocumentDate: row?.submittedDocumentDateReview.date ?? null,
            submittedDocumentDatePageUrl: row?.submittedDocumentDateReview.sourcePageUrl ?? null,
            submittedDocumentDateStatus: row?.submittedDocumentDateReview.status ?? "not_recorded",
          },
          nextReviewStage: next?.stage ?? "reconcile_affiliation_date",
          nextReviewReason: next?.reason ?? "This country has no indexed coverage row; review the official source and affiliation.",
          sourceUrls: next?.sourceUrls ?? [],
        };
      }),
      interpretation: "Roster inclusion and a selected brief do not establish a complete national position, verified delivered speech, or current policy.",
    },
    nextQuestions: orderedFacets.filter((facet) => facet.positions.length > 0).slice(0, 4).map((facet) => ({ facetId: facet.id,
      question: facet.unansweredQuestion, evidenceAssertionIds: facet.positions.map((position) => position.id) })),
    reviewFace: { assetMood: "question", meaning: "evidence_review_needed_not_diplomatic_sentiment" },
    interactionCue: jointRecord ? {
      status: "dated_joint_public_record", assetMood: "friend",
      meaning: "documented_joint_public_engagement_not_current_diplomatic_sentiment",
      record: { id: jointRecord.id, kind: jointRecord.kind, eventDate: jointRecord.eventDate,
        legalStatus: jointRecord.legalStatus, parties: jointRecord.parties,
        sourceUrl: jointRecord.sourceUrl, sourceUrls: [jointRecord.sourceUrl], limits: jointRecord.limits },
    } : twoGovernmentProject ? {
      status: "dated_joint_public_record", assetMood: "friend",
      meaning: "documented_joint_public_engagement_not_current_diplomatic_sentiment",
      record: {
        id: `project:${twoGovernmentProject.projectId}:two_government_announcement`,
        kind: "joint_project_announcement",
        eventDate: projectSourceRecords.map((record) => record.sourceDate).sort()[0],
        legalStatus: "announced_project_permissions_unverified", parties: [...countries],
        sourceUrl: twoGovernmentProject.sourceUrl,
        sourceUrls: projectSourceRecords.map((record) => record.sourceUrl),
        limits: "Dated government announcements from both countries document a project intention, not a binding route agreement, surveyed alignment, permissions, completed infrastructure, current operation, or national sentiment.",
      },
    } : {
      status: "no_joint_public_record_in_current_evidence", assetMood: "question",
      meaning: "joint_public_engagement_not_established_by_current_selection", record: null,
    },
    relationshipAssessment: "unassessed",
    limits: [
      "These are selected source-checked submitted-statement paraphrases, not verified delivered speech or current policy.",
      "A shared public topic is not an agreement. A general-statement fallback is not a position on the selected issue.",
      "Outside the pair-specific pilot, shared-topic cards are parallel reviewed assertion inventories; they do not establish bilateral relevance, support, or tension.",
      "The face marks evidence review; it does not measure diplomatic mood, national sentiment, or cooperation potential.",
      "A cited counterpart reference records what a speaker publicly said about a named pair; it does not prove the other government's response or a current bilateral position.",
      "The friendly face marks a dated joint public record only. It is not a friendship, trust, peace, or present-day cooperation score.",
      "Use the issue, relationship, scenario, and geospatial receipts to examine legal, third-party, infrastructure, natural-system, and affected-community constraints.",
    ],
    authority: { assistant_answer: false, terminal_eligible: false,
      execution_permission: false, policy_finality: false },
  });
}
