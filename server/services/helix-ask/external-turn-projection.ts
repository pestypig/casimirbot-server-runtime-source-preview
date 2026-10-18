import type {
  HelixAgentPendingQuestion,
  HelixAgentTerminalAuthorityStatus,
} from "@shared/contracts/helix-agent-api.v1";
import { evidenceRequirementFamiliesForArtifactKind } from "../helix-agent-api/database-scope-policy";
import { verifyHelixCanonicalTerminalProjection } from "./canonical-terminal-projection-verifier";

type RecordLike = Record<string, unknown>;

export type HelixAskExternalTurnProjection = {
  schema: "helix.ask_external_turn_projection.v1";
  turn_id: string;
  terminal_authority_status: HelixAgentTerminalAuthorityStatus;
  terminal_authority_reason: string;
  terminal_product: {
    authority_ref: string;
    artifact_kind: string;
    text: string;
    supporting_evidence_refs: string[];
  } | null;
  observation_refs: string[];
  evidence_refs: string[];
  receipt_refs: string[];
  pending_questions: HelixAgentPendingQuestion[];
  unresolved_requirements: string[];
  satisfied_evidence_requirements: string[];
  missing_evidence_requirements: string[];
  answer_authority: false;
  assistant_answer: false;
  terminal_eligible: false;
  raw_content_included: false;
};

const record = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;

const string = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stringArray = (
  value: unknown,
  maxItems = 128,
  maxLength = 500,
): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .slice(0, maxItems)
            .map(string)
            .filter(
              (entry) =>
                entry.length > 0 &&
                entry.length <= maxLength &&
                !/[\u0000-\u001f\u007f]/.test(entry),
            ),
        ),
      )
    : [];

const canonicalPendingQuestions = (
  payload: RecordLike,
  turnId: string,
): HelixAgentPendingQuestion[] => {
  const pending =
    record(payload.pending_request) ?? record(payload.pending_server_request);
  if (!pending) return [];
  const requestId = string(pending.request_id);
  const pendingTurnId = string(pending.turn_id);
  const prompt = string(pending.prompt);
  if (
    !requestId ||
    requestId.length > 240 ||
    !prompt ||
    prompt.length > 2_000 ||
    (pendingTurnId && pendingTurnId !== turnId) ||
    string(pending.kind) !== "request_user_input"
  ) {
    return [];
  }
  const requiredFields = stringArray(pending.required_fields, 32, 120);
  const rawOptions = Array.isArray(pending.resolution_options)
    ? pending.resolution_options
    : [];
  const options = rawOptions
    .slice(0, 32)
    .map(record)
    .filter((entry): entry is RecordLike => Boolean(entry))
    .map((entry) => {
      const value = string(
        entry.value ?? entry.id ?? entry.subgoal_id ?? entry.option_id,
      ).slice(0, 500);
      const label = string(
        entry.label ??
          entry.summary ??
          entry.name ??
          entry.kind ??
          entry.subgoal_id,
      ).slice(0, 500);
      return value && label ? { value, label } : null;
    })
    .filter(
      (entry): entry is { value: string; label: string } => entry !== null,
    );
  return [
    {
      question_id: requestId,
      prompt,
      required_fields: requiredFields,
      options,
    },
  ];
};

const canonicalEvidence = (
  payload: RecordLike,
  turnId: string,
  terminalSupportRefs: ReadonlySet<string> | null,
): {
  observationRefs: string[];
  evidenceRefs: string[];
  receiptRefs: string[];
  artifactKinds: string[];
} => {
  const audit = record(payload.solver_artifact_reentry_audit);
  if (
    string(audit?.schema) !== "helix.solver_artifact_reentry_audit.v1" ||
    audit?.ok !== true ||
    string(audit?.turn_id) !== turnId
  ) {
    return {
      observationRefs: [],
      evidenceRefs: [],
      receiptRefs: [],
      artifactKinds: [],
    };
  }
  const artifacts = Array.isArray(audit.terminal_relevant_artifacts)
    ? audit.terminal_relevant_artifacts
    : [];
  const admitted = artifacts
    .slice(0, 256)
    .map(record)
    .filter((entry): entry is RecordLike => Boolean(entry))
    .filter(
      (entry) =>
        entry.selected_as_support === true &&
        entry.reentered_solver === true &&
        entry.allowed_by_terminal_authority === true &&
        stringArray(entry.failure_codes).length === 0,
    )
    .map((entry) => ({
      ref: string(entry.ref),
      kind: string(entry.kind).toLowerCase(),
    }))
    .filter(
      (entry) =>
        entry.ref.length > 0 &&
        entry.ref.length <= 500 &&
        entry.kind.length > 0 &&
        !/[\u0000-\u001f\u007f]/.test(entry.ref) &&
        (!terminalSupportRefs || terminalSupportRefs.has(entry.ref)),
    );
  return {
    observationRefs: Array.from(
      new Set(
        admitted
          .filter((entry) => /observation/.test(entry.kind))
          .map((entry) => entry.ref),
      ),
    ),
    receiptRefs: Array.from(
      new Set(
        admitted
          .filter((entry) => /receipt|evaluation|validation/.test(entry.kind))
          .map((entry) => entry.ref),
      ),
    ),
    evidenceRefs: Array.from(
      new Set(
        admitted
          .filter(
            (entry) =>
              !/observation|receipt|evaluation|validation/.test(entry.kind),
          )
          .map((entry) => entry.ref),
      ),
    ),
    artifactKinds: Array.from(new Set(admitted.map((entry) => entry.kind))),
  };
};

export const projectHelixAskExternalTurn = (input: {
  payload: RecordLike;
  status: number;
  turnId: string;
  threadId: string;
  requiredEvidence: readonly string[];
}): HelixAskExternalTurnProjection => {
  const payload = input.payload;
  const pendingQuestions = canonicalPendingQuestions(payload, input.turnId);
  const finalStatus = string(payload.final_status);
  const responseType = string(payload.response_type);
  const finalFailure =
    input.status >= 400 ||
    payload.ok === false ||
    ["final_failure", "pending_input", "needs_input"].includes(finalStatus) ||
    ["final_failure", "pending_input", "needs_input", "clarification"].includes(
      responseType,
    ) ||
    Boolean(string(payload.terminal_error_code)) ||
    Boolean(record(payload.typed_failure));
  const terminalVerification = verifyHelixCanonicalTerminalProjection({
    payload,
    turnId: input.turnId,
    threadId: input.threadId,
  });
  const supportRefs = terminalVerification.ok
    ? new Set(terminalVerification.supportingEvidenceRefs)
    : null;
  const evidence = canonicalEvidence(payload, input.turnId, supportRefs);
  const availableEvidenceRequirements = new Set(
    evidence.artifactKinds.flatMap((kind) => [
      kind,
      ...evidenceRequirementFamiliesForArtifactKind(kind),
    ]),
  );
  const requiredEvidence = Array.from(
    new Set((input.requiredEvidence ?? []).map(string).filter(Boolean)),
  );
  const satisfiedEvidenceRequirements = requiredEvidence.filter((requirement) =>
    availableEvidenceRequirements.has(requirement),
  );
  const missingEvidenceRequirements = requiredEvidence.filter(
    (requirement) => !availableEvidenceRequirements.has(requirement),
  );
  const authorized =
    !finalFailure &&
    pendingQuestions.length === 0 &&
    missingEvidenceRequirements.length === 0 &&
    terminalVerification.ok;
  const terminalReason =
    pendingQuestions.length > 0
      ? "user_input_required"
      : finalFailure
        ? "failure_or_pending_projection"
        : missingEvidenceRequirements.length > 0
          ? "required_current_turn_evidence_missing"
          : terminalVerification.reason;

  return {
    schema: "helix.ask_external_turn_projection.v1",
    turn_id: input.turnId,
    terminal_authority_status: authorized
      ? "authorized"
      : pendingQuestions.length > 0
        ? "pending_helix_terminal_authority"
        : "blocked",
    terminal_authority_reason: terminalReason,
    terminal_product:
      authorized && terminalVerification.ok
        ? {
            authority_ref: terminalVerification.authorityRef,
            artifact_kind: terminalVerification.artifactKind,
            text: terminalVerification.terminalText,
            supporting_evidence_refs:
              terminalVerification.supportingEvidenceRefs,
          }
        : null,
    observation_refs: evidence.observationRefs,
    evidence_refs: evidence.evidenceRefs,
    receipt_refs: evidence.receiptRefs,
    pending_questions: pendingQuestions,
    unresolved_requirements: pendingQuestions.flatMap(
      (question) => question.required_fields,
    ),
    satisfied_evidence_requirements: satisfiedEvidenceRequirements,
    missing_evidence_requirements: missingEvidenceRequirements,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
};
