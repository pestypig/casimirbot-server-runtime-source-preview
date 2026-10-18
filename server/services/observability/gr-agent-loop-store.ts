import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type {
  GrAgentLoopAttempt,
  GrAgentLoopOptions,
  GrAgentLoopResult,
  GrAgentLoopBudgetReport,
  GrAgentLoopFidelity,
  GrAgentLoopState,
  GrAgentLoopStateEvent,
  GrAgentLoopTiming,
} from "../../gr/gr-agent-loop.js";
import type {
  GrConstraintGateStatus,
  GrConstraintEntry,
  GrEvaluation,
  PolicyLadder,
  TrainingTraceConstraint,
  TrainingTraceDelta,
} from "../../../shared/schema.js";
import { metrics } from "../../metrics";
import { recordTrainingTrace } from "./training-trace-store.js";

export type GrAgentLoopAttemptAudit = {
  iteration: number;
  label?: string;
  params?: Record<string, unknown>;
  grRequest?: GrAgentLoopAttempt["grRequest"];
  fidelity?: GrAgentLoopFidelity;
  initial?: GrAgentLoopAttempt["initial"];
  evolution?: GrAgentLoopAttempt["evolution"];
  policy?: GrEvaluation["policy"];
  residuals: GrEvaluation["residuals"];
  gateStatus: GrConstraintGateStatus;
  gate?: GrEvaluation["gate"];
  constraints?: GrEvaluation["constraints"];
  certificateStatus: string;
  certificateHash: string | null;
  certificateId?: string | null;
  certificateIntegrityOk?: boolean;
  certificate?: GrEvaluation["certificate"];
  notes?: GrEvaluation["notes"];
  timing?: GrAgentLoopTiming;
  pass: boolean;
  accepted: boolean;
};

export type GrAgentLoopParamChange = {
  key: string;
  from?: unknown;
  to?: unknown;
  delta?: number;
  change: "added" | "removed" | "changed";
};

export type GrAgentLoopPatch = {
  fromIteration: number;
  toIteration: number;
  fromLabel?: string;
  toLabel?: string;
  accepted?: boolean;
  changes: GrAgentLoopParamChange[];
};

export type GrAgentLoopRunRecord = {
  id: string;
  seq: number;
  ts: string;
  tenantId?: string;
  durationMs: number;
  accepted: boolean;
  acceptedIteration?: number;
  state: GrAgentLoopState;
  stateHistory: GrAgentLoopStateEvent[];
  budget: GrAgentLoopBudgetReport;
  options?: GrAgentLoopOptions;
  attempts: GrAgentLoopAttemptAudit[];
  patches?: GrAgentLoopPatch[];
};

export type GrAgentLoopKpiSummary = {
  window: {
    limit: number;
    runs: number;
    attempts: number;
    accepted: number;
    rejected: number;
    violations: number;
  };
  successRate: number | null;
  constraintViolationRate: number | null;
  timeToGreenMs: {
    avg: number | null;
    last: number | null;
    count: number;
  };
  perfTrend: {
    series: number[];
    recentAvgMs: number | null;
    priorAvgMs: number | null;
    deltaPct: number | null;
    trend: "improving" | "degrading" | "flat" | "insufficient";
  };
};

type AppendGrAgentLoopRun = Omit<
  GrAgentLoopRunRecord,
  "id" | "seq" | "ts"
> &
  Partial<Pick<GrAgentLoopRunRecord, "ts">>;

const parseBufferSize = (): number => {
  const requested = Number(process.env.GR_AGENT_LOOP_BUFFER_SIZE ?? 200);
  if (!Number.isFinite(requested) || requested < 1) {
    return 200;
  }
  return Math.min(Math.max(25, Math.floor(requested)), 1000);
};

const MAX_BUFFER_SIZE = parseBufferSize();
const AUDIT_PERSIST_ENABLED = process.env.GR_AGENT_LOOP_PERSIST !== "0";
const AUDIT_LOG_PATH = resolveAuditLogPath();
const loopRuns: GrAgentLoopRunRecord[] = [];
let loopSequence = 0;
let persistChain = Promise.resolve();

const persistedRuns = loadPersistedRuns();
if (persistedRuns.length > 0) {
  loopRuns.push(...persistedRuns);
  loopSequence = persistedRuns.reduce(
    (max, run) => Math.max(max, run.seq),
    0,
  );
}

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value) as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const flattenParams = (
  value: unknown,
  prefix = "",
  map: Map<string, unknown> = new Map(),
): Map<string, unknown> => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenParams(entry, next, map);
    });
    return map;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, entry]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenParams(entry, next, map);
    });
    return map;
  }
  if (prefix) {
    map.set(prefix, value);
  }
  return map;
};

const diffParams = (
  from?: Record<string, unknown>,
  to?: Record<string, unknown>,
): GrAgentLoopParamChange[] => {
  const fromMap = flattenParams(from);
  const toMap = flattenParams(to);
  const keys = new Set<string>([...fromMap.keys(), ...toMap.keys()]);
  const changes: GrAgentLoopParamChange[] = [];
  keys.forEach((key) => {
    const hasFrom = fromMap.has(key);
    const hasTo = toMap.has(key);
    const fromValue = hasFrom ? fromMap.get(key) : undefined;
    const toValue = hasTo ? toMap.get(key) : undefined;
    if (hasFrom && hasTo && Object.is(fromValue, toValue)) {
      return;
    }
    const change: GrAgentLoopParamChange = {
      key,
      from: fromValue,
      to: toValue,
      change: hasFrom && !hasTo ? "removed" : !hasFrom && hasTo ? "added" : "changed",
    };
    if (typeof fromValue === "number" && typeof toValue === "number") {
      change.delta = toValue - fromValue;
    }
    changes.push(change);
  });
  return changes;
};

const buildPatches = (
  attempts: GrAgentLoopAttemptAudit[],
): GrAgentLoopPatch[] => {
  if (!Array.isArray(attempts) || attempts.length < 2) {
    return [];
  }
  const patches: GrAgentLoopPatch[] = [];
  for (let i = 1; i < attempts.length; i += 1) {
    const from = attempts[i - 1];
    const to = attempts[i];
    const changes = diffParams(from.params, to.params);
    if (changes.length === 0) {
      continue;
    }
    patches.push({
      fromIteration: from.iteration,
      toIteration: to.iteration,
      fromLabel: from.label,
      toLabel: to.label,
      accepted: to.accepted,
      changes,
    });
  }
  return patches;
};

const toTrainingTraceDeltas = (
  changes: GrAgentLoopParamChange[],
): TrainingTraceDelta[] => {
  const deltas: TrainingTraceDelta[] = [];
  for (const change of changes) {
    const from = typeof change.from === "number" ? change.from : null;
    const to = typeof change.to === "number" ? change.to : null;
    const delta = typeof change.delta === "number" ? change.delta : undefined;
    if (from === null && to === null && delta === undefined) {
      continue;
    }
    deltas.push({
      key: change.key,
      from,
      to,
      delta,
      change: change.change,
    });
  }
  return deltas;
};

const toTrainingTraceConstraint = (
  constraint: GrConstraintEntry,
): TrainingTraceConstraint => ({
  id: constraint.id,
  severity: constraint.severity,
  status: constraint.status,
  value: constraint.value ?? null,
  limit: constraint.limit ?? null,
  note: constraint.note,
});

const findFirstFailingHardConstraint = (
  constraints?: GrConstraintEntry[],
): TrainingTraceConstraint | undefined => {
  if (!Array.isArray(constraints) || constraints.length === 0) {
    return undefined;
  }
  const failing = constraints.find(
    (entry) => entry.severity === "HARD" && entry.status !== "pass",
  );
  return failing ? toTrainingTraceConstraint(failing) : undefined;
};

const buildTrainingTraceNotes = (
  attempt: GrAgentLoopAttemptAudit,
): string[] | undefined => {
  const notes = [...(attempt.notes ?? [])];
  if (attempt.initial?.status && attempt.initial.status !== "CERTIFIED") {
    notes.push(`initial_status=${attempt.initial.status}`);
  }
  if (attempt.gateStatus && attempt.gateStatus !== "pass") {
    notes.push(`gateStatus=${attempt.gateStatus}`);
  }
  return notes.length ? notes : undefined;
};

const isCertifiedAttempt = (attempt: GrAgentLoopAttemptAudit): boolean => {
  if (!attempt.accepted) return false;
  if (!attempt.certificateHash) return false;
  return attempt.certificateIntegrityOk === true;
};

const resolveGrSignalKind = (attempt: GrAgentLoopAttemptAudit): string =>
  isCertifiedAttempt(attempt) ? "gr-certified" : "gr-diagnostic";

const resolveGrPolicyLadder = (
  attempt: GrAgentLoopAttemptAudit,
): PolicyLadder => {
  const gate = attempt.policy?.gate;
  const policy = gate?.source ? `gr-constraint-gate:${gate.source}` : "gr-constraint-gate";
  const policyVersion =
    gate?.version !== undefined ? String(gate.version) : undefined;
  return {
    tier: isCertifiedAttempt(attempt) ? "certified" : "diagnostic",
    policy,
    ...(policyVersion ? { policyVersion } : {}),
  };
};

const emitTrainingTraces = (record: GrAgentLoopRunRecord): void => {
  const attempts = record.attempts ?? [];
  attempts.forEach((attempt, index) => {
    const prev = index > 0 ? attempts[index - 1] : undefined;
    const changes = prev ? diffParams(prev.params, attempt.params) : [];
    const firstFail = findFirstFailingHardConstraint(attempt.constraints);
    recordTrainingTrace({
      traceId: `gr-agent-loop:${record.id}:${attempt.iteration}`,
      tenantId: record.tenantId,
      source: {
        system: "gr-agent-loop",
        component: "gr-agent-loop",
        tool: "gr-agent-loop",
        version: "v1",
        proxy: false,
      },
      signal: {
        kind: resolveGrSignalKind(attempt),
        proxy: false,
        ladder: resolveGrPolicyLadder(attempt),
      },
      pass: attempt.accepted,
      deltas: toTrainingTraceDeltas(changes),
      firstFail,
      certificate: {
        status: attempt.certificateStatus,
        certificateHash: attempt.certificateHash ?? null,
        certificateId: attempt.certificateId ?? null,
        integrityOk: attempt.certificateIntegrityOk,
      },
      notes: buildTrainingTraceNotes(attempt),
    });
  });
};

function normalizeRunRecord(
  record: GrAgentLoopRunRecord,
): GrAgentLoopRunRecord {
  const state = record.state ?? (record.accepted ? "accepted" : "rejected");
  const stateHistory = Array.isArray(record.stateHistory)
    ? record.stateHistory
    : [];
  const budget = record.budget ?? { totalMs: record.durationMs };
  const patches = Array.isArray(record.patches)
    ? record.patches
    : buildPatches(record.attempts ?? []);
  return {
    ...record,
    state,
    stateHistory,
    budget,
    patches,
  };
}

const toTimestampMs = (value?: string): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const average = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const toAttemptAudit = (
  attempt: GrAgentLoopAttempt,
): GrAgentLoopAttemptAudit => ({
  iteration: attempt.iteration,
  label: attempt.proposal.label,
  params: attempt.proposal.params
    ? cloneValue(attempt.proposal.params as Record<string, unknown>)
    : undefined,
  grRequest: cloneValue(attempt.grRequest),
  fidelity: cloneValue(attempt.fidelity),
  initial: cloneValue(attempt.initial),
  evolution: cloneValue(attempt.evolution),
  policy: cloneValue(attempt.evaluation.policy),
  residuals: cloneValue(attempt.evaluation.residuals),
  gateStatus: attempt.evaluation.gate.status,
  gate: cloneValue(attempt.evaluation.gate),
  constraints: cloneValue(attempt.evaluation.constraints),
  certificateStatus: attempt.evaluation.certificate.status,
  certificateHash: attempt.evaluation.certificate.certificateHash,
  certificateId: attempt.evaluation.certificate.certificateId,
  certificateIntegrityOk: attempt.evaluation.certificate.integrityOk,
  certificate: cloneValue(attempt.evaluation.certificate),
  notes: attempt.evaluation.notes
    ? cloneValue(attempt.evaluation.notes)
    : undefined,
  timing: cloneValue(attempt.timing),
  pass: attempt.evaluation.pass,
  accepted: attempt.accepted,
});

export function appendGrAgentLoopRun(
  event: AppendGrAgentLoopRun,
): GrAgentLoopRunRecord {
  const seq = ++loopSequence;
  const patches = Array.isArray(event.patches)
    ? cloneValue(event.patches)
    : buildPatches(event.attempts ?? []);
  const record: GrAgentLoopRunRecord = {
    id: String(seq),
    seq,
    ts: event.ts ?? new Date().toISOString(),
    tenantId: event.tenantId,
    durationMs: event.durationMs,
    accepted: event.accepted,
    acceptedIteration: event.acceptedIteration,
    state: event.state,
    stateHistory: cloneValue(event.stateHistory),
    budget: cloneValue(event.budget),
    options: event.options ? cloneValue(event.options) : undefined,
    attempts: cloneValue(event.attempts),
    patches,
  };
  loopRuns.push(record);
  if (loopRuns.length > MAX_BUFFER_SIZE) {
    loopRuns.splice(0, loopRuns.length - MAX_BUFFER_SIZE);
  }
  persistAuditRecord(record);
  return normalizeRunRecord(record);
}

export function recordGrAgentLoopRun(input: {
  result: GrAgentLoopResult;
  options?: GrAgentLoopOptions;
  durationMs: number;
  tenantId?: string;
}): GrAgentLoopRunRecord {
  const attempts = input.result.attempts.map(toAttemptAudit);
  const record = appendGrAgentLoopRun({
    durationMs: input.durationMs,
    accepted: input.result.accepted,
    acceptedIteration: input.result.acceptedIteration,
    state: input.result.state,
    stateHistory: input.result.stateHistory,
    budget: input.result.budget,
    options: input.options,
    attempts,
    tenantId: input.tenantId,
  });
  try {
    metrics.recordGrAgentLoopRun({
      accepted: record.accepted,
      durationMs: record.durationMs,
      acceptedIteration: record.acceptedIteration,
      ts: record.ts,
      attempts: record.attempts,
    });
  } catch {
    // best-effort only; do not fail the request on metrics errors
  }
  try {
    emitTrainingTraces(record);
  } catch (error) {
    console.warn("[gr-agent-loop] training trace emit failed", error);
  }
  return record;
}

const clampLimit = (value?: number): number => {
  const fallback = 25;
  if (value === undefined || value === null || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(value)), MAX_BUFFER_SIZE);
};

type GetGrAgentLoopRunsOptions = {
  limit?: number;
};

export function getGrAgentLoopRuns(
  options?: GetGrAgentLoopRunsOptions,
): GrAgentLoopRunRecord[] {
  const limit = clampLimit(options?.limit);
  if (AUDIT_PERSIST_ENABLED) {
    const persisted = readPersistedRuns(limit);
    if (persisted.length > 0) {
      return persisted.slice(-limit).reverse();
    }
  }
  if (loopRuns.length === 0) {
    return [];
  }
  const start = Math.max(0, loopRuns.length - limit);
  return loopRuns.slice(start).reverse();
}

export function getGrAgentLoopRunById(
  id: string | undefined,
): GrAgentLoopRunRecord | null {
  if (!id) return null;
  const record = loopRuns.find((entry) => entry.id === id);
  if (record) return record;
  if (AUDIT_PERSIST_ENABLED) {
    const persisted = readPersistedRuns(Number.MAX_SAFE_INTEGER);
    const match = persisted.find((entry) => entry.id === id);
    return match ?? null;
  }
  return null;
}

export function getGrAgentLoopKpis(
  options?: GetGrAgentLoopRunsOptions,
): GrAgentLoopKpiSummary {
  const limit = clampLimit(options?.limit);
  const runs = getGrAgentLoopRuns({ limit });
  const accepted = runs.filter((run) => run.accepted).length;
  const rejected = runs.length - accepted;
  const attempts = runs.flatMap((run) => run.attempts ?? []);
  const violations = attempts.filter(
    (attempt) => attempt.gateStatus !== "pass",
  ).length;
  const successRate = runs.length ? accepted / runs.length : null;
  const constraintViolationRate = attempts.length
    ? violations / attempts.length
    : null;

  const chronological = [...runs].reverse();
  const timeToGreenIntervals: number[] = [];
  let lastRejectedAt: number | null = null;
  for (const run of chronological) {
    const ts = toTimestampMs(run.ts);
    if (ts === null) continue;
    if (run.accepted) {
      if (lastRejectedAt !== null) {
        const delta = ts - lastRejectedAt;
        if (Number.isFinite(delta) && delta >= 0) {
          timeToGreenIntervals.push(delta);
        }
        lastRejectedAt = null;
      }
    } else {
      lastRejectedAt = ts;
    }
  }
  const timeToGreenAvg = average(timeToGreenIntervals);
  const timeToGreenLast = timeToGreenIntervals.length
    ? timeToGreenIntervals[timeToGreenIntervals.length - 1]
    : null;

  const durations = chronological
    .map((run) => run.durationMs)
    .filter(isFiniteNumber);
  const trendWindow = 5;
  const recent = durations.slice(-trendWindow);
  const prior = durations.slice(-2 * trendWindow, -trendWindow);
  const recentAvg = average(recent);
  const priorAvg = average(prior);
  let deltaPct: number | null = null;
  let trend: GrAgentLoopKpiSummary["perfTrend"]["trend"] = "insufficient";
  if (recentAvg !== null && priorAvg !== null && priorAvg > 0) {
    deltaPct = ((recentAvg - priorAvg) / priorAvg) * 100;
    if (deltaPct <= -5) {
      trend = "improving";
    } else if (deltaPct >= 5) {
      trend = "degrading";
    } else {
      trend = "flat";
    }
  }

  return {
    window: {
      limit,
      runs: runs.length,
      attempts: attempts.length,
      accepted,
      rejected,
      violations,
    },
    successRate,
    constraintViolationRate,
    timeToGreenMs: {
      avg: timeToGreenAvg,
      last: timeToGreenLast,
      count: timeToGreenIntervals.length,
    },
    perfTrend: {
      series: durations,
      recentAvgMs: recentAvg,
      priorAvgMs: priorAvg,
      deltaPct,
      trend,
    },
  };
}

export function __resetGrAgentLoopStore(): void {
  loopRuns.length = 0;
}

function resolveAuditLogPath(): string {
  const explicit = process.env.GR_AGENT_LOOP_AUDIT_PATH?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const dir = process.env.GR_AGENT_LOOP_AUDIT_DIR?.trim() || ".cal";
  return path.resolve(process.cwd(), dir, "gr-agent-loop-audit.jsonl");
}

function readPersistedRuns(limit: number): GrAgentLoopRunRecord[] {
  if (!AUDIT_PERSIST_ENABLED) {
    return [];
  }
  if (!fs.existsSync(AUDIT_LOG_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(AUDIT_LOG_PATH, "utf8");
    const lines = raw.split(/\r?\n/);
    const parsed: GrAgentLoopRunRecord[] = [];
    for (const line of lines) {
      const record = parseAuditRecord(line);
      if (record) {
        parsed.push(normalizeRunRecord(record));
      }
    }
    if (parsed.length === 0) {
      return [];
    }
    const capped = Math.max(1, Math.floor(limit));
    return parsed.slice(-capped);
  } catch (error) {
    console.warn("[gr-agent-loop] failed to read audit log", error);
    return [];
  }
}

function loadPersistedRuns(): GrAgentLoopRunRecord[] {
  return readPersistedRuns(MAX_BUFFER_SIZE);
}

function parseAuditRecord(line: string): GrAgentLoopRunRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return isAuditRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAuditRecord(value: any): value is GrAgentLoopRunRecord {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.seq === "number" &&
    Number.isFinite(value.seq) &&
    typeof value.ts === "string" &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    typeof value.accepted === "boolean" &&
    Array.isArray(value.attempts)
  );
}

function persistAuditRecord(record: GrAgentLoopRunRecord): void {
  if (!AUDIT_PERSIST_ENABLED) {
    return;
  }
  const line = JSON.stringify(record);
  persistChain = persistChain
    .then(async () => {
      await fsPromises.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
      await fsPromises.appendFile(AUDIT_LOG_PATH, `${line}\n`, "utf8");
    })
    .catch((error) => {
      console.warn("[gr-agent-loop] failed to persist audit log", error);
    });
}
