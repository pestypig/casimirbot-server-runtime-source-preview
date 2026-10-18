import { authoritativeTypedFailureRequiresNoContinuation } from "./runtime/typed-failure-lifecycle-reconciliation";

type RecordLike = Record<string, unknown>;

export type HelixSolverContinuationReason =
  | "missing_followup_reasoning"
  | "route_authority_missing"
  | "terminal_authority_before_solver_completion"
  | "receipt_terminal_without_reentry"
  | "route_contract_missing"
  | "goal_satisfaction_incomplete"
  | "compound_prompt_coverage_incomplete"
  | "tool_observation_without_model_reentry"
  | "source_observation_without_arbitration";

export type HelixSolverContinuationNextStep =
  | "model_followup_reasoning"
  | "route_authority_repair"
  | "evidence_reentry"
  | "goal_satisfaction_recheck"
  | "final_answer_composition"
  | "typed_failure";

export type HelixSolverContinuationObservation = {
  schema: "helix.solver_continuation_observation.v1";
  kind: "solver_continuation_observation";
  artifact_id: string;
  turn_id: string;
  reason: HelixSolverContinuationReason;
  blocking_gate?: string;
  missing_refs?: string[];
  current_route?: string | null;
  current_terminal_kind?: string | null;
  required_next_step: HelixSolverContinuationNextStep;
  model_visible_instruction: string;
  assistant_answer: false;
  raw_content_included: false;
};

export type HelixAskCodexStyleTurnStatePacket = {
  schema: "helix.ask_codex_style_turn_state_packet.v1";
  turn_id: string;
  user_prompt_ref: "active_prompt";
  prompt_preserved: true;
  available_capabilities: string[];
  observations: Array<{
    artifact_ref: string;
    kind: string;
    content_role: "observation_not_assistant_answer" | "evidence_not_assistant_answer";
  }>;
  unresolved_solver_reasons: string[];
  terminal_forbidden_reasons: string[];
  allowed_next_steps: Array<"call_capability" | "answer" | "ask_user" | "fail_closed">;
  assistant_answer: false;
  raw_content_included: false;
};

const RECOVERABLE_SOLVER_FAILURES = new Set<string>([
  "missing_followup_reasoning",
  "route_authority_missing",
  "poison_clean_but_authority_failed",
  "receipt_terminal_without_reentry",
  "goal_satisfaction_incomplete",
  "compound_prompt_coverage_incomplete",
  "tool_observation_without_model_reentry",
  "tool_result_terminal_without_reasoning",
  "source_observation_without_arbitration",
  "source_observation_terminal_without_selection",
  "terminal_authority_before_solver_completion",
]);

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const modelOnlySuppressedContextualDirectAnswerSatisfied = (payload: RecordLike, terminalKind: string | null | undefined): boolean => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const sourceTarget = readRecord(payload.source_target_intent);
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  const admission = readRecord(payload.tool_call_admission_decision);
  const loopTrace = readRecord(payload.loop_parity_trace);
  const solverTrace = readRecord(payload.ask_turn_solver_trace);
  const contextualAudit = readRecord(solverTrace?.contextual_tool_audit);
  const sourceIsModelOnly =
    readString(canonicalGoal?.goal_kind) === "model_only_concept" ||
    readString(sourceTarget?.target_source) === "model_only" ||
    readString(sourceTarget?.target_kind) === "general_background";
  const requiredTerminalKind = readString(canonicalGoal?.required_terminal_kind);
  const selectedTerminalKind = readString(terminalKind) ?? readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  const actualToolCalls = Array.isArray(loopTrace?.actual_tool_calls) ? loopTrace.actual_tool_calls : [];
  return (
    sourceIsModelOnly &&
    requiredTerminalKind === "direct_answer_text" &&
    selectedTerminalKind === "direct_answer_text" &&
    finalAnswerSource !== "typed_failure" &&
    finalAnswerSource !== "request_user_input" &&
    readString(goalSatisfaction?.satisfaction) === "satisfied" &&
    readString(goalSatisfaction?.next_decision) === "allow_terminal" &&
    admission?.tool_admission_suppressed === true &&
    /negated_tool_instruction|explanatory_only|contextual/i.test(readString(admission?.suppression_reason) ?? "") &&
    contextualAudit?.blocked_contextual_tool_executed !== true &&
    actualToolCalls.length === 0
  );
};

const normalizeContinuationReason = (code: string): HelixSolverContinuationReason | null => {
  if (code === "poison_clean_but_authority_failed") return "route_authority_missing";
  if (code === "tool_result_terminal_without_reasoning") return "tool_observation_without_model_reentry";
  if (code === "source_observation_terminal_without_selection") return "source_observation_without_arbitration";
  if (
    code === "missing_followup_reasoning" ||
    code === "route_authority_missing" ||
    code === "terminal_authority_before_solver_completion" ||
    code === "receipt_terminal_without_reentry" ||
    code === "route_contract_missing" ||
    code === "goal_satisfaction_incomplete" ||
    code === "compound_prompt_coverage_incomplete" ||
    code === "tool_observation_without_model_reentry" ||
    code === "source_observation_without_arbitration"
  ) {
    return code;
  }
  return null;
};

const nextStepForReason = (reason: HelixSolverContinuationReason): HelixSolverContinuationNextStep => {
  if (reason === "missing_followup_reasoning" || reason === "tool_observation_without_model_reentry") {
    return "model_followup_reasoning";
  }
  if (reason === "route_authority_missing" || reason === "terminal_authority_before_solver_completion" || reason === "route_contract_missing") {
    return "route_authority_repair";
  }
  if (reason === "receipt_terminal_without_reentry" || reason === "source_observation_without_arbitration") {
    return "evidence_reentry";
  }
  if (reason === "goal_satisfaction_incomplete") return "goal_satisfaction_recheck";
  if (reason === "compound_prompt_coverage_incomplete") return "final_answer_composition";
  return "typed_failure";
};

const instructionForReason = (reason: HelixSolverContinuationReason, nextStep: HelixSolverContinuationNextStep): string => {
  if (nextStep === "model_followup_reasoning") {
    return "The previous path produced observations or receipts but did not perform follow-up reasoning. Review the evidence, decide whether another capability is needed, or produce a final answer only if the route contract and goal are satisfied.";
  }
  if (nextStep === "route_authority_repair") {
    return "Route authority is incomplete. Re-check the source target, route product contract, and terminal eligibility before any answer text is selected.";
  }
  if (nextStep === "evidence_reentry") {
    return "Evidence or receipts exist but have not been re-entered as selected evidence. Re-enter observations before terminal selection.";
  }
  if (nextStep === "goal_satisfaction_recheck") {
    return "Goal satisfaction is incomplete. Re-check whether the current artifacts satisfy the user's request before answering.";
  }
  if (nextStep === "final_answer_composition") {
    return "The current candidate does not cover the compound prompt. Compose a fuller final answer that covers all unresolved requirements.";
  }
  return `Solver continuation could not repair ${reason}; fail closed with typed_failure.`;
};

export function buildSolverContinuationObservation(input: {
  turnId: string;
  payload: RecordLike;
  hardGateCode: string;
  finalRoute?: string | null;
  terminalKind?: string | null;
  artifactLedger: Array<RecordLike>;
}): HelixSolverContinuationObservation | null {
  const code = String(input.hardGateCode ?? "").trim();
  if (!RECOVERABLE_SOLVER_FAILURES.has(code)) return null;
  if (authoritativeTypedFailureRequiresNoContinuation(input.payload)) {
    return null;
  }
  if (
    (code === "route_authority_missing" || code === "poison_clean_but_authority_failed") &&
    modelOnlySuppressedContextualDirectAnswerSatisfied(input.payload, input.terminalKind)
  ) {
    return null;
  }
  const continuationCount = Number(input.payload.solver_continuation_count ?? 0);
  const reason = normalizeContinuationReason(code);
  if (!reason) return null;
  const requiredNextStep = continuationCount >= 2 ? "typed_failure" : nextStepForReason(reason);
  const missingRefs = input.artifactLedger
    .map((artifact) => readString(artifact.artifact_id) ?? readString(readRecord(artifact.payload)?.artifact_id))
    .filter((entry): entry is string => Boolean(entry))
    .slice(-8);
  return {
    schema: "helix.solver_continuation_observation.v1",
    kind: "solver_continuation_observation",
    artifact_id: `${input.turnId}:solver_continuation:${continuationCount + 1}:${reason}`,
    turn_id: input.turnId,
    reason,
    blocking_gate: code,
    missing_refs: missingRefs,
    current_route: input.finalRoute ?? null,
    current_terminal_kind: input.terminalKind ?? null,
    required_next_step: requiredNextStep,
    model_visible_instruction: instructionForReason(reason, requiredNextStep),
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function appendSolverContinuationObservation(input: {
  payload: RecordLike;
  observation: HelixSolverContinuationObservation;
}): RecordLike {
  const payload = input.payload;
  const artifact = {
    artifact_id: input.observation.artifact_id,
    turn_id: input.observation.turn_id,
    kind: "solver_continuation_observation",
    payload: input.observation,
  };
  const ledger = Array.isArray(payload.current_turn_artifact_ledger) ? payload.current_turn_artifact_ledger : [];
  payload.current_turn_artifact_ledger = [...ledger, artifact];
  payload.solver_continuation_observation = input.observation;
  payload.solver_continuation_count = Number(payload.solver_continuation_count ?? 0) + 1;
  const debug = readRecord(payload.debug);
  if (debug) {
    debug.solver_continuation_observation = input.observation;
    debug.solver_continuation_count = payload.solver_continuation_count;
  }
  return payload;
}

export function buildCodexStyleTurnStatePacket(input: {
  turnId: string;
  payload: RecordLike;
  artifactLedger: Array<RecordLike>;
  unresolvedReasons?: string[];
  terminalForbiddenReasons?: string[];
}): HelixAskCodexStyleTurnStatePacket {
  const availableCapabilities =
    readStringArray(readRecord(input.payload.capability_plan)?.capabilities) ??
    readStringArray(input.payload.available_capabilities);
  const observations = input.artifactLedger
    .map((artifact) => {
      const payload = readRecord(artifact.payload);
      const ref = readString(artifact.artifact_id) ?? readString(payload?.artifact_id);
      const kind = readString(artifact.kind) ?? readString(payload?.kind);
      if (!ref || !kind) return null;
      return {
        artifact_ref: ref,
        kind,
        content_role: /evidence|validation|context/i.test(kind)
          ? "evidence_not_assistant_answer" as const
          : "observation_not_assistant_answer" as const,
      };
    })
    .filter((entry): entry is HelixAskCodexStyleTurnStatePacket["observations"][number] => Boolean(entry))
    .slice(-12);
  return {
    schema: "helix.ask_codex_style_turn_state_packet.v1",
    turn_id: input.turnId,
    user_prompt_ref: "active_prompt",
    prompt_preserved: true,
    available_capabilities: availableCapabilities,
    observations,
    unresolved_solver_reasons: input.unresolvedReasons ?? [],
    terminal_forbidden_reasons: input.terminalForbiddenReasons ?? [],
    allowed_next_steps: ["call_capability", "answer", "ask_user", "fail_closed"],
    assistant_answer: false,
    raw_content_included: false,
  };
}
