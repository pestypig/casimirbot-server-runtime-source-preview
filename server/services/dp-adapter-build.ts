import { getGlobalPipelineState } from "../energy-pipeline";
import { buildInformationBoundary } from "../utils/information-boundary";
import { buildStressEnergyBrick, type StressEnergyBrickParams } from "../stress-energy-brick";
import { buildGrEvolveBrick, type GrEvolveBrickParams } from "../gr-evolve-brick";
import {
  DpAdapterBuildInput,
  DpAdapterBuildResult,
  type TDpAdapterBuildInput,
  type TDpAdapterBuildResult,
  type TDpAdapterBuildSource,
} from "@shared/collapse-benchmark";
import type { TDpGridSpec, TDpMassDistribution } from "@shared/dp-collapse";
import {
  dpGridFromBounds,
  dpGridFromGridSpec,
  dpMassDistributionFromArray,
  encodeFloat32Volume,
} from "./dp-adapters";

type Vec3 = [number, number, number];

const DEFAULT_DIMS: [number, number, number] = [64, 64, 64];

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((v) => typeof v === "number" && Number.isFinite(v));

const isDims = (value: unknown): value is [number, number, number] =>
  isVec3(value) && value.every((v) => v > 0);

const boundsFromGrid = (grid: TDpGridSpec): { min: Vec3; max: Vec3 } => {
  const [nx, ny, nz] = grid.dims;
  const [dx, dy, dz] = grid.voxel_size_m;
  const [ox, oy, oz] = grid.origin_m;
  const halfX = (nx * dx) / 2;
  const halfY = (ny * dy) / 2;
  const halfZ = (nz * dz) / 2;
  return {
    min: [ox - halfX, oy - halfY, oz - halfZ],
    max: [ox + halfX, oy + halfY, oz + halfZ],
  };
};

const boundsFromState = (): { min: Vec3; max: Vec3; axes: Vec3; wall: number } => {
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

const resolveGrid = (
  input: TDpAdapterBuildInput,
  branchParams: Array<Record<string, unknown> | undefined>,
): { grid: TDpGridSpec; bounds: { min: Vec3; max: Vec3 }; notes: string[] } => {
  const notes: string[] = [];

  if (input.grid) {
    return { grid: input.grid, bounds: boundsFromGrid(input.grid), notes };
  }
  if (input.grid_bounds) {
    const grid = dpGridFromBounds(input.grid_bounds.dims, input.grid_bounds.bounds, input.grid_bounds.origin_m);
    return { grid, bounds: input.grid_bounds.bounds, notes };
  }
  if (input.grid_spec) {
    const grid = dpGridFromGridSpec({
      dims: input.grid_spec.dims,
      spacing: input.grid_spec.spacing_m,
      ...(input.grid_spec.bounds ? { bounds: input.grid_spec.bounds } : {}),
    });
    const bounds = input.grid_spec.bounds ?? boundsFromGrid(grid);
    return { grid, bounds, notes };
  }

  let dims: [number, number, number] | null = null;
  for (const params of branchParams) {
    if (!params) continue;
    const candidate = params.dims;
    if (isDims(candidate)) {
      if (!dims) {
        dims = candidate;
      } else if (candidate[0] !== dims[0] || candidate[1] !== dims[1] || candidate[2] !== dims[2]) {
        throw new Error("dp_adapter_branch_dim_mismatch");
      }
    }
  }
  if (!dims) {
    dims = DEFAULT_DIMS;
    notes.push("grid:default_dims");
  }

  let bounds: { min: Vec3; max: Vec3 } | null = null;
  for (const params of branchParams) {
    if (!params) continue;
    const raw = params.bounds;
    if (raw && typeof raw === "object") {
      const min = (raw as any).min;
      const max = (raw as any).max;
      if (isVec3(min) && isVec3(max)) {
        const candidate = { min, max };
        if (!bounds) {
          bounds = candidate;
        } else if (
          candidate.min[0] !== bounds.min[0] ||
          candidate.min[1] !== bounds.min[1] ||
          candidate.min[2] !== bounds.min[2] ||
          candidate.max[0] !== bounds.max[0] ||
          candidate.max[1] !== bounds.max[1] ||
          candidate.max[2] !== bounds.max[2]
        ) {
          throw new Error("dp_adapter_branch_bounds_mismatch");
        }
      }
    }
  }
  if (!bounds) {
    const fallback = boundsFromState();
    bounds = { min: fallback.min, max: fallback.max };
    notes.push("grid:default_bounds");
  }

  const grid = dpGridFromBounds(dims, bounds);
  return { grid, bounds, notes };
};

const normalizeDriveDir = (value: unknown): Vec3 | undefined => {
  if (!isVec3(value)) return undefined;
  const mag = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(mag) || mag === 0) return undefined;
  return [value[0] / mag, value[1] / mag, value[2] / mag];
};

const resolveStressEnergyDefaults = (): Partial<StressEnergyBrickParams> => {
  const state = getGlobalPipelineState();
  const dutyFR = (state as any)?.dutyEffectiveFR ?? (state as any)?.dutyEffective_FR ?? state?.dutyCycle ?? 0.0025;
  const driveDir = normalizeDriveDir((state as any)?.driveDir);
  return {
    phase01: typeof state?.phase01 === "number" ? state.phase01 : 0,
    sigmaSector: typeof (state as any)?.sigmaSector === "number" ? (state as any).sigmaSector : 0.05,
    splitEnabled: (state as any)?.splitEnabled ?? false,
    splitFrac: typeof (state as any)?.splitFrac === "number" ? (state as any).splitFrac : 0.6,
    dutyFR: typeof dutyFR === "number" ? dutyFR : 0.0025,
    q: typeof state?.qSpoilingFactor === "number" ? state.qSpoilingFactor : 1,
    gammaGeo: typeof state?.gammaGeo === "number" ? state.gammaGeo : 26,
    gammaVdB: typeof state?.gammaVanDenBroeck === "number" ? state.gammaVanDenBroeck : 1e5,
    ampBase: typeof (state as any)?.ampBase === "number" ? (state as any).ampBase : 0,
    zeta: typeof state?.zeta === "number" ? state.zeta : 0.84,
    driveDir,
  };
};

const mergeStressEnergyParams = (
  grid: TDpGridSpec,
  bounds: { min: Vec3; max: Vec3 },
  branchParams: Record<string, unknown> | undefined,
): Partial<StressEnergyBrickParams> => {
  const fallback = boundsFromState();
  const defaults = resolveStressEnergyDefaults();
  const params = { ...(branchParams ?? {}) } as Partial<StressEnergyBrickParams>;

  if (params.dims && (params.dims[0] !== grid.dims[0] || params.dims[1] !== grid.dims[1] || params.dims[2] !== grid.dims[2])) {
    throw new Error("dp_adapter_branch_dim_mismatch");
  }
  if (params.bounds) {
    const b = params.bounds as { min: Vec3; max: Vec3 };
    if (
      b.min[0] !== bounds.min[0] ||
      b.min[1] !== bounds.min[1] ||
      b.min[2] !== bounds.min[2] ||
      b.max[0] !== bounds.max[0] ||
      b.max[1] !== bounds.max[1] ||
      b.max[2] !== bounds.max[2]
    ) {
      throw new Error("dp_adapter_branch_bounds_mismatch");
    }
  }

  return {
    ...defaults,
    ...params,
    dims: grid.dims,
    bounds,
    hullAxes: params.hullAxes ?? fallback.axes,
    hullWall: params.hullWall ?? fallback.wall,
  };
};

const mergeGrEvolveParams = (
  grid: TDpGridSpec,
  bounds: { min: Vec3; max: Vec3 },
  branchParams: Record<string, unknown> | undefined,
  includeMatter: boolean,
): Partial<GrEvolveBrickParams> => {
  const params = { ...(branchParams ?? {}) } as Partial<GrEvolveBrickParams>;
  return {
    ...params,
    dims: grid.dims,
    bounds,
    includeMatter,
    includeExtra: params.includeExtra ?? false,
    steps: params.steps ?? 0,
  };
};

const buildBranchFromSource = (args: {
  source: TDpAdapterBuildSource;
  grid: TDpGridSpec;
  bounds: { min: Vec3; max: Vec3 };
  branch: TDpAdapterBuildInput["branch_a"];
  includeMatter: boolean;
}): {
  branch: TDpMassDistribution;
  adapterBranch: TDpAdapterBuildResult["dp_adapter"]["branch_a"];
  diagnostics: TDpAdapterBuildResult["branches"]["a"];
} => {
  const signMode = args.branch.sign_mode ?? "signed";
  if (args.source === "stress_energy_brick") {
    const params = mergeStressEnergyParams(args.grid, args.bounds, args.branch.params);
    const brick = buildStressEnergyBrick(params);
    const density = brick.channels.t00.data;
    const adapterBranch: TDpAdapterBuildResult["dp_adapter"]["branch_a"] = {
      density: encodeFloat32Volume(density),
      units: "energy_density_J_m3",
      sign_mode: signMode,
      grid: args.grid,
      label: args.branch.label ?? "stress_energy:t00",
    };
    const converted = dpMassDistributionFromArray({
      density,
      grid: args.grid,
      options: {
        units: "energy_density_J_m3",
        sign_mode: signMode,
        label: adapterBranch.label,
      },
    });
    const notes = [...converted.notes];
    const diagnostics: TDpAdapterBuildResult["branches"]["a"] = {
      source: "stress_energy_brick",
      label: adapterBranch.label,
      sign_mode: signMode,
      units: "energy_density_J_m3",
      stats: converted.stats,
      notes,
    };
    return { branch: converted.branch, adapterBranch, diagnostics };
  }

  const params = mergeGrEvolveParams(args.grid, args.bounds, args.branch.params, args.includeMatter);
  const brick = buildGrEvolveBrick(params);
  const rhoChannel = brick.channels.rho;
  if (!rhoChannel) {
    throw new Error("dp_adapter_missing_matter_channel");
  }
  const density = rhoChannel.data;
  const adapterBranch: TDpAdapterBuildResult["dp_adapter"]["branch_a"] = {
    density: encodeFloat32Volume(density),
    units: "geom_stress",
    sign_mode: signMode,
    grid: args.grid,
    label: args.branch.label ?? "gr_evolve:rho",
  };
  const converted = dpMassDistributionFromArray({
    density,
    grid: args.grid,
    options: {
      units: "geom_stress",
      sign_mode: signMode,
      label: adapterBranch.label,
    },
  });
  const diagnostics: TDpAdapterBuildResult["branches"]["a"] = {
    source: "gr_evolve_brick",
    label: adapterBranch.label,
    sign_mode: signMode,
    units: "geom_stress",
    stats: converted.stats,
    notes: converted.notes,
  };
  return { branch: converted.branch, adapterBranch, diagnostics };
};

export const buildDpAdapterFromSources = (
  rawInput: TDpAdapterBuildInput,
  data_cutoff_iso: string,
): TDpAdapterBuildResult => {
  const input = DpAdapterBuildInput.parse(rawInput);
  const branchParams = [
    input.branch_a?.params as Record<string, unknown> | undefined,
    input.branch_b?.params as Record<string, unknown> | undefined,
  ];
  const { grid, bounds, notes: gridNotes } = resolveGrid(input, branchParams);
  const includeMatter = input.include_matter ?? true;

  const branchA = buildBranchFromSource({
    source: input.source,
    grid,
    bounds,
    branch: input.branch_a,
    includeMatter,
  });
  const branchB = buildBranchFromSource({
    source: input.source,
    grid,
    bounds,
    branch: input.branch_b,
    includeMatter,
  });

  const dpAdapter = {
    schema_version: "dp_adapter/1" as const,
    ell_m: input.ell_m,
    r_c_m: input.r_c_m,
    method: input.method,
    coarse_graining: input.coarse_graining,
    side_effects: input.side_effects,
    constraints: input.constraints,
    branch_a: branchA.adapterBranch,
    branch_b: branchB.adapterBranch,
    seed: input.seed,
    notes: input.notes,
  };

  const informationBoundary = buildInformationBoundary({
    data_cutoff_iso,
    mode: "observables",
    labels_used_as_features: false,
    event_features_included: false,
    inputs: {
      kind: "dp_adapter_build",
      v: 1,
      request: input,
      grid,
      bounds,
      grid_notes: gridNotes,
    },
    features: {
      kind: "dp_adapter_build",
      v: 1,
      branches: {
        a: branchA.diagnostics,
        b: branchB.diagnostics,
      },
    },
  });

  const result: TDpAdapterBuildResult = {
    ok: true,
    schema_version: "dp_adapter_build/1",
    dp_adapter: dpAdapter,
    grid,
    branches: {
      a: {
        ...branchA.diagnostics,
        notes: [...gridNotes, ...branchA.diagnostics.notes],
      },
      b: {
        ...branchB.diagnostics,
        notes: [...gridNotes, ...branchB.diagnostics.notes],
      },
    },
    data_cutoff_iso: informationBoundary.data_cutoff_iso,
    inputs_hash: informationBoundary.inputs_hash,
    features_hash: informationBoundary.features_hash,
    information_boundary: informationBoundary,
  };

  return DpAdapterBuildResult.parse(result);
};
