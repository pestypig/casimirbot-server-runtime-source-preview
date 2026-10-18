import { AsyncLocalStorage } from "node:async_hooks";
import type { HelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS } from "@shared/helix-environment-connector";

export type HelixExternalCapabilityPolicy = {
  runId: string;
  tenantId: string;
  issuer?: string;
  subjectId?: string;
  accountProfileId: string;
  accountType: "developer" | "user";
  oauthScopes?: ReadonlySet<string>;
  accountPolicy?: HelixAccountCapabilityPolicy;
  allowedCapabilities: readonly string[];
  readOnly: true;
  signal?: AbortSignal;
  deadlineAt?: string;
};

const policyStorage = new AsyncLocalStorage<HelixExternalCapabilityPolicy>();

const normalized = (value: string): string => value.trim().toLowerCase();

const cancellationMessage = (signal: AbortSignal): string => {
  const reason = signal.reason;
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  return "agent_run_cancelled";
};

export const assertHelixExternalExecutionActive = (
  policy:
    | Pick<HelixExternalCapabilityPolicy, "signal" | "deadlineAt">
    | null
    | undefined,
  nowMs = Date.now(),
): void => {
  if (!policy) return;
  if (policy.signal?.aborted) {
    throw new Error(cancellationMessage(policy.signal));
  }
  if (policy.deadlineAt) {
    const deadlineMs = Date.parse(policy.deadlineAt);
    if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
      throw new Error("helix_ask_timeout");
    }
  }
};

export const assertCurrentHelixExternalExecutionActive = (): void => {
  assertHelixExternalExecutionActive(policyStorage.getStore());
};

/*
 * A deployment or caller may narrow this set, but may not expand it. Keeping
 * the read-only ceiling in code prevents a scope/configuration typo from
 * admitting an action merely because its ID was placed in allowedCapabilities.
 */
export const HELIX_EXTERNAL_AGENT_READ_ONLY_CAPABILITY_IDS =
  new Set<string>([
    "internet-search.search_web",
    "scholarly-research.lookup_papers",
    "scholarly-research.fetch_full_text",
    "scholarly-research.extract_numeric_parameters",
    "research-library.read_document",
    "repo-code.search_concept",
    "repo.search",
    "docs.search",
    "docs-viewer.search_docs",
    "docs-viewer.validate_doc_candidates",
    "docs-viewer.summarize_doc",
    "docs-viewer.locate_in_doc",
    "docs-viewer.read_visible_surface",
    "docs-viewer.read_active_translation",
    "room.evidence.read_bound",
    "room.environment.probe",
    ...HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS,
    "helix_ask.reflect_theory_context",
    "theory-badge-graph.reflect_discussion_context",
  ].map(normalized));

export const helixExternalPolicyAllowsCapability = (
  policy: HelixExternalCapabilityPolicy,
  capabilityId: string,
): boolean => {
  assertHelixExternalExecutionActive(policy);
  const selected = normalized(capabilityId);
  if (
    !selected ||
    policy.readOnly !== true ||
    !HELIX_EXTERNAL_AGENT_READ_ONLY_CAPABILITY_IDS.has(selected)
  ) {
    return false;
  }
  return policy.allowedCapabilities.some(
    (entry) => normalized(entry) === selected,
  );
};

export const currentHelixExternalCapabilityPolicy =
  (): HelixExternalCapabilityPolicy | null => policyStorage.getStore() ?? null;

export const runWithHelixExternalCapabilityPolicy = <T>(
  policy: HelixExternalCapabilityPolicy,
  operation: () => T,
): T => policyStorage.run(policy, operation);
