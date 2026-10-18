import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  DebateConfig,
  type TDebateConfig,
  type TDebateOutcome,
  type TDebateTurn,
  type TDebateContext,
  type TDebateRoundMetrics,
} from "@shared/essence-debate";
import { EssenceEnvelope } from "@shared/essence-schema";
import { type TTelemetrySnapshot } from "@shared/star-telemetry";
import { metrics } from "../../metrics";
import { putEnvelope } from "../essence/store";
import { getTool } from "../../skills";
import { appendToolLog } from "../observability/tool-log-store";
import {
  isStarTelemetryEnabled,
  sendStarDebateEvent,
  type CoherenceAction,
  type StarSyncResult,
} from "./star-bridge";
import {
  governFromTelemetry,
  type CoherenceGovernorDecision,
} from "../../../modules/policies/coherence-governor";
import {
  persistDebateTelemetrySnapshot,
  type DebateTelemetrySnapshot as StoreDebateTelemetrySnapshot,
} from "./telemetry-store";
import { buildDebateTurnPrompt } from "./prompts";
import { buildWarpMessages as buildWarpAgentMessages } from "./warpPromptHelpers";
import type { WarpGrounding } from "./types";
import {
  DEFAULT_DEBATE_EVIDENCE_PROVENANCE,
  DEBATE_STRICT_PROVENANCE_FAIL_REASON,
  type DebateEvidenceProvenance,
} from "./types";

type DebateStatus = "pending" | "running" | "completed" | "timeout" | "aborted";

export type DebateScoreboard = {
  proponent: number;
  skeptic: number;
};

export type StoredDebateTurn = TDebateTurn & { essence_id?: string } & DebateEvidenceProvenance;
export type StoredDebateOutcome = TDebateOutcome & DebateEvidenceProvenance & {
  fail_reason?: typeof DEBATE_STRICT_PROVENANCE_FAIL_REASON;
};
type DebateRoleLiteral = TDebateTurn["role"];

type DebateRecord = {
  id: string;
  goal: string;
  personaId: string;
  createdAt: string;
  updatedAt: string;
  status: DebateStatus;
  config: TDebateConfig;
  turns: StoredDebateTurn[];
  outcome?: StoredDebateOutcome;
  scoreboard: DebateScoreboard;
  startedAt: number;
  endedAt?: number;
  seq: number;
  running: boolean;
  reason?: string;
  context?: TDebateContext;
  metricsHistory: TDebateRoundMetrics[];
  lastMetrics?: TDebateRoundMetrics;
  lastScore: number;
  stagnationStreak: number;
  noveltyStreak: number;
  toolCallsUsed: number;
  noveltyTokens: Set<string>;
  starEnabled: boolean;
  lastTelemetry?: TTelemetrySnapshot;
  lastCoherenceAction?: CoherenceAction;
  lastCollapseConfidence?: number;
  lastGovernorDecision?: CoherenceGovernorDecision;
};

export type DebateStreamEvent =
  | {
      type: "turn";
      seq: number;
      debateId: string;
      turn: StoredDebateTurn;
      scoreboard: DebateScoreboard;
    }
  | {
      type: "status";
      seq: number;
      debateId: string;
      status: DebateStatus;
      scoreboard: DebateScoreboard;
      metrics?: TDebateRoundMetrics;
    }
  | {
      type: "outcome";
      seq: number;
      debateId: string;
      outcome: StoredDebateOutcome;
      scoreboard: DebateScoreboard;
      metrics?: TDebateRoundMetrics;
    };

export type DebateSnapshot = {
  id: string;
  goal: string;
  persona_id: string;
  status: DebateStatus;
  config: {
    max_rounds: number;
    max_wall_ms: number;
    max_tool_calls: number;
    satisfaction_threshold: number;
    min_improvement: number;
    stagnation_rounds: number;
    novelty_epsilon: number;
    verifiers: string[];
  };
  created_at: string;
  updated_at: string;
  turns: StoredDebateTurn[];
  scoreboard: DebateScoreboard;
  outcome: StoredDebateOutcome | null;
  context?: TDebateContext | null;
};

type EventListener = (event: DebateStreamEvent) => void;

type DebateEventPayload =
  | {
      type: "turn";
      turn: StoredDebateTurn;
      scoreboard: DebateScoreboard;
    }
  | {
      type: "status";
      status: DebateStatus;
      scoreboard: DebateScoreboard;
      metrics?: TDebateRoundMetrics;
    }
  | {
      type: "outcome";
      outcome: StoredDebateOutcome;
      scoreboard: DebateScoreboard;
      metrics?: TDebateRoundMetrics;
    };

type LlmChatMessage = { role: string; content: string };

const debates = new Map<string, DebateRecord>();
const eventBuffers = new Map<string, DebateStreamEvent[]>();
const listeners = new Map<string, Set<EventListener>>();
const MAX_EVENT_BUFFER = 500;
const USE_STAR_COLLAPSE = process.env.DEBATE_STAR_COLLAPSE === "1";
const LLM_TOOL_NAME = "llm.http.generate";

const isStrictProvenanceEnabled = (record: DebateRecord): boolean => {
  if (process.env.DEBATE_STRICT_PROVENANCE === "1") return true;
  return (record.context?.knowledge_hints as Record<string, unknown> | undefined)?.strict_provenance === true;
};

const resolveDebateEvidenceProvenance = (record: DebateRecord): DebateEvidenceProvenance => {
  const warp = record.context?.warp_grounding;
  if (!warp) {
    return { ...DEFAULT_DEBATE_EVIDENCE_PROVENANCE };
  }
  const hasHardFail = (warp.constraints ?? []).some((entry) => entry?.severity === "HARD" && entry?.passed === false);
  const certifying = Boolean(warp.certificateHash) && warp.status === "ADMISSIBLE" && !hasHardFail;
  if (certifying) {
    return { provenance_class: "measured", claim_tier: "certified", certifying: true };
  }
  if (warp.certificateHash || (warp.constraints ?? []).length > 0) {
    return { provenance_class: "inferred", claim_tier: "reduced-order", certifying: false };
  }
  return { ...DEFAULT_DEBATE_EVIDENCE_PROVENANCE };
};

const hasEvidenceProvenance = (record: DebateRecord): boolean => {
  const context = record.context;
  if (!context) return false;
  if (context.warp_grounding) return true;
  return Boolean(context.attachments && context.attachments.length > 0);
};

export async function startDebate(rawConfig: TDebateConfig): Promise<{ debateId: string }> {
  const parsed = DebateConfig.parse(rawConfig);
  const debateId = randomUUID();
  const now = new Date().toISOString();
  const record: DebateRecord = {
    id: debateId,
    goal: parsed.goal,
    personaId: parsed.persona_id,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    config: parsed,
    turns: [],
    outcome: undefined,
    scoreboard: { proponent: 0, skeptic: 0 },
    startedAt: Date.now(),
    endedAt: undefined,
    seq: 0,
    running: false,
    context: parsed.context,
    metricsHistory: [],
    lastMetrics: undefined,
    lastScore: 0,
    stagnationStreak: 0,
    noveltyStreak: 0,
    toolCallsUsed: 0,
    noveltyTokens: new Set<string>(),
    starEnabled: isStarTelemetryEnabled(),
    lastTelemetry: undefined,
    lastCoherenceAction: undefined,
    lastCollapseConfidence: undefined,
    lastGovernorDecision: undefined,
  };
  debates.set(debateId, record);
  appendStatusEvent(record);
  scheduleAdvance(debateId);
  return { debateId };
}

export function getDebateSnapshot(debateId: string): DebateSnapshot | null {
  const record = debates.get(debateId);
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    goal: record.goal,
    persona_id: record.personaId,
    status: record.status,
    config: {
      max_rounds: record.config.max_rounds,
      max_wall_ms: record.config.max_wall_ms,
      max_tool_calls: record.config.max_tool_calls,
      satisfaction_threshold: record.config.satisfaction_threshold,
      min_improvement: record.config.min_improvement,
      stagnation_rounds: record.config.stagnation_rounds,
      novelty_epsilon: record.config.novelty_epsilon,
      verifiers: [...(record.config.verifiers ?? [])],
    },
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    turns: record.turns.map((turn) => ({ ...turn })),
    scoreboard: snapshotScore(record),
    outcome: record.outcome ?? null,
    context: record.context,
  };
}

export type DebateTelemetrySnapshot = StoreDebateTelemetrySnapshot;

export function getDebateTelemetry(debateId: string): DebateTelemetrySnapshot | null {
  const record = debates.get(debateId);
  if (!record) {
    return null;
  }
  return {
    debateId: record.id,
    sessionId: record.id,
    sessionType: "debate",
    telemetry: record.lastTelemetry,
    action: record.lastCoherenceAction,
    confidence: record.lastCollapseConfidence,
    updatedAt: record.updatedAt,
    governor: record.lastGovernorDecision,
  };
}

export function listDebateEvents(debateId: string, sinceSeq?: number): DebateStreamEvent[] {
  const buffer = eventBuffers.get(debateId);
  if (!buffer || buffer.length === 0) {
    return [];
  }
  if (sinceSeq === undefined || sinceSeq === null || Number.isNaN(sinceSeq)) {
    return [...buffer];
  }
  return buffer.filter((event) => event.seq > sinceSeq);
}

export function subscribeToDebate(debateId: string, listener: EventListener): () => void {
  const bucket = listeners.get(debateId) ?? new Set<EventListener>();
  bucket.add(listener);
  listeners.set(debateId, bucket);
  return () => {
    const set = listeners.get(debateId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(debateId);
    }
  };
}

export function resumeDebate(debateId: string): void {
  scheduleAdvance(debateId);
}

export function getDebateOwner(debateId: string): string | null {
  return debates.get(debateId)?.personaId ?? null;
}

export async function waitForDebateOutcome(debateId: string, timeoutMs?: number): Promise<StoredDebateOutcome | null> {
  const snapshot = getDebateSnapshot(debateId);
  if (!snapshot) {
    return null;
  }
  if (snapshot.outcome) {
    return snapshot.outcome;
  }
  const maxWait =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? Math.max(0, timeoutMs)
      : snapshot.config.max_wall_ms + 2000;

  return await new Promise<StoredDebateOutcome | null>((resolve) => {
    let finished = false;
    const finish = (outcome: TDebateOutcome | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(outcome);
    };
    const unsubscribe = subscribeToDebate(debateId, (event) => {
      if (event.type === "outcome") {
        finish(event.outcome);
      }
    });
    const timer = setTimeout(() => {
      const snap = getDebateSnapshot(debateId);
      finish(snap?.outcome ?? null);
    }, maxWait);
    resumeDebate(debateId);
  });
}

export async function startDebateAndWaitForOutcome(
  rawConfig: TDebateConfig,
): Promise<{ debateId: string; outcome: StoredDebateOutcome | null }> {
  const { debateId } = await startDebate(rawConfig);
  const outcome = await waitForDebateOutcome(debateId, rawConfig.max_wall_ms);
  return { debateId, outcome };
}

export function __resetDebateStore(): void {
  debates.clear();
  eventBuffers.clear();
  listeners.clear();
}

const scheduleAdvance = (debateId: string) => {
  setImmediate(() => {
    void advanceDebate(debateId);
  });
};

const collectWarpCitations = (grounding?: TDebateContext["warp_grounding"]): string[] => {
  if (!grounding) return [];
  const citeSet = new Set<string>();
  (grounding.citations ?? []).forEach((cite) => {
    if (typeof cite === "string" && cite.trim()) {
      citeSet.add(cite);
    }
  });
  if (grounding.certificateHash) {
    citeSet.add(`cert:${grounding.certificateHash}`);
  }
  for (const constraint of grounding.constraints ?? []) {
    if (constraint?.id) {
      citeSet.add(`constraint:${constraint.id}`);
    }
  }
  return Array.from(citeSet);
};

const formatWarpSnapshotShort = (snapshot?: Record<string, unknown> | null): string | null => {
  if (!snapshot || typeof snapshot !== "object") return null;
  const keys = ["TS_ratio", "gamma_VdB", "T00_min", "M_exotic"];
  const parts: string[] = [];
  for (const key of keys) {
    const value = (snapshot as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const abs = Math.abs(value);
      const formatted = abs !== 0 && (abs >= 1e5 || abs < 1e-3) ? value.toExponential(2) : Number(value.toPrecision(5));
      parts.push(`${key}=${formatted}`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : null;
};

const formatWarpNote = (grounding?: TDebateContext["warp_grounding"]): string | null => {
  if (!grounding) return null;
  const parts: string[] = [];
  const status = grounding?.status;
  if (status) {
    parts.push(`status=${status}`);
  }
  const failing =
    grounding.constraints?.find((c) => c?.passed === false && c.severity === "HARD") ??
    grounding.constraints?.find((c) => c?.passed === false);
  if (failing) {
    parts.push(`fail:${failing.id ?? "constraint"}${failing.severity ? `(${failing.severity})` : ""}`);
  } else if (grounding.constraints && grounding.constraints.length > 0) {
    parts.push("constraints=PASS");
  }
  if (grounding.certificateHash) {
    parts.push(`hash=${grounding.certificateHash}`);
  }
  const snapshot = formatWarpSnapshotShort(grounding.snapshot as Record<string, unknown>);
  if (snapshot) {
    parts.push(`snapshot ${snapshot}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
};

const formatWarpDebateGuardrail = (
  grounding?: TDebateContext["warp_grounding"],
  role?: DebateRoleLiteral,
): string | null => {
  if (!grounding) return null;
  const status = grounding?.status;
  const statusText = status ?? "NOT_CERTIFIED";
  const hash = grounding.certificateHash ? ` hash=${grounding.certificateHash}` : "";
  const failing =
    grounding.constraints?.find((c) => c?.passed === false && c.severity === "HARD") ??
    grounding.constraints?.find((c) => c?.passed === false);
  const missingCertText =
    !status ? "No certificate attached; treat the configuration as NOT certified and keep claims theoretical." : null;
  if (role === "proponent") {
    return (
      missingCertText ??
      `Use certificate status=${statusText}${hash}; only claim viability if status=ADMISSIBLE and all HARD constraints pass${
        failing ? ` (currently failing ${failing.id ?? "constraint"})` : ""
      }. Ground arguments in the pipeline snapshot, not speculation.`
    );
  }
  if (role === "skeptic") {
    return (
      missingCertText ??
      `Audit certificate status=${statusText}${hash}; lean on failing or marginal constraints${
        failing ? ` (start with ${failing.id ?? "constraint"})` : ""
      } to argue risk, and avoid inventing failures not present in the certificate.`
    );
  }
  return (
    missingCertText ??
    `Referee: rely on certificate status=${statusText}${hash} and judge whether roles respected HARD constraints${
      failing ? `, especially ${failing.id ?? "constraint"}` : ""
    } and the pipeline evidence.`
  );
};

async function advanceDebate(debateId: string): Promise<void> {
  const record = debates.get(debateId);
  if (!record) return;
  if (record.running || isTerminal(record.status)) {
    return;
  }
  record.running = true;
  record.status = "running";
  appendStatusEvent(record);
  try {
    while (!isTerminal(record.status)) {
      if (shouldTimeout(record)) {
        finalizeDebate(record, "timeout", { verdict: "Debate exceeded wall-clock budget.", stopReason: "timeout" });
        break;
      }
      if (completedRounds(record) >= record.config.max_rounds) {
        finalizeDebate(record, "completed", { verdict: "Max rounds reached.", stopReason: "max_rounds" });
        break;
      }
      if (record.toolCallsUsed >= record.config.max_tool_calls) {
        finalizeDebate(record, "completed", { verdict: "Tool call budget exhausted.", stopReason: "max_tool_calls" });
        break;
      }
      const round = completedRounds(record) + 1;
      const proponentTurn = await synthesizeTurn(record, "proponent", round);
      await persistTurn(record, proponentTurn);
      metrics.recordDebateRound("proponent");
      await maybeSyncStarTelemetry(record, proponentTurn);
      const starStopAfterProponent = maybeStarCollapseStop(record);
      if (starStopAfterProponent) {
        finalizeDebate(record, starStopAfterProponent.status, {
          verdict: starStopAfterProponent.verdict,
          stopReason: starStopAfterProponent.reason,
          metrics: record.lastMetrics,
        });
        break;
      }
      await maybeYield();

      if (shouldTimeout(record)) {
        finalizeDebate(record, "timeout", { verdict: "Debate exceeded wall-clock budget.", stopReason: "timeout" });
        break;
      }

      const skepticTurn = await synthesizeTurn(record, "skeptic", round);
      await persistTurn(record, skepticTurn);
      metrics.recordDebateRound("skeptic");
      await maybeSyncStarTelemetry(record, skepticTurn);
      const starStopAfterSkeptic = maybeStarCollapseStop(record);
      if (starStopAfterSkeptic) {
        finalizeDebate(record, starStopAfterSkeptic.status, {
          verdict: starStopAfterSkeptic.verdict,
          stopReason: starStopAfterSkeptic.reason,
          metrics: record.lastMetrics,
        });
        break;
      }

      const verifierResults = await runVerifierSweep(record, round);
      updateScoreboard(record, verifierResults);
      const metricsState = computeRoundMetrics(record, round, verifierResults);
      record.lastMetrics = metricsState;
      record.metricsHistory.push(metricsState);
      record.lastScore = metricsState.score;
      const refereeTurn = await synthesizeRefereeTurn(record, round, verifierResults, metricsState);
      await persistTurn(record, refereeTurn);
      metrics.recordDebateRound("referee");

      appendStatusEvent(record, metricsState);
      await maybeSyncStarTelemetry(record, refereeTurn, metricsState);

      const stopDecision = evaluateStopRules(record, round, verifierResults, metricsState);
      if (stopDecision) {
        finalizeDebate(record, stopDecision.status, {
          verdict: stopDecision.verdict,
          stopReason: stopDecision.reason,
          metrics: metricsState,
          failReason: stopDecision.failReason,
        });
        break;
      }
      await maybeYield();
    }
  } catch (error) {
    console.error("[debate] loop error", error);
    finalizeDebate(record, "aborted", { verdict: "Debate aborted due to internal error." });
  } finally {
    record.running = false;
  }
}

const maybeYield = async () => {
  await sleep(5);
};

function isTerminal(status: DebateStatus): boolean {
  return status === "completed" || status === "timeout" || status === "aborted";
}

function shouldTimeout(record: DebateRecord): boolean {
  const elapsed = Date.now() - record.startedAt;
  return elapsed >= record.config.max_wall_ms;
}

function completedRounds(record: DebateRecord): number {
  return record.turns.filter((turn) => turn.role === "referee").length;
}

async function synthesizeTurn(record: DebateRecord, role: DebateRoleLiteral, round: number): Promise<StoredDebateTurn> {
  const createdAt = new Date().toISOString();
  const { text, essenceId: llmEssenceId } = await generateTurnText(record, role, round);
  const citations = collectCitations(record);
  const provenance = resolveDebateEvidenceProvenance(record);
  const turn: StoredDebateTurn = {
    id: randomUUID(),
    debate_id: record.id,
    round,
    role,
    text,
    citations,
    verifier_results: [],
    created_at: createdAt,
    ...provenance,
  };
  const essenceId = llmEssenceId ?? (await persistEssenceForTurn(record, turn));
  if (essenceId) {
    turn.essence_id = essenceId;
  }
  return turn;
}

async function synthesizeRefereeTurn(
  record: DebateRecord,
  round: number,
  verifierResults: StoredDebateTurn["verifier_results"],
  metricsState?: TDebateRoundMetrics,
): Promise<StoredDebateTurn> {
  const createdAt = new Date().toISOString();
  const { text: summary, essenceId: llmEssenceId } = await generateTurnText(record, "referee", round, {
    verifierResults,
    metricsState,
  });
  const citations = collectCitations(record);
  const provenance = resolveDebateEvidenceProvenance(record);
  const turn: StoredDebateTurn = {
    id: randomUUID(),
    debate_id: record.id,
    round,
    role: "referee",
    text: summary,
    citations,
    verifier_results: verifierResults,
    created_at: createdAt,
    ...provenance,
  };
  const essenceId = llmEssenceId ?? (await persistEssenceForTurn(record, turn));
  if (essenceId) {
    turn.essence_id = essenceId;
  }
  return turn;
}

async function persistTurn(record: DebateRecord, turn: StoredDebateTurn): Promise<void> {
  record.turns.push(turn);
  record.updatedAt = turn.created_at;
  appendEvent(record, {
    type: "turn",
    turn: { ...turn },
    scoreboard: snapshotScore(record),
  });
  logTurnAsToolEvent(record, turn);
}

function appendStatusEvent(record: DebateRecord, metricsState?: TDebateRoundMetrics): void {
  appendEvent(record, {
    type: "status",
    status: record.status,
    scoreboard: snapshotScore(record),
    metrics: metricsState,
  });
}

function appendEvent(record: DebateRecord, payload: DebateEventPayload): DebateStreamEvent {
  const seq = ++record.seq;
  let event: DebateStreamEvent;
  switch (payload.type) {
    case "turn":
      event = { ...payload, seq, debateId: record.id };
      break;
    case "status":
      event = { ...payload, seq, debateId: record.id };
      break;
    case "outcome":
      event = { ...payload, seq, debateId: record.id };
      break;
    default: {
      const exhaustiveCheck: never = payload;
      throw new Error(`Unsupported debate event payload ${(exhaustiveCheck as any)?.type ?? "unknown"}`);
    }
  }
  const buffer = eventBuffers.get(record.id) ?? [];
  buffer.push(event);
  if (buffer.length > MAX_EVENT_BUFFER) {
    buffer.splice(0, buffer.length - MAX_EVENT_BUFFER);
  }
  eventBuffers.set(record.id, buffer);
  const subs = listeners.get(record.id);
  if (subs) {
    for (const listener of subs) {
      try {
        listener(event);
      } catch (err) {
        console.warn("[debate] listener error", err);
      }
    }
  }
  return event;
}

async function callLlmGenerate(
  record: DebateRecord,
  messages: LlmChatMessage[],
): Promise<{ text: string; essenceId?: string }> {
  const tool = getTool(LLM_TOOL_NAME);
  if (!tool) {
    console.warn(`[debate] tool ${LLM_TOOL_NAME} not registered; falling back to prompt text`);
    return { text: messages.map((msg) => msg.content).join("\n\n") };
  }
  try {
    const result = (await tool.handler(
      { messages },
      { personaId: record.personaId, goal: record.goal },
    )) as { text?: string; essence_id?: string } | null;
    const text =
      typeof result?.text === "string" && result.text.trim().length > 0 ? result.text : "(no response)";
    const essenceId = typeof result?.essence_id === "string" ? result.essence_id : undefined;
    return { text, essenceId };
  } catch (error) {
    console.warn("[debate] llm.http.generate failed", error);
    return { text: "(llm error)" };
  }
}

async function generateTurnText(
  record: DebateRecord,
  role: DebateRoleLiteral,
  round: number,
  extras?: { verifierResults?: StoredDebateTurn["verifier_results"]; metricsState?: TDebateRoundMetrics },
): Promise<{ text: string; essenceId?: string }> {
  const warpMessages = buildWarpAgentMessages(role, record.goal, round, record.context?.warp_grounding);
  if (warpMessages) {
    return await callLlmGenerate(record, warpMessages);
  }
  const prompt =
    role === "referee"
      ? renderRefereeSummary(record, round, extras?.verifierResults ?? [], extras?.metricsState)
      : renderTurnText(record, role, round);
  return await callLlmGenerate(record, [{ role: "user", content: prompt }]);
}

function renderTurnText(record: DebateRecord, role: DebateRoleLiteral, round: number): string {
  const turnsForPrompt = record.turns.map((turn) => ({
    role: turn.role,
    round: turn.round,
    text: turn.text,
  }));
  return buildDebateTurnPrompt({
    role,
    goal: record.goal,
    round,
    turns: turnsForPrompt,
    scoreboard: record.scoreboard,
    context: record.context,
    metrics: record.lastMetrics,
  });
}

function renderRefereeSummary(
  record: DebateRecord,
  round: number,
  verifierResults: StoredDebateTurn["verifier_results"],
  metricsState?: TDebateRoundMetrics,
): string {
  const turnsForPrompt = record.turns.map((turn) => ({
    role: turn.role,
    round: turn.round,
    text: turn.text,
  }));
  return buildDebateTurnPrompt({
    role: "referee",
    goal: record.goal,
    round,
    turns: turnsForPrompt,
    scoreboard: record.scoreboard,
    context: record.context,
    verifierResults,
    metrics: metricsState ?? record.lastMetrics,
  });
}

function collectCitations(record: DebateRecord): string[] {
  const recent = record.turns.slice(-4).map((turn) => turn.essence_id).filter(Boolean) as string[];
  const citeSet = new Set<string>(recent);
  collectWarpCitations(record.context?.warp_grounding).forEach((cite) => citeSet.add(cite));
  return Array.from(citeSet);
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function logTurnAsToolEvent(record: DebateRecord, turn: StoredDebateTurn): void {
  try {
    const paramsHash = hashText(`${record.id}:${turn.id}:${turn.role}:${turn.round}`);
    const promptHash = hashText(turn.text);
    appendToolLog({
      tool: `debate.turn.${turn.role}`,
      version: "orchestrator",
      paramsHash,
      promptHash,
      durationMs: 0,
      sessionId: record.personaId,
      traceId: record.id,
      stepId: `${turn.round}`,
      ok: true,
      text: turn.text.slice(0, 200),
      essenceId: turn.essence_id,
      debateId: record.id,
    });
  } catch (error) {
    console.warn("[debate] failed to append tool log for turn", error);
  }
}

async function persistEssenceForTurn(record: DebateRecord, turn: StoredDebateTurn): Promise<string | undefined> {
  try {
    const digest = createHash("sha256").update(turn.text).digest("hex");
    const envelope = EssenceEnvelope.parse({
      header: {
        id: randomUUID(),
        version: "essence/1.0",
        modality: "text",
        created_at: turn.created_at,
        source: {
          uri: `debate://${record.id}/turn/${turn.id}`,
          original_hash: { algo: "sha256", value: digest },
          creator_id: record.personaId,
          license: "CC-BY-4.0",
        },
        rights: { allow_mix: true, allow_remix: true, allow_commercial: false, attribution: true },
        acl: { visibility: "private", groups: [] },
      },
      features: {
        text: {
          lang: "en",
        },
      },
      provenance: {
        pipeline: [
          {
            name: `debate.mode/${turn.role}`,
            impl_version: "0.1.0",
            lib_hash: { algo: "sha256", value: digest },
            params: { round: turn.round, goal: record.goal, role: turn.role },
            input_hash: { algo: "sha256", value: createHash("sha256").update(record.goal).digest("hex") },
            output_hash: { algo: "sha256", value: digest },
            started_at: turn.created_at,
            ended_at: turn.created_at,
          },
        ],
        merkle_root: { algo: "sha256", value: digest },
        previous: null,
        signatures: [],
      },
      embeddings: [],
    });
    await putEnvelope(envelope);
    return envelope.header.id;
  } catch (error) {
    console.warn("[debate] failed to persist essence turn", error);
    return undefined;
  }
}

type VerifierResult = {
  name: string;
  ok: boolean;
  reason: string;
};

type VerifierContext = {
  goal: string;
  round: number;
  latestTurn?: StoredDebateTurn;
  attachments: Array<{ title: string; url: string }>;
  telemetrySummary?: string | null;
};

const FALLBACK_ATTACHMENTS: Array<{ title: string; url: string }> = [
  {
    title: "Stellar Consciousness (Orch OR Review)",
    url: "/mnt/data/Reformatted; Stellar Consciousness by Orchestrated Objective Reduction Review.pdf",
  },
  {
    title: "Quantum Computation in Brain Microtubules (1998)",
    url: "/mnt/data/Quantum Computation in Brain Microtubules The Penrose-Hameroff hameroff-1998.pdf",
  },
];

const buildVerifierContext = (record: DebateRecord, round: number): VerifierContext => {
  const latestTurn = [...record.turns].reverse().find((turn) => turn.role !== "referee");
  const attachments = record.context?.attachments && record.context.attachments.length > 0 ? record.context.attachments : FALLBACK_ATTACHMENTS;
  return {
    goal: record.goal,
    round,
    latestTurn,
    attachments,
    telemetrySummary: record.context?.telemetry_summary,
  };
};

async function invokeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; reason: string }> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, reason: "Tool not registered" };
  }
  try {
    const result = await tool.handler(input, {});
    const summary = typeof result === "object" && result !== null ? Object.keys(result as Record<string, unknown>).join(", ") : "ok";
    return { ok: true, reason: `Executed ${name}: ${summary || "ok"}`.slice(0, 180) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.slice(0, 200) };
  }
}

async function runVerifierSweep(record: DebateRecord, round: number): Promise<VerifierResult[]> {
  const verifiers = record.config.verifiers ?? [];
  if (verifiers.length === 0) {
    return [];
  }
  const ctx = buildVerifierContext(record, round);
  const results: VerifierResult[] = [];
  const governorHints = record.lastGovernorDecision?.toolBudgetHints;
  const maxToolsPerRound = governorHints?.maxToolsPerRound;
  const toolCallsAtStart = record.toolCallsUsed;

  for (const name of verifiers) {
    if (record.toolCallsUsed >= record.config.max_tool_calls) {
      break;
    }
    if (typeof maxToolsPerRound === "number") {
      const usedThisRound = record.toolCallsUsed - toolCallsAtStart;
      if (usedThisRound >= maxToolsPerRound) {
        break;
      }
    }
    record.toolCallsUsed += 1;
    let ok = true;
    let reason = "verified";
    try {
      if (name === "docs.evidence.search.md") {
        const { ok: pass, reason: detail } = await invokeTool(name, {
          query: ctx.latestTurn?.text ?? ctx.goal,
          projectIds: ["baseline"],
          k: 3,
          window: { tokens: 160 },
        });
        ok = pass;
        reason = detail;
      } else if (name === "docs.evidence.search.pdf") {
        const files = ctx.attachments.map((att) => ({ title: att.title, url: att.url }));
        const { ok: pass, reason: detail } = await invokeTool(name, {
          query: ctx.latestTurn?.text ?? ctx.goal,
          files: files.length ? files : FALLBACK_ATTACHMENTS,
          k: Math.min(3, files.length || 2),
          windowChars: 600,
        });
        ok = pass;
        reason = detail;
      } else if (name === "citation.verify.span") {
        const citation =
          ctx.attachments.length > 0
            ? { type: "pdf", path: ctx.attachments[0].url, page: 1 }
            : { type: "md", path: "docs/baseline.md", heading: "overview" };
        const { ok: pass, reason: detail } = await invokeTool(name, {
          quote: (ctx.latestTurn?.text ?? ctx.goal).slice(0, 200),
          citation,
        });
        ok = pass;
        reason = detail;
      } else if (name === "numeric.extract.units") {
        const { ok: pass, reason: detail } = await invokeTool(name, {
          text: ctx.latestTurn?.text ?? ctx.goal,
          system: "SI",
        });
        ok = pass;
        reason = detail;
      } else if (name === "contradiction.scan") {
        const { ok: pass, reason: detail } = await invokeTool(name, {
          claim: ctx.latestTurn?.text ?? ctx.goal,
          scope: { projects: ["baseline"] },
          k: 3,
        });
        ok = pass;
        reason = detail;
      } else if (name === "telemetry.crosscheck.docs") {
        const { ok: pass, reason: detail } = await invokeTool(name, {
          telemetry: { coherence: 0.551, q: 0.56, occupancy: 0.005 },
          thresholds: [{ name: "coherence_min", value: 0.56, source: "docs/fractional-coherence.md#thresholds" }],
        });
        ok = pass;
        reason = detail;
      } else if (name === "debate.checklist.score" || name === "checklist.method.score") {
        const checklist = { intention: ctx.goal, hypotheses: [{ id: "H1", text: ctx.goal }], conflicts: [] };
        const { ok: pass, reason: detail } = await invokeTool("checklist.method.score", {
          checklist,
          claims: ctx.latestTurn ? [{ text: ctx.latestTurn.text }] : [],
          evidence: ctx.attachments,
          verifierResults: results.map((entry) => ({ name: entry.name, ok: entry.ok })),
        });
        ok = pass;
        reason = detail;
      } else if (name === "math.sympy.verify") {
        ok = (round + record.scoreboard.proponent + record.scoreboard.skeptic) % 2 === 0;
        reason = ok ? "Sympy verifier placeholder pass." : "Sympy verifier placeholder fail.";
      } else {
        ok = (round + results.length) % 2 === 0;
        reason = "Generic verifier placeholder.";
      }
    } catch (error) {
      ok = false;
      reason = error instanceof Error ? error.message : String(error);
    }
    metrics.recordDebateVerification(name, ok);
    results.push({ name, ok, reason });
  }

  return results;
}

function updateScoreboard(record: DebateRecord, verifierResults: VerifierResult[]): void {
  if (!verifierResults.length) {
    record.scoreboard.proponent += 1;
    record.scoreboard.skeptic += 1;
    return;
  }
  const okCount = verifierResults.filter((entry) => entry.ok).length;
  const failCount = verifierResults.length - okCount;
  if (okCount >= failCount) {
    record.scoreboard.proponent += 1;
  }
  if (failCount >= okCount) {
    record.scoreboard.skeptic += 1;
  }
}

const clamp01Metric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const clampRange = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const tokenize = (text: string): Set<string> => {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/gi)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3 && part.length <= 32)
      .slice(0, 200),
  );
};

function computeStability(record: DebateRecord): number {
  const turns = record.turns.filter((turn) => turn.role !== "referee");
  const lastTwo = turns.slice(-2);
  if (lastTwo.length < 2) {
    return 0.5;
  }
  const [a, b] = lastTwo;
  const tokensA = tokenize(a.text);
  const tokensB = tokenize(b.text);
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) {
    return 0.5;
  }
  const intersection = [...tokensA].filter((token) => tokensB.has(token));
  return clamp01Metric(intersection.length / union.size);
}

function computeNoveltyGain(record: DebateRecord, round: number): number {
  const roundTurns = record.turns.filter((turn) => turn.round === round && turn.role !== "referee");
  if (roundTurns.length === 0) {
    return 0;
  }
  const combined = tokenize(roundTurns.map((turn) => turn.text).join(" "));
  const previous = record.noveltyTokens ?? new Set<string>();
  const union = new Set([...previous, ...combined]);
  const newTokens = [...combined].filter((token) => !previous.has(token));
  const novelty = union.size === 0 ? 0 : clamp01Metric(newTokens.length / union.size);
  record.noveltyTokens = union;
  return novelty;
}

function computeRoundMetrics(
  record: DebateRecord,
  round: number,
  verifierResults: VerifierResult[],
): TDebateRoundMetrics {
  const okCount = verifierResults.filter((entry) => entry.ok).length;
  const failCount = verifierResults.length - okCount;
  const verifierPass = verifierResults.length === 0 ? 0.5 : clamp01Metric(okCount / verifierResults.length);
  const coverage = clamp01Metric(round / Math.max(record.config.max_rounds, 1));
  const stability = computeStability(record);
  const noveltyGain = computeNoveltyGain(record, round);
  const score = clamp01Metric(0.5 * verifierPass + 0.3 * coverage + 0.2 * stability);
  const improvement = score - (record.lastScore ?? 0);
  const timeUsed = Date.now() - record.startedAt;
  const timeLeft = Math.max(0, record.config.max_wall_ms - timeUsed);
  return {
    round,
    verifier_pass: verifierPass,
    coverage,
    stability,
    novelty_gain: noveltyGain,
    score,
    improvement,
    flags: Math.max(0, failCount),
    tool_calls: record.toolCallsUsed,
    time_used_ms: timeUsed,
    time_left_ms: timeLeft,
  };
}

type StopDecision = {
  status: DebateStatus;
  verdict: string;
  reason: string;
  failReason?: typeof DEBATE_STRICT_PROVENANCE_FAIL_REASON;
};

async function maybeSyncStarTelemetry(
  record: DebateRecord,
  turn: StoredDebateTurn,
  metricsState?: TDebateRoundMetrics,
): Promise<void> {
  if (!record.starEnabled) return;
  try {
    const environmentTags = buildEnvironmentTags(record);
    const alignment = estimateEnvironmentAlignment(record, environmentTags);
    const result = await sendStarDebateEvent({
      debateId: record.id,
      goal: record.goal,
      role: turn.role,
      round: turn.round,
      text: turn.text,
      score: metricsState?.score,
      improvement: metricsState?.improvement,
      verifierPass: metricsState?.verifier_pass,
      toolCallsUsed: record.toolCallsUsed,
      alignment,
      environmentTags,
      timestamp: Date.now(),
    });
    if (result) {
      record.lastTelemetry = result.snapshot;
      record.lastCoherenceAction = result.action;
      record.lastCollapseConfidence = result.confidence;
       const governorDecision = governFromTelemetry(result.snapshot);
       record.lastGovernorDecision = governorDecision;
      record.context = {
        ...(record.context ?? {}),
        coherence_snapshot: result.snapshot,
        telemetry_summary: summarizeTelemetry(result, governorDecision),
        coherence_governor: governorDecision,
        environment_tags: environmentTags,
        environment_alignment: alignment,
      };
    }
  } catch (error) {
    console.warn("[debate] star telemetry sync failed", error);
  }
}

const buildEnvironmentTags = (record: DebateRecord): string[] => {
  const tags = new Set<string>(["debate", `persona:${record.personaId}`]);
  if (record.goal) {
    tags.add(`goal:${record.goal.slice(0, 48)}`);
  }
  if (record.context?.attachments?.length) {
    tags.add("attachments");
  }
  // Active repo / project hint (coarse, non‑PII)
  tags.add("project:casimirbot");
  // Current route / panel – if the planner or desktop has pushed hints into context,
  // prefer those; otherwise fall back to neutral labels.
  const route = (record.context as any)?.current_route as string | undefined;
  if (route && typeof route === "string") {
    tags.add(`route:${route.slice(0, 48)}`);
  }
  const panel = (record.context as any)?.current_panel as string | undefined;
  if (panel && typeof panel === "string") {
    tags.add(`panel:${panel.slice(0, 48)}`);
  }
  // Persona intent or high‑level task intent, if present.
  const intent = (record.context as any)?.persona_intent as string | undefined;
  if (intent && typeof intent === "string") {
    tags.add(`intent:${intent.slice(0, 48)}`);
  }
  // File extensions that appear in attachments can give a coarse "active file types" view.
  const urls = (record.context?.attachments ?? []).map((att) => att.url ?? "").filter(Boolean);
  const exts = new Set<string>();
  for (const url of urls) {
    const match = /\.([a-zA-Z0-9]+)$/.exec(url.split(/[?#]/)[0] ?? "");
    if (match && match[1]) {
      exts.add(match[1].toLowerCase());
    }
  }
  for (const ext of exts) {
    tags.add(`file:${ext}`);
  }
  // Tool classes used in this debate – derived from verifier names and tool log events.
  const toolClasses = inferToolClassesForDebate(record);
  for (const cls of toolClasses) {
    tags.add(`tool:${cls}`);
  }
  return Array.from(tags).slice(0, 16);
};

const estimateEnvironmentAlignment = (record: DebateRecord, envTags: string[]): number => {
  const goalTokens = tokenize(record.goal ?? "");
  const tagTokens = new Set(
    envTags
      .flatMap((tag) => tag.split(/[:/]+/))
      .map((part) => part.toLowerCase().trim())
      .filter((part) => part.length >= 3 && part.length <= 32),
  );
  if (!goalTokens.size || !tagTokens.size) {
    return 0;
  }
  const overlap = [...goalTokens].filter((token) => tagTokens.has(token));
  const union = new Set([...goalTokens, ...tagTokens]);
  const score = overlap.length / union.size;
  return clampRange(score * 2 - 0.5, -1, 1);
};

const inferToolClassesForDebate = (record: DebateRecord): Set<string> => {
  const classes = new Set<string>();
  const verifiers = record.config.verifiers ?? [];
  for (const name of verifiers) {
    const label = classifyTool(name);
    if (label) classes.add(label);
  }
  return classes;
};

const classifyTool = (name: string): string | null => {
  const id = name.toLowerCase();
  if (id.includes("code") || id.includes("lint") || id.includes("build")) return "code";
  if (id.includes("web") || id.includes("http") || id.includes("browser")) return "web";
  if (id.includes("docs") || id.includes("pdf") || id.includes("citation")) return "docs";
  if (id.includes("search") || id.includes("kb") || id.includes("rag")) return "knowledge";
  if (id.includes("math") || id.includes("numeric") || id.includes("sympy")) return "math";
  if (id.includes("telemetry")) return "telemetry";
  return null;
};

const summarizeTelemetry = (result: StarSyncResult, governor?: CoherenceGovernorDecision): string => {
  const coherence = result.snapshot.global_coherence ?? 0;
  const pressure = result.snapshot.collapse_pressure ?? 0;
  const dispersion = result.snapshot.phase_dispersion ?? 0;
  const starAction = result.action;
  const governorAction = governor?.action ?? "n/a";
  const confidence = governor?.confidence ?? result.confidence ?? 0;
  const threshold = governor?.adjustedCollapseThreshold;
  const thresholdPct = typeof threshold === "number" ? ` thr=${(threshold * 100).toFixed(0)}%` : "";
  return `coh=${coherence.toFixed(2)} pressure=${pressure.toFixed(2)} disp=${dispersion.toFixed(2)} star=${starAction} gov=${governorAction} conf=${(confidence * 100).toFixed(0)}%${thresholdPct}`;
};

function maybeStarCollapseStop(record: DebateRecord): StopDecision | null {
  if (!USE_STAR_COLLAPSE) return null;
  if (!record.starEnabled) return null;
  if (!record.lastTelemetry || !record.lastGovernorDecision) {
    return null;
  }
  if (record.lastGovernorDecision.action !== "collapse") {
    return null;
  }
  const confidence = record.lastCollapseConfidence ?? record.lastGovernorDecision.confidence ?? 0;
  const threshold = record.lastGovernorDecision.adjustedCollapseThreshold;
  if (confidence < threshold) return null;
  const coherence = record.lastTelemetry.global_coherence ?? 0;
  return {
    status: "completed",
    verdict: `Star coherence collapse requested (confidence ${(confidence * 100).toFixed(0)}%, thr ${(threshold * 100).toFixed(0)}%, coh ${coherence.toFixed(2)}).`,
    reason: "star_collapse",
  };
}

function evaluateStopRules(
  record: DebateRecord,
  round: number,
  verifierResults: VerifierResult[],
  metricsState: TDebateRoundMetrics,
): StopDecision | null {
  if (shouldTimeout(record)) {
    return { status: "timeout", verdict: "Debate exceeded wall-clock budget.", reason: "timeout" };
  }
  if (isStrictProvenanceEnabled(record) && !hasEvidenceProvenance(record)) {
    return {
      status: "completed",
      verdict: "Strict provenance gate failed: evidence provenance metadata is required.",
      reason: "strict_provenance_missing",
      failReason: DEBATE_STRICT_PROVENANCE_FAIL_REASON,
    };
  }
  if (record.toolCallsUsed >= record.config.max_tool_calls) {
    return { status: "completed", verdict: "Tool call budget exhausted.", reason: "max_tool_calls" };
  }
  if (verifierResults.length > 0) {
    if (verifierResults.every((entry) => entry.ok)) {
      return { status: "completed", verdict: "Agreement reached: skeptic satisfied all checks.", reason: "verifier_all_pass" };
    }
    if (verifierResults.every((entry) => !entry.ok)) {
      return { status: "completed", verdict: "Skeptic refuted the claim in this pass.", reason: "verifier_all_fail" };
    }
  }

  const starStop = maybeStarCollapseStop(record);
  if (starStop) {
    return starStop;
  }

  const satisfied =
    metricsState.score >= record.config.satisfaction_threshold &&
    metricsState.improvement < record.config.min_improvement;
  record.stagnationStreak =
    metricsState.improvement < record.config.min_improvement ? record.stagnationStreak + 1 : 0;
  record.noveltyStreak =
    metricsState.novelty_gain < record.config.novelty_epsilon ? record.noveltyStreak + 1 : 0;

  if (satisfied) {
    return {
      status: "completed",
      verdict: `Satisfied at score ${(metricsState.score * 100).toFixed(1)}%.`,
      reason: "satisfaction_threshold",
    };
  }
  if (record.stagnationStreak >= record.config.stagnation_rounds) {
    return { status: "completed", verdict: "Stopped after stagnation across rounds.", reason: "stagnation" };
  }
  if (record.noveltyStreak >= record.config.stagnation_rounds) {
    return { status: "completed", verdict: "No new evidence surfaced across recent rounds.", reason: "novelty_plateau" };
  }
  if (round >= record.config.max_rounds) {
    return { status: "completed", verdict: "Max rounds reached.", reason: "max_rounds" };
  }
  return null;
}

function finalizeDebate(
  record: DebateRecord,
  status: DebateStatus,
  metadata?: {
    verdict?: string;
    stopReason?: string;
    metrics?: TDebateRoundMetrics;
    failReason?: typeof DEBATE_STRICT_PROVENANCE_FAIL_REASON;
  },
): void {
  if (isTerminal(record.status)) {
    return;
  }
  record.status = status;
  record.endedAt = Date.now();
  record.updatedAt = new Date().toISOString();
  record.reason = metadata?.stopReason ?? record.reason;
  const outcome = buildOutcome(record, metadata);
  record.outcome = outcome;
  metrics.observeDebateWall(record.endedAt - record.startedAt);
  if (record.lastTelemetry) {
    const confidence =
      record.lastCollapseConfidence ?? record.lastGovernorDecision?.confidence ?? undefined;
    const snapshot: DebateTelemetrySnapshot = {
      debateId: record.id,
      sessionId: record.id,
      sessionType: "debate",
      telemetry: record.lastTelemetry,
      action: record.lastCoherenceAction,
      confidence,
      updatedAt: record.updatedAt,
      governor: record.lastGovernorDecision,
    };
    void persistDebateTelemetrySnapshot(snapshot).catch((error) => {
      console.warn("[debate] failed to persist telemetry snapshot", error);
    });
  }
  appendEvent(record, {
    type: "outcome",
    outcome,
    scoreboard: snapshotScore(record),
    metrics: metadata?.metrics ?? record.lastMetrics,
  });
  appendStatusEvent(record, metadata?.metrics ?? record.lastMetrics);
}

function buildOutcome(
  record: DebateRecord,
  metadata?: {
    verdict?: string;
    stopReason?: string;
    metrics?: TDebateRoundMetrics;
    failReason?: typeof DEBATE_STRICT_PROVENANCE_FAIL_REASON;
  },
): StoredDebateOutcome {
  const diff = record.scoreboard.proponent - record.scoreboard.skeptic;
  const total = Math.max(record.scoreboard.proponent + record.scoreboard.skeptic, 1);
  const winning_role = diff > 0 ? "proponent" : diff < 0 ? "skeptic" : undefined;
  const confidence = Math.min(0.95, 0.5 + Math.abs(diff) / total / 2);
  const verdict =
    metadata?.verdict ??
    (winning_role
      ? `${capitalize(winning_role)} leads ${record.scoreboard.proponent}-${record.scoreboard.skeptic}.`
      : "Referee declares stalemate after configured rounds.");
  const metricsState = metadata?.metrics ?? record.lastMetrics;
  const key_turn_ids = record.turns
    .slice(-5)
    .map((turn) => turn.id)
    .filter(Boolean);
  const provenance = resolveDebateEvidenceProvenance(record);
  return {
    debate_id: record.id,
    verdict,
    confidence,
    winning_role,
    key_turn_ids,
    rounds: completedRounds(record),
    score: metricsState?.score ?? record.lastScore ?? 0,
    stop_reason: metadata?.stopReason ?? record.reason,
    metrics: metricsState,
    created_at: record.updatedAt,
    ...provenance,
    fail_reason: metadata?.failReason,
  };
}

function snapshotScore(record: DebateRecord): DebateScoreboard {
  return { proponent: record.scoreboard.proponent, skeptic: record.scoreboard.skeptic };
}

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
