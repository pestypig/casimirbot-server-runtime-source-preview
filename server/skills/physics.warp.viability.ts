import { z } from "zod";
import type { ToolHandler, ToolSpecShape } from "@shared/skills";
import { issueWarpViabilityCertificate } from "../../tools/warpViabilityCertificate";
import { verifyCertificateIntegrity } from "../../tools/verifyCertificate";
import type { ConstraintResult, ViabilityResult, WarpConfig, WarpViabilityCertificate } from "../../types/warpViability";
import { loadWarpAgentsConfig } from "../../modules/physics/warpAgents";
import { recordTrainingTrace } from "../services/observability/training-trace-store";
import { SupplementSchema, type Supplement } from "../services/planner/supplements";

const WarpViabilityInput = z
  .object({
    bubbleRadius_m: z.number().optional(),
    wallThickness_m: z.number().optional(),
    targetVelocity_c: z.number().optional(),
    tileConfigId: z.string().optional(),
    tileCount: z.number().optional(),
    dutyCycle: z.number().min(0).max(1).optional(),
    gammaGeoOverride: z.number().optional(),
  })
  .passthrough();

const WarpConfigSchema = WarpViabilityInput;

const ConstraintResultSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(["HARD", "SOFT"]),
  passed: z.boolean(),
  lhs: z.number().optional(),
  rhs: z.number().optional(),
  margin: z.number().nullable().optional(),
  details: z.string().optional(),
  note: z.string().optional(),
});

const TsSnapshotSchema = z
  .object({
    TS_ratio: z.number().optional(),
    tauLC_ms: z.number().optional(),
    tauPulse_ns: z.number().optional(),
    autoscale: z.record(z.any()).nullable().optional(),
  })
  .partial();

const GrGuardrailConstraintSchema = z
  .object({
    rms: z.number().optional(),
    maxAbs: z.number().optional(),
    threshold: z.number().optional(),
    exceeded: z.boolean().optional(),
  })
  .partial();

const GrGuardrailScalarSchema = z
  .object({
    floor: z.number().optional(),
    maxAbs: z.number().optional(),
    threshold: z.number().optional(),
    exceeded: z.boolean().optional(),
  })
  .partial();

const GrGuardrailsSchema = z
  .object({
    source: z.enum(["pipeline-gr", "proxy"]).optional(),
    proxy: z.boolean().optional(),
    missing: z.array(z.string()).optional(),
    H_constraint: GrGuardrailConstraintSchema.optional(),
    M_constraint: GrGuardrailConstraintSchema.optional(),
    lapse: GrGuardrailScalarSchema.optional(),
    beta: GrGuardrailScalarSchema.optional(),
  })
  .partial();

const WarpViabilitySnapshotSchema = z
  .object({
    U_static: z.number().optional(),
    TS_ratio: z.number().optional(),
    gamma_geo_cubed: z.number().optional(),
    d_eff: z.number().optional(),
    gamma_VdB: z.number().optional(),
    M_exotic: z.number().optional(),
    T00_min: z.number().optional(),
    thetaCal: z.number().optional(),
    sectorPeriod_ms: z.number().optional(),
    dwell_ms: z.number().optional(),
    burst_ms: z.number().optional(),
    ts: TsSnapshotSchema.optional().nullable(),
    grGuardrails: GrGuardrailsSchema.optional(),
  })
  .catchall(z.unknown().optional());

const WarpViabilityPayloadSchema = z.object({
  status: z.enum(["ADMISSIBLE", "MARGINAL", "INADMISSIBLE", "NOT_CERTIFIED"]),
  config: WarpConfigSchema,
  constraints: z.array(ConstraintResultSchema),
  snapshot: WarpViabilitySnapshotSchema,
  citations: z.array(z.string()).optional(),
});

const CertificateHeaderSchema = z.object({
  id: z.string(),
  kind: z.literal("warp-viability"),
  issuedAt: z.string(),
  issuer: z.string(),
  gitCommit: z.string().optional(),
  pipelineVersion: z.string().optional(),
});

const WarpViabilityCertificateSchema = z.object({
  header: CertificateHeaderSchema,
  payload: WarpViabilityPayloadSchema,
  payloadHash: z.string(),
  certificateHash: z.string().optional(),
  signature: z.string().optional(),
});

const ViabilityResultSchema = z.object({
  status: z.enum(["ADMISSIBLE", "MARGINAL", "INADMISSIBLE", "NOT_CERTIFIED"]),  
  constraints: z.array(ConstraintResultSchema),
  snapshot: WarpViabilitySnapshotSchema,
  citations: z.array(z.string()).optional(),
  config: WarpConfigSchema.optional(),
  certificate: WarpViabilityCertificateSchema,
  integrityOk: z.boolean().optional(),
  supplement: SupplementSchema.optional(),
  certificateHash: z.string().optional(),
  certificateId: z.string().optional(),
});

const DEFAULT_VIABILITY_POLICY = {
  admissibleStatus: "ADMISSIBLE",
  allowMarginalAsViable: false,
  policy: "warp-viability",
  policyVersion: "default",
};

const resolveViabilityPolicy = async () => {
  try {
    const config = await loadWarpAgentsConfig();
    return {
      admissibleStatus:
        config.viabilityPolicy?.admissibleStatus ??
        DEFAULT_VIABILITY_POLICY.admissibleStatus,
      allowMarginalAsViable:
        config.viabilityPolicy?.allowMarginalAsViable ??
        DEFAULT_VIABILITY_POLICY.allowMarginalAsViable,
      policy: DEFAULT_VIABILITY_POLICY.policy,
      policyVersion: String(config.version),
    };
  } catch {
    return DEFAULT_VIABILITY_POLICY;
  }
};

const buildFirstFail = (constraints: ConstraintResult[]) => {
  const failing = constraints.find(
    (constraint) => constraint.severity === "HARD" && !constraint.passed,
  );
  if (!failing) return undefined;
  const limit =
    typeof failing.rhs === "number" && Number.isFinite(failing.rhs)
      ? String(failing.rhs)
      : null;
  return {
    id: failing.id,
    severity: failing.severity,
    status: "fail",
    value:
      typeof failing.lhs === "number" && Number.isFinite(failing.lhs)
        ? failing.lhs
        : null,
    limit,
    note: failing.note ?? failing.details,
  };
};

const formatConstraintLine = (constraint: ConstraintResult): string => {        
  const status = constraint.passed ? "PASS" : "FAIL";
  const lhs = constraint.lhs !== undefined ? constraint.lhs : "n/a";
  const rhs = constraint.rhs !== undefined ? constraint.rhs : "n/a";
  return `${status} ${constraint.id} (${constraint.severity}): lhs=${lhs} rhs=${rhs}`;
};

const formatNumber = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) {
    return value.toExponential(3);
  }
  return Number(value.toPrecision(6)).toString();
};

const extractSnapshotLines = (snapshot: Record<string, unknown> | undefined): string[] => {
  if (!snapshot) return [];
  const interesting = ["TS_ratio", "gamma_VdB", "T00_min", "M_exotic"];
  const lines: string[] = [];
  for (const key of interesting) {
    const value = (snapshot as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      lines.push(`${key}=${formatNumber(value)}`);
    }
  }
  return lines;
};

const buildSupplement = (result: ViabilityResult, certificate?: WarpViabilityCertificate): Supplement => {
  const failing = result.constraints.filter((c) => !c.passed);
  const headline = `status=${result.status}`;
  const constraintLines = result.constraints.map(formatConstraintLine);
  const snapshotLines = extractSnapshotLines(result.snapshot as Record<string, unknown>);
  const failHint = failing.find((c) => c.severity === "HARD") ?? failing[0];
  const detailParts = [
    "Viability oracle verdict (physics-grounded):",
    headline,
    certificate ? `Certificate payload hash=${certificate.payloadHash}` : undefined,
    "Rules:",
    "- Do not claim a configuration is viable unless status is ADMISSIBLE.",
    "- If status is MARGINAL or INADMISSIBLE, name the failing constraints with their ids.",
    "- Base any viability statement on the certificate payload (status + constraints); do not fabricate extra results.",
    "- Show key snapshot numbers: TS_ratio, gamma_VdB, T00_min, M_exotic (omit if missing).",
    failHint ? `First failing constraint to cite: ${failHint.id} (${failHint.severity})` : undefined,
    "Constraints:",
    ...constraintLines,
    snapshotLines.length ? "Snapshot:" : undefined,
    ...(snapshotLines.length ? snapshotLines : []),
  ];
  const filteredDetail = detailParts.filter((line): line is string => Boolean(line && line.trim()));
  return {
    kind: "warp",
    tool: warpViabilitySpec.name,
    title: "Warp Viability Verdict",
    summary: headline,
    detail: filteredDetail.join("\n"),
    citations: result.citations,
    importance: 0.97,
  };
};

export const warpViabilitySpec: ToolSpecShape = {
  name: "physics.warp.viability",
  desc: "Compute a physics-grounded warp viability verdict (ADMISSIBLE/MARGINAL/INADMISSIBLE) with constraint witnesses and a hashed certificate",
  inputSchema: WarpViabilityInput,
  outputSchema: ViabilityResultSchema,
  deterministic: true,
  rateLimit: { rpm: 30 },
  safety: { risks: [] },
  risk: { writesFiles: false, touchesNetwork: false, privileged: false },
  health: "ok",
};

export const warpViabilityHandler: ToolHandler = async (rawInput) => {
  const config = WarpViabilityInput.parse((rawInput ?? {}) as WarpConfig);      
  const certificate = await issueWarpViabilityCertificate(config);
  const integrityOk = verifyCertificateIntegrity(certificate);
  const policy = await resolveViabilityPolicy();
  const hasCertificate = Boolean(certificate.certificateHash);
  const hardFailures = certificate.payload.constraints.filter(
    (constraint) => constraint.severity === "HARD" && !constraint.passed,
  );
  const firstFail = buildFirstFail(certificate.payload.constraints);
  const statusOk =
    certificate.payload.status === policy.admissibleStatus ||
    (policy.allowMarginalAsViable && certificate.payload.status === "MARGINAL");
  const pass =
    integrityOk && hasCertificate && statusOk && hardFailures.length === 0;
  const notes = [`status=${certificate.payload.status}`];
  if (!hasCertificate) {
    notes.push("certificate_hash_missing");
  }
  if (!integrityOk) {
    notes.push("certificate_integrity_failed");
  }
  if (!statusOk) {
    notes.push("status_not_allowed");
  }
  if (hardFailures.length) {
    notes.push(`hard_fail=${hardFailures.map((item) => item.id).join(",")}`);
  }

  const result: ViabilityResult = {
    status: certificate.payload.status,
    constraints: certificate.payload.constraints,
    snapshot: certificate.payload.snapshot,
    citations: certificate.payload.citations,
    config: certificate.payload.config,
    certificateHash: certificate.certificateHash,
    certificateId: certificate.header.id,
  };

  const supplement = buildSupplement(result, certificate);
  try {
    recordTrainingTrace({
      traceId: `warp-viability:${certificate.header.id}`,
      source: {
        system: "warp-viability",
        component: "warp-viability-skill",
        tool: warpViabilitySpec.name,
        version: "v1",
        proxy: false,
      },
      signal: {
        kind: "warp-viability",
        proxy: false,
        ladder: {
          tier: pass ? "certified" : "diagnostic",
          policy: policy.policy,
          policyVersion: policy.policyVersion,
        },
      },
      pass,
      deltas: [],
      firstFail,
      certificate: {
        status: certificate.payload.status,
        certificateHash: certificate.certificateHash ?? null,
        certificateId: certificate.header.id ?? null,
        integrityOk,
      },
      notes: notes.length ? notes : undefined,
    });
  } catch (error) {
    console.warn("[warp-viability] training trace emit failed", error);
  }

  return ViabilityResultSchema.parse({
    ...result,
    config: certificate.payload.config,
    certificate,
    integrityOk,
    supplement,
  });
};
