import {
  HELIX_ASK_SOURCE_TARGET_INTENT_SCHEMA,
  type HelixAskSourceTarget,
  type HelixAskSourceTargetIntent,
  type HelixAskSourceTargetRequestedOutput,
  type HelixAskSourceTargetStrength,
} from "@shared/helix-ask-source-target-intent";
import type { HelixActiveWorkspaceSourceResolution } from "@shared/helix-active-workspace-source-resolution";
import {
  asksForScientificImageEvidenceContinuity,
  asksForScientificImageTextEvidenceComparison,
} from "@shared/helix-scientific-image-intent";
import { detectRepoCodeEvidenceIntent } from "./repo-code-intent-detector";
import {
  isSceneEpochReplayPrompt,
  SCENE_EPOCH_REPLAY_FORBIDDEN_ROUTES,
} from "./scene-epoch-replay-intent";
import {
  isContextualProcedureRecallPrompt,
  matchProcedureRecallPrompt,
  PROCEDURE_RECALL_SUPPRESSED_ROUTES,
  procedureRecallTargetSource,
} from "./procedure-memory-recall-router";
import {
  classifyLiveSourceContinuationIntent,
  isContextualLiveSourceCadenceMention,
  isLiveSourceCadenceControlPrompt,
  isLiveSourceMailLoopPrompt,
} from "./live-source-continuation-intent";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { isAffirmativeTheoryFormalArtifactInspectionPrompt } from "./theory-formal-artifact-intent";
import {
  buildToolUseRestatement,
  detectInternetSearchIntent,
  hasExplicitFreshDocsAccessCue,
  hasAffirmativeDocsViewerSearchCue,
  hasRetainedEvidenceContinuationCue,
} from "./internet-search-intent";
import {
  detectScholarlyResearchIntent,
  hasFullyNegatedScholarlyResearchInstruction,
} from "./scholarly-research-intent";
import {
  detectModelOnlyConceptSourceSignal,
  isExplicitEvidenceSourceRequest,
} from "./model-only-concept-source-guard";
import { buildAskEvidenceTargetArbitration } from "./evidence-target-arbitration";
import {
  isStagePlayCheckpointRequestPrompt,
  isStagePlayJobPlanningPrompt,
  isStagePlayReflectionPrompt,
} from "./stage-play-prompt-intent";
import {
  isWorkspaceOsStatusPrompt,
  workspaceOsStatusReasonCodes,
} from "./workspace-os-status-intent";
import {
  isCurrentOpenDocsViewerSummaryPrompt,
  isExplicitDocsPathComparePrompt,
  isExplicitDocsPathLocateSynthesisPrompt,
  isExplicitDocsPathSummaryPrompt as isExplicitDocsMarkdownPathSummaryPrompt,
} from "./docs-viewer-intent";
import {
  isAskTurnDocsTopicSummaryPrompt,
  isAskTurnNamedDocRelationPrompt,
  resolveAskTurnNamedDocSummaryQueryArg,
  resolveAskTurnTopicDocQueryArg,
} from "./doc-args";
import { resolveAuthoritativeDocsTopicMatch } from "./docs-search";
import {
  isAffirmativeTheoryBadgeGraphReflectionPrompt,
  isTheoryBadgeGraphCurrentContextPrompt,
} from "./theory-badge-graph-current-context-intent";
import {
  isAffirmativeEnvironmentReasoningRoleInspectPrompt,
  isAffirmativeImmediateMinecraftSituationPrompt,
  isAffirmativeMinecraftDurableGoalCreatePrompt,
  isAffirmativeMinecraftDurableGoalInspectPrompt,
  isMinecraftCommandNonExecutionDiscussionPrompt,
  isMinecraftSituationSessionSetupPrompt,
} from "./minecraft-situation-intent";
import { isMinecraftMechanicsDocsPrompt } from "./minecraft-mechanics-docs-intent";
import {
  extractExplicitCapabilityContracts,
  type ExplicitCapabilityExtractionContext,
} from "./explicit-capability-contract";
import { isAffirmativeMinecraftPlayerEmbodimentActionPrompt } from "./minecraft-execution-plane-intent";
import { isAffirmativeBrokerageEnvironmentReadPrompt } from "./brokerage-environment-intent";

export {
  isStagePlayCheckpointRequestPrompt,
  isStagePlayJobPlanningPrompt,
  isStagePlayReflectionPrompt,
} from "./stage-play-prompt-intent";

type CueRule = {
  target: HelixAskSourceTarget;
  reason: string;
  confidence: number;
  strength: HelixAskSourceTargetStrength;
  requestedOutputs: HelixAskSourceTargetRequestedOutput[];
  targetKind?: HelixAskSourceTarget;
  allowClientShortcut?: boolean;
  allowNoToolDirect?: boolean;
  cues: Array<{ label: string; pattern: RegExp }>;
  suppressedRoutes: string[];
};

const matches = (prompt: string, cues: CueRule["cues"]): string[] =>
  cues
    .filter((cue: CueRule["cues"][number]) => cue.pattern.test(prompt))
    .map((cue: CueRule["cues"][number]) => cue.label);

const isExplicitModelOnlyPrompt = (prompt: string): boolean => {
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  const mutatingWriteOnlySuppression = contextualSuppression?.verb_or_cue === "workstation.write_file";
  const affirmativeDocsRequirement =
    isAffirmativeDocsSourceRequirementPrompt(prompt) &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer");
  const scholarlyIntent = detectScholarlyResearchIntent(prompt);
  const fullyNegatedSourceExamples =
    hasFullyNegatedScholarlyResearchInstruction(prompt) &&
    /\b(?:urls?|links?|sources?)\b[^.!?;\n]{0,60}\b(?:are|were)\s+(?:examples?|illustrations?)\s+only\b/i.test(prompt);
  const narrowerSearchSuppression = /^(?:internet_search\.web_research|scholarly-research\.lookup_papers)$/i.test(
    contextualSuppression?.verb_or_cue ?? "",
  );
  const affirmativeScholarlyRequirement =
    scholarlyIntent.researchRequested &&
    (
      !contextualToolSuppressionBlocksFamily(contextualSuppression, "scholarly_research") ||
      (scholarlyIntent.fullTextRequested && narrowerSearchSuppression)
    );
  const affirmativeGeneralKnowledgeScope =
    /\b(?:use|using|from|rely(?:ing)?\s+on|answer\s+from)\s+(?:only\s+)?general\s+(?:knowledge|reasoning)\b/i.test(
      prompt,
    ) ||
    /\bgeneral\s+(?:knowledge|reasoning)\s+(?:only|is\s+(?:enough|fine)|will\s+do)\b/i.test(
      prompt,
    );
  return (
    fullyNegatedSourceExamples ||
    (Boolean(contextualSuppression) &&
      !(
        mutatingWriteOnlySuppression && isExplicitEvidenceSourceRequest(prompt)
      ) &&
      !affirmativeDocsRequirement &&
      !affirmativeScholarlyRequirement) ||
    /\bwithout\s+(?:using|checking|looking\s+at|searching|consulting)\s+(?:the\s+)?(?:workspace|workstation(?:\s+tools?)?|docs?|documents?|papers?|screen|visual|sources?)\b/i.test(
      prompt,
    ) ||
    /\b(?:do\s+not|don'?t)\s+(?:use|look\s+at|check|search|consult)\s+(?:the\s+)?(?:workspace|workstation(?:\s+tools?)?|docs?|documents?|papers?|screen|visual|sources?)\b/i.test(
      prompt,
    ) ||
    /\bno\s+(?:workspace|docs?|source|screen|visual)\s+(?:lookup|use|search|context)\b/i.test(
      prompt,
    ) ||
    /\b(?:background\s+only|background\s+mode|just\s+answer\s+from\s+general\s+reasoning)\b/i.test(
      prompt,
    ) ||
    affirmativeGeneralKnowledgeScope
  );
};

const isStructuredDocsViewerPrompt = (prompt: string): boolean => {
  const docsViewerCue =
    /\bcurrent\s+docs?\s+viewer\s+context\b/i.test(prompt) ||
    /\bdocs?\s+viewer\b/i.test(prompt);
  const structuredPathCue = /^\s*Document\s+path\s*:/im.test(prompt);
  const locateQueryCue = /^\s*Locate\s+query\s*:/im.test(prompt);
  const locationsListCue =
    /\bReturn\s+a\s+short\s+"?Locations:"?\s+list\b/i.test(prompt) ||
    /\banchors?\/sections?\b/i.test(prompt) ||
    /\bevidence\s+snippets?\b/i.test(prompt);
  return (
    (docsViewerCue &&
      (structuredPathCue || locateQueryCue || locationsListCue)) ||
    (structuredPathCue && locateQueryCue && locationsListCue)
  );
};

const isDocsViewerTopicLabelPrompt = (prompt: string): boolean => {
  const match = prompt.match(/^\s*(?:docs?\s+viewer|documents?\s+viewer|docs[-_. ]viewer)\s*:\s*/i);
  if (!match) return false;
  const afterLabel = prompt.slice(match[0].length).trim();
  if (!afterLabel) return false;
  if (isStructuredDocsViewerPrompt(prompt)) return false;
  if (isAffirmativeDocsSourceRequirementPrompt(prompt) || isAffirmativeDocsSearchPrompt(prompt)) return false;
  if (isExplicitDocumentAcquisitionPrompt(prompt) || isDocsPanelOpenPrompt(prompt)) return false;
  const activeDocCue = /\b(?:current|active|open|this|that)\s+(?:docs?|documents?|papers?)\b/i.test(afterLabel);
  const negatedActiveDocCue =
    /\b(?:not|isn't|is\s+not|without|rather\s+than)\b[\s\S]{0,80}\b(?:current|active|open|this|that)\s+(?:docs?|documents?|papers?)\b/i.test(afterLabel) ||
    /\b(?:current|active|open|this|that)\s+(?:docs?|documents?|papers?)\b[\s\S]{0,80}\b(?:not|isn't|is\s+not|without)\b/i.test(afterLabel);
  if (activeDocCue && !negatedActiveDocCue) return false;
  if (
    /\b(?:dynamic\s+actions?|capabilit(?:y|ies)|coverage|test\s+evidence|surface|well\s+represented|core\s+actions?)\b/i.test(afterLabel)
  ) {
    return true;
  }
  if (/\b(?:open|search|find|locate|summari[sz]e|explain|describe|read|show|load)\b[\s\S]{0,100}\b(?:docs?|documents?|papers?|viewer|path|source)\b/i.test(afterLabel)) {
    return false;
  }
  return true;
};

const isDeicticDocsIdentityPrompt = (prompt: string): boolean => {
  const explicitVisualCue = /\b(?:screen|visual|capture|frame|visible|screenshot)\b/i.test(prompt);
  if (explicitVisualCue) return false;
  return (
    /\b(?:what|which)\s+(?:docs?|documents?|papers?|white\s*papers?)\s+(?:am\s+i|are\s+we)\s+(?:looking\s+at|viewing|reading|on|open)(?:\s+(?:now|right\s+now|currently))?\b/i.test(prompt) ||
    /\b(?:what|which)\s+(?:docs?|documents?|papers?|white\s*papers?)\s+(?:is|are)\s+(?:open|active|current|in\s+(?:the\s+)?viewer)(?:\s+(?:now|right\s+now|currently))?\b/i.test(prompt)
  );
};

const isDocsPanelOpenPrompt = (prompt: string): boolean => {
  const normalized = prompt
    .trim()
    .replace(/^[\s,]*(?:ok|okay|all\s+right|alright|hello|hey)[\s,]+/i, "")
    .replace(/\b(?:please|for\s+me|for\s+us)\b/gi, " ")
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  return (
    /(?:^|[.?!]\s+)(?:(?:can|could|would)\s+you\s+)?(?:open|open\s+up|show|view|pull\s+up|bring\s+up|switch\s+to|go\s+to|navigate\s+to)\s+(?:(?:the|a)\s+)?(?:docs?|documents?)(?:\s+(?:viewer|panel|dock))?(?:\s|[.?!,]|$)/i.test(
      normalized,
    ) &&
    !/\b(?:docs?|documents?)\s+(?:about|on|regarding|for|named|called|matching)\b/i.test(
      normalized,
    )
  );
};

const isExplicitDocumentAcquisitionPrompt = (prompt: string): boolean =>
  !isDocsPanelOpenPrompt(prompt) &&
  /\b(?:open|open\s+up|show|view|pull\s+up|bring\s+up|load)\b[\s\S]{0,140}\b(?:NHM[-\s]?2|white\s*paper|whitepaper|paper|document|doc)\b[\s\S]{0,100}\b(?:docs?|docks?|documents?|viewer)\b/i.test(prompt);

const isDocsOpenAndSummarizePrompt = (prompt: string): boolean =>
  /\b(?:summari[sz]e|summary|overview|takeaways?|explain|describe|gist|what\s+(?:it|the\s+(?:doc|document|paper))\s+says)\b/i.test(
    prompt,
  ) &&
  /\b(?:docs?|documents?|papers?|white\s*papers?|whitepapers?)\b/i.test(prompt) &&
  /\b(?:find|search|open|show|get|load|best|matching|relevant)\b/i.test(prompt);

const isExplicitDocsPathSummaryPrompt = (prompt: string): boolean =>
  isExplicitDocsMarkdownPathSummaryPrompt(prompt);

const isAffirmativeDocsSourceRequirementPrompt = (prompt: string): boolean =>
  isExplicitDocsPathSummaryPrompt(prompt) ||
  isAskTurnDocsTopicSummaryPrompt(prompt) ||
  isDocsOpenAndSummarizePrompt(prompt) ||
  Boolean(resolveAskTurnNamedDocSummaryQueryArg(prompt)) ||
  (
    /\b(?:open|find|search|show|load|summari[sz]e|summary|overview|takeaways?|explain|describe|gist)\b/i.test(prompt) &&
    /\b(?:doc|docs|document|documents|audit|white\s*paper|paper)\b/i.test(prompt) &&
    /\b(?:use|using|from)\s+(?:the\s+)?docs?\s+only\b/i.test(prompt)
  );

const isAffirmativeLocalDocumentEvidencePrompt = (prompt: string): boolean => {
  if (isExplicitDocsPathComparePrompt(prompt) || isExplicitDocsPathLocateSynthesisPrompt(prompt)) return true;
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
  return (
    evidenceCue && (valueCue || /\b(?:NHM[-\s]?2|casimir|tile)\b/i.test(prompt))
  );
};

const isAffirmativeDocsSearchPrompt = (prompt: string): boolean => {
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  return (
    hasAffirmativeDocsViewerSearchCue(prompt) ||
    (
      Boolean(resolveAskTurnNamedDocSummaryQueryArg(prompt)) &&
      !contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer")
    )
  );
};

const isNaturalLocalDocumentLookupPrompt = (prompt: string): boolean => {
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  if (contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer")) return false;
  const unquoted = prompt.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  if (
    /\b(?:do\s+not|don't|dont|never|without|avoid|ignore|disregard)\b[\s\S]{0,140}\b(?:find|search|locate|get|look\s+up|pull\s+up)\b/i.test(
      unquoted,
    ) ||
    /\b(?:later|next\s+time|in\s+the\s+future|not\s+now|not\s+yet)\b[\s\S]{0,140}\b(?:find|search|locate|get|look\s+up|pull\s+up)\b/i.test(
      unquoted,
    ) ||
    /\b(?:earlier|previously|last\s+turn|historically)\b[\s\S]{0,140}\b(?:found|searched|located|got|looked\s+up|pulled\s+up)\b/i.test(
      unquoted,
    )
  ) {
    return false;
  }
  const explicitLocalLookup =
    /\b(?:find|search|locate|get|look\s+up)\b/i.test(unquoted) &&
    /\b(?:local|workspace|our|project)\s+(?:doc|document|paper|report|memo)\b/i.test(unquoted) &&
    /\b(?:about|on|regarding|for|called|named|titled)\b/i.test(unquoted);
  if (explicitLocalLookup) return true;

  if (
    /\b(?:online|on\s+the\s+(?:web|internet)|published|journal|doi|arxiv|peer[-\s]?reviewed|primary\s+(?:paper|study)|research\s+paper)\b/i.test(
      unquoted,
    )
  ) {
    return false;
  }
  const namedArtifact = unquoted.match(
    /\b(?:find|search(?:\s+for)?|locate|get|look\s+up|pull\s+up)\s+(?:me\s+)?(?:the|our)\s+(.{2,180}?)\s+(study|white\s*paper|whitepaper|report|memo|document|doc|paper)\b/i,
  );
  if (!namedArtifact?.[1]) return false;
  const titleTokens = namedArtifact[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) =>
      token.length >= 2 &&
      !/^(?:best|right|top|closest|latest|newest|recent|relevant|matching|another|some|any)$/.test(token));
  return titleTokens.length >= 2;
};

const isExplicitProcessGraphPrompt = (prompt: string): boolean =>
  /\b(?:process\s+graph|workstation\s+(?:process\s+)?graph|workstation\s+state|what\s+panels\s+are\s+open|which\s+panels\s+are\s+open|panels\s+open)\b/i.test(prompt);

const hasConcreteCalculatorExpression = (prompt: string): boolean =>
  /\bscientific-calculator\.solve(?:_expression|_with_steps)?\b/i.test(prompt) ||
  /\b(?:with\s+(?:this\s+exact\s+)?expression|expression\s+is|expression)\s*:?\s*[0-9][0-9eE\s.+\-*/^%()[\]]{1,120}/i.test(prompt);

const isConditionalPriorEvidenceCalculatorFollowup = (prompt: string): boolean => {
  const conditional = /\b(?:if|when|provided\s+that|only\s+if|assuming)\b/i.test(prompt);
  const priorEvidence = /\b(?:previous|prior|above|last|earlier)\b[\s\S]{0,100}\b(?:answers?|evidence|result|retrieval|values?|variables?)\b/i.test(prompt);
  const sufficiencyCheck = /\b(?:enough|sufficient|usable|adequate|complete|fully\s+cited|unit[-\s]?bearing|cited)\b[\s\S]{0,120}\b(?:values?|numbers?|numerics?|parameters?|evidence|citations?|units?)\b/i.test(prompt);
  const calculatorFollowup = /\b(?:bind|calculate|compute|evaluate|solve|run)\b[\s\S]{0,140}\b(?:formula|expression|calculator|numeric(?:al)?\s+expression|result)\b/i.test(prompt);
  return conditional && priorEvidence && sufficiencyCheck && calculatorFollowup;
};

const isCalculatorSolvePrompt = (prompt: string): boolean => {
  if (isConditionalPriorEvidenceCalculatorFollowup(prompt) && !hasConcreteCalculatorExpression(prompt)) return false;
  const unquoted = prompt.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  const deicticCalculatorVerification =
    /^\s*(?:please\s+)?(?:check|verify|run|evaluate|calculate)\s+(?:that|it)\s+(?:in|with|through)\s+(?:the\s+)?(?:scientific\s+)?calculator\s*[.!?]*\s*$/i.test(unquoted);
  if (deicticCalculatorVerification) return true;
  return (
    /\b(?:scientific\s+)?calculator\b/i.test(prompt) &&
    /\b(?:run|solve|evaluate|compute|calculate|check|verify)\b[\s\S]{0,160}(?:\d|[=+\-*/^()]|\\frac|\\sqrt|\bequation\b|\bexpression\b|\bformula\b)/i.test(prompt)
  );
};

const isLiveAnswerEnvironmentStatePrompt = (prompt: string): boolean => {
  const mentionsLiveAnswer =
    /\b(?:live\s+(?:answer\s+)?environment|live\s+answer\s+card|live\s+card|active\s+live\s+(?:answer\s+)?(?:environment|source|job)|live\s+calculator\s+(?:source|job|environment)|calculator\s+live\s+(?:source|job|environment))\b/i.test(
      prompt,
    );
  if (!mentionsLiveAnswer) return false;
  return /\b(?:latest|current|result|value|equation|line|quiet|silent|threshold|cross(?:ed|es|ing)?|changed|state|status|why)\b/i.test(
    prompt,
  );
};

const isHistoricalRuntimeEvidencePrompt = (prompt: string): boolean => {
  const historicalTurnCue =
    /\b(?:last|previous|prior|earlier|past|before)\s+(?:ask\s+)?(?:turn|response|run|iteration|tool\s+call|call)\b/i.test(prompt) ||
    /\b(?:what|why)\b[\s\S]{0,80}\b(?:last|previous|prior|earlier)\b[\s\S]{0,80}\b(?:turn|tool\s+call|capability|route)\b/i.test(prompt);
  const diagnosticCue =
    /\b(?:why\s+did|why\s+was|what\s+(?:called|route|tool|capability)|diagnos(?:e|is)|explain|inspect|review)\b/i.test(prompt);
  const runtimeEvidenceCue =
    /\b(?:tool\s*calls?|capabilit(?:y|ies)|route|runtime|agent\s+loop|debug\s+(?:export|trace|payload)|terminal_error_code|goal_satisfaction|set_rate|live[-_.]?source|[a-z][\w-]*(?:[._-][a-z][\w-]*){1,})\b/i.test(
      prompt,
    );
  return historicalTurnCue && diagnosticCue && runtimeEvidenceCue;
};

const isGenericSceneEpochPhrase = (prompt: string): boolean =>
  /\b(?:scene\s+epoch|visual\s+epoch|screen\s+epoch|live\s+epoch|last\s+(?:seen\s+|situation\s+|scene\s+|visual\s+|screen\s+|live\s+)?epoch|previous\s+(?:scene|frame|visual|screen|capture)|last\s+(?:scene|frame|visual|screen|capture))\b/i.test(prompt);

const isLiveCaptureContentPrompt = (prompt: string): boolean =>
  /\b(?:describe|review|explain|summari[sz]e|what\s+(?:do\s+you\s+)?see|what\s+is\s+(?:happening|visible|shown|showing))\b[\s\S]{0,140}\blive\s+(?:capture|screen|visual)\b/i.test(prompt) ||
  /\blive\s+(?:capture|screen|visual)\b[\s\S]{0,140}\b(?:visible|shown|showing|see|happening)\b/i.test(prompt) ||
  /\b(?:describe|review|explain|summari[sz]e|what\s+(?:do\s+you\s+)?see|what\s+is\s+(?:happening|visible|shown|showing))\b[\s\S]{0,140}\bvisual\s+capture\b/i.test(prompt) ||
  /\bvisual\s+capture\b[\s\S]{0,140}\b(?:visible|shown|showing|see|seeing|happening)\b/i.test(prompt) ||
  (
    /\b(?:active|current|latest)\s+visual\s+(?:screen\s+)?capture\b/i.test(prompt) &&
    /\b(?:what|visible|shown|showing|happening|evidence|missing|describe|review|explain|summari[sz]e)\b/i.test(prompt)
  );

const rules: CueRule[] = [
  {
    target: "docs_viewer",
    reason: "explicit_docs_viewer_source_target",
    confidence: 0.96,
    strength: "hard",
    requestedOutputs: ["file_path"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: [
      "situation_context_question",
      "visual_deictic",
      "visual_frame_evidence",
      "active_doc_identity",
      "active_doc_summary",
    ],
    cues: [
      { label: "current_docs_viewer_context", pattern: /\bcurrent\s+docs?\s+viewer\s+context\b/i },
      { label: "docs_viewer", pattern: /\bdocs?\s+viewer\b/i },
      { label: "document_path_field", pattern: /^\s*Document\s+path\s*:/im },
      { label: "locate_query_field", pattern: /^\s*Locate\s+query\s*:/im },
      { label: "locations_list", pattern: /\bReturn\s+a\s+short\s+"?Locations:"?\s+list\b/i },
      { label: "anchors_sections", pattern: /\banchors?\/sections?\b/i },
      { label: "evidence_snippets", pattern: /\bevidence\s+snippets?\b/i },
    ],
  },
  {
    target: "live_pipeline",
    reason: "explicit_live_pipeline_control_source_target",
    confidence: 0.94,
    strength: "hard",
    requestedOutputs: ["live_pipeline_receipt"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["situation_context_question", "active_doc_identity", "active_doc_summary", "model_only_concept"],
    cues: [
      { label: "set_interval", pattern: /\bset\s+(?:the\s+)?(?:interval|cadence|rate)\b/i },
      { label: "capture_cadence", pattern: /\b(?:capture|visual|screen|frame)\b[\s\S]{0,80}\b(?:cadence|interval|every\s+\d{1,3}\s*(?:seconds?|sec|s))\b/i },
      { label: "keep_live_answer", pattern: /\b(?:keep|continue)\b[\s\S]{0,80}\b(?:checking|watching|monitoring|using|looking\s+at)\b[\s\S]{0,80}\b(?:screen|visual|capture|frame|live\s+answer|live\s+source)\b/i },
      { label: "watch_live_source", pattern: /\b(?:watch|monitor|track|observe|check)\b[\s\S]{0,80}\b(?:screen|visual|capture|frame|live\s+answer|live\s+source)\b[\s\S]{0,80}\b(?:as\s+a\s+)?live\s+answer\b/i },
      { label: "start_live_source", pattern: /\bstart\b[\s\S]{0,80}\b(?:live\s+source|visual\s+capture|screen\s+capture)\b/i },
      { label: "repair_live_source", pattern: /\b(?:fix|repair|recover)\b[\s\S]{0,80}\b(?:live\s+)?(?:screen|visual|capture|frame|source|producer)\b/i },
      { label: "attach_source", pattern: /\battach\b[\s\S]{0,80}\b(?:source|visual|capture|producer)\b/i },
      { label: "adopt_producer", pattern: /\badopt\b[\s\S]{0,80}\b(?:producer|visual\s+producer|capture)\b/i },
    ],
  },
  {
    target: "procedure_memory",
    targetKind: "visual_scene_memory",
    reason: "explicit_visual_scene_memory_source_target",
    confidence: 0.93,
    strength: "hard",
    requestedOutputs: [
      "procedure_epoch_replay",
      "field_evaluation_refs",
      "interpretation_refs",
      "current_visual_state",
      "visual_scene_query_intent",
      "selected_visual_scene_set",
      "visual_scene_comparison_result",
      "typed_failure",
    ],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["process_graph_overview", "active_doc_identity", "active_doc_summary", "model_only_concept"],
    cues: [
      { label: "compare_to_named_prior_scene", pattern: /\bcompare\b[\s\S]{0,120}\b(?:to\s+)?(?:the\s+)?(?:last|previous)?\s*[A-Za-z0-9 _.-]{2,80}\s+(?:folder\s+)?scene\b/i },
      { label: "find_named_prior_scene", pattern: /\bfind\b[\s\S]{0,80}\b(?:camera\s+roll|soho|sun|audio\s+export|task\s+manager|[A-Za-z0-9 _.-]{2,60})\s+scene\b/i },
      { label: "changed_since_named_prior_scene", pattern: /\bwhat\s+changed\s+since\s+(?:the\s+)?[A-Za-z0-9 _.-]{2,80}\s+(?:folder|scene)\b/i },
      { label: "last_folder_scene", pattern: /\blast\s+folder\s+scene\b/i },
      { label: "current_task_manager_to_prior_scene", pattern: /\bcompare\b[\s\S]{0,120}\bcurrent\s+task\s*manager\s+scene\b[\s\S]{0,120}\blast\s+folder\s+scene\b/i },
      { label: "media_roll_scene_memory", pattern: /\bcamera\s*roll\b[\s\S]{0,80}\bscene\b|\bscene\b[\s\S]{0,80}\bcamera\s*roll\b/i },
      { label: "audio_export_folder_scene", pattern: /\baudio\s*exports?\s+folder\b/i },
      { label: "sun_folder_scene", pattern: /\bsun\s+folder\s+scene\b/i },
      { label: "semantic_scene_memory", pattern: /\b(?:camera\s+roll|soho|sun\s+folder|audio\s+exports?|task\s+manager)\b[\s\S]{0,120}\b(?:scene|compare|changed|previous|last)\b/i },
    ],
  },
  {
    target: "procedure_memory",
    targetKind: "situation_epoch",
    reason: "explicit_visual_epoch_delta_source_target",
    confidence: 0.94,
    strength: "hard",
    requestedOutputs: ["procedure_epoch_replay", "field_evaluation_refs", "interpretation_refs", "current_visual_state"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["process_graph_overview", "active_doc_identity", "active_doc_summary", "model_only_concept"],
    cues: [
      { label: "what_changed", pattern: /\bwhat\s+changed\b/i },
      { label: "changed_since", pattern: /\bchanged\s+since\b/i },
      { label: "last_epoch", pattern: /\blast\s+(?:seen\s+|situation\s+|scene\s+|visual\s+|screen\s+|live\s+)?epoch\b/i },
      { label: "scene_epoch", pattern: /\bscene\s+epoch\b/i },
      { label: "visual_epoch", pattern: /\bvisual\s+epoch\b/i },
      { label: "screen_epoch", pattern: /\bscreen\s+epoch\b/i },
      { label: "live_epoch", pattern: /\blive\s+epoch\b/i },
      { label: "since_last_seen", pattern: /\bsince\s+(?:the\s+)?last\s+seen\b/i },
      { label: "since_last_visual", pattern: /\bsince\s+(?:the\s+)?last\s+visual\b/i },
      { label: "since_last_capture", pattern: /\bsince\s+(?:the\s+)?last\s+capture\b/i },
      { label: "previous_frame", pattern: /\bprevious\s+frame\b/i },
      { label: "previous_visual", pattern: /\bprevious\s+visual\b/i },
      { label: "previous_scene_or_screen", pattern: /\bprevious\s+(?:scene|screen|capture)\b/i },
      { label: "compare_to_last", pattern: /\bcompare\b[\s\S]{0,80}\b(?:last|previous)\s+(?:scene|frame|visual|screen|capture|epoch)\b/i },
      { label: "compare_current_scene", pattern: /\bcompare\s+current\s+scene\b/i },
      { label: "difference_from_last_scene", pattern: /\b(?:different|difference)\b[\s\S]{0,100}\b(?:last|previous)\s+(?:scene|frame|visual|screen|capture|epoch)\b/i },
      { label: "last_scene_current_scene", pattern: /\blast\s+(?:scene|frame|visual|screen|capture)\b[\s\S]{0,100}\b(?:current|now|looking\s+at|this\s+(?:scene|frame|visual|screen))\b/i },
    ],
  },
  {
    target: "visual_capture",
    reason: "explicit_visual_source_target",
    confidence: 0.94,
    strength: "hard",
    requestedOutputs: ["current_visual_state", "field_evaluation_refs", "interpretation_refs"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["active_doc_identity", "active_doc_summary", "active_note", "doc_open_best"],
    cues: [
      { label: "visual_capture", pattern: /\bvisual\s+(?:screen\s+)?capture\b/i },
      { label: "screen_capture", pattern: /\bscreen\s+capture\b/i },
      { label: "live_capture", pattern: /\blive\s+(?:capture|screen|visual)\b/i },
      { label: "visual_source", pattern: /\bvisual\s+(?:source|frame|screen)\b/i },
      { label: "visuals_plural", pattern: /\b(?:the\s+)?visuals\b/i },
      { label: "describe_visuals", pattern: /\b(?:describe|explain|summari[sz]e)\s+(?:what\s+)?(?:the\s+)?visuals\s+(?:are|show|contain|depict)\b/i },
      { label: "screen_share", pattern: /\bscreen\s+share\b/i },
      { label: "current_screen", pattern: /\b(?:current|latest)\s+(?:screen|visual|frame)\b/i },
      { label: "on_screen", pattern: /\bon\s+(?:my|the)\s+screen\b/i },
      { label: "in_screen_or_visual", pattern: /\bin\s+(?:my|the)\s+(?:screen|visual|visual\s+screen|screen\s+capture)\b/i },
      { label: "visible_workspace", pattern: /\bvisible\s+(?:screen|window|folder|file)\b/i },
      { label: "looking_at_file", pattern: /\b(?:what|which|describe)?\s*(?:file|window|folder)\s+(?:am\s+i|i(?:'m| am)|are\s+we)\s+(?:looking\s+at|viewing|seeing|clicking|selecting)\b/i },
      { label: "looking_at_now", pattern: /\bwhat\s+(?:am\s+i|are\s+we)\s+looking\s+at(?:\s+(?:now|right\s+now))?\b/i },
      { label: "explain_looking_at_now", pattern: /\b(?:explain|describe|summari[sz]e)\s+what\s+(?:i(?:'m| am)|we(?:'re| are))\s+looking\s+at(?:\s+(?:now|right\s+now))?\b/i },
    ],
  },
  {
    target: "world_event",
    reason: "explicit_world_event_source_target",
    confidence: 0.94,
    strength: "hard",
    requestedOutputs: ["procedure_epoch_replay"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["active_doc_identity", "active_doc_summary", "situation_context_question"],
    cues: [
      { label: "minecraft", pattern: /\b(?:minecraft|minehut)\b/i },
      { label: "world_event", pattern: /\bworld[-\s]?events?\b/i },
      { label: "game_event_log", pattern: /\bgame\s+event\s+log\b/i },
      { label: "world_source", pattern: /\bworld\s+source\b/i },
    ],
  },
  {
    target: "procedure_memory",
    reason: "explicit_procedure_memory_recall",
    confidence: 0.9,
    strength: "hard",
    requestedOutputs: ["procedure_epoch_replay"],
    targetKind: "procedure_memory",
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["active_doc_identity", "active_doc_summary"],
    cues: [
      { label: "show_evidence", pattern: /\bshow\s+(?:the\s+)?evidence\b/i },
      { label: "why_answer", pattern: /\bwhy\s+did\s+you\s+say\b/i },
      { label: "replay", pattern: /\breplay\s+(?:that|the\s+last|the\s+procedure|procedure\s+memory)\b/i },
      { label: "procedure_memory", pattern: /\bprocedure\s+memory\b/i },
      { label: "last_epoch", pattern: /\blast\s+(?:seen\s+|situation\s+|scene\s+|visual\s+|screen\s+|live\s+)?epoch\b/i },
      { label: "scene_epoch", pattern: /\bscene\s+epoch\b/i },
      { label: "visual_epoch", pattern: /\bvisual\s+epoch\b/i },
      { label: "screen_epoch", pattern: /\bscreen\s+epoch\b/i },
      { label: "live_epoch", pattern: /\blive\s+epoch\b/i },
      { label: "what_changed", pattern: /\bwhat\s+changed\b/i },
      { label: "changed_since", pattern: /\bchanged\s+since\b/i },
      { label: "since_last_seen", pattern: /\bsince\s+(?:the\s+)?last\s+seen\b/i },
      { label: "since_last_visual", pattern: /\bsince\s+(?:the\s+)?last\s+visual\b/i },
      { label: "since_last_capture", pattern: /\bsince\s+(?:the\s+)?last\s+capture\b/i },
      { label: "previous_frame", pattern: /\bprevious\s+frame\b/i },
      { label: "previous_visual", pattern: /\bprevious\s+visual\b/i },
      { label: "compare_to_last", pattern: /\bcompare\b[\s\S]{0,80}\b(?:last|previous)\s+(?:scene|frame|visual|screen|capture|epoch)\b/i },
      { label: "compare_current_scene", pattern: /\bcompare\s+current\s+scene\b/i },
      { label: "difference_from_last_scene", pattern: /\b(?:different|difference)\b[\s\S]{0,100}\b(?:last|previous)\s+(?:scene|frame|visual|screen|capture|epoch)\b/i },
      { label: "last_scene_current_scene", pattern: /\blast\s+(?:scene|frame|visual|screen|capture)\b[\s\S]{0,100}\b(?:current|now|looking\s+at|this\s+(?:scene|frame|visual|screen))\b/i },
      { label: "confidence_change", pattern: /\bconfidence\s+change\b/i },
    ],
  },
  {
    target: "active_doc",
    reason: "explicit_active_document_target",
    confidence: 0.88,
    strength: "hard",
    requestedOutputs: ["file_path"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["situation_context_question", "visual_deictic", "visual_frame_evidence"],
    cues: [
      { label: "active_doc", pattern: /\b(?:active|current|open)\s+(?:docs?|documents?|papers?)\b/i },
      { label: "what_paper_viewing", pattern: /\bwhat\s+(?:papers?|docs?|documents?)\s+(?:am\s+i|are\s+we)\s+(?:viewing|reading|looking\s+at|on)\b/i },
      { label: "open_document", pattern: /\b(?:what|which)\s+(?:docs?|documents?|papers?)\s+(?:is|are)\s+(?:open|currently\s+open|active|current)\b/i },
      { label: "this_doc", pattern: /\b(?:this|that|these|those)\s+(?:docs?|documents?|papers?)\b/i },
    ],
  },
  {
    target: "active_note",
    reason: "explicit_active_note_target",
    confidence: 0.86,
    strength: "hard",
    requestedOutputs: [],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["active_doc_identity", "situation_context_question"],
    cues: [
      { label: "active_note", pattern: /\b(?:active|current|open)\s+note\b/i },
      { label: "note_target", pattern: /\b(?:this|that|my)\s+note\b/i },
    ],
  },
  {
    target: "process_graph",
    reason: "explicit_process_graph_source_target",
    confidence: 0.92,
    strength: "hard",
    requestedOutputs: ["process_overview"],
    allowClientShortcut: false,
    allowNoToolDirect: false,
    suppressedRoutes: ["situation_context_question", "visual_deictic", "active_doc_identity", "active_doc_summary", "model_only_concept"],
    cues: [
      { label: "process_graph", pattern: /\bprocess\s+graph\b/i },
      { label: "workstation_process_graph", pattern: /\bworkstation\s+(?:process\s+)?graph\b/i },
      { label: "workstation_state", pattern: /\bworkstation\s+state\b/i },
      { label: "panels_open", pattern: /\b(?:what|which)\s+panels\s+are\s+open\b/i },
      { label: "panels_open_status", pattern: /\b(?:what|which|show|list)\b[\s\S]{0,40}\b(?:open|active|visible)\s+panels\b/i },
      { label: "show_workstation_process_graph", pattern: /\bshow\b[\s\S]{0,80}\bworkstation\s+(?:process\s+)?graph\b/i },
    ],
  },
  {
    target: "workspace_panel",
    reason: "explicit_workspace_panel_target",
    confidence: 0.78,
    strength: "soft",
    requestedOutputs: ["process_overview"],
    targetKind: "workstation_state",
    allowClientShortcut: true,
    allowNoToolDirect: false,
    suppressedRoutes: [],
    cues: [
      { label: "workspace_panel", pattern: /\b(?:panel|workspace|workstation|tab|dock)\b/i },
      { label: "open_panel", pattern: /\b(?:open|show|switch\s+to)\b[\s\S]{0,80}\b(?:panel|workspace|workstation|tab|dock)\b/i },
    ],
  },
  {
    target: "model_only",
    reason: "explicit_model_only_target",
    confidence: 0.76,
    strength: "hard",
    requestedOutputs: [],
    targetKind: "general_background",
    allowClientShortcut: false,
    allowNoToolDirect: true,
    suppressedRoutes: ["active_doc_identity", "active_doc_summary", "situation_context_question"],
    cues: [
      { label: "no_workspace", pattern: /\b(?:don't|do\s+not)\s+(?:use|look\s+at|check|search|consult)\s+(?:the\s+)?(?:workspace|docs?|documents?|papers?|screen|visual|sources?)\b/i },
      { label: "without_workspace", pattern: /\bwithout\s+(?:using|checking|looking\s+at|searching|consulting)\s+(?:the\s+)?(?:workspace|workstation(?:\s+tools?)?|docs?|documents?|papers?|screen|visual|sources?)\b/i },
      { label: "general_question", pattern: /\bgeneral\s+(?:knowledge|reasoning)\b/i },
    ],
  },
];

const toSourceTargetIntent = (input: {
  turnId: string;
  threadId: string;
  target: HelixAskSourceTarget;
  targetKind?: HelixAskSourceTarget;
  strength: HelixAskSourceTargetStrength;
  explicitCues: string[];
  reasons: string[];
  requestedOutputs: HelixAskSourceTargetRequestedOutput[];
  suppressedRoutes: string[];
  precedenceReason: string;
  confidence: number;
  allowClientShortcut?: boolean;
  allowNoToolDirect?: boolean;
}): HelixAskSourceTargetIntent => {
  const hardSourceTarget =
    input.target !== "unknown" &&
    input.target !== "model_only" &&
    input.target !== "general_background";
  const mustEnterBackendAsk =
    hardSourceTarget &&
    input.allowNoToolDirect !== true;
  const allowClientShortcut = hardSourceTarget
    ? false
    : (input.allowClientShortcut ?? !mustEnterBackendAsk);
  const allowNoToolDirect = hardSourceTarget
    ? false
    : (input.allowNoToolDirect ?? !mustEnterBackendAsk);
  return {
    schema: HELIX_ASK_SOURCE_TARGET_INTENT_SCHEMA,
    turn_id: input.turnId,
    thread_id: input.threadId,
    target_source: input.target,
    target_kind: input.targetKind ?? input.target,
    strength: input.strength,
    explicit_cues: input.explicitCues,
    reasons: input.reasons,
    requested_outputs: Array.from(new Set(input.requestedOutputs)),
    suppressed_routes: input.suppressedRoutes,
    precedence_reason: input.precedenceReason,
    must_enter_backend_ask: mustEnterBackendAsk,
    allow_client_shortcut: allowClientShortcut,
    allow_no_tool_direct: allowNoToolDirect,
    confidence: input.confidence,
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const isHardDocsEvidenceSourceTargetIntent = (
  value: HelixAskSourceTargetIntent | Record<string, unknown> | null | undefined,
): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const requestedOutputs = Array.isArray(record.requested_outputs)
    ? record.requested_outputs.filter((entry): entry is string => typeof entry === "string")
    : [];
  const reasons = Array.isArray(record.reasons)
    ? record.reasons.filter((entry): entry is string => typeof entry === "string")
    : [];
  return (
    record.target_source === "docs_viewer" &&
    record.strength === "hard" &&
    (
      requestedOutputs.some((output) =>
        output === "file_path" ||
        output === "line_backed_source" ||
        output === "numeric_value_evidence" ||
        output === "doc_evidence_synthesis_answer"
      ) ||
      reasons.some((reason) =>
        reason === "explicit_docs_search_source_target" ||
        reason === "explicit_local_document_evidence_source_target" ||
        reason === "explicit_docs_path_compare_source_target" ||
        reason === "explicit_docs_path_locate_synthesis_source_target"
      )
    )
  );
};

const mapRepoRequestedOutputs = (
  outputs: ReturnType<typeof detectRepoCodeEvidenceIntent>["requestedOutputs"],
): HelixAskSourceTargetRequestedOutput[] =>
  outputs.flatMap((output: ReturnType<typeof detectRepoCodeEvidenceIntent>["requestedOutputs"][number]) => {
    if (output === "repo_code") return ["repo_code" as const];
    if (output === "file_path") return ["file_path" as const];
    if (output === "line_backed_source") return ["line_backed_source" as const];
    if (output === "implementation_location") return ["implementation_location" as const];
    if (output === "route_trace") return ["route_trace" as const];
    if (output === "tool_call_eligibility") return ["tool_call_eligibility" as const];
    if (output === "terminal_contract") return ["terminal_contract" as const];
    if (output === "codex_comparison") return ["codex_comparison" as const];
    return ["repo_code" as const];
  });

const isSituationEpochCue = (cue: string): boolean =>
  /epoch|changed|since|previous|compare|different|difference|visual|scene|frame|capture/i.test(cue);

const filterLivePipelineCues = (prompt: string, cues: string[]): string[] =>
  cues.filter((cue: string) => {
    if (cue !== "set_interval" && cue !== "capture_cadence") return true;
    return isLiveSourceCadenceControlPrompt(prompt);
  }).filter((cue: string) => {
    if (cue !== "start_live_source") return true;
    return !isContextualLiveSourceCadenceMention(prompt);
  });

const PROCEDURE_EPOCH_REQUESTED_OUTPUTS: HelixAskSourceTargetRequestedOutput[] = [
  "procedure_epoch_replay",
  "field_evaluation_refs",
  "interpretation_refs",
  "current_visual_state",
  "visual_scene_query_intent",
  "selected_visual_scene_set",
  "visual_scene_comparison_result",
  "typed_failure",
];

export function arbitrateAskSourceTarget(input: {
  turnId: string;
  threadId: string;
  promptText: string;
  activeWorkspaceSourceResolution?: HelixActiveWorkspaceSourceResolution | Record<string, unknown> | null;
  trustedEnvironmentContext?: ExplicitCapabilityExtractionContext | null;
}): HelixAskSourceTargetIntent {
  const prompt = input.promptText.trim();
  const retainedEvidenceContinuation =
    hasRetainedEvidenceContinuationCue(prompt) &&
    !hasExplicitFreshDocsAccessCue(prompt);
  const contextualProcedureRecall =
    isContextualProcedureRecallPrompt(prompt);
  if (isAffirmativeTheoryFormalArtifactInspectionPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "theory_locator",
      targetKind: "theory_formal_artifact_family",
      strength: "hard",
      explicitCues: ["affirmative_theory_formal_artifact_inspection"],
      reasons: ["registered_formal_artifact_inspection_source_target"],
      requestedOutputs: [
        "theory_formal_artifact_family_audit_observation",
        "model_synthesized_answer",
        "typed_failure",
      ],
      suppressedRoutes: ["model_only_concept", "no_tool_direct"],
      precedenceReason: "registered_formal_artifact_inspection_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isAffirmativeBrokerageEnvironmentReadPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["affirmative_brokerage_environment_read"],
      reasons: [
        "brokerage_read_requires_authenticated_private_room_gateway",
        "brokerage_observation_requires_current_identity_and_freshness",
      ],
      requestedOutputs: [
        "field_evaluation_refs",
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "workspace_directory",
        "workspace_panel",
        "internet_search_lookup",
        "model_only_answer",
        "no_tool_direct",
      ],
      precedenceReason: "affirmative_brokerage_environment_read",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isAffirmativeMinecraftDurableGoalCreatePrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["affirmative_minecraft_durable_goal_create"],
      reasons: [
        "minecraft_durable_goal_requires_authenticated_environment_gateway",
        "durable_goal_strategy_and_arguments_owned_by_runtime_codex",
      ],
      requestedOutputs: ["tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "workspace_panel",
        "world_event_current_state",
        "model_only_answer",
        "no_tool_direct",
      ],
      precedenceReason: "affirmative_minecraft_durable_goal_create",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isAffirmativeEnvironmentReasoningRoleInspectPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["affirmative_environment_reasoning_role_inspect"],
      reasons: [
        "environment_reasoning_role_ledger_requires_authenticated_room_gateway",
        "g6_role_ledger_is_distinct_from_durable_goal_projection",
      ],
      requestedOutputs: ["tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "workspace_panel",
        "workspace_diagnostic",
        "world_event_current_state",
        "internet_search_lookup",
        "model_only_answer",
        "no_tool_direct",
      ],
      precedenceReason: "affirmative_environment_reasoning_role_inspect",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isAffirmativeMinecraftDurableGoalInspectPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["affirmative_minecraft_durable_goal_inspect"],
      reasons: [
        "minecraft_durable_goal_requires_authenticated_environment_gateway",
        "durable_goal_resume_requires_canonical_identity_bound_projection",
      ],
      requestedOutputs: ["tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "workspace_panel",
        "workspace_diagnostic",
        "world_event_current_state",
        "model_only_answer",
        "no_tool_direct",
      ],
      precedenceReason: "affirmative_minecraft_durable_goal_inspect",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isMinecraftSituationSessionSetupPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "workspace_panel",
      targetKind: "workspace_panel",
      strength: "hard",
      explicitCues: ["minecraft_situation_session_setup"],
      reasons: ["minecraft_situation_session_setup_is_action_not_evidence"],
      requestedOutputs: [],
      suppressedRoutes: [
        "world_event_current_state",
        "live_environment_current_state",
        "model_only_answer",
      ],
      precedenceReason:
        "minecraft_situation_session_setup_is_action_not_evidence",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  // An operative Player Embodiment request owns the primary source target even
  // when a negative safety clause mentions Minecraft commands. Mechanics docs
  // may still be admitted later as non-terminal grounding for a genuinely
  // mixed request; they must not replace the environment action itself.
  if (
    isMinecraftMechanicsDocsPrompt(prompt) &&
    !isAffirmativeMinecraftPlayerEmbodimentActionPrompt(
      prompt,
      input.trustedEnvironmentContext,
    )
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["minecraft_environment_mechanics_docs_lookup"],
      reasons: [
        "minecraft_environment_mechanics_docs_source_target",
        "mechanics_lookup_is_non_mutating_document_evidence",
      ],
      requestedOutputs: [
        "file_path",
        "line_backed_source",
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "internet_search_lookup",
        "scholarly_research_lookup",
        "world_event_current_state",
        "live_environment_current_state",
        "workstation_action",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "minecraft_environment_mechanics_docs_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (
    isAffirmativeMinecraftPlayerEmbodimentActionPrompt(
      prompt,
      input.trustedEnvironmentContext,
    )
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["operative_minecraft_player_embodiment_action"],
      reasons: [
        "explicit_minecraft_player_embodiment_source_target",
        "player_action_capability_selection_owned_by_runtime",
      ],
      requestedOutputs: [
        "field_evaluation_refs",
        "interpretation_refs",
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "world_event_current_state",
        "internet_search_lookup",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason:
        "explicit_minecraft_player_embodiment_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const explicitMinecraftEnvironmentCapabilities =
    extractExplicitCapabilityContracts(
      prompt,
      input.trustedEnvironmentContext,
    ).filter(
      ({ capability, contract, source }) =>
        [
          "natural_capability_intent",
          "command_mention",
          "compound_command_chain",
        ].includes(source) &&
        contract.source_target === "live_environment" &&
        capability.startsWith("com.casimirbot.minecraft."),
    );
  if (explicitMinecraftEnvironmentCapabilities.length > 0) {
    const capabilities = Array.from(
      new Set(
        explicitMinecraftEnvironmentCapabilities.map(
          ({ capability }) => capability,
        ),
      ),
    );
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: capabilities.map(
        (capability) => `explicit_capability:${capability}`,
      ),
      reasons: [
        "explicit_minecraft_environment_capability_source_target",
        ...capabilities,
      ],
      requestedOutputs: [
        "field_evaluation_refs",
        "interpretation_refs",
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "world_event_current_state",
        "internet_search_lookup",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason:
        "explicit_minecraft_environment_capability_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (
    isAffirmativeImmediateMinecraftSituationPrompt(prompt) &&
    (input.trustedEnvironmentContext?.trusted_environment_domain ===
      "minecraft" ||
      /\b(?:minecraft|fabric|minehut|mine\s*hut)\b/i.test(prompt))
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["affirmative_minecraft_situation_observation"],
      reasons: ["affirmative_minecraft_situation_source_target"],
      requestedOutputs: [
        "field_evaluation_refs",
        "interpretation_refs",
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "world_event_current_state",
        "internet_search_lookup",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "affirmative_minecraft_situation_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isMinecraftCommandNonExecutionDiscussionPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "model_only",
      targetKind: "general_background",
      strength: "hard",
      explicitCues: ["minecraft_command_non_execution_discussion"],
      reasons: [
        "minecraft_command_non_execution_discussion_is_not_execution",
      ],
      requestedOutputs: [],
      suppressedRoutes: [
        "world_event_current_state",
        "live_environment_current_state",
        "workstation_action",
      ],
      precedenceReason:
        "minecraft_command_non_execution_discussion_is_not_execution",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: true,
    });
  }
  const evidenceTargetArbitration = buildAskEvidenceTargetArbitration({
    turnId: input.turnId,
    threadId: input.threadId,
    promptText: prompt,
  });
  const selectedEvidenceCandidate = evidenceTargetArbitration.evidence_target_candidates.find(
    (candidate) => candidate.candidate_id === evidenceTargetArbitration.selected_candidate_id,
  );
  const scientificImageContinuityRequested =
    asksForScientificImageEvidenceContinuity(prompt);
  if (
    scientificImageContinuityRequested ||
    asksForScientificImageTextEvidenceComparison(prompt)
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "scientific_image_evidence",
      targetKind: "scientific_image_evidence",
      strength: "hard",
      explicitCues: [
        scientificImageContinuityRequested
          ? "affirmative_retained_scientific_image_evidence_continuity"
          : "affirmative_scientific_image_text_comparison",
      ],
      reasons: [
        scientificImageContinuityRequested
          ? "retained_scientific_image_evidence_identity_requested"
          : "retained_machine_readable_text_and_image_lens_comparison_requested",
        scientificImageContinuityRequested
          ? "retained_sidecar_reentry_precedes_scholarly_intent"
          : "affirmative_comparison_precedes_contextual_non_promotion_clause",
      ],
      requestedOutputs: ["current_visual_state", "typed_failure"],
      suppressedRoutes: [
        "model_only_concept",
        "no_tool_direct",
        "fresh_image_lens_capture",
        "client_shortcut",
      ],
      precedenceReason: scientificImageContinuityRequested
        ? "affirmative_retained_scientific_image_evidence_continuity"
        : "affirmative_scientific_image_text_comparison",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isHistoricalRuntimeEvidencePrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "runtime_evidence",
      targetKind: "runtime_evidence",
      strength: "hard",
      explicitCues: ["historical_runtime_evidence", "historical_tool_call_diagnosis"],
      reasons: ["historical_runtime_evidence_source_target", "previous_turn_tool_call_question"],
      requestedOutputs: ["route_trace", "tool_call_eligibility", "terminal_contract", "typed_failure"],
      suppressedRoutes: [
        "live_pipeline_control",
        "visual_frame_evidence",
        "situation_context_question",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "historical_runtime_evidence_source_target",
      confidence: 0.92,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const procedureRecallRule = matchProcedureRecallPrompt(prompt);
  if (procedureRecallRule) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: procedureRecallTargetSource(procedureRecallRule),
      targetKind: procedureRecallRule.target_kind,
      strength: "hard",
      explicitCues: [procedureRecallRule.cue],
      reasons: ["hard_procedure_memory_recall_prompt", procedureRecallRule.cue],
      requestedOutputs: procedureRecallRule.requested_outputs,
      suppressedRoutes: [...PROCEDURE_RECALL_SUPPRESSED_ROUTES],
      precedenceReason: "hard_procedure_memory_recall_prompt",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isWorkspaceOsStatusPrompt(prompt)) {
    const reasonCodes = workspaceOsStatusReasonCodes(prompt);
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "workspace_diagnostic",
      targetKind: "workspace_diagnostic",
      strength: "hard",
      explicitCues: reasonCodes,
      reasons: ["workspace_os_status_source_target", ...reasonCodes],
      requestedOutputs: ["workspace_os_status", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "workspace_action_receipt",
        "workstation_action",
        "workspace_panel",
        "client_projection",
        "panel_generated_answer",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "workspace_os_status_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const affirmativeTheoryReflection = isAffirmativeTheoryBadgeGraphReflectionPrompt(prompt);
  if (affirmativeTheoryReflection || isTheoryBadgeGraphCurrentContextPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "theory_locator",
      targetKind: "theory_locator",
      strength: "hard",
      explicitCues: affirmativeTheoryReflection
        ? ["affirmative_theory_badge_graph_reflection"]
        : ["current_theory_badge_graph_selection"],
      reasons: [
        affirmativeTheoryReflection
          ? "affirmative_theory_badge_graph_reflection_source_target"
          : "theory_badge_graph_current_context_source_target",
        affirmativeTheoryReflection
          ? "theory_reflection_requires_bounded_graph_observation"
          : "deictic_badge_selection_requires_bounded_workstation_observation",
      ],
      requestedOutputs: ["theory_context_reflection", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "model_only_concept",
        "no_tool_direct",
        "client_projection",
        "panel_generated_answer",
      ],
      precedenceReason: affirmativeTheoryReflection
        ? "affirmative_theory_badge_graph_reflection_source_target"
        : "theory_badge_graph_current_context_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isCalculatorSolvePrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "calculator_stream",
      targetKind: "calculator_stream",
      strength: "hard",
      explicitCues: ["scientific_calculator_solve"],
      reasons: ["calculator_tool_source_target", "scientific_calculator_solve_phrase"],
      requestedOutputs: ["tool_call_eligibility", "typed_failure"],
      suppressedRoutes: ["active_doc_identity", "active_doc_summary", "doc_open_best", "situation_context_question", "visual_deictic", "visual_frame_evidence", "model_only_concept", "no_tool_direct"],
      precedenceReason: "calculator_tool_source_target",
      confidence: 0.95,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const liveSourceContinuationIntent = classifyLiveSourceContinuationIntent(prompt);
  if (liveSourceContinuationIntent) {
    const bindingDiagnosis = liveSourceContinuationIntent.kind === "live_environment_binding_diagnosis";
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_pipeline",
      targetKind: "live_pipeline",
      strength: "hard",
      explicitCues: [liveSourceContinuationIntent.kind],
      reasons: [
        "live_source_continuation_intent_source_target",
        liveSourceContinuationIntent.reason,
      ],
      requestedOutputs: bindingDiagnosis
        ? ["typed_failure"]
        : ["live_pipeline_receipt", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "visual_frame_evidence",
        "situation_context_question",
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "live_source_continuation_intent_source_target",
      confidence: liveSourceContinuationIntent.confidence === "high" ? 0.98 : 0.9,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isDeicticDocsIdentityPrompt(prompt) && !retainedEvidenceContinuation) {
    const activeWorkspaceResolution = input.activeWorkspaceSourceResolution as Record<string, unknown> | null | undefined;
    const sourceBound =
      typeof activeWorkspaceResolution?.active_doc_path === "string" &&
      activeWorkspaceResolution.active_doc_path.trim().length > 0;
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "active_doc",
      targetKind: "active_doc",
      strength: "hard",
      explicitCues: ["active_doc_identity"],
      reasons: [
        "active_doc_identity_source_target",
        "deictic_doc_identity_suppresses_evidence_target_freshness",
        sourceBound ? "active_doc_path_bound_from_workspace_snapshot" : "active_doc_path_required",
      ],
      requestedOutputs: ["file_path", "typed_failure"],
      suppressedRoutes: ["internet_search_lookup", "scholarly_research_lookup", "repo_code_evidence_question", "situation_context_question", "visual_deictic", "visual_frame_evidence", "model_only_concept", "no_tool_direct"],
      precedenceReason: "active_doc_identity_source_target",
      confidence: sourceBound ? 0.99 : 0.94,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const explicitDocsOperationSelected =
    isExplicitDocsPathComparePrompt(prompt) ||
    isExplicitDocsPathLocateSynthesisPrompt(prompt) ||
    isExplicitDocsPathSummaryPrompt(prompt) ||
    isCurrentOpenDocsViewerSummaryPrompt(prompt) ||
    isAskTurnDocsTopicSummaryPrompt(prompt) ||
    isAffirmativeDocsSearchPrompt(prompt);
  const nonOperationalDocumentReference =
    /\b(?:white\s*paper|whitepaper|paper|doc(?:ument)?|docs?|report|memo)\b/i.test(prompt) &&
    !explicitDocsOperationSelected;
  const namedDocSummaryQuery = resolveAskTurnNamedDocSummaryQueryArg(prompt);
  const topicDocSummaryQuery = namedDocSummaryQuery ? null : resolveAskTurnTopicDocQueryArg(prompt);
  const namedDocRelationPrompt = isAskTurnNamedDocRelationPrompt(prompt);
  const authoritativeDocsTopic = resolveAuthoritativeDocsTopicMatch(prompt);
  if (namedDocSummaryQuery) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["named_doc_summary", namedDocSummaryQuery],
      reasons: ["named_doc_summary_source_target", "named_document_title_suppresses_repo_entity_inference"],
      requestedOutputs: ["file_path", "doc_summary", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "internet_search_lookup",
        "scholarly_research_lookup",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "named_doc_summary_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isNaturalLocalDocumentLookupPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["natural_local_document_lookup"],
      reasons: [
        "natural_local_document_lookup_source_target",
        "explicit_local_document_scope_suppresses_repo_entity_inference",
      ],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "internet_search_lookup",
        "scholarly_research_lookup",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "natural_local_document_lookup_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (
    authoritativeDocsTopic &&
    buildToolUseRestatement(prompt).requiredToolFamilies.includes("docs_viewer") &&
    !(
      selectedEvidenceCandidate?.strength === "hard" &&
      selectedEvidenceCandidate.target_source !== "docs_viewer"
    )
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: [
        "authoritative_docs_topic",
        authoritativeDocsTopic.topic_id,
        authoritativeDocsTopic.primary_path,
      ],
      reasons: [
        "authoritative_docs_topic_source_target",
        "taxonomy_primary_suppresses_soft_repo_and_freshness_inference",
      ],
      requestedOutputs: [
        "file_path",
        "line_backed_source",
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "internet_search_lookup",
        "scholarly_research_lookup",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "authoritative_docs_topic_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (topicDocSummaryQuery && isAskTurnDocsTopicSummaryPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: [
        namedDocRelationPrompt
          ? "named_doc_relation"
          : "natural_docs_topic_summary",
        topicDocSummaryQuery,
      ],
      reasons: [
        namedDocRelationPrompt
          ? "named_doc_relation_source_target"
          : "natural_docs_topic_summary_source_target",
        "explicit_docs_scope_suppresses_model_only_concept",
      ],
      requestedOutputs: [
        "file_path",
        "doc_summary",
        ...(namedDocRelationPrompt ? (["line_backed_source"] as const) : []),
        "tool_call_eligibility",
        "typed_failure",
      ],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "internet_search_lookup",
        "scholarly_research_lookup",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: namedDocRelationPrompt
        ? "named_doc_relation_source_target"
        : "natural_docs_topic_summary_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (
    !isExplicitDocsPathComparePrompt(prompt) &&
    !isExplicitDocsPathLocateSynthesisPrompt(prompt) &&
    !isExplicitDocsPathSummaryPrompt(prompt) &&
    !isCurrentOpenDocsViewerSummaryPrompt(prompt) &&
    !isAskTurnDocsTopicSummaryPrompt(prompt) &&
    selectedEvidenceCandidate?.target_source !== "scholarly_research" &&
    isAffirmativeDocsSearchPrompt(prompt)
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["docs_search"],
      reasons: ["explicit_docs_search_source_target", "local_docs_scope_suppresses_freshness_search"],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: ["internet_search_lookup", "scholarly_research_lookup", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "explicit_docs_search_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (selectedEvidenceCandidate?.target_source === "docs_viewer" && !explicitDocsOperationSelected) {
    const localDocumentEvidence = isAffirmativeLocalDocumentEvidencePrompt(prompt);
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: selectedEvidenceCandidate.strength,
      explicitCues: selectedEvidenceCandidate.reason_codes,
      reasons: [
        localDocumentEvidence
          ? "explicit_local_document_evidence_source_target"
          : "evidence_target_arbitration_selected_docs_viewer",
        ...selectedEvidenceCandidate.reason_codes,
      ],
      requestedOutputs: selectedEvidenceCandidate.requested_outputs.length > 0
        ? selectedEvidenceCandidate.requested_outputs
        : ["file_path", "line_backed_source", "typed_failure"],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "internet_search_lookup",
        "scholarly_research_lookup",
        "live_source_mailbox",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: localDocumentEvidence
        ? "explicit_local_document_evidence_source_target"
        : "evidence_target_arbitration_selected_docs_viewer",
      confidence: selectedEvidenceCandidate.score,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (
    selectedEvidenceCandidate?.target_source === "repo_code" &&
    !(selectedEvidenceCandidate.strength === "soft" && nonOperationalDocumentReference)
  ) {
    const repoPrecedenceReason =
      selectedEvidenceCandidate.strength === "hard"
        ? "explicit_repo_code_source_target"
        : "project_local_entity_source_target";
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "repo_code",
      targetKind: "repo_code",
      strength: selectedEvidenceCandidate.strength,
      explicitCues: selectedEvidenceCandidate.reason_codes,
      reasons: [
        repoPrecedenceReason,
        ...selectedEvidenceCandidate.reason_codes,
      ],
      requestedOutputs: selectedEvidenceCandidate.requested_outputs.length > 0
        ? selectedEvidenceCandidate.requested_outputs
        : ["repo_code", "file_path"],
      suppressedRoutes: [
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "active_doc_summary",
        "active_note",
        "doc_open_best",
        "live_environment_review",
      ],
      precedenceReason: repoPrecedenceReason,
      confidence: selectedEvidenceCandidate.score,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (selectedEvidenceCandidate?.target_source === "scholarly_research") {
    const compoundLocalDocsComparison =
      selectedEvidenceCandidate.candidate_id ===
      "scholarly_research.local_docs_comparison";
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "scholarly_research",
      targetKind: "scholarly_research",
      strength: selectedEvidenceCandidate.strength,
      explicitCues: selectedEvidenceCandidate.reason_codes,
      reasons: [
        "evidence_target_arbitration_selected_scholarly_research",
        ...selectedEvidenceCandidate.reason_codes,
      ],
      requestedOutputs: selectedEvidenceCandidate.requested_outputs,
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        ...(compoundLocalDocsComparison ? [] : ["docs_viewer_receipt"]),
        "repo_code_evidence_question",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "evidence_target_arbitration_selected_scholarly_research",
      confidence: selectedEvidenceCandidate.score,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (selectedEvidenceCandidate?.target_source === "internet_search") {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "internet_search",
      targetKind: "internet_search",
      strength: selectedEvidenceCandidate.strength,
      explicitCues: selectedEvidenceCandidate.reason_codes,
      reasons: [
        "evidence_target_arbitration_selected_internet_search",
        ...selectedEvidenceCandidate.reason_codes,
      ],
      requestedOutputs: selectedEvidenceCandidate.requested_outputs,
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "docs_viewer_receipt",
        "repo_code_evidence_question",
        "scholarly_research_lookup",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "evidence_target_arbitration_selected_internet_search",
      confidence: selectedEvidenceCandidate.score,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const selectedEvidenceTargetSource = selectedEvidenceCandidate?.target_source ?? evidenceTargetArbitration.selected_target_source;
  const stagePlayLiveEnvironmentAdmitted = selectedEvidenceTargetSource === "live_environment";
  if (stagePlayLiveEnvironmentAdmitted && isStagePlayCheckpointRequestPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["stage_play_checkpoint_request"],
      reasons: ["explicit_stage_play_checkpoint_request_source_target"],
      requestedOutputs: [
        "stage_play_checkpoint_request",
        "stage_play_checkpoint_queue",
        "stage_play_badge_graph",
        "typed_failure",
      ],
      suppressedRoutes: [
        "visual_deictic",
        "visual_frame_evidence",
        "visual_capture_describe",
        "live_pipeline_control",
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_stage_play_checkpoint_request_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (stagePlayLiveEnvironmentAdmitted && isStagePlayJobPlanningPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["stage_play_job_planning"],
      reasons: ["explicit_stage_play_job_planning_source_target"],
      requestedOutputs: [
        "stage_play_job_plan",
        "stage_play_builder_catalog",
        "stage_play_source_query",
        "typed_failure",
      ],
      suppressedRoutes: [
        "visual_deictic",
        "visual_frame_evidence",
        "visual_capture_describe",
        "live_pipeline_control",
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_stage_play_job_planning_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (stagePlayLiveEnvironmentAdmitted && isStagePlayReflectionPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_environment",
      targetKind: "live_environment",
      strength: "hard",
      explicitCues: ["stage_play_reflection"],
      reasons: ["explicit_stage_play_reflection_source_target"],
      requestedOutputs: [
        "stage_play_badge_graph",
        "stage_play_output_lane_projection",
        "stage_play_live_answer_projection",
        "typed_failure",
      ],
      suppressedRoutes: [
        "visual_deictic",
        "visual_frame_evidence",
        "visual_capture_describe",
        "live_pipeline_control",
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_stage_play_reflection_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isExplicitDocsPathComparePrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["explicit_docs_path_compare"],
      reasons: ["explicit_docs_path_compare_source_target", "local_docs_path_suppresses_repo_code", "exact_docs_path_operation_precedes_live_source_mailbox"],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: ["repo_code_evidence_question", "internet_search_lookup", "scholarly_research_lookup", "live_source_mailbox", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "explicit_docs_path_compare_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isExplicitDocsPathLocateSynthesisPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["explicit_docs_path_locate_synthesis"],
      reasons: ["explicit_docs_path_locate_synthesis_source_target", "local_docs_path_suppresses_repo_code", "exact_docs_path_operation_precedes_live_source_mailbox"],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: ["repo_code_evidence_question", "internet_search_lookup", "scholarly_research_lookup", "live_source_mailbox", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "explicit_docs_path_locate_synthesis_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isLiveSourceMailLoopPrompt(prompt) && !isLiveSourceCadenceControlPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "live_source_mailbox",
      targetKind: "live_source_mailbox",
      strength: "hard",
      explicitCues: ["live_source_mail_loop"],
      reasons: ["explicit_live_source_mail_loop_source_target"],
      requestedOutputs: [
        "live_environment_tool_observation",
        "stage_play_live_source_mail_read_result",
        "stage_play_live_source_mail_decision",
        "stage_play_live_source_narrative_state",
        "stage_play_live_source_interpreter_profile",
        "stage_play_live_source_interpreter_profile_comparison",
        "typed_failure",
      ],
      suppressedRoutes: [
        "visual_deictic",
        "visual_frame_evidence",
        "visual_capture_describe",
        "live_pipeline_control",
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_live_source_mail_loop_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isLiveCaptureContentPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "visual_capture",
      targetKind: "visual_capture",
      strength: "hard",
      explicitCues: ["live_capture_content"],
      reasons: [
        "explicit_live_capture_content_source_target",
        "live_capture_content",
      ],
      requestedOutputs: [
        "current_visual_state",
        "field_evaluation_refs",
        "interpretation_refs",
        "typed_failure",
      ],
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "live_pipeline_control",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_live_capture_content_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const activeWorkspaceEvidenceFollowup =
    input.activeWorkspaceSourceResolution?.schema === "helix.active_workspace_source_resolution.v1" &&
    input.activeWorkspaceSourceResolution.resolved_source_target === "active_doc" &&
    input.activeWorkspaceSourceResolution.reason === "active_doc_evidence_followup";
  if (activeWorkspaceEvidenceFollowup && !isExplicitModelOnlyPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "active_doc",
      targetKind: "active_doc",
      strength: "hard",
      explicitCues: ["active_doc_evidence_followup"],
      reasons: ["active_workspace_source_resolution", "active_doc_evidence_followup"],
      requestedOutputs: ["file_path", "line_backed_source", "doc_evidence_synthesis_answer", "typed_failure"],
      suppressedRoutes: [
        "internet_search_lookup",
        "scholarly_research_lookup",
        "repo_code_evidence_question",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "active_doc_evidence_followup_source_target",
      confidence: input.activeWorkspaceSourceResolution.confidence,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const modelOnlyConceptSourceSignal = detectModelOnlyConceptSourceSignal(prompt);
  const scholarlyResearchIntent = detectScholarlyResearchIntent(prompt);
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  const narrowerScholarlySearchSuppression =
    /^(?:internet_search\.web_research|scholarly-research\.lookup_papers)$/i.test(
      contextualSuppression?.verb_or_cue ?? "",
    );
  const admittedScholarlySource =
    scholarlyResearchIntent.researchRequested &&
    (
      !contextualToolSuppressionBlocksFamily(contextualSuppression, "scholarly_research") ||
      (scholarlyResearchIntent.fullTextRequested && narrowerScholarlySearchSuppression)
    );
  if (modelOnlyConceptSourceSignal.should_prefer_model_only_concept && !admittedScholarlySource) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "model_only",
      targetKind: "general_background",
      strength: "soft",
      explicitCues: modelOnlyConceptSourceSignal.reason_codes,
      reasons: ["model_only_concept_source_guard", ...modelOnlyConceptSourceSignal.reason_codes],
      requestedOutputs: [],
      suppressedRoutes: ["repo_code_evidence_question", "visual_deictic", "visual_frame_evidence", "visual_capture_describe"],
      precedenceReason: "model_only_concept_source_guard",
      confidence: 0.84,
      allowClientShortcut: false,
      allowNoToolDirect: true,
    });
  }
  if (isExplicitModelOnlyPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "model_only",
      targetKind: "general_background",
      strength: "hard",
      explicitCues: ["explicit_model_only"],
      reasons: ["explicit_model_only_target", "negative_workspace_scope"],
      requestedOutputs: [],
      suppressedRoutes: ["active_doc_identity", "active_doc_summary", "situation_context_question", "visual_deictic", "visual_frame_evidence"],
      precedenceReason: "explicit_model_only_target",
      confidence: 0.9,
      allowClientShortcut: false,
      allowNoToolDirect: true,
    });
  }
  if (scholarlyResearchIntent.researchRequested) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "scholarly_research",
      targetKind: "scholarly_research",
      strength: scholarlyResearchIntent.strength,
      explicitCues: scholarlyResearchIntent.explicitCues,
      reasons: scholarlyResearchIntent.reasons,
      requestedOutputs: scholarlyResearchIntent.requestedOutputs,
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "docs_viewer_receipt",
        "repo_code_evidence_question",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "external_scholarly_research_source_target",
      confidence: scholarlyResearchIntent.strength === "hard" ? 0.96 : 0.86,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const toolUseRestatement = buildToolUseRestatement(prompt);
  const internetSearchIntent = detectInternetSearchIntent(prompt);
  if (isExplicitDocsPathComparePrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["explicit_docs_path_compare"],
      reasons: ["explicit_docs_path_compare_source_target", "local_docs_path_suppresses_repo_code"],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: ["repo_code_evidence_question", "internet_search_lookup", "scholarly_research_lookup", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "explicit_docs_path_compare_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isExplicitDocsPathLocateSynthesisPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["explicit_docs_path_locate_synthesis"],
      reasons: ["explicit_docs_path_locate_synthesis_source_target", "local_docs_path_suppresses_repo_code"],
      requestedOutputs: ["file_path", "tool_call_eligibility", "typed_failure"],
      suppressedRoutes: ["repo_code_evidence_question", "internet_search_lookup", "scholarly_research_lookup", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "explicit_docs_path_locate_synthesis_source_target",
      confidence: 0.99,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isExplicitDocsPathSummaryPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["explicit_docs_path_summary"],
      reasons: ["explicit_docs_path_summary_source_target", "local_docs_path_suppresses_freshness_search"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      suppressedRoutes: ["internet_search_lookup", "scholarly_research_lookup", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "explicit_docs_path_summary_source_target",
      confidence: 0.98,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isCurrentOpenDocsViewerSummaryPrompt(prompt)) {
    const activeWorkspaceResolution = input.activeWorkspaceSourceResolution as Record<string, unknown> | null | undefined;
    const sourceBound =
      typeof activeWorkspaceResolution?.active_doc_path === "string" &&
      activeWorkspaceResolution.active_doc_path.trim().length > 0;
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "active_doc",
      targetKind: "active_doc",
      strength: "hard",
      explicitCues: ["active_docs_viewer_summary"],
      reasons: [
        "active_docs_viewer_summary_source_target",
        sourceBound ? "active_doc_path_bound_from_workspace_snapshot" : "active_doc_path_required",
      ],
      requestedOutputs: ["file_path", "doc_summary", "typed_failure"],
      suppressedRoutes: ["internet_search_lookup", "scholarly_research_lookup", "repo_code_evidence_question", "situation_context_question", "visual_deictic", "visual_frame_evidence", "model_only_concept", "no_tool_direct"],
      precedenceReason: "active_docs_viewer_summary_source_target",
      confidence: sourceBound ? 0.99 : 0.94,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isAskTurnDocsTopicSummaryPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["docs_topic_summary"],
      reasons: ["docs_topic_summary_source_target", "local_docs_scope_suppresses_freshness_search"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      suppressedRoutes: ["internet_search_lookup", "scholarly_research_lookup", "situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "docs_topic_summary_source_target",
      confidence: 0.94,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isAffirmativeLocalDocumentEvidencePrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["local_document_evidence", "whitepaper_or_document_value_lookup"],
      reasons: [
        "explicit_local_document_evidence_source_target",
        "local_document_value_lookup_suppresses_model_only",
      ],
      requestedOutputs: ["file_path", "line_backed_source", "doc_evidence_synthesis_answer", "typed_failure"],
      suppressedRoutes: [
        "internet_search_lookup",
        "scholarly_research_lookup",
        "repo_code_evidence_question",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_local_document_evidence_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isDeicticDocsIdentityPrompt(prompt) && !retainedEvidenceContinuation) {
    const activeWorkspaceResolution = input.activeWorkspaceSourceResolution as Record<string, unknown> | null | undefined;
    const sourceBound =
      typeof activeWorkspaceResolution?.active_doc_path === "string" &&
      activeWorkspaceResolution.active_doc_path.trim().length > 0;
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "active_doc",
      targetKind: "active_doc",
      strength: "hard",
      explicitCues: ["active_doc_identity"],
      reasons: [
        "active_doc_identity_source_target",
        "deictic_doc_identity_suppresses_freshness_search",
        sourceBound ? "active_doc_path_bound_from_workspace_snapshot" : "active_doc_path_required",
      ],
      requestedOutputs: ["file_path", "typed_failure"],
      suppressedRoutes: ["internet_search_lookup", "scholarly_research_lookup", "repo_code_evidence_question", "situation_context_question", "visual_deictic", "visual_frame_evidence", "model_only_concept", "no_tool_direct"],
      precedenceReason: "active_doc_identity_source_target",
      confidence: sourceBound ? 0.99 : 0.94,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (internetSearchIntent.searchRequested) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "internet_search",
      targetKind: "internet_search",
      strength: toolUseRestatement.currentAffairsRequired || toolUseRestatement.freshnessRequired
        ? "hard"
        : internetSearchIntent.strength,
      explicitCues: [
        ...internetSearchIntent.explicitCues,
        ...(toolUseRestatement.freshnessRequired ? ["tool_use_restatement:freshness_required"] : []),
        ...(toolUseRestatement.currentAffairsRequired ? ["tool_use_restatement:current_affairs_required"] : []),
      ],
      reasons: [
        ...internetSearchIntent.reasons,
        ...(toolUseRestatement.requiredToolFamilies.includes("internet_search")
          ? ["tool_use_restatement_requires_internet_search"]
          : []),
      ],
      requestedOutputs: internetSearchIntent.requestedOutputs,
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "docs_viewer_receipt",
        "repo_code_evidence_question",
        "scholarly_research_lookup",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "external_internet_search_source_target",
      confidence: internetSearchIntent.strength === "hard" ? 0.94 : 0.82,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isDocsPanelOpenPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["docs_panel_open"],
      reasons: ["docs_panel_open_source_target", "open_docs_panel_phrase"],
      requestedOutputs: ["file_path"],
      suppressedRoutes: ["situation_context_question", "visual_deictic", "visual_frame_evidence", "doc_open_best", "model_only_concept"],
      precedenceReason: "docs_panel_open_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isLiveCaptureContentPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "visual_capture",
      targetKind: "visual_capture",
      strength: "hard",
      explicitCues: ["live_capture_content"],
      reasons: [
        "explicit_live_capture_content_source_target",
        "live_capture_content",
      ],
      requestedOutputs: [
        "current_visual_state",
        "field_evaluation_refs",
        "interpretation_refs",
        "typed_failure",
      ],
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "live_pipeline_control",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "explicit_live_capture_content_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isStructuredDocsViewerPrompt(prompt)) {
    const docsRule = rules.find((rule: CueRule) => rule.target === "docs_viewer");
    if (docsRule) {
      const explicitCues = matches(prompt, docsRule.cues);
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target: docsRule.target,
        targetKind: docsRule.targetKind,
        strength: docsRule.strength,
        explicitCues,
        reasons: [docsRule.reason, ...explicitCues],
        requestedOutputs: docsRule.requestedOutputs,
        suppressedRoutes: docsRule.suppressedRoutes,
        precedenceReason: docsRule.reason,
        confidence: docsRule.confidence,
        allowClientShortcut: docsRule.allowClientShortcut,
        allowNoToolDirect: docsRule.allowNoToolDirect,
      });
    }
  }
  if (
    isDocsOpenAndSummarizePrompt(prompt) &&
    !contextualToolSuppressionBlocksFamily(detectContextualToolAdmissionSuppression(prompt), "docs_viewer")
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["docs_open_and_summary"],
      reasons: ["docs_open_and_summary_source_target", "docs_summary_requires_document_tool_path"],
      requestedOutputs: ["file_path", "tool_call_eligibility"],
      suppressedRoutes: ["situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept", "no_tool_direct"],
      precedenceReason: "docs_open_and_summary_source_target",
      confidence: 0.97,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isExplicitDocumentAcquisitionPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "docs_viewer",
      targetKind: "docs_viewer",
      strength: "hard",
      explicitCues: ["doc_open_best"],
      reasons: ["explicit_document_acquisition_source_target", "open_document_from_docs_phrase"],
      requestedOutputs: ["file_path"],
      suppressedRoutes: ["situation_context_question", "visual_deictic", "visual_frame_evidence", "active_doc_identity", "model_only_concept"],
      precedenceReason: "explicit_document_acquisition_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isLiveAnswerEnvironmentStatePrompt(prompt)) {
    const calculatorLiveState = /\b(?:calculator|equation|result|threshold|cross(?:ed|es|ing)?)\b/i.test(prompt);
    const target = calculatorLiveState ? "calculator_stream" : "live_pipeline";
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target,
      targetKind: target,
      strength: "hard",
      explicitCues: ["live_answer_environment_state"],
      reasons: ["live_answer_environment_state_source_target"],
      requestedOutputs: ["tool_call_eligibility", "typed_failure"],
      suppressedRoutes: [
        "repo_code_evidence_question",
        "active_doc_identity",
        "active_doc_summary",
        "doc_open_best",
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "live_answer_environment_state_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isDocsViewerTopicLabelPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "unknown",
      targetKind: "unknown",
      strength: "none",
      explicitCues: ["docs_viewer_topic_label"],
      reasons: ["docs_viewer_topic_label_not_active_doc_command"],
      requestedOutputs: [],
      suppressedRoutes: ["active_doc_identity", "active_doc_summary", "doc_open_best"],
      precedenceReason: "docs_viewer_topic_label_not_active_doc_command",
      confidence: 0.72,
      allowClientShortcut: true,
      allowNoToolDirect: true,
    });
  }
  if (isExplicitProcessGraphPrompt(prompt)) {
    const processGraphRule = rules.find(
      (rule: CueRule) => rule.target === "process_graph",
    );
    if (processGraphRule) {
      const explicitCues = matches(prompt, processGraphRule.cues);
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target: processGraphRule.target,
        targetKind: processGraphRule.targetKind,
        strength: processGraphRule.strength,
        explicitCues:
          explicitCues.length > 0 ? explicitCues : ["process_graph"],
        reasons: [
          processGraphRule.reason,
          ...(explicitCues.length > 0 ? explicitCues : ["process_graph"]),
        ],
        requestedOutputs: processGraphRule.requestedOutputs,
        suppressedRoutes: processGraphRule.suppressedRoutes,
        precedenceReason: processGraphRule.reason,
        confidence: processGraphRule.confidence,
        allowClientShortcut: processGraphRule.allowClientShortcut,
        allowNoToolDirect: processGraphRule.allowNoToolDirect,
      });
    }
  }
  const activeWorkspaceResolution = input.activeWorkspaceSourceResolution;
  if (
    !retainedEvidenceContinuation &&
    activeWorkspaceResolution &&
    typeof activeWorkspaceResolution === "object" &&
    (activeWorkspaceResolution as Record<string, unknown>).schema ===
      "helix.active_workspace_source_resolution.v1"
  ) {
    const resolvedSourceTarget = (
      activeWorkspaceResolution as Record<string, unknown>
    ).resolved_source_target;
    const reason = String(
      (activeWorkspaceResolution as Record<string, unknown>).reason ?? "",
    );
    if (
      resolvedSourceTarget === "active_doc" ||
      resolvedSourceTarget === "docs_viewer"
    ) {
      const target = resolvedSourceTarget;
      const evidenceFollowup = reason === "active_doc_evidence_followup";
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target,
        targetKind: target,
        strength: "hard",
        explicitCues: [reason || "active_workspace_source_resolution"],
        reasons: [
          "active_workspace_source_resolution",
          reason || "active_workspace_source_resolution",
        ],
        requestedOutputs: evidenceFollowup
          ? [
              "file_path",
              "line_backed_source",
              "doc_evidence_synthesis_answer",
              "typed_failure",
            ]
          : ["file_path"],
        suppressedRoutes: [
          "situation_context_question",
          "visual_deictic",
          "visual_frame_evidence",
          "model_only_concept",
        ],
        precedenceReason: evidenceFollowup
          ? "active_doc_evidence_followup_source_target"
          : "active_workspace_source_resolution",
        confidence:
          typeof (activeWorkspaceResolution as Record<string, unknown>)
            .confidence === "number"
            ? ((activeWorkspaceResolution as Record<string, unknown>)
                .confidence as number)
            : 0.9,
        allowClientShortcut: false,
        allowNoToolDirect: false,
      });
    }
  }
  if (isDeicticDocsIdentityPrompt(prompt) && !retainedEvidenceContinuation) {
    const activeDocRule = rules.find((rule: CueRule) => rule.target === "active_doc");
    const explicitCues = activeDocRule ? matches(prompt, activeDocRule.cues) : [];
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "active_doc",
      targetKind: "active_doc",
      strength: "hard",
      explicitCues: explicitCues.length > 0 ? explicitCues : ["deictic_docs_identity"],
      reasons: ["deictic_docs_identity_source_target", ...(explicitCues.length > 0 ? explicitCues : ["source_noun_docs"])],
      requestedOutputs: ["file_path"],
      suppressedRoutes: ["situation_context_question", "visual_deictic", "visual_frame_evidence"],
      precedenceReason: "deictic_docs_identity_source_target",
      confidence: 0.95,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const repoIntent = detectRepoCodeEvidenceIntent(prompt);
  if (
    repoIntent.repoEvidenceRequested &&
    !(repoIntent.strength === "soft" && nonOperationalDocumentReference)
  ) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "repo_code",
      targetKind: "repo_code",
      strength: repoIntent.strength,
      explicitCues: repoIntent.reasons,
      reasons: repoIntent.reasons,
      requestedOutputs: mapRepoRequestedOutputs(repoIntent.requestedOutputs),
      suppressedRoutes: [
        "situation_context_question",
        "visual_deictic",
        "visual_frame_evidence",
        "active_doc_identity",
        "active_doc_summary",
        "active_note",
        "doc_open_best",
      ],
      precedenceReason:
        repoIntent.strength === "hard"
          ? "explicit_repo_code_source_target"
          : "project_local_entity_source_target",
      confidence: repoIntent.strength === "hard" ? 0.97 : 0.82,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  if (isExplicitProcessGraphPrompt(prompt)) {
    const processGraphRule = rules.find(
      (rule: CueRule) => rule.target === "process_graph",
    );
    if (processGraphRule) {
      const explicitCues = matches(prompt, processGraphRule.cues);
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target: processGraphRule.target,
        targetKind: processGraphRule.targetKind,
        strength: processGraphRule.strength,
        explicitCues:
          explicitCues.length > 0 ? explicitCues : ["process_graph"],
        reasons: [
          processGraphRule.reason,
          ...(explicitCues.length > 0 ? explicitCues : ["process_graph"]),
        ],
        requestedOutputs: processGraphRule.requestedOutputs,
        suppressedRoutes: processGraphRule.suppressedRoutes,
        precedenceReason: processGraphRule.reason,
        confidence: processGraphRule.confidence,
        allowClientShortcut: processGraphRule.allowClientShortcut,
        allowNoToolDirect: processGraphRule.allowNoToolDirect,
      });
    }
  }
  const visualSceneMemoryRule = rules.find((rule: CueRule) => rule.reason === "explicit_visual_scene_memory_source_target");
  if (
    visualSceneMemoryRule &&
    !contextualProcedureRecall &&
    !isGenericSceneEpochPhrase(prompt)
  ) {
    const explicitCues = matches(prompt, visualSceneMemoryRule.cues);
    if (explicitCues.length > 0) {
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target: visualSceneMemoryRule.target,
        targetKind: "visual_scene_memory",
        strength: visualSceneMemoryRule.strength,
        explicitCues,
        reasons: [visualSceneMemoryRule.reason, ...explicitCues],
        requestedOutputs: PROCEDURE_EPOCH_REQUESTED_OUTPUTS,
        suppressedRoutes: visualSceneMemoryRule.suppressedRoutes,
        precedenceReason: visualSceneMemoryRule.reason,
        confidence: visualSceneMemoryRule.confidence,
        allowClientShortcut: visualSceneMemoryRule.allowClientShortcut,
        allowNoToolDirect: visualSceneMemoryRule.allowNoToolDirect,
      });
    }
  }
  if (isSceneEpochReplayPrompt(prompt) && !contextualProcedureRecall) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "procedure_memory",
      targetKind: "situation_epoch",
      strength: "hard",
      explicitCues: ["scene_epoch_replay"],
      reasons: ["explicit_visual_epoch_delta_source_target", "scene_epoch_replay"],
      requestedOutputs: PROCEDURE_EPOCH_REQUESTED_OUTPUTS,
      suppressedRoutes: [...SCENE_EPOCH_REPLAY_FORBIDDEN_ROUTES],
      precedenceReason: "explicit_visual_epoch_delta_source_target",
      confidence: 0.96,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  const procedureMemoryRule = rules.find((rule: CueRule) => rule.target === "procedure_memory");
  if (procedureMemoryRule && !contextualProcedureRecall) {
    const explicitCues = matches(prompt, procedureMemoryRule.cues);
    if (procedureMemoryRule.reason === "explicit_visual_scene_memory_source_target" && explicitCues.length > 0) {
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target: procedureMemoryRule.target,
        targetKind: "visual_scene_memory",
        strength: procedureMemoryRule.strength,
        explicitCues,
        reasons: [procedureMemoryRule.reason, ...explicitCues],
        requestedOutputs: PROCEDURE_EPOCH_REQUESTED_OUTPUTS,
        suppressedRoutes: procedureMemoryRule.suppressedRoutes,
        precedenceReason: procedureMemoryRule.reason,
        confidence: procedureMemoryRule.confidence,
        allowClientShortcut: procedureMemoryRule.allowClientShortcut,
        allowNoToolDirect: procedureMemoryRule.allowNoToolDirect,
      });
    }
    if (explicitCues.some(isSituationEpochCue)) {
      return toSourceTargetIntent({
        turnId: input.turnId,
        threadId: input.threadId,
        target: procedureMemoryRule.target,
        targetKind: "situation_epoch",
        strength: procedureMemoryRule.strength,
        explicitCues,
        reasons: [procedureMemoryRule.reason, ...explicitCues],
        requestedOutputs: PROCEDURE_EPOCH_REQUESTED_OUTPUTS,
        suppressedRoutes: procedureMemoryRule.suppressedRoutes,
        precedenceReason: procedureMemoryRule.reason,
        confidence: procedureMemoryRule.confidence,
        allowClientShortcut: procedureMemoryRule.allowClientShortcut,
        allowNoToolDirect: procedureMemoryRule.allowNoToolDirect,
      });
    }
  }
  if (isAffirmativeImmediateMinecraftSituationPrompt(prompt)) {
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: "world_event",
      targetKind: "world_event",
      strength: "hard",
      explicitCues: ["affirmative_immediate_game_situation_observation"],
      reasons: [
        "explicit_world_event_source_target",
        "affirmative_immediate_game_situation_observation",
      ],
      requestedOutputs: ["procedure_epoch_replay"],
      suppressedRoutes: [
        "active_doc_identity",
        "active_doc_summary",
        "situation_context_question",
        "model_only_concept",
        "no_tool_direct",
      ],
      precedenceReason: "affirmative_immediate_game_situation_observation",
      confidence: 0.94,
      allowClientShortcut: false,
      allowNoToolDirect: false,
    });
  }
  for (const rule of rules) {
    if (rule.target === "procedure_memory" && contextualProcedureRecall) {
      continue;
    }
    if (rule.target === "docs_viewer" && isDocsViewerTopicLabelPrompt(prompt)) {
      continue;
    }
    if (rule.target === "active_doc" && retainedEvidenceContinuation) {
      continue;
    }
    const explicitCues =
      rule.target === "live_pipeline"
        ? filterLivePipelineCues(prompt, matches(prompt, rule.cues))
        : matches(prompt, rule.cues);
    if (explicitCues.length === 0) continue;
    const targetKind =
      rule.target === "procedure_memory" && explicitCues.some(isSituationEpochCue)
        ? "situation_epoch"
        : rule.targetKind;
    const requestedOutputs =
      rule.target === "procedure_memory" && targetKind === "situation_epoch"
        ? PROCEDURE_EPOCH_REQUESTED_OUTPUTS
        : rule.requestedOutputs;
    return toSourceTargetIntent({
      turnId: input.turnId,
      threadId: input.threadId,
      target: rule.target,
      targetKind,
      strength: rule.strength,
      explicitCues,
      reasons: [rule.reason, ...explicitCues],
      requestedOutputs,
      suppressedRoutes: rule.suppressedRoutes,
      precedenceReason: rule.reason,
      confidence: rule.confidence,
      allowClientShortcut: rule.allowClientShortcut,
      allowNoToolDirect: rule.allowNoToolDirect,
    });
  }
  return toSourceTargetIntent({
    turnId: input.turnId,
    threadId: input.threadId,
    target: "unknown",
    strength: "none",
    explicitCues: [],
    reasons: ["no_explicit_source_target"],
    requestedOutputs: [],
    suppressedRoutes: [],
    precedenceReason: "no_explicit_source_target",
    confidence: 0.2,
    allowClientShortcut: true,
    allowNoToolDirect: true,
  });
}

export const sourceTargetSuppressesRoute = (
  sourceTargetIntent: HelixAskSourceTargetIntent | null | undefined,
  route: string,
): boolean => Boolean(sourceTargetIntent?.suppressed_routes.includes(route));
