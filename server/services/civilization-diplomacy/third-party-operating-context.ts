import { z } from "zod";
import pilotData from "../../assets/civilization/third-party-operating-context-pilot.v2.json";

export const thirdPartyOperatingContextSchema = z.object({
  id: z.string().min(1), countryIso3: z.literal("GEO"),
  sourcePublisher: z.string().min(1), sourceUrl: z.string().url(),
  sourceLanguage: z.literal("Georgian"), sourceDate: z.string().date(),
  sourceDateMeaning: z.string().min(1),
  kind: z.enum(["published_freight_tariff_listing", "customs_information_exchange_notice",
    "operator_published_adjacent_block_train_notice"]),
  finding: z.string().min(1), applicability: z.enum(["general_operator_context_only",
    "adjacent_georgia_azerbaijan_network_only"]),
  routeSpecificTariffStatus: z.literal("not_extracted_or_verified"),
  permissionStatus: z.literal("not_established"), interpretationLimit: z.string().min(1),
}).strict();

const pilotSchema = z.object({
  schemaVersion: z.literal("civilization_third_party_operating_context_pilot/v2"),
  reviewScope: z.string().min(1), records: z.array(thirdPartyOperatingContextSchema),
}).strict();
const pilot = pilotSchema.parse(pilotData);

export function readPilotThirdPartyOperatingContext(firstCountryIso3: string, secondCountryIso3: string) {
  if ([firstCountryIso3, secondCountryIso3].sort().join(":") !== "ARM:AZE") return [];
  return pilot.records;
}
