import { hashHelixTerminalText } from "./turn-terminal-authority";
import { evaluateTerminalBoundaryEligibility } from "./runtime-authority-contract";

type RecordLike = Record<string, unknown>;

export type HelixTerminalEquivalenceFailureCode =
  | "controller_decision_missing"
  | "controller_decision_not_terminal"
  | "controller_goal_terminal_mismatch"
  | "debug_terminal_differs_from_turn_terminal"
  | "agent_runtime_loop_missing"
  | "agent_step_decision_missing"
  | "selected_capability_observation_missing"
  | "post_observation_model_decision_missing"
  | "goal_satisfaction_missing"
  | "goal_satisfaction_not_terminal"
  | "poison_hashes_hidden_terminal_while_ui_stale"
  | "required_artifact_contract_missing"
  | "route_authority_missing"
  | "solver_trace_missing"
  | "stream_terminal_differs_from_turn_terminal"
  | "terminal_authority_hash_mismatch"
  | "ui_success_with_typed_failure_authority"
  | "visible_state_differs_from_terminal";

export type HelixTerminalEquivalenceHarnessResult = {
  schema: "helix.terminal_equivalence_harness_result.v1";
  turn_id: string | null;
  stream_turn_id: string | null;
  ok: boolean;
  failure_codes: HelixTerminalEquivalenceFailureCode[];
  surfaces: {
    non_stream_text: string | null;
    stream_text: string | null;
    debug_text: string | null;
    visible_ui_text: string | null;
    terminal_authority_text: string | null;
    terminal_authority_hash: string | null;
    poison_server_terminal_hash: string | null;
    poison_client_visible_hash: string | null;
    goal_satisfaction: string | null;
    goal_next_decision: string | null;
    controller_decision: string | null;
    controller_blocking_reasons: string[];
    discipline_guard_required: boolean;
    runtime_boundary_eligible: boolean | null;
    runtime_boundary_blocking_reasons: string[];
  };
  assistant_answer: false;
  raw_content_included: false;
};

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const extractDebugPayload = (debugExport: unknown): RecordLike | null => {
  const debug = readRecord(debugExport);
  return readRecord(debug?.payload) ?? debug;
};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
};

const terminalPresentationText = (value: RecordLike | null): string | null =>
  firstText(readRecord(value?.terminal_presentation)?.concise_text);

const visibleText = (value: RecordLike | null): string | null =>
  firstText(
    readRecord(value?.visibleAnswerState)?.finalAnswer,
    value?.finalAnswer,
    value?.selected_final_answer,
    value?.answer,
    value?.assistant_answer,
    value?.text,
    terminalPresentationText(value),
  );

const terminalKind = (value: RecordLike | null): string | null =>
  firstText(
    value?.terminal_artifact_kind,
    readRecord(value?.terminal_authority_single_writer)?.selected_terminal_artifact_kind,
    readRecord(value?.terminal_presentation)?.terminal_artifact_kind,
    readRecord(value?.terminal_answer_authority)?.terminal_artifact_kind,
    readRecord(value?.resolved_turn_summary)?.terminal_artifact_kind,
  );

const authorityText = (value: RecordLike | null): string | null => {
  const selectedKind = terminalKind(value);
  const terminalAuthority = readRecord(value?.terminal_answer_authority);
  const writer = readRecord(value?.terminal_authority_single_writer);
  const presentation = readRecord(value?.terminal_presentation);
  const terminalAuthorityKind = firstText(terminalAuthority?.terminal_artifact_kind);
  const writerKind = firstText(writer?.selected_terminal_artifact_kind);
  const presentationKind = firstText(presentation?.terminal_artifact_kind);
  const terminalAuthorityText = firstText(terminalAuthority?.terminal_text_preview);
  const writerText = firstText(writer?.visible_text);
  const presentationText = firstText(presentation?.concise_text);
  if (selectedKind && terminalAuthorityKind === selectedKind && terminalAuthorityText) return terminalAuthorityText;
  if (selectedKind && writerKind === selectedKind && writerText) return writerText;
  if (selectedKind && presentationKind === selectedKind && presentationText) return presentationText;
  return firstText(terminalAuthorityText, writerText, presentationText);
};

const authorityHash = (value: RecordLike | null): string | null => {
  const selectedKind = terminalKind(value);
  const terminalAuthority = readRecord(value?.terminal_answer_authority);
  const terminalAuthorityKind = firstText(terminalAuthority?.terminal_artifact_kind);
  const terminalAuthorityText = firstText(terminalAuthority?.terminal_text_preview);
  const terminalAuthorityHash = firstText(terminalAuthority?.terminal_text_hash);
  const selectedText = authorityText(value);
  if (selectedKind && terminalAuthorityKind === selectedKind && terminalAuthorityText === selectedText) {
    return terminalAuthorityHash ?? (selectedText ? hashHelixTerminalText(selectedText) : null);
  }
  return selectedText ? hashHelixTerminalText(selectedText) : null;
};

const finalAnswerSource = (value: RecordLike | null): string | null =>
  firstText(value?.final_answer_source, readRecord(value?.terminal_answer_authority)?.final_answer_source);

const isTypedFailureTerminal = (value: RecordLike | null): boolean =>
  /typed_failure|failure|error/i.test(`${terminalKind(value) ?? ""} ${finalAnswerSource(value) ?? ""}`);

const pushIf = (
  failures: HelixTerminalEquivalenceFailureCode[],
  condition: boolean,
  code: HelixTerminalEquivalenceFailureCode,
): void => {
  if (condition) failures.push(code);
};

const textDiffers = (left: string | null, right: string | null): boolean =>
  Boolean(left && right && left !== right);

const visibleDiffersFromAuthority = (visible: string | null, authority: string | null): boolean =>
  textDiffers(visible, authority);

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry)) : [];

const isSourceTargetedOrCapabilityTurn = (value: RecordLike | null): boolean => {
  const sourceTarget = readRecord(value?.source_target_intent);
  const targetSource = firstText(sourceTarget?.target_source);
  const targetKind = firstText(sourceTarget?.target_kind);
  const strength = firstText(sourceTarget?.strength);
  return Boolean(
    (targetSource && targetSource !== "unknown") ||
      (targetKind && targetKind !== "unknown") ||
      strength === "hard" ||
      sourceTarget?.must_enter_backend_ask === true ||
      sourceTarget?.allow_no_tool_direct === false ||
      (Array.isArray(sourceTarget?.requested_outputs) && sourceTarget.requested_outputs.length > 0) ||
      readRecord(value?.capability_plan) ||
      readRecord(value?.capability_result) ||
      readRecord(value?.capability_lifecycle_ledger) ||
      readRecord(value?.tool_call_admission_decision) ||
      readRecord(value?.active_workspace_source_resolution),
  );
};

const hasRequiredArtifactContract = (goalSatisfaction: RecordLike | null): boolean => {
  const contract = readRecord(goalSatisfaction?.terminal_contract);
  return Boolean(contract && firstText(contract.goal_kind) && readStringArray(contract.required_terminal_kinds).length > 0);
};

export function buildTerminalEquivalenceHarnessResult(input: {
  nonStreamResponse: unknown;
  streamFinal?: unknown;
  streamTerminalEvent?: unknown;
  debugExport?: unknown;
  visibleUiAnswerState?: unknown;
  requireControllerParity?: boolean;
  suppressDisciplineAutoRequire?: boolean;
}): HelixTerminalEquivalenceHarnessResult {
  const nonStream = readRecord(input.nonStreamResponse) ?? {};
  const streamFinal = readRecord(input.streamFinal);
  const streamTerminalEvent = readRecord(input.streamTerminalEvent);
  const debug = extractDebugPayload(input.debugExport);
  const visibleUi = readRecord(input.visibleUiAnswerState);

  const nonStreamText = visibleText(nonStream);
  const streamText = visibleText(streamFinal) ?? firstText(streamTerminalEvent?.text);
  const streamTerminalText = firstText(streamTerminalEvent?.text);
  const debugText = visibleText(debug);
  const visibleUiText = visibleText(visibleUi);
  const terminalText = authorityText(nonStream) ?? authorityText(debug);
  const terminalHash = authorityHash(nonStream) ?? authorityHash(debug);
  const poison = readRecord(nonStream.poison_audit) ?? readRecord(debug?.poison_audit);
  const poisonAuthority = readRecord(poison?.terminal_authority);
  const poisonServerHash = firstText(poisonAuthority?.server_terminal_text_hash);
  const poisonClientHash = firstText(poisonAuthority?.client_visible_text_hash);
  const streamAuthorityText = authorityText(streamFinal);
  const goalSatisfaction = readRecord(nonStream.goal_satisfaction_evaluation) ?? readRecord(debug?.goal_satisfaction_evaluation);
  const controller = readRecord(nonStream.solver_controller_decision) ?? readRecord(debug?.solver_controller_decision);
  const controllerBlockingReasons = Array.isArray(controller?.blocking_reasons)
    ? controller.blocking_reasons.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  const terminalArtifactKind = terminalKind(nonStream) ?? terminalKind(debug);
  const controllerTerminalArtifactKind = firstText(controller?.selected_terminal_artifact_kind);
  const normalFinalTerminal =
    !isTypedFailureTerminal(nonStream) &&
    !["final_failure", "pending_input"].includes(firstText(nonStream.final_status, nonStream.response_type) ?? "");
  const disciplineGuardRequired =
    Boolean(input.requireControllerParity) ||
    (!input.suppressDisciplineAutoRequire &&
      (isSourceTargetedOrCapabilityTurn(nonStream) || isSourceTargetedOrCapabilityTurn(debug)));
  const runtimeBoundary = evaluateTerminalBoundaryEligibility({
    ...debug,
    ...nonStream,
  });

  const failures: HelixTerminalEquivalenceFailureCode[] = [];
  pushIf(failures, Boolean(terminalText && terminalHash && hashHelixTerminalText(terminalText) !== terminalHash), "terminal_authority_hash_mismatch");
  pushIf(failures, textDiffers(debugText, terminalText), "debug_terminal_differs_from_turn_terminal");
  pushIf(failures, visibleDiffersFromAuthority(visibleUiText, terminalText), "visible_state_differs_from_terminal");
  pushIf(failures, Boolean(isTypedFailureTerminal(nonStream) && visibleUiText && terminalText && visibleUiText !== terminalText), "ui_success_with_typed_failure_authority");
  pushIf(
    failures,
    Boolean(
      poison?.ok === true &&
        poisonServerHash &&
        terminalHash &&
        poisonServerHash === terminalHash &&
        visibleUiText &&
        hashHelixTerminalText(visibleUiText) !== terminalHash,
    ),
    "poison_hashes_hidden_terminal_while_ui_stale",
  );
  pushIf(failures, Boolean(streamFinal && textDiffers(streamText, streamAuthorityText)), "stream_terminal_differs_from_turn_terminal");
  pushIf(failures, Boolean(streamTerminalText && textDiffers(streamTerminalText, streamText)), "stream_terminal_differs_from_turn_terminal");
  pushIf(failures, Boolean(streamFinal && textDiffers(streamText, nonStreamText)), "stream_terminal_differs_from_turn_terminal");
  pushIf(failures, !readRecord(nonStream.route_authority_audit) && !readRecord(debug?.route_authority_audit), "route_authority_missing");
  pushIf(failures, !readRecord(nonStream.ask_turn_solver_trace) && !readRecord(debug?.ask_turn_solver_trace), "solver_trace_missing");
  if (disciplineGuardRequired && normalFinalTerminal) {
    pushIf(failures, !goalSatisfaction, "goal_satisfaction_missing");
    pushIf(failures, !controller, "controller_decision_missing");
    pushIf(failures, !hasRequiredArtifactContract(goalSatisfaction), "required_artifact_contract_missing");
    pushIf(failures, runtimeBoundary.blocking_reasons.includes("agent_runtime_loop_missing"), "agent_runtime_loop_missing");
    pushIf(failures, runtimeBoundary.blocking_reasons.includes("agent_step_decision_missing"), "agent_step_decision_missing");
    pushIf(
      failures,
      runtimeBoundary.blocking_reasons.includes("selected_capability_observation_missing"),
      "selected_capability_observation_missing",
    );
    pushIf(
      failures,
      runtimeBoundary.blocking_reasons.includes("post_observation_model_decision_missing"),
      "post_observation_model_decision_missing",
    );
  }
  if (goalSatisfaction && normalFinalTerminal) {
    pushIf(
      failures,
      firstText(goalSatisfaction.satisfaction) !== "satisfied" || firstText(goalSatisfaction.next_decision) !== "allow_terminal",
      "goal_satisfaction_not_terminal",
    );
  }
  if (controller && normalFinalTerminal) {
    pushIf(failures, firstText(controller.decision) !== "allow_terminal", "controller_decision_not_terminal");
    pushIf(failures, controllerBlockingReasons.length > 0, "controller_decision_not_terminal");
    pushIf(
      failures,
      Boolean(controllerTerminalArtifactKind && terminalArtifactKind && controllerTerminalArtifactKind !== terminalArtifactKind),
      "controller_goal_terminal_mismatch",
    );
  }

  return {
    schema: "helix.terminal_equivalence_harness_result.v1",
    turn_id: firstText(nonStream.turn_id, debug?.active_turn_id),
    stream_turn_id: firstText(streamFinal?.turn_id),
    ok: failures.length === 0,
    failure_codes: unique(failures),
    surfaces: {
      non_stream_text: nonStreamText,
      stream_text: streamText,
      debug_text: debugText,
      visible_ui_text: visibleUiText,
      terminal_authority_text: terminalText,
      terminal_authority_hash: terminalHash,
      poison_server_terminal_hash: poisonServerHash,
      poison_client_visible_hash: poisonClientHash,
      goal_satisfaction: firstText(goalSatisfaction?.satisfaction),
      goal_next_decision: firstText(goalSatisfaction?.next_decision),
      controller_decision: firstText(controller?.decision),
      controller_blocking_reasons: controllerBlockingReasons,
      discipline_guard_required: disciplineGuardRequired,
      runtime_boundary_eligible: disciplineGuardRequired ? runtimeBoundary.eligible : null,
      runtime_boundary_blocking_reasons: disciplineGuardRequired ? runtimeBoundary.blocking_reasons : [],
    },
    assistant_answer: false,
    raw_content_included: false,
  };
}
