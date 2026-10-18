import crypto from "node:crypto";
import { HELIX_INTERNET_SEARCH_CAPABILITY } from "@shared/helix-internet-search-observation";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import { HELIX_WORKSPACE_OS_STATUS_CAPABILITY } from "../workspace-os-status-intent";
import { WORKSTATION_CONTEXT_FEED_QUERY_CAPABILITIES } from "../workstation-context-feed-query-tool-contracts";
import {
  HELIX_DOCS_OPEN_DOC_ALIAS_CAPABILITIES,
  HELIX_DOCS_OPEN_DOC_CAPABILITY,
  HELIX_DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
  HELIX_DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
  HELIX_DOCS_SEARCH_ALIAS_CAPABILITIES,
  HELIX_DOCS_SEARCH_CAPABILITY,
} from "../docs-capability-contract";
import {
  HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY,
  HELIX_THEORY_CONTEXT_REFLECTION_LEGACY_ALIASES,
} from "../theory-congruence/capability-contract";
import {
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
} from "../theory-experiment-procedure-intent";

export { WORKSTATION_CONTEXT_FEED_QUERY_CAPABILITIES } from "../workstation-context-feed-query-tool-contracts";
export { THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY } from "../theory-experiment-procedure-intent";

export const WORKSTATION_ACTIVE_CONTEXT_CAPABILITY = "workstation.active_context" as const;
export const CALCULATOR_SOLVE_EXPRESSION_CAPABILITY = "scientific-calculator.solve_expression" as const;
export const CALCULATOR_SOLVE_ALIAS_CAPABILITIES = [
  "scientific-calculator.solve",
  "scientific-calculator.solve_with_steps",
] as const;
export const CALCULATOR_ACTIVE_CONTEXT_CAPABILITY = "scientific-calculator.active_context" as const;
export const WORKSPACE_OS_STATUS_CAPABILITY = HELIX_WORKSPACE_OS_STATUS_CAPABILITY;
export const ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY = "account_session.set_interface_language" as const;
export const REPO_SEARCH_CAPABILITY = "repo.search" as const;
export const REPO_SEARCH_ALIAS_CAPABILITIES = [
  "repo-code.search_concept",
] as const;
export const DOCS_SEARCH_CAPABILITY = HELIX_DOCS_SEARCH_CAPABILITY;
export const DOCS_READ_VISIBLE_SURFACE_CAPABILITY = HELIX_DOCS_READ_VISIBLE_SURFACE_CAPABILITY;
export const DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY = HELIX_DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY;
export const DOCS_OPEN_DOC_CAPABILITY = HELIX_DOCS_OPEN_DOC_CAPABILITY;
export const CALCULATOR_READ_VISIBLE_RESULT_CAPABILITY = "scientific-calculator.read_visible_result" as const;
export const DOCS_SEARCH_ALIAS_CAPABILITIES = HELIX_DOCS_SEARCH_ALIAS_CAPABILITIES;
export const DOCS_OPEN_DOC_ALIAS_CAPABILITIES = HELIX_DOCS_OPEN_DOC_ALIAS_CAPABILITIES;
export const INTERNET_SEARCH_CAPABILITY = HELIX_INTERNET_SEARCH_CAPABILITY;
export const INTERNET_SEARCH_ALIAS_CAPABILITIES = [
  "internet_search.web_research",
] as const;
export const SCHOLARLY_RESEARCH_SEARCH_CAPABILITY = HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY;
export const SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY = HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY;
export const THEORY_CONTEXT_REFLECTION_CAPABILITY = HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY;
export const THEORY_BADGE_GRAPH_CURRENT_CONTEXT_CAPABILITY = "theory-badge-graph.current_context" as const;
export const THEORY_CONTEXT_REFLECTION_ALIAS_CAPABILITIES =
  HELIX_THEORY_CONTEXT_REFLECTION_LEGACY_ALIASES;
export const THEORY_FRONTIER_CONJECTURE_CAPABILITY = "theory-badge-graph.propose_frontier_conjectures" as const;
export const THEORY_FRONTIER_CONJECTURE_ALIAS_CAPABILITIES = [
  "propose_frontier_conjectures",
  "frontier_conjecture_workbench",
  "theory_frontier_conjectures",
] as const;
export const CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY = "civilization-bounds.reflect_system_bounds" as const;
export const CIVILIZATION_BOUNDS_REFLECTION_ALIAS_CAPABILITIES = [
  "helix_ask.reflect_civilization_bounds",
] as const;
export const MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY =
  "moral-graph.reflect_living_substrate_context" as const;
export const MORAL_GRAPH_REFLECTION_CAPABILITY = "moral-graph.reflect_context" as const;
export const MORAL_GRAPH_REFLECTION_ALIAS_CAPABILITIES = [
  "helix_ask.reflect_moral_graph",
  "moral_badge_locator",
  "moral_graph_reflection",
] as const;
export const TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY = "text_to_speech.speak_text" as const;
export const VOICE_INTERIM_CALLOUT_CAPABILITY = "live_env.request_interim_voice_callout" as const;
export const VOICE_NARRATOR_SAY_CAPABILITY = "live_env.narrator_say" as const;
export const LIVE_SOURCE_STATE_READ_CAPABILITIES = [
  "live_env.query_live_source_quality",
  "live_env.query_workstation_goal_context",
  "live_env.summarize_live_source_current_state",
] as const;
export const SITUATION_STAGE_STATE_READ_CAPABILITIES = [
  "live_env.query_event_log",
  "live_env.query_world_events",
  "live_env.query_navigation_state",
  "live_env.query_stage_sources",
  "live_env.query_constructs",
  "live_env.query_job_evidence",
] as const;
export const LIVE_SOURCE_MAILBOX_READ_CAPABILITIES = [
  "live_env.check_live_source_mail",
  "live_env.read_live_source_mail",
  "live_env.read_processed_live_source_mail",
  "live_env.reflect_live_source_mail_loop",
] as const;
export const LIVE_SOURCE_INTERPRETER_PREDICTION_READ_CAPABILITIES = [
  "live_env.compare_mail_to_interpreter_profile",
  "live_env.validate_live_source_prediction",
  "live_env.predict_live_source_immediate",
  "live_env.compare_live_source_prediction",
] as const;
export const STAGE_PLAY_BUILDER_READ_CAPABILITIES = [
  "live_env.describe_stage_builder",
  "live_env.validate_stage_play_graph",
  "live_env.plan_stage_play_job",
] as const;
export const VISUAL_OBSERVER_QUERY_PROFILES_CAPABILITY = "live_env.query_visual_observer_profiles" as const;
export const VISUAL_OBSERVER_TEST_PROFILE_CAPABILITY = "live_env.test_visual_observer_profile" as const;
export const VISUAL_OBSERVER_COMPARE_PROFILES_CAPABILITY = "live_env.compare_visual_observer_profiles" as const;
export const PROMPT_NAMED_CAPABILITIES = [
  WORKSPACE_OS_STATUS_CAPABILITY,
  ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY,
  DOCS_SEARCH_CAPABILITY,
  DOCS_OPEN_DOC_CAPABILITY,
  ...DOCS_SEARCH_ALIAS_CAPABILITIES,
  ...DOCS_OPEN_DOC_ALIAS_CAPABILITIES,
  REPO_SEARCH_CAPABILITY,
  ...REPO_SEARCH_ALIAS_CAPABILITIES,
  CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
  ...CALCULATOR_SOLVE_ALIAS_CAPABILITIES,
  THEORY_CONTEXT_REFLECTION_CAPABILITY,
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
  THEORY_FRONTIER_CONJECTURE_CAPABILITY,
  CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
  MORAL_GRAPH_REFLECTION_CAPABILITY,
  MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
  SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
  SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  INTERNET_SEARCH_CAPABILITY,
  ...INTERNET_SEARCH_ALIAS_CAPABILITIES,
  ...THEORY_CONTEXT_REFLECTION_ALIAS_CAPABILITIES,
  ...THEORY_FRONTIER_CONJECTURE_ALIAS_CAPABILITIES,
  ...CIVILIZATION_BOUNDS_REFLECTION_ALIAS_CAPABILITIES,
  ...MORAL_GRAPH_REFLECTION_ALIAS_CAPABILITIES,
  TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
  VOICE_INTERIM_CALLOUT_CAPABILITY,
  VOICE_NARRATOR_SAY_CAPABILITY,
  ...WORKSTATION_CONTEXT_FEED_QUERY_CAPABILITIES,
  ...LIVE_SOURCE_STATE_READ_CAPABILITIES,
  ...SITUATION_STAGE_STATE_READ_CAPABILITIES,
  ...LIVE_SOURCE_MAILBOX_READ_CAPABILITIES,
  ...LIVE_SOURCE_INTERPRETER_PREDICTION_READ_CAPABILITIES,
  ...STAGE_PLAY_BUILDER_READ_CAPABILITIES,
  VISUAL_OBSERVER_QUERY_PROFILES_CAPABILITY,
  VISUAL_OBSERVER_TEST_PROFILE_CAPABILITY,
  VISUAL_OBSERVER_COMPARE_PROFILES_CAPABILITY,
] as const;
export const MAX_PROMPT_NAMED_CAPABILITY_REQUESTS = 24;

export const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const readHelixAgentTurnId = (body: Record<string, unknown>): string =>
  readString(body.turn_id) ?? readString(body.turnId) ?? `ask:agent-provider:${crypto.randomUUID()}`;

export const readExplicitWorkstationGatewayCallRequests = (
  body: Record<string, unknown>,
): Record<string, unknown>[] => {
  const calls = body.workstation_gateway_calls ?? body.workstationGatewayCalls;
  const call = body.workstation_gateway_call ?? body.workstationGatewayCall;
  return [
    ...(Array.isArray(calls) ? calls : []),
    ...(call ? [call] : []),
  ]
    .map(readRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .slice(0, 10);
};

export const hasExplicitWorkstationGatewayCalls = (body: Record<string, unknown>): boolean =>
  readExplicitWorkstationGatewayCallRequests(body).length > 0;

export const hasSelectedHelixAgentRuntime = (body: Record<string, unknown>): boolean =>
  Boolean(readString(body.agent_runtime) ?? readString(body.agentRuntime));

export const readPrompt = (body: Record<string, unknown>): string | null =>
  readString(body.question) ?? readString(body.prompt) ?? readString(body.raw_user_prompt);

export const unquotePrompt = (prompt: string): string => prompt.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");

export const hasNegatedToolInstruction = (prompt: string, toolPattern: RegExp): boolean => {
  const unquoted = unquotePrompt(prompt);
  const negated = /\b(?:do\s+not|don't|dont|without|no\s+need\s+to|not\s+asking\s+to|avoid)\b[\s\S]{0,100}/gi;
  for (const match of unquoted.matchAll(negated)) {
    if (toolPattern.test(match[0] ?? "")) return true;
  }
  return false;
};

const CALCULATOR_EXECUTION_PATTERN = /\b(?:calculator|calculate|compute|evaluate|solve|expression)\b/i;
const SCHOLARLY_RESEARCH_EXECUTION_PATTERN = /\b(?:research|papers?|research[-\s]+papers?|scholarly|arxiv|doi|cit(?:e|ed|ation)s?|sources?|web|internet|online|external|pdfs?|pages?)\b/i;

export const hasNegatedCalculatorExecutionInstruction = (prompt: string): boolean =>
  hasNegatedToolInstruction(prompt, CALCULATOR_EXECUTION_PATTERN);

export const hasNegatedScholarlyResearchInstruction = (prompt: string): boolean =>
  hasNegatedToolInstruction(prompt, SCHOLARLY_RESEARCH_EXECUTION_PATTERN);

export const normalizeDocPath = (value: unknown): string | null => {
  const raw = readString(value);
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..") || /^[a-z]:\//i.test(normalized)) return null;
  return normalized.startsWith("docs/") ? normalized : null;
};
