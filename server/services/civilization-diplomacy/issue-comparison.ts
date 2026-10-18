import { z } from "zod";
import { plannedJointVentureSchema, readUnga81CountryEvidence, readUnga81PairEvidence, unga81RecordingReviewSchema } from "./unga81-evidence";
import { datedOperatingReportSchema, readPilotDatedOperatingReports } from "./dated-operating-reports";
import { datedProjectMilestoneSchema, readDatedProjectMilestones } from "./dated-project-milestones";
import { thirdPartyOperatingContextSchema, readPilotThirdPartyOperatingContext } from "./third-party-operating-context";
import { designatedWetlandCountrySchema, readDesignatedWetlandContext } from "./designated-wetlands";
import { humanitarianContextRecordSchema, readPilotHumanitarianContext } from "./humanitarian-context";
import { humanitarianFamilyContextRecordSchema, readPilotHumanitarianFamilyContext } from "./family-context";
import { datedNegotiatingConditionSchema, readPilotDatedNegotiatingConditions } from "./dated-negotiating-conditions";
import { reviewedTopicInventory } from "./reviewed-topic-inventory";
import { namedNaturalSystemsByAssertion } from "./named-natural-systems";

export const civilizationIssueComparisonQuerySchema = z.object({
  firstCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  secondCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  issueId: z.enum(["regional_connectivity", "natural_system_cooperation", "humanitarian_cooperation"]),
}).strict().refine((value) => value.firstCountryIso3 !== value.secondCountryIso3);

const assertionSchema = z.object({
  id: z.string(), countryIso3: z.string().regex(/^[A-Z]{3}$/), speaker: z.string(),
  speechDate: z.string(), sourceKind: z.literal("reviewed_submitted_statement_delivery_unverified"),
  sourceLanguage: z.string(),
  sourceUrl: z.string().url(), sourcePage: z.number().int().positive(),
  sourceSha256: z.string(), reviewRevision: z.number().int().positive(),
  claimType: z.string(), text: z.string(), temporalScope: z.string(), uncertainty: z.string(),
  provisionalReconciliation: z.object({
    alignment: z.enum(["topic_consistent", "wording_discrepancy", "not_reconciled"]),
    note: z.string().nullable(), transcriptUrl: z.string().url().nullable(),
    recordingReview: unga81RecordingReviewSchema.nullable(),
    officialMeetingRecordStatus: z.literal("not_reconciled"),
    publishedSpeechCorroboration: z.object({ publisher: z.string(), sourceUrl: z.string().url(),
      publishedDate: z.string().date(), reviewedDate: z.string().date(), finding: z.string(),
      deliveryStatus: z.literal("not_verified_to_recording_or_official_meeting_record") }).strict().nullable(),
  }).strict(),
}).strict();

const issueFacetSchema = z.object({
  id: z.string(), label: z.string(), facetKind: z.enum(["cooperation_topic", "stated_safety_concern", "stated_humanitarian_concern", "stated_trust_concern", "stated_jurisdiction_principle"]),
  comparisonBasis: z.enum(["pair_specific_editorial_crosswalk", "parallel_reviewed_topic_inventory"]),
  comparison: z.enum(["related_public_positions_no_agreement_inferred", "one_sided_reviewed_position", "no_reviewed_position"]),
  positions: z.array(assertionSchema),
  routeEndpointGate: z.enum(["not_applicable", "blocked_pending_delivered_wording_review"]),
  contrast: z.object({
    sharedPublicTopic: z.string().nullable(),
    differenceInSubmittedClaims: z.string().nullable(),
    directTensionStatus: z.enum(["not_identified_in_selected_assertions", "not_assessable_from_selected_coverage",
      "reciprocal_security_allegations_unadjudicated"]),
    framingDifference: z.object({
      status: z.enum(["documented_in_selected_submitted_texts", "not_identified", "not_assessable_from_selected_coverage"]),
      description: z.string().nullable(), evidenceAssertionIds: z.array(z.string()),
      inferenceLimit: z.string(),
    }).strict(),
    evidenceAssertionIds: z.array(z.string()),
    missingCountryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)),
  }).strict(),
  interpretation: z.string(), unansweredQuestion: z.string(),
}).strict();

export const civilizationIssueComparisonOutputSchema = z.object({
  schemaVersion: z.literal("civilization_diplomatic_issue_comparison/v37"),
  query: civilizationIssueComparisonQuerySchema,
  reviewScope: z.literal("selected_assertions_government_and_institutional_context"),
  countries: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/), countryName: z.string().nullable(),
    speaker: z.string().nullable(), speechDate: z.string().nullable(),
    briefStatus: z.enum(["selected_assertions_reviewed", "reviewed_brief_unavailable"]),
    deliveryStatus: z.literal("not_reconciled_to_official_record"),
  }).strict()).length(2),
  facets: z.array(issueFacetSchema),
  namedNaturalSystemReview: z.object({
    status: z.enum(["not_applicable", "named_references_incomplete", "shared_named_reference", "different_named_references"]),
    references: z.array(z.object({
      countryIso3: z.string().regex(/^[A-Z]{3}$/), assertionId: z.string(),
      systemId: z.string(), label: z.string(), sourceUrl: z.string().url(),
    }).strict()),
    sharedSystemIds: z.array(z.string()),
    interpretation: z.string(),
  }).strict(),
  datedOperatingReports: z.array(datedOperatingReportSchema),
  datedProjectMilestones: z.array(datedProjectMilestoneSchema),
  reviewedPositionProjectLinks: z.array(z.object({
    assertionId: z.string(), assertionCountryIso3: z.string().regex(/^[A-Z]{3}$/),
    assertionSourceUrl: z.string().url(), assertionSourcePage: z.number().int().positive(),
    milestoneId: z.string(), milestoneSourceUrl: z.string().url(),
    relation: z.literal("same_named_project_review_question_not_policy_adoption"),
    reviewQuestion: z.string().min(1),
    inferenceLimit: z.literal("A submitted position and a separately dated project source concern the same named project; the source does not establish that the project meets the position, that both governments agree, or that outcomes are beneficial."),
  }).strict()),
  thirdPartyOperatingContext: z.array(thirdPartyOperatingContextSchema),
  designatedWetlandContext: z.array(designatedWetlandCountrySchema),
  humanitarianContext: z.array(humanitarianContextRecordSchema),
  familyContext: z.array(humanitarianFamilyContextRecordSchema),
  datedNegotiatingConditions: z.array(datedNegotiatingConditionSchema),
  governmentRecords: z.array(z.object({
    id: z.string(), scope: z.enum(["selected_bilateral", "dependent_third_party", "joint_multilateral"]),
    parties: z.array(z.string().regex(/^[A-Z]{3}$/)), legalStatus: z.string(),
    eventDate: z.string(), statusAsOf: z.string(), sourceUrl: z.string().url(), sourceSections: z.array(z.string()),
    conditions: z.array(z.string()), limits: z.string(),
    plannedJointVenture: plannedJointVentureSchema.nullable(),
  }).strict()),
  thirdPartyPerspectives: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/), speaker: z.string(), speechDate: z.string(),
    assertions: z.array(z.object({ id: z.string(), text: z.string(), sourceUrl: z.string().url(),
      sourcePage: z.number().int().positive(), reviewRevision: z.number().int().positive() }).strict()),
    relevanceToPair: z.object({
      status: z.enum(["selected_party_reported_transit_via_this_country", "parallel_public_normalization_topics", "regional_statement_only"]),
      selectedPartyAssertionIds: z.array(z.string()), thirdPartyAssertionIds: z.array(z.string()),
      interpretation: z.string(), optionSpecificConsent: z.literal("not_established"),
    }).strict(),
    effectOnOptions: z.literal("unassessed"),
  }).strict()),
  thirdPartyCoverageGaps: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/), triggerAssertionId: z.string(),
    status: z.literal("referenced_neighbor_without_reviewed_position"),
    officialPageUrl: z.string().url().nullable(), linkedSubmittedPdfCount: z.number().int().nonnegative(),
    provisionalTranscriptUrls: z.array(z.string().url()),
    interpretation: z.string(),
  }).strict()),
  unresolved: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();

export type CivilizationIssueComparison = z.infer<typeof civilizationIssueComparisonOutputSchema>;

// Editorial crosswalk of already reviewed assertion IDs. A shared topic is not an agreement.
const pilotFacets = [
  { id: "connectivity_and_transit", label: "Connectivity and transit",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-peace-connectivity", "aze-transit-and-trade"],
    sharedPublicTopic: "Both selected submitted statements address regional connectivity or transit.",
    differenceInSubmittedClaims: "Armenia presents peace and connectivity as a priority; Azerbaijan reports changed goods-transit restrictions and trade. The statements do not specify mutually accepted operating terms.",
    unansweredQuestion: "Which transit services and terms would each government actually accept, and which reported flows are independently documented?" },
  { id: "reported_existing_access", label: "Reported existing access",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-reported-rail-via-georgia", "aze-transit-and-trade"],
    sharedPublicTopic: "Both selected submissions report changed Armenia–Azerbaijan access after the 2025 peace summit.",
    differenceInSubmittedClaims: "Armenia reports railway access to Azerbaijan through Georgia; Azerbaijan reports lifted goods-transit restrictions and bilateral trade. Neither assertion verifies a current rail service, its routing or capacity, or the terms governing goods movement.",
    unansweredQuestion: "Which services actually operate through Georgia or directly, under which current transit and customs terms, and what do operator and customs records show?" },
  { id: "peace_agreement_stage", label: "Peace agreement stage",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-agreement-next-steps", "aze-peace-agreement-status"],
    sharedPublicTopic: "Both selected submitted statements describe an initialed Armenia–Azerbaijan peace text and further legal steps.",
    differenceInSubmittedClaims: "Armenia names signing and ratification as next agenda items; Azerbaijan describes a further step before signing. Neither submission independently verifies the current legal stage or entry into force.",
    unansweredQuestion: "Which text and legal steps do both governments recognize as current, and what remains before entry into force?" },
  { id: "missing_persons", label: "Missing persons and families",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-missing-persons-cooperation", "aze-missing-persons"],
    sharedPublicTopic: "Both submissions call for clarifying the fate of people missing from the conflict.",
    differenceInSubmittedClaims: "Armenia reports an agreement to cooperate with Azerbaijan; Azerbaijan frames the need in terms of victims' and families' rights, accountability, and reconciliation. Neither statement independently verifies a shared process or resolves individual cases.",
    unansweredQuestion: "What jointly accepted records, mechanism, safeguards, and family-led consultation could advance clarification of missing persons on both sides?" },
  { id: "railway_links", label: "Railway links",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-rail-sections"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "What is Azerbaijan's explicit position on each proposed rail section, and what do current engineering and operating records show?" },
  { id: "energy_and_pipeline_links", label: "Energy and pipeline links",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-pipelines-power-roads", "aze-energy-connectivity"],
    sharedPublicTopic: "Both submissions discuss energy connectivity within broader regional development.",
    differenceInSubmittedClaims: "Armenia says pipelines and power lines are under discussion within TRIPP; Azerbaijan describes existing gas supply, renewable investment, and prospective green-electricity exports without identifying an Armenia–Azerbaijan line. Neither submission establishes a shared project.",
    unansweredQuestion: "Which pipeline or power connection, if any, has explicit support from both parties, a defined alignment, operating terms, environmental review, and project permissions?" },
  { id: "road_connections", label: "Road connections",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-pipelines-power-roads"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "Which road connection, crossing operation, and customs terms, if any, would both governments accept, and what land, traffic, and community evidence is available?" },
  { id: "third_party_development_framework", label: "Third-party development framework",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-tripp-framework", "aze-tripp-multimodal"],
    sharedPublicTopic: "Both submissions discuss TRIPP as a possible regional connectivity path.",
    differenceInSubmittedClaims: "Armenia describes a development framework with the United States and future legal steps; Azerbaijan expects multimodal access between its main territory and Nakhchivan and uses its own corridor terminology. These are different aspects of a proposed path, not agreed implementation terms.",
    unansweredQuestion: "Which framework terms, route terminology, modalities, jurisdictional safeguards, and operating rules would each party accept, and what separate agreement would Azerbaijan require?" },
  { id: "development_company_governance", label: "Planned development-company governance",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-tripp-planned-ownership"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "Were the framework's entry-into-force steps, TDC Charter, and Shareholders' Agreement completed? Who would own, finance, govern, and bear risk for a specific project, and what would Azerbaijan and affected communities accept?" },
  { id: "digital_connectivity", label: "Digital connectivity",
    facetKind: "cooperation_topic",
    assertionIds: ["aze-digital-silk-way"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "Does either party propose a specific bilateral fiber link or a connection to Azerbaijan's stated Caspian digital program? The separate Armenia–U.S. framework is conditional context, not a UNGA bilateral agreement." },
  { id: "landmine_safety_concern", label: "Mine action and civilian safety",
    facetKind: "stated_safety_concern",
    assertionIds: ["arm-demining-cooperation", "aze-landmines"],
    sharedPublicTopic: "Both submissions address mine action as a humanitarian and safety concern.",
    differenceInSubmittedClaims: "Armenia offers to continue and deepen demining cooperation; Azerbaijan emphasizes contamination, civilian harm, and mine action as a rights priority. The submitted statements do not establish a joint operational plan, locations, or clearance outcomes.",
    unansweredQuestion: "What jointly agreed demining scope, current survey data, clearance standards, specialist operators, and affected-community safeguards would be needed? Does any specified alignment overlap a surveyed hazard?" },
  { id: "detainee_return", label: "Detainee return concern",
    facetKind: "stated_humanitarian_concern",
    assertionIds: ["arm-detainee-return-concern"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "What are the verified individual cases, applicable legal and humanitarian processes, and the wishes and rights of those affected? Azerbaijan's position is not established by this selected crosswalk." },
  { id: "conflict_rhetoric", label: "Conflict rhetoric and trust",
    facetKind: "stated_trust_concern",
    assertionIds: ["arm-conflict-rhetoric-concern"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "Which specific public statements concern each party and affected communities, and what communication commitments could reduce distrust without restricting legitimate expression?" },
  { id: "neighbor_normalization", label: "Neighbor relationships",
    facetKind: "cooperation_topic",
    assertionIds: ["arm-neighbor-normalization"],
    sharedPublicTopic: null, differenceInSubmittedClaims: null,
    unansweredQuestion: "How would a proposed option interact with Türkiye's, Georgia's, and Iran's independently stated interests and current legal or operating roles? Armenia's statement alone cannot answer for them." },
] as const;

const humanitarianFacetIds = new Set([
  "peace_agreement_stage", "missing_persons", "landmine_safety_concern", "detainee_return", "conflict_rhetoric",
]);
const sharedConnectivityFacetIds = new Set(["peace_agreement_stage", "landmine_safety_concern"]);

export function readCivilizationIssueComparison(input: unknown): CivilizationIssueComparison {
  const query = civilizationIssueComparisonQuerySchema.parse(input);
  const pair = readUnga81PairEvidence({
    firstCountryIso3: query.firstCountryIso3,
    secondCountryIso3: query.secondCountryIso3,
  });
  const pilot = [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "ARM:AZE";
  const iranView = pilot && query.issueId === "regional_connectivity"
    ? readUnga81CountryEvidence({ countryIso3: "IRN" }) : null;
  const iranPdfLinkCount = iranView?.submittedStatements.flatMap((statement) => statement.pdfUrls).length ?? 0;
  const iranNamedByArmenia = pair.countries.some((country) => country.countryIso3 === "ARM" &&
    country.reviewedBrief?.assertions.some((assertion) => assertion.id === "arm-neighbor-normalization"));
  const countries = pair.countries.map((country) => ({
    countryIso3: country.countryIso3, countryName: country.countryName,
    speaker: country.reviewedBrief?.speaker ?? null, speechDate: country.reviewedBrief?.speechDate ?? null,
    briefStatus: country.reviewedBrief ? "selected_assertions_reviewed" as const : "reviewed_brief_unavailable" as const,
    deliveryStatus: "not_reconciled_to_official_record" as const,
  }));
  const selectedFacets = query.issueId === "humanitarian_cooperation"
    ? pilotFacets.filter((facet) => humanitarianFacetIds.has(facet.id))
    : pilotFacets.filter((facet) => !humanitarianFacetIds.has(facet.id) || sharedConnectivityFacetIds.has(facet.id));
  const positionsFor = (assertionIds: readonly string[]) => pair.countries.flatMap((country) => {
      const brief = country.reviewedBrief;
      if (!brief) return [];
      return brief.assertions.filter((assertion) => assertionIds.includes(assertion.id))
        .map((assertion) => {
          const reconciliation = country.reconciliation?.assertions.find((item) => item.assertionId === assertion.id);
          return {
            id: assertion.id, countryIso3: country.countryIso3, speaker: brief.speaker,
            speechDate: brief.speechDate, sourceKind: "reviewed_submitted_statement_delivery_unverified" as const,
            sourceLanguage: brief.sourceLanguage,
            sourceUrl: assertion.sourceUrl, sourcePage: assertion.sourcePage,
            sourceSha256: brief.sourceSha256, reviewRevision: brief.revision,
            claimType: assertion.claimType, text: assertion.text, temporalScope: assertion.temporalScope,
            uncertainty: assertion.uncertainty,
            provisionalReconciliation: {
              alignment: reconciliation?.alignment ?? "not_reconciled" as const,
              note: reconciliation?.note ?? null,
              transcriptUrl: country.reconciliation?.provisionalTranscriptUrl ?? null,
              recordingReview: country.reconciliation?.recordingReview ?? null,
              officialMeetingRecordStatus: "not_reconciled" as const,
              publishedSpeechCorroboration: reconciliation?.publishedSpeechCorroboration ?? null,
            },
          };
        });
    });
  const facets = pilot && query.issueId !== "natural_system_cooperation" ? selectedFacets.map((facet) => {
    const positions = positionsFor(facet.assertionIds);
    const coveredCountries = new Set(positions.map((position) => position.countryIso3));
    const missingCountryIso3s = pair.countries.map((country) => country.countryIso3)
      .filter((countryIso3) => !coveredCountries.has(countryIso3));
    const comparison = coveredCountries.size === 2 ? "related_public_positions_no_agreement_inferred" as const
      : coveredCountries.size === 1 ? "one_sided_reviewed_position" as const : "no_reviewed_position" as const;
    return {
      id: facet.id, label: facet.label, facetKind: facet.facetKind,
      comparisonBasis: "pair_specific_editorial_crosswalk" as const, comparison, positions,
      routeEndpointGate: facet.id === "railway_links" && positions.some((position) =>
        position.countryIso3 === "ARM" && position.provisionalReconciliation.officialMeetingRecordStatus === "not_reconciled")
        ? "blocked_pending_delivered_wording_review" as const : "not_applicable" as const,
      contrast: {
        sharedPublicTopic: coveredCountries.size === 2 ? facet.sharedPublicTopic : null,
        differenceInSubmittedClaims: coveredCountries.size === 2 ? facet.differenceInSubmittedClaims : null,
        directTensionStatus: coveredCountries.size === 2
          ? "not_identified_in_selected_assertions" as const : "not_assessable_from_selected_coverage" as const,
        framingDifference: coveredCountries.size !== 2 ? {
          status: "not_assessable_from_selected_coverage" as const, description: null, evidenceAssertionIds: [],
          inferenceLimit: "Both parties' selected positions are needed before comparing their framing.",
        } : facet.id === "third_party_development_framework" ? {
          status: "documented_in_selected_submitted_texts" as const,
          description: "Armenia frames TRIPP through a United States development framework and future legal steps; Azerbaijan frames it as expected multimodal access to Nakhchivan and uses a corridor label in its submitted text.",
          evidenceAssertionIds: positions.map((position) => position.id),
          inferenceLimit: "This is a difference in emphasis and terminology in submitted texts. It does not establish a legal contradiction, delivered wording, mutual acceptance of a label, route permission, or agreed operating terms.",
        } : {
          status: "not_identified" as const, description: null, evidenceAssertionIds: [],
          inferenceLimit: "No framing difference was coded for this selected facet; broader positions remain unreviewed.",
        },
        evidenceAssertionIds: positions.map((position) => position.id),
        missingCountryIso3s,
      },
      interpretation: comparison === "related_public_positions_no_agreement_inferred"
        ? "Both reviewed submissions address this topic. Their terms, current validity, and mutual acceptance are not established."
        : comparison === "one_sided_reviewed_position"
          ? "Only one selected reviewed submission addresses this facet. Silence in the other brief is unknown, not opposition."
          : "No source-checked assertion has been mapped to this facet for this pair.",
      unansweredQuestion: facet.unansweredQuestion,
    };
  }) : reviewedTopicInventory.filter((topic) => topic.issueId === query.issueId)
    .flatMap((topic) => {
      const positions = positionsFor(topic.assertionIds);
      if (!positions.length) return [];
      const coveredCountries = new Set(positions.map((position) => position.countryIso3));
      const missingCountryIso3s = pair.countries.map((country) => country.countryIso3)
        .filter((countryIso3) => !coveredCountries.has(countryIso3));
      const indiaNepalDisasterEvidence = [
        { countryIso3: "IND", id: "ind-nepal-disaster-response" },
        { countryIso3: "NPL", id: "npl-india-china-flood-aid" },
        { countryIso3: "NPL", id: "npl-himalayan-resilience-mechanism" },
        { countryIso3: "NPL", id: "npl-cross-border-early-warning" },
      ] as const;
      const indiaNepalDisasterCrosswalk = topic.id === "disaster_response_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "IND:NPL" &&
        coveredCountries.size === 2 && indiaNepalDisasterEvidence.every((required) =>
          positions.some((position) => position.countryIso3 === required.countryIso3 && position.id === required.id));
      const ethiopiaSomaliaAccessCrosswalk = topic.id === "access_sovereignty_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "ETH:SOM" &&
        positions.some((position) => position.countryIso3 === "ETH" && position.id === "eth-maritime-access-diplomacy") &&
        positions.some((position) => position.countryIso3 === "SOM" && position.id === "som-sovereignty-dialogue");
      const djiboutiEritreaDialogueCrosswalk = topic.id === "regional_security_and_dialogue_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "DJI:ERI" &&
        positions.some((position) => position.countryIso3 === "DJI" && position.id === "dji-eritrea-border-dialogue") &&
        positions.some((position) => position.countryIso3 === "ERI" && position.id === "eri-regional-mutual-respect") &&
        positions.some((position) => position.countryIso3 === "ERI" && position.id === "eri-horn-red-sea-security");
      const rwandaCongoSecurityCrosswalk = topic.id === "regional_security_and_dialogue_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "COD:RWA" &&
        positions.some((position) => position.countryIso3 === "COD" && position.id === "cod-rwanda-afc-m23-aggression-allegation") &&
        positions.some((position) => position.countryIso3 === "COD" && position.id === "cod-fdlr-disarmament-and-repatriation-account") &&
        positions.some((position) => position.countryIso3 === "RWA" && position.id === "rwa-eastern-drc-security-claim") &&
        positions.some((position) => position.countryIso3 === "RWA" && position.id === "rwa-washington-doha-process-support");
      const indonesiaPhilippinesResilienceCrosswalk = topic.id === "food_energy_resilience_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "IDN:PHL" &&
        positions.some((position) => position.countryIso3 === "IDN" && position.id === "idn-food-energy-resilience") &&
        positions.some((position) => position.countryIso3 === "PHL" && position.id === "phl-maritime-energy-exposure");
      const kenyaTanzaniaFinanceCrosswalk = topic.id === "development_finance_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "KEN:TZA" &&
        positions.some((position) => position.countryIso3 === "KEN" && position.id === "ken-cross-border-infrastructure-finance") &&
        positions.some((position) => position.countryIso3 === "TZA" && position.id === "tza-development-finance-priority");
      const burundiTanzaniaFinanceCrosswalk = topic.id === "development_finance_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "BDI:TZA" &&
        positions.some((position) => position.countryIso3 === "BDI" && position.id === "bdi-affordable-development-finance-request") &&
        positions.some((position) => position.countryIso3 === "TZA" && position.id === "tza-development-finance-priority");
      const congoZambiaIndustryCrosswalk = topic.id === "regional_industry_value_capture_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "COD:ZMB" &&
        positions.some((position) => position.countryIso3 === "COD" && position.id === "cod-lobito-regional-industry-condition") &&
        positions.some((position) => position.countryIso3 === "ZMB" && position.id === "zmb-value-add-investment-priority");
      const egyptEthiopiaWaterCrosswalk = topic.id === "natural_system_topic" &&
        [query.firstCountryIso3, query.secondCountryIso3].sort().join(":") === "EGY:ETH" &&
        positions.some((position) => position.countryIso3 === "EGY" && position.id === "egy-nile-water-security-framing") &&
        positions.some((position) => position.countryIso3 === "EGY" && position.id === "egy-shared-water-binding-agreement-request") &&
        positions.some((position) => position.countryIso3 === "ETH" && position.id === "eth-gerd-shared-waters-framing");
      return [{
        id: topic.id, label: topic.label,
        facetKind: topic.id === "access_sovereignty_topic" ? "stated_jurisdiction_principle" as const : "cooperation_topic" as const,
        comparisonBasis: indiaNepalDisasterCrosswalk || ethiopiaSomaliaAccessCrosswalk ||
          djiboutiEritreaDialogueCrosswalk || rwandaCongoSecurityCrosswalk || indonesiaPhilippinesResilienceCrosswalk ||
          kenyaTanzaniaFinanceCrosswalk || burundiTanzaniaFinanceCrosswalk ||
          congoZambiaIndustryCrosswalk || egyptEthiopiaWaterCrosswalk ? "pair_specific_editorial_crosswalk" as const
          : "parallel_reviewed_topic_inventory" as const,
        comparison: coveredCountries.size === 2 ? "related_public_positions_no_agreement_inferred" as const
          : "one_sided_reviewed_position" as const,
        positions, routeEndpointGate: "not_applicable" as const,
        contrast: {
          sharedPublicTopic: ethiopiaSomaliaAccessCrosswalk || djiboutiEritreaDialogueCrosswalk ? null : rwandaCongoSecurityCrosswalk
            ? "Both submitted statements discuss eastern DRC security and refer to Washington and Doha diplomacy; the status and implementation of those processes need independent review."
            : indonesiaPhilippinesResilienceCrosswalk
            ? "Both selected statements discuss national energy resilience, from domestic security and maritime exposure respectively."
            : congoZambiaIndustryCrosswalk
            ? "Both selected statements favor more local industrial value from African resources."
            : kenyaTanzaniaFinanceCrosswalk
            ? "Both selected statements ask for improved access to development finance for productive investment."
            : burundiTanzaniaFinanceCrosswalk
            ? "Both selected statements ask for more accessible development finance, in different institutional and national scopes."
            : egyptEthiopiaWaterCrosswalk
            ? "Both selected statements discuss development and shared-water concerns, but from different stated starting points."
            : indiaNepalDisasterCrosswalk
            ? "Both submitted statements describe Indian assistance after Nepal's floods."
            : coveredCountries.size === 2
              ? `Both selected submitted statements independently address ${topic.label.toLowerCase()}.` : null,
          differenceInSubmittedClaims: rwandaCongoSecurityCrosswalk
            ? "The DRC speaker alleges Rwanda-backed aggression through AFC/M23 and reports FDLR disarmament measures; the Rwanda speaker alleges an FDLR cross-border threat and DRC-supported militias. Both express support for diplomacy, but their accounts and requests differ. The submissions do not adjudicate either allegation or show a direct exchange."
            : djiboutiEritreaDialogueCrosswalk
            ? "Djibouti explicitly invites Eritrea to negotiate a stated border dispute and prisoner concern. Eritrea's selected submission calls generally for mutual respect and regional security but does not name Djibouti, the disputed area, prisoners, or the invitation. The texts are different in scope, not a direct exchange or established disagreement."
            : congoZambiaIndustryCrosswalk
            ? "The DRC names the Lobito Corridor and argues it should support regional industry rather than only faster raw-mineral export. Zambia calls for value-adding investment and technology transfer but its selected statement does not name Lobito or respond to the DRC's corridor condition."
            : kenyaTanzaniaFinanceCrosswalk
            ? "Kenya emphasizes fair risk pricing, guarantees, and long-term local-currency finance for viable cross-border infrastructure. Tanzania emphasizes concessional, development, and climate finance and private investment amid high borrowing costs and debt burdens. Neither statement proposes financing a named joint project with the other."
            : burundiTanzaniaFinanceCrosswalk
            ? "Burundi's president, also speaking as African Union chairperson, calls for reform of the international financial architecture and predictable, affordable finance for developing countries. Tanzania asks for concessional, development, and climate finance and private investment for its development plans. Burundi's selected submission does not name Tanzania's railway or offer to finance it."
            : indonesiaPhilippinesResilienceCrosswalk
            ? "Indonesia describes food self-sufficiency and energy security as national resilience priorities. The Philippines warns that distant maritime disruption could cause an energy emergency. The statements identify complementary questions about supply and exposure, but neither names a shared bilateral service or a joint response."
            : egyptEthiopiaWaterCrosswalk
            ? "Egypt names Nile water security and requests binding treatment of shared resources; Ethiopia describes the GERD as clean-energy development and says shared waters could support regional development. These passages do not directly answer each other or specify a common operating proposal."
            : ethiopiaSomaliaAccessCrosswalk
            ? "Ethiopia describes a diplomatic aspiration for reliable sea access without a named route or partner; Somalia states a general sovereignty and dialogue principle without naming Ethiopia. These are different scopes, not an identified direct exchange or established disagreement."
            : indiaNepalDisasterCrosswalk
            ? "India reports responding to Nepal's floods; Nepal thanks India and China for assistance and separately proposes a Nepal–India–China Himalayan resilience mechanism and cross-border early warning. India's selected statement does not address that proposed mechanism. The two speech accounts do not provide operational delivery records or establish acceptance of a future arrangement."
            : null,
          directTensionStatus: rwandaCongoSecurityCrosswalk
            ? "reciprocal_security_allegations_unadjudicated" as const
            : indiaNepalDisasterCrosswalk || kenyaTanzaniaFinanceCrosswalk ||
            burundiTanzaniaFinanceCrosswalk || congoZambiaIndustryCrosswalk || egyptEthiopiaWaterCrosswalk
            ? "not_identified_in_selected_assertions" as const : "not_assessable_from_selected_coverage" as const,
          framingDifference: rwandaCongoSecurityCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "The DRC speaker emphasizes alleged Rwandan aggression, withdrawal, FDLR measures, and verified implementation; the Rwanda speaker emphasizes an alleged FDLR threat, political roots, and support for the named diplomatic processes.",
            evidenceAssertionIds: ["cod-rwanda-afc-m23-aggression-allegation", "cod-fdlr-disarmament-and-repatriation-account",
              "cod-independent-peace-verification-request", "rwa-eastern-drc-security-claim",
              "rwa-burundi-drc-militia-allegation", "rwa-washington-doha-process-support"],
            inferenceLimit: "These are attributed submitted-statement framings, not adjudicated facts, verified delivered replies to each other, current treaty compliance, civilian consent, or proof that a trade or infrastructure option is viable.",
          } : egyptEthiopiaWaterCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "Egypt frames shared water through water security and negotiated, binding rights; Ethiopia frames the GERD and shared waters through clean energy and regional development.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "The selected speeches do not establish a shared operating proposal, actual hydrological effect, legal allocation, direct response, agreement, or opposition. Only Egypt explicitly names the Nile in the admitted assertion crosswalk; any project-to-river identity needs independent source review.",
          } : congoZambiaIndustryCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "The DRC frames local value capture as a condition for what Lobito should become; Zambia states a national value-add investment ambition without addressing that named corridor.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "Neither Zambia's support or opposition to the DRC's condition nor a common industrial plan, route, finance, worker protection, ecological review, or measurable benefit follows from these selected texts.",
          } : kenyaTanzaniaFinanceCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "Kenya frames the financing barrier around risk pricing and instrument design for infrastructure; Tanzania frames it around concessional access, debt pressure, and development and climate finance.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "The submitted statements do not establish a shared project, compatible debt or grant terms, lender offer, measured gains, ecological limits, or either government's response to the other.",
          } : burundiTanzaniaFinanceCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "The Burundi statement frames affordable finance as an African and developing-country institutional reform request; Tanzania describes finance and investment barriers to its national plans.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "Neither passage proposes bilateral rail finance, accepts a particular project, specifies debt or grant terms, measures gains, or speaks for affected communities. The Burundi speaker's African Union role must remain visible.",
          } : indonesiaPhilippinesResilienceCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "Indonesia frames resilience around domestic capacity and potential contribution; the Philippines emphasizes exposure to maritime disruption.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "The speeches do not assess a common supply chain, bilateral energy flow, agreed maritime service, infrastructure option, or either country's current response to the other.",
          } : djiboutiEritreaDialogueCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "Djibouti names a bilateral border-dialogue request; Eritrea speaks about regional principles and security without addressing that request.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "No Eritrean acceptance, rejection, legal border finding, prisoner status, present negotiation, or option-specific consent can be inferred from the selected speech."
          } : ethiopiaSomaliaAccessCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "One submission raises an access aspiration; the other states a general territorial principle. The texts do not address a common route or each other by name.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "No direct tension, consent, transit right, border claim, corridor alignment, or current government response can be inferred from this juxtaposition.",
          } : indiaNepalDisasterCrosswalk ? {
            status: "documented_in_selected_submitted_texts" as const,
            description: "The selected India text reports past disaster response; Nepal also proposes future shared monitoring and warning. This is a difference in scope, not a demonstrated disagreement.",
            evidenceAssertionIds: positions.map((position) => position.id),
            inferenceLimit: "Past assistance reports do not verify delivery, and silence on Nepal's proposal does not imply India's rejection or consent.",
          } : {
            status: "not_assessable_from_selected_coverage" as const,
            description: null, evidenceAssertionIds: [],
            inferenceLimit: "These assertions were grouped by topic, not reviewed as a pair-specific difference in framing.",
          },
          evidenceAssertionIds: positions.map((position) => position.id), missingCountryIso3s,
        },
        interpretation: rwandaCongoSecurityCrosswalk
          ? "The cited accounts create a concrete diplomatic verification agenda. Independent security, agreement-status, implementation, humanitarian, and affected-community evidence is required before assessing any cooperation or route proposal."
          : egyptEthiopiaWaterCrosswalk
          ? "The cited framing difference supports asking each competent government about a specifically defined water-and-energy question, current observations, applicable arrangements, and affected communities. It does not establish agreement, conflict, legal rights, or an infrastructure operation."
          : congoZambiaIndustryCrosswalk
          ? "The cited contrast supports asking both governments whether a specific corridor and value-chain proposal serves their stated aims. It does not establish joint terms, investment, route operation, or consent."
          : kenyaTanzaniaFinanceCrosswalk
          ? "The cited contrast supports a question about possible project-finance terms. It does not establish a bilateral financing initiative, accepted risk allocation, committed capital, or a viable infrastructure option."
          : burundiTanzaniaFinanceCrosswalk
          ? "The cited contrast supports asking which financing terms each competent government would consider for a specified service or project. It does not establish Burundi's response to Tanzania's railway account, joint finance, operation, or consent."
          : indonesiaPhilippinesResilienceCrosswalk
          ? "The cited comparison can frame a resilience inquiry. It does not establish an existing bilateral energy relation, mutual proposal, joint maritime operation, or feasible infrastructure option."
          : djiboutiEritreaDialogueCrosswalk
          ? "The pair-specific crosswalk makes the missing direct response visible. General regional language does not resolve Djibouti's attributed bilateral claim or establish Eritrea's current position on it."
          : ethiopiaSomaliaAccessCrosswalk
          ? "This cited juxtaposition identifies a question for competent authorities. It is not evidence of bilateral negotiation, agreement, opposition, or a project-specific Somali position."
          : indiaNepalDisasterCrosswalk
          ? "This selected pair-specific crosswalk distinguishes mutually described past assistance from Nepal's one-sided future proposal. Neither current operation nor agreement is established."
          : coveredCountries.size === 2
          ? "These are independently stated public topics. Bilateral relevance, agreement, tension, and current positions have not been assessed."
          : "Only one selected reviewed brief addresses this topic. The other brief's silence is unknown, not opposition.",
        unansweredQuestion: rwandaCongoSecurityCrosswalk
          ? "Which claims, obligations, and implementation steps do both competent governments recognize, what can independent monitors verify, and what safeguards do affected communities require before discussing a specific trade or infrastructure option?"
          : egyptEthiopiaWaterCrosswalk
          ? "What defined water and energy operation are the governments discussing, what current hydrology and engineering evidence applies, and what legal, ecological, community, and downstream effects would each assess?"
          : burundiTanzaniaFinanceCrosswalk
          ? "If the governments define a shared service or project, what current cost, debt, grant, risk, public-benefit, ecological, and community evidence would each require before discussing finance?"
          : topic.nextQuestion,
      }];
    });
  const namedReferences = query.issueId === "natural_system_cooperation"
    ? [...new Map(facets.flatMap((facet) => facet.positions)
      .map((position) => [position.id, position] as const)).values()]
      .flatMap((position) => (namedNaturalSystemsByAssertion[position.id] ?? []).map((system) => ({
        countryIso3: position.countryIso3, assertionId: position.id,
        systemId: system.systemId, label: system.label, sourceUrl: position.sourceUrl,
      }))) : [];
  const firstNamedSystems = new Set(namedReferences.filter((reference) =>
    reference.countryIso3 === query.firstCountryIso3).map((reference) => reference.systemId));
  const secondNamedSystems = new Set(namedReferences.filter((reference) =>
    reference.countryIso3 === query.secondCountryIso3).map((reference) => reference.systemId));
  const sharedSystemIds = [...firstNamedSystems].filter((systemId) => secondNamedSystems.has(systemId));
  const namedNaturalSystemReview = {
    status: query.issueId !== "natural_system_cooperation" ? "not_applicable" as const
      : !firstNamedSystems.size || !secondNamedSystems.size ? "named_references_incomplete" as const
      : sharedSystemIds.length ? "shared_named_reference" as const : "different_named_references" as const,
    references: namedReferences, sharedSystemIds,
    interpretation: query.issueId !== "natural_system_cooperation"
      ? "Named natural-system comparison is outside this selected issue."
      : !firstNamedSystems.size || !secondNamedSystems.size
        ? "The selected reviewed assertions do not name a mapped natural system for both countries; absence of a name is not evidence of no shared system."
        : sharedSystemIds.length
          ? "Both selected reviewed submissions name at least one same natural system. Shared wording alone does not establish the same site, water rights, current conditions, a joint proposal, or agreement."
          : "The selected reviewed submissions name different natural systems. Other shared watersheds or ecological links remain unassessed; a common topic is not a common basin.",
  };
  const governmentRecords = ([
    ...pair.bilateralEvidence.records.map((record) => ({ record, scope: "selected_bilateral" as const })),
    ...pair.dependentGovernmentEvidence.records.map((record) => ({ record, scope: "dependent_third_party" as const })),
    ...pair.multilateralGovernmentEvidence.records.map((record) => ({ record, scope: "joint_multilateral" as const })),
  ]).filter(({ record }) => query.issueId === "regional_connectivity" ||
    query.issueId === "humanitarian_cooperation" && record.id === "arm-aze-2025-initialed-peace-text").map(({ record, scope }) => ({
    id: record.id, scope, parties: record.parties, legalStatus: record.legalStatus,
    eventDate: record.eventDate, statusAsOf: record.statusAsOf, sourceUrl: record.sourceUrl,
    sourceSections: record.sourceSections,
    conditions: record.conditions, limits: record.limits,
    plannedJointVenture: record.plannedJointVenture ?? null,
  }));
  const datedProjectMilestones = query.issueId === "regional_connectivity"
    ? readDatedProjectMilestones(query.firstCountryIso3, query.secondCountryIso3) : [];
  const positionsById = new Map(facets.flatMap((facet) => facet.positions)
    .map((position) => [position.id, position] as const));
  const reviewedPositionProjectLinks = datedProjectMilestones.flatMap((milestone) =>
    milestone.relatedSubmittedAssertionIds.flatMap((assertionId) => {
      const position = positionsById.get(assertionId);
      return position ? [{
        assertionId, assertionCountryIso3: position.countryIso3,
        assertionSourceUrl: position.sourceUrl, assertionSourcePage: position.sourcePage,
        milestoneId: milestone.id, milestoneSourceUrl: milestone.sourceUrl,
        relation: "same_named_project_review_question_not_policy_adoption" as const,
        reviewQuestion: milestone.reviewQuestion,
        inferenceLimit: "A submitted position and a separately dated project source concern the same named project; the source does not establish that the project meets the position, that both governments agree, or that outcomes are beneficial." as const,
      }] : [];
    }));
  return civilizationIssueComparisonOutputSchema.parse({
    schemaVersion: "civilization_diplomatic_issue_comparison/v37", query,
    reviewScope: "selected_assertions_government_and_institutional_context",
    countries, facets, namedNaturalSystemReview,
    datedOperatingReports: query.issueId === "regional_connectivity"
      ? readPilotDatedOperatingReports(query.firstCountryIso3, query.secondCountryIso3) : [],
    datedProjectMilestones, reviewedPositionProjectLinks,
    thirdPartyOperatingContext: query.issueId === "regional_connectivity"
      ? readPilotThirdPartyOperatingContext(query.firstCountryIso3, query.secondCountryIso3) : [],
    designatedWetlandContext: query.issueId === "natural_system_cooperation" || query.issueId === "regional_connectivity"
      ? readDesignatedWetlandContext(query.firstCountryIso3, query.secondCountryIso3) : [],
    humanitarianContext: query.issueId === "humanitarian_cooperation"
      ? readPilotHumanitarianContext(query.firstCountryIso3, query.secondCountryIso3) : [],
    familyContext: query.issueId === "humanitarian_cooperation"
      ? readPilotHumanitarianFamilyContext(query.firstCountryIso3, query.secondCountryIso3) : [],
    datedNegotiatingConditions: query.issueId === "natural_system_cooperation" ? []
      : readPilotDatedNegotiatingConditions(query.firstCountryIso3, query.secondCountryIso3),
    governmentRecords,
    thirdPartyPerspectives: (query.issueId === "regional_connectivity" ? pair.thirdPartyPositions : []).map((position) => {
      const selectedIds = new Set(pair.countries.flatMap((country) => country.reviewedBrief?.assertions.map((assertion) => assertion.id) ?? []));
      const thirdIds = new Set(position.assertions.map((assertion) => assertion.id));
      const georgiaTransit = pilot && position.countryIso3 === "GEO" && selectedIds.has("arm-reported-rail-via-georgia");
      const turkiyeNormalization = pilot && position.countryIso3 === "TUR" &&
        selectedIds.has("arm-neighbor-normalization") && thirdIds.has("tur-arm-normalization");
      return {
        countryIso3: position.countryIso3, speaker: position.speaker, speechDate: position.speechDate,
        assertions: position.assertions.map(({ id, text, sourceUrl, sourcePage, reviewRevision }) =>
          ({ id, text, sourceUrl, sourcePage, reviewRevision })),
        relevanceToPair: georgiaTransit ? {
          status: "selected_party_reported_transit_via_this_country" as const,
          selectedPartyAssertionIds: ["arm-reported-rail-via-georgia"],
          thirdPartyAssertionIds: position.assertions.map((assertion) => assertion.id),
          interpretation: "Armenia reports a rail connection through Georgia. Georgia's submitted regional and transport priorities provide context, not confirmation of that service, its terms, or Georgia's response to a proposed change.",
          optionSpecificConsent: "not_established" as const,
        } : turkiyeNormalization ? {
          status: "parallel_public_normalization_topics" as const,
          selectedPartyAssertionIds: ["arm-neighbor-normalization"],
          thirdPartyAssertionIds: ["tur-arm-normalization"],
          interpretation: "Armenia and Türkiye separately discuss normalization. These submitted statements do not establish completed border arrangements, a particular transit option, or Türkiye's permission.",
          optionSpecificConsent: "not_established" as const,
        } : {
          status: "regional_statement_only" as const,
          selectedPartyAssertionIds: [], thirdPartyAssertionIds: position.assertions.map((assertion) => assertion.id),
          interpretation: "Regional public context only; relevance, effects, and any option-specific position require separate review.",
          optionSpecificConsent: "not_established" as const,
        },
        effectOnOptions: "unassessed" as const,
      };
    }),
    thirdPartyCoverageGaps: iranView && iranNamedByArmenia && !iranView.reviewedBrief ? [{
      countryIso3: "IRN", triggerAssertionId: "arm-neighbor-normalization",
      status: "referenced_neighbor_without_reviewed_position" as const,
      officialPageUrl: iranView.submittedStatements[0]?.pageUrl ?? null,
      linkedSubmittedPdfCount: iranPdfLinkCount,
      provisionalTranscriptUrls: [...new Set(iranView.segments.map((segment) => segment.sourceUrl))],
      interpretation: iranPdfLinkCount === 0
        ? "Armenia names Iran as an important neighbor. The indexed Iranian General Debate page has no linked submitted PDF in this snapshot, and no source-checked Iranian brief exists. Provisional transcripts are unreviewed; Iran's position on this option is unknown."
        : "Armenia names Iran as an important neighbor. A submitted PDF is linked, but no source-checked Iranian brief exists. Provisional transcripts are unreviewed; Iran's position on this option is unknown.",
    }] : [],
    unresolved: [
      "Submitted statements are not reconciled to delivered official records; a dated speaker claim is not a population-wide position.",
      "Shared topic mentions do not establish negotiated agreement or current policy.",
      ...(pilot ? ["Separate dated Armenian and Azerbaijani statements leave the sequence of constitutional action, peace-agreement signature, ratification, and entry into force unresolved."] : []),
      ...(query.issueId === "regional_connectivity" ? [
        ...(iranView && iranNamedByArmenia && !iranView.reviewedBrief ? [iranPdfLinkCount === 0
          ? "Iran is named by Armenia as a neighbor, but no source-checked Iranian UNGA81 position is available; the indexed official page had no linked submitted PDF."
          : "Iran is named by Armenia as a neighbor, but its linked submitted PDF has no source-checked brief yet."] : []),
        ...(pilot ? ["The Azerbaijan submitted-PDF TRIPP terminology differs from the provisional automated transcript; exact delivered wording requires recording or official-meeting-record review."] : []),
        "Current treaty status, permissions, operating services, capacity, financing, and affected-community views require independent dated evidence.",
        ...(pilot ? ["Georgian Railway's general tariff and customs information sources require route-specific term and current-operation review; they do not establish Georgia's consent."] : []),
        ...(pilot ? ["Ramsar country inventories identify designated wetlands; a partial published boundary snapshot supports bounded geometry screening, but current management rules, ecological effects, and any final alignment require competent-authority review."] : []),
        "Geographic contacts and Google basemap display do not establish legal jurisdiction, consent, or engineering feasibility.",
      ] : query.issueId === "natural_system_cooperation" ? [
        "Most selected water, climate, and ecosystem assertions are parallel public statements. The limited India–Nepal disaster crosswalk compares two submitted reports and a one-sided proposal; neither form establishes an agreement, shared-resource finding, or operating project.",
        "For water options identify the actual basin, rights, hydrological observations, seasonal variability, and affected communities; for climate options define a common question, each place's baseline, finance terms, and affected communities.",
        "Generalized map contact and country-level wetland designation do not establish ecological effect, water allocation, or legal authority.",
      ] : [
        "Current treaty status, separate missing-persons modalities, individual case outcomes, and affected-family views require independent dated evidence.",
        ...(pilot ? ["Article IX of the published initialed peace text leaves missing-persons modalities for a separate agreement. ICMP's 2026 program describes planned support; national mine-action reports do not establish bilateral implementation or affected-family consent."] : []),
        ...(pilot ? ["ICRC reporting contains bounded family requests and individual accounts, not representative family views or consent to any proposed bilateral process."] : []),
        "Mine-action statements and national programs do not locate hazards, establish joint clearance operations, or determine community effects.",
      ]),
      ...(!pilot ? ["Non-pilot facets are parallel reviewed-topic inventories, not pair-specific issue crosswalks. Bilateral relevance, agreement, tension, and positions beyond the selective briefs remain unassessed."] : []),
      ...pair.missingEvidence,
    ],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  });
}
