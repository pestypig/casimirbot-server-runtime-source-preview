import { z } from "zod";
import { C } from "@shared/physics-const";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildBackgroundGeometryFromBodyKappa,
  buildDynamicForcingGeometryFromDriveKappa,
} from "@shared/curvature-proxy";
import { buildQuantumSemiclassicalComparisonResult } from "@shared/quantum-semiclassical-comparison";
import {
  CollapseBenchmarkInput,
  CollapseBenchmarkResult,
  CollapseBenchmarkRunInput,
  LatticeSummary,
  collapseBenchmarkDiagnostics,
  collapseTriggerDecision,
  deriveRcFromLatticeSummary,
  estimateTauRcFromCurvature,
  hazardProbability,
  type CollapseCurvatureHeuristicResult,
  type DerivedRcFromLatticeSummary,
  type TCollapseBenchmarkInput,
  type TCollapseBenchmarkRunInput,
  type TCollapseRcSource,
  type TCollapseTauSource,
  type TLatticeSummary,
} from "@shared/collapse-benchmark";
import { computeDpCollapse, type DpCollapseResult, type TDpCollapseInput } from "@shared/dp-collapse";
import { type CardLatticeMetadata } from "@shared/schema";
import { withDerivedArtifactInformationBoundary } from "@shared/information-boundary-derived";
import { buildInformationBoundary } from "../utils/information-boundary";
import { buildDpInputFromAdapter } from "./dp-adapters";
import { resolveQuantumSemiclassicalSourceReplay } from "./quantum-semiclassical-source-replay";

const coerceQueryString = (v: unknown) => {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
};

const BenchmarkQuerySchema = z.object({
  asOf: z.preprocess(coerceQueryString, z.string().optional()),
});

export function resolveDataCutoffIso(rawQuery: unknown): string {
  const parsed = BenchmarkQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return new Date().toISOString();
  const asOf = parsed.data.asOf?.trim();
  if (!asOf) return new Date().toISOString();
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) {
    throw new Error("asOf must be an ISO timestamp");
  }
  return new Date(t).toISOString();
}

export type CollapseResolveOptions = {
  tau_ms_override?: number;
  tau_source?: TCollapseTauSource;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const readDpConstraintsFromEnv = (): TDpCollapseInput["constraints"] | undefined => {
  const toNum = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const heating = toNum(process.env.DP_HEATING_W_KG_MAX);
  const diffusion = toNum(process.env.DP_MOMENTUM_DIFFUSION_MAX);
  const forceNoise = toNum(process.env.DP_FORCE_NOISE_MAX);
  if (heating == null && diffusion == null && forceNoise == null) return undefined;
  return {
    heating_W_kg_max: heating,
    momentum_diffusion_kg2_m2_s3_max: diffusion,
    force_noise_N2_Hz_max: forceNoise,
  };
};


export function latticeSummaryFromCardMetadata(meta: CardLatticeMetadata | null | undefined): TLatticeSummary | null {
  if (!meta?.frame?.dims || !meta.frame?.voxelSize_m) return null;
  const dims = meta.frame.dims as [number, number, number];
  const voxel_size_m = meta.frame.voxelSize_m;
  const hash = meta.hashes?.volume ?? meta.hashes?.sdf ?? meta.hashes?.weights ?? meta.hashes?.strobe;
  if (!hash) return null;

  const summary: TLatticeSummary = {
    lattice_generation_hash: String(hash),
    dims,
    voxel_size_m,
    ...(Array.isArray(meta.frame.latticeSize) && meta.frame.latticeSize.length === 3
      ? { lattice_size_m: meta.frame.latticeSize as [number, number, number] }
      : {}),
    ...(meta.stats?.coverage != null && Number.isFinite(meta.stats.coverage)
      ? { coverage: clamp01(meta.stats.coverage) }
      : {}),
    ...(Number.isFinite(meta.band_m ?? NaN) ? { shell_radius_estimate_m: meta.band_m as number } : {}),
  };

  try {
    return LatticeSummary.parse(summary);
  } catch {
    return null;
  }
}

export async function loadLatticeSummaryFromSidecar(sidecarPath: string): Promise<TLatticeSummary | null> {
  if (!sidecarPath) return null;
  const resolvedPath = path.isAbsolute(sidecarPath) ? sidecarPath : path.resolve(process.cwd(), sidecarPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const meta: CardLatticeMetadata | null =
    (parsed?.lattice?.meta as CardLatticeMetadata | null | undefined) ??
    (parsed?.meta as CardLatticeMetadata | null | undefined) ??
    null;
  return latticeSummaryFromCardMetadata(meta);
}

export type ResolvedCollapseParams = {
  dt_ms: number;
  tau_ms: number;
  tau_source: TCollapseTauSource;
  r_c_m: number;
  r_c_source: TCollapseRcSource;
  c_mps: number;
  lattice_generation_hash?: string;
  rc_proxy?: DerivedRcFromLatticeSummary["rc_proxy"];
  lattice_summary?: TCollapseBenchmarkInput["lattice"];
  estimator?: (CollapseCurvatureHeuristicResult & { mode: "curvature_heuristic" }) | null;
  dp_result?: DpCollapseResult | null;
  dp_input?: TDpCollapseInput | null;
};

type CollapseInputLike = (TCollapseBenchmarkInput | TCollapseBenchmarkRunInput) & {
  expected_lattice_generation_hash?: string;
};

function buildCollapseGeometryChannels(input: CollapseInputLike) {
  const backgroundGeometry =
    typeof input.tau_estimator?.kappa_body_m2 === "number" && Number.isFinite(input.tau_estimator.kappa_body_m2)
      ? buildBackgroundGeometryFromBodyKappa({
          kappaBodyM2: input.tau_estimator.kappa_body_m2,
          sourceQuantityId: "tau_estimator.kappa_body_m2",
          note:
            "Background geometry for the curvature-coupled collapse benchmark. The body channel remains separate from any drive channel.",
        })
      : null;

  const dynamicForcingGeometry =
    typeof input.tau_estimator?.kappa_drive_m2 === "number" && Number.isFinite(input.tau_estimator.kappa_drive_m2)
      ? buildDynamicForcingGeometryFromDriveKappa({
          kappaDriveM2: input.tau_estimator.kappa_drive_m2,
          sourceQuantityId: "tau_estimator.kappa_drive_m2",
          note:
            "Dynamic forcing geometry for the curvature-coupled collapse benchmark. This remains separate from the background body channel.",
        })
      : null;

  return {
    backgroundGeometry,
    dynamicForcingGeometry,
    geometryCoupling: backgroundGeometry,
  };
}

export function resolveCollapseParams(input: CollapseInputLike, opts: CollapseResolveOptions = {}): ResolvedCollapseParams {
  const c_mps = input.c_mps ?? C;
  const expected = input.expected_lattice_generation_hash?.trim();
  const lattice_generation_hash = input.lattice?.lattice_generation_hash?.trim();

  if (expected && lattice_generation_hash && expected !== lattice_generation_hash) {
    const err = new Error(
      `stale lattice_generation_hash (expected ${expected}, got ${lattice_generation_hash})`,
    ) as Error & { status?: number; code?: string; expected?: string; got?: string };
    err.status = 409;
    err.code = "stale_lattice_generation_hash";
    err.expected = expected;
    err.got = lattice_generation_hash;
    throw err;
  }

  const derived = input.lattice ? deriveRcFromLatticeSummary(input.lattice) : undefined;

  const dpConstraints = readDpConstraintsFromEnv();
  const dpAdapterInput = input.dp_adapter ? buildDpInputFromAdapter(input.dp_adapter) : null;
  const dpInputRaw = input.dp ?? dpAdapterInput;
  const dpInput = dpInputRaw
    ? dpConstraints && !dpInputRaw.constraints
      ? { ...dpInputRaw, constraints: dpConstraints }
      : dpInputRaw
    : null;
  const dpResult = dpInput ? computeDpCollapse(dpInput) : null;
  const dpTauMs = dpResult?.tau_ms;
  const dpRc = dpInput?.r_c_m ?? dpInput?.ell_m;

  const estimatorResult = input.tau_estimator
    ? estimateTauRcFromCurvature({
        ...input.tau_estimator,
        r_c_hint_m: input.tau_estimator.r_c_hint_m ?? input.r_c_m ?? derived?.r_c_m,
        r_c_lattice_m: input.tau_estimator.r_c_lattice_m ?? derived?.r_c_m,
        tau_hint_ms: input.tau_estimator.tau_hint_ms ?? input.tau_ms,
      })
    : null;

  const tau_from_estimator = estimatorResult?.tau_ms;
  const rc_from_estimator = estimatorResult?.r_c_m;

  const tau_override = opts.tau_ms_override;
  const tau_ms = tau_override ?? input.tau_ms ?? dpTauMs ?? tau_from_estimator;
  let tau_source: TCollapseTauSource =
    opts.tau_source ??
    (input.tau_ms != null
      ? "manual"
      : dpTauMs != null
        ? "dp_deltaE"
        : input.tau_ms == null && estimatorResult
          ? "field_estimator"
          : "manual");
  if (opts.tau_ms_override != null && opts.tau_source == null) {
    tau_source = "session_dp_tau";
  }

  let r_c_m = input.r_c_m ?? dpRc ?? derived?.r_c_m;
  let r_c_source: TCollapseRcSource =
    input.r_c_m != null ? "manual" : dpRc != null ? "dp_smear" : derived?.r_c_source ?? "manual";
  if (input.tau_estimator && input.r_c_m == null && dpRc == null && rc_from_estimator != null) {
    r_c_m = rc_from_estimator;
    r_c_source = "field_estimator";
  } else if (r_c_m == null && estimatorResult) {
    r_c_m = estimatorResult.r_c_m;
    r_c_source = "field_estimator";
  }

  if (tau_ms == null || !Number.isFinite(tau_ms) || tau_ms <= 0) {
    throw new Error("tau_ms is required after resolving estimator defaults");
  }
  if (r_c_m == null || !Number.isFinite(r_c_m) || r_c_m <= 0) {
    throw new Error("r_c_m is required after resolving estimator or lattice defaults");
  }

  return {
    dt_ms: input.dt_ms,
    tau_ms,
    tau_source,
    r_c_m,
    r_c_source,
    c_mps,
    lattice_generation_hash,
    rc_proxy: derived?.rc_proxy,
    lattice_summary: input.lattice,
    estimator: estimatorResult ? { ...estimatorResult, mode: "curvature_heuristic" } : null,
    dp_result: dpResult,
    dp_input: dpInput ?? null,
  };
}

export function buildCollapseBenchmarkResult(
  input: TCollapseBenchmarkInput,
  data_cutoff_iso: string,
  resolveOpts: CollapseResolveOptions = {},
) {
  const resolved = resolveCollapseParams(input, resolveOpts);
  const diagnostics = collapseBenchmarkDiagnostics({
    tau_ms: resolved.tau_ms,
    r_c_m: resolved.r_c_m,
    c_mps: resolved.c_mps,
  });

  const p_trigger = hazardProbability(resolved.dt_ms, resolved.tau_ms);
  const estimator = resolved.estimator ?? undefined;
  const dpResult = resolved.dp_result ?? undefined;
  const geometry = buildCollapseGeometryChannels(input);
  const quantumSourceReplay = resolveQuantumSemiclassicalSourceReplay(input.quantum_semiclassical_source_replay_id);
  if (input.quantum_semiclassical_source_replay_id && !quantumSourceReplay) {
    throw new Error(`unknown quantum_semiclassical_source_replay_id: ${input.quantum_semiclassical_source_replay_id}`);
  }
  const quantumComparison = quantumSourceReplay
    ? buildQuantumSemiclassicalComparisonResult({
        schema_version: "quantum_semiclassical_comparison/1",
        tau_or_predicted_s: diagnostics.tau_s,
        tau_measurement_proxy_s: quantumSourceReplay.tau_measurement_proxy_s,
        measurement_timescale_kind: quantumSourceReplay.measurement_timescale_kind,
        microtubule_transport_length_m: quantumSourceReplay.microtubule_transport_length_m,
        subharmonic_lock_ratio: quantumSourceReplay.subharmonic_lock_ratio,
        time_crystal_signature_pass: quantumSourceReplay.time_crystal_signature_pass,
        notes: [
          `source_replay_profile=${quantumSourceReplay.profile_id}`,
          ...quantumSourceReplay.notes,
        ],
      })
    : null;

  const rawArtifact = {
    schema_version: "collapse_benchmark/1" as const,
    kind: "collapse_benchmark" as const,
    dt_ms: resolved.dt_ms,
    tau_ms: resolved.tau_ms,
    tau_source: resolved.tau_source,
    r_c_m: resolved.r_c_m,
    r_c_source: resolved.r_c_source,
    c_mps: resolved.c_mps,
    ...(resolved.lattice_generation_hash ? { lattice_generation_hash: resolved.lattice_generation_hash } : {}),
    p_trigger,
    L_present_m: diagnostics.L_present_m,
    kappa_present_m2: diagnostics.kappa_present_m2,
    diagnostics,
    ...(geometry.backgroundGeometry ? { background_geometry: geometry.backgroundGeometry } : {}),
    ...(geometry.dynamicForcingGeometry ? { dynamic_forcing_geometry: geometry.dynamicForcingGeometry } : {}),
    ...(geometry.geometryCoupling ? { geometry_coupling: geometry.geometryCoupling } : {}),
    ...(quantumSourceReplay ? { quantum_semiclassical_source_replay: quantumSourceReplay } : {}),
    ...(quantumComparison ? { quantum_semiclassical_comparison: quantumComparison } : {}),
    ...(dpResult ? { dp: dpResult } : {}),
    ...(estimator ? { tau_estimator: { ...estimator } } : {}),
  };

  const informationBoundary = buildInformationBoundary({
    data_cutoff_iso,
    mode: "observables",
    labels_used_as_features: false,
    event_features_included: false,
    inputs: {
      kind: "collapse_benchmark",
      v: 1,
      input: {
        dt_ms: resolved.dt_ms,
        tau_ms: resolved.tau_ms,
        r_c_m: resolved.r_c_m,
        c_mps: resolved.c_mps,
        tau_source: resolved.tau_source,
        r_c_source: resolved.r_c_source,
        ...(resolved.lattice_generation_hash ? { lattice_generation_hash: resolved.lattice_generation_hash } : {}),
        ...(resolved.rc_proxy ? { r_c_proxy: resolved.rc_proxy } : {}),
        ...(resolved.lattice_summary ? { lattice_summary: resolved.lattice_summary } : {}),
        ...(dpResult ? { dp: dpResult } : {}),
        ...(estimator ? { estimator } : {}),
      },
    },
    features: {
      kind: "collapse_benchmark",
      v: 1,
      output: {
        p_trigger,
        L_present_m: diagnostics.L_present_m,
        kappa_present_m2: diagnostics.kappa_present_m2,
        ...(quantumSourceReplay ? { quantum_semiclassical_source_replay: quantumSourceReplay } : {}),
        ...(quantumComparison ? { quantum_semiclassical_comparison: quantumComparison } : {}),
        ...(dpResult ? { dp: dpResult } : {}),
        ...(estimator ? { estimator } : {}),
      },
    },
  });

  const withIb = withDerivedArtifactInformationBoundary(rawArtifact, informationBoundary);
  return CollapseBenchmarkResult.parse(withIb);
}

export function buildCollapseBenchmarkExplain(
  input: TCollapseBenchmarkInput,
  data_cutoff_iso: string,
  resolveOpts: CollapseResolveOptions = {},
) {
  const resolved = resolveCollapseParams(input, resolveOpts);
  const diagnostics = collapseBenchmarkDiagnostics({
    tau_ms: resolved.tau_ms,
    r_c_m: resolved.r_c_m,
    c_mps: resolved.c_mps,
  });
  const p_trigger = hazardProbability(resolved.dt_ms, resolved.tau_ms);
  const estimator = resolved.estimator ?? undefined;
  const dpResult = resolved.dp_result ?? undefined;
  const geometry = buildCollapseGeometryChannels(input);

  const informationBoundary = buildInformationBoundary({
    data_cutoff_iso,
    mode: "observables",
    labels_used_as_features: false,
    event_features_included: false,
    inputs: {
      kind: "collapse_benchmark_explain",
      v: 1,
      input,
      resolved,
    },
    features: {
      kind: "collapse_benchmark_explain",
      v: 1,
      resolved: {
        tau_ms: resolved.tau_ms,
        r_c_m: resolved.r_c_m,
        c_mps: resolved.c_mps,
        tau_source: resolved.tau_source,
        r_c_source: resolved.r_c_source,
      },
      preview: {
        p_trigger,
        L_present_m: diagnostics.L_present_m,
        kappa_present_m2: diagnostics.kappa_present_m2,
      },
      ...(dpResult ? { dp: dpResult } : {}),
      ...(estimator ? { estimator } : {}),
    },
  });

  return {
    ok: true,
    resolved: {
      tau_ms: resolved.tau_ms,
      r_c_m: resolved.r_c_m,
      c_mps: resolved.c_mps,
    },
    tau_source: resolved.tau_source,
    r_c_source: resolved.r_c_source,
    ...(resolved.lattice_generation_hash ? { lattice_generation_hash: resolved.lattice_generation_hash } : {}),
    data_cutoff_iso: informationBoundary.data_cutoff_iso,
    inputs_hash: informationBoundary.inputs_hash,
    features_hash: informationBoundary.features_hash,
    information_boundary: informationBoundary,
    preview: {
      p_trigger,
      L_present_m: diagnostics.L_present_m,
      kappa_present_m2: diagnostics.kappa_present_m2,
    },
    ...(geometry.backgroundGeometry ? { background_geometry: geometry.backgroundGeometry } : {}),
    ...(geometry.dynamicForcingGeometry ? { dynamic_forcing_geometry: geometry.dynamicForcingGeometry } : {}),
    ...(geometry.geometryCoupling ? { geometry_coupling: geometry.geometryCoupling } : {}),
    ...(dpResult ? { dp: dpResult } : {}),
    ...(estimator ? { tau_estimator: estimator } : {}),
  };
}

export function executeCollapseRun(
  input: TCollapseBenchmarkRunInput,
  data_cutoff_iso: string,
  resolveOpts: CollapseResolveOptions = {},
) {
  const steps = input.steps;
  const seed = input.seed ?? "seed:default";
  const bins = input.histogram_bins ?? 20;

  const resolved = resolveCollapseParams(input, resolveOpts);
  const p_trigger = hazardProbability(input.dt_ms, resolved.tau_ms);
  const c_mps = resolved.c_mps ?? C;
  const estimator = resolved.estimator ?? undefined;
  const dpResult = resolved.dp_result ?? undefined;
  const geometry = buildCollapseGeometryChannels(input);

  const histogram_u_counts = Array.from({ length: bins }, () => 0);
  let trigger_count = 0;
  let u_sum = 0;
  let u_min = 1;
  let u_max = 0;
  const sample: Array<{ step_index: number; u: number; trigger: boolean }> = [];
  const sampleLimit = Math.min(16, steps);

  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    const decision = collapseTriggerDecision(seed, stepIndex, p_trigger);
    const u = decision.u;
    u_sum += u;
    if (u < u_min) u_min = u;
    if (u > u_max) u_max = u;
    if (decision.trigger) trigger_count += 1;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(u * bins)));
    histogram_u_counts[b] += 1;
    if (stepIndex < sampleLimit) {
      sample.push({ step_index: decision.step_index, u: decision.u, trigger: decision.trigger });
    }
  }

  const mean_u = steps > 0 ? u_sum / steps : 0;
  const trigger_rate = steps > 0 ? trigger_count / steps : 0;

  const diagnostics = collapseBenchmarkDiagnostics({
    tau_ms: resolved.tau_ms,
    r_c_m: resolved.r_c_m,
    c_mps,
  });

  const informationBoundary = buildInformationBoundary({
    data_cutoff_iso,
    mode: "observables",
    labels_used_as_features: false,
    event_features_included: false,
    inputs: {
      kind: "collapse_benchmark_run",
      v: 1,
      prng: "fnv1a32+mulberry32@1",
      steps,
      dt_ms: input.dt_ms,
      tau_ms: resolved.tau_ms,
      r_c_m: resolved.r_c_m,
      c_mps,
      seed,
      histogram_bins: bins,
      tau_source: resolved.tau_source,
      r_c_source: resolved.r_c_source,
      ...(resolved.lattice_generation_hash ? { lattice_generation_hash: resolved.lattice_generation_hash } : {}),
      ...(resolved.rc_proxy ? { r_c_proxy: resolved.rc_proxy } : {}),
      ...(resolved.lattice_summary ? { lattice_summary: resolved.lattice_summary } : {}),
      ...(dpResult ? { dp: dpResult } : {}),
      ...(estimator ? { estimator } : {}),
    },
    features: {
      kind: "collapse_benchmark_run",
      v: 1,
      p_trigger,
      trigger_count,
      trigger_rate,
      u: { mean: mean_u, min: u_min, max: u_max },
      histogram_u_counts,
      sample,
      diagnostics: {
        L_present_m: diagnostics.L_present_m,
        kappa_present_m2: diagnostics.kappa_present_m2,
      },
      ...(dpResult ? { dp: dpResult } : {}),
      ...(estimator ? { estimator } : {}),
    },
  });

  return {
    ok: true,
    schema_version: "collapse_benchmark_run/1" as const,
    dt_ms: input.dt_ms,
    tau_ms: resolved.tau_ms,
    tau_source: resolved.tau_source,
    r_c_m: resolved.r_c_m,
    r_c_source: resolved.r_c_source,
    c_mps,
    steps,
    seed,
    ...(resolved.lattice_generation_hash ? { lattice_generation_hash: resolved.lattice_generation_hash } : {}),
    p_trigger,
    L_present_m: diagnostics.L_present_m,
    kappa_present_m2: diagnostics.kappa_present_m2,
    ...(geometry.backgroundGeometry ? { background_geometry: geometry.backgroundGeometry } : {}),
    ...(geometry.dynamicForcingGeometry ? { dynamic_forcing_geometry: geometry.dynamicForcingGeometry } : {}),
    ...(geometry.geometryCoupling ? { geometry_coupling: geometry.geometryCoupling } : {}),
    trigger_count,
    trigger_rate,
    u: { mean: mean_u, min: u_min, max: u_max },
    histogram_u: {
      bins,
      counts: histogram_u_counts,
    },
    sample,
    data_cutoff_iso: informationBoundary.data_cutoff_iso,
    inputs_hash: informationBoundary.inputs_hash,
    features_hash: informationBoundary.features_hash,
    information_boundary: informationBoundary,
    ...(dpResult ? { dp: dpResult } : {}),
    ...(estimator ? { tau_estimator: estimator } : {}),
  };
}
