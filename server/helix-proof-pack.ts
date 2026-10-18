import {
  buildBackgroundGeometryFromEnergyDensity,
  buildDynamicForcingGeometryFromPower,
  kappa_drive_from_power,
} from "../shared/curvature-proxy.js";
import { GEOM_TO_SI_STRESS, SI_TO_GEOM_STRESS } from "../shared/gr-units.js";
import { buildQuantumSemiclassicalComparisonResult } from "../shared/quantum-semiclassical-comparison.js";
import type { ProofPack, ProofValue } from "../shared/schema.js";
import { deriveWarpMetricFamilySemantics } from "../modules/warp/warp-metric-adapter.js";
import { PAPER_GEO, type EnergyPipelineState } from "./energy-pipeline.js";
import { resolveQuantumSemiclassicalSourceReplay } from "./services/quantum-semiclassical-source-replay.js";

type NumberCandidate = {
  value: unknown;
  source: string;
  proxy?: boolean;
  scale?: number;
  fromUnit?: string;
};

type ResolvedNumber = {
  value: number | null;
  source: string;
  proxy: boolean;
  basis?: Record<string, string>;
};

const toFiniteNumber = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const resolveCl3Threshold = (): number => {
  const raw = Number(process.env.WARP_CL3_RHO_DELTA_MAX);
  return Number.isFinite(raw) ? raw : 0.1;
};

const strictCongruenceEnabled = (): boolean =>
  process.env.WARP_STRICT_CONGRUENCE !== "0";
const VDB_BPRIME_MIN_ABS = Number.isFinite(Number(process.env.WARP_VDB_BPRIME_MIN_ABS))
  ? Number(process.env.WARP_VDB_BPRIME_MIN_ABS)
  : 1e-18;
const VDB_BDOUBLE_MIN_ABS = Number.isFinite(Number(process.env.WARP_VDB_BDOUBLE_MIN_ABS))
  ? Number(process.env.WARP_VDB_BDOUBLE_MIN_ABS)
  : 1e-18;

const qiSourceIsMetric = (source: unknown): boolean => {
  if (typeof source !== "string") return false;
  return (
    source.startsWith("warp.metric") ||
    source.startsWith("gr.metric") ||
    source.startsWith("gr.rho_constraint")
  );
};

const resolveVdbDerivativeMaxAbs = (
  region: any,
  minKey: "bprime_min" | "bdouble_min",
  maxKey: "bprime_max" | "bdouble_max",
): number | null => {
  const minValue = toFiniteNumber(region?.[minKey]);
  const maxValue = toFiniteNumber(region?.[maxKey]);
  if (minValue == null && maxValue == null) return null;
  return Math.max(Math.abs(minValue ?? 0), Math.abs(maxValue ?? 0));
};

const hasVdbRegionIIMetricSupport = (region: any): boolean => {
  if (region?.support !== true) return false;
  const t00Mean = toFiniteNumber(region?.t00_mean);
  const sampleCount = toFiniteNumber(region?.sampleCount);
  const bprimeMaxAbs = resolveVdbDerivativeMaxAbs(region, "bprime_min", "bprime_max");
  const bdoubleMaxAbs = resolveVdbDerivativeMaxAbs(region, "bdouble_min", "bdouble_max");
  return (
    t00Mean != null &&
    sampleCount != null &&
    sampleCount > 0 &&
    bprimeMaxAbs != null &&
    bprimeMaxAbs > VDB_BPRIME_MIN_ABS &&
    bdoubleMaxAbs != null &&
    bdoubleMaxAbs > VDB_BDOUBLE_MIN_ABS
  );
};

const resolveNumber = (candidates: NumberCandidate[]): ResolvedNumber => {
  for (const candidate of candidates) {
    const raw = toFiniteNumber(candidate.value);
    if (raw == null) continue;
    const scaled =
      typeof candidate.scale === "number" ? raw * candidate.scale : raw;
    const basis =
      typeof candidate.scale === "number"
        ? {
            from: candidate.fromUnit ?? "unknown",
            scale: String(candidate.scale),
          }
        : undefined;
    return {
      value: scaled,
      source: candidate.source,
      proxy: candidate.proxy ?? false,
      basis,
    };
  }
  return { value: null, source: "missing", proxy: true };
};

const resolveBoolean = (value: unknown, source: string): ProofValue => {
  if (typeof value === "boolean") {
    return { value, source, proxy: false };
  }
  return { value: null, source: "missing", proxy: true };
};

const makeValue = (
  resolved: ResolvedNumber,
  unit?: string,
  note?: string,
): ProofValue => {
  const entry: ProofValue = {
    value: resolved.value,
    unit,
    source: resolved.source,
    proxy: resolved.proxy,
  };
  if (resolved.basis) entry.basis = resolved.basis;
  if (note) entry.note = note;
  return entry;
};

const makeDerivedNumber = (
  value: number | null,
  unit: string,
  source: string,
  proxy: boolean,
  note?: string,
): ProofValue => ({
  value,
  unit,
  source,
  proxy,
  note,
});

const makeStringValue = (
  value: unknown,
  source: string,
  proxy: boolean,
  note?: string,
): ProofValue => ({
  value: value == null ? null : String(value),
  source: value == null ? "missing" : source,
  proxy: value == null ? true : proxy,
  note,
});

const emitInvariantStats = (
  values: Record<string, ProofValue>,
  prefix: string,
  stats: {
    min: number;
    max: number;
    mean: number;
    p98: number;
    sampleCount: number;
    abs: boolean;
    wallFraction: number;
    bandFraction: number;
    threshold: number;
    bandMin: number;
    bandMax: number;
  },
  sourcePrefix: string,
) => {
  const note = "unitSystem=gr";
  values[`${prefix}_min`] = makeDerivedNumber(
    stats.min,
    "1",
    `${sourcePrefix}.min`,
    false,
    note,
  );
  values[`${prefix}_max`] = makeDerivedNumber(
    stats.max,
    "1",
    `${sourcePrefix}.max`,
    false,
    note,
  );
  values[`${prefix}_mean`] = makeDerivedNumber(
    stats.mean,
    "1",
    `${sourcePrefix}.mean`,
    false,
    note,
  );
  values[`${prefix}_p98`] = makeDerivedNumber(
    stats.p98,
    "1",
    `${sourcePrefix}.p98`,
    false,
    note,
  );
  values[`${prefix}_sample_count`] = makeDerivedNumber(
    stats.sampleCount,
    "1",
    `${sourcePrefix}.sampleCount`,
    false,
  );
  values[`${prefix}_abs`] = {
    value: stats.abs,
    source: `${sourcePrefix}.abs`,
    proxy: false,
  };
  values[`${prefix}_wall_fraction`] = makeDerivedNumber(
    stats.wallFraction,
    "1",
    `${sourcePrefix}.wallFraction`,
    false,
  );
  values[`${prefix}_band_fraction`] = makeDerivedNumber(
    stats.bandFraction,
    "1",
    `${sourcePrefix}.bandFraction`,
    false,
  );
  values[`${prefix}_threshold`] = makeDerivedNumber(
    stats.threshold,
    "1",
    `${sourcePrefix}.threshold`,
    false,
  );
  values[`${prefix}_band_min`] = makeDerivedNumber(
    stats.bandMin,
    "1",
    `${sourcePrefix}.bandMin`,
    false,
  );
  values[`${prefix}_band_max`] = makeDerivedNumber(
    stats.bandMax,
    "1",
    `${sourcePrefix}.bandMax`,
    false,
  );
};

const relDelta = (current: number, baseline: number, eps = 1e-12) =>
  Math.abs(current - baseline) / Math.max(eps, Math.abs(baseline));

const computeInvariantDelta = (
  current?: {
    mean: number;
    p98: number;
  },
  baseline?: {
    mean: number;
    p98: number;
  },
) => {
  if (!current || !baseline) return null;
  return {
    mean: relDelta(current.mean, baseline.mean),
    p98: relDelta(current.p98, baseline.p98),
  };
};

const resolveHullDims = (state: EnergyPipelineState) => {
  const hull = state.hull;
  const Lx = resolveNumber([
    { value: hull?.Lx_m, source: "hull.Lx_m" },
    { value: (state as any).Lx_m, source: "state.Lx_m", proxy: true },
  ]);
  const Ly = resolveNumber([
    { value: hull?.Ly_m, source: "hull.Ly_m" },
    { value: (state as any).Ly_m, source: "state.Ly_m", proxy: true },
  ]);
  const Lz = resolveNumber([
    { value: hull?.Lz_m, source: "hull.Lz_m" },
    { value: (state as any).Lz_m, source: "state.Lz_m", proxy: true },
  ]);
  const wall = resolveNumber([
    { value: hull?.wallThickness_m, source: "hull.wallThickness_m" },
    { value: (state as any).wallThickness_m, source: "state.wallThickness_m", proxy: true },
  ]);
  return { Lx, Ly, Lz, wall };
};

export function buildProofPack(state: EnergyPipelineState): ProofPack {
  const values: Record<string, ProofValue> = {};
  const notes: string[] = [];
  const NATARIO_EXPANSION_TOLERANCE = 1e-3;
  const THETA_K_TOLERANCE = 1e-3;

  values.theta_definition = makeStringValue(
    "theta := div(beta) in comoving_cartesian with Eulerian normal n",
    "config:strict_provenance.theta_definition",
    false,
  );
  values.kij_sign_convention = makeStringValue(
    "ADM sign: K_ij = -(1/2) * L_n gamma_ij",
    "config:strict_provenance.kij_sign_convention",
    false,
  );
  values.gamma_field_naming = makeStringValue(
    "gamma_phys_{ij} (physical metric), tilde_gamma_{ij} (conformal metric), phi (conformal factor)",
    "config:strict_provenance.gamma_field_naming",
    false,
  );
  values.field_provenance_schema = makeStringValue(
    "fields.<name>.{source,kind,path,proxy,unit}",
    "config:strict_provenance.field_provenance_schema",
    false,
  );

  const modelMode =
    typeof state.modelMode === "string"
      ? state.modelMode
      : typeof (state as any).modelMode === "string"
      ? String((state as any).modelMode)
      : null;
  values.model_mode = makeStringValue(
    modelMode,
    "pipeline.modelMode",
    modelMode == null,
  );

  const power = resolveNumber([
    { value: (state as any).P_avg_W, source: "pipeline.P_avg_W" },
    { value: state.P_avg, source: "pipeline.P_avg", proxy: true, scale: 1e6, fromUnit: "MW" },
    { value: (state as any).P_avg_MW, source: "pipeline.P_avg_MW", proxy: true, scale: 1e6, fromUnit: "MW" },
  ]);
  values.power_avg_W = makeValue(power, "W");
  values.power_avg_MW = makeDerivedNumber(
    power.value == null ? null : power.value / 1e6,
    "MW",
    power.value == null ? "missing" : "derived:power_avg_W",
    power.proxy,
    "converted_from_W",
  );

  const dutyEffective = resolveNumber([
    { value: (state as any).d_eff, source: "pipeline.d_eff" },
    { value: state.dutyEffectiveFR, source: "pipeline.dutyEffectiveFR" },
    { value: state.dutyEffective_FR, source: "pipeline.dutyEffective_FR" },
    { value: state.dutyShip, source: "pipeline.dutyShip", proxy: true },
    { value: state.dutyEff, source: "pipeline.dutyEff", proxy: true },
    { value: state.dutyCycle, source: "pipeline.dutyCycle", proxy: true },
  ]);
  values.duty_effective = makeValue(dutyEffective, "1");

  const dutyBurst = resolveNumber([
    { value: state.dutyBurst, source: "pipeline.dutyBurst" },
    { value: state.localBurstFrac, source: "pipeline.localBurstFrac", proxy: true },
    { value: state.dutyCycle, source: "pipeline.dutyCycle", proxy: true },
  ]);
  values.duty_burst = makeValue(dutyBurst, "1");

  values.sectors_live = makeValue(
    resolveNumber([
      { value: state.concurrentSectors, source: "pipeline.concurrentSectors" },
      { value: state.activeSectors, source: "pipeline.activeSectors", proxy: true },
    ]),
    "1",
  );
  values.sectors_total = makeValue(
    resolveNumber([
      { value: state.sectorCount, source: "pipeline.sectorCount" },
      { value: (state as any).sectorsTotal, source: "pipeline.sectorsTotal", proxy: true },
    ]),
    "1",
  );

  values.phase01 = makeValue(
    resolveNumber([
      { value: (state as any).phase01, source: "pipeline.phase01" },
      { value: (state as any).hardwareTruth?.sectorState?.phaseCont, source: "pipeline.hardwareTruth.sectorState.phaseCont", proxy: true },
    ]),
    "1",
  );
  values.lobe_count = makeValue(
    resolveNumber([
      { value: (state as any).lobeCount, source: "pipeline.lobeCount" },
      { value: (state as any).hardwareTruth?.sectorState?.lobeCount, source: "pipeline.hardwareTruth.sectorState.lobeCount", proxy: true },
    ]),
    "1",
  );
  values.lobe_mask = makeStringValue(
    (state as any).lobeMask ?? (state as any).hardwareTruth?.sectorState?.lobeMask ?? null,
    (state as any).lobeMask != null
      ? "pipeline.lobeMask"
      : "pipeline.hardwareTruth.sectorState.lobeMask",
    (state as any).lobeMask == null && (state as any).hardwareTruth?.sectorState?.lobeMask == null,
  );
  values.run_id = makeStringValue(
    (state as any).runId ?? (state as any).__runId ?? (state as any).traceId ?? null,
    "pipeline.runId",
    (state as any).runId == null && (state as any).__runId == null && (state as any).traceId == null,
  );
  values.rendering_seed = makeStringValue(
    (state as any).renderingSeed ?? (state as any).renderSeed ?? null,
    "pipeline.renderingSeed",
    (state as any).renderingSeed == null && (state as any).renderSeed == null,
  );
  values.training_trace_id = makeStringValue(
    (state as any).training_trace_id ?? (state as any).trainingTraceId ?? null,
    "pipeline.training_trace_id",
    (state as any).training_trace_id == null && (state as any).trainingTraceId == null,
  );

  const lightCrossing = ((state as any).lightCrossing ?? {}) as Record<string, unknown>;
  values.tau_lc_ms = makeValue(
    resolveNumber([
      { value: lightCrossing.tauLC_ms as number | undefined, source: "pipeline.lightCrossing.tauLC_ms" },
      { value: (state as any).tauLC_ms as number | undefined, source: "pipeline.tauLC_ms", proxy: true },
    ]),
    "ms",
  );
  values.tau_pulse_ms = makeValue(
    resolveNumber([
      { value: lightCrossing.burst_ms as number | undefined, source: "pipeline.lightCrossing.burst_ms" },
      { value: (lightCrossing as any).tauPulse_ms as number | undefined, source: "pipeline.lightCrossing.tauPulse_ms", proxy: true },
    ]),
    "ms",
  );
  values.tau_dwell_ms = makeValue(
    resolveNumber([
      { value: lightCrossing.dwell_ms as number | undefined, source: "pipeline.lightCrossing.dwell_ms" },
    ]),
    "ms",
  );

  const gammaGeo = resolveNumber([
    { value: state.gammaGeo, source: "pipeline.gammaGeo" },
    { value: (state as any).ampFactors?.gammaGeo, source: "pipeline.ampFactors.gammaGeo", proxy: true },
  ]);
  values.gamma_geo = makeValue(gammaGeo, "1");
  values.gamma_geo_cubed = makeDerivedNumber(
    gammaGeo.value == null ? null : Math.pow(gammaGeo.value, 3),
    "1",
    "derived:gamma_geo^3",
    gammaGeo.proxy,
  );

  const qCavity = resolveNumber([
    { value: state.qCavity, source: "pipeline.qCavity" },
  ]);
  values.q_cavity = makeValue(qCavity, "1");
  const qGain = resolveNumber([
    { value: state.gammaChain?.qGain, source: "pipeline.gammaChain.qGain" },
  ]);
  if (qGain.value != null) {
    values.q_gain = makeValue(qGain, "1");
  } else {
    const derivedQGain =
      qCavity.value == null ? null : Math.sqrt(Math.max(1, qCavity.value) / 1e9);
    values.q_gain = makeDerivedNumber(
      derivedQGain,
      "1",
      "derived:q_cavity",
      qCavity.proxy,
      "sqrt(Q/1e9)",
    );
  }

  const qSpoil = resolveNumber([
    { value: state.qSpoilingFactor, source: "pipeline.qSpoilingFactor" },
  ]);
  values.q_spoil = makeValue(qSpoil, "1");

  const gammaVdB = resolveNumber([
    { value: (state as any).gammaVanDenBroeck_mass, source: "pipeline.gammaVanDenBroeck_mass" },
    { value: state.gammaVanDenBroeck, source: "pipeline.gammaVanDenBroeck" },
    { value: (state as any).gammaVanDenBroeck_vis, source: "pipeline.gammaVanDenBroeck_vis", proxy: true },
  ]);
  values.gamma_vdb = makeValue(gammaVdB, "1");
  values.gamma_vdb_requested = makeValue(
    resolveNumber([
      { value: state.gammaVanDenBroeckGuard?.requested, source: "pipeline.gammaVanDenBroeckGuard.requested" },
    ]),
    "1",
  );

  const thetaPipelineRaw = resolveNumber([
    { value: (state as any).thetaRaw, source: "pipeline.thetaRaw", proxy: true },
  ]);
  values.theta_pipeline_raw = makeValue(thetaPipelineRaw, "1");
  const thetaPipelineCal = resolveNumber([
    { value: (state as any).thetaCal, source: "pipeline.thetaCal", proxy: true },
    { value: (state as any).thetaScaleExpected, source: "pipeline.thetaScaleExpected", proxy: true },
  ]);
  values.theta_pipeline_cal = makeValue(thetaPipelineCal, "1");
  const metricBeta = (state as any)?.warp?.metricAdapter?.betaDiagnostics;
  const projectionThetaGeom = resolveNumber([
    {
      value: toFiniteNumber((state as any)?.theta_geom_projection),
      source:
        typeof (state as any)?.theta_geom_projection_source === "string" &&
        (state as any).theta_geom_projection_source.length > 0
          ? String((state as any).theta_geom_projection_source)
          : "missing",
      proxy:
        typeof (state as any)?.theta_geom_projection_proxy === "boolean"
          ? Boolean((state as any).theta_geom_projection_proxy)
          : true,
    },
    {
      value: toFiniteNumber(metricBeta?.thetaMax ?? metricBeta?.thetaRms),
      source:
        metricBeta?.thetaMax != null
          ? "pipeline.warp.metricAdapter.betaDiagnostics.thetaMax"
          : "pipeline.warp.metricAdapter.betaDiagnostics.thetaRms",
      proxy: metricBeta?.method === "not-computed",
    },
  ]);
  const thetaGeomResolved = resolveNumber([
    {
      value: toFiniteNumber((state as any)?.theta_geom),
      source:
        typeof (state as any)?.theta_geom_source === "string" &&
        (state as any).theta_geom_source.length > 0
          ? String((state as any).theta_geom_source)
          : "missing",
      proxy:
        typeof (state as any)?.theta_geom_proxy === "boolean"
          ? Boolean((state as any).theta_geom_proxy)
          : true,
    },
    projectionThetaGeom,
  ]);
  const strictThetaEnabled = strictCongruenceEnabled();
  const thetaGeomUsable = thetaGeomResolved.value != null && !thetaGeomResolved.proxy;
  const thetaPipelineProxyResolved = resolveNumber([
    { value: (state as any).thetaCal, source: "pipeline.thetaCal", proxy: true },
    { value: (state as any).thetaScaleExpected, source: "pipeline.thetaScaleExpected", proxy: true },
    { value: (state as any).theta_proxy, source: "pipeline.theta_proxy", proxy: true },
  ]);
  const thetaMetricDerived =
    typeof (state as any)?.theta_metric_derived === "boolean"
      ? Boolean((state as any).theta_metric_derived)
      : thetaGeomUsable;
  const thetaMetricSource =
    typeof (state as any)?.theta_metric_source === "string" &&
    (state as any).theta_metric_source.length > 0
      ? String((state as any).theta_metric_source)
      : thetaGeomUsable
        ? thetaGeomResolved.source
        : "missing";
  const thetaMetricReason =
    typeof (state as any)?.theta_metric_reason === "string" &&
    (state as any).theta_metric_reason.length > 0
      ? String((state as any).theta_metric_reason)
      : thetaGeomUsable
        ? "metric_theta_available"
        : thetaGeomResolved.value == null
          ? "missing_theta_geom"
          : "theta_geom_proxy";
  const thetaAuditResolved = resolveNumber([
    thetaGeomUsable
      ? {
          value: thetaGeomResolved.value,
          source: thetaGeomResolved.source,
          proxy: false,
        }
      : {
          value: undefined,
          source: "missing",
          proxy: true,
        },
    thetaPipelineProxyResolved,
  ]);
  const thetaStrictOk = strictThetaEnabled ? thetaGeomUsable : true;
  const thetaStrictReason = thetaStrictOk
    ? "ok"
    : thetaGeomResolved.value == null
      ? "missing_theta_geom"
      : "theta_geom_proxy";
  if (thetaGeomResolved.value != null) {
    values.theta_geom = makeDerivedNumber(
      thetaGeomResolved.value,
      "1/m",
      thetaGeomResolved.source,
      Boolean(thetaGeomResolved.proxy),
      "theta",
    );
  }
  if (projectionThetaGeom.value != null) {
    values.theta_geom_projection = makeDerivedNumber(
      projectionThetaGeom.value,
      "1/m",
      projectionThetaGeom.source,
      Boolean(projectionThetaGeom.proxy),
      "projection theta",
    );
  }
  values.theta_strict_mode = {
    value: strictThetaEnabled,
    source: "config:WARP_STRICT_CONGRUENCE",
    proxy: false,
  };
  values.theta_strict_ok = {
    value: thetaStrictOk,
    source: "derived:theta_strict_ok",
    proxy: false,
  };
  values.theta_strict_reason = {
    value: thetaStrictReason,
    source: "derived:theta_strict_reason",
    proxy: false,
  };
  values.theta_pipeline_proxy = makeValue(thetaPipelineProxyResolved, "1");
  const thetaMetricOverride = makeDerivedNumber(
    thetaGeomUsable ? thetaGeomResolved.value : null,
    "1/m",
    thetaGeomUsable ? thetaGeomResolved.source : "missing",
    !thetaGeomUsable,
    "metric-derived override (theta)",
  );
  values.theta_raw = thetaMetricOverride;
  values.theta_cal = thetaMetricOverride;
  values.theta_proxy = thetaMetricOverride;
  values.theta_audit = makeValue(thetaAuditResolved, "1");
  values.theta_metric_derived = {
    value: thetaMetricDerived,
    source: "derived:theta_metric_derived",
    proxy: false,
  };
  values.theta_metric_source = makeStringValue(
    thetaMetricSource,
    "derived:theta_metric_source",
    !thetaMetricDerived,
  );
  values.theta_metric_reason = makeStringValue(
    thetaMetricReason,
    "derived:theta_metric_reason",
    !thetaMetricDerived,
  );
  values.theta_metric_authoritative = {
    value: (state as any).theta_metric_authoritative === true,
    source: "derived:theta_metric_authoritative",
    proxy: false,
  };
  values.theta_metric_authoritative_source = makeStringValue(
    (state as any).theta_metric_authoritative_source,
    "derived:theta_metric_authoritative_source",
    (state as any).theta_metric_authoritative !== true,
  );
  values.theta_metric_authoritative_reason = makeStringValue(
    (state as any).theta_metric_authoritative_reason,
    "derived:theta_metric_authoritative_reason",
    (state as any).theta_metric_authoritative !== true,
  );
  values.theta_metric_projection_available = {
    value: (state as any).theta_metric_projection_available === true,
    source: "derived:theta_metric_projection_available",
    proxy: false,
  };
  values.theta_metric_projection_source = makeStringValue(
    (state as any).theta_metric_projection_source,
    "derived:theta_metric_projection_source",
    (state as any).theta_metric_projection_available !== true,
  );
  values.theta_metric_projection_reason = makeStringValue(
    (state as any).theta_metric_projection_reason,
    "derived:theta_metric_projection_reason",
    (state as any).theta_metric_projection_available !== true,
  );
  if (state.gammaChain?.note) {
    values.gamma_chain_note = {
      value: state.gammaChain.note,
      source: "pipeline.gammaChain.note",
      proxy: false,
    };
  }

  values.ts_ratio = makeValue(
    resolveNumber([
      { value: state.TS_ratio, source: "pipeline.TS_ratio" },
      { value: state.TS_long, source: "pipeline.TS_long", proxy: true },
      { value: state.TS_geom, source: "pipeline.TS_geom", proxy: true },
      { value: (state as any).ts?.ratio, source: "pipeline.ts.ratio", proxy: true },
    ]),
    "1",
  );
  const tsMetricDerived = Boolean(
    (state as any)?.tsMetricDerived === true ||
      (state as any)?.ts?.metricDerived === true ||
      (state as any)?.clocking?.metricDerived === true,
  );
  const tsMetricSource =
    (state as any)?.tsMetricDerivedSource ??
    (state as any)?.ts?.metricDerivedSource ??
    (state as any)?.clocking?.metricDerivedSource ??
    "missing";
  const tsMetricReason =
    (state as any)?.tsMetricDerivedReason ??
    (state as any)?.ts?.metricDerivedReason ??
    (state as any)?.clocking?.metricDerivedReason;
  values.ts_metric_derived = {
    value: tsMetricDerived,
    source: "derived:ts_metric_derived",
    proxy: false,
  };
  values.ts_metric_source = makeStringValue(
    tsMetricSource,
    "derived:ts_metric_source",
    !tsMetricDerived,
  );
  values.ts_metric_reason = makeStringValue(
    tsMetricReason,
    "derived:ts_metric_reason",
    !tsMetricDerived,
  );

  values.zeta = makeValue(
    resolveNumber([
      { value: state.zeta, source: "pipeline.zeta" },
      { value: (state as any).qi?.zeta, source: "pipeline.qi.zeta", proxy: true },
    ]),
    "1",
  );
  values.ford_roman_ok = resolveBoolean(
    state.fordRomanCompliance,
    "pipeline.fordRomanCompliance",
  );
  const qiGuard = (state as any)?.qiGuardrail ?? {};
  const qiRhoSource =
    typeof qiGuard?.rhoSource === "string" ? String(qiGuard.rhoSource) : null;
  const qiMetricDerived =
    typeof qiGuard?.metricDerived === "boolean"
      ? Boolean(qiGuard.metricDerived)
      : qiSourceIsMetric(qiRhoSource);
  const qiMetricSource =
    typeof qiGuard?.metricDerivedSource === "string"
      ? String(qiGuard.metricDerivedSource)
      : typeof qiRhoSource === "string"
      ? qiRhoSource
      : "missing";
  const qiMetricReason =
    typeof qiGuard?.metricDerivedReason === "string"
      ? String(qiGuard.metricDerivedReason)
      : qiMetricDerived
      ? "metric-derived"
      : "proxy-or-missing";
  const strictQiEnabled = strictCongruenceEnabled();
  const qiSourceMetric = qiSourceIsMetric(qiRhoSource);
  const qiStrictOk = strictQiEnabled ? qiMetricDerived : true;
  const qiStrictReason = qiStrictOk
    ? "ok"
    : qiRhoSource == null
      ? "missing_qi_rho_source"
      : qiRhoSource === "metric-missing"
        ? "missing_metric_rho"
        : "qi_rho_proxy";
  values.qi_rho_source = makeStringValue(
    qiRhoSource,
    "pipeline.qiGuardrail.rhoSource",
    qiRhoSource == null || !qiSourceMetric,
  );
  values.qi_metric_derived = {
    value: qiMetricDerived,
    source: "derived:qi_metric_derived",
    proxy: !qiMetricDerived,
  };
  values.qi_metric_source = makeStringValue(
    qiMetricSource,
    "derived:qi_metric_source",
    !qiMetricDerived,
  );
  values.qi_metric_reason = makeStringValue(
    qiMetricReason,
    "derived:qi_metric_reason",
    !qiMetricDerived,
  );
  values.qi_strict_mode = {
    value: strictQiEnabled,
    source: "config:WARP_STRICT_CONGRUENCE",
    proxy: false,
  };
  values.qi_strict_ok = {
    value: qiStrictOk,
    source: "derived:qi_strict_ok",
    proxy: false,
  };
  values.qi_strict_reason = {
    value: qiStrictReason,
    source: "derived:qi_strict_reason",
    proxy: false,
  };
  values.natario_ok = resolveBoolean(
    (state as any).natarioConstraint,
    "pipeline.natarioConstraint",
  );

  const grInvariants = state.gr?.invariants;
  if (grInvariants?.kretschmann) {
    emitInvariantStats(
      values,
      "gr_kretschmann",
      grInvariants.kretschmann,
      "pipeline.gr.invariants.kretschmann",
    );
  }
  if (grInvariants?.ricci4) {
    emitInvariantStats(
      values,
      "gr_ricci4",
      grInvariants.ricci4,
      "pipeline.gr.invariants.ricci4",
    );
  }

  const metricConstraint = (state as any)?.metricConstraint as
    | { rho_constraint?: { mean?: number; rms?: number; maxAbs?: number }; source?: string }
    | undefined;
  const rhoConstraint =
    state.gr?.constraints?.rho_constraint ?? metricConstraint?.rho_constraint;
  if (rhoConstraint) {
    const rhoConstraintSource = state.gr?.constraints?.rho_constraint
      ? "pipeline.gr.constraints.rho_constraint"
      : metricConstraint?.source
        ? `pipeline.metricConstraint.${metricConstraint.source}`
        : "pipeline.metricConstraint.rho_constraint";
    values.gr_rho_constraint_mean = makeDerivedNumber(
      toFiniteNumber(rhoConstraint.mean),
      "1",
      `${rhoConstraintSource}.mean`,
      false,
      "unitSystem=gr",
    );
    values.gr_rho_constraint_rms = makeDerivedNumber(
      toFiniteNumber(rhoConstraint.rms),
      "1",
      `${rhoConstraintSource}.rms`,
      false,
      "unitSystem=gr",
    );
    values.gr_rho_constraint_max_abs = makeDerivedNumber(
      toFiniteNumber(rhoConstraint.maxAbs),
      "1",
      `${rhoConstraintSource}.maxAbs`,
      false,
      "unitSystem=gr",
    );
  }

  const matterAvgT00 = state.gr?.matter?.stressEnergy?.avgT00;
  if (Number.isFinite(matterAvgT00 as number)) {
    values.gr_matter_t00_mean = makeDerivedNumber(
      Number(matterAvgT00),
      "1",
      "pipeline.gr.matter.stressEnergy.avgT00",
      false,
      "unitSystem=gr",
    );
  }

  const pipelineRhoAvg = toFiniteNumber(state.rho_avg ?? (state as any).rho_avg);
  const pipelineRhoAvgGeom =
    pipelineRhoAvg == null ? null : pipelineRhoAvg * SI_TO_GEOM_STRESS;
  if (pipelineRhoAvgGeom != null) {
    values.gr_pipeline_t00_geom_mean = makeDerivedNumber(
      pipelineRhoAvgGeom,
      "1",
      "derived:pipeline.rho_avg*SI_TO_GEOM_STRESS",
      true,
      "unitSystem=gr;source=pipeline_rho_avg_SI",
    );
  }

  const warpMetricSourceRaw =
    (state as any)?.warp?.metricT00Source ??
    (state as any)?.warp?.metricStressSource ??
    (state as any)?.warp?.stressEnergySource;
  const warpMetricRef =
    typeof (state as any)?.warp?.metricT00Ref === "string" &&
    (state as any).warp.metricT00Ref.length > 0
      ? String((state as any).warp.metricT00Ref)
      : "warp.metric.T00";
  const warpMetricT00Raw = toFiniteNumber(
    (state as any)?.warp?.metricT00 ??
      (state as any)?.warp?.metricStressEnergy?.T00 ??
      (state as any)?.warp?.stressEnergyTensor?.T00,
  );
  const natarioMetricSourceRaw =
    (state as any)?.natario?.metricT00Source ??
    (state as any)?.natario?.metricSource;
  const natarioMetricRef =
    typeof (state as any)?.natario?.metricT00Ref === "string" &&
    (state as any).natario.metricT00Ref.length > 0
      ? String((state as any).natario.metricT00Ref)
      : (state as any)?.warp?.metricAdapter?.family === "nhm2_shift_lapse" ||
          (state as any)?.warp?.requestedFieldType === "nhm2_shift_lapse" ||
          (state as any)?.warpFieldType === "nhm2_shift_lapse" ||
          (state as any)?.dynamicConfig?.warpFieldType === "nhm2_shift_lapse"
        ? "warp.metric.T00.nhm2.shift_lapse"
        : "warp.metric.T00.natario.shift";
  const natarioMetricT00Raw = toFiniteNumber(
    (state as any)?.natario?.metricT00 ??
      (state as any)?.natario?.stressEnergyTensor?.T00,
  );
  let warpMetricSource: string | null = null;
  let warpMetricT00Geom: number | null = null;
  let warpMetricProxy = true;
  const warpMetricContract = (state as any)?.warp?.metricT00Contract;
  const natarioMetricObserver =
    typeof (state as any)?.natario?.metricT00Observer === "string"
      ? String((state as any).natario.metricT00Observer)
      : undefined;
  const natarioMetricNormalization =
    typeof (state as any)?.natario?.metricT00Normalization === "string"
      ? String((state as any).natario.metricT00Normalization)
      : undefined;
  const natarioMetricUnitSystem =
    typeof (state as any)?.natario?.metricT00UnitSystem === "string"
      ? String((state as any).natario.metricT00UnitSystem)
      : undefined;
  const natarioMetricContractStatus =
    typeof (state as any)?.natario?.metricT00ContractStatus === "string"
      ? String((state as any).natario.metricT00ContractStatus)
      : undefined;
  const natarioMetricContractReason =
    typeof (state as any)?.natario?.metricT00ContractReason === "string"
      ? String((state as any).natario.metricT00ContractReason)
      : undefined;
  const metricAdapterLocal = (state as any)?.warp?.metricAdapter;
  const metricObserver =
    typeof (warpMetricContract as any)?.observer === "string"
      ? String((warpMetricContract as any).observer)
      : natarioMetricObserver;
  const metricNormalization =
    typeof (warpMetricContract as any)?.normalization === "string"
      ? String((warpMetricContract as any).normalization)
      : natarioMetricNormalization;
  const metricUnitSystem =
    typeof (warpMetricContract as any)?.unitSystem === "string"
      ? String((warpMetricContract as any).unitSystem)
      : natarioMetricUnitSystem;
  const metricFamily =
    typeof (warpMetricContract as any)?.family === "string"
      ? String((warpMetricContract as any).family)
      : typeof (metricAdapterLocal as any)?.family === "string"
        ? String((metricAdapterLocal as any).family)
        : undefined;
  const metricFamilySemantics = deriveWarpMetricFamilySemantics(
    metricFamily === "natario" ||
      metricFamily === "natario_sdf" ||
      metricFamily === "nhm2_shift_lapse" ||
      metricFamily === "alcubierre" ||
      metricFamily === "vdb"
      ? metricFamily
      : "unknown",
  );
  const metricFamilyAuthorityStatus =
    typeof (warpMetricContract as any)?.familyAuthorityStatus === "string"
      ? String((warpMetricContract as any).familyAuthorityStatus)
      : typeof metricAdapterLocal?.familyAuthorityStatus === "string"
        ? String(metricAdapterLocal.familyAuthorityStatus)
        : metricFamilySemantics.familyAuthorityStatus;
  const metricTransportCertificationStatus =
    typeof (warpMetricContract as any)?.transportCertificationStatus === "string"
      ? String((warpMetricContract as any).transportCertificationStatus)
      : typeof metricAdapterLocal?.transportCertificationStatus === "string"
        ? String(metricAdapterLocal.transportCertificationStatus)
        : metricFamilySemantics.transportCertificationStatus;
  const metricContractStatus =
    typeof (warpMetricContract as any)?.status === "string"
      ? String((warpMetricContract as any).status)
      : natarioMetricContractStatus;
  let metricContractReason =
    typeof (warpMetricContract as any)?.reason === "string"
      ? String((warpMetricContract as any).reason)
      : natarioMetricContractReason;
  if (
    (!metricContractReason || metricContractReason.length === 0) &&
    metricContractStatus === "ok"
  ) {
    metricContractReason = "ok";
  }
  const metricChart =
    typeof (warpMetricContract as any)?.chart === "string"
      ? String((warpMetricContract as any).chart)
      : typeof (metricAdapterLocal as any)?.chart?.label === "string"
        ? String((metricAdapterLocal as any).chart.label)
        : undefined;
  const canonicalContract = {
    family: "natario",
    chart: "comoving_cartesian",
    observer: "eulerian_n",
    normalization: "si_stress",
    unitSystem: "SI",
  };

  if (warpMetricSourceRaw === "metric" && warpMetricT00Raw != null) {
    warpMetricSource = warpMetricRef;
    warpMetricT00Geom = warpMetricT00Raw * SI_TO_GEOM_STRESS;
    warpMetricProxy = false;
  } else if (natarioMetricSourceRaw === "metric" && natarioMetricT00Raw != null) {
    warpMetricSource = natarioMetricRef;
    warpMetricT00Geom = natarioMetricT00Raw * SI_TO_GEOM_STRESS;
    warpMetricProxy = false;
  } else {
    const vdbRegionII = (state as any)?.vdbRegionII;
    const vdbT00Geom = toFiniteNumber(vdbRegionII?.t00_mean);
    if (hasVdbRegionIIMetricSupport(vdbRegionII) && vdbT00Geom != null) {
      warpMetricSource = "warp.metric.T00.vdb.regionII";
      warpMetricT00Geom = vdbT00Geom;
      warpMetricProxy = false;
    }
  }

  if (warpMetricT00Geom != null) {
    values.gr_metric_t00_geom_mean = makeDerivedNumber(
      warpMetricT00Geom,
      "1",
      "derived:gr_metric_t00_geom_mean",
      warpMetricProxy,
      `unitSystem=gr;source=${warpMetricSource ?? "unknown"}`,
    );
    if (warpMetricSource === "warp.metric.T00.vdb.regionII") {
      values.gr_metric_t00_si_mean = makeDerivedNumber(
        warpMetricT00Geom * GEOM_TO_SI_STRESS,
        "J/m^3",
        "derived:gr_metric_t00_si_mean",
        warpMetricProxy,
        "source=warp.metric.T00.vdb.regionII;conversion=GEOM_TO_SI_STRESS",
      );
    }
    const metricContractOk =
      metricContractStatus === "ok" &&
      metricChart !== "unspecified" &&
      metricObserver != null &&
      metricNormalization != null &&
      metricUnitSystem === "SI";
    values.metric_t00_observer = makeStringValue(
      metricObserver,
      "pipeline.warp.metricT00Contract.observer",
      metricContractStatus !== "ok",
    );
    values.metric_t00_normalization = makeStringValue(
      metricNormalization,
      "pipeline.warp.metricT00Contract.normalization",
      metricContractStatus !== "ok",
    );
    values.metric_t00_unit_system = makeStringValue(
      metricUnitSystem,
      "pipeline.warp.metricT00Contract.unitSystem",
      metricContractStatus !== "ok",
    );
    values.metric_t00_contract_status = makeStringValue(
      metricContractStatus,
      "pipeline.warp.metricT00Contract.status",
      metricContractStatus !== "ok",
    );
    values.metric_t00_contract_reason = makeStringValue(
      metricContractReason,
      "pipeline.warp.metricT00Contract.reason",
      metricContractStatus !== "ok",
    );
    values.metric_t00_chart = makeStringValue(
      metricChart,
      "pipeline.warp.metricT00Contract.chart",
      metricContractStatus !== "ok",
    );
    values.metric_t00_family = makeStringValue(
      metricFamily,
      "pipeline.warp.metricT00Contract.family",
      metricContractStatus !== "ok",
    );
    values.metric_t00_family_authority_status = makeStringValue(
      metricFamilyAuthorityStatus,
      "pipeline.warp.metricT00Contract.familyAuthorityStatus",
      metricContractStatus !== "ok",
    );
    values.metric_t00_transport_certification_status = makeStringValue(
      metricTransportCertificationStatus,
      "pipeline.warp.metricT00Contract.transportCertificationStatus",
      metricContractStatus !== "ok",
    );
    values.metric_t00_contract_ok = resolveBoolean(
      metricContractOk,
      "pipeline.warp.metricT00Contract.ok",
    );
  }

  const canonicalMatch =
    metricFamily === canonicalContract.family &&
    metricChart === canonicalContract.chart &&
    metricObserver === canonicalContract.observer &&
    metricNormalization === canonicalContract.normalization &&
    metricUnitSystem === canonicalContract.unitSystem &&
    metricContractStatus === "ok";
  values.warp_canonical_family = makeStringValue(
    canonicalContract.family,
    "config:warp_canonical_family",
    false,
  );
  values.warp_canonical_chart = makeStringValue(
    canonicalContract.chart,
    "config:warp_canonical_chart",
    false,
  );
  values.warp_canonical_observer = makeStringValue(
    canonicalContract.observer,
    "config:warp_canonical_observer",
    false,
  );
  values.warp_canonical_normalization = makeStringValue(
    canonicalContract.normalization,
    "config:warp_canonical_normalization",
    false,
  );
  values.warp_canonical_unit_system = makeStringValue(
    canonicalContract.unitSystem,
    "config:warp_canonical_unit_system",
    false,
  );
  values.warp_canonical_match = resolveBoolean(
    canonicalMatch,
    "derived:warp_canonical_match",
  );

  const metricStressDiagnostics = (state as any)?.warp?.metricStressDiagnostics;
  const grKTraceMean = toFiniteNumber((state as any)?.gr?.kTrace?.mean);
  const grKTraceMaxAbs = toFiniteNumber((state as any)?.gr?.kTrace?.maxAbs);
  const metricKTraceMean = grKTraceMean ?? toFiniteNumber(metricStressDiagnostics?.kTraceMean);
  const metricKTraceProxy = grKTraceMean == null ? warpMetricProxy : false;
  const metricKTraceSource =
    grKTraceMean != null
      ? "pipeline.gr.kTrace.mean"
      : "pipeline.warp.metricStressDiagnostics.kTraceMean";
  if (metricStressDiagnostics) {
    values.metric_t00_sample_count = makeDerivedNumber(
      toFiniteNumber(metricStressDiagnostics.sampleCount),
      "1",
      "pipeline.warp.metricStressDiagnostics.sampleCount",
      warpMetricProxy,
    );
    values.metric_t00_rho_geom_mean = makeDerivedNumber(
      toFiniteNumber(metricStressDiagnostics.rhoGeomMean),
      "1",
      "pipeline.warp.metricStressDiagnostics.rhoGeomMean",
      warpMetricProxy,
      "unitSystem=gr",
    );
    values.metric_t00_rho_si_mean = makeDerivedNumber(
      toFiniteNumber(metricStressDiagnostics.rhoSiMean),
      "J/m^3",
      "pipeline.warp.metricStressDiagnostics.rhoSiMean",
      warpMetricProxy,
    );
    values.metric_k_sq_mean = makeDerivedNumber(
      toFiniteNumber(metricStressDiagnostics.kSquaredMean),
      "1/m^2",
      "pipeline.warp.metricStressDiagnostics.kSquaredMean",
      warpMetricProxy,
    );
    values.metric_t00_step_m = makeDerivedNumber(
      toFiniteNumber(metricStressDiagnostics.step_m),
      "m",
      "pipeline.warp.metricStressDiagnostics.step_m",
      warpMetricProxy,
    );
    values.metric_t00_scale_m = makeDerivedNumber(
      toFiniteNumber(metricStressDiagnostics.scale_m),
      "m",
      "pipeline.warp.metricStressDiagnostics.scale_m",
      warpMetricProxy,
    );
  }
  values.metric_k_trace_mean =
    metricKTraceMean != null
      ? makeDerivedNumber(
          metricKTraceMean,
          "1/m",
          metricKTraceSource,
          metricKTraceProxy,
        )
      : makeDerivedNumber(null, "1/m", "missing", true);
  values.metric_k_trace_authoritative = {
    value: grKTraceMean != null,
    source: "derived:metric_k_trace_authoritative",
    proxy: false,
  };
  values.metric_k_trace_authoritative_reason = makeStringValue(
    grKTraceMean != null ? "brick_native_k_trace_present" : "brick_native_k_trace_missing",
    "derived:metric_k_trace_authoritative_reason",
    false,
  );

  const authoritativeThetaGeom =
    (state as any)?.theta_metric_authoritative === true
      ? toFiniteNumber((state as any).theta_geom)
      : null;
  const projectionThetaGeomForNatario =
    projectionThetaGeom.value != null && !projectionThetaGeom.proxy
      ? projectionThetaGeom.value
      : (state as any)?.theta_metric_authoritative === true
        ? null
        : thetaGeomResolved.value;
  const projectionDivBetaRms =
    toFiniteNumber((state as any)?.warp?.metricAdapter?.betaDiagnostics?.thetaRms) ??
    toFiniteNumber((state as any)?.warp?.metricAdapter?.betaDiagnostics?.divBetaRms);
  const projectionDivBetaMaxAbs =
    toFiniteNumber((state as any)?.warp?.metricAdapter?.betaDiagnostics?.thetaMax) ??
    toFiniteNumber((state as any)?.warp?.metricAdapter?.betaDiagnostics?.divBetaMaxAbs);
  const projectionDivBetaSource =
    Number.isFinite((state as any)?.warp?.metricAdapter?.betaDiagnostics?.thetaRms) ||
    Number.isFinite((state as any)?.warp?.metricAdapter?.betaDiagnostics?.thetaMax)
      ? "pipeline.warp.metricAdapter.betaDiagnostics.thetaRms/thetaMax"
      : "pipeline.warp.metricAdapter.betaDiagnostics.divBetaRms/divBetaMaxAbs";
  const thetaKResidualAbs =
    authoritativeThetaGeom != null && grKTraceMean != null
      ? Math.abs(authoritativeThetaGeom + grKTraceMean)
      : null;
  const thetaKStatus: "pass" | "fail" | "unknown" = thetaKResidualAbs == null
    ? "unknown"
    : thetaKResidualAbs <= THETA_K_TOLERANCE
      ? "pass"
      : "fail";
  const projectionThetaKResidualAbs =
    projectionThetaGeomForNatario != null && metricKTraceMean != null
      ? Math.abs(projectionThetaGeomForNatario + metricKTraceMean)
      : null;
  const projectionThetaKStatus: "pass" | "fail" | "unknown" =
    projectionThetaKResidualAbs == null
      ? "unknown"
      : projectionThetaKResidualAbs <= THETA_K_TOLERANCE
        ? "pass"
        : "fail";
  const grDivBeta = state.gr?.divBeta;
  if (grDivBeta) {
    values.metric_div_beta_rms = makeDerivedNumber(
      toFiniteNumber(grDivBeta.rms),
      "1/m",
      "pipeline.gr.divBeta.rms",
      false,
    );
    values.metric_div_beta_max_abs = makeDerivedNumber(
      toFiniteNumber(grDivBeta.maxAbs),
      "1/m",
      "pipeline.gr.divBeta.maxAbs",
      false,
    );
    values.metric_div_beta_source = makeStringValue(
      grDivBeta.source,
      "pipeline.gr.divBeta.source",
      false,
    );
  }
  values.metric_div_beta_authoritative = {
    value: Boolean(grDivBeta),
    source: "derived:metric_div_beta_authoritative",
    proxy: false,
  };
  values.metric_div_beta_authoritative_reason = makeStringValue(
    grDivBeta ? "brick_native_div_beta_present" : "brick_native_div_beta_missing",
    "derived:metric_div_beta_authoritative_reason",
    false,
  );
  values.natario_expansion_tolerance = makeDerivedNumber(
    NATARIO_EXPANSION_TOLERANCE,
    "1/m",
    "derived:natario_expansion_tolerance",
    false,
    "canonical_natario_low_expansion_tolerance",
  );
  values.theta_k_tolerance = makeDerivedNumber(
    THETA_K_TOLERANCE,
    "1/m",
    "derived:theta_k_tolerance",
    false,
    "canonical_theta_plus_ktrace_tolerance",
  );
  const authoritativeDivBetaRms = toFiniteNumber(grDivBeta?.rms);
  const authoritativeLowExpansionStatus:
    | "pass"
    | "fail"
    | "missing_authoritative_divergence"
    | "missing_authoritative_theta_k" =
    authoritativeDivBetaRms == null
      ? "missing_authoritative_divergence"
      : authoritativeThetaGeom == null || grKTraceMean == null
        ? "missing_authoritative_theta_k"
      : authoritativeDivBetaRms <= NATARIO_EXPANSION_TOLERANCE &&
          thetaKStatus === "pass"
        ? "pass"
        : "fail";
  const authoritativeLowExpansionReason =
    authoritativeDivBetaRms == null
      ? "brick_native_div_beta_missing"
      : authoritativeThetaGeom == null || grKTraceMean == null
        ? "brick_native_theta_k_missing"
      : authoritativeDivBetaRms > NATARIO_EXPANSION_TOLERANCE
        ? "brick_native_divergence_constraint_failed"
      : thetaKStatus === "fail"
          ? "theta_k_consistency_failed"
          : "authoritative_low_expansion_ok";
  const projectionLowExpansionStatus: "pass" | "fail" | "projection_unavailable" =
    projectionDivBetaRms == null ||
    projectionThetaGeomForNatario == null ||
    metricKTraceMean == null
      ? "projection_unavailable"
      : projectionDivBetaRms <= NATARIO_EXPANSION_TOLERANCE &&
          projectionThetaKStatus === "pass"
        ? "pass"
        : "fail";
  const projectionLowExpansionReason =
    projectionDivBetaRms == null
      ? "projection_beta_diagnostics_missing"
      : projectionThetaGeomForNatario == null || metricKTraceMean == null
        ? "projection_theta_k_missing"
      : projectionDivBetaRms > NATARIO_EXPANSION_TOLERANCE
        ? "projection_divergence_constraint_failed"
        : projectionThetaKStatus === "fail"
          ? "theta_k_consistency_failed"
          : "projection_low_expansion_ok";
  values.natario_low_expansion_authoritative_status = makeStringValue(
    authoritativeLowExpansionStatus,
    "derived:natario_low_expansion_authoritative_status",
    authoritativeDivBetaRms == null,
  );
  values.natario_low_expansion_authoritative_reason = makeStringValue(
    authoritativeLowExpansionReason,
    "derived:natario_low_expansion_authoritative_reason",
    authoritativeDivBetaRms == null,
  );
  values.natario_low_expansion_projection_status = makeStringValue(
    projectionLowExpansionStatus,
    "derived:natario_low_expansion_projection_status",
    projectionDivBetaRms == null,
  );
  values.natario_low_expansion_projection_reason = makeStringValue(
    projectionLowExpansionReason,
    "derived:natario_low_expansion_projection_reason",
    projectionDivBetaRms == null,
  );
  values.natario_low_expansion_projection_source = makeStringValue(
    projectionDivBetaRms != null ? projectionDivBetaSource : null,
    "derived:natario_low_expansion_projection_source",
    projectionDivBetaRms == null,
  );

  const cl3Threshold = resolveCl3Threshold();
  values.gr_cl3_rho_threshold = makeDerivedNumber(
    cl3Threshold,
    "1",
    "config:WARP_CL3_RHO_DELTA_MAX",
    false,
    "relative_delta_max",
  );

  let cl3DeltaMean: number | null = null;
  if (
    typeof rhoConstraint?.mean === "number" &&
    Number.isFinite(rhoConstraint.mean) &&
    Number.isFinite(matterAvgT00 as number)
  ) {
    const delta = relDelta(rhoConstraint.mean, Number(matterAvgT00));
    cl3DeltaMean = delta;
  }

  let cl3DeltaPipelineMean: number | null = null;
  if (
    typeof rhoConstraint?.mean === "number" &&
    Number.isFinite(rhoConstraint.mean) &&
    pipelineRhoAvgGeom != null
  ) {
    const delta = relDelta(rhoConstraint.mean, pipelineRhoAvgGeom);
    cl3DeltaPipelineMean = delta;
    values.gr_cl3_rho_delta_pipeline_mean_telemetry = makeDerivedNumber(
      delta,
      "1",
      "derived:gr_cl3_rho_delta.pipeline.mean",
      true,
      "pipeline telemetry (relative_delta)",
    );
  }

  let cl3DeltaMetricMean: number | null = null;
  if (
    typeof rhoConstraint?.mean === "number" &&
    Number.isFinite(rhoConstraint.mean) &&
    warpMetricT00Geom != null
  ) {
    const delta = relDelta(rhoConstraint.mean, warpMetricT00Geom);
    cl3DeltaMetricMean = delta;
    values.gr_cl3_rho_delta_metric_mean = makeDerivedNumber(
      delta,
      "1",
      "derived:gr_cl3_rho_delta.metric.mean",
      warpMetricProxy,
      "relative_delta",
    );
  }

  values.gr_cl3_rho_delta_pipeline_mean = makeDerivedNumber(
    cl3DeltaMetricMean,
    "1",
    cl3DeltaMetricMean != null
      ? "derived:gr_cl3_rho_delta.metric.mean"
      : "missing",
    cl3DeltaMetricMean == null ? true : warpMetricProxy,
    "metric-derived override",
  );

  const cl3MissingParts: string[] = [];
  if (!(typeof rhoConstraint?.mean === "number" && Number.isFinite(rhoConstraint.mean))) {
    cl3MissingParts.push("missing_rho_constraint");
  }
  if (warpMetricT00Geom == null) {
    cl3MissingParts.push("missing_metric_t00");
  }
  const cl3MissingReason =
    cl3MissingParts.includes("missing_metric_t00")
      ? "metric_source_missing"
      : cl3MissingParts.includes("missing_rho_constraint")
        ? "constraint_rho_missing"
        : undefined;

  const cl3GateDelta = cl3DeltaMetricMean;
  const cl3GateSource =
    cl3DeltaMetricMean != null ? warpMetricSource : cl3MissingReason === "metric_source_missing"
      ? "metric-missing"
      : "constraint-missing";
  const cl3GateProxy = cl3DeltaMetricMean != null ? warpMetricProxy : true;
  const cl3GatePass =
    cl3GateDelta != null ? cl3GateDelta <= cl3Threshold : false;
  const cl3GateReason =
    cl3GateDelta != null
      ? cl3GatePass
        ? "within_threshold"
        : "above_threshold"
      : cl3MissingReason ?? "missing_inputs";
  values.gr_cl3_rho_delta_mean = makeDerivedNumber(
    cl3GateDelta,
    "1",
    "derived:gr_cl3_rho_delta.gate.mean",
    cl3GateProxy,
    cl3GateDelta != null ? "relative_delta" : `missing=${cl3MissingParts.join(",") || "unknown"}`,
  );
  values.gr_cl3_rho_gate = {
    value: cl3GatePass,
    source: "derived:gr_cl3_rho_gate",
    proxy: cl3GateProxy,
  };
  values.gr_cl3_rho_gate_source = makeStringValue(
    cl3GateSource ?? "unknown",
    "derived:gr_cl3_rho_gate_source",
    cl3GateProxy,
  );
  values.gr_cl3_rho_gate_reason = makeStringValue(
    cl3GateReason,
    "derived:gr_cl3_rho_gate_reason",
    cl3GateDelta != null ? cl3GateProxy : false,
  );
  if (cl3MissingParts.length) {
    values.gr_cl3_rho_missing_parts = makeStringValue(
      cl3MissingParts.join(","),
      "derived:gr_cl3_rho_missing_parts",
      false,
    );
  }

  const congruenceMissingParts = (state as any).congruence_missing_parts;
  if (Array.isArray(congruenceMissingParts) && congruenceMissingParts.length) {
    values.congruence_missing_parts = makeStringValue(
      congruenceMissingParts.join(","),
      "pipeline.congruence_missing_parts",
      false,
    );
    values.congruence_missing_count = makeDerivedNumber(
      congruenceMissingParts.length,
      "1",
      "derived:congruence_missing_count",
      false,
      "count",
    );
    values.congruence_missing_reason = makeStringValue(
      String((state as any).congruence_missing_reason ?? congruenceMissingParts[0]),
      "pipeline.congruence_missing_reason",
      false,
    );
  } else {
    values.congruence_missing_count = makeDerivedNumber(
      0,
      "1",
      "derived:congruence_missing_count",
      false,
      "count",
    );
  }

  const baselineInvariants = (state as any).grBaseline?.invariants;
  if (grInvariants && baselineInvariants) {
    const kDelta = computeInvariantDelta(
      grInvariants.kretschmann,
      baselineInvariants.kretschmann,
    );
    const rDelta = computeInvariantDelta(
      grInvariants.ricci4,
      baselineInvariants.ricci4,
    );
    const deltas: number[] = [];
    if (kDelta) {
      values.gr_cl0_kretschmann_delta_mean = makeDerivedNumber(
        kDelta.mean,
        "1",
        "derived:gr_cl0_delta.kretschmann.mean",
        true,
        "relative_delta",
      );
      values.gr_cl0_kretschmann_delta_p98 = makeDerivedNumber(
        kDelta.p98,
        "1",
        "derived:gr_cl0_delta.kretschmann.p98",
        true,
        "relative_delta",
      );
      deltas.push(kDelta.mean, kDelta.p98);
    }
    if (rDelta) {
      values.gr_cl0_ricci4_delta_mean = makeDerivedNumber(
        rDelta.mean,
        "1",
        "derived:gr_cl0_delta.ricci4.mean",
        true,
        "relative_delta",
      );
      values.gr_cl0_ricci4_delta_p98 = makeDerivedNumber(
        rDelta.p98,
        "1",
        "derived:gr_cl0_delta.ricci4.p98",
        true,
        "relative_delta",
      );
      deltas.push(rDelta.mean, rDelta.p98);
    }
    if (deltas.length) {
      values.gr_cl0_delta_max = makeDerivedNumber(
        Math.max(...deltas),
        "1",
        "derived:gr_cl0_delta.max",
        true,
        "relative_delta",
      );
    }

    const baseline = (state as any).grBaseline ?? {};
    values.gr_cl0_baseline_source = makeStringValue(
      baseline.source ?? "pipeline.grBaseline",
      "pipeline.grBaseline.source",
      true,
    );
    if (typeof baseline.updatedAt === "number") {
      const age_s = Math.max(0, (Date.now() - baseline.updatedAt) / 1000);
      values.gr_cl0_baseline_age_s = makeDerivedNumber(
        age_s,
        "s",
        "derived:gr_cl0_baseline_age",
        true,
      );
    }
  }

  const metricAdapter = (state as any).warp?.metricAdapter;
  if (metricAdapter && typeof metricAdapter === "object") {
    const chart = (metricAdapter as any).chart ?? {};
    const beta = (metricAdapter as any).betaDiagnostics ?? {};
    const betaMethod = typeof beta.method === "string" ? beta.method : null;
    const betaProxy = betaMethod === "not-computed";
    const contractStatus = chart.contractStatus;
    const contractProxy = contractStatus && contractStatus !== "ok";

    values.metric_adapter_family = makeStringValue(
      (metricAdapter as any).family,
      "pipeline.warp.metricAdapter.family",
      false,
    );
    values.metric_chart_label = makeStringValue(
      chart.label,
      "pipeline.warp.metricAdapter.chart.label",
      false,
    );
    values.metric_dt_gamma_policy = makeStringValue(
      chart.dtGammaPolicy,
      "pipeline.warp.metricAdapter.chart.dtGammaPolicy",
      contractProxy,
    );
    values.metric_chart_contract_status = makeStringValue(
      contractStatus,
      "pipeline.warp.metricAdapter.chart.contractStatus",
      contractProxy,
    );
    values.metric_chart_contract_reason = makeStringValue(
      chart.contractReason,
      "pipeline.warp.metricAdapter.chart.contractReason",
      contractProxy,
    );
    values.metric_requested_field = makeStringValue(
      (metricAdapter as any).requestedFieldType,
      "pipeline.warp.metricAdapter.requestedFieldType",
      false,
    );
    values.metric_chart_notes = makeStringValue(
      chart.notes,
      "pipeline.warp.metricAdapter.chart.notes",
      contractProxy,
    );
    values.metric_coordinate_map = makeStringValue(
      chart.coordinateMap,
      "pipeline.warp.metricAdapter.chart.coordinateMap",
      contractProxy,
    );

    values.metric_alpha = makeDerivedNumber(
      toFiniteNumber((metricAdapter as any).alpha),
      "1",
      "pipeline.warp.metricAdapter.alpha",
      false,
    );
    const gammaDiag = (metricAdapter as any).gammaDiag;
    if (Array.isArray(gammaDiag) && gammaDiag.length >= 3) {
      values.metric_gamma_xx = makeDerivedNumber(
        toFiniteNumber(gammaDiag[0]),
        "1",
        "pipeline.warp.metricAdapter.gammaDiag[0]",
        false,
      );
      values.metric_gamma_yy = makeDerivedNumber(
        toFiniteNumber(gammaDiag[1]),
        "1",
        "pipeline.warp.metricAdapter.gammaDiag[1]",
        false,
      );
      values.metric_gamma_zz = makeDerivedNumber(
        toFiniteNumber(gammaDiag[2]),
        "1",
        "pipeline.warp.metricAdapter.gammaDiag[2]",
        false,
      );
    }

    values.metric_beta_method = makeStringValue(
      betaMethod,
      "pipeline.warp.metricAdapter.betaDiagnostics.method",
      betaProxy,
    );
    values.metric_beta_theta_max = makeDerivedNumber(
      toFiniteNumber(beta.thetaMax),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.thetaMax",
      betaProxy,
    );
    values.metric_beta_theta_rms = makeDerivedNumber(
      toFiniteNumber(beta.thetaRms),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.thetaRms",
      betaProxy,
    );
    values.metric_beta_curl_max = makeDerivedNumber(
      toFiniteNumber(beta.curlMax),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.curlMax",
      betaProxy,
    );
    values.metric_beta_curl_rms = makeDerivedNumber(
      toFiniteNumber(beta.curlRms),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.curlRms",
      betaProxy,
    );
    values.metric_beta_theta_conformal_max = makeDerivedNumber(
      toFiniteNumber(beta.thetaConformalMax),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.thetaConformalMax",
      betaProxy,
    );
    values.metric_beta_theta_conformal_rms = makeDerivedNumber(
      toFiniteNumber(beta.thetaConformalRms),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.thetaConformalRms",
      betaProxy,
    );
    values.metric_beta_bprime_over_b_max = makeDerivedNumber(
      toFiniteNumber(beta.bPrimeOverBMax),
      "1/m",
      "pipeline.warp.metricAdapter.betaDiagnostics.bPrimeOverBMax",
      betaProxy,
    );
    values.metric_beta_bdouble_over_b_max = makeDerivedNumber(
      toFiniteNumber(beta.bDoubleOverBMax),
      "1/m^2",
      "pipeline.warp.metricAdapter.betaDiagnostics.bDoubleOverBMax",
      betaProxy,
    );
    values.metric_beta_sample_count = makeDerivedNumber(
      toFiniteNumber(beta.sampleCount),
      "1",
      "pipeline.warp.metricAdapter.betaDiagnostics.sampleCount",
      betaProxy,
    );
    values.metric_beta_step_m = makeDerivedNumber(
      toFiniteNumber(beta.step_m),
      "m",
      "pipeline.warp.metricAdapter.betaDiagnostics.step_m",
      betaProxy,
    );
    values.metric_beta_note = makeStringValue(
      beta.note,
      "pipeline.warp.metricAdapter.betaDiagnostics.note",
      betaProxy,
    );
  }

  values.U_static_J = makeValue(
    resolveNumber([{ value: state.U_static, source: "pipeline.U_static" }]),
    "J",
  );
  values.U_geo_J = makeValue(
    resolveNumber([{ value: state.U_geo, source: "pipeline.U_geo" }]),
    "J",
  );
  values.U_Q_J = makeValue(
    resolveNumber([{ value: state.U_Q, source: "pipeline.U_Q" }]),
    "J",
  );
  values.U_cycle_J = makeValue(
    resolveNumber([{ value: state.U_cycle, source: "pipeline.U_cycle" }]),
    "J",
  );

  values.M_exotic_kg = makeValue(
    resolveNumber([{ value: state.M_exotic, source: "pipeline.M_exotic" }]),
    "kg",
  );
  values.M_exotic_raw_kg = makeValue(
    resolveNumber([{ value: state.M_exotic_raw, source: "pipeline.M_exotic_raw" }]),
    "kg",
  );
  values.mass_calibration = makeValue(
    resolveNumber([{ value: state.massCalibration, source: "pipeline.massCalibration" }]),
    "1",
  );

  values.rho_static_J_m3 = makeValue(
    resolveNumber([{ value: state.rho_static, source: "pipeline.rho_static" }]),
    "J/m^3",
  );
  values.rho_inst_J_m3 = makeValue(
    resolveNumber([{ value: state.rho_inst, source: "pipeline.rho_inst" }]),
    "J/m^3",
  );
  values.rho_avg_J_m3 = makeValue(
    resolveNumber([{ value: state.rho_avg, source: "pipeline.rho_avg" }]),
    "J/m^3",
  );

  const tileAreaCm2 = resolveNumber([
    { value: state.tileArea_cm2, source: "pipeline.tileArea_cm2" },
  ]);
  values.tile_area_cm2 = makeValue(tileAreaCm2, "cm^2");
  values.tile_area_m2 = makeDerivedNumber(
    tileAreaCm2.value == null ? null : tileAreaCm2.value * 1e-4,
    "m^2",
    "derived:tile_area_cm2",
    tileAreaCm2.proxy,
    "cm2_to_m2",
  );

  values.tile_count = makeValue(
    resolveNumber([
      { value: state.N_tiles, source: "pipeline.N_tiles" },
      { value: (state as any).tiles?.total, source: "pipeline.tiles.total", proxy: true },
    ]),
    "1",
  );

  const uStaticTotalResolved = resolveNumber([
    { value: (state as any).U_static_total, source: "pipeline.U_static_total" },
  ]);
  if (uStaticTotalResolved.value != null) {
    values.U_static_total_J = makeValue(uStaticTotalResolved, "J");
  } else {
    const uStaticTotal =
      typeof values.U_static_J.value === "number" &&
      typeof values.tile_count.value === "number"
        ? values.U_static_J.value * values.tile_count.value
        : null;
    values.U_static_total_J = makeDerivedNumber(
      uStaticTotal,
      "J",
      "derived:U_static_J*tile_count",
      Boolean(values.U_static_J.proxy || values.tile_count.proxy),
    );
  }

  const hullDims = resolveHullDims(state);
  values.hull_Lx_m = makeValue(hullDims.Lx, "m");
  values.hull_Ly_m = makeValue(hullDims.Ly, "m");
  values.hull_Lz_m = makeValue(hullDims.Lz, "m");
  values.hull_wall_m = makeValue(hullDims.wall, "m");

  const hullArea = resolveNumber([
    { value: state.hullArea_m2, source: "pipeline.hullArea_m2" },
    { value: (state as any).hullArea?.value, source: "pipeline.hullArea.value", proxy: true },
    { value: (state as any).tiles?.hullArea_m2, source: "pipeline.tiles.hullArea_m2", proxy: true },
  ]);
  values.hull_area_m2 = makeValue(hullArea, "m^2");

  const gapNm = resolveNumber([{ value: state.gap_nm, source: "pipeline.gap_nm" }]);
  values.gap_nm = makeValue(gapNm, "nm");
  values.gap_m = makeDerivedNumber(
    gapNm.value == null ? null : gapNm.value * 1e-9,
    "m",
    "derived:gap_nm",
    gapNm.proxy,
    "nm_to_m",
  );

  const gapGuardNm = resolveNumber([
    { value: (state as any).mechanical?.constrainedGap_nm, source: "pipeline.mechanical.constrainedGap_nm" },
    { value: (state as any).mechanical?.recommendedGap_nm, source: "pipeline.mechanical.recommendedGap_nm", proxy: true },
  ]);
  values.gap_guard_nm = makeValue(gapGuardNm, "nm");
  values.gap_guard_m = makeDerivedNumber(
    gapGuardNm.value == null ? null : gapGuardNm.value * 1e-9,
    "m",
    "derived:gap_guard_nm",
    gapGuardNm.proxy,
    "nm_to_m",
  );

  const tileAreaM2Value = values.tile_area_m2.value;
  const gapMValue = values.gap_m.value;
  const cavityVolume =
    typeof tileAreaM2Value === "number" && typeof gapMValue === "number"
      ? tileAreaM2Value * gapMValue
      : null;
  values.cavity_volume_m3 = makeDerivedNumber(
    cavityVolume,
    "m^3",
    "derived:tile_area_m2*gap_m",
    Boolean(values.tile_area_m2.proxy || values.gap_m.proxy),
  );
  const uStatic = values.U_static_J.value;
  const rhoTile =
    typeof uStatic === "number" && typeof cavityVolume === "number" && cavityVolume > 0
      ? uStatic / cavityVolume
      : null;
  values.rho_tile_J_m3 = makeDerivedNumber(
    rhoTile,
    "J/m^3",
    "derived:U_static_J/cavity_volume_m3",
    Boolean(values.U_static_J.proxy || values.cavity_volume_m3.proxy),
  );

  values.packing = {
    value: PAPER_GEO.PACKING,
    unit: "1",
    source: "pipeline.PAPER_GEO.PACKING",
    proxy: false,
  };
  values.radial_layers = {
    value: PAPER_GEO.RADIAL_LAYERS,
    unit: "1",
    source: "pipeline.PAPER_GEO.RADIAL_LAYERS",
    proxy: false,
  };

  const tileCountValue = values.tile_count.value;
  const hullAreaValue = values.hull_area_m2.value;
  const tileAreaValue = values.tile_area_m2.value;
  const coverageRaw =
    typeof tileCountValue === "number" &&
    typeof hullAreaValue === "number" &&
    typeof tileAreaValue === "number" &&
    hullAreaValue > 0
      ? (tileCountValue * tileAreaValue) / hullAreaValue
      : null;
  values.coverage_raw = makeDerivedNumber(
    coverageRaw,
    "1",
    "derived:tile_count*tile_area_m2/hull_area_m2",
    Boolean(values.tile_count.proxy || values.tile_area_m2.proxy || values.hull_area_m2.proxy),
  );
  const packingValue = values.packing.value;
  const radialValue = values.radial_layers.value;
  const coverage =
    typeof coverageRaw === "number" &&
    typeof packingValue === "number" &&
    typeof radialValue === "number" &&
    packingValue > 0 &&
    radialValue > 0
      ? coverageRaw / (packingValue * radialValue)
      : null;
  values.coverage = makeDerivedNumber(
    coverage,
    "1",
    "derived:coverage_raw/(packing*radial_layers)",
    Boolean(values.coverage_raw.proxy),
  );

  const R_geom =
    typeof hullDims.Lx.value === "number" &&
    typeof hullDims.Ly.value === "number" &&
    typeof hullDims.Lz.value === "number"
      ? Math.cbrt(hullDims.Lx.value * hullDims.Ly.value * hullDims.Lz.value)
      : null;
  values.R_geom_m = makeDerivedNumber(
    R_geom,
    "m",
    "derived:hull_dims",
    Boolean(hullDims.Lx.proxy || hullDims.Ly.proxy || hullDims.Lz.proxy),
  );

  const bubble = (state as any).bubble ?? {};
  values.bubble_R_m = makeValue(
    resolveNumber([
      { value: bubble.R, source: "pipeline.bubble.R" },
      { value: (state as any).R, source: "pipeline.R", proxy: true },
    ]),
    "m",
  );
  values.bubble_sigma = makeValue(
    resolveNumber([
      { value: bubble.sigma, source: "pipeline.bubble.sigma" },
      { value: (state as any).sigma, source: "pipeline.sigma", proxy: true },
    ]),
    "1",
  );
  values.bubble_beta = makeValue(
    resolveNumber([
      { value: bubble.beta, source: "pipeline.bubble.beta" },
      { value: (state as any).beta, source: "pipeline.beta", proxy: true },
    ]),
    "1",
  );

  const warpStress = (state as any).warp?.stressEnergyTensor ?? (state as any).stressEnergy;
  values.warp_t00_avg = makeValue(
    resolveNumber([
      { value: warpStress?.T00, source: "pipeline.warp.stressEnergyTensor.T00" },
      { value: (state as any).stressEnergy?.T00, source: "pipeline.stressEnergy.T00", proxy: true },
    ]),
    "J/m^3",
  );
  values.warp_t11_avg = makeValue(
    resolveNumber([
      { value: warpStress?.T11, source: "pipeline.warp.stressEnergyTensor.T11" },
      { value: (state as any).stressEnergy?.T11, source: "pipeline.stressEnergy.T11", proxy: true },
    ]),
    "J/m^3",
  );
  values.warp_t22_avg = makeValue(
    resolveNumber([
      { value: warpStress?.T22, source: "pipeline.warp.stressEnergyTensor.T22" },
      { value: (state as any).stressEnergy?.T22, source: "pipeline.stressEnergy.T22", proxy: true },
    ]),
    "J/m^3",
  );
  values.warp_t33_avg = makeValue(
    resolveNumber([
      { value: warpStress?.T33, source: "pipeline.warp.stressEnergyTensor.T33" },
      { value: (state as any).stressEnergy?.T33, source: "pipeline.stressEnergy.T33", proxy: true },
    ]),
    "J/m^3",
  );
  const curvatureMetricMode =
    warpMetricSourceRaw === "metric" && warpMetricT00Raw != null;
  const curvatureMetaSource = curvatureMetricMode
    ? "metric"
    : state
      ? "pipeline"
      : "unknown";
  const curvatureMetaCongruence = curvatureMetricMode
    ? "conditional"
    : "proxy-only";
  const curvatureMetaProxy = curvatureMetaCongruence !== "geometry-derived";
  values.curvature_meta_source = makeStringValue(
    curvatureMetaSource,
    "derived:curvature_meta_source",
    curvatureMetaProxy,
  );
  values.curvature_meta_congruence = makeStringValue(
    curvatureMetaCongruence,
    "derived:curvature_meta_congruence",
    curvatureMetaProxy,
  );
  values.curvature_meta_proxy = {
    value: curvatureMetaProxy,
    source: "derived:curvature_meta_proxy",
    proxy: false,
  };

  const stressSourceRaw =
    (state as any)?.warp?.stressEnergySource ??
    (state as any)?.stressEnergySource;
  const stressMetaSource = stressSourceRaw === "metric"
    ? "metric"
    : state
      ? "pipeline"
      : "unknown";
  const stressMetaCongruence = stressMetaSource === "metric"
    ? "conditional"
    : "proxy-only";
  const stressMetaProxy = stressMetaCongruence !== "geometry-derived";
  values.stress_meta_source = makeStringValue(
    stressMetaSource,
    "derived:stress_meta_source",
    stressMetaProxy,
  );
  values.stress_meta_congruence = makeStringValue(
    stressMetaCongruence,
    "derived:stress_meta_congruence",
    stressMetaProxy,
  );
  values.stress_meta_proxy = {
    value: stressMetaProxy,
    source: "derived:stress_meta_proxy",
    proxy: false,
  };

  values.vdb_limit = makeValue(
    resolveNumber([
      { value: state.gammaVanDenBroeckGuard?.limit, source: "pipeline.gammaVanDenBroeckGuard.limit" },
    ]),
    "1",
  );
  values.vdb_pocket_radius_m = makeValue(
    resolveNumber([
      { value: state.gammaVanDenBroeckGuard?.pocketRadius_m, source: "pipeline.gammaVanDenBroeckGuard.pocketRadius_m" },
    ]),
    "m",
  );
  values.vdb_pocket_thickness_m = makeValue(
    resolveNumber([
      { value: state.gammaVanDenBroeckGuard?.pocketThickness_m, source: "pipeline.gammaVanDenBroeckGuard.pocketThickness_m" },
    ]),
    "m",
  );
  values.vdb_planck_margin = makeValue(
    resolveNumber([
      { value: state.gammaVanDenBroeckGuard?.planckMargin, source: "pipeline.gammaVanDenBroeckGuard.planckMargin" },
    ]),
    "1",
  );
  values.vdb_admissible = resolveBoolean(
    state.gammaVanDenBroeckGuard?.admissible,
    "pipeline.gammaVanDenBroeckGuard.admissible",
  );
  if (state.gammaVanDenBroeckGuard?.reason) {
    values.vdb_reason = {
      value: state.gammaVanDenBroeckGuard.reason,
      source: "pipeline.gammaVanDenBroeckGuard.reason",
      proxy: false,
    };
  }

  const vdbRegion = state.vdbRegionII;
  values.vdb_region_ii_alpha = makeValue(
    resolveNumber([{ value: vdbRegion?.alpha, source: "pipeline.vdbRegionII.alpha" }]),
    "1",
  );
  values.vdb_region_ii_n = makeValue(
    resolveNumber([{ value: vdbRegion?.n, source: "pipeline.vdbRegionII.n" }]),
    "1",
  );
  values.vdb_region_ii_r_tilde_m = makeValue(
    resolveNumber([{ value: vdbRegion?.r_tilde_m, source: "pipeline.vdbRegionII.r_tilde_m" }]),
    "m",
  );
  values.vdb_region_ii_delta_tilde_m = makeValue(
    resolveNumber([{ value: vdbRegion?.delta_tilde_m, source: "pipeline.vdbRegionII.delta_tilde_m" }]),
    "m",
  );
  const vdbBprimeMaxAbs = Number.isFinite(vdbRegion?.bprime_min) || Number.isFinite(vdbRegion?.bprime_max)
    ? Math.max(Math.abs(Number(vdbRegion?.bprime_min ?? 0)), Math.abs(Number(vdbRegion?.bprime_max ?? 0)))
    : undefined;
  const vdbBdoubleMaxAbs = Number.isFinite(vdbRegion?.bdouble_min) || Number.isFinite(vdbRegion?.bdouble_max)
    ? Math.max(Math.abs(Number(vdbRegion?.bdouble_min ?? 0)), Math.abs(Number(vdbRegion?.bdouble_max ?? 0)))
    : undefined;
  values.vdb_region_ii_bprime_max_abs = makeValue(
    resolveNumber([
      { value: vdbBprimeMaxAbs, source: "pipeline.vdbRegionII.bprime_max_abs" },
    ]),
    "1/m",
  );
  values.vdb_region_ii_bdouble_max_abs = makeValue(
    resolveNumber([
      { value: vdbBdoubleMaxAbs, source: "pipeline.vdbRegionII.bdouble_max_abs" },
    ]),
    "1/m^2",
  );
  values.vdb_region_ii_t00_min = makeValue(
    resolveNumber([{ value: vdbRegion?.t00_min, source: "pipeline.vdbRegionII.t00_min" }]),
    "J/m^3",
  );
  values.vdb_region_ii_t00_max = makeValue(
    resolveNumber([{ value: vdbRegion?.t00_max, source: "pipeline.vdbRegionII.t00_max" }]),
    "J/m^3",
  );
  values.vdb_region_ii_t00_mean = makeValue(
    resolveNumber([{ value: vdbRegion?.t00_mean, source: "pipeline.vdbRegionII.t00_mean" }]),
    "J/m^3",
  );
  values.vdb_region_ii_sample_count = makeValue(
    resolveNumber([{ value: vdbRegion?.sampleCount, source: "pipeline.vdbRegionII.sampleCount" }]),
    "1",
  );
  values.vdb_region_ii_support = resolveBoolean(
    vdbRegion?.support,
    "pipeline.vdbRegionII.support",
  );
  values.vdb_region_ii_derivative_support = resolveBoolean(
    (state as any).vdb_region_ii_derivative_support,
    "pipeline.vdb_region_ii_derivative_support",
  );
  if (vdbRegion?.note) {
    values.vdb_region_ii_note = {
      value: vdbRegion.note,
      source: "pipeline.vdbRegionII.note",
      proxy: false,
    };
  }

  const vdbRegionIV = state.vdbRegionIV;
  values.vdb_region_iv_R_m = makeValue(
    resolveNumber([{ value: vdbRegionIV?.R_m, source: "pipeline.vdbRegionIV.R_m" }]),
    "m",
  );
  values.vdb_region_iv_sigma = makeValue(
    resolveNumber([{ value: vdbRegionIV?.sigma, source: "pipeline.vdbRegionIV.sigma" }]),
    "1",
  );
  values.vdb_region_iv_dfdr_max_abs = makeValue(
    resolveNumber([{ value: vdbRegionIV?.dfdr_max_abs, source: "pipeline.vdbRegionIV.dfdr_max_abs" }]),
    "1/m",
  );
  values.vdb_region_iv_dfdr_rms = makeValue(
    resolveNumber([{ value: vdbRegionIV?.dfdr_rms, source: "pipeline.vdbRegionIV.dfdr_rms" }]),
    "1/m",
  );
  values.vdb_region_iv_t00_min = makeValue(
    resolveNumber([{ value: vdbRegionIV?.t00_min, source: "pipeline.vdbRegionIV.t00_min" }]),
    "J/m^3",
  );
  values.vdb_region_iv_t00_max = makeValue(
    resolveNumber([{ value: vdbRegionIV?.t00_max, source: "pipeline.vdbRegionIV.t00_max" }]),
    "J/m^3",
  );
  values.vdb_region_iv_t00_mean = makeValue(
    resolveNumber([{ value: vdbRegionIV?.t00_mean, source: "pipeline.vdbRegionIV.t00_mean" }]),
    "J/m^3",
  );
  values.vdb_region_iv_k_trace_mean = makeValue(
    resolveNumber([{ value: vdbRegionIV?.k_trace_mean, source: "pipeline.vdbRegionIV.k_trace_mean" }]),
    "1/m",
  );
  values.vdb_region_iv_k_squared_mean = makeValue(
    resolveNumber([{ value: vdbRegionIV?.k_squared_mean, source: "pipeline.vdbRegionIV.k_squared_mean" }]),
    "1/m^2",
  );
  values.vdb_region_iv_sample_count = makeValue(
    resolveNumber([{ value: vdbRegionIV?.sampleCount, source: "pipeline.vdbRegionIV.sampleCount" }]),
    "1",
  );
  values.vdb_region_iv_support = resolveBoolean(
    vdbRegionIV?.support,
    "pipeline.vdbRegionIV.support",
  );
  values.vdb_region_iv_derivative_support = resolveBoolean(
    (state as any).vdb_region_iv_derivative_support,
    "pipeline.vdb_region_iv_derivative_support",
  );
  if (vdbRegionIV?.note) {
    values.vdb_region_iv_note = {
      value: vdbRegionIV.note,
      source: "pipeline.vdbRegionIV.note",
      proxy: false,
    };
  }

  const vdbTwoWall =
    vdbRegion?.support === true && vdbRegionIV?.support === true;
  values.vdb_two_wall_support = resolveBoolean(
    vdbTwoWall,
    "derived:vdb_two_wall_support",
  );
  values.vdb_two_wall_derivative_support = resolveBoolean(
    (state as any).vdb_two_wall_derivative_support,
    "pipeline.vdb_two_wall_derivative_support",
  );
  if (vdbRegion || vdbRegionIV) {
    const missing: string[] = [];
    if (!vdbRegion?.support) missing.push("region II");
    if (!vdbRegionIV?.support) missing.push("region IV");
    if (missing.length) {
      values.vdb_two_wall_note = {
        value: `Missing support in ${missing.join(" + ")}.`,
        source: "derived:vdb_two_wall_note",
        proxy: false,
      };
    }
  }

  const mech = (state as any).mechanical ?? {};
  values.mechanical_gap_req_nm = makeValue(
    resolveNumber([
      { value: mech.requestedGap_nm, source: "pipeline.mechanical.requestedGap_nm" },
    ]),
    "nm",
  );
  values.mechanical_gap_eff_nm = makeValue(
    resolveNumber([
      { value: mech.constrainedGap_nm, source: "pipeline.mechanical.constrainedGap_nm" },
      { value: mech.recommendedGap_nm, source: "pipeline.mechanical.recommendedGap_nm", proxy: true },
    ]),
    "nm",
  );
  values.mechanical_safety_factor = makeValue(
    resolveNumber([
      { value: mech.mechSafetyFactor, source: "pipeline.mechanical.mechSafetyFactor" },
    ]),
    "1",
  );
  values.mechanical_safety_min = makeValue(
    resolveNumber([
      { value: mech.safetyFactorMin, source: "pipeline.mechanical.safetyFactorMin", proxy: true },
    ]),
    "1",
  );
  values.mechanical_load_pressure_Pa = makeValue(
    resolveNumber([
      { value: mech.loadPressure_Pa, source: "pipeline.mechanical.loadPressure_Pa" },
    ]),
    "Pa",
  );
  values.mechanical_sigma_allow_Pa = makeValue(
    resolveNumber([
      { value: mech.sigmaAllow_Pa, source: "pipeline.mechanical.sigmaAllow_Pa" },
    ]),
    "Pa",
  );
  values.mechanical_casimir_pressure_Pa = makeValue(
    resolveNumber([
      { value: mech.casimirPressure_Pa, source: "pipeline.mechanical.casimirPressure_Pa" },
    ]),
    "Pa",
  );
  values.mechanical_electrostatic_pressure_Pa = makeValue(
    resolveNumber([
      { value: mech.electrostaticPressure_Pa, source: "pipeline.mechanical.electrostaticPressure_Pa" },
    ]),
    "Pa",
  );
  values.mechanical_restoring_pressure_Pa = makeValue(
    resolveNumber([
      { value: mech.restoringPressure_Pa, source: "pipeline.mechanical.restoringPressure_Pa" },
    ]),
    "Pa",
  );
  values.mechanical_margin_Pa = makeValue(
    resolveNumber([
      { value: mech.margin_Pa, source: "pipeline.mechanical.margin_Pa" },
    ]),
    "Pa",
  );
  values.mechanical_max_stroke_pm = makeValue(
    resolveNumber([
      { value: mech.maxStroke_pm, source: "pipeline.mechanical.maxStroke_pm" },
    ]),
    "pm",
  );
  values.mechanical_stroke_feasible = resolveBoolean(
    mech.strokeFeasible,
    "pipeline.mechanical.strokeFeasible",
  );
  values.mechanical_feasible = resolveBoolean(
    mech.feasible,
    "pipeline.mechanical.feasible",
  );
  values.mechanical_safety_feasible = resolveBoolean(
    mech.safetyFeasible,
    "pipeline.mechanical.safetyFeasible",
  );
  values.mechanical_note = makeStringValue(
    typeof mech.note === "string" ? mech.note : null,
    "pipeline.mechanical.note",
    typeof mech.note !== "string",
  );

  if (state.qiInterest) {
    values.qi_interest_neg_Jm3 = makeValue(
      resolveNumber([
        { value: state.qiInterest.neg_Jm3, source: "pipeline.qiInterest.neg_Jm3" },
      ]),
      "J/m^3",
    );
    values.qi_interest_pos_Jm3 = makeValue(
      resolveNumber([
        { value: state.qiInterest.pos_Jm3, source: "pipeline.qiInterest.pos_Jm3" },
      ]),
      "J/m^3",
    );
    values.qi_interest_debt_Jm3 = makeValue(
      resolveNumber([
        { value: state.qiInterest.debt_Jm3, source: "pipeline.qiInterest.debt_Jm3" },
      ]),
      "J/m^3",
    );
    values.qi_interest_credit_Jm3 = makeValue(
      resolveNumber([
        { value: state.qiInterest.credit_Jm3, source: "pipeline.qiInterest.credit_Jm3" },
      ]),
      "J/m^3",
    );
    values.qi_interest_margin_Jm3 = makeValue(
      resolveNumber([
        { value: state.qiInterest.margin_Jm3, source: "pipeline.qiInterest.margin_Jm3" },
      ]),
      "J/m^3",
    );
  }

  const gain = gammaGeo.value ?? null;
  const kappaDrive =
    power.value != null &&
    hullArea.value != null &&
    dutyEffective.value != null &&
    gain != null &&
    hullArea.value > 0
      ? kappa_drive_from_power(
          power.value,
          hullArea.value,
          dutyEffective.value,
          gain,
        )
      : null;
  values.kappa_drive = makeDerivedNumber(
    kappaDrive,
    "1/m^2",
    "derived:kappa_drive_from_power",
    true,
    "curvature_proxy",
  );
  values.kappa_drive_gain = makeDerivedNumber(
    gain,
    "1",
    "derived:gamma_geo",
    gammaGeo.proxy,
  );

  const rhoAvgJm3 = values.rho_avg_J_m3.value;
  const backgroundGeometry =
    typeof rhoAvgJm3 === "number"
      ? buildBackgroundGeometryFromEnergyDensity({
          energyDensityJm3: rhoAvgJm3,
          sourceQuantityId: "rho_avg_J_m3",
          note:
            "Background geometry channel derived from the proof-pack average energy-density surface. This remains separate from the drive-power forcing channel.",
        })
      : null;
  const dynamicForcingGeometry =
    typeof power.value === "number" &&
    typeof hullArea.value === "number" &&
    hullArea.value > 0 &&
    typeof dutyEffective.value === "number" &&
    typeof gain === "number"
      ? buildDynamicForcingGeometryFromPower({
          powerW: power.value,
          areaM2: hullArea.value,
          dEff: dutyEffective.value,
          gain,
          sourceQuantityId: "power_avg_W",
          note:
            "Dynamic forcing geometry channel derived from average drive power over hull area, with duty and geometric gain preserved explicitly.",
        })
      : null;
  const quantumSourceReplayId =
    typeof state.quantum_semiclassical_source_replay_id === "string" &&
    state.quantum_semiclassical_source_replay_id.trim().length > 0
      ? state.quantum_semiclassical_source_replay_id.trim()
      : null;
  const quantumTauOrPredictedS = toFiniteNumber(state.quantum_semiclassical_tau_or_predicted_s);
  const quantumCollapseBoundMargin = toFiniteNumber(state.quantum_semiclassical_collapse_bound_margin);
  const quantumSourceReplay = resolveQuantumSemiclassicalSourceReplay(quantumSourceReplayId);
  if (quantumSourceReplayId && !quantumSourceReplay) {
    throw new Error(`unknown quantum_semiclassical_source_replay_id: ${quantumSourceReplayId}`);
  }
  const quantumComparison =
    quantumSourceReplay && quantumTauOrPredictedS != null && quantumTauOrPredictedS > 0
      ? buildQuantumSemiclassicalComparisonResult({
          schema_version: "quantum_semiclassical_comparison/1",
          tau_or_predicted_s: quantumTauOrPredictedS,
          ...(quantumCollapseBoundMargin != null
            ? { collapse_bound_margin: quantumCollapseBoundMargin }
            : {}),
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


  const sectorGuardrails = (state as any).sectorControl?.constraints as Record<string, unknown> | undefined;
  values.sector_control_ts_ratio = makeValue(
    resolveNumber([{ value: (state as any).sectorControl?.timing?.TS_ratio, source: "pipeline.sectorControl.timing.TS_ratio" }]),
    "1",
  );
  values.sector_control_qi_margin_ratio = makeValue(
    resolveNumber([{ value: (state as any).qiGuardrail?.marginRatio, source: "pipeline.qiGuardrail.marginRatio" }]),
    "1",
  );
  values.sector_control_guardrails = makeStringValue(
    sectorGuardrails ? JSON.stringify(sectorGuardrails) : null,
    "pipeline.sectorControl.constraints",
    !sectorGuardrails,
  );
  values.sector_control_first_fail = makeStringValue(
    typeof (state as any).sectorControl?.firstFail === "string" ? (state as any).sectorControl.firstFail : null,
    "pipeline.sectorControl.firstFail",
    typeof (state as any).sectorControl?.firstFail !== "string",
  );

  values.overall_status = {
    value: state.overallStatus ?? null,
    source: "pipeline.overallStatus",
    proxy: false,
  };

  const equations =
    (state as any).uniformsExplain?.equations &&
    typeof (state as any).uniformsExplain.equations === "object"
      ? ((state as any).uniformsExplain.equations as Record<string, string>)
      : undefined;
  const sources =
    (state as any).uniformsExplain?.sources &&
    typeof (state as any).uniformsExplain.sources === "object"
      ? ((state as any).uniformsExplain.sources as Record<string, string>)
      : undefined;

  const missingKeys = Object.entries(values)
    .filter(([, entry]) => entry.value == null)
    .map(([key]) => key);
  if (missingKeys.length) {
    notes.push(`missing_values=${missingKeys.join(",")}`);
  }

  return {
    kind: "proof-pack",
    version: 1,
    generatedAt: new Date().toISOString(),
    pipeline: {
      seq: (state as any).seq,
      ts: (state as any).__ts,
      mode: state.currentMode,
    },
    values,
    equations,
    sources,
    ...(backgroundGeometry ? { background_geometry: backgroundGeometry, geometry_coupling: backgroundGeometry } : {}),
    ...(dynamicForcingGeometry ? { dynamic_forcing_geometry: dynamicForcingGeometry } : {}),
    ...(quantumSourceReplay ? { quantum_semiclassical_source_replay: quantumSourceReplay } : {}),
    ...(quantumComparison ? { quantum_semiclassical_comparison: quantumComparison } : {}),
    notes: notes.length ? notes : undefined,
  };
}
