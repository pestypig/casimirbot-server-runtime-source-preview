import type { TDebateContext, TDebateRoundMetrics, TWarpGroundingEvidence } from "@shared/essence-debate";
import { formatWarpEvidenceBlock } from "./warpPromptHelpers";

export type DebatePromptTurn = {
  role: "proponent" | "skeptic" | "referee";
  round: number;
  text: string;
};

export type DebatePromptOptions = {
  role: DebatePromptTurn["role"];
  goal: string;
  round: number;
  turns: DebatePromptTurn[];
  scoreboard: { proponent: number; skeptic: number };
  context?: TDebateContext;
  verifierResults?: Array<{ name: string; ok: boolean; reason?: string }>;
  metrics?: TDebateRoundMetrics;
};

const normalizeStatus = (grounding?: TWarpGroundingEvidence): string | undefined => {
  if (!grounding) return undefined;
  return grounding.status ?? undefined;
};

const renderWarpGuardrail = (grounding: TWarpGroundingEvidence | undefined, role: DebatePromptTurn["role"]): string | null => {
  const status = normalizeStatus(grounding);
  if (!status) return null;
  const failing =
    grounding?.constraints?.find((c) => c?.passed === false && c.severity === "HARD") ??
    grounding?.constraints?.find((c) => c?.passed === false);
  const hash = grounding?.certificateHash ? ` hash=${grounding.certificateHash}` : "";
  if (role === "proponent") {
    return `Treat certificate status=${status}${hash}; only assert viability if status=ADMISSIBLE and all HARD constraints pass${
      failing ? ` (currently failing ${failing.id ?? "constraint"})` : ""
    }.`;
  }
  if (role === "skeptic") {
    return `Audit status=${status}${hash}; prioritize any failing or marginal constraints${
      failing ? ` starting with ${failing.id ?? "constraint"}` : ""
    } and avoid inventing failures not present.`;
  }
  return `Referee: judge against status=${status}${hash} and whether each agent respected HARD constraints${
    failing ? `, especially ${failing.id ?? "constraint"}` : ""
  }.`;
};

const formatAttachmentList = (context?: TDebateContext): string | null => {
  const attachments = context?.attachments ?? [];
  if (!attachments.length) return null;
  const lines = attachments.slice(0, 4).map((att, idx) => `  - [${idx + 1}] ${att.title} (${att.url})`);
  return ["Attachments:", ...lines].join("\n");
};

const formatTelemetry = (context?: TDebateContext): string | null => {
  if (!context?.telemetry_summary) return null;
  if (typeof context.telemetry_summary === "string") {
    return `Telemetry: ${context.telemetry_summary}`;
  }
  try {
    return `Telemetry: ${JSON.stringify(context.telemetry_summary)}`;
  } catch {
    return null;
  }
};

const formatRecentTurns = (turns: DebatePromptTurn[], maxTurns = 4): string | null => {
  if (!turns.length) return null;
  const recent = turns.slice(-maxTurns);
  const lines = recent.map((turn) => `  - ${turn.role}#${turn.round}: ${turn.text.slice(0, 280)}`);
  return ["Recent turns:", ...lines].join("\n");
};

const formatVerifierResults = (
  verifierResults: Array<{ name: string; ok: boolean; reason?: string }> | undefined,
): string | null => {
  if (!verifierResults || verifierResults.length === 0) return null;
  const lines = verifierResults.map((entry) => {
    const reason = entry.reason ? ` -> ${entry.reason.slice(0, 120)}` : "";
    return `  - ${entry.ok ? "PASS" : "FAIL"} ${entry.name}${reason}`;
  });
  return ["Verifiers:", ...lines].join("\n");
};

const formatMetrics = (metrics?: TDebateRoundMetrics): string | null => {
  if (!metrics) return null;
  return `Metrics: score ${(metrics.score * 100).toFixed(1)}% | improvement ${(metrics.improvement * 100).toFixed(1)}% | novelty ${(metrics.novelty_gain * 100).toFixed(1)}% | stability ${(metrics.stability * 100).toFixed(1)}%`;
};

const roleDirectives = {
  proponent: [
    "Advance one specific, testable sub-claim that moves the goal forward.",
    "Ground every claim in the warp certificate and provided attachments; prefer quantified evidence.",
    "If any HARD constraints fail or status is not ADMISSIBLE, explicitly propose remediation or redesign instead of hand-waving.",
    "Keep it concise (3-6 sentences) and include concrete next checks or calculations.",
  ],
  skeptic: [
    "Stress-test the latest claim; surface the sharpest risks and missing evidence.",
    "Lean on failing or marginal constraints, physical infeasibility, and missing citations; avoid fabricating evidence.",
    "Offer a falsifiable check or measurement that would break the claim if it is wrong.",
    "Respond in 3-6 sentences with clear critique, not a summary.",
  ],
  referee: [
    "Judge which side is currently ahead based on evidence, constraints, and verifier results.",
    "Call out any red flags (failed verifiers, HARD constraint violations, missing citations).",
    "State what each side must do next; if progress stalls, suggest the most informative next test.",
    "Output a short verdict paragraph (2-5 sentences) and identify a provisional winner or stalemate.",
  ],
} as const;

export function buildDebateTurnPrompt(options: DebatePromptOptions): string {
  const { role, goal, round, turns, scoreboard, context, verifierResults, metrics } = options;
  const guardrail = renderWarpGuardrail(context?.warp_grounding, role);
  const warp = formatWarpEvidenceBlock(context?.warp_grounding);
  const attachments = formatAttachmentList(context);
  const telemetry = formatTelemetry(context);
  const history = formatRecentTurns(turns);
  const verifiers = formatVerifierResults(verifierResults);
  const metricLine = formatMetrics(metrics);
  const directives = roleDirectives[role];

  const lines: string[] = [
    `Role: ${role.toUpperCase()} | Round ${round} | Score P:${scoreboard.proponent} S:${scoreboard.skeptic}`,
    `Goal: ${goal}`,
  ];
  if (guardrail) lines.push(`Guardrail: ${guardrail}`);
  if (warp) lines.push(warp);
  if (attachments) lines.push(attachments);
  if (telemetry) lines.push(telemetry);
  if (history) lines.push(history);
  if (verifiers) lines.push(verifiers);
  if (metricLine) lines.push(metricLine);
  lines.push("Directives:");
  directives.forEach((d) => lines.push(`  - ${d}`));
  lines.push("Respond with analysis and a concrete, defensible position. Do not invent citations; use only provided evidence.");
  return lines.join("\n");
}
