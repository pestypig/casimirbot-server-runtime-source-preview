import { z } from "zod";
import corpusData from "../../assets/civilization/unga81-provisional-transcripts.json";
import officialPageData from "../../assets/civilization/unga81-official-pages.json";

export const unga81ProvisionalTopicSchema = z.enum(["peace and security", "trade and economic exchange",
  "infrastructure and connectivity", "climate and environment", "energy and minerals",
  "development finance", "food and water", "health and education", "technology and AI"]);
const corpus = corpusData as unknown as { collectedAt: string; sourceListingUrl: string; meetings: Array<{
  date: string; sourceUrl: string; statements: Array<{ statementNumber: number; sourceUrl: string;
    characterCount: number; topicCounts: Record<string, number>; speaker: {
      affiliationIso3: string | null; affiliationName: string | null } }> }> };
const official = officialPageData as unknown as { pages: Array<{ countryIso3: string | null; pageUrl: string }> };

export const unga81ProvisionalTopicDiscoveryQuerySchema = z.object({
  topic: unga81ProvisionalTopicSchema,
  minimumMentions: z.number().int().min(1).max(100).default(1),
  offset: z.number().int().min(0).max(300).default(0),
  maxCountries: z.number().int().min(1).max(50).default(20),
}).strict();
export type Unga81ProvisionalTopicDiscoveryQuery = z.infer<typeof unga81ProvisionalTopicDiscoveryQuerySchema>;

const segmentSchema = z.object({ date: z.string().date(), sourceUrl: z.string().url(),
  statementNumber: z.number().int().positive(), characterCount: z.number().int().nonnegative(),
  keywordSentenceMentions: z.number().int().positive() }).strict();
export const unga81ProvisionalTopicDiscoveryOutputSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_provisional_topic_discovery/v1"),
  query: unga81ProvisionalTopicDiscoveryQuerySchema,
  source: z.object({ listingUrl: z.string().url(), indexedAt: z.string().datetime({ offset: true }),
    corpusScope: z.literal("six_unga81_general_debate_days_provisional_asr_index"),
    method: z.literal("english_keyword_sentence_count_in_unreviewed_asr"),
    officialMeetingRecord: z.literal(false) }).strict(),
  matchedAffiliations: z.number().int().nonnegative(), returnedAffiliations: z.number().int().nonnegative(),
  moreResultsAvailable: z.boolean(),
  leads: z.array(z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/),
    label: z.string(), entityKind: z.enum(["country_or_observer_affiliation_unverified", "institutional_delegation"]),
    totalKeywordSentenceMentions: z.number().int().positive(),
    matchedSegmentCount: z.number().int().positive(), officialPageUrls: z.array(z.string().url()),
    segments: z.array(segmentSchema).min(1),
    interpretation: z.literal("keyword_lead_only_not_position_priority_agreement_or_bilateral_relevance"),
  }).strict()).max(50),
  missingEvidence: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false),
    execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type Unga81ProvisionalTopicDiscovery = z.infer<typeof unga81ProvisionalTopicDiscoveryOutputSchema>;

export function readUnga81ProvisionalTopicDiscovery(input: unknown): Unga81ProvisionalTopicDiscovery {
  const query = unga81ProvisionalTopicDiscoveryQuerySchema.parse(input);
  const groups = new Map<string, { label: string; segments: z.infer<typeof segmentSchema>[] }>();
  for (const meeting of corpus.meetings) for (const statement of meeting.statements) {
    const rawCode = statement.speaker.affiliationIso3;
    const code = rawCode === "EU" ? "EUR" : rawCode;
    if (!code || !/^[A-Z]{3}$/.test(code) || code === "UN") continue;
    const mentions = statement.topicCounts[query.topic] ?? 0;
    if (mentions <= 0) continue;
    const group = groups.get(code) ?? { label: statement.speaker.affiliationName ?? code, segments: [] };
    group.segments.push({ date: meeting.date, sourceUrl: statement.sourceUrl,
      statementNumber: statement.statementNumber, characterCount: statement.characterCount,
      keywordSentenceMentions: mentions });
    groups.set(code, group);
  }
  const all = [...groups.entries()].map(([countryIso3, group]) => {
    const segments = group.segments.sort((a, b) => b.keywordSentenceMentions - a.keywordSentenceMentions ||
      a.date.localeCompare(b.date) || a.statementNumber - b.statementNumber);
    return { countryIso3, label: group.label,
      entityKind: countryIso3 === "EUR" ? "institutional_delegation" as const
        : "country_or_observer_affiliation_unverified" as const,
      totalKeywordSentenceMentions: segments.reduce((sum, item) => sum + item.keywordSentenceMentions, 0),
      matchedSegmentCount: segments.length,
      officialPageUrls: [...new Set(official.pages.filter((page) => page.countryIso3 === countryIso3)
        .map((page) => page.pageUrl))],
      segments, interpretation: "keyword_lead_only_not_position_priority_agreement_or_bilateral_relevance" as const };
  }).filter((lead) => lead.totalKeywordSentenceMentions >= query.minimumMentions)
    .sort((a, b) => b.totalKeywordSentenceMentions - a.totalKeywordSentenceMentions ||
      a.countryIso3.localeCompare(b.countryIso3));
  const leads = all.slice(query.offset, query.offset + query.maxCountries);
  return unga81ProvisionalTopicDiscoveryOutputSchema.parse({
    schemaVersion: "civilization_unga81_provisional_topic_discovery/v1", query,
    source: { listingUrl: corpus.sourceListingUrl, indexedAt: corpus.collectedAt,
      corpusScope: "six_unga81_general_debate_days_provisional_asr_index",
      method: "english_keyword_sentence_count_in_unreviewed_asr", officialMeetingRecord: false },
    matchedAffiliations: all.length, returnedAffiliations: leads.length,
    moreResultsAvailable: query.offset + leads.length < all.length, leads,
    missingEvidence: ["keyword_matches_may_be_false_positives_or_miss_other_languages_and_paraphrases",
      "speaker_affiliation_and_exact_delivery_unverified", "submitted_pdf_and_official_meeting_record_not_reconciled",
      "mention_counts_do_not_establish_country_position_or_priority"],
    authority: { assistant_answer: false, terminal_eligible: false,
      execution_permission: false, policy_finality: false },
  });
}
