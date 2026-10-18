import { Buffer } from "node:buffer";
import {
  BSSN_FIELD_KEYS,
  createBssnRhs,
  type BssnState,
  type GridSpec,
} from "../../../modules/gr/bssn-state.ts";
import type { StressEnergyFieldSet } from "../../../modules/gr/stress-energy.ts";
import {
  buildBssnRhs,
  type ConstraintFields,
  type GaugeParams,
  type StencilParams,
} from "../../../modules/gr/bssn-evolve.ts";
import { diff1, diff2, index3D, type BoundaryMode } from "../../../modules/gr/stencils.ts";
import type { Vec3 } from "../../curvature-brick.ts";

export interface GrEvolutionBrickChannel {
  data: Float32Array;
  min: number;
  max: number;
}

export interface GrEvolutionStats {
  H_rms?: number;
  M_rms?: number;
  H_maxAbs?: number;
  M_maxAbs?: number;
  divBetaRms?: number;
  divBetaMaxAbs?: number;
}

export interface GrEvolutionBrick {
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds?: { min: Vec3; max: Vec3 };
  voxelSize_m?: Vec3;
  time_s?: number;
  dt_s?: number;
  channelOrder: string[];
  channels: Record<string, GrEvolutionBrickChannel>;
  stats?: GrEvolutionStats;
}

export interface GrEvolutionBrickResponseChannel {
  data: string;
  min: number;
  max: number;
}

export interface GrEvolutionBrickResponse {
  kind: "gr-evolution-brick";
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds?: { min: Vec3; max: Vec3 };
  voxelSize_m?: Vec3;
  time_s?: number;
  dt_s?: number;
  channelOrder: string[];
  channels: Record<string, GrEvolutionBrickResponseChannel>;
  stats?: GrEvolutionStats;
}

export interface GrEvolutionBrickBinaryHeader {
  kind: "gr-evolution-brick";
  version: 1;
  dims: [number, number, number];
  voxelBytes: number;
  format: "r32f";
  bounds?: { min: Vec3; max: Vec3 };
  voxelSize_m?: Vec3;
  time_s?: number;
  dt_s?: number;
  channelOrder: string[];
  channels: Record<string, { min: number; max: number; bytes: number }>;
  stats?: GrEvolutionStats;
}

export type GrEvolutionBrickBinaryPayload = {
  header: GrEvolutionBrickBinaryHeader;
  buffers: Buffer[];
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

const rmsFromArray = (data: Float32Array) => {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
};

const maxAbsFromArray = (data: Float32Array) => {
  let maxAbs = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = Math.abs(data[i]);
    if (value > maxAbs) maxAbs = value;
  }
  return maxAbs;
};

const rmsFromVector = (x: Float32Array, y: Float32Array, z: Float32Array) => {
  const len = Math.min(x.length, y.length, z.length);
  if (!len) return 0;
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    const vx = x[i];
    const vy = y[i];
    const vz = z[i];
    sum += vx * vx + vy * vy + vz * vz;
  }
  return Math.sqrt(sum / len);
};

type SymMetric = {
  xx: number;
  yy: number;
  zz: number;
  xy: number;
  xz: number;
  yz: number;
};

const invertSymmetric = (m: SymMetric) => {
  const { xx, yy, zz, xy, xz, yz } = m;
  const a = yy * zz - yz * yz;
  const b = xz * yz - xy * zz;
  const c = xy * yz - xz * yy;
  const d = xx * zz - xz * xz;
  const e = xy * xz - xx * yz;
  const f = xx * yy - xy * xy;
  const det = xx * a + xy * b + xz * c;
  const safeDet = Math.abs(det) > 1e-18 ? det : Math.sign(det || 1) * 1e-18;
  const inv: SymMetric = {
    xx: a / safeDet,
    yy: d / safeDet,
    zz: f / safeDet,
    xy: b / safeDet,
    xz: c / safeDet,
    yz: e / safeDet,
  };
  return { inv, det: safeDet };
};

const SIXTEEN_PI = 16 * Math.PI;
const ALPHA_MIN = 1e-6;
const ALPHA_MAX = 10;
const PHI_ABS_MAX = 10;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type Axis = 0 | 1 | 2;

const wrapIndex = (value: number, size: number) => {
  const mod = value % size;
  return mod < 0 ? mod + size : mod;
};

const clampIndex = (value: number, size: number) =>
  Math.max(0, Math.min(size - 1, value));

const resolveIndex = (value: number, size: number, boundary: BoundaryMode) =>
  boundary === "periodic" ? wrapIndex(value, size) : clampIndex(value, size);

const sampleField = (
  field: Float32Array,
  i: number,
  j: number,
  k: number,
  dims: [number, number, number],
  boundary: BoundaryMode,
) => {
  const ii = resolveIndex(i, dims[0], boundary);
  const jj = resolveIndex(j, dims[1], boundary);
  const kk = resolveIndex(k, dims[2], boundary);
  return field[index3D(ii, jj, kk, dims)];
};

const axisStep = (axis: Axis, spacing: [number, number, number]) =>
  axis === 0 ? spacing[0] : axis === 1 ? spacing[1] : spacing[2];

const normalizeBoundary = (boundary?: BoundaryMode): BoundaryMode =>
  boundary === "periodic" ? "periodic" : "clamp";

const diffMixed = (
  field: Float32Array,
  i: number,
  j: number,
  k: number,
  axisA: Axis,
  axisB: Axis,
  grid: GridSpec,
  boundary: BoundaryMode,
) => {
  const da = axisA === 0 ? 1 : 0;
  const db = axisA === 1 ? 1 : 0;
  const dc = axisA === 2 ? 1 : 0;
  const ea = axisB === 0 ? 1 : 0;
  const eb = axisB === 1 ? 1 : 0;
  const ec = axisB === 2 ? 1 : 0;
  const fpp = sampleField(field, i + da + ea, j + db + eb, k + dc + ec, grid.dims, boundary);
  const fpm = sampleField(field, i + da - ea, j + db - eb, k + dc - ec, grid.dims, boundary);
  const fmp = sampleField(field, i - da + ea, j - db + eb, k - dc + ec, grid.dims, boundary);
  const fmm = sampleField(field, i - da - ea, j - db - eb, k - dc - ec, grid.dims, boundary);
  const dx = axisStep(axisA, grid.spacing);
  const dy = axisStep(axisB, grid.spacing);
  if (dx === 0 || dy === 0) return 0;
  return (fpp - fpm - fmp + fmm) / (4 * dx * dy);
};

const buildExtrinsicCurvature = (state: BssnState) => {
  const total = state.K.length;
  const K_xx = new Float32Array(total);
  const K_yy = new Float32Array(total);
  const K_zz = new Float32Array(total);
  const K_xy = new Float32Array(total);
  const K_xz = new Float32Array(total);
  const K_yz = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const exp4Phi = Math.exp(4 * state.phi[i]);
    const Ktrace = state.K[i];
    const gxx = state.gamma_xx[i];
    const gyy = state.gamma_yy[i];
    const gzz = state.gamma_zz[i];
    const gxy = state.gamma_xy[i];
    const gxz = state.gamma_xz[i];
    const gyz = state.gamma_yz[i];
    const Axx = state.A_xx[i];
    const Ayy = state.A_yy[i];
    const Azz = state.A_zz[i];
    const Axy = state.A_xy[i];
    const Axz = state.A_xz[i];
    const Ayz = state.A_yz[i];
    const kScale = Ktrace / 3;
    K_xx[i] = exp4Phi * (Axx + gxx * kScale);
    K_yy[i] = exp4Phi * (Ayy + gyy * kScale);
    K_zz[i] = exp4Phi * (Azz + gzz * kScale);
    K_xy[i] = exp4Phi * (Axy + gxy * kScale);
    K_xz[i] = exp4Phi * (Axz + gxz * kScale);
    K_yz[i] = exp4Phi * (Ayz + gyz * kScale);
  }
  return { K_xx, K_yy, K_zz, K_xy, K_xz, K_yz };
};

const buildDerivedFields = (state: BssnState) => {
  const total = state.alpha.length;
  const g_tt = new Float32Array(total);
  const clockRate_static = new Float32Array(total);
  const theta = new Float32Array(total);
  const det_gamma = new Float32Array(total);
  let alphaMax = 0;
  let betaMax = 0;
  let gttMin = Number.POSITIVE_INFINITY;
  let gttMax = Number.NEGATIVE_INFINITY;
  const clampAlpha = (raw: number) => {
    if (!Number.isFinite(raw)) return ALPHA_MIN;
    const alphaAbs = Math.abs(raw);
    return clampNumber(alphaAbs, ALPHA_MIN, ALPHA_MAX);
  };
  for (let i = 0; i < total; i += 1) {
    const alpha = clampAlpha(state.alpha[i]);
    if (alpha > alphaMax) alphaMax = alpha;
    const phiRaw = state.phi[i];
    const phi = Number.isFinite(phiRaw) ? clampNumber(phiRaw, -PHI_ABS_MAX, PHI_ABS_MAX) : 0;
    const exp4Phi = Number.isFinite(phi) ? Math.exp(4 * phi) : 1;
    let gxx = exp4Phi * state.gamma_xx[i];
    let gyy = exp4Phi * state.gamma_yy[i];
    let gzz = exp4Phi * state.gamma_zz[i];
    let gxy = exp4Phi * state.gamma_xy[i];
    let gxz = exp4Phi * state.gamma_xz[i];
    let gyz = exp4Phi * state.gamma_yz[i];
    if (
      !Number.isFinite(gxx) ||
      !Number.isFinite(gyy) ||
      !Number.isFinite(gzz) ||
      !Number.isFinite(gxy) ||
      !Number.isFinite(gxz) ||
      !Number.isFinite(gyz)
    ) {
      gxx = 1;
      gyy = 1;
      gzz = 1;
      gxy = 0;
      gxz = 0;
      gyz = 0;
    }
    const bxRaw = state.beta_x[i];
    const byRaw = state.beta_y[i];
    const bzRaw = state.beta_z[i];
    const bx = Number.isFinite(bxRaw) ? bxRaw : 0;
    const by = Number.isFinite(byRaw) ? byRaw : 0;
    const bz = Number.isFinite(bzRaw) ? bzRaw : 0;
    const betaMag = Math.hypot(bx, by, bz);
    if (betaMag > betaMax) betaMax = betaMag;
    let shiftTerm =
      gxx * bx * bx +
      gyy * by * by +
      gzz * bz * bz +
      2 * (gxy * bx * by + gxz * bx * bz + gyz * by * bz);
    if (!Number.isFinite(shiftTerm)) shiftTerm = 0;
    const gttVal = -alpha * alpha + shiftTerm;
    g_tt[i] = Number.isFinite(gttVal) ? gttVal : 0;
    if (Number.isFinite(gttVal)) {
      if (gttVal < gttMin) gttMin = gttVal;
      if (gttVal > gttMax) gttMax = gttVal;
    }
    const clockVal = Math.sqrt(Math.max(0, -g_tt[i]));
    clockRate_static[i] = Number.isFinite(clockVal) ? clockVal : 0;
    const detVal =
      gxx * (gyy * gzz - gyz * gyz) -
      gxy * (gxy * gzz - gxz * gyz) +
      gxz * (gxy * gyz - gxz * gyy);
    det_gamma[i] = Number.isFinite(detVal) ? detVal : 0;
    const thetaVal = -state.K[i];
    theta[i] = Number.isFinite(thetaVal) ? thetaVal : 0;
  }
  const gttAbsMax = Math.max(Math.abs(gttMin), Math.abs(gttMax));
  if (
    alphaMax > 1e-3 &&
    betaMax < 1e-3 &&
    (!Number.isFinite(gttAbsMax) || gttAbsMax < alphaMax * alphaMax * 0.1)
  ) {
    for (let i = 0; i < total; i += 1) {
      const alpha = clampAlpha(state.alpha[i]);
      const gttVal = -alpha * alpha;
      g_tt[i] = Number.isFinite(gttVal) ? gttVal : 0;
      const clockVal = Math.sqrt(Math.max(0, -g_tt[i]));
      clockRate_static[i] = Number.isFinite(clockVal) ? clockVal : 0;
    }
  }
  return { g_tt, clockRate_static, theta, det_gamma };
};

const buildLapseGradientFields = (
  state: BssnState,
  stencils?: StencilParams,
) => {
  const total = state.alpha.length;
  const alpha_grad_x = new Float32Array(total);
  const alpha_grad_y = new Float32Array(total);
  const alpha_grad_z = new Float32Array(total);
  const eulerian_accel_geom_x = new Float32Array(total);
  const eulerian_accel_geom_y = new Float32Array(total);
  const eulerian_accel_geom_z = new Float32Array(total);
  const eulerian_accel_geom_mag = new Float32Array(total);
  const beta_over_alpha_mag = new Float32Array(total);
  const div_beta = new Float32Array(total);
  const grid = state.grid;
  const [nx, ny, nz] = grid.dims;
  const order = stencils?.order ?? 2;
  const boundary = normalizeBoundary(stencils?.boundary);
  const stencil = { order, boundary };
  let idx = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const gradX = diff1(state.alpha, i, j, k, 0, grid, stencil);
        const gradY = diff1(state.alpha, i, j, k, 1, grid, stencil);
        const gradZ = diff1(state.alpha, i, j, k, 2, grid, stencil);
        alpha_grad_x[idx] = Number.isFinite(gradX) ? gradX : 0;
        alpha_grad_y[idx] = Number.isFinite(gradY) ? gradY : 0;
        alpha_grad_z[idx] = Number.isFinite(gradZ) ? gradZ : 0;
        const alphaRaw = state.alpha[idx];
        const alphaSafe = clampNumber(
          Number.isFinite(alphaRaw) ? Math.abs(alphaRaw) : ALPHA_MIN,
          ALPHA_MIN,
          ALPHA_MAX,
        );
        const accelX = alpha_grad_x[idx] / alphaSafe;
        const accelY = alpha_grad_y[idx] / alphaSafe;
        const accelZ = alpha_grad_z[idx] / alphaSafe;
        eulerian_accel_geom_x[idx] = Number.isFinite(accelX) ? accelX : 0;
        eulerian_accel_geom_y[idx] = Number.isFinite(accelY) ? accelY : 0;
        eulerian_accel_geom_z[idx] = Number.isFinite(accelZ) ? accelZ : 0;
        const accelMag = Math.hypot(
          eulerian_accel_geom_x[idx],
          eulerian_accel_geom_y[idx],
          eulerian_accel_geom_z[idx],
        );
        eulerian_accel_geom_mag[idx] = Number.isFinite(accelMag) ? accelMag : 0;
        const betaMag = Math.hypot(state.beta_x[idx], state.beta_y[idx], state.beta_z[idx]);
        const ratio = betaMag / alphaSafe;
        beta_over_alpha_mag[idx] = Number.isFinite(ratio) ? ratio : 0;
        const divBeta =
          diff1(state.beta_x, i, j, k, 0, grid, stencil) +
          diff1(state.beta_y, i, j, k, 1, grid, stencil) +
          diff1(state.beta_z, i, j, k, 2, grid, stencil);
        div_beta[idx] = Number.isFinite(divBeta) ? divBeta : 0;
        idx += 1;
      }
    }
  }
  return {
    alpha_grad_x,
    alpha_grad_y,
    alpha_grad_z,
    eulerian_accel_geom_x,
    eulerian_accel_geom_y,
    eulerian_accel_geom_z,
    eulerian_accel_geom_mag,
    beta_over_alpha_mag,
    div_beta,
  };
};

const buildCurvatureScalars = (
  state: BssnState,
  constraints?: ConstraintFields | null,
  matter?: StressEnergyFieldSet | null,
) => {
  const total = state.K.length;
  const ricci3 = new Float32Array(total);
  const kijKij = new Float32Array(total);
  const H = constraints?.H ?? null;
  const rho = matter?.rho ?? null;
  for (let i = 0; i < total; i += 1) {
    const gamma: SymMetric = {
      xx: state.gamma_xx[i],
      yy: state.gamma_yy[i],
      zz: state.gamma_zz[i],
      xy: state.gamma_xy[i],
      xz: state.gamma_xz[i],
      yz: state.gamma_yz[i],
    };
    const { inv } = invertSymmetric(gamma);

    const Axx = state.A_xx[i];
    const Ayy = state.A_yy[i];
    const Azz = state.A_zz[i];
    const Axy = state.A_xy[i];
    const Axz = state.A_xz[i];
    const Ayz = state.A_yz[i];

    const Aup00 = inv.xx * Axx + inv.xy * Axy + inv.xz * Axz;
    const Aup01 = inv.xx * Axy + inv.xy * Ayy + inv.xz * Ayz;
    const Aup02 = inv.xx * Axz + inv.xy * Ayz + inv.xz * Azz;
    const Aup10 = inv.xy * Axx + inv.yy * Axy + inv.yz * Axz;
    const Aup11 = inv.xy * Axy + inv.yy * Ayy + inv.yz * Ayz;
    const Aup12 = inv.xy * Axz + inv.yy * Ayz + inv.yz * Azz;
    const Aup20 = inv.xz * Axx + inv.yz * Axy + inv.zz * Axz;
    const Aup21 = inv.xz * Axy + inv.yz * Ayy + inv.zz * Ayz;
    const Aup22 = inv.xz * Axz + inv.yz * Ayz + inv.zz * Azz;

    const Aupup00 = Aup00 * inv.xx + Aup01 * inv.xy + Aup02 * inv.xz;
    const Aupup01 = Aup00 * inv.xy + Aup01 * inv.yy + Aup02 * inv.yz;
    const Aupup02 = Aup00 * inv.xz + Aup01 * inv.yz + Aup02 * inv.zz;
    const Aupup11 = Aup10 * inv.xy + Aup11 * inv.yy + Aup12 * inv.yz;
    const Aupup12 = Aup10 * inv.xz + Aup11 * inv.yz + Aup12 * inv.zz;
    const Aupup22 = Aup20 * inv.xz + Aup21 * inv.yz + Aup22 * inv.zz;

    const A2 =
      Axx * Aupup00 +
      Ayy * Aupup11 +
      Azz * Aupup22 +
      2 * (Axy * Aupup01 + Axz * Aupup02 + Ayz * Aupup12);

    const K = state.K[i];
    const K2 = K * K;
    const kijVal = A2 + K2 / 3;
    kijKij[i] = Number.isFinite(kijVal) ? kijVal : 0;

    if (H) {
      const rhoVal = rho ? rho[i] : 0;
      const R3 = H[i] - (2 / 3) * K2 + A2 + SIXTEEN_PI * rhoVal;
      ricci3[i] = Number.isFinite(R3) ? R3 : 0;
    } else {
      ricci3[i] = 0;
    }
  }
  return { ricci3, kijKij };
};

const buildRiemannInvariants = (
  state: BssnState,
  options: {
    stencils?: StencilParams;
    gauge?: GaugeParams;
    matter?: StressEnergyFieldSet | null;
  } = {},
) => {
  const grid = state.grid;
  const dims = grid.dims;
  const [nx, ny, nz] = dims;
  const total = state.alpha.length;
  const order = options.stencils?.order ?? 2;
  const boundary = normalizeBoundary(options.stencils?.boundary);
  const stencil = { order, boundary };

  const g_xx = new Float32Array(total);
  const g_yy = new Float32Array(total);
  const g_zz = new Float32Array(total);
  const g_xy = new Float32Array(total);
  const g_xz = new Float32Array(total);
  const g_yz = new Float32Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    const phi = state.phi[idx];
    const exp4Phi = Number.isFinite(phi) ? Math.exp(4 * phi) : 1;
    g_xx[idx] = exp4Phi * state.gamma_xx[idx];
    g_yy[idx] = exp4Phi * state.gamma_yy[idx];
    g_zz[idx] = exp4Phi * state.gamma_zz[idx];
    g_xy[idx] = exp4Phi * state.gamma_xy[idx];
    g_xz[idx] = exp4Phi * state.gamma_xz[idx];
    g_yz[idx] = exp4Phi * state.gamma_yz[idx];
  }

  const Kfields = buildExtrinsicCurvature(state);
  const rhs = createBssnRhs(state.grid);
  const rhsFn = buildBssnRhs({
    gauge: options.gauge,
    stencils: options.stencils,
    matter: options.matter ?? null,
  });
  rhsFn(state, rhs);

  const kretschmann = new Float32Array(total);
  const weylI = new Float32Array(total);
  const ricci4 = new Float32Array(total);
  const ricci2 = new Float32Array(total);

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const idx = index3D(i, j, k, dims);
        const alpha = state.alpha[idx];
        const invAlpha =
          Number.isFinite(alpha) && alpha > 1e-6 ? 1 / alpha : 0;

        const gxx = g_xx[idx];
        const gyy = g_yy[idx];
        const gzz = g_zz[idx];
        const gxy = g_xy[idx];
        const gxz = g_xz[idx];
        const gyz = g_yz[idx];

        const g = { xx: gxx, yy: gyy, zz: gzz, xy: gxy, xz: gxz, yz: gyz };
        const { inv: gInv } = invertSymmetric(g);
        const gInvMat = [
          [gInv.xx, gInv.xy, gInv.xz],
          [gInv.xy, gInv.yy, gInv.yz],
          [gInv.xz, gInv.yz, gInv.zz],
        ];
        const gMat = [
          [gxx, gxy, gxz],
          [gxy, gyy, gyz],
          [gxz, gyz, gzz],
        ];

        const dG = [
          [
            diff1(g_xx, i, j, k, 0, grid, stencil),
            diff1(g_yy, i, j, k, 0, grid, stencil),
            diff1(g_zz, i, j, k, 0, grid, stencil),
            diff1(g_xy, i, j, k, 0, grid, stencil),
            diff1(g_xz, i, j, k, 0, grid, stencil),
            diff1(g_yz, i, j, k, 0, grid, stencil),
          ],
          [
            diff1(g_xx, i, j, k, 1, grid, stencil),
            diff1(g_yy, i, j, k, 1, grid, stencil),
            diff1(g_zz, i, j, k, 1, grid, stencil),
            diff1(g_xy, i, j, k, 1, grid, stencil),
            diff1(g_xz, i, j, k, 1, grid, stencil),
            diff1(g_yz, i, j, k, 1, grid, stencil),
          ],
          [
            diff1(g_xx, i, j, k, 2, grid, stencil),
            diff1(g_yy, i, j, k, 2, grid, stencil),
            diff1(g_zz, i, j, k, 2, grid, stencil),
            diff1(g_xy, i, j, k, 2, grid, stencil),
            diff1(g_xz, i, j, k, 2, grid, stencil),
            diff1(g_yz, i, j, k, 2, grid, stencil),
          ],
        ] as const;

        const dGComp = (axis: number, a: number, b: number) => {
          const row = dG[axis];
          if (a === b) {
            if (a === 0) return row[0];
            if (a === 1) return row[1];
            return row[2];
          }
          if ((a === 0 && b === 1) || (a === 1 && b === 0)) return row[3];
          if ((a === 0 && b === 2) || (a === 2 && b === 0)) return row[4];
          return row[5];
        };

        const Gamma = [
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        ];

        for (let ii = 0; ii < 3; ii += 1) {
          for (let jj = 0; jj < 3; jj += 1) {
            for (let kk = 0; kk < 3; kk += 1) {
              let sum = 0;
              for (let ll = 0; ll < 3; ll += 1) {
                const d1 = dGComp(jj, kk, ll);
                const d2 = dGComp(kk, jj, ll);
                const d3 = dGComp(ll, jj, kk);
                sum += gInvMat[ii][ll] * (d1 + d2 - d3);
              }
              Gamma[ii][jj][kk] = 0.5 * sum;
            }
          }
        }

        const GammaLower = [
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        ];
        for (let ii = 0; ii < 3; ii += 1) {
          for (let jj = 0; jj < 3; jj += 1) {
            for (let kk = 0; kk < 3; kk += 1) {
              let sum = 0;
              for (let ll = 0; ll < 3; ll += 1) {
                sum += gMat[ii][ll] * Gamma[ll][jj][kk];
              }
              GammaLower[ii][jj][kk] = sum;
            }
          }
        }

        const dAlpha = [
          diff1(state.alpha, i, j, k, 0, grid, stencil),
          diff1(state.alpha, i, j, k, 1, grid, stencil),
          diff1(state.alpha, i, j, k, 2, grid, stencil),
        ] as const;

        const ddAlpha = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            if (aa === bb) {
              ddAlpha[aa][bb] = diff2(state.alpha, i, j, k, aa as Axis, grid, stencil);
            } else {
              ddAlpha[aa][bb] = diffMixed(state.alpha, i, j, k, aa as Axis, bb as Axis, grid, boundary);
            }
          }
        }

        const DAlpha = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let corr = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              corr += Gamma[cc][aa][bb] * dAlpha[cc];
            }
            DAlpha[aa][bb] = ddAlpha[aa][bb] - corr;
          }
        }

        const Kxx = Kfields.K_xx[idx];
        const Kyy = Kfields.K_yy[idx];
        const Kzz = Kfields.K_zz[idx];
        const Kxy = Kfields.K_xy[idx];
        const Kxz = Kfields.K_xz[idx];
        const Kyz = Kfields.K_yz[idx];

        const Kmat = [
          [Kxx, Kxy, Kxz],
          [Kxy, Kyy, Kyz],
          [Kxz, Kyz, Kzz],
        ];

        const dK = [
          [
            diff1(Kfields.K_xx, i, j, k, 0, grid, stencil),
            diff1(Kfields.K_yy, i, j, k, 0, grid, stencil),
            diff1(Kfields.K_zz, i, j, k, 0, grid, stencil),
            diff1(Kfields.K_xy, i, j, k, 0, grid, stencil),
            diff1(Kfields.K_xz, i, j, k, 0, grid, stencil),
            diff1(Kfields.K_yz, i, j, k, 0, grid, stencil),
          ],
          [
            diff1(Kfields.K_xx, i, j, k, 1, grid, stencil),
            diff1(Kfields.K_yy, i, j, k, 1, grid, stencil),
            diff1(Kfields.K_zz, i, j, k, 1, grid, stencil),
            diff1(Kfields.K_xy, i, j, k, 1, grid, stencil),
            diff1(Kfields.K_xz, i, j, k, 1, grid, stencil),
            diff1(Kfields.K_yz, i, j, k, 1, grid, stencil),
          ],
          [
            diff1(Kfields.K_xx, i, j, k, 2, grid, stencil),
            diff1(Kfields.K_yy, i, j, k, 2, grid, stencil),
            diff1(Kfields.K_zz, i, j, k, 2, grid, stencil),
            diff1(Kfields.K_xy, i, j, k, 2, grid, stencil),
            diff1(Kfields.K_xz, i, j, k, 2, grid, stencil),
            diff1(Kfields.K_yz, i, j, k, 2, grid, stencil),
          ],
        ] as const;

        const dKComp = (axis: number, a: number, b: number) => {
          const row = dK[axis];
          if (a === b) {
            if (a === 0) return row[0];
            if (a === 1) return row[1];
            return row[2];
          }
          if ((a === 0 && b === 1) || (a === 1 && b === 0)) return row[3];
          if ((a === 0 && b === 2) || (a === 2 && b === 0)) return row[4];
          return row[5];
        };

        const beta = [state.beta_x[idx], state.beta_y[idx], state.beta_z[idx]];
        const dBeta = [
          [
            diff1(state.beta_x, i, j, k, 0, grid, stencil),
            diff1(state.beta_x, i, j, k, 1, grid, stencil),
            diff1(state.beta_x, i, j, k, 2, grid, stencil),
          ],
          [
            diff1(state.beta_y, i, j, k, 0, grid, stencil),
            diff1(state.beta_y, i, j, k, 1, grid, stencil),
            diff1(state.beta_y, i, j, k, 2, grid, stencil),
          ],
          [
            diff1(state.beta_z, i, j, k, 0, grid, stencil),
            diff1(state.beta_z, i, j, k, 1, grid, stencil),
            diff1(state.beta_z, i, j, k, 2, grid, stencil),
          ],
        ] as const;

        const lieBetaK = (a: number, b: number) => {
          const adv =
            beta[0] * dKComp(0, a, b) +
            beta[1] * dKComp(1, a, b) +
            beta[2] * dKComp(2, a, b);
          let shiftTerm = 0;
          for (let kk = 0; kk < 3; kk += 1) {
            shiftTerm += Kmat[a][kk] * dBeta[kk][b] + Kmat[kk][b] * dBeta[kk][a];
          }
          return adv + shiftTerm;
        };

        const phi = state.phi[idx];
        const exp4Phi = Number.isFinite(phi) ? Math.exp(4 * phi) : 1;
        const Ktrace = state.K[idx];
        const kThird = Ktrace / 3;
        const Axx = state.A_xx[idx];
        const Ayy = state.A_yy[idx];
        const Azz = state.A_zz[idx];
        const Axy = state.A_xy[idx];
        const Axz = state.A_xz[idx];
        const Ayz = state.A_yz[idx];
        const gtxx = state.gamma_xx[idx];
        const gtyy = state.gamma_yy[idx];
        const gtzz = state.gamma_zz[idx];
        const gtxy = state.gamma_xy[idx];
        const gtxz = state.gamma_xz[idx];
        const gtyz = state.gamma_yz[idx];
        const dPhi = rhs.phi[idx];
        const dKtrace = rhs.K[idx];
        const dAxx = rhs.A_xx[idx];
        const dAyy = rhs.A_yy[idx];
        const dAzz = rhs.A_zz[idx];
        const dAxy = rhs.A_xy[idx];
        const dAxz = rhs.A_xz[idx];
        const dAyz = rhs.A_yz[idx];
        const dGxx = rhs.gamma_xx[idx];
        const dGyy = rhs.gamma_yy[idx];
        const dGzz = rhs.gamma_zz[idx];
        const dGxy = rhs.gamma_xy[idx];
        const dGxz = rhs.gamma_xz[idx];
        const dGyz = rhs.gamma_yz[idx];

        const baseKxx = Axx + gtxx * kThird;
        const baseKyy = Ayy + gtyy * kThird;
        const baseKzz = Azz + gtzz * kThird;
        const baseKxy = Axy + gtxy * kThird;
        const baseKxz = Axz + gtxz * kThird;
        const baseKyz = Ayz + gtyz * kThird;

        const dtKxx =
          exp4Phi *
          (dAxx + dGxx * kThird + gtxx * dKtrace / 3 + 4 * dPhi * baseKxx);
        const dtKyy =
          exp4Phi *
          (dAyy + dGyy * kThird + gtyy * dKtrace / 3 + 4 * dPhi * baseKyy);
        const dtKzz =
          exp4Phi *
          (dAzz + dGzz * kThird + gtzz * dKtrace / 3 + 4 * dPhi * baseKzz);
        const dtKxy =
          exp4Phi *
          (dAxy + dGxy * kThird + gtxy * dKtrace / 3 + 4 * dPhi * baseKxy);
        const dtKxz =
          exp4Phi *
          (dAxz + dGxz * kThird + gtxz * dKtrace / 3 + 4 * dPhi * baseKxz);
        const dtKyz =
          exp4Phi *
          (dAyz + dGyz * kThird + gtyz * dKtrace / 3 + 4 * dPhi * baseKyz);

        const LnK = [
          [
            invAlpha * (dtKxx - lieBetaK(0, 0)),
            invAlpha * (dtKxy - lieBetaK(0, 1)),
            invAlpha * (dtKxz - lieBetaK(0, 2)),
          ],
          [
            invAlpha * (dtKxy - lieBetaK(1, 0)),
            invAlpha * (dtKyy - lieBetaK(1, 1)),
            invAlpha * (dtKyz - lieBetaK(1, 2)),
          ],
          [
            invAlpha * (dtKxz - lieBetaK(2, 0)),
            invAlpha * (dtKyz - lieBetaK(2, 1)),
            invAlpha * (dtKzz - lieBetaK(2, 2)),
          ],
        ];

        const Kmixed = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let sum = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              sum += gInvMat[aa][cc] * Kmat[cc][bb];
            }
            Kmixed[aa][bb] = sum;
          }
        }

        const Kupup = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let sum = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              for (let dd = 0; dd < 3; dd += 1) {
                sum += gInvMat[aa][cc] * gInvMat[bb][dd] * Kmat[cc][dd];
              }
            }
            Kupup[aa][bb] = sum;
          }
        }

        const K2mixed = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let sum = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              sum += Kmixed[aa][cc] * Kmixed[cc][bb];
            }
            K2mixed[aa][bb] = sum;
          }
        }

        const K2up = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let sum = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              sum += Kmixed[aa][cc] * Kupup[cc][bb];
            }
            K2up[aa][bb] = sum;
          }
        }

        let trKijKij = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            trKijKij += Kmat[aa][bb] * Kupup[aa][bb];
          }
        }

        const K2mixed2 = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let sum = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              sum += K2mixed[aa][cc] * K2mixed[cc][bb];
            }
            K2mixed2[aa][bb] = sum;
          }
        }
        let trK4 = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          trK4 += K2mixed2[aa][aa];
        }

        const Rnn = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let kTerm = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              kTerm += Kmat[aa][cc] * Kmixed[cc][bb];
            }
            Rnn[aa][bb] = -LnK[aa][bb] + kTerm + invAlpha * DAlpha[aa][bb];
          }
        }

        const Dk = [
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        ];
        for (let jj = 0; jj < 3; jj += 1) {
          for (let aa = 0; aa < 3; aa += 1) {
            for (let bb = 0; bb < 3; bb += 1) {
              let val = dKComp(jj, aa, bb);
              for (let ll = 0; ll < 3; ll += 1) {
                val -= Gamma[ll][aa][jj] * Kmat[ll][bb];
                val -= Gamma[ll][bb][jj] * Kmat[aa][ll];
              }
              Dk[jj][aa][bb] = val;
            }
          }
        }

        const Rnijk = [
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            for (let cc = 0; cc < 3; cc += 1) {
              Rnijk[aa][bb][cc] = Dk[bb][aa][cc] - Dk[cc][aa][bb];
            }
          }
        }

        const R3 = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        const d2g = (axisA: Axis, axisB: Axis, a: number, b: number) => {
          const field =
            a === b
              ? a === 0
                ? g_xx
                : a === 1
                  ? g_yy
                  : g_zz
              : (a === 0 && b === 1) || (a === 1 && b === 0)
                ? g_xy
                : (a === 0 && b === 2) || (a === 2 && b === 0)
                  ? g_xz
                  : g_yz;
          if (axisA === axisB) {
            return diff2(field, i, j, k, axisA, grid, stencil);
          }
          return diffMixed(field, i, j, k, axisA, axisB, grid, boundary);
        };

        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let term1 = 0;
            for (let kk = 0; kk < 3; kk += 1) {
              for (let ll = 0; ll < 3; ll += 1) {
                const t1 = d2g(kk as Axis, bb as Axis, aa, ll);
                const t2 = d2g(kk as Axis, aa as Axis, bb, ll);
                const t3 = d2g(aa as Axis, bb as Axis, kk, ll);
                const t4 = d2g(kk as Axis, ll as Axis, aa, bb);
                term1 += gInvMat[kk][ll] * (t1 + t2 - t3 - t4);
              }
            }
            term1 *= 0.5;

            let term2 = 0;
            for (let kk = 0; kk < 3; kk += 1) {
              for (let ll = 0; ll < 3; ll += 1) {
                for (let mm = 0; mm < 3; mm += 1) {
                  term2 +=
                    gInvMat[kk][ll] *
                    (Gamma[mm][aa][bb] * GammaLower[mm][kk][ll] -
                      Gamma[mm][aa][kk] * GammaLower[mm][bb][ll]);
                }
              }
            }

            R3[aa][bb] = term1 + term2;
          }
        }

        let R3scalar = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            R3scalar += gInvMat[aa][bb] * R3[aa][bb];
          }
        }

        let R3ijR3ij = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let up = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              for (let dd = 0; dd < 3; dd += 1) {
                up += gInvMat[aa][cc] * gInvMat[bb][dd] * R3[cc][dd];
              }
            }
            R3ijR3ij += R3[aa][bb] * up;
          }
        }

        let R3Kij = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            R3Kij += R3[aa][bb] * Kupup[aa][bb];
          }
        }

        let R3K2ij = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            R3K2ij += R3[aa][bb] * K2up[aa][bb];
          }
        }

        const QSq = 4 * R3ijR3ij - R3scalar * R3scalar;
        const QP =
          4 * Ktrace * R3Kij -
          4 * R3K2ij -
          R3scalar * (Ktrace * Ktrace - trKijKij);
        const PSq = 2 * trKijKij * trKijKij - 2 * trK4;
        const RijklSq = QSq + 2 * QP + PSq;

        let RnnSq = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let up = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              for (let dd = 0; dd < 3; dd += 1) {
                up += gInvMat[aa][cc] * gInvMat[bb][dd] * Rnn[cc][dd];
              }
            }
            RnnSq += Rnn[aa][bb] * up;
          }
        }

        let RnijkSq = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            for (let cc = 0; cc < 3; cc += 1) {
              let up = 0;
              for (let dd = 0; dd < 3; dd += 1) {
                for (let ee = 0; ee < 3; ee += 1) {
                  for (let ff = 0; ff < 3; ff += 1) {
                    up += gInvMat[aa][dd] * gInvMat[bb][ee] * gInvMat[cc][ff] * Rnijk[dd][ee][ff];
                  }
                }
              }
              RnijkSq += Rnijk[aa][bb][cc] * up;
            }
          }
        }

        const Kret = RijklSq + 4 * RnnSq - 4 * RnijkSq;

        let RnnTrace = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            RnnTrace += gInvMat[aa][bb] * Rnn[aa][bb];
          }
        }

        const Rni = [0, 0, 0];
        for (let aa = 0; aa < 3; aa += 1) {
          let sum = 0;
          for (let bb = 0; bb < 3; bb += 1) {
            for (let cc = 0; cc < 3; cc += 1) {
              sum += gInvMat[bb][cc] * Rnijk[bb][cc][aa];
            }
          }
          Rni[aa] = -sum;
        }

        const R4ij = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let spatial = R3[aa][bb] + Ktrace * Kmat[aa][bb];
            let kMix = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              kMix += Kmat[aa][cc] * Kmixed[cc][bb];
            }
            spatial -= kMix;
            R4ij[aa][bb] = spatial - Rnn[aa][bb];
          }
        }

        let R4scalar = -RnnTrace;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            R4scalar += gInvMat[aa][bb] * R4ij[aa][bb];
          }
        }

        let R4ijR4ij = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          for (let bb = 0; bb < 3; bb += 1) {
            let up = 0;
            for (let cc = 0; cc < 3; cc += 1) {
              for (let dd = 0; dd < 3; dd += 1) {
                up += gInvMat[aa][cc] * gInvMat[bb][dd] * R4ij[cc][dd];
              }
            }
            R4ijR4ij += R4ij[aa][bb] * up;
          }
        }

        let RniDot = 0;
        for (let aa = 0; aa < 3; aa += 1) {
          let raised = 0;
          for (let bb = 0; bb < 3; bb += 1) {
            raised += gInvMat[aa][bb] * Rni[bb];
          }
          RniDot += Rni[aa] * raised;
        }

        const Ricci2 = RnnTrace * RnnTrace - 2 * RniDot + R4ijR4ij;
        const WeylI = Kret - 2 * Ricci2 + (R4scalar * R4scalar) / 3;

        kretschmann[idx] = Number.isFinite(Kret) ? Kret : 0;
        weylI[idx] = Number.isFinite(WeylI) ? WeylI : 0;
        ricci4[idx] = Number.isFinite(R4scalar) ? R4scalar : 0;
        ricci2[idx] = Number.isFinite(Ricci2) ? Ricci2 : 0;
      }
    }
  }

  return { kretschmann, weylI, ricci4, ricci2 };
};

const buildStats = (
  constraints?: ConstraintFields | null,
  divBeta?: Float32Array | null,
): GrEvolutionStats | undefined => {
  const stats: GrEvolutionStats = {};
  if (constraints) {
    stats.H_rms = rmsFromArray(constraints.H);
    stats.M_rms = rmsFromVector(constraints.Mx, constraints.My, constraints.Mz);
    stats.H_maxAbs = maxAbsFromArray(constraints.H);
    stats.M_maxAbs = Math.max(
      maxAbsFromArray(constraints.Mx),
      maxAbsFromArray(constraints.My),
      maxAbsFromArray(constraints.Mz),
    );
  }
  if (divBeta) {
    stats.divBetaRms = rmsFromArray(divBeta);
    stats.divBetaMaxAbs = maxAbsFromArray(divBeta);
  }
  return Object.keys(stats).length ? stats : undefined;
};

const gridVoxelSize = (grid: GridSpec): Vec3 => [
  grid.spacing[0],
  grid.spacing[1],
  grid.spacing[2],
];

export interface BuildEvolutionBrickParams {
  state: BssnState;
  constraints?: ConstraintFields | null;
  matter?: StressEnergyFieldSet | null;
  includeMatter?: boolean;
  includeConstraints?: boolean;
  includeKij?: boolean;
  includeInvariants?: boolean;
  stencils?: StencilParams;
  gauge?: GaugeParams;
  time_s?: number;
  dt_s?: number;
}

export const buildEvolutionBrick = ({
  state,
  constraints,
  matter,
  includeMatter = false,
  includeConstraints = true,
  includeKij = false,
  includeInvariants = false,
  stencils,
  gauge,
  time_s,
  dt_s,
}: BuildEvolutionBrickParams): GrEvolutionBrick => {
  const channels: Record<string, GrEvolutionBrickChannel> = {};
  const channelOrder: string[] = [];
  for (const key of BSSN_FIELD_KEYS) {
    channels[key] = buildChannelFromArray(state[key]);
    channelOrder.push(key);
  }
  const derived = buildDerivedFields(state);
  const lapseGradient = buildLapseGradientFields(state, stencils);
  channels.g_tt = buildChannelFromArray(derived.g_tt);
  channelOrder.push("g_tt");
  channels.clockRate_static = buildChannelFromArray(derived.clockRate_static);
  channelOrder.push("clockRate_static");
  channels.theta = buildChannelFromArray(derived.theta);
  channelOrder.push("theta");
  channels.det_gamma = buildChannelFromArray(derived.det_gamma);
  channelOrder.push("det_gamma");
  channels.alpha_grad_x = buildChannelFromArray(lapseGradient.alpha_grad_x);
  channels.alpha_grad_y = buildChannelFromArray(lapseGradient.alpha_grad_y);
  channels.alpha_grad_z = buildChannelFromArray(lapseGradient.alpha_grad_z);
  channels.eulerian_accel_geom_x = buildChannelFromArray(lapseGradient.eulerian_accel_geom_x);
  channels.eulerian_accel_geom_y = buildChannelFromArray(lapseGradient.eulerian_accel_geom_y);
  channels.eulerian_accel_geom_z = buildChannelFromArray(lapseGradient.eulerian_accel_geom_z);
  channels.eulerian_accel_geom_mag = buildChannelFromArray(lapseGradient.eulerian_accel_geom_mag);
  channels.beta_over_alpha_mag = buildChannelFromArray(lapseGradient.beta_over_alpha_mag);
  channels.div_beta = buildChannelFromArray(lapseGradient.div_beta);
  channelOrder.push(
    "alpha_grad_x",
    "alpha_grad_y",
    "alpha_grad_z",
    "eulerian_accel_geom_x",
    "eulerian_accel_geom_y",
    "eulerian_accel_geom_z",
    "eulerian_accel_geom_mag",
    "beta_over_alpha_mag",
    "div_beta",
  );
  const curvature = buildCurvatureScalars(state, constraints ?? null, matter ?? null);
  channels.ricci3 = buildChannelFromArray(curvature.ricci3);
  channelOrder.push("ricci3");
  channels.KijKij = buildChannelFromArray(curvature.kijKij);
  channelOrder.push("KijKij");
  if (includeInvariants) {
    const invariants = buildRiemannInvariants(state, { stencils, gauge, matter: matter ?? null });
    channels.kretschmann = buildChannelFromArray(invariants.kretschmann);
    channelOrder.push("kretschmann");
    channels.weylI = buildChannelFromArray(invariants.weylI);
    channelOrder.push("weylI");
    channels.ricci4 = buildChannelFromArray(invariants.ricci4);
    channelOrder.push("ricci4");
    channels.ricci2 = buildChannelFromArray(invariants.ricci2);
    channelOrder.push("ricci2");
  }
  if (includeKij) {
    const derived = buildExtrinsicCurvature(state);
    for (const [key, data] of Object.entries(derived)) {
      channels[key] = buildChannelFromArray(data);
      channelOrder.push(key);
    }
  }
  if (includeMatter && matter) {
    const keys = [
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
    for (const key of keys) {
      channels[key] = buildChannelFromArray(matter[key]);
      channelOrder.push(key);
    }
  }
  if (includeConstraints && constraints) {
    channels.H_constraint = buildChannelFromArray(constraints.H);
    channels.M_constraint_x = buildChannelFromArray(constraints.Mx);
    channels.M_constraint_y = buildChannelFromArray(constraints.My);
    channels.M_constraint_z = buildChannelFromArray(constraints.Mz);
    channelOrder.push(
      "H_constraint",
      "M_constraint_x",
      "M_constraint_y",
      "M_constraint_z",
    );
  }
  return {
    dims: state.grid.dims,
    voxelBytes: 4,
    format: "r32f",
    bounds: state.grid.bounds,
    voxelSize_m: gridVoxelSize(state.grid),
    time_s,
    dt_s,
    channelOrder,
    channels,
    stats: buildStats(constraints, lapseGradient.div_beta),
  };
};

export const serializeEvolutionBrick = (
  brick: GrEvolutionBrick,
): GrEvolutionBrickResponse => {
  const channels: Record<string, GrEvolutionBrickResponseChannel> = {};
  for (const key of brick.channelOrder) {
    const channel = brick.channels[key];
    channels[key] = {
      data: encodeFloat32(channel.data),
      min: channel.min,
      max: channel.max,
    };
  }
  return {
    kind: "gr-evolution-brick",
    dims: brick.dims,
    voxelBytes: brick.voxelBytes,
    format: brick.format,
    bounds: brick.bounds,
    voxelSize_m: brick.voxelSize_m,
    time_s: brick.time_s,
    dt_s: brick.dt_s,
    channelOrder: brick.channelOrder,
    channels,
    stats: brick.stats,
  };
};

export const serializeEvolutionBrickBinary = (
  brick: GrEvolutionBrick,
): GrEvolutionBrickBinaryPayload => {
  const headerChannels: Record<string, { min: number; max: number; bytes: number }> = {};
  const buffers: Buffer[] = [];
  for (const key of brick.channelOrder) {
    const channel = brick.channels[key];
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
      channelOrder: brick.channelOrder,
      channels: headerChannels,
      stats: brick.stats,
    },
    buffers,
  };
};
