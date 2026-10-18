import type { HelixCapabilityFamily } from "@shared/helix-capability-plan";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
  type HelixContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import {
  explicitCapabilityContractForCapability,
  extractExplicitCapabilityContract,
  type ExplicitCapabilityContract,
} from "./explicit-capability-contract";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "./workstation-context-feed-query-tool-contracts";
import { resolveAuthoritativeLivePipelineRoute } from "./live-pipeline-route-authority";

type RecordLike = Record<string, unknown>;

export type AskCapabilityContractState =
  | "suppressed_contextual_reference"
  | "conversational_referent_no_evidence"
  | "authoritative_live_pipeline_contract"
  | "explicit_capability_command"
  | "hard_live_source_phase"
  | "classifier_hypothesis"
  | "model_only";

export type AskCapabilityContractArbitration = {
  schema: "helix.ask_capability_contract_arbitration.v1";
  turn_id: string;
  contract_state: AskCapabilityContractState;
  requested_capability: string | null;
  selected_source_target: string;
  selected_plan_family: HelixCapabilityFamily;
  canonical_goal_kind: string;
  required_observation_kinds: string[];
  required_terminal_kind: string | null;
  allow_phase_repair: boolean;
  route_metadata_demoted: boolean;
  demotion_reason?: string;
  failure_code_if_incompatible?: string;
  assistant_answer: false;
  raw_content_included: false;
};

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
};

const isLiveSourceMailboxGoalKind = (value: string | null | undefined): boolean =>
  /^(?:live_source_processed_mail_interpretation|live_source_mailbox_review|live_environment_review|processed_mail_interpretation|processed_mail_voice_decision)$/.test(
    String(value ?? "").trim(),
  );

const LIVE_ENVIRONMENT_OPERATOR_CAPABILITIES = new Set([
  ...WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS.map((spec) => spec.capability),
  "live_env.query_workstation_goal_context",
  "live_env.reflect_stage_play_context",
  "live_env.narrator_say",
  "live_env.narrator_bind_stream",
  "live_env.apply_micro_reasoner_preset",
  "live_env.create_micro_reasoner_preset",
  "live_env.update_micro_reasoner_prompt",
  "live_env.test_micro_reasoner_prompt",
  "live_env.read_card",
  "live_env.query_event_log",
  "live_env.query_world_events",
  "live_env.query_navigation_state",
  "live_env.plan_stage_play_job",
  "live_env.configure_visual_observer_profile",
  "live_env.apply_visual_observer_profile",
  "live_env.query_visual_observer_profiles",
  "live_env.test_visual_observer_profile",
  "live_env.compare_visual_observer_profiles",
  "live_env.request_visual_action_replay",
  "live_env.configure_interpreter_profile",
  "live_env.compare_mail_to_interpreter_profile",
  "live_env.request_stage_play_checkpoint",
  "live_env.predict_live_source_immediate",
  "live_env.compare_live_source_prediction",
  "live_env.project_live_source_narrative",
  "live_env.change_workstation_preset",
  "live_env.set_visual_preset",
  "live_env.set_audio_preset",
  "live_env.configure_route_watch",
  "live_env.configure_live_source_watch_job",
  "live_env.bind_workstation_source",
  "live_env.unbind_workstation_source",
  "live_env.pause_workstation_loop",
  "live_env.resume_workstation_loop",
  "live_env.set_workstation_loop_state",
  "live_env.repair_loop",
  "live_env.repair_workstation_source",
  "live_env.update_live_answer_projection",
  "live_env.focus_process_graph",
  "live_env.start_agent_goal_session",
  "live_env.query_constructs",
  "live_env.query_job_evidence",
  "live_env.request_probe",
  "live_env.record_commentary",
  "live_env.spawn_field_worker",
  "live_env.evaluate_goal_satisfaction",
]);

const isLiveEnvironmentOperatorCapability = (capability: string | null | undefined): boolean => {
  const normalized = String(capability ?? "").trim();
  return (
    LIVE_ENVIRONMENT_OPERATOR_CAPABILITIES.has(normalized) ||
    normalized.startsWith("com.casimirbot.minecraft.")
  );
};

const liveSourceMailboxGoalKindFromRouteMetadata = (
  routeMetadata: RecordLike | null,
  fallbackGoalKind: string,
): string => {
  if (isLiveSourceMailboxGoalKind(fallbackGoalKind)) return fallbackGoalKind;
  const requiredCanonicalGoal = firstString(routeMetadata?.requiredCanonicalGoal, routeMetadata?.required_canonical_goal);
  if (isLiveSourceMailboxGoalKind(requiredCanonicalGoal)) return requiredCanonicalGoal;
  return "live_source_processed_mail_interpretation";
};

export const canonicalGoalKindForExplicitCapability = (capability: string | null | undefined): string | null => {
  if (isLiveEnvironmentOperatorCapability(capability)) return "live_environment_review";

  switch (capability) {
    case "helix_ask.inspect_capability_catalog":
    case "helix_ask.reflect_workstation_tool_alignment":
    case "runtime_evidence":
    case "debug.inspect_current_turn":
      return "capability_help";
    case "live_pipeline":
      return "live_pipeline_control";
    case "scientific-calculator.solve_expression":
    case "scientific-calculator.solve_with_steps":
    case "scientific-calculator.solve":
      return "calculator_solve";
    case "scientific-calculator.open":
      return "calculator_open";
    case "scientific-calculator.start_equation_live_source":
      return "calculator_live_source_setup";
    case "workspace_os.status":
      return "workspace_status_diagnostic";
    case "docs-viewer.open":
    case "docs-viewer.open_doc_by_path":
      return "doc_open";
    case "docs-viewer.identify_current_doc":
      return "active_doc_identity";
    case "docs-viewer.search_docs":
      return "docs_search";
    case "docs-viewer.validate_doc_candidates":
      return "doc_candidate_validation";
    case "docs-viewer.locate_in_doc":
      return "locate_in_doc";
    case "docs-viewer.summarize_doc":
      return "doc_summary";
    case "docs-viewer.doc_equation_context":
      return "doc_equation_context";
    case "repo-code.search_concept":
      return "repo_code_evidence_question";
    case "workspace-directory.resolve":
      return "workspace_directory_resolution";
    case "internet_search.web_research":
    case "internet-search.search_web":
      return "internet_search_lookup";
    case "scholarly-research.lookup_papers":
      return "scholarly_research_lookup";
    case "scholarly-research.fetch_full_text":
      return "scholarly_full_text_lookup";
    case "research-library.read_document":
      return "scholarly_saved_full_text_read";
    case "research-library.apply_evidence_enrichment":
      return "scholarly_evidence_enrichment";
    case "scholarly-research.extract_numeric_parameters":
      return "scholarly_numeric_parameter_extraction";
    case "live_env.check_live_source_mail":
    case "live_env.read_live_source_mail":
    case "live_env.read_processed_live_source_mail":
    case "live_env.process_live_source_mail":
    case "live_env.reflect_live_source_mail_loop":
    case "live_env.query_micro_reasoner_presets":
    case "live_env.query_micro_reasoner_prompts":
    case "live_env.draft_micro_reasoner_preset":
    case "live_env.route_micro_reasoner_prompt":
    case "live_env.query_live_source_quality":
    case "live_env.summarize_live_source_current_state":
      return "live_source_mailbox_review";
    case "live_env.record_live_source_mail_decision":
    case "live_env.request_interim_voice_callout":
      return "processed_mail_voice_decision";
    case "text_to_speech.speak_text":
      return "voice_delivery";
    case "visual_analysis.inspect_image_region":
      return "image_lens_region_inspection";
    case "image_lens.inspect":
    case "situation-room.describe_visual_capture":
      return "visual_capture_describe";
    case "helix_ask.reflect_theory_context":
    case "theory-badge-graph.propose_frontier_conjectures":
    case "theory-experiment-procedure.prepare":
    case "scientific-evidence-closure.inspect_enrollment":
    case "scientific-evidence-closure.prepare":
    case "scientific-evidence-closure.evaluate":
    case "theory-experiment-procedure.readmit":
    case "theory-experiment-procedure.evaluate_closure":
    case "theory-semantic-admitter.normalize":
    case "theory-artifact-producer.prepare_lanyon_request":
    case "theory-artifact-producer.admit_lanyon_snapshot":
    case "theory-formal-verifier.inspect_artifact_family":
    case "theory-formal-verifier.prepare_request":
    case "theory-formal-verifier.plan":
    case "theory-formal-verifier.start":
    case "theory-formal-verifier.read_result":
    case "theory-independent-numerical-verifier.prepare_request":
    case "theory-independent-numerical-verifier.plan":
    case "theory-independent-numerical-verifier.start":
    case "theory-independent-numerical-verifier.read_result":
      return "theory_context_reflection";
    case "helix.theory.frontierVectorFieldTrace":
      return "theory_frontier_vector_field";
    case "helix_ask.reflect_live_synthetic_data":
    case "helix_ask.reflect_context_attachments":
      return "context_attachment_reflection";
    case "moral-graph.reflect_context":
    case "helix_ask.reflect_ideology_context":
      return "moral_graph_reflection";
    case "moral-graph.reflect_living_substrate_context":
      return "moral_living_substrate_reflection";
    case "helix_ask.bridge_theory_ideology_context":
      return "theory_ideology_bridge_reflection";
    case "helix_ask.build_civilization_scenario_frame":
    case "helix_ask.reflect_civilization_bounds":
      return "civilization_bounds_reflection";
    case "workstation-notes.append_to_note":
    case "workstation-notes.create_note":
      return "workstation_note_edit";
    case "workstation-notes.list_notes":
      return "workstation_note_list";
    case "workstation-notes.open":
      return "workstation_note_open";
    default:
      return null;
  }
};

export const answerScopeForExplicitCapability = (capability: string | null | undefined): string => {
  if (isLiveEnvironmentOperatorCapability(capability)) return "live_environment_state";

  switch (capability) {
    case "helix_ask.inspect_capability_catalog":
    case "helix_ask.reflect_workstation_tool_alignment":
    case "runtime_evidence":
    case "debug.inspect_current_turn":
      return "runtime_evidence";
    case "live_pipeline":
      return "live_environment_state";
    case "scientific-calculator.solve_expression":
    case "scientific-calculator.solve_with_steps":
    case "scientific-calculator.solve":
    case "scientific-calculator.open":
    case "scientific-calculator.start_equation_live_source":
      return "current_turn_action";
    case "workspace_os.status":
      return "workspace_state";
    case "docs-viewer.open":
    case "docs-viewer.open_doc_by_path":
    case "docs-viewer.identify_current_doc":
    case "docs-viewer.search_docs":
    case "docs-viewer.validate_doc_candidates":
    case "docs-viewer.summarize_doc":
    case "docs-viewer.doc_equation_context":
    case "docs-viewer.locate_in_doc":
      return "current_turn_doc";
    case "repo-code.search_concept":
      return "repo_evidence";
    case "internet_search.web_research":
    case "internet-search.search_web":
      return "external_internet_search";
    case "scholarly-research.lookup_papers":
    case "scholarly-research.fetch_full_text":
    case "scholarly-research.extract_numeric_parameters":
      return "external_scholarly_research";
    case "research-library.read_document":
    case "research-library.apply_evidence_enrichment":
      return "profile_scholarly_evidence";
    case "live_env.check_live_source_mail":
    case "live_env.read_live_source_mail":
    case "live_env.read_processed_live_source_mail":
    case "live_env.process_live_source_mail":
    case "live_env.reflect_live_source_mail_loop":
    case "live_env.record_live_source_mail_decision":
    case "live_env.query_micro_reasoner_presets":
    case "live_env.query_micro_reasoner_prompts":
    case "live_env.draft_micro_reasoner_preset":
    case "live_env.route_micro_reasoner_prompt":
    case "live_env.query_live_source_quality":
    case "live_env.summarize_live_source_current_state":
      return "live_source_mail";
    case "live_env.request_interim_voice_callout":
    case "text_to_speech.speak_text":
      return "live_environment_state";
    case "visual_analysis.inspect_image_region":
      return "visual_capture";
    case "image_lens.inspect":
    case "situation-room.describe_visual_capture":
      return "visual_capture";
    case "helix_ask.reflect_theory_context":
    case "theory-badge-graph.propose_frontier_conjectures":
    case "helix.theory.frontierVectorFieldTrace":
    case "theory-experiment-procedure.prepare":
    case "scientific-evidence-closure.inspect_enrollment":
    case "scientific-evidence-closure.prepare":
    case "scientific-evidence-closure.evaluate":
    case "theory-experiment-procedure.readmit":
    case "theory-experiment-procedure.evaluate_closure":
    case "theory-semantic-admitter.normalize":
    case "theory-artifact-producer.prepare_lanyon_request":
    case "theory-artifact-producer.admit_lanyon_snapshot":
    case "theory-formal-verifier.inspect_artifact_family":
    case "theory-formal-verifier.prepare_request":
    case "theory-formal-verifier.plan":
    case "theory-formal-verifier.start":
    case "theory-formal-verifier.read_result":
    case "theory-independent-numerical-verifier.prepare_request":
    case "theory-independent-numerical-verifier.plan":
    case "theory-independent-numerical-verifier.start":
    case "theory-independent-numerical-verifier.read_result":
      return "theory_context";
    case "helix_ask.reflect_live_synthetic_data":
    case "helix_ask.reflect_context_attachments":
      return "context_reflection";
    case "moral-graph.reflect_context":
    case "helix_ask.reflect_ideology_context":
    case "helix_ask.bridge_theory_ideology_context":
      return "moral_graph_reflection";
    case "moral-graph.reflect_living_substrate_context":
      return "context_reflection";
    case "helix_ask.build_civilization_scenario_frame":
    case "helix_ask.reflect_civilization_bounds":
      return "civilization_bounds";
    case "workstation-notes.append_to_note":
    case "workstation-notes.create_note":
    case "workstation-notes.list_notes":
    case "workstation-notes.open":
      return "workspace_state";
    default:
      return "workspace_state";
  }
};

const explicitContractFromInput = (input: {
  promptText: string;
  toolCallAdmissionDecision?: RecordLike | null;
  requestedCapabilityContract?: ExplicitCapabilityContract | null;
}): ExplicitCapabilityContract | null =>
  input.requestedCapabilityContract ??
  explicitCapabilityContractForCapability(readString(input.toolCallAdmissionDecision?.requested_capability)) ??
  extractExplicitCapabilityContract(input.promptText);

const suppressionBlocksContract = (
  suppression: HelixContextualToolAdmissionSuppression | null,
  contract: ExplicitCapabilityContract | null,
): boolean => {
  if (!suppression) return false;
  if (!contract) return false;
  if (suppression.suppression_reason === "explanatory_only") return false;
  return [contract.capability_family, ...contract.admission_families].some((family) =>
    contextualToolSuppressionBlocksFamily(suppression, family),
  );
};

const suppressionBlocksFallback = (
  suppression: HelixContextualToolAdmissionSuppression | null,
  fallbackSourceTarget: string,
  fallbackPlanFamily: HelixCapabilityFamily,
): boolean => {
  if (!suppression) return false;
  const sourceFamilies =
    fallbackSourceTarget === "calculator_stream" || fallbackSourceTarget === "calculator" || fallbackSourceTarget === "calculator_solve"
      ? ["calculator", "workstation_action"]
      : fallbackSourceTarget === "live_source_mailbox"
        ? ["live_environment", "live_source_mail"]
      : fallbackSourceTarget === "docs_viewer" || fallbackSourceTarget === "active_doc"
        ? ["docs_viewer"]
      : fallbackSourceTarget === "repo_code" || fallbackSourceTarget === "runtime_evidence"
        ? ["repo_code"]
      : fallbackSourceTarget
        ? [fallbackSourceTarget]
        : [];
  return [...sourceFamilies, fallbackPlanFamily].some((family) =>
    contextualToolSuppressionBlocksFamily(suppression, family),
  );
};

export const resolveAskCapabilityContractArbitration = (input: {
  turnId: string;
  promptText: string;
  sourceTargetIntent?: RecordLike | null;
  routeProductContract?: RecordLike | null;
  toolCallAdmissionDecision?: RecordLike | null;
  canonicalGoalFrame?: RecordLike | null;
  routeMetadata?: RecordLike | null;
  hardLiveSourceMailboxRoute?: boolean;
  requestedCapabilityContract?: ExplicitCapabilityContract | null;
  contextualSuppression?: HelixContextualToolAdmissionSuppression | null;
  referentEvidenceUnavailable?: boolean;
  fallbackSourceTarget: string;
  fallbackPlanFamily: HelixCapabilityFamily;
  fallbackGoalKind: string;
  fallbackRequiredTerminalKind?: string | null;
}): AskCapabilityContractArbitration => {
  const sourceTargetIntent = readRecord(input.sourceTargetIntent);
  const routeProductContract = readRecord(input.routeProductContract);
  const toolCallAdmissionDecision = readRecord(input.toolCallAdmissionDecision);
  const canonicalGoalFrame = readRecord(input.canonicalGoalFrame);
  const routeMetadata = readRecord(input.routeMetadata);
  const contextualSuppression =
    input.contextualSuppression === undefined
      ? detectContextualToolAdmissionSuppression(input.promptText)
      : input.contextualSuppression;
  const requestedCapabilityContract = explicitContractFromInput({
    promptText: input.promptText,
    toolCallAdmissionDecision,
    requestedCapabilityContract: input.requestedCapabilityContract,
  });
  const metadataSourceTarget = firstString(routeMetadata?.sourceTarget, routeMetadata?.source_target);
  const routeMetadataPresent = Boolean(metadataSourceTarget) || input.hardLiveSourceMailboxRoute === true;
  const authoritativeLivePipelineRoute = resolveAuthoritativeLivePipelineRoute({
    turnId: input.turnId,
    canonicalGoalFrame,
    routeProductContract,
  });
  const hardLiveSourceMailboxRoute =
    input.hardLiveSourceMailboxRoute === true ||
    metadataSourceTarget === "live_source_mailbox" ||
    readString(toolCallAdmissionDecision?.source_target) === "live_source_mailbox";
  const fallbackRequiredTerminalKind =
    input.fallbackRequiredTerminalKind ??
    firstString(
      canonicalGoalFrame?.required_terminal_kind,
      routeProductContract?.required_terminal_artifact_kind,
      routeProductContract?.required_terminal_kind,
    );

  if (input.referentEvidenceUnavailable === true) {
    return {
      schema: "helix.ask_capability_contract_arbitration.v1",
      turn_id: input.turnId,
      contract_state: "conversational_referent_no_evidence",
      requested_capability: null,
      selected_source_target: "model_only",
      selected_plan_family: "debug_export",
      canonical_goal_kind: "model_only_concept",
      required_observation_kinds: [],
      required_terminal_kind: "direct_answer_text",
      allow_phase_repair: false,
      route_metadata_demoted: routeMetadataPresent,
      demotion_reason: "referent_cannot_supply_requested_evidence",
      failure_code_if_incompatible: "conversational_referent_has_no_retrievable_claims",
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (
    suppressionBlocksContract(contextualSuppression, requestedCapabilityContract) ||
    (!requestedCapabilityContract && suppressionBlocksFallback(contextualSuppression, input.fallbackSourceTarget, input.fallbackPlanFamily))
  ) {
    return {
      schema: "helix.ask_capability_contract_arbitration.v1",
      turn_id: input.turnId,
      contract_state: "suppressed_contextual_reference",
      requested_capability: null,
      selected_source_target: "model_only",
      selected_plan_family: "debug_export",
      canonical_goal_kind: "model_only_concept",
      required_observation_kinds: [],
      required_terminal_kind: "direct_answer_text",
      allow_phase_repair: false,
      route_metadata_demoted: routeMetadataPresent,
      demotion_reason: routeMetadataPresent ? "contextual_tool_reference_demoted_route_metadata" : undefined,
      failure_code_if_incompatible: "contextual_tool_reference_demoted_route_metadata",
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (authoritativeLivePipelineRoute) {
    return {
      schema: "helix.ask_capability_contract_arbitration.v1",
      turn_id: input.turnId,
      contract_state: "authoritative_live_pipeline_contract",
      requested_capability: requestedCapabilityContract?.capability ?? null,
      selected_source_target: authoritativeLivePipelineRoute.sourceTarget,
      selected_plan_family: "live_source",
      canonical_goal_kind: authoritativeLivePipelineRoute.goalKind,
      required_observation_kinds: [authoritativeLivePipelineRoute.requiredTerminalKind],
      required_terminal_kind: authoritativeLivePipelineRoute.requiredTerminalKind,
      allow_phase_repair: false,
      route_metadata_demoted: false,
      demotion_reason: requestedCapabilityContract
        ? "authoritative_live_pipeline_contract_overrode_capability_hypothesis"
        : undefined,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (requestedCapabilityContract) {
    return {
      schema: "helix.ask_capability_contract_arbitration.v1",
      turn_id: input.turnId,
      contract_state: "explicit_capability_command",
      requested_capability: requestedCapabilityContract.capability,
      selected_source_target: requestedCapabilityContract.source_target,
      selected_plan_family: requestedCapabilityContract.plan_family,
      canonical_goal_kind:
        canonicalGoalKindForExplicitCapability(requestedCapabilityContract.capability) ??
        input.fallbackGoalKind,
      required_observation_kinds: requestedCapabilityContract.required_observation_kinds,
      required_terminal_kind: requestedCapabilityContract.required_terminal_kind,
      allow_phase_repair: false,
      route_metadata_demoted:
        routeMetadataPresent &&
        metadataSourceTarget !== requestedCapabilityContract.source_target &&
        metadataSourceTarget !== "",
      demotion_reason:
        routeMetadataPresent &&
        metadataSourceTarget !== requestedCapabilityContract.source_target &&
        metadataSourceTarget !== ""
          ? "explicit_capability_contract_demoted_route_metadata"
          : undefined,
      failure_code_if_incompatible: "explicit_capability_goal_contract_mismatch",
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (hardLiveSourceMailboxRoute) {
    const liveSourceGoalKind = liveSourceMailboxGoalKindFromRouteMetadata(routeMetadata, input.fallbackGoalKind);
    return {
      schema: "helix.ask_capability_contract_arbitration.v1",
      turn_id: input.turnId,
      contract_state: "hard_live_source_phase",
      requested_capability: null,
      selected_source_target: "live_source_mailbox",
      selected_plan_family: "live_environment",
      canonical_goal_kind: liveSourceGoalKind,
      required_observation_kinds: readStringArray(routeMetadata?.requiredEvidence ?? routeMetadata?.required_evidence),
      required_terminal_kind:
        isLiveSourceMailboxGoalKind(liveSourceGoalKind) && !isLiveSourceMailboxGoalKind(input.fallbackGoalKind)
          ? "model_synthesized_answer"
          : fallbackRequiredTerminalKind,
      allow_phase_repair: true,
      route_metadata_demoted: false,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  const modelOnly =
    input.fallbackSourceTarget === "model_only" ||
    input.fallbackGoalKind === "model_only_concept";
  return {
    schema: "helix.ask_capability_contract_arbitration.v1",
    turn_id: input.turnId,
    contract_state: modelOnly ? "model_only" : "classifier_hypothesis",
    requested_capability: null,
    selected_source_target: input.fallbackSourceTarget,
    selected_plan_family: input.fallbackPlanFamily,
    canonical_goal_kind: input.fallbackGoalKind,
    required_observation_kinds: [],
    required_terminal_kind: fallbackRequiredTerminalKind,
    allow_phase_repair: input.fallbackPlanFamily === "live_environment" || input.fallbackSourceTarget === "live_source_mailbox",
    route_metadata_demoted: false,
    assistant_answer: false,
    raw_content_included: false,
  };
};
