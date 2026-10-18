import {
  extractPlannerBindingCapabilityContracts,
  type ExplicitCapabilityContract,
  type ExplicitCapabilityExtractionContext,
  type ExtractedExplicitCapabilityContract,
} from "./explicit-capability-contract";
import type { HelixWorkstationTypedAffordanceKind } from "../../../shared/helix-agent-step-observation-packet";
import {
  HELIX_PAPER_EVIDENCE_ENRICHMENT_PROPOSAL_SCHEMA,
  HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
} from "@shared/helix-paper-evidence-enrichment";
import {
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
  buildTheoryExperimentProcedurePromptArguments,
} from "./theory-experiment-procedure-intent";
import {
  HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
  HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
  HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
  HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS,
  HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
} from "@shared/helix-environment-connector";
import {
  HELIX_MINECRAFT_COMMAND_CAPABILITY,
  HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
} from "@shared/helix-environment-command";
import {
  HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
} from "@shared/helix-minecraft-player-capabilities";
import {
  HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
} from "@shared/helix-environment-durable-goal";
import {
  HELIX_ENVIRONMENT_REASONING_ROLE_INSPECT_CAPABILITY,
} from "@shared/helix-environment-reasoning-role";

type RecordLike = Record<string, unknown>;

const THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY =
  "theory-experiment-procedure.evaluate_closure" as const;
const THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY =
  "theory-experiment-procedure.readmit" as const;
const THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY =
  "theory-semantic-admitter.normalize" as const;
const THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY =
  "theory-artifact-producer.prepare_lanyon_request" as const;
const THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY =
  "theory-artifact-producer.admit_lanyon_snapshot" as const;
const THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY =
  "theory-formal-verifier.inspect_artifact_family" as const;
const THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY =
  "theory-formal-verifier.prepare_request" as const;
const THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY =
  "theory-formal-verifier.plan" as const;
const THEORY_FORMAL_VERIFIER_START_CAPABILITY =
  "theory-formal-verifier.start" as const;
const THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY =
  "theory-formal-verifier.read_result" as const;
const THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY =
  "theory-independent-numerical-verifier.prepare_request" as const;
const THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY =
  "theory-independent-numerical-verifier.plan" as const;
const THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY =
  "theory-independent-numerical-verifier.start" as const;
const THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY =
  "theory-independent-numerical-verifier.read_result" as const;
const minecraftSituationCapabilities = new Set<string>(
  HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS,
);

export const HELIX_COMPOUND_CAPABILITY_CONTRACT_SCHEMA =
  "helix.compound_capability_contract.v1" as const;

export type HelixCompoundCapabilitySubgoal = {
  subgoal_id: string;
  order: number;
  requested_capability: string;
  runtime_capability: string;
  capability_family: string;
  plan_family: string;
  source_target: string;
  admission_families: string[];
  required_args: string[];
  optional_args: string[];
  args_hint: RecordLike;
  required_observation_kinds: string[];
  produced_affordance_kinds: HelixWorkstationTypedAffordanceKind[];
  consumed_affordance_kinds: HelixWorkstationTypedAffordanceKind[];
  missing_affordance_kinds: HelixWorkstationTypedAffordanceKind[];
  required_terminal_kind: string;
  contribution_role: string;
  terminal_contribution_kind: string;
  allowed_substitutions: string[];
  forbidden_nearby_capabilities: string[];
  depends_on_subgoal_ids: string[];
  input_bindings: Array<{
    binding_id: string;
    arg_name:
      | "paper_result_or_source"
      | "source_ref"
      | "source_refs"
      | "target_ref"
      | "evidence_refs"
      | "support_refs"
      | "scenarioFrameRef"
      | "theory_reflection_ref"
      | "ideology_reflection_ref";
    binding_kind: "source_ref" | "target_ref" | "support_ref";
    from_subgoal_id: string;
    from_capability: string;
    required_observation_kinds: string[];
    required_affordance_kinds: HelixWorkstationTypedAffordanceKind[];
    required: boolean;
    status: "pending";
  }>;
  subgoal_identity_policy?: "provider_call_occurrence";
  provider_call_id?: string | null;
  capability_occurrence?: number;
  guarded_noop_policy?: {
    schema: "helix.compound_capability_guarded_noop.v1";
    mode: "no_verified_safe_candidate";
    guard_subgoal_id: string;
    guard_capability: typeof HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY;
    required_purpose:
      | "structure_planning"
      | "fire_safety"
      | "movement_safety";
    accepted_observation_purposes:
      | ["structure_planning", "build_planning"]
      | ["fire_safety"]
      | ["movement_safety"];
    candidate_field:
      | "build_line_candidates"
      | "fireplace_candidates"
      | "walk_step_candidates";
    completeness_field:
      | "build_line_candidates_complete"
      | "fireplace_candidates_complete"
      | "walk_step_candidates_complete";
    omitted_count_field:
      | "omitted_build_line_candidate_count"
      | "omitted_fireplace_candidate_count"
      | "omitted_walk_step_candidate_count";
    current_turn_only: true;
    requires_successful_observation: true;
    user_directed_noop_guard: true;
  };
  status: "pending";
  mandatory: boolean;
};

export type HelixCompoundCapabilityContract = {
  schema: typeof HELIX_COMPOUND_CAPABILITY_CONTRACT_SCHEMA;
  turn_id: string;
  prompt_shape: "single_capability" | "compound_capability";
  subgoals: HelixCompoundCapabilitySubgoal[];
  required_capabilities: string[];
  requires_all_subgoals: boolean;
  subgoal_identity_policy?: "provider_call_occurrence";
  terminal_policy: "synthesize_from_satisfied_subgoal_observations";
  assistant_answer: false;
  raw_content_included: false;
};

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const unique = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const stableTextHash = (input: string): string => {
  let h = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripBoundaryPunctuation = (value: string): string =>
  value
    .replace(/^[\s:;,.=\-]+/, "")
    .replace(/[\s:;,.]+$/, "")
    .trim();

const findNextCapabilityIndex = (
  prompt: string,
  current: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): number => {
  const later = ordered.find((entry: ExtractedExplicitCapabilityContract) => entry.match_index > current.match_index);
  return later?.match_index ?? prompt.length;
};

const mathCandidateScore = (candidate: string): number => {
  const normalized = normalizeSpace(stripBoundaryPunctuation(candidate));
  if (!/\d/.test(normalized)) return 0;
  if (!/[+\-*/^=()]|sqrt|ln|log|sin|cos|tan|pi|\\frac|\\sqrt/i.test(normalized)) return 0;
  const prosePenalty = /\b(?:then|and|please|wait|receipt|answer|tool|call|use|run|with|this|exact|expression)\b/i.test(normalized)
    ? 20
    : 0;
  return normalized.length - prosePenalty;
};

export const extractCalculatorSubgoalExpression = (
  promptText: string,
  match: Pick<ExtractedExplicitCapabilityContract, "match_end_index" | "match_index">,
  nextCapabilityIndex?: number | null,
): string | null => {
  const prompt = String(promptText ?? "");
  if (!prompt.trim()) return null;
  const segmentEnd = typeof nextCapabilityIndex === "number" && nextCapabilityIndex > match.match_index
    ? nextCapabilityIndex
    : prompt.length;
  const segment = prompt.slice(match.match_end_index, segmentEnd);
  const markerTail =
    segment.match(/\b(?:with\s+this\s+exact\s+expression|exact\s+expression|expression|equation|latex|evaluate|calculate|compute|solve|for)\b\s*[:=]?\s*([\s\S]+)$/i)?.[1] ??
    segment;
  const boundedTail = markerTail.split(
    /\b(?:then|followed\s+by|next)\b|(?:\s;\s)|(?:\n{2,})|(?:,\s+(?:and\s+)?(?:explain|summarize|cite|connect|answer|return|report|show)\b)/i,
  )[0] ?? markerTail;
  const candidates: string[] = Array.from(boundedTail.matchAll(/(?:\\frac|\\sqrt|sqrt|ln|log|sin|cos|tan|pi|e|\d|[+\-*/^=().,\s]){2,}/gi))
    .map((entry: RegExpMatchArray) => stripBoundaryPunctuation(entry[0]))
    .filter(Boolean)
    .filter((entry: string) => mathCandidateScore(entry) > 0)
    .sort((left: string, right: string) => mathCandidateScore(right) - mathCandidateScore(left));
  const best = candidates[0] ? normalizeSpace(candidates[0]) : "";
  return best || null;
};

const segmentForMatch = (
  promptText: string,
  match: Pick<ExtractedExplicitCapabilityContract, "match_end_index" | "match_index">,
  ordered: ExtractedExplicitCapabilityContract[],
): string => {
  const nextCapabilityIndex = findNextCapabilityIndex(promptText, match, ordered);
  const segmentEnd = nextCapabilityIndex > match.match_index ? nextCapabilityIndex : promptText.length;
  return promptText.slice(match.match_end_index, segmentEnd);
};

const boundedSegmentForMatch = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): string => {
  const segment = segmentForMatch(promptText, match, ordered);
  return normalizeSpace(
    stripBoundaryPunctuation(
      (segment.split(/\s*,?\s*\b(?:then|next|followed\s+by|and\s+then|plus)\b\s+(?:call|use|run|invoke|execute)?\b/i)[0] ?? segment)
        .replace(/\b(?:then|next|plus|and)\s*$/i, ""),
    ),
  );
};

const firstWorkspacePath = (value: string): string | null => {
  const path = value.match(/\b((?:docs|server|client|shared|scripts|external)\/[^\s,;)]+)/i)?.[1] ?? null;
  return path ? stripBoundaryPunctuation(path) : null;
};

const stripLeadingArgLabel = (value: string): string =>
  normalizeSpace(
    stripBoundaryPunctuation(value)
      .replace(/^(?:query|concept|claim|text|phrase|term|where|path|target|for|about|on)\s*[:=]\s*/i, ""),
  );

const queryAfterMarker = (value: string, markerPattern: RegExp): string => {
  const markerMatch = value.match(markerPattern)?.[1] ?? value;
  return stripLeadingArgLabel(markerMatch);
};

const docsLocateArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const path = firstWorkspacePath(segment);
  const quoted = segment.match(/["']([^"'\n]+)["']/)?.[1];
  const explicitQuery = segment.match(/\b(?:query|claim|text|phrase|term|where)\b\s*[:=]\s*["']?([^"'\n.;]+)["']?/i)?.[1];
  const locateQuery =
    quoted ??
    explicitQuery ??
    segment.match(/\b(?:locate|find|cite|where)\b\s+(?:the\s+)?([\s\S]+?)(?:\s+in\s+(?:docs|server|client|shared|scripts|external)\/|$)/i)?.[1] ??
    queryAfterMarker(segment, /\b(?:query|claim|text|phrase|term|where)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i);
  const query = normalizeSpace(stripBoundaryPunctuation(locateQuery));
  return {
    query,
    target_transcript: query,
    ...(path ? { path } : {}),
  };
};

const docsSearchArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const query = queryAfterMarker(
    segment,
    /\b(?:query|topic|title|for|about|on|search(?:\s+for)?)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i,
  );
  return {
    query,
    limit: 8,
  };
};

const docsOpenDocByPathArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const path = firstWorkspacePath(segment) ??
    stripLeadingArgLabel(queryAfterMarker(segment, /\b(?:path|target|for|open)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i));
  return path ? { path } : {};
};

const repoSearchArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const commandWindow = promptText.slice(
    match.match_index,
    findNextCapabilityIndex(promptText, match, ordered),
  );
  const fallbackSegment = normalizeSpace(
    stripBoundaryPunctuation(
      commandWindow
        .replace(
          /\b(?:use|call|run|invoke|execute)?\s*(?:repo-code\.search_concept|repo_code\.search_concept|repo\s+code\s+search\s+concept|repo[_\s]+code|repo[_\s]+evidence|repository\s+code)\b(?:\s+to)?/i,
          "",
        ),
    ),
  );
  const querySource = segment || fallbackSegment || promptText;
  const rawQuery = queryAfterMarker(
    querySource,
    /\b(?:query|concept|for|about|on|find|search(?:\s+for)?|where)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i,
  );
  const query = normalizeSpace(rawQuery.replace(/^where\s+/i, ""));
  return {
    query,
    concept: query,
    limit: 5,
  };
};

const workspaceResolveArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const path = firstWorkspacePath(segment);
  const query = path ??
    queryAfterMarker(segment, /\b(?:query|for|resolve|path|target)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i);
  return {
    query,
    ...(path ? { path } : {}),
    limit: 8,
    target_kinds: ["doc", "panel", "path"],
  };
};

const internetSearchArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const query = queryAfterMarker(
    segment,
    /\b(?:query|for|about|on|search(?:\s+for)?|find)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i,
  );
  return { query };
};

const scholarlyLookupArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = segmentForMatch(promptText, match, ordered);
  const query =
    segment.match(/\b(?:for|about|on|query|search(?:\s+for)?)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i)?.[1] ??
    (segment || promptText);
  const boundedQuery = query.split(/\s*,?\s*\b(?:then|next|followed\s+by)\b\s+(?:call|use|run)\b/i)[0] ?? query;
  return {
    query: stripLeadingArgLabel(boundedQuery),
    limit: 5,
  };
};

const scholarlyFullTextArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = segmentForMatch(promptText, match, ordered);
  const source = `${segment} ${promptText}`;
  const paperResultId =
    source.match(/\b(?:paper_result_id|paper_id|result_id)\s*[:=]\s*["']?([^"'\s,.;]+)["']?/i)?.[1] ??
    source.match(/\b(?:arxiv|openalex|semantic_scholar|crossref|doi):[^\s,.;]+/i)?.[0];
  const sourceUrl = source.match(/\b(?:source_url|pdf_url|full_text_url|url)\s*[:=]\s*["']?(https?:\/\/[^"'\s,.;]+)["']?/i)?.[1] ??
    source.match(/https?:\/\/[^\s"']+/i)?.[0];
  return {
    ...(paperResultId ? { paper_result_id: stripBoundaryPunctuation(paperResultId) } : {}),
    ...(sourceUrl ? { source_url: stripBoundaryPunctuation(sourceUrl) } : {}),
  };
};

const workstationNoteArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const text =
    segment.match(/\b(?:with\s+text|text|body|content)\b\s*[:=]?\s*["']?([^"'\n]+)["']?/i)?.[1] ??
    segment;
  const normalized = normalizeSpace(stripBoundaryPunctuation(text));
  return normalized ? { text: normalized } : {};
};

const workstationNoteCreateArgs = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): RecordLike => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  const title =
    segment.match(/\b(?:with\s+title|title|name)\b\s*[:=]?\s*["']?([^"'\n.;]+)["']?/i)?.[1] ??
    stripLeadingArgLabel(segment);
  const normalized = normalizeSpace(stripBoundaryPunctuation(title));
  return normalized ? { title: normalized } : {};
};

const boundedPromptArgForSubgoal = (
  promptText: string,
  match: ExtractedExplicitCapabilityContract,
  ordered: ExtractedExplicitCapabilityContract[],
): string => {
  const segment = boundedSegmentForMatch(promptText, match, ordered);
  return stripLeadingArgLabel(segment) || normalizeSpace(promptText);
};

const theoryEvidenceBindingHint = (source: string): string =>
  `<bind from ${source}>`;

const theoryStructuredEvidenceBindingHint = (
  source: string,
): RecordLike => ({
  binding_required_from: source,
  authority: "current_turn_evidence_only",
});

const minecraftPositionFromPrompt = (
  promptText: string,
): { x: number; y: number; z: number } | null => {
  const match = promptText.match(
    /\bx\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*[,;]?\s*y\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*[,;]?\s*z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (!match) return null;
  const [x, y, z] = match.slice(1).map(Number);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    Math.abs(x) > 30_000_000 ||
    y < -2_048 ||
    y > 2_048 ||
    Math.abs(z) > 30_000_000
  ) {
    return null;
  }
  return { x, y, z };
};

const minecraftVerificationEndpointsFromPrompt = (
  promptText: string,
): {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
} | null => {
  const positions = Array.from(
    promptText.matchAll(
      /\bx\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*[,;]?\s*y\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*[,;]?\s*z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/gi,
    ),
  )
    .slice(0, 2)
    .map((match) => {
      const [x, y, z] = match.slice(1).map(Number);
      return { x, y, z };
    });
  // An exact single-block verification is the degenerate one-cell volume.
  // Preserve the canonical inclusive from/to contract so the connector and
  // provenance gates do not need a second argument shape.
  if (positions.length === 1) {
    positions.push({ ...positions[0]! });
  }
  if (
    positions.length !== 2 ||
    positions.some(
      ({ x, y, z }) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z) ||
        Math.abs(x) > 30_000_000 ||
        y < -2_048 ||
        y > 2_048 ||
        Math.abs(z) > 30_000_000,
    )
  ) {
    return null;
  }
  return { from: positions[0]!, to: positions[1]! };
};

const minecraftExpectedVerificationBlockFromPrompt = (
  promptText: string,
): string | null => {
  const match = promptText.match(
    /\b(?:as\s+)?exact(?:ly)?\s+(minecraft:[a-z0-9_./-]+)\b|\bexpected(?:[_\s-]+block)?\s*[:=]\s*(minecraft:[a-z0-9_./-]+)\b/i,
  );
  return (match?.[1] ?? match?.[2] ?? "").toLowerCase() || null;
};

const minecraftFreshnessRequirementFromPrompt = (
  promptText: string,
): number | null => {
  const match = promptText.match(
    /\b(\d{3,6})\s*ms\b[\s\S]{0,40}\b(?:freshness|fresh)\b|\b(?:freshness|fresh)\b[\s\S]{0,40}\b(\d{3,6})\s*ms\b/i,
  );
  const freshnessMs = Number(match?.[1] ?? match?.[2]);
  return Number.isInteger(freshnessMs) &&
    freshnessMs >= 1_000 &&
    freshnessMs <= 120_000
    ? freshnessMs
    : null;
};

const minecraftBuildNumberWords = new Map<string, number>([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
]);

const minecraftBuildDimensionFromPrompt = (
  promptText: string,
  dimension: "long" | "high",
): number | null => {
  const match = promptText.match(
    new RegExp(
      `\\b(\\d{1,2}|${Array.from(minecraftBuildNumberWords.keys()).join("|")})\\s+blocks?\\s+${dimension}\\b`,
      "i",
    ),
  );
  if (!match?.[1]) return null;
  const normalizedValue = match[1].toLowerCase();
  const numeric = /^\d+$/.test(normalizedValue)
    ? Number(normalizedValue)
    : minecraftBuildNumberWords.get(normalizedValue);
  return Number.isInteger(numeric) ? Number(numeric) : null;
};

const minecraftSpatialInspectionPurposeFromPrompt = (
  promptText: string,
):
  | "fire_safety"
  | "landing_safety"
  | "movement_safety"
  | "structure_planning"
  | "general" => {
  // `fire_safety` is the hearth/fireplace candidate projection. A generic
  // movement-safety clause such as "no nearby fire" still needs the complete
  // bounded geometry, not a fireplace-only candidate list. Keep this selector
  // tied to an affirmative hearth/ignition objective rather than the mere
  // presence of a hazard word.
  const fireObjectiveMatch = promptText.match(
    /\b(?:inspect|describe|find|check|locate|verify)\b[^.!?]{0,160}\b(?:fireplace|hearth)\b|\b(?:ignite|light|start)\b[^.!?]{0,50}\b(?:a\s+)?(?:fire|fireplace|hearth)\b/i,
  );
  const fireObjectivePrefix = fireObjectiveMatch?.index === undefined
    ? ""
    : promptText.slice(
        Math.max(0, fireObjectiveMatch.index - 70),
        fireObjectiveMatch.index,
      );
  const affirmativeFireObjective = Boolean(fireObjectiveMatch) &&
    !/\b(?:do\s+not|don['â€™]t|never|later|might|may|previously|earlier|screen\s+says|display\s+says|quoted?)\b/i.test(
      fireObjectivePrefix,
  );
  if (affirmativeFireObjective) return "fire_safety";
  if (
    /\b(?:walk|move|movement|step)\b/i.test(promptText) &&
    /\b(?:safe|walkable|headroom|solid\s+(?:ground|support)|cardinal\s+direction|no\s+(?:nearby\s+)?(?:fire|drop|hazard))\b/i.test(
      promptText,
    )
  ) {
    return "movement_safety";
  }
  if (/\b(?:fall|landing|rescue)\b/i.test(promptText)) {
    return "landing_safety";
  }
  if (
    /\b(?:build|construct|structure|wall|house|base|surround|enclose)\b/i.test(
      promptText,
    )
  ) {
    return "structure_planning";
  }
  return "general";
};

const minecraftGuardedNoopFamilyFromPrompt = (
  promptText: string,
): "structure_planning" | "fire_safety" | "movement_safety" | null => {
  const guardedMovementNoopClause = promptText.match(
    /\bif\s+(?:no\s+safe\s+(?:direction|step|path)(?:\s+(?:is|can\s+be))?\s+(?:evidenced|verified|found|available|identified)|a\s+safe\s+(?:direction|step|path)\s+(?:is|can\s+be)\s+not\s+(?:evidenced|verified|found|available|identified))\s*[,]?[^.!?]{0,120}\b(?:do\s+not|don['’]t|must\s+not)\s+(?:move|walk|step)\b/i,
  );
  if (guardedMovementNoopClause) return "movement_safety";
  const guardedNoopClause = promptText.match(
    /\bif\s+(?:no\s+safe\s+(?:site|location|spot|place|candidate|build(?:ing)?\s+line|fireplace|hearth)(?:\s+(?:is|can\s+be))?\s+(?:verified|found|available|identified)|a\s+safe\s+(?:site|location|spot|place|candidate|build(?:ing)?\s+line|fireplace|hearth)\s+(?:is|can\s+be)\s+not\s+(?:verified|found|available|identified))\s*[,]?[^.!?]{0,100}\b(?:do\s+not|don['’]t|must\s+not)\s+(?:build|construct|place|fill|set|change|modify|mutate|light|ignite|start)\b/i,
  );
  if (!guardedNoopClause) return null;
  if (/\b(?:fire|fireplace|hearth|ignite|light)\b/i.test(guardedNoopClause[0])) {
    return "fire_safety";
  }
  if (
    /\b(?:build|construct|wall|house|base|surround|enclose|site|location|spot|place|build(?:ing)?\s+line)\b/i.test(
      guardedNoopClause[0],
    )
  ) {
    return "structure_planning";
  }
  return null;
};

const minecraftGuardedNoopPolicyForSubgoal = (input: {
  turnId: string;
  promptText: string;
  match: ExtractedExplicitCapabilityContract;
  ordered: ExtractedExplicitCapabilityContract[];
}): HelixCompoundCapabilitySubgoal["guarded_noop_policy"] => {
  if (
    input.match.contract.capability !== HELIX_MINECRAFT_COMMAND_CAPABILITY &&
    input.match.contract.capability !== HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY
  ) {
    return undefined;
  }
  const family = minecraftGuardedNoopFamilyFromPrompt(input.promptText);
  if (!family) return undefined;
  const guardIndex = input.ordered.findIndex(
    (candidate) =>
      candidate.contract.capability ===
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
  );
  if (guardIndex < 0) return undefined;
  return {
    schema: "helix.compound_capability_guarded_noop.v1",
    mode: "no_verified_safe_candidate",
    guard_subgoal_id: subgoalIdFor(
      input.turnId,
      guardIndex + 1,
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ),
    guard_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    required_purpose: family,
    accepted_observation_purposes:
      family === "fire_safety"
        ? ["fire_safety"]
        : family === "movement_safety"
          ? ["movement_safety"]
        : ["structure_planning", "build_planning"],
    candidate_field:
      family === "fire_safety"
        ? "fireplace_candidates"
        : family === "movement_safety"
          ? "walk_step_candidates"
        : "build_line_candidates",
    completeness_field:
      family === "fire_safety"
        ? "fireplace_candidates_complete"
        : family === "movement_safety"
          ? "walk_step_candidates_complete"
        : "build_line_candidates_complete",
    omitted_count_field:
      family === "fire_safety"
        ? "omitted_fireplace_candidate_count"
        : family === "movement_safety"
          ? "omitted_walk_step_candidate_count"
        : "omitted_build_line_candidate_count",
    current_turn_only: true,
    requires_successful_observation: true,
    user_directed_noop_guard: true,
  };
};

const minecraftCommandIsConditionalOnPriorInspection = (input: {
  promptText: string;
  match: ExtractedExplicitCapabilityContract;
  ordered: ExtractedExplicitCapabilityContract[];
}): boolean => {
  if (input.match.contract.capability !== HELIX_MINECRAFT_COMMAND_CAPABILITY) {
    return false;
  }
  const commandIndex = input.ordered.indexOf(input.match);
  const inspectionPrecedesCommand = input.ordered
    .slice(0, commandIndex)
    .some(
      (candidate) =>
        candidate.contract.capability ===
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    );
  if (!inspectionPrecedesCommand) return false;
  return (
    /\b(?:if|only\s+if|provided\s+that)\b[^.!?]{0,120}\b(?:safe|suitable|clear|appropriate|acceptable)\b[^.!?]{0,140}\b(?:arm|build|construct|place|set|fill|ignite|light|start|change|mutate|execute|run)\b/iu.test(
      input.promptText,
    ) ||
    /\b(?:arm|build|construct|place|set|fill|ignite|light|start|change|mutate|execute|run)\b[^.!?]{0,100}\bonly\s+if\b[^.!?]{0,120}\b(?:safe|suitable|clear|appropriate|acceptable)\b/iu.test(
      input.promptText,
    )
  );
};

const environmentDurableGoalIdFromPrompt = (
  promptText: string,
): string | null =>
  promptText.match(
    /\benvironment_durable_goal:[A-Za-z0-9][A-Za-z0-9._:-]{7,319}\b/u,
  )?.[0] ?? null;

const argsHintForSubgoal = (input: {
  turnId: string;
  promptText: string;
  match: ExtractedExplicitCapabilityContract;
  ordered: ExtractedExplicitCapabilityContract[];
}): RecordLike => {
  const capability = input.match.contract.capability;
  const boundedPromptArg = (): string =>
    boundedPromptArgForSubgoal(input.promptText, input.match, input.ordered);
  if (
    capability === HELIX_ENVIRONMENT_REASONING_ROLE_INSPECT_CAPABILITY ||
    capability === HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY
  ) {
    const goalId = environmentDurableGoalIdFromPrompt(input.promptText);
    return goalId ? { goal_id: goalId } : {};
  }
  if (capability === HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY) {
    const goalId = environmentDurableGoalIdFromPrompt(input.promptText);
    return goalId ? { goal_id: goalId } : {};
  }
  if (input.match.contract.capability_family === "calculator") {
    const expression = extractCalculatorSubgoalExpression(
      input.promptText,
      input.match,
      findNextCapabilityIndex(input.promptText, input.match, input.ordered),
    );
    return expression
      ? { latex: expression, expression }
      : {};
  }
  if (minecraftSituationCapabilities.has(capability)) {
    const position = minecraftPositionFromPrompt(input.promptText);
    if (capability === HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY) {
      const verificationEndpoints =
        minecraftVerificationEndpointsFromPrompt(input.promptText);
      const expectedVerificationBlock =
        minecraftExpectedVerificationBlockFromPrompt(input.promptText);
      const exactStructureVerification = Boolean(
        verificationEndpoints &&
          expectedVerificationBlock &&
          /\b(?:verify|verification|exact(?:ly)?|mismatches?)\b/i.test(
            input.promptText,
          ),
      );
      const freshnessRequirementMs =
        minecraftFreshnessRequirementFromPrompt(input.promptText);
      if (
        exactStructureVerification &&
        verificationEndpoints &&
        expectedVerificationBlock
      ) {
        return {
          target: "current_actor",
          purpose: "structure_verification",
          verification_from: verificationEndpoints.from,
          verification_to: verificationEndpoints.to,
          expected_block: expectedVerificationBlock,
          ...(freshnessRequirementMs
            ? { freshness_requirement_ms: freshnessRequirementMs }
            : {}),
        };
      }
      const purpose = minecraftSpatialInspectionPurposeFromPrompt(
        input.promptText,
      );
      const requestedLength = minecraftBuildDimensionFromPrompt(
        input.promptText,
        "long",
      );
      const requestedHeight = minecraftBuildDimensionFromPrompt(
        input.promptText,
        "high",
      );
      const orientation = /\bnorth[\s-]*south\b/i.test(input.promptText)
        ? "north_south"
        : /\beast[\s-]*west\b/i.test(input.promptText)
          ? "east_west"
          : null;
      const relativeSide = /\bwest\s+of\b/i.test(input.promptText)
        ? "west"
        : /\beast\s+of\b/i.test(input.promptText)
          ? "east"
          : /\bnorth\s+of\b/i.test(input.promptText)
            ? "north"
            : /\bsouth\s+of\b/i.test(input.promptText)
              ? "south"
              : null;
      return {
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 6,
        purpose,
        ...(Number.isInteger(requestedLength) &&
        requestedLength >= 3 &&
        requestedLength <= 15
          ? { requested_length: requestedLength }
          : {}),
        ...(Number.isInteger(requestedHeight) &&
        requestedHeight >= 3 &&
        requestedHeight <= 8
          ? { requested_height: requestedHeight }
          : {}),
        ...(orientation ? { orientation } : {}),
        ...(relativeSide ? { relative_side: relativeSide } : {}),
      };
    }
    if (
      capability === HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY ||
      capability === HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY
    ) {
      return position ? { target: "position", position } : {};
    }
    if (capability === HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY) {
      return position
        ? { target: "position", position }
        : { target: "current_focus" };
    }
    return { target: "current_actor" };
  }
  if (capability === HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY) {
    const evidenceSelectedDirection =
      minecraftSpatialInspectionPurposeFromPrompt(input.promptText) ===
      "movement_safety";
    const direction = /\b(?:backward|back)\b/iu.test(input.promptText)
      ? "back"
      : /\bleft\b/iu.test(input.promptText)
        ? "left"
        : /\bright\b/iu.test(input.promptText)
          ? "right"
          : "forward";
    const explicitDuration = input.promptText.match(
      /\b(\d{2,5})\s*(?:ms|milliseconds?)\b/iu,
    );
    const durationMs = Number(explicitDuration?.[1]);
    return {
      ...(evidenceSelectedDirection ? {} : { direction }),
      duration_ms:
        Number.isInteger(durationMs) && durationMs >= 50 && durationMs <= 10_000
          ? durationMs
          : 250,
      sprint: /\bsprint(?:ing)?\b/iu.test(input.promptText),
    };
  }
  if (capability === HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY) {
    const numericCount = Number(
      input.promptText.match(/\bjump\s+(\d{1,2})\s+times?\b/iu)?.[1],
    );
    const count = Number.isInteger(numericCount) && numericCount >= 1
      ? Math.min(10, numericCount)
      : /\bjump\s+twice\b/iu.test(input.promptText)
        ? 2
        : 1;
    return { count };
  }
  if (capability === HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY) {
    const explicitPathPrefixMatch = input.promptText.match(
      /\bpath[_\s-]*prefix\b\s*(?:[:=]\s*)?(?:"([^"\r\n]{1,1000})"|'([^'\r\n]{1,1000})'|`([^`\r\n]{1,1000})`)/i,
    );
    const explicitPathPrefix = String(
      explicitPathPrefixMatch?.[1] ??
        explicitPathPrefixMatch?.[2] ??
        explicitPathPrefixMatch?.[3] ??
        "",
    ).trim();
    const explicitLimitMatch = input.promptText.match(
      /\blimit\b\s*(?:[:=]\s*)?(\d{1,3})\b/i,
    );
    const explicitLimit = Number.parseInt(explicitLimitMatch?.[1] ?? "", 10);
    if (explicitPathPrefix) {
      return {
        path_prefix: explicitPathPrefix,
        limit:
          Number.isInteger(explicitLimit) &&
          explicitLimit >= 1 &&
          explicitLimit <= 128
            ? explicitLimit
            : 64,
      };
    }
    if (/\b(?:wall|house|base|build|construct|structure)\b/i.test(input.promptText)) {
      return { path_prefix: "fill", limit: 64 };
    }
    if (/\b(?:fire|fireplace|hearth|ignite|light)\b/i.test(input.promptText)) {
      return { path_prefix: "setblock", limit: 64 };
    }
    if (/\b(?:fall|landing|rescue)\b/i.test(input.promptText)) {
      return { path_prefix: "helixgame fall_rescue", limit: 64 };
    }
    if (
      Number.isInteger(explicitLimit) &&
      explicitLimit >= 1 &&
      explicitLimit <= 128
    ) {
      return { limit: explicitLimit };
    }
  }
  if (capability === HELIX_MINECRAFT_COMMAND_CAPABILITY) {
    const quotedField = (field: string): string => {
      const match = input.promptText.match(
        new RegExp(
          String.raw`\b${field}\b\s*(?:[:=]\s*)?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|\x60([^\x60\r\n]+)\x60)`,
          "i",
        ),
      );
      return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
    };
    const command = quotedField("command").replace(/^\/+/, "");
    const category = quotedField("category");
    const effect = quotedField("effect");
    if (command) {
      return {
        command,
        ...(category ? { category } : {}),
        ...(effect ? { effect } : {}),
      };
    }
  }
  if (capability === "workspace_os.status") return {};
  if (capability === "helix_ask.inspect_capability_catalog") return {};
  if (capability === "live_env.query_micro_reasoner_presets") {
    return {
      include_presets: true,
      limit: 100,
      query: boundedPromptArg(),
    };
  }
  if (capability === "live_env.draft_micro_reasoner_preset") {
    return {
      scenario_text: boundedPromptArg(),
      base_preset_id: "stage_play_micro_reasoner_prompt_preset:generic-live-source:v1",
    };
  }
  if (capability === "live_env.route_micro_reasoner_prompt") {
    const prompt = boundedPromptArg();
    return {
      source_summary: prompt,
      candidate_prompts: [prompt],
    };
  }
  if (capability === "scholarly-research.lookup_papers") {
    return scholarlyLookupArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "scholarly-research.fetch_full_text") {
    return scholarlyFullTextArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "scholarly-research.extract_numeric_parameters") {
    return {
      text_evidence: boundedPromptArg(),
      requested_variables: [],
    };
  }
  if (capability === HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY) {
    // Planning hints expose the binding shape without inventing a valid mutation.
    // The selected model must replace these sentinels after the bounded sidecar
    // observation re-enters; the gateway then validates the complete proposal.
    return {
      document_id: "<bind from bounded Research Library sidecar observation>",
      proposal: {
        schema: HELIX_PAPER_EVIDENCE_ENRICHMENT_PROPOSAL_SCHEMA,
        proposal_status: "<model authoring required after sidecar evidence re-entry>",
      },
    };
  }
  if (capability === "workstation-notes.create" || capability === "workstation-notes.create_note") {
    return workstationNoteCreateArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "workstation-notes.append_to_note") {
    return workstationNoteArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "text_to_speech.speak_text") {
    return { text: boundedPromptArg() };
  }
  if (capability === "helix_ask.reflect_theory_context") {
    return {
      prompt: boundedPromptArg(),
      build_explanation_plan: true,
      sync_panel: true,
      panel_overlay_mode: "live_answer_context",
      open_panel: false,
    };
  }
  if (capability === THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY) {
    const procedureArgs = buildTheoryExperimentProcedurePromptArguments({
      promptText: input.promptText,
    });
    return procedureArgs.selected_badge_ids.length > 0
      ? procedureArgs
      : {
          ...procedureArgs,
          selected_badge_ids: [
            theoryEvidenceBindingHint(
              "current-turn registered Theory Badge selection",
            ),
          ],
        };
  }
  if (capability === THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY) {
    return {
      procedure_artifact_ref: theoryEvidenceBindingHint(
        "original retained theory experiment procedure observation",
      ),
      procedure_id: theoryEvidenceBindingHint(
        "exact retained theory experiment procedure identity",
      ),
      procedure_sha256: theoryEvidenceBindingHint(
        "exact retained theory experiment procedure content hash",
      ),
    };
  }
  if (
    capability ===
    THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY
  ) {
    return {
      prompt: boundedPromptArg(),
      procedure_id: theoryEvidenceBindingHint(
        "current-turn or explicitly readmitted theory experiment procedure",
      ),
      procedure_sha256: theoryEvidenceBindingHint(
        "exact theory experiment procedure content hash",
      ),
      procedure_artifact_ref: theoryEvidenceBindingHint(
        "theory experiment procedure observation",
      ),
    };
  }
  if (capability === THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY) {
    return {
      source_evidence_ref: theoryEvidenceBindingHint(
        "exact current-turn authoritative source packet artifact",
      ),
      source_packet: theoryStructuredEvidenceBindingHint(
        "current-turn Casimir Spec source packet",
      ),
      source_path: theoryEvidenceBindingHint(
        "source packet provenance path",
      ),
      receipt_id: theoryEvidenceBindingHint(
        "current-turn source provenance receipt",
      ),
    };
  }
  if (
    capability ===
    THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY
  ) {
    return {
      procedure_artifact_ref: theoryEvidenceBindingHint(
        "current-turn Theory Experiment Procedure artifact",
      ),
      procedure_id: theoryEvidenceBindingHint(
        "exact Theory Experiment Procedure ID",
      ),
      procedure_sha256: theoryEvidenceBindingHint(
        "exact Theory Experiment Procedure SHA-256",
      ),
      semantic_admission_artifact_ref: theoryEvidenceBindingHint(
        "current-turn semantic-admission artifact",
      ),
      case_id: theoryEvidenceBindingHint(
        "registered Lanyon case selection",
      ),
    };
  }
  if (capability === THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY) {
    return {
      request_artifact_ref: theoryEvidenceBindingHint(
        "current-turn prepared Lanyon request artifact",
      ),
      case_id: theoryEvidenceBindingHint(
        "registered Lanyon case selection",
      ),
    };
  }
  if (
    capability ===
    THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY
  ) {
    return {
      formal_artifact_id: theoryEvidenceBindingHint(
        "registered formal artifact family selection",
      ),
      theorem_name: theoryEvidenceBindingHint(
        "exact audited theorem selection",
      ),
    };
  }
  if (
    capability === THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY
  ) {
    return {
      procedure_artifact_ref: theoryEvidenceBindingHint(
        "current-turn theory experiment procedure observation",
      ),
      procedure_id: theoryEvidenceBindingHint(
        "exact theory experiment procedure identity",
      ),
      procedure_sha256: theoryEvidenceBindingHint(
        "exact theory experiment procedure hash",
      ),
      semantic_admission_artifact_ref: theoryEvidenceBindingHint(
        "current-turn semantic-admission observation",
      ),
      artifact_generation_artifact_ref: theoryEvidenceBindingHint(
        "current-turn formal-artifact producer observation",
      ),
      formal_source_admission_artifact_ref: theoryEvidenceBindingHint(
        "current-turn governed formal-source audit observation",
      ),
    };
  }
  if (
    capability === THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY ||
    capability === THEORY_FORMAL_VERIFIER_START_CAPABILITY
  ) {
    return {
      prepared_request_id: theoryEvidenceBindingHint(
        "ready server-owned formal prepared-request observation",
      ),
      ...(capability === THEORY_FORMAL_VERIFIER_START_CAPABILITY
        ? {
            plan_id: theoryEvidenceBindingHint(
              "formal verifier plan observation",
            ),
          }
        : {}),
    };
  }
  if (capability === THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY) {
    return {
      job_id: theoryEvidenceBindingHint(
        "formal verifier start observation",
      ),
    };
  }
  if (
    capability ===
    THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY
  ) {
    return {
      catalog_entry_id: theoryEvidenceBindingHint(
        "server-owned independent numerical execution catalog entry",
      ),
      procedure_id: theoryEvidenceBindingHint(
        "exact theory experiment procedure identifier",
      ),
      procedure_sha256: theoryEvidenceBindingHint(
        "exact theory experiment procedure hash",
      ),
    };
  }
  if (capability === THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY) {
    return {
      prepared_request_id: theoryEvidenceBindingHint(
        "independent numerical prepared-request observation",
      ),
    };
  }
  if (capability === THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY) {
    return {
      plan_id: theoryEvidenceBindingHint(
        "independent numerical verifier plan observation",
      ),
    };
  }
  if (
    capability ===
    THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY
  ) {
    return {
      job_id: theoryEvidenceBindingHint(
        "independent numerical verifier start observation",
      ),
    };
  }
  if (capability === "helix.theory.frontierVectorFieldTrace") {
    return {
      query: boundedPromptArg(),
      searchSeed: `ask:${stableTextHash(input.turnId)}:theory-frontier-vector-field`,
    };
  }
  if (capability === "helix_ask.reflect_ideology_context") {
    return {
      inputKind: "user_prompt",
      text: boundedPromptArg(),
      refs: ["helix-ask:current-turn"],
      options: {
        includeOverlay: true,
        includeRecommendedActions: true,
        includeAdmissionArtifacts: true,
        includeLocator: true,
        includeFruition: true,
        includeProceduralClassification: true,
      },
    };
  }
  if (capability === "helix_ask.bridge_theory_ideology_context") {
    return {
      prompt: boundedPromptArg(),
      refs: ["helix-ask:current-turn"],
      theory_reflection_ref: "step:reflect_theory_context",
      ideology_reflection_ref: "step:reflect_moral_graph_context",
    };
  }
  if (capability === "helix_ask.build_civilization_scenario_frame") {
    return {
      prompt: boundedPromptArg(),
      refs: ["helix-ask:current-turn"],
      options: {
        allowFictional: true,
        allowHistorical: true,
        includeNeedleScenarioFallback: true,
      },
    };
  }
  if (capability === "helix_ask.reflect_civilization_bounds") {
    return {
      prompt: boundedPromptArg(),
      scenarioFrameRef: "step:build_civilization_scenario_frame",
      source_ref: "step:build_civilization_scenario_frame",
      source_refs: ["step:build_civilization_scenario_frame"],
      refs: ["helix-ask:current-turn"],
      options: {
        includeBridgeContext: true,
        includeCollaborationBounds: true,
        includeFalsificationHooks: true,
      },
    };
  }
  if (input.match.contract.capability_family === "context_reflection") {
    return {
      prompt: boundedPromptArg(),
      refs: ["helix-ask:current-turn"],
    };
  }
  if (capability === "docs-viewer.locate_in_doc" || capability === "docs-viewer.doc_equation_context") {
    return docsLocateArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "docs-viewer.search_docs") {
    return docsSearchArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "docs-viewer.open_doc_by_path") {
    return docsOpenDocByPathArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "repo-code.search_concept") {
    return repoSearchArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "workspace-directory.resolve") {
    return workspaceResolveArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "internet_search.web_research") {
    return internetSearchArgs(input.promptText, input.match, input.ordered);
  }
  if (capability === "image_lens.inspect") return {};
  if (input.match.contract.required_args.includes("prompt")) {
    return { prompt: boundedPromptArg() };
  }
  return {};
};

const runtimeCapabilityForContract = (contract: ExplicitCapabilityContract): string =>
  contract.runtime_capability && contract.runtime_capability !== contract.capability
    ? contract.runtime_capability
    : contract.capability;

const contributionRoleForContract = (contract: ExplicitCapabilityContract): string => {
  if (contract.capability_family === "docs_viewer") return "document_evidence";
  if (contract.capability_family === "calculator") return "numeric_result";
  if (contract.capability_family === "internet_search" || contract.capability_family === "scholarly_research") {
    return "retrieved_evidence";
  }
  if (contract.capability_family === "context_reflection" || contract.capability_family === "theory_locator") {
    return "reflection";
  }
  if (contract.capability_family === "workspace_diagnostic") return "workspace_status";
  if (contract.capability_family === "capability_catalog") return "capability_catalog";
  if (contract.capability_family === "repo_code") return "repo_evidence";
  if (contract.capability_family === "visual_capture") return "visual_evidence";
  return contract.capability_family || "tool_observation";
};

const producedAffordancesForContract = (contract: ExplicitCapabilityContract): HelixWorkstationTypedAffordanceKind[] => {
  if (contract.capability_family === "calculator") return ["calculator_result", "numeric_value_evidence", "source_ref"];
  if (contract.capability_family === "docs_viewer") {
    return ["source_ref", "text_evidence", "citation_evidence", "numeric_value_evidence", "doc_path_ref"];
  }
  if (contract.capability_family === "repo_code") return ["source_ref", "text_evidence", "citation_evidence"];
  if (contract.capability_family === "internet_search" || contract.capability_family === "scholarly_research") {
    return ["source_ref", "text_evidence", "citation_evidence", "numeric_value_evidence"];
  }
  if (contract.capability_family === "context_reflection" || contract.capability_family === "theory_locator") {
    return ["theory_context", "calculator_expression_template", "claim_boundary", "frontier_candidate", "source_ref"];
  }
  if (contract.capability_family === "civilization_bounds") return ["theory_context", "claim_boundary", "source_ref"];
  if (contract.capability_family === "workspace_diagnostic" || contract.capability_family === "capability_catalog") {
    return ["system_status", "source_ref"];
  }
  if (contract.capability_family === "live_source_mail") return ["mail_packet_ref", "text_evidence", "source_ref"];
  if (contract.capability_family === "live_source_decision") return ["prediction_evidence", "source_ref"];
  if (contract.capability_family === "voice_delivery") return ["ui_projection_receipt", "source_ref"];
  if (contract.capability_family === "visual_capture") return ["visual_observer_eval", "source_ref", "text_evidence"];
  return ["source_ref"];
};

const consumedAffordancesForContract = (contract: ExplicitCapabilityContract): HelixWorkstationTypedAffordanceKind[] => {
  if (contract.capability_family === "calculator") {
    return ["bound_calculator_expression", "calculator_expression_template", "numeric_value_evidence"];
  }
  if (contract.capability_family === "voice_delivery") return ["voice_text_evidence", "text_evidence", "source_ref"];
  if (contract.capability_family === "docs_viewer") return ["doc_path_ref", "source_ref"];
  if (contract.capability_family === "civilization_bounds") return ["theory_context", "source_ref"];
  return [];
};

const requiredAffordanceKindsForBinding = (
  consumer: ExplicitCapabilityContract,
  source: ExplicitCapabilityContract,
): HelixWorkstationTypedAffordanceKind[] => {
  if (consumer.capability_family === "calculator") {
    if (source.capability_family === "context_reflection" || source.capability_family === "theory_locator") {
      return ["calculator_expression_template"];
    }
    if (source.capability_family === "internet_search" || source.capability_family === "scholarly_research" || source.capability_family === "docs_viewer") {
      return ["numeric_value_evidence"];
    }
    return ["source_ref"];
  }
  if (consumer.capability_family === "voice_delivery") return ["voice_text_evidence", "text_evidence"];
  if (consumer.capability_family === "docs_viewer") return ["doc_path_ref"];
  return producedAffordancesForContract(source).slice(0, 2);
};

const requiredObservationKindsForCompoundSubgoal = (
  contract: ExplicitCapabilityContract,
  subgoalCount: number,
): string[] => {
  if (subgoalCount > 1 && contract.capability === "helix_ask.inspect_capability_catalog") {
    return ["capability_registry"];
  }
  return [...contract.required_observation_kinds];
};

const subgoalIdFor = (turnId: string, order: number, capability: string): string =>
  `${turnId}:compound_capability_subgoal:${order}:${capability.replace(/[^A-Za-z0-9_-]+/g, "_")}`;

const SUBGOAL_BINDING_SOURCE_FAMILIES = new Set([
  "internet_search",
  "scholarly_research",
  "docs_viewer",
  "repo_code",
  "visual_capture",
  "workspace_diagnostic",
  "workspace_directory",
  "capability_catalog",
  "live_source_mail",
  "context_reflection",
  "theory_locator",
  "moral_graph_reflection",
  "civilization_bounds",
]);

const SUBGOAL_BINDING_CONSUMER_FAMILIES = new Set([
  "calculator",
  "docs_viewer",
  "context_reflection",
  "theory_locator",
  "scholarly_research",
  "live_source_mail",
  "live_source_decision",
  "voice_delivery",
  "moral_graph_reflection",
  "civilization_bounds",
]);

const bindingShapeForConsumer = (
  contract: ExplicitCapabilityContract,
  sourceCount: number,
  source?: ExplicitCapabilityContract | null,
): {
  arg_name:
    | "paper_result_or_source"
    | "source_ref"
    | "source_refs"
    | "target_ref"
    | "evidence_refs"
    | "support_refs"
    | "scenarioFrameRef"
    | "theory_reflection_ref"
    | "ideology_reflection_ref";
  binding_kind: "source_ref" | "target_ref" | "support_ref";
} => {
  if (contract.capability === "scholarly-research.fetch_full_text") {
    return {
      arg_name: "paper_result_or_source",
      binding_kind: "source_ref",
    };
  }
  if (contract.capability === "scholarly-research.extract_numeric_parameters") {
    return {
      arg_name: "source_ref",
      binding_kind: "source_ref",
    };
  }
  if (contract.capability_family === "calculator") {
    return {
      arg_name: "support_refs",
      binding_kind: "support_ref",
    };
  }
  if (contract.capability_family === "docs_viewer") {
    return {
      arg_name: "target_ref",
      binding_kind: "target_ref",
    };
  }
  if (contract.capability === "live_env.request_interim_voice_callout") {
    return {
      arg_name: "evidence_refs",
      binding_kind: "support_ref",
    };
  }
  if (contract.capability === "live_env.record_live_source_mail_decision") {
    return {
      arg_name: "evidence_refs",
      binding_kind: "support_ref",
    };
  }
  if (
    contract.capability === "helix_ask.reflect_civilization_bounds" &&
    source?.capability === "helix_ask.build_civilization_scenario_frame"
  ) {
    return {
      arg_name: "scenarioFrameRef",
      binding_kind: "source_ref",
    };
  }
  if (contract.capability === "helix_ask.bridge_theory_ideology_context") {
    if (source?.capability === "helix_ask.reflect_theory_context") {
      return {
        arg_name: "theory_reflection_ref",
        binding_kind: "source_ref",
      };
    }
    if (source?.capability === "helix_ask.reflect_ideology_context") {
      return {
        arg_name: "ideology_reflection_ref",
        binding_kind: "source_ref",
      };
    }
  }
  return {
    arg_name: sourceCount === 1 ? "source_ref" : "source_refs",
    binding_kind: "source_ref",
  };
};

const canBindSourceToConsumer = (
  source: ExplicitCapabilityContract,
  consumer: ExplicitCapabilityContract,
): boolean => {
  if (consumer.capability === "live_env.summarize_live_source_current_state") {
    return (
      source.capability === "live_env.query_live_source_quality" ||
      source.capability === "live_env.query_workstation_goal_context"
    );
  }
  if (consumer.capability_family === "docs_viewer") {
    return source.capability_family === "workspace_directory";
  }
  if (consumer.capability === "scholarly-research.fetch_full_text") {
    return source.capability === "scholarly-research.lookup_papers";
  }
  if (consumer.capability === "scholarly-research.extract_numeric_parameters") {
    return source.capability === "scholarly-research.fetch_full_text";
  }
  if (consumer.capability_family === "scholarly_research") return false;
  if (consumer.capability === "live_env.request_interim_voice_callout") {
    return source.capability === "live_env.record_live_source_mail_decision";
  }
  if (consumer.capability === "live_env.record_live_source_mail_decision") {
    return source.capability_family === "live_source_mail";
  }
  return SUBGOAL_BINDING_SOURCE_FAMILIES.has(source.capability_family);
};

const inputBindingsForSubgoal = (input: {
  turnId: string;
  match: ExtractedExplicitCapabilityContract;
  ordered: ExtractedExplicitCapabilityContract[];
  index: number;
}) => {
  const contract = input.match.contract;
  if (!SUBGOAL_BINDING_CONSUMER_FAMILIES.has(contract.capability_family)) return [];
  const priorEvidenceSubgoals = input.ordered.slice(0, input.index)
    .map((entry: ExtractedExplicitCapabilityContract, priorIndex: number) => ({ entry, priorIndex }))
    .filter(({ entry }) => canBindSourceToConsumer(entry.contract, contract));
  return priorEvidenceSubgoals.map(({ entry, priorIndex }, bindingIndex: number) => ({
    binding_id: `${subgoalIdFor(input.turnId, input.index + 1, contract.capability)}:input_binding:${bindingIndex + 1}`,
    ...bindingShapeForConsumer(contract, priorEvidenceSubgoals.length, entry.contract),
    from_subgoal_id: subgoalIdFor(input.turnId, priorIndex + 1, entry.contract.capability),
    from_capability: entry.contract.capability,
    required_observation_kinds: requiredObservationKindsForCompoundSubgoal(entry.contract, input.ordered.length),
    required_affordance_kinds: requiredAffordanceKindsForBinding(contract, entry.contract),
    required: true,
    status: "pending" as const,
  }));
};

export const buildHelixCompoundCapabilityContract = (input: {
  turnId: string;
  promptText: string;
  trustedEnvironmentContext?: ExplicitCapabilityExtractionContext | null;
}): HelixCompoundCapabilityContract | null => {
  const ordered = extractPlannerBindingCapabilityContracts(
    input.promptText,
    input.trustedEnvironmentContext,
  );
  if (ordered.length === 0) return null;
  const capabilityTotals = new Map<string, number>();
  for (const match of ordered) {
    const capability = match.contract.capability;
    capabilityTotals.set(
      capability,
      (capabilityTotals.get(capability) ?? 0) + 1,
    );
  }
  const occurrenceAwareSubgoals = Array.from(capabilityTotals.values()).some(
    (count) => count > 1,
  );
  const capabilityOccurrenceCounts = new Map<string, number>();
  const subgoals = ordered.map((match: ExtractedExplicitCapabilityContract, index: number): HelixCompoundCapabilitySubgoal => {
    const contract = match.contract;
    const requestedCapability = contract.capability;
    const capabilityOccurrence =
      (capabilityOccurrenceCounts.get(requestedCapability) ?? 0) + 1;
    capabilityOccurrenceCounts.set(
      requestedCapability,
      capabilityOccurrence,
    );
    const subgoalId = subgoalIdFor(input.turnId, index + 1, requestedCapability);
    const inputBindings = inputBindingsForSubgoal({
      turnId: input.turnId,
      match,
      ordered,
      index,
    });
    const guardedNoopPolicy = minecraftGuardedNoopPolicyForSubgoal({
      turnId: input.turnId,
      promptText: input.promptText,
      match,
      ordered,
    });
    const conditionalOnPriorInspection =
      minecraftCommandIsConditionalOnPriorInspection({
        promptText: input.promptText,
        match,
        ordered,
      });
    return {
      subgoal_id: subgoalId,
      order: index + 1,
      requested_capability: requestedCapability,
      runtime_capability: runtimeCapabilityForContract(contract),
      capability_family: contract.capability_family,
      plan_family: contract.plan_family,
      source_target: contract.source_target,
      admission_families: [...contract.admission_families],
      required_args: [...contract.required_args],
      optional_args: [...contract.optional_args],
      args_hint: argsHintForSubgoal({
        turnId: input.turnId,
        promptText: input.promptText,
        match,
        ordered,
      }),
      required_observation_kinds: requiredObservationKindsForCompoundSubgoal(contract, ordered.length),
      produced_affordance_kinds: producedAffordancesForContract(contract),
      consumed_affordance_kinds: consumedAffordancesForContract(contract),
      missing_affordance_kinds: [],
      required_terminal_kind: contract.required_terminal_kind,
      contribution_role: contributionRoleForContract(contract),
      terminal_contribution_kind: contract.required_terminal_kind,
      allowed_substitutions: [...contract.allowed_substitutions],
      forbidden_nearby_capabilities: [...contract.forbidden_nearby_capabilities],
      depends_on_subgoal_ids: inputBindings.map((binding) => binding.from_subgoal_id),
      input_bindings: inputBindings,
      ...(occurrenceAwareSubgoals
        ? {
            subgoal_identity_policy: "provider_call_occurrence" as const,
            provider_call_id: null,
            capability_occurrence: capabilityOccurrence,
          }
        : {}),
      ...(guardedNoopPolicy
        ? { guarded_noop_policy: guardedNoopPolicy }
        : {}),
      status: "pending",
      mandatory: !conditionalOnPriorInspection,
    };
  });
  const mandatorySubgoals = subgoals.filter(
    (subgoal) => subgoal.mandatory !== false,
  );
  return {
    schema: HELIX_COMPOUND_CAPABILITY_CONTRACT_SCHEMA,
    turn_id: input.turnId,
    prompt_shape: subgoals.length > 1 ? "compound_capability" : "single_capability",
    subgoals,
    required_capabilities: unique(
      mandatorySubgoals.map(
        (subgoal: HelixCompoundCapabilitySubgoal) =>
          subgoal.requested_capability,
      ),
    ),
    ...(occurrenceAwareSubgoals
      ? { subgoal_identity_policy: "provider_call_occurrence" as const }
      : {}),
    requires_all_subgoals:
      subgoals.length > 1 &&
      subgoals.every((subgoal) => subgoal.mandatory !== false),
    terminal_policy: "synthesize_from_satisfied_subgoal_observations",
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const buildHelixSingleCapabilityContractFromAdmission = (input: {
  turnId: string;
  promptText: string;
  contract: ExplicitCapabilityContract;
  argsHint?: RecordLike | null;
}): HelixCompoundCapabilityContract => {
  const match: ExtractedExplicitCapabilityContract = {
    contract: input.contract,
    capability: input.contract.capability,
    matched_name: input.contract.capability,
    match_index: 0,
    match_end_index: 0,
    source: "command_mention",
  };
  const ordered = [match];
  const requestedCapability = input.contract.capability;
  const subgoal: HelixCompoundCapabilitySubgoal = {
    subgoal_id: subgoalIdFor(input.turnId, 1, requestedCapability),
    order: 1,
    requested_capability: requestedCapability,
    runtime_capability: runtimeCapabilityForContract(input.contract),
    capability_family: input.contract.capability_family,
    plan_family: input.contract.plan_family,
    source_target: input.contract.source_target,
    admission_families: [...input.contract.admission_families],
    required_args: [...input.contract.required_args],
    optional_args: [...input.contract.optional_args],
    args_hint:
      input.argsHint ??
      argsHintForSubgoal({
        turnId: input.turnId,
        promptText: input.promptText,
        match,
        ordered,
      }),
    required_observation_kinds: requiredObservationKindsForCompoundSubgoal(
      input.contract,
      1,
    ),
    produced_affordance_kinds: producedAffordancesForContract(input.contract),
    consumed_affordance_kinds: consumedAffordancesForContract(input.contract),
    missing_affordance_kinds: [],
    required_terminal_kind: input.contract.required_terminal_kind,
    contribution_role: contributionRoleForContract(input.contract),
    terminal_contribution_kind: input.contract.required_terminal_kind,
    allowed_substitutions: [...input.contract.allowed_substitutions],
    forbidden_nearby_capabilities: [
      ...input.contract.forbidden_nearby_capabilities,
    ],
    depends_on_subgoal_ids: [],
    input_bindings: [],
    status: "pending",
    mandatory: true,
  };
  return {
    schema: HELIX_COMPOUND_CAPABILITY_CONTRACT_SCHEMA,
    turn_id: input.turnId,
    prompt_shape: "single_capability",
    subgoals: [subgoal],
    required_capabilities: [requestedCapability],
    requires_all_subgoals: false,
    terminal_policy: "synthesize_from_satisfied_subgoal_observations",
    assistant_answer: false,
    raw_content_included: false,
  };
};

/**
 * Adds a policy-required read-only grounding observation ahead of an existing
 * semantic capability program. The grounding step is part of the itinerary
 * presented to Codex; Helix does not privately execute it. Later subgoals are
 * blocked on its current-turn observation so command authoring cannot outrun
 * the mechanics evidence that makes it safe and syntactically valid.
 */
export const prependHelixRequiredGroundingCapability = (input: {
  turnId: string;
  promptText: string;
  compoundContract: HelixCompoundCapabilityContract;
  groundingContract: ExplicitCapabilityContract;
  argsHint: RecordLike;
}): HelixCompoundCapabilityContract => {
  const runtimeCapability = runtimeCapabilityForContract(
    input.groundingContract,
  );
  if (
    input.compoundContract.subgoals.some(
      (subgoal) =>
        subgoal.requested_capability === input.groundingContract.capability ||
        subgoal.runtime_capability === runtimeCapability,
    )
  ) {
    return input.compoundContract;
  }
  const groundingSubgoal = buildHelixSingleCapabilityContractFromAdmission({
    turnId: input.turnId,
    promptText: input.promptText,
    contract: input.groundingContract,
    argsHint: input.argsHint,
  }).subgoals[0];
  const groundingSubgoalId = groundingSubgoal.subgoal_id;
  const rebasedSubgoals = input.compoundContract.subgoals.map(
    (subgoal, index): HelixCompoundCapabilitySubgoal => ({
      ...subgoal,
      order: index + 2,
      depends_on_subgoal_ids: unique([
        groundingSubgoalId,
        ...subgoal.depends_on_subgoal_ids,
      ]),
    }),
  );
  return {
    ...input.compoundContract,
    prompt_shape: "compound_capability",
    subgoals: [groundingSubgoal, ...rebasedSubgoals],
    required_capabilities: unique([
      input.groundingContract.capability,
      ...input.compoundContract.required_capabilities,
    ]),
    requires_all_subgoals: true,
  };
};

export const firstPendingCompoundCapabilitySubgoal = (
  contract: HelixCompoundCapabilityContract | null | undefined,
  ledger: Array<RecordLike> | null | undefined,
): HelixCompoundCapabilitySubgoal | null => {
  if (!contract?.subgoals?.length) return null;
  const satisfied = new Set(
    (Array.isArray(ledger) ? ledger : [])
      .filter((entry: RecordLike) => readString(entry.satisfaction) === "satisfied")
      .map((entry: RecordLike) => readString(entry.subgoal_id))
      .filter(Boolean),
  );
  return contract.subgoals.find((subgoal: HelixCompoundCapabilitySubgoal) => !satisfied.has(subgoal.subgoal_id)) ?? null;
};
