import { z } from "zod";
import { comtradePairOutputSchema, readComtradePair } from "./comtrade-pair";
import { plannedJointVentureSchema, readUnga81CountryEvidence, readUnga81PairEvidence, readUnga81CoverageLedger, unga81PairEvidenceSchema } from "./unga81-evidence";
import { civilizationRelationshipNetworkOutputSchema, composeCivilizationRelationshipNetwork } from "./relationship-network";
import { civilizationIssueComparisonOutputSchema, readCivilizationIssueComparison } from "./issue-comparison";
import { readReviewedCounterpartInfrastructureConcepts, readReviewedCounterpartReferences } from "./counterpart-references";
import { naturalEarthLakeSystemIdByFeatureId, naturalEarthWaterwaySystemIdByFeatureId } from "./named-natural-systems";
import { reviewedNaturalPolicyProposalSpecs } from "./reviewed-natural-policy-proposals";
import { readUnga81PairReviewLeads, unga81PairReviewLeadsOutputSchema } from "./unga81-pair-review-leads";
import { civilizationRamsarRouteReviewSchema } from "../civilization-live-sources/ramsar-route-review";
import {
  civilizationDiplomaticCorridorPacketSchema,
  civilizationDiplomaticCorridorQuerySchema,
  readDiplomaticCorridorPacket,
} from "../civilization-live-sources/diplomatic-corridor-packet";
import {
  civilizationCorridorScalePlanQuerySchema,
  civilizationCorridorScalePlanOutputSchema,
  planCivilizationCorridorScaleEvidence,
} from "../civilization-live-sources/corridor-scale-evidence-plan";

const objectiveSchema = z.enum(["mapped_length", "trade_access", "resilience", "emissions", "environmental_protection", "mutual_benefit"]);
const scenarioSchemaVersion = "civilization_diplomatic_scenario_comparison/v130" as const;
const comparisonDomainSchema = z.enum(["dated_observation", "connectivity_policy", "peace_process_policy", "natural_system_policy", "humanitarian_policy", "connectivity_infrastructure"]);
const generalizedWaterwayContactSchema = z.object({
  lineId: z.string().min(1), label: z.string().min(1),
  featureKind: z.enum(["river", "lake_centerline"]),
  contactKind: z.enum(["point", "overlap"]),
  alignmentSegmentIndex: z.number().int().nonnegative(),
  position: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
  sourceRecordUrl: z.string().url(),
  interpretation: z.literal("generalized_cartographic_contact_not_verified_water_crossing_or_effect"),
}).strict();
const generalizedLakeContactSchema = z.object({
  lakeFeatureId: z.number().int(), label: z.string().min(1),
  contactKind: z.enum(["outline_point", "outline_overlap", "inside_depiction"]),
  alignmentSegmentIndex: z.number().int().nonnegative(),
  position: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
  sourceRecordUrl: z.string().url(), routeEvidenceRefs: z.array(z.string()),
  interpretation: z.literal("generalized_polygon_contact_not_current_water_or_effect"),
}).strict();
const governmentConditionSchema = z.object({
  recordId: z.string(), parties: z.array(z.string()), legalStatus: z.string(), statusAsOf: z.string().date(),
  sourceUrl: z.string().url(), conditions: z.array(z.string()),
  reportedMeasures: z.array(z.object({ metric: z.string(), value: z.number().nonnegative(),
    unit: z.string(), qualifier: z.string(), period: z.string(), independentVerification: z.literal("not_verified") }).strict()),
  plannedJointVenture: plannedJointVentureSchema.nullable(),
  thirdPartyDependencies: z.array(z.object({ partyIso3: z.string().nullable(), role: z.string() }).strict()),
}).strict();
const conditionContextSchema = z.object({
  callerRequiredSafeguards: z.array(z.string()),
  bilateralGovernmentContext: z.array(governmentConditionSchema),
  multilateralGovernmentContext: z.array(governmentConditionSchema),
  contingentFrameworks: z.array(governmentConditionSchema.extend({
    applicability: z.literal("only_if_project_uses_this_framework"),
  }).strict()),
  callerAdditionalConditions: z.array(z.string()),
}).strict();

export const civilizationScenarioComparisonQuerySchema = z.object({
  firstCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  secondCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  tradeYear: z.number().int().min(2020).max(2025),
  planningHorizonYear: z.number().int().min(2026).max(2100),
  objectives: z.array(objectiveSchema).min(1).max(4),
  constraints: z.object({
    respectSovereigntyAndJurisdiction: z.literal(true),
    requireDocumentedTransitAndConstructionPermissions: z.literal(true),
    requireAffectedThirdPartyConsent: z.literal(true),
    requireEnvironmentalAndCommunityReview: z.literal(true),
    maximumBudgetUsd: z.number().positive().nullable(),
    additionalConditions: z.array(z.string().trim().min(3).max(200)).max(8),
  }).strict(),
  corridor: civilizationDiplomaticCorridorQuerySchema.optional(),
  corridorScaleSketch: civilizationCorridorScalePlanQuerySchema.optional(),
}).strict().superRefine((query, context) => {
  if (query.firstCountryIso3 === query.secondCountryIso3) {
    context.addIssue({ code: "custom", message: "Select two different countries." });
  }
  if (new Set(query.objectives).size !== query.objectives.length) {
    context.addIssue({ code: "custom", message: "Objectives must be unique." });
  }
  if (query.corridor &&
      (query.corridor.countryIso3s.length !== 2 ||
       !query.corridor.countryIso3s.includes(query.firstCountryIso3) ||
       !query.corridor.countryIso3s.includes(query.secondCountryIso3))) {
    context.addIssue({ code: "custom", message: "A corridor comparison must request both selected country depictions." });
  }
  if (query.corridor &&
      query.planningHorizonYear < new Date(query.corridor.route.evaluatedAt).getUTCFullYear()) {
    context.addIssue({ code: "custom", message: "The planning horizon cannot precede the corridor evidence evaluation year." });
  }
  if (query.corridorScaleSketch &&
      query.planningHorizonYear < new Date(query.corridorScaleSketch.evaluatedAt).getUTCFullYear()) {
    context.addIssue({ code: "custom", message: "The planning horizon cannot precede the corridor sketch evaluation year." });
  }
});

const optionSchema = z.object({
  id: z.string(),
  comparisonDomain: comparisonDomainSchema,
  kind: z.enum(["documented_dated_interaction", "no_build_policy_review", "unlocated_infrastructure_concept",
    "mapped_network_candidate", "caller_supplied_sketch", "mapped_component_gap_hypothesis"]),
  evidenceState: z.enum(["partial_government_or_trade_sources", "unquantified_policy_only_option",
    "submitted_statement_concept_only", "submitted_statement_with_dated_government_project_milestone", "conditional_government_framework_modality_only", "mapped_topology_only", "source_screened_sketch", "source_screened_gap_hypothesis"]),
  concept: z.object({
    family: z.enum(["rail_restoration", "rail_connection", "road_link", "pipeline_link", "electricity_link", "fiberoptic_link"]),
    origin: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("reviewed_submitted_assertion"), countryIso3: z.string().regex(/^[A-Z]{3}$/),
        namedCounterpartIso3: z.string().regex(/^[A-Z]{3}$/).nullable(),
        assertionId: z.string(), claimType: z.string(), sourceUrl: z.string().url(),
        deliveredWordingStatus: z.literal("not_reconciled") }).strict(),
      z.object({ kind: z.literal("conditional_government_framework"), recordId: z.string(),
        parties: z.array(z.string().regex(/^[A-Z]{3}$/)).min(2), sourceSections: z.array(z.string()).min(1),
        sourceUrl: z.string().url(), legalStatus: z.literal("entry_into_force_unverified"),
        statusAsOf: z.string().date(), projectConfirmation: z.literal("not_obtained") }).strict(),
    ]),
    counterpartSpecificSupport: z.enum(["not_established_in_selected_assertions", "named_counterpart_one_sided_no_consent", "both_governments_reported_project_announcement_no_permissions", "not_established_by_framework"]),
    alignmentStatus: z.literal("not_defined"),
    interpretation: z.enum(["A cited submitted-statement concept is not a jointly agreed, located, permitted, or funded project.",
      "A submitted statement describing a named-counterpart railway does not verify its construction status, alignment, operating terms, partner agreement, or effects.",
      "A submitted report of a named-counterpart pipeline construction launch does not verify its alignment, completion, operating terms, partner agreement, or effects.",
      "Government sources on both sides announced a pipeline project; its surveyed alignment, completion, operating terms, permissions, and effects remain unverified.",
      "A conditional Armenia–U.S. framework modality does not establish Azerbaijan's agreement or a confirmed, located, permitted, or funded project."]),
  }).strict().nullable(),
  policyReview: z.object({
    subject: z.enum(["existing_transit_and_operating_rules", "missing_persons_and_mine_action",
      "parallel_topic_dialogue", "peace_process_implementation_review", "parallel_natural_system_dialogue", "parallel_climate_dialogue", "parallel_disaster_dialogue",
      "one_sided_named_natural_system_proposal", "one_sided_project_scope_dialogue", "access_and_jurisdiction_dialogue"]),
    question: z.string(),
    submittedAssertionIds: z.array(z.string()),
    governmentRecordIds: z.array(z.string()),
    evidenceStatus: z.enum(["reported_interaction_operating_terms_unverified",
      "initialed_article_ix_separate_modalities_unverified", "parallel_topics_no_bilateral_terms",
      "reciprocal_security_claims_process_implementation_unverified",
      "one_sided_submitted_proposal_counterpart_unassessed", "one_sided_position_with_dated_project_source",
      "distinct_submitted_positions_no_common_proposal"]),
    noConstructionAssumed: z.literal(true),
    interpretation: z.string(),
  }).strict().nullable(),
  mappedDistanceKm: z.number().nonnegative().nullable(),
  sourceUrls: z.array(z.string().url()),
  objectiveReadiness: z.array(z.object({
    objective: objectiveSchema,
    status: z.enum(["bounded_mapped_length_only", "not_quantified", "not_applicable_to_option", "not_applicable_to_observation"]),
    value: z.number().nonnegative().nullable(),
    unit: z.enum(["km"]).nullable(),
  }).strict()),
  conditionContext: conditionContextSchema,
  sourceScreens: z.object({
    mappedInfrastructure: z.object({
      status: z.enum(["not_applicable_no_route", "mapped_topology_candidate", "sketch_way_contacts", "not_requested", "area_too_large", "unavailable"]),
      networkKinds: z.array(z.string()),
      mappedSegmentCount: z.number().int().nonnegative().nullable(),
      mappedWays: z.array(z.object({ edgeId: z.string(), networkKind: z.string(), sourceRecordUrl: z.string().url(), evidenceRefs: z.array(z.string()) }).strict()).max(50),
      networkTransitionCount: z.number().int().nonnegative(),
      networkTransitions: z.array(z.object({ alignmentSegmentIndex: z.number().int().positive(), fromKind: z.string(), toKind: z.string(),
        nodeRef: z.string(), position: z.object({ lat: z.number(), lon: z.number() }).strict(),
        fromSourceRecordUrl: z.string().url(), toSourceRecordUrl: z.string().url(),
        relation: z.literal("shared_osm_node_only"), facilityStatus: z.literal("unverified") }).strict()).max(50),
      networkTransitionsOmitted: z.boolean(),
      pipelineTagReview: z.object({
        status: z.enum(["not_applicable", "all_untagged", "partially_tagged", "all_tagged_same_text", "tagged_values_differ"]),
        wayCount: z.number().int().nonnegative(), untaggedWayCount: z.number().int().nonnegative(),
        distinctSubstanceTags: z.array(z.string()),
        ways: z.array(z.object({ edgeId: z.string(), sourceRecordUrl: z.string().url(), substanceTag: z.string().nullable() }).strict()).max(50),
        waysOmitted: z.boolean(), productCompatibility: z.literal("unverified"), flowDirection: z.literal("unverified"),
      }).strict(),
      sketchContacts: z.array(z.object({ sketchSegmentIndex: z.number().int().nonnegative(), edgeId: z.string(), networkKind: z.string(),
        contactKind: z.enum(["point", "overlap"]), position: z.object({ lat: z.number(), lon: z.number() }).strict(),
        sourceRecordUrl: z.string().url(), sourceEditedAt: z.string().datetime({ offset: true }).nullable() }).strict()).max(150),
      possiblyTruncated: z.boolean(), sourceSnapshotAt: z.string().nullable(), fetchedAt: z.string().nullable(),
      sourceUrls: z.array(z.string().url()),
    }).strict(),
    thirdCountryPolygonContacts: z.object({
      status: z.enum(["not_applicable_no_route", "source_depiction_geometry_screen"]),
      countries: z.array(z.object({
        editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/), isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
        name: z.string(), boundaryContactSegments: z.number().int().nonnegative(),
        interiorSegments: z.number().int().nonnegative(),
      }).strict()),
      indeterminateFeatureIds: z.array(z.string()), bboxCandidatesRejected: z.array(z.string()),
      sourceUrl: z.string().url().nullable(), possiblyTruncated: z.boolean(), antimeridianReviewNeeded: z.boolean(),
    }).strict(),
    thirdCountryDepictionCandidates: z.object({
      status: z.enum(["not_applicable_no_route", "bbox_shortlist_only"]),
      countries: z.array(z.object({
        editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/), isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
        name: z.string(), possibleSegmentCount: z.number().int().positive(),
      }).strict()),
      sourceUrl: z.string().url().nullable(), sourceArchiveSha256: z.string().nullable(),
      antimeridianReviewNeeded: z.boolean(),
    }).strict(),
    thirdCountryEditorialHints: z.object({
      status: z.enum(["not_applicable_no_route", "not_assessed", "editorial_line_adjacency_only"]),
      countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)),
      sourceUrls: z.array(z.string().url()),
      possiblyTruncated: z.boolean(),
    }).strict(),
    administrativeDepictionContacts: z.object({
      status: z.enum(["not_applicable_no_route", "not_selected", "available", "partial", "unavailable"]),
      countries: z.array(z.object({
        countryIso3: z.string().regex(/^[A-Z]{3}$/),
        status: z.enum(["available", "unavailable"]),
        contactCount: z.number().int().nonnegative().nullable(),
        possiblyTruncated: z.boolean(),
        sourceUrls: z.array(z.string().url()),
      }).strict()),
    }).strict(),
    claimReferenceLineContacts: z.object({
      status: z.enum(["not_applicable_no_route", "available", "unavailable"]),
      contactCount: z.number().int().nonnegative().nullable(),
      possiblyTruncated: z.boolean(),
      categories: z.array(z.string()),
      sourceUrls: z.array(z.string().url()),
    }).strict(),
    generalizedWaterwayContacts: z.object({
      status: z.enum(["not_applicable_no_route", "not_assessed", "available", "unavailable"]),
      contactCount: z.number().int().nonnegative().nullable(),
      possiblyTruncated: z.boolean(),
      contacts: z.array(generalizedWaterwayContactSchema).max(150),
      sourceUrls: z.array(z.string().url()),
    }).strict(),
    generalizedLakeContacts: z.object({
      status: z.enum(["not_applicable_no_route", "available", "unavailable"]),
      contactCount: z.number().int().nonnegative().nullable(),
      possiblyTruncated: z.boolean(),
      contacts: z.array(generalizedLakeContactSchema).max(150),
      sourceUrls: z.array(z.string().url()),
    }).strict(),
    terrestrialDepictions: z.object({
      status: z.enum(["not_applicable_no_route", "not_assessed_mapped_route", "area_too_large", "unavailable", "available"]),
      contactCount: z.number().int().nonnegative().nullable(), possiblyTruncated: z.boolean(),
      contacts: z.array(z.object({ sketchSegmentIndex: z.number().int().nonnegative(),
        featureId: z.string(), featureKind: z.string(), featureName: z.string().nullable(),
        geometryRole: z.enum(["closed_way_area", "relation_outer_fragment", "relation_inner_fragment"]),
        relation: z.enum(["boundary_contact", "sketch_vertex_inside_depiction"]),
        position: z.object({ lat: z.number(), lon: z.number() }).strict(),
        sourceRecordUrl: z.string().url(), sourceEditedAt: z.string().datetime({ offset: true }).nullable(),
      }).strict()).max(100),
      sourceSnapshotAt: z.string().nullable(), fetchedAt: z.string().nullable(),
      sourceUrls: z.array(z.string().url()), missingEvidence: z.array(z.string()),
    }).strict(),
    reliefModel: z.object({
      status: z.enum(["not_applicable_no_route", "not_requested", "available", "unavailable"]),
      sampleCount: z.number().int().nonnegative().nullable(),
      sourceModel: z.object({ datasetId: z.string(), modelVersion: z.string(),
        gridSpacingArcSeconds: z.number().positive(), verticalReference: z.string(),
        surfaceVersion: z.string(), sourceTimeMeaning: z.string() }).strict().nullable(),
      samples: z.array(z.object({ sampleIndex: z.number().int().nonnegative(),
        sketchSegmentIndex: z.number().int().nonnegative(), segmentFraction: z.number().min(0).max(1),
        requestedPoint: z.object({ lat: z.number(), lon: z.number() }).strict(),
        sampledGridCellCenter: z.object({ lat: z.number(), lon: z.number() }).strict().nullable(),
        status: z.enum(["available", "no_data", "unavailable"]), heightMeters: z.number().nullable(),
        sourceUrl: z.string().url(), fetchedAt: z.string().datetime({ offset: true }),
      }).strict()).max(12),
      missingEvidence: z.array(z.string()),
      sourceUrls: z.array(z.string().url()),
    }).strict(),
    designatedWetlandBoundary: z.object({
      sites: z.array(z.object({ siteNumber: z.number().int().positive(), countryIso3: z.enum(["ARM", "AZE"]),
        name: z.string(), boundaryStatus: z.enum(["available", "not_in_source_response"]),
        relation: z.enum(["intersects_published_depiction", "no_contact_in_published_depiction", "unknown_no_boundary"]),
        alignmentSegmentIndices: z.array(z.number().int().nonnegative()),
      }).strict()), sourceUrl: z.string().url(), acquiredAt: z.string().datetime({ offset: true }),
    }).strict().nullable(),
    liveRamsarReview: civilizationRamsarRouteReviewSchema.nullable(),
    environmentalImpact: z.enum(["not_applicable_no_route", "not_assessed"]),
    communityEffects: z.enum(["not_applicable_no_route", "not_assessed"]),
  }).strict(),
  missingEvidence: z.array(z.string()),
  eligibility: z.enum(["not_applicable_no_route", "undetermined"]),
}).strict();

const screeningCountSchema = z.object({
  status: z.enum(["available", "partial", "unavailable", "not_requested"]),
  observedCount: z.number().int().nonnegative().nullable(),
  possiblyTruncated: z.boolean(), sourceUrls: z.array(z.string().url()),
}).strict();
const screenedGeometryComparisonSchema = z.object({
  optionId: z.string(), kind: z.enum(["mapped_network_candidate", "caller_supplied_sketch", "mapped_component_gap_hypothesis"]),
  sourceDepictedCountryContacts: screeningCountSchema,
  selectedCountryOutlineContacts: screeningCountSchema,
  editorialBoundaryLineContacts: screeningCountSchema,
  hydrographicLineContacts: screeningCountSchema,
  lakeOutlineContacts: screeningCountSchema,
  publishedWetlandContacts: screeningCountSchema,
  mappedTerrestrialContacts: screeningCountSchema,
  reliefGrid: z.object({ status: screeningCountSchema.shape.status,
    availableCells: z.number().int().nonnegative().nullable(), attemptedCells: z.number().int().nonnegative(),
    sampledMinHeightMeters: z.number().nullable(), sampledMaxHeightMeters: z.number().nullable(),
    sourceUrls: z.array(z.string().url()) }).strict(),
  serviceAndOutcomeComparability: z.literal("not_established"),
  interpretation: z.literal("Source contacts and sparse relief cells are screening observations with unequal coverage, not comparative impacts, feasibility, costs, permissions, benefits, or an option ranking."),
}).strict();

const optionEvidenceLedgerSchema = z.object({
  optionId: z.string(),
  decisionReadiness: z.enum(["observation_not_a_proposal", "cannot_rank_or_approve_distributional_outcomes_unmeasured"]),
  documentedLegalStages: z.array(z.object({
    sourceRecordId: z.string(), parties: z.array(z.string().regex(/^[A-Z]{3}$/)).min(2),
    scope: z.enum(["selected_pair_context", "joint_multilateral_context", "conditional_third_party_framework"]),
    legalStatus: z.string(), statusAsOf: z.string().date(), sourceUrl: z.string().url(),
    applicability: z.enum(["dated_context_only", "only_if_option_uses_framework", "source_framework_for_this_concept"]),
    routePermission: z.literal("not_established"),
  }).strict()),
  gates: z.array(z.object({
    id: z.enum(["sovereignty_and_jurisdiction", "agreement_and_transit_terms", "peace_process_instruments_and_verification", "natural_resource_rights_and_agreement", "humanitarian_protocol_and_family_rights", "construction_permission",
      "infrastructure_service_and_interconnection", "affected_third_party_consent", "environmental_and_community_review"]),
    status: z.enum(["not_applicable_to_observation", "not_applicable_no_construction", "unverified"]),
    contextSourceUrls: z.array(z.string().url()),
    evidenceNeeded: z.string(),
  }).strict()),
  selectedPartyDistribution: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    observedGoodsExportsToCounterpart: z.object({
      counterpartIso3: z.string().regex(/^[A-Z]{3}$/), year: z.number().int(),
      status: z.enum(["available", "no_record", "unavailable", "unmapped_code", "source_unavailable"]),
      primaryValueUsd: z.number().nonnegative().nullable(), sourceUrl: z.string().url().nullable(),
      isReported: z.boolean().nullable(), isAggregate: z.boolean().nullable(),
      interpretation: z.literal("Dated all-merchandise exports reported for this direction are baseline context, not an option outcome, benefit estimate, service flow, or measure of cooperation."),
    }).strict(),
    reviewedPositionAssertionIds: z.array(z.string()),
    issueContextAssertionIds: z.array(z.string()),
    optionPositionStatus: z.enum(["submitted_concept_origin_no_option_consent", "government_joint_project_announcement_permissions_unverified", "submitted_policy_topic_no_option_consent",
      "submitted_one_sided_policy_proposal_no_counterpart_response",
      "no_option_specific_position_established", "not_applicable_dated_observation"]),
    possibleGain: z.literal("not_quantified"), possibleLoss: z.literal("not_quantified"),
    publicAndCommunityEffects: z.literal("not_assessed"),
  }).strict()).length(2),
  potentialThirdPartyOutcomeGaps: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    basis: z.array(z.enum(["conditional_framework_party", "editorial_geometry_contact"])).min(1),
    basisSourceUrls: z.array(z.string().url()).min(1),
    optionSpecificPosition: z.literal("not_established"),
    possibleGain: z.literal("not_quantified"),
    possibleLoss: z.literal("not_quantified"),
    publicAndCommunityEffects: z.literal("not_assessed"),
    interpretation: z.literal("A framework role or source-depicted map contact identifies a possible party to investigate, not a confirmed effect, consent, opposition, or project benefit."),
  }).strict()),
  objectiveEvidencePlans: z.array(z.object({
    objective: objectiveSchema,
    readinessStatus: z.enum(["bounded_mapped_length_only", "not_quantified"]),
    measurementQuestion: z.string().min(1),
    actorToConsult: z.enum(["competent_governments", "infrastructure_operators", "affected_communities",
      "affected_families", "environmental_and_engineering_authorities"]),
    contextSourceUrls: z.array(z.string().url()),
    contextRole: z.literal("dated_context_not_option_outcome_measurement"),
    frontierEligibility: z.literal("not_established"),
  }).strict()),
  datedOperatingReports: civilizationIssueComparisonOutputSchema.shape.datedOperatingReports,
  datedProjectMilestones: civilizationIssueComparisonOutputSchema.shape.datedProjectMilestones,
  institutionalHumanitarianContext: civilizationIssueComparisonOutputSchema.shape.humanitarianContext,
  affectedFamilyContext: civilizationIssueComparisonOutputSchema.shape.familyContext,
  possibleThirdCountryDepictionContacts: z.array(z.object({
    editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/),
    isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
    name: z.string(), sourceUrl: z.string().url(),
    significance: z.literal("geometry_contact_only_not_jurisdiction_or_effect"),
  }).strict()),
  thirdPartyContextReview: z.object({
    optionSpecificEffectStatus: z.literal("unassessed"),
    conditionalFrameworkParties: z.array(z.object({
      partyIso3: z.string().regex(/^[A-Z]{3}$/), sourceRecordId: z.string(),
      sourceUrl: z.string().url(), applicability: z.enum(["only_if_option_uses_framework", "source_framework_for_this_concept"]),
      consentOrVetoStatus: z.literal("not_determined"),
    }).strict()),
    regionalStatementPerspectives: z.array(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/), assertionIds: z.array(z.string()),
      sourceUrls: z.array(z.string().url()), applicability: z.literal("regional_context_only"),
      consentOrVetoStatus: z.literal("not_determined"),
    }).strict()),
    reportedTransitDependencies: z.array(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/), originCountryIso3: z.string().regex(/^[A-Z]{3}$/),
      originAssertionId: z.string(), sourceUrl: z.string().url(),
      status: z.literal("speaker_report_not_operationally_verified"),
      optionSpecificTerms: z.literal("not_assessed"), consentOrVetoStatus: z.literal("not_determined"),
    }).strict()),
    operatorContextSources: civilizationIssueComparisonOutputSchema.shape.thirdPartyOperatingContext,
    geometryContactPositionCoverage: z.array(z.object({
      editorialAdm0A3: z.string().regex(/^[A-Z]{3}$/), isoA3: z.string().regex(/^[A-Z]{3}$/).nullable(),
      name: z.string(), geometrySourceUrl: z.string().url(),
      status: z.enum(["reviewed_selective_submitted_brief", "official_page_only_no_reviewed_brief",
        "official_page_missing", "iso3_unresolved"]),
      submittedPdfLinkStatus: z.enum(["linked", "not_linked", "unknown_no_page"]),
      officialPageUrl: z.string().url().nullable(),
      reviewedBriefSourceUrl: z.string().url().nullable(),
      nextSourceReviewStage: z.string().nullable(),
      nextSourceReviewReason: z.string().nullable(),
      sourceReviewUrls: z.array(z.string().url()),
      effectOnOption: z.literal("unassessed_geometry_contact_only"),
    }).strict()),
    geometryContactStatus: z.enum(["not_applicable_no_alignment", "possible_contacts_require_legal_review",
      "no_contacts_surfaced_not_clearance"]),
    interpretation: z.literal("A third-party statement, reported transit path, contingent framework, or editorial geometry contact does not establish option-specific consent, opposition, jurisdiction, or a veto."),
  }).strict(),
  naturalSystemScreen: z.object({
    status: z.enum(["not_applicable_no_route", "bounded_geometry_observations", "source_unavailable"]),
    designatedWetlandContext: civilizationIssueComparisonOutputSchema.shape.designatedWetlandContext,
    designatedWetlandRouteRelation: z.enum(["not_screened_no_alignment", "partial_published_boundary_screen"]),
    designatedWetlandBoundaryScope: z.enum(["not_screened", "five_armenia_azerbaijan_pilot_sites_only"]),
    selectedCountryWetlandBoundaryGaps: z.array(z.string().regex(/^[A-Z]{3}$/)),
    designatedWetlandSites: z.array(z.object({ siteNumber: z.number().int().positive(), countryIso3: z.enum(["ARM", "AZE"]),
      name: z.string(), boundaryStatus: z.enum(["available", "not_in_source_response"]),
      relation: z.enum(["intersects_published_depiction", "no_contact_in_published_depiction", "unknown_no_boundary"]),
      alignmentSegmentIndices: z.array(z.number().int().nonnegative()),
    }).strict()),
    liveRamsarReview: civilizationRamsarRouteReviewSchema.nullable(),
    generalizedWaterwayContactCount: z.number().int().nonnegative().nullable(),
    generalizedWaterwayContacts: z.array(generalizedWaterwayContactSchema).max(150),
    waterwayContactsPossiblyTruncated: z.boolean(),
    reviewedStatementWaterwayLinks: z.array(z.object({
      lineId: z.string().min(1), lineLabel: z.string().min(1),
      lineSourceRecordUrl: z.string().url(), systemId: z.string().min(1),
      countryIso3: z.string().regex(/^[A-Z]{3}$/), assertionId: z.string().min(1),
      statementSourceUrl: z.string().url(),
      relation: z.literal("same_named_system_editorial_crosswalk_only"),
      interpretation: z.literal("A reviewed statement and generalized mapped line share a name family; this does not establish the same affected reach, hydrology, rights, project, permission, or measured effect."),
    }).strict()).max(150),
    generalizedLakeContactCount: z.number().int().nonnegative().nullable(),
    generalizedLakeContacts: z.array(generalizedLakeContactSchema).max(150),
    lakeContactsPossiblyTruncated: z.boolean(),
    reviewedStatementLakeLinks: z.array(z.object({
      lakeFeatureId: z.number().int(), lakeLabel: z.string().min(1), lakeSourceRecordUrl: z.string().url(),
      systemId: z.string().min(1), countryIso3: z.string().regex(/^[A-Z]{3}$/),
      assertionId: z.string().min(1), statementSourceUrl: z.string().url(),
      relation: z.literal("same_named_place_editorial_crosswalk_only"),
      interpretation: z.literal("A reviewed statement naming this place does not establish a position, permission, project, or measured effect for this option."),
    }).strict()).max(150),
    terrestrialDepictions: optionSchema.shape.sourceScreens.shape.terrestrialDepictions,
    reliefSampleCount: z.number().int().nonnegative().nullable(),
    sourceUrls: z.array(z.string().url()),
    environmentalReviewStatus: z.literal("not_assessed"),
    interpretation: z.literal("Published wetland depictions, generalized waterways and lake outlines, mapped terrestrial OSM ways and relation fragments, and model-height samples do not establish ecological impact, current land cover, legal protection, flood risk, water availability, permission, or engineering feasibility."),
  }).strict(),
  infrastructureScreen: optionSchema.shape.sourceScreens.shape.mappedInfrastructure,
  unidentifiedAffectedActors: z.array(z.enum(["local_communities", "displaced_and_conflict_affected_communities", "families_of_missing", "mine_affected_communities", "infrastructure_owners_and_operators", "cross_border_ecosystems"])),
  nextEvidenceRequests: z.array(z.object({
    id: z.string(), trigger: z.enum(["dated_observation", "policy_only_option", "built_option",
      "possible_third_country_contact", "generalized_waterway_contact", "generalized_lake_outline_contact", "published_wetland_depiction_contact", "mapped_terrestrial_depiction_contact", "relief_model_sample",
      "stated_safety_concern_not_geolocated", "mapped_network_transition", "mapped_network_kind"]),
    requestedEvidence: z.string(),
    actorToConsult: z.enum(["competent_governments", "potentially_affected_third_country",
      "infrastructure_operators", "affected_communities", "affected_families", "environmental_and_engineering_authorities",
      "specialist_hazard_and_clearance_authorities", "independent_monitors_and_humanitarian_agencies"]),
    contextSourceUrls: z.array(z.string().url()),
    status: z.literal("needed_not_obtained"),
  }).strict()),
}).strict();

export const civilizationScenarioComparisonOutputSchema = z.object({
  schemaVersion: z.literal(scenarioSchemaVersion),
  query: civilizationScenarioComparisonQuerySchema,
  collectedAt: z.string().datetime({ offset: true }),
  timeFrame: z.object({
    goodsObservationYear: z.number().int(),
    corridorEvidenceEvaluatedAt: z.string().datetime({ offset: true }).nullable(),
    planningHorizonYear: z.number().int(),
    status: z.literal("caller_declared_horizon"),
    interpretation: z.literal("Trade and map observations are dated evidence; the planning horizon is a question about the future, not a forecast or operating date."),
    sourceTimeline: z.array(z.object({
      sourceId: z.string(), sourceKind: z.enum(["reviewed_submitted_statement", "government_record", "dated_official_negotiating_position", "dated_government_operating_report", "dated_operator_consignment_notice", "dated_government_project_milestone", "third_party_operator_context", "designated_wetland_country_inventory", "institutional_humanitarian_context", "affected_family_report", "third_party_submitted_statement", "observed_goods", "geospatial_source"]),
      sourceTime: z.string().nullable(), sourceTimeMeaning: z.string(), sourceUrl: z.string().url(),
      validityAtPlanningHorizon: z.literal("unverified"),
    }).strict()),
  }).strict(),
  countryPair: unga81PairEvidenceSchema,
  provisionalPairReviewLeads: unga81PairReviewLeadsOutputSchema,
  corpusCoverage: z.object({
    indexedDelegationPages: z.number().int().nonnegative(),
    delegationPagesWithHashMatchedSelectedBrief: z.number().int().nonnegative(),
    selectedReviewedAssertionCount: z.number().int().nonnegative(),
    fullSpeechAssertionReviewStatus: z.literal("not_issued_in_current_manifest"),
    selectedCountries: z.array(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/), officialPageCount: z.number().int().nonnegative(),
      reviewedAssertionCount: z.number().int().nonnegative(), submittedTextStatus: z.string(),
      deliveryStatus: z.string(), dateCrosscheck: z.object({
        officialPageDates: z.array(z.string().date()), provisionalTranscriptDates: z.array(z.string().date()),
        submittedDocumentDate: z.string().max(64).nullable(), submittedDocumentDatePageUrl: z.string().url().nullable(),
        submittedDocumentDateStatus: z.enum(["not_recorded", "source_not_admitted", "official_page_date_missing",
          "matches_official_page", "differs_from_official_page"]),
      }).strict(), nextReviewStage: z.string(), nextReviewReason: z.string(),
      sourceUrls: z.array(z.string().url()),
    }).strict()).length(2),
    topicCoverage: z.array(z.object({
      id: z.string(), label: z.string(), countriesWithAdmittedSelectedAssertionsCount: z.number().int().nonnegative(),
      selectedPairCountriesWithAdmittedAssertions: z.array(z.string().regex(/^[A-Z]{3}$/)),
    }).strict()),
    interpretation: z.literal("Indexed delegations and selective submitted-text assertions do not establish complete national positions, verified delivery, bilateral agreement, or current policy."),
  }).strict(),
  issueComparison: civilizationIssueComparisonOutputSchema,
  naturalSystemIssueComparison: civilizationIssueComparisonOutputSchema,
  humanitarianIssueComparison: civilizationIssueComparisonOutputSchema,
  relationshipNetwork: civilizationRelationshipNetworkOutputSchema,
  trade: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), evidence: comtradePairOutputSchema }).strict(),
    z.object({ status: z.literal("unavailable"), reason: z.string() }).strict(),
  ]),
  corridor: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_requested") }).strict(),
    z.object({ status: z.literal("available"), evidence: civilizationDiplomaticCorridorPacketSchema }).strict(),
    z.object({ status: z.literal("unavailable"), reason: z.string() }).strict(),
  ]),
  corridorScalePlan: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_requested") }).strict(),
    z.object({ status: z.literal("planned"), plan: civilizationCorridorScalePlanOutputSchema }).strict(),
  ]),
  options: z.array(optionSchema),
  optionDiscussionBasis: z.array(z.object({
    optionId: z.string(),
    status: z.enum(["dated_observation_only", "unscoped_baseline_placeholder", "source_grounded_policy_question",
      "cited_unlocated_concept", "mapped_geometry_question"]),
    rationale: z.string().min(1),
    reviewedPositionBasis: z.array(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/), assertionId: z.string(),
      sourceUrl: z.string().url(), sourcePage: z.number().int().positive(), reviewRevision: z.number().int().positive(),
      role: z.enum(["topic_context_not_option_consent", "one_side_concept_origin_not_counterpart_support",
        "one_side_policy_proposal_origin_not_counterpart_support",
        "one_sided_project_statement_not_counterpart_scope_support",
        "access_aspiration_not_somalia_specific_offer", "general_sovereignty_principle_not_ethiopia_response",
        "named_counterpart_statement_not_alignment_support"]),
    }).strict()),
    governmentRecordBasis: z.array(z.object({
      recordId: z.string(), sourceUrl: z.string().url(),
      role: z.enum(["policy_question_context_not_permission", "conditional_framework_origin_not_project_approval"]),
    }).strict()),
    basisSourceUrls: z.array(z.string().url()),
    interpretation: z.literal("A discussion basis identifies why to examine or defer an entry; it does not establish consent, feasibility, benefit, or priority over another option."),
  }).strict()),
  optionEvidenceLedgers: z.array(optionEvidenceLedgerSchema),
  screenedGeometryComparison: z.array(screenedGeometryComparisonSchema).max(7),
  optionInteractionReview: z.object({
    status: z.literal("conditional_relationships_not_outcome_comparisons"),
    links: z.array(z.object({
      firstOptionId: z.string(), secondOptionId: z.string(),
      relation: z.enum(["policy_may_complement_built_service", "rail_road_possible_substitutes_for_defined_demand",
        "mapped_alignments_alternatives_for_same_corridor_question",
        "screened_gap_questions_for_same_corridor", "caller_sketch_and_gap_question_for_same_corridor",
        "natural_topic_may_require_route_specific_review"]),
      evidenceSourceUrls: z.array(z.string().url()),
      conditionsToEvaluate: z.array(z.string()).min(1),
      missingComparableEvidence: z.array(z.string()).min(1),
      status: z.literal("hypothesis_only_not_established"),
      inferenceLimit: z.string().min(1),
    }).strict()),
    interpretation: z.literal("These links are conditional design questions. They do not establish substitutability, complementarity, shared rights, feasibility, or a preferred option."),
  }).strict(),
  reviewActorGraph: z.object({
    schemaVersion: z.literal("civilization_option_review_actor_graph/v8"),
    links: z.array(z.object({
      optionId: z.string(),
      actorKey: z.string(),
      actorLabel: z.string(),
      actorKind: z.enum(["selected_government", "conditional_framework_party", "reported_transit_country", "named_proposal_party",
        "editorial_map_contact_country", "designated_wetland_site", "mapped_waterway_feature", "mapped_lake_feature",
        "mapped_terrestrial_feature",
        "unidentified_actor_class"]),
      relation: z.enum(["selected_for_comparison", "framework_role_only_if_used", "speaker_report_only", "speaker_proposed_role",
        "possible_geometry_contact", "published_boundary_contact", "missing_boundary_unknown",
        "generalized_line_contact", "generalized_polygon_contact", "boundary_contact",
        "sketch_vertex_inside_depiction", "identify_and_consult"]),
      sourceUrls: z.array(z.string().url()),
      generalStatementCoverage: z.object({
        status: z.enum(["reviewed_selective_submitted_brief", "official_page_only_no_reviewed_brief", "official_page_missing"]),
        officialPageUrl: z.string().url().nullable(),
        reviewedBriefSourceUrl: z.string().url().nullable(),
        sourceLanguage: z.string().nullable(),
        reviewedAssertionIds: z.array(z.string()),
        optionSpecificAgreement: z.literal("not_established"),
      }).strict().nullable(),
      relevantEvidenceRequestIds: z.array(z.string()),
      reviewStatus: z.enum(["option_position_unverified", "submitted_concept_origin_no_option_consent", "government_joint_project_announcement_permissions_unverified",
        "submitted_policy_topic_no_option_consent", "submitted_one_sided_policy_proposal_no_counterpart_response",
        "applicability_and_terms_unverified",
        "operation_and_terms_unverified", "jurisdiction_and_effect_unassessed",
        "ecological_effect_unassessed", "hydrological_effect_unassessed", "current_extent_and_effect_unassessed",
        "current_status_and_effect_unassessed",
        "identity_and_view_unverified"]),
      inferenceLimit: z.string().min(1),
    }).strict()),
    interpretation: z.literal("Links identify bounded review questions, not legal jurisdiction, ecological impact, a party's consent, or an option's eligibility."),
  }).strict(),
  frontierReadiness: z.object({
    status: z.literal("not_established_outcomes_and_permissions_unverified"),
    observationOptionIds: z.array(z.string()),
    unscopedPlaceholderOptionIds: z.array(z.string()),
    possibilityCoverage: z.object({
      mappedKinds: z.array(z.object({
        kind: z.enum(["road", "rail", "pipeline", "power", "telecom", "waterway"]),
        returnedInOptionScreens: z.boolean(),
        meaning: z.literal("A returned kind is bounded OSM geometry only; an absent kind is not ruled out."),
      }).strict()).length(6),
      outsideMappedTopology: z.array(z.object({
        family: z.enum(["maritime_shipping", "aviation_cargo", "unbuilt_or_policy_design"]),
        currentEvidenceScope: z.enum(["port_endpoint_leads_only", "no_air_service_or_path_reader",
          "caller_sketch_and_policy_questions_only"]),
        nextEvidenceQuestion: z.string().min(1),
      }).strict()).length(3),
      interpretation: z.literal("The returned option set and map screens are selective. They cannot exclude other transport, utility, institutional, or no-build possibilities or establish an optimal route."),
    }).strict(),
    domains: z.array(z.object({
      comparisonDomain: z.enum(["connectivity_policy", "peace_process_policy", "natural_system_policy", "humanitarian_policy", "connectivity_infrastructure"]),
      optionIds: z.array(z.string()),
      status: z.enum(["one_option_no_within_domain_comparison", "outcomes_and_gates_unverified"]),
      comparisonBasisQuestion: z.string().min(1),
      objectiveCoverage: z.array(z.object({
        objective: objectiveSchema,
        boundedMappedLengthOptionIds: z.array(z.string()),
        unquantifiedOptionIds: z.array(z.string()),
        notApplicableOptionIds: z.array(z.string()),
        measurementPlans: z.array(z.object({
          optionId: z.string(), readinessStatus: z.enum(["bounded_mapped_length_only", "not_quantified"]),
          measurementQuestion: z.string().min(1),
          actorToConsult: optionEvidenceLedgerSchema.shape.objectiveEvidencePlans.element.shape.actorToConsult,
          contextSourceUrls: z.array(z.string().url()),
        }).strict()),
      }).strict()),
      openGateIds: z.array(optionEvidenceLedgerSchema.shape.gates.element.shape.id),
    }).strict()),
    interpretation: z.literal("Dated observations and unscoped baseline placeholders are not proposals in the option frontier. Options in different domains have different outcome meanings. A bounded mapped length is not a comparable benefit, cost, or impact outcome; unresolved gates and unmeasured distribution prevent ranking or an optimum claim."),
  }).strict(),
  comparisonStatus: z.literal("evidence_incomplete_no_optimum_inferred"),
  unresolved: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();

type Readers = {
  tradeReader?: typeof readComtradePair;
  corridorReader?: typeof readDiplomaticCorridorPacket;
};

export async function readCivilizationScenarioComparison(input: unknown, readers: Readers = {}) {
  const query = civilizationScenarioComparisonQuerySchema.parse(input);
  const corpusCoverage = readUnga81CoverageLedger();
  const selectedCountryIso3s = [query.firstCountryIso3, query.secondCountryIso3];
  const pair = readUnga81PairEvidence({
    firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
  });
  const issueComparison = readCivilizationIssueComparison({
    firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
    issueId: "regional_connectivity",
  });
  const naturalSystemIssueComparison = readCivilizationIssueComparison({
    firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
    issueId: "natural_system_cooperation",
  });
  const humanitarianIssueComparison = readCivilizationIssueComparison({
    firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
    issueId: "humanitarian_cooperation",
  });
  const armAzePilot = [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "ARM:AZE";
  const sharedConnectivityTopics = armAzePilot ? [] : issueComparison.facets.filter((facet) =>
    facet.id !== "access_sovereignty_topic" &&
    (facet.comparisonBasis === "parallel_reviewed_topic_inventory" ||
      facet.comparisonBasis === "pair_specific_editorial_crosswalk") &&
    [query.firstCountryIso3, query.secondCountryIso3].every((countryIso3) =>
      facet.positions.some((position) => position.countryIso3 === countryIso3)))
    .sort((left, right) => Number(right.comparisonBasis === "pair_specific_editorial_crosswalk") -
      Number(left.comparisonBasis === "pair_specific_editorial_crosswalk"));
  const sharedParallelTopic = sharedConnectivityTopics[0];
  const accessJurisdictionFacet = issueComparison.facets.find((facet) =>
    facet.id === "access_sovereignty_topic" && facet.comparisonBasis === "pair_specific_editorial_crosswalk" &&
    [query.firstCountryIso3, query.secondCountryIso3].every((countryIso3) =>
      facet.positions.some((position) => position.countryIso3 === countryIso3)));
  const sharedNaturalTopics = naturalSystemIssueComparison.facets.filter((facet) =>
    (facet.comparisonBasis === "parallel_reviewed_topic_inventory" && facet.id !== "disaster_response_topic" ||
      facet.id === "disaster_response_topic" && facet.comparisonBasis === "pair_specific_editorial_crosswalk") &&
    [query.firstCountryIso3, query.secondCountryIso3].every((countryIso3) =>
      facet.positions.some((position) => position.countryIso3 === countryIso3)))
    .sort((left, right) => Number(right.comparisonBasis === "pair_specific_editorial_crosswalk") -
      Number(left.comparisonBasis === "pair_specific_editorial_crosswalk"));
  const datedOperatingReports = issueComparison.datedOperatingReports;
  const [tradeResult, corridorResult] = await Promise.all([
    Promise.resolve().then(() => (readers.tradeReader ?? readComtradePair)({
      firstCountryIso3: query.firstCountryIso3,
      secondCountryIso3: query.secondCountryIso3,
      year: query.tradeYear,
    })).then((evidence) => ({ status: "available" as const, evidence }),
      (error) => ({ status: "unavailable" as const, reason: error instanceof Error ? error.message : "trade_source_unavailable" })),
    query.corridor
      ? Promise.resolve().then(() => (readers.corridorReader ?? readDiplomaticCorridorPacket)(query.corridor))
        .then((evidence) => ({ status: "available" as const, evidence }),
          (error) => ({ status: "unavailable" as const, reason: error instanceof Error ? error.message : "corridor_source_unavailable" }))
      : Promise.resolve({ status: "not_requested" as const }),
  ]);
  const corridorScalePlan = query.corridorScaleSketch
    ? { status: "planned" as const, plan: planCivilizationCorridorScaleEvidence(query.corridorScaleSketch) }
    : { status: "not_requested" as const };
  const governmentRecords = pair.bilateralEvidence.records;
  const dependentGovernmentRecords = pair.dependentGovernmentEvidence.records;
  const multilateralGovernmentRecords = pair.multilateralGovernmentEvidence.records;
  const presentInteractionRecords = [...governmentRecords, ...multilateralGovernmentRecords].filter((record) =>
    record.legalStatus === "declaration_only" || record.legalStatus === "meeting_report_only");
  const recordConditions = (record: typeof governmentRecords[number]) => ({
    recordId: record.id, parties: record.parties, legalStatus: record.legalStatus,
    statusAsOf: record.statusAsOf,
    sourceUrl: record.sourceUrl, conditions: record.conditions,
    reportedMeasures: record.reportedMeasures ?? [],
    plannedJointVenture: record.plannedJointVenture ?? null,
    thirdPartyDependencies: record.thirdPartyDependencies,
  });
  const futureConditionContext = {
    callerRequiredSafeguards: [
      "Respect sovereignty and jurisdiction of every affected state.",
      "Document transit, land, and construction permissions before treating a route as eligible.",
      "Obtain consent from affected third parties.",
      "Complete environmental and community review before project approval.",
    ],
    bilateralGovernmentContext: governmentRecords.map(recordConditions),
    multilateralGovernmentContext: multilateralGovernmentRecords.map(recordConditions),
    contingentFrameworks: dependentGovernmentRecords.map((record) => ({
      ...recordConditions(record), applicability: "only_if_project_uses_this_framework" as const,
    })),
    callerAdditionalConditions: query.constraints.additionalConditions,
  };
  const presentConditionContext = {
    callerRequiredSafeguards: [], bilateralGovernmentContext: [], multilateralGovernmentContext: [],
    contingentFrameworks: [], callerAdditionalConditions: [],
  };
  const objectiveReadiness = (domain: z.infer<typeof comparisonDomainSchema>, mappedDistanceKm: number | null) =>
    query.objectives.map((objective) => {
      const observed = domain === "dated_observation";
      const outsideScope = domain === "peace_process_policy" &&
          objective !== "resilience" && objective !== "mutual_benefit" ||
        objective === "mapped_length" && domain !== "connectivity_infrastructure" ||
        objective === "trade_access" && (domain === "humanitarian_policy" || domain === "natural_system_policy");
      return {
        objective,
        status: observed ? "not_applicable_to_observation" as const
          : outsideScope ? "not_applicable_to_option" as const
          : objective === "mapped_length" && mappedDistanceKm != null ? "bounded_mapped_length_only" as const
          : "not_quantified" as const,
        value: !observed && !outsideScope && objective === "mapped_length" ? mappedDistanceKm : null,
        unit: !observed && !outsideScope && objective === "mapped_length" && mappedDistanceKm != null ? "km" as const : null,
      };
    });
  const measuredDirections = tradeResult.status === "available"
    ? tradeResult.evidence.directions.filter((direction) => direction.status === "available") : [];
  const noSourceScreen = {
    mappedInfrastructure: { status: "not_applicable_no_route" as const, networkKinds: [], mappedSegmentCount: null,
      mappedWays: [], networkTransitionCount: 0, networkTransitions: [], networkTransitionsOmitted: false,
      pipelineTagReview: { status: "not_applicable" as const, wayCount: 0, untaggedWayCount: 0,
        distinctSubstanceTags: [], ways: [], waysOmitted: false,
        productCompatibility: "unverified" as const, flowDirection: "unverified" as const },
      sketchContacts: [], possiblyTruncated: false, sourceSnapshotAt: null, fetchedAt: null, sourceUrls: [] },
    thirdCountryPolygonContacts: { status: "not_applicable_no_route" as const,
      countries: [], indeterminateFeatureIds: [], bboxCandidatesRejected: [],
      sourceUrl: null, possiblyTruncated: false, antimeridianReviewNeeded: false },
    thirdCountryDepictionCandidates: { status: "not_applicable_no_route" as const,
      countries: [], sourceUrl: null, sourceArchiveSha256: null, antimeridianReviewNeeded: false },
    thirdCountryEditorialHints: { status: "not_applicable_no_route" as const,
      countryIso3s: [], sourceUrls: [], possiblyTruncated: false },
    administrativeDepictionContacts: { status: "not_applicable_no_route" as const, countries: [] },
    claimReferenceLineContacts: { status: "not_applicable_no_route" as const,
      contactCount: null, possiblyTruncated: false, categories: [], sourceUrls: [] },
    generalizedWaterwayContacts: { status: "not_applicable_no_route" as const, contactCount: null,
      possiblyTruncated: false, contacts: [], sourceUrls: [] },
    generalizedLakeContacts: { status: "not_applicable_no_route" as const, contactCount: null,
      possiblyTruncated: false, contacts: [], sourceUrls: [] },
    terrestrialDepictions: { status: "not_applicable_no_route" as const, contactCount: null,
      possiblyTruncated: false, contacts: [], sourceSnapshotAt: null, fetchedAt: null,
      sourceUrls: [], missingEvidence: ["no_corridor_geometry_for_terrestrial_screen"] },
    reliefModel: { status: "not_applicable_no_route" as const, sampleCount: null,
      sourceModel: null, samples: [], missingEvidence: ["no_corridor_geometry_to_sample"], sourceUrls: [] },
    designatedWetlandBoundary: null,
    liveRamsarReview: null,
    environmentalImpact: "not_applicable_no_route" as const,
    communityEffects: "not_applicable_no_route" as const,
  };
  const options: z.infer<typeof optionSchema>[] = [];
  const reportedAccessAssertions = (armAzePilot ? issueComparison.facets : []).flatMap((facet) => facet.positions)
    .filter((position) => position.id === "aze-transit-and-trade" && position.countryIso3 === "AZE" ||
      position.id === "arm-reported-rail-via-georgia" && position.countryIso3 === "ARM")
    .filter((position, index, positions) => positions.findIndex((candidate) => candidate.id === position.id) === index);
  const reportedRailViaGeorgia = reportedAccessAssertions.find((position) =>
    position.id === "arm-reported-rail-via-georgia" && position.countryIso3 === "ARM");
  const transitGovernmentRecords = [...governmentRecords, ...multilateralGovernmentRecords]
    .filter((record) => record.id === "arm-aze-2026-ministers-new-york" ||
      record.id === "arm-aze-usa-2026-anniversary-joint-statement");
  const policyReviewForTopic = (topic: typeof sharedConnectivityTopics[number]) => ({
    subject: topic.contrast.directTensionStatus === "reciprocal_security_allegations_unadjudicated"
      ? "peace_process_implementation_review" as const : "parallel_topic_dialogue" as const,
    question: topic.contrast.directTensionStatus === "reciprocal_security_allegations_unadjudicated"
      ? "Would the DRC and Rwanda each identify current, independently verifiable implementation questions under the named diplomatic processes, with civilian safeguards, before considering any specific trade or infrastructure option?"
      : `Would ${query.firstCountryIso3} and ${query.secondCountryIso3} each consider a specific, mutually reviewable ${topic.label.toLowerCase()} proposal?`,
    submittedAssertionIds: topic.positions.map((position) => position.id), governmentRecordIds: [],
    evidenceStatus: topic.contrast.directTensionStatus === "reciprocal_security_allegations_unadjudicated"
      ? "reciprocal_security_claims_process_implementation_unverified" as const
      : "parallel_topics_no_bilateral_terms" as const,
    noConstructionAssumed: true as const,
    interpretation: topic.contrast.directTensionStatus === "reciprocal_security_allegations_unadjudicated"
      ? "Both submitted statements describe serious security concerns and refer to diplomacy, but their allegations are unadjudicated and no common implementation terms or civilian safeguards are verified. This policy question does not condition or approve a route."
      : topic.comparisonBasis === "pair_specific_editorial_crosswalk"
      ? `${topic.contrast.differenceInSubmittedClaims ?? topic.interpretation} No mutually specified policy change, current operating baseline, agreed terms, or reciprocal outcome is established.`
      : "Each selected speaker independently addressed a broad topic. No bilateral proposal, counterpart response, current operating baseline, agreed terms, or reciprocal outcome is established.",
  });
  const policyDomainForTopic = (topic: typeof sharedConnectivityTopics[number]) =>
    topic.contrast.directTensionStatus === "reciprocal_security_allegations_unadjudicated"
      ? "peace_process_policy" as const : "connectivity_policy" as const;
  const topicEvidenceGaps = (topic: typeof sharedConnectivityTopics[number]) =>
    policyDomainForTopic(topic) === "peace_process_policy" ? [
      "reciprocal_security_allegations_and_process_implementation_unverified",
      "both_governments_step_specific_positions_missing",
      "primary_process_instruments_and_independent_monitoring_missing",
      "civilian_protection_displacement_and_local_priorities_unassessed",
      "peace_policy_outcomes_not_quantified",
    ] : [
      "parallel_topic_not_bilateral_proposal",
      "both_governments_option_specific_positions_missing",
      "concrete_policy_scope_and_current_baseline_missing",
      "affected_party_effects_and_permissions_unassessed",
      "no_build_option_outcomes_not_quantified",
    ];
  options.push({
    id: "no_build_policy_review",
    comparisonDomain: sharedParallelTopic ? policyDomainForTopic(sharedParallelTopic) : "connectivity_policy",
    kind: "no_build_policy_review",
    evidenceState: "unquantified_policy_only_option",
    concept: null,
    policyReview: sharedParallelTopic ? policyReviewForTopic(sharedParallelTopic)
      : reportedAccessAssertions.length || transitGovernmentRecords.length ? {
      subject: "existing_transit_and_operating_rules",
      question: "Could independently documented current rail and goods-transit services support mutually agreed operating-rule improvements without new construction?",
      submittedAssertionIds: reportedAccessAssertions.map((position) => position.id),
      governmentRecordIds: transitGovernmentRecords.map((record) => record.id),
      evidenceStatus: "reported_interaction_operating_terms_unverified",
      noConstructionAssumed: true,
      interpretation: "Reported transit interaction does not establish operative rules, capacity, reciprocal benefit, or an agreed policy change.",
    } : null,
    mappedDistanceKm: null,
    sourceUrls: [...new Set([...(sharedParallelTopic?.positions.map((position) => position.sourceUrl) ?? []),
      ...reportedAccessAssertions.map((position) => position.sourceUrl),
      ...datedOperatingReports.flatMap((report) => [report.sourceUrl,
        ...report.corroboratingOperationalSources.map((source) => source.sourceUrl)]),
      ...transitGovernmentRecords.flatMap((record) => [record.sourceUrl,
        ...record.corroboratingSources.map((source) => source.sourceUrl)])])],
    objectiveReadiness: objectiveReadiness(sharedParallelTopic ? policyDomainForTopic(sharedParallelTopic) : "connectivity_policy", null),
    conditionContext: {
      callerRequiredSafeguards: sharedParallelTopic && policyDomainForTopic(sharedParallelTopic) === "peace_process_policy" ? [
        "Treat each security allegation as an attributed claim until independently reviewed; obtain both governments' positions on a defined implementation step.",
        "Consult displaced and conflict-affected people about protection, access, and priorities before assessing any claimed benefit.",
      ] : !armAzePilot ? [
        "Establish an issue and obtain both governments' option-specific positions before treating this as a bilateral proposal.",
        "Define a concrete policy or service change and review its effects on affected communities and third parties.",
      ] : [
        "Any change to transit, customs, or operating rules requires agreement by the competent parties.",
        "Review effects on affected communities and third parties before a policy change is treated as beneficial.",
      ],
      bilateralGovernmentContext: governmentRecords.map(recordConditions),
      multilateralGovernmentContext: multilateralGovernmentRecords.map(recordConditions),
      contingentFrameworks: [], callerAdditionalConditions: query.constraints.additionalConditions,
    },
    sourceScreens: noSourceScreen,
    missingEvidence: !armAzePilot ? sharedParallelTopic ? topicEvidenceGaps(sharedParallelTopic) : [
      "no_reviewed_shared_policy_topic_for_this_pair", "both_governments_option_specific_positions_missing",
      "concrete_policy_scope_and_current_baseline_missing", "affected_party_effects_and_permissions_unassessed",
      "no_build_option_outcomes_not_quantified",
    ] : [
      "current_operating_rules_and_services",
      "policy_change_terms_and_authorized_parties",
      "per_party_and_community_effects_of_policy_only_change",
      "no_build_option_outcomes_not_quantified",
    ],
    eligibility: "not_applicable_no_route",
  });
  for (const topic of sharedConnectivityTopics.slice(1)) {
    options.push({
      ...options[0],
      id: `no_build_topic:${topic.id}`,
      comparisonDomain: policyDomainForTopic(topic),
      policyReview: policyReviewForTopic(topic),
      objectiveReadiness: objectiveReadiness(policyDomainForTopic(topic), null),
      sourceUrls: [...new Set(topic.positions.map((position) => position.sourceUrl))],
      conditionContext: { ...options[0].conditionContext,
        callerRequiredSafeguards: policyDomainForTopic(topic) === "peace_process_policy" ? [
          "Treat each security allegation as an attributed claim until independently reviewed; obtain both governments' positions on a defined implementation step.",
          "Consult displaced and conflict-affected people about protection, access, and priorities before assessing any claimed benefit.",
        ] : options[0].conditionContext.callerRequiredSafeguards },
      missingEvidence: topicEvidenceGaps(topic),
    });
  }
  const projectScopeProjectIds = [...new Set(issueComparison.datedProjectMilestones
    .filter((milestone) => issueComparison.reviewedPositionProjectLinks.some((link) =>
      link.milestoneId === milestone.id)).map((milestone) => milestone.projectId))];
  for (const projectId of projectScopeProjectIds) {
    const milestones = issueComparison.datedProjectMilestones.filter((item) => item.projectId === projectId);
    const milestone = [...milestones].sort((left, right) => right.sourceDate.localeCompare(left.sourceDate))[0];
    const milestoneIds = new Set(milestones.map((item) => item.id));
    const links = issueComparison.reviewedPositionProjectLinks.filter((link) => milestoneIds.has(link.milestoneId));
    if (!milestone || !links.length) continue;
    options.push({
      ...options[0], id: `no_build_project_scope:${projectId}`,
      policyReview: {
        subject: "one_sided_project_scope_dialogue",
        question: milestone.reviewQuestion,
        submittedAssertionIds: [...new Set(links.map((link) => link.assertionId))], governmentRecordIds: [],
        evidenceStatus: "one_sided_position_with_dated_project_source",
        noConstructionAssumed: true,
        interpretation: "A selected submitted statement and separately dated project sources concern the same named project. Their connection does not establish that the financed or announced scope meets the submitted claim, that both governments agree to that scope, or that a policy change is beneficial.",
      },
      sourceUrls: [...new Set([...links.map((link) => link.assertionSourceUrl),
        ...milestones.map((item) => item.sourceUrl)])],
      missingEvidence: ["submitted_position_and_dated_project_records_not_joint_policy_proposal",
        "specific_project_scope_terms_and_affected_party_positions_missing", "project_operating_finance_and_distributional_baseline_missing",
        "affected_party_effects_and_permissions_unassessed", "no_build_option_outcomes_not_quantified"],
    });
  }
  if (accessJurisdictionFacet) options.push({
    id: "access_jurisdiction_dialogue",
    comparisonDomain: "connectivity_policy",
    kind: "no_build_policy_review",
    evidenceState: "unquantified_policy_only_option",
    concept: null,
    policyReview: {
      subject: "access_and_jurisdiction_dialogue",
      question: "Would the competent authorities separately consider discussing any mutually acceptable access arrangement, and under which jurisdiction, rights, and affected-party safeguards?",
      submittedAssertionIds: accessJurisdictionFacet.positions.map((position) => position.id),
      governmentRecordIds: [], evidenceStatus: "distinct_submitted_positions_no_common_proposal",
      noConstructionAssumed: true,
      interpretation: "One submitted statement expresses an access aspiration; the other states a general sovereignty and dialogue principle. Neither identifies the other as a counterpart in these passages or defines a common route, offer, response, or legal finding.",
    },
    mappedDistanceKm: null,
    sourceUrls: [...new Set(accessJurisdictionFacet.positions.map((position) => position.sourceUrl))],
    objectiveReadiness: objectiveReadiness("connectivity_policy", null),
    conditionContext: {
      callerRequiredSafeguards: [
        "Obtain each competent government's current, option-specific position before treating these separate statements as a negotiation.",
        "Identify any proposed corridor, jurisdiction, port or transit authority, third parties, and affected communities before estimating effects or seeking consent.",
      ],
      bilateralGovernmentContext: [], multilateralGovernmentContext: [], contingentFrameworks: [],
      callerAdditionalConditions: query.constraints.additionalConditions,
    },
    sourceScreens: noSourceScreen,
    missingEvidence: ["specific_access_proposal_and_counterpart_response_missing",
      "applicable_jurisdiction_and_transit_rights_unverified",
      "route_service_and_port_baseline_undefined", "third_party_and_community_effects_unassessed",
      "per_party_outcomes_not_quantified"],
    eligibility: "not_applicable_no_route",
  });
  for (const sharedNaturalTopic of sharedNaturalTopics) {
    const sharedClimateTopic = sharedNaturalTopic.id === "climate_resilience_topic";
    const sharedDisasterTopic = sharedNaturalTopic.id === "disaster_response_topic";
    options.push({
    id: `natural_topic:${sharedNaturalTopic.id}`,
    comparisonDomain: "natural_system_policy",
    kind: "no_build_policy_review",
    evidenceState: "unquantified_policy_only_option",
    concept: null,
    policyReview: {
      subject: sharedDisasterTopic ? "parallel_disaster_dialogue"
        : sharedClimateTopic ? "parallel_climate_dialogue" : "parallel_natural_system_dialogue",
      question: sharedDisasterTopic
        ? `Would ${query.firstCountryIso3} and ${query.secondCountryIso3} consider a defined disaster early-warning or recovery coordination question after verifying the described past assistance?`
        : sharedClimateTopic
        ? `Would ${query.firstCountryIso3} and ${query.secondCountryIso3} each consider a defined, mutually reviewable climate resilience or ecosystem question?`
        : `Would ${query.firstCountryIso3} and ${query.secondCountryIso3} each consider a specific, mutually reviewable water or ecosystem question?`,
      submittedAssertionIds: sharedNaturalTopic.positions.map((position) => position.id),
      governmentRecordIds: [],
      evidenceStatus: "parallel_topics_no_bilateral_terms",
      noConstructionAssumed: true,
      interpretation: sharedDisasterTopic
        ? "Both selected speakers described a past disaster response or early-warning interest. The aid reports are not independently verified, and no continuing service, agreed mechanism, data-sharing terms, or reciprocal outcome is established."
        : sharedClimateTopic
        ? "Both selected speakers independently discussed climate or ecosystem priorities. No bilateral climate proposal, shared project, finance terms, compatible baseline, or reciprocal outcome is established."
        : "Both selected speakers independently discussed natural systems. No shared basin, bilateral proposal, water allocation, current condition, or reciprocal outcome is established.",
    },
    mappedDistanceKm: null,
    sourceUrls: [...new Set(sharedNaturalTopic.positions.map((position) => position.sourceUrl))],
    objectiveReadiness: objectiveReadiness("natural_system_policy", null),
    conditionContext: {
      callerRequiredSafeguards: [
        sharedDisasterTopic
          ? "Verify dated assistance and define the precise warning, data-sharing, or recovery question with competent disaster-risk authorities."
          : sharedClimateTopic
          ? "Define a specific climate or ecosystem question, each party's role and baseline, and any proposed finance or technology terms."
          : "Identify a specific shared basin or ecosystem and its competent authorities before defining a joint policy question.",
        naturalSystemIssueComparison.namedNaturalSystemReview.status === "different_named_references"
          ? "The selected speeches name different natural systems; establish whether a specific shared system or other common policy question exists before treating these topics as a joint project."
          : "A matching or missing natural-system name in selected speeches does not establish a shared project area or affected parties.",
        "Obtain current observations, applicable rights, and affected-community perspectives before estimating effects.",
      ],
      bilateralGovernmentContext: [], multilateralGovernmentContext: [], contingentFrameworks: [],
      callerAdditionalConditions: query.constraints.additionalConditions,
    },
    sourceScreens: noSourceScreen,
    missingEvidence: [sharedDisasterTopic ? "specific_disaster_coordination_question_not_defined"
      : sharedClimateTopic ? "specific_climate_or_ecosystem_question_not_defined" : "shared_basin_or_ecosystem_not_identified",
      ...(naturalSystemIssueComparison.namedNaturalSystemReview.status === "different_named_references"
        ? ["selected_named_natural_systems_differ_shared_system_unverified"] : []),
      sharedDisasterTopic ? "counterpart_acceptance_of_early_warning_proposal_not_established"
        : "bilateral_natural_system_proposal_not_established",
      sharedDisasterTopic ? "assistance_delivery_and_warning_baselines_unverified"
        : sharedClimateTopic ? "comparable_climate_and_ecological_baselines_missing" : "current_hydrological_and_ecological_baseline_missing",
      "applicable_rights_and_competent_authorities_unverified",
      "affected_community_and_ecosystem_effects_unassessed", "per_party_outcomes_not_quantified"],
    eligibility: "not_applicable_no_route",
  });
  }
  for (const spec of reviewedNaturalPolicyProposalSpecs) {
    if (query.firstCountryIso3 !== spec.originatingCountryIso3 && query.secondCountryIso3 !== spec.originatingCountryIso3) continue;
    const position = naturalSystemIssueComparison.facets.flatMap((facet) => facet.positions)
      .find((item) => item.id === spec.assertionId && item.countryIso3 === spec.originatingCountryIso3 &&
        item.claimType === "stated_funding_proposal");
    if (!position || !naturalSystemIssueComparison.namedNaturalSystemReview.references.some((reference) =>
      reference.assertionId === position.id && reference.systemId === spec.namedSystemId &&
      reference.sourceUrl === position.sourceUrl)) continue;
    const counterpartIso3 = query.firstCountryIso3 === spec.originatingCountryIso3
      ? query.secondCountryIso3 : query.firstCountryIso3;
    options.push({
      id: spec.optionId,
      comparisonDomain: "natural_system_policy", kind: "no_build_policy_review",
      evidenceState: "unquantified_policy_only_option", concept: null,
      policyReview: {
        subject: "one_sided_named_natural_system_proposal",
        question: `Would ${counterpartIso3} wish to assess whether it has any relevant role in the proposed ${spec.label}, and under what independently reviewed terms?`,
        submittedAssertionIds: [position.id], governmentRecordIds: [],
        evidenceStatus: "one_sided_submitted_proposal_counterpart_unassessed",
        noConstructionAssumed: true,
        interpretation: `${spec.scope}. The submitted assertion does not establish a functioning fund, accepted counterpart role, financing, or ecological effect.`,
      },
      mappedDistanceKm: null, sourceUrls: [position.sourceUrl],
      objectiveReadiness: objectiveReadiness("natural_system_policy", null),
      conditionContext: {
        callerRequiredSafeguards: [
          "Verify the fund's current legal and operating status, competent authorities, financing terms, and any actual commitments.",
          `Ask ${counterpartIso3} whether it has a relevant role or interest; its selected statement does not establish participation or opposition.`,
          "Obtain current lake observations, local community priorities, applicable rights, and an independent ecological baseline before estimating outcomes.",
        ],
        bilateralGovernmentContext: [], multilateralGovernmentContext: [], contingentFrameworks: [],
        callerAdditionalConditions: query.constraints.additionalConditions,
      },
      sourceScreens: noSourceScreen,
      missingEvidence: ["fund_current_status_and_terms_unverified", "counterpart_role_interest_and_position_unassessed",
        "lake_baseline_and_affected_community_priorities_missing", "financing_and_per_party_effects_not_measured"],
      eligibility: "not_applicable_no_route",
    });
  }
  const humanitarianPositions = humanitarianIssueComparison.facets
    .filter((facet) => facet.id === "missing_persons" || facet.id === "landmine_safety_concern")
    .flatMap((facet) => facet.positions)
    .filter((position, index, positions) => positions.findIndex((candidate) => candidate.id === position.id) === index);
  const humanitarianAgreement = governmentRecords.find((record) => record.id === "arm-aze-2025-initialed-peace-text" &&
    record.sourceSections.includes("Article IX"));
  if (humanitarianPositions.some((position) => position.countryIso3 === query.firstCountryIso3) &&
      humanitarianPositions.some((position) => position.countryIso3 === query.secondCountryIso3) && humanitarianAgreement) {
    options.push({
      id: "humanitarian_cooperation_review",
      comparisonDomain: "humanitarian_policy",
      kind: "no_build_policy_review",
      evidenceState: "unquantified_policy_only_option",
      concept: null,
      policyReview: {
        subject: "missing_persons_and_mine_action",
        question: "Could the competent parties explore a family-centered missing-persons process and separately scoped mine-action cooperation?",
        submittedAssertionIds: humanitarianPositions.map((position) => position.id),
        governmentRecordIds: [humanitarianAgreement.id],
        evidenceStatus: "initialed_article_ix_separate_modalities_unverified",
        noConstructionAssumed: true,
        interpretation: "Article IX of the published initialed peace text calls for missing-persons modalities in a separate agreement. ICMP's plan and national mine-action reports do not establish that agreement, a verified case inventory, a joint clearance plan, or affected-family consent.",
      },
      mappedDistanceKm: null,
      sourceUrls: [...new Set([...humanitarianPositions.map((position) => position.sourceUrl),
        humanitarianAgreement.sourceUrl, ...humanitarianIssueComparison.humanitarianContext.map((record) => record.sourceUrl),
        ...humanitarianIssueComparison.familyContext.map((record) => record.sourceUrl)])],
      objectiveReadiness: objectiveReadiness("humanitarian_policy", null),
      conditionContext: {
        callerRequiredSafeguards: [
          "Agree on competent authorities, family participation, privacy, and an independently verifiable case process before claiming missing-persons progress.",
          "Consult affected families about this specific option; published accounts and group reports are context, not consent or a representative mandate.",
          "Obtain specialist hazard survey, safety standards, and affected-community input before proposing any demining operation or location.",
        ],
        bilateralGovernmentContext: governmentRecords.map(recordConditions),
        multilateralGovernmentContext: multilateralGovernmentRecords.map(recordConditions),
        contingentFrameworks: [], callerAdditionalConditions: query.constraints.additionalConditions,
      },
      sourceScreens: noSourceScreen,
      missingEvidence: ["joint_humanitarian_mechanism_unverified", "direct_family_option_consultation_not_obtained",
        "mine_hazard_and_clearance_scope_unverified", "community_effects_not_assessed"],
      eligibility: "not_applicable_no_route",
    });
  }
  if (presentInteractionRecords.length || measuredDirections.length || datedOperatingReports.length) {
    options.push({
      id: "documented_dated_interaction",
      comparisonDomain: "dated_observation",
      kind: "documented_dated_interaction",
      evidenceState: "partial_government_or_trade_sources",
      concept: null,
      policyReview: null,
      mappedDistanceKm: null,
      sourceUrls: [...new Set([...presentInteractionRecords.flatMap((record) => [record.sourceUrl, ...record.corroboratingSources.map((source) => source.sourceUrl)]),
        ...datedOperatingReports.flatMap((report) => [report.sourceUrl,
          ...report.corroboratingOperationalSources.map((source) => source.sourceUrl)]),
        ...measuredDirections.flatMap((direction) => direction.sourceUrl ? [direction.sourceUrl] : [])])],
      objectiveReadiness: objectiveReadiness("dated_observation", null),
      conditionContext: presentConditionContext,
      sourceScreens: noSourceScreen,
      missingEvidence: ["current_operating_terms_and_capacity", "independent_current_trade_and_transit_verification", "government_and_statistical_sources_have_distinct_dates_and_scopes"],
      eligibility: "not_applicable_no_route",
    });
  }
  const conceptSpecs = [
    { family: "rail_restoration" as const, assertionId: "arm-rail-sections" },
    { family: "road_link" as const, assertionId: "arm-pipelines-power-roads" },
    { family: "pipeline_link" as const, assertionId: "arm-pipelines-power-roads" },
    { family: "electricity_link" as const, assertionId: "arm-pipelines-power-roads" },
  ];
  for (const spec of armAzePilot ? conceptSpecs : []) {
    const position = issueComparison.facets.flatMap((facet) => facet.positions)
      .find((item) => item.id === spec.assertionId && item.countryIso3 === "ARM");
    if (!position) continue;
    const namedCounterpartIso3 = readReviewedCounterpartReferences("ARM", "AZE")
      .some((reference) => reference.id === position.id && reference.sourceUrl === position.sourceUrl &&
        reference.reviewRevision === position.reviewRevision) ? "AZE" : null;
    options.push({
      id: `concept:${spec.family}`,
      comparisonDomain: "connectivity_infrastructure",
      kind: "unlocated_infrastructure_concept",
      evidenceState: "submitted_statement_concept_only",
      policyReview: null,
      concept: {
        family: spec.family, origin: { kind: "reviewed_submitted_assertion",
          countryIso3: position.countryIso3, namedCounterpartIso3, assertionId: position.id,
          claimType: position.claimType, sourceUrl: position.sourceUrl,
          deliveredWordingStatus: "not_reconciled" },
        counterpartSpecificSupport: namedCounterpartIso3
          ? "named_counterpart_one_sided_no_consent" : "not_established_in_selected_assertions",
        alignmentStatus: "not_defined",
        interpretation: "A cited submitted-statement concept is not a jointly agreed, located, permitted, or funded project.",
      },
      mappedDistanceKm: null, sourceUrls: [position.sourceUrl],
      objectiveReadiness: objectiveReadiness("connectivity_infrastructure", null),
      conditionContext: futureConditionContext,
      sourceScreens: noSourceScreen,
      missingEvidence: [
        "specific_project_scope_and_alignment_not_defined",
        "counterpart_position_and_terms_not_established_from_selected_assertions",
        "operating_demand_capacity_finance_and_engineering_not_measured",
        "land_rights_permissions_environmental_and_community_review_not_established",
        ...(spec.family === "rail_restoration" ? ["submitted_and_provisional_rail_endpoint_wording_conflicts"] : []),
      ],
      eligibility: "undetermined",
    });
  }
  for (const namedConcept of readReviewedCounterpartInfrastructureConcepts(query.firstCountryIso3, query.secondCountryIso3)) {
    const position = issueComparison.facets.flatMap((facet) => facet.positions)
      .find((item) => item.id === namedConcept.reference.id && item.countryIso3 === namedConcept.fromIso3 &&
        item.sourceUrl === namedConcept.reference.sourceUrl &&
        item.reviewRevision === namedConcept.reference.reviewRevision);
    if (!position) continue;
    const projectMilestones = issueComparison.datedProjectMilestones
      .filter((milestone) => milestone.relatedSubmittedAssertionIds.includes(position.id));
    const twoGovernmentAnnouncement = projectMilestones.some((milestone) =>
      milestone.eventKind === "government_joint_project_announcement" &&
      milestone.sourceActorKind === "national_government" &&
      milestone.sourceActorCountryIso3 === namedConcept.toIso3);
    options.push({
    id: namedConcept.optionId,
    comparisonDomain: "connectivity_infrastructure",
    kind: "unlocated_infrastructure_concept",
    evidenceState: projectMilestones.length
      ? "submitted_statement_with_dated_government_project_milestone" : "submitted_statement_concept_only",
    policyReview: null,
    concept: {
      family: namedConcept.family,
      origin: { kind: "reviewed_submitted_assertion", countryIso3: namedConcept.fromIso3,
        namedCounterpartIso3: namedConcept.toIso3,
        assertionId: position.id, claimType: position.claimType,
        sourceUrl: position.sourceUrl, deliveredWordingStatus: "not_reconciled" },
      counterpartSpecificSupport: twoGovernmentAnnouncement
        ? "both_governments_reported_project_announcement_no_permissions" : "named_counterpart_one_sided_no_consent",
      alignmentStatus: "not_defined",
      interpretation: namedConcept.family === "pipeline_link"
        ? twoGovernmentAnnouncement
          ? "Government sources on both sides announced a pipeline project; its surveyed alignment, completion, operating terms, permissions, and effects remain unverified."
          : "A submitted report of a named-counterpart pipeline construction launch does not verify its alignment, completion, operating terms, partner agreement, or effects."
        : "A submitted statement describing a named-counterpart railway does not verify its construction status, alignment, operating terms, partner agreement, or effects.",
    },
    mappedDistanceKm: null, sourceUrls: [position.sourceUrl, ...projectMilestones.map((milestone) => milestone.sourceUrl)],
    objectiveReadiness: objectiveReadiness("connectivity_infrastructure", null),
    conditionContext: futureConditionContext,
    sourceScreens: noSourceScreen,
    missingEvidence: [namedConcept.family === "pipeline_link"
      ? "reported_project_launch_corroborated_physical_progress_and_completion_not_verified"
      : "named_railway_project_status_not_independently_verified",
      "alignment_endpoints_and_network_interconnection_not_defined",
      namedConcept.family === "pipeline_link"
        ? twoGovernmentAnnouncement
          ? "pipeline_operating_terms_and_specific_permissions_not_established"
          : "named_counterpart_position_and_pipeline_operating_terms_not_established"
        : "named_counterpart_position_and_rail_operating_terms_not_established",
      "demand_capacity_finance_and_engineering_not_measured",
      "land_rights_permissions_environmental_and_community_review_not_established"],
    eligibility: "undetermined",
    });
  }
  const fiberFramework = dependentGovernmentRecords.find((record) =>
    record.id === "arm-usa-2026-tripp-framework" &&
    record.legalStatus === "entry_into_force_unverified" &&
    record.parties.includes("ARM") && record.parties.includes("USA") &&
    record.sourceSections.includes("Article 1(7)-(8)"));
  if (fiberFramework && [query.firstCountryIso3, query.secondCountryIso3].includes("ARM") &&
      [query.firstCountryIso3, query.secondCountryIso3].includes("AZE")) {
    options.push({
      id: "concept:fiberoptic_link",
      comparisonDomain: "connectivity_infrastructure",
      kind: "unlocated_infrastructure_concept",
      evidenceState: "conditional_government_framework_modality_only",
      policyReview: null,
      concept: {
        family: "fiberoptic_link",
        origin: { kind: "conditional_government_framework", recordId: fiberFramework.id,
          parties: fiberFramework.parties, sourceSections: ["Article 1(7)-(8)"],
          sourceUrl: fiberFramework.sourceUrl, legalStatus: "entry_into_force_unverified",
          statusAsOf: fiberFramework.statusAsOf, projectConfirmation: "not_obtained" },
        counterpartSpecificSupport: "not_established_by_framework",
        alignmentStatus: "not_defined",
        interpretation: "A conditional Armenia–U.S. framework modality does not establish Azerbaijan's agreement or a confirmed, located, permitted, or funded project.",
      },
      mappedDistanceKm: null,
      sourceUrls: [...new Set([fiberFramework.sourceUrl, ...fiberFramework.statusEvidenceUrls])],
      objectiveReadiness: objectiveReadiness("connectivity_infrastructure", null),
      conditionContext: futureConditionContext,
      sourceScreens: noSourceScreen,
      missingEvidence: ["framework_entry_into_force_and_project_designation_unverified",
        "fiberoptic_alignment_and_interconnection_not_defined", "azerbaijan_counterpart_position_not_established",
        "network_demand_capacity_security_and_data_governance_not_measured",
        "land_rights_permissions_environmental_and_community_review_not_established"],
      eligibility: "undetermined",
    });
  }
  if (corridorResult.status === "available") {
    const packet = corridorResult.evidence;
    if (packet.route.status === "available") {
      for (const candidate of packet.route.candidates) {
        const hydrography = packet.route.hydrographyReview;
        const contacts = hydrography.status === "available"
          ? hydrography.encounters.filter((encounter) => encounter.candidateId === candidate.candidateId) : [];
        const lakes = packet.route.lakeReview;
        const lakeContacts = lakes.status === "available"
          ? lakes.contacts.filter((contact) => contact.candidateId === candidate.candidateId) : [];
        const administrativeCountries = packet.countries.map((country) => {
          if (country.status === "unavailable") return {
            countryIso3: country.countryIso3, status: "unavailable" as const,
            contactCount: null, possiblyTruncated: false, sourceUrls: [],
          };
          const review = country.routeGeometryReview;
          const encounters = review.status === "available"
            ? review.encounters.filter((encounter) => encounter.candidateId === candidate.candidateId) : [];
          return {
            countryIso3: country.countryIso3,
            status: review.status === "available" ? "available" as const : "unavailable" as const,
            contactCount: review.status === "available" ? encounters.length : null,
            possiblyTruncated: review.status === "available" ? review.possiblyTruncated : false,
            sourceUrls: [...new Set([country.source.metadataUrl, ...encounters.map((encounter) => encounter.sourceRecordUrl)])],
          };
        });
        const administrativeStatus = !administrativeCountries.length ? "not_selected" as const
          : administrativeCountries.every((country) => country.status === "available") ? "available" as const
            : administrativeCountries.some((country) => country.status === "available") ? "partial" as const : "unavailable" as const;
        const boundaryLines = packet.route.boundaryLineReview;
        const lineContacts = boundaryLines.status === "available"
          ? boundaryLines.encounters.filter((encounter) => encounter.candidateId === candidate.candidateId) : [];
        const lineSourceUrls = boundaryLines.status === "available"
          ? [...new Set([boundaryLines.source.sourceRecordUrl, ...lineContacts.map((contact) => contact.lineSourceRecordUrl)])] : [];
        const thirdCountryIso3s = [...new Set(lineContacts.flatMap((contact) => contact.adjacentAdministrativeIso3)
          .filter((code): code is string => !!code && /^[A-Z]{3}$/.test(code) &&
            code !== query.firstCountryIso3 && code !== query.secondCountryIso3))].sort();
        options.push({
          id: `mapped:${candidate.candidateId}`,
          comparisonDomain: "connectivity_infrastructure",
          kind: "mapped_network_candidate",
          evidenceState: "mapped_topology_only",
          concept: null,
          policyReview: null,
          mappedDistanceKm: candidate.mappedDistanceKm,
          sourceUrls: [...new Set([...candidate.sourceSegments.map((segment) => segment.sourceRecordUrl),
            candidate.countryDepictionCandidates.source.sourceRecordUrl,
            candidate.designatedWetlands.source.url,
            ...(candidate.ramsarAreaReview.status === "available" ? [candidate.ramsarAreaReview.source.requestUrl,
              ...candidate.ramsarAreaReview.sites.map((site) => site.sourceRecordUrl)] : []),
            ...(hydrography.status === "available" ? [hydrography.source.sourceArchiveUrl] : []),
            ...contacts.map((contact) => contact.sourceRecordUrl),
            ...(lakes.status === "available" ? [lakes.source.sourceArchiveUrl] : []),
            ...lakeContacts.map((contact) => contact.sourceRecordUrl),
            ...(candidate.terrestrialDepictions.status === "available" ? [candidate.terrestrialDepictions.source.sourceUrl,
              ...candidate.terrestrialDepictions.contacts.map((contact) => contact.sourceRecordUrl)] : []),
            ...administrativeCountries.flatMap((country) => country.sourceUrls), ...lineSourceUrls])],
          objectiveReadiness: objectiveReadiness("connectivity_infrastructure", candidate.mappedDistanceKm),
          conditionContext: futureConditionContext,
          sourceScreens: {
            mappedInfrastructure: {
              status: "mapped_topology_candidate" as const, networkKinds: candidate.networkKinds,
              mappedSegmentCount: candidate.segmentCount, mappedWays: candidate.sourceSegments,
              networkTransitionCount: candidate.networkTransitionCount, networkTransitions: candidate.networkTransitions,
              networkTransitionsOmitted: candidate.networkTransitionsOmitted,
              pipelineTagReview: candidate.pipelineTagReview,
              sketchContacts: [], possiblyTruncated: candidate.sourceSegmentsOmitted,
              sourceSnapshotAt: packet.route.source.sourceSnapshotAt, fetchedAt: packet.route.source.fetchedAt,
              sourceUrls: candidate.sourceSegments.map((segment) => segment.sourceRecordUrl),
            },
            terrestrialDepictions: {
              status: candidate.terrestrialDepictions.status,
              contactCount: candidate.terrestrialDepictions.status === "available"
                ? candidate.terrestrialDepictions.contacts.length : null,
              possiblyTruncated: candidate.terrestrialDepictions.status === "available"
                ? candidate.terrestrialDepictions.possiblyTruncated : false,
              contacts: candidate.terrestrialDepictions.status === "available"
                ? candidate.terrestrialDepictions.contacts.map(({ sketchSegmentIndex, featureId, featureKind,
                    featureName, geometryRole, relation, position, sourceRecordUrl, sourceEditedAt }) => ({
                    sketchSegmentIndex, featureId, featureKind, featureName, geometryRole, relation, position, sourceRecordUrl, sourceEditedAt,
                  })) : [],
              sourceSnapshotAt: candidate.terrestrialDepictions.status === "available"
                ? candidate.terrestrialDepictions.source.sourceSnapshotAt : null,
              fetchedAt: candidate.terrestrialDepictions.status === "available"
                ? candidate.terrestrialDepictions.source.fetchedAt : null,
              sourceUrls: candidate.terrestrialDepictions.status === "available"
                ? [candidate.terrestrialDepictions.source.sourceUrl,
                  ...candidate.terrestrialDepictions.contacts.map((contact) => contact.sourceRecordUrl)] : [],
              missingEvidence: candidate.terrestrialDepictions.missingEvidence,
            },
            thirdCountryPolygonContacts: {
              status: "source_depiction_geometry_screen",
              countries: candidate.countryGeometryScreen.contacts
                .filter((country) => country.isoA3 !== query.firstCountryIso3 && country.isoA3 !== query.secondCountryIso3)
                .map(({ editorialAdm0A3, isoA3, name, boundaryContactSegments, interiorSegments }) =>
                  ({ editorialAdm0A3, isoA3, name, boundaryContactSegments, interiorSegments })),
              indeterminateFeatureIds: candidate.countryGeometryScreen.indeterminateFeatureIds,
              bboxCandidatesRejected: candidate.countryGeometryScreen.bboxCandidatesRejected,
              sourceUrl: candidate.countryGeometryScreen.sourceRecordUrl,
              possiblyTruncated: candidate.countryGeometryScreen.possiblyTruncated,
              antimeridianReviewNeeded: candidate.countryGeometryScreen.antimeridianReviewNeeded,
            },
            thirdCountryDepictionCandidates: {
              status: "bbox_shortlist_only",
              countries: candidate.countryDepictionCandidates.candidates
                .filter((country) => country.isoA3 !== query.firstCountryIso3 && country.isoA3 !== query.secondCountryIso3)
                .map(({ editorialAdm0A3, isoA3, name, possibleSegmentCount }) =>
                  ({ editorialAdm0A3, isoA3, name, possibleSegmentCount })),
              sourceUrl: candidate.countryDepictionCandidates.source.sourceRecordUrl,
              sourceArchiveSha256: candidate.countryDepictionCandidates.source.sourceArchiveSha256,
              antimeridianReviewNeeded: candidate.countryDepictionCandidates.antimeridianReviewNeeded,
            },
            thirdCountryEditorialHints: {
              status: boundaryLines.status === "available" ? "editorial_line_adjacency_only" : "not_assessed",
              countryIso3s: thirdCountryIso3s, sourceUrls: lineSourceUrls,
              possiblyTruncated: boundaryLines.status === "available" ? boundaryLines.possiblyTruncated : false,
            },
            administrativeDepictionContacts: { status: administrativeStatus, countries: administrativeCountries },
            claimReferenceLineContacts: {
              status: boundaryLines.status === "available" ? "available" : "unavailable",
              contactCount: boundaryLines.status === "available" ? lineContacts.length : null,
              possiblyTruncated: boundaryLines.status === "available" ? boundaryLines.possiblyTruncated : false,
              categories: [...new Set(lineContacts.map((contact) => contact.recordCategory))],
              sourceUrls: lineSourceUrls,
            },
            generalizedWaterwayContacts: {
              status: hydrography.status === "available" ? "available" : "unavailable",
              contactCount: hydrography.status === "available" ? contacts.length : null,
              possiblyTruncated: hydrography.status === "available" ? hydrography.possiblyTruncated : false,
              contacts: contacts.map((contact) => ({
                lineId: contact.hydrographicLineId, label: contact.hydrographicLabel,
                featureKind: contact.hydrographicFeatureKind, contactKind: contact.contactKind,
                alignmentSegmentIndex: contact.routeSegmentIndex, position: contact.position,
                sourceRecordUrl: contact.sourceRecordUrl,
                interpretation: "generalized_cartographic_contact_not_verified_water_crossing_or_effect" as const,
              })),
              sourceUrls: hydrography.status === "available" ? [hydrography.source.sourceArchiveUrl,
                ...contacts.map((contact) => contact.sourceRecordUrl)] : [],
            },
            generalizedLakeContacts: {
              status: lakes.status === "available" ? "available" : "unavailable",
              contactCount: lakes.status === "available" ? lakeContacts.length : null,
              possiblyTruncated: lakes.status === "available" ? lakes.possiblyTruncated : false,
              contacts: lakeContacts.map((contact) => ({
                lakeFeatureId: contact.lakeFeatureId, label: contact.lakeLabel,
                contactKind: contact.contactKind, alignmentSegmentIndex: contact.segmentIndex,
                position: contact.position, sourceRecordUrl: contact.sourceRecordUrl,
                routeEvidenceRefs: contact.routeEvidenceRefs,
                interpretation: contact.interpretation,
              })),
              sourceUrls: lakes.status === "available" ? [lakes.source.sourceArchiveUrl,
                ...lakeContacts.map((contact) => contact.sourceRecordUrl)] : [],
            },
            reliefModel: { status: "not_requested", sampleCount: null,
              sourceModel: null, samples: [], missingEvidence: ["relief_observations_not_requested_for_mapped_alignment"], sourceUrls: [] },
            designatedWetlandBoundary: {
              sites: candidate.designatedWetlands.sites.map(({ siteNumber, countryIso3, name,
                boundaryStatus, relation, alignmentSegmentIndices }) => ({
                siteNumber, countryIso3, name, boundaryStatus, relation, alignmentSegmentIndices,
              })),
              sourceUrl: candidate.designatedWetlands.source.url,
              acquiredAt: candidate.designatedWetlands.source.acquiredAt,
            },
            liveRamsarReview: candidate.ramsarAreaReview,
            environmentalImpact: "not_assessed", communityEffects: "not_assessed",
          },
          missingEvidence: [...candidate.missingEvidence, ...packet.unresolved,
            ...(candidate.sourceSegmentsOmitted ? ["additional_route_source_segments_omitted_from_packet"] : []),
            ...(administrativeStatus === "available" ? [] : ["selected_administrative_depiction_contact_review_incomplete"]),
            ...(boundaryLines.status === "available" ? [] : ["claim_reference_line_contact_review_incomplete"]),
            "independent_detailed_third_country_polygon_review_missing",
            "complete_third_country_crossing_inventory_missing",
            "documented_crossing_and_construction_permissions", "continuous_environmental_impact_review"],
          eligibility: "undetermined",
        });
      }
    }
    const sketchSections = [
      ...(packet.proposedCorridor.status === "available" ? [{
        kind: "caller_supplied_sketch" as const, screen: packet.proposedCorridor.screen,
        optionId: "caller_supplied_sketch",
        sourceUrls: [] as string[], missingEvidence: [] as string[],
      }] : []),
      ...packet.mappedGapScreens.flatMap((gap, index) => gap.status === "available" ? [{
        kind: "mapped_component_gap_hypothesis" as const, screen: gap.screen,
        optionId: `mapped_gap:${index + 1}:${gap.hypothesis.networkKind}:${gap.hypothesis.fromNodeRef}:${gap.hypothesis.toNodeRef}`,
        sourceUrls: [gap.hypothesis.fromSourceRecordUrl, gap.hypothesis.toSourceRecordUrl],
        missingEvidence: gap.hypothesis.missingEvidence,
      }] : []),
    ];
    for (const sketch of sketchSections) {
      const screen = sketch.screen;
      const hydrography = screen.hydrography;
      const lakes = screen.lakeReview;
      const relief = screen.globalReliefPoints;
      const administrativeCountries = screen.administrativeBoundaries.map((country) => country.status === "available"
        ? {
          countryIso3: country.countryIso3, status: "available" as const,
          contactCount: country.contacts.length, possiblyTruncated: country.possiblyTruncated,
          sourceUrls: [...new Set([country.source.metadataUrl, ...country.contacts.map((contact) => contact.sourceRecordUrl)])],
        } : {
          countryIso3: country.countryIso3, status: "unavailable" as const,
          contactCount: null, possiblyTruncated: false, sourceUrls: [],
        });
      const administrativeStatus = !administrativeCountries.length ? "not_selected" as const
        : administrativeCountries.every((country) => country.status === "available") ? "available" as const
          : administrativeCountries.some((country) => country.status === "available") ? "partial" as const : "unavailable" as const;
      const boundaryLines = screen.boundaryLines;
      const lineContacts = boundaryLines.status === "available" ? boundaryLines.contacts : [];
      const lineSourceUrls = boundaryLines.status === "available"
        ? [...new Set([boundaryLines.source.sourceRecordUrl, ...lineContacts.map((contact) => contact.sourceRecordUrl)])] : [];
      const thirdCountryIso3s = [...new Set(lineContacts.flatMap((contact) => contact.adjacentAdministrativeIso3)
        .filter((code): code is string => !!code && /^[A-Z]{3}$/.test(code) &&
          code !== query.firstCountryIso3 && code !== query.secondCountryIso3))].sort();
      options.push({
        id: sketch.optionId,
        comparisonDomain: "connectivity_infrastructure",
        kind: sketch.kind,
        evidenceState: sketch.kind === "caller_supplied_sketch" ? "source_screened_sketch" : "source_screened_gap_hypothesis",
        concept: null,
        policyReview: null,
        mappedDistanceKm: null,
        sourceUrls: [...new Set([...governmentRecords.flatMap((record) => [record.sourceUrl, ...record.corroboratingSources.map((source) => source.sourceUrl)]),
          screen.countryDepictionCandidates.source.sourceRecordUrl,
          ...sketch.sourceUrls,
          screen.designatedWetlands.source.url,
          ...(screen.ramsarAreaReview.status === "available" ? [screen.ramsarAreaReview.source.requestUrl,
            ...screen.ramsarAreaReview.sites.map((site) => site.sourceRecordUrl)] : []),
          ...(hydrography.status === "available" ? [hydrography.source.sourceArchiveUrl,
            ...hydrography.contacts.map((contact) => contact.sourceRecordUrl)] : []),
          ...(lakes.status === "available" ? [lakes.source.sourceArchiveUrl,
            ...lakes.contacts.map((contact) => contact.sourceRecordUrl)] : []),
          ...(relief.status === "available" ? [relief.source.citationUrl] : []),
          ...(screen.terrestrialDepictions.status === "available" ? [screen.terrestrialDepictions.source.sourceUrl,
            ...screen.terrestrialDepictions.contacts.map((contact) => contact.sourceRecordUrl)] : []),
          ...administrativeCountries.flatMap((country) => country.sourceUrls), ...lineSourceUrls])],
        objectiveReadiness: objectiveReadiness("connectivity_infrastructure", null),
        conditionContext: futureConditionContext,
        sourceScreens: {
          mappedInfrastructure: {
            status: screen.mappedInfrastructure.status === "available" ? "sketch_way_contacts" as const : screen.mappedInfrastructure.status,
            networkKinds: screen.mappedInfrastructure.status === "available"
              ? [...new Set(screen.mappedInfrastructure.contacts.map((contact) => contact.networkKind))] : [],
            mappedSegmentCount: null, mappedWays: [], networkTransitionCount: 0, networkTransitions: [], networkTransitionsOmitted: false,
            pipelineTagReview: { status: "not_applicable" as const, wayCount: 0, untaggedWayCount: 0,
              distinctSubstanceTags: [], ways: [], waysOmitted: false,
              productCompatibility: "unverified" as const, flowDirection: "unverified" as const },
            sketchContacts: screen.mappedInfrastructure.status === "available"
              ? screen.mappedInfrastructure.contacts.map(({ sketchSegmentIndex, edgeId, networkKind, contactKind, position,
                sourceRecordUrl, sourceEditedAt }) => ({ sketchSegmentIndex, edgeId, networkKind, contactKind, position, sourceRecordUrl, sourceEditedAt })) : [],
            possiblyTruncated: screen.mappedInfrastructure.status === "available" ? screen.mappedInfrastructure.possiblyTruncated : false,
            sourceSnapshotAt: screen.mappedInfrastructure.status === "available" ? screen.mappedInfrastructure.source.sourceSnapshotAt : null,
            fetchedAt: screen.mappedInfrastructure.status === "available" ? screen.mappedInfrastructure.source.fetchedAt : null,
            sourceUrls: screen.mappedInfrastructure.status === "available"
              ? screen.mappedInfrastructure.contacts.map((contact) => contact.sourceRecordUrl) : [],
          },
          terrestrialDepictions: {
            status: screen.terrestrialDepictions.status,
            contactCount: screen.terrestrialDepictions.status === "available" ? screen.terrestrialDepictions.contacts.length : null,
            possiblyTruncated: screen.terrestrialDepictions.status === "available" ? screen.terrestrialDepictions.possiblyTruncated : false,
            contacts: screen.terrestrialDepictions.status === "available"
              ? screen.terrestrialDepictions.contacts.map(({ sketchSegmentIndex, featureId, featureKind,
                featureName, geometryRole, relation, position, sourceRecordUrl, sourceEditedAt }) => ({
                sketchSegmentIndex, featureId, featureKind, featureName, geometryRole, relation, position, sourceRecordUrl, sourceEditedAt,
              })) : [],
            sourceSnapshotAt: screen.terrestrialDepictions.status === "available" ? screen.terrestrialDepictions.source.sourceSnapshotAt : null,
            fetchedAt: screen.terrestrialDepictions.status === "available" ? screen.terrestrialDepictions.source.fetchedAt : null,
            sourceUrls: screen.terrestrialDepictions.status === "available" ? [screen.terrestrialDepictions.source.sourceUrl,
              ...screen.terrestrialDepictions.contacts.map((contact) => contact.sourceRecordUrl)] : [],
            missingEvidence: screen.terrestrialDepictions.missingEvidence,
          },
          thirdCountryPolygonContacts: {
            status: "source_depiction_geometry_screen",
            countries: screen.countryGeometryScreen.contacts
              .filter((country) => country.isoA3 !== query.firstCountryIso3 && country.isoA3 !== query.secondCountryIso3)
              .map(({ editorialAdm0A3, isoA3, name, boundaryContactSegments, interiorSegments }) =>
                ({ editorialAdm0A3, isoA3, name, boundaryContactSegments, interiorSegments })),
            indeterminateFeatureIds: screen.countryGeometryScreen.indeterminateFeatureIds,
            bboxCandidatesRejected: screen.countryGeometryScreen.bboxCandidatesRejected,
            sourceUrl: screen.countryGeometryScreen.sourceRecordUrl,
            possiblyTruncated: screen.countryGeometryScreen.possiblyTruncated,
            antimeridianReviewNeeded: screen.countryGeometryScreen.antimeridianReviewNeeded,
          },
          thirdCountryDepictionCandidates: {
            status: "bbox_shortlist_only",
            countries: screen.countryDepictionCandidates.candidates
              .filter((country) => country.isoA3 !== query.firstCountryIso3 && country.isoA3 !== query.secondCountryIso3)
              .map(({ editorialAdm0A3, isoA3, name, possibleSegmentCount }) =>
                ({ editorialAdm0A3, isoA3, name, possibleSegmentCount })),
            sourceUrl: screen.countryDepictionCandidates.source.sourceRecordUrl,
            sourceArchiveSha256: screen.countryDepictionCandidates.source.sourceArchiveSha256,
            antimeridianReviewNeeded: screen.countryDepictionCandidates.antimeridianReviewNeeded,
          },
          thirdCountryEditorialHints: {
            status: boundaryLines.status === "available" ? "editorial_line_adjacency_only" : "not_assessed",
            countryIso3s: thirdCountryIso3s, sourceUrls: lineSourceUrls,
            possiblyTruncated: boundaryLines.status === "available" ? boundaryLines.possiblyTruncated : false,
          },
          administrativeDepictionContacts: { status: administrativeStatus, countries: administrativeCountries },
          claimReferenceLineContacts: {
            status: boundaryLines.status === "available" ? "available" : "unavailable",
            contactCount: boundaryLines.status === "available" ? lineContacts.length : null,
            possiblyTruncated: boundaryLines.status === "available" ? boundaryLines.possiblyTruncated : false,
            categories: [...new Set(lineContacts.map((contact) => contact.recordCategory))],
            sourceUrls: lineSourceUrls,
          },
          generalizedWaterwayContacts: {
            status: hydrography.status === "available" ? "available" : "unavailable",
            contactCount: hydrography.status === "available" ? hydrography.contacts.length : null,
            possiblyTruncated: hydrography.status === "available" ? hydrography.possiblyTruncated : false,
            contacts: hydrography.status === "available" ? hydrography.contacts.map((contact) => ({
              lineId: contact.lineId, label: contact.lineLabel,
              featureKind: contact.featureKind, contactKind: contact.contactKind,
              alignmentSegmentIndex: contact.sketchSegmentIndex, position: contact.position,
              sourceRecordUrl: contact.sourceRecordUrl,
              interpretation: "generalized_cartographic_contact_not_verified_water_crossing_or_effect" as const,
            })) : [],
            sourceUrls: hydrography.status === "available" ? [hydrography.source.sourceArchiveUrl,
              ...hydrography.contacts.map((contact) => contact.sourceRecordUrl)] : [],
          },
          generalizedLakeContacts: {
            status: lakes.status === "available" ? "available" : "unavailable",
            contactCount: lakes.status === "available" ? lakes.contacts.length : null,
            possiblyTruncated: lakes.status === "available" ? lakes.possiblyTruncated : false,
            contacts: lakes.status === "available" ? lakes.contacts.map((contact) => ({
              lakeFeatureId: contact.lakeFeatureId, label: contact.lakeLabel,
              contactKind: contact.contactKind, alignmentSegmentIndex: contact.segmentIndex,
              position: contact.position, sourceRecordUrl: contact.sourceRecordUrl,
              routeEvidenceRefs: contact.routeEvidenceRefs,
              interpretation: contact.interpretation,
            })) : [],
            sourceUrls: lakes.status === "available" ? [lakes.source.sourceArchiveUrl,
              ...lakes.contacts.map((contact) => contact.sourceRecordUrl)] : [],
          },
          reliefModel: {
            status: relief.status === "available" ? "available" : relief.status === "not_requested" ? "not_requested" : "unavailable",
            sampleCount: relief.status === "available" ? relief.observations.filter((observation) => observation.status === "available").length : null,
            sourceModel: relief.status === "available" ? {
              datasetId: relief.source.datasetId, modelVersion: relief.source.modelVersion,
              gridSpacingArcSeconds: relief.source.gridSpacingArcSeconds,
              verticalReference: relief.source.verticalReference,
              surfaceVersion: relief.source.surfaceVersion,
              sourceTimeMeaning: relief.source.sourceTimeMeaning,
            } : null,
            samples: relief.status === "available" ? relief.observations.map((observation) => ({
              sampleIndex: observation.pointIndex,
              sketchSegmentIndex: relief.samplePlan[observation.pointIndex].sketchSegmentIndex,
              segmentFraction: relief.samplePlan[observation.pointIndex].segmentFraction,
              requestedPoint: observation.requestedPoint,
              sampledGridCellCenter: observation.sampledGridCellCenter,
              status: observation.status, heightMeters: observation.heightMeters,
              sourceUrl: observation.sourceUrl, fetchedAt: observation.fetchedAt,
            })) : [],
            missingEvidence: relief.missingEvidence,
            sourceUrls: relief.status === "available" ? [relief.source.citationUrl,
              ...relief.observations.map((observation) => observation.sourceUrl)] : [],
          },
          designatedWetlandBoundary: {
            sites: screen.designatedWetlands.sites.map(({ siteNumber, countryIso3, name,
              boundaryStatus, relation, alignmentSegmentIndices }) => ({
              siteNumber, countryIso3, name, boundaryStatus, relation, alignmentSegmentIndices,
            })),
            sourceUrl: screen.designatedWetlands.source.url,
            acquiredAt: screen.designatedWetlands.source.acquiredAt,
          },
          liveRamsarReview: screen.ramsarAreaReview,
          environmentalImpact: "not_assessed", communityEffects: "not_assessed",
        },
        missingEvidence: [...screen.unresolved, ...sketch.missingEvidence,
          ...(administrativeStatus === "available" ? [] : ["selected_administrative_depiction_contact_review_incomplete"]),
          ...(boundaryLines.status === "available" ? [] : ["claim_reference_line_contact_review_incomplete"]),
          "independent_detailed_third_country_polygon_review_missing",
          "complete_third_country_crossing_inventory_missing",
          "alignment_engineering_and_cost", "documented_land_and_crossing_permissions", "community_and_environmental_impact_review"],
        eligibility: "undetermined",
      });
    }
  }
  const screenedGeometryComparison: z.infer<typeof screenedGeometryComparisonSchema>[] = options
    .filter((option) => ["mapped_network_candidate", "caller_supplied_sketch", "mapped_component_gap_hypothesis"].includes(option.kind))
    .map((option) => {
      const screens = option.sourceScreens;
      const country = screens.thirdCountryPolygonContacts;
      const administrative = screens.administrativeDepictionContacts;
      const wetland = screens.liveRamsarReview;
      const relief = screens.reliefModel;
      const availableHeights = relief.samples.flatMap((sample) => sample.status === "available" && sample.heightMeters !== null
        ? [sample.heightMeters] : []);
      const countScreen = (screen: { status: string; contactCount: number | null;
        possiblyTruncated: boolean; sourceUrls: string[] }): z.infer<typeof screeningCountSchema> => ({
        status: screen.status === "available" ? "available"
          : screen.status === "not_requested" || screen.status === "not_assessed_mapped_route" ? "not_requested"
            : "unavailable",
        observedCount: screen.status === "available" ? screen.contactCount : null,
        possiblyTruncated: screen.possiblyTruncated, sourceUrls: screen.sourceUrls,
      });
      return {
        optionId: option.id,
        kind: option.kind as z.infer<typeof screenedGeometryComparisonSchema>["kind"],
        sourceDepictedCountryContacts: {
          status: country.status === "source_depiction_geometry_screen" ? "available" as const : "unavailable" as const,
          observedCount: country.status === "source_depiction_geometry_screen" ? country.countries.length : null,
          possiblyTruncated: country.possiblyTruncated,
          sourceUrls: country.sourceUrl ? [country.sourceUrl] : [],
        },
        selectedCountryOutlineContacts: {
          status: administrative.status === "available" ? "available" as const
            : administrative.status === "partial" ? "partial" as const
              : administrative.status === "not_selected" ? "not_requested" as const : "unavailable" as const,
          observedCount: administrative.status === "available" || administrative.status === "partial"
            ? administrative.countries.reduce((sum, item) => sum + (item.contactCount ?? 0), 0) : null,
          possiblyTruncated: administrative.countries.some((item) => item.possiblyTruncated),
          sourceUrls: [...new Set(administrative.countries.flatMap((item) => item.sourceUrls))],
        },
        editorialBoundaryLineContacts: countScreen(screens.claimReferenceLineContacts),
        hydrographicLineContacts: countScreen(screens.generalizedWaterwayContacts),
        lakeOutlineContacts: countScreen(screens.generalizedLakeContacts),
        mappedTerrestrialContacts: countScreen(screens.terrestrialDepictions),
        publishedWetlandContacts: wetland?.status === "available" ? {
          status: "available" as const,
          observedCount: wetland.sites.filter((site) => site.relation === "intersects_published_depiction").length,
          possiblyTruncated: wetland.possiblyTruncated,
          sourceUrls: [...new Set([wetland.source.requestUrl, ...wetland.sites.map((site) => site.sourceRecordUrl)])],
        } : { status: wetland ? "unavailable" as const : "not_requested" as const,
          observedCount: null, possiblyTruncated: false, sourceUrls: [] },
        reliefGrid: {
          status: relief.status === "available" ? "available" as const
            : relief.status === "not_requested" ? "not_requested" as const : "unavailable" as const,
          availableCells: relief.status === "available" ? availableHeights.length : null,
          attemptedCells: relief.samples.length,
          sampledMinHeightMeters: availableHeights.length ? Math.min(...availableHeights) : null,
          sampledMaxHeightMeters: availableHeights.length ? Math.max(...availableHeights) : null,
          sourceUrls: relief.sourceUrls,
        },
        serviceAndOutcomeComparability: "not_established" as const,
        interpretation: "Source contacts and sparse relief cells are screening observations with unequal coverage, not comparative impacts, feasibility, costs, permissions, benefits, or an option ranking." as const,
      };
    });
  type OptionInteractionLink = z.infer<typeof civilizationScenarioComparisonOutputSchema>["optionInteractionReview"]["links"][number];
  const optionInteractionLinks: OptionInteractionLink[] = [];
  const policyOption = options.find((option) => option.policyReview?.subject === "existing_transit_and_operating_rules");
  if (policyOption) {
    for (const builtOption of options.filter((option) => option.comparisonDomain === "connectivity_infrastructure")) {
      optionInteractionLinks.push({
        firstOptionId: policyOption.id, secondOptionId: builtOption.id,
        relation: "policy_may_complement_built_service",
        evidenceSourceUrls: [...new Set([...policyOption.sourceUrls, ...builtOption.sourceUrls])],
        conditionsToEvaluate: [
          "Define the same service, access question, and affected parties for both options.",
          "Check whether a mutually accepted operating-rule change would be needed with or without construction.",
        ],
        missingComparableEvidence: ["current_service_and_capacity_baseline", "option_specific_policy_terms",
          "built_option_capacity_cost_and_permissions", "per_party_and_community_outcomes"],
        status: "hypothesis_only_not_established",
        inferenceLimit: "A policy change could precede or accompany a built service, but the cited reports do not establish that either option works or that combining them helps.",
      });
    }
  }
  const railOption = options.find((option) => option.concept?.family === "rail_restoration");
  const roadOption = options.find((option) => option.concept?.family === "road_link");
  if (railOption && roadOption) {
    optionInteractionLinks.push({
      firstOptionId: railOption.id, secondOptionId: roadOption.id,
      relation: "rail_road_possible_substitutes_for_defined_demand",
      evidenceSourceUrls: [...new Set([...railOption.sourceUrls, ...roadOption.sourceUrls])],
      conditionsToEvaluate: [
        "Specify common endpoints, freight or passenger demand, access rights, and the service each mode would deliver.",
        "Compare capacity, total cost, reliability, emissions, and affected-party effects under the same baseline and horizon.",
      ],
      missingComparableEvidence: ["common_endpoint_and_demand_definition", "mode_specific_operating_and_cost_evidence",
        "permissions_and_distributional_effects"],
      status: "hypothesis_only_not_established",
      inferenceLimit: "The two submitted concepts are not proven substitutes; they may serve different cargo, places, or communities.",
    });
  }
  const naturalPolicyOptions = options.filter((option) =>
    option.comparisonDomain === "natural_system_policy" && option.policyReview);
  const locatedInfrastructureOptions = options.filter((option) =>
    option.comparisonDomain === "connectivity_infrastructure" &&
    option.sourceScreens.environmentalImpact !== "not_applicable_no_route");
  for (const naturalOption of naturalPolicyOptions) {
    for (const builtOption of locatedInfrastructureOptions) {
      optionInteractionLinks.push({
        firstOptionId: naturalOption.id, secondOptionId: builtOption.id,
        relation: "natural_topic_may_require_route_specific_review",
        evidenceSourceUrls: [...new Set([...naturalOption.sourceUrls, ...builtOption.sourceUrls])],
        conditionsToEvaluate: [
          "Identify whether the mapped alignment actually involves the water, land, ecosystem, or climate concern in the selected statements.",
          "Obtain route-scale current observations and competent environmental, water, land, and community views before specifying a constraint or adaptation measure.",
          "Compare any proposed change to both governments' stated priorities and affected parties' rights under the same planning horizon.",
        ],
        missingComparableEvidence: ["shared_natural_system_or_hazard_scope", "route_specific_baseline_and_effects",
          "competent_authority_and_affected_community_views", "comparable_adaptation_and_infrastructure_outcomes"],
        status: "hypothesis_only_not_established",
        inferenceLimit: "Parallel natural-system statements and cartographic route contacts do not prove the same system is affected, a legal constraint exists, or either government accepts a route or mitigation plan.",
      });
    }
  }
  const mappedOptions = options.filter((option) => option.kind === "mapped_network_candidate");
  mappedOptions.forEach((firstOption, index) => {
    mappedOptions.slice(index + 1).forEach((secondOption) => optionInteractionLinks.push({
      firstOptionId: firstOption.id, secondOptionId: secondOption.id,
      relation: "mapped_alignments_alternatives_for_same_corridor_question",
      evidenceSourceUrls: [...new Set([...firstOption.sourceUrls, ...secondOption.sourceUrls])],
      conditionsToEvaluate: [
        "Confirm common endpoints and intended service on continuous, current infrastructure or surveyed alignments.",
        "Compare route-specific permissions, third-party effects, natural-system impacts, capacity, and costs.",
      ],
      missingComparableEvidence: ["surveyed_endpoints_and_continuity", "route_specific_operating_capacity_and_cost",
        "legal_environmental_and_community_review"],
      status: "hypothesis_only_not_established",
      inferenceLimit: "OSM topology candidates are map alternatives for one corridor question; shorter mapped length is not a better or feasible route finding.",
    }));
  });
  const gapOptions = options.filter((option) => option.kind === "mapped_component_gap_hypothesis");
  gapOptions.forEach((firstOption, index) => {
    gapOptions.slice(index + 1).forEach((secondOption) => optionInteractionLinks.push({
      firstOptionId: firstOption.id, secondOptionId: secondOption.id,
      relation: "screened_gap_questions_for_same_corridor",
      evidenceSourceUrls: [...new Set([...firstOption.sourceUrls, ...secondOption.sourceUrls])],
      conditionsToEvaluate: [
        "Define the same intended service and determine whether either mapped disconnect represents an actual missing asset.",
        "Compare surveyed alternatives, source coverage, permissions, affected parties, natural effects, capacity, and costs.",
      ],
      missingComparableEvidence: ["complete_current_asset_inventory", "common_service_and_demand_definition",
        "surveyed_alignments_capacity_costs_and_permissions", "affected_party_and_natural_outcomes"],
      status: "hypothesis_only_not_established",
      inferenceLimit: "Different straight gaps and network kinds are not proven substitutes. Shorter distance or fewer source contacts does not establish a better option.",
    }));
  });
  const callerSketchOption = options.find((option) => option.kind === "caller_supplied_sketch");
  if (callerSketchOption) for (const gapOption of gapOptions) optionInteractionLinks.push({
    firstOptionId: callerSketchOption.id, secondOptionId: gapOption.id,
    relation: "caller_sketch_and_gap_question_for_same_corridor",
    evidenceSourceUrls: [...new Set([...callerSketchOption.sourceUrls, ...gapOption.sourceUrls])],
    conditionsToEvaluate: [
      "Check whether the caller's full sketch and the mapped-component link address the same service and endpoints.",
      "Use equivalent source coverage and a common baseline before comparing effects, rights, cost, or benefit.",
    ],
    missingComparableEvidence: ["same_service_and_endpoint_scope", "complete_asset_inventory",
      "equivalent_screening_coverage_and_surveyed_design", "rights_costs_and_distributional_outcomes"],
    status: "hypothesis_only_not_established",
    inferenceLimit: "A component link is only part of a possible network connection; the caller sketch and gap cannot be ranked from these screens.",
  });
  const countryEvidenceCache = new Map<string, ReturnType<typeof readUnga81CountryEvidence>>();
  const observedGoodsExports = (countryIso3: string) => {
    const counterpartIso3 = countryIso3 === query.firstCountryIso3
      ? query.secondCountryIso3 : query.firstCountryIso3;
    const direction = tradeResult.status === "available" ? tradeResult.evidence.directions.find((item) =>
      item.reporterIso3 === countryIso3 && item.partnerIso3 === counterpartIso3) : undefined;
    return {
      counterpartIso3, year: query.tradeYear,
      status: direction?.status ?? "source_unavailable" as const,
      primaryValueUsd: direction?.status === "available" ? direction.primaryValueUsd : null,
      sourceUrl: direction?.sourceUrl ?? null,
      isReported: direction?.isReported ?? null, isAggregate: direction?.isAggregate ?? null,
      interpretation: "Dated all-merchandise exports reported for this direction are baseline context, not an option outcome, benefit estimate, service flow, or measure of cooperation." as const,
    };
  };
  const optionEvidenceLedgers = options.map((option) => {
    const optionOriginAssertionId = option.concept?.origin.kind === "reviewed_submitted_assertion"
      ? option.concept.origin.assertionId : null;
    const projectScopeProjectId = option.id.startsWith("no_build_project_scope:")
      ? option.id.slice("no_build_project_scope:".length) : null;
    const datedProjectMilestones = issueComparison.datedProjectMilestones.filter((milestone) =>
      milestone.projectId === projectScopeProjectId || optionOriginAssertionId != null &&
      milestone.relatedSubmittedAssertionIds.includes(optionOriginAssertionId));
    const observation = option.kind === "documented_dated_interaction";
    const noBuild = option.kind === "no_build_policy_review";
    const existingTransitPolicyReview = option.policyReview?.subject === "existing_transit_and_operating_rules";
    const accessJurisdictionDialogueReview = option.policyReview?.subject === "access_and_jurisdiction_dialogue";
    const humanitarianReview = option.policyReview?.subject === "missing_persons_and_mine_action";
    const parallelTopicReview = option.policyReview?.subject === "parallel_topic_dialogue";
    const peaceProcessReview = option.policyReview?.subject === "peace_process_implementation_review";
    const oneSidedProjectScopeReview = option.policyReview?.subject === "one_sided_project_scope_dialogue";
    const climateTopicReview = option.policyReview?.subject === "parallel_climate_dialogue";
    const disasterTopicReview = option.policyReview?.subject === "parallel_disaster_dialogue";
    const oneSidedNaturalProposalReview = option.policyReview?.subject === "one_sided_named_natural_system_proposal";
    const naturalTopicReview = option.policyReview?.subject === "parallel_natural_system_dialogue" ||
      climateTopicReview || disasterTopicReview || oneSidedNaturalProposalReview;
    const policyScopeUnknown = noBuild && !option.policyReview;
    const unlocatedConcept = option.kind === "unlocated_infrastructure_concept";
    const proposalStatus = observation ? "not_applicable_to_observation" as const : "unverified" as const;
    const governmentSourceUrls = [...new Set([...governmentRecords, ...multilateralGovernmentRecords]
      .flatMap((record) => [record.sourceUrl, ...record.statusEvidenceUrls]))];
    const waterwayScreen = option.sourceScreens.generalizedWaterwayContacts;
    const lakeScreen = option.sourceScreens.generalizedLakeContacts;
    const reviewedStatementWaterwayLinks = [...new Map(waterwayScreen.contacts.flatMap((contact) => {
      const prefix = "hydrography:natural-earth:";
      if (!contact.lineId.startsWith(prefix)) return [];
      const featureId = Number(contact.lineId.slice(prefix.length));
      const systemId = naturalEarthWaterwaySystemIdByFeatureId[featureId];
      if (!systemId) return [];
      return naturalSystemIssueComparison.namedNaturalSystemReview.references
        .filter((reference) => reference.systemId === systemId)
        .map((reference) => ({
          lineId: contact.lineId, lineLabel: contact.label,
          lineSourceRecordUrl: contact.sourceRecordUrl,
          systemId, countryIso3: reference.countryIso3, assertionId: reference.assertionId,
          statementSourceUrl: reference.sourceUrl,
          relation: "same_named_system_editorial_crosswalk_only" as const,
          interpretation: "A reviewed statement and generalized mapped line share a name family; this does not establish the same affected reach, hydrology, rights, project, permission, or measured effect." as const,
        }));
    }).map((link) => [`${link.lineId}:${link.countryIso3}:${link.assertionId}`, link] as const)).values()]
      .slice(0, 150);
    const reviewedStatementLakeLinks = [...new Map(lakeScreen.contacts.flatMap((contact) => {
      const systemId = naturalEarthLakeSystemIdByFeatureId[contact.lakeFeatureId];
      if (!systemId) return [];
      return naturalSystemIssueComparison.namedNaturalSystemReview.references
        .filter((reference) => reference.systemId === systemId)
        .map((reference) => ({
          lakeFeatureId: contact.lakeFeatureId, lakeLabel: contact.label,
          lakeSourceRecordUrl: contact.sourceRecordUrl,
          systemId, countryIso3: reference.countryIso3, assertionId: reference.assertionId,
          statementSourceUrl: reference.sourceUrl,
          relation: "same_named_place_editorial_crosswalk_only" as const,
          interpretation: "A reviewed statement naming this place does not establish a position, permission, project, or measured effect for this option." as const,
        }));
    }).map((link) => [`${link.lakeFeatureId}:${link.countryIso3}:${link.assertionId}`, link] as const)).values()];
    const reliefScreen = option.sourceScreens.reliefModel;
    const terrestrialScreen = option.sourceScreens.terrestrialDepictions;
    const wetlandBoundary = option.sourceScreens.designatedWetlandBoundary;
    const liveRamsarReview = option.sourceScreens.liveRamsarReview;
    const naturalSourceUrls = [...new Set([...waterwayScreen.sourceUrls, ...lakeScreen.sourceUrls,
      ...terrestrialScreen.sourceUrls, ...reliefScreen.sourceUrls,
      ...(wetlandBoundary ? [wetlandBoundary.sourceUrl] : []),
      ...(liveRamsarReview?.status === "available" ? [liveRamsarReview.source.requestUrl,
        ...liveRamsarReview.sites.map((site) => site.sourceRecordUrl)] : [])])];
    const safetyConcern = humanitarianIssueComparison.facets.find((facet) => facet.id === "landmine_safety_concern");
    const safetyConcernUrls = safetyConcern?.positions.map((position) => position.sourceUrl) ?? [];
    const thirdCountryScreen = option.sourceScreens.thirdCountryPolygonContacts;
    const thirdCountrySourceUrls = thirdCountryScreen.sourceUrl ? [thirdCountryScreen.sourceUrl] : [];
    const sourceFrameworkRecordId = option.concept?.origin.kind === "conditional_government_framework"
      ? option.concept.origin.recordId : null;
    const conditionalFrameworkParties = observation || noBuild ? [] : dependentGovernmentRecords.flatMap((record) =>
      record.parties.filter((partyIso3) => partyIso3 !== query.firstCountryIso3 && partyIso3 !== query.secondCountryIso3)
        .map((partyIso3) => ({ partyIso3, sourceRecordId: record.id, sourceUrl: record.sourceUrl,
          applicability: record.id === sourceFrameworkRecordId ? "source_framework_for_this_concept" as const
            : "only_if_option_uses_framework" as const,
          consentOrVetoStatus: "not_determined" as const })));
    const frameworkSourceUrls = [...new Set(conditionalFrameworkParties.map((party) => party.sourceUrl))];
    const trippFramingFacet = issueComparison.facets.find((facet) => facet.id === "third_party_development_framework" &&
      facet.contrast.framingDifference.status === "documented_in_selected_submitted_texts");
    const request = (id: string, trigger: z.infer<typeof optionEvidenceLedgerSchema>["nextEvidenceRequests"][number]["trigger"],
      requestedEvidence: string, actorToConsult: z.infer<typeof optionEvidenceLedgerSchema>["nextEvidenceRequests"][number]["actorToConsult"],
      contextSourceUrls: string[] = []): z.infer<typeof optionEvidenceLedgerSchema>["nextEvidenceRequests"][number] => ({
      id, trigger, requestedEvidence, actorToConsult, contextSourceUrls, status: "needed_not_obtained",
    });
    const mappedKindReviewQuestions: Record<string, { question: string; actor: z.infer<typeof optionEvidenceLedgerSchema>["nextEvidenceRequests"][number]["actorToConsult"] }> = {
      road: { question: "Verify current road class, direction and turn restrictions, public or freight access, border and customs operation, traffic capacity, and safety for each proposed movement.", actor: "infrastructure_operators" },
      rail: { question: "Verify track continuity, gauge, loading limits, current service, direction, dispatch, border and customs operation, and available train capacity.", actor: "infrastructure_operators" },
      pipeline: { question: "Identify the proposed product and verify pipe continuity, flow direction, pressure and capacity, interconnection facilities, ownership, safety systems, water crossings, and emergency response.", actor: "environmental_and_engineering_authorities" },
      power: { question: "Verify voltage, grid interconnection and synchronization, dispatch direction, available transfer capacity, ownership, protection, and reliability requirements.", actor: "infrastructure_operators" },
      waterway: { question: "For each mapped canal, verify present navigability, vessel limits, direction and seasonality, ports or transfer facilities, depth and flow, water rights, and ecological constraints.", actor: "environmental_and_engineering_authorities" },
      telecom: { question: "Verify actual fiber continuity and interconnection points, available capacity, ownership, resilience, physical security, and cross-border data and operating authority.", actor: "infrastructure_operators" },
    };
    const mappedKindRequests = option.sourceScreens.mappedInfrastructure.status === "mapped_topology_candidate"
      ? option.sourceScreens.mappedInfrastructure.networkKinds.flatMap((kind) => {
          const review = mappedKindReviewQuestions[kind];
          if (!review) return [];
          return [request(`mapped_${kind}_operability`, "mapped_network_kind",
            `${review.question} OSM geometry alone establishes none of these conditions.`, review.actor,
            option.sourceScreens.mappedInfrastructure.mappedWays
              .filter((way) => way.networkKind === kind).map((way) => way.sourceRecordUrl))];
        }) : [];
    const gates: z.infer<typeof optionEvidenceLedgerSchema>["gates"] = [
      { id: "sovereignty_and_jurisdiction", status: proposalStatus,
        contextSourceUrls: accessJurisdictionDialogueReview || peaceProcessReview ? option.sourceUrls : governmentSourceUrls,
        evidenceNeeded: peaceProcessReview
          ? "Identify each competent government's current position on jurisdiction, security measures, and the named processes; submitted allegations do not establish responsibility or a route right."
          : accessJurisdictionDialogueReview
          ? "Identify whether either government proposes a specific access arrangement and obtain competent-authority positions on sovereignty, jurisdiction, applicable rights, and border operations before treating the statements as a negotiation."
          : "Confirm the competent authorities and applicable jurisdiction for the precise policy or alignment." },
      { id: peaceProcessReview ? "peace_process_instruments_and_verification"
          : humanitarianReview ? "humanitarian_protocol_and_family_rights"
          : naturalTopicReview ? "natural_resource_rights_and_agreement" : "agreement_and_transit_terms", status: proposalStatus,
        contextSourceUrls: humanitarianReview || naturalTopicReview || accessJurisdictionDialogueReview || peaceProcessReview ? option.sourceUrls : governmentSourceUrls,
        evidenceNeeded: peaceProcessReview
          ? "Obtain primary process instruments, their parties and current legal status, mutually recognized implementation steps, independent monitoring terms, and dated responses from both governments."
          : humanitarianReview
          ? "Verify competent-party agreement, case governance, family participation and privacy safeguards, and any distinct mine-action protocol."
          : disasterTopicReview ? "Verify competent disaster-risk authorities, warning-data rights, current assistance arrangements, and any agreed process for a defined coordination question."
          : climateTopicReview ? "Identify competent authorities, applicable climate, conservation, finance, and technology terms, and any agreed process for a defined joint question."
          : oneSidedNaturalProposalReview ? "Verify the named fund's current authority and terms, local lake and community rights, and whether the selected counterpart has any accepted role."
          : accessJurisdictionDialogueReview ? "Ask each competent government whether it would discuss any specific access terms; identify all parties, legal instruments, transit or port rights, and applicable approval steps. Neither submitted statement supplies them."
          : naturalTopicReview ? "Identify the competent authorities, applicable water or conservation rights, and any agreed process for a defined shared system."
            : "Obtain current entered-into-force agreements and operative transit or customs terms for every affected party." },
      { id: "construction_permission", status: observation ? "not_applicable_to_observation" : noBuild ? "not_applicable_no_construction" : "unverified",
        contextSourceUrls: [],
        evidenceNeeded: "For a built option, identify land rights, permits, engineering approval, and the authorities that issue them." },
      ...((observation || (noBuild && !existingTransitPolicyReview)) ? [] : [{
        id: "infrastructure_service_and_interconnection" as const, status: "unverified" as const,
        contextSourceUrls: option.sourceScreens.mappedInfrastructure.sourceUrls,
        evidenceNeeded: existingTransitPolicyReview
          ? "Verify the existing service, interconnection, direction, access rights, operating rules, and capacity before estimating the effect of a no-build policy change."
          : "Verify each proposed mode's physical continuity, compatible transfer or interconnection facilities, direction, current operation, access rights, and capacity. Mapped geometry or a submitted concept does not establish a usable service.",
      }]),
      { id: "affected_third_party_consent", status: proposalStatus,
        contextSourceUrls: [],
        evidenceNeeded: "Identify every actually affected third party and obtain its position or consent under applicable rules." },
      { id: "environmental_and_community_review", status: proposalStatus,
        contextSourceUrls: humanitarianReview || naturalTopicReview || peaceProcessReview ? option.sourceUrls : naturalSourceUrls,
        evidenceNeeded: peaceProcessReview
          ? "Obtain civilian-protection, displacement, access, and local-community accounts for any defined implementation step; neither state's speech represents affected people."
          : humanitarianReview
          ? "Consult affected families and communities on the proposed process, and require specialist civilian-safety review for any mine-action operation."
          : "Determine applicable review procedures and document ecological and community effects with affected people." },
    ];
    const objectiveEvidencePlans: z.infer<typeof optionEvidenceLedgerSchema>["objectiveEvidencePlans"] =
      option.objectiveReadiness.flatMap((readiness) => {
        if (readiness.status === "not_applicable_to_option" || readiness.status === "not_applicable_to_observation") return [];
        const humanitarian = option.comparisonDomain === "humanitarian_policy";
        const naturalSystem = option.comparisonDomain === "natural_system_policy";
        const measurement = peaceProcessReview ? {
          question: readiness.objective === "resilience"
            ? "For a defined implementation step, what independently verified changes in civilian safety, displacement, humanitarian access, and recurrence of violence occur against a dated baseline, and for which affected communities?"
            : "What separate gains, losses, rights safeguards, and unresolved security risks would each state and conflict-affected community identify for the defined step, without merging them into one cooperation score?",
          actor: "affected_communities" as const,
        } : readiness.objective === "mapped_length" ? {
          question: "What is the surveyed length between the same agreed endpoints, with a route definition and uncertainty that can be compared across alternatives? Mapped topology length is only a bounded sketch measure.",
          actor: "environmental_and_engineering_authorities" as const,
        } : readiness.objective === "trade_access" ? {
          question: "How would documented capacity, end-to-end cost and time, border terms, and access by commodity and direction change from a current operating baseline?",
          actor: "infrastructure_operators" as const,
        } : readiness.objective === "resilience" ? naturalSystem ? {
          question: disasterTopicReview
            ? "For identified exposed communities, how would warning lead time, reach, evacuation access, and recovery change under specified hazards compared with documented current practice?"
            : climateTopicReview
              ? "For a defined climate or ecosystem question, how would exposure, adaptive capacity, and recovery change under specified scenarios against separate dated baselines for each place?"
              : "For a defined basin or ecosystem, how would seasonal water and ecological conditions change under specified drought, flood, and demand scenarios compared with the observed baseline?",
          actor: "environmental_and_engineering_authorities" as const,
        } : humanitarian ? {
          question: "Which family-facing process or safety service would be more reliable, for whom, and under which documented disruption and recovery scenarios?",
          actor: "affected_families" as const,
        } : {
          question: "How would capacity, service continuity, alternate paths, and recovery time change under specified disruptions compared with the present network?",
          actor: "infrastructure_operators" as const,
        } : readiness.objective === "emissions" ? {
          question: "What are the construction or program, operating, and displaced-activity emissions under explicit lifecycle boundaries and a documented counterfactual?",
          actor: "environmental_and_engineering_authorities" as const,
        } : readiness.objective === "environmental_protection" ? humanitarian ? {
          question: "What ecological and civilian-safety effects would a specifically scoped mine-action activity have, including disposal, land use, and affected-community priorities?",
          actor: "environmental_and_engineering_authorities" as const,
        } : {
          question: "What site-specific ecological baseline, impact pathway, mitigation, monitoring, and affected-community evidence applies to the defined policy or alignment?",
          actor: "environmental_and_engineering_authorities" as const,
        } : humanitarian ? {
          question: "Which family-defined outcomes, rights safeguards, case-process burdens, and possible harms would each side and affected families experience against a documented baseline?",
          actor: "affected_families" as const,
        } : {
          question: "What bounded gains, costs, risks, and distributional effects would each state and affected community face against a documented baseline, under declared values and assumptions?",
          actor: "affected_communities" as const,
        };
        return [{
          objective: readiness.objective, readinessStatus: readiness.status,
          measurementQuestion: measurement.question, actorToConsult: measurement.actor,
          contextSourceUrls: option.sourceUrls,
          contextRole: "dated_context_not_option_outcome_measurement" as const,
          frontierEligibility: "not_established" as const,
        }];
      });
    const geometrySourceUrl = option.sourceScreens.thirdCountryPolygonContacts.sourceUrl;
    const geometryContactPositionCoverage = geometrySourceUrl
      ? thirdCountryScreen.countries.map((country) => {
        const countryIso3 = country.isoA3;
        if (!countryIso3) return {
          editorialAdm0A3: country.editorialAdm0A3, isoA3: null, name: country.name,
          geometrySourceUrl, status: "iso3_unresolved" as const,
          submittedPdfLinkStatus: "unknown_no_page" as const,
          officialPageUrl: null, reviewedBriefSourceUrl: null,
          nextSourceReviewStage: null, nextSourceReviewReason: "Resolve the map depiction to a country before looking up its UN source record.",
          sourceReviewUrls: [],
          effectOnOption: "unassessed_geometry_contact_only" as const,
        };
        let evidence = countryEvidenceCache.get(countryIso3);
        if (!evidence) {
          evidence = readUnga81CountryEvidence({ countryIso3 });
          countryEvidenceCache.set(countryIso3, evidence);
        }
        const nextReview = corpusCoverage.reviewQueue.find((item) => item.countryIso3 === countryIso3);
        return {
          editorialAdm0A3: country.editorialAdm0A3, isoA3: countryIso3, name: country.name,
          geometrySourceUrl,
          status: evidence.reviewedBrief ? "reviewed_selective_submitted_brief" as const
            : evidence.submittedStatements.length ? "official_page_only_no_reviewed_brief" as const
              : "official_page_missing" as const,
          submittedPdfLinkStatus: !evidence.submittedStatements.length ? "unknown_no_page" as const
            : evidence.submittedStatements.some((statement) => statement.pdfUrls.length > 0)
              ? "linked" as const : "not_linked" as const,
          officialPageUrl: evidence.submittedStatements[0]?.pageUrl ?? null,
          reviewedBriefSourceUrl: evidence.reviewedBrief?.sourceUrl ?? null,
          nextSourceReviewStage: nextReview?.stage ?? null,
          nextSourceReviewReason: nextReview?.reason ?? null,
          sourceReviewUrls: nextReview?.sourceUrls ?? [],
          effectOnOption: "unassessed_geometry_contact_only" as const,
        };
      }) : [];
    const potentialThirdPartyOutcomeGaps = [...new Set([
      ...conditionalFrameworkParties.map((party) => party.partyIso3),
      ...geometryContactPositionCoverage.flatMap((country) => country.isoA3 ? [country.isoA3] : []),
    ])].sort().map((countryIso3) => ({
      countryIso3,
      basis: [
        ...(conditionalFrameworkParties.some((party) => party.partyIso3 === countryIso3)
          ? ["conditional_framework_party" as const] : []),
        ...(geometryContactPositionCoverage.some((country) => country.isoA3 === countryIso3)
          ? ["editorial_geometry_contact" as const] : []),
      ],
      basisSourceUrls: [...new Set([
        ...conditionalFrameworkParties.filter((party) => party.partyIso3 === countryIso3).map((party) => party.sourceUrl),
        ...geometryContactPositionCoverage.filter((country) => country.isoA3 === countryIso3)
          .map((country) => country.geometrySourceUrl),
      ])],
      optionSpecificPosition: "not_established" as const,
      possibleGain: "not_quantified" as const,
      possibleLoss: "not_quantified" as const,
      publicAndCommunityEffects: "not_assessed" as const,
      interpretation: "A framework role or source-depicted map contact identifies a possible party to investigate, not a confirmed effect, consent, opposition, or project benefit." as const,
    }));
    return {
      optionId: option.id,
      decisionReadiness: observation ? "observation_not_a_proposal" as const
        : "cannot_rank_or_approve_distributional_outcomes_unmeasured" as const,
      documentedLegalStages: [
        ...governmentRecords.map((record) => ({
          sourceRecordId: record.id, parties: record.parties,
          scope: "selected_pair_context" as const, legalStatus: record.legalStatus,
          statusAsOf: record.statusAsOf, sourceUrl: record.sourceUrl,
          applicability: "dated_context_only" as const, routePermission: "not_established" as const,
        })),
        ...multilateralGovernmentRecords.map((record) => ({
          sourceRecordId: record.id, parties: record.parties,
          scope: "joint_multilateral_context" as const, legalStatus: record.legalStatus,
          statusAsOf: record.statusAsOf, sourceUrl: record.sourceUrl,
          applicability: "dated_context_only" as const, routePermission: "not_established" as const,
        })),
        ...(observation || noBuild ? [] : dependentGovernmentRecords.map((record) => ({
          sourceRecordId: record.id, parties: record.parties,
          scope: "conditional_third_party_framework" as const, legalStatus: record.legalStatus,
          statusAsOf: record.statusAsOf, sourceUrl: record.sourceUrl,
          applicability: record.id === sourceFrameworkRecordId ? "source_framework_for_this_concept" as const
            : "only_if_option_uses_framework" as const, routePermission: "not_established" as const,
        }))),
      ],
      gates,
      objectiveEvidencePlans,
      selectedPartyDistribution: [query.firstCountryIso3, query.secondCountryIso3].map((countryIso3) => ({
        countryIso3,
        observedGoodsExportsToCounterpart: observedGoodsExports(countryIso3),
        reviewedPositionAssertionIds: option.concept
          ? option.concept.origin.kind === "reviewed_submitted_assertion" && countryIso3 === option.concept.origin.countryIso3
            ? [option.concept.origin.assertionId] : []
          : option.policyReview
            ? (humanitarianReview ? humanitarianIssueComparison : naturalTopicReview ? naturalSystemIssueComparison : issueComparison).facets.flatMap((facet) => facet.positions)
              .filter((position) => position.countryIso3 === countryIso3 &&
              option.policyReview?.submittedAssertionIds.includes(position.id)).map((position) => position.id)
          : [],
        issueContextAssertionIds: [...new Set((humanitarianReview ? humanitarianIssueComparison : naturalTopicReview ? naturalSystemIssueComparison : issueComparison).facets
          .flatMap((facet) => facet.positions.filter((position) => position.countryIso3 === countryIso3)
            .map((position) => position.id)))],
        optionPositionStatus: observation ? "not_applicable_dated_observation" as const
          : option.concept?.counterpartSpecificSupport === "both_governments_reported_project_announcement_no_permissions" &&
            option.concept.origin.kind === "reviewed_submitted_assertion" &&
            [option.concept.origin.countryIso3, option.concept.origin.namedCounterpartIso3].includes(countryIso3)
            ? "government_joint_project_announcement_permissions_unverified" as const
          : option.concept?.origin.kind === "reviewed_submitted_assertion" &&
            option.concept.origin.countryIso3 === countryIso3 ? "submitted_concept_origin_no_option_consent" as const
          : oneSidedNaturalProposalReview && option.policyReview?.submittedAssertionIds.some((id) =>
            naturalSystemIssueComparison.facets.some((facet) => facet.positions.some((position) =>
              position.countryIso3 === countryIso3 && position.id === id)))
            ? "submitted_one_sided_policy_proposal_no_counterpart_response" as const
          : option.policyReview?.submittedAssertionIds.some((id) =>
            (humanitarianReview ? humanitarianIssueComparison : naturalTopicReview ? naturalSystemIssueComparison : issueComparison).facets.some((facet) =>
              facet.positions.some((position) => position.countryIso3 === countryIso3 && position.id === id)))
            ? "submitted_policy_topic_no_option_consent" as const
          : "no_option_specific_position_established" as const,
        possibleGain: "not_quantified" as const, possibleLoss: "not_quantified" as const,
        publicAndCommunityEffects: "not_assessed" as const,
      })),
      potentialThirdPartyOutcomeGaps,
      datedOperatingReports: observation || option.comparisonDomain === "connectivity_policy" ? datedOperatingReports : [],
      datedProjectMilestones,
      institutionalHumanitarianContext: humanitarianReview ? humanitarianIssueComparison.humanitarianContext : [],
      affectedFamilyContext: humanitarianReview ? humanitarianIssueComparison.familyContext : [],
      possibleThirdCountryDepictionContacts: geometrySourceUrl
        ? option.sourceScreens.thirdCountryPolygonContacts.countries.map((country) => ({
          editorialAdm0A3: country.editorialAdm0A3, isoA3: country.isoA3,
          name: country.name, sourceUrl: geometrySourceUrl,
          significance: "geometry_contact_only_not_jurisdiction_or_effect" as const,
        })) : [],
      thirdPartyContextReview: {
        optionSpecificEffectStatus: "unassessed" as const,
        conditionalFrameworkParties,
        regionalStatementPerspectives: pair.thirdPartyPositions.map((position) => ({
          countryIso3: position.countryIso3,
          assertionIds: position.assertions.map((assertion) => assertion.id),
          sourceUrls: [...new Set(position.assertions.map((assertion) => assertion.sourceUrl))],
          applicability: "regional_context_only" as const,
          consentOrVetoStatus: "not_determined" as const,
        })),
        reportedTransitDependencies: noBuild && !humanitarianReview && reportedRailViaGeorgia ? [{
          countryIso3: "GEO", originCountryIso3: "ARM",
          originAssertionId: reportedRailViaGeorgia.id, sourceUrl: reportedRailViaGeorgia.sourceUrl,
          status: "speaker_report_not_operationally_verified" as const,
          optionSpecificTerms: "not_assessed" as const, consentOrVetoStatus: "not_determined" as const,
        }] : [],
        operatorContextSources: noBuild && !humanitarianReview && reportedRailViaGeorgia ? issueComparison.thirdPartyOperatingContext : [],
        geometryContactPositionCoverage,
        geometryContactStatus: observation || noBuild || unlocatedConcept ? "not_applicable_no_alignment" as const
          : thirdCountryScreen.countries.length || thirdCountryScreen.indeterminateFeatureIds.length
            ? "possible_contacts_require_legal_review" as const : "no_contacts_surfaced_not_clearance" as const,
        interpretation: "A third-party statement, reported transit path, contingent framework, or editorial geometry contact does not establish option-specific consent, opposition, jurisdiction, or a veto." as const,
      },
      naturalSystemScreen: {
        status: observation || noBuild || unlocatedConcept ? "not_applicable_no_route" as const
          : waterwayScreen.status === "available" || lakeScreen.status === "available" || terrestrialScreen.status === "available" || reliefScreen.status === "available" || wetlandBoundary || liveRamsarReview?.status === "available"
            ? "bounded_geometry_observations" as const : "source_unavailable" as const,
        designatedWetlandContext: issueComparison.designatedWetlandContext,
        designatedWetlandRouteRelation: wetlandBoundary ? "partial_published_boundary_screen" as const
          : "not_screened_no_alignment" as const,
        designatedWetlandBoundaryScope: wetlandBoundary ? "five_armenia_azerbaijan_pilot_sites_only" as const
          : "not_screened" as const,
        selectedCountryWetlandBoundaryGaps: [query.firstCountryIso3, query.secondCountryIso3]
          .filter((countryIso3) => !issueComparison.designatedWetlandContext.some((record) =>
            record.countryIso3 === countryIso3 && record.geometryStatus === "published_boundary_snapshot_available")),
        designatedWetlandSites: wetlandBoundary?.sites ?? [],
        liveRamsarReview,
        generalizedWaterwayContactCount: waterwayScreen.status === "available" ? waterwayScreen.contactCount : null,
        generalizedWaterwayContacts: waterwayScreen.contacts,
        waterwayContactsPossiblyTruncated: waterwayScreen.possiblyTruncated,
        reviewedStatementWaterwayLinks,
        generalizedLakeContactCount: lakeScreen.status === "available" ? lakeScreen.contactCount : null,
        generalizedLakeContacts: lakeScreen.contacts,
        lakeContactsPossiblyTruncated: lakeScreen.possiblyTruncated,
        reviewedStatementLakeLinks,
        terrestrialDepictions: terrestrialScreen,
        reliefSampleCount: reliefScreen.status === "available" ? reliefScreen.sampleCount : null,
        sourceUrls: naturalSourceUrls,
        environmentalReviewStatus: "not_assessed" as const,
        interpretation: "Published wetland depictions, generalized waterways and lake outlines, mapped terrestrial OSM ways and relation fragments, and model-height samples do not establish ecological impact, current land cover, legal protection, flood risk, water availability, permission, or engineering feasibility." as const,
      },
      infrastructureScreen: option.sourceScreens.mappedInfrastructure,
      unidentifiedAffectedActors: humanitarianReview ? ["families_of_missing", "mine_affected_communities"] as const
        : peaceProcessReview ? ["displaced_and_conflict_affected_communities"] as const
        : oneSidedNaturalProposalReview ? ["local_communities"] as const
        : option.comparisonDomain === "natural_system_policy" ? ["local_communities", "cross_border_ecosystems"] as const
        : ["local_communities", "infrastructure_owners_and_operators", "cross_border_ecosystems"] as const,
      nextEvidenceRequests: observation
        ? [request("current_operating_baseline", "dated_observation",
          "Verify current services, capacity, trade, and operating terms before treating dated interaction as a measured baseline.",
          "infrastructure_operators", option.sourceUrls)]
        : humanitarianReview
          ? [request("missing_persons_mechanism", "policy_only_option",
              "Verify whether the separate Article IX missing-persons modalities were negotiated, signed, and put into operation; obtain each competent party's dated position on case governance and independent verification.",
              "competent_governments", option.sourceUrls),
            request("family_and_community_consultation", "policy_only_option",
              "Consult affected families on both sides about case updates, coordination, confidentiality, identification, legal and psychosocial support, and possible harms. ICRC accounts are bounded context, not consent to this option.",
              "affected_families", humanitarianIssueComparison.familyContext.map((record) => record.sourceUrl)),
            request("mine_affected_community_consultation", "policy_only_option",
              "Consult communities that a specifically proposed mine-action activity could affect; national programs do not establish their priorities or consent.",
              "affected_communities", humanitarianIssueComparison.humanitarianContext
                .filter((record) => record.topic === "mine_action").map((record) => record.sourceUrl)),
            request("mine_action_scope_and_safety", "policy_only_option",
              "Request competent mine-action authorities' current hazard data, survey standards, clearance responsibilities, and civilian-safety process before suggesting an operation.",
              "specialist_hazard_and_clearance_authorities", option.sourceUrls)]
        : oneSidedNaturalProposalReview
          ? [request("proposal_status_and_terms", "policy_only_option",
              "Verify the proposed Issyk-Kul fund's current status, legal form, governance, eligibility, and documented finance before treating it as operational.",
              "competent_governments", option.sourceUrls),
            request("counterpart_natural_proposal_response", "policy_only_option",
              "Ask the selected counterpart whether it sees any relevant role and, if so, what terms it would consider; a missing reviewed response is not consent or opposition.",
              "competent_governments", option.sourceUrls),
            request("lake_baseline_and_local_priorities", "policy_only_option",
              "Obtain current Issyk-Kul water and ecosystem observations and consult lake-dependent communities about priorities, rights, and possible effects before estimating benefits.",
              "affected_communities", option.sourceUrls)]
        : disasterTopicReview
          ? [request("verify_reported_disaster_assistance", "policy_only_option",
              "Obtain dated operator, humanitarian, and receiving-authority records for the assistance described by both speakers; identify what was delivered and to whom because the speeches do not provide operational delivery records.",
              "competent_governments", option.sourceUrls),
            request("early_warning_counterpart_terms", "policy_only_option",
              "Ask each competent government whether it accepts any part of the proposed Himalayan data-sharing, glacial-lake monitoring, early-warning, or cross-border response mechanism, and under what rights and responsibilities.",
              "competent_governments", option.sourceUrls),
            request("named_china_proposal_role", "policy_only_option",
              "Nepal also names China in the proposed mechanism. Obtain China's current position and competent-authority, data-sharing, warning, and response terms before treating a Nepal–India discussion as a complete three-party design.",
              "potentially_affected_third_country", option.sourceUrls),
            request("disaster_risk_affected_communities", "policy_only_option",
              "Identify exposed communities and local responders, current hazard observations, warning reach, recovery priorities, and possible losses under a specific proposed arrangement.",
              "affected_communities", option.sourceUrls)]
        : climateTopicReview
          ? [request("define_climate_cooperation_question", "policy_only_option",
              "Ask each government whether it would discuss the same defined climate resilience or ecosystem question, and identify responsibilities, finance or technology terms, and competent authorities.",
              "competent_governments", option.sourceUrls),
            request("climate_baselines_and_effects", "policy_only_option",
              "Obtain comparable dated emissions, hazard, ecological, finance, and adaptation baselines appropriate to the defined question before estimating any gain or loss.",
              "environmental_and_engineering_authorities", option.sourceUrls),
            request("climate_affected_communities", "policy_only_option",
              "Identify potentially affected communities in each place and document their priorities, rights, and possible losses for a specific option.",
              "affected_communities", option.sourceUrls)]
        : naturalTopicReview
          ? [request("identify_shared_natural_system", "policy_only_option",
              "Identify the actual shared watershed or ecosystem, its competent authorities, and whether both governments want to discuss the same defined problem.",
              "competent_governments", option.sourceUrls),
            request("natural_system_baseline", "policy_only_option",
              "Obtain current seasonal hydrological and ecological observations, uncertainty, uses, and applicable rights before defining a policy change or estimating gains.",
              "environmental_and_engineering_authorities", option.sourceUrls),
            request("natural_system_affected_communities", "policy_only_option",
              "Identify people and communities who depend on the defined system and document their priorities and possible losses for a specific option.",
              "affected_communities", option.sourceUrls)]
        : accessJurisdictionDialogueReview
          ? [request("both_governments_access_positions", "policy_only_option",
              "Ask each competent government whether any specific access arrangement is under discussion and what it would or would not consider; general UN statements establish neither a proposal nor a response.",
              "competent_governments", option.sourceUrls),
            request("access_jurisdiction_and_third_parties", "policy_only_option",
              "If a concrete arrangement is identified, document jurisdiction, applicable legal instruments, port and transit authorities, every potentially affected third party, and the approvals each would require.",
              "competent_governments", option.sourceUrls),
            request("access_port_identity_and_service", "policy_only_option",
              "If maritime access is contemplated, identify a possible port, terminal, and transfer point. For a caller-selected endpoint area, compare the NGA World Port Index and OSM observations with helix_civilization_maritime_endpoint, then obtain current facility, shipping-service, capacity, customs, and access records from responsible authorities and operators. Nearby source points do not establish the same facility, a berth, or a right of use.",
              "infrastructure_operators", option.sourceUrls),
            request("access_baseline_and_local_effects", "policy_only_option",
              "Define any proposed route or service and obtain current trade, capacity, cost, natural-system, and community baselines before estimating who could gain or lose.",
              "affected_communities", option.sourceUrls)]
        : oneSidedProjectScopeReview
          ? [request("project_scope_positions_and_terms", "policy_only_option",
              "Ask each competent government whether the cited project scope and the submitted condition are relevant to a shared discussion; obtain current agreements, service and financing terms, and each party's dated response.",
              "competent_governments", option.sourceUrls),
            request("project_scope_workers_communities_and_nature", "policy_only_option",
              "Ask affected workers and communities to define acceptable benefits and risks, and obtain current ecological, rights, land-use, and distributional evidence before comparing a project-scope policy change.",
              "affected_communities", option.sourceUrls)]
        : peaceProcessReview
          ? [request("peace_process_instruments_and_positions", "policy_only_option",
              "Obtain the Washington, Doha, and African Union primary instruments, parties, legal status, current implementation terms, and each government's dated position on the specific step under review.",
              "competent_governments", option.sourceUrls),
            request("independent_security_and_implementation_review", "policy_only_option",
              "Seek independent, dated evidence on the alleged armed-group roles, security conditions, disarmament and withdrawal steps, monitoring access, and unresolved disputes. Neither submitted allegation proves the other's responsibility or compliance.",
              "independent_monitors_and_humanitarian_agencies", option.sourceUrls),
            request("civilian_protection_and_local_priorities", "policy_only_option",
              "Identify displaced people and other affected communities, their protection and access conditions, and their priorities for a precisely defined peace-process step; official speeches do not represent their consent.",
              "affected_communities", option.sourceUrls),
            request("later_trade_option_scope", "policy_only_option",
              "Only after specifying a separate trade or infrastructure proposal, identify its operators, actual geography, costs, transit rights, environmental effects, and distribution of gains and losses. Peace-process language alone establishes none of these.",
              "infrastructure_operators", option.sourceUrls)]
        : parallelTopicReview
          ? [request("both_governments_specific_interest", "policy_only_option",
              "Ask each competent government whether the independently mentioned topic is relevant to this pair and what specific, mutually discussable proposal it would consider.",
              "competent_governments", option.sourceUrls),
            request("topic_baseline_and_affected_actors", "policy_only_option",
              "Define a concrete policy or service change, document the current baseline, and identify affected operators, communities, and third parties before estimating gains or losses.",
              "infrastructure_operators", option.sourceUrls)]
        : policyScopeUnknown
          ? [request("identify_pair_policy_scope", "policy_only_option",
              "Identify a specific issue both governments would discuss, then obtain their current option-specific positions before defining a policy baseline or claiming a possible gain.",
              "competent_governments", option.sourceUrls)]
        : noBuild
          ? [request("existing_transit_baseline", "policy_only_option",
              "Obtain current route, service, volume, capacity, and operating-rule records from the responsible operators; dated statements alone do not establish the baseline.",
              "infrastructure_operators", option.sourceUrls),
            request("policy_terms_and_authority", "policy_only_option",
              "Specify the policy or operating-rule change and obtain each competent party's dated response.",
              "competent_governments", governmentSourceUrls),
            ...(reportedRailViaGeorgia ? [request("reported_georgia_rail_terms", "policy_only_option",
              "Verify whether the reported Armenia–Azerbaijan rail connection through Georgia operates, and obtain Georgia's current infrastructure, customs, and transit terms for any proposed policy change.",
              "potentially_affected_third_country", [reportedRailViaGeorgia.sourceUrl,
                ...datedOperatingReports.flatMap((report) => report.corroboratingOperationalSources.map((source) => source.sourceUrl)),
                ...issueComparison.thirdPartyOperatingContext.map((record) => record.sourceUrl)])] : []),
            request("policy_distribution", "policy_only_option",
              "Estimate per-party and community effects against the observed baseline.",
              "affected_communities")]
          : unlocatedConcept
            ? [request("concept_counterpart_terms", "built_option",
                "Ask the counterpart whether this cited concept has any specific mutually acceptable scope or terms.",
                "competent_governments", option.sourceUrls),
              request("concept_alignment_and_demand", "built_option",
                "Define a candidate alignment, demand, operating capacity, and engineering scope before route screening or cost comparison.",
                "infrastructure_operators"),
              ...(option.concept?.family === "rail_restoration" ? [request("rail_endpoint_and_interoperability", "built_option",
                "Resolve the delivered rail-section wording, then identify actual connections, gauge and operating interoperability before proposing an endpoint.",
                "infrastructure_operators", option.sourceUrls)] : []),
              ...(option.concept?.family === "rail_connection" ? [request("named_railway_project_status", "built_option",
                "Check the named-counterpart railway's current project stage with both rail authorities; identify actual endpoints, interconnection, gauge, operating rights, financing, and any completed works before treating it as an available service.",
                "infrastructure_operators", option.sourceUrls)] : []),
              ...(option.concept?.family === "road_link" ? [request("road_crossing_and_traffic", "built_option",
                "Specify road class, border-crossing and customs operation, expected traffic, land needs, and local safety before assessing a road option.",
                "competent_governments", option.sourceUrls)] : []),
              ...(option.concept?.family === "pipeline_link" ? [request("pipeline_product_safety_and_water", "built_option",
                "Specify transported product, pressure and capacity, leak detection, emergency response, water crossings, and decommissioning responsibilities before assessing a pipeline.",
                "environmental_and_engineering_authorities", option.sourceUrls)] : []),
              ...(option.concept?.family === "electricity_link" ? [request("grid_interconnection_and_reliability", "built_option",
                "Specify voltage, interconnection points, grid stability, dispatch, system operators, and outage responsibilities before assessing a power line.",
                "infrastructure_operators", option.sourceUrls)] : []),
              ...(option.concept?.family === "fiberoptic_link" ? [request("fiber_interconnection_and_data_governance", "built_option",
                "Specify network endpoints, capacity, ownership, resilience, physical security, data governance, and cross-border operating authority before assessing a fiber link.",
                "infrastructure_operators", option.sourceUrls)] : []),
              request("concept_ownership_and_finance", "built_option",
                "Identify proposed owners, financing, tariff or revenue terms, and who bears construction and operating risk.",
                "competent_governments", option.sourceUrls),
              request("concept_affected_parties", "built_option",
                "Identify potentially affected states, communities, and ecosystems after an alignment is defined.",
                "affected_communities"),
              ...(frameworkSourceUrls.length ? [request("conditional_framework_applicability", "built_option",
                sourceFrameworkRecordId
                  ? "Verify this source framework's entry into force, project designation, implementation area, and project-specific terms; obtain the counterpart's independent position."
                  : "Determine whether this concept would use the named third-party framework; if so, verify its entry into force and project-specific implementing terms.",
                "competent_governments", frameworkSourceUrls)] : []),
              ...(sourceFrameworkRecordId && trippFramingFacet ? [request("tripp_framing_and_terms", "built_option",
                "Ask both governments whether this framework-based option is acceptable under their current terminology, jurisdiction, access, and operating terms. The submitted statements' different framing is not proof of a legal conflict or consent.",
                "competent_governments", trippFramingFacet.positions.map((position) => position.sourceUrl))] : [])]
          : [
            request("route_permissions", "built_option",
              "Verify the alignment's legal crossing, land, and construction permissions independently of editorial map geometry.",
              "competent_governments", governmentSourceUrls),
            request("capacity_and_cost", "built_option",
              "Obtain current network operating capacity, construction feasibility, and cost for this option.",
              "infrastructure_operators"),
            ...mappedKindRequests,
            ...(option.sourceScreens.mappedInfrastructure.networkTransitionCount > 0
              ? [request("network_transition_facilities", "mapped_network_transition",
                "Verify actual transfer or interconnection facilities at each mapped network-kind change, including compatibility, direction, capacity, ownership, operating rights, and permissions. A shared OSM node alone does not establish a usable connection.",
                "infrastructure_operators", option.sourceScreens.mappedInfrastructure.networkTransitions
                  .flatMap((transition) => [transition.fromSourceRecordUrl, transition.toSourceRecordUrl]))] : []),
            request("community_review", "built_option",
              "Identify potentially affected communities and obtain their documented concerns and consultation requirements.",
              "affected_communities"),
            request("environmental_review", "built_option",
              "Determine applicable environmental review procedures and assess effects for a specified alignment.",
              "environmental_and_engineering_authorities", naturalSourceUrls),
            ...(reviewedStatementWaterwayLinks.length ? [request("named_waterway_source_scope", "generalized_waterway_contact",
              "Ask each competent government whether the cited river-system concern pertains to this exact depicted reach and proposed alignment. Obtain current river identity, seasonal flow and use observations, applicable rights, and downstream and community effects from responsible authorities before treating the cartographic name link as a constraint or opportunity.",
              "competent_governments", [...new Set(reviewedStatementWaterwayLinks.flatMap((link) =>
                [link.statementSourceUrl, link.lineSourceRecordUrl]))])] : []),
            ...(issueComparison.designatedWetlandContext.length ? [request("designated_wetland_boundary_and_management_review", "built_option",
              "Obtain current official Ramsar site boundaries, competent-authority management rules, and a detailed alignment review before confirming site contact or ecological effect.",
              "environmental_and_engineering_authorities",
              issueComparison.designatedWetlandContext.map((record) => record.sourceUrl))] : []),
            ...(wetlandBoundary?.sites.some((site) => site.relation === "intersects_published_depiction")
              ? [request("published_wetland_depiction_contact_review", "published_wetland_depiction_contact",
                `Review the mapped alignment against current competent-authority boundaries and management records for ${wetlandBoundary.sites
                  .filter((site) => site.relation === "intersects_published_depiction")
                  .map((site) => `${site.name} (#${site.siteNumber})`).join(", ")}; assess ecological effects and consult affected communities before any decision.`,
                "environmental_and_engineering_authorities", [wetlandBoundary.sourceUrl])] : []),
            ...(liveRamsarReview?.status === "available" && liveRamsarReview.sites.some((site) => site.relation === "intersects_published_depiction")
              ? [request("live_ramsar_published_contact_review", "published_wetland_depiction_contact",
                `Verify current boundaries and management rules for ${liveRamsarReview.sites
                  .filter((site) => site.relation === "intersects_published_depiction")
                  .map((site) => `${site.name} (#${site.siteNumber})`).join(", ")}; assess actual effects and consult affected communities before any decision.`,
                "environmental_and_engineering_authorities", [liveRamsarReview.source.requestUrl,
                  ...liveRamsarReview.sites.filter((site) => site.relation === "intersects_published_depiction")
                    .map((site) => site.sourceRecordUrl)])] : []),
            ...(frameworkSourceUrls.length ? [request("conditional_framework_applicability", "built_option",
              "Determine whether this route would use the named third-party framework; if so, verify its entry into force and project-specific implementing terms.",
              "competent_governments", frameworkSourceUrls)] : []),
            ...thirdCountryScreen.countries.map((country) =>
              request(`third_country_contact_verification_${country.editorialAdm0A3}`, "possible_third_country_contact",
                `For the source-depicted contact with ${country.name}, verify whether the proposed alignment creates a legal crossing or actual effect, then identify the competent party.`,
                "potentially_affected_third_country", thirdCountrySourceUrls)),
            ...(thirdCountryScreen.indeterminateFeatureIds.length
              ? [request("third_country_unresolved_feature_review", "possible_third_country_contact",
                "Resolve the indeterminate country depictions before concluding whether further parties need contact or effect review.",
                "potentially_affected_third_country", thirdCountrySourceUrls)] : []),
            ...geometryContactPositionCoverage.map((country) =>
              request(`third_country_statement_review_${country.editorialAdm0A3}`, "possible_third_country_contact",
                `Review ${country.name}'s current, option-specific position with its competent authorities${country.isoA3 ? "" : " after resolving its country affiliation"}. A selected UN statement or missing brief establishes neither support nor opposition.`,
                "potentially_affected_third_country", [...new Set([
                  ...country.sourceReviewUrls, ...(country.officialPageUrl ? [country.officialPageUrl] : []),
                  ...(country.reviewedBriefSourceUrl ? [country.reviewedBriefSourceUrl] : []),
                ])])),
            ...potentialThirdPartyOutcomeGaps.map((country) =>
              request(`third_country_distribution_review_${country.countryIso3}`, "built_option",
                `For possible third-country party ${country.countryIso3}, establish whether this option changes access, costs, risks, or public and community conditions relative to a documented baseline; identify possible gains and losses with that party and affected communities.`,
                "potentially_affected_third_country", country.basisSourceUrls)),
            ...(waterwayScreen.status === "available" && waterwayScreen.contactCount != null && waterwayScreen.contactCount > 0
              ? [request("waterway_crossing_review", "generalized_waterway_contact",
                "Locate actual water bodies and assess crossing design, flood and ecological effects for the detailed alignment.",
                "environmental_and_engineering_authorities", waterwayScreen.sourceUrls)] : []),
            ...(lakeScreen.status === "available" && lakeScreen.contactCount != null && lakeScreen.contactCount > 0
              ? [request("lake_outline_review", "generalized_lake_outline_contact",
                "Verify current lake extent and water conditions for the named depiction, then assess alignment, ecological effects, applicable rights, and affected communities with competent authorities.",
                "environmental_and_engineering_authorities", lakeScreen.sourceUrls)] : []),
            ...(terrestrialScreen.status === "available" && terrestrialScreen.contactCount != null && terrestrialScreen.contactCount > 0
              ? [request("mapped_terrestrial_depiction_review", "mapped_terrestrial_depiction_contact",
                "Verify current forest or protected-area boundaries and status with competent authorities, then assess land cover, habitat, worker and community use, applicable rights, and option-specific effects along a detailed alignment.",
                "environmental_and_engineering_authorities", terrestrialScreen.sourceUrls)] : []),
            ...(reliefScreen.status === "available" && reliefScreen.sampleCount != null && reliefScreen.sampleCount > 0
              ? [request("terrain_design_review", "relief_model_sample",
                "Survey terrain, gradients, and ground conditions before making an engineering or cost claim.",
                "environmental_and_engineering_authorities", reliefScreen.sourceUrls)] : []),
            ...(safetyConcernUrls.length
              ? [request("alignment_explosive_hazard_check", "stated_safety_concern_not_geolocated",
                "Check whether this specific alignment intersects any surveyed explosive-hazard area and obtain current clearance and community-safety records. A speech concern does not locate a route hazard.",
                "specialist_hazard_and_clearance_authorities", safetyConcernUrls)] : []),
          ],
    };
  });
  type ReviewActorLink = z.infer<typeof civilizationScenarioComparisonOutputSchema>["reviewActorGraph"]["links"][number];
  const nepalMechanismPosition = naturalSystemIssueComparison.facets.flatMap((facet) => facet.positions)
    .find((position) => position.id === "npl-himalayan-resilience-mechanism");
  const generalStatementCoverage = (actorKey: string): ReviewActorLink["generalStatementCoverage"] => {
    if (!actorKey.startsWith("state:")) return null;
    const countryIso3 = actorKey.slice("state:".length);
    let evidence = countryEvidenceCache.get(countryIso3);
    if (!evidence) {
      evidence = readUnga81CountryEvidence({ countryIso3 });
      countryEvidenceCache.set(countryIso3, evidence);
    }
    return {
      status: evidence.reviewedBrief ? "reviewed_selective_submitted_brief"
        : evidence.submittedStatements.length ? "official_page_only_no_reviewed_brief" : "official_page_missing",
      officialPageUrl: evidence.submittedStatements[0]?.pageUrl ?? null,
      reviewedBriefSourceUrl: evidence.reviewedBrief?.sourceUrl ?? null,
      sourceLanguage: evidence.reviewedBrief?.sourceLanguage ?? null,
      reviewedAssertionIds: evidence.reviewedBrief?.assertions.map((assertion) => assertion.id) ?? [],
      optionSpecificAgreement: "not_established",
    };
  };
  const reviewActorLinks: ReviewActorLink[] = optionEvidenceLedgers.flatMap((ledger) => {
    if (ledger.decisionReadiness === "observation_not_a_proposal") return [];
    const option = options.find((candidate) => candidate.id === ledger.optionId);
    const originAssertionId = option?.concept?.origin.kind === "reviewed_submitted_assertion"
      ? option.concept.origin.assertionId : null;
    const requestIds = (...ids: string[]) => ledger.nextEvidenceRequests
      .filter((request) => ids.includes(request.id)).map((request) => request.id);
    const requestIdsForActor = (actorToConsult: typeof ledger.nextEvidenceRequests[number]["actorToConsult"]) =>
      ledger.nextEvidenceRequests.filter((request) => request.actorToConsult === actorToConsult)
        .map((request) => request.id);
    const link = (entry: Omit<ReviewActorLink, "optionId" | "generalStatementCoverage">): ReviewActorLink =>
      ({ optionId: ledger.optionId, ...entry, generalStatementCoverage: generalStatementCoverage(entry.actorKey) });
    return [
      ...ledger.selectedPartyDistribution.map((party) => link({
        actorKey: `state:${party.countryIso3}`, actorLabel: party.countryIso3,
        actorKind: "selected_government", relation: "selected_for_comparison",
        sourceUrls: [...(pair.countries.find((country) => country.countryIso3 === party.countryIso3)?.reviewedBrief
          ? [pair.countries.find((country) => country.countryIso3 === party.countryIso3)!.reviewedBrief!.sourceUrl] : []),
          ...issueComparison.datedProjectMilestones.filter((milestone) =>
            originAssertionId != null && milestone.relatedSubmittedAssertionIds.includes(originAssertionId) &&
            milestone.sourceActorKind === "national_government" &&
            milestone.sourceActorCountryIso3 === party.countryIso3).map((milestone) => milestone.sourceUrl)],
        relevantEvidenceRequestIds: requestIdsForActor("competent_governments"),
        reviewStatus: party.optionPositionStatus === "government_joint_project_announcement_permissions_unverified"
          || party.optionPositionStatus === "submitted_concept_origin_no_option_consent"
          || party.optionPositionStatus === "submitted_policy_topic_no_option_consent"
          || party.optionPositionStatus === "submitted_one_sided_policy_proposal_no_counterpart_response"
          ? party.optionPositionStatus : "option_position_unverified",
        inferenceLimit: party.optionPositionStatus === "government_joint_project_announcement_permissions_unverified"
          ? "Government announcements identify a shared project intention, but do not establish its surveyed alignment, binding operating terms, construction permissions, or affected-community approval."
          : "A cited one-sided proposal or policy topic does not establish a current agreement or consent to this specific option; the origin and each party's response require separate review.",
      })),
      ...ledger.thirdPartyContextReview.conditionalFrameworkParties.map((party) => link({
        actorKey: `state:${party.partyIso3}`, actorLabel: party.partyIso3,
        actorKind: "conditional_framework_party", relation: "framework_role_only_if_used",
        sourceUrls: [party.sourceUrl], reviewStatus: "applicability_and_terms_unverified",
        relevantEvidenceRequestIds: requestIds("conditional_framework_applicability", "tripp_framing_and_terms",
          `third_country_distribution_review_${party.partyIso3}`),
        inferenceLimit: "The framework applies only if this option uses it; project terms, legal status, and consent require separate verification.",
      })),
      ...ledger.thirdPartyContextReview.reportedTransitDependencies.map((party) => link({
        actorKey: `state:${party.countryIso3}`, actorLabel: party.countryIso3,
        actorKind: "reported_transit_country", relation: "speaker_report_only",
        sourceUrls: [party.sourceUrl], reviewStatus: "operation_and_terms_unverified",
        relevantEvidenceRequestIds: requestIds("reported_georgia_rail_terms", "existing_transit_baseline"),
        inferenceLimit: "A speaker's route report does not verify current service, transit terms, or this country's option-specific position.",
      })),
      ...(option?.policyReview?.subject === "parallel_disaster_dialogue" && nepalMechanismPosition
        ? [link({
          actorKey: "state:CHN", actorLabel: "China (named in Nepal proposal)",
          actorKind: "named_proposal_party", relation: "speaker_proposed_role",
          sourceUrls: [nepalMechanismPosition.sourceUrl], reviewStatus: "option_position_unverified",
          relevantEvidenceRequestIds: requestIds("named_china_proposal_role"),
          inferenceLimit: "Nepal's submitted proposal names China as a prospective participant. China's position, authority, data terms, and consent have not been established from this selected evidence.",
        })] : []),
      ...ledger.possibleThirdCountryDepictionContacts.map((country) => link({
        actorKey: `map-country:${country.editorialAdm0A3}`, actorLabel: country.name,
        actorKind: "editorial_map_contact_country", relation: "possible_geometry_contact",
        sourceUrls: [country.sourceUrl], reviewStatus: "jurisdiction_and_effect_unassessed",
        relevantEvidenceRequestIds: requestIds(`third_country_contact_verification_${country.editorialAdm0A3}`,
          `third_country_statement_review_${country.editorialAdm0A3}`,
          ...(country.isoA3 ? [`third_country_distribution_review_${country.isoA3}`] : [])),
        inferenceLimit: "A generalized polygon contact is a review pointer, not a legal crossing, jurisdiction, effect, or veto.",
      })),
      ...ledger.naturalSystemScreen.designatedWetlandSites
        .filter((site) => site.relation !== "no_contact_in_published_depiction" &&
          !(ledger.naturalSystemScreen.liveRamsarReview?.status === "available" &&
            ledger.naturalSystemScreen.liveRamsarReview.sites.some((live) => live.siteNumber === site.siteNumber)))
        .map((site) => link({
          actorKey: `ramsar:${site.siteNumber}`, actorLabel: `${site.name} (#${site.siteNumber})`,
          actorKind: "designated_wetland_site",
          relation: site.relation === "intersects_published_depiction" ? "published_boundary_contact" : "missing_boundary_unknown",
          sourceUrls: option?.sourceScreens.designatedWetlandBoundary
            ? [option.sourceScreens.designatedWetlandBoundary.sourceUrl] : [],
          reviewStatus: "ecological_effect_unassessed",
          relevantEvidenceRequestIds: requestIds("designated_wetland_boundary_and_management_review",
            "published_wetland_depiction_contact_review"),
          inferenceLimit: site.relation === "intersects_published_depiction"
            ? "Published boundary contact does not establish current boundary, ecological impact, management rules, or permission."
            : "The source response has no boundary for this site, so route contact and ecological effect are unknown.",
        })),
      ...(ledger.naturalSystemScreen.liveRamsarReview?.status === "available"
        ? ledger.naturalSystemScreen.liveRamsarReview.sites
          .filter((site) => site.relation === "intersects_published_depiction")
          .map((site) => link({
            actorKey: `ramsar:${site.siteNumber}`, actorLabel: `${site.name} (#${site.siteNumber})`,
            actorKind: "designated_wetland_site", relation: "published_boundary_contact",
            sourceUrls: [site.sourceRecordUrl], reviewStatus: "ecological_effect_unassessed",
            relevantEvidenceRequestIds: requestIds("live_ramsar_published_contact_review"),
            inferenceLimit: "Live published site depiction contact does not establish current boundary, ecological impact, management rules, or permission.",
          })) : []),
      ...[...new Map(ledger.naturalSystemScreen.generalizedWaterwayContacts
        .map((contact) => [contact.lineId, contact] as const)).values()].map((contact) => link({
        actorKey: `natural-earth-waterway:${contact.lineId}`, actorLabel: contact.label,
        actorKind: "mapped_waterway_feature", relation: "generalized_line_contact",
        sourceUrls: [contact.sourceRecordUrl], reviewStatus: "hydrological_effect_unassessed",
        relevantEvidenceRequestIds: requestIds("waterway_crossing_review"),
        inferenceLimit: "A generalized river or lake-centerline contact identifies a feature to verify; it does not establish a current crossing, water right, flood risk, navigability, or ecological effect.",
      })),
      ...[...new Map(ledger.naturalSystemScreen.generalizedLakeContacts
        .map((contact) => [contact.lakeFeatureId, contact] as const)).values()].map((contact) => link({
        actorKey: `natural-earth-lake:${contact.lakeFeatureId}`, actorLabel: contact.label,
        actorKind: "mapped_lake_feature", relation: "generalized_polygon_contact",
        sourceUrls: [contact.sourceRecordUrl], reviewStatus: "current_extent_and_effect_unassessed",
        relevantEvidenceRequestIds: requestIds("lake_outline_review"),
        inferenceLimit: "A generalized lake polygon is a feature to verify; it does not establish current shoreline, water conditions, ecological effect, crossing feasibility, or permission.",
      })),
      ...[...new Map(ledger.naturalSystemScreen.terrestrialDepictions.contacts
        .map((contact) => [contact.featureId, contact] as const)).values()].map((contact) => link({
        actorKey: `osm-terrestrial:${contact.featureId}`,
        actorLabel: contact.featureName ?? `${contact.featureKind.replaceAll("_", " ")} ${contact.featureId}`,
        actorKind: "mapped_terrestrial_feature", relation: contact.relation,
        sourceUrls: [contact.sourceRecordUrl], reviewStatus: "current_status_and_effect_unassessed",
        relevantEvidenceRequestIds: requestIds("mapped_terrestrial_depiction_review"),
        inferenceLimit: contact.geometryRole === "closed_way_area"
          ? "This OSM closed way is a mapped depiction to check with authoritative land-cover and protected-area records and affected users; legal status, current conditions, ecological and community effects, and permission remain unverified."
          : "This OSM relation member is only a boundary fragment; the filled multipolygon and any holes are not assembled. Check authoritative area boundaries and affected users before assessing legal status, current conditions, ecological or community effects, or permission.",
      })),
      ...(option?.kind === "documented_dated_interaction" ? [] : ledger.unidentifiedAffectedActors).map((actor) => link({
        actorKey: `class:${actor}`, actorLabel: actor.replaceAll("_", " "),
        actorKind: "unidentified_actor_class", relation: "identify_and_consult",
        sourceUrls: [], reviewStatus: "identity_and_view_unverified",
        relevantEvidenceRequestIds: actor === "families_of_missing" ? requestIdsForActor("affected_families")
          : actor === "infrastructure_owners_and_operators" ? requestIdsForActor("infrastructure_operators")
            : actor === "cross_border_ecosystems" ? requestIdsForActor("environmental_and_engineering_authorities")
              : requestIdsForActor("affected_communities"),
        inferenceLimit: "This is a class to identify and consult for a specific option; its members, views, and consent have not been established.",
      })),
    ];
  });
  const unscopedPlaceholderOptionIds = options.filter((option) =>
    option.kind === "no_build_policy_review" && !option.policyReview).map((option) => option.id);
  const frontierDomains = (["connectivity_policy", "peace_process_policy", "natural_system_policy", "humanitarian_policy", "connectivity_infrastructure"] as const)
    .map((comparisonDomain) => {
      const domainOptions = options.filter((option) => option.comparisonDomain === comparisonDomain &&
        !unscopedPlaceholderOptionIds.includes(option.id));
      if (!domainOptions.length) return null;
      const domainLedgers = optionEvidenceLedgers.filter((ledger) =>
        domainOptions.some((option) => option.id === ledger.optionId));
      return {
        comparisonDomain,
        optionIds: domainOptions.map((option) => option.id),
        status: domainOptions.length < 2 ? "one_option_no_within_domain_comparison" as const
          : "outcomes_and_gates_unverified" as const,
        comparisonBasisQuestion: comparisonDomain === "connectivity_infrastructure"
          ? "Define the same endpoints, service, direction, demand, planning year, and current network baseline before comparing route or mode options."
          : comparisonDomain === "peace_process_policy"
            ? "Define the same process instrument, parties, implementation step, affected populations, observation period, and independent verification baseline before comparing peace-policy alternatives."
          : comparisonDomain === "connectivity_policy"
            ? "Define the same operating service, affected parties, direction, planning year, and documented current terms before comparing policy changes."
            : comparisonDomain === "natural_system_policy"
              ? "Define the same shared basin, ecosystem, hazard, or climate question, affected places, planning year, and observed baselines before comparing policies."
              : "Define the same family-facing process or civilian-safety service, affected groups, planning year, and current practice before comparing humanitarian policies.",
        objectiveCoverage: query.objectives.map((objective) => ({
          objective,
          boundedMappedLengthOptionIds: domainOptions.filter((option) => option.objectiveReadiness.some((readiness) =>
            readiness.objective === objective && readiness.status === "bounded_mapped_length_only")).map((option) => option.id),
          unquantifiedOptionIds: domainOptions.filter((option) => option.objectiveReadiness.some((readiness) =>
            readiness.objective === objective && readiness.status === "not_quantified")).map((option) => option.id),
          notApplicableOptionIds: domainOptions.filter((option) => option.objectiveReadiness.some((readiness) =>
            readiness.objective === objective && readiness.status === "not_applicable_to_option")).map((option) => option.id),
          measurementPlans: domainLedgers.flatMap((ledger) => ledger.objectiveEvidencePlans
            .filter((plan) => plan.objective === objective).map((plan) => ({
              optionId: ledger.optionId, readinessStatus: plan.readinessStatus,
              measurementQuestion: plan.measurementQuestion, actorToConsult: plan.actorToConsult,
              contextSourceUrls: plan.contextSourceUrls,
            }))),
        })),
        openGateIds: [...new Set(domainLedgers.flatMap((ledger) => ledger.gates
          .filter((gate) => gate.status === "unverified").map((gate) => gate.id)))],
      };
    }).filter((domain): domain is NonNullable<typeof domain> => domain !== null);
  const sourceTimeline: z.infer<typeof civilizationScenarioComparisonOutputSchema>["timeFrame"]["sourceTimeline"] = [
    ...pair.countries.flatMap((country) => country.reviewedBrief ? [{
      sourceId: `unga81:${country.countryIso3}:brief:${country.reviewedBrief.revision}`,
      sourceKind: "reviewed_submitted_statement" as const,
      sourceTime: country.reviewedBrief.speechDate,
      sourceTimeMeaning: "submitted statement date; delivery and current position not established",
      sourceUrl: country.reviewedBrief.sourceUrl,
      validityAtPlanningHorizon: "unverified" as const,
    }] : []),
    ...[...governmentRecords, ...dependentGovernmentRecords, ...multilateralGovernmentRecords].map((record) => ({
      sourceId: record.id, sourceKind: "government_record" as const,
      sourceTime: record.statusAsOf,
      sourceTimeMeaning: `recorded legal-stage review as of ${record.statusAsOf}; later status unverified`,
      sourceUrl: record.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...issueComparison.datedNegotiatingConditions.flatMap((record) => record.positions.map((position) => ({
      sourceId: `${record.id}:${position.countryIso3}`,
      sourceKind: "dated_official_negotiating_position" as const,
      sourceTime: position.sourceDate,
      sourceTimeMeaning: "official publication date of one party's negotiating position; current acceptance and treaty sequence unverified",
      sourceUrl: position.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    }))),
    ...datedOperatingReports.map((report) => ({
      sourceId: report.id, sourceKind: "dated_government_operating_report" as const,
      sourceTime: report.reportDate,
      sourceTimeMeaning: "publication date of a government freight-arrival report; recurring service and complete customs verification not established",
      sourceUrl: report.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...issueComparison.datedProjectMilestones.map((milestone) => ({
      sourceId: milestone.id, sourceKind: "dated_government_project_milestone" as const,
      sourceTime: milestone.sourceDate,
      sourceTimeMeaning: milestone.eventKind === "construction_launch_ceremony"
        ? "government-reported launch ceremony; physical progress, completion, service, and permissions remain unverified"
        : milestone.eventKind === "government_joint_project_announcement"
          ? "government-published joint project announcement and projected specifications; surveyed design, completion, service, and permissions remain unverified"
        : "government-reported project discussion; agreement, construction, and service remain unverified",
      sourceUrl: milestone.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...datedOperatingReports.flatMap((report) => report.corroboratingOperationalSources.map((source, index) => ({
      sourceId: `${report.id}:operator:${index}`, sourceKind: "dated_operator_consignment_notice" as const,
      sourceTime: source.reportDate,
      sourceTimeMeaning: "operator notice about this consignment and border crossing; not a waybill, recurring service, or capacity record",
      sourceUrl: source.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    }))),
    ...issueComparison.thirdPartyOperatingContext.map((record) => ({
      sourceId: record.id, sourceKind: "third_party_operator_context" as const,
      sourceTime: record.sourceDate,
      sourceTimeMeaning: `${record.sourceDateMeaning}; applicability to a specific route and planning horizon unverified`,
      sourceUrl: record.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...issueComparison.designatedWetlandContext.map((record) => ({
      sourceId: `ramsar:${record.countryIso3}:country_summary`,
      sourceKind: "designated_wetland_country_inventory" as const,
      sourceTime: record.reviewedAt,
      sourceTimeMeaning: record.geometryStatus === "published_boundary_not_acquired"
        ? "local country-summary review date; no published boundary snapshot acquired for these sites and current management status is unverified"
        : "local country-summary review date; separate Armenia-Azerbaijan pilot geometry snapshot is partial and current management status is unverified",
      sourceUrl: record.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...humanitarianIssueComparison.humanitarianContext.map((record) => ({
      sourceId: record.id, sourceKind: "institutional_humanitarian_context" as const,
      sourceTime: record.publicationDate,
      sourceTimeMeaning: record.kind === "institutional_plan"
        ? "institutional plan publication date; implementation and current status unverified"
        : "dated national program report; current bilateral applicability unverified",
      sourceUrl: record.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...humanitarianIssueComparison.familyContext.map((record) => ({
      sourceId: record.id, sourceKind: "affected_family_report" as const,
      sourceTime: record.publicationDate,
      sourceTimeMeaning: "ICRC publication date; bounded family perspective, not representative or option consent",
      sourceUrl: record.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    })),
    ...pair.thirdPartyPositions.flatMap((position) => position.assertions.slice(0, 1).map((assertion) => ({
      sourceId: `unga81:${position.countryIso3}:third_party`, sourceKind: "third_party_submitted_statement" as const,
      sourceTime: position.speechDate,
      sourceTimeMeaning: "submitted statement date; effect on selected option unassessed",
      sourceUrl: assertion.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    }))),
    ...(tradeResult.status === "available" ? tradeResult.evidence.directions.flatMap((direction) => direction.sourceUrl ? [{
      sourceId: `comtrade:${direction.reporterIso3}:${direction.partnerIso3}:${direction.year}`,
      sourceKind: "observed_goods" as const, sourceTime: String(direction.year),
      sourceTimeMeaning: "reported annual merchandise exports; not a future capacity forecast",
      sourceUrl: direction.sourceUrl, validityAtPlanningHorizon: "unverified" as const,
    }] : []) : []),
    ...(corridorResult.status === "available" ? corridorResult.evidence.sourceLedger.flatMap((source) =>
      source.sourceRecordUrl ? [{
        sourceId: `corridor:${source.sourceId}`,
        sourceKind: "geospatial_source" as const,
        sourceTime: source.sourceTime,
        sourceTimeMeaning: `${source.sourceTimeMeaning}; source validity at evaluation and planning horizon unverified`,
        sourceUrl: source.sourceRecordUrl,
        validityAtPlanningHorizon: "unverified" as const,
      }] : []) : []),
  ];
  const mappedPairContextFacet = issueComparison.facets.find((facet) =>
    facet.comparisonBasis === "pair_specific_editorial_crosswalk" &&
    selectedCountryIso3s.every((countryIso3) => facet.positions.some((position) =>
      position.countryIso3 === countryIso3)));
  const explicitPairMentionIds = new Set([
    ...readReviewedCounterpartReferences(query.firstCountryIso3, query.secondCountryIso3),
    ...readReviewedCounterpartReferences(query.secondCountryIso3, query.firstCountryIso3),
  ].map((reference) => reference.id));
  const explicitPairContextPositions = [...new Map(issueComparison.facets.flatMap((facet) => facet.positions)
    .filter((position) => explicitPairMentionIds.has(position.id))
    .map((position) => [position.id, position] as const)).values()];
  const mappedContextPositions = [...new Map([
    ...(mappedPairContextFacet?.positions ?? []), ...explicitPairContextPositions,
  ].map((position) => [position.id, position] as const)).values()];
  const optionDiscussionBasis = options.map((option) => {
    const conceptOrigin = option.concept?.origin;
    const positions = conceptOrigin?.kind === "reviewed_submitted_assertion"
      ? issueComparison.facets.flatMap((facet) => facet.positions).filter((position) =>
        position.id === conceptOrigin.assertionId && position.countryIso3 === conceptOrigin.countryIso3)
      : option.policyReview?.subject === "missing_persons_and_mine_action" ? humanitarianPositions
        : option.policyReview?.subject === "existing_transit_and_operating_rules" ? reportedAccessAssertions
          : option.policyReview?.subject === "parallel_topic_dialogue" ||
            option.policyReview?.subject === "peace_process_implementation_review" ||
            option.policyReview?.subject === "one_sided_project_scope_dialogue"
            ? issueComparison.facets.flatMap((facet) => facet.positions)
              .filter((position, index, positions) =>
                option.policyReview?.submittedAssertionIds.includes(position.id) &&
                positions.findIndex((candidate) => candidate.id === position.id) === index)
            : option.policyReview?.subject === "access_and_jurisdiction_dialogue" ? accessJurisdictionFacet?.positions ?? []
            : option.policyReview?.subject === "one_sided_named_natural_system_proposal"
              ? naturalSystemIssueComparison.facets.flatMap((facet) => facet.positions)
                .filter((position) => option.policyReview?.submittedAssertionIds.includes(position.id))
            : option.policyReview ? naturalSystemIssueComparison.facets.flatMap((facet) => facet.positions)
                .filter((position, index, positions) =>
                  option.policyReview?.submittedAssertionIds.includes(position.id) &&
                  positions.findIndex((candidate) => candidate.id === position.id) === index)
              : option.kind === "mapped_network_candidate" || option.kind === "caller_supplied_sketch" ||
                  option.kind === "mapped_component_gap_hypothesis"
                ? mappedContextPositions : [];
    const records = conceptOrigin?.kind === "conditional_government_framework"
      ? [{ recordId: conceptOrigin.recordId, sourceUrl: conceptOrigin.sourceUrl,
          role: "conditional_framework_origin_not_project_approval" as const }]
      : option.policyReview?.subject === "missing_persons_and_mine_action" && humanitarianAgreement
        ? [{ recordId: humanitarianAgreement.id, sourceUrl: humanitarianAgreement.sourceUrl,
            role: "policy_question_context_not_permission" as const }]
        : option.policyReview?.subject === "existing_transit_and_operating_rules"
          ? transitGovernmentRecords.map((record) => ({ recordId: record.id, sourceUrl: record.sourceUrl,
              role: "policy_question_context_not_permission" as const })) : [];
    return {
    optionId: option.id,
    status: option.kind === "documented_dated_interaction" ? "dated_observation_only" as const
      : option.kind === "no_build_policy_review" && !option.policyReview ? "unscoped_baseline_placeholder" as const
        : option.policyReview ? "source_grounded_policy_question" as const
          : option.concept ? "cited_unlocated_concept" as const : "mapped_geometry_question" as const,
    rationale: option.kind === "documented_dated_interaction"
      ? "Dated government, operator, or goods records give context for a baseline; this entry is not a future cooperation proposal."
      : option.kind === "no_build_policy_review" && !option.policyReview
        ? "No admitted shared-topic or pair-specific evidence defines a bilateral policy question for this pair; retain a no-build baseline while seeking both parties' interests."
        : option.policyReview?.subject === "missing_persons_and_mine_action"
          ? "Selected submitted positions and a separately scoped initialed Article IX provide a humanitarian question for competent parties and affected families to review."
          : option.policyReview?.subject === "existing_transit_and_operating_rules"
            ? "Cited transit statements and dated records justify checking whether existing service or rules could be improved without construction."
            : option.policyReview?.subject === "one_sided_named_natural_system_proposal"
              ? "One admitted submitted statement proposes a named natural-system fund; the selected counterpart's role, response, current fund status, and outcomes have not been established."
            : option.policyReview?.subject === "one_sided_project_scope_dialogue"
              ? "A cited submitted project claim and separate dated project sources justify asking both competent governments and affected groups about scope and terms; no joint policy change or beneficial outcome is established."
            : option.policyReview?.subject === "access_and_jurisdiction_dialogue"
              ? "Cited but distinct submitted positions justify asking whether any access discussion exists; neither statement defines a common route, counterpart response, legal right, or agreed terms."
            : option.policyReview?.subject === "peace_process_implementation_review"
              ? "Page-cited DRC and Rwanda security accounts and process references justify an independently verifiable peace-implementation question. The allegations are unadjudicated, current compliance and civilian effects are unknown, and no route is proposed or approved."
            : option.policyReview
              ? "Both selected submitted briefs address this topic, supporting a bounded dialogue question while bilateral terms and outcomes remain unknown."
              : option.concept?.origin.kind === "conditional_government_framework"
                ? "A cited conditional framework names a possible infrastructure modality; project designation and the selected counterpart's position are missing."
                : option.concept?.family === "rail_connection"
                  ? "A cited submitted statement describes a named-counterpart railway; its actual status, alignment, and the counterpart's position need separate evidence."
                : option.concept?.family === "pipeline_link" && option.concept.origin.kind === "reviewed_submitted_assertion"
                  ? "A cited submitted statement reports a named-counterpart pipeline construction launch; its actual status, alignment, and the counterpart's position need separate evidence."
                : option.concept
                  ? "A cited submitted assertion names an infrastructure idea; the counterpart's position, alignment, and operating terms are missing."
                  : option.kind === "mapped_component_gap_hypothesis"
                    ? `Two disconnected mapped components suggest a straight-line question for review. The inventory does not establish that construction is needed, agreed, feasible, or beneficial.${positions.length ? " Selected reviewed statements are dialogue context, not support for this gap alignment or evidence of the counterpart's response." : ""}`
                    : mappedPairContextFacet && positions.length
                      ? `A bounded map source or caller sketch defines geometry to investigate. The separate ${mappedPairContextFacet.label.toLowerCase()} comparison supplies cited dialogue context.${positions.some((position) => explicitPairMentionIds.has(position.id)) ? " A separately cited statement names the counterpart; its response and connection to this alignment remain unverified." : ""} Neither speaker has assessed or endorsed this alignment.`
                      : explicitPairContextPositions.length && positions.length
                        ? "A bounded map source or caller sketch defines geometry to investigate. A selected submitted statement explicitly names the counterpart, but its response and any connection to this alignment are unverified."
                      : "A bounded map source or caller sketch defines geometry to investigate; it does not establish a diplomatic proposal or usable service.",
    reviewedPositionBasis: positions.map((position) => ({
      countryIso3: position.countryIso3, assertionId: position.id, sourceUrl: position.sourceUrl,
      sourcePage: position.sourcePage, reviewRevision: position.reviewRevision,
      role: option.concept ? "one_side_concept_origin_not_counterpart_support" as const
        : option.policyReview?.subject === "one_sided_named_natural_system_proposal"
          ? "one_side_policy_proposal_origin_not_counterpart_support" as const
          : option.policyReview?.subject === "one_sided_project_scope_dialogue"
            ? "one_sided_project_statement_not_counterpart_scope_support" as const
          : option.policyReview?.subject === "access_and_jurisdiction_dialogue"
            ? position.id === "eth-maritime-access-diplomacy"
              ? "access_aspiration_not_somalia_specific_offer" as const
              : "general_sovereignty_principle_not_ethiopia_response" as const
          : (option.kind === "mapped_network_candidate" || option.kind === "caller_supplied_sketch" ||
              option.kind === "mapped_component_gap_hypothesis") && explicitPairMentionIds.has(position.id)
            ? "named_counterpart_statement_not_alignment_support" as const
          : "topic_context_not_option_consent" as const,
    })),
    governmentRecordBasis: records,
    basisSourceUrls: [...new Set(option.kind === "documented_dated_interaction" ? option.sourceUrls
      : option.kind === "mapped_network_candidate" ? [...option.sourceScreens.mappedInfrastructure.sourceUrls,
          ...positions.map((position) => position.sourceUrl)]
        : option.kind === "mapped_component_gap_hypothesis" ? [...option.sourceUrls,
          ...positions.map((position) => position.sourceUrl)]
        : [...positions.map((position) => position.sourceUrl), ...records.map((record) => record.sourceUrl)])],
    interpretation: "A discussion basis identifies why to examine or defer an entry; it does not establish consent, feasibility, benefit, or priority over another option." as const,
  };
  });
  return civilizationScenarioComparisonOutputSchema.parse({
    schemaVersion: scenarioSchemaVersion,
    query,
    collectedAt: new Date().toISOString(),
    timeFrame: {
      goodsObservationYear: query.tradeYear,
      corridorEvidenceEvaluatedAt: query.corridor?.route.evaluatedAt ?? null,
      planningHorizonYear: query.planningHorizonYear,
      status: "caller_declared_horizon",
      interpretation: "Trade and map observations are dated evidence; the planning horizon is a question about the future, not a forecast or operating date.",
      sourceTimeline,
    },
    countryPair: pair,
    provisionalPairReviewLeads: readUnga81PairReviewLeads({
      firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
    }),
    corpusCoverage: {
      indexedDelegationPages: corpusCoverage.rosterReconciliation.officialDelegationPageCount,
      delegationPagesWithHashMatchedSelectedBrief: corpusCoverage.positionCoverage.delegationPagesWithHashMatchedSelectedBrief,
      selectedReviewedAssertionCount: corpusCoverage.positionCoverage.selectedReviewedAssertionCount,
      fullSpeechAssertionReviewStatus: corpusCoverage.positionCoverage.fullSpeechAssertionReviewStatus,
      selectedCountries: selectedCountryIso3s.map((countryIso3) => {
        const row = corpusCoverage.rows.find((item) => item.countryIso3 === countryIso3);
        const next = corpusCoverage.reviewQueue.find((item) => item.countryIso3 === countryIso3);
        return {
          countryIso3, officialPageCount: row?.officialPageCount ?? 0,
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
      topicCoverage: corpusCoverage.positionCoverage.topics.map((topic) => ({
        id: topic.id, label: topic.label,
        countriesWithAdmittedSelectedAssertionsCount: topic.countriesWithAdmittedSelectedAssertions.length,
        selectedPairCountriesWithAdmittedAssertions: selectedCountryIso3s.filter((countryIso3) =>
          topic.countriesWithAdmittedSelectedAssertions.some((country) => country.countryIso3 === countryIso3)),
      })),
      interpretation: "Indexed delegations and selective submitted-text assertions do not establish complete national positions, verified delivery, bilateral agreement, or current policy." as const,
    },
    issueComparison,
    naturalSystemIssueComparison,
    humanitarianIssueComparison,
    relationshipNetwork: composeCivilizationRelationshipNetwork({
      firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
      year: query.tradeYear,
    }, pair, tradeResult.status === "available" ? tradeResult.evidence : null),
    trade: tradeResult,
    corridor: corridorResult,
    corridorScalePlan,
    options,
    optionDiscussionBasis,
    optionEvidenceLedgers,
    screenedGeometryComparison,
    optionInteractionReview: {
      status: "conditional_relationships_not_outcome_comparisons",
      links: optionInteractionLinks,
      interpretation: "These links are conditional design questions. They do not establish substitutability, complementarity, shared rights, feasibility, or a preferred option.",
    },
    reviewActorGraph: {
      schemaVersion: "civilization_option_review_actor_graph/v8",
      links: reviewActorLinks,
      interpretation: "Links identify bounded review questions, not legal jurisdiction, ecological impact, a party's consent, or an option's eligibility.",
    },
    frontierReadiness: {
      status: "not_established_outcomes_and_permissions_unverified",
      observationOptionIds: options.filter((option) => option.comparisonDomain === "dated_observation").map((option) => option.id),
      unscopedPlaceholderOptionIds,
      possibilityCoverage: {
        mappedKinds: (["road", "rail", "pipeline", "power", "telecom", "waterway"] as const).map((kind) => ({
          kind,
          returnedInOptionScreens: options.some((option) => option.sourceScreens.mappedInfrastructure.networkKinds.includes(kind)),
          meaning: "A returned kind is bounded OSM geometry only; an absent kind is not ruled out." as const,
        })),
        outsideMappedTopology: [
          { family: "maritime_shipping" as const, currentEvidenceScope: "port_endpoint_leads_only" as const,
            nextEvidenceQuestion: "Identify actual ports, sea service, navigable path, cargo compatibility, capacity, transfer, rights, and current access with operators and competent authorities." },
          { family: "aviation_cargo" as const, currentEvidenceScope: "no_air_service_or_path_reader" as const,
            nextEvidenceQuestion: "Identify actual airports, cargo service, airspace and overflight rights, capacity, transfers, costs, and community effects before comparing an air option." },
          { family: "unbuilt_or_policy_design" as const, currentEvidenceScope: "caller_sketch_and_policy_questions_only" as const,
            nextEvidenceQuestion: "Define a new alignment or policy change and compare its affected parties, permissions, costs, natural effects, and outcomes against the same baseline." },
        ],
        interpretation: "The returned option set and map screens are selective. They cannot exclude other transport, utility, institutional, or no-build possibilities or establish an optimal route." as const,
      },
      domains: frontierDomains,
      interpretation: "Dated observations and unscoped baseline placeholders are not proposals in the option frontier. Options in different domains have different outcome meanings. A bounded mapped length is not a comparable benefit, cost, or impact outcome; unresolved gates and unmeasured distribution prevent ranking or an optimum claim.",
    },
    comparisonStatus: "evidence_incomplete_no_optimum_inferred",
    unresolved: [
      ...pair.missingEvidence,
      ...(issueComparison.datedNegotiatingConditions.length ? ["peace_signature_constitutional_sequence_not_mutually_confirmed"] : []),
      ...(issueComparison.facets.some((facet) => facet.routeEndpointGate === "blocked_pending_delivered_wording_review")
        ? ["submitted_and_provisional_rail_place_names_conflict_delivered_wording_review_required"] : []),
      ...(issueComparison.facets.some((facet) => facet.positions.some((position) =>
        position.id === "aze-tripp-multimodal" && position.provisionalReconciliation.alignment === "wording_discrepancy"))
        ? ["submitted_and_provisional_tripp_corridor_terminology_conflict_delivered_wording_review_required"] : []),
      ...(tradeResult.status === "unavailable" ? ["bilateral_trade_source_unavailable"] : tradeResult.evidence.missingEvidence),
      ...(corridorResult.status === "unavailable" ? ["corridor_evidence_unavailable"]
        : corridorResult.status === "available" ? corridorResult.evidence.unresolved : ["corridor_not_requested"]),
      ...(corridorScalePlan.status === "planned"
        ? ["corridor_scale_plan_contains_no_acquired_source_evidence",
          ...(corridorScalePlan.plan.coverage.unplannedWindowCount ? ["corridor_scale_sketch_partly_unplanned"] : [])]
        : []),
      "No future route option is an approved, feasible, or optimized project; requested objectives lack comparable measured evidence.",
      ...(query.constraints.maximumBudgetUsd != null ? ["project_cost_estimates_missing_for_budget_constraint"] : []),
      ...(dependentGovernmentRecords.some((record) => record.legalStatus === "entry_into_force_unverified")
        ? ["dependent_framework_entry_into_force_unverified"] : []),
    ],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  });
}
