import { z } from "zod";
import pilotData from "../../assets/civilization/humanitarian-context-pilot.v1.json";

export const humanitarianContextRecordSchema = z.object({
  id: z.string(),
  topic: z.enum(["missing_persons", "mine_action"]),
  kind: z.enum(["institutional_plan", "national_program_report"]),
  countryIso3: z.string().regex(/^[A-Z]{3}$/).nullable(),
  publisher: z.string(),
  publicationDate: z.string().date(),
  sourceUrl: z.string().url(),
  sourceSection: z.string(),
  summary: z.string(),
  evidenceStatus: z.enum(["published_plan_implementation_unverified", "dated_national_program_report_not_bilateral"]),
  limits: z.string(),
}).strict();

const pilotSchema = z.object({
  schemaVersion: z.literal("civilization_humanitarian_context_pilot/v1"),
  reviewScope: z.string(),
  records: z.array(humanitarianContextRecordSchema),
}).strict();

const pilot = pilotSchema.parse(pilotData);

export function readPilotHumanitarianContext(firstCountryIso3: string, secondCountryIso3: string) {
  return [firstCountryIso3, secondCountryIso3].sort().join(":") === "ARM:AZE" ? pilot.records : [];
}
