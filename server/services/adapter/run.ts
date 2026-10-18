import crypto from "node:crypto";
import type { GrAgentLoopOptions, GrAgentLoopAttempt } from "../../gr/gr-agent-loop.js";
import { runGrAgentLoop } from "../../gr/gr-agent-loop.js";
import { recordGrAgentLoopRun } from "../observability/gr-agent-loop-store.js";
import { getConstraintPackById } from "@shared/constraint-packs";
import type { AdapterAction, AdapterArtifactRef, AdapterRunRequest, ConstraintPackOverride, GrConstraintEntry, TrainingTraceConstraint, TrainingTraceDelta } from "../../../shared/schema.js";
import { buildAuditSafetyMetrics, buildRepoConvergenceMetrics, buildToolUseBudgetMetrics, evaluateConstraintPackFromMetrics, type AuditSafetyTelemetry, type ConstraintPackMetricMap, type RepoConvergenceTelemetry, type ToolUseBudgetTelemetry } from "../observability/constraint-pack-evaluator.js";
import { collectAuditSafetyTelemetry, collectRepoConvergenceTelemetry, collectToolUseBudgetTelemetry, isAutoTelemetryEnabled } from "../observability/constraint-pack-telemetry.js";
import { recordConstraintPackTrace } from "../observability/constraint-pack-normalizer.js";
import { getConstraintPackPolicyProfileById } from "../constraint-packs/constraint-pack-policy-store.js";
import { applyConstraintPackOverrides } from "../constraint-packs/constraint-pack-policy.js";
import { scorePremeditation } from "../premeditation-scorer.js";
import {
  extractIdeologyHardFailFromPremeditationResult,
  toIdeologyHardFailConstraint,
} from "../ideology/action-gates.js";

export type AdapterRunResult = {
  traceId?: string;
  runId: string;
  verdict: "PASS" | "FAIL";
  pass: boolean;
  firstFail?: TrainingTraceConstraint | null;
  deltas: TrainingTraceDelta[];
  certificate?: Record<string, unknown> | null;
  artifacts: AdapterArtifactRef[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
type ParamChange = { key: string; from?: unknown; to?: unknown; delta?: number; change: "added"|"removed"|"changed" };
const normalizeCustomerId = (value?: string): string | undefined => value?.trim() || undefined;
const flattenParams = (value: unknown, prefix = "", map: Map<string, unknown> = new Map()): Map<string, unknown> => {
  if (Array.isArray(value)) { value.forEach((entry, index) => flattenParams(entry, prefix ? `${prefix}[${index}]` : `[${index}]`, map)); return map; }
  if (isPlainObject(value)) { Object.entries(value).forEach(([key, entry]) => flattenParams(entry, prefix ? `${prefix}.${key}` : key, map)); return map; }
  if (prefix) map.set(prefix, value);
  return map;
};
const diffParams = (from?: Record<string, unknown>, to?: Record<string, unknown>): ParamChange[] => {
  const fromMap = flattenParams(from); const toMap = flattenParams(to); const keys = new Set([...fromMap.keys(), ...toMap.keys()]); const changes: ParamChange[] = [];
  keys.forEach((key) => { const hasFrom = fromMap.has(key); const hasTo = toMap.has(key); const fromValue = hasFrom ? fromMap.get(key) : undefined; const toValue = hasTo ? toMap.get(key) : undefined; if (hasFrom && hasTo && Object.is(fromValue, toValue)) return; const change: ParamChange = { key, from: fromValue, to: toValue, change: hasFrom && !hasTo ? "removed" : !hasFrom && hasTo ? "added" : "changed" }; if (typeof fromValue === "number" && typeof toValue === "number") change.delta = toValue - fromValue; changes.push(change); });
  return changes;
};
const toTrainingTraceDeltas = (changes: ParamChange[]): TrainingTraceDelta[] => changes.flatMap((change) => {
  const from = typeof change.from === "number" ? change.from : null; const to = typeof change.to === "number" ? change.to : null; const delta = typeof change.delta === "number" ? change.delta : undefined;
  if (from === null && to === null && delta === undefined) return [];
  return [{ key: change.key, from, to, delta, change: change.change }];
});
const toTrainingTraceConstraint = (constraint: GrConstraintEntry): TrainingTraceConstraint => ({ id: constraint.id, severity: constraint.severity, status: constraint.status, value: constraint.value ?? null, limit: constraint.limit ?? null, note: constraint.note });
const findFirstFailingHardConstraint = (constraints?: GrConstraintEntry[]): TrainingTraceConstraint | undefined => constraints?.find((entry) => entry.severity === "HARD" && entry.status !== "pass") ? toTrainingTraceConstraint(constraints.find((entry) => entry.severity === "HARD" && entry.status !== "pass") as GrConstraintEntry) : undefined;
type CanonicalFirstFailClass = "constraint" | "certificate_integrity" | "certificate_status" | "certificate_missing";
const normalizeFirstFail = (input: { verdict: "PASS" | "FAIL"; firstFail?: TrainingTraceConstraint | null; certificate?: Record<string, unknown> | null; fallbackId: string; fallbackNote: string; }): TrainingTraceConstraint | null => {
  if (input.verdict === "PASS") return input.firstFail ?? null;
  if (input.firstFail) return input.firstFail;
  const certificate = input.certificate ?? undefined;
  const certificateHash = typeof certificate?.certificateHash === "string" ? certificate.certificateHash.trim() : "";
  const integrityOk = certificate?.integrityOk;
  const certificateStatus = typeof certificate?.status === "string" ? certificate.status.trim() : "";
  const canonicalClass: CanonicalFirstFailClass = integrityOk === false
    ? "certificate_integrity"
    : !certificateHash
      ? "certificate_missing"
      : certificateStatus && certificateStatus !== "FAIL"
        ? "certificate_status"
        : "constraint";
  const id = canonicalClass === "certificate_integrity"
    ? "ADAPTER_CERTIFICATE_INTEGRITY"
    : canonicalClass === "certificate_missing"
      ? "ADAPTER_CERTIFICATE_MISSING"
      : canonicalClass === "certificate_status"
        ? `ADAPTER_CERTIFICATE_STATUS_${certificateStatus.toUpperCase()}`
        : input.fallbackId;
  const baseNote = canonicalClass === "constraint" ? input.fallbackNote : "certificate_policy_failed";
  return { id, severity: "HARD", status: "fail", value: null, limit: null, note: `class=${canonicalClass},${baseNote}` };
};
const hasAnyTelemetry = (telemetry?: Record<string, unknown>): boolean => !!telemetry && Object.keys(telemetry).length > 0;
const mergeMetricOverrides = (target: ConstraintPackMetricMap, overrides?: ConstraintPackMetricMap) => { if (!overrides) return; for (const [key, value] of Object.entries(overrides)) if (value !== undefined) target[key] = value; };
const hasPolicyOverridePayload = (override: ConstraintPackOverride | undefined): boolean => !!override && (override.policy !== undefined || override.certificate !== undefined || (override.constraints?.length ?? 0) > 0 || (override.proxies?.length ?? 0) > 0);
const resolveAutoTelemetry = (input: { autoTelemetry?: boolean; telemetryPath?: string; junitPath?: string; vitestPath?: string; jestPath?: string; eslintPath?: string; tscPath?: string; toolLogTraceId?: string; toolLogWindowMs?: number; toolLogLimit?: number; }): boolean => {
  const hasAutoHint = !!(input.telemetryPath || input.junitPath || input.vitestPath || input.jestPath || input.eslintPath || input.tscPath || input.toolLogTraceId || input.toolLogWindowMs || input.toolLogLimit);
  if (input.autoTelemetry === true) return true; if (input.autoTelemetry === false) return hasAutoHint; if (hasAutoHint) return true; return isAutoTelemetryEnabled();
};
const resolveTerminalAttempt = (attempts: GrAgentLoopAttempt[], acceptedIteration?: number): GrAgentLoopAttempt | undefined => acceptedIteration !== undefined ? attempts.find((attempt) => attempt.iteration === acceptedIteration) ?? attempts[attempts.length - 1] : attempts[attempts.length - 1];
const buildActionProposals = (actions?: AdapterAction[]) => actions?.map((action, index) => ({ label: action.label ?? action.id ?? action.kind ?? `action-${index + 1}`, params: action.params ?? {} }));
const buildArtifactRefs = (input: { runId: string; certificateHash?: string | null; certificateId?: string | null; }): AdapterArtifactRef[] => [{ kind: "gr-agent-loop-run", ref: input.runId }, { kind: "gr-agent-loop-run-url", ref: `/api/helix/gr-agent-loop/${input.runId}` }, { kind: "training-trace-export", ref: "/api/agi/training-trace/export" }, ...(input.certificateHash ? [{ kind: "warp-certificate-hash", ref: input.certificateHash }] : []), ...(input.certificateId ? [{ kind: "warp-certificate-id", ref: input.certificateId }] : [])];

const applyVerifyPolicyToOutcome = (input: {
  policyMode?: "strict" | "permissive";
  verdict: "PASS" | "FAIL";
  pass: boolean;
  firstFail?: TrainingTraceConstraint | null;
  certificate?: Record<string, unknown> | null;
}): {
  verdict: "PASS" | "FAIL";
  pass: boolean;
  firstFail?: TrainingTraceConstraint | null;
} => {
  if (input.policyMode !== "strict") return { verdict: input.verdict, pass: input.pass, firstFail: input.firstFail ?? null };
  const certificate = input.certificate ?? null;
  const certificateHash = typeof certificate?.certificateHash === "string" ? certificate.certificateHash.trim() : "";
  if (input.verdict === "PASS" && (!certificateHash || certificate?.integrityOk !== true)) {
    const firstFail = normalizeFirstFail({
      verdict: "FAIL",
      firstFail: input.firstFail ?? null,
      certificate,
      fallbackId: "ADAPTER_CONSTRAINT_FAIL",
      fallbackNote: "verify_policy_strict_fail_closed",
    });
    return { verdict: "FAIL", pass: false, firstFail };
  }
  return { verdict: input.verdict, pass: input.pass, firstFail: input.firstFail ?? null };
};

const buildConstraintPackArtifacts = (input: { packId: string; traceId: string; certificateHash?: string | null; certificateId?: string | null; }): AdapterArtifactRef[] => [{ kind: "constraint-pack", ref: input.packId }, { kind: "training-trace-id", ref: input.traceId }, { kind: "training-trace-url", ref: `/api/agi/training-trace/${input.traceId}` }, { kind: "training-trace-export", ref: "/api/agi/training-trace/export" }, ...(input.certificateHash ? [{ kind: "constraint-pack-certificate-hash", ref: input.certificateHash }] : []), ...(input.certificateId ? [{ kind: "constraint-pack-certificate-id", ref: input.certificateId }] : [])];

export async function runAdapterExecution(parsed: AdapterRunRequest, opts?: { tenantId?: string }): Promise<AdapterRunResult> {
  const { actions, budget, policy, pack, mode } = parsed;
  const traceId = parsed.traceId ?? `adapter:${crypto.randomUUID()}`;
  const premeditationResult = parsed.premeditation
    ? scorePremeditation(parsed.premeditation)
    : undefined;
  const ideologyHardFail = extractIdeologyHardFailFromPremeditationResult(
    premeditationResult,
  );
  if (ideologyHardFail) {
    return {
      traceId,
      runId: `ideology-veto:${crypto.randomUUID()}`,
      verdict: "FAIL",
      pass: false,
      firstFail: toIdeologyHardFailConstraint(ideologyHardFail),
      deltas: [],
      certificate: null,
      artifacts: [{ kind: "training-trace-export", ref: "/api/agi/training-trace/export" }],
    };
  }
  if (mode === "constraint-pack" || pack) {
    if (!pack) throw new Error("adapter-pack-missing");
    const resolvedPack = getConstraintPackById(pack.id); if (!resolvedPack) throw new Error("constraint-pack-not-found");
    const requestedCustomerId = normalizeCustomerId(pack.customerId);
    if (opts?.tenantId && requestedCustomerId && opts.tenantId !== requestedCustomerId) throw new Error("tenant-mismatch");
    const policyNotes: string[] = []; const overrides: ConstraintPackOverride[] = []; let effectiveTenantId = opts?.tenantId ?? requestedCustomerId;
    if (pack.policyProfileId) { const profile = getConstraintPackPolicyProfileById(pack.policyProfileId); if (!profile) throw new Error("policy-profile-not-found"); if (!effectiveTenantId) effectiveTenantId = profile.customerId; const packOverride = profile.packs.find((entry) => entry.packId === resolvedPack.id); if (packOverride) { overrides.push(packOverride); policyNotes.push(`policy_profile=${profile.id}`); } }
    if (pack.policyOverride) { const inlineOverride = { ...pack.policyOverride, packId: resolvedPack.id }; if (hasPolicyOverridePayload(inlineOverride)) overrides.push(inlineOverride); }
    let effectivePack = resolvedPack;
    if (overrides.length) effectivePack = applyConstraintPackOverrides(effectivePack, overrides).pack;
    const shouldAutoTelemetry = effectivePack.id === "provenance-safety" ? pack.autoTelemetry !== false : resolveAutoTelemetry({ autoTelemetry: pack.autoTelemetry, telemetryPath: pack.telemetryPath, junitPath: pack.junitPath, vitestPath: pack.vitestPath, jestPath: pack.jestPath, eslintPath: pack.eslintPath, tscPath: pack.tscPath, toolLogTraceId: pack.toolLogTraceId, toolLogWindowMs: pack.toolLogWindowMs, toolLogLimit: pack.toolLogLimit });
    let telemetry = pack.telemetry;
    if (shouldAutoTelemetry) {
      if (effectivePack.id === "repo-convergence") telemetry = (await collectRepoConvergenceTelemetry({ autoTelemetry: true, explicit: telemetry as RepoConvergenceTelemetry, telemetryPath: pack.telemetryPath, junitPath: pack.junitPath, vitestPath: pack.vitestPath, jestPath: pack.jestPath, eslintPath: pack.eslintPath, tscPath: pack.tscPath })).telemetry;
      else if (effectivePack.id === "tool-use-budget") telemetry = (await collectToolUseBudgetTelemetry({ explicit: telemetry as ToolUseBudgetTelemetry, telemetryPath: pack.telemetryPath, toolLogTraceId: pack.toolLogTraceId, toolLogWindowMs: pack.toolLogWindowMs, toolLogLimit: pack.toolLogLimit })).telemetry;
      else if (effectivePack.id === "provenance-safety") telemetry = (await collectAuditSafetyTelemetry({ autoTelemetry: true, explicit: telemetry as AuditSafetyTelemetry, telemetryPath: pack.telemetryPath })).telemetry;
    }
    if (!hasAnyTelemetry(telemetry) && !hasAnyTelemetry(pack.metrics)) throw new Error("constraint-pack-telemetry-missing");
    const metrics = effectivePack.id === "repo-convergence" ? buildRepoConvergenceMetrics(telemetry as RepoConvergenceTelemetry) : effectivePack.id === "tool-use-budget" ? buildToolUseBudgetMetrics(telemetry as ToolUseBudgetTelemetry) : buildAuditSafetyMetrics(telemetry as AuditSafetyTelemetry);
    mergeMetricOverrides(metrics, pack.metrics);
    const evaluation = evaluateConstraintPackFromMetrics(effectivePack, metrics, { certificate: pack.certificate, deltas: pack.deltas, notes: [...(pack.notes ?? []), ...policyNotes], proxy: pack.proxy, ladderTier: pack.ladderTier });
    const trace = recordConstraintPackTrace({ traceId, tenantId: effectiveTenantId, pack: effectivePack, evaluation, metrics, source: { system: "constraint-pack", component: "adapter", tool: effectivePack.id, version: String(effectivePack.version) } });
    const verdict = trace.pass ? "PASS" : "FAIL";
    const certificate = evaluation.certificate ?? null;
    const verifyOutcome = applyVerifyPolicyToOutcome({
      policyMode: policy?.verify?.mode,
      verdict,
      pass: trace.pass,
      firstFail: trace.firstFail ?? null,
      certificate,
    });
    return { traceId, runId: trace.id, verdict: verifyOutcome.verdict, pass: verifyOutcome.pass, firstFail: normalizeFirstFail({ verdict: verifyOutcome.verdict, firstFail: verifyOutcome.firstFail ?? null, certificate, fallbackId: "ADAPTER_CONSTRAINT_FAIL", fallbackNote: "constraint_pack_failed" }), deltas: trace.deltas, certificate, artifacts: buildConstraintPackArtifacts({ packId: effectivePack.id, traceId: trace.id, certificateHash: evaluation.certificate?.certificateHash ?? null, certificateId: evaluation.certificate?.certificateId ?? null }) };
  }
  const proposals = buildActionProposals(actions);
  const proposalCount = proposals?.length ?? 0;
  const options: GrAgentLoopOptions = { ...(proposals ? { proposals } : {}), ...(budget?.maxIterations !== undefined || proposalCount > 0 ? { maxIterations: budget?.maxIterations ?? Math.min(proposalCount, 50) } : {}), ...(budget?.maxAttemptMs !== undefined || budget?.maxTotalMs !== undefined ? { budget: { maxAttemptMs: budget.maxAttemptMs, maxTotalMs: budget.maxTotalMs } } : {}), ...(policy?.thresholds ? { thresholds: policy.thresholds } : {}), ...(policy?.gate ? { policy: policy.gate } : {}) };
  const result = await runGrAgentLoop(options);
  const run = recordGrAgentLoopRun({ result, options, durationMs: 0, tenantId: opts?.tenantId });
  const terminalAttempt = resolveTerminalAttempt(result.attempts, result.acceptedIteration);
  const firstFail = terminalAttempt ? findFirstFailingHardConstraint(terminalAttempt.evaluation.constraints) : undefined;
  const baselineParams = result.attempts.length > 0 ? result.attempts[0].proposal.params : undefined;
  const terminalParams = terminalAttempt?.proposal.params;
  const verdict = result.accepted ? "PASS" : "FAIL";
  const certificate = terminalAttempt?.evaluation.certificate ?? null;
  const verifyOutcome = applyVerifyPolicyToOutcome({
    policyMode: policy?.verify?.mode,
    verdict,
    pass: result.accepted,
    firstFail: firstFail ?? null,
    certificate,
  });
  return { traceId, runId: run.id, verdict: verifyOutcome.verdict, pass: verifyOutcome.pass, firstFail: normalizeFirstFail({ verdict: verifyOutcome.verdict, firstFail: verifyOutcome.firstFail ?? null, certificate, fallbackId: "ADAPTER_CONSTRAINT_FAIL", fallbackNote: "hard_constraint_failed_or_unavailable" }), deltas: toTrainingTraceDeltas(diffParams(baselineParams as Record<string, unknown> | undefined, terminalParams as Record<string, unknown> | undefined)), certificate, artifacts: buildArtifactRefs({ runId: run.id, certificateHash: terminalAttempt?.evaluation.certificate?.certificateHash, certificateId: terminalAttempt?.evaluation.certificate?.certificateId }) };
}
