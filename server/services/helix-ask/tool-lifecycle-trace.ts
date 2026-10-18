import {
  HELIX_TOOL_FOLLOWUP_DECISION_SCHEMA,
  HELIX_TOOL_LIFECYCLE_TRACE_SCHEMA,
  type HelixToolFollowupDecision,
  type HelixToolLifecycleStage,
  type HelixToolLifecycleStatus,
  type HelixToolLifecycleTrace,
  type HelixToolRetryRecommendation,
} from "@shared/helix-tool-lifecycle";
import {
  inferToolFamilyFromToolName,
  resolveToolFamilyContract,
  type ToolFamilyContract,
} from "./tool-family-contract";
import { resolveHelixRuntimeObservationReentry } from "./runtime/turn-lifecycle";
import { reconcileAuthoritativeTypedFailureLifecycle } from "./runtime/typed-failure-lifecycle-reconciliation";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readBoolean = (value: unknown): boolean => value === true;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const unique = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const gatewayCallResultsFrom = (payload: RecordLike): RecordLike[] => {
  const debug = readRecord(payload.debug);
  return [
    ...(Array.isArray(payload.workstation_gateway_call_results) ? payload.workstation_gateway_call_results : []),
    ...(Array.isArray(debug?.workstation_gateway_call_results) ? debug.workstation_gateway_call_results : []),
  ]
    .map((entry: unknown) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry));
};

const latestGatewayLifecycleRecords = (input: {
  turnId: string;
  payload: RecordLike;
}): { trace: HelixToolLifecycleTrace; followup: HelixToolFollowupDecision } | null => {
  for (const result of [...gatewayCallResultsFrom(input.payload)].reverse()) {
    const trace = readRecord(result.tool_lifecycle_trace);
    const followup = readRecord(result.tool_followup_decision);
    if (
      readString(trace?.schema) !== HELIX_TOOL_LIFECYCLE_TRACE_SCHEMA ||
      readString(followup?.schema) !== HELIX_TOOL_FOLLOWUP_DECISION_SCHEMA
    ) {
      continue;
    }
    if (readString(trace?.tool_family) !== "workstation_tool_gateway") continue;
    const gatewayTrace = trace as HelixToolLifecycleTrace;
    const gatewayFollowup = followup as HelixToolFollowupDecision;
    const normalizedTrace = {
      ...gatewayTrace,
      turn_id: input.turnId,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    };
    const normalizedFollowup = {
      ...gatewayFollowup,
      turn_id: input.turnId,
      next_action: gatewayFollowup.next_action === "terminal_answer" ? "continue_reasoning" : gatewayFollowup.next_action,
      terminal_blockers: unique([
        ...readStringArray(gatewayFollowup.terminal_blockers),
        "post_tool_model_step_required",
        "terminal_authority_not_evaluated",
      ]),
      evidence_reentered: false,
      assistant_answer: false,
      raw_content_included: false,
    };
    return {
      trace: normalizedTrace,
      followup: normalizedFollowup,
    };
  }
  return null;
};

const artifactLedger = (payload: RecordLike): RecordLike[] =>
  Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
        .map((entry: unknown) => readRecord(entry))
        .filter((entry): entry is RecordLike => Boolean(entry))
    : [];

const artifactPayload = (artifact: RecordLike): RecordLike | null => readRecord(artifact.payload);

const capabilityFromPlan = (plan: RecordLike | null): string | null => {
  const family = readString(plan?.capability_family);
  const action = readString(plan?.requested_action);
  if (!family && !action) return null;
  if (action && /\./.test(action)) return action;
  return unique([family, action]).join(":") || null;
};

const toolFamilyFromCapability = (capability: string | null): string => {
  if (!capability) return "none";
  const registeredFamily = inferToolFamilyFromToolName(capability);
  if (registeredFamily) return registeredFamily;
  const normalized = capability.toLowerCase();
  if (/workspace[_-]?os|workspace_diagnostic/.test(normalized)) return "workspace_diagnostic";
  if (/calculator|scientific-calculator/.test(normalized)) return "calculator";
  if (/chrome|browser|visual|live_source|live-environment|situation/.test(normalized)) return "live_source";
  if (/docs|document/.test(normalized)) return "docs";
  if (/workstation|workspace|panel/.test(normalized)) return "workstation_action";
  if (/repo|code/.test(normalized)) return "repo_evidence";
  if (/debug|adapter|api/.test(normalized)) return "debug_export";
  if (/voice|announcement|callout/.test(normalized)) return "voice_output";
  return normalized.split(/[.:_-]/)[0] || "unknown";
};

const modelCapability = (decision: RecordLike | null): string | null =>
  readString(readRecord(decision?.model_decision)?.chosen_capability) ||
  readString(decision?.chosen_capability) ||
  null;

const lastRuntimeCapability = (payload: RecordLike): string | null => {
  const loop = readRecord(payload.agent_runtime_loop);
  const iterations = Array.isArray(loop?.iterations) ? loop.iterations.map(readRecord).filter(Boolean) : [];
  for (const iteration of [...iterations].reverse()) {
    const executed = readString(iteration?.executed_action_key);
    if (executed) return executed;
  }
  return readString(readRecord(payload.runtime_tool_call)?.capability_key) || null;
};

const actualToolCallRefs = (payload: RecordLike): string[] => {
  const loopTrace = readRecord(payload.loop_parity_trace);
  const calls = Array.isArray(loopTrace?.actual_tool_calls) ? loopTrace.actual_tool_calls : [];
  return unique(
    calls
      .map((entry: unknown) => readRecord(entry))
      .filter((entry): entry is RecordLike => Boolean(entry))
      .flatMap((entry) => [
        readString(entry.tool_call_id),
        readString(entry.call_id),
        readString(entry.action_id),
        readString(entry.tool_name),
        readString(entry.name),
      ]),
  );
};

const artifactRefsFor = (payload: RecordLike, matcher: (artifact: RecordLike) => boolean): string[] =>
  unique(
    artifactLedger(payload)
      .filter(matcher)
      .flatMap((artifact) => [
        readString(artifact.artifact_id),
        readString(artifact.id),
        readString(artifact.ref),
        readString(artifact.kind),
      ]),
  );

const observationRefs = (payload: RecordLike): string[] =>
  artifactRefsFor(payload, (artifact) =>
    /observation|evaluation|validation|result|analysis/i.test(
      [readString(artifact.kind), readString(artifact.schema), readString(artifactPayload(artifact)?.schema)].join(" "),
    ),
  );

const receiptRefs = (payload: RecordLike, result: RecordLike | null): string[] =>
  unique([
    ...readStringArray(result?.receipt_refs),
    ...artifactRefsFor(payload, (artifact) =>
      /receipt|tool_evaluation|workstation_tool_evaluation/i.test(
        [readString(artifact.kind), readString(artifact.schema), readString(artifactPayload(artifact)?.schema)].join(" "),
      ),
    ),
    ...["workspace_action_receipt", "doc_open_receipt", "live_pipeline_turn_receipt", "live_source_pipeline_receipt"]
      .flatMap((key) => {
        const receipt = readRecord(payload[key]);
        return receipt ? [key, readString(receipt.receipt_id), readString(receipt.action_id)] : [];
      }),
  ]);

const evidenceRefs = (payload: RecordLike, result: RecordLike | null, operationalEvaluation: RecordLike | null): string[] =>
  unique([
    ...readStringArray(result?.evidence_refs),
    ...readStringArray(operationalEvaluation?.evidence_refs),
    ...artifactRefsFor(payload, (artifact) =>
      /evidence|observation|receipt|validation|result/i.test(
        [readString(artifact.kind), readString(artifact.schema), readString(artifactPayload(artifact)?.schema)].join(" "),
      ),
    ),
  ]);

const findRefs = (payload: RecordLike): { sessionRef: string | null; processRef: string | null } => {
  const runtime = readRecord(payload.runtime_tool_call);
  const pending = readRecord(payload.pending_server_request) ?? readRecord(payload.pending_request);
  const adapterRequest = readRecord(payload.capability_adapter_request) ?? readRecord(payload.adapter_request);
  const adapterResult = readRecord(payload.capability_adapter_result) ?? readRecord(payload.adapter_result);
  return {
    sessionRef:
      readString(runtime?.session_id) ||
      readString(pending?.session_id) ||
      readString(adapterRequest?.session_id) ||
      readString(adapterResult?.session_id) ||
      null,
    processRef:
      readString(runtime?.process_id) ||
      readString(runtime?.pid) ||
      readString(pending?.process_id) ||
      readString(pending?.pid) ||
      readString(adapterRequest?.process_id) ||
      readString(adapterResult?.process_id) ||
      null,
  };
};

const hasPendingToolWork = (payload: RecordLike): boolean => {
  if (readRecord(payload.pending_server_request) || readRecord(payload.pending_request)) return true;
  const runtime = readRecord(payload.runtime_tool_call);
  const adapterResult = readRecord(payload.capability_adapter_result) ?? readRecord(payload.adapter_result);
  const statusText = [
    readString(runtime?.status),
    readString(adapterResult?.status),
    readString(adapterResult?.state),
  ].join(" ");
  return /\b(?:pending|running|started|in_progress|polling)\b/i.test(statusText);
};

const runtimeLoopHasCompletedToolObservation = (payload: RecordLike): boolean => {
  const loop = readRecord(payload.agent_runtime_loop);
  const iterations = Array.isArray(loop?.iterations) ? loop.iterations.map(readRecord).filter(Boolean) : [];
  return iterations.some((iteration) => {
    const observation = readRecord(iteration?.tool_observation);
    return (
      readString(observation?.status) === "completed" ||
      readString(iteration?.stop_reason) === "answer" ||
      (readString(iteration?.next_step) === "answer" && readString(iteration?.chosen_capability))
    );
  });
};

const hasCompletedToolEvidence = (payload: RecordLike, executedCapability: string | null): boolean => {
  if (!executedCapability) return false;
  if (readRecord(payload.workstation_tool_evaluation)) return true;
  if (runtimeLoopHasCompletedToolObservation(payload)) return true;
  return artifactLedger(payload).some((artifact) => {
    const kind = readString(artifact.kind);
    const payloadRecord = artifactPayload(artifact);
    const schema = readString(payloadRecord?.schema);
    const payloadKind = readString(payloadRecord?.kind);
    return /tool_result|tool_receipt|tool_evaluation|workstation_tool_evaluation|receipt|evaluation/i.test(
      [kind, schema, payloadKind].filter(Boolean).join(" "),
    );
  });
};

const isExternalChangeFailure = (failureReason: string | null): boolean =>
  Boolean(failureReason && /\b(?:server|backend|port|listener|connection|connect|fetch|econnrefused|timeout|timed out|unavailable|exited|stale process|restart)\b/i.test(failureReason));

const isAlternateProbeFailure = (failureReason: string | null): boolean =>
  Boolean(failureReason && /\b(?:wrong endpoint|direct post|shape|adapter probe|locator|auto-wait|navigation|dom-only|fallback|diagnostic)\b/i.test(failureReason));

const lifecycleFromPayload = (input: {
  payload: RecordLike;
  plan: RecordLike | null;
  result: RecordLike | null;
  executedCapability: string | null;
  failureReason: string | null;
  reentryObserved: boolean;
}): { stage: HelixToolLifecycleStage; status: HelixToolLifecycleStatus } => {
  const admissionStatus = readString(input.plan?.admission_status);
  const resultStatus = readString(input.result?.status);
  if (hasPendingToolWork(input.payload)) return { stage: "polling", status: "running" };
  if (admissionStatus === "rejected" || admissionStatus === "needs_user_confirmation") {
    return { stage: "blocked", status: "blocked" };
  }
  if (resultStatus === "failed") return { stage: "failed", status: "failed" };
  if (input.failureReason && isExternalChangeFailure(input.failureReason)) return { stage: "failed", status: "failed" };
  if (input.reentryObserved) return { stage: "reentered_solver", status: "completed" };
  if (resultStatus === "succeeded" || resultStatus === "partial" || resultStatus === "not_run") {
    return { stage: "completed", status: resultStatus === "not_run" ? "blocked" : "completed" };
  }
  if (input.executedCapability || actualToolCallRefs(input.payload).length > 0) return { stage: "started", status: "unknown" };
  if (readString(input.plan?.admission_status) === "admitted" || readString(input.plan?.admission_status) === "needs_evidence") {
    return { stage: "admitted", status: "not_started" };
  }
  return { stage: "proposed", status: input.plan ? "not_started" : "unknown" };
};

const terminalEligible = (input: {
  stage: HelixToolLifecycleStage;
  status: HelixToolLifecycleStatus;
  result: RecordLike | null;
  operationalEvaluation: RecordLike | null;
  lifecycleLedger: RecordLike | null;
  contract: ToolFamilyContract | null;
}): boolean => {
  if (input.status === "running" || input.status === "failed" || input.status === "blocked") return false;
  if (input.contract?.requiredReentry && input.stage !== "reentered_solver") return false;
  if (input.stage !== "reentered_solver" && input.result) return false;
  if (readString(input.operationalEvaluation?.next_decision) && readString(input.operationalEvaluation?.next_decision) !== "allow_terminal") {
    return false;
  }
  if (input.lifecycleLedger && input.lifecycleLedger.ok !== true) return false;
  return input.stage === "reentered_solver" || (!input.result && input.contract?.requiredReentry !== true);
};

const retryRecommendation = (input: {
  stage: HelixToolLifecycleStage;
  status: HelixToolLifecycleStatus;
  failureReason: string | null;
  terminalEligible: boolean;
  plan: RecordLike | null;
  operationalEvaluation: RecordLike | null;
}): HelixToolRetryRecommendation => {
  if (input.status === "running") return "poll_same_tool";
  if (input.terminalEligible) return "allow_terminal";
  const admissionStatus = readString(input.plan?.admission_status);
  if (admissionStatus === "needs_user_confirmation") return "ask_user";
  if (isExternalChangeFailure(input.failureReason)) return "stop_external_change_required";
  if (isAlternateProbeFailure(input.failureReason)) return "try_alternate_probe";
  if (
    readString(input.operationalEvaluation?.remaining_surface_blocker) ||
    (readBoolean(input.operationalEvaluation?.fallback_used) && !readBoolean(input.operationalEvaluation?.fallback_equivalent))
  ) {
    return "try_alternate_probe";
  }
  if (admissionStatus === "rejected") return "retry_same_tool";
  if (input.status === "failed") return "retry_same_tool";
  return input.stage === "started" || input.stage === "admitted" ? "retry_same_tool" : "try_alternate_probe";
};

export const buildToolLifecycleTrace = (input: {
  turnId: string;
  payload: RecordLike;
}): HelixToolLifecycleTrace => {
  const plan = readRecord(input.payload.capability_plan);
  const result = readRecord(input.payload.capability_result);
  const admission = readRecord(input.payload.tool_call_admission_decision);
  const operationalTrace = readRecord(input.payload.operational_capability_trace);
  const operationalEvaluation = readRecord(input.payload.operational_satisfaction_evaluation);
  const lifecycleLedger = readRecord(input.payload.capability_lifecycle_ledger);
  const decision = readRecord(input.payload.agent_step_decision) ?? readRecord(input.payload.initial_agent_step_decision);
  const requestedCapability =
    readString(admission?.requested_capability) ||
    readString(plan?.requested_capability) ||
    readString(operationalTrace?.model_proposed_capability) ||
    modelCapability(decision) ||
    capabilityFromPlan(plan);
  const admittedCapability =
    readString(admission?.admitted_capability) ||
    readString(admission?.selected_capability) ||
    readString(operationalTrace?.policy_admitted_capability) ||
    readStringArray(admission?.admitted_tool_families)[0] ||
    (readString(plan?.admission_status) === "admitted" || readString(plan?.admission_status) === "needs_evidence"
      ? capabilityFromPlan(plan)
      : null);
  const executedCapability =
    readString(operationalTrace?.executed_capability) ||
    lastRuntimeCapability(input.payload);
  const failureReason =
    readString(result?.failure_reason) ||
    readString(plan?.rejection_reason) ||
    readString(plan?.suppression_reason) ||
    readString(readRecord(input.payload.adapter_result)?.failure_reason) ||
    readString(readRecord(input.payload.capability_adapter_result)?.failure_reason) ||
    null;
  const toolObservationRefs = observationRefs(input.payload);
  const toolReceiptRefs = receiptRefs(input.payload, result);
  const toolEvidenceRefs = evidenceRefs(input.payload, result, operationalEvaluation);
  const reentry = resolveHelixRuntimeObservationReentry({
    payload: input.payload,
    turnId: input.turnId,
    candidateRefs: unique([...toolObservationRefs, ...toolReceiptRefs, ...toolEvidenceRefs]),
    compatibilityProjected:
      readBoolean(result?.reentered_solver) ||
      hasCompletedToolEvidence(input.payload, executedCapability),
  });
  const lifecycle = lifecycleFromPayload({
    payload: input.payload,
    plan,
    result,
    executedCapability,
    failureReason,
    reentryObserved: reentry.reentered,
  });
  const familyContract = resolveToolFamilyContract({
    toolName: executedCapability ?? admittedCapability ?? requestedCapability ?? readString(plan?.requested_action),
    toolFamily: readString(plan?.capability_family) || readStringArray(admission?.admitted_tool_families)[0],
  });
  const eligible = terminalEligible({
    stage: lifecycle.stage,
    status: lifecycle.status,
    result,
    operationalEvaluation,
    lifecycleLedger,
    contract: familyContract,
  });
  const recommendation = retryRecommendation({
    stage: lifecycle.stage,
    status: lifecycle.status,
    failureReason,
    terminalEligible: eligible,
    plan,
    operationalEvaluation,
  });
  const refs = findRefs(input.payload);
  const planId = readString(plan?.plan_id) || readString(lifecycleLedger?.capability_plan_id) || `${input.turnId}:tool_lifecycle_trace`;

  return {
    schema: HELIX_TOOL_LIFECYCLE_TRACE_SCHEMA,
    turn_id: input.turnId,
    tool_call_id: readString(readRecord(input.payload.runtime_tool_call)?.tool_call_id) || readString(result?.capability_plan_id) || planId,
    tool_family:
      readString(plan?.capability_family) ||
      toolFamilyFromCapability(executedCapability ?? admittedCapability ?? requestedCapability),
    requested_capability: requestedCapability,
    admitted_capability: admittedCapability,
    executed_capability: executedCapability,
    lifecycle_stage: lifecycle.stage,
    status: lifecycle.status,
    session_ref: refs.sessionRef,
    process_ref: refs.processRef,
    observation_refs: toolObservationRefs,
    receipt_refs: toolReceiptRefs,
    evidence_refs: toolEvidenceRefs,
    reentry_authority: reentry.authority,
    runtime_lifecycle_verified: reentry.runtime_lifecycle_verified,
    matched_reentry_refs: reentry.matched_reentry_refs,
    failure_reason: failureReason,
    retry_recommendation: recommendation,
    fallback_used: readBoolean(operationalEvaluation?.fallback_used),
    fallback_equivalent: readBoolean(operationalEvaluation?.fallback_equivalent),
    terminal_eligible: eligible,
    assistant_answer: false,
    raw_content_included: false,
  };
};

const nextActionForTrace = (trace: HelixToolLifecycleTrace): HelixToolFollowupDecision["next_action"] => {
  if (trace.retry_recommendation === "poll_same_tool") return "poll";
  if (trace.retry_recommendation === "retry_same_tool") return trace.status === "blocked" ? "continue_reasoning" : "retry";
  if (trace.retry_recommendation === "try_alternate_probe") return "alternate_probe";
  if (trace.retry_recommendation === "ask_user") return "ask_user";
  if (trace.retry_recommendation === "stop_external_change_required") return "terminal_failure";
  if (trace.retry_recommendation === "allow_terminal") return trace.terminal_eligible ? "terminal_answer" : "continue_reasoning";
  return "continue_reasoning";
};

export const buildToolFollowupDecision = (input: {
  turnId: string;
  payload: RecordLike;
  trace?: HelixToolLifecycleTrace;
}): HelixToolFollowupDecision => {
  const trace = input.trace ?? buildToolLifecycleTrace(input);
  const operationalEvaluation = readRecord(input.payload.operational_satisfaction_evaluation);
  const lifecycleLedger = readRecord(input.payload.capability_lifecycle_ledger);
  const terminalBlockers = unique([
    ...readStringArray(lifecycleLedger?.failure_codes),
    readString(operationalEvaluation?.remaining_surface_blocker),
    trace.terminal_eligible ? "" : trace.failure_reason ?? "",
    trace.status === "running" ? "tool_still_running" : "",
  ]);
  const nextAction = nextActionForTrace(trace);
  const observationCount = trace.observation_refs.length + trace.receipt_refs.length + trace.evidence_refs.length;

  return {
    schema: HELIX_TOOL_FOLLOWUP_DECISION_SCHEMA,
    turn_id: input.turnId,
    prior_tool_trace_ref: `${input.turnId}:tool_lifecycle_trace`,
    observation_summary:
      observationCount > 0
        ? `tool_observations:${observationCount}; status:${trace.status}; stage:${trace.lifecycle_stage}`
        : `no_tool_observation; status:${trace.status}; stage:${trace.lifecycle_stage}`,
    next_action: nextAction,
    reason:
      nextAction === "poll"
        ? "tool_runtime_still_pending"
        : nextAction === "terminal_answer"
          ? "tool_result_reentered_and_terminal_eligible"
          : nextAction === "terminal_failure"
            ? "external_change_required_before_valid_tool_observation"
            : nextAction === "alternate_probe"
              ? "current_tool_path_did_not_satisfy_required_surface_or_shape"
              : nextAction === "ask_user"
                ? "tool_admission_needs_user_confirmation"
                : nextAction === "retry"
                  ? "tool_path_failed_but_can_be_retried"
                  : "tool_output_requires_follow_up_reasoning",
    external_change_required: trace.retry_recommendation === "stop_external_change_required",
    terminal_blockers: terminalBlockers,
    required_surface_satisfied:
      !readString(operationalEvaluation?.required_surface) ||
      readBoolean(operationalEvaluation?.requested_surface_satisfied),
    evidence_reentered: trace.lifecycle_stage === "reentered_solver",
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const refreshToolLifecycleRecords = (input: {
  turnId: string;
  payload: RecordLike;
}): void => {
  const gatewayRecords = latestGatewayLifecycleRecords(input);
  const trace = gatewayRecords?.trace ?? buildToolLifecycleTrace(input);
  input.payload.tool_lifecycle_trace = trace;
  input.payload.tool_followup_decision =
    gatewayRecords?.followup ??
    buildToolFollowupDecision({
      ...input,
      trace,
    });
  const debug = readRecord(input.payload.debug);
  if (debug) {
    debug.tool_lifecycle_trace = input.payload.tool_lifecycle_trace;
    debug.tool_followup_decision = input.payload.tool_followup_decision;
  }
  reconcileAuthoritativeTypedFailureLifecycle({
    payload: input.payload,
    turnId: input.turnId,
    promptText:
      readString(input.payload.question) ||
      readString(input.payload.prompt) ||
      readString(input.payload.user_prompt),
  });
};
