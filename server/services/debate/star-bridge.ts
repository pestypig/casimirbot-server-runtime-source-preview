import { Buffer } from "node:buffer";
import { createStarClient, type StarClient } from "../../../modules/star-client";
import {
  collapseConfidence,
  decideCoherenceAction,
  type CoherenceAction,
} from "../../../modules/policies/coherence-governor";
import { type TInformationEvent, type TTelemetrySnapshot } from "@shared/star-telemetry";

type DebateRole = "proponent" | "skeptic" | "referee";

export type StarSyncResult = {
  snapshot: TTelemetrySnapshot;
  action: CoherenceAction;
  confidence: number;
};

const flagEnabled = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === "1") return true;
  if (value === "0") return false;
  return defaultValue;
};

const STAR_SERVICE_AVAILABLE = flagEnabled(process.env.ENABLE_STAR_SERVICE ?? process.env.ENABLE_STAR, true);

const STAR_ENABLED =
  flagEnabled(process.env.DEBATE_STAR_ENABLE, STAR_SERVICE_AVAILABLE) || Boolean(process.env.STAR_SERVICE_URL);

let cachedClient: StarClient | null = null;

const getClient = (): StarClient | null => {
  if (!STAR_ENABLED) return null;
  if (cachedClient) return cachedClient;
  const port = process.env.PORT ?? "3000";
  const baseUrl =
    process.env.STAR_SERVICE_URL ??
    (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/+$/, "")}/api/star` : `http://127.0.0.1:${port}/api/star`);
  cachedClient = createStarClient({ baseUrl });
  return cachedClient;
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const complexityFromBytes = (bytes: number): number => {
  // Map text size to a soft complexity band; bias toward mid-range to avoid zeros.
  const normalized = bytes / 2048; // ~2 KB as a reference chunk
  return clamp(normalized, 0.05, 1);
};

export const isStarTelemetryEnabled = (): boolean => STAR_ENABLED;

export type DebateEventPayload = {
  debateId: string;
  goal: string;
  role: DebateRole;
  round: number;
  text: string;
  score?: number;
  improvement?: number;
  verifierPass?: number;
  toolCallsUsed?: number;
  alignment?: number;
  environmentTags?: string[];
  timestamp?: number;
};

export async function sendStarDebateEvent(payload: DebateEventPayload): Promise<StarSyncResult | null> {
  const client = getClient();
  if (!client) return null;

  const bytes = Buffer.byteLength(payload.text ?? "", "utf8");
  const alignment =
    payload.alignment ??
    (payload.role === "proponent" ? 0.25 : payload.role === "skeptic" ? -0.25 : 0);

  const event: TInformationEvent = {
    session_id: payload.debateId,
    session_type: "debate",
    origin: "model",
    bytes,
    complexity_score: complexityFromBytes(bytes),
    branch_id: `${payload.role}-r${payload.round}`,
    environment_tags: payload.environmentTags ?? [`role:${payload.role}`, "debate"],
    alignment: clamp(alignment, -1, 1),
    timestamp: payload.timestamp ?? Date.now(),
    metadata: {
      session_type: "debate",
      goal: payload.goal,
      round: payload.round,
      role: payload.role,
      score: payload.score,
      improvement: payload.improvement,
      verifier_pass: payload.verifierPass,
      tool_calls_used: payload.toolCallsUsed,
    },
  };

  try {
    const snapshot = await client.sendEvent(event);
    return {
      snapshot,
      action: decideCoherenceAction(snapshot),
      confidence: collapseConfidence(snapshot),
    };
  } catch (error) {
    console.warn("[star] failed to send debate event", error);
    return null;
  }
}

export type { CoherenceAction } from "../../../modules/policies/coherence-governor";
