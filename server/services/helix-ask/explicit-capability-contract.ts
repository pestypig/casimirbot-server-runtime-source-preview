import type { HelixCapabilityFamily } from "@shared/helix-capability-plan";
import { HELIX_INTERNET_SEARCH_CAPABILITY } from "@shared/helix-internet-search-observation";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import type { HelixToolCallAdmissionFamily } from "@shared/helix-tool-call-admission";
import { HELIX_RESEARCH_LIBRARY_READ_CAPABILITY } from "@shared/helix-research-library";
import { HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY } from "@shared/helix-paper-evidence-enrichment";
import {
  HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
  HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
  HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
  HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
  HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
  HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
  HELIX_MINECRAFT_MECHANICS_FACT_CAPABILITY_IDS,
  HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
  HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
  HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
  HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
  HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS,
  HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
} from "@shared/helix-environment-connector";
import {
  HELIX_ENVIRONMENT_COMMAND_CATALOG_OBSERVATION_SCHEMA,
  HELIX_ENVIRONMENT_COMMAND_OBSERVATION_SCHEMA,
  HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
  HELIX_MINECRAFT_COMMAND_CAPABILITY,
} from "@shared/helix-environment-command";
import { HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA } from "@shared/helix-environment-action";
import {
  HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
} from "@shared/helix-environment-durable-goal";
import {
  HELIX_ENVIRONMENT_REASONING_ROLE_ARBITRATE_CAPABILITY,
  HELIX_ENVIRONMENT_REASONING_ROLE_DISPOSITION_CAPABILITY,
  HELIX_ENVIRONMENT_REASONING_ROLE_INSPECT_CAPABILITY,
  HELIX_ENVIRONMENT_REASONING_ROLE_RECORD_CAPABILITY,
} from "@shared/helix-environment-reasoning-role";
import {
  HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS,
  HELIX_MINECRAFT_PLAYER_ARM_VIABILITY_GUARDIAN_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_DISARM_VIABILITY_GUARDIAN_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_CAMERA_TRACK_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_CANCEL_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_EMERGENCY_STOP_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_RESUME_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_STATUS_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
} from "@shared/helix-minecraft-player-capabilities";
import {
  askCapabilityCatalogPromptMatchIndex,
  isAskCapabilityCatalogPrompt,
} from "./capability-catalog-intent";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "./contextual-tool-admission";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "./workstation-context-feed-query-tool-contracts";
import {
  HELIX_DOCS_OPEN_DOC_CAPABILITY,
  HELIX_DOCS_SEARCH_CAPABILITY,
} from "./docs-capability-contract";
import {
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
  theoryExperimentProcedurePromptMatch,
} from "./theory-experiment-procedure-intent";
import {
  THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY as NATURAL_THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
  theoryFormalArtifactInspectionPromptMatch,
} from "./theory-formal-artifact-intent";
import { isAffirmativeReadAloudPrompt } from "./referent-resolution";
import {
  isAffirmativeEnvironmentReasoningRoleInspectPrompt,
  isAffirmativeImmediateMinecraftSituationPrompt,
  isAffirmativeMinecraftDurableGoalAppendPrompt,
  isAffirmativeMinecraftDurableGoalCreatePrompt,
  isAffirmativeMinecraftDurableGoalInspectPrompt,
  isMinecraftSituationSessionSetupPrompt,
} from "./minecraft-situation-intent";
import { minecraftMechanicsDocsPromptMatch } from "./minecraft-mechanics-docs-intent";
import {
  isAffirmativeMinecraftPlayerEmbodimentActionPrompt,
  resolveMinecraftExecutionPlaneConstraint,
} from "./minecraft-execution-plane-intent";

const THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY =
  "theory-experiment-procedure.evaluate_closure" as const;
const THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY =
  "theory-experiment-procedure.readmit" as const;
const SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY =
  "scientific-evidence-closure.inspect_enrollment" as const;
const SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY =
  "scientific-evidence-closure.prepare" as const;
const SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY =
  "scientific-evidence-closure.evaluate" as const;
const THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY =
  "theory-semantic-admitter.normalize" as const;
const THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY =
  "theory-artifact-producer.prepare_lanyon_request" as const;
const THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY =
  "theory-artifact-producer.admit_lanyon_snapshot" as const;
const THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY =
  NATURAL_THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY;
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

const MINECRAFT_PLAYER_ACTION_CONTRACT_ARGS = new Map<
  string,
  { required: string[]; optional: string[] }
>([
  [
    "com.casimirbot.minecraft.player.navigate",
    {
      required: [
        "destination",
        "arrival_radius",
        "allow_sprint",
        "allow_dig",
        "allow_place",
        "engine_preference",
      ],
      optional: ["environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.look",
    {
      required: ["target_kind", "max_turn_degrees_per_tick"],
      optional: [
        "position",
        "yaw_delta_degrees",
        "pitch_delta_degrees",
        "environment_label",
      ],
    },
  ],
  [
    HELIX_MINECRAFT_PLAYER_CAMERA_TRACK_CAPABILITY,
    {
      required: [
        "target_kind",
        "aim_point",
        "max_acquisition_distance",
        "max_duration_ms",
        "max_turn_degrees_per_tick",
        "max_angular_acceleration_degrees_per_tick_squared",
        "prediction_ticks",
        "deadband_degrees",
        "reacquire_ticks",
        "require_line_of_sight",
        "stop_below_health",
      ],
      optional: [
        "entity_type_id",
        "particle_type_id",
        "continuity",
        "handoff_radius",
        "max_handoffs",
        "environment_label",
      ],
    },
  ],
  [
    HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
    {
      required: ["direction", "duration_ms", "sprint"],
      optional: ["environment_label"],
    },
  ],
  [
    HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
    { required: ["count"], optional: ["environment_label"] },
  ],
  [
    "com.casimirbot.minecraft.player.interact",
    {
      required: ["target", "hand", "interaction"],
      optional: ["environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.hotbar.select",
    { required: ["slot"], optional: ["environment_label"] },
  ],
  [
    "com.casimirbot.minecraft.player.equipment.equip",
    {
      required: ["item_id", "destination"],
      optional: ["environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.follow",
    {
      required: [
        "subject_ref",
        "distance",
        "max_duration_ms",
        "stop_below_health",
      ],
      optional: ["environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.collect",
    {
      required: ["item_or_block_id", "count", "search_radius"],
      optional: ["environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.mine",
    {
      required: ["block_id", "count", "search_radius"],
      optional: ["target_position", "environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.place",
    {
      required: ["block_id", "positions"],
      optional: ["environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.craft",
    {
      required: ["output_item_id", "count"],
      optional: ["recipe_id", "environment_label"],
    },
  ],
  [
    "com.casimirbot.minecraft.player.inventory.transfer",
    {
      required: ["direction", "item_id", "count", "container_target"],
      optional: ["environment_label"],
    },
  ],
  [
    HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
    {
      required: [
        "sequence_schema",
        "sequence_id",
        "ruleset",
        "execution_plane",
        "scheduler_engine",
        "optimization",
        "start_node_id",
        "max_total_ticks",
        "required_checkpoint_ids",
        "mutation_scope",
        "nodes",
      ],
      optional: ["environment_label"],
    },
  ],
  [
    HELIX_MINECRAFT_PLAYER_ARM_VIABILITY_GUARDIAN_CAPABILITY,
    {
      required: [
        "action_kind",
        "profile_id",
        "duration_ticks",
        "minimum_air",
        "dangerous_vertical_velocity",
        "maximum_swim_ticks",
        "maximum_observation_age_ticks",
        "response_repertoire",
      ],
      optional: ["environment_label"],
    },
  ],
  [
    HELIX_MINECRAFT_PLAYER_DISARM_VIABILITY_GUARDIAN_CAPABILITY,
    {
      required: ["action_kind", "profile_id"],
      optional: ["environment_label"],
    },
  ],
  ...[
    HELIX_MINECRAFT_PLAYER_STATUS_CAPABILITY,
    HELIX_MINECRAFT_PLAYER_RESUME_CAPABILITY,
    HELIX_MINECRAFT_PLAYER_CANCEL_CAPABILITY,
    HELIX_MINECRAFT_PLAYER_EMERGENCY_STOP_CAPABILITY,
  ].map(
    (capability) =>
      [
        capability,
        { required: ["workflow_ref"], optional: ["reason"] },
      ] as const,
  ),
]);
const MINECRAFT_PLAYER_EXPLICIT_CAPABILITY_IDS = [
  ...HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS,
  HELIX_MINECRAFT_PLAYER_STATUS_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_RESUME_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_CANCEL_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_EMERGENCY_STOP_CAPABILITY,
] as const;
export type ExplicitCapabilityContract = {
  schema: "helix.explicit_capability_contract.v1";
  capability: string;
  runtime_capability?: string;
  aliases?: string[];
  capability_family: string;
  plan_family: HelixCapabilityFamily;
  source_target: string;
  admission_families: HelixToolCallAdmissionFamily[];
  required_observation_kinds: string[];
  required_terminal_kind: string;
  allowed_substitutions: string[];
  forbidden_nearby_capabilities: string[];
  required_args: string[];
  optional_args: string[];
};

type ExplicitCapabilityContractDefinition = Omit<
  ExplicitCapabilityContract,
  "required_args" | "optional_args"
> &
  Partial<Pick<ExplicitCapabilityContract, "required_args" | "optional_args">>;

export type ExtractedExplicitCapabilityContract = {
  contract: ExplicitCapabilityContract;
  capability: string;
  matched_name: string;
  match_index: number;
  match_end_index: number;
  source:
    | "command_mention"
    | "compound_command_chain"
    | "capability_catalog_prompt"
    | "natural_capability_intent";
};

const liveEnvironmentControlContract = (input: {
  capability: string;
  aliases?: string[];
  requiredObservationKind?: string;
  requiredTerminalKind?: string;
  forbiddenNearbyCapabilities?: string[];
}): ExplicitCapabilityContractDefinition => ({
  schema: "helix.explicit_capability_contract.v1",
  capability: input.capability,
  ...(input.aliases ? { aliases: input.aliases } : {}),
  capability_family: "live_environment",
  plan_family: "live_environment",
  source_target: "live_environment",
  admission_families: ["live_environment", "workstation_action"],
  required_observation_kinds: [
    "live_environment_tool_observation",
    input.requiredObservationKind ?? "stage_play_workstation_control_receipt",
    "helix.workstation_goal_context_update.v1",
  ],
  required_terminal_kind:
    input.requiredTerminalKind ?? "workstation_tool_evaluation",
  allowed_substitutions: [],
  forbidden_nearby_capabilities: input.forbiddenNearbyCapabilities ?? [
    "live_env.read_processed_live_source_mail",
    "live_env.read_live_source_mail",
    "model.direct_answer",
  ],
});

const liveEnvironmentQueryContract = (input: {
  capability: string;
  aliases?: string[];
  requiredObservationKind?: string;
  requiredObservationKinds?: string[];
}): ExplicitCapabilityContractDefinition => ({
  schema: "helix.explicit_capability_contract.v1",
  capability: input.capability,
  ...(input.aliases ? { aliases: input.aliases } : {}),
  capability_family: "live_environment",
  plan_family: "live_environment",
  source_target: "live_environment",
  admission_families: ["live_environment"],
  required_observation_kinds: [
    "live_environment_tool_observation",
    ...(input.requiredObservationKinds ??
      (input.requiredObservationKind ? [input.requiredObservationKind] : [])),
    "helix.workstation_goal_context_update.v1",
  ],
  required_terminal_kind: "model_synthesized_answer",
  allowed_substitutions: [],
  forbidden_nearby_capabilities: [
    "live_env.read_processed_live_source_mail",
    "live_env.read_live_source_mail",
    "live_env.process_live_source_mail",
    "model.direct_answer",
  ],
});

const liveEnvironmentEvidenceContract = (input: {
  capability: string;
  aliases?: string[];
  requiredObservationKinds?: string[];
  requiredTerminalKind?: string;
  requiredArgs?: string[];
  optionalArgs?: string[];
}): ExplicitCapabilityContractDefinition => ({
  schema: "helix.explicit_capability_contract.v1",
  capability: input.capability,
  ...(input.aliases ? { aliases: input.aliases } : {}),
  capability_family: "live_environment",
  plan_family: "live_environment",
  source_target: "live_environment",
  admission_families: ["live_environment"],
  required_observation_kinds: [
    "live_environment_tool_observation",
    ...(input.requiredObservationKinds ?? []),
  ],
  required_terminal_kind:
    input.requiredTerminalKind ?? "model_synthesized_answer",
  ...(input.requiredArgs ? { required_args: input.requiredArgs } : {}),
  ...(input.optionalArgs ? { optional_args: input.optionalArgs } : {}),
  allowed_substitutions: [],
  forbidden_nearby_capabilities: [
    "live_env.read_processed_live_source_mail",
    "live_env.read_live_source_mail",
    "live_env.process_live_source_mail",
    "model.direct_answer",
  ],
});

const liveSourceMailEvidenceContract = (input: {
  capability: string;
  aliases?: string[];
  requiredObservationKinds: string[];
}): ExplicitCapabilityContractDefinition => ({
  schema: "helix.explicit_capability_contract.v1",
  capability: input.capability,
  ...(input.aliases ? { aliases: input.aliases } : {}),
  capability_family: "live_source_mail",
  plan_family: "live_environment",
  source_target: "live_source_mailbox",
  admission_families: ["live_environment"],
  required_observation_kinds: input.requiredObservationKinds,
  required_terminal_kind: "model_synthesized_answer",
  allowed_substitutions: [],
  forbidden_nearby_capabilities: [
    "internet_search.web_research",
    "model.direct_answer",
  ],
});

const contextReflectionEvidenceContract = (input: {
  capability: string;
  aliases?: string[];
  requiredObservationKinds: string[];
}): ExplicitCapabilityContractDefinition => ({
  schema: "helix.explicit_capability_contract.v1",
  capability: input.capability,
  ...(input.aliases ? { aliases: input.aliases } : {}),
  capability_family: "context_reflection",
  plan_family: "context_reflection",
  source_target: "context_reflection",
  admission_families: ["context_reflection"],
  required_observation_kinds: input.requiredObservationKinds,
  required_terminal_kind: "model_synthesized_answer",
  allowed_substitutions: [],
  forbidden_nearby_capabilities: ["model.direct_answer"],
});

const theoryExecutionEvidenceContract = (input: {
  capability: string;
  aliases?: string[];
  requiredObservationKinds: string[];
}): ExplicitCapabilityContractDefinition => ({
  schema: "helix.explicit_capability_contract.v1",
  capability: input.capability,
  ...(input.aliases ? { aliases: input.aliases } : {}),
  capability_family: "theory_locator",
  plan_family: "theory_locator",
  source_target: "theory_locator",
  admission_families: ["theory_locator"],
  required_observation_kinds: input.requiredObservationKinds,
  required_terminal_kind: "model_synthesized_answer",
  allowed_substitutions: [],
  forbidden_nearby_capabilities: ["model.direct_answer"],
});

const requiredArgsForCapability = (capability: string): string[] => {
  switch (capability) {
    case "scientific-calculator.solve_expression":
    case "scientific-calculator.solve_with_steps":
    case "scientific-calculator.solve":
      return ["latex"];
    case "docs-viewer.locate_in_doc":
      return ["query"];
    case "docs-viewer.doc_equation_context":
      return ["query"];
    case "docs-viewer.search_docs":
      return ["query"];
    case "docs-viewer.open_doc_by_path":
      return ["path"];
    case "repo-code.search_concept":
      return ["query"];
    case "workspace-directory.resolve":
      return ["query"];
    case "internet_search.web_research":
      return ["query"];
    case HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY:
      return ["query"];
    case HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY:
      return ["paper_result_or_source"];
    case HELIX_SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY:
      return ["text_evidence"];
    case HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY:
      return ["document_id", "proposal"];
    case "live_env.draft_micro_reasoner_preset":
      return ["scenario_text"];
    case "live_env.route_micro_reasoner_prompt":
      return ["source_summary"];
    case "helix_ask.reflect_theory_context":
    case "theory-badge-graph.propose_frontier_conjectures":
    case "moral-graph.reflect_context":
    case "moral-graph.reflect_living_substrate_context":
      return ["prompt"];
    case THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY:
      return ["prompt", "operation", "target", "selected_badge_ids"];
    case SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY:
      return ["manifest_id"];
    case SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY:
      return [
        "manifest_id",
        "closure_input_artifact_ref",
        "execution_plan_artifact_ref",
        "plan_id",
      ];
    case THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY:
      return ["procedure_artifact_ref", "procedure_id", "procedure_sha256"];
    case THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY:
      return ["prompt", "procedure_id", "procedure_sha256"];
    case THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY:
      return [
        "source_evidence_ref",
        "source_packet",
        "source_path",
        "receipt_id",
      ];
    case THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY:
      return [
        "procedure_artifact_ref",
        "procedure_id",
        "procedure_sha256",
        "semantic_admission_artifact_ref",
        "case_id",
      ];
    case THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY:
      return ["request_artifact_ref", "case_id"];
    case THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY:
      return [];
    case THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY:
      return ["procedure_artifact_ref", "procedure_id", "procedure_sha256"];
    case THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY:
      return ["prepared_request_id"];
    case THEORY_FORMAL_VERIFIER_START_CAPABILITY:
      return ["prepared_request_id", "plan_id"];
    case THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY:
      return ["job_id"];
    case THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY:
      return ["catalog_entry_id", "procedure_id", "procedure_sha256"];
    case THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY:
      return ["prepared_request_id"];
    case THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY:
      return ["plan_id"];
    case THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY:
      return ["job_id"];
    case "helix.theory.frontierVectorFieldTrace":
      return ["query"];
    case "helix_ask.reflect_live_synthetic_data":
      return ["prompt"];
    case "helix_ask.reflect_context_attachments":
      return ["prompt"];
    case "helix_ask.reflect_ideology_context":
      return ["text"];
    case "helix_ask.bridge_theory_ideology_context":
      return ["prompt"];
    case "helix_ask.build_civilization_scenario_frame":
      return ["prompt"];
    case "helix_ask.reflect_civilization_bounds":
      return ["prompt"];
    case "workstation-notes.create":
    case "workstation-notes.create_note":
      return ["title"];
    case "workstation-notes.append":
    case "workstation-notes.append_to_note":
      return ["text"];
    default:
      return [];
  }
};

const optionalArgsForCapability = (capability: string): string[] => {
  switch (capability) {
    case "scientific-calculator.solve_expression":
    case "scientific-calculator.solve_with_steps":
    case "scientific-calculator.solve":
      return ["expression", "equation"];
    case "scientific-calculator.start_equation_live_source":
      return ["latex", "expression", "equation"];
    case "docs-viewer.open":
      return ["path", "anchor", "selected_text"];
    case "docs-viewer.identify_current_doc":
      return ["path", "anchor", "selected_text"];
    case "docs-viewer.locate_in_doc":
      return ["path", "anchor", "term", "text"];
    case "docs-viewer.search_docs":
      return ["limit", "topic", "title"];
    case "docs-viewer.validate_doc_candidates":
      return ["query", "selected_path", "path"];
    case "docs-viewer.open_doc_by_path":
      return ["anchor", "selected_text"];
    case "docs-viewer.summarize_doc":
      return ["path", "anchor", "selected_text"];
    case "docs-viewer.doc_equation_context":
      return ["path", "anchor", "query", "selected_text"];
    case "repo-code.search_concept":
      return ["concept", "limit"];
    case "workspace-directory.resolve":
      return ["uri", "path", "target", "target_kinds", "limit"];
    case "internet_search.web_research":
      return ["question", "prompt", "topic", "search_query"];
    case HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY:
      return [
        "doi",
        "arxiv_id",
        "arxivId",
        "title",
        "journal",
        "reference",
        "citation",
        "limit",
      ];
    case HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY:
      return [
        "paper_result_id",
        "paper_id",
        "result_id",
        "doi",
        "arxiv_id",
        "arxivId",
        "source_url",
        "pdf_url",
        "full_text_url",
        "url",
      ];
    case HELIX_SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY:
      return [
        "source_ref",
        "full_text_observation",
        "requested_variables",
        "variables",
      ];
    case HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY:
      return ["source_target_intent"];
    case "live_env.query_micro_reasoner_presets":
      return [
        "query",
        "include_presets",
        "limit",
        "source_id",
        "source_ids",
        "preset_id",
      ];
    case "live_env.draft_micro_reasoner_preset":
      return [
        "base_preset_id",
        "candidate_prompts",
        "confidence_threshold",
        "escalation_mode",
        "allow_none",
        "wake_prompt_contract",
        "wake_contract_prompt",
        "wake_contract_title",
      ];
    case "live_env.route_micro_reasoner_prompt":
      return [
        "candidate_prompts",
        "confidence_threshold",
        "escalation_mode",
        "allow_none",
        "wake_prompt_contract",
        "wake_contract_prompt",
        "wake_contract_title",
      ];
    case "live_env.query_micro_reasoner_prompts":
    case "live_env.apply_micro_reasoner_preset":
    case "live_env.create_micro_reasoner_preset":
    case "live_env.update_micro_reasoner_prompt":
    case "live_env.test_micro_reasoner_prompt":
      return [
        "query",
        "source_id",
        "source_ids",
        "preset_id",
        "role",
        "candidate_prompts",
        "base_preset_id",
        "scenario_text",
        "include_presets",
        "limit",
      ];
    case "live_env.read_card":
    case "live_env.query_event_log":
    case "live_env.query_world_events":
    case "live_env.query_navigation_state":
    case "live_env.query_constructs":
    case "live_env.query_job_evidence":
    case "live_env.request_probe":
    case "live_env.record_commentary":
      return [
        "environment_id",
        "room_id",
        "world_id",
        "line_keys",
        "event_types",
        "title",
        "summary",
        "reason",
        "evidence_refs",
        "limit",
      ];
    case "live_env.plan_stage_play_job":
    case "live_env.request_stage_play_checkpoint":
      return [
        "objective",
        "objective_text",
        "room_id",
        "environment_id",
        "source_id",
        "job_id",
        "reason",
        "evidence_refs",
      ];
    case "live_env.configure_visual_observer_profile":
    case "live_env.apply_visual_observer_profile":
    case "live_env.query_visual_observer_profiles":
    case "live_env.test_visual_observer_profile":
    case "live_env.compare_visual_observer_profiles":
    case "live_env.request_visual_action_replay":
      return [
        "profile_id",
        "profile_ids",
        "source_id",
        "source_ids",
        "title",
        "domain",
        "prompt",
        "summary",
        "include_presets",
        "limit",
      ];
    case "live_env.configure_interpreter_profile":
    case "live_env.compare_mail_to_interpreter_profile":
    case "live_env.predict_live_source_immediate":
    case "live_env.compare_live_source_prediction":
    case "live_env.project_live_source_narrative":
      return [
        "profile_id",
        "mail_ids",
        "narrative_state_id",
        "policy_id",
        "job_id",
        "source_id",
        "room_id",
        "environment_id",
        "objective",
        "objective_text",
        "evidence_refs",
        "limit",
      ];
    case "live_env.query_live_source_quality":
      return [
        "source_ref",
        "source_refs",
        "source_id",
        "source_ids",
        "expected_cadence_ms",
        "mailbox_thread_id",
      ];
    case "live_env.summarize_live_source_current_state":
      return [
        "source_ref",
        "source_refs",
        "source_id",
        "source_ids",
        "goal_id",
        "mail_limit",
        "limit",
        "query",
      ];
    case "live_env.record_live_source_mail_decision":
      return [
        "evidence_refs",
        "mail_ids",
        "processed_packet_ids",
        "wake_request_id",
        "mailbox_thread_id",
        "route_metadata",
      ];
    case "live_env.request_interim_voice_callout":
      return [
        "text",
        "message",
        "callout_text",
        "evidence_refs",
        "wake_request_id",
        "mailbox_thread_id",
        "route_metadata",
        "kind",
        "max_chars",
      ];
    case "helix_ask.reflect_theory_context":
      return ["source_ref", "source_refs", "refs", "question", "topic"];
    case THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY:
      return [
        "comparison_badge_ids",
        "target_observable",
        "scale_min_log10_m",
        "scale_max_log10_m",
        "coordinate_frame",
        "initial_boundary_conditions",
        "formal_system",
        "requested_precision",
        "evidence_maturity_ceiling",
        "evidence_artifacts",
        "lanyon_requested",
        "lanyon_case_id",
        "procedure_id",
        "source_target_intent",
      ];
    case THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY:
      return ["source_target_intent"];
    case THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY:
      return ["procedure_artifact_ref", "source_target_intent"];
    case SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY:
      return ["source_target_intent"];
    case SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY:
      return ["source_target_intent"];
    case THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY:
      return ["source_target_intent"];
    case THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY:
      return ["claim_id", "source_target_intent"];
    case THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY:
      return ["source_target_intent"];
    case THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY:
      return ["formal_artifact_id", "theorem_name", "source_target_intent"];
    case THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY:
      return [
        "semantic_admission_artifact_ref",
        "artifact_generation_artifact_ref",
        "formal_source_admission_artifact_ref",
        "claim_id",
        "formal_artifact_id",
        "theorem_name",
        "theorem_type_sha256",
        "semantic_to_lean_binding_id",
        "semantic_to_lean_binding_sha256",
        "environment_policy_id",
        "source_target_intent",
      ];
    case THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY:
    case THEORY_FORMAL_VERIFIER_START_CAPABILITY:
    case THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY:
    case THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY:
    case THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY:
      return ["source_target_intent"];
    case THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY:
    case THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY:
      return ["poll_attempt", "source_target_intent"];
    case "theory-badge-graph.propose_frontier_conjectures":
      return [
        "source_ref",
        "source_refs",
        "refs",
        "question",
        "query",
        "text",
        "topic",
        "conversation_context",
        "mentioned_equations",
        "mentioned_symbols",
        "mentioned_domains",
        "frontier_search_seed",
        "limit",
      ];
    case "moral-graph.reflect_living_substrate_context":
      return [
        "source_ref",
        "source_refs",
        "refs",
        "question",
        "query",
        "text",
        "topic",
        "conversation_context",
        "include_theory_bridge",
        "include_recommended_actions",
      ];
    case "helix.theory.frontierVectorFieldTrace":
      return ["question", "prompt", "topic"];
    case "helix_ask.reflect_live_synthetic_data":
    case "helix_ask.reflect_context_attachments":
      return ["source_ref", "source_refs", "refs", "question", "topic"];
    case "helix_ask.reflect_ideology_context":
      return [
        "inputKind",
        "refs",
        "options",
        "prompt",
        "source_ref",
        "source_refs",
      ];
    case "helix_ask.bridge_theory_ideology_context":
      return [
        "source_refs",
        "refs",
        "theory_reflection_ref",
        "ideology_reflection_ref",
      ];
    case "helix_ask.build_civilization_scenario_frame":
      return [
        "refs",
        "options",
        "scenario",
        "scenario_text",
        "source_ref",
        "source_refs",
      ];
    case "helix_ask.reflect_civilization_bounds":
      return [
        "scenarioFrameRef",
        "source_ref",
        "source_refs",
        "refs",
        "options",
      ];
    case "visual_analysis.inspect_image_region":
      return ["source_id", "bbox_px"];
    case "image_lens.inspect":
      return ["view_state", "source_id", "regions"];
    case "workstation-notes.create":
    case "workstation-notes.create_note":
      return ["text", "body", "content"];
    case "workstation-notes.append":
    case "workstation-notes.append_to_note":
      return ["body", "content", "note_id", "title"];
    default:
      return [];
  }
};

const normalizeExplicitCapabilityContract = (
  contract: ExplicitCapabilityContractDefinition,
): ExplicitCapabilityContract => ({
  ...contract,
  required_args:
    contract.required_args ?? requiredArgsForCapability(contract.capability),
  optional_args:
    contract.optional_args ?? optionalArgsForCapability(contract.capability),
});

const explicitCapabilityContractDefinitions: ExplicitCapabilityContractDefinition[] =
  [
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.inspect_capability_catalog",
      aliases: [
        "helix.ask.inspect_capability_catalog",
        "inspect_capability_catalog",
        "capability_catalog",
        "capability catalog",
        "runtime_capability_catalog",
        "runtime capability catalog",
        "tool_catalog",
        "tool catalog",
      ],
      capability_family: "capability_catalog",
      plan_family: "capability_catalog",
      source_target: "capability_catalog",
      admission_families: ["capability_catalog", "runtime_evidence"],
      required_observation_kinds: ["capability_registry"],
      required_terminal_kind: "capability_help_summary",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.reflect_workstation_tool_alignment",
      aliases: [
        "workstation_tool_alignment",
        "workstation_tools_matrix",
        "toolchain_matrix",
        "tool_regression_matrix",
        "release_checklist_tools",
      ],
      capability_family: "capability_catalog",
      plan_family: "capability_catalog",
      source_target: "runtime_evidence",
      admission_families: ["capability_catalog", "runtime_evidence"],
      required_observation_kinds: ["capability_registry"],
      required_terminal_kind: "capability_help_summary",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "runtime_evidence",
      aliases: ["runtime-evidence", "runtime evidence"],
      capability_family: "capability_catalog",
      plan_family: "capability_catalog",
      source_target: "runtime_evidence",
      admission_families: ["capability_catalog", "runtime_evidence"],
      required_observation_kinds: ["capability_registry"],
      required_terminal_kind: "capability_help_summary",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "debug.inspect_current_turn",
      aliases: [
        "debug.inspect-current-turn",
        "debug_current_turn",
        "diagnose_debug_or_runtime_evidence",
      ],
      capability_family: "capability_catalog",
      plan_family: "capability_catalog",
      source_target: "runtime_evidence",
      admission_families: ["runtime_evidence"],
      required_observation_kinds: [
        "agent_runtime_loop",
        "debug_evidence_diagnosis",
      ],
      required_terminal_kind: "capability_help_summary",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_pipeline",
      aliases: ["live-pipeline", "live_pipeline_control"],
      capability_family: "live_environment",
      plan_family: "live_environment",
      source_target: "live_pipeline",
      admission_families: ["live_pipeline"],
      required_observation_kinds: [
        "live_pipeline_receipt",
        "visual_producer_cadence_receipt",
        "tool_observation",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "situation-room.live-source.set_rate",
      aliases: ["live-source.set_rate"],
      capability_family: "live_pipeline",
      plan_family: "live_pipeline",
      source_target: "live_pipeline",
      admission_families: ["live_pipeline"],
      required_observation_kinds: [
        "live_pipeline_receipt",
        "visual_producer_cadence_receipt",
        "tool_observation",
      ],
      required_terminal_kind: "live_pipeline_receipt",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "scientific-calculator.solve_expression",
      aliases: [
        "calculator",
        "calculator.solve_expression",
        "calculator solve expression",
        "calculator_stream",
        "calculator stream",
        "scientific-calculator",
        "scientific calculator",
        "solve expression",
      ],
      capability_family: "calculator",
      plan_family: "workstation_action",
      source_target: "calculator_stream",
      admission_families: ["calculator", "workstation_action"],
      required_observation_kinds: [
        "calculator_receipt",
        "workstation_tool_evaluation",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "scientific-calculator.solve_with_steps",
      aliases: [
        "calculator.solve_with_steps",
        "scientific calculator solve with steps",
        "solve with calculator steps",
      ],
      capability_family: "calculator",
      plan_family: "workstation_action",
      source_target: "calculator_stream",
      admission_families: ["calculator", "workstation_action"],
      required_observation_kinds: [
        "calculator_receipt",
        "calculator_subgoal_receipt",
        "workstation_tool_evaluation",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "scientific-calculator.solve",
      aliases: ["calculator.solve", "scientific calculator solve"],
      capability_family: "calculator",
      plan_family: "workstation_action",
      source_target: "calculator_stream",
      admission_families: ["calculator", "workstation_action"],
      required_observation_kinds: [
        "calculator_receipt",
        "calculator_subgoal_receipt",
        "workstation_tool_evaluation",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "scientific-calculator.open",
      aliases: [
        "calculator.open",
        "open scientific calculator",
        "open calculator",
      ],
      capability_family: "calculator",
      plan_family: "workstation_action",
      source_target: "calculator_stream",
      admission_families: ["calculator", "workstation_action"],
      required_observation_kinds: ["workspace_action_receipt"],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "scientific-calculator.start_equation_live_source",
      aliases: [
        "calculator.start_equation_live_source",
        "calculator live source",
        "start equation live source",
      ],
      capability_family: "calculator",
      plan_family: "workstation_action",
      source_target: "calculator_stream",
      admission_families: ["calculator", "workstation_action"],
      required_observation_kinds: [
        "workspace_action_receipt",
        "calculator_live_source_status",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "workspace_os.status",
      aliases: [
        "workspace_status",
        "workspace status",
        "workspace_diagnostic",
        "workspace diagnostic",
        "workspace_os status",
        "workspace_os_status",
        "workspace os status",
        "workstation status",
        "workstation diagnostic",
      ],
      capability_family: "workspace_diagnostic",
      plan_family: "workspace_diagnostic",
      source_target: "workspace_diagnostic",
      admission_families: ["workspace_diagnostic"],
      required_observation_kinds: ["workspace_os_status_observation"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "debug.inspect_current_turn",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.open",
      aliases: [
        "docs_viewer.open",
        "docs_viewer open",
        "docs_viewer to open",
        "docs viewer open",
        "docs viewer to open",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: ["doc_open_receipt", "docs_viewer_receipt"],
      required_terminal_kind: "doc_open_receipt",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.identify_current_doc",
      aliases: [
        "docs_viewer.identify_current_doc",
        "docs viewer identify current doc",
        "identify current doc",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: [
        "active_doc_identity",
        "doc_open_receipt",
        "docs_viewer_receipt",
      ],
      required_terminal_kind: "doc_open_receipt",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.search_docs",
      runtime_capability: HELIX_DOCS_SEARCH_CAPABILITY,
      aliases: [
        "docs_viewer.search_docs",
        "docs viewer search docs",
        "search docs",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: ["doc_search_results", "retrieval_context"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "docs-viewer.summarize_doc",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.validate_doc_candidates",
      aliases: [
        "docs_viewer.validate_doc_candidates",
        "docs viewer validate candidates",
        "validate doc candidates",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: ["doc_candidate_validation"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "docs-viewer.summarize_doc",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.open_doc_by_path",
      runtime_capability: HELIX_DOCS_OPEN_DOC_CAPABILITY,
      aliases: [
        "docs_viewer.open_doc_by_path",
        "docs viewer open doc by path",
        "open doc by path",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: ["doc_open_receipt"],
      required_terminal_kind: "doc_open_receipt",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.locate_in_doc",
      runtime_capability: HELIX_DOCS_SEARCH_CAPABILITY,
      aliases: [
        "docs_viewer.locate_in_doc",
        "docs_viewer locate",
        "docs_viewer to locate",
        "docs viewer locate",
        "docs viewer to locate",
        "docs_viewer cite",
        "docs_viewer to cite",
        "docs viewer cite",
        "docs viewer to cite",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: [
        "doc_location_result",
        "doc_location_matches",
        "doc_evidence_location",
      ],
      required_terminal_kind: "doc_location_matches",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "docs-viewer.summarize_doc",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.summarize_doc",
      runtime_capability: HELIX_DOCS_SEARCH_CAPABILITY,
      aliases: [
        "docs_viewer.summarize_doc",
        "docs_viewer summarize",
        "docs_viewer to summarize",
        "docs viewer summarize",
        "docs viewer to summarize",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: ["doc_summary", "observation_review"],
      required_terminal_kind: "doc_summary",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "docs-viewer.locate_in_doc",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "docs-viewer.doc_equation_context",
      runtime_capability: HELIX_DOCS_SEARCH_CAPABILITY,
      aliases: [
        "docs_viewer.doc_equation_context",
        "docs_viewer equation context",
        "docs_viewer to inspect equation context",
        "docs viewer equation context",
        "docs viewer to inspect equation context",
      ],
      capability_family: "docs_viewer",
      plan_family: "docs",
      source_target: "docs_viewer",
      admission_families: ["docs_viewer"],
      required_observation_kinds: ["doc_equation_context"],
      required_terminal_kind: "doc_equation_context",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "repo-code.search_concept",
      runtime_capability: "repo.search",
      aliases: [
        "repo.search",
        "repo_code.search_concept",
        "repo code search concept",
        "repo_code",
        "repo code",
        "repo_evidence",
        "repository code",
      ],
      capability_family: "repo_code",
      plan_family: "repo_evidence",
      source_target: "repo_code",
      admission_families: ["repo_code"],
      required_observation_kinds: [
        "repo_code_evidence_observation",
        "repo_evidence_relevance_gate",
      ],
      required_terminal_kind: "repo_code_evidence_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "docs-viewer.locate_in_doc",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "workspace-directory.resolve",
      aliases: [
        "workspace_directory.resolve",
        "workspace directory resolve",
        "workspace_directory",
        "workspace directory",
        "workspace_directory_resolution",
        "workspace directory resolution",
      ],
      capability_family: "workspace_directory",
      plan_family: "workspace_directory",
      source_target: "workspace_directory",
      admission_families: ["workspace_directory"],
      required_observation_kinds: ["workspace_directory_resolution"],
      required_terminal_kind: "workspace_directory_resolution",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "internet_search.web_research",
      runtime_capability: HELIX_INTERNET_SEARCH_CAPABILITY,
      aliases: [
        HELIX_INTERNET_SEARCH_CAPABILITY,
        "internet_search",
        "internet search",
        "web_research",
        "web research",
        "web.search",
        "web search",
      ],
      capability_family: "internet_search",
      plan_family: "internet_search",
      source_target: "internet_search",
      admission_families: ["internet_search"],
      required_observation_kinds: ["internet_search_observation"],
      required_terminal_kind: "internet_search_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: HELIX_RESEARCH_LIBRARY_READ_CAPABILITY,
      aliases: [
        "research_library.read_document",
        "research library",
        "saved full-text evidence",
        "saved full text evidence",
        "existing full-text evidence",
        "existing full text evidence",
        "saved research extraction",
      ],
      capability_family: "scholarly_research",
      plan_family: "scholarly_research",
      source_target: "research_library",
      admission_families: ["scholarly_research"],
      required_observation_kinds: ["research_library_observation"],
      required_terminal_kind: "scholarly_research_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
      aliases: [
        "research_library.apply_evidence_enrichment",
        "apply paper evidence enrichment",
        "persist paper evidence enrichment",
      ],
      capability_family: "scholarly_research",
      plan_family: "scholarly_research",
      source_target: "research_library",
      admission_families: ["scholarly_research"],
      required_observation_kinds: ["paper_evidence_enrichment_observation"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "scientific-calculator.solve_expression",
        "theory-badge-graph.reflect_discussion_context",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      aliases: [
        "scholarly_research.lookup_papers",
        "scholarly_research",
        "scholarly research",
        "scholarly research lookup",
        "lookup_papers",
      ],
      capability_family: "scholarly_research",
      plan_family: "scholarly_research",
      source_target: "scholarly_research",
      admission_families: ["scholarly_research"],
      required_observation_kinds: ["scholarly_research_observation"],
      required_terminal_kind: "scholarly_research_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      aliases: [
        "scholarly_research.fetch_full_text",
        "scholarly research fetch full text",
        "fetch_full_text",
        "fetch full text",
        "scholarly_full_text",
        "scholarly full text",
        "scholarly research full text",
      ],
      capability_family: "scholarly_research",
      plan_family: "scholarly_research",
      source_target: "scholarly_research",
      admission_families: ["scholarly_research"],
      required_observation_kinds: ["scholarly_full_text_observation"],
      required_terminal_kind: "scholarly_research_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: HELIX_SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      aliases: [
        "scholarly_research.extract_numeric_parameters",
        "scholarly research extract numeric parameters",
        "extract_numeric_parameters",
        "extract numeric parameters",
        "numeric_parameter_extraction",
        "numeric parameter extraction",
        "scholarly numeric parameters",
      ],
      capability_family: "scholarly_research",
      plan_family: "scholarly_research",
      source_target: "scholarly_research",
      admission_families: ["scholarly_research"],
      required_observation_kinds: ["scholarly_numeric_parameter_observation"],
      required_terminal_kind: "scholarly_research_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    liveSourceMailEvidenceContract({
      capability: "live_env.query_micro_reasoner_presets",
      aliases: [
        "microdeck",
        "micro_reasoner_presets",
        "micro reasoner presets",
        "micro reasoner preset catalog",
        "earbud_microdeck",
        "audio_transcript_microdeck",
        "earbud_translation_presets",
        "stage_play_micro_reasoner_prompt_preset_query_result/v1",
      ],
      requiredObservationKinds: [
        "stage_play_micro_reasoner_prompt_preset_query_result",
      ],
    }),
    liveSourceMailEvidenceContract({
      capability: "live_env.draft_micro_reasoner_preset",
      aliases: [
        "microdeck_draft",
        "micro_reasoner_preset_draft",
        "micro reasoner preset draft",
        "draft micro reasoner preset",
        "earbud_microdeck_draft",
        "audio_translation_preset_draft",
        "stage_play_micro_reasoner_prompt_preset_draft/v1",
      ],
      requiredObservationKinds: [
        "stage_play_micro_reasoner_prompt_preset_draft",
      ],
    }),
    liveSourceMailEvidenceContract({
      capability: "live_env.route_micro_reasoner_prompt",
      aliases: [
        "microdeck_prompt_router",
        "microdeck prompt router",
        "micro reasoner prompt router",
        "prompt_delegation",
        "stage_play_micro_reasoner_prompt_delegation_result/v1",
      ],
      requiredObservationKinds: [
        "stage_play_micro_reasoner_prompt_delegation_result",
      ],
    }),
    liveSourceMailEvidenceContract({
      capability: "live_env.query_micro_reasoner_prompts",
      aliases: [
        "micro_reasoner_prompts",
        "micro reasoner prompts",
        "stage_play_micro_reasoner_prompt/v1",
      ],
      requiredObservationKinds: ["stage_play_micro_reasoner_prompt"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.apply_micro_reasoner_preset",
      aliases: ["apply_micro_reasoner_preset", "apply micro reasoner preset"],
      requiredObservationKind: "stage_play_micro_reasoner_prompt_preset",
    }),
    liveEnvironmentControlContract({
      capability: "live_env.create_micro_reasoner_preset",
      aliases: ["create_micro_reasoner_preset", "create micro reasoner preset"],
      requiredObservationKind: "stage_play_micro_reasoner_prompt_preset",
    }),
    liveEnvironmentControlContract({
      capability: "live_env.update_micro_reasoner_prompt",
      aliases: ["update_micro_reasoner_prompt", "update micro reasoner prompt"],
      requiredObservationKind: "stage_play_micro_reasoner_prompt",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.test_micro_reasoner_prompt",
      aliases: ["test_micro_reasoner_prompt", "test micro reasoner prompt"],
      requiredObservationKind: "stage_play_micro_reasoner_prompt_test",
    }),
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.check_live_source_mail",
      aliases: [
        "check_live_source_mail",
        "live_source_mail.check",
        "live_source_mail check",
        "live_source_mail to check",
        "live source mail check",
        "live source mail to check",
        "live source mailbox check",
        "live source mailbox to check",
        "check live source mail",
        "check live source mailbox",
        "check source mail",
        "check mailbox",
      ],
      capability_family: "live_source_mail",
      plan_family: "live_environment",
      source_target: "live_source_mailbox",
      admission_families: ["live_environment"],
      required_observation_kinds: ["stage_play_live_source_mail_read_result"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.read_live_source_mail",
      aliases: [
        "read_live_source_mail",
        "live_source_mail.read_raw",
        "live_source_mail raw read",
        "live_source_mail read raw",
        "live_source_mail to read raw",
        "live source mail raw read",
        "live source mail read raw",
        "live source mail to read raw",
        "live source mailbox raw read",
        "live source mailbox read raw",
        "live source mailbox to read raw",
        "raw live source mail",
        "raw mail",
        "read raw mail",
        "unprocessed live source mail",
        "debug live source mail",
      ],
      capability_family: "live_source_mail",
      plan_family: "live_environment",
      source_target: "live_source_mailbox",
      admission_families: ["live_environment"],
      required_observation_kinds: ["stage_play_live_source_mail_read_result"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.read_processed_live_source_mail",
      aliases: [
        "read_processed_live_source_mail",
        "processed_live_source_mail",
        "live_source_mail.read_processed",
        "live_source_mail read",
        "live_source_mail to read",
        "live source mail read",
        "live source mail to read",
        "live source mailbox read",
        "live source mailbox to read",
      ],
      capability_family: "live_source_mail",
      plan_family: "live_environment",
      source_target: "live_source_mailbox",
      admission_families: ["live_environment"],
      required_observation_kinds: ["stage_play_processed_mail_packet"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.process_live_source_mail",
      aliases: [
        "process_live_source_mail",
        "live_source_mail.process",
        "live_source_mail process",
        "live_source_mail to process",
        "live source mail process",
        "live source mail to process",
        "live source mailbox process",
        "live source mailbox to process",
      ],
      capability_family: "live_source_mail",
      plan_family: "live_environment",
      source_target: "live_source_mailbox",
      admission_families: ["live_environment"],
      required_observation_kinds: [
        "stage_play_live_source_mail_read_result",
        "stage_play_processed_mail_packet",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    liveSourceMailEvidenceContract({
      capability: "live_env.query_live_source_quality",
      aliases: [
        "live_source_quality",
        "source_freshness",
        "stage_play_live_source_quality/v1",
      ],
      requiredObservationKinds: [
        "stage_play_live_source_quality",
        "helix.workstation_goal_context_update.v1",
      ],
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_workstation_goal_context",
      aliases: [
        "workstation_goal_context",
        "goal_context_updates",
        "agent_goal_sessions",
        "active_goals",
        "active_goal_sessions",
        "agent_goal_context",
        "stage_play_workstation_goal_context_read_result/v1",
      ],
      requiredObservationKinds: [
        "stage_play_workstation_goal_context_read_result",
        "helix.agent_goal_session.v1",
      ],
    }),
    liveSourceMailEvidenceContract({
      capability: "live_env.summarize_live_source_current_state",
      aliases: [
        "live_answer_state",
        "live_source_current_state",
        "stage_play_live_source_current_state/v1",
      ],
      requiredObservationKinds: [
        "stage_play_live_source_current_state",
        "helix.workstation_goal_context_update.v1",
      ],
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.read_card",
      aliases: ["read_card", "live_card", "live card"],
      requiredObservationKind: "live_environment_tool_observation",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_event_log",
      aliases: ["query_event_log", "event_log", "live event log"],
      requiredObservationKind: "live_environment_tool_observation",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_world_events",
      aliases: ["query_world_events", "world_events", "world events"],
      requiredObservationKind: "live_environment_tool_observation",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_navigation_state",
      aliases: [
        "query_navigation_state",
        "navigation_state",
        "navigation state",
      ],
      requiredObservationKind: "live_environment_tool_observation",
    }),
    liveEnvironmentEvidenceContract({
      capability: "live_env.plan_stage_play_job",
      aliases: ["plan_stage_play_job", "stage play job plan"],
      requiredObservationKinds: ["stage_play_job_plan"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.configure_visual_observer_profile",
      aliases: [
        "configure_visual_observer_profile",
        "visual_observer_profile",
        "visual observer profile",
      ],
      requiredObservationKind: "stage_play_visual_observer_profile",
    }),
    liveEnvironmentControlContract({
      capability: "live_env.apply_visual_observer_profile",
      aliases: [
        "apply_visual_observer_profile",
        "apply visual observer profile",
        "apply visual observer shades",
      ],
      requiredObservationKind: "stage_play_visual_observer_profile",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_visual_observer_profiles",
      aliases: [
        "query_visual_observer_profiles",
        "visual observer profiles",
        "visual observer shades",
      ],
      requiredObservationKind: "stage_play_visual_observer_profile",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.test_visual_observer_profile",
      aliases: ["test_visual_observer_profile", "test visual observer profile"],
      requiredObservationKind: "stage_play_visual_observer_profile_test",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.compare_visual_observer_profiles",
      aliases: [
        "compare_visual_observer_profiles",
        "compare visual observer profiles",
      ],
      requiredObservationKind: "stage_play_visual_observer_profile_test",
    }),
    liveEnvironmentEvidenceContract({
      capability: "live_env.request_visual_action_replay",
      aliases: ["request_visual_action_replay", "visual action replay"],
      requiredObservationKinds: ["helix_visual_frame_action_replay_request"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.configure_interpreter_profile",
      aliases: ["configure_interpreter_profile", "interpreter profile"],
      requiredObservationKind: "stage_play_live_source_interpreter_profile",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.compare_mail_to_interpreter_profile",
      aliases: [
        "compare_mail_to_interpreter_profile",
        "mail interpreter profile comparison",
      ],
      requiredObservationKind:
        "stage_play_live_source_interpreter_profile_comparison",
    }),
    liveEnvironmentEvidenceContract({
      capability: "live_env.request_stage_play_checkpoint",
      aliases: ["request_stage_play_checkpoint", "stage play checkpoint"],
      requiredObservationKinds: ["stage_play_checkpoint_request"],
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.predict_live_source_immediate",
      aliases: [
        "predict_live_source_immediate",
        "predict live source immediate",
      ],
      requiredObservationKind: "helix_live_source_immediate_prediction",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.compare_live_source_prediction",
      aliases: [
        "compare_live_source_prediction",
        "compare live source prediction",
      ],
      requiredObservationKind: "helix_live_source_prediction_comparison",
    }),
    liveEnvironmentControlContract({
      capability: "live_env.project_live_source_narrative",
      aliases: ["project_live_source_narrative", "live source narrative state"],
      requiredObservationKind: "stage_play_live_source_narrative_state",
    }),
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.reflect_live_source_mail_loop",
      aliases: [
        "reflect_live_source_mail_loop",
        "live_source_mail.reflect",
        "live_source_mail reflect",
        "live_source_mail to reflect",
        "live source mail reflect",
        "live source mail to reflect",
        "live source mailbox reflect",
        "live source mailbox to reflect",
        "live_source_mail_loop_reflection",
        "mailbox loop reflection",
      ],
      capability_family: "live_source_mail",
      plan_family: "live_environment",
      source_target: "live_source_mailbox",
      admission_families: ["live_environment"],
      required_observation_kinds: [
        "stage_play_live_source_mail_loop_reflection",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "internet_search.web_research",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.reflect_stage_play_context",
      aliases: ["reflect_stage_play_context", "stage_play_reflection"],
      capability_family: "live_environment",
      plan_family: "live_environment",
      source_target: "live_environment",
      admission_families: ["live_environment"],
      required_observation_kinds: [
        "live_environment_tool_observation",
        "stage_play_reflection_result",
      ],
      required_terminal_kind: "direct_answer_text",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "live_env.configure_live_source_watch_job",
        "live_env.read_processed_live_source_mail",
        "live_env.read_live_source_mail",
        "situation-room.describe_visual_capture",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.narrator_say",
      aliases: ["narrator.say", "narrator_say"],
      capability_family: "live_environment",
      plan_family: "live_environment",
      source_target: "live_environment",
      admission_families: ["live_environment", "workstation_action"],
      required_observation_kinds: [
        "live_environment_tool_observation",
        "helix.narrator_say_request.v1",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "live_env.narrator_bind_stream",
        "live_env.read_processed_live_source_mail",
        "live_env.read_live_source_mail",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.narrator_bind_stream",
      aliases: ["narrator.bind_stream", "narrator_bind_stream"],
      capability_family: "live_environment",
      plan_family: "live_environment",
      source_target: "live_environment",
      admission_families: ["live_environment", "workstation_action"],
      required_observation_kinds: [
        "live_environment_tool_observation",
        "helix.narrator_bind_stream_request.v1",
      ],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "live_env.narrator_say",
        "live_env.read_processed_live_source_mail",
        "live_env.read_live_source_mail",
        "model.direct_answer",
      ],
    },
    liveEnvironmentControlContract({
      capability: "live_env.change_workstation_preset",
      aliases: ["change_workstation_preset", "change_preset"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.set_visual_preset",
      aliases: ["set_visual_preset", "visual_preset"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.set_audio_preset",
      aliases: ["set_audio_preset", "audio_preset"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.bind_workstation_source",
      aliases: ["bind_workstation_source", "bind_source"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.unbind_workstation_source",
      aliases: ["unbind_workstation_source", "unbind_source"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.pause_workstation_loop",
      aliases: ["pause_workstation_loop", "pause_loop"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.resume_workstation_loop",
      aliases: ["resume_workstation_loop", "resume_loop"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.set_workstation_loop_state",
      aliases: ["set_workstation_loop_state", "set_loop_state"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.configure_route_watch",
      aliases: ["configure_route_watch", "route_watch_policy"],
      requiredObservationKind:
        "stage_play_live_source_watch_job_policy_config_result",
    }),
    liveEnvironmentControlContract({
      capability: "live_env.configure_live_source_watch_job",
      aliases: [
        "configure_live_source_watch_job",
        "live_source_watch_job",
        "watch_job_policy",
      ],
      requiredObservationKind:
        "stage_play_live_source_watch_job_policy_config_result",
    }),
    liveEnvironmentControlContract({
      capability: "live_env.repair_loop",
      aliases: ["repair_loop"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.repair_workstation_source",
      aliases: ["repair_workstation_source", "repair_source"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.update_live_answer_projection",
      aliases: ["update_live_answer_projection", "update_live_answer"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.focus_process_graph",
      aliases: ["focus_process_graph"],
    }),
    liveEnvironmentControlContract({
      capability: "live_env.start_agent_goal_session",
      aliases: ["start_agent_goal_session"],
      requiredObservationKind: "stage_play_agent_goal_session_tool_result",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_constructs",
      aliases: ["query_constructs", "situation room constructs"],
      requiredObservationKind: "live_environment_tool_observation",
    }),
    liveEnvironmentQueryContract({
      capability: "live_env.query_job_evidence",
      aliases: ["query_job_evidence", "live job evidence"],
      requiredObservationKind: "live_environment_tool_observation",
    }),
    liveEnvironmentEvidenceContract({
      capability: "live_env.request_probe",
      aliases: ["request_probe", "bounded live evidence probe"],
    }),
    ...HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS.map((capability) =>
      liveEnvironmentEvidenceContract({
        capability,
        aliases: [
          capability.replace(/^com\.casimirbot\./, "").replaceAll(".", " "),
        ],
        requiredObservationKinds: [
          "helix.environment_connector.probe_observation.v1",
          "helix.agent_step_observation_packet.v1",
          "provider_gateway_observation_packet",
        ],
        requiredArgs:
          capability === HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY ||
          capability === HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY
            ? ["target", "position"]
            : ["target"],
        optionalArgs:
          capability === HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY
            ? ["position", "freshness_requirement_ms"]
            : capability === HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY
              ? [
                  "horizontal_radius",
                  "vertical_radius",
                  "purpose",
                  "requested_length",
                  "requested_height",
                  "orientation",
                  "relative_side",
                  "verification_from",
                  "verification_to",
                  "expected_block",
                  "freshness_requirement_ms",
                ]
              : ["freshness_requirement_ms"],
      }),
    ),
    ...HELIX_MINECRAFT_MECHANICS_FACT_CAPABILITY_IDS.map((capability) =>
      liveEnvironmentEvidenceContract({
        capability,
        aliases: [
          capability.replace(/^com\.casimirbot\./, "").replaceAll(".", " "),
        ],
        requiredObservationKinds: [
          "helix.environment_connector.probe_observation.v1",
          "helix.agent_step_observation_packet.v1",
          "provider_gateway_observation_packet",
        ],
        requiredArgs:
          capability === HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY
            ? ["registry_kind", "resource_id"]
            : ["query_kind", "resource_id"],
        optionalArgs:
          capability === HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY
            ? ["max_results", "freshness_requirement_ms"]
            : ["freshness_requirement_ms"],
      }),
    ),
    ...MINECRAFT_PLAYER_EXPLICIT_CAPABILITY_IDS.map((capability) => {
      const args = MINECRAFT_PLAYER_ACTION_CONTRACT_ARGS.get(capability) ?? {
        required: [],
        optional: ["environment_label"],
      };
      return liveEnvironmentEvidenceContract({
        capability,
        aliases: [
          capability.replace(/^com\.casimirbot\./, "").replaceAll(".", " "),
        ],
        requiredObservationKinds: [
          HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
          "helix.agent_step_observation_packet.v1",
          "provider_gateway_observation_packet",
        ],
        requiredArgs: args.required,
        optionalArgs: args.optional,
      });
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
      aliases: ["create durable Minecraft goal", "start durable Minecraft goal"],
      requiredObservationKinds: [
        "helix.environment_durable_goal_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: ["objective"],
      optionalArgs: ["environment_label"],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
      aliases: ["inspect durable Minecraft goal", "read durable Minecraft goal"],
      requiredObservationKinds: [
        "helix.environment_durable_goal_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: ["goal_id"],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
      aliases: ["record durable Minecraft goal progress", "append durable Minecraft goal event"],
      requiredObservationKinds: [
        "helix.environment_durable_goal_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: ["goal_id", "expected_revision", "payload", "evidence_refs"],
      optionalArgs: ["environment_label"],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_REASONING_ROLE_RECORD_CAPABILITY,
      aliases: ["record revision-bound environment reasoning support"],
      requiredObservationKinds: [
        "helix.environment_reasoning_role_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: [
        "goal_id",
        "expected_goal_revision",
        "expected_ledger_revision",
        "observation_revision",
        "input_evidence_refs",
        "payload",
        "expires_in_seconds",
      ],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_REASONING_ROLE_INSPECT_CAPABILITY,
      aliases: [
        "inspect revision-bound environment reasoning support",
        "inspect concurrent-reasoning ledger",
        "inspect reasoning-role ledger",
      ],
      requiredObservationKinds: [
        "helix.environment_reasoning_role_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: ["goal_id"],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_REASONING_ROLE_DISPOSITION_CAPABILITY,
      aliases: ["record principal disposition of environment reasoning support"],
      requiredObservationKinds: [
        "helix.environment_reasoning_role_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: [
        "goal_id",
        "expected_ledger_revision",
        "role_output_id",
        "disposition",
        "adopted_capability_id",
        "adopted_capability_arguments",
        "rationale_summary",
      ],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_ENVIRONMENT_REASONING_ROLE_ARBITRATE_CAPABILITY,
      aliases: ["arbitrate current environment reasoning proposal"],
      requiredObservationKinds: [
        "helix.environment_reasoning_role_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: [
        "goal_id",
        "expected_goal_revision",
        "expected_ledger_revision",
        "observation_revision",
        "considered_role_output_ids",
        "selected_role_output_id",
        "reason",
      ],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
      aliases: ["minecraft closed container contents"],
      requiredObservationKinds: [
        "helix.environment_connector.probe_observation.v1",
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: [],
      optionalArgs: ["freshness_requirement_ms"],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
      aliases: ["minecraft command catalog", "minecraft live command tree"],
      requiredObservationKinds: [
        HELIX_ENVIRONMENT_COMMAND_CATALOG_OBSERVATION_SCHEMA,
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: [],
      optionalArgs: ["query", "path_prefix", "limit", "environment_label"],
    }),
    liveEnvironmentEvidenceContract({
      capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
      aliases: ["minecraft command", "minecraft live command"],
      requiredObservationKinds: [
        HELIX_ENVIRONMENT_COMMAND_OBSERVATION_SCHEMA,
        "helix.agent_step_observation_packet.v1",
        "provider_gateway_observation_packet",
      ],
      requiredArgs: ["command"],
      optionalArgs: ["category", "effect", "environment_label"],
    }),
    liveEnvironmentEvidenceContract({
      capability: "live_env.record_commentary",
      aliases: ["record_commentary", "live evidence commentary"],
    }),
    liveEnvironmentEvidenceContract({
      capability: "live_env.spawn_field_worker",
      aliases: ["spawn_field_worker", "spawn field worker"],
    }),
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.evaluate_goal_satisfaction",
      aliases: ["evaluate_goal_satisfaction", "goal_satisfaction"],
      capability_family: "live_environment",
      plan_family: "live_environment",
      source_target: "live_environment",
      admission_families: ["live_environment"],
      required_observation_kinds: [
        "live_environment_tool_observation",
        "helix.live_environment_goal_satisfaction.v1",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "live_env.start_agent_goal_session",
        "live_env.read_processed_live_source_mail",
        "live_env.read_live_source_mail",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.record_live_source_mail_decision",
      capability_family: "live_source_decision",
      plan_family: "live_environment",
      source_target: "live_source_mailbox",
      admission_families: ["live_environment", "workstation_action"],
      required_observation_kinds: [
        "stage_play_processed_mail_packet",
        "stage_play_live_source_mail_decision",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "live_env.request_interim_voice_callout",
      capability_family: "voice_delivery",
      plan_family: "live_environment",
      source_target: "live_environment",
      admission_families: ["live_environment", "workstation_action"],
      required_observation_kinds: [
        "stage_play_live_source_mail_decision",
        "live_source_interim_voice_callout_receipt",
        "voice_hold_receipt",
        "voice_block_receipt",
        "voice_receipt",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "text_to_speech.speak_text",
      aliases: ["speak_text", "text_to_speech", "voice_delivery.speak_text"],
      capability_family: "voice_delivery",
      plan_family: "live_environment",
      source_target: "voice_delivery",
      admission_families: ["live_environment", "workstation_action"],
      required_observation_kinds: [
        "capability_lane_observation_packet",
        "helix.agent_step_observation_packet.v1",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: ["live_env.request_interim_voice_callout"],
      forbidden_nearby_capabilities: ["model.direct_answer"],
      required_args: ["text"],
      optional_args: ["voice", "profile", "locale", "source_observation_ref"],
    },
    ...WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS.map((spec) =>
      liveEnvironmentQueryContract({
        capability: spec.capability,
        aliases: [...spec.aliases],
        requiredObservationKind: spec.explicitRequiredObservationKind,
      }),
    ),
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.reflect_theory_context",
      aliases: [
        "theory-badge-graph.reflect_discussion_context",
        "reflect_discussion_context",
        "reflect_theory_context",
        "theory_context",
        "theory_context_reflection",
        "theory_locator",
        "theory_badge_graph",
        "theory badge graph",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: [
        "helix_theory_context_reflection_tool_receipt",
        "theory_context_reflection",
      ],
      required_terminal_kind: "theory_context_reflection_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
      aliases: ["theory_experiment_procedure_prepare"],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: ["theory_experiment_procedure_observation"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY,
      aliases: [
        "scientific_evidence_closure_inspect_enrollment",
        "scientific evidence enrollment",
        "conformed scientific evidence sidecar",
        "scientific evidence runtime workbench",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: [
        "scientific_evidence_enrollment_observation",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY,
      aliases: [
        "scientific_evidence_closure_prepare",
        "prepare scientific evidence execution",
        "prepare scientific evidence intervention",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: [
        "scientific_evidence_execution_plan_observation",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY,
      aliases: [
        "scientific_evidence_closure_evaluate",
        "evaluate scientific evidence closure",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: ["scientific_evidence_closure_observation"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: THEORY_EXPERIMENT_PROCEDURE_READMIT_CAPABILITY,
      aliases: ["theory_experiment_procedure_readmit"],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: ["theory_experiment_procedure_observation"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
      aliases: [
        "theory_experiment_procedure_evaluate_closure",
        "theory_execution_closure",
        "theory execution closure",
        "execution closure",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: ["theory_experiment_execution_closure"],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    theoryExecutionEvidenceContract({
      capability: THEORY_SEMANTIC_ADMITTER_NORMALIZE_CAPABILITY,
      aliases: ["theory_semantic_admitter_normalize"],
      requiredObservationKinds: ["semantic_admission"],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_ARTIFACT_PRODUCER_PREPARE_LANYON_REQUEST_CAPABILITY,
      aliases: ["theory_artifact_producer_prepare_lanyon_request"],
      requiredObservationKinds: [
        "theory_artifact_producer_lanyon_request_observation",
      ],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_ARTIFACT_PRODUCER_ADMIT_LANYON_CAPABILITY,
      aliases: ["theory_artifact_producer_admit_lanyon_snapshot"],
      requiredObservationKinds: ["artifact_generation_receipt"],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
      aliases: ["theory_formal_verifier_inspect_artifact_family"],
      requiredObservationKinds: [
        "theory_formal_artifact_family_audit_observation",
      ],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
      aliases: ["theory_formal_verifier_prepare_request"],
      requiredObservationKinds: [
        "theory_formal_verifier_preparation_observation",
      ],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
      aliases: ["theory_formal_verifier_plan"],
      requiredObservationKinds: ["theory_formal_verifier_plan_observation"],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_FORMAL_VERIFIER_START_CAPABILITY,
      aliases: ["theory_formal_verifier_start"],
      requiredObservationKinds: ["theory_formal_verifier_start_observation"],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_FORMAL_VERIFIER_READ_RESULT_CAPABILITY,
      aliases: ["theory_formal_verifier_read_result"],
      requiredObservationKinds: ["formal_certificate"],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_INDEPENDENT_NUMERICAL_PREPARE_REQUEST_CAPABILITY,
      aliases: ["theory_independent_numerical_verifier_prepare_request"],
      requiredObservationKinds: [
        "theory_independent_numerical_verifier_prepared_request_observation",
      ],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_INDEPENDENT_NUMERICAL_PLAN_CAPABILITY,
      aliases: ["theory_independent_numerical_verifier_plan"],
      requiredObservationKinds: [
        "theory_independent_numerical_verifier_plan_observation",
      ],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_INDEPENDENT_NUMERICAL_START_CAPABILITY,
      aliases: ["theory_independent_numerical_verifier_start"],
      requiredObservationKinds: [
        "theory_independent_numerical_verifier_start_observation",
      ],
    }),
    theoryExecutionEvidenceContract({
      capability: THEORY_INDEPENDENT_NUMERICAL_READ_RESULT_CAPABILITY,
      aliases: ["theory_independent_numerical_verifier_read_result"],
      requiredObservationKinds: ["numerical_certificate"],
    }),
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix.theory.frontierVectorFieldTrace",
      aliases: [
        "frontierVectorFieldTrace",
        "frontier_vector_field_trace",
        "theory_frontier_vector_field",
        "theory_frontier_vector_field_trace",
        "badge_coordinate_vector_trace",
        "relation_tensor_trace",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: [
        "helix_theory_frontier_vector_field_tool_receipt",
        "theory_frontier_vector_field",
      ],
      required_terminal_kind: "theory_context_reflection_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "theory-badge-graph.propose_frontier_conjectures",
      aliases: [
        "propose_frontier_conjectures",
        "theory_frontier_conjectures",
        "frontier_conjecture_workbench",
        "bounded_conjecture_workbench",
        "theory_badge_graph_conjecture_workbench",
      ],
      capability_family: "theory_locator",
      plan_family: "theory_locator",
      source_target: "theory_locator",
      admission_families: ["theory_locator"],
      required_observation_kinds: [
        "theory_frontier_conjecture_observation",
        "theory_frontier_search",
        "theory_frontier_candidate",
        "helix_theory_context_reflection_tool_receipt",
      ],
      required_terminal_kind: "theory_context_reflection_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    contextReflectionEvidenceContract({
      capability: "helix_ask.reflect_live_synthetic_data",
      aliases: [
        "live_synthetic_data_reflection",
        "live_answer_synthetic_data",
        "microdeck_reflection",
        "macro_reasoner_deck_reflection",
        "mail_loop_synthetic_data",
        "live_answer_prediction_review",
      ],
      requiredObservationKinds: [
        "helix_context_reflection_tool_receipt/v1",
        "bounded_context_reference",
      ],
    }),
    contextReflectionEvidenceContract({
      capability: "helix_ask.reflect_context_attachments",
      aliases: [
        "context_reflection.attachments",
        "context_reflection attachments",
        "context_reflection to inspect attachments",
        "context_attachment_reflection",
        "context_binding_reflection",
        "dragged_cutout_context",
        "selected_ui_region",
        "selected_context_refs",
        "helix_context_reflection_tool_receipt/v1",
      ],
      requiredObservationKinds: [
        "helix_context_reflection_tool_receipt/v1",
        "context_attachment",
        "bounded_context_reference",
      ],
    }),
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "moral-graph.reflect_context",
      aliases: [
        "helix_ask.reflect_moral_graph",
        "moral_badge_locator",
        "moral_graph_reflection",
        "moral graph reflection",
        "moral_graph",
        "moral graph",
      ],
      capability_family: "moral_graph_reflection",
      plan_family: "moral_graph_reflection",
      source_target: "moral_graph",
      admission_families: ["workstation_action"],
      required_observation_kinds: [
        "moral_graph_reflection",
        "helix.moral_graph_reflection_observation.v1",
        "ideology_context_reflection/v1",
        "procedural_moral_classification/v1",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.reflect_ideology_context",
      aliases: ["reflect_ideology_context", "ideology_context_reflection"],
      capability_family: "moral_graph_reflection",
      plan_family: "moral_graph_reflection",
      source_target: "workspace_action",
      admission_families: ["workstation_action"],
      required_observation_kinds: [
        "ideology_context_reflection/v1",
        "procedural_moral_classification/v1",
        "helix_moral_graph_reflection_tool_result",
        "workstation_tool_evaluation",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "moral-graph.reflect_living_substrate_context",
      aliases: [
        "moral_living_substrate_reflection",
        "moral living substrate reflection",
        "living_substrate_moral_reflection",
        "living substrate moral reflection",
        "reflect_living_substrate_context",
        "reflect living substrate context",
      ],
      capability_family: "context_reflection",
      plan_family: "context_reflection",
      source_target: "moral_graph",
      admission_families: ["context_reflection"],
      required_observation_kinds: [
        "moral_living_substrate_reflection",
        "helix.moral_living_substrate_reflection_observation.v1",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "helix_ask.reflect_ideology_context",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.bridge_theory_ideology_context",
      aliases: [
        "bridge_theory_ideology_context",
        "bridge theory ideology context",
        "bridge theory and ideology context",
        "theory_ideology_bridge",
        "theory ideology bridge",
        "theory_moral_bridge",
        "theory moral bridge",
      ],
      capability_family: "moral_graph_reflection",
      plan_family: "moral_graph_reflection",
      source_target: "workspace_action",
      admission_families: ["workstation_action"],
      required_observation_kinds: [
        "helix_theory_ideology_bridge_tool_result",
        "theory_ideology_bridge",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.build_civilization_scenario_frame",
      aliases: [
        "build_civilization_scenario_frame",
        "build civilization scenario frame",
        "civilization_scenario_frame",
        "civilization scenario frame",
      ],
      capability_family: "civilization_bounds",
      plan_family: "civilization_bounds",
      source_target: "workspace_action",
      admission_families: ["workstation_action"],
      required_observation_kinds: [
        "civilization_scenario_frame/v1",
        "helix_civilization_scenario_frame_tool_result",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "helix_ask.reflect_civilization_bounds",
      aliases: [
        "reflect_civilization_bounds",
        "reflect civilization bounds",
        "civilization_bounds",
        "civilization bounds",
        "civilization_bounds_reflection",
        "civilization bounds reflection",
        "civilization_bounds_roadmap/v1",
      ],
      capability_family: "civilization_bounds",
      plan_family: "civilization_bounds",
      source_target: "workspace_action",
      admission_families: ["workstation_action"],
      required_observation_kinds: [
        "civilization_bounds_roadmap/v1",
        "helix_civilization_bounds_tool_result",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "visual_analysis.inspect_image_region",
      aliases: [
        "image lens pdf page",
        "image lens page",
        "image lens crop",
        "image lens region",
        "image lens observation",
        "pdf page crop",
        "exact equation row",
        "equation row crop",
        "crop ref",
        "bbox",
        "bounding box",
      ],
      capability_family: "visual_capture",
      plan_family: "visual_capture",
      source_target: "visual_capture",
      admission_families: ["situation_run"],
      required_observation_kinds: [
        "capability_lane_observation_packet",
        "visual_analysis.inspect_image_region",
        "scientific_image_evidence_sidecar",
      ],
      required_terminal_kind: "image_lens_observation_report",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: [
        "situation-room.describe_visual_capture",
        "docs-viewer.locate_in_doc",
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "image_lens.inspect",
      runtime_capability: "situation-room.describe_visual_capture",
      aliases: [
        "image_lens",
        "image lens",
        "image-lens",
        "visual_capture",
        "visual capture",
        "visual capture inspect",
        "situation-room.describe_visual_capture",
        "situation room visual capture",
        "image lens inspect",
      ],
      capability_family: "visual_capture",
      plan_family: "visual_capture",
      source_target: "visual_capture",
      admission_families: ["situation_run"],
      required_observation_kinds: [
        "visual_frame_evidence",
        "situation_context_pack",
        "visual_capture_coverage",
      ],
      required_terminal_kind: "situation_context_pack",
      allowed_substitutions: ["situation-room.describe_visual_capture"],
      forbidden_nearby_capabilities: [
        "docs-viewer.locate_in_doc",
        "repo-code.search_concept",
        "model.direct_answer",
      ],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "workstation-notes.list_notes",
      aliases: [
        "workstation-notes.list",
        "workstation notes list",
        "list workstation notes",
      ],
      capability_family: "workstation",
      plan_family: "workstation_action",
      source_target: "workspace_action",
      admission_families: ["notes", "workstation_action"],
      required_observation_kinds: [
        "workstation_notes_list_observation",
        "helix.workstation_notes_list_observation.v1",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "workstation-notes.append_to_note",
      aliases: ["workstation-notes.append", "workstation notes append"],
      capability_family: "workstation",
      plan_family: "workstation_action",
      source_target: "workspace_action",
      admission_families: ["notes", "workstation_action"],
      required_observation_kinds: [
        "workspace_action_receipt",
        "note_update_receipt",
        "note_action_receipt",
      ],
      required_terminal_kind: "model_synthesized_answer",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "workstation-notes.create_note",
      aliases: [
        "workstation-notes.create",
        "workstation notes create",
        "create workstation note",
      ],
      capability_family: "workstation",
      plan_family: "workstation_action",
      source_target: "workspace_action",
      admission_families: ["notes", "workstation_action"],
      required_observation_kinds: [
        "workspace_action_receipt",
        "note_update_receipt",
      ],
      required_terminal_kind: "note_update_receipt",
      allowed_substitutions: ["workstation-notes.create"],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
    {
      schema: "helix.explicit_capability_contract.v1",
      capability: "workstation-notes.open",
      aliases: ["workstation notes open", "open workstation notes"],
      capability_family: "workstation",
      plan_family: "workstation_action",
      source_target: "workspace_action",
      admission_families: ["notes", "workstation_action"],
      required_observation_kinds: ["workspace_action_receipt"],
      required_terminal_kind: "workstation_tool_evaluation",
      allowed_substitutions: [],
      forbidden_nearby_capabilities: ["model.direct_answer"],
    },
  ];

const explicitCapabilityContracts: ExplicitCapabilityContract[] =
  explicitCapabilityContractDefinitions.map(
    normalizeExplicitCapabilityContract,
  );

const commandVerb = String.raw`(?:call|use|run|invoke|execute|reflect(?:\s+on)?|inspect\s+using|locate\s+(?:in\s+doc\s+)?using|find\s+using)`;

const uniqueStrings = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean)));

const normalizeCapabilityKey = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const capabilityKeysMatch = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizeCapabilityKey(left);
  const normalizedRight = normalizeCapabilityKey(right);
  return Boolean(
    normalizedLeft && normalizedRight && normalizedLeft === normalizedRight,
  );
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const commandMentionsCapability = (
  prompt: string,
  capability: string,
): boolean => {
  const escaped = escapeRegex(capability);
  return new RegExp(
    String.raw`\b${commandVerb}\b[\s\S]{0,80}\b${escaped}\b`,
    "i",
  ).test(prompt);
};

const capabilityMentionRegex = (capability: string): RegExp =>
  new RegExp(String.raw`\b${escapeRegex(capability)}\b`, "gi");

const commandMentionsCapabilityAt = (
  prompt: string,
  capability: string,
  matchIndex: number,
): boolean => {
  const windowStart = Math.max(0, matchIndex - 100);
  const before = prompt.slice(windowStart, matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  return (
    new RegExp(String.raw`\b${commandVerb}\b[\s\S]{0,100}$`, "i").test(
      clausePrefix,
    ) ||
    commandMentionsCapability(
      `${clausePrefix}${prompt.slice(matchIndex, matchIndex + capability.length + 90).split(/[.!?;\n]/)[0] ?? ""}`,
      capability,
    )
  );
};

const negatedCommandMentionsCapabilityAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const before = prompt.slice(Math.max(0, matchIndex - 360), matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  // A safety instruction can enumerate several forbidden actions before it
  // reaches the matched capability. Keep the whole local clause, while
  // treating an explicit contrast as the start of a new operative instruction.
  const operativeClausePrefix =
    clausePrefix.split(/\b(?:but|however|instead)\b/i).pop() ?? clausePrefix;
  const strongNegation = new RegExp(
    String.raw`\b(?:do\s+not|don['’]t|dont|never|avoid|without)\b[\s\S]{0,280}$`,
    "i",
  ).test(operativeClausePrefix);
  const explicitBareNo =
    new RegExp(
      String.raw`\bno(?:\s+(?:need|reason|permission|request))?(?:\s+to)?\s+(?:${commandVerb})\b[\s\S]{0,80}$`,
      "i",
    ).test(operativeClausePrefix) ||
    /\bno(?:\s+(?:more|further|additional|any))?\s*$/i.test(
      operativeClausePrefix,
    );
  return strongNegation || explicitBareNo;
};

const capabilityMentionIsQuotedAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const pairedQuotePattern =
    /"[^"]*"|'[^']*'|“[^”]*”|„[^”]*”|‘[^’]*’|‚[^’]*’|«[^»]*»|‹[^›]*›|「[^」]*」|『[^』]*』/g;
  for (const quoteMatch of prompt.matchAll(pairedQuotePattern)) {
    const quoteStart =
      typeof quoteMatch.index === "number" ? quoteMatch.index : -1;
    const quoteEnd = quoteStart + quoteMatch[0].length;
    if (quoteStart >= 0 && matchIndex > quoteStart && matchIndex < quoteEnd) {
      return true;
    }
  }
  const before = prompt.slice(0, Math.max(0, matchIndex));
  const straightQuotes = (before.match(/(?<!\\)"/g) ?? []).length;
  const openCurlyQuotes = (before.match(/[“]/g) ?? []).length;
  const closeCurlyQuotes = (before.match(/[”]/g) ?? []).length;
  const openCurlySingleQuotes = (before.match(/[‘]/g) ?? []).length;
  const closeCurlySingleQuotes = (before.match(/[’]/g) ?? []).length;
  const openGuillemets = (before.match(/[«‹]/g) ?? []).length;
  const closeGuillemets = (before.match(/[»›]/g) ?? []).length;
  return (
    straightQuotes % 2 === 1 ||
    openCurlyQuotes > closeCurlyQuotes ||
    openCurlySingleQuotes > closeCurlySingleQuotes ||
    openGuillemets > closeGuillemets
  );
};

const capabilityMentionIsDeferredAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const before = prompt.slice(Math.max(0, matchIndex - 160), matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  const immediateExecutionGuard =
    /\b(?:if|when|unless)\b[^,.!?;\n]{0,120}\b(?:controls?\s+(?:are\s+)?idle|manual\s+input|landing\s+(?:path|area|site)|safe|unsafe|ready|available|online|connected|reachable|within\s+(?:range|reach))\b/i.test(
      clausePrefix,
    );
  return (
    /\b(?:later|eventually|someday|in\s+the\s+future)\b[\s\S]{0,120}$/i.test(
      clausePrefix,
    ) ||
    (!immediateExecutionGuard &&
      /\b(?:if|when|unless)\b[\s\S]{0,120}$/i.test(clausePrefix)) ||
    /\b(?:may|might|could|would|plan\s+to|intend\s+to)\s+(?:then\s+)?(?:call|use|run|invoke|execute)\b[\s\S]{0,80}$/i.test(
      clausePrefix,
    )
  );
};

const capabilityMentionIsScreenVisibleAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const before = prompt.slice(Math.max(0, matchIndex - 180), matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  return /\b(?:screen|page|button|label|ui|text|menu|dropdown)\b[\s\S]{0,120}\b(?:says|shows|reads|contains|labeled|labelled|called|named)\b[\s\S]{0,100}$/i.test(
    clausePrefix,
  );
};

const capabilityMentionIsHistoricalCommandAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const before = prompt.slice(Math.max(0, matchIndex - 200), matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  return /\b(?:earlier|previously|historically|last\s+turn|before)\b[\s\S]{0,100}\b(?:asked|said|mentioned|reported|described|discussed)\b[\s\S]{0,80}\b(?:call|use|run|invoke|execute|continue|evaluate|assess)\b[\s\S]{0,40}$/i.test(
    clausePrefix,
  );
};

const capabilityMentionIsNonExecutableContextAt = (
  prompt: string,
  matchIndex: number,
): boolean =>
  capabilityMentionIsQuotedAt(prompt, matchIndex) ||
  capabilityMentionIsDeferredAt(prompt, matchIndex) ||
  capabilityMentionIsScreenVisibleAt(prompt, matchIndex) ||
  capabilityMentionIsHistoricalCommandAt(prompt, matchIndex);

const theoryExecutionClosureCommandMatch = (
  prompt: string,
): {
  matched_text: string;
  match_index: number;
  match_end_index: number;
} | null => {
  const matcher =
    /\b(?:continue|evaluate|assess|run|execute|use|call|invoke)\b[\s\S]{0,100}\b((?:theory[-_\s]+)?execution[-_\s]+closure|theory-experiment-procedure\.evaluate_closure|theory_experiment_procedure_evaluate_closure)\b/gi;
  for (const match of prompt.matchAll(matcher)) {
    const fullMatchIndex = typeof match.index === "number" ? match.index : -1;
    const matchedText = match[1] ?? "";
    if (fullMatchIndex < 0 || !matchedText) continue;
    const relativeMatchIndex = match[0].lastIndexOf(matchedText);
    const matchIndex = fullMatchIndex + Math.max(0, relativeMatchIndex);
    const before = prompt.slice(Math.max(0, matchIndex - 180), matchIndex);
    const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
    if (
      capabilityMentionIsNonExecutableContextAt(prompt, matchIndex) ||
      negatedCommandMentionsCapabilityAt(prompt, matchIndex) ||
      /\b(?:earlier|previously|historically|last\s+turn|before|already)\b[\s\S]{0,160}$/i.test(
        clausePrefix,
      ) ||
      /\b(?:screen|page|button|label|ui|text|menu|dropdown)\b[\s\S]{0,120}\b(?:says|shows|reads|contains|labeled|labelled|called|named)\b[\s\S]{0,100}$/i.test(
        clausePrefix,
      )
    ) {
      continue;
    }
    return {
      matched_text: matchedText,
      match_index: matchIndex,
      match_end_index: matchIndex + matchedText.length,
    };
  }
  return null;
};

const capabilityMentionIsExplanatoryQuestionAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const boundaryIndex = Math.max(
    prompt.lastIndexOf(".", matchIndex - 1),
    prompt.lastIndexOf("?", matchIndex - 1),
    prompt.lastIndexOf("!", matchIndex - 1),
    prompt.lastIndexOf(";", matchIndex - 1),
    prompt.lastIndexOf("\n", matchIndex - 1),
  );
  const nextBoundaryCandidates = ["?", ";", ".", "!", "\n"]
    .map((boundary) => prompt.indexOf(boundary, matchIndex))
    .filter((index) => index >= matchIndex && index - matchIndex <= 240);
  const clauseEnd =
    nextBoundaryCandidates.length > 0
      ? Math.min(...nextBoundaryCandidates)
      : Math.min(prompt.length, matchIndex + 240);
  const clause = prompt.slice(boundaryIndex + 1, clauseEnd + 1);
  const asksAboutCapability =
    /\b(?:does?|can|could|would|will|is|are)\b|\bdo\s+you\b|\b(?:allow|let)(?:s|ted)?\s+you\b/i.test(
      clause,
    );
  const namesToolOrWorkflowInClause =
    /\b(?:your|the|this|that)\s+(?:(?:research[-\s]?paper|scholarly|paper)\s+)?(?:tool|agent|workflow|connector|adapt(?:e|o)r|capabilit(?:y|ies))\b/i.test(
      clause,
    ) ||
    /\b(?:tool|agent|workflow|connector|adapt(?:e|o)r)\s+for\s+(?:research|scholarly)\s+papers?\b/i.test(
      clause,
    );
  const continuesPriorCapabilityQuestion = /^\s*or\s+do\s+you\b/i.test(clause);
  const priorQuestionContext = prompt.slice(
    Math.max(0, boundaryIndex - 240),
    boundaryIndex + 1,
  );
  const priorQuestionNamesToolOrWorkflow =
    /\b(?:your|the|this|that)\s+(?:(?:research[-\s]?paper|scholarly|paper)\s+)?(?:tool|agent|workflow|connector|adapt(?:e|o)r|capabilit(?:y|ies))\b/i.test(
      priorQuestionContext,
    ) ||
    /\b(?:tool|agent|workflow|connector|adapt(?:e|o)r)\s+for\s+(?:research|scholarly)\s+papers?\b/i.test(
      priorQuestionContext,
    );
  const historicalCapabilityReference =
    /\b(?:earlier|previously|historically|last\s+turn|before)\b[\s\S]{0,120}\b(?:asked|mentioned|said|discussed|wondered)\b/i.test(
      clause,
    ) && namesToolOrWorkflowInClause;
  const explanatoryCapabilityQuestion =
    clause.includes("?") &&
    asksAboutCapability &&
    (namesToolOrWorkflowInClause ||
      (continuesPriorCapabilityQuestion && priorQuestionNamesToolOrWorkflow));
  return explanatoryCapabilityQuestion || historicalCapabilityReference;
};

const compoundCommandChainMentionsCapabilityAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const before = prompt.slice(Math.max(0, matchIndex - 120), matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  if (!new RegExp(String.raw`\b${commandVerb}\b`, "i").test(prompt))
    return false;
  return /\b(?:then|and|plus|after|before|followed\s+by|next)\b[\s\S]{0,80}$/i.test(
    clausePrefix,
  );
};

const commandClauseOrdinal = (prompt: string, matchIndex: number): number => {
  const before = prompt.slice(0, Math.max(0, matchIndex));
  return Array.from(
    before.matchAll(
      /\b(?:first|second|third|fourth|fifth|finally|then|next|followed\s+by|and\s+then|plus)\b(?:\s+(?:call|use|run|invoke|execute))?/gi,
    ),
  ).length;
};

const commandMentionsContract = (
  prompt: string,
  contract: ExplicitCapabilityContract,
): boolean => {
  const names = uniqueStrings([
    contract.capability,
    contract.runtime_capability ?? "",
    ...(contract.aliases ?? []),
  ]);
  return names.some((name) => {
    const matcher = capabilityMentionRegex(name);
    for (const match of prompt.matchAll(matcher)) {
      const matchIndex = typeof match.index === "number" ? match.index : -1;
      if (matchIndex < 0) continue;
      if (capabilityMentionIsNonExecutableContextAt(prompt, matchIndex))
        continue;
      if (negatedCommandMentionsCapabilityAt(prompt, matchIndex)) continue;
      if (commandMentionsCapabilityAt(prompt, name, matchIndex)) return true;
    }
    return false;
  });
};

const hasConcreteCalculatorExpression = (prompt: string): boolean =>
  /\bscientific-calculator\.solve(?:_expression|_with_steps)?\b/i.test(
    prompt,
  ) ||
  /\b(?:with\s+(?:this\s+exact\s+)?expression|expression\s+is|expression)\s*:?\s*[0-9][0-9eE\s.+\-*/^%()[\]]{1,120}/i.test(
    prompt,
  );

const isConditionalPriorEvidenceCalculatorFollowup = (
  prompt: string,
): boolean => {
  const conditional =
    /\b(?:if|when|provided\s+that|only\s+if|assuming)\b/i.test(prompt);
  const priorEvidence =
    /\b(?:previous|prior|above|last|earlier)\b[\s\S]{0,100}\b(?:answers?|evidence|result|retrieval|values?|variables?)\b/i.test(
      prompt,
    );
  const sufficiencyCheck =
    /\b(?:enough|sufficient|usable|adequate|complete|fully\s+cited|unit[-\s]?bearing|cited)\b[\s\S]{0,120}\b(?:values?|numbers?|numerics?|parameters?|evidence|citations?|units?)\b/i.test(
      prompt,
    );
  const calculatorFollowup =
    /\b(?:bind|calculate|compute|evaluate|solve|run)\b[\s\S]{0,140}\b(?:formula|expression|calculator|numeric(?:al)?\s+expression|result)\b/i.test(
      prompt,
    );
  return conditional && priorEvidence && sufficiencyCheck && calculatorFollowup;
};

const conditionalCalculatorFollowupSuppressesContract = (
  prompt: string,
  contract: ExplicitCapabilityContract,
): boolean =>
  contract.capability_family === "calculator" &&
  isConditionalPriorEvidenceCalculatorFollowup(prompt) &&
  !hasConcreteCalculatorExpression(prompt);

const familySuppressed = (
  prompt: string,
  contract: ExplicitCapabilityContract,
): boolean => {
  if (conditionalCalculatorFollowupSuppressesContract(prompt, contract))
    return true;
  if (commandMentionsContract(prompt, contract)) return false;
  const suppression = detectContextualToolAdmissionSuppression(prompt);
  if (!suppression) return false;
  if (suppression.suppression_reason === "explanatory_only") return false;
  return contract.admission_families.some(
    (family: HelixToolCallAdmissionFamily) =>
      contextualToolSuppressionBlocksFamily(suppression, family),
  );
};

const naturalNotesListPromptMatch = (
  prompt: string,
): {
  matched_text: string;
  match_index: number;
  match_end_index: number;
} | null => {
  if (!/\b(?:workstation\s+)?notes?\b/i.test(prompt)) return null;
  if (
    /\b(?:create|add|append|store|save|write|edit|update|delete|remove)\b[\s\S]{0,100}\b(?:workstation\s+)?notes?\b/i.test(
      prompt,
    ) ||
    /\b(?:workstation\s+)?notes?\b[\s\S]{0,100}\b(?:create|add|append|store|save|write|edit|update|delete|remove)\b/i.test(
      prompt,
    )
  ) {
    return null;
  }
  const match =
    prompt.match(
      /\b(?:check|list|show|review|inspect|browse|look\s+(?:at|through)|tell\s+me\s+(?:what|which))\b[\s\S]{0,120}\b(?:workstation\s+)?notes?\b/i,
    ) ??
    prompt.match(
      /\b(?:what|which)\b[\s\S]{0,80}\b(?:topics?|subjects?|notes?)\b[\s\S]{0,80}\b(?:available|present|saved|in)\b[\s\S]{0,60}\b(?:workstation\s+)?notes?\b/i,
    );
  if (!match || typeof match.index !== "number") return null;
  return {
    matched_text: match[0],
    match_index: match.index,
    match_end_index: match.index + match[0].length,
  };
};

const naturalMinecraftInventoryProbePromptMatch = (
  prompt: string,
): {
  matched_text: string;
  match_index: number;
  match_end_index: number;
} | null => {
  const explicitProcessedMailSemanticWake =
    /\b(?:read|inspect|process)\b[\s\S]{0,140}\b(?:processed\s+)?(?:minecraft\s+)?live[-\s]?source\s+(?:mail|mailbox|packet)\b/i.test(
      prompt,
    ) &&
    /\b(?:record[\s\S]{0,80}(?:interpretation|decision|checkpoint)|mail[-\s]?loop|loop\s+state|semantic\s+(?:wake|replan(?:ning)?))\b/i.test(
      prompt,
    );
  const separateInventoryOperation =
    /\bthen\s+(?:separately\s+)?(?:check|inspect|show|read|review|look\s+at)\b[\s\S]{0,120}\binventory\b/i.test(
      prompt,
    );
  if (explicitProcessedMailSemanticWake && !separateInventoryOperation)
    return null;
  if (
    /\bwhy\s+did\b[\s\S]{0,80}\b(?:previous|earlier|last)\s+turn\b/i.test(
      prompt,
    ) ||
    /\bcan\s+(?:the|this|our|a)\s+(?:(?:minecraft|fabric)\s+)?connector\b[\s\S]{0,100}\b(?:recheck|check|inspect|read|show)\b/i.test(
      prompt,
    )
  ) {
    return null;
  }
  const match =
    prompt.match(
      /\b(?:check|inspect|show|read|review|look\s+at|tell\s+me\s+(?:what(?:'s|\s+is)?|which))\b[\s\S]{0,120}\b(?:current\s+|my\s+|the\s+)?minecraft\s+inventory\b/i,
    ) ??
    prompt.match(
      /\b(?:what(?:'s|\s+is)?|which\s+items?\s+are)\b[\s\S]{0,100}\b(?:my\s+|the\s+)?minecraft\s+inventory\b/i,
    ) ??
    prompt.match(
      /\b(?:what(?:'s|\s+is)?|show\s+me|tell\s+me)\b[\s\S]{0,80}\b(?:the\s+)?(?:player|current\s+actor)\b[\s\S]{0,40}\b(?:carrying|holding)\b[\s\S]{0,60}\bminecraft\b/i,
    ) ??
    (/\bminecraft\b/i.test(prompt)
      ? prompt.match(
          /\b(?:check|inspect|show|read|review|look\s+at|tell\s+me)\b[\s\S]{0,160}\b(?:my\s+|the\s+player'?s?\s+|current\s+actor'?s?\s+)?(?:armor|gear|equipment|hotbar|items?|inventory)(?:\s*(?:,|and|or)\s*(?:armor|gear|equipment|hotbar|items?|inventory))*\b/i,
        )
      : null);
  if (!match || typeof match.index !== "number") return null;
  const inventoryPhrase = prompt.match(
    /\b(?:current\s+|my\s+|the\s+)?minecraft\s+inventory\b/i,
  );
  if (
    inventoryPhrase &&
    typeof inventoryPhrase.index === "number" &&
    inventoryPhrase.index >= match.index &&
    inventoryPhrase.index + inventoryPhrase[0].length <=
      match.index + match[0].length
  ) {
    return {
      matched_text: inventoryPhrase[0],
      match_index: inventoryPhrase.index,
      match_end_index: inventoryPhrase.index + inventoryPhrase[0].length,
    };
  }
  const inventoryWord = prompt
    .slice(match.index, match.index + match[0].length)
    .match(/\binventory\b/i);
  if (inventoryWord && typeof inventoryWord.index === "number") {
    const matchIndex = match.index + inventoryWord.index;
    return {
      matched_text: inventoryWord[0],
      match_index: matchIndex,
      match_end_index: matchIndex + inventoryWord[0].length,
    };
  }
  return {
    matched_text: match[0],
    match_index: match.index,
    match_end_index: match.index + match[0].length,
  };
};

const BARE_MINECRAFT_SLASH_COMMAND_PROMPT =
  /^\s*\/[a-z][a-z0-9:_-]*(?:\s+[^\r\n]+)?\s*$/i;

export type ExplicitCapabilityExtractionContext = {
  /**
   * Server-derived environment scope for a current shared-room turn. This is
   * deliberately narrower than conversation text: callers may only provide it
   * after authenticating the room membership, active connector, and selected
   * participant subject.
   */
  trusted_environment_domain?: "minecraft" | null;
  authorized_player_action_capability_ids?: string[];
};

/**
 * Reads only the server-materialized room environment context used during
 * capability extraction. Request text and model-authored tool arguments are
 * never sufficient to manufacture this context; the provider removes any
 * caller copy and resolves the authenticated room participant before setting
 * the envelope.
 */
export const readTrustedRoomEnvironmentCapabilityExtractionContext = (
  value: unknown,
): ExplicitCapabilityExtractionContext | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schema !== "helix.trusted_room_environment_intent_context.v1" ||
    record.source !== "authenticated_room_environment_subject" ||
    record.trusted_environment_domain !== "minecraft" ||
    record.terminal_eligible !== false ||
    record.assistant_answer !== false ||
    record.raw_content_included !== false
  ) {
    return null;
  }
  const authorizedPlayerActionCapabilityIds = Array.isArray(
    record.authorized_player_action_capability_ids,
  )
    ? record.authorized_player_action_capability_ids.filter(
        (capabilityId): capabilityId is string =>
          typeof capabilityId === "string" &&
          capabilityId.startsWith("com.casimirbot.minecraft.player."),
      )
    : [];
  return {
    trusted_environment_domain: "minecraft",
    authorized_player_action_capability_ids:
      authorizedPlayerActionCapabilityIds,
  };
};

const NATURAL_MINECRAFT_COMMAND_ACTION = String.raw`(?:make|create|build|construct|surround|enclose|give|grant|apply|remove|clear|summon|spawn|teleport|bring|move|kill|damage|heal|feed|equip|enchant|fill|replace|place|put|take|turn|set|change|toggle|enable|disable|start|stop|freeze|unfreeze|save|flush|kick|ban|pardon|whitelist|op|deop|show|display|title|message|say|play(?:ing)?|trigger|award|drop|locate|break|rescue|protect|arm|ignite|light|extinguish)`;

const MINECRAFT_COMMAND_EXECUTION_ACTION = String.raw`(?:${NATURAL_MINECRAFT_COMMAND_ACTION}|run|execute|issue|send|use)`;

/**
 * Recognizes an affirmative operator request whose implementation belongs to
 * the live Minecraft command surface. This only proposes the command
 * capability; the model still chooses a command and Helix independently
 * validates the resulting request, room authority, source, and arguments.
 */
const naturalMinecraftCommandActionPromptMatch = (
  prompt: string,
  context?: ExplicitCapabilityExtractionContext | null,
): {
  matched_text: string;
  match_index: number;
  match_end_index: number;
} | null => {
  const hasMinecraftScope =
    /\b(?:minecraft|fabric|minehut|mine\s*hut|in[-\s]?game)\b|\bconnected\s+(?:game|world|server)\b/i.test(
      prompt,
    ) || context?.trusted_environment_domain === "minecraft";
  if (!hasMinecraftScope) return null;
  if (isMinecraftSituationSessionSetupPrompt(prompt)) return null;
  if (
    (resolveMinecraftExecutionPlaneConstraint(prompt) === "player_embodiment" ||
      isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt, context))
  ) {
    return null;
  }

  const directRequestPatterns = [
    new RegExp(
      String.raw`\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(${NATURAL_MINECRAFT_COMMAND_ACTION})\b`,
      "i",
    ),
    new RegExp(
      String.raw`\bi\s+(?:want|need|would\s+like)\s+you\s+to\s+(${NATURAL_MINECRAFT_COMMAND_ACTION})\b`,
      "i",
    ),
    new RegExp(
      String.raw`(?:^|[,.!?;:]\s*|\b(?:then|and)\s+)(?:please\s+)?(${NATURAL_MINECRAFT_COMMAND_ACTION})\b`,
      "i",
    ),
    new RegExp(
      String.raw`\bplease\s+(${NATURAL_MINECRAFT_COMMAND_ACTION})\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:in|on)\s+(?:the\s+)?(?:(?:paired|active|connected|live|current|our|my)\s+)*(?:minecraft(?:\s+fabric)?|fabric|minehut|mine\s*hut|game)(?:\s+(?:game|world|server))?\b[\s\S]{0,100}?\b(${NATURAL_MINECRAFT_COMMAND_ACTION})\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b(?:in|on)\s+(?:the\s+)?(?:(?:paired|active|connected|live|current|our|my)\s+)*(?:minecraft(?:\s+fabric)?|fabric|minehut|mine\s*hut|game)(?:\s+(?:game|world|server))?\b[\s\S]{0,100}?\b(run|execute|issue|send|use)\b(?=[\s\S]{0,120}(?:\b(?:exact\s+|minecraft\s+|fabric\s+)?command(?!\.catalog\b|\s+(?:tree|catalog)\b)\b|\/[a-z][a-z0-9:_-]*\b))`,
      "i",
    ),
    new RegExp(
      String.raw`(?:^|[,.!?;:]\s*|\b(?:then|and)\s+)(?:please\s+)?(run|execute|issue|send|use)\b(?=[\s\S]{0,120}(?:\b(?:exact\s+|minecraft\s+|fabric\s+)?command(?!\.catalog\b|\s+(?:tree|catalog)\b)\b|\/[a-z][a-z0-9:_-]*\b))`,
      "i",
    ),
  ];
  const requestMatch = directRequestPatterns
    .map((pattern) => prompt.match(pattern))
    .find((candidate): candidate is RegExpMatchArray =>
      Boolean(candidate && typeof candidate.index === "number" && candidate[1]),
    );
  if (!requestMatch || typeof requestMatch.index !== "number") return null;

  const matchedText = requestMatch[1];
  const matchIndex =
    requestMatch.index + Math.max(0, requestMatch[0].lastIndexOf(matchedText));
  const clausePrefix =
    prompt
      .slice(Math.max(0, matchIndex - 220), matchIndex)
      .split(/[.!?;\n]/)
      .pop() ?? "";
  const priorBoundary = Math.max(
    prompt.lastIndexOf(".", matchIndex - 1),
    prompt.lastIndexOf("!", matchIndex - 1),
    prompt.lastIndexOf("?", matchIndex - 1),
    prompt.lastIndexOf(";", matchIndex - 1),
    prompt.lastIndexOf("\n", matchIndex - 1),
  );
  const followingBoundaryOffsets = [".", "!", "?", ";", "\n"]
    .map((boundary) => prompt.indexOf(boundary, matchIndex))
    .filter((index) => index >= 0);
  const followingBoundary =
    followingBoundaryOffsets.length > 0
      ? Math.min(...followingBoundaryOffsets)
      : prompt.length;
  const actionClause = prompt.slice(priorBoundary + 1, followingBoundary);
  const clauseWindow = actionClause;
  const actionTail = prompt.slice(
    matchIndex,
    Math.min(prompt.length, matchIndex + 180),
  );
  const requestsObservationArtifactRatherThanMutation =
    /^(?:make|create)\b(?:\s+(?:one|a|an|the))?\s+(?:(?:fresh|current|new|read[-\s]?only|bounded|post[-\s]?action)\s+){0,5}(?:(?:player|actor)[-\s]?status\s+)?(?:check|inspection|observation|assessment|report|summary)\b/i.test(
      actionTail,
    );
  const requestsDurableGoalArtifactRatherThanMutation =
    /^(?:make|create|start)\b[\s\S]{0,100}\bdurable\b[\s\S]{0,80}\bgoal\b/i.test(
      actionTail,
    );
  const explainsInsteadOfActs =
    /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:explain|describe|tell|show|teach|outline|write|plan|simulate|quote|repeat|discuss)\b/i.test(
      clausePrefix,
    ) ||
    /\b(?:explain|describe|tell\s+me\s+how|show\s+me\s+how|what\s+(?:command|would)|which\s+command)\b/i.test(
      clausePrefix,
    );
  const negatedOrNoChange = new RegExp(
    String.raw`\b(?:do\s+not|don['’]t|dont|never|not|avoid|without)\b[\s\S]{0,120}\b${MINECRAFT_COMMAND_EXECUTION_ACTION}\b|\b(?:do\s+not|don['’]t|dont|never|without)\b[\s\S]{0,100}\b(?:change|modify|affect|execute|run|apply)\b|\b(?:make|perform|cause)\s+(?:absolutely\s+)?no\s+(?:changes?|modifications?|mutations?)\b`,
    "i",
  ).test(clauseWindow);
  const deferredOrConditional = new RegExp(
    String.raw`\b(?:later|eventually|tomorrow|someday|if|when|unless|once|may|might)\b[\s\S]{0,140}\b${MINECRAFT_COMMAND_EXECUTION_ACTION}\b`,
    "i",
  ).test(clausePrefix);
  const contextualDiscussion =
    /\b(?:screen|page|button|label|ui|text|menu|transcript|example|quoted?|someone\s+said)\b[\s\S]{0,140}\b(?:says|shows|reads|contains|uses|mentions|asks?|called|named)?\b/i.test(
      clausePrefix,
    ) ||
    /\b(?:docs?|guide|manual)\b[\s\S]{0,80}\b(?:says|shows|reads|contains|uses|mentions|asks?)\b/i.test(
      clausePrefix,
    ) ||
    /\b(?:earlier|previously|historically|last\s+turn|before)\b[\s\S]{0,160}$/i.test(
      clausePrefix,
    ) ||
    /\bcan\s+(?:the|this|our|a)\s+(?:(?:minecraft|fabric)\s+)?(?:connector|adapter|tool)\b/i.test(
      clausePrefix,
    );
  const targetsCommandTextOrHostArtifact =
    /\b(?:save|write|copy|record|export)\b[\s\S]{0,100}\b(?:text|wording|example|snippet)\b[\s\S]{0,100}\b(?:command|file|disk|document|note)\b/i.test(
      clauseWindow,
    );
  const requestsCommandDescriptionInsteadOfExecution =
    /\b(?:give|show|provide|return|report|write|quote|cite)\s+(?:me\s+)?(?:the\s+)?(?:exact\s+)?(?:minecraft\s+)?(?:command\s+(?:form|syntax|text|example|snippet)|syntax\s+for\s+(?:the\s+)?command)\b/i.test(
      clauseWindow,
    );

  if (
    explainsInsteadOfActs ||
    negatedCommandMentionsCapabilityAt(prompt, matchIndex) ||
    negatedOrNoChange ||
    deferredOrConditional ||
    contextualDiscussion ||
    targetsCommandTextOrHostArtifact ||
    requestsCommandDescriptionInsteadOfExecution ||
    requestsObservationArtifactRatherThanMutation ||
    requestsDurableGoalArtifactRatherThanMutation
  ) {
    return null;
  }
  return {
    matched_text: matchedText,
    match_index: matchIndex,
    match_end_index: matchIndex + matchedText.length,
  };
};

const naturalMinecraftSituationProbePromptMatches = (
  prompt: string,
  context?: ExplicitCapabilityExtractionContext | null,
): Array<{
  capability: string;
  matched_text: string;
  match_index: number;
  match_end_index: number;
}> => {
  const minecraftCommandActionMatch = naturalMinecraftCommandActionPromptMatch(
    prompt,
    context,
  );
  const playerEmbodimentPlane =
    resolveMinecraftExecutionPlaneConstraint(prompt) === "player_embodiment";
  const hasMinecraftCommandSurfaceIntent =
    /\b(?:use|using|run|execute|issue|send|set|change)\b[\s\S]{0,100}\b(?:live\s+)?(?:minecraft|fabric|minehut|mine\s*hut|game)\b[\s\S]{0,100}\b(?:server\s+)?(?:command(?!\.catalog\b|\s+(?:tree|catalog)\b)(?:\s+(?:dispatcher|surface))?|dispatcher)\b/i.test(
      prompt,
    );
  const hasBareMinecraftSlashCommand =
    BARE_MINECRAFT_SLASH_COMMAND_PROMPT.test(prompt);
  const structureAwareActionTarget =
    minecraftCommandActionMatch &&
    /^(?:build|construct|surround|enclose|ignite|light|start|protect|rescue|break)$/i.test(
      minecraftCommandActionMatch.matched_text,
    ) &&
    /\b(?:wall|house|base|structure|building|fireplace|hearth|fall|landing|rescue)\b/i.test(
      prompt,
    );
  if (
    !/\bminecraft\b/i.test(prompt) &&
    !playerEmbodimentPlane &&
    !isAffirmativeImmediateMinecraftSituationPrompt(prompt) &&
    !hasMinecraftCommandSurfaceIntent &&
    !hasBareMinecraftSlashCommand &&
    !minecraftCommandActionMatch &&
    context?.trusted_environment_domain !== "minecraft"
  ) {
    return [];
  }
  if (
    /\bwhy\s+did\b[\s\S]{0,100}\b(?:previous|earlier|last)\s+turn\b/i.test(
      prompt,
    ) ||
    /\b(?:historically|previously|earlier|last\s+turn)\b[\s\S]{0,140}\b(?:read|checked|inspected|scanned|surveyed|mapped|showed|described|performed|ran|executed|requested|used)\b/i.test(
      prompt,
    ) ||
    /^\s*(?:(?:can|could|would)\s+you\s+)?(?:explain|tell\s+me|show\s+me|teach\s+me|outline)\s+(?:how|why|what)\b/i.test(
      prompt,
    ) ||
    /\bcan\s+(?:the|this|our|a)\s+(?:(?:minecraft|fabric)\s+)?connector\b[\s\S]{0,100}\b(?:recheck|check|inspect|read|show|use|run|execute|issue|send|query|list|set|change|save|flush)\b/i.test(
      prompt,
    ) ||
    /\b(?:explain|describe|tell\s+me\s+how|what\s+would)\b[\s\S]{0,180}\b(?:minecraft|fabric|minehut|mine\s*hut)\b[\s\S]{0,180}(?:\bcommand\b|\/[a-z0-9:_-]+\b)[\s\S]{0,120}\b(?:do\s+not|don't|dont|never|without)\s+(?:run|execute|issue|send|use)\b/i.test(
      prompt,
    )
  ) {
    return [];
  }
  const specifications: Array<{
    capability: string;
    patterns: RegExp[];
  }> = [
    {
      capability: HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
      patterns: [
        /\b(?:check|verify|inspect|query|read|look\s+up)\b[\s\S]{0,100}\b(?:running|live|current|paired|connected)?\s*(?:minecraft|fabric)?\s*(?:block|item|entity[-\s]?type|mob[-\s]?effect)?\s*registry\b[\s\S]{0,160}\b(?:exists?|registered|contains?|present)\b/i,
        /\b(?:check|verify|tell\s+me|is)\b[\s\S]{0,100}\b(?:exact\s+)?(?:block|item|entity[-\s]?type|mob[-\s]?effect)\s+(?:id\s+)?[a-z0-9_.-]+:[a-z0-9_./-]+\b[\s\S]{0,140}\b(?:exists?|registered|present)\b[\s\S]{0,100}\b(?:registry|minecraft|fabric|server)\b/i,
        /\b(?:is|does)\s+[a-z0-9_.-]+:[a-z0-9_./-]+\b[\s\S]{0,100}\b(?:exist|registered|appear)\b[\s\S]{0,100}\b(?:block|item|entity[-\s]?type|mob[-\s]?effect)?\s*registry\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
      patterns: [
        /\b(?:check|verify|inspect|query|read|look\s+up|find|show|list)\b[\s\S]{0,120}\b(?:running|live|current|paired|connected)?\s*(?:minecraft|fabric)?\s*recipes?\b[\s\S]{0,160}\b(?:recipe\s+id|output|produce[sd]?|craft(?:s|ing)?|for)\b/i,
        /\b(?:what|which|show|list|find|check)\s+recipes?\b[\s\S]{0,100}\b(?:produce|craft|output|make)\b[\s\S]{0,80}\b[a-z0-9_.-]+:[a-z0-9_./-]+\b/i,
        /\b(?:check|verify|look\s+up|find)\b[\s\S]{0,80}\b(?:exact\s+)?recipe\s+(?:id\s+)?[a-z0-9_.-]+:[a-z0-9_./-]+\b[\s\S]{0,100}\b(?:minecraft|fabric|server|exists?|registered)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
      patterns: playerEmbodimentPlane
        ? [
            /\bwalk\b[\s\S]{0,100}\b(?:blocks?|direction|forward|backward|back|left|right)\b/iu,
            /\b(?:walk|take)\b[\s\S]{0,80}\b(?:step|steps|forward|backward|back|left|right)\b/iu,
            /\b(?:move|walk)\b[\s\S]{0,60}\b(?:forward|backward|back|left|right)\b/iu,
          ]
        : [],
    },
    {
      capability: HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
      patterns: playerEmbodimentPlane ? [/\bjump(?:s|ed|ing)?\b/iu] : [],
    },
    {
      capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
      patterns: [
        /\b(?:where\s+am\s+i|what(?:'s|\s+is)\s+my\s+(?:current\s+)?(?:minecraft\s+)?(?:location|position|dimension)|how\s+am\s+i\s+doing)\b[\s\S]{0,120}\bminecraft\b|\bminecraft\b[\s\S]{0,120}\b(?:where\s+am\s+i|what(?:'s|\s+is)\s+my\s+(?:current\s+)?(?:location|position|dimension)|how\s+am\s+i\s+doing)\b/i,
        /\b(?:what(?:'s|\s+is)|recheck|check|read|show|inspect|tell\s+me)\b[\s\S]{0,40}\bmy\s+(?:(?:current\s+)?(?:minecraft\s+)?|minecraft\s+(?:current\s+)?)(?:health|hearts?|hunger|food\s+level|status|game\s+mode|position)\b/i,
        /\b(?:verify|recheck|check|read|show|inspect|tell\s+me)\b[\s\S]{0,50}\b(?:my|the\s+player'?s?|current\s+actor'?s?)\s+(?:current\s+|final\s+)?(?:health|hearts?|hunger|food\s+level|status|game\s+mode|position)\b/i,
        /\b(?:use|obtain|require)\b[\s\S]{0,50}\b(?:fresh|current)\s+(?:minecraft\s+)?actor\s+status\s+evidence\b[\s\S]{0,80}\b(?:report|verify|check|read|show)\b[\s\S]{0,40}\b(?:final\s+)?position\b/i,
        /\b(?:my|the\s+player'?s?|current\s+actor'?s?)\s+(?:current\s+)?(?:health|hearts?|hunger|food\s+level|status|game\s+mode|position)\b/i,
        /\b(?:check|read|show|inspect|tell\s+me)\b[\s\S]{0,80}\b(?:my\s+)?(?:selected|bound|current)\s+(?:minecraft\s+)?player'?s?\s+(?:current\s+)?(?:health|hearts?|hunger|food\s+level|status|game\s+mode|position)\b/i,
        /\b(?:check|read|show|inspect|tell\s+me)\b[\s\S]{0,120}\b(?:my\s+)?(?:selected|bound|current)\s+(?:minecraft\s+)?player\b[\s\S]{0,100}\b(?:yaw|pitch|facing(?:\s+direction)?|view(?:\s+(?:direction|rotation))?|rotation)\b/i,
        /\b(?:check|read|show|inspect|tell\s+me|what(?:'s|\s+is))\b[\s\S]{0,70}\b(?:crimson\s+curse|infection)\b[\s\S]{0,40}\b(?:phase|mass|points?|state|status)\b/i,
        /\b(?:make|perform|run|take)\b[\s\S]{0,80}\b(?:fresh|current|post[-\s]?action)?\s*player[-\s]?status\s+check\b/i,
        /\b(?:verify|check|confirm|establish)\b[\s\S]{0,120}\b(?:my|the|current)\s+(?:minecraft\s+)?player\b[\s\S]{0,80}\b(?:alive|viable|surviving|safe)\b/i,
        /\b(?:fresh|current)(?:[-\s]game|\s+minecraft)?\s+evidence\b[\s\S]{0,120}\b(?:my|the|current)\s+(?:minecraft\s+)?player\b[\s\S]{0,80}\b(?:alive|viable|surviving|safe)\b/i,
        /\b(?:report|show|read|inspect|check|verify|tell\s+me)\b[\s\S]{0,100}\b(?:the\s+)?(?:current\s+)?actor(?:'?s)?\b[\s\S]{0,120}\b(?:identity|position|health|hearts?|status)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
      patterns: [
        /\b(?:what|which|list|show|check|inspect)\b[\s\S]{0,50}\b(?:mobs?|entities|players?|animals?)\b(?:\s+(?:are|is))?[\s\S]{0,12}\b(?:nearby|near\s+me|around\s+me|close\s+by)\b/i,
        /\b(?:nearby|near\s+me|around\s+me|close\s+by)\s+(?:hostile\s+)?(?:mobs?|entities|players?|animals?)\b/i,
        /\b(?:report|show|check|inspect|identify|find|tell\s+me)\b[\s\S]{0,180}\b(?:nearest|closest)\s+(?:hostile\s+)?(?:zombie|mob|entity)\b[\s\S]{0,120}\b(?:identity|distance|health|hearts?|status)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
      patterns: [
        /\bimmediate\s+(?:hazards?|threats?)\b[\s\S]{0,35}\b(?:now|right\s+now|current(?:ly)?)\b/i,
        /\b(?:am\s+i|is\s+the\s+player)\b[\s\S]{0,30}\b(?:safe|in\s+danger|threatened)\b/i,
        /\b(?:hostile\s+mobs?|monsters?|immediate\s+threats?|immediate\s+hazards?|hazards?)\b[\s\S]{0,35}\b(?:nearby|near\s+me|around\s+me|now|right\s+now|current(?:ly)?)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      patterns: [
        /\b(?:verify|recheck|check|inspect)\b[\s\S]{0,120}\b(?:minecraft\s+)?(?:blocks?|cells?|wall|structure|building|footprint|volume|region)\b[\s\S]{0,220}\b(?:structure[_\s-]?verification|exact(?:ly)?|all\s+(?:match|matches|matching|made\s+of)|mismatches?|from\s+x\s*[:=])\b/i,
        /\b(?:spatial[-\s]?region|block[-\s]?(?:region|volume))\s+(?:inspection|inspect|survey|scan|probe|read)\b/i,
        /\b(?:read|check|inspect|scan|survey|map|show|describe)\b[\s\S]{0,140}\b(?:nearby|local|surrounding)\s+(?:minecraft\s+)?blocks?\b/i,
        /\b(?:inspect|survey|scan|check|identify|find|locate|verify)\b[\s\S]{0,140}\b(?:minecraft|fabric)\b[\s\S]{0,160}\b(?:around|near(?:est|by)?)\b[\s\S]{0,120}\b(?:selected|bound|my|current)\s+(?:minecraft\s+)?player\b[\s\S]{0,180}\b(?:fireplace|hearth|ignition\s+cell)\b/i,
        /\b(?:inspect|survey|scan|map|check|describe)\b[\s\S]{0,60}\b(?:blocks?|block\s+region|local\s+geometry)\b[\s\S]{0,180}\b(?:structure|boundary|fireplace|hearth|wall|house|base|landing)\b/i,
        /\b(?:inspect|survey|scan|map|check)\b[\s\S]{0,80}\b(?:structure|building|house|base|wall|fireplace|hearth|landing\s+(?:area|site)|build\s+area)\b[\s\S]{0,80}\b(?:nearby|near\s+me|around\s+me|local|connected|current)\b/i,
        /\b(?:look\s+around|inspect|survey|scan|map|check|identify|find|locate|verify)\b[\s\S]{0,100}\b(?:bounded|radius|within\s+(?:\d+|\w+)\s+blocks?)\b[\s\S]{0,180}\b(?:structure|building|house|base|wall|fireplace|hearth|landing)\b/i,
        /\b(?:look\s+around|inspect|survey|scan|map|check|identify|find|locate|verify)\b[\s\S]{0,180}\b(?:structure|building|house|base|wall|fireplace|hearth|landing)\b[\s\S]{0,100}\b(?:bounded|radius|within\s+(?:\d+|\w+)\s+blocks?|nearby|near\s+me|around\s+me|local)\b/i,
        /\b(?:inspect|survey|scan|map|check|identify|find)\b[\s\S]{0,90}\b(?:area|site|region|terrain|ground)\b[\s\S]{0,120}\b(?:selected|bound|my|current)\s+(?:minecraft\s+)?player\b[\s\S]{0,180}\b(?:structure|boundary|wall|fireplace|hearth|landing|build(?:ing)?\s+site)\b/i,
        /\b(?:connected|live|current)\b[\s\S]{0,50}\bminecraft\b[\s\S]{0,140}\b(?:build|construct|surround|enclose|ignite|light|start|protect|rescue|break)\b[\s\S]{0,80}\b(?:wall|house|base|fireplace|hearth|fall|landing)\b/i,
        /\b(?:build|construct|surround|enclose|ignite|light|start|protect|rescue|break)\b[\s\S]{0,80}\b(?:wall|house|base|fireplace|hearth|fall|landing)\b[\s\S]{0,100}\b(?:connected|live|current)\b[\s\S]{0,50}\bminecraft\b/i,
        /\b(?:inspect|survey|scan|check)\b[\s\S]{0,100}\b(?:region|area|geometry)\b[\s\S]{0,180}\b(?:solid\s+(?:walkable\s+)?support|safe\s+headroom|air\s+clearance|nearby\s+(?:fire|drop|hazard)|fire\s+or\s+drop)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
      patterns: [
        /\b(?:use|using|query|read|list|inspect|show|report)\b[\s\S]{0,140}\b(?:minecraft|fabric|minehut|mine\s*hut|game)\b[\s\S]{0,140}\b(?:command\s+(?:tree|catalog|surface)|command\.catalog)\b/i,
        /\b(?:query|read|list|inspect|show|report)\b[\s\S]{0,100}\b(?:current|live|paired|connected)?\s*(?:server\s+)?command\s+(?:tree|catalog|surface)\b/i,
        /\b(?:connected|live|current)\b[\s\S]{0,50}\bminecraft\b[\s\S]{0,140}\b(?:build|construct|surround|enclose|ignite|light|start|protect|rescue|break)\b[\s\S]{0,80}\b(?:wall|house|base|fireplace|hearth|fall|landing)\b/i,
        /\b(?:build|construct|surround|enclose|ignite|light|start|protect|rescue|break)\b[\s\S]{0,80}\b(?:wall|house|base|fireplace|hearth|fall|landing)\b[\s\S]{0,100}\b(?:connected|live|current)\b[\s\S]{0,50}\bminecraft\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
      patterns: [
        /\b(?:check|inspect|show|describe|what(?:'s|\s+is))\b[\s\S]{0,50}\b(?:terrain|ground|floor|area|surroundings)\b[\s\S]{0,35}\b(?:nearby|near\s+me|around\s+me|local)\b/i,
        /\b(?:local\s+(?:map|terrain)|terrain|ground|floor|surroundings)\b[\s\S]{0,35}\b(?:nearby|near\s+me|around\s+me|current)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
      patterns: [
        /\b(?:check|do\s+i\s+have|is\s+there)\b[\s\S]{0,40}\b(?:line\s+of\s+sight|clear\s+(?:view|sight))\b/i,
        /\bcan\s+i\s+see\b[\s\S]{0,50}\b(?:position|block|target|coordinates?)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
      patterns: [
        /\b(?:check|inspect|is|are)\b[\s\S]{0,40}\b(?:crop|wheat|carrots?|potatoes?|beetroots?|nether\s+wart)\b[\s\S]{0,40}\b(?:mature|ready|fully\s+grown|harvestable)\b/i,
        /\b(?:crop|wheat|carrots?|potatoes?|beetroots?|nether\s+wart)\b[\s\S]{0,40}\b(?:mature|ready|fully\s+grown|harvestable)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
      patterns: [
        /\b(?:check|can\s+i|am\s+i)\b[\s\S]{0,90}\b(?:reach(?:ability)?|interact\s+with|within\s+range)\b/i,
        /\b(?:how\s+far|distance\s+to)\b[\s\S]{0,50}\b(?:position|block|target|coordinates?)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
      patterns: [
        /\b(?:inspect|read|check|show|list|tell\s+me)\b[\s\S]{0,90}\b(?:contents?|items?|what(?:'s|\s+is)\s+inside)\b[\s\S]{0,80}\b(?:closed\s+|unopened\s+)?(?:chest|barrel|container|shulker\s+box)\b/i,
        /\b(?:inspect|read|check|show|list|tell\s+me)\b[\s\S]{0,90}\b(?:closed\s+|unopened\s+)?(?:chest|barrel|container|shulker\s+box)\b[\s\S]{0,80}\b(?:contents?|items?|what(?:'s|\s+is)\s+inside|inside)\b/i,
      ],
    },
    {
      capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
      patterns: [
        BARE_MINECRAFT_SLASH_COMMAND_PROMPT,
        /\b(?:check|read|query|inspect|tell\s+me|what(?:'s|\s+is))\b(?=[\s\S]{0,280}\b(?:minecraft|fabric|minehut|mine\s*hut|paired|connected)\b)(?=[\s\S]{0,280}\b(?:current|live)\s+(?:minecraft\s+)?(?:daytime|time|weather|difficulty|game\s*rules?|world\s*border|tick(?:ing)?\s+state)\b)[\s\S]{0,280}/i,
        /\b(?:use|using|run|execute|issue|send|set|change)\b[\s\S]{0,100}\b(?:live\s+)?(?:minecraft|fabric|minehut|mine\s*hut|game)\b[\s\S]{0,100}\b(?:server\s+)?(?:command(?!\.catalog\b|\s+(?:tree|catalog)\b)(?:\s+(?:dispatcher|surface))?|dispatcher)\b/i,
        /\b(?:save|flush)\b[\s\S]{0,120}\b(?:connected\s+|live\s+)?(?:minecraft|fabric|minehut|mine\s*hut)\b[\s\S]{0,100}\b(?:server|world)\b[\s\S]{0,100}\b(?:using|with|via)\b[\s\S]{0,60}(?:\bcommand\b|\/save-all\b)/i,
      ],
    },
  ];
  const matches: Array<{
    capability: string;
    matched_text: string;
    match_index: number;
    match_end_index: number;
  }> = [];
  const orderedActorStatusMatches = playerEmbodimentPlane
    ? Array.from(
        prompt.matchAll(
          /\b(?:read|check|recheck|inspect|verify|show|obtain)\s+(?:a\s+)?(?:(?:fresh|current|final|post[-\s]?action)\s+)?actor[-\s]?status(?:\s+evidence)?(?:\s+again)?\b/giu,
        ),
      )
        .filter(
          (match): match is RegExpMatchArray & { index: number } =>
            typeof match.index === "number" && match[0].trim().length > 0,
        )
        .map((match) => ({
          capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
          matched_text: match[0],
          match_index: match.index,
          match_end_index: match.index + match[0].length,
        }))
    : [];
  const semanticAnchorPatterns = new Map<string, RegExp>([
    [
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
      /\b(?:walk|take|move|step|forward|backward|back|left|right)\b/iu,
    ],
    [HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY, /\bjump(?:s|ed|ing)?\b/iu],
    [
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
      /\b(?:health|hearts?|hunger|food\s+level|status|game\s+mode|position|yaw|pitch|facing(?:\s+direction)?|view(?:\s+(?:direction|rotation))?|rotation|crimson\s+curse|infection)\b/i,
    ],
    [
      HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
      /\b(?:registry|block|item|entity[-\s]?type|mob[-\s]?effect|[a-z0-9_.-]+:[a-z0-9_./-]+)\b/i,
    ],
    [
      HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
      /\b(?:recipes?|recipe\s+id|output|produce[sd]?|craft(?:s|ing)?|[a-z0-9_.-]+:[a-z0-9_./-]+)\b/i,
    ],
    [
      HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
      /\b(?:mobs?|entities|players?|animals?)\b/i,
    ],
    [
      HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
      /\b(?:safe|danger|threatened|hostile\s+mobs?|monsters?|immediate\s+threats?|hazards?)\b/i,
    ],
    [
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      /\b(?:blocks?|cells?|structure|building|house|base|wall|fireplace|hearth|fall|landing|build\s+area)\b/i,
    ],
    [
      HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
      /\b(?:local\s+(?:map|terrain)|terrain|ground|floor|area|surroundings)\b/i,
    ],
    [
      HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
      /\b(?:line\s+of\s+sight|clear\s+(?:view|sight)|see)\b/i,
    ],
    [
      HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
      /\b(?:crop|wheat|carrots?|potatoes?|beetroots?|nether\s+wart)\b/i,
    ],
    [
      HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
      /\b(?:reach(?:ability)?|interact\s+with|within\s+range|how\s+far|distance)\b/i,
    ],
    [
      HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
      /\b(?:contents?|items?|inside|chest|barrel|container|shulker\s+box)\b/i,
    ],
    [
      HELIX_MINECRAFT_COMMAND_CAPABILITY,
      /\b(?:minecraft|fabric|minehut|mine\s*hut|command|dispatcher)\b/i,
    ],
  ]);
  for (const specification of specifications) {
    if (
      specification.capability ===
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY &&
      orderedActorStatusMatches.length > 0
    ) {
      matches.push(...orderedActorStatusMatches);
      continue;
    }
    const patternMatch = specification.patterns
      .map((pattern) => prompt.match(pattern))
      .find((candidate): candidate is RegExpMatchArray =>
        Boolean(candidate && typeof candidate.index === "number"),
      );
    const directActionMatch =
      specification.capability === HELIX_MINECRAFT_COMMAND_CAPABILITY
        ? minecraftCommandActionMatch
        : specification.capability ===
              HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY &&
            structureAwareActionTarget
          ? minecraftCommandActionMatch
          : specification.capability ===
                HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY &&
              structureAwareActionTarget
            ? minecraftCommandActionMatch
            : null;
    if (!patternMatch && !directActionMatch) continue;
    const rawMatchedText =
      directActionMatch?.matched_text ?? patternMatch?.[0] ?? "";
    const rawMatchIndex =
      directActionMatch?.match_index ?? patternMatch?.index ?? -1;
    if (!rawMatchedText || rawMatchIndex < 0) continue;
    if (
      specification.capability === HELIX_MINECRAFT_COMMAND_CAPABILITY &&
      !directActionMatch
    ) {
      const commandSurface = rawMatchedText.match(
        /\b(?:command|dispatcher)\b/i,
      );
      if (
        commandSurface &&
        typeof commandSurface.index === "number" &&
        negatedCommandMentionsCapabilityAt(
          prompt,
          rawMatchIndex + commandSurface.index,
        )
      ) {
        continue;
      }
    }
    const semanticAnchor = rawMatchedText.match(
      semanticAnchorPatterns.get(specification.capability) ?? /[\s\S]+/,
    );
    const semanticOffset =
      semanticAnchor && typeof semanticAnchor.index === "number"
        ? semanticAnchor.index
        : 0;
    const matchedText = semanticAnchor?.[0] ?? rawMatchedText;
    const matchIndex = rawMatchIndex + semanticOffset;
    matches.push({
      capability: specification.capability,
      matched_text: matchedText,
      match_index: matchIndex,
      match_end_index: matchIndex + matchedText.length,
    });
  }
  return matches;
};

const readOnlyMinecraftProbeNoMutationConstraint = (input: {
  prompt: string;
  matchIndex: number;
  capability: string;
}): boolean => {
  if (
    input.capability === HELIX_MINECRAFT_COMMAND_CAPABILITY ||
    input.capability === HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY
  ) {
    return false;
  }
  const before = input.prompt.slice(
    Math.max(0, input.matchIndex - 220),
    input.matchIndex,
  );
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  if (
    /\bwithout\s+(?:changing|altering|modifying|mutating|placing|removing|breaking|executing|running)\b[\s\S]{0,100}\b(?:look\s+around|recheck|check|scan|inspect|survey|map|list|read|show|find|identify|locate|verify)\b/i.test(
      clausePrefix,
    )
  ) {
    return true;
  }

  const priorBoundary = Math.max(
    input.prompt.lastIndexOf(".", input.matchIndex - 1),
    input.prompt.lastIndexOf("!", input.matchIndex - 1),
    input.prompt.lastIndexOf("?", input.matchIndex - 1),
    input.prompt.lastIndexOf(";", input.matchIndex - 1),
    input.prompt.lastIndexOf("\n", input.matchIndex - 1),
  );
  const readIntentWindow = input.prompt.slice(
    priorBoundary + 1,
    Math.min(input.prompt.length, input.matchIndex + 80),
  );
  const hasAffirmativeReadIntent =
    /\b(?:report|show|read|inspect|check|verify|list|identify|find|tell\s+me)\b/i.test(
      readIntentWindow,
    );
  const negatesReadIntent =
    /\b(?:do\s+not|don't|dont|never|avoid|without)\b[\s\S]{0,80}\b(?:report|show|read|inspect|check|verify|list|identify|find|tell)\b/i.test(
      readIntentWindow,
    );
  const trailingConstraintWindow = input.prompt.slice(
    input.matchIndex,
    Math.min(input.prompt.length, input.matchIndex + 320),
  );
  const explicitlyForbidsMutationAfterRead =
    /\b(?:do\s+not|don't|dont|never)\b[\s\S]{0,80}\b(?:issue|execute|run|perform|start|use|cause)\b[\s\S]{0,140}\b(?:player\s+action|command|world\s+authority|mutation|workflow)\b/i.test(
      trailingConstraintWindow,
    );
  return (
    hasAffirmativeReadIntent &&
    !negatesReadIntent &&
    explicitlyForbidsMutationAfterRead
  );
};

const minecraftProbeMentionIsHistoricalAt = (
  prompt: string,
  matchIndex: number,
): boolean => {
  const before = prompt.slice(Math.max(0, matchIndex - 220), matchIndex);
  const clausePrefix = before.split(/[.!?;\n]/).pop() ?? before;
  return /\b(?:earlier|previously|historically|last\s+turn|before)\b[\s\S]{0,120}\b(?:asked|said|mentioned|reported|described|discussed)\b[\s\S]{0,80}\b(?:look\s+around|recheck|check|scan|inspect|survey|map|list|read|show|find|identify|locate|verify)\b[\s\S]{0,80}$/i.test(
    clausePrefix,
  );
};

export const explicitCapabilityContractForCapability = (
  capability: string | null | undefined,
): ExplicitCapabilityContract | null => {
  const normalized = String(capability ?? "").trim();
  if (!normalized) return null;
  return (
    explicitCapabilityContracts.find(
      (contract: ExplicitCapabilityContract) =>
        capabilityKeysMatch(contract.capability, normalized) ||
        capabilityKeysMatch(contract.runtime_capability, normalized) ||
        (contract.aliases ?? []).some((alias) =>
          capabilityKeysMatch(alias, normalized),
        ) ||
        contract.allowed_substitutions.some((substitution) =>
          capabilityKeysMatch(substitution, normalized),
        ),
    ) ?? null
  );
};

export const extractExplicitCapabilityContract = (
  promptText: string | null | undefined,
  context?: ExplicitCapabilityExtractionContext | null,
): ExplicitCapabilityContract | null => {
  return (
    extractExplicitCapabilityContracts(promptText, context)[0]?.contract ?? null
  );
};

const NON_EXECUTABLE_EXACT_MINECRAFT_COMMAND_PREFIX =
  /^(?:do\s+not|don't|dont|never|later\b|after(?:ward|wards)?\b|in\s+the\s+future\b|previously\b|earlier\b|the\s+(?:transcript|screen|message|document)\s+(?:says|said|shows|showed)|explain\b|describe\b|quote\b)/iu;

const quotedMinecraftCommandField = (prompt: string): string => {
  const match = prompt.match(
    /\bcommand\b\s*(?:[:=]\s*)?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|\x60([^\x60\r\n]+)\x60)/iu,
  );
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
};

/**
 * Reads a literal operator constraint without consulting capability extraction.
 * Keeping this predicate below the semantic planner prevents a structure-aware
 * helper expansion from erasing the user's explicit one-tool boundary.
 */
export const isExclusiveExplicitMinecraftCommandToolRequest = (
  promptText: string | null | undefined,
): boolean => {
  const prompt = String(promptText ?? "").trim();
  if (!prompt || NON_EXECUTABLE_EXACT_MINECRAFT_COMMAND_PREFIX.test(prompt)) {
    return false;
  }
  if (
    !prompt.includes(HELIX_MINECRAFT_COMMAND_CAPABILITY) ||
    !quotedMinecraftCommandField(prompt)
  ) {
    return false;
  }
  const affirmativeExactCommand =
    /\b(?:run|execute|issue|send|use)\s+exactly\s+one\s+(?:(?:live|minecraft|fabric|server)\s+){0,4}command\b/iu.test(
      prompt,
    ) ||
    new RegExp(
      String.raw`\b(?:run|execute|issue|send|use)\b[\s\S]{0,140}\b${HELIX_MINECRAFT_COMMAND_CAPABILITY.replace(/\./g, "\\.")}\b`,
      "iu",
    ).test(prompt);
  const excludesOtherTools =
    /\b(?:do\s+not|don't|dont|never)\s+(?:run|execute|use|call|invoke)\s+(?:any\s+)?(?:other|another)\s+(?:(?:command|capability)(?:s)?\s+(?:or|and)\s+)?(?:tool|capability)(?:s)?\b/iu.test(
      prompt,
    );
  return affirmativeExactCommand && excludesOtherTools;
};

export const extractExplicitCapabilityContracts = (
  promptText: string | null | undefined,
  context?: ExplicitCapabilityExtractionContext | null,
): ExtractedExplicitCapabilityContract[] => {
  const prompt = String(promptText ?? "").trim();
  if (!prompt) return [];
  const matches: ExtractedExplicitCapabilityContract[] = [];
  const capabilityCatalogContract = explicitCapabilityContractForCapability(
    "helix_ask.inspect_capability_catalog",
  );
  const capabilityCatalogMatchIndex =
    askCapabilityCatalogPromptMatchIndex(prompt);
  if (
    capabilityCatalogContract &&
    isAskCapabilityCatalogPrompt(prompt) &&
    !familySuppressed(prompt, capabilityCatalogContract)
  ) {
    matches.push({
      contract: capabilityCatalogContract,
      capability: capabilityCatalogContract.capability,
      matched_name: "capability_catalog_prompt",
      match_index: capabilityCatalogMatchIndex ?? 0,
      match_end_index: capabilityCatalogMatchIndex ?? 0,
      source: "capability_catalog_prompt",
    });
  }
  const minecraftMechanicsDocsContract =
    explicitCapabilityContractForCapability("docs-viewer.search_docs");
  const minecraftMechanicsDocsMatch = minecraftMechanicsDocsPromptMatch(prompt);
  if (
    minecraftMechanicsDocsContract &&
    minecraftMechanicsDocsMatch &&
    !negatedCommandMentionsCapabilityAt(
      prompt,
      minecraftMechanicsDocsMatch.match_index,
    ) &&
    !capabilityMentionIsNonExecutableContextAt(
      prompt,
      minecraftMechanicsDocsMatch.match_index,
    ) &&
    !familySuppressed(prompt, minecraftMechanicsDocsContract)
  ) {
    matches.push({
      contract: minecraftMechanicsDocsContract,
      capability: minecraftMechanicsDocsContract.capability,
      matched_name: minecraftMechanicsDocsMatch.matched_text,
      match_index: minecraftMechanicsDocsMatch.match_index,
      match_end_index: minecraftMechanicsDocsMatch.match_end_index,
      source: "natural_capability_intent",
    });
  }
  const durableGoalCreateContract = explicitCapabilityContractForCapability(
    HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
  );
  if (
    durableGoalCreateContract &&
    isAffirmativeMinecraftDurableGoalCreatePrompt(prompt) &&
    !familySuppressed(prompt, durableGoalCreateContract)
  ) {
    const match = prompt.match(
      /\b(?:start|create|begin|launch|establish|set\s+up)\b/i,
    );
    const matchIndex = match?.index ?? 0;
    matches.push({
      contract: durableGoalCreateContract,
      capability: durableGoalCreateContract.capability,
      matched_name: match?.[0] ?? "durable_minecraft_goal_create",
      match_index: matchIndex,
      match_end_index: matchIndex + (match?.[0]?.length ?? 0),
      source: "natural_capability_intent",
    });
  }
  const durableGoalInspectContract = explicitCapabilityContractForCapability(
    HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
  );
  if (
    durableGoalInspectContract &&
    isAffirmativeMinecraftDurableGoalInspectPrompt(prompt) &&
    !isAffirmativeEnvironmentReasoningRoleInspectPrompt(prompt) &&
    !familySuppressed(prompt, durableGoalInspectContract)
  ) {
    const match = prompt.match(
      /\b(?:resume|continue|inspect|read|check|reconstruct|recover|reopen|re-open)\b/i,
    );
    const matchIndex = match?.index ?? 0;
    matches.push({
      contract: durableGoalInspectContract,
      capability: durableGoalInspectContract.capability,
      matched_name: match?.[0] ?? "durable_minecraft_goal_inspect",
      match_index: matchIndex,
      match_end_index: matchIndex + (match?.[0]?.length ?? 0),
      source: "natural_capability_intent",
    });
  }
  const reasoningRoleInspectContract = explicitCapabilityContractForCapability(
    HELIX_ENVIRONMENT_REASONING_ROLE_INSPECT_CAPABILITY,
  );
  if (
    reasoningRoleInspectContract &&
    isAffirmativeEnvironmentReasoningRoleInspectPrompt(prompt) &&
    !familySuppressed(prompt, reasoningRoleInspectContract)
  ) {
    const match = prompt.match(/\b(?:inspect|read|check|reconstruct|report)\b/i);
    const matchIndex = match?.index ?? 0;
    matches.push({
      contract: reasoningRoleInspectContract,
      capability: reasoningRoleInspectContract.capability,
      matched_name: match?.[0] ?? "environment_reasoning_role_inspect",
      match_index: matchIndex,
      match_end_index: matchIndex + (match?.[0]?.length ?? 0),
      source: "natural_capability_intent",
    });
  }
  const durableGoalAppendContract = explicitCapabilityContractForCapability(
    HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
  );
  if (
    durableGoalAppendContract &&
    isAffirmativeMinecraftDurableGoalAppendPrompt(prompt) &&
    !familySuppressed(prompt, durableGoalAppendContract)
  ) {
    const match = prompt.match(
      /\b(?:record|append|save|persist|write|mark|complete|advance|update)\b/i,
    );
    const matchIndex = match?.index ?? 0;
    matches.push({
      contract: durableGoalAppendContract,
      capability: durableGoalAppendContract.capability,
      matched_name: match?.[0] ?? "durable_minecraft_goal_append",
      match_index: matchIndex,
      match_end_index: matchIndex + (match?.[0]?.length ?? 0),
      source: "natural_capability_intent",
    });
  }
  for (const minecraftSituationMatch of naturalMinecraftSituationProbePromptMatches(
    prompt,
    context,
  )) {
    const minecraftSituationContract = explicitCapabilityContractForCapability(
      minecraftSituationMatch.capability,
    );
    const negatedMinecraftProbe = negatedCommandMentionsCapabilityAt(
      prompt,
      minecraftSituationMatch.match_index,
    );
    if (
      !minecraftSituationContract ||
      (negatedMinecraftProbe &&
        !readOnlyMinecraftProbeNoMutationConstraint({
          prompt,
          matchIndex: minecraftSituationMatch.match_index,
          capability: minecraftSituationMatch.capability,
        })) ||
      capabilityMentionIsNonExecutableContextAt(
        prompt,
        minecraftSituationMatch.match_index,
      ) ||
      minecraftProbeMentionIsHistoricalAt(
        prompt,
        minecraftSituationMatch.match_index,
      ) ||
      capabilityMentionIsExplanatoryQuestionAt(
        prompt,
        minecraftSituationMatch.match_index,
      ) ||
      familySuppressed(prompt, minecraftSituationContract)
    ) {
      continue;
    }
    matches.push({
      contract: minecraftSituationContract,
      capability: minecraftSituationContract.capability,
      matched_name: minecraftSituationMatch.matched_text,
      match_index: minecraftSituationMatch.match_index,
      match_end_index: minecraftSituationMatch.match_end_index,
      source: "natural_capability_intent",
    });
  }
  const notesListContract = explicitCapabilityContractForCapability(
    "workstation-notes.list_notes",
  );
  const notesListMatch = naturalNotesListPromptMatch(prompt);
  if (
    notesListContract &&
    notesListMatch &&
    !negatedCommandMentionsCapabilityAt(prompt, notesListMatch.match_index) &&
    !capabilityMentionIsNonExecutableContextAt(
      prompt,
      notesListMatch.match_index,
    ) &&
    !familySuppressed(prompt, notesListContract)
  ) {
    matches.push({
      contract: notesListContract,
      capability: notesListContract.capability,
      matched_name: notesListMatch.matched_text,
      match_index: notesListMatch.match_index,
      match_end_index: notesListMatch.match_end_index,
      source: "natural_capability_intent",
    });
  }
  const minecraftInventoryContract = explicitCapabilityContractForCapability(
    "com.casimirbot.minecraft.inventory.check",
  );
  const minecraftInventoryMatch =
    naturalMinecraftInventoryProbePromptMatch(prompt);
  if (
    minecraftInventoryContract &&
    minecraftInventoryMatch &&
    (!negatedCommandMentionsCapabilityAt(
      prompt,
      minecraftInventoryMatch.match_index,
    ) ||
      readOnlyMinecraftProbeNoMutationConstraint({
        prompt,
        matchIndex: minecraftInventoryMatch.match_index,
        capability: minecraftInventoryContract.capability,
      })) &&
    !capabilityMentionIsNonExecutableContextAt(
      prompt,
      minecraftInventoryMatch.match_index,
    ) &&
    !capabilityMentionIsExplanatoryQuestionAt(
      prompt,
      minecraftInventoryMatch.match_index,
    ) &&
    !familySuppressed(prompt, minecraftInventoryContract)
  ) {
    matches.push({
      contract: minecraftInventoryContract,
      capability: minecraftInventoryContract.capability,
      matched_name: minecraftInventoryMatch.matched_text,
      match_index: minecraftInventoryMatch.match_index,
      match_end_index: minecraftInventoryMatch.match_end_index,
      source: "natural_capability_intent",
    });
  }
  const voiceDeliveryContract = explicitCapabilityContractForCapability(
    "text_to_speech.speak_text",
  );
  const voiceMatch = prompt.match(
    /\b(?:read|speak|say|play|narrat(?:e|or)|voice)\b[\s\S]{0,120}\b(?:aloud|out\s*loud|outload|to\s+me)\b/i,
  );
  if (
    voiceDeliveryContract &&
    voiceMatch &&
    typeof voiceMatch.index === "number" &&
    isAffirmativeReadAloudPrompt(prompt) &&
    !negatedCommandMentionsCapabilityAt(prompt, voiceMatch.index) &&
    !capabilityMentionIsNonExecutableContextAt(prompt, voiceMatch.index) &&
    !familySuppressed(prompt, voiceDeliveryContract)
  ) {
    matches.push({
      contract: voiceDeliveryContract,
      capability: voiceDeliveryContract.capability,
      matched_name: voiceMatch[0],
      match_index: voiceMatch.index,
      match_end_index: voiceMatch.index + voiceMatch[0].length,
      source: "natural_capability_intent",
    });
  }
  const theoryExperimentProcedureContract =
    explicitCapabilityContractForCapability(
      THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
    );
  const theoryExperimentProcedureMatch =
    theoryExperimentProcedurePromptMatch(prompt);
  if (theoryExperimentProcedureContract && theoryExperimentProcedureMatch) {
    matches.push({
      contract: theoryExperimentProcedureContract,
      capability: theoryExperimentProcedureContract.capability,
      matched_name: theoryExperimentProcedureMatch.matched_text,
      match_index: theoryExperimentProcedureMatch.match_index,
      match_end_index: theoryExperimentProcedureMatch.match_end_index,
      source: "command_mention",
    });
  }
  const theoryFormalArtifactInspectionContract =
    explicitCapabilityContractForCapability(
      THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
    );
  const theoryFormalArtifactInspectionMatch =
    theoryFormalArtifactInspectionPromptMatch(prompt);
  if (
    theoryFormalArtifactInspectionContract &&
    theoryFormalArtifactInspectionMatch
  ) {
    matches.push({
      contract: theoryFormalArtifactInspectionContract,
      capability: theoryFormalArtifactInspectionContract.capability,
      matched_name: theoryFormalArtifactInspectionMatch.matched_text,
      match_index: theoryFormalArtifactInspectionMatch.match_index,
      match_end_index: theoryFormalArtifactInspectionMatch.match_end_index,
      source: "natural_capability_intent",
    });
  }
  const theoryExecutionClosureContract =
    explicitCapabilityContractForCapability(
      THEORY_EXPERIMENT_PROCEDURE_EVALUATE_CLOSURE_CAPABILITY,
    );
  const theoryExecutionClosureMatch =
    theoryExecutionClosureCommandMatch(prompt);
  if (theoryExecutionClosureContract && theoryExecutionClosureMatch) {
    matches.push({
      contract: theoryExecutionClosureContract,
      capability: theoryExecutionClosureContract.capability,
      matched_name: theoryExecutionClosureMatch.matched_text,
      match_index: theoryExecutionClosureMatch.match_index,
      match_end_index: theoryExecutionClosureMatch.match_end_index,
      source: "command_mention",
    });
  }
  for (const contract of explicitCapabilityContracts) {
    if (familySuppressed(prompt, contract)) continue;
    const names = uniqueStrings([
      contract.capability,
      contract.runtime_capability ?? "",
      ...(contract.aliases ?? []),
    ]);
    for (const name of names) {
      const matcher = capabilityMentionRegex(name);
      for (const match of prompt.matchAll(matcher)) {
        const matchIndex = typeof match.index === "number" ? match.index : -1;
        if (matchIndex < 0) continue;
        if (capabilityMentionIsNonExecutableContextAt(prompt, matchIndex))
          continue;
        if (
          contract.capability !== "helix_ask.inspect_capability_catalog" &&
          capabilityMentionIsExplanatoryQuestionAt(prompt, matchIndex)
        )
          continue;
        const commandMention = commandMentionsCapabilityAt(
          prompt,
          name,
          matchIndex,
        );
        const compoundMention = compoundCommandChainMentionsCapabilityAt(
          prompt,
          matchIndex,
        );
        if (
          (commandMention || compoundMention) &&
          negatedCommandMentionsCapabilityAt(prompt, matchIndex)
        )
          continue;
        if (!commandMention && !compoundMention) continue;
        const candidate: ExtractedExplicitCapabilityContract = {
          contract,
          capability: contract.capability,
          matched_name: name,
          match_index: matchIndex,
          match_end_index: matchIndex + name.length,
          source: commandMention ? "command_mention" : "compound_command_chain",
        };
        matches.push(candidate);
      }
    }
  }
  const extractionMatches =
    isExclusiveExplicitMinecraftCommandToolRequest(prompt) &&
    matches.some(
      (match) => match.capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
    )
      ? matches.filter(
          (match) => match.capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
        )
      : matches;
  const seen = new Set<string>();
  const orderedMatches = extractionMatches
    .sort(
      (left, right) =>
        left.match_index - right.match_index ||
        right.match_end_index -
          right.match_index -
          (left.match_end_index - left.match_index),
    )
    .filter((match) => {
      const key = `${match.contract.capability}:${match.match_index}:${match.match_end_index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const clauseSeen = new Set<string>();
  const clauseDedupeMatches = orderedMatches.filter((match) => {
    const key = `${match.contract.capability}:${commandClauseOrdinal(prompt, match.match_index)}`;
    if (clauseSeen.has(key)) return false;
    clauseSeen.add(key);
    return true;
  });
  return clauseDedupeMatches.filter(
    (match, index, ordered) =>
      !ordered.some((other, otherIndex) => {
        if (otherIndex === index) return false;
        const distinctMinecraftSituationCapabilities =
          other.capability !== match.capability &&
          HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS.includes(
            other.capability as (typeof HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS)[number],
          ) &&
          HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS.includes(
            match.capability as (typeof HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS)[number],
          );
        if (distinctMinecraftSituationCapabilities) return false;
        const matchLength = Math.max(
          0,
          match.match_end_index - match.match_index,
        );
        const otherLength = Math.max(
          0,
          other.match_end_index - other.match_index,
        );
        return (
          other.match_index <= match.match_index &&
          other.match_end_index >= match.match_end_index &&
          otherLength > matchLength
        );
      }),
  );
};

/**
 * Returns only capability contracts that Helix may bind as deterministic
 * planner requirements. When the user selects Player Embodiment but expresses
 * an action that has no exact player-action contract, the semantic action stays
 * a separate runtime-owned requirement. Explicit read-only observations remain
 * in the itinerary—including repeated occurrences—so they cannot substitute
 * for the action or disappear from postcondition coverage. Codex still receives
 * the authorized player capability affordance set and chooses the concrete
 * action and arguments itself.
 */
export const extractPlannerBindingCapabilityContracts = (
  promptText: string | null | undefined,
  context?: ExplicitCapabilityExtractionContext | null,
): ExtractedExplicitCapabilityContract[] => {
  const matches = extractExplicitCapabilityContracts(promptText, context);
  const prompt = String(promptText ?? "").trim();
  if (!isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt)) {
    return matches;
  }
  const isPlayerActionMatch = (
    match: ExtractedExplicitCapabilityContract,
  ): boolean =>
    HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS.includes(
      match.capability as (typeof HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS)[number],
    );
  const hasOperatorNamedExactPlayerAction = matches.some(
    (match) =>
      isPlayerActionMatch(match) &&
      (match.source === "command_mention" ||
        match.source === "compound_command_chain"),
  );
  if (hasOperatorNamedExactPlayerAction) {
    return matches.filter(
      (match) =>
        !isPlayerActionMatch(match) ||
        match.source === "command_mention" ||
        match.source === "compound_command_chain",
    );
  }
  return matches.filter(
    (match) =>
      !isPlayerActionMatch(match) &&
      (HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS.includes(
        match.capability as (typeof HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS)[number],
      ) ||
        !match.capability.startsWith("com.casimirbot.minecraft.")),
  );
};

export const isAffirmativeNaturalMinecraftCommandCapabilityIntent = (
  promptText: string | null | undefined,
  context?: ExplicitCapabilityExtractionContext | null,
): boolean => {
  const prompt = String(promptText ?? "").trim();
  if (!prompt || BARE_MINECRAFT_SLASH_COMMAND_PROMPT.test(prompt)) return false;
  return extractExplicitCapabilityContracts(prompt, context).some(
    ({ capability, source }) =>
      source === "natural_capability_intent" &&
      capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
  );
};

export const isSchemaCompleteExplicitMinecraftCommandCapabilityIntent = (
  promptText: string | null | undefined,
  context?: ExplicitCapabilityExtractionContext | null,
): boolean => {
  const prompt = String(promptText ?? "").trim();
  if (NON_EXECUTABLE_EXACT_MINECRAFT_COMMAND_PREFIX.test(prompt)) {
    return false;
  }
  if (
    !isAffirmativeNaturalMinecraftCommandCapabilityIntent(prompt, context) ||
    !prompt.includes(HELIX_MINECRAFT_COMMAND_CAPABILITY)
  ) {
    return false;
  }
  const quotedField = (field: string): string => {
    const match = prompt.match(
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
  return (
    command.length > 0 &&
    [
      "query",
      "player_state",
      "player_inventory",
      "player_movement",
      "world_time_weather",
      "world_build",
      "entity_control",
      "server_administration",
      "mod_command",
    ].includes(category) &&
    [
      "read_only",
      "player_mutation",
      "world_mutation",
      "server_administration",
      "unknown",
    ].includes(effect)
  );
};

/**
 * Identifies an affirmative, self-contained Minecraft command request whose
 * operator explicitly forbids helper-tool expansion. The command gateway still
 * owns schema/risk validation; this predicate only prevents Helix from adding
 * mechanics lookup or provider-selected tools that the user excluded.
 */
export const isIsolatedExplicitMinecraftCommandCapabilityIntent = (
  promptText: string | null | undefined,
  context?: ExplicitCapabilityExtractionContext | null,
): boolean => {
  const prompt = String(promptText ?? "").trim();
  if (!isExclusiveExplicitMinecraftCommandToolRequest(prompt)) return false;
  return extractExplicitCapabilityContracts(prompt, context).some(
    ({ capability }) => capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
  );
};

export const explicitCapabilityMatches = (
  requestedCapability: string | null | undefined,
  actualCapability: string | null | undefined,
): boolean => {
  const requested = String(requestedCapability ?? "").trim();
  const actual = String(actualCapability ?? "").trim();
  if (!requested || !actual) return false;
  if (capabilityKeysMatch(requested, actual)) return true;
  const contract = explicitCapabilityContractForCapability(requested);
  return Boolean(
    capabilityKeysMatch(contract?.runtime_capability, actual) ||
    contract?.allowed_substitutions.some((substitution) =>
      capabilityKeysMatch(substitution, actual),
    ) ||
    contract?.aliases?.some((alias) => capabilityKeysMatch(alias, actual)),
  );
};

export const explicitCapabilityContractsForTests = explicitCapabilityContracts;
