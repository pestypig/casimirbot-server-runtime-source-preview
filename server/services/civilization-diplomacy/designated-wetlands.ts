import { z } from "zod";
import reviewedData from "../../assets/civilization/designated-wetlands-reviewed.v2.json";

export const designatedWetlandCountrySchema = z.object({
  countryIso3: z.string().regex(/^[A-Z]{3}$/),
  sourcePublisher: z.literal("Ramsar Sites Information Service"), sourceUrl: z.string().url(),
  reviewedAt: z.string().date(), listedSiteCount: z.number().int().nonnegative(),
  sites: z.array(z.object({ siteNumber: z.number().int().positive(), name: z.string().min(1) }).strict()),
  geometryStatus: z.enum(["published_boundary_snapshot_available", "partial_published_boundary_snapshot_agh_ghol_missing",
    "published_boundary_not_acquired"]),
  managementRulesStatus: z.literal("not_reconciled_to_current_authority"),
  routeRelationStatus: z.literal("not_screened_country_inventory_only"),
  interpretationLimit: z.string().min(1),
}).strict().superRefine((record, context) => {
  if (record.listedSiteCount !== record.sites.length) {
    context.addIssue({ code: "custom", message: "Listed site count must match the reviewed site identifiers." });
  }
});

const reviewedSchema = z.object({
  schemaVersion: z.literal("civilization_designated_wetlands_reviewed/v2"),
  reviewScope: z.string().min(1), records: z.array(designatedWetlandCountrySchema),
}).strict();
const reviewed = reviewedSchema.parse(reviewedData);

export function readDesignatedWetlandContext(firstCountryIso3: string, secondCountryIso3: string) {
  const selected = new Set([firstCountryIso3, secondCountryIso3]);
  return reviewed.records.filter((record) => selected.has(record.countryIso3));
}
