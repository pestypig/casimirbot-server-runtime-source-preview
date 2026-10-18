import { z } from "zod";
import pilotData from "../../assets/civilization/dated-negotiating-conditions-pilot.v1.json";

export const datedNegotiatingConditionSchema = z.object({
  id: z.string(), countries: z.tuple([z.string().regex(/^[A-Z]{3}$/), z.string().regex(/^[A-Z]{3}$/)]),
  issueId: z.literal("peace_agreement_stage"), relatedSubmittedAssertionIds: z.array(z.string()).min(2),
  positions: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/), speaker: z.string(), sourceDate: z.string().date(),
    sourceKind: z.enum(["official_presidential_interview_publication", "official_prime_minister_parliamentary_speech_publication"]),
    sourceUrl: z.string().url(), sourceSection: z.string(), paraphrase: z.string(),
    statedSequence: z.enum(["constitutional_change_before_signature", "domestic_constitutional_agenda_and_signature_priority_no_sequence_stated"]),
    limit: z.string(),
  }).strict()).length(2),
  comparisonStatus: z.literal("dated_asymmetric_precondition_no_current_joint_sequence"),
  interpretation: z.string(), nextQuestion: z.string(),
  legalDetermination: z.literal("not_assessed"), currentMutualAcceptance: z.literal("not_established"),
}).strict();

const pilot = z.object({
  schemaVersion: z.literal("civilization_dated_negotiating_conditions_pilot/v1"),
  records: z.array(datedNegotiatingConditionSchema),
}).strict().parse(pilotData);

export function readPilotDatedNegotiatingConditions(firstCountryIso3: string, secondCountryIso3: string) {
  const selected = [firstCountryIso3, secondCountryIso3].sort().join(":");
  return pilot.records.filter((record) => [...record.countries].sort().join(":") === selected);
}
