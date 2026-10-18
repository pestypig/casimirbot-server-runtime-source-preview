import { auditHelixAskContextForPoison } from "./ask-context-poison-audit";
import { auditTerminalPresentationCoverage } from "./terminal-presentation-coverage-audit";
import {
  buildHelixTurnTerminalAuthority,
  hashHelixTerminalText,
} from "./turn-terminal-authority";
import {
  evaluateTerminalBoundaryEligibility,
  type HelixRuntimeAuthorityBoundaryReport,
} from "./runtime-authority-contract";
import { evaluateRepoAnswerTextQualityGate } from "./repo-answer-text-quality-gate";
import { applyPostToolAuthorityBridgeRepair } from "./post-tool-authority-bridge";
import {
  evaluateVisibleAnswerPolicyFaithfulnessGate,
  unsupportedLanyonBoundaryPresentationLine,
} from "./visible-answer-policy-faithfulness-gate";
import {
  HELIX_VISIBLE_ANSWER_POLICY_TERMINAL_RETRY_LIMIT,
  theoryExecutionClosureViolationIsTerminallyRepairable,
  visibleAnswerPolicyTerminalRetryAttemptsConsumed,
} from "./visible-answer-policy-terminal-retry";
import {
  buildHelixLocalizedTypedFailureTextForPayload,
  isHelixGenericTypedFailureText,
} from "./language-contract";
import { liveSourceModelSynthesisMissingFailure } from "./live-source-terminal-failure-repair";
import type { HelixTerminalAuthority } from "@shared/helix-turn-poison-guard";
import {
  committedRouteAllowsTerminalKind,
  readCommittedAskRoute,
} from "./committed-ask-route";
import { isWorkstationObservationTerminalKind } from "./tool-family-terminal-policy";
import { applyCompoundTerminalPolicy } from "./compound-terminal-policy";
import { requestedTheoryContextIdentityLine } from "./requested-theory-context-identity";

const UNAVAILABLE_TERMINAL_TEXT =
  "I could not produce a terminal answer for this turn.";

export type HelixTerminalAnswerEnvelope = {
  schema: "helix.terminal_answer_envelope.v1";
  turn_id: string;
  thread_id: string;
  source_target: string;
  terminal_artifact_kind: string;
  final_answer_source: string;
  terminal_text: string;
  terminal_text_hash: string;
  terminal_kind: HelixTerminalAuthority["terminal_kind"];
  authority_origin:
    | "terminal_presentation"
    | "repo_code_evidence_answer"
    | "selected_final_answer"
    | "agent_provider_route_product_materializer"
    | "workstation_tool_evaluation"
    | "capability_help_summary"
    | "request_user_input"
    | "tool_receipt"
    | "typed_failure";
  assistant_answer: false;
  raw_content_included: false;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readTerminalPresentationText = (
  payload: Record<string, unknown>,
): string | null => {
  const presentation = readRecord(payload.terminal_presentation);
  return presentation?.schema === "helix.terminal_presentation.v1"
    ? readString(presentation.concise_text)
    : null;
};

const readWorkstationToolEvaluationText = (
  payload: Record<string, unknown>,
): string | null => {
  const synthesis = readRecord(payload.workstation_tool_terminal_synthesis);
  const synthesizedText =
    readString(synthesis?.text) ??
    readString(synthesis?.answer_text) ??
    readString(synthesis?.terminal_text) ??
    readString(synthesis?.synthesized_text);
  if (synthesizedText) return synthesizedText;

  const evaluation = readRecord(payload.workstation_tool_evaluation);
  const topLevelText =
    readString(evaluation?.answer_text) ??
    readString(evaluation?.text) ??
    readString(evaluation?.terminal_text) ??
    readString(evaluation?.summary);
  if (topLevelText) return topLevelText;

  const terminalArtifactId = readString(payload.terminal_artifact_id);
  const ledgerRecords = readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((artifact): artifact is Record<string, unknown> =>
      Boolean(artifact),
    );
  const matchingLedgerEvaluation =
    ledgerRecords
      .filter(
        (artifact) =>
          readString(artifact.kind) === "workstation_tool_evaluation",
      )
      .find((artifact) => {
        if (!terminalArtifactId) return true;
        return (
          readString(artifact.artifact_id) === terminalArtifactId ||
          readString(readRecord(artifact.payload)?.evaluation_id) ===
            terminalArtifactId
        );
      }) ??
    ledgerRecords
      .filter(
        (artifact) =>
          readString(artifact.kind) === "workstation_tool_evaluation",
      )
      .at(-1);
  const ledgerPayload =
    readRecord(matchingLedgerEvaluation?.payload) ?? matchingLedgerEvaluation;
  return (
    readString(ledgerPayload?.answer_text) ??
    readString(ledgerPayload?.text) ??
    readString(ledgerPayload?.terminal_text) ??
    readString(ledgerPayload?.summary)
  );
};

const readSourceTarget = (payload: Record<string, unknown>): string => {
  const committedRoute = readCommittedAskRoute(payload);
  return (
    committedRoute?.route?.source_target ??
    readString(readRecord(payload.route_product_contract)?.source_target) ??
    readString(readRecord(payload.source_target_intent)?.target_source) ??
    "unknown"
  );
};

const readTerminalArtifactKind = (payload: Record<string, unknown>): string =>
  readString(payload.terminal_artifact_kind) ?? "typed_failure";

const readFinalAnswerSource = (payload: Record<string, unknown>): string => {
  const terminalArtifactKind = readTerminalArtifactKind(payload);
  const finalAnswerSource = readString(payload.final_answer_source);
  if (
    terminalArtifactKind === "workstation_tool_evaluation" &&
    (!finalAnswerSource ||
      finalAnswerSource === "final_answer_draft" ||
      finalAnswerSource === "model_synthesized_answer")
  ) {
    return "workstation_tool_evaluation";
  }
  return finalAnswerSource ?? terminalArtifactKind;
};

const readValidRepoEvidenceAnswerText = (
  payload: Record<string, unknown>,
): string | null => {
  if (readTerminalArtifactKind(payload) !== "repo_code_evidence_answer")
    return null;
  const answer = readRecord(payload.repo_code_evidence_answer);
  const qualityGate = readRecord(payload.repo_answer_text_quality_gate);
  if (qualityGate && qualityGate.ok !== true) return null;
  if (!qualityGate && !canRecoverRepoEvidenceAnswerTerminal(payload, answer))
    return null;
  return readString(answer?.answer_text) ?? readString(answer?.text);
};

const normalizeRepoEvidenceAnswerCandidate = (
  value: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  if (!value) return null;
  const answerText = readString(value.answer_text) ?? readString(value.text);
  if (!answerText) return null;
  return {
    ...value,
    schema: readString(value.schema) ?? "helix.repo_code_evidence_answer.v1",
    artifact_id:
      readString(value.artifact_id) ??
      readString(value.ref) ??
      "repo_code_evidence_answer:recovered",
    answer_text: answerText,
    support_refs: [
      ...readArray(value.support_refs),
      ...readArray(value.source_observation_refs),
      ...readArray(value.artifact_refs),
      ...readArray(value.evidence_refs),
      ...readArray(value.grounded_in_observation_refs),
    ],
    assistant_answer: false,
    raw_content_included: false,
  };
};

const readRepoEvidenceAnswerPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> | null => {
  const topLevel = normalizeRepoEvidenceAnswerCandidate(
    readRecord(payload.repo_code_evidence_answer),
  );
  if (topLevel) return topLevel;
  const ledgerRecords = readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((artifact): artifact is Record<string, unknown> =>
      Boolean(artifact),
    );
  const ledgerAnswer =
    ledgerRecords
      .filter(
        (artifact) => readString(artifact.kind) === "repo_code_evidence_answer",
      )
      .map((artifact) =>
        normalizeRepoEvidenceAnswerCandidate(
          readRecord(artifact.payload) ?? artifact,
        ),
      )
      .find((entry): entry is Record<string, unknown> => Boolean(entry)) ??
    null;
  if (ledgerAnswer) return ledgerAnswer;
  const draft =
    readRecord(payload.final_answer_draft) ??
    ledgerRecords
      .filter((artifact) => readString(artifact.kind) === "final_answer_draft")
      .map((artifact) => readRecord(artifact.payload) ?? artifact)
      .find((entry): entry is Record<string, unknown> =>
        Boolean(readString(entry.text) ?? readString(entry.answer_text)),
      ) ??
    null;
  if (
    readString(draft?.model_step_capability) ===
      "model.synthesize_from_repo_evidence" &&
    (readString(draft?.text) ?? readString(draft?.answer_text))
  ) {
    return normalizeRepoEvidenceAnswerCandidate({
      schema: "helix.repo_code_evidence_answer.v1",
      artifact_id:
        readString(draft?.artifact_id) ??
        readString(draft?.draft_id) ??
        "repo_code_evidence_answer:from_final_answer_draft",
      answer_text: readString(draft?.text) ?? readString(draft?.answer_text),
      support_refs: [
        ...readArray(draft?.support_refs),
        ...readArray(draft?.artifact_refs),
        ...readArray(draft?.grounded_in_observation_refs),
      ],
      final_answer_draft_ref:
        readString(draft?.artifact_id) ?? readString(draft?.draft_id),
      final_answer_draft_authority: readString(draft?.authority),
      model_step_capability: readString(draft?.model_step_capability),
      model_authored:
        readString(draft?.authority) === "llm_post_observation_composer",
      assistant_answer: false,
      raw_content_included: false,
    });
  }
  return null;
};

const canRecoverRepoEvidenceAnswerTerminal = (
  payload: Record<string, unknown>,
  answer: Record<string, unknown> | null,
): answer is Record<string, unknown> => {
  if (!answer) return false;
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goalKind = readString(canonicalGoal?.goal_kind);
  if (
    goalKind !== "repo_entity_definition" &&
    goalKind !== "repo_code_evidence_question"
  )
    return false;
  if (
    readString(canonicalGoal?.required_terminal_kind) !==
    "repo_code_evidence_answer"
  )
    return false;
  if (!(readString(answer.answer_text) ?? readString(answer.text)))
    return false;
  const finalDraft = readRecord(payload.final_answer_draft);
  const supportRefs = [
    ...readArray(answer.support_refs),
    ...readArray(answer.source_observation_refs),
    ...readArray(answer.artifact_refs),
    ...readArray(answer.evidence_refs),
    ...readArray(answer.grounded_in_observation_refs),
    ...readArray(finalDraft?.support_refs),
    ...readArray(finalDraft?.artifact_refs),
    ...readArray(payload.current_turn_artifact_ledger).flatMap((entry) => {
      const artifact = readRecord(entry);
      const payloadRecord = readRecord(artifact?.payload);
      if (
        !/repo_code_evidence_observation|repo_docs_synthesis_packet/i.test(
          [readString(artifact?.kind), readString(payloadRecord?.schema)].join(
            " ",
          ),
        )
      ) {
        return [];
      }
      return [
        readString(artifact?.artifact_id),
        ...readArray(payloadRecord?.evidence_refs).map(readString),
        ...readArray(payloadRecord?.support_refs).map(readString),
      ];
    }),
  ].filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
  if (supportRefs.length === 0) return false;
  const qualityGate = readRecord(payload.repo_answer_text_quality_gate);
  if (qualityGate && qualityGate.ok !== true) return false;
  const relevanceGate = readRecord(payload.repo_evidence_relevance_gate);
  if (relevanceGate && relevanceGate.terminal_allowed === false) return false;
  return true;
};

const readFinalAnswerDraftText = (
  payload: Record<string, unknown>,
): string | null => {
  const draft = readRecord(payload.final_answer_draft);
  return readString(draft?.text) ?? readString(draft?.answer_text);
};

const readModelSynthesizedAnswerText = (
  payload: Record<string, unknown>,
): string | null => {
  const answer = readRecord(payload.model_synthesized_answer);
  return readString(answer?.answer_text) ?? readString(answer?.text);
};

const readCompoundEvidenceSynthesisAnswerText = (
  payload: Record<string, unknown>,
): string | null => {
  const answer = readRecord(payload.compound_evidence_synthesis_answer);
  return readString(answer?.answer_text) ?? readString(answer?.text);
};

const directAnswerFinalAnswerSource = (
  payload: Record<string, unknown>,
): "model_direct_answer" | "final_answer_draft" =>
  readDirectAnswerArtifactText(payload)
    ? "model_direct_answer"
    : "final_answer_draft";

const readDocOpenReceiptTerminalText = (
  payload: Record<string, unknown>,
): string | null => {
  const terminalArtifactId = readString(payload.terminal_artifact_id);
  const ledger = readArray(payload.current_turn_artifact_ledger);
  const directReceipt = readRecord(payload.doc_open_receipt);
  const candidates = [
    ...ledger
      .map((entry) => readRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter((entry) => readString(entry.kind) === "doc_open_receipt")
      .sort((left, right) => {
        const leftId = readString(left.artifact_id);
        const rightId = readString(right.artifact_id);
        if (terminalArtifactId && leftId === terminalArtifactId) return -1;
        if (terminalArtifactId && rightId === terminalArtifactId) return 1;
        return 0;
      })
      .map((entry) => readRecord(entry.payload)),
    directReceipt,
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));

  for (const receipt of candidates) {
    const status = readString(receipt.status)?.toLowerCase();
    if (status && !/^(?:opened|completed|succeeded|success|ok)$/.test(status))
      continue;
    const path =
      readString(receipt.path) ??
      readString(receipt.doc_path) ??
      readString(receipt.active_doc_path) ??
      readString(receipt.source_path) ??
      readString(receipt.opened_path);
    if (path) return `Opened document: ${path}`;
  }
  return null;
};

const readTurnId = (
  payload: Record<string, unknown>,
  fallback?: string | null,
): string =>
  readString(payload.turn_id) ?? readString(fallback) ?? "unknown-turn";

const readThreadId = (
  payload: Record<string, unknown>,
  fallback?: string | null,
): string =>
  readString(payload.thread_id) ??
  readString(payload.session_id) ??
  readString(fallback) ??
  "helix-ask:desktop";

const requestUserInputText = (payload: Record<string, unknown>): string =>
  readString(readRecord(payload.pending_server_request)?.prompt) ??
  readString(readRecord(payload.request_user_input)?.prompt) ??
  readString(readRecord(payload.pending_request)?.prompt) ??
  "I need more information before I can answer this turn.";

const hasRequestUserInputArtifact = (
  payload: Record<string, unknown>,
): boolean =>
  Boolean(
    readRecord(payload.pending_server_request) ||
    readRecord(payload.request_user_input) ||
    readRecord(payload.pending_request),
  );

const shouldPromoteRequestUserInputTerminal = (
  payload: Record<string, unknown>,
): boolean => {
  if (!hasRequestUserInputArtifact(payload)) return false;
  const goal = readRecord(payload.goal_satisfaction_evaluation);
  const solver = readRecord(payload.solver_controller_decision);
  const postToolBridge = readRecord(payload.post_tool_authority_bridge);
  const pendingRequest =
    readRecord(payload.pending_server_request) ??
    readRecord(payload.request_user_input) ??
    readRecord(payload.pending_request);
  return (
    readString(pendingRequest?.status) === "pending" ||
    readString(goal?.next_decision) === "request_user_input" ||
    readString(solver?.decision) === "request_user_input" ||
    readString(postToolBridge?.required_terminal_kind) ===
      "request_user_input" ||
    readString(postToolBridge?.terminal_repair_action) ===
      "materialize_request_user_input" ||
    readString(payload.final_status) === "pending_input" ||
    readString(payload.response_type) === "pending_input" ||
    readString(payload.terminal_artifact_kind) === "request_user_input" ||
    readString(payload.final_answer_source) === "request_user_input"
  );
};

const promoteRequestUserInputTerminal = (
  payload: Record<string, unknown>,
  turnId: string,
): void => {
  const priorPendingRequest =
    readRecord(payload.pending_server_request) ??
    readRecord(payload.request_user_input) ??
    readRecord(payload.pending_request);
  const goalFrame = readRecord(payload.universal_goal_frame);
  const requestedOutputs = readArray(goalFrame?.requested_outputs)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const mutationTargets = readArray(goalFrame?.mutation_targets)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const pendingNeedsNoteTitle =
    requestedOutputs.some(
      (entry) => readString(entry.kind) === "note_update",
    ) &&
    mutationTargets.some(
      (entry) =>
        readString(entry.kind) === "note" &&
        readString(entry.resolution) === "missing",
    );
  if (priorPendingRequest) {
    const promotedPendingRequest = pendingNeedsNoteTitle
      ? {
          ...priorPendingRequest,
          prompt:
            "Which note should I update with the current document summary?",
          required_fields: ["note_title"],
          unresolved_fields: ["note_title"],
          reason: "missing_note_title",
        }
      : priorPendingRequest;
    payload.pending_server_request = promotedPendingRequest;
    payload.pending_request = promotedPendingRequest;
  }
  const text = requestUserInputText(payload);
  const priorTerminalArtifactKind = readString(payload.terminal_artifact_kind);
  const priorFinalAnswerSource = readString(payload.final_answer_source);
  const priorTerminalErrorCode = readString(payload.terminal_error_code);
  payload.ok = true;
  payload.response_type = "pending_input";
  payload.final_status = "pending_input";
  payload.terminal_artifact_kind = "request_user_input";
  payload.final_answer_source = "request_user_input";
  payload.request_user_input_preview = {
    schema: "helix.request_user_input_preview.v1",
    turn_id: turnId,
    prompt: text,
    assistant_answer: false,
    raw_content_included: false,
  };
  delete payload.selected_final_answer;
  payload.assistant_answer = false;
  delete payload.answer;
  delete payload.text;
  delete payload.finalAnswer;
  delete payload.content;
  payload.terminal_request_user_input_promotion = {
    schema: "helix.terminal_request_user_input_promotion.v1",
    turn_id: turnId,
    applied: true,
    prior_terminal_artifact_kind: priorTerminalArtifactKind,
    prior_final_answer_source: priorFinalAnswerSource,
    prior_terminal_error_code: priorTerminalErrorCode,
    assistant_answer: false,
    raw_content_included: false,
  };
  delete payload.terminal_error_code;
};

const typedFailureText = (payload: Record<string, unknown>): string =>
  (() => {
    const canonicalGoal = readRecord(payload.canonical_goal_frame);
    const goal = readRecord(payload.goal_satisfaction_evaluation);
    const satisfactionReport = readRecord(payload.satisfaction_report);
    const goalKind =
      readString(canonicalGoal?.goal_kind) ??
      readString(goal?.canonical_goal_kind);
    if (
      goalKind === "model_only_concept" &&
      (readString(satisfactionReport?.missing_reason) ===
        "provider_terminal_candidate_missing" ||
        readString(payload.terminal_error_code) ===
          "provider_terminal_candidate_missing")
    ) {
      const text =
        "I could not produce a terminal answer because the selected provider did not produce a terminal candidate for this turn.";
      payload.terminal_error_code = "provider_terminal_candidate_missing";
      payload.terminal_failure_text = text;
      payload.typed_failure = {
        ...(readRecord(payload.typed_failure) ?? {}),
        schema: "helix.typed_failure.v1",
        kind: "typed_failure",
        error_code: "provider_terminal_candidate_missing",
        message: text,
        text,
        answer_text: text,
        assistant_answer: false,
        raw_content_included: false,
      };
      return text;
    }
    const localizedFailureText =
      buildHelixLocalizedTypedFailureTextForPayload(payload);
    const typedFailure = readRecord(payload.typed_failure);
    const candidate =
      readString(payload.terminal_failure_text) ??
      readString(typedFailure?.message) ??
      localizedFailureText;
    const liveSourceFailureRepair = liveSourceModelSynthesisMissingFailure(
      payload,
      candidate,
    );
    if (liveSourceFailureRepair) {
      payload.terminal_error_code = liveSourceFailureRepair.code;
      payload.terminal_failure_text = liveSourceFailureRepair.text;
      payload.typed_failure = {
        ...(typedFailure ?? {}),
        schema: "helix.typed_failure.v1",
        error_code: liveSourceFailureRepair.code,
        message: liveSourceFailureRepair.text,
        text: liveSourceFailureRepair.text,
        answer_text: liveSourceFailureRepair.text,
        assistant_answer: false,
        raw_content_included: false,
      };
      return liveSourceFailureRepair.text;
    }
    if (
      localizedFailureText !==
      "I could not produce a terminal answer for this turn."
    ) {
      return localizedFailureText;
    }
    return isHelixGenericTypedFailureText(candidate)
      ? localizedFailureText
      : candidate;
  })();

const isStaleRepoEvidenceTerminalText = (value: unknown): boolean => {
  const text = readString(value) ?? "";
  return /\b(?:could not complete|could not answer|could not produce|terminal boundary blocked|source\/capability answer before the agent runtime loop|turn stopped before required artifacts|missing required artifacts|required artifacts (?:were|are) satisfied|repo_code_evidence_unavailable)\b/i.test(
    text,
  );
};

const isUnavailableTerminalPlaceholderText = (value: unknown): boolean => {
  const text = readString(value) ?? "";
  return /\b(?:I could not produce a terminal answer for this turn|direct_answer_unavailable|model_only_answer_unavailable|repo_code_evidence_unavailable|could not produce a final answer|could not complete this turn)\b/i.test(
    text,
  );
};

const isUnbackedRepoEvidenceTerminalText = (value: unknown): boolean => {
  const text = readString(value) ?? "";
  if (!text) return true;
  if (
    /\b(?:repo evidence|key evidence|source|file|path|client\/|server\/|shared\/|docs\/|\.ts|\.tsx|\.js|\.md)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /\btypically refers to\b/i.test(text);
};

const clipText = (value: string, max = 180): string =>
  value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;

const readTerminalActivePrompt = (payload: Record<string, unknown>): string =>
  readString(payload.active_prompt) ??
  readString(payload.prompt) ??
  readString(payload.user_prompt) ??
  readString(readRecord(payload.runtime_intent_packet)?.user_prompt) ??
  readString(readRecord(payload.provider_gateway_debug_summary)?.prompt) ??
  readString(readRecord(payload.tool_use_restatement)?.userGoal) ??
  "";

const repairVisiblePolicyFaithfulness = (
  text: string,
  violations: string[] = [],
  prompt = "",
  payload?: Record<string, unknown>,
): string => {
  let repaired = text
    .replace(
      /\bFinal answers? must be derived from the observations? and must satisfy the terminal contract requirements?\.?/gi,
      "Final answers must be model-synthesized from observations and selected by terminal authority; receipts and tool outputs are supporting observations, not answer authority.",
    )
    .replace(
      /\bFinal answers? must be derived from the observations?\.?/gi,
      "Final answers must be model-synthesized from observations and selected by terminal authority.",
    )
    .replace(
      /\bReceipts? (?:validate|confirm|authorize|prove|determine) (?:the )?(?:final|terminal|visible) answers?\.?/gi,
      "Receipts are observations that can support a later model-authored answer; they do not validate or become the final answer.",
    )
    .replace(
      /\b(?:Final|terminal|visible) answers? (?:are|must be) based on (?:validated )?receipts?\.?/gi,
      "Final answers require model synthesis and terminal authority; receipts remain supporting observations.",
    );
  if (violations.includes("explicit_no_tool_acknowledgement_missing")) {
    repaired = `${repaired.trim()}\n\nI did not execute or call any tool for this explanation.`;
  }
  if (violations.includes("requested_theory_identity_coverage_missing")) {
    const identityLine = requestedTheoryContextIdentityLine(prompt);
    if (identityLine) repaired = `${repaired.trim()}\n\n${identityLine}`;
  }
  if (violations.includes("unsupported_lanyon_boundary_coverage_missing")) {
    const boundaryLine = unsupportedLanyonBoundaryPresentationLine(payload);
    if (boundaryLine) repaired = `${repaired.trim()}\n\n${boundaryLine}`;
  }
  return repaired.replace(/\n{3,}/g, "\n\n").trim();
};

const buildRepoEvidenceTerminalRepairText = (
  payload: Record<string, unknown>,
): string | null => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const concept =
    readString(readArray(canonicalGoal?.corpus_anchors)[0]) ??
    readString(readArray(canonicalGoal?.concept_tokens)[0]) ??
    "this internal concept";
  const directObservations = readArray(payload.evidence_observations);
  const ledgerObservations = readArray(
    payload.current_turn_artifact_ledger,
  ).flatMap((entry) => {
    const artifact = readRecord(entry);
    const artifactPayload = readRecord(artifact?.payload);
    const searchable = [
      readString(artifact?.kind),
      readString(artifactPayload?.kind),
      readString(artifactPayload?.schema),
    ].join(" ");
    if (
      !/repo_code_evidence_observation|helix\.repo_code_evidence_observation\.v1/i.test(
        searchable,
      )
    )
      return [];
    if (readArray(artifactPayload?.observations).length > 0)
      return readArray(artifactPayload?.observations);
    if (readArray(artifactPayload?.spans).length > 0)
      return readArray(artifactPayload?.spans);
    return artifactPayload ? [artifactPayload] : [];
  });
  const observations =
    directObservations.length > 0 ? directObservations : ledgerObservations;
  const sourceLines = observations
    .map((entry) => {
      const record = readRecord(entry);
      if (!record) return null;
      const source =
        readString(record.source_id) ??
        readString(record.ref) ??
        readString(record.path) ??
        readString(record.filePath) ??
        readString(record.id);
      const excerpt = clipText(
        readString(record.snippet) ??
          readString(record.excerpt) ??
          readString(record.reason) ??
          "",
      );
      return source ? `- ${source}${excerpt ? `: ${excerpt}` : ""}` : null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 6);
  if (sourceLines.length === 0) return null;
  return [
    `I found current repo evidence for ${concept}.`,
    "",
    "Key evidence:",
    ...sourceLines,
  ]
    .join("\n")
    .trim();
};

export const applyDocConceptExplanationTerminalCandidate = (
  payload: Record<string, unknown>,
): { applied: boolean; text: string | null; artifactId: string | null } => {
  const terminalErrorCode = readString(payload.terminal_error_code);
  const terminalArtifactKind = readTerminalArtifactKind(payload);
  const finalAnswerSource = readFinalAnswerSource(payload);
  if (
    terminalErrorCode !== "concept_explanation_unavailable" &&
    terminalArtifactKind !== "typed_failure" &&
    finalAnswerSource !== "typed_failure"
  ) {
    return { applied: false, text: null, artifactId: null };
  }
  const ledger = Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
    : [];
  for (const entry of ledger) {
    const artifact = readRecord(entry);
    if (!artifact || readString(artifact.kind) !== "doc_concept_explanation")
      continue;
    const artifactPayload = readRecord(artifact.payload);
    const text =
      readString(artifactPayload?.answer_text) ??
      readString(artifactPayload?.text) ??
      readString(artifactPayload?.plain_language_summary);
    if (!text) continue;
    const path =
      readString(artifactPayload?.source_path) ??
      readString(artifactPayload?.path);
    const terminalText =
      path && !text.includes(path) ? `${text}\n\nPath: ${path}` : text;
    payload.ok = true;
    payload.response_type = "final_answer";
    payload.final_status = "final_answer";
    payload.terminal_artifact_kind = "doc_concept_explanation";
    payload.final_answer_source = "artifact_synthesis";
    payload.selected_final_answer = terminalText;
    payload.answer = terminalText;
    payload.text = terminalText;
    payload.finalAnswer = terminalText;
    payload.content = terminalText;
    const artifactId = readString(artifact.artifact_id);
    if (artifactId) payload.terminal_artifact_id = artifactId;
    delete payload.terminal_error_code;
    delete payload.scientific_extraction_failed;
    delete payload.scientific_extraction_fail_reason;
    return { applied: true, text: terminalText, artifactId };
  }
  return { applied: false, text: null, artifactId: null };
};

const isFailureLikeTerminalText = (text: string | null): boolean =>
  !text ||
  isHelixGenericTypedFailureText(text) ||
  /\b(?:I could not|could not complete|could not produce|terminal boundary|typed failure|solver controller blocked)\b/i.test(
    text,
  );

const directAnswerHasModelOrProviderAuthority = (
  artifact: Record<string, unknown> | null | undefined,
  artifactPayload: Record<string, unknown> | null | undefined,
): boolean => {
  const source = readString(artifactPayload?.source);
  const producedBy = readString(artifactPayload?.produced_by);
  const producerItemId = readString(artifact?.producer_item_id);
  return (
    source === "model_direct_answer" ||
    source === "agent_provider_terminal_candidate" ||
    producedBy === "agent_runtime_loop" ||
    producerItemId === "agent_runtime_loop" ||
    Boolean(readString(artifactPayload?.provider_terminal_candidate_ref)) ||
    Boolean(readString(artifactPayload?.agent_provider_terminal_candidate_ref))
  );
};

const readDirectAnswerArtifactText = (
  payload: Record<string, unknown>,
): string | null => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goal = readRecord(payload.goal_satisfaction_evaluation);
  const goalKind =
    readString(canonicalGoal?.goal_kind) ??
    readString(goal?.canonical_goal_kind);
  const requiresModelOrProviderAuthority = goalKind === "model_only_concept";
  const directRecord = readRecord(payload.direct_answer_text);
  const directRecordText =
    readString(directRecord?.answer_text) ?? readString(directRecord?.text);
  if (
    directRecordText &&
    !isFailureLikeTerminalText(directRecordText) &&
    (!requiresModelOrProviderAuthority ||
      directAnswerHasModelOrProviderAuthority(null, directRecord))
  ) {
    return directRecordText;
  }

  for (const entry of readArray(payload.current_turn_artifact_ledger)) {
    const artifact = readRecord(entry);
    const kind = readString(artifact?.kind);
    if (
      kind !== "direct_answer_text" &&
      kind !== "final_answer_draft" &&
      kind !== "model_synthesized_answer" &&
      kind !== "compound_evidence_synthesis_answer"
    ) {
      continue;
    }
    const artifactPayload = readRecord(artifact?.payload);
    const text =
      readString(artifactPayload?.answer_text) ??
      readString(artifactPayload?.text) ??
      readString(artifact?.text);
    if (
      text &&
      !isFailureLikeTerminalText(text) &&
      (!requiresModelOrProviderAuthority ||
        directAnswerHasModelOrProviderAuthority(artifact, artifactPayload))
    ) {
      return text;
    }
  }

  if (requiresModelOrProviderAuthority) return null;

  const draftText = readFinalAnswerDraftText(payload);
  if (draftText && !isFailureLikeTerminalText(draftText)) return draftText;

  const selectedText = readString(payload.selected_final_answer);
  if (selectedText && !isFailureLikeTerminalText(selectedText))
    return selectedText;

  const answerText =
    readString(payload.assistant_answer) ??
    readString(payload.answer) ??
    readString(payload.text) ??
    readString(payload.finalAnswer);
  return answerText && !isFailureLikeTerminalText(answerText)
    ? answerText
    : null;
};

const directAnswerContractSatisfied = (
  payload: Record<string, unknown>,
): boolean => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goal = readRecord(payload.goal_satisfaction_evaluation);
  const goalKind =
    readString(canonicalGoal?.goal_kind) ??
    readString(goal?.canonical_goal_kind);
  if (
    goalKind !== "model_only_concept" &&
    goalKind !== "workspace_help" &&
    goalKind !== "conversation"
  ) {
    return false;
  }
  if (
    readString(goal?.satisfaction) !== "satisfied" ||
    readString(goal?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const requiredTerminalKinds = [
    readString(canonicalGoal?.required_terminal_kind),
    ...readArray(canonicalGoal?.required_terminal_kinds).map(readString),
  ].filter((entry): entry is string => Boolean(entry));
  const requiredDirectAnswer =
    requiredTerminalKinds.length === 0 ||
    requiredTerminalKinds.every((kind) => kind === "unknown") ||
    requiredTerminalKinds.includes("direct_answer_text") ||
    readArray(goal?.required_evidence).some((entry) => {
      const record = readRecord(entry);
      return (
        readString(record?.artifact_kind) === "direct_answer_text" ||
        readString(record?.kind) === "direct_answer_text"
      );
    });
  return requiredDirectAnswer && Boolean(readDirectAnswerArtifactText(payload));
};

const workstationToolEvaluationTerminalContractSatisfied = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalArtifactKind = readTerminalArtifactKind(payload);
  const finalAnswerSource = readFinalAnswerSource(payload);
  if (
    terminalArtifactKind !== "workstation_tool_evaluation" &&
    finalAnswerSource !== "workstation_tool_evaluation"
  ) {
    return false;
  }
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goal = readRecord(payload.goal_satisfaction_evaluation);
  const routeProductContract = readRecord(payload.route_product_contract);
  const requiredTerminalKinds = [
    readString(canonicalGoal?.required_terminal_kind),
    ...readArray(canonicalGoal?.required_terminal_kinds).map(readString),
    readString(goal?.required_terminal_kind),
    readString(goal?.terminal_artifact_kind),
    ...readArray(routeProductContract?.required_terminal_kinds).map(readString),
    readString(routeProductContract?.required_terminal_kind),
  ].filter((entry): entry is string => Boolean(entry));
  const allowedTerminalKinds = [
    ...readArray(routeProductContract?.allowed_terminal_artifact_kinds).map(
      readString,
    ),
    ...readArray(routeProductContract?.allowed_terminal_kinds).map(readString),
  ].filter((entry): entry is string => Boolean(entry));
  const forbiddenTerminalKinds = readArray(
    routeProductContract?.forbidden_terminal_artifact_kinds,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  if (forbiddenTerminalKinds.includes("workstation_tool_evaluation"))
    return false;
  const workstationRequired =
    requiredTerminalKinds.includes("workstation_tool_evaluation") ||
    allowedTerminalKinds.includes("workstation_tool_evaluation");
  if (!workstationRequired) return false;
  const workstationEvaluation = readRecord(payload.workstation_tool_evaluation);
  const workstationEvaluationText =
    readString(workstationEvaluation?.answer_text) ??
    readString(workstationEvaluation?.summary) ??
    readString(workstationEvaluation?.text);
  if (workstationEvaluationText) return true;
  if (
    readString(goal?.satisfaction) !== "satisfied" &&
    readString(goal?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  return Boolean(
    readTerminalPresentationText(payload) ??
    readString(payload.selected_final_answer),
  );
};

const readCapabilityHelpSummaryArtifact = (
  payload: Record<string, unknown>,
): { ref: string | null; text: string } | null => {
  const topLevel = readRecord(payload.capability_help_summary);
  const topLevelText =
    readString(topLevel?.answer_text) ??
    readString(topLevel?.text) ??
    readString(topLevel?.terminal_text);
  if (topLevelText && !isFailureLikeTerminalText(topLevelText)) {
    return {
      ref:
        readString(topLevel?.artifact_id) ??
        readString(payload.terminal_artifact_id),
      text: topLevelText,
    };
  }

  for (const entry of [
    ...readArray(payload.current_turn_artifact_ledger),
  ].reverse()) {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "capability_help_summary") continue;
    const artifactPayload = readRecord(artifact?.payload);
    const text =
      readString(artifactPayload?.answer_text) ??
      readString(artifactPayload?.text) ??
      readString(artifactPayload?.terminal_text) ??
      readString(artifact?.text);
    if (!text || isFailureLikeTerminalText(text)) continue;
    return {
      ref: readString(artifact?.artifact_id),
      text,
    };
  }

  return null;
};

const capabilityHelpSummaryTerminalContractSatisfied = (
  payload: Record<string, unknown>,
): boolean => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goal = readRecord(payload.goal_satisfaction_evaluation);
  const requiredTerminalKinds = [
    readString(canonicalGoal?.required_terminal_kind),
    ...readArray(canonicalGoal?.required_terminal_kinds).map(readString),
    readString(goal?.required_terminal_kind),
    readString(goal?.terminal_artifact_kind),
  ].filter((entry): entry is string => Boolean(entry));
  const capabilityHelpRequired =
    readString(canonicalGoal?.goal_kind) === "capability_help" ||
    readString(goal?.canonical_goal_kind) === "capability_help" ||
    requiredTerminalKinds.includes("capability_help_summary");
  const goalAllowsTerminal =
    readString(goal?.satisfaction) === "satisfied" ||
    readString(goal?.next_decision) === "allow_terminal";
  return (
    capabilityHelpRequired &&
    goalAllowsTerminal &&
    Boolean(readCapabilityHelpSummaryArtifact(payload))
  );
};

const applySatisfiedDirectAnswerTerminalCandidate = (
  payload: Record<string, unknown>,
): { applied: boolean; text: string | null } => {
  const terminalArtifactKind = readTerminalArtifactKind(payload);
  const finalAnswerSource = readFinalAnswerSource(payload);
  if (
    terminalArtifactKind !== "typed_failure" &&
    finalAnswerSource !== "typed_failure" &&
    !readString(payload.terminal_error_code)
  ) {
    return { applied: false, text: null };
  }
  if (!directAnswerContractSatisfied(payload))
    return { applied: false, text: null };
  const text = readDirectAnswerArtifactText(payload);
  if (!text) return { applied: false, text: null };
  const rejectedFailure = readRecord(payload.typed_failure);
  if (rejectedFailure || readString(payload.terminal_error_code)) {
    payload.rejected_typed_failure = {
      ...(rejectedFailure ?? {}),
      rejected_reason: "successful_terminal_authority_superseded_failure",
      superseded_terminal_error_code: readString(payload.terminal_error_code),
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  payload.ok = true;
  payload.response_type = "final_answer";
  payload.final_status = "final_answer";
  payload.status = "final_answer";
  payload.terminal_artifact_kind = "direct_answer_text";
  payload.final_answer_source = directAnswerFinalAnswerSource(payload);
  payload.selected_final_answer = text;
  payload.answer = text;
  payload.text = text;
  payload.finalAnswer = text;
  payload.content = text;
  payload.assistant_answer = text;
  delete payload.terminal_error_code;
  delete payload.terminal_failure_text;
  delete payload.typed_failure;
  return { applied: true, text };
};

function terminalKindForArtifact(
  terminalArtifactKind: string,
): HelixTerminalAuthority["terminal_kind"] {
  if (terminalArtifactKind === "request_user_input")
    return "request_user_input";
  if (terminalArtifactKind === "typed_failure") return "failure";
  if (terminalArtifactKind === "tool_receipt") return "tool_receipt";
  if (
    terminalArtifactKind === "live_pipeline_receipt" ||
    terminalArtifactKind === "workspace_action_receipt" ||
    terminalArtifactKind === "doc_open_receipt" ||
    terminalArtifactKind === "note_update_receipt" ||
    terminalArtifactKind === "note_action_receipt" ||
    terminalArtifactKind === "note_create_receipt"
  ) {
    return "workspace_action_receipt";
  }
  if (terminalArtifactKind === "situation_context_pack")
    return "situation_context_pack";
  if (terminalArtifactKind === "live_environment_binding_diagnosis")
    return "live_answer_environment";
  if (
    terminalArtifactKind === "tool_evaluation" ||
    terminalArtifactKind === "workstation_tool_evaluation"
  ) {
    return "tool_evaluation";
  }
  return "answer";
}

const isNonAuthoritativeToolReceiptEnvelope = (
  envelope: HelixTerminalAnswerEnvelope,
): boolean =>
  envelope.terminal_artifact_kind === "tool_receipt" ||
  envelope.final_answer_source === "deterministic_receipt_fallback";

const isRequestUserInputEnvelope = (
  envelope: HelixTerminalAnswerEnvelope,
): boolean =>
  envelope.terminal_kind === "request_user_input" ||
  envelope.terminal_artifact_kind === "request_user_input" ||
  envelope.final_answer_source === "request_user_input";

export function resolveTerminalAnswerEnvelope(
  payload: Record<string, unknown>,
  options: {
    threadId?: string | null;
    turnId?: string | null;
    prompt?: string | null;
  } = {},
): HelixTerminalAnswerEnvelope {
  const turnId = readTurnId(payload, options.turnId);
  const threadId = readThreadId(payload, options.threadId);
  const postToolBridge = applyPostToolAuthorityBridgeRepair({
    turnId,
    payload,
  });
  payload.post_tool_authority_bridge = postToolBridge as unknown as Record<
    string,
    unknown
  >;
  if (shouldPromoteRequestUserInputTerminal(payload)) {
    promoteRequestUserInputTerminal(payload, turnId);
  }
  const sourceTarget = readSourceTarget(payload);
  let terminalArtifactKind = readTerminalArtifactKind(payload);
  let finalAnswerSource = readFinalAnswerSource(payload);
  let terminalText: string | null = null;
  let authorityOrigin: HelixTerminalAnswerEnvelope["authority_origin"] =
    "terminal_presentation";
  const docConceptTerminal =
    applyDocConceptExplanationTerminalCandidate(payload);
  const directAnswerTerminal =
    applySatisfiedDirectAnswerTerminalCandidate(payload);
  const recoverableRepoAnswer = readRepoEvidenceAnswerPayload(payload);

  if (
    (terminalArtifactKind === "typed_failure" ||
      finalAnswerSource === "typed_failure") &&
    canRecoverRepoEvidenceAnswerTerminal(payload, recoverableRepoAnswer)
  ) {
    payload.repo_code_evidence_answer = recoverableRepoAnswer;
    terminalArtifactKind = "repo_code_evidence_answer";
    finalAnswerSource = "repo_code_evidence_answer";
    payload.terminal_artifact_kind = terminalArtifactKind;
    payload.final_answer_source = finalAnswerSource;
    payload.terminal_artifact_id =
      readString(recoverableRepoAnswer.artifact_id) ??
      `${turnId}:repo_code_evidence_answer`;
    delete payload.terminal_error_code;
    delete payload.terminal_failure_text;
    delete payload.typed_failure;
  }

  if (docConceptTerminal.applied && docConceptTerminal.text) {
    terminalArtifactKind = "doc_concept_explanation";
    finalAnswerSource = "artifact_synthesis";
    terminalText = docConceptTerminal.text;
    authorityOrigin = "selected_final_answer";
  } else if (directAnswerTerminal.applied && directAnswerTerminal.text) {
    terminalArtifactKind = "direct_answer_text";
    finalAnswerSource = readFinalAnswerSource(payload);
    terminalText = directAnswerTerminal.text;
    authorityOrigin = "selected_final_answer";
  } else if (
    terminalArtifactKind === "typed_failure" ||
    finalAnswerSource === "typed_failure"
  ) {
    terminalArtifactKind = "typed_failure";
    terminalText = typedFailureText(payload);
    finalAnswerSource = "typed_failure";
    authorityOrigin = "typed_failure";
  } else if (terminalArtifactKind === "request_user_input") {
    terminalText = requestUserInputText(payload);
    authorityOrigin = "request_user_input";
  } else if (
    terminalArtifactKind === "tool_receipt" ||
    finalAnswerSource === "deterministic_receipt_fallback"
  ) {
    terminalArtifactKind = "tool_receipt";
    finalAnswerSource = "deterministic_receipt_fallback";
    terminalText =
      readString(payload.receipt_status_text) ??
      readTerminalPresentationText(payload) ??
      readString(payload.selected_final_answer) ??
      readFinalAnswerDraftText(payload);
    authorityOrigin = "tool_receipt";
  } else if (terminalArtifactKind === "repo_code_evidence_answer") {
    terminalText =
      readValidRepoEvidenceAnswerText(payload) ??
      readTerminalPresentationText(payload);
    authorityOrigin =
      terminalText === readValidRepoEvidenceAnswerText(payload)
        ? "repo_code_evidence_answer"
        : "terminal_presentation";
  } else if (
    terminalArtifactKind === "workstation_tool_evaluation" ||
    finalAnswerSource === "workstation_tool_evaluation"
  ) {
    terminalArtifactKind = "workstation_tool_evaluation";
    finalAnswerSource = "workstation_tool_evaluation";
    terminalText =
      readWorkstationToolEvaluationText(payload) ??
      readTerminalPresentationText(payload);
    authorityOrigin =
      terminalText === readWorkstationToolEvaluationText(payload)
        ? "workstation_tool_evaluation"
        : "terminal_presentation";
  } else if (terminalArtifactKind === "doc_open_receipt") {
    terminalText =
      readDocOpenReceiptTerminalText(payload) ??
      readTerminalPresentationText(payload);
    finalAnswerSource = "doc_open_receipt";
    authorityOrigin = "terminal_presentation";
  } else if (terminalArtifactKind === "live_environment_tool_observation") {
    terminalText =
      readFinalAnswerDraftText(payload) ??
      readString(payload.selected_final_answer) ??
      readTerminalPresentationText(payload);
    authorityOrigin =
      terminalText === readFinalAnswerDraftText(payload) ||
      terminalText === readString(payload.selected_final_answer)
        ? "selected_final_answer"
        : "terminal_presentation";
  } else if (terminalArtifactKind === "compound_evidence_synthesis_answer") {
    const compoundSynthesisText =
      readCompoundEvidenceSynthesisAnswerText(payload);
    terminalText =
      compoundSynthesisText ??
      readString(payload.selected_final_answer) ??
      readFinalAnswerDraftText(payload) ??
      readTerminalPresentationText(payload);
    authorityOrigin = compoundSynthesisText
      ? "selected_final_answer"
      : "terminal_presentation";
  } else if (terminalArtifactKind === "model_synthesized_answer") {
    const modelSynthesizedText = readModelSynthesizedAnswerText(payload);
    terminalText =
      modelSynthesizedText ??
      readString(payload.selected_final_answer) ??
      readFinalAnswerDraftText(payload) ??
      readTerminalPresentationText(payload);
    authorityOrigin = modelSynthesizedText
      ? "selected_final_answer"
      : "terminal_presentation";
  } else {
    terminalText = readTerminalPresentationText(payload);
  }
  if (!terminalText) {
    terminalText = readString(payload.selected_final_answer);
    authorityOrigin = "selected_final_answer";
  }
  if (!terminalText) {
    terminalArtifactKind = "typed_failure";
    finalAnswerSource = "typed_failure";
    terminalText = typedFailureText(payload);
    authorityOrigin = "typed_failure";
  }
  if (
    isWorkstationObservationTerminalKind(terminalArtifactKind) &&
    !directAnswerContractSatisfied(payload) &&
    !workstationToolEvaluationTerminalContractSatisfied(payload)
  ) {
    payload.workstation_observation_terminal_rejection = {
      schema: "helix.workstation_observation_terminal_rejection.v1",
      turn_id: turnId,
      rejected_terminal_artifact_kind: terminalArtifactKind,
      rejected_final_answer_source: finalAnswerSource,
      reason: "observation_artifact_cannot_terminalize",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    terminalArtifactKind = "typed_failure";
    finalAnswerSource = "typed_failure";
    const message =
      "I could not produce a terminal answer because the selected workstation artifact is observation-only and must re-enter the completed solver path before any final answer.";
    payload.terminal_error_code = "observation_artifact_cannot_terminalize";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "observation_artifact_cannot_terminalize",
      message,
      text: message,
      assistant_answer: false,
      raw_content_included: false,
    };
    terminalText = typedFailureText(payload);
    authorityOrigin = "typed_failure";
  }
  const committedRoute = readCommittedAskRoute(payload);
  const committedGoal = readRecord(committedRoute?.canonical_goal);
  const routeProductContract = readRecord(payload.route_product_contract);
  const compoundTerminalPolicy = applyCompoundTerminalPolicy(payload, {
    allowed: [
      ...readArray(committedGoal?.allowed_terminal_artifact_kinds).map(
        readString,
      ),
      ...readArray(routeProductContract?.allowed_terminal_artifact_kinds).map(
        readString,
      ),
    ].filter((entry): entry is string => Boolean(entry)),
    forbidden: [
      ...readArray(committedGoal?.forbidden_terminal_artifact_kinds).map(
        readString,
      ),
      ...readArray(routeProductContract?.forbidden_terminal_artifact_kinds).map(
        readString,
      ),
    ].filter((entry): entry is string => Boolean(entry)),
    requiredTerminalKind:
      readString(committedGoal?.required_terminal_kind) ??
      readString(routeProductContract?.required_terminal_kind),
  });
  const compoundPolicyAllowsTerminal =
    compoundTerminalPolicy.policy.active &&
    !compoundTerminalPolicy.forbidden.includes(terminalArtifactKind) &&
    (compoundTerminalPolicy.allowed.length === 0 ||
      compoundTerminalPolicy.allowed.includes(terminalArtifactKind));
  const routeProductAllowsTerminal =
    !compoundTerminalPolicy.policy.active &&
    !readArray(routeProductContract?.forbidden_terminal_artifact_kinds)
      .map(readString)
      .filter((entry): entry is string => Boolean(entry))
      .includes(terminalArtifactKind) &&
    (readString(routeProductContract?.required_terminal_kind) ===
      terminalArtifactKind ||
      readArray(routeProductContract?.allowed_terminal_artifact_kinds)
        .map(readString)
        .filter((entry): entry is string => Boolean(entry))
        .includes(terminalArtifactKind));
  const committedRouteAllowsTerminal = compoundTerminalPolicy.policy.active
    ? compoundPolicyAllowsTerminal
    : !committedRoute && routeProductAllowsTerminal
      ? true
      : committedRouteAllowsTerminalKind({
          committedRoute,
          terminalArtifactKind,
          finalAnswerSource,
        });
  if (
    !committedRouteAllowsTerminal &&
    !directAnswerContractSatisfied(payload) &&
    !workstationToolEvaluationTerminalContractSatisfied(payload) &&
    !capabilityHelpSummaryTerminalContractSatisfied(payload)
  ) {
    payload.committed_route_terminal_rejection = {
      schema: "helix.committed_route_terminal_rejection.v1",
      turn_id: turnId,
      rejected_terminal_artifact_kind: terminalArtifactKind,
      reason: "committed_route_terminal_product_mismatch",
      assistant_answer: false,
      raw_content_included: false,
    };
    terminalArtifactKind = "typed_failure";
    finalAnswerSource = "typed_failure";
    terminalText = typedFailureText({
      ...payload,
      terminal_error_code: "committed_route_terminal_product_mismatch",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "committed_route_terminal_product_mismatch",
        message:
          "I could not produce a terminal answer because the selected terminal product did not match the committed Ask route.",
        text: "I could not produce a terminal answer because the selected terminal product did not match the committed Ask route.",
      },
    });
    authorityOrigin = "typed_failure";
  }
  const visibleFaithfulnessGate = evaluateVisibleAnswerPolicyFaithfulnessGate({
    turnId,
    text: terminalText,
    payload: {
      ...payload,
      active_prompt: options.prompt ?? payload.active_prompt,
      terminal_artifact_kind: terminalArtifactKind,
      final_answer_source: finalAnswerSource,
    },
    checkedTextRef:
      readString(payload.terminal_artifact_id) ?? terminalArtifactKind,
  });
  payload.visible_answer_policy_faithfulness_gate =
    visibleFaithfulnessGate as unknown as Record<string, unknown>;
  const closureReadiness =
    visibleFaithfulnessGate.theory_execution_closure_readiness;
  const closureFaithfulnessViolation =
    visibleFaithfulnessGate.violations.includes(
      "theory_execution_closure_terminal_binding_invalid",
    )
      ? "theory_execution_closure_terminal_binding_invalid"
      : visibleFaithfulnessGate.violations.includes(
            "theory_execution_closure_artifact_invalid",
          )
        ? "theory_execution_closure_artifact_invalid"
        : visibleFaithfulnessGate.violations.includes(
              "theory_execution_closure_physical_truth_overclaim",
            )
          ? "theory_execution_closure_physical_truth_overclaim"
          : visibleFaithfulnessGate.violations.includes(
                "theory_execution_closure_synthesis_blocked",
              )
            ? "theory_execution_closure_synthesis_blocked"
            : visibleFaithfulnessGate.violations.includes(
                  "theory_execution_closure_support_refs_missing",
                )
              ? "theory_execution_closure_support_refs_missing"
              : visibleFaithfulnessGate.violations.includes(
                    "theory_execution_closure_open_requirements_omitted",
                  )
                ? "theory_execution_closure_open_requirements_omitted"
                : visibleFaithfulnessGate.violations.includes(
                      "theory_execution_closure_claim_ceiling_exceeded",
                    )
                  ? "theory_execution_closure_claim_ceiling_exceeded"
                  : null;
  if (!visibleFaithfulnessGate.ok && closureFaithfulnessViolation) {
    const blockerCodes = closureReadiness?.blockerCodes ?? [];
    const openRequirementCodes = closureReadiness?.openRequirementCodes ?? [];
    const missingRequiredSupportRefs =
      closureReadiness?.missingRequiredSupportRefs ?? [];
    const uncoveredOpenRequirementCodes =
      closureReadiness?.uncoveredOpenRequirementCodes ?? [];
    const repairable = theoryExecutionClosureViolationIsTerminallyRepairable(
      closureFaithfulnessViolation,
    );
    const retryAttemptsConsumed =
      visibleAnswerPolicyTerminalRetryAttemptsConsumed(payload, turnId);
    const retryExhausted =
      repairable &&
      retryAttemptsConsumed >= HELIX_VISIBLE_ANSWER_POLICY_TERMINAL_RETRY_LIMIT;
    const message = (() => {
      switch (closureFaithfulnessViolation) {
        case "theory_execution_closure_terminal_binding_invalid":
          return `I could not publish the drafted answer because the selected terminal artifact was not bound unambiguously to one exact current-turn execution closure: ${visibleFaithfulnessGate.theory_execution_closure_invalid_terminal_ref}. The agent runtime must re-synthesize from an exact selected terminal and closure reference.`;
        case "theory_execution_closure_artifact_invalid":
          return `I could not publish the drafted answer because the current-turn execution-closure artifact failed its contract or hash validation: ${visibleFaithfulnessGate.theory_execution_closure_invalid_artifact_ref}. The agent runtime must re-evaluate closure from the exact admitted evidence.`;
        case "theory_execution_closure_physical_truth_overclaim":
          return "I could not publish the drafted answer because it claimed physical truth beyond the authenticated execution-closure authority. The agent runtime must synthesize a new answer within the recorded claim ceiling.";
        case "theory_execution_closure_synthesis_blocked":
          return [
            "I could not publish a candidate comparison or proposal because the authenticated execution closure marks model synthesis as blocked.",
            blockerCodes.length > 0
              ? `Blockers: ${blockerCodes.join(", ")}.`
              : "",
            openRequirementCodes.length > 0
              ? `Open requirements: ${openRequirementCodes.join(", ")}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ");
        case "theory_execution_closure_support_refs_missing":
          return `I could not publish the drafted comparison because its terminal evidence binding omitted required current-turn support refs: ${missingRequiredSupportRefs.join(", ")}. The agent runtime must re-synthesize from those exact admitted observations.`;
        case "theory_execution_closure_open_requirements_omitted":
          return `I could not publish the drafted comparison because it did not retain these authenticated open requirements: ${uncoveredOpenRequirementCodes.join(", ")}. The agent runtime must state those limits in the bounded answer.`;
        default:
          return "I could not publish the drafted answer because it claimed formal, numerical, or empirical closure beyond the authenticated execution-closure claim ceiling. The agent runtime must synthesize a new answer within that ceiling.";
      }
    })();
    terminalArtifactKind = "typed_failure";
    finalAnswerSource = "typed_failure";
    terminalText = message;
    authorityOrigin = "typed_failure";
    payload.terminal_error_code = closureFaithfulnessViolation;
    payload.terminal_failure_text = message;
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      kind: "typed_failure",
      error_code: closureFaithfulnessViolation,
      message,
      text: message,
      answer_text: message,
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.visible_answer_policy_faithfulness_rejection = {
      schema: "helix.visible_answer_policy_faithfulness_rejection.v1",
      turn_id: turnId,
      rejected_terminal_artifact_kind: readTerminalArtifactKind(payload),
      rejected_final_answer_source: readFinalAnswerSource(payload),
      rejected_terminal_artifact_ref:
        readString(
          readRecord(payload.terminal_answer_authority)?.terminal_artifact_ref,
        ) ?? readString(payload.terminal_artifact_id),
      violation: closureFaithfulnessViolation,
      violations: visibleFaithfulnessGate.violations,
      closure_readiness_status: closureReadiness?.status,
      closure_claim_ceiling: closureReadiness?.claimCeiling,
      blocker_codes: blockerCodes,
      open_requirement_codes: openRequirementCodes,
      missing_required_support_refs: missingRequiredSupportRefs,
      uncovered_open_requirement_codes: uncoveredOpenRequirementCodes,
      invalid_closure_artifact_ref:
        visibleFaithfulnessGate.theory_execution_closure_invalid_artifact_ref,
      invalid_terminal_artifact_ref:
        visibleFaithfulnessGate.theory_execution_closure_invalid_terminal_ref,
      repairable,
      retry_required: repairable && !retryExhausted,
      retry_attempts_consumed: retryAttemptsConsumed,
      retry_attempt_limit: HELIX_VISIBLE_ANSWER_POLICY_TERMINAL_RETRY_LIMIT,
      retry_exhausted: retryExhausted,
      assistant_answer: false,
      raw_content_included: false,
    };
  } else if (
    !visibleFaithfulnessGate.ok &&
    visibleFaithfulnessGate.repair_allowed
  ) {
    const repaired = repairVisiblePolicyFaithfulness(
      terminalText,
      visibleFaithfulnessGate.violations,
      options.prompt ?? readTerminalActivePrompt(payload),
      payload,
    );
    if (repaired && repaired !== terminalText) {
      terminalText = repaired;
      payload.visible_answer_policy_faithfulness_repair = {
        schema: "helix.visible_answer_policy_faithfulness_repair.v1",
        turn_id: turnId,
        repaired: true,
        violations: visibleFaithfulnessGate.violations,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
  }

  return {
    schema: "helix.terminal_answer_envelope.v1",
    turn_id: turnId,
    thread_id: threadId,
    source_target: sourceTarget,
    terminal_artifact_kind: terminalArtifactKind,
    final_answer_source: finalAnswerSource,
    terminal_text: terminalText,
    terminal_text_hash: hashHelixTerminalText(terminalText),
    terminal_kind: terminalKindForArtifact(terminalArtifactKind),
    authority_origin: authorityOrigin,
    assistant_answer: false,
    raw_content_included: false,
  };
}

function upsertTerminalAnswerInArray(
  value: unknown,
  envelope: HelixTerminalAnswerEnvelope,
): unknown[] {
  const events = Array.isArray(value)
    ? value.filter(
        (event) =>
          !/^(?:terminal_answer|request_user_input)$/i.test(
            readString(readRecord(event)?.type) ?? "",
          ),
      )
    : [];
  const status =
    envelope.terminal_kind === "failure"
      ? "final_failure"
      : envelope.terminal_kind === "request_user_input"
        ? "pending_input"
        : isNonAuthoritativeToolReceiptEnvelope(envelope)
          ? "tool_receipt"
          : "final_answer";
  return [
    ...events,
    {
      type:
        envelope.terminal_kind === "request_user_input"
          ? "request_user_input"
          : "terminal_answer",
      at_ms: Date.now(),
      text: envelope.terminal_text,
      status,
    },
  ];
}

function upsertCurrentTurnEvents(
  value: unknown,
  envelope: HelixTerminalAnswerEnvelope,
): unknown {
  if (Array.isArray(value)) return upsertTerminalAnswerInArray(value, envelope);
  const record = readRecord(value) ?? {};
  return {
    ...record,
    terminal_answer: {
      ...(readRecord(record.terminal_answer) ?? {}),
      type:
        envelope.terminal_kind === "request_user_input"
          ? "request_user_input"
          : "terminal_answer",
      text: envelope.terminal_text,
    },
  };
}

function buildTerminalBoundaryFailureEnvelope(
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
  boundary: HelixRuntimeAuthorityBoundaryReport,
): HelixTerminalAnswerEnvelope {
  const blockingReasons =
    boundary.blocking_reasons.length > 0
      ? boundary.blocking_reasons
      : ["terminal_boundary_ineligible"];
  const terminalText = [
    "I could not complete this turn because the terminal boundary blocked a source/capability answer before the agent runtime loop proved it.",
    `Missing runtime authority: ${blockingReasons.join(", ")}.`,
  ].join(" ");
  payload.terminal_error_code =
    readString(payload.terminal_error_code) ?? "terminal_boundary_ineligible";
  payload.typed_failure = {
    ...(readRecord(payload.typed_failure) ?? {}),
    kind: "typed_failure",
    error_code: payload.terminal_error_code,
    text: terminalText,
    answer_text: terminalText,
    terminal_boundary_eligibility: boundary,
    assistant_answer: false,
    raw_content_included: false,
  };
  return {
    ...envelope,
    terminal_artifact_kind: "typed_failure",
    final_answer_source: "typed_failure",
    terminal_text: terminalText,
    terminal_text_hash: hashHelixTerminalText(terminalText),
    terminal_kind: "failure",
    authority_origin: "typed_failure",
  };
}

function buildUnavailableTerminalTextFailureEnvelope(
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): HelixTerminalAnswerEnvelope {
  const terminalText = envelope.terminal_text || UNAVAILABLE_TERMINAL_TEXT;
  payload.terminal_error_code =
    readString(payload.terminal_error_code) ?? "terminal_answer_unavailable";
  payload.typed_failure = {
    ...(readRecord(payload.typed_failure) ?? {}),
    kind: "typed_failure",
    error_code: payload.terminal_error_code,
    text: terminalText,
    answer_text: terminalText,
    rejected_terminal_artifact_kind: envelope.terminal_artifact_kind,
    rejected_final_answer_source: envelope.final_answer_source,
    rejected_reason: "unavailable_terminal_placeholder_text",
    assistant_answer: false,
    raw_content_included: false,
  };
  return {
    ...envelope,
    terminal_artifact_kind: "typed_failure",
    final_answer_source: "typed_failure",
    terminal_text: terminalText,
    terminal_text_hash: hashHelixTerminalText(terminalText),
    terminal_kind: "failure",
    authority_origin: "typed_failure",
  };
}

function buildRepoAnswerQualityFailureEnvelope(
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): HelixTerminalAnswerEnvelope {
  const gate = evaluateRepoAnswerTextQualityGate({
    turnId: envelope.turn_id,
    answerRef:
      readString(readRecord(payload.repo_code_evidence_answer)?.artifact_id) ??
      readString(readRecord(payload.final_answer_draft)?.artifact_id) ??
      envelope.terminal_artifact_kind,
    answerText: envelope.terminal_text,
    payload,
  });
  payload.repo_answer_text_quality_gate = gate;
  if (gate.ok) return envelope;

  const terminalText = [
    "I could not complete this repo-grounded answer because repo evidence was retrieved, but no valid model-authored synthesis passed terminal authority.",
    `Repo answer quality violations: ${gate.violations.join(", ")}.`,
  ].join(" ");
  payload.terminal_error_code = "repo_evidence_synthesis_failed";
  payload.typed_failure = {
    ...(readRecord(payload.typed_failure) ?? {}),
    kind: "typed_failure",
    error_code: payload.terminal_error_code,
    text: terminalText,
    answer_text: terminalText,
    rejected_terminal_artifact_kind: envelope.terminal_artifact_kind,
    rejected_final_answer_source: envelope.final_answer_source,
    repo_answer_text_quality_gate: gate,
    assistant_answer: false,
    raw_content_included: false,
  };
  return {
    ...envelope,
    terminal_artifact_kind: "typed_failure",
    final_answer_source: "typed_failure",
    terminal_text: terminalText,
    terminal_text_hash: hashHelixTerminalText(terminalText),
    terminal_kind: "failure",
    authority_origin: "typed_failure",
  };
}

function clearStaleFailureFieldsForSuccessfulTerminal(
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): void {
  if (isNonAuthoritativeToolReceiptEnvelope(envelope)) return;
  if (isRequestUserInputEnvelope(envelope)) return;
  if (
    envelope.terminal_kind === "failure" ||
    envelope.final_answer_source === "typed_failure"
  )
    return;

  delete payload.terminal_error_code;
  delete payload.terminal_failure_text;

  const typedFailure = readRecord(payload.typed_failure);
  if (typedFailure) {
    payload.rejected_typed_failure = {
      ...typedFailure,
      rejected_reason: "successful_terminal_authority_superseded_failure",
      superseded_by_terminal_artifact_kind: envelope.terminal_artifact_kind,
      assistant_answer: false,
      raw_content_included: false,
    };
    delete payload.typed_failure;
  }

  const satisfaction = readRecord(payload.satisfaction_report);
  if (satisfaction?.missing_reason) {
    payload.satisfaction_report = {
      ...satisfaction,
      missing_reason: null,
      superseded_missing_reason: satisfaction.missing_reason,
    };
  }
}

function syncSuccessfulTerminalStatusMirrors(
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): void {
  if (isNonAuthoritativeToolReceiptEnvelope(envelope)) {
    payload.ok = true;
    payload.status = "tool_receipt";
    payload.final_status = "checkpoint_pending";
    payload.response_type = "tool_receipt";
    const existingSummary = readRecord(payload.resolved_turn_summary);
    payload.resolved_turn_summary = {
      ...(existingSummary ?? {}),
      turn_id: envelope.turn_id,
      final_status: "checkpoint_pending",
      resolved_route_label: "stage_play_reflection / tool_receipt",
      terminal_kind: "tool_receipt",
      terminal_artifact_kind: envelope.terminal_artifact_kind,
      terminal_error_code: null,
      pending_server_request_present: false,
    };
    return;
  }
  if (isRequestUserInputEnvelope(envelope)) {
    payload.ok = true;
    payload.status = "pending_input";
    payload.final_status = "pending_input";
    payload.response_type = "pending_input";
    const existingSummary = readRecord(payload.resolved_turn_summary);
    const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
    const resolvedRouteLabel = [
      readString(canonicalGoalFrame?.goal_kind) ?? "terminal_answer",
      "request_user_input",
    ].join(" / ");
    payload.resolved_turn_summary = {
      ...(existingSummary ?? {}),
      turn_id: envelope.turn_id,
      final_status: "pending_input",
      resolved_route_label: resolvedRouteLabel,
      terminal_kind: "request_user_input",
      terminal_artifact_kind: "request_user_input",
      terminal_error_code: null,
      pending_server_request_present: true,
    };
    return;
  }
  if (
    envelope.terminal_kind === "failure" ||
    envelope.final_answer_source === "typed_failure"
  )
    return;

  payload.ok = true;
  payload.status = "final_answer";
  payload.final_status = "final_answer";
  payload.response_type = "final_answer";

  const existingSummary = readRecord(payload.resolved_turn_summary);
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  const resolvedRouteLabel = [
    readString(canonicalGoalFrame?.goal_kind) ?? "terminal_answer",
    envelope.terminal_artifact_kind,
  ].join(" / ");
  payload.resolved_turn_summary = {
    ...(existingSummary ?? {}),
    turn_id: envelope.turn_id,
    final_status: "final_answer",
    resolved_route_label: resolvedRouteLabel,
    final_answer_source: envelope.final_answer_source,
    terminal_kind: "final_answer",
    terminal_artifact_kind: envelope.terminal_artifact_kind,
    terminal_error_code: null,
    pending_server_request_present: false,
  };
}

const terminalEnvelopeArtifactText = (
  artifact: Record<string, unknown>,
): string | null => {
  const artifactPayload = readRecord(artifact.payload);
  return (
    readString(artifact.answer_text) ??
    readString(artifact.text) ??
    readString(artifact.terminal_text) ??
    readString(artifactPayload?.answer_text) ??
    readString(artifactPayload?.text) ??
    readString(artifactPayload?.terminal_text)
  );
};

const resolveMaterializedTerminalEnvelopeArtifactRef = (
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): string | null => {
  const artifacts = readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((artifact): artifact is Record<string, unknown> =>
      Boolean(artifact),
    );
  const matchingArtifacts = artifacts.filter(
    (artifact) =>
      readString(artifact.kind) === envelope.terminal_artifact_kind &&
      terminalEnvelopeArtifactText(artifact) === envelope.terminal_text,
  );
  const explicitArtifactId = readString(payload.terminal_artifact_id);
  if (explicitArtifactId) {
    const explicitArtifact = matchingArtifacts.find(
      (artifact) => readString(artifact.artifact_id) === explicitArtifactId,
    );
    if (explicitArtifact) return explicitArtifactId;
  }
  return readString(matchingArtifacts.at(-1)?.artifact_id);
};

const synchronizeTerminalAuthorityWriterWithEnvelope = (
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): void => {
  const writer = readRecord(payload.terminal_authority_single_writer);
  if (!writer) return;
  const previousKind =
    readString(writer.selected_terminal_artifact_kind) ??
    readString(writer.selectedArtifactKind);
  const previousRef =
    readString(writer.selected_terminal_artifact_ref) ??
    readString(writer.selectedArtifactRef);
  const previousSource = readString(writer.source);
  if (
    previousKind === envelope.terminal_artifact_kind &&
    previousSource === envelope.final_answer_source &&
    readString(writer.visible_text) === envelope.terminal_text
  ) {
    return;
  }

  const errorCode = readString(payload.terminal_error_code);
  const terminalRef =
    resolveMaterializedTerminalEnvelopeArtifactRef(payload, envelope) ??
    `${envelope.turn_id}:terminal_envelope:${envelope.terminal_artifact_kind}${
      errorCode ? `:${errorCode}` : ""
    }`;
  const rejection =
    previousKind && previousRef
      ? {
          ref: previousRef,
          kind: previousKind,
          reason: "superseded_by_terminal_policy_envelope",
        }
      : null;
  const rejectedCandidates = [
    ...readArray(writer.rejected_candidates),
    ...(rejection ? [rejection] : []),
  ];
  const audit = readRecord(writer.audit);
  const integrity = readRecord(writer.integrity);
  const integrityAudit = readRecord(
    integrity?.terminal_authority_single_writer_audit,
  );
  const wroteVisibleFields = [
    "payload.text",
    "payload.answer",
    "payload.assistant_answer",
    "payload.selected_final_answer",
    "terminal_presentation.concise_text",
  ];
  const synchronizedAudit = audit
    ? {
        ...audit,
        selectedArtifactKind: envelope.terminal_artifact_kind,
        selectedArtifactRef: terminalRef,
        wroteVisibleFields,
        terminal_policy_override: {
          previous_artifact_kind: previousKind,
          previous_artifact_ref: previousRef,
          previous_source: previousSource,
          replacement_artifact_kind: envelope.terminal_artifact_kind,
          replacement_artifact_ref: terminalRef,
          replacement_source: envelope.final_answer_source,
          assistant_answer: false,
          raw_content_included: false,
        },
      }
    : null;
  const synchronizedIntegrityAudit = integrityAudit
    ? {
        ...integrityAudit,
        selectedArtifactKind: envelope.terminal_artifact_kind,
        selectedArtifactRef: terminalRef,
        wroteVisibleFields,
      }
    : synchronizedAudit;
  const synchronizedWriter = {
    ...writer,
    selectedArtifactKind: envelope.terminal_artifact_kind,
    selectedArtifactRef: terminalRef,
    selected_terminal_artifact_ref: terminalRef,
    selected_terminal_artifact_kind: envelope.terminal_artifact_kind,
    visible_text: envelope.terminal_text,
    source: envelope.final_answer_source,
    rejected_candidates: rejectedCandidates,
    writes: {
      ...(readRecord(writer.writes) ?? {}),
      payload_text: envelope.terminal_text,
      payload_answer: envelope.terminal_text,
      payload_assistant_answer: envelope.terminal_text,
      payload_selected_final_answer: envelope.terminal_text,
      terminal_presentation_concise_text: envelope.terminal_text,
      debug_selected_final_answer: envelope.terminal_text,
    },
    wroteVisibleFields,
    ...(synchronizedAudit ? { audit: synchronizedAudit } : {}),
    integrity: {
      ...(integrity ?? {}),
      single_writer_applied: true,
      ...(synchronizedIntegrityAudit
        ? {
            terminal_authority_single_writer_audit:
              synchronizedIntegrityAudit,
          }
        : {}),
      visible_matches_selected_artifact: true,
      materialized_terminal_artifact_kind:
        envelope.terminal_artifact_kind,
      materialized_terminal_artifact_ref: terminalRef,
      terminal_projection_kind_match: true,
      terminal_policy_override_applied: true,
      terminal_policy_override_reason:
        envelope.terminal_kind === "failure"
          ? errorCode ?? "typed_failure"
          : "terminal_envelope_reconciliation",
    },
  };
  payload.terminal_authority_single_writer = synchronizedWriter;
  payload.terminal_artifact_id = terminalRef;
  payload.terminal_authority_policy_override = {
    schema: "helix.terminal_authority_policy_override.v1",
    turn_id: envelope.turn_id,
    previous_artifact_kind: previousKind,
    previous_artifact_ref: previousRef,
    previous_source: previousSource,
    replacement_artifact_kind: envelope.terminal_artifact_kind,
    replacement_artifact_ref: terminalRef,
    replacement_source: envelope.final_answer_source,
    terminal_error_code: errorCode,
    assistant_answer: false,
    raw_content_included: false,
  };

  if (
    envelope.terminal_kind === "failure" ||
    envelope.final_answer_source === "typed_failure"
  ) {
    const ledger = readArray(payload.current_turn_artifact_ledger);
    if (
      !ledger.some(
        (entry) => readString(readRecord(entry)?.artifact_id) === terminalRef,
      )
    ) {
      payload.current_turn_artifact_ledger = [
        ...ledger,
        {
          artifact_id: terminalRef,
          kind: "typed_failure",
          turn_id: envelope.turn_id,
          created_at: new Date().toISOString(),
          payload: {
            ...(readRecord(payload.typed_failure) ?? {}),
            schema: "helix.typed_failure.v1",
            error_code: errorCode ?? "typed_failure",
            message: envelope.terminal_text,
            text: envelope.terminal_text,
            answer_text: envelope.terminal_text,
            assistant_answer: false,
            raw_content_included: false,
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      ];
    }
  }
};

export function applyTerminalAnswerEnvelope(
  payload: Record<string, unknown>,
  envelope: HelixTerminalAnswerEnvelope,
): HelixTerminalAnswerEnvelope {
  if (
    (envelope.terminal_kind === "failure" ||
      envelope.final_answer_source === "typed_failure") &&
    directAnswerContractSatisfied(payload)
  ) {
    const directText = readDirectAnswerArtifactText(payload);
    if (directText) {
      const rejectedFailure = readRecord(payload.typed_failure);
      if (rejectedFailure || readString(payload.terminal_error_code)) {
        payload.rejected_typed_failure = {
          ...(rejectedFailure ?? {}),
          rejected_reason: "successful_terminal_authority_superseded_failure",
          superseded_terminal_error_code: readString(
            payload.terminal_error_code,
          ),
          assistant_answer: false,
          raw_content_included: false,
        };
      }
      delete payload.terminal_error_code;
      delete payload.terminal_failure_text;
      delete payload.typed_failure;
      envelope = {
        ...envelope,
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: directAnswerFinalAnswerSource(payload),
        terminal_text: directText,
        terminal_text_hash: hashHelixTerminalText(directText),
        terminal_kind: "answer",
        authority_origin: "selected_final_answer",
      };
    }
  }
  if (
    (envelope.terminal_kind === "failure" ||
      envelope.final_answer_source === "typed_failure") &&
    capabilityHelpSummaryTerminalContractSatisfied(payload)
  ) {
    const capabilityHelp = readCapabilityHelpSummaryArtifact(payload);
    if (capabilityHelp) {
      const rejectedFailure = readRecord(payload.typed_failure);
      if (rejectedFailure || readString(payload.terminal_error_code)) {
        payload.rejected_typed_failure = {
          ...(rejectedFailure ?? {}),
          rejected_reason:
            "successful_capability_help_terminal_superseded_failure",
          superseded_terminal_error_code: readString(
            payload.terminal_error_code,
          ),
          assistant_answer: false,
          raw_content_included: false,
        };
      }
      delete payload.terminal_error_code;
      delete payload.terminal_failure_text;
      delete payload.typed_failure;
      envelope = {
        ...envelope,
        terminal_artifact_kind: "capability_help_summary",
        final_answer_source: "capability_help_summary",
        terminal_text: capabilityHelp.text,
        terminal_text_hash: hashHelixTerminalText(capabilityHelp.text),
        terminal_kind: "answer",
        authority_origin: "capability_help_summary",
      };
      payload.terminal_artifact_id =
        capabilityHelp.ref ?? `${envelope.turn_id}:capability_help_summary`;
    }
  }
  if (envelope.terminal_artifact_kind === "repo_code_evidence_answer") {
    envelope = buildRepoAnswerQualityFailureEnvelope(payload, envelope);
  }
  if (
    envelope.terminal_kind !== "failure" &&
    envelope.final_answer_source !== "typed_failure" &&
    isUnavailableTerminalPlaceholderText(envelope.terminal_text)
  ) {
    envelope = buildUnavailableTerminalTextFailureEnvelope(payload, envelope);
  }
  const previewPayload = {
    ...payload,
    ...(isRequestUserInputEnvelope(envelope)
      ? {}
      : { selected_final_answer: envelope.terminal_text }),
    terminal_artifact_kind: envelope.terminal_artifact_kind,
    final_answer_source: envelope.final_answer_source,
    terminal_answer_envelope: envelope,
  };
  const initialBoundary = evaluateTerminalBoundaryEligibility(previewPayload);
  if (
    !initialBoundary.eligible &&
    envelope.terminal_kind !== "request_user_input"
  ) {
    if (isNonAuthoritativeToolReceiptEnvelope(envelope)) {
      payload.terminal_eligible = false;
    } else {
      envelope = buildTerminalBoundaryFailureEnvelope(
        payload,
        envelope,
        initialBoundary,
      );
    }
  }

  clearStaleFailureFieldsForSuccessfulTerminal(payload, envelope);
  syncSuccessfulTerminalStatusMirrors(payload, envelope);

  payload.turn_id = envelope.turn_id;
  payload.thread_id = envelope.thread_id;
  if (isRequestUserInputEnvelope(envelope)) {
    const pendingRequest = readRecord(payload.pending_server_request) ??
      readRecord(payload.request_user_input) ??
      readRecord(payload.pending_request) ?? {
        schema: "helix.pending_server_request.v1",
        request_kind: "request_user_input",
        turn_id: envelope.turn_id,
        prompt: envelope.terminal_text,
        status: "pending",
        assistant_answer: false,
        raw_content_included: false,
      };
    payload.pending_server_request = pendingRequest;
    payload.pending_request = pendingRequest;
    payload.request_user_input = pendingRequest;
    payload.request_user_input_preview = {
      schema: "helix.request_user_input_preview.v1",
      turn_id: envelope.turn_id,
      prompt: envelope.terminal_text,
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.selected_final_answer = envelope.terminal_text;
    payload.assistant_answer = false;
    payload.answer = envelope.terminal_text;
    payload.text = envelope.terminal_text;
    payload.finalAnswer = envelope.terminal_text;
    payload.content = envelope.terminal_text;
  } else {
    if (isNonAuthoritativeToolReceiptEnvelope(envelope)) {
      payload.receipt_status_text = envelope.terminal_text;
      delete payload.selected_final_answer;
    } else {
      payload.selected_final_answer = envelope.terminal_text;
    }
    payload.assistant_answer = isNonAuthoritativeToolReceiptEnvelope(envelope)
      ? false
      : envelope.terminal_text;
    payload.answer = envelope.terminal_text;
    payload.text = envelope.terminal_text;
    if (isNonAuthoritativeToolReceiptEnvelope(envelope)) {
      delete payload.finalAnswer;
    } else {
      payload.finalAnswer = envelope.terminal_text;
    }
    payload.content = envelope.terminal_text;
  }
  payload.terminal_artifact_kind = envelope.terminal_artifact_kind;
  payload.final_answer_source = envelope.final_answer_source;
  payload.terminal_answer_envelope = envelope;
  payload.terminal_eligible = isNonAuthoritativeToolReceiptEnvelope(envelope)
    ? false
    : payload.terminal_eligible;
  payload.terminal_boundary_eligibility =
    evaluateTerminalBoundaryEligibility(payload);
  const runtimeRecord = readRecord(payload.turn_runtime);
  if (
    runtimeRecord &&
    envelope.terminal_kind !== "failure" &&
    envelope.final_answer_source !== "typed_failure"
  ) {
    payload.turn_runtime = {
      ...runtimeRecord,
      status: isNonAuthoritativeToolReceiptEnvelope(envelope)
        ? "checkpoint_pending"
        : "completed",
      terminal: {
        kind: isNonAuthoritativeToolReceiptEnvelope(envelope)
          ? "tool_receipt"
          : "final_answer",
        text: envelope.terminal_text,
        error_code: null,
      },
      missing_required_artifacts: [],
    };
  }

  const presentation = readRecord(payload.terminal_presentation);
  payload.terminal_presentation = {
    ...(presentation ?? {
      schema: "helix.terminal_presentation.v1",
      presentation_id: `terminal_presentation:${envelope.turn_id}`,
      turn_id: envelope.turn_id,
      terminal_artifact_kind: envelope.terminal_artifact_kind,
      expansion_available: false,
      expansion_ref: null,
      distillation_ref: null,
      receipt_snapshot_ref: null,
      assistant_answer: false,
      raw_content_included: false,
    }),
    schema: "helix.terminal_presentation.v1",
    turn_id: envelope.turn_id,
    terminal_artifact_kind: envelope.terminal_artifact_kind,
    concise_text: envelope.terminal_text,
    assistant_answer: false,
    terminal_eligible:
      isNonAuthoritativeToolReceiptEnvelope(envelope) ||
      isRequestUserInputEnvelope(envelope)
        ? false
        : undefined,
    raw_content_included: false,
  };

  const terminalAuthority = buildHelixTurnTerminalAuthority({
    thread_id: envelope.thread_id,
    turn_id: envelope.turn_id,
    final_answer_source: envelope.final_answer_source,
    terminal_artifact_kind: envelope.terminal_artifact_kind,
    terminal_kind: envelope.terminal_kind,
    terminal_text: envelope.terminal_text,
    terminal_item_id: readString(payload.terminal_item_id),
    route: readString(payload.route_reason_code) ?? readString(payload.route),
    authority_origin: envelope.authority_origin,
    server_authoritative: isNonAuthoritativeToolReceiptEnvelope(envelope)
      ? false
      : true,
    terminal_eligible:
      isNonAuthoritativeToolReceiptEnvelope(envelope) ||
      isRequestUserInputEnvelope(envelope)
        ? false
        : undefined,
    assistant_answer: false,
  });
  payload.terminal_answer_authority = terminalAuthority;
  synchronizeTerminalAuthorityWriterWithEnvelope(payload, envelope);
  payload.current_turn_events = upsertCurrentTurnEvents(
    payload.current_turn_events,
    envelope,
  );
  payload.turn_events = upsertTerminalAnswerInArray(
    payload.turn_events,
    envelope,
  );

  const poisonAudit = auditHelixAskContextForPoison({
    thread_id: envelope.thread_id,
    turn_id: envelope.turn_id,
    payload,
    terminal_authority: terminalAuthority,
    client_visible_text: envelope.terminal_text,
  });
  payload.poison_audit = poisonAudit;

  payload.terminal_presentation_coverage_audit =
    auditTerminalPresentationCoverage({
      payload,
      turnId: envelope.turn_id,
      route:
        readString(payload.route_reason_code) ??
        readString(payload.route) ??
        "/ask/turn",
      terminalArtifactKind: envelope.terminal_artifact_kind,
      selectedFinalAnswer: envelope.terminal_text,
    });

  const debug = readRecord(payload.debug);
  if (debug) {
    if (isRequestUserInputEnvelope(envelope)) {
      delete debug.selected_final_answer;
      debug.assistant_answer = false;
      delete debug.answer;
      delete debug.text;
      delete debug.finalAnswer;
      delete debug.content;
      debug.pending_server_request = payload.pending_server_request;
      debug.pending_request = payload.pending_request;
      debug.request_user_input = payload.request_user_input;
      debug.request_user_input_preview = payload.request_user_input_preview;
    } else if (isNonAuthoritativeToolReceiptEnvelope(envelope)) {
      debug.receipt_status_text = envelope.terminal_text;
      delete debug.selected_final_answer;
      debug.assistant_answer = false;
      debug.answer = envelope.terminal_text;
      debug.text = envelope.terminal_text;
      delete debug.finalAnswer;
      debug.content = envelope.terminal_text;
    } else {
      debug.selected_final_answer = envelope.terminal_text;
      debug.answer = envelope.terminal_text;
      debug.text = envelope.terminal_text;
      debug.finalAnswer = envelope.terminal_text;
      debug.content = envelope.terminal_text;
    }
    debug.terminal_artifact_kind = envelope.terminal_artifact_kind;
    debug.final_answer_source = envelope.final_answer_source;
    debug.terminal_presentation = payload.terminal_presentation;
    debug.terminal_answer_authority = payload.terminal_answer_authority;
    debug.terminal_answer_envelope = envelope;
    if (
      envelope.terminal_kind !== "failure" &&
      envelope.final_answer_source !== "typed_failure" &&
      !isNonAuthoritativeToolReceiptEnvelope(envelope)
    ) {
      debug.ok = true;
      debug.status = isRequestUserInputEnvelope(envelope)
        ? "pending_input"
        : "final_answer";
      debug.final_status = isRequestUserInputEnvelope(envelope)
        ? "pending_input"
        : "final_answer";
      debug.response_type = isRequestUserInputEnvelope(envelope)
        ? "pending_input"
        : "final_answer";
      debug.resolved_turn_summary = payload.resolved_turn_summary;
      if (!isRequestUserInputEnvelope(envelope)) {
        delete debug.terminal_error_code;
        delete debug.terminal_failure_text;
        delete debug.typed_failure;
      }
    } else if (isNonAuthoritativeToolReceiptEnvelope(envelope)) {
      debug.ok = true;
      debug.status = "tool_receipt";
      debug.final_status = "checkpoint_pending";
      debug.response_type = "tool_receipt";
      debug.assistant_answer = false;
      debug.terminal_eligible = false;
    }
    debug.terminal_boundary_eligibility = payload.terminal_boundary_eligibility;
    debug.current_turn_events = payload.current_turn_events;
    debug.turn_events = payload.turn_events;
    debug.poison_audit = payload.poison_audit;
    debug.terminal_presentation_coverage_audit =
      payload.terminal_presentation_coverage_audit;
  }

  return envelope;
}

export function applyTerminalProjectionMissedInternalSuccessFailure(
  payload: Record<string, unknown>,
  options: { threadId?: string | null; turnId?: string | null } = {},
): HelixTerminalAnswerEnvelope {
  const diagnostic =
    "The turn succeeded internally, but the terminal projection did not select the successful answer artifact.";
  payload.terminal_failure_text = diagnostic;
  payload.typed_failure = {
    schema: "helix.typed_failure.v1",
    error_code: "terminal_projection_missed_internal_success",
    message: diagnostic,
    text: diagnostic,
    answer_text: diagnostic,
    assistant_answer: false,
    raw_content_included: false,
  };
  payload.terminal_error_code = "terminal_projection_missed_internal_success";
  const envelope: HelixTerminalAnswerEnvelope = {
    schema: "helix.terminal_answer_envelope.v1",
    turn_id: readTurnId(payload, options.turnId),
    thread_id: readThreadId(payload, options.threadId),
    source_target: readSourceTarget(payload),
    terminal_artifact_kind: "typed_failure",
    final_answer_source: "typed_failure",
    terminal_text: diagnostic,
    terminal_text_hash: hashHelixTerminalText(diagnostic),
    terminal_kind: "failure",
    authority_origin: "typed_failure",
    assistant_answer: false,
    raw_content_included: false,
  };
  return applyTerminalAnswerEnvelope(payload, envelope);
}
