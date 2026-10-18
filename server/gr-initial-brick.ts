import type { Buffer } from "node:buffer";
import { getGlobalPipelineState } from "./energy-pipeline.ts";
import type { Vec3 } from "./curvature-brick";
import type { StressEnergyBrickParams } from "./stress-energy-brick";
import {
  buildEvolutionBrick,
  serializeEvolutionBrick,
  serializeEvolutionBrickBinary,
  runInitialDataSolve,
  type GrEvolutionBrick,
  type GrEvolutionBrickBinaryPayload,
  type GrEvolutionBrickResponse,
  type GrEvolutionStats,
  type StencilParams,
  type StressEnergyBuildOptions,
} from "./gr/evolution/index.js";
import type { GrUnitSystem } from "../shared/gr-units.js";

export interface GrInitialBrickParams {
  dims: [number, number, number];
  bounds?: { min: Vec3; max: Vec3 };
  iterations?: number;
  tolerance?: number;
  stencils?: StencilParams;
  unitSystem?: GrUnitSystem;
  includeExtra?: boolean;
  includeMatter?: boolean;
  includeKij?: boolean;
  sourceParams?: Partial<StressEnergyBrickParams>;
  sourceOptions?: StressEnergyBuildOptions;
}

export interface GrInitialBrickStats extends GrEvolutionStats {
  iterations: number;
  residual: number;
  tolerance: number;
  status: "CERTIFIED" | "NOT_CERTIFIED";
  solver: "lichnerowicz-york";
  reason?: string;
}

export interface GrInitialBrick extends GrEvolutionBrick {
  stats: GrInitialBrickStats;
}

export interface GrInitialBrickResponse
  extends Omit<GrEvolutionBrickResponse, "kind" | "stats"> {
  kind: "gr-initial-brick";
  stats: GrInitialBrickStats;
}

export interface GrInitialBrickBinaryHeader
  extends Omit<GrEvolutionBrickBinaryPayload["header"], "kind" | "stats"> {
  kind: "gr-initial-brick";
  stats: GrInitialBrickStats;
}

export type GrInitialBrickBinaryPayload = {
  header: GrInitialBrickBinaryHeader;
  buffers: Buffer[];
};

const defaultHullBounds = () => {
  const state = getGlobalPipelineState();
  const hull = state?.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return { min, max };
};

export function buildGrInitialBrick(
  input: Partial<GrInitialBrickParams>,
): GrInitialBrick {
  const dims: [number, number, number] = input.dims ?? [128, 128, 128];
  const bounds = input.bounds ?? defaultHullBounds();
  const iterations = Math.max(0, Math.floor(input.iterations ?? 120));
  const tolerance = Math.max(0, input.tolerance ?? 0);
  const includeExtra = input.includeExtra ?? false;
  const includeMatter = input.includeMatter ?? includeExtra;
  const includeKij = input.includeKij ?? includeExtra;
  const includeInvariants = includeExtra;

  const initial = runInitialDataSolve({
    dims,
    bounds,
    iterations,
    tolerance,
    stencils: input.stencils,
    unitSystem: input.unitSystem,
    sourceParams: input.sourceParams,
    sourceOptions: input.sourceOptions,
  });

  const includeMatterChannels = includeMatter && !!initial.matter;
  const evolutionBrick = buildEvolutionBrick({
    state: initial.state,
    constraints: initial.constraints,
    includeConstraints: true,
    includeMatter: includeMatterChannels,
    includeKij,
    includeInvariants,
    matter: initial.matter ?? null,
    stencils: input.stencils,
    time_s: 0,
    dt_s: 0,
  });

  const stats: GrInitialBrickStats = {
    ...(evolutionBrick.stats ?? {}),
    iterations: initial.solver.iterations,
    residual: initial.solver.residual,
    tolerance: initial.solver.tolerance,
    status: initial.solver.status,
    solver: "lichnerowicz-york",
    ...(initial.solver.reason ? { reason: initial.solver.reason } : {}),
  };

  return {
    ...evolutionBrick,
    stats,
  };
}

export const serializeGrInitialBrick = (
  brick: GrInitialBrick,
): GrInitialBrickResponse => {
  const base = serializeEvolutionBrick(brick as GrEvolutionBrick);
  return {
    ...base,
    kind: "gr-initial-brick",
    stats: brick.stats,
  };
};

export const serializeGrInitialBrickBinary = (
  brick: GrInitialBrick,
): GrInitialBrickBinaryPayload => {
  const base = serializeEvolutionBrickBinary(brick as GrEvolutionBrick);
  return {
    header: {
      ...base.header,
      kind: "gr-initial-brick",
      stats: brick.stats,
    },
    buffers: base.buffers,
  };
};
