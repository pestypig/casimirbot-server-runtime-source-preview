import { createHash } from "node:crypto";
import { z } from "zod";
import corpusData from "../../assets/civilization/unga81-provisional-transcripts.json";
import officialPageData from "../../assets/civilization/unga81-official-pages.json";
import { unga81ProvisionalTopicSchema } from "./unga81-provisional-topic-discovery";

const MAX_MEETING_BYTES = 10_000_000;
const topicPatterns: Record<z.infer<typeof unga81ProvisionalTopicSchema>, RegExp> = {
  "peace and security": /\b(peace|ceasefire|conflict|security|war)\b/i,
  "trade and economic exchange": /\b(trade|exports?|commerce|supply chain|customs)\b/i,
  "infrastructure and connectivity": /\b(infrastructure|connectivity|railway|pipeline|ports?|transport)\b/i,
  "climate and environment": /\b(climate|environment|biodiversity|emissions?|drought|floods?)\b/i,
  "energy and minerals": /\b(energy|electricity|renewable|mineral|oil|gas)\b/i,
  "development finance": /\b(finance|debt|investment|funding|financing)\b/i,
  "food and water": /\b(food|agriculture|farming|water|hunger)\b/i,
  "health and education": /\b(health|pandemic|hospital|education|school)\b/i,
  "technology and AI": /\b(technology|digital|artificial intelligence|AI)\b/i,
};
type IndexedStatement = { statementNumber: number; startSeconds: number; sourceUrl: string;
  characterCount: number; textSha256: string; topicCounts: Record<string, number>;
  speaker: { affiliationIso3: string | null; affiliationName: string | null } };
const corpus = corpusData as unknown as { collectedAt: string; sourceListingUrl: string;
  meetings: Array<{ date: string; sourceUrl: string; statements: IndexedStatement[] }> };
const official = officialPageData as unknown as { pages: Array<{ countryIso3: string | null; pageUrl: string }> };

export const unga81PairTopicPassagesQuerySchema = z.object({
  firstCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  secondCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  topic: unga81ProvisionalTopicSchema,
  maxSegmentsPerCountry: z.number().int().min(1).max(2).default(1),
  maxPassagesPerSegment: z.number().int().min(1).max(4).default(3),
}).strict().refine((query) => query.firstCountryIso3 !== query.secondCountryIso3,
  "Select two different affiliations.");
export type Unga81PairTopicPassagesQuery = z.infer<typeof unga81PairTopicPassagesQuerySchema>;

const passageSchema = z.object({
  sentenceIndex: z.number().int().nonnegative(), excerpt: z.string().min(1).max(320),
  excerptStartInSentence: z.number().int().nonnegative(),
  excerptEndInSentence: z.number().int().positive(),
  fullSentenceLength: z.number().int().positive(),
  truncated: z.boolean(),
}).strict();
const segmentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), date: z.string().date(),
    sourceUrl: z.string().url(), meetingJsonUrl: z.string().url(),
    statementNumber: z.number().int().positive(), startSeconds: z.number().nonnegative(),
    indexedTextSha256: z.string().regex(/^[a-f0-9]{64}$/), indexedCharacterCount: z.number().int().nonnegative(),
    indexedKeywordSentenceMentions: z.number().int().positive(), verifiedKeywordSentenceMentions: z.number().int().positive(),
    fetchedAt: z.string().datetime({ offset: true }), textHashMatched: z.literal(true),
    passages: z.array(passageSchema).max(4), morePassagesAvailable: z.boolean(),
  }).strict(),
  z.object({ status: z.literal("unavailable"), date: z.string().date(), sourceUrl: z.string().url(),
    meetingJsonUrl: z.string().url(), statementNumber: z.number().int().positive(),
    indexedTextSha256: z.string().regex(/^[a-f0-9]{64}$/), indexedKeywordSentenceMentions: z.number().int().positive(),
    errorCode: z.enum(["source_unavailable", "source_http_error", "source_response_too_large",
      "source_response_invalid", "segment_missing_or_changed", "text_hash_changed", "topic_index_changed"]),
  }).strict(),
]);
export const unga81PairTopicPassagesOutputSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_pair_topic_passages/v1"),
  query: unga81PairTopicPassagesQuerySchema,
  source: z.object({ listingUrl: z.string().url(), indexedAt: z.string().datetime({ offset: true }),
    checkedAt: z.string().datetime({ offset: true }),
    method: z.literal("hash_checked_provisional_asr_keyword_sentence_windows"),
    officialMeetingRecord: z.literal(false) }).strict(),
  countries: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
    affiliationStatus: z.literal("indexed_asr_attribution_unverified_to_recording"),
    officialPageUrls: z.array(z.string().url()), indexedMatchingSegments: z.number().int().nonnegative(),
    selectedSegments: z.array(segmentSchema).max(2), additionalSegmentsNotRead: z.number().int().nonnegative(),
    sourceUseLimit: z.literal("unreviewed_wording_not_country_position_priority_or_bilateral_response"),
  }).strict()).length(2),
  comparisonStatus: z.literal("source_passages_only_no_diplomatic_comparison_or_agreement_inference"),
  missingEvidence: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type Unga81PairTopicPassages = z.infer<typeof unga81PairTopicPassagesOutputSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
type MeetingRead = { document: Record<string, unknown>; fetchedAt: string } |
  { errorCode: "source_unavailable" | "source_http_error" | "source_response_too_large" | "source_response_invalid" };

async function readMeetingJson(url: string, fetcher: typeof fetch): Promise<MeetingRead> {
  let response: Response;
  try { response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25_000) }); }
  catch { return { errorCode: "source_unavailable" }; }
  if (!response.ok) return { errorCode: "source_http_error" };
  if (!response.body) return { errorCode: "source_unavailable" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MEETING_BYTES) { await reader.cancel(); return { errorCode: "source_response_too_large" }; }
      chunks.push(value);
    }
  } catch { return { errorCode: "source_unavailable" }; }
  let document: unknown;
  try { document = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return { errorCode: "source_response_invalid" }; }
  if (!isRecord(document) || typeof document.disclaimer !== "string" ||
      !document.disclaimer.includes("not official records") || !isRecord(document.transcript) ||
      !Array.isArray(document.transcript.data)) return { errorCode: "source_response_invalid" };
  return { document, fetchedAt: new Date().toISOString() };
}

function sentenceWindow(sentence: string, matchAt: number, sentenceIndex: number): z.infer<typeof passageSchema> {
  const start = Math.max(0, Math.min(matchAt - 100, Math.max(0, sentence.length - 320)));
  const end = Math.min(sentence.length, start + 320);
  return { sentenceIndex, excerpt: sentence.slice(start, end), excerptStartInSentence: start,
    excerptEndInSentence: end, fullSentenceLength: sentence.length,
    truncated: start > 0 || end < sentence.length };
}

export async function readUnga81PairTopicPassages(
  input: unknown, fetcher: typeof fetch = fetch,
): Promise<Unga81PairTopicPassages> {
  const query = unga81PairTopicPassagesQuerySchema.parse(input);
  const selected = [query.firstCountryIso3, query.secondCountryIso3].map((countryIso3) => {
    const code = countryIso3 === "EUR" ? "EU" : countryIso3;
    const matching = corpus.meetings.flatMap((meeting) => meeting.statements
      .filter((statement) => statement.speaker.affiliationIso3 === code &&
        (statement.topicCounts[query.topic] ?? 0) > 0)
      .map((statement) => ({ meeting, statement })))
      .sort((a, b) => (b.statement.topicCounts[query.topic] ?? 0) - (a.statement.topicCounts[query.topic] ?? 0) ||
        a.meeting.date.localeCompare(b.meeting.date) || a.statement.statementNumber - b.statement.statementNumber);
    return { countryIso3, matching, chosen: matching.slice(0, query.maxSegmentsPerCountry) };
  });
  const meetingReads = new Map<string, Promise<MeetingRead>>();
  for (const country of selected) for (const { meeting } of country.chosen) {
    const url = `${meeting.sourceUrl}.json`;
    if (!meetingReads.has(url)) meetingReads.set(url, readMeetingJson(url, fetcher));
  }
  const pattern = topicPatterns[query.topic];
  const countries = await Promise.all(selected.map(async ({ countryIso3, matching, chosen }) => ({
    countryIso3,
    affiliationStatus: "indexed_asr_attribution_unverified_to_recording" as const,
    officialPageUrls: [...new Set(official.pages.filter((page) => page.countryIso3 === countryIso3)
      .map((page) => page.pageUrl))],
    indexedMatchingSegments: matching.length,
    additionalSegmentsNotRead: matching.length - chosen.length,
    sourceUseLimit: "unreviewed_wording_not_country_position_priority_or_bilateral_response" as const,
    selectedSegments: await Promise.all(chosen.map(async ({ meeting, statement }) => {
      const meetingJsonUrl = `${meeting.sourceUrl}.json`;
      const base = { date: meeting.date, sourceUrl: statement.sourceUrl, meetingJsonUrl,
        statementNumber: statement.statementNumber, indexedTextSha256: statement.textSha256,
        indexedKeywordSentenceMentions: statement.topicCounts[query.topic] };
      const read = await meetingReads.get(meetingJsonUrl)!;
      const unavailable = (errorCode: Extract<z.infer<typeof segmentSchema>, { status: "unavailable" }>["errorCode"]) =>
        ({ ...base, status: "unavailable" as const, errorCode });
      if ("errorCode" in read) return unavailable(read.errorCode);
      const document = read.document;
      const transcript = document.transcript as { data: unknown[] };
      const raw = transcript.data.find((item) => isRecord(item) && item.statement_number === statement.statementNumber);
      const code = countryIso3 === "EUR" ? "EU" : countryIso3;
      let liveSegmentUrl: string | null = null;
      if (isRecord(raw) && typeof raw.pageUrl === "string") {
        try { liveSegmentUrl = new URL(raw.pageUrl, "https://transcripts.un.org").href; }
        catch { liveSegmentUrl = null; }
      }
      if (!isRecord(raw) || typeof raw.start !== "number" ||
          Math.abs(raw.start - statement.startSeconds) > 0.01 || !isRecord(raw.speaker) ||
          raw.speaker.affiliation !== code || !Array.isArray(raw.paragraphs) ||
          liveSegmentUrl !== statement.sourceUrl) {
        return unavailable("segment_missing_or_changed");
      }
      const sentences = raw.paragraphs.flatMap((paragraph: unknown) => isRecord(paragraph) && Array.isArray(paragraph.sentences)
        ? paragraph.sentences.map((sentence: unknown) => isRecord(sentence) && typeof sentence.text === "string"
          ? sentence.text.trim() : null) : []);
      if (sentences.some((sentence: string | null) => sentence === null)) return unavailable("source_response_invalid");
      const checkedSentences = sentences as string[];
      const text = checkedSentences.filter(Boolean).join(" ");
      if (text.length !== statement.characterCount ||
          createHash("sha256").update(text).digest("hex") !== statement.textSha256) return unavailable("text_hash_changed");
      const matches = checkedSentences.flatMap((sentence, sentenceIndex) => {
        const match = pattern.exec(sentence);
        return match ? [sentenceWindow(sentence, match.index, sentenceIndex)] : [];
      });
      if (matches.length !== statement.topicCounts[query.topic]) return unavailable("topic_index_changed");
      return { ...base, status: "available" as const, startSeconds: statement.startSeconds,
        indexedCharacterCount: statement.characterCount, verifiedKeywordSentenceMentions: matches.length,
        fetchedAt: read.fetchedAt, textHashMatched: true as const,
        passages: matches.slice(0, query.maxPassagesPerSegment),
        morePassagesAvailable: matches.length > query.maxPassagesPerSegment };
    })),
  })));
  return unga81PairTopicPassagesOutputSchema.parse({
    schemaVersion: "civilization_unga81_pair_topic_passages/v1", query,
    source: { listingUrl: corpus.sourceListingUrl, indexedAt: corpus.collectedAt,
      checkedAt: new Date().toISOString(),
      method: "hash_checked_provisional_asr_keyword_sentence_windows", officialMeetingRecord: false },
    countries, comparisonStatus: "source_passages_only_no_diplomatic_comparison_or_agreement_inference",
    missingEvidence: ["automated_transcript_wording_and_attribution_not_official_or_curated",
      "submitted_pdfs_and_official_meeting_records_not_reconciled",
      "english_keyword_matches_may_be_false_positives_or_miss_paraphrases_and_other_languages",
      "selected_sentence_windows_do_not_establish_country_priority_bilateral_response_or_agreement",
      "the_two_countries_may_address_different_scopes_periods_and_third_parties"],
    authority: { assistant_answer: false, terminal_eligible: false,
      execution_permission: false, policy_finality: false },
  });
}
