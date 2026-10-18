import type { HelixCommittedAskRoute } from "@shared/helix-committed-ask-route";
import {
  buildCommittedAskRoute,
  inferCommittedRouteToolFamily,
  readCommittedAskRoute,
} from "./committed-ask-route";

type RecordLike = Record<string, unknown>;

export type HelixModelTurnPacket = {
  schema: "helix.model_turn_packet.v1";
  turn_id: string;
  prompt_text: string;
  route_reason_code?: string;
  canonical_goal_frame?: RecordLike;
  source_target_intent?: RecordLike;
  route_product_contract?: RecordLike;
  committed_ask_route?: HelixCommittedAskRoute;
  compound_prompt_contract?: RecordLike;
  capability_itinerary?: RecordLike;
  available_capabilities: unknown[];
  artifact_refs: string[];
  model_visible_artifacts: Array<{
    artifact_id: string;
    kind: string;
    summary?: string;
    text?: string;
  }>;
  output_budget?: RecordLike;
  loop_policy: {
    max_model_steps: number;
    allow_tools: boolean;
    require_model_authored_terminal: boolean;
    deterministic_fallback_terminal_allowed: boolean;
  };
  assistant_answer: false;
  raw_content_included: false;
};

const readRecord = (value: unknown): RecordLike | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const clip = (value: string | undefined, max = 1200): string | undefined => {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

const artifactPayloadByKind = (
  artifactLedger: Array<RecordLike>,
  kind: string,
): RecordLike | undefined => {
  const artifact = artifactLedger.find((entry) => {
    const payload = readRecord(entry.payload);
    return readString(entry.kind) === kind || readString(payload?.kind) === kind;
  });
  return readRecord(artifact?.payload);
};

const capabilityAllowsToolUse = (capability: unknown): boolean => {
  const record = readRecord(capability);
  if (!record) return false;
  if (readBoolean(record.requires_action) !== true) return false;
  if (readString(record.goal_fit) === "forbidden") return false;
  if (readString(record.availability) === "not_available") return false;
  return true;
};

const capabilityKey = (capability: unknown): string => {
  const record = readRecord(capability);
  return readString(record?.capability_key) ?? readString(record?.capability_id) ?? readString(record?.model_visible_name) ?? "";
};

const capabilityAllowedByCommittedRoute = (
  capability: unknown,
  committedRoute: HelixCommittedAskRoute | null,
): boolean => {
  if (!committedRoute) return true;
  const key = capabilityKey(capability);
  if (!key) return true;
  const family = inferCommittedRouteToolFamily(key);
  if (committedRoute.capability_policy.suppressed_tool_families.includes(family)) return false;
  if (readBoolean(readRecord(capability)?.requires_action) !== true) return true;
  if (committedRoute.capability_policy.allowed_tool_families.length === 0) return false;
  if (family === "unknown" || family === "model_only") return true;
  return committedRoute.capability_policy.allowed_tool_families.includes(family);
};

export function buildHelixModelTurnPacket(input: {
  turnId: string;
  promptText: string;
  payload: RecordLike;
  artifactLedger: Array<RecordLike>;
  availableCapabilities?: unknown[];
  outputBudget?: RecordLike;
}): HelixModelTurnPacket {
  const trace = readRecord(input.payload.ask_turn_solver_trace);
  const capabilityItinerary =
    readRecord(input.payload.capability_itinerary) ??
    artifactPayloadByKind(input.artifactLedger, "capability_itinerary");
  const compoundPromptContract =
    readRecord(input.payload.compound_prompt_contract) ??
    readRecord(capabilityItinerary?.compound_prompt_contract) ??
    readRecord(readRecord(input.payload.prompt_interpretation)?.compound_contract) ??
    readRecord(trace?.compound_prompt_contract);
  const modelVisibleArtifacts = input.artifactLedger
    .map((artifact) => {
      const payload = readRecord(artifact.payload);
      const artifactId = readString(artifact.artifact_id) ?? readString(payload?.artifact_id);
      const kind = readString(artifact.kind) ?? readString(payload?.kind);
      if (!artifactId || !kind) return null;
      return {
        artifact_id: artifactId,
        kind,
        summary: clip(readString(payload?.summary) ?? readString(payload?.reason) ?? readString(payload?.message), 600),
        text: clip(
          readString(payload?.text) ??
            readString(payload?.answer_text) ??
            readString(payload?.visible_text) ??
            readString(payload?.fallback_text),
          1200,
        ),
      };
    })
    .filter((entry): entry is HelixModelTurnPacket["model_visible_artifacts"][number] => Boolean(entry))
    .slice(-16);
  const artifactRefs = modelVisibleArtifacts.map((artifact) => artifact.artifact_id);
  const sourceTargetIntent = readRecord(input.payload.source_target_intent);
  const committedAskRoute =
    readCommittedAskRoute(input.payload) ??
    buildCommittedAskRoute({
      turnId: input.turnId,
      promptText: input.promptText,
      selectedRoute: readString(input.payload.route_reason_code) ?? readString(input.payload.route) ?? "unknown",
      payload: input.payload,
    });
  const availableCapabilities = (input.availableCapabilities ?? []).filter((capability) =>
    capabilityAllowedByCommittedRoute(capability, committedAskRoute),
  );
  const sourceTargetAllowsToolUse =
    committedAskRoute.capability_policy.allowed_tool_families.length > 0 ||
    sourceTargetIntent?.must_enter_backend_ask === true ||
    sourceTargetIntent?.allow_no_tool_direct === false ||
    (readString(sourceTargetIntent?.target_source) !== undefined &&
      readString(sourceTargetIntent?.target_source) !== "model_only");
  const hasAvailableToolCapability = availableCapabilities.some(capabilityAllowsToolUse);
  return {
    schema: "helix.model_turn_packet.v1",
    turn_id: input.turnId,
    prompt_text: input.promptText,
    route_reason_code: readString(input.payload.route_reason_code) ?? readString(input.payload.route),
    canonical_goal_frame: readRecord(input.payload.canonical_goal_frame),
    source_target_intent: sourceTargetIntent,
    route_product_contract: readRecord(input.payload.route_product_contract),
    committed_ask_route: committedAskRoute,
    compound_prompt_contract: compoundPromptContract,
    capability_itinerary: capabilityItinerary,
    available_capabilities: availableCapabilities,
    artifact_refs: artifactRefs,
    model_visible_artifacts: modelVisibleArtifacts,
    output_budget: input.outputBudget,
    loop_policy: {
      max_model_steps: 2,
      allow_tools: hasAvailableToolCapability || sourceTargetAllowsToolUse,
      require_model_authored_terminal: true,
      deterministic_fallback_terminal_allowed: false,
    },
    assistant_answer: false,
    raw_content_included: false,
  };
}
