import {
  HELIX_TERMINAL_GROUNDING_AUTHORITY_SCHEMA,
  type HelixTerminalGroundingAuthority,
} from "@shared/helix-terminal-grounding-authority";
import { enforceHelixTerminalAuthority } from "./terminal-authority-enforcer";
import { hashHelixTerminalText } from "./turn-terminal-authority";

type RecordLike = Record<string, unknown>;

const record = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(value.map(text).filter(Boolean)),
      )
    : [];

const normalizeSha256 = (value: unknown): string | null => {
  const selected = text(value).toLowerCase().replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(selected) ? `sha256:${selected}` : null;
};

export type HelixCanonicalTerminalProjectionVerification =
  | {
      ok: true;
      reason: "canonical_terminal_authority_verified";
      authority: HelixTerminalGroundingAuthority;
      authorityRef: string;
      artifactRef: string;
      artifactKind: string;
      finalAnswerSource: string;
      terminalText: string;
      supportingEvidenceRefs: string[];
    }
  | {
      ok: false;
      reason: string;
      authority: null;
    };

export const verifyHelixCanonicalTerminalProjection = (input: {
  payload: RecordLike;
  turnId: string;
  threadId: string;
}): HelixCanonicalTerminalProjectionVerification => {
  const groundingRecord = record(input.payload.terminal_grounding_authority);
  if (
    groundingRecord?.schema !== HELIX_TERMINAL_GROUNDING_AUTHORITY_SCHEMA ||
    groundingRecord.authority_source !== "canonical_terminal_boundary"
  ) {
    return { ok: false, reason: "canonical_grounding_authority_missing", authority: null };
  }
  const grounding =
    groundingRecord as unknown as HelixTerminalGroundingAuthority;
  if (grounding.turn_id !== input.turnId) {
    return { ok: false, reason: "canonical_grounding_turn_mismatch", authority: null };
  }
  if (
    !text(grounding.authority_id) ||
    grounding.completed_solver_path !== true ||
    grounding.route_authority_ok !== true ||
    grounding.poison_audit_ok !== true ||
    grounding.terminal_authority_ok !== true ||
    grounding.support_coverage_complete !== true ||
    grounding.assistant_answer !== false ||
    grounding.terminal_eligible !== false ||
    grounding.provider_payload_included !== false ||
    grounding.raw_content_included !== false ||
    strings(grounding.failure_codes).length > 0 ||
    grounding.failure_code !== null
  ) {
    return { ok: false, reason: "canonical_grounding_integrity_blocked", authority: null };
  }
  const supportingEvidenceRefs = strings(grounding.selected_evidence_refs);
  if (
    grounding.grounding_required
      ? (
          grounding.status !== "validated" ||
          grounding.current_turn_only !== true ||
          supportingEvidenceRefs.length === 0 ||
          ![
            "runtime_event_log",
            "route_self_terminal",
          ].includes(String(grounding.evidence_reentry_authority))
        )
      : grounding.status !== "not_required" ||
        supportingEvidenceRefs.length !== 0
  ) {
    return { ok: false, reason: "canonical_grounding_status_blocked", authority: null };
  }

  const presentation = record(input.payload.terminal_presentation);
  const terminalText = text(presentation?.concise_text);
  const artifactKind = text(presentation?.terminal_artifact_kind);
  if (
    presentation?.schema !== "helix.terminal_presentation.v1" ||
    text(presentation.turn_id) !== input.turnId ||
    !terminalText ||
    !artifactKind ||
    presentation.assistant_answer !== false ||
    presentation.raw_content_included !== false
  ) {
    return { ok: false, reason: "canonical_terminal_presentation_invalid", authority: null };
  }

  const terminalAuthority = record(input.payload.terminal_answer_authority);
  const singleWriter = record(input.payload.terminal_authority_single_writer);
  const writerIntegrity = record(singleWriter?.integrity);
  const artifactRef = text(
    grounding.terminal_artifact_ref ??
      terminalAuthority?.terminal_artifact_ref ??
      singleWriter?.selected_terminal_artifact_ref,
  );
  const finalAnswerSource = text(
    grounding.final_answer_source ??
      terminalAuthority?.final_answer_source ??
      input.payload.final_answer_source,
  );
  const declaredArtifactRefs = [
    text(terminalAuthority?.terminal_artifact_ref),
    text(singleWriter?.selected_terminal_artifact_ref),
    text(presentation.terminal_authority_ref),
    text(presentation.terminal_artifact_ref),
  ].filter(Boolean);
  const declaredKinds = [
    artifactKind,
    text(grounding.terminal_artifact_kind),
    text(terminalAuthority?.terminal_artifact_kind),
    text(singleWriter?.selected_terminal_artifact_kind),
  ].filter(Boolean);
  const declaredSources = [
    finalAnswerSource,
    text(terminalAuthority?.final_answer_source),
    text(presentation.final_answer_source),
    text(input.payload.final_answer_source),
  ].filter(Boolean);
  if (
    !artifactRef ||
    !finalAnswerSource ||
    declaredArtifactRefs.some((entry) => entry !== artifactRef) ||
    declaredKinds.some((entry) => entry !== artifactKind) ||
    declaredSources.some((entry) => entry !== finalAnswerSource)
  ) {
    return { ok: false, reason: "canonical_terminal_identity_mismatch", authority: null };
  }

  const declaredHash = normalizeSha256(grounding.terminal_text_hash);
  const authorityHash = normalizeSha256(
    terminalAuthority?.terminal_text_hash,
  );
  const computedHash = `sha256:${hashHelixTerminalText(terminalText)}`;
  if (
    !declaredHash ||
    declaredHash !== computedHash ||
    !authorityHash ||
    authorityHash !== computedHash
  ) {
    return { ok: false, reason: "canonical_terminal_text_hash_mismatch", authority: null };
  }

  if (
    terminalAuthority?.schema !== "helix.turn_terminal_authority.v1" ||
    text(terminalAuthority.thread_id) !== input.threadId ||
    text(terminalAuthority.turn_id) !== input.turnId ||
    terminalAuthority.server_authoritative !== true ||
    terminalAuthority.terminal_eligible !== true ||
    terminalAuthority.assistant_answer !== false
  ) {
    return { ok: false, reason: "terminal_authority_record_blocked", authority: null };
  }
  if (
    singleWriter?.schema !==
      "helix.terminal_authority_single_writer_result.v1" ||
    text(singleWriter.turn_id) !== input.turnId ||
    singleWriter.assistant_answer !== false ||
    text(singleWriter.source) === "terminal_authority_repair_failure" ||
    writerIntegrity?.single_writer_applied !== true ||
    writerIntegrity.visible_matches_selected_artifact !== true ||
    writerIntegrity.stale_failure_visible !== false ||
    writerIntegrity.receipt_visible_as_answer !== false ||
    writerIntegrity.payload_mirror_written_after_terminal_selection !== true ||
    Boolean(text(writerIntegrity.terminal_projection_failure_code))
  ) {
    return { ok: false, reason: "single_writer_integrity_blocked", authority: null };
  }

  const enforcement = enforceHelixTerminalAuthority({
    thread_id: input.threadId,
    turn_id: input.turnId,
    payload: input.payload,
  });
  if (!enforcement.ok) {
    return {
      ok: false,
      reason:
        enforcement.blocking_reasons[0] ??
        enforcement.blocking_condition,
      authority: null,
    };
  }

  return {
    ok: true,
    reason: "canonical_terminal_authority_verified",
    authority: grounding,
    authorityRef: grounding.authority_id,
    artifactRef,
    artifactKind,
    finalAnswerSource,
    terminalText,
    supportingEvidenceRefs,
  };
};
