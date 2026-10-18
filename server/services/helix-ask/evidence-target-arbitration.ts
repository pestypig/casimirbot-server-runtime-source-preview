import type {
  HelixAskEvidenceTargetArbitration,
  HelixAskEvidenceTargetCandidate,
} from "@shared/helix-ask-evidence-target-arbitration";
import { HELIX_ASK_EVIDENCE_TARGET_ARBITRATION_SCHEMA } from "@shared/helix-ask-evidence-target-arbitration";
import { HELIX_INTERNET_SEARCH_CAPABILITY } from "@shared/helix-internet-search-observation";
import type {
  HelixAskSourceTarget,
  HelixAskSourceTargetRequestedOutput,
  HelixAskSourceTargetStrength,
} from "@shared/helix-ask-source-target-intent";
import type { LiveSourceWakeRouteMetadataV1 } from "@shared/contracts/stage-play-live-source-mail.v1";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import {
  detectInternetSearchIntent,
  hasAffirmativeDocsViewerSearchCue,
  hasExplicitFreshDocsAccessCue,
  hasRetainedEvidenceContinuationCue,
} from "./internet-search-intent";
import { detectRepoCodeEvidenceIntent } from "./repo-code-intent-detector";
import {
  detectScholarlyResearchIntent,
  extractScholarlyArxivId,
  extractScholarlyDoi,
} from "./scholarly-research-intent";
import { isAskTurnCapabilityHelpIntent } from "./capability-catalog-intent";
import {
  isStagePlayCheckpointRequestPrompt,
  isStagePlayJobPlanningPrompt,
  isStagePlayReflectionPrompt,
} from "./stage-play-prompt-intent";
import {
  isLiveSourceCadenceControlPrompt,
  isLiveSourceMailLoopReflectionPrompt,
  isLiveSourceMailLoopPrompt,
} from "./live-source-continuation-intent";
import {
  isExplicitDocsPathComparePrompt,
  isExplicitDocsPathDocumentOperation,
  isExplicitDocsPathLocateSynthesisPrompt,
  isExplicitDocsPathSummaryPrompt,
} from "./docs-viewer-intent";
import { isAskTurnDocsTopicSummaryPrompt } from "./doc-args";
import { decideMoralGraphAgentInvocationPolicyV1 } from "@shared/moral-graph/moral-graph-agent-invocation-policy";

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const readRouteMetadataSourceTarget = (
  routeMetadata?: LiveSourceWakeRouteMetadataV1 | null,
): string | null => {
  if (!routeMetadata || typeof routeMetadata !== "object") return null;
  const sourceTarget = routeMetadata.sourceTarget;
  if (sourceTarget === "live_source_mailbox") return sourceTarget;
  const metadataRecord = routeMetadata as unknown as Record<string, unknown>;
  const snakeSourceTarget = metadataRecord.source_target;
  return snakeSourceTarget === "live_source_mailbox" ? snakeSourceTarget : null;
};

const clampScore = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const confidenceForScore = (score: number): "high" | "medium" | "low" =>
  score >= 0.86 ? "high" : score >= 0.58 ? "medium" : "low";

const hasStagePlayLexicalCue = (prompt: string): boolean =>
  /\b(?:stage\s*play|stage_play|badge\s+graph|stage\s*builder|answer\s+snapshot|checkpoint\s+(?:freshness|request|queue)|live\s+interpretation|reflect_stage_play_context|narrative_stage_play)\b/i.test(
    prompt,
  );

const hasStagePlayOperationalCue = (prompt: string): boolean =>
  /\blive_env\.reflect_stage_play_context\b/i.test(prompt) ||
  /\b(?:use|reflect|project|update|route|consume|request|queue|run|start|plan|setup|set\s+up|configure)\b[\s\S]{0,120}\b(?:stage\s*play|stage_play|badge\s+graph|live\s+interpretation|answer\s+snapshot|checkpoint)\b/i.test(prompt) ||
  /\b(?:stage\s*play|stage_play|badge\s+graph|live\s+interpretation|answer\s+snapshot|checkpoint)\b[\s\S]{0,120}\b(?:reflect|project|update|active|current|latest|source|visual|checkpoint|freshness|request|queue|run|plan|setup|set\s+up)\b/i.test(prompt) ||
  /\b(?:active|current|latest)\s+stage\s*play\s+(?:graph|context|source|reflection)\b/i.test(prompt) ||
  /\bcheckpoint\s+(?:focus|handle|request|queue|freshness)\b/i.test(prompt);

const hasStagePlayNegativeCue = (prompt: string): boolean =>
  /\b(?:do\s+not|don't|dont|without|no)\b[\s\S]{0,80}\b(?:stage\s*play|stage_play|badge\s+graph|reflect_stage_play_context)\b/i.test(prompt) ||
  /\b(?:stage\s*play|stage_play|badge\s+graph|reflect_stage_play_context)\b[\s\S]{0,80}\b(?:do\s+not|don't|dont|without|no)\b/i.test(prompt);

const hasLiveSourceCurrentStateCue = (prompt: string): boolean =>
  /\b(?:what\s+do\s+you\s+know\s+right\s+now|what\s+is\s+the\s+current\s+(?:live\s+source|source|mailbox|watch|observation)\s+state|current\s+live\s+source\s+state|summari[sz]e\s+(?:the\s+)?(?:current\s+)?live\s+source\s+state|source\s+quality|live\s+source\s+quality|is\s+(?:the\s+)?(?:source|visual\s+source|mailbox)\s+(?:fresh|stale|degraded|under\s+pressure)|how\s+fresh\s+is\s+(?:the\s+)?(?:source|visual\s+source)|cadence|backlog|under\s+pressure)\b/i.test(prompt) &&
  /\b(?:live\s+source|visual\s+source|mailbox|mail|summary|summaries|observation|source|watch|quality|fresh|stale|cadence|backlog|pressure)\b/i.test(prompt);

const hasMoralGraphReflectionCue = (prompt: string): boolean => {
  const policy = decideMoralGraphAgentInvocationPolicyV1({
    inputKind: "user_prompt",
    text: prompt,
  });
  if (policy.eligible) return true;
  if (!/\b(?:moral\s*(?:badge\s*)?graph|moralgraph|zenbridge|fruition|procedural\s+moral|moral\s+classifier|inner[-\s]?practice|moral\s+reflection)\b/i.test(prompt)) {
    return false;
  }
  return /\b(?:use|reflect|classify|compare|evaluate|plot|map|apply|through|with|using|proper\s+reflection|what\s+kind\s+of\s+output|procedural\s+next\s+moves?)\b/i.test(prompt);
};

const hasTheoryIdeologyBridgeCue = (prompt: string): boolean => {
  const hasTheoryCue =
    /\b(?:theory\s+(?:badge\s*)?graph|physics\s+(?:badge\s*)?graph|observable\s+physics|mathematics|entropy|conservation|self[-\s]?organization|chemistry|first\s+principles|boundary\s+conditions?|feedback\s+loops?|symmetry|invariance)\b/i.test(prompt);
  const hasMoralCue =
    /\b(?:moral\s*(?:badge\s*)?graph|moralgraph|zenbridge|fruition|justice|fairness|due\s+process|morality|moral|ethos|procedural\s+justice|personalization|priorit(?:y|ies)|non[-\s]?harm|right\s+speech)\b/i.test(prompt);
  return hasTheoryCue && hasMoralCue;
};

const hasNegatedExternalResearchCommand = (prompt: string): boolean =>
  /\b(?:not\s+asking|do\s+not|don't|dont|without|no)\b[\s\S]{0,100}\b(?:search|find|look\s+up|retrieve|browse|cite|fetch|pull|external\s+sources?|citations?|sources?)\b/i.test(prompt);

const hasExplicitExternalResearchCommand = (prompt: string): boolean =>
  !hasNegatedExternalResearchCommand(prompt) &&
  (
    /\b(?:search|find|look\s+up|retrieve|browse|cite|fetch|pull)\b[\s\S]{0,100}\b(?:papers?|stud(?:y|ies)|scholarly|academic|citations?|sources?|research|pdf|doi|arxiv|web|internet)\b/i.test(prompt) ||
    /\b(?:give|include|provide)\b[\s\S]{0,80}\b(?:citations?|sources?|links|papers?|studies)\b/i.test(prompt) ||
    /\b(?:with|using)\s+(?:citations?|sources?|scholarly\s+sources|external\s+sources)\b/i.test(prompt)
  );

const hasExplicitExternalScholarlyComparisonTarget = (prompt: string): boolean =>
  !hasNegatedExternalResearchCommand(prompt) &&
  !/\b(?:do\s+not|don['’]?t|later|eventually|in\s+the\s+future|not\s+now|previously|earlier|historically|the\s+screen\s+says|quoted?|if|unless|when)\b[\s\S]{0,180}\b(?:compare|contrast|reconcile|relate|against|reality\s+check)\b/i.test(
    prompt,
  ) &&
  Boolean(extractScholarlyArxivId(prompt) || extractScholarlyDoi(prompt)) &&
  /\b(?:compare|contrast|reconcile|relate|against|reality\s+check)\b/i.test(prompt);

const hasExplicitLocalDocsPathSummary = (prompt: string): boolean =>
  isExplicitDocsPathSummaryPrompt(prompt);

const hasAffirmativeLocalDocumentEvidenceRequest = (prompt: string): boolean => {
  if (isExplicitDocsPathDocumentOperation(prompt) || isExplicitDocsPathComparePrompt(prompt) || isExplicitDocsPathLocateSynthesisPrompt(prompt)) {
    return true;
  }
  if (
    hasRetainedEvidenceContinuationCue(prompt) &&
    !hasExplicitFreshDocsAccessCue(prompt)
  ) return false;
  const documentCue = /\b(?:white\s*paper|whitepaper|paper|document|doc|docs|report|memo)\b/i.test(prompt);
  if (!documentCue) return false;
  const evidenceCue =
    /\b(?:check|use|from|in|inside|look\s+in|look\s+at|consult|according\s+to|where|find|locate|reported|stated|specified|listed|table|row|source|cite|citation|evidence|white\s*paper)\b/i.test(prompt);
  const valueCue =
    /\b(?:load[-\s]?bearing|lbs?|pounds?|numeric|value|capacity|spec(?:ification)?s?|engineering|parameter|measurement|reported|stated)\b/i.test(prompt);
  return evidenceCue && (valueCue || /\b(?:NHM[-\s]?2|casimir|tile)\b/i.test(prompt));
};

const makeCandidate = (input: {
  candidateId: string;
  targetSource: HelixAskSourceTarget;
  targetKind?: HelixAskSourceTarget;
  strength: HelixAskSourceTargetStrength;
  score: number;
  reasonCodes: string[];
  requestedOutputs?: HelixAskSourceTargetRequestedOutput[];
  capabilityKeys?: string[];
  terminalProductConstraints?: string[];
  disallowed?: boolean;
  disallowedReason?: string | null;
}): HelixAskEvidenceTargetCandidate => {
  const score = clampScore(input.score);
  return {
    candidate_id: input.candidateId,
    target_source: input.targetSource,
    target_kind: input.targetKind ?? input.targetSource,
    strength: input.strength,
    score,
    confidence: confidenceForScore(score),
    reason_codes: unique(input.reasonCodes.filter(Boolean)),
    requested_outputs: unique(input.requestedOutputs ?? []),
    capability_keys: unique(input.capabilityKeys ?? []),
    terminal_product_constraints: unique(input.terminalProductConstraints ?? []),
    disallowed: input.disallowed === true,
    disallowed_reason: input.disallowedReason ?? null,
  };
};

const repoRequestedOutputs = (
  values: ReturnType<typeof detectRepoCodeEvidenceIntent>["requestedOutputs"],
): HelixAskSourceTargetRequestedOutput[] =>
  unique(values.flatMap((value) => {
    if (value === "file_path") return ["file_path" as const];
    if (value === "line_backed_source") return ["line_backed_source" as const];
    if (value === "implementation_location") return ["implementation_location" as const];
    if (value === "route_trace") return ["route_trace" as const];
    if (value === "tool_call_eligibility") return ["tool_call_eligibility" as const];
    if (value === "terminal_contract") return ["terminal_contract" as const];
    if (value === "codex_comparison") return ["codex_comparison" as const];
    return ["repo_code" as const];
  }));

export function buildAskEvidenceTargetArbitration(input: {
  turnId: string;
  threadId: string;
  promptText: string;
  routeMetadata?: LiveSourceWakeRouteMetadataV1 | null;
}): HelixAskEvidenceTargetArbitration {
  const prompt = input.promptText.trim();
  if (
    readRouteMetadataSourceTarget(input.routeMetadata) === "live_source_mailbox" &&
    !isExplicitDocsPathDocumentOperation(prompt)
  ) {
    const candidate = makeCandidate({
      candidateId: "live_source_mailbox.stage_play_mail_wake_route_metadata",
      targetSource: "live_source_mailbox",
      targetKind: "live_source_mailbox",
      strength: "hard",
      score: 1,
      reasonCodes: ["route_metadata_stage_play_mail_wake", "live_source_mailbox_route_metadata_authoritative"],
      requestedOutputs: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_read_result",
        "stage_play_live_source_mail_decision",
        "stage_play_live_source_narrative_state",
        "typed_failure",
      ],
      capabilityKeys: input.routeMetadata.allowedCapabilities?.length
        ? input.routeMetadata.allowedCapabilities
        : [
            "live_env.read_processed_live_source_mail",
            "live_env.process_live_source_mail",
            "live_env.read_live_source_mail",
            "live_env.record_live_source_mail_decision",
            "live_env.request_interim_voice_callout",
          ],
      terminalProductConstraints: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_read_result",
        "stage_play_live_source_mail_decision",
        "stage_play_live_source_narrative_state",
        "model_synthesized_answer",
        "typed_failure",
      ],
    });
    return {
      schema: HELIX_ASK_EVIDENCE_TARGET_ARBITRATION_SCHEMA,
      turn_id: input.turnId,
      thread_id: input.threadId,
      prompt_intent_candidates: ["stage_play_mail_wake_route_metadata"],
      evidence_target_candidates: [candidate],
      source_targets: ["live_source_mailbox"],
      available_capabilities: candidate.capability_keys,
      disallowed_capabilities: unique(input.routeMetadata.forbiddenCapabilities ?? []),
      selected_candidate_id: candidate.candidate_id,
      selected_target_source: "live_source_mailbox",
      selected_target_kind: "live_source_mailbox",
      confidence: "high",
      reason_codes: candidate.reason_codes,
      reason: "route_metadata_stage_play_mail_wake",
      locked: true,
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
      terminal_product_constraints: candidate.terminal_product_constraints,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "admission_control",
    };
  }
  if (isAskTurnCapabilityHelpIntent(prompt)) {
    const candidate = makeCandidate({
      candidateId: "runtime_evidence.capability_catalog_help",
      targetSource: "runtime_evidence",
      targetKind: "runtime_evidence",
      strength: "hard",
      score: 1,
      reasonCodes: ["capability_help_catalog_request", "capability_catalog_precedence"],
      requestedOutputs: ["tool_call_eligibility", "terminal_contract"],
      capabilityKeys: ["helix_ask.inspect_capability_catalog"],
      terminalProductConstraints: ["capability_help_summary", "typed_failure"],
    });
    return {
      schema: HELIX_ASK_EVIDENCE_TARGET_ARBITRATION_SCHEMA,
      turn_id: input.turnId,
      thread_id: input.threadId,
      prompt_intent_candidates: ["capability_help"],
      evidence_target_candidates: [candidate],
      source_targets: ["runtime_evidence"],
      available_capabilities: candidate.capability_keys,
      disallowed_capabilities: [],
      selected_candidate_id: candidate.candidate_id,
      selected_target_source: candidate.target_source,
      selected_target_kind: candidate.target_kind,
      confidence: "high",
      reason_codes: candidate.reason_codes,
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
      terminal_product_constraints: candidate.terminal_product_constraints,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "admission_control",
    };
  }
  const candidates: HelixAskEvidenceTargetCandidate[] = [];
  const promptIntentCandidates: string[] = [];
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  const suppressesScholarlyResearch = contextualToolSuppressionBlocksFamily(contextualSuppression, "scholarly_research");
  const suppressesInternetSearch = contextualToolSuppressionBlocksFamily(contextualSuppression, "internet_search");
  const affirmativeDocsSearch = hasAffirmativeDocsViewerSearchCue(prompt);
  const scholarlyIntent = detectScholarlyResearchIntent(prompt);
  const explicitExternalResearchCommand =
    hasExplicitExternalResearchCommand(prompt) ||
    hasExplicitExternalScholarlyComparisonTarget(prompt);
  const compoundDocsScholarlyComparison =
    scholarlyIntent.researchRequested &&
    explicitExternalResearchCommand &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer") &&
    !suppressesScholarlyResearch &&
    (
      affirmativeDocsSearch ||
      isAskTurnDocsTopicSummaryPrompt(prompt) ||
      hasAffirmativeLocalDocumentEvidenceRequest(prompt)
    ) &&
    /\b(?:compare|contrast|reconcile|relate|against|reality\s+check|what\s+(?:does|would)\s+(?:it|that|this)\s+(?:mean|imply))\b/i.test(prompt);

  if (compoundDocsScholarlyComparison) {
    promptIntentCandidates.push("compound_local_docs_scholarly_comparison");
    candidates.push(makeCandidate({
      candidateId: "scholarly_research.local_docs_comparison",
      targetSource: "scholarly_research",
      targetKind: "scholarly_research",
      strength: "hard",
      score: 0.995,
      reasonCodes: [
        "compound_local_docs_external_scholarly_comparison",
        "docs_and_scholarly_capabilities_must_remain_available",
        "model_synthesis_requires_both_observation_families",
      ],
      requestedOutputs: unique([
        ...scholarlyIntent.requestedOutputs,
        "file_path",
        "line_backed_source",
        "scholarly_full_text",
        "paper_pdf_pages",
        "typed_failure",
      ]),
      capabilityKeys: [
        "docs.search",
        "docs-viewer.search_docs",
        "docs-viewer.locate_in_doc",
        "scholarly_research.lookup",
        "scholarly_research.fetch_full_text",
      ],
      terminalProductConstraints: [
        "doc_evidence_synthesis_answer",
        "scholarly_research_answer",
        "model_synthesized_answer",
        "typed_failure",
        "request_user_input",
      ],
    }));
  }

  if (
    affirmativeDocsSearch &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer")
  ) {
    promptIntentCandidates.push("docs_search");
    candidates.push(makeCandidate({
      candidateId: "docs_viewer.affirmative_document_search",
      targetSource: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      score: 0.97,
      reasonCodes: [
        "explicit_docs_search_source_target",
        "local_docs_scope_suppresses_freshness_search",
      ],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      capabilityKeys: ["docs.search"],
      terminalProductConstraints: [
        "doc_location_result",
        "model_synthesized_answer",
        "typed_failure",
      ],
    }));
  }
  const suppressesWorkstationAction = contextualToolSuppressionBlocksFamily(contextualSuppression, "workstation_action");
  const suppressesRepoCode = contextualToolSuppressionBlocksFamily(contextualSuppression, "repo_code");
  const suppressesLiveEnvironment = contextualToolSuppressionBlocksFamily(contextualSuppression, "live_environment");
  const repoIntent = detectRepoCodeEvidenceIntent(prompt);
  const internetSearchIntent = detectInternetSearchIntent(prompt);
  const moralGraphPolicy = decideMoralGraphAgentInvocationPolicyV1({
    inputKind: "user_prompt",
    text: prompt,
  });
  const moralGraphReflectionCue = hasMoralGraphReflectionCue(prompt);
  const moralLivingSubstrateCue =
    moralGraphPolicy.eligible && moralGraphPolicy.reasonCodes.includes("living_substrate_reflection_request");
  const theoryIdeologyBridgeCue = hasTheoryIdeologyBridgeCue(prompt);
  const selectedTheoryIdeologyBridgeCue = theoryIdeologyBridgeCue && !moralLivingSubstrateCue;
  const contextualScholarlyMentionOnly =
    scholarlyIntent.researchRequested &&
    moralGraphReflectionCue &&
    !explicitExternalResearchCommand;
  const stagePlayNegative = hasStagePlayNegativeCue(prompt);
  const stagePlayLexical = hasStagePlayLexicalCue(prompt);
  const stagePlayOperational =
    !stagePlayNegative &&
    (
      isStagePlayCheckpointRequestPrompt(prompt) ||
      isStagePlayJobPlanningPrompt(prompt) ||
      (isStagePlayReflectionPrompt(prompt) && hasStagePlayOperationalCue(prompt))
    );
  const mailLoopReflection = isLiveSourceMailLoopReflectionPrompt(prompt);

  if (isExplicitDocsPathComparePrompt(prompt)) {
    promptIntentCandidates.push("local_docs_path_compare");
    candidates.push(makeCandidate({
      candidateId: "docs_viewer.local_docs_path_compare",
      targetSource: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      score: 0.99,
      reasonCodes: ["explicit_local_docs_path_compare", "docs_path_operation_suppresses_repo_code"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      capabilityKeys: ["docs-viewer.open_doc_by_path", "docs-viewer.summarize_doc"],
      terminalProductConstraints: ["doc_evidence_synthesis_answer", "doc_evidence_synthesis", "typed_failure", "request_user_input"],
    }));
  }
  if (isExplicitDocsPathLocateSynthesisPrompt(prompt)) {
    promptIntentCandidates.push("local_docs_path_locate_synthesis");
    candidates.push(makeCandidate({
      candidateId: "docs_viewer.local_docs_path_locate_synthesis",
      targetSource: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      score: 0.99,
      reasonCodes: ["explicit_local_docs_path_locate_synthesis", "docs_path_operation_suppresses_repo_code"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      capabilityKeys: ["docs-viewer.open_doc_by_path", "docs-viewer.locate_in_doc"],
      terminalProductConstraints: ["doc_location_result", "doc_evidence_synthesis_answer", "doc_evidence_synthesis", "typed_failure", "request_user_input"],
    }));
  }
  if (hasExplicitLocalDocsPathSummary(prompt)) {
    promptIntentCandidates.push("local_docs_path_summary");
    candidates.push(makeCandidate({
      candidateId: "docs_viewer.local_docs_path_summary",
      targetSource: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      score: 0.98,
      reasonCodes: ["explicit_local_docs_path_summary", "local_docs_path_suppresses_freshness_search"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      capabilityKeys: ["docs-viewer.summarize_doc"],
      terminalProductConstraints: ["doc_summary", "typed_failure", "request_user_input"],
    }));
  }
  if (isAskTurnDocsTopicSummaryPrompt(prompt)) {
    promptIntentCandidates.push("local_docs_topic_summary");
    candidates.push(makeCandidate({
      candidateId: "docs_viewer.local_docs_topic_summary",
      targetSource: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      score: 0.94,
      reasonCodes: ["local_docs_topic_summary", "local_docs_scope_suppresses_freshness_search"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      capabilityKeys: ["docs-viewer.search_docs", "docs-viewer.summarize_doc"],
      terminalProductConstraints: ["doc_summary", "typed_failure", "request_user_input"],
    }));
  }

  if (!contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer") && hasAffirmativeLocalDocumentEvidenceRequest(prompt)) {
    promptIntentCandidates.push("local_document_evidence");
    candidates.push(makeCandidate({
      candidateId: "docs_viewer.local_document_evidence",
      targetSource: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      score: 0.95,
      reasonCodes: [
        "explicit_local_document_evidence_request",
        "whitepaper_or_document_source_requested",
        "local_docs_scope_suppresses_repo_code",
      ],
      requestedOutputs: ["file_path", "line_backed_source", "paper_pdf_pages", "typed_failure"],
      capabilityKeys: ["docs-viewer.search_docs", "docs-viewer.locate_in_doc"],
      terminalProductConstraints: ["doc_evidence_synthesis_answer", "doc_location_result", "typed_failure", "request_user_input"],
    }));
  }

  if (contextualSuppression) {
    promptIntentCandidates.push("contextual_tool_reference");
    candidates.push(makeCandidate({
      candidateId: "model_only.contextual_tool_reference",
      targetSource: "model_only",
      targetKind: "general_background",
      strength: "soft",
      score: 0.86,
      reasonCodes: ["contextual_tool_reference_suppressed", contextualSuppression.suppression_reason],
      terminalProductConstraints: ["direct_answer_text"],
    }));
  }
  if (stagePlayNegative) {
    promptIntentCandidates.push("negative_stage_play_scope");
    candidates.push(makeCandidate({
      candidateId: "model_only.negative_stage_play_scope",
      targetSource: "model_only",
      targetKind: "general_background",
      strength: "soft",
      score: 0.72,
      reasonCodes: ["negative_stage_play_scope", "stage_play_tools_disallowed"],
      terminalProductConstraints: ["direct_answer_text"],
    }));
  }
  if (stagePlayLexical && !stagePlayOperational && !stagePlayNegative) {
    candidates.push(makeCandidate({
      candidateId: "model_only.stage_play_lexical_concept",
      targetSource: "model_only",
      targetKind: "general_background",
      strength: "soft",
      score: repoIntent.repoEvidenceRequested ? 0.38 : 0.56,
      reasonCodes: ["stage_play_lexical_candidate_only", "no_stage_play_operation_admitted"],
      terminalProductConstraints: ["direct_answer_text"],
    }));
  }

  if (!suppressesRepoCode && repoIntent.repoEvidenceRequested) {
    promptIntentCandidates.push("repo_code_evidence");
    candidates.push(makeCandidate({
      candidateId: "repo_code.project_concept_or_code_evidence",
      targetSource: "repo_code",
      targetKind: "repo_code",
      strength: repoIntent.strength,
      score: repoIntent.strength === "hard" ? 0.96 : stagePlayLexical ? 0.91 : 0.84,
      reasonCodes: repoIntent.reasons,
      requestedOutputs: repoRequestedOutputs(repoIntent.requestedOutputs),
      capabilityKeys: ["repo-code.search_concept"],
      terminalProductConstraints: ["repo_code_evidence_observation", "repo_code_evidence_answer"],
    }));
  }

  if (!suppressesWorkstationAction && moralGraphReflectionCue) {
    promptIntentCandidates.push(selectedTheoryIdeologyBridgeCue ? "theory_ideology_bridge_reflection" : "moral_graph_reflection");
    candidates.push(makeCandidate({
      candidateId: selectedTheoryIdeologyBridgeCue
        ? "workstation_panel.theory_ideology_bridge_reflection"
        : "workstation_panel.moral_graph_reflection",
      targetSource: "workstation_panel",
      targetKind: "workstation_panel",
      strength: explicitExternalResearchCommand ? "soft" : "hard",
      score: explicitExternalResearchCommand
        ? (selectedTheoryIdeologyBridgeCue ? 0.82 : 0.78)
        : (selectedTheoryIdeologyBridgeCue ? 0.94 : 0.93),
      reasonCodes: unique([
        selectedTheoryIdeologyBridgeCue
          ? "theory_ideology_bridge_explicit_cue"
          : "moral_graph_reflection_explicit_cue",
        "workstation_tool_plan_capability_candidate",
        "receipt_must_reenter_model_solver",
        contextualScholarlyMentionOnly ? "quoted_or_inline_research_terms_are_contextual" : "",
      ]),
      requestedOutputs: selectedTheoryIdeologyBridgeCue
        ? [
            "ideology_context_reflection",
            "theory_ideology_bridge",
            "workstation_tool_evaluation",
            "typed_failure",
          ]
        : moralLivingSubstrateCue
          ? [
              "ideology_context_reflection",
              "moral_badge_locator",
              "moral_living_substrate_reflection",
              "workstation_tool_evaluation",
              "typed_failure",
            ]
        : [
            "ideology_context_reflection",
            "moral_badge_locator",
            "fruition_procedure_expression",
            "procedural_moral_classification",
            "workstation_tool_evaluation",
            "typed_failure",
          ],
      capabilityKeys: selectedTheoryIdeologyBridgeCue
        ? [
            "helix_ask.reflect_theory_context",
            "helix_ask.reflect_ideology_context",
            "helix_ask.bridge_theory_ideology_context",
          ]
        : moralLivingSubstrateCue
          ? ["moral-graph.reflect_living_substrate_context"]
        : ["helix_ask.reflect_ideology_context"],
      terminalProductConstraints: [
        "workstation_tool_evaluation",
        "model_synthesized_answer",
        "typed_failure",
      ],
    }));
  }

  if (!suppressesScholarlyResearch && scholarlyIntent.researchRequested) {
    promptIntentCandidates.push("scholarly_research");
    candidates.push(makeCandidate({
      candidateId: "scholarly_research.external_sources",
      targetSource: "scholarly_research",
      targetKind: "scholarly_research",
      strength: contextualScholarlyMentionOnly
        ? "soft"
        : explicitExternalResearchCommand
          ? "hard"
          : scholarlyIntent.strength,
      score: contextualScholarlyMentionOnly
        ? 0.52
        : explicitExternalResearchCommand
          ? 0.95
          : scholarlyIntent.strength === "hard"
          ? 0.94
          : 0.76,
      reasonCodes: contextualScholarlyMentionOnly
        ? unique([
            ...scholarlyIntent.reasons,
            "contextual_research_mention_only",
            "no_external_research_operator_command",
            "available_as_contrast_evidence_not_primary_target",
          ])
        : scholarlyIntent.reasons,
      requestedOutputs: scholarlyIntent.requestedOutputs,
      capabilityKeys: scholarlyIntent.fullTextRequested
        ? ["scholarly_research.lookup", "scholarly_research.fetch_full_text"]
        : ["scholarly_research.lookup"],
      terminalProductConstraints: scholarlyIntent.fullTextRequested
        ? ["scholarly_research_observation", "scholarly_full_text_observation", "scholarly_research_answer"]
        : ["scholarly_research_observation", "scholarly_research_answer"],
    }));
  }

  if (!suppressesInternetSearch && internetSearchIntent.searchRequested) {
    promptIntentCandidates.push("internet_search");
    candidates.push(makeCandidate({
      candidateId: "internet_search.external_web_sources",
      targetSource: "internet_search",
      targetKind: "internet_search",
      strength: internetSearchIntent.strength,
      score: internetSearchIntent.strength === "hard" ? 0.92 : 0.72,
      reasonCodes: internetSearchIntent.reasons,
      requestedOutputs: internetSearchIntent.requestedOutputs,
      capabilityKeys: [HELIX_INTERNET_SEARCH_CAPABILITY],
      terminalProductConstraints: ["internet_search_observation", "internet_search_answer"],
    }));
  }

  if (stagePlayLexical || stagePlayOperational || stagePlayNegative) {
    promptIntentCandidates.push(stagePlayOperational ? "stage_play_operation" : "stage_play_lexical");
    candidates.push(makeCandidate({
      candidateId: stagePlayOperational
        ? "live_environment.stage_play_operation"
        : "live_environment.stage_play_lexical_candidate",
      targetSource: "live_environment",
      targetKind: "live_environment",
      strength: stagePlayOperational ? "hard" : "soft",
      score: stagePlayOperational ? 0.97 : 0.43,
      reasonCodes: stagePlayOperational
        ? ["stage_play_operational_cue", "requires_live_environment_tool_observation"]
        : stagePlayNegative
          ? ["stage_play_negative_scope", "stage_play_candidate_suppressed"]
          : ["stage_play_lexical_candidate_only"],
      requestedOutputs: stagePlayOperational
        ? ["stage_play_badge_graph", "stage_play_output_lane_projection", "stage_play_live_answer_projection", "typed_failure"]
        : ["stage_play_badge_graph", "typed_failure"],
      capabilityKeys: ["live_env.reflect_stage_play_context"],
      terminalProductConstraints: ["live_environment_tool_observation", "model_synthesized_answer", "typed_failure"],
      disallowed: stagePlayNegative,
      disallowedReason: stagePlayNegative ? "negative_stage_play_scope" : null,
    }));
  }

  if (!suppressesLiveEnvironment && mailLoopReflection && !isLiveSourceCadenceControlPrompt(prompt)) {
    promptIntentCandidates.push("live_source_mailbox_reflection");
    candidates.push(makeCandidate({
      candidateId: "live_source_mailbox.mail_loop_reflection",
      targetSource: "live_source_mailbox",
      targetKind: "live_source_mailbox",
      strength: "hard",
      score: 0.99,
      reasonCodes: [
        "live_source_mail_loop_reflection_intent",
        stagePlayLexical ? "stage_play_mail_loop_combined_causality" : "mailbox_causality_reflection",
        "requires_live_source_mailbox_tool_observation",
      ],
      requestedOutputs: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_loop_reflection",
        "stage_play_processed_mail_packet",
        "stage_play_badge_graph",
        "typed_failure",
      ],
      capabilityKeys: [
        "live_env.reflect_live_source_mail_loop",
        "live_env.read_processed_live_source_mail",
        "live_env.reflect_stage_play_context",
        "live_env.summarize_live_source_current_state",
        "live_env.query_live_source_loop_health",
      ],
      terminalProductConstraints: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_loop_reflection",
        "stage_play_processed_mail_packet",
        "stage_play_badge_graph",
        "model_synthesized_answer",
        "typed_failure",
      ],
    }));
  }

  if (!suppressesLiveEnvironment && !stagePlayOperational && !mailLoopReflection && isLiveSourceMailLoopPrompt(prompt) && !isLiveSourceCadenceControlPrompt(prompt)) {
    promptIntentCandidates.push("live_source_mailbox");
    candidates.push(makeCandidate({
      candidateId: "live_source_mailbox.mail_loop",
      targetSource: "live_source_mailbox",
      targetKind: "live_source_mailbox",
      strength: "hard",
      score: 0.98,
      reasonCodes: ["live_source_mail_loop_intent", "requires_live_source_mailbox_tool_observation"],
      requestedOutputs: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_read_result",
        "stage_play_live_source_mail_decision",
        "stage_play_live_source_narrative_state",
        "typed_failure",
      ],
      capabilityKeys: [
        "live_env.read_processed_live_source_mail",
        "live_env.reflect_live_source_mail_loop",
        "live_env.process_live_source_mail",
        "live_env.read_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ],
      terminalProductConstraints: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_read_result",
        "stage_play_live_source_mail_decision",
        "stage_play_live_source_narrative_state",
        "model_synthesized_answer",
        "typed_failure",
      ],
    }));
  }

  if (!suppressesLiveEnvironment && !stagePlayOperational && hasLiveSourceCurrentStateCue(prompt) && !isLiveSourceCadenceControlPrompt(prompt)) {
    promptIntentCandidates.push("live_source_current_state");
    candidates.push(makeCandidate({
      candidateId: "live_source_mailbox.current_state_or_quality",
      targetSource: "live_source_mailbox",
      targetKind: "live_source_mailbox",
      strength: "hard",
      score: 0.93,
      reasonCodes: ["live_source_current_state_intent", "requires_live_source_state_tool_observation"],
      requestedOutputs: [
        "stage_play_live_source_current_state",
        "stage_play_live_source_quality",
        "typed_failure",
      ],
      capabilityKeys: [
        "live_env.summarize_live_source_current_state",
        "live_env.query_live_source_quality",
      ],
      terminalProductConstraints: [
        "live_environment_tool_observation",
        "stage_play_live_source_current_state",
        "stage_play_live_source_quality",
        "model_synthesized_answer",
        "typed_failure",
      ],
    }));
  }

  if (/\b(?:screen|visual|capture|screenshot|frame)\b/i.test(prompt)) {
    promptIntentCandidates.push("visual_capture");
    candidates.push(makeCandidate({
      candidateId: "visual_capture.current_visual_state",
      targetSource: "visual_capture",
      targetKind: "visual_capture",
      strength: /\b(?:current|latest|right\s+now|what\s+is\s+happening|what\s+is\s+visible)\b/i.test(prompt)
        ? "hard"
        : "soft",
      score: /\b(?:current|latest|right\s+now|what\s+is\s+happening|what\s+is\s+visible)\b/i.test(prompt)
        ? 0.88
        : 0.58,
      reasonCodes: ["visual_capture_candidate"],
      requestedOutputs: ["current_visual_state", "field_evaluation_refs", "interpretation_refs", "typed_failure"],
      capabilityKeys: ["situation-room.describe_visual_capture"],
      terminalProductConstraints: ["situation_context_pack", "visual_context_pack", "typed_failure"],
    }));
  }

  if (candidates.length === 0) {
    candidates.push(makeCandidate({
      candidateId: "unknown.no_explicit_evidence_target",
      targetSource: "unknown",
      targetKind: "unknown",
      strength: "none",
      score: 0.2,
      reasonCodes: ["no_explicit_evidence_target"],
      terminalProductConstraints: ["direct_answer_text"],
    }));
  }

  const orderedCandidates = [...candidates].sort((a, b) => b.score - a.score);
  const selected = orderedCandidates.find((candidate) => !candidate.disallowed) ?? orderedCandidates[0] ?? null;
  const hardSourceTarget =
    selected !== null &&
    selected.target_source !== "unknown" &&
    selected.target_source !== "model_only" &&
    selected.target_kind !== "general_background";

  return {
    schema: HELIX_ASK_EVIDENCE_TARGET_ARBITRATION_SCHEMA,
    turn_id: input.turnId,
    thread_id: input.threadId,
    prompt_intent_candidates: unique(promptIntentCandidates),
    evidence_target_candidates: orderedCandidates,
    source_targets: unique(orderedCandidates.map((candidate) => candidate.target_source)),
    available_capabilities: unique(orderedCandidates.flatMap((candidate) => candidate.disallowed ? [] : candidate.capability_keys)),
    disallowed_capabilities: unique(orderedCandidates.flatMap((candidate) => candidate.disallowed ? candidate.capability_keys : [])),
    selected_candidate_id: selected?.candidate_id ?? null,
    selected_target_source: selected?.target_source ?? "unknown",
    selected_target_kind: selected?.target_kind ?? "unknown",
    confidence: selected?.confidence ?? "low",
    reason_codes: selected?.reason_codes ?? ["no_explicit_evidence_target"],
    must_enter_backend_ask: Boolean(hardSourceTarget && selected?.strength === "hard"),
    allow_no_tool_direct: !hardSourceTarget || selected?.strength !== "hard",
    terminal_product_constraints: selected?.terminal_product_constraints ?? ["direct_answer_text"],
    assistant_answer: false,
    raw_content_included: false,
    context_role: "admission_control",
  };
}
