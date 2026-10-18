import {
  createStressEnergyFieldSet,
  type StressEnergyFieldSet,
} from "../../../modules/gr/stress-energy.ts";
import type { GridSpec } from "../../../modules/gr/bssn-state.ts";
import {
  buildStressEnergyBrick,
  type StressEnergyBrick,
  type StressEnergyBrickParams,
} from "../../stress-energy-brick.ts";
import { getGlobalPipelineState } from "../../energy-pipeline.ts";
import type { HullRadialMap, Vec3 } from "../../curvature-brick.ts";
import { resolveStressScale, type GrUnitSystem } from "../../../shared/gr-units.ts";

export interface StressEnergyBuildOptions {
  densityScale?: number;
  momentumScale?: number;
  pressureFactor?: number;
  unitSystem?: GrUnitSystem;
  anisotropyStrength?: number;
  anisotropyMode?: "flux" | "radial";
  enforceNetFlux?: boolean;
  conservationDamping?: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const resolveGridBounds = (grid: GridSpec): { min: Vec3; max: Vec3 } => {
  if (grid.bounds) return grid.bounds;
  const [nx, ny, nz] = grid.dims;
  const [dx, dy, dz] = grid.spacing;
  const halfX = (nx * dx) / 2;
  const halfY = (ny * dy) / 2;
  const halfZ = (nz * dz) / 2;
  return {
    min: [-halfX, -halfY, -halfZ],
    max: [halfX, halfY, halfZ],
  };
};

const resolveConservationScale = (
  damping: number,
  divRmsNorm: number,
): number => {
  if (damping <= 0) return 1;
  const norm = Math.max(0, divRmsNorm);
  return 1 / (1 + damping * norm);
};

export const buildStressEnergyFieldSetFromBrick = (
  grid: GridSpec,
  brick: StressEnergyBrick,
  options: StressEnergyBuildOptions = {},
): StressEnergyFieldSet => {
  const fields = createStressEnergyFieldSet(grid);
  const unitScale = resolveStressScale(options.unitSystem);
  const densityScale = (options.densityScale ?? 1) * unitScale;
  const pressureFactor = options.pressureFactor ?? -1;
  const anisotropyStrength = clamp01(options.anisotropyStrength ?? 0);
  const anisotropyMode = options.anisotropyMode ?? "flux";
  const enforceNetFlux = options.enforceNetFlux === true;
  const conservationDamping = Math.max(0, options.conservationDamping ?? 0);
  const divRmsNorm = brick.stats.conservation?.divRmsNorm ?? 0;
  const conservationScale = resolveConservationScale(
    conservationDamping,
    divRmsNorm,
  );
  const momentumScale =
    (options.momentumScale ?? 1) * unitScale * conservationScale;
  const fluxOffset = enforceNetFlux
    ? (brick.stats.netFlux ?? [0, 0, 0])
    : ([0, 0, 0] as Vec3);
  const rhoIn = brick.channels.t00.data;
  const sxIn = brick.channels.Sx.data;
  const syIn = brick.channels.Sy.data;
  const szIn = brick.channels.Sz.data;

  const bounds = anisotropyStrength > 0 ? resolveGridBounds(grid) : null;
  const [nx, ny, nz] = grid.dims;
  const [dx, dy, dz] = grid.spacing;
  const centerX = bounds ? (bounds.min[0] + bounds.max[0]) * 0.5 : 0;
  const centerY = bounds ? (bounds.min[1] + bounds.max[1]) * 0.5 : 0;
  const centerZ = bounds ? (bounds.min[2] + bounds.max[2]) * 0.5 : 0;

  let idx = 0;
  for (let z = 0; z < nz; z += 1) {
    const pz = bounds ? bounds.min[2] + (z + 0.5) * dz - centerZ : 0;
    for (let y = 0; y < ny; y += 1) {
      const py = bounds ? bounds.min[1] + (y + 0.5) * dy - centerY : 0;
      for (let x = 0; x < nx; x += 1) {
        const px = bounds ? bounds.min[0] + (x + 0.5) * dx - centerX : 0;
        const rho = (rhoIn[idx] ?? 0) * densityScale;
        const sxRaw = (sxIn[idx] ?? 0) - fluxOffset[0];
        const syRaw = (syIn[idx] ?? 0) - fluxOffset[1];
        const szRaw = (szIn[idx] ?? 0) - fluxOffset[2];
        const sx = sxRaw * momentumScale;
        const sy = syRaw * momentumScale;
        const sz = szRaw * momentumScale;
        const pressure = rho * pressureFactor;
        fields.rho[idx] = rho;
        fields.Sx[idx] = sx;
        fields.Sy[idx] = sy;
        fields.Sz[idx] = sz;

        let sxx = pressure;
        let syy = pressure;
        let szz = pressure;
        let sxy = 0;
        let sxz = 0;
        let syz = 0;
        if (anisotropyStrength > 0) {
          let nxv = 0;
          let nyv = 0;
          let nzv = 0;
          if (anisotropyMode === "radial" && bounds) {
            nxv = px;
            nyv = py;
            nzv = pz;
          } else {
            nxv = sxRaw;
            nyv = syRaw;
            nzv = szRaw;
            const fluxMag = Math.hypot(nxv, nyv, nzv);
            if (fluxMag <= 1e-12 && bounds) {
              nxv = px;
              nyv = py;
              nzv = pz;
            }
          }
          const nMag = Math.hypot(nxv, nyv, nzv);
          if (nMag > 1e-12) {
            const nxUnit = nxv / nMag;
            const nyUnit = nyv / nMag;
            const nzUnit = nzv / nMag;
            const anisotropy = pressure * anisotropyStrength;
            const dxx = 1.5 * nxUnit * nxUnit - 0.5;
            const dyy = 1.5 * nyUnit * nyUnit - 0.5;
            const dzz = 1.5 * nzUnit * nzUnit - 0.5;
            const dxy = 1.5 * nxUnit * nyUnit;
            const dxz = 1.5 * nxUnit * nzUnit;
            const dyz = 1.5 * nyUnit * nzUnit;
            sxx = pressure + anisotropy * dxx;
            syy = pressure + anisotropy * dyy;
            szz = pressure + anisotropy * dzz;
            sxy = anisotropy * dxy;
            sxz = anisotropy * dxz;
            syz = anisotropy * dyz;
          }
        }

        fields.S_xx[idx] = sxx;
        fields.S_yy[idx] = syy;
        fields.S_zz[idx] = szz;
        fields.S_xy[idx] = sxy;
        fields.S_xz[idx] = sxz;
        fields.S_yz[idx] = syz;
        idx += 1;
      }
    }
  }
  return fields;
};

type HullDefaults = {
  min: Vec3;
  max: Vec3;
  axes: Vec3;
  wall: number;
};

const defaultHullBounds = (): HullDefaults => {
  const state = getGlobalPipelineState();
  const hull = state?.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173, wallThickness_m: 0.45 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return {
    min,
    max,
    axes: [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2],
    wall: hull.wallThickness_m ?? 0.45,
  };
};

const inferPressureFactor = (state: ReturnType<typeof getGlobalPipelineState>) => {
  const stress = (state as any)?.warp?.stressEnergyTensor ?? (state as any)?.stressEnergy;
  const t00 = Number(stress?.T00);
  const t11 = Number(stress?.T11);
  if (!Number.isFinite(t00) || !Number.isFinite(t11) || t00 === 0) return undefined;
  return t11 / t00;
};

export const buildStressEnergyFieldSetFromPipeline = (
  grid: GridSpec,
  params: Partial<StressEnergyBrickParams & { radialMap?: HullRadialMap | null }> = {},
  options: StressEnergyBuildOptions = {},
): { fields: StressEnergyFieldSet; brick: StressEnergyBrick } => {
  const state = getGlobalPipelineState();
  const defaults = defaultHullBounds();
  const bounds = params.bounds ?? grid.bounds ?? { min: defaults.min, max: defaults.max };
  const hullAxes = params.hullAxes ?? defaults.axes;
  const hullWall = params.hullWall ?? defaults.wall;
  const dutyFR =
    params.dutyFR ??
    state?.dutyEffective_FR ??
    (state as any)?.dutyEffectiveFR ??
    0.0025;
  const gammaGeo = params.gammaGeo ?? state?.gammaGeo ?? 26;
  const gammaVdB = params.gammaVdB ?? state?.gammaVanDenBroeck ?? 1;
  const q = params.q ?? state?.qSpoilingFactor ?? 1;
  const zeta = params.zeta ?? state?.zeta ?? 0.84;
  const inferredPressure = inferPressureFactor(state);
  const pressureSource =
    options.pressureFactor !== undefined
      ? "override"
      : Number.isFinite(inferredPressure ?? NaN)
        ? "pipeline"
        : "proxy";
  const pressureFactor = options.pressureFactor ?? inferredPressure ?? -1;
  const brick = buildStressEnergyBrick({
    dims: grid.dims,
    bounds,
    phase01: params.phase01 ?? state?.phase01 ?? 0,
    sigmaSector: params.sigmaSector ?? 0.05,
    splitEnabled: params.splitEnabled ?? false,
    splitFrac: params.splitFrac ?? 0.6,
    dutyFR,
    q,
    gammaGeo,
    gammaVdB,
    ampBase: params.ampBase ?? 0,
    zeta,
    driveDir: params.driveDir ?? null,
    hullAxes,
    hullWall,
    radialMap: params.radialMap ?? null,
    metricT00: params.metricT00,
    metricT00Source: params.metricT00Source,
    metricT00Ref: params.metricT00Ref,
    warpFieldType: params.warpFieldType,
    sourceRedesignMode: params.sourceRedesignMode ?? null,
    sourceReformulationMode: params.sourceReformulationMode ?? null,
  });
  if (brick.stats.mapping) {
    brick.stats.mapping.pressureFactor = pressureFactor;
    brick.stats.mapping.pressureSource = pressureSource;
    brick.stats.mapping.proxy = pressureSource !== "pipeline";
    brick.stats.mapping.anisotropyStrength = clamp01(
      options.anisotropyStrength ?? 0,
    );
    brick.stats.mapping.anisotropyMode = options.anisotropyMode ?? "flux";
    brick.stats.mapping.conservationDamping = Math.max(
      0,
      options.conservationDamping ?? 0,
    );
    brick.stats.mapping.conservationNetFlux = options.enforceNetFlux === true;
    const divRmsNorm = brick.stats.conservation?.divRmsNorm ?? 0;
    brick.stats.mapping.conservationScale = resolveConservationScale(
      Math.max(0, options.conservationDamping ?? 0),
      divRmsNorm,
    );
  }
  const fields = buildStressEnergyFieldSetFromBrick(grid, brick, {
    ...options,
    pressureFactor,
  });
  return { fields, brick };
};
