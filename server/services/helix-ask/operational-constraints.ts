import {
  HELIX_OPERATIONAL_CAPABILITY_TRACE_SCHEMA,
  HELIX_OPERATIONAL_SATISFACTION_EVALUATION_SCHEMA,
  HELIX_TURN_OPERATIONAL_CONSTRAINTS_SCHEMA,
  type HelixOperationalCapabilityTrace,
  type HelixOperationalConstraintPacket,
  type HelixOperationalSatisfactionEvaluation,
} from "@shared/helix-operational-constraints";
import { HELIX_MINECRAFT_COMMAND_CAPABILITY } from "@shared/helix-environment-command";
import { isExclusiveExplicitMinecraftCommandToolRequest } from "./explicit-capability-contract";

type RecordLike = Record<string, unknown>;

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const unique = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const compact = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const capabilityFromPlan = (plan: RecordLike | null): string | null => {
  const family = readString(plan?.capability_family);
  const action = readString(plan?.requested_action);
  if (!family && !action) return null;
  if (action && /\./.test(action)) return action;
  return unique([family, action]).join(":") || null;
};

const modelCapability = (decision: RecordLike | null): string | null =>
  readString(readRecord(decision?.model_decision)?.chosen_capability) ||
  readString(decision?.chosen_capability) ||
  null;

const lastRuntimeCapability = (loop: RecordLike | null): string | null => {
  const iterations = Array.isArray(loop?.iterations) ? loop.iterations.map(readRecord).filter(Boolean) : [];
  for (const iteration of [...iterations].reverse()) {
    const executed = readString(iteration?.executed_action_key);
    const chosen = readString(iteration?.chosen_capability);
    if (executed) return executed;
    if (chosen) return chosen;
  }
  return null;
};

const hasNegativeImageToolConstraint = (text: string): boolean =>
  /\b(?:do\s+not|don't|never|without)\b[^.!?;\n]{0,90}\b(?:gpt[-\s]*image\s*2|gpt\s*image\s*2|image\s+generation|image\s+tool|image\s+model|generate\s+images?)\b/i.test(text);

const hasNegativeRepoCodeToolConstraint = (text: string): boolean =>
  /\b(?:do\s+not|don't|dont|never|without|no)\b[^.!?;\n]{0,120}\b(?:repo[-\s]?code|repo\s+search|repository\s+code|code\s+search|source\s+code|repo)\b/i.test(text);

const hasNegativeInternetSearchToolConstraint = (text: string): boolean =>
  /\b(?:do\s+not|don't|dont|never|without|no)\b[^.!?;\n]{0,120}\b(?:internet\s+search|web\s+search|internet|web|browse|browsing|google|bing|search\s+online|check\s+online)\b/i.test(text);

const detectForbiddenTools = (promptText: string, negativeConstraints: string[]): {
  forbiddenTools: string[];
  forbiddenFamilies: string[];
} => {
  const text = [promptText, ...negativeConstraints].join("\n");
  const forbiddenTools: string[] = [];
  const forbiddenFamilies: string[] = [];
  if (hasNegativeImageToolConstraint(text)) {
    if (/\bgpt[-\s]*image\s*2\b/i.test(text) || /\bgpt\s*image\s*2\b/i.test(text)) {
      forbiddenTools.push("gpt-image-2");
    }
    forbiddenFamilies.push("image_generation");
  }
  if (hasNegativeRepoCodeToolConstraint(text)) {
    forbiddenFamilies.push("repo_code");
  }
  if (hasNegativeInternetSearchToolConstraint(text)) {
    forbiddenFamilies.push("internet_search");
  }
  return {
    forbiddenTools: unique(forbiddenTools),
    forbiddenFamilies: unique(forbiddenFamilies),
  };
};

const detectRequestedSurface = (promptText: string): {
  requestedSurface: string | null;
  requiredSurface: string | null;
  allowedFallbackSurfaces: string[];
  fallbackPolicy: HelixOperationalConstraintPacket["fallback_equivalence_policy"];
} => {
  const text = compact(promptText);
  const mentionsLocalhost5050 = /\b(?:localhost|local host|127\.0\.0\.1)\s*:?\s*5050\b/.test(text);
  const mentionsChromeExtension = /\bchrome\b/.test(text) && /\b(?:extension|codex extension|tab)\b/.test(text);
  const mentionsInAppBrowser = /\b(?:in app browser|in-app browser|codex browser|codex in-app)\b/.test(text);
  const mentionsBackendApi = /\b(?:backend|api|debug export|server probe)\b/.test(text);

  let requestedSurface: string | null = null;
  if (mentionsChromeExtension && mentionsLocalhost5050) {
    requestedSurface = "chrome_extension_localhost_5050_tab";
  } else if (mentionsChromeExtension) {
    requestedSurface = "chrome_extension";
  } else if (mentionsInAppBrowser) {
    requestedSurface = "codex_in_app_browser";
  } else if (mentionsBackendApi) {
    requestedSurface = "backend_api";
  }

  const requiredSurface =
    requestedSurface && /\b(?:through|with|using|use|from|in|activate|open|conduct)\b[\s\S]{0,140}\b(?:chrome|extension|localhost|local host|in app browser|in-app browser|backend|api)\b/i.test(promptText)
      ? requestedSurface
      : null;

  return {
    requestedSurface,
    requiredSurface,
    allowedFallbackSurfaces: requiredSurface ? ["backend_api_probe", "codex_in_app_browser"] : [],
    fallbackPolicy: requiredSurface ? "diagnostic_only" : "not_applicable",
  };
};

const detectLocalTermBindings = (promptText: string): HelixOperationalConstraintPacket["local_term_bindings"] => {
  const bindings: HelixOperationalConstraintPacket["local_term_bindings"] = [];
  if (
    /\bvisual capture\b/i.test(promptText) &&
    /\b(?:helix|ask|tab|capture a tab|tab capture|chrome tab)\b/i.test(promptText)
  ) {
    bindings.push({
      term: "visual capture",
      meaning: "helix_tab_capture",
      reason: "user_bound_visual_capture_to_helix_tab_capture_not_image_generation",
    });
  }
  return bindings;
};

export const buildTurnOperationalConstraints = (input: {
  turnId: string;
  promptText: string;
  promptInterpretation?: RecordLike | null;
}): HelixOperationalConstraintPacket => {
  const interpretation = readRecord(input.promptInterpretation);
  const negativeConstraints = readStringArray(interpretation?.negative_constraints);
  const forbidden = detectForbiddenTools(input.promptText, negativeConstraints);
  const surface = detectRequestedSurface(input.promptText);
  const localTermBindings = detectLocalTermBindings(input.promptText);
  const exclusiveMinecraftCommand =
    isExclusiveExplicitMinecraftCommandToolRequest(input.promptText);
  const exclusiveToolCapabilities = exclusiveMinecraftCommand
    ? [HELIX_MINECRAFT_COMMAND_CAPABILITY]
    : [];
  const requestedToolCardinality = exclusiveMinecraftCommand ? 1 : null;
  const operatorConstraints = unique([
    ...negativeConstraints,
    ...forbidden.forbiddenTools.map((tool) => `forbidden_tool:${tool}`),
    ...forbidden.forbiddenFamilies.map((family) => `forbidden_tool_family:${family}`),
    ...(surface.requiredSurface ? [`required_surface:${surface.requiredSurface}`] : []),
    ...localTermBindings.map((binding) => `local_term:${binding.term}=${binding.meaning}`),
    ...exclusiveToolCapabilities.map(
      (capability) => `exclusive_tool_capability:${capability}`,
    ),
    ...(requestedToolCardinality !== null
      ? [`requested_tool_cardinality:${requestedToolCardinality}`]
      : []),
  ]);

  return {
    schema: HELIX_TURN_OPERATIONAL_CONSTRAINTS_SCHEMA,
    turn_id: input.turnId,
    requested_surface: surface.requestedSurface,
    required_surface: surface.requiredSurface,
    forbidden_tools: forbidden.forbiddenTools,
    forbidden_tool_families: forbidden.forbiddenFamilies,
    exclusive_tool_capabilities: exclusiveToolCapabilities,
    requested_tool_cardinality: requestedToolCardinality,
    allowed_fallback_surfaces: surface.allowedFallbackSurfaces,
    fallback_equivalence_policy: surface.fallbackPolicy,
    local_term_bindings: localTermBindings,
    operator_constraints: operatorConstraints,
    surface_satisfaction_required: Boolean(surface.requiredSurface),
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const buildOperationalCapabilityTrace = (input: {
  turnId: string;
  payload: RecordLike;
}): HelixOperationalCapabilityTrace => {
  const plan = readRecord(input.payload.capability_plan);
  const loop = readRecord(input.payload.agent_runtime_loop);
  const decision = readRecord(input.payload.agent_step_decision) ?? readRecord(input.payload.initial_agent_step_decision);
  const constraints = readRecord(input.payload.turn_operational_constraints);
  const modelProposed = modelCapability(decision);
  const planCapability = capabilityFromPlan(plan);
  const executed = (lastRuntimeCapability(loop) ?? readString(readRecord(input.payload.runtime_tool_call)?.capability_key)) || null;
  const planRejected = readString(plan?.admission_status) === "rejected";
  const rejectedCapability = planRejected && planCapability
    ? {
        capability: planCapability,
        reason: readString(plan?.rejection_reason) || "capability_plan_rejected",
      }
    : null;
  const fallbackCapability =
    executed && (
      (modelProposed && executed !== modelProposed) ||
      (planCapability && executed !== planCapability && planRejected)
    )
      ? executed
      : null;
  const requiresSurface = readString(constraints?.required_surface);
  const fallbackAuthorityScope =
    fallbackCapability
      ? requiresSurface
        ? "diagnostic_only"
        : "terminal_equivalent"
      : "not_used";
  const policyAdmittedCapability =
    executed ??
    (!planRejected ? planCapability : null);

  return {
    schema: HELIX_OPERATIONAL_CAPABILITY_TRACE_SCHEMA,
    turn_id: input.turnId,
    model_proposed_capability: modelProposed,
    policy_admitted_capability: policyAdmittedCapability,
    executed_capability: executed,
    rejected_capability: rejectedCapability,
    fallback_capability: fallbackCapability,
    fallback_authority_scope: fallbackAuthorityScope,
    assistant_answer: false,
    raw_content_included: false,
  };
};

const surfaceForCapability = (capability: string | null): string | null => {
  if (!capability) return null;
  if (/chrome_extension/i.test(capability)) return "chrome_extension";
  if (/workspace[_-]?os|workspace_diagnostic/i.test(capability)) return "workspace_os_status";
  if (/repo-code|repo_code|repo_evidence/i.test(capability)) return "repo_code_evidence";
  if (/docs-viewer|docs_viewer|docs:/i.test(capability)) return "docs_viewer";
  if (/situation-room|situation_run|visual_capture|visual/i.test(capability)) return "helix_tab_capture";
  if (/live_env|live_environment/i.test(capability)) return "live_environment";
  if (/workstation|workspace_action|notes/i.test(capability)) return "workstation_panel";
  if (/backend|debug_export|runtime_evidence/i.test(capability)) return "backend_api";
  return null;
};

const forbiddenToolMentionedInCapability = (forbiddenTools: string[], forbiddenFamilies: string[], capability: string | null): boolean => {
  if (!capability) return false;
  const normalizedCapability = compact(capability).replace(/_/g, "-");
  return forbiddenTools.some((tool) => normalizedCapability.includes(compact(tool).replace(/_/g, "-"))) ||
    forbiddenFamilies.some((family) => normalizedCapability.includes(compact(family).replace(/_/g, "-")));
};

export const buildOperationalSatisfactionEvaluation = (input: {
  turnId: string;
  payload: RecordLike;
}): HelixOperationalSatisfactionEvaluation => {
  const constraints = readRecord(input.payload.turn_operational_constraints);
  const trace = readRecord(input.payload.operational_capability_trace);
  const requiredSurface = readString(constraints?.required_surface) || null;
  const requestedSurface = readString(constraints?.requested_surface) || null;
  const executedCapability = readString(trace?.executed_capability) || null;
  const fallbackUsed = Boolean(readString(trace?.fallback_capability));
  const fallbackEquivalent = fallbackUsed && readString(trace?.fallback_authority_scope) === "terminal_equivalent";
  const executedSurface = surfaceForCapability(executedCapability);
  const requestedSurfaceSatisfied =
    !requiredSurface ||
    requiredSurface === executedSurface ||
    (requiredSurface === "chrome_extension_localhost_5050_tab" && executedSurface === "chrome_extension");
  const forbiddenTools = readStringArray(constraints?.forbidden_tools);
  const forbiddenFamilies = readStringArray(constraints?.forbidden_tool_families);
  const forbiddenToolAvoided = ![
    readString(trace?.model_proposed_capability) || null,
    executedCapability,
    readString(trace?.policy_admitted_capability) || null,
  ].some((capability) => forbiddenToolMentionedInCapability(forbiddenTools, forbiddenFamilies, capability));
  const remainingSurfaceBlocker =
    requestedSurfaceSatisfied
      ? null
      : `required_surface_not_satisfied:${requiredSurface}`;
  const nextDecision =
    !forbiddenToolAvoided
      ? "fail_closed"
      : remainingSurfaceBlocker && !fallbackEquivalent
        ? "continue"
        : "allow_terminal";

  return {
    schema: HELIX_OPERATIONAL_SATISFACTION_EVALUATION_SCHEMA,
    turn_id: input.turnId,
    requested_surface: requestedSurface,
    required_surface: requiredSurface,
    executed_surface: executedSurface,
    requested_surface_satisfied: requestedSurfaceSatisfied,
    forbidden_tool_avoided: forbiddenToolAvoided,
    fallback_used: fallbackUsed,
    fallback_equivalent: fallbackEquivalent,
    remaining_surface_blocker: remainingSurfaceBlocker,
    next_decision: nextDecision,
    evidence_refs: unique([
      input.payload.turn_operational_constraints ? `${input.turnId}:turn_operational_constraints` : "",
      input.payload.operational_capability_trace ? `${input.turnId}:operational_capability_trace` : "",
      input.payload.capability_plan ? `${input.turnId}:capability_plan` : "",
      input.payload.agent_runtime_loop ? `${input.turnId}:agent_runtime_loop` : "",
    ]),
    assistant_answer: false,
    raw_content_included: false,
  };
};

export const refreshOperationalConstraintRecords = (input: {
  turnId: string;
  promptText: string;
  payload: RecordLike;
}): void => {
  input.payload.turn_operational_constraints =
    readRecord(input.payload.turn_operational_constraints) ??
    buildTurnOperationalConstraints({
      turnId: input.turnId,
      promptText: input.promptText,
      promptInterpretation: readRecord(input.payload.prompt_interpretation),
    });
  input.payload.operational_capability_trace = buildOperationalCapabilityTrace({
    turnId: input.turnId,
    payload: input.payload,
  });
  input.payload.operational_satisfaction_evaluation = buildOperationalSatisfactionEvaluation({
    turnId: input.turnId,
    payload: input.payload,
  });
  const debug = readRecord(input.payload.debug);
  if (debug) {
    debug.turn_operational_constraints = input.payload.turn_operational_constraints;
    debug.operational_capability_trace = input.payload.operational_capability_trace;
    debug.operational_satisfaction_evaluation = input.payload.operational_satisfaction_evaluation;
  }
};
