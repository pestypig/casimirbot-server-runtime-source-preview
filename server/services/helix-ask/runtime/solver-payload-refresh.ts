import { buildCapabilityLifecycleLedger } from "../capability-lifecycle-ledger";
import { buildCapabilityResultGate, capabilityPlanId } from "../capability-result-gate";
import { buildSolverArtifactReentryAudit } from "../solver-artifact-reentry-audit";
import { buildSolverRetryPolicies } from "../solver-retry-policy";
import { buildSolverSubgoalLedger } from "../solver-subgoal-ledger";
import { refreshToolLifecycleRecords } from "../tool-lifecycle-trace";
import { readVerifiedHelixRuntimeLifecycleFromPayload } from "./turn-lifecycle";

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const readCapabilityPlanPayload = (payload: Record<string, unknown>): Record<string, unknown> | null => {
  const plan = payload.capability_plan;
  return plan && typeof plan === "object" && !Array.isArray(plan) &&
    (plan as Record<string, unknown>).schema === "helix.capability_plan.v1"
    ? (plan as Record<string, unknown>)
    : null;
};

export const collectCapabilityReenteredRefs = (payload: Record<string, unknown>): string[] => {
  const plan = readCapabilityPlanPayload(payload);
  const turnId = readString(plan?.turn_id) ?? readString(payload.turn_id);
  if (turnId) {
    const lifecycle = readVerifiedHelixRuntimeLifecycleFromPayload({ payload, turnId });
    if (lifecycle) return [...lifecycle.reduction.observation_reentry_refs];
  }
  const refs = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) refs.add(value.trim());
  };
  const addArray = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(add);
  };
  const loopTrace = payload.loop_parity_trace && typeof payload.loop_parity_trace === "object"
    ? (payload.loop_parity_trace as Record<string, unknown>)
    : null;
  addArray(loopTrace?.evidence_selected_for_answer);
  const solverTrace = payload.ask_turn_solver_trace && typeof payload.ask_turn_solver_trace === "object"
    ? (payload.ask_turn_solver_trace as Record<string, unknown>)
    : null;
  const evidenceReentryGate = solverTrace?.evidence_reentry_gate && typeof solverTrace.evidence_reentry_gate === "object"
    ? (solverTrace.evidence_reentry_gate as Record<string, unknown>)
    : null;
  addArray(evidenceReentryGate?.selected_evidence_refs);
  add(payload.terminal_artifact_id);
  add(payload.terminal_artifact_kind);
  if (Array.isArray(payload.current_turn_artifact_ledger)) {
    for (const entry of payload.current_turn_artifact_ledger) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const artifact = entry as Record<string, unknown>;
      const kind = readString(artifact.kind);
      if (!kind || !/receipt|tool_evaluation|workstation_tool_evaluation/i.test(kind)) continue;
      add(artifact.artifact_id);
      add(kind);
      const artifactPayload =
        artifact.payload && typeof artifact.payload === "object" && !Array.isArray(artifact.payload)
          ? (artifact.payload as Record<string, unknown>)
          : null;
      add(artifactPayload?.receipt_id);
      add(artifactPayload?.result_id);
      add(artifactPayload?.action_id);
      add(artifactPayload?.action_key);
    }
  }
  return Array.from(refs);
};

export const buildCapabilityAdapterRequestForPayload = (args: {
  payload: Record<string, unknown>;
}): Record<string, unknown> | null => {
  const plan = readCapabilityPlanPayload(args.payload);
  if (!plan) return null;
  const typedPlan = plan as Parameters<typeof buildCapabilityResultGate>[0]["plan"];
  return {
    schema: "helix.capability_adapter_request.v1",
    turn_id: typedPlan.turn_id,
    capability_plan_id: capabilityPlanId(typedPlan),
    capability_family: typedPlan.capability_family,
    requested_action: typedPlan.requested_action,
    selected_capability: typedPlan.selected_capability ?? typedPlan.requested_action,
    phase_repaired: typedPlan.phase_repaired === true,
    phase_violation_reason: typedPlan.phase_violation_reason ?? null,
    phase_constraint: typedPlan.phase_constraint ?? null,
    source_target: typedPlan.source_target,
    goal_kind: typedPlan.goal_kind,
    required_terminal_kind: typedPlan.required_terminal_kind,
    mutating: typedPlan.mutating,
    admission_status: typedPlan.admission_status,
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const refreshCapabilityResultForPayload = (args: {
  payload: Record<string, unknown>;
  terminalArtifactKind: string;
}): void => {
  const plan = readCapabilityPlanPayload(args.payload);
  if (!plan) return;
  const result = buildCapabilityResultGate({
    plan: plan as Parameters<typeof buildCapabilityResultGate>[0]["plan"],
    currentTurnArtifacts: Array.isArray(args.payload.current_turn_artifact_ledger)
      ? args.payload.current_turn_artifact_ledger.filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
        )
      : [],
    terminalArtifactKind: args.terminalArtifactKind,
    terminalArtifactId: readString(args.payload.terminal_artifact_id) ?? args.terminalArtifactKind,
    reenteredRefs: collectCapabilityReenteredRefs(args.payload),
  });
  args.payload.capability_result = result;
  const adapterResult: Record<string, unknown> = {
    schema: "helix.capability_adapter_result.v1",
    turn_id: result.turn_id,
    capability_plan_id: result.capability_plan_id,
    status: result.status,
    receipt_refs: result.receipt_refs,
    evidence_refs: result.evidence_refs,
    selected_for_answer: result.selected_for_answer,
    reentered_solver: result.reentered_solver,
    ...(result.failure_reason ? { failure_reason: result.failure_reason } : {}),
    assistant_answer: false,
    raw_content_included: false,
  };
  args.payload.capability_adapter_result = adapterResult;
  args.payload.adapter_result = adapterResult;
};

export function refreshSolverArtifactReentryAuditForPayload(args: {
  payload: Record<string, unknown>;
  turnId: string;
  terminalArtifactKind: string;
  finalAnswerSource: string;
}): void {
  args.payload.solver_artifact_reentry_audit = buildSolverArtifactReentryAudit({
    turnId: args.turnId,
    payload: args.payload,
    terminalArtifactKind: args.terminalArtifactKind,
    terminalArtifactId: readString(args.payload.terminal_artifact_id) ?? args.terminalArtifactKind,
    finalAnswerSource: args.finalAnswerSource,
  });
}

export function refreshSolverSubgoalLedgerForPayload(args: {
  payload: Record<string, unknown>;
  turnId: string;
  prompt: string;
}): void {
  args.payload.solver_subgoal_ledger = buildSolverSubgoalLedger({
    turnId: args.turnId,
    promptText: args.prompt,
    payload: args.payload,
  });
}

export function refreshSolverRetryPoliciesForPayload(args: {
  payload: Record<string, unknown>;
  turnId: string;
}): void {
  const policies = buildSolverRetryPolicies({
    turnId: args.turnId,
    payload: args.payload,
  });
  args.payload.solver_retry_policies = policies;
  if (policies.length > 0) {
    args.payload.solver_retry_policy = policies[0];
  } else {
    delete args.payload.solver_retry_policy;
  }
}

export function refreshCapabilityLifecycleLedgerForPayload(args: {
  payload: Record<string, unknown>;
  turnId: string;
  terminalArtifactKind: string;
}): void {
  args.payload.capability_lifecycle_ledger = buildCapabilityLifecycleLedger({
    turnId: args.turnId,
    payload: args.payload,
    terminalArtifactKind: args.terminalArtifactKind,
  });
  refreshToolLifecycleRecords({
    payload: args.payload,
    turnId: args.turnId,
  });
}
