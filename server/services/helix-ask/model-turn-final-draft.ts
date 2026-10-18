import type { HelixModelTurnResult } from "./model-turn-executor";

type RecordLike = Record<string, unknown>;

export function applyModelTurnAssistantMessageAsFinalDraft(input: {
  turnId: string;
  payload: RecordLike;
  text: string;
  modelTurnResult: HelixModelTurnResult;
  outputBudget?: RecordLike;
}): RecordLike {
  const finalDraft = {
    schema: "helix.final_answer_draft.v1",
    kind: "final_answer_draft",
    artifact_id: `${input.turnId}:model_turn_final_answer_draft`,
    turn_id: input.turnId,
    text: input.text,
    answer_text: input.text,
    source: "model_turn",
    authority: "model_turn_assistant_message",
    model_step_capability: input.modelTurnResult.model_step_capability,
    output_budget: input.outputBudget,
    assistant_answer: false,
    raw_content_included: false,
  };
  input.payload.final_answer_draft = finalDraft;
  input.payload.output_budget = input.payload.output_budget ?? input.outputBudget;
  const ledger = Array.isArray(input.payload.current_turn_artifact_ledger)
    ? input.payload.current_turn_artifact_ledger
    : [];
  input.payload.current_turn_artifact_ledger = [
    ...ledger,
    {
      artifact_id: finalDraft.artifact_id,
      turn_id: input.turnId,
      kind: "final_answer_draft",
      payload: finalDraft,
    },
  ];
  return input.payload;
}
