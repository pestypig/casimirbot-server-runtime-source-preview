import { createHash } from "node:crypto";
import type {
  HelixTurnLifecycleAuditDisposition,
  HelixTurnLifecycleAuditStage,
  HelixTurnLifecycleContinuityCheck,
  HelixTurnLifecycleProjectionAudit,
  HelixTurnLifecycleProjectionMismatch,
} from "@shared/helix-turn-lifecycle";
import { readVerifiedHelixRuntimeLifecycleFromPayload } from "./turn-lifecycle";
import { auditHelixTurnLifecycleProjection } from "./turn-lifecycle-projection-audit";
import { HELIX_MINECRAFT_COMMAND_CAPABILITY } from "@shared/helix-environment-command";
import { isIsolatedExplicitMinecraftCommandCapabilityIntent } from "../explicit-capability-contract";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map(readString)
            .filter((entry): entry is string => Boolean(entry)),
        ),
      )
    : [];

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const normalizeSha256 = (value: unknown): string | null => {
  const hash = readString(value)?.replace(/^sha256:/i, "").toLowerCase();
  return hash && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
};

const recordText = (record: RecordLike | null): string | null =>
  readString(record?.answer_text) ??
  readString(record?.candidate_text) ??
  readString(record?.text) ??
  readString(record?.concise_text) ??
  readString(record?.visible_text) ??
  null;

const artifactRecords = (payload: RecordLike): RecordLike[] =>
  Array.isArray(payload.current_turn_artifact_ledger)
    ? payload.current_turn_artifact_ledger
        .map(readRecord)
        .filter((entry): entry is RecordLike => Boolean(entry))
    : [];

const promptTextForAudit = (
  payload: RecordLike,
  debug: RecordLike | null,
): string | null =>
  readString(payload.active_prompt) ??
  readString(payload.question) ??
  readString(payload.prompt) ??
  readString(payload.user_prompt) ??
  readString(payload.input_text) ??
  readString(readRecord(payload.provider_gateway_debug_summary)?.prompt) ??
  readString(readRecord(debug?.provider_gateway_debug_summary)?.prompt) ??
  null;

const uniqueGatewayCallResults = (
  payload: RecordLike,
  debug: RecordLike | null,
): RecordLike[] => {
  const values = [
    ...(Array.isArray(payload.workstation_gateway_call_results)
      ? payload.workstation_gateway_call_results
      : []),
    ...(Array.isArray(debug?.workstation_gateway_call_results)
      ? (debug?.workstation_gateway_call_results as unknown[])
      : []),
  ]
    .map(readRecord)
    .filter((entry): entry is RecordLike => Boolean(entry));
  const unique = new Map<string, RecordLike>();
  values.forEach((entry, index) => {
    const packet = readRecord(entry.observation_packet);
    const key =
      readString(packet?.call_id) ??
      readString(packet?.observation_ref) ??
      readString(entry.call_id) ??
      `${readString(entry.capability_id) ?? "unknown"}:${index}`;
    if (!unique.has(key)) unique.set(key, entry);
  });
  return [...unique.values()];
};

const gatewayCapability = (result: RecordLike): string | null =>
  readString(readRecord(result.gateway_admission)?.requested_capability) ??
  readString(result.capability_id);

const commandExecutionIdentity = (result: RecordLike): string | null => {
  const observation = readRecord(result.observation);
  return (
    readString(observation?.command_execution_ref) ??
    readString(readRecord(observation?.result)?.command_execution_id)
  );
};

const commandHash = (result: RecordLike): string | null => {
  const observation = readRecord(result.observation);
  return (
    normalizeSha256(observation?.command_hash) ??
    normalizeSha256(readRecord(observation?.result)?.command_hash)
  );
};

const artifactPayloadByRef = (
  payload: RecordLike,
  artifactRef: string | null,
): RecordLike | null => {
  if (!artifactRef) return null;
  const artifact = artifactRecords(payload).find(
    (entry) => readString(entry.artifact_id) === artifactRef,
  );
  return readRecord(artifact?.payload);
};

const requiredTerminalKind = (payload: RecordLike): string | null => {
  const committed = readRecord(payload.committed_ask_route);
  return (
    readString(readRecord(committed?.canonical_goal)?.required_terminal_kind) ??
    readString(
      readRecord(committed?.terminal_product)?.required_terminal_product,
    ) ??
    readString(
      readRecord(payload.canonical_goal_frame)?.required_terminal_kind,
    ) ??
    readString(
      readRecord(payload.route_product_contract)?.required_terminal_artifact_kind,
    ) ??
    null
  );
};

const candidateTextHash = (candidate: RecordLike | null): string | null => {
  const declared = normalizeSha256(candidate?.candidate_text_hash);
  if (declared) return declared;
  const fullText = readString(candidate?.candidate_text);
  if (fullText) return sha256(fullText);
  const preview = readString(candidate?.candidate_text_preview);
  const length =
    typeof candidate?.candidate_text_length === "number"
      ? candidate.candidate_text_length
      : null;
  return preview && (length === null || length <= preview.length)
    ? sha256(preview)
    : null;
};

const textHash = (text: string | null): string | null =>
  text ? sha256(text) : null;

const missingRefs = (expected: string[], observed: string[]): string[] => {
  const observedSet = new Set(observed);
  return expected.filter((ref) => !observedSet.has(ref));
};

const mismatch = (args: {
  code: HelixTurnLifecycleProjectionMismatch["code"];
  lifecycleEventId: string | null;
  projectionPath: string;
  lifecycleValue: boolean | string | null;
  projectionValue: boolean | string | null;
  stage: HelixTurnLifecycleAuditStage;
  disposition?: HelixTurnLifecycleAuditDisposition;
}): HelixTurnLifecycleProjectionMismatch => ({
  code: args.code,
  lifecycle_event_id: args.lifecycleEventId,
  projection_path: args.projectionPath,
  lifecycle_value: args.lifecycleValue,
  projection_value: args.projectionValue,
  stage: args.stage,
  disposition: args.disposition ?? "adapter_projection_contradiction",
});

const firstDivergence = (
  mismatches: HelixTurnLifecycleProjectionMismatch[],
): HelixTurnLifecycleAuditStage | null => {
  const order: HelixTurnLifecycleAuditStage[] = [
    "tool_execution",
    "evidence_reentry",
    "followup_reasoning",
    "scientific_evidence",
    "terminal_materialization",
    "terminal_authority",
    "presentation",
  ];
  return (
    order.find((stage) =>
      mismatches.some(
        (entry) =>
          entry.stage === stage &&
          entry.disposition === "adapter_projection_contradiction",
      ),
    ) ?? null
  );
};

const legacyMismatchStage = (
  code: HelixTurnLifecycleProjectionMismatch["code"],
): HelixTurnLifecycleAuditStage => {
  if (code === "legacy_evidence_reentry_disagrees_with_runtime")
    return "evidence_reentry";
  if (
    code === "legacy_followup_reasoning_disagrees_with_runtime" ||
    code === "legacy_provider_completion_disagrees_with_runtime"
  )
    return "followup_reasoning";
  return "terminal_authority";
};

/**
 * Compares the factual Codex event log with each downstream Helix projection.
 * This is diagnostic only: it never contains raw answer text and never grants
 * terminal authority. Evidence/policy gates remain hard boundaries; a later
 * deterministic rail silently changing an authorized candidate is classified
 * separately as an adapter projection contradiction.
 */
export const buildHelixTurnLifecycleDifferentialAudit = (input: {
  payload: RecordLike;
  turnId: string;
}): HelixTurnLifecycleProjectionAudit => {
  const payload = input.payload;
  const debug = readRecord(payload.debug);
  const lifecycle = readVerifiedHelixRuntimeLifecycleFromPayload({
    payload,
    turnId: input.turnId,
  });
  const solverTrace = readRecord(payload.ask_turn_solver_trace);
  const writer =
    readRecord(payload.terminal_authority_single_writer) ??
    readRecord(debug?.terminal_authority_single_writer);
  const legacyAudit = lifecycle
    ? auditHelixTurnLifecycleProjection({
        lifecycle,
        projection: {
          evidence_reentry_completed: readBoolean(
            readRecord(solverTrace?.evidence_reentry)?.completed,
          ),
          followup_reasoning_completed: readBoolean(
            readRecord(solverTrace?.followup_reasoning)?.completed,
          ),
          provider_solver_completion_observed: readBoolean(
            readRecord(writer?.integrity)?.provider_solver_completion_observed,
          ),
          terminal_error_code:
            readString(payload.terminal_error_code) ??
            readString(debug?.terminal_error_code),
          terminal_rejection_reason:
            readString(payload.terminal_rejection_reason) ??
            readString(debug?.terminal_rejection_reason),
          terminal_eligible: readBoolean(
            readRecord(payload.terminal_answer_authority)?.terminal_eligible,
          ),
          provider_terminal_candidate_text:
            readString(
              readRecord(payload.provider_terminal_candidate)?.candidate_text,
            ) ??
            readString(
              readRecord(payload.provider_terminal_candidate)
                ?.candidate_text_preview,
            ),
        },
      })
    : {
        schema: "helix.turn_lifecycle_projection_audit.v1" as const,
        ok: true,
        mismatches: [],
        assistant_answer: false as const,
        raw_content_included: false as const,
      };
  const mismatches: HelixTurnLifecycleProjectionMismatch[] =
    legacyAudit.mismatches.map((entry) => ({
      ...entry,
      stage: entry.stage ?? legacyMismatchStage(entry.code),
      disposition:
        entry.disposition ?? "adapter_projection_contradiction",
    }));
  const checks: HelixTurnLifecycleContinuityCheck[] = [];
  const runtimeLoopAdmission =
    readRecord(payload.agent_runtime_loop_admission) ??
    artifactRecords(payload)
      .filter(
        (entry) => readString(entry.kind) === "agent_runtime_loop_admission",
      )
      .map((entry) => readRecord(entry.payload))
      .filter((entry): entry is RecordLike => Boolean(entry))
      .at(-1) ??
    null;
  const recordOnlyAdmission = Boolean(
    readString(runtimeLoopAdmission?.schema) ===
      "helix.agent_runtime_loop_admission.v1" &&
      runtimeLoopAdmission?.admitted === true &&
      readString(runtimeLoopAdmission?.mode) === "record_only",
  );
  const settledTerminalRecordOnlyAdmission = Boolean(
    recordOnlyAdmission &&
      readString(runtimeLoopAdmission?.reason) ===
        "source_or_capability_terminal_failure_requires_runtime_loop_record",
  );
  const forbiddenRecordOnlyExecutionArtifacts = settledTerminalRecordOnlyAdmission
    ? artifactRecords(payload).filter((entry) =>
        ["runtime_tool_call", "runtime_tool_observation"].includes(
          readString(entry.kind) ?? "",
        ),
      )
    : [];
  if (settledTerminalRecordOnlyAdmission) {
    const recordOnlyStayedNonExecuting =
      forbiddenRecordOnlyExecutionArtifacts.length === 0;
    checks.push({
      stage: "tool_execution",
      check: "record_only_admission_did_not_execute",
      status: recordOnlyStayedNonExecuting ? "passed" : "failed",
      disposition: recordOnlyStayedNonExecuting
        ? "informational"
        : "adapter_projection_contradiction",
      source_ref: readString(runtimeLoopAdmission?.turn_id),
      expected_support_ref_count: 0,
      observed_support_ref_count: forbiddenRecordOnlyExecutionArtifacts.length,
      reason_codes: forbiddenRecordOnlyExecutionArtifacts
        .map((entry) => readString(entry.kind))
        .filter((entry): entry is string => Boolean(entry)),
    });
    if (!recordOnlyStayedNonExecuting) {
      mismatches.push(
        mismatch({
          code: "record_only_admission_executed_runtime_steps",
          lifecycleEventId: null,
          projectionPath:
            "current_turn_artifact_ledger.runtime_execution_artifacts",
          lifecycleValue: "record_only",
          projectionValue: forbiddenRecordOnlyExecutionArtifacts
            .map((entry) => readString(entry.kind))
            .filter(Boolean)
            .join(","),
          stage: "tool_execution",
        }),
      );
    }
  }
  const finalMessage = lifecycle?.events
    .slice()
    .reverse()
    .find((event) => event.kind === "agent.message.completed");
  if (lifecycle) {
    checks.push({
      stage: "evidence_reentry",
      check: "runtime_observation_reentry",
      status:
        lifecycle.reduction.observation_reentry_refs.length > 0
          ? "passed"
          : "not_observed",
      disposition: "informational",
      source_ref: lifecycle.reduction.latest_reentry_event_id,
      expected_support_ref_count:
        lifecycle.reduction.observation_reentry_refs.length,
      observed_support_ref_count:
        lifecycle.reduction.observation_reentry_refs.length,
    });
    checks.push({
      stage: "followup_reasoning",
      check: "runtime_followup_reasoning",
      status: lifecycle.reduction.post_observation_reasoning_completed
        ? "passed"
        : "not_observed",
      disposition: "informational",
      source_ref: lifecycle.reduction.final_agent_message_event_id,
    });
  }
  const providerReentry =
    readRecord(payload.provider_reasoning_reentry) ??
    readRecord(debug?.provider_reasoning_reentry);
  const providerObservationReentered =
    readBoolean(providerReentry?.observation_reentered) ??
    readBoolean(providerReentry?.evidence_reentered);
  const providerReenteredRefs = readStringArray(
    providerReentry?.reentered_observation_refs ??
      providerReentry?.input_observation_refs,
  );
  const capabilityLaneTimeline = [
    ...(Array.isArray(payload.capability_lane_turn_timeline)
      ? payload.capability_lane_turn_timeline
      : []),
    ...(Array.isArray(debug?.capability_lane_turn_timeline)
      ? (debug.capability_lane_turn_timeline as unknown[])
      : []),
  ]
    .map(readRecord)
    .filter((entry): entry is RecordLike => Boolean(entry));
  const capabilityLaneReenteredRefs = Array.from(
    new Set(
      capabilityLaneTimeline
        .filter(
          (event) =>
            readString(event.stage) === "lane_reentered" &&
            readBoolean(event.observation_reentered) === true,
        )
        .map((event) => readString(event.observation_ref))
        .filter((ref): ref is string => Boolean(ref)),
    ),
  );
  const executedLaneObservationRefs = new Set(
    capabilityLaneTimeline
      .filter(
        (event) =>
          readString(event.stage) === "lane_observation" &&
          readBoolean(event.lane_executed) === true,
      )
      .map((event) => readString(event.observation_ref))
      .filter((ref): ref is string => Boolean(ref)),
  );
  const successfulLaneReentryRows = capabilityLaneTimeline.filter((event) => {
    const observationRef = readString(event.observation_ref);
    return (
      readString(event.stage) === "lane_reentered" &&
      readBoolean(event.observation_reentered) === true &&
      Boolean(observationRef && executedLaneObservationRefs.has(observationRef))
    );
  });
  const executionRegressedAtReentry = successfulLaneReentryRows.filter(
    (event) => readBoolean(event.lane_executed) !== true,
  );
  if (successfulLaneReentryRows.length > 0) {
    checks.push({
      stage: "evidence_reentry",
      check: "capability_lane_execution_continuity",
      status:
        executionRegressedAtReentry.length === 0 ? "passed" : "failed",
      disposition:
        executionRegressedAtReentry.length === 0
          ? "informational"
          : "adapter_projection_contradiction",
      source_ref:
        readString(successfulLaneReentryRows[0]?.observation_ref) ?? null,
      expected_support_ref_count: successfulLaneReentryRows.length,
      observed_support_ref_count:
        successfulLaneReentryRows.length - executionRegressedAtReentry.length,
      missing_support_refs: executionRegressedAtReentry
        .map((event) => readString(event.observation_ref))
        .filter((ref): ref is string => Boolean(ref)),
    });
  }
  executionRegressedAtReentry.forEach((event) => {
    mismatches.push(
      mismatch({
        code: "capability_lane_execution_regressed_at_reentry",
        lifecycleEventId: null,
        projectionPath: "capability_lane_turn_timeline.lane_reentered.lane_executed",
        lifecycleValue: true,
        projectionValue: readBoolean(event.lane_executed),
        stage: "evidence_reentry",
      }),
    );
  });
  if (capabilityLaneReenteredRefs.length > 0) {
    const runtimeReenteredRefs =
      lifecycle?.reduction.observation_reentry_refs ?? [];
    const missingProviderRefs = missingRefs(
      capabilityLaneReenteredRefs,
      providerObservationReentered ? providerReenteredRefs : [],
    );
    const missingRuntimeRefs = missingRefs(
      capabilityLaneReenteredRefs,
      runtimeReenteredRefs,
    );
    const laneAgreesWithProvider =
      providerObservationReentered === true &&
      missingProviderRefs.length === 0;
    const laneAgreesWithRuntime =
      Boolean(lifecycle) && missingRuntimeRefs.length === 0;
    checks.push({
      stage: "evidence_reentry",
      check: "capability_lane_observation_reentry",
      status:
        laneAgreesWithProvider && laneAgreesWithRuntime
          ? "passed"
          : "failed",
      disposition:
        laneAgreesWithProvider && laneAgreesWithRuntime
          ? "informational"
          : "adapter_projection_contradiction",
      source_ref: capabilityLaneReenteredRefs[0] ?? null,
      target_ref: lifecycle?.reduction.latest_reentry_event_id ?? null,
      expected_support_ref_count: capabilityLaneReenteredRefs.length,
      observed_support_ref_count: runtimeReenteredRefs.length,
      missing_support_refs: Array.from(
        new Set([...missingProviderRefs, ...missingRuntimeRefs]),
      ),
    });
    if (!laneAgreesWithProvider) {
      mismatches.push(
        mismatch({
          code: "capability_lane_reentry_disagrees_with_provider",
          lifecycleEventId: null,
          projectionPath:
            "provider_reasoning_reentry.observation_reentered",
          lifecycleValue: true,
          projectionValue: providerObservationReentered,
          stage: "evidence_reentry",
        }),
      );
    }
    if (!laneAgreesWithRuntime) {
      mismatches.push(
        mismatch({
          code: "capability_lane_reentry_disagrees_with_runtime",
          lifecycleEventId:
            lifecycle?.reduction.latest_reentry_event_id ?? null,
          projectionPath: "turn_lifecycle.observation.reentered",
          lifecycleValue: runtimeReenteredRefs.length > 0,
          projectionValue: true,
          stage: "evidence_reentry",
        }),
      );
    }
  }
  if (lifecycle && providerObservationReentered !== null) {
    const runtimeReenteredRefs = lifecycle.reduction.observation_reentry_refs;
    const missingRuntimeRefs = missingRefs(
      providerObservationReentered ? providerReenteredRefs : [],
      runtimeReenteredRefs,
    );
    const reentryProjectionAgrees = providerObservationReentered
      ? providerReenteredRefs.length > 0 && missingRuntimeRefs.length === 0
      : runtimeReenteredRefs.length === 0;
    checks.push({
      stage: "evidence_reentry",
      check: "provider_observation_reentry",
      status: reentryProjectionAgrees ? "passed" : "failed",
      disposition: reentryProjectionAgrees
        ? "informational"
        : "adapter_projection_contradiction",
      source_ref: lifecycle.reduction.latest_reentry_event_id,
      target_ref: readString(providerReentry?.provider_terminal_candidate_ref),
      expected_support_ref_count: providerReenteredRefs.length,
      observed_support_ref_count: runtimeReenteredRefs.length,
      missing_support_refs: missingRuntimeRefs,
    });
    if (!reentryProjectionAgrees) {
      mismatches.push(
        mismatch({
          code: "provider_observation_reentry_disagrees_with_runtime",
          lifecycleEventId: lifecycle.reduction.latest_reentry_event_id,
          projectionPath: "provider_reasoning_reentry.observation_reentered",
          lifecycleValue: runtimeReenteredRefs.length > 0,
          projectionValue: providerObservationReentered,
          stage: "evidence_reentry",
        }),
      );
    }
  }

  const prompt = promptTextForAudit(payload, debug);
  const gatewayResults = uniqueGatewayCallResults(payload, debug);
  const isolatedMinecraftCommand =
    isIsolatedExplicitMinecraftCommandCapabilityIntent(prompt);
  const exactlyOneMinecraftCommand = Boolean(
    isolatedMinecraftCommand &&
      /\b(?:run|execute|issue|send)\s+exactly\s+one\s+(?:(?:live|minecraft|fabric|server)\s+){0,4}command\b/iu.test(
        prompt ?? "",
      ),
  );
  const successfulCommandResults = gatewayResults.filter(
    (result) =>
      result.ok === true && gatewayCapability(result) === HELIX_MINECRAFT_COMMAND_CAPABILITY,
  );
  const physicalCommandExecutions = new Map<string, Set<string>>();
  for (const result of successfulCommandResults) {
    const hash = commandHash(result);
    const executionId = commandExecutionIdentity(result);
    if (!hash || !executionId) continue;
    const ids = physicalCommandExecutions.get(hash) ?? new Set<string>();
    ids.add(executionId);
    physicalCommandExecutions.set(hash, ids);
  }
  const physicalExecutionCount = Array.from(
    new Set(
      [...physicalCommandExecutions.values()].flatMap((ids) => [...ids]),
    ),
  ).length;
  if (exactlyOneMinecraftCommand) {
    const cardinalitySatisfied = physicalExecutionCount === 1;
    checks.push({
      stage: "tool_execution",
      check: "requested_tool_cardinality",
      status: cardinalitySatisfied ? "passed" : "failed",
      disposition: cardinalitySatisfied
        ? "informational"
        : "adapter_projection_contradiction",
      expected_support_ref_count: 1,
      observed_support_ref_count: physicalExecutionCount,
    });
    if (!cardinalitySatisfied) {
      mismatches.push(
        mismatch({
          code: "exact_tool_cardinality_violated",
          lifecycleEventId: null,
          projectionPath:
            "workstation_gateway_call_results.minecraft_command_execution_count",
          lifecycleValue: "1",
          projectionValue: String(physicalExecutionCount),
          stage: "tool_execution",
        }),
      );
    }
  }
  const forbidsOtherTools = Boolean(
    isolatedMinecraftCommand &&
      /\b(?:do\s+not|don't)\s+(?:run|execute|use|call|invoke)\s+(?:any\s+)?(?:other|another)\s+(?:(?:command|capability)(?:s)?\s+(?:or|and)\s+)?(?:tool|capability)(?:s)?\b/iu.test(
        prompt ?? "",
      ),
  );
  if (forbidsOtherTools) {
    const extraCapabilities = Array.from(
      new Set(
        gatewayResults
          .map(gatewayCapability)
          .filter(
            (capability): capability is string =>
              Boolean(capability) && capability !== HELIX_MINECRAFT_COMMAND_CAPABILITY,
          ),
      ),
    ).sort();
    checks.push({
      stage: "tool_execution",
      check: "forbidden_other_tools_absent",
      status: extraCapabilities.length === 0 ? "passed" : "failed",
      disposition:
        extraCapabilities.length === 0
          ? "informational"
          : "adapter_projection_contradiction",
      reason_codes: extraCapabilities,
    });
    if (extraCapabilities.length > 0) {
      mismatches.push(
        mismatch({
          code: "forbidden_extra_tool_executed",
          lifecycleEventId: null,
          projectionPath: "workstation_gateway_call_results.capability_ids",
          lifecycleValue: HELIX_MINECRAFT_COMMAND_CAPABILITY,
          projectionValue: extraCapabilities.join(","),
          stage: "tool_execution",
        }),
      );
    }
  }

  const bridge =
    readRecord(payload.provider_terminal_authority_bridge) ??
    readRecord(debug?.provider_terminal_authority_bridge);
  const candidate =
    readRecord(payload.provider_terminal_candidate) ??
    readRecord(bridge?.provider_terminal_candidate) ??
    readRecord(debug?.provider_terminal_candidate);
  const candidateRef =
    readString(candidate?.candidate_id) ??
    readString(bridge?.provider_terminal_candidate_ref) ??
    null;
  const candidateHash = candidateTextHash(candidate);
  const candidateAuthorized = Boolean(
    candidateRef &&
      ((bridge?.terminal_authority_granted === true &&
        bridge?.final_visible_answer_authorized === true) ||
        (readString(
          readRecord(payload.terminal_answer_authority)
            ?.terminal_artifact_kind,
        ) === "agent_provider_terminal_candidate" &&
          readRecord(payload.terminal_answer_authority)?.server_authoritative ===
            true)),
  );
  checks.push({
    stage: "terminal_authority",
    check: "provider_candidate_authorized",
    status: candidateRef
      ? candidateAuthorized
        ? "passed"
        : "failed_closed"
      : "not_observed",
    disposition: candidateAuthorized ? "informational" : "hard_policy_boundary",
    source_ref: candidateRef,
  });

  const runtimeHash = normalizeSha256(finalMessage?.message_sha256);
  if (runtimeHash && candidateHash) {
    const matches = runtimeHash === candidateHash;
    checks.push({
      stage: "followup_reasoning",
      check: "runtime_message_matches_provider_candidate",
      status: matches ? "passed" : "failed",
      disposition: matches ? "informational" : "adapter_projection_contradiction",
      source_ref: finalMessage?.event_id ?? null,
      target_ref: candidateRef,
      source_sha256: runtimeHash,
      target_sha256: candidateHash,
    });
    if (!matches) {
      mismatches.push(
        mismatch({
          code: "provider_candidate_disagrees_with_runtime_message",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath: "provider_terminal_candidate.candidate_text_hash",
          lifecycleValue: runtimeHash,
          projectionValue: candidateHash,
          stage: "followup_reasoning",
        }),
      );
    }
  }

  const materialization =
    readRecord(payload.provider_route_product_materialization) ??
    readRecord(debug?.provider_route_product_materialization);
  const materializedKind = readString(
    materialization?.materialized_terminal_artifact_kind,
  );
  const materializedRef = readString(
    materialization?.materialized_terminal_artifact_ref,
  );
  const materializedRecord =
    readRecord(materializedKind ? payload[materializedKind] : null) ??
    artifactPayloadByRef(payload, materializedRef);
  const materializedHash = textHash(recordText(materializedRecord));
  const materializedSupportRefs = readStringArray(
    materialization?.selected_observation_refs ??
      materializedRecord?.selected_observation_refs ??
      materializedRecord?.support_refs,
  );
  const requestedKind = requiredTerminalKind(payload);
  const routeProductExpected = Boolean(
    candidateAuthorized &&
      requestedKind &&
      requestedKind !== "agent_provider_terminal_candidate",
  );
  const qualityGate = readRecord(payload.provider_route_product_quality_gate);
  const materializationDiagnostic = readRecord(
    payload.provider_route_product_materialization_diagnostic,
  );
  const qualityGateFailed = qualityGate?.ok === false;
  const rejectionObservations = Array.isArray(
    payload.terminal_rejection_observations,
  )
    ? payload.terminal_rejection_observations
        .map(readRecord)
        .filter(
          (entry): entry is RecordLike => Boolean(entry?.recoverable === true),
        )
    : [];
  const continuationState = readRecord(payload.agent_continuation_state);
  const allowedDecisions = readStringArray(continuationState?.allowed_decisions);
  const hardBudgetExhausted =
    readRecord(readRecord(continuationState?.budget)?.hard)?.exhausted === true;
  const recoverablePending =
    rejectionObservations.length > 0 &&
    !hardBudgetExhausted &&
    allowedDecisions.some((decision) =>
      ["act", "retry", "answer"].includes(decision),
    );
  const qualityGateRepairPending = Boolean(
    qualityGateFailed &&
      recoverablePending &&
      rejectionObservations.some(
        (entry) =>
          readString(entry.rejection_reason) === "route_requires_synthesis" &&
          readString(entry.gate) === "provider_route_product_quality_gate",
      ),
  );
  const evidenceBoundary = Boolean(
    (qualityGateFailed && !qualityGateRepairPending) ||
      materializationDiagnostic?.itinerary_observation_criteria_satisfied ===
        false ||
      materializationDiagnostic?.compound_support_missing === true,
  );
  const policyBoundary = Boolean(
    readRecord(payload.route_evidence_authority)?.terminal_product_allowed ===
      false,
  );

  if (routeProductExpected) {
    const materialized =
      readString(materialization?.status) === "materialized" &&
      Boolean(materializedKind && materializedRef);
    checks.push({
      stage: "terminal_materialization",
      check: "provider_candidate_materialized",
      status: materialized
        ? "passed"
        : qualityGateRepairPending
          ? "failed"
        : evidenceBoundary || policyBoundary
          ? "failed_closed"
          : "failed",
      disposition: qualityGateRepairPending
        ? "informational"
        : evidenceBoundary
        ? "hard_evidence_boundary"
        : policyBoundary
          ? "hard_policy_boundary"
          : materialized
            ? "informational"
            : "adapter_projection_contradiction",
      source_ref: candidateRef,
      target_ref: materializedRef,
    });
    if (
      !materialized &&
      !qualityGateRepairPending &&
      !evidenceBoundary &&
      !policyBoundary
    ) {
      mismatches.push(
        mismatch({
          code: "authorized_provider_candidate_not_materialized",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath: "provider_route_product_materialization.status",
          lifecycleValue: "authorized_provider_candidate",
          projectionValue: readString(materialization?.status),
          stage: "terminal_materialization",
        }),
      );
    }
    if (materialized) {
      const materializedCandidateRef = readString(
        materialization?.provider_terminal_candidate_ref ??
          materializedRecord?.provider_terminal_candidate_ref,
      );
      const refMatches =
        Boolean(candidateRef) && materializedCandidateRef === candidateRef;
      checks.push({
        stage: "terminal_materialization",
        check: "provider_candidate_ref_preserved",
        status: refMatches ? "passed" : "failed",
        disposition: refMatches
          ? "informational"
          : "adapter_projection_contradiction",
        source_ref: candidateRef,
        target_ref: materializedCandidateRef,
      });
      if (!refMatches) {
        mismatches.push(
          mismatch({
            code: "provider_candidate_ref_lost_during_materialization",
            lifecycleEventId: finalMessage?.event_id ?? null,
            projectionPath:
              "provider_route_product_materialization.provider_terminal_candidate_ref",
            lifecycleValue: candidateRef,
            projectionValue: materializedCandidateRef,
            stage: "terminal_materialization",
          }),
        );
      }
      if (candidateHash && materializedHash) {
        const textMatches = candidateHash === materializedHash;
        checks.push({
          stage: "terminal_materialization",
          check: "provider_candidate_text_preserved",
          status: textMatches ? "passed" : "failed",
          disposition: textMatches
            ? "informational"
            : "adapter_projection_contradiction",
          source_ref: candidateRef,
          target_ref: materializedRef,
          source_sha256: candidateHash,
          target_sha256: materializedHash,
        });
        if (!textMatches) {
          mismatches.push(
            mismatch({
              code: "provider_candidate_text_changed_during_materialization",
              lifecycleEventId: finalMessage?.event_id ?? null,
              projectionPath: `${materializedKind}.answer_text`,
              lifecycleValue: candidateHash,
              projectionValue: materializedHash,
              stage: "terminal_materialization",
            }),
          );
        }
      }
    }
  }

  const currentArtifactRefs = new Set(
    artifactRecords(payload)
      .map((entry) => readString(entry.artifact_id))
      .filter((entry): entry is string => Boolean(entry)),
  );
  const candidateSupportRefs = Array.from(
    new Set([
      ...readStringArray(candidate?.grounded_in_observation_refs),
      ...readStringArray(candidate?.normalized_observation_refs),
    ]),
  );
  const expectedSupportRefs =
    currentArtifactRefs.size > 0
      ? candidateSupportRefs.filter((ref) => currentArtifactRefs.has(ref))
      : [];
  if (routeProductExpected && materializedRef && expectedSupportRefs.length > 0) {
    const missing = missingRefs(expectedSupportRefs, materializedSupportRefs);
    checks.push({
      stage: "terminal_materialization",
      check: "provider_candidate_evidence_refs_preserved",
      status: missing.length === 0 ? "passed" : "failed",
      disposition:
        missing.length === 0
          ? "informational"
          : "adapter_projection_contradiction",
      source_ref: candidateRef,
      target_ref: materializedRef,
      expected_support_ref_count: expectedSupportRefs.length,
      observed_support_ref_count: materializedSupportRefs.length,
      missing_support_refs: missing,
    });
    if (missing.length > 0) {
      mismatches.push(
        mismatch({
          code: "provider_candidate_evidence_refs_dropped",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath:
            "provider_route_product_materialization.selected_observation_refs",
          lifecycleValue: expectedSupportRefs.join(","),
          projectionValue: materializedSupportRefs.join(","),
          stage: "terminal_materialization",
        }),
      );
    }
  }

  const writerKind = readString(writer?.selected_terminal_artifact_kind);
  const writerRef = readString(writer?.selected_terminal_artifact_ref);
  const writerHash = textHash(recordText(writer));
  const writerSupportRefs = readStringArray(
    writer?.selected_terminal_support_refs ?? payload.selected_terminal_support_refs,
  );
  if (
    candidateAuthorized &&
    !routeProductExpected &&
    writerKind === "agent_provider_terminal_candidate"
  ) {
    const refMatches = writerRef === candidateRef;
    checks.push({
      stage: "terminal_authority",
      check: "provider_candidate_ref_preserved_by_terminal_writer",
      status: refMatches ? "passed" : "failed",
      disposition: refMatches
        ? "informational"
        : "adapter_projection_contradiction",
      source_ref: candidateRef,
      target_ref: writerRef,
    });
    if (!refMatches) {
      mismatches.push(
        mismatch({
          code: "provider_candidate_ref_lost_by_terminal_writer",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath:
            "terminal_authority_single_writer.selected_terminal_artifact_ref",
          lifecycleValue: candidateRef,
          projectionValue: writerRef,
          stage: "terminal_authority",
        }),
      );
    }
    if (candidateHash && writerHash) {
      const textMatches = candidateHash === writerHash;
      checks.push({
        stage: "terminal_authority",
        check: "provider_candidate_text_preserved_by_terminal_writer",
        status: textMatches ? "passed" : "failed",
        disposition: textMatches
          ? "informational"
          : "adapter_projection_contradiction",
        source_ref: candidateRef,
        target_ref: writerRef,
        source_sha256: candidateHash,
        target_sha256: writerHash,
      });
      if (!textMatches) {
        mismatches.push(
          mismatch({
            code: "provider_candidate_text_changed_by_terminal_writer",
            lifecycleEventId: finalMessage?.event_id ?? null,
            projectionPath: "terminal_authority_single_writer.visible_text",
            lifecycleValue: candidateHash,
            projectionValue: writerHash,
            stage: "terminal_authority",
          }),
        );
      }
    }
    if (expectedSupportRefs.length > 0) {
      const missing = missingRefs(expectedSupportRefs, writerSupportRefs);
      checks.push({
        stage: "terminal_authority",
        check: "provider_candidate_evidence_refs_preserved_by_terminal_writer",
        status: missing.length === 0 ? "passed" : "failed",
        disposition:
          missing.length === 0
            ? "informational"
            : "adapter_projection_contradiction",
        source_ref: candidateRef,
        target_ref: writerRef,
        expected_support_ref_count: expectedSupportRefs.length,
        observed_support_ref_count: writerSupportRefs.length,
        missing_support_refs: missing,
      });
      if (missing.length > 0) {
        mismatches.push(
          mismatch({
            code: "provider_candidate_evidence_refs_dropped_by_terminal_writer",
            lifecycleEventId: finalMessage?.event_id ?? null,
            projectionPath:
              "terminal_authority_single_writer.selected_terminal_support_refs",
            lifecycleValue: expectedSupportRefs.join(","),
            projectionValue: writerSupportRefs.join(","),
            stage: "terminal_authority",
          }),
        );
      }
    }
  }
  if (materializedRef && materializedHash && writerHash) {
    const textMatches = materializedHash === writerHash;
    checks.push({
      stage: "terminal_authority",
      check: "materialized_text_preserved_by_terminal_writer",
      status: textMatches ? "passed" : "failed",
      disposition: textMatches
        ? "informational"
        : "adapter_projection_contradiction",
      source_ref: materializedRef,
      target_ref: writerRef,
      source_sha256: materializedHash,
      target_sha256: writerHash,
    });
    if (!textMatches) {
      mismatches.push(
        mismatch({
          code: "materialized_text_changed_by_terminal_writer",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath: "terminal_authority_single_writer.visible_text",
          lifecycleValue: materializedHash,
          projectionValue: writerHash,
          stage: "terminal_authority",
        }),
      );
    }
    const missing = missingRefs(materializedSupportRefs, writerSupportRefs);
    checks.push({
      stage: "terminal_authority",
      check: "materialized_evidence_refs_preserved_by_terminal_writer",
      status: missing.length === 0 ? "passed" : "failed",
      disposition:
        missing.length === 0
          ? "informational"
          : "adapter_projection_contradiction",
      source_ref: materializedRef,
      target_ref: writerRef,
      expected_support_ref_count: materializedSupportRefs.length,
      observed_support_ref_count: writerSupportRefs.length,
      missing_support_refs: missing,
    });
    if (missing.length > 0) {
      mismatches.push(
        mismatch({
          code: "materialized_evidence_refs_dropped_by_terminal_writer",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath:
            "terminal_authority_single_writer.selected_terminal_support_refs",
          lifecycleValue: materializedSupportRefs.join(","),
          projectionValue: writerSupportRefs.join(","),
          stage: "terminal_authority",
        }),
      );
    }
  }

  const visibleText =
    readString(payload.selected_final_answer) ??
    readString(payload.answer) ??
    readString(payload.text);
  const visibleHash = textHash(visibleText);
  if (writerHash && visibleHash) {
    const visibleMatches = writerHash === visibleHash;
    checks.push({
      stage: "presentation",
      check: "terminal_writer_text_preserved_in_visible_projection",
      status: visibleMatches ? "passed" : "failed",
      disposition: visibleMatches
        ? "informational"
        : "adapter_projection_contradiction",
      source_ref: writerRef,
      target_ref: readString(payload.terminal_artifact_id),
      source_sha256: writerHash,
      target_sha256: visibleHash,
    });
    if (!visibleMatches) {
      mismatches.push(
        mismatch({
          code: "terminal_writer_text_changed_in_visible_projection",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath: "selected_final_answer",
          lifecycleValue: writerHash,
          projectionValue: visibleHash,
          stage: "presentation",
        }),
      );
    }
  }

  let scientificEvidenceDisposition:
    | "passed"
    | "repair_pending"
    | "failed_closed"
    | "bypassed"
    | "not_observed" = "not_observed";
  if (qualityGate) {
    if (qualityGate.ok === true) scientificEvidenceDisposition = "passed";
    else if (qualityGateRepairPending)
      scientificEvidenceDisposition = "repair_pending";
    else if (qualityGateFailed && writerKind === "typed_failure")
      scientificEvidenceDisposition = "failed_closed";
    else if (qualityGateFailed) scientificEvidenceDisposition = "bypassed";
    checks.push({
      stage: "scientific_evidence",
      check: "evidence_quality_gate",
      status:
        scientificEvidenceDisposition === "passed"
          ? "passed"
          : scientificEvidenceDisposition === "repair_pending"
            ? "failed"
          : scientificEvidenceDisposition === "failed_closed"
            ? "failed_closed"
            : "failed",
      disposition:
        scientificEvidenceDisposition === "bypassed"
          ? "adapter_projection_contradiction"
          : scientificEvidenceDisposition === "failed_closed"
            ? "hard_evidence_boundary"
            : "informational",
      reason_codes: readStringArray(qualityGate.violations),
    });
    if (scientificEvidenceDisposition === "bypassed") {
      mismatches.push(
        mismatch({
          code: "failed_evidence_quality_gate_bypassed",
          lifecycleEventId: finalMessage?.event_id ?? null,
          projectionPath: "provider_route_product_quality_gate.ok",
          lifecycleValue: false,
          projectionValue: writerKind,
          stage: "scientific_evidence",
        }),
      );
    }
  }

  if (
    candidateAuthorized &&
    writerKind === "typed_failure" &&
    !qualityGateRepairPending &&
    !evidenceBoundary &&
    !policyBoundary
  ) {
    mismatches.push(
      mismatch({
        code: "typed_failure_selected_after_authorized_provider_candidate",
        lifecycleEventId: finalMessage?.event_id ?? null,
        projectionPath:
          "terminal_authority_single_writer.selected_terminal_artifact_kind",
        lifecycleValue: candidateRef,
        projectionValue: writerKind,
        stage: "terminal_authority",
      }),
    );
  }

  if (recoverablePending && writerKind === "typed_failure" && !evidenceBoundary) {
    checks.push({
      stage: "followup_reasoning",
      check: "recoverable_rejection_reentered",
      status: "failed",
      disposition: "adapter_projection_contradiction",
      source_ref: readString(rejectionObservations.at(-1)?.observation_id),
      reason_codes: rejectionObservations
        .map((entry) => readString(entry.rejection_reason))
        .filter((entry): entry is string => Boolean(entry)),
    });
    mismatches.push(
      mismatch({
        code: "recoverable_rejection_terminalized_before_reentry",
        lifecycleEventId: finalMessage?.event_id ?? null,
        projectionPath: "agent_continuation_state.allowed_decisions",
        lifecycleValue: allowedDecisions.join(","),
        projectionValue: writerKind,
        stage: "followup_reasoning",
      }),
    );
  }

  return {
    schema: "helix.turn_lifecycle_projection_audit.v1",
    ok: mismatches.every(
      (entry) => entry.disposition !== "adapter_projection_contradiction",
    ),
    mismatches,
    first_divergence_stage: firstDivergence(mismatches),
    continuity_checks: checks,
    scientific_evidence_disposition: scientificEvidenceDisposition,
    assistant_answer: false,
    raw_content_included: false,
  };
};
