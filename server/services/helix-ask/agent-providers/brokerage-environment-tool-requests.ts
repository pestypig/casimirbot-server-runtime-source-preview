import { HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY } from "@shared/helix-brokerage-environment";
import { classifyBrokerageEnvironmentReadIntent } from "../brokerage-environment-intent";
import { readPrompt } from "./explicit-tool-requests";

export const buildPromptDerivedBrokerageEnvironmentGatewayCallRequests = (
  body: Record<string, unknown>,
): Record<string, unknown>[] => {
  const prompt = readPrompt(body);
  const intent = prompt
    ? classifyBrokerageEnvironmentReadIntent(prompt)
    : null;
  if (!intent) return [];
  return [
    {
      schema:
        "helix.workstation_gateway.brokerage_environment_call_request.v1",
      derivation_source: "helix_brokerage_environment_read_intent",
      capability_id: HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
      mode: "read",
      arguments: {
        upstream_tool: intent.upstream_tool,
        upstream_arguments: intent.upstream_arguments,
        source_target_intent: {
          source: "helix_brokerage_environment_read_intent",
          target_source: "live_environment",
          target_kind: "brokerage_environment_observation",
          environment_domain: "brokerage",
          provider: intent.provider,
          evidence_kind: intent.evidence_kind,
          selected_capability: HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    },
  ];
};
