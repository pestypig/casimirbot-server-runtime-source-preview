import { createHash } from "node:crypto";
import { z } from "zod";
import corpusData from "../../assets/civilization/unga81-provisional-transcripts.json";

const MAX_RESPONSE_BYTES = 10_000_000;
const MAX_EXCERPT_CHARS = 5_000;
const corpus = corpusData as unknown as { collectedAt: string; meetings: Array<{
  date: string; sourceUrl: string; statements: Array<{
    statementNumber: number; startSeconds: number; sourceUrl: string; characterCount: number;
    textSha256: string; speaker: { affiliationIso3: string | null; affiliationName: string | null;
      function: string | null; group: string | null } }> }> };

export const unga81ProvisionalSegmentQuerySchema = z.object({
  countryIso3: z.string().regex(/^[A-Z]{3}$/),
  sourceUrl: z.string().url(),
  offset: z.number().int().min(0).max(100_000).default(0),
  maxChars: z.number().int().min(1).max(MAX_EXCERPT_CHARS).default(3_000),
}).strict();
export type Unga81ProvisionalSegmentQuery = z.infer<typeof unga81ProvisionalSegmentQuerySchema>;

const sourceSchema = z.object({
  segmentUrl: z.string().url(), meetingJsonUrl: z.string().url(), meetingDate: z.string().date(),
  statementNumber: z.number().int().positive(), startSeconds: z.number().nonnegative(),
  indexedTextSha256: z.string().regex(/^[a-f0-9]{64}$/), indexedCharacterCount: z.number().int().nonnegative(),
  indexedAt: z.string().datetime({ offset: true }), checkedAt: z.string().datetime({ offset: true }),
  fetchedAt: z.string().datetime({ offset: true }).nullable(),
  affiliationIso3: z.string(), affiliationName: z.string().nullable(),
  speakerIdentityStatus: z.literal("indexed_asr_attribution_unverified_to_recording"),
}).strict();
const baseSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_provisional_segment/v1"),
  query: unga81ProvisionalSegmentQuerySchema, source: sourceSchema,
  transcriptStatus: z.literal("provisional_automated_speech_recognition_not_official_record"),
  sourceUseLimit: z.literal("unreviewed_wording_not_country_position_or_verified_delivery"),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
});
export const unga81ProvisionalSegmentOutputSchema = z.discriminatedUnion("status", [
  baseSchema.extend({ status: z.literal("available"), excerpt: z.string().min(1),
    excerptOffset: z.number().int().nonnegative(), excerptEnd: z.number().int().nonnegative(),
    fullTextLength: z.number().int().nonnegative(), textHashMatched: z.literal(true),
    moreTextAvailable: z.boolean(), missingEvidence: z.array(z.string()) }).strict(),
  baseSchema.extend({ status: z.literal("unavailable"),
    errorCode: z.enum(["source_unavailable", "source_http_error", "source_response_too_large",
      "source_response_invalid", "segment_missing_or_changed", "text_hash_changed", "excerpt_out_of_bounds"]),
    missingEvidence: z.array(z.string()) }).strict(),
]);
export type Unga81ProvisionalSegment = z.infer<typeof unga81ProvisionalSegmentOutputSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function readUnga81ProvisionalSegment(input: unknown, fetcher: typeof fetch = fetch): Promise<Unga81ProvisionalSegment> {
  const query = unga81ProvisionalSegmentQuerySchema.parse(input);
  const code = query.countryIso3 === "EUR" ? "EU" : query.countryIso3;
  const match = corpus.meetings.flatMap((meeting) => meeting.statements
    .filter((statement) => statement.sourceUrl === query.sourceUrl && statement.speaker.affiliationIso3 === code)
    .map((statement) => ({ meeting, statement })))[0];
  if (!match) throw new Error("segment_not_indexed_for_country");
  const meetingJsonUrl = `${match.meeting.sourceUrl}.json`;
  const source: z.infer<typeof sourceSchema> = {
    segmentUrl: query.sourceUrl, meetingJsonUrl, meetingDate: match.meeting.date,
    statementNumber: match.statement.statementNumber, startSeconds: match.statement.startSeconds,
    indexedTextSha256: match.statement.textSha256, indexedCharacterCount: match.statement.characterCount,
    indexedAt: corpus.collectedAt, checkedAt: new Date().toISOString(), fetchedAt: null,
    affiliationIso3: code, affiliationName: match.statement.speaker.affiliationName,
    speakerIdentityStatus: "indexed_asr_attribution_unverified_to_recording",
  };
  const common = { schemaVersion: "civilization_unga81_provisional_segment/v1" as const, query, source,
    transcriptStatus: "provisional_automated_speech_recognition_not_official_record" as const,
    sourceUseLimit: "unreviewed_wording_not_country_position_or_verified_delivery" as const,
    authority: { assistant_answer: false as const, terminal_eligible: false as const,
      execution_permission: false as const, policy_finality: false as const } };
  const unavailable = (errorCode: Extract<Unga81ProvisionalSegment, { status: "unavailable" }>["errorCode"]) =>
    unga81ProvisionalSegmentOutputSchema.parse({ ...common, status: "unavailable", errorCode,
      missingEvidence: ["provisional_segment_text_unavailable", "speaker_identity_and_delivery_unverified",
        "submitted_text_and_official_meeting_record_not_reconciled"] });
  let response: Response;
  try { response = await fetcher(meetingJsonUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25_000) }); }
  catch { return unavailable("source_unavailable"); }
  if (!response.ok) return unavailable("source_http_error");
  if (!response.body) return unavailable("source_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); return unavailable("source_response_too_large"); }
      chunks.push(value);
    }
  } catch { return unavailable("source_unavailable"); }
  source.fetchedAt = new Date().toISOString();
  let document: unknown;
  try { document = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return unavailable("source_response_invalid"); }
  if (!isRecord(document) || typeof document.disclaimer !== "string" ||
      !document.disclaimer.includes("not official records") || !isRecord(document.transcript) ||
      !Array.isArray(document.transcript.data)) return unavailable("source_response_invalid");
  const raw = document.transcript.data.find((item: unknown) => isRecord(item) &&
    item.statement_number === match.statement.statementNumber);
  if (!isRecord(raw) || typeof raw.start !== "number" ||
      Math.abs(raw.start - match.statement.startSeconds) > 0.01 || !isRecord(raw.speaker) ||
      raw.speaker.affiliation !== code || !Array.isArray(raw.paragraphs) ||
      typeof raw.pageUrl !== "string" || new URL(raw.pageUrl, "https://transcripts.un.org").href !== query.sourceUrl) {
    return unavailable("segment_missing_or_changed");
  }
  const sentences = raw.paragraphs.flatMap((paragraph: unknown) => isRecord(paragraph) && Array.isArray(paragraph.sentences)
    ? paragraph.sentences.map((sentence: unknown) => isRecord(sentence) && typeof sentence.text === "string"
      ? sentence.text.trim() : null) : []);
  if (sentences.some((sentence: string | null) => sentence === null)) return unavailable("source_response_invalid");
  const text = (sentences as string[]).filter(Boolean).join(" ");
  if (text.length !== match.statement.characterCount ||
      createHash("sha256").update(text).digest("hex") !== match.statement.textSha256) return unavailable("text_hash_changed");
  if (query.offset >= text.length) return unavailable("excerpt_out_of_bounds");
  const excerpt = text.slice(query.offset, query.offset + query.maxChars);
  return unga81ProvisionalSegmentOutputSchema.parse({ ...common, status: "available", excerpt,
    excerptOffset: query.offset, excerptEnd: query.offset + excerpt.length,
    fullTextLength: text.length, textHashMatched: true,
    moreTextAvailable: query.offset + excerpt.length < text.length,
    missingEvidence: ["automated_transcript_wording_not_curated_or_official",
      "speaker_identity_and_delivery_unverified", "submitted_text_and_official_meeting_record_not_reconciled"] });
}
