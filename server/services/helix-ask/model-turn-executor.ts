import type { HelixModelTurnPacket } from "./model-turn-packet";

type RecordLike = Record<string, unknown>;

export type HelixModelTurnRuntimeAdapter = (input: {
  packet: HelixModelTurnPacket;
  payload: RecordLike;
}) => Promise<string | RecordLike | HelixModelTurnResult>;

export type HelixModelTurnResult = {
  schema: "helix.model_turn_result.v1";
  turn_id: string;
  status: "assistant_message" | "tool_call_requested" | "request_user_input" | "typed_failure";
  assistant_message_text?: string;
  requested_tool_call?: {
    capability_id: string;
    args: RecordLike;
    reason?: string;
  };
  model_step_capability: string;
  consumed_packet_ref: string;
  output_budget?: RecordLike;
  assistant_answer: false;
  raw_content_included: false;
};

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function coerceTestOverrideToModelTurnResult(input: {
  packet: HelixModelTurnPacket;
  override: string | RecordLike;
}): HelixModelTurnResult {
  const record = readRecord(input.override);
  const status = readString(record?.status);
  const text = typeof input.override === "string"
    ? input.override
    : readString(record?.text) ?? readString(record?.assistant_message_text) ?? "";
  if (status === "tool_call_requested") {
    const requested = readRecord(record?.requested_tool_call);
    return {
      schema: "helix.model_turn_result.v1",
      turn_id: input.packet.turn_id,
      status: "tool_call_requested",
      requested_tool_call: {
        capability_id: readString(requested?.capability_id) ?? "unknown",
        args: readRecord(requested?.args) ?? {},
        reason: readString(requested?.reason) ?? undefined,
      },
      model_step_capability: "model.turn.test_override",
      consumed_packet_ref: `${input.packet.turn_id}:model_turn_packet`,
      output_budget: input.packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  if (status === "request_user_input" || status === "typed_failure") {
    return {
      schema: "helix.model_turn_result.v1",
      turn_id: input.packet.turn_id,
      status,
      assistant_message_text: text,
      model_step_capability: "model.turn.test_override",
      consumed_packet_ref: `${input.packet.turn_id}:model_turn_packet`,
      output_budget: input.packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  return {
    schema: "helix.model_turn_result.v1",
    turn_id: input.packet.turn_id,
    status: "assistant_message",
    assistant_message_text: text,
    model_step_capability: "model.turn.test_override",
    consumed_packet_ref: `${input.packet.turn_id}:model_turn_packet`,
    output_budget: input.packet.output_budget,
    assistant_answer: false,
    raw_content_included: false,
  };
}

const isHelixModelTurnResult = (value: unknown): value is HelixModelTurnResult => {
  const record = readRecord(value);
  return record?.schema === "helix.model_turn_result.v1";
};

export function coerceRuntimeAdapterToModelTurnResult(input: {
  packet: HelixModelTurnPacket;
  adapterResult: string | RecordLike | HelixModelTurnResult;
}): HelixModelTurnResult {
  if (isHelixModelTurnResult(input.adapterResult)) {
    return {
      ...input.adapterResult,
      output_budget: input.adapterResult.output_budget ?? input.packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  const record = readRecord(input.adapterResult);
  const status = readString(record?.status);
  const text = typeof input.adapterResult === "string"
    ? input.adapterResult
    : readString(record?.text) ?? readString(record?.assistant_message_text) ?? "";
  if (status === "tool_call_requested") {
    const requested = readRecord(record?.requested_tool_call);
    return {
      schema: "helix.model_turn_result.v1",
      turn_id: input.packet.turn_id,
      status: "tool_call_requested",
      requested_tool_call: {
        capability_id: readString(requested?.capability_id) ?? "unknown",
        args: readRecord(requested?.args) ?? {},
        reason: readString(requested?.reason) ?? undefined,
      },
      model_step_capability: readString(record?.model_step_capability) ?? "model.turn.runtime_adapter",
      consumed_packet_ref: readString(record?.consumed_packet_ref) ?? `${input.packet.turn_id}:model_turn_packet`,
      output_budget: readRecord(record?.output_budget) ?? input.packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  if (status === "request_user_input" || status === "typed_failure") {
    return {
      schema: "helix.model_turn_result.v1",
      turn_id: input.packet.turn_id,
      status,
      assistant_message_text: text,
      model_step_capability: readString(record?.model_step_capability) ?? "model.turn.runtime_adapter",
      consumed_packet_ref: readString(record?.consumed_packet_ref) ?? `${input.packet.turn_id}:model_turn_packet`,
      output_budget: readRecord(record?.output_budget) ?? input.packet.output_budget,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  return {
    schema: "helix.model_turn_result.v1",
    turn_id: input.packet.turn_id,
    status: "assistant_message",
    assistant_message_text: text,
    model_step_capability: readString(record?.model_step_capability) ?? "model.turn.runtime_adapter",
    consumed_packet_ref: readString(record?.consumed_packet_ref) ?? `${input.packet.turn_id}:model_turn_packet`,
    output_budget: readRecord(record?.output_budget) ?? input.packet.output_budget,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export async function runHelixModelTurn(input: {
  packet: HelixModelTurnPacket;
  payload: RecordLike;
  testResponseOverride?: string | RecordLike;
  runtimeAdapter?: HelixModelTurnRuntimeAdapter;
}): Promise<HelixModelTurnResult> {
  if (input.testResponseOverride !== undefined) {
    return coerceTestOverrideToModelTurnResult({
      packet: input.packet,
      override: input.testResponseOverride,
    });
  }
  if (input.runtimeAdapter) {
    try {
      const adapterResult = await input.runtimeAdapter({
        packet: input.packet,
        payload: input.payload,
      });
      return coerceRuntimeAdapterToModelTurnResult({
        packet: input.packet,
        adapterResult,
      });
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message.slice(0, 240)
        : "model_turn_runtime_adapter_failed";
      return {
        schema: "helix.model_turn_result.v1",
        turn_id: input.packet.turn_id,
        status: "typed_failure",
        assistant_message_text: message,
        model_step_capability: "model.turn.runtime_adapter_failed",
        consumed_packet_ref: `${input.packet.turn_id}:model_turn_packet`,
        output_budget: input.packet.output_budget,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
  }
  return {
    schema: "helix.model_turn_result.v1",
    turn_id: input.packet.turn_id,
    status: "typed_failure",
    assistant_message_text: "Model turn execution requires the shared Ask runtime adapter or a deterministic test override.",
    model_step_capability: "model.turn.runtime_adapter_required",
    consumed_packet_ref: `${input.packet.turn_id}:model_turn_packet`,
    output_budget: input.packet.output_budget,
    assistant_answer: false,
    raw_content_included: false,
  };
}
