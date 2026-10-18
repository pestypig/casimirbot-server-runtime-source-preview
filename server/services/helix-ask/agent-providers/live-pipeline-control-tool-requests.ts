import { interpretHelixAskPrompt } from "../prompt-interpretation";
import {
  readArray,
  readPrompt,
  readRecord,
  readString,
} from "./explicit-tool-requests";

export const LIVE_PIPELINE_SET_RATE_CAPABILITY =
  "situation-room.live-source.set_rate" as const;

const readPromptInterpretation = (
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const direct = readRecord(
    body.prompt_interpretation ?? body.promptInterpretation,
  );
  if (direct) return direct;
  const solverTrace = readRecord(
    body.ask_turn_solver_trace ?? body.askTurnSolverTrace,
  );
  const traced = readRecord(
    solverTrace?.prompt_interpretation ?? solverTrace?.promptInterpretation,
  );
  if (traced) return traced;
  const debug = readRecord(body.debug);
  const debugTrace = readRecord(
    debug?.ask_turn_solver_trace ?? debug?.askTurnSolverTrace,
  );
  const debugInterpretation = readRecord(
    debugTrace?.prompt_interpretation ?? debugTrace?.promptInterpretation,
  );
  if (debugInterpretation) return debugInterpretation;
  const prompt = readPrompt(body);
  return prompt ? interpretHelixAskPrompt(prompt) : {};
};

const cadenceMsFromCommand = (commandText: string): number | null => {
  const secondsMatch = commandText.match(
    /\b(\d{1,3})\s*(?:seconds?|secs?|s)\b/i,
  );
  const everyMatch = commandText.match(/\bevery\s+(\d{1,3})\b/i);
  const seconds = Number(secondsMatch?.[1] ?? everyMatch?.[1]);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1_000)
    : null;
};

/**
 * Converts only an already-admitted structured operator command into a
 * concrete Codex workstation-gateway request. This is argument extraction,
 * not a second lexical admission path.
 */
export const buildPromptDerivedLivePipelineControlGatewayCallRequests = (
  body: Record<string, unknown>,
): Record<string, unknown>[] => {
  const interpretation = readPromptInterpretation(body);
  const command = readArray(interpretation.executable_operator_commands)
    .map(readRecord)
    .find(
      (entry) =>
        readString(entry?.action_family ?? entry?.actionFamily) ===
        "live_pipeline.set_rate",
    );
  if (!command) return [];
  const cadenceMs = cadenceMsFromCommand(readString(command.text) ?? "");
  if (!cadenceMs) return [];
  const sourceTargetIntent =
    readRecord(body.source_target_intent ?? body.sourceTargetIntent) ?? {};
  return [
    {
      schema:
        "helix.workstation_gateway.prompt_derived_live_pipeline_control_call_request.v1",
      derivation_source: "helix_structured_executable_operator_command",
      capability_id: LIVE_PIPELINE_SET_RATE_CAPABILITY,
      mode: "act",
      arguments: {
        cadence_ms: cadenceMs,
        capture_mode: "interval",
        source_target_intent: {
          ...sourceTargetIntent,
          source: "helix_structured_executable_operator_command",
          target_source: "live_pipeline",
          target_kind: "live_pipeline",
          selected_capability: LIVE_PIPELINE_SET_RATE_CAPABILITY,
          operator_command_family: "live_pipeline.set_rate",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    },
  ];
};
