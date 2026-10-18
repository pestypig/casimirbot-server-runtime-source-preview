import { z } from "zod";
import pilotData from "../../assets/civilization/humanitarian-family-context-pilot.v1.json";

export const humanitarianFamilyContextRecordSchema = z.object({
  id: z.string(),
  countryIso3: z.string().regex(/^[A-Z]{3}$/),
  publisher: z.string(),
  publicationDate: z.string().date(),
  sourceUrl: z.string().url(),
  sourceSection: z.string(),
  evidenceBasis: z.enum(["icrc_report_of_family_requests", "icrc_published_individual_accounts_and_program_report"]),
  boundedPerspective: z.string(),
  possibleNeedForOptionReview: z.string(),
  representativeness: z.string(),
  optionConsentStatus: z.literal("not_obtained"),
}).strict();

const pilotSchema = z.object({
  schemaVersion: z.literal("civilization_humanitarian_family_context_pilot/v1"),
  reviewScope: z.string(),
  records: z.array(humanitarianFamilyContextRecordSchema),
}).strict();

const pilot = pilotSchema.parse(pilotData);

export function readPilotHumanitarianFamilyContext(firstCountryIso3: string, secondCountryIso3: string) {
  return [firstCountryIso3, secondCountryIso3].sort().join(":") === "ARM:AZE" ? pilot.records : [];
}
