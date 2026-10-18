import type { HelixAskSourceTargetIntent } from "@shared/helix-ask-source-target-intent";
import type { HelixRouteProductContract } from "@shared/helix-route-product-contract";
import {
  HELIX_TOOL_CALL_ADMISSION_DECISION_SCHEMA,
  type HelixToolCallAdmissionDecision,
  type HelixToolCallAdmissionFamily,
  type HelixToolCallAdmissionMode,
} from "@shared/helix-tool-call-admission";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { buildToolUseRestatement, detectInternetSearchIntent } from "./internet-search-intent";
import { buildTurnOperationalConstraints } from "./operational-constraints";
import { detectRepoCodeEvidenceIntent } from "./repo-code-intent-detector";
import { detectScholarlyResearchIntent } from "./scholarly-research-intent";
import {
  extractPlannerBindingCapabilityContracts,
  type ExplicitCapabilityContract,
  type ExplicitCapabilityExtractionContext,
  explicitCapabilityContractForCapability,
} from "./explicit-capability-contract";
import {
  isStagePlayCheckpointRequestPrompt,
  isStagePlayJobPlanningPrompt,
  isStagePlayReflectionPrompt,
} from "./stage-play-prompt-intent";
import { isWorkspaceOsStatusPrompt } from "./workspace-os-status-intent";
import { isAskCapabilityCatalogPrompt } from "./capability-catalog-intent";
import { isTheoryFrontierVectorFieldTracePrompt } from "./theory-frontier-vector-field-intent";

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const uniqueExplicitCapabilityContracts = (
  contracts: Array<ExplicitCapabilityContract | null | undefined>,
): ExplicitCapabilityContract[] => {
  const seen = new Set<string>();
  const result: ExplicitCapabilityContract[] = [];
  for (const contract of contracts) {
    if (!contract || seen.has(contract.capability)) continue;
    seen.add(contract.capability);
    result.push(contract);
  }
  return result;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry: unknown) => readString(entry)).filter((entry: string | null): entry is string => Boolean(entry))
    : [];

const readNestedRecord = (
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): Record<string, unknown> | null => {
  for (const key of keys) {
    const nested = readRecord(record?.[key]);
    if (nested) return nested;
  }
  return null;
};

const readMandatoryToolName = (record: Record<string, unknown> | null | undefined): string | null =>
  readString(record?.tool_name) ??
  readString(record?.toolName) ??
  readString(record?.selected_capability) ??
  readString(record?.selectedCapability) ??
  readString(record?.capability) ??
  readString(record?.required_capability) ??
  readString(record?.requiredCapability) ??
  readString(record?.name);

const isCalculatorSolveCapability = (value: string | null | undefined): boolean =>
  Boolean(value && /^scientific-calculator\.solve(?:_expression|_with_steps)?$/i.test(value.trim()));

const promptNegatesCalculatorSolveCapability = (prompt: string): boolean => {
  const matcher = /\bscientific-calculator\.solve(?:_expression|_with_steps)?\b/gi;
  for (const match of prompt.matchAll(matcher)) {
    const matchIndex = typeof match.index === "number" ? match.index : -1;
    if (matchIndex < 0) continue;
    const before = prompt.slice(Math.max(0, matchIndex - 140), matchIndex);
    const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
    if (/\b(?:do\s+not|don't|dont|never|avoid|without|no)\b[\s\S]{0,80}\b(?:call|run|use|invoke|execute)?\b[\s\S]{0,80}$/i.test(clausePrefix)) {
      return true;
    }
  }
  return false;
};

const promptRequiresCalculatorExecution = (promptText: string): boolean => {
  const prompt = promptText.trim();
  if (!prompt) return false;
  if (promptNegatesCalculatorSolveCapability(prompt)) return false;
  const namesCalculatorTool = /\bscientific-calculator\.solve(?:_expression|_with_steps)?\b/i.test(prompt);
  const affirmativeToolVerb = /\b(?:call|run|use|invoke|execute)\b[\s\S]{0,80}\bscientific-calculator\.solve(?:_expression|_with_steps)?\b/i.test(prompt);
  const receiptOrTerminalCue = /\b(?:calculator_receipt|workstation_tool_evaluation|calculator-backed terminal result|calculator-backed terminal)\b/i.test(prompt);
  const exactExpressionCue = /\bwith\s+this\s+exact\s+expression\b/i.test(prompt);
  return namesCalculatorTool && affirmativeToolVerb && (receiptOrTerminalCue || exactExpressionCue);
};

const hasConcreteCalculatorExpression = (prompt: string): boolean =>
  /\bscientific-calculator\.solve(?:_expression|_with_steps)?\b/i.test(prompt) ||
  /\b(?:with\s+(?:this\s+exact\s+)?expression|expression\s+is|expression)\s*:?\s*[0-9][0-9eE\s.+\-*/^%()[\]]{1,120}/i.test(prompt);

const hasAffirmativeCalculatorExpressionPayload = (prompt: string): boolean =>
  /\b(?:run|use|call|calculate|compute|solve|evaluate)\b[^.!?;\n]{0,100}\bcalculator\b[^.!?;\n]{0,100}\bexpression\s*:\s*[0-9][0-9eE\s.+\-*/^%()[\]]{1,120}/i.test(prompt);

const isConditionalPriorEvidenceCalculatorFollowup = (prompt: string): boolean => {
  const conditional = /\b(?:if|when|provided\s+that|only\s+if|assuming)\b/i.test(prompt);
  const priorEvidence = /\b(?:previous|prior|above|last|earlier)\b[\s\S]{0,100}\b(?:answers?|evidence|result|retrieval|values?|variables?)\b/i.test(prompt);
  const sufficiencyCheck = /\b(?:enough|sufficient|usable|adequate|complete|fully\s+cited|unit[-\s]?bearing|cited)\b[\s\S]{0,120}\b(?:values?|numbers?|numerics?|parameters?|evidence|citations?|units?)\b/i.test(prompt);
  const calculatorFollowup = /\b(?:bind|calculate|compute|evaluate|solve|run)\b[\s\S]{0,140}\b(?:formula|expression|calculator|numeric(?:al)?\s+expression|result)\b/i.test(prompt);
  return conditional && priorEvidence && sufficiencyCheck && calculatorFollowup;
};

const HARD_SOURCE_TARGETS = new Set([
  "visual_capture",
  "procedure_memory",
  "situation_epoch",
  "visual_scene_memory",
  "repo_code",
  "scholarly_research",
  "internet_search",
  "theory_locator",
  "runtime_evidence",
  "context_reflection",
  "workspace_diagnostic",
  "docs_viewer",
  "workspace_directory",
  "active_doc",
  "process_graph",
  "live_pipeline",
  "live_environment",
  "live_source_mailbox",
  "world_event",
  "active_note",
  "workspace_panel",
  "workstation_panel",
  "workspace_action",
  "calculator",
  "calculator_solve",
  "calculator_stream",
]);

const HELIX_TOOL_CALL_ADMISSION_FAMILIES = new Set<string>([
  "situation_run",
  "procedure_memory",
  "visual_scene_memory",
  "docs_viewer",
  "workspace_directory",
  "repo_code",
  "scholarly_research",
  "internet_search",
  "theory_locator",
  "runtime_evidence",
  "context_reflection",
  "workspace_diagnostic",
  "capability_catalog",
  "live_environment",
  "live_pipeline",
  "process_graph",
  "world_event",
  "calculator",
  "notes",
  "workstation_action",
  "model_only",
]);

const isToolCallAdmissionFamily = (value: string): value is HelixToolCallAdmissionFamily =>
  HELIX_TOOL_CALL_ADMISSION_FAMILIES.has(value);

const sourceTargetToolFamilies = (
  sourceTarget: string,
  promptText = "",
  sourceTargetIntent?: HelixAskSourceTargetIntent | Record<string, unknown> | null,
): string[] => {
  if (sourceTarget === "docs_viewer" || sourceTarget === "active_doc") return ["docs_viewer"];
  if (sourceTarget === "scholarly_research") return ["scholarly_research"];
  if (sourceTarget === "internet_search") return ["internet_search"];
  if (sourceTarget === "repo_code" && isAskCapabilityCatalogPrompt(promptText)) {
    return ["capability_catalog", "runtime_evidence"];
  }
  if (sourceTarget === "repo_code") return ["repo_code"];
  if (sourceTarget === "runtime_evidence" && isAskCapabilityCatalogPrompt(promptText)) {
    return ["capability_catalog", "runtime_evidence"];
  }
  if (sourceTarget === "live_environment" || sourceTarget === "live_source_mailbox") return ["live_environment"];
  if (sourceTarget === "visual_capture") return ["situation_run"];
  if (sourceTarget === "active_note") return ["notes"];
  if (sourceTarget === "calculator" || sourceTarget === "calculator_solve" || sourceTarget === "calculator_stream") {
    return ["calculator", "workstation_action"];
  }
  if (sourceTarget === "workspace_panel" || sourceTarget === "workstation_panel" || sourceTarget === "workspace_action") {
    const joined = [
      promptText,
      ...(
        Array.isArray((sourceTargetIntent as Record<string, unknown> | null | undefined)?.explicit_cues)
          ? (sourceTargetIntent as Record<string, unknown>).explicit_cues as string[]
          : []
      ),
      ...(
        Array.isArray((sourceTargetIntent as Record<string, unknown> | null | undefined)?.reasons)
          ? (sourceTargetIntent as Record<string, unknown>).reasons as string[]
          : []
      ),
      ...(
        Array.isArray((sourceTargetIntent as Record<string, unknown> | null | undefined)?.requested_outputs)
          ? (sourceTargetIntent as Record<string, unknown>).requested_outputs as string[]
          : []
      ),
    ].join(" ");
    if (
      !/\b(?:stage\s*play|stage_play|live_env\.reflect_stage_play_context|reflect_stage_play_context|live\s+interpretation|stage\s*play\s+badge\s+graph)\b/i.test(joined) &&
      (
        /theory_context_reflection|reflect_theory_context|theory\s+badge\s+graph|theory\s+graph|badge\s+graph|scale\s+bands?|uncertainty\s+mode/i.test(joined) ||
        isTheoryFrontierVectorFieldTracePrompt(joined)
      )
    ) {
      return ["theory_locator"];
    }
    return ["workstation_action"];
  }
  return [sourceTarget];
};

const theoryLocatorRequested = (promptText: string): boolean => {
  const prompt = promptText.trim();
  if (!prompt) return false;
  if (/\b(?:stage\s*play|stage_play|live_env\.reflect_stage_play_context|reflect_stage_play_context|live\s+interpretation|stage\s*play\s+badge\s+graph)\b/i.test(prompt)) {
    return false;
  }
  if (/\b(?:do\s+not|don't|dont|never|without|no)\b[^.!?;\n]{0,120}\b(?:theory\s+badge\s+graph|badge\s+graph|theory\s+graph|theory_context_reflection|reflect_theory_context|scale\s+bands?|uncertainty\s+mode)\b/i.test(prompt)) {
    return false;
  }
  if (isTheoryFrontierVectorFieldTracePrompt(prompt)) return true;
  return /\b(?:theory\s+badge\s+graph|theory\s+badges?|badge\s+graph|physics\s+graph|theory\s+graph|theory_context_reflection|reflect_theory_context|helix_ask\.reflect_theory_context|graph\s+placement|scale\s+bands?|semantic\s+chunks?|uncertainty\s+mode|locate\b[\s\S]{0,80}\b(?:theory|badge|graph)|place\b[\s\S]{0,80}\b(?:theory|badge|graph|claims?)|map\b[\s\S]{0,80}\b(?:theory|badge|graph)|where\s+(?:does|do)\b[\s\S]{0,100}\b(?:fit|land|map))\b/i.test(prompt);
};

const calculatorSolveRequested = (
  promptText: string,
  sourceTargetIntent?: HelixAskSourceTargetIntent | Record<string, unknown> | null,
): boolean => {
  const prompt = promptText.trim();
  if (!prompt) return false;
  if (isConditionalPriorEvidenceCalculatorFollowup(prompt) && !hasConcreteCalculatorExpression(prompt)) return false;
  const sourceTargetRecord = sourceTargetIntent as Record<string, unknown> | null | undefined;
  const joined = [
    prompt,
    String(sourceTargetRecord?.target_source ?? ""),
    String(sourceTargetRecord?.target_kind ?? ""),
    ...(
      Array.isArray(sourceTargetRecord?.explicit_cues)
        ? sourceTargetRecord.explicit_cues as string[]
        : []
    ),
    ...(
      Array.isArray(sourceTargetRecord?.reasons)
        ? sourceTargetRecord.reasons as string[]
        : []
    ),
    ...(
      Array.isArray(sourceTargetRecord?.requested_outputs)
        ? sourceTargetRecord.requested_outputs as string[]
        : []
    ),
  ].join(" ");
  if (/\b(?:calculator_stream|calculator_solve|scientific_calculator_solve|scientific-calculator\.solve_expression|calculator_receipt)\b/i.test(joined)) {
    return true;
  }
  if (/\b(?:scientific\s+calculator|calculator)\b[\s\S]{0,80}\b(?:solve|evaluate|calculate|compute)\b/i.test(prompt)) {
    return true;
  }
  if (/\b(?:solve|evaluate|calculate|compute)\b[\s\S]{0,80}\b(?:scientific\s+calculator|calculator|expression|equation)\b/i.test(prompt)) {
    return true;
  }
  if (/\b(?:solve|evaluate|calculate|compute)\b[\s\S]{0,120}(?:\d|[=+\-*/^()]|\\frac|\\sqrt|\bsqrt\s*\(|\bln\s*\(|\blog\s*\(|\bsin\s*\(|\bcos\s*\(|\btan\s*\()/i.test(prompt)) {
    return true;
  }
  return false;
};

const contextualForbiddenToolFamilies = (
  suppression: ReturnType<typeof detectContextualToolAdmissionSuppression>,
): string[] => {
  if (!suppression) return [];
  return [
    contextualToolSuppressionBlocksFamily(suppression, "docs_viewer") ? "docs_viewer" : "",
    contextualToolSuppressionBlocksFamily(suppression, "calculator") ||
    contextualToolSuppressionBlocksFamily(suppression, "scientific_calculator") ? "calculator" : "",
    contextualToolSuppressionBlocksFamily(suppression, "scholarly_research") ? "scholarly_research" : "",
    contextualToolSuppressionBlocksFamily(suppression, "internet_search") ? "internet_search" : "",
    contextualToolSuppressionBlocksFamily(suppression, "visual_capture") ? "visual_capture" : "",
    contextualToolSuppressionBlocksFamily(suppression, "situation_run") ? "situation_run" : "",
    contextualToolSuppressionBlocksFamily(suppression, "runtime_evidence") ? "runtime_evidence" : "",
    contextualToolSuppressionBlocksFamily(suppression, "workspace_diagnostic") ? "workspace_diagnostic" : "",
    contextualToolSuppressionBlocksFamily(suppression, "theory_locator") ? "theory_locator" : "",
    contextualToolSuppressionBlocksFamily(suppression, "workstation_action") ? "workstation_action" : "",
    contextualToolSuppressionBlocksFamily(suppression, "notes") ? "notes" : "",
    contextualToolSuppressionBlocksFamily(suppression, "repo_code") ? "repo_code" : "",
    contextualToolSuppressionBlocksFamily(suppression, "live_environment") ? "live_environment" : "",
  ].filter(Boolean);
};

export const hasUnknownSourceArtifactDiscoveryIntent = (promptText: string): boolean => {
  const prompt = promptText.trim();
  if (!prompt) return false;
  if (
    /\b(?:do\s+not|don't|dont|never|without|no\s+need\s+to)\b[\s\S]{0,80}\b(?:find|locate|look\s+for|search\s+for|retrieve|get|pull\s+up|open|show|bring\s+up|read)\b[\s\S]{0,120}\b(?:white\s*paper|whitepaper|paper|docs?|documents?|file|report|memo|artifact|source|note|path)\b/i.test(prompt)
  ) {
    return false;
  }
  if (
    /\b(?:later|next\s+time|in\s+the\s+future|not\s+now|not\s+yet|eventually|hypothetically)\b[\s\S]{0,120}\b(?:find|locate|look\s+for|search\s+for|retrieve|get|pull\s+up|open|show|bring\s+up|read)\b/i.test(prompt)
  ) {
    return false;
  }
  if (
    /^\s*(?:docs?\s+viewer|documents?\s+viewer|docs[-_. ]viewer)\s*:/i.test(prompt) &&
    /\b(?:dynamic\s+actions?|capabilit(?:y|ies)|coverage|test\s+evidence|surface|well\s+represented|core\s+actions?)\b/i.test(prompt)
  ) {
    return false;
  }
  if (
    /\b(?:screen|visible\s+text|label|button|debug|ui\s+text)\b[\s\S]{0,100}\b(?:says|shows|reads|contains|mentions)\b/i.test(prompt)
  ) {
    return false;
  }
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  if (
    contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer") ||
    contextualToolSuppressionBlocksFamily(contextualSuppression, "repo_code")
  ) {
    return false;
  }
  const artifactCue =
    /\b(?:white\s*paper|whitepaper|paper|docs?|documents?|file|report|memo|artifact|source|note|path|where)\b/i.test(prompt);
  const namedSubjectCue =
    /\b[A-Z][A-Z0-9-]{2,}\b/.test(prompt) ||
    /\b[A-Z][A-Za-z0-9-]{2,}\s+(?:theory|spec|design|paper|doc|report|memo|file)\b/.test(prompt);
  const retrievalActionBeforeTarget =
    /\b(?:find|locate|look\s+for|search\s+for|retrieve|get|pull\s+up|open|show|bring\s+up|read)\b[\s\S]{0,140}\b(?:white\s*paper|whitepaper|paper|docs?|documents?|file|report|memo|artifact|source|note|path|where|[A-Z][A-Z0-9-]{2,})\b/i.test(prompt);
  const explicitExternalScope =
    /\b(?:arxiv|doi|journal|peer[-\s]?reviewed|pubmed|openalex|semantic\s+scholar|crossref|citations?|bibliograph(?:y|ies)|published|web|internet|online|google|bing|scholarly\s+(?:paper|article|source)|research\s+papers?)\b/i.test(prompt);
  return retrievalActionBeforeTarget && (artifactCue || namedSubjectCue) && !explicitExternalScope;
};

export function buildToolCallAdmissionDecision(input: {
  turnId: string;
  sourceTargetIntent?: HelixAskSourceTargetIntent | Record<string, unknown> | null;
  routeProductContract?: HelixRouteProductContract | Record<string, unknown> | null;
  canonicalGoalFrame?: Record<string, unknown> | null;
  mandatoryNextTool?: Record<string, unknown> | null;
  promptText?: string | null;
  trustedEnvironmentContext?: ExplicitCapabilityExtractionContext | null;
}): HelixToolCallAdmissionDecision {
  const sourceTargetIntentRecord = readRecord(input.sourceTargetIntent);
  const routeProductContractRecord = readRecord(input.routeProductContract);
  const canonicalGoalFrameRecord =
    readRecord(input.canonicalGoalFrame) ??
    readNestedRecord(routeProductContractRecord, "canonical_goal_frame", "canonicalGoalFrame", "canonical_goal", "canonicalGoal") ??
    readNestedRecord(sourceTargetIntentRecord, "canonical_goal_frame", "canonicalGoalFrame", "canonical_goal", "canonicalGoal");
  const mandatoryNextToolRecord =
    readRecord(input.mandatoryNextTool) ??
    readNestedRecord(sourceTargetIntentRecord, "mandatory_next_tool", "mandatoryNextTool") ??
    readNestedRecord(routeProductContractRecord, "mandatory_next_tool", "mandatoryNextTool");
  const intentSourceTarget = String(
    sourceTargetIntentRecord?.target_source ??
    "",
  );
  const contractSourceTarget = String(
    routeProductContractRecord?.source_target ??
    "",
  );
  const sourceTarget = String(
    (intentSourceTarget && intentSourceTarget !== "unknown" ? intentSourceTarget : null) ??
    (contractSourceTarget && contractSourceTarget !== "unknown" ? contractSourceTarget : null) ??
    intentSourceTarget ??
    contractSourceTarget ??
    "unknown",
  );
  const sourceTargetKind = String(
    sourceTargetIntentRecord?.target_kind ?? "",
  );
  const contractForbidden = readStringArray(routeProductContractRecord?.forbidden_terminal_artifact_kinds);
  const sourceForbiddenRoutes = readStringArray(sourceTargetIntentRecord?.suppressed_routes);
  const promptText = String(input.promptText ?? "");
  const operationalConstraints = buildTurnOperationalConstraints({
    turnId: input.turnId,
    promptText,
  });
  const operationalFields = {
    operational_constraints_ref: `${input.turnId}:turn_operational_constraints`,
    forbidden_tools: operationalConstraints.forbidden_tools,
    forbidden_tool_families: operationalConstraints.forbidden_tool_families,
    exclusive_tool_capabilities:
      operationalConstraints.exclusive_tool_capabilities,
    requested_tool_cardinality:
      operationalConstraints.requested_tool_cardinality,
    required_surface: operationalConstraints.required_surface,
  };
  const contextualSuppression = detectContextualToolAdmissionSuppression(promptText);
  const toolUseRestatement = buildToolUseRestatement(promptText);
  const unknownSourceArtifactDiscoveryRequested = hasUnknownSourceArtifactDiscoveryIntent(promptText);
  const explicitLocalDocsScope =
    /\b(?:from|in|within)\s+(?:the\s+)?docs?\b/i.test(promptText) ||
    /\b(?:current|active|this)\s+(?:doc|document)\b/i.test(promptText) ||
    /\b(?:doc|document)\s+(?:we|i|you|we're|are)\s+(?:looking|viewing|reading)\b/i.test(promptText) ||
    /\b(?:docs[-_\s]?viewer|docs?\s+panel)\b/i.test(promptText);
  const unknownSourceArtifactDiscoveryIntent =
    unknownSourceArtifactDiscoveryRequested &&
    (
      sourceTarget === "unknown" ||
      (
        !explicitLocalDocsScope &&
        (sourceTarget === "docs_viewer" || sourceTarget === "active_doc")
      )
    );
  const calculatorSolveIntent = calculatorSolveRequested(promptText, input.sourceTargetIntent);
  const mandatoryToolName = readMandatoryToolName(mandatoryNextToolRecord);
  const promptExplicitCapabilityMatches = extractPlannerBindingCapabilityContracts(
    promptText,
    input.trustedEnvironmentContext,
  );
  const promptExplicitCapabilityContracts = uniqueExplicitCapabilityContracts(
    promptExplicitCapabilityMatches.map((match) => match.contract),
  );
  const promptExplicitCapabilityContract =
    promptExplicitCapabilityMatches[0]?.contract ?? null;
  const hardVisualCaptureSource =
    sourceTarget === "visual_capture" &&
    readString(sourceTargetIntentRecord?.strength) === "hard";
  const policySelectedCapabilityContract = hardVisualCaptureSource
    ? explicitCapabilityContractForCapability(
        "situation-room.describe_visual_capture",
      )
    : unknownSourceArtifactDiscoveryRequested &&
        (sourceTarget === "docs_viewer" || sourceTarget === "active_doc")
      ? explicitCapabilityContractForCapability("docs.search")
      : null;
  const candidateExplicitCapabilityContract =
    promptExplicitCapabilityContract ??
    explicitCapabilityContractForCapability(mandatoryToolName) ??
    policySelectedCapabilityContract;
  const contextualModelOnlySuppression =
    Boolean(contextualSuppression) &&
    (sourceTarget === "model_only" || sourceTarget === "general_background") &&
    !hasAffirmativeCalculatorExpressionPayload(promptText);
  const explicitCapabilityContractsForAdmission = uniqueExplicitCapabilityContracts([
    ...promptExplicitCapabilityContracts,
    candidateExplicitCapabilityContract,
  ]).filter((contract) =>
    !contextualModelOnlySuppression ||
    !contract.admission_families.some((family) =>
      contextualToolSuppressionBlocksFamily(contextualSuppression, family)
    )
  );
  const explicitCapabilityContract = candidateExplicitCapabilityContract &&
    explicitCapabilityContractsForAdmission.some((contract) =>
      contract.capability === candidateExplicitCapabilityContract.capability
    )
    ? candidateExplicitCapabilityContract
    : null;
  const explicitCapabilityAdmissionFamilies = unique(
    explicitCapabilityContractsForAdmission.flatMap((contract) => contract.admission_families),
  );
  const explicitCapabilityAdmissionFamilySet = new Set<HelixToolCallAdmissionFamily>(
    explicitCapabilityAdmissionFamilies,
  );
  const requestedCapabilitySource = promptExplicitCapabilityContract
    ? "explicit_user_command"
    : policySelectedCapabilityContract &&
        candidateExplicitCapabilityContract?.capability === policySelectedCapabilityContract.capability
      ? "hard_source_target_policy"
    : explicitCapabilityContract
      ? "mandatory_next_tool"
      : null;
  const requestedCapabilityConfidence = promptExplicitCapabilityContract
    ? 0.99
    : policySelectedCapabilityContract &&
        candidateExplicitCapabilityContract?.capability === policySelectedCapabilityContract.capability
      ? 0.96
    : explicitCapabilityContract
      ? 0.95
      : null;
  const canonicalGoalKind =
    readString(canonicalGoalFrameRecord?.goal_kind) ??
    readString(canonicalGoalFrameRecord?.goalKind) ??
    readString(routeProductContractRecord?.goal_kind) ??
    readString(routeProductContractRecord?.goalKind) ??
    readString(sourceTargetIntentRecord?.goal_kind) ??
    null;
  const requiredActions = unique([
    ...readStringArray(routeProductContractRecord?.required_actions),
    ...readStringArray(routeProductContractRecord?.requiredActions),
    ...readStringArray(canonicalGoalFrameRecord?.required_actions),
    ...readStringArray(canonicalGoalFrameRecord?.requiredActions),
  ]);
  const mandatoryCalculatorSolve =
    canonicalGoalKind === "calculator_solve" ||
    isCalculatorSolveCapability(mandatoryToolName) ||
    requiredActions.some(isCalculatorSolveCapability) ||
    promptRequiresCalculatorExecution(promptText);
  const explicitCalculatorContractRequested =
    explicitCapabilityContractsForAdmission.some((contract) =>
      contract.admission_families.includes("calculator") ||
      contract.capability === "scientific-calculator.solve_expression",
    );
  const mandatoryCalculatorBlockedByContext =
    !explicitCalculatorContractRequested &&
    (
      contextualToolSuppressionBlocksFamily(contextualSuppression, "calculator") ||
      contextualToolSuppressionBlocksFamily(contextualSuppression, "scientific_calculator") ||
      contextualToolSuppressionBlocksFamily(contextualSuppression, "workstation_action")
    );
  const calculatorAdmissionDominatesSourceTarget =
    mandatoryCalculatorSolve &&
    !mandatoryCalculatorBlockedByContext &&
    sourceTarget !== "unknown" &&
    sourceTarget !== "calculator_stream" &&
    sourceTarget !== "calculator" &&
    sourceTarget !== "calculator_solve";
  const explicitCapabilityDominatesSourceTarget =
    Boolean(explicitCapabilityContract) &&
    sourceTarget !== "unknown" &&
    sourceTarget !== explicitCapabilityContract?.source_target &&
    !sourceTargetToolFamilies(sourceTarget, promptText, input.sourceTargetIntent).some((family) =>
      explicitCapabilityContract?.admission_families.includes(family as HelixToolCallAdmissionFamily),
    );
  const admittedToolFamiliesBeforeMandatoryOverride =
    calculatorAdmissionDominatesSourceTarget || explicitCapabilityDominatesSourceTarget
      ? sourceTargetToolFamilies(sourceTarget, promptText, input.sourceTargetIntent)
          .filter(isToolCallAdmissionFamily)
      : [];
  const promptScholarlyResearchIntent = detectScholarlyResearchIntent(promptText);
  const promptInternetSearchIntent = detectInternetSearchIntent(promptText);
  const promptRepoCodeEvidenceIntent = detectRepoCodeEvidenceIntent(promptText);
  const explicitRepoCodeScope =
    /\b(?:repo(?:sitory)?|codebase|source\s+code|implementation|function|class|module|route|endpoint|file\s+path|line\s+number)\b/i.test(promptText);
  const promptScholarlyResearchRequested = promptScholarlyResearchIntent.researchRequested;
  const unresolvedSourceTarget =
    sourceTarget === "unknown" ||
    sourceTarget === "" ||
    sourceTarget === "model_only" ||
    sourceTarget === "general_background";
  const effectiveSourceTarget =
    explicitCapabilityContract
      ? explicitCapabilityContract.source_target
      : calculatorAdmissionDominatesSourceTarget
      ? "calculator_stream"
      : unknownSourceArtifactDiscoveryIntent && unresolvedSourceTarget
      ? "unknown"
      : (
        sourceTarget === "unknown" ||
        sourceTarget === "" ||
        sourceTarget === "model_only" ||
        sourceTarget === "general_background"
      ) && !unknownSourceArtifactDiscoveryIntent && toolUseRestatement.requiredToolFamilies.includes("docs_viewer")
      ? "docs_viewer"
      : (sourceTarget === "unknown" || sourceTarget === "") && promptScholarlyResearchRequested
      ? "scholarly_research"
      : (sourceTarget === "unknown" || sourceTarget === "") && toolUseRestatement.requiredToolFamilies.includes("internet_search")
      ? "internet_search"
      : sourceTarget === "unknown" && (calculatorSolveIntent || mandatoryCalculatorSolve)
      ? "calculator_stream"
      : sourceTarget === "calculator" || sourceTarget === "calculator_solve"
      ? "calculator_stream"
      : sourceTarget;
  const contextualSuppressionBlocksSelectedTarget =
    Boolean(contextualSuppression) &&
    (
      effectiveSourceTarget === "unknown" ||
      effectiveSourceTarget === "model_only" ||
      effectiveSourceTarget === "general_background" ||
      sourceTargetToolFamilies(effectiveSourceTarget, promptText, input.sourceTargetIntent).some((family: string) =>
        contextualToolSuppressionBlocksFamily(contextualSuppression, family) &&
        !explicitCapabilityAdmissionFamilySet.has(family as HelixToolCallAdmissionFamily),
      )
    );
  if (contextualSuppressionBlocksSelectedTarget && contextualSuppression) {
    return {
      schema: HELIX_TOOL_CALL_ADMISSION_DECISION_SCHEMA,
      turn_id: input.turnId,
      source_target: "model_only",
      required: false,
      admitted_tool_families: ["model_only"],
      forbidden_terminal_artifact_kinds: [],
      forbidden_routes: [],
      reason: "contextual_tool_reference_suppressed",
      tool_admission_suppressed: true,
      suppression_reason: contextualSuppression.suppression_reason,
      ...operationalFields,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  let required = Boolean(explicitCapabilityContract) || HARD_SOURCE_TARGETS.has(effectiveSourceTarget);
  let admittedToolFamilies: HelixToolCallAdmissionFamily[] = [];
  let extraForbiddenTerminalKinds: string[] = [];
  let extraForbiddenRoutes: string[] = [];
  let extraForbiddenTools: string[] = [];
  let extraForbiddenToolFamilies: string[] = [];
  let admissionMode: HelixToolCallAdmissionMode = "direct";
  let discoveryPolicy: HelixToolCallAdmissionDecision["discovery_policy"] | undefined;
  let reason = "source_target_requires_evidence_path";
  const isStagePlayLiveEnvironmentPrompt =
    effectiveSourceTarget === "live_environment" &&
    (
      isStagePlayCheckpointRequestPrompt(promptText) ||
      isStagePlayJobPlanningPrompt(promptText) ||
      isStagePlayReflectionPrompt(promptText)
    );

  if (
    effectiveSourceTarget === "docs_viewer" ||
    effectiveSourceTarget === "active_doc"
  ) {
    admittedToolFamilies = ["docs_viewer"];
    extraForbiddenTerminalKinds = ["situation_context_pack", "visual_context_pack", "live_card_projection", "no_tool_direct", "model_only_concept"];
    extraForbiddenRoutes = ["situation_context_question", "visual_deictic"];
    reason = "docs_viewer_requires_document_tool_path";
  } else if (effectiveSourceTarget === "scholarly_research") {
    admittedToolFamilies = ["scholarly_research"];
    extraForbiddenTerminalKinds = [
      "direct_answer_text",
      "no_tool_direct",
      "model_only_concept",
      "client_projection",
      "panel_generated_answer",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "docs_viewer_receipt",
      "active_doc_identity",
      "doc_open_receipt",
      "doc_summary",
      "doc_location_result",
      "repo_code_evidence_answer",
      "repo_entity_definition",
    ];
    extraForbiddenRoutes = [
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "repo_code_evidence_question",
      "model_only_concept",
      "no_tool_direct",
    ];
    reason = "scholarly_research_requires_external_paper_evidence_path";
  } else if (effectiveSourceTarget === "internet_search") {
    admittedToolFamilies = ["internet_search"];
    extraForbiddenTerminalKinds = [
      "direct_answer_text",
      "no_tool_direct",
      "model_only_concept",
      "client_projection",
      "panel_generated_answer",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "docs_viewer_receipt",
      "active_doc_identity",
      "doc_open_receipt",
      "doc_summary",
      "doc_location_result",
      "repo_code_evidence_answer",
      "scholarly_research_answer",
      "repo_entity_definition",
    ];
    extraForbiddenRoutes = [
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "repo_code_evidence_question",
      "scholarly_research_lookup",
      "model_only_concept",
      "no_tool_direct",
    ];
    reason = "internet_search_requires_external_web_evidence_path";
  } else if (effectiveSourceTarget === "theory_locator") {
    admittedToolFamilies = ["theory_locator"];
    extraForbiddenTerminalKinds = [
      "direct_answer_text",
      "no_tool_direct",
      "model_only_concept",
      "client_projection",
      "panel_generated_answer",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "docs_viewer_receipt",
      "active_doc_identity",
      "doc_open_receipt",
      "doc_summary",
      "doc_location_result",
      "repo_code_evidence_answer",
    ];
    extraForbiddenRoutes = [
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "repo_code_evidence_question",
      "model_only_concept",
      "no_tool_direct",
    ];
    reason = "theory_locator_requires_reflection_tool_path";
  } else if (effectiveSourceTarget === "context_reflection") {
    admittedToolFamilies = ["context_reflection"];
    extraForbiddenTerminalKinds = [
      "direct_answer_text",
      "no_tool_direct",
      "model_only_concept",
      "client_projection",
      "panel_generated_answer",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "docs_viewer_receipt",
      "active_doc_identity",
      "doc_open_receipt",
      "doc_summary",
      "doc_location_result",
      "repo_code_evidence_answer",
    ];
    extraForbiddenRoutes = [
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "repo_code_evidence_question",
      "model_only_concept",
      "no_tool_direct",
    ];
    reason = "context_reflection_requires_reflection_tool_path";
  } else if (unknownSourceArtifactDiscoveryIntent) {
    required = true;
    admittedToolFamilies = ["workspace_directory", "docs_viewer", "repo_code", "runtime_evidence"];
    extraForbiddenTerminalKinds = [
      "direct_answer_text",
      "situation_context_pack",
      "visual_context_pack",
      "live_card_projection",
      "client_projection",
      "panel_generated_answer",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "scholarly_research_answer",
      "internet_search_answer",
      "no_tool_direct",
      "model_only_concept",
    ];
    extraForbiddenRoutes = [
      "situation_context_question",
      "visual_deictic",
      "scholarly_research_lookup",
      "internet_search_lookup",
      "model_only_concept",
      "no_tool_direct",
    ];
    extraForbiddenTools = ["docs-viewer.open", "docs-viewer.open_doc_by_path"];
    extraForbiddenToolFamilies = ["scholarly_research", "internet_search"];
    admissionMode = "unknown_source_discovery";
    discoveryPolicy = {
      state: "bounded_readonly",
      first_pass_tool_families: ["workspace_directory", "docs_viewer", "repo_code", "runtime_evidence"],
      forbidden_external_tool_families: ["scholarly_research", "internet_search"],
      on_not_found: "ask_or_explain_searched_scope",
    };
    reason = "unknown_source_artifact_request_requires_bounded_readonly_discovery";
  } else if (sourceTarget === "workspace_diagnostic" || isWorkspaceOsStatusPrompt(promptText)) {
    required = true;
    admittedToolFamilies = ["workspace_diagnostic"];
    extraForbiddenTerminalKinds = [
      "direct_answer_text",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "docs_viewer_receipt",
      "doc_open_receipt",
      "doc_summary",
      "active_doc_identity",
      "situation_context_pack",
      "visual_context_pack",
      "client_projection",
      "panel_generated_answer",
      "no_tool_direct",
      "model_only_concept",
    ];
    extraForbiddenRoutes = [
      "workspace_panel",
      "workstation_panel",
      "workstation_action",
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "visual_deictic",
      "visual_frame_evidence",
      "model_only_concept",
      "no_tool_direct",
    ];
    reason = "workspace_diagnostic_requires_workspace_os_status_tool_path";
  } else if (sourceTarget === "workspace_panel" || sourceTarget === "workstation_panel" || sourceTarget === "workspace_action") {
    const workspacePanelFamilies = sourceTargetToolFamilies(sourceTarget, promptText, input.sourceTargetIntent);
    admittedToolFamilies = workspacePanelFamilies.includes("theory_locator")
      ? ["theory_locator"]
      : ["workstation_action"];
    extraForbiddenTerminalKinds = ["situation_context_pack", "visual_context_pack", "live_pipeline_receipt", "active_doc_identity", "doc_open_receipt", "doc_summary", "no_tool_direct", "model_only_concept"];
    extraForbiddenRoutes = ["situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "active_doc_summary", "doc_open_best", "model_only_concept", "no_tool_direct"];
    reason = workspacePanelFamilies.includes("theory_locator")
      ? "theory_locator_requires_readonly_locator_path"
      : "workspace_panel_requires_workstation_action_path";
  } else if (effectiveSourceTarget === "calculator_stream") {
    admittedToolFamilies = ["calculator", "workstation_action"];
    extraForbiddenTerminalKinds = ["situation_context_pack", "visual_context_pack", "live_pipeline_receipt", "active_doc_identity", "doc_open_receipt", "doc_summary", "no_tool_direct", "model_only_concept", "direct_answer_text"];
    extraForbiddenRoutes = ["situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "active_doc_summary", "doc_open_best", "model_only_concept", "no_tool_direct"];
    reason = "calculator_stream_requires_calculator_tool_path";
  } else if (
    /\b(?:create|add|append|store|save|write)\b[\s\S]{0,80}\b(?:workstation\s+)?notes?\b/i.test(promptText) ||
    /\b(?:workstation\s+)?notes?\b[\s\S]{0,80}\b(?:create|add|append|store|save|write)\b/i.test(promptText)
  ) {
    required = true;
    admittedToolFamilies = ["notes", "workstation_action"];
    extraForbiddenTerminalKinds = ["situation_context_pack", "visual_context_pack", "live_pipeline_receipt", "active_doc_identity", "doc_open_receipt", "doc_summary", "no_tool_direct", "model_only_concept", "direct_answer_text"];
    extraForbiddenRoutes = ["situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "active_doc_summary", "doc_open_best", "model_only_concept", "no_tool_direct"];
    reason = "note_mutation_prompt_requires_notes_tool_path";
  } else if (sourceTarget === "visual_capture") {
    admittedToolFamilies = ["situation_run"];
    extraForbiddenTerminalKinds = ["active_doc_identity", "doc_summary", "doc_location_matches", "live_pipeline_receipt", "client_projection", "no_tool_direct", "model_only_concept", "panel_generated_answer"];
    extraForbiddenRoutes = ["active_doc_identity", "active_doc_summary", "doc_open_best", "live_pipeline_receipt", "client_projection", "model_only_concept", "no_tool_direct", "panel_generated_answer"];
    reason = "visual_capture_requires_situation_run_path";
  } else if (sourceTarget === "procedure_memory" || sourceTarget === "situation_epoch") {
    if (sourceTargetKind === "visual_scene_memory") {
      admittedToolFamilies = ["visual_scene_memory", "procedure_memory", "situation_run"];
      extraForbiddenTerminalKinds = ["process_graph_overview", "live_environment_binding_diagnosis", "live_pipeline_receipt", "situation_context_pack", "no_tool_direct", "model_only_concept"];
      extraForbiddenRoutes = ["process_graph_overview", "live_environment_binding_diagnosis", "model_only_concept", "no_tool_direct"];
      reason = "visual_scene_memory_requires_scene_memory_path";
    } else {
      admittedToolFamilies = ["procedure_memory", "situation_run"];
      extraForbiddenTerminalKinds = ["process_graph_overview", "docs_viewer_receipt", "doc_location_result", "active_doc_identity", "active_doc_summary", "workspace_action_receipt", "live_pipeline_receipt", "live_environment_binding_diagnosis", "no_tool_direct", "model_only_concept"];
      extraForbiddenRoutes = ["process_graph_overview", "active_doc_identity", "live_environment_binding_diagnosis", "model_only_concept", "no_tool_direct"];
      reason = "procedure_memory_requires_epoch_replay_path";
    }
  } else if (sourceTarget === "visual_scene_memory") {
    admittedToolFamilies = ["visual_scene_memory", "procedure_memory", "situation_run"];
    extraForbiddenTerminalKinds = ["process_graph_overview", "live_environment_binding_diagnosis", "live_pipeline_receipt", "situation_context_pack", "no_tool_direct", "model_only_concept"];
    extraForbiddenRoutes = ["process_graph_overview", "live_environment_binding_diagnosis", "model_only_concept", "no_tool_direct"];
    reason = "visual_scene_memory_requires_scene_memory_path";
  } else if (sourceTarget === "repo_code" || sourceTarget === "runtime_evidence") {
    const capabilityCatalogPrompt = isAskCapabilityCatalogPrompt(promptText);
    admittedToolFamilies = capabilityCatalogPrompt
      ? ["capability_catalog", "runtime_evidence"]
      : sourceTarget === "runtime_evidence" ? ["repo_code", "runtime_evidence"] : ["repo_code"];
    extraForbiddenTerminalKinds = ["direct_answer_text", "no_tool_direct", "model_only_concept", "process_graph_overview", "situation_context_pack"];
    extraForbiddenRoutes = ["situation_context_question", "process_graph_overview", "model_only_concept"];
    reason = capabilityCatalogPrompt
      ? "capability_catalog_prompt_requires_runtime_catalog_observation"
      : "repo_code_requires_repo_evidence_path";
  } else if (sourceTarget === "live_pipeline") {
    admittedToolFamilies = ["live_pipeline"];
    extraForbiddenTerminalKinds = ["situation_context_pack", "doc_summary", "active_doc_identity", "no_tool_direct", "model_only_concept"];
    extraForbiddenRoutes = ["situation_context_question", "active_doc_identity", "model_only_concept"];
    reason = "live_pipeline_requires_receipt_presentation_path";
  } else if (
    effectiveSourceTarget === "live_environment" ||
    effectiveSourceTarget === "live_source_mailbox"
  ) {
    admittedToolFamilies = ["live_environment"];
    extraForbiddenTerminalKinds = isStagePlayLiveEnvironmentPrompt
      ? ["situation_context_pack", "doc_summary", "active_doc_identity", "live_card_projection", "live_pipeline_receipt", "client_projection", "panel_generated_answer", "no_tool_direct", "model_only_concept"]
      : ["direct_answer_text", "situation_context_pack", "doc_summary", "active_doc_identity", "live_card_projection", "panel_generated_answer", "no_tool_direct", "model_only_concept"];
    extraForbiddenRoutes = ["situation_context_question", "active_doc_identity", "model_only_concept", "no_tool_direct", "panel_generated_answer"];
    reason = effectiveSourceTarget === "live_source_mailbox"
      ? "live_source_mailbox_requires_mail_read_then_decision"
      : isStagePlayLiveEnvironmentPrompt
      ? "stage_play_live_environment_requires_tool_observation_then_model_synthesis"
      : "live_environment_requires_tool_evidence_path";
  } else if (effectiveSourceTarget === "world_event") {
    admittedToolFamilies = ["world_event"];
    extraForbiddenTerminalKinds = ["active_doc_identity", "doc_location_matches", "no_tool_direct", "model_only_concept"];
    reason = "world_event_requires_world_source_path";
  } else if (sourceTarget === "active_note") {
    admittedToolFamilies = ["notes"];
    reason = "active_note_requires_note_tool_path";
  } else if (sourceTarget === "process_graph") {
    admittedToolFamilies = ["process_graph"];
    extraForbiddenTerminalKinds = ["procedure_epoch_replay", "visual_scene_comparison_result", "repo_code_evidence_answer", "doc_location_result", "situation_context_pack", "no_tool_direct", "model_only_concept"];
    extraForbiddenRoutes = ["situation_context_question", "procedure_epoch_replay_question", "visual_deictic", "model_only_concept", "no_tool_direct"];
    reason = "process_graph_requires_workstation_process_path";
  } else if (sourceTarget === "model_only" || sourceTarget === "general_background") {
    required = false;
    admittedToolFamilies = ["model_only"];
    reason = "model_only_direct_answer_allowed";
  } else {
    required = false;
    admittedToolFamilies = ["model_only"];
    reason = "no_hard_tool_path_admitted";
  }

  const contextualForbiddenFamiliesForTurn = contextualForbiddenToolFamilies(contextualSuppression)
    .filter((family) => !explicitCapabilityAdmissionFamilySet.has(family as HelixToolCallAdmissionFamily));
  const forbiddenFamiliesForTurn = unique([
    ...operationalFields.forbidden_tool_families,
    ...extraForbiddenToolFamilies,
    ...contextualForbiddenFamiliesForTurn,
  ]);
  const familyAllowed = (family: HelixToolCallAdmissionFamily): boolean =>
    !forbiddenFamiliesForTurn.includes(family) &&
    (
      explicitCapabilityAdmissionFamilySet.has(family) ||
      !contextualToolSuppressionBlocksFamily(contextualSuppression, family)
    );
  const compoundPromptFamilies: HelixToolCallAdmissionFamily[] = [];
  const boundedLiveSourceTarget = [
    "workspace_diagnostic",
    "theory_locator",
    "calculator_stream",
  ].includes(effectiveSourceTarget);
  if (
    promptScholarlyResearchRequested &&
    (!boundedLiveSourceTarget || promptScholarlyResearchIntent.strength === "hard") &&
    familyAllowed("scholarly_research")
  ) {
    compoundPromptFamilies.push("scholarly_research");
  }
  if (
    (
      (promptInternetSearchIntent.searchRequested &&
        (!boundedLiveSourceTarget || promptInternetSearchIntent.strength === "hard")) ||
      toolUseRestatement.requiredToolFamilies.includes("internet_search")
    ) &&
    familyAllowed("internet_search")
  ) {
    compoundPromptFamilies.push("internet_search");
  }
  if (
    promptRepoCodeEvidenceIntent.repoEvidenceRequested &&
    (!boundedLiveSourceTarget || promptRepoCodeEvidenceIntent.strength === "hard") &&
    (effectiveSourceTarget !== "docs_viewer" || explicitRepoCodeScope) &&
    familyAllowed("repo_code")
  ) {
    compoundPromptFamilies.push("repo_code");
  }
  if (toolUseRestatement.requiredToolFamilies.includes("docs_viewer") && familyAllowed("docs_viewer")) {
    compoundPromptFamilies.push("docs_viewer");
  }
  if (theoryLocatorRequested(promptText) && familyAllowed("theory_locator")) {
    compoundPromptFamilies.push("theory_locator");
  }
  const uniqueCompoundPromptFamilies = unique(compoundPromptFamilies);
  if (uniqueCompoundPromptFamilies.length > 1) {
    const nextFamilies = unique([
      ...admittedToolFamilies.filter((family: HelixToolCallAdmissionFamily) => family !== "model_only"),
      ...uniqueCompoundPromptFamilies,
    ]);
    if (nextFamilies.length > admittedToolFamilies.filter((family: HelixToolCallAdmissionFamily) => family !== "model_only").length) {
      admittedToolFamilies = nextFamilies;
      required = true;
      reason = `${reason}+compound_evidence_families_required`;
    }
  }

  const compoundLocatorRequired =
    theoryLocatorRequested(promptText) &&
    familyAllowed("theory_locator") &&
    (
      effectiveSourceTarget === "scholarly_research" ||
      effectiveSourceTarget === "internet_search" ||
      effectiveSourceTarget === "repo_code" ||
      admittedToolFamilies.includes("scholarly_research") ||
      admittedToolFamilies.includes("internet_search") ||
      admittedToolFamilies.includes("repo_code")
    );
  if (compoundLocatorRequired && !admittedToolFamilies.includes("theory_locator")) {
    admittedToolFamilies = [...admittedToolFamilies.filter((family: HelixToolCallAdmissionFamily) => family !== "model_only"), "theory_locator"];
    required = true;
    reason = `${reason}+compound_theory_locator_required`;
  }

  if (explicitCapabilityContractsForAdmission.length > 0) {
    const requestedFamilies = explicitCapabilityContractsForAdmission
      .flatMap((contract) => contract.admission_families)
      .filter(familyAllowed);
    const nextFamilies = unique([
      ...admittedToolFamilies.filter((family: HelixToolCallAdmissionFamily) => family !== "model_only"),
      ...requestedFamilies,
    ]);
    admittedToolFamilies = nextFamilies;
    required = true;
    reason = `${reason}+${
      explicitCapabilityContractsForAdmission.length > 1
        ? "compound_explicit_capability_contracts_required"
        : "explicit_capability_contract_required"
    }`;
    if (explicitCapabilityDominatesSourceTarget) {
      reason = `${reason}+explicit_capability_contract_dominance`;
    }
  }

  if (calculatorAdmissionDominatesSourceTarget) {
    reason = `${reason}+mandatory_calculator_admission_dominance`;
  }
  const finalAdmittedToolFamilies = unique(admittedToolFamilies);
  const mandatoryCapabilityAdmitted =
    mandatoryCalculatorSolve &&
    finalAdmittedToolFamilies.includes("calculator") &&
    finalAdmittedToolFamilies.includes("workstation_action");
  const explicitCapabilityAdmitted = explicitCapabilityContract
    ? explicitCapabilityContractsForAdmission.every((contract) =>
        contract.admission_families.every((family) => finalAdmittedToolFamilies.includes(family))
      )
    : false;
  const routeArbitrationGuardVersion = explicitCapabilityContract ? "E82" as const : "E80" as const;
  const routeArbitrationSelectedCapability =
    explicitCapabilityContract?.runtime_capability ??
    explicitCapabilityContract?.capability ??
    mandatoryToolName ??
    (mandatoryCalculatorSolve ? "scientific-calculator.solve_expression" : null);
  const routeArbitrationMandatoryFamily =
    explicitCapabilityContract?.admission_families[0] ??
    (mandatoryCalculatorSolve ? "calculator" as const : null);
  const routeArbitrationMandatoryAdmitted =
    explicitCapabilityContract ? explicitCapabilityAdmitted : mandatoryCapabilityAdmitted;
  const secondarySourceTargets = unique([
    ...(calculatorAdmissionDominatesSourceTarget && sourceTarget === "repo_code" ? ["repo_code"] : []),
    ...(explicitCapabilityDominatesSourceTarget && sourceTarget !== "unknown" ? [sourceTarget] : []),
  ]);
  const routeArbitration =
    explicitCapabilityContract || mandatoryCalculatorSolve || calculatorAdmissionDominatesSourceTarget
      ? {
          schema: "helix.tool_call_admission_route_arbitration.v1" as const,
          guard_version: routeArbitrationGuardVersion,
          original_source_target: sourceTarget,
          effective_source_target: effectiveSourceTarget,
          canonical_goal_kind: canonicalGoalKind,
          mandatory_next_tool_name: explicitCapabilityContract?.capability ?? mandatoryToolName,
          mandatory_capability_family: routeArbitrationMandatoryFamily,
          mandatory_capability_admitted: routeArbitrationMandatoryAdmitted,
          admitted_tool_families_before_mandatory_override: unique(admittedToolFamiliesBeforeMandatoryOverride),
          admitted_tool_families_after_mandatory_override: finalAdmittedToolFamilies,
          calculator_goal_overrode_repo_source_target: calculatorAdmissionDominatesSourceTarget && sourceTarget === "repo_code",
          repo_code_preserved_as_secondary_context: calculatorAdmissionDominatesSourceTarget && sourceTarget === "repo_code",
          requested_capability: explicitCapabilityContract?.capability ?? null,
          requested_capability_family: explicitCapabilityContract?.capability_family ?? null,
          compound_requested_capabilities: promptExplicitCapabilityContracts.map((contract) => contract.capability),
          compound_required_observation_kinds: unique(promptExplicitCapabilityContracts.flatMap((contract) => contract.required_observation_kinds)),
          compound_explicit_capability_admission_families: explicitCapabilityAdmissionFamilies,
          contextual_forbidden_tool_families_after_explicit_override: contextualForbiddenFamiliesForTurn,
          contextual_suppression_overridden_for_explicit_capabilities:
            contextualForbiddenToolFamilies(contextualSuppression).some((family) =>
              explicitCapabilityAdmissionFamilySet.has(family as HelixToolCallAdmissionFamily),
            ),
          requested_capability_source: requestedCapabilitySource,
          requested_capability_confidence: requestedCapabilityConfidence,
          required_observation_kinds_for_requested_capability:
            explicitCapabilityContract?.required_observation_kinds ?? [],
          explicit_capability_overrode_source_target: explicitCapabilityDominatesSourceTarget,
          secondary_source_targets: secondarySourceTargets,
          tool_admission_reason: reason,
          tool_admission_dominance_reason: explicitCapabilityContract
            ? "explicit_requested_capability_contract"
            : calculatorAdmissionDominatesSourceTarget
              ? "mandatory_calculator_capability"
              : null,
          selected_capability: routeArbitrationSelectedCapability,
          runtime_capability_rejection_reason: routeArbitrationMandatoryAdmitted ? null : "mandatory_capability_not_admitted",
          first_broken_rail: routeArbitrationMandatoryAdmitted ? null : "capability_execution" as const,
          repair_target: routeArbitrationMandatoryAdmitted ? null : "tool_admission" as const,
          assistant_answer: false as const,
          raw_content_included: false as const,
        }
      : null;

  return {
    schema: HELIX_TOOL_CALL_ADMISSION_DECISION_SCHEMA,
    turn_id: input.turnId,
    source_target: effectiveSourceTarget,
    ...(admissionMode !== "direct" ? { admission_mode: admissionMode } : {}),
    ...(discoveryPolicy ? { discovery_policy: discoveryPolicy } : {}),
    required,
    admitted_tool_families: finalAdmittedToolFamilies,
    forbidden_terminal_artifact_kinds: unique([
      ...contractForbidden,
      ...extraForbiddenTerminalKinds,
      ...(required ? ["no_tool_direct", "model_only_concept"] : []),
    ]),
    forbidden_routes: unique([
      ...sourceForbiddenRoutes,
      ...extraForbiddenRoutes,
      ...(required ? ["model_only_concept", "no_tool_direct"] : []),
    ]),
    operational_constraints_ref: operationalFields.operational_constraints_ref,
    forbidden_tools: unique([
      ...operationalFields.forbidden_tools,
      ...extraForbiddenTools,
    ]),
    forbidden_tool_families: unique([
      ...operationalFields.forbidden_tool_families,
      ...extraForbiddenToolFamilies,
      ...forbiddenFamiliesForTurn,
    ]),
    exclusive_tool_capabilities:
      operationalFields.exclusive_tool_capabilities,
    requested_tool_cardinality:
      operationalFields.requested_tool_cardinality,
    required_surface: operationalFields.required_surface,
    reason,
    ...(routeArbitration
      ? {
          route_arbitration_guard_version: routeArbitration.guard_version,
          original_source_target: routeArbitration.original_source_target,
          effective_source_target: routeArbitration.effective_source_target,
          canonical_goal_kind: routeArbitration.canonical_goal_kind,
          mandatory_next_tool_name: routeArbitration.mandatory_next_tool_name,
          mandatory_capability_family: routeArbitration.mandatory_capability_family,
          mandatory_capability_admitted: routeArbitration.mandatory_capability_admitted,
          admitted_tool_families_before_mandatory_override:
            routeArbitration.admitted_tool_families_before_mandatory_override,
          admitted_tool_families_after_mandatory_override:
            routeArbitration.admitted_tool_families_after_mandatory_override,
          calculator_goal_overrode_repo_source_target:
            routeArbitration.calculator_goal_overrode_repo_source_target,
          repo_code_preserved_as_secondary_context:
            routeArbitration.repo_code_preserved_as_secondary_context,
          ...(explicitCapabilityContract
            ? {
                capability_contract_guard_version: "E82" as const,
                requested_capability: explicitCapabilityContract.capability,
                requested_capability_family: explicitCapabilityContract.capability_family,
                compound_requested_capabilities: promptExplicitCapabilityContracts.map((contract) => contract.capability),
                compound_required_observation_kinds: unique(promptExplicitCapabilityContracts.flatMap((contract) => contract.required_observation_kinds)),
                compound_explicit_capability_admission_families: explicitCapabilityAdmissionFamilies,
                contextual_forbidden_tool_families_after_explicit_override: contextualForbiddenFamiliesForTurn,
                contextual_suppression_overridden_for_explicit_capabilities:
                  contextualForbiddenToolFamilies(contextualSuppression).some((family) =>
                    explicitCapabilityAdmissionFamilySet.has(family as HelixToolCallAdmissionFamily),
                  ),
                requested_capability_source: requestedCapabilitySource,
                requested_capability_confidence: requestedCapabilityConfidence,
                required_observation_kinds_for_requested_capability:
                  explicitCapabilityContract.required_observation_kinds,
                explicit_capability_overrode_source_target: explicitCapabilityDominatesSourceTarget,
                secondary_source_targets: routeArbitration.secondary_source_targets,
              }
            : {}),
          tool_admission_reason: routeArbitration.tool_admission_reason,
          tool_admission_dominance_reason: routeArbitration.tool_admission_dominance_reason,
          selected_capability: routeArbitration.selected_capability,
          admitted_capability: routeArbitration.mandatory_capability_admitted
            ? routeArbitration.selected_capability
            : null,
          executed_capability: null,
          runtime_capability_rejection_reason:
            routeArbitration.runtime_capability_rejection_reason,
          first_broken_rail: routeArbitration.first_broken_rail,
          repair_target: routeArbitration.repair_target,
          route_arbitration: routeArbitration,
        }
      : {}),
    assistant_answer: false,
    raw_content_included: false,
  };
}

export function ensureToolCallAdmissionDecisionForPayload(input: {
  payload: Record<string, unknown>;
  turnId: string;
  promptText?: string | null;
}): Record<string, unknown> {
  const existing = readRecord(input.payload.tool_call_admission_decision);
  if (existing) return existing;
  const decision = buildToolCallAdmissionDecision({
    turnId: input.turnId,
    promptText: input.promptText,
    sourceTargetIntent: readRecord(input.payload.source_target_intent),
    routeProductContract: readRecord(input.payload.route_product_contract),
    canonicalGoalFrame: readRecord(input.payload.canonical_goal_frame),
    mandatoryNextTool: readRecord(input.payload.mandatory_next_tool),
  });
  input.payload.tool_call_admission_decision = decision;
  return decision;
}
