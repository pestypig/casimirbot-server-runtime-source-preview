import type { HelixModelTurnPacket } from "./model-turn-packet";

type RecordLike = Record<string, unknown>;

export type HelixModelTurnContextPolicyDecision = {
  schema: "helix.model_turn_context_policy_decision.v1";
  context_too_large: boolean;
  action: "none" | "compact_model_turn_packet";
  reason_codes: string[];
  prompt_preserved: true;
  answer_shortcut_allowed: false;
  deterministic_fallback_terminal_allowed: false;
  assistant_answer: false;
  raw_content_included: false;
};

export type HelixModelTurnContextPolicyResult = {
  schema: "helix.model_turn_context_policy_result.v1";
  packet: HelixModelTurnPacket;
  decision: HelixModelTurnContextPolicyDecision;
  assistant_answer: false;
  raw_content_included: false;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const estimateStringSize = (value: unknown): number =>
  typeof value === "string" ? value.length : JSON.stringify(value ?? "").length;

const clip = (value: string | undefined, max: number): string | undefined => {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

const packetContextSize = (packet: HelixModelTurnPacket): number =>
  packet.model_visible_artifacts.reduce((total, artifact) =>
    total + estimateStringSize(artifact.summary) + estimateStringSize(artifact.text), 0);

export function compactHelixModelTurnPacket(input: {
  packet: HelixModelTurnPacket;
  maxArtifactCount?: number;
  maxArtifactTextChars?: number;
  maxArtifactSummaryChars?: number;
}): HelixModelTurnPacket {
  const maxArtifactCount = Math.max(1, Math.floor(input.maxArtifactCount ?? 8));
  const maxArtifactTextChars = Math.max(80, Math.floor(input.maxArtifactTextChars ?? 360));
  const maxArtifactSummaryChars = Math.max(80, Math.floor(input.maxArtifactSummaryChars ?? 240));
  const compactArtifacts = input.packet.model_visible_artifacts.slice(-maxArtifactCount).map((artifact) => ({
    ...artifact,
    summary: clip(readString(artifact.summary), maxArtifactSummaryChars),
    text: clip(readString(artifact.text), maxArtifactTextChars),
  }));
  return {
    ...input.packet,
    prompt_text: input.packet.prompt_text,
    artifact_refs: compactArtifacts.map((artifact) => artifact.artifact_id),
    model_visible_artifacts: compactArtifacts,
    loop_policy: {
      ...input.packet.loop_policy,
      require_model_authored_terminal: true,
      deterministic_fallback_terminal_allowed: false,
    },
  };
}

export function applyHelixModelTurnContextPolicy(input: {
  packet: HelixModelTurnPacket;
  maxContextChars?: number;
  compactOptions?: {
    maxArtifactCount?: number;
    maxArtifactTextChars?: number;
    maxArtifactSummaryChars?: number;
  };
}): HelixModelTurnContextPolicyResult {
  const size = packetContextSize(input.packet);
  const maxContextChars = Math.max(1, Math.floor(input.maxContextChars ?? 12_000));
  const contextTooLarge = size > maxContextChars;
  const packet = contextTooLarge
    ? compactHelixModelTurnPacket({
        packet: input.packet,
        ...(input.compactOptions ?? {}),
      })
    : input.packet;
  return {
    schema: "helix.model_turn_context_policy_result.v1",
    packet,
    decision: {
      schema: "helix.model_turn_context_policy_decision.v1",
      context_too_large: contextTooLarge,
      action: contextTooLarge ? "compact_model_turn_packet" : "none",
      reason_codes: contextTooLarge ? ["model_turn_context_pressure"] : [],
      prompt_preserved: true,
      answer_shortcut_allowed: false,
      deterministic_fallback_terminal_allowed: false,
      assistant_answer: false,
      raw_content_included: false,
    },
    assistant_answer: false,
    raw_content_included: false,
  };
}
