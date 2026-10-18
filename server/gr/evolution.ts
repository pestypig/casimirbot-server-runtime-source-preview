import { Buffer } from "node:buffer";
import { getGlobalPipelineState } from "../energy-pipeline.ts";
import type { Vec3 } from "../curvature-brick.ts";
import {
  buildStressEnergyBrick,
  type StressEnergyBrickParams,
} from "../stress-energy-brick.ts";
import { C, G } from "../../shared/physics-const.ts";
import {
  BSSN_FIELD_KEYS,
  createMinkowskiState,
  gridFromBounds,
  type BssnFieldKey,
  type BssnState,
  type GridSpec,
} from "../../modules/gr/bssn-state.ts";
import {
  computeBssnConstraints,
  evolveBssn,
  type GaugeParams,
  type StencilParams,
} from "../../modules/gr/bssn-evolve.ts";
import {
  createStressEnergyFieldSet,
  type StressEnergyFieldSet,
} from "../../modules/gr/stress-energy.ts";

export type GrFieldState = BssnState;
export type GrStressEnergySource = StressEnergyFieldSet;

export interface GrEvolutionParams {
  dims: [number, number, number];
  bounds?: { min: Vec3; max: Vec3 };
  time_s?: number;
  dt_s?: number;
  steps?: number;
  iterations?: number;
  tolerance?: number;
  gauge?: GaugeParams;
  stencils?: StencilParams;
  source?: StressEnergyFieldSet | null;
  sourceParams?: StressEnergySourceParams;
}

export interface GrEvolutionStats {
  steps: number;
  iterations: number;
  tolerance: number;
  cfl: number;
  H_rms: number;
  M_rms: number;
}

export interface GrEvolutionRun {
  state: BssnState;
  source: StressEnergyFieldSet | null;
  constraints: { H: Float32Array; Mx: Float32Array; My: Float32Array; Mz: Float32Array };
  stats: GrEvolutionStats;
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
}

export interface GrEvolutionBrickChannel {
  data: Float32Array;
  min: number;
  max: number;
}

export type GrEvolutionBrickChannels = Record<BssnFieldKey, GrEvolutionBrickChannel> & {
  H_constraint: GrEvolutionBrickChannel;
  M_constraint_x: GrEvolutionBrickChannel;
  M_constraint_y: GrEvolutionBrickChannel;
  M_constraint_z: GrEvolutionBrickChannel;
};

export interface GrEvolutionBrick {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
  channels: GrEvolutionBrickChannels;
  stats: GrEvolutionStats;
}

export interface GrEvolutionBrickResponseChannel {
  data: string;
  min: number;
  max: number;
}

export type GrEvolutionBrickResponseChannels = Record<BssnFieldKey, GrEvolutionBrickResponseChannel> & {
  H_constraint: GrEvolutionBrickResponseChannel;
  M_constraint_x: GrEvolutionBrickResponseChannel;
  M_constraint_y: GrEvolutionBrickResponseChannel;
  M_constraint_z: GrEvolutionBrickResponseChannel;
};

export interface GrEvolutionBrickResponse {
  kind: "gr-evolution-brick";
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
  channels: GrEvolutionBrickResponseChannels;
  stats: GrEvolutionStats;
}

export interface GrEvolutionBrickBinaryHeader {
  kind: "gr-evolution-brick";
  version: 1;
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds: { min: Vec3; max: Vec3 };
  voxelSize_m: Vec3;
  time_s: number;
  dt_s: number;
  channelOrder: typeof GR_EVOLUTION_CHANNEL_ORDER;
  channels: Record<string, { min: number; max: number; bytes: number }>;
  stats: GrEvolutionStats;
}

export type GrEvolutionBrickBinaryPayload = {
  header: GrEvolutionBrickBinaryHeader;
  buffers: Buffer[];
};

export interface StressEnergySourceParams extends Partial<StressEnergyBrickParams> {
  scale?: number;
}

const SI_TO_GEOM = G / (C * C * C * C);

const GR_EVOLUTION_CHANNEL_ORDER = [
  ...BSSN_FIELD_KEYS,
  "H_constraint",
  "M_constraint_x",
  "M_constraint_y",
  "M_constraint_z",
] as const;

const clampNumber = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const defaultHullBounds = () => {
  const state = getGlobalPipelineState();
  const hull = state?.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return { min, max, axes: [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2] as Vec3, wall: hull.wallThickness_m ?? 0.45 };
};

const resolveDutyFR = (state: ReturnType<typeof getGlobalPipelineState> | null) => {
  const duty =
    state?.dutyEffective_FR ??
    (state as any)?.dutyEffectiveFR ??
    state?.dutyShip ??
    state?.dutyCycle;
  return Number.isFinite(duty) ? Math.max(0, Number(duty)) : 0.0025;
};

const encodeFloat32 = (payload: Float32Array) =>
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("base64");

const buildChannelFromArray = (data: Float32Array): GrEvolutionBrickChannel => {
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

const rmsFromChannel = (channel: GrEvolutionBrickChannel) => {
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
  x: GrEvolutionBrickChannel,
  y: GrEvolutionBrickChannel,
  z: GrEvolutionBrickChannel,
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

const resolvePipelineStress = () => {
  const state = getGlobalPipelineState();
  const warpStress = (state as any)?.warp?.stressEnergyTensor;
  return warpStress ?? (state as any)?.stressEnergy ?? null;
};

export const buildStressEnergySourceFromPipeline = (
  grid: GridSpec,
  overrides: StressEnergySourceParams = {},
): StressEnergyFieldSet => {
  const defaults = defaultHullBounds();
  const bounds = overrides.bounds ?? grid.bounds ?? { min: defaults.min, max: defaults.max };
  const state = getGlobalPipelineState();
  const stateMetricT00Raw = Number((state as any)?.warp?.metricT00);
  const metricT00 = Number.isFinite(Number(overrides.metricT00))
    ? Number(overrides.metricT00)
    : Number.isFinite(stateMetricT00Raw)
      ? stateMetricT00Raw
      : undefined;
  const metricT00Source =
    typeof overrides.metricT00Source === "string"
      ? overrides.metricT00Source
      : typeof (state as any)?.warp?.metricT00Source === "string"
        ? String((state as any).warp.metricT00Source)
        : typeof (state as any)?.warp?.stressEnergySource === "string"
          ? String((state as any).warp.stressEnergySource)
          : undefined;
  const metricT00Ref =
    typeof overrides.metricT00Ref === "string"
      ? overrides.metricT00Ref
      : typeof (state as any)?.warp?.metricT00Ref === "string"
        ? String((state as any).warp.metricT00Ref)
        : undefined;
  const params: Partial<StressEnergyBrickParams> = {
    dims: grid.dims,
    bounds,
    hullAxes: overrides.hullAxes ?? defaults.axes,
    hullWall: overrides.hullWall ?? defaults.wall,
    radialMap: overrides.radialMap ?? null,
    phase01: clampNumber(overrides.phase01 ?? state?.phase01 ?? 0, 0),
    sigmaSector: clampNumber(overrides.sigmaSector ?? 0.05, 0.05),
    splitEnabled: overrides.splitEnabled ?? false,
    splitFrac: clampNumber(overrides.splitFrac ?? 0.6, 0.6),
    dutyFR: clampNumber(overrides.dutyFR ?? resolveDutyFR(state), 0.0025),
    q: clampNumber(overrides.q ?? state?.qSpoilingFactor ?? (state as any)?.q ?? 1, 1),
    gammaGeo: clampNumber(overrides.gammaGeo ?? state?.gammaGeo ?? 26, 26),
    gammaVdB: clampNumber(
      overrides.gammaVdB ?? state?.gammaVanDenBroeck ?? (state as any)?.gammaVdB ?? 1,
      1,
    ),
    ampBase: clampNumber(overrides.ampBase ?? 0, 0),
    zeta: clampNumber(overrides.zeta ?? state?.zeta ?? 0.84, 0.84),
    driveDir: overrides.driveDir ?? null,
    metricT00,
    metricT00Source,
    metricT00Ref,
    sourceRedesignMode: overrides.sourceRedesignMode ?? null,
    sourceReformulationMode: overrides.sourceReformulationMode ?? null,
  };

  const brick = buildStressEnergyBrick(params);
  const scale = Number.isFinite(overrides.scale) ? Number(overrides.scale) : SI_TO_GEOM;
  const fields = createStressEnergyFieldSet(grid);
  const total = fields.rho.length;
  const diag = resolvePipelineStress();
  const diagValid =
    Number.isFinite(diag?.T11) &&
    Number.isFinite(diag?.T22) &&
    Number.isFinite(diag?.T33);
  const diagScaled = diagValid
    ? ([diag!.T11 * scale, diag!.T22 * scale, diag!.T33 * scale] as const)
    : null;

  for (let i = 0; i < total; i += 1) {
    const rho = brick.channels.t00.data[i] * scale;
    fields.rho[i] = rho;
    fields.Sx[i] = brick.channels.Sx.data[i] * scale;
    fields.Sy[i] = brick.channels.Sy.data[i] * scale;
    fields.Sz[i] = brick.channels.Sz.data[i] * scale;
    if (diagScaled) {
      fields.S_xx[i] = diagScaled[0];
      fields.S_yy[i] = diagScaled[1];
      fields.S_zz[i] = diagScaled[2];
    } else {
      // Default to w = -1 (Tij = -rho delta_ij) when no tensor is available.
      const pressure = -rho;
      fields.S_xx[i] = pressure;
      fields.S_yy[i] = pressure;
      fields.S_zz[i] = pressure;
    }
    fields.S_xy[i] = 0;
    fields.S_xz[i] = 0;
    fields.S_yz[i] = 0;
  }

  return fields;
};

export const runGrEvolution = (input: Partial<GrEvolutionParams>): GrEvolutionRun => {
  const dims: [number, number, number] = input.dims ?? [128, 128, 128];
  const bounds = input.bounds ?? defaultHullBounds();
  const time_s = Math.max(0, clampNumber(input.time_s, 0));
  const dt_s = Math.max(0, clampNumber(input.dt_s, 0));
  const steps = Math.max(0, Math.floor(clampNumber(input.steps, 0)));
  const iterations = Math.max(0, Math.floor(clampNumber(input.iterations, 0)));
  const tolerance = Math.max(0, clampNumber(input.tolerance, 0));

  const grid = gridFromBounds(dims, bounds);
  const voxelSize_m: Vec3 = [grid.spacing[0], grid.spacing[1], grid.spacing[2]];
  const minSpacing = Math.max(1e-12, Math.min(...voxelSize_m));
  const cfl = dt_s > 0 ? dt_s / minSpacing : 0;

  const state = createMinkowskiState(grid);
  let source = input.source ?? null;
  if (source === null && input.source === undefined) {
    source = buildStressEnergySourceFromPipeline(grid, input.sourceParams);
  }

  if (steps > 0 && dt_s > 0) {
    evolveBssn(state, dt_s, steps, {
      gauge: input.gauge,
      stencils: input.stencils,
      matter: source,
    });
  }

  const constraints = computeBssnConstraints(state, {
    stencils: input.stencils,
    matter: source,
  });

  const H_channel = buildChannelFromArray(constraints.H);
  const Mx_channel = buildChannelFromArray(constraints.Mx);
  const My_channel = buildChannelFromArray(constraints.My);
  const Mz_channel = buildChannelFromArray(constraints.Mz);

  const stats: GrEvolutionStats = {
    steps,
    iterations,
    tolerance,
    cfl: Number.isFinite(cfl) ? cfl : 0,
    H_rms: rmsFromChannel(H_channel),
    M_rms: rmsFromVector(Mx_channel, My_channel, Mz_channel),
  };

  return {
    state,
    source,
    constraints,
    stats,
    bounds,
    voxelSize_m,
    time_s: time_s + (dt_s > 0 ? steps * dt_s : 0),
    dt_s,
  };
};

export const buildGrEvolutionBrick = (
  input: Partial<GrEvolutionParams>,
): GrEvolutionBrick => {
  const run = runGrEvolution(input);
  const channels = {} as GrEvolutionBrickChannels;
  for (const key of BSSN_FIELD_KEYS) {
    channels[key] = buildChannelFromArray(run.state[key]);
  }
  channels.H_constraint = buildChannelFromArray(run.constraints.H);
  channels.M_constraint_x = buildChannelFromArray(run.constraints.Mx);
  channels.M_constraint_y = buildChannelFromArray(run.constraints.My);
  channels.M_constraint_z = buildChannelFromArray(run.constraints.Mz);

  return {
    dims: run.state.grid.dims,
    voxelBytes: 4,
    format: "r32f",
    bounds: run.bounds,
    voxelSize_m: run.voxelSize_m,
    time_s: run.time_s,
    dt_s: run.dt_s,
    channels,
    stats: run.stats,
  };
};

export const serializeGrEvolutionBrick = (
  brick: GrEvolutionBrick,
): GrEvolutionBrickResponse => {
  const channels = {} as GrEvolutionBrickResponseChannels;
  for (const key of BSSN_FIELD_KEYS) {
    const ch = brick.channels[key];
    channels[key] = { data: encodeFloat32(ch.data), min: ch.min, max: ch.max };
  }
  channels.H_constraint = {
    data: encodeFloat32(brick.channels.H_constraint.data),
    min: brick.channels.H_constraint.min,
    max: brick.channels.H_constraint.max,
  };
  channels.M_constraint_x = {
    data: encodeFloat32(brick.channels.M_constraint_x.data),
    min: brick.channels.M_constraint_x.min,
    max: brick.channels.M_constraint_x.max,
  };
  channels.M_constraint_y = {
    data: encodeFloat32(brick.channels.M_constraint_y.data),
    min: brick.channels.M_constraint_y.min,
    max: brick.channels.M_constraint_y.max,
  };
  channels.M_constraint_z = {
    data: encodeFloat32(brick.channels.M_constraint_z.data),
    min: brick.channels.M_constraint_z.min,
    max: brick.channels.M_constraint_z.max,
  };

  return {
    kind: "gr-evolution-brick",
    dims: brick.dims,
    voxelBytes: brick.voxelBytes,
    format: brick.format,
    bounds: brick.bounds,
    voxelSize_m: brick.voxelSize_m,
    time_s: brick.time_s,
    dt_s: brick.dt_s,
    channels,
    stats: brick.stats,
  };
};

export const serializeGrEvolutionBrickBinary = (
  brick: GrEvolutionBrick,
): GrEvolutionBrickBinaryPayload => {
  const channels = brick.channels as Record<string, GrEvolutionBrickChannel>;
  const buffers: Buffer[] = [];
  const headerChannels: Record<string, { min: number; max: number; bytes: number }> = {};

  for (const key of GR_EVOLUTION_CHANNEL_ORDER) {
    const channel = channels[key];
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
      kind: "gr-evolution-brick",
      version: 1,
      dims: brick.dims,
      voxelBytes: brick.voxelBytes,
      format: brick.format,
      bounds: brick.bounds,
      voxelSize_m: brick.voxelSize_m,
      time_s: brick.time_s,
      dt_s: brick.dt_s,
      channelOrder: GR_EVOLUTION_CHANNEL_ORDER,
      channels: headerChannels,
      stats: brick.stats,
    },
    buffers,
  };
};
