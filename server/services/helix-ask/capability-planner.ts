import {
  HELIX_CAPABILITY_PLAN_SCHEMA,
  type HelixCapabilityAdmissionStatus,
  type HelixCapabilityFamily,
  type HelixCapabilityPlan,
} from "@shared/helix-capability-plan";
import {
  HELIX_INTERNET_SEARCH_CAPABILITY,
} from "@shared/helix-internet-search-observation";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import type { LiveSourceTurnPhaseResolutionV1 } from "@shared/contracts/stage-play-live-source-mail.v1";
import { detectRepoConcept } from "./repo-concept-detector";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
  type HelixContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { buildToolUseRestatement, detectInternetSearchIntent } from "./internet-search-intent";
import { isLiveSourceMailLoopReflectionPrompt } from "./live-source-continuation-intent";
import { detectScholarlyResearchIntent } from "./scholarly-research-intent";
import {
  HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
  isWorkspaceOsStatusPrompt,
} from "./workspace-os-status-intent";
import { HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY } from "./workspace-directory-resolver";
import { mandatoryToolForPhase } from "./live-source-turn-phase-resolver";
import { isExplicitDocsPathDocumentOperation } from "./docs-viewer-intent";
import {
  explicitCapabilityContractForCapability,
  explicitCapabilityMatches,
  extractExplicitCapabilityContract,
} from "./explicit-capability-contract";
import { resolveAskCapabilityContractArbitration } from "./capability-contract-arbitration";
import { resolveAuthoritativeLivePipelineRoute } from "./live-pipeline-route-authority";
import { buildHelixCompoundCapabilityContract } from "./compound-capability-contract";
import { isAskCapabilityCatalogPrompt } from "./capability-catalog-intent";
import { hasExplicitRepoEvidenceRequest } from "./repo-code-intent-detector";
import {
  HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY,
  isTheoryFrontierVectorFieldTracePrompt,
} from "./theory-frontier-vector-field-intent";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const commandVerbPattern = /\b(?:click|press|tap|open|close|start|stop|set|change|update|run|repair|attach|select|choose|submit|use|solve|evaluate|compute|calculate|check|verify|create|add|append|put|save|write|store)\b/i;
const contextualCommandPattern =
  /\b(?:before|after|if|when|why|did|last|previous|haven'?t|not\s+yet|without)\b[\s\S]{0,80}\b(?:click|press|tap|open|start|set|change|update|run|repair|attach|use|solve|evaluate|compute|calculate|check|verify|create|add|append|put|save|write|store)\b/i;

const hasOperatorCommand = (promptText: string): boolean => {
  const prompt = promptText.trim();
  if (!commandVerbPattern.test(prompt)) return false;
  if (contextualCommandPattern.test(prompt)) return false;
  return /^(?:please\s+)?(?:click|press|tap|open|close|start|stop|set|change|update|run|repair|attach|select|choose|submit|use|solve|evaluate|compute|calculate|check|verify|create|add|append|put|save|write|store)\b/i.test(prompt) ||
    /^(?:please\s+)?(?:you\s+have\s+to|can\s+you|could\s+you|would\s+you)\s+(?:click|press|tap|open|close|start|stop|set|change|update|run|repair|attach|select|choose|submit|use|solve|evaluate|compute|calculate|check|verify|create|add|append|put|save|write|store)\b/i.test(prompt) ||
    /\b(?:and|then)\s+(?:click|press|tap|open|close|start|stop|set|change|update|run|repair|attach|select|choose|submit|use|solve|evaluate|compute|calculate|check|verify|create|add|append|put|save|write|store)\b/i.test(prompt);
};

const isAffirmativeAgentGoalSessionCommand = (promptText: string): boolean => {
  const prompt = promptText.trim();
  if (contextualCommandPattern.test(prompt)) return false;
  if (/\b(?:write|draft|explain|describe|define)\b[\s\S]{0,80}\b(?:goal|goal\s+statement|project\s+goal)\b/i.test(prompt)) {
    return false;
  }
  return (
    /\blive_env\.start_agent_goal_session\b/i.test(prompt) ||
    /\b(?:start|create|begin|set\s+up|setup|launch)\s+(?:an?\s+)?(?:agent\s+)?goal(?:\s+session)?\b[\s\S]{0,120}\b(?:objective|to|for|with\s+objective|work\s+until|monitor|track|refactor|implement|test|debug|fix|wire|build)\b/i.test(prompt)
  );
};

const isProcedureMemoryPrompt = (promptText: string): boolean =>
  /\b(?:compare|compared|changed|difference|different)\b[\s\S]{0,140}\b(?:last|previous|prior)\s+(?:scene|epoch|frame|visual|screen|capture)\b|\b(?:last|previous|prior)\s+(?:scene|epoch|frame|visual|screen|capture)\b[\s\S]{0,140}\b(?:compare|compared|changed|difference|different|running)\b|\bscene\s+epoch\b/i.test(promptText);

const classifySourceFamily = (input: {
  promptText: string;
  sourceTarget: string;
  targetKind: string;
  admittedFamilies: string[];
}): HelixCapabilityFamily => {
  const prompt = normalize(input.promptText);
  if (
    input.sourceTarget === "workspace_diagnostic" ||
    input.targetKind === "workspace_diagnostic" ||
    input.admittedFamilies.includes("workspace_diagnostic") ||
    isWorkspaceOsStatusPrompt(input.promptText)
  ) {
    return "workspace_diagnostic";
  }
  if (
    input.sourceTarget === "runtime_evidence" &&
    (
      input.admittedFamilies.includes("capability_catalog") ||
      isAskCapabilityCatalogPrompt(input.promptText)
    )
  ) {
    return "capability_catalog";
  }
  if (
    input.sourceTarget === "unknown" &&
    input.admittedFamilies.includes("workspace_directory") &&
    /\b(?:find|locate|look\s+for|search\s+for|retrieve|get|pull\s+up|open|show|bring\s+up|read)\b/i.test(input.promptText)
  ) {
    return "workspace_directory";
  }
  if (/\b(?:why|debug|diagnos|explain)\b/.test(prompt) && /\b(?:set_rate|tool call|last turn|debug export|authority|failure|failed)\b/.test(prompt)) {
    return "debug_export";
  }
  if (input.sourceTarget === "runtime_evidence") return "debug_export";
  if (input.sourceTarget === "scholarly_research") {
    return "scholarly_research";
  }
  if (
    input.sourceTarget === "theory_locator" ||
    input.admittedFamilies.includes("theory_locator") ||
    isTheoryFrontierVectorFieldTracePrompt(input.promptText) ||
    /\b(?:theory\s+badge\s+graph|theory\s+badges?|badge\s+graph|physics\s+graph|theory\s+graph|theory_context_reflection|reflect_theory_context|helix_ask\.reflect_theory_context|graph\s+placement|scale\s+bands?|semantic\s+chunks?|uncertainty\s+mode|locate\b[\s\S]{0,80}\b(?:theory|badge|graph)|place\b[\s\S]{0,80}\b(?:theory|badge|graph|claims?)|map\b[\s\S]{0,80}\b(?:theory|badge|graph)|where\s+(?:does|do)\b[\s\S]{0,100}\b(?:fit|land|map))\b/i.test(input.promptText)
  ) {
    return "theory_locator";
  }
  if (
    input.sourceTarget === "context_reflection" ||
    input.sourceTarget === "context_attachment" ||
    input.targetKind === "context_reflection" ||
    input.targetKind === "context_attachment" ||
    input.admittedFamilies.includes("context_reflection") ||
    /\b(?:selected\s+context|context\s+attachment|dragged\s+cutout|selected\s+ui\s+region|this\s+microreasoner|this\s+micro[-\s]?deck|macro[-\s]?reasoner\s+deck)\b/.test(prompt)
  ) {
    return "context_reflection";
  }
  if (
    input.sourceTarget === "scholarly_research" ||
    input.admittedFamilies.includes("scholarly_research") ||
    detectScholarlyResearchIntent(input.promptText).researchRequested
  ) {
    return "scholarly_research";
  }
  if (
    input.sourceTarget === "internet_search" ||
    input.admittedFamilies.includes("internet_search") ||
    detectInternetSearchIntent(input.promptText).searchRequested ||
    buildToolUseRestatement(input.promptText).requiredToolFamilies.includes("internet_search")
  ) {
    return "internet_search";
  }
  if (
    input.sourceTarget === "workstation_panel" ||
    input.sourceTarget === "workspace_panel" ||
    input.sourceTarget === "workspace_action" ||
    input.sourceTarget === "active_note" ||
    input.sourceTarget === "calculator_stream" ||
    input.targetKind === "workstation_panel" ||
    input.targetKind === "workspace_panel" ||
    input.targetKind === "active_note" ||
    input.targetKind === "calculator_stream" ||
    input.targetKind === "panel_control"
  ) return "workstation_action";
  if (input.sourceTarget === "docs_viewer" || input.sourceTarget === "active_doc" || /\b(?:docs?|document|white paper|whitepaper|paper)\b/.test(prompt)) {
    return "docs";
  }
  if (
    input.sourceTarget === "live_environment" ||
    input.sourceTarget === "live_source_mailbox" ||
    input.admittedFamilies.includes("live_environment") ||
    /\b(?:stage\s*play|stage_play|reflect_stage_play_context|live\s+interpretation|answer\s+snapshot|checkpoint\s+freshness|narrative_stage_play)\b/.test(prompt)
  ) {
    return "live_environment";
  }
  if (input.sourceTarget === "procedure_memory" || input.sourceTarget === "situation_epoch" || input.targetKind === "situation_epoch") {
    return "procedure_memory";
  }
  if (isProcedureMemoryPrompt(input.promptText)) return "procedure_memory";
  if (input.sourceTarget === "visual_capture" || /\b(?:screen|visual|capture|screenshot|frame)\b/.test(prompt)) {
    return "visual_capture";
  }
  if (input.sourceTarget === "repo_code" || input.admittedFamilies.includes("repo_code")) return "repo_evidence";
  if (input.sourceTarget === "process_graph" || input.admittedFamilies.includes("process_graph")) return "process_graph";
  if (input.sourceTarget === "live_pipeline" || input.admittedFamilies.includes("live_pipeline")) return "live_source";
  if (/^(?:please\s+)?(?:click|press|tap|close|start|stop|select|choose|submit)\b/i.test(input.promptText.trim())) {
    return "workstation_action";
  }
  return "debug_export";
};

const routeMetadataSourceTarget = (routeMetadata?: RecordLike | null): string =>
  readString(routeMetadata?.sourceTarget) || readString(routeMetadata?.source_target);

const routeMetadataRequiredToolFamily = (routeMetadata?: RecordLike | null): string =>
  readString(routeMetadata?.requiredToolFamily) || readString(routeMetadata?.required_tool_family);

const routeMetadataMandatoryNextTool = (routeMetadata?: RecordLike | null): RecordLike | null =>
  readRecord(routeMetadata?.mandatory_next_tool) ??
  readRecord(readRecord(routeMetadata?.source_target_intent)?.mandatory_next_tool);

const mandatoryCapabilityName = (mandatoryNextTool?: RecordLike | null): string =>
  readString(mandatoryNextTool?.tool_name) ||
  readString(mandatoryNextTool?.selected_capability) ||
  readString(mandatoryNextTool?.required_capability) ||
  readString(mandatoryNextTool?.capability);

const capabilityFamilyForMandatoryCapability = (
  capability: string,
  requiredToolFamily: string,
  sourceTarget: string,
): HelixCapabilityFamily | null => {
  if (/^docs-viewer\./i.test(capability) || requiredToolFamily === "docs_viewer" || sourceTarget === "docs_viewer" || sourceTarget === "active_doc") {
    return "docs";
  }
  if (/^scientific-calculator\./i.test(capability) || requiredToolFamily === "calculator" || sourceTarget === "calculator_stream") {
    return "workstation_action";
  }
  if (/^repo-code\./i.test(capability) || requiredToolFamily === "repo_code" || sourceTarget === "repo_code") {
    return "repo_evidence";
  }
  if (capability === HELIX_INTERNET_SEARCH_CAPABILITY || requiredToolFamily === "internet_search" || sourceTarget === "internet_search") {
    return "internet_search";
  }
  if (
    capability === HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY ||
    capability === HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY ||
    requiredToolFamily === "scholarly_research" ||
    sourceTarget === "scholarly_research"
  ) {
    return "scholarly_research";
  }
  if (/^live_env\./i.test(capability) || requiredToolFamily === "live_env" || sourceTarget === "live_source_mailbox" || sourceTarget === "live_environment") {
    return "live_environment";
  }
  if (capability === HELIX_WORKSPACE_OS_STATUS_CAPABILITY || requiredToolFamily === "workspace_diagnostic" || sourceTarget === "workspace_diagnostic") {
    return "workspace_diagnostic";
  }
  if (capability === HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY || requiredToolFamily === "workspace_directory") {
    return "workspace_directory";
  }
  return null;
};

const requiredObservationKindsForMandatoryCapability = (capability: string): string[] => {
  if (capability === "docs-viewer.search_docs") return ["doc_search_results"];
  if (capability === "docs-viewer.locate_in_doc") return ["doc_location_result", "doc_location_matches", "doc_evidence_location"];
  if (/^docs-viewer\./i.test(capability)) return ["docs_viewer_receipt"];
  if (/^scientific-calculator\./i.test(capability)) return ["calculator_receipt", "workstation_tool_evaluation"];
  if (/^repo-code\./i.test(capability)) return ["repo_code_evidence_observation", "repo_evidence_relevance_gate"];
  if (capability === HELIX_INTERNET_SEARCH_CAPABILITY) return ["internet_search_observation"];
  if (capability === HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY || capability === HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY) {
    return ["scholarly_research_observation"];
  }
  if (capability === HELIX_WORKSPACE_OS_STATUS_CAPABILITY) return ["workspace_os_status_observation", "workstation_tool_evaluation"];
  return [];
};

const requiredOutputsForMandatoryCapability = (capability: string, requiredTerminalKind: string | null): string[] => {
  if (requiredTerminalKind) return [requiredTerminalKind];
  if (/^docs-viewer\./i.test(capability)) return ["doc_evidence_synthesis_answer"];
  if (/^scientific-calculator\./i.test(capability)) return ["workstation_tool_evaluation"];
  return [];
};

const isHardLiveSourceMailboxRoute = (input: {
  routeMetadata?: RecordLike | null;
  mandatoryPhaseTool?: string | null;
}): boolean =>
  routeMetadataSourceTarget(input.routeMetadata) === "live_source_mailbox" ||
  Boolean(input.mandatoryPhaseTool);

const requestedActionFor = (
  family: HelixCapabilityFamily,
  promptText: string,
  sourceTarget?: string,
): string => {
  const prompt = normalize(promptText);
  if (isTheoryFrontierVectorFieldTracePrompt(promptText)) return HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY;
  if (family === "docs") {
    if (/\b(?:open|pull up|bring up|show)\b/.test(prompt)) return "open_or_validate_document";
    if (
      /\b(?:check|use|from|in|inside|look\s+in|look\s+at|consult|according\s+to|where|find|locate|reported|stated|specified|listed|table|row|source|cite|citation|evidence|white\s*paper|whitepaper|paper|document|doc|docs|report|memo)\b/i.test(promptText) &&
      /\b(?:white\s*paper|whitepaper|paper|document|doc|docs|report|memo|NHM[-\s]?2|casimir|tile|load[-\s]?bearing|lbs?|pounds?|newtons?)\b/i.test(promptText)
    ) {
      return "docs-viewer.search_docs";
    }
    if (/\b(?:summari[sz]e|summary|overview|takeaways?|gist|describe|explain)\b/.test(prompt)) {
      if (/(?:^|[\s"'(])(?:\/docs\/|docs[\\/])\S+/.test(prompt) || /\b(?:current|active|this|that)\s+(?:doc|document|paper)\b/.test(prompt)) {
        return "docs-viewer.summarize_doc";
      }
      return "docs-viewer.search_docs";
    }
    if (/\b(?:read|locate|find|search)\b/.test(prompt)) return "docs-viewer.search_docs";
    return "retrieve_document_evidence";
  }
  if (family === "workstation_action") {
    if (/\b(?:click|press|tap|start|submit)\b/.test(prompt)) return "click_or_activate_control";
    return "execute_workstation_action";
  }
  if (family === "live_source") {
    if (/\b(?:set|change|interval|rate|cadence|start|stop)\b/.test(prompt)) return "control_live_source";
    return "inspect_live_source";
  }
  if (family === "workspace_directory") return HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY;
  if (family === "live_environment") {
    if (sourceTarget === "live_source_mailbox") {
      if (
        isLiveSourceMailLoopReflectionPrompt(promptText) ||
        /\b(?:why|causal|causality|retrieval\s+network|synthetic\s+scene|microdex|micro[-\s]?deck|processed\s+mail\s+loop|live\s+mail\s+loop|answer\s+context|what\s+entered|why\s+final\s+answer|badge\s+graph[\s\S]{0,80}mailbox|mailbox[\s\S]{0,80}badge\s+graph)\b/i.test(promptText)
      ) {
        return "reflect_live_source_mail_loop";
      }
      if (/\b(?:source\s+quality|live\s+source\s+quality|fresh|stale|degraded|cadence|backlog|under\s+pressure)\b/.test(prompt)) {
        return "query_live_source_quality";
      }
      if (/\b(?:what\s+do\s+you\s+know\s+right\s+now|current\s+(?:live\s+source|source|mailbox|watch|observation)\s+state|summari[sz]e\s+(?:the\s+)?(?:current\s+)?live\s+source\s+state)\b/.test(prompt)) {
        return "summarize_live_source_current_state";
      }
      if (/\b(?:raw\s+mail|read\s+raw|unprocessed|debug\s+mail|read_live_source_mail)\b/.test(prompt)) {
        return "read_live_source_mail";
      }
      if (/\b(?:process(?:ed)?\s+(?:live\s+source\s+)?mail|packet|interpret|predict|watch\s+next|what\s+changed|what\s+is\s+happening|voice\s+candidate|callout)\b/.test(prompt)) {
        return "read_processed_live_source_mail";
      }
      return "read_live_source_mail";
    }
    if (/\b(?:processed\s+(?:live\s+source\s+)?mail|read_processed_live_source_mail|process_live_source_mail)\b/.test(prompt)) {
      return "read_processed_live_source_mail";
    }
    if (/\b(?:live\s*source\s*mailbox|live\s*source\s*mail|source\s*mail|mailbox|visual\s*summary\s*mail|read_live_source_mail)\b/.test(prompt)) {
      return "read_live_source_mail";
    }
    if (/\b(?:stage\s*play|stage_play|reflect_stage_play_context|live\s+interpretation|answer\s+snapshot|checkpoint\s+freshness|narrative_stage_play)\b/.test(prompt)) {
      return "reflect_stage_play_context";
    }
    return "query_live_environment";
  }
  if (family === "visual_capture") return "situation-room.describe_visual_capture";
  if (family === "procedure_memory") return "retrieve_procedure_evidence";
  if (family === "repo_evidence") return "repo-code.search_concept";
  if (family === "scholarly_research") {
    return detectScholarlyResearchIntent(promptText).fullTextRequested
      ? HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY
      : HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY;
  }
  if (family === "internet_search") return HELIX_INTERNET_SEARCH_CAPABILITY;
  if (family === "process_graph") return "inspect_process_graph";
  if (family === "workspace_diagnostic") return HELIX_WORKSPACE_OS_STATUS_CAPABILITY;
  if (family === "capability_catalog") return "helix_ask.inspect_capability_catalog";
  if (family === "subagent_runtime_adapter") return "delegate_subagent_runtime";
  if (family === "theory_locator") {
    return isTheoryFrontierVectorFieldTracePrompt(promptText)
      ? HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY
      : "helix_ask.reflect_theory_context";
  }
  if (family === "context_reflection") return "helix_ask.reflect_context_attachments";
  if (family === "moral_graph_reflection") {
    return /\b(?:bridge|theory[_\s-]+ideology|theory[_\s-]+moral)\b/i.test(promptText)
      ? "helix_ask.bridge_theory_ideology_context"
      : "helix_ask.reflect_ideology_context";
  }
  if (family === "civilization_bounds") {
    return /\b(?:build|scenario\s+frame|civilization_scenario_frame)\b/i.test(promptText)
      ? "helix_ask.build_civilization_scenario_frame"
      : "helix_ask.reflect_civilization_bounds";
  }
  return "diagnose_debug_or_runtime_evidence";
};

const liveSourceToolForRequestedAction = (requestedAction: string): string => {
  if (requestedAction.startsWith("live_env.")) return requestedAction;
  if (
    requestedAction === "read_processed_live_source_mail" ||
    requestedAction === "process_live_source_mail" ||
    requestedAction === "read_live_source_mail" ||
    requestedAction === "reflect_live_source_mail_loop" ||
    requestedAction === "record_live_source_mail_decision" ||
    requestedAction === "request_interim_voice_callout" ||
    requestedAction === "configure_interpreter_profile" ||
    requestedAction === "configure_live_source_watch_job" ||
    requestedAction === "configure_route_watch" ||
    requestedAction === "reflect_stage_play_context" ||
    requestedAction === "query_live_source_quality" ||
    requestedAction === "summarize_live_source_current_state"
  ) {
    return `live_env.${requestedAction}`;
  }
  return requestedAction;
};

const applyLiveSourcePhaseCapabilityFilter = (input: {
  requestedAction: string;
  phaseResolution?: RecordLike | null;
}): {
  requestedAction: string;
  selectedCapability: string;
  repaired: boolean;
  violationReason?: string;
  phaseConstraint?: {
    phase?: string | null;
    allowed_tools: string[];
    forbidden_tools: string[];
    selected_before_repair?: string | null;
    selected_after_repair?: string | null;
  };
} => {
  const phase = readRecord(input.phaseResolution);
  const allowedTools = uniqueStrings([
    ...readStringArray(phase?.allowedTools),
    ...readStringArray(phase?.allowed_tools),
  ]);
  const forbiddenTools = uniqueStrings([
    ...readStringArray(phase?.forbiddenTools),
    ...readStringArray(phase?.forbidden_tools),
  ]);
  const selectedCapability = liveSourceToolForRequestedAction(input.requestedAction);
  const phaseName = readString(phase?.phase) || null;
  const mandatoryTool = mandatoryToolForPhase(phase as LiveSourceTurnPhaseResolutionV1 | null);
  const locked = Boolean(mandatoryTool);
  const selectedForbidden = forbiddenTools.includes(selectedCapability);
  const selectedMatchesWatchJobAlias =
    phaseName === "configure_watch_job" &&
    selectedCapability === "live_env.configure_route_watch" &&
    allowedTools.includes("live_env.configure_live_source_watch_job");
  const selectedOutsideLockedAllowlist =
    locked && allowedTools.length > 0 && !allowedTools.includes(selectedCapability) && !selectedMatchesWatchJobAlias;
  const repairTarget = mandatoryTool ?? allowedTools[0] ?? "";
  if ((selectedForbidden || selectedOutsideLockedAllowlist) && repairTarget) {
    return {
      requestedAction: repairTarget,
      selectedCapability: repairTarget,
      repaired: true,
      violationReason: selectedForbidden
        ? "live_source_phase_forbidden_capability_repaired"
        : "live_source_phase_locked_capability_repaired",
      phaseConstraint: {
        phase: phaseName,
        allowed_tools: allowedTools,
        forbidden_tools: forbiddenTools,
        selected_before_repair: selectedCapability,
        selected_after_repair: repairTarget,
      },
    };
  }
  if ((selectedForbidden || selectedOutsideLockedAllowlist) && !repairTarget) {
    return {
      requestedAction: input.requestedAction,
      selectedCapability,
      repaired: false,
      violationReason: selectedForbidden
        ? "live_source_phase_forbidden_capability"
        : "live_source_phase_locked_without_allowed_tool",
      phaseConstraint: {
        phase: phaseName,
        allowed_tools: allowedTools,
        forbidden_tools: forbiddenTools,
        selected_before_repair: selectedCapability,
        selected_after_repair: null,
      },
    };
  }
  return {
    requestedAction: input.requestedAction,
    selectedCapability,
    repaired: false,
    phaseConstraint: phase
      ? {
          phase: phaseName,
          allowed_tools: allowedTools,
          forbidden_tools: forbiddenTools,
          selected_before_repair: selectedCapability,
          selected_after_repair: selectedCapability,
        }
      : undefined,
  };
};

const instructionRules = (instructionFrame?: RecordLike | null): string[] =>
  readStringArray(readRecord(instructionFrame)?.capability_permission_rules);

const isMutatingCapability = (family: HelixCapabilityFamily, requestedAction: string, promptText: string): boolean => {
  if (family === "workstation_action" || family === "subagent_runtime_adapter") return true;
  if (
    family === "live_environment" &&
    /^live_env\.(?:configure_route_watch|configure_live_source_watch_job|change_workstation_preset|set_visual_preset|set_audio_preset|bind_workstation_source|unbind_workstation_source|pause_workstation_loop|resume_workstation_loop|set_workstation_loop_state|repair_loop|repair_workstation_source|update_live_answer_projection|focus_process_graph|narrator_say|narrator_bind_stream|start_agent_goal_session)$/i.test(requestedAction)
  ) {
    return true;
  }
  if (family === "live_source" && requestedAction === "control_live_source") return true;
  if (family === "docs" && /\b(?:open|pull up|bring up)\b/i.test(promptText)) return true;
  return false;
};

const allowedFamilyByToolAdmission = (family: HelixCapabilityFamily, admittedFamilies: string[]): boolean => {
  if (admittedFamilies.length === 0) return true;
  if (family === "workspace_directory") return admittedFamilies.includes("workspace_directory");
  if (family === "docs") return admittedFamilies.includes("docs_viewer");
  if (family === "workstation_action") {
    return admittedFamilies.includes("workstation_action") ||
      admittedFamilies.includes("workspace_action") ||
      admittedFamilies.includes("workstation_panel") ||
      admittedFamilies.includes("workspace_panel") ||
      admittedFamilies.includes("docs_viewer") ||
      admittedFamilies.includes("calculator") ||
      admittedFamilies.includes("notes") ||
      admittedFamilies.some((entry) => /(?:workspace|workstation|panel|docs_viewer)/.test(entry));
  }
  if (family === "visual_capture") return admittedFamilies.includes("situation_run");
  if (family === "procedure_memory") return admittedFamilies.includes("procedure_memory") || admittedFamilies.includes("situation_run");
  if (family === "repo_evidence") return admittedFamilies.includes("repo_code");
  if (family === "scholarly_research") return admittedFamilies.includes("scholarly_research");
  if (family === "internet_search") return admittedFamilies.includes("internet_search");
  if (family === "debug_export") return admittedFamilies.includes("runtime_evidence") || admittedFamilies.includes("repo_code");
  if (family === "theory_locator") return admittedFamilies.includes("theory_locator");
  if (family === "context_reflection") {
    return admittedFamilies.includes("context_reflection") ||
      admittedFamilies.includes("theory_locator") ||
      admittedFamilies.includes("workstation_action") ||
      admittedFamilies.includes("capability_catalog") ||
      admittedFamilies.includes("live_environment") ||
      admittedFamilies.includes("live_source_mail") ||
      admittedFamilies.includes("workstation_panel");
  }
  if (family === "moral_graph_reflection") return admittedFamilies.includes("workstation_action");
  if (family === "civilization_bounds") return admittedFamilies.includes("workstation_action");
  if (family === "workspace_diagnostic") return admittedFamilies.includes("workspace_diagnostic");
  if (family === "capability_catalog") return admittedFamilies.includes("capability_catalog");
  if (family === "process_graph") return admittedFamilies.includes("process_graph");
  if (family === "live_environment") return admittedFamilies.includes("live_environment");
  if (family === "live_source") return admittedFamilies.includes("live_pipeline");
  return true;
};

const contextualSuppressionBlocksCapabilityFamily = (
  suppression: HelixContextualToolAdmissionSuppression | null,
  family: HelixCapabilityFamily,
): boolean => {
  if (!suppression) return false;
  if (family === "docs") return contextualToolSuppressionBlocksFamily(suppression, "docs_viewer");
  if (family === "repo_evidence") return contextualToolSuppressionBlocksFamily(suppression, "repo_code");
  if (family === "internet_search") return contextualToolSuppressionBlocksFamily(suppression, "internet_search");
  if (family === "scholarly_research") return contextualToolSuppressionBlocksFamily(suppression, "scholarly_research");
  if (family === "workstation_action") return contextualToolSuppressionBlocksFamily(suppression, "workstation_action");
  if (family === "visual_capture") return contextualToolSuppressionBlocksFamily(suppression, "situation_run");
  if (family === "live_environment") return contextualToolSuppressionBlocksFamily(suppression, "live_environment");
  if (family === "live_source") return contextualToolSuppressionBlocksFamily(suppression, "live_pipeline");
  if (family === "workspace_directory") return contextualToolSuppressionBlocksFamily(suppression, "workspace_directory");
  if (family === "workspace_diagnostic") return contextualToolSuppressionBlocksFamily(suppression, "workspace_diagnostic");
  if (family === "capability_catalog") return contextualToolSuppressionBlocksFamily(suppression, "capability_catalog");
  if (family === "process_graph") return contextualToolSuppressionBlocksFamily(suppression, "process_graph");
  if (family === "theory_locator") return contextualToolSuppressionBlocksFamily(suppression, "theory_locator");
  if (family === "context_reflection") return contextualToolSuppressionBlocksFamily(suppression, "context_reflection");
  if (family === "moral_graph_reflection") return contextualToolSuppressionBlocksFamily(suppression, "moral_graph_reflection");
  if (family === "civilization_bounds") return contextualToolSuppressionBlocksFamily(suppression, "civilization_bounds");
  if (family === "debug_export") return true;
  return false;
};

const admissionFor = (input: {
  family: HelixCapabilityFamily;
  mutating: boolean;
  operatorCommandRequired: boolean;
  operatorCommandPresent: boolean;
  admittedFamilies: string[];
  sourceTarget: string;
  instructionFrame?: RecordLike | null;
}): { status: HelixCapabilityAdmissionStatus; rejectionReason?: string } => {
  const instructionFrame = readRecord(input.instructionFrame);
  const negativeConstraints = readStringArray(instructionFrame?.negative_user_constraints);
  const activeRules = readStringArray(instructionFrame?.active_rules);
  const negativeExecutionBlocked =
    input.mutating &&
    (
      activeRules.includes("negative_user_constraint_blocks_mutating_capability") ||
      negativeConstraints.some((constraint: string) =>
        /\b(?:run|open|click|start|stop|set|change|update|repair|refresh|execute)\s+nothing\b/i.test(constraint) ||
        /\b(?:do\s+not|don't|without|never)\b[\s\S]{0,80}\b(?:run|open|click|start|stop|set|change|update|repair|refresh|execute|call)\b/i.test(constraint),
      )
    );
  if (negativeExecutionBlocked) {
    return { status: "rejected", rejectionReason: "negative_user_constraint_blocks_mutating_capability" };
  }
  if (!allowedFamilyByToolAdmission(input.family, input.admittedFamilies)) {
    if (input.family === "repo_evidence" && input.sourceTarget === "repo_code") {
      return { status: "needs_evidence" };
    }
    return { status: "rejected", rejectionReason: "capability_family_not_admitted_by_tool_policy" };
  }
  if (input.mutating && input.operatorCommandRequired && !input.operatorCommandPresent) {
    return { status: "needs_user_confirmation", rejectionReason: "mutating_capability_requires_operator_command" };
  }
  if (
    input.family === "visual_capture" ||
    input.family === "procedure_memory" ||
    input.family === "debug_export" ||
    input.family === "theory_locator" ||
    input.family === "context_reflection" ||
    input.family === "moral_graph_reflection" ||
    input.family === "civilization_bounds" ||
    input.family === "capability_catalog" ||
    input.family === "workspace_diagnostic" ||
    input.family === "workspace_directory" ||
    input.family === "live_environment" ||
    input.family === "scholarly_research" ||
    input.family === "internet_search" ||
    input.family === "repo_evidence" ||
    input.sourceTarget === "runtime_evidence"
  ) {
    return { status: "needs_evidence" };
  }
  return { status: "admitted" };
};

export const buildCapabilityPlan = (input: {
  turnId: string;
  promptText: string;
  sourceTargetIntent?: RecordLike | null;
  routeProductContract?: RecordLike | null;
  toolCallAdmissionDecision?: RecordLike | null;
  canonicalGoalFrame?: RecordLike | null;
  instructionFrame?: RecordLike | null;
  liveSourceTurnPhaseResolution?: RecordLike | null;
  routeMetadata?: RecordLike | null;
}): HelixCapabilityPlan => {
  const sourceTargetIntent = readRecord(input.sourceTargetIntent);
  const routeProductContract = readRecord(input.routeProductContract);
  const toolCallAdmissionDecision = readRecord(input.toolCallAdmissionDecision);
  const canonicalGoalFrame = readRecord(input.canonicalGoalFrame);
  const instructionFrame = readRecord(input.instructionFrame);
  const routeMetadata = readRecord(input.routeMetadata);
  const mandatoryNextTool = routeMetadataMandatoryNextTool(routeMetadata);
  const mandatoryConcreteCapability = mandatoryCapabilityName(mandatoryNextTool);
  const mandatoryRouteSourceTarget = routeMetadataSourceTarget(routeMetadata);
  const mandatoryRouteToolFamily = routeMetadataRequiredToolFamily(routeMetadata);
  const mandatoryPlanFamily = mandatoryConcreteCapability
    ? capabilityFamilyForMandatoryCapability(mandatoryConcreteCapability, mandatoryRouteToolFamily, mandatoryRouteSourceTarget)
    : null;
  const mandatoryPhaseTool = mandatoryToolForPhase(input.liveSourceTurnPhaseResolution as LiveSourceTurnPhaseResolutionV1 | null);
  const authoritativeLivePipelineRoute = resolveAuthoritativeLivePipelineRoute({
    turnId: input.turnId,
    canonicalGoalFrame,
    routeProductContract,
  });
  const requestedCapabilityContractCandidate =
    explicitCapabilityContractForCapability(readString(toolCallAdmissionDecision?.requested_capability)) ??
    extractExplicitCapabilityContract(input.promptText);
  const requestedCapabilityContract = authoritativeLivePipelineRoute
    ? null
    : requestedCapabilityContractCandidate;
  const explicitDocsPathOperation = isExplicitDocsPathDocumentOperation(input.promptText);
  const hardLiveSourceMailboxRoute = !explicitDocsPathOperation && isHardLiveSourceMailboxRoute({
    routeMetadata,
    mandatoryPhaseTool,
  });
  const contextualSuppression = detectContextualToolAdmissionSuppression(input.promptText);
  const toolUseRestatement = buildToolUseRestatement(input.promptText);
  const repoConceptDetection = detectRepoConcept(input.promptText);
  const explicitRepoEvidenceRequest = hasExplicitRepoEvidenceRequest(input.promptText);
  const contextualSuppressionBlocksIncidentalRepoEvidence =
    Boolean(contextualSuppression) &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "repo_code") &&
    !explicitRepoEvidenceRequest;
  const requiresRepoConceptEvidence =
    !hardLiveSourceMailboxRoute &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "repo_code") &&
    !contextualSuppressionBlocksIncidentalRepoEvidence &&
    repoConceptDetection.require_repo_evidence === true;
  const requiresInternetEvidence =
    !hardLiveSourceMailboxRoute &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "internet_search") &&
    !requiresRepoConceptEvidence &&
    toolUseRestatement.requiredToolFamilies.includes("internet_search");
  const sourceTargetIntentSource = readString(sourceTargetIntent?.target_source);
  const sourceTargetIntentFallback =
    sourceTargetIntentSource && sourceTargetIntentSource !== "unknown"
      ? sourceTargetIntentSource
      : "";
  const sourceTargetIntentSuppressesGenericInternet =
    Boolean(sourceTargetIntentSource) &&
    !["unknown", "internet_search", "model_only"].includes(sourceTargetIntentSource ?? "");
  const internetEvidenceDrivesPlan =
    requiresInternetEvidence && !sourceTargetIntentSuppressesGenericInternet;
  const requiresCapabilityCatalog =
    !hardLiveSourceMailboxRoute &&
    isAskCapabilityCatalogPrompt(input.promptText);
  const requiresAgentGoalSessionSetup =
    !hardLiveSourceMailboxRoute &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "live_environment") &&
    isAffirmativeAgentGoalSessionCommand(input.promptText);
  const requiresDocsViewerEvidence =
    !hardLiveSourceMailboxRoute &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer") &&
    !requiresRepoConceptEvidence &&
    !internetEvidenceDrivesPlan &&
    toolUseRestatement.requiredToolFamilies.includes("docs_viewer");
  const fallbackSourceTarget =
    (authoritativeLivePipelineRoute?.sourceTarget ?? "") ||
    (hardLiveSourceMailboxRoute ? "live_source_mailbox" : "") ||
    (mandatoryConcreteCapability && mandatoryRouteSourceTarget ? mandatoryRouteSourceTarget : "") ||
    (requestedCapabilityContract?.source_target ?? "") ||
    (requiresDocsViewerEvidence ? "docs_viewer" : "") ||
    (internetEvidenceDrivesPlan ? "internet_search" : "") ||
    (requiresAgentGoalSessionSetup ? "live_environment" : "") ||
    (requiresCapabilityCatalog ? "runtime_evidence" : "") ||
    (requiresRepoConceptEvidence ? "repo_code" : "") ||
    (isProcedureMemoryPrompt(input.promptText) ? "procedure_memory" : "") ||
    sourceTargetIntentFallback ||
    (explicitDocsPathOperation ? "" : routeMetadataSourceTarget(routeMetadata)) ||
    readString(routeProductContract?.source_target) ||
    readString(toolCallAdmissionDecision?.source_target) ||
    (contextualSuppression ? "model_only" : "") ||
    "unknown";
  const targetKind = readString(sourceTargetIntent?.target_kind) || fallbackSourceTarget;
  const admittedFamilies = uniqueStrings([
    ...readStringArray(toolCallAdmissionDecision?.admitted_tool_families),
    ...(authoritativeLivePipelineRoute ? ["live_pipeline"] : []),
    ...(requiresAgentGoalSessionSetup ? ["live_environment"] : []),
  ]);
  const originalCanonicalGoalKind = readString(canonicalGoalFrame?.goal_kind);
  const classifiedFamily = classifySourceFamily({
    promptText: input.promptText,
    sourceTarget: fallbackSourceTarget,
    targetKind,
    admittedFamilies,
  });
  const fallbackFamily: HelixCapabilityFamily = hardLiveSourceMailboxRoute
    ? "live_environment"
    : authoritativeLivePipelineRoute
    ? "live_source"
    : mandatoryPlanFamily
    ? mandatoryPlanFamily
    : requiresCapabilityCatalog
    ? "capability_catalog"
    : requiresAgentGoalSessionSetup
    ? "live_environment"
    : requestedCapabilityContract
    ? requestedCapabilityContract.plan_family
    : requiresDocsViewerEvidence
    ? "docs"
    : requiresRepoConceptEvidence
    ? "repo_evidence"
    : internetEvidenceDrivesPlan
      ? "internet_search"
      : contextualSuppression && fallbackSourceTarget === "model_only"
        ? "debug_export"
        : originalCanonicalGoalKind === "panel_control" || originalCanonicalGoalKind === "note_mutation"
          ? "workstation_action"
          : classifiedFamily;
  const fallbackGoalKind = requiresRepoConceptEvidence
    ? "repo_concept_explanation"
    : mandatoryConcreteCapability && /^docs-viewer\./i.test(mandatoryConcreteCapability)
    ? "doc_evidence_synthesis"
    : requiresCapabilityCatalog
    ? "capability_help"
    : requiresAgentGoalSessionSetup
      ? "workstation_goal_context"
    : requiresDocsViewerEvidence
      ? "doc_open_best"
    : internetEvidenceDrivesPlan
      ? "internet_search_lookup"
      : originalCanonicalGoalKind || "unknown";
  const fallbackRequiredTerminalKind = requiresRepoConceptEvidence
    ? "repo_code_evidence_answer"
    : mandatoryConcreteCapability && /^docs-viewer\./i.test(mandatoryConcreteCapability)
    ? "doc_evidence_synthesis_answer"
    : requiresCapabilityCatalog
      ? "capability_help_summary"
    : requiresAgentGoalSessionSetup
      ? "workstation_tool_evaluation"
    : internetEvidenceDrivesPlan
      ? "internet_search_answer"
      : readString(canonicalGoalFrame?.required_terminal_kind) || null;
  const contractArbitration = resolveAskCapabilityContractArbitration({
    turnId: input.turnId,
    promptText: input.promptText,
    sourceTargetIntent,
    routeProductContract,
    toolCallAdmissionDecision,
    canonicalGoalFrame,
    routeMetadata,
    hardLiveSourceMailboxRoute,
    requestedCapabilityContract,
    contextualSuppression,
    fallbackSourceTarget,
    fallbackPlanFamily: fallbackFamily,
    fallbackGoalKind,
    fallbackRequiredTerminalKind,
  });
  const sourceTarget = contractArbitration.selected_source_target;
  const family = contractArbitration.selected_plan_family;
  const canonicalGoalKind = contractArbitration.canonical_goal_kind;
  const contextualSuppressionBlocksPlan =
    Boolean(contextualSuppression) &&
    contextualSuppression?.suppression_reason !== "explanatory_only" &&
    (
      sourceTarget === "model_only" ||
      contextualSuppressionBlocksCapabilityFamily(contextualSuppression, family)
    );
  const effectiveRequestedCapabilityContract = contextualSuppressionBlocksPlan
    ? null
    : contractArbitration.contract_state === "authoritative_live_pipeline_contract"
    ? null
    : requestedCapabilityContract;
  const compoundCapabilityContract = contextualSuppressionBlocksPlan || requiresCapabilityCatalog
    ? null
    : buildHelixCompoundCapabilityContract({
        turnId: input.turnId,
        promptText: input.promptText,
      });
  const compoundSubgoals = compoundCapabilityContract?.requires_all_subgoals === true
    ? compoundCapabilityContract.subgoals
    : [];
  const rules = instructionRules(instructionFrame);
  const plannedRequestedAction = contractArbitration.contract_state === "hard_live_source_phase"
    ? (
        mandatoryPhaseTool === "live_env.configure_live_source_watch_job" &&
        requestedCapabilityContract?.capability === "live_env.configure_route_watch"
          ? "live_env.configure_route_watch"
          : mandatoryPhaseTool ?? "live_env.read_processed_live_source_mail"
      )
    : contractArbitration.contract_state === "authoritative_live_pipeline_contract" &&
      canonicalGoalKind === "live_pipeline_control"
      ? "control_live_source"
    : contextualSuppressionBlocksPlan
      ? "suppressed_contextual_tool_reference"
    : requiresAgentGoalSessionSetup
      ? "live_env.start_agent_goal_session"
    : mandatoryConcreteCapability
      ? mandatoryConcreteCapability
    : effectiveRequestedCapabilityContract
      ? effectiveRequestedCapabilityContract.runtime_capability ?? effectiveRequestedCapabilityContract.capability
    : family === "live_source" &&
      rules.includes("do_not_change_cadence_without_affirmative_operator_command")
        ? "inspect_live_source"
        : requestedActionFor(family, input.promptText, sourceTarget);
  const phaseFilteredPlan =
    contractArbitration.allow_phase_repair && (family === "live_environment" || sourceTarget === "live_source_mailbox")
      ? applyLiveSourcePhaseCapabilityFilter({
          requestedAction: plannedRequestedAction,
          phaseResolution: input.liveSourceTurnPhaseResolution,
        })
      : {
          requestedAction: plannedRequestedAction,
          selectedCapability: plannedRequestedAction,
          repaired: false,
          phaseConstraint: undefined,
          violationReason: undefined,
        };
  const requestedAction = phaseFilteredPlan.requestedAction;
  const mandatoryRequiredObservationKinds = mandatoryConcreteCapability
    ? requiredObservationKindsForMandatoryCapability(mandatoryConcreteCapability)
    : [];
  const mandatoryRequiredOutputs = mandatoryConcreteCapability
    ? requiredOutputsForMandatoryCapability(mandatoryConcreteCapability, contractArbitration.required_terminal_kind)
    : [];
  const operatorCommandPresent =
    hasOperatorCommand(input.promptText) ||
    (
      contractArbitration.contract_state === "authoritative_live_pipeline_contract" &&
      canonicalGoalKind === "live_pipeline_control"
    ) ||
    (
      requestedAction === "live_env.start_agent_goal_session" &&
      isAffirmativeAgentGoalSessionCommand(input.promptText)
    ) ||
    (
      canonicalGoalKind === "panel_control" &&
      /\b(?:open|close|show|bring\s+up|pull\s+up|switch\s+to|focus)\b/i.test(input.promptText)
    ) ||
    (
      canonicalGoalKind === "doc_open_best" &&
      /\b(?:open|show|view|bring\s+up|pull\s+up|load)\b/i.test(input.promptText)
    ) ||
    (
      canonicalGoalKind === "note_mutation" &&
      /\b(?:create|add|append|store|save|write)\b/i.test(input.promptText) &&
      /\b(?:workstation\s+)?notes?\b/i.test(input.promptText)
    );
  const mutating = isMutatingCapability(family, requestedAction, input.promptText);
  const operatorCommandRequired = mutating;
  const admission = phaseFilteredPlan.violationReason && !phaseFilteredPlan.repaired
    ? { status: "rejected" as const, rejectionReason: "live_source_phase_violation" }
    : admissionFor({
    family,
    mutating,
    operatorCommandRequired,
    operatorCommandPresent,
    admittedFamilies,
    sourceTarget,
    instructionFrame,
  });
  return {
    schema: HELIX_CAPABILITY_PLAN_SCHEMA,
    turn_id: input.turnId,
    capability_family: family,
    requested_action: requestedAction,
    ...(effectiveRequestedCapabilityContract
      ? {
          requested_capability: effectiveRequestedCapabilityContract.capability,
          requested_capability_source:
            readString(toolCallAdmissionDecision?.requested_capability_source) || "explicit_user_command",
          requested_capability_contract_ref: effectiveRequestedCapabilityContract.schema,
          requested_selected_match: explicitCapabilityMatches(
            effectiveRequestedCapabilityContract.capability,
            phaseFilteredPlan.selectedCapability,
          ),
        }
      : {}),
    mutating,
    operator_command_required: operatorCommandRequired,
    operator_command_present: operatorCommandPresent,
    source_target: sourceTarget,
    goal_kind: canonicalGoalKind || "unknown",
    required_terminal_kind: contractArbitration.required_terminal_kind,
    ...(mandatoryConcreteCapability
      ? {
          required_next_action: "model_tool_call",
          required_observation_kinds: mandatoryRequiredObservationKinds,
          required_outputs: mandatoryRequiredOutputs,
        }
      : {}),
    capability_contract_arbitration: contractArbitration as unknown as Record<string, unknown>,
    ...(compoundSubgoals.length > 1
      ? {
          compound_capability_contract: compoundCapabilityContract as unknown as Record<string, unknown>,
          compound_requested_capabilities: compoundSubgoals.map((subgoal) => subgoal.requested_capability),
          compound_required_observation_kinds: uniqueStrings(
            compoundSubgoals.flatMap((subgoal) => subgoal.required_observation_kinds),
          ),
        }
      : {}),
    admission_status: admission.status,
    selected_capability: phaseFilteredPlan.selectedCapability,
    ...(phaseFilteredPlan.repaired ? { phase_repaired: true } : {}),
    ...(phaseFilteredPlan.violationReason ? { phase_violation_reason: phaseFilteredPlan.violationReason } : {}),
    ...(phaseFilteredPlan.phaseConstraint ? { phase_constraint: phaseFilteredPlan.phaseConstraint } : {}),
    ...(contextualSuppressionBlocksPlan
      ? {
          tool_admission_suppressed: true,
          suppression_reason: contextualSuppression.suppression_reason,
        }
      : {}),
    ...(admission.rejectionReason ? { rejection_reason: admission.rejectionReason } : {}),
    assistant_answer: false,
    raw_content_included: false,
  };
};
