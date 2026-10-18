import {
  HELIX_CAPABILITY_ITINERARY_SCHEMA,
  type HelixCapabilityItinerary,
  type HelixCapabilityItineraryFamily,
  type HelixCapabilityItineraryStep,
  type HelixCapabilityItineraryStepStatus,
} from "@shared/helix-capability-itinerary";
import type { HelixToolCallAdmissionDecision } from "@shared/helix-tool-call-admission";
import { HELIX_INTERNET_SEARCH_CAPABILITY } from "@shared/helix-internet-search-observation";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { buildToolUseRestatement, detectInternetSearchIntent } from "./internet-search-intent";
import {
  buildHelixCompoundCapabilityContract,
  buildHelixSingleCapabilityContractFromAdmission,
  prependHelixRequiredGroundingCapability,
} from "./compound-capability-contract";
import type {
  ExplicitCapabilityContract,
  ExplicitCapabilityExtractionContext,
} from "./explicit-capability-contract";
import { isAskTurnCapabilityHelpIntent } from "./capability-catalog-intent";
import { detectRepoCodeEvidenceIntent } from "./repo-code-intent-detector";
import { detectScholarlyResearchIntent } from "./scholarly-research-intent";
import {
  HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY,
  isTheoryFrontierVectorFieldTracePrompt,
} from "./theory-frontier-vector-field-intent";

type RecordLike = Record<string, unknown>;

const THEORY_CONTEXT_REFLECTION_CAPABILITY = "helix_ask.reflect_theory_context";

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const unique = <T extends string>(values: T[]): T[] => Array.from(new Set(values));

const capabilityRecords = (availableCapabilities?: unknown): RecordLike[] => {
  const record = readRecord(availableCapabilities);
  const rawCapabilities = Array.isArray(record?.capabilities)
    ? record.capabilities
    : Array.isArray(availableCapabilities)
      ? availableCapabilities
      : [];
  return rawCapabilities.map(readRecord).filter((entry): entry is RecordLike => Boolean(entry));
};

const capabilityAvailable = (capability: RecordLike): boolean =>
  readString(capability.availability) !== "not_available" &&
  readString(capability.availability) !== "permission_denied" &&
  readString(capability.goal_fit) !== "forbidden";

const hasCapability = (availableCapabilities: unknown, key: string): boolean =>
  capabilityRecords(availableCapabilities).some((capability) => readString(capability.capability_key) === key && capabilityAvailable(capability));

const hasAnyCapability = (availableCapabilities: unknown, keys: string[]): boolean =>
  keys.some((key) => hasCapability(availableCapabilities, key));

const theoryLocatorRequested = (promptText: string): boolean =>
  !/\b(?:stage\s*play|stage_play|live_env\.reflect_stage_play_context|reflect_stage_play_context|live\s+interpretation|stage\s*play\s+badge\s+graph)\b/i.test(promptText) &&
  /\b(?:theory\s+badge\s+graph|theory\s+badges?|badge\s+graph|physics\s+graph|theory\s+graph|theory_context_reflection|reflect_theory_context|helix_ask\.reflect_theory_context|graph\s+placement|scale\s+bands?|semantic\s+chunks?|uncertainty\s+mode|locate\b[\s\S]{0,80}\b(?:theory|badge|graph)|place\b[\s\S]{0,80}\b(?:theory|badge|graph|claims?)|map\b[\s\S]{0,80}\b(?:theory|badge|graph)|where\s+(?:does|do)\b[\s\S]{0,100}\b(?:fit|land|map))\b/i.test(promptText);

const theoryFrontierRequested = (promptText: string): boolean =>
  (theoryLocatorRequested(promptText) || isTheoryFrontierVectorFieldTracePrompt(promptText)) &&
  /\b(?:theory\s+frontier|frontier\s+seed|seed\s+finder|frontier\s+candidate|missing\s+intermediate\s+badges?|unresolved\s+semantic\s+regions?|in\s+between\s+(?:the\s+)?badges?|candidate\s+terrain|biome\s+fields?|probability\s+terrain|verified_frontier_yield_per_budget|frontier\s+projection)\b/i.test(promptText);

const requestedResearchFamilies = (promptText: string): HelixCapabilityItineraryFamily[] => {
  const suppression = detectContextualToolAdmissionSuppression(promptText);
  const scholarlySuppressed = contextualToolSuppressionBlocksFamily(suppression, "scholarly_research");
  const internetSuppressed = contextualToolSuppressionBlocksFamily(suppression, "internet_search");
  const scholarlyIntent = detectScholarlyResearchIntent(promptText);
  const internetIntent = detectInternetSearchIntent(promptText);
  const restatement = buildToolUseRestatement(promptText);
  const families: HelixCapabilityItineraryFamily[] = [];
  if (!scholarlySuppressed && scholarlyIntent.researchRequested) {
    families.push("scholarly_research");
  }
  if (
    !internetSuppressed &&
    (
      internetIntent.searchRequested ||
      restatement.requiredToolFamilies.includes("internet_search")
    )
  ) {
    families.push("internet_search");
  }
  return families;
};

const requestedRepoFamilies = (promptText: string): HelixCapabilityItineraryFamily[] => {
  const suppression = detectContextualToolAdmissionSuppression(promptText);
  if (contextualToolSuppressionBlocksFamily(suppression, "repo_code")) return [];
  const repoIntent = detectRepoCodeEvidenceIntent(promptText);
  return repoIntent.repoEvidenceRequested ||
    /\b(?:repo\/code|repo\s+code|repo\s+evidence|code\s+evidence|repository\s+evidence|file-backed|file\s+backed)\b/i.test(promptText)
    ? ["repo_code"]
    : [];
};

const explicitRepoEvidenceCueAllowedInCompound = (promptText: string): boolean =>
  /\b(?:repo-code\.search_concept|repo\s*\/\s*code|repo\s+evidence|repository\s+evidence|code\s+evidence|source\s+code|codebase|where\s+in\s+(?:the\s+)?(?:code|repo|repository|codebase)|implementation\s+(?:path|file|location|evidence)|line-backed|line\s+backed|repo\s+grep|rg\s+search)\b/i.test(promptText);

const hasAffirmativeLocalDocumentEvidenceRequest = (promptText: string): boolean =>
  /\b(?:check|use|from|in|inside|look\s+in|look\s+at|consult|according\s+to|where|find|locate|reported|stated|specified|listed|table|row|source|cite|citation|evidence)\b/i.test(promptText) &&
  (
    /\b(?:white\s*paper|whitepaper|paper|document|doc|docs|memo)\b/i.test(promptText) ||
    /\b(?:a|an|the|this|that|our|your|their|current|open|active|attached|local|workspace)\s+report\b/i.test(promptText) ||
    /\breport\s+(?:document|file|titled|named|section|table|page|appendix)\b/i.test(promptText)
  );

const hasExplicitLocalDocumentScope = (promptText: string): boolean =>
  /\b(?:docs?\s+viewer|documents?\s+viewer|(?:current(?:ly)?|open|active|visible)\s+(?:doc|document|paper|white\s*paper|whitepaper)|document\s+path\s*:|locate\s+query\s*:|from\s+(?:our|local|the)\s+docs?)\b/i.test(promptText) ||
  /(?:^|[\s"'(])\/?docs\/[A-Za-z0-9_./-]+(?:\.mdx?|\.txt)?\b/i.test(promptText);

const requestedDocsFamilies = (promptText: string): HelixCapabilityItineraryFamily[] => {
  const suppression = detectContextualToolAdmissionSuppression(promptText);
  if (contextualToolSuppressionBlocksFamily(suppression, "docs_viewer")) return [];
  const scholarlyIntent = detectScholarlyResearchIntent(promptText);
  if (scholarlyIntent.researchRequested && !hasExplicitLocalDocumentScope(promptText)) return [];
  return buildToolUseRestatement(promptText).requiredToolFamilies.includes("docs_viewer") ||
    hasAffirmativeLocalDocumentEvidenceRequest(promptText)
    ? ["docs_viewer"]
    : [];
};

const observationKindsFor = (family: HelixCapabilityItineraryFamily, promptText: string): string[] => {
  if (family === "scholarly_research") {
    const scholarlyIntent = detectScholarlyResearchIntent(promptText);
    const fullTextRequired = scholarlyIntent.scholarlyIntent.evidence_demand.required_modes.includes("full_text");
    const kinds = fullTextRequired
      ? ["scholarly_research_observation", "scholarly_full_text_observation"]
      : ["scholarly_research_observation"];
    return theoryFrontierRequested(promptText)
      ? [...kinds, "theory_frontier_literature_map"]
      : kinds;
  }
  if (family === "internet_search") return ["internet_search_observation"];
  if (family === "docs_viewer") return ["doc_search_results", "doc_candidate_validation", "doc_location_matches", "doc_evidence_location", "doc_summary"];
  if (family === "theory_locator") {
    if (isTheoryFrontierVectorFieldTracePrompt(promptText)) {
      return [
        "helix_theory_frontier_vector_field_tool_receipt",
        "theory_frontier_vector_field",
      ];
    }
    return theoryFrontierRequested(promptText)
      ? [
          "helix_theory_context_reflection_tool_receipt",
          "theory_context_reflection",
          "theory_frontier_search",
          "theory_frontier_candidate",
          "theory_frontier_exact_contract_verification",
        ]
      : ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"];
  }
  if (family === "repo_code") return ["repo_code_evidence_observation"];
  return [`${family}_observation`];
};

const capabilityHintFor = (family: HelixCapabilityItineraryFamily, promptText: string): string | null => {
  if (family === "scholarly_research") {
    const scholarlyIntent = detectScholarlyResearchIntent(promptText);
    return scholarlyIntent.scholarlyIntent.evidence_demand.required_modes.includes("full_text")
      ? HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY
      : HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY;
  }
  if (family === "internet_search") return HELIX_INTERNET_SEARCH_CAPABILITY;
  if (family === "docs_viewer") return "docs-viewer.search_docs";
  if (family === "theory_locator") {
    return isTheoryFrontierVectorFieldTracePrompt(promptText)
      ? HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY
      : THEORY_CONTEXT_REFLECTION_CAPABILITY;
  }
  if (family === "repo_code") return "repo-code.search_concept";
  return null;
};

const allowedTerminalKindsFor = (families: HelixCapabilityItineraryFamily[]): string[] => {
  const kinds: string[] = ["final_answer_draft"];
  if (families.includes("scholarly_research")) kinds.push("scholarly_research_answer");
  if (families.includes("internet_search")) kinds.push("internet_search_answer");
  if (families.includes("docs_viewer")) kinds.push("doc_open_receipt", "doc_summary", "doc_location_result", "doc_evidence_synthesis_answer");
  if (families.includes("repo_code")) kinds.push("repo_code_evidence_answer");
  if (families.includes("theory_locator")) kinds.push("theory_context_reflection_answer", "workstation_tool_evaluation");
  return unique(kinds);
};

const compoundTerminalKindsFor = (subgoals: RecordLike[]): string[] =>
  unique(subgoals.map((subgoal) => readString(subgoal.required_terminal_kind)).filter(Boolean));

export const requiredScholarlyCapabilitiesFromCompoundSubgoals = (
  compoundSubgoals: RecordLike[],
): string[] =>
  unique(
    compoundSubgoals.flatMap((subgoal) => {
      const args = readRecord(subgoal.args) ?? readRecord(subgoal.args_hint);
      const scholarlyIntent = readRecord(args?.scholarly_intent);
      if (
        subgoal.mandatory === false ||
        scholarlyIntent?.requires_full_text !== true
      ) {
        return [];
      }
      const chain = readRecord(args?.planned_scholarly_capability_chain);
      return Array.isArray(chain?.planned_capabilities)
        ? chain.planned_capabilities.map(readString).filter(Boolean)
        : [];
    }),
  );

const COMPOUND_FORBIDDEN_RECEIPT_TERMINAL_KINDS = [
  "tool_receipt",
  "calculator_receipt",
  "docs_viewer_receipt",
  "doc_open_receipt",
  "workspace_action_receipt",
  "live_environment_tool_observation",
  "live_pipeline_receipt",
  "live_pipeline_turn_receipt",
  "live_source_pipeline_receipt",
] as const;

const compoundHasDocsSubgoal = (subgoals: RecordLike[]): boolean =>
  subgoals.some((subgoal) =>
    readString(subgoal.capability_family) === "docs_viewer" ||
    readString(subgoal.requested_capability).startsWith("docs-viewer.") ||
    readString(subgoal.runtime_capability).startsWith("docs-viewer.")
  );

const SEMANTIC_CAPABILITY_ITINERARY_FAMILIES = new Set([
  "visual_capture",
  "live_source_mail",
  "live_source_decision",
  "voice_delivery",
  "moral_graph_reflection",
  "civilization_bounds",
  "workstation",
]);

const admissionEquivalentFamiliesFor = (
  family: HelixCapabilityItineraryFamily,
): HelixCapabilityItineraryFamily[] => {
  if (family === "visual_capture") return ["situation_run"];
  if (family === "live_source_mail") return ["live_environment"];
  if (family === "live_source_decision") return ["live_environment", "workstation_action"];
  if (family === "voice_delivery") return ["live_environment", "workstation_action"];
  if (family === "moral_graph_reflection") return ["workstation_action"];
  if (family === "civilization_bounds") return ["workstation_action"];
  if (family === "workstation") return ["workstation_action", "notes"];
  return [];
};

const itineraryFamilyForContractSubgoal = (subgoal: RecordLike): HelixCapabilityItineraryFamily => {
  const capabilityFamily = readString(subgoal.capability_family);
  if (SEMANTIC_CAPABILITY_ITINERARY_FAMILIES.has(capabilityFamily)) {
    return capabilityFamily as HelixCapabilityItineraryFamily;
  }
  const admissionFamilies = Array.isArray(subgoal.admission_families)
    ? subgoal.admission_families.map(readString).filter(Boolean)
    : [];
  const preferred =
    admissionFamilies.find((family) => family !== "workstation_action" && family !== "runtime_evidence") ??
    admissionFamilies[0] ??
    capabilityFamily;
  return (preferred || capabilityFamily || "runtime_evidence") as HelixCapabilityItineraryFamily;
};

const stepForCompoundSubgoal = (input: {
  subgoal: RecordLike;
  promptText: string;
  status: HelixCapabilityItineraryStepStatus;
}): HelixCapabilityItineraryStep => {
  const requestedCapability = readString(input.subgoal.requested_capability);
  const runtimeCapability = readString(input.subgoal.runtime_capability) || requestedCapability;
  const family = itineraryFamilyForContractSubgoal(input.subgoal);
  const requiredObservationKinds = Array.isArray(input.subgoal.required_observation_kinds)
    ? input.subgoal.required_observation_kinds.map(readString).filter(Boolean)
    : observationKindsFor(family, input.promptText);
  const frontierObservationKinds = family === "theory_locator" && theoryFrontierRequested(input.promptText)
    ? observationKindsFor(family, input.promptText)
    : [];
  return {
    step_id:
      readString(input.subgoal.subgoal_id) ||
      `compound_${readString(input.subgoal.order) || "subgoal"}_${requestedCapability.replace(/[^A-Za-z0-9_-]+/g, "_")}`,
    tool_family: family,
    capability_hint: runtimeCapability || capabilityHintFor(family, input.promptText),
    requested_capability: requestedCapability || null,
    runtime_capability: runtimeCapability || null,
    compound_subgoal_id: readString(input.subgoal.subgoal_id) || null,
    args_hint:
      input.subgoal.args_hint && typeof input.subgoal.args_hint === "object" && !Array.isArray(input.subgoal.args_hint)
        ? (input.subgoal.args_hint as Record<string, unknown>)
        : {},
    depends_on_subgoal_ids: Array.isArray(input.subgoal.depends_on_subgoal_ids)
      ? input.subgoal.depends_on_subgoal_ids.map(readString).filter(Boolean)
      : [],
    input_bindings: Array.isArray(input.subgoal.input_bindings)
      ? input.subgoal.input_bindings.map(readRecord).filter((entry): entry is RecordLike => Boolean(entry))
      : [],
    produced_affordance_kinds: Array.isArray(input.subgoal.produced_affordance_kinds)
      ? input.subgoal.produced_affordance_kinds.map(readString).filter(Boolean)
      : [],
    consumed_affordance_kinds: Array.isArray(input.subgoal.consumed_affordance_kinds)
      ? input.subgoal.consumed_affordance_kinds.map(readString).filter(Boolean)
      : [],
    missing_affordance_kinds: Array.isArray(input.subgoal.missing_affordance_kinds)
      ? input.subgoal.missing_affordance_kinds.map(readString).filter(Boolean)
      : [],
    purpose: family === "theory_locator" && frontierObservationKinds.length > 0
      ? "Build non-terminal theory frontier placement evidence, exact contract status, and badge/chunk mappings before synthesis."
      : requestedCapability
      ? `Execute explicit compound capability subgoal ${requestedCapability}.`
      : "Execute the explicit compound capability subgoal.",
    execution_group: "evidence",
    required_observation_kinds: unique([...requiredObservationKinds, ...frontierObservationKinds]),
    contribution_role: readString(input.subgoal.contribution_role) || null,
    terminal_contribution_kind: readString(input.subgoal.terminal_contribution_kind) || readString(input.subgoal.required_terminal_kind) || null,
    forbidden_nearby_capabilities: Array.isArray(input.subgoal.forbidden_nearby_capabilities)
      ? input.subgoal.forbidden_nearby_capabilities.map(readString).filter(Boolean)
      : [],
    status: input.status,
    reason:
      input.status === "missing"
        ? "The explicit compound subgoal is not admitted or visible as an executable capability."
        : "The explicit compound subgoal must produce its own observation before terminal synthesis.",
  };
};

const statusForFamily = (input: {
  family: HelixCapabilityItineraryFamily;
  admittedFamilies: HelixCapabilityItineraryFamily[];
  forbiddenFamilies: string[];
  availableCapabilities?: unknown;
}): HelixCapabilityItineraryStepStatus => {
  if (input.forbiddenFamilies.includes(input.family)) return "forbidden";
  if (admissionEquivalentFamiliesFor(input.family).some((family) => input.forbiddenFamilies.includes(family))) {
    return "forbidden";
  }
  if (input.family === "theory_locator") {
    return hasAnyCapability(input.availableCapabilities, [
      THEORY_CONTEXT_REFLECTION_CAPABILITY,
      HELIX_THEORY_FRONTIER_VECTOR_FIELD_TRACE_CAPABILITY,
    ]) ? "planned" : "missing";
  }
  if (input.family === "repo_code" && hasCapability(input.availableCapabilities, "repo-code.search_concept")) {
    return "planned";
  }
  if (input.admittedFamilies.includes(input.family)) return "admitted";
  if (admissionEquivalentFamiliesFor(input.family).some((family) => input.admittedFamilies.includes(family))) {
    return "admitted";
  }
  if (
    input.family === "scholarly_research" &&
    hasAnyCapability(input.availableCapabilities, [
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ])
  ) {
    return "planned";
  }
  if (input.family === "internet_search" && hasCapability(input.availableCapabilities, HELIX_INTERNET_SEARCH_CAPABILITY)) {
    return "planned";
  }
  return "missing";
};

const reasonForStep = (family: HelixCapabilityItineraryFamily, status: HelixCapabilityItineraryStepStatus): string => {
  if (status === "forbidden") return "The route/tool-admission policy forbids this family for the current turn.";
  if (status === "missing") return "The prompt appears to require this family, but it is not admitted or visible as an available capability.";
  if (family === "theory_locator") return "The prompt asks for badge-graph placement, so the theory locator must produce non-terminal graph evidence before synthesis.";
  if (family === "docs_viewer") return "The prompt asks to search local docs, so the docs viewer must produce document evidence before synthesis.";
  if (family === "repo_code") return "The prompt asks for repo/code evidence, so current-turn repo observations must be collected before synthesis.";
  if (status === "planned") return "The capability is visible and should be selected by the agent step before observing tool output.";
  return "The family is admitted by the current tool policy and may produce evidence before terminal synthesis.";
};

const stepForFamily = (input: {
  family: HelixCapabilityItineraryFamily;
  promptText: string;
  status: HelixCapabilityItineraryStepStatus;
}): HelixCapabilityItineraryStep => ({
  step_id:
    input.family === "theory_locator"
      ? "locate_theory_context"
      : input.family === "repo_code"
        ? "collect_repo_code_evidence"
      : input.family === "scholarly_research"
        ? "collect_scholarly_evidence"
        : input.family === "internet_search"
          ? "collect_web_evidence"
          : `collect_${input.family}_evidence`,
  tool_family: input.family,
  capability_hint: capabilityHintFor(input.family, input.promptText),
  purpose:
    input.family === "theory_locator"
      ? isTheoryFrontierVectorFieldTracePrompt(input.promptText)
        ? "Trace non-terminal badge coordinate vectors, relation tensors, evidence gaps, and exact-verification requirements before synthesis."
        : theoryFrontierRequested(input.promptText)
          ? "Build non-terminal theory frontier placement evidence, exact contract status, and badge/chunk mappings before synthesis."
        : "Locate the prompt on the theory badge graph and expose scale/chunk/uncertainty evidence."
      : input.family === "repo_code"
        ? "Collect current-turn repo/code evidence requested by the prompt."
      : input.family === "scholarly_research"
        ? theoryFrontierRequested(input.promptText)
          ? "Collect paper/citation evidence for frontier mapping only; literature must not promote theory edges."
          : "Collect paper/citation evidence requested by the prompt."
        : input.family === "internet_search"
          ? "Collect live web evidence requested by the prompt."
          : "Collect the route-required observation for this family.",
  execution_group: input.family === "theory_locator" ? "locator" : "evidence",
  required_observation_kinds: observationKindsFor(input.family, input.promptText),
  status: input.status,
  reason: reasonForStep(input.family, input.status),
});

export function buildHelixCapabilityItinerary(input: {
  turnId: string;
  promptText: string;
  toolCallAdmissionDecision?: HelixToolCallAdmissionDecision | RecordLike | null;
  availableCapabilities?: unknown;
  exactAdmittedCapabilityContract?: ExplicitCapabilityContract | null;
  exactAdmittedCapabilityArgs?: RecordLike | null;
  trustedEnvironmentContext?: ExplicitCapabilityExtractionContext | null;
  requiredPolicyGrounding?: Array<{
    contract: ExplicitCapabilityContract;
    argsHint: RecordLike;
  }>;
}): HelixCapabilityItinerary {
  const admission = readRecord(input.toolCallAdmissionDecision);
  const capabilityHelpIntent = isAskTurnCapabilityHelpIntent(input.promptText);
  const capabilityHelpHasSeparateAction = /[?!.]\s*(?:then\s+)?(?:use|call|run|open|inspect|search|create|append|set|start|stop)\b/i.test(
    input.promptText,
  );
  const baseCompoundCapabilityContract =
    buildHelixCompoundCapabilityContract({
      turnId: input.turnId,
      promptText: input.promptText,
      trustedEnvironmentContext: input.trustedEnvironmentContext,
    }) ??
    (input.exactAdmittedCapabilityContract
      ? buildHelixSingleCapabilityContractFromAdmission({
          turnId: input.turnId,
          promptText: input.promptText,
          contract: input.exactAdmittedCapabilityContract,
          argsHint: input.exactAdmittedCapabilityArgs,
        })
      : null);
  const candidateCompoundCapabilityContract =
    baseCompoundCapabilityContract && input.requiredPolicyGrounding
      ? input.requiredPolicyGrounding.reduce(
          (contract, grounding) =>
            prependHelixRequiredGroundingCapability({
              turnId: input.turnId,
              promptText: input.promptText,
              compoundContract: contract,
              groundingContract: grounding.contract,
              argsHint: grounding.argsHint,
            }),
          baseCompoundCapabilityContract,
        )
      : baseCompoundCapabilityContract;
  const candidateCompoundSubgoals = Array.isArray(candidateCompoundCapabilityContract?.subgoals)
    ? candidateCompoundCapabilityContract.subgoals
    : [];
  const compoundCapabilityContract = capabilityHelpIntent && !capabilityHelpHasSeparateAction
    ? null
    : candidateCompoundCapabilityContract;
  const admittedFamilies = (Array.isArray(admission?.admitted_tool_families)
    ? admission.admitted_tool_families
    : []) as HelixCapabilityItineraryFamily[];
  const forbiddenFamilies = (Array.isArray(admission?.forbidden_tool_families)
    ? admission.forbidden_tool_families
    : []) as string[];
  const admissionSourceTarget = readString(admission?.source_target);
  const docsAdmissionSelected =
    admissionSourceTarget === "docs_viewer" ||
    admissionSourceTarget === "active_doc";
  const localAdmissionSuppressesGenericResearch =
    [
      "active_doc",
      "docs_viewer",
      "workspace_panel",
      "workspace_action",
      "workspace_diagnostic",
      "calculator_stream",
      "live_environment",
      "model_only",
    ].includes(admissionSourceTarget);
  const compoundSubgoals = Array.isArray(compoundCapabilityContract?.subgoals)
    ? compoundCapabilityContract.subgoals as unknown as RecordLike[]
    : [];
  const compoundFamilies = compoundSubgoals.map(itineraryFamilyForContractSubgoal);
  const compoundRequestsRepoCode = compoundSubgoals.some((subgoal) =>
    readString(subgoal.capability_family) === "repo_code" ||
    readString(subgoal.requested_capability).startsWith("repo-code.") ||
    readString(subgoal.runtime_capability).startsWith("repo-code.")
  );
  const researchFamilies = capabilityHelpIntent || localAdmissionSuppressesGenericResearch
    ? []
    : requestedResearchFamilies(input.promptText);
  const nonCompoundResearchFamilies = researchFamilies.filter((family) => !compoundFamilies.includes(family));
  const explicitRepoEvidenceRequested = explicitRepoEvidenceCueAllowedInCompound(input.promptText);
  const repoFamilies: HelixCapabilityItineraryFamily[] =
    capabilityHelpIntent || (docsAdmissionSelected && !compoundRequestsRepoCode && !explicitRepoEvidenceRequested)
      ? []
      : requestedRepoFamilies(input.promptText).filter((family) =>
          family !== "repo_code" ||
          compoundSubgoals.length === 0 ||
          compoundRequestsRepoCode ||
          explicitRepoEvidenceRequested
        );
  const docsFamilies: HelixCapabilityItineraryFamily[] = capabilityHelpIntent
    ? []
    : docsAdmissionSelected && admittedFamilies.includes("docs_viewer")
      ? ["docs_viewer"]
      : requestedDocsFamilies(input.promptText);
  const locatorFamilies: HelixCapabilityItineraryFamily[] =
    !capabilityHelpIntent && (theoryLocatorRequested(input.promptText) || isTheoryFrontierVectorFieldTracePrompt(input.promptText))
    ? ["theory_locator"]
    : [];
  const frontierRequested = theoryFrontierRequested(input.promptText);
  const relevantFamilies = unique([
    ...nonCompoundResearchFamilies,
    ...compoundFamilies,
    ...researchFamilies,
    ...repoFamilies,
    ...docsFamilies,
    ...locatorFamilies,
  ]);
  const compoundSteps = compoundSubgoals.map((subgoal) => {
    const family = itineraryFamilyForContractSubgoal(subgoal);
    const runtimeCapability = readString(subgoal.runtime_capability) || readString(subgoal.requested_capability);
    const status = statusForFamily({
      family,
      admittedFamilies,
      forbiddenFamilies,
      availableCapabilities: input.availableCapabilities,
    });
    const availableStatus =
      runtimeCapability && hasCapability(input.availableCapabilities, runtimeCapability)
        ? "planned"
        : status;
    return stepForCompoundSubgoal({
      subgoal,
      promptText: input.promptText,
      status: availableStatus as HelixCapabilityItineraryStepStatus,
    });
  });
  const nonCompoundFamilies = relevantFamilies.filter((family) =>
    !compoundFamilies.includes(family)
  );
  const nonCompoundSteps = nonCompoundFamilies.map((family) => {
      const status = statusForFamily({
        family,
        admittedFamilies,
        forbiddenFamilies,
        availableCapabilities: input.availableCapabilities,
      });
      return stepForFamily({ family, promptText: input.promptText, status });
    });
  const plannedSteps = relevantFamilies.flatMap((family) => {
    const matchingCompoundSteps = compoundSteps.filter((step) => step.tool_family === family);
    if (matchingCompoundSteps.length > 0) return matchingCompoundSteps;
    return nonCompoundSteps.filter((step) => step.tool_family === family);
  });
  const admittedItineraryFamilies = plannedSteps
    .filter((step) => step.status === "admitted" || step.status === "planned")
    .map((step) => step.tool_family);
  const forbiddenItineraryFamilies = plannedSteps
    .filter((step) => step.status === "forbidden")
    .map((step) => step.tool_family);
  const missingItineraryFamilies = plannedSteps
    .filter((step) => step.status === "missing")
    .map((step) => step.tool_family);
  const promptShape =
    compoundSubgoals.length > 1 || relevantFamilies.length > 1
      ? "compound_tool"
      : relevantFamilies.length === 1
        ? "single_tool"
        : "model_only";
  const typedFailures = [
    ...(researchFamilies.length > 0 ? ["research_observation_missing"] : []),
    ...(docsFamilies.length > 0 ? ["docs_viewer_observation_missing"] : []),
    ...(locatorFamilies.length > 0 ? ["locator_observation_missing"] : []),
    ...(frontierRequested ? ["theory_frontier_candidate_missing", "theory_frontier_exact_verification_missing"] : []),
    ...(frontierRequested && researchFamilies.includes("scholarly_research") ? ["theory_frontier_literature_map_missing"] : []),
    ...(promptShape === "compound_tool" ? ["compound_evidence_not_reentered"] : []),
    ...(missingItineraryFamilies.length > 0 ? ["capability_family_not_admitted_or_visible"] : []),
    ...(compoundSubgoals.length > 1 ? ["compound_subgoal_observation_missing"] : []),
  ];
  const compoundRequiredCapabilities = compoundSubgoals
    .filter((subgoal) => subgoal.mandatory !== false)
    .map((subgoal) => readString(subgoal.requested_capability))
    .filter(Boolean);
  const compoundRequiredScholarlyCapabilities =
    requiredScholarlyCapabilitiesFromCompoundSubgoals(compoundSubgoals);
  const admissionRequestsScholarlyCapability = (
    Array.isArray(admission?.compound_requested_capabilities)
      ? admission.compound_requested_capabilities
      : []
  ).some((capability) =>
    readString(capability).startsWith("scholarly-research."),
  );
  const scholarlyIntent =
    compoundFamilies.includes("scholarly_research") ||
    admissionRequestsScholarlyCapability ||
    (compoundSubgoals.length === 0 && researchFamilies.includes("scholarly_research"))
    ? detectScholarlyResearchIntent(input.promptText)
    : null;
  const requiredScholarlyCapabilities = scholarlyIntent?.scholarlyIntent.evidence_demand.required_modes.includes("full_text")
    ? scholarlyIntent.plannedScholarlyCapabilityChain.planned_capabilities
    : [];
  const forbiddenTerminalArtifactKinds = compoundSubgoals.length > 1
    ? [...COMPOUND_FORBIDDEN_RECEIPT_TERMINAL_KINDS]
    : [];
  const forbiddenTerminalArtifactKindSet = new Set<string>(forbiddenTerminalArtifactKinds);
  const compoundRequiresSynthesis = compoundSubgoals.length > 1;
  const allowedTerminalArtifactKinds = unique([
    ...(compoundRequiresSynthesis ? ["final_answer_draft"] : allowedTerminalKindsFor(relevantFamilies)),
    ...(compoundRequiresSynthesis ? [] : compoundTerminalKindsFor(compoundSubgoals)),
    ...(compoundRequiresSynthesis ? ["compound_evidence_synthesis_answer", "model_synthesized_answer"] : []),
    ...(compoundRequiresSynthesis && compoundHasDocsSubgoal(compoundSubgoals)
      ? ["doc_evidence_synthesis_answer"]
      : []),
  ]).filter((kind) => !forbiddenTerminalArtifactKindSet.has(kind));
  return {
    schema: HELIX_CAPABILITY_ITINERARY_SCHEMA,
    turn_id: input.turnId,
    planning_stage: "pre_execution",
    prompt_shape: promptShape,
    relevant_tool_families: relevantFamilies,
    admitted_tool_families: unique(admittedItineraryFamilies),
    forbidden_tool_families: unique(forbiddenItineraryFamilies),
    missing_tool_families: unique(missingItineraryFamilies),
    planned_steps: plannedSteps,
    reasoning_criteria: [
    ...(researchFamilies.length > 0
        ? [{
            criterion_id: "research_evidence_grounding",
            description: "Research claims must be grounded in current-turn research observations, not classifier or route hints.",
            required_observation_families: researchFamilies,
          }]
        : []),
      ...(repoFamilies.length > 0
        ? [{
            criterion_id: "repo_code_evidence_grounding",
            description: "Repo/code claims must be grounded in current-turn repo observations, not route or classifier hints.",
            required_observation_families: repoFamilies,
          }]
        : []),
      ...(docsFamilies.length > 0
        ? [{
            criterion_id: "docs_viewer_evidence_grounding",
            description: "Document path claims must be grounded in current-turn docs viewer observations, not route or classifier hints.",
            required_observation_families: docsFamilies,
          }]
        : []),
      ...(locatorFamilies.length > 0
        ? [{
            criterion_id: frontierRequested ? "theory_frontier_candidate_grounding" : "badge_graph_location_grounding",
            description: frontierRequested
              ? "Frontier exploration must be grounded in non-terminal frontier candidates, exact contract status, and badge/chunk evidence before synthesis."
              : "Graph placement must be grounded in a theory context reflection receipt before synthesis.",
            required_observation_families: locatorFamilies,
          }]
        : []),
      ...(frontierRequested && researchFamilies.includes("scholarly_research")
        ? [{
            criterion_id: "frontier_literature_mapping_boundary",
            description: "Scholarly evidence may support, conflict, identify missing evidence, suggest a missing badge, or remain unrelated; it must not promote theory edges.",
            required_observation_families: ["scholarly_research", "theory_locator"] as HelixCapabilityItineraryFamily[],
          }]
        : []),
      ...(promptShape === "compound_tool"
        ? [{
            criterion_id: "compound_reentry_before_terminal",
            description: "Every required observation family must re-enter the solver before a terminal answer is eligible.",
            required_observation_families: relevantFamilies,
          }]
        : []),
    ],
    terminal_success_criteria: {
      required_observation_families: relevantFamilies,
      required_capabilities: unique([
        ...compoundRequiredCapabilities,
        ...compoundRequiredScholarlyCapabilities,
        ...requiredScholarlyCapabilities,
      ]),
      allowed_terminal_artifact_kinds: allowedTerminalArtifactKinds,
      forbidden_terminal_artifact_kinds: forbiddenTerminalArtifactKinds,
      ...(compoundSubgoals.length > 1
        ? { compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations" }
        : {}),
      requires_post_observation_synthesis: relevantFamilies.length > 0,
      typed_failure_codes: unique(typedFailures),
    },
    ...(compoundCapabilityContract ? { compound_capability_contract: compoundCapabilityContract as unknown as Record<string, unknown> } : {}),
    authority: "planning_only",
    not_terminal: true,
    assistant_answer: false,
    raw_content_included: false,
  };
}
