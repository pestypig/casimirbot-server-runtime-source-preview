import { createHash } from "node:crypto";
import { z } from "zod";
import officialPageData from "../../assets/civilization/unga81-official-pages.json";
import pdfManifestData from "../../assets/civilization/unga81-submitted-pdf-manifest.v1.json";

const MAX_PDF_BYTES = 25_000_000;
const MAX_TEXT_CHARS = 6_000;
const officialPages = officialPageData as unknown as { pages: Array<{
  countryIso3: string | null; date: string | null; pageUrl: string; pdfUrls: string[] }> };
const manifest = pdfManifestData as unknown as { generatedAt: string; entries: Array<{
  sourceUrl: string; status: string; pdfSha256: string | null; pdfBytes: number | null;
  pageCount: number | null }> };

export const unga81SubmittedPageQuerySchema = z.object({
  countryIso3: z.string().regex(/^[A-Z]{3}$/),
  sourceUrl: z.string().url(),
  page: z.number().int().min(1).max(100),
}).strict();
export type Unga81SubmittedPageQuery = z.infer<typeof unga81SubmittedPageQuerySchema>;

const sourceSchema = z.object({
  officialPageUrl: z.string().url(), sourceUrl: z.string().url(), sourcePageUrl: z.string().url(),
  officialPageDate: z.string().date().nullable(), manifestGeneratedAt: z.string(),
  expectedPdfSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  checkedAt: z.string().datetime({ offset: true }), fetchedAt: z.string().datetime({ offset: true }).nullable(),
  filenameLanguageHint: z.string().nullable(), translationRelation: z.literal("unverified"),
}).strict();
const baseSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_submitted_page/v1"),
  query: unga81SubmittedPageQuerySchema,
  source: sourceSchema,
  submittedTextStatus: z.literal("hash_matched_pdf_unreviewed_page"),
  speakerAndDeliveryStatus: z.literal("not_verified_to_recording_or_official_meeting_record"),
  factualClaimsStatus: z.literal("speaker_attribution_only_not_independently_verified"),
  positionStatus: z.literal("source_page_for_review_not_curated_country_position"),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
});
export const unga81SubmittedPageOutputSchema = z.discriminatedUnion("status", [
  baseSchema.extend({ status: z.literal("available"), pageCount: z.number().int().positive(),
    text: z.string().min(1), extractedPageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    textTruncated: z.boolean(), missingEvidence: z.array(z.string()) }).strict(),
  baseSchema.omit({ submittedTextStatus: true }).extend({ status: z.literal("unavailable"),
    errorCode: z.enum(["source_not_admitted", "source_unavailable", "source_http_error", "source_hash_changed", "source_size_invalid",
      "page_out_of_bounds", "text_not_extractable", "pdf_invalid"]),
    missingEvidence: z.array(z.string()) }).strict(),
]);
export type Unga81SubmittedPage = z.infer<typeof unga81SubmittedPageOutputSchema>;

export const unga81SubmittedPageBatchQuerySchema = z.object({
  countryIso3: z.string().regex(/^[A-Z]{3}$/), sourceUrl: z.string().url(),
  pages: z.array(z.number().int().min(1).max(100)).min(1).max(6),
}).strict().refine((query) => new Set(query.pages).size === query.pages.length,
  "Page numbers must be unique.");
export const unga81SubmittedPageBatchOutputSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_submitted_page_batch/v1"),
  query: unga81SubmittedPageBatchQuerySchema,
  source: sourceSchema.omit({ sourcePageUrl: true }),
  sourceStatus: z.enum(["hash_matched_pdf", "unavailable"]),
  pageCount: z.number().int().positive().nullable(),
  pages: z.array(z.discriminatedUnion("status", [
    z.object({ page: z.number().int().positive(), sourcePageUrl: z.string().url(), status: z.literal("available"),
      text: z.string().min(1), extractedPageSha256: z.string().regex(/^[a-f0-9]{64}$/),
      textTruncated: z.boolean(), missingEvidence: z.array(z.string()) }).strict(),
    z.object({ page: z.number().int().positive(), sourcePageUrl: z.string().url(), status: z.literal("unavailable"),
      errorCode: z.enum(["source_not_admitted", "source_unavailable", "source_http_error", "source_hash_changed",
        "source_size_invalid", "page_out_of_bounds", "text_not_extractable", "pdf_invalid"]),
      missingEvidence: z.array(z.string()) }).strict(),
  ])).min(1).max(6),
  speakerAndDeliveryStatus: z.literal("not_verified_to_recording_or_official_meeting_record"),
  factualClaimsStatus: z.literal("speaker_attribution_only_not_independently_verified"),
  positionStatus: z.literal("source_pages_for_review_not_curated_country_positions"),
  interpretation: z.literal("Hash-matched submitted PDF pages are unreviewed source wording; inspect full pages, speaker, language, date, and delivery before admitting any national-position assertion."),
  authority: baseSchema.shape.authority,
}).strict();
export type Unga81SubmittedPageBatch = z.infer<typeof unga81SubmittedPageBatchOutputSchema>;

export async function readUnga81SubmittedPageBatch(input: unknown, fetcher: typeof fetch = fetch): Promise<Unga81SubmittedPageBatch> {
  const query = unga81SubmittedPageBatchQuerySchema.parse(input);
  const official = officialPages.pages.find((page) => page.countryIso3 === query.countryIso3 &&
    page.pdfUrls.includes(query.sourceUrl));
  if (!official) throw new Error("submitted_pdf_not_linked_to_country_official_page");
  const acquired = manifest.entries.find((entry) => entry.sourceUrl === query.sourceUrl);
  const source: z.infer<typeof sourceSchema> = {
    officialPageUrl: official.pageUrl, sourceUrl: query.sourceUrl,
    sourcePageUrl: `${query.sourceUrl}#page=${query.pages[0]}`, officialPageDate: official.date,
    manifestGeneratedAt: manifest.generatedAt,
    expectedPdfSha256: acquired?.pdfSha256 && /^[a-f0-9]{64}$/.test(acquired.pdfSha256)
      ? acquired.pdfSha256 : null,
    checkedAt: new Date().toISOString(), fetchedAt: null,
    filenameLanguageHint: /_([a-z]{2})(?:_\d+)?\.pdf(?:\?.*)?$/i.exec(query.sourceUrl)?.[1]?.toLowerCase() ?? null,
    translationRelation: "unverified",
  };
  const sharedSource = () => {
    const { sourcePageUrl: _perPageUrl, ...rest } = source;
    return rest;
  };
  const unavailablePages = (errorCode: Extract<Unga81SubmittedPage, { status: "unavailable" }>["errorCode"],
    pageCount: number | null = null) => unga81SubmittedPageBatchOutputSchema.parse({
      schemaVersion: "civilization_unga81_submitted_page_batch/v1", query, source: sharedSource(),
      sourceStatus: "unavailable", pageCount,
      pages: query.pages.map((page) => ({ page, sourcePageUrl: `${query.sourceUrl}#page=${page}`,
        status: "unavailable", errorCode,
        missingEvidence: ["submitted_page_text_not_available", "source_claim_review_pending",
          "speech_delivery_and_translation_unverified"] })),
      speakerAndDeliveryStatus: "not_verified_to_recording_or_official_meeting_record",
      factualClaimsStatus: "speaker_attribution_only_not_independently_verified",
      positionStatus: "source_pages_for_review_not_curated_country_positions",
      interpretation: "Hash-matched submitted PDF pages are unreviewed source wording; inspect full pages, speaker, language, date, and delivery before admitting any national-position assertion.",
      authority: { assistant_answer: false, terminal_eligible: false,
        execution_permission: false, policy_finality: false },
    });
  if (acquired?.status !== "available" || !source.expectedPdfSha256 ||
      !acquired.pdfBytes || !acquired.pageCount) return unavailablePages("source_not_admitted");
  if (acquired.pdfBytes > MAX_PDF_BYTES) return unavailablePages("source_size_invalid");
  let response: Response;
  try { response = await fetcher(query.sourceUrl, { headers: { Accept: "application/pdf" }, signal: AbortSignal.timeout(25_000) }); }
  catch { return unavailablePages("source_unavailable"); }
  if (!response.ok) return unavailablePages("source_http_error");
  if (!response.body) return unavailablePages("source_unavailable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) { await reader.cancel(); return unavailablePages("source_size_invalid"); }
      chunks.push(value);
    }
  } catch { return unavailablePages("source_unavailable"); }
  const bytes = Buffer.concat(chunks);
  source.fetchedAt = new Date().toISOString();
  if (bytes.length !== acquired.pdfBytes) return unavailablePages("source_size_invalid");
  if (createHash("sha256").update(bytes).digest("hex") !== acquired.pdfSha256) return unavailablePages("source_hash_changed");
  try {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
      getDocument: (source: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<{
        numPages: number; getPage: (page: number) => Promise<{ getTextContent: () => Promise<{
          items: Array<{ str?: string; hasEOL?: boolean }> }> }>;
        cleanup: () => Promise<void> | void;
      }> };
    };
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
    try {
      if (document.numPages !== acquired.pageCount) return unavailablePages("pdf_invalid");
      const pages = [];
      for (const pageNumber of query.pages) {
        if (pageNumber > document.numPages) {
          pages.push({ page: pageNumber, sourcePageUrl: `${query.sourceUrl}#page=${pageNumber}`,
            status: "unavailable", errorCode: "page_out_of_bounds",
            missingEvidence: ["requested_page_exceeds_verified_pdf_page_count"] });
          continue;
        }
        try {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          const fullText = content.items.map((item) => typeof item.str === "string"
            ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("")
            .replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          if (!fullText) {
            pages.push({ page: pageNumber, sourcePageUrl: `${query.sourceUrl}#page=${pageNumber}`,
              status: "unavailable", errorCode: "text_not_extractable",
              missingEvidence: ["page_text_not_extractable", "visual_or_ocr_review_needed"] });
            continue;
          }
          pages.push({ page: pageNumber, sourcePageUrl: `${query.sourceUrl}#page=${pageNumber}`,
            status: "available", text: fullText.slice(0, MAX_TEXT_CHARS),
            extractedPageSha256: createHash("sha256").update(fullText).digest("hex"),
            textTruncated: fullText.length > MAX_TEXT_CHARS,
            missingEvidence: ["page_text_not_curated_or_reconciled_to_delivery",
              "speaker_identity_and_translation_relation_unverified", "source_claim_review_pending"] });
        } catch {
          pages.push({ page: pageNumber, sourcePageUrl: `${query.sourceUrl}#page=${pageNumber}`,
            status: "unavailable", errorCode: "pdf_invalid",
            missingEvidence: ["page_extraction_failed", "visual_or_ocr_review_needed"] });
        }
      }
      return unga81SubmittedPageBatchOutputSchema.parse({
        schemaVersion: "civilization_unga81_submitted_page_batch/v1", query, source: sharedSource(),
        sourceStatus: "hash_matched_pdf", pageCount: document.numPages, pages,
        speakerAndDeliveryStatus: "not_verified_to_recording_or_official_meeting_record",
        factualClaimsStatus: "speaker_attribution_only_not_independently_verified",
        positionStatus: "source_pages_for_review_not_curated_country_positions",
        interpretation: "Hash-matched submitted PDF pages are unreviewed source wording; inspect full pages, speaker, language, date, and delivery before admitting any national-position assertion.",
        authority: { assistant_answer: false, terminal_eligible: false,
          execution_permission: false, policy_finality: false },
      });
    } finally { await document.cleanup(); }
  } catch { return unavailablePages("pdf_invalid"); }
}

export async function readUnga81SubmittedPage(input: unknown, fetcher: typeof fetch = fetch): Promise<Unga81SubmittedPage> {
  const query = unga81SubmittedPageQuerySchema.parse(input);
  const official = officialPages.pages.find((page) => page.countryIso3 === query.countryIso3 &&
    page.pdfUrls.includes(query.sourceUrl));
  const acquired = manifest.entries.find((entry) => entry.sourceUrl === query.sourceUrl);
  if (!official) throw new Error("submitted_pdf_not_linked_to_country_official_page");
  const source: z.infer<typeof sourceSchema> = {
    officialPageUrl: official.pageUrl, sourceUrl: query.sourceUrl,
    sourcePageUrl: `${query.sourceUrl}#page=${query.page}`, officialPageDate: official.date,
    manifestGeneratedAt: manifest.generatedAt,
    expectedPdfSha256: acquired?.pdfSha256 && /^[a-f0-9]{64}$/.test(acquired.pdfSha256)
      ? acquired.pdfSha256 : null,
    checkedAt: new Date().toISOString(), fetchedAt: null,
    filenameLanguageHint: /_([a-z]{2})(?:_\d+)?\.pdf(?:\?.*)?$/i.exec(query.sourceUrl)?.[1]?.toLowerCase() ?? null,
    translationRelation: "unverified" as const,
  };
  const common = { schemaVersion: "civilization_unga81_submitted_page/v1" as const,
    query, source, speakerAndDeliveryStatus: "not_verified_to_recording_or_official_meeting_record" as const,
    factualClaimsStatus: "speaker_attribution_only_not_independently_verified" as const,
    positionStatus: "source_page_for_review_not_curated_country_position" as const,
    authority: { assistant_answer: false as const, terminal_eligible: false as const,
      execution_permission: false as const, policy_finality: false as const } };
  const unavailable = (errorCode: Extract<Unga81SubmittedPage, { status: "unavailable" }>["errorCode"]) =>
    unga81SubmittedPageOutputSchema.parse({ ...common, status: "unavailable", errorCode,
      missingEvidence: ["submitted_page_text_not_available", "source_claim_review_pending",
        "speech_delivery_and_translation_unverified"] });
  if (acquired?.status !== "available" || !source.expectedPdfSha256 ||
      !acquired.pdfBytes || !acquired.pageCount) return unavailable("source_not_admitted");
  if (query.page > acquired.pageCount) return unavailable("page_out_of_bounds");
  if (acquired.pdfBytes > MAX_PDF_BYTES) return unavailable("source_size_invalid");
  let response: Response;
  try { response = await fetcher(query.sourceUrl, { headers: { Accept: "application/pdf" }, signal: AbortSignal.timeout(25_000) }); }
  catch { return unavailable("source_unavailable"); }
  if (!response.ok) return unavailable("source_http_error");
  if (!response.body) return unavailable("source_unavailable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) { await reader.cancel(); return unavailable("source_size_invalid"); }
      chunks.push(value);
    }
  } catch { return unavailable("source_unavailable"); }
  const bytes = Buffer.concat(chunks);
  source.fetchedAt = new Date().toISOString();
  if (bytes.length !== acquired.pdfBytes) return unavailable("source_size_invalid");
  if (createHash("sha256").update(bytes).digest("hex") !== acquired.pdfSha256) return unavailable("source_hash_changed");
  try {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
      getDocument: (source: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<{
        numPages: number; getPage: (page: number) => Promise<{ getTextContent: () => Promise<{
          items: Array<{ str?: string; hasEOL?: boolean }> }> }>;
        cleanup: () => Promise<void> | void;
      }> };
    };
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
    try {
      if (document.numPages !== acquired.pageCount) return unavailable("pdf_invalid");
      if (query.page > document.numPages) return unavailable("page_out_of_bounds");
      const page = await document.getPage(query.page);
      const content = await page.getTextContent();
      const fullText = content.items.map((item) => typeof item.str === "string"
        ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("")
        .replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!fullText) return unavailable("text_not_extractable");
      return unga81SubmittedPageOutputSchema.parse({ ...common, status: "available",
        submittedTextStatus: "hash_matched_pdf_unreviewed_page", pageCount: document.numPages,
        text: fullText.slice(0, MAX_TEXT_CHARS),
        extractedPageSha256: createHash("sha256").update(fullText).digest("hex"),
        textTruncated: fullText.length > MAX_TEXT_CHARS,
        missingEvidence: ["page_text_not_curated_or_reconciled_to_delivery",
          "speaker_identity_and_translation_relation_unverified", "source_claim_review_pending"] });
    } finally { await document.cleanup(); }
  } catch { return unavailable("pdf_invalid"); }
}
