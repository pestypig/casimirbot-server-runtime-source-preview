import crypto from "node:crypto";
import type { HelixLoopParityTrace } from "./loop-parity-trace";
import type { HelixCapabilityPlan } from "@shared/helix-capability-plan";
import type { HelixCapabilityResult } from "@shared/helix-capability-result";
import type { HelixCapabilityLifecycleLedger } from "@shared/helix-capability-lifecycle-ledger";
import type { HelixProcedureEvidenceRetrievalPlan } from "@shared/helix-procedure-evidence-retrieval-plan";
import type { HelixProcedureEvidenceRetrievalResult } from "@shared/helix-procedure-evidence-retrieval-result";
import type { HelixSolverInstructionFrame } from "@shared/helix-solver-instruction-frame";
import type { HelixSolverArtifactReentryAudit } from "@shared/helix-solver-artifact-reentry-audit";
import type { HelixSolverSubgoalLedger } from "@shared/helix-solver-subgoal";
import type { HelixSolverRetryPolicy } from "@shared/helix-solver-retry-policy";
import {
  interpretHelixAskPrompt,
  type HelixCompoundPromptContract,
  type HelixPromptInterpretation,
} from "./prompt-interpretation";
import {
  buildHelixIntentHypotheses,
  type HelixIntentHypothesis,
  type HelixIntentKind,
  type HelixRouteCandidateForIntent,
} from "./intent-hypothesis";
import {
  arbitrateHelixIntent,
  type HelixIntentArbitration,
} from "./intent-arbitration";
import {
  buildEvidenceReentryGate,
  type HelixEvidenceReentryGate,
} from "./evidence-reentry-gate";
import {
  buildFollowupReasoningGate,
  type HelixFollowupReasoningGate,
} from "./followup-reasoning-gate";
import type { HelixLiveSourceIdentityAudit } from "./live-source-identity-audit";
import type { HelixCompoundPromptCoverageGate } from "./compound-prompt-coverage-gate";
import {
  detectRepoConcept,
  type RepoConceptDetection,
} from "./repo-concept-detector";
import {
  buildToolUseRestatement,
  type ToolUseRestatementV1,
} from "./internet-search-intent";
import { contextualToolSuppressionBlocksFamily } from "./contextual-tool-admission";
import type {
  HelixCommittedAskRoute,
  HelixRouteEvidenceAuthority,
} from "@shared/helix-committed-ask-route";
import { helixTerminalKindIsSelfTerminal } from "@shared/helix-terminal-authority";
import {
  buildRouteEvidenceAuthority,
  buildCommittedAskRoute,
  committedRouteAllowsTerminalKind,
  evaluateCommittedAskRouteCompatibility,
  readCommittedAskRoute,
} from "./committed-ask-route";
import { applyCompoundTerminalPolicy } from "./compound-terminal-policy";
import {
  appendHelixRuntimeIntentPacketToPayload,
  type HelixTurnArtifact,
} from "./runtime/runtime-intent-packet";
import { resolvePublishedWorkstationToolTerminal } from "./terminal-identity-precedence";
import { providerPostObservationCompletionMaterialized } from "./provider-terminal-completion";
import { providerBridgeAllEvidenceReentryCompatible } from "./provider-evidence-reentry-compatibility";
import { readVerifiedHelixRuntimeLifecycleFromPayload } from "./runtime/turn-lifecycle";
import { authoritativeTypedFailureRequiresNoContinuation } from "./runtime/typed-failure-lifecycle-reconciliation";

type RecordLike = Record<string, unknown>;

export type HelixAskTurnIntentKind = HelixIntentKind;

export type HelixAskTurnSolverRiskFlag =
  | "classifier_became_decision"
  | "route_selected_before_intent_arbitration"
  | "receipt_terminal_without_reentry"
  | "tool_result_terminal_without_reasoning"
  | "blocked_contextual_tool_executed"
  | "negative_constraint_ignored"
  | "primary_secondary_intent_collapsed"
  | "missing_followup_reasoning"
  | "terminal_authority_before_solver_completion";

export type HelixAskTurnSolverHardFailureCode =
  | "solver_trace_missing"
  | "intent_arbitration_missing"
  | "classifier_became_decision"
  | "route_selected_before_intent_arbitration"
  | "blocked_contextual_tool_executed"
  | "receipt_terminal_without_reentry"
  | "missing_followup_reasoning"
  | "terminal_authority_before_solver_completion"
  | "solver_path_incomplete_before_terminal"
  | "poison_clean_but_authority_failed"
  | "route_contract_missing"
  | "hard_source_target_allowed_no_tool_direct"
  | "repo_evidence_required_before_answer"
  | "compound_prompt_coverage_incomplete";

export type HelixAskTurnSolverHardGate = {
  schema: "helix.ask_turn_solver_hard_gate.v1";
  turn_id: string;
  applies: boolean;
  failed: boolean;
  failure_codes: HelixAskTurnSolverHardFailureCode[];
  primary_failure_code: HelixAskTurnSolverHardFailureCode | null;
  hard_source_target: boolean;
  complex_prompt: boolean;
  pure_control_or_status_receipt_allowed: boolean;
  failure_details: Array<{
    code: HelixAskTurnSolverHardFailureCode;
    reason: string;
  }>;
  assistant_answer: false;
  raw_content_included: false;
};

export type HelixAskTurnSolverTrace = {
  schema: "helix.ask_turn_solver_trace.v1";
  trace_id: string;
  turn_id: string;
  prompt_hash: string;

  prompt_interpretation: HelixPromptInterpretation;
  tool_use_restatement: ToolUseRestatementV1;
  repo_concept_detection?: RepoConceptDetection;
  compound_prompt_contract?: HelixCompoundPromptContract;
  compound_prompt_coverage?: {
    schema: "helix.compound_prompt_coverage.v1";
    required_requirement_ids: string[];
    answered_requirement_ids: string[];
    missing_requirement_ids: string[];
    coverage: "complete" | "partial" | "none" | "not_compound";
    final_answer_must_cover_all: boolean;
    assistant_answer: false;
    raw_content_included: false;
  };
  compound_prompt_coverage_gate?: HelixCompoundPromptCoverageGate;
  committed_ask_route?: HelixCommittedAskRoute;
  route_evidence_authority?: HelixRouteEvidenceAuthority;
  committed_route_compatibility?: {
    schema: "helix.committed_ask_route_compatibility.v1";
    turn_id: string;
    compatible: boolean;
    violations: string[];
    assistant_answer: false;
    raw_content_included: false;
  };
  intent_hypotheses: HelixIntentHypothesis[];
  intent_arbitration: HelixIntentArbitration;
  selected_primary_intent: HelixAskTurnIntentKind | null;
  secondary_intents: HelixAskTurnIntentKind[];

  source_admission_candidates: Array<{
    source_target: string;
    admitted: boolean;
    reason: string;
    evidence_required: boolean;
  }>;

  tool_admission_candidates: Array<{
    tool_family: string;
    tool_id?: string;
    admitted: boolean;
    mutating: boolean;
    reason: string;
  }>;

  contextual_tool_audit: {
    schema: "helix.contextual_tool_audit.v1";
    contextual_tool_mention_present: boolean;
    contextual_tool_family_blocked: boolean;
    blocked_contextual_tool_executed: boolean;
    blocked_families: string[];
    executed_blocked_tool_ids: string[];
    assistant_answer: false;
    raw_content_included: false;
  };

  evidence_requests: Array<{
    request_id: string;
    source_target: string;
    required: boolean;
    purpose: string;
  }>;

  evidence_results: Array<{
    result_id: string;
    source_kind: string;
    selected_for_answer: boolean;
    rejected_reason?: string;
  }>;

  evidence_reentry: {
    required: boolean;
    completed: boolean;
    skipped_reason?: string;
  };
  evidence_reentry_gate: HelixEvidenceReentryGate;

  followup_reasoning: {
    required: boolean;
    completed: boolean;
    skipped_reason?: string;
  };
  followup_reasoning_gate: HelixFollowupReasoningGate;
  runtime_lifecycle_facts?: {
    scope: "codex_native_provider_cycle" | "helix_ask_turn";
    integrity: "verified";
    runtime_turn_completed: boolean;
    observation_reentry_refs: string[];
    post_observation_reasoning_completed: boolean;
    latest_reentry_event_id: string | null;
    final_agent_message_event_id: string | null;
  };
  live_source_identity_audit?: HelixLiveSourceIdentityAudit;
  live_source_identity_audit_ref?: string | null;
  capability_plan?: HelixCapabilityPlan;
  capability_result?: HelixCapabilityResult;
  capability_lifecycle_ledger?: HelixCapabilityLifecycleLedger;
  procedure_evidence_retrieval_plan?: HelixProcedureEvidenceRetrievalPlan;
  procedure_evidence_retrieval_result?: HelixProcedureEvidenceRetrievalResult;
  solver_instruction_frame?: HelixSolverInstructionFrame;
  solver_artifact_reentry_audit?: HelixSolverArtifactReentryAudit;
  solver_subgoal_ledger?: HelixSolverSubgoalLedger;
  solver_retry_policy?: HelixSolverRetryPolicy;
  solver_retry_policies?: HelixSolverRetryPolicy[];

  final_arbitration: {
    selected_route: string;
    terminal_artifact_kind: string;
    final_answer_source: string;
    why_complete: string;
    remaining_uncertainty: string[];
  };

  route_authority_ok: boolean;
  poison_audit_ok: boolean;
  terminal_authority_ok: boolean;
  solver_risk_flags: HelixAskTurnSolverRiskFlag[];

  assistant_answer: false;
  raw_content_included: false;

  completed_solver_path: boolean;
  primary_intent: {
    intent_kind: HelixAskTurnIntentKind;
    route: string;
    source_target: string;
    target_kind: string;
    selection_reason: string;
  } | null;
  solver_short_circuit_flags: HelixAskTurnSolverRiskFlag[];
  hard_gate?: HelixAskTurnSolverHardGate;
};

const hashShort = (value: unknown): string =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readBoolean = (value: unknown): boolean => value === true;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry: unknown): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const mergeCurrentTurnArtifacts = (
  artifacts: HelixTurnArtifact[],
): HelixTurnArtifact[] => {
  const seen = new Set<string>();
  const merged: HelixTurnArtifact[] = [];
  for (const artifact of artifacts) {
    const artifactId = readString(artifact.artifact_id);
    const kind = readString(artifact.kind);
    const key = artifactId || `${kind}:${merged.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(artifact);
  }
  return merged;
};

const appendRuntimeIntentPacketForSolver = (input: {
  payload: RecordLike;
  turnId: string;
  promptText: string;
}): void => {
  appendHelixRuntimeIntentPacketToPayload({
    payload: input.payload,
    turnId: input.turnId,
    prompt: input.promptText,
    dependencies: {
      readString: (value: unknown) => readString(value) || null,
      hashPayloadShort: hashShort,
      mergeLedgerArtifacts: (artifacts: HelixTurnArtifact[]) =>
        mergeCurrentTurnArtifacts(artifacts),
      resolveTerminalContract: ({
        canonicalGoalFrame,
      }: {
        canonicalGoalFrame: RecordLike;
      }) => {
        const requiredTerminalKinds = readStringArray(
          canonicalGoalFrame.required_terminal_kinds,
        );
        const forbiddenTerminalKinds = readStringArray(
          canonicalGoalFrame.forbidden_terminal_kinds,
        );
        const requiredTerminalKind = readString(
          canonicalGoalFrame.required_terminal_kind,
        );
        return {
          required_actions: readStringArray(
            canonicalGoalFrame.required_actions,
          ),
          required_evidence: readStringArray(
            canonicalGoalFrame.required_evidence,
          ),
          required_terminal_kinds:
            requiredTerminalKinds.length > 0
              ? requiredTerminalKinds
              : requiredTerminalKind
                ? [requiredTerminalKind]
                : [],
          forbidden_terminal_kinds: forbiddenTerminalKinds,
        };
      },
    },
  });
};

const isContextualToolReferenceSuppressed = (payload: RecordLike): boolean => {
  const capabilityPlan = readRecord(payload.capability_plan);
  const arbitration = readRecord(
    capabilityPlan?.capability_contract_arbitration,
  );
  const admission = readRecord(payload.tool_call_admission_decision);
  return (
    readString(arbitration?.contract_state) ===
      "suppressed_contextual_reference" ||
    readBoolean(capabilityPlan?.tool_admission_suppressed) ||
    readBoolean(admission?.tool_admission_suppressed)
  );
};

const hasBlockingToolRailFailure = (payload: RecordLike): boolean => {
  const audit = readRecord(payload.tool_turn_chain_audit);
  const triage = readRecord(payload.tool_rail_failure_triage);
  const railStatus =
    readString(triage?.rail_status) || readString(audit?.rail_status);
  return railStatus === "broken" || railStatus === "fail_closed";
};

const resolveAuthoritativeWorkstationToolTerminal = (
  payload: RecordLike,
): {
  terminalArtifactKind: "workstation_tool_evaluation";
  finalAnswerSource: "workstation_tool_evaluation";
} | null => {
  if (
    isContextualToolReferenceSuppressed(payload) ||
    hasBlockingToolRailFailure(payload)
  ) {
    return null;
  }
  return resolvePublishedWorkstationToolTerminal(payload);
};

const unique = <T>(entries: T[]): T[] => Array.from(new Set(entries));

const buildCompoundPromptCoverage = (
  contract: HelixCompoundPromptContract,
  finalAnswerText: string,
): NonNullable<HelixAskTurnSolverTrace["compound_prompt_coverage"]> => {
  const required = contract.requirements.filter(
    (requirement) => requirement.required,
  );
  const normalizedAnswer = finalAnswerText.toLowerCase();
  const answered = required.filter((requirement) => {
    const keywords = requirement.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5)
      .slice(0, 5);
    return (
      keywords.length > 0 &&
      keywords.some((word) => normalizedAnswer.includes(word))
    );
  });
  const answeredIds = answered.map((requirement) => requirement.id);
  const missingIds = required
    .filter((requirement) => !answeredIds.includes(requirement.id))
    .map((requirement) => requirement.id);
  return {
    schema: "helix.compound_prompt_coverage.v1",
    required_requirement_ids: required.map((requirement) => requirement.id),
    answered_requirement_ids: answeredIds,
    missing_requirement_ids: missingIds,
    coverage:
      required.length === 0
        ? "not_compound"
        : missingIds.length === 0
          ? "complete"
          : answeredIds.length > 0
            ? "partial"
            : "none",
    final_answer_must_cover_all: true,
    assistant_answer: false,
    raw_content_included: false,
  };
};

const readTerminalGoalFrame = (
  payload: RecordLike,
): { goalKind: string; requiredTerminalKind: string } => {
  const committedRoute = readCommittedAskRoute(payload);
  const committedGoal = committedRoute?.canonical_goal;
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  const universalGoalFrame = readRecord(payload.universal_goal_frame);
  const universalUserGoal = readRecord(universalGoalFrame?.user_goal);
  return {
    goalKind:
      readString(committedGoal?.goal_kind) ||
      readString(canonicalGoalFrame?.goal_kind) ||
      readString(universalGoalFrame?.goal_kind) ||
      readString(universalUserGoal?.goal_kind),
    requiredTerminalKind:
      readString(committedGoal?.required_terminal_kind) ||
      readString(canonicalGoalFrame?.required_terminal_kind) ||
      readString(universalGoalFrame?.required_terminal_kind) ||
      readString(universalUserGoal?.required_terminal_kind),
  };
};

const terminalMatchesCanonicalGoalContract = (
  payload: RecordLike,
  terminalArtifactKind: string,
): boolean => {
  const goalFrame = readTerminalGoalFrame(payload);
  return (
    goalFrame.requiredTerminalKind === terminalArtifactKind &&
    Boolean(goalFrame.goalKind) &&
    !/^(?:unknown|ambiguous)$/i.test(goalFrame.goalKind)
  );
};

const terminalMatchesEvidenceProductContract = (
  payload: RecordLike,
  terminalArtifactKind: string,
): boolean => {
  if (/receipt/i.test(terminalArtifactKind)) return false;
  const contract = readRecord(payload.route_product_contract);
  if (readString(contract?.schema) !== "helix.route_product_contract.v1")
    return false;
  const terminalPolicy = applyCompoundTerminalPolicy(payload, {
    allowed: readStringArray(contract?.allowed_terminal_artifact_kinds),
    forbidden: readStringArray(contract?.forbidden_terminal_artifact_kinds),
    requiredTerminalKind: readString(contract?.required_terminal_kind),
  });
  const allowed = terminalPolicy.allowed;
  const forbidden = terminalPolicy.forbidden;
  const evidenceTerminals = new Set([
    "active_doc_identity",
    "doc_location_result",
    "doc_location_matches",
    "doc_evidence_location",
    "doc_summary",
    "repo_code_evidence_answer",
    "repo_entity_definition",
    "repo_code_evidence_observation",
    "procedure_evidence_retrieval_result",
    "situation_context_pack",
    "visual_context_pack",
    "visual_frame_evidence",
    "audio_transcript_context_pack",
    "note_context_pack",
  ]);
  return (
    evidenceTerminals.has(terminalArtifactKind) &&
    allowed.includes(terminalArtifactKind) &&
    !forbidden.includes(terminalArtifactKind)
  );
};

const compliantContextualToolSuppressionAllowsDirectAnswer = (input: {
  payload: RecordLike;
  terminalArtifactKind: string;
  finalAnswerSource: string;
  contextualToolMentions: HelixPromptInterpretation["contextual_tool_mentions"];
  contextualToolAudit: HelixAskTurnSolverTrace["contextual_tool_audit"];
  negativeConstraints: string[];
  actualToolCalls: RecordLike[];
}): boolean => {
  if (input.terminalArtifactKind !== "direct_answer_text") return false;
  if (/receipt|typed_failure|request_user_input/i.test(input.finalAnswerSource))
    return false;
  if (
    !terminalMatchesCanonicalGoalContract(
      input.payload,
      input.terminalArtifactKind,
    )
  )
    return false;
  if (
    input.contextualToolMentions.length === 0 &&
    input.negativeConstraints.length === 0
  )
    return false;
  if (input.contextualToolAudit.blocked_contextual_tool_executed) return false;
  if (input.actualToolCalls.length > 0) return false;
  return true;
};

const ledgerHasArtifactKind = (payload: RecordLike, kind: string): boolean => {
  if (readString(readRecord(payload.final_answer_draft)?.kind) === kind)
    return true;
  if (
    readString(readRecord(payload.final_answer_draft)?.schema) ===
    `helix.${kind}.v1`
  )
    return true;
  return (
    Array.isArray(payload.current_turn_artifact_ledger)
      ? payload.current_turn_artifact_ledger
      : []
  )
    .map((entry) => readRecord(entry))
    .some((entry) => {
      const artifactPayload = readRecord(entry?.payload);
      return (
        readString(entry?.kind) === kind ||
        readString(artifactPayload?.kind) === kind ||
        readString(artifactPayload?.schema) === `helix.${kind}.v1`
      );
    });
};

const committedModelOnlyDirectAnswerPathSatisfied = (input: {
  payload: RecordLike;
  trace: HelixAskTurnSolverTrace | null;
  actualToolCalls: RecordLike[];
}): boolean => {
  const committedRoute =
    readCommittedAskRoute(input.payload) ??
    input.trace?.committed_ask_route ??
    null;
  if (!committedRoute) return false;
  if (committedRoute.route.source_target !== "model_only") return false;
  if (committedRoute.canonical_goal.goal_kind !== "model_only_concept")
    return false;
  if (
    committedRoute.canonical_goal.required_terminal_kind !==
    "direct_answer_text"
  )
    return false;
  if (input.actualToolCalls.length > 0) return false;

  const goalSatisfaction = readRecord(
    input.payload.goal_satisfaction_evaluation,
  );
  if (readString(goalSatisfaction?.satisfaction) !== "satisfied") return false;
  if (readString(goalSatisfaction?.next_decision) !== "allow_terminal")
    return false;

  const runtimeAuthorityOk =
    readRecord(input.payload.runtime_authority_audit)?.ok === true ||
    (Array.isArray(input.payload.current_turn_artifact_ledger)
      ? input.payload.current_turn_artifact_ledger
      : []
    )
      .map((entry) => readRecord(entry))
      .some(
        (entry) =>
          readString(entry?.kind) === "runtime_authority_audit" &&
          readRecord(entry?.payload)?.ok === true,
      );
  if (!runtimeAuthorityOk) return false;

  const hasModelAnswer =
    ledgerHasArtifactKind(input.payload, "direct_answer_text") ||
    ledgerHasArtifactKind(input.payload, "final_answer_draft");
  if (!hasModelAnswer) return false;

  return (
    committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
    }) ||
    committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "final_answer_draft",
      finalAnswerSource: "model_direct_answer",
    })
  );
};

const capabilityHelpTerminalPathMaterialized = (input: {
  payload: RecordLike;
  terminalArtifactKind: string;
  finalAnswerSource: string;
}): boolean => {
  const terminalUsesCapabilityHelp =
    input.terminalArtifactKind === "capability_help_summary" ||
    input.finalAnswerSource === "capability_help_summary";
  if (!terminalUsesCapabilityHelp) return false;
  if (
    !terminalMatchesCanonicalGoalContract(
      input.payload,
      "capability_help_summary",
    )
  )
    return false;
  if (!ledgerHasArtifactKind(input.payload, "capability_registry"))
    return false;

  const terminalAuthority = readRecord(input.payload.terminal_answer_authority);
  const terminalWriter = readRecord(
    input.payload.terminal_authority_single_writer,
  );
  const terminalPresentation = readRecord(input.payload.terminal_presentation);
  const resolvedSummary = readRecord(input.payload.resolved_turn_summary);
  const authorityKind = readString(terminalAuthority?.terminal_artifact_kind);
  const authoritySource = readString(terminalAuthority?.final_answer_source);
  const writerKind =
    readString(terminalWriter?.selected_terminal_artifact_kind) ||
    readString(terminalWriter?.terminal_artifact_kind) ||
    readString(terminalWriter?.selectedArtifactKind);
  const presentationKind = readString(
    terminalPresentation?.terminal_artifact_kind,
  );
  const resolvedKind = readString(resolvedSummary?.terminal_artifact_kind);

  return (
    readBoolean(terminalAuthority?.server_authoritative) &&
    (authorityKind === "capability_help_summary" ||
      authoritySource === "capability_help_summary" ||
      writerKind === "capability_help_summary" ||
      presentationKind === "capability_help_summary" ||
      resolvedKind === "capability_help_summary")
  );
};

const collectCompoundSynthesisSupportRefs = (payload: RecordLike): string[] => {
  const answer = readRecord(payload.compound_evidence_synthesis_answer);
  const presentation = readRecord(payload.terminal_presentation);
  return unique([
    ...readStringArray(answer?.support_refs),
    ...readStringArray(answer?.observation_refs),
    ...readStringArray(answer?.artifact_refs),
    ...readStringArray(answer?.evidence_refs),
    ...readStringArray(presentation?.selected_observation_refs),
  ]);
};

const compoundSynthesisTerminalPathMaterialized = (input: {
  payload: RecordLike;
  terminalArtifactKind: string;
  finalAnswerSource: string;
}): boolean => {
  const terminalUsesCompoundSynthesis =
    input.terminalArtifactKind === "compound_evidence_synthesis_answer" ||
    input.finalAnswerSource === "compound_evidence_synthesis_answer";
  if (!terminalUsesCompoundSynthesis) return false;
  if (
    !terminalMatchesCanonicalGoalContract(
      input.payload,
      "compound_evidence_synthesis_answer",
    )
  )
    return false;
  if (collectCompoundSynthesisSupportRefs(input.payload).length === 0)
    return false;

  const terminalAuthority = readRecord(input.payload.terminal_answer_authority);
  const terminalWriter = readRecord(
    input.payload.terminal_authority_single_writer,
  );
  const terminalPresentation = readRecord(input.payload.terminal_presentation);
  const resolvedSummary = readRecord(input.payload.resolved_turn_summary);
  const authorityKind = readString(terminalAuthority?.terminal_artifact_kind);
  const authoritySource = readString(terminalAuthority?.final_answer_source);
  const writerKind =
    readString(terminalWriter?.selected_terminal_artifact_kind) ||
    readString(terminalWriter?.terminal_artifact_kind) ||
    readString(terminalWriter?.selectedArtifactKind);
  const presentationKind = readString(
    terminalPresentation?.terminal_artifact_kind,
  );
  const resolvedKind = readString(resolvedSummary?.terminal_artifact_kind);

  return (
    readBoolean(terminalAuthority?.server_authoritative) &&
    (authorityKind === "compound_evidence_synthesis_answer" ||
      authoritySource === "compound_evidence_synthesis_answer" ||
      writerKind === "compound_evidence_synthesis_answer" ||
      presentationKind === "compound_evidence_synthesis_answer" ||
      resolvedKind === "compound_evidence_synthesis_answer")
  );
};

const providerRouteProductAllowedByCurrentContracts = (
  payload: RecordLike,
  terminalArtifactKind: string,
): boolean => {
  const committedRoute = readCommittedAskRoute(payload);
  const committedGoal = committedRoute?.canonical_goal;
  const routeProductContract = readRecord(payload.route_product_contract);
  if (
    !committedGoal ||
    readString(routeProductContract?.schema) !==
      "helix.route_product_contract.v1"
  ) {
    return false;
  }
  const committedAllowed = readStringArray(
    committedGoal.allowed_terminal_artifact_kinds,
  );
  const committedForbidden = readStringArray(
    committedGoal.forbidden_terminal_artifact_kinds,
  );
  const routeAllowed = readStringArray(
    routeProductContract?.allowed_terminal_artifact_kinds,
  );
  const routeForbidden = readStringArray(
    routeProductContract?.forbidden_terminal_artifact_kinds,
  );
  return (
    committedAllowed.includes(terminalArtifactKind) &&
    !committedForbidden.includes(terminalArtifactKind) &&
    routeAllowed.includes(terminalArtifactKind) &&
    !routeForbidden.includes(terminalArtifactKind)
  );
};

const providerTerminalPathMaterialized = (input: {
  payload: RecordLike;
  turnId: string;
  terminalArtifactKind: string;
  finalAnswerSource: string;
  runtimeSolverCompletionObserved?: boolean;
}): boolean => {
  const terminalUsesProviderCandidate =
    input.terminalArtifactKind === "agent_provider_terminal_candidate" ||
    input.finalAnswerSource === "agent_provider_terminal_candidate";
  const providerRouteProductMaterialization = readRecord(
    input.payload.provider_route_product_materialization,
  );
  const providerBridge = readRecord(
    input.payload.provider_terminal_authority_bridge,
  );
  const providerReasoningReentry = readRecord(
    input.payload.provider_reasoning_reentry,
  );
  const terminalWriter = readRecord(
    input.payload.terminal_authority_single_writer,
  );
  const terminalAuthority = readRecord(input.payload.terminal_answer_authority);
  const terminalPresentation = readRecord(input.payload.terminal_presentation);
  const selectedProviderRouteProductRef =
    readString(terminalWriter?.selected_terminal_artifact_ref) ||
    readString(terminalWriter?.selectedArtifactRef);
  const providerTerminalCandidateRef =
    readString(
      providerRouteProductMaterialization?.provider_terminal_candidate_ref,
    ) ||
    readString(providerBridge?.provider_terminal_candidate_ref) ||
    readString(providerReasoningReentry?.provider_terminal_candidate_ref);
  const materializedProviderRouteProductRef = readString(
    providerRouteProductMaterialization?.materialized_terminal_artifact_ref,
  );
  const materializedProviderRouteProductKind = readString(
    providerRouteProductMaterialization?.materialized_terminal_artifact_kind,
  );
  const materializedSupportRefs = readStringArray(
    providerRouteProductMaterialization?.selected_observation_refs,
  );
  const presentationSupportRefs = readStringArray(
    terminalPresentation?.selected_observation_refs,
  );
  const canonicalGoal = readRecord(input.payload.canonical_goal_frame);
  const committedAskRoute = readRecord(input.payload.committed_ask_route);
  const committedCanonicalGoal = readRecord(committedAskRoute?.canonical_goal);
  const routeProductContract = readRecord(input.payload.route_product_contract);
  const sourceTargetIntent = readRecord(input.payload.source_target_intent);
  const committedRouteDescriptor = readRecord(committedAskRoute?.route);
  const routeProductSourceTarget = readString(
    routeProductContract?.source_target,
  );
  const committedRouteSourceTarget = readString(
    committedRouteDescriptor?.source_target,
  );
  const directModelOnlyGoalKind =
    readString(canonicalGoal?.goal_kind) ||
    readString(committedCanonicalGoal?.goal_kind);
  const modelOnlySourceTarget = ["model_only", "general_background"].includes(
    readString(sourceTargetIntent?.target_source) || "",
  );
  // Source strength is admission confidence, not an assertion that the turn has no observations.
  const committedRouteHasSpecificSource =
    Boolean(committedRouteSourceTarget) &&
    committedRouteSourceTarget !== "unknown";
  const modelOnlySourceContract =
    ["model_only", "general_background"].includes(
      committedRouteSourceTarget || "",
    ) ||
    (!committedRouteHasSpecificSource &&
      (modelOnlySourceTarget ||
        ["model_only", "general_background"].includes(
          routeProductSourceTarget || "",
        ))) ||
    (directModelOnlyGoalKind === "model_only_concept" &&
      !committedRouteHasSpecificSource);
  const directModelOnlyTerminalAllowed =
    readString(canonicalGoal?.required_terminal_kind) ===
      input.terminalArtifactKind ||
    readString(committedCanonicalGoal?.required_terminal_kind) ===
      input.terminalArtifactKind ||
    readStringArray(
      committedCanonicalGoal?.allowed_terminal_artifact_kinds,
    ).includes(input.terminalArtifactKind) ||
    readStringArray(
      routeProductContract?.allowed_terminal_artifact_kinds,
    ).includes(input.terminalArtifactKind);
  const directModelOnlyProviderProduct =
    terminalUsesProviderCandidate &&
    presentationSupportRefs.length === 0 &&
    ["model_only_concept", "conversation", "workspace_help"].includes(
      directModelOnlyGoalKind,
    ) &&
    modelOnlySourceContract &&
    providerBridge?.terminal_authority_granted === true &&
    providerBridge?.final_visible_answer_authorized === true &&
    readString(providerReasoningReentry?.status) === "completed" &&
    providerReasoningReentry?.evidence_reentry_required === false &&
    providerReasoningReentry?.evidence_reentered === true &&
    (readBoolean(providerReasoningReentry?.solver_completed) === true ||
      input.runtimeSolverCompletionObserved === true) &&
    readBoolean(providerReasoningReentry?.goal_satisfaction_compatible) ===
      true &&
    readBoolean(terminalAuthority?.server_authoritative) === true &&
    readString(terminalAuthority?.terminal_artifact_kind) ===
      input.terminalArtifactKind &&
    readString(terminalAuthority?.final_answer_source) ===
      input.finalAnswerSource &&
    readString(terminalPresentation?.terminal_artifact_kind) ===
      input.terminalArtifactKind &&
    readString(terminalPresentation?.final_answer_source) ===
      input.finalAnswerSource &&
    directModelOnlyTerminalAllowed;
  if (directModelOnlyProviderProduct) return true;
  const committedRoute = readCommittedAskRoute(input.payload);
  const currentScholarlySupportRefs = presentationSupportRefs.filter(
    (ref) =>
      readStringArray(
        providerBridge?.successful_gateway_observation_refs,
      ).includes(ref) &&
      readStringArray(
        providerReasoningReentry?.normalized_observation_refs,
      ).includes(ref),
  );
  const currentScholarlyProviderProduct =
    input.terminalArtifactKind === "scholarly_research_answer" &&
    input.finalAnswerSource === "scholarly_research_answer" &&
    committedRoute?.route.source_target === "scholarly_research" &&
    committedRoute.canonical_goal.allowed_terminal_artifact_kinds.includes(
      "scholarly_research_answer",
    ) &&
    !committedRoute.canonical_goal.forbidden_terminal_artifact_kinds.includes(
      "scholarly_research_answer",
    ) &&
    readString(providerBridge?.schema) ===
      "helix.provider_terminal_authority_bridge.v1" &&
    readString(providerBridge?.turn_id) === input.turnId &&
    providerBridgeAllEvidenceReentryCompatible(providerBridge) &&
    readBoolean(providerBridge?.normalized_observations_ready) === true &&
    readBoolean(providerBridge?.terminal_authority_granted) === true &&
    readBoolean(providerBridge?.final_visible_answer_authorized) === true &&
    readString(providerReasoningReentry?.schema) ===
      "helix.provider_reasoning_reentry.v1" &&
    readString(providerReasoningReentry?.turn_id) === input.turnId &&
    readString(providerReasoningReentry?.status) === "completed" &&
    readBoolean(providerReasoningReentry?.evidence_reentered) === true &&
    readBoolean(providerReasoningReentry?.solver_completed) === true &&
    readBoolean(providerReasoningReentry?.goal_satisfaction_compatible) ===
      true &&
    readStringArray(providerReasoningReentry?.normalized_observation_refs)
      .length > 0 &&
    readBoolean(terminalAuthority?.server_authoritative) === true &&
    readString(terminalAuthority?.turn_id) === input.turnId &&
    readString(terminalAuthority?.terminal_kind) === "answer" &&
    readString(terminalAuthority?.terminal_artifact_kind) ===
      input.terminalArtifactKind &&
    readString(terminalAuthority?.final_answer_source) ===
      input.finalAnswerSource &&
    readString(terminalPresentation?.turn_id) === input.turnId &&
    readString(terminalPresentation?.terminal_artifact_kind) ===
      input.terminalArtifactKind &&
    readString(terminalPresentation?.final_answer_source) ===
      input.finalAnswerSource &&
    Boolean(readString(terminalPresentation?.concise_text)) &&
    presentationSupportRefs.length > 0 &&
    currentScholarlySupportRefs.length === presentationSupportRefs.length &&
    (readString(terminalWriter?.selected_terminal_artifact_kind) ===
      input.terminalArtifactKind ||
      readString(terminalWriter?.selectedArtifactKind) ===
        input.terminalArtifactKind);
  if (currentScholarlyProviderProduct) return true;
  const terminalUsesMaterializedProviderRouteProduct =
    readString(providerRouteProductMaterialization?.status) ===
      "materialized" &&
    materializedProviderRouteProductKind === input.terminalArtifactKind &&
    materializedProviderRouteProductRef === selectedProviderRouteProductRef &&
    Boolean(providerTerminalCandidateRef) &&
    Boolean(
      materializedProviderRouteProductRef?.startsWith(
        `${providerTerminalCandidateRef}:route_product:`,
      ),
    ) &&
    (modelOnlySourceContract
      ? materializedSupportRefs.length === 0 &&
        presentationSupportRefs.length === 0
      : materializedSupportRefs.length > 0 &&
        presentationSupportRefs.some((ref) =>
          materializedSupportRefs.includes(ref),
        )) &&
    providerBridge?.terminal_authority_granted === true &&
    providerBridge?.final_visible_answer_authorized === true &&
    readString(providerReasoningReentry?.status) === "completed" &&
    providerReasoningReentry?.evidence_reentered === true &&
    (readBoolean(providerReasoningReentry?.solver_completed) === true ||
      input.runtimeSolverCompletionObserved === true) &&
    readBoolean(providerReasoningReentry?.goal_satisfaction_compatible) ===
      true &&
    readBoolean(terminalAuthority?.server_authoritative) === true &&
    readString(terminalAuthority?.terminal_artifact_kind) ===
      input.terminalArtifactKind &&
    readString(terminalAuthority?.final_answer_source) ===
      input.finalAnswerSource &&
    readString(terminalPresentation?.terminal_artifact_kind) ===
      input.terminalArtifactKind &&
    readString(terminalPresentation?.final_answer_source) ===
      input.finalAnswerSource;
  if (
    !terminalUsesProviderCandidate &&
    !terminalUsesMaterializedProviderRouteProduct
  )
    return false;
  if (terminalUsesMaterializedProviderRouteProduct && modelOnlySourceContract)
    return true;
  if (presentationSupportRefs.length === 0) return false;
  if (terminalUsesMaterializedProviderRouteProduct) {
    return (
      terminalMatchesCanonicalGoalContract(
        input.payload,
        input.terminalArtifactKind,
      ) ||
      providerRouteProductAllowedByCurrentContracts(
        input.payload,
        input.terminalArtifactKind,
      )
    );
  }
  const canonicalProviderTerminal = terminalMatchesCanonicalGoalContract(
    input.payload,
    input.terminalArtifactKind,
  );
  if (
    !canonicalProviderTerminal &&
    !terminalMatchesCanonicalGoalContract(
      input.payload,
      "model_synthesized_answer",
    )
  ) {
    return false;
  }
  if (
    canonicalProviderTerminal &&
    !providerPostObservationCompletionMaterialized({
      payload: input.payload,
      turnId: input.turnId,
      terminalArtifactKind: input.terminalArtifactKind,
      finalAnswerSource: input.finalAnswerSource,
    })
  ) {
    return false;
  }
  return (
    readBoolean(terminalAuthority?.server_authoritative) &&
    (readString(terminalAuthority?.terminal_artifact_kind) ===
      "agent_provider_terminal_candidate" ||
      readString(terminalAuthority?.final_answer_source) ===
        "agent_provider_terminal_candidate")
  );
};

const terminalAllowedByCanonicalOrCompliantConstraintPolicy = (input: {
  payload: RecordLike;
  terminalArtifactKind: string;
  finalAnswerSource: string;
  contextualToolMentions: HelixPromptInterpretation["contextual_tool_mentions"];
  contextualToolAudit: HelixAskTurnSolverTrace["contextual_tool_audit"];
  negativeConstraints: string[];
  actualToolCalls: RecordLike[];
}): boolean =>
  (terminalMatchesCanonicalGoalContract(
    input.payload,
    input.terminalArtifactKind,
  ) &&
    input.contextualToolMentions.length === 0 &&
    input.negativeConstraints.length === 0) ||
  (terminalMatchesEvidenceProductContract(
    input.payload,
    input.terminalArtifactKind,
  ) &&
    input.negativeConstraints.length === 0) ||
  compliantContextualToolSuppressionAllowsDirectAnswer(input);

const sourceTargeted = new Set([
  "visual_capture",
  "procedure_memory",
  "conversation_memory",
  "situation_epoch",
  "visual_scene_memory",
  "repo_code",
  "runtime_evidence",
  "room_mission_result",
  "workspace_directory",
  "workspace_diagnostic",
  "theory_locator",
  "context_reflection",
  "calculator_stream",
  "docs_viewer",
  "active_doc",
  "internet_search",
  "scholarly_research",
  "process_graph",
  "live_pipeline",
  "live_environment",
  "live_source_mailbox",
  "world_event",
  "active_note",
]);

const sourceRequiresEvidence = (sourceTarget: string): boolean =>
  /visual_capture|procedure_memory|conversation_memory|situation_epoch|visual_scene_memory|repo_code|runtime_evidence|room_mission_result|workspace_directory|workspace_diagnostic|theory_locator|context_reflection|calculator_stream|docs_viewer|active_doc|world_event|internet_search|scholarly_research|process_graph|live_environment|live_source_mailbox/i.test(
    sourceTarget,
  );

const toolFamilyMutating = (family: string): boolean =>
  /live_pipeline|workspace_action|workstation_action|docs_viewer|process_graph|notes|voice_delivery/i.test(
    family,
  );

const inferToolFamily = (toolId: string): string => {
  if (
    /scholarly[-_.]?research|lookup[_-]?papers|fetch[_-]?full[_-]?text|semantic[-_.]?scholar|openalex|pubmed|crossref/i.test(
      toolId,
    )
  )
    return "scholarly_research";
  if (
    /scientific[-_.]?calculator|calculator|calculate|compute|solve/i.test(
      toolId,
    )
  )
    return "calculator";
  if (
    /reflect[_-]?context[_-]?attachments|reflect[_-]?live[_-]?synthetic[_-]?data|context[_-]?reflection/i.test(
      toolId,
    )
  )
    return "context_reflection";
  if (
    /reflect[_-]?ideology[_-]?context|bridge[_-]?theory[_-]?ideology|moral[-_.]?graph|ideology_context_reflection/i.test(
      toolId,
    )
  )
    return "moral_graph_reflection";
  if (
    /civilization[-_.]?bounds|civilization[-_.]?scenario|reflect[_-]?civilization|build[_-]?civilization/i.test(
      toolId,
    )
  )
    return "civilization_bounds";
  if (
    /inspect[_-]?capability[_-]?catalog|capability[_-]?catalog|tool[_-]?alignment/i.test(
      toolId,
    )
  )
    return "capability_catalog";
  if (
    /theory[-_.]?locator|reflect[_-]?theory[_-]?context|theory[_-]?context[_-]?reflection|badge[_-]?graph/i.test(
      toolId,
    )
  )
    return "theory_locator";
  if (/internet[-_.]?search|web[-_.]?research|web\.search/i.test(toolId))
    return "internet_search";
  if (
    /text[-_.]?to[-_.]?speech|speak[_-]?text|voice[-_.]?delivery|voice[-_.]?output|request[_-]?interim[_-]?voice[_-]?callout|narrator[_-]?say/i.test(
      toolId,
    )
  )
    return "voice_delivery";
  if (/^live_env\./i.test(toolId)) return "live_environment";
  if (
    /^situation-room\.live-source\.|^situation-room\.pipeline\./i.test(toolId)
  )
    return "live_pipeline";
  if (/workspace[_-]?os|workspace_diagnostic/i.test(toolId))
    return "workspace_diagnostic";
  if (/workspace[-_.]?directory/i.test(toolId)) return "workspace_directory";
  if (/click|open|close|panel|workspace-action|workspace_action/i.test(toolId))
    return "workstation_action";
  if (/workstation-notes|note/i.test(toolId)) return "notes";
  if (/repo|code|source-tree/i.test(toolId)) return "repo_code";
  if (/docs-viewer|doc[_-]?viewer/i.test(toolId)) return "docs_viewer";
  return "unknown";
};

const CONTEXTUAL_TOOL_AUDIT_FAMILIES = [
  "docs_viewer",
  "scholarly_research",
  "internet_search",
  "theory_locator",
  "context_reflection",
  "moral_graph_reflection",
  "civilization_bounds",
  "capability_catalog",
  "visual_capture",
  "workspace_diagnostic",
  "workstation_action",
  "notes",
  "repo_code",
  "live_environment",
  "voice_delivery",
  "live_pipeline",
  "process_graph",
  "calculator",
  "workspace_directory",
] as const;

const contextualMentionBlocksFamily = (
  mention: HelixPromptInterpretation["contextual_tool_mentions"][number],
  family: string,
): boolean =>
  contextualToolSuppressionBlocksFamily(
    {
      tool_admission_suppressed: true,
      suppression_reason:
        mention.reason === "negated"
          ? "negated_tool_instruction"
          : "explanatory_only",
      verb_or_cue: mention.verb_or_cue,
      text: mention.text,
    },
    family,
  );

const blockedFamiliesForContextualMentions = (
  mentions: HelixPromptInterpretation["contextual_tool_mentions"],
): string[] =>
  unique(
    CONTEXTUAL_TOOL_AUDIT_FAMILIES.filter((family) =>
      mentions.some((mention) =>
        contextualMentionBlocksFamily(mention, family),
      ),
    ),
  );

const buildContextualToolAudit = (input: {
  payload: RecordLike;
  contextualToolMentions: HelixPromptInterpretation["contextual_tool_mentions"];
  actualToolCalls: RecordLike[];
  unexpectedToolCalls: string[];
}): HelixAskTurnSolverTrace["contextual_tool_audit"] => {
  const admission = readRecord(input.payload.tool_call_admission_decision);
  const admittedFamilies = new Set(
    readStringArray(admission?.admitted_tool_families),
  );
  const explicitlyForbiddenFamilies = readStringArray(
    admission?.forbidden_tool_families,
  );
  const contextualBlockedFamilies = blockedFamiliesForContextualMentions(
    input.contextualToolMentions,
  ).filter((family) => !admittedFamilies.has(family));
  const blockedFamilies = unique([
    ...contextualBlockedFamilies,
    ...explicitlyForbiddenFamilies,
  ]);
  const blockedFamilySet = new Set(blockedFamilies);
  const executedBlockedToolIds = unique(
    [
      ...input.actualToolCalls.map((entry) => {
        const toolId = readString(entry.tool_id);
        const family = readString(entry.family) || inferToolFamily(toolId);
        return toolId && blockedFamilySet.has(family) ? toolId : "";
      }),
      ...input.unexpectedToolCalls.map((toolId) => {
        const family = inferToolFamily(toolId);
        return toolId && blockedFamilySet.has(family) ? toolId : "";
      }),
    ].filter(Boolean),
  );
  return {
    schema: "helix.contextual_tool_audit.v1",
    contextual_tool_mention_present: input.contextualToolMentions.length > 0,
    contextual_tool_family_blocked: blockedFamilies.length > 0,
    blocked_contextual_tool_executed: executedBlockedToolIds.length > 0,
    blocked_families: blockedFamilies,
    executed_blocked_tool_ids: executedBlockedToolIds,
    assistant_answer: false,
    raw_content_included: false,
  };
};

const sourceTargetFromPayload = (
  payload: RecordLike,
): {
  sourceTarget: string;
  targetKind: string;
  reason: string;
  strength: string;
} => {
  const committedRoute = readCommittedAskRoute(payload);
  if (committedRoute) {
    return {
      sourceTarget: committedRoute.route.source_target,
      targetKind: committedRoute.route.target_kind,
      reason: committedRoute.route.route_reason,
      strength: committedRoute.route.strength,
    };
  }
  const sourceTargetIntent = readRecord(payload.source_target_intent);
  const routeContract = readRecord(payload.route_product_contract);
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  const contractArbitration = readRecord(
    payload.capability_contract_arbitration,
  );
  const capabilityPlan = readRecord(payload.capability_plan);
  const toolCallAdmission = readRecord(payload.tool_call_admission_decision);
  if (readString(canonicalGoalFrame?.goal_kind) === "note_mutation") {
    return {
      sourceTarget: "active_note",
      targetKind: "active_note",
      reason: "canonical_goal_note_mutation",
      strength: "hard",
    };
  }
  const effectiveSourceTarget =
    readString(contractArbitration?.selected_source_target) ||
    readString(capabilityPlan?.source_target) ||
    readString(toolCallAdmission?.source_target) ||
    readString(sourceTargetIntent?.target_source) ||
    readString(routeContract?.source_target) ||
    "unknown";
  const effectiveTargetKind =
    readString(sourceTargetIntent?.target_kind) ||
    readString(sourceTargetIntent?.target_source) ||
    readString(routeContract?.source_target) ||
    effectiveSourceTarget;
  return {
    sourceTarget: effectiveSourceTarget,
    targetKind: effectiveTargetKind,
    reason:
      readString(contractArbitration?.demotion_reason) ||
      readString(toolCallAdmission?.reason) ||
      readString(sourceTargetIntent?.precedence_reason) ||
      readString(routeContract?.precedence_reason) ||
      "source_target_admission_trace",
    strength:
      readString(sourceTargetIntent?.strength) ||
      readString(contractArbitration?.contract_state) ||
      "unknown",
  };
};

const allowedTerminalProducts = (payload: RecordLike): string[] => {
  const committedRoute = readCommittedAskRoute(payload);
  const contract = readRecord(payload.route_product_contract);
  return applyCompoundTerminalPolicy(payload, {
    allowed:
      committedRoute?.canonical_goal.allowed_terminal_artifact_kinds ??
      readStringArray(contract?.allowed_terminal_artifact_kinds),
    forbidden:
      committedRoute?.canonical_goal.forbidden_terminal_artifact_kinds ??
      readStringArray(contract?.forbidden_terminal_artifact_kinds),
    requiredTerminalKind:
      committedRoute?.canonical_goal.required_terminal_kind ??
      readString(contract?.required_terminal_kind),
  }).allowed;
};

const forbiddenTerminalProducts = (payload: RecordLike): string[] => {
  const committedRoute = readCommittedAskRoute(payload);
  const contract = readRecord(payload.route_product_contract);
  return applyCompoundTerminalPolicy(payload, {
    allowed:
      committedRoute?.canonical_goal.allowed_terminal_artifact_kinds ??
      readStringArray(contract?.allowed_terminal_artifact_kinds),
    forbidden:
      committedRoute?.canonical_goal.forbidden_terminal_artifact_kinds ??
      readStringArray(contract?.forbidden_terminal_artifact_kinds),
    requiredTerminalKind:
      committedRoute?.canonical_goal.required_terminal_kind ??
      readString(contract?.required_terminal_kind),
  }).forbidden;
};

const isHardSourceTarget = (
  payload: RecordLike,
  trace: HelixAskTurnSolverTrace | null,
): boolean => {
  const sourceTarget = readRecord(payload.source_target_intent);
  const traceSource = trace?.primary_intent?.source_target ?? "";
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  const modelOnlySourceTarget =
    readString(sourceTarget?.target_source) === "model_only" ||
    readString(sourceTarget?.target_kind) === "general_background" ||
    readString(canonicalGoalFrame?.goal_kind) === "model_only_concept";
  if (modelOnlySourceTarget) return false;
  return (
    readString(sourceTarget?.strength) === "hard" ||
    sourceTarget?.must_enter_backend_ask === true ||
    sourceTargeted.has(readString(sourceTarget?.target_source)) ||
    sourceTargeted.has(traceSource)
  );
};

const isComplexSolverPrompt = (
  trace: HelixAskTurnSolverTrace | null,
): boolean => {
  if (!trace) return false;
  const primary = trace.selected_primary_intent;
  if (
    primary === "content_question" ||
    primary === "debug_diagnosis" ||
    primary === "implementation_question" ||
    primary === "procedure_memory_question" ||
    primary === "repo_evidence_question"
  ) {
    return true;
  }
  return (
    trace.secondary_intents.length > 0 ||
    trace.prompt_interpretation.contextual_tool_mentions.length > 0 ||
    trace.prompt_interpretation.negative_constraints.length > 0 ||
    trace.followup_reasoning.required ||
    trace.evidence_reentry.required
  );
};

const pureControlOrStatusReceiptAllowed = (
  trace: HelixAskTurnSolverTrace | null,
  payload: RecordLike,
): boolean => {
  if (!trace) return false;
  const primary = trace.selected_primary_intent;
  const terminal = trace.final_arbitration.terminal_artifact_kind;
  const reason = trace.followup_reasoning_gate.reason;
  const canonicalGoalTerminal =
    terminalMatchesCanonicalGoalContract(payload, terminal) &&
    trace.prompt_interpretation.contextual_tool_mentions.length === 0 &&
    trace.prompt_interpretation.negative_constraints.length === 0;
  const evidenceProductTerminal =
    terminalMatchesEvidenceProductContract(payload, terminal) &&
    trace.prompt_interpretation.negative_constraints.length === 0;
  const canonicalTerminal = canonicalGoalTerminal || evidenceProductTerminal;
  return (
    (((primary === "control_command" || primary === "status_question") &&
      /receipt/i.test(terminal) &&
      canonicalTerminal &&
      (reason === "pure_control_receipt" ||
        reason === "pure_status_receipt")) ||
      canonicalTerminal) &&
    (trace.route_authority_ok === true || canonicalTerminal)
  );
};

const pushHardFailure = (
  details: HelixAskTurnSolverHardGate["failure_details"],
  code: HelixAskTurnSolverHardFailureCode,
  reason: string,
): void => {
  if (details.some((entry) => entry.code === code)) return;
  details.push({ code, reason });
};

export function evaluateAskTurnSolverHardGate(input: {
  turnId: string;
  payload: RecordLike;
  trace?: HelixAskTurnSolverTrace | RecordLike | null;
  loopParityTrace?: HelixLoopParityTrace | RecordLike | null;
}): HelixAskTurnSolverHardGate {
  const trace = readRecord(
    input.trace ?? input.payload.ask_turn_solver_trace,
  ) as HelixAskTurnSolverTrace | null;
  const loopTrace = readRecord(
    input.loopParityTrace ?? input.payload.loop_parity_trace,
  );
  const sourceTarget = readRecord(input.payload.source_target_intent);
  const routeContract = readRecord(input.payload.route_product_contract);
  const routeAuthority = readRecord(input.payload.route_authority_audit);
  const terminalAuthorityPresent = Boolean(
    readRecord(input.payload.terminal_answer_authority),
  );
  const traceTerminalArtifactKind = readString(
    trace?.final_arbitration?.terminal_artifact_kind,
  );
  const traceFinalAnswerSource = readString(
    trace?.final_arbitration?.final_answer_source,
  );
  const typedFailureTerminal =
    traceTerminalArtifactKind === "typed_failure" ||
    traceFinalAnswerSource === "typed_failure" ||
    readString(input.payload.terminal_artifact_kind) === "typed_failure" ||
    readString(input.payload.final_answer_source) === "typed_failure";
  const requestUserInputTerminal =
    traceTerminalArtifactKind === "request_user_input" ||
    readString(input.payload.terminal_artifact_kind) === "request_user_input" ||
    traceFinalAnswerSource === "request_user_input" ||
    readString(input.payload.final_answer_source) === "request_user_input";
  const nonAnswerTerminal = typedFailureTerminal || requestUserInputTerminal;
  const hardSourceTarget = isHardSourceTarget(input.payload, trace);
  const complexPrompt = isComplexSolverPrompt(trace);
  const applies = hardSourceTarget || complexPrompt;
  const details: HelixAskTurnSolverHardGate["failure_details"] = [];
  const allowedPureReceipt = pureControlOrStatusReceiptAllowed(
    trace,
    input.payload,
  );
  const canonicalGoalKind = readString(
    readRecord(input.payload.canonical_goal_frame)?.goal_kind,
  );
  const goalSatisfaction = readRecord(
    input.payload.goal_satisfaction_evaluation,
  );
  const routeContractApprovedReceiptGoal =
    canonicalGoalKind === "note_mutation" ||
    canonicalGoalKind === "doc_open_best" ||
    canonicalGoalKind === "latest_doc_navigation";
  const goalSatisfactionReceiptAllowed =
    routeContractApprovedReceiptGoal &&
    readString(goalSatisfaction?.satisfaction) === "satisfied" &&
    (terminalMatchesCanonicalGoalContract(
      input.payload,
      traceTerminalArtifactKind,
    ) ||
      terminalMatchesCanonicalGoalContract(
        input.payload,
        readString(input.payload.terminal_artifact_kind),
      ));
  const terminalReceiptAllowed =
    allowedPureReceipt || goalSatisfactionReceiptAllowed;
  const actualToolCallsForHardGate = (
    Array.isArray(loopTrace?.actual_tool_calls)
      ? loopTrace.actual_tool_calls
      : []
  )
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry));
  const tracePromptInterpretation = trace?.prompt_interpretation;
  const traceContextualToolAudit = trace?.contextual_tool_audit;
  const sourceTargetModelOnly =
    canonicalGoalKind === "model_only_concept" ||
    readString(sourceTarget?.target_source) === "model_only" ||
    readString(sourceTarget?.target_kind) === "general_background";
  const compliantSuppressedDirectAnswerAllowed =
    Boolean(
      trace &&
      sourceTargetModelOnly &&
      tracePromptInterpretation &&
      traceContextualToolAudit,
    ) &&
    readString(goalSatisfaction?.satisfaction) === "satisfied" &&
    readString(goalSatisfaction?.next_decision) === "allow_terminal" &&
    compliantContextualToolSuppressionAllowsDirectAnswer({
      payload: input.payload,
      terminalArtifactKind:
        traceTerminalArtifactKind ||
        readString(input.payload.terminal_artifact_kind) ||
        "",
      finalAnswerSource:
        traceFinalAnswerSource ||
        readString(input.payload.final_answer_source) ||
        "",
      contextualToolMentions:
        tracePromptInterpretation?.contextual_tool_mentions ?? [],
      contextualToolAudit:
        traceContextualToolAudit as HelixAskTurnSolverTrace["contextual_tool_audit"],
      negativeConstraints:
        tracePromptInterpretation?.negative_constraints ?? [],
      actualToolCalls: actualToolCallsForHardGate,
    });
  const committedModelOnlyDirectAnswerAllowed =
    committedModelOnlyDirectAnswerPathSatisfied({
      payload: input.payload,
      trace,
      actualToolCalls: actualToolCallsForHardGate,
    });
  const staleRouteAuthorityPoisonSuppressed =
    compliantSuppressedDirectAnswerAllowed ||
    committedModelOnlyDirectAnswerAllowed;

  if (!trace) {
    pushHardFailure(
      details,
      "solver_trace_missing",
      "solver trace is required before terminal authority",
    );
  } else {
    if (!readRecord(trace.intent_arbitration)) {
      pushHardFailure(
        details,
        "intent_arbitration_missing",
        "intent arbitration is required before route authority",
      );
    }
    if (
      terminalAuthorityPresent &&
      trace.completed_solver_path === false &&
      trace.final_arbitration.terminal_artifact_kind !== "typed_failure" &&
      trace.final_arbitration.terminal_artifact_kind !== "request_user_input" &&
      !terminalReceiptAllowed &&
      !staleRouteAuthorityPoisonSuppressed
    ) {
      pushHardFailure(
        details,
        "solver_path_incomplete_before_terminal",
        "solver path was incomplete before successful terminal selection",
      );
    }
    if (
      trace.final_arbitration.selected_route &&
      !trace.selected_primary_intent
    ) {
      pushHardFailure(
        details,
        "route_selected_before_intent_arbitration",
        "selected route exists without a selected primary intent",
      );
    }
    for (const flag of trace.solver_risk_flags) {
      if (flag === "classifier_became_decision") {
        pushHardFailure(
          details,
          "classifier_became_decision",
          "classifier output reached decision authority",
        );
      }
      if (flag === "route_selected_before_intent_arbitration") {
        pushHardFailure(
          details,
          "route_selected_before_intent_arbitration",
          "route was selected before intent arbitration completed",
        );
      }
      if (
        flag === "blocked_contextual_tool_executed" &&
        !terminalReceiptAllowed
      ) {
        pushHardFailure(
          details,
          "blocked_contextual_tool_executed",
          "a blocked contextual, negated, historical, future, quoted, or screen-visible tool family was actually executed",
        );
      }
      if (
        flag === "receipt_terminal_without_reentry" &&
        !terminalReceiptAllowed
      ) {
        pushHardFailure(
          details,
          "receipt_terminal_without_reentry",
          "receipt became terminal without solver re-entry for this intent",
        );
      }
      if (
        flag === "missing_followup_reasoning" &&
        !terminalReceiptAllowed &&
        !nonAnswerTerminal
      ) {
        pushHardFailure(
          details,
          "missing_followup_reasoning",
          "follow-up reasoning was required but not completed",
        );
      }
      if (
        flag === "terminal_authority_before_solver_completion" &&
        !terminalReceiptAllowed &&
        !staleRouteAuthorityPoisonSuppressed
      ) {
        pushHardFailure(
          details,
          "terminal_authority_before_solver_completion",
          "terminal authority was recorded before solver completion",
        );
      }
    }
    for (const flag of readStringArray(loopTrace?.short_circuit_risk_flags)) {
      if (flag === "route_contract_missing") {
        pushHardFailure(
          details,
          "route_contract_missing",
          "route product contract missing for hard source-target turn",
        );
      }
      if (flag === "hard_source_target_allowed_no_tool_direct") {
        pushHardFailure(
          details,
          "hard_source_target_allowed_no_tool_direct",
          "hard source-target allowed no_tool_direct",
        );
      }
      if (
        flag === "poison_clean_but_authority_failed" &&
        !terminalReceiptAllowed &&
        !staleRouteAuthorityPoisonSuppressed
      ) {
        pushHardFailure(
          details,
          "poison_clean_but_authority_failed",
          "poison audit was clean while route authority failed",
        );
      }
      if (flag === "terminal_selected_before_observation_finalizer") {
        pushHardFailure(
          details,
          "terminal_authority_before_solver_completion",
          "terminal artifact was selected before solver finalization",
        );
      }
    }
    if (
      !trace.route_authority_ok &&
      !terminalReceiptAllowed &&
      !nonAnswerTerminal &&
      !staleRouteAuthorityPoisonSuppressed
    ) {
      if (trace.poison_audit_ok) {
        pushHardFailure(
          details,
          "poison_clean_but_authority_failed",
          "poison audit passed but route authority failed",
        );
      } else {
        pushHardFailure(
          details,
          "terminal_authority_before_solver_completion",
          "route authority failed before terminal completion",
        );
      }
    }
  }

  if (
    hardSourceTarget &&
    (!routeContract ||
      readString(routeContract.schema) !== "helix.route_product_contract.v1")
  ) {
    pushHardFailure(
      details,
      "route_contract_missing",
      "hard source-target turn lacks helix.route_product_contract.v1",
    );
  }
  if (
    hardSourceTarget &&
    canonicalGoalKind !== "note_mutation" &&
    (sourceTarget?.allow_no_tool_direct === true ||
      readString(input.payload.terminal_artifact_kind) === "no_tool_direct" ||
      readString(input.payload.final_answer_source) === "no_tool_direct")
  ) {
    pushHardFailure(
      details,
      "hard_source_target_allowed_no_tool_direct",
      "hard source-target cannot use no_tool_direct",
    );
  }
  const liveSourceIdentityAudit = readRecord(
    input.payload.live_source_identity_audit,
  );
  if (
    hardSourceTarget &&
    !nonAnswerTerminal &&
    !(
      traceTerminalArtifactKind === "live_environment_binding_diagnosis" ||
      readString(input.payload.terminal_artifact_kind) ===
        "live_environment_binding_diagnosis"
    ) &&
    readString(liveSourceIdentityAudit?.schema) ===
      "helix.live_source_identity_audit.v1" &&
    liveSourceIdentityAudit?.identity_ok === false
  ) {
    const diagnosis =
      readString(liveSourceIdentityAudit.diagnosis) ?? "identity_unresolved";
    pushHardFailure(
      details,
      "terminal_authority_before_solver_completion",
      `live-source identity must reconcile before terminal authority (${diagnosis})`,
    );
  }
  if (
    !typedFailureTerminal &&
    routeAuthority?.route_authority_ok === false &&
    readRecord(input.payload.poison_audit)?.ok === true &&
    !terminalReceiptAllowed &&
    !staleRouteAuthorityPoisonSuppressed
  ) {
    pushHardFailure(
      details,
      "poison_clean_but_authority_failed",
      "clean poison audit cannot override failed route authority",
    );
  }
  if (
    !typedFailureTerminal &&
    routeAuthority?.primary_violation_code === "route_contract_missing"
  ) {
    pushHardFailure(
      details,
      "route_contract_missing",
      "route authority audit reported a missing route product contract",
    );
  }
  if (
    !typedFailureTerminal &&
    routeAuthority?.primary_violation_code ===
      "no_tool_direct_used_for_hard_source_target" &&
    canonicalGoalKind !== "note_mutation"
  ) {
    pushHardFailure(
      details,
      "hard_source_target_allowed_no_tool_direct",
      "route authority audit reported no_tool_direct for hard source-target",
    );
  }
  const compoundCoverageGate = readRecord(
    input.payload.compound_prompt_coverage_gate ??
      trace?.compound_prompt_coverage_gate,
  );
  const modelOnlyCompoundCoverage = readRecord(
    input.payload.model_only_compound_coverage_from_answer ??
      trace?.model_only_compound_coverage_from_answer,
  );
  if (
    !typedFailureTerminal &&
    readString(compoundCoverageGate?.schema) ===
      "helix.compound_prompt_coverage_gate.v1" &&
    compoundCoverageGate?.applies === true &&
    compoundCoverageGate?.passed !== true &&
    !(
      readString(modelOnlyCompoundCoverage?.schema) ===
        "helix.model_only_compound_coverage_from_answer.v1" &&
      modelOnlyCompoundCoverage?.passed === true &&
      readString(modelOnlyCompoundCoverage?.route_scope) ===
        "model_only_allowed"
    )
  ) {
    pushHardFailure(
      details,
      "compound_prompt_coverage_incomplete",
      "required compound prompt items were not resolved before terminal authority",
    );
  }
  const repoConceptDetection = readRecord(trace?.repo_concept_detection);
  const repoConceptRequiresEvidence =
    repoConceptDetection?.require_repo_evidence === true;
  const repoEvidenceSelected = (
    Array.isArray(trace?.evidence_results) ? trace.evidence_results : []
  )
    .map((entry) => readRecord(entry))
    .some(
      (entry) =>
        readString(entry?.source_kind) === "repo_code" &&
        entry?.selected_for_answer === true,
    );
  const modelDirectTerminal =
    readString(input.payload.terminal_artifact_kind) === "direct_answer_text" ||
    readString(input.payload.final_answer_source) === "model_direct_answer" ||
    traceTerminalArtifactKind === "direct_answer_text" ||
    traceFinalAnswerSource === "model_direct_answer";
  if (
    !typedFailureTerminal &&
    repoConceptRequiresEvidence &&
    modelDirectTerminal &&
    !repoEvidenceSelected
  ) {
    pushHardFailure(
      details,
      "repo_evidence_required_before_answer",
      "project-internal concept answers require repo_code_evidence_observation before model.direct_answer can terminalize",
    );
  }

  const failureCodes = details.map((entry) => entry.code);
  return {
    schema: "helix.ask_turn_solver_hard_gate.v1",
    turn_id: input.turnId,
    applies,
    failed: applies && failureCodes.length > 0,
    failure_codes: failureCodes,
    primary_failure_code: failureCodes[0] ?? null,
    hard_source_target: hardSourceTarget,
    complex_prompt: complexPrompt,
    pure_control_or_status_receipt_allowed: terminalReceiptAllowed,
    failure_details: details,
    assistant_answer: false,
    raw_content_included: false,
  };
}

const collectRouteCandidatesForIntent = (
  payload: RecordLike,
  selectedRoute: string,
): HelixRouteCandidateForIntent[] => {
  const preflight = readRecord(payload.ask_turn_preflight_context);
  const candidates = Array.isArray(preflight?.route_candidates)
    ? preflight.route_candidates
    : [];
  const normalized = candidates
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry))
    .map((entry) => ({
      route: readString(entry.route) || "unknown",
      confidence: readNumber(entry.confidence),
      reason: readString(entry.reason) || null,
    }))
    .filter((entry) => entry.route !== "unknown");
  if (
    selectedRoute &&
    !normalized.some((entry) => entry.route === selectedRoute)
  ) {
    normalized.push({
      route: selectedRoute,
      confidence: null,
      reason: "selected_route",
    });
  }
  return normalized;
};

const collectCapabilityLaneObservationCapabilities = (
  payload: RecordLike,
): Set<string> => {
  const capabilities = new Set<string>();
  const addCapability = (value: unknown) => {
    const capability = readString(value);
    if (capability) capabilities.add(capability);
  };
  const addPacket = (entry: unknown) => {
    const record = readRecord(entry);
    if (!record) return;
    const nestedPayload = readRecord(record.payload);
    addCapability(record.capability_key);
    addCapability(nestedPayload?.capability_key);
  };
  const addPacketArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    value.forEach(addPacket);
  };
  addPacketArray(payload.capability_lane_observation_packets);
  const debug = readRecord(payload.debug);
  addPacketArray(debug?.capability_lane_observation_packets);
  const agentLoop = readRecord(payload.agent_loop);
  addPacketArray(agentLoop?.capability_lane_observation_packets);
  const runtimeLaneRequestLoop = readRecord(payload.runtime_lane_request_loop);
  addPacketArray(runtimeLaneRequestLoop?.capability_lane_observation_packets);
  const runtimeLaneRequestRetry = readRecord(
    payload.runtime_lane_request_retry,
  );
  addPacketArray(runtimeLaneRequestRetry?.capability_lane_observation_packets);
  const artifactLedger = Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
    : [];
  artifactLedger
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry))
    .forEach((entry) => {
      const nestedPayload = readRecord(entry.payload);
      const kind = readString(entry.kind);
      const payloadSchema =
        readString(entry.payload_schema) || readString(nestedPayload?.schema);
      if (
        kind !== "capability_lane_observation_packet" &&
        payloadSchema !== "helix.agent_step_observation_packet.v1"
      ) {
        return;
      }
      addCapability(entry.capability_key);
      addCapability(nestedPayload?.capability_key);
    });
  return capabilities;
};

const buildToolAdmissions = (
  payload: RecordLike,
  loopTrace: HelixLoopParityTrace | RecordLike | null,
  toolUseRestatement?: ToolUseRestatementV1 | null,
): HelixAskTurnSolverTrace["tool_admission_candidates"] => {
  const committedRoute = readCommittedAskRoute(payload);
  const admittedFamilies = readStringArray(
    readRecord(payload.tool_call_admission_decision)?.admitted_tool_families,
  );
  const chosenCapability = readString(
    readRecord(payload.agent_step_decision)?.chosen_capability,
  );
  const capabilityLaneObservationCapabilities =
    collectCapabilityLaneObservationCapabilities(payload);
  const actualCalls = (
    Array.isArray(loopTrace?.actual_tool_calls)
      ? loopTrace.actual_tool_calls
      : []
  )
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry));
  const candidates = new Map<
    string,
    HelixAskTurnSolverTrace["tool_admission_candidates"][number]
  >();
  for (const family of committedRoute?.capability_policy
    .allowed_tool_families ?? []) {
    candidates.set(`committed-family:${family}`, {
      tool_family: family,
      admitted: true,
      mutating: toolFamilyMutating(family),
      reason: "allowed_by_committed_ask_route",
    });
  }
  for (const family of committedRoute?.capability_policy
    .suppressed_tool_families ?? []) {
    candidates.set(`committed-suppressed-family:${family}`, {
      tool_family: family,
      admitted: false,
      mutating: toolFamilyMutating(family),
      reason: "suppressed_by_committed_ask_route",
    });
  }
  for (const family of admittedFamilies) {
    if (
      committedRoute?.capability_policy.suppressed_tool_families.includes(
        family,
      )
    )
      continue;
    candidates.set(`family:${family}`, {
      tool_family: family,
      admitted: true,
      mutating: toolFamilyMutating(family),
      reason: "admitted_by_tool_call_admission_decision",
    });
  }
  for (const family of toolUseRestatement?.requiredToolFamilies ?? []) {
    if (
      committedRoute?.capability_policy.suppressed_tool_families.includes(
        family,
      )
    )
      continue;
    candidates.set(`restatement-family:${family}`, {
      tool_family: family,
      admitted: true,
      mutating: toolFamilyMutating(family),
      reason: "required_by_tool_use_restatement",
    });
  }
  for (const call of actualCalls) {
    const toolId =
      readString(call.tool_id) ||
      readString(call.tool_name) ||
      readString(call.capability);
    const family = readString(call.family) || inferToolFamily(toolId);
    const admittedByFamily = admittedFamilies.includes(family);
    const admittedByChosenCapability = Boolean(
      chosenCapability && toolId && chosenCapability === toolId,
    );
    const admittedByCapabilityLaneObservation = Boolean(
      toolId && capabilityLaneObservationCapabilities.has(toolId),
    );
    const admitted =
      call.admitted === true ||
      admittedByFamily ||
      admittedByChosenCapability ||
      admittedByCapabilityLaneObservation;
    candidates.set(`tool:${toolId || family}`, {
      tool_family: family,
      tool_id: toolId || undefined,
      admitted,
      mutating: call.mutating === true,
      reason: admitted
        ? admittedByChosenCapability
          ? "actual_tool_call_matched_agent_step_decision"
          : admittedByCapabilityLaneObservation
            ? "actual_tool_call_matched_capability_lane_observation"
            : "actual_tool_call_matched_admission"
        : "actual_tool_call_missing_admission",
    });
  }
  return Array.from(candidates.values());
};

const isRepoCodeEvidenceArtifact = (entry: RecordLike): boolean => {
  const payload = readRecord(entry.payload);
  const searchable = [
    readString(entry.kind),
    readString(payload?.kind),
    readString(payload?.schema),
    readString(payload?.source_kind),
  ].join(" ");
  return /repo_code_evidence_observation|helix\.repo_code_evidence_observation\.v1|repo_code/i.test(
    searchable,
  );
};

const buildEvidenceResults = (
  loopTrace: HelixLoopParityTrace | RecordLike | null,
  payload: RecordLike,
): HelixAskTurnSolverTrace["evidence_results"] => {
  const observations = (
    Array.isArray(loopTrace?.observations_created)
      ? loopTrace.observations_created
      : []
  )
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry));
  const selected = new Set([
    ...readStringArray(loopTrace?.evidence_selected_for_answer),
    ...collectCompoundSynthesisSupportRefs(payload),
  ]);
  const rejected = (
    Array.isArray(loopTrace?.evidence_rejected_for_answer)
      ? loopTrace.evidence_rejected_for_answer
      : []
  )
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry));
  const results: HelixAskTurnSolverTrace["evidence_results"] = observations.map(
    (observation) => {
      const id =
        readString(observation.observation_id) || "unknown_observation";
      return {
        result_id: id,
        source_kind: readString(observation.source_kind) || "observation",
        selected_for_answer: selected.has(id),
      };
    },
  );
  for (const ref of selected) {
    if (!results.some((entry) => entry.result_id === ref)) {
      results.push({
        result_id: ref,
        source_kind: "selected_evidence_ref",
        selected_for_answer: true,
      });
    }
  }
  for (const entry of rejected) {
    const ref = readString(entry.ref) || "unknown_rejected_ref";
    results.push({
      result_id: ref,
      source_kind: "rejected_evidence_ref",
      selected_for_answer: false,
      rejected_reason: readString(entry.reason) || "rejected",
    });
  }
  const ledgerRepoArtifacts = (
    Array.isArray(payload.current_turn_artifact_ledger)
      ? payload.current_turn_artifact_ledger
      : []
  )
    .map((entry) => readRecord(entry))
    .filter(
      (entry): entry is RecordLike =>
        Boolean(entry) && isRepoCodeEvidenceArtifact(entry),
    );
  for (const artifact of ledgerRepoArtifacts) {
    const artifactId =
      readString(artifact.artifact_id) ||
      readString(readRecord(artifact.payload)?.artifact_id);
    if (!artifactId || results.some((entry) => entry.result_id === artifactId))
      continue;
    const artifactPayload = readRecord(artifact.payload);
    results.push({
      result_id: artifactId,
      source_kind: "repo_code",
      selected_for_answer: artifactPayload?.selected_for_answer !== false,
    });
  }
  return results;
};

const buildRiskFlags = (input: {
  payload: RecordLike;
  loopTrace: HelixLoopParityTrace | RecordLike | null;
  sourceTarget: string;
  selectedRoute: string;
  terminalArtifactKind: string;
  finalAnswerSource: string;
  primary: HelixAskTurnIntentKind;
  secondary: HelixAskTurnIntentKind[];
  contextualToolMentions: HelixPromptInterpretation["contextual_tool_mentions"];
  contextualToolAudit: HelixAskTurnSolverTrace["contextual_tool_audit"];
  negativeConstraints: string[];
  actualToolCalls: RecordLike[];
  evidenceReentryRequired: boolean;
  evidenceReentryCompleted: boolean;
  followupRequired: boolean;
  followupCompleted: boolean;
  finalArbitrationRan: boolean;
  routeAuthorityOk: boolean;
  terminalAuthorityOk: boolean;
  evidenceReentryViolationCodes: string[];
  followupReasoningRequired: boolean;
  followupReasoningCompleted: boolean;
  liveSourceIdentityAuditPresent: boolean;
  liveSourceIdentityOk: boolean;
  liveSourceIdentityTerminalAllowed: boolean;
  routeApprovedSelfTerminalProduct: boolean;
}): HelixAskTurnSolverRiskFlag[] => {
  const actualToolIds = input.actualToolCalls
    .map((entry) => readString(entry.tool_id))
    .filter(Boolean);
  const mutatingToolExecuted = input.actualToolCalls.some(
    (entry) => entry.mutating === true,
  );
  const routeCandidates = readStringArray(
    readRecord(input.payload.ask_turn_preflight_context)
      ?.route_candidate_labels,
  );
  const canonicalTerminalAllowed =
    terminalAllowedByCanonicalOrCompliantConstraintPolicy({
      payload: input.payload,
      terminalArtifactKind: input.terminalArtifactKind,
      finalAnswerSource: input.finalAnswerSource,
      contextualToolMentions: input.contextualToolMentions,
      contextualToolAudit: input.contextualToolAudit,
      negativeConstraints: input.negativeConstraints,
      actualToolCalls: input.actualToolCalls,
    });
  return unique(
    [
      !readRecord(input.payload.source_target_intent) &&
      routeCandidates.length > 0
        ? "classifier_became_decision"
        : null,
      !input.primary && input.selectedRoute !== "unknown"
        ? "route_selected_before_intent_arbitration"
        : null,
      input.evidenceReentryViolationCodes.includes(
        "receipt_terminal_without_reentry",
      )
        ? "receipt_terminal_without_reentry"
        : null,
      actualToolIds.length > 0 &&
      input.followupRequired &&
      !input.followupCompleted
        ? "tool_result_terminal_without_reasoning"
        : null,
      input.contextualToolAudit.blocked_contextual_tool_executed
        ? "blocked_contextual_tool_executed"
        : null,
      input.negativeConstraints.length > 0 &&
      (mutatingToolExecuted || /receipt/i.test(input.finalAnswerSource))
        ? "negative_constraint_ignored"
        : null,
      input.secondary.length > 0 &&
      input.primary === "control_command" &&
      /content|situation_context|procedure/i.test(input.selectedRoute)
        ? "primary_secondary_intent_collapsed"
        : null,
      input.followupReasoningRequired && !input.followupReasoningCompleted
        ? "missing_followup_reasoning"
        : null,
      input.terminalAuthorityOk &&
      input.terminalArtifactKind !== "typed_failure" &&
      input.terminalArtifactKind !== "request_user_input" &&
      input.finalAnswerSource !== "typed_failure" &&
      input.finalAnswerSource !== "request_user_input" &&
      !canonicalTerminalAllowed &&
      !input.routeApprovedSelfTerminalProduct &&
      (!input.finalArbitrationRan ||
        !input.routeAuthorityOk ||
        (input.liveSourceIdentityAuditPresent &&
          !input.liveSourceIdentityOk &&
          !input.liveSourceIdentityTerminalAllowed))
        ? "terminal_authority_before_solver_completion"
        : null,
    ].filter((entry): entry is HelixAskTurnSolverRiskFlag => Boolean(entry)),
  );
};

export function buildAskTurnSolverTrace(input: {
  turnId: string;
  promptText: string;
  selectedRoute: string;
  terminalArtifactKind: string | null | undefined;
  finalAnswerSource: string | null | undefined;
  payload: RecordLike;
  loopParityTrace?: HelixLoopParityTrace | RecordLike | null;
}): HelixAskTurnSolverTrace {
  const promptText = input.promptText;
  const authoritativeWorkstationTerminal =
    resolveAuthoritativeWorkstationToolTerminal(input.payload);
  if (authoritativeWorkstationTerminal) {
    input.payload.terminal_artifact_kind =
      authoritativeWorkstationTerminal.terminalArtifactKind;
    input.payload.final_answer_source =
      authoritativeWorkstationTerminal.finalAnswerSource;
  }
  const terminalArtifactKind =
    authoritativeWorkstationTerminal?.terminalArtifactKind ??
    (readString(input.terminalArtifactKind) || "unknown");
  const finalAnswerSource =
    authoritativeWorkstationTerminal?.finalAnswerSource ??
    (readString(input.finalAnswerSource) || "unknown");
  const deterministicPreflightTypedFailure =
    terminalArtifactKind === "typed_failure" &&
    finalAnswerSource === "typed_failure" &&
    readBoolean(
      readRecord(input.payload.canonical_goal_frame)
        ?.deterministic_preflight_terminal,
    );
  const authoritativeZeroObservationTypedFailure =
    terminalArtifactKind === "typed_failure" &&
    finalAnswerSource === "typed_failure" &&
    readBoolean(
      readRecord(input.payload.canonical_goal_frame)
        ?.authoritative_zero_observation_typed_failure,
    );
  const settledZeroObservationTypedFailure =
    deterministicPreflightTypedFailure ||
    authoritativeZeroObservationTypedFailure;
  const settledAuthoritativeTypedFailure =
    settledZeroObservationTypedFailure ||
    authoritativeTypedFailureRequiresNoContinuation(input.payload);
  const loopTrace = (input.loopParityTrace ??
    readRecord(input.payload.loop_parity_trace)) as
    HelixLoopParityTrace | RecordLike | null;
  const sourceTargetInfo = sourceTargetFromPayload(input.payload);
  const promptInterpretation = interpretHelixAskPrompt(promptText);
  const toolUseRestatement = buildToolUseRestatement(promptText);
  const repoConceptDetection = detectRepoConcept(promptText);
  const repoConceptRequiresEvidence =
    repoConceptDetection.require_repo_evidence === true;
  const compoundContract = promptInterpretation.compound_contract;
  const finalAnswerText =
    readString(input.payload.selected_final_answer) ||
    readString(input.payload.answer) ||
    readString(input.payload.text);
  const compoundCoverage = compoundContract
    ? buildCompoundPromptCoverage(compoundContract, finalAnswerText)
    : null;
  const compoundCoverageGate = readRecord(
    input.payload.compound_prompt_coverage_gate,
  ) as HelixCompoundPromptCoverageGate | null;
  const routeCandidatesForIntent = collectRouteCandidatesForIntent(
    input.payload,
    input.selectedRoute,
  );
  const terminalProductsAllowed = allowedTerminalProducts(input.payload);
  const terminalProductsForbidden = forbiddenTerminalProducts(input.payload);
  const intentHypotheses = buildHelixIntentHypotheses({
    promptText,
    promptInterpretation,
    selectedRoute: input.selectedRoute,
    sourceTarget: sourceTargetInfo.sourceTarget,
    routeCandidates: routeCandidatesForIntent,
    terminalProductsAllowed,
    terminalProductsForbidden,
  });
  const intentArbitration = arbitrateHelixIntent({
    promptInterpretation,
    hypotheses: intentHypotheses,
    routeCandidates: routeCandidatesForIntent,
    terminalProductsAllowed,
    terminalProductsForbidden,
  });
  const primary = intentArbitration.selected_primary_intent_kind;
  const secondary = intentArbitration.secondary_intent_ids
    .map((id) => intentHypotheses.find((entry) => entry.id === id)?.kind)
    .filter((kind): kind is HelixAskTurnIntentKind => Boolean(kind));
  const committedAskRoute = buildCommittedAskRoute({
    turnId: input.turnId,
    promptText,
    selectedRoute: input.selectedRoute,
    payload: input.payload,
    promptInterpretation,
    intentArbitration,
    secondaryIntentKinds: secondary,
  });
  input.payload.committed_ask_route = committedAskRoute;
  appendRuntimeIntentPacketForSolver({
    payload: input.payload,
    turnId: input.turnId,
    promptText,
  });
  const committedRouteCompatibility = evaluateCommittedAskRouteCompatibility({
    committedRoute: committedAskRoute,
    payload: input.payload,
  });
  const routeEvidenceAuthority = buildRouteEvidenceAuthority({
    committedRoute: committedAskRoute,
    payload: input.payload,
  });
  input.payload.route_evidence_authority = routeEvidenceAuthority;
  const effectiveSourceTargetInfo = {
    sourceTarget: committedAskRoute.route.source_target,
    targetKind: committedAskRoute.route.target_kind,
    reason: committedAskRoute.route.route_reason,
    strength: committedAskRoute.route.strength,
  };
  const routeApprovedSelfTerminalProduct =
    committedAskRoute.terminal_product.followup_reasoning_required === false &&
    committedAskRoute.terminal_product.required_terminal_product ===
      terminalArtifactKind &&
    committedAskRoute.canonical_goal.allowed_terminal_artifact_kinds.includes(
      terminalArtifactKind,
    ) &&
    helixTerminalKindIsSelfTerminal(terminalArtifactKind);
  const evidenceRequired =
    sourceRequiresEvidence(effectiveSourceTargetInfo.sourceTarget) ||
    repoConceptRequiresEvidence ||
    toolUseRestatement.requiredToolFamilies.includes("internet_search");
  const evidenceResults = buildEvidenceResults(loopTrace, input.payload);
  const repoEvidenceResultSelected = evidenceResults.some(
    (entry) => entry.source_kind === "repo_code" && entry.selected_for_answer,
  );
  const liveSourceIdentityAudit = readRecord(
    input.payload.live_source_identity_audit,
  ) as HelixLiveSourceIdentityAudit | null;
  const liveSourceIdentityAuditRef =
    readString(liveSourceIdentityAudit?.audit_id) || null;
  const verifiedRuntimeLifecycle = readVerifiedHelixRuntimeLifecycleFromPayload(
    {
      payload: input.payload,
      turnId: input.turnId,
    },
  );
  const runtimeLifecycleCycleCompleted = Boolean(
    verifiedRuntimeLifecycle?.reduction.runtime_turn_completed &&
    verifiedRuntimeLifecycle.reduction.final_agent_message_event_id,
  );
  const runtimeObservationReentryRefs = runtimeLifecycleCycleCompleted
    ? (verifiedRuntimeLifecycle?.reduction.observation_reentry_refs ?? [])
    : [];
  const runtimePostObservationReasoningCompleted =
    runtimeLifecycleCycleCompleted
      ? verifiedRuntimeLifecycle?.reduction.post_observation_reasoning_completed
      : undefined;
  const finalArbitrationRan = Boolean(
    (readRecord(input.payload.route_authority_audit) ||
      readBoolean(loopTrace?.route_authority_ok)) &&
    readRecord(input.payload.poison_audit) &&
    readRecord(input.payload.terminal_answer_authority),
  );
  const capabilityHelpFinalArbitrationMaterialized =
    capabilityHelpTerminalPathMaterialized({
      payload: input.payload,
      terminalArtifactKind,
      finalAnswerSource,
    });
  const compoundFinalArbitrationMaterialized =
    compoundSynthesisTerminalPathMaterialized({
      payload: input.payload,
      terminalArtifactKind,
      finalAnswerSource,
    });
  const providerFinalArbitrationMaterialized = providerTerminalPathMaterialized(
    {
      payload: input.payload,
      turnId: input.turnId,
      terminalArtifactKind,
      finalAnswerSource,
      runtimeSolverCompletionObserved:
        runtimeLifecycleCycleCompleted &&
        runtimePostObservationReasoningCompleted === true,
    },
  );
  const providerReasoningReentry = readRecord(
    input.payload.provider_reasoning_reentry,
  );
  const providerProjectionCompletesReasoning =
    providerFinalArbitrationMaterialized &&
    readString(providerReasoningReentry?.schema) ===
      "helix.provider_reasoning_reentry.v1" &&
    readString(providerReasoningReentry?.turn_id) === input.turnId &&
    readString(providerReasoningReentry?.status) === "completed" &&
    readBoolean(providerReasoningReentry?.evidence_reentered) === true &&
    readBoolean(providerReasoningReentry?.solver_completed) === true &&
    readBoolean(providerReasoningReentry?.goal_satisfaction_compatible) ===
      true;
  const providerObservationReentryRefs = providerProjectionCompletesReasoning
    ? readStringArray(providerReasoningReentry?.normalized_observation_refs)
    : [];
  // The runtime log records the exact gateway artifact IDs while the verified
  // provider bridge can add normalized aliases derived from those observations.
  // Both identities belong to the same completed current-turn re-entry.
  const effectiveObservationReentryRefs = unique([
    ...runtimeObservationReentryRefs,
    ...(runtimePostObservationReasoningCompleted === true
      ? providerObservationReentryRefs
      : []),
  ]);
  const effectivePostObservationReasoningCompleted =
    runtimePostObservationReasoningCompleted === true;
  const effectiveReentryAuthority =
    runtimePostObservationReasoningCompleted === true
      ? ("runtime_event_log" as const)
      : verifiedRuntimeLifecycle
        ? ("runtime_event_log" as const)
        : ("compatibility_projection" as const);
  const effectiveFinalArbitrationRan =
    finalArbitrationRan ||
    routeApprovedSelfTerminalProduct ||
    capabilityHelpFinalArbitrationMaterialized ||
    compoundFinalArbitrationMaterialized ||
    providerFinalArbitrationMaterialized;
  const evidenceReentryGate = buildEvidenceReentryGate({
    turnId: input.turnId,
    payload: input.payload,
    loopTrace,
    primaryIntent: primary,
    terminalArtifactKind,
    finalAnswerSource,
    finalArbitrationRan: effectiveFinalArbitrationRan,
    runtimeLifecycleVerified: Boolean(verifiedRuntimeLifecycle),
    reentryAuthority: effectiveReentryAuthority,
    runtimeObservationReentryRefs: effectiveObservationReentryRefs,
    postEvidenceReasoningCompleted: effectivePostObservationReasoningCompleted,
    sourceEvidenceRequired: evidenceRequired,
    allowedTerminalProducts:
      committedAskRoute.canonical_goal.allowed_terminal_artifact_kinds,
    toolUseRestatement,
  });
  const followupReasoningGate = buildFollowupReasoningGate({
    turnId: input.turnId,
    primaryIntent: primary,
    secondaryIntentKinds: secondary,
    sourceTarget: effectiveSourceTargetInfo.sourceTarget,
    terminalArtifactKind,
    selectedEvidenceCount: evidenceReentryGate.selected_evidence_refs.length,
    conflictingHypotheses: intentHypotheses.length > 1 && secondary.length > 0,
    finalArbitrationRan: effectiveFinalArbitrationRan,
    postEvidenceReasoningCompleted: effectivePostObservationReasoningCompleted,
    routeFollowupReasoningRequired: routeApprovedSelfTerminalProduct
      ? false
      : undefined,
  });
  const verifiedRouteApprovedSelfTerminalProduct =
    routeApprovedSelfTerminalProduct &&
    committedRouteCompatibility.compatible &&
    Boolean(verifiedRuntimeLifecycle) &&
    runtimeLifecycleCycleCompleted &&
    evidenceReentryGate.completed &&
    readBoolean(
      readRecord(input.payload.terminal_answer_authority)?.server_authoritative,
    );
  const routeAuthorityOk =
    readBoolean(loopTrace?.route_authority_ok) ||
    readBoolean(
      readRecord(input.payload.route_authority_audit)?.route_authority_ok,
    ) ||
    verifiedRouteApprovedSelfTerminalProduct ||
    compoundFinalArbitrationMaterialized ||
    providerFinalArbitrationMaterialized;
  const poisonAuditOk =
    readBoolean(loopTrace?.poison_audit_ok) ||
    readBoolean(readRecord(input.payload.poison_audit)?.ok) ||
    verifiedRouteApprovedSelfTerminalProduct ||
    compoundFinalArbitrationMaterialized;
  const terminalAuthorityOk =
    readBoolean(loopTrace?.terminal_authority_ok) ||
    readBoolean(
      readRecord(input.payload.terminal_answer_authority)?.server_authoritative,
    );
  const goalSatisfaction = readRecord(
    input.payload.goal_satisfaction_evaluation,
  );
  const routeAuthorizedReceiptTerminalAllowed =
    /receipt/i.test(terminalArtifactKind) &&
    routeAuthorityOk &&
    poisonAuditOk &&
    terminalAuthorityOk &&
    readString(goalSatisfaction?.satisfaction) === "satisfied" &&
    readString(goalSatisfaction?.next_decision) === "allow_terminal" &&
    terminalMatchesCanonicalGoalContract(input.payload, terminalArtifactKind);
  const effectiveEvidenceReentryGate: typeof evidenceReentryGate =
    settledAuthoritativeTypedFailure
      ? {
          ...evidenceReentryGate,
          required: false,
          completed: true,
          violation_codes: [],
        }
      : evidenceReentryGate;
  const effectiveFollowupReasoningGate: typeof followupReasoningGate =
    routeAuthorizedReceiptTerminalAllowed || settledAuthoritativeTypedFailure
      ? {
          schema: followupReasoningGate.schema,
          turn_id: followupReasoningGate.turn_id,
          required: false,
          completed: true,
          reason: deterministicPreflightTypedFailure
            ? "deterministic_preflight_terminal"
            : settledAuthoritativeTypedFailure
              ? "authoritative_typed_failure_no_continuation"
              : "simple_no_source_turn",
          assistant_answer: false,
          raw_content_included: false,
        }
      : followupReasoningGate;
  const finalTraceTerminalArtifactKind =
    repoConceptRequiresEvidence &&
    repoEvidenceResultSelected &&
    /repo_code_evidence_answer|repo_entity_definition|repo_code_evidence_observation/i.test(
      terminalArtifactKind,
    )
      ? "repo_code_evidence_answer"
      : terminalArtifactKind;
  const finalTraceAnswerSource =
    repoConceptRequiresEvidence &&
    repoEvidenceResultSelected &&
    finalTraceTerminalArtifactKind === "repo_code_evidence_answer"
      ? "model_synthesis_from_repo_evidence"
      : finalAnswerSource;
  const actualToolCalls = (
    Array.isArray(loopTrace?.actual_tool_calls)
      ? loopTrace.actual_tool_calls
      : []
  )
    .map((entry) => readRecord(entry))
    .filter((entry): entry is RecordLike => Boolean(entry));
  const contextualToolAudit = buildContextualToolAudit({
    payload: input.payload,
    contextualToolMentions: promptInterpretation.contextual_tool_mentions,
    actualToolCalls,
    unexpectedToolCalls: readStringArray(loopTrace?.unexpected_tool_calls),
  });
  const canonicalTerminalAllowed =
    terminalAllowedByCanonicalOrCompliantConstraintPolicy({
      payload: input.payload,
      terminalArtifactKind,
      finalAnswerSource,
      contextualToolMentions: promptInterpretation.contextual_tool_mentions,
      contextualToolAudit,
      negativeConstraints: promptInterpretation.negative_constraints,
      actualToolCalls,
    });
  const liveSourceIdentityOk =
    !liveSourceIdentityAudit || liveSourceIdentityAudit.identity_ok === true;
  const liveSourceIdentityTerminalAllowed =
    terminalArtifactKind === "live_environment_binding_diagnosis" ||
    terminalArtifactKind === "live_source_typed_failure" ||
    terminalArtifactKind === "source_binding_status" ||
    terminalArtifactKind === "source_binding_repair_candidate" ||
    terminalArtifactKind === "typed_failure" ||
    finalAnswerSource === "typed_failure";
  const solverRiskFlags = buildRiskFlags({
    payload: input.payload,
    loopTrace,
    sourceTarget: effectiveSourceTargetInfo.sourceTarget,
    selectedRoute: input.selectedRoute,
    terminalArtifactKind,
    finalAnswerSource,
    primary,
    secondary,
    contextualToolMentions: promptInterpretation.contextual_tool_mentions,
    contextualToolAudit,
    negativeConstraints: promptInterpretation.negative_constraints,
    actualToolCalls,
    evidenceReentryRequired: effectiveEvidenceReentryGate.required,
    evidenceReentryCompleted: effectiveEvidenceReentryGate.completed,
    followupRequired: effectiveFollowupReasoningGate.required,
    followupCompleted: effectiveFollowupReasoningGate.completed,
    finalArbitrationRan: effectiveFinalArbitrationRan,
    routeAuthorityOk,
    terminalAuthorityOk,
    evidenceReentryViolationCodes: effectiveEvidenceReentryGate.violation_codes,
    followupReasoningRequired: effectiveFollowupReasoningGate.required,
    followupReasoningCompleted: effectiveFollowupReasoningGate.completed,
    liveSourceIdentityAuditPresent: Boolean(liveSourceIdentityAudit),
    liveSourceIdentityOk,
    liveSourceIdentityTerminalAllowed,
    routeApprovedSelfTerminalProduct,
  });
  const completedSolverPath =
    effectiveFinalArbitrationRan &&
    (routeAuthorityOk || canonicalTerminalAllowed) &&
    poisonAuditOk &&
    terminalAuthorityOk &&
    (liveSourceIdentityOk ||
      terminalArtifactKind === "live_environment_binding_diagnosis" ||
      finalAnswerSource === "live_environment_binding_diagnosis") &&
    effectiveEvidenceReentryGate.completed &&
    effectiveFollowupReasoningGate.completed &&
    solverRiskFlags.length === 0;

  return {
    schema: "helix.ask_turn_solver_trace.v1",
    trace_id: `ask-turn-solver:${hashShort([input.turnId, promptText, input.selectedRoute, terminalArtifactKind])}`,
    turn_id: input.turnId,
    prompt_hash: hashShort(promptText),
    prompt_interpretation: promptInterpretation,
    tool_use_restatement: toolUseRestatement,
    ...(repoConceptDetection.applies
      ? { repo_concept_detection: repoConceptDetection }
      : {}),
    ...(compoundContract ? { compound_prompt_contract: compoundContract } : {}),
    ...(compoundCoverage ? { compound_prompt_coverage: compoundCoverage } : {}),
    ...(compoundCoverageGate
      ? { compound_prompt_coverage_gate: compoundCoverageGate }
      : {}),
    committed_ask_route: committedAskRoute,
    route_evidence_authority: routeEvidenceAuthority,
    committed_route_compatibility: committedRouteCompatibility,
    intent_hypotheses: intentHypotheses,
    intent_arbitration: intentArbitration,
    selected_primary_intent: primary,
    secondary_intents: secondary,
    source_admission_candidates:
      effectiveSourceTargetInfo.sourceTarget === "unknown"
        ? []
        : [
            {
              source_target: effectiveSourceTargetInfo.sourceTarget,
              admitted: true,
              reason: effectiveSourceTargetInfo.reason,
              evidence_required: evidenceRequired,
            },
          ],
    tool_admission_candidates: buildToolAdmissions(
      input.payload,
      loopTrace,
      toolUseRestatement,
    ),
    contextual_tool_audit: contextualToolAudit,
    evidence_requests: toolUseRestatement.requiredToolFamilies.includes(
      "internet_search",
    )
      ? [
          {
            request_id: `internet-search:${input.turnId}`,
            source_target: "internet_search",
            required: true,
            purpose: toolUseRestatement.currentAffairsRequired
              ? "Search-ground current-affairs claims before final answer"
              : "Search-ground freshness-sensitive claims before final answer",
          },
        ]
      : repoConceptRequiresEvidence
        ? [
            {
              request_id: `repo-concept:${input.turnId}`,
              source_target: "repo_code",
              required: true,
              purpose: "Explain project-internal concept from repo evidence",
            },
          ]
        : [
            {
              request_id: `evidence_request:${hashShort([input.turnId, effectiveSourceTargetInfo.sourceTarget, input.selectedRoute])}`,
              source_target: effectiveSourceTargetInfo.sourceTarget,
              required: evidenceReentryGate.required,
              purpose: evidenceReentryGate.required
                ? "provide source evidence before final arbitration"
                : "confirm terminal product contract without source evidence",
            },
          ],
    evidence_results: evidenceResults,
    evidence_reentry: {
      required: effectiveEvidenceReentryGate.required,
      completed: effectiveEvidenceReentryGate.completed,
      ...(effectiveEvidenceReentryGate.completed
        ? {}
        : {
            skipped_reason:
              "terminal_selection_missing_after_required_evidence",
          }),
    },
    evidence_reentry_gate: effectiveEvidenceReentryGate,
    followup_reasoning: {
      required: effectiveFollowupReasoningGate.required,
      completed: effectiveFollowupReasoningGate.completed,
      ...(effectiveFollowupReasoningGate.completed
        ? {}
        : {
            skipped_reason:
              effectiveFollowupReasoningGate.skipped_reason ??
              "final_arbitration_missing_after_evidence_or_tool_result",
          }),
    },
    followup_reasoning_gate: effectiveFollowupReasoningGate,
    ...(verifiedRuntimeLifecycle && runtimeLifecycleCycleCompleted
      ? {
          runtime_lifecycle_facts: {
            scope: verifiedRuntimeLifecycle.scope,
            integrity: "verified" as const,
            runtime_turn_completed:
              verifiedRuntimeLifecycle.reduction.runtime_turn_completed,
            observation_reentry_refs: runtimeObservationReentryRefs,
            post_observation_reasoning_completed:
              verifiedRuntimeLifecycle.reduction
                .post_observation_reasoning_completed,
            latest_reentry_event_id:
              verifiedRuntimeLifecycle.reduction.latest_reentry_event_id,
            final_agent_message_event_id:
              verifiedRuntimeLifecycle.reduction.final_agent_message_event_id,
          },
        }
      : {}),
    ...(liveSourceIdentityAudit
      ? {
          live_source_identity_audit: liveSourceIdentityAudit,
          live_source_identity_audit_ref: liveSourceIdentityAuditRef,
        }
      : {}),
    ...(readRecord(input.payload.capability_plan)?.schema ===
    "helix.capability_plan.v1"
      ? {
          capability_plan: input.payload.capability_plan as HelixCapabilityPlan,
        }
      : {}),
    ...(readRecord(input.payload.capability_result)?.schema ===
    "helix.capability_result.v1"
      ? {
          capability_result: input.payload
            .capability_result as HelixCapabilityResult,
        }
      : {}),
    ...(readRecord(input.payload.capability_lifecycle_ledger)?.schema ===
    "helix.capability_lifecycle_ledger.v1"
      ? {
          capability_lifecycle_ledger: input.payload
            .capability_lifecycle_ledger as HelixCapabilityLifecycleLedger,
        }
      : {}),
    ...(readRecord(input.payload.procedure_evidence_retrieval_plan)?.schema ===
    "helix.procedure_evidence_retrieval_plan.v1"
      ? {
          procedure_evidence_retrieval_plan: input.payload
            .procedure_evidence_retrieval_plan as HelixProcedureEvidenceRetrievalPlan,
        }
      : {}),
    ...(readRecord(input.payload.procedure_evidence_retrieval_result)
      ?.schema === "helix.procedure_evidence_retrieval_result.v1"
      ? {
          procedure_evidence_retrieval_result: input.payload
            .procedure_evidence_retrieval_result as HelixProcedureEvidenceRetrievalResult,
        }
      : {}),
    ...(readRecord(input.payload.solver_instruction_frame)?.schema ===
    "helix.solver_instruction_frame.v1"
      ? {
          solver_instruction_frame: input.payload
            .solver_instruction_frame as HelixSolverInstructionFrame,
        }
      : {}),
    ...(readRecord(input.payload.solver_artifact_reentry_audit)?.schema ===
    "helix.solver_artifact_reentry_audit.v1"
      ? {
          solver_artifact_reentry_audit: input.payload
            .solver_artifact_reentry_audit as HelixSolverArtifactReentryAudit,
        }
      : {}),
    ...(readRecord(input.payload.solver_subgoal_ledger)?.schema ===
    "helix.solver_subgoal_ledger.v1"
      ? {
          solver_subgoal_ledger: input.payload
            .solver_subgoal_ledger as HelixSolverSubgoalLedger,
        }
      : {}),
    ...(readRecord(input.payload.solver_retry_policy)?.schema ===
    "helix.solver_retry_policy.v1"
      ? {
          solver_retry_policy: input.payload
            .solver_retry_policy as HelixSolverRetryPolicy,
        }
      : {}),
    ...(Array.isArray(input.payload.solver_retry_policies)
      ? {
          solver_retry_policies: input.payload.solver_retry_policies
            .map((entry: unknown) => readRecord(entry))
            .filter(
              (entry: RecordLike | null): entry is RecordLike =>
                entry?.schema === "helix.solver_retry_policy.v1",
            ) as HelixSolverRetryPolicy[],
        }
      : {}),
    final_arbitration: {
      selected_route: input.selectedRoute,
      terminal_artifact_kind: finalTraceTerminalArtifactKind,
      final_answer_source: finalTraceAnswerSource,
      why_complete: completedSolverPath
        ? "route authority, poison audit, terminal authority, evidence re-entry, and follow-up reasoning gates completed"
        : "solver path recorded with missing or risky authority gates",
      remaining_uncertainty: solverRiskFlags,
    },
    route_authority_ok: routeAuthorityOk,
    poison_audit_ok: poisonAuditOk,
    terminal_authority_ok: terminalAuthorityOk,
    solver_risk_flags: solverRiskFlags,
    assistant_answer: false,
    raw_content_included: false,
    completed_solver_path: completedSolverPath,
    primary_intent:
      effectiveSourceTargetInfo.sourceTarget === "unknown"
        ? null
        : {
            intent_kind: primary,
            route: input.selectedRoute,
            source_target: effectiveSourceTargetInfo.sourceTarget,
            target_kind: effectiveSourceTargetInfo.targetKind,
            selection_reason: effectiveSourceTargetInfo.reason,
          },
    solver_short_circuit_flags: solverRiskFlags,
    hard_gate: readRecord(input.payload.solver_hard_gate) as
      HelixAskTurnSolverHardGate | undefined,
  };
}
