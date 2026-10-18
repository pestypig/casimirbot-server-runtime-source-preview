import { buildLivePipelineActionEnvelope, buildLivePipelineToolTraceDisclosure } from "./live-pipeline-tool-trace";
import { guardProductAuthority } from "./product-authority-guard";
import { auditRouteAuthority } from "./route-authority-audit";
import { guardTerminalArtifactSelection } from "./terminal-artifact-selection-guard";
import { buildHelixTurnTerminalAuthority } from "./turn-terminal-authority";

const LIVE_PIPELINE_SET_RATE_CAPABILITY =
  "situation-room.live-source.set_rate" as const;

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map(readString)
        .filter((entry: string | null): entry is string => Boolean(entry))
    : [];

const readFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

export type HelixLivePipelineControlTerminalProjection = {
  text: string;
  receipt: Record<string, unknown>;
  receiptArtifact: Record<string, unknown>;
  routeProductContract: Record<string, unknown>;
  canonicalGoalFrame: Record<string, unknown>;
  terminalArtifactSelectionGuard: Record<string, unknown>;
  productAuthorityGuard: Record<string, unknown>;
  routeAuthorityAudit: Record<string, unknown>;
  actionEnvelope: ReturnType<typeof buildLivePipelineActionEnvelope>;
  toolTraceDisclosure: ReturnType<typeof buildLivePipelineToolTraceDisclosure>;
  authority: ReturnType<typeof buildHelixTurnTerminalAuthority>;
  observationRef: string;
};

/**
 * Promotes an authenticated, current-turn cadence observation into the exact
 * non-answer receipt required by the live-pipeline route. The model-authored
 * text remains the visible answer; this object only proves terminal eligibility.
 */
export const buildLivePipelineControlTerminalProjection = (input: {
  turnId: string;
  threadId: string;
  promptText: string;
  route?: string | null;
  providerText: string;
  providerObservationReentered: boolean;
  providerSolverPathCompleted: boolean;
  committedAskRoute?: unknown;
  sourceTargetIntent?: unknown;
  toolCallAdmissionDecision?: unknown;
  normalizedArtifacts: Array<Record<string, unknown>>;
}): HelixLivePipelineControlTerminalProjection | null => {
  const text = input.providerText.trim();
  if (
    !text ||
    !input.providerObservationReentered ||
    !input.providerSolverPathCompleted
  ) {
    return null;
  }

  const committedRoute = readRecord(input.committedAskRoute);
  const route = readRecord(committedRoute?.route);
  const committedGoal = readRecord(committedRoute?.canonical_goal);
  if (
    committedRoute?.schema !== "helix.committed_ask_route.v1" ||
    readString(route?.source_target) !== "live_pipeline" ||
    readString(committedGoal?.goal_kind) !== "live_pipeline_control" ||
    readString(committedGoal?.required_terminal_kind) !==
      "live_pipeline_receipt"
  ) {
    return null;
  }

  const sourceTargetIntent = readRecord(input.sourceTargetIntent);
  const admission = readRecord(input.toolCallAdmissionDecision);
  if (
    readString(sourceTargetIntent?.target_source) !== "live_pipeline" ||
    sourceTargetIntent?.allow_client_shortcut === true ||
    sourceTargetIntent?.allow_no_tool_direct === true ||
    readString(admission?.source_target) !== "live_pipeline" ||
    admission?.required !== true ||
    !readStringArray(admission?.admitted_tool_families).includes(
      "live_pipeline",
    ) ||
    readString(admission?.admitted_capability) !==
      LIVE_PIPELINE_SET_RATE_CAPABILITY
  ) {
    return null;
  }

  const observationArtifact = [...input.normalizedArtifacts]
    .reverse()
    .find((artifact) => {
      const payload = readRecord(artifact.payload);
      return (
        readString(artifact.turn_id) === input.turnId &&
        readString(artifact.source_scope) === "current_turn_context" &&
        readString(artifact.kind) === "visual_producer_cadence_receipt" &&
        readString(artifact.capability_key) ===
          LIVE_PIPELINE_SET_RATE_CAPABILITY &&
        readString(artifact.status) === "succeeded" &&
        readString(payload?.schema) ===
          "helix.visual_producer_cadence_receipt.v1" &&
        readString(payload?.action_id) ===
          LIVE_PIPELINE_SET_RATE_CAPABILITY &&
        payload?.ok === true &&
        payload?.assistant_answer === false &&
        payload?.raw_content_included === false
      );
    });
  if (!observationArtifact) return null;

  const observation = readRecord(observationArtifact.payload);
  const observationRef = readString(observationArtifact.artifact_id);
  const receiptId = readString(observation?.receipt_id);
  const cadenceMs = readFiniteNumber(observation?.cadence_ms);
  if (!observation || !observationRef || !receiptId || cadenceMs === null) {
    return null;
  }

  const allowedTerminalKinds = readStringArray(
    committedGoal?.allowed_terminal_artifact_kinds,
  );
  const forbiddenTerminalKinds = readStringArray(
    committedGoal?.forbidden_terminal_artifact_kinds,
  );
  if (
    !allowedTerminalKinds.includes("live_pipeline_receipt") ||
    forbiddenTerminalKinds.includes("live_pipeline_receipt")
  ) {
    return null;
  }

  const routeProductContract = {
    schema: "helix.route_product_contract.v1",
    turn_id: input.turnId,
    source_target: "live_pipeline",
    required_terminal_artifact_kind: "live_pipeline_receipt",
    required_terminal_kind: "live_pipeline_receipt",
    allowed_terminal_artifact_kinds: allowedTerminalKinds,
    forbidden_terminal_artifact_kinds: forbiddenTerminalKinds,
    source: "committed_ask_route_live_pipeline_control",
    assistant_answer: false,
    raw_content_included: false,
  };
  const canonicalGoalFrame = {
    schema: "helix.canonical_goal_frame.v1",
    turn_id: input.turnId,
    goal_kind: "live_pipeline_control",
    requested_capability: LIVE_PIPELINE_SET_RATE_CAPABILITY,
    required_terminal_kind: "live_pipeline_receipt",
    source: "committed_ask_route_live_pipeline_control",
    assistant_answer: false,
    raw_content_included: false,
  };
  const terminalArtifactSelectionGuard = guardTerminalArtifactSelection({
    contract: routeProductContract as never,
    terminalArtifactKind: "live_pipeline_receipt",
    terminalText: text,
  });
  const productAuthorityGuard = guardProductAuthority({
    sourceTargetIntent,
    toolCallAdmissionDecision: admission,
    routeProductContract,
    terminalArtifactSelectionGuard,
    terminalArtifactKind: "live_pipeline_receipt",
  });
  if (
    terminalArtifactSelectionGuard.allowed !== true ||
    productAuthorityGuard.allowed !== true
  ) {
    return null;
  }
  const routeAuthorityAudit = auditRouteAuthority({
    turnId: input.turnId,
    promptText: input.promptText,
    selectedRoute: "live_pipeline_control",
    payload: {
      committed_ask_route: committedRoute,
      route_product_contract: routeProductContract,
      canonical_goal_frame: canonicalGoalFrame,
    },
    terminalArtifactKind: "live_pipeline_receipt",
    finalAnswerSource: "live_pipeline_receipt",
    sourceTargetIntent,
    routeProductContract,
    toolCallAdmissionDecision: admission,
    terminalArtifactSelectionGuard,
    productAuthorityGuard,
    committedAskRoute: committedRoute,
  });
  if (routeAuthorityAudit.route_authority_ok !== true) return null;

  const receipt = {
    schema: "helix.live_pipeline_turn_receipt.v1",
    turn_id: input.turnId,
    thread_id: input.threadId,
    intent: {
      kind: "live_pipeline_control",
      capability: LIVE_PIPELINE_SET_RATE_CAPABILITY,
    },
    actions: [LIVE_PIPELINE_SET_RATE_CAPABILITY],
    action_id: LIVE_PIPELINE_SET_RATE_CAPABILITY,
    pipeline_plan_id: null,
    pipeline_receipt_id: receiptId,
    pipeline_id: null,
    visual_producer_id:
      readString(observation?.producer_id) ??
      readString(readRecord(observation?.cadence)?.producer_id),
    cadence_ms: cadenceMs,
    producer_binding_status:
      readString(readRecord(observation?.cadence)?.status) ?? "active",
    visual_producer_cadence_receipt: observation,
    observation_refs: [observationRef],
    context_policy: "compact_context_pack_only",
    assistant_answer: false,
    raw_content_included: false,
  };
  const receiptArtifactId = `live_pipeline_turn_receipt:${input.turnId}`;
  const receiptArtifact = {
    schema: "helix.current_turn_artifact.v1",
    artifact_id: receiptArtifactId,
    kind: "live_pipeline_receipt",
    observation_kind: "live_pipeline_receipt",
    turn_id: input.turnId,
    source_scope: "current_turn_context",
    capability_key: LIVE_PIPELINE_SET_RATE_CAPABILITY,
    source_capability_id: LIVE_PIPELINE_SET_RATE_CAPABILITY,
    status: "succeeded",
    support_refs: [observationRef],
    payload: receipt,
    terminal_eligible: false,
    assistant_answer: false,
    raw_content_included: false,
  };
  const actionEnvelope = buildLivePipelineActionEnvelope({
    actions: [LIVE_PIPELINE_SET_RATE_CAPABILITY],
    pipelineReceiptId: receiptId,
  });
  const toolTraceDisclosure = buildLivePipelineToolTraceDisclosure({
    turnId: input.turnId,
    actions: [LIVE_PIPELINE_SET_RATE_CAPABILITY],
    pipelineReceiptId: receiptId,
  });
  const authority = buildHelixTurnTerminalAuthority({
    thread_id: input.threadId,
    turn_id: input.turnId,
    route: input.route || "/ask/turn",
    final_answer_source: "live_pipeline_receipt",
    terminal_artifact_kind: "live_pipeline_receipt",
    terminal_text: text,
    terminal_item_id: receiptArtifactId,
    terminal_kind: "answer",
    authority_origin: "codex_provider_live_pipeline_control_receipt",
    server_authoritative: true,
    terminal_eligible: true,
    assistant_answer: false,
  });

  return {
    text,
    receipt,
    receiptArtifact,
    routeProductContract,
    canonicalGoalFrame,
    terminalArtifactSelectionGuard,
    productAuthorityGuard,
    routeAuthorityAudit,
    actionEnvelope,
    toolTraceDisclosure,
    authority,
    observationRef,
  };
};
