import type { HelixLanguageReasoningEffort } from "@shared/helix-language-model-policy";

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const reasoningEfforts = new Set<HelixLanguageReasoningEffort>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export type CodexNativeResolvedModelPolicy = {
  model: string | null;
  reasoningEffort: HelixLanguageReasoningEffort | null;
  source: "language_model_policy" | "request" | "environment" | "codex_default";
  languageModelPolicy: Record<string, unknown> | null;
};

export const resolveCodexNativeModelPolicy = (
  body: Record<string, unknown>,
): CodexNativeResolvedModelPolicy => {
  const debug = readRecord(body.debug);
  const languageModelPolicy =
    readRecord(body.language_model_policy) ??
    readRecord(debug?.language_model_policy);
  const policyModel = readString(languageModelPolicy?.resolved_model);
  const policyEffort = readString(languageModelPolicy?.reasoning_effort);
  if (policyModel) {
    return {
      model: policyModel,
      reasoningEffort: reasoningEfforts.has(policyEffort as HelixLanguageReasoningEffort)
        ? (policyEffort as HelixLanguageReasoningEffort)
        : null,
      source: "language_model_policy",
      languageModelPolicy,
    };
  }

  const requestModel =
    readString(body.llm_model) ??
    readString(body.model) ??
    readString(body.language_model);
  const requestEffort =
    readString(body.reasoning_effort) ??
    readString(body.reasoningEffort);
  if (requestModel) {
    return {
      model: requestModel,
      reasoningEffort: reasoningEfforts.has(requestEffort as HelixLanguageReasoningEffort)
        ? (requestEffort as HelixLanguageReasoningEffort)
        : null,
      source: "request",
      languageModelPolicy,
    };
  }

  const environmentModel =
    readString(process.env.LLM_HTTP_MODEL) ??
    readString(process.env.LLM_LOCAL_MODEL) ??
    readString(process.env.HELIX_ASK_INTERPRETER_MODEL);
  return {
    model: environmentModel,
    reasoningEffort: null,
    source: environmentModel ? "environment" : "codex_default",
    languageModelPolicy,
  };
};
