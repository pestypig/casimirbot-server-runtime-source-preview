import type { Nhm2BlockId, Nhm2ClaimBlock } from "../../../shared/nhm2-blocks";

const FILE_REF_RE =
  /^(?:[A-Za-z]:[\\/]|(?:client|server|shared|docs|scripts|tests|configs|reports|artifacts|packages|sdk|cli)\/).+/i;

const NHM2_SCOPE_RE =
  /\b(?:nhm2|needle(?:\s+hull)?(?:\s+mark\s*2|\s+mk2)?|warp bubble|natario|alcubierre|shift lapse|proof pack|gr certificate|congruent solve|ford-roman|theta audit|van den broeck|vdb|tau\s*lc|time dilation lattice|guardrails?)\b/i;
const NHM2_STATUS_RE = /\b(?:solve state|current state|current status|status|authority|live state|current)\b/i;
const NHM2_GEOMETRY_RE =
  /\b(?:geometry|timing|tau\s*lc|taulc|hull|parity|radius|lx|ly|lz|sector(?: count)?|concurrent sectors?|full hull|reduced order)\b/i;
const NHM2_PROOF_RE =
  /\b(?:proof|guardrail|guardrails|certificate|integrity|admissib|proxy|ford-roman|theta|ts ratio|vdb|van den broeck|constraint|vacuum|stage|blocked|warn|fail)\b/i;
const NHM2_CALCULATOR_RE =
  /\b(?:calculator|snapshot|decision class|margin ratio|observer|congruent solve|stress[-\s]?energy)\b/i;
const NHM2_RENDER_RE =
  /\b(?:render|viewer|visual|field family|shift lapse|chart status|render status|display)\b/i;

const toSentence = (value: string) => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const uniq = <T>(values: ReadonlyArray<T>): T[] => Array.from(new Set(values));

const formatBoolean = (value: unknown) => {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "n/a";
};

const formatIntegrity = (value: boolean | null | undefined) => {
  if (value === true) return "ok";
  if (value === false) return "fail";
  return "n/a";
};

const formatNumber = (value: unknown, digits = 3) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return Number(numeric).toFixed(digits);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const collectExactBlockMatches = (question: string): Nhm2BlockId[] => {
  const lowered = question.toLowerCase();
  return ([
    "nhm2.authority-status",
    "nhm2.geometry-timing",
    "nhm2.proof-guardrails",
    "nhm2.calculator-snapshot",
    "nhm2.render-status",
  ] as const).filter((blockId) => lowered.includes(blockId));
};

export function selectNhm2BlockIdsForQuestion(question: string): Nhm2BlockId[] {
  const normalized = String(question ?? "").trim();
  if (!normalized) return [];

  const selected = new Set<Nhm2BlockId>();
  const exact = collectExactBlockMatches(normalized);
  if (exact.length > 0) {
    selected.add("nhm2.authority-status");
    exact.forEach((blockId) => selected.add(blockId));
    return Array.from(selected);
  }

  if (!NHM2_SCOPE_RE.test(normalized)) return [];

  selected.add("nhm2.authority-status");

  if (NHM2_STATUS_RE.test(normalized)) {
    selected.add("nhm2.geometry-timing");
    selected.add("nhm2.proof-guardrails");
    selected.add("nhm2.render-status");
  }
  if (NHM2_GEOMETRY_RE.test(normalized)) {
    selected.add("nhm2.geometry-timing");
  }
  if (NHM2_PROOF_RE.test(normalized)) {
    selected.add("nhm2.proof-guardrails");
  }
  if (NHM2_CALCULATOR_RE.test(normalized)) {
    selected.add("nhm2.calculator-snapshot");
  }
  if (NHM2_RENDER_RE.test(normalized)) {
    selected.add("nhm2.render-status");
  }

  return Array.from(selected);
}

export function shouldDirectlyAnswerFromNhm2Blocks(question: string): boolean {
  const normalized = String(question ?? "").trim();
  if (!normalized) return false;
  return collectExactBlockMatches(normalized).length > 0;
}

const summarizeAuthorityBlock = (block: Nhm2ClaimBlock) => {
  const data = asRecord(block.data);
  const authority = asRecord(data?.authority);
  const pipeline = asRecord(data?.pipeline);
  return [
    authority?.solutionCategory ? `solution=${authority.solutionCategory}` : null,
    authority?.profileVersion ? `profile=${authority.profileVersion}` : null,
    pipeline?.claimTier ? `claimTier=${pipeline.claimTier}` : null,
    pipeline?.provenanceClass ? `provenance=${pipeline.provenanceClass}` : null,
    pipeline?.currentMode ? `mode=${pipeline.currentMode}` : null,
    pipeline?.warpFieldType ? `warpFieldType=${pipeline.warpFieldType}` : null,
  ]
    .filter(Boolean)
    .join("; ");
};

const summarizeGeometryBlock = (block: Nhm2ClaimBlock) => {
  const data = asRecord(block.data);
  const geometry = asRecord(data?.geometry);
  const timing = asRecord(data?.timing);
  const fallback = asRecord(data?.geometryFallback);
  const mismatchAxes = Array.isArray(geometry?.mismatchAxes)
    ? geometry?.mismatchAxes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return [
    `matchesAuthority=${formatBoolean(geometry?.matchesAuthority)}`,
    `tauLC_ms=${formatNumber(timing?.fullHullTauLcMs, 6)}`,
    `liveTauLC_ms=${formatNumber(timing?.liveTauLcMs, 6)}`,
    fallback?.mode ? `fallbackMode=${fallback.mode}` : null,
    fallback?.applied === true ? "fallbackApplied=yes" : null,
    fallback?.blocked === true ? "fallbackBlocked=yes" : null,
    mismatchAxes.length > 0 ? `mismatchAxes=${mismatchAxes.join("/")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
};

const summarizeProofBlock = (block: Nhm2ClaimBlock) => {
  const data = asRecord(block.data);
  const proof = asRecord(data?.proof);
  const contract = asRecord(data?.contract);
  const guardrails = asRecord(contract?.guardrails);
  const failingConstraints = Array.isArray(contract?.failingConstraints)
    ? contract?.failingConstraints.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return [
    proof?.stage ? `stage=${proof.stage}` : null,
    `strictProxy=${formatBoolean(proof?.strictProxy)}`,
    contract?.certificateStatus ? `certificate=${contract.certificateStatus}` : null,
    `integrity=${formatIntegrity(contract?.integrityOk as boolean | null | undefined)}`,
    guardrails?.fordRoman ? `fordRoman=${guardrails.fordRoman}` : null,
    guardrails?.thetaAudit ? `theta=${guardrails.thetaAudit}` : null,
    guardrails?.tsRatio ? `tsRatio=${guardrails.tsRatio}` : null,
    guardrails?.vdbBand ? `vdb=${guardrails.vdbBand}` : null,
    failingConstraints.length > 0 ? `failing=${failingConstraints.slice(0, 4).join(",")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
};

const summarizeCalculatorBlock = (block: Nhm2ClaimBlock) => {
  const data = asRecord(block.data);
  const calculator = asRecord(data?.calculator);
  return [
    calculator?.decisionClass ? `decision=${calculator.decisionClass}` : null,
    `congruentSolvePass=${formatBoolean(calculator?.congruentSolvePass)}`,
    calculator?.marginRatioRaw != null ? `marginRatioRaw=${formatNumber(calculator.marginRatioRaw, 4)}` : null,
    calculator?.marginRatioRawComputed != null
      ? `marginRatioRawComputed=${formatNumber(calculator.marginRatioRawComputed, 4)}`
      : null,
    calculator?.observerCondition ? `observerCondition=${calculator.observerCondition}` : null,
    calculator?.observerFrame ? `observerFrame=${calculator.observerFrame}` : null,
  ]
    .filter(Boolean)
    .join("; ");
};

const summarizeRenderBlock = (block: Nhm2ClaimBlock) => {
  const data = asRecord(block.data);
  const fallback = asRecord(data?.geometryFallback);
  return [
    data?.warpFieldType ? `warpFieldType=${String(data.warpFieldType)}` : null,
    `geometryMatchesAuthority=${formatBoolean(data?.geometryMatchesAuthority)}`,
    fallback?.mode ? `fallbackMode=${fallback.mode}` : null,
    fallback?.applied === true ? "fallbackApplied=yes" : null,
    fallback?.blocked === true ? "fallbackBlocked=yes" : null,
    data?.chartStatus ? `chartStatus=${String(data.chartStatus)}` : null,
  ]
    .filter(Boolean)
    .join("; ");
};

const summarizeBlockData = (block: Nhm2ClaimBlock) => {
  switch (block.blockId) {
    case "nhm2.authority-status":
      return summarizeAuthorityBlock(block);
    case "nhm2.geometry-timing":
      return summarizeGeometryBlock(block);
    case "nhm2.proof-guardrails":
      return summarizeProofBlock(block);
    case "nhm2.calculator-snapshot":
      return summarizeCalculatorBlock(block);
    case "nhm2.render-status":
      return summarizeRenderBlock(block);
    default:
      return "";
  }
};

const formatProvenanceEntry = (block: Nhm2ClaimBlock) =>
  block.provenance
    .map((entry) => {
      const detail = entry.detail?.trim() ? ` (${entry.detail.trim()})` : "";
      return entry.ref?.trim()
        ? `${entry.label}: ${entry.ref.trim()}${detail}`
        : `${entry.label}${detail}`;
    })
    .join("; ");

export function collectNhm2GroundingRefs(blocks: ReadonlyArray<Nhm2ClaimBlock>): string[] {
  return uniq(
    blocks.flatMap((block) =>
      block.provenance
        .map((entry) => entry.ref?.trim() ?? "")
        .filter((ref) => ref.length > 0 && FILE_REF_RE.test(ref)),
    ),
  );
}

export function buildNhm2BlockGroundingContext(blocks: ReadonlyArray<Nhm2ClaimBlock>): {
  context: string;
  sourceRefs: string[];
} {
  if (!blocks.length) return { context: "", sourceRefs: [] };

  const lines = [
    "NHM2 live claim blocks:",
    "Hard rule: preserve block status, authority tier, integrity, and proxy state exactly. Do not upgrade warn/bad/proxy blocks into healthy claims.",
  ];

  for (const block of blocks) {
    const keyData = summarizeBlockData(block);
    lines.push(`- ${block.title} [${block.blockId}]`);
    lines.push(`  summary: ${toSentence(block.summary)}`);
    lines.push(
      `  status=${block.status}; authority=${block.authorityTier}; integrity=${formatIntegrity(block.integrity.integrityOk)}; version=${block.integrity.version}; certificate=${block.integrity.certificateHash ?? "n/a"}`,
    );
    if (block.claimIds.length > 0) {
      lines.push(`  claims: ${block.claimIds.join(", ")}`);
    }
    if (keyData) {
      lines.push(`  key values: ${keyData}`);
    }
    lines.push(`  provenance: ${formatProvenanceEntry(block)}`);
  }

  return {
    context: lines.join("\n"),
    sourceRefs: collectNhm2GroundingRefs(blocks),
  };
}

const renderDirectAnswerLine = (block: Nhm2ClaimBlock) => {
  const keyData = summarizeBlockData(block);
  const provenance = block.provenance
    .map((entry) => entry.ref?.trim() || entry.label.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 3)
    .join(", ");
  const parts = [
    `${block.title} (${block.blockId}) reports status ${block.status}, authority ${block.authorityTier}, and integrity ${formatIntegrity(block.integrity.integrityOk)}.`,
    toSentence(block.summary),
    keyData ? `Key values: ${keyData}.` : "",
    provenance ? `Provenance: ${provenance}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
};

export function renderNhm2BlockGroundedAnswer(blocks: ReadonlyArray<Nhm2ClaimBlock>): string {
  if (!blocks.length) return "";
  const body = blocks.map((block) => renderDirectAnswerLine(block)).join("\n\n");
  const sourceRefs = collectNhm2GroundingRefs(blocks);
  if (!sourceRefs.length) {
    return body;
  }
  return `${body}\n\nSources: ${sourceRefs.join(", ")}`;
}
