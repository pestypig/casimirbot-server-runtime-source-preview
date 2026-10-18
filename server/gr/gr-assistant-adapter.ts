import type {
  GrEvolveBrick,
  GrEvolveBrickChannel,
  GrEvolveBrickResponse,
  GrEvolveBrickResponseChannel,
} from "../gr-evolve-brick.js";
import type { GrPipelineDiagnostics } from "../energy-pipeline.js";

type Vec3 = [number, number, number];

export type MetricSpec = {
  coords: string[];
  g_dd: Array<Array<number | string>>;
  assumptions?: Record<string, Record<string, boolean>>;
  signature?: string;
};

export type GrAssistantSampleInput = {
  ix?: number;
  iy?: number;
  iz?: number;
  x_m?: number;
  y_m?: number;
  z_m?: number;
};

export type GrAssistantSample = {
  ix: number;
  iy: number;
  iz: number;
  x_m: number;
  y_m: number;
  z_m: number;
  t_s: number;
  index: number;
};

type ChannelLike = GrEvolveBrickChannel | GrEvolveBrickResponseChannel;
type BrickLike = GrEvolveBrick | GrEvolveBrickResponse;

const DEFAULT_COORDS = ["t", "x", "y", "z"];

const asFloat32Array = (data: unknown): Float32Array => {
  if (data instanceof Float32Array) return data;
  if (typeof data === "string") {
    const buffer = Buffer.from(data, "base64");
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      Math.floor(buffer.byteLength / 4),
    );
  }
  if (data instanceof Uint8Array) {
    return new Float32Array(
      data.buffer,
      data.byteOffset,
      Math.floor(data.byteLength / 4),
    );
  }
  if (Array.isArray(data)) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      out[i] = Number(data[i] ?? 0);
    }
    return out;
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView & { length?: number };
    const length = typeof view.length === "number" ? view.length : 0;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = Number((view as any)[i] ?? 0);
    }
    return out;
  }
  return new Float32Array();
};

const clampIndex = (value: number, max: number) =>
  Math.min(Math.max(0, Math.floor(value)), Math.max(0, max - 1));

const resolveVoxelSize = (brick: BrickLike): Vec3 => {
  const voxel = brick.voxelSize_m;
  if (voxel && voxel.length === 3) {
    return [voxel[0], voxel[1], voxel[2]];
  }
  const bounds = brick.bounds;
  const dims = brick.dims;
  return [
    (bounds.max[0] - bounds.min[0]) / Math.max(1, dims[0]),
    (bounds.max[1] - bounds.min[1]) / Math.max(1, dims[1]),
    (bounds.max[2] - bounds.min[2]) / Math.max(1, dims[2]),
  ];
};

const resolveSample = (brick: BrickLike, sample?: GrAssistantSampleInput): GrAssistantSample => {
  const dims = brick.dims;
  const bounds = brick.bounds;
  const [dx, dy, dz] = resolveVoxelSize(brick);
  const fallback = {
    ix: Math.floor(dims[0] / 2),
    iy: Math.floor(dims[1] / 2),
    iz: Math.floor(dims[2] / 2),
  };
  const ix =
    sample?.ix !== undefined
      ? clampIndex(sample.ix, dims[0])
      : sample?.x_m !== undefined
        ? clampIndex((sample.x_m - bounds.min[0]) / dx, dims[0])
        : fallback.ix;
  const iy =
    sample?.iy !== undefined
      ? clampIndex(sample.iy, dims[1])
      : sample?.y_m !== undefined
        ? clampIndex((sample.y_m - bounds.min[1]) / dy, dims[1])
        : fallback.iy;
  const iz =
    sample?.iz !== undefined
      ? clampIndex(sample.iz, dims[2])
      : sample?.z_m !== undefined
        ? clampIndex((sample.z_m - bounds.min[2]) / dz, dims[2])
        : fallback.iz;
  const x_m = bounds.min[0] + (ix + 0.5) * dx;
  const y_m = bounds.min[1] + (iy + 0.5) * dy;
  const z_m = bounds.min[2] + (iz + 0.5) * dz;
  const index = ix + dims[0] * (iy + dims[1] * iz);
  return { ix, iy, iz, x_m, y_m, z_m, t_s: brick.time_s, index };
};

const getChannel = (
  brick: BrickLike,
  key: string,
): ChannelLike | undefined => {
  const channels = brick.channels as Record<string, ChannelLike | undefined>;
  return channels[key];
};

const getChannelValue = (channel: ChannelLike, index: number): number => {
  const data = asFloat32Array(channel.data);
  if (index < 0 || index >= data.length) return NaN;
  return data[index] ?? NaN;
};

const channelMaxAbs = (channel?: ChannelLike): number => {
  if (!channel) return 0;
  const min = Number(channel.min);
  const max = Number(channel.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return Math.max(Math.abs(min), Math.abs(max));
};

export const buildMetricSpecFromBrick = (
  brick: BrickLike,
  sample?: GrAssistantSampleInput,
): { metric: MetricSpec; sample: GrAssistantSample } => {
  const resolved = resolveSample(brick, sample);
  const alpha = getChannel(brick, "alpha");
  const betaX = getChannel(brick, "beta_x");
  const betaY = getChannel(brick, "beta_y");
  const betaZ = getChannel(brick, "beta_z");
  const gammaXX = getChannel(brick, "gamma_xx");
  const gammaYY = getChannel(brick, "gamma_yy");
  const gammaZZ = getChannel(brick, "gamma_zz");
  if (!alpha || !betaX || !betaY || !betaZ || !gammaXX || !gammaYY || !gammaZZ) {
    throw new Error("gr-assistant: missing required GR brick channels");
  }

  const alphaVal = getChannelValue(alpha, resolved.index);
  const betaXVal = getChannelValue(betaX, resolved.index);
  const betaYVal = getChannelValue(betaY, resolved.index);
  const betaZVal = getChannelValue(betaZ, resolved.index);
  const gammaXXVal = getChannelValue(gammaXX, resolved.index);
  const gammaYYVal = getChannelValue(gammaYY, resolved.index);
  const gammaZZVal = getChannelValue(gammaZZ, resolved.index);
  const gttChannel = getChannel(brick, "g_tt");
  const gtt =
    gttChannel && Number.isFinite(gttChannel.min) && Number.isFinite(gttChannel.max)
      ? getChannelValue(gttChannel, resolved.index)
      : -alphaVal * alphaVal +
        gammaXXVal * betaXVal * betaXVal +
        gammaYYVal * betaYVal * betaYVal +
        gammaZZVal * betaZVal * betaZVal;
  const gtx = gammaXXVal * betaXVal;
  const gty = gammaYYVal * betaYVal;
  const gtz = gammaZZVal * betaZVal;
  const metric: MetricSpec = {
    coords: [...DEFAULT_COORDS],
    g_dd: [
      [gtt, gtx, gty, gtz],
      [gtx, gammaXXVal, 0, 0],
      [gty, 0, gammaYYVal, 0],
      [gtz, 0, 0, gammaZZVal],
    ],
    assumptions: {},
    signature: "-+++",
  };
  return { metric, sample: resolved };
};

export const buildDiagnosticsFromBrick = (brick: BrickLike): GrPipelineDiagnostics => {
  const stats = brick.stats;
  const H = getChannel(brick, "H_constraint");
  const Mx = getChannel(brick, "M_constraint_x");
  const My = getChannel(brick, "M_constraint_y");
  const Mz = getChannel(brick, "M_constraint_z");
  if (!H || !Mx || !My || !Mz) {
    throw new Error("gr-assistant: missing constraint channels");
  }
  const H_constraint = {
    min: H.min,
    max: H.max,
    maxAbs: Math.max(Math.abs(H.min), Math.abs(H.max)),
    ...(Number.isFinite(stats.H_rms) ? { rms: stats.H_rms } : {}),
  };
  const MxDiag = {
    min: Mx.min,
    max: Mx.max,
    maxAbs: Math.max(Math.abs(Mx.min), Math.abs(Mx.max)),
  };
  const MyDiag = {
    min: My.min,
    max: My.max,
    maxAbs: Math.max(Math.abs(My.min), Math.abs(My.max)),
  };
  const MzDiag = {
    min: Mz.min,
    max: Mz.max,
    maxAbs: Math.max(Math.abs(Mz.min), Math.abs(Mz.max)),
  };
  const M_maxAbs = Math.max(MxDiag.maxAbs, MyDiag.maxAbs, MzDiag.maxAbs);
  const alpha = getChannel(brick, "alpha");
  const betaX = getChannel(brick, "beta_x");
  const betaY = getChannel(brick, "beta_y");
  const betaZ = getChannel(brick, "beta_z");
  const lapseMin = Number.isFinite(alpha?.min) ? (alpha?.min as number) : 0;
  const lapseMax = Number.isFinite(alpha?.max) ? (alpha?.max as number) : 0;
  const betaMaxAbs = Math.max(
    channelMaxAbs(betaX),
    channelMaxAbs(betaY),
    channelMaxAbs(betaZ),
  );

  return {
    updatedAt: Date.now(),
    source: "gr-evolve-brick",
    ...(brick.meta ? { meta: brick.meta } : {}),
    grid: {
      dims: brick.dims,
      bounds: brick.bounds,
      voxelSize_m: brick.voxelSize_m,
      time_s: brick.time_s,
      dt_s: brick.dt_s,
    },
    solver: {
      steps: stats.steps,
      iterations: stats.iterations,
      tolerance: stats.tolerance,
      cfl: stats.cfl,
      ...(stats.fixups ? { fixups: stats.fixups } : {}),
      ...(stats.solverHealth ? { health: stats.solverHealth } : {}),
    },
    gauge: {
      lapseMin,
      lapseMax,
      betaMaxAbs: Number.isFinite(betaMaxAbs) ? betaMaxAbs : 0,
    },
    ...(Number.isFinite(stats.divBetaRms) &&
    Number.isFinite(stats.divBetaMaxAbs) &&
    stats.divBetaSource
      ? {
          divBeta: {
            rms: stats.divBetaRms,
            maxAbs: stats.divBetaMaxAbs,
            source: stats.divBetaSource,
          },
        }
      : {}),
    ...(stats.stiffness ? { stiffness: stats.stiffness } : {}),
    constraints: {
      H_constraint,
      M_constraint: {
        rms: stats.M_rms,
        maxAbs: M_maxAbs,
        components: {
          x: MxDiag,
          y: MyDiag,
          z: MzDiag,
        },
      },
    },
    ...(stats.stressEnergy ? { matter: { stressEnergy: stats.stressEnergy } } : {}),
    ...(stats.perf ? { perf: stats.perf } : {}),
  };
};

export const extractBrickInvariants = (brick: BrickLike): Record<string, unknown> | null => {
  const invariants = brick.stats?.invariants;
  if (!invariants) return null;
  const payload: Record<string, unknown> = {};
  if (invariants.kretschmann) payload.kretschmann = invariants.kretschmann;
  if (invariants.ricci4) payload.ricci4 = invariants.ricci4;
  return Object.keys(payload).length ? payload : null;
};
