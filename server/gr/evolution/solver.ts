import {
  createMinkowskiState,
  gridFromBounds,
  type BssnState,
  type GridSpec,
} from "../../../modules/gr/bssn-state.ts";
import {
  computeBssnConstraints,
  evolveBssn,
  applyBssnDetTraceFixups,
  initFixupStats,
  type BoundaryParams,
  type FixupParams,
  type FixupStats,
  type GaugeParams,
  type StencilParams,
  type ConstraintFields,
} from "../../../modules/gr/bssn-evolve.ts";
import { computeShiftStiffnessMetrics } from "../../../modules/gr/gr-diagnostics.ts";
import type { StressEnergyFieldSet } from "../../../modules/gr/stress-energy.ts";
import type { StressEnergyBrick } from "../../stress-energy-brick.ts";
import type { StressEnergyBrickParams } from "../../stress-energy-brick.ts";
import type { Vec3 } from "../../curvature-brick.ts";
import {
  buildStressEnergyFieldSetFromPipeline,
  type StressEnergyBuildOptions,
} from "./stress-energy.ts";
import { toGeometricTime, type GrUnitSystem } from "../../../shared/gr-units.ts";

type Bounds = { min: Vec3; max: Vec3 };

const defaultBounds = (): Bounds => {
  const min: Vec3 = [-500, -200, -150];
  const max: Vec3 = [500, 200, 150];
  return { min, max };
};

export interface GrEvolutionRunParams {
  grid?: GridSpec;
  initialState?: BssnState;
  dims?: [number, number, number];
  bounds?: Bounds;
  dt: number;
  steps: number;
  unitSystem?: GrUnitSystem;
  gauge?: GaugeParams;
  stencils?: StencilParams;
  boundary?: BoundaryParams;
  fixups?: FixupParams;
  koEps?: number;
  koTargets?: "gauge" | "all";
  advectScheme?: "centered" | "upwind1";
  shockMode?: "off" | "diagnostic" | "stabilize";
  matter?: StressEnergyFieldSet | null;
  usePipelineMatter?: boolean;
  sourceParams?: Partial<StressEnergyBrickParams>;
  sourceOptions?: StressEnergyBuildOptions;
  time_s?: number;
}

export interface GrEvolutionRunResult {
  grid: GridSpec;
  state: ReturnType<typeof createMinkowskiState>;
  matter?: StressEnergyFieldSet | null;
  sourceBrick?: StressEnergyBrick;
  constraints: ConstraintFields;
  fixups?: FixupStats;
  time_s: number;
  dt: number;
  koEpsUsed?: number;
  koTargetsUsed?: "gauge" | "all";
  advectSchemeUsed?: "centered" | "upwind1";
  shockMode?: "off" | "diagnostic" | "stabilize";
  stabilizersApplied?: string[];
}

export const runBssnEvolution = ({
  grid,
  initialState,
  dims: inputDims,
  bounds,
  dt,
  steps,
  unitSystem = "SI",
  gauge,
  stencils,
  boundary,
  fixups,
  koEps,
  koTargets,
  advectScheme,
  shockMode: shockModeInput,
  matter,
  usePipelineMatter = true,
  sourceParams,
  sourceOptions,
  time_s = 0,
}: GrEvolutionRunParams): GrEvolutionRunResult => {
  const shockMode =
    shockModeInput === "diagnostic" || shockModeInput === "stabilize"
      ? shockModeInput
      : "off";
  const dims = inputDims ?? [128, 128, 128];
  const vec3Equal = (left: Vec3, right: Vec3) =>
    left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  if (initialState?.grid) {
    if (grid && !vec3Equal(grid.dims, initialState.grid.dims)) {
      throw new Error("Initial state grid dims do not match requested grid.");
    }
    if (bounds && initialState.grid.bounds) {
      const initialBounds = initialState.grid.bounds;
      if (
        !vec3Equal(bounds.min, initialBounds.min) ||
        !vec3Equal(bounds.max, initialBounds.max)
      ) {
        throw new Error("Initial state bounds do not match requested bounds.");
      }
    }
    if (inputDims && !vec3Equal(inputDims, initialState.grid.dims)) {
      throw new Error("Initial state dims do not match requested dims.");
    }
  }
  const resolvedGrid =
    initialState?.grid ?? grid ?? gridFromBounds(dims, bounds ?? defaultBounds());
  const dt_s = Math.max(0, dt);
  const dt_geom = unitSystem === "SI" ? toGeometricTime(dt_s) : dt_s;
  const state = initialState ?? createMinkowskiState(resolvedGrid);
  const fixupStats = initFixupStats(state.alpha.length, steps, fixups);
  let koEpsUsed = Number.isFinite(koEps as number) ? Math.max(0, koEps as number) : 0;
  const koTargetsUsed = koTargets === "all" ? "all" : "gauge";
  const advectSchemeUsed = advectScheme === "upwind1" ? "upwind1" : "centered";
  const stabilizersApplied: string[] = [];
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

  if (shockMode === "stabilize") {
    const stiffnessPre = computeShiftStiffnessMetrics(state, stencils, {
      cflTarget: 0.5,
    });
    if (stiffnessPre.shockSeverity === "severe" && !(koEpsUsed > 0)) {
      koEpsUsed = 0.1;
      stabilizersApplied.push("ko");
    }
  }

  if (steps > 0 && dt_geom > 0) {
    evolveBssn(state, dt_geom, steps, {
      gauge,
      stencils,
      boundary,
      fixups,
      fixupStats,
      koEps: koEpsUsed,
      koTargets: koTargetsUsed,
      advectScheme: advectSchemeUsed,
      matter: matterFields ?? null,
    });
  }

  applyBssnDetTraceFixups(state, fixups, fixupStats);

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
    fixups: fixupStats,
    time_s: time_s + (dt_s > 0 ? steps * dt_s : 0),
    dt: dt_s,
    koEpsUsed,
    koTargetsUsed,
    advectSchemeUsed,
    shockMode,
    stabilizersApplied: stabilizersApplied.length ? stabilizersApplied : undefined,
  };
};
