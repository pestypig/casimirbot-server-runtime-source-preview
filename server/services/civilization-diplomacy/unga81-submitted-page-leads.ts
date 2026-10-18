import { z } from "zod";
import officialPageData from "../../assets/civilization/unga81-official-pages.json";
import submittedPageLeadData from "../../assets/civilization/unga81-submitted-page-leads.v1.json";
import submittedPdfManifestData from "../../assets/civilization/unga81-submitted-pdf-manifest.v1.json";
import { readUnga81CoverageLedger } from "./unga81-evidence";

const official = officialPageData as unknown as { collectedAt: string; pages: Array<{
  countryIso3: string | null; pageUrl: string; pdfUrls: string[] }> };
const index = submittedPageLeadData as unknown as { generatedAt: string;
  submittedPdfManifestGeneratedAt: string; officialPagesCollectedAt: string;
  entries: Array<{ countryIso3: string; sources: Array<{
    sourceUrl: string; officialPageUrl: string; sourcePdfSha256: string | null;
    pageCount: number | null; extractedTextQuality: string;
    status: "source_or_packet_not_current" | "unreviewed_literal_cue_pages" | "source_available_not_screened";
    filenameLanguageHint: string | null; totalMatchedPassages: number; candidateListTruncated: boolean;
    rankedPages: Array<{ page: number; candidateCount: number; cues: string[] }>;
    additionalCandidatePagesNotShown: number }> }> };
const manifest = submittedPdfManifestData as unknown as { generatedAt: string };
const indexCurrent = index.submittedPdfManifestGeneratedAt === manifest.generatedAt &&
  index.officialPagesCollectedAt === official.collectedAt;
export const unga81SubmittedPageIndexStatus = {
  generatedAt: index.generatedAt,
  status: indexCurrent ? "current" as const : "stale_source_manifest" as const,
};

export const unga81SubmittedPageLeadsQuerySchema = z.object({
  countryIso3: z.string().regex(/^[A-Z]{3}$/),
  batchOffset: z.number().int().min(0).max(1000).default(0),
}).strict();

export const unga81SubmittedPageLeadSetSchema = z.object({
  status: z.enum(["available", "not_indexed", "stale_source_manifest"]),
  sources: z.array(z.object({ sourceUrl: z.string().url(), officialPageUrl: z.string().url(),
    sourcePdfSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    pageCount: z.number().int().positive().nullable(), extractedTextQuality: z.string(),
    status: z.enum(["source_or_packet_not_current", "unreviewed_literal_cue_pages", "source_available_not_screened"]),
    filenameLanguageHint: z.string().nullable(), totalMatchedPassages: z.number().int().nonnegative(),
    candidateListTruncated: z.boolean(), rankedPages: z.array(z.object({
      page: z.number().int().positive(), candidateCount: z.number().int().positive(),
      cues: z.array(z.string()),
    }).strict()).max(8), additionalCandidatePagesNotShown: z.number().int().nonnegative(),
  }).strict()).max(8),
  sourceUseLimit: z.literal("unreviewed_literal_cues_are_page_navigation_not_country_positions_or_priorities"),
}).strict();

export function getUnga81SubmittedPageLeads(countryIso3: string): z.infer<typeof unga81SubmittedPageLeadSetSchema> {
  const row = index.entries.find((entry) => entry.countryIso3 === countryIso3);
  return unga81SubmittedPageLeadSetSchema.parse({
    status: !indexCurrent ? "stale_source_manifest" : row ? "available" : "not_indexed",
    sources: indexCurrent ? row?.sources ?? [] : [],
    sourceUseLimit: "unreviewed_literal_cues_are_page_navigation_not_country_positions_or_priorities",
  });
}

export const unga81SubmittedPageLeadsOutputSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_submitted_page_leads/v2"),
  query: unga81SubmittedPageLeadsQuerySchema,
  source: z.object({ indexGeneratedAt: z.string().datetime({ offset: true }),
    submittedPdfManifestGeneratedAt: z.string(), officialPagesCollectedAt: z.string(),
    indexStatus: z.enum(["current", "stale_source_manifest"]),
    method: z.literal("local_hash_matched_submitted_text_literal_cue_page_navigation") }).strict(),
  officialPageUrls: z.array(z.string().url()),
  selectedReviewedAssertionCount: z.number().int().nonnegative(),
  nextReviewStage: z.string(), nextReviewReason: z.string(),
  pageLeads: unga81SubmittedPageLeadSetSchema,
  nextSubmittedPageQueries: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
    sourceUrl: z.string().url(), page: z.number().int().positive() }).strict()).max(12),
  submittedPageBatchQueue: z.object({
    totalBatchCount: z.number().int().nonnegative(), batchOffset: z.number().int().nonnegative(),
    omittedBeforeCount: z.number().int().nonnegative(), omittedAfterCount: z.number().int().nonnegative(),
    nextBatchOffset: z.number().int().nonnegative().nullable(),
    queries: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
      sourceUrl: z.string().url(), pages: z.array(z.number().int().positive()).min(1).max(6),
      cuePageCount: z.number().int().nonnegative(), sourcePageCount: z.number().int().positive(),
      readerPageLimitReached: z.boolean(),
    }).strict()).max(12),
    interpretation: z.literal("Cue pages are placed first for navigation, but every indexed PDF page up to the reader limit remains in the paged queue. Cue order is not a priority or position assessment."),
  }).strict(),
  interpretation: z.literal("These page cues are unreviewed source-navigation leads, not a national position, a priority, a verified delivered speech, or evidence that uncued pages are irrelevant."),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type Unga81SubmittedPageLeads = z.infer<typeof unga81SubmittedPageLeadsOutputSchema>;

export function readUnga81SubmittedPageLeads(input: unknown): Unga81SubmittedPageLeads {
  const query = unga81SubmittedPageLeadsQuerySchema.parse(input);
  const coverage = readUnga81CoverageLedger();
  const row = coverage.rows.find((item) => item.countryIso3 === query.countryIso3);
  const next = coverage.reviewQueue.find((item) => item.countryIso3 === query.countryIso3);
  const pageLeads = getUnga81SubmittedPageLeads(query.countryIso3);
  const allBatches = pageLeads.sources.flatMap((source) => {
    if (!source.pageCount || !source.sourcePdfSha256 || source.status === "source_or_packet_not_current") return [];
    const limit = Math.min(source.pageCount, 100);
    const cuePages = [...new Set(source.rankedPages.map((lead) => lead.page))]
      .filter((page) => page <= limit);
    const cueSet = new Set(cuePages);
    const orderedPages = [...cuePages, ...Array.from({ length: limit }, (_, index) => index + 1)
      .filter((page) => !cueSet.has(page))];
    const batches = [];
    for (let offset = 0; offset < orderedPages.length; offset += 6) {
      const pages = orderedPages.slice(offset, offset + 6);
      batches.push({ countryIso3: query.countryIso3, sourceUrl: source.sourceUrl, pages,
        cuePageCount: pages.filter((page) => cueSet.has(page)).length,
        sourcePageCount: source.pageCount, readerPageLimitReached: source.pageCount > 100 });
    }
    return batches;
  });
  const pageBatchQueries = allBatches.slice(query.batchOffset, query.batchOffset + 12);
  return unga81SubmittedPageLeadsOutputSchema.parse({
    schemaVersion: "civilization_unga81_submitted_page_leads/v2", query,
    source: { indexGeneratedAt: index.generatedAt,
      submittedPdfManifestGeneratedAt: index.submittedPdfManifestGeneratedAt,
      officialPagesCollectedAt: index.officialPagesCollectedAt,
      indexStatus: indexCurrent ? "current" : "stale_source_manifest",
      method: "local_hash_matched_submitted_text_literal_cue_page_navigation" },
    officialPageUrls: [...new Set(official.pages.filter((page) => page.countryIso3 === query.countryIso3)
      .map((page) => page.pageUrl))],
    selectedReviewedAssertionCount: row?.reviewedAssertionCount ?? 0,
    nextReviewStage: next?.stage ?? "reconcile_affiliation_date",
    nextReviewReason: next?.reason ?? "No indexed review queue row; check the official page and affiliation.",
    pageLeads,
    nextSubmittedPageQueries: pageLeads.sources.flatMap((source) => source.rankedPages.map((lead) => ({
      countryIso3: query.countryIso3, sourceUrl: source.sourceUrl, page: lead.page,
    }))).slice(0, 12),
    submittedPageBatchQueue: { totalBatchCount: allBatches.length, batchOffset: query.batchOffset,
      omittedBeforeCount: Math.min(query.batchOffset, allBatches.length),
      omittedAfterCount: Math.max(0, allBatches.length - query.batchOffset - pageBatchQueries.length),
      nextBatchOffset: query.batchOffset + pageBatchQueries.length < allBatches.length
        ? query.batchOffset + pageBatchQueries.length : null,
      queries: pageBatchQueries,
      interpretation: "Cue pages are placed first for navigation, but every indexed PDF page up to the reader limit remains in the paged queue. Cue order is not a priority or position assessment." },
    interpretation: "These page cues are unreviewed source-navigation leads, not a national position, a priority, a verified delivered speech, or evidence that uncued pages are irrelevant.",
    authority: { assistant_answer: false, terminal_eligible: false,
      execution_permission: false, policy_finality: false },
  });
}
