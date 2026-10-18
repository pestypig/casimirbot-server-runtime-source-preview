import { Buffer } from "node:buffer";
import { C } from "./utils/physics-const-safe.ts";
import { getGlobalPipelineState } from "./energy-pipeline.ts";
import { PROMOTED_WARP_PROFILE } from "../shared/warp-promoted-profile.ts";

export type Vec3 = [number, number, number];

export interface CurvBrickParams {
  dims: [number, number, number];
  bounds: { min: Vec3; max: Vec3 };
  phase01: number;
  sigmaSector: number;
  splitEnabled: boolean;
  splitFrac: number;
  dutyFR: number;
  tauLC_s: number;
  Tm_s: number;
  beta0: number;
  betaMax: number;
  zeta: number;
  q: number;
  gammaGeo: number;
  gammaVdB: number;
  ampBase: number;
  clampQI: boolean;
  edgeWeight?: number;
  edgeSharpness?: number;
  betaShift?: number;
  debugBlockValue?: number;
  debugBlockRadius?: number;
  debugBlockCenter?: Vec3;
  driveDir?: Vec3 | null;
  hullAxes?: Vec3;
  hullWall?: number;
  radialMap?: HullRadialMap | null;
}

export interface CurvatureBrick {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  data: Float32Array;
  min: number;
  max: number;
  qiMargin?: Float32Array;
  qiMin?: number;
  qiMax?: number;
  source?: "pipeline" | "metric" | "unknown";
  proxy?: boolean;
  congruence?: "proxy-only" | "geometry-derived" | "conditional";
  kScale?: number;
  kScaleSource?: string;
}

export type HullRadialMap = {
  nTheta: number;
  nPhi: number;
  radii: Float32Array;
  counts: Uint16Array;
};

const INV_TAU_FLOOR = 1e-12;
const INV_TM_FLOOR = 1e-15;
const CURVATURE_EMA_ALPHA = 0.18;
const CURVATURE_RESIDUAL_MIN = -8.0;
const CURVATURE_RESIDUAL_MAX = 8.0;
const LAMBDA_DEFAULT = 0.25; // meters – tuned to Natário wall scale

const tauWindow = (tauLC: number, Tm: number) => Math.max(tauLC, 5 * Tm);

const firstFinite = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
};

const resolveMetricKScale = (diagnostics?: { kTraceMean?: number; kSquaredMean?: number }) => {
  const trace = firstFinite(diagnostics?.kTraceMean);
  if (trace != null) {
    return { value: Math.abs(trace), source: "warp.metricStressDiagnostics.kTraceMean" };
  }
  const ksq = firstFinite(diagnostics?.kSquaredMean);
  if (ksq != null && ksq >= 0) {
    return { value: Math.sqrt(ksq), source: "warp.metricStressDiagnostics.kSquaredMean" };
  }
  return null;
};

const ellipsoidRadiusAt = (dir: Vec3, axes: Vec3) => {
  const [a, b, c] = axes;
  const [x, y, z] = dir;
  const denom =
    (x * x) / (a * a) +
    (y * y) / (b * b) +
    (z * z) / (c * c);
  if (denom <= 0) return Math.max(a, Math.max(b, c));
  return 1 / Math.sqrt(denom);
};

const normalize = (v: Vec3): Vec3 => {
  const [x, y, z] = v;
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
};

const softClamp = (value: number, limit: number) => {
  if (value <= limit) return value;
  const over = value - limit;
  return limit + over / (1 + over);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const wrap01 = (value: number) => {
  const n = value % 1;
  return n < 0 ? n + 1 : n;
};

const shortestPhaseDelta = (a: number, b: number) => {
  let delta = a - b;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
};

const gaussian = (x: number, sigma: number) => {
  const s = Math.max(sigma, 1e-4);
  const t = x / s;
  return Math.exp(-0.5 * t * t);
};

export const buildHullRadialMapFromPositions = (
  positions: ArrayLike<number>,
  opts?: { nTheta?: number; nPhi?: number; maxSamples?: number },
): HullRadialMap | null => {
  const length = Math.floor((positions?.length ?? 0) / 3);
  if (length <= 0) return null;
  const nTheta = Math.max(8, Math.floor(opts?.nTheta ?? 72));
  const nPhi = Math.max(4, Math.floor(opts?.nPhi ?? 36));
  const totalBins = nTheta * nPhi;
  const radii = new Float32Array(totalBins);
  const counts = new Uint16Array(totalBins);
  const maxSamples = Math.max(1, Math.floor(opts?.maxSamples ?? 20000));
  const step = length > maxSamples ? Math.ceil(length / maxSamples) : 1;
  let used = 0;

  for (let i = 0; i < length; i += step) {
    const base = i * 3;
    const x = Number(positions[base] ?? 0);
    const y = Number(positions[base + 1] ?? 0);
    const z = Number(positions[base + 2] ?? 0);
    const r = Math.hypot(x, y, z);
    if (!Number.isFinite(r) || r < 1e-6) continue;
    const theta01 = wrap01((Math.atan2(z, x) / (2 * Math.PI)) + 0.5);
    const phi = Math.atan2(y, Math.hypot(x, z));
    const phi01 = Math.max(0, Math.min(1, (phi + Math.PI / 2) / Math.PI));
    const ti = Math.min(nTheta - 1, Math.max(0, Math.floor(theta01 * nTheta)));
    const pi = Math.min(nPhi - 1, Math.max(0, Math.floor(phi01 * nPhi)));
    const idx = pi * nTheta + ti;
    radii[idx] += r;
    if (counts[idx] < 0xffff) counts[idx] += 1;
    used += 1;
  }

  if (used === 0) return null;
  for (let i = 0; i < totalBins; i += 1) {
    if (counts[i] > 0) {
      radii[i] /= counts[i];
    }
  }

  return { nTheta, nPhi, radii, counts };
};

export const resolveHullRadius = (dir: Vec3, axes: Vec3, radialMap?: HullRadialMap | null) => {
  const fallback = ellipsoidRadiusAt(dir, axes);
  if (!radialMap) return fallback;
  const theta01 = wrap01((Math.atan2(dir[2], dir[0]) / (2 * Math.PI)) + 0.5);
  const phi = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
  const phi01 = Math.max(0, Math.min(1, (phi + Math.PI / 2) / Math.PI));
  const ti = Math.min(radialMap.nTheta - 1, Math.max(0, Math.floor(theta01 * radialMap.nTheta)));
  const pi = Math.min(radialMap.nPhi - 1, Math.max(0, Math.floor(phi01 * radialMap.nPhi)));
  const idx = pi * radialMap.nTheta + ti;
  if (radialMap.counts[idx] === 0) return fallback;
  const r = radialMap.radii[idx];
  return Number.isFinite(r) && r > 0 ? r : fallback;
};

const defaultHullBounds = () => {
  const state = getGlobalPipelineState();
  const hull = state?.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173, wallThickness_m: 0.45 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return { min, max, axes: [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2] as Vec3, wall: hull.wallThickness_m ?? 0.45 };
};

type DebugBlockMask = {
  value: number;
  x: [number, number];
  y: [number, number];
  z: [number, number];
};

type StampBlend = "set" | "max" | "add";
type StampShape = "box" | "sphere";
export type CurvDebugStamp = {
  enabled: boolean;
  center: [number, number, number];
  size: [number, number, number];
  value: number;
  blend?: StampBlend;
  shape?: StampShape;
};

let activeCurvatureStamp: CurvDebugStamp | null = null;

export const getCurvatureDebugStamp = () => activeCurvatureStamp;

export const setCurvatureDebugStamp = (stamp: CurvDebugStamp | null) => {
  if (stamp && stamp.enabled) {
    activeCurvatureStamp = {
      ...stamp,
      center: [...stamp.center] as [number, number, number],
      size: [...stamp.size] as [number, number, number],
    };
  } else {
    activeCurvatureStamp = null;
  }
};

export const clearCurvatureDebugStamp = () => {
  activeCurvatureStamp = null;
};

const applyCurvatureStamp = (
  brick: Float32Array | Uint8Array,
  dims: [number, number, number],
  stamp: CurvDebugStamp,
) => {
  if (!stamp.enabled) return null;
  const [nx, ny, nz] = dims;
  if (nx <= 0 || ny <= 0 || nz <= 0) return null;
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const clampSize = (value: number) => Math.max(1e-3, Math.min(1, value));
  const center: [number, number, number] = [
    clamp01(stamp.center[0]),
    clamp01(stamp.center[1]),
    clamp01(stamp.center[2]),
  ];
  const size: [number, number, number] = [
    clampSize(stamp.size[0]),
    clampSize(stamp.size[1]),
    clampSize(stamp.size[2]),
  ];
  const ix = Math.floor(center[0] * nx);
  const iy = Math.floor(center[1] * ny);
  const iz = Math.floor(center[2] * nz);
  const wx = Math.max(1, Math.floor(size[0] * nx));
  const wy = Math.max(1, Math.floor(size[1] * ny));
  const wz = Math.max(1, Math.floor(size[2] * nz));
  const x0 = Math.max(0, Math.min(nx - wx, ix - (wx >> 1)));
  const y0 = Math.max(0, Math.min(ny - wy, iy - (wy >> 1)));
  const z0 = Math.max(0, Math.min(nz - wz, iz - (wz >> 1)));
  const blend = stamp.blend ?? "set";
  const shape = stamp.shape ?? "box";
  const sphere = shape === "sphere";
  const value = stamp.value;
  const at = (x: number, y: number, z: number) => z * nx * ny + y * nx + x;
  let wrote = false;
  let minWritten = Number.POSITIVE_INFINITY;
  let maxWritten = Number.NEGATIVE_INFINITY;

  for (let z = 0; z < wz; z++) {
    for (let y = 0; y < wy; y++) {
      for (let x = 0; x < wx; x++) {
        if (sphere) {
          const fx = (x + 0.5) / wx - 0.5;
          const fy = (y + 0.5) / wy - 0.5;
          const fz = (z + 0.5) / wz - 0.5;
          if (fx * fx + fy * fy + fz * fz > 0.25) continue;
        }
        const idx = at(x0 + x, y0 + y, z0 + z);
        const current = brick[idx] as number;
        let next = value;
        if (blend === "max") next = Math.max(current, value);
        else if (blend === "add") next = current + value;
        let stored = next;
        if (brick instanceof Uint8Array) {
          stored = Math.max(0, Math.min(255, Math.round(next)));
        }
        brick[idx] = stored;
        if (stored < minWritten) minWritten = stored;
        if (stored > maxWritten) maxWritten = stored;
        wrote = true;
      }
    }
  }

  if (!wrote) return null;
  return { min: minWritten, max: maxWritten };
};

const qChain = (params: { q: number; gammaGeo: number; gammaVdB: number; zeta: number; ampBase: number }) => {
  const zetaWeight = 0.85 + 0.15 * Math.max(0, Math.min(1, params.zeta));
  const ampBoost = 1 + params.ampBase;
  return Math.pow(Math.max(params.gammaGeo, 1e-6), 3) *
    Math.max(params.q, 0) *
    Math.max(params.gammaVdB, 1e-6) *
    zetaWeight *
    ampBoost;
};

const computeSectorEnvelope = (position: Vec3, phase01: number, params: { sigma: number; splitEnabled: boolean; splitFrac: number }) => {
  const [x, , z] = position;
  const theta = wrap01((Math.atan2(z, x) / (2 * Math.PI)) + 0.5);
  const primaryWeight = gaussian(shortestPhaseDelta(theta, phase01), params.sigma);
  if (!params.splitEnabled) {
    return primaryWeight;
  }
  const secondaryPhase = wrap01(phase01 + 0.5);
  const secondaryWeight = gaussian(shortestPhaseDelta(theta, secondaryPhase), params.sigma);
  const frac = Math.max(0, Math.min(1, params.splitFrac));
  return frac * primaryWeight + (1 - frac) * secondaryWeight;
};

const betaAmplification = (distance: number, params: { tauLC: number; Tm: number; beta0: number; betaMax: number }) => {
  const tauLC = Math.max(params.tauLC, INV_TAU_FLOOR);
  const Tm = Math.max(params.Tm, INV_TM_FLOOR);
  const wallDecay = Math.exp(-Math.max(0, distance) / LAMBDA_DEFAULT);
  const base = params.beta0 * Math.sqrt(tauLC / Tm) * wallDecay;
  return Math.min(params.betaMax, base);
};

const qiAllowance = (kExpect: number, params: { window: number; betaAmp: number }) => {
  const windowGain = Math.sqrt(Math.max(params.window, INV_TAU_FLOOR));
  const betaBudget = Math.max(0.25, 1.1 - 0.1 * Math.min(params.betaAmp, 4));
  return kExpect * windowGain * betaBudget;
};

export function buildCurvatureBrick(input: Partial<CurvBrickParams>): CurvatureBrick {
  const defaults = defaultHullBounds();
  const dims: [number, number, number] = input.dims ?? [128, 128, 128];
  const axes: Vec3 = input.hullAxes ?? defaults.axes;
  const bounds = input.bounds ?? { min: [-axes[0], -axes[1], -axes[2]], max: [axes[0], axes[1], axes[2]] };
  const state = getGlobalPipelineState();
  const metricT00 = Number((state as any)?.warp?.metricT00);
  const metricSource =
    (state as any)?.warp?.metricT00Source ??
    (state as any)?.warp?.stressEnergySource;
  const metricMode = metricSource === "metric" && Number.isFinite(metricT00);
  const metricDiagnostics = (state as any)?.warp?.metricStressDiagnostics as
    | { kTraceMean?: number; kSquaredMean?: number }
    | undefined;
  const metricK = resolveMetricKScale(metricDiagnostics);
  const curvatureMeta = state?.curvatureMeta;
  const brickSource: CurvatureBrick["source"] = (curvatureMeta?.source as CurvatureBrick["source"])
    ?? (metricMode ? "metric" : state ? "pipeline" : "unknown");
  const brickCongruence: CurvatureBrick["congruence"] =
    (curvatureMeta?.congruence as CurvatureBrick["congruence"])
    ?? (metricMode ? "conditional" : "proxy-only");
  const brickProxy =
    typeof curvatureMeta?.proxy === "boolean"
      ? curvatureMeta.proxy
      : brickCongruence !== "geometry-derived";

  const phase01 = wrap01(input.phase01 ?? 0);
  const sigmaSector = Math.max(input.sigmaSector ?? 0.05, 1e-3);
  const splitEnabled = input.splitEnabled ?? false;
  const splitFrac = Math.max(0, Math.min(1, input.splitFrac ?? 0.6));
  const dutyFR = Math.max(input.dutyFR ?? PROMOTED_WARP_PROFILE.dutyShip, 1e-6);
  const tauLC = Math.max(input.tauLC_s ?? defaults.axes[0] / C, INV_TAU_FLOOR);
  const Tm = Math.max(input.Tm_s ?? 1 / (15e9), INV_TM_FLOOR);
  const beta0 = Math.max(input.beta0 ?? 1, 0);
  const betaMax = Math.max(input.betaMax ?? 12, 0.5);
  const zeta = input.zeta ?? 0.84;
  const q = Math.max(input.q ?? 1, 0);
  const gammaGeo = Math.max(input.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo, 1e-6);
  const gammaVdB = Math.max(input.gammaVdB ?? PROMOTED_WARP_PROFILE.gammaVanDenBroeck, 1e-6);
  const ampBase = Math.max(input.ampBase ?? 0, 0);
  const clampQI = input.clampQI ?? true;

  const chain = qChain({ q, gammaGeo, gammaVdB, zeta, ampBase });
  const pipelineKScale = chain * dutyFR;
  const metricKScale = metricMode && metricK ? metricK.value : undefined;
  const kScale = metricKScale ?? pipelineKScale;
  const kScaleSource =
    metricKScale != null ? metricK?.source ?? "warp.metricStressDiagnostics" : "pipeline.q_chain";

  const [nx, ny, nz] = dims;
  const dx = (bounds.max[0] - bounds.min[0]) / nx;
  const dy = (bounds.max[1] - bounds.min[1]) / ny;
  const dz = (bounds.max[2] - bounds.min[2]) / nz;

  const wallSigma = Math.max(input.hullWall ?? defaults.wall, 0.1);
  const axesVec: Vec3 = [axes[0], axes[1], axes[2]];
  const driveDirInput = Array.isArray(input.driveDir) ? (input.driveDir as Vec3) : null;
  const driveDirUnit = driveDirInput ? normalize(driveDirInput) : null;
  const dirBiasEnv = typeof process !== "undefined" ? process.env.HELIX_CURV_DIR_BIAS : undefined;
  const dirBiasValue = dirBiasEnv ? Number(dirBiasEnv) : 0;
  const dirBiasScale = Number.isFinite(dirBiasValue) ? dirBiasValue : 0;
  const dirBiasActive = !!driveDirUnit && dirBiasScale > 0;
  const axesSq: Vec3 = [
    Math.max(axesVec[0] * axesVec[0], 1e-6),
    Math.max(axesVec[1] * axesVec[1], 1e-6),
    Math.max(axesVec[2] * axesVec[2], 1e-6),
  ];
  const invAxesSq: Vec3 = [1 / axesSq[0], 1 / axesSq[1], 1 / axesSq[2]];
  const centers = new Float32Array(nx * ny * nz);
  const qi = clampQI ? new Float32Array(nx * ny * nz) : undefined;

  let idx = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let qiMin = Number.POSITIVE_INFINITY;
  let qiMax = Number.NEGATIVE_INFINITY;

  const expect = kScale; // baseline expectation per voxel prior to envelopes

  const edgeWeight = clamp01(input.edgeWeight ?? 0);
  const edgeSharpness = Math.max(input.edgeSharpness ?? 1.25, 0.1);
  const betaShiftLambda = input.betaShift ?? 0;
  const betaShiftScale =
    betaShiftLambda !== 0 ? betaShiftLambda * clamp01(Math.abs(beta0) / Math.max(betaMax, 1e-6)) : 0;

  const debugBlockValue = Number.isFinite(input.debugBlockValue ?? Number.NaN)
    ? (input.debugBlockValue as number)
    : null;
  const debugBlockRadius = clamp01(input.debugBlockRadius ?? 0);
  const debugBlockCenter: Vec3 = input.debugBlockCenter ?? [0.5, 0.5, 0.5];

  let debugBlock: DebugBlockMask | null = null;
  if (debugBlockValue !== null && debugBlockRadius > 0) {
    const radiusFrac = Math.min(debugBlockRadius, 0.49);
    const centerFrac: Vec3 = [
      clamp01(debugBlockCenter[0] ?? 0.5),
      clamp01(debugBlockCenter[1] ?? 0.5),
      clamp01(debugBlockCenter[2] ?? 0.5),
    ];
    const minFrac: Vec3 = [
      Math.max(0, centerFrac[0] - radiusFrac),
      Math.max(0, centerFrac[1] - radiusFrac),
      Math.max(0, centerFrac[2] - radiusFrac),
    ];
    const maxFrac: Vec3 = [
      Math.min(1, centerFrac[0] + radiusFrac),
      Math.min(1, centerFrac[1] + radiusFrac),
      Math.min(1, centerFrac[2] + radiusFrac),
    ];
    const mkRange = (min: number, max: number, size: number): [number, number] => {
      const lo = Math.max(0, Math.floor(min * size));
      const hi = Math.min(size, Math.ceil(max * size));
      return [lo, hi];
    };
    const xRange = mkRange(minFrac[0], maxFrac[0], nx);
    const yRange = mkRange(minFrac[1], maxFrac[1], ny);
    const zRange = mkRange(minFrac[2], maxFrac[2], nz);
    if (xRange[1] > xRange[0] && yRange[1] > yRange[0] && zRange[1] > zRange[0]) {
      debugBlock = {
        value: debugBlockValue,
        x: xRange,
        y: yRange,
        z: zRange,
      };
    }
  }

  const radialMap = input.radialMap ?? null;

  for (let k = 0; k < nz; k++) {
    const z = bounds.min[2] + (k + 0.5) * dz;
    for (let j = 0; j < ny; j++) {
      const y = bounds.min[1] + (j + 0.5) * dy;
      for (let i = 0; i < nx; i++) {
        const x = bounds.min[0] + (i + 0.5) * dx;
        const pos: Vec3 = [x, y, z];

        if (
          debugBlock &&
          i >= debugBlock.x[0] && i < debugBlock.x[1] &&
          j >= debugBlock.y[0] && j < debugBlock.y[1] &&
          k >= debugBlock.z[0] && k < debugBlock.z[1]
        ) {
          const val = debugBlock.value;
          centers[idx] = val;
          if (qi) {
            const margin = 0;
            qi[idx] = margin;
            if (margin < qiMin) qiMin = margin;
            if (margin > qiMax) qiMax = margin;
          }
          if (val < min) min = val;
          if (val > max) max = val;
          idx++;
          continue;
        }

        const pLen = Math.hypot(x, y, z);
        const dir = pLen > 1e-9 ? ([x / pLen, y / pLen, z / pLen] as Vec3) : ([0, 0, 0] as Vec3);
        const radius = resolveHullRadius(dir, axesVec, radialMap);
        const centerDist = pLen - radius;
        const betaShiftMeters = betaShiftScale !== 0 ? betaShiftScale * radius : 0;
        let shiftedDist = centerDist - betaShiftMeters;
        if (dirBiasActive && driveDirUnit) {
          const nx = x * invAxesSq[0];
          const ny = y * invAxesSq[1];
          const nz = z * invAxesSq[2];
          const normalLen = Math.hypot(nx, ny, nz);
          if (normalLen > 0) {
            const dot = (nx * driveDirUnit[0] + ny * driveDirUnit[1] + nz * driveDirUnit[2]) / normalLen;
            shiftedDist -= dirBiasScale * dot * wallSigma;
          }
        }
        const wallFalloff = Math.exp(-0.5 * Math.pow(shiftedDist / wallSigma, 2));
        let wallEnvelope = wallFalloff;
        if (edgeWeight > 1e-4) {
          const derivMag = (Math.abs(shiftedDist) / (wallSigma * wallSigma)) * wallFalloff;
          const derivNorm = derivMag / (derivMag + 1);
          const edgeBoost = Math.pow(derivNorm, edgeSharpness);
          wallEnvelope = wallFalloff * ((1 - edgeWeight) + edgeWeight * edgeBoost);
        }

        const sectorEnvelope = computeSectorEnvelope(pos, phase01, { sigma: sigmaSector, splitEnabled, splitFrac });
        const envelope = wallEnvelope * sectorEnvelope;
        const kDrive = kScale * envelope;

        const betaAmp = betaAmplification(centerDist, { tauLC, Tm, beta0, betaMax });
        let kVox = kDrive * betaAmp;

        if (clampQI && qi) {
          const window = tauWindow(tauLC, Tm);
          const allow = qiAllowance(expect, { window, betaAmp });
          if (kVox > allow) {
            kVox = softClamp(kVox, allow);
          }
          const margin = allow - kVox;
          qi[idx] = margin;
          if (margin < qiMin) qiMin = margin;
          if (margin > qiMax) qiMax = margin;
        }

        centers[idx] = kVox;
        if (kVox < min) min = kVox;
        if (kVox > max) max = kVox;
        idx++;
      }
    }
  }

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  if (qi && (!Number.isFinite(qiMin) || !Number.isFinite(qiMax))) {
    qiMin = 0;
    qiMax = 0;
  }

  const stamp = activeCurvatureStamp;
  if (stamp?.enabled) {
    const result = applyCurvatureStamp(centers, dims, stamp);
    if (result) {
      if (result.min < min) min = result.min;
      if (result.max > max) max = result.max;
    }
  }

  return {
    dims,
    voxelBytes: 4,
    format: "r32f",
    data: centers,
    min,
    max,
    qiMargin: qi,
    qiMin,
    qiMax,
    kScale,
    kScaleSource,
    source: brickSource,
    proxy: brickProxy,
    congruence: brickCongruence,
  };
}

export interface CurvatureBrickResponse {
  dims: [number, number, number];
  format: "r32f";
  voxelBytes: number;
  source?: "pipeline" | "metric" | "unknown";
  proxy?: boolean;
  congruence?: "proxy-only" | "geometry-derived" | "conditional";
  kScale?: number;
  kScaleSource?: string;
  data: string;
  min: number;
  max: number;
  qiMargin?: string;
  qiMin?: number;
  qiMax?: number;
  emaAlpha?: number;
  residualMin?: number;
  residualMax?: number;
}

export interface CurvatureBrickBinaryHeader {
  kind: "curvature-brick";
  version: 1;
  dims: [number, number, number];
  format: "r32f";
  voxelBytes: number;
  source?: "pipeline" | "metric" | "unknown";
  proxy?: boolean;
  congruence?: "proxy-only" | "geometry-derived" | "conditional";
  kScale?: number;
  kScaleSource?: string;
  min: number;
  max: number;
  dataBytes: number;
  qiMarginBytes: number;
  qiMin?: number;
  qiMax?: number;
  emaAlpha: number;
  residualMin: number;
  residualMax: number;
}

export type CurvatureBrickBinaryPayload = {
  header: CurvatureBrickBinaryHeader;
  data: Buffer;
  qiMargin?: Buffer;
};

export const serializeBrick = (brick: CurvatureBrick): CurvatureBrickResponse => {
  const baseData = Buffer.from(brick.data.buffer, brick.data.byteOffset, brick.data.byteLength).toString("base64");
  const response: CurvatureBrickResponse = {
    dims: brick.dims,
    format: brick.format,
    voxelBytes: brick.voxelBytes,
    source: brick.source ?? "pipeline",
    proxy: brick.proxy ?? true,
    congruence: brick.congruence ?? "proxy-only",
    kScale: Number.isFinite(brick.kScale) ? brick.kScale : undefined,
    kScaleSource: brick.kScaleSource,
    data: baseData,
    min: brick.min,
    max: brick.max,
    emaAlpha: CURVATURE_EMA_ALPHA,
    residualMin: CURVATURE_RESIDUAL_MIN,
    residualMax: CURVATURE_RESIDUAL_MAX,
  };
  if (brick.qiMargin) {
    response.qiMargin = Buffer.from(brick.qiMargin.buffer, brick.qiMargin.byteOffset, brick.qiMargin.byteLength).toString("base64");
    response.qiMin = brick.qiMin;
    response.qiMax = brick.qiMax;
  }
  return response;
};

export const serializeBrickBinary = (brick: CurvatureBrick): CurvatureBrickBinaryPayload => {
  const qiMarginBytes = brick.qiMargin ? brick.qiMargin.byteLength : 0;
  return {
    header: {
      kind: "curvature-brick",
      version: 1,
      dims: brick.dims,
      format: brick.format,
      voxelBytes: brick.voxelBytes,
      source: brick.source ?? "pipeline",
      proxy: brick.proxy ?? true,
      congruence: brick.congruence ?? "proxy-only",
      kScale: Number.isFinite(brick.kScale) ? brick.kScale : undefined,
      kScaleSource: brick.kScaleSource,
      min: brick.min,
      max: brick.max,
      dataBytes: brick.data.byteLength,
      qiMarginBytes,
      qiMin: brick.qiMargin ? brick.qiMin : undefined,
      qiMax: brick.qiMargin ? brick.qiMax : undefined,
      emaAlpha: CURVATURE_EMA_ALPHA,
      residualMin: CURVATURE_RESIDUAL_MIN,
      residualMax: CURVATURE_RESIDUAL_MAX,
    },
    data: Buffer.from(brick.data.buffer, brick.data.byteOffset, brick.data.byteLength),
    qiMargin: brick.qiMargin
      ? Buffer.from(brick.qiMargin.buffer, brick.qiMargin.byteOffset, brick.qiMargin.byteLength)
      : undefined,
  };
};
