import { auditRouteAuthority } from "../route-authority-audit";
import { buildRouteProductContract } from "../route-product-contract";
import { resolveToolFamilyContract } from "../tool-family-contract";
import { readCommittedAskRoute } from "../committed-ask-route";
import { readVerifiedHelixRuntimeLifecycleFromPayload } from "./turn-lifecycle";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const hasRuntimeLifecycleObservation = (payload: RecordLike): boolean => {
  const lifecycle = readRecord(payload.turn_lifecycle);
  const integrity = readRecord(lifecycle?.integrity);
  if (
    lifecycle?.authority !== "runtime_event_log" ||
    integrity?.ok !== true
  ) {
    return false;
  }

  const events = Array.isArray(lifecycle.events) ? lifecycle.events : [];
  if (
    events.some((value) => {
      const event = readRecord(value);
      return Boolean(
        event?.kind === "observation.reentered" &&
          event?.status === "succeeded" &&
          Array.isArray(event.observation_refs) &&
          event.observation_refs.length > 0,
      );
    })
  ) {
    return true;
  }

  const reduction = readRecord(lifecycle.reduction);
  const toolCalls = Array.isArray(reduction?.tool_calls)
    ? reduction.tool_calls
    : [];
  return toolCalls.some((value) => {
    const call = readRecord(value);
    return Boolean(
      call?.reentered === true &&
        ((Array.isArray(call.observation_refs) &&
          call.observation_refs.length > 0) ||
          (Array.isArray(call.reentry_observation_refs) &&
            call.reentry_observation_refs.length > 0)),
    );
  });
};

const hasCurrentTurnObservation = (payload: RecordLike): boolean => {
  if (hasRuntimeLifecycleObservation(payload)) return true;
  const loopTrace = readRecord(payload.loop_parity_trace);
  if (
    Array.isArray(loopTrace?.observations_created) &&
    loopTrace.observations_created.length > 0
  ) {
    return true;
  }
  const currentTurnId =
    readString(payload.turn_id) ??
    readString(payload.active_turn_id) ??
    readString(payload.backend_turn_id);
  const isCurrentTurnCapabilityObservationPacket = (
    value: unknown,
  ): boolean => {
    const packet = readRecord(value);
    if (
      readString(packet?.schema) !==
      "helix.agent_step_observation_packet.v1"
    ) {
      return false;
    }
    const packetTurnId = readString(packet?.turn_id);
    return Boolean(
      packetTurnId &&
        (!currentTurnId || packetTurnId === currentTurnId) &&
        readString(packet?.call_id) &&
        readString(packet?.decision_id) &&
        readString(packet?.capability_key) &&
        readString(packet?.status),
    );
  };
  const capabilityPackets = Array.isArray(
    payload.capability_lane_observation_packets,
  )
    ? payload.capability_lane_observation_packets
    : [];
  if (capabilityPackets.some(isCurrentTurnCapabilityObservationPacket)) {
    return true;
  }
  const ledger = Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
    : [];
  return ledger.some((entry) => {
    const artifact = readRecord(entry);
    const kind = readString(artifact?.kind) ?? "";
    if (
      kind === "provider_gateway_observation_packet" &&
      isCurrentTurnCapabilityObservationPacket(artifact?.payload)
    ) {
      return true;
    }
    return /(?:tool|source|environment|document|scholarly|calculator|workspace)[-_.:]?(?:observation|receipt|evaluation)$/i.test(
      kind,
    );
  });
};

const readTypedFailure = (payload: RecordLike): RecordLike | null => {
  const direct = readRecord(payload.typed_failure);
  if (direct) return direct;
  const ledger = Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
    : [];
  for (const value of [...ledger].reverse()) {
    const artifact = readRecord(value);
    if (readString(artifact?.kind) !== "typed_failure") continue;
    const artifactPayload = readRecord(artifact?.payload);
    if (artifactPayload) return artifactPayload;
  }
  return null;
};

const SETTLED_ENVIRONMENT_FAILURE_CODES = new Set([
  "connector_offline",
  "probe_timeout",
  "capability_unavailable",
  "capability_version_changed",
  "target_unavailable",
  "target_ambiguous",
  "subject_binding_required",
  "subject_binding_stale",
  "subject_offline",
  "wrong_environment",
  "wrong_world",
  "permission_revoked",
  "binding_revoked",
  "schema_validation_failed",
  "result_stale",
  "request_canceled",
  "request_superseded",
  "producer_epoch_mismatch",
  "environment_adapter_contract_changed",
  "probe_failed",
  "command_timeout",
  "command_outcome_unknown",
  "authority_stale",
  "connector_management_forbidden",
  "command_catalog_changed",
  "command_parse_failed",
  "command_category_mismatch",
  "host_escape_rejected",
  "duplicate_request",
]);

const hasRuntimeVerifiedPostObservationCompletion = (
  payload: RecordLike,
): boolean => {
  const lifecycle = readRecord(payload.turn_lifecycle);
  const reduction = readRecord(lifecycle?.reduction);
  const integrity = readRecord(lifecycle?.integrity);
  return Boolean(
    lifecycle?.authority === "runtime_event_log" &&
      integrity?.ok === true &&
      reduction?.post_observation_reasoning_completed === true &&
      reduction?.runtime_turn_completed === true &&
      reduction?.terminal_eligible === true,
  );
};

const isSettledSourceObservationTypedFailure = (
  payload: RecordLike,
): boolean => {
  if (!hasCurrentTurnObservation(payload)) return false;
  const identityAudit = readRecord(payload.live_source_identity_audit);
  const identityDiagnosis = readString(identityAudit?.diagnosis);
  const failure = readTypedFailure(payload);
  const errorCode =
    readString(failure?.error_code) ?? readString(payload.terminal_error_code);
  const authoritativeIdentityFailure = Boolean(
    identityAudit?.identity_ok === false &&
      identityDiagnosis &&
      errorCode === identityDiagnosis &&
      [
        "fresh_source_unbound",
        "wrong_environment",
        "interpretations_missing",
      ].includes(identityDiagnosis),
  );
  if (authoritativeIdentityFailure) return true;
  if (
    errorCode &&
    SETTLED_ENVIRONMENT_FAILURE_CODES.has(errorCode) &&
    hasRuntimeVerifiedPostObservationCompletion(payload)
  ) {
    return true;
  }
  const loopTrace = readRecord(payload.loop_parity_trace);
  if (
    Array.isArray(loopTrace?.actual_tool_calls) &&
    loopTrace.actual_tool_calls.length > 0
  ) {
    return false;
  }
  const nextRequiredAction = readString(failure?.next_required_action);
  return Boolean(
    errorCode &&
      [
        "procedure_epoch_current_unavailable",
        "procedure_epoch_previous_unavailable",
        "procedure_memory_unavailable",
        "PROCEDURE_MEMORY_RECALL_EVIDENCE_MISSING",
        "PROCEDURE_MEMORY_ACTIVE_SITUATION_RUN_MISSING",
        "PROCEDURE_MEMORY_SELECTED_REFS_MISSING",
        "procedure_epoch_replay_evidence_unavailable",
        "visual_scene_memory_no_match",
        "visual_scene_memory_current_missing",
      ].includes(errorCode) &&
      (!nextRequiredAction ||
        [
          "none",
          "capture_current_visual_epoch",
          "wait_for_scene_memory_index",
          "repair_procedure_memory",
        ].includes(nextRequiredAction)),
  );
};

export const authoritativeTypedFailureRequiresNoContinuation = (
  payload: RecordLike,
): boolean => {
  if (
    readString(payload.terminal_artifact_kind) !== "typed_failure" ||
    readString(payload.final_answer_source) !== "typed_failure"
  ) {
    return false;
  }

  const failure = readTypedFailure(payload);
  const errorCode =
    readString(failure?.error_code) ?? readString(payload.terminal_error_code);
  if (!errorCode) return false;
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  const settledSourceFailureAlreadyAuthorized =
    canonicalGoalFrame?.authoritative_source_observation_typed_failure === true;

  const routeProductContract = readRecord(payload.route_product_contract);
  const allowedTerminalKinds = Array.isArray(
    routeProductContract?.allowed_terminal_artifact_kinds,
  )
    ? routeProductContract.allowed_terminal_artifact_kinds
        .map((value) => readString(value))
        .filter((value): value is string => Boolean(value))
    : [];
  if (
    readString(routeProductContract?.schema) !==
      "helix.route_product_contract.v1" ||
    !allowedTerminalKinds.includes("typed_failure")
  ) {
    return false;
  }

  const routeAuthorityAudit = readRecord(payload.route_authority_audit);
  const loopParityTrace = readRecord(payload.loop_parity_trace);
  const terminalAuthority = readRecord(payload.terminal_answer_authority);
  const terminalWriter = readRecord(payload.terminal_authority_single_writer);
  const terminalWriterIntegrity = readRecord(terminalWriter?.integrity);
  const typedFailureSelectedBySingleWriter = Boolean(
    readString(terminalWriter?.schema) ===
      "helix.terminal_authority_single_writer_result.v1" &&
      readString(terminalWriter?.selected_terminal_artifact_kind) ===
        "typed_failure" &&
      readString(terminalWriter?.source) === "typed_failure" &&
      readString(terminalWriter?.selected_terminal_artifact_ref) &&
      terminalWriterIntegrity?.single_writer_applied === true,
  );
  const authorityEstablished =
    routeAuthorityAudit?.route_authority_ok === true ||
    loopParityTrace?.route_authority_ok === true ||
    terminalAuthority?.server_authoritative === true ||
    typedFailureSelectedBySingleWriter;
  if (!authorityEstablished) return false;

  return (
    !hasCurrentTurnObservation(payload) ||
    settledSourceFailureAlreadyAuthorized ||
    isSettledSourceObservationTypedFailure(payload)
  );
};

export const authoritativeSourceObservationTypedFailureRequiresNoContinuation = (
  payload: RecordLike,
): boolean =>
  authoritativeTypedFailureRequiresNoContinuation(payload) &&
  isSettledSourceObservationTypedFailure(payload);

const selectedRouteForPayload = (payload: RecordLike): string =>
  readString(readRecord(payload.loop_parity_trace)?.selected_route) ??
  readString(readRecord(payload.route_authority_audit)?.selected_route) ??
  readString(readCommittedAskRoute(payload)?.route.selected_route) ??
  readString(readRecord(payload.committed_ask_route)?.route_id) ??
  readString(payload.route_reason_code) ??
  readString(payload.route) ??
  "typed_failure";

const withoutSettledTypedFailureFlags = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" &&
          ![
            "route_contract_missing",
            "route_authority_missing",
            "poison_clean_but_authority_failed",
            "missing_followup_reasoning",
            "goal_satisfaction_incomplete",
            "tool_result_terminal_without_reasoning",
            "terminal_selected_before_observation_finalizer",
            "terminal_authority_before_solver_completion",
          ].includes(entry),
      )
    : [];

const reconcileRailObservationContract = (
  payload: RecordLike,
  sourceTarget: string | null,
): void => {
  if (!sourceTarget) return;
  const contract = resolveToolFamilyContract({
    toolName: sourceTarget,
    toolFamily: sourceTarget,
  });
  if (!contract || contract.requiredObservationKinds.length === 0) return;

  const admission = readRecord(payload.tool_call_admission_decision);
  if (
    admission &&
    (!Array.isArray(
      admission.required_observation_kinds_for_requested_capability,
    ) ||
      admission.required_observation_kinds_for_requested_capability.length ===
        0)
  ) {
    admission.required_observation_kinds_for_requested_capability = [
      ...contract.requiredObservationKinds,
    ];
  }
  const debug = readRecord(payload.debug);
  const artifactQueryIndex = readRecord(payload.artifact_query_index);
  const debugArtifactQueryIndex = readRecord(debug?.artifact_query_index);
  const candidates = [
    readRecord(payload.codex_parity_agent_spine_rail_table),
    readRecord(payload.tool_rail_failure_triage),
    readRecord(payload.tool_turn_chain_audit),
    readRecord(artifactQueryIndex?.codex_parity_agent_spine_rail_table),
    readRecord(artifactQueryIndex?.tool_rail_failure_triage),
    readRecord(artifactQueryIndex?.tool_turn_chain_audit),
    readRecord(debug?.codex_parity_agent_spine_rail_table),
    readRecord(debug?.tool_rail_failure_triage),
    readRecord(debug?.tool_turn_chain_audit),
    readRecord(debugArtifactQueryIndex?.codex_parity_agent_spine_rail_table),
    readRecord(debugArtifactQueryIndex?.tool_rail_failure_triage),
    readRecord(debugArtifactQueryIndex?.tool_turn_chain_audit),
  ].filter((entry): entry is RecordLike => Boolean(entry));
  for (const rail of candidates) {
    if (
      !Array.isArray(
        rail.required_observation_kinds_for_requested_capability,
      ) ||
      rail.required_observation_kinds_for_requested_capability.length === 0
    ) {
      rail.required_observation_kinds_for_requested_capability = [
        ...contract.requiredObservationKinds,
      ];
      rail.observed_artifact_supports_requested_capability = false;
    }
  }
};

const reconcileAgentRuntimeLoopAdmission = (payload: RecordLike): void => {
  const settle = (value: unknown): void => {
    const admission = readRecord(value);
    if (
      readString(admission?.schema) !==
      "helix.agent_runtime_loop_admission.v1"
    ) {
      return;
    }
    admission.admitted = false;
    admission.mode = "skip";
    admission.reason = "authoritative_typed_failure_terminal";
  };

  settle(payload.agent_runtime_loop_admission);
  const ledger = Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
    : [];
  for (const value of ledger) {
    const artifact = readRecord(value);
    if (readString(artifact?.kind) === "agent_runtime_loop_admission") {
      settle(artifact?.payload);
    }
  }
  const debug = readRecord(payload.debug);
  settle(debug?.agent_runtime_loop_admission);
};

const mirroredRecords = (
  payload: RecordLike,
  key: string,
): RecordLike[] => {
  const debug = readRecord(payload.debug);
  const artifactQueryIndex = readRecord(payload.artifact_query_index);
  const debugArtifactQueryIndex = readRecord(debug?.artifact_query_index);
  const records = [
    readRecord(payload[key]),
    readRecord(debug?.[key]),
    readRecord(artifactQueryIndex?.[key]),
    readRecord(debugArtifactQueryIndex?.[key]),
  ].filter((entry): entry is RecordLike => Boolean(entry));
  return [...new Set(records)];
};

const reconcileSettledSourceFailureRails = (
  payload: RecordLike,
): void => {
  const identityAudit = readRecord(payload.live_source_identity_audit);
  if (identityAudit?.identity_ok === false) return;

  for (const rail of mirroredRecords(
    payload,
    "codex_parity_agent_spine_rail_table",
  )) {
    rail.first_broken_rail = null;
    rail.repair_target = null;
    rail.codex_parity_class = "complete";
    rail.rail_status = "complete";
    rail.rail_failure_code = null;
    rail.terminal_authority_proven = true;
    rail.visible_projection_proven = true;
  }
  for (const key of [
    "tool_turn_chain_audit",
    "final_tool_turn_chain_audit",
  ]) {
    for (const audit of mirroredRecords(payload, key)) {
      audit.rail_status = "complete";
      audit.rail_failure_code = null;
      audit.terminal_authority_proven = true;
      audit.visible_projection_proven = true;
    }
  }
  for (const key of [
    "tool_rail_failure_triage",
    "final_tool_rail_failure_triage",
  ]) {
    for (const triage of mirroredRecords(payload, key)) {
      triage.first_broken_rail = null;
      triage.failure_bucket = null;
      triage.repair_target = null;
      triage.rail_status = "complete";
      triage.rail_failure_code = null;
    }
  }
  for (const status of mirroredRecords(
    payload,
    "active_terminal_rail_status",
  )) {
    status.rail_status = "complete";
    status.rail_failure_code = null;
    status.first_broken_rail = null;
    status.repair_target = null;
  }
};

const reconcileVerifiedProviderReasoning = (
  payload: RecordLike,
  errorCode: string | null,
): void => {
  if (!hasRuntimeVerifiedPostObservationCompletion(payload)) return;
  for (const projection of mirroredRecords(
    payload,
    "provider_reasoning_reentry",
  )) {
    projection.status = "completed";
    projection.observation_reentered = true;
    projection.evidence_reentered = true;
    projection.solver_completed = true;
    projection.goal_satisfaction_compatible = true;
    projection.post_tool_model_step_required = false;
    projection.completion_source = "turn_lifecycle.runtime_event_log";
  }
  for (const followup of mirroredRecords(payload, "tool_followup_decision")) {
    followup.next_action = "stop";
    followup.reason = errorCode ?? "authoritative_typed_failure_terminal";
    followup.external_change_required = true;
    followup.terminal_blockers = [];
    followup.evidence_reentered = true;
    followup.completion_source = "turn_lifecycle.runtime_event_log";
  }
};

export const reconcileAuthoritativeTypedFailureLifecycle = (args: {
  payload: RecordLike;
  turnId: string;
  promptText?: string | null;
  selectedTerminalArtifactKind?: string | null;
  finalAnswerSource?: string | null;
}): boolean => {
  const terminalArtifactKind =
    readString(args.selectedTerminalArtifactKind) ??
    readString(args.payload.terminal_artifact_kind);
  const finalAnswerSource =
    readString(args.finalAnswerSource) ??
    readString(args.payload.final_answer_source);
  const currentTurnObservationPresent = hasCurrentTurnObservation(
    args.payload,
  );
  const settledSourceObservationFailure =
    isSettledSourceObservationTypedFailure(args.payload);
  if (
    terminalArtifactKind !== "typed_failure" ||
    finalAnswerSource !== "typed_failure" ||
    (currentTurnObservationPresent && !settledSourceObservationFailure)
  ) {
    return false;
  }
  const verifiedRuntimeLifecycle =
    readVerifiedHelixRuntimeLifecycleFromPayload({
      payload: args.payload,
      turnId: args.turnId,
    });
  if (verifiedRuntimeLifecycle) {
    const errorCode =
      readString(readTypedFailure(args.payload)?.error_code) ??
      readString(args.payload.terminal_error_code);
    args.payload.typed_failure_lifecycle_reconciliation = {
      schema: "helix.typed_failure_lifecycle_reconciliation.v1",
      turn_id: args.turnId,
      mode: "read_only_projection",
      status: "canonical_lifecycle_preserved",
      error_code: errorCode,
      runtime_phase: verifiedRuntimeLifecycle.reduction.phase,
      runtime_observation_reentry_refs:
        verifiedRuntimeLifecycle.reduction.observation_reentry_refs,
      runtime_turn_completed:
        verifiedRuntimeLifecycle.reduction.runtime_turn_completed,
      projections_mutated: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    return true;
  }
  const sourceTargetIntent =
    readRecord(args.payload.source_target_intent) ??
    readRecord(args.payload.sourceTargetIntent);
  let routeProductContract = readRecord(args.payload.route_product_contract);
  if (
    readString(routeProductContract?.schema) !==
      "helix.route_product_contract.v1" &&
    readString(sourceTargetIntent?.strength) === "hard"
  ) {
    routeProductContract = buildRouteProductContract({
      turnId: args.turnId,
      threadId:
        readString(sourceTargetIntent?.thread_id) ??
        readString(args.payload.thread_id) ??
        "helix-ask:desktop",
      sourceTargetIntent:
        sourceTargetIntent as Parameters<
          typeof buildRouteProductContract
        >[0]["sourceTargetIntent"],
      promptText: readString(args.promptText) ?? "",
    }) as unknown as RecordLike;
    args.payload.route_product_contract = routeProductContract;
  }
  if (
    readString(routeProductContract?.schema) !==
    "helix.route_product_contract.v1"
  ) {
    return false;
  }

  const promptText = readString(args.promptText) ?? "";
  const selectedRoute = selectedRouteForPayload(args.payload);
  const establishedAuthority =
    authoritativeTypedFailureRequiresNoContinuation(args.payload);
  const routeAuthorityAudit = auditRouteAuthority({
    turnId: args.turnId,
    promptText,
    selectedRoute,
    payload: args.payload,
    terminalArtifactKind,
    finalAnswerSource,
    sourceTargetIntent,
    routeProductContract,
    toolCallAdmissionDecision: readRecord(
      args.payload.tool_call_admission_decision,
    ),
    terminalArtifactSelectionGuard: readRecord(
      args.payload.terminal_artifact_selection_guard,
    ),
    productAuthorityGuard: readRecord(args.payload.product_authority_guard),
    committedAskRoute: readRecord(args.payload.committed_ask_route),
  });
  if (!routeAuthorityAudit.route_authority_ok && !establishedAuthority) {
    return false;
  }
  const existingRouteAuthorityAudit = readRecord(
    args.payload.route_authority_audit,
  );
  const effectiveRouteAuthorityAudit = routeAuthorityAudit.route_authority_ok
    ? routeAuthorityAudit
    : existingRouteAuthorityAudit ?? routeAuthorityAudit;

  const canonicalGoalFrame =
    readRecord(args.payload.canonical_goal_frame) ?? {};
  if (settledSourceObservationFailure) {
    canonicalGoalFrame.authoritative_source_observation_typed_failure = true;
    delete canonicalGoalFrame.authoritative_zero_observation_typed_failure;
  } else {
    canonicalGoalFrame.authoritative_zero_observation_typed_failure = true;
    delete canonicalGoalFrame.authoritative_source_observation_typed_failure;
  }
  args.payload.canonical_goal_frame = canonicalGoalFrame;
  args.payload.route_authority_audit = effectiveRouteAuthorityAudit;
  const loopParityTrace = readRecord(args.payload.loop_parity_trace);
  if (loopParityTrace) {
    loopParityTrace.route_authority_audit_ref =
      effectiveRouteAuthorityAudit.audit_id;
    loopParityTrace.route_authority_ok = true;
    loopParityTrace.terminal_selection_ran_after_observations = true;
    loopParityTrace.terminal_artifact_kind = terminalArtifactKind;
    loopParityTrace.final_answer_source = finalAnswerSource;
    loopParityTrace.short_circuit_risk_flags =
      withoutSettledTypedFailureFlags(
        loopParityTrace.short_circuit_risk_flags,
      );
  }
  const solverTrace = readRecord(args.payload.ask_turn_solver_trace);
  if (solverTrace) {
    solverTrace.route_authority_ok = true;
    solverTrace.solver_risk_flags = withoutSettledTypedFailureFlags(
      solverTrace.solver_risk_flags,
    );
    solverTrace.solver_short_circuit_flags =
      withoutSettledTypedFailureFlags(
        solverTrace.solver_short_circuit_flags,
      );
    const finalArbitration = readRecord(solverTrace.final_arbitration);
    if (finalArbitration) {
      finalArbitration.terminal_artifact_kind = terminalArtifactKind;
      finalArbitration.final_answer_source = finalAnswerSource;
      finalArbitration.remaining_uncertainty =
        withoutSettledTypedFailureFlags(
          finalArbitration.remaining_uncertainty,
        );
      finalArbitration.why_complete = settledSourceObservationFailure
        ? "authoritative source-observation typed failure settled by terminal policy"
        : "authoritative zero-observation typed failure settled by terminal policy";
    }
    for (const gate of [
      readRecord(solverTrace.evidence_reentry),
      readRecord(solverTrace.evidence_reentry_gate),
      readRecord(solverTrace.followup_reasoning),
      readRecord(solverTrace.followup_reasoning_gate),
    ]) {
      if (!gate) continue;
      gate.required = false;
      gate.completed = true;
      gate.reason = settledSourceObservationFailure
        ? "authoritative_source_observation_typed_failure"
        : "authoritative_typed_failure_no_observation";
      delete gate.skipped_reason;
      if (Array.isArray(gate.violation_codes)) gate.violation_codes = [];
    }
    solverTrace.completed_solver_path = true;
  }
  reconcileRailObservationContract(
    args.payload,
    readString(sourceTargetIntent?.target_source),
  );
  if (settledSourceObservationFailure) {
    reconcileSettledSourceFailureRails(args.payload);
    reconcileVerifiedProviderReasoning(
      args.payload,
      readString(readTypedFailure(args.payload)?.error_code) ??
        readString(args.payload.terminal_error_code),
    );
  }
  reconcileAgentRuntimeLoopAdmission(args.payload);

  const debug = readRecord(args.payload.debug);
  if (debug) {
    debug.route_authority_audit = args.payload.route_authority_audit;
    debug.loop_parity_trace = args.payload.loop_parity_trace;
    if (solverTrace) {
      debug.ask_turn_solver_trace = args.payload.ask_turn_solver_trace;
    }
  }
  return true;
};
