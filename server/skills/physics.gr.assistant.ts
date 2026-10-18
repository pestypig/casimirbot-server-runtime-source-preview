import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolHandler, ToolSpecShape } from "@shared/skills";
import {
  grConstraintPolicySchema,
  grConstraintThresholdSchema,
  grGroundingSchema,
  type GrConstraintEntry,
} from "@shared/schema";
import type { WarpConfig } from "../../types/warpViability";
import { loadWarpAgentsConfig } from "../../modules/physics/warpAgents";
import { getGlobalPipelineState } from "../energy-pipeline";
import { runGrEvaluation } from "../gr/gr-evaluation";
import {
  buildDiagnosticsFromBrick,
  buildMetricSpecFromBrick,
  extractBrickInvariants,
  type GrAssistantSampleInput,
  type GrAssistantSample,
  type MetricSpec,
} from "../gr/gr-assistant-adapter";
import {
  buildSymbolUnitsFromRegistry,
  mergeSymbolUnits,
} from "../services/physics/unit-signatures";
import { recordTrainingTrace } from "../services/observability/training-trace-store";
import { assertHullAllowed } from "../security/hull-guard";

const GR_ASSISTANT_TOOL_NAME = "physics.gr.assistant";
const DEFAULT_ASSISTANT_RPM = Math.max(
  1,
  Number(process.env.GR_ASSISTANT_RPM ?? 30),
);

const WarpConfigSchema = z
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

const SampleSchema = z
  .object({
    ix: z.number().int().min(0).optional(),
    iy: z.number().int().min(0).optional(),
    iz: z.number().int().min(0).optional(),
    x_m: z.number().optional(),
    y_m: z.number().optional(),
    z_m: z.number().optional(),
  })
  .partial();

const UnitCheckSchema = z.object({
  expression: z.string().min(1),
  unit_system: z.string().optional(),
  symbol_units: z.record(z.string()).optional(),
  unit_tags: z.array(z.string()).optional(),
  unit_modules: z.array(z.string()).optional(),
});

const GrAssistantInput = z
  .object({
    metric: z.record(z.any()).optional(),
    brick: z.record(z.any()).optional(),
    sample: SampleSchema.optional(),
    vacuum_sample_points: z.array(z.record(z.number())).optional(),
    vacuum_epsilon: z.number().optional(),
    run_invariants: z.boolean().default(true),
    run_checks: z.boolean().default(true),
    run_artifacts: z.boolean().default(true),
    unit_check: UnitCheckSchema.optional(),
    tool_base_url: z.string().optional(),
    warpConfig: WarpConfigSchema.optional(),
    config: WarpConfigSchema.optional(),
    thresholds: grConstraintThresholdSchema.partial().optional(),
    policy: grConstraintPolicySchema.partial().optional(),
    useLiveSnapshot: z.boolean().optional(),
    traceId: z.string().optional(),
  })
  .passthrough();

const CheckResultSchema = z
  .object({
    check_name: z.string(),
    passed: z.boolean(),
    residual: z.string().nullable().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const ReportSchema = z.object({
  source: z.string(),
  assumptions: z.object({
    coords: z.array(z.string()),
    signature: z.string(),
    units_internal: z.string(),
  }),
  metric: z.record(z.any()).optional(),
  artifacts: z.array(z.string()),
  checks: z.array(CheckResultSchema),
  failed_checks: z.array(CheckResultSchema),
  invariants: z.record(z.any()).optional(),
  brick_invariants: z.record(z.any()).optional(),
  sample: z
    .object({
      ix: z.number(),
      iy: z.number(),
      iz: z.number(),
      x_m: z.number(),
      y_m: z.number(),
      z_m: z.number(),
      t_s: z.number(),
    })
    .optional(),
  passed: z.boolean(),
  notes: z.array(z.string()).optional(),
});

const GrAssistantOutput = z.object({
  report: ReportSchema,
  gate: grGroundingSchema.optional(),
  citations: z.array(z.string()),
  trace_id: z.string().optional(),
  training_trace_id: z.string().optional(),
});

export const grAssistantSpec: ToolSpecShape = {
  name: GR_ASSISTANT_TOOL_NAME,
  desc: "Proxy GR tensor checks/invariants via local tool server; attach GR gate status and training trace",
  inputSchema: GrAssistantInput,
  outputSchema: GrAssistantOutput,
  deterministic: true,
  rateLimit: { rpm: DEFAULT_ASSISTANT_RPM },
  safety: { risks: ["network_access"] },
  risk: { writesFiles: false, touchesNetwork: true, privileged: false },
  health: "ok",
};

let fetchImpl: typeof fetch | null =
  typeof globalThis.fetch === "function" ? globalThis.fetch : null;

const getFetch = async (): Promise<typeof fetch> => {
  if (fetchImpl) return fetchImpl;
  const mod = await import("node-fetch");
  fetchImpl = (mod.default ?? mod) as unknown as typeof fetch;
  return fetchImpl;
};

const resolveBaseUrl = (override?: string): string => {
  const base =
    (override ?? "").trim() ||
    (process.env.GR_ASSISTANT_BASE_URL ?? "").trim() ||
    "http://127.0.0.1:8000";
  const normalized = base.replace(/\/+$/, "");
  assertHullAllowed(normalized);
  return normalized;
};

const postJson = async (
  base: string,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<any> => {
  const fetch = await getFetch();
  const response = await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`gr-assistant HTTP ${response.status} for ${endpoint}`);
  }
  return response.json();
};

const collectChecks = (response: any): Array<Record<string, unknown>> => {
  if (response && Array.isArray(response.checks)) {
    return response.checks;
  }
  if (response && typeof response === "object") {
    return [response];
  }
  return [];
};

const dedupeChecks = (
  checks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> => {
  const map = new Map<string, Record<string, unknown>>();
  for (const check of checks) {
    const name =
      typeof check?.check_name === "string"
        ? String(check.check_name)
        : undefined;
    if (!name) continue;
    map.set(name, check);
  }
  return Array.from(map.values());
};

const pickFirstFail = (
  constraints: GrConstraintEntry[],
): GrConstraintEntry | undefined =>
  constraints.find((entry) => entry.severity === "HARD" && entry.status === "fail") ??
  constraints.find((entry) => entry.status === "fail");

const buildPolicyVersion = async (args: {
  gateVersion?: number;
  overridesApplied?: boolean;
}): Promise<string> => {
  const parts: string[] = [];
  try {
    const config = await loadWarpAgentsConfig();
    parts.push(`warp-agents-v${config.version}`);
  } catch {
    parts.push("warp-agents-unknown");
  }
  if (args.gateVersion) {
    parts.push(`gate-v${args.gateVersion}`);
  }
  if (args.overridesApplied) {
    parts.push("overrides");
  }
  return parts.join(":");
};

const buildGateReport = async (args: {
  diagnostics: any;
  warpConfig?: WarpConfig;
  thresholds?: unknown;
  policy?: unknown;
  useLiveSnapshot?: boolean;
}) => {
  const evaluation = await runGrEvaluation({
    diagnostics: args.diagnostics,
    warpConfig: args.warpConfig,
    thresholds: args.thresholds as any,
    policy: args.policy as any,
    useLiveSnapshot: args.useLiveSnapshot,
  });
  const overridesApplied =
    Boolean(args.thresholds || args.policy) ||
    Boolean(evaluation.evaluation.policy?.gate?.overridesApplied);
  const policyVersion = await buildPolicyVersion({
    gateVersion: evaluation.evaluation.policy?.gate?.version,
    overridesApplied,
  });
  const proxy =
    !args.diagnostics ||
    evaluation.evaluation.constraints.some(
      (entry) => entry.status === "unknown" || entry.proxy,
    );
  const grounding = grGroundingSchema.parse({
    kind: "gr-grounding",
    version: 1,
    updatedAt: evaluation.evaluation.updatedAt,
    policyVersion,
    residuals: evaluation.evaluation.residuals,
    constraints: evaluation.evaluation.constraints,
    certificate: {
      status: evaluation.evaluation.certificate.status,
      admissibleStatus: evaluation.evaluation.certificate.admissibleStatus,
      hasCertificate: evaluation.evaluation.certificate.hasCertificate,
      certificateHash: evaluation.evaluation.certificate.certificateHash ?? null,
      certificateId: evaluation.evaluation.certificate.certificateId ?? null,
      integrityOk: evaluation.evaluation.certificate.integrityOk,
    },
    pass: evaluation.evaluation.pass,
    ...(evaluation.evaluation.notes ? { notes: evaluation.evaluation.notes } : {}),
    ...(proxy ? { proxy: true } : {}),
  });
  return { grounding, evaluation };
};

export const grAssistantHandler: ToolHandler = async (rawInput) => {
  const input = GrAssistantInput.parse(rawInput ?? {});
  const baseUrl = resolveBaseUrl(input.tool_base_url);
  const warpConfig = (input.warpConfig ?? input.config ?? {}) as WarpConfig;

  let metric: MetricSpec | undefined;
  let source = "metric";
  let sample: GrAssistantSample | undefined;
  let brickInvariants: Record<string, unknown> | null = null;
  let diagnostics: any = null;

  if (input.brick) {
    const built = buildMetricSpecFromBrick(
      input.brick as any,
      input.sample as GrAssistantSampleInput,
    );
    metric = built.metric;
    sample = built.sample;
    source = "gr-evolve-brick";
    brickInvariants = extractBrickInvariants(input.brick as any);
    diagnostics = buildDiagnosticsFromBrick(input.brick as any);
  } else if (input.metric) {
    metric = input.metric as MetricSpec;
    source = "metric";
    diagnostics = getGlobalPipelineState().gr ?? null;
  } else {
    throw new Error("gr-assistant requires metric or brick input");
  }

  const artifacts: string[] = [];
  const checks: Array<Record<string, unknown>> = [];
  let invariants: Record<string, unknown> | undefined;

  if (input.run_artifacts) {
    const christoffel = await postJson(baseUrl, "/physics/christoffel", metric);
    if (christoffel?.name) artifacts.push(christoffel.name);
    const riemann = await postJson(baseUrl, "/physics/riemann", metric);
    if (riemann?.name) artifacts.push(riemann.name);
    const ricci = await postJson(baseUrl, "/physics/ricci", metric);
    if (ricci?.name) artifacts.push(ricci.name);
    const einstein = await postJson(baseUrl, "/physics/einstein-tensor", metric);
    if (einstein?.name) artifacts.push(einstein.name);
    const ricciScalar = await postJson(baseUrl, "/physics/ricci-scalar", metric);
    if (ricciScalar?.name) artifacts.push(ricciScalar.name);
  }

  if (input.run_invariants) {
    const inv = await postJson(baseUrl, "/physics/invariants", metric);
    invariants = inv?.scalars ?? inv;
  }

  if (input.run_checks) {
    const metricChecks = await postJson(baseUrl, "/physics/metric-validate", metric);
    checks.push(...collectChecks(metricChecks));
    const christoffelCheck = await postJson(
      baseUrl,
      "/physics/check-christoffel-symmetry",
      metric,
    );
    checks.push(...collectChecks(christoffelCheck));
    const riemannChecks = await postJson(
      baseUrl,
      "/physics/check-riemann-symmetries",
      metric,
    );
    checks.push(...collectChecks(riemannChecks));
    const bianchiCheck = await postJson(
      baseUrl,
      "/physics/check-contracted-bianchi",
      metric,
    );
    checks.push(...collectChecks(bianchiCheck));
    const vacuumSamples =
      input.vacuum_sample_points ??
      (sample
        ? [
            {
              t: sample.t_s ?? 0,
              x: sample.x_m ?? 0,
              y: sample.y_m ?? 0,
              z: sample.z_m ?? 0,
            },
          ]
        : undefined);
    const vacuumPayload: Record<string, unknown> = { metric };
    if (vacuumSamples) vacuumPayload.sample_points = vacuumSamples;
    if (input.vacuum_epsilon !== undefined) {
      vacuumPayload.epsilon = input.vacuum_epsilon;
    }
    const vacuumCheck = await postJson(
      baseUrl,
      "/physics/check-vacuum",
      vacuumPayload,
    );
    checks.push(...collectChecks(vacuumCheck));
  }

  if (input.unit_check) {
    const registryUnits = buildSymbolUnitsFromRegistry({
      tags: input.unit_check.unit_tags,
      modules: input.unit_check.unit_modules,
      includeConstants: true,
    });
    const symbolUnits = mergeSymbolUnits(
      input.unit_check.symbol_units,
      registryUnits,
    );
    const unitPayload = {
      expression: input.unit_check.expression,
      unit_system: input.unit_check.unit_system ?? "SI",
      symbol_units: symbolUnits,
    };
    const unitCheck = await postJson(baseUrl, "/physics/unit-check", unitPayload);
    checks.push(...collectChecks(unitCheck));
  }

  const normalizedChecks = dedupeChecks(checks);
  const failedChecks = normalizedChecks.filter((check) => !check.passed);
  const report = {
    source,
    assumptions: {
      coords: Array.isArray(metric.coords) ? metric.coords : [],
      signature: metric.signature ?? "-+++",
      units_internal: "geometrized",
    },
    metric,
    artifacts,
    checks: normalizedChecks,
    failed_checks: failedChecks,
    invariants,
    ...(brickInvariants ? { brick_invariants: brickInvariants } : {}),
    ...(sample ? { sample } : {}),
    passed: failedChecks.length === 0,
  };

  const gate = await buildGateReport({
    diagnostics,
    warpConfig,
    thresholds: input.thresholds,
    policy: input.policy,
    useLiveSnapshot: input.useLiveSnapshot,
  });

  const overallPass = report.passed && gate.grounding.pass;
  const traceId = input.traceId ?? `gr-assistant:${randomUUID()}`;
  let trainingTraceId: string | undefined;
  try {
    const firstFail = pickFirstFail(gate.grounding.constraints);
    const record = recordTrainingTrace({
      traceId,
      source: {
        system: "gr-assistant",
        component: "physics.gr.assistant",
        tool: GR_ASSISTANT_TOOL_NAME,
        version: "v1",
        proxy: gate.grounding.proxy ?? false,
      },
      signal: {
        kind: "gr-assistant",
        proxy: gate.grounding.proxy ?? false,
        ladder: {
          tier: overallPass ? "certified" : "diagnostic",
          policy: "gr-constraint-gate",
          policyVersion: gate.grounding.policyVersion,
        },
      },
      pass: overallPass,
      deltas: [],
      metrics: {
        check_count: normalizedChecks.length,
        failed_checks: failedChecks.length,
        artifact_count: artifacts.length,
        source,
      },
      firstFail: firstFail
        ? {
            id: firstFail.id,
            severity: firstFail.severity,
            status: firstFail.status,
            value:
              typeof firstFail.value === "number" ? firstFail.value : null,
            limit: firstFail.limit ?? null,
            note: firstFail.note,
          }
        : undefined,
      certificate: {
        status: gate.grounding.certificate.status,
        certificateHash: gate.grounding.certificate.certificateHash ?? null,
        certificateId: gate.grounding.certificate.certificateId ?? null,
        integrityOk: gate.grounding.certificate.integrityOk,
      },
      notes: gate.grounding.notes,
    });
    trainingTraceId = record.id;
  } catch (error) {
    console.warn("[gr-assistant] training trace emit failed", error);
  }

  const citations = [
    "tools/gr_assistant/README.md",
    "WARP_AGENTS.md",
  ];

  return GrAssistantOutput.parse({
    report,
    gate: gate.grounding,
    citations,
    trace_id: traceId,
    training_trace_id: trainingTraceId,
  });
};
