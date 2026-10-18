import {
  type HelixModelTurnResult,
  runHelixModelTurn,
} from "./model-turn-executor";
import {
  type HelixModelTurnPacket,
  buildHelixModelTurnPacket,
} from "./model-turn-packet";
import { applyModelTurnAssistantMessageAsFinalDraft } from "./model-turn-final-draft";
import {
  assertCapabilityAllowedByCommittedRoute,
  readCommittedAskRoute,
} from "./committed-ask-route";

type RecordLike = Record<string, unknown>;

export type HelixModelTurnToolCall = NonNullable<HelixModelTurnResult["requested_tool_call"]>;

export type HelixModelTurnToolObservationArtifact = {
  artifact_id: string;
  turn_id: string;
  kind: "model_turn_tool_observation";
  payload: {
    schema: "helix.model_turn_tool_observation.v1";
    kind: "model_turn_tool_observation";
    capability_id: string;
    args: RecordLike;
    status: "succeeded" | "failed" | "blocked" | "missing_input" | "client_pending";
    summary: string;
    result?: RecordLike;
    terminal_eligible: false;
    post_tool_model_step_required: true;
    assistant_answer: false;
    raw_content_included: false;
  };
};

export type HelixModelTurnToolContinuationResult = {
  schema: "helix.model_turn_tool_continuation_result.v1";
  turn_id: string;
  status:
    | "no_tool_requested"
    | "continued_to_assistant_message"
    | "continued_to_request_user_input"
    | "continued_to_typed_failure"
    | "tool_continuation_blocked";
  packets: HelixModelTurnPacket[];
  model_turn_results: HelixModelTurnResult[];
  observation_artifacts: HelixModelTurnToolObservationArtifact[];
  payload: RecordLike;
  assistant_answer: false;
  raw_content_included: false;
};

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizeToolStatus = (value: unknown): HelixModelTurnToolObservationArtifact["payload"]["status"] => {
  const text = readString(value);
  if (
    text === "succeeded" ||
    text === "failed" ||
    text === "blocked" ||
    text === "missing_input" ||
    text === "client_pending"
  ) {
    return text;
  }
  return "succeeded";
};

export function buildModelTurnToolObservationArtifact(input: {
  turnId: string;
  iteration: number;
  toolCall: HelixModelTurnToolCall;
  result: RecordLike;
}): HelixModelTurnToolObservationArtifact {
  const status = normalizeToolStatus(input.result.status);
  const summary =
    readString(input.result.summary) ??
    `${input.toolCall.capability_id} produced a non-terminal tool observation.`;
  const slug = input.toolCall.capability_id.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "tool";
  return {
    artifact_id: `${input.turnId}:model_turn_tool_observation:${input.iteration}:${slug}`,
    turn_id: input.turnId,
    kind: "model_turn_tool_observation",
    payload: {
      schema: "helix.model_turn_tool_observation.v1",
      kind: "model_turn_tool_observation",
      capability_id: input.toolCall.capability_id,
      args: input.toolCall.args,
      status,
      summary,
      result: input.result,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
  };
}

const statusFromSecondResult = (result: HelixModelTurnResult): HelixModelTurnToolContinuationResult["status"] => {
  if (result.status === "assistant_message") return "continued_to_assistant_message";
  if (result.status === "request_user_input") return "continued_to_request_user_input";
  if (result.status === "typed_failure") return "continued_to_typed_failure";
  return "tool_continuation_blocked";
};

export async function runHelixModelTurnToolContinuation(input: {
  packet: HelixModelTurnPacket;
  payload: RecordLike;
  artifactLedger?: RecordLike[];
  availableCapabilities?: unknown[];
  executeCapability: (toolCall: HelixModelTurnToolCall) => Promise<RecordLike> | RecordLike;
  testResponseOverrides?: Array<string | RecordLike | undefined>;
  runModelTurn?: typeof runHelixModelTurn;
}): Promise<HelixModelTurnToolContinuationResult> {
  const runner = input.runModelTurn ?? runHelixModelTurn;
  const payload = { ...input.payload };
  const firstResult = await runner({
    packet: input.packet,
    payload,
    testResponseOverride: input.testResponseOverrides?.[0],
  });
  payload.model_turn_packet = input.packet;
  payload.model_turn_result = firstResult;

  if (firstResult.status !== "tool_call_requested" || !firstResult.requested_tool_call) {
    if (firstResult.status === "assistant_message" && firstResult.assistant_message_text) {
      applyModelTurnAssistantMessageAsFinalDraft({
        turnId: input.packet.turn_id,
        payload,
        text: firstResult.assistant_message_text,
        modelTurnResult: firstResult,
        outputBudget: input.packet.output_budget,
      });
    }
    return {
      schema: "helix.model_turn_tool_continuation_result.v1",
      turn_id: input.packet.turn_id,
      status: "no_tool_requested",
      packets: [input.packet],
      model_turn_results: [firstResult],
      observation_artifacts: [],
      payload,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  const committedRoute = input.packet.committed_ask_route ?? readCommittedAskRoute(payload);
  const committedRouteAdmission = assertCapabilityAllowedByCommittedRoute({
    committedRoute,
    capabilityId: firstResult.requested_tool_call.capability_id,
    args: firstResult.requested_tool_call.args,
    fromShortcut: false,
  });
  payload.committed_route_tool_admission = committedRouteAdmission;
  if (!committedRouteAdmission.allowed) {
    const blockedResult: RecordLike = {
      status: "blocked",
      summary: `Capability ${firstResult.requested_tool_call.capability_id} blocked by committed route: ${committedRouteAdmission.reason}.`,
      committed_route_tool_admission: committedRouteAdmission,
      assistant_answer: false,
      raw_content_included: false,
    };
    const observation = buildModelTurnToolObservationArtifact({
      turnId: input.packet.turn_id,
      iteration: 1,
      toolCall: firstResult.requested_tool_call,
      result: blockedResult,
    });
    payload.model_turn_tool_observation = observation.payload;
    return {
      schema: "helix.model_turn_tool_continuation_result.v1",
      turn_id: input.packet.turn_id,
      status: "tool_continuation_blocked",
      packets: [input.packet],
      model_turn_results: [firstResult],
      observation_artifacts: [observation],
      payload,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  const toolResult = await input.executeCapability(firstResult.requested_tool_call);
  const observation = buildModelTurnToolObservationArtifact({
    turnId: input.packet.turn_id,
    iteration: 1,
    toolCall: firstResult.requested_tool_call,
    result: toolResult,
  });
  const nextPayload = {
    ...payload,
    model_turn_tool_observation: observation.payload,
  };
  const nextPacket = buildHelixModelTurnPacket({
    turnId: input.packet.turn_id,
    promptText: input.packet.prompt_text,
    payload: {
      ...nextPayload,
      route_reason_code: input.packet.route_reason_code,
      canonical_goal_frame: input.packet.canonical_goal_frame,
      source_target_intent: input.packet.source_target_intent,
      route_product_contract: input.packet.route_product_contract,
      committed_ask_route: input.packet.committed_ask_route,
      compound_prompt_contract: input.packet.compound_prompt_contract,
    },
    artifactLedger: [...(input.artifactLedger ?? []), observation],
    availableCapabilities: input.availableCapabilities ?? input.packet.available_capabilities,
    outputBudget: input.packet.output_budget,
  });
  const secondResult = await runner({
    packet: nextPacket,
    payload: nextPayload,
    testResponseOverride: input.testResponseOverrides?.[1],
  });
  nextPayload.model_turn_packet = nextPacket;
  nextPayload.model_turn_result = secondResult;

  if (secondResult.status === "assistant_message" && secondResult.assistant_message_text) {
    applyModelTurnAssistantMessageAsFinalDraft({
      turnId: input.packet.turn_id,
      payload: nextPayload,
      text: secondResult.assistant_message_text,
      modelTurnResult: secondResult,
      outputBudget: input.packet.output_budget,
    });
  }

  return {
    schema: "helix.model_turn_tool_continuation_result.v1",
    turn_id: input.packet.turn_id,
    status: statusFromSecondResult(secondResult),
    packets: [input.packet, nextPacket],
    model_turn_results: [firstResult, secondResult],
    observation_artifacts: [observation],
    payload: nextPayload,
    assistant_answer: false,
    raw_content_included: false,
  };
}
