import { Buffer } from "node:buffer";
import type { Vec3 } from "./curvature-brick";
import { getGlobalPipelineState } from "./energy-pipeline";
import {
  buildStressEnergyBrick,
  type StressEnergyBrickParams,
} from "./stress-energy-brick";
import { C, G } from "../shared/physics-const.js";

export interface LapseBrickParams extends StressEnergyBrickParams {
  iterations?: number;
  tolerance?: number;
}

export interface LapseBrickChannel {
  data: Float32Array;
  min: number;
  max: number;
}

export interface LapseBrickStats {
  iterations: number;
  residual: number;
  phiMin: number;
  phiMax: number;
  gttMin: number;
  gttMax: number;
  alphaMin: number;
  alphaMax: number;
  boundary: "dirichlet_zero";
  solver: "jacobi";
}

export interface LapseBrickBounds {
  min: Vec3;
  max: Vec3;
  center?: Vec3;
  extent?: Vec3;
  axes?: Vec3;
  wall?: number;
}

export interface LapseBrick {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  channels: {
    phi: LapseBrickChannel;
    g_tt: LapseBrickChannel;
    alpha: LapseBrickChannel;
    hullDist?: LapseBrickChannel;
    hullMask?: LapseBrickChannel;
  };
  stats: LapseBrickStats;
  bounds?: LapseBrickBounds;
  meta?: unknown;
}

export interface LapseBrickResponseChannel {
  data: string;
  min: number;
  max: number;
}

export interface LapseBrickResponse {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  channels: {
    phi: LapseBrickResponseChannel;
    g_tt: LapseBrickResponseChannel;
    alpha: LapseBrickResponseChannel;
    hullDist?: LapseBrickResponseChannel;
    hullMask?: LapseBrickResponseChannel;
  };
  stats: LapseBrickStats;
  bounds?: LapseBrickBounds;
  meta?: unknown;
}

export interface LapseBrickBinaryHeader {
  kind: "lapse-brick";
  version: 1;
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  channels: {
    phi: { min: number; max: number; bytes: number };
    g_tt: { min: number; max: number; bytes: number };
    alpha: { min: number; max: number; bytes: number };
    hullDist?: { min: number; max: number; bytes: number };
    hullMask?: { min: number; max: number; bytes: number };
  };
  stats: LapseBrickStats;
  bounds?: LapseBrickBounds;
  meta?: unknown;
}

export type LapseBrickBinaryPayload = {
  header: LapseBrickBinaryHeader;
  buffers: Buffer[];
};

const C2 = C * C;
const FOUR_PI_G = 4 * Math.PI * G;
const EPS = 1e-12;

const encodeFloat32 = (payload: Float32Array) =>
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("base64");

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

const axisIndex = (x: number, y: number, z: number, nx: number, ny: number) =>
  z * nx * ny + y * nx + x;

const solvePoissonJacobi = (
  rho: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dy: number,
  dz: number,
  iterations: number,
  tolerance: number,
) => {
  const total = nx * ny * nz;
  let phi = new Float32Array(total);
  let scratch = new Float32Array(total);
  if (nx < 3 || ny < 3 || nz < 3 || iterations <= 0) {
    return { phi, iterations: 0, residual: 0 };
  }
  const invDx2 = 1 / Math.max(dx * dx, EPS);
  const invDy2 = 1 / Math.max(dy * dy, EPS);
  const invDz2 = 1 / Math.max(dz * dz, EPS);
  const denom = 2 * (invDx2 + invDy2 + invDz2);

  let residual = 0;
  let it = 0;
  for (it = 0; it < iterations; it += 1) {
    scratch.fill(0);
    residual = 0;
    for (let z = 1; z < nz - 1; z += 1) {
      for (let y = 1; y < ny - 1; y += 1) {
        for (let x = 1; x < nx - 1; x += 1) {
          const idx = axisIndex(x, y, z, nx, ny);
          const phiX = (phi[idx - 1] + phi[idx + 1]) * invDx2;
          const phiY = (phi[idx - nx] + phi[idx + nx]) * invDy2;
          const phiZ = (phi[idx - nx * ny] + phi[idx + nx * ny]) * invDz2;
          const rhs = FOUR_PI_G * rho[idx];
          const next = (phiX + phiY + phiZ - rhs) / denom;
          scratch[idx] = next;
          const delta = Math.abs(next - phi[idx]);
          if (delta > residual) residual = delta;
        }
      }
    }
    const tmp = phi;
    phi = scratch;
    scratch = tmp;
    if (tolerance > 0 && residual < tolerance) break;
  }

  return { phi, iterations: it + 1, residual };
};

export function buildLapseBrick(input: Partial<LapseBrickParams>): LapseBrick {
  const defaults = defaultHullBounds();
  const dims: [number, number, number] = input.dims ?? [128, 128, 128];
  const bounds = input.bounds ?? { min: defaults.min, max: defaults.max };
  const hullAxes = input.hullAxes ?? defaults.axes;
  const hullWall = input.hullWall ?? defaults.wall;
  const radialMap = input.radialMap ?? null;
  const iterations = Math.max(0, Math.floor(input.iterations ?? 120));
  const tolerance = Math.max(0, input.tolerance ?? 0);

  const stressParams: Partial<StressEnergyBrickParams> = {
    dims,
    bounds,
    hullAxes,
    hullWall,
    radialMap: radialMap ?? undefined,
    phase01: input.phase01 ?? 0,
    sigmaSector: input.sigmaSector ?? 0.05,
    splitEnabled: input.splitEnabled ?? false,
    splitFrac: input.splitFrac ?? 0.6,
    dutyFR: input.dutyFR ?? 0.0025,
    q: input.q ?? 1,
    gammaGeo: input.gammaGeo ?? 26,
    gammaVdB: input.gammaVdB ?? 1,
    ampBase: input.ampBase ?? 0,
    zeta: input.zeta ?? 0.84,
    driveDir: input.driveDir ?? undefined,
  };

  const stress = buildStressEnergyBrick(stressParams);
  const t00 = stress.channels.t00.data;
  const rho = new Float32Array(t00.length);
  for (let i = 0; i < t00.length; i += 1) {
    rho[i] = t00[i] / C2;
  }

  const [nx, ny, nz] = dims;
  const dx = (bounds.max[0] - bounds.min[0]) / nx;
  const dy = (bounds.max[1] - bounds.min[1]) / ny;
  const dz = (bounds.max[2] - bounds.min[2]) / nz;

  const solved = solvePoissonJacobi(rho, nx, ny, nz, dx, dy, dz, iterations, tolerance);
  const phi = solved.phi;
  const gtt = new Float32Array(phi.length);
  const alpha = new Float32Array(phi.length);

  let phiMin = Number.POSITIVE_INFINITY;
  let phiMax = Number.NEGATIVE_INFINITY;
  let gttMin = Number.POSITIVE_INFINITY;
  let gttMax = Number.NEGATIVE_INFINITY;
  let alphaMin = Number.POSITIVE_INFINITY;
  let alphaMax = Number.NEGATIVE_INFINITY;

  const twoOverC2 = 2 / C2;
  for (let i = 0; i < phi.length; i += 1) {
    const phiVal = phi[i];
    const gttVal = -(1 + twoOverC2 * phiVal);
    const lapse = Math.sqrt(Math.max(0, -gttVal));
    gtt[i] = gttVal;
    alpha[i] = lapse;
    if (phiVal < phiMin) phiMin = phiVal;
    if (phiVal > phiMax) phiMax = phiVal;
    if (gttVal < gttMin) gttMin = gttVal;
    if (gttVal > gttMax) gttMax = gttVal;
    if (lapse < alphaMin) alphaMin = lapse;
    if (lapse > alphaMax) alphaMax = lapse;
  }

  if (!Number.isFinite(phiMin)) phiMin = 0;
  if (!Number.isFinite(phiMax)) phiMax = 0;
  if (!Number.isFinite(gttMin)) gttMin = 0;
  if (!Number.isFinite(gttMax)) gttMax = 0;
  if (!Number.isFinite(alphaMin)) alphaMin = 0;
  if (!Number.isFinite(alphaMax)) alphaMax = 0;

  const extent: Vec3 = [
    (bounds.max[0] - bounds.min[0]) * 0.5,
    (bounds.max[1] - bounds.min[1]) * 0.5,
    (bounds.max[2] - bounds.min[2]) * 0.5,
  ];
  const boundsInfo: LapseBrickBounds = {
    min: bounds.min,
    max: bounds.max,
    center: [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ],
    extent,
    axes: [
      Math.max(1e-6, Math.abs(extent[0])),
      Math.max(1e-6, Math.abs(extent[1])),
      Math.max(1e-6, Math.abs(extent[2])),
    ],
    wall: hullWall,
  };

  return {
    dims,
    voxelBytes: 4,
    format: "r32f",
    channels: {
      phi: { data: phi, min: phiMin, max: phiMax },
      g_tt: { data: gtt, min: gttMin, max: gttMax },
      alpha: { data: alpha, min: alphaMin, max: alphaMax },
    },
    stats: {
      iterations: solved.iterations,
      residual: solved.residual,
      phiMin,
      phiMax,
      gttMin,
      gttMax,
      alphaMin,
      alphaMax,
      boundary: "dirichlet_zero",
      solver: "jacobi",
    },
    bounds: boundsInfo,
  };
}

export const serializeLapseBrick = (brick: LapseBrick): LapseBrickResponse => ({
  dims: brick.dims,
  voxelBytes: brick.voxelBytes,
  format: brick.format,
  channels: {
    phi: { data: encodeFloat32(brick.channels.phi.data), min: brick.channels.phi.min, max: brick.channels.phi.max },
    g_tt: { data: encodeFloat32(brick.channels.g_tt.data), min: brick.channels.g_tt.min, max: brick.channels.g_tt.max },
    alpha: { data: encodeFloat32(brick.channels.alpha.data), min: brick.channels.alpha.min, max: brick.channels.alpha.max },
    ...(brick.channels.hullDist
      ? { hullDist: { data: encodeFloat32(brick.channels.hullDist.data), min: brick.channels.hullDist.min, max: brick.channels.hullDist.max } }
      : {}),
    ...(brick.channels.hullMask
      ? { hullMask: { data: encodeFloat32(brick.channels.hullMask.data), min: brick.channels.hullMask.min, max: brick.channels.hullMask.max } }
      : {}),
  },
  stats: brick.stats,
  bounds: brick.bounds,
  meta: brick.meta,
});

export const serializeLapseBrickBinary = (brick: LapseBrick): LapseBrickBinaryPayload => {
  const phi = brick.channels.phi;
  const gtt = brick.channels.g_tt;
  const alpha = brick.channels.alpha;
  const hullDist = brick.channels.hullDist;
  const hullMask = brick.channels.hullMask;
  const buffers = [
    Buffer.from(phi.data.buffer, phi.data.byteOffset, phi.data.byteLength),
    Buffer.from(gtt.data.buffer, gtt.data.byteOffset, gtt.data.byteLength),
    Buffer.from(alpha.data.buffer, alpha.data.byteOffset, alpha.data.byteLength),
  ];
  if (hullDist) {
    buffers.push(Buffer.from(hullDist.data.buffer, hullDist.data.byteOffset, hullDist.data.byteLength));
  }
  if (hullMask) {
    buffers.push(Buffer.from(hullMask.data.buffer, hullMask.data.byteOffset, hullMask.data.byteLength));
  }
  return {
    header: {
      kind: "lapse-brick",
      version: 1,
      dims: brick.dims,
      voxelBytes: brick.voxelBytes,
      format: brick.format,
      channels: {
        phi: { min: phi.min, max: phi.max, bytes: phi.data.byteLength },
        g_tt: { min: gtt.min, max: gtt.max, bytes: gtt.data.byteLength },
        alpha: { min: alpha.min, max: alpha.max, bytes: alpha.data.byteLength },
        ...(hullDist ? { hullDist: { min: hullDist.min, max: hullDist.max, bytes: hullDist.data.byteLength } } : {}),
        ...(hullMask ? { hullMask: { min: hullMask.min, max: hullMask.max, bytes: hullMask.data.byteLength } } : {}),
      },
      stats: brick.stats,
      bounds: brick.bounds,
      meta: brick.meta,
    },
    buffers,
  };
};
