import crypto from "node:crypto";
import type { InterfaceTranslationJobV1 } from "@shared/interface-translation-job";
import type { InterfaceMessageId } from "../../../client/src/lib/i18n/messages/types";

const jobs = new Map<string, InterfaceTranslationJobV1>();

const nowIso = (): string => new Date().toISOString();

export function hashInterfaceTranslationText(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildInterfaceTranslationJobId(locale: string, messageId: string, candidateText: string): string {
  const digest = hashInterfaceTranslationText(`${locale}:${messageId}:${candidateText}`).slice(0, 16);
  return `interface_i18n:${locale}:${messageId}:${digest}`;
}

export function upsertInterfaceTranslationJob(input: {
  locale: "haw";
  message_id: InterfaceMessageId;
  source_text: string;
  context: string;
  placeholders?: string[];
  glossary_terms?: string[];
  candidate_text: string;
  candidate_source: InterfaceTranslationJobV1["candidate_source"];
  checks: InterfaceTranslationJobV1["checks"];
  review?: Partial<InterfaceTranslationJobV1["review"]>;
}): InterfaceTranslationJobV1 {
  const jobId = buildInterfaceTranslationJobId(input.locale, input.message_id, input.candidate_text);
  const existing = jobs.get(jobId);
  const timestamp = nowIso();
  const job: InterfaceTranslationJobV1 = {
    schema: "casimir.interface_translation_job.v1",
    job_id: jobId,
    locale: input.locale,
    message_id: input.message_id,
    source_text: input.source_text,
    source_hash: hashInterfaceTranslationText(input.source_text),
    context: input.context,
    placeholders: input.placeholders ?? [],
    glossary_terms: input.glossary_terms ?? [],
    candidate_text: input.candidate_text,
    candidate_source: input.candidate_source,
    candidate_hash: hashInterfaceTranslationText(input.candidate_text),
    checks: input.checks,
    review: {
      status: input.review?.status ?? "draft",
      passworthy_score: input.review?.passworthy_score ?? 1,
      reviewer: input.review?.reviewer,
      notes: input.review?.notes,
    },
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
  jobs.set(jobId, job);
  return job;
}

export function listInterfaceTranslationJobs(): InterfaceTranslationJobV1[] {
  return [...jobs.values()].sort((left, right) => left.job_id.localeCompare(right.job_id));
}

export function resetInterfaceTranslationJobs(): void {
  jobs.clear();
}
