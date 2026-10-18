import type {
  HelixAskSourceTargetRequestedOutput,
  HelixAskSourceTargetStrength,
} from "@shared/helix-ask-source-target-intent";
import type { ToolFamily } from "./tool-family-contract";
import {
  HELIX_LOCKED_WORKSTATION_PANEL_IDS,
  HELIX_USER_WORKSTATION_PANEL_IDS,
} from "@shared/helix-account-session";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { extractScholarlySourceTargets } from "./scholarly-research-intent";
import { isAffirmativeTheoryExperimentProcedurePrompt } from "./theory-experiment-procedure-intent";
import { hasWorkstationPanelScopeCue } from "./workstation-active-context-intent";
import { extractExplicitCapabilityContracts } from "./explicit-capability-contract";
import { resolveAuthoritativeDocsTopicMatch } from "./docs-search";
import { hasExplicitRepoEvidenceRequest } from "./repo-code-intent-detector";

const KNOWN_WORKSTATION_PANEL_IDS = [
  ...HELIX_USER_WORKSTATION_PANEL_IDS,
  ...HELIX_LOCKED_WORKSTATION_PANEL_IDS,
];

const normalizeWorkstationSurfaceText = (value: string): string =>
  value.toLowerCase().replace(/[_\s]+/g, "-");

export const hasKnownWorkstationSurfaceScopeCue = (
  promptText: string,
): boolean => {
  const normalizedPrompt = normalizeWorkstationSurfaceText(promptText);
  return KNOWN_WORKSTATION_PANEL_IDS.some((panelId) =>
    normalizedPrompt.includes(panelId),
  );
};

export type HelixInternetSearchIntent = {
  searchRequested: boolean;
  strength: HelixAskSourceTargetStrength;
  explicitCues: string[];
  reasons: string[];
  requestedOutputs: HelixAskSourceTargetRequestedOutput[];
  normalizedQuery: string;
  domains: string[];
  recencyDays: number | null;
};

export type ToolUseRestatementV1 = {
  artifactId: "tool_use_restatement";
  schemaVersion: "helix.tool_use_restatement.v1";
  userGoal: string;
  freshnessRequired: boolean;
  currentAffairsRequired: boolean;
  requiredToolFamilies: ToolFamily[];
  minimumEvidencePlan?: {
    minSearches: number;
    minIndependentSources: number;
    recencyWindow?: string;
    citationRequired: boolean;
  };
  negativeConstraints: string[];
  quotedOrContextualMentions: string[];
  notTerminal: true;
  assistant_answer: false;
  raw_content_included: false;
};

const hasLocalWorkspaceScopeCue = (promptText: string): boolean =>
  /\b(?:docs?\s+viewer|documents?\s+viewer|current\s+(?:doc|document)|active\s+(?:doc|document)|repo|repository|codebase|working\s+tree|workspace|workstation|local\s+files?|our\s+docs?|from\s+(?:our|local|the\s+)?docs?)\b/i.test(
    promptText,
  ) ||
  hasKnownWorkstationSurfaceScopeCue(promptText) ||
  /\b(?:theory\s+badge\s+graph|current\s+badge\s+graph|selected\s+badges?|badge\s+(?:selection|combination|trace|branch))\b/i.test(
    promptText,
  ) ||
  /\b(?:current\s+)?(?:NHM[-\s]?2\s+)?(?:white\s*paper|whitepaper|doc(?:ument)?|paper)\b[\s\S]{0,120}\b(?:document\s+)?evidence\b/i.test(
    promptText,
  ) ||
  /\b(?:use|consult|check|read|inspect|apply|ground|base)\b[\s\S]{0,120}\b(?:NHM[-\s]?2\s+)?(?:white\s*paper|whitepaper|doc(?:ument)?|paper)\b/i.test(
    promptText,
  ) ||
  /\b(?:summari[sz]e|summary|overview|takeaways?|explain|describe|gist)\b[\s\S]{0,80}\bdocs?\s+about\b/i.test(
    promptText,
  ) ||
  /(?:^|[\s"'(])(?:\/docs\/|docs[\\/])\S+/i.test(promptText);

const hasExplicitLocalEnvironmentCapabilityCue = (
  promptText: string,
): boolean =>
  extractExplicitCapabilityContracts(promptText).some(
    ({ contract }) => contract.source_target === "live_environment",
  );

const hasMinecraftPlayerObservationScopeCue = (promptText: string): boolean => {
  if (/\bminecraft\s+(?:server|service|network|realm)\b/i.test(promptText)) {
    return false;
  }
  const playerObservation =
    /\b(?:health|hearts?|hunger|food\s+level|saturation|status|game\s+mode|position|coordinates?|inventory|armor|gear|equipment|hotbar|carrying|holding|mobs?|entities|players?|animals?|hazards?|danger|threats?|terrain|surroundings|line\s+of\s+sight|reachability|crops?|container|chest|barrel)\b/i;
  const minecraftIndex = promptText.search(/\bminecraft\b/i);
  if (minecraftIndex < 0) return false;
  const observationMatch = promptText.match(playerObservation);
  if (!observationMatch || typeof observationMatch.index !== "number") {
    return false;
  }
  return Math.abs(observationMatch.index - minecraftIndex) <= 140;
};

const hasLocalObservationScopeCue = (promptText: string): boolean =>
  /\b(?:screen\s+capture|screenshot|screen|visual|frame|capture|camera|live\s+(?:source|environment|answer|card|pipeline)|current\s+(?:screen|visual|frame|capture|live\s+source|live\s+environment)|what\s+is\s+happening\s+right\s+now\s+in\s+the\s+screen)\b/i.test(
    promptText,
  ) ||
  /\b(?:image\s*lens|pdf\s+page|page\s+\d+|current\s+page|crop(?:ped|ping)?|bbox|bounding\s+box|equation\s+row|exact\s+row|crop\s+ref|source\s+image\s+hash|page[-\s]?grounded|scientific\s+image\s+evidence|visual_analysis\.inspect_image_region)\b/i.test(
    promptText,
  ) ||
  /\b(?:minecraft|game)\s+(?:room|world)\b/i.test(promptText) ||
  /\b(?:this|current|bound|shared\s+live)\s+room\s+(?:evidence|goal|environment|source|state)\b/i.test(
    promptText,
  ) ||
  /\b(?:canonical|durable)\s+(?:minecraft\s+)?(?:environment\s+)?goal\b[\s\S]{0,120}\b(?:this|current|bound)\s+room\b/i.test(
    promptText,
  ) ||
  /\b(?:use|read|inspect|summari[sz]e|report)\b[\s\S]{0,100}\b(?:this|current|bound)\s+room\s+evidence\b/i.test(
    promptText,
  ) ||
  /\b(?:inspect|read|check|reconstruct|report)\b[\s\S]{0,140}\b(?:concurrent[-\s]?reasoning|reasoning[-\s]?role)\s+(?:ledger|history|outputs?|projection)\b/i.test(
    promptText,
  ) ||
  /\benvironment_durable_goal:[a-z0-9][a-z0-9-]{7,}\b/i.test(promptText) ||
  /\b(?:player\s+embodiment(?:\s+plane)?|paired(?:\s+minecraft)?(?:\s+player)?\s+client|minecraft\s+player\s+client)\b/i.test(
    promptText,
  ) ||
  /\b(?:(?:current|prior|earlier|previous|just[-\s]?gathered)\s+)?(?:minecraft\s+|game\s+|environment\s+)?observations?\b/i.test(
    promptText,
  ) ||
  /\b(?:live[-\s]?source|stage\s+play|environment)\s+(?:mailbox\s+)?(?:packet|mail|finding|wake)\b/i.test(
    promptText,
  ) ||
  /\b(?:processed|unread|newest|latest)\s+(?:minecraft\s+)?(?:mailbox\s+)?packets?\b/i.test(
    promptText,
  ) ||
  hasExplicitLocalEnvironmentCapabilityCue(promptText) ||
  hasMinecraftPlayerObservationScopeCue(promptText);

const hasScholarlyScopeCue = (promptText: string): boolean =>
  /\b(?:doi|pmid|pmcid|arxiv|crossref|openalex|semantic\s+scholar|pubmed|unpaywall|journal|peer[-\s]?reviewed|citations?|references?|bibliograph(?:y|ies)|research\s+papers?|scholarly\s+(?:papers?|articles?|sources?))\b/i.test(
    promptText,
  ) ||
  /\b(?:find|search|look\s+for|look\s*up|lookup|recommend|suggest|identify)\b[^.!?;\n]{0,140}\b(?:papers?|articles?|studies|reviews?|literature)\b/i.test(
    promptText,
  ) ||
  extractScholarlySourceTargets(promptText).length > 0;

const hasSearchActionCue = (promptText: string): boolean =>
  /\b(?:search|find|look\s*up|lookup|google|bing|web\s+search|internet\s+search|check\s+online|search\s+online|verify|source|sources)\b/i.test(
    promptText,
  );

export const hasRetainedEvidenceContinuationCue = (
  promptText: string,
): boolean =>
  /\b(?:use|using|from|based\s+on)\s+(?:the\s+)?(?:sources?|evidence|passages?|materials?)\s+(?:(?:that|which)\s+)?(?:you|we)?\s*(?:just|already|previously|earlier)\s+(?:inspected|retrieved|read|found|used|discussed)\b/i.test(
    promptText,
  ) ||
  /\b(?:sources?|evidence|passages?|materials?)\s+(?:(?:that|which)\s+)?(?:you|we)?\s*(?:just|already|previously|earlier)\s+(?:inspected|retrieved|read|found|used|discussed)\b/i.test(
    promptText,
  );

const hasPriorDocumentDiscussionReference = (promptText: string): boolean =>
  /\b(?:just|already|previously|earlier|later)\b[\s\S]{0,100}\b(?:explained|discussed|described|summari[sz]ed|talked\s+about|searched|inspected|read)\b[\s\S]{0,100}\b(?:white\s*paper|whitepaper|paper|doc(?:ument)?|docs?)\b/i.test(
    promptText,
  ) ||
  /\b(?:white\s*paper|whitepaper|paper|doc(?:ument)?|docs?)\b[\s\S]{0,100}\b(?:just|already|previously|earlier|later)\b[\s\S]{0,100}\b(?:explained|discussed|described|summari[sz]ed|talked\s+about|searched|inspected|read)\b/i.test(
    promptText,
  );

export const hasExplicitFreshDocsAccessCue = (promptText: string): boolean =>
  /\b(?:search|find|locate|look\s+(?:for|in|at)|retrieve|check|consult|open|show|view|read|inspect|pull\s+from|quote|cite)\b/i.test(
    promptText,
  ) ||
  /\b(?:exact\s+passage|page|section|line[-\s]?backed|citation|document\s+evidence)\b/i.test(
    promptText,
  );

export const hasAffirmativeDocsViewerSearchCue = (
  promptText: string,
): boolean => {
  const prompt = promptText.trim();
  if (!prompt) return false;
  if (hasScholarlyScopeCue(prompt) && !hasLocalWorkspaceScopeCue(prompt))
    return false;
  const contextualSuppression =
    detectContextualToolAdmissionSuppression(prompt);
  if (
    contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer")
  )
    return false;
  if (
    /\b(?:was|is)\s+my\s+(?:earlier|previous|last)\s+(?:prompt|question|message)\b/i.test(
      prompt,
    ) &&
    /\b(?:do\s+not|don't|dont|without)\s+(?:search|find|open|read|use|consult)\b/i.test(
      prompt,
    )
  ) {
    return false;
  }
  const priorDocumentDiscussionReference =
    hasPriorDocumentDiscussionReference(prompt);
  const retainedEvidenceReference = hasRetainedEvidenceContinuationCue(prompt);
  const freshDocumentAccessRequest =
    /\b(?:search|find|locate|look\s+(?:for|in|at)|retrieve|check|use|consult|open|show|view|read|inspect|pull\s+from|quote|cite)\b/i.test(
      prompt,
    ) ||
    /\b(?:exact\s+passage|page|section|line[-\s]?backed|citation|document\s+evidence)\b/i.test(
      prompt,
    );
  const explicitFreshDocumentAccessRequest =
    hasExplicitFreshDocsAccessCue(prompt);
  if (priorDocumentDiscussionReference && !freshDocumentAccessRequest)
    return false;
  if (retainedEvidenceReference && !explicitFreshDocumentAccessRequest)
    return false;
  if (
    /\b(?:do\s+not|don't|dont|never|without|no)\b[\s\S]{0,120}\b(?:search|find|locate|look\s+for|look\s+at|use|consult|open|show|view)\b[\s\S]{0,120}\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b/i.test(
      prompt,
    ) ||
    /\b(?:do\s+not|don't|dont|never|without|no)\b[\s\S]{0,120}\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b[\s\S]{0,120}\b(?:search|find|locate|look\s+for|look\s+at|use|consult|open|show|view)\b/i.test(
      prompt,
    )
  ) {
    return false;
  }
  if (
    /\b(?:earlier|previously|last\s+turn|before|already)\b[\s\S]{0,120}\b(?:searched|found|located|looked\s+for|retrieved)\b[\s\S]{0,120}\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b/i.test(
      prompt,
    ) ||
    /\b(?:searched|found|located|looked\s+for|retrieved)\b[\s\S]{0,120}\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b[\s\S]{0,120}\b(?:earlier|previously|last\s+turn|before|already)\b/i.test(
      prompt,
    )
  ) {
    return false;
  }
  if (
    /\b(?:later|next\s+time|in\s+the\s+future|not\s+now|not\s+yet|eventually|hypothetically)\b[\s\S]{0,160}\b(?:search|find|locate|look\s+for|retrieve)\b[\s\S]{0,120}\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b/i.test(
      prompt,
    )
  ) {
    return false;
  }
  const withoutQuotedDocsSearch = prompt.replace(
    /["'`][^"'`]*(?:search|find|locate|look\s+for)[^"'`]*(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)[^"'`]*["'`]/gi,
    " ",
  );
  if (
    /\b(?:search|find|locate|look\s+for|retrieve)\b[\s\S]{0,100}\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b/i.test(
      withoutQuotedDocsSearch,
    ) ||
    /\b(?:docs?|documents?|white\s*papers?|papers?|docs?\s+viewer|documents?\s+viewer)\b[\s\S]{0,100}\b(?:search|find|locate|look\s+for|retrieve)\b/i.test(
      withoutQuotedDocsSearch,
    )
  ) {
    return true;
  }
  if (
    /\b(?:check|use|consult|look\s+(?:in|at)|open|show|view|read|inspect|pull\s+from)\b[\s\S]{0,120}\b(?:white\s*paper|whitepaper|paper|doc(?:ument)?|docs?)\b/i.test(
      withoutQuotedDocsSearch,
    ) ||
    /\b(?:white\s*paper|whitepaper|paper|doc(?:ument)?|docs?)\b[\s\S]{0,120}\b(?:figure|figures|table|tables|value|values|newtons?|lbs?|pounds?|load[-\s]?bearing|capacity|reported|stated|specified)\b/i.test(
      withoutQuotedDocsSearch,
    )
  ) {
    return true;
  }
  return (
    /\b(?:which|what)\s+(?:doc(?:ument)?|paper)\s+path\b/i.test(prompt) &&
    /\b(?:from|in)\s+(?:our\s+|local\s+|the\s+)?docs?\b/i.test(prompt)
  );
};

const hasCurrentWebCue = (promptText: string): boolean =>
  /\b(?:latest|current(?![-\s]?turn\b)|today|yesterday|recent|newest|news|breaking|updated|right\s+now|this\s+week|this\s+month|online|internet|web\s+(?:results?|sources?|pages?)|google(?:\s+custom\s+search)?|search\s+engine)\b/i.test(
    promptText,
  );

const hasTimeSensitiveFactCue = (promptText: string): boolean =>
  /\b(?:latest|current(?![-\s]?turn\b)|today|yesterday|recent|newest|news|breaking|updated|right\s+now|this\s+week|this\s+month|ongoing|election|elections|law|laws|regulation|regulations|court\s+ruling|public\s+figure|ceo|president|prime\s+minister|minister|company\s+status|product\s+status|prices?|schedules?|release\s+date|earnings|stock|exchange\s+rate|inflation|sanctions?)\b/i.test(
    promptText,
  );

const hasCurrentAffairsDomainCue = (promptText: string): boolean =>
  /\b(?:ongoing\s+(?:border\s+)?(?:conflict|war|crisis)|ceasefire|reconstruction|battlefield|infrastructure\s+stability|resource[-\s]?capacity|decision\s+makers?|countries?\s+can\s+see|economic\s+(?:max\s+)?capacity|possible\s+reserves?|current\s+affairs?|geopolitics?|sanctions?|trade\s+bloc|supply\s+chain\s+shock|public\s+policy|election|elections|new\s+law|recent\s+law|current\s+law)\b/i.test(
    promptText,
  );

const hasExplicitWebProviderCue = (promptText: string): boolean =>
  /\b(?:google\s+(?:custom\s+search|cse|search)|tavily|exa|web\s+api|internet\s+api)\b/i.test(
    promptText,
  );

const hasExplicitWebSearchCue = (promptText: string): boolean =>
  /\b(?:search\s+(?:the\s+)?(?:web|internet)|look\s+up\s+online|check\s+online|google\s+it|google\s+search)\b/i.test(
    promptText,
  );

const domainPattern =
  /\b(?:site:)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b/gi;

const extractDomains = (promptText: string): string[] => {
  const domains: string[] = [];
  for (const match of promptText.matchAll(domainPattern)) {
    const domain = match[1]?.toLowerCase();
    if (!domain) continue;
    // Exact decimals such as 0.01 are scientific parameters, not domains.
    if (!/[a-z]/i.test(domain)) continue;
    if (
      /^(?:doi\.org|arxiv\.org|openalex\.org|semanticscholar\.org|crossref\.org)$/i.test(
        domain,
      )
    )
      continue;
    domains.push(domain);
  }
  return Array.from(new Set(domains)).slice(0, 8);
};

const extractRecencyDays = (promptText: string): number | null => {
  if (/\btoday|right\s+now|breaking\b/i.test(promptText)) return 1;
  if (/\byesterday|last\s+24\s+hours?\b/i.test(promptText)) return 2;
  if (
    /\bthis\s+week|last\s+week|past\s+week|last\s+7\s+days?\b/i.test(promptText)
  )
    return 7;
  if (
    /\bthis\s+month|last\s+month|past\s+month|last\s+30\s+days?\b/i.test(
      promptText,
    )
  )
    return 30;
  if (/\brecent|latest|newest|updated\b/i.test(promptText)) return 30;
  return null;
};

const recencyWindowFor = (days: number | null): string | undefined => {
  if (days === null) return undefined;
  if (days <= 1) return "24h";
  if (days <= 2) return "48h";
  if (days <= 7) return "7d";
  return "30d";
};

const isExplanatoryOnlyPrompt = (promptText: string): boolean =>
  /\b(?:what\s+is|what\s+are|explain|describe|tell\s+me)\b[\s\S]{0,120}\b(?:google|search\s+engine|internet\s+search|web\s+search)\b/i.test(
    promptText,
  ) &&
  !hasExplicitWebProviderCue(promptText) &&
  !/\b(?:use|call|run|try|search|find|look\s*up|google)\b/i.test(promptText);

const isSuppliedTextOnlyTask = (promptText: string): boolean =>
  /\b(?:just\s+)?(?:rewrite|reword|copyedit|summari[sz]e|quote|format|polish)\b[\s\S]{0,180}\b(?:this|the)\s+(?:paragraph|passage|prompt|text|quote)\b/i.test(
    promptText,
  ) &&
  !/\b(?:is\s+this\s+true|evaluate|assess|fact[-\s]?check|verify|source|sources|cite|citations?|what\s+changed|what\s+happened|latest|current\s+status)\b/i.test(
    promptText,
  );

const hasExplicitNoBrowseConstraint = (promptText: string): boolean =>
  /\b(?:do\s+not|don't|dont|never|without|no)\b[\s\S]{0,120}\b(?:browse|browsing|search(?:ing)?|web|internet|look\s*up|lookup|google|bing|check\s+online|verify\s+online)\b/i.test(
    promptText,
  );

const extractNegativeConstraints = (promptText: string): string[] => {
  const constraints: string[] = [];
  const noBrowse = promptText.match(
    /\b(?:do\s+not|don't|dont|never|without|no)\b[\s\S]{0,120}\b(?:browse|browsing|search(?:ing)?|web|internet|look\s*up|lookup|google|bing|check\s+online|verify\s+online)\b/i,
  )?.[0];
  if (noBrowse) constraints.push(noBrowse.trim());
  const rewriteOnly = promptText.match(
    /\b(?:just\s+)?(?:rewrite|reword|copyedit|summari[sz]e|quote|format|polish)\b[\s\S]{0,180}\b(?:this|the)\s+(?:paragraph|passage|prompt|text|quote)\b/i,
  )?.[0];
  if (rewriteOnly && isSuppliedTextOnlyTask(promptText))
    constraints.push("supplied_text_only_task");
  const contextualSuppression =
    detectContextualToolAdmissionSuppression(promptText);
  if (contextualSuppression)
    constraints.push(contextualSuppression.suppression_reason);
  return Array.from(new Set(constraints));
};

const extractQuotedOrContextualMentions = (promptText: string): string[] => {
  const mentions: string[] = [];
  for (const match of promptText.matchAll(
    /["'`][^"'`]*(?:search|latest|current|recent|breaking|browse|web|internet)[^"'`]*["'`]/gi,
  )) {
    if (match[0]) mentions.push(match[0]);
  }
  const screenVisible = promptText.match(
    /\b(?:phrase|text|screen|page|button|label|headline)\b[\s\S]{0,80}(?:says|shows|appears|reads|contains)\b[\s\S]{0,140}(?:latest|current|recent|breaking|search|browse|web|internet)/i,
  )?.[0];
  if (screenVisible) mentions.push(screenVisible.trim());
  const contextualSuppression =
    detectContextualToolAdmissionSuppression(promptText);
  if (contextualSuppression) mentions.push(contextualSuppression.text);
  return Array.from(new Set(mentions.filter(Boolean)));
};

const isComplexCurrentAffairsAnalysis = (promptText: string): boolean =>
  hasCurrentAffairsDomainCue(promptText) &&
  (promptText.length > 180 ||
    /\b(?:analysis|analyze|assess|evaluate|true|prediction|decision\s+makers?|should\s+we|would\s+it\s+matter|factor|proof|capacity|resources?|infrastructure|trade[-\s]?off|margin|marginal|scenario)\b/i.test(
      promptText,
    ));

const isCompactLiveSourceMailboxHandoff = (promptText: string): boolean =>
  ((/\bContinuing\s+live[-\s]?source\s+watch\s+job\s+compact\s+Ask\s+handoff\b/i.test(
    promptText,
  ) ||
    /\bUI\s+bridge\s+reason\b[\s\S]{0,120}\bHelix\s+Ask\s+wake\b/i.test(
      promptText,
    )) &&
    /\bWake\s+request:\s*stage_play_live_source_mail_wake:/i.test(promptText) &&
    /\bProcessed\s+packet:\s*stage_play_processed_mail_packet:/i.test(
      promptText,
    ) &&
    /\blive_env\.record_live_source_mail_decision\b/i.test(promptText)) ||
  (/\bReview\s+the\s+latest\s+Stage\s+Play\s+live[-\s]?source\s+mailbox\s+finding\b/i.test(
    promptText,
  ) &&
    /\bMicro[-\s]?reasoner\s+recommendation\s*:\s*(?:request\s+voice\s+callout|record\s+interpretation|request\s+more\s+evidence|request\s+stage\s+play\s+checkpoint)\b/i.test(
      promptText,
    ) &&
    /\bstructured\s+mailbox\s+route\s+metadata\b/i.test(promptText));

const hasAffirmativeVoiceReadAloudCue = (promptText: string): boolean => {
  const prompt = promptText.trim();
  if (!prompt) return false;
  const unquoted = prompt.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  if (
    /\b(?:do\s+not|don't|dont|without|not\s+now|no\s+need\s+to|avoid|stop)\b[\s\S]{0,120}\b(?:read|speak|say|play|narrat|voice)\b/i.test(
      unquoted,
    ) ||
    /\b(?:later|eventually|hypothetically|would|could|might|if|when|before|after|earlier|previously|historically)\b[\s\S]{0,160}\b(?:read|speak|say|play|narrat|voice)\b/i.test(
      unquoted,
    )
  ) {
    return false;
  }
  return /\b(?:read|speak|say|play|narrat(?:e|or)|voice)\b[\s\S]{0,120}\b(?:aloud|out\s*loud|outload|outloud|to\s+me)\b/i.test(
    unquoted,
  );
};

export const buildToolUseRestatement = (
  promptText: string,
): ToolUseRestatementV1 => {
  const prompt = promptText.trim();
  const compactLiveSourceMailboxHandoff =
    isCompactLiveSourceMailboxHandoff(prompt);
  const explicitProviderCue = hasExplicitWebProviderCue(prompt);
  const explicitWebRequest =
    explicitProviderCue || hasExplicitWebSearchCue(prompt);
  const searchAction = hasSearchActionCue(prompt);
  const currentWebCue = hasCurrentWebCue(prompt);
  const timeSensitiveCue = hasTimeSensitiveFactCue(prompt);
  const currentAffairsCue = hasCurrentAffairsDomainCue(prompt);
  const recencyDays =
    extractRecencyDays(prompt) ?? (currentAffairsCue ? 30 : null);
  const negativeConstraints = extractNegativeConstraints(prompt);
  const quotedOrContextualMentions = extractQuotedOrContextualMentions(prompt);
  const suppressed =
    compactLiveSourceMailboxHandoff ||
    negativeConstraints.length > 0 ||
    isSuppliedTextOnlyTask(prompt);
  const contextualSuppression = detectContextualToolAdmissionSuppression(prompt);
  const authoritativeDocsTopic =
    !suppressed &&
    !explicitWebRequest &&
    !hasExplicitRepoEvidenceRequest(prompt) &&
    !hasScholarlyScopeCue(prompt) &&
    !hasRetainedEvidenceContinuationCue(prompt) &&
    !hasPriorDocumentDiscussionReference(prompt) &&
    !contextualToolSuppressionBlocksFamily(contextualSuppression, "docs_viewer")
      ? resolveAuthoritativeDocsTopicMatch(prompt)
      : null;
  const requiresDocsViewer =
    !suppressed &&
    (hasAffirmativeDocsViewerSearchCue(prompt) || Boolean(authoritativeDocsTopic));
  const requiresVoiceDelivery =
    !suppressed && hasAffirmativeVoiceReadAloudCue(prompt);
  const localSourceScope =
    requiresDocsViewer ||
    isAffirmativeTheoryExperimentProcedurePrompt(prompt) ||
    hasWorkstationPanelScopeCue(prompt) ||
    hasLocalWorkspaceScopeCue(prompt) ||
    hasLocalObservationScopeCue(prompt);
  const localSourceWithoutExplicitWeb = localSourceScope && !explicitWebRequest;
  const freshnessRequired =
    !suppressed &&
    !localSourceWithoutExplicitWeb &&
    (explicitWebRequest ||
      currentWebCue ||
      timeSensitiveCue ||
      currentAffairsCue);
  const currentAffairsRequired =
    !suppressed && !localSourceWithoutExplicitWeb && currentAffairsCue;
  const requiresInternet =
    !suppressed &&
    !localSourceWithoutExplicitWeb &&
    (!hasScholarlyScopeCue(prompt) || explicitWebRequest) &&
    (explicitWebRequest ||
      (searchAction && (currentWebCue || timeSensitiveCue)) ||
      currentAffairsRequired ||
      (timeSensitiveCue &&
        /\b(?:what|why|how|is|are|should|would|does|do|compare|assess|evaluate|true|prediction|status)\b/i.test(
          prompt,
        )));
  const complex = isComplexCurrentAffairsAnalysis(prompt);
  const minimumEvidencePlan = requiresInternet
    ? {
        minSearches: complex ? 2 : 1,
        minIndependentSources: complex || currentAffairsRequired ? 2 : 1,
        ...(recencyWindowFor(recencyDays)
          ? { recencyWindow: recencyWindowFor(recencyDays) }
          : {}),
        citationRequired: true,
      }
    : undefined;
  return {
    artifactId: "tool_use_restatement",
    schemaVersion: "helix.tool_use_restatement.v1",
    userGoal: prompt,
    freshnessRequired,
    currentAffairsRequired,
    requiredToolFamilies: [
      ...(requiresDocsViewer ? ["docs_viewer" as const] : []),
      ...(requiresInternet ? ["internet_search" as const] : []),
      ...(requiresVoiceDelivery ? ["voice_delivery" as const] : []),
    ],
    ...(minimumEvidencePlan ? { minimumEvidencePlan } : {}),
    negativeConstraints,
    quotedOrContextualMentions,
    notTerminal: true,
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const detectInternetSearchIntent = (
  promptText: string,
): HelixInternetSearchIntent => {
  const prompt = promptText.trim();
  const restatement = buildToolUseRestatement(prompt);
  const contextualSuppression =
    detectContextualToolAdmissionSuppression(prompt);
  const internetSearchSuppressed = contextualToolSuppressionBlocksFamily(
    contextualSuppression,
    "internet_search",
  );
  const explicitProviderCue = hasExplicitWebProviderCue(prompt);
  const searchAction = hasSearchActionCue(prompt);
  const currentWebCue = hasCurrentWebCue(prompt);
  const localScope =
    restatement.requiredToolFamilies.includes("docs_viewer") ||
    hasWorkstationPanelScopeCue(prompt) ||
    hasLocalWorkspaceScopeCue(prompt);
  const scholarlyScope = hasScholarlyScopeCue(prompt);
  const domains = extractDomains(prompt);
  const recencyDays = extractRecencyDays(prompt);
  const explicitWebSearchCue = hasExplicitWebSearchCue(prompt);
  const searchRequested =
    (!internetSearchSuppressed &&
      restatement.requiredToolFamilies.includes("internet_search")) ||
    (!internetSearchSuppressed &&
      !isExplanatoryOnlyPrompt(prompt) &&
      !hasExplicitNoBrowseConstraint(prompt) &&
      !isSuppliedTextOnlyTask(prompt) &&
      (!scholarlyScope || explicitProviderCue || explicitWebSearchCue) &&
      (explicitProviderCue ||
        (searchAction && currentWebCue) ||
        explicitWebSearchCue ||
        (domains.length > 0 && searchAction)) &&
      (!localScope ||
        explicitProviderCue ||
        /\b(?:web|internet|online|google)\b/i.test(prompt)) &&
      (!hasLocalObservationScopeCue(prompt) ||
        explicitProviderCue ||
        /\b(?:web|internet|online|google)\b/i.test(prompt)));
  const explicitCues = [
    explicitProviderCue ? "internet_search_provider" : "",
    searchAction ? "search_action" : "",
    currentWebCue ? "current_or_web_source" : "",
    restatement.freshnessRequired ? "freshness_required" : "",
    restatement.currentAffairsRequired ? "current_affairs_required" : "",
    domains.length > 0 ? "domain_filter" : "",
  ].filter(Boolean);
  return {
    searchRequested,
    strength:
      explicitProviderCue ||
      restatement.currentAffairsRequired ||
      /\b(?:search\s+(?:the\s+)?(?:web|internet)|google\s+search|check\s+online)\b/i.test(
        prompt,
      )
        ? "hard"
        : "soft",
    explicitCues,
    reasons: searchRequested
      ? ["external_internet_search_source_target", ...explicitCues]
      : [],
    requestedOutputs: [
      "web_search_results",
      "web_page_snippets",
      "source_links",
      "typed_failure",
    ],
    normalizedQuery: prompt,
    domains,
    recencyDays,
  };
};
