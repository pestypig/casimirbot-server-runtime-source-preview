import type { HelixTerminalAuthority } from "@shared/helix-turn-poison-guard";
import { resolveTerminalAnswerEnvelope } from "./terminal-answer-envelope";

// Verify-only runtime-authority check. This module must not mint terminal authority;
// the guarded terminal boundary is the only writer allowed to create authority.
export type HelixTerminalAuthorityEnforcementResult = {
  schema: "helix.terminal_authority_enforcement.v1";
  ok: boolean;
  authority: HelixTerminalAuthority | null;
  blocking_condition: "none" | "terminal_authority_missing" | "terminal_authority_stale";
  blocking_reasons: string[];
  expected: {
    route: string | null;
    route_base: string | null;
    terminal_text: string;
    terminal_artifact_kind: string;
    final_answer_source: string;
  };
  observed: {
    route: string | null;
    route_base: string | null;
    terminal_text: string | null;
    terminal_artifact_kind: string | null;
    final_answer_source: string | null;
    server_authoritative: boolean;
  };
  assistant_answer: false;
  raw_content_included: false;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const routeBase = (route: string | null): string | null =>
  route ? route.split("/")[0]?.trim() || route : null;

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function enforceHelixTerminalAuthority(input: {
  thread_id: string;
  turn_id?: string | null;
  payload: Record<string, unknown>;
}): HelixTerminalAuthorityEnforcementResult {
  const existingRecord = readRecord(input.payload.terminal_answer_authority);
  const envelope = resolveTerminalAnswerEnvelope(input.payload, {
    threadId: input.thread_id,
    turnId: input.turn_id,
  });
  const currentRoute =
    readString(input.payload.route_reason_code) ??
    readString(input.payload.route);
  const currentRouteBase = routeBase(currentRoute);
  const existingRoute = readString(existingRecord?.route);
  const existingRouteBase = routeBase(existingRoute);
  const existingTerminalArtifactKind = readString(existingRecord?.terminal_artifact_kind);
  const existingFinalAnswerSource = readString(existingRecord?.final_answer_source);
  const existingTerminalText = readString(existingRecord?.terminal_text_preview);
  const observed = {
    route: existingRoute,
    route_base: existingRouteBase,
    terminal_text: existingTerminalText,
    terminal_artifact_kind: existingTerminalArtifactKind,
    final_answer_source: existingFinalAnswerSource,
    server_authoritative: existingRecord?.server_authoritative === true,
  };
  const expected = {
    route: currentRoute,
    route_base: currentRouteBase,
    terminal_text: envelope.terminal_text,
    terminal_artifact_kind: envelope.terminal_artifact_kind,
    final_answer_source: envelope.final_answer_source,
  };
  const blockingReasons: string[] = [];
  if (!existingRecord) {
    blockingReasons.push("terminal_authority_missing");
  } else {
    if (existingRecord.server_authoritative !== true) blockingReasons.push("terminal_authority_not_server_authoritative");
    if (existingTerminalText !== envelope.terminal_text) blockingReasons.push("terminal_authority_text_stale");
    if (currentRouteBase && existingRouteBase && currentRouteBase !== existingRouteBase) {
      blockingReasons.push("terminal_authority_route_stale");
    }
    if (existingTerminalArtifactKind && existingTerminalArtifactKind !== envelope.terminal_artifact_kind) {
      blockingReasons.push("terminal_authority_artifact_kind_stale");
    }
    if (existingFinalAnswerSource && existingFinalAnswerSource !== envelope.final_answer_source) {
      blockingReasons.push("terminal_authority_final_answer_source_stale");
    }
  }
  const ok = blockingReasons.length === 0;
  return {
    schema: "helix.terminal_authority_enforcement.v1",
    ok,
    authority: ok ? (existingRecord as HelixTerminalAuthority) : null,
    blocking_condition: ok
      ? "none"
      : existingRecord
        ? "terminal_authority_stale"
        : "terminal_authority_missing",
    blocking_reasons: blockingReasons,
    expected,
    observed,
    assistant_answer: false,
    raw_content_included: false,
  };
}
