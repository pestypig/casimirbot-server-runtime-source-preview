import { buildHelixTheoryBadgeGraphV1 } from "@shared/theory/helix-theory-badge-graph";

export const THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY =
  "theory-experiment-procedure.prepare" as const;

export type TheoryExperimentProcedureOperation =
  "compare" | "predict" | "derive" | "explain" | "prove" | "bound";

export type TheoryExperimentProcedurePromptMatch = {
  matched_text: string;
  match_index: number;
  match_end_index: number;
};

export type TheoryExperimentProcedurePromptArguments = {
  prompt: string;
  operation: TheoryExperimentProcedureOperation;
  target: string;
  selected_badge_ids: string[];
  evidence_maturity_ceiling: "exploratory";
  lanyon_requested?: boolean;
  lanyon_case_id?: string;
};

const unquotePrompt = (value: string): string =>
  value
    .replace(
      /“[^”]*”|„[^”]*”|‘[^’]*’|‚[^’]*’|«[^»]*»|‹[^›]*›|「[^」]*」|『[^』]*』/g,
      " ",
    )
    .replace(/[’ʼ]/g, "'")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");

const normalizeSpace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const PROCEDURE_OBJECT_PATTERN =
  /\b(?:(?:seven|7)[-\s]+stage\s+)?theory\s+experiment\s+procedure\b|\b(?:seven|7)[-\s]+stage\s+(?:theory\s+)?experiment\s+(?:plan|workflow|procedure)\b|\b(?:first[-\s]+principles\s+)?comparison\s+procedure\b|\b(?:that\s+same|same|this|the)\s+(?:bounded\s+)?procedure\b/i;

const PROCEDURE_COMMAND_PATTERN =
  /\b(?:prepare|re[-\s]?prepare|set\s+up|configure|call|use|run|invoke|execute)\b/i;

const DIRECT_CAPABILITY_COMMAND_PATTERN =
  /\b(?:call|use|run|invoke|execute|prepare|re[-\s]?prepare)\b[\s\S]{0,120}\btheory-experiment-procedure\.prepare\b/i;

const SCIENTIFIC_PROCEDURE_ANCHOR_PATTERN =
  /\b(?:theory\s+badge\s+graph|lanyon|advection[-_\s]?diffusion(?:_[a-z0-9]+)*|dependency[-\s]?dag|scale[-\s]?(?:checkpoint|biome)|semantic\s+admission|boundary[-\s]?condition|formal[-\s]?(?:certificate|verification)|independent\s+numerical|observable|empirical|scientific|mathematical|equation\s+congruence|general\s+relativity|quantum\s+(?:field\s+)?theory|fluid\s+dynamics|thermodynamics|same\s+comparison)\b/i;

const NEGATED_PREPARATION_PATTERN =
  /\b(?:do\s+not|don't|dont|never|avoid|without|no\s+need\s+to|not\s+asking\s+to)\b[^.!?;\n]{0,120}\b(?:prepare|re[-\s]?prepare|set\s+up|configure|call|use|run|invoke|execute)\b[^.!?;\n]{0,120}\b(?:theory\s+experiment\s+procedure|comparison\s+procedure|bounded\s+procedure|the\s+procedure|theory-experiment-procedure\.prepare)\b/i;

const DEFERRED_PREPARATION_PATTERN =
  /\b(?:later|eventually|someday|in\s+the\s+future|next\s+time|if|when|unless|after\s+approval)\b[^.!?;\n]{0,160}\b(?:prepare|re[-\s]?prepare|set\s+up|configure|call|use|run|invoke|execute)\b[^.!?;\n]{0,140}\b(?:procedure|theory-experiment-procedure\.prepare)\b/i;

const HISTORICAL_PREPARATION_PATTERN =
  /\b(?:yesterday|earlier|previously|historically|last\s+turn|last\s+time|already)\b[^.!?;\n]{0,160}\b(?:prepared|re[-\s]?prepared|called|used|ran|invoked|executed|configured)\b[^.!?;\n]{0,140}\b(?:procedure|theory-experiment-procedure\.prepare)\b/i;

const SCREEN_OR_LABEL_PATTERN =
  /\b(?:screen|page|button|label|ui|text|phrase)\b[^.!?;\n]{0,120}\b(?:says|shows|reads|contains|mentions|labeled|labelled|called|named)\b[^.!?;\n]{0,140}\b(?:procedure|theory-experiment-procedure\.prepare)\b/i;

const EXPLANATORY_ONLY_PATTERN =
  /\b(?:explain|describe|define|what\s+is|what\s+does|how\s+does)\b[^.!?;\n]{0,140}\b(?:theory\s+experiment\s+procedure|theory-experiment-procedure\.prepare)\b[^.!?;\n]{0,120}\b(?:mean|means|work|works|do|does|identifier|capability|conceptually)\b/i;

export const theoryExperimentProcedurePromptMatch = (
  promptText: string | null | undefined,
): TheoryExperimentProcedurePromptMatch | null => {
  const prompt = String(promptText ?? "").trim();
  if (!prompt) return null;
  const unquoted = unquotePrompt(prompt);
  if (
    NEGATED_PREPARATION_PATTERN.test(unquoted) ||
    DEFERRED_PREPARATION_PATTERN.test(unquoted) ||
    HISTORICAL_PREPARATION_PATTERN.test(unquoted) ||
    SCREEN_OR_LABEL_PATTERN.test(unquoted) ||
    EXPLANATORY_ONLY_PATTERN.test(unquoted)
  ) {
    return null;
  }

  const directMatch = DIRECT_CAPABILITY_COMMAND_PATTERN.exec(unquoted);
  if (directMatch) {
    const capabilityOffset = directMatch[0]
      .toLowerCase()
      .lastIndexOf(THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY);
    const matchIndex = directMatch.index + Math.max(0, capabilityOffset);
    return {
      matched_text: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      match_index: matchIndex,
      match_end_index:
        matchIndex + THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY.length,
    };
  }

  const procedureMatch = PROCEDURE_OBJECT_PATTERN.exec(unquoted);
  const hasRegisteredBadge = extractBadgeIds(unquoted).length > 0;
  if (
    !procedureMatch ||
    (!hasRegisteredBadge && !SCIENTIFIC_PROCEDURE_ANCHOR_PATTERN.test(unquoted))
  ) {
    return null;
  }
  const prefix = unquoted.slice(
    Math.max(0, procedureMatch.index - 140),
    procedureMatch.index,
  );
  if (!PROCEDURE_COMMAND_PATTERN.test(prefix)) return null;
  return {
    matched_text: procedureMatch[0],
    match_index: procedureMatch.index,
    match_end_index: procedureMatch.index + procedureMatch[0].length,
  };
};

export const isAffirmativeTheoryExperimentProcedurePrompt = (
  promptText: string | null | undefined,
): boolean => Boolean(theoryExperimentProcedurePromptMatch(promptText));

let registeredBadgeIdsByFoldedId: ReadonlyMap<string, string> | null = null;

const getRegisteredBadgeIdsByFoldedId = (): ReadonlyMap<string, string> => {
  if (registeredBadgeIdsByFoldedId) return registeredBadgeIdsByFoldedId;
  registeredBadgeIdsByFoldedId = new Map(
    buildHelixTheoryBadgeGraphV1().badges.map((badge) => [
      badge.id.toLowerCase(),
      badge.id,
    ]),
  );
  return registeredBadgeIdsByFoldedId;
};

const extractBadgeIds = (value: string): string[] => {
  const registeredIds = getRegisteredBadgeIdsByFoldedId();
  const explicitIds = Array.from(
    value.matchAll(
      /\b(?:badge\.)?([a-z][a-z0-9_-]*(?:\.[a-z0-9_][a-z0-9_-]*){1,})\b/gi,
    ),
    (match) => registeredIds.get(match[1]!.toLowerCase()),
  ).filter((badgeId): badgeId is string => Boolean(badgeId));
  const naturalIds = [
    /\b(?:stage\s*3|third[-\s]+stage)\s+casimir[-\s]*dp\s+(?:quantum[-\s]+foam\s+)?evidence(?:[-\s]+map)?\b/i.test(
      value,
    )
      ? registeredIds.get("study.casimir_dp.evidence_map_stage3")
      : null,
  ].filter((badgeId): badgeId is string => Boolean(badgeId));
  return unique([...explicitIds, ...naturalIds]);
};

const unique = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean)));

const withoutNegatedArgumentClauses = (value: string): string =>
  value
    .replace(
      /\b(?:do\s+not|don't|dont|never|avoid|without|not\s+asking\s+to|not\s+using)\b[^.!?;\n]*/gi,
      " ",
    )
    .replace(
      /\b(?:(?:is|are|was|were|be|becomes?|constitutes?)\s+)?not\s+(?:a\s+)?(?:proof|theorem|proven|proved)\b/gi,
      " ",
    );

const operationFromPrompt = (
  prompt: string,
  badgeIds: string[],
): TheoryExperimentProcedureOperation => {
  const affirmativePrompt = withoutNegatedArgumentClauses(prompt);
  if (/\b(?:predict|prediction|forecast)\b/i.test(affirmativePrompt)) {
    return "predict";
  }
  if (/\b(?:prove|proof|theorem)\b/i.test(affirmativePrompt)) return "prove";
  if (/\b(?:derive|derivation)\b/i.test(affirmativePrompt)) return "derive";
  if (/\b(?:bound|limit)\b/i.test(affirmativePrompt)) return "bound";
  if (
    badgeIds.length > 1 ||
    /\b(?:compare|comparison|comparing|contrast|congruence)\b/i.test(
      affirmativePrompt,
    )
  ) {
    return "compare";
  }
  return "explain";
};

const explicitLanyonCaseId = (value: string): string | null =>
  value.match(/\badvection_diffusion_[a-z0-9_]+\b/i)?.[0]?.toLowerCase() ??
  (
    /\b(?:registered\s+)?(?:one|1)[-\s]*dimensional\b[\s\S]{0,80}\badvection[-\s]+diffusion\b/i.test(
      value,
    ) ||
    /\badvection[-\s]+diffusion\b[\s\S]{0,80}\b(?:registered\s+)?(?:one|1)[-\s]*dimensional\b/i.test(
      value,
    )
      ? "advection_diffusion_full_1d"
      : null
  ) ??
  null;

const unsupportedLanyonCaseId = (value: string): string | null => {
  if (!/\bunregistered\b/i.test(value)) return null;
  if (
    /\b(?:two[-\s]?dimensional|2d)\b/i.test(value) &&
    /\badaptive[-\s]?mesh\b/i.test(value)
  ) {
    return "unregistered_2d_adaptive_mesh_advection_diffusion";
  }
  return "unregistered_lanyon_case";
};

export const buildTheoryExperimentProcedurePromptArguments = (input: {
  promptText: string;
  retainedContextText?: string | null;
}): TheoryExperimentProcedurePromptArguments => {
  const prompt = normalizeSpace(input.promptText);
  const retainedContext = normalizeSpace(input.retainedContextText ?? "");
  const promptBadgeIds = unique(extractBadgeIds(prompt));
  const selectedBadgeIds =
    promptBadgeIds.length > 0
      ? promptBadgeIds
      : unique(extractBadgeIds(retainedContext));
  const contextMaySupplyPriorBindings =
    /\b(?:continue|same|that|re[-\s]?prepare|again|current\s+for\s+this\s+turn)\b/i.test(
      prompt,
    );
  const bindingText = contextMaySupplyPriorBindings
    ? `${prompt} ${retainedContext}`
    : prompt;
  const affirmativeBindingText = withoutNegatedArgumentClauses(bindingText);
  const affirmativePrompt = withoutNegatedArgumentClauses(prompt);
  const lanyonRequested =
    /\b(?:lanyon|advection[-_\s]?diffusion(?:_[a-z0-9]+)*)\b/i.test(
      affirmativeBindingText,
    );
  const lanyonCaseId =
    explicitLanyonCaseId(affirmativePrompt) ??
    (contextMaySupplyPriorBindings
      ? explicitLanyonCaseId(withoutNegatedArgumentClauses(retainedContext))
      : null) ??
    unsupportedLanyonCaseId(affirmativePrompt);
  const target =
    selectedBadgeIds.length > 0
      ? selectedBadgeIds.join(" vs ")
      : prompt.slice(0, 240);

  return {
    prompt,
    operation: operationFromPrompt(prompt, selectedBadgeIds),
    target,
    selected_badge_ids: selectedBadgeIds,
    evidence_maturity_ceiling: "exploratory",
    ...(lanyonRequested ? { lanyon_requested: true } : {}),
    ...(lanyonCaseId ? { lanyon_case_id: lanyonCaseId } : {}),
  };
};

export const explicitCurrentTurnTheoryProcedureIdentities = (
  promptText: string | null | undefined,
): {
  badge_ids: string[];
  lanyon_case_id: string | null;
} | null => {
  const prompt = String(promptText ?? "").trim();
  if (!prompt || !theoryExperimentProcedurePromptMatch(prompt)) return null;
  const args = buildTheoryExperimentProcedurePromptArguments({
    promptText: prompt,
  });
  if (args.selected_badge_ids.length === 0 && !args.lanyon_case_id) {
    return null;
  }
  return {
    badge_ids: args.selected_badge_ids,
    lanyon_case_id: args.lanyon_case_id ?? null,
  };
};
