import type {
  HelixApiParityExpected,
  HelixApiParityScenario,
} from "./api-parity-matrix";
import {
  CODEX_PARITY_AGENT_SPINE_CLASSES,
  CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS,
  CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS,
  CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES,
  CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
  CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES,
  CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS,
  CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS,
  isCodexParityAgentSpineRailFailureCode,
} from "./codex-parity-agent-spine-contract";
import { HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION } from "./terminal-rail-failure-reconciliation";
import { authoritativeTypedFailureRequiresNoContinuation } from "./runtime/typed-failure-lifecycle-reconciliation";

type RecordLike = Record<string, unknown>;

const API_PARITY_COMPOUND_STRING_OR_NULL_FIELDS = [
  "first_incomplete_compound_subgoal_id",
  "first_incomplete_compound_requested_capability",
  "first_incomplete_compound_runtime_capability",
  "first_incomplete_compound_selected_capability",
  "first_incomplete_compound_executed_capability",
  "compound_first_broken_rail",
  "compound_rail_failure_code",
  "compound_repair_target",
] as const satisfies readonly (typeof CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS)[number][];

export type HelixApiParityCompoundSubgoalRailSummary = {
  subgoal_id: string | null;
  order: number | null;
  requested_capability: string | null;
  runtime_capability: string | null;
  selected_capability: string | null;
  executed_capability: string | null;
  args_present: boolean;
  observation_kind: string | null;
  observation_ref: string | null;
  observation_provenance: string | null;
  satisfaction: string | null;
  rail_status: string | null;
  first_broken_rail: string | null;
  rail_failure_code: string | null;
  repair_target: string | null;
};

export type HelixApiParityRailTableSummary = {
  present: boolean;
  turn_id: string | null;
  prompt: string | null;
  requested_capability: string | null;
  visible_tool_surface: string[];
  visible_tool_surface_original_count: number | null;
  visible_tool_surface_truncated: boolean | null;
  selected_capability: string | null;
  admitted_capability: string | null;
  admission_proof_source: string | null;
  admission_proven: boolean;
  executed_capability: string | null;
  compound_subgoal_count: number | null;
  first_incomplete_compound_subgoal_id: string | null;
  first_incomplete_compound_requested_capability: string | null;
  first_incomplete_compound_runtime_capability: string | null;
  first_incomplete_compound_selected_capability: string | null;
  first_incomplete_compound_executed_capability: string | null;
  compound_first_broken_rail: string | null;
  compound_rail_failure_code: string | null;
  compound_repair_target: string | null;
  compound_incomplete_subgoal_did_tool_run: boolean | null;
  compound_subgoal_rails: HelixApiParityCompoundSubgoalRailSummary[];
  observation_kind: string | null;
  observation_ref: string | null;
  required_observation_kinds_for_requested_capability: string[];
  observed_artifact_supports_requested_capability: boolean | null;
  reentry_status: string | null;
  reentry_proof_source: string | null;
  reentry_proven: boolean;
  goal_satisfaction: string | null;
  required_terminal_kind: string | null;
  selected_terminal_kind: string | null;
  terminal_authority_proof_source: string | null;
  terminal_authority_proven: boolean;
  visible_terminal_kind: string | null;
  visible_projection_source: string | null;
  visible_projection_proven: boolean;
  first_broken_rail: string | null;
  repair_target: string | null;
  codex_parity_class: string | null;
  normalized_codex_parity_classes: string[];
  rail_status: string | null;
  rail_failure_code: string | null;
  assistant_answer: boolean | null;
  terminal_eligible: boolean | null;
  raw_content_included: boolean | null;
};

export type HelixApiParityProbeResult = {
  schema: "helix.api_parity_probe_result.v1";
  scenario_id: string;
  prompt: string;
  non_stream_turn_id: string;
  stream_turn_id?: string;
  debug_export_available: boolean;
  terminal_event_seen: boolean;
  stream_closed_after_terminal: boolean;
  source_target: string | null;
  target_kind: string | null;
  selected_route: string | null;
  terminal_artifact_kind: string | null;
  final_answer_source: string | null;
  loop_parity_trace: {
    admitted_tool_families: string[];
    actual_tool_calls: string[];
    unexpected_tool_calls: string[];
    observations_created_count: number;
    evidence_selected_for_answer_count: number;
    short_circuit_risk_flags: string[];
  };
  ask_turn_solver_trace: {
    present: boolean;
    completed_solver_path: boolean;
    prompt_shape: string | null;
    selected_primary_intent: string | null;
    primary_intent_route: string | null;
    contextual_tool_mentions: string[];
    executable_operator_commands_count: number;
    solver_short_circuit_flags: string[];
    live_source_identity_diagnosis: string | null;
    live_source_identity_ok: boolean | null;
  };
  capability_selection: {
    capability_id: string | null;
    selected_capabilities: string[];
  };
  route_authority: {
    ok: boolean;
    primary_violation_code: string | null;
    violation_codes: string[];
  };
  poison_audit_ok: boolean;
  terminal_authority_ok: boolean;
  terminal_failure_reconciliation_runtime: {
    available: boolean;
    version: string | null;
    current: boolean;
  };
  rail_table: HelixApiParityRailTableSummary;
  solver_continuation_count?: number;
  solver_continuation_observation?: {
    reason: string | null;
    required_next_step: string | null;
  };
  procedural_ok: boolean;
  failures: string[];
};

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry: unknown): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const readRecordArray = (value: unknown): RecordLike[] =>
  Array.isArray(value)
    ? value
        .map((entry: unknown) => readRecord(entry))
        .filter((entry: RecordLike | null): entry is RecordLike =>
          Boolean(entry),
        )
    : [];

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && entry.trim().length > 0);

const readNonNegativeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

const getPath = (value: unknown, pathParts: string[]): unknown =>
  pathParts.reduce<unknown>((current: unknown, key: string) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as RecordLike)[key];
  }, value);

export const extractHelixDebugPayload = (
  debugExport: unknown,
): RecordLike | null => {
  const debugRecord = readRecord(debugExport);
  const payload = readRecord(debugRecord?.payload);
  return payload ?? debugRecord;
};

const readSourceTarget = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null => {
  const candidates = [
    readRecord(ask.capability_contract_arbitration)
      ? {
          target_source: readString(
            readRecord(ask.capability_contract_arbitration)
              ?.selected_source_target,
          ),
          target_kind: readString(
            readRecord(ask.capability_contract_arbitration)
              ?.selected_source_target,
          ),
          precedence_reason: readString(
            readRecord(ask.capability_contract_arbitration)?.contract_state,
          ),
        }
      : null,
    readRecord(debug?.capability_contract_arbitration)
      ? {
          target_source: readString(
            readRecord(debug?.capability_contract_arbitration)
              ?.selected_source_target,
          ),
          target_kind: readString(
            readRecord(debug?.capability_contract_arbitration)
              ?.selected_source_target,
          ),
          precedence_reason: readString(
            readRecord(debug?.capability_contract_arbitration)?.contract_state,
          ),
        }
      : null,
    readRecord(ask.capability_plan)
      ? {
          target_source: readString(
            readRecord(ask.capability_plan)?.source_target,
          ),
          target_kind: readString(
            readRecord(ask.capability_plan)?.source_target,
          ),
          precedence_reason: "capability_plan",
        }
      : null,
    readRecord(debug?.capability_plan)
      ? {
          target_source: readString(
            readRecord(debug?.capability_plan)?.source_target,
          ),
          target_kind: readString(
            readRecord(debug?.capability_plan)?.source_target,
          ),
          precedence_reason: "capability_plan",
        }
      : null,
    readRecord(ask.tool_call_admission_decision)
      ? {
          target_source: readString(
            readRecord(ask.tool_call_admission_decision)?.source_target,
          ),
          target_kind: readString(
            readRecord(ask.tool_call_admission_decision)?.source_target,
          ),
          precedence_reason: readString(
            readRecord(ask.tool_call_admission_decision)?.reason,
          ),
        }
      : null,
    readRecord(debug?.tool_call_admission_decision)
      ? {
          target_source: readString(
            readRecord(debug?.tool_call_admission_decision)?.source_target,
          ),
          target_kind: readString(
            readRecord(debug?.tool_call_admission_decision)?.source_target,
          ),
          precedence_reason: readString(
            readRecord(debug?.tool_call_admission_decision)?.reason,
          ),
        }
      : null,
    readRecord(ask.source_target_intent),
    readRecord(debug?.source_target_intent),
    readRecord(
      getPath(debug, ["ask_turn_preflight_context", "source_target_intent"]),
    ),
  ];
  return (
    candidates.find((candidate) => {
      const target = readString(candidate?.target_source);
      return Boolean(target && target !== "unknown");
    }) ??
    candidates.find((candidate) => Boolean(candidate)) ??
    null
  );
};

const readLoopTrace = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.loop_parity_trace) ?? readRecord(debug?.loop_parity_trace);

const readSolverTrace = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.ask_turn_solver_trace) ??
  readRecord(debug?.ask_turn_solver_trace);

const readLiveSourceIdentityAudit = (
  ask: RecordLike,
  debug: RecordLike | null,
  solverTrace: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.live_source_identity_audit) ??
  readRecord(debug?.live_source_identity_audit) ??
  readRecord(solverTrace?.live_source_identity_audit);

const readRouteAuthority = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.route_authority_audit) ??
  readRecord(debug?.route_authority_audit);

const readPoisonAudit = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.poison_audit) ?? readRecord(debug?.poison_audit);

const readTerminalAuthority = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.terminal_answer_authority) ??
  readRecord(debug?.terminal_answer_authority);

const readTerminalFailureReconciliationRuntime = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.tool_rail_terminal_failure_reconciliation_runtime) ??
  readRecord(debug?.tool_rail_terminal_failure_reconciliation_runtime) ??
  readRecord(
    getPath(debug, [
      "debug",
      "tool_rail_terminal_failure_reconciliation_runtime",
    ]),
  );

const readCapabilitySelectionResult = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.capability_selection_result) ??
  readRecord(debug?.capability_selection_result);

const readSolverContinuationObservation = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike | null =>
  readRecord(ask.solver_continuation_observation) ??
  readRecord(debug?.solver_continuation_observation);

const readCapabilitySelectionTrace = (
  ask: RecordLike,
  debug: RecordLike | null,
): RecordLike[] =>
  (Array.isArray(ask.capability_selection_trace)
    ? ask.capability_selection_trace
    : Array.isArray(debug?.capability_selection_trace)
      ? debug?.capability_selection_trace
      : []
  )
    .map((entry: unknown) => readRecord(entry))
    .filter((entry: RecordLike | null): entry is RecordLike => Boolean(entry));

const readActualToolIds = (loopTrace: RecordLike | null): string[] =>
  (Array.isArray(loopTrace?.actual_tool_calls)
    ? loopTrace.actual_tool_calls
    : []
  )
    .map((entry: unknown) => readRecord(entry))
    .filter((entry: RecordLike | null): entry is RecordLike => Boolean(entry))
    .map((entry: RecordLike) => readString(entry.tool_id))
    .filter((entry: string | null): entry is string => Boolean(entry));

const actualToolCalls = (loopTrace: RecordLike | null): RecordLike[] =>
  (Array.isArray(loopTrace?.actual_tool_calls)
    ? loopTrace.actual_tool_calls
    : []
  )
    .map((entry: unknown) => readRecord(entry))
    .filter((entry: RecordLike | null): entry is RecordLike => Boolean(entry));

const readContextualToolMentionCues = (
  solverTrace: RecordLike | null,
): string[] =>
  (Array.isArray(
    getPath(solverTrace, ["prompt_interpretation", "contextual_tool_mentions"]),
  )
    ? (getPath(solverTrace, [
        "prompt_interpretation",
        "contextual_tool_mentions",
      ]) as unknown[])
    : []
  )
    .map((entry: unknown) => readRecord(entry))
    .filter((entry: RecordLike | null): entry is RecordLike => Boolean(entry))
    .map((entry: RecordLike) =>
      `${readString(entry.verb_or_cue) ?? ""} ${readString(entry.text) ?? ""}`.trim(),
    )
    .filter(Boolean);

const readRailTables = (
  ask: RecordLike,
  debug: RecordLike | null,
  rawDebugExport?: unknown,
): RecordLike[] => {
  const rawDebug = readRecord(rawDebugExport);
  return [
    readRecord(ask.codex_parity_agent_spine_rail_table),
    readRecord(debug?.codex_parity_agent_spine_rail_table),
    readRecord(
      getPath(debug, ["debug", "codex_parity_agent_spine_rail_table"]),
    ),
    readRecord(
      getPath(debug, [
        "artifact_query_index",
        "codex_parity_agent_spine_rail_table",
      ]),
    ),
    readRecord(
      getPath(debug, [
        "debug",
        "artifact_query_index",
        "codex_parity_agent_spine_rail_table",
      ]),
    ),
    readRecord(rawDebug?.codex_parity_agent_spine_rail_table),
    readRecord(
      getPath(rawDebug, ["payload", "codex_parity_agent_spine_rail_table"]),
    ),
    readRecord(
      getPath(rawDebug, [
        "payload",
        "debug",
        "codex_parity_agent_spine_rail_table",
      ]),
    ),
    readRecord(
      getPath(rawDebug, [
        "payload",
        "artifact_query_index",
        "codex_parity_agent_spine_rail_table",
      ]),
    ),
    readRecord(
      getPath(rawDebug, ["debug", "codex_parity_agent_spine_rail_table"]),
    ),
  ].filter((entry: RecordLike | null): entry is RecordLike => Boolean(entry));
};

const readCompoundSubgoalRailStatuses = (
  ask: RecordLike,
  debug: RecordLike | null,
  rawDebugExport?: unknown,
): RecordLike[] => {
  const rawDebug = readRecord(rawDebugExport);
  for (const candidate of [
    ask.compound_subgoal_rail_statuses,
    debug?.compound_subgoal_rail_statuses,
    getPath(debug, ["debug", "compound_subgoal_rail_statuses"]),
    getPath(debug, ["artifact_query_index", "compound_subgoal_rail_statuses"]),
    getPath(debug, [
      "debug",
      "artifact_query_index",
      "compound_subgoal_rail_statuses",
    ]),
    getPath(rawDebug, ["compound_subgoal_rail_statuses"]),
    getPath(rawDebug, ["payload", "compound_subgoal_rail_statuses"]),
    getPath(rawDebug, ["payload", "debug", "compound_subgoal_rail_statuses"]),
    getPath(rawDebug, [
      "payload",
      "artifact_query_index",
      "compound_subgoal_rail_statuses",
    ]),
    getPath(rawDebug, [
      "payload",
      "debug",
      "artifact_query_index",
      "compound_subgoal_rail_statuses",
    ]),
    getPath(rawDebug, ["debug", "compound_subgoal_rail_statuses"]),
  ]) {
    const records = readRecordArray(candidate);
    if (records.length > 0) return records;
  }
  return [];
};

const RAIL_MIRROR_COMPARISON_FIELDS = [
  "schema",
  "turn_id",
  "prompt",
  "requested_capability",
  "visible_tool_surface",
  "visible_tool_surface_original_count",
  "visible_tool_surface_truncated",
  "selected_capability",
  "admitted_capability",
  "admission_proof_source",
  "admission_proven",
  "executed_capability",
  "compound_subgoal_count",
  ...API_PARITY_COMPOUND_STRING_OR_NULL_FIELDS,
  "compound_incomplete_subgoal_did_tool_run",
  "observation_kind",
  "observation_ref",
  "required_observation_kinds_for_requested_capability",
  "observed_artifact_supports_requested_capability",
  "reentry_status",
  "reentry_proof_source",
  "reentry_proven",
  "goal_satisfaction",
  "required_terminal_kind",
  "selected_terminal_kind",
  "terminal_authority_proof_source",
  "terminal_authority_proven",
  "visible_terminal_kind",
  "visible_projection_source",
  "visible_projection_proven",
  "codex_parity_class",
  "first_broken_rail",
  "repair_target",
  "rail_status",
  "rail_failure_code",
  "normalized_codex_parity_classes",
  "assistant_answer",
  "terminal_eligible",
  "raw_content_included",
] as const;

const railMirrorComparableValue = (value: unknown): unknown =>
  value === undefined ? null : value;

const readFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const buildCompoundSubgoalRailSummary = (
  entry: RecordLike,
): HelixApiParityCompoundSubgoalRailSummary => ({
  subgoal_id: readString(entry.subgoal_id),
  order: readFiniteNumber(entry.order),
  requested_capability: readString(entry.requested_capability),
  runtime_capability: readString(entry.runtime_capability),
  selected_capability: readString(entry.selected_capability),
  executed_capability: readString(entry.executed_capability),
  args_present: readRecord(entry.args) !== null,
  observation_kind: readString(entry.observation_kind),
  observation_ref: readString(entry.observation_ref),
  observation_provenance: readString(entry.observation_provenance),
  satisfaction: readString(entry.satisfaction),
  rail_status: readString(entry.rail_status),
  first_broken_rail: readString(entry.first_broken_rail),
  rail_failure_code: readString(entry.rail_failure_code),
  repair_target: readString(entry.repair_target),
});

const addRailMirrorFailures = (input: {
  failures: string[];
  railTables: RecordLike[];
}): void => {
  const { failures, railTables } = input;
  if (railTables.length < 2) return;
  const base = railTables[0];
  for (const [index, railTable] of railTables.entries()) {
    if (index === 0) continue;
    for (const key of RAIL_MIRROR_COMPARISON_FIELDS) {
      const baseValue = railMirrorComparableValue(base[key]);
      const railValue = railMirrorComparableValue(railTable[key]);
      if (JSON.stringify(baseValue) !== JSON.stringify(railValue)) {
        failures.push(
          `rail_mirror_${index}_${key}_mismatch:${String(railValue ?? "null")}!=${String(baseValue ?? "null")}`,
        );
      }
    }
  }
};

const buildRailTableSummary = (
  railTable: RecordLike | null,
  compoundSubgoalRailStatuses: RecordLike[] = [],
): HelixApiParityRailTableSummary => ({
  present: Boolean(railTable),
  turn_id: readString(railTable?.turn_id),
  prompt: readString(railTable?.prompt),
  requested_capability: readString(railTable?.requested_capability),
  visible_tool_surface: readStringArray(railTable?.visible_tool_surface),
  visible_tool_surface_original_count:
    typeof railTable?.visible_tool_surface_original_count === "number" &&
    Number.isFinite(railTable.visible_tool_surface_original_count)
      ? railTable.visible_tool_surface_original_count
      : null,
  visible_tool_surface_truncated:
    typeof railTable?.visible_tool_surface_truncated === "boolean"
      ? railTable.visible_tool_surface_truncated
      : null,
  selected_capability: readString(railTable?.selected_capability),
  admitted_capability: readString(railTable?.admitted_capability),
  admission_proof_source: readString(railTable?.admission_proof_source),
  admission_proven: railTable?.admission_proven === true,
  executed_capability: readString(railTable?.executed_capability),
  compound_subgoal_count: readNonNegativeInteger(
    railTable?.compound_subgoal_count,
  ),
  first_incomplete_compound_subgoal_id: readString(
    railTable?.first_incomplete_compound_subgoal_id,
  ),
  first_incomplete_compound_requested_capability: readString(
    railTable?.first_incomplete_compound_requested_capability,
  ),
  first_incomplete_compound_runtime_capability: readString(
    railTable?.first_incomplete_compound_runtime_capability,
  ),
  first_incomplete_compound_selected_capability: readString(
    railTable?.first_incomplete_compound_selected_capability,
  ),
  first_incomplete_compound_executed_capability: readString(
    railTable?.first_incomplete_compound_executed_capability,
  ),
  compound_first_broken_rail: readString(railTable?.compound_first_broken_rail),
  compound_rail_failure_code: readString(railTable?.compound_rail_failure_code),
  compound_repair_target: readString(railTable?.compound_repair_target),
  compound_incomplete_subgoal_did_tool_run:
    typeof railTable?.compound_incomplete_subgoal_did_tool_run === "boolean"
      ? railTable.compound_incomplete_subgoal_did_tool_run
      : null,
  compound_subgoal_rails: compoundSubgoalRailStatuses.map(
    buildCompoundSubgoalRailSummary,
  ),
  observation_kind: readString(railTable?.observation_kind),
  observation_ref: readString(railTable?.observation_ref),
  required_observation_kinds_for_requested_capability: readStringArray(
    railTable?.required_observation_kinds_for_requested_capability,
  ),
  observed_artifact_supports_requested_capability:
    typeof railTable?.observed_artifact_supports_requested_capability ===
    "boolean"
      ? railTable.observed_artifact_supports_requested_capability
      : null,
  reentry_status: readString(railTable?.reentry_status),
  reentry_proof_source: readString(railTable?.reentry_proof_source),
  reentry_proven: railTable?.reentry_proven === true,
  goal_satisfaction: readString(railTable?.goal_satisfaction),
  required_terminal_kind: readString(railTable?.required_terminal_kind),
  selected_terminal_kind: readString(railTable?.selected_terminal_kind),
  terminal_authority_proof_source: readString(
    railTable?.terminal_authority_proof_source,
  ),
  terminal_authority_proven: railTable?.terminal_authority_proven === true,
  visible_terminal_kind: readString(railTable?.visible_terminal_kind),
  visible_projection_source: readString(railTable?.visible_projection_source),
  visible_projection_proven: railTable?.visible_projection_proven === true,
  first_broken_rail: readString(railTable?.first_broken_rail),
  repair_target: readString(railTable?.repair_target),
  codex_parity_class: readString(railTable?.codex_parity_class),
  normalized_codex_parity_classes: readStringArray(
    railTable?.normalized_codex_parity_classes,
  ),
  rail_status: readString(railTable?.rail_status),
  rail_failure_code: readString(railTable?.rail_failure_code),
  assistant_answer:
    typeof railTable?.assistant_answer === "boolean"
      ? railTable.assistant_answer
      : null,
  terminal_eligible:
    typeof railTable?.terminal_eligible === "boolean"
      ? railTable.terminal_eligible
      : null,
  raw_content_included:
    typeof railTable?.raw_content_included === "boolean"
      ? railTable.raw_content_included
      : null,
});

const addRailTableFailures = (input: {
  failures: string[];
  railTable: RecordLike | null;
  compoundSubgoalRailStatuses?: RecordLike[];
  turnId?: string | null;
  prompt?: string | null;
}): void => {
  const { failures, railTable, turnId, prompt } = input;
  const compoundSubgoalRailStatuses = input.compoundSubgoalRailStatuses ?? [];
  if (!railTable) {
    failures.push("codex_parity_agent_spine_rail_table_missing");
    return;
  }
  if (railTable.schema !== CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA) {
    failures.push(
      `rail_table_schema_mismatch:${readString(railTable.schema) ?? "missing"}`,
    );
  }
  if (turnId && readString(railTable.turn_id) !== turnId) {
    failures.push(
      `rail_turn_id_mismatch:${readString(railTable.turn_id) ?? "missing"}!=${turnId}`,
    );
  }
  if (prompt && readString(railTable.prompt) !== prompt) {
    failures.push("rail_prompt_mismatch");
  }
  if (railTable.assistant_answer !== false)
    failures.push("rail_assistant_answer_not_false");
  if (railTable.terminal_eligible !== false)
    failures.push("rail_terminal_eligible_not_false");
  if (railTable.raw_content_included !== false)
    failures.push("rail_raw_content_included_not_false");
  if (!Array.isArray(railTable.visible_tool_surface)) {
    failures.push("rail_visible_tool_surface_missing");
  } else if (!isNonEmptyStringArray(railTable.visible_tool_surface)) {
    failures.push("rail_visible_tool_surface_entries_invalid");
  }
  const visibleSurfaceCount = readNonNegativeInteger(
    railTable.visible_tool_surface_original_count,
  );
  const visibleSurfaceTruncated =
    typeof railTable.visible_tool_surface_truncated === "boolean"
      ? railTable.visible_tool_surface_truncated
      : null;
  if (visibleSurfaceCount === null) {
    failures.push("rail_visible_tool_surface_original_count_invalid");
  }
  if (visibleSurfaceTruncated === null) {
    failures.push("rail_visible_tool_surface_truncated_invalid");
  }
  if (
    Array.isArray(railTable.visible_tool_surface) &&
    visibleSurfaceCount !== null
  ) {
    const visibleSurfaceLength = railTable.visible_tool_surface.length;
    if (visibleSurfaceCount < visibleSurfaceLength) {
      failures.push(
        "rail_visible_tool_surface_original_count_less_than_surface",
      );
    }
    if (
      visibleSurfaceTruncated === true &&
      visibleSurfaceCount <= visibleSurfaceLength
    ) {
      failures.push(
        "rail_visible_tool_surface_truncated_without_hidden_entries",
      );
    }
    if (
      visibleSurfaceTruncated === false &&
      visibleSurfaceCount !== visibleSurfaceLength
    ) {
      failures.push("rail_visible_tool_surface_untruncated_count_mismatch");
    }
  }
  if (
    !Array.isArray(
      railTable.required_observation_kinds_for_requested_capability,
    )
  ) {
    failures.push("rail_required_observation_kinds_missing");
  } else if (
    !isNonEmptyStringArray(
      railTable.required_observation_kinds_for_requested_capability,
    )
  ) {
    failures.push("rail_required_observation_kinds_entries_invalid");
  }
  if (!isNonEmptyStringArray(railTable.normalized_codex_parity_classes)) {
    failures.push("rail_normalized_codex_parity_classes_entries_invalid");
  }
  for (const key of CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS) {
    const value = railTable[key];
    if (value !== null && typeof value !== "string")
      failures.push(`rail_string_or_null_field_invalid:${key}`);
  }
  if (
    !CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES.includes(
      railTable.reentry_status as never,
    )
  ) {
    failures.push(
      `rail_reentry_status_invalid:${readString(railTable.reentry_status) ?? "missing"}`,
    );
  }
  if (
    !CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES.includes(
      railTable.rail_status as never,
    )
  ) {
    failures.push(
      `rail_status_invalid:${readString(railTable.rail_status) ?? "missing"}`,
    );
  }
  const firstBrokenRail = readString(railTable.first_broken_rail);
  if (
    firstBrokenRail &&
    !CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS.includes(
      firstBrokenRail as (typeof CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS)[number],
    )
  ) {
    failures.push(`rail_first_broken_rail_invalid:${firstBrokenRail}`);
  }
  const repairTarget = readString(railTable.repair_target);
  if (
    repairTarget &&
    !CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS.includes(
      repairTarget as (typeof CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS)[number],
    )
  ) {
    failures.push(`rail_repair_target_invalid:${repairTarget}`);
  }
  const compoundSubgoalCount = readNonNegativeInteger(
    railTable.compound_subgoal_count,
  );
  const firstIncompleteCompoundSubgoalId = readString(
    railTable.first_incomplete_compound_subgoal_id,
  );
  const firstIncompleteCompoundRequestedCapability = readString(
    railTable.first_incomplete_compound_requested_capability,
  );
  const firstIncompleteCompoundRuntimeCapability = readString(
    railTable.first_incomplete_compound_runtime_capability,
  );
  const compoundFirstBrokenRail = readString(
    railTable.compound_first_broken_rail,
  );
  const compoundRailFailureCode = readString(
    railTable.compound_rail_failure_code,
  );
  const compoundRepairTarget = readString(railTable.compound_repair_target);
  const compoundDidToolRun =
    typeof railTable.compound_incomplete_subgoal_did_tool_run === "boolean"
      ? railTable.compound_incomplete_subgoal_did_tool_run
      : null;
  const railStatus = readString(railTable.rail_status);
  const sourceIdentityPolicyFailure =
    readString(railTable.rail_failure_code) === "source_identity_mismatch";
  const compoundMirrorDeclared =
    railTable.compound_subgoal_count !== undefined ||
    firstIncompleteCompoundSubgoalId !== null ||
    firstIncompleteCompoundRequestedCapability !== null ||
    firstIncompleteCompoundRuntimeCapability !== null ||
    compoundFirstBrokenRail !== null ||
    compoundRailFailureCode !== null ||
    compoundRepairTarget !== null ||
    railTable.compound_incomplete_subgoal_did_tool_run !== undefined;
  if (compoundSubgoalCount === null && compoundMirrorDeclared) {
    failures.push("rail_compound_subgoal_count_invalid");
  }
  if (compoundMirrorDeclared) {
    for (const key of CODEX_PARITY_AGENT_SPINE_COMPOUND_STRING_OR_NULL_FIELDS) {
      const value = railTable[key];
      if (value !== null && typeof value !== "string") {
        failures.push(`rail_compound_string_or_null_field_invalid:${key}`);
      }
    }
  }
  if (compoundSubgoalCount === 0) {
    if (firstIncompleteCompoundSubgoalId)
      failures.push("rail_noncompound_first_incomplete_subgoal_present");
    if (compoundFirstBrokenRail)
      failures.push("rail_noncompound_first_broken_rail_present");
    if (compoundRailFailureCode)
      failures.push("rail_noncompound_rail_failure_code_present");
    if (compoundRepairTarget)
      failures.push("rail_noncompound_repair_target_present");
    if (compoundDidToolRun !== null)
      failures.push("rail_noncompound_did_tool_run_present");
  }
  if (
    compoundSubgoalCount !== null &&
    compoundSubgoalCount > 0 &&
    railStatus === "complete"
  ) {
    if (firstIncompleteCompoundSubgoalId)
      failures.push("rail_complete_compound_first_incomplete_subgoal_present");
    if (compoundFirstBrokenRail)
      failures.push("rail_complete_compound_first_broken_rail_present");
    if (compoundRailFailureCode)
      failures.push("rail_complete_compound_rail_failure_code_present");
    if (compoundRepairTarget)
      failures.push("rail_complete_compound_repair_target_present");
    if (compoundDidToolRun !== null)
      failures.push("rail_complete_compound_did_tool_run_present");
  }
  if (compoundSubgoalCount !== null && compoundSubgoalCount > 0) {
    if (compoundSubgoalRailStatuses.length < compoundSubgoalCount) {
      failures.push(
        `rail_compound_subgoal_rail_statuses_dropped:${compoundSubgoalRailStatuses.length}<${compoundSubgoalCount}`,
      );
    }
    for (const [index, subgoalRail] of compoundSubgoalRailStatuses.entries()) {
      const prefix = `rail_compound_subgoal_${index + 1}`;
      const subgoalRailStatus = readString(subgoalRail.rail_status);
      const subgoalFirstBrokenRail = readString(subgoalRail.first_broken_rail);
      const subgoalRailFailureCode = readString(subgoalRail.rail_failure_code);
      const subgoalRepairTarget = readString(subgoalRail.repair_target);
      const subgoalObservationRef = readString(subgoalRail.observation_ref);
      const subgoalSatisfaction = readString(subgoalRail.satisfaction);
      if (!readString(subgoalRail.subgoal_id))
        failures.push(`${prefix}_subgoal_id_missing`);
      if (readNonNegativeInteger(subgoalRail.order) === null)
        failures.push(`${prefix}_order_invalid`);
      if (!readString(subgoalRail.requested_capability))
        failures.push(`${prefix}_requested_capability_missing`);
      if (!readString(subgoalRail.runtime_capability))
        failures.push(`${prefix}_runtime_capability_missing`);
      if (!readString(subgoalRail.selected_capability))
        failures.push(`${prefix}_selected_capability_missing`);
      if (!Object.prototype.hasOwnProperty.call(subgoalRail, "args")) {
        failures.push(`${prefix}_args_field_missing`);
      }
      if (
        !Object.prototype.hasOwnProperty.call(
          subgoalRail,
          "executed_capability",
        )
      ) {
        failures.push(`${prefix}_executed_capability_field_missing`);
      }
      if (
        !Object.prototype.hasOwnProperty.call(subgoalRail, "observation_kind")
      ) {
        failures.push(`${prefix}_observation_kind_field_missing`);
      }
      if (
        !Object.prototype.hasOwnProperty.call(subgoalRail, "observation_ref")
      ) {
        failures.push(`${prefix}_observation_ref_field_missing`);
      }
      if (!subgoalSatisfaction) failures.push(`${prefix}_satisfaction_missing`);
      if (!subgoalRailStatus) failures.push(`${prefix}_rail_status_missing`);
      if (
        subgoalRailStatus &&
        !CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES.includes(
          subgoalRailStatus as never,
        )
      ) {
        failures.push(`${prefix}_rail_status_invalid:${subgoalRailStatus}`);
      }
      if (subgoalSatisfaction === "satisfied" && !subgoalObservationRef) {
        failures.push(`${prefix}_satisfied_observation_ref_missing`);
      }
      if (subgoalRailStatus === "complete") {
        if (subgoalSatisfaction !== "satisfied")
          failures.push(`${prefix}_complete_satisfaction_not_satisfied`);
        if (!subgoalObservationRef)
          failures.push(`${prefix}_complete_observation_ref_missing`);
        if (subgoalFirstBrokenRail)
          failures.push(`${prefix}_complete_first_broken_rail_present`);
        if (subgoalRailFailureCode)
          failures.push(`${prefix}_complete_rail_failure_code_present`);
        if (subgoalRepairTarget)
          failures.push(`${prefix}_complete_repair_target_present`);
      } else if (subgoalRailStatus) {
        if (!subgoalFirstBrokenRail)
          failures.push(`${prefix}_first_broken_rail_missing`);
        if (!subgoalRailFailureCode)
          failures.push(`${prefix}_rail_failure_code_missing`);
        if (!subgoalRepairTarget)
          failures.push(`${prefix}_repair_target_missing`);
      }
      if (
        subgoalFirstBrokenRail &&
        !CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS.includes(
          subgoalFirstBrokenRail as (typeof CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS)[number],
        )
      ) {
        failures.push(
          `${prefix}_first_broken_rail_invalid:${subgoalFirstBrokenRail}`,
        );
      }
      if (
        subgoalRepairTarget &&
        !CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS.includes(
          subgoalRepairTarget as (typeof CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS)[number],
        )
      ) {
        failures.push(`${prefix}_repair_target_invalid:${subgoalRepairTarget}`);
      }
      if (
        subgoalRailFailureCode &&
        !isCodexParityAgentSpineRailFailureCode(subgoalRailFailureCode)
      ) {
        failures.push(
          `${prefix}_rail_failure_code_invalid:${subgoalRailFailureCode}`,
        );
      }
    }
  }
  if (
    compoundSubgoalCount !== null &&
    compoundSubgoalCount > 0 &&
    railStatus !== "complete" &&
    !sourceIdentityPolicyFailure
  ) {
    if (!firstIncompleteCompoundSubgoalId)
      failures.push(
        "rail_incomplete_compound_first_incomplete_subgoal_missing",
      );
    if (!firstIncompleteCompoundRequestedCapability)
      failures.push("rail_incomplete_compound_requested_capability_missing");
    if (!firstIncompleteCompoundRuntimeCapability)
      failures.push("rail_incomplete_compound_runtime_capability_missing");
    if (!compoundFirstBrokenRail)
      failures.push("rail_incomplete_compound_first_broken_rail_missing");
    if (!compoundRailFailureCode)
      failures.push("rail_incomplete_compound_rail_failure_code_missing");
    if (!compoundRepairTarget)
      failures.push("rail_incomplete_compound_repair_target_missing");
    if (compoundDidToolRun === null)
      failures.push("rail_incomplete_compound_did_tool_run_missing");
  }
  if (
    compoundFirstBrokenRail &&
    !CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS.includes(
      compoundFirstBrokenRail as (typeof CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS)[number],
    )
  ) {
    failures.push(
      `rail_compound_first_broken_rail_invalid:${compoundFirstBrokenRail}`,
    );
  }
  if (
    compoundRepairTarget &&
    !CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS.includes(
      compoundRepairTarget as (typeof CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS)[number],
    )
  ) {
    failures.push(
      `rail_compound_repair_target_invalid:${compoundRepairTarget}`,
    );
  }
  if (
    compoundRailFailureCode &&
    !isCodexParityAgentSpineRailFailureCode(compoundRailFailureCode)
  ) {
    failures.push(
      `rail_compound_rail_failure_code_invalid:${compoundRailFailureCode}`,
    );
  }
  const railFailureCode = readString(railTable.rail_failure_code);
  if (
    railFailureCode &&
    !isCodexParityAgentSpineRailFailureCode(railFailureCode)
  ) {
    failures.push(`rail_failure_code_invalid:${railFailureCode}`);
  }
  const parityClass = readString(railTable.codex_parity_class);
  if (
    !CODEX_PARITY_AGENT_SPINE_CLASSES.includes(
      parityClass as (typeof CODEX_PARITY_AGENT_SPINE_CLASSES)[number],
    )
  ) {
    failures.push(
      `rail_codex_parity_class_invalid:${parityClass ?? "missing"}`,
    );
  }
  if (
    JSON.stringify(railTable.normalized_codex_parity_classes) !==
    JSON.stringify(CODEX_PARITY_AGENT_SPINE_CLASSES)
  ) {
    failures.push("rail_normalized_codex_parity_classes_mismatch");
  }
  const selectedCapability = readString(railTable.selected_capability);
  const admittedCapability = readString(railTable.admitted_capability);
  const executedCapability = readString(railTable.executed_capability);
  const requestedCapability = readString(railTable.requested_capability);
  const goalSatisfaction = readString(railTable.goal_satisfaction);
  const reentryStatus = readString(railTable.reentry_status);
  const reentryProofSource = readString(railTable.reentry_proof_source);
  const reentryProven = railTable.reentry_proven === true;
  const requiredObservationKinds = readStringArray(
    railTable.required_observation_kinds_for_requested_capability,
  );
  const observationSupportsRequested =
    railTable.observed_artifact_supports_requested_capability;
  const admissionProofSource = readString(railTable.admission_proof_source);
  const admissionProven = railTable.admission_proven === true;
  if ((selectedCapability || executedCapability) && !admittedCapability) {
    failures.push("rail_admitted_capability_missing");
  }
  if (admittedCapability && !admissionProofSource) {
    failures.push("rail_admission_proof_source_missing");
  }
  if (admittedCapability && !admissionProven) {
    failures.push("rail_admission_not_proven");
  }
  if (reentryStatus === "reentered" && !reentryProofSource) {
    failures.push("rail_reentry_proof_source_missing");
  }
  if (reentryStatus === "reentered" && !reentryProven) {
    failures.push("rail_reentry_not_proven");
  }
  if (
    (railStatus === "complete" || parityClass === "complete") &&
    reentryStatus !== "reentered"
  ) {
    failures.push(
      `rail_complete_without_reentry:${reentryStatus ?? "missing"}`,
    );
  }
  if ((railStatus === "complete") !== (parityClass === "complete")) {
    failures.push(
      `rail_completion_status_class_mismatch:${railStatus ?? "missing"}/${parityClass ?? "missing"}`,
    );
  }
  if (requestedCapability && requiredObservationKinds.length === 0) {
    failures.push("rail_requested_observation_kinds_empty");
  }
  if (
    requestedCapability &&
    typeof observationSupportsRequested !== "boolean"
  ) {
    failures.push("rail_observation_support_verdict_missing");
  }
  if (
    requestedCapability &&
    (goalSatisfaction === "satisfied" ||
      railStatus === "complete" ||
      parityClass === "complete") &&
    requiredObservationKinds.length > 0 &&
    observationSupportsRequested !== true
  ) {
    failures.push("rail_goal_satisfied_without_requested_observation_support");
  }
  if (parityClass === "complete" && firstBrokenRail) {
    failures.push(`rail_complete_with_first_broken_rail:${firstBrokenRail}`);
  }
  if (parityClass !== "complete" && !firstBrokenRail) {
    failures.push("rail_non_complete_without_first_broken_rail");
  }
  if (parityClass !== "complete" && !railFailureCode) {
    failures.push("rail_non_complete_without_rail_failure_code");
  }
  if (parityClass !== "complete" && !repairTarget) {
    failures.push("rail_non_complete_without_repair_target");
  }
  const selectedTerminalKind = readString(railTable.selected_terminal_kind);
  const visibleTerminalKind = readString(railTable.visible_terminal_kind);
  const terminalAuthorityProofSource = readString(
    railTable.terminal_authority_proof_source,
  );
  const terminalAuthorityProven = railTable.terminal_authority_proven === true;
  const visibleProjectionSource = readString(
    railTable.visible_projection_source,
  );
  const visibleProjectionProven = railTable.visible_projection_proven === true;
  if (selectedTerminalKind && !terminalAuthorityProofSource) {
    failures.push("rail_terminal_authority_proof_source_missing");
  }
  if (selectedTerminalKind && !terminalAuthorityProven) {
    failures.push("rail_terminal_authority_not_proven");
  }
  if (visibleTerminalKind && !visibleProjectionSource) {
    failures.push("rail_visible_projection_source_missing");
  }
  if (visibleTerminalKind && !visibleProjectionProven) {
    failures.push("rail_visible_projection_not_proven");
  }
  if (
    (railStatus === "complete" || parityClass === "complete") &&
    !selectedTerminalKind
  ) {
    failures.push("rail_complete_without_terminal_authority");
  }
  if (
    (railStatus === "complete" || parityClass === "complete") &&
    !visibleTerminalKind
  ) {
    failures.push("rail_complete_without_visible_projection");
  }
  if (
    selectedTerminalKind &&
    visibleTerminalKind &&
    selectedTerminalKind !== visibleTerminalKind
  ) {
    failures.push(
      `rail_terminal_projection_mismatch:${selectedTerminalKind}!=${visibleTerminalKind}`,
    );
  }
};

const addCompleteRailEnvelopeFailures = (input: {
  failures: string[];
  railTable: RecordLike | null;
  ask: RecordLike;
  debug: RecordLike | null;
  authoritativeTypedFailure: boolean;
}): void => {
  if (!input.railTable) return;
  const railComplete =
    readString(input.railTable.codex_parity_class) === "complete" ||
    readString(input.railTable.rail_status) === "complete";
  if (!railComplete) return;
  const terminalErrorCode =
    readString(input.ask.terminal_error_code) ??
    readString(input.debug?.terminal_error_code) ??
    readString(
      getPath(input.debug, ["resolved_turn_summary", "terminal_error_code"]),
    );
  const finalStatus =
    readString(input.ask.final_status) ?? readString(input.debug?.final_status);
  const responseType =
    readString(input.ask.response_type) ??
    readString(input.debug?.response_type);
  const finalAnswerSource =
    readString(input.ask.final_answer_source) ??
    readString(input.debug?.final_answer_source) ??
    readString(
      getPath(input.debug, [
        "terminal_answer_authority",
        "final_answer_source",
      ]),
    );
  const terminalArtifactKind =
    readString(input.ask.terminal_artifact_kind) ??
    readString(input.debug?.terminal_artifact_kind) ??
    readString(
      getPath(input.debug, [
        "terminal_answer_authority",
        "terminal_artifact_kind",
      ]),
    );
  const selectedText =
    readString(input.ask.selected_final_answer) ??
    readString(input.ask.answer) ??
    readString(input.ask.text) ??
    readString(input.debug?.selected_final_answer) ??
    readString(input.debug?.answer) ??
    "";

  // A completed procedural rail can truthfully terminate as a typed failure
  // when the route contract explicitly permits it and current authority proves
  // that no further model/tool continuation can repair the evidence boundary.
  // This is distinct from an unexplained typed failure replacing a completed
  // provider answer, which remains a parity defect below.
  if (input.authoritativeTypedFailure) {
    if (!terminalErrorCode)
      input.failures.push(
        "complete_authoritative_typed_failure_missing_terminal_error_code",
      );
    if (
      finalAnswerSource !== "typed_failure" ||
      terminalArtifactKind !== "typed_failure"
    ) {
      input.failures.push(
        `complete_authoritative_typed_failure_projection_mismatch:${finalAnswerSource ?? "missing"}/${terminalArtifactKind ?? "missing"}`,
      );
    }
    if (
      (finalStatus && finalStatus !== "final_failure") ||
      (responseType && responseType !== "final_failure")
    ) {
      input.failures.push(
        `complete_authoritative_typed_failure_non_failure_response:${finalStatus ?? "missing"}/${responseType ?? "missing"}`,
      );
    }
    if (!selectedText)
      input.failures.push(
        "complete_authoritative_typed_failure_missing_failure_text",
      );
    return;
  }

  if (terminalErrorCode)
    input.failures.push(`complete_rail_terminal_error:${terminalErrorCode}`);
  if (
    finalAnswerSource === "typed_failure" ||
    terminalArtifactKind === "typed_failure"
  ) {
    input.failures.push("complete_rail_typed_failure_terminal");
  }
  if (
    (finalStatus && finalStatus !== "final_answer") ||
    (responseType && responseType !== "final_answer")
  ) {
    input.failures.push(
      `complete_rail_non_final_response:${finalStatus ?? "missing"}/${responseType ?? "missing"}`,
    );
  }
  if (!selectedText)
    input.failures.push("complete_rail_missing_final_answer_text");
};

const addFailClosedRailEnvelopeFailures = (input: {
  failures: string[];
  railTable: RecordLike | null;
  ask: RecordLike;
  debug: RecordLike | null;
}): void => {
  if (!input.railTable) return;
  const railComplete =
    readString(input.railTable.codex_parity_class) === "complete" ||
    readString(input.railTable.rail_status) === "complete";
  if (railComplete) return;

  const railStatus = readString(input.railTable.rail_status);
  const railFailureCode = readString(input.railTable.rail_failure_code);
  if (railStatus !== "fail_closed" || !railFailureCode) return;

  const terminalErrorCode =
    readString(input.ask.terminal_error_code) ??
    readString(input.debug?.terminal_error_code) ??
    readString(
      getPath(input.debug, ["resolved_turn_summary", "terminal_error_code"]),
    );
  const finalStatus =
    readString(input.ask.final_status) ?? readString(input.debug?.final_status);
  const responseType =
    readString(input.ask.response_type) ??
    readString(input.debug?.response_type);
  const finalAnswerSource =
    readString(input.ask.final_answer_source) ??
    readString(input.debug?.final_answer_source) ??
    readString(
      getPath(input.debug, [
        "terminal_answer_authority",
        "final_answer_source",
      ]),
    );
  const terminalArtifactKind =
    readString(input.ask.terminal_artifact_kind) ??
    readString(input.debug?.terminal_artifact_kind) ??
    readString(
      getPath(input.debug, [
        "terminal_answer_authority",
        "terminal_artifact_kind",
      ]),
    );
  const selectedText =
    readString(input.ask.selected_final_answer) ??
    readString(input.ask.answer) ??
    readString(input.ask.text) ??
    readString(input.debug?.selected_final_answer) ??
    readString(input.debug?.answer) ??
    "";

  if (!terminalErrorCode)
    input.failures.push("fail_closed_rail_missing_terminal_error_code");
  if (
    finalAnswerSource !== "typed_failure" &&
    terminalArtifactKind !== "typed_failure"
  ) {
    input.failures.push(
      `fail_closed_rail_not_typed_failure:${finalAnswerSource ?? "missing"}/${terminalArtifactKind ?? "missing"}`,
    );
  }
  if (
    (finalStatus && finalStatus !== "final_failure") ||
    (responseType && responseType !== "final_failure")
  ) {
    input.failures.push(
      `fail_closed_rail_non_failure_response:${finalStatus ?? "missing"}/${responseType ?? "missing"}`,
    );
  }
  if (!selectedText)
    input.failures.push("fail_closed_rail_missing_failure_text");

  if (
    terminalErrorCode === "agent_loop_budget_exhausted" ||
    terminalErrorCode === "max_tool_calls_budget_exhausted"
  ) {
    input.failures.push(
      `fail_closed_rail_stale_budget_exhaustion:${terminalErrorCode}`,
    );
  }
};

const addRailEnvelopeProjectionFailures = (input: {
  failures: string[];
  railTable: RecordLike | null;
  terminalArtifactKind: string | null;
}): void => {
  if (!input.railTable || !input.terminalArtifactKind) return;
  const selectedTerminalKind = readString(
    input.railTable.selected_terminal_kind,
  );
  const visibleTerminalKind = readString(input.railTable.visible_terminal_kind);
  if (
    selectedTerminalKind &&
    selectedTerminalKind !== input.terminalArtifactKind
  ) {
    input.failures.push(
      `rail_selected_terminal_response_mismatch:${selectedTerminalKind}!=${input.terminalArtifactKind}`,
    );
  }
  if (
    visibleTerminalKind &&
    visibleTerminalKind !== input.terminalArtifactKind
  ) {
    input.failures.push(
      `rail_visible_terminal_response_mismatch:${visibleTerminalKind}!=${input.terminalArtifactKind}`,
    );
  }
};

const readExecutableOperatorCommandCount = (
  solverTrace: RecordLike | null,
): number =>
  Array.isArray(
    getPath(solverTrace, [
      "prompt_interpretation",
      "executable_operator_commands",
    ]),
  )
    ? (
        getPath(solverTrace, [
          "prompt_interpretation",
          "executable_operator_commands",
        ]) as unknown[]
      ).length
    : 0;

const addExpectationFailures = (input: {
  failures: string[];
  expected: HelixApiParityExpected;
  sourceTarget: string | null;
  targetKind: string | null;
  selectedRoute: string | null;
  terminalArtifactKind: string | null;
  finalAnswerSource: string | null;
  loopTrace: RecordLike | null;
  solverTrace: RecordLike | null;
  selectedCapabilities: string[];
}): void => {
  const {
    failures,
    expected,
    sourceTarget,
    targetKind,
    selectedRoute,
    terminalArtifactKind,
    finalAnswerSource,
    loopTrace,
    solverTrace,
    selectedCapabilities,
  } = input;
  if (expected.source_target && sourceTarget !== expected.source_target) {
    failures.push(
      `source_target_mismatch:${sourceTarget ?? "missing"}!=${expected.source_target}`,
    );
  }
  if (expected.target_kind && targetKind !== expected.target_kind) {
    failures.push(
      `target_kind_mismatch:${targetKind ?? "missing"}!=${expected.target_kind}`,
    );
  }
  if (
    expected.terminal_artifact_kind &&
    terminalArtifactKind !== expected.terminal_artifact_kind &&
    terminalArtifactKind !== "typed_failure"
  ) {
    failures.push(
      `terminal_artifact_mismatch:${terminalArtifactKind ?? "missing"}!=${expected.terminal_artifact_kind}`,
    );
  }
  if (
    expected.allowed_terminal_artifact_kinds?.length &&
    terminalArtifactKind !== "typed_failure" &&
    (!terminalArtifactKind ||
      !expected.allowed_terminal_artifact_kinds.includes(terminalArtifactKind))
  ) {
    failures.push(
      `terminal_artifact_not_allowed:${terminalArtifactKind ?? "missing"}!in:${expected.allowed_terminal_artifact_kinds.join(",")}`,
    );
  }
  for (const route of expected.forbidden_routes ?? []) {
    if (selectedRoute === route)
      failures.push(`forbidden_route_selected:${route}`);
  }
  for (const artifact of expected.forbidden_terminal_artifacts ?? []) {
    if (terminalArtifactKind === artifact || finalAnswerSource === artifact) {
      failures.push(`forbidden_terminal_artifact:${artifact}`);
    }
  }
  const actualIds = readActualToolIds(loopTrace);
  const actualJson = JSON.stringify(actualToolCalls(loopTrace));
  for (const tool of expected.forbidden_tool_calls ?? []) {
    if (actualIds.includes(tool) || actualJson.includes(tool))
      failures.push(`forbidden_tool_call:${tool}`);
  }
  for (const tool of expected.allowed_tool_calls ?? []) {
    if (!actualIds.includes(tool) && !actualJson.includes(tool))
      failures.push(`required_allowed_tool_call_missing:${tool}`);
  }
  for (const family of expected.forbidden_tool_families ?? []) {
    if (
      actualToolCalls(loopTrace).some(
        (call: RecordLike) => readString(call.family) === family,
      )
    ) {
      failures.push(`forbidden_tool_family:${family}`);
    }
  }
  for (const capabilityId of expected.forbidden_capability_ids ?? []) {
    if (selectedCapabilities.includes(capabilityId))
      failures.push(`forbidden_capability_selected:${capabilityId}`);
  }
  const selectedPrimaryIntent = readString(
    solverTrace?.selected_primary_intent,
  );
  if (
    expected.selected_primary_intent &&
    selectedPrimaryIntent !== expected.selected_primary_intent
  ) {
    failures.push(
      `selected_primary_intent_mismatch:${selectedPrimaryIntent ?? "missing"}!=${expected.selected_primary_intent}`,
    );
  }
  const contextualMentions = readContextualToolMentionCues(solverTrace);
  for (const cue of expected.required_contextual_tool_mentions ?? []) {
    if (
      !contextualMentions.some((mention) =>
        mention.toLowerCase().includes(cue.toLowerCase()),
      )
    ) {
      failures.push(`contextual_tool_mention_missing:${cue}`);
    }
  }
  if (
    typeof expected.executable_operator_commands_count === "number" &&
    readExecutableOperatorCommandCount(solverTrace) !==
      expected.executable_operator_commands_count
  ) {
    failures.push(
      `executable_operator_commands_count_mismatch:${readExecutableOperatorCommandCount(solverTrace)}!=${expected.executable_operator_commands_count}`,
    );
  }
  const flags = readStringArray(loopTrace?.short_circuit_risk_flags);
  for (const flag of [
    ...(expected.required_trace_flags_absent ?? []),
    ...(expected.forbidden_trace_flags ?? []),
  ]) {
    if (flags.includes(flag)) failures.push(`forbidden_trace_flag:${flag}`);
  }
};

export function buildApiParityProbeResult(input: {
  scenario: HelixApiParityScenario;
  askTurn: unknown;
  debugExport?: unknown;
  streamTurn?: unknown;
  terminalEventSeen?: boolean;
  streamClosedAfterTerminal?: boolean;
}): HelixApiParityProbeResult {
  const ask = readRecord(input.askTurn) ?? {};
  const debug = extractHelixDebugPayload(input.debugExport);
  const loopTrace = readLoopTrace(ask, debug);
  const solverTrace = readSolverTrace(ask, debug);
  const liveSourceIdentityAudit = readLiveSourceIdentityAudit(
    ask,
    debug,
    solverTrace,
  );
  const routeAuthority = readRouteAuthority(ask, debug);
  const poisonAudit = readPoisonAudit(ask, debug);
  const terminalAuthority = readTerminalAuthority(ask, debug);
  const terminalFailureReconciliationRuntime =
    readTerminalFailureReconciliationRuntime(ask, debug);
  const terminalFailureReconciliationRuntimeVersion = readString(
    terminalFailureReconciliationRuntime?.version,
  );
  const terminalFailureReconciliationRuntimeCurrent =
    terminalFailureReconciliationRuntime?.available === true &&
    terminalFailureReconciliationRuntimeVersion ===
      HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION;
  const railTables = readRailTables(ask, debug, input.debugExport);
  const railTable = railTables[0] ?? null;
  const compoundSubgoalRailStatuses = readCompoundSubgoalRailStatuses(
    ask,
    debug,
    input.debugExport,
  );
  const capabilitySelectionResult = readCapabilitySelectionResult(ask, debug);
  const selectedCapabilities = [
    readString(capabilitySelectionResult?.capability_id),
    ...readCapabilitySelectionTrace(ask, debug).map((entry) =>
      readString(entry.selected_capability),
    ),
  ].filter((entry: string | null): entry is string => Boolean(entry));
  const sourceTargetIntent = readSourceTarget(ask, debug);
  const terminalArtifactKind =
    readString(ask.terminal_artifact_kind) ??
    readString(debug?.terminal_artifact_kind) ??
    readString(
      getPath(debug, ["terminal_answer_authority", "terminal_artifact_kind"]),
    );
  const finalAnswerSource =
    readString(ask.final_answer_source) ??
    readString(debug?.final_answer_source) ??
    readString(
      getPath(debug, ["terminal_answer_authority", "final_answer_source"]),
    );
  const selectedRoute =
    readString(ask.route_reason_code) ??
    readString(debug?.route_reason_code) ??
    readString(loopTrace?.selected_route) ??
    readString(
      getPath(debug, ["resolved_turn_summary", "resolved_route_label"]),
    );
  const sourceTarget =
    readString(sourceTargetIntent?.target_source) ??
    readString(routeAuthority?.source_target);
  const targetKind = readString(sourceTargetIntent?.target_kind) ?? null;
  const poisonAuditOk = poisonAudit?.ok === true;
  const routeAuthorityOk =
    routeAuthority?.route_authority_ok === true ||
    loopTrace?.route_authority_ok === true;
  const terminalAuthorityOk = terminalAuthority?.server_authoritative === true;
  const unexpectedToolCalls = readStringArray(loopTrace?.unexpected_tool_calls);
  const shortCircuitRiskFlags = readStringArray(
    loopTrace?.short_circuit_risk_flags,
  );
  const solverShortCircuitFlags = readStringArray(
    solverTrace?.solver_short_circuit_flags,
  );
  const solverContinuation = readSolverContinuationObservation(ask, debug);
  const solverContinuationReason = readString(solverContinuation?.reason);
  const solverContinuationNextStep = readString(
    solverContinuation?.required_next_step,
  );
  const validSolverContinuation =
    readString(solverContinuation?.schema) ===
      "helix.solver_continuation_observation.v1" &&
    Boolean(solverContinuationReason) &&
    (terminalArtifactKind === "typed_failure" ||
      finalAnswerSource === "typed_failure" ||
      solverContinuationNextStep !== "typed_failure");
  const failures: string[] = [];
  const authoritativeTypedFailure =
    authoritativeTypedFailureRequiresNoContinuation(ask) ||
    (debug !== null &&
      authoritativeTypedFailureRequiresNoContinuation(debug));
  const expectedIdentityDiagnosis =
    typeof input.scenario.expected.live_source_identity_ok === "boolean" &&
    input.scenario.expected.live_source_identity_ok === false;
  const nonStreamTurnId = readString(ask.turn_id) ?? "missing";

  if (!debug) failures.push("debug_export_missing");
  if (!terminalFailureReconciliationRuntime) {
    failures.push(
      "debug_mirror_stale:tool_rail_terminal_failure_reconciliation_runtime_missing",
    );
  } else if (!terminalFailureReconciliationRuntimeCurrent) {
    failures.push(
      `debug_mirror_stale:tool_rail_terminal_failure_reconciliation_runtime_version:${terminalFailureReconciliationRuntimeVersion ?? "missing"}!=${HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION}`,
    );
  }
  addRailTableFailures({
    failures,
    railTable,
    compoundSubgoalRailStatuses,
    turnId: nonStreamTurnId,
    prompt: input.scenario.prompt,
  });
  addRailMirrorFailures({ failures, railTables });
  addCompleteRailEnvelopeFailures({
    failures,
    railTable,
    ask,
    debug,
    authoritativeTypedFailure,
  });
  addFailClosedRailEnvelopeFailures({ failures, railTable, ask, debug });
  addRailEnvelopeProjectionFailures({
    failures,
    railTable,
    terminalArtifactKind,
  });
  if (!solverTrace) failures.push("ask_turn_solver_trace_missing");
  if (solverTrace) {
    const expectedSolverCompleted =
      input.scenario.expected.solver_completed ?? true;
    if (
      solverTrace.completed_solver_path !== expectedSolverCompleted &&
      !validSolverContinuation
    ) {
      failures.push(
        `ask_turn_solver_path_${solverTrace.completed_solver_path === true ? "complete" : "incomplete"}_unexpected`,
      );
    }
  }
  if (!input.terminalEventSeen && input.terminalEventSeen !== undefined)
    failures.push("terminal_event_missing");
  if (!terminalAuthorityOk) failures.push("terminal_authority_not_ok");
  if (
    !routeAuthorityOk &&
    !expectedIdentityDiagnosis &&
    !validSolverContinuation
  )
    failures.push("route_authority_not_ok");
  if (unexpectedToolCalls.length > 0)
    failures.push(`unexpected_tool_calls:${unexpectedToolCalls.join(",")}`);
  if (
    shortCircuitRiskFlags.length > 0 &&
    !expectedIdentityDiagnosis &&
    !validSolverContinuation
  )
    failures.push(
      `short_circuit_risk_flags:${shortCircuitRiskFlags.join(",")}`,
    );
  if (
    solverShortCircuitFlags.length > 0 &&
    !expectedIdentityDiagnosis &&
    !validSolverContinuation
  )
    failures.push(
      `solver_short_circuit_flags:${solverShortCircuitFlags.join(",")}`,
    );
  if (
    poisonAuditOk &&
    !routeAuthorityOk &&
    !expectedIdentityDiagnosis &&
    !validSolverContinuation
  )
    failures.push("poison_clean_but_authority_failed");
  if (
    input.scenario.expected.live_source_identity_diagnosis &&
    readString(liveSourceIdentityAudit?.diagnosis) !==
      input.scenario.expected.live_source_identity_diagnosis
  ) {
    failures.push(
      `live_source_identity_diagnosis_mismatch:${readString(liveSourceIdentityAudit?.diagnosis) ?? "missing"}!=${input.scenario.expected.live_source_identity_diagnosis}`,
    );
  }
  if (
    typeof input.scenario.expected.live_source_identity_ok === "boolean" &&
    liveSourceIdentityAudit?.identity_ok !==
      input.scenario.expected.live_source_identity_ok
  ) {
    failures.push(
      `live_source_identity_ok_mismatch:${String(liveSourceIdentityAudit?.identity_ok)}!=${String(input.scenario.expected.live_source_identity_ok)}`,
    );
  }

  addExpectationFailures({
    failures,
    expected: input.scenario.expected,
    sourceTarget,
    targetKind,
    selectedRoute,
    terminalArtifactKind,
    finalAnswerSource,
    loopTrace,
    solverTrace,
    selectedCapabilities,
  });

  return {
    schema: "helix.api_parity_probe_result.v1",
    scenario_id: input.scenario.id,
    prompt: input.scenario.prompt,
    non_stream_turn_id: nonStreamTurnId,
    stream_turn_id:
      readString(readRecord(input.streamTurn)?.turn_id) ?? undefined,
    debug_export_available: Boolean(debug),
    terminal_event_seen: input.terminalEventSeen ?? true,
    stream_closed_after_terminal: input.streamClosedAfterTerminal ?? true,
    source_target: sourceTarget,
    target_kind: targetKind,
    selected_route: selectedRoute,
    terminal_artifact_kind: terminalArtifactKind,
    final_answer_source: finalAnswerSource,
    loop_parity_trace: {
      admitted_tool_families: readStringArray(
        loopTrace?.admitted_tool_families,
      ),
      actual_tool_calls: readActualToolIds(loopTrace),
      unexpected_tool_calls: unexpectedToolCalls,
      observations_created_count: Array.isArray(loopTrace?.observations_created)
        ? loopTrace.observations_created.length
        : 0,
      evidence_selected_for_answer_count: Array.isArray(
        loopTrace?.evidence_selected_for_answer,
      )
        ? loopTrace.evidence_selected_for_answer.length
        : 0,
      short_circuit_risk_flags: shortCircuitRiskFlags,
    },
    ask_turn_solver_trace: {
      present: Boolean(solverTrace),
      completed_solver_path: solverTrace?.completed_solver_path === true,
      prompt_shape: readString(
        getPath(solverTrace, ["prompt_interpretation", "prompt_shape"]),
      ),
      selected_primary_intent: readString(solverTrace?.selected_primary_intent),
      primary_intent_route: readString(
        getPath(solverTrace, ["primary_intent", "route"]),
      ),
      contextual_tool_mentions: readContextualToolMentionCues(solverTrace),
      executable_operator_commands_count:
        readExecutableOperatorCommandCount(solverTrace),
      solver_short_circuit_flags: solverShortCircuitFlags,
      live_source_identity_diagnosis: readString(
        liveSourceIdentityAudit?.diagnosis,
      ),
      live_source_identity_ok:
        typeof liveSourceIdentityAudit?.identity_ok === "boolean"
          ? liveSourceIdentityAudit.identity_ok
          : null,
    },
    capability_selection: {
      capability_id: readString(capabilitySelectionResult?.capability_id),
      selected_capabilities: selectedCapabilities,
    },
    route_authority: {
      ok: routeAuthorityOk,
      primary_violation_code: readString(
        routeAuthority?.primary_violation_code,
      ),
      violation_codes: readStringArray(routeAuthority?.violation_codes),
    },
    poison_audit_ok: poisonAuditOk,
    terminal_authority_ok: terminalAuthorityOk,
    terminal_failure_reconciliation_runtime: {
      available: terminalFailureReconciliationRuntime?.available === true,
      version: terminalFailureReconciliationRuntimeVersion,
      current: terminalFailureReconciliationRuntimeCurrent,
    },
    rail_table: buildRailTableSummary(railTable, compoundSubgoalRailStatuses),
    solver_continuation_count: Number(
      ask.solver_continuation_count ?? debug?.solver_continuation_count ?? 0,
    ),
    solver_continuation_observation: solverContinuation
      ? {
          reason: solverContinuationReason,
          required_next_step: solverContinuationNextStep,
        }
      : undefined,
    procedural_ok: failures.length === 0,
    failures,
  };
}
