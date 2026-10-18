import { z } from "zod";
import corpusData from "../../assets/civilization/unga81-provisional-transcripts.json";
import officialPageData from "../../assets/civilization/unga81-official-pages.json";
import { readUnga81CoverageLedger } from "./unga81-evidence";
import { unga81ProvisionalTopicSchema } from "./unga81-provisional-topic-discovery";
import { getUnga81SubmittedPageLeads, unga81SubmittedPageLeadSetSchema,
  unga81SubmittedPageIndexStatus } from "./unga81-submitted-page-leads";

const corpus = corpusData as unknown as { collectedAt: string; sourceListingUrl: string;
  meetings: Array<{ date: string; sourceUrl: string; statements: Array<{
    statementNumber: number; sourceUrl: string; topicCounts: Record<string, number>;
    speaker: { affiliationIso3: string | null };
  }> }> };
const official = officialPageData as unknown as { sitemapUrl: string; collectedAt: string;
  pages: Array<{ countryIso3: string | null; pageUrl: string; pdfUrls: string[] }> };

export const unga81PairReviewLeadsQuerySchema = z.object({
  firstCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  secondCountryIso3: z.string().regex(/^[A-Z]{3}$/),
}).strict().refine((query) => query.firstCountryIso3 !== query.secondCountryIso3,
  "Select two different affiliations.");

const segmentLeadSchema = z.object({
  date: z.string().date(), sourceUrl: z.string().url(), statementNumber: z.number().int().positive(),
  keywordSentenceMentions: z.number().int().positive(),
}).strict();

export const unga81PairReviewLeadsOutputSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_pair_review_leads/v2"),
  query: unga81PairReviewLeadsQuerySchema,
  source: z.object({ provisionalListingUrl: z.string().url(), provisionalIndexCollectedAt: z.string().datetime({ offset: true }),
    officialPageSitemapUrl: z.string().url(), officialPagesCollectedAt: z.string().datetime({ offset: true }),
    method: z.literal("unreviewed_provisional_asr_english_keyword_sentence_counts"),
    officialMeetingRecord: z.literal(false),
    submittedPageIndexGeneratedAt: z.string().datetime({ offset: true }),
    submittedPageIndexStatus: z.enum(["current", "stale_source_manifest"]),
  }).strict(),
  countries: z.array(z.object({
    countryIso3: z.string().regex(/^[A-Z]{3}$/),
    officialPageUrls: z.array(z.string().url()),
    submittedPdfUrls: z.array(z.string().url()),
    indexedProvisionalStatementCount: z.number().int().nonnegative(),
    selectedReviewedAssertionCount: z.number().int().nonnegative(),
    submittedTextStatus: z.string(),
    nextReviewStage: z.string(), nextReviewReason: z.string(),
    submittedPageLeads: unga81SubmittedPageLeadSetSchema,
    topicLeads: z.array(z.object({ topic: unga81ProvisionalTopicSchema,
      keywordSentenceMentions: z.number().int().positive(),
      matchingSegmentCount: z.number().int().positive(),
      leadingSegments: z.array(segmentLeadSchema).min(1).max(2),
      sourceUseLimit: z.literal("unreviewed_keyword_lead_not_country_position_priority_or_bilateral_response"),
    }).strict()).max(9),
  }).strict()).length(2),
  comparisonStatus: z.literal("review_queue_only_no_position_or_agreement_inference"),
  missingEvidence: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type Unga81PairReviewLeads = z.infer<typeof unga81PairReviewLeadsOutputSchema>;

export function readUnga81PairReviewLeads(input: unknown): Unga81PairReviewLeads {
  const query = unga81PairReviewLeadsQuerySchema.parse(input);
  const coverage = readUnga81CoverageLedger();
  const topics = unga81ProvisionalTopicSchema.options;
  const countries = [query.firstCountryIso3, query.secondCountryIso3].map((countryIso3) => {
    const provisionalCode = countryIso3 === "EUR" ? "EU" : countryIso3;
    const statements = corpus.meetings.flatMap((meeting) => meeting.statements
      .filter((statement) => statement.speaker.affiliationIso3 === provisionalCode)
      .map((statement) => ({ meeting, statement })));
    const pages = official.pages.filter((page) => page.countryIso3 === countryIso3);
    const row = coverage.rows.find((item) => item.countryIso3 === countryIso3);
    const next = coverage.reviewQueue.find((item) => item.countryIso3 === countryIso3);
    const topicLeads = topics.flatMap((topic) => {
      const matches = statements.flatMap(({ meeting, statement }) => {
        const keywordSentenceMentions = statement.topicCounts[topic] ?? 0;
        return keywordSentenceMentions > 0 ? [{ date: meeting.date, sourceUrl: statement.sourceUrl,
          statementNumber: statement.statementNumber, keywordSentenceMentions }] : [];
      }).sort((left, right) => right.keywordSentenceMentions - left.keywordSentenceMentions ||
        left.date.localeCompare(right.date) || left.statementNumber - right.statementNumber);
      return matches.length ? [{ topic, keywordSentenceMentions: matches.reduce((sum, item) =>
        sum + item.keywordSentenceMentions, 0), matchingSegmentCount: matches.length,
        leadingSegments: matches.slice(0, 2),
        sourceUseLimit: "unreviewed_keyword_lead_not_country_position_priority_or_bilateral_response" as const }] : [];
    }).sort((left, right) => right.keywordSentenceMentions - left.keywordSentenceMentions ||
      left.topic.localeCompare(right.topic));
    return {
      countryIso3,
      officialPageUrls: [...new Set(pages.map((page) => page.pageUrl))],
      submittedPdfUrls: [...new Set(pages.flatMap((page) => page.pdfUrls))],
      indexedProvisionalStatementCount: statements.length,
      selectedReviewedAssertionCount: row?.reviewedAssertionCount ?? 0,
      submittedTextStatus: row?.sourceVerification.submittedText ?? "missing_or_unavailable",
      nextReviewStage: next?.stage ?? "reconcile_affiliation_date",
      nextReviewReason: next?.reason ?? "No indexed review queue row; check the official page and affiliation.",
      submittedPageLeads: getUnga81SubmittedPageLeads(countryIso3),
      topicLeads,
    };
  });
  return unga81PairReviewLeadsOutputSchema.parse({
    schemaVersion: "civilization_unga81_pair_review_leads/v2", query,
    source: { provisionalListingUrl: corpus.sourceListingUrl, provisionalIndexCollectedAt: corpus.collectedAt,
      officialPageSitemapUrl: official.sitemapUrl, officialPagesCollectedAt: official.collectedAt,
      method: "unreviewed_provisional_asr_english_keyword_sentence_counts", officialMeetingRecord: false,
      submittedPageIndexGeneratedAt: unga81SubmittedPageIndexStatus.generatedAt,
      submittedPageIndexStatus: unga81SubmittedPageIndexStatus.status },
    countries, comparisonStatus: "review_queue_only_no_position_or_agreement_inference",
    missingEvidence: [
      "Provisional ASR wording and attribution have not been reconciled to the recording or official meeting record.",
      "English keyword counts can miss other languages, translation choices, paraphrases, and relevant passages.",
      "Submitted PDF acquisition, hash, page, wording, speaker, and date checks remain necessary before admitting a position.",
      "A topic lead does not establish national priority, a bilateral response, agreement, or an option-specific view.",
      "Submitted PDF literal cues only locate pages for source review; other pages may contain relevant positions and no cue is an admitted assertion.",
    ],
    authority: { assistant_answer: false, terminal_eligible: false,
      execution_permission: false, policy_finality: false },
  });
}
