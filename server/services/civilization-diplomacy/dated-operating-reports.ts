import { z } from "zod";
import pilotData from "../../assets/civilization/dated-operating-reports-pilot.v1.json";

export const datedOperatingReportSchema = z.object({
  id: z.string().min(1), reportDate: z.string().date(),
  reportingCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  sourcePublisher: z.string().min(1), sourceUrl: z.string().url(), sourceLanguage: z.string().min(1),
  eventKind: z.literal("reported_freight_train_arrival"),
  reportedTransitCountryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
  destinationCountryIso3: z.string().regex(/^[A-Z]{3}$/), commodity: z.string().min(1),
  reportedQuantity: z.object({ value: z.number().positive(), unit: z.literal("wagons"),
    qualifier: z.literal("reported_train_load") }).strict(),
  relatedSubmittedAssertionIds: z.array(z.string()).min(1),
  corroboratingOperationalSources: z.array(z.object({
    sourcePublisher: z.string().min(1), sourceUrl: z.string().url(), sourceLanguage: z.string().min(1),
    reportDate: z.string().date(),
    reportedQuantity: z.object({ value: z.number().positive(), unit: z.literal("tonnes"),
      qualifier: z.literal("reported_total_weight") }).strict(),
    reportedMilestone: z.string().min(1),
    verificationScope: z.literal("operator_published_notice_not_waybill_or_customs_record"),
  }).strict()),
  evidenceStatus: z.literal("government_arrival_report_with_operator_consignment_corroboration"),
  currentRecurringServiceStatus: z.literal("not_established"),
  routeGeometryStatus: z.literal("not_supplied"), interpretationLimit: z.string().min(1),
}).strict();

const pilotSchema = z.object({
  schemaVersion: z.literal("civilization_dated_operating_reports_pilot/v1"),
  reviewScope: z.string().min(1), records: z.array(datedOperatingReportSchema),
}).strict();
const pilot = pilotSchema.parse(pilotData);

export function readPilotDatedOperatingReports(firstCountryIso3: string, secondCountryIso3: string) {
  if ([firstCountryIso3, secondCountryIso3].sort().join(":") !== "ARM:AZE") return [];
  return pilot.records;
}
