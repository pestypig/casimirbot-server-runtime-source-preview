import { z } from "zod";
import { comtradePairOutputSchema, comtradePairQuerySchema, readComtradePair } from "./comtrade-pair";
import { readUnga81PairEvidence, unga81PairEvidenceSchema } from "./unga81-evidence";
import { datedOperatingReportSchema, readPilotDatedOperatingReports } from "./dated-operating-reports";
import { datedProjectMilestoneSchema, readDatedProjectMilestones } from "./dated-project-milestones";
import { readReviewedCounterpartReferences } from "./counterpart-references";

export const civilizationRelationshipNetworkQuerySchema = comtradePairQuerySchema;
const relationshipRecordSchema = z.object({
  id: z.string().min(1), fromIso3: z.string().regex(/^[A-Z]{3}$/),
  toIso3: z.string().regex(/^[A-Z]{3}$/),
  relationKind: z.enum(["bilateral_government_record", "dependent_government_framework", "directional_merchandise_exports"]),
  eventDate: z.string().date().nullable(), measuredYear: z.number().int().nullable(),
  legalStatus: z.string().nullable(), statusAsOf: z.string().date().nullable(), tradeStatus: z.string().nullable(),
  reportedGoodsValueUsd: z.number().nonnegative().nullable(),
  reportedByProvider: z.boolean().nullable(), providerAggregate: z.boolean().nullable(),
  applicability: z.enum(["bilateral_context", "only_if_project_uses_framework", "observed_goods_dimension"]),
  sourceUrls: z.array(z.string().url()),
  sourceSections: z.array(z.string()),
  conditions: z.array(z.string()),
  milestones: z.array(z.object({ date: z.string().date(), kind: z.string(),
    summary: z.string(), sourceUrl: z.string().url() }).strict()),
  reportedMeasures: z.array(z.object({ metric: z.string(), value: z.number().nonnegative(),
    unit: z.string(), qualifier: z.string(), period: z.string(), independentVerification: z.literal("not_verified") }).strict()),
  thirdPartyDependencies: z.array(z.object({ partyIso3: z.string().regex(/^[A-Z]{3}$/).nullable(), role: z.string() }).strict()),
  interpretationLimit: z.string(),
}).strict();

export const civilizationRelationshipNetworkOutputSchema = z.object({
  schemaVersion: z.literal("civilization_diplomatic_relationship_network/v9"),
  query: civilizationRelationshipNetworkQuerySchema,
  collectedAt: z.string().datetime({ offset: true }),
  trade: comtradePairOutputSchema.nullable(),
  nodes: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
    role: z.enum(["selected_country", "related_context"]),
    sourceRelationIds: z.array(z.string()) }).strict()),
  relations: z.array(relationshipRecordSchema),
  statedPairPerspectives: z.array(z.object({
    id: z.string(), fromIso3: z.string().regex(/^[A-Z]{3}$/), toIso3: z.string().regex(/^[A-Z]{3}$/),
    speaker: z.string(), speechDate: z.string().date(), claimType: z.string(), text: z.string(),
    sourceUrl: z.string().url(), sourcePage: z.number().int().positive(),
    reviewRevision: z.number().int().positive(), uncertainty: z.string(),
    sourceKind: z.literal("reviewed_submitted_statement_delivery_unverified"),
    currentRelationEffect: z.literal("unassessed"),
  }).strict()),
  multilateralGovernmentRecords: z.array(z.object({
    id: z.string(), parties: z.array(z.string().regex(/^[A-Z]{3}$/)).min(3), eventDate: z.string().date(),
    legalStatus: z.string(), sourceUrls: z.array(z.string().url()), conditions: z.array(z.string()),
    reportedMeasures: relationshipRecordSchema.shape.reportedMeasures,
    interpretationLimit: z.string(),
  }).strict()),
  reportedTransportEvents: z.array(datedOperatingReportSchema),
  datedProjectMilestones: z.array(datedProjectMilestoneSchema),
  statedThirdPartyPerspectives: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    assertionIds: z.array(z.string()), sourceUrls: z.array(z.string().url()),
    effectOnSelectedPair: z.literal("unassessed"),
  }).strict()),
  reviewBadge: z.object({ emoji: z.literal("🧐"), meaning: z.literal("evidence_review_needed_not_diplomatic_sentiment") }).strict(),
  assessedCooperation: z.literal("unassessed"),
  possibleCooperation: z.literal("not_ranked_without_objectives_and_constraints"),
  missingEvidence: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationRelationshipNetwork = z.infer<typeof civilizationRelationshipNetworkOutputSchema>;

type Pair = z.infer<typeof unga81PairEvidenceSchema>;
type Trade = z.infer<typeof comtradePairOutputSchema>;

function unique(values: string[]): string[] { return [...new Set(values)]; }

export function composeCivilizationRelationshipNetwork(
  query: z.infer<typeof civilizationRelationshipNetworkQuerySchema>, pair: Pair, trade: Trade | null,
): CivilizationRelationshipNetwork {
  const selected = new Set([query.firstCountryIso3, query.secondCountryIso3]);
  const relations: z.infer<typeof relationshipRecordSchema>[] = [];
  const addGovernmentRecord = (record: Pair["bilateralEvidence"]["records"][number], dependent: boolean) => {
    if (record.parties.length !== 2) return;
    relations.push({
      id: record.id, fromIso3: record.parties[0], toIso3: record.parties[1],
      relationKind: dependent ? "dependent_government_framework" : "bilateral_government_record",
      eventDate: record.eventDate, measuredYear: null, legalStatus: record.legalStatus,
      statusAsOf: record.statusAsOf, tradeStatus: null,
      reportedGoodsValueUsd: null, reportedByProvider: null, providerAggregate: null,
      applicability: dependent ? "only_if_project_uses_framework" : "bilateral_context",
      sourceUrls: unique([record.sourceUrl, ...record.corroboratingSources.map((source) => source.sourceUrl),
        ...record.statusEvidenceUrls, ...(record.milestones ?? []).map((milestone) => milestone.sourceUrl)]),
      sourceSections: record.sourceSections,
      conditions: record.conditions, milestones: record.milestones ?? [],
      reportedMeasures: record.reportedMeasures ?? [],
      thirdPartyDependencies: record.thirdPartyDependencies,
      interpretationLimit: record.limits,
    });
  };
  pair.bilateralEvidence.records.forEach((record) => addGovernmentRecord(record, false));
  pair.dependentGovernmentEvidence.records.forEach((record) => addGovernmentRecord(record, true));
  for (const direction of trade?.directions ?? []) {
    relations.push({
      id: `comtrade:${direction.reporterIso3}:${direction.partnerIso3}:${direction.year}`,
      fromIso3: direction.reporterIso3, toIso3: direction.partnerIso3,
      relationKind: "directional_merchandise_exports", eventDate: null, measuredYear: direction.year,
      legalStatus: null, statusAsOf: null, tradeStatus: direction.status,
      reportedGoodsValueUsd: direction.primaryValueUsd,
      reportedByProvider: direction.isReported, providerAggregate: direction.isAggregate,
      applicability: "observed_goods_dimension", sourceUrls: direction.sourceUrl ? [direction.sourceUrl] : [],
      sourceSections: [], conditions: [], milestones: [], reportedMeasures: [], thirdPartyDependencies: [],
      interpretationLimit: "A directional annual goods value does not measure trust, services, transit permissions, or total cooperation; no record is unknown rather than zero.",
    });
  }
  const perspectives = pair.thirdPartyPositions.map((position) => ({
    countryIso3: position.countryIso3,
    assertionIds: position.assertions.map((assertion) => assertion.id),
    sourceUrls: unique(position.assertions.map((assertion) => assertion.sourceUrl)),
    effectOnSelectedPair: "unassessed" as const,
  }));
  const statedPairPerspectives = [
    ...readReviewedCounterpartReferences(query.firstCountryIso3, query.secondCountryIso3),
    ...readReviewedCounterpartReferences(query.secondCountryIso3, query.firstCountryIso3),
  ];
  const reportedTransportEvents = readPilotDatedOperatingReports(query.firstCountryIso3, query.secondCountryIso3);
  const datedProjectMilestones = readDatedProjectMilestones(query.firstCountryIso3, query.secondCountryIso3);
  const multilateralGovernmentRecords = pair.multilateralGovernmentEvidence.records.map((record) => ({
    id: record.id, parties: record.parties, eventDate: record.eventDate, legalStatus: record.legalStatus,
    sourceUrls: unique([record.sourceUrl, ...record.corroboratingSources.map((source) => source.sourceUrl),
      ...record.statusEvidenceUrls]),
    conditions: record.conditions, reportedMeasures: record.reportedMeasures ?? [],
    interpretationLimit: record.limits,
  }));
  const countries = unique([
    ...selected,
    ...relations.flatMap((relation) => [relation.fromIso3, relation.toIso3]),
    ...statedPairPerspectives.flatMap((perspective) => [perspective.fromIso3, perspective.toIso3]),
    ...relations.flatMap((relation) => relation.thirdPartyDependencies.flatMap((dependency) => dependency.partyIso3 ? [dependency.partyIso3] : [])),
    ...multilateralGovernmentRecords.flatMap((record) => record.parties),
    ...reportedTransportEvents.flatMap((event) => [event.reportingCountryIso3,
      event.destinationCountryIso3, ...event.reportedTransitCountryIso3s]),
    ...datedProjectMilestones.flatMap((milestone) =>
      [milestone.projectCountryIso3, milestone.namedCounterpartIso3,
        ...(milestone.sourceActorCountryIso3 ? [milestone.sourceActorCountryIso3] : [])]),
    ...perspectives.map((perspective) => perspective.countryIso3),
  ]).sort();
  return civilizationRelationshipNetworkOutputSchema.parse({
    schemaVersion: "civilization_diplomatic_relationship_network/v9",
    query, collectedAt: new Date().toISOString(), trade,
    nodes: countries.map((countryIso3) => ({ countryIso3,
      role: selected.has(countryIso3) ? "selected_country" : "related_context",
      sourceRelationIds: [...relations.filter((relation) => relation.fromIso3 === countryIso3 || relation.toIso3 === countryIso3 ||
        relation.thirdPartyDependencies.some((dependency) => dependency.partyIso3 === countryIso3)).map((relation) => relation.id),
        ...statedPairPerspectives.filter((perspective) => perspective.fromIso3 === countryIso3 || perspective.toIso3 === countryIso3)
          .map((perspective) => perspective.id),
        ...multilateralGovernmentRecords.filter((record) => record.parties.includes(countryIso3)).map((record) => record.id),
        ...reportedTransportEvents.filter((event) => event.reportingCountryIso3 === countryIso3 ||
          event.destinationCountryIso3 === countryIso3 || event.reportedTransitCountryIso3s.includes(countryIso3))
          .map((event) => event.id),
        ...datedProjectMilestones.filter((milestone) => milestone.projectCountryIso3 === countryIso3 ||
          milestone.namedCounterpartIso3 === countryIso3 ||
          milestone.sourceActorCountryIso3 === countryIso3).map((milestone) => milestone.id)] })),
    relations, statedPairPerspectives, multilateralGovernmentRecords, reportedTransportEvents,
    datedProjectMilestones, statedThirdPartyPerspectives: perspectives,
    reviewBadge: { emoji: "🧐", meaning: "evidence_review_needed_not_diplomatic_sentiment" },
    assessedCooperation: "unassessed", possibleCooperation: "not_ranked_without_objectives_and_constraints",
    missingEvidence: [
      ...pair.missingEvidence,
      ...(trade ? trade.missingEvidence : ["directional_goods_evidence_unavailable"]),
      ...(reportedTransportEvents.length
        ? ["Dated government and operator notices corroborate one freight consignment; they do not establish current recurring service or complete waybill and customs verification."]
        : ["No dated operating event has been reviewed for this pair."]),
      ...(datedProjectMilestones.length
        ? ["Dated project and financing records are separate from completed infrastructure and operating service; alignment, permissions, completion, and effects remain unverified."] : []),
      "Current services, sanctions, customs, transit agreements, operating capacities, and local effects remain unverified or unavailable.",
      "Third-party positions are dated submitted statements; effects on this pair require separate primary evidence.",
      "Directed stated-pair perspectives are selected submitted-statement references, not the counterpart's response, a bilateral agreement, or a sentiment score.",
    ],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  });
}

export async function readCivilizationRelationshipNetwork(input: unknown): Promise<CivilizationRelationshipNetwork> {
  const query = civilizationRelationshipNetworkQuerySchema.parse(input);
  const pair = readUnga81PairEvidence({
    firstCountryIso3: query.firstCountryIso3, secondCountryIso3: query.secondCountryIso3,
  });
  const trade = await readComtradePair(query).catch(() => null);
  return composeCivilizationRelationshipNetwork(query, pair, trade);
}
