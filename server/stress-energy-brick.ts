import { Buffer } from "node:buffer";
import { resolveHullRadius, type HullRadialMap, type Vec3 } from "./curvature-brick.ts";
import { getGlobalPipelineState } from "./energy-pipeline.ts";
import { enhancedAvgEnergyDensity, natarioShiftFromDensity } from "../modules/dynamic/stress-energy-equations.ts";
import { computeInvariantMassFromFluxTotals } from "../modules/gr/stress-energy-integrals.ts";
import { PROMOTED_WARP_PROFILE } from "../shared/warp-promoted-profile.ts";

export type Nhm2SourceRedesignMode =
  | "signed_shell_bias"
  | "coupling_localization"
  | "drive_vs_geometry_split"
  | "source_profile_simplified_signed";

export type Nhm2SourceReformulationMode =
  | "volume_driven_signed_source"
  | "fore_aft_antisymmetric_driver"
  | "geometry_source_decoupling"
  | "shell_to_dual_layer_family";

export interface StressEnergyBrickParams {
  dims: [number, number, number];
  bounds?: { min: Vec3; max: Vec3 };
  phase01: number;
  sigmaSector: number;
  splitEnabled: boolean;
  splitFrac: number;
  dutyFR: number;
  q: number;
  gammaGeo: number;
  gammaVdB: number;
  ampBase: number;
  zeta: number;
  driveDir?: Vec3 | null;
  hullAxes?: Vec3;
  hullWall?: number;
  radialMap?: HullRadialMap | null;
  metricT00?: number;
  metricT00Source?: string;
  metricT00Ref?: string;
  warpFieldType?:
    | "natario"
    | "natario_sdf"
    | "nhm2_shift_lapse"
    | "alcubierre"
    | "irrotational";
  sourceRedesignMode?: Nhm2SourceRedesignMode | null;
  sourceReformulationMode?: Nhm2SourceReformulationMode | null;
  observerRapidityCap?: number;
  observerTypeITolerance?: number;
}

export interface StressEnergyChannel {
  data: Float32Array;
  min: number;
  max: number;
}

export interface StressEnergyTensorSummary {
  T00: number;
  T11: number;
  T22: number;
  T33: number;
}

export interface StressEnergyTensorRegionSummary {
  regionId: "global" | "hull" | "wall" | "exterior_shell";
  sampleCount: number;
  tensor: StressEnergyTensorSummary;
  aggregationMode?: "mean";
  normalizationBasis?: "sample_count";
  weightSum?: number | null;
  accountingEvidenceStatus?: "measured";
  t00Diagnostics?: {
    sampleCount: number;
    includedCount: number;
    skippedCount: number | null;
    nonFiniteCount: number | null;
    meanT00: number;
    sumT00: number;
    normalizationBasis: "sample_count";
    aggregationMode: "mean";
    evidenceStatus: "measured" | "inferred" | "unknown";
  };
  note?: string;
}

export type StressEnergyBrickRegionId =
  Exclude<StressEnergyTensorRegionSummary["regionId"], "global">;

export interface StressEnergyBrickRegionVoxelSample {
  position: Vec3;
  classifiedRegionId: StressEnergyBrickRegionId | null;
  cellVolume: number;
  voxelIndex: [number, number, number];
}

export interface StressEnergyTensorSampledSummaries {
  pressureModel: "isotropic_pressure_proxy";
  regions: StressEnergyTensorRegionSummary[];
}

export interface StressEnergyStats {
  totalEnergy_J: number;
  avgT00: number;
  avgFluxMagnitude: number;
  netFlux: Vec3;
  totalMomentum_kg_m_s?: Vec3;
  momentumMagnitude_kg_m_s?: number;
  invariantMass_kg?: number;
  invariantMassEnergy_J?: number;
  divMin: number;
  divMax: number;
  dutyFR: number;
  strobePhase: number;
  natario?: NatarioDiagnostics;
  conservation?: StressEnergyConservationStats;
  mapping?: StressEnergyMappingStats;
  tensorSampledSummaries?: StressEnergyTensorSampledSummaries;
  observerRobust?: ObserverRobustDiagnostics;
}

export interface NatarioDiagnostics {
  divBetaMax: number;
  divBetaRms: number;
  divBetaMaxPre?: number;
  divBetaRmsPre?: number;
  divBetaMaxPost?: number;
  divBetaRmsPost?: number;
  clampScale?: number;
  clampApplied?: boolean;
  clampActivationRate?: number;
  clampMode?: "natario" | "stability";
  gateLimit: number;
  gNatario: number;
}

export interface StressEnergyConservationStats {
  divMean: number;
  divAbsMean: number;
  divRms: number;
  divMaxAbs: number;
  netFluxMagnitude: number;
  netFluxNorm: number;
  divRmsNorm: number;
}

export interface StressEnergyMappingStats {
  rho_avg: number;
  rho_inst: number;
  gap_nm: number;
  cavityQ: number;
  qSpoil: number;
  gammaGeo: number;
  gammaVdB: number;
  dutyFR: number;
  ampBase: number;
  zeta: number;
  pressureFactor?: number;
  pressureSource?: "pipeline" | "proxy" | "override";
  anisotropyStrength?: number;
  anisotropyMode?: "flux" | "radial";
  conservationDamping?: number;
  conservationNetFlux?: boolean;
  conservationScale?: number;
  source?: "pipeline" | "defaults" | "metric";
  proxy: boolean;
  family_id?: string;
  source_branch?: string;
  shape_function_id?: string;
  warpFieldType?: string;
  metricT00Ref?: string;
  sourceRedesignMode?: Nhm2SourceRedesignMode | null;
  sourceReformulationMode?: Nhm2SourceReformulationMode | null;
}

export type ObserverMarginSource = "algebraic_type_i" | "capped_search";

export interface ObserverConditionSummary {
  eulerianMin: number;
  eulerianMean: number;
  robustMin: number;
  robustMean: number;
  eulerianViolationFraction: number;
  robustViolationFraction: number;
  missedViolationFraction: number;
  severityGainMin: number;
  severityGainMean: number;
  maxRobustMinusEulerian: number;
  worstCase: {
    index: number;
    value: number;
    direction: Vec3;
    rapidity: number | null;
    source: ObserverMarginSource;
  };
}

export interface ObserverRobustDiagnostics {
  pressureModel: "isotropic_pressure";
  pressureFactor: number;
  rapidityCap: number;
  rapidityCapBeta: number;
  typeI: {
    count: number;
    fraction: number;
    tolerance: number;
  };
  nec: ObserverConditionSummary;
  wec: ObserverConditionSummary;
  sec: ObserverConditionSummary;
  dec: ObserverConditionSummary;
  consistency: {
    robustNotGreaterThanEulerian: boolean;
    maxRobustMinusEulerian: number;
  };
}

export interface StressEnergyBrick {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  source?: "pipeline" | "metric" | "unknown";
  proxy?: boolean;
  congruence?: "proxy-only" | "geometry-derived" | "conditional";
  metricT00Ref?: string;
  metricT00Source?: string;
  family_id?: string;
  source_branch?: string;
  shape_function_id?: string;
  warpFieldType?: string;
  sourceRedesignMode?: Nhm2SourceRedesignMode | null;
  sourceReformulationMode?: Nhm2SourceReformulationMode | null;
  channels: {
    t00: StressEnergyChannel;
    Sx: StressEnergyChannel;
    Sy: StressEnergyChannel;
    Sz: StressEnergyChannel;
    divS: StressEnergyChannel;
  };
  stats: StressEnergyStats;
}

const EPS = 1e-9;
const TWO_PI = Math.PI * 2;
const NATARIO_K_TOL = 1e-6;
const ALCUBIERRE_K_TOL = 1e-4;
const DEFAULT_OBSERVER_RAPIDITY_CAP = 2.5;
const DEFAULT_HAWKING_ELLIS_TYPE_I_TOL = 1e-9;
const STRESS_ENERGY_CHANNEL_ORDER = ["t00", "Sx", "Sy", "Sz", "divS"] as const;

type TensorRegionAccumulator = {
  count: number;
  includedCount: number;
  skippedCount: number;
  nonFiniteCount: number;
  sumT00: number;
};

const createTensorRegionAccumulator = (): TensorRegionAccumulator => ({
  count: 0,
  includedCount: 0,
  skippedCount: 0,
  nonFiniteCount: 0,
  sumT00: 0,
});

const buildTensorSummaryFromMeanT00 = (
  meanT00: number,
  pressureFactor: number,
): StressEnergyTensorSummary => ({
  T00: meanT00,
  T11: meanT00 * pressureFactor,
  T22: meanT00 * pressureFactor,
  T33: meanT00 * pressureFactor,
});

const buildTensorRegionSummary = (
  regionId: StressEnergyTensorRegionSummary["regionId"],
  accumulator: TensorRegionAccumulator,
  pressureFactor: number,
  note?: string,
): StressEnergyTensorRegionSummary | null => {
  if (accumulator.count <= 0) return null;
  return {
    regionId,
    sampleCount: accumulator.count,
    tensor: buildTensorSummaryFromMeanT00(
      accumulator.sumT00 / accumulator.count,
      pressureFactor,
    ),
    aggregationMode: "mean",
    normalizationBasis: "sample_count",
    weightSum: accumulator.count,
    accountingEvidenceStatus: "measured",
    t00Diagnostics: {
      sampleCount: accumulator.count,
      includedCount: accumulator.includedCount,
      skippedCount: null,
      nonFiniteCount: null,
      meanT00: accumulator.sumT00 / accumulator.count,
      sumT00: accumulator.sumT00,
      normalizationBasis: "sample_count",
      aggregationMode: "mean",
      evidenceStatus: "inferred",
    },
    ...(note ? { note } : {}),
  };
};

type StressEnergyFamilyId =
  | "alcubierre_control"
  | "natario_control"
  | "nhm2_certified"
  | "nhm2_shift_lapse_diagnostic"
  | "nhm2_redesign_signed_shell_bias"
  | "nhm2_redesign_coupling_localization"
  | "nhm2_redesign_drive_vs_geometry_split"
  | "nhm2_redesign_source_profile_simplified_signed"
  | "nhm2_reform_volume_driven_signed_source"
  | "nhm2_reform_fore_aft_antisymmetric_driver"
  | "nhm2_reform_geometry_source_decoupling"
  | "nhm2_reform_shell_to_dual_layer_family"
  | "irrotational_control"
  | "vdb_control"
  | "unknown";

type StressEnergySourceBranch =
  | "metric_t00_ref"
  | "warp_field_type"
  | "pipeline_default"
  | "source_redesign_mode"
  | "source_reformulation_mode";

type StressEnergyFamilyContext = {
  familyId: StressEnergyFamilyId;
  sourceBranch: StressEnergySourceBranch;
  warpFieldType:
    | "natario"
    | "natario_sdf"
    | "nhm2_shift_lapse"
    | "alcubierre"
    | "irrotational";
  shapeFunctionId: string;
  sourceRedesignMode?: Nhm2SourceRedesignMode | null;
  sourceReformulationMode?: Nhm2SourceReformulationMode | null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const wrap01 = (value: number) => {
  const n = value % 1;
  return n < 0 ? n + 1 : n;
};

const gaussian = (x: number, sigma: number) => {
  const s = Math.max(sigma, 1e-4);
  const t = x / s;
  return Math.exp(-0.5 * t * t);
};

const shortestPhaseDelta = (a: number, b: number) => {
  let delta = a - b;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
};

const normalize = (v: Vec3): Vec3 => {
  const [x, y, z] = v;
  const mag = Math.hypot(x, y, z);
  if (!Number.isFinite(mag) || mag === 0) {
    return [0, 0, 0];
  }
  return [x / mag, y / mag, z / mag];
};

const defaultHullBounds = () => {
  const state = getGlobalPipelineState();
  const hull = state?.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173, wallThickness_m: 0.45 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return {
    min,
    max,
    axes: [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2] as Vec3,
    wall: hull.wallThickness_m ?? 0.45,
  };
};

const resolveShiftLapseTileSourceAttenuation = (args: {
  state: ReturnType<typeof getGlobalPipelineState>;
  familyContext: StressEnergyFamilyContext;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return 1;
  }
  const warpState = (args.state as any)?.warp;
  const dynamicConfig = (args.state as any)?.dynamicConfig;
  const alphaCenterline =
    Number.isFinite(warpState?.lapseSummary?.alphaCenterline)
      ? Number(warpState.lapseSummary.alphaCenterline)
      : Number.isFinite(warpState?.metricAdapter?.lapseSummary?.alphaCenterline)
        ? Number(warpState.metricAdapter.lapseSummary.alphaCenterline)
        : Number.isFinite(warpState?.metricAdapter?.alpha)
          ? Number(warpState.metricAdapter.alpha)
          : Number.isFinite(dynamicConfig?.alphaCenterline)
            ? Number(dynamicConfig.alphaCenterline)
            : 1;
  const clampedAlpha = Math.max(1e-6, Math.min(1, alphaCenterline));
  // Keep the tile proxy source on the same selected lapse profile branch as the
  // selected brick proxy lane so NHM2 shift+lapse production changes reach the
  // emitted tile-effective density path even when the brick is seeded from metric T00.
  return clampedAlpha ** 4;
};

const resolveShiftLapseTileSupportSigma = (args: {
  familyContext: StressEnergyFamilyContext;
  wallSigma: number;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return args.wallSigma;
  }
  // Keep the NHM2 tile proxy on a broadened shell-support lane so the
  // production proxy does not collapse the full shift+lapse support into an
  // excessively sharp wall-localized density spike. The residual tile WEC lane
  // is still dominated by shell concentration, so we keep widening this
  // support modestly until the proxy density flattens on the real production
  // surface instead of only at the observer layer.
  return args.wallSigma * 1.5;
};

const resolveShiftLapseTileSupportFalloffExponent = (args: {
  familyContext: StressEnergyFamilyContext;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return 1;
  }
  // The residual NHM2 tile blocker is still a wall-localized proxy-density
  // spike. Keep the widened support width fixed and instead flatten the
  // support falloff slightly so the production proxy redistributes density
  // across the same shell rather than deepening the peak at the same location.
  return 0.9;
};

const resolveShiftLapseTileSectorSigma = (args: {
  familyContext: StressEnergyFamilyContext;
  sectorSigma: number;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return args.sectorSigma;
  }
  // The remaining NHM2 tile blocker is now dominated by azimuthal peak
  // concentration on the real production proxy lane. Widen the sector support
  // slightly so the same normalized source spreads across nearby sectors
  // instead of deepening the wall-local minimum at a single phase slice.
  return args.sectorSigma * 1.08;
};

const resolveShiftLapseTileLocalShellBias = (args: {
  familyContext: StressEnergyFamilyContext;
  signedLongitudinal: number;
  shellSharpen: number;
  volumeEnvelope: number;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return 1;
  }
  // After widening support and sector spread, the remaining NHM2 tile blocker is
  // the sharp wall-local residual sitting on comparatively low-volume support.
  // Reduce that shell bias most on aft shoulder voxels so the normalized
  // source redistributes across nearby aft support instead of keeping the
  // deepest minimum pinned to the aft wall shoulder.
  const shellSharpen = clamp01(args.shellSharpen);
  const shellShoulder = clamp01(4 * shellSharpen * (1 - shellSharpen));
  const volumePenalty = 1 - clamp01(args.volumeEnvelope);
  const shellPeakPenalty = shellSharpen * volumePenalty;
  const aftShoulderPenalty = clamp01(-args.signedLongitudinal) * shellShoulder * volumePenalty;
  return 1 - 0.2 * shellPeakPenalty - 0.08 * aftShoulderPenalty;
};

const resolveShiftLapseTileAftSupportSigmaMultiplier = (args: {
  familyContext: StressEnergyFamilyContext;
  signedLongitudinal: number;
  shellSharpen: number;
  volumeEnvelope: number;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return 1;
  }
  // The residual NHM2 worst-case direction remains aft-facing. Broaden only the
  // aft shell support on sharp, low-volume wall voxels so the production proxy
  // redistributes the same normalized source across nearby aft support instead
  // of deepening the minimum on the aft wall.
  const shellSharpen = clamp01(args.shellSharpen);
  const shellShoulder = clamp01(4 * shellSharpen * (1 - shellSharpen));
  const volumeEnvelope = clamp01(args.volumeEnvelope);
  const volumePenalty = 1 - volumeEnvelope;
  const volumeRelay = clamp01(4 * volumeEnvelope * volumePenalty);
  const aftBias = clamp01(-args.signedLongitudinal);
  const shoulderSkew = clamp01(shellShoulder * (1 + 0.35 * (1 - shellSharpen)));
  const shoulderPlateau = clamp01(shoulderSkew * (1 + 0.25 * volumePenalty));
  const aftShoulderShelf = clamp01(shoulderPlateau * (1 + 0.35 * aftBias * volumePenalty));
  const aftShoulderBridge = clamp01(aftShoulderShelf * (1 + 0.35 * volumeRelay));
  const aftRelayShelf = clamp01(aftShoulderBridge * (1 + 0.5 * aftBias * volumeRelay));
  const aftSpreadDriver =
    aftBias * aftRelayShelf * clamp01(volumePenalty + 0.45 * volumeRelay + 0.2 * aftBias * volumeRelay);
  return 1 + 9.0 * aftSpreadDriver;
};

const resolveShiftLapseTileAftAggregationWeight = (args: {
  familyContext: StressEnergyFamilyContext;
  signedLongitudinal: number;
  shellSharpen: number;
  volumeEnvelope: number;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return 1;
  }
  // The current worst-case direction is still aft-facing, but directly
  // suppressing the aft core deepened the normalized minimum. Instead, boost
  // only the aft support shoulder on sharp, low-volume voxels so the same
  // normalized source aggregates across nearby aft support instead of staying
  // pinned to the deepest aft wall sample.
  const shellSharpen = clamp01(args.shellSharpen);
  const shellShoulder = clamp01(4 * shellSharpen * (1 - shellSharpen));
  const aftSupportShoulder =
    clamp01(-args.signedLongitudinal) *
    shellShoulder *
    (1 - clamp01(args.volumeEnvelope));
  return 1 + 0.24 * aftSupportShoulder;
};

const resolveShiftLapseTileAftFalloffExponentMultiplier = (args: {
  familyContext: StressEnergyFamilyContext;
  signedLongitudinal: number;
  shellSharpen: number;
  volumeEnvelope: number;
  dualLayerEnvelope: number;
}): number => {
  if (args.familyContext.warpFieldType !== "nhm2_shift_lapse") {
    return 1;
  }
  // The remaining NHM2 worst-case stays aft-facing after widening the aft
  // support shoulder. Flatten only the aft wall taper on broad shoulder voxels,
  // and bias that flattening toward the outer dual-layer shoulder so the proxy
  // redistributes across nearby aft wall support instead of keeping the deepest
  // minimum on the same aft shell slice.
  const shellSharpen = clamp01(args.shellSharpen);
  const shellShoulder = clamp01(4 * shellSharpen * (1 - shellSharpen));
  const aftTaperDriver =
    clamp01(-args.signedLongitudinal) *
    clamp01(shellShoulder * (0.7 + 0.3 * clamp01(args.dualLayerEnvelope))) *
    clamp01((1 - clamp01(args.volumeEnvelope)) + 0.5 * clamp01(4 * clamp01(args.volumeEnvelope) * (1 - clamp01(args.volumeEnvelope))));
  return 1 - 0.46 * aftTaperDriver;
};

const ellipsoidNormal = (pos: Vec3, axesSq: Vec3): Vec3 => {
  const [x, y, z] = pos;
  const nx = x / Math.max(axesSq[0], 1e-6);
  const ny = y / Math.max(axesSq[1], 1e-6);
  const nz = z / Math.max(axesSq[2], 1e-6);
  return normalize([nx, ny, nz]);
};

const azimuth01 = (x: number, z: number) => wrap01((Math.atan2(z, x) / TWO_PI) + 0.5);

const computeSectorEnvelope = (theta: number, phase01: number, params: { sigma: number; splitEnabled: boolean; splitFrac: number }) => {
  const primary = gaussian(shortestPhaseDelta(theta, phase01), params.sigma);
  if (!params.splitEnabled) {
    return primary;
  }
  const secondaryPhase = wrap01(phase01 + 0.5);
  const secondary = gaussian(shortestPhaseDelta(theta, secondaryPhase), params.sigma);
  const frac = clamp01(params.splitFrac);
  return frac * primary + (1 - frac) * secondary;
};

const blendDirections = (a: Vec3, b: Vec3 | null, weight: number): Vec3 => {
  if (!b) return a;
  const t = clamp01(weight);
  return normalize([
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ]);
};

const normalizeWarpFieldType = (
  value: unknown,
): "natario" | "natario_sdf" | "nhm2_shift_lapse" | "alcubierre" | "irrotational" | null => {
  if (
    value === "natario" ||
    value === "natario_sdf" ||
    value === "nhm2_shift_lapse" ||
    value === "alcubierre" ||
    value === "irrotational"
  ) {
    return value;
  }
  return null;
};

const normalizeNhm2SourceRedesignMode = (value: unknown): Nhm2SourceRedesignMode | null => {
  if (
    value === "signed_shell_bias" ||
    value === "coupling_localization" ||
    value === "drive_vs_geometry_split" ||
    value === "source_profile_simplified_signed"
  ) {
    return value;
  }
  return null;
};

const normalizeNhm2SourceReformulationMode = (
  value: unknown,
): Nhm2SourceReformulationMode | null => {
  if (
    value === "volume_driven_signed_source" ||
    value === "fore_aft_antisymmetric_driver" ||
    value === "geometry_source_decoupling" ||
    value === "shell_to_dual_layer_family"
  ) {
    return value;
  }
  return null;
};

const resolveFamilyFromMetricRef = (metricT00Ref: string | undefined): StressEnergyFamilyContext | null => {
  if (!metricT00Ref) return null;
  const lower = metricT00Ref.toLowerCase();
  if (lower.includes(".alcubierre.")) {
    return {
      familyId: "alcubierre_control",
      sourceBranch: "metric_t00_ref",
      warpFieldType: "alcubierre",
      shapeFunctionId: "alcubierre_longitudinal_shell_v1",
    };
  }
  if (lower.includes(".natario_sdf.")) {
    return {
      familyId: "nhm2_certified",
      sourceBranch: "metric_t00_ref",
      warpFieldType: "natario_sdf",
      shapeFunctionId: "nhm2_natario_sdf_shell_v1",
    };
  }
  if (lower.includes(".nhm2.") && lower.includes(".shift_lapse")) {
    return {
      familyId: "nhm2_shift_lapse_diagnostic",
      sourceBranch: "metric_t00_ref",
      warpFieldType: "nhm2_shift_lapse",
      shapeFunctionId: "nhm2_shift_lapse_shell_v1",
    };
  }
  if (lower.includes(".natario.")) {
    return {
      familyId: "natario_control",
      sourceBranch: "metric_t00_ref",
      warpFieldType: "natario",
      shapeFunctionId: "natario_shift_shell_v1",
    };
  }
  if (lower.includes(".irrotational.")) {
    return {
      familyId: "irrotational_control",
      sourceBranch: "metric_t00_ref",
      warpFieldType: "irrotational",
      shapeFunctionId: "irrotational_shell_v1",
    };
  }
  if (lower.includes(".vdb.")) {
    return {
      familyId: "vdb_control",
      sourceBranch: "metric_t00_ref",
      warpFieldType: "natario",
      shapeFunctionId: "vdb_regionii_shell_v1",
    };
  }
  return null;
};

const resolveFamilyFromWarpFieldType = (
  warpFieldType: "natario" | "natario_sdf" | "nhm2_shift_lapse" | "alcubierre" | "irrotational",
  sourceBranch: StressEnergySourceBranch,
): StressEnergyFamilyContext => {
  if (warpFieldType === "alcubierre") {
    return {
      familyId: "alcubierre_control",
      sourceBranch,
      warpFieldType,
      shapeFunctionId: "alcubierre_longitudinal_shell_v1",
    };
  }
  if (warpFieldType === "natario_sdf") {
    return {
      familyId: "nhm2_certified",
      sourceBranch,
      warpFieldType,
      shapeFunctionId: "nhm2_natario_sdf_shell_v1",
    };
  }
  if (warpFieldType === "nhm2_shift_lapse") {
    return {
      familyId: "nhm2_shift_lapse_diagnostic",
      sourceBranch,
      warpFieldType,
      shapeFunctionId: "nhm2_shift_lapse_shell_v1",
    };
  }
  if (warpFieldType === "irrotational") {
    return {
      familyId: "irrotational_control",
      sourceBranch,
      warpFieldType,
      shapeFunctionId: "irrotational_shell_v1",
    };
  }
  return {
    familyId: "natario_control",
    sourceBranch,
    warpFieldType: "natario",
    shapeFunctionId: "natario_shift_shell_v1",
  };
};

const resolveStressEnergyFamilyContext = (args: {
  metricT00Ref?: string;
  inputWarpFieldType?: string | null;
  stateWarpFieldType?: string | null;
}): StressEnergyFamilyContext => {
  const fromRef = resolveFamilyFromMetricRef(args.metricT00Ref);
  if (fromRef) return fromRef;
  const fromInputWarp = normalizeWarpFieldType(args.inputWarpFieldType);
  if (fromInputWarp) {
    return resolveFamilyFromWarpFieldType(fromInputWarp, "warp_field_type");
  }
  const fromStateWarp = normalizeWarpFieldType(args.stateWarpFieldType);
  if (fromStateWarp) {
    return resolveFamilyFromWarpFieldType(fromStateWarp, "pipeline_default");
  }
  return {
    familyId: "unknown",
    sourceBranch: "pipeline_default",
    warpFieldType: "natario",
    shapeFunctionId: "natario_shift_shell_v1",
  };
};

const applyNhm2SourceRedesignContext = (
  context: StressEnergyFamilyContext,
  sourceRedesignMode: Nhm2SourceRedesignMode | null,
): StressEnergyFamilyContext => {
  if (context.familyId !== "nhm2_certified" || sourceRedesignMode == null) {
    return context;
  }
  if (sourceRedesignMode === "signed_shell_bias") {
    return {
      familyId: "nhm2_redesign_signed_shell_bias",
      sourceBranch: "source_redesign_mode",
      warpFieldType: context.warpFieldType,
      shapeFunctionId: "nhm2_redesign_signed_shell_bias_v1",
      sourceRedesignMode,
    };
  }
  if (sourceRedesignMode === "coupling_localization") {
    return {
      familyId: "nhm2_redesign_coupling_localization",
      sourceBranch: "source_redesign_mode",
      warpFieldType: context.warpFieldType,
      shapeFunctionId: "nhm2_redesign_coupling_localization_v1",
      sourceRedesignMode,
    };
  }
  if (sourceRedesignMode === "drive_vs_geometry_split") {
    return {
      familyId: "nhm2_redesign_drive_vs_geometry_split",
      sourceBranch: "source_redesign_mode",
      warpFieldType: context.warpFieldType,
      shapeFunctionId: "nhm2_redesign_drive_vs_geometry_split_v1",
      sourceRedesignMode,
    };
  }
  return {
    familyId: "nhm2_redesign_source_profile_simplified_signed",
    sourceBranch: "source_redesign_mode",
    warpFieldType: context.warpFieldType,
    shapeFunctionId: "nhm2_redesign_source_profile_simplified_signed_v1",
    sourceRedesignMode,
  };
};

const applyNhm2SourceReformulationContext = (
  context: StressEnergyFamilyContext,
  sourceReformulationMode: Nhm2SourceReformulationMode | null,
): StressEnergyFamilyContext => {
  if (context.familyId !== "nhm2_certified" || sourceReformulationMode == null) {
    return context;
  }
  if (sourceReformulationMode === "volume_driven_signed_source") {
    return {
      familyId: "nhm2_reform_volume_driven_signed_source",
      sourceBranch: "source_reformulation_mode",
      warpFieldType: context.warpFieldType,
      shapeFunctionId: "nhm2_reform_volume_driven_signed_source_v1",
      sourceReformulationMode,
    };
  }
  if (sourceReformulationMode === "fore_aft_antisymmetric_driver") {
    return {
      familyId: "nhm2_reform_fore_aft_antisymmetric_driver",
      sourceBranch: "source_reformulation_mode",
      warpFieldType: context.warpFieldType,
      shapeFunctionId: "nhm2_reform_fore_aft_antisymmetric_driver_v1",
      sourceReformulationMode,
    };
  }
  if (sourceReformulationMode === "geometry_source_decoupling") {
    return {
      familyId: "nhm2_reform_geometry_source_decoupling",
      sourceBranch: "source_reformulation_mode",
      warpFieldType: context.warpFieldType,
      shapeFunctionId: "nhm2_reform_geometry_source_decoupling_v1",
      sourceReformulationMode,
    };
  }
  return {
    familyId: "nhm2_reform_shell_to_dual_layer_family",
    sourceBranch: "source_reformulation_mode",
    warpFieldType: context.warpFieldType,
    shapeFunctionId: "nhm2_reform_shell_to_dual_layer_family_v1",
    sourceReformulationMode,
  };
};

type Nhm2StructuralScalars = {
  xNorm: number;
  axialBias: number;
  signedLongitudinal: number;
  shellSharpen: number;
  volumeEnvelope: number;
  frontLobe: number;
  aftLobe: number;
  antisymmetricDriver: number;
  dualLayerEnvelope: number;
};

const computeNhm2StructuralScalars = (args: {
  px: number;
  py: number;
  pz: number;
  centerDist: number;
  wallSigma: number;
  axes: Vec3;
}): Nhm2StructuralScalars => {
  const xNorm = args.px / Math.max(args.axes[0], 1e-6);
  const axialBias = 0.5 + 0.5 * Math.tanh(xNorm / 0.25);
  const signedLongitudinal = clamp01(axialBias) * 2 - 1;
  const shellSharpen = Math.exp(
    -0.5 * Math.pow(args.centerDist / Math.max(args.wallSigma * 0.72, 1e-6), 2),
  );
  const volumeEnvelope = Math.exp(
    -0.5 *
      (Math.pow(args.px / Math.max(args.axes[0] * 0.58, 1e-6), 2) +
        Math.pow(args.py / Math.max(args.axes[1] * 0.72, 1e-6), 2) +
        Math.pow(args.pz / Math.max(args.axes[2] * 0.72, 1e-6), 2)),
  );
  const frontLobe = gaussian(xNorm - 0.38, 0.16);
  const aftLobe = gaussian(xNorm + 0.38, 0.16);
  const antisymmetricDriver = frontLobe - aftLobe;
  const dualLayerEnvelope =
    gaussian(args.centerDist - args.wallSigma * 0.7, Math.max(args.wallSigma * 0.8, 1e-6)) -
    0.85 * gaussian(args.centerDist + args.wallSigma * 0.55, Math.max(args.wallSigma * 0.55, 1e-6));
  return {
    xNorm,
    axialBias,
    signedLongitudinal,
    shellSharpen,
    volumeEnvelope,
    frontLobe,
    aftLobe,
    antisymmetricDriver,
    dualLayerEnvelope,
  };
};

const encodeFloat32 = (payload: Float32Array) =>
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("base64");

const axisIndex = (x: number, y: number, z: number, nx: number, ny: number) => z * nx * ny + y * nx + x;

const classifyStressEnergyBrickRegion = (args: {
  position: Vec3;
  axes: Vec3;
  radialMap: HullRadialMap | null;
  wallSigma: number;
}): StressEnergyBrickRegionId | null => {
  const [px, py, pz] = args.position;
  const pLen = Math.hypot(px, py, pz);
  const dir =
    pLen > 1e-9
      ? ([px / pLen, py / pLen, pz / pLen] as Vec3)
      : ([0, 0, 0] as Vec3);
  const radius = resolveHullRadius(dir, args.axes, args.radialMap);
  const centerDist = pLen - radius;
  const exteriorShellLimit = args.wallSigma * 3;
  if (centerDist < -args.wallSigma) return "hull";
  if (Math.abs(centerDist) <= args.wallSigma) return "wall";
  if (centerDist > args.wallSigma && centerDist <= exteriorShellLimit) {
    return "exterior_shell";
  }
  return null;
};

export const forEachStressEnergyBrickRegionVoxel = (
  input: Pick<
    StressEnergyBrickParams,
    "dims" | "bounds" | "hullAxes" | "hullWall" | "radialMap"
  >,
  visit: (sample: StressEnergyBrickRegionVoxelSample) => void,
): void => {
  const defaults = defaultHullBounds();
  const dims = input.dims ?? [128, 128, 128];
  const bounds = input.bounds ?? { min: defaults.min, max: defaults.max };
  const axes = input.hullAxes ?? defaults.axes;
  const radialMap = input.radialMap ?? null;
  const wallSigma = Math.max(input.hullWall ?? defaults.wall, 0.1);
  const [nx, ny, nz] = dims;
  const dx = (bounds.max[0] - bounds.min[0]) / nx;
  const dy = (bounds.max[1] - bounds.min[1]) / ny;
  const dz = (bounds.max[2] - bounds.min[2]) / nz;
  const cellVolume = dx * dy * dz;

  for (let z = 0; z < nz; z += 1) {
    const pz = bounds.min[2] + (z + 0.5) * dz;
    for (let y = 0; y < ny; y += 1) {
      const py = bounds.min[1] + (y + 0.5) * dy;
      for (let x = 0; x < nx; x += 1) {
        const px = bounds.min[0] + (x + 0.5) * dx;
        const position: Vec3 = [px, py, pz];
        visit({
          position,
          classifiedRegionId: classifyStressEnergyBrickRegion({
            position,
            axes,
            radialMap,
            wallSigma,
          }),
          cellVolume,
          voxelIndex: [x, y, z],
        });
      }
    }
  }
};

const gradientX = (field: Float32Array, x: number, y: number, z: number, nx: number, ny: number, dx: number) => {
  if (nx <= 1 || dx === 0) return 0;
  const left = x > 0 ? x - 1 : x;
  const right = x < nx - 1 ? x + 1 : x;
  const denom = (right - left) * dx;
  if (denom === 0) return 0;
  const leftVal = field[axisIndex(left, y, z, nx, ny)];
  const rightVal = field[axisIndex(right, y, z, nx, ny)];
  return (rightVal - leftVal) / denom;
};

const gradientY = (field: Float32Array, x: number, y: number, z: number, nx: number, ny: number, dy: number) => {
  if (ny <= 1 || dy === 0) return 0;
  const down = y > 0 ? y - 1 : y;
  const up = y < ny - 1 ? y + 1 : y;
  const denom = (up - down) * dy;
  if (denom === 0) return 0;
  const downVal = field[axisIndex(x, down, z, nx, ny)];
  const upVal = field[axisIndex(x, up, z, nx, ny)];
  return (upVal - downVal) / denom;
};

const gradientZ = (field: Float32Array, x: number, y: number, z: number, nx: number, ny: number, nz: number, dz: number) => {
  if (nz <= 1 || dz === 0) return 0;
  const back = z > 0 ? z - 1 : z;
  const front = z < nz - 1 ? z + 1 : z;
  const denom = (front - back) * dz;
  if (denom === 0) return 0;
  const backVal = field[axisIndex(x, y, back, nx, ny)];
  const frontVal = field[axisIndex(x, y, front, nx, ny)];
  return (frontVal - backVal) / denom;
};

const smoothVectorField = (
  fieldX: Float32Array,
  fieldY: Float32Array,
  fieldZ: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  passes = 1,
) => {
  if (passes <= 0) return;
  const total = nx * ny * nz;
  const tmpX = new Float32Array(total);
  const tmpY = new Float32Array(total);
  const tmpZ = new Float32Array(total);
  for (let pass = 0; pass < passes; pass += 1) {
    let idx = 0;
    for (let z = 0; z < nz; z++) {
      const zStart = Math.max(0, z - 1);
      const zEnd = Math.min(nz - 1, z + 1);
      for (let y = 0; y < ny; y++) {
        const yStart = Math.max(0, y - 1);
        const yEnd = Math.min(ny - 1, y + 1);
        for (let x = 0; x < nx; x++) {
          const xStart = Math.max(0, x - 1);
          const xEnd = Math.min(nx - 1, x + 1);
          let sumX = 0;
          let sumY = 0;
          let sumZ = 0;
          let count = 0;
          for (let zz = zStart; zz <= zEnd; zz += 1) {
            for (let yy = yStart; yy <= yEnd; yy += 1) {
              let base = zz * nx * ny + yy * nx + xStart;
              for (let xx = xStart; xx <= xEnd; xx += 1) {
                sumX += fieldX[base];
                sumY += fieldY[base];
                sumZ += fieldZ[base];
                count += 1;
                base += 1;
              }
            }
          }
          const inv = count > 0 ? 1 / count : 1;
          tmpX[idx] = sumX * inv;
          tmpY[idx] = sumY * inv;
          tmpZ[idx] = sumZ * inv;
          idx += 1;
        }
      }
    }
    fieldX.set(tmpX);
    fieldY.set(tmpY);
    fieldZ.set(tmpZ);
  }
};

const computeBetaDivergenceStats = (
  betaX: Float32Array,
  betaY: Float32Array,
  betaZ: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dy: number,
  dz: number,
) => {
  let divBetaMaxAbs = 0;
  let divBetaRmsSum = 0;
  let idx = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const divBeta =
          gradientX(betaX, x, y, z, nx, ny, dx) +
          gradientY(betaY, x, y, z, nx, ny, dy) +
          gradientZ(betaZ, x, y, z, nx, ny, nz, dz);
        const absVal = Math.abs(divBeta);
        if (absVal > divBetaMaxAbs) divBetaMaxAbs = absVal;
        divBetaRmsSum += divBeta * divBeta;
        idx += 1;
      }
    }
  }
  return {
    divBetaMaxAbs,
    divBetaRms: Math.sqrt(divBetaRmsSum / Math.max(nx * ny * nz, 1)),
  };
};

type BetaDivergenceStats = ReturnType<typeof computeBetaDivergenceStats>;

const clampNatarioShift = (
  betaX: Float32Array,
  betaY: Float32Array,
  betaZ: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dy: number,
  dz: number,
  preStats?: BetaDivergenceStats,
  limit: number = NATARIO_K_TOL,
) => {
  const stats =
    preStats ?? computeBetaDivergenceStats(betaX, betaY, betaZ, nx, ny, nz, dx, dy, dz);
  if (stats.divBetaMaxAbs > limit && stats.divBetaMaxAbs > 0) {
    const scale = limit / stats.divBetaMaxAbs;
    for (let i = 0; i < betaX.length; i += 1) {
      betaX[i] *= scale;
      betaY[i] *= scale;
      betaZ[i] *= scale;
    }
    return {
      divBetaMaxAbs: limit,
      divBetaRms: stats.divBetaRms * scale,
      scaled: true,
      scale,
    };
  }
  return { ...stats, scaled: false, scale: 1 };
};

type ObserverConditionKey = "nec" | "wec" | "sec" | "dec";

type ConditionAccumulator = {
  eulerianSum: number;
  robustSum: number;
  eulerianMin: number;
  robustMin: number;
  eulerianViolationCount: number;
  robustViolationCount: number;
  missedViolationCount: number;
  severityGainSum: number;
  severityGainMin: number;
  maxRobustMinusEulerian: number;
  worstIndex: number;
  worstValue: number;
  worstDirection: Vec3;
  worstRapidity: number | null;
  worstSource: ObserverMarginSource;
};

const createConditionAccumulator = (): ConditionAccumulator => ({
  eulerianSum: 0,
  robustSum: 0,
  eulerianMin: Number.POSITIVE_INFINITY,
  robustMin: Number.POSITIVE_INFINITY,
  eulerianViolationCount: 0,
  robustViolationCount: 0,
  missedViolationCount: 0,
  severityGainSum: 0,
  severityGainMin: Number.POSITIVE_INFINITY,
  maxRobustMinusEulerian: Number.NEGATIVE_INFINITY,
  worstIndex: -1,
  worstValue: Number.POSITIVE_INFINITY,
  worstDirection: [1, 0, 0],
  worstRapidity: null,
  worstSource: "capped_search",
});

const safeDirection = (value: Vec3 | null | undefined, fallback: Vec3 = [1, 0, 0]): Vec3 => {
  if (!value) return normalize(fallback);
  const n = normalize(value);
  if (Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2])) {
    const mag = Math.hypot(n[0], n[1], n[2]);
    if (mag > 0) return n;
  }
  return normalize(fallback);
};

const cross = (a: Vec3, b: Vec3): Vec3 => ([
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]);

const orthogonalDirection = (direction: Vec3): Vec3 => {
  const base = Math.abs(direction[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
  const c = cross(direction, base);
  return safeDirection(c, [0, 0, 1]);
};

const clampBeta = (value: number, cap: number): number => {
  const finiteCap = Number.isFinite(cap) ? Math.max(0, Math.min(0.999999999, cap)) : 0;
  const finiteValue = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(finiteCap, finiteValue));
};

const rapidityFromBeta = (beta: number): number => {
  const b = Math.max(-0.999999999, Math.min(0.999999999, beta));
  return 0.5 * Math.log((1 + b) / (1 - b));
};

const updateConditionAccumulator = (
  acc: ConditionAccumulator,
  eulerian: number,
  robust: number,
  index: number,
  direction: Vec3,
  rapidity: number | null,
  source: ObserverMarginSource,
) => {
  if (!Number.isFinite(eulerian) || !Number.isFinite(robust)) return;
  acc.eulerianSum += eulerian;
  acc.robustSum += robust;
  if (eulerian < acc.eulerianMin) acc.eulerianMin = eulerian;
  if (robust < acc.robustMin) acc.robustMin = robust;
  if (eulerian < 0) acc.eulerianViolationCount += 1;
  if (robust < 0) acc.robustViolationCount += 1;
  if (robust < 0 && eulerian >= 0) acc.missedViolationCount += 1;
  const severityGain = robust - eulerian;
  acc.severityGainSum += severityGain;
  if (severityGain < acc.severityGainMin) acc.severityGainMin = severityGain;
  if (severityGain > acc.maxRobustMinusEulerian) {
    acc.maxRobustMinusEulerian = severityGain;
  }
  if (robust < acc.worstValue) {
    acc.worstValue = robust;
    acc.worstIndex = index;
    acc.worstDirection = direction;
    acc.worstRapidity = rapidity;
    acc.worstSource = source;
  }
};

const finalizeConditionAccumulator = (
  acc: ConditionAccumulator,
  total: number,
): ObserverConditionSummary => {
  const denom = Math.max(1, total);
  const eulerianMin = Number.isFinite(acc.eulerianMin) ? acc.eulerianMin : 0;
  const robustMin = Number.isFinite(acc.robustMin) ? acc.robustMin : 0;
  const severityGainMin = Number.isFinite(acc.severityGainMin) ? acc.severityGainMin : 0;
  const maxRobustMinusEulerian = Number.isFinite(acc.maxRobustMinusEulerian)
    ? acc.maxRobustMinusEulerian
    : 0;
  const worstValue = Number.isFinite(acc.worstValue) ? acc.worstValue : robustMin;
  const worstDirection = safeDirection(acc.worstDirection, [1, 0, 0]);
  return {
    eulerianMin,
    eulerianMean: acc.eulerianSum / denom,
    robustMin,
    robustMean: acc.robustSum / denom,
    eulerianViolationFraction: acc.eulerianViolationCount / denom,
    robustViolationFraction: acc.robustViolationCount / denom,
    missedViolationFraction: acc.missedViolationCount / denom,
    severityGainMin,
    severityGainMean: acc.severityGainSum / denom,
    maxRobustMinusEulerian,
    worstCase: {
      index: acc.worstIndex,
      value: worstValue,
      direction: worstDirection,
      rapidity: acc.worstRapidity,
      source: acc.worstSource,
    },
  };
};

const evaluateWecMargin = (rho: number, pressure: number, fluxMag: number, beta: number): number => {
  const b = Math.max(0, Math.min(0.999999999, beta));
  const oneMinus = Math.max(1e-12, 1 - b * b);
  return (rho - 2 * fluxMag * b + pressure * b * b) / oneMinus;
};

const optimizeWecMargin = (
  rho: number,
  pressure: number,
  fluxMag: number,
  betaCap: number,
): { margin: number; beta: number } => {
  const cap = clampBeta(betaCap, betaCap);
  let bestBeta = 0;
  let bestMargin = evaluateWecMargin(rho, pressure, fluxMag, 0);
  const consider = (candidate: number) => {
    if (!Number.isFinite(candidate)) return;
    const b = clampBeta(candidate, cap);
    const margin = evaluateWecMargin(rho, pressure, fluxMag, b);
    if (margin < bestMargin) {
      bestMargin = margin;
      bestBeta = b;
    }
  };

  consider(cap);
  if (fluxMag > EPS) {
    const discriminant = (rho + pressure) * (rho + pressure) - 4 * fluxMag * fluxMag;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const denom = 2 * fluxMag;
      consider((rho + pressure - root) / denom);
      consider((rho + pressure + root) / denom);
    }
  }

  return { margin: bestMargin, beta: bestBeta };
};

const evaluateDecMargin = (
  rho: number,
  pressure: number,
  sx: number,
  sy: number,
  sz: number,
  direction: Vec3,
  beta: number,
): number => {
  const dir = safeDirection(direction, [1, 0, 0]);
  const b = Math.max(0, Math.min(0.999999999, beta));
  const oneMinus = Math.max(1e-12, 1 - b * b);
  const gamma = 1 / Math.sqrt(oneMinus);
  const gamma2 = 1 / oneMinus;
  const dotSn = sx * dir[0] + sy * dir[1] + sz * dir[2];

  const energy = gamma2 * (rho + 2 * b * dotSn + pressure * b * b);
  const j0 = gamma * (rho + b * dotSn);
  const jx = -gamma * (sx + pressure * b * dir[0]);
  const jy = -gamma * (sy + pressure * b * dir[1]);
  const jz = -gamma * (sz + pressure * b * dir[2]);

  const u0 = gamma;
  const ux = gamma * b * dir[0];
  const uy = gamma * b * dir[1];
  const uz = gamma * b * dir[2];

  const q0 = j0 - energy * u0;
  const qx = jx - energy * ux;
  const qy = jy - energy * uy;
  const qz = jz - energy * uz;
  let qNormSq = -q0 * q0 + qx * qx + qy * qy + qz * qz;
  if (qNormSq < 0 && qNormSq > -1e-9) qNormSq = 0;
  if (qNormSq < 0) qNormSq = 0;
  const margin = energy - Math.sqrt(qNormSq);
  return Number.isFinite(margin) ? margin : Number.NEGATIVE_INFINITY;
};

const optimizeDecMargin = (args: {
  rho: number;
  pressure: number;
  sx: number;
  sy: number;
  sz: number;
  fluxDir: Vec3;
  canonicalDir: Vec3;
  betaCap: number;
  betaHint: number;
}): { margin: number; beta: number; direction: Vec3 } => {
  const cap = clampBeta(args.betaCap, args.betaCap);
  const fluxDir = safeDirection(args.fluxDir, args.canonicalDir);
  const canonicalDir = safeDirection(args.canonicalDir, [1, 0, 0]);
  const antiFluxDir: Vec3 = [-fluxDir[0], -fluxDir[1], -fluxDir[2]];
  const parallelFluxDir: Vec3 = [fluxDir[0], fluxDir[1], fluxDir[2]];
  const orthoDir = orthogonalDirection(fluxDir);
  const directionCandidatesRaw: Vec3[] = [antiFluxDir, canonicalDir, parallelFluxDir, orthoDir];
  const directionCandidates: Vec3[] = [];
  for (const candidate of directionCandidatesRaw) {
    const dir = safeDirection(candidate, canonicalDir);
    const alreadyPresent = directionCandidates.some((existing) =>
      Math.abs(existing[0] - dir[0]) < 1e-6 &&
      Math.abs(existing[1] - dir[1]) < 1e-6 &&
      Math.abs(existing[2] - dir[2]) < 1e-6,
    );
    if (!alreadyPresent) directionCandidates.push(dir);
  }

  const betaCandidatesRaw = [0, cap * 0.5, cap, args.betaHint];
  const betaCandidates: number[] = [];
  for (const candidate of betaCandidatesRaw) {
    const b = clampBeta(candidate, cap);
    if (!betaCandidates.some((existing) => Math.abs(existing - b) < 1e-9)) {
      betaCandidates.push(b);
    }
  }

  let bestMargin = Number.POSITIVE_INFINITY;
  let bestBeta = 0;
  let bestDirection = antiFluxDir;
  for (const direction of directionCandidates) {
    for (const beta of betaCandidates) {
      const margin = evaluateDecMargin(
        args.rho,
        args.pressure,
        args.sx,
        args.sy,
        args.sz,
        direction,
        beta,
      );
      if (margin < bestMargin) {
        bestMargin = margin;
        bestBeta = beta;
        bestDirection = direction;
      }
    }
  }

  if (!Number.isFinite(bestMargin)) {
    const fallback = evaluateDecMargin(
      args.rho,
      args.pressure,
      args.sx,
      args.sy,
      args.sz,
      antiFluxDir,
      0,
    );
    return {
      margin: Number.isFinite(fallback) ? fallback : args.rho - Math.hypot(args.sx, args.sy, args.sz),
      beta: 0,
      direction: antiFluxDir,
    };
  }

  return { margin: bestMargin, beta: bestBeta, direction: bestDirection };
};

const resolveTypeISlacks = (
  rho: number,
  pressure: number,
  fluxMag: number,
  tolerance: number,
): {
  isTypeI: boolean;
  nec?: number;
  wec?: number;
  sec?: number;
  dec?: number;
} => {
  const discriminant = (rho + pressure) * (rho + pressure) - 4 * fluxMag * fluxMag;
  if (discriminant < -Math.max(0, tolerance)) {
    return { isTypeI: false };
  }
  const sqrtDisc = Math.sqrt(Math.max(0, discriminant));
  const sign = rho + pressure >= 0 ? 1 : -1;
  const lambdaTime = 0.5 * (pressure - rho - sign * sqrtDisc);
  const lambdaLongitudinal = 0.5 * (pressure - rho + sign * sqrtDisc);
  const epsilon = -lambdaTime;
  const pParallel = lambdaLongitudinal;
  const pPerp = pressure;
  const nec = Math.min(epsilon + pParallel, epsilon + pPerp);
  const wec = Math.min(epsilon, nec);
  const sec = Math.min(epsilon + pParallel, epsilon + pPerp, epsilon + pParallel + 2 * pPerp);
  const dec = Math.min(epsilon, epsilon - Math.abs(pParallel), epsilon - Math.abs(pPerp));
  if (!Number.isFinite(nec) || !Number.isFinite(wec) || !Number.isFinite(sec) || !Number.isFinite(dec)) {
    return { isTypeI: false };
  }
  return { isTypeI: true, nec, wec, sec, dec };
};

const computeObserverRobustDiagnostics = (args: {
  t00: Float32Array;
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  pressureFactor: number;
  rapidityCap: number;
  typeITolerance: number;
  canonicalNullDir: Vec3;
}): ObserverRobustDiagnostics => {
  const total = Math.min(args.t00.length, args.sx.length, args.sy.length, args.sz.length);
  const pressureFactor = Number.isFinite(args.pressureFactor) ? args.pressureFactor : -1;
  const rapidityCap = Number.isFinite(args.rapidityCap)
    ? Math.max(0, args.rapidityCap)
    : DEFAULT_OBSERVER_RAPIDITY_CAP;
  const betaCap = Math.tanh(rapidityCap);
  const typeITolerance = Number.isFinite(args.typeITolerance)
    ? Math.max(0, args.typeITolerance)
    : DEFAULT_HAWKING_ELLIS_TYPE_I_TOL;
  const canonicalNullDir = safeDirection(args.canonicalNullDir, [1, 0, 0]);

  const acc: Record<ObserverConditionKey, ConditionAccumulator> = {
    nec: createConditionAccumulator(),
    wec: createConditionAccumulator(),
    sec: createConditionAccumulator(),
    dec: createConditionAccumulator(),
  };
  let typeICount = 0;

  for (let i = 0; i < total; i += 1) {
    const rho = Number.isFinite(args.t00[i]) ? args.t00[i] : 0;
    const sx = Number.isFinite(args.sx[i]) ? args.sx[i] : 0;
    const sy = Number.isFinite(args.sy[i]) ? args.sy[i] : 0;
    const sz = Number.isFinite(args.sz[i]) ? args.sz[i] : 0;
    const fluxMag = Math.hypot(sx, sy, sz);
    const fluxDir = fluxMag > EPS
      ? ([sx / fluxMag, sy / fluxMag, sz / fluxMag] as Vec3)
      : canonicalNullDir;
    const antiFluxDir: Vec3 = [-fluxDir[0], -fluxDir[1], -fluxDir[2]];
    const pressure = rho * pressureFactor;
    const trace = -rho + 3 * pressure;
    const canonicalFluxProjection =
      sx * canonicalNullDir[0] + sy * canonicalNullDir[1] + sz * canonicalNullDir[2];

    const necEulerian = rho + pressure + 2 * canonicalFluxProjection;
    const wecEulerian = rho;
    const secEulerian = wecEulerian + 0.5 * trace;
    const decEulerian = rho - fluxMag;

    const typeI = resolveTypeISlacks(rho, pressure, fluxMag, typeITolerance);
    if (typeI.isTypeI && typeI.nec != null && typeI.wec != null && typeI.sec != null && typeI.dec != null) {
      typeICount += 1;
      updateConditionAccumulator(acc.nec, necEulerian, typeI.nec, i, antiFluxDir, null, "algebraic_type_i");
      updateConditionAccumulator(acc.wec, wecEulerian, typeI.wec, i, antiFluxDir, null, "algebraic_type_i");
      updateConditionAccumulator(acc.sec, secEulerian, typeI.sec, i, antiFluxDir, null, "algebraic_type_i");
      updateConditionAccumulator(acc.dec, decEulerian, typeI.dec, i, antiFluxDir, null, "algebraic_type_i");
      continue;
    }

    const necRobust = rho + pressure - 2 * fluxMag;
    const wecOptimized = optimizeWecMargin(rho, pressure, fluxMag, betaCap);
    const wecRobust = wecOptimized.margin;
    const secRobust = wecRobust + 0.5 * trace;
    const decOptimized = optimizeDecMargin({
      rho,
      pressure,
      sx,
      sy,
      sz,
      fluxDir,
      canonicalDir: canonicalNullDir,
      betaCap,
      betaHint: wecOptimized.beta,
    });

    updateConditionAccumulator(acc.nec, necEulerian, necRobust, i, antiFluxDir, null, "capped_search");
    updateConditionAccumulator(
      acc.wec,
      wecEulerian,
      wecRobust,
      i,
      antiFluxDir,
      rapidityFromBeta(wecOptimized.beta),
      "capped_search",
    );
    updateConditionAccumulator(
      acc.sec,
      secEulerian,
      secRobust,
      i,
      antiFluxDir,
      rapidityFromBeta(wecOptimized.beta),
      "capped_search",
    );
    updateConditionAccumulator(
      acc.dec,
      decEulerian,
      decOptimized.margin,
      i,
      decOptimized.direction,
      rapidityFromBeta(decOptimized.beta),
      "capped_search",
    );
  }

  const nec = finalizeConditionAccumulator(acc.nec, total);
  const wec = finalizeConditionAccumulator(acc.wec, total);
  const sec = finalizeConditionAccumulator(acc.sec, total);
  const dec = finalizeConditionAccumulator(acc.dec, total);
  const maxRobustMinusEulerian = Math.max(
    nec.maxRobustMinusEulerian,
    wec.maxRobustMinusEulerian,
    sec.maxRobustMinusEulerian,
    dec.maxRobustMinusEulerian,
  );

  return {
    pressureModel: "isotropic_pressure",
    pressureFactor,
    rapidityCap,
    rapidityCapBeta: betaCap,
    typeI: {
      count: typeICount,
      fraction: typeICount / Math.max(1, total),
      tolerance: typeITolerance,
    },
    nec,
    wec,
    sec,
    dec,
    consistency: {
      robustNotGreaterThanEulerian: maxRobustMinusEulerian <= 1e-8,
      maxRobustMinusEulerian,
    },
  };
};

export function buildStressEnergyBrick(input: Partial<StressEnergyBrickParams>): StressEnergyBrick {
  const defaults = defaultHullBounds();
  const dims: [number, number, number] = input.dims ?? [128, 128, 128];
  const axes: Vec3 = input.hullAxes ?? defaults.axes;
  const bounds = input.bounds ?? { min: [-axes[0], -axes[1], -axes[2]], max: [axes[0], axes[1], axes[2]] };

  const phase01 = wrap01(input.phase01 ?? 0);
  const sigmaSector = Math.max(input.sigmaSector ?? 0.05, 1e-3);
  const splitEnabled = input.splitEnabled ?? false;
  const splitFrac = clamp01(input.splitFrac ?? 0.6);
  const dutyFR = Math.max(input.dutyFR ?? PROMOTED_WARP_PROFILE.dutyShip, 1e-8);
  const q = Math.max(input.q ?? 1, 1e-4);
  const gammaGeo = Math.max(input.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo, 1);
  const gammaVdB = Math.max(input.gammaVdB ?? PROMOTED_WARP_PROFILE.gammaVanDenBroeck, 1);
  const ampBase = Math.max(input.ampBase ?? 0, 0);
  const zeta = clamp01(input.zeta ?? 0.84);
  const observerRapidityCap = Number.isFinite(input.observerRapidityCap)
    ? Math.max(0, input.observerRapidityCap as number)
    : DEFAULT_OBSERVER_RAPIDITY_CAP;
  const observerTypeITolerance = Number.isFinite(input.observerTypeITolerance)
    ? Math.max(0, input.observerTypeITolerance as number)
    : DEFAULT_HAWKING_ELLIS_TYPE_I_TOL;
  const driveDirInput = input.driveDir && Array.isArray(input.driveDir) ? (input.driveDir as Vec3) : null;
  const driveDirUnit = driveDirInput ? normalize(driveDirInput) : null;

  const state = getGlobalPipelineState();
  const gap_m = Math.max(1e-12, (state?.gap_nm ?? 1) * 1e-9);
  const cavityQ = Math.max(1e5, state?.qCavity ?? state?.QL ?? PROMOTED_WARP_PROFILE.qCavity);
  const dutyEff = dutyFR;
  const qSpoil = Math.max(1e-6, state?.qSpoilingFactor ?? q);
  const metricT00Raw =
    Number.isFinite(input.metricT00) ? Number(input.metricT00) : Number(state?.warp?.metricT00);
  const metricT00Ref =
    typeof input.metricT00Ref === "string"
      ? input.metricT00Ref
      : typeof (state as any)?.warp?.metricT00Ref === "string"
        ? String((state as any).warp.metricT00Ref)
        : undefined;
  const metricSource =
    input.metricT00Source ??
    (state as any)?.warp?.metricT00Source ??
    (state as any)?.warp?.stressEnergySource;
  const metricMode =
    metricSource === "metric" && Number.isFinite(metricT00Raw);
  const metricT00Source = metricMode ? (typeof metricSource === "string" ? metricSource : "metric") : undefined;
  const sourceRedesignMode = normalizeNhm2SourceRedesignMode(
    input.sourceRedesignMode ?? (state as any)?.dynamicConfig?.sourceRedesignMode ?? null,
  );
  const sourceReformulationMode = normalizeNhm2SourceReformulationMode(
    input.sourceReformulationMode ?? (state as any)?.dynamicConfig?.sourceReformulationMode ?? null,
  );
  const baseFamilyContext = resolveStressEnergyFamilyContext({
    metricT00Ref,
    inputWarpFieldType: input.warpFieldType ?? null,
    stateWarpFieldType: (state as any)?.warpFieldType ?? null,
  });
  const redesignFamilyContext = applyNhm2SourceRedesignContext(
    baseFamilyContext,
    sourceRedesignMode,
  );
  const familyContext = applyNhm2SourceReformulationContext(
    redesignFamilyContext,
    sourceReformulationMode,
  );
  const shiftLapseTileSourceAttenuation = resolveShiftLapseTileSourceAttenuation({
    state,
    familyContext,
  });

  const { rho_avg: rhoAvgPipeline, rho_inst: rhoInstPipeline } = enhancedAvgEnergyDensity({
    gap_m,
    gammaGeo,
    cavityQ,
    gammaVdB,
    gammaVanDenBroeck: gammaVdB,
    qSpoilingFactor: qSpoil,
    deltaAOverA: qSpoil,
    dutyEff,
  });
  const rhoAvgSource = metricMode ? (metricT00Raw as number) : rhoAvgPipeline;
  const rhoInstSource = metricMode ? (metricT00Raw as number) : rhoInstPipeline;
  const rho_avg = rhoAvgSource * shiftLapseTileSourceAttenuation;
  const rho_inst = rhoInstSource * shiftLapseTileSourceAttenuation;

  const [nx, ny, nz] = dims;
  const dx = (bounds.max[0] - bounds.min[0]) / nx;
  const dy = (bounds.max[1] - bounds.min[1]) / ny;
  const dz = (bounds.max[2] - bounds.min[2]) / nz;
  const cellVolume = dx * dy * dz;
  const mappingSource = metricMode ? "metric" : state ? "pipeline" : "defaults";
  const stressMeta = state?.stressMeta;
  const brickSource: StressEnergyBrick["source"] = (stressMeta?.source as StressEnergyBrick["source"])
    ?? (metricMode ? "metric" : state ? "pipeline" : "unknown");
  const brickCongruence: StressEnergyBrick["congruence"] =
    (stressMeta?.congruence as StressEnergyBrick["congruence"])
    ?? (metricMode ? "conditional" : "proxy-only");
  const brickProxy =
    typeof stressMeta?.proxy === "boolean"
      ? stressMeta.proxy
      : brickCongruence !== "geometry-derived";

  const axesSq: Vec3 = [axes[0] * axes[0], axes[1] * axes[1], axes[2] * axes[2]];
  const wallSigma = Math.max(input.hullWall ?? defaults.wall, 0.1);
  const tileSupportSigma = resolveShiftLapseTileSupportSigma({
    familyContext,
    wallSigma,
  });
  const tileSupportFalloffExponent = resolveShiftLapseTileSupportFalloffExponent({
    familyContext,
  });
  const tileSectorSigma = resolveShiftLapseTileSectorSigma({
    familyContext,
    sectorSigma: sigmaSector,
  });
  const totalVoxels = nx * ny * nz;
  const envelope = new Float32Array(totalVoxels);
  let envelopeSum = 0;
  let envelopeAbsSum = 0;
  let envelopeHasSignedSupport = false;
  const radialMap = input.radialMap ?? null;

  const nowSeconds = Date.now() / 1000;
  const strobeHz = Number.isFinite(state?.strobeHz) ? Number(state!.strobeHz) : 1000;
  const strobePhase = wrap01((nowSeconds * strobeHz) % 1);
  const driveGain = q * (0.85 + 0.15 * zeta) * (1 + 0.25 * ampBase);
  const familyDirectionBlend =
    familyContext.familyId === "alcubierre_control"
      ? 0.78
      : familyContext.familyId === "nhm2_redesign_signed_shell_bias"
        ? 0.72
        : familyContext.familyId === "nhm2_redesign_coupling_localization"
          ? 0.18
          : familyContext.familyId === "nhm2_redesign_drive_vs_geometry_split"
            ? 0.88
            : familyContext.familyId === "nhm2_redesign_source_profile_simplified_signed"
              ? 0.64
      : familyContext.familyId === "nhm2_reform_volume_driven_signed_source"
        ? 0.9
        : familyContext.familyId === "nhm2_reform_fore_aft_antisymmetric_driver"
          ? 1.0
          : familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
            ? 0.14
            : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
              ? 0.82
      : familyContext.familyId === "nhm2_certified"
        ? 0.46
        : familyContext.familyId === "irrotational_control"
          ? 0.12
          : 0.32;
  const familyShiftScale =
    familyContext.familyId === "alcubierre_control"
      ? 1.14
      : familyContext.familyId === "nhm2_redesign_signed_shell_bias"
        ? 1.18
        : familyContext.familyId === "nhm2_redesign_coupling_localization"
          ? 1.04
          : familyContext.familyId === "nhm2_redesign_drive_vs_geometry_split"
            ? 1.08
            : familyContext.familyId === "nhm2_redesign_source_profile_simplified_signed"
              ? 1.12
      : familyContext.familyId === "nhm2_reform_volume_driven_signed_source"
        ? 1.28
        : familyContext.familyId === "nhm2_reform_fore_aft_antisymmetric_driver"
          ? 1.34
          : familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
            ? 1.22
            : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
              ? 1.26
      : familyContext.familyId === "nhm2_certified"
        ? 0.94
        : familyContext.familyId === "vdb_control"
          ? 1.08
          : 1.0;

  let idx = 0;
  for (let z = 0; z < nz; z++) {
    const pz = bounds.min[2] + (z + 0.5) * dz;
    for (let y = 0; y < ny; y++) {
      const py = bounds.min[1] + (y + 0.5) * dy;
      for (let x = 0; x < nx; x++) {
        const px = bounds.min[0] + (x + 0.5) * dx;
        const pLen = Math.hypot(px, py, pz);
        const dir = pLen > 1e-9 ? ([px / pLen, py / pLen, pz / pLen] as Vec3) : ([0, 0, 0] as Vec3);
        const radius = resolveHullRadius(dir, axes, radialMap);
        const centerDist = pLen - radius;
        const structuralBase = computeNhm2StructuralScalars({
          px,
          py,
          pz,
          centerDist,
          wallSigma: tileSupportSigma,
          axes,
        });
        const tileAftSupportSigma =
          tileSupportSigma *
          resolveShiftLapseTileAftSupportSigmaMultiplier({
            familyContext,
            signedLongitudinal: structuralBase.signedLongitudinal,
            shellSharpen: structuralBase.shellSharpen,
            volumeEnvelope: structuralBase.volumeEnvelope,
          });
        const tileAftFalloffExponent =
          tileSupportFalloffExponent *
          resolveShiftLapseTileAftFalloffExponentMultiplier({
            familyContext,
            signedLongitudinal: structuralBase.signedLongitudinal,
            shellSharpen: structuralBase.shellSharpen,
            volumeEnvelope: structuralBase.volumeEnvelope,
            dualLayerEnvelope: structuralBase.dualLayerEnvelope,
          });
        const wallEnvelopeBase = Math.exp(-0.5 * Math.pow(centerDist / tileAftSupportSigma, 2));
        const wallEnvelope = Math.pow(wallEnvelopeBase, tileAftFalloffExponent);
        const theta = azimuth01(px, pz);
        const sectorEnvelope = computeSectorEnvelope(theta, phase01, {
          sigma: tileSectorSigma,
          splitEnabled,
          splitFrac,
        });
        const phaseDelta = shortestPhaseDelta(theta, phase01);
        const strobeEnvelope = 0.5 + 0.5 * Math.cos(TWO_PI * wrap01(strobePhase - phaseDelta));
        const structural = computeNhm2StructuralScalars({
          px,
          py,
          pz,
          centerDist,
          wallSigma: tileAftSupportSigma,
          axes,
        });
        const familyEnvelope =
          familyContext.familyId === "alcubierre_control"
            ? 0.68 + 0.64 * structural.axialBias
            : familyContext.familyId === "nhm2_redesign_signed_shell_bias"
              ? 0.48 + 0.34 * structural.shellSharpen + 0.42 * structural.axialBias
              : familyContext.familyId === "nhm2_redesign_coupling_localization"
                ? 0.24 + 1.08 * structural.shellSharpen * structural.shellSharpen
                : familyContext.familyId === "nhm2_redesign_drive_vs_geometry_split"
                  ? 0.38 + 0.32 * structural.shellSharpen + 0.42 * Math.abs(structural.signedLongitudinal)
                  : familyContext.familyId === "nhm2_redesign_source_profile_simplified_signed"
                    ? 0.36 + 0.56 * structural.shellSharpen + 0.18 * structural.axialBias
                    : familyContext.familyId === "nhm2_reform_volume_driven_signed_source"
                      ? 0.16 * wallEnvelope +
                        structural.volumeEnvelope *
                          structural.signedLongitudinal *
                          (0.42 + 0.58 * Math.abs(structural.signedLongitudinal))
                      : familyContext.familyId === "nhm2_reform_fore_aft_antisymmetric_driver"
                        ? wallEnvelope * (0.18 + 1.24 * structural.antisymmetricDriver)
                        : familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
                          ? 0.14 + 0.26 * wallEnvelope + 0.92 * structural.volumeEnvelope
                          : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
                            ? structural.dualLayerEnvelope *
                              (0.52 + 0.48 * Math.abs(structural.signedLongitudinal))
            : familyContext.familyId === "nhm2_certified"
              ? 0.82 + 0.18 * structural.shellSharpen
              : familyContext.familyId === "irrotational_control"
                ? 0.9 + 0.1 * Math.sin(TWO_PI * theta)
                : familyContext.familyId === "vdb_control"
                  ? 0.75 + 0.25 / (1 + Math.abs(centerDist) / Math.max(wallSigma, 1e-6))
                  : 0.95 + 0.05 * Math.cos(TWO_PI * phaseDelta);
        const tileLocalShellBias = resolveShiftLapseTileLocalShellBias({
          familyContext,
          signedLongitudinal: structural.signedLongitudinal,
          shellSharpen: structural.shellSharpen,
          volumeEnvelope: structural.volumeEnvelope,
        });
        const tileAftAggregationWeight = resolveShiftLapseTileAftAggregationWeight({
          familyContext,
          signedLongitudinal: structural.signedLongitudinal,
          shellSharpen: structural.shellSharpen,
          volumeEnvelope: structural.volumeEnvelope,
        });
        const value =
          wallEnvelope *
          sectorEnvelope *
          driveGain *
          (0.65 + 0.35 * strobeEnvelope) *
          familyEnvelope *
          tileLocalShellBias *
          tileAftAggregationWeight;
        envelope[idx] = value;
        envelopeSum += value;
        envelopeAbsSum += Math.abs(value);
        envelopeHasSignedSupport ||= value < 0;
        idx += 1;
      }
    }
  }

  const envelopeNormBase = envelopeHasSignedSupport ? envelopeAbsSum : envelopeSum;
  const envelopeScale = envelopeNormBase > EPS ? totalVoxels / envelopeNormBase : 1;
  const t00 = new Float32Array(totalVoxels);
  const betaX = new Float32Array(totalVoxels);
  const betaY = new Float32Array(totalVoxels);
  const betaZ = new Float32Array(totalVoxels);
  const betaMag = new Float32Array(totalVoxels);
  let t00Min = Number.POSITIVE_INFINITY;
  let t00Max = Number.NEGATIVE_INFINITY;
  let sumT00 = 0;
  const pressureFactor = -1;
  const exteriorShellLimit = wallSigma * 3;
  const tensorRegions = {
    global: createTensorRegionAccumulator(),
    hull: createTensorRegionAccumulator(),
    wall: createTensorRegionAccumulator(),
    exterior_shell: createTensorRegionAccumulator(),
  };

  idx = 0;
  for (let z = 0; z < nz; z++) {
    const pz = bounds.min[2] + (z + 0.5) * dz;
    for (let y = 0; y < ny; y++) {
      const py = bounds.min[1] + (y + 0.5) * dy;
      for (let x = 0; x < nx; x++) {
        const px = bounds.min[0] + (x + 0.5) * dx;
        const pos: Vec3 = [px, py, pz];
        const density = rho_avg * envelope[idx] * envelopeScale;
        t00[idx] = density;
        if (density < t00Min) t00Min = density;
        if (density > t00Max) t00Max = density;
        sumT00 += density;

        const pLen = Math.hypot(px, py, pz);
        const dir = pLen > 1e-9 ? ([px / pLen, py / pLen, pz / pLen] as Vec3) : ([0, 0, 0] as Vec3);
        const radius = resolveHullRadius(dir, axes, radialMap);
        const centerDist = pLen - radius;
        tensorRegions.global.count += 1;
        tensorRegions.global.includedCount += 1;
        tensorRegions.global.sumT00 += density;
        if (centerDist < -wallSigma) {
          tensorRegions.hull.count += 1;
          tensorRegions.hull.includedCount += 1;
          tensorRegions.hull.sumT00 += density;
        } else if (Math.abs(centerDist) <= wallSigma) {
          tensorRegions.wall.count += 1;
          tensorRegions.wall.includedCount += 1;
          tensorRegions.wall.sumT00 += density;
        } else if (centerDist > wallSigma && centerDist <= exteriorShellLimit) {
          tensorRegions.exterior_shell.count += 1;
          tensorRegions.exterior_shell.includedCount += 1;
          tensorRegions.exterior_shell.sumT00 += density;
        }
        const normal = radialMap ? dir : ellipsoidNormal(pos, axesSq);
        const betaDir = blendDirections(normal, driveDirUnit, familyDirectionBlend);
        const structural = computeNhm2StructuralScalars({
          px,
          py,
          pz,
          centerDist,
          wallSigma: tileSupportSigma,
          axes,
        });
        const familyAxialScale =
          familyContext.familyId === "alcubierre_control"
            ? 0.72 + 0.56 * structural.axialBias
            : familyContext.familyId === "nhm2_redesign_signed_shell_bias"
              ? 0.35 + 0.95 * Math.abs(structural.signedLongitudinal) + 0.35 * structural.axialBias
              : familyContext.familyId === "nhm2_redesign_coupling_localization"
                ? 0.82 + 0.28 * Math.exp(-0.5 * Math.pow((pLen - radius) / Math.max(wallSigma, 1e-6), 2))
                : familyContext.familyId === "nhm2_redesign_drive_vs_geometry_split"
                  ? 0.48 + 0.92 * structural.axialBias
                  : familyContext.familyId === "nhm2_redesign_source_profile_simplified_signed"
                    ? 0.22 + 1.22 * Math.abs(structural.signedLongitudinal)
                    : familyContext.familyId === "nhm2_reform_volume_driven_signed_source"
                      ? 0.24 + 1.32 * Math.abs(structural.signedLongitudinal)
                      : familyContext.familyId === "nhm2_reform_fore_aft_antisymmetric_driver"
                        ? 0.12 + 1.44 * Math.abs(structural.antisymmetricDriver)
                        : familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
                          ? 0.18 + 0.78 * structural.shellSharpen + 0.42 * Math.abs(structural.antisymmetricDriver)
                          : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
                            ? 0.2 + 1.18 * Math.abs(structural.dualLayerEnvelope)
            : familyContext.familyId === "nhm2_certified"
              ? 0.9 + 0.1 * Math.abs(structural.axialBias - 0.5) * 2
              : 1.0;
        const familySignedScale =
          familyContext.familyId === "nhm2_redesign_signed_shell_bias"
            ? 0.35 + 0.95 * Math.abs(structural.signedLongitudinal)
            : familyContext.familyId === "nhm2_redesign_drive_vs_geometry_split"
              ? 0.55 + 0.75 * Math.abs(structural.signedLongitudinal)
              : familyContext.familyId === "nhm2_redesign_source_profile_simplified_signed"
                ? 0.15 + 1.35 * Math.abs(structural.signedLongitudinal)
                : familyContext.familyId === "nhm2_reform_volume_driven_signed_source"
                  ? 0.26 + 1.48 * Math.abs(structural.signedLongitudinal)
                  : familyContext.familyId === "nhm2_reform_fore_aft_antisymmetric_driver"
                    ? 0.24 + 1.52 * Math.abs(structural.antisymmetricDriver)
                    : familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
                      ? 0.22 + 0.96 * structural.shellSharpen
                      : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
                        ? 0.24 + 1.34 * Math.abs(structural.dualLayerEnvelope)
                : 1.0;
        const familyDirectionalSign =
          familyContext.familyId === "nhm2_redesign_signed_shell_bias" ||
          familyContext.familyId === "nhm2_redesign_drive_vs_geometry_split" ||
          familyContext.familyId === "nhm2_redesign_source_profile_simplified_signed"
            ? (structural.signedLongitudinal >= 0 ? 1 : -1)
            : familyContext.familyId === "nhm2_reform_volume_driven_signed_source"
              ? (structural.signedLongitudinal >= 0 ? 1 : -1)
              : familyContext.familyId === "nhm2_reform_fore_aft_antisymmetric_driver"
                ? (structural.antisymmetricDriver >= 0 ? 1 : -1)
                : familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
                  ? (structural.signedLongitudinal >= 0 ? 1 : -1)
                  : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
                    ? (structural.dualLayerEnvelope >= 0 ? 1 : -1)
            : null;
        const betaSourceDensity =
          familyContext.familyId === "nhm2_reform_geometry_source_decoupling"
            ? Math.abs(rho_avg) *
              (0.18 + 0.82 * structural.shellSharpen) *
              (0.3 + 0.7 * Math.abs(structural.antisymmetricDriver))
            : familyContext.familyId === "nhm2_reform_shell_to_dual_layer_family"
              ? Math.abs(density) + Math.abs(rho_avg) * Math.abs(structural.dualLayerEnvelope)
              : Math.abs(density);
        const betaAmp =
          natarioShiftFromDensity(betaSourceDensity, Math.max(radius, 1e-3)) *
          familyShiftScale *
          familyAxialScale *
          familySignedScale;
        const sign = familyDirectionalSign ?? (density >= 0 ? 1 : -1);
        const vecX = betaDir[0] * betaAmp * sign;
        const vecY = betaDir[1] * betaAmp * sign;
        const vecZ = betaDir[2] * betaAmp * sign;
        const mag = Math.hypot(vecX, vecY, vecZ);
        betaMag[idx] = mag;
        if (mag > 0) {
          betaX[idx] = vecX / mag;
          betaY[idx] = vecY / mag;
          betaZ[idx] = vecZ / mag;
        } else {
          betaX[idx] = 0;
          betaY[idx] = 0;
          betaZ[idx] = 0;
        }
        idx += 1;
      }
    }
  }

  smoothVectorField(betaX, betaY, betaZ, nx, ny, nz, 2);
  for (let i = 0; i < totalVoxels; i += 1) {
    const dirMag = Math.hypot(betaX[i], betaY[i], betaZ[i]);
    const desired = betaMag[i];
    const scale = dirMag > 1e-12 ? desired / dirMag : 0;
    betaX[i] *= scale;
    betaY[i] *= scale;
    betaZ[i] *= scale;
  }

  const natarioPre = computeBetaDivergenceStats(
    betaX,
    betaY,
    betaZ,
    nx,
    ny,
    nz,
    dx,
    dy,
    dz,
  );
  const warpFieldType = familyContext.warpFieldType;
  const isNatarioField =
    warpFieldType === "natario" ||
    warpFieldType === "natario_sdf" ||
    warpFieldType === "nhm2_shift_lapse";
  const clampLimit = isNatarioField ? NATARIO_K_TOL : ALCUBIERRE_K_TOL;
  const clampMode = isNatarioField ? "natario" : "stability";
  const natarioClamp = clampNatarioShift(
    betaX,
    betaY,
    betaZ,
    nx,
    ny,
    nz,
    dx,
    dy,
    dz,
    natarioPre,
    clampLimit,
  );
  const clampActivationRate = natarioClamp.scaled ? 1 - natarioClamp.scale : 0;
  if (natarioClamp.scaled) {
    console.warn(
      isNatarioField
        ? "[Natario] Divergence exceeds gate; scaling shift field"
        : "[ShiftClamp] Divergence exceeds stability gate; scaling shift field",
      {
        divMax: natarioClamp.divBetaMaxAbs,
        gate: clampLimit,
        clampMode,
        clampActivationRate,
        dutyFR,
        phase01,
        family_id: familyContext.familyId,
        source_branch: familyContext.sourceBranch,
        shape_function_id: familyContext.shapeFunctionId,
        warpFieldType,
      },
    );
  }
  const natarioDiagnostics: NatarioDiagnostics = {
    divBetaMax: natarioClamp.divBetaMaxAbs,
    divBetaRms: natarioClamp.divBetaRms,
    divBetaMaxPre: natarioPre.divBetaMaxAbs,
    divBetaRmsPre: natarioPre.divBetaRms,
    divBetaMaxPost: natarioClamp.divBetaMaxAbs,
    divBetaRmsPost: natarioClamp.divBetaRms,
    clampScale: natarioClamp.scale,
    clampApplied: natarioClamp.scaled,
    clampActivationRate,
    clampMode,
    gateLimit: clampLimit,
    gNatario: Math.max(0, 1 - natarioClamp.divBetaMaxAbs / clampLimit),
  };

  const Sx = new Float32Array(totalVoxels);
  const Sy = new Float32Array(totalVoxels);
  const Sz = new Float32Array(totalVoxels);
  let SxMin = Number.POSITIVE_INFINITY;
  let SxMax = Number.NEGATIVE_INFINITY;
  let SyMin = Number.POSITIVE_INFINITY;
  let SyMax = Number.NEGATIVE_INFINITY;
  let SzMin = Number.POSITIVE_INFINITY;
  let SzMax = Number.NEGATIVE_INFINITY;
  let fluxMagSum = 0;
  let netFluxSum: Vec3 = [0, 0, 0];

  idx = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const bX = betaX[idx];
        const bY = betaY[idx];
        const bZ = betaZ[idx];
        const curlX = gradientY(betaZ, x, y, z, nx, ny, dy) - gradientZ(betaY, x, y, z, nx, ny, nz, dz);
        const curlY = gradientZ(betaX, x, y, z, nx, ny, nz, dz) - gradientX(betaZ, x, y, z, nx, ny, dx);
        const curlZ = gradientX(betaY, x, y, z, nx, ny, dx) - gradientY(betaX, x, y, z, nx, ny, dy);
        const sX = bY * curlZ - bZ * curlY;
        const sY = bZ * curlX - bX * curlZ;
        const sZ = bX * curlY - bY * curlX;
        Sx[idx] = sX;
        Sy[idx] = sY;
        Sz[idx] = sZ;
        if (sX < SxMin) SxMin = sX;
        if (sX > SxMax) SxMax = sX;
        if (sY < SyMin) SyMin = sY;
        if (sY > SyMax) SyMax = sY;
        if (sZ < SzMin) SzMin = sZ;
        if (sZ > SzMax) SzMax = sZ;
        const mag = Math.hypot(sX, sY, sZ);
        fluxMagSum += mag;
        netFluxSum = [
          netFluxSum[0] + sX * cellVolume,
          netFluxSum[1] + sY * cellVolume,
          netFluxSum[2] + sZ * cellVolume,
        ];
        idx += 1;
      }
    }
  }

  const divS = new Float32Array(totalVoxels);
  let divMin = Number.POSITIVE_INFINITY;
  let divMax = Number.NEGATIVE_INFINITY;
  let divSum = 0;
  let divAbsSum = 0;
  let divRmsSum = 0;
  idx = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const div =
          gradientX(Sx, x, y, z, nx, ny, dx) +
          gradientY(Sy, x, y, z, nx, ny, dy) +
          gradientZ(Sz, x, y, z, nx, ny, nz, dz);
        divS[idx] = div;
        if (div < divMin) divMin = div;
        if (div > divMax) divMax = div;
        divSum += div;
        divAbsSum += Math.abs(div);
        divRmsSum += div * div;
        idx += 1;
      }
    }
  }

  if (!Number.isFinite(t00Min)) t00Min = 0;
  if (!Number.isFinite(t00Max)) t00Max = 0;
  if (!Number.isFinite(SxMin)) SxMin = 0;
  if (!Number.isFinite(SxMax)) SxMax = 0;
  if (!Number.isFinite(SyMin)) SyMin = 0;
  if (!Number.isFinite(SyMax)) SyMax = 0;
  if (!Number.isFinite(SzMin)) SzMin = 0;
  if (!Number.isFinite(SzMax)) SzMax = 0;
  if (!Number.isFinite(divMin)) divMin = 0;
  if (!Number.isFinite(divMax)) divMax = 0;
  const voxelNorm = Math.max(totalVoxels, 1);
  const netFlux: Vec3 = [
    netFluxSum[0] / voxelNorm,
    netFluxSum[1] / voxelNorm,
    netFluxSum[2] / voxelNorm,
  ];
  const avgFluxMagnitude = fluxMagSum / voxelNorm;
  const divMaxAbs = Math.max(Math.abs(divMin), Math.abs(divMax));
  const divMean = divSum / voxelNorm;
  const divAbsMean = divAbsSum / voxelNorm;
  const divRms = Math.sqrt(divRmsSum / voxelNorm);
  const netFluxMagnitude = Math.hypot(netFlux[0], netFlux[1], netFlux[2]);
  const normBase = Math.max(avgFluxMagnitude, EPS);
  const netFluxNorm = netFluxMagnitude / normBase;
  const divRmsNorm = divRms / normBase;
  const totalEnergy_J = sumT00 * cellVolume;
  const invariantTotals = computeInvariantMassFromFluxTotals(
    totalEnergy_J,
    netFluxSum,
  );
  const observerRobust = computeObserverRobustDiagnostics({
    t00,
    sx: Sx,
    sy: Sy,
    sz: Sz,
    pressureFactor,
    rapidityCap: observerRapidityCap,
    typeITolerance: observerTypeITolerance,
    canonicalNullDir: driveDirUnit ?? [1, 0, 0],
  });
  const tensorSampledSummaries = {
    pressureModel: "isotropic_pressure_proxy" as const,
    regions: [
      buildTensorRegionSummary(
        "global",
        tensorRegions.global,
        pressureFactor,
        "global cycle-averaged diagonal tensor summary",
      ),
      buildTensorRegionSummary(
        "hull",
        tensorRegions.hull,
        pressureFactor,
        "inside-hull sampled mean; T11/T22/T33 follow the brick pressure proxy",
      ),
      buildTensorRegionSummary(
        "wall",
        tensorRegions.wall,
        pressureFactor,
        "wall-band sampled mean; T11/T22/T33 follow the brick pressure proxy",
      ),
      buildTensorRegionSummary(
        "exterior_shell",
        tensorRegions.exterior_shell,
        pressureFactor,
        "exterior-shell sampled mean; T11/T22/T33 follow the brick pressure proxy",
      ),
    ].filter((value): value is StressEnergyTensorRegionSummary => value != null),
  };

  const stats: StressEnergyStats = {
    totalEnergy_J,
    avgT00: sumT00 / Math.max(totalVoxels, 1),
    avgFluxMagnitude,
    netFlux,
    totalMomentum_kg_m_s: invariantTotals.totalMomentum_kg_m_s,
    momentumMagnitude_kg_m_s: invariantTotals.momentumMagnitude_kg_m_s,
    invariantMass_kg: invariantTotals.invariantMass_kg,
    invariantMassEnergy_J: invariantTotals.invariantMassEnergy_J,
    divMin,
    divMax,
    dutyFR,
    strobePhase,
    natario: natarioDiagnostics,
    conservation: {
      divMean: Number.isFinite(divMean) ? divMean : 0,
      divAbsMean: Number.isFinite(divAbsMean) ? divAbsMean : 0,
      divRms: Number.isFinite(divRms) ? divRms : 0,
      divMaxAbs: Number.isFinite(divMaxAbs) ? divMaxAbs : 0,
      netFluxMagnitude: Number.isFinite(netFluxMagnitude) ? netFluxMagnitude : 0,
      netFluxNorm: Number.isFinite(netFluxNorm) ? netFluxNorm : 0,
      divRmsNorm: Number.isFinite(divRmsNorm) ? divRmsNorm : 0,
    },
    mapping: {
      rho_avg,
      rho_inst,
      gap_nm: gap_m * 1e9,
      cavityQ,
      qSpoil,
      gammaGeo,
      gammaVdB,
      dutyFR,
      ampBase,
      zeta,
      pressureFactor,
      pressureSource: "proxy",
      source: mappingSource,
      proxy: !metricMode,
      family_id: familyContext.familyId,
      source_branch: familyContext.sourceBranch,
      shape_function_id: familyContext.shapeFunctionId,
      warpFieldType: familyContext.warpFieldType,
      metricT00Ref,
      sourceRedesignMode: familyContext.sourceRedesignMode ?? null,
      sourceReformulationMode: familyContext.sourceReformulationMode ?? null,
    },
    tensorSampledSummaries,
    observerRobust,
  };

  return {
    dims,
    voxelBytes: 4,
    format: "r32f",
    source: brickSource,
    proxy: brickProxy,
    congruence: brickCongruence,
    metricT00Ref,
    metricT00Source,
    family_id: familyContext.familyId,
    source_branch: familyContext.sourceBranch,
    shape_function_id: familyContext.shapeFunctionId,
    warpFieldType: familyContext.warpFieldType,
    sourceRedesignMode: familyContext.sourceRedesignMode ?? null,
    sourceReformulationMode: familyContext.sourceReformulationMode ?? null,
    channels: {
      t00: { data: t00, min: t00Min, max: t00Max },
      Sx: { data: Sx, min: SxMin, max: SxMax },
      Sy: { data: Sy, min: SyMin, max: SyMax },
      Sz: { data: Sz, min: SzMin, max: SzMax },
      divS: { data: divS, min: divMin, max: divMax },
    },
    stats,
  };
}

export interface StressEnergyBrickResponseChannel {
  data: string;
  min: number;
  max: number;
}

export interface StressEnergyBrickResponse {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  source?: "pipeline" | "metric" | "unknown";
  proxy?: boolean;
  congruence?: "proxy-only" | "geometry-derived" | "conditional";
  metricT00Ref?: string;
  metricT00Source?: string;
  family_id?: string;
  source_branch?: string;
  shape_function_id?: string;
  warpFieldType?: string;
  sourceRedesignMode?: Nhm2SourceRedesignMode | null;
  sourceReformulationMode?: Nhm2SourceReformulationMode | null;
  channels: {
    t00: StressEnergyBrickResponseChannel;
    Sx: StressEnergyBrickResponseChannel;
    Sy: StressEnergyBrickResponseChannel;
    Sz: StressEnergyBrickResponseChannel;
    divS: StressEnergyBrickResponseChannel;
  };
  stats: StressEnergyStats;
}

export interface StressEnergyBrickBinaryHeader {
  kind: "stress-energy-brick";
  version: 1;
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  source?: "pipeline" | "metric" | "unknown";
  proxy?: boolean;
  congruence?: "proxy-only" | "geometry-derived" | "conditional";
  metricT00Ref?: string;
  metricT00Source?: string;
  family_id?: string;
  source_branch?: string;
  sourceRedesignMode?: Nhm2SourceRedesignMode | null;
  sourceReformulationMode?: Nhm2SourceReformulationMode | null;
  shape_function_id?: string;
  warpFieldType?: string;
  channelOrder: typeof STRESS_ENERGY_CHANNEL_ORDER;
  channels: {
    t00: { min: number; max: number; bytes: number };
    Sx: { min: number; max: number; bytes: number };
    Sy: { min: number; max: number; bytes: number };
    Sz: { min: number; max: number; bytes: number };
    divS: { min: number; max: number; bytes: number };
  };
  stats: StressEnergyStats;
}

export type StressEnergyBrickBinaryPayload = {
  header: StressEnergyBrickBinaryHeader;
  buffers: Buffer[];
};

export const serializeStressEnergyBrick = (brick: StressEnergyBrick): StressEnergyBrickResponse => ({
  dims: brick.dims,
  voxelBytes: brick.voxelBytes,
  format: brick.format,
  source: brick.source ?? "pipeline",
  proxy: brick.proxy ?? true,
  congruence: brick.congruence ?? "proxy-only",
  metricT00Ref: brick.metricT00Ref,
  metricT00Source: brick.metricT00Source,
  family_id: brick.family_id,
  source_branch: brick.source_branch,
  shape_function_id: brick.shape_function_id,
  warpFieldType: brick.warpFieldType,
  sourceRedesignMode: brick.sourceRedesignMode ?? null,
  sourceReformulationMode: brick.sourceReformulationMode ?? null,
  channels: {
    t00: { data: encodeFloat32(brick.channels.t00.data), min: brick.channels.t00.min, max: brick.channels.t00.max },
    Sx: { data: encodeFloat32(brick.channels.Sx.data), min: brick.channels.Sx.min, max: brick.channels.Sx.max },
    Sy: { data: encodeFloat32(brick.channels.Sy.data), min: brick.channels.Sy.min, max: brick.channels.Sy.max },
    Sz: { data: encodeFloat32(brick.channels.Sz.data), min: brick.channels.Sz.min, max: brick.channels.Sz.max },
    divS: { data: encodeFloat32(brick.channels.divS.data), min: brick.channels.divS.min, max: brick.channels.divS.max },
  },
  stats: brick.stats,
});

export const serializeStressEnergyBrickBinary = (brick: StressEnergyBrick): StressEnergyBrickBinaryPayload => {
  const t00 = brick.channels.t00;
  const Sx = brick.channels.Sx;
  const Sy = brick.channels.Sy;
  const Sz = brick.channels.Sz;
  const divS = brick.channels.divS;
  return {
    header: {
      kind: "stress-energy-brick",
      version: 1,
      dims: brick.dims,
      voxelBytes: brick.voxelBytes,
      format: brick.format,
      source: brick.source ?? "pipeline",
      proxy: brick.proxy ?? true,
      congruence: brick.congruence ?? "proxy-only",
      metricT00Ref: brick.metricT00Ref,
      metricT00Source: brick.metricT00Source,
      family_id: brick.family_id,
      source_branch: brick.source_branch,
      shape_function_id: brick.shape_function_id,
      warpFieldType: brick.warpFieldType,
      sourceRedesignMode: brick.sourceRedesignMode ?? null,
      sourceReformulationMode: brick.sourceReformulationMode ?? null,
      channelOrder: STRESS_ENERGY_CHANNEL_ORDER,
      channels: {
        t00: { min: t00.min, max: t00.max, bytes: t00.data.byteLength },
        Sx: { min: Sx.min, max: Sx.max, bytes: Sx.data.byteLength },
        Sy: { min: Sy.min, max: Sy.max, bytes: Sy.data.byteLength },
        Sz: { min: Sz.min, max: Sz.max, bytes: Sz.data.byteLength },
        divS: { min: divS.min, max: divS.max, bytes: divS.data.byteLength },
      },
      stats: brick.stats,
    },
    buffers: [
      Buffer.from(t00.data.buffer, t00.data.byteOffset, t00.data.byteLength),
      Buffer.from(Sx.data.buffer, Sx.data.byteOffset, Sx.data.byteLength),
      Buffer.from(Sy.data.buffer, Sy.data.byteOffset, Sy.data.byteLength),
      Buffer.from(Sz.data.buffer, Sz.data.byteOffset, Sz.data.byteLength),
      Buffer.from(divS.data.buffer, divS.data.byteOffset, divS.data.byteLength),
    ],
  };
};


