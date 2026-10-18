import crypto from "node:crypto";
import {
  HELIX_COMMITTED_ASK_ROUTE_SCHEMA,
  type HelixCommittedAskRoute,
  type HelixCommittedAskRouteCompatibilityResult,
  type HelixRouteEvidenceAuthority,
  type HelixRouteEvidenceAuthorityTool,
  type HelixCommittedAskRouteToolAdmissionResult,
} from "@shared/helix-committed-ask-route";
import {
  helixTerminalKindIsSelfTerminal,
  helixToolOutputRoleForTerminalKind,
  type HelixToolOutputRole,
} from "@shared/helix-terminal-authority";
import type { HelixPromptInterpretation } from "./prompt-interpretation";
import type { HelixIntentArbitration } from "./intent-arbitration";
import { applyCompoundTerminalPolicy } from "./compound-terminal-policy";
import {
  explicitCapabilityContractForCapability,
  isAffirmativeNaturalMinecraftCommandCapabilityIntent,
  readTrustedRoomEnvironmentCapabilityExtractionContext,
} from "./explicit-capability-contract";
import { buildToolUseRestatement } from "./internet-search-intent";
import {
  asksForScientificImageEvidenceContinuity,
  asksForScientificImageTextEvidenceComparison,
} from "@shared/helix-scientific-image-intent";
import { resolveAuthoritativeLivePipelineRoute } from "./live-pipeline-route-authority";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { sourceTargetIntentRequiresMinecraftPlayerEmbodimentAction } from "./minecraft-execution-plane-intent";
import { HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS } from "@shared/helix-minecraft-player-capabilities";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readBoolean = (value: unknown): boolean => value === true;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const unique = (entries: string[]): string[] => Array.from(new Set(entries.filter(Boolean)));

const canonicalGoalKindForCommittedExplicitCapability = (
  contract: ReturnType<typeof explicitCapabilityContractForCapability>,
): string =>
  contract?.capability_family === "capability_catalog"
    ? "capability_help"
    : contract?.source_target === "live_pipeline" &&
        contract?.required_terminal_kind === "live_pipeline_receipt"
      ? "live_pipeline_control"
    : contract?.plan_family ?? "unknown";

const asksForScholarlyPdfImageLensWorkflow = (promptText: string): boolean => {
  const suppression = detectContextualToolAdmissionSuppression(promptText);
  if (contextualToolSuppressionBlocksFamily(suppression, "visual_capture")) {
    return false;
  }
  const unquoted = promptText.replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, " ");
  const namesImageLens =
    /\b(?:image[_\s-]?lens|image\s+tool|visual_analysis\.inspect_image_region)\b/i.test(unquoted);
  const namesPage =
    /\b(?:page\s*(?:number\s*)?\d{1,4}|(?:a|the|this|that|selected|relevant)\s+page)\b/i.test(unquoted);
  return (
    /\b(?:open|render|load|mount|inspect|read|extract|show)\b/i.test(unquoted) &&
    namesImageLens &&
    namesPage &&
    (
      /\b(?:doi|arxiv|pdf|paper|article|full[-\s]?text)\b|\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i.test(unquoted) ||
      namesImageLens
    )
  );
};

const readLedgerArtifactRefsByKind = (payload: RecordLike, kind: string): string[] => {
  const ledger: unknown[] = Array.isArray(payload.current_turn_artifact_ledger) ? payload.current_turn_artifact_ledger : [];
  return unique(
    ledger
      .map((entry: unknown) => readRecord(entry))
      .filter((entry: RecordLike | null): entry is RecordLike => Boolean(entry && readString(entry.kind) === kind))
      .map((entry: RecordLike) => readString(entry.artifact_id)),
  );
};

const uniqueOutputRoles = (entries: Array<HelixToolOutputRole | null | undefined>): HelixToolOutputRole[] =>
  Array.from(new Set(entries.filter((entry): entry is HelixToolOutputRole => Boolean(entry))));

const uniqueTools = (entries: HelixRouteEvidenceAuthorityTool[]): HelixRouteEvidenceAuthorityTool[] => {
  const seen = new Set<string>();
  const result: HelixRouteEvidenceAuthorityTool[] = [];
  for (const entry of entries) {
    const capabilityId = readString(entry.capability_id);
    const family = readString(entry.family);
    if (!capabilityId && !family) continue;
    const key = `${capabilityId || "family"}:${family || "unknown"}:${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, capability_id: capabilityId || family, family: family || "unknown" });
  }
  return result;
};

const hashShort = (value: unknown): string =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const MODEL_ONLY_TERMINAL_ALIASES = new Set([
  "direct_answer_text",
  "model_synthesized_answer",
  "final_answer_draft",
  "agent_provider_terminal_candidate",
]);

const MODEL_ONLY_FORBIDDEN_SOURCE_TERMINALS = [
  "docs_viewer_receipt",
  "doc_open_receipt",
  "doc_summary",
  "active_doc_identity",
  "doc_location_result",
  "doc_location_matches",
  "doc_evidence_location",
  "doc_evidence_synthesis",
  "doc_evidence_synthesis_answer",
  "repo_code_evidence_answer",
];

const DOCS_MARKDOWN_PATH_RE = /(?:^|[\s"'(])\/?docs\/[A-Za-z0-9_./-]+\.md\b/i;

const terminalProductRequiresFollowupReasoning = (terminalProduct: string): boolean => {
  const normalized = normalizeCommittedRouteTerminalKind(terminalProduct);
  return Boolean(normalized && !helixTerminalKindIsSelfTerminal(normalized));
};

export const normalizeCommittedRouteTerminalKind = (kind: string | null | undefined): string => {
  const normalized = readString(kind).toLowerCase();
  if (normalized === "model_direct_answer" || normalized === "model_only_concept") return "direct_answer_text";
  if (normalized === "answer_draft") return "final_answer_draft";
  if (normalized === "doc_evidence_synthesis") return "doc_evidence_synthesis_answer";
  return normalized;
};

const sourceBackedTargets = new Set([
  "visual_capture",
  "scientific_image_evidence",
  "procedure_memory",
  "conversation_memory",
  "situation_epoch",
  "visual_scene_memory",
  "repo_code",
  "runtime_evidence",
  "room_mission_result",
  "capability_catalog",
  "workspace_directory",
  "workspace_diagnostic",
  "theory_locator",
  "context_reflection",
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
  "compound_evidence",
]);

export const inferCommittedRouteToolFamily = (capabilityId: string): string => {
  if (capabilityId === "room.mission_result.read_selected") return "room_mission_result";
  if (/^com\.casimirbot\.minecraft\./i.test(capabilityId)) return "live_environment";
  if (/^com\.casimirbot\.environment\./i.test(capabilityId)) return "live_environment";
  if (/^environment\./i.test(capabilityId)) return "live_environment";
  if (/^situation-room\.describe_visual_capture$/i.test(capabilityId)) return "situation_run";
  if (/^docs\.|docs[_-]?viewer|docs-viewer|doc[_-]?viewer/i.test(capabilityId)) return "docs_viewer";
  if (/research[-_.]?library|scholarly[-_.]?research|lookup[_-]?papers|fetch[_-]?full[_-]?text|semantic[-_.]?scholar|openalex|pubmed|crossref/i.test(capabilityId)) return "scholarly_research";
  if (/visual[-_.]?analysis|inspect[_-]?image[_-]?region|image[-_.]?lens/i.test(capabilityId)) return "visual_analysis";
  if (/internet[-_.]?search|web[-_.]?research|web\.search/i.test(capabilityId)) return "internet_search";
  if (/text[-_.]?to[-_.]?speech|speak[_-]?text|voice[-_.]?delivery|voice[-_.]?output|request[_-]?interim[_-]?voice[_-]?callout|narrator[_-]?say/i.test(capabilityId)) return "voice_delivery";
  if (/scientific[-_.]?calculator|calculator|calculate|compute|solve/i.test(capabilityId)) return "scientific_calculator";
  if (/^live_env\./i.test(capabilityId)) return "live_environment";
  if (/^situation-room\.live-source\.|^situation-room\.pipeline\./i.test(capabilityId)) return "live_pipeline";
  if (/process[-_.]?graph/i.test(capabilityId)) return "process_graph";
  if (/workspace[-_.]?directory/i.test(capabilityId)) return "workspace_directory";
  if (/workspace[_-]?os|workspace_diagnostic/i.test(capabilityId)) return "workspace_diagnostic";
  if (/inspect[_-]?capability[_-]?catalog|capability[_-]?catalog|tool[_-]?alignment/i.test(capabilityId)) return "capability_catalog";
  if (/reflect[_-]?ideology[_-]?context|bridge[_-]?theory[_-]?ideology|moral[-_.]?graph|ideology_context_reflection/i.test(capabilityId)) return "moral_graph_reflection";
  if (/civilization[-_.]?bounds|civilization[-_.]?scenario|reflect[_-]?civilization|build[_-]?civilization/i.test(capabilityId)) return "civilization_bounds";
  if (/reflect[_-]?context[_-]?attachments|reflect[_-]?live[_-]?synthetic[_-]?data|context[_-]?reflection/i.test(capabilityId)) return "context_reflection";
  if (/^(?:workstation\.|account_session\.)/i.test(capabilityId)) return "workstation_action";
  if (/click|open|close|panel|workspace-action|workspace_action/i.test(capabilityId)) return "workstation_action";
  if (/workstation-notes|note/i.test(capabilityId)) return "notes";
  if (/repo|code|source-tree/i.test(capabilityId)) return "repo_code";
  if (/theory[-_.]?locator|badge[_-]?graph|theory/i.test(capabilityId)) return "theory_locator";
  if (/model\.direct_answer|direct_answer|no_tool/i.test(capabilityId)) return "model_only";
  return "unknown";
};

export const inferCommittedRouteToolFamilyFromSourceTarget = (sourceTarget: string): string => {
  if (sourceTarget === "room_mission_result") return "room_mission_result";
  if (sourceTarget === "docs_viewer" || sourceTarget === "active_doc") return "docs_viewer";
  if (sourceTarget === "repo_code") return "repo_code";
  if (sourceTarget === "capability_catalog") return "capability_catalog";
  if (sourceTarget === "runtime_evidence") return "repo_code";
  if (sourceTarget === "internet_search") return "internet_search";
  if (sourceTarget === "world_event") return "live_environment";
  if (sourceTarget === "scholarly_research") return "scholarly_research";
  if (sourceTarget === "live_environment" || sourceTarget === "live_source_mailbox") return "live_environment";
  if (sourceTarget === "live_pipeline") return "live_pipeline";
  if (sourceTarget === "process_graph") return "process_graph";
  if (sourceTarget === "workspace_directory") return "workspace_directory";
  if (sourceTarget === "workspace_diagnostic") return "workspace_diagnostic";
  if (sourceTarget === "theory_locator") return "theory_locator";
  if (sourceTarget === "theory_badge_graph") return "theory_locator";
  if (sourceTarget === "moral_graph") return "moral_graph_reflection";
  if (sourceTarget === "civilization_bounds") return "civilization_bounds";
  if (sourceTarget === "context_reflection") return "context_reflection";
  if (sourceTarget === "calculator_stream") return "scientific_calculator";
  if (sourceTarget === "active_note") return "notes";
  if (sourceTarget === "workstation_state" || sourceTarget === "workstation_panel" || sourceTarget === "workspace_panel") return "workstation_action";
  if (sourceTarget === "visual_capture" || sourceTarget === "situation_epoch" || sourceTarget === "visual_scene_memory") return "visual_capture";
  if (sourceTarget === "scientific_image_evidence") return "visual_analysis";
  if (sourceTarget === "procedure_memory") return "procedure_memory";
  if (sourceTarget === "conversation_memory") return "conversation_memory";
  return "";
};

const readCanonicalGoal = (payload: RecordLike): { goalKind: string; requiredTerminalKind: string } => {
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  const universalGoalFrame = readRecord(payload.universal_goal_frame);
  const universalUserGoal = readRecord(universalGoalFrame?.user_goal);
  return {
    goalKind:
      readString(canonicalGoalFrame?.goal_kind) ||
      readString(universalGoalFrame?.goal_kind) ||
      readString(universalUserGoal?.goal_kind) ||
      "unknown",
    requiredTerminalKind:
      readString(canonicalGoalFrame?.required_terminal_kind) ||
      readString(universalGoalFrame?.required_terminal_kind) ||
      readString(universalUserGoal?.required_terminal_kind) ||
      "unknown",
  };
};

const readRouteSource = (payload: RecordLike): {
  sourceTarget: string;
  targetKind: string;
  strength: "hard" | "soft" | "unknown";
  reason: string;
} => {
  const committed = readCommittedAskRoute(payload);
  if (committed) {
    return {
      sourceTarget: committed.route.source_target,
      targetKind: committed.route.target_kind,
      strength: committed.route.strength,
      reason: committed.route.route_reason,
    };
  }
  const sourceTargetIntent = readRecord(payload.source_target_intent);
  const routeContract = readRecord(payload.route_product_contract);
  const canonicalGoalFrame = readRecord(payload.canonical_goal_frame);
  if (readString(canonicalGoalFrame?.goal_kind) === "note_mutation") {
    return {
      sourceTarget: "active_note",
      targetKind: "active_note",
      strength: "hard",
      reason: "canonical_goal_note_mutation",
    };
  }
  const strength = readString(sourceTargetIntent?.strength);
  return {
    sourceTarget: readString(sourceTargetIntent?.target_source) || readString(routeContract?.source_target) || "unknown",
    targetKind:
      readString(sourceTargetIntent?.target_kind) ||
      readString(sourceTargetIntent?.target_source) ||
      readString(routeContract?.source_target) ||
      "unknown",
    strength: strength === "hard" || strength === "soft" ? strength : "unknown",
    reason: readString(sourceTargetIntent?.precedence_reason) || readString(routeContract?.precedence_reason) || "source_target_admission_trace",
  };
};

const readWorkspaceActiveDocPath = (payload: RecordLike): string => {
  const snapshot =
    readRecord(payload.workspace_context_snapshot) ??
    readRecord(readRecord(payload.ask_turn_preflight_context)?.workspace_snapshot);
  return readString(snapshot?.activeDocPath) || readString(snapshot?.docContextPath);
};

const promptSuppressionMentions = (promptInterpretation?: HelixPromptInterpretation | null): HelixCommittedAskRoute["suppression"]["contextual_tool_mentions"] =>
  (promptInterpretation?.contextual_tool_mentions ?? []).map((mention) => ({
    text: mention.text,
    verb_or_cue: mention.verb_or_cue,
    reason: mention.reason,
  }));

const suppressedFamiliesFromPayload = (
  payload: RecordLike,
  promptInterpretation?: HelixPromptInterpretation | null,
): string[] => {
  const fromAdmission = readStringArray(readRecord(payload.tool_call_admission_decision)?.suppressed_tool_families);
  const fromContextualAudit = readStringArray(readRecord(payload.contextual_tool_audit)?.blocked_families);
  const fromSolverTrace = readStringArray(readRecord(readRecord(payload.ask_turn_solver_trace)?.contextual_tool_audit)?.blocked_families);
  const inferredFromPrompt = (promptInterpretation?.contextual_tool_mentions ?? [])
    .flatMap((mention) => {
      const family = inferCommittedRouteToolFamily(mention.verb_or_cue);
      const families = family && family !== "unknown" ? [family] : [];
      if (DOCS_MARKDOWN_PATH_RE.test(mention.text)) {
        families.push("docs_viewer", "repo_code");
      }
      return families;
    })
    .filter((family) => family && family !== "unknown");
  return unique([...fromAdmission, ...fromContextualAudit, ...fromSolverTrace, ...inferredFromPrompt]);
};

const allowedFamiliesFromPayload = (payload: RecordLike, sourceTarget: string): string[] => {
  const fromAdmission = readStringArray(readRecord(payload.tool_call_admission_decision)?.admitted_tool_families);
  const sourceFamily = inferCommittedRouteToolFamilyFromSourceTarget(sourceTarget);
  return unique([...fromAdmission, sourceFamily]);
};

const readCapabilityCandidatesFromPayload = (payload: RecordLike): HelixRouteEvidenceAuthorityTool[] => {
  const admission = readRecord(payload.tool_call_admission_decision);
  const capabilityPlan = readRecord(payload.capability_plan);
  const lifecycle = readRecord(payload.tool_lifecycle_trace);
  const operational = readRecord(payload.operational_capability_trace);
  const entries: HelixRouteEvidenceAuthorityTool[] = [];
  for (const candidate of [
    { capability: admission?.selected_capability, reason: "tool_call_admission_decision.selected_capability" },
    { capability: admission?.requested_capability, reason: "tool_call_admission_decision.requested_capability" },
    { capability: capabilityPlan?.selected_capability, reason: "capability_plan.selected_capability" },
    { capability: lifecycle?.requested_capability, reason: "tool_lifecycle_trace.requested_capability" },
    { capability: operational?.model_proposed_capability, reason: "operational_capability_trace.model_proposed_capability" },
  ]) {
    const capabilityId = readString(candidate.capability);
    if (!capabilityId) continue;
    entries.push({
      capability_id: capabilityId,
      family: inferCommittedRouteToolFamily(capabilityId),
      reason: candidate.reason,
    });
  }
  return uniqueTools(entries);
};

const readExplicitCapabilityContractFromPayload = (payload: RecordLike) => {
  const admission = readRecord(payload.tool_call_admission_decision);
  const capabilityPlan = readRecord(payload.capability_plan);
  const sourceTargetIntent = readRecord(payload.source_target_intent);
  const hardSourceTarget =
    readString(sourceTargetIntent?.strength) === "hard"
      ? readString(sourceTargetIntent?.target_source)
      : "";
  // An explicit capability route is an admission-time policy decision. Runtime
  // lifecycle and operational traces contain model proposals as well as policy
  // outcomes; accepting either here lets a late, incompatible proposal rewrite
  // an already committed source route.
  for (const candidate of [
    admission?.admitted_capability,
    admission?.selected_capability,
    admission?.requested_capability,
    capabilityPlan?.selected_capability,
  ]) {
    const capability = readString(candidate);
    if (!capability) continue;
    const contract = explicitCapabilityContractForCapability(capability);
    if (!contract) continue;
    if (hardSourceTarget) {
      const intendedFamily = inferCommittedRouteToolFamilyFromSourceTarget(hardSourceTarget);
      const contractFamily = inferCommittedRouteToolFamilyFromSourceTarget(
        contract.source_target,
      );
      if (
        contract.source_target !== hardSourceTarget &&
        (!intendedFamily || !contractFamily || intendedFamily !== contractFamily)
      ) {
        continue;
      }
    }
    return contract;
  }
  return null;
};

const readAdmittedToolsFromPayload = (payload: RecordLike): HelixRouteEvidenceAuthorityTool[] => {
  const admission = readRecord(payload.tool_call_admission_decision);
  const lifecycle = readRecord(payload.tool_lifecycle_trace);
  const operational = readRecord(payload.operational_capability_trace);
  const entries: HelixRouteEvidenceAuthorityTool[] = [];
  for (const candidate of [
    { capability: admission?.admitted_capability, reason: "tool_call_admission_decision.admitted_capability" },
    { capability: lifecycle?.admitted_capability, reason: "tool_lifecycle_trace.admitted_capability" },
    { capability: operational?.policy_admitted_capability, reason: "operational_capability_trace.policy_admitted_capability" },
  ]) {
    const capabilityId = readString(candidate.capability);
    if (!capabilityId) continue;
    entries.push({
      capability_id: capabilityId,
      family: inferCommittedRouteToolFamily(capabilityId),
      reason: candidate.reason,
      admission_ref: candidate.reason,
    });
  }
  const admittedFamilies = readStringArray(admission?.admitted_tool_families);
  for (const family of admittedFamilies) {
    entries.push({
      capability_id: `family:${family}`,
      family,
      reason: "tool_call_admission_decision.admitted_tool_families",
      admission_ref: "tool_call_admission_decision",
    });
  }
  return uniqueTools(entries);
};

const readSupportingEvidenceRefsFromPayload = (payload: RecordLike): string[] => {
  const refs: string[] = [];
  const evidenceGate = readRecord(payload.evidence_reentry_gate);
  refs.push(...readStringArray(evidenceGate?.selected_evidence_refs));
  const artifactLedger = Array.isArray(payload.current_turn_artifact_ledger) ? payload.current_turn_artifact_ledger : [];
  for (const entry of artifactLedger) {
    const artifact = readRecord(entry);
    refs.push(
      readString(artifact?.artifact_id) ||
      readString(artifact?.ref_id) ||
      readString(artifact?.evidence_ref),
    );
  }
  return unique(refs);
};

const isCalculatorGatewayAdmission = (payload: RecordLike): boolean => {
  const admission = readRecord(payload.tool_call_admission_decision);
  const capability =
    readString(admission?.admitted_capability) ||
    readString(admission?.selected_capability) ||
    readString(admission?.requested_capability);
  if (/scientific[-_.]?calculator|calculator/i.test(capability)) return true;
  const ledger = Array.isArray(payload.current_turn_artifact_ledger) ? payload.current_turn_artifact_ledger : [];
  return ledger.some((entry) => {
    const artifact = readRecord(entry);
    const kind = readString(artifact?.kind);
    const producer = readString(artifact?.producer_item_id);
    const nested = readRecord(artifact?.payload);
    return (
      /calculator_receipt/i.test(kind) ||
      /scientific-calculator|calculator/i.test(producer) ||
      readString(nested?.schema) === "helix.calculator_receipt.v1"
    );
  });
};

export function readCommittedAskRoute(payload: RecordLike | null | undefined): HelixCommittedAskRoute | null {
  const directRoute = readRecord(payload?.committed_ask_route);
  if (directRoute?.schema === HELIX_COMMITTED_ASK_ROUTE_SCHEMA) {
    return directRoute as HelixCommittedAskRoute;
  }

  const solverTrace = readRecord(payload?.ask_turn_solver_trace);
  const traceRoute = readRecord(solverTrace?.committed_ask_route);
  if (traceRoute?.schema === HELIX_COMMITTED_ASK_ROUTE_SCHEMA) {
    return traceRoute as HelixCommittedAskRoute;
  }

  const debug = readRecord(payload?.debug);
  const debugRoute = readRecord(debug?.committed_ask_route);
  if (debugRoute?.schema === HELIX_COMMITTED_ASK_ROUTE_SCHEMA) {
    return debugRoute as HelixCommittedAskRoute;
  }

  const debugTrace = readRecord(debug?.ask_turn_solver_trace);
  const debugTraceRoute = readRecord(debugTrace?.committed_ask_route);
  return debugTraceRoute?.schema === HELIX_COMMITTED_ASK_ROUTE_SCHEMA
    ? (debugTraceRoute as HelixCommittedAskRoute)
    : null;
}

export function reconcileCanonicalGoalFrameToCommittedRoute(input: {
  turnId: string;
  canonicalGoalFrame: RecordLike | null | undefined;
  committedRoute: HelixCommittedAskRoute | null | undefined;
}): {
  reconciled: boolean;
  frame: RecordLike | null;
  reason: string | null;
} {
  const current = readRecord(input.canonicalGoalFrame);
  const route = input.committedRoute ?? null;
  if (!current || !route || route.turn_id !== input.turnId) {
    return { reconciled: false, frame: current, reason: null };
  }

  const committedGoalKind = readString(route.canonical_goal.goal_kind);
  const committedTerminalKind = normalizeCommittedRouteTerminalKind(
    route.canonical_goal.required_terminal_kind,
  );
  const currentGoalKind = readString(current.goal_kind);
  const currentTerminalKind = normalizeCommittedRouteTerminalKind(
    readString(current.required_terminal_kind),
  );
  const committedSourceTarget = readString(route.route.source_target);
  const repairableStaleModelOnlyViolations = new Set([
    "source_target_goal_mismatch:model_only_concept_for_source_backed_route",
    "required_terminal_product_forbidden",
  ]);
  const routeViolationsRepairableByCanonicalGoalReconciliation =
    route.compatibility.violations.length > 0 &&
    route.compatibility.violations.every((violation) =>
      repairableStaleModelOnlyViolations.has(violation),
    );
  const committedRouteCompatible =
    (
      route.compatibility.source_goal_capability_terminal_compatible === true &&
      route.compatibility.violations.length === 0
    ) ||
    routeViolationsRepairableByCanonicalGoalReconciliation;
  const committedRouteIsSourceBacked =
    committedRouteCompatible &&
    Boolean(committedGoalKind) &&
    Boolean(committedTerminalKind) &&
    committedGoalKind !== "model_only_concept" &&
    committedSourceTarget !== "model_only" &&
    committedTerminalKind !== "direct_answer_text" &&
    committedTerminalKind !== "unknown";
  const currentFrameIsStaleModelOnly =
    currentGoalKind === "model_only_concept" ||
    currentGoalKind === "unknown" ||
    currentTerminalKind === "direct_answer_text" ||
    currentTerminalKind === "unknown";
  const currentFrameIsCompatibleSituationContextSpecialization =
    currentGoalKind === "situation_context_question" &&
    committedSourceTarget === "visual_capture" &&
    currentTerminalKind === "situation_context_pack";
  const currentFrameConflictsWithCommittedRoute =
    !currentFrameIsCompatibleSituationContextSpecialization &&
    (currentGoalKind !== committedGoalKind ||
      currentTerminalKind !== committedTerminalKind);
  const classifierReasons = readStringArray(current.classifier_reasons);
  const authoritativeModelOnlyDemotionReasons = new Set([
    "conversational_referent_no_evidence",
    "referent_cannot_supply_requested_evidence",
    "conversational_referent_has_no_retrievable_claims",
    "suppressed_contextual_reference",
    "contextual_tool_reference_suppressed",
    "contextual_tool_reference_demoted_route_metadata",
  ]);
  const currentFrameIsAuthoritativelyDemoted = classifierReasons.some((reason) =>
    authoritativeModelOnlyDemotionReasons.has(reason),
  );

  if (
    !committedRouteIsSourceBacked ||
    !currentFrameConflictsWithCommittedRoute ||
    currentFrameIsAuthoritativelyDemoted
  ) {
    return { reconciled: false, frame: current, reason: null };
  }

  const reconciliationReason = currentFrameIsStaleModelOnly
    ? "committed_source_route_overrode_stale_model_only_goal"
    : "committed_source_route_overrode_stale_incompatible_goal";

  const answerScope =
    committedSourceTarget === "scholarly_research"
      ? "external_scholarly_research"
      : committedSourceTarget === "internet_search"
        ? "external_internet_search"
        : committedSourceTarget || "source_backed";
  // A reconciliation is authoritative only if the incompatible classifier's
  // source projection stops participating in the model-visible goal. Keeping
  // tokens such as `internet_search` after committing a live-environment route
  // gives Codex two contradictory goals even though the lifecycle metadata
  // says the stale one was superseded. The original frame remains available in
  // the pre-reconciliation debug/audit path; the active frame carries only the
  // reason that Helix replaced it.
  const reconciledClassifierReasons = [reconciliationReason];

  return {
    reconciled: true,
    reason: reconciliationReason,
    frame: {
      ...current,
      turn_id: input.turnId,
      goal_kind: committedGoalKind,
      requested_capability:
        route.canonical_goal.requested_capability ?? null,
      answer_scope: answerScope,
      required_terminal_kind: committedTerminalKind,
      allowed_terminal_artifact_kinds:
        route.canonical_goal.allowed_terminal_artifact_kinds,
      forbidden_terminal_artifact_kinds:
        route.canonical_goal.forbidden_terminal_artifact_kinds,
      allows_workspace_context:
        committedSourceTarget !== "scholarly_research" &&
        committedSourceTarget !== "internet_search",
      allows_prior_artifacts:
        committedSourceTarget === "world_event" ||
        committedSourceTarget === "conversation_memory",
      corpus_anchors: [],
      concept_tokens: [],
      confidence: readString(current.confidence) === "high" ? "high" : "medium",
      classifier_reasons: reconciledClassifierReasons,
      source: "committed_route_canonical_goal_reconciliation",
      assistant_answer: false,
      raw_content_included: false,
    },
  };
}

export function reconcileRouteProductContractToCommittedRoute(input: {
  turnId: string;
  routeProductContract: RecordLike | null | undefined;
  committedRoute: HelixCommittedAskRoute | null | undefined;
}): {
  reconciled: boolean;
  contract: RecordLike | null;
  reason: string | null;
} {
  const current = readRecord(input.routeProductContract);
  const route = input.committedRoute ?? null;
  if (!current || !route || route.turn_id !== input.turnId) {
    return { reconciled: false, contract: current, reason: null };
  }

  const committedSourceTarget = readString(route.route.source_target);
  const committedGoalKind = readString(route.canonical_goal.goal_kind);
  const committedTerminalKind = normalizeCommittedRouteTerminalKind(
    route.canonical_goal.required_terminal_kind,
  );
  const currentSourceTarget = readString(current.source_target);
  const currentGoalKind = readString(current.goal_kind);
  const currentTerminalKind = normalizeCommittedRouteTerminalKind(
    readString(current.required_terminal_artifact_kind) ||
      readString(current.required_terminal_kind),
  );
  const currentAllowedKinds = readStringArray(
    current.allowed_terminal_artifact_kinds,
  ).map(normalizeCommittedRouteTerminalKind);
  const committedRouteCompatible =
    route.compatibility.source_goal_capability_terminal_compatible === true &&
    route.compatibility.violations.length === 0;
  const committedRouteIsSourceBacked =
    committedRouteCompatible &&
    Boolean(committedGoalKind) &&
    Boolean(committedTerminalKind) &&
    committedSourceTarget !== "model_only" &&
    committedTerminalKind !== "direct_answer_text" &&
    committedTerminalKind !== "unknown";
  const contractConflictsWithCommittedRoute =
    (currentSourceTarget && currentSourceTarget !== committedSourceTarget) ||
    (currentGoalKind && currentGoalKind !== committedGoalKind) ||
    currentTerminalKind !== committedTerminalKind ||
    !currentAllowedKinds.includes(committedTerminalKind);
  if (!committedRouteIsSourceBacked || !contractConflictsWithCommittedRoute) {
    return { reconciled: false, contract: current, reason: null };
  }

  return {
    reconciled: true,
    reason: "committed_source_route_overrode_stale_product_contract",
    contract: {
      ...current,
      schema: "helix.route_product_contract.v1",
      turn_id: input.turnId,
      source_target: committedSourceTarget,
      goal_kind: committedGoalKind,
      required_terminal_kind: committedTerminalKind,
      required_terminal_artifact_kind: committedTerminalKind,
      allowed_terminal_artifact_kinds:
        route.canonical_goal.allowed_terminal_artifact_kinds,
      forbidden_terminal_artifact_kinds:
        route.canonical_goal.forbidden_terminal_artifact_kinds,
      evidence_reentry_required:
        route.terminal_product.evidence_reentry_required,
      followup_reasoning_required:
        route.terminal_product.followup_reasoning_required,
      precedence_reason:
        "committed_source_route_overrode_stale_product_contract",
      assistant_answer: false,
      raw_content_included: false,
    },
  };
}

export function buildCommittedAskRoute(input: {
  turnId: string;
  promptText: string;
  selectedRoute: string;
  payload: RecordLike;
  promptInterpretation?: HelixPromptInterpretation | null;
  intentArbitration?: HelixIntentArbitration | null;
  secondaryIntentKinds?: string[];
}): HelixCommittedAskRoute {
  const affirmativeScientificImageComparison =
    asksForScientificImageTextEvidenceComparison(input.promptText);
  const affirmativeScientificImageContinuity =
    asksForScientificImageEvidenceContinuity(input.promptText);
  const conversationMemoryPacket = readRecord(
    input.payload.conversation_memory_packet ??
      input.payload.conversationMemoryPacket,
  );
  const hasReusablePriorEnvironmentEvidence =
    conversationMemoryPacket?.schema ===
      "helix.conversation_memory_packet.v1" &&
    conversationMemoryPacket.allowed_for_current_goal === true &&
    conversationMemoryPacket.allowed_use === "reuse_prior_evidence_refs" &&
    readStringArray(conversationMemoryPacket.reusable_evidence_refs).length > 0;
  const affirmativeScholarlyPdfImageLensWorkflow =
    asksForScholarlyPdfImageLensWorkflow(input.promptText);
  const authoritativeLivePipelineRoute = resolveAuthoritativeLivePipelineRoute({
    turnId: input.turnId,
    canonicalGoalFrame: readRecord(input.payload.canonical_goal_frame),
    routeProductContract: readRecord(input.payload.route_product_contract),
  });
  const existingCandidate = readCommittedAskRoute(input.payload);
  const currentSourceTargetIntent = readRecord(input.payload.source_target_intent);
  const semanticPlayerEmbodimentAction =
    sourceTargetIntentRequiresMinecraftPlayerEmbodimentAction(
      currentSourceTargetIntent,
    );
  const compoundDocsScholarlyRoute = readStringArray(
    currentSourceTargetIntent?.explicit_cues,
  ).includes("compound_local_docs_external_scholarly_comparison");
  const currentHardSourceTarget =
    readString(currentSourceTargetIntent?.strength) === "hard"
      ? readString(currentSourceTargetIntent?.target_source)
      : "";
  const currentHardSourceFamily = currentHardSourceTarget
    ? inferCommittedRouteToolFamilyFromSourceTarget(currentHardSourceTarget)
    : "";
  const existingSourceFamily = existingCandidate
    ? inferCommittedRouteToolFamilyFromSourceTarget(
        existingCandidate.route.source_target,
      )
    : "";
  const staleExistingHardSourceRoute = Boolean(
    existingCandidate &&
      currentHardSourceTarget &&
      existingCandidate.route.source_target !== currentHardSourceTarget &&
      (!currentHardSourceFamily ||
        !existingSourceFamily ||
        currentHardSourceFamily !== existingSourceFamily),
  );
  const staleExistingLivePipelineRoute = Boolean(
    existingCandidate &&
    authoritativeLivePipelineRoute &&
    (
      existingCandidate.route.source_target !== authoritativeLivePipelineRoute.sourceTarget ||
      existingCandidate.route.target_kind !== authoritativeLivePipelineRoute.targetKind ||
      existingCandidate.canonical_goal.goal_kind !== authoritativeLivePipelineRoute.goalKind ||
      existingCandidate.canonical_goal.required_terminal_kind !== authoritativeLivePipelineRoute.requiredTerminalKind ||
      !existingCandidate.canonical_goal.allowed_terminal_artifact_kinds.includes(authoritativeLivePipelineRoute.requiredTerminalKind) ||
      existingCandidate.canonical_goal.forbidden_terminal_artifact_kinds.includes(authoritativeLivePipelineRoute.requiredTerminalKind) ||
      !existingCandidate.capability_policy.required_capability_families.includes("live_pipeline")
    )
  );
  const staleExistingWorldEventGoal = Boolean(
    existingCandidate?.route.source_target === "world_event" &&
      (
        existingCandidate.canonical_goal.goal_kind !==
          "environment_evidence_synthesis" ||
        normalizeCommittedRouteTerminalKind(
          existingCandidate.canonical_goal.required_terminal_kind,
        ) !== "model_synthesized_answer" ||
        !existingCandidate.canonical_goal.allowed_terminal_artifact_kinds.some(
          (kind) =>
            normalizeCommittedRouteTerminalKind(kind) ===
            "model_synthesized_answer",
        )
      )
  );
  const expectedLiveEnvironmentGoalKind = semanticPlayerEmbodimentAction
    ? "environment_action_workflow"
    : "environment_evidence_synthesis";
  const staleExistingLiveEnvironmentGoal = Boolean(
    existingCandidate?.route.source_target === "live_environment" &&
      currentHardSourceTarget === "live_environment" &&
      (existingCandidate.canonical_goal.goal_kind !==
        expectedLiveEnvironmentGoalKind ||
        normalizeCommittedRouteTerminalKind(
          existingCandidate.canonical_goal.required_terminal_kind,
        ) !== "model_synthesized_answer" ||
        !existingCandidate.canonical_goal.allowed_terminal_artifact_kinds.some(
          (kind) =>
            normalizeCommittedRouteTerminalKind(kind) ===
            "model_synthesized_answer",
        )),
  );
  const staleExistingCompoundRoute = Boolean(
    compoundDocsScholarlyRoute &&
      existingCandidate &&
      (
        existingCandidate.route.source_target !== "compound_evidence" ||
        existingCandidate.canonical_goal.goal_kind !== "compound_evidence_synthesis" ||
        normalizeCommittedRouteTerminalKind(
          existingCandidate.canonical_goal.required_terminal_kind,
        ) !== "compound_evidence_synthesis_answer"
      ),
  );
  const existing =
    staleExistingLivePipelineRoute ||
    staleExistingHardSourceRoute ||
    staleExistingWorldEventGoal ||
    staleExistingLiveEnvironmentGoal ||
    staleExistingCompoundRoute ||
    (
      hasReusablePriorEnvironmentEvidence &&
      existingCandidate?.route.source_target === "world_event"
    )
      ? null
      : existingCandidate;
  if (existing) {
    const explicitCapabilityContract = readExplicitCapabilityContractFromPayload(input.payload);
    const shouldRepairExistingScientificImageContinuityRoute =
      affirmativeScientificImageContinuity &&
      (
        existing.route.source_target !== "scientific_image_evidence" ||
        existing.route.target_kind !== "scientific_image_evidence_sidecar" ||
        existing.canonical_goal.required_terminal_kind !==
          "scientific_image_evidence_continuity_summary" ||
        existing.terminal_product.evidence_reentry_required !== true
      );
    const shouldRepairExistingScientificImageComparisonRoute =
      !shouldRepairExistingScientificImageContinuityRoute &&
      affirmativeScientificImageComparison &&
      (
        existing.route.source_target !== "scientific_image_evidence" ||
        existing.capability_policy.required_capability_families.includes("visual_analysis") ||
        existing.terminal_product.evidence_reentry_required !== true ||
        existing.terminal_product.followup_reasoning_required !== true
      );
    const shouldRepairExistingCalculatorGatewayRoute =
      isCalculatorGatewayAdmission(input.payload) &&
      (
        existing.route.source_target === "agent_provider_gateway_turn" ||
        existing.canonical_goal.required_terminal_kind === "scholarly_recovery_plan" ||
          existing.canonical_goal.goal_kind === "agent_provider_gateway_turn"
      );
    const shouldRepairExistingScholarlyPdfImageLensRoute =
      !affirmativeScientificImageContinuity &&
      affirmativeScholarlyPdfImageLensWorkflow &&
      (
        existing.route.source_target !== "scholarly_research" ||
        existing.route.target_kind !== "scholarly_research" ||
        existing.canonical_goal.required_terminal_kind !== "scholarly_research_answer" ||
        !existing.capability_policy.allowed_tool_families.includes("visual_analysis") ||
        !existing.capability_policy.allowed_tool_families.includes("scholarly_research") ||
        !existing.capability_policy.required_capability_families.includes("visual_analysis") ||
        existing.terminal_product.evidence_reentry_required !== true ||
        existing.terminal_product.followup_reasoning_required !== true
      );
    const shouldRepairExistingExplicitCapabilityRoute =
      !shouldRepairExistingScientificImageContinuityRoute &&
      !shouldRepairExistingScientificImageComparisonRoute &&
      !shouldRepairExistingScholarlyPdfImageLensRoute &&
      Boolean(explicitCapabilityContract) &&
      explicitCapabilityContract?.required_terminal_kind !== existing.canonical_goal.required_terminal_kind;
    const existingRawGoal = readCanonicalGoal(input.payload);
    const shouldRepairExistingModelOnlyRoute =
      !shouldRepairExistingCalculatorGatewayRoute &&
      !shouldRepairExistingExplicitCapabilityRoute &&
      existing.canonical_goal.goal_kind === "unknown" &&
      existing.canonical_goal.required_terminal_kind === "unknown" &&
      (existing.route.source_target === "unknown" || existing.route.source_target === "model_only") &&
      existingRawGoal.goalKind === "model_only_concept" &&
      normalizeCommittedRouteTerminalKind(existingRawGoal.requiredTerminalKind) === "direct_answer_text" &&
      buildToolUseRestatement(input.promptText).requiredToolFamilies.length === 0;
    const existingAllowed = shouldRepairExistingModelOnlyRoute
      ? unique([
          ...existing.canonical_goal.allowed_terminal_artifact_kinds,
          ...Array.from(MODEL_ONLY_TERMINAL_ALIASES),
          "direct_answer_text",
        ])
      : shouldRepairExistingExplicitCapabilityRoute && explicitCapabilityContract
        ? unique([
            ...existing.canonical_goal.allowed_terminal_artifact_kinds,
            explicitCapabilityContract.required_terminal_kind,
            "typed_failure",
          ])
      : shouldRepairExistingCalculatorGatewayRoute
        ? unique([
            ...existing.canonical_goal.allowed_terminal_artifact_kinds,
            "workstation_tool_evaluation",
            "typed_failure",
          ])
      : shouldRepairExistingScholarlyPdfImageLensRoute
        ? unique([
            ...existing.canonical_goal.allowed_terminal_artifact_kinds,
            "scholarly_research_answer",
            "typed_failure",
          ])
      : shouldRepairExistingScientificImageContinuityRoute
        ? [
            "scientific_image_evidence_continuity_summary",
            "typed_failure",
          ]
      : shouldRepairExistingScientificImageComparisonRoute
        ? unique([
            ...existing.canonical_goal.allowed_terminal_artifact_kinds,
            "scholarly_research_answer",
            "agent_provider_terminal_candidate",
            "model_synthesized_answer",
            "typed_failure",
          ])
      : existing.canonical_goal.allowed_terminal_artifact_kinds;
    const existingForbidden = shouldRepairExistingModelOnlyRoute
      ? unique([
          ...existing.canonical_goal.forbidden_terminal_artifact_kinds.filter((kind) => !MODEL_ONLY_TERMINAL_ALIASES.has(normalizeCommittedRouteTerminalKind(kind))),
          ...MODEL_ONLY_FORBIDDEN_SOURCE_TERMINALS,
        ])
      : shouldRepairExistingExplicitCapabilityRoute && explicitCapabilityContract
        ? existing.canonical_goal.forbidden_terminal_artifact_kinds.filter(
            (kind) => normalizeCommittedRouteTerminalKind(kind) !== normalizeCommittedRouteTerminalKind(explicitCapabilityContract.required_terminal_kind),
          )
      : shouldRepairExistingCalculatorGatewayRoute
        ? existing.canonical_goal.forbidden_terminal_artifact_kinds.filter((kind) => kind !== "workstation_tool_evaluation")
      : shouldRepairExistingScholarlyPdfImageLensRoute
        ? existing.canonical_goal.forbidden_terminal_artifact_kinds.filter(
            (kind) => normalizeCommittedRouteTerminalKind(kind) !== "scholarly_research_answer",
          )
      : shouldRepairExistingScientificImageContinuityRoute
        ? existing.canonical_goal.forbidden_terminal_artifact_kinds.filter(
            (kind) =>
              normalizeCommittedRouteTerminalKind(kind) !==
              "scientific_image_evidence_continuity_summary",
          )
      : shouldRepairExistingScientificImageComparisonRoute
        ? existing.canonical_goal.forbidden_terminal_artifact_kinds.filter((kind) =>
            ![
              "scholarly_research_answer",
              "agent_provider_terminal_candidate",
              "model_synthesized_answer",
            ].includes(normalizeCommittedRouteTerminalKind(kind)),
          )
      : existing.canonical_goal.forbidden_terminal_artifact_kinds;
    const existingRequiredTerminalKind = shouldRepairExistingModelOnlyRoute
      ? "direct_answer_text"
      : shouldRepairExistingExplicitCapabilityRoute && explicitCapabilityContract
        ? explicitCapabilityContract.required_terminal_kind
      : shouldRepairExistingCalculatorGatewayRoute
        ? "workstation_tool_evaluation"
      : shouldRepairExistingScholarlyPdfImageLensRoute
        ? "scholarly_research_answer"
      : shouldRepairExistingScientificImageContinuityRoute
        ? "scientific_image_evidence_continuity_summary"
      : shouldRepairExistingScientificImageComparisonRoute
        ? "scholarly_research_answer"
      : existing.canonical_goal.required_terminal_kind;
    const compoundPolicy = applyCompoundTerminalPolicy(input.payload, {
      allowed: existingAllowed,
      forbidden: existingForbidden,
      requiredTerminalKind: existingRequiredTerminalKind,
    });
    if (
      !compoundPolicy.policy.active &&
      !shouldRepairExistingModelOnlyRoute &&
      !shouldRepairExistingCalculatorGatewayRoute &&
      !shouldRepairExistingExplicitCapabilityRoute &&
      !shouldRepairExistingScholarlyPdfImageLensRoute &&
      !shouldRepairExistingScientificImageContinuityRoute &&
      !shouldRepairExistingScientificImageComparisonRoute
    ) return existing;
    const requiredTerminalProduct =
      shouldRepairExistingScientificImageContinuityRoute
        ? "scientific_image_evidence_continuity_summary"
        : compoundPolicy.requiredTerminalKind ||
          existing.terminal_product.required_terminal_product;
    return {
      ...existing,
      canonical_goal: {
        ...existing.canonical_goal,
        goal_kind: shouldRepairExistingModelOnlyRoute
          ? "model_only_concept"
          : shouldRepairExistingExplicitCapabilityRoute && explicitCapabilityContract
            ? canonicalGoalKindForCommittedExplicitCapability(
                explicitCapabilityContract,
              )
          : shouldRepairExistingCalculatorGatewayRoute
            ? "calculator_solve"
          : shouldRepairExistingScholarlyPdfImageLensRoute
            ? "scholarly_research_lookup"
          : shouldRepairExistingScientificImageContinuityRoute
            ? "scientific_image_evidence_continuity"
          : shouldRepairExistingScientificImageComparisonRoute
            ? "scholarly_research_lookup"
          : existing.canonical_goal.goal_kind,
        requested_capability:
          shouldRepairExistingExplicitCapabilityRoute &&
          explicitCapabilityContract
            ? explicitCapabilityContract.capability
            : existing.canonical_goal.requested_capability ?? null,
        required_terminal_kind: requiredTerminalProduct,
        allowed_terminal_artifact_kinds:
          shouldRepairExistingScientificImageContinuityRoute
            ? [
                "scientific_image_evidence_continuity_summary",
                "typed_failure",
              ]
            : compoundPolicy.allowed,
        forbidden_terminal_artifact_kinds: compoundPolicy.forbidden,
      },
      route: shouldRepairExistingExplicitCapabilityRoute && explicitCapabilityContract
        ? {
            ...existing.route,
            source_target: explicitCapabilityContract.source_target,
            target_kind: explicitCapabilityContract.source_target,
            strength: "hard",
            route_reason: "explicit_capability_contract",
          }
        : shouldRepairExistingScholarlyPdfImageLensRoute
          ? {
              ...existing.route,
              source_target: "scholarly_research",
              target_kind: "scholarly_research",
              strength: "hard",
              route_reason: "retained_scholarly_pdf_image_lens_workflow",
            }
        : shouldRepairExistingScientificImageContinuityRoute
          ? {
              ...existing.route,
              source_target: "scientific_image_evidence",
              target_kind: "scientific_image_evidence_sidecar",
              strength: "hard",
              route_reason: "retained_scientific_image_evidence_continuity",
            }
        : shouldRepairExistingScientificImageComparisonRoute
          ? {
              ...existing.route,
              source_target: "scientific_image_evidence",
              target_kind: "scientific_image_evidence_sidecar",
              strength: "hard",
              route_reason: "retained_scientific_image_text_comparison",
            }
        : existing.route,
      capability_policy: shouldRepairExistingExplicitCapabilityRoute && explicitCapabilityContract
        ? {
            ...existing.capability_policy,
            allowed_tool_families: unique([
              ...existing.capability_policy.allowed_tool_families,
              ...explicitCapabilityContract.admission_families,
              explicitCapabilityContract.capability_family,
              inferCommittedRouteToolFamilyFromSourceTarget(explicitCapabilityContract.source_target),
            ]),
            required_capability_families: unique([
              ...existing.capability_policy.required_capability_families,
              explicitCapabilityContract.capability_family,
              inferCommittedRouteToolFamilyFromSourceTarget(explicitCapabilityContract.source_target),
            ]),
          }
        : shouldRepairExistingScholarlyPdfImageLensRoute
          ? {
              ...existing.capability_policy,
              allowed_tool_families: unique([
                ...existing.capability_policy.allowed_tool_families,
                "scholarly_research",
                "visual_analysis",
              ]),
              required_capability_families: unique([
                ...existing.capability_policy.required_capability_families,
                "scholarly_research",
                "visual_analysis",
              ]),
            }
        : shouldRepairExistingScientificImageContinuityRoute
          ? {
              ...existing.capability_policy,
              allowed_tool_families:
                existing.capability_policy.allowed_tool_families.filter(
                  (family) => family !== "scholarly_research",
                ),
              required_capability_families:
                existing.capability_policy.required_capability_families.filter(
                  (family) =>
                    family !== "scholarly_research" &&
                    family !== "visual_analysis",
                ),
            }
        : shouldRepairExistingScientificImageComparisonRoute
          ? {
              ...existing.capability_policy,
              allowed_tool_families: unique([
                ...existing.capability_policy.allowed_tool_families,
                "visual_analysis",
                "scholarly_research",
              ]),
              required_capability_families: existing.capability_policy.required_capability_families
                .filter((family) => family !== "visual_analysis"),
            }
        : existing.capability_policy,
      terminal_product: {
        ...existing.terminal_product,
        evidence_reentry_required:
          shouldRepairExistingExplicitCapabilityRoute ||
          shouldRepairExistingScholarlyPdfImageLensRoute ||
          shouldRepairExistingScientificImageContinuityRoute ||
          shouldRepairExistingScientificImageComparisonRoute
          ? true
          : existing.terminal_product.evidence_reentry_required,
        followup_reasoning_required:
          shouldRepairExistingScholarlyPdfImageLensRoute ||
          shouldRepairExistingScientificImageComparisonRoute
          ? true
          : shouldRepairExistingScientificImageContinuityRoute
          ? false
          : shouldRepairExistingExplicitCapabilityRoute
          ? false
          : existing.terminal_product.followup_reasoning_required,
        required_terminal_product: requiredTerminalProduct,
      },
    };
  }

  const route = staleExistingHardSourceRoute
    ? {
        sourceTarget: currentHardSourceTarget,
        targetKind:
          readString(currentSourceTargetIntent?.target_kind) ||
          currentHardSourceTarget,
        strength: "hard" as const,
        reason:
          readString(currentSourceTargetIntent?.precedence_reason) ||
          "hard_source_target_recommitted",
      }
    : readRouteSource(input.payload);
  const explicitCapabilityContractCandidate = readExplicitCapabilityContractFromPayload(input.payload);
  const explicitCapabilityContract = authoritativeLivePipelineRoute
    ? null
    : explicitCapabilityContractCandidate;
  const effectiveRoute = authoritativeLivePipelineRoute
    ? {
        sourceTarget: authoritativeLivePipelineRoute.sourceTarget,
        targetKind: authoritativeLivePipelineRoute.targetKind,
        strength: "hard" as const,
        reason: authoritativeLivePipelineRoute.reason,
      }
    : compoundDocsScholarlyRoute
    ? {
        sourceTarget: "compound_evidence",
        targetKind: "compound_evidence",
        strength: "hard" as const,
        reason: "compound_local_docs_external_scholarly_comparison",
      }
    : affirmativeScientificImageContinuity
    ? {
        sourceTarget: "scientific_image_evidence",
        targetKind: "scientific_image_evidence_sidecar",
        strength: "hard" as const,
        reason: "retained_scientific_image_evidence_continuity",
      }
    : affirmativeScientificImageComparison
    ? {
        sourceTarget: "scientific_image_evidence",
        targetKind: "scientific_image_evidence_sidecar",
        strength: "hard" as const,
        reason: "retained_scientific_image_text_comparison",
      }
    : affirmativeScholarlyPdfImageLensWorkflow
    ? {
        sourceTarget: "scholarly_research",
        targetKind: "scholarly_research",
        strength: "hard" as const,
        reason: "scholarly_pdf_image_lens_workflow",
      }
    : explicitCapabilityContract
    ? {
        sourceTarget: explicitCapabilityContract.source_target,
        targetKind: explicitCapabilityContract.source_target,
        strength: "hard" as const,
        reason: "explicit_capability_contract",
      }
    : route;
  const toolUseRestatement = buildToolUseRestatement(input.promptText);
  const routeContract = readRecord(input.payload.route_product_contract);
  const rawGoal = readCanonicalGoal(input.payload);
  const contextualSuppressionPresent =
    (input.promptInterpretation?.contextual_tool_mentions?.length ?? 0) > 0 ||
    (input.promptInterpretation?.negative_constraints?.length ?? 0) > 0;
  const routeContractSourceTarget = readString(routeContract?.source_target);
  const sourceContractForModelOnlyRoute =
    !explicitCapabilityContract &&
    effectiveRoute.sourceTarget === "model_only" &&
    (
      sourceBackedTargets.has(routeContractSourceTarget) ||
      readStringArray(routeContract?.allowed_terminal_artifact_kinds).some((kind) =>
        /^(?:doc_|docs_|active_doc|repo_code_|live_|visual_|calculator_|process_|note_)/i.test(kind),
      )
    );
  const plainNoSourceModelOnlyRoute =
    !explicitCapabilityContract &&
    (effectiveRoute.sourceTarget === "unknown" || effectiveRoute.sourceTarget === "model_only") &&
    rawGoal.goalKind === "unknown" &&
    rawGoal.requiredTerminalKind === "unknown" &&
    !routeContractSourceTarget &&
    toolUseRestatement.requiredToolFamilies.length === 0;
  const canonicalModelOnlyDirectAnswer =
    !explicitCapabilityContract &&
    (effectiveRoute.sourceTarget === "unknown" || effectiveRoute.sourceTarget === "model_only") &&
    rawGoal.goalKind === "model_only_concept" &&
    normalizeCommittedRouteTerminalKind(rawGoal.requiredTerminalKind) === "direct_answer_text" &&
    toolUseRestatement.requiredToolFamilies.length === 0;
  const shouldUseModelOnlyGoal =
    canonicalModelOnlyDirectAnswer ||
    plainNoSourceModelOnlyRoute ||
    (
      !explicitCapabilityContract &&
      effectiveRoute.sourceTarget === "model_only" &&
      (
        contextualSuppressionPresent ||
        sourceContractForModelOnlyRoute ||
        /^(?:summarize_doc|doc_|docs_|active_doc|repo_code_)/i.test(rawGoal.goalKind)
      )
    );
  const livePipelineRequestedOutputs = readStringArray(
    currentSourceTargetIntent?.requested_outputs,
  );
  const inferredLivePipelineTerminalKind =
    effectiveRoute.sourceTarget === "live_pipeline"
      ? livePipelineRequestedOutputs.includes("live_pipeline_receipt")
        ? "live_pipeline_receipt"
        : livePipelineRequestedOutputs.includes(
              "live_environment_binding_diagnosis",
            )
          ? "live_environment_binding_diagnosis"
          : ""
      : "";
  const goal = authoritativeLivePipelineRoute
    ? {
        goalKind: authoritativeLivePipelineRoute.goalKind,
        requiredTerminalKind: authoritativeLivePipelineRoute.requiredTerminalKind,
      }
    : compoundDocsScholarlyRoute
    ? {
        goalKind: "compound_evidence_synthesis",
        requiredTerminalKind: "compound_evidence_synthesis_answer",
      }
    : affirmativeScientificImageContinuity
    ? {
        goalKind: "scientific_image_evidence_continuity",
        requiredTerminalKind:
          "scientific_image_evidence_continuity_summary",
      }
    : affirmativeScientificImageComparison
    ? { goalKind: "scholarly_research_lookup", requiredTerminalKind: "scholarly_research_answer" }
    : affirmativeScholarlyPdfImageLensWorkflow
    ? { goalKind: "scholarly_research_lookup", requiredTerminalKind: "scholarly_research_answer" }
    : effectiveRoute.sourceTarget === "world_event"
      ? {
          goalKind: "environment_evidence_synthesis",
          requiredTerminalKind: "model_synthesized_answer",
        }
    : explicitCapabilityContract &&
        (!semanticPlayerEmbodimentAction ||
          HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS.includes(
            explicitCapabilityContract.capability as (typeof HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS)[number],
          ))
      ? {
          goalKind:
            canonicalGoalKindForCommittedExplicitCapability(
              explicitCapabilityContract,
            ),
          requiredTerminalKind: explicitCapabilityContract.required_terminal_kind,
        }
    : semanticPlayerEmbodimentAction
      ? {
          goalKind: "environment_action_workflow",
          requiredTerminalKind: "model_synthesized_answer",
        }
    : effectiveRoute.sourceTarget === "live_environment"
      ? {
          goalKind: "environment_evidence_synthesis",
          requiredTerminalKind: "model_synthesized_answer",
        }
    : shouldUseModelOnlyGoal
    ? { goalKind: "model_only_concept", requiredTerminalKind: "direct_answer_text" }
    : inferredLivePipelineTerminalKind
      ? {
          goalKind:
            inferredLivePipelineTerminalKind === "live_pipeline_receipt"
              ? "live_pipeline_control"
              : "live_environment_binding_diagnosis",
          requiredTerminalKind: inferredLivePipelineTerminalKind,
        }
    : effectiveRoute.sourceTarget === "procedure_memory" &&
        effectiveRoute.targetKind === "situation_epoch"
      ? {
          goalKind: "procedure_epoch_replay_question",
          requiredTerminalKind: "procedure_epoch_replay",
        }
    : effectiveRoute.sourceTarget === "procedure_memory" &&
        (rawGoal.goalKind === "unknown" ||
          rawGoal.requiredTerminalKind === "unknown")
      ? {
          goalKind: "situation_context_question",
          requiredTerminalKind:
            readString(routeContract?.required_terminal_artifact_kind) ||
            readString(routeContract?.required_terminal_kind) ||
            "situation_context_pack",
        }
    : rawGoal;
  const modelOnlyTerminalAliases =
    goal.goalKind === "model_only_concept" && goal.requiredTerminalKind === "direct_answer_text"
      ? Array.from(MODEL_ONLY_TERMINAL_ALIASES)
      : [];
  const rawAllowedTerminalKinds = readStringArray(routeContract?.allowed_terminal_artifact_kinds);
  const rawForbiddenTerminalKinds = readStringArray(routeContract?.forbidden_terminal_artifact_kinds);
  const rawAllowedTerminalKindsWithGoal = unique([
    ...(shouldUseModelOnlyGoal ? [] : rawAllowedTerminalKinds),
    ...(affirmativeScientificImageComparison
      ? [
          "scholarly_research_answer",
          "agent_provider_terminal_candidate",
          "model_synthesized_answer",
          "typed_failure",
        ]
      : []),
    ...(affirmativeScientificImageContinuity
      ? ["scientific_image_evidence_continuity_summary", "typed_failure"]
      : []),
    ...(affirmativeScholarlyPdfImageLensWorkflow
      ? ["scholarly_research_answer", "typed_failure"]
      : []),
    ...(compoundDocsScholarlyRoute
      ? ["compound_evidence_synthesis_answer", "typed_failure"]
      : []),
    ...(["world_event", "live_environment"].includes(
      effectiveRoute.sourceTarget,
    )
      ? [
          "model_synthesized_answer",
          "agent_provider_terminal_candidate",
          "typed_failure",
        ]
      : []),
    ...modelOnlyTerminalAliases,
    goal.requiredTerminalKind !== "unknown" ? goal.requiredTerminalKind : "",
  ]);
  const rawForbiddenTerminalKindsWithGoal = compoundDocsScholarlyRoute
    ? rawForbiddenTerminalKinds.filter(
        (kind) =>
          normalizeCommittedRouteTerminalKind(kind) !==
          "compound_evidence_synthesis_answer",
      )
  : ["world_event", "live_environment"].includes(
        effectiveRoute.sourceTarget,
      )
    ? rawForbiddenTerminalKinds.filter(
        (kind) =>
          ![
            "model_synthesized_answer",
            "agent_provider_terminal_candidate",
          ].includes(normalizeCommittedRouteTerminalKind(kind)),
      )
  : shouldUseModelOnlyGoal
    ? unique([
        ...rawForbiddenTerminalKinds.filter((kind) => !MODEL_ONLY_TERMINAL_ALIASES.has(normalizeCommittedRouteTerminalKind(kind))),
        ...MODEL_ONLY_FORBIDDEN_SOURCE_TERMINALS,
      ])
    : affirmativeScientificImageContinuity
      ? rawForbiddenTerminalKinds.filter(
          (kind) =>
            normalizeCommittedRouteTerminalKind(kind) !==
            "scientific_image_evidence_continuity_summary",
        )
    : affirmativeScientificImageComparison
      ? rawForbiddenTerminalKinds.filter((kind) =>
          ![
            "scholarly_research_answer",
            "agent_provider_terminal_candidate",
            "model_synthesized_answer",
          ].includes(normalizeCommittedRouteTerminalKind(kind)),
        )
      : rawForbiddenTerminalKinds;
  const compoundPolicy = applyCompoundTerminalPolicy(input.payload, {
    allowed: rawAllowedTerminalKindsWithGoal,
    forbidden: rawForbiddenTerminalKindsWithGoal,
    requiredTerminalKind: goal.requiredTerminalKind !== "unknown" ? goal.requiredTerminalKind : null,
  });
  const allowedTerminalKinds = compoundDocsScholarlyRoute
    ? ["compound_evidence_synthesis_answer", "typed_failure"]
    : affirmativeScientificImageContinuity
    ? ["scientific_image_evidence_continuity_summary", "typed_failure"]
    : compoundPolicy.allowed;
  const forbiddenTerminalKinds = compoundDocsScholarlyRoute
    ? compoundPolicy.forbidden.filter(
        (kind) =>
          normalizeCommittedRouteTerminalKind(kind) !==
          "compound_evidence_synthesis_answer",
      )
    : affirmativeScientificImageContinuity
    ? compoundPolicy.forbidden.filter(
        (kind) =>
          normalizeCommittedRouteTerminalKind(kind) !==
          "scientific_image_evidence_continuity_summary",
      )
      : compoundPolicy.forbidden;
  const rawSuppressedFamilies = suppressedFamiliesFromPayload(input.payload, input.promptInterpretation);
  const suppressedFamilies = affirmativeScholarlyPdfImageLensWorkflow
    ? rawSuppressedFamilies.filter((family) => !["scholarly_research", "visual_analysis"].includes(family))
    : rawSuppressedFamilies;
  const sourceTargetIntent = readRecord(input.payload.source_target_intent);
  const sourceTargetFamily = inferCommittedRouteToolFamilyFromSourceTarget(effectiveRoute.sourceTarget);
  const trustedEnvironmentCapabilityContext =
    readTrustedRoomEnvironmentCapabilityExtractionContext(
      input.payload.trusted_room_environment_intent_context,
    );
  const admitsMinecraftCommandMechanicsGrounding =
    isAffirmativeNaturalMinecraftCommandCapabilityIntent(
      input.promptText,
      trustedEnvironmentCapabilityContext,
    );
  const unboundedAllowedFamilies = unique([
    ...allowedFamiliesFromPayload(input.payload, effectiveRoute.sourceTarget),
    ...(explicitCapabilityContract?.admission_families ?? []),
    ...(explicitCapabilityContract ? [explicitCapabilityContract.capability_family] : []),
    ...(admitsMinecraftCommandMechanicsGrounding ? ["docs_viewer"] : []),
    ...toolUseRestatement.requiredToolFamilies,
    ...(affirmativeScholarlyPdfImageLensWorkflow ? ["scholarly_research", "visual_analysis"] : []),
    ...(compoundDocsScholarlyRoute
      ? ["docs_viewer", "scholarly_research"]
      : []),
  ])
    .filter((family) => !suppressedFamilies.includes(family));
  const allowedFamilies = affirmativeScientificImageContinuity
    ? []
    : compoundDocsScholarlyRoute
    ? unboundedAllowedFamilies
    : effectiveRoute.strength === "hard" &&
    sourceTargetFamily &&
    !affirmativeScholarlyPdfImageLensWorkflow
    ? unboundedAllowedFamilies.filter(
        (family) =>
          family === sourceTargetFamily ||
          (admitsMinecraftCommandMechanicsGrounding &&
            family === "docs_viewer"),
      )
    : unboundedAllowedFamilies;
  const reusesRetainedScientificImageSidecar =
    effectiveRoute.sourceTarget === "scientific_image_evidence" &&
    (
      affirmativeScientificImageContinuity ||
      affirmativeScientificImageComparison ||
      sourceTargetIntent?.reuse_retained_scientific_image_sidecar === true
    );
  const requiredFamily = compoundDocsScholarlyRoute
    ? ""
    : reusesRetainedScientificImageSidecar
    ? ""
    : sourceTargetFamily;
  const negativeConstraints = input.promptInterpretation?.negative_constraints ?? [];
  const sourceBacked = sourceBackedTargets.has(effectiveRoute.sourceTarget);
  const requiredTerminalProduct =
    compoundDocsScholarlyRoute
      ? "compound_evidence_synthesis_answer"
      : affirmativeScientificImageContinuity
      ? "scientific_image_evidence_continuity_summary"
      : compoundPolicy.requiredTerminalKind ||
        (goal.requiredTerminalKind !== "unknown"
          ? goal.requiredTerminalKind
          : allowedTerminalKinds[0] ?? "unknown");
  const violations: string[] = [];

  if (sourceBacked && goal.goalKind === "model_only_concept") {
    violations.push("source_target_goal_mismatch:model_only_concept_for_source_backed_route");
  }
  if (
    sourceTargetFamily === "live_environment" &&
    /^(?:doc_|docs_|active_doc|focused_doc)/i.test(goal.goalKind)
  ) {
    violations.push(
      "source_target_goal_mismatch:document_goal_for_live_environment_route",
    );
  }
  if (requiredTerminalProduct !== "unknown" && forbiddenTerminalKinds.includes(requiredTerminalProduct)) {
    violations.push("required_terminal_product_forbidden");
  }
  if (sourceBacked && requiredFamily && allowedFamilies.length > 0 && !allowedFamilies.includes(requiredFamily)) {
    violations.push("required_capability_family_not_allowed");
  }

  return {
    schema: HELIX_COMMITTED_ASK_ROUTE_SCHEMA,
    turn_id: input.turnId,
    commit_id: `committed-route:${hashShort([input.turnId, input.promptText, effectiveRoute.sourceTarget, goal.goalKind, requiredTerminalProduct])}`,
    prompt_hash: hashShort(input.promptText),
    committed_at_stage: "post_prompt_source_arbitration",
    prompt_intent: {
      primary_intent_kind: input.intentArbitration?.selected_primary_intent_kind ?? "unknown",
      secondary_intent_kinds: input.secondaryIntentKinds ?? [],
      interpretation_ref: input.promptInterpretation ? "prompt_interpretation" : undefined,
      arbitration_ref: input.intentArbitration ? "intent_arbitration" : undefined,
    },
    route: {
      selected_route: input.selectedRoute,
      source_target: effectiveRoute.sourceTarget,
      target_kind: effectiveRoute.targetKind,
      strength: effectiveRoute.strength,
      source_identity:
        readString(readRecord(input.payload.source_target_exact_contract)?.requested_source_identity) ||
        (
          effectiveRoute.sourceTarget === "docs_viewer" ||
          effectiveRoute.sourceTarget === "active_doc"
            ? readString(readRecord(input.payload.active_doc_identity)?.active_doc_path) ||
              readWorkspaceActiveDocPath(input.payload)
            : ""
        ) ||
        null,
      route_reason: effectiveRoute.reason,
      stale_metadata_policy: "ignore_unless_matches_commit",
    },
    canonical_goal: {
      goal_kind: goal.goalKind,
      requested_capability:
        semanticPlayerEmbodimentAction &&
        explicitCapabilityContract &&
        !HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS.includes(
          explicitCapabilityContract.capability as (typeof HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS)[number],
        )
          ? null
          : explicitCapabilityContract?.capability ?? null,
      required_terminal_kind: goal.requiredTerminalKind,
      allowed_terminal_artifact_kinds: allowedTerminalKinds,
      forbidden_terminal_artifact_kinds: forbiddenTerminalKinds,
    },
    capability_policy: {
      allowed_tool_families: allowedFamilies,
      suppressed_tool_families: suppressedFamilies,
      required_capability_families: compoundDocsScholarlyRoute
        ? ["docs_viewer", "scholarly_research"]
        : affirmativeScientificImageContinuity
        ? []
        : affirmativeScholarlyPdfImageLensWorkflow
        ? ["scholarly_research", "visual_analysis"]
        : requiredFamily
          ? [requiredFamily]
          : [],
      mutating_families_allowed: suppressedFamilies.length === 0 && negativeConstraints.length === 0,
    },
    suppression: {
      contextual_tool_mentions: promptSuppressionMentions(input.promptInterpretation),
      negative_constraints: negativeConstraints,
      suppressed_families: suppressedFamilies,
      firewall_required: true,
    },
    terminal_product: {
      terminal_authority_required: true,
      evidence_reentry_required:
        affirmativeScientificImageContinuity ||
        affirmativeScientificImageComparison ||
        affirmativeScholarlyPdfImageLensWorkflow ||
        sourceBacked ||
        readStringArray(routeContract?.required_artifact_refs).length > 0,
      followup_reasoning_required:
        normalizeCommittedRouteTerminalKind(requiredTerminalProduct) ===
        "procedure_epoch_replay"
          ? false
        : compoundDocsScholarlyRoute
          ? true
        : affirmativeScientificImageContinuity
          ? false
          : affirmativeScientificImageComparison ||
        affirmativeScholarlyPdfImageLensWorkflow ||
        (sourceBacked && terminalProductRequiresFollowupReasoning(requiredTerminalProduct)),
      required_terminal_product: requiredTerminalProduct,
    },
    transitions: [],
      compatibility: {
        source_goal_capability_terminal_compatible: violations.length === 0,
      stale_metadata_ignored: staleExistingLivePipelineRoute,
      shortcut_firewall_applied: suppressedFamilies.length > 0,
      violations,
    },
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function evaluateCommittedAskRouteCompatibility(input: {
  committedRoute: HelixCommittedAskRoute | null | undefined;
  payload?: RecordLike | null;
}): HelixCommittedAskRouteCompatibilityResult {
  const route = input.committedRoute ?? readCommittedAskRoute(input.payload ?? undefined);
  const violations = route ? [...route.compatibility.violations] : ["committed_route_missing"];
  return {
    schema: "helix.committed_ask_route_compatibility.v1",
    turn_id: route?.turn_id ?? readString(input.payload?.turn_id) ?? "unknown-turn",
    compatible: violations.length === 0,
    violations,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function buildRouteEvidenceAuthority(input: {
  committedRoute: HelixCommittedAskRoute | null | undefined;
  payload?: RecordLike | null;
}): HelixRouteEvidenceAuthority {
  const payload = input.payload ?? {};
  const route = input.committedRoute ?? readCommittedAskRoute(payload);
  const runtimeSemanticRouteProposal = readRecord(payload.runtime_semantic_route_proposal);
  const runtimeSemanticRouteProposalRef =
    readString(runtimeSemanticRouteProposal?.proposal_id) ||
    readLedgerArtifactRefsByKind(payload, "runtime_semantic_route_proposal")[0] ||
    null;
  const rawRuntimeSemanticRouteProposalSource = readString(runtimeSemanticRouteProposal?.proposal_source);
  const runtimeSemanticRouteProposalSource: "agent_runtime" | "runtime_intent_packet_projection" | null =
    rawRuntimeSemanticRouteProposalSource === "agent_runtime"
      ? "agent_runtime"
      : rawRuntimeSemanticRouteProposalSource === "runtime_intent_packet_projection"
      ? "runtime_intent_packet_projection"
      : null;
  const candidateTools = readCapabilityCandidatesFromPayload(payload);
  const admittedFromPayload = readAdmittedToolsFromPayload(payload);
  const admittedFromRoute = route
    ? route.capability_policy.allowed_tool_families.map((family): HelixRouteEvidenceAuthorityTool => ({
        capability_id: `family:${family}`,
        family,
        reason: "committed_ask_route.capability_policy.allowed_tool_families",
        admission_ref: route.commit_id,
      }))
    : [];
  const rejectedFromRoute = route
    ? route.capability_policy.suppressed_tool_families.map((family): HelixRouteEvidenceAuthorityTool => ({
        capability_id: `family:${family}`,
        family,
        reason: "committed_ask_route.capability_policy.suppressed_tool_families",
        admission_ref: route.commit_id,
      }))
    : [];
  const requiredTerminalKind = route?.canonical_goal.required_terminal_kind ?? null;
  const normalizedRequiredTerminalKind = normalizeCommittedRouteTerminalKind(requiredTerminalKind);
  const forbiddenTerminalArtifactKinds = (route?.canonical_goal.forbidden_terminal_artifact_kinds ?? []).filter(
    (kind) => normalizeCommittedRouteTerminalKind(kind) !== normalizedRequiredTerminalKind,
  );
  const allowedTerminalArtifactKinds = unique([
    ...(route?.canonical_goal.allowed_terminal_artifact_kinds ?? []),
    requiredTerminalKind ?? "",
  ]).filter((kind) => {
    const normalized = normalizeCommittedRouteTerminalKind(kind);
    return Boolean(normalized && normalized !== "unknown") &&
      !forbiddenTerminalArtifactKinds.some((forbidden) => normalizeCommittedRouteTerminalKind(forbidden) === normalized);
  });
  const allowedTerminalOutputRoles = uniqueOutputRoles(
    allowedTerminalArtifactKinds.map((kind) => helixToolOutputRoleForTerminalKind(kind)),
  );
  const requiredTerminalOutputRole = helixToolOutputRoleForTerminalKind(route?.canonical_goal.required_terminal_kind);
  return {
    schema: "helix.route_evidence_authority.v1",
    turn_id: route?.turn_id ?? readString(payload.turn_id) ?? "unknown-turn",
    route_proposal_authority: {
      semantic_route_proposal_source: runtimeSemanticRouteProposalSource,
      runtime_semantic_route_proposal_ref: runtimeSemanticRouteProposalRef,
      classifier_hints: "hint_only",
      prompt_derived_gateway_requests: "policy_admission_fallback",
      route_source_comparison: {
        codex_semantic_proposal_ref:
          runtimeSemanticRouteProposalSource === "agent_runtime" ? runtimeSemanticRouteProposalRef : null,
        explicit_user_command_refs: readLedgerArtifactRefsByKind(payload, "explicit_user_command"),
        prompt_derived_policy_fallback_refs: readLedgerArtifactRefsByKind(payload, "prompt_derived_gateway_request"),
        ambient_context_refs: [
          ...readLedgerArtifactRefsByKind(payload, "scientific_image_evidence_sidecar"),
          ...readLedgerArtifactRefsByKind(payload, "workspace_context_snapshot"),
          ...readLedgerArtifactRefsByKind(payload, "active_panel_context"),
        ],
        final_admitted_route_ref: route ? route.commit_id : null,
      },
      boundary: "runtime_decides_steps_helix_validates_admission",
    },
    candidate_tools: candidateTools,
    admitted_tools: uniqueTools([...admittedFromPayload, ...admittedFromRoute]),
    rejected_tools: uniqueTools(rejectedFromRoute),
    supporting_evidence_refs: readSupportingEvidenceRefsFromPayload(payload),
    allowed_terminal_artifact_kinds: allowedTerminalArtifactKinds,
    forbidden_terminal_artifact_kinds: forbiddenTerminalArtifactKinds,
    required_terminal_kind: requiredTerminalKind,
    allowed_terminal_output_roles: allowedTerminalOutputRoles,
    required_terminal_output_role: requiredTerminalOutputRole,
    terminal_product_allowed: Boolean(route && allowedTerminalArtifactKinds.length > 0),
    current_turn_only: true,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function assertCapabilityAllowedByCommittedRoute(input: {
  committedRoute: HelixCommittedAskRoute | null | undefined;
  capabilityId: string;
  args?: RecordLike | null;
  fromShortcut?: boolean;
}): HelixCommittedAskRouteToolAdmissionResult {
  const family = inferCommittedRouteToolFamily(input.capabilityId);
  const route = input.committedRoute ?? null;
  if (!route) {
    const modelOnlyCompatible = family === "model_only" || family === "unknown";
    return {
      schema: "helix.committed_ask_route_tool_admission.v1",
      turn_id: "unknown-turn",
      capability_id: input.capabilityId,
      inferred_family: family,
      allowed: modelOnlyCompatible,
      reason: modelOnlyCompatible
        ? "committed_route_missing_model_only_compatibility"
        : "committed_route_missing_for_tool_capability",
      from_shortcut: input.fromShortcut === true,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (route.capability_policy.suppressed_tool_families.includes(family)) {
    return {
      schema: "helix.committed_ask_route_tool_admission.v1",
      turn_id: route.turn_id,
      capability_id: input.capabilityId,
      inferred_family: family,
      allowed: false,
      reason: "committed_route_tool_family_suppressed",
      from_shortcut: input.fromShortcut === true,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (
    route.capability_policy.allowed_tool_families.length > 0 &&
    family !== "unknown" &&
    family !== "model_only" &&
    !route.capability_policy.allowed_tool_families.includes(family)
  ) {
    return {
      schema: "helix.committed_ask_route_tool_admission.v1",
      turn_id: route.turn_id,
      capability_id: input.capabilityId,
      inferred_family: family,
      allowed: false,
      reason: "selected_capability_not_allowed_by_committed_route",
      from_shortcut: input.fromShortcut === true,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (
    family === "model_only" &&
    sourceBackedTargets.has(route.route.source_target) &&
    route.terminal_product.evidence_reentry_required
  ) {
    return {
      schema: "helix.committed_ask_route_tool_admission.v1",
      turn_id: route.turn_id,
      capability_id: input.capabilityId,
      inferred_family: family,
      allowed: false,
      reason: "model_direct_answer_selected_for_source_backed_committed_route",
      from_shortcut: input.fromShortcut === true,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  return {
    schema: "helix.committed_ask_route_tool_admission.v1",
    turn_id: route.turn_id,
    capability_id: input.capabilityId,
    inferred_family: family,
    allowed: true,
    reason: "capability_allowed_by_committed_route",
    from_shortcut: input.fromShortcut === true,
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function committedRouteAllowsTerminalKind(input: {
  committedRoute: HelixCommittedAskRoute | null | undefined;
  terminalArtifactKind: string | null | undefined;
  finalAnswerSource?: string | null;
}): boolean {
  const route = input.committedRoute ?? null;
  if (!route) return true;

  const kind =
    normalizeCommittedRouteTerminalKind(input.terminalArtifactKind) ||
    normalizeCommittedRouteTerminalKind(input.finalAnswerSource);

  if (!kind) return false;
  if (kind === "typed_failure" || kind === "request_user_input") return true;

  if (
    route.canonical_goal.goal_kind === "model_only_concept" &&
    route.canonical_goal.required_terminal_kind === "direct_answer_text"
  ) {
    return MODEL_ONLY_TERMINAL_ALIASES.has(kind);
  }

  if (
    route.canonical_goal.forbidden_terminal_artifact_kinds
      .map(normalizeCommittedRouteTerminalKind)
      .includes(kind)
  ) {
    return false;
  }

  const allowed = route.canonical_goal.allowed_terminal_artifact_kinds
    .map(normalizeCommittedRouteTerminalKind);
  return allowed.length === 0 || allowed.includes(kind);
}

export function matchesCommittedAskRoute(
  candidateMetadata: RecordLike | null | undefined,
  committedRoute: HelixCommittedAskRoute | null | undefined,
): boolean {
  if (!candidateMetadata || !committedRoute) return false;
  const candidateTurnId = readString(candidateMetadata.turn_id);
  const candidatePromptHash = readString(candidateMetadata.prompt_hash);
  const candidateSourceTarget =
    readString(candidateMetadata.source_target) ||
    readString(candidateMetadata.target_source) ||
    readString(readRecord(candidateMetadata.source_target_intent)?.target_source);
  const candidateGoalKind =
    readString(candidateMetadata.goal_kind) ||
    readString(readRecord(candidateMetadata.canonical_goal_frame)?.goal_kind);
  return (
    (!candidateTurnId || candidateTurnId === committedRoute.turn_id) &&
    (!candidatePromptHash || candidatePromptHash === committedRoute.prompt_hash) &&
    (!candidateSourceTarget || candidateSourceTarget === committedRoute.route.source_target) &&
    (!candidateGoalKind || candidateGoalKind === committedRoute.canonical_goal.goal_kind)
  );
}
