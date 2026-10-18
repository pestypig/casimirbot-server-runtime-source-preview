import type { HelixFinalRouteReconciliation } from "@shared/helix-final-route-reconciliation";
import type { HelixSolverControllerBlockingReason, HelixSolverControllerDecision } from "@shared/helix-solver-controller-decision";
import type { HelixTurnIdIntegrityAudit, HelixTurnIdIntegrityViolationCode } from "@shared/helix-turn-id-integrity-audit";
import {
  buildCapabilityBindingMismatchObservation,
  evaluateTerminalBoundaryEligibility,
} from "./runtime-authority-contract";
import {
  committedRouteAllowsTerminalKind,
  normalizeCommittedRouteTerminalKind,
  readCommittedAskRoute,
} from "./committed-ask-route";
import { applyCompoundTerminalPolicy } from "./compound-terminal-policy";
import { resolvePublishedWorkstationToolTerminal } from "./terminal-identity-precedence";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const readStringArray = (value: unknown): string[] =>
  readArray(value).map(readString).filter((entry): entry is string => Boolean(entry));

const hasSatisfiedRequiredEvidenceKind = (goalSatisfaction: RecordLike | null, kind: string): boolean =>
  readArray(goalSatisfaction?.required_evidence).some((entry) => {
    const record = readRecord(entry);
    return readString(record?.kind) === kind && readBoolean(record?.satisfied) === true;
  });

const hasCurrentTurnArtifactKind = (payload: RecordLike, kind: string): boolean =>
  readArray(payload.current_turn_artifact_ledger).some((entry) => readString(readRecord(entry)?.kind) === kind);

const payloadArtifactPayloadByKind = (
  payload: RecordLike,
  kind: string,
): RecordLike | null => {
  const artifact = readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .find((entry) => readString(entry?.kind) === kind);
  return readRecord(artifact?.payload);
};

const resolveAuthoritativeWorkstationToolTerminal = (
  payload: RecordLike,
): { terminalArtifactKind: "workstation_tool_evaluation"; finalAnswerSource: "workstation_tool_evaluation" } | null =>
  resolvePublishedWorkstationToolTerminal(payload);

const resolveAuthoritativeCapabilityHelpTerminal = (
  payload: RecordLike,
): { terminalArtifactKind: "capability_help_summary"; finalAnswerSource: "capability_help_summary" } | null => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  const terminalWriter = readRecord(payload.terminal_authority_single_writer);
  const terminalAuthority = readRecord(payload.terminal_answer_authority);
  const requiredTerminalKind =
    readString(canonicalGoal?.required_terminal_kind) ??
    readString(goalSatisfaction?.required_terminal_kind);
  const goalKind =
    readString(canonicalGoal?.goal_kind) ??
    readString(goalSatisfaction?.canonical_goal_kind);
  const writerKind =
    readString(terminalWriter?.selected_terminal_artifact_kind) ??
    readString(terminalWriter?.selectedArtifactKind);
  const authorityKind = readString(terminalAuthority?.terminal_artifact_kind);
  const goalAllowsTerminal =
    readString(goalSatisfaction?.satisfaction) === "satisfied" ||
    readString(goalSatisfaction?.next_decision) === "allow_terminal";
  const capabilityHelpObserved =
    hasCurrentTurnArtifactKind(payload, "capability_help_summary") ||
    hasSatisfiedRequiredEvidenceKind(goalSatisfaction, "capability_help_summary");
  return (
    goalKind === "capability_help" &&
    requiredTerminalKind === "capability_help_summary" &&
    goalAllowsTerminal &&
    capabilityHelpObserved &&
    (writerKind === "capability_help_summary" || authorityKind === "capability_help_summary")
  )
    ? {
        terminalArtifactKind: "capability_help_summary",
        finalAnswerSource: "capability_help_summary",
      }
    : null;
};

const resolveAuthoritativeTheoryContextReflectionTerminal = (
  payload: RecordLike,
): { terminalArtifactKind: "theory_context_reflection_answer"; finalAnswerSource: "final_answer_draft" } | null => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const terminalWriter = readRecord(payload.terminal_authority_single_writer);
  const terminalAuthority = readRecord(payload.terminal_answer_authority);
  const requiredTerminalKind =
    readString(canonicalGoal?.required_terminal_kind) ??
    readString(goalSatisfaction?.required_terminal_kind) ??
    readStringArray(terminalContract?.required_terminal_kinds)[0] ??
    null;
  const goalKind =
    readString(canonicalGoal?.goal_kind) ??
    readString(goalSatisfaction?.canonical_goal_kind) ??
    readString(terminalContract?.goal_kind);
  const writerKind =
    readString(terminalWriter?.selected_terminal_artifact_kind) ??
    readString(terminalWriter?.selectedArtifactKind);
  const authorityKind = readString(terminalAuthority?.terminal_artifact_kind);
  const goalAllowsTerminal =
    readString(goalSatisfaction?.satisfaction) === "satisfied" ||
    readString(goalSatisfaction?.next_decision) === "allow_terminal";
  const theoryTerminalObserved =
    hasCurrentTurnArtifactKind(payload, "theory_context_reflection_answer") ||
    Boolean(readRecord(payload.theory_context_reflection_answer));
  return (
    goalKind === "theory_context_reflection" &&
    requiredTerminalKind === "theory_context_reflection_answer" &&
    goalAllowsTerminal &&
    theoryTerminalObserved &&
    (writerKind === "theory_context_reflection_answer" || authorityKind === "theory_context_reflection_answer")
  )
    ? {
        terminalArtifactKind: "theory_context_reflection_answer",
        finalAnswerSource: "final_answer_draft",
      }
    : null;
};

type AuthoritativeDocumentLocationTerminalKind =
  | "doc_location_matches"
  | "doc_evidence_location"
  | "doc_location_result";

const isDocumentLocationTerminalKind = (
  value: string | null,
): value is AuthoritativeDocumentLocationTerminalKind =>
  value === "doc_location_matches" ||
  value === "doc_evidence_location" ||
  value === "doc_location_result";

const documentLocationTerminalCompatible = (
  selectedKind: AuthoritativeDocumentLocationTerminalKind,
  requiredKind: string | null,
): boolean => {
  if (!requiredKind || requiredKind === selectedKind) return true;
  return (
    (requiredKind === "doc_location_result" || requiredKind === "doc_evidence_location") &&
    (selectedKind === "doc_location_matches" || selectedKind === "doc_evidence_location" || selectedKind === "doc_location_result")
  );
};

const resolveAuthoritativeDocumentLocationTerminal = (
  payload: RecordLike,
): { terminalArtifactKind: AuthoritativeDocumentLocationTerminalKind; finalAnswerSource: AuthoritativeDocumentLocationTerminalKind } | null => {
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const terminalWriter = readRecord(payload.terminal_authority_single_writer);
  const requiredTerminalKind =
    readString(canonicalGoal?.required_terminal_kind) ??
    readString(goalSatisfaction?.required_terminal_kind) ??
    readStringArray(terminalContract?.required_terminal_kinds)[0] ??
    null;
  const goalKind =
    readString(canonicalGoal?.goal_kind) ??
    readString(goalSatisfaction?.canonical_goal_kind) ??
    readString(terminalContract?.goal_kind);
  const writerKind =
    readString(terminalWriter?.selected_terminal_artifact_kind) ??
    readString(terminalWriter?.selectedArtifactKind);
  if (!isDocumentLocationTerminalKind(writerKind)) return null;
  if (
    goalKind !== "locate_in_doc" &&
    goalKind !== "doc_evidence_location" &&
    goalKind !== "doc_location_result"
  ) {
    return null;
  }
  if (!documentLocationTerminalCompatible(writerKind, requiredTerminalKind)) return null;
  const goalAllowsTerminal =
    readString(goalSatisfaction?.satisfaction) === "satisfied" ||
    readString(goalSatisfaction?.next_decision) === "allow_terminal";
  if (!goalAllowsTerminal) return null;
  const locationObserved =
    hasCurrentTurnArtifactKind(payload, writerKind) ||
    hasCurrentTurnArtifactKind(payload, "doc_location_matches") ||
    hasCurrentTurnArtifactKind(payload, "doc_evidence_location") ||
    hasSatisfiedRequiredEvidenceKind(goalSatisfaction, "line_backed_locations");
  return locationObserved
    ? {
        terminalArtifactKind: writerKind,
        finalAnswerSource: writerKind,
      }
    : null;
};

export const normalizeHelixRouteBase = (route: string | null | undefined): string | null => {
  const trimmed = readString(route);
  if (!trimmed) return null;
  if (trimmed === "unknown" || trimmed === "/ask" || trimmed === "/ask/turn") return null;
  return trimmed.split("/")[0]?.trim() || trimmed;
};

const isNonAnswerTerminal = (payload: RecordLike): boolean => {
  if (resolveAuthoritativeCapabilityHelpTerminal(payload)) return false;
  if (resolveAuthoritativeTheoryContextReflectionTerminal(payload)) return false;
  if (resolveAuthoritativeDocumentLocationTerminal(payload)) return false;
  const terminalAuthority = readRecord(payload.terminal_answer_authority);
  const terminalArtifactKind =
    readString(payload.terminal_artifact_kind) ??
    readString(terminalAuthority?.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  const responseType = readString(payload.response_type);
  const finalStatus = readString(payload.final_status);
  return (
    terminalArtifactKind === "typed_failure" ||
    (
      terminalArtifactKind === "tool_receipt" &&
      finalAnswerSource === "deterministic_receipt_fallback"
    ) ||
    terminalArtifactKind === "request_user_input" ||
    terminalArtifactKind === "pending_server_request" ||
    finalAnswerSource === "typed_failure" ||
    finalAnswerSource === "deterministic_receipt_fallback" ||
    finalAnswerSource === "request_user_input" ||
    finalAnswerSource === "pending_server_request" ||
    responseType === "tool_receipt" ||
    responseType === "final_failure" ||
    responseType === "pending_input" ||
    finalStatus === "checkpoint_pending" ||
    finalStatus === "final_failure" ||
    finalStatus === "pending_input"
  );
};

const pushUnique = <T extends string>(items: T[], item: T): void => {
  if (!items.includes(item)) items.push(item);
};

const hasPromptObjectExtractionProblem = (payload: RecordLike): boolean => {
  const prompt = readString(payload.active_prompt) ?? readString(payload.prompt) ?? readString(payload.question) ?? "";
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const goalKind = readString(canonicalGoal?.goal_kind);
  if (goalKind !== "doc_open_best") return false;
  if (!/\bopen\s+(?:the\s+)?docs?\s+for\s+me\b/i.test(prompt)) return false;
  const stepResults = readArray(payload.step_results);
  const ledger = readArray(payload.current_turn_artifact_ledger);
  const queryValues = [
    ...stepResults.map((entry) => readRecord(readRecord(entry)?.result_artifact)?.query),
    ...ledger.map((entry) => readRecord(readRecord(entry)?.payload)?.query),
  ].map(readString).filter(Boolean);
  return queryValues.some((query) => query?.toLowerCase() === "me");
};

const isSourceTargetedOrCapabilityTurn = (payload: RecordLike): boolean => {
  const sourceTarget = readRecord(payload.source_target_intent);
  const targetSource = readString(sourceTarget?.target_source);
  const targetKind = readString(sourceTarget?.target_kind);
  const strength = readString(sourceTarget?.strength);
  const explicitSourceTarget =
    Boolean(targetSource && targetSource !== "unknown") ||
    Boolean(targetKind && targetKind !== "unknown") ||
    strength === "hard" ||
    readBoolean(sourceTarget?.must_enter_backend_ask) === true ||
    readBoolean(sourceTarget?.allow_no_tool_direct) === false ||
    readArray(sourceTarget?.requested_outputs).length > 0;
  return (
    explicitSourceTarget ||
    Boolean(
      readRecord(payload.capability_plan) ||
        readRecord(payload.capability_result) ||
        readRecord(payload.capability_lifecycle_ledger) ||
        readRecord(payload.tool_call_admission_decision) ||
        readRecord(payload.active_workspace_source_resolution),
    )
  );
};

const hasRequiredArtifactContract = (terminalContract: RecordLike | null): boolean =>
  Boolean(
    terminalContract &&
      readString(terminalContract.goal_kind) &&
      readStringArray(terminalContract.required_terminal_kinds).length > 0,
  );

const isCapabilityTerminalKind = (terminalArtifactKind: string | null): boolean =>
  Boolean(
    terminalArtifactKind &&
      /^(?:workspace_action_receipt|workstation_tool_evaluation|live_pipeline_receipt|live_pipeline_turn_receipt|live_source_pipeline_receipt)$/i.test(
        terminalArtifactKind,
      ),
  );

const hasSatisfiedWorkstationToolEvaluation = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (
    terminalArtifactKind !== "workstation_tool_evaluation" &&
    terminalArtifactKind !== "tool_evaluation" &&
    terminalArtifactKind !== "model_synthesized_answer"
  ) return false;
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  if (
    readString(goalSatisfaction?.satisfaction) !== "satisfied" ||
    readString(goalSatisfaction?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const requiredTerminalKinds = readStringArray(terminalContract?.required_terminal_kinds);
  if (requiredTerminalKinds.length > 0 && !requiredTerminalKinds.includes(terminalArtifactKind)) return false;
  if (
    terminalArtifactKind === "model_synthesized_answer" &&
    !requiredTerminalKinds.includes("workstation_tool_evaluation")
  ) return false;
  const observationReview = readRecord(payload.observation_review);
  if (observationReview && readBoolean(observationReview.does_it_satisfy_goal) !== true) return false;
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "workstation_tool_evaluation") return false;
    const artifactPayload = readRecord(artifact?.payload);
    return readBoolean(artifactPayload?.supports_goal) === true;
  });
};

const hasSatisfiedLivePipelineReceipt = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (terminalArtifactKind !== "live_pipeline_receipt") return false;
  const liveTurnReceipt = readRecord(payload.live_pipeline_turn_receipt);
  const pipelineReceiptId = readString(payload.pipeline_receipt_id);
  const pipelineId = readString(payload.pipeline_id);
  if (liveTurnReceipt || pipelineReceiptId || pipelineId) return true;
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (!artifact) return false;
    const artifactKind = readString(artifact.kind);
    const artifactPayload = readRecord(artifact.payload);
    return (
      artifactKind === "live_pipeline_receipt" ||
      (
        artifactKind === "tool_observation" &&
        (
          readString(artifactPayload?.schema) === "helix.live_pipeline_turn_receipt.v1" ||
          Boolean(readString(artifactPayload?.pipeline_receipt_id) || readString(artifactPayload?.pipeline_id))
        )
      )
    );
  });
};

const hasSatisfiedLiveEnvironmentBindingDiagnosis = (
  payload: RecordLike,
  terminalArtifactKind: string | null,
): boolean => {
  if (terminalArtifactKind !== "live_environment_binding_diagnosis") return false;
  if (readString(payload.final_answer_source) !== terminalArtifactKind) return false;
  const goal = readRecord(payload.canonical_goal_frame);
  if (
    readString(goal?.goal_kind) !== terminalArtifactKind ||
    readString(goal?.required_terminal_kind) !== terminalArtifactKind
  ) {
    return false;
  }
  const routeContract = readRecord(payload.route_product_contract);
  const allowedKinds = readStringArray(
    routeContract?.allowed_terminal_artifact_kinds,
  );
  const requiredKind =
    readString(routeContract?.required_terminal_artifact_kind) ??
    readString(routeContract?.required_terminal_kind);
  if (
    readString(routeContract?.schema) !== "helix.route_product_contract.v1" ||
    (!allowedKinds.includes(terminalArtifactKind) &&
      requiredKind !== terminalArtifactKind) ||
    readStringArray(routeContract?.forbidden_terminal_artifact_kinds).includes(
      terminalArtifactKind,
    )
  ) {
    return false;
  }
  const diagnosis = readRecord(payload.live_environment_binding_diagnosis);
  return Boolean(
    /^helix\.live_environment_binding_diagnosis\.v\d+$/i.test(
      readString(diagnosis?.schema) ?? "",
    ) &&
      diagnosis?.assistant_answer === false &&
      diagnosis?.raw_content_included === false &&
      readString(diagnosis?.diagnosis_id),
  );
};

const hasSatisfiedDocOpenReceipt = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (terminalArtifactKind !== "doc_open_receipt") return false;
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  if (
    readString(goalSatisfaction?.satisfaction) !== "satisfied" ||
    readString(goalSatisfaction?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const requiredTerminalKinds = readStringArray(terminalContract?.required_terminal_kinds);
  if (requiredTerminalKinds.length > 0 && !requiredTerminalKinds.includes("doc_open_receipt")) return false;
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "doc_open_receipt") return false;
    const artifactPayload = readRecord(artifact?.payload);
    return readString(artifactPayload?.status) === "opened";
  });
};

const hasSatisfiedDocSummary = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (terminalArtifactKind !== "doc_summary") return false;
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  if (
    readString(goalSatisfaction?.satisfaction) !== "satisfied" ||
    readString(goalSatisfaction?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const requiredTerminalKinds = readStringArray(terminalContract?.required_terminal_kinds);
  if (requiredTerminalKinds.length > 0 && !requiredTerminalKinds.includes("doc_summary")) return false;
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "doc_summary") return false;
    const artifactPayload = readRecord(artifact?.payload);
    return Boolean(
      readString(artifactPayload?.text) ||
        readString(artifactPayload?.summary) ||
        readString(artifactPayload?.answer_text),
    );
  });
};

const hasSatisfiedDocumentTerminal = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (
    terminalArtifactKind !== "active_doc_identity" &&
    terminalArtifactKind !== "doc_location_matches" &&
    terminalArtifactKind !== "doc_evidence_location" &&
    terminalArtifactKind !== "doc_location_result"
  ) {
    return false;
  }
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  if (
    readString(goalSatisfaction?.satisfaction) !== "satisfied" ||
    readString(goalSatisfaction?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const requiredTerminalKinds = readStringArray(terminalContract?.required_terminal_kinds);
  if (requiredTerminalKinds.length > 0 && !requiredTerminalKinds.includes(terminalArtifactKind)) return false;
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== terminalArtifactKind) return false;
    const artifactPayload = readRecord(artifact?.payload);
    if (terminalArtifactKind === "active_doc_identity") {
      return Boolean(readString(artifactPayload?.active_doc_path));
    }
    return Boolean(
      readString(artifactPayload?.text) ||
        readString(artifactPayload?.summary) ||
        readString(artifactPayload?.answer_text) ||
        readArray(artifactPayload?.matches).length > 0,
    );
  });
};

const hasSatisfiedTheoryContextReflectionAnswer = (
  payload: RecordLike,
  terminalArtifactKind: string | null,
): boolean => {
  if (terminalArtifactKind !== "theory_context_reflection_answer") return false;
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  if (
    readString(goalSatisfaction?.satisfaction) !== "satisfied" ||
    readString(goalSatisfaction?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const requiredTerminalKinds = readStringArray(terminalContract?.required_terminal_kinds);
  if (requiredTerminalKinds.length > 0 && !requiredTerminalKinds.includes("theory_context_reflection_answer")) {
    return false;
  }
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "theory_context_reflection_answer") return false;
    const artifactPayload = readRecord(artifact?.payload);
    return Boolean(readString(artifactPayload?.answer_text) ?? readString(artifactPayload?.text));
  });
};

const hasMaterializedScholarlyResearchAnswer = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (terminalArtifactKind !== "scholarly_research_answer") return false;
  if (readString(payload.final_answer_source) !== "final_answer_draft") return false;
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  if (readString(canonicalGoal?.goal_kind) !== "scholarly_research_lookup") return false;
  if (readString(canonicalGoal?.required_terminal_kind) !== "scholarly_research_answer") return false;
  const consistency = readRecord(payload.terminal_consistency_check);
  if (readBoolean(consistency?.consistent) === false) return false;
  const capabilityItinerary =
    readRecord(payload.capability_itinerary) ??
    payloadArtifactPayloadByKind(payload, "capability_itinerary");
  const executionState =
    readRecord(payload.capability_itinerary_execution_state) ??
    readRecord(capabilityItinerary?.execution_state) ??
    payloadArtifactPayloadByKind(payload, "capability_itinerary_execution_state");
  if (readBoolean(executionState?.applies) === true && readBoolean(executionState?.complete) !== true) return false;

  const finalDraft =
    readRecord(payload.final_answer_draft) ??
    readArray(payload.current_turn_artifact_ledger)
      .map((entry) => readRecord(readRecord(entry)?.payload))
      .find((entry) =>
        readString(entry?.schema) === "helix.final_answer_draft.v1" &&
        readString(entry?.authority) === "llm_post_observation_composer" &&
        readString(entry?.composer_scope) === "source_tool_backed"
      ) ??
    null;
  if (
    readString(finalDraft?.authority) !== "llm_post_observation_composer" ||
    readString(finalDraft?.composer_scope) !== "source_tool_backed"
  ) {
    return false;
  }
  const finalDraftSupportRefs = [
    ...readStringArray(finalDraft?.support_refs),
    ...readStringArray(finalDraft?.grounded_in_observation_refs),
    ...readStringArray(finalDraft?.receipt_refs),
  ];

  const scholarlyAnswer =
    readRecord(payload.scholarly_research_answer) ??
    readArray(payload.current_turn_artifact_ledger)
      .map((entry) => {
        const artifact = readRecord(entry);
        return readString(artifact?.kind) === "scholarly_research_answer"
          ? readRecord(artifact?.payload)
          : null;
      })
      .find((entry) => Boolean(entry)) ??
    null;
  const scholarlyAnswerSupportRefs = [
    ...readStringArray(scholarlyAnswer?.support_refs),
    ...readStringArray(scholarlyAnswer?.source_observation_refs),
    ...readStringArray(scholarlyAnswer?.receipt_refs),
  ];
  const supportRefs = [...finalDraftSupportRefs, ...scholarlyAnswerSupportRefs];
  const hasScholarlyObservationRef = supportRefs.some((ref) => /scholarly_research_observation|scholarly_full_text_observation/i.test(ref));
  if (!hasScholarlyObservationRef) return false;

  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    return readString(artifact?.kind) === "scholarly_research_observation" ||
      readString(artifact?.kind) === "scholarly_full_text_observation";
  });
};

const hasFinalInterimVoiceCalloutReceipt = (payload: RecordLike): boolean =>
  readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "live_environment_tool_observation") return false;
    const artifactPayload = readRecord(artifact?.payload);
    if (readString(artifactPayload?.tool_name) !== "live_env.request_interim_voice_callout") return false;
    const observation = readRecord(artifactPayload?.observation);
    if (readString(observation?.schema) !== "helix.interim_voice_callout_tool_result.v1") return false;
    const receiptStatus = readString(readRecord(observation?.receipt)?.status);
    return Boolean(receiptStatus && [
      "awaiting_client_playback",
      "queued",
      "queued_for_retry",
      "delivered",
      "expired",
      "blocked_capacity",
      "blocked_policy",
      "blocked_missing_text",
    ].includes(receiptStatus));
  });

const hasLiveSourceMailDecisionReceipt = (payload: RecordLike): boolean =>
  readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    const artifactKind = readString(artifact?.kind);
    const artifactPayload = readRecord(artifact?.payload);
    const observation = readRecord(artifactPayload?.observation);
    return (
      (
        artifactKind === "live_environment_tool_observation" &&
        readString(artifactPayload?.tool_name) === "live_env.record_live_source_mail_decision"
      ) ||
      readString(artifactPayload?.artifactId) === "stage_play_live_source_mail_decision" ||
      readString(artifactPayload?.schemaVersion) === "stage_play_live_source_mail_decision/v1" ||
      readString(observation?.artifactId) === "stage_play_live_source_mail_decision" ||
      readString(observation?.schemaVersion) === "stage_play_live_source_mail_decision/v1"
    );
  });

const hasObservationKind = (payload: RecordLike, expectedKind: string): boolean =>
  expectedKind === "live_source_interim_voice_callout_receipt" && hasFinalInterimVoiceCalloutReceipt(payload)
    ? true
    : readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    const artifactKind = readString(artifact?.kind);
    const artifactSchema = readString(artifact?.schema);
    const artifactId = readString(artifact?.artifact_id) ?? readString(artifact?.artifactId);
    const artifactPayload = readRecord(artifact?.payload);
    const observation = readRecord(artifactPayload?.observation);
    const result = readRecord(artifactPayload?.result);
    return [
      artifactKind,
      artifactSchema,
      artifactId,
      readString(artifactPayload?.kind),
      readString(artifactPayload?.schema),
      readString(artifactPayload?.schemaVersion),
      readString(artifactPayload?.artifactId),
      readString(observation?.kind),
      readString(observation?.schema),
      readString(observation?.schemaVersion),
      readString(observation?.artifactId),
      readString(result?.kind),
      readString(result?.schema),
      readString(result?.schemaVersion),
      readString(result?.artifactId),
    ].some((value) => value === expectedKind || value === `${expectedKind}/v1`);
  });

const liveSourcePhaseRequiresMailDecision = (payload: RecordLike): boolean => {
  const phase = readRecord(payload.live_source_turn_phase_resolution);
  if (readBoolean(readRecord(phase?.phaseLock)?.locked) !== true) return false;
  if (readString(phase?.phase) !== "record_decision") return false;
  if (!readStringArray(phase?.requiredEvidence).includes("stage_play_processed_mail_packet")) return false;
  return !hasLiveSourceMailDecisionReceipt(payload);
};

const liveSourcePhaseRequiresVoiceReceiptOrHold = (payload: RecordLike): boolean => {
  const phase = readRecord(payload.live_source_turn_phase_resolution);
  if (readBoolean(readRecord(phase?.phaseLock)?.locked) !== true) return false;
  if (readString(phase?.phase) !== "request_voice_after_decision") return false;
  const completionEvidence = readStringArray(phase?.completionEvidence);
  if (
    completionEvidence.length > 0 &&
    completionEvidence.some((kind) => kind !== "live_source_interim_voice_callout_receipt" && hasObservationKind(payload, kind))
  ) {
    return false;
  }
  if (!hasLiveSourceMailDecisionReceipt(payload)) return false;
  return !hasFinalInterimVoiceCalloutReceipt(payload);
};

const terminalForbiddenByLiveSourcePhaseLock = (payload: RecordLike): boolean => {
  const phase = readRecord(payload.live_source_turn_phase_resolution);
  if (readBoolean(readRecord(phase?.phaseLock)?.locked) !== true) return false;
  if (readBoolean(phase?.terminal_eligible) === true || readBoolean(phase?.terminalAllowed) === true) return false;
  const phaseName = readString(phase?.phase);
  if (phaseName !== "record_decision" && phaseName !== "request_voice_after_decision") return false;
  const terminalArtifactKind = readString(payload.terminal_artifact_kind);
  if (!terminalArtifactKind) return false;
  const completionEvidence = readStringArray(phase?.completionEvidence);
  return completionEvidence.length === 0 || completionEvidence.every((kind) => !hasObservationKind(payload, kind));
};

const receiptTerminalNotEligible = (payload: RecordLike): boolean => {
  const terminalArtifactKind = readString(payload.terminal_artifact_kind);
  const responseType = readString(payload.response_type);
  const terminalPresentation = readRecord(payload.terminal_presentation);
  const terminalEligible =
    readBoolean(payload.terminal_eligible) ??
    readBoolean(terminalPresentation?.terminal_eligible);
  const receiptLike =
    terminalArtifactKind === "tool_receipt" ||
    terminalArtifactKind === "live_environment_tool_observation" ||
    Boolean(terminalArtifactKind && /receipt/i.test(terminalArtifactKind)) ||
    responseType === "tool_receipt";
  return receiptLike && terminalEligible === false;
};

const terminalWriterRejectedReasons = (payload: RecordLike): HelixSolverControllerBlockingReason[] => {
  const writer = readRecord(payload.terminal_authority_single_writer);
  return readArray(writer?.rejected_candidates)
    .map((entry) => readString(readRecord(entry)?.reason))
    .filter((reason): reason is HelixSolverControllerBlockingReason =>
      reason === "stale_model_only_after_observation" ||
      reason === "composer_claimed_no_observations_but_receipts_exist" ||
      reason === "receipt_not_terminal_eligible" ||
      reason === "terminal_forbidden_by_phase_lock" ||
      reason === "missing_required_live_source_mail_decision" ||
      reason === "missing_required_voice_receipt_or_hold",
    );
};

const hasLiveSourceSetupReceipt = (payload: RecordLike): boolean => {
  const phase = readRecord(payload.live_source_turn_phase_resolution);
  const phaseName = readString(phase?.phase);
  const canonicalGoal = readString(phase?.canonicalGoal);
  const phaseLocked = readBoolean(readRecord(phase?.phaseLock)?.locked) === true;
  if (!phaseLocked) return false;
  const expectedTool =
    canonicalGoal === "configure_interpreter_profile" || phaseName === "configure_interpreter_profile"
      ? "live_env.configure_interpreter_profile"
      : canonicalGoal === "configure_watch_job" || phaseName === "configure_watch_job"
        ? "live_env.configure_live_source_watch_job"
        : canonicalGoal === "apply_visual_observer_profile" || phaseName === "apply_visual_observer_profile"
          ? null
          : null;
  if (!expectedTool && canonicalGoal !== "apply_visual_observer_profile" && phaseName !== "apply_visual_observer_profile") {
    return false;
  }
  return readArray(payload.current_turn_artifact_ledger).some((entry) => {
    const artifact = readRecord(entry);
    if (readString(artifact?.kind) !== "live_environment_tool_observation") return false;
    const artifactPayload = readRecord(artifact?.payload);
    const toolName = readString(artifactPayload?.tool_name);
    const observation = readRecord(artifactPayload?.observation);
    if (expectedTool) {
      return toolName === expectedTool;
    }
    return (
      toolName === "live_env.configure_visual_observer_profile" ||
      toolName === "live_env.apply_visual_observer_profile" ||
      toolName === "live_env.query_visual_observer_profiles" ||
      toolName === "live_env.test_visual_observer_profile" ||
      toolName === "live_env.compare_visual_observer_profiles" ||
      readString(observation?.artifactId) === "stage_play_visual_observer_profile" ||
      readString(observation?.schemaVersion) === "stage_play_visual_observer_profile/v1"
    );
  });
};

const hasIncompletePromptRequirementCoverage = (payload: RecordLike): boolean => {
  const coverage = readRecord(payload.prompt_requirement_coverage);
  const coverageState = readString(coverage?.coverage);
  return Boolean(coverageState && coverageState !== "complete");
};

const hasIncompleteDocRetrievalCoverage = (payload: RecordLike): boolean => {
  const coverage = readRecord(payload.doc_retrieval_coverage);
  const schema = readString(coverage?.schema);
  const coverageState = readString(coverage?.coverage);
  return schema === "helix.doc_retrieval_coverage.v1" && Boolean(coverageState && coverageState !== "complete");
};

const hasIncompleteCompoundPromptCoverageGate = (payload: RecordLike): boolean => {
  const gate = readRecord(payload.compound_prompt_coverage_gate);
  return (
    readString(gate?.schema) === "helix.compound_prompt_coverage_gate.v1" &&
    gate?.applies === true &&
    gate?.passed !== true
  );
};

const compoundCapabilityKeysFromPayload = (payload: RecordLike): string[] => {
  const capabilityPlan = readRecord(payload.capability_plan);
  const admission = readRecord(payload.tool_call_admission_decision);
  const itinerary = readRecord(payload.capability_itinerary);
  const contract =
    readRecord(payload.compound_capability_contract) ??
    readRecord(readRecord(itinerary?.compound_capability_contract));
  const subgoalCapabilities = readArray(contract?.subgoals)
    .map(readRecord)
    .flatMap((subgoal) => [
      readString(subgoal?.requested_capability),
      readString(subgoal?.runtime_capability),
      readString(subgoal?.selected_capability),
      readString(subgoal?.executed_capability),
    ]);
  return [
    ...subgoalCapabilities,
    ...readStringArray(admission?.compound_requested_capabilities),
    ...readStringArray(capabilityPlan?.compound_requested_capabilities),
  ].filter((entry): entry is string => Boolean(entry));
};

const hasExplicitToolCompoundCapabilityRequirement = (payload: RecordLike): boolean => {
  const capabilities = compoundCapabilityKeysFromPayload(payload);
  if (capabilities.length <= 1) return false;
  return capabilities.some((capability) =>
    !/^(?:model(?:[._-]direct)?|model_only|conversation)(?:[._-]|$)/i.test(capability)
  );
};

const hasModelOnlyCompoundAnswerCoverage = (payload: RecordLike): boolean => {
  const coverage = readRecord(payload.model_only_compound_coverage_from_answer);
  return (
    readString(coverage?.schema) === "helix.model_only_compound_coverage_from_answer.v1" &&
    coverage?.passed === true &&
    readString(coverage?.route_scope) === "model_only_allowed" &&
    !hasExplicitToolCompoundCapabilityRequirement(payload)
  );
};

const isCapabilityLifecycleComplete = (payload: RecordLike, terminalArtifactKind: string | null): boolean => {
  if (hasMaterializedScholarlyResearchAnswer(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedWorkstationToolEvaluation(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedLivePipelineReceipt(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedLiveEnvironmentBindingDiagnosis(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedDocOpenReceipt(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedDocSummary(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedDocumentTerminal(payload, terminalArtifactKind)) return true;
  if (hasSatisfiedTheoryContextReflectionAnswer(payload, terminalArtifactKind)) return true;
  const plan = readRecord(payload.capability_plan);
  const result = readRecord(payload.capability_result);
  const ledger = readRecord(payload.capability_lifecycle_ledger);
  const adapterRequest = readRecord(payload.capability_adapter_request ?? payload.adapter_request);
  const adapterResult = readRecord(payload.capability_adapter_result ?? payload.adapter_result);
  if (!plan || !result || !ledger || !adapterRequest || !adapterResult) return false;
  if (readBoolean(ledger.ok) !== true) return false;
  const resultStatus = readString(result.status);
  if (resultStatus !== "succeeded" && resultStatus !== "not_run") return false;
  if (isCapabilityTerminalKind(terminalArtifactKind)) {
    if (readBoolean(result.selected_for_answer) !== true) return false;
    const reentryStage = readArray(ledger.stages)
      .map(readRecord)
      .find((stage) => readString(stage?.stage) === "reentered_solver");
    if (ledger.runtime_lifecycle_verified === true) {
      if (readString(reentryStage?.status) !== "succeeded") return false;
    } else if (readBoolean(result.reentered_solver) !== true) {
      return false;
    }
  }
  return true;
};

const hasAdmittedCapabilityWithoutDispatch = (payload: RecordLike): boolean => {
  const ledger = readRecord(payload.capability_lifecycle_ledger);
  return readStringArray(ledger?.failure_codes).includes("capability_admitted_not_dispatched");
};

export function buildTurnIdIntegrityAudit(input: {
  turnId: string;
  backendTurnId?: string | null;
  clientTurnId?: string | null;
  payload: RecordLike;
}): HelixTurnIdIntegrityAudit {
  const violations: HelixTurnIdIntegrityAudit["violations"] = [];
  const checkedRefs: string[] = [];

  const check = (code: HelixTurnIdIntegrityViolationCode, ref: string, observed: unknown): void => {
    const observedTurnId = readString(observed);
    if (!observedTurnId) return;
    checkedRefs.push(ref);
    if (observedTurnId !== input.turnId) {
      violations.push({ code, ref, observed_turn_id: observedTurnId, expected_turn_id: input.turnId });
    }
  };

  check("canonical_goal_turn_mismatch", "canonical_goal_frame.turn_id", readRecord(input.payload.canonical_goal_frame)?.turn_id);
  check("solver_trace_turn_mismatch", "ask_turn_solver_trace.turn_id", readRecord(input.payload.ask_turn_solver_trace)?.turn_id);
  check("solver_trace_turn_mismatch", "loop_parity_trace.turn_id", readRecord(input.payload.loop_parity_trace)?.turn_id);
  check("terminal_authority_turn_mismatch", "terminal_answer_authority.turn_id", readRecord(input.payload.terminal_answer_authority)?.turn_id);

  for (const [index, entry] of readArray(input.payload.current_turn_artifact_ledger).entries()) {
    const record = readRecord(entry);
    if (!record) continue;
    const sourceScope = readString(record.source_scope);
    if (sourceScope === "prior_context" || sourceScope === "prior_turn_context" || sourceScope === "prior_artifact") continue;
    check("artifact_ledger_turn_mismatch", `current_turn_artifact_ledger[${index}].turn_id`, record.turn_id);
  }

  for (const [index, entry] of readArray(input.payload.turn_events ?? input.payload.current_turn_events).entries()) {
    const record = readRecord(entry);
    if (!record) continue;
    check("event_turn_mismatch", `current_turn_events[${index}].turn_id`, record.turn_id);
  }

  const backendTurnId = readString(input.backendTurnId);
  if (backendTurnId && backendTurnId !== input.turnId) {
    violations.push({
      code: "client_backend_turn_unmapped",
      ref: "backend_turn_id",
      observed_turn_id: backendTurnId,
      expected_turn_id: input.turnId,
    });
  }

  return {
    schema: "helix.turn_id_integrity_audit.v1",
    turn_id: input.turnId,
    backend_turn_id: backendTurnId,
    client_turn_id: readString(input.clientTurnId),
    ok: violations.length === 0,
    violations,
    checked_refs: checkedRefs,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function buildFinalRouteReconciliation(input: {
  turnId: string;
  finalRoute?: string | null;
  payload: RecordLike;
}): HelixFinalRouteReconciliation {
  const finalRoute = readString(input.finalRoute) ?? readString(input.payload.route_reason_code) ?? readString(input.payload.route);
  const finalRouteBase = normalizeHelixRouteBase(finalRoute);
  const terminalAuthority = readRecord(input.payload.terminal_answer_authority);
  const terminalAuthorityRoute = readString(terminalAuthority?.route);
  const terminalAuthorityRouteBase = normalizeHelixRouteBase(terminalAuthorityRoute);
  const terminalArtifactKind = readString(input.payload.terminal_artifact_kind) ?? readString(terminalAuthority?.terminal_artifact_kind);
  const nonAnswerTerminal =
    terminalArtifactKind === "typed_failure" ||
    terminalArtifactKind === "request_user_input" ||
    readString(input.payload.final_answer_source) === "typed_failure" ||
    readString(input.payload.final_answer_source) === "request_user_input";
  const canonicalGoal = readRecord(input.payload.canonical_goal_frame);
  const canonicalGoalKind = readString(canonicalGoal?.goal_kind);
  const requiredTerminalKind = readString(canonicalGoal?.required_terminal_kind);
  const canonicalTerminal =
    Boolean(canonicalGoalKind && requiredTerminalKind && finalRouteBase === canonicalGoalKind && terminalArtifactKind === requiredTerminalKind);
  const routeAuthority = readRecord(input.payload.route_authority_audit);
  const terminalGuard = readRecord(input.payload.terminal_artifact_selection_guard);
  const productGuard = readRecord(input.payload.product_authority_guard);
  const routeMismatch = Boolean(
    !nonAnswerTerminal &&
    finalRouteBase &&
    terminalAuthorityRouteBase &&
    finalRouteBase !== terminalAuthorityRouteBase
  );
  const routeProductRejected =
    !nonAnswerTerminal &&
    !canonicalTerminal &&
    (readBoolean(terminalGuard?.allowed) === false ||
      readBoolean(productGuard?.allowed) === false);

  const violations: HelixFinalRouteReconciliation["violations"] = [];
  if (routeMismatch) {
    violations.push({
      code: "terminal_authority_route_stale",
      summary: `Terminal authority route ${terminalAuthorityRouteBase} does not match final route ${finalRouteBase}.`,
    });
  }
  if (routeProductRejected) {
    violations.push({
      code: "terminal_artifact_forbidden_by_final_route",
      summary: "Terminal artifact was rejected by the route/product authority chain.",
    });
  }

  return {
    schema: "helix.final_route_reconciliation.v1",
    turn_id: input.turnId,
    ok: violations.length === 0,
    final_route: finalRoute,
    final_route_base: finalRouteBase,
    terminal_authority_route: terminalAuthorityRoute,
    terminal_authority_route_base: terminalAuthorityRouteBase,
    selected_terminal_artifact_kind: terminalArtifactKind,
    route_difference_changes_terminal_products: routeMismatch && routeProductRejected,
    violations,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function buildSolverControllerDecision(input: {
  turnId: string;
  finalRoute?: string | null;
  payload: RecordLike;
  turnIdIntegrityAudit?: HelixTurnIdIntegrityAudit | null;
  finalRouteReconciliation?: HelixFinalRouteReconciliation | null;
}): HelixSolverControllerDecision {
  const payload = input.payload;
  const nonAnswerTerminal = isNonAnswerTerminal(payload);
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const solverTrace = readRecord(payload.ask_turn_solver_trace);
  const evidenceReentryGate = readRecord(solverTrace?.evidence_reentry_gate);
  const committedRoute = readCommittedAskRoute(payload) ?? readCommittedAskRoute(solverTrace);
  const retrievalResult = readRecord(payload.procedure_evidence_retrieval_result ?? solverTrace?.procedure_evidence_retrieval_result);
  const routeAuthority = readRecord(payload.route_authority_audit);
  const poisonAudit = readRecord(payload.poison_audit);
  const goalSatisfaction = readRecord(payload.goal_satisfaction_evaluation);
  const terminalContract = readRecord(goalSatisfaction?.terminal_contract);
  const terminalEquivalence = readRecord(payload.terminal_equivalence_harness_result);
  const liveSourceIdentity = readRecord(payload.live_source_identity_audit ?? solverTrace?.live_source_identity_audit);
  const authoritativeWorkstationTerminal = resolveAuthoritativeWorkstationToolTerminal(payload);
  const authoritativeCapabilityHelpTerminal = resolveAuthoritativeCapabilityHelpTerminal(payload);
  const authoritativeTheoryContextReflectionTerminal = resolveAuthoritativeTheoryContextReflectionTerminal(payload);
  const authoritativeDocumentLocationTerminal = resolveAuthoritativeDocumentLocationTerminal(payload);
  if (authoritativeWorkstationTerminal) {
    payload.terminal_artifact_kind = authoritativeWorkstationTerminal.terminalArtifactKind;
    payload.final_answer_source = authoritativeWorkstationTerminal.finalAnswerSource;
  } else if (authoritativeCapabilityHelpTerminal) {
    payload.terminal_artifact_kind = authoritativeCapabilityHelpTerminal.terminalArtifactKind;
    payload.final_answer_source = authoritativeCapabilityHelpTerminal.finalAnswerSource;
  } else if (authoritativeTheoryContextReflectionTerminal) {
    payload.terminal_artifact_kind = authoritativeTheoryContextReflectionTerminal.terminalArtifactKind;
    payload.final_answer_source = authoritativeTheoryContextReflectionTerminal.finalAnswerSource;
  } else if (authoritativeDocumentLocationTerminal) {
    payload.terminal_artifact_kind = authoritativeDocumentLocationTerminal.terminalArtifactKind;
    payload.final_answer_source = authoritativeDocumentLocationTerminal.finalAnswerSource;
  }
  const terminalArtifactKind =
    authoritativeWorkstationTerminal?.terminalArtifactKind ??
    authoritativeCapabilityHelpTerminal?.terminalArtifactKind ??
    authoritativeTheoryContextReflectionTerminal?.terminalArtifactKind ??
    authoritativeDocumentLocationTerminal?.terminalArtifactKind ??
    readString(payload.terminal_artifact_kind);
  const rawRequiredTerminalKind =
    authoritativeWorkstationTerminal?.terminalArtifactKind ??
    authoritativeCapabilityHelpTerminal?.terminalArtifactKind ??
    authoritativeTheoryContextReflectionTerminal?.terminalArtifactKind ??
    authoritativeDocumentLocationTerminal?.terminalArtifactKind ??
    committedRoute?.canonical_goal.required_terminal_kind ??
    readString(canonicalGoal?.required_terminal_kind);
  const requiredTerminalKindsFromContract = readStringArray(terminalContract?.required_terminal_kinds);
  const rawRequiredTerminalKinds =
    authoritativeWorkstationTerminal ||
    authoritativeCapabilityHelpTerminal ||
    authoritativeTheoryContextReflectionTerminal ||
    authoritativeDocumentLocationTerminal
      ? [
          authoritativeWorkstationTerminal?.terminalArtifactKind ??
          authoritativeCapabilityHelpTerminal?.terminalArtifactKind ??
          authoritativeTheoryContextReflectionTerminal?.terminalArtifactKind ??
          authoritativeDocumentLocationTerminal!.terminalArtifactKind,
        ]
      : committedRoute?.canonical_goal.allowed_terminal_artifact_kinds.length
      ? committedRoute.canonical_goal.allowed_terminal_artifact_kinds
      : requiredTerminalKindsFromContract.length > 0
      ? requiredTerminalKindsFromContract
      : rawRequiredTerminalKind
        ? [rawRequiredTerminalKind]
        : [];
  const compoundTerminalPolicy = applyCompoundTerminalPolicy(payload, {
    allowed: rawRequiredTerminalKinds,
    forbidden:
      committedRoute?.canonical_goal.forbidden_terminal_artifact_kinds ??
      readStringArray(terminalContract?.forbidden_terminal_kinds),
    requiredTerminalKind: rawRequiredTerminalKind,
  });
  const requiredTerminalKind = compoundTerminalPolicy.requiredTerminalKind;
  const requiredTerminalKinds = compoundTerminalPolicy.allowed.length > 0
    ? compoundTerminalPolicy.allowed
    : rawRequiredTerminalKinds;
  const allowedTerminalKinds = Array.from(new Set([
    ...requiredTerminalKinds,
    ...readStringArray(terminalContract?.acceptable_fallbacks),
  ].map(normalizeCommittedRouteTerminalKind)));
  const forbiddenTerminalKinds = compoundTerminalPolicy.forbidden
    .map(normalizeCommittedRouteTerminalKind)
    .filter((kind) => !authoritativeWorkstationTerminal || kind !== authoritativeWorkstationTerminal.terminalArtifactKind);
  const goalSatisfactionState = readString(goalSatisfaction?.satisfaction);
  const goalNextDecision = readString(goalSatisfaction?.next_decision);
  const terminalContractGoalKind = readString(terminalContract?.goal_kind);
  const finalRoute = readString(input.finalRoute) ?? readString(payload.route_reason_code) ?? readString(payload.route);
  const finalRouteBase = normalizeHelixRouteBase(finalRoute);
  const canonicalGoalKind =
    authoritativeWorkstationTerminal
      ? readString(canonicalGoal?.goal_kind) ?? committedRoute?.canonical_goal.goal_kind
      : committedRoute?.canonical_goal.goal_kind ??
        readString(canonicalGoal?.goal_kind);
  const stagePlayCheckpointReceiptTerminal =
    canonicalGoalKind === "live_environment_review" &&
    terminalArtifactKind === "tool_receipt" &&
    readString(payload.final_answer_source) === "deterministic_receipt_fallback" &&
    readArray(payload.current_turn_artifact_ledger).some((artifact) => {
      const artifactRecord = readRecord(artifact);
      const payloadRecord = readRecord(artifactRecord?.payload);
      return (
        readString(artifactRecord?.kind) === "live_environment_tool_observation" &&
        readString(payloadRecord?.tool_name) === "live_env.request_stage_play_checkpoint"
      );
    });
  const liveMaintenanceTerminal =
    (
      Boolean(
        (canonicalGoalKind && /^live_(?:source_continuation|pipeline_control|runtime_repair|environment_binding_diagnosis)$/.test(canonicalGoalKind)) ||
          (finalRouteBase && /^live_(?:source_continuation|pipeline_control|runtime_repair|environment_binding_diagnosis)$/.test(finalRouteBase)),
      ) &&
      ["live_pipeline_receipt", "live_environment_binding_diagnosis"].includes(terminalArtifactKind ?? "")
    ) ||
    stagePlayCheckpointReceiptTerminal;
  const noteMutationTerminal =
    canonicalGoalKind === "note_mutation" &&
    goalSatisfactionState === "satisfied" &&
    goalNextDecision === "allow_terminal" &&
    terminalArtifactKind === "note_update_receipt" &&
    readBoolean(readRecord(payload.terminal_consistency_check)?.consistent) === true;
  const canonicalTerminal =
    noteMutationTerminal ||
    Boolean(canonicalGoalKind && requiredTerminalKind && finalRouteBase === canonicalGoalKind && terminalArtifactKind === requiredTerminalKind);
  const turnIdIntegrityAudit = input.turnIdIntegrityAudit ?? buildTurnIdIntegrityAudit({ turnId: input.turnId, payload });
  const finalRouteReconciliation = authoritativeWorkstationTerminal
    ? buildFinalRouteReconciliation({ turnId: input.turnId, finalRoute, payload })
    : input.finalRouteReconciliation ?? buildFinalRouteReconciliation({ turnId: input.turnId, finalRoute, payload });
  const disciplineGuardRequired = isSourceTargetedOrCapabilityTurn(payload);
  const capabilityTerminal = isCapabilityTerminalKind(terminalArtifactKind);
  const hasModelOnlyDirectAnswerEvidence =
    hasSatisfiedRequiredEvidenceKind(goalSatisfaction, "direct_answer_text") ||
    hasCurrentTurnArtifactKind(payload, "direct_answer_text") ||
    Boolean(readString(readRecord(payload.final_answer_draft)?.text));
  const modelOnlyDirectAnswerContractSatisfied =
    (
      canonicalGoalKind === "model_only_concept" ||
      canonicalGoalKind === "workspace_help" ||
      canonicalGoalKind === "conversation"
    ) &&
    goalSatisfactionState === "satisfied" &&
    goalNextDecision === "allow_terminal" &&
    (
      requiredTerminalKind === "direct_answer_text" ||
      requiredTerminalKinds.includes("direct_answer_text")
    ) &&
    hasModelOnlyDirectAnswerEvidence &&
    (
      terminalArtifactKind === "direct_answer_text" ||
      terminalArtifactKind === "model_synthesized_answer" ||
      terminalArtifactKind === "final_answer_draft"
    );
  const modelDirectAnswerTerminal =
    modelOnlyDirectAnswerContractSatisfied ||
    (
      terminalArtifactKind === "direct_answer_text" &&
      readString(payload.final_answer_source) === "model_direct_answer" &&
      (
        canonicalGoalKind === "model_only_concept" ||
        canonicalGoalKind === "workspace_help" ||
        canonicalGoalKind === "conversation" ||
        canonicalGoalKind === "live_environment_review"
      )
    );
  const interimVoiceCalloutStatusTerminal =
    canonicalGoalKind === "live_environment_review" &&
    terminalArtifactKind === "model_synthesized_answer" &&
    readString(payload.final_answer_source) === "final_answer_draft" &&
    readBoolean(readRecord(payload.terminal_consistency_check)?.consistent) === true &&
    hasFinalInterimVoiceCalloutReceipt(payload);
  const liveSourceSetupReceiptTerminal =
    canonicalGoalKind === "live_environment_review" &&
    terminalArtifactKind === "model_synthesized_answer" &&
    goalSatisfactionState === "satisfied" &&
    goalNextDecision === "allow_terminal" &&
    readString(payload.final_answer_source) === "final_answer_draft" &&
    hasLiveSourceSetupReceipt(payload);
  const capabilityGuardRequired =
    !modelDirectAnswerTerminal &&
    !liveSourceSetupReceiptTerminal &&
    (
      capabilityTerminal ||
      Boolean(
        readRecord(payload.capability_plan) ||
          readRecord(payload.capability_result) ||
          readRecord(payload.capability_lifecycle_ledger),
      )
    );
  const runtimeBoundary = evaluateTerminalBoundaryEligibility(payload);
  const capabilityBindingMismatchObservation =
    readRecord(payload.capability_binding_mismatch_observation) ??
    buildCapabilityBindingMismatchObservation(payload);
  const modelOnlyAnswerCoverageSupersedesCompoundGate = hasModelOnlyCompoundAnswerCoverage(payload);
  const scholarlyAnswerCoverageSupersedesCompoundGate =
    hasMaterializedScholarlyResearchAnswer(payload, terminalArtifactKind);
  const evidenceReentryRequiredIncomplete =
    readBoolean(evidenceReentryGate?.required) === true &&
    readBoolean(evidenceReentryGate?.completed) === false;

  const blockingReasons: HelixSolverControllerBlockingReason[] = [];
  const liveSourcePhaseBlockingReasons: HelixSolverControllerBlockingReason[] = [];
  const consumedRefs: string[] = [
    "canonical_goal_frame",
    "terminal_answer_authority",
    "route_authority_audit",
    "poison_audit",
    "ask_turn_solver_trace",
    "turn_id_integrity_audit",
    "final_route_reconciliation",
    "goal_satisfaction_evaluation",
    "prompt_requirement_coverage",
    "compound_prompt_coverage_gate",
    "terminal_equivalence_harness_result",
    "capability_plan",
    "capability_result",
    "capability_lifecycle_ledger",
    "capability_adapter_request",
    "capability_adapter_result",
    "live_source_turn_phase_resolution",
    ...(committedRoute ? ["committed_ask_route"] : []),
  ];
  const routeProductContractPresent =
    Boolean(committedRoute) ||
    Boolean(
      readString(canonicalGoal?.goal_kind) &&
        (
          readString(canonicalGoal?.required_terminal_kind) ||
          readStringArray(canonicalGoal?.allowed_terminal_artifact_kinds).length > 0
        )
    ) ||
    hasRequiredArtifactContract(terminalContract);

  if (liveSourcePhaseRequiresMailDecision(payload)) {
    pushUnique(liveSourcePhaseBlockingReasons, "missing_required_live_source_mail_decision");
  }
  if (liveSourcePhaseRequiresVoiceReceiptOrHold(payload)) {
    pushUnique(liveSourcePhaseBlockingReasons, "missing_required_voice_receipt_or_hold");
  }
  if (liveSourcePhaseBlockingReasons.length === 0 && terminalForbiddenByLiveSourcePhaseLock(payload)) {
    pushUnique(liveSourcePhaseBlockingReasons, "terminal_forbidden_by_phase_lock");
  }
  if (receiptTerminalNotEligible(payload)) {
    pushUnique(liveSourcePhaseBlockingReasons, "receipt_not_terminal_eligible");
  }
  for (const reason of terminalWriterRejectedReasons(payload)) {
    pushUnique(liveSourcePhaseBlockingReasons, reason);
  }

  if (!nonAnswerTerminal) {
    if (!committedRoute && disciplineGuardRequired && !routeProductContractPresent) {
      pushUnique(blockingReasons, "committed_route_missing");
    }
    if (
      !authoritativeWorkstationTerminal &&
      committedRoute?.compatibility.violations.some((violation) => /goal|terminal|capability|source/i.test(violation))
    ) {
      pushUnique(blockingReasons, "committed_route_incompatible_goal");
    }
    const committedRouteAllowsTerminal = committedRoute
      ? authoritativeWorkstationTerminal
        ? true
        : authoritativeDocumentLocationTerminal
          ? true
        : compoundTerminalPolicy.policy.active
          ? Boolean(
              terminalArtifactKind &&
              !forbiddenTerminalKinds.includes(normalizeCommittedRouteTerminalKind(terminalArtifactKind)) &&
              (
                allowedTerminalKinds.length === 0 ||
                allowedTerminalKinds.includes(normalizeCommittedRouteTerminalKind(terminalArtifactKind))
              ),
            )
          : committedRouteAllowsTerminalKind({
              committedRoute,
              terminalArtifactKind,
              finalAnswerSource: readString(payload.final_answer_source),
            })
      : true;
    if (terminalArtifactKind && committedRoute && !committedRouteAllowsTerminal && !modelDirectAnswerTerminal) {
      pushUnique(blockingReasons, "committed_route_terminal_product_mismatch");
    }
    if (!goalSatisfaction) {
      pushUnique(blockingReasons, "goal_satisfaction_missing");
    } else if (!interimVoiceCalloutStatusTerminal && !liveSourceSetupReceiptTerminal && (goalSatisfactionState !== "satisfied" || goalNextDecision !== "allow_terminal")) {
      pushUnique(blockingReasons, "goal_not_satisfied");
    }
    if (disciplineGuardRequired && !hasRequiredArtifactContract(terminalContract)) {
      pushUnique(blockingReasons, "required_artifact_contract_missing");
    }
    if (
      terminalArtifactKind &&
      allowedTerminalKinds.length > 0 &&
      !allowedTerminalKinds.includes(normalizeCommittedRouteTerminalKind(terminalArtifactKind)) &&
      !modelDirectAnswerTerminal &&
      !(modelOnlyAnswerCoverageSupersedesCompoundGate && terminalArtifactKind === "model_synthesized_answer")
    ) {
      pushUnique(blockingReasons, "terminal_kind_not_required");
    }
    if (terminalArtifactKind && forbiddenTerminalKinds.includes(normalizeCommittedRouteTerminalKind(terminalArtifactKind))) {
      pushUnique(blockingReasons, "terminal_kind_not_required");
    }
    if (!terminalEquivalence && !authoritativeDocumentLocationTerminal) {
      pushUnique(blockingReasons, "terminal_equivalence_missing");
    } else if (
      !authoritativeDocumentLocationTerminal &&
      !interimVoiceCalloutStatusTerminal &&
      !liveSourceSetupReceiptTerminal &&
      readBoolean(terminalEquivalence?.ok) !== true
    ) {
      pushUnique(blockingReasons, "terminal_equivalence_failed");
    }
    if (capabilityGuardRequired && !isCapabilityLifecycleComplete(payload, terminalArtifactKind)) {
      if (hasAdmittedCapabilityWithoutDispatch(payload)) {
        pushUnique(blockingReasons, "capability_admitted_not_dispatched");
      }
      pushUnique(blockingReasons, "capability_lifecycle_incomplete");
    }
    if (disciplineGuardRequired) {
      if (runtimeBoundary.blocking_reasons.includes("agent_runtime_loop_missing")) {
        pushUnique(blockingReasons, "agent_runtime_loop_missing");
      }
      if (runtimeBoundary.blocking_reasons.includes("agent_step_decision_missing")) {
        pushUnique(blockingReasons, "agent_step_decision_missing");
      }
      if (runtimeBoundary.blocking_reasons.includes("selected_capability_observation_missing")) {
        pushUnique(blockingReasons, "selected_capability_observation_missing");
      }
      if (runtimeBoundary.blocking_reasons.includes("post_observation_model_decision_missing")) {
        pushUnique(blockingReasons, "post_observation_model_decision_missing");
      }
    }
    const modelDirectAnswerMissingApplies =
      runtimeBoundary.blocking_reasons.includes("direct_answer_text_missing") &&
      readString(payload.final_answer_source) !== "no_tool_direct" &&
      (
        canonicalGoalKind === "model_only_concept" ||
        canonicalGoalKind === "workspace_help" ||
        canonicalGoalKind === "conversation" ||
        readString(payload.final_answer_source) === "model_direct_answer"
      );
    if (modelDirectAnswerMissingApplies) {
      pushUnique(blockingReasons, "direct_answer_text_missing");
    }
    if (hasIncompletePromptRequirementCoverage(payload)) {
      pushUnique(blockingReasons, "prompt_requirement_coverage_incomplete");
    }
    if (hasIncompleteDocRetrievalCoverage(payload)) {
      pushUnique(blockingReasons, "doc_retrieval_coverage_incomplete");
    }
    if (
      evidenceReentryRequiredIncomplete &&
      terminalArtifactKind !== "typed_failure" &&
      !modelDirectAnswerTerminal &&
      !liveSourceSetupReceiptTerminal &&
      !liveMaintenanceTerminal
    ) {
      pushUnique(blockingReasons, "post_observation_model_decision_missing");
    }
    if (hasIncompleteCompoundPromptCoverageGate(payload)) {
      if (modelOnlyAnswerCoverageSupersedesCompoundGate || scholarlyAnswerCoverageSupersedesCompoundGate) {
        payload.compound_prompt_coverage_gate_superseded_by_answer_artifact = true;
        payload.compound_prompt_coverage_superseded_ref =
          scholarlyAnswerCoverageSupersedesCompoundGate
            ? readString(payload.terminal_artifact_id) ?? readString(readRecord(payload.scholarly_research_answer)?.artifact_id)
            : readString(readRecord(payload.model_only_compound_coverage_from_answer)?.candidate_ref);
      } else {
      pushUnique(blockingReasons, "compound_prompt_coverage_incomplete");
      }
    }
  }

  if (!turnIdIntegrityAudit.ok) pushUnique(blockingReasons, "turn_id_integrity_failed");
  if (
    !finalRouteReconciliation.ok &&
    !authoritativeWorkstationTerminal &&
    !noteMutationTerminal &&
    !modelDirectAnswerTerminal &&
    !liveSourceSetupReceiptTerminal
  ) {
    pushUnique(blockingReasons, "terminal_route_mismatch");
    if (finalRouteReconciliation.violations.some((entry) => entry.code === "terminal_artifact_forbidden_by_final_route")) {
      pushUnique(blockingReasons, "route_product_contract_rejected_terminal");
    }
  }
  const poisonViolations = readArray(poisonAudit?.violations).map((entry) => readString(readRecord(entry)?.kind)).filter(Boolean);
  const poisonFailed = readBoolean(poisonAudit?.ok) === false;
  const staleRouteOnlyPoisonFailure =
    canonicalTerminal &&
    poisonViolations.length > 0 &&
    poisonViolations.every((kind) => kind === "terminal_artifact_forbidden_by_route_contract");
  if (!nonAnswerTerminal && readBoolean(poisonAudit?.ok) !== true && !staleRouteOnlyPoisonFailure && !noteMutationTerminal && !liveMaintenanceTerminal && !modelDirectAnswerTerminal && !liveSourceSetupReceiptTerminal) pushUnique(blockingReasons, "poison_audit_failed");
  if (poisonFailed && !staleRouteOnlyPoisonFailure && !noteMutationTerminal && !liveMaintenanceTerminal && !modelDirectAnswerTerminal && !liveSourceSetupReceiptTerminal) pushUnique(blockingReasons, "poison_audit_failed");
  if (!nonAnswerTerminal && readBoolean(routeAuthority?.route_authority_ok) !== true && !noteMutationTerminal && !liveMaintenanceTerminal && !modelDirectAnswerTerminal && !liveSourceSetupReceiptTerminal) {
    pushUnique(blockingReasons, "route_authority_failed");
  }
  if (
    readBoolean(routeAuthority?.route_authority_ok) === false &&
    !noteMutationTerminal &&
    !liveMaintenanceTerminal &&
    !modelDirectAnswerTerminal &&
    !liveSourceSetupReceiptTerminal &&
    (
      (poisonFailed && !staleRouteOnlyPoisonFailure) ||
      readString(routeAuthority?.primary_violation_code) === "terminal_artifact_forbidden_by_route_contract" ||
      readString(routeAuthority?.route_authority_violation_code) === "terminal_artifact_forbidden_by_route_contract"
    ) &&
    !canonicalTerminal
  ) {
    pushUnique(blockingReasons, "route_authority_failed");
  }
  if (readString(retrievalResult?.answerability) === "not_answerable") pushUnique(blockingReasons, "retrieval_not_answerable");
  if (hasPromptObjectExtractionProblem(payload)) pushUnique(blockingReasons, "prompt_object_extraction_invalid");

  const solverFinalArbitration = readRecord(solverTrace?.final_arbitration);
  const allSubgoalsObservedOnly =
    readString(solverFinalArbitration?.why_complete) === "all_subgoals_observed" ||
    readString(solverFinalArbitration?.reason) === "all_subgoals_observed" ||
    readArray(payload.current_turn_events ?? payload.turn_events).some((event) => {
      const eventRecord = readRecord(event);
      const decision = readRecord(eventRecord?.decision);
      return readString(decision?.reason) === "all_subgoals_observed";
    });
  if (!nonAnswerTerminal && allSubgoalsObservedOnly && goalSatisfactionState !== "satisfied") {
    pushUnique(blockingReasons, "subgoals_observed_not_satisfied");
  }

  const sourceTarget = readRecord(payload.source_target_intent);
  const sourceTargetName =
    committedRoute?.route.source_target ??
    readString(sourceTarget?.target_source);
  const promptText = readString(payload.active_prompt) ?? readString(payload.prompt) ?? readString(payload.question) ?? "";
  const visualContentPrompt =
    /\b(?:describe|review|analy[sz]e|what\s+(?:do\s+you\s+)?see|what(?:'s|\s+is)\s+(?:happening|on|visible))\b[\s\S]{0,140}\b(?:live|screen|visual|display)\s+(?:capture|source|frame|screen)\b/i.test(promptText) ||
    /\b(?:live|screen|visual|display)\s+(?:capture|source|frame|screen)\b[\s\S]{0,140}\b(?:describe|review|analy[sz]e|see|happening|visible)\b/i.test(promptText);
  const controlReceiptTerminal =
    terminalArtifactKind === "live_pipeline_receipt" ||
    terminalArtifactKind === "visual_producer_cadence_receipt" ||
    terminalArtifactKind === "live_answer_environment_receipt" ||
    (terminalArtifactKind === "workspace_action_receipt" &&
      /\b(?:set_rate|live-source\.set_rate|interval|cadence|rate)\b/i.test(promptText));
  if (!nonAnswerTerminal && visualContentPrompt && terminalContractGoalKind !== "live_interval_set" && controlReceiptTerminal) {
    pushUnique(blockingReasons, "terminal_kind_not_required");
    pushUnique(blockingReasons, "visual_evidence_missing");
  }
  if (
    !nonAnswerTerminal &&
    !liveMaintenanceTerminal &&
    (sourceTargetName === "live_pipeline" || sourceTargetName === "visual_capture") &&
    (
      terminalArtifactKind === "direct_answer_text" ||
      terminalArtifactKind === "no_tool_direct" ||
      terminalArtifactKind === "model_only_concept" ||
      readString(payload.final_answer_source) === "no_tool_direct"
    )
  ) {
    pushUnique(blockingReasons, sourceTargetName === "visual_capture" ? "visual_evidence_missing" : "route_product_contract_rejected_terminal");
  }
  const activeSituationContext = readRecord(payload.active_situation_context);
  const situationEvidenceSelection = readRecord(payload.situation_evidence_selection);
  const deicticReference = readRecord(payload.deictic_reference);
  const visualSourceRequired =
    sourceTargetName === "visual_capture" ||
    readString(deicticReference?.reference_type) === "current_screen" ||
    readString(deicticReference?.reference_type) === "selected_visible_file" ||
    /\b(?:live\s+capture|screen\s*capture|visual\s*capture|screenshot|visual|visible)\b/i.test(
      promptText,
    );
  if (
    !nonAnswerTerminal &&
    visualSourceRequired &&
    (
      terminalArtifactKind === "direct_answer_text" ||
      terminalArtifactKind === "no_tool_direct" ||
      terminalArtifactKind === "model_only_concept" ||
      readString(payload.final_answer_source) === "no_tool_direct"
    )
  ) {
    pushUnique(blockingReasons, "visual_evidence_missing");
  }
  const liveSourceIdentityDiagnosis = readString(liveSourceIdentity?.diagnosis);
  const liveSourceIdentityHardFailure =
    liveSourceIdentity &&
    (
      readBoolean(liveSourceIdentity.environment_binding_ok) === false ||
      readBoolean(liveSourceIdentity.situation_run_binding_ok) === false ||
      liveSourceIdentityDiagnosis === "active_environment_missing" ||
      liveSourceIdentityDiagnosis === "active_environment_source_missing" ||
      liveSourceIdentityDiagnosis === "producer_source_mismatch" ||
      liveSourceIdentityDiagnosis === "fresh_source_unbound" ||
      liveSourceIdentityDiagnosis === "fresh_source_wrong_environment" ||
      liveSourceIdentityDiagnosis === "situation_run_missing" ||
      liveSourceIdentityDiagnosis === "fresh_observation_not_in_situation_run" ||
      liveSourceIdentityDiagnosis === "field_evaluations_missing"
    );
  if (
    visualSourceRequired &&
    !liveMaintenanceTerminal &&
    terminalArtifactKind !== "typed_failure" &&
    (
      liveSourceIdentityHardFailure ||
      readString(activeSituationContext?.status) === "missing" ||
      readBoolean(situationEvidenceSelection?.answerable) === false
    )
  ) {
    pushUnique(blockingReasons, "visual_evidence_missing");
  }

  if (
    !liveSourceSetupReceiptTerminal &&
    readBoolean(solverTrace?.completed_solver_path) === false &&
    [...blockingReasons, ...liveSourcePhaseBlockingReasons].some((reason) =>
      reason === "poison_audit_failed" ||
      reason === "route_authority_failed" ||
      reason === "terminal_route_mismatch" ||
      reason === "route_product_contract_rejected_terminal" ||
      reason === "retrieval_not_answerable" ||
      reason === "turn_id_integrity_failed" ||
      reason === "visual_evidence_missing" ||
      reason === "prompt_object_extraction_invalid" ||
      reason === "goal_satisfaction_missing" ||
      reason === "goal_not_satisfied" ||
      reason === "required_artifact_contract_missing" ||
      reason === "terminal_kind_not_required" ||
      reason === "terminal_equivalence_missing" ||
      reason === "terminal_equivalence_failed" ||
      reason === "capability_admitted_not_dispatched" ||
      reason === "capability_lifecycle_incomplete" ||
      reason === "agent_runtime_loop_missing" ||
      reason === "agent_step_decision_missing" ||
      reason === "selected_capability_observation_missing" ||
      reason === "post_observation_model_decision_missing" ||
      reason === "stale_model_only_after_observation" ||
      reason === "composer_claimed_no_observations_but_receipts_exist" ||
      reason === "missing_required_live_source_mail_decision" ||
      reason === "missing_required_voice_receipt_or_hold" ||
      reason === "receipt_not_terminal_eligible" ||
      reason === "terminal_forbidden_by_phase_lock" ||
      reason === "direct_answer_text_missing" ||
      reason === "subgoals_observed_not_satisfied" ||
      reason === "prompt_requirement_coverage_incomplete" ||
      reason === "doc_retrieval_coverage_incomplete" ||
      reason === "compound_prompt_coverage_incomplete"
    )
  ) {
    pushUnique(blockingReasons, "solver_path_incomplete");
  }

  const effectiveBlockingReasons = nonAnswerTerminal
    ? liveSourcePhaseBlockingReasons
    : [...blockingReasons, ...liveSourcePhaseBlockingReasons];
  const bindingMismatchRepairable =
    Boolean(capabilityBindingMismatchObservation) &&
    effectiveBlockingReasons.includes("selected_capability_observation_missing") &&
    effectiveBlockingReasons.every((reason) =>
      reason === "selected_capability_observation_missing" ||
      reason === "post_observation_model_decision_missing" ||
      reason === "capability_admitted_not_dispatched" ||
      reason === "capability_lifecycle_incomplete" ||
      reason === "solver_path_incomplete",
    );
  const proceduralTerminalBlocked = effectiveBlockingReasons.some((reason) =>
    reason === "missing_required_live_source_mail_decision" ||
    reason === "missing_required_voice_receipt_or_hold" ||
    reason === "terminal_forbidden_by_phase_lock" ||
    reason === "stale_model_only_after_observation" ||
    reason === "composer_claimed_no_observations_but_receipts_exist" ||
    reason === "receipt_not_terminal_eligible",
  );
  const goalBlocked = effectiveBlockingReasons.some((reason) =>
    reason === "goal_satisfaction_missing" ||
    reason === "goal_not_satisfied" ||
    reason === "required_artifact_contract_missing" ||
    reason === "terminal_kind_not_required" ||
    reason === "direct_answer_text_missing" ||
    reason === "subgoals_observed_not_satisfied" ||
    reason === "prompt_requirement_coverage_incomplete" ||
    reason === "doc_retrieval_coverage_incomplete" ||
    reason === "compound_prompt_coverage_incomplete"
  );
  const requestedGoalDecision =
    goalNextDecision === "continue" ||
    goalNextDecision === "retry" ||
    goalNextDecision === "request_user_input"
      ? goalNextDecision
      : null;
  const controllerDecision =
    effectiveBlockingReasons.length === 0
      ? "allow_terminal"
      : proceduralTerminalBlocked
        ? "continue"
      : bindingMismatchRepairable
        ? "retry"
      : requestedGoalDecision
        ? requestedGoalDecision
        : goalBlocked
          ? "typed_failure"
          : "fail_closed";
  const typedFailureCode =
    effectiveBlockingReasons.includes("visual_evidence_missing")
      ? liveSourceIdentityDiagnosis ??
        (readString(activeSituationContext?.status) === "missing" ? "active_environment_missing" : undefined) ??
        "visual_evidence_missing"
      : effectiveBlockingReasons[0] ?? undefined;

  return {
    schema: "helix.solver_controller_decision.v1",
    turn_id: input.turnId,
    final_route: finalRoute,
    canonical_goal_kind: canonicalGoalKind,
    required_terminal_kind: requiredTerminalKind,
    selected_terminal_artifact_kind: terminalArtifactKind,
    decision: controllerDecision,
    blocking_reasons: effectiveBlockingReasons,
    consumed_artifact_refs: capabilityBindingMismatchObservation
      ? [...consumedRefs, "capability_binding_mismatch_observation"]
      : consumedRefs,
    superseded_blocking_reasons: modelOnlyAnswerCoverageSupersedesCompoundGate || scholarlyAnswerCoverageSupersedesCompoundGate
      ? ["compound_prompt_coverage_incomplete"]
      : undefined,
    compound_prompt_coverage_gate_superseded_by_answer_artifact:
      modelOnlyAnswerCoverageSupersedesCompoundGate || scholarlyAnswerCoverageSupersedesCompoundGate || undefined,
    compound_prompt_coverage_superseded_ref: scholarlyAnswerCoverageSupersedesCompoundGate
      ? readString(payload.terminal_artifact_id) ?? readString(readRecord(payload.scholarly_research_answer)?.artifact_id)
      : modelOnlyAnswerCoverageSupersedesCompoundGate
        ? readString(readRecord(payload.model_only_compound_coverage_from_answer)?.candidate_ref)
      : undefined,
    retry_policy_ref: capabilityBindingMismatchObservation ? "capability_binding_mismatch_observation" : undefined,
    typed_failure_code: typedFailureCode,
    assistant_answer: false,
    raw_content_included: false,
  };
}
