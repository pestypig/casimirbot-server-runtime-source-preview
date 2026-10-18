import { createHash, randomUUID } from "node:crypto";
import type { KnowledgeProjectExport } from "@shared/knowledge";
import type { ConsoleTelemetryBundle } from "@shared/desktop";
import type {
  ResonanceBundle,
  ResonancePatch,
  ResonanceNodeKind,
  ResonanceCollapse,
} from "@shared/code-lattice";
import type { GroundingReport, GroundingSource } from "@shared/grounding";
import type { TMemoryRecord, TMemorySearchHit, TTaskTrace, TTaskApproval } from "@shared/essence-persona";
import type { LocalResourceHint } from "@shared/local-call-spec";
import {
  DebateConfig,
  ViabilityStatus,
  type TDebateOutcome,
  type TDebateRoundMetrics,
  type TWarpConfig,
  type TWarpConstraintEvidence,
  type TWarpGroundingEvidence,
  type TWarpSnapshot,
  type TViabilityStatus,
} from "@shared/essence-debate";
import type { Tool, ToolManifestEntry, ToolRiskType } from "@shared/skills";
import { putMemoryRecord, searchMemories } from "../essence/memory-store";
import { kvAdd, kvBudgetExceeded, kvEvictOldest } from "../llm/kv-budgeter";
import { getTool } from "../../skills";
import { metrics, recordTaskOutcome } from "../../metrics";
import {
  appendToolLog,
  type ToolLogPolicyFlags,
} from "../observability/tool-log-store";
import { runSpecialistPlan, runVerifierOnly, type SpecialistRunResult } from "../specialists/executor";
import { mergeKnowledgeBundles } from "../knowledge/merge";
import { composeKnowledgeAppendix } from "./knowledge-compositor";
import { CASIMIR_PROMOTION_THRESHOLDS } from "../code-lattice/resonance.constants";
import { startDebate, waitForDebateOutcome } from "../debate/orchestrator";
import { summarizeConsoleTelemetry } from "../console-telemetry/summarize";
import { resolveLocalRuntimeCaps } from "../llm/local-runtime";
import {
  ensureGroundingReport,
  pushGroundingSource,
  pushGroundingSources,
  recordKnowledgeSources,
  recordResonancePatchSources,
} from "./grounding";
import {
  collectSupplementsFromOutputs,
  collectSupplementsFromResults,
  formatSupplementForPrompt,
  type Supplement,
} from "./supplements";
import {
  isToolAllowedForAgent,
  loadAgentMap,
  resolveAgent,
  type AgentMap,
} from "./agent-map";
import type { WarpViabilityCertificate } from "../../../types/warpViability";
import { loadWarpAgentsConfig, type WarpAgentsConfig } from "../../../modules/physics/warpAgents";

export const PLAN_DSL_CHAIN = "SEARCH->SUMMARIZE->CALL(tool)";
export const PLAN_DSL_GUIDE = [
  `${PLAN_DSL_CHAIN} enforces grounding before tool use.`,
  'SEARCH("query", k=3-6)        # fetch evidence from memory or files',
  'SUMMARIZE(@step_id, "focus")  # compress the referenced output',
  'CALL(tool_name, {...})        # invoke a registered tool with JSON args',
  'SOLVE("solver", params={})    # (optional) run ENABLE_SPECIALISTS solvers with typed inputs',
  'VERIFY(@step_id, "verifier")  # (optional) re-check solver outputs with ENABLE_SPECIALISTS gates',
].join("\n");

export const DEFAULT_SUMMARY_FOCUS = "Highlight statuses, blockers, and actionable next steps.";
const DEFAULT_DEBATE_ATTACHMENTS = [
  {
    title: "Stellar Consciousness (Orch OR Review)",
    url: "/mnt/data/Reformatted; Stellar Consciousness by Orchestrated Objective Reduction Review.pdf",
  },
  {
    title: "Quantum Computation in Brain Microtubules (1998)",
    url: "/mnt/data/Quantum Computation in Brain Microtubules The Penrose-Hameroff hameroff-1998.pdf",
  },
];
const LOCAL_SPAWN_TOOL_NAME = "llm.local.spawn.generate";
const AGENT_MAP_ENABLED = process.env.ENABLE_AGENT_MAP === "1";
const resolveAppendixCaps = (maxSnippets: number, maxChars?: number) => {
  const localRuntimeCaps = resolveLocalRuntimeCaps();
  if (!localRuntimeCaps) {
    return { maxSnippets, maxChars };
  }
  return {
    maxSnippets: Math.min(maxSnippets, localRuntimeCaps.maxAppendixSnippets),
    maxChars:
      maxChars === undefined
        ? localRuntimeCaps.maxAppendixChars
        : Math.min(maxChars, localRuntimeCaps.maxAppendixChars),
  };
};

const RESULT_SUMMARY_LIMIT = (() => {
  const fallback = 2000;
  const raw = Number(process.env.RESULT_SUMMARY_LIMIT ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.min(8000, Math.max(500, Math.floor(raw)));
})();

const formatMemoryCitation = (hit: TMemorySearchHit): string => {
  if (typeof hit.envelope_id === "string" && hit.envelope_id.trim()) {
    return `essence:${hit.envelope_id.trim()}`;
  }
  return `memory:${hit.id}`;
};

const normalizeAgentId = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

type AgentContext = {
  agentId?: string;
  personaId: string;
  allowed: boolean;
  reason?: "agent_not_found" | "agent_tool_forbidden";
};

const resolveAgentContext = (
  agentId: string | undefined,
  toolName: string | undefined,
  fallbackPersonaId: string,
): AgentContext => {
  const personaFallback = fallbackPersonaId || "default";
  if (!AGENT_MAP_ENABLED || !agentId) {
    return { agentId, personaId: personaFallback, allowed: true };
  }
  const map = loadAgentMap();
  const agent = resolveAgent(map, agentId);
  if (!agent) {
    return { agentId, personaId: personaFallback, allowed: false, reason: "agent_not_found" };
  }
  const personaId = agent.personaId ?? personaFallback;
  if (toolName && !isToolAllowedForAgent(agent, toolName)) {
    return { agentId: agent.id, personaId, allowed: false, reason: "agent_tool_forbidden" };
  }
  return { agentId: agent.id, personaId, allowed: true };
};

const formatAgentMapForPrompt = (map: AgentMap): string[] => {
  return map.agents.map((agent) => {
    const persona = agent.personaId ?? "default";
    const tools =
      agent.toolAllowList && agent.toolAllowList.length > 0
        ? agent.toolAllowList.join(", ")
        : "all";
    return `- ${agent.id} -> persona:${persona} tools:${tools}`;
  });
};

export type PlanNode =
  | { id: string; kind: "SEARCH"; query: string; topK: number; target: "memory"; note: string }
  | { id: string; kind: "SUMMARIZE"; source: string; focus: string }
  | {
      id: string;
      kind: "CALL";
      tool: string;
      summaryRef?: string;
      promptTemplate: string;
      extra?: Record<string, unknown>;
    }
  | {
      id: string;
      kind: "SOLVE";
      solver: string;
      summaryRef?: string;
      verifier?: string;
      params?: Record<string, unknown>;
      repair?: boolean;
    }
  | { id: string; kind: "VERIFY"; source: string; verifier: string }
  | { id: string; kind: "DEBATE_START"; topic: string; summaryRef?: string }
  | { id: string; kind: "DEBATE_CONSUME"; source: string }
  // Legacy debate nodes kept for backward compatibility with stored traces
  | { id: string; kind: "DEBATE.START"; topic: string; summaryRef?: string }
  | { id: string; kind: "DEBATE.CONSUME"; source: string };

export type ExecutorStep =
  | { id: string; kind: "memory.search"; query: string; topK: number }
  | { id: string; kind: "summary.compose"; source: string; focus: string }
  | {
      id: string;
      kind: "tool.call";
      tool: string;
      summaryRef?: string;
      promptTemplate: string;
      extra?: Record<string, unknown>;
    }
  | {
      id: string;
      kind: "debate.run";
      tool: "debate.run";
      topic?: string;
      personaId?: string;
      summaryRef?: string;
      context?: Record<string, unknown>;
      budgets?: { max_rounds?: number; max_wall_ms?: number };
      debateTriggers?: string[];
    }
  | {
      id: string;
      kind: "specialist.run";
      solver: string;
      summaryRef?: string;
      verifier?: string;
      params?: Record<string, unknown>;
      repair?: boolean;
    }
  | { id: string; kind: "specialist.verify"; source: string; verifier: string }
  | { id: string; kind: "debate.start"; topic: string; summaryRef?: string }
  | { id: string; kind: "debate.consume"; source: string };

type ExecutionResultBase = {
  id: string;
  kind: ExecutorStep["kind"];
  citations: string[];
  latency_ms?: number;
  essence_ids?: string[];
};

type ExecutionErrorPolicy = {
  reason?: string;
  tool?: string;
  capability?: ToolRiskType;
  risks?: ToolRiskType[];
};

export type ExecutionError = {
  message: string;
  type?: string;
  policy?: ExecutionErrorPolicy;
};

export type ExecutionResultSuccess = ExecutionResultBase & { ok: true; output: unknown };
export type ExecutionResultFailure = ExecutionResultBase & { ok: false; output?: unknown; error?: ExecutionError | string };
export type ExecutionResult = ExecutionResultSuccess | ExecutionResultFailure;

type CitationVerificationState = {
  enabled: boolean;
  pass?: boolean;
  missing?: string[];
  repaired?: boolean;
};

const SCIENTIFIC_MODE_KEYWORDS = /\b(scientific|hypothesis|counterfactual|falsif|uncertainty|reproducib)\b/i;

const isScientificMethodMode = (runtime: ExecutionRuntime): boolean => {
  if (process.env.HELIX_SCIENTIFIC_METHOD_MODE === "1") {
    return true;
  }
  return SCIENTIFIC_MODE_KEYWORDS.test(runtime.goal);
};


const isFailedResult = (result: ExecutionResult): result is ExecutionResultFailure => result.ok === false;

const TOOL_RETRY_MAX = (() => {
  const raw = Number(process.env.AGI_TOOL_RETRY_MAX ?? 2);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(Math.max(1, Math.floor(raw)), 3);
})();
const TOOL_RETRY_BASE_MS = (() => {
  const raw = Number(process.env.AGI_TOOL_RETRY_BASE_MS ?? 200);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(Math.max(0, Math.floor(raw)), 2000);
})();
const TOOL_RETRY_JITTER_MS = (() => {
  const raw = Number(process.env.AGI_TOOL_RETRY_JITTER_MS ?? 120);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(Math.max(0, Math.floor(raw)), 1000);
})();

const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const normalizeRetryMessage = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value !== "object") return "";
  const err = value as { message?: unknown; type?: unknown; code?: unknown; status?: unknown; name?: unknown };
  return [
    typeof err.message === "string" ? err.message : "",
    typeof err.type === "string" ? err.type : "",
    typeof err.code === "string" ? err.code : "",
    typeof err.status === "number" ? String(err.status) : "",
    typeof err.name === "string" ? err.name : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const isRetryableToolError = (error: unknown): boolean => {
  const text = normalizeRetryMessage(error);
  if (!text) return false;
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("etimedout") ||
    text.includes("esockettimedout") ||
    text.includes("econnrefused") ||
    text.includes("eai_again") ||
    text.includes("rate limit") ||
    text.includes("rate_limited") ||
    text.includes("429") ||
    /(^|\\D)5\\d\\d(\\D|$)/.test(text) ||
    text.includes("server error") ||
    text.includes("network") ||
    text.includes("socket")
  );
};

const computeRetryDelayMs = (attempt: number): number => {
  const base = TOOL_RETRY_BASE_MS;
  if (base <= 0) return 0;
  const jitter = TOOL_RETRY_JITTER_MS > 0 ? Math.floor(Math.random() * TOOL_RETRY_JITTER_MS) : 0;
  return base * attempt + jitter;
};

export type ReasoningStrategy =
  | "deep_repo_research"
  | "repo_design_ideation"
  | "design-debate"
  | "physics_console"
  | "default";
export type IntentFlags = { wantsStatus: boolean; wantsWarp: boolean; wantsImplementation: boolean; wantsPhysics: boolean };

export const normalizeForIntent = (value: string): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const isWarpOrPhysicsIntentGoal = (goal: string): boolean => {
  const normalized = normalizeForIntent(goal);
  return /\b(warp|natario|alcubierre|bubble|metric|casimir|theta|qi|pipeline|target|natario constraints?)\b/.test(
    normalized,
  );
};

export const isViabilityIntentGoal = (goal: string): boolean => {
  const normalized = normalizeForIntent(goal);
  return /\b(viab|admissible|inadmissible|marginal|certificate|guardrail|qi bound|ford-roman|verdict|safe|feasible)\b/.test(
    normalized,
  );
};

export const isImplementationIntentGoal = (goal: string): boolean => {
  const normalized = normalizeForIntent(goal);
  return (
    isWarpOrPhysicsIntentGoal(goal) &&
    /\b(implement|implementation|compute|calculation|how does|how is|where\b|which module|code|file|function|module|validate)\b/.test(
      normalized,
    )
  );
};

export const isWarpConsoleIntent = (goal: string, essenceConsole?: boolean): boolean => {
  const warpSignals = isWarpOrPhysicsIntentGoal(goal) || isViabilityIntentGoal(goal);
  return Boolean(essenceConsole) || warpSignals;
};

export const classifyIntent = (goal: string): IntentFlags => {
  const lower = goal.toLowerCase();
  const normalized = normalizeForIntent(goal);
  const wantsStatus = /\b(status|telemetry|panel|badge|tile|drive|hud|coherence|q\s?factor|occupancy)\b/.test(lower);
  const wantsWarp = /\b(warp|natario|alcubierre|bubble|metric)\b/.test(normalized);
  const wantsImplementation =
    /\b(code|module|implement|how does|how is|pipeline|compute|calculate|calculation|engine)\b/.test(normalized) ||
    isImplementationIntentGoal(goal);
  const wantsPhysics =
    /\b(casimir|qi\b|ford-roman|fr envelope|stress|energy|theta|target|duty|curvature|t00|beta|metric|divergence)\b/.test(
      normalized,
    ) || wantsWarp;
  return { wantsStatus, wantsWarp, wantsImplementation, wantsPhysics };
};

const SERIOUS_WARP_WALL_MS = (() => {
  const envWall = Number(process.env.DEBATE_MAX_WALL_MS ?? NaN);
  const floor = 20 * 60 * 1000;
  return Number.isFinite(envWall) ? Math.max(envWall, floor) : floor;
})();

const pickDebateBudgets = (
  intent: IntentFlags | undefined,
  fallback?: { max_rounds?: number; max_wall_ms?: number },
): { max_rounds?: number; max_wall_ms?: number } | undefined => {
  const isWarp = intent?.wantsWarp || intent?.wantsPhysics;
  if (isWarp) {
    return {
      max_rounds: (fallback?.max_rounds ?? 3) || 3,
      max_wall_ms: SERIOUS_WARP_WALL_MS,
    };
  }
  return fallback;
};

export function chooseReasoningStrategy(
  goal: string,
  opts?: { hasRepoContext?: boolean; personaHints?: string[]; intentTags?: string[]; essenceConsole?: boolean; intent?: IntentFlags },
): { strategy: ReasoningStrategy; notes: string[] } {
  const normalized = goal.toLowerCase();
  const notes: string[] = [];
  const repoHint =
    /\b(code|stack|trace|error|bug|exception|component|typescript|react|test|build|lint|api|function|class|module|repo|repository|endpoint|middleware|auth|hook)\b/i;
  const designHint = /\b(design|refactor|architecture|rewrite|restructure|redesign|plan|spec|proposal|uml|diagram|pattern)\b/i;
  const riskHint = /\b(production|release|security|privacy|compliance|data loss|outage|incident|rollback)\b/i;
  const personaHint = (opts?.personaHints ?? []).some((hint) => /code|repo|developer/i.test(hint));
  const intentTags = (opts?.intentTags ?? []).map((tag) => tag.toLowerCase());
  const intentForcesDeep = intentTags.some((tag) =>
    ["warp_physics", "warp", "implementation", "physics", "repo_deep"].includes(tag),
  );
  const intent = opts?.intent ?? classifyIntent(goal);
  if (isWarpConsoleIntent(goal, opts?.essenceConsole) || intent.wantsWarp || intent.wantsPhysics) {
    notes.push("Warp console intent detected");
    return { strategy: "physics_console", notes };
  }

  const designVerb = /\b(add|implement|refactor|migrate|redesign|rewrite|restructure|introduce|extend|augment|modernize|upgrade|replace|deprecate)\b/i.test(
    normalized,
  );

  let strategy: ReasoningStrategy = "default";
  if (designVerb && (repoHint.test(normalized) || opts?.hasRepoContext || personaHint || intentForcesDeep)) {
    strategy = "repo_design_ideation";
    notes.push("Repo design/refactor intent detected");
  } else if (designHint.test(normalized)) {
    strategy = "design-debate";
    notes.push("Design/refactor intent detected");
  } else if (repoHint.test(normalized) || opts?.hasRepoContext || personaHint || intentForcesDeep) {
    strategy = "deep_repo_research";
    notes.push("Repo/code question detected");
  }

  if (designHint.test(normalized)) {
    strategy = "design-debate";
    notes.push("Design/refactor intent detected");
  }
  if (riskHint.test(normalized)) {
    notes.push("High-impact/risk-sensitive request");
  }
  return { strategy, notes };
}

export interface PlannerPromptArgs {
  goal: string;
  personaId?: string;
  manifest: ToolManifestEntry[];
  searchQuery: string;
  topK: number;
  summaryFocus: string;
  knowledgeContext?: KnowledgeProjectExport[];
  resonanceBundle?: ResonanceBundle | null;
  resonanceSelection?: ResonanceCollapse | null;
  primaryPatchId?: string | null;
  telemetryBundle?: ConsoleTelemetryBundle | null;
  knowledgeHints?: string[];
}

export interface BuildPlanArgs {
  goal: string;
  searchQuery: string;
  topK?: number;
  summaryFocus?: string;
  finalTool: string;
  strategy?: ReasoningStrategy;
  strategyNotes?: string[];
  detailPreference?: "short" | "medium" | "long";
  preferReviewed?: boolean;
  intent?: IntentFlags;
  resourceHints?: LocalResourceHint[];
}

export interface ExecutionRuntime {
  goal: string;
  personaId?: string;
  sessionId?: string;
  taskTrace?: TTaskTrace;
  requestApproval?: ApprovalHandler;
  knowledgeContext?: KnowledgeProjectExport[];
  telemetrySummary?: string | null;
  resonanceBundle?: ResonanceBundle | null;
  resonanceSelection?: ResonanceCollapse | null;
  knowledgeHints?: string[];
  plannerPrompt?: string | null;
  debateId?: string | null;
  debateOutcome?: TDebateOutcome | null;
  strategy?: ReasoningStrategy;
  intent?: IntentFlags;
  debugSources?: boolean;
  groundingReport?: GroundingReport;
}

export type ResonantPlanCandidate = {
  patch: ResonancePatch;
  knowledgeContext?: KnowledgeProjectExport[];
  plannerPrompt: string;
  nodes: PlanNode[];
  planDsl: string;
  intent?: IntentFlags;
};

const FIX_KEYWORDS = /\b(fix|bug|broken|repair|debug|error|failing|regression)\b/;
const IDEOLOGY_KEYWORDS = /\b(ethos|ideology|mission|philosophy|why|ethic|vision)\b/;
const CASIMIR_PANEL_ID = "casimir-tiles";
const CASIMIR_NODE_PATTERN = /casimir/i;

const basename = (value: string) => value.split(/[/\\]/).pop() ?? value;
const isDocLikePath = (value?: string): boolean => (value ?? "").toLowerCase().match(/\.mdx?$|\.txt$/i) !== null;

const describePatchNodes = (patch: ResonancePatch, limit = 2): string => {
  const nodes = patch.nodes.slice(0, limit);
  if (nodes.length === 0) {
    return "n/a";
  }
  return nodes.map((node) => `${node.symbol} (${basename(node.filePath)})`).join(", ");
};

const RESONANCE_KIND_ORDER: ResonanceNodeKind[] = [
  "architecture",
  "ideology",
  "doc",
  "ui",
  "data",
  "plumbing",
  "test",
  "unknown",
];

const getKindPriority = (kind?: ResonanceNodeKind): number => {
  const resolved = kind ?? "unknown";
  const index = RESONANCE_KIND_ORDER.indexOf(resolved);
  return index >= 0 ? index : RESONANCE_KIND_ORDER.length;
};

const normalizeBand = (value?: string): string => (value ?? "").toLowerCase();

type ResonanceSectionArgs = {
  bundle?: ResonanceBundle | null;
  selection?: ResonanceCollapse | null;
  preferredPatchId?: string | null;
  hotNodeLimit?: number;
  intent?: IntentFlags | null;
};

const pickPatchForSection = ({
  bundle,
  selection,
  preferredPatchId,
  intent,
}: ResonanceSectionArgs): ResonancePatch | null => {
  if (!bundle || !bundle.candidates || bundle.candidates.length === 0) {
    return null;
  }
  const select = (candidate?: ResonancePatch | null): ResonancePatch | null => {
    if (!candidate) return null;
    return clampPatchForIntent(candidate, intent ?? null);
  };
  if (preferredPatchId) {
    const preferred = select(bundle.candidates.find((candidate) => candidate.id === preferredPatchId));
    if (preferred) {
      return preferred;
    }
  }
  const rankingOrder = selection?.ranking?.map((entry) => entry.patchId) ?? [];
  for (const patchId of rankingOrder) {
    const match = select(bundle.candidates.find((candidate) => candidate.id === patchId));
    if (match) {
      return match;
    }
  }
  for (const candidate of bundle.candidates) {
    const clamped = select(candidate);
    if (clamped) {
      return clamped;
    }
  }
  return null;
};

export const isWarpRelevantPath = (value?: string): boolean => {
  if (!value) return false;
  const normalized = normalizeForIntent(value.replace(/\\/g, "/"));
  return (
    normalized.includes("modules/warp") ||
    normalized.includes("docs/warp") ||
    normalized.includes("warp-pulsed-power") ||
    normalized.includes("energy-pipeline.ts") ||
    normalized.includes("natario") ||
    normalized.includes("alcubierre") ||
    normalized.includes("natario-metric") ||
    normalized.includes("target-validation") ||
    normalized.includes("theta") ||
    normalized.includes("casimir")
  );
};

const hasWarpSignals = (patch: ResonancePatch): boolean =>
  patch.nodes.some(
    (node) =>
      isWarpRelevantPath(node.filePath) ||
      isWarpRelevantPath(node.symbol ?? "") ||
      isWarpRelevantPath(node.summary ?? ""),
  );

const clampPatchForIntent = (patch: ResonancePatch, intent?: IntentFlags | null): ResonancePatch | null => {
  if (!patch) return null;
  const wantsWarp = intent?.wantsWarp || intent?.wantsPhysics;
  if (!wantsWarp) {
    return patch;
  }
  const filteredNodes = (patch.nodes ?? []).filter((node) => isWarpRelevantPath(node.filePath) || isWarpRelevantPath(node.symbol ?? ""));
  const filteredKnowledge = patch.knowledge
    ? {
        ...patch.knowledge,
        files: (patch.knowledge.files ?? []).filter((file) => isWarpRelevantPath(file.path ?? file.name ?? "")),
      }
    : patch.knowledge;
  const hasKnowledge = Boolean(filteredKnowledge?.files && filteredKnowledge.files.length > 0);
  if (filteredNodes.length === 0 && !hasKnowledge) {
    return null;
  }
  return { ...patch, nodes: filteredNodes, knowledge: filteredKnowledge ?? patch.knowledge };
};

const needsWarpImplementationGrounding = (runtime: ExecutionRuntime): boolean => {
  const intent = runtime.intent ?? classifyIntent(runtime.goal);
  return (
    intent.wantsWarp ||
    intent.wantsPhysics ||
    intent.wantsImplementation ||
    isWarpOrPhysicsIntentGoal(runtime.goal) ||
    isImplementationIntentGoal(runtime.goal)
  );
};

const collectKnowledgePaths = (knowledge?: KnowledgeProjectExport[] | null): string[] => {
  if (!knowledge || knowledge.length === 0) {
    return [];
  }
  const paths: string[] = [];
  for (const project of knowledge) {
    for (const file of project.files ?? []) {
      const p = file.path || file.name;
      if (p) {
        paths.push(p);
      }
    }
  }
  return paths;
};

const collectRepoGraphPathsFromOutputs = (outputs: Map<string, unknown>): string[] => {
  const paths: string[] = [];
  const addPath = (value?: string) => {
    if (typeof value === "string" && value.trim().length > 0) {
      paths.push(value);
    }
  };
  for (const value of outputs.values()) {
    if (!value || typeof value !== "object") continue;
    const hits = Array.isArray((value as { hits?: unknown }).hits) ? ((value as any).hits as any[]) : [];
    for (const hit of hits) {
      addPath((hit as any).path ?? (hit as any).file_path ?? (hit as any).id);
    }
    const packets = Array.isArray((value as { packets?: unknown }).packets) ? ((value as any).packets as any[]) : [];
    for (const packet of packets) {
      addPath((packet as any).file_path ?? (packet as any).path ?? (packet as any).id);
    }
  }
  return paths;
};

const collectResonancePaths = (runtime: ExecutionRuntime): string[] => {
  const bundle = runtime.resonanceBundle ?? runtime.taskTrace?.resonance_bundle ?? null;
  const selection = runtime.resonanceSelection ?? runtime.taskTrace?.resonance_selection ?? null;
  const patch = pickPatchForSection({
    bundle,
    selection,
    preferredPatchId: selection?.primaryPatchId ?? null,
    intent: runtime.intent ?? classifyIntent(runtime.goal),
  });
  if (!patch) return [];
  const nodes = patch.nodes ?? [];
  return nodes.map((node) => node.filePath).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
};

const hasWarpMemoryGrounding = (outputs: Map<string, unknown>): boolean => {
  for (const value of outputs.values()) {
    if (!Array.isArray(value) || value.length === 0) continue;
    for (const hit of value) {
      if (!hit || typeof hit !== "object") continue;
      const snippet = typeof (hit as { snippet?: unknown }).snippet === "string" ? (hit as { snippet: string }).snippet : null;
      const text = typeof (hit as { text?: unknown }).text === "string" ? (hit as { text: string }).text : null;
      const keys = Array.isArray((hit as { keys?: unknown }).keys)
        ? ((hit as { keys: unknown[] }).keys ?? []).filter((k): k is string => typeof k === "string")
        : [];
      const candidates = [snippet, text, ...keys].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
      if (candidates.some((candidate) => isWarpOrPhysicsIntentGoal(candidate))) {
        return true;
      }
    }
  }
  return false;
};

const hasWarpDebateEvidence = (grounding?: TWarpGroundingEvidence | null): boolean => {
  if (!grounding) return false;
  const status = grounding.status;
  const hasStatus = typeof status === "string" && status.trim().length > 0;
  const hasCertHash = typeof grounding.certificateHash === "string" && grounding.certificateHash.trim().length > 0;
  const hasSnapshot = grounding.snapshot && Object.keys(grounding.snapshot ?? {}).length > 0;
  const hasConstraints = Array.isArray(grounding.constraints) && grounding.constraints.length > 0;
  const hasStructuredEvidence = hasSnapshot || hasConstraints || hasCertHash;
  // Require structured physics evidence and a declared status; status text alone (especially NOT_CERTIFIED) is not enough.
  return hasStatus && hasStructuredEvidence;
};

const hasWarpGrounding = (runtime: ExecutionRuntime, outputs: Map<string, unknown>): boolean => {
  if (!needsWarpImplementationGrounding(runtime)) {
    return true;
  }
  const warpSupplement = collectWarpSupplement(outputs);
  if (warpSupplement?.grounding && hasWarpDebateEvidence(warpSupplement.grounding)) {
    return true;
  }
  const supplements = collectSupplementsFromOutputs(outputs.values());
  if (supplements.some((supplement) => supplement.kind === "warp")) {
    return true;
  }
  const paths = new Set<string>();
  const knowledgePaths = collectKnowledgePaths(runtime.knowledgeContext ?? runtime.taskTrace?.knowledgeContext);
  knowledgePaths.forEach((p) => paths.add(p));
  collectResonancePaths(runtime).forEach((p) => paths.add(p));
  collectRepoGraphPathsFromOutputs(outputs).forEach((p) => paths.add(p));
  if (hasWarpMemoryGrounding(outputs) || extractWarpAskResult(outputs)) {
    return true;
  }
  return Array.from(paths).some((p) => isWarpRelevantPath(p));
};

type WarpAskResult = {
  answer?: string;
  citations?: string[];
  citationHints?: Record<string, unknown>;
  pipelineSnapshot?: Record<string, unknown> | null;
  pipelineCitations?: Record<string, string[]> | null;
};

const isWarpAskResult = (value: unknown): value is WarpAskResult =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { answer?: unknown }).answer === "string" &&
      Array.isArray((value as { citations?: unknown }).citations),
  );

const findWarpAskResult = (value: unknown): WarpAskResult | null => {
  if (isWarpAskResult(value)) {
    return value;
  }
  if (value && typeof value === "object" && (value as { output?: unknown }).output) {
    return findWarpAskResult((value as { output?: unknown }).output);
  }
  return null;
};

const extractWarpAskResult = (outputs: Map<string, unknown>): WarpAskResult | null => {
  for (const value of outputs.values()) {
    const result = findWarpAskResult(value);
    if (result) {
      return result;
    }
  }
  return null;
};

const collectWarpCitationsFromResult = (warp: WarpAskResult | null): string[] => {
  if (!warp) return [];
  const citations: string[] = [];
  if (Array.isArray(warp.citations)) {
    citations.push(...warp.citations.filter((c): c is string => typeof c === "string" && c.trim().length > 0));
  }
  if (warp.pipelineCitations && typeof warp.pipelineCitations === "object") {
    for (const value of Object.values(warp.pipelineCitations)) {
      if (Array.isArray(value)) {
        citations.push(...value.filter((c): c is string => typeof c === "string" && c.trim().length > 0));
      }
    }
  }
  return Array.from(new Set(citations));
};

type WarpConstraintLike = {
  id?: string;
  description?: string;
  severity?: string;
  passed?: boolean;
  lhs?: number;
  rhs?: number;
  margin?: number | null;
};

type WarpViabilityResultForPrompt = {
  status?: string;
  constraints?: WarpConstraintLike[];
  snapshot?: Record<string, unknown> | null;
  certificate?: WarpViabilityCertificate | null;
  citations?: string[];
  config?: Record<string, unknown> | null;
  certificateHash?: string | null;
  certificateId?: string | null;
};

type WarpGroundingEvidence = TWarpGroundingEvidence;

const asConstraintList = (value: unknown): WarpConstraintLike[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((entry) => (entry && typeof entry === "object" ? (entry as WarpConstraintLike) : null))
    .filter((entry): entry is WarpConstraintLike => Boolean(entry));
};

const normalizeConstraintSeverity = (value?: string): TWarpConstraintEvidence["severity"] => {
  const upper = (value ?? "").toUpperCase();
  return upper === "SOFT" ? "SOFT" : "HARD";
};

const normalizeConstraints = (constraints?: WarpConstraintLike[]): TWarpConstraintEvidence[] => {
  if (!constraints || constraints.length === 0) return [];
  return constraints
    .map((entry, idx): TWarpConstraintEvidence => {
      const lhs = typeof entry.lhs === "number" && Number.isFinite(entry.lhs) ? entry.lhs : undefined;
      const rhs = typeof entry.rhs === "number" && Number.isFinite(entry.rhs) ? entry.rhs : undefined;
      const margin =
        typeof entry.margin === "number" || entry.margin === null
          ? entry.margin
          : lhs !== undefined && rhs !== undefined
            ? lhs - rhs
            : null;
      return {
        id: entry.id ?? `constraint_${idx + 1}`,
        description: entry.description ?? "",
        severity: normalizeConstraintSeverity(entry.severity),
        passed: entry.passed === true,
        lhs,
        rhs,
        margin,
      };
    })
    .filter((entry) => Boolean(entry));
};

const normalizeWarpConfig = (config?: Record<string, unknown> | null): TWarpConfig | undefined => {
  if (!config || typeof config !== "object") return undefined;
  const keys: Array<keyof TWarpConfig> = [
    "bubbleRadius_m",
    "wallThickness_m",
    "targetVelocity_c",
    "tileConfigId",
    "tileCount",
    "dutyCycle",
    "gammaGeoOverride",
  ];
  const normalized: Record<string, number | string> = {};
  for (const key of keys) {
    const value = (config as Record<string, unknown>)[key as string];
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[key] = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      normalized[key] = value.trim();
    }
  }
  return Object.keys(normalized).length > 0 ? (normalized as TWarpConfig) : undefined;
};

const clampWarpStatus = (status?: string): TViabilityStatus => {
  const normalized = (status ?? "").toUpperCase();
  if (normalized && ViabilityStatus.options.includes(normalized as TViabilityStatus)) {
    return normalized as TViabilityStatus;
  }
  return "NOT_CERTIFIED";
};

const findWarpViabilityResult = (value: unknown): WarpViabilityResultForPrompt | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const certificate = candidate.certificate as WarpViabilityCertificate | undefined;
  if (certificate && (certificate as any).header?.kind === "warp-viability") {
    const certificateHash =
      (certificate as { certificateHash?: string }).certificateHash ??
      (candidate.certificateHash as string | undefined) ??
      (candidate.payloadHash as string | undefined);
    return {
      status: certificate.payload?.status ?? (candidate.status as string | undefined),
      constraints: asConstraintList(certificate.payload?.constraints) ?? asConstraintList(candidate.constraints),
      snapshot:
        (certificate.payload?.snapshot as Record<string, unknown>) ??
        (candidate.snapshot as Record<string, unknown>) ??
        null,
      certificate,
      certificateHash: certificateHash ?? null,
      certificateId: certificate.header?.id ?? (candidate.certificateId as string | undefined) ?? null,
      config: (certificate.payload?.config as Record<string, unknown>) ?? (candidate.config as Record<string, unknown>) ?? null,
      citations: Array.isArray(certificate.payload?.citations)
        ? (certificate.payload?.citations as string[])
        : (candidate.citations as string[] | undefined),
    };
  }
  if (typeof candidate.status === "string" && Array.isArray(candidate.constraints)) {
    return {
      status: candidate.status as string,
      constraints: asConstraintList(candidate.constraints),
      snapshot: (candidate.snapshot as Record<string, unknown>) ?? null,
      certificateHash: (candidate.certificateHash as string | undefined) ?? null,
      certificateId: (candidate.certificateId as string | undefined) ?? null,
      config: (candidate.config as Record<string, unknown>) ?? null,
      certificate: null,
      citations: Array.isArray(candidate.citations) ? (candidate.citations as string[]) : undefined,
    };
  }
  if ((candidate as { output?: unknown }).output) {
    return findWarpViabilityResult((candidate as { output?: unknown }).output);
  }
  return null;
};

const extractWarpViabilityResult = (outputs: Map<string, unknown>): WarpViabilityResultForPrompt | null => {
  for (const value of outputs.values()) {
    const result = findWarpViabilityResult(value);
    if (result) {
      return result;
    }
  }
  return null;
};

const collectWarpCitationsFromViability = (viability: WarpViabilityResultForPrompt | null): string[] => {
  if (!viability) return [];
  const citations = new Set<string>();
  if (Array.isArray(viability.citations)) {
    viability.citations.forEach((c) => {
      if (typeof c === "string" && c.trim()) {
        citations.add(c);
      }
    });
  }
  const payloadCitations = viability.certificate?.payload?.citations;
  if (Array.isArray(payloadCitations)) {
    payloadCitations.forEach((c) => {
      if (typeof c === "string" && c.trim()) {
        citations.add(c);
      }
    });
  }
  return Array.from(citations);
};

const summarizeCertificateFailure = (constraints?: WarpConstraintLike[]): string | null => {
  if (!constraints || constraints.length === 0) return null;
  const failing = constraints.filter((c) => c && c.passed === false);
  if (!failing.length) return "All certificate constraints passing.";
  const target = failing.find((c) => c.severity === "HARD") ?? failing[0];
  if (!target) return null;
  const margin = target.margin !== undefined ? ` margin=${target.margin}` : "";
  const bounds =
    target.lhs !== undefined && target.rhs !== undefined ? ` lhs=${target.lhs} rhs=${target.rhs}` : "";
  return `Certificate failing ${target.id ?? "constraint"} (${target.severity ?? "unknown"})${margin}${bounds}`;
};

const normalizeWarpSnapshotNumbers = (
  snapshot: Record<string, unknown> | null | undefined,
): TWarpSnapshot | undefined => {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const numeric: Record<string, number> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      numeric[key] = value;
    }
  }
  return Object.keys(numeric).length > 0 ? numeric : undefined;
};

const formatWarpSnapshot = (snapshot: TWarpSnapshot | null | undefined): string | null => {
  if (!snapshot || typeof snapshot !== "object") return null;
  const interesting = [
    "TS_ratio",
    "gamma_VdB",
    "T00_min",
    "M_exotic",
    "U_static",
    "gamma_geo_cubed",
    "d_eff",
    "thetaCal",
    "T00_avg",
    "T00",
  ];
  const entries: string[] = [];
  for (const key of interesting) {
    const raw = (snapshot as Record<string, unknown>)[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "number") {
      const abs = Math.abs(raw);
      const formatted =
        abs !== 0 && (abs >= 1e5 || abs < 1e-3) ? raw.toExponential(3) : Number(raw.toPrecision(6));
      entries.push(`${key}=${formatted}`);
    } else {
      entries.push(`${key}=${String(raw)}`);
    }
  }
  if (!entries.length) return null;
  return `Pipeline snapshot: ${entries.join(", ")}`;
};

const collectWarpSupplement = (
  outputs: Map<string, unknown>,
  supplements?: Supplement[],
): { text: string; citations: string[]; grounding?: WarpGroundingEvidence } | null => {
  const supplementList = supplements ?? collectSupplementsFromOutputs(outputs.values());
  const warpSupplement = supplementList.find((entry) => entry.kind === "warp");
  const warpResult = extractWarpAskResult(outputs);
  const viabilityResult = extractWarpViabilityResult(outputs);
  const rawSnapshot =
    (viabilityResult?.certificate?.payload?.snapshot as Record<string, unknown>) ??
    viabilityResult?.snapshot ??
    warpResult?.pipelineSnapshot ??
    null;
  const snapshot: TWarpSnapshot = normalizeWarpSnapshotNumbers(rawSnapshot) ?? {};
  const snapshotLine = formatWarpSnapshot(snapshot);
  const citationsFromResult = collectWarpCitationsFromResult(warpResult);
  const citationsFromViability = collectWarpCitationsFromViability(viabilityResult);
  const combinedCitations = Array.from(new Set([...citationsFromResult, ...citationsFromViability]));
  const viabilityStatus = viabilityResult?.status ?? viabilityResult?.certificate?.payload?.status;
  const resolvedStatus = clampWarpStatus(viabilityStatus ?? (warpResult ? "NOT_CERTIFIED" : undefined));
  const certificateHash =
    viabilityResult?.certificateHash ??
    (viabilityResult?.certificate as { certificateHash?: string } | undefined)?.certificateHash ??
    (viabilityResult?.certificate as { payloadHash?: string } | undefined)?.payloadHash ??
    undefined;
  const certificateId = viabilityResult?.certificateId ?? viabilityResult?.certificate?.header?.id;
  const constraints = normalizeConstraints(
    viabilityResult?.certificate?.payload?.constraints ?? viabilityResult?.constraints ?? undefined,
  );
  const config = normalizeWarpConfig(
    (viabilityResult?.config as Record<string, unknown> | null | undefined) ??
      (viabilityResult?.certificate?.payload?.config as Record<string, unknown> | null | undefined) ??
      null,
  );
  const hasCertificate = Boolean(viabilityResult?.certificate || certificateHash);
  const viabilityStatusLine = hasCertificate
    ? `Warp viability certificate: ${resolvedStatus}`
    : `Warp status: ${resolvedStatus} (no certificate attached)`;
  const constraintLine = summarizeCertificateFailure(
    viabilityResult?.certificate?.payload?.constraints ?? viabilityResult?.constraints,
  );
  const snapshotHasData = snapshot && Object.keys(snapshot).length > 0;
  const grounding: WarpGroundingEvidence | undefined =
    warpResult || constraints.length || snapshotHasData || certificateHash || config
      ? {
          status: resolvedStatus,
          summary: (warpResult?.answer ?? warpSupplement?.detail ?? warpSupplement?.summary ?? "").trim(),
          askAnswer: warpResult?.answer,
          constraints,
          snapshot,
          certificateHash: certificateHash ?? undefined,
          certificateId: certificateId ?? undefined,
          citations: combinedCitations.length ? combinedCitations : undefined,
          config,
        }
      : undefined;
  if (warpSupplement) {
    const lines: string[] = [];
    if (warpSupplement.detail && warpSupplement.detail.trim()) {
      lines.push(warpSupplement.detail.trim());
    } else if (warpSupplement.summary && warpSupplement.summary.trim()) {
      lines.push(warpSupplement.summary.trim());
    }
    if (viabilityStatusLine) {
      lines.push(viabilityStatusLine);
    }
    if (constraintLine) {
      lines.push(constraintLine);
    }
    if (!warpSupplement.detail && warpResult?.answer) {
      lines.push(`Warp Q&A: ${warpResult.answer.trim()}`);
    }
    if (snapshotLine) {
      lines.push(snapshotLine);
    }
    if (!lines.length) {
      lines.push("Warp Q&A result available.");
    }
    const citations =
      warpSupplement.citations && warpSupplement.citations.length > 0
        ? warpSupplement.citations
        : combinedCitations;
    return { text: lines.join("\n"), citations, grounding };
  }
  if (!warpResult && !viabilityResult) {
    return null;
  }
  const lines: string[] = [];
  if (viabilityStatusLine) {
    lines.push(viabilityStatusLine);
  }
  if (constraintLine) {
    lines.push(constraintLine);
  }
  if (typeof warpResult?.answer === "string" && warpResult.answer.trim()) {
    lines.push(`Warp Q&A: ${warpResult.answer.trim()}`);
  }
  if (snapshotLine) {
    lines.push(snapshotLine);
  }
  if (!lines.length) {
    lines.push("Warp Q&A result available.");
  }
  return { text: lines.join("\n"), citations: combinedCitations, grounding };
};

const formatWarpConstraintsForPrompt = (constraints?: TWarpConstraintEvidence[], limit = 4): string[] => {
  if (!constraints || constraints.length === 0) return [];
  return constraints.slice(0, Math.max(1, limit)).map((c) => {
    const status = c.passed ? "PASS" : "FAIL";
    const severity = c.severity ? ` ${c.severity}` : "";
    const margin = c.margin !== undefined && c.margin !== null ? ` margin=${c.margin}` : "";
    return `${status}${severity} ${c.id}${margin}`.trim();
  });
};

const formatWarpNumber = (value: number): string => {
  const abs = Math.abs(value);
  return abs !== 0 && (abs >= 1e5 || abs < 1e-3) ? value.toExponential(3) : Number(value.toPrecision(6)).toString();
};

const formatWarpConfigForPrompt = (config?: TWarpConfig): string[] => {
  if (!config || typeof config !== "object") return [];
  const keys = [
    "bubbleRadius_m",
    "wallThickness_m",
    "targetVelocity_c",
    "tileCount",
    "tileConfigId",
    "dutyCycle",
    "gammaGeoOverride",
  ];
  const lines: string[] = [];
  for (const key of keys) {
    const value = (config as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      lines.push(`${key}=${formatWarpNumber(value)}`);
    } else {
      lines.push(`${key}=${String(value)}`);
    }
  }
  return lines;
};

const pickFirstFailingConstraint = (
  constraints?: TWarpConstraintEvidence[] | WarpConstraintLike[] | null,
): TWarpConstraintEvidence | WarpConstraintLike | null => {
  if (!constraints || constraints.length === 0) return null;
  return (
    constraints.find((c) => c?.passed === false && c.severity === "HARD") ??
    constraints.find((c) => c?.passed === false) ??
    null
  );
};

const formatWarpGroundingBlock = (grounding?: WarpGroundingEvidence): string | null => {
  if (!grounding) return null;
  const status = grounding.status;
  const lines = ["[Warp Evidence]"];
  if (status) {
    lines.push(`status: ${status}`);
  }
  if (grounding.certificateHash) {
    lines.push(`certificate_hash: ${grounding.certificateHash}`);
  }
  const configLines = formatWarpConfigForPrompt(grounding.config);
  if (configLines.length > 0) {
    lines.push("config:");
    configLines.forEach((line) => lines.push(`- ${line}`));
  }
  const constraintLines = formatWarpConstraintsForPrompt(grounding.constraints, 4);
  if (constraintLines.length > 0) {
    lines.push("constraints:");
    for (const line of constraintLines) {
      lines.push(`- ${line}`);
    }
  }
  const snapshotLine = formatWarpSnapshot(grounding.snapshot ?? null);
  if (snapshotLine) {
    lines.push(snapshotLine);
  }
  const summary = grounding.summary || grounding.askAnswer;
  if (summary) {
    lines.push(`summary: ${limitText(summary, 400)}`);
  }
  return lines.filter(Boolean).join("\n");
};

const buildWarpSystemPrompt = (policy?: WarpAgentsConfig["viabilityPolicy"] | null): string => {
  const admissible = policy?.admissibleStatus ?? "ADMISSIBLE";
  const allowMarginal = policy?.allowMarginalAsViable ?? false;
  const missingIsNotCertified = policy?.treatMissingCertificateAsNotCertified ?? true;
  const allowedStatuses = allowMarginal ? `"${admissible}" or "MARGINAL"` : `"${admissible}"`;
  return [
    "You are a physics assistant for a warp/Casimir simulation system.",
    "",
    "You MUST treat the physics pipeline and its certificates as the sole authority on warp-bubble viability. Do NOT substitute your own judgment for the pipeline.",
    "",
    "You are given:",
    "- The original user question.",
    "- A warp viability certificate (if available), which includes:",
    "  - status in {ADMISSIBLE, MARGINAL, INADMISSIBLE}",
    "  - config (bubble radius, velocity, tile config, etc.)",
    "  - snapshot (TS_ratio, gamma_VdB, d_eff, U_static, T00_min, M_exotic, thetaCal, ...)",
    "  - constraints (id, severity HARD/SOFT, passed, margin)",
    "  - certificateHash",
    "",
    "RULES:",
    `1. You MUST NOT describe a configuration as \"physically viable\" or \"admissible\" unless:`,
    "   - A certificate is present, AND",
    `   - certificate.status == ${allowedStatuses}, AND`,
    "   - All HARD constraints in the certificate have passed.",
    "2. If certificate.status is \"MARGINAL\" or \"INADMISSIBLE\", you MUST:",
    "   - Clearly state that the configuration is NOT fully admissible under the current guardrails.",
    "   - Name at least the first failing HARD constraint (id + description) and explain briefly why it fails using the snapshot values and margin.",
    "3. If no certificate is present for a warp configuration:",
    missingIsNotCertified
      ? "   - You MUST say that the configuration is NOT certified."
      : "   - State that no certificate is present before discussing theory.",
    "   - You MAY discuss theory in general terms, but MUST NOT claim viability.",
    "4. When you quote numbers from the snapshot (TS_ratio, gamma_VdB, etc.), make it clear that they come from the pipeline, not from your own imagination.",
    "5. Include the certificateHash in your answer when possible, so the user can trace the underlying pipeline run.",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildWarpCertificateMessage = (
  goal: string,
  grounding?: WarpGroundingEvidence,
  policy?: WarpAgentsConfig["viabilityPolicy"] | null,
): string | null => {
  const missingIsNotCertified = policy?.treatMissingCertificateAsNotCertified ?? true;
  const status = grounding?.status ?? "NOT_CERTIFIED";
  const hasSnapshot = grounding?.snapshot && Object.keys(grounding.snapshot ?? {}).length > 0;
  const hasConstraints = Boolean(grounding?.constraints?.length);
  const certificateMissing = !grounding || (!grounding.certificateHash && !hasSnapshot && !hasConstraints);
  const certificatePayload = certificateMissing
    ? {
        status: "MISSING",
        note: missingIsNotCertified
          ? "No certificate present; treat as NOT certified until physics.warp.viability runs."
          : "No certificate present; certification unknown.",
      }
    : {
        status: status ?? null,
        certificateHash: grounding?.certificateHash ?? null,
        constraints: grounding?.constraints ?? null,
        snapshot: grounding?.snapshot ?? null,
        config: grounding?.config ?? null,
      };
  const body = {
    question: goal,
    certificate: certificatePayload,
    policy: policy
      ? {
          admissibleStatus: policy.admissibleStatus,
          allowMarginalAsViable: policy.allowMarginalAsViable,
          treatMissingCertificateAsNotCertified: policy.treatMissingCertificateAsNotCertified,
        }
      : undefined,
  };
  const serialized = JSON.stringify(body, (_key, value) => (value === undefined ? null : value), 2);
  return ["[Warp Certificate Context]", "```json", serialized, "```"].join("\n");
};

const buildWarpGuardrailBlock = (
  viabilityIntent: boolean,
  grounding?: WarpGroundingEvidence,
  policy?: WarpAgentsConfig["viabilityPolicy"] | null,
): string | null => {
  if (!viabilityIntent) return null;
  const failing = pickFirstFailingConstraint(grounding?.constraints);
  const admissible = policy?.admissibleStatus ?? "ADMISSIBLE";
  const allowMarginal = policy?.allowMarginalAsViable ?? false;
  const status = grounding?.status ?? "NOT_CERTIFIED";
  if (!grounding) {
    return [
      "[Warp Viability Guardrails]",
      "No warp viability certificate is attached to this request.",
      policy?.treatMissingCertificateAsNotCertified === false
        ? "Do not claim viability without a certificate; if you speculate, label it theoretical."
        : "Treat the configuration as NOT certified until physics.warp.viability runs. Do not claim viability.",
      `Only declare viability with status=${admissible}${allowMarginal ? " (or MARGINAL if policy allows)" : ""} and a certificate.`,
    ].join("\n");
  }
  const constraintHint = failing ? `${failing.id ?? "constraint"} (${failing.severity ?? "unknown"})` : null;
  return [
    "[Warp Viability Guardrails]",
    `status: ${status}${grounding?.certificateHash ? ` (hash=${grounding.certificateHash})` : ""}`,
    "Rules:",
    `- Only call the configuration viable if status=${admissible}${allowMarginal ? " or MARGINAL (per policy)" : ""} and all HARD constraints pass; cite the certificate hash.`,
    "- If status is MARGINAL or INADMISSIBLE, name the failing constraints and why using pipeline snapshot + margins.",
    constraintHint ? `- First failing constraint to surface: ${constraintHint}` : null,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildWarpNarrationSystemPrompt = (policy?: WarpAgentsConfig["viabilityPolicy"] | null): string => {
  const admissible = policy?.admissibleStatus ?? "ADMISSIBLE";
  const allowMarginal = policy?.allowMarginalAsViable ?? false;
  const header = [
    "You are the warp-console narrator. Physics pipeline outputs outrank debate/referee confidence metrics.",
    "Use only provided warp evidence (certificate, constraints, snapshot, config, warp Q&A). Never invent numbers.",
    `Do NOT claim viability unless status is ${admissible}${allowMarginal ? " or MARGINAL" : ""} AND all HARD constraints pass.`,
    "If no certificate/snapshot/constraints exist, say NOT CERTIFIED and ask to run physics.warp.viability.",
  ];
  return [...header, buildWarpSystemPrompt(policy)].filter(Boolean).join("\n\n");
};

const buildWarpNarrationPrompt = (goal: string): string =>
  [
    "Warp-console answer for operators. Use the Warp Evidence above as ground truth.",
    `Goal: ${goal}`,
    "",
    "Write four short sections:",
    '1) "How it\'s solved on the site" – implementation in this repo: Alcubierre/Natario metric in ADM 3+1 (lapse alpha, shift beta), Casimir tiles -> energy pipeline (TS_ratio ladder, gamma_geo^3, d_eff, gamma_VdB), stress-energy evaluation (T_{mu nu}, T00, M_exotic), guardrails (FordRomanQI, ThetaAudit, TS_ratio_min, VdB bands).',
    '2) "Certificate verdict for this run" – status (ADMISSIBLE/MARGINAL/INADMISSIBLE/NOT_CERTIFIED), key HARD/SOFT constraints with pass/fail and margins, snapshot values (TS_ratio, gamma_VdB, M_exotic, T00_min, etc.), certificateHash.',
    '3) "What this means" – plain-language consequences of the status and constraints.',
    '4) "What to do next" – concrete operator actions (e.g., run parameter search, adjust tiles/guardrails, rerun physics.warp.viability).',
    "",
    'If there is no certificate or snapshot, state: "NOT CERTIFIED; no snapshot/constraints; cannot claim viability" and avoid numeric claims.',
    "Rules: only quote numbers present in warp evidence; ignore missing-memory/coherence chatter; no speculation.",
  ].join("\n");

const composeResonancePatchSection = ({
  bundle,
  selection,
  preferredPatchId,
  hotNodeLimit = 5,
  intent,
}: ResonanceSectionArgs): string => {
  const unavailable = (reason: string): string =>
    ["[Code Resonance Patch]", "status: unavailable", `reason: ${reason}`].join("\n");
  if (!bundle || !bundle.candidates || bundle.candidates.length === 0) {
    return unavailable("code lattice snapshot unavailable or no resonance seeds matched this goal");
  }
  const patch = pickPatchForSection({ bundle, selection, preferredPatchId, intent });
  if (!patch) {
    return unavailable("no resonance patch ranked for this goal");
  }
  const stats = patch.stats ?? ({
    nodeCount: patch.nodes.length,
    failingTests: 0,
    activePanels: 0,
    activationTotal: patch.nodes.reduce((sum, node) => sum + (node.score ?? 0), 0),
    telemetryWeight: 0,
  } as ResonancePatch["stats"]);
  const nodes = patch.nodes
    .slice()
    .sort((a, b) => {
      const kindDiff = getKindPriority(a.kind) - getKindPriority(b.kind);
      if (kindDiff !== 0) {
        return kindDiff;
      }
      return (b.score ?? 0) - (a.score ?? 0);
    })
    .slice(0, Math.max(1, hotNodeLimit));

  if (nodes.length === 0) {
    return unavailable("resonance candidates collapsed to zero nodes");
  }

  const lines = [
    "[Code Resonance Patch]",
    `blueprint: ${patch.mode}`,
    "stats:",
    `  nodes: ${stats.nodeCount ?? nodes.length}`,
    `  activation_total: ${(stats.activationTotal ?? 0).toFixed(3)}`,
    `  telemetry_overlap: ${stats.telemetryWeight ?? 0}`,
    `  failing_tests: ${stats.failingTests ?? 0}`,
    "",
  ];

  const casimirBands = bundle?.telemetry?.casimir?.bands ?? [];
  if (casimirBands.length > 0) {
    lines.push("casimir_bands:");
    for (const band of casimirBands) {
      const bandName = normalizeBand(band.name);
      const taggedNodes = nodes
        .filter((node) => (node.bands ?? []).some((value) => normalizeBand(value) === bandName))
        .slice(0, 5);
      const sources = (band.sourceIds ?? []).slice(0, 5).join(", ");
      const nodeList = taggedNodes.map((node) => basename(node.filePath)).join(", ");
      lines.push(`- band: ${band.name}`);
      lines.push(`  seed: ${formatMetric(band.seed)}`);
      lines.push(`  coherence: ${formatMetric(band.coherence)}`);
      lines.push(`  q: ${formatMetric(band.q)}`);
      lines.push(`  occupancy: ${formatMetric(band.occupancy)}`);
      if (band.eventRate !== undefined) {
        lines.push(`  event_rate: ${formatMetric(band.eventRate)}`);
      }
      if (sources) {
        lines.push(`  sources: ${sources}`);
      }
      if (nodeList) {
        lines.push(`  nodes: ${nodeList}`);
      }
    }
    lines.push("");
  }

  lines.push("hot_nodes:");

  for (const node of nodes) {
    lines.push(
      [
        `- id: ${node.id}`,
        `  file: ${node.filePath}`,
        `  kind: ${node.kind ?? "unknown"}`,
        `  summary: ${(node.summary ?? node.symbol).replace(/\s+/g, " ")}`,
      ].join("\n"),
    );
  }

  return lines.join("\n");
};

const pickCasimirNodes = (bundle?: ResonanceBundle | null, limit = 3) => {
  if (!bundle || !bundle.candidates || bundle.candidates.length === 0) {
    return [] as ResonancePatch["nodes"];
  }
  const nodes: ResonancePatch["nodes"][number][] = [];
  for (const candidate of bundle.candidates) {
    for (const node of candidate.nodes) {
      if (CASIMIR_NODE_PATTERN.test(node.filePath) || CASIMIR_NODE_PATTERN.test(node.symbol ?? "")) {
        nodes.push(node);
      }
    }
  }
  nodes.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return nodes.slice(0, Math.max(1, limit));
};

const toFinite = (value?: number): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const formatMetric = (value?: number, digits = 3): string => {
  const finite = toFinite(value);
  return finite === null ? "n/a" : finite.toFixed(digits);
};

const composeCasimirTelemetrySection = ({
  telemetry,
  bundle,
}: {
  telemetry?: ConsoleTelemetryBundle | null;
  bundle?: ResonanceBundle | null;
}): string => {
  const panel = telemetry?.panels?.find((entry) => entry.panelId === CASIMIR_PANEL_ID) ?? null;
  const nodes = pickCasimirNodes(bundle);
  const casimir = bundle?.telemetry?.casimir;
  if (!panel && !casimir) {
    return [
      "[Casimir telemetry]",
      "status: none",
      "reason: no casimir-tiles snapshot available in console telemetry",
      "action: enable the Casimir tile emitter so planners can cite tile health.",
    ].join("\n");
  }
  const lines = [
    "[Casimir telemetry]",
    `status: ${panel?.flags?.hasActivity ? "active" : "idle"}`,
  ];
  const tileSample = panel?.tile_sample ?? casimir?.tileSample;
  const tilesActive = toFinite(tileSample?.active ?? panel?.metrics?.tilesActive);
  const totalTiles = toFinite(tileSample?.total ?? panel?.metrics?.totalTiles);
  if (tilesActive !== null || totalTiles !== null) {
    lines.push(`tiles_active: ${tilesActive ?? "n/a"}/${totalTiles ?? "n/a"}`);
  }
  lines.push(`avg_q_factor: ${formatMetric(panel?.metrics?.avgQFactor ?? casimir?.bands?.[0]?.q)}`);
  lines.push(`coherence: ${formatMetric(panel?.metrics?.coherence ?? casimir?.bands?.[0]?.coherence)}`);
  const lastIso = panel?.strings?.lastEventIso ?? casimir?.bands?.[0]?.lastEventIso;
  if (lastIso) {
    lines.push(`last_event: ${lastIso}`);
  }
  if (casimir?.bands?.length) {
    lines.push("bands:");
    for (const band of casimir.bands) {
      lines.push(
        `- ${band.name}: seed=${formatMetric(band.seed)} coherence=${formatMetric(band.coherence)} q=${formatMetric(band.q)} occupancy=${formatMetric(band.occupancy)}`,
      );
      if (band.eventRate !== undefined) {
        lines.push(`  event_rate: ${formatMetric(band.eventRate)}`);
      }
      if (band.sourceIds?.length) {
        lines.push(`  sources: ${band.sourceIds.slice(0, 5).join(", ")}`);
      }
    }
  }
  if (nodes.length > 0) {
    lines.push("", "activated_nodes:");
    for (const node of nodes) {
      const score = typeof node.score === "number" ? node.score.toFixed(3) : "n/a";
      lines.push(`- ${node.id} (${node.kind ?? "unknown"}) score=${score}`);
    }
  } else {
    lines.push("reason: telemetry present but Casimir nodes remained below the resonance threshold");
    lines.push("action: raise tile activity or widen sampling before collapse.");
  }
  return lines.join("\n");
};

const formatKnowledgeHeading = (base: string, hints?: string[]): string => {
  const list = (hints ?? []).map((hint) => hint.trim()).filter(Boolean);
  if (list.length === 0) {
    return base;
  }
  const excerpt = list.slice(0, 4).join(", ");
  const suffix = list.length > 4 ? ", ..." : "";
  return `${base} (hints: ${excerpt}${suffix})`;
};

const computePlumbingShare = (nodes: ResonancePatch["nodes"], top = 5): number => {
  if (!nodes.length) {
    return 0;
  }
  const sample = nodes.slice(0, Math.max(1, top));
  const plumbing = sample.filter((node) => (node.kind ?? "unknown") === "plumbing").length;
  return plumbing / sample.length;
};

export function collapseResonancePatches(args: {
  bundle?: ResonanceBundle | null;
  goal: string;
  jitter?: number;
}): ResonanceCollapse | null {
  const bundle = args.bundle;
  if (!bundle || !bundle.candidates || bundle.candidates.length === 0) {
    return null;
  }
  const jitter =
    typeof args.jitter === "number" && Number.isFinite(args.jitter)
      ? Math.abs(args.jitter)
      : Number(process.env.RESONANCE_COLLAPSE_JITTER ?? 0.04);
  const normalizedGoal = args.goal.toLowerCase();
  const wantsFix = FIX_KEYWORDS.test(normalizedGoal);
  const wantsIdeology = IDEOLOGY_KEYWORDS.test(normalizedGoal);

  const rankingInternal = bundle.candidates
    .map((patch) => {
      let weight = patch.score;
      if (wantsFix) {
        weight += Math.min(1, patch.stats.failingTests * 0.12);
      }
      if (patch.stats.activePanels > 0) {
        weight += Math.min(0.6, patch.stats.activePanels * 0.05);
      }
      if (wantsIdeology && patch.mode === "ideology") {
        weight += 0.35;
      } else if (!wantsIdeology && patch.mode === "ideology") {
        weight -= 0.1;
      }
      if (!wantsIdeology && patch.mode === "local") {
        weight += 0.05;
      }
      const noise = (Math.random() * 2 - 1) * jitter;
      return { patch, weightedScore: weight + noise };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const casimirCoherence = bundle.telemetry?.casimir?.totalCoherence ?? 0;
  let primary = rankingInternal[0]?.patch;
  if (!primary) {
    return null;
  }
  let backup = rankingInternal[1]?.patch;
  const primaryPlumbingShare = computePlumbingShare(primary.nodes);
  let promotedPrimary = false;
  if (
    casimirCoherence > CASIMIR_PROMOTION_THRESHOLDS.totalCoherence &&
    primaryPlumbingShare > CASIMIR_PROMOTION_THRESHOLDS.plumbingShare
  ) {
    const alternate = rankingInternal.find(
      (entry) => entry.patch.id !== primary.id && computePlumbingShare(entry.patch.nodes) <= 0.7,
    );
    if (alternate) {
      backup = primary;
      primary = alternate.patch;
      promotedPrimary = true;
    }
  }
  const ranking = rankingInternal
    .map((entry) => ({
      patchId: entry.patch.id,
      label: entry.patch.label,
      mode: entry.patch.mode,
      weightedScore: Number(entry.weightedScore.toFixed(4)),
      stats: entry.patch.stats,
    }))
    .sort((a, b) => {
      if (a.patchId === primary.id) return -1;
      if (b.patchId === primary.id) return 1;
      return 0;
    });
  const rationaleParts = [
    `Selected ${primary.label} (${primary.mode})`,
    `focus=${describePatchNodes(primary)}`,
    `panels=${primary.stats.activePanels}`,
    `failing_tests=${primary.stats.failingTests}`,
  ];
  if (casimirCoherence > 0) {
    rationaleParts.push(`casimir_coherence=${casimirCoherence.toFixed(3)}`);
  }
  if (promotedPrimary && backup) {
    rationaleParts.push(`promoted_non_plumbing=${primary.label} (was ${backup.label})`);
  }
  if (backup) {
    rationaleParts.push(`backup=${backup.label}`);
  }

  return {
    primaryPatchId: primary.id,
    backupPatchId: backup?.id,
    rationale: rationaleParts.join(" | "),
    ranking,
  };
}

type ApprovalRequest = {
  tool: Tool;
  capability: ToolRiskType;
  reason: string;
  sessionId: string;
  personaId: string;
  goal: string;
};

type ApprovalDecision = {
  granted: boolean;
  grantedBy?: string;
  notes?: string;
  message?: string;
  reason?: string;
};

type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

type PlannerPolicyError = Error & {
  type?: string;
  policy?: ExecutionErrorPolicy;
};

type TranscriptBlock = {
  turnId: string;
  stepId: string;
  kind: ExecutorStep["kind"];
  text: string;
  bytes: number;
  citations: string[];
  createdAt: string;
};

const transcriptStore = new Map<string, Map<string, TranscriptBlock>>();
type TraceEntry = { trace: TTaskTrace; expiresAt: number };
const traceStore = new Map<string, TraceEntry>();
const DEFAULT_KV_BUDGET_BYTES = 1.5e9;
const TRACE_TTL_MS = (() => {
  const fallback = 6 * 60 * 60 * 1000;
  const raw = Number(process.env.TRACE_TTL_MS ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
})();

const cleanupExpiredTraces = (): void => {
  if (traceStore.size === 0) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of traceStore.entries()) {
    if (entry.expiresAt <= now) {
      traceStore.delete(key);
    }
  }
};

export function registerInMemoryTrace(trace: TTaskTrace): void {
  cleanupExpiredTraces();
  traceStore.set(trace.id, { trace, expiresAt: Date.now() + TRACE_TTL_MS });
}

export function __getTaskTrace(id: string): TTaskTrace | undefined {
  cleanupExpiredTraces();
  const entry = traceStore.get(id);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    traceStore.delete(id);
    return undefined;
  }
  return entry.trace;
}

export function renderChatBPlannerPrompt(args: PlannerPromptArgs): string {
  const persona = args.personaId ?? "default";
  const manifestLines =
    args.manifest.length > 0
      ? args.manifest
          .map(
            (tool) =>
              `- ${tool.name}: ${tool.desc} (deterministic=${tool.deterministic ? "yes" : "no"}, rpm=${tool.rateLimit.rpm})`,
          )
          .join("\n")
      : "- (no tools registered yet)";
  const hasLocalSpawnTool = args.manifest.some(
    (tool) => tool.name === LOCAL_SPAWN_TOOL_NAME,
  );
  const hasLocalGenerateTool = args.manifest.some(
    (tool) => tool.name === "llm.local.generate",
  );
  const sampleTool = hasLocalSpawnTool
    ? LOCAL_SPAWN_TOOL_NAME
    : hasLocalGenerateTool
      ? "llm.local.generate"
      : "llm.http.generate";
  const agentMapLines = AGENT_MAP_ENABLED
    ? formatAgentMapForPrompt(loadAgentMap())
    : [];

  const lines = [
    `You are Chat B, the planner for persona ${persona}.`,
    `Goal: ${args.goal}`,
    `Always respond with ${PLAN_DSL_CHAIN}, then optionally SOLVE/VERIFY steps when specialists are enabled.`,
    PLAN_DSL_GUIDE,
    `Suggested search query: ${args.searchQuery} (top_k=${args.topK}).`,
    `Summary focus: ${args.summaryFocus}`,
    "Registered tools:",
    manifestLines,
    ...(agentMapLines.length > 0
      ? [
          "",
          "Agent map (optional):",
          ...agentMapLines,
          'Route a step with CALL(tool,{...,agent:"research"}).',
        ]
      : []),
    'Return a single line using "->" between steps, e.g.',
    `SEARCH("drive status",k=4)->SUMMARIZE(@s1,"Blockers")->CALL(${sampleTool},{"prompt":"..."})`,
  ];

  const resonanceSection = composeResonancePatchSection({
    bundle: args.resonanceBundle,
    selection: args.resonanceSelection,
    preferredPatchId: args.primaryPatchId,
  });
  if (resonanceSection) {
    lines.push("", resonanceSection);
  }

  const knowledgeHeading = formatKnowledgeHeading("Knowledge Appendix", args.knowledgeHints);
  const appendixCaps = resolveAppendixCaps(4);
  const appendix = composeKnowledgeAppendix({
    goal: args.goal,
    knowledgeContext: args.knowledgeContext,
    maxSnippets: appendixCaps.maxSnippets,
    maxChars: appendixCaps.maxChars,
    heading: knowledgeHeading,
  });
  if (appendix.text) {
    lines.push("", appendix.text);
  }

  const casimirSection = composeCasimirTelemetrySection({
    telemetry: args.telemetryBundle,
    bundle: args.resonanceBundle,
  });
  if (casimirSection) {
    lines.push("", casimirSection);
  }

  return lines.join("\n");
}

export function buildDebateNarrationPrompt(args: {
  goal: string;
  resonancePatch?: ResonancePatch | null;
  telemetrySummary?: string | null;
  verdictFromStepId?: string;
  keyTurns?: string[];
}): string {
  const patchLabel = args.resonancePatch ? `${args.resonancePatch.label} (${args.resonancePatch.mode})` : "n/a";
  const keyTurnLine = args.keyTurns && args.keyTurns.length > 0 ? `Key turns: ${args.keyTurns.join(", ")}` : null;
  const lines = [
    "Draft an operator-facing narration that blends telemetry/tool output with the referee's debate verdict.",
    `Goal: ${args.goal}`,
    `Resonance patch: ${patchLabel}`,
    "Rewrite the telemetry/tool output in one concise, actionable update.",
    "Telemetry output:",
    "{{summary}}",
    "Debate verdict:",
    "{{debate}}",
  ];
  if (args.verdictFromStepId) {
    lines.push(`Verdict source step: @${args.verdictFromStepId}`);
  }
  if (keyTurnLine) {
    lines.push(keyTurnLine);
  }
  if (args.telemetrySummary) {
    lines.push("Panel snapshot:", args.telemetrySummary);
  }
  lines.push("Keep it brief, cite notable turns, and state next actions for operators.");
  return lines.join("\n");
}

export function buildDirectNarrationPrompt(args: {
  goal: string;
  resonancePatch?: ResonancePatch | null;
  telemetrySummary?: string | null;
}): string {
  const patchLabel = args.resonancePatch ? `${args.resonancePatch.label} (${args.resonancePatch.mode})` : "n/a";
  const lines = [
    "Rewrite the telemetry/tool output for operators with clear status and next steps.",
    `Goal: ${args.goal}`,
    `Resonance patch: ${patchLabel}`,
    "Telemetry output:",
    "{{summary}}",
  ];
  if (args.telemetrySummary) {
    lines.push("Panel snapshot:", args.telemetrySummary);
  }
  lines.push("Highlight anomalies, blockers, and what to do next.");
  return lines.join("\n");
}

const AMBIGUOUS_INTENT_PATTERN = /\b(maybe|not sure|unclear|which|options?|either|should (we|i)|could|unsure)\b/i;
const WHY_COMPARE_PATTERN = /\b(why|compare|versus|vs\.?|related|difference|diff|better|trade ?off)\b/i;
const TELEMETRY_OVERLAP_LIMIT = 1;
const RESONANCE_CONFIDENCE_LIMIT = 0.35;

const computeDebateTriggers = (goal: string, patch: ResonancePatch, selection?: ResonanceCollapse | null): string[] => {
  const triggers: string[] = [];
  const normalizedGoal = goal.toLowerCase();
  if (AMBIGUOUS_INTENT_PATTERN.test(normalizedGoal) || normalizedGoal.includes("?")) {
    triggers.push("ambiguous_intent");
  }
  if (WHY_COMPARE_PATTERN.test(normalizedGoal)) {
    triggers.push("why_compare_related");
  }
  const telemetryWeight = patch.stats?.telemetryWeight ?? 0;
  if (telemetryWeight < TELEMETRY_OVERLAP_LIMIT) {
    triggers.push("low_telemetry_overlap");
  }
  const rankingEntry = selection?.ranking?.find((entry) => entry.patchId === patch.id);
  const confidence = rankingEntry?.weightedScore ?? patch.score ?? 0;
  if (!Number.isFinite(confidence) || confidence < RESONANCE_CONFIDENCE_LIMIT) {
    triggers.push("low_resonance_confidence");
  }
  if (process.env.ENABLE_DEBATE === "1") {
    triggers.push("operator_toggle");
  }
  return triggers;
};

const toFetchableAttachmentUrl = (value: string): string => {
  if (!value) {
    return "";
  }
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  // Keep local file paths intact; the debate tool converts them into fetchable URLs.
  return normalized;
};

const normalizeDebateAttachments = (
  attachments?: Array<{ title?: string; url?: string }>,
): Array<{ title: string; url: string }> => {
  const base = attachments && attachments.length > 0 ? attachments : DEFAULT_DEBATE_ATTACHMENTS;
  return base
    .map((item) => {
      const url = toFetchableAttachmentUrl(item.url ?? "");
      if (!url) {
        return null;
      }
      return { title: item.title ?? "attachment", url };
    })
    .filter(Boolean) as Array<{ title: string; url: string }>;
};

const friendlyToolLabel = (tool?: string, kind?: string): string | undefined => {
  const name = (tool || kind || "").toLowerCase();
  if (name.includes("repo.graph.search")) return "Repo search";
  if (name.includes("debate.run")) return "Debate";
  if (name.includes("debate.checklist")) return "Debate checklist";
  if (name.includes("telemetry.badges")) return "Badge telemetry";
  if (name.includes("telemetry.panels")) return "Panel telemetry";
  if (name.includes("repo_ideation")) return "Repo ideation";
  if (name.includes("repo_answer_review")) return "Answer review";
  if (name.includes("summary.compose")) return "Sketchboard summary";
  return undefined;
};

const buildDebateContext = (params: {
  patch: ResonancePatch;
  telemetrySummary?: string | null;
  knowledgeHints?: string[];
  plannerPrompt?: string | null;
}) => ({
  resonance_patch: params.patch,
  telemetry_summary: params.telemetrySummary,
  knowledge_hints: params.knowledgeHints,
  attachments: DEFAULT_DEBATE_ATTACHMENTS,
  planner_prompt: params.plannerPrompt ?? undefined,
});

export function buildCandidatePlansFromResonance(args: {
  basePlan: BuildPlanArgs;
  personaId?: string;
  manifest: ToolManifestEntry[];
  baseKnowledgeContext?: KnowledgeProjectExport[];
  resonanceBundle?: ResonanceBundle | null;
  resonanceSelection?: ResonanceCollapse | null;
  topPatches?: number;
  telemetryBundle?: ConsoleTelemetryBundle | null;
  knowledgeHints?: string[];
  telemetrySummary?: string | null;
  intent?: IntentFlags;
}): ResonantPlanCandidate[] {
  const bundle = args.resonanceBundle;
  if (!bundle || !bundle.candidates || bundle.candidates.length === 0) {
    return [];
  }
  const telemetrySummary = args.telemetrySummary ?? summarizeConsoleTelemetry(args.telemetryBundle);
  const hasDebateTool = args.manifest.some((tool) => tool.name === "debate.run");
  const narrationTool = args.manifest.some(
    (tool) => tool.name === LOCAL_SPAWN_TOOL_NAME,
  )
    ? LOCAL_SPAWN_TOOL_NAME
    : args.manifest.some((tool) => tool.name === "llm.http.generate")
      ? "llm.http.generate"
      : args.manifest.some((tool) => tool.name === "llm.local.generate")
        ? "llm.local.generate"
        : "llm.http.generate";
  const intentForClamp = args.intent ?? args.basePlan.intent ?? classifyIntent(args.basePlan.goal);
  const ranking = args.resonanceSelection?.ranking ?? [];
  const rankingOrder = ranking.map((entry) => entry.patchId);
  const topLimit = Math.max(1, Math.min(bundle.candidates.length, args.topPatches ?? 3));
  const warpIntent = args.basePlan.intent?.wantsWarp || args.basePlan.intent?.wantsPhysics;
  const sortedPatches = bundle.candidates
    .slice()
    .sort((a, b) => {
      // Prefer patches with warp/physics signals when the goal demands it.
      const aWarp = warpIntent ? hasWarpSignals(a) : false;
      const bWarp = warpIntent ? hasWarpSignals(b) : false;
      if (aWarp !== bWarp) {
        return aWarp ? -1 : 1;
      }
      const aIndex = rankingOrder.indexOf(a.id);
      const bIndex = rankingOrder.indexOf(b.id);
      if (aIndex >= 0 || bIndex >= 0) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
      return b.score - a.score;
    })
    .slice(0, topLimit);

  const candidates: ResonantPlanCandidate[] = [];
  for (const patch of sortedPatches) {
    const filteredPatch = clampPatchForIntent(patch, intentForClamp);
    if (!filteredPatch) {
      continue;
    }
    const knowledgeContext = mergeKnowledgeBundles(
      args.baseKnowledgeContext,
      filteredPatch.knowledge ? [filteredPatch.knowledge] : [],
    );
    const plannerPrompt = renderChatBPlannerPrompt({
      goal: args.basePlan.goal,
      personaId: args.personaId,
      manifest: args.manifest,
      searchQuery: args.basePlan.searchQuery,
      topK: args.basePlan.topK ?? 5,
      summaryFocus: args.basePlan.summaryFocus ?? DEFAULT_SUMMARY_FOCUS,
      knowledgeContext,
      resonanceBundle: args.resonanceBundle,
      resonanceSelection: args.resonanceSelection,
      primaryPatchId: filteredPatch.id,
      telemetryBundle: args.telemetryBundle,
      knowledgeHints: args.knowledgeHints,
    });
    const basePlan = buildChatBPlan(args.basePlan);
    const baseNodes = [...basePlan.nodes];
    const summaryId = baseNodes.find((node) => node.kind === "SUMMARIZE")?.id ?? "s2";
    const nodes: PlanNode[] = baseNodes.filter((node) => node.kind !== "CALL");
    let stepCounter = nodes.length + 1;
    const nextId = () => {
      const id = `s${stepCounter}`;
      stepCounter += 1;
      return id;
    };

    const addTelemetry = args.intent?.wantsStatus && args.manifest.some((tool) => tool.name === "telemetry.badges.read");
    if (addTelemetry) {
      nodes.push({
        id: nextId(),
        kind: "CALL",
        tool: "telemetry.badges.read",
        summaryRef: summaryId,
        promptTemplate: "Collect Casimir badge snapshot before debating.",
      });
    }

    const addChecklist =
      args.intent?.wantsStatus &&
      args.manifest.some((tool) => tool.name === "debate.checklist.generate" || tool.name === "checklist.method.generate");
    if (addChecklist) {
      nodes.push({
        id: nextId(),
        kind: "CALL",
        tool: "debate.checklist.generate",
        summaryRef: summaryId,
        promptTemplate: "Instantiate falsifiability checklist for the operator goal.",
        extra: {
          goal: args.basePlan.goal,
          frames: { observer: "operator", timescale: "session", domain: "casimir" },
          sources: DEFAULT_DEBATE_ATTACHMENTS.map((att) => att.url),
        },
      });
    }

    const debateTriggers = computeDebateTriggers(args.basePlan.goal, filteredPatch, args.resonanceSelection);
    const shouldDebate = hasDebateTool && debateTriggers.length > 0;
    if (shouldDebate) {
      const debateStepId = nextId();
      nodes.push({
        id: debateStepId,
        kind: "CALL",
        tool: "debate.run",
        summaryRef: summaryId,
        promptTemplate: [
          "Prep a short proponent/skeptic debate before operator narration.",
          "Goal: {{goal}}",
          "Context:",
          "{{summary}}",
          "Return the referee verdict with confidence and key_turn_ids.",
        ].join("\n"),
        extra: {
          topic: args.basePlan.goal,
          personaId: args.personaId ?? "default",
          context: buildDebateContext({
            patch: filteredPatch,
            telemetrySummary,
            knowledgeHints: args.knowledgeHints,
            plannerPrompt,
          }),
          budgets: pickDebateBudgets(args.intent, { max_rounds: 4, max_wall_ms: 15000 }),
          debateTriggers,
        },
      });
        nodes.push({
          id: nextId(),
          kind: "CALL",
          tool: narrationTool,
          summaryRef: summaryId,
          promptTemplate: buildDebateNarrationPrompt({
            goal: args.basePlan.goal,
            resonancePatch: filteredPatch,
            telemetrySummary,
            verdictFromStepId: debateStepId,
            keyTurns: [],
          }),
        extra: {
          narrationKind: "debate",
          verdictFrom: debateStepId,
          debateTriggers,
          useDebate: true,
        },
      });
    } else {
      const fallbackCall = baseNodes.find((node) => node.kind === "CALL");
      if (fallbackCall) {
        nodes.push({ ...fallbackCall, id: nextId(), summaryRef: summaryId });
      }
      nodes.push({
        id: nextId(),
        kind: "CALL",
        tool: narrationTool,
        summaryRef: summaryId,
        promptTemplate: buildDirectNarrationPrompt({
          goal: args.basePlan.goal,
          resonancePatch: filteredPatch,
          telemetrySummary,
        }),
        extra: { narrationKind: "direct" },
      });
    }
    const planDsl = formatPlanDsl(nodes);
    candidates.push({
      patch: filteredPatch,
      knowledgeContext,
      plannerPrompt,
      nodes,
      planDsl,
    });
  }
  return candidates;
}

function maybeInjectSpecialists(goal: string, planSteps: PlanNode[]): PlanNode[] {
  if (process.env.ENABLE_SPECIALISTS !== "1" || planSteps.some((node) => node.kind === "SOLVE")) {
    return planSteps;
  }
  const normalized = goal.toLowerCase();
  const mathPattern = /\b(compute|simplify|solve|calculate|derivative|integral|sum|equation|expression|formula)\b/;
  const inlineMath = /[-+*/=()\d\s]{4,}/;
  const isMath = mathPattern.test(normalized) || inlineMath.test(goal);
  if (!isMath) {
    return planSteps;
  }
  const lastSummary = [...planSteps].reverse().find((node) => node.kind === "SUMMARIZE");
  const summaryRef = lastSummary?.id;
  const base = planSteps.length + 1;
  const solveId = `s${base}`;
  const verifyId = `s${base + 1}`;
  const expr = goal.replace(/^.*?:/, "").trim() || goal.trim();
  const verifyName = process.env.ENABLE_SYMPY_VERIFIER === "1" ? "math.sympy.verify" : "math.sum.verify";
  return [
    ...planSteps,
    {
      id: solveId,
      kind: "SOLVE",
      solver: "math.expr",
      summaryRef,
      params: { expr },
    },
    {
      id: verifyId,
      kind: "VERIFY",
      source: solveId,
      verifier: verifyName,
    },
  ];
}

export function buildChatBPlan(args: BuildPlanArgs): { nodes: PlanNode[]; planDsl: string } {
  const topK = clamp(args.topK ?? 5, 1, 10);
  const summaryFocus = args.summaryFocus?.trim() || DEFAULT_SUMMARY_FOCUS;
  const strategy = args.strategy ?? "default";
  const detailPref = args.detailPreference ?? "medium";
  const intent = args.intent ?? classifyIntent(args.goal);
  const viabilityRuleLine = isViabilityIntentGoal(args.goal)
    ? "If the user asks whether a warp configuration is viable/admissible, call physics.warp.viability to get the certificate. Base viability strictly on certificate.payload.status/constraints; never invent results. If status is MARGINAL or INADMISSIBLE, cite the first failing HARD constraint (otherwise the first failing constraint). Surface key snapshot numbers from the certificate: TS_ratio, gamma_VdB, T00_min, M_exotic."
    : null;
  const repoGraphAvailable = Boolean(getTool("repo.graph.search"));
  const repoQuery = normalizeForIntent(args.searchQuery || args.goal);
  const resourceHints = args.resourceHints ?? [];
  const seedPaths = Array.from(
    new Set(
      resourceHints
        .map((hint) => hint.path)
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0),
    ),
  );
  const needReview =
    args.preferReviewed ||
    strategy === "deep_repo_research" ||
    strategy === "repo_design_ideation" ||
    detailPref === "long";
  const nodes: PlanNode[] = [];
  let step = 1;
  const nextId = () => `s${step++}`;

  const addCoreSearchAndSummary = () => {
    const searchId = nextId();
    nodes.push({
      id: searchId,
      kind: "SEARCH",
      query: args.searchQuery,
      topK,
      target: "memory",
      note: `Ground goal "${args.goal}" with Essence memories`,
    });
    nodes.push({ id: nextId(), kind: "SUMMARIZE", source: searchId, focus: summaryFocus });
  };

  const buildPhysicsConsolePlan = () => {
    const askId = nextId();
    nodes.push({
      id: askId,
      kind: "CALL",
      tool: "physics.warp.ask",
      promptTemplate: "Run physics.warp.ask to unpack the warp question and capture a snapshot.",
      extra: { question: args.goal, includeSnapshot: true },
    });
    const viabilityId = nextId();
    nodes.push({
      id: viabilityId,
      kind: "CALL",
      tool: "physics.warp.viability",
      summaryRef: askId,
      promptTemplate:
        "Run physics.warp.viability to issue the warp certificate. Use only certificate payload for viability/status.",
      extra: {},
    });
    const finalCallId = nextId();
    nodes.push({
      id: finalCallId,
      kind: "CALL",
      tool: args.finalTool,
      summaryRef: viabilityId,
      promptTemplate:
        "Warp-console narration: explain implementation, cite certificate status/constraints/snapshot, then consequences and next actions.",
      extra: {
        appendSummaries: [askId, viabilityId],
        narrationKind: "direct",
        reasoningStrategy: strategy,
      },
    });
    return { nodes, planDsl: formatPlanDsl(nodes) };
  };

  const buildDeepRepoPattern = () => {
    addCoreSearchAndSummary();
    const repoSearchId = nextId();
    nodes.push({
      id: repoSearchId,
      kind: "CALL",
      tool: "repo.graph.search",
      summaryRef: "s2",
      promptTemplate: "Explore repository graph for relations around {{goal}}. Use summary for hints: {{summary}}",
      extra: {
        query: repoQuery,
        limit: Math.max(12, topK + 5),
        intentTags: intent.wantsWarp || intent.wantsPhysics ? ["warp-physics"] : undefined,
        seedPaths: seedPaths.length ? seedPaths : undefined,
      },
    });
    const sketchId = nextId();
    const sketchFocus =
      "Repo sketchboard: key files/symbols, flows/calls, imports, tests, risks, and inline paths. Keep bullets tight.";
    nodes.push({
      id: sketchId,
      kind: "SUMMARIZE",
      source: repoSearchId,
      focus: detailPref === "short" ? `${sketchFocus} Compress to short bullets.` : sketchFocus,
    });
    const finalCallId = nextId();
    nodes.push({
      id: finalCallId,
      kind: "CALL",
      tool: args.finalTool,
      summaryRef: "s2",
      promptTemplate: [
        "You are Chat B, compiling an actionable repo answer as a tool (not a persona).",
        "Persona: {{persona}}",
        "Goal: {{goal}}",
        "Grounded memory context:",
        "{{summary}}",
        "Use repo sketchboard for structure; cite file paths/symbols inline.",
        "Separate 'Facts from repo' vs 'Inferred suggestions'.",
        "Perform TIMAR review inline: Traceability, Impact, Mitigations, Alternatives, Risks.",
        viabilityRuleLine,
        detailPref === "short" ? "Keep it concise; compress bullets and flows." : "Provide clear bullets and flow notes.",
      ]
        .filter(Boolean)
        .join("\n"),
      extra: {
        appendSummaries: ["s2", sketchId],
        reasoningStrategy: strategy,
        timarReview: true,
      },
    });
    if (process.env.ENABLE_SPECIALISTS === "1") {
      nodes.push({
        id: nextId(),
        kind: "SOLVE",
        solver: "philo.synthesis",
        summaryRef: finalCallId,
        verifier: process.env.ENABLE_SYMPY_VERIFIER === "1" ? "math.sympy.verify" : undefined,
        params: { focus: "repo-plan-verify" },
      });
    }
    if (needReview && process.env.ENABLE_SPECIALISTS === "1") {
      nodes.push({
        id: nextId(),
        kind: "SOLVE",
        solver: "repo_answer_review",
        summaryRef: finalCallId,
        params: { concepts_from_summary: true, require_citations: true },
      });
    }
  };

  if (strategy === "physics_console") {
    return buildPhysicsConsolePlan();
  }

  const buildRepoDesignIdeation = () => {
    addCoreSearchAndSummary();
    const repoSearchId = nextId();
    nodes.push({
      id: repoSearchId,
      kind: "CALL",
      tool: "repo.graph.search",
      summaryRef: "s2",
      promptTemplate: "Explore repository graph for design target. Use summary hints: {{summary}}",
      extra: {
        query: repoQuery,
        limit: Math.max(14, topK + 6),
        intentTags: intent.wantsWarp || intent.wantsPhysics ? ["warp-physics"] : undefined,
        seedPaths: seedPaths.length ? seedPaths : undefined,
      },
    });
    const archSummaryId = nextId();
    const archFocus =
      "Current subsystem architecture: key files/symbols, data/flow, imports, tests, risks. Extract a concept list (bullet form).";
    nodes.push({
      id: archSummaryId,
      kind: "SUMMARIZE",
      source: repoSearchId,
      focus: detailPref === "short" ? `${archFocus} Compress bullets.` : archFocus,
    });
    const ideateId = process.env.ENABLE_SPECIALISTS === "1" ? nextId() : null;
    if (ideateId) {
      nodes.push({
        id: ideateId,
        kind: "SOLVE",
        solver: "repo_ideation",
        summaryRef: archSummaryId,
        params: { concepts_from_summary: true, max_options: 4 },
      });
    }
    if (process.env.ENABLE_DEBATE === "1" && ideateId) {
      nodes.push({
        id: nextId(),
        kind: "CALL",
        tool: "debate.run",
        summaryRef: ideateId,
        promptTemplate: "Run debate over the proposed repo design/refactor ideas.",
        extra: {
          topic: args.goal,
          budgets: pickDebateBudgets(args.intent, { max_rounds: 2, max_wall_ms: 90000 }),
          debateTriggers: ["design", "refactor", "architecture", "feasibility", "novelty"],
        },
      });
    }
    const finalCallId = nextId();
    nodes.push({
      id: finalCallId,
      kind: "CALL",
      tool: args.finalTool,
      summaryRef: archSummaryId,
      promptTemplate: [
        "You are Chat B, turn the selected repo design idea into a plan and checklist.",
        "Persona: {{persona}}",
        "Goal: {{goal}}",
        "Architecture sketch:",
        "{{summary}}",
        "Include ideation outcomes and debate verdict; cite file paths/symbols inline.",
        "Separate 'Facts from repo' vs 'Plan / Suggested changes'.",
        "Output: concise explanation + optional checklist of code changes.",
        detailPref === "short" ? "Keep answers tight; avoid fluff." : "Be clear and specific; keep bullets short.",
      ]
        .filter(Boolean)
        .join("\n"),
      extra: {
        appendSummaries: ideateId ? [archSummaryId, ideateId, "s2"] : [archSummaryId, "s2"],
        reasoningStrategy: strategy,
        timarReview: true,
      },
    });
    if (needReview && process.env.ENABLE_SPECIALISTS === "1") {
      nodes.push({
        id: nextId(),
        kind: "SOLVE",
        solver: "repo_answer_review",
        summaryRef: ideateId ?? archSummaryId,
        params: { concepts_from_summary: true, require_citations: true },
      });
    }
  };

  if (strategy === "deep_repo_research" && repoGraphAvailable) {
    buildDeepRepoPattern();
    const enriched = maybeInjectSpecialists(args.goal, nodes);
    return { nodes: enriched, planDsl: formatPlanDsl(enriched) };
  }

  if (strategy === "repo_design_ideation" && repoGraphAvailable) {
    buildRepoDesignIdeation();
    const enriched = maybeInjectSpecialists(args.goal, nodes);
    return { nodes: enriched, planDsl: formatPlanDsl(enriched) };
  }

  addCoreSearchAndSummary();

  if (strategy === "design-debate" && process.env.ENABLE_DEBATE === "1") {
    nodes.push({
      id: nextId(),
      kind: "CALL",
      tool: "debate.checklist.generate",
      summaryRef: "s2",
      promptTemplate:
        "Generate a falsifiability checklist for this design/refactor goal. Keep it concise and focused on risk and verification.",
      extra: { goal: args.goal, frames: { observer: "operator", timescale: "session", domain: "repo" } },
    });
    nodes.push({
      id: nextId(),
      kind: "CALL",
      tool: "debate.run",
      summaryRef: "s2",
      promptTemplate: "Run a lightweight debate on the proposed design/refactor plan.",
      extra: {
        topic: args.goal,
        budgets: pickDebateBudgets(intent, { max_rounds: 2, max_wall_ms: 120000 }),
        debateTriggers: ["design", "refactor", "architecture"],
      },
    });
  }

  const repoSupport = repoGraphAvailable && (intent.wantsWarp || intent.wantsImplementation || intent.wantsPhysics);
  let repoSummaryId: string | null = null;
  if (repoSupport) {
    const repoSearchId = nextId();
    nodes.push({
      id: repoSearchId,
      kind: "CALL",
      tool: "repo.graph.search",
      summaryRef: "s2",
      promptTemplate:
        "Scan repo for physics/warp/pipeline context around {{goal}}. Prioritize modules/warp, modules/dynamic, energy-pipeline.ts, natario-metric, target-validation, stress-energy, casimir docs, and related papers. Use summary hints: {{summary}}",
      extra: {
        query: repoQuery,
        limit: Math.max(12, topK + 6),
        intentTags: intent.wantsWarp || intent.wantsPhysics ? ["warp-physics"] : undefined,
      },
    });
    repoSummaryId = nextId();
    nodes.push({
      id: repoSummaryId,
      kind: "SUMMARIZE",
      source: repoSearchId,
      focus:
        "Key physics/warp/pipeline files, functions, parameters, telemetry hooks, and how the website computes or renders the solution. Keep bullets tight with file paths.",
    });
  }

  if (process.env.ENABLE_DEBATE === "1" && intent.wantsStatus) {
    nodes.push({
      id: nextId(),
      kind: "CALL",
      tool: "telemetry.badges.read",
      summaryRef: "s2",
      promptTemplate: "Collect badge telemetry to ground debate context.",
    });
    nodes.push({
      id: nextId(),
      kind: "CALL",
      tool: "debate.checklist.generate",
      summaryRef: "s2",
      promptTemplate: "Create falsifiability checklist for the operator goal.",
      extra: {
        goal: args.goal,
        frames: { observer: "operator", timescale: "session", domain: "casimir" },
        sources: DEFAULT_DEBATE_ATTACHMENTS.map((att) => att.url),
      },
    });
  }

  nodes.push({
    id: nextId(),
    kind: "CALL",
    tool: args.finalTool,
    summaryRef: "s2",
    promptTemplate: [
      "You are Chat B, compiling an actionable response as a tool (not a persona).",
      "Persona: {{persona}}",
      "Goal: {{goal}}",
      "Grounded context (memory):",
      "{{summary}}",
      "Perform TIMAR review inline: Traceability, Impact, Mitigations, Alternatives, Risks.",
      viabilityRuleLine,
      "Return the next concrete action or answer with provenance notes; avoid emotions or confessional language.",
    ]
      .filter(Boolean)
      .join("\n"),
    extra: {
      appendSummaries: repoSummaryId ? ["s2", repoSummaryId] : ["s2"],
      reasoningStrategy: strategy,
      timarReview: true,
    },
  });

  const enriched = maybeInjectSpecialists(args.goal, nodes);
  return { nodes: enriched, planDsl: formatPlanDsl(enriched) };
}
export function compilePlan(nodes: PlanNode[]): ExecutorStep[] {
  return nodes.map((node): ExecutorStep => {
    switch (node.kind) {
      case "SEARCH":
        return { id: node.id, kind: "memory.search", query: node.query, topK: node.topK };
      case "SUMMARIZE":
        return { id: node.id, kind: "summary.compose", source: node.source, focus: node.focus };
      case "CALL":
        if (node.tool === "debate.run") {
          const extra = (node.extra ?? {}) as {
            topic?: string;
            personaId?: string;
            context?: Record<string, unknown>;
            budgets?: { max_rounds?: number; max_wall_ms?: number };
            debateTriggers?: string[];
          };
          return {
            id: node.id,
            kind: "debate.run",
            tool: "debate.run",
            topic: extra.topic,
            personaId: extra.personaId,
            summaryRef: node.summaryRef,
            context: extra.context,
            budgets: extra.budgets,
            debateTriggers: extra.debateTriggers,
          };
        }
        return {
          id: node.id,
          kind: "tool.call",
          tool: node.tool,
          summaryRef: node.summaryRef,
          promptTemplate: node.promptTemplate,
          extra: node.extra,
        };
      case "SOLVE":
        return {
          id: node.id,
          kind: "specialist.run",
          solver: node.solver,
          summaryRef: node.summaryRef,
          verifier: node.verifier,
          params: node.params,
          repair: node.repair,
        };
      case "VERIFY":
        return { id: node.id, kind: "specialist.verify", source: node.source, verifier: node.verifier };
      case "DEBATE_START":
      case "DEBATE.START":
        return { id: node.id, kind: "debate.start", topic: node.topic, summaryRef: node.summaryRef };
      case "DEBATE_CONSUME":
      case "DEBATE.CONSUME":
        return { id: node.id, kind: "debate.consume", source: node.source };
      default:
        throw new Error(`Unsupported planner node: ${(node as { kind: string }).kind}`);
    }
  });
}

export async function executeCompiledPlan(steps: ExecutorStep[], runtime: ExecutionRuntime): Promise<ExecutionResult[]> {
  const sessionId = runtime.sessionId ?? runtime.goal;
  const budgetBytes = Number(process.env.KV_BUDGET_BYTES ?? DEFAULT_KV_BUDGET_BYTES);
  runtime.debateId = runtime.debateId ?? runtime.taskTrace?.debate_id ?? null;
  runtime.debateOutcome = runtime.debateOutcome ?? null;
  runtime.strategy = (runtime.strategy ?? runtime.taskTrace?.reasoning_strategy ?? undefined) as
    | ReasoningStrategy
    | undefined;
  runtime.telemetrySummary = runtime.telemetrySummary ?? runtime.taskTrace?.telemetry_summary ?? null;
  runtime.resonanceBundle = runtime.resonanceBundle ?? runtime.taskTrace?.resonance_bundle ?? null;
  runtime.resonanceSelection = runtime.resonanceSelection ?? runtime.taskTrace?.resonance_selection ?? null;
  runtime.plannerPrompt = runtime.plannerPrompt ?? runtime.taskTrace?.planner_prompt ?? null;
  runtime.intent = runtime.intent ?? classifyIntent(runtime.goal);
  const debugSourcesEnabled = Boolean(runtime.debugSources ?? runtime.taskTrace?.debug_sources);
  runtime.debugSources = debugSourcesEnabled;
  if (debugSourcesEnabled) {
    const groundingHolder: { groundingReport?: GroundingReport } = {
      groundingReport: runtime.groundingReport ?? runtime.taskTrace?.grounding_report ?? undefined,
    };
    ensureGroundingReport(groundingHolder);
    recordResonancePatchSources(groundingHolder, {
      bundle: runtime.resonanceBundle,
      selection: runtime.resonanceSelection,
      filterNode:
        runtime.intent?.wantsWarp || runtime.intent?.wantsPhysics
          ? (node) => isWarpRelevantPath(node.filePath) || isWarpRelevantPath(node.symbol ?? "")
          : undefined,
    });
    recordKnowledgeSources(groundingHolder, runtime.knowledgeContext ?? runtime.taskTrace?.knowledgeContext);
    runtime.groundingReport = groundingHolder.groundingReport;
  }
  const outputs = new Map<string, unknown>();
  const citationsByStep = new Map<string, string[]>();
  const results: ExecutionResult[] = [];
  const citationVerification: CitationVerificationState = {
    enabled: process.env.ENABLE_KNOWLEDGE_CITATION_VERIFY === "1",
  };

  for (const step of steps) {
    const stepStart = Date.now();
    let stepEssenceIds: string[] = [];
    try {
      let output: unknown;
      let citations: string[] = [];
      if (step.kind === "memory.search") {
        const hits = await searchMemories(step.query, step.topK);
        output = hits;
          citations = hits.map(formatMemoryCitation);
        if (debugSourcesEnabled && hits.length > 0) {
          const memorySources: GroundingSource[] = hits.map((hit) => ({
            kind: "memory",
            id: (hit as any).envelope_id ?? hit.id,
            path: (hit as any).path ?? (hit as any).sourcePath,
            extra: { score: hit.score },
          }));
          pushGroundingSources(runtime, memorySources);
        }
      } else if (step.kind === "summary.compose") {
        const source = outputs.get(step.source);
        const hits = Array.isArray(source)
          ? (source as TMemorySearchHit[])
          : Array.isArray((source as any)?.hits)
            ? ((source as any).hits as TMemorySearchHit[])
            : [];
        output = summarizeHits(hits, step.focus, runtime.goal);
        if (debugSourcesEnabled && hits.length > 0) {
          const paths = hits
            .map((hit) => (hit as any).path ?? (hit as any).sourcePath)
            .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
          if (paths.length > 0) {
            pushGroundingSource(runtime, {
              kind: "memory",
              id: step.source,
              extra: { paths: Array.from(new Set(paths)) },
            });
          }
        }
        const inherited = citationsByStep.get(step.source) ?? [];
        citations = inherited.length > 0 ? [...inherited] : [step.source];
      } else if (step.kind === "debate.start") {
        const summary = step.summaryRef ? outputs.get(step.summaryRef) : undefined;
        const summaryText = typeof summary === "string" && summary.trim() ? summary.trim() : runtime.goal;
        const topic = step.topic || summaryText || runtime.goal;
        const contextBase = {
          resonance_patch: runtime.resonanceSelection ?? runtime.resonanceBundle,
          telemetry_summary: runtime.telemetrySummary,
          knowledge_hints: runtime.knowledgeHints,
          attachments: DEFAULT_DEBATE_ATTACHMENTS,
          planner_prompt: runtime.plannerPrompt ?? runtime.taskTrace?.planner_prompt,
        };
        const context = { ...contextBase, attachments: normalizeDebateAttachments(contextBase.attachments) };
        const intent = runtime.intent ?? classifyIntent(runtime.goal);
        const envMaxRounds = Number(process.env.DEBATE_MAX_ROUNDS ?? NaN);
        const envMaxWallMs = Number(process.env.DEBATE_MAX_WALL_MS ?? NaN);
        const isWarpSerious = intent.wantsWarp || intent.wantsPhysics;
        const budgets = {
          max_rounds: isWarpSerious
            ? (Number.isFinite(envMaxRounds) ? envMaxRounds : 3)
            : Number.isFinite(envMaxRounds)
              ? envMaxRounds
              : undefined,
          max_wall_ms: isWarpSerious
            ? Math.max(Number.isFinite(envMaxWallMs) ? envMaxWallMs : 0, 20 * 60 * 1000)
            : Number.isFinite(envMaxWallMs)
              ? envMaxWallMs
              : undefined,
        };
        const config = DebateConfig.parse({
          goal: topic,
          persona_id: runtime.personaId ?? "default",
          max_rounds: Number.isFinite(budgets.max_rounds) ? budgets.max_rounds : undefined,
          max_wall_ms: Number.isFinite(budgets.max_wall_ms) ? budgets.max_wall_ms : undefined,
          context,
        });
        const toolStart = Date.now();
        const debateStart = await startDebate(config as any);
        const debateId: string = debateStart.debateId;
        runtime.debateId = debateId;
        runtime.debateOutcome = null;
        if (runtime.taskTrace) {
          runtime.taskTrace.debate_id = debateId;
        }
        appendToolLog({
          tool: "debate.start",
          version: "orchestrator",
          paramsHash: hashPayload(config),
          promptHash: hashText(topic),
          durationMs: Date.now() - toolStart,
          sessionId,
          traceId: runtime.taskTrace?.id ?? sessionId,
          stepId: step.id,
          ok: true,
          text: `debate started (${debateId})`,
          essenceId: undefined,
          seed: undefined,
          debateId,
          strategy: runtime.strategy ?? runtime.taskTrace?.reasoning_strategy ?? undefined,
        });
        output = { debateId, goal: topic };
        citations = [];
      } else if (step.kind === "debate.consume") {
        const prior = outputs.get(step.source) as { debateId?: string } | undefined;
        const debateId: string | null =
          runtime.debateId ?? prior?.debateId ?? (runtime.taskTrace?.debate_id as string | null) ?? null;
        if (!debateId) {
          throw new Error("debate id missing");
        }
        const outcome = await waitForDebateOutcome(debateId);
        runtime.debateId = debateId;
        runtime.debateOutcome = outcome ?? null;
        if (runtime.taskTrace) {
          runtime.taskTrace.debate_id = debateId;
        }
        if (debugSourcesEnabled && outcome) {
          pushGroundingSource(runtime, {
            kind: "debate",
            id: debateId,
            extra: { confidence: outcome.confidence, verdict: outcome.verdict, key_turn_ids: outcome.key_turn_ids },
          });
        }
        const duration = Date.now() - stepStart;
        appendToolLog({
          tool: "debate.consume",
          version: "orchestrator",
          paramsHash: hashPayload({ debateId }),
          promptHash: debateId,
          durationMs: duration,
          sessionId,
          traceId: runtime.taskTrace?.id ?? sessionId,
          stepId: step.id,
          ok: Boolean(outcome),
          text: outcome ? `debate verdict: ${outcome.verdict}` : "debate verdict pending",
          essenceId: undefined,
          seed: undefined,
          debateId,
          strategy: runtime.strategy ?? runtime.taskTrace?.reasoning_strategy ?? undefined,
        });
        output = { debateId, outcome: outcome ?? null };
        citations = outcome?.key_turn_ids ?? [];
      } else if (step.kind === "debate.run") {
        const tool = getTool(step.tool);
        if (!tool) {
          const duration = Date.now() - stepStart;
          const error: ExecutionError = { message: `Tool "${step.tool}" not found`, type: "tool_unavailable" };
          metrics.recordTool(step.tool, duration, false);
          results.push({
            id: step.id,
            kind: step.kind,
            ok: false,
            output: null,
            error,
            citations: [],
            latency_ms: duration,
            essence_ids: [],
          });
          citationsByStep.set(step.id, []);
          break;
        }
        await ensureToolApprovals(tool, runtime);
        const summary = step.summaryRef ? outputs.get(step.summaryRef) : undefined;
        const summaryText = formatSummaryForPrompt(summary);
        const supplements = collectSupplementsFromOutputs(outputs.values());
        const warpSupplement = collectWarpSupplement(outputs, supplements);
        const rawContext = step.context ?? {};
        const requiresWarpGrounding = needsWarpImplementationGrounding(runtime);
        const warpGroundingForDebate: WarpGroundingEvidence | undefined =
          (rawContext as { warp_grounding?: WarpGroundingEvidence | null }).warp_grounding ??
          (warpSupplement?.grounding
            ? { ...warpSupplement.grounding, citations: warpSupplement.citations }
            : warpSupplement
            ? {
                status: "NOT_CERTIFIED",
                summary: warpSupplement.text,
                config: undefined,
                snapshot: {} as TWarpSnapshot,
                constraints: [],
                certificateHash: undefined,
                certificateId: undefined,
                citations: warpSupplement.citations,
                askAnswer: undefined,
              }
            : undefined);
        const hasDebateEvidence = hasWarpDebateEvidence(warpGroundingForDebate);
        const budgetIntentBase = runtime.intent ?? classifyIntent(runtime.goal);
        const intentForBudgets =
          hasDebateEvidence || warpSupplement
            ? { ...budgetIntentBase, wantsWarp: true, wantsPhysics: true }
            : budgetIntentBase;
        const debateBudgets = pickDebateBudgets(intentForBudgets, step.budgets);
        const ungroundedSummary = isUngroundedSummary(summaryText) && !warpSupplement && supplements.length === 0;
        const enforceWarpEvidence = requiresWarpGrounding || Boolean(warpSupplement);
        const missingGrounding = enforceWarpEvidence && !hasDebateEvidence;
        if (ungroundedSummary || missingGrounding) {
          const debateId: string = runtime.debateId ?? step.id;
          const skippedOutcome: TDebateOutcome = {
            debate_id: debateId,
            verdict: missingGrounding ? "skipped_no_grounding" : "skipped_no_evidence",
            confidence: 0,
            winning_role: undefined,
            key_turn_ids: [],
            rounds: 0,
            stop_reason: missingGrounding ? "no_grounding" : "no_evidence",
            score: 0,
            metrics: undefined,
            created_at: new Date().toISOString(),
          };
          output = {
            debateId,
            verdict: skippedOutcome.verdict,
            stop_reason: skippedOutcome.stop_reason,
            confidence: 0,
            key_turn_ids: [],
          };
          citations = [];
          runtime.debateId = debateId;
          runtime.debateOutcome = skippedOutcome;
          if (runtime.taskTrace) {
            runtime.taskTrace.debate_id = debateId;
          }
          if (debugSourcesEnabled) {
            pushGroundingSource(runtime, {
              kind: "debate",
              id: debateId,
              extra: { confidence: skippedOutcome.confidence, verdict: skippedOutcome.verdict, stop_reason: skippedOutcome.stop_reason },
            });
          }
          const duration = Date.now() - stepStart;
          metrics.recordTool(step.tool, duration, true);
          appendToolLog({
            tool: step.tool,
            version: (tool as any).version ?? "unknown",
            paramsHash: hashPayload({ skipped: true }),
            promptHash: hashText(summaryText || warpSupplement?.text || runtime.goal),
            seed: (summary as { seed?: unknown } | undefined)?.seed,
            sessionId,
            traceId: runtime.taskTrace?.id ?? sessionId,
            durationMs: duration,
            ok: true,
            error: undefined,
            essenceId: undefined,
            stepId: step.id,
            debateId,
            strategy: runtime.strategy ?? runtime.taskTrace?.reasoning_strategy ?? undefined,
            text: missingGrounding ? "Debate skipped (no grounding)" : "Debate skipped (no evidence)",
          });
        } else {
          const topic = (step.topic ?? "").trim() || summaryText || warpSupplement?.text || runtime.goal;
          const context = {
            ...rawContext,
            planner_prompt:
              (rawContext as { planner_prompt?: string }).planner_prompt ??
              runtime.plannerPrompt ??
              runtime.taskTrace?.planner_prompt,
            telemetry_summary:
              (rawContext as { telemetry_summary?: string | null }).telemetry_summary ?? runtime.telemetrySummary,
            knowledge_hints: (rawContext as { knowledge_hints?: string[] }).knowledge_hints ?? runtime.knowledgeHints,
            resonance_patch:
              (rawContext as { resonance_patch?: unknown }).resonance_patch ??
              runtime.resonanceSelection ??
              runtime.resonanceBundle,
            warp_grounding: warpGroundingForDebate,
          };
          const contextWithAttachments = {
            ...context,
            attachments: normalizeDebateAttachments(
              (context as { attachments?: Array<{ title?: string; url?: string }> }).attachments,
            ),
          };
          const input = {
            topic,
            personaId: step.personaId ?? runtime.personaId ?? "default",
            context: contextWithAttachments,
            budgets: debateBudgets ?? step.budgets,
          };
          const paramsHash = hashPayload(input);
          const toolStart = Date.now();
          let toolError: unknown;
          let result: any;
          let essenceId: string | undefined;
          const debatePersonaId = step.personaId ?? runtime.personaId ?? "default";
          try {
            result = await tool.handler(input, {
              sessionId,
              goal: runtime.goal,
              personaId: debatePersonaId,
            });
            essenceId = extractEssenceId(result);
          } catch (err) {
            toolError = err;
          } finally {
            const duration = Date.now() - toolStart;
            const ok = !toolError;
            metrics.recordTool(step.tool, duration, ok);
            const logDebateId =
              result && typeof result === "object"
                ? ((result as { debateId?: string; debate_id?: string }).debateId ??
                  (result as { debate_id?: string }).debate_id)
                : undefined;
            appendToolLog({
              tool: step.tool,
              version: (tool as any).version ?? "unknown",
              paramsHash,
              promptHash: paramsHash,
              seed: (input as { seed?: unknown }).seed,
              sessionId,
              traceId: runtime.taskTrace?.id ?? sessionId,
              durationMs: duration,
              ok,
              error: toolError ? formatToolError(toolError) : undefined,
              policy: resolveToolPolicyFlags(toolError),
              essenceId,
              stepId: step.id,
              debateId: logDebateId,
              strategy: runtime.strategy ?? runtime.taskTrace?.reasoning_strategy ?? undefined,
              text: friendlyToolLabel(step.tool, step.kind),
            });
          }
          if (toolError) {
            throw toolError;
          }
          const debateId =
            (result as { debateId?: string; debate_id?: string }).debateId ?? (result as { debate_id?: string }).debate_id ?? null;
          const confidenceRaw = (result as { confidence?: number }).confidence;
          const confidence = Number.isFinite(confidenceRaw ?? NaN) ? Number(confidenceRaw) : 0;
          const stopReason =
            (result as { stop_reason?: string }).stop_reason ??
            (result as { stopReason?: string }).stopReason ??
            undefined;
          const scoreRaw = (result as { score?: number }).score;
          const score = Number.isFinite(scoreRaw ?? NaN) ? Number(scoreRaw) : undefined;
          const roundsRaw = (result as { rounds?: number }).rounds;
          const rounds = Number.isFinite(roundsRaw ?? NaN) ? Math.max(0, Math.floor(roundsRaw as number)) : undefined;
          const metricsResult = (result as { metrics?: TDebateRoundMetrics }).metrics;
          const keyTurnIds = Array.isArray((result as { key_turn_ids?: string[] }).key_turn_ids)
            ? ((result as { key_turn_ids?: string[] }).key_turn_ids ?? []).filter((id) => typeof id === "string")
            : [];
          const verdict = (result as { verdict?: string }).verdict ?? "unknown";
          output = {
            debateId,
            verdict,
            confidence,
            key_turn_ids: keyTurnIds,
            winning_role: (result as { winning_role?: TDebateOutcome["winning_role"] }).winning_role,
            stop_reason: stopReason,
            score,
            rounds,
            metrics: metricsResult,
          };
          citations = keyTurnIds;
          const debateOutcome: TDebateOutcome = {
            debate_id: debateId ?? runtime.debateId ?? step.id,
            verdict,
            confidence,
            winning_role: (result as { winning_role?: TDebateOutcome["winning_role"] }).winning_role,
            key_turn_ids: keyTurnIds,
            rounds: rounds ?? 0,
            stop_reason: stopReason,
            score: score ?? 0,
            metrics: metricsResult,
            created_at: new Date().toISOString(),
          };
          if (essenceId) {
            stepEssenceIds = [essenceId];
          }
          runtime.debateId = debateOutcome.debate_id;
          runtime.debateOutcome = debateOutcome;
          if (runtime.taskTrace) {
            runtime.taskTrace.debate_id = debateOutcome.debate_id;
          }
          if (debugSourcesEnabled) {
            pushGroundingSource(runtime, {
              kind: "debate",
              id: debateOutcome.debate_id,
              extra: { confidence: debateOutcome.confidence, verdict: debateOutcome.verdict, key_turn_ids: debateOutcome.key_turn_ids },
            });
          }
        }
      } else if (step.kind === "tool.call") {
        const tool = getTool(step.tool);
        if (!tool) {
          const duration = Date.now() - stepStart;
          const error: ExecutionError = { message: `Tool "${step.tool}" not found`, type: "tool_unavailable" };
          metrics.recordTool(step.tool, duration, false);
          results.push({
            id: step.id,
            kind: step.kind,
            ok: false,
            output: null,
            error,
            citations: [],
            latency_ms: duration,
            essence_ids: [],
          });
          citationsByStep.set(step.id, []);
          break;
        }
        const toolNameLower = step.tool.toLowerCase();
        const requiresWarpGrounding = needsWarpImplementationGrounding(runtime);
        const missingGrounding = requiresWarpGrounding && !hasWarpGrounding(runtime, outputs);
        if (missingGrounding && toolNameLower.startsWith("telemetry.")) {
          const duration = Date.now() - stepStart;
          output = { skipped: true, reason: "missing_grounding" };
          citations = [];
          metrics.recordTool(step.tool, duration, true);
          results.push({
            id: step.id,
            kind: step.kind,
            ok: true,
            output,
            citations,
            latency_ms: duration,
            essence_ids: [],
          });
          outputs.set(step.id, output);
          citationsByStep.set(step.id, citations);
          continue;
        }
        const agentHint = normalizeAgentId(
          (step.extra as { agent?: unknown; owner?: unknown; agent_id?: unknown } | undefined)?.agent ??
            (step.extra as { owner?: unknown } | undefined)?.owner ??
            (step.extra as { agent_id?: unknown } | undefined)?.agent_id,
        );
        const agentContext = resolveAgentContext(
          agentHint,
          step.tool,
          runtime.personaId ?? "default",
        );
        if (!agentContext.allowed) {
          const duration = Date.now() - stepStart;
          const error: ExecutionError = {
            message: `Agent "${agentHint ?? "unknown"}" cannot run ${step.tool}`,
            type: agentContext.reason ?? "agent_tool_forbidden",
          };
          metrics.recordTool(step.tool, duration, false);
          results.push({
            id: step.id,
            kind: step.kind,
            ok: false,
            output: null,
            error,
            citations: [],
            latency_ms: duration,
            essence_ids: [],
          });
          citationsByStep.set(step.id, []);
          break;
        }
        const toolContext = {
          sessionId,
          goal: runtime.goal,
          personaId: agentContext.personaId,
          agentId: agentContext.agentId,
        };
        await ensureToolApprovals(tool, runtime);
        const summary = step.summaryRef ? outputs.get(step.summaryRef) : undefined;
        let summaryText = formatSummaryForPrompt(summary);
        const appendSummaryIds =
          Array.isArray((step.extra as { appendSummaries?: string[] } | undefined)?.appendSummaries) &&
          (step.extra as { appendSummaries?: string[] }).appendSummaries
            ? (step.extra as { appendSummaries?: string[] }).appendSummaries!.filter(
                (ref): ref is string => typeof ref === "string" && ref.trim().length > 0,
              )
            : [];
        const supplements = collectSupplementsFromOutputs(outputs.values());
        const warpSupplement = collectWarpSupplement(outputs, supplements);
        const warpGrounding = warpSupplement?.grounding;
        const viabilityIntent =
          (runtime.intent?.wantsWarp ?? false) ||
          (runtime.intent?.wantsPhysics ?? false) ||
          isViabilityIntentGoal(runtime.goal);
        const warpAgentsConfig = viabilityIntent
          ? await loadWarpAgentsConfig().catch((error) => {
              console.warn("[chat-b] failed to load WARP_AGENTS.md", error);
              return null;
            })
          : null;
        const warpSystemPrompt = viabilityIntent
          ? buildWarpNarrationSystemPrompt(warpAgentsConfig?.viabilityPolicy)
          : null;
        const warpCertificateMessage = viabilityIntent
          ? buildWarpCertificateMessage(runtime.goal, warpGrounding, warpAgentsConfig?.viabilityPolicy)
          : null;
        const supplementSummaries = supplements
          .map((supplement) => limitText((supplement.summary || supplement.detail || "").trim()))
          .filter((entry) => entry.length > 0);
        const supplementBlocks = supplements.map((supplement) => formatSupplementForPrompt(supplement));
        const extraSummariesRaw = appendSummaryIds.map((ref) => formatSummaryForPrompt(outputs.get(ref)));
        if (warpSupplement) {
          extraSummariesRaw.push(warpSupplement.text);
        }
        const extraSummaries = Array.from(
          new Set(
            [...extraSummariesRaw, ...supplementSummaries].filter(
              (entry) => typeof entry === "string" && entry.trim().length > 0,
            ),
          ),
        );
        const ungroundedBaseSummary = isUngroundedSummary(summaryText);
        if (ungroundedBaseSummary && warpSupplement?.text) {
          summaryText = warpSupplement.text;
        }
        const summaryStillUngrounded = isUngroundedSummary(summaryText);
        const summaryGrounded = !summaryStillUngrounded || extraSummaries.length > 0;
        if (!summaryText && summaryGrounded && extraSummaries.length > 0) {
          summaryText = extraSummaries[0];
        }
        const summaryForPrompt = summaryGrounded ? summaryText : "";
        const wantsStatus = runtime.intent?.wantsStatus ?? false;
        const telemetrySummary = wantsStatus ? runtime.telemetrySummary ?? runtime.taskTrace?.telemetry_summary ?? null : null;
        const resonanceBundle = runtime.resonanceBundle ?? runtime.taskTrace?.resonance_bundle ?? null;
        const resonanceSelection =
          runtime.resonanceSelection ?? runtime.taskTrace?.resonance_selection ?? null;
        const patchForPrompt = pickPatchForSection({
          bundle: resonanceBundle,
          selection: resonanceSelection,
          preferredPatchId: resonanceSelection?.primaryPatchId,
          intent: runtime.intent ?? classifyIntent(runtime.goal),
        });
        let promptTemplate = step.promptTemplate;
        const narrationKind = (step.extra as { narrationKind?: string | null } | undefined)?.narrationKind;
        const verdictFrom = (step.extra as { verdictFrom?: string | null } | undefined)?.verdictFrom;
        const ungroundedSummary = !summaryGrounded;
        const debateSkipped =
          runtime.debateOutcome?.stop_reason === "no_evidence" ||
          runtime.debateOutcome?.verdict === "skipped_no_evidence";
        const effectiveNarrationKind =
          narrationKind === "debate" && !ungroundedSummary && !debateSkipped ? "debate" : "direct";
        if (ungroundedSummary) {
          promptTemplate = [
            "You are Chat B. Provide a concise, self-contained answer to the goal using general/domain knowledge.",
            "Do not repeat that no data was found. Avoid telemetry chatter; respond directly to the question.",
            "Keep it short and factual, with a brief definition plus 3-5 key points the operator needs to know.",
            "Goal: {{goal}}",
          ].join("\n");
        } else if (viabilityIntent && warpGrounding) {
          promptTemplate = buildWarpNarrationPrompt(runtime.goal);
        } else if (effectiveNarrationKind === "debate") {
          promptTemplate = buildDebateNarrationPrompt({
            goal: runtime.goal,
            resonancePatch: patchForPrompt ?? undefined,
            telemetrySummary,
            verdictFromStepId: verdictFrom ?? undefined,
            keyTurns: runtime.debateOutcome?.key_turn_ids ?? [],
          });
        } else {
          promptTemplate = buildDirectNarrationPrompt({
            goal: runtime.goal,
            resonancePatch: patchForPrompt ?? undefined,
            telemetrySummary,
          });
        }
        const appendixHeading = formatKnowledgeHeading("Attached knowledge", runtime.knowledgeHints);
        const appendixCaps = resolveAppendixCaps(3, 1200);
        const appendix = composeKnowledgeAppendix({
          goal: runtime.goal,
          summary: summaryForPrompt,
          knowledgeContext: runtime.knowledgeContext,
          maxChars: appendixCaps.maxChars,
          maxSnippets: appendixCaps.maxSnippets,
          heading: appendixHeading,
        });
        const debateNote = formatDebateNote(runtime.debateOutcome, runtime.debateId);
        const resonanceSection = composeResonancePatchSection({
          bundle: resonanceBundle,
          selection: resonanceSelection,
          preferredPatchId: resonanceSelection?.primaryPatchId,
          intent: runtime.intent ?? classifyIntent(runtime.goal),
        });
        const warpEvidenceBlock = formatWarpGroundingBlock(warpGrounding);
        const warpGuardrail = buildWarpGuardrailBlock(
          viabilityIntent,
          warpGrounding,
          warpAgentsConfig?.viabilityPolicy,
        );
        const extraSummaryBlock =
          extraSummaries.length > 0 ? ["[Additional grounded context]", ...extraSummaries].join("\n") : "";
        const supplementSection =
          supplementBlocks.length > 0
            ? supplementBlocks.map((text, index) => `[[SUPP ${index + 1}]]\n${text}`).join("\n\n")
            : "";
        const hasGrounding =
          !ungroundedSummary &&
          ((resonanceSection && resonanceSection.trim().length > 0) ||
            (appendix.text && appendix.text.trim().length > 0) ||
            extraSummaries.length > 0 ||
            supplementSection.length > 0 ||
            (telemetrySummary && telemetrySummary.trim().length > 0) ||
            (debateNote && debateNote.trim().length > 0) ||
            Boolean(warpEvidenceBlock) ||
            Boolean(warpCertificateMessage));

        if (!hasGrounding) {
          // Avoid hallucinating when no grounded repo/docs/telemetry exist.
          promptTemplate = [
            "You have no grounded repo/docs/telemetry for this question.",
            "Say clearly that no grounded evidence is available from the codebase or knowledge store.",
            "If you must answer, keep it to a one-line limitation notice; do not improvise theory.",
            "Goal: {{goal}}",
          ].join("\n");
        }

        const promptBase = renderTemplate(promptTemplate, {
          goal: runtime.goal,
          persona: runtime.personaId ?? "default",
          summary: summaryForPrompt,
          debate: debateNote ?? "",
        });
        const sections: string[] = [];
        if (!ungroundedSummary && resonanceSection) {
          sections.push(resonanceSection);
        }
        if (!ungroundedSummary && appendix.text) {
          sections.push(appendix.text);
        }
        if (extraSummaryBlock) {
          sections.push(extraSummaryBlock);
        }
        if (warpEvidenceBlock) {
          sections.push(warpEvidenceBlock);
        }
        if (supplementSection) {
          sections.push(supplementSection);
        }
        sections.push(promptBase);
        if (!ungroundedSummary && telemetrySummary) {
          sections.push(`[Panel snapshot]\n${telemetrySummary}`);
        }
        if (!ungroundedSummary && debateNote && step.extra?.useDebate) {
          sections.push(debateNote);
        }
        if (warpGuardrail) {
          sections.push(warpGuardrail);
        }
        const prompt = sections.filter(Boolean).join("\n\n");
        const promptWithCertificate = warpCertificateMessage
          ? [prompt, warpCertificateMessage].filter(Boolean).join("\n\n")
          : prompt;
        const messages =
          viabilityIntent && toolNameLower.startsWith("llm.")
            ? [
                { role: "system", content: warpSystemPrompt ?? buildWarpNarrationSystemPrompt(null) },
                { role: "user", content: promptWithCertificate },
              ]
            : undefined;
        const promptHash = hashText(
          messages
            ? [warpSystemPrompt, promptWithCertificate].filter((part): part is string => Boolean(part && part.trim())).join("\n\n")
            : promptWithCertificate,
        );
        const isNarrationCall = narrationKind === "debate" || narrationKind === "direct";
        const sealedContext = isNarrationCall
          ? {
              telemetry_summary: telemetrySummary,
              resonance_patch: patchForPrompt ?? null,
              debate_outcome: runtime.debateOutcome
                ? {
                    debate_id: runtime.debateOutcome.debate_id ?? runtime.debateId ?? null,
                    verdict: runtime.debateOutcome.verdict,
                    confidence: runtime.debateOutcome.confidence,
                    key_turn_ids: runtime.debateOutcome.key_turn_ids ?? [],
                  }
                : null,
            }
          : null;
        const input: Record<string, unknown> = { ...(step.extra ?? {}), prompt: promptWithCertificate };
        if (messages) {
          input.messages = messages;
        }
        if (sealedContext?.telemetry_summary !== null && sealedContext?.telemetry_summary !== undefined) {
          input.telemetry_summary = sealedContext.telemetry_summary;
        }
        if (sealedContext?.resonance_patch) {
          input.resonance_patch = sealedContext.resonance_patch;
        }
        if (sealedContext?.debate_outcome) {
          input.debate_outcome = sealedContext.debate_outcome;
        }
        if (sealedContext) {
          input.sealed_context = sealedContext;
        }
        if (runtime.knowledgeContext && runtime.knowledgeContext.length > 0) {
          input.knowledgeContext = runtime.knowledgeContext;
        }
        if (runtime.taskTrace) {
          runtime.taskTrace.prompt_hash = promptHash;
        }
        const missingGroundingNow = requiresWarpGrounding && !hasWarpGrounding(runtime, outputs);
        if (missingGroundingNow && toolNameLower.startsWith("llm.")) {
          const duration = Date.now() - stepStart;
          const message =
            "Insufficient grounded repo/doc context for this warp/implementation question. Please attach modules/warp code or theory docs (e.g., docs/alcubierre-alignment.md) before retrying.";
          output = { message, reason: "missing_grounding" };
          citations = [];
          metrics.recordTool(step.tool, duration, false);
          results.push({
            id: step.id,
            kind: step.kind,
            ok: false,
            output,
            error: { message, type: "missing_grounding" },
            citations,
            latency_ms: duration,
            essence_ids: [],
          });
          outputs.set(step.id, output);
          citationsByStep.set(step.id, citations);
          continue;
        }
        const toolStart = Date.now();
        const paramsHash = hashPayload(input);
        let toolError: unknown;
        let essenceId: string | undefined;
        let attempt = 0;
        try {
          while (attempt < TOOL_RETRY_MAX) {
            attempt += 1;
            try {
              output = await tool.handler(input, toolContext);
              essenceId = extractEssenceId(output);
              if (step.tool === "debate.run" && output && typeof output === "object") {
                const verdict = output as {
                  debateId?: string;
                  debate_id?: string;
                  verdict?: string;
                  confidence?: number;
                  key_turn_ids?: string[];
                  winning_role?: TDebateOutcome["winning_role"];
                  stop_reason?: string;
                  score?: number;
                  rounds?: number;
                  metrics?: TDebateRoundMetrics;
                };
                const debateOutcome: TDebateOutcome = {
                  debate_id: verdict.debate_id ?? verdict.debateId ?? runtime.debateId ?? step.id,
                  verdict: verdict.verdict ?? "unknown",
                  confidence: typeof verdict.confidence === "number" ? verdict.confidence : 0,
                  winning_role: verdict.winning_role,
                  key_turn_ids: verdict.key_turn_ids ?? [],
                  stop_reason: verdict.stop_reason,
                  score: typeof verdict.score === "number" ? verdict.score : 0,
                  rounds: typeof verdict.rounds === "number" ? Math.max(0, Math.floor(verdict.rounds)) : 0,
                  metrics: verdict.metrics,
                  created_at: new Date().toISOString(),
                };
                runtime.debateId = debateOutcome.debate_id;
                runtime.debateOutcome = debateOutcome;
                if (runtime.taskTrace) {
                  runtime.taskTrace.debate_id = debateOutcome.debate_id;
                }
              }
              toolError = undefined;
              break;
            } catch (err) {
              toolError = err;
              const shouldRetry = attempt < TOOL_RETRY_MAX && isRetryableToolError(err);
              if (!shouldRetry) {
                throw err;
              }
              const delayMs = computeRetryDelayMs(attempt);
              if (delayMs > 0) {
                await sleepMs(delayMs);
              }
            }
          }
        } catch (err) {
          toolError = err;
          throw err;
        } finally {
          const toolDuration = Date.now() - toolStart;
          const ok = !toolError;
          metrics.recordTool(step.tool, toolDuration, ok);
          appendToolLog({
            tool: step.tool,
            version: (tool as any).version ?? "unknown",
            paramsHash,
            seed: (input as { seed?: unknown }).seed,
            sessionId,
            traceId: runtime.taskTrace?.id ?? sessionId,
            durationMs: toolDuration,
            promptHash,
            ok,
            error: toolError ? formatToolError(toolError) : undefined,
            policy: resolveToolPolicyFlags(toolError),
            essenceId,
            stepId: step.id,
            strategy: runtime.strategy ?? runtime.taskTrace?.reasoning_strategy ?? undefined,
            text: friendlyToolLabel(step.tool, step.kind),
          });
        }
        const debateCitations =
          step.tool === "debate.run" && runtime.debateOutcome?.key_turn_ids?.length
            ? runtime.debateOutcome.key_turn_ids
            : [];
        const baseSummaryCitations = step.summaryRef ? citationsByStep.get(step.summaryRef) ?? [] : [];
        const appendSummaryCitations = appendSummaryIds.flatMap((ref) => citationsByStep.get(ref) ?? []);
        const warpCitations = warpSupplement?.citations ?? [];
        const outputCitations = collectCitationsFromOutput(output);
        citations = Array.from(
          new Set([
            ...baseSummaryCitations,
            ...appendSummaryCitations,
            ...warpCitations,
            ...outputCitations,
          ].filter((c): c is string => typeof c === "string" && c.trim().length > 0)),
        );
        if (step.tool === "repo.graph.search" && output && Array.isArray((output as any).hits)) {
          const hits = (output as any).hits as Array<any>;
          const repoCites = hits
            .map((hit: { id?: string }) => (typeof hit?.id === "string" ? hit.id : null))
            .filter((id: string | null): id is string => !!id);
          if (repoCites.length > 0) {
            const citeSet = new Set([...citations, ...repoCites]);
            citations = Array.from(citeSet);
          }
          if (debugSourcesEnabled) {
            const repoSources: GroundingSource[] = [];
            for (const hit of hits) {
              const filePath = (hit as any).path ?? (hit as any).file_path ?? (hit as any).id;
              const sourceKind: GroundingSource["kind"] = isDocLikePath(filePath) ? "doc" : "repo_file";
              repoSources.push({
                kind: sourceKind,
                path: filePath,
                id: (hit as any).symbol_name ?? (hit as any).name,
                extra: { score: (hit as any).score, kind: (hit as any).kind },
              });
            }
            const packets = Array.isArray((output as any).packets) ? ((output as any).packets as any[]) : [];
            for (const packet of packets) {
              const packetPath = (packet as any).file_path ?? (packet as any).path;
              const packetKind: GroundingSource["kind"] = isDocLikePath(packetPath) ? "doc" : "repo_file";
              repoSources.push({
                kind: packetKind,
                path: packetPath,
                id: (packet as any).symbol_name,
                extra: { score: (packet as any).score },
              });
            }
            if (repoSources.length > 0) {
              pushGroundingSources(runtime, repoSources);
            }
          }
        }
        if (debugSourcesEnabled) {
          if (step.tool.startsWith("telemetry.")) {
            const panels =
              Array.isArray((output as any)?.entries) && (output as any).entries.length > 0
                ? (output as any).entries
                : Array.isArray((output as any)?.panels)
                  ? (output as any).panels
                  : [];
            const panelIds =
              Array.isArray(panels) && panels.length > 0
                ? panels
                    .map((panel: any) => (panel?.panelId ?? panel?.id ?? panel?.instanceId) as string | undefined)
                    .filter((id?: string) => typeof id === "string" && id.trim().length > 0)
                : [];
            pushGroundingSource(runtime, {
              kind: "telemetry",
              id: step.tool,
              extra: panelIds.length > 0 ? { panelIds } : undefined,
            });
          }
          if (step.tool.toLowerCase().includes("pipeline")) {
            pushGroundingSource(runtime, { kind: "pipeline", id: step.tool });
          }
          if (step.tool.includes("checklist")) {
            const checklistId =
              (output as { checklist?: { id?: string } } | undefined)?.checklist?.id ??
              (output as { id?: string } | undefined)?.id;
            if (checklistId) {
              pushGroundingSource(runtime, { kind: "checklist", id: checklistId });
            }
          }
          pushGroundingSource(runtime, { kind: "tool", id: step.tool });
        }
        if (debateCitations.length > 0) {
          const citeSet = new Set([...citations, ...debateCitations]);
          citations = Array.from(citeSet);
        }
        if (appendix.citations.length > 0) {
          const citeSet = new Set(citations);
          for (const cite of appendix.citations) {
            citeSet.add(cite);
          }
          citations = Array.from(citeSet);
        }
        if (essenceId) {
          stepEssenceIds = [essenceId];
        }
      } else if (step.kind === "specialist.run") {
        const summary = step.summaryRef ? outputs.get(step.summaryRef) : undefined;
        const summaryCitations = step.summaryRef ? citationsByStep.get(step.summaryRef) ?? [] : [];
        const problem = buildSpecialistProblem(runtime, step.id, step.summaryRef, summary, summaryCitations);
        const agentHint = normalizeAgentId(
          (step.params as { agent?: unknown; owner?: unknown; agent_id?: unknown } | undefined)?.agent ??
            (step.params as { owner?: unknown } | undefined)?.owner ??
            (step.params as { agent_id?: unknown } | undefined)?.agent_id,
        );
        const agentContext = resolveAgentContext(
          agentHint,
          undefined,
          runtime.personaId ?? "default",
        );
        if (!agentContext.allowed) {
          throw new Error(`Agent "${agentHint ?? "unknown"}" cannot run solver ${step.solver}`);
        }
        const personaId = agentContext.personaId;
        const traceId = runtime.taskTrace?.id ?? runtime.sessionId ?? runtime.goal;
        const plan = {
          solver: step.solver,
          verifier: step.verifier,
          params: step.params,
          repair: step.repair,
        };
        const result = await runSpecialistPlan(plan, problem, { personaId, traceId, stepId: step.id });
        output = result;
        citations = result.solver_output.essence_ids ?? [];
        stepEssenceIds = citations.length > 0 ? [...citations] : [];
      } else if (step.kind === "specialist.verify") {
        const prior = outputs.get(step.source);
        if (!prior || typeof prior !== "object") {
          throw new Error(`specialist verify requires output from ${step.source}`);
        }
        const specialist = prior as SpecialistRunResult;
        const personaId = runtime.personaId ?? "default";
        const traceId = runtime.taskTrace?.id ?? runtime.sessionId ?? runtime.goal;
        const check = await runVerifierOnly(step.verifier, specialist.problem, specialist.solver_output, {
          personaId,
          traceId,
          stepId: step.id,
        });
        output = check;
        citations = specialist.solver_output.essence_ids ?? [];
        stepEssenceIds = citations.length > 0 ? [...citations] : [];
      } else {
        const kind = (step as { kind: string }).kind;
        throw new Error(`Unknown executor step kind: ${kind}`);
      }
      outputs.set(step.id, output);
      citationsByStep.set(step.id, citations);
      const stepOk = evaluateStepSuccess(step, output);
      const latencyMs = Date.now() - stepStart;
      const entry: ExecutionResult = stepOk
        ? { id: step.id, kind: step.kind, ok: true, output, citations, latency_ms: latencyMs, essence_ids: stepEssenceIds }
        : { id: step.id, kind: step.kind, ok: false, output, citations, latency_ms: latencyMs, essence_ids: stepEssenceIds };
      results.push(entry);
      await recordKvUsage({
        sessionId,
        runtime,
        step,
        output,
        citations,
        budgetBytes,
      });
      if (!stepOk) {
        break;
      }
    } catch (error) {
      const executionError = normalizeExecutionError(error);
      results.push({
        id: step.id,
        kind: step.kind,
        ok: false,
        error: executionError,
        citations: [],
        latency_ms: Date.now() - stepStart,
        essence_ids: stepEssenceIds,
      });
      break;
    }
  }

  // Minimal knowledge-citation verifier and one-shot repair
  try {
    const attachments = runtime.knowledgeContext ?? [];
    if (process.env.ENABLE_KNOWLEDGE_CITATION_VERIFY === "1" && attachments.length > 0 && results.length > 0) {
      const final = results[results.length - 1];
      const readable = final.ok ? pickReadableText(final.output) : undefined;
      if (readable) {
        const { extractCitations, verifyCitations } = await import("../knowledge/citations");
        const verdict = verifyCitations(attachments as any[], extractCitations(readable));
        citationVerification.pass = verdict.pass;
        citationVerification.missing = verdict.missing;
        if (!verdict.pass) {
          const lastCall = [...steps].reverse().find((s) => s.kind === "tool.call");
          if (lastCall && lastCall.kind === "tool.call") {
            const tool = getTool(lastCall.tool);
            if (tool) {
              const hint =
                `Please revise the answer and include explicit citations to the attached knowledge files in the form [project:<slug>/file:<name>]. Missing examples: ${verdict.missing.join(", ")}`;
              const summaryVal = lastCall.summaryRef ? outputs.get(lastCall.summaryRef) : undefined;
              const summaryText = formatSummaryForPrompt(summaryVal);
              const knowledgeHeading = formatKnowledgeHeading("Attached knowledge", runtime.knowledgeHints);
              const appendixCaps = resolveAppendixCaps(3, 1200);
              const appendix = composeKnowledgeAppendix({
                goal: runtime.goal,
                summary: summaryText,
                knowledgeContext: attachments,
                maxChars: appendixCaps.maxChars,
                maxSnippets: appendixCaps.maxSnippets,
                heading: knowledgeHeading,
              });
              const debateNote = formatDebateNote(runtime.debateOutcome, runtime.debateId);
              const promptBase = renderTemplate(`${lastCall.promptTemplate}\n\n${hint}`, {
                goal: runtime.goal,
                persona: runtime.personaId ?? "default",
                summary: summaryText,
                debate: debateNote ?? "",
              });
              const resonanceSection = composeResonancePatchSection({
                bundle: runtime.resonanceBundle,
                selection: runtime.resonanceSelection,
                preferredPatchId: runtime.resonanceSelection?.primaryPatchId,
              });
              const sections: string[] = [];
              if (resonanceSection) {
                sections.push(resonanceSection);
              }
              if (appendix.text) {
                sections.push(appendix.text);
              }
              sections.push(promptBase);
              if (runtime.telemetrySummary) {
                sections.push(`[Panel snapshot]\n${runtime.telemetrySummary}`);
              }
              if (debateNote && (lastCall.extra as { useDebate?: boolean } | undefined)?.useDebate) {
                sections.push(debateNote);
              }
              const prompt = sections.filter(Boolean).join("\n\n");
              const promptHash = hashText(prompt);
              const input: Record<string, unknown> = { ...(lastCall.extra ?? {}), prompt };
              if (attachments.length > 0) {
                input.knowledgeContext = attachments;
              }
              if (runtime.taskTrace) {
                runtime.taskTrace.prompt_hash = promptHash;
              }
              const agentHint = normalizeAgentId(
                (lastCall.extra as { agent?: unknown; owner?: unknown; agent_id?: unknown } | undefined)?.agent ??
                  (lastCall.extra as { owner?: unknown } | undefined)?.owner ??
                  (lastCall.extra as { agent_id?: unknown } | undefined)?.agent_id,
              );
              const agentContext = resolveAgentContext(
                agentHint,
                lastCall.tool,
                runtime.personaId ?? "default",
              );
              if (!agentContext.allowed) {
                throw new Error(`Agent "${agentHint ?? "unknown"}" cannot run ${lastCall.tool}`);
              }
              const toolContext = {
                sessionId,
                goal: runtime.goal,
                personaId: agentContext.personaId,
                agentId: agentContext.agentId,
              };
              const toolStart = Date.now();
              let toolError: unknown;
              let essenceId: string | undefined;
              let output: unknown;
              try {
                output = await tool.handler(input, toolContext);
                essenceId = extractEssenceId(output);
              } catch (err) {
                toolError = err;
              } finally {
                const toolDuration = Date.now() - toolStart;
                const ok = !toolError;
                metrics.recordTool(lastCall.tool, toolDuration, ok);
                appendToolLog({
                  tool: lastCall.tool,
                  version: (tool as any).version ?? "unknown",
                  paramsHash: hashPayload(input),
                  promptHash,
                  seed: (input as { seed?: unknown }).seed,
                  sessionId,
                  traceId: runtime.taskTrace?.id ?? sessionId,
                  durationMs: toolDuration,
                  ok,
                  error: toolError ? formatToolError(toolError) : undefined,
                  policy: resolveToolPolicyFlags(toolError),
                  essenceId,
                  stepId: `${lastCall.id}.citation`,
                });
              }
              const stepOk = toolError ? false : evaluateStepSuccess(lastCall, output);
              const inherited = lastCall.summaryRef ? citationsByStep.get(lastCall.summaryRef) ?? [] : [];
              const mergedCitations =
                appendix.citations.length > 0 ? Array.from(new Set([...inherited, ...appendix.citations])) : inherited;
              const entry: ExecutionResult = stepOk
                ? {
                    id: `${lastCall.id}.citation`,
                    kind: lastCall.kind,
                    ok: true,
                    output,
                    citations: mergedCitations,
                    latency_ms: 0,
                    essence_ids: [],
                  }
                : {
                    id: `${lastCall.id}.citation`,
                    kind: lastCall.kind,
                    ok: false,
                    output,
                    error: toolError ? normalizeExecutionError(toolError) : undefined,
                    citations: [],
                    latency_ms: 0,
                    essence_ids: [],
                  };
              results.push(entry);
              citationVerification.repaired = stepOk;
              if (stepOk) {
                const repairedReadable = pickReadableText(output);
                if (repairedReadable) {
                  const repairedVerdict = verifyCitations(attachments as any[], extractCitations(repairedReadable));
                  citationVerification.pass = repairedVerdict.pass;
                  citationVerification.missing = repairedVerdict.missing;
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // citation repair is best-effort; ignore failures
  }

  const scientificMode = isScientificMethodMode(runtime);
  if (scientificMode && citationVerification.enabled && citationVerification.pass === false) {
    const gateError = citationVerification.missing?.length
      ? `Scientific citation gate failed: missing ${citationVerification.missing.join(", ")}`
      : "Scientific citation gate failed: verification did not pass";
    results.push({
      id: "scientific.citation_gate",
      kind: "tool.call",
      ok: false,
      error: { message: gateError, type: "scientific_citation_gate" },
      citations: [],
      latency_ms: 0,
      essence_ids: [],
    });
  }

  recordTaskTraceResults(runtime.taskTrace, runtime, results, citationVerification);
  const successFromSteps = results.length > 0 && results.every((step) => step.ok);
  const success = runtime.taskTrace?.ok ?? successFromSteps;
  recordTaskOutcome(success);
  if (process.env.ENABLE_REFLECTION === "1" && runtime.taskTrace) {
    const personaId = runtime.personaId ?? runtime.taskTrace.persona_id ?? "default";
    const summary = runtime.taskTrace.result_summary ?? summarizeExecutionResults(results);
    try {
      const { writeTaskReflection } = await import("../learning/reflect");
      await writeTaskReflection(runtime.taskTrace, summary, personaId);
    } catch (err) {
      console.warn("[planner] reflection failed", err);
    }
  }
  return results;
}

const collectCitationsFromOutput = (output: unknown): string[] => {
  if (!output || typeof output !== "object") {
    return [];
  }
  const citations: string[] = [];
  const direct = (output as { citations?: unknown }).citations;
  if (Array.isArray(direct)) {
    citations.push(...direct.filter((c): c is string => typeof c === "string" && c.trim().length > 0));
  }
  const pipeline = (output as { pipelineCitations?: unknown }).pipelineCitations;
  if (pipeline && typeof pipeline === "object") {
    for (const value of Object.values(pipeline as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        citations.push(...value.filter((c): c is string => typeof c === "string" && c.trim().length > 0));
      }
    }
  }
  const nested = (output as { output?: unknown }).output;
  if (nested && typeof nested === "object") {
    citations.push(...collectCitationsFromOutput(nested));
  }
  return Array.from(new Set(citations));
};

const extractEssenceId = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractEssenceId(entry);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }
  if (typeof value === "object") {
    const candidate = ((value as { essence_id?: string; essenceId?: string }).essence_id ??
      (value as { essenceId?: string }).essenceId)?.trim();
    if (candidate) {
      return candidate;
    }
    const output = (value as { output?: unknown }).output;
    if (output) {
      const nested = extractEssenceId(output);
      if (nested) {
        return nested;
      }
    }
    const artifacts = (value as { artifacts?: unknown }).artifacts;
    if (artifacts) {
      return extractEssenceId(artifacts);
    }
  }
  return undefined;
};

function normalizeExecutionError(error: unknown): ExecutionError {
  if (!error) {
    return { message: "Unknown planner execution error." };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error instanceof Error) {
    const typed = error as PlannerPolicyError;
    return {
      message: typed.message || "Planner execution error",
      type: typed.type,
      policy: typed.policy,
    };
  }
  if (typeof error === "object") {
    const maybe = error as { message?: string; type?: string; policy?: ExecutionErrorPolicy };
    return {
      message:
        typeof maybe.message === "string" && maybe.message.length > 0
          ? maybe.message
          : "Planner execution error",
      type: typeof maybe.type === "string" ? maybe.type : undefined,
      policy: maybe.policy && typeof maybe.policy === "object" ? maybe.policy : undefined,
    };
  }
  return { message: String(error) };
}

function describeExecutionError(error?: ExecutionError | string): string {
  if (!error) {
    return "Unknown planner execution error.";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.policy?.reason) {
    return `${error.message} (${error.policy.reason})`;
  }
  return error.message;
}

const RISK_REASONS: Record<ToolRiskType, string> = {
  writes_files: "Tool can write or persist files/envelopes on disk.",
  network_access: "Tool can initiate outbound network requests.",
};

async function ensureToolApprovals(tool: Tool, runtime: ExecutionRuntime): Promise<void> {
  const risks = tool.safety?.risks ?? [];
  if (risks.length === 0) {
    return;
  }
  const personaId = runtime.personaId ?? "default";
  const sessionId = runtime.sessionId ?? personaId;
  for (const capability of risks) {
    const alreadyApproved =
      runtime.taskTrace?.approvals?.some((entry) => entry.tool === tool.name && entry.capability === capability) ?? false;
    if (alreadyApproved) {
      continue;
    }
    const reason = buildApprovalReason(capability, tool);
    const request: ApprovalRequest = {
      tool,
      capability,
      reason,
      sessionId,
      personaId,
      goal: runtime.goal,
    };
    const decision = (await runtime.requestApproval?.(request)) ?? { granted: true, grantedBy: "system" };
    if (!decision.granted) {
      const denial = (decision.reason ?? decision.message)?.trim() || reason;
      const error = new Error(decision.message ?? `Approval denied for ${tool.name} (${capability}).`) as PlannerPolicyError;
      error.name = "ApprovalDeniedError";
      error.type = "approval_denied";
      error.policy = {
        reason: denial,
        tool: tool.name,
        capability,
        risks: risks,
      };
      throw error;
    }
    if (runtime.taskTrace) {
      const approvalEntry: TTaskApproval = {
        id: `approval-${randomUUID()}`,
        tool: tool.name,
        capability,
        granted_at: new Date().toISOString(),
        granted_by: decision.grantedBy ?? "system",
        reason,
        notes: decision.notes ?? tool.safety?.approvalNotes,
      };
      runtime.taskTrace.approvals.push(approvalEntry);
    }
  }
}

function buildApprovalReason(capability: ToolRiskType, tool: Tool): string {
  const base = RISK_REASONS[capability] ?? "Tool requires approval.";
  const notes = tool.safety?.approvalNotes?.trim();
  if (notes) {
    return `${base} ${notes}`;
  }
  return base;
}

function recordTaskTraceResults(
  taskTrace: TTaskTrace | undefined,
  runtime: ExecutionRuntime,
  results: ExecutionResult[],
  citationVerification: CitationVerificationState,
): void {
  if (!taskTrace) {
    return;
  }
  taskTrace.steps = results;
  const stepsOk = results.length > 0 && results.every((step) => step.ok);
  const scientificMode = isScientificMethodMode(runtime);
  const citationFailed = citationVerification.enabled && citationVerification.pass === false;
  const ok = scientificMode ? stepsOk && !citationFailed : stepsOk;
  taskTrace.ok = ok;
  taskTrace.result_summary = summarizeExecutionResults(results);
  taskTrace.scientific_method = buildScientificMethodRecord(taskTrace, results, citationVerification);
}

function buildScientificMethodRecord(
  taskTrace: TTaskTrace,
  results: ExecutionResult[],
  citationVerification: CitationVerificationState,
) {
  const failure = results.find((step) => !step.ok);
  const allCitations = new Set(results.flatMap((step) => step.citations ?? []));
  const successRatio = results.length > 0 ? (results.filter((step) => step.ok).length / results.length) : 0;
  const citationScore = citationVerification.enabled
    ? citationVerification.pass === false
      ? 0.35
      : citationVerification.pass === true
        ? 1
        : 0.6
    : 0.7;
  const confidence = Math.min(0.98, Math.max(0.05, 0.55 * successRatio + 0.45 * citationScore));
  const intervalRadius = Math.max(0.05, 0.5 * (1 - confidence));
  const uncertainFloor = Math.max(0, confidence - intervalRadius);
  const uncertainCeil = Math.min(1, confidence + intervalRadius);
  const hypothesis = `Primary hypothesis: execution trace can satisfy goal with grounded evidence (${taskTrace.goal}).`;
  const antiHypothesis = `Anti-hypothesis: execution trace is insufficient or refuted for goal (${taskTrace.goal}).`;
  const citationCounterfactualFail = citationVerification.enabled && (allCitations.size === 0 || citationVerification.pass === false);
  const correctiveActions: string[] = [];
  if (failure) {
    correctiveActions.push(`Investigate failed step ${failure.id} (${failure.kind}).`);
    correctiveActions.push(`Re-run from step ${failure.id} with bounded repair and refreshed evidence retrieval.`);
  }
  if (citationCounterfactualFail) {
    correctiveActions.push("Enforce citation repair and deny final scientific answer until citations verify.");
  }
  if (correctiveActions.length === 0) {
    correctiveActions.push("No corrective action required; monitor drift across replay/eval runs.");
  }

  return {
    hypothesis,
    anti_hypothesis: antiHypothesis,
    counterfactual_test: {
      tested: true,
      method: citationVerification.enabled
        ? "Controlled citation-withholding counterfactual (simulate evidence denial when citations are missing/invalid)."
        : "Outcome inversion check against final step success/failure.",
      result: failure || citationCounterfactualFail ? "supports_anti_hypothesis" : "supports_hypothesis",
      failed_step_id: failure?.id,
    },
    uncertainty_interval: {
      low: uncertainFloor,
      high: uncertainCeil,
      confidence,
    },
    reproducibility: {
      run_id: taskTrace.id,
      prompt_hash: taskTrace.prompt_hash ?? undefined,
      plan_hash: hashPayload(taskTrace.plan_json),
      timestamp: new Date().toISOString(),
      step_count: results.length,
      citation_count: allCitations.size,
    },
    corrective_action: {
      required: failure !== undefined || citationCounterfactualFail,
      reason:
        failure !== undefined
          ? `Failed evidence at step ${failure.id}`
          : citationCounterfactualFail
            ? "Citation verification did not pass the scientific gate"
            : undefined,
      actions: correctiveActions,
    },
  } as TTaskTrace["scientific_method"];
}

export function summarizeExecutionResults(results: ExecutionResult[]): string {
  if (results.length === 0) {
    return "No steps executed.";
  }
  // Build an output map for quick supplements (warp ask, etc.)
  const outputs = new Map<string, unknown>();
  for (const step of results) {
    outputs.set(step.id, step.output);
  }
  const supplements = collectSupplementsFromResults(results);
  const warpSupplement = supplements.find((supplement) => supplement.kind === "warp");
  const warpFallback = collectWarpSupplement(outputs, supplements);
  const failure = results.find(isFailedResult);
  if (failure) {
    if (failure.kind === "tool.call") {
      return `Failed at ${failure.id}: ${describeExecutionError(failure.error)}`;
    }
    if (failure.kind === "specialist.run" && failure.output && typeof failure.output === "object") {
      const reason = ((failure.output as SpecialistRunResult).check?.reason ?? "specialist plan failed").trim();
      return `Failed at ${failure.id}: ${reason}`;
    }
    if (failure.kind === "specialist.verify" && failure.output && typeof failure.output === "object") {
      const reason = (((failure.output as { reason?: string })?.reason ?? "verification failed")).trim();
      return `Failed at ${failure.id}: ${reason}`;
    }
    if (failure.error) {
      return `Failed at ${failure.id}: ${describeExecutionError(failure.error)}`;
    }
    return `Failed at ${failure.id}`;
  }
  const warpGrounding = warpFallback?.grounding;
  if (warpFallback?.text) {
    return truncateWithMarker(warpFallback.text, RESULT_SUMMARY_LIMIT);
  }
  if (warpGrounding?.status) {
    const failingConstraint =
      warpGrounding.constraints?.find((c) => c.passed === false && c.severity === "HARD") ??
      warpGrounding.constraints?.find((c) => c.passed === false);
    const constraintText = failingConstraint
      ? `failing ${failingConstraint.id ?? "constraint"} (${failingConstraint.severity ?? "unknown"})`
      : "all constraints passing";
    const hashText = warpGrounding.certificateHash ? ` cert=${warpGrounding.certificateHash}` : "";
    return truncateWithMarker(
      `Warp certificate: status=${warpGrounding.status}; ${constraintText}${hashText ? ` (${hashText})` : ""}`,
      RESULT_SUMMARY_LIMIT,
    );
  }
  const successCount = results.filter((step) => step.ok).length;
  const final = results[results.length - 1];
  const readable = final.ok ? pickReadableText(final.output) : undefined;
  if (final.ok && readable) {
    return truncateWithMarker(readable, RESULT_SUMMARY_LIMIT);
  }
  if (warpSupplement) {
    const text = warpSupplement.detail || warpSupplement.summary;
    if (text) {
      return truncateWithMarker(text, RESULT_SUMMARY_LIMIT);
    }
  }
  if (warpFallback?.text) {
    return truncateWithMarker(warpFallback.text, RESULT_SUMMARY_LIMIT);
  }
  if (supplements[0]) {
    const text = supplements[0].detail || supplements[0].summary;
    if (text) {
      return truncateWithMarker(text, RESULT_SUMMARY_LIMIT);
    }
  }
  return `Executed ${successCount}/${results.length} steps successfully.`;
}

export function formatPlanDsl(nodes: PlanNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "SEARCH") {
        return `SEARCH(${JSON.stringify(node.query)},k=${node.topK})`;
      }
      if (node.kind === "SUMMARIZE") {
        return `SUMMARIZE(@${node.source},${JSON.stringify(node.focus)})`;
      }
      if (node.kind === "CALL") {
        return `CALL(${node.tool},{"prompt":...}@${node.summaryRef ?? "none"})`;
      }
      if (node.kind === "SOLVE") {
        const suffix = node.summaryRef ? `,@${node.summaryRef}` : "";
        const verify = node.verifier ? `,verify=${node.verifier}` : "";
        return `SOLVE(${node.solver}${verify}${suffix})`;
      }
      if (node.kind === "VERIFY") {
        return `VERIFY(${node.verifier},@${node.source})`;
      }
      if (node.kind === "DEBATE_START" || node.kind === "DEBATE.START") {
        return `DEBATE.START(${JSON.stringify(node.topic)})`;
      }
      if (node.kind === "DEBATE_CONSUME" || node.kind === "DEBATE.CONSUME") {
        return `DEBATE.CONSUME(@${node.source})`;
      }
      return assertUnreachable(node);
    })
    .join(" -> ");
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled plan node kind: ${(value as { kind?: string }).kind ?? "unknown"}`);
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type RecordKvUsageArgs = {
  sessionId: string;
  runtime: ExecutionRuntime;
  step: ExecutorStep;
  output: unknown;
  citations: string[];
  budgetBytes: number;
};

async function recordKvUsage(args: RecordKvUsageArgs): Promise<void> {
  const transcriptText = formatTranscriptBlock(args.step, args.output);
  const content = transcriptText.trim() ? transcriptText : "[no-output]";
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes === 0) {
    return;
  }
  const turnId = randomUUID();
  kvAdd(args.sessionId, turnId, bytes);
  storeTranscriptBlock(args.sessionId, {
    turnId,
    stepId: args.step.id,
    kind: args.step.kind,
    text: content,
    bytes,
    citations: args.citations,
    createdAt: new Date().toISOString(),
  });

  if (!kvBudgetExceeded(args.sessionId, args.budgetBytes)) {
    return;
  }

  const evictedTurnIds = kvEvictOldest(args.sessionId, args.budgetBytes);
  if (evictedTurnIds.length === 0) {
    return;
  }
  const evictedBlocks = drainTranscriptBlocks(args.sessionId, evictedTurnIds);
  if (evictedBlocks.length === 0) {
    return;
  }
  await summarizeEvictedBlocks(args.sessionId, args.runtime, evictedBlocks);
}

function storeTranscriptBlock(sessionId: string, block: TranscriptBlock): void {
  let bucket = transcriptStore.get(sessionId);
  if (!bucket) {
    bucket = new Map();
    transcriptStore.set(sessionId, bucket);
  }
  bucket.set(block.turnId, block);
}

function drainTranscriptBlocks(sessionId: string, turnIds: string[]): TranscriptBlock[] {
  const bucket = transcriptStore.get(sessionId);
  if (!bucket) {
    return [];
  }
  const collected: TranscriptBlock[] = [];
  for (const turnId of turnIds) {
    const block = bucket.get(turnId);
    if (block) {
      collected.push(block);
      bucket.delete(turnId);
    }
  }
  if (bucket.size === 0) {
    transcriptStore.delete(sessionId);
  }
  return collected;
}

function formatTranscriptBlock(step: ExecutorStep, output: unknown): string {
  if (step.kind === "memory.search") {
    const hits = Array.isArray(output) ? (output as TMemorySearchHit[]) : [];
    const topHits = hits.slice(0, 4).map((hit) => {
      const detail = hit.snippet?.trim() || hit.keys.join(", ") || hit.id;
      return `- ${detail} [${hit.id}]`;
    });
    return [`Search "${step.query}" (k=${step.topK})`, ...topHits].join("\n");
  }
  if (step.kind === "tool.call") {
    if (typeof output === "string") {
      return output;
    }
    if (output && typeof output === "object" && typeof (output as any).text === "string") {
      return (output as { text: string }).text;
    }
  }
  if (step.kind === "summary.compose" && typeof output === "string") {
    return output;
  }
  if (step.kind === "specialist.run" && output && typeof output === "object") {
    const specialist = output as SpecialistRunResult;
    const lines = [
      `SOLVE ${step.solver}`,
      specialist.solver_output.summary ?? "[no summary]",
      step.verifier ? `${step.verifier}: ${specialist.check.ok ? "ok" : "fail"} ${specialist.check.reason ?? ""}` : "no verifier",
    ];
    return lines.filter(Boolean).join("\n");
  }
  if (step.kind === "specialist.verify" && output && typeof output === "object") {
    const check = output as { ok?: boolean; reason?: string };
    return `VERIFY ${step.verifier}: ${(check.ok ?? false) ? "ok" : "fail"} ${check.reason ?? ""}`.trim();
  }
  if (step.kind === "debate.start" && output && typeof output === "object") {
    const started = output as { debateId?: string };
    return started.debateId ? `Debate started: ${started.debateId}` : "Debate started.";
  }
  if (step.kind === "debate.consume" && output && typeof output === "object") {
    const verdict = (output as { outcome?: TDebateOutcome | null; debateId?: string }).outcome;
    if (verdict) {
      return `Debate verdict (${verdict.debate_id}): ${verdict.verdict} (confidence ${(verdict.confidence * 100).toFixed(1)}%)`;
    }
    const debateId = (output as { debateId?: string }).debateId;
    return debateId ? `Debate outcome pending (${debateId})` : "Debate outcome pending";
  }
  if (step.kind === "debate.run" && output && typeof output === "object") {
    const verdict = (output as { verdict?: string }).verdict ?? "pending";
    const debateId = (output as { debateId?: string }).debateId;
    const confidence = (output as { confidence?: number }).confidence;
    const confidencePct =
      typeof confidence === "number" && Number.isFinite(confidence) ? ` @ ${(confidence * 100).toFixed(1)}%` : "";
    const stopReason =
      (output as { stop_reason?: string }).stop_reason ?? (output as { stopReason?: string }).stopReason ?? "";
    const reasonText = stopReason ? ` · stop=${stopReason}` : "";
    return debateId
      ? `Debate.run ${debateId}: ${verdict}${confidencePct}${reasonText}`
      : `Debate.run: ${verdict}${confidencePct}${reasonText}`;
  }
  return safeStringify(output);
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const formatToolError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const resolveToolPolicyFlags = (
  error: unknown,
): ToolLogPolicyFlags | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { type?: string; code?: string };
  const flags: ToolLogPolicyFlags = {};
  if (candidate.type === "approval_denied") {
    flags.approvalMissing = true;
  }
  if (candidate.type === "forbidden" || candidate.code === "forbidden") {
    flags.forbidden = true;
  }
  if (candidate.type === "provenance_missing") {
    flags.provenanceMissing = true;
  }
  return Object.keys(flags).length > 0 ? flags : undefined;
};

async function summarizeEvictedBlocks(
  sessionId: string,
  runtime: ExecutionRuntime,
  blocks: TranscriptBlock[],
): Promise<void> {
  if (blocks.length === 0) {
    return;
  }
  const personaId = runtime.personaId ?? "default";
  const now = new Date().toISOString();
  const summaryLines = blocks.map((block) => {
    const citeSuffix = block.citations.length ? ` (citations: ${block.citations.join(", ")})` : "";
    return `- [${block.stepId}] ${truncate(block.text, 280)}${citeSuffix}`;
  });
  const citationKeys = Array.from(
    new Set(blocks.flatMap((block) => block.citations.filter(Boolean))),
  ).map((cite) => `cite:${cite}`);
  const record: TMemoryRecord = {
    id: `kv-${randomUUID()}`,
    owner_id: personaId,
    created_at: now,
    kind: "episodic",
    text: [`KV eviction summary for session ${sessionId}`, `Goal: ${runtime.goal}`, ...summaryLines].join("\n"),
    keys: ["kv-eviction", `session:${sessionId}`, `goal:${runtime.goal}`, ...citationKeys],
    visibility: "private",
  };
  await putMemoryRecord(record);
}

const truncateWithMarker = (value: string, limit: number, marker = "[truncated]"): string => {
  if (value.length <= limit) {
    return value;
  }
  const suffix = `... ${marker}`;
  const sliceAt = Math.max(0, limit - suffix.length);
  if (sliceAt <= 0) {
    return suffix;
  }
  return `${value.slice(0, sliceAt)}${suffix}`;
};

const truncate = (value: string, limit: number, suffix = "..."): string => {
  if (value.length <= limit) {
    return value;
  }
  const sliceAt = Math.max(0, limit - suffix.length);
  return `${value.slice(0, sliceAt)}${suffix}`;
};

export function pickReadableText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === "object") {
    const payload = value as Record<string, any>;
    const nestedOutput =
      payload.output && typeof payload.output === "object"
        ? ((payload.output as Record<string, any>).text as unknown)
        : undefined;
    const nestedData =
      payload.data && typeof payload.data === "object"
        ? ((payload.data as Record<string, any>).text as unknown)
        : undefined;
    const nestedAnswer =
      payload.output && typeof payload.output === "object"
        ? ((payload.output as Record<string, any>).answer as unknown)
        : undefined;
    const candidates = [
      payload.excerpt,
      payload.summary,
      payload.answer,
      payload.text,
      payload.message,
      payload.content,
      nestedOutput,
      nestedData,
      nestedAnswer,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
  }
  return undefined;
}

function summarizeHits(hits: TMemorySearchHit[], focus: string, goal: string): string {
  if (hits.length === 0) {
    return `No stored memories matched the goal "${goal}".`;
  }

    const bullets = hits.slice(0, 3).map((hit) => {
      const detail = hit.snippet || hit.keys.join(", ") || "(keys only)";
      return `- ${detail} [${formatMemoryCitation(hit)}]`;
    });

  return [`Goal: ${goal}`, `Focus: ${focus}`, "Insights:", ...bullets].join("\n");
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(
    /\{\{(goal|persona|summary|debate)\}\}/g,
    (_, key: "goal" | "persona" | "summary" | "debate") => vars[key] ?? "",
  );
}

const limitText = (value: string, cap = 1800): string => {
  if (value.length > cap) {
    return `${value.slice(0, Math.max(0, cap - 3))}...`;
  }
  return value;
};

const formatSummaryForPrompt = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? limitText(trimmed) : "";
  }
  const readable = pickReadableText(value);
  if (readable) {
    return limitText(readable);
  }
  if (value && typeof value === "object") {
    return limitText(safeStringify(value));
  }
  if (value === undefined || value === null) {
    return "";
  }
  return limitText(String(value));
};

const isUngroundedSummary = (value?: string): boolean => {
  if (!value) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("no stored memories matched") || normalized.includes("no stored memories matched");
};

function buildSpecialistProblem(
  runtime: ExecutionRuntime,
  stepId: string,
  summaryRef: string | undefined,
  summaryValue: unknown,
  summaryCitations: string[],
): { id: string; persona_id: string; goal: string; context: Record<string, unknown> } {
  const sessionId = runtime.sessionId ?? runtime.goal;
  return {
    id: `${sessionId}:${stepId}`,
    persona_id: runtime.personaId ?? "default",
    goal: runtime.goal,
    context: buildSpecialistContext(summaryRef, summaryValue, summaryCitations),
  };
}

function buildSpecialistContext(
  summaryRef: string | undefined,
  summaryValue: unknown,
  summaryCitations: string[],
): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  if (summaryRef) {
    context.summary_ref = summaryRef;
  }
  if (summaryCitations.length > 0) {
    context.citations = summaryCitations;
  }
  if (typeof summaryValue === "string" && summaryValue.trim()) {
    context.summary = summaryValue;
  } else if (summaryValue && typeof summaryValue === "object") {
    context.summary_object = summaryValue;
  }
  return context;
}

function formatDebateNote(outcome?: TDebateOutcome | null, debateId?: string | null): string | null {
  const id = outcome?.debate_id ?? debateId ?? null;
  if (!outcome && !id) {
    return null;
  }
  const lines = ["[Debate verdict]"];
  if (id) {
    lines.push(`debate_id: ${id}`);
  }
  if (outcome) {
    lines.push(`verdict: ${outcome.verdict}`);
    if (outcome.winning_role) {
      lines.push(`winner: ${outcome.winning_role}`);
    }
    lines.push(`confidence: ${(outcome.confidence ?? 0).toFixed(2)}`);
    if (typeof outcome.score === "number") {
      lines.push(`score: ${(outcome.score * 100).toFixed(1)}%`);
    }
    if (typeof outcome.rounds === "number" && outcome.rounds > 0) {
      lines.push(`rounds: ${outcome.rounds}`);
    }
    if (outcome.stop_reason) {
      lines.push(`stop: ${outcome.stop_reason}`);
    }
    if (outcome.key_turn_ids?.length) {
      lines.push(`key_turns: ${outcome.key_turn_ids.join(", ")}`);
    }
  } else {
    lines.push("status: pending");
  }
  return lines.join("\n");
}

function evaluateStepSuccess(step: ExecutorStep, output: unknown): boolean {
  if (step.kind === "specialist.run" && output && typeof output === "object") {
    return Boolean((output as SpecialistRunResult).ok);
  }
  if (step.kind === "specialist.verify" && output && typeof output === "object") {
    return Boolean((output as { ok?: boolean }).ok);
  }
  if (step.kind === "debate.run" && output && typeof output === "object") {
    return Boolean((output as { debateId?: string }).debateId);
  }
  if (step.kind === "debate.consume") {
    return true;
  }
  return true;
}

const hashPayload = (payload: unknown): string => {
  try {
    const serialized = JSON.stringify(payload) ?? "";
    return createHash("sha256").update(serialized).digest("hex").slice(0, 16);
  } catch {
    return "na";
  }
};

const hashText = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
