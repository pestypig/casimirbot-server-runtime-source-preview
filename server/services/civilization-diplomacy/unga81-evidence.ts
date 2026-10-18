import { z } from "zod";
import corpusData from "../../assets/civilization/unga81-provisional-transcripts.json";
import officialPageData from "../../assets/civilization/unga81-official-pages.json";
import reviewedBriefData from "../../assets/civilization/unga81-reviewed-briefs.v2.json";
import { reviewedTopicInventory } from "./reviewed-topic-inventory";
import bilateralPilotData from "../../assets/civilization/bilateral-evidence-pilot.v2.json";
import reconciliationPilotData from "../../assets/civilization/unga81-reconciliation-pilot.v1.json";
import submittedPdfManifestData from "../../assets/civilization/unga81-submitted-pdf-manifest.v1.json";
import textQualityManifestData from "../../assets/civilization/unga81-text-quality-manifest.v1.json";
import ocrCandidateManifestData from "../../assets/civilization/unga81-ocr-candidate-manifest.v1.json";

type CorpusStatement = {
  statementNumber: number;
  startSeconds: number;
  sourceUrl: string;
  speaker: { affiliationIso3: string | null; affiliationName: string | null; function: string | null; group: string | null };
  characterCount: number;
  topicCounts: Record<string, number>;
  textSha256: string;
};
type CorpusMeeting = { title: string; date: string; sourceUrl: string; statements: CorpusStatement[] };
const corpus = corpusData as unknown as { collectedAt: string; sourceListingUrl: string; meetings: CorpusMeeting[] };
type OfficialPage = { countryIso3: string | null; label: string; pageUrl: string; date: string | null;
  description: string; pdfUrls: string[]; submittedStatementStatus: "available" | "not_linked" };
const officialPages = officialPageData as unknown as { collectedAt: string; sitemapUrl: string; pages: OfficialPage[] };
type SubmittedPdfAcquisition = { sourceUrl: string; status: "pending" | "available" | "unavailable"; retrievedAt: string | null; pdfSha256: string | null; pdfBytes: number | null; pageCount: number | null; extractedTextSha256: string | null };
const submittedPdfManifest = submittedPdfManifestData as unknown as { generatedAt: string; entries: SubmittedPdfAcquisition[] };
const acquisitionByUrl = new Map(submittedPdfManifest.entries.map((entry) => [entry.sourceUrl, entry]));
type TextQualityEntry = { sourceUrl: string; extractedTextSha256: string | null; localHashStatus: string;
  status: "screenable" | "degraded_review_needed" | "unusable" | "missing_or_changed"; reasonCodes: string[] };
const textQualityManifest = textQualityManifestData as unknown as {
  generatedAt: string; sourceManifestGeneratedAt: string; entries: TextQualityEntry[] };
const textQualityAuditCurrent = textQualityManifest.sourceManifestGeneratedAt === submittedPdfManifest.generatedAt;
const textQualityByUrl = new Map(textQualityManifest.entries.map((entry) => [entry.sourceUrl, entry]));
const currentTextQuality = (sourceUrl: string) => {
  const acquisition = acquisitionByUrl.get(sourceUrl);
  const entry = textQualityByUrl.get(sourceUrl);
  return textQualityAuditCurrent && acquisition?.status === "available" && entry?.localHashStatus === "matched" &&
    entry.extractedTextSha256 === acquisition.extractedTextSha256 ? entry : null;
};
type OcrCandidateEntry = { sourceUrl: string; sourcePdfSha256: string | null;
  status: "current_unreviewed_candidate" | "stale_or_invalid"; pageCount: number; lineCount: number; meanConfidence: number | null };
const ocrCandidateManifest = ocrCandidateManifestData as unknown as {
  generatedAt: string; sourceManifestGeneratedAt: string; entries: OcrCandidateEntry[] };
const ocrAuditCurrent = ocrCandidateManifest.sourceManifestGeneratedAt === submittedPdfManifest.generatedAt;
const ocrCandidateByUrl = new Map(ocrCandidateManifest.entries.map((entry) => [entry.sourceUrl, entry]));
const currentOcrCandidate = (sourceUrl: string) => {
  const acquisition = acquisitionByUrl.get(sourceUrl);
  const entry = ocrCandidateByUrl.get(sourceUrl);
  return ocrAuditCurrent && acquisition?.status === "available" && entry?.status === "current_unreviewed_candidate" &&
    entry.sourcePdfSha256 === acquisition.pdfSha256 ? entry : null;
};
const dateAlignmentSchema = z.enum(["same_day_affiliation_only", "date_mismatch", "official_page_date_missing", "provisional_segment_missing", "official_page_missing"]);
type ReviewedBrief = {
  countryIso3: string; speaker: string; speakerRole: string;
  speakerAttributionSource: "submitted_pdf_and_official_page" | "official_page_only";
  speechDate: string; sourceType: string;
  sourceUrl: string; sourceLanguage: string; sourceSha256: string; reviewedAt: string; revision: number;
  sourceReviewMethod?: "visual_pdf_pages_after_ocr_triage";
  submittedDocumentDate?: { date: string; sourcePage: number };
  assertions: Array<{ id: string; claimType: string; text: string; sourcePage: number;
    reviewDisposition: "supported_by_submitted_text"; temporalScope: string; uncertainty: string }>;
};
const reviewedBriefs = reviewedBriefData as unknown as { briefs: ReviewedBrief[] };
const assertionIdCounts = new Map<string, number>();
const briefCountryCounts = new Map<string, number>();
for (const brief of reviewedBriefs.briefs) for (const assertion of brief.assertions)
  assertionIdCounts.set(assertion.id, (assertionIdCounts.get(assertion.id) ?? 0) + 1);
for (const brief of reviewedBriefs.briefs)
  briefCountryCounts.set(brief.countryIso3, (briefCountryCounts.get(brief.countryIso3) ?? 0) + 1);
type BriefAdmissionStatus = "not_reviewed" | "manifest_pending" | "unavailable" | "hash_changed" |
  "source_metadata_invalid" | "hash_matched";
function assessReviewedBriefAdmission(brief?: ReviewedBrief): { status: BriefAdmissionStatus; issues: string[] } {
  if (!brief) return { status: "not_reviewed", issues: [] };
  const acquisition = acquisitionByUrl.get(brief.sourceUrl);
  if (acquisition?.status === "unavailable") return { status: "unavailable", issues: [] };
  if (acquisition?.status !== "available") return { status: "manifest_pending", issues: [] };
  if (acquisition.pdfSha256 !== brief.sourceSha256) return { status: "hash_changed", issues: [] };
  const issues: string[] = [];
  if (currentTextQuality(brief.sourceUrl)?.status === "unusable" &&
    brief.sourceReviewMethod !== "visual_pdf_pages_after_ocr_triage")
    issues.push("unusable_text_requires_visual_pdf_page_review");
  if (briefCountryCounts.get(brief.countryIso3) !== 1) issues.push("country_brief_missing_or_duplicated");
  const linkedPage = officialPages.pages.find((page) => page.countryIso3 === brief.countryIso3 &&
    page.pdfUrls.includes(brief.sourceUrl) && page.date === brief.speechDate);
  if (!linkedPage) issues.push("official_page_pdf_country_or_date_mismatch");
  if (!Number.isInteger(acquisition.pageCount) || (acquisition.pageCount ?? 0) < 1)
    issues.push("source_page_count_missing");
  if (brief.submittedDocumentDate && (!z.string().date().safeParse(brief.submittedDocumentDate.date).success ||
    !Number.isInteger(brief.submittedDocumentDate.sourcePage) || brief.submittedDocumentDate.sourcePage < 1 ||
    brief.submittedDocumentDate.sourcePage > (acquisition.pageCount ?? 0)))
    issues.push("submitted_document_date_reference_invalid");
  if (!brief.assertions.length) issues.push("selected_assertions_missing");
  for (const assertion of brief.assertions) {
    if (!assertion.id?.trim() || assertionIdCounts.get(assertion.id) !== 1)
      issues.push(`assertion_id_missing_or_duplicated:${assertion.id ?? ""}`);
    if (!Number.isInteger(assertion.sourcePage) || assertion.sourcePage < 1 ||
      assertion.sourcePage > (acquisition.pageCount ?? 0))
      issues.push(`assertion_page_out_of_bounds:${assertion.id ?? ""}`);
    if (!assertion.text?.trim() || !assertion.claimType?.trim() ||
      assertion.reviewDisposition !== "supported_by_submitted_text")
      issues.push(`assertion_review_invalid:${assertion.id ?? ""}`);
  }
  return issues.length ? { status: "source_metadata_invalid", issues } : { status: "hash_matched", issues: [] };
}
const provisionalAffiliationCode = (officialIso3: string) => officialIso3 === "EUR" ? "EU" : officialIso3;
type Reconciliation = {
  countryIso3: string; submittedPdfSha256: string; provisionalTranscriptUrl: string;
  recordingReview?: { sourceUrl: string; linkSourceUrl: string;
    status: "linked_from_un_transcript_page_not_reviewed"; note: string };
  provisionalTranscriptSha256: string; speakerAndDateMatchIndexedPage: boolean;
  officialMeetingRecordStatus: "not_reconciled";
  assertions: Array<{ assertionId: string; alignment: "topic_consistent" | "wording_discrepancy"; note: string;
    publishedSpeechCorroboration?: { publisher: string; sourceUrl: string; publishedDate: string;
      reviewedDate: string; finding: string; deliveryStatus: "not_verified_to_recording_or_official_meeting_record" } }>;
};
const reconciliationPilot = reconciliationPilotData as unknown as { reviewedAt: string; method: string; countries: Reconciliation[] };
export const unga81RecordingReviewSchema = z.object({
  sourceUrl: z.string().url(), linkSourceUrl: z.string().url(),
  status: z.literal("linked_from_un_transcript_page_not_reviewed"), note: z.string(),
}).strict();
type BilateralRecord = { id: string; kind: string; eventDate: string; parties: string[];
  legalStatus: "declaration_only" | "initialed_not_in_force" | "entry_into_force_unverified" | "meeting_report_only";
  statusAsOf: string; statusEvidenceUrls: string[]; sourceSections: string[]; sourcePublisher: string; sourceUrl: string;
  corroboratingSources: Array<{ sourcePublisher: string; sourceUrl: string }>;
  milestones?: Array<{ date: string; kind: string; summary: string; sourceUrl: string }>;
  summary: string; conditions: string[]; thirdPartyDependencies: Array<{ partyIso3: string | null; role: string }>;
  reportedMeasures?: Array<{ metric: string; value: number; unit: string; qualifier: string; period: string; independentVerification: "not_verified" }>;
  limits: string };
const bilateralPilot = bilateralPilotData as unknown as { reviewScope: string; pairs: Array<{ countries: [string, string]; thirdPartyBriefRefs: Array<{ countryIso3: string; assertionIds: string[] }>; records: BilateralRecord[] }> };

export function readUnga81Index() {
  const counts = new Map<string, { countryIso3: string; countryName: string; speakerSegments: number; substantiveSegments: number }>();
  for (const statement of corpus.meetings.flatMap((meeting) => meeting.statements)) {
    const code = statement.speaker.affiliationIso3;
    if (!code || !/^[A-Z]{3}$/.test(code) || code === "UN") continue;
    const entry = counts.get(code) ?? {
      countryIso3: code,
      countryName: statement.speaker.affiliationName ?? code,
      speakerSegments: 0,
      substantiveSegments: 0,
    };
    entry.speakerSegments += 1;
    if (statement.characterCount >= 1000) entry.substantiveSegments += 1;
    counts.set(code, entry);
  }
  return {
    schemaVersion: "civilization_unga81_corpus_index/v1" as const,
    debate: "81st UN General Assembly General Debate" as const,
    sourceKind: "provisional automated speech recognition" as const,
    officialRecord: false as const,
    collectedAt: corpus.collectedAt,
    sourceListingUrl: corpus.sourceListingUrl,
    officialPageSitemapUrl: officialPages.sitemapUrl,
    officialPagesCollectedAt: officialPages.collectedAt,
    meetings: corpus.meetings.map((meeting) => ({ date: meeting.date, sourceUrl: meeting.sourceUrl, speakerSegments: meeting.statements.length })),
    affiliations: [...counts.values()].sort((a, b) => a.countryName.localeCompare(b.countryName)),
    officialPageCoverage: { pages: officialPages.pages.length,
      withPdfLinks: officialPages.pages.filter((page) => page.pdfUrls.length > 0).length,
      matchedIso3: officialPages.pages.filter((page) => page.countryIso3).length },
  };
}

const submittedFilenameLanguageHint = (sourceUrl: string): string | null =>
  /_([a-z]{2})(?:_\d+)?\.pdf(?:\?.*)?$/i.exec(sourceUrl)?.[1]?.toLowerCase() ?? null;

export const unga81CoverageLedgerSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_coverage_ledger/v18"),
  sourceListingUrl: z.string().url(),
  officialPageSitemapUrl: z.string().url(),
  submittedPdfManifestGeneratedAt: z.string(),
  textQualityManifestGeneratedAt: z.string(),
  textQualityAuditStatus: z.enum(["current", "stale_source_manifest"]),
  ocrCandidateManifestGeneratedAt: z.string(),
  ocrCandidateAuditStatus: z.enum(["current", "stale_source_manifest"]),
  officialMeetingRecordStatus: z.literal("not_indexed"),
  rosterReconciliation: z.object({
    reportedSpeakingDelegations: z.object({ count: z.literal(194), sourceUrl: z.string().url() }).strict(),
    officialDelegationPageCount: z.number().int().nonnegative(),
    countryOrObserverAffiliationPageCount: z.number().int().nonnegative(),
    institutionalDelegationPages: z.array(z.object({
      affiliationCode: z.string(), provisionalAffiliationCode: z.string(),
      label: z.string(), pageUrl: z.string().url(),
    }).strict()),
    uncodedOfficialPages: z.array(z.object({ label: z.string(), pageUrl: z.string().url() }).strict()),
    sameDayProvisionalAffiliationMatches: z.number().int().nonnegative(),
    missingOrDateMismatchedProvisionalAffiliations: z.array(z.string()),
    provisionalNonDelegationCodes: z.array(z.string()),
    countRelation: z.enum(["count_matches_identity_not_verified", "count_differs_review_needed"]),
    identityAndDeliveryStatus: z.literal("not_verified_to_recording_or_official_meeting_record"),
  }).strict(),
  positionCoverage: z.object({
    delegationPagesWithHashMatchedSelectedBrief: z.number().int().nonnegative(),
    selectedReviewedAssertionCount: z.number().int().nonnegative(),
    delegationPagesWithoutHashMatchedSelectedBrief: z.number().int().nonnegative(),
    fullSpeechAssertionReviewStatus: z.literal("not_issued_in_current_manifest"),
    interpretation: z.literal("Selected reviewed assertions are not a complete national position or a verified delivered speech."),
    topics: z.array(z.object({
      id: z.string(), label: z.string(), issueId: z.string(),
      indexedDelegationPageCount: z.number().int().nonnegative(),
      countriesWithAdmittedSelectedAssertions: z.array(z.object({
        countryIso3: z.string(), briefRevision: z.number().int().positive(),
        assertions: z.array(z.object({ id: z.string(), sourcePage: z.number().int().positive(),
          sourceUrl: z.string().url() }).strict()).min(1),
      }).strict()),
      countriesWithoutAdmittedSelectedAssertions: z.array(z.string()),
      inventoryAssertionIdsNotAdmitted: z.array(z.string()),
      interpretation: z.literal("A selected, hash-matched assertion is a dated submitted-text topic mention. A country without one may have an unreviewed statement or an uncovered passage; silence, opposition, and bilateral relevance are not established."),
    }).strict()),
  }).strict(),
  rows: z.array(z.object({
    countryIso3: z.string(), countryName: z.string(),
    entityKind: z.enum(["country_or_observer_affiliation_unverified", "institutional_delegation"]),
    provisionalSpeakerSegments: z.number().int().nonnegative(),
    officialPageCount: z.number().int().nonnegative(),
    officialDates: z.array(z.string().date()), provisionalDates: z.array(z.string().date()),
    dateAlignment: dateAlignmentSchema,
    speakerAttributionStatus: z.literal("not_verified_to_recording"),
    sourceVerification: z.object({
      speaker: z.enum(["official_page_description_unverified_to_recording", "official_page_missing"]),
      delivery: z.enum(["provisional_wording_discrepancy", "provisional_only_unverified", "provisional_segment_missing"]),
      language: z.enum(["filename_hints_only_translation_unverified", "filename_language_unknown", "submitted_pdf_not_linked"]),
      submittedText: z.enum(["selected_assertions_hash_matched", "reviewed_source_hash_changed", "reviewed_source_metadata_invalid",
        "acquired_unreviewed", "missing_or_unavailable"]),
      officialMeetingRecord: z.literal("not_indexed"),
    }).strict(),
    submittedSources: z.array(z.object({
      sourceUrl: z.string().url(), officialPageUrl: z.string().url(),
      filenameLanguageHint: z.string().regex(/^[a-z]{2}$/).nullable(),
      translationRelation: z.literal("unverified"),
      acquisitionStatus: z.enum(["pending", "available", "unavailable", "not_in_manifest"]),
      textQualityStatus: z.enum(["screenable", "degraded_review_needed", "unusable", "not_audited", "not_acquired"]),
      selectedAssertionReview: z.enum(["hash_matched_selected_assertions", "source_hash_changed", "source_metadata_invalid", "not_reviewed"]),
    }).strict()),
    submittedPdfCount: z.number().int().nonnegative(),
    acquiredPdfCount: z.number().int().nonnegative(),
    unavailablePdfCount: z.number().int().nonnegative(),
    screenableTextCount: z.number().int().nonnegative(),
    unusableTextCount: z.number().int().nonnegative(),
    degradedTextCount: z.number().int().nonnegative(),
    unauditedTextCount: z.number().int().nonnegative(),
    unreviewedOcrCandidateCount: z.number().int().nonnegative(),
    reviewedBriefRevision: z.number().int().positive().nullable(),
    reviewedAssertionCount: z.number().int().nonnegative(),
    reviewedBriefCoverage: z.enum(["none", "selected_assertions_only"]),
    reviewedBriefPdfStatus: z.enum(["not_reviewed", "manifest_pending", "hash_matched", "hash_changed", "source_metadata_invalid", "unavailable"]),
    reviewedBriefAdmissionIssues: z.array(z.string()),
    submittedDocumentDateReview: z.object({
      status: z.enum(["not_recorded", "source_not_admitted", "official_page_date_missing",
        "matches_official_page", "differs_from_official_page"]),
      date: z.string().max(64).nullable(), sourcePageUrl: z.string().url().nullable(),
    }).strict(),
    reconciliationStatus: z.enum(["hash_matched_provisional", "stale", "not_reviewed"]),
    deliveryWordingDiscrepancies: z.array(z.object({
      assertionId: z.string(), submittedPdfPageUrl: z.string().url(),
      provisionalTranscriptUrl: z.string().url(), publishedSpeechUrl: z.string().url().nullable(),
      resolutionStatus: z.literal("recording_or_official_meeting_record_review_needed"),
    }).strict()),
    gaps: z.array(z.string()),
  }).strict()),
  reviewQueue: z.array(z.object({
    countryIso3: z.string(),
    stage: z.enum(["reconcile_affiliation_date", "reconcile_submitted_document_date", "recheck_changed_pdf", "recheck_source_metadata", "recover_extracted_text", "review_ocr_candidate", "audit_extracted_text", "review_submitted_text", "compare_provisional_recording", "resolve_delivery_discrepancy", "expand_reviewed_brief", "await_official_record", "find_submitted_text"]),
    reason: z.string(),
    blockingAssertionIds: z.array(z.string()), sourceUrls: z.array(z.string().url()),
  }).strict()),
  interpretationLimits: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false) }).strict(),
}).strict();

export function readUnga81CoverageLedger() {
  const segments = corpus.meetings.flatMap((meeting) => meeting.statements);
  const codes = new Set<string>([
    ...segments.map((segment) => segment.speaker.affiliationIso3).filter((code): code is string => !!code && /^[A-Z]{3}$/.test(code) && code !== "UN"),
    ...officialPages.pages.map((page) => page.countryIso3).filter((code): code is string => !!code && /^[A-Z]{3}$/.test(code)),
  ]);
  const rows = [...codes].map((countryIso3) => {
      const countrySegments = segments.filter((segment) => segment.speaker.affiliationIso3 === provisionalAffiliationCode(countryIso3));
      const pages = officialPages.pages.filter((page) => page.countryIso3 === countryIso3);
      const officialDates = [...new Set(pages.map((page) => page.date).filter((date): date is string => !!date))].sort();
      const provisionalDates = [...new Set(corpus.meetings.filter((meeting) =>
        meeting.statements.some((statement) => statement.speaker.affiliationIso3 === provisionalAffiliationCode(countryIso3)))
        .map((meeting) => meeting.date))].sort();
      const dateAlignment = !pages.length ? "official_page_missing" as const
        : !officialDates.length ? "official_page_date_missing" as const
          : !provisionalDates.length ? "provisional_segment_missing" as const
            : officialDates.some((date) => provisionalDates.includes(date))
              ? "same_day_affiliation_only" as const : "date_mismatch" as const;
      const brief = reviewedBriefs.briefs.find((item) => item.countryIso3 === countryIso3);
      const pdfUrls = pages.flatMap((page) => page.pdfUrls);
      const acquisitions = pdfUrls.map((url) => acquisitionByUrl.get(url));
      const textQualities = pdfUrls.map((url) => currentTextQuality(url));
      const ocrCandidates = pdfUrls.map((url) => currentOcrCandidate(url));
      const briefAdmission = assessReviewedBriefAdmission(brief);
      const reviewedBriefPdfStatus = briefAdmission.status;
      const submittedDocumentDate = brief?.submittedDocumentDate;
      const submittedDocumentDateStatus = !submittedDocumentDate ? "not_recorded" as const
        : reviewedBriefPdfStatus !== "hash_matched" ? "source_not_admitted" as const
          : !officialDates.length ? "official_page_date_missing" as const
            : officialDates.includes(submittedDocumentDate.date) ? "matches_official_page" as const
              : "differs_from_official_page" as const;
      const reviewed = reconciliationPilot.countries.find((item) => item.countryIso3 === countryIso3);
      const reconciliationStatus = !reviewed ? "not_reviewed" : brief &&
        brief.sourceSha256 === reviewed.submittedPdfSha256 &&
        reviewedBriefPdfStatus === "hash_matched" &&
        countrySegments.some((segment) => segment.textSha256 === reviewed.provisionalTranscriptSha256 &&
          segment.sourceUrl === reviewed.provisionalTranscriptUrl) ? "hash_matched_provisional" : "stale";
      const deliveryWordingDiscrepancies = reconciliationStatus === "hash_matched_provisional"
        ? reviewed?.assertions.filter((assertion) => assertion.alignment === "wording_discrepancy")
          .flatMap((assertion) => {
            const sourcePage = brief?.assertions.find((item) => item.id === assertion.assertionId)?.sourcePage;
            return sourcePage && brief ? [{ assertionId: assertion.assertionId,
              submittedPdfPageUrl: `${brief.sourceUrl}#page=${sourcePage}`,
              provisionalTranscriptUrl: reviewed.provisionalTranscriptUrl,
              publishedSpeechUrl: assertion.publishedSpeechCorroboration?.sourceUrl ?? null,
              resolutionStatus: "recording_or_official_meeting_record_review_needed" as const }] : [];
          }) ?? [] : [];
      const submittedSources = pages.flatMap((page) => page.pdfUrls.map((sourceUrl) => {
        const acquisition = acquisitionByUrl.get(sourceUrl);
        const quality = currentTextQuality(sourceUrl);
        return {
          sourceUrl, officialPageUrl: page.pageUrl,
          filenameLanguageHint: submittedFilenameLanguageHint(sourceUrl),
          translationRelation: "unverified" as const,
          acquisitionStatus: acquisition?.status ?? "not_in_manifest" as const,
          textQualityStatus: quality && quality.status !== "missing_or_changed" ? quality.status
            : acquisition?.status === "available" ? "not_audited" as const : "not_acquired" as const,
          selectedAssertionReview: brief?.sourceUrl === sourceUrl
            ? reviewedBriefPdfStatus === "hash_matched" ? "hash_matched_selected_assertions" as const
              : reviewedBriefPdfStatus === "hash_changed" ? "source_hash_changed" as const
                : reviewedBriefPdfStatus === "source_metadata_invalid" ? "source_metadata_invalid" as const : "not_reviewed" as const
            : "not_reviewed" as const,
        };
      }));
      return {
        countryIso3,
        countryName: pages[0]?.label ?? countrySegments[0]?.speaker.affiliationName ?? countryIso3,
        entityKind: countryIso3 === "EUR" ? "institutional_delegation" as const : "country_or_observer_affiliation_unverified" as const,
        provisionalSpeakerSegments: countrySegments.length,
        officialPageCount: pages.length,
        officialDates, provisionalDates, dateAlignment,
        speakerAttributionStatus: "not_verified_to_recording" as const,
        sourceVerification: {
          speaker: pages.length ? "official_page_description_unverified_to_recording" as const : "official_page_missing" as const,
          delivery: !countrySegments.length ? "provisional_segment_missing" as const
            : deliveryWordingDiscrepancies.length ? "provisional_wording_discrepancy" as const
              : "provisional_only_unverified" as const,
          language: !pdfUrls.length ? "submitted_pdf_not_linked" as const
            : submittedSources.some((source) => source.filenameLanguageHint) ? "filename_hints_only_translation_unverified" as const
              : "filename_language_unknown" as const,
          submittedText: reviewedBriefPdfStatus === "hash_matched" ? "selected_assertions_hash_matched" as const
            : reviewedBriefPdfStatus === "hash_changed" ? "reviewed_source_hash_changed" as const
              : reviewedBriefPdfStatus === "source_metadata_invalid" ? "reviewed_source_metadata_invalid" as const
              : acquisitions.some((entry) => entry?.status === "available") ? "acquired_unreviewed" as const
                : "missing_or_unavailable" as const,
          officialMeetingRecord: "not_indexed" as const,
        },
        submittedSources,
        submittedPdfCount: pdfUrls.length,
        acquiredPdfCount: acquisitions.filter((entry) => entry?.status === "available").length,
        unavailablePdfCount: acquisitions.filter((entry) => entry?.status === "unavailable").length,
        screenableTextCount: textQualities.filter((entry) => entry?.status === "screenable").length,
        unusableTextCount: textQualities.filter((entry) => entry?.status === "unusable").length,
        degradedTextCount: textQualities.filter((entry) => entry?.status === "degraded_review_needed").length,
        unauditedTextCount: acquisitions.filter((entry, index) => entry?.status === "available" && !textQualities[index]).length,
        unreviewedOcrCandidateCount: ocrCandidates.filter(Boolean).length,
        reviewedBriefRevision: brief?.revision ?? null,
        reviewedAssertionCount: reviewedBriefPdfStatus === "hash_matched" ? brief?.assertions.length ?? 0 : 0,
        reviewedBriefCoverage: reviewedBriefPdfStatus === "hash_matched" ? "selected_assertions_only" as const : "none" as const,
        reviewedBriefPdfStatus,
        reviewedBriefAdmissionIssues: briefAdmission.issues,
        submittedDocumentDateReview: {
          status: submittedDocumentDateStatus,
          date: submittedDocumentDate?.date ?? null,
          sourcePageUrl: submittedDocumentDate && brief
            ? `${brief.sourceUrl}#page=${submittedDocumentDate.sourcePage}` : null,
        },
        reconciliationStatus,
        deliveryWordingDiscrepancies,
        gaps: [
          ...(countrySegments.length ? [] : ["provisional_speech_segment_missing"]),
          ...(pages.length ? [] : ["official_page_missing"]),
          ...(dateAlignment === "date_mismatch" ? ["official_page_and_provisional_affiliation_dates_disagree"] : []),
          ...(dateAlignment === "official_page_date_missing" ? ["official_page_date_missing"] : []),
          ...(submittedDocumentDateStatus === "differs_from_official_page" ? ["submitted_document_and_official_page_dates_disagree"] : []),
          ...(pages.some((page) => page.pdfUrls.length) ? [] : ["submitted_pdf_not_linked"]),
          ...(pdfUrls.every((url) => acquisitionByUrl.get(url)?.status === "available") ? [] : ["submitted_pdf_acquisition_incomplete"]),
          ...(textQualities.some((entry) => entry?.status === "unusable") ? ["submitted_pdf_extracted_text_unusable"] : []),
          ...(ocrCandidates.some(Boolean) ? ["unreviewed_ocr_candidate_recorded"] : []),
          ...(textQualities.some((entry) => entry?.status === "degraded_review_needed") ? ["submitted_pdf_extracted_text_degraded"] : []),
          ...(acquisitions.some((entry, index) => entry?.status === "available" && !textQualities[index]) ? ["submitted_pdf_text_quality_audit_pending"] : []),
          ...(brief ? [] : ["source_checked_brief_pending"]),
          ...(reviewedBriefPdfStatus === "hash_changed" ? ["reviewed_brief_pdf_hash_changed"] : []),
          ...(reviewedBriefPdfStatus === "source_metadata_invalid" ? ["reviewed_brief_source_metadata_invalid"] : []),
          ...(reconciliationStatus === "hash_matched_provisional" ? [] : ["submitted_and_asr_reconciliation_pending"]),
          ...(deliveryWordingDiscrepancies.length ? ["delivered_wording_discrepancy_requires_review"] : []),
          "official_meeting_record_not_indexed",
        ],
      };
    }).sort((a, b) => a.countryName.localeCompare(b.countryName));
  const reviewQueue = rows.map((row) => {
    const stage = row.dateAlignment !== "same_day_affiliation_only" ? "reconcile_affiliation_date" as const
      : row.reviewedBriefPdfStatus === "hash_changed" ? "recheck_changed_pdf" as const
        : row.reviewedBriefPdfStatus === "source_metadata_invalid" ? "recheck_source_metadata" as const
        : row.submittedDocumentDateReview.status === "differs_from_official_page" ? "reconcile_submitted_document_date" as const
        : row.reviewedBriefPdfStatus === "manifest_pending" || row.reviewedBriefPdfStatus === "unavailable" ? "find_submitted_text" as const
        : !row.submittedPdfCount || !row.acquiredPdfCount ? "find_submitted_text" as const
          : row.unauditedTextCount ? "audit_extracted_text" as const
            : !row.reviewedBriefRevision && !row.screenableTextCount && row.unreviewedOcrCandidateCount ? "review_ocr_candidate" as const
              : !row.reviewedBriefRevision && !row.screenableTextCount ? "recover_extracted_text" as const
                : !row.reviewedBriefRevision ? "review_submitted_text" as const
                  : row.reconciliationStatus !== "hash_matched_provisional" ? "compare_provisional_recording" as const
                    : row.deliveryWordingDiscrepancies.length ? "resolve_delivery_discrepancy" as const
                      : row.reviewedBriefCoverage === "selected_assertions_only" ? "expand_reviewed_brief" as const
                      : "await_official_record" as const;
    const reason = stage === "reconcile_affiliation_date" ? "The official page and provisional affiliation do not have a documented same-day match; check attribution and coverage."
      : stage === "recheck_changed_pdf" ? "The reviewed source hash differs from the acquired PDF."
      : stage === "recheck_source_metadata" ? `The reviewed brief failed source admission: ${row.reviewedBriefAdmissionIssues.join(", ")}.`
      : stage === "reconcile_submitted_document_date" ? `The submitted document dates itself ${row.submittedDocumentDateReview.date}, while the official delegation page lists ${row.officialDates.join(", ")}. Check the UN meeting record or mission source before choosing an event date.`
      : stage === "find_submitted_text" ? "A submitted PDF was not linked or could not be acquired."
        : stage === "audit_extracted_text" ? "The extracted-text quality audit is missing or stale for an acquired PDF."
          : stage === "recover_extracted_text" ? "A PDF was acquired, but no extracted text passed the mechanical legibility screen; inspect the PDF or obtain OCR."
            : stage === "review_ocr_candidate" ? "An acquired PDF has OCR candidate metadata; locate the ignored review cache or regenerate OCR, then check wording against cited PDF pages."
              : stage === "review_submitted_text" ? "The submitted PDF is locally available, but no cited brief exists."
                : stage === "compare_provisional_recording" ? "A brief exists, but its provisional speech comparison is missing or stale."
                  : stage === "resolve_delivery_discrepancy" ? "The submitted PDF and provisional automated transcript differ on wording. Review the recording or official meeting record before using the affected assertion in a decision."
                  : stage === "expand_reviewed_brief" ? "Selected assertions were checked, but the full submitted speech has not received a source-bound review."
                    : "The submitted text and provisional segment have a limited comparison; official delivery remains unverified.";
    return { countryIso3: row.countryIso3, stage, reason,
      blockingAssertionIds: row.deliveryWordingDiscrepancies.map((item) => item.assertionId),
      sourceUrls: [...new Set([
        ...officialPages.pages.filter((page) => page.countryIso3 === row.countryIso3).map((page) => page.pageUrl),
        ...row.submittedSources.map((source) => source.sourceUrl),
        ...(row.submittedDocumentDateReview.sourcePageUrl ? [row.submittedDocumentDateReview.sourcePageUrl] : []),
        ...row.deliveryWordingDiscrepancies.flatMap((item) => [item.submittedPdfPageUrl,
          item.provisionalTranscriptUrl, ...(item.publishedSpeechUrl ? [item.publishedSpeechUrl] : [])]),
        ...(row.deliveryWordingDiscrepancies.length
          ? [reconciliationPilot.countries.find((entry) => entry.countryIso3 === row.countryIso3)?.recordingReview?.sourceUrl]
            .filter((sourceUrl): sourceUrl is string => !!sourceUrl) : []),
      ])] };
  }).sort((a, b) => {
    const rank = ["resolve_delivery_discrepancy", "reconcile_affiliation_date", "recheck_changed_pdf", "recheck_source_metadata", "reconcile_submitted_document_date", "audit_extracted_text", "review_ocr_candidate", "recover_extracted_text", "review_submitted_text", "compare_provisional_recording", "expand_reviewed_brief", "find_submitted_text", "await_official_record"];
    return rank.indexOf(a.stage) - rank.indexOf(b.stage) || a.countryIso3.localeCompare(b.countryIso3);
  });
  const officialDelegationPages = officialPages.pages.filter((page) => page.countryIso3 && /^[A-Z]{3}$/.test(page.countryIso3));
  const provisionalNonDelegationCodes = [...new Set(segments.map((segment) => segment.speaker.affiliationIso3)
    .filter((code): code is string => code === "GA" || code === "UN"))].sort();
  const missingOrDateMismatchedProvisionalAffiliations = rows
    .filter((row) => row.dateAlignment !== "same_day_affiliation_only").map((row) => row.countryIso3);
  const topicCoverage = reviewedTopicInventory.map((topic) => {
    const countriesWithAdmittedSelectedAssertions = rows.flatMap((row) => {
      if (row.reviewedBriefCoverage !== "selected_assertions_only") return [];
      const brief = reviewedBriefs.briefs.find((item) => item.countryIso3 === row.countryIso3);
      if (!brief) return [];
      const assertions = brief.assertions.filter((assertion) => (topic.assertionIds as readonly string[]).includes(assertion.id))
        .map((assertion) => ({ id: assertion.id, sourcePage: assertion.sourcePage,
          sourceUrl: `${brief.sourceUrl}#page=${assertion.sourcePage}` }));
      return assertions.length ? [{ countryIso3: row.countryIso3, briefRevision: brief.revision, assertions }] : [];
    });
    const admittedIds = new Set(countriesWithAdmittedSelectedAssertions.flatMap((country) =>
      country.assertions.map((assertion) => assertion.id)));
    const coveredIso3s = new Set(countriesWithAdmittedSelectedAssertions.map((country) => country.countryIso3));
    return {
      id: topic.id, label: topic.label, issueId: topic.issueId,
      indexedDelegationPageCount: rows.length,
      countriesWithAdmittedSelectedAssertions,
      countriesWithoutAdmittedSelectedAssertions: rows.filter((row) => !coveredIso3s.has(row.countryIso3))
        .map((row) => row.countryIso3),
      inventoryAssertionIdsNotAdmitted: topic.assertionIds.filter((id) => !admittedIds.has(id)),
      interpretation: "A selected, hash-matched assertion is a dated submitted-text topic mention. A country without one may have an unreviewed statement or an uncovered passage; silence, opposition, and bilateral relevance are not established." as const,
    };
  });
  return unga81CoverageLedgerSchema.parse({
    schemaVersion: "civilization_unga81_coverage_ledger/v18",
    sourceListingUrl: corpus.sourceListingUrl,
    officialPageSitemapUrl: officialPages.sitemapUrl,
    submittedPdfManifestGeneratedAt: submittedPdfManifest.generatedAt,
    textQualityManifestGeneratedAt: textQualityManifest.generatedAt,
    textQualityAuditStatus: textQualityAuditCurrent ? "current" : "stale_source_manifest",
    ocrCandidateManifestGeneratedAt: ocrCandidateManifest.generatedAt,
    ocrCandidateAuditStatus: ocrAuditCurrent ? "current" : "stale_source_manifest",
    officialMeetingRecordStatus: "not_indexed",
    rosterReconciliation: {
      reportedSpeakingDelegations: {
        count: 194,
        sourceUrl: "https://www.un.org/pga/81/documents/speeches/close-of-the-general-debate-28-september-2026/",
      },
      officialDelegationPageCount: officialDelegationPages.length,
      countryOrObserverAffiliationPageCount: officialDelegationPages.filter((page) => page.countryIso3 !== "EUR").length,
      institutionalDelegationPages: officialDelegationPages.filter((page) => page.countryIso3 === "EUR")
        .map((page) => ({ affiliationCode: "EUR", provisionalAffiliationCode: "EU",
          label: page.label, pageUrl: page.pageUrl })),
      uncodedOfficialPages: officialPages.pages.filter((page) => !page.countryIso3)
        .map((page) => ({ label: page.label, pageUrl: page.pageUrl })),
      sameDayProvisionalAffiliationMatches: rows.length - missingOrDateMismatchedProvisionalAffiliations.length,
      missingOrDateMismatchedProvisionalAffiliations,
      provisionalNonDelegationCodes,
      countRelation: officialDelegationPages.length === 194
        ? "count_matches_identity_not_verified" : "count_differs_review_needed",
      identityAndDeliveryStatus: "not_verified_to_recording_or_official_meeting_record",
    },
    positionCoverage: {
      delegationPagesWithHashMatchedSelectedBrief: rows.filter((row) => row.reviewedBriefCoverage === "selected_assertions_only").length,
      selectedReviewedAssertionCount: rows.reduce((sum, row) => sum + row.reviewedAssertionCount, 0),
      delegationPagesWithoutHashMatchedSelectedBrief: rows.filter((row) => row.reviewedBriefCoverage === "none").length,
      fullSpeechAssertionReviewStatus: "not_issued_in_current_manifest",
      interpretation: "Selected reviewed assertions are not a complete national position or a verified delivered speech.",
      topics: topicCoverage,
    },
    rows,
    reviewQueue,
    interpretationLimits: [
      "Rows represent indexed three-letter affiliations, including observers where present; they are not a verified member-state roster.",
      "A matching code and source hash do not prove exact delivered wording or correct speaker attribution.",
      "Same-day alignment only pairs a page date with an ASR affiliation label; it does not verify who spoke in the recording.",
      "A downloaded PDF and a matching extracted-text hash do not prove the text is legible; the quality screen is mechanical and does not replace language or source review.",
      "PDF filename suffixes are language hints, not verified language or translation relationships; each cited assertion needs source-page review.",
      "OCR candidate metadata does not guarantee the ignored OCR cache is present on this host; candidate text can misread, omit, or reorder words and is not a verified speech transcript.",
      "Official UN meeting records, translation status, and missing statements require separate review.",
    ],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  });
}

export const unga81CountryQuerySchema = z.object({ countryIso3: z.string().regex(/^[A-Z]{3}$/) }).strict();
export const unga81PairQuerySchema = z.object({
  firstCountryIso3: z.string().regex(/^[A-Z]{3}$/),
  secondCountryIso3: z.string().regex(/^[A-Z]{3}$/),
}).strict().refine((value) => value.firstCountryIso3 !== value.secondCountryIso3);

const sourceSegmentSchema = z.object({
  date: z.string(),
  speakerAffiliationLabel: z.string(),
  speakerFunction: z.string().nullable(),
  sourceUrl: z.string().url(),
  textSha256: z.string(),
  characterCount: z.number().int().nonnegative(),
}).strict();

const priorityCandidateSchema = z.object({
  sourceUrl: z.string().url(),
  text: z.string(),
  extraction: z.literal("literal ASR sentence selected by phrase rule; unreviewed"),
}).strict();
const topicMentionSchema = z.object({
  topic: z.string(), sentenceMentions: z.number().int().nonnegative(),
  exampleSourceUrl: z.string().url(), extraction: z.literal("automated English keyword count; unreviewed"),
}).strict();

export const unga81CountryEvidenceSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_country_evidence/v12"),
  countryIso3: z.string(),
  countryName: z.string().nullable(),
  corpus: z.object({
    debate: z.literal("81st UN General Assembly General Debate"),
    transcriptKind: z.literal("provisional automated speech recognition"),
    officialRecord: z.literal(false),
    collectedAt: z.string(),
    listingUrl: z.string().url(),
    reviewStatus: z.literal("unreviewed"),
  }).strict(),
  submittedStatements: z.array(z.object({
    label: z.string(), pageUrl: z.string().url(), date: z.string().nullable(),
    officialSpeakerDescription: z.string(),
    speakerAttributionStatus: z.literal("official_page_description_not_matched_to_asr_segment"),
    pdfUrls: z.array(z.string().url()), status: z.enum(["available", "not_linked"]),
    sourceKind: z.literal("official General Debate page; submitted statement, not reconciled to delivery"),
  }).strict()),
  sourceCrosswalk: z.object({
    officialDates: z.array(z.string().date()), provisionalDates: z.array(z.string().date()),
    dateAlignment: dateAlignmentSchema,
    submittedDocumentDateReview: z.object({
      status: z.enum(["not_recorded", "source_not_admitted", "official_page_date_missing",
        "matches_official_page", "differs_from_official_page"]),
      date: z.string().max(64).nullable(), sourcePageUrl: z.string().url().nullable(),
    }).strict(),
    speakerAttributionStatus: z.literal("not_verified_to_recording"),
  }).strict(),
  submittedTextQuality: z.array(z.object({
    sourceUrl: z.string().url(),
    status: z.enum(["screenable", "degraded_review_needed", "unusable", "not_audited", "not_acquired"]),
    reasonCodes: z.array(z.string()),
  }).strict()),
  submittedOcrCandidates: z.array(z.object({
    sourceUrl: z.string().url(), status: z.literal("unreviewed_source_review_aid"),
    pageCount: z.number().int().positive(), lineCount: z.number().int().nonnegative(),
    meanConfidence: z.number().nullable(),
  }).strict()),
  reviewedBrief: z.object({
    speaker: z.string(), speakerRole: z.string(),
    speakerAttributionSource: z.enum(["submitted_pdf_and_official_page", "official_page_only"]),
    speechDate: z.string(), sourceType: z.string(),
    sourceUrl: z.string().url(), sourceLanguage: z.string(), sourceSha256: z.string(),
    sourceReviewMethod: z.enum(["visual_pdf_pages_after_ocr_triage"]).nullable(),
    reviewedAt: z.string(), revision: z.number().int().positive(),
    reviewScope: z.literal("selected submitted PDF paraphrases checked; full speech, delivery, and external facts unverified"),
    assertions: z.array(z.object({
      id: z.string(), claimType: z.string(), text: z.string(), sourcePage: z.number().int().positive(),
      sourceUrl: z.string().url(), reviewDisposition: z.literal("supported_by_submitted_text"),
      temporalScope: z.string(), uncertainty: z.string(),
    }).strict()),
  }).strict().nullable(),
  reconciliation: z.object({
    reviewedAt: z.string(), method: z.string(), provisionalTranscriptUrl: z.string().url(),
    recordingReview: unga81RecordingReviewSchema.nullable(),
    speakerAndDateMatchIndexedPage: z.boolean(), officialMeetingRecordStatus: z.literal("not_reconciled"),
    assertions: z.array(z.object({ assertionId: z.string(), alignment: z.enum(["topic_consistent", "wording_discrepancy"]), note: z.string(),
      publishedSpeechCorroboration: z.object({ publisher: z.string(), sourceUrl: z.string().url(),
        publishedDate: z.string().date(), reviewedDate: z.string().date(), finding: z.string(),
        deliveryStatus: z.literal("not_verified_to_recording_or_official_meeting_record") }).strict().optional(),
    }).strict()),
  }).strict().nullable(),
  coverage: z.object({ speakerSegments: z.number().int().nonnegative(), substantiveSegments: z.number().int().nonnegative() }).strict(),
  segments: z.array(sourceSegmentSchema),
  priorityCandidates: z.array(priorityCandidateSchema),
  topicMentions: z.array(topicMentionSchema),
  missingEvidence: z.array(z.string()),
  interpretationLimits: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false) }).strict(),
}).strict();
export type Unga81CountryEvidence = z.infer<typeof unga81CountryEvidenceSchema>;

export const plannedJointVentureSchema = z.object({
  status: z.literal("intended_subject_to_charter_and_shareholders_agreement"),
  sourceSection: z.literal("Article 3(2)-(3)"),
  initialOwnership: z.array(z.object({ stakeholder: z.string(), percent: z.number().min(0).max(100) }).strict()).length(2),
  conditionalExtension: z.object({
    initialTermYears: z.number().int().positive(), additionalTermYears: z.number().int().positive(),
    armeniaOwnershipPercentOnExtension: z.number().min(0).max(100),
    condition: z.literal("mutual_consent_to_extend_rights_at_initial_term_expiration"),
  }).strict(),
  interpretationLimit: z.string(),
}).strict();

const governmentRecordSchema = z.object({
  id: z.string(), kind: z.string(), eventDate: z.string(), parties: z.array(z.string().regex(/^[A-Z]{3}$/)).min(2),
  legalStatus: z.enum(["declaration_only", "initialed_not_in_force", "entry_into_force_unverified", "meeting_report_only"]),
  statusAsOf: z.string().date(), statusEvidenceUrls: z.array(z.string().url()).min(1),
  sourceSections: z.array(z.string()), sourcePublisher: z.string(),
  sourceUrl: z.string().url(), corroboratingSources: z.array(z.object({ sourcePublisher: z.string(), sourceUrl: z.string().url() }).strict()),
  milestones: z.array(z.object({ date: z.string().date(), kind: z.string(),
    summary: z.string(), sourceUrl: z.string().url() }).strict()).optional(),
  summary: z.string(), conditions: z.array(z.string()),
  thirdPartyDependencies: z.array(z.object({ partyIso3: z.string().nullable(), role: z.string() }).strict()),
  reportedMeasures: z.array(z.object({ metric: z.string(), value: z.number().nonnegative(),
    unit: z.string(), qualifier: z.string(), period: z.string(),
    independentVerification: z.literal("not_verified") }).strict()).optional(),
  plannedJointVenture: plannedJointVentureSchema.optional(),
  limits: z.string(),
}).strict();

export const unga81PairEvidenceSchema = z.object({
  schemaVersion: z.literal("civilization_unga81_pair_evidence/v13"),
  countries: z.tuple([unga81CountryEvidenceSchema, unga81CountryEvidenceSchema]),
  thirdPartyPositions: z.array(z.object({
    countryIso3: z.string(), speaker: z.string(), speechDate: z.string(),
    speakerAttributionSource: z.enum(["submitted_pdf_and_official_page", "official_page_only"]),
    sourceKind: z.literal("source-checked submitted statement; delivery unverified"),
    permissionOrConstraintEffect: z.literal("unassessed"),
    assertions: z.array(z.object({
      id: z.string(), claimType: z.string(), text: z.string(), sourceUrl: z.string().url(),
      sourcePage: z.number().int().positive(), reviewRevision: z.number().int().positive(),
      reviewDisposition: z.literal("supported_by_submitted_text"), temporalScope: z.string(), uncertainty: z.string(),
    }).strict()),
  }).strict()),
  bilateralEvidence: z.object({
    reviewScope: z.string(),
    records: z.array(governmentRecordSchema),
  }).strict(),
  dependentGovernmentEvidence: z.object({
    reviewScope: z.string(),
    records: z.array(governmentRecordSchema),
  }).strict(),
  multilateralGovernmentEvidence: z.object({
    reviewScope: z.string(),
    records: z.array(governmentRecordSchema),
  }).strict(),
  measuredBilateralTrade: z.literal("not_in_this_corpus"),
  assessedCooperation: z.literal("not_in_this_corpus"),
  optimalScenario: z.literal("not_evaluated"),
  thirdCountryConstraints: z.literal("not_evaluated"),
  missingEvidence: z.array(z.string()),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false) }).strict(),
}).strict();

export function readUnga81CountryEvidence(input: unknown): Unga81CountryEvidence {
  const { countryIso3 } = unga81CountryQuerySchema.parse(input);
  const matches = corpus.meetings.flatMap((meeting) => meeting.statements
    .filter((statement) => statement.speaker.affiliationIso3 === provisionalAffiliationCode(countryIso3))
    .map((statement) => ({ meeting, statement })));
  const substantive = matches.filter(({ statement }) => statement.characterCount >= 1000);
  const submittedStatements = officialPages.pages.filter((page) => page.countryIso3 === countryIso3);
  const submittedTextQuality = submittedStatements.flatMap((page) => page.pdfUrls.map((sourceUrl) => {
    const quality = currentTextQuality(sourceUrl);
    const auditedStatus = quality?.status === "missing_or_changed" ? null : quality?.status;
    return { sourceUrl,
      status: auditedStatus ?? (acquisitionByUrl.get(sourceUrl)?.status === "available" ? "not_audited" as const : "not_acquired" as const),
      reasonCodes: quality?.reasonCodes ?? [] };
  }));
  const submittedOcrCandidates = submittedStatements.flatMap((page) => page.pdfUrls.flatMap((sourceUrl) => {
    const candidate = currentOcrCandidate(sourceUrl);
    return candidate ? [{ sourceUrl, status: "unreviewed_source_review_aid" as const,
      pageCount: candidate.pageCount, lineCount: candidate.lineCount, meanConfidence: candidate.meanConfidence }] : [];
  }));
  const officialDates = [...new Set(submittedStatements.map((page) => page.date).filter((date): date is string => !!date))].sort();
  const provisionalDates = [...new Set(matches.map(({ meeting }) => meeting.date))].sort();
  const dateAlignment = !submittedStatements.length ? "official_page_missing" as const
    : !officialDates.length ? "official_page_date_missing" as const
      : !provisionalDates.length ? "provisional_segment_missing" as const
        : officialDates.some((date) => provisionalDates.includes(date))
          ? "same_day_affiliation_only" as const : "date_mismatch" as const;
  const reviewedBriefCandidate = reviewedBriefs.briefs.find((brief) => brief.countryIso3 === countryIso3);
  const briefAdmission = assessReviewedBriefAdmission(reviewedBriefCandidate);
  const reviewedBriefPdfChanged = briefAdmission.status === "hash_changed";
  const reviewedBriefSourceCurrent = briefAdmission.status === "hash_matched";
  const reviewedBrief = reviewedBriefSourceCurrent ? reviewedBriefCandidate : undefined;
  const submittedDocumentDate = reviewedBriefCandidate?.submittedDocumentDate;
  const submittedDocumentDateReview = {
    status: !submittedDocumentDate ? "not_recorded" as const
      : !reviewedBriefSourceCurrent ? "source_not_admitted" as const
        : !officialDates.length ? "official_page_date_missing" as const
          : officialDates.includes(submittedDocumentDate.date) ? "matches_official_page" as const
            : "differs_from_official_page" as const,
    date: submittedDocumentDate?.date ?? null,
    sourcePageUrl: submittedDocumentDate && reviewedBriefCandidate
      ? `${reviewedBriefCandidate.sourceUrl}#page=${submittedDocumentDate.sourcePage}` : null,
  };
  const reconciliationCandidate = reconciliationPilot.countries.find((entry) => entry.countryIso3 === countryIso3);
  const reconciliation = reconciliationCandidate && reviewedBrief &&
    reconciliationCandidate.submittedPdfSha256 === reviewedBrief.sourceSha256 &&
    matches.some(({ statement }) => statement.textSha256 === reconciliationCandidate.provisionalTranscriptSha256 &&
      statement.sourceUrl === reconciliationCandidate.provisionalTranscriptUrl) ? reconciliationCandidate : null;
  const sourceSegments = substantive.length ? substantive : matches;
  const topicCounts = new Map<string, { topic: string; sentenceMentions: number; exampleSourceUrl: string; extraction: "automated English keyword count; unreviewed" }>();
  for (const { statement } of sourceSegments) {
    for (const [topic, count] of Object.entries(statement.topicCounts)) {
      if (!count) continue;
      const entry = topicCounts.get(topic) ?? { topic, sentenceMentions: 0,
        exampleSourceUrl: statement.sourceUrl, extraction: "automated English keyword count; unreviewed" as const };
      entry.sentenceMentions += count;
      topicCounts.set(topic, entry);
    }
  }
  const topicMentions = [...topicCounts.values()]
    .sort((a, b) => b.sentenceMentions - a.sentenceMentions || a.topic.localeCompare(b.topic));
  const result: Unga81CountryEvidence = {
    schemaVersion: "civilization_unga81_country_evidence/v12",
    countryIso3,
    countryName: submittedStatements[0]?.label ??
      matches.find(({ statement }) => statement.speaker.affiliationName)?.statement.speaker.affiliationName ?? null,
    corpus: {
      debate: "81st UN General Assembly General Debate",
      transcriptKind: "provisional automated speech recognition",
      officialRecord: false,
      collectedAt: corpus.collectedAt,
      listingUrl: corpus.sourceListingUrl,
      reviewStatus: "unreviewed",
    },
    submittedStatements: submittedStatements.map((page) => ({
      label: page.label, pageUrl: page.pageUrl, date: page.date,
      officialSpeakerDescription: page.description,
      speakerAttributionStatus: "official_page_description_not_matched_to_asr_segment" as const,
      pdfUrls: page.pdfUrls, status: page.submittedStatementStatus,
      sourceKind: "official General Debate page; submitted statement, not reconciled to delivery" as const,
    })),
    sourceCrosswalk: { officialDates, provisionalDates, dateAlignment, submittedDocumentDateReview,
      speakerAttributionStatus: "not_verified_to_recording" },
    submittedTextQuality,
    submittedOcrCandidates,
    reviewedBrief: reviewedBrief ? {
      speaker: reviewedBrief.speaker, speakerRole: reviewedBrief.speakerRole,
      speakerAttributionSource: reviewedBrief.speakerAttributionSource,
      speechDate: reviewedBrief.speechDate, sourceType: reviewedBrief.sourceType,
      sourceUrl: reviewedBrief.sourceUrl, sourceLanguage: reviewedBrief.sourceLanguage,
      sourceReviewMethod: reviewedBrief.sourceReviewMethod ?? null,
      sourceSha256: reviewedBrief.sourceSha256, reviewedAt: reviewedBrief.reviewedAt,
      revision: reviewedBrief.revision,
      reviewScope: "selected submitted PDF paraphrases checked; full speech, delivery, and external facts unverified",
      assertions: reviewedBrief.assertions.map((assertion) => ({ ...assertion,
        sourceUrl: `${reviewedBrief.sourceUrl}#page=${assertion.sourcePage}` })),
    } : null,
    reconciliation: reconciliation ? {
      reviewedAt: reconciliationPilot.reviewedAt, method: reconciliationPilot.method,
      provisionalTranscriptUrl: reconciliation.provisionalTranscriptUrl,
      recordingReview: reconciliation.recordingReview ?? null,
      speakerAndDateMatchIndexedPage: reconciliation.speakerAndDateMatchIndexedPage,
      officialMeetingRecordStatus: reconciliation.officialMeetingRecordStatus,
      assertions: reconciliation.assertions,
    } : null,
    coverage: { speakerSegments: matches.length, substantiveSegments: substantive.length },
    segments: sourceSegments.map(({ meeting, statement }) => ({
      date: meeting.date,
      speakerAffiliationLabel: statement.speaker.affiliationName ?? countryIso3,
      speakerFunction: statement.speaker.function,
      sourceUrl: statement.sourceUrl,
      textSha256: statement.textSha256,
      characterCount: statement.characterCount,
    })),
    priorityCandidates: [],
    topicMentions,
    missingEvidence: [
      ...(matches.length ? [] : ["No segment with this affiliation code was found in the six provisional recordings."]),
      ...(submittedStatements.length ? [] : ["No matching official General Debate page was found in the indexed sitemap."]),
      ...(submittedStatements.some((page) => page.pdfUrls.length > 0) ? [] : ["No submitted PDF was linked on the indexed official page at collection time."]),
      ...(submittedDocumentDateReview.status === "differs_from_official_page"
        ? ["The date printed in the submitted PDF differs from the official delegation-page date; check the meeting record before interpreting the event date."] : []),
      ...(submittedTextQuality.some((entry) => entry.status === "unusable") && !reviewedBrief ? ["At least one acquired submitted PDF has unusable extracted text; inspect the PDF or obtain OCR before text-based review."] : []),
      ...(submittedOcrCandidates.length && !reviewedBrief ? ["OCR candidate metadata exists for an acquired PDF; the ignored OCR cache may be absent on this host, and words require page-by-page source review before a country brief can use them."] : []),
      ...(reviewedBrief?.sourceReviewMethod === "visual_pdf_pages_after_ocr_triage" ? ["The extracted text remains unusable; selected assertions were reviewed against the cited scanned PDF pages after OCR navigation."] : []),
      ...(submittedTextQuality.some((entry) => entry.status === "degraded_review_needed") ? ["At least one extracted PDF text has quality warnings and needs manual source inspection."] : []),
      ...(submittedTextQuality.some((entry) => entry.status === "not_audited") ? ["An acquired PDF has no current extracted-text quality audit."] : []),
      "Submitted statement and official meeting record have not been reconciled with this automated transcript.",
      ...(reviewedBriefCandidate ? [] : ["No source-checked country brief has been issued."]),
      ...(reviewedBriefPdfChanged ? ["A source-checked brief was withheld because the acquired submitted PDF hash changed; its assertions need renewed review."] : []),
      ...(briefAdmission.status === "source_metadata_invalid" ? [`A source-checked brief was withheld because its source admission failed: ${briefAdmission.issues.join(", ")}.`] : []),
      ...(reviewedBriefCandidate && !reviewedBriefSourceCurrent && !reviewedBriefPdfChanged &&
        briefAdmission.status !== "source_metadata_invalid" ? ["A source-checked brief was withheld because its submitted PDF is not currently available with the reviewed hash."] : []),
      ...(reviewedBrief ? ["The source-checked brief has not been reconciled with the delivered speech or external facts."] : []),
      ...(reviewedBrief ? ["This brief covers selected assertions; the full submitted speech has not received an assertion-by-assertion review."] : []),
      ...(reconciliationCandidate && !reconciliation ? ["Pilot reconciliation no longer matches the submitted PDF or provisional transcript hash and needs renewed review."] : []),
      "Current trade, treaty, infrastructure, and third-country constraints require independent sources.",
    ],
    interpretationLimits: [
      "Speaker identification and wording may contain recognition errors.",
      "No unreviewed transcript wording is redistributed in this evidence packet; open the source moment or use a source-checked brief.",
      "Topic counts are English keyword matches in automated transcripts, not comparable policy priorities; speech length and translation affect counts.",
      "A dated speech does not by itself establish current bilateral cooperation or feasible future projects.",
    ],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  };
  return unga81CountryEvidenceSchema.parse(result);
}

export function readUnga81PairEvidence(input: unknown) {
  const query = unga81PairQuerySchema.parse(input);
  const pair = bilateralPilot.pairs.find((entry) =>
    entry.countries.includes(query.firstCountryIso3) && entry.countries.includes(query.secondCountryIso3));
  const selectedCountries = [query.firstCountryIso3, query.secondCountryIso3];
  const bilateralRecords = (pair?.records ?? []).filter((record) =>
    record.parties.length === 2 && selectedCountries.every((country) => record.parties.includes(country)));
  const dependentRecords = (pair?.records ?? []).filter((record) => record.parties.length === 2 && !bilateralRecords.includes(record));
  const multilateralRecords = (pair?.records ?? []).filter((record) => record.parties.length > 2 &&
    selectedCountries.every((country) => record.parties.includes(country)));
  const thirdPartyPositions = (pair?.thirdPartyBriefRefs ?? []).flatMap((reference) => {
    const brief = readUnga81CountryEvidence({ countryIso3: reference.countryIso3 }).reviewedBrief;
    if (!brief) return [];
    return [{
      countryIso3: reference.countryIso3, speaker: brief.speaker, speechDate: brief.speechDate,
      speakerAttributionSource: brief.speakerAttributionSource,
      sourceKind: "source-checked submitted statement; delivery unverified" as const,
      permissionOrConstraintEffect: "unassessed" as const,
      assertions: brief.assertions.filter((assertion) => reference.assertionIds.includes(assertion.id))
        .map(({ id, claimType, text, sourceUrl, sourcePage, reviewDisposition, temporalScope, uncertainty }) =>
          ({ id, claimType, text, sourceUrl, sourcePage, reviewRevision: brief.revision,
            reviewDisposition, temporalScope, uncertainty })),
    }];
  });
  return unga81PairEvidenceSchema.parse({
    schemaVersion: "civilization_unga81_pair_evidence/v13",
    countries: [readUnga81CountryEvidence({ countryIso3: query.firstCountryIso3 }),
      readUnga81CountryEvidence({ countryIso3: query.secondCountryIso3 })],
    thirdPartyPositions,
    bilateralEvidence: { reviewScope: bilateralPilot.reviewScope, records: bilateralRecords },
    dependentGovernmentEvidence: { reviewScope: bilateralPilot.reviewScope, records: dependentRecords },
    multilateralGovernmentEvidence: { reviewScope: bilateralPilot.reviewScope, records: multilateralRecords },
    measuredBilateralTrade: "not_in_this_corpus",
    assessedCooperation: "not_in_this_corpus",
    optimalScenario: "not_evaluated",
    thirdCountryConstraints: "not_evaluated",
    missingEvidence: [
      "Independent bilateral trade flows and years are required before current cooperation can be assessed.",
      "Treaty status, permissions, sanctions, capacities, and route constraints need dated primary evidence.",
      ...(pair ? ["The pilot government publications do not independently verify corridor operations, local consent, or environmental feasibility."] :
        ["No source-checked bilateral record is in the pilot ledger for this pair."]),
      ...(pair?.thirdPartyBriefRefs.length && thirdPartyPositions.length !== pair.thirdPartyBriefRefs.length
        ? ["A referenced third-party submitted-statement brief is missing or withheld after a source change."] : []),
      "Third-party statements provide dated positions, not transit rights, consent, or evidence of a veto.",
      "An optimal scenario requires a stated objective and explicit constraints; none is inferred from two speeches.",
    ],
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  });
}
