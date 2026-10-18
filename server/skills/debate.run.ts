import { z } from "zod";
import {
  DebateAttachment,
  DebateConfig,
  DebateRoundMetrics,
  DEBATE_TOOL_NAME,
  WarpGroundingEvidence,
} from "@shared/essence-debate";
import type { ToolHandler, ToolSpecShape } from "@shared/skills";
import { startDebateAndWaitForOutcome } from "../services/debate/orchestrator";

const DebateRunInput = z.object({
  topic: z.string(),
  personaId: z.string(),
  context: z
    .object({
      resonance_patch: z.any().optional(),
      telemetry_summary: z.any().optional(),
      knowledge_hints: z.any().optional(),
      attachments: z.array(DebateAttachment).optional(),
      planner_prompt: z.string().optional(),
      warp_grounding: WarpGroundingEvidence.optional(),
    })
    .optional(),
  budgets: z
    .object({
      max_rounds: z.number().int().positive().optional(),
      max_wall_ms: z.number().int().positive().optional(),
      max_tool_calls: z.number().int().positive().optional(),
      satisfaction_threshold: z.number().min(0).max(1).optional(),
      min_improvement: z.number().min(0).max(1).optional(),
      stagnation_rounds: z.number().int().positive().optional(),
      novelty_epsilon: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

const DebateRunOutput = z.object({
  debateId: z.string(),
  verdict: z.string(),
  confidence: z.number(),
  key_turn_ids: z.array(z.string()),
  winning_role: z.enum(["proponent", "skeptic"]).optional(),
  stop_reason: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  rounds: z.number().int().nonnegative().optional(),
  metrics: DebateRoundMetrics.optional(),
});

export const debateRunSpec: ToolSpecShape = {
  name: DEBATE_TOOL_NAME,
  desc: "Starts a proponent/skeptic debate and waits for the referee verdict.",
  inputSchema: DebateRunInput,
  outputSchema: DebateRunOutput,
  deterministic: false,
  rateLimit: { rpm: 10 },
  safety: { risks: [] },
};

export const debateRunHandler: ToolHandler = async (rawInput) => {
  const input = DebateRunInput.parse(rawInput ?? {});
  const config = DebateConfig.parse({
    goal: input.topic,
    persona_id: input.personaId,
    max_rounds: input.budgets?.max_rounds,
    max_wall_ms: input.budgets?.max_wall_ms,
    max_tool_calls: input.budgets?.max_tool_calls,
    satisfaction_threshold: input.budgets?.satisfaction_threshold,
    min_improvement: input.budgets?.min_improvement,
    stagnation_rounds: input.budgets?.stagnation_rounds,
    novelty_epsilon: input.budgets?.novelty_epsilon,
    context: input.context,
  });
  const { debateId, outcome } = await startDebateAndWaitForOutcome(config);
  return {
    debateId,
    verdict: outcome?.verdict ?? "stalemate",
    confidence: outcome?.confidence ?? 0,
    key_turn_ids: outcome?.key_turn_ids ?? [],
    winning_role: outcome?.winning_role,
    stop_reason: outcome?.stop_reason,
    score: outcome?.score,
    rounds: outcome?.rounds,
    metrics: outcome?.metrics,
  };
};
