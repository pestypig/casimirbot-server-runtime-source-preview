import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { getGlobalPipelineState } from "./energy-pipeline.ts";
import {
  resolveHullRadius,
  type HullRadialMap,
  type Vec3,
} from "./curvature-brick.ts";
import {
  buildEvolutionBrick,
  createMinkowskiState,
  gridFromBounds,
  runInitialDataSolve,
  runBssnEvolution,
  computeShiftStiffnessMetrics,
  type BoundaryParams,
  type FixupParams,
  type FixupStats,
  type GaugeParams,
  type ShiftStiffnessMetrics,
  type StencilParams,
  type BssnState,
  type StressEnergyFieldSet,
  type StressEnergyBuildOptions,
} from "./gr/evolution/index.js";
import { toGeometricTime, toSiTime, type GrUnitSystem } from "../shared/gr-units.ts";
import type { GrPipelineDiagnostics } from "./energy-pipeline.ts";
import {
  DEFAULT_MILD_CABIN_ALPHA_GRADIENT_GEOM,
  evaluateWarpMetricLapseField,
  resolveWarpShiftLapseProfile,
  type WarpMetricAdapterSnapshot,
  type WarpMetricLapseSummary,
} from "../modules/warp/warp-metric-adapter.ts";
import type { StressEnergyBrickParams, StressEnergyStats } from "./stress-energy-brick.ts";

const SIXTEEN_PI = 16 * Math.PI;

export interface GrEvolveBrickParams {
  dims: [number, number, number];
  bounds?: { min: Vec3; max: Vec3 };
  time_s?: number;
  dt_s?: number;
  steps?: number;
  iterations?: number;
  tolerance?: number;
  koEps?: number;
  koTargets?: "gauge" | "all";
  shockMode?: "off" | "diagnostic" | "stabilize";
  advectScheme?: "centered" | "upwind1";
  useInitialData?: boolean;
  initialIterations?: number;
  initialTolerance?: number;
  gauge?: GaugeParams;
  stencils?: StencilParams;
  boundary?: BoundaryParams;
  fixups?: FixupParams;
  unitSystem?: GrUnitSystem;
  includeExtra?: boolean;
  includeMatter?: boolean;
  includeKij?: boolean;
  includeInvariants?: boolean;
  invariantWallFraction?: number;
  invariantBandFraction?: number;
  invariantSampleMax?: number;
  invariantPercentile?: number;
  initialState?: BssnState;
  matter?: StressEnergyFieldSet | null;
  sourceParams?: Partial<StressEnergyBrickParams>;
  sourceOptions?: StressEnergyBuildOptions;
}

export interface GrEvolveBrickChannel {
  data: Float32Array;
  min: number;
  max: number;
}

export interface GrEvolveBrickStats {
  steps: number;
  iterations: number;
  tolerance: number;
  cfl: number;
  H_rms: number;
  M_rms: number;
  divBetaRms?: number;
  divBetaMaxAbs?: number;
  divBetaSource?: "gr_evolve_brick";
  thetaPeakAbs?: number;
  thetaGrowthPerStep?: number;
  rhoConstraint?: GrPipelineDiagnostics["constraints"]["H_constraint"];
  invariants?: GrInvariantStatsSet;
  dissipation?: {
    koEpsUsed: number;
    koTargets: "gauge" | "all";
  };
  advectScheme?: "centered" | "upwind1";
  stiffness?: ShiftStiffnessMetrics;
  fixups?: FixupStats;
  solverHealth?: GrSolverHealth;
  stressEnergy?: StressEnergyStats;
  perf?: GrEvolveBrickPerfStats;
  wallSafety?: GrWallShiftLapseSafetySummary;
}

export type GrSolverHealthStatus = "CERTIFIED" | "UNSTABLE" | "NOT_CERTIFIED";

export interface GrSolverHealth {
  status: GrSolverHealthStatus;
  reasons: string[];
  alphaClampFraction: number;
  kClampFraction: number;
  totalClampFraction: number;
  maxAlphaBeforeClamp: number;
  maxKBeforeClamp: number;
}

export type GrBrickMetaStatus = "CERTIFIED" | "NOT_CERTIFIED";

export interface GrBrickMeta {
  status: GrBrickMetaStatus;
  reasons: string[];
}

export interface GrEvolveBrickPerfStats {
  totalMs: number;
  evolveMs: number;
  brickMs: number;
  voxels: number;
  channelCount: number;
  bytesEstimate: number;
  msPerStep: number;
}

export interface GrWallShiftLapseSafetySummary {
  betaOutwardOverAlphaWallMax: number | null;
  betaOutwardOverAlphaWallP98: number | null;
  wallHorizonMargin: number | null;
  wallSamplingPolicy: string;
  wallNormalModel: string;
  wallSampleCount: number;
  wallRegionDefinition: string;
  sampleOffsetInsideWall_m: number | null;
}

export interface GrInvariantStats {
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
}

export interface GrInvariantStatsSet {
  kretschmann?: GrInvariantStats;
  ricci4?: GrInvariantStats;
}

export interface GrEvolveBrick {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
  source?: "pipeline" | "metric" | "unknown";
  channelOrder?: string[];
  channels: {
    alpha: GrEvolveBrickChannel;
    beta_x: GrEvolveBrickChannel;
    beta_y: GrEvolveBrickChannel;
    beta_z: GrEvolveBrickChannel;
    gamma_xx: GrEvolveBrickChannel;
    gamma_yy: GrEvolveBrickChannel;
    gamma_zz: GrEvolveBrickChannel;
    K_trace: GrEvolveBrickChannel;
    H_constraint: GrEvolveBrickChannel;
    M_constraint_x: GrEvolveBrickChannel;
    M_constraint_y: GrEvolveBrickChannel;
    M_constraint_z: GrEvolveBrickChannel;
    [key: string]: GrEvolveBrickChannel;
  };
  stats: GrEvolveBrickStats;
  meta?: GrBrickMeta;
}

export interface GrEvolveBrickResponseChannel {
  data: string;
  min: number;
  max: number;
}

export interface GrEvolveBrickResponse {
  kind: "gr-evolve-brick";
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
  source?: "pipeline" | "metric" | "unknown";
  channelOrder?: string[];
  channels: {
    alpha: GrEvolveBrickResponseChannel;
    beta_x: GrEvolveBrickResponseChannel;
    beta_y: GrEvolveBrickResponseChannel;
    beta_z: GrEvolveBrickResponseChannel;
    gamma_xx: GrEvolveBrickResponseChannel;
    gamma_yy: GrEvolveBrickResponseChannel;
    gamma_zz: GrEvolveBrickResponseChannel;
    K_trace: GrEvolveBrickResponseChannel;
    H_constraint: GrEvolveBrickResponseChannel;
    M_constraint_x: GrEvolveBrickResponseChannel;
    M_constraint_y: GrEvolveBrickResponseChannel;
    M_constraint_z: GrEvolveBrickResponseChannel;
    [key: string]: GrEvolveBrickResponseChannel;
  };
  stats: GrEvolveBrickStats;
  meta?: GrBrickMeta;
}

export interface GrEvolveBrickBinaryHeader {
  kind: "gr-evolve-brick";
  version: 1;
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
  source?: "pipeline" | "metric" | "unknown";
  channelOrder: readonly string[];
  channels: Record<string, { min: number; max: number; bytes: number }>;
  stats: GrEvolveBrickStats;
  meta?: GrBrickMeta;
}

export type GrEvolveBrickBinaryPayload = {
  header: GrEvolveBrickBinaryHeader;
  buffers: Buffer[];
};

const GR_EVOLVE_CHANNEL_ORDER = [
  "alpha",
  "beta_x",
  "beta_y",
  "beta_z",
  "alpha_grad_x",
  "alpha_grad_y",
  "alpha_grad_z",
  "eulerian_accel_geom_x",
  "eulerian_accel_geom_y",
  "eulerian_accel_geom_z",
  "eulerian_accel_geom_mag",
  "beta_over_alpha_mag",
  "div_beta",
  "gamma_xx",
  "gamma_yy",
  "gamma_zz",
  "gamma_xy",
  "gamma_xz",
  "gamma_yz",
  "K_trace",
  "g_tt",
  "clockRate_static",
  "theta",
  "det_gamma",
  "ricci3",
  "KijKij",
  "kretschmann",
  "weylI",
  "ricci4",
  "ricci2",
  "H_constraint",
  "M_constraint_x",
  "M_constraint_y",
  "M_constraint_z",
  "hull_sdf",
  "tile_support_mask",
  "region_class",
] as const;

const GR_EVOLVE_KIJ_CHANNELS = [
  "K_xx",
  "K_yy",
  "K_zz",
  "K_xy",
  "K_xz",
  "K_yz",
] as const;

const GR_EVOLVE_MATTER_CHANNELS = [
  "rho",
  "Sx",
  "Sy",
  "Sz",
  "S_xx",
  "S_yy",
  "S_zz",
  "S_xy",
  "S_xz",
  "S_yz",
] as const;

const FIXUP_CLAMP_FRACTION_MAX = 0.01;
const FIXUP_MAX_ALPHA_MULT = 2;
const FIXUP_MAX_K_MULT = 2;
const GR_CFL_MAX = 0.5;
const GR_CFL_MIN = 1e-6;
const INVARIANT_SAMPLE_MAX = 50_000;
const INVARIANT_P98 = 0.98;
const INVARIANT_WALL_FRACTION = 0.25;
const INVARIANT_BAND_FRACTION = 0.2;

const filterChannelOrder = (
  order: readonly string[],
  channels: Record<string, GrEvolveBrickChannel>,
): string[] => {
  const filtered: string[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    if (!channels[key]) continue;
    filtered.push(key);
    seen.add(key);
  }
  for (const key of Object.keys(channels)) {
    if (seen.has(key)) continue;
    filtered.push(key);
    seen.add(key);
  }
  return filtered;
};

const defaultHullBounds = () => {
  const state = getGlobalPipelineState();
  const hull = state?.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return { min, max };
};

const toFiniteVec3 = (value: unknown): Vec3 | null => {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
};

const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const resolveShiftVectorFromPipeline = (
  pipelineState: ReturnType<typeof getGlobalPipelineState>,
): Vec3 | null => {
  const natarioShift = toFiniteVec3((pipelineState as any)?.natario?.shiftBeta);
  if (natarioShift) return natarioShift;
  const betaAvg = toFiniteNumber((pipelineState as any)?.warp?.betaAvg);
  if (betaAvg != null) return [betaAvg, 0, 0];
  const shiftAmplitude = toFiniteNumber((pipelineState as any)?.warp?.shiftVectorField?.amplitude);
  if (shiftAmplitude != null) return [shiftAmplitude, 0, 0];
  const legacyBetaAvg = toFiniteNumber((pipelineState as any)?.beta_avg);
  if (legacyBetaAvg != null) return [legacyBetaAvg, 0, 0];
  return null;
};

const resolveShiftLapseSummaryFromPipeline = (
  pipelineState: ReturnType<typeof getGlobalPipelineState>,
): WarpMetricLapseSummary | null => {
  const adapter = (pipelineState as any)?.warp?.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  if (adapter?.family === "nhm2_shift_lapse" && adapter.lapseSummary) {
    return adapter.lapseSummary;
  }
  const warpLapseSummary = (pipelineState as any)?.warp?.lapseSummary;
  if (
    (pipelineState as any)?.warp?.metricAdapter?.family === "nhm2_shift_lapse" &&
    warpLapseSummary &&
    typeof warpLapseSummary === "object"
  ) {
    return warpLapseSummary as WarpMetricLapseSummary;
  }
  const warpFieldType =
    (pipelineState as any)?.dynamicConfig?.warpFieldType ??
    (pipelineState as any)?.warpFieldType ??
    null;
  if (warpFieldType !== "nhm2_shift_lapse") return null;
  const dynamicConfig = (pipelineState as any)?.dynamicConfig ?? {};
  const shiftLapseProfile = resolveWarpShiftLapseProfile(
    typeof dynamicConfig.shiftLapseProfileId === "string"
      ? dynamicConfig.shiftLapseProfileId
      : null,
  );
  const alphaCenterline = Number.isFinite(dynamicConfig.alphaCenterline)
    ? Math.max(1e-6, Number(dynamicConfig.alphaCenterline))
    : shiftLapseProfile.alphaCenterlineDefault;
  const gradientVec =
    toFiniteVec3(dynamicConfig.alphaGradientVec_m_inv) ??
    [0, 0, DEFAULT_MILD_CABIN_ALPHA_GRADIENT_GEOM];
  const hull = (pipelineState as any)?.hull;
  const hullAxes: Vec3 = hull
    ? [
        Math.max(1e-6, Number(hull.Lx_m ?? 1007) / 2),
        Math.max(1e-6, Number(hull.Ly_m ?? 264) / 2),
        Math.max(1e-6, Number(hull.Lz_m ?? 173) / 2),
      ]
    : [503.5, 132, 86.5];
  const delta =
    Math.abs(gradientVec[0]) * hullAxes[0] +
    Math.abs(gradientVec[1]) * hullAxes[1] +
    Math.abs(gradientVec[2]) * hullAxes[2];
  return {
    alphaCenterline,
    alphaMin: Math.max(1e-6, Math.min(1, alphaCenterline - delta)),
    alphaMax: Math.max(alphaCenterline, 1, alphaCenterline + delta),
    alphaProfileKind:
      dynamicConfig.alphaProfileKind === "unit" ? "unit" : "linear_gradient_tapered",
    alphaGradientAxis:
      Math.abs(gradientVec[0]) >= Math.abs(gradientVec[1]) &&
      Math.abs(gradientVec[0]) >= Math.abs(gradientVec[2])
        ? "x_ship"
        : Math.abs(gradientVec[1]) >= Math.abs(gradientVec[2])
          ? "y_port"
          : "z_zenith",
    alphaGradientVec_m_inv: gradientVec,
    alphaInteriorSupportKind:
      dynamicConfig.alphaInteriorSupportKind === "bubble_interior"
        ? "bubble_interior"
        : "hull_interior",
    alphaWallTaper_m: Math.max(
      1e-6,
      Number(dynamicConfig.alphaWallTaper_m ?? hull?.wallThickness_m ?? 0.45),
    ),
    diagnosticTier: "diagnostic",
    shiftLapseProfileId: shiftLapseProfile.profileId,
    shiftLapseProfileStage: shiftLapseProfile.profileStage,
    shiftLapseProfileLabel: shiftLapseProfile.profileLabel,
    shiftLapseProfileNote: shiftLapseProfile.profileNote,
    signConvention:
      "positive alphaGradientVec_m_inv raises alpha along +x_ship/+y_port/+z_zenith; diagnostic-only generalized NHM2 branch",
  };
};

const applyShiftLapseSummaryToState = (
  state: BssnState,
  lapseSummary: WarpMetricLapseSummary,
  pipelineState: ReturnType<typeof getGlobalPipelineState>,
): void => {
  const hull = (pipelineState as any)?.hull;
  const hullAxes: Vec3 | undefined = hull
    ? [
        Math.max(1e-6, Number(hull.Lx_m ?? 1007) / 2),
        Math.max(1e-6, Number(hull.Ly_m ?? 264) / 2),
        Math.max(1e-6, Number(hull.Lz_m ?? 173) / 2),
      ]
    : undefined;
  const bubbleRadius_m =
    toFiniteNumber((pipelineState as any)?.bubble?.R) ??
    toFiniteNumber((pipelineState as any)?.R) ??
    undefined;
  const bounds = state.grid.bounds ?? defaultHullBounds();
  const [nx, ny, nz] = state.grid.dims;
  const [dx, dy, dz] = state.grid.spacing;
  const shiftVector = resolveShiftVectorFromPipeline(pipelineState) ?? [0, 0, 0];
  let idx = 0;
  for (let k = 0; k < nz; k += 1) {
    const z = bounds.min[2] + (k + 0.5) * dz;
    for (let j = 0; j < ny; j += 1) {
      const y = bounds.min[1] + (j + 0.5) * dy;
      for (let i = 0; i < nx; i += 1) {
        const x = bounds.min[0] + (i + 0.5) * dx;
        state.alpha[idx] = evaluateWarpMetricLapseField({
          lapseSummary,
          point: [x, y, z],
          hullAxes,
          bubbleRadius_m,
        });
        state.beta_x[idx] = shiftVector[0];
        state.beta_y[idx] = shiftVector[1];
        state.beta_z[idx] = shiftVector[2];
        idx += 1;
      }
    }
  }
};

const buildShiftLapseInitialState = (
  dims: [number, number, number],
  bounds: { min: Vec3; max: Vec3 },
): BssnState | null => {
  const pipelineState = getGlobalPipelineState();
  const lapseSummary = resolveShiftLapseSummaryFromPipeline(pipelineState);
  if (!lapseSummary) return null;
  const grid = gridFromBounds(dims, bounds);
  const state = createMinkowskiState(grid);
  applyShiftLapseSummaryToState(state, lapseSummary, pipelineState);
  return state;
};

const resolveVoxelSize = (
  dims: [number, number, number],
  bounds: { min: Vec3; max: Vec3 },
): Vec3 => [
  (bounds.max[0] - bounds.min[0]) / Math.max(1, dims[0]),
  (bounds.max[1] - bounds.min[1]) / Math.max(1, dims[1]),
  (bounds.max[2] - bounds.min[2]) / Math.max(1, dims[2]),
];

const clampDtForCfl = (
  dt_s: number,
  dims: [number, number, number],
  bounds: { min: Vec3; max: Vec3 },
  unitSystem: GrUnitSystem,
) => {
  if (!(dt_s > 0)) {
    return { dt_s: Math.max(0, dt_s), clamped: false };
  }
  const spacing = resolveVoxelSize(dims, bounds);
  const minSpacing = Math.max(1e-12, Math.min(spacing[0], spacing[1], spacing[2]));
  const dtGeom = unitSystem === "SI" ? toGeometricTime(dt_s) : dt_s;
  const dtGeomMax = minSpacing * GR_CFL_MAX;
  if (!(dtGeom > 0) || !(dtGeomMax > 0)) {
    return { dt_s, clamped: false };
  }
  if (dtGeom <= dtGeomMax) {
    return { dt_s, clamped: false };
  }
  const dtGeomClamped = dtGeomMax;
  const dtClamped = unitSystem === "SI" ? toSiTime(dtGeomClamped) : dtGeomClamped;
  return { dt_s: dtClamped, clamped: true };
};

const buildConstantChannel = (total: number, value: number): GrEvolveBrickChannel => {
  const data = new Float32Array(total);
  if (value !== 0) data.fill(value);
  return { data, min: value, max: value };
};

const buildChannelFromArray = (data: Float32Array): GrEvolveBrickChannel => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  return { data, min, max };
};

const buildRegionClassChannel = (
  theta: GrEvolveBrickChannel,
  supportMask: GrEvolveBrickChannel | null,
  neutralEps = 1e-12,
): GrEvolveBrickChannel => {
  const len = theta.data.length;
  const data = new Float32Array(len);
  const eps = Math.max(0, neutralEps);
  const supportData = supportMask?.data;
  for (let i = 0; i < len; i += 1) {
    if (supportData && (supportData[i] ?? 0) <= 0.5) {
      data[i] = 0;
      continue;
    }
    const value = theta.data[i];
    data[i] = value > eps ? 1 : value < -eps ? -1 : 0;
  }
  return buildChannelFromArray(data);
};

const appendBrickMetaReason = (meta: GrBrickMeta | undefined, reason: string): GrBrickMeta => {
  const reasons = meta?.reasons ? [...meta.reasons] : [];
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
  return { status: "NOT_CERTIFIED", reasons };
};

const resolveHullAxes = (
  bounds: { min: Vec3; max: Vec3 },
  sourceParams: Partial<StressEnergyBrickParams> | undefined,
  state: ReturnType<typeof getGlobalPipelineState>,
): Vec3 => {
  const src = sourceParams?.hullAxes;
  if (
    Array.isArray(src) &&
    src.length >= 3 &&
    Number.isFinite(src[0]) &&
    Number.isFinite(src[1]) &&
    Number.isFinite(src[2]) &&
    src[0] > 0 &&
    src[1] > 0 &&
    src[2] > 0
  ) {
    return [Number(src[0]), Number(src[1]), Number(src[2])];
  }
  const stateHull = (state as any)?.hull;
  if (
    stateHull &&
    Number.isFinite(stateHull.Lx_m) &&
    Number.isFinite(stateHull.Ly_m) &&
    Number.isFinite(stateHull.Lz_m)
  ) {
    return [
      Math.max(1e-6, Number(stateHull.Lx_m) * 0.5),
      Math.max(1e-6, Number(stateHull.Ly_m) * 0.5),
      Math.max(1e-6, Number(stateHull.Lz_m) * 0.5),
    ];
  }
  return [
    Math.max(1e-6, Math.abs(bounds.max[0] - bounds.min[0]) * 0.5),
    Math.max(1e-6, Math.abs(bounds.max[1] - bounds.min[1]) * 0.5),
    Math.max(1e-6, Math.abs(bounds.max[2] - bounds.min[2]) * 0.5),
  ];
};

const resolveHullSupportChannels = (
  state: ReturnType<typeof getGlobalPipelineState>,
  dims: [number, number, number],
  bounds: { min: Vec3; max: Vec3 },
  sourceParams: Partial<StressEnergyBrickParams> | undefined,
  theta: GrEvolveBrickChannel | undefined,
  neutralEps: number,
) => {
  const reasons: string[] = [];
  const total = Math.max(0, dims[0] * dims[1] * dims[2]);
  if (total <= 0) {
    reasons.push("hull_support_dims_invalid");
    return {
      hullSdf: null,
      tileSupportMask: null,
      regionClass: null,
      reasons,
    };
  }

  const hullAxes = resolveHullAxes(bounds, sourceParams, state);
  const radialMap = (sourceParams?.radialMap as HullRadialMap | null | undefined) ?? null;
  const spacing = resolveVoxelSize(dims, bounds);
  const dx = Math.max(1e-6, spacing[0]);
  const dy = Math.max(1e-6, spacing[1]);
  const dz = Math.max(1e-6, spacing[2]);
  const rawHullWall = Number(
    sourceParams?.hullWall ??
      (state as any)?.hull?.wallThickness_m ??
      Math.min(dx, dy, dz),
  );
  const hullWall = Number.isFinite(rawHullWall)
    ? Math.max(rawHullWall, 0.5 * Math.min(dx, dy, dz))
    : 0.5 * Math.min(dx, dy, dz);
  if (!Number.isFinite(rawHullWall)) {
    reasons.push("hull_support_hull_wall_missing");
  }

  const sdfData = new Float32Array(total);
  const supportData = new Float32Array(total);
  const nx = dims[0];
  const ny = dims[1];
  const nz = dims[2];
  let idx = 0;
  for (let z = 0; z < nz; z += 1) {
    const pz = bounds.min[2] + (z + 0.5) * dz;
    for (let y = 0; y < ny; y += 1) {
      const py = bounds.min[1] + (y + 0.5) * dy;
      for (let x = 0; x < nx; x += 1) {
        const px = bounds.min[0] + (x + 0.5) * dx;
        const pLen = Math.hypot(px, py, pz);
        const dir: Vec3 =
          pLen > 1e-9
            ? [px / pLen, py / pLen, pz / pLen]
            : [1, 0, 0];
        const radius = resolveHullRadius(dir, hullAxes, radialMap);
        const signedDistance = pLen - radius;
        sdfData[idx] = Number.isFinite(signedDistance) ? signedDistance : 0;
        supportData[idx] = Math.abs(signedDistance) <= hullWall ? 1 : 0;
        idx += 1;
      }
    }
  }

  const hullSdf = buildChannelFromArray(sdfData);
  const tileSupportMask = buildChannelFromArray(supportData);
  const regionClass = theta
    ? buildRegionClassChannel(theta, tileSupportMask, neutralEps)
    : null;
  if (!theta) {
    reasons.push("hull_support_theta_missing");
  }
  if (tileSupportMask.max <= 0) {
    reasons.push("hull_support_empty");
  }

  return {
    hullSdf,
    tileSupportMask,
    regionClass,
    reasons,
  };
};

const normalizeVec3 = (value: Vec3): Vec3 => {
  const mag = Math.hypot(value[0], value[1], value[2]);
  if (!(mag > 0)) return [0, 0, 1];
  return [value[0] / mag, value[1] / mag, value[2] / mag];
};

const sampleChannelAtPoint = (
  channel: GrEvolveBrickChannel,
  dims: [number, number, number],
  bounds: { min: Vec3; max: Vec3 },
  point: Vec3,
): number | null => {
  const [nx, ny, nz] = dims;
  const clampIndex = (value: number, size: number) =>
    Math.max(0, Math.min(size - 1, value));
  const xNorm =
    (point[0] - bounds.min[0]) / Math.max(1e-9, bounds.max[0] - bounds.min[0]);
  const yNorm =
    (point[1] - bounds.min[1]) / Math.max(1e-9, bounds.max[1] - bounds.min[1]);
  const zNorm =
    (point[2] - bounds.min[2]) / Math.max(1e-9, bounds.max[2] - bounds.min[2]);
  const ix = clampIndex(Math.floor(xNorm * nx), nx);
  const iy = clampIndex(Math.floor(yNorm * ny), ny);
  const iz = clampIndex(Math.floor(zNorm * nz), nz);
  const idx = iz * nx * ny + iy * nx + ix;
  const value = channel.data[idx];
  return Number.isFinite(value) ? value : null;
};

const buildWallSampleDirections = (
  polarCount = 9,
  azimuthCount = 16,
): Vec3[] => {
  const directions: Vec3[] = [];
  for (let i = 0; i < polarCount; i += 1) {
    const v = (i + 0.5) / polarCount;
    const z = 1 - 2 * v;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phase = i % 2 === 0 ? 0 : 0.5;
    for (let j = 0; j < azimuthCount; j += 1) {
      const phi = ((j + phase) / azimuthCount) * Math.PI * 2;
      directions.push([
        r * Math.cos(phi),
        r * Math.sin(phi),
        z,
      ]);
    }
  }
  return directions;
};

const computeWallShiftLapseSafety = (args: {
  state: ReturnType<typeof getGlobalPipelineState>;
  dims: [number, number, number];
  bounds: { min: Vec3; max: Vec3 };
  sourceParams: Partial<StressEnergyBrickParams> | undefined;
  alpha: GrEvolveBrickChannel;
  betaX: GrEvolveBrickChannel;
  betaY: GrEvolveBrickChannel;
  betaZ: GrEvolveBrickChannel;
}): GrWallShiftLapseSafetySummary => {
  const hullAxes = resolveHullAxes(args.bounds, args.sourceParams, args.state);
  const radialMap =
    (args.sourceParams?.radialMap as HullRadialMap | null | undefined) ?? null;
  const spacing = resolveVoxelSize(args.dims, args.bounds);
  const minSpacing = Math.max(1e-6, Math.min(...spacing));
  const rawHullWall = Number(
    args.sourceParams?.hullWall ??
      (args.state as any)?.hull?.wallThickness_m ??
      minSpacing,
  );
  const hullWall = Number.isFinite(rawHullWall)
    ? Math.max(rawHullWall, 0.5 * minSpacing)
    : 0.5 * minSpacing;
  const sampleOffsetInsideWall_m = Math.max(
    1e-6,
    Math.min(hullWall * 0.5, Math.max(minSpacing, hullWall)),
  );
  const directions = buildWallSampleDirections();
  const outwardSamples: number[] = [];
  for (const dirRaw of directions) {
    const dir = normalizeVec3(dirRaw);
    const radius = resolveHullRadius(dir, hullAxes, radialMap);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const surfacePoint: Vec3 = [
      dir[0] * radius,
      dir[1] * radius,
      dir[2] * radius,
    ];
    const ellipsoidNormal = normalizeVec3([
      surfacePoint[0] / Math.max(1e-12, hullAxes[0] * hullAxes[0]),
      surfacePoint[1] / Math.max(1e-12, hullAxes[1] * hullAxes[1]),
      surfacePoint[2] / Math.max(1e-12, hullAxes[2] * hullAxes[2]),
    ]);
    const samplePoint: Vec3 = [
      surfacePoint[0] - ellipsoidNormal[0] * sampleOffsetInsideWall_m,
      surfacePoint[1] - ellipsoidNormal[1] * sampleOffsetInsideWall_m,
      surfacePoint[2] - ellipsoidNormal[2] * sampleOffsetInsideWall_m,
    ];
    const alpha = sampleChannelAtPoint(args.alpha, args.dims, args.bounds, samplePoint);
    const betaX = sampleChannelAtPoint(args.betaX, args.dims, args.bounds, samplePoint);
    const betaY = sampleChannelAtPoint(args.betaY, args.dims, args.bounds, samplePoint);
    const betaZ = sampleChannelAtPoint(args.betaZ, args.dims, args.bounds, samplePoint);
    if (
      alpha == null ||
      betaX == null ||
      betaY == null ||
      betaZ == null
    ) {
      continue;
    }
    const outward =
      (betaX * ellipsoidNormal[0] +
        betaY * ellipsoidNormal[1] +
        betaZ * ellipsoidNormal[2]) /
      Math.max(1e-9, Math.abs(alpha));
    outwardSamples.push(Math.max(0, outward));
  }
  const betaOutwardOverAlphaWallMax =
    outwardSamples.length > 0 ? Math.max(...outwardSamples) : null;
  const betaOutwardOverAlphaWallP98 =
    outwardSamples.length > 0 ? percentileFromSamples(outwardSamples, 0.98) : null;
  return {
    betaOutwardOverAlphaWallMax,
    betaOutwardOverAlphaWallP98,
    wallHorizonMargin:
      betaOutwardOverAlphaWallMax != null ? 1 - betaOutwardOverAlphaWallMax : null,
    wallSamplingPolicy: "ellipsoidal_surface_interior_offset_grid_v1",
    wallNormalModel: "ellipsoidal_hull_gradient_approx",
    wallSampleCount: outwardSamples.length,
    wallRegionDefinition:
      "Sample outward normals on a deterministic ellipsoidal hull grid and evaluate beta.n/alpha one half wall-thickness inside the support wall.",
    sampleOffsetInsideWall_m,
  };
};

const rmsFromChannel = (channel: GrEvolveBrickChannel) => {
  const data = channel.data;
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
};

const rmsFromVector = (
  x: GrEvolveBrickChannel,
  y: GrEvolveBrickChannel,
  z: GrEvolveBrickChannel,
) => {
  const len = Math.min(x.data.length, y.data.length, z.data.length);
  if (!len) return 0;
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    const vx = x.data[i];
    const vy = y.data[i];
    const vz = z.data[i];
    sum += vx * vx + vy * vy + vz * vz;
  }
  return Math.sqrt(sum / len);
};

const maxAbsBeta = (
  x: GrEvolveBrickChannel,
  y: GrEvolveBrickChannel,
  z: GrEvolveBrickChannel,
) => {
  const len = Math.min(x.data.length, y.data.length, z.data.length);
  if (!len) return 0;
  let maxAbs = 0;
  for (let i = 0; i < len; i += 1) {
    const mag = Math.hypot(x.data[i], y.data[i], z.data[i]);
    if (mag > maxAbs) maxAbs = mag;
  }
  return maxAbs;
};

const maxAbsFromChannel = (channel: GrEvolveBrickChannel) => {
  const min = Number(channel.min);
  const max = Number(channel.max);
  const absMin = Number.isFinite(min) ? Math.abs(min) : 0;
  const absMax = Number.isFinite(max) ? Math.abs(max) : 0;
  return Math.max(absMin, absMax);
};

const meanFromChannel = (channel: GrEvolveBrickChannel) => {
  const data = channel.data;
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i];
  }
  const mean = sum / data.length;
  return Number.isFinite(mean) ? mean : 0;
};

const percentileFromSamples = (samples: number[], p: number) => {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const q = Math.min(Math.max(p, 0), 1);
  const index = Math.floor((sorted.length - 1) * q);
  return sorted[index] ?? 0;
};

const buildInvariantStats = (
  channel: GrEvolveBrickChannel | undefined,
  options: {
    wallFraction: number;
    bandFraction: number;
    sampleMax: number;
    percentile: number;
    useAbs: boolean;
  },
): GrInvariantStats | null => {
  if (!channel) return null;
  const data = channel.data;
  const total = Math.max(0, data.length);
  if (!total) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      p98: 0,
      sampleCount: 0,
      abs: options.useAbs,
      wallFraction: options.wallFraction,
      bandFraction: options.bandFraction,
      threshold: 0,
      bandMin: 0,
      bandMax: 0,
    };
  }
  const sampleMax = Math.max(1, Math.floor(options.sampleMax));
  const stride = Math.max(1, Math.floor(total / sampleMax));
  const samples: number[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < total; i += stride) {
    const raw = data[i];
    if (!Number.isFinite(raw)) continue;
    const value = options.useAbs ? Math.abs(raw) : raw;
    samples.push(value);
    sum += value;
    count += 1;
  }
  const p98 = percentileFromSamples(samples, options.percentile);
  const mean = count > 0 ? sum / count : 0;
  const wallFraction = Math.min(1, Math.max(0, options.wallFraction));
  const bandFraction = Math.min(1, Math.max(0, options.bandFraction));
  const threshold = p98 * wallFraction;
  const bandMin = threshold > 0 ? threshold * (1 - bandFraction) : 0;
  const bandMax = threshold > 0 ? threshold * (1 + bandFraction) : 0;
  return {
    min: Number.isFinite(channel.min) ? channel.min : 0,
    max: Number.isFinite(channel.max) ? channel.max : 0,
    mean: Number.isFinite(mean) ? mean : 0,
    p98: Number.isFinite(p98) ? p98 : 0,
    sampleCount: count,
    abs: options.useAbs,
    wallFraction,
    bandFraction,
    threshold: Number.isFinite(threshold) ? threshold : 0,
    bandMin: Number.isFinite(bandMin) ? bandMin : 0,
    bandMax: Number.isFinite(bandMax) ? bandMax : 0,
  };
};

const buildConstraintDiagnostics = (
  channel: GrEvolveBrickChannel,
  rms?: number,
): GrPipelineDiagnostics["constraints"]["H_constraint"] => {
  const min = channel.min;
  const max = channel.max;
  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  return {
    min,
    max,
    maxAbs,
    ...(Number.isFinite(rms) ? { rms: rms as number } : {}),
  };
};

const buildRhoConstraintDiagnostics = (
  ricci3?: GrEvolveBrickChannel,
  K_trace?: GrEvolveBrickChannel,
  KijKij?: GrEvolveBrickChannel,
): GrPipelineDiagnostics["constraints"]["H_constraint"] | null => {
  if (!ricci3 || !K_trace || !KijKij) return null;
  const total = Math.min(
    ricci3.data.length,
    K_trace.data.length,
    KijKij.data.length,
  );
  if (!total) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let maxAbs = 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < total; i += 1) {
    const R3 = ricci3.data[i];
    const K = K_trace.data[i];
    const K2 = K * K;
    const KijVal = KijKij.data[i];
    if (!Number.isFinite(R3) || !Number.isFinite(K2) || !Number.isFinite(KijVal)) {
      continue;
    }
    const rho = (R3 + K2 - KijVal) / SIXTEEN_PI;
    if (!Number.isFinite(rho)) continue;
    if (rho < min) min = rho;
    if (rho > max) max = rho;
    const abs = Math.abs(rho);
    if (abs > maxAbs) maxAbs = abs;
    sum += rho;
    sumSq += rho * rho;
    count += 1;
  }
  if (!count) return null;
  const mean = sum / count;
  const rms = Math.sqrt(sumSq / count);
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    maxAbs: Number.isFinite(maxAbs) ? maxAbs : 0,
    mean: Number.isFinite(mean) ? mean : 0,
    rms: Number.isFinite(rms) ? rms : 0,
    sampleCount: count,
  };
};

const buildSolverHealth = (
  fixups: FixupStats | undefined,
  steps: number,
): GrSolverHealth | undefined => {
  if (!fixups) {
    return {
      status: "NOT_CERTIFIED",
      reasons: ["missing fixup stats"],
      alphaClampFraction: 0,
      kClampFraction: 0,
      totalClampFraction: 0,
      maxAlphaBeforeClamp: 0,
      maxKBeforeClamp: 0,
    };
  }
  const totalCells = Math.max(0, fixups.totalCells);
  const totalPasses = Math.max(1, steps + (fixups.postStep ? 1 : 0));
  const denom = totalCells * totalPasses;
  const alphaClampFraction =
    denom > 0 ? fixups.alphaClampCount / denom : 0;
  const kClampFraction =
    denom > 0 ? fixups.kClampCount / denom : 0;
  const totalClampFraction =
    denom > 0 ? (fixups.alphaClampCount + fixups.kClampCount) / denom : 0;
  const maxAlphaBeforeClamp = fixups.maxAlphaBeforeClamp;
  const maxKBeforeClamp = fixups.maxKBeforeClamp;
  const reasons: string[] = [];
  let status: GrSolverHealthStatus = "CERTIFIED";

  if (!(denom > 0)) {
    status = "NOT_CERTIFIED";
    reasons.push("missing clamp denominator");
  }
  if (alphaClampFraction > FIXUP_CLAMP_FRACTION_MAX) {
    status = "UNSTABLE";
    reasons.push("alpha clamp fraction high");
  }
  if (kClampFraction > FIXUP_CLAMP_FRACTION_MAX) {
    status = "UNSTABLE";
    reasons.push("K clamp fraction high");
  }
  if (
    Number.isFinite(fixups.alphaClampMax) &&
    fixups.alphaClampMax > 0 &&
    maxAlphaBeforeClamp > fixups.alphaClampMax * FIXUP_MAX_ALPHA_MULT
  ) {
    status = "UNSTABLE";
    reasons.push("alpha overshoot beyond clamp limit");
  }
  if (
    Number.isFinite(fixups.kClampMaxAbs) &&
    fixups.kClampMaxAbs > 0 &&
    maxKBeforeClamp > fixups.kClampMaxAbs * FIXUP_MAX_K_MULT
  ) {
    status = "UNSTABLE";
    reasons.push("K overshoot beyond clamp limit");
  }

  return {
    status,
    reasons,
    alphaClampFraction,
    kClampFraction,
    totalClampFraction,
    maxAlphaBeforeClamp,
    maxKBeforeClamp,
  };
};

const computeClampFraction = (
  fixups: FixupStats | undefined,
  steps: number,
): number => {
  if (!fixups) return 0;
  const totalCells = Math.max(0, fixups.totalCells);
  const totalPasses = Math.max(1, steps + (fixups.postStep ? 1 : 0));
  const denom = totalCells * totalPasses;
  if (!(denom > 0)) return 0;
  const totalClamps = fixups.alphaClampCount + fixups.kClampCount;
  return totalClamps / denom;
};

const buildBrickMeta = (params: {
  fixups: FixupStats | undefined;
  solverHealth: GrSolverHealth | undefined;
  stiffness: ShiftStiffnessMetrics | undefined;
  steps: number;
  dtGeom: number;
  minSpacing: number;
}): GrBrickMeta => {
  const reasons: string[] = [];
  let status: GrBrickMetaStatus = "CERTIFIED";
  const clampFraction = computeClampFraction(params.fixups, params.steps);
  const shockMode = params.stiffness?.shockMode ?? "off";
  const shockSevere = params.stiffness?.shockSeverity === "severe";
  const dtMin = params.minSpacing * GR_CFL_MIN;

  if (!params.fixups) {
    status = "NOT_CERTIFIED";
    reasons.push("missing fixup stats");
  }
  if (clampFraction > FIXUP_CLAMP_FRACTION_MAX) {
    status = "NOT_CERTIFIED";
    reasons.push("clamp fraction high");
  }
  if (params.solverHealth?.status === "UNSTABLE") {
    status = "NOT_CERTIFIED";
    reasons.push("solver health unstable");
  }
  if (shockSevere && shockMode !== "off") {
    status = "NOT_CERTIFIED";
    reasons.push("severe shift shock");
  }
  if (params.dtGeom > 0 && params.dtGeom < dtMin) {
    status = "NOT_CERTIFIED";
    reasons.push("dt below minimum threshold");
  }

  return { status, reasons };
};

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const buildGrDiagnostics = (
  brick: GrEvolveBrick,
  context?: { metricAdapter?: WarpMetricAdapterSnapshot | null },
): GrPipelineDiagnostics => {
  const H_constraint = buildConstraintDiagnostics(
    brick.channels.H_constraint,
    brick.stats.H_rms,
  );
  const Mx = buildConstraintDiagnostics(brick.channels.M_constraint_x);
  const My = buildConstraintDiagnostics(brick.channels.M_constraint_y);
  const Mz = buildConstraintDiagnostics(brick.channels.M_constraint_z);
  const M_maxAbs = Math.max(Mx.maxAbs, My.maxAbs, Mz.maxAbs);
  const alpha = brick.channels.alpha;
  const lapseMin = Number.isFinite(alpha?.min) ? alpha.min : 0;
  const lapseMax = Number.isFinite(alpha?.max) ? alpha.max : 0;
  const stiffness = brick.stats.stiffness;
  const wallSafety = brick.stats.wallSafety;
  const divBetaRms = brick.stats.divBetaRms;
  const divBetaMaxAbs = brick.stats.divBetaMaxAbs;
  const divBetaSource = brick.stats.divBetaSource;
  const thetaChannel = brick.channels.theta;
  const kTraceChannel = brick.channels.K_trace;
  const thetaMean = thetaChannel ? meanFromChannel(thetaChannel) : undefined;
  const thetaMaxAbs = thetaChannel ? maxAbsFromChannel(thetaChannel) : undefined;
  const kTraceMean = kTraceChannel ? meanFromChannel(kTraceChannel) : undefined;
  const kTraceMaxAbs = kTraceChannel ? maxAbsFromChannel(kTraceChannel) : undefined;
  const thetaFallbackMean =
    thetaMean ?? (Number.isFinite(kTraceMean) ? -Number(kTraceMean) : undefined);
  const thetaFallbackMaxAbs =
    thetaMaxAbs ?? (Number.isFinite(kTraceMaxAbs) ? Number(kTraceMaxAbs) : undefined);
  const thetaSource = thetaChannel
    ? ("gr_evolve_brick_theta" as const)
    : Number.isFinite(kTraceMean)
      ? ("gr_evolve_brick_neg_k_trace" as const)
      : undefined;
  const betaMaxAbs = maxAbsBeta(
    brick.channels.beta_x,
    brick.channels.beta_y,
    brick.channels.beta_z,
  );

  return {
    updatedAt: Date.now(),
    source: "gr-evolve-brick",
    ...(context?.metricAdapter ? { metricAdapter: context.metricAdapter } : {}),
    ...(brick.meta ? { meta: brick.meta } : {}),
    grid: {
      dims: brick.dims,
      bounds: brick.bounds,
      voxelSize_m: brick.voxelSize_m,
      time_s: brick.time_s,
      dt_s: brick.dt_s,
    },
    solver: {
      steps: brick.stats.steps,
      iterations: brick.stats.iterations,
      tolerance: brick.stats.tolerance,
      cfl: brick.stats.cfl,
      ...(brick.stats.fixups ? { fixups: brick.stats.fixups } : {}),
      ...(brick.stats.solverHealth ? { health: brick.stats.solverHealth } : {}),
    },
    gauge: {
      lapseMin,
      lapseMax,
      betaMaxAbs: Number.isFinite(betaMaxAbs) ? betaMaxAbs : 0,
      betaOverAlphaMax: Number.isFinite(stiffness?.betaOverAlphaMax)
        ? stiffness?.betaOverAlphaMax
        : 0,
      betaOverAlphaP98: Number.isFinite(stiffness?.betaOverAlphaP98)
        ? stiffness?.betaOverAlphaP98
        : 0,
      betaOutwardOverAlphaWallMax:
        wallSafety?.betaOutwardOverAlphaWallMax ?? null,
      betaOutwardOverAlphaWallP98:
        wallSafety?.betaOutwardOverAlphaWallP98 ?? null,
      wallHorizonMargin: wallSafety?.wallHorizonMargin ?? null,
    },
    ...(Number.isFinite(divBetaRms) &&
    Number.isFinite(divBetaMaxAbs) &&
    divBetaSource
      ? {
          divBeta: {
            rms: divBetaRms,
            maxAbs: divBetaMaxAbs,
            source: divBetaSource,
          },
        }
      : {}),
    ...(Number.isFinite(thetaFallbackMean) &&
    Number.isFinite(thetaFallbackMaxAbs) &&
    thetaSource
      ? {
          theta: {
            mean: thetaFallbackMean,
            maxAbs: thetaFallbackMaxAbs,
            source: thetaSource,
          },
        }
      : {}),
    ...(Number.isFinite(kTraceMean) && Number.isFinite(kTraceMaxAbs)
      ? {
          kTrace: {
            mean: kTraceMean,
            maxAbs: kTraceMaxAbs,
            source: "gr_evolve_brick" as const,
          },
        }
      : {}),
    ...(stiffness ? { stiffness } : {}),
    constraints: {
      H_constraint,
      M_constraint: {
        rms: brick.stats.M_rms,
        maxAbs: M_maxAbs,
        components: {
          x: Mx,
          y: My,
          z: Mz,
        },
      },
      ...(brick.stats.rhoConstraint
        ? { rho_constraint: brick.stats.rhoConstraint }
        : {}),
    },
    ...(brick.stats.invariants ? { invariants: brick.stats.invariants } : {}),
    ...(brick.stats.stressEnergy ? { matter: { stressEnergy: brick.stats.stressEnergy } } : {}),
    ...(brick.stats.perf ? { perf: brick.stats.perf } : {}),
  };
};

const clampNumber = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function buildGrEvolveBrick(input: Partial<GrEvolveBrickParams>): GrEvolveBrick {
  const dims: [number, number, number] = input.dims ?? [128, 128, 128];
  const bounds = input.bounds ?? defaultHullBounds();
  const time_s = Math.max(0, clampNumber(input.time_s, 0));
  const dt_s_input = Math.max(0, clampNumber(input.dt_s, 0));
  const steps = Math.max(0, Math.floor(clampNumber(input.steps, 0)));
  const evolveIterations = Math.max(
    0,
    Math.floor(clampNumber(input.iterations, 0)),
  );
  const evolveTolerance = Math.max(0, clampNumber(input.tolerance, 0));
  const koEps = Math.max(0, clampNumber(input.koEps, 0));
  const koTargets = input.koTargets === "all" ? "all" : "gauge";
  const shockMode =
    input.shockMode === "diagnostic" || input.shockMode === "stabilize"
      ? input.shockMode
      : "off";
  const advectScheme = input.advectScheme === "upwind1" ? "upwind1" : "centered";
  const useInitialData = input.useInitialData ?? false;
  const initialIterations = Math.max(
    0,
    Math.floor(clampNumber(input.initialIterations, evolveIterations)),
  );
  const initialTolerance = Math.max(
    0,
    clampNumber(input.initialTolerance, evolveTolerance),
  );
  const iterations = useInitialData ? initialIterations : evolveIterations;
  const tolerance = useInitialData ? initialTolerance : evolveTolerance;
  const includeExtra = input.includeExtra ?? false;
  const includeMatter = input.includeMatter ?? includeExtra;
  const includeKij = input.includeKij ?? includeExtra;
  const includeInvariants = input.includeInvariants ?? includeExtra;
  const invariantWallFraction = Math.min(
    1,
    Math.max(
      0,
      clampNumber(input.invariantWallFraction, INVARIANT_WALL_FRACTION),
    ),
  );
  const invariantBandFraction = Math.min(
    1,
    Math.max(
      0,
      clampNumber(input.invariantBandFraction, INVARIANT_BAND_FRACTION),
    ),
  );
  const invariantSampleMax = Math.max(
    1,
    Math.floor(clampNumber(input.invariantSampleMax, INVARIANT_SAMPLE_MAX)),
  );
  const invariantPercentile = Math.min(
    1,
    Math.max(0, clampNumber(input.invariantPercentile, INVARIANT_P98)),
  );
  const unitSystem = input.unitSystem ?? "SI";
  const dtClamp = clampDtForCfl(dt_s_input, dims, bounds, unitSystem);
  const dt_s = dtClamp.dt_s;
  if (dtClamp.clamped && dt_s_input > 0) {
    console.warn("[gr-evolve-brick] dt_s clamped for CFL stability", {
      dt_s_input,
      dt_s,
      cfl_max: GR_CFL_MAX,
    });
  }
  let initialState = input.initialState ?? buildShiftLapseInitialState(dims, bounds);
  let matter = input.matter ?? null;
  let sourceBrickFromInitialData: StressEnergyStats | undefined;
  let sourceKindFromInitialData: GrEvolveBrick["source"] | undefined;

  if (useInitialData && !initialState) {
    const initial = runInitialDataSolve({
      initialState,
      dims,
      bounds,
      iterations: initialIterations,
      tolerance: initialTolerance,
      stencils: input.stencils,
      unitSystem,
      matter,
      sourceParams: input.sourceParams,
      sourceOptions: input.sourceOptions,
    });
    if (initial.solver.status !== "CERTIFIED") {
      const detail = initial.solver.reason
        ? ` (${initial.solver.reason})`
        : "";
      throw new Error(`GR initial data not certified${detail}`);
    }
    initialState = initial.state;
    matter = initial.matter ?? null;
    sourceBrickFromInitialData = initial.sourceBrick?.stats;
    sourceKindFromInitialData = initial.sourceBrick?.source;
  }

  const perfStart = nowMs();
  const evolveStart = nowMs();
  const evolution = runBssnEvolution({
    dims,
    bounds,
    dt: dt_s,
    steps,
    time_s,
    unitSystem,
    gauge: input.gauge,
    stencils: input.stencils,
    boundary: input.boundary,
    fixups: input.fixups,
    koEps,
    koTargets,
    shockMode,
    advectScheme,
    initialState,
    matter,
    usePipelineMatter: true,
    sourceParams: input.sourceParams,
    sourceOptions: input.sourceOptions,
  });
  const evolveMs = nowMs() - evolveStart;
  const grid = evolution.grid;
  const voxelSize_m: Vec3 = [
    grid.spacing[0],
    grid.spacing[1],
    grid.spacing[2],
  ];
  const minSpacing = Math.max(1e-12, Math.min(...voxelSize_m));
  const dt_geom = unitSystem === "SI" ? toGeometricTime(dt_s) : dt_s;
  const cfl = dt_geom > 0 ? dt_geom / minSpacing : 0;
  const stiffness = computeShiftStiffnessMetrics(evolution.state, input.stencils, {
    cflTarget: GR_CFL_MAX,
  });
  stiffness.shockMode = evolution.shockMode;
  if (evolution.stabilizersApplied?.length) {
    stiffness.stabilizersApplied = evolution.stabilizersApplied;
  }

  const pipelineState = getGlobalPipelineState();
  const includeMatterChannels = includeMatter && !!evolution.matter;
  const brickStart = nowMs();
  const evolutionBrick = buildEvolutionBrick({
    state: evolution.state,
    constraints: evolution.constraints,
    includeConstraints: true,
    includeMatter: includeMatterChannels,
    includeKij,
    includeInvariants,
    matter: evolution.matter ?? null,
    stencils: input.stencils,
    gauge: input.gauge,
    time_s: evolution.time_s,
    dt_s,
  });
  const brickMs = nowMs() - brickStart;
  const evolutionChannels = evolutionBrick.channels;
  const theta = evolutionChannels.theta;
  const hullSupport = resolveHullSupportChannels(
    pipelineState,
    dims,
    bounds,
    input.sourceParams,
    theta,
    Math.max(1e-12, tolerance),
  );

  const alpha = evolutionChannels.alpha ?? buildChannelFromArray(evolution.state.alpha);
  const beta_x = evolutionChannels.beta_x ?? buildChannelFromArray(evolution.state.beta_x);
  const beta_y = evolutionChannels.beta_y ?? buildChannelFromArray(evolution.state.beta_y);
  const beta_z = evolutionChannels.beta_z ?? buildChannelFromArray(evolution.state.beta_z);
  const gamma_xx = evolutionChannels.gamma_xx ?? buildChannelFromArray(evolution.state.gamma_xx);
  const gamma_yy = evolutionChannels.gamma_yy ?? buildChannelFromArray(evolution.state.gamma_yy);
  const gamma_zz = evolutionChannels.gamma_zz ?? buildChannelFromArray(evolution.state.gamma_zz);
  const gamma_xy = evolutionChannels.gamma_xy ?? buildChannelFromArray(evolution.state.gamma_xy);
  const gamma_xz = evolutionChannels.gamma_xz ?? buildChannelFromArray(evolution.state.gamma_xz);
  const gamma_yz = evolutionChannels.gamma_yz ?? buildChannelFromArray(evolution.state.gamma_yz);
  const K_trace = evolutionChannels.K ?? buildChannelFromArray(evolution.state.K);
  const g_tt = evolutionChannels.g_tt;
  const clockRate_static = evolutionChannels.clockRate_static;
  const det_gamma = evolutionChannels.det_gamma;
  const ricci3 = evolutionChannels.ricci3;
  const KijKij = evolutionChannels.KijKij;
  const div_beta = evolutionChannels.div_beta;
  const rhoConstraint = buildRhoConstraintDiagnostics(ricci3, K_trace, KijKij);
  const wallSafety = computeWallShiftLapseSafety({
    state: pipelineState,
    dims,
    bounds,
    sourceParams: input.sourceParams,
    alpha,
    betaX: beta_x,
    betaY: beta_y,
    betaZ: beta_z,
  });
  const kretschmann = evolutionChannels.kretschmann;
  const weylI = evolutionChannels.weylI;
  const ricci4 = evolutionChannels.ricci4;
  const ricci2 = evolutionChannels.ricci2;
  const H_constraint =
    evolutionChannels.H_constraint ?? buildChannelFromArray(evolution.constraints.H);
  const M_constraint_x =
    evolutionChannels.M_constraint_x ?? buildChannelFromArray(evolution.constraints.Mx);
  const M_constraint_y =
    evolutionChannels.M_constraint_y ?? buildChannelFromArray(evolution.constraints.My);
  const M_constraint_z =
    evolutionChannels.M_constraint_z ?? buildChannelFromArray(evolution.constraints.Mz);
  const hull_sdf = hullSupport.hullSdf;
  const tile_support_mask = hullSupport.tileSupportMask;
  const region_class = hullSupport.regionClass ?? undefined;

  const channelOrder: string[] = [...GR_EVOLVE_CHANNEL_ORDER];
  const channels: GrEvolveBrick["channels"] = {
    alpha,
    beta_x,
    beta_y,
    beta_z,
    gamma_xx,
    gamma_yy,
    gamma_zz,
    gamma_xy,
    gamma_xz,
    gamma_yz,
    K_trace,
    H_constraint,
    M_constraint_x,
    M_constraint_y,
    M_constraint_z,
  };

  if (hull_sdf) {
    channels.hull_sdf = hull_sdf;
  }
  if (tile_support_mask) {
    channels.tile_support_mask = tile_support_mask;
  }
  if (region_class) {
    channels.region_class = region_class;
  }

  if (g_tt) channels.g_tt = g_tt;
  if (clockRate_static) channels.clockRate_static = clockRate_static;
  if (theta) channels.theta = theta;
  if (det_gamma) channels.det_gamma = det_gamma;
  if (ricci3) channels.ricci3 = ricci3;
  if (KijKij) channels.KijKij = KijKij;
  if (div_beta) channels.div_beta = div_beta;
  if (kretschmann) channels.kretschmann = kretschmann;
  if (weylI) channels.weylI = weylI;
  if (ricci4) channels.ricci4 = ricci4;
  if (ricci2) channels.ricci2 = ricci2;
  for (const key of [
    "alpha_grad_x",
    "alpha_grad_y",
    "alpha_grad_z",
    "eulerian_accel_geom_x",
    "eulerian_accel_geom_y",
    "eulerian_accel_geom_z",
    "eulerian_accel_geom_mag",
    "beta_over_alpha_mag",
  ] as const) {
    const channel = evolutionChannels[key];
    if (channel) {
      channels[key] = channel;
    }
  }

  if (includeKij) {
    for (const key of GR_EVOLVE_KIJ_CHANNELS) {
      const channel = evolutionChannels[key];
      if (channel) {
        channels[key] = channel;
        channelOrder.push(key);
      }
    }
  }

  if (includeMatterChannels) {
    for (const key of GR_EVOLVE_MATTER_CHANNELS) {
      const channel = evolutionChannels[key];
      if (channel) {
        channels[key] = channel;
        channelOrder.push(key);
      }
    }
  }

  const resolvedChannelOrder = filterChannelOrder(channelOrder, channels);
  const totalVoxels = Math.max(0, dims[0] * dims[1] * dims[2]);
  const channelCount = Math.max(1, resolvedChannelOrder.length);
  const bytesEstimate = totalVoxels * channelCount * 4;
  const totalMs = nowMs() - perfStart;
  const msPerStep = steps > 0 ? evolveMs / steps : 0;

  const time_s_end = evolution.time_s;
  const thetaPeakAbs = maxAbsFromChannel(K_trace);
  const thetaGrowthPerStep = steps > 0 ? thetaPeakAbs / steps : 0;
  const divBetaRms = div_beta
    ? (Number.isFinite(evolutionBrick.stats?.divBetaRms)
        ? evolutionBrick.stats?.divBetaRms
        : rmsFromChannel(div_beta))
    : undefined;
  const divBetaMaxAbs = div_beta
    ? (Number.isFinite(evolutionBrick.stats?.divBetaMaxAbs)
        ? evolutionBrick.stats?.divBetaMaxAbs
        : maxAbsFromChannel(div_beta))
    : undefined;
  const solverHealth = buildSolverHealth(evolution.fixups, steps);
  const clampFraction = computeClampFraction(evolution.fixups, steps);
  if (evolution.fixups) {
    evolution.fixups.clampFraction = clampFraction;
  }
  const brickMeta = buildBrickMeta({
    fixups: evolution.fixups,
    solverHealth,
    stiffness,
    steps,
    dtGeom: dt_geom,
    minSpacing,
  });
  let resolvedBrickMeta = brickMeta;
  for (const reason of hullSupport.reasons) {
    resolvedBrickMeta = appendBrickMetaReason(resolvedBrickMeta, reason);
  }
  const kretschmannStats = includeInvariants
    ? buildInvariantStats(kretschmann, {
        wallFraction: invariantWallFraction,
        bandFraction: invariantBandFraction,
        sampleMax: invariantSampleMax,
        percentile: invariantPercentile,
        useAbs: false,
      })
    : null;
  const ricci4Stats = includeInvariants
    ? buildInvariantStats(ricci4, {
        wallFraction: invariantWallFraction,
        bandFraction: invariantBandFraction,
        sampleMax: invariantSampleMax,
        percentile: invariantPercentile,
        useAbs: true,
      })
    : null;
  const invariantStats: GrInvariantStatsSet | undefined =
    kretschmannStats || ricci4Stats
      ? {
          ...(kretschmannStats ? { kretschmann: kretschmannStats } : {}),
          ...(ricci4Stats ? { ricci4: ricci4Stats } : {}),
        }
      : undefined;

  const stats: GrEvolveBrickStats = {
    steps,
    iterations,
    tolerance,
    cfl: Number.isFinite(cfl) ? cfl : 0,
    H_rms: evolutionBrick.stats?.H_rms ?? rmsFromChannel(H_constraint),
    M_rms: evolutionBrick.stats?.M_rms ?? rmsFromVector(M_constraint_x, M_constraint_y, M_constraint_z),
    ...(Number.isFinite(divBetaRms) ? { divBetaRms } : {}),
    ...(Number.isFinite(divBetaMaxAbs) ? { divBetaMaxAbs } : {}),
    ...(div_beta ? { divBetaSource: "gr_evolve_brick" as const } : {}),
    thetaPeakAbs: Number.isFinite(thetaPeakAbs) ? thetaPeakAbs : 0,
    thetaGrowthPerStep: Number.isFinite(thetaGrowthPerStep) ? thetaGrowthPerStep : 0,
    dissipation: {
      koEpsUsed: evolution.koEpsUsed ?? koEps,
      koTargets: evolution.koTargetsUsed ?? koTargets,
    },
    advectScheme: evolution.advectSchemeUsed ?? advectScheme,
    stiffness,
    wallSafety,
    fixups: evolution.fixups,
    solverHealth,
    ...(rhoConstraint ? { rhoConstraint } : {}),
    ...(invariantStats ? { invariants: invariantStats } : {}),
    stressEnergy: evolution.sourceBrick?.stats ?? sourceBrickFromInitialData,
    perf: {
      totalMs: Number.isFinite(totalMs) ? totalMs : 0,
      evolveMs: Number.isFinite(evolveMs) ? evolveMs : 0,
      brickMs: Number.isFinite(brickMs) ? brickMs : 0,
      voxels: Number.isFinite(totalVoxels) ? totalVoxels : 0,
      channelCount,
      bytesEstimate: Number.isFinite(bytesEstimate) ? bytesEstimate : 0,
      msPerStep: Number.isFinite(msPerStep) ? msPerStep : 0,
    },
  };

  const brick: GrEvolveBrick = {
    dims,
    voxelBytes: 4,
    format: "r32f",
    bounds,
    voxelSize_m,
    time_s: time_s_end,
    dt_s,
    source: evolution.sourceBrick?.source ?? sourceKindFromInitialData,
    channelOrder: resolvedChannelOrder,
    channels,
    stats,
    meta: resolvedBrickMeta,
  };

  if (pipelineState?.grEnabled === true) {
    const metricAdapter = (pipelineState as any)?.warp?.metricAdapter ?? null;
    const diagnostics = buildGrDiagnostics(brick, { metricAdapter });
    pipelineState.gr = diagnostics;
  }

  return brick;
}

const encodeFloat32 = (payload: Float32Array) =>
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("base64");

export const serializeGrEvolveBrick = (brick: GrEvolveBrick): GrEvolveBrickResponse => {
  const channelOrder = brick.channelOrder ? [...brick.channelOrder] : [...GR_EVOLVE_CHANNEL_ORDER];
  const channels: Record<string, GrEvolveBrickResponseChannel> = {};
  for (const key of channelOrder) {
    const channel = brick.channels[key];
    if (!channel) continue;
    channels[key] = {
      data: encodeFloat32(channel.data),
      min: channel.min,
      max: channel.max,
    };
  }
  return {
    kind: "gr-evolve-brick",
    dims: brick.dims,
    voxelBytes: brick.voxelBytes,
    format: brick.format,
    bounds: brick.bounds,
    voxelSize_m: brick.voxelSize_m,
    time_s: brick.time_s,
    dt_s: brick.dt_s,
    ...(brick.source ? { source: brick.source } : {}),
    channelOrder,
    channels: channels as GrEvolveBrickResponse["channels"],
    stats: brick.stats,
    ...(brick.meta ? { meta: brick.meta } : {}),
  };
};

export const serializeGrEvolveBrickBinary = (brick: GrEvolveBrick): GrEvolveBrickBinaryPayload => {
  const channelOrder = brick.channelOrder ? [...brick.channelOrder] : [...GR_EVOLVE_CHANNEL_ORDER];
  const channels = brick.channels;
  const headerChannels: Record<string, { min: number; max: number; bytes: number }> = {};
  const buffers: Buffer[] = [];
  for (const key of channelOrder) {
    const channel = channels[key];
    if (!channel) continue;
    headerChannels[key] = {
      min: channel.min,
      max: channel.max,
      bytes: channel.data.byteLength,
    };
    buffers.push(
      Buffer.from(channel.data.buffer, channel.data.byteOffset, channel.data.byteLength),
    );
  }
  return {
    header: {
      kind: "gr-evolve-brick",
      version: 1,
      dims: brick.dims,
      voxelBytes: brick.voxelBytes,
      format: brick.format,
      bounds: brick.bounds,
      voxelSize_m: brick.voxelSize_m,
      time_s: brick.time_s,
      dt_s: brick.dt_s,
      ...(brick.source ? { source: brick.source } : {}),
      channelOrder,
      channels: headerChannels,
      stats: brick.stats,
      ...(brick.meta ? { meta: brick.meta } : {}),
    },
    buffers,
  };
};
