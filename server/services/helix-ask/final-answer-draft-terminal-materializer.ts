import type { HelixRouteProductContract } from "@shared/helix-route-product-contract";
import {
  HELIX_COMMITTED_ASK_ROUTE_SCHEMA,
  type HelixCommittedAskRoute,
} from "@shared/helix-committed-ask-route";
import { evaluateRepoAnswerTextQualityGate } from "./repo-answer-text-quality-gate";
import { committedRouteAllowsTerminalKind } from "./committed-ask-route";
import {
  collectFinalAnswerDraftSupportRefs,
  evaluateFinalAnswerDraftQualityGate,
  inferFinalAnswerDraftRouteFamily,
  type FinalAnswerDraftQualityGate,
} from "./final-answer-draft-quality-gate";
import {
  effectiveArtifactLedger,
  materializeDocEvidenceSynthesisAnswer,
} from "./doc-evidence-synthesis";
import { buildHelixCapabilityItineraryExecutionState } from "./capability-itinerary-execution";
import { resolveCompoundCapabilitySynthesisReadiness } from "./compound-capability-synthesis";
import { readCompoundTerminalPolicy } from "./compound-terminal-policy";

export type FinalAnswerDraftTerminalMaterializerResult = {
  schema: "helix.final_answer_draft_terminal_materializer_result.v1";
  turn_id: string;
  final_answer_draft_ref: string;
  ok: boolean;
  materialized_terminal_artifact_ref?: string;
  materialized_terminal_artifact_kind?:
    | "capability_help_summary"
    | "compound_evidence_synthesis_answer"
    | "model_synthesized_answer"
    | "repo_code_evidence_answer"
    | "compound_research_locator_answer"
    | "doc_evidence_synthesis_answer"
    | "scholarly_research_answer"
    | "internet_search_answer"
    | "theory_context_reflection_answer"
    | "situation_room_live_job_setup_answer"
    | "request_user_input"
    | "typed_failure";
  blocked_reason?:
    | "draft_empty"
    | "draft_refusal"
    | "draft_not_later_than_selected_direct_answer"
    | "route_contract_forbids_model_synthesized_answer"
    | "repo_evidence_required_but_missing"
    | "repo_support_refs_missing"
    | "repo_quality_gate_failed"
    | "doc_evidence_required_but_missing"
    | "doc_evidence_coverage_missing"
    | "doc_support_refs_missing"
    | "scholarly_evidence_required_but_missing"
    | "scholarly_support_refs_missing"
    | "internet_search_evidence_required_but_missing"
    | "internet_search_support_refs_missing"
    | "theory_context_evidence_required_but_missing"
    | "theory_context_support_refs_missing"
    | "source_support_refs_missing"
    | "draft_contradicts_observed_scholarly_full_text"
    | "live_job_contract_missing"
    | "deterministic_receipt_fallback_nonterminal"
    | "compound_subgoal_incomplete"
    | "unsupported_route_terminal_kind";
  route_allowed_terminal_artifact_kinds: string[];
  final_answer_draft_quality_gate: FinalAnswerDraftQualityGate;
  assistant_answer: false;
  raw_content_included: false;
};

type ArtifactLike = {
  artifact_id?: unknown;
  kind?: unknown;
  payload?: unknown;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const artifactPayload = (artifact: ArtifactLike): Record<string, unknown> | null =>
  readRecord(artifact.payload);

const artifactKind = (artifact: ArtifactLike): string =>
  readString(artifact.kind) ?? readString(artifactPayload(artifact)?.kind) ?? "";

const artifactSchema = (artifact: ArtifactLike): string =>
  readString(artifactPayload(artifact)?.schema) ?? "";

const artifactId = (artifact: ArtifactLike): string | null =>
  readString(artifact.artifact_id) ?? readString(artifactPayload(artifact)?.artifact_id);

const artifactPayloadByKind = (
  artifactLedger: ArtifactLike[],
  kind: string,
): Record<string, unknown> | null => {
  const artifact = artifactLedger.find((entry) => artifactKind(entry) === kind);
  return artifact ? artifactPayload(artifact) : null;
};

const payloadArtifactPayloadByKind = (
  payload: Record<string, unknown>,
  kind: string,
): Record<string, unknown> | null =>
  artifactPayloadByKind(
    readArray(payload.current_turn_artifact_ledger)
      .map(readRecord)
      .filter((entry): entry is ArtifactLike => Boolean(entry)),
    kind,
  );

const readCompoundItinerary = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): Record<string, unknown> | null =>
  readRecord(payload.capability_itinerary) ??
  artifactPayloadByKind(artifactLedger, "capability_itinerary") ??
  payloadArtifactPayloadByKind(payload, "capability_itinerary");

const readCompoundContract = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): Record<string, unknown> | null => {
  const itinerary = readCompoundItinerary(payload, artifactLedger);
  return (
    readRecord(payload.compound_capability_contract) ??
    readRecord(itinerary?.compound_capability_contract) ??
    artifactPayloadByKind(artifactLedger, "compound_capability_contract") ??
    payloadArtifactPayloadByKind(payload, "compound_capability_contract")
  );
};

const readCompoundExecutionState = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): Record<string, unknown> | null => {
  const itinerary = readCompoundItinerary(payload, artifactLedger);
  return (
    readRecord(payload.capability_itinerary_execution_state) ??
    readRecord(itinerary?.execution_state) ??
    artifactPayloadByKind(artifactLedger, "capability_itinerary_execution_state") ??
    payloadArtifactPayloadByKind(payload, "capability_itinerary_execution_state") ??
    (itinerary
      ? buildHelixCapabilityItineraryExecutionState({
          capabilityItinerary: itinerary,
          artifacts: artifactLedger,
        })
      : null)
  );
};

const artifactText = (artifact: ArtifactLike): string | null => {
  const payload = artifactPayload(artifact);
  return readString(payload?.answer_text) ?? readString(payload?.text) ?? readString(payload?.visible_text);
};

const artifactAuthority = (artifact: ArtifactLike): string | null =>
  readString(artifactPayload(artifact)?.authority);

const isDeterministicStagePlayReceiptText = (value: unknown): boolean =>
  /^Stage Play tool receipt:\s*live_env\.reflect_stage_play_context\b/i.test(readString(value) ?? "");

export const isFinalAnswerDraftArtifact = (artifact: ArtifactLike): boolean =>
  artifactKind(artifact) === "final_answer_draft" ||
  artifactSchema(artifact) === "helix.final_answer_draft.v1";

const isDirectAnswerArtifact = (artifact: ArtifactLike): boolean =>
  artifactKind(artifact) === "direct_answer_text" ||
  artifactSchema(artifact) === "helix.direct_answer_text.v1";

const isRepoEvidenceObservation = (artifact: ArtifactLike): boolean =>
  /repo_code_evidence_observation/i.test([artifactKind(artifact), artifactSchema(artifact)].join(" "));

const isScholarlyResearchObservation = (artifact: ArtifactLike): boolean =>
  /scholarly_research_observation|scholarly_full_text_observation/i.test([artifactKind(artifact), artifactSchema(artifact)].join(" "));

const isInternetSearchObservation = (artifact: ArtifactLike): boolean =>
  /internet_search_observation/i.test([artifactKind(artifact), artifactSchema(artifact)].join(" "));

const isTheoryLocatorObservation = (artifact: ArtifactLike): boolean =>
  /helix_theory_context_reflection_tool_receipt|theory_context_reflection|helix_theory_frontier_vector_field_tool_receipt|theory_frontier_vector_field/i.test(
    [artifactKind(artifact), artifactSchema(artifact), artifactId(artifact)].join(" "),
  );

const moralGraphObservationRefs = (artifacts: ArtifactLike[]): string[] =>
  unique(artifacts.flatMap((artifact) => {
    const payload = artifactPayload(artifact);
    const observation = readRecord(payload?.observation);
    const text = [
      artifactKind(artifact),
      artifactSchema(artifact),
      artifactId(artifact),
      readString(payload?.kind),
      readString(payload?.schema),
      readString(payload?.tool_name),
      readString(payload?.toolName),
      readString(observation?.kind),
      readString(observation?.schema),
    ].join(" ");
    if (!/moral_graph_reflection|moral-graph\.reflect_context|helix\.moral_graph_reflection_observation\.v1|ideology_context_reflection|procedural_moral_classification/i.test(text)) {
      return [];
    }
    return [
      artifactId(artifact),
      readString(payload?.artifact_id),
      readString(payload?.observation_ref),
      ...readArray(payload?.support_refs).map(readString),
      ...readArray(payload?.evidence_refs).map(readString),
      ...readArray(payload?.produced_artifact_refs).map(readString),
    ].filter((entry): entry is string => Boolean(entry));
  }));

const supportRefsIncludeMoralGraphObservation = (
  supportRefs: string[],
  artifacts: ArtifactLike[],
): boolean => {
  const moralRefs = moralGraphObservationRefs(artifacts);
  return moralRefs.some((moralRef) =>
    supportRefs.some((supportRef) =>
      supportRef === moralRef ||
      supportRef.endsWith(`#${moralRef}`) ||
      supportRef.endsWith(`/${moralRef}`),
    ),
  );
};

const explicitDraftSupportRefs = (draftPayload?: Record<string, unknown> | null): string[] =>
  unique([
    ...readArray(draftPayload?.support_refs).map(readString),
    ...readArray(draftPayload?.artifact_refs).map(readString),
    ...readArray(draftPayload?.evidence_refs).map(readString),
    ...readArray(draftPayload?.source_observation_refs).map(readString),
    ...readArray(draftPayload?.grounded_observation_refs).map(readString),
    ...readArray(draftPayload?.grounded_in_observation_refs).map(readString),
  ].filter((entry): entry is string => Boolean(entry)));

const isDocsEvidenceObservation = (artifact: ArtifactLike): boolean =>
  /\b(?:doc_summary|doc_location_result|doc_evidence_location|doc_location_matches|doc_equation_context|doc_equation_location|doc_calculator_evidence|agent_step_observation_packet)\b/i.test(
    [artifactKind(artifact), artifactSchema(artifact), artifactId(artifact)].join(" "),
  );

const isCompleteCompoundResearchLocatorItinerary = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): boolean => {
  const itinerary = readCompoundItinerary(payload, artifactLedger);
  const executionState = readCompoundExecutionState(payload, artifactLedger);
  if (executionState?.complete !== true) return false;
  const synthesisReadiness = readRecord(payload.compound_capability_synthesis_readiness);
  const terminalCriteria = readRecord(itinerary?.terminal_success_criteria);
  const routeProductContract = readRecord(payload.route_product_contract);
  const requestedTerminalKinds = [
    readString(synthesisReadiness?.required_terminal_kind),
    readString(synthesisReadiness?.synthesis_terminal_kind),
    readString(terminalCriteria?.required_terminal_kind),
    readString(terminalCriteria?.synthesis_terminal_kind),
    ...readArray(terminalCriteria?.allowed_terminal_artifact_kinds).map(readString),
    ...readArray(routeProductContract?.allowed_terminal_artifact_kinds).map(readString),
  ].filter((entry): entry is string => Boolean(entry));
  if (!requestedTerminalKinds.includes("compound_research_locator_answer")) return false;
  const families = new Set(readArray(executionState?.required_observation_families).map(readString).filter(Boolean));
  const ledgerFamilies = new Set(
    readArray(executionState?.compound_subgoal_ledger)
      .map(readRecord)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => capabilityFamilyFromCapability(
        readString(entry.requested_capability) ??
        readString(entry.executed_capability) ??
        readString(entry.selected_capability),
      ))
      .filter((entry): entry is string => Boolean(entry)),
  );
  for (const family of ledgerFamilies) families.add(family);
  if (families.has("calculator")) return false;
  return families.has("theory_locator") && (families.has("scholarly_research") || families.has("internet_search"));
};

const compoundLedgerEntryHasSatisfiedObservation = (entry: Record<string, unknown>): boolean => {
  const railStatus = readString(entry.rail_status);
  return (
    readString(entry.satisfaction) === "satisfied" &&
    Boolean(readString(entry.observation_ref)) &&
    (!railStatus || railStatus === "complete")
  );
};

const compoundSubgoalObservationRefs = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[],
): string[] => {
  const executionState = readCompoundExecutionState(payload, artifactLedger);
  return unique(
    readArray(executionState?.compound_subgoal_ledger)
      .map(readRecord)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter(compoundLedgerEntryHasSatisfiedObservation)
      .map((entry) => readString(entry.observation_ref))
      .filter((entry): entry is string => Boolean(entry)),
  );
};

const compoundSubgoalCount = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): number => {
  const contract = readCompoundContract(payload, artifactLedger);
  return readArray(contract?.subgoals).length;
};

const capabilityFamilyFromCapability = (capability: string | null): string | null => {
  if (!capability) return null;
  if (capability.startsWith("docs-viewer.")) return "docs_viewer";
  if (capability === "scientific-calculator.solve_expression") return "calculator";
  if (capability === "workspace_os.status") return "workspace_diagnostic";
  if (
    capability === "helix_ask.inspect_capability_catalog" ||
    capability === "helix_ask.reflect_workstation_tool_alignment"
  ) return "capability_catalog";
  if (capability === "repo-code.search_concept") return "repo_code";
  if (capability === "internet_search.web_research" || capability === "internet-search.search_web") return "internet_search";
  if (capability.startsWith("scholarly-research.") || capability.startsWith("scholarly_research.")) return "scholarly_research";
  if (capability === "helix_ask.reflect_theory_context" || capability.includes("theory_context")) return "theory_locator";
  if (
    capability === "moral-graph.reflect_context" ||
    capability === "helix_ask.reflect_ideology_context" ||
    capability === "helix_ask.bridge_theory_ideology_context"
  ) {
    return "moral_graph_reflection";
  }
  if (capability === "helix_ask.build_civilization_scenario_frame" || capability === "helix_ask.reflect_civilization_bounds") {
    return "civilization_bounds";
  }
  if (capability.startsWith("helix_ask.reflect_")) return "context_reflection";
  if (capability.startsWith("workspace-directory.")) return "workspace_directory";
  if (
    /^live_env\.(?:query_micro_reasoner_presets|draft_micro_reasoner_preset|route_micro_reasoner_prompt|check_live_source_mail|read_live_source_mail|read_processed_live_source_mail|process_live_source_mail|query_live_source_quality|summarize_live_source_current_state|reflect_live_source_mail_loop)$/i.test(capability)
  ) {
    return "live_source_mail";
  }
  if (capability === "live_env.record_live_source_mail_decision") return "live_source_decision";
  if (capability === "live_env.request_interim_voice_callout") return "voice_delivery";
  if (capability.startsWith("live_env.")) return "live_environment";
  if (capability === "image_lens.inspect" || capability === "situation-room.describe_visual_capture") return "visual_capture";
  return null;
};

const compoundSubgoalSourceFamilies = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): string[] => {
  const contract = readCompoundContract(payload, artifactLedger);
  const executionState = readCompoundExecutionState(payload, artifactLedger);
  const contractFamilies = readArray(contract?.subgoals)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) =>
      readString(entry.capability_family) ??
      readString(entry.plan_family) ??
      capabilityFamilyFromCapability(readString(entry.requested_capability) ?? readString(entry.runtime_capability))
    )
    .filter((entry): entry is string => Boolean(entry));
  const executionFamilies = readArray(executionState?.compound_subgoal_ledger)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) =>
      readString(entry.capability_family) ??
      readString(entry.plan_family) ??
      capabilityFamilyFromCapability(
        readString(entry.requested_capability) ??
        readString(entry.executed_capability) ??
        readString(entry.selected_capability),
      )
    )
    .filter((entry): entry is string => Boolean(entry));
  return unique(
    contractFamilies.length > 0
      ? [...contractFamilies, ...executionFamilies]
      : executionFamilies,
  );
};

const compoundTerminalSupportRefs = (input: {
  payload: Record<string, unknown>;
  artifactLedger: ArtifactLike[];
  draftPayload?: Record<string, unknown> | null;
}): { supportRefs: string[]; subgoalObservationRefs: string[]; sourceFamilies: string[] } => {
  const synthesisReadiness = readRecord(input.payload.compound_capability_synthesis_readiness);
  const readinessSupportRefs = readArray(synthesisReadiness?.support_refs)
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const supportRefs = collectFinalAnswerDraftSupportRefs({
    draftPayload: input.draftPayload,
    artifactLedger: input.artifactLedger,
  });
  const subgoalObservationRefs = compoundSubgoalObservationRefs(input.payload, input.artifactLedger);
  return {
    supportRefs: unique([...supportRefs, ...readinessSupportRefs, ...subgoalObservationRefs]),
    subgoalObservationRefs,
    sourceFamilies: compoundSubgoalSourceFamilies(input.payload, input.artifactLedger),
  };
};

const mirrorCompoundTerminalSupport = (input: {
  terminal: Record<string, unknown>;
  supportRefs: string[];
  subgoalObservationRefs: string[];
  sourceFamilies: string[];
}): void => {
  if (input.supportRefs.length > 0) {
    input.terminal.support_refs = input.supportRefs;
    input.terminal.support_refs_count = input.supportRefs.length;
  }
  if (input.subgoalObservationRefs.length > 0) {
    input.terminal.subgoal_observation_refs = input.subgoalObservationRefs;
    input.terminal.subgoal_observation_refs_count = input.subgoalObservationRefs.length;
  }
  if (input.sourceFamilies.length > 0) {
    input.terminal.source_families = input.sourceFamilies;
  }
};

export const findLatestFinalAnswerDraftCandidate = (
  artifacts: ArtifactLike[],
): { artifact: ArtifactLike; sequence: number; text: string; ref: string } | null => {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];
    if (!artifact || !isFinalAnswerDraftArtifact(artifact)) continue;
    const text = artifactText(artifact);
    const ref = artifactId(artifact);
    if (!text || !ref) continue;
    return { artifact, sequence: index, text, ref };
  }
  return null;
};

export const latestDirectAnswerSequence = (artifacts: ArtifactLike[]): number =>
  artifacts.reduce((latest, artifact, index) => isDirectAnswerArtifact(artifact) ? index : latest, -1);

const allowedKinds = (contract?: HelixRouteProductContract | Record<string, unknown> | null): string[] =>
  readArray(contract?.allowed_terminal_artifact_kinds)
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));

const compoundTerminalPolicyActive = (payload: Record<string, unknown>): boolean => {
  return readCompoundTerminalPolicy(payload).active;
};

const compoundAllowedTerminalKinds = (payload: Record<string, unknown>): string[] => {
  return readCompoundTerminalPolicy(payload).allowed_terminal_artifact_kinds;
};

const compoundForbiddenTerminalKinds = (payload: Record<string, unknown>): string[] => {
  return readCompoundTerminalPolicy(payload).forbidden_terminal_artifact_kinds;
};

const compoundTerminalReadinessBlockedReason = (
  payload: Record<string, unknown>,
  artifactLedger: ArtifactLike[] = [],
): "compound_subgoal_incomplete" | null => {
  if (!compoundTerminalPolicyActive(payload)) return null;
  const artifactQueryIndex = readRecord(payload.artifact_query_index);
  const existingItinerary = readCompoundItinerary(payload, artifactLedger);
  const explicitExecutionState =
    readRecord(payload.capability_itinerary_execution_state) ??
    readRecord(existingItinerary?.execution_state) ??
    artifactPayloadByKind(artifactLedger, "capability_itinerary_execution_state") ??
    payloadArtifactPayloadByKind(payload, "capability_itinerary_execution_state");
  const existingLedger = readArray(explicitExecutionState?.compound_subgoal_ledger)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const existingRailRows = [
    ...readArray(payload.compound_subgoal_rail_statuses),
    ...readArray(artifactQueryIndex?.compound_subgoal_rail_statuses),
  ]
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const explicitCompoundRows = [...existingLedger, ...existingRailRows];
  const existingLedgerHasIncompleteObservation =
    explicitCompoundRows.length > 1 &&
    explicitCompoundRows.some((entry) => !compoundLedgerEntryHasSatisfiedObservation(entry));
  const explicitContract = readCompoundContract(payload, artifactLedger);
  const explicitContractSubgoals = readArray(explicitContract?.subgoals)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const explicitRowSubgoalIds = new Set(
    explicitCompoundRows
      .map((entry) => readString(entry.subgoal_id))
      .filter((entry): entry is string => Boolean(entry)),
  );
  const explicitRowCapabilities = new Set(
    explicitCompoundRows.flatMap((entry) => [
      readString(entry.requested_capability),
      readString(entry.runtime_capability),
      readString(entry.selected_capability),
      readString(entry.executed_capability),
    ]).filter((entry): entry is string => Boolean(entry)),
  );
  const explicitRowsDropRequiredContractSubgoal =
    explicitCompoundRows.length > 0 &&
    explicitContractSubgoals.length > 1 &&
    explicitContract?.requires_all_subgoals !== false &&
    explicitContractSubgoals.some((subgoal) => {
      const subgoalId = readString(subgoal.subgoal_id);
      if (subgoalId) return !explicitRowSubgoalIds.has(subgoalId);
      const capability =
        readString(subgoal.requested_capability) ??
        readString(subgoal.runtime_capability) ??
        readString(subgoal.selected_capability);
      return Boolean(capability && !explicitRowCapabilities.has(capability));
    });
  const existingReadiness = readRecord(payload.compound_capability_synthesis_readiness);
  const existingReadinessComplete =
    existingReadiness?.applies === true &&
    existingReadiness.complete === true &&
    existingReadiness.has_failed_subgoal !== true;
  const existingReadinessHasSupportRefs =
    readArray(existingReadiness?.support_refs).map(readString).filter(Boolean).length > 0;
  const existingCompleteReadinessCanStandIn =
    existingReadinessComplete &&
    existingReadinessHasSupportRefs &&
    !existingLedgerHasIncompleteObservation &&
    !explicitRowsDropRequiredContractSubgoal;
  const synthesizedReadiness = resolveCompoundCapabilitySynthesisReadiness({
    payload,
    artifacts: artifactLedger,
  });
  if (synthesizedReadiness.applies === true) {
    if (
      (synthesizedReadiness.has_failed_subgoal === true && !existingCompleteReadinessCanStandIn) ||
      existingLedgerHasIncompleteObservation ||
      explicitRowsDropRequiredContractSubgoal
    ) {
      payload.compound_capability_synthesis_readiness = synthesizedReadiness;
      return "compound_subgoal_incomplete";
    }
    if (synthesizedReadiness.complete === true) {
      payload.compound_capability_synthesis_readiness = synthesizedReadiness;
      return null;
    }
    if (existingCompleteReadinessCanStandIn) {
      payload.compound_capability_synthesis_readiness = {
        ...synthesizedReadiness,
        ...existingReadiness,
        complete: true,
        has_failed_subgoal: false,
        support_refs: unique([
          ...readArray(synthesizedReadiness.support_refs).map(readString).filter((entry): entry is string => Boolean(entry)),
          ...readArray(existingReadiness?.support_refs).map(readString).filter((entry): entry is string => Boolean(entry)),
        ]),
        assistant_answer: false,
        raw_content_included: false,
      };
      return null;
    }
    payload.compound_capability_synthesis_readiness = synthesizedReadiness;
    return "compound_subgoal_incomplete";
  }
  if (existingReadinessComplete) return null;
  payload.compound_capability_synthesis_readiness = synthesizedReadiness;
  const contract = explicitContract;
  const executionState = readCompoundExecutionState(payload, artifactLedger);
  const readiness = readRecord(payload.compound_capability_synthesis_readiness);
  if (readiness?.has_failed_subgoal === true) return "compound_subgoal_incomplete";
  if (readiness?.applies === true && readiness.complete !== true) return "compound_subgoal_incomplete";
  if (executionState?.complete === false) return "compound_subgoal_incomplete";
  const ledger = readArray(executionState?.compound_subgoal_ledger)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const contractSubgoals = readArray(contract?.subgoals)
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  if (contractSubgoals.length > 1 && contract?.requires_all_subgoals !== false) {
    if (ledger.length < contractSubgoals.length) return "compound_subgoal_incomplete";
    const ledgerSubgoalIds = new Set(
      ledger
        .map((entry) => readString(entry.subgoal_id))
        .filter((entry): entry is string => Boolean(entry)),
    );
    const ledgerCapabilities = new Set(
      ledger.flatMap((entry) => [
        readString(entry.requested_capability),
        readString(entry.runtime_capability),
        readString(entry.selected_capability),
        readString(entry.executed_capability),
      ]).filter((entry): entry is string => Boolean(entry)),
    );
    for (const contractSubgoal of contractSubgoals) {
      const subgoalId = readString(contractSubgoal.subgoal_id);
      if (subgoalId) {
        if (!ledgerSubgoalIds.has(subgoalId)) return "compound_subgoal_incomplete";
        continue;
      }
      const capability =
        readString(contractSubgoal.requested_capability) ??
        readString(contractSubgoal.runtime_capability) ??
        readString(contractSubgoal.selected_capability);
      if (capability && !ledgerCapabilities.has(capability)) return "compound_subgoal_incomplete";
    }
  }
  if (
    ledger.length > 1 &&
    ledger.some((entry) => !compoundLedgerEntryHasSatisfiedObservation(entry))
  ) {
    return "compound_subgoal_incomplete";
  }
  return null;
};

const sourceBackedModelSynthesisRouteFamilies = new Set<string>([
  "capability_catalog",
  "context_reflection",
  "moral_graph_reflection",
  "civilization_bounds",
  "workspace_directory",
  "workspace_diagnostic",
  "visual_capture",
  "live_source_mail",
  "live_source_decision",
  "live_environment",
  "workstation_tool",
  "calculator_tool",
  "situation_room",
]);

const modelSynthesisRequiresSupportRefs = (routeFamily: string, payload: Record<string, unknown>): boolean =>
  compoundTerminalPolicyActive(payload) || sourceBackedModelSynthesisRouteFamilies.has(routeFamily);

const readCommittedRoute = (payload: Record<string, unknown>): HelixCommittedAskRoute | null => {
  const committedRoute = readRecord(payload.committed_ask_route);
  return committedRoute?.schema === HELIX_COMMITTED_ASK_ROUTE_SCHEMA
    ? (committedRoute as unknown as HelixCommittedAskRoute)
    : null;
};

const effectiveAllowedKinds = (
  payload: Record<string, unknown>,
  contract?: HelixRouteProductContract | Record<string, unknown> | null,
): string[] => {
  const committedRoute = readCommittedRoute(payload);
  const committedAllowed = committedRoute?.canonical_goal.allowed_terminal_artifact_kinds ?? [];
  const compoundForbidden = new Set(compoundForbiddenTerminalKinds(payload));
  const compoundAllowed = compoundAllowedTerminalKinds(payload);
  if (compoundAllowed.length > 0) {
    return compoundAllowed.filter((kind) => !compoundForbidden.has(kind));
  }
  return unique([
    ...(committedAllowed.length > 0 ? committedAllowed : allowedKinds(contract)),
  ]).filter((kind) => !compoundForbidden.has(kind));
};

const contractAllows = (
  payload: Record<string, unknown>,
  contract: HelixRouteProductContract | Record<string, unknown> | null | undefined,
  kind: string,
): boolean => {
  const compoundForbidden = new Set(compoundForbiddenTerminalKinds(payload));
  if (compoundForbidden.has(kind)) return false;
  const compoundAllowed = compoundAllowedTerminalKinds(payload);
  if (
    compoundAllowed.includes(kind) ||
    (kind === "doc_evidence_synthesis_answer" && compoundAllowed.includes("doc_evidence_synthesis"))
  ) {
    return true;
  }
  if (compoundTerminalPolicyActive(payload)) return false;
  const committedRoute = readCommittedRoute(payload);
  if (committedRoute) {
    return committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: kind,
      finalAnswerSource: kind === "model_synthesized_answer" ? "final_answer_draft" : null,
    });
  }
  const allowed = allowedKinds(contract);
  return allowed.length === 0 ||
    allowed.includes(kind) ||
    (kind === "doc_evidence_synthesis_answer" && allowed.includes("doc_evidence_synthesis"));
};

const resolveDocsSynthesisTerminalContract = (input: {
  turnId: string;
  payload: Record<string, unknown>;
  contract?: HelixRouteProductContract | Record<string, unknown> | null;
  draftPayload?: Record<string, unknown> | null;
}): {
  allowed: boolean;
  goalKind: string | null;
  goalKindSource: string | null;
  requiredTerminalKind: string | null;
  requiredTerminalKindSource: string | null;
  disallowReason: string | null;
  allowedTerminalArtifactKinds: string[];
} => {
  const committedRoute = readCommittedRoute(input.payload);
  const sameTurnCommittedRoute =
    committedRoute && committedRoute.turn_id === input.turnId ? committedRoute : null;
  const canonicalGoal = readRecord(input.payload.canonical_goal_frame);
  const allowedTerminalArtifactKinds = effectiveAllowedKinds(input.payload, input.contract);
  if (
    sameTurnCommittedRoute?.canonical_goal.forbidden_terminal_artifact_kinds.includes("doc_evidence_synthesis_answer")
  ) {
    return {
      allowed: false,
      goalKind: sameTurnCommittedRoute.canonical_goal.goal_kind,
      goalKindSource: "committed_ask_route.canonical_goal.goal_kind",
      requiredTerminalKind: sameTurnCommittedRoute.canonical_goal.required_terminal_kind,
      requiredTerminalKindSource: "committed_ask_route.canonical_goal.required_terminal_kind",
      disallowReason: "same_turn_committed_route_forbids_doc_evidence_synthesis_answer",
      allowedTerminalArtifactKinds,
    };
  }
  const candidates: Array<{
    goalKind: string | null;
    goalKindSource: string;
    requiredTerminalKind: string | null;
    requiredTerminalKindSource: string;
  }> = [
    ...(allowedTerminalArtifactKinds.includes("doc_evidence_synthesis_answer")
      ? [{
          goalKind: "doc_evidence_synthesis",
          goalKindSource: "route_product_contract.allowed_terminal_artifact_kinds",
          requiredTerminalKind: "doc_evidence_synthesis_answer",
          requiredTerminalKindSource: "route_product_contract.allowed_terminal_artifact_kinds",
        }]
      : []),
    {
      goalKind: readString(sameTurnCommittedRoute?.canonical_goal.goal_kind),
      goalKindSource: "committed_ask_route.canonical_goal.goal_kind",
      requiredTerminalKind: readString(sameTurnCommittedRoute?.canonical_goal.required_terminal_kind),
      requiredTerminalKindSource: "committed_ask_route.canonical_goal.required_terminal_kind",
    },
    {
      goalKind: readString(canonicalGoal?.goal_kind),
      goalKindSource: "canonical_goal_frame.goal_kind",
      requiredTerminalKind: readString(canonicalGoal?.required_terminal_kind),
      requiredTerminalKindSource: "canonical_goal_frame.required_terminal_kind",
    },
    {
      goalKind: readString(input.draftPayload?.goal_kind),
      goalKindSource: "final_answer_draft.goal_kind",
      requiredTerminalKind: readString(input.draftPayload?.required_terminal_kind),
      requiredTerminalKindSource: "final_answer_draft.required_terminal_kind",
    },
  ];
  const selected = candidates.find((candidate) =>
    candidate.goalKind === "doc_evidence_synthesis" &&
    candidate.requiredTerminalKind === "doc_evidence_synthesis_answer",
  );
  if (selected) {
    return {
      allowed: true,
      goalKind: selected.goalKind,
      goalKindSource: selected.goalKindSource,
      requiredTerminalKind: selected.requiredTerminalKind,
      requiredTerminalKindSource: selected.requiredTerminalKindSource,
      disallowReason: null,
      allowedTerminalArtifactKinds,
    };
  }
  const fallback = candidates.find((candidate) => candidate.goalKind || candidate.requiredTerminalKind);
  return {
    allowed: false,
    goalKind: fallback?.goalKind ?? null,
    goalKindSource: fallback?.goalKindSource ?? null,
    requiredTerminalKind: fallback?.requiredTerminalKind ?? null,
    requiredTerminalKindSource: fallback?.requiredTerminalKindSource ?? null,
    disallowReason: "docs_synthesis_terminal_contract_not_found",
    allowedTerminalArtifactKinds,
  };
};

const materializedRef = (turnId: string, kind: string): string =>
  `${turnId}:${kind}:from_final_answer_draft`;

const resolveDocsSynthesisPromptText = (input: {
  payload: Record<string, unknown>;
  draftPayload?: Record<string, unknown> | null;
}): { text: string; source: string } => {
  const plan = readRecord(input.payload.doc_evidence_synthesis_plan);
  const planQuestion = readArray(plan?.required_questions).map(readString).find(Boolean);
  const candidates: Array<[string, string | null]> = [
    ["payload.doc_evidence_synthesis_plan.required_questions", planQuestion ?? null],
    ["final_answer_draft.prompt", readString(input.draftPayload?.prompt)],
    ["final_answer_draft.user_request", readString(input.draftPayload?.user_request)],
    ["final_answer_draft.question", readString(input.draftPayload?.question)],
    ["payload.active_prompt", readString(input.payload.active_prompt)],
    ["payload.question", readString(input.payload.question)],
    ["payload.prompt", readString(input.payload.prompt)],
    ["canonical_goal_frame.user_goal_summary", readString(readRecord(input.payload.canonical_goal_frame)?.user_goal_summary)],
  ];
  const selected = candidates.find(([, value]) => Boolean(value));
  return { text: selected?.[1] ?? "", source: selected?.[0] ?? "empty" };
};

const updateDocsSynthesisMaterializerDebug = (
  payload: Record<string, unknown>,
  patch: Record<string, unknown>,
): void => {
  const existing = readRecord(payload.docs_synthesis_debug) ?? {};
  payload.docs_synthesis_debug = {
    ...existing,
    schema: "helix.docs_synthesis_debug.v1",
    materializer_called: true,
    ...patch,
    assistant_answer: false,
    raw_content_included: false,
  };
};

const persistDocEvidenceSynthesisAnswerArtifact = (input: {
  turnId: string;
  payload: Record<string, unknown>;
  artifactLedger: ArtifactLike[];
  answer: Record<string, unknown>;
}): void => {
  const artifactIdRef = readString(input.answer.artifact_id);
  if (!artifactIdRef) return;
  const alreadyPresent = input.artifactLedger.some((artifact) => artifactId(artifact) === artifactIdRef);
  if (alreadyPresent) return;
  const artifact: ArtifactLike & Record<string, unknown> = {
    artifact_id: artifactIdRef,
    turn_id: input.turnId,
    producer_item_id: "doc_evidence_synthesis_materializer",
    kind: "doc_evidence_synthesis_answer",
    created_at_ms: Date.now(),
    source_scope: "current_turn",
    payload: input.answer,
  };
  input.artifactLedger.push(artifact);
  input.payload.current_turn_artifact_ledger = input.artifactLedger;
};

const persistTheoryContextReflectionAnswerArtifact = (input: {
  turnId: string;
  payload: Record<string, unknown>;
  artifactLedger: ArtifactLike[];
  answer: Record<string, unknown>;
}): void => {
  const artifactIdRef = readString(input.answer.artifact_id);
  if (!artifactIdRef) return;
  const alreadyPresent = input.artifactLedger.some((artifact) => artifactId(artifact) === artifactIdRef);
  if (alreadyPresent) return;
  const artifact: ArtifactLike & Record<string, unknown> = {
    artifact_id: artifactIdRef,
    turn_id: input.turnId,
    producer_item_id: "theory_context_reflection_materializer",
    kind: "theory_context_reflection_answer",
    created_at_ms: Date.now(),
    source_scope: "current_turn",
    payload: input.answer,
  };
  input.artifactLedger.push(artifact);
  input.payload.current_turn_artifact_ledger = input.artifactLedger;
};

export function materializeFinalAnswerDraftTerminal(input: {
  turnId: string;
  payload: Record<string, unknown>;
  artifactLedger: ArtifactLike[];
  routeProductContract?: HelixRouteProductContract | Record<string, unknown> | null;
  finalAnswerDraftRef?: string | null;
}): FinalAnswerDraftTerminalMaterializerResult | null {
  const artifactLedger = effectiveArtifactLedger({
    payload: input.payload,
    artifactLedger: input.artifactLedger,
  });
  let draft = input.finalAnswerDraftRef
    ? findLatestFinalAnswerDraftCandidate(
        artifactLedger.filter((artifact) => artifactId(artifact) === input.finalAnswerDraftRef),
      )
    : findLatestFinalAnswerDraftCandidate(artifactLedger);
  if (!draft) return null;
  if (input.finalAnswerDraftRef && input.finalAnswerDraftRef !== draft.ref) return null;

  const contract = input.routeProductContract ?? readRecord(input.payload.route_product_contract);
  const routeAllowed = effectiveAllowedKinds(input.payload, contract);
  let draftPayload = artifactPayload(draft.artifact);
  let docsPrompt = resolveDocsSynthesisPromptText({ payload: input.payload, draftPayload });
  let qualityGate = evaluateFinalAnswerDraftQualityGate({
    turnId: input.turnId,
    finalAnswerDraftRef: draft.ref,
    draftText: draft.text,
    draftPayload,
    promptText: docsPrompt.text || readString(input.payload.active_prompt),
    routeProductContract: contract,
    payload: input.payload,
    artifactLedger,
  });
  if (!input.finalAnswerDraftRef && compoundTerminalPolicyActive(input.payload) && !qualityGate.ok) {
    for (let index = draft.sequence - 1; index >= 0; index -= 1) {
      const candidateArtifact = artifactLedger[index];
      if (!candidateArtifact || !isFinalAnswerDraftArtifact(candidateArtifact)) continue;
      const candidateText = artifactText(candidateArtifact);
      const candidateRef = artifactId(candidateArtifact);
      if (!candidateText || !candidateRef) continue;
      const candidatePayload = artifactPayload(candidateArtifact);
      const candidateDocsPrompt = resolveDocsSynthesisPromptText({
        payload: input.payload,
        draftPayload: candidatePayload,
      });
      const candidateQualityGate = evaluateFinalAnswerDraftQualityGate({
        turnId: input.turnId,
        finalAnswerDraftRef: candidateRef,
        draftText: candidateText,
        draftPayload: candidatePayload,
        promptText: candidateDocsPrompt.text || readString(input.payload.active_prompt),
        routeProductContract: contract,
        payload: input.payload,
        artifactLedger,
      });
      if (!candidateQualityGate.ok) continue;
      draft = {
        artifact: candidateArtifact,
        sequence: index,
        text: candidateText,
        ref: candidateRef,
      };
      draftPayload = candidatePayload;
      docsPrompt = candidateDocsPrompt;
      qualityGate = candidateQualityGate;
      break;
    }
  }
  input.payload.final_answer_draft_quality_gate = qualityGate;
  const draftAuthority =
    artifactAuthority(draft.artifact) ??
    readString(readRecord(input.payload.final_answer_draft)?.authority);
  if (draftAuthority === "deterministic_receipt_fallback" || isDeterministicStagePlayReceiptText(draft.text)) {
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: "deterministic_receipt_fallback_nonterminal",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  const directSequence = latestDirectAnswerSequence(artifactLedger);
  const routeFamily = inferFinalAnswerDraftRouteFamily({
    routeProductContract: contract,
    payload: input.payload,
    artifactLedger,
  });
  if (!qualityGate.ok) {
    const blocked = qualityGate.violations.includes("empty_draft")
      ? "draft_empty"
      : qualityGate.violations.includes("contradicts_observed_scholarly_full_text")
        ? "draft_contradicts_observed_scholarly_full_text"
      : qualityGate.violations.includes("refusal_without_error")
        ? "draft_refusal"
      : qualityGate.violations.includes("missing_support_refs_for_repo_route")
        ? "repo_support_refs_missing"
        : qualityGate.violations.includes("missing_support_refs_for_scholarly_route")
          ? "scholarly_support_refs_missing"
        : qualityGate.violations.includes("missing_visible_citation_for_scholarly_analysis")
          ? "scholarly_visible_citation_missing"
        : qualityGate.violations.includes("missing_support_refs_for_internet_search_route")
          ? "internet_search_support_refs_missing"
        : qualityGate.violations.includes("missing_support_refs_for_source_route")
          ? "source_support_refs_missing"
        : qualityGate.violations.includes("generic_answer_for_compound_prompt") ||
            qualityGate.violations.includes("missing_required_prompt_parts")
          ? "draft_missing_required_prompt_parts"
          : "unsupported_route_terminal_kind";
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: blocked,
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  const compoundReadinessBlockedReason = compoundTerminalReadinessBlockedReason(input.payload, artifactLedger);
  if (compoundReadinessBlockedReason) {
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: compoundReadinessBlockedReason,
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (routeFamily === "capability_catalog") {
    const targetKind = "capability_help_summary";
    if (!contractAllows(input.payload, contract, targetKind)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "route_contract_forbids_model_synthesized_answer",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const capabilityRegistryRefs = artifactLedger
      .filter((artifact) => artifactKind(artifact) === "capability_registry")
      .map(artifactId)
      .filter((ref): ref is string => Boolean(ref));
    if (capabilityRegistryRefs.length === 0) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "source_support_refs_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const ref = materializedRef(input.turnId, targetKind);
    const supportRefs = unique([
      ...capabilityRegistryRefs,
      ...collectFinalAnswerDraftSupportRefs({ draftPayload, artifactLedger }),
    ]);
    const terminalPayload = {
      schema: "helix.capability_help_summary.v1",
      artifact_id: ref,
      turn_id: input.turnId,
      kind: targetKind,
      text: draft.text,
      answer_text: draft.text,
      terminal_artifact_kind: targetKind,
      capability_catalog_ref: capabilityRegistryRefs[0],
      support_refs: supportRefs,
      support_refs_count: supportRefs.length,
      subgoal_observation_refs: capabilityRegistryRefs,
      subgoal_observation_refs_count: capabilityRegistryRefs.length,
      source_families: ["capability_catalog"],
      model_authored: true,
      model_step_capability: "model.synthesize_from_capability_catalog",
      final_answer_draft_ref: draft.ref,
      terminal_eligible: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    input.payload.capability_help_summary = terminalPayload;
    const terminalArtifact = {
      artifact_id: ref,
      kind: targetKind,
      payload: terminalPayload,
    };
    if (!artifactLedger.some((artifact) => artifactId(artifact) === ref)) {
      artifactLedger.push(terminalArtifact);
    }
    if (!input.artifactLedger.some((artifact) => artifactId(artifact) === ref)) {
      input.artifactLedger.push(terminalArtifact);
    }
    input.payload.current_turn_artifact_ledger = artifactLedger;
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: true,
      materialized_terminal_artifact_ref: ref,
      materialized_terminal_artifact_kind: targetKind,
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (routeFamily === "repo_evidence") {
    if (!artifactLedger.some(isRepoEvidenceObservation)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "repo_evidence_required_but_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const supportRefs = collectFinalAnswerDraftSupportRefs({
      draftPayload,
      artifactLedger,
    });
    if (supportRefs.length === 0) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "repo_support_refs_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const repoAnswerRef = materializedRef(input.turnId, "repo_code_evidence_answer");
    input.payload.repo_code_evidence_answer = {
      schema: "helix.repo_code_evidence_answer.v1",
      artifact_id: repoAnswerRef,
      turn_id: input.turnId,
      text: draft.text,
      answer_text: draft.text,
      support_refs: supportRefs,
      model_authored: draftAuthority !== "deterministic_repo_evidence_synthesis",
      synthesis_mode: draftAuthority ?? "unknown",
      synthesis_attempt_ref:
        readString(artifactLedger.find((artifact) =>
          artifactKind(artifact) === "repo_evidence_synthesis_attempt" ||
          artifactSchema(artifact) === "helix.repo_evidence_synthesis_attempt.v1",
        )?.artifact_id) ?? `${input.turnId}:repo_evidence_synthesis_attempt:from_final_answer_draft`,
      model_step_capability:
        readString(draftPayload?.model_step_capability) ??
        "model.synthesize_from_repo_evidence",
      final_answer_draft_ref: draft.ref,
      final_answer_draft_authority: draftAuthority,
      assistant_answer: false,
      raw_content_included: false,
    };
    const repoGate = evaluateRepoAnswerTextQualityGate({
      turnId: input.turnId,
      answerRef: repoAnswerRef,
      answerText: draft.text,
      payload: input.payload,
    });
    input.payload.repo_answer_text_quality_gate = repoGate;
    if (!repoGate.ok) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "repo_quality_gate_failed",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: true,
      materialized_terminal_artifact_ref: repoAnswerRef,
      materialized_terminal_artifact_kind: "repo_code_evidence_answer",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (routeFamily === "scholarly_research") {
    if (!artifactLedger.some(isScholarlyResearchObservation)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "scholarly_evidence_required_but_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const supportRefs = collectFinalAnswerDraftSupportRefs({
      draftPayload,
      artifactLedger,
    });
    if (supportRefs.length === 0) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        evidence_state: "answer_blocked",
        blocked_reason: "scholarly_support_refs_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const compoundResearchLocator = isCompleteCompoundResearchLocatorItinerary(input.payload, artifactLedger);
    const targetKind = compoundResearchLocator
      ? "compound_research_locator_answer"
      : "scholarly_research_answer";
    if (!contractAllows(input.payload, contract, targetKind)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        evidence_state: "answer_blocked",
        blocked_reason: "route_contract_forbids_model_synthesized_answer",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const scholarlyAnswerRef = materializedRef(input.turnId, targetKind);
    const compoundTerminalSupport = compoundTerminalSupportRefs({
      payload: input.payload,
      artifactLedger,
      draftPayload,
    });
    const supportRefsForTerminal = compoundTerminalSupport.supportRefs.length > 0
      ? compoundTerminalSupport.supportRefs
      : supportRefs;
    const answerPayload = {
      schema: compoundResearchLocator
        ? "helix.compound_research_locator_answer.v1"
        : "helix.scholarly_research_answer.v1",
      artifact_id: scholarlyAnswerRef,
      turn_id: input.turnId,
      text: draft.text,
      answer_text: draft.text,
      evidence_state: "answer_ready",
      support_refs: supportRefsForTerminal,
      support_refs_count: supportRefsForTerminal.length,
      subgoal_observation_refs: compoundTerminalSupport.subgoalObservationRefs,
      subgoal_observation_refs_count: compoundTerminalSupport.subgoalObservationRefs.length,
      model_authored: true,
      model_step_capability: compoundResearchLocator
        ? "model.synthesize_from_compound_research_locator"
        : "model.synthesize_from_scholarly_research",
      final_answer_draft_ref: draft.ref,
      source_families: compoundTerminalSupport.sourceFamilies.length > 0
        ? compoundTerminalSupport.sourceFamilies
        : compoundResearchLocator
          ? ["scholarly_research", "theory_locator"]
          : ["scholarly_research"],
      assistant_answer: false,
      raw_content_included: false,
    };
    if (compoundResearchLocator) {
      input.payload.compound_research_locator_answer = answerPayload;
    } else {
      input.payload.scholarly_research_answer = answerPayload;
    }
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: true,
      materialized_terminal_artifact_ref: scholarlyAnswerRef,
      materialized_terminal_artifact_kind: targetKind,
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (routeFamily === "internet_search") {
    if (!artifactLedger.some(isInternetSearchObservation)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "internet_search_evidence_required_but_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const supportRefs = collectFinalAnswerDraftSupportRefs({
      draftPayload,
      artifactLedger,
    });
    if (supportRefs.length === 0) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "internet_search_support_refs_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const compoundResearchLocator = isCompleteCompoundResearchLocatorItinerary(input.payload, artifactLedger);
    const targetKind = compoundResearchLocator
      ? "compound_research_locator_answer"
      : "internet_search_answer";
    if (!contractAllows(input.payload, contract, targetKind)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "route_contract_forbids_model_synthesized_answer",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const internetAnswerRef = materializedRef(input.turnId, targetKind);
    const compoundTerminalSupport = compoundTerminalSupportRefs({
      payload: input.payload,
      artifactLedger,
      draftPayload,
    });
    const supportRefsForTerminal = compoundTerminalSupport.supportRefs.length > 0
      ? compoundTerminalSupport.supportRefs
      : supportRefs;
    const answerPayload = {
      schema: compoundResearchLocator
        ? "helix.compound_research_locator_answer.v1"
        : "helix.internet_search_answer.v1",
      artifact_id: internetAnswerRef,
      turn_id: input.turnId,
      text: draft.text,
      answer_text: draft.text,
      support_refs: supportRefsForTerminal,
      support_refs_count: supportRefsForTerminal.length,
      subgoal_observation_refs: compoundTerminalSupport.subgoalObservationRefs,
      subgoal_observation_refs_count: compoundTerminalSupport.subgoalObservationRefs.length,
      model_authored: true,
      model_step_capability: compoundResearchLocator
        ? "model.synthesize_from_compound_research_locator"
        : "model.synthesize_from_internet_search",
      final_answer_draft_ref: draft.ref,
      source_families: compoundTerminalSupport.sourceFamilies.length > 0
        ? compoundTerminalSupport.sourceFamilies
        : compoundResearchLocator
          ? ["internet_search", "theory_locator"]
          : ["internet_search"],
      assistant_answer: false,
      raw_content_included: false,
    };
    if (compoundResearchLocator) {
      input.payload.compound_research_locator_answer = answerPayload;
    } else {
      input.payload.internet_search_answer = answerPayload;
    }
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: true,
      materialized_terminal_artifact_ref: internetAnswerRef,
      materialized_terminal_artifact_kind: targetKind,
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (routeFamily === "theory_locator") {
    if (!artifactLedger.some(isTheoryLocatorObservation)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "theory_context_evidence_required_but_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const supportRefs = collectFinalAnswerDraftSupportRefs({
      draftPayload,
      artifactLedger,
    });
    if (supportRefs.length === 0) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "theory_context_support_refs_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const targetKind = "theory_context_reflection_answer";
    if (!contractAllows(input.payload, contract, targetKind)) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "route_contract_forbids_model_synthesized_answer",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const theoryAnswerRef = materializedRef(input.turnId, targetKind);
    const compoundTerminalSupport = compoundTerminalSupportRefs({
      payload: input.payload,
      artifactLedger,
      draftPayload,
    });
    const supportRefsForTerminal = compoundTerminalSupport.supportRefs.length > 0
      ? compoundTerminalSupport.supportRefs
      : supportRefs;
    const theoryContextReflectionAnswer = {
      schema: "helix.theory_context_reflection_answer.v1",
      artifact_id: theoryAnswerRef,
      turn_id: input.turnId,
      text: draft.text,
      answer_text: draft.text,
      support_refs: supportRefsForTerminal,
      support_refs_count: supportRefsForTerminal.length,
      subgoal_observation_refs: compoundTerminalSupport.subgoalObservationRefs,
      subgoal_observation_refs_count: compoundTerminalSupport.subgoalObservationRefs.length,
      model_authored: true,
      model_step_capability: "model.synthesize_from_theory_context_reflection",
      final_answer_draft_ref: draft.ref,
      source_families: compoundTerminalSupport.sourceFamilies.length > 0
        ? compoundTerminalSupport.sourceFamilies
        : ["theory_locator"],
      assistant_answer: false,
      raw_content_included: false,
    };
    input.payload.theory_context_reflection_answer = theoryContextReflectionAnswer;
    persistTheoryContextReflectionAnswerArtifact({
      turnId: input.turnId,
      payload: input.payload,
      artifactLedger,
      answer: theoryContextReflectionAnswer,
    });
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: true,
      materialized_terminal_artifact_ref: theoryAnswerRef,
      materialized_terminal_artifact_kind: targetKind,
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (routeFamily === "docs_source") {
    const docsTerminalContract = resolveDocsSynthesisTerminalContract({
      turnId: input.turnId,
      payload: input.payload,
      contract,
      draftPayload,
    });
    if (!docsTerminalContract.allowed) {
      updateDocsSynthesisMaterializerDebug(input.payload, {
        materializer_prompt_source: docsPrompt.source,
        materializer_final_answer_draft_ref: draft.ref,
        materializer_support_refs_count: 0,
        materialization_ok: false,
        materialization_blocked_reason: "route_contract_disallowed",
        blocked_reason: "route_contract_disallowed",
        materializer_goal_kind: docsTerminalContract.goalKind,
        materializer_goal_kind_source: docsTerminalContract.goalKindSource,
        materializer_required_terminal_kind: docsTerminalContract.requiredTerminalKind,
        materializer_required_terminal_kind_source: docsTerminalContract.requiredTerminalKindSource,
        materializer_contract_allowed: false,
        materializer_contract_disallow_reason: docsTerminalContract.disallowReason,
        materializer_route_allowed_terminal_artifact_kinds: docsTerminalContract.allowedTerminalArtifactKinds,
      });
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "route_contract_forbids_model_synthesized_answer",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    if (!artifactLedger.some(isDocsEvidenceObservation)) {
      updateDocsSynthesisMaterializerDebug(input.payload, {
        materializer_prompt_source: docsPrompt.source,
        materializer_final_answer_draft_ref: draft.ref,
        materializer_support_refs_count: 0,
        materialization_ok: false,
        materialization_blocked_reason: "doc_evidence_required_but_missing",
        blocked_reason: "doc_evidence_required_but_missing",
      });
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "doc_evidence_required_but_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const supportRefs = collectFinalAnswerDraftSupportRefs({
      draftPayload,
      artifactLedger,
    });
    if (supportRefs.length === 0) {
      updateDocsSynthesisMaterializerDebug(input.payload, {
        materializer_prompt_source: docsPrompt.source,
        materializer_final_answer_draft_ref: draft.ref,
        final_answer_draft_ref: draft.ref,
        final_answer_draft_support_refs: [],
        materializer_support_refs_count: 0,
        support_refs_count: 0,
        materialization_ok: false,
        materialization_blocked_reason: "doc_support_refs_missing",
        blocked_reason: "doc_support_refs_missing",
      });
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: "doc_support_refs_missing",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const hadPreservedPlan = Boolean(readRecord(input.payload.doc_evidence_synthesis_plan));
    const materialized = materializeDocEvidenceSynthesisAnswer({
      turnId: input.turnId,
      promptText: docsPrompt.text,
      payload: input.payload,
      artifactLedger,
      answerText: draft.text,
      finalAnswerDraftRef: draft.ref,
    });
    const materializedPlan = readRecord(input.payload.doc_evidence_synthesis_plan);
    const coverage = readRecord(input.payload.doc_evidence_synthesis_coverage);
    const coverageSupportCount =
      typeof coverage?.support_refs_count === "number" ? coverage.support_refs_count : supportRefs.length;
    updateDocsSynthesisMaterializerDebug(input.payload, {
      materializer_prompt_source: docsPrompt.source,
      materializer_plan_source: hadPreservedPlan ? "payload.doc_evidence_synthesis_plan" : "rebuilt_from_prompt",
      materializer_plan_synthesis_kind: readString(materializedPlan?.synthesis_kind),
      materializer_plan_required_doc_paths: readArray(materializedPlan?.required_doc_paths).map(readString).filter(Boolean),
      materializer_final_answer_draft_ref: draft.ref,
      final_answer_draft_ref: draft.ref,
      final_answer_draft_support_refs: supportRefs,
      materializer_support_refs_count: supportRefs.length,
      support_refs_count: coverageSupportCount,
      coverage_support_refs_count: coverageSupportCount,
      materialization_ok: materialized.ok,
      materialized_terminal_artifact_kind: materialized.answer?.terminal_artifact_kind ?? null,
      materialized_terminal_artifact_ref: materialized.answer?.artifact_id ?? null,
      materialization_blocked_reason: materialized.blocked_reason ?? null,
      blocked_reason: materialized.blocked_reason ?? null,
      materializer_goal_kind: docsTerminalContract.goalKind,
      materializer_goal_kind_source: docsTerminalContract.goalKindSource,
      materializer_required_terminal_kind: docsTerminalContract.requiredTerminalKind,
      materializer_required_terminal_kind_source: docsTerminalContract.requiredTerminalKindSource,
      materializer_contract_allowed: docsTerminalContract.allowed,
      materializer_contract_disallow_reason: docsTerminalContract.disallowReason,
      materializer_route_allowed_terminal_artifact_kinds: docsTerminalContract.allowedTerminalArtifactKinds,
    });
    if (!materialized.ok || !materialized.answer) {
      return {
        schema: "helix.final_answer_draft_terminal_materializer_result.v1",
        turn_id: input.turnId,
        final_answer_draft_ref: draft.ref,
        ok: false,
        blocked_reason: materialized.blocked_reason === "doc_evidence_coverage_missing"
          ? "doc_evidence_coverage_missing"
          : "unsupported_route_terminal_kind",
        route_allowed_terminal_artifact_kinds: routeAllowed,
        final_answer_draft_quality_gate: qualityGate,
        assistant_answer: false,
        raw_content_included: false,
      };
    }
    const compoundTerminalSupport = compoundTerminalSupportRefs({
      payload: input.payload,
      artifactLedger,
      draftPayload,
    });
    mirrorCompoundTerminalSupport({
      terminal: materialized.answer as unknown as Record<string, unknown>,
      supportRefs: unique([
        ...readArray((materialized.answer as unknown as Record<string, unknown>).support_refs)
          .map(readString)
          .filter((entry): entry is string => Boolean(entry)),
        ...supportRefs,
        ...compoundTerminalSupport.supportRefs,
      ]),
      subgoalObservationRefs: compoundTerminalSupport.subgoalObservationRefs,
      sourceFamilies: compoundTerminalSupport.sourceFamilies,
    });
    persistDocEvidenceSynthesisAnswerArtifact({
      turnId: input.turnId,
      payload: input.payload,
      artifactLedger,
      answer: materialized.answer as unknown as Record<string, unknown>,
    });
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: true,
      materialized_terminal_artifact_ref: materialized.answer.artifact_id,
      materialized_terminal_artifact_kind: "doc_evidence_synthesis_answer",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  if (directSequence >= draft.sequence) {
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: "draft_not_later_than_selected_direct_answer",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  const compoundPolicy = readCompoundTerminalPolicy(input.payload);
  const genericCompoundTargetKind =
    compoundPolicy.active
      ? "compound_evidence_synthesis_answer"
      : "model_synthesized_answer";
  if (!contractAllows(input.payload, contract, genericCompoundTargetKind)) {
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: "route_contract_forbids_model_synthesized_answer",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }

  const ref = materializedRef(input.turnId, genericCompoundTargetKind);
  const supportRefs = collectFinalAnswerDraftSupportRefs({
    draftPayload,
    artifactLedger,
  });
  const compoundTerminalSupport = compoundTerminalSupportRefs({
    payload: input.payload,
    artifactLedger,
    draftPayload,
  });
  const terminalSupportRefs = compoundTerminalPolicyActive(input.payload) && compoundTerminalSupport.supportRefs.length > 0
    ? compoundTerminalSupport.supportRefs
    : supportRefs;
  if (modelSynthesisRequiresSupportRefs(routeFamily, input.payload) && terminalSupportRefs.length === 0) {
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: "source_support_refs_missing",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  if (
    routeFamily === "moral_graph_reflection" &&
    !supportRefsIncludeMoralGraphObservation(explicitDraftSupportRefs(draftPayload), artifactLedger)
  ) {
    return {
      schema: "helix.final_answer_draft_terminal_materializer_result.v1",
      turn_id: input.turnId,
      final_answer_draft_ref: draft.ref,
      ok: false,
      blocked_reason: "source_support_refs_missing",
      route_allowed_terminal_artifact_kinds: routeAllowed,
      final_answer_draft_quality_gate: qualityGate,
      assistant_answer: false,
      raw_content_included: false,
    };
  }
  const subgoalObservationRefs = compoundTerminalSupport.subgoalObservationRefs;
  const effectiveSubgoalObservationRefs =
    subgoalObservationRefs.length > 0
      ? subgoalObservationRefs
      : compoundSubgoalCount(input.payload, artifactLedger) > 1
        ? terminalSupportRefs
        : [];
  const terminalPayload = {
    schema: genericCompoundTargetKind === "compound_evidence_synthesis_answer"
      ? "helix.compound_evidence_synthesis_answer.v1"
      : "helix.model_synthesized_answer.v1",
    artifact_id: ref,
    turn_id: input.turnId,
    text: draft.text,
    answer_text: draft.text,
    terminal_artifact_kind: genericCompoundTargetKind,
    support_refs: terminalSupportRefs,
    support_refs_count: terminalSupportRefs.length,
    subgoal_observation_refs: effectiveSubgoalObservationRefs,
    subgoal_observation_refs_count: effectiveSubgoalObservationRefs.length,
    source_families: routeFamily === "moral_graph_reflection" && compoundTerminalSupport.sourceFamilies.length === 0
      ? ["moral_graph_reflection"]
      : compoundTerminalSupport.sourceFamilies,
    model_step_capability: genericCompoundTargetKind === "compound_evidence_synthesis_answer"
      ? "model.synthesize_from_compound_subgoal_observations"
      : effectiveSubgoalObservationRefs.length > 1
      ? "model.synthesize_from_compound_subgoal_observations"
      : "model.synthesize_from_current_observations",
    final_answer_draft_ref: draft.ref,
    assistant_answer: false,
    raw_content_included: false,
  };
  if (genericCompoundTargetKind === "compound_evidence_synthesis_answer") {
    input.payload.compound_evidence_synthesis_answer = terminalPayload;
  } else {
    input.payload.model_synthesized_answer = terminalPayload;
  }
  return {
    schema: "helix.final_answer_draft_terminal_materializer_result.v1",
    turn_id: input.turnId,
    final_answer_draft_ref: draft.ref,
    ok: true,
    materialized_terminal_artifact_ref: ref,
    materialized_terminal_artifact_kind: genericCompoundTargetKind,
    route_allowed_terminal_artifact_kinds: routeAllowed,
    final_answer_draft_quality_gate: qualityGate,
    assistant_answer: false,
    raw_content_included: false,
  };
}
