import crypto from "node:crypto";
import type { HelixAskSourceTargetIntent } from "@shared/helix-ask-source-target-intent";
import {
  HELIX_COMMITTED_ASK_ROUTE_SCHEMA,
  type HelixCommittedAskRoute,
} from "@shared/helix-committed-ask-route";
import type { HelixRouteProductContract } from "@shared/helix-route-product-contract";
import type { HelixToolCallAdmissionDecision } from "@shared/helix-tool-call-admission";
import { committedRouteAllowsTerminalKind } from "./committed-ask-route";
import type { HelixTerminalArtifactSelectionGuard } from "./terminal-artifact-selection-guard";
import type { HelixProductAuthorityGuard } from "./product-authority-guard";
import { applyCompoundTerminalPolicy } from "./compound-terminal-policy";

export type HelixRouteAuthorityViolationCode =
  | "terminal_product_authority_mismatch"
  | "route_contract_missing"
  | "receipt_used_as_content_answer"
  | "client_projection_used_as_answer"
  | "process_graph_used_as_visual_evidence"
  | "pipeline_status_used_as_live_cognition"
  | "model_only_used_for_source_targeted_turn"
  | "no_tool_direct_used_for_hard_source_target"
  | "procedure_memory_bypassed"
  | "repo_evidence_bypassed"
  | "visual_evidence_bypassed";

export type HelixRouteAuthorityAudit = {
  schema: "helix.route_authority_audit.v1";
  audit_id: string;
  turn_id: string;
  prompt_hash: string;
  source_target: string;
  target_kind: string;
  selected_route: string;
  terminal_artifact_kind: string;
  final_answer_source: string;
  route_product_precedence_reason: string;
  allowed_terminal_artifact_kinds: string[];
  forbidden_terminal_artifact_kinds: string[];
  terminal_artifact_allowed: boolean;
  route_authority_ok: boolean;
  primary_violation_code: HelixRouteAuthorityViolationCode | null;
  violation_codes: HelixRouteAuthorityViolationCode[];
  route_authority_violation_code: HelixRouteAuthorityViolationCode | null;
  assistant_answer: false;
  raw_content_included: false;
};

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const hashShort = (value: unknown): string =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const sourceTargeted = new Set([
  "visual_capture",
  "procedure_memory",
  "conversation_memory",
  "situation_epoch",
  "visual_scene_memory",
  "repo_code",
  "runtime_evidence",
  "docs_viewer",
  "active_doc",
  "process_graph",
  "live_pipeline",
  "live_source_mailbox",
  "world_event",
  "active_note",
]);

const uniqueViolationCodes = (codes: HelixRouteAuthorityViolationCode[]): HelixRouteAuthorityViolationCode[] =>
  Array.from(new Set(codes));

const isModelOnlySourceTarget = (sourceTarget: string, targetKind: string): boolean =>
  sourceTarget === "model_only" || targetKind === "general_background";

const isVisualContentPrompt = (promptText: string): boolean =>
  /\b(?:review|explain|describe|summari[sz]e|compare|what(?:'s|\s+is)?|what\s+changed|look\s+at|see|seeing)\b[\s\S]{0,120}\b(?:screen|screenshot|capture|visual|frame|window|tab)\b/i.test(promptText) ||
  /\b(?:screen|screenshot|capture|visual|frame|window|tab)\b[\s\S]{0,120}\b(?:show|shows|showing|seeing|visible|happening|changed)\b/i.test(promptText);

const isProcedureMemoryPrompt = (promptText: string): boolean =>
  /\b(?:what\s+changed|since\s+(?:the\s+)?(?:previous|last)|compare\s+(?:this|current)|replay|earlier|last\s+turn|previous\s+(?:visual|capture|frame|scene))\b/i.test(promptText);

const isLivePipelineProcedurePrompt = (promptText: string, selectedRoute: string): boolean =>
  /^live_(?:source_continuation|pipeline_control|pipeline_inspect|pipeline_repair|runtime_repair|answer_environment_setup)$/i.test(selectedRoute) &&
  (
    !isVisualContentPrompt(promptText) ||
    /\b(?:keep|continue|watch|monitor|track|checking)\b/i.test(promptText)
  ) &&
  (
    /\b(?:keep|continue|watch|monitor|track|checking|check)\b[\s\S]{0,120}\b(?:screen|visual|capture|frame|live\s+answer|live\s+source)\b/i.test(promptText) ||
    /\b(?:set|change|update|start|enable|turn\s+on)\b[\s\S]{0,120}\b(?:interval|cadence|rate|live\s+answer|live\s+source|pipeline|screen|visual)\b/i.test(promptText) ||
    /\b(?:fix|repair|recover|not\s+updating|stale|blocked|status|inspect|ready|readiness)\b[\s\S]{0,120}\b(?:pipeline|visual\s+source|live\s+source|live\s+answer|screen|capture|frame)\b/i.test(promptText) ||
    /\b(?:visual\s+source|live\s+source|live\s+answer|pipeline)\b[\s\S]{0,120}\b(?:not\s+updating|stale|blocked|status|inspect|ready|readiness)\b/i.test(promptText)
  );

const classifyViolations = (input: {
  sourceTarget: string;
  targetKind: string;
  selectedRoute: string;
  terminalArtifactKind: string;
  finalAnswerSource: string;
  promptText: string;
  terminalArtifactAllowed: boolean;
  routeProductContractMissing: boolean;
  hardSourceTarget: boolean;
}): HelixRouteAuthorityViolationCode[] => {
  const terminal = input.terminalArtifactKind;
  const route = input.selectedRoute;
  const sourceTarget = input.sourceTarget;
  const targetKind = input.targetKind;
  const codes: HelixRouteAuthorityViolationCode[] = [];
  const visualContentPrompt = isVisualContentPrompt(input.promptText);
  const procedureMemoryPrompt = isProcedureMemoryPrompt(input.promptText);
  const modelOnlySourceTarget = isModelOnlySourceTarget(sourceTarget, targetKind);
  const procedureMemoryAuthorityApplies =
    sourceTarget === "procedure_memory" ||
    targetKind === "situation_epoch" ||
    (procedureMemoryPrompt && !modelOnlySourceTarget && sourceTarget !== "live_environment" && sourceTarget !== "live_source_mailbox");
  const livePipelineProcedureReceipt =
    terminal === "live_pipeline_receipt" &&
    isLivePipelineProcedurePrompt(input.promptText, route);
  const capabilityHelpAuthorityApplies =
    terminal === "capability_help_summary" ||
    route === "capability_help" ||
    route === "capability_help / capability_help_summary";

  if ((sourceTarget === "visual_capture" || visualContentPrompt || /visual|screen|capture/i.test(route)) && terminal === "process_graph_overview") {
    codes.push("process_graph_used_as_visual_evidence");
  }
  if (!livePipelineProcedureReceipt && (sourceTarget === "visual_capture" || sourceTarget === "procedure_memory" || targetKind === "situation_epoch" || visualContentPrompt || procedureMemoryAuthorityApplies) && terminal === "live_pipeline_receipt") {
    codes.push("receipt_used_as_content_answer");
  }
  if (!livePipelineProcedureReceipt && (sourceTarget === "visual_capture" || sourceTarget === "procedure_memory" || targetKind === "situation_epoch" || visualContentPrompt || procedureMemoryAuthorityApplies) && route === "live_pipeline_control") {
    codes.push("pipeline_status_used_as_live_cognition");
  }
  if (procedureMemoryAuthorityApplies && terminal !== "procedure_epoch_replay" && terminal !== "visual_scene_comparison_result" && terminal !== "typed_failure") {
    codes.push("procedure_memory_bypassed");
  }
  if ((sourceTarget === "repo_code" || (sourceTarget === "runtime_evidence" && !capabilityHelpAuthorityApplies)) && terminal !== "repo_code_evidence_answer" && terminal !== "repo_entity_definition" && terminal !== "typed_failure") {
    codes.push("repo_evidence_bypassed");
  }
  if (!livePipelineProcedureReceipt && (sourceTarget === "visual_capture" || visualContentPrompt) && terminal === "live_pipeline_receipt") codes.push("visual_evidence_bypassed");
  if (input.hardSourceTarget && input.routeProductContractMissing) codes.push("route_contract_missing");
  if (!input.terminalArtifactAllowed) codes.push("terminal_product_authority_mismatch");
  if (terminal === "client_projection" || input.finalAnswerSource === "client_projection") codes.push("client_projection_used_as_answer");
  if (sourceTargeted.has(sourceTarget) && terminal === "model_only_concept") codes.push("model_only_used_for_source_targeted_turn");
  if (sourceTargeted.has(sourceTarget) && terminal === "no_tool_direct") codes.push("no_tool_direct_used_for_hard_source_target");
  return uniqueViolationCodes(codes);
};

export function auditRouteAuthority(input: {
  turnId: string;
  promptText: string;
  selectedRoute: string;
  payload?: Record<string, unknown> | null;
  terminalArtifactKind: string | null | undefined;
  finalAnswerSource: string | null | undefined;
  sourceTargetIntent?: HelixAskSourceTargetIntent | Record<string, unknown> | null;
  routeProductContract?: HelixRouteProductContract | Record<string, unknown> | null;
  toolCallAdmissionDecision?: HelixToolCallAdmissionDecision | Record<string, unknown> | null;
  terminalArtifactSelectionGuard?: HelixTerminalArtifactSelectionGuard | Record<string, unknown> | null;
  productAuthorityGuard?: HelixProductAuthorityGuard | Record<string, unknown> | null;
  committedAskRoute?: HelixCommittedAskRoute | Record<string, unknown> | null;
}): HelixRouteAuthorityAudit {
  const sourceTargetRecord = input.sourceTargetIntent as Record<string, unknown> | null | undefined;
  const contract = input.routeProductContract as Record<string, unknown> | null | undefined;
  const selectionGuard = input.terminalArtifactSelectionGuard as Record<string, unknown> | null | undefined;
  const productGuard = input.productAuthorityGuard as Record<string, unknown> | null | undefined;
  const committedRouteRecord = readRecord(input.committedAskRoute);
  const committedRoute =
    committedRouteRecord?.schema === HELIX_COMMITTED_ASK_ROUTE_SCHEMA
      ? (committedRouteRecord as unknown as HelixCommittedAskRoute)
      : null;
  const committedRouteSource = readRecord(committedRoute?.route);
  const committedCanonicalGoal = readRecord(committedRoute?.canonical_goal);
  const sourceTarget =
    readString(committedRouteSource?.source_target) ||
    readString(sourceTargetRecord?.target_source) ||
    readString(contract?.source_target) ||
    "unknown";
  const targetKind = readString(committedRouteSource?.target_kind) || readString(sourceTargetRecord?.target_kind) || sourceTarget;
  const modelOnlySourceTarget = isModelOnlySourceTarget(sourceTarget, targetKind);
  const hardSourceTarget =
    !modelOnlySourceTarget &&
    (
      readString(sourceTargetRecord?.strength) === "hard" ||
      sourceTargetRecord?.must_enter_backend_ask === true ||
      (sourceTargeted.has(sourceTarget) && sourceTarget !== "unknown")
    );
  const routeProductContractMissing =
    !committedRoute && (!contract || readString(contract.schema) !== "helix.route_product_contract.v1");
  const terminalArtifactKind = readString(input.terminalArtifactKind) || "unknown";
  const finalAnswerSource = readString(input.finalAnswerSource) || "unknown";
  const rawAllowedTerminalArtifactKinds =
    readStringArray(committedCanonicalGoal?.allowed_terminal_artifact_kinds).length > 0
      ? readStringArray(committedCanonicalGoal?.allowed_terminal_artifact_kinds)
      : readStringArray(contract?.allowed_terminal_artifact_kinds);
  const rawForbiddenTerminalArtifactKinds =
    readStringArray(committedCanonicalGoal?.forbidden_terminal_artifact_kinds).length > 0
      ? readStringArray(committedCanonicalGoal?.forbidden_terminal_artifact_kinds)
      : readStringArray(contract?.forbidden_terminal_artifact_kinds);
  const compoundTerminalPolicy = applyCompoundTerminalPolicy(input.payload, {
    allowed: rawAllowedTerminalArtifactKinds,
    forbidden: rawForbiddenTerminalArtifactKinds,
    requiredTerminalKind:
      readString(committedCanonicalGoal?.required_terminal_kind) ||
      readString(contract?.required_terminal_kind),
  });
  const allowedTerminalArtifactKinds = compoundTerminalPolicy.allowed;
  const forbiddenTerminalArtifactKinds = compoundTerminalPolicy.forbidden;
  const livePipelineProcedureReceipt =
    terminalArtifactKind === "live_pipeline_receipt" &&
    isLivePipelineProcedurePrompt(input.promptText, input.selectedRoute);
  const terminalAllowedByCompoundPolicy =
    compoundTerminalPolicy.policy.active &&
    !forbiddenTerminalArtifactKinds.includes(terminalArtifactKind) &&
    (
      allowedTerminalArtifactKinds.length === 0 ||
      allowedTerminalArtifactKinds.includes(terminalArtifactKind)
    );
  const terminalArtifactAllowed =
    livePipelineProcedureReceipt ||
    (
      Boolean(committedRoute) &&
      selectionGuard?.allowed !== false &&
      productGuard?.allowed !== false &&
      (
        compoundTerminalPolicy.policy.active
          ? terminalAllowedByCompoundPolicy
          : committedRouteAllowsTerminalKind({
              committedRoute,
              terminalArtifactKind,
              finalAnswerSource,
            })
      )
    ) ||
    (
      !committedRoute &&
      !(hardSourceTarget && routeProductContractMissing) &&
      selectionGuard?.allowed !== false &&
      productGuard?.allowed !== false &&
      !forbiddenTerminalArtifactKinds.includes(terminalArtifactKind) &&
      (allowedTerminalArtifactKinds.length === 0 || allowedTerminalArtifactKinds.includes(terminalArtifactKind))
    );
  const violationCodes = classifyViolations({
    sourceTarget,
    targetKind,
    selectedRoute: input.selectedRoute,
    terminalArtifactKind,
    finalAnswerSource,
    promptText: input.promptText,
    terminalArtifactAllowed,
    routeProductContractMissing,
    hardSourceTarget,
  });
  const primaryViolationCode = violationCodes[0] ?? null;
  return {
    schema: "helix.route_authority_audit.v1",
    audit_id: `route-authority:${hashShort([input.turnId, input.promptText, sourceTarget, input.selectedRoute, terminalArtifactKind])}`,
    turn_id: input.turnId,
    prompt_hash: hashShort(input.promptText),
    source_target: sourceTarget,
    target_kind: targetKind,
    selected_route: input.selectedRoute,
    terminal_artifact_kind: terminalArtifactKind,
    final_answer_source: finalAnswerSource,
    route_product_precedence_reason: readString(committedRouteSource?.route_reason) || readString(contract?.precedence_reason),
    allowed_terminal_artifact_kinds: allowedTerminalArtifactKinds,
    forbidden_terminal_artifact_kinds: forbiddenTerminalArtifactKinds,
    terminal_artifact_allowed: terminalArtifactAllowed,
    route_authority_ok: terminalArtifactAllowed && violationCodes.length === 0,
    primary_violation_code: primaryViolationCode,
    violation_codes: violationCodes,
    route_authority_violation_code: primaryViolationCode,
    assistant_answer: false,
    raw_content_included: false,
  };
}
