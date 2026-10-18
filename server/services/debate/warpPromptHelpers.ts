import type { WarpGrounding } from "./types";

export type WarpPromptMessage = { role: "system" | "user"; content: string };

function formatNumber(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) {
    return n.toExponential(4);
  }
  return n.toFixed(4);
}

export function formatWarpEvidenceBlock(warp?: WarpGrounding): string {
  if (!warp) {
    return `Warp evidence: NONE

Status: NOT_CERTIFIED
No viability certificate or constraint results are available for this configuration.`;
  }

  const status = warp.status ?? "NOT_CERTIFIED";
  const summary = warp.summary || warp.askAnswer;
  const { snapshot, constraints, certificateHash } = warp;
  const lines: string[] = [];

  lines.push("Warp evidence:");
  lines.push(`- status: ${status}`);
  if (certificateHash) {
    lines.push(`- certificateHash: ${certificateHash}`);
  }
  if (summary) {
    lines.push(`- summary: ${summary}`);
  }

  if (snapshot && Object.keys(snapshot).length) {
    lines.push(`- snapshot (key scalars, provided by pipeline):`);
    const keysOfInterest = [
      "TS_ratio",
      "gamma_VdB",
      "d_eff",
      "U_static",
      "T00_min",
      "M_exotic",
      "thetaCal",
    ];
    for (const k of keysOfInterest) {
      if (snapshot[k] !== undefined) {
        lines.push(`    * ${k} = ${formatNumber(snapshot[k])}`);
      }
    }
  } else {
    lines.push(`- snapshot: none provided (do NOT invent values)`);
  }

  if (constraints && constraints.length) {
    lines.push(`- constraints:`);
    for (const c of constraints) {
      const badge = c.passed ? "PASS" : "FAIL";
      const sev = c.severity ?? "?";
      const margin =
        c.margin !== undefined && c.margin !== null ? ` (margin ${formatNumber(c.margin)})` : "";
      const id = c.id ?? "constraint";
      const description = c.description ?? "";
      lines.push(`    * [${badge} ${sev}] ${id}: ${description}${margin}`);
    }
  } else {
    lines.push(`- constraints: none`);
  }

  return lines.join("\n");
}

type TurnContext = {
  goal: string;
  round: number;
  warp?: WarpGrounding;
};

export function buildProponentMessages(ctx: TurnContext): WarpPromptMessage[] {
  const evidence = formatWarpEvidenceBlock(ctx.warp);
  const system = [
    "You are the Proponent in a physics debate about warp-bubble viability.",
    "You argue IN FAVOR of the proposed configuration or approach, but you MUST respect the warp evidence.",
    "",
    "RULES:",
    "- Treat the warp viability evidence as the sole source of truth about status and constraints.",
    '- DO NOT claim that the configuration is "physically viable", "admissible", or "certified" unless:',
    "  - status == ADMISSIBLE, AND",
    "  - all HARD constraints passed.",
    "- DO NOT invent snapshot values or constraints; if the evidence block shows none, say they were not provided.",
    "- If status is MARGINAL or INADMISSIBLE, you may argue for improvements, nearby configs, or broader theoretical value,",
    "  but you MUST clearly acknowledge which constraints fail or are marginal.",
    "- If status is NOT_CERTIFIED (no certificate), you MUST state that there is no certificate and you cannot claim viability.",
    "- If snapshot values are provided, cite at least ONE HARD constraint and 2-3 snapshot numbers (e.g. TS_ratio, gamma_VdB, T00_min, M_exotic, thetaCal, d_eff)",
    "  to support your reasoning. If no snapshot is provided, explicitly say so and do NOT invent numbers.",
    "- When a certificateHash is present, mention it once so the user can trace the evidence.",
  ].join("\n");

  const user = [
    `Role: PROPONENT`,
    `Round: ${ctx.round}`,
    `Debate goal: ${ctx.goal}`,
    "",
    evidence,
    "",
    "TASK:",
    "Write a concise argument (1-3 paragraphs) in favor of the configuration or method,",
    "grounded ONLY in the warp evidence above.",
    "",
    "Structure your answer as:",
    "1. Status statement: explain the status (ADMISSIBLE/MARGINAL/INADMISSIBLE/NOT_CERTIFIED) in one sentence,",
    "   and explicitly say whether you can or cannot claim viability.",
    "2. Evidence: name at least one HARD constraint (with PASS/FAIL and margin if available) and cite 2-3 snapshot values,",
    "   explaining why they support your position.",
    "3. Optional theoretical context: briefly describe how the warp bubble is constructed (Casimir tiles -> energy pipeline -> Natario metric ->",
    '   stress-energy validation), clearly marked as "general theory" and not as additional evidence.',
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function buildSkepticMessages(ctx: TurnContext): WarpPromptMessage[] {
  const evidence = formatWarpEvidenceBlock(ctx.warp);
  const system = [
    "You are the Skeptic in a physics debate about warp-bubble viability.",
    "You argue AGAINST the claim that the configuration is safely viable under the current guardrails.",
    "",
    "RULES:",
    "- Treat the warp viability evidence as the authority on status and constraints.",
    "- If any HARD constraint failed, you MUST highlight it and explain why it undermines viability,",
    "  using snapshot values and margin if available.",
    "- DO NOT invent snapshot values or constraints; if none are provided, say they are missing and argue that viability is unsupported.",
    "- Even if all HARD constraints passed, you may still argue that the configuration is fragile or risky if:",
    "  - margins for HARD constraints are very small (near the bound), or",
    "  - SOFT constraints are violated or barely satisfied.",
    "- If status is NOT_CERTIFIED, your primary argument is that no certificate exists, so viability cannot be trusted.",
    "- When snapshot values are provided, cite at least one constraint (prefer a failing HARD one if available) and 2-3 snapshot numbers.",
    "  If no snapshot is provided, explicitly say it is missing and do NOT invent numbers.",
    "- Mention certificateHash if present, to anchor your critique.",
  ].join("\n");

  const user = [
    `Role: SKEPTIC`,
    `Round: ${ctx.round}`,
    `Debate goal: ${ctx.goal}`,
    "",
    evidence,
    "",
    "TASK:",
    "Write a concise argument (1-3 paragraphs) questioning or challenging the viability of the configuration,",
    "grounded ONLY in the warp evidence above.",
    "",
    "Structure your answer as:",
    "1. Status statement: restate the status (ADMISSIBLE/MARGINAL/INADMISSIBLE/NOT_CERTIFIED) and what it implies about trust.",
    "2. Evidence-based critique:",
    "   - If a HARD constraint fails, focus on it and explain with snapshot numbers why this is disqualifying or very concerning.",
    "   - If all HARD constraints pass, look at margins and SOFT constraints to argue that the configuration is near the edge or",
    "     not robust (again using snapshot values).",
    "   - If NOT_CERTIFIED, emphasize that no certificate is available, so any claim of viability is unsupported.",
    "3. Optional: suggest what additional evidence or adjustments (e.g., higher TS_ratio, lower |M_exotic|) would make you less skeptical.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function buildRefereeMessages(ctx: TurnContext): WarpPromptMessage[] {
  const evidence = formatWarpEvidenceBlock(ctx.warp);
  const system = [
    "You are the Referee in a physics debate about warp-bubble viability.",
    "Your job is to judge which side (Proponent vs. Skeptic) is better supported by the warp evidence.",
    "",
    "RULES:",
    "- The warp evidence (status, constraints, snapshot, certificateHash) is the ultimate source of truth.",
    "- You MUST NOT override the certificate status or invent new constraint results.",
    "- DO NOT invent snapshot numbers; if none are provided, state that they are missing.",
    "- When you write your verdict, you MUST:",
    "  - Explicitly mention the certificate status (or that it is NOT_CERTIFIED).",
    "  - Reference at least one constraint id (e.g., FordRomanQI, ThetaAudit, TS_ratio_min).",
    "  - Cite at least one snapshot value (e.g., TS_ratio, gamma_VdB, T00_min, M_exotic, thetaCal, d_eff) when provided; if none are provided, say so explicitly.",
    "  - Include the certificateHash if present.",
    "- If status is ADMISSIBLE and HARD constraints pass, you may lean towards the Proponent if they correctly used the evidence.",
    "- If status is MARGINAL/INADMISSIBLE or NOT_CERTIFIED, you should lean towards the Skeptic if they correctly highlighted",
    "  the failing or missing evidence.",
  ].join("\n");

  const user = [
    `Role: REFEREE`,
    `Round: ${ctx.round}`,
    `Debate goal: ${ctx.goal}`,
    "",
    evidence,
    "",
    "You have already seen the Proponent and Skeptic arguments for this round.",
    "",
    "TASK:",
    "Write a short verdict (1-2 paragraphs) that:",
    "1. States the certificate status and what it implies about viability.",
    "2. Identifies at least one key constraint and one snapshot number that are most relevant to this debate.",
    "3. Explains which side (Proponent or Skeptic) is better aligned with the evidence and why.",
    "4. Mentions the certificateHash if present, so the verdict can be traced back.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function buildWarpMessages(
  role: "proponent" | "skeptic" | "referee",
  goal: string,
  round: number,
  warp?: WarpGrounding,
): WarpPromptMessage[] | null {
  const ctx: TurnContext = { goal, round, warp };
  if (!warp) return null;
  if (role === "proponent") return buildProponentMessages(ctx);
  if (role === "skeptic") return buildSkepticMessages(ctx);
  return buildRefereeMessages(ctx);
}
