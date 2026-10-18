import {
  createMinkowskiState,
  gridFromBounds,
  type BssnState,
  type GridSpec,
} from "../../../modules/gr/bssn-state.ts";
import {
  computeBssnConstraints,
  type ConstraintFields,
  type StencilParams,
} from "../../../modules/gr/bssn-evolve.ts";
import {
  stressEnergyMatchesGrid,
  type StressEnergyFieldSet,
} from "../../../modules/gr/stress-energy.ts";
import type { StressEnergyBrick, StressEnergyBrickParams } from "../../stress-energy-brick.ts";
import type { Vec3 } from "../../curvature-brick.ts";
import {
  buildStressEnergyFieldSetFromPipeline,
  type StressEnergyBuildOptions,
} from "./stress-energy.ts";
import type { GrUnitSystem } from "../../../shared/gr-units.ts";

type Bounds = { min: Vec3; max: Vec3 };

const defaultBounds = (): Bounds => {
  const min: Vec3 = [-500, -200, -150];
  const max: Vec3 = [500, 200, 150];
  return { min, max };
};

const EPS = 1e-12;
const MIN_PSI = 1e-6;
const MAX_PSI = 1e6;
const TWO_PI = Math.PI * 2;

const axisIndex = (x: number, y: number, z: number, nx: number, ny: number) =>
  z * nx * ny + y * nx + x;

export type InitialDataStatus = "CERTIFIED" | "NOT_CERTIFIED";

type SolveResult = {
  psi: Float32Array;
  iterations: number;
  residual: number;
  converged: boolean;
  status: InitialDataStatus;
  reason?: string;
};

const solveLichnerowiczYorkJacobi = (
  rho: Float32Array | null,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dy: number,
  dz: number,
  iterations: number,
  tolerance: number,
): SolveResult => {
  const total = nx * ny * nz;
  let psi = new Float32Array(total);
  let scratch = new Float32Array(total);
  psi.fill(1);
  scratch.fill(1);

  if (!rho || total === 0) {
    return {
      psi,
      iterations: 0,
      residual: 0,
      converged: true,
      status: "CERTIFIED",
      reason: "vacuum",
    };
  }

  if (nx < 3 || ny < 3 || nz < 3 || iterations <= 0) {
    return {
      psi,
      iterations: 0,
      residual: 0,
      converged: false,
      status: "NOT_CERTIFIED",
      reason: "insufficient-grid",
    };
  }

  let rhoMax = 0;
  for (let i = 0; i < total; i += 1) {
    const value = Math.abs(rho[i]);
    if (!Number.isFinite(value)) {
      return {
        psi,
        iterations: 0,
        residual: 0,
        converged: false,
        status: "NOT_CERTIFIED",
        reason: "non-finite-rho",
      };
    }
    if (value > rhoMax) rhoMax = value;
  }
  if (rhoMax < EPS) {
    return {
      psi,
      iterations: 0,
      residual: 0,
      converged: true,
      status: "CERTIFIED",
      reason: "vacuum",
    };
  }

  const invDx2 = 1 / Math.max(dx * dx, EPS);
  const invDy2 = 1 / Math.max(dy * dy, EPS);
  const invDz2 = 1 / Math.max(dz * dz, EPS);
  const denom = 2 * (invDx2 + invDy2 + invDz2);
  if (!Number.isFinite(denom) || denom === 0) {
    return {
      psi,
      iterations: 0,
      residual: 0,
      converged: false,
      status: "NOT_CERTIFIED",
      reason: "invalid-denominator",
    };
  }

  let residual = 0;
  let invalid = false;
  let it = 0;
  for (it = 0; it < iterations; it += 1) {
    scratch.set(psi);
    residual = 0;
    for (let z = 1; z < nz - 1; z += 1) {
      for (let y = 1; y < ny - 1; y += 1) {
        for (let x = 1; x < nx - 1; x += 1) {
          const idx = axisIndex(x, y, z, nx, ny);
          const psiVal = psi[idx];
          const psiSafe = Math.min(MAX_PSI, Math.max(MIN_PSI, psiVal));
          const psiX = (psi[idx - 1] + psi[idx + 1]) * invDx2;
          const psiY = (psi[idx - nx] + psi[idx + nx]) * invDy2;
          const psiZ = (psi[idx - nx * ny] + psi[idx + nx * ny]) * invDz2;
          const rhs = -TWO_PI * rho[idx] * Math.pow(psiSafe, 5);
          let next = (psiX + psiY + psiZ - rhs) / denom;
          if (!Number.isFinite(next)) {
            invalid = true;
            next = psiSafe;
          }
          if (next < MIN_PSI) {
            invalid = true;
            next = MIN_PSI;
          } else if (next > MAX_PSI) {
            invalid = true;
            next = MAX_PSI;
          }
          scratch[idx] = next;
          const delta = Math.abs(next - psiVal);
          if (delta > residual) residual = delta;
        }
      }
    }
    const tmp = psi;
    psi = scratch;
    scratch = tmp;
    if (invalid) break;
    if (tolerance > 0 && residual < tolerance) break;
  }

  const converged = !invalid && (tolerance <= 0 || residual < tolerance);
  const performed = it < iterations ? it + 1 : it;
  return {
    psi,
    iterations: performed,
    residual,
    converged,
    status: converged ? "CERTIFIED" : "NOT_CERTIFIED",
    reason: invalid ? "non-finite-psi" : converged ? "converged" : "max-iterations",
  };
};

export interface InitialDataSolveParams {
  grid?: GridSpec;
  initialState?: BssnState;
  dims?: [number, number, number];
  bounds?: Bounds;
  iterations?: number;
  tolerance?: number;
  stencils?: StencilParams;
  matter?: StressEnergyFieldSet | null;
  usePipelineMatter?: boolean;
  unitSystem?: GrUnitSystem;
  sourceParams?: Partial<StressEnergyBrickParams>;
  sourceOptions?: StressEnergyBuildOptions;
}

export interface InitialDataSolveResult {
  grid: GridSpec;
  state: ReturnType<typeof createMinkowskiState>;
  matter?: StressEnergyFieldSet | null;
  sourceBrick?: StressEnergyBrick;
  constraints: ConstraintFields;
  solver: {
    iterations: number;
    residual: number;
    tolerance: number;
    status: InitialDataStatus;
    converged: boolean;
    reason?: string;
  };
}

export const runInitialDataSolve = ({
  grid,
  initialState,
  dims = [128, 128, 128],
  bounds,
  iterations = 120,
  tolerance = 0,
  stencils,
  matter,
  usePipelineMatter = true,
  unitSystem = "SI",
  sourceParams,
  sourceOptions,
}: InitialDataSolveParams): InitialDataSolveResult => {
  const resolvedGrid = grid ?? gridFromBounds(dims, bounds ?? defaultBounds());
  if (initialState) {
    const [ix, iy, iz] = initialState.grid.dims;
    const [rx, ry, rz] = resolvedGrid.dims;
    if (ix !== rx || iy !== ry || iz !== rz) {
      throw new Error("Initial data state dims do not match requested grid");
    }
  }
  let matterFields = matter ?? null;
  let sourceBrick: StressEnergyBrick | undefined;

  if (!matterFields && usePipelineMatter) {
    const source = buildStressEnergyFieldSetFromPipeline(
      resolvedGrid,
      sourceParams,
      { ...sourceOptions, unitSystem },
    );
    matterFields = source.fields;
    sourceBrick = source.brick;
  }

  if (matterFields && !stressEnergyMatchesGrid(matterFields, resolvedGrid)) {
    throw new Error("Stress-energy field set does not match grid size");
  }

  const [nx, ny, nz] = resolvedGrid.dims;
  const dx = resolvedGrid.spacing[0];
  const dy = resolvedGrid.spacing[1];
  const dz = resolvedGrid.spacing[2];
  const clampedIterations = Math.max(0, Math.floor(iterations));
  const clampedTolerance = Math.max(0, tolerance);
  const solve = solveLichnerowiczYorkJacobi(
    matterFields ? matterFields.rho : null,
    nx,
    ny,
    nz,
    dx,
    dy,
    dz,
    clampedIterations,
    clampedTolerance,
  );

  const state = initialState ?? createMinkowskiState(resolvedGrid);
  for (let i = 0; i < state.phi.length; i += 1) {
    const psiVal = solve.psi[i] ?? 1;
    const safePsi = Math.max(MIN_PSI, psiVal);
    state.phi[i] = Math.log(safePsi);
  }

  const constraints = computeBssnConstraints(state, {
    stencils,
    matter: matterFields ?? null,
  });

  return {
    grid: resolvedGrid,
    state,
    matter: matterFields ?? undefined,
    sourceBrick,
    constraints,
    solver: {
      iterations: solve.iterations,
      residual: solve.residual,
      tolerance: clampedTolerance,
      status: solve.status,
      converged: solve.converged,
      reason: solve.reason,
    },
  };
};
