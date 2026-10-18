import { buildPostToolAuthorityBridge } from "./post-tool-authority-bridge";
import {
  inferCommittedRouteToolFamily,
  readCommittedAskRoute,
} from "./committed-ask-route";
import { explicitCapabilityMatches } from "./explicit-capability-contract";
import { readVerifiedHelixRuntimeLifecycleFromPayload } from "./runtime/turn-lifecycle";
import {
  providerBridgeAllEvidenceReentryCompatible,
  providerBridgeCapabilityLaneEvidenceReentryCompatible,
} from "./provider-evidence-reentry-compatibility";

export type HelixRuntimeAuthoritySeverity = "pass" | "p0" | "p1" | "p2";

export type HelixRuntimeAuthorityBoundaryReport = {
  schema: "helix.runtime_authority_boundary_report.v1";
  source_capability_diagnostic_turn: boolean;
  requires_runtime_loop: boolean;
  terminal_kind: string | null;
  final_answer_source: string | null;
  checks: {
    agent_runtime_loop: boolean;
    agent_step_decision: boolean;
    runtime_tool_call: boolean;
    microdeck_selected_capability: boolean;
    selected_capability_observation: boolean;
    post_observation_model_decision: boolean;
    goal_satisfaction_allows_terminal: boolean;
    typed_failure_clean: boolean;
  };
  runtime_lifecycle: {
    integrity_verified: boolean;
    scope: "codex_native_provider_cycle" | "helix_ask_turn" | null;
    provider_cycle_completed: boolean;
    supported_capability_ids: string[];
    supported_observation_refs: string[];
    authority_source: "verified_runtime_event_log" | "legacy_projection_only";
  };
  provider_bridge_runtime_authority: {
    eligible: boolean;
    checks: Record<string, boolean | string | null>;
  };
  eligible: boolean;
  severity: HelixRuntimeAuthoritySeverity;
  blocking_reasons: string[];
  assistant_answer: false;
  raw_content_included: false;
};

export type HelixCapabilityBindingMismatchObservation = {
  schema: "helix.capability_binding_mismatch_observation.v1";
  selected_capability: string;
  observed_artifact_refs: string[];
  observed_artifact_kinds: string[];
  observed_capability_families: string[];
  suggested_capability: string | null;
  suggested_repair:
    | "rebind_selected_capability_to_observed_tool_plan"
    | "retry_selected_capability"
    | "ask_user"
    | "fail_closed";
  repair_reason: string;
  assistant_answer: false;
  raw_content_included: false;
};

const SOURCE_CAPABILITY_GOAL_KINDS = new Set([
  "active_doc_identity",
  "active_doc_summary",
  "calculator_live_source",
  "calculator_solve",
  "capability_help",
  "context_attachment_reflection",
  "debug_diagnosis",
  "doc_evidence_location",
  "doc_evidence_synthesis",
  "doc_open",
  "doc_open_best",
  "doc_summary",
  "docs_panel_open",
  "doc_equation_context",
  "latest_doc_navigation",
  "live_interval_set",
  "live_environment_review",
  "live_pipeline_control",
  "live_pipeline_repair",
  "note_mutation",
  "panel_control",
  "process_graph_overview",
  "repo_code_evidence_question",
  "repo_entity_definition",
  "scholarly_research_lookup",
  "scholarly_full_text_lookup",
  "internet_search_lookup",
  "situation_context_question",
  "theory_context_reflection",
  "theory_frontier_vector_field",
  "theory_ideology_bridge_reflection",
  "visual_capture_describe",
  "workspace_directory_resolution",
  "workspace_status_diagnostic",
  "civilization_bounds_reflection",
  "moral_graph_reflection",
]);

const MODEL_DIRECT_ANSWER_GOAL_KINDS = new Set([
  "model_only_concept",
  "workspace_help",
  "conversation",
]);

const LIVE_PIPELINE_RECEIPT_GOAL_KINDS = new Set([
  "live_interval_set",
  "live_source_continuation",
  "live_pipeline_control",
  "live_pipeline_repair",
  "live_runtime_repair",
]);

const MICRODECK_QUERY_CAPABILITY = "live_env.query_micro_reasoner_presets";
const MICRODECK_DRAFT_CAPABILITY = "live_env.draft_micro_reasoner_preset";
const MICRODECK_PROMPT_ROUTER_CAPABILITY =
  "live_env.route_micro_reasoner_prompt";
const MICRODECK_QUERY_OBSERVATION_SCHEMA =
  "stage_play_micro_reasoner_prompt_preset_query_result/v1";
const MICRODECK_DRAFT_OBSERVATION_SCHEMA =
  "stage_play_micro_reasoner_prompt_preset_draft/v1";
const MICRODECK_PROMPT_DELEGATION_OBSERVATION_SCHEMA =
  "stage_play_micro_reasoner_prompt_delegation_result/v1";

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readStringArray = (value: unknown): string[] =>
  readArray(value)
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0,
    )
    .map((entry) => entry.trim());

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const ledgerHasArtifactKind = (
  payload: Record<string, unknown>,
  kind: string,
): boolean =>
  readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .some((artifact) => readString(artifact?.kind) === kind);

const payloadGoalKind = (payload: Record<string, unknown>): string | null =>
  readCommittedAskRoute(payload)?.canonical_goal.goal_kind ??
  readString(readRecord(payload.canonical_goal_frame)?.goal_kind) ??
  readString(
    readRecord(payload.goal_satisfaction_evaluation)?.canonical_goal_kind,
  ) ??
  readString(readRecord(payload.terminal_contract)?.goal_kind);

const artifactKindMatchesCapability = (
  capability: string,
  artifact: Record<string, unknown> | null,
): boolean => {
  const kind = readString(artifact?.kind);
  const payload = readRecord(artifact?.payload);
  const topSchema = readString(artifact?.schema);
  const topToolName =
    readString(artifact?.tool_name) ?? readString(artifact?.toolName);
  const artifactCapability =
    readString(artifact?.capability_key) ??
    readString(artifact?.capability_id) ??
    readString(payload?.capability_key) ??
    readString(payload?.capability_id);
  const topObservation = readRecord(artifact?.observation);
  const payloadKind = readString(payload?.kind);
  const schema = readString(payload?.schema);
  const payloadToolName =
    readString(payload?.tool_name) ?? readString(payload?.toolName);
  const payloadObservation = readRecord(payload?.observation);
  const observationSchema =
    readString(topObservation?.schema) ??
    readString(topObservation?.schemaVersion) ??
    readString(payloadObservation?.schema) ??
    readString(payloadObservation?.schemaVersion);
  const actionId =
    readString(payload?.action_id) ??
    readString(readRecord(payload?.action)?.action_id);
  const panelId =
    readString(payload?.panel_id) ??
    readString(readRecord(payload?.action)?.panel_id);
  const payloadText = payload ? JSON.stringify(payload).slice(0, 4000) : "";
  const topObservationText = topObservation
    ? JSON.stringify(topObservation).slice(0, 4000)
    : "";
  const joined = [
    kind,
    topSchema,
    topToolName,
    payloadKind,
    schema,
    payloadToolName,
    artifactCapability,
    observationSchema,
    actionId,
    panelId,
    payloadText,
    topObservationText,
  ]
    .filter(Boolean)
    .join(" ");
  const microDeckPresetQueryObservation =
    observationSchema === MICRODECK_QUERY_OBSERVATION_SCHEMA ||
    /stage_play_micro_reasoner_prompt_preset_query_result\/v1/i.test(joined);
  const microDeckPromptDelegationObservation =
    observationSchema === MICRODECK_PROMPT_DELEGATION_OBSERVATION_SCHEMA ||
    /stage_play_micro_reasoner_prompt_delegation_result\/v1/i.test(joined);
  const microDeckPresetDraftObservation =
    observationSchema === MICRODECK_DRAFT_OBSERVATION_SCHEMA ||
    /stage_play_micro_reasoner_prompt_preset_draft\/v1/i.test(joined);

  // A current-turn governed observation packet may intentionally expose only
  // its exact capability identity plus observation schema. Preserve that
  // identity instead of requiring a family-specific lexical marker in the
  // packet body (for example, `tool_observation`).
  if (
    artifactCapability === capability &&
    /observation|helix\.agent_step_observation_packet\.v1|helix\.environment_connector\.probe_observation\.v1|helix\.environment_action\.observation\.v1/i.test(
      joined,
    )
  ) {
    return true;
  }

  if (capability === MICRODECK_QUERY_CAPABILITY) {
    return (
      microDeckPresetQueryObservation &&
      /live_env\.query_micro_reasoner_presets|stage_play_micro_reasoner_prompt_preset_query_result\/v1/i.test(
        joined,
      )
    );
  }
  if (capability === MICRODECK_PROMPT_ROUTER_CAPABILITY) {
    return (
      microDeckPromptDelegationObservation &&
      /live_env\.route_micro_reasoner_prompt|stage_play_micro_reasoner_prompt_delegation_result\/v1/i.test(
        joined,
      )
    );
  }
  if (capability === MICRODECK_DRAFT_CAPABILITY) {
    return (
      microDeckPresetDraftObservation &&
      /live_env\.draft_micro_reasoner_preset|stage_play_micro_reasoner_prompt_preset_draft\/v1/i.test(
        joined,
      )
    );
  }
  if (
    (microDeckPresetQueryObservation ||
      microDeckPromptDelegationObservation ||
      microDeckPresetDraftObservation) &&
    capability.startsWith("live_env.")
  )
    return false;
  if (capability === "repo-code.search_concept")
    return /repo_code_evidence_observation|helix\.repo_code_evidence_observation\.v1|repo_search/i.test(
      joined,
    );
  if (capability === "scholarly-research.lookup_papers")
    return /scholarly_research_observation|helix\.scholarly_research_observation\.v1|scholarly_research/i.test(
      joined,
    );
  if (capability === "scholarly-research.fetch_full_text")
    return /scholarly_full_text_observation|helix\.scholarly_full_text_observation\.v1|scholarly_research/i.test(
      joined,
    );
  if (capability === "research-library.read_document")
    return /research_library_observation|helix\.research_library_observation\.v1|profile_research_library/i.test(
      joined,
    );
  if (capability === "research-library.apply_evidence_enrichment") {
    return /paper_evidence_enrichment_observation|helix\.paper_evidence_enrichment_observation\.v1|apply_evidence_enrichment/i.test(
      joined,
    );
  }
  if (
    capability === "internet_search.web_research" ||
    capability === "internet-search.search_web"
  ) {
    return /internet_search_observation|web_research_observation|helix\.internet_search_observation\.v1|internet_search|web_research/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.inspect_capability_catalog")
    return /capability_registry|capability_help_summary|helix\.capability_catalog_observation\.v1|inspect_capability_catalog/i.test(
      joined,
    );
  if (capability === "helix_ask.reflect_workstation_tool_alignment") {
    return /capability_registry|capability_help_summary|workstation_tool_alignment|toolchain_matrix|tool_regression_matrix|helix\.capability_catalog_observation\.v1/i.test(
      joined,
    );
  }
  if (capability === "workspace_os.status") {
    return /workspace_os_status_observation|workspace_status|workspace[-_]os[-_.:]status|workstation_tool_evaluation/i.test(
      joined,
    );
  }
  if (capability === "workstation.active_context") {
    return /workstation_active_context_observation|helix\.workstation_active_context_observation\.v1|workstation\.active_context/i.test(
      joined,
    );
  }
  if (capability === "workspace-directory.resolve")
    return /workspace_directory_resolution|helix\.workspace_directory_resolution\.v1/i.test(
      joined,
    );
  if (capability === "helix_ask.reflect_theory_context") {
    return /helix_theory_context_reflection_tool_receipt|theory_context_reflection|reflect_theory_context/i.test(
      joined,
    );
  }
  if (capability === "helix.theory.frontierVectorFieldTrace") {
    return /helix_theory_frontier_vector_field_tool_receipt|theory_frontier_vector_field|frontierVectorFieldTrace|relation_tensor_trace/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.reflect_live_synthetic_data") {
    return /helix_context_reflection_tool_receipt|bounded_context_reference|live_synthetic_data/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.reflect_context_attachments") {
    return /helix_context_reflection_tool_receipt|context_attachment|bounded_context_reference/i.test(
      joined,
    );
  }
  if (capability === "moral-graph.reflect_context") {
    return /moral_graph_reflection|moral-graph\.reflect_context|helix\.moral_graph_reflection_observation\.v1|ideology_context_reflection|procedural_moral_classification|moral_badge_locator/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.reflect_ideology_context") {
    return /helix_moral_graph_reflection_tool_result|ideology_context_reflection|procedural_moral_classification|moral_badge_locator|fruition_procedure_expression|reflect_ideology_context|workstation_tool_evaluation/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.bridge_theory_ideology_context") {
    return /helix_theory_ideology_bridge_tool_result|theory_ideology_bridge|bridge_theory_ideology_context|workstation_tool_evaluation/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.build_civilization_scenario_frame") {
    return /helix_civilization_scenario_frame_tool_result|civilization_scenario_frame|build_civilization_scenario_frame|workstation_tool_evaluation/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.reflect_civilization_bounds") {
    return /helix_civilization_bounds_tool_result|civilization_bounds_roadmap|reflect_civilization_bounds|workstation_tool_evaluation/i.test(
      joined,
    );
  }
  if (capability === "helix_ask.reflect_stage_play_context") {
    return /stage_play_reflection_result|stage_play_badge_graph|stage_play_output_lane_projection|stage_play_job_plan|stage_play_checkpoint_request_result|stage_play_checkpoint_request|stage_play_checkpoint_queue|stage_play_builder_catalog|stage_play_source_query|stage_play_graph_draft_validation|reflect_stage_play_context|plan_stage_play_job|request_stage_play_checkpoint|describe_stage_builder|query_stage_sources|draft_stage_play_graph|validate_stage_play_graph|live_env\.reflect_stage_play_context|live_env\.plan_stage_play_job|live_env\.request_stage_play_checkpoint/i.test(
      joined,
    );
  }
  if (capability === "live_env.reflect_live_source_mail_loop") {
    return /stage_play_live_source_mail_loop_reflection|reflect_live_source_mail_loop/i.test(
      joined,
    );
  }
  if (
    capability === "live_env.check_live_source_mail" ||
    capability === "live_env.read_live_source_mail"
  ) {
    return /stage_play_live_source_mail_read_result|live_env\.(?:check_live_source_mail|read_live_source_mail)/i.test(
      joined,
    );
  }
  if (capability === "live_env.read_processed_live_source_mail") {
    return /stage_play_processed_mail_packet|read_processed_live_source_mail/i.test(
      joined,
    );
  }
  if (capability === "live_env.process_live_source_mail") {
    return /stage_play_live_source_mail_read_result|stage_play_processed_mail_packet|process_live_source_mail/i.test(
      joined,
    );
  }
  if (capability === "live_env.query_live_source_quality") {
    return /stage_play_live_source_quality|query_live_source_quality|helix\.workstation_goal_context_update\.v1/i.test(
      joined,
    );
  }
  if (capability === "live_env.query_workstation_goal_context") {
    return /stage_play_workstation_goal_context_read_result|query_workstation_goal_context|helix\.agent_goal_session\.v1|helix\.workstation_goal_context_update\.v1/i.test(
      joined,
    );
  }
  if (capability === "live_env.summarize_live_source_current_state") {
    return /stage_play_live_source_current_state|summarize_live_source_current_state|helix\.workstation_goal_context_update\.v1/i.test(
      joined,
    );
  }
  if (capability === "docs-viewer.open")
    return /workspace_action_receipt|docs-viewer|docs_viewer|open/i.test(
      joined,
    );
  if (capability === "docs-viewer.identify_current_doc")
    return /active_doc_identity|active_doc_path|doc_summary/i.test(joined);
  if (capability === "docs-viewer.search_docs")
    return /doc_search_results|doc_candidate_validation|retrieval_context/i.test(
      joined,
    );
  if (capability === "docs-viewer.validate_doc_candidates")
    return /doc_candidate_validation|doc_search_results/i.test(joined);
  if (capability === "docs-viewer.open_doc_by_path")
    return /doc_open_receipt|active_doc_path|workspace_action_receipt|doc_summary/i.test(
      joined,
    );
  if (capability === "docs-viewer.summarize_doc")
    return /doc_summary/i.test(joined);
  if (capability === "docs-viewer.locate_in_doc")
    return /doc_location_result|doc_location_matches|doc_evidence_location|doc_equation_context|line_backed_locations/i.test(
      joined,
    );
  if (capability === "docs-viewer.doc_equation_context")
    return /doc_equation_context|doc_equation_context\/v1/i.test(joined);
  if (capability === "conversation-memory.recall")
    return /conversation_memory_packet|helix\.conversation_memory_packet\.v1|context_resume_frame/i.test(
      joined,
    );
  if (capability.startsWith("scientific-calculator."))
    return /calculator_receipt|calculator_result|workstation_tool_evaluation|tool_evaluation/i.test(
      joined,
    );
  if (
    capability === "image_lens.inspect" ||
    capability === "situation-room.describe_visual_capture"
  ) {
    return /visual_frame_evidence|visual_capture_coverage|situation_context_pack|visual_capture|image_lens|situation[-_]room[-_.:]describe[-_]visual[-_]capture/i.test(
      joined,
    );
  }
  if (capability.startsWith("workstation-notes."))
    return /note_update_receipt|workspace_action_receipt|note_/i.test(joined);
  if (capability.startsWith("live_env."))
    return /live_environment_tool_observation|live_environment_agent_loop|interpreted_log|minecraft_navigation_state|source_capability|runtime_tool_observation|tool_observation/i.test(
      joined,
    );
  if (
    capability === "situation-room-pipelines.observer.attach" ||
    capability === "situation-room-pipelines.observer.detach"
  ) {
    return (
      /dottie_observer_subscription_receipt|helix\.dottie_observer_subscription\.v1|observer_subscription/i.test(
        joined,
      ) ||
      (/workstation_tool_evaluation/i.test(joined) &&
        /dottie|observer\.attach|observer\.detach|observer_subscription/i.test(
          joined,
        ))
    );
  }
  if (capability === "situation-room-pipelines.observer.query") {
    return (
      /dottie_observer_query_receipt|observer\.query|observer_query/i.test(
        joined,
      ) ||
      (/workstation_tool_evaluation/i.test(joined) &&
        /dottie|observer\.query|observer_query/i.test(joined))
    );
  }
  if (
    capability === "situation-room-pipelines.voice_delivery.propose_from_trace"
  ) {
    return (
      /dottie_voice_receipt|helix\.dottie_voice_receipt\.v1|voice_delivery\.propose_from_trace|voice_delivery/i.test(
        joined,
      ) ||
      (/workstation_tool_evaluation/i.test(joined) &&
        /dottie_voice|voice_delivery/i.test(joined))
    );
  }
  if (capability === "situation-room-pipelines.dottie_observer.evaluate") {
    return (
      /workstation_tool_evaluation|helix\.workstation_tool_evaluation\.v1/i.test(
        joined,
      ) && /dottie_observer|dottie_voice|observer_|voice_delivery/i.test(joined)
    );
  }
  if (capability === "situation-room-pipelines.dottie.manifest") {
    return /dottie_manifest_preset_receipt|helix\.dottie_manifest_preset_receipt\.v1/i.test(
      joined,
    );
  }
  if (
    capability.startsWith("situation-room-pipelines.") &&
    /(?:observer|voice_delivery|dottie)/i.test(capability)
  ) {
    return /dottie_|observer_|observer\.|voice_delivery|tool_observation/i.test(
      joined,
    );
  }
  if (
    capability.startsWith("live-source.") ||
    capability.startsWith("situation-room.")
  )
    return /live_pipeline_receipt|live_source|visual_context_pack|situation_context_pack|permission_denied|workspace_action_receipt/i.test(
      joined,
    );
  if (capability.startsWith("process-graph."))
    return /process_graph_overview|workspace_action_receipt/i.test(joined);
  if (capability.includes("."))
    return /tool_observation|workspace_action_receipt/i.test(joined);
  return false;
};

const isDottieObserverCapability = (capability: string): boolean =>
  capability === "situation-room-pipelines.observer.attach" ||
  capability === "situation-room-pipelines.observer.detach" ||
  capability === "situation-room-pipelines.observer.query" ||
  capability === "situation-room-pipelines.voice_delivery.propose_from_trace" ||
  capability === "situation-room-pipelines.dottie_observer.evaluate" ||
  capability === "situation-room-pipelines.dottie.manifest";

const capabilityFamilyForArtifact = (
  artifact: Record<string, unknown> | null,
): string | null => {
  if (!artifact) return null;
  const kind = readString(artifact.kind);
  const payload = readRecord(artifact.payload);
  const topSchema = readString(artifact.schema);
  const topToolName =
    readString(artifact.tool_name) ?? readString(artifact.toolName);
  const topObservation = readRecord(artifact.observation);
  const schema = readString(payload?.schema);
  const payloadToolName =
    readString(payload?.tool_name) ?? readString(payload?.toolName);
  const payloadObservation = readRecord(payload?.observation);
  const observationSchema =
    readString(topObservation?.schema) ??
    readString(topObservation?.schemaVersion) ??
    readString(payloadObservation?.schema) ??
    readString(payloadObservation?.schemaVersion);
  const actionId =
    readString(payload?.action_id) ??
    readString(readRecord(payload?.action)?.action_id);
  const panelId =
    readString(payload?.panel_id) ??
    readString(readRecord(payload?.action)?.panel_id);
  const payloadText = payload ? JSON.stringify(payload).slice(0, 4000) : "";
  const topObservationText = topObservation
    ? JSON.stringify(topObservation).slice(0, 4000)
    : "";
  const joined = [
    kind,
    topSchema,
    topToolName,
    schema,
    payloadToolName,
    observationSchema,
    actionId,
    panelId,
    payloadText,
    topObservationText,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    /stage_play_micro_reasoner_prompt_preset_query_result\/v1/i.test(joined)
  ) {
    return MICRODECK_QUERY_CAPABILITY;
  }
  if (/stage_play_micro_reasoner_prompt_delegation_result\/v1/i.test(joined)) {
    return MICRODECK_PROMPT_ROUTER_CAPABILITY;
  }
  if (/stage_play_micro_reasoner_prompt_preset_draft\/v1/i.test(joined)) {
    return MICRODECK_DRAFT_CAPABILITY;
  }
  if (
    /repo_code_evidence_observation|helix\.repo_code_evidence_observation\.v1|repo_search/i.test(
      joined,
    )
  ) {
    return "repo-code.search_concept";
  }
  if (
    /scholarly_full_text_observation|helix\.scholarly_full_text_observation\.v1/i.test(
      joined,
    )
  ) {
    return "scholarly-research.fetch_full_text";
  }
  if (
    /research_library_observation|helix\.research_library_observation\.v1|profile_research_library/i.test(
      joined,
    )
  ) {
    return "research-library.read_document";
  }
  if (
    /paper_evidence_enrichment_observation|helix\.paper_evidence_enrichment_observation\.v1|apply_evidence_enrichment/i.test(
      joined,
    )
  ) {
    return "research-library.apply_evidence_enrichment";
  }
  if (
    /scholarly_research_observation|helix\.scholarly_research_observation\.v1|scholarly_research/i.test(
      joined,
    )
  ) {
    return "scholarly-research.lookup_papers";
  }
  if (
    /internet_search_observation|helix\.internet_search_observation\.v1|internet_search/i.test(
      joined,
    )
  ) {
    return "internet_search.web_research";
  }
  if (
    /workspace_os_status_observation|workspace_status|workspace[-_]os[-_.:]status/i.test(
      joined,
    )
  ) {
    return "workspace_os.status";
  }
  if (
    /workspace_directory_resolution|helix\.workspace_directory_resolution\.v1/i.test(
      joined,
    )
  ) {
    return "workspace-directory.resolve";
  }
  if (
    /workstation_tool_alignment|toolchain_matrix|tool_regression_matrix/i.test(
      joined,
    )
  ) {
    return "helix_ask.reflect_workstation_tool_alignment";
  }
  if (
    /capability_registry|capability_help_summary|helix\.capability_catalog_observation\.v1/i.test(
      joined,
    )
  ) {
    return "helix_ask.inspect_capability_catalog";
  }
  if (/context_attachment/i.test(joined)) {
    return "helix_ask.reflect_context_attachments";
  }
  if (
    /helix_context_reflection_tool_receipt|bounded_context_reference|live_synthetic_data/i.test(
      joined,
    )
  ) {
    return "helix_ask.reflect_live_synthetic_data";
  }
  if (
    /helix_moral_graph_reflection_tool_result|ideology_context_reflection|procedural_moral_classification|moral_badge_locator|fruition_procedure_expression|reflect_ideology_context/i.test(
      joined,
    )
  ) {
    return "helix_ask.reflect_ideology_context";
  }
  if (
    /helix_theory_ideology_bridge_tool_result|theory_ideology_bridge|bridge_theory_ideology_context/i.test(
      joined,
    )
  ) {
    return "helix_ask.bridge_theory_ideology_context";
  }
  if (
    /stage_play_live_source_mail_loop_reflection|reflect_live_source_mail_loop/i.test(
      joined,
    )
  ) {
    return "live_env.reflect_live_source_mail_loop";
  }
  if (
    /stage_play_processed_mail_packet|read_processed_live_source_mail/i.test(
      joined,
    )
  ) {
    return "live_env.read_processed_live_source_mail";
  }
  if (/check_live_source_mail/i.test(joined)) {
    return "live_env.check_live_source_mail";
  }
  if (/read_live_source_mail/i.test(joined)) {
    return "live_env.read_live_source_mail";
  }
  if (
    /stage_play_live_source_quality|query_live_source_quality/i.test(joined)
  ) {
    return "live_env.query_live_source_quality";
  }
  if (
    /stage_play_workstation_goal_context_read_result|query_workstation_goal_context|helix\.agent_goal_session\.v1/i.test(
      joined,
    )
  ) {
    return "live_env.query_workstation_goal_context";
  }
  if (
    /stage_play_live_source_current_state|summarize_live_source_current_state/i.test(
      joined,
    )
  ) {
    return "live_env.summarize_live_source_current_state";
  }
  if (
    /stage_play_reflection_result|stage_play_badge_graph|stage_play_output_lane_projection|stage_play_job_plan|stage_play_checkpoint_request_result|stage_play_checkpoint_request|stage_play_checkpoint_queue|stage_play_builder_catalog|stage_play_source_query|stage_play_graph_draft_validation|reflect_stage_play_context|plan_stage_play_job|request_stage_play_checkpoint|describe_stage_builder|query_stage_sources|draft_stage_play_graph|validate_stage_play_graph/i.test(
      joined,
    )
  ) {
    return "helix_ask.reflect_stage_play_context";
  }
  if (
    /dottie_observer_subscription_receipt|helix\.dottie_observer_subscription\.v1|observer\.attach|observer\.detach|observer_subscription/i.test(
      joined,
    )
  ) {
    return "situation-room-pipelines.observer.attach";
  }
  if (
    /dottie_observer_query_receipt|observer\.query|observer_query/i.test(joined)
  ) {
    return "situation-room-pipelines.observer.query";
  }
  if (
    /dottie_voice_receipt|helix\.dottie_voice_receipt\.v1|voice_delivery\.propose_from_trace|voice_delivery/i.test(
      joined,
    )
  ) {
    return "situation-room-pipelines.voice_delivery.propose_from_trace";
  }
  if (
    /dottie_manifest_preset_receipt|helix\.dottie_manifest_preset_receipt\.v1/i.test(
      joined,
    )
  ) {
    return "situation-room-pipelines.dottie.manifest";
  }
  if (/calculator_receipt|calculator_result/i.test(joined))
    return "scientific-calculator.solve_expression";
  if (/doc_summary/i.test(joined)) return "docs-viewer.summarize_doc";
  if (/doc_equation_context|doc_equation_context\/v1/i.test(joined))
    return "docs-viewer.doc_equation_context";
  if (
    /doc_location_result|doc_location_matches|doc_evidence_location|line_backed_locations/i.test(
      joined,
    )
  )
    return "docs-viewer.locate_in_doc";
  if (/doc_open_receipt|active_doc_path/i.test(joined))
    return "docs-viewer.open";
  if (/doc_search_results|doc_candidate_validation/i.test(joined))
    return "docs-viewer.search_docs";
  if (/note_update_receipt|note_/i.test(joined))
    return "workstation-notes.append";
  if (/process_graph_overview/i.test(joined)) return "process-graph.inspect";
  if (
    /visual_context_pack|situation_context_pack|visual_capture|image_lens|permission_denied/i.test(
      joined,
    )
  )
    return "situation-room.describe_visual_capture";
  if (
    /workspace_action_receipt/i.test(joined) &&
    /docs-viewer|docs_viewer/i.test(joined)
  )
    return "docs-viewer.open";
  if (
    /workspace_action_receipt/i.test(joined) &&
    /scientific-calculator/i.test(joined)
  )
    return "scientific-calculator.open";
  if (
    /workspace_action_receipt/i.test(joined) &&
    /workstation-notes/i.test(joined)
  )
    return "workstation-notes.open";
  return null;
};

const selectedDottieCapabilityHasCurrentTurnObservation = (
  capability: string,
  artifacts: Record<string, unknown>[],
): boolean => {
  if (!isDottieObserverCapability(capability)) return false;
  return artifacts.some((artifact) => {
    const sourceScope = readString(artifact.source_scope);
    if (
      sourceScope === "prior_context" ||
      sourceScope === "prior_turn_context" ||
      sourceScope === "prior_artifact"
    )
      return false;
    return artifactKindMatchesCapability(capability, artifact);
  });
};

const selectedRepoEvidenceCapabilityHasCurrentTurnObservation = (
  capability: string,
  artifacts: Record<string, unknown>[],
): boolean => {
  if (
    capability !== "repo-code.search_concept" &&
    capability !== "scholarly-research.lookup_papers" &&
    capability !== "scholarly-research.fetch_full_text" &&
    capability !== "research-library.read_document" &&
    capability !== "research-library.apply_evidence_enrichment" &&
    capability !== "internet_search.web_research" &&
    capability !== "internet-search.search_web"
  )
    return false;
  return artifacts.some((artifact) => {
    const sourceScope = readString(artifact.source_scope);
    if (
      sourceScope === "prior_context" ||
      sourceScope === "prior_turn_context" ||
      sourceScope === "prior_artifact"
    )
      return false;
    return artifactKindMatchesCapability(capability, artifact);
  });
};

const hasCurrentTurnRepoCodeEvidenceObservation = (
  payload: Record<string, unknown>,
): boolean =>
  readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((artifact): artifact is Record<string, unknown> =>
      Boolean(artifact),
    )
    .some((artifact) => {
      const sourceScope = readString(artifact.source_scope);
      if (
        sourceScope === "prior_context" ||
        sourceScope === "prior_turn_context" ||
        sourceScope === "prior_artifact"
      )
        return false;
      return artifactKindMatchesCapability(
        "repo-code.search_concept",
        artifact,
      );
    });

const repoEvidenceAnswerTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  if (
    readString(payload.terminal_artifact_kind) !== "repo_code_evidence_answer"
  )
    return false;
  if (!goalSatisfactionAllowsTerminal(payload)) return false;
  if (!hasCurrentTurnRepoCodeEvidenceObservation(payload)) return false;
  return hasPostObservationModelDecision(payload);
};

const activeDocIdentityTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  if (readString(payload.terminal_artifact_kind) !== "active_doc_identity")
    return false;
  const goal = readRecord(payload.canonical_goal_frame);
  if (readString(goal?.goal_kind) !== "active_doc_identity") return false;
  if (readString(goal?.required_terminal_kind) !== "active_doc_identity")
    return false;
  if (!goalSatisfactionAllowsTerminal(payload)) return false;

  const directIdentity = readRecord(payload.active_doc_identity);
  if (readString(directIdentity?.active_doc_path)) return true;

  return readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .some((artifact) => {
      const record = artifact;
      const artifactPayload = readRecord(record?.payload);
      return Boolean(
        record &&
        readString(record.kind) === "active_doc_identity" &&
        readString(artifactPayload?.active_doc_path),
      );
    });
};

const isVisualSituationTerminalKind = (kind: string | null): boolean =>
  kind === "situation_context_pack" ||
  kind === "visual_context_pack" ||
  kind === "visual_frame_evidence";

const goalRequiresVisualSituationTerminal = (
  payload: Record<string, unknown>,
  goal: Record<string, unknown> | null,
): boolean => {
  if (isVisualSituationTerminalKind(readString(payload.terminal_artifact_kind)))
    return true;
  if (isVisualSituationTerminalKind(readString(payload.required_terminal_kind)))
    return true;
  if (isVisualSituationTerminalKind(readString(goal?.required_terminal_kind)))
    return true;
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  if (
    isVisualSituationTerminalKind(
      readString(canonicalGoal?.required_terminal_kind),
    )
  )
    return true;
  const terminalContract = readRecord(goal?.terminal_contract);
  return readArray(terminalContract?.required_terminal_kinds).some((kind) =>
    isVisualSituationTerminalKind(readString(kind)),
  );
};

const hasGoalSatisfyingVisualSituationEvidence = (
  payload: Record<string, unknown>,
): boolean => {
  const goal = readRecord(payload.goal_satisfaction_evaluation);
  if (!goalRequiresVisualSituationTerminal(payload, goal)) return false;
  if (
    readString(goal?.satisfaction) !== "satisfied" ||
    readString(goal?.next_decision) !== "allow_terminal"
  ) {
    return false;
  }
  const requiredEvidence = readArray(goal?.required_evidence)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const visualObservationSatisfied = requiredEvidence.some(
    (entry) =>
      readString(entry.kind) === "visual_observation" &&
      entry.satisfied === true,
  );
  const fieldEvaluationSatisfied = requiredEvidence.some(
    (entry) =>
      readString(entry.kind) === "field_evaluation" && entry.satisfied === true,
  );
  const situationContextPackSatisfied = requiredEvidence.some(
    (entry) =>
      readString(entry.kind) === "situation_context_pack" &&
      entry.satisfied === true,
  );
  if (
    (visualObservationSatisfied && fieldEvaluationSatisfied) ||
    situationContextPackSatisfied
  ) {
    return true;
  }
  return readArray(goal?.observed_results)
    .map(readRecord)
    .some((entry) =>
      Boolean(
        entry?.supports_goal === true &&
        /^(?:situation_context_pack|visual_context_pack|visual_frame_evidence)$/.test(
          readString(entry.kind) ?? "",
        ),
      ),
    );
};

const observedArtifactRefsForIteration = (
  iteration: Record<string, unknown>,
): string[] => {
  const toolObservation = readRecord(iteration.tool_observation);
  return Array.from(
    new Set([
      ...readStringArray(iteration.observed_artifact_refs),
      ...readStringArray(iteration.observation_refs),
      ...readStringArray(iteration.artifact_refs),
      ...readStringArray(iteration.created_artifact_refs),
      ...readStringArray(toolObservation?.artifact_refs),
      ...readStringArray(toolObservation?.observed_artifact_refs),
      ...(readString(toolObservation?.artifact_id)
        ? [readString(toolObservation?.artifact_id) as string]
        : []),
      ...(readString(toolObservation?.observation_id)
        ? [readString(toolObservation?.observation_id) as string]
        : []),
    ]),
  );
};

const capabilityFromRecord = (
  record: Record<string, unknown> | null,
): string | null =>
  readString(record?.capability_key) ??
  readString(record?.tool_name) ??
  readString(record?.toolName) ??
  readString(record?.chosen_capability) ??
  readString(record?.executed_action_key);

const capabilityKeyMatchesExpected = (
  actualCapability: string | null | undefined,
  expectedCapability: string | null | undefined,
): boolean => {
  const actual = readString(actualCapability);
  const expected = readString(expectedCapability);
  if (!actual || !expected) return false;
  return (
    actual === expected ||
    explicitCapabilityMatches(expected, actual) ||
    explicitCapabilityMatches(actual, expected)
  );
};

const artifactCapability = (
  artifact: Record<string, unknown> | null,
): string | null => {
  const payload = readRecord(artifact?.payload);
  return capabilityFromRecord(payload) ?? capabilityFromRecord(artifact);
};

const selectedCapabilityMatches = (
  payload: Record<string, unknown>,
  capability: string,
): boolean => {
  const topLevelDecision = readRecord(payload.agent_step_decision);
  const topLevelModelDecision = readRecord(topLevelDecision?.model_decision);
  if (
    capabilityKeyMatchesExpected(
      readString(payload.selected_capability),
      capability,
    ) ||
    capabilityKeyMatchesExpected(
      readString(topLevelDecision?.chosen_capability),
      capability,
    ) ||
    capabilityKeyMatchesExpected(
      readString(topLevelModelDecision?.chosen_capability),
      capability,
    ) ||
    capabilityKeyMatchesExpected(
      readString(readRecord(payload.runtime_tool_call)?.capability_key),
      capability,
    )
  ) {
    return true;
  }
  const loop = readRecord(payload.agent_runtime_loop);
  return readArray(loop?.iterations).some((iteration) => {
    const record = readRecord(iteration);
    return Boolean(
      record &&
      (capabilityKeyMatchesExpected(
        readString(record.chosen_capability),
        capability,
      ) ||
        capabilityKeyMatchesExpected(
          readString(record.executed_action_key),
          capability,
        ) ||
        capabilityKeyMatchesExpected(
          capabilityFromRecord(readRecord(record.runtime_tool_call)),
          capability,
        )),
    );
  });
};

export function hasRuntimeToolCallForSelectedCapability(
  payload: Record<string, unknown>,
  capability: string,
): boolean {
  if (
    capabilityKeyMatchesExpected(
      readString(readRecord(payload.runtime_tool_call)?.capability_key),
      capability,
    )
  ) {
    return true;
  }
  const loop = readRecord(payload.agent_runtime_loop);
  if (
    readArray(loop?.iterations).some((iteration) => {
      const record = readRecord(iteration);
      if (!record) return false;
      return (
        capabilityKeyMatchesExpected(
          capabilityFromRecord(readRecord(record.runtime_tool_call)),
          capability,
        ) ||
        capabilityKeyMatchesExpected(
          readString(record.executed_action_key),
          capability,
        )
      );
    })
  ) {
    return true;
  }
  return readArray(payload.current_turn_artifact_ledger).some((artifact) => {
    const record = readRecord(artifact);
    if (!record) return false;
    return (
      readString(record.kind) === "runtime_tool_call" &&
      capabilityKeyMatchesExpected(artifactCapability(record), capability)
    );
  });
}

const hasMicroDeckQueryObservation = (
  payload: Record<string, unknown>,
): boolean => {
  const loop = readRecord(payload.agent_runtime_loop);
  if (
    readArray(loop?.iterations).some((iteration) => {
      const record = readRecord(iteration);
      const toolObservation = readRecord(record?.tool_observation);
      return Boolean(
        toolObservation &&
        artifactKindMatchesCapability(
          MICRODECK_QUERY_CAPABILITY,
          toolObservation,
        ),
      );
    })
  ) {
    return true;
  }
  return readArray(payload.current_turn_artifact_ledger).some((artifact) =>
    artifactKindMatchesCapability(
      MICRODECK_QUERY_CAPABILITY,
      readRecord(artifact),
    ),
  );
};

const hasMicroDeckDraftObservation = (
  payload: Record<string, unknown>,
): boolean => {
  const loop = readRecord(payload.agent_runtime_loop);
  if (
    readArray(loop?.iterations).some((iteration) => {
      const record = readRecord(iteration);
      const toolObservation = readRecord(record?.tool_observation);
      return Boolean(
        toolObservation &&
        artifactKindMatchesCapability(
          MICRODECK_DRAFT_CAPABILITY,
          toolObservation,
        ),
      );
    })
  ) {
    return true;
  }
  return readArray(payload.current_turn_artifact_ledger).some((artifact) =>
    artifactKindMatchesCapability(
      MICRODECK_DRAFT_CAPABILITY,
      readRecord(artifact),
    ),
  );
};

const isMicroDeckObservationBackedRoute = (
  payload: Record<string, unknown>,
): boolean =>
  selectedCapabilityMatches(payload, MICRODECK_QUERY_CAPABILITY) ||
  selectedCapabilityMatches(payload, MICRODECK_DRAFT_CAPABILITY) ||
  hasMicroDeckQueryObservation(payload) ||
  hasMicroDeckDraftObservation(payload);

const selectedMicroDeckCapability = (
  payload: Record<string, unknown>,
): string => {
  if (
    selectedCapabilityMatches(payload, MICRODECK_DRAFT_CAPABILITY) ||
    hasMicroDeckDraftObservation(payload)
  ) {
    return MICRODECK_DRAFT_CAPABILITY;
  }
  return MICRODECK_QUERY_CAPABILITY;
};

const artifactLinkedToIteration = (
  artifact: Record<string, unknown> | null,
  iteration: Record<string, unknown>,
): boolean => {
  if (!artifact) return false;
  const decisionId =
    readString(iteration.decision_id) ?? readString(iteration.decision_ref);
  const payload = readRecord(artifact.payload);
  const explicitDecisionRefs = [
    readString(artifact.decision_ref),
    readString(artifact.agent_step_decision_ref),
    readString(artifact.runtime_decision_ref),
    readString(artifact.prior_agent_step_decision_ref),
    readString(payload?.decision_ref),
    readString(payload?.agent_step_decision_ref),
    readString(payload?.runtime_decision_ref),
    readString(payload?.prior_agent_step_decision_ref),
  ].filter((entry): entry is string => Boolean(entry));
  if (explicitDecisionRefs.length > 0)
    return Boolean(decisionId && explicitDecisionRefs.includes(decisionId));
  const artifactId = readString(artifact.artifact_id);
  if (!artifactId) return false;
  return observedArtifactRefsForIteration(iteration).includes(artifactId);
};

export function isSourceCapabilityDiagnosticTurn(
  payload: Record<string, unknown>,
): boolean {
  const goalKind = payloadGoalKind(payload);
  if (goalKind && MODEL_DIRECT_ANSWER_GOAL_KINDS.has(goalKind)) return false;
  if (goalKind && SOURCE_CAPABILITY_GOAL_KINDS.has(goalKind)) return true;
  const sourceTargetIntent = readRecord(payload.source_target_intent);
  const targetSource = readString(sourceTargetIntent?.target_source);
  const targetKind = readString(sourceTargetIntent?.target_kind);
  const committedSourceTarget =
    readCommittedAskRoute(payload)?.route.source_target;
  if (
    committedSourceTarget &&
    !["unknown", "none", "model_only", "general_background"].includes(
      committedSourceTarget,
    ) &&
    (targetSource === "model_only" || targetKind === "general_background")
  ) {
    return true;
  }
  if (
    targetSource &&
    !["unknown", "none", "model_only", "general_background"].includes(
      targetSource,
    )
  )
    return true;
  if (
    targetKind &&
    !["unknown", "none", "model_only", "general_background"].includes(
      targetKind,
    )
  )
    return true;
  const route = `${readString(payload.route_reason_code) ?? ""} ${readString(payload.route) ?? ""}`;
  return /\b(?:calculator|docs?|doc_|visual|live|note|panel|debug|process_graph|workspace)\b/i.test(
    route,
  );
}

export function isModelDirectAnswerTurn(
  payload: Record<string, unknown>,
): boolean {
  const goalKind = payloadGoalKind(payload);
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  const sourceTargetIntent = readRecord(payload.source_target_intent);
  const committedRoute = readCommittedAskRoute(payload);
  const committedSourceTarget = committedRoute?.route.source_target;
  const committedGoalKind = committedRoute?.canonical_goal.goal_kind;
  const committedTerminalKind =
    committedRoute?.canonical_goal.required_terminal_kind;
  const committedSourceBackedRoute = Boolean(
    committedSourceTarget &&
    !["unknown", "none", "model_only", "general_background"].includes(
      committedSourceTarget,
    ) &&
    committedGoalKind !== "model_only_concept" &&
    committedTerminalKind !== "direct_answer_text",
  );
  if (committedSourceBackedRoute) return false;
  return Boolean(
    (goalKind && MODEL_DIRECT_ANSWER_GOAL_KINDS.has(goalKind)) ||
    terminalKind === "direct_answer_text" ||
    finalAnswerSource === "model_direct_answer" ||
    readString(sourceTargetIntent?.target_source) === "model_only" ||
    readString(sourceTargetIntent?.target_kind) === "general_background",
  );
}

export function hasAgentRuntimeLoopDecisionChain(
  payload: Record<string, unknown>,
): boolean {
  const loop = readRecord(payload.agent_runtime_loop);
  const iterations = readArray(loop?.iterations);
  if (iterations.length > 0) {
    return iterations.some((iteration) => {
      const record = readRecord(iteration);
      return Boolean(
        readString(record?.decision_id) ||
        readString(record?.decision_ref) ||
        readString(record?.chosen_capability) ||
        readRecord(record?.agent_step_decision),
      );
    });
  }
  const decision = readRecord(payload.agent_step_decision);
  if (
    readString(decision?.decision_id) ||
    readString(decision?.chosen_capability)
  )
    return true;
  const agentStepLoop = readRecord(payload.agent_step_loop);
  return readArray(agentStepLoop?.steps).some((step) => {
    const record = readRecord(step);
    return Boolean(
      readString(record?.decision_ref) ||
      readString(record?.chosen_capability) ||
      readString(record?.next_step),
    );
  });
}

export function hasSelectedCapabilityObservation(
  payload: Record<string, unknown>,
): boolean {
  if (activeDocIdentityTerminalAllowed(payload)) return true;
  if (hasGoalSatisfyingVisualSituationEvidence(payload)) return true;
  const loop = readRecord(payload.agent_runtime_loop);
  const iterations = readArray(loop?.iterations);
  const agentStepLoop = readRecord(payload.agent_step_loop);
  const agentStepLoopSteps = readArray(agentStepLoop?.steps);
  const artifacts = readArray(payload.current_turn_artifact_ledger);
  const artifactById = new Map<string, Record<string, unknown>>();
  for (const artifact of artifacts) {
    const record = readRecord(artifact);
    const artifactId = readString(record?.artifact_id);
    if (record && artifactId) artifactById.set(artifactId, record);
  }
  const capabilityPlan = readRecord(payload.capability_plan);
  const toolTurnChainAudit = readRecord(payload.tool_turn_chain_audit);
  const capabilityCatalogSelectionProven =
    selectedCapabilityMatches(
      payload,
      "helix_ask.inspect_capability_catalog",
    ) ||
    capabilityKeyMatchesExpected(
      readString(capabilityPlan?.selected_capability),
      "helix_ask.inspect_capability_catalog",
    ) ||
    capabilityKeyMatchesExpected(
      readString(toolTurnChainAudit?.executed_capability),
      "helix_ask.inspect_capability_catalog",
    );
  if (
    capabilityCatalogSelectionProven &&
    artifacts
      .map(readRecord)
      .some((artifact) =>
        artifactKindMatchesCapability(
          "helix_ask.inspect_capability_catalog",
          artifact,
        ),
      )
  ) {
    return true;
  }

  const runtimeLoopHasObservation = iterations.some((iteration) => {
    const record = readRecord(iteration);
    const capability = readString(record?.chosen_capability);
    if (!record || !capability || capability === "model.direct_answer")
      return false;
    const refs = observedArtifactRefsForIteration(record);
    if (
      refs.some((ref) => {
        const artifact = artifactById.get(ref) ?? null;
        return (
          artifactLinkedToIteration(artifact, record) &&
          artifactKindMatchesCapability(capability, artifact)
        );
      })
    )
      return true;
    if (
      selectedDottieCapabilityHasCurrentTurnObservation(
        capability,
        Array.from(artifactById.values()),
      )
    ) {
      return true;
    }
    if (
      selectedRepoEvidenceCapabilityHasCurrentTurnObservation(
        capability,
        Array.from(artifactById.values()),
      )
    ) {
      return true;
    }
    const toolObservation = readRecord(record.tool_observation);
    if (!toolObservation) return false;
    const status = readString(toolObservation.status);
    const ok = readBoolean(toolObservation.ok);
    return (
      (/completed|observed|ok|success/i.test(status ?? "") || ok === true) &&
      artifactKindMatchesCapability(capability, toolObservation)
    );
  });
  if (runtimeLoopHasObservation) return true;

  return agentStepLoopSteps.some((step, index) => {
    const record = readRecord(step);
    const capability = readString(record?.chosen_capability);
    if (!record || !capability || capability === "model.direct_answer")
      return false;
    const candidateSteps = agentStepLoopSteps
      .slice(index)
      .map((entry) => readRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const refs = Array.from(
      new Set(
        candidateSteps.flatMap((entry) =>
          observedArtifactRefsForIteration(entry),
        ),
      ),
    );
    return refs.some((ref) => {
      const artifact = artifactById.get(ref) ?? null;
      return (
        Boolean(artifact) && artifactKindMatchesCapability(capability, artifact)
      );
    });
  });
}

export function buildCapabilityBindingMismatchObservation(
  payload: Record<string, unknown>,
): HelixCapabilityBindingMismatchObservation | null {
  if (hasSelectedCapabilityObservation(payload)) return null;
  const committedRoute = readCommittedAskRoute(payload);
  const loop = readRecord(payload.agent_runtime_loop);
  const iterations = readArray(loop?.iterations)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const artifacts = readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const artifactById = new Map<string, Record<string, unknown>>();
  for (const artifact of artifacts) {
    const artifactId = readString(artifact.artifact_id);
    if (artifactId) artifactById.set(artifactId, artifact);
  }
  for (const iteration of iterations) {
    const selectedCapability = readString(iteration.chosen_capability);
    if (!selectedCapability) continue;
    const selectedFamily = inferCommittedRouteToolFamily(selectedCapability);
    const selectedFamilySuppressed =
      committedRoute?.capability_policy.suppressed_tool_families.includes(
        selectedFamily,
      ) === true;
    const selectedFamilyAllowed =
      !committedRoute ||
      selectedFamily === "unknown" ||
      selectedFamily === "model_only" ||
      committedRoute.capability_policy.allowed_tool_families.length === 0 ||
      committedRoute.capability_policy.allowed_tool_families.includes(
        selectedFamily,
      );
    if (
      committedRoute &&
      (!selectedFamilyAllowed || selectedFamilySuppressed)
    ) {
      return {
        schema: "helix.capability_binding_mismatch_observation.v1",
        selected_capability: selectedCapability,
        observed_artifact_refs: [],
        observed_artifact_kinds: [],
        observed_capability_families:
          committedRoute.capability_policy.allowed_tool_families,
        suggested_capability:
          committedRoute.capability_policy.allowed_tool_families[0] ?? null,
        suggested_repair: "fail_closed",
        repair_reason: selectedFamilySuppressed
          ? "selected_capability_not_allowed_by_committed_route: selected capability family is suppressed by committed route"
          : "selected_capability_not_allowed_by_committed_route: selected capability family is outside committed route policy",
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const referencedArtifacts = observedArtifactRefsForIteration(iteration)
      .map((ref) => artifactById.get(ref) ?? null)
      .filter((artifact): artifact is Record<string, unknown> =>
        Boolean(artifact),
      );
    const observedArtifacts =
      selectedCapability === "model.direct_answer" &&
      referencedArtifacts.length === 0
        ? artifacts.filter((artifact) => {
            const sourceScope = readString(artifact.source_scope);
            if (
              sourceScope === "prior_context" ||
              sourceScope === "prior_turn_context" ||
              sourceScope === "prior_artifact"
            )
              return false;
            const family = capabilityFamilyForArtifact(artifact);
            return Boolean(
              family &&
              /^docs-viewer\.|^situation-room-pipelines\.(?:dottie|observer|voice_delivery)/i.test(
                family,
              ),
            );
          })
        : referencedArtifacts;
    if (observedArtifacts.length === 0) continue;
    const observedFamilies = Array.from(
      new Set(
        observedArtifacts
          .map(capabilityFamilyForArtifact)
          .filter((entry): entry is string => Boolean(entry)),
      ),
    );
    if (
      selectedCapability === "model.direct_answer" &&
      observedFamilies.some((family) =>
        /^docs-viewer\.|^situation-room-pipelines\.(?:dottie|observer|voice_delivery)/i.test(
          family,
        ),
      )
    ) {
      const suggestedCapability = observedFamilies[0] ?? null;
      const observedRefs = observedArtifacts
        .map((artifact) => readString(artifact.artifact_id))
        .filter((entry): entry is string => Boolean(entry));
      const observedKinds = Array.from(
        new Set(
          observedArtifacts
            .map((artifact) => readString(artifact.kind))
            .filter((entry): entry is string => Boolean(entry)),
        ),
      );
      return {
        schema: "helix.capability_binding_mismatch_observation.v1",
        selected_capability: selectedCapability,
        observed_artifact_refs: observedRefs,
        observed_artifact_kinds: observedKinds,
        observed_capability_families: observedFamilies,
        suggested_capability: suggestedCapability,
        suggested_repair: "rebind_model_direct_answer_to_observed_tool_family",
        repair_reason: `Model-direct answer was selected, but current-turn observations belong to ${suggestedCapability}; expose this so the model can repair, retry, ask the user, or fail closed before terminal failure.`,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    if (
      observedArtifacts.some(
        (artifact) =>
          artifactLinkedToIteration(artifact, iteration) &&
          artifactKindMatchesCapability(selectedCapability, artifact),
      )
    ) {
      continue;
    }
    if (observedFamilies.length === 0) continue;
    const suggestedCapability =
      observedFamilies.find((family) => family !== selectedCapability) ?? null;
    if (!suggestedCapability) continue;
    const observedRefs = observedArtifacts
      .map((artifact) => readString(artifact.artifact_id))
      .filter((entry): entry is string => Boolean(entry));
    const observedKinds = Array.from(
      new Set(
        observedArtifacts
          .map((artifact) => readString(artifact.kind))
          .filter((entry): entry is string => Boolean(entry)),
      ),
    );
    return {
      schema: "helix.capability_binding_mismatch_observation.v1",
      selected_capability: selectedCapability,
      observed_artifact_refs: observedRefs,
      observed_artifact_kinds: observedKinds,
      observed_capability_families: observedFamilies,
      suggested_capability: suggestedCapability,
      suggested_repair: "rebind_selected_capability_to_observed_tool_plan",
      repair_reason: `Selected capability ${selectedCapability} did not match observed artifact family ${suggestedCapability}; expose this as an observation so the model can repair, retry, ask the user, or fail closed.`,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  return null;
}

export function hasPostObservationModelDecision(
  payload: Record<string, unknown>,
): boolean {
  const topLevelDecision = readRecord(payload.agent_step_decision);
  if (topLevelDecision) {
    const timing = readString(topLevelDecision.decision_timing);
    const sampling = readRecord(topLevelDecision.sampling);
    const authority =
      readString(topLevelDecision.decision_authority) ??
      readString(topLevelDecision.sampling_mode) ??
      readString(sampling?.mode);
    const modelDecision = readRecord(topLevelDecision.model_decision);
    const nextStep =
      readString(topLevelDecision.next_step) ??
      readString(modelDecision?.next_step);
    const chosenCapability =
      readString(topLevelDecision.chosen_capability) ??
      readString(modelDecision?.chosen_capability);
    const decisionAuthorityOk = /llm|model|deterministic_policy_fallback/i.test(
      authority ?? "",
    );
    if (
      nextStep === "answer" &&
      decisionAuthorityOk &&
      (/post_observation|terminal_review/i.test(timing ?? "") ||
        chosenCapability === "model.direct_answer")
    ) {
      return true;
    }
  }
  const loop = readRecord(payload.agent_runtime_loop);
  const iterations = readArray(loop?.iterations);
  if (
    iterations.some((iteration) => {
      const record = readRecord(iteration);
      const timing = readString(record?.decision_timing);
      const authority =
        readString(record?.decision_authority) ??
        readString(record?.sampling_mode);
      const nextStep = readString(record?.next_step);
      const observationRole = readString(record?.observation_role);
      const decisionAuthorityOk =
        /llm|model|deterministic_policy_fallback/i.test(authority ?? "");
      return (
        (/post_observation|terminal_review/i.test(timing ?? "") &&
          decisionAuthorityOk) ||
        (nextStep === "answer" &&
          decisionAuthorityOk &&
          (!observationRole ||
            /model_answer_draft|terminal_decision/i.test(observationRole)))
      );
    })
  ) {
    return true;
  }
  const artifacts = readArray(payload.current_turn_artifact_ledger);
  if (
    artifacts.some((artifact) => {
      const record = readRecord(artifact);
      const kind = readString(record?.kind);
      const payloadRecord = readRecord(record?.payload);
      return (
        kind === "post_tool_observation_review" ||
        readString(payloadRecord?.schema) ===
          "helix.post_tool_observation_review.v1"
      );
    })
  ) {
    return true;
  }
  const bridge = readRecord(payload.post_tool_authority_bridge);
  if (
    readString(bridge?.schema) === "helix.post_tool_authority_bridge.v1" &&
    readString(bridge?.observation_support_status) === "supports_answer" &&
    readArray(bridge?.tool_observation_refs).length > 0 &&
    readArray(bridge?.answer_draft_refs).length > 0
  ) {
    return true;
  }
  return false;
}

export const hasLedgerBackedPostObservationAnswerDraft = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalArtifactKind = readString(payload.terminal_artifact_kind);
  if (
    terminalArtifactKind !== "model_synthesized_answer" &&
    terminalArtifactKind !== "compound_evidence_synthesis_answer"
  ) {
    return false;
  }
  if (readString(payload.final_answer_source) !== "final_answer_draft")
    return false;
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const routeProduct = readRecord(payload.route_product_contract);
  const ledgerBackedCompoundDraft = readRecord(
    payload.ledger_backed_compound_final_answer_draft,
  );
  const requiredTerminalKind =
    readString(canonicalGoal?.required_terminal_kind) ??
    readString(routeProduct?.required_terminal_kind) ??
    readString(routeProduct?.required_terminal_artifact_kind);
  const topLevelFinalAnswerDraft = readRecord(payload.final_answer_draft);
  const ledgerBackedCompoundTerminalReconciliation = Boolean(
    terminalArtifactKind === "compound_evidence_synthesis_answer" &&
      readString(ledgerBackedCompoundDraft?.schema) ===
        "helix.ledger_backed_compound_final_answer_draft.v1" &&
      readString(ledgerBackedCompoundDraft?.turn_id) ===
        readString(payload.turn_id) &&
      readString(ledgerBackedCompoundDraft?.terminal_artifact_kind) ===
        terminalArtifactKind &&
      readString(ledgerBackedCompoundDraft?.final_answer_draft_ref) ===
        readString(topLevelFinalAnswerDraft?.artifact_id),
  );
  if (
    requiredTerminalKind !== terminalArtifactKind &&
    !ledgerBackedCompoundTerminalReconciliation
  ) {
    return false;
  }

  const artifacts = readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((artifact): artifact is Record<string, unknown> =>
      Boolean(artifact),
    );
  if (terminalArtifactKind === "compound_evidence_synthesis_answer") {
    const artifactIndexById = new Map<string, number>();
    artifacts.forEach((artifact, index) => {
      const sourceScope = readString(artifact.source_scope);
      const artifactId = readString(artifact.artifact_id);
      if (
        artifactId &&
        sourceScope !== "prior_context" &&
        sourceScope !== "prior_turn_context" &&
        sourceScope !== "prior_artifact"
      ) {
        artifactIndexById.set(artifactId, index);
      }
    });
    const itineraryExecutionState = readRecord(
      payload.capability_itinerary_execution_state,
    );
    const compoundSubgoalValues = readArray(payload.compound_subgoal_ledger);
    const compoundSubgoals = (compoundSubgoalValues.length > 0
      ? compoundSubgoalValues
      : readArray(itineraryExecutionState?.compound_subgoal_ledger))
      .map(readRecord)
      .filter(
        (subgoal): subgoal is Record<string, unknown> => Boolean(subgoal),
      );
    if (compoundSubgoals.length === 0) return false;
    const requiredObservationRefs = compoundSubgoals.map((subgoal) => {
      const guardedNoopSatisfied = Boolean(
        subgoal.satisfied_without_execution === true &&
        subgoal.mutation_performed === false &&
        readString(subgoal.satisfaction_reason),
      );
      if (
        readString(subgoal.satisfaction) !== "satisfied" ||
        readString(subgoal.rail_status) !== "complete" ||
        (!guardedNoopSatisfied &&
          (!readString(subgoal.selected_capability) ||
            !readString(subgoal.executed_capability)))
      ) {
        return null;
      }
      const observationRef = readString(subgoal.observation_ref);
      return observationRef && artifactIndexById.has(observationRef)
        ? observationRef
        : null;
    });
    if (requiredObservationRefs.some((ref) => !ref)) return false;
    const observationRefs = requiredObservationRefs.filter(
      (ref): ref is string => Boolean(ref),
    );
    const latestObservationIndex = Math.max(
      ...observationRefs.map((ref) => artifactIndexById.get(ref) ?? -1),
    );
    if (latestObservationIndex < 0) return false;
    const materializedCompoundAnswer = readRecord(
      payload.compound_evidence_synthesis_answer,
    );
    return artifacts.slice(latestObservationIndex + 1).some((artifact) => {
      const artifactPayload = readRecord(artifact.payload);
      const artifactId = readString(artifact.artifact_id);
      const matchingTopLevelDraft =
        artifactId &&
        artifactId === readString(topLevelFinalAnswerDraft?.artifact_id)
          ? topLevelFinalAnswerDraft
          : null;
      const kind = readString(artifact.kind);
      const schema =
        readString(artifactPayload?.schema) ??
        readString(artifact.payload_schema) ??
        readString(matchingTopLevelDraft?.schema);
      if (
        kind !== "final_answer_draft" &&
        schema !== "helix.final_answer_draft.v1"
      ) {
        return false;
      }
      const text =
        readString(artifactPayload?.text) ??
        readString(artifactPayload?.answer_text) ??
        readString(matchingTopLevelDraft?.text) ??
        readString(matchingTopLevelDraft?.answer_text) ??
        readString(artifact.text) ??
        readString(artifact.text_preview) ??
        readString(materializedCompoundAnswer?.text) ??
        readString(materializedCompoundAnswer?.answer_text);
      if (!text) return false;
      const supportRefs = new Set([
        ...readStringArray(artifactPayload?.support_refs),
        ...readStringArray(artifactPayload?.evidence_refs),
        ...readStringArray(artifactPayload?.observation_refs),
        ...readStringArray(artifactPayload?.grounded_observation_refs),
        ...readStringArray(artifactPayload?.grounded_in_observation_refs),
        ...readStringArray(matchingTopLevelDraft?.support_refs),
        ...readStringArray(matchingTopLevelDraft?.evidence_refs),
        ...readStringArray(matchingTopLevelDraft?.observation_refs),
        ...readStringArray(matchingTopLevelDraft?.grounded_observation_refs),
        ...readStringArray(
          matchingTopLevelDraft?.grounded_in_observation_refs,
        ),
        ...readStringArray(materializedCompoundAnswer?.support_refs),
        ...readStringArray(
          materializedCompoundAnswer?.subgoal_observation_refs,
        ),
      ]);
      return observationRefs.every((ref) => supportRefs.has(ref));
    });
  }

  const latestObservationIndex = artifacts.reduce((latest, artifact, index) => {
    const sourceScope = readString(artifact.source_scope);
    if (
      sourceScope === "prior_context" ||
      sourceScope === "prior_turn_context" ||
      sourceScope === "prior_artifact"
    ) {
      return latest;
    }
    const artifactPayload = readRecord(artifact.payload);
    const haystack = [
      readString(artifact.kind),
      readString(artifact.artifact_id),
      readString(artifactPayload?.schema),
      readString(artifactPayload?.kind),
      readString(artifactPayload?.capability_key),
      readString(artifactPayload?.tool_name),
    ]
      .filter(Boolean)
      .join(" ");
    return /moral_graph_reflection|ideology_context_reflection|procedural_moral_classification|helix\.moral_graph_reflection_observation\.v1|agent_step_observation_packet|runtime_tool_observation/i.test(
      haystack,
    )
      ? index
      : latest;
  }, -1);
  if (latestObservationIndex < 0) return false;

  return artifacts.slice(latestObservationIndex + 1).some((artifact) => {
    const artifactPayload = readRecord(artifact.payload);
    const kind = readString(artifact.kind);
    const schema = readString(artifactPayload?.schema);
    if (
      kind !== "final_answer_draft" &&
      schema !== "helix.final_answer_draft.v1"
    )
      return false;
    const text =
      readString(artifactPayload?.text) ??
      readString(artifactPayload?.answer_text);
    if (!text) return false;
    const supportRefs = [
      ...readStringArray(artifactPayload?.support_refs),
      ...readStringArray(artifactPayload?.evidence_refs),
      ...readStringArray(artifactPayload?.observation_refs),
      ...readStringArray(artifactPayload?.grounded_observation_refs),
      ...readStringArray(artifactPayload?.grounded_in_observation_refs),
    ];
    const observationRef = readString(
      artifacts[latestObservationIndex]?.artifact_id,
    );
    return (
      !observationRef ||
      supportRefs.length === 0 ||
      supportRefs.includes(observationRef)
    );
  });
};

export function hasDirectAnswerDraft(
  payload: Record<string, unknown>,
): boolean {
  if (readString(readRecord(payload.direct_answer_text)?.text)) return true;
  if (readString(readRecord(payload.final_answer_draft)?.text)) return true;
  const artifacts = readArray(payload.current_turn_artifact_ledger);
  return artifacts.some((artifact) => {
    const record = readRecord(artifact);
    const kind = readString(record?.kind);
    const artifactPayload = readRecord(record?.payload);
    const schema = readString(artifactPayload?.schema);
    return (
      kind === "direct_answer_text" ||
      kind === "final_answer_draft" ||
      schema === "helix.direct_answer_text.v1" ||
      schema === "helix.final_answer_draft.v1"
    );
  });
}

const livePipelineReceiptTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  if (
    terminalKind !== "live_pipeline_receipt" ||
    finalAnswerSource !== "live_pipeline_receipt"
  )
    return false;

  const goal = readRecord(payload.canonical_goal_frame);
  const goalKind = readString(goal?.goal_kind);
  const requiredTerminalKind = readString(goal?.required_terminal_kind);
  if (!goalKind || !LIVE_PIPELINE_RECEIPT_GOAL_KINDS.has(goalKind))
    return false;
  if (requiredTerminalKind && requiredTerminalKind !== "live_pipeline_receipt")
    return false;

  const receipt = readRecord(payload.live_pipeline_turn_receipt);
  if (readString(receipt?.schema) !== "helix.live_pipeline_turn_receipt.v1")
    return false;
  if (
    readBoolean(receipt?.assistant_answer) !== false ||
    readBoolean(receipt?.raw_content_included) !== false
  )
    return false;

  const repairPlan = readRecord(payload.live_runtime_repair_plan);
  if (
    goalKind === "live_runtime_repair" &&
    repairPlan &&
    readString(repairPlan.schema) === "helix.live_runtime_repair_plan.v1" &&
    readBoolean(repairPlan.assistant_answer) === false
  ) {
    return true;
  }

  const sourceTargetIntent = readRecord(payload.source_target_intent);
  if (readString(sourceTargetIntent?.target_source) !== "live_pipeline")
    return false;
  if (
    sourceTargetIntent?.allow_no_tool_direct === true ||
    sourceTargetIntent?.allow_client_shortcut === true
  )
    return false;

  const contract = readRecord(payload.route_product_contract);
  if (readString(contract?.source_target) !== "live_pipeline") return false;
  const allowedTerminalKinds = readStringArray(
    contract?.allowed_terminal_artifact_kinds,
  );
  const forbiddenTerminalKinds = readStringArray(
    contract?.forbidden_terminal_artifact_kinds,
  );
  if (!allowedTerminalKinds.includes("live_pipeline_receipt")) return false;
  if (forbiddenTerminalKinds.includes("live_pipeline_receipt")) return false;

  const guard = readRecord(payload.terminal_artifact_selection_guard);
  if (readBoolean(guard?.allowed) === false) return false;
  if (
    readString(guard?.terminal_artifact_kind) &&
    readString(guard?.terminal_artifact_kind) !== "live_pipeline_receipt"
  )
    return false;

  const productGuard = readRecord(payload.product_authority_guard);
  if (
    readBoolean(productGuard?.allowed) === false ||
    readBoolean(productGuard?.ok) === false
  )
    return false;

  const admission = readRecord(payload.tool_call_admission_decision);
  if (readString(admission?.source_target) !== "live_pipeline") return false;
  if (admission?.required !== true) return false;
  if (
    !readStringArray(admission?.admitted_tool_families).includes(
      "live_pipeline",
    )
  )
    return false;

  const disclosure = readRecord(payload.tool_trace_disclosure);
  if (readString(disclosure?.schema) !== "helix.ask_tool_trace_disclosure.v1")
    return false;
  if (
    readBoolean(disclosure?.assistant_answer) !== false ||
    readBoolean(disclosure?.terminal_eligible) !== false
  )
    return false;
  if (readArray(disclosure?.items).length === 0) return false;

  return true;
};

const liveEnvironmentBindingDiagnosisTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  if (
    terminalKind !== "live_environment_binding_diagnosis" ||
    finalAnswerSource !== "live_environment_binding_diagnosis"
  )
    return false;

  const goal = readRecord(payload.canonical_goal_frame);
  const requiredTerminalKind = readString(goal?.required_terminal_kind);
  if (readString(goal?.goal_kind) !== "live_environment_binding_diagnosis")
    return false;
  if (
    requiredTerminalKind &&
    requiredTerminalKind !== "live_environment_binding_diagnosis"
  )
    return false;

  const diagnosis = readRecord(payload.live_environment_binding_diagnosis);
  if (!diagnosis) return false;
  if (
    !/^helix\.live_environment_binding_diagnosis\.v\d+$/i.test(
      readString(diagnosis.schema) ?? "",
    )
  )
    return false;
  if (
    readBoolean(diagnosis.assistant_answer) !== false ||
    readBoolean(diagnosis.raw_content_included) !== false
  )
    return false;

  const guard = readRecord(payload.terminal_artifact_selection_guard);
  if (readBoolean(guard?.allowed) === false) return false;
  if (
    readString(guard?.terminal_artifact_kind) &&
    readString(guard?.terminal_artifact_kind) !==
      "live_environment_binding_diagnosis"
  )
    return false;

  const productGuard = readRecord(payload.product_authority_guard);
  if (
    readBoolean(productGuard?.allowed) === false ||
    readBoolean(productGuard?.ok) === false
  )
    return false;

  return true;
};

const workstationControlReceiptTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  if (
    terminalKind !== "workstation_tool_evaluation" ||
    finalAnswerSource !== "workstation_tool_evaluation"
  )
    return false;

  const debug = readRecord(payload.debug);
  const goalSatisfaction =
    readRecord(payload.goal_satisfaction_evaluation) ??
    readRecord(debug?.goal_satisfaction_evaluation) ??
    readRecord(payload.runtime_goal_satisfaction_observation) ??
    readRecord(payload.satisfaction_report);
  const terminalContract =
    readRecord(payload.terminal_contract) ??
    readRecord(goalSatisfaction?.terminal_contract);
  const goalKind =
    payloadGoalKind(payload) ??
    readString(goalSatisfaction?.canonical_goal_kind) ??
    readString(terminalContract?.goal_kind);
  if (goalKind !== "panel_control") return false;

  const satisfaction = readString(goalSatisfaction?.satisfaction);
  const nextDecision = readString(goalSatisfaction?.next_decision);
  if (satisfaction && satisfaction !== "satisfied") return false;
  if (nextDecision && nextDecision !== "allow_terminal") return false;

  const evaluation =
    readRecord(payload.workstation_tool_evaluation) ??
    readRecord(debug?.workstation_tool_evaluation) ??
    readRecord(
      readRecord(payload.planner_contract)?.workstation_tool_evaluation,
    );
  if (readString(evaluation?.schema) !== "helix.workstation_tool_evaluation.v1")
    return false;
  if (readBoolean(evaluation?.supports_goal) !== true) return false;

  const observation =
    readRecord(payload.live_environment_tool_observation) ??
    readRecord(debug?.live_environment_tool_observation);
  if (
    readString(observation?.schema) !==
    "helix.live_environment_tool_observation.v1"
  )
    return false;
  if (
    readBoolean(observation?.assistant_answer) !== false ||
    readBoolean(observation?.raw_content_included) !== false
  )
    return false;
  if (readBoolean(observation?.terminal_eligible) !== false) return false;

  const receipt = readRecord(observation?.observation);
  if (
    readString(receipt?.schema) !== "stage_play_workstation_control_receipt/v1"
  )
    return false;
  if (readBoolean(receipt?.ok) !== true) return false;
  if (readString(receipt?.status) !== "prepared") return false;
  if (
    readBoolean(receipt?.assistant_answer) !== false ||
    readBoolean(receipt?.raw_content_included) !== false
  )
    return false;

  return true;
};

const payloadHasStagePlayCapabilityOrObservation = (
  payload: Record<string, unknown>,
): boolean => {
  const topLevelDecision = readRecord(payload.agent_step_decision);
  const topLevelCapability =
    readString(topLevelDecision?.chosen_capability) ??
    readString(readRecord(topLevelDecision?.model_decision)?.chosen_capability);
  if (
    /^(?:helix_ask\.reflect_stage_play_context|live_env\.(?:reflect_stage_play_context|plan_stage_play_job|request_stage_play_checkpoint))$/.test(
      topLevelCapability ?? "",
    )
  ) {
    return true;
  }
  const loop = readRecord(payload.agent_runtime_loop);
  if (
    readArray(loop?.iterations).some((iteration) => {
      const record = readRecord(iteration);
      const capability = readString(record?.chosen_capability);
      return /^(?:helix_ask\.reflect_stage_play_context|live_env\.(?:reflect_stage_play_context|plan_stage_play_job|request_stage_play_checkpoint))$/.test(
        capability ?? "",
      );
    })
  ) {
    return true;
  }
  return readArray(payload.current_turn_artifact_ledger)
    .map(readRecord)
    .filter((artifact): artifact is Record<string, unknown> =>
      Boolean(artifact),
    )
    .some((artifact) =>
      artifactKindMatchesCapability(
        "helix_ask.reflect_stage_play_context",
        artifact,
      ),
    );
};

const stagePlayReceiptSelectedAsTerminal = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  const selected = `${terminalKind ?? ""} ${finalAnswerSource ?? ""}`;
  if (
    /stage_play_badge_graph|stage_play_output_lane_projection|stage_play_reflection_result|stage_play_job_plan|stage_play_checkpoint_request_result|stage_play_checkpoint_request|stage_play_checkpoint_queue/i.test(
      selected,
    )
  ) {
    return true;
  }
  return (
    /live_environment_tool_observation/i.test(selected) &&
    payloadHasStagePlayCapabilityOrObservation(payload)
  );
};

export function goalSatisfactionAllowsTerminal(
  payload: Record<string, unknown>,
): boolean {
  const goalSatisfaction =
    readRecord(payload.goal_satisfaction_evaluation) ??
    readRecord(payload.runtime_goal_satisfaction_observation) ??
    readRecord(payload.satisfaction_report);
  const satisfaction = readString(goalSatisfaction?.satisfaction);
  const nextDecision = readString(goalSatisfaction?.next_decision);
  const terminalKind = readString(payload.terminal_artifact_kind);
  if (terminalKind === "typed_failure") return hasCleanTypedFailure(payload);
  if (livePipelineReceiptTerminalAllowed(payload)) return true;
  if (workstationControlReceiptTerminalAllowed(payload)) return true;
  if (
    satisfaction === "satisfied" &&
    (!nextDecision || nextDecision === "allow_terminal")
  )
    return true;
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const docsSynthesisAnswer = readRecord(payload.doc_evidence_synthesis_answer);
  if (
    terminalKind === "doc_evidence_synthesis_answer" &&
    readString(canonicalGoal?.goal_kind) === "doc_evidence_synthesis" &&
    readString(canonicalGoal?.required_terminal_kind) ===
      "doc_evidence_synthesis_answer" &&
    readString(docsSynthesisAnswer?.terminal_artifact_kind) ===
      "doc_evidence_synthesis_answer" &&
    readString(docsSynthesisAnswer?.answer_text)
  ) {
    return true;
  }
  if (
    terminalKind === "capability_help_summary" &&
    readString(canonicalGoal?.goal_kind) === "capability_help" &&
    readString(canonicalGoal?.required_terminal_kind) ===
      "capability_help_summary" &&
    ledgerHasArtifactKind(payload, "capability_registry") &&
    ledgerHasArtifactKind(payload, "capability_help_summary")
  ) {
    return true;
  }
  const repoEvidenceAnswer = readRecord(payload.repo_code_evidence_answer);
  const repoQualityGate = readRecord(payload.repo_answer_text_quality_gate);
  const repoRelevanceGate = readRecord(payload.repo_evidence_relevance_gate);
  if (
    terminalKind === "repo_code_evidence_answer" &&
    (readString(canonicalGoal?.goal_kind) === "repo_entity_definition" ||
      readString(canonicalGoal?.goal_kind) === "repo_code_evidence_question") &&
    readString(canonicalGoal?.required_terminal_kind) ===
      "repo_code_evidence_answer" &&
    readString(repoEvidenceAnswer?.answer_text) &&
    readArray(repoEvidenceAnswer?.support_refs).length > 0 &&
    readBoolean(repoQualityGate?.ok) !== false &&
    readBoolean(repoQualityGate?.terminal_allowed) !== false &&
    readBoolean(repoRelevanceGate?.terminal_allowed) !== false
  ) {
    return true;
  }
  const bridge = readRecord(payload.post_tool_authority_bridge);
  if (
    terminalKind === "model_synthesized_answer" &&
    readString(bridge?.schema) === "helix.post_tool_authority_bridge.v1" &&
    readString(bridge?.observation_support_status) === "supports_answer"
  ) {
    return true;
  }
  if (
    terminalKind === "request_user_input" &&
    readString(bridge?.schema) === "helix.post_tool_authority_bridge.v1" &&
    readString(bridge?.observation_support_status) ===
      "supports_request_user_input"
  ) {
    return true;
  }
  if (
    readString(goalSatisfaction?.terminal_kind) === "final_answer" &&
    goalSatisfaction?.satisfied === true
  )
    return true;
  return false;
}

const contextResumeFrameRecallTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  if (readString(payload.terminal_artifact_kind) !== "model_synthesized_answer")
    return false;
  if (
    readString(payload.final_answer_source) !==
    "conversation_memory_recall_answer"
  )
    return false;
  const sourceTargetIntent = readRecord(payload.source_target_intent);
  if (readString(sourceTargetIntent?.target_source) !== "conversation_memory")
    return false;
  const packet = readRecord(payload.conversation_memory_packet);
  const resumeFrames = readArray(packet?.context_resume_frames);
  if (resumeFrames.length === 0) return false;
  const evidenceReentry = readRecord(payload.evidence_reentry_proof);
  if (readBoolean(evidenceReentry?.terminal_ready) !== true) return false;
  const routeAuthority = readRecord(payload.route_authority_audit);
  if (readBoolean(routeAuthority?.route_authority_ok) !== true) return false;
  const terminalAuthority = readRecord(payload.terminal_answer_authority);
  if (
    readString(terminalAuthority?.final_answer_source) !==
    "conversation_memory_recall_answer"
  )
    return false;
  if (
    readString(terminalAuthority?.terminal_artifact_kind) !==
    "model_synthesized_answer"
  )
    return false;
  return goalSatisfactionAllowsTerminal(payload);
};

const contractAuthorizedNoteReceiptTerminalAllowed = (
  payload: Record<string, unknown>,
): boolean => {
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  if (
    terminalKind !== "note_update_receipt" ||
    finalAnswerSource !== "note_update_receipt"
  )
    return false;
  const canonicalGoal = readRecord(payload.canonical_goal_frame);
  const routeProduct = readRecord(payload.route_product_contract);
  const allowed = readArray(routeProduct?.allowed_terminal_artifact_kinds)
    .map(readString)
    .filter(Boolean);
  const forbidden = readArray(routeProduct?.forbidden_terminal_artifact_kinds)
    .map(readString)
    .filter(Boolean);
  if (forbidden.includes("note_update_receipt")) return false;
  if (
    readString(canonicalGoal?.required_terminal_kind) !==
      "note_update_receipt" &&
    readString(routeProduct?.required_terminal_kind) !==
      "note_update_receipt" &&
    !allowed.includes("note_update_receipt")
  ) {
    return false;
  }
  return (
    goalSatisfactionAllowsTerminal(payload) &&
    hasSelectedCapabilityObservation(payload)
  );
};

const providerTerminalBridgeProvesRuntimeAuthority = (
  payload: Record<string, unknown>,
  diagnostic?: Record<string, boolean | string | null>,
): boolean => {
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  const turnId =
    readString(payload.turn_id) ??
    readString(readRecord(payload.canonical_goal_frame)?.turn_id) ??
    readString(readRecord(payload.terminal_answer_authority)?.turn_id);
  const singleWriterAuthority = readRecord(
    payload.provider_terminal_runtime_authority,
  );
  const singleWriterCandidateRef = readString(
    singleWriterAuthority?.provider_terminal_candidate_ref,
  );
  const singleWriterObservationRefs = readArray(
    singleWriterAuthority?.selected_observation_refs,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  if (
    terminalKind === "agent_provider_terminal_candidate" &&
    turnId &&
    readString(singleWriterAuthority?.schema) ===
      "helix.provider_terminal_runtime_authority.v1" &&
    readString(singleWriterAuthority?.turn_id) === turnId &&
    singleWriterCandidateRef?.startsWith(`${turnId}:`) &&
    singleWriterAuthority?.evidence_reentered === true &&
    singleWriterAuthority?.solver_completed === true &&
    singleWriterAuthority?.goal_satisfaction_compatible === true &&
    singleWriterAuthority?.server_authoritative === true &&
    singleWriterObservationRefs.length > 0
  ) {
    if (diagnostic) {
      diagnostic.authority_path = "single_writer_runtime_authority";
      diagnostic.single_writer_authority = true;
      diagnostic.eligible = true;
    }
    return true;
  }
  const debug = readRecord(payload.debug);
  const bridge =
    readRecord(payload.provider_terminal_authority_bridge) ??
    readRecord(debug?.provider_terminal_authority_bridge);
  const reentry =
    readRecord(payload.provider_reasoning_reentry) ??
    readRecord(debug?.provider_reasoning_reentry);
  const candidate =
    readRecord(payload.provider_terminal_candidate) ??
    readRecord(debug?.provider_terminal_candidate) ??
    readRecord(bridge?.provider_terminal_candidate);
  const bridgeAuthority = readRecord(bridge?.terminal_answer_authority);
  const bridgePresentation = readRecord(bridge?.terminal_presentation);
  const materialization = readRecord(
    payload.provider_route_product_materialization,
  );
  const qualityGate = readRecord(payload.provider_route_product_quality_gate);
  const materializedKind = readString(
    materialization?.materialized_terminal_artifact_kind,
  );
  const candidateRef = readString(candidate?.candidate_id);
  const bridgeCandidateRef = readString(
    bridge?.provider_terminal_candidate_ref,
  );
  const bridgeAuthorityRef =
    readString(bridgeAuthority?.terminal_item_id) ??
    readString(bridgeAuthority?.terminal_artifact_ref);
  const bridgePresentationRef = readString(
    bridgePresentation?.terminal_authority_ref,
  );
  const successfulObservationRefs = [
    ...readArray(bridge?.successful_gateway_observation_refs),
    ...readArray(bridge?.successful_capability_lane_observation_refs),
  ]
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const priorEvidenceObservationRefs = readArray(
    bridge?.prior_evidence_observation_refs,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const currentAuthority = readRecord(payload.terminal_answer_authority);
  const currentPresentation = readRecord(payload.terminal_presentation);
  const selectedObservationRefs = readArray(
    currentPresentation?.selected_observation_refs,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const normalizedObservationRefs = readArray(
    reentry?.normalized_observation_refs,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const providerSupportedObservationRefs = new Set([
    ...successfulObservationRefs,
    ...priorEvidenceObservationRefs,
    ...normalizedObservationRefs,
  ]);
  const committedRoute = readCommittedAskRoute(payload);
  const committedGoal = readRecord(committedRoute?.canonical_goal);
  const committedAllowedKinds = readArray(
    committedGoal?.allowed_terminal_artifact_kinds,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const supportRefsSatisfyContract =
    successfulObservationRefs.length > 0 ||
    priorEvidenceObservationRefs.length > 0 ||
    (bridge?.model_only_direct_answer_allowed === true &&
      bridge?.evidence_reentry_required === false);
  const directProviderCandidateAuthority = Boolean(
    turnId &&
    terminalKind === "agent_provider_terminal_candidate" &&
    readString(bridge?.turn_id) === turnId &&
    readString(bridge?.terminal_authority_status) ===
      "authorized_by_helix_provider_candidate_bridge" &&
    bridge?.all_gateway_calls_succeeded === true &&
    providerBridgeCapabilityLaneEvidenceReentryCompatible(bridge) &&
    readString(reentry?.schema) === "helix.provider_reasoning_reentry.v1" &&
    readString(reentry?.turn_id) === turnId &&
    readString(reentry?.status) === "completed" &&
    reentry?.evidence_reentered === true &&
    reentry?.solver_completed === true &&
    reentry?.goal_satisfaction_compatible === true &&
    readString(candidate?.turn_id) === turnId &&
    candidate?.provider_reasoning_completed === true &&
    candidateRef?.startsWith(`${turnId}:`) &&
    bridgeCandidateRef === candidateRef &&
    readString(bridgeAuthority?.turn_id) === turnId &&
    readString(bridgeAuthority?.terminal_kind) === "answer" &&
    readString(bridgeAuthority?.terminal_artifact_kind) ===
      "agent_provider_terminal_candidate" &&
    readString(bridgeAuthority?.final_answer_source) ===
      "agent_provider_terminal_candidate" &&
    bridgeAuthority?.server_authoritative === true &&
    bridgeAuthorityRef === candidateRef &&
    readString(bridgePresentation?.turn_id) === turnId &&
    readString(bridgePresentation?.final_answer_source) ===
      "agent_provider_terminal_candidate" &&
    bridgePresentationRef === candidateRef,
  );
  const scholarlyProviderBridgeAuthority = Boolean(
    turnId &&
    terminalKind &&
    terminalKind === finalAnswerSource &&
    SCHOLARLY_ANSWER_TERMINAL_KINDS.has(terminalKind) &&
    committedRoute?.schema === "helix.committed_ask_route.v1" &&
    committedRoute.turn_id === turnId &&
    committedRoute.route.source_target === "scholarly_research" &&
    (readString(committedGoal?.required_terminal_kind) === terminalKind ||
      committedAllowedKinds.includes(terminalKind)) &&
    readString(bridge?.turn_id) === turnId &&
    readString(bridge?.terminal_authority_status) ===
      "authorized_by_helix_provider_candidate_bridge" &&
    bridge?.all_gateway_calls_succeeded === true &&
    providerBridgeCapabilityLaneEvidenceReentryCompatible(bridge) &&
    readString(reentry?.schema) === "helix.provider_reasoning_reentry.v1" &&
    readString(reentry?.turn_id) === turnId &&
    readString(reentry?.status) === "completed" &&
    reentry?.evidence_reentered === true &&
    reentry?.solver_completed === true &&
    reentry?.goal_satisfaction_compatible === true &&
    selectedObservationRefs.length > 0 &&
    selectedObservationRefs.every((ref) =>
      providerSupportedObservationRefs.has(ref),
    ) &&
    readString(currentAuthority?.turn_id) === turnId &&
    readString(currentAuthority?.terminal_kind) === "answer" &&
    readString(currentAuthority?.terminal_artifact_kind) === terminalKind &&
    readString(currentAuthority?.final_answer_source) === terminalKind &&
    currentAuthority?.server_authoritative === true &&
    readString(currentPresentation?.turn_id) === turnId &&
    Boolean(readString(currentPresentation?.concise_text)),
  );
  const commonBridgeContract = Boolean(
    bridge?.schema === "helix.provider_terminal_authority_bridge.v1" &&
    bridge?.solver_completed === true &&
    bridge?.goal_satisfaction_compatible === true &&
    bridge?.terminal_authority_granted === true &&
    bridge?.final_visible_answer_authorized === true &&
    bridge?.normalized_observations_ready === true &&
    providerBridgeAllEvidenceReentryCompatible(bridge) &&
    supportRefsSatisfyContract,
  );
  const materializedProviderProductAuthority = Boolean(
    materialization?.status === "materialized" &&
    materializedKind &&
    materializedKind === terminalKind &&
    qualityGate?.ok === true,
  );
  const eligible = Boolean(
    commonBridgeContract &&
    (directProviderCandidateAuthority ||
      scholarlyProviderBridgeAuthority ||
      materializedProviderProductAuthority),
  );
  if (diagnostic) {
    diagnostic.authority_path = eligible
      ? scholarlyProviderBridgeAuthority
        ? "scholarly_provider_bridge"
        : directProviderCandidateAuthority
          ? "direct_provider_candidate"
          : "materialized_provider_product"
      : null;
    diagnostic.turn_id_present = Boolean(turnId);
    diagnostic.scholarly_terminal_identity = Boolean(
      terminalKind &&
      terminalKind === finalAnswerSource &&
      SCHOLARLY_ANSWER_TERMINAL_KINDS.has(terminalKind),
    );
    diagnostic.committed_scholarly_route = Boolean(
      turnId &&
      terminalKind &&
      committedRoute?.schema === "helix.committed_ask_route.v1" &&
      committedRoute.turn_id === turnId &&
      committedRoute.route.source_target === "scholarly_research" &&
      (readString(committedGoal?.required_terminal_kind) === terminalKind ||
        committedAllowedKinds.includes(terminalKind)),
    );
    diagnostic.bridge_execution_complete = Boolean(
      turnId &&
      readString(bridge?.turn_id) === turnId &&
      readString(bridge?.terminal_authority_status) ===
        "authorized_by_helix_provider_candidate_bridge" &&
      bridge?.all_gateway_calls_succeeded === true &&
      providerBridgeCapabilityLaneEvidenceReentryCompatible(bridge),
    );
    diagnostic.reasoning_reentry_complete = Boolean(
      turnId &&
      readString(reentry?.schema) === "helix.provider_reasoning_reentry.v1" &&
      readString(reentry?.turn_id) === turnId &&
      readString(reentry?.status) === "completed" &&
      reentry?.evidence_reentered === true &&
      reentry?.solver_completed === true &&
      reentry?.goal_satisfaction_compatible === true,
    );
    diagnostic.observation_refs_aligned = Boolean(
      selectedObservationRefs.length > 0 &&
      selectedObservationRefs.every((ref) =>
        providerSupportedObservationRefs.has(ref),
      ),
    );
    diagnostic.current_answer_authority = Boolean(
      turnId &&
      terminalKind &&
      readString(currentAuthority?.turn_id) === turnId &&
      readString(currentAuthority?.terminal_kind) === "answer" &&
      readString(currentAuthority?.terminal_artifact_kind) === terminalKind &&
      readString(currentAuthority?.final_answer_source) === terminalKind &&
      currentAuthority?.server_authoritative === true,
    );
    diagnostic.current_presentation = Boolean(
      turnId &&
      readString(currentPresentation?.turn_id) === turnId &&
      readString(currentPresentation?.concise_text),
    );
    diagnostic.common_bridge_contract = commonBridgeContract;
    diagnostic.direct_provider_candidate = directProviderCandidateAuthority;
    diagnostic.scholarly_provider_bridge = scholarlyProviderBridgeAuthority;
    diagnostic.materialized_provider_product =
      materializedProviderProductAuthority;
    diagnostic.eligible = eligible;
  }
  return eligible;
};

type VerifiedRuntimeLifecycleAuthority = {
  integrityVerified: boolean;
  scope: "codex_native_provider_cycle" | "helix_ask_turn" | null;
  providerCycleCompleted: boolean;
  agentRuntimeLoop: boolean;
  agentStepDecision: boolean;
  selectedCapabilityObservation: boolean;
  postObservationModelDecision: boolean;
  supportedCapabilityIds: string[];
  supportedObservationRefs: string[];
};

const verifiedRuntimeLifecycleAuthority = (
  payload: Record<string, unknown>,
): VerifiedRuntimeLifecycleAuthority => {
  const empty: VerifiedRuntimeLifecycleAuthority = {
    integrityVerified: false,
    scope: null,
    providerCycleCompleted: false,
    agentRuntimeLoop: false,
    agentStepDecision: false,
    selectedCapabilityObservation: false,
    postObservationModelDecision: false,
    supportedCapabilityIds: [],
    supportedObservationRefs: [],
  };
  const turnId =
    readString(payload.turn_id) ??
    readString(readRecord(payload.canonical_goal_frame)?.turn_id);
  if (!turnId) return empty;
  const lifecycle = readVerifiedHelixRuntimeLifecycleFromPayload({
    payload,
    turnId,
  });
  if (!lifecycle) return empty;

  const reduction = lifecycle.reduction;
  // Runtime completion is the prerequisite for terminal arbitration, not a
  // consequence of it. Requiring turn.completed here makes the pre-terminal
  // authority check circular: the terminal writer cannot authorize the
  // candidate until this report passes, while this report would not pass
  // until the writer had already emitted the terminal event.
  const providerCycleCompleted = Boolean(
    reduction.runtime_turn_completed &&
    reduction.final_agent_message_event_id &&
    reduction.post_observation_reasoning_completed &&
    reduction.pending_call_ids.length === 0,
  );
  const admittedCapabilities = new Set(reduction.admitted_capability_ids);
  const artifactById = new Map<string, Record<string, unknown>>();
  for (const value of readArray(payload.current_turn_artifact_ledger)) {
    const artifact = readRecord(value);
    const sourceScope = readString(artifact?.source_scope);
    const artifactId = readString(artifact?.artifact_id);
    if (
      artifact &&
      artifactId &&
      sourceScope !== "prior_context" &&
      sourceScope !== "prior_turn_context" &&
      sourceScope !== "prior_artifact"
    ) {
      artifactById.set(artifactId, artifact);
    }
  }

  const supportedCalls = reduction.tool_calls.filter((call) => {
    if (
      call.completion_kind !== "tool.call.completed" ||
      !call.reentered ||
      !call.capability_id ||
      !reduction.route_commit_id ||
      !admittedCapabilities.has(call.capability_id)
    ) {
      return false;
    }
    return call.observation_refs.some((ref) =>
      artifactKindMatchesCapability(
        call.capability_id as string,
        artifactById.get(ref) ?? null,
      ),
    );
  });
  const supportedCapabilityIds = Array.from(
    new Set(
      supportedCalls
        .map((call) => call.capability_id)
        .filter((capability): capability is string => Boolean(capability)),
    ),
  );
  const supportedObservationRefs = Array.from(
    new Set(
      supportedCalls.flatMap((call) =>
        call.observation_refs.filter((ref) => artifactById.has(ref)),
      ),
    ),
  );

  return {
    integrityVerified: true,
    scope: lifecycle.scope,
    providerCycleCompleted,
    agentRuntimeLoop: providerCycleCompleted,
    agentStepDecision: Boolean(
      providerCycleCompleted && reduction.final_agent_message_event_id,
    ),
    selectedCapabilityObservation: Boolean(
      providerCycleCompleted && supportedObservationRefs.length > 0,
    ),
    postObservationModelDecision: Boolean(
      providerCycleCompleted &&
      reduction.post_observation_reasoning_completed &&
      reduction.latest_reentry_event_id &&
      reduction.final_agent_message_event_id,
    ),
    supportedCapabilityIds,
    supportedObservationRefs,
  };
};

const SCHOLARLY_ANSWER_TERMINAL_KINDS = new Set([
  "scholarly_research_answer",
  "scholarly_metadata_answer",
  "scholarly_numeric_missing",
  "scholarly_recovery_plan",
  "scholarly_evidence_escalation_missing",
  "scholarly_exploratory_candidates",
  "scholarly_parse_required",
]);

const verifiedScholarlyAnswerAllowsTerminal = (
  payload: Record<string, unknown>,
  runtimeLifecycle: VerifiedRuntimeLifecycleAuthority,
): boolean => {
  const turnId =
    readString(payload.turn_id) ??
    readString(readRecord(payload.canonical_goal_frame)?.turn_id);
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  if (!turnId || !terminalKind || terminalKind !== finalAnswerSource)
    return false;
  if (!SCHOLARLY_ANSWER_TERMINAL_KINDS.has(terminalKind)) return false;

  const committedRoute = readCommittedAskRoute(payload);
  const committedGoal = readRecord(committedRoute?.canonical_goal);
  const committedAllowedKinds = readArray(
    committedGoal?.allowed_terminal_artifact_kinds,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  if (
    committedRoute?.schema !== "helix.committed_ask_route.v1" ||
    committedRoute.route.source_target !== "scholarly_research" ||
    (readString(committedGoal?.required_terminal_kind) !== terminalKind &&
      !committedAllowedKinds.includes(terminalKind))
  ) {
    return false;
  }

  const authority = readRecord(payload.terminal_answer_authority);
  const presentation = readRecord(payload.terminal_presentation);
  const selectedObservationRefs = readArray(
    presentation?.selected_observation_refs,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const supportedObservationRefs = new Set(
    runtimeLifecycle.supportedObservationRefs,
  );
  return Boolean(
    runtimeLifecycle.integrityVerified &&
    runtimeLifecycle.providerCycleCompleted &&
    runtimeLifecycle.postObservationModelDecision &&
    selectedObservationRefs.length > 0 &&
    selectedObservationRefs.some((ref) => supportedObservationRefs.has(ref)) &&
    readString(authority?.turn_id) === turnId &&
    readString(authority?.terminal_kind) === "answer" &&
    readString(authority?.terminal_artifact_kind) === terminalKind &&
    readString(authority?.final_answer_source) === terminalKind &&
    authority?.server_authoritative === true &&
    readString(presentation?.turn_id) === turnId &&
    readString(presentation?.terminal_artifact_kind) === terminalKind &&
    readString(presentation?.final_answer_source) === terminalKind &&
    readString(presentation?.concise_text),
  );
};

export function hasCleanTypedFailure(
  payload: Record<string, unknown>,
): boolean {
  if (
    readString(payload.terminal_artifact_kind) !== "typed_failure" &&
    readString(payload.final_answer_source) !== "typed_failure"
  )
    return false;
  return Boolean(
    readString(payload.terminal_error_code) ||
    readString(readRecord(payload.typed_failure)?.error_code) ||
    readString(readRecord(payload.typed_failure)?.failure_code) ||
    readString(readRecord(payload.satisfaction_report)?.missing_reason),
  );
}

export function evaluateTerminalBoundaryEligibility(
  payload: Record<string, unknown>,
): HelixRuntimeAuthorityBoundaryReport {
  if (!readRecord(payload.post_tool_authority_bridge)) {
    const turnId =
      readString(payload.turn_id) ??
      readString(readRecord(payload.canonical_goal_frame)?.turn_id) ??
      "unknown";
    payload.post_tool_authority_bridge = buildPostToolAuthorityBridge({
      turnId,
      payload,
    }) as unknown as Record<string, unknown>;
  }
  const committedRoute = readCommittedAskRoute(payload);
  const committedRouteToolFamilies = readArray(
    committedRoute?.capability_policy?.allowed_tool_families,
  )
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const committedModelOnlyDirectAnswerTurn =
    (committedRoute?.route.source_target === "model_only" ||
      committedRoute?.route.source_target === "unknown" ||
      committedRouteToolFamilies.includes("model_only")) &&
    committedRoute.canonical_goal.goal_kind === "model_only_concept" &&
    committedRoute.canonical_goal.required_terminal_kind ===
      "direct_answer_text";
  const sourceCapabilityDiagnosticTurn =
    isSourceCapabilityDiagnosticTurn(payload);
  const modelDirectAnswerTurn = isModelDirectAnswerTurn(payload);
  const runtimeBoundTurn =
    sourceCapabilityDiagnosticTurn || modelDirectAnswerTurn;
  const terminalKind = readString(payload.terminal_artifact_kind);
  const finalAnswerSource = readString(payload.final_answer_source);
  const livePipelineReceiptAllowed =
    livePipelineReceiptTerminalAllowed(payload);
  const liveEnvironmentBindingDiagnosisAllowed =
    liveEnvironmentBindingDiagnosisTerminalAllowed(payload);
  const workstationControlReceiptAllowed =
    workstationControlReceiptTerminalAllowed(payload);
  const stagePlayReceiptTerminal = stagePlayReceiptSelectedAsTerminal(payload);
  const contextResumeFrameRecallAllowed =
    contextResumeFrameRecallTerminalAllowed(payload);
  const noteReceiptTerminalAllowed =
    contractAuthorizedNoteReceiptTerminalAllowed(payload);
  const microDeckObservationBackedRoute =
    isMicroDeckObservationBackedRoute(payload);
  const microDeckCapability = selectedMicroDeckCapability(payload);
  const ledgerBackedPostObservationAnswerDraft =
    hasLedgerBackedPostObservationAnswerDraft(payload);
  const repoEvidenceAnswerTerminal = repoEvidenceAnswerTerminalAllowed(payload);
  const providerBridgeRuntimeAuthorityChecks: Record<
    string,
    boolean | string | null
  > = {};
  const providerBridgeRuntimeAuthority =
    providerTerminalBridgeProvesRuntimeAuthority(
      payload,
      providerBridgeRuntimeAuthorityChecks,
    );
  const runtimeLifecycleAuthority = verifiedRuntimeLifecycleAuthority(payload);
  const authorizedProviderTerminalCandidate =
    terminalKind === "agent_provider_terminal_candidate" &&
    finalAnswerSource === "agent_provider_terminal_candidate" &&
    providerBridgeRuntimeAuthority;
  const checks = {
    agent_runtime_loop:
      hasAgentRuntimeLoopDecisionChain(payload) ||
      ledgerBackedPostObservationAnswerDraft ||
      providerBridgeRuntimeAuthority ||
      runtimeLifecycleAuthority.agentRuntimeLoop,
    agent_step_decision:
      Boolean(readRecord(payload.agent_step_decision)) ||
      hasAgentRuntimeLoopDecisionChain(payload) ||
      ledgerBackedPostObservationAnswerDraft ||
      providerBridgeRuntimeAuthority ||
      runtimeLifecycleAuthority.agentStepDecision,
    runtime_tool_call:
      !microDeckObservationBackedRoute ||
      hasRuntimeToolCallForSelectedCapability(payload, microDeckCapability) ||
      runtimeLifecycleAuthority.supportedCapabilityIds.some((capability) =>
        capabilityKeyMatchesExpected(capability, microDeckCapability),
      ),
    microdeck_selected_capability:
      !microDeckObservationBackedRoute ||
      selectedCapabilityMatches(payload, microDeckCapability) ||
      runtimeLifecycleAuthority.supportedCapabilityIds.some((capability) =>
        capabilityKeyMatchesExpected(capability, microDeckCapability),
      ),
    selected_capability_observation:
      repoEvidenceAnswerTerminal ||
      hasSelectedCapabilityObservation(payload) ||
      ledgerBackedPostObservationAnswerDraft ||
      providerBridgeRuntimeAuthority ||
      runtimeLifecycleAuthority.selectedCapabilityObservation,
    post_observation_model_decision:
      hasPostObservationModelDecision(payload) ||
      ledgerBackedPostObservationAnswerDraft ||
      providerBridgeRuntimeAuthority ||
      runtimeLifecycleAuthority.postObservationModelDecision,
    goal_satisfaction_allows_terminal:
      goalSatisfactionAllowsTerminal(payload) ||
      ledgerBackedPostObservationAnswerDraft ||
      providerBridgeRuntimeAuthority ||
      verifiedScholarlyAnswerAllowsTerminal(payload, runtimeLifecycleAuthority),
    typed_failure_clean: hasCleanTypedFailure(payload),
  };
  const requiresRuntimeLoop =
    sourceCapabilityDiagnosticTurn &&
    terminalKind !== "typed_failure" &&
    !livePipelineReceiptAllowed &&
    !liveEnvironmentBindingDiagnosisAllowed &&
    !workstationControlReceiptAllowed &&
    !noteReceiptTerminalAllowed &&
    !contextResumeFrameRecallAllowed;
  const blockingReasons: string[] = [];
  if (runtimeBoundTurn) {
    if (stagePlayReceiptTerminal)
      blockingReasons.push("stage_play_receipt_terminal_without_model_review");
    if (
      !checks.goal_satisfaction_allows_terminal &&
      !livePipelineReceiptAllowed &&
      !liveEnvironmentBindingDiagnosisAllowed &&
      !workstationControlReceiptAllowed &&
      !noteReceiptTerminalAllowed
    )
      blockingReasons.push("goal_satisfaction_not_terminal");
    if (terminalKind === "typed_failure") {
      if (!checks.typed_failure_clean)
        blockingReasons.push("typed_failure_missing_code");
    } else if (
      modelDirectAnswerTurn &&
      !authorizedProviderTerminalCandidate &&
      !providerBridgeRuntimeAuthority
    ) {
      if (!hasDirectAnswerDraft(payload))
        blockingReasons.push("direct_answer_text_missing");
      if (!committedModelOnlyDirectAnswerTurn) {
        if (!checks.agent_step_decision)
          blockingReasons.push("agent_step_decision_missing");
        if (!checks.post_observation_model_decision)
          blockingReasons.push("post_observation_model_decision_missing");
      }
    } else if (
      livePipelineReceiptAllowed ||
      liveEnvironmentBindingDiagnosisAllowed ||
      workstationControlReceiptAllowed ||
      noteReceiptTerminalAllowed ||
      contextResumeFrameRecallAllowed
    ) {
      // Control/status Live Pipeline receipts and binding diagnostics are terminal only by route-product contract.
      // The receipt/diagnosis and disclosure remain observations, not assistant answers or raw logs.
    } else {
      if (
        microDeckObservationBackedRoute &&
        !checks.microdeck_selected_capability
      ) {
        blockingReasons.push("microdeck_selected_capability_missing");
      }
      if (microDeckObservationBackedRoute && !checks.runtime_tool_call) {
        blockingReasons.push("runtime_tool_call_missing");
      }
      if (!checks.agent_runtime_loop)
        blockingReasons.push("agent_runtime_loop_missing");
      if (!checks.agent_step_decision)
        blockingReasons.push("agent_step_decision_missing");
      if (!checks.selected_capability_observation) {
        blockingReasons.push("selected_capability_observation_missing");
      }
      if (!checks.post_observation_model_decision)
        blockingReasons.push("post_observation_model_decision_missing");
    }
  }
  const eligible = blockingReasons.length === 0;
  const severity: HelixRuntimeAuthoritySeverity = eligible
    ? "pass"
    : blockingReasons.some((reason) =>
          /agent_runtime_loop_missing|agent_step_decision_missing|runtime_tool_call_missing|microdeck_selected_capability_missing|selected_capability_observation_missing/.test(
            reason,
          ),
        )
      ? "p0"
      : blockingReasons.some((reason) =>
            /goal_satisfaction|post_observation|typed_failure/.test(reason),
          )
        ? "p1"
        : "p2";
  return {
    schema: "helix.runtime_authority_boundary_report.v1",
    source_capability_diagnostic_turn: runtimeBoundTurn,
    requires_runtime_loop: requiresRuntimeLoop,
    terminal_kind: terminalKind,
    final_answer_source: finalAnswerSource,
    checks,
    runtime_lifecycle: {
      integrity_verified: runtimeLifecycleAuthority.integrityVerified,
      scope: runtimeLifecycleAuthority.scope,
      provider_cycle_completed:
        runtimeLifecycleAuthority.providerCycleCompleted,
      supported_capability_ids:
        runtimeLifecycleAuthority.supportedCapabilityIds,
      supported_observation_refs:
        runtimeLifecycleAuthority.supportedObservationRefs,
      authority_source: runtimeLifecycleAuthority.providerCycleCompleted
        ? "verified_runtime_event_log"
        : "legacy_projection_only",
    },
    provider_bridge_runtime_authority: {
      eligible: providerBridgeRuntimeAuthority,
      checks: providerBridgeRuntimeAuthorityChecks,
    },
    eligible,
    severity,
    blocking_reasons: blockingReasons,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function assertTerminalBoundaryEligible(
  payload: Record<string, unknown>,
): HelixRuntimeAuthorityBoundaryReport {
  return evaluateTerminalBoundaryEligibility(payload);
}
