import { Buffer } from "node:buffer";
import { C2 } from "@shared/physics-const";
import { GEOM_TO_SI_STRESS } from "@shared/gr-units";
import type { TDpGridSpec, TDpMassDistribution, TFloat32VolumeB64, TDpCollapseInput } from "@shared/dp-collapse";
import type { TDpAdapterInput } from "@shared/collapse-benchmark";
import type { StressEnergyBrick } from "../stress-energy-brick";
import type { GridSpec } from "../../modules/gr/bssn-state.js";
import type { StressEnergyFieldSet } from "../../modules/gr/stress-energy.js";

type Vec3 = [number, number, number];

export type DpDensityUnits = "mass_density_kg_m3" | "energy_density_J_m3" | "geom_stress";
export type DpDensitySignMode = "signed" | "absolute" | "positive";

export type DpDensityAdapterOptions = {
  units?: DpDensityUnits;
  sign_mode?: DpDensitySignMode;
  scale?: number;
  label?: string;
  lattice_generation_hash?: string;
  origin_m?: Vec3;
};

export type DpDensityAdapterStats = {
  min: number;
  max: number;
  mean: number;
  abs_max: number;
  finite_fraction: number;
};

export type DpDensityAdapterResult = {
  grid: TDpGridSpec;
  branch: TDpMassDistribution;
  notes: string[];
  stats: DpDensityAdapterStats;
};

export const encodeFloat32Volume = (data: Float32Array): TFloat32VolumeB64 => ({
  encoding: "base64",
  dtype: "float32",
  endian: "little",
  order: "row-major",
  data_b64: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"),
});

export const decodeFloat32Volume = (
  payload: TFloat32VolumeB64,
  expectedLength: number,
): Float32Array => {
  const clean = payload.data_b64.trim().replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  const buffer = Buffer.from(clean, "base64");
  const floatCount = Math.floor(buffer.byteLength / 4);
  if (floatCount < expectedLength) {
    throw new Error(`dp_adapter_density_length_mismatch: expected ${expectedLength}, got ${floatCount}`);
  }
  const view = new Float32Array(buffer.buffer, buffer.byteOffset, expectedLength);
  return new Float32Array(view);
};

const applySignMode = (value: number, mode: DpDensitySignMode): number => {
  switch (mode) {
    case "absolute":
      return Math.abs(value);
    case "positive":
      return Math.max(0, value);
    case "signed":
    default:
      return value;
  }
};

const toMassDensity = (value: number, units: DpDensityUnits): number => {
  switch (units) {
    case "mass_density_kg_m3":
      return value;
    case "energy_density_J_m3":
      return value / C2;
    case "geom_stress":
      return (value * GEOM_TO_SI_STRESS) / C2;
    default:
      return value / C2;
  }
};

const convertDensityArray = (
  source: Float32Array,
  options?: DpDensityAdapterOptions,
): { rho: Float32Array; notes: string[]; stats: DpDensityAdapterStats } => {
  const units = options?.units ?? "energy_density_J_m3";
  const signMode = options?.sign_mode ?? "signed";
  const scale = Number.isFinite(options?.scale ?? NaN) ? (options?.scale as number) : 1;
  const rho = new Float32Array(source.length);
  const notes = [`units:${units}`, `sign_mode:${signMode}`];
  if (scale !== 1) notes.push(`scale:${scale}`);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let absMax = 0;
  let sum = 0;
  let finiteCount = 0;

  for (let i = 0; i < source.length; i += 1) {
    const raw = source[i];
    let value = 0;
    if (Number.isFinite(raw)) {
      value = toMassDensity(raw, units) * scale;
      value = applySignMode(value, signMode);
      finiteCount += 1;
    }
    rho[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
    const abs = Math.abs(value);
    if (abs > absMax) absMax = abs;
    sum += value;
  }

  if (finiteCount < source.length) {
    notes.push(`nonfinite:${source.length - finiteCount}`);
  }

  const mean = source.length > 0 ? sum / source.length : 0;
  const stats: DpDensityAdapterStats = {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    mean: Number.isFinite(mean) ? mean : 0,
    abs_max: Number.isFinite(absMax) ? absMax : 0,
    finite_fraction: source.length > 0 ? finiteCount / source.length : 0,
  };

  return { rho, notes, stats };
};

export const dpMassDistributionFromArray = (args: {
  density: Float32Array;
  grid: TDpGridSpec;
  options?: DpDensityAdapterOptions;
}): DpDensityAdapterResult => {
  const { rho, notes, stats } = convertDensityArray(args.density, args.options);
  const branch: TDpMassDistribution = {
    kind: "density_grid",
    rho_kg_m3: encodeFloat32Volume(rho),
    grid: args.grid,
    label: args.options?.label,
    lattice_generation_hash: args.options?.lattice_generation_hash,
  };
  return { grid: args.grid, branch, notes, stats };
};

const assertDims = (dims: [number, number, number]): void => {
  const ok = dims.every((v) => Number.isFinite(v) && v > 0);
  if (!ok) {
    throw new Error("dp_adapter_invalid_dims");
  }
};

export const dpGridFromBounds = (
  dims: [number, number, number],
  bounds: { min: Vec3; max: Vec3 },
  originOverride?: Vec3,
): TDpGridSpec => {
  assertDims(dims);
  const [nx, ny, nz] = dims;
  const dx = (bounds.max[0] - bounds.min[0]) / nx;
  const dy = (bounds.max[1] - bounds.min[1]) / ny;
  const dz = (bounds.max[2] - bounds.min[2]) / nz;
  if (![dx, dy, dz].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error("dp_adapter_invalid_bounds");
  }
  const origin: Vec3 =
    originOverride ?? [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ];
  return {
    dims,
    voxel_size_m: [dx, dy, dz],
    origin_m: origin,
  };
};

export const dpGridFromGridSpec = (grid: GridSpec, originOverride?: Vec3): TDpGridSpec => {
  assertDims(grid.dims);
  const origin: Vec3 =
    originOverride ??
    (grid.bounds
      ? [
          (grid.bounds.min[0] + grid.bounds.max[0]) * 0.5,
          (grid.bounds.min[1] + grid.bounds.max[1]) * 0.5,
          (grid.bounds.min[2] + grid.bounds.max[2]) * 0.5,
        ]
      : [0, 0, 0]);
  return {
    dims: grid.dims,
    voxel_size_m: grid.spacing,
    origin_m: origin,
  };
};

export const dpMassDistributionFromStressEnergyBrick = (args: {
  brick: StressEnergyBrick;
  bounds: { min: Vec3; max: Vec3 };
  options?: DpDensityAdapterOptions;
}): DpDensityAdapterResult => {
  const grid = dpGridFromBounds(args.brick.dims, args.bounds, args.options?.origin_m);
  const source = args.brick.channels.t00.data;
  const { rho, notes, stats } = convertDensityArray(source, {
    units: args.options?.units ?? "energy_density_J_m3",
    sign_mode: args.options?.sign_mode ?? "signed",
    scale: args.options?.scale,
  });

  const branch: TDpMassDistribution = {
    kind: "density_grid",
    rho_kg_m3: encodeFloat32Volume(rho),
    grid,
    label: args.options?.label ?? "stress_energy:t00",
    lattice_generation_hash: args.options?.lattice_generation_hash,
  };

  return { grid, branch, notes, stats };
};

export const dpMassDistributionFromStressEnergyFields = (args: {
  fields: StressEnergyFieldSet;
  grid: GridSpec;
  options?: DpDensityAdapterOptions;
}): DpDensityAdapterResult => {
  const expected = args.grid.dims[0] * args.grid.dims[1] * args.grid.dims[2];
  if (args.fields.rho.length !== expected) {
    throw new Error("dp_adapter_field_length_mismatch");
  }
  const grid = dpGridFromGridSpec(args.grid, args.options?.origin_m);
  const { rho, notes, stats } = convertDensityArray(args.fields.rho, {
    units: args.options?.units ?? "geom_stress",
    sign_mode: args.options?.sign_mode ?? "signed",
    scale: args.options?.scale,
  });

  const branch: TDpMassDistribution = {
    kind: "density_grid",
    rho_kg_m3: encodeFloat32Volume(rho),
    grid,
    label: args.options?.label ?? "gr_stress_energy:rho",
    lattice_generation_hash: args.options?.lattice_generation_hash,
  };

  return { grid, branch, notes, stats };
};

export const dpMassDistributionFromDensityGrid = (args: {
  density: TFloat32VolumeB64;
  grid: TDpGridSpec;
  options?: DpDensityAdapterOptions;
}): DpDensityAdapterResult => {
  const expected = args.grid.dims[0] * args.grid.dims[1] * args.grid.dims[2];
  const source = decodeFloat32Volume(args.density, expected);
  const { rho, notes, stats } = convertDensityArray(source, args.options);
  const branch: TDpMassDistribution = {
    kind: "density_grid",
    rho_kg_m3: encodeFloat32Volume(rho),
    grid: args.grid,
    label: args.options?.label,
    lattice_generation_hash: args.options?.lattice_generation_hash,
  };
  return { grid: args.grid, branch, notes, stats };
};

const gridMatches = (a: TDpGridSpec, b: TDpGridSpec): boolean => {
  const dimsMatch = a.dims.every((v, i) => v === b.dims[i]);
  if (!dimsMatch) return false;
  const tol = 1e-12;
  for (let i = 0; i < 3; i += 1) {
    const va = a.voxel_size_m[i];
    const vb = b.voxel_size_m[i];
    const delta = Math.abs(va - vb);
    const scale = Math.max(1, Math.abs(va), Math.abs(vb));
    if (delta > tol * scale) return false;
  }
  return true;
};

const resolveAdapterGrid = (branch: TDpAdapterInput["branch_a"]) => {
  if (branch.grid) return branch.grid;
  if (branch.grid_spec) {
    const spec = branch.grid_spec;
    return dpGridFromGridSpec({
      dims: spec.dims,
      spacing: spec.spacing_m,
      ...(spec.bounds ? { bounds: spec.bounds } : {}),
    });
  }
  if (branch.grid_bounds) {
    return dpGridFromBounds(branch.grid_bounds.dims, branch.grid_bounds.bounds, branch.grid_bounds.origin_m);
  }
  throw new Error("dp_adapter_missing_grid");
};

const mapAdapterNotes = (prefix: string, notes: string[]): string[] =>
  notes.map((note) => `${prefix}${note}`);

export const buildDpInputFromAdapter = (adapter: TDpAdapterInput): TDpCollapseInput => {
  const gridA = resolveAdapterGrid(adapter.branch_a);
  const gridB = resolveAdapterGrid(adapter.branch_b);
  if (!gridMatches(gridA, gridB)) {
    const err = new Error("dp_adapter_grid_mismatch") as Error & { status?: number; code?: string };
    err.status = 400;
    err.code = "dp_adapter_grid_mismatch";
    throw err;
  }

  const branchA = dpMassDistributionFromDensityGrid({
    density: adapter.branch_a.density,
    grid: gridA,
    options: {
      units: adapter.branch_a.units,
      sign_mode: adapter.branch_a.sign_mode,
      scale: adapter.branch_a.scale,
      label: adapter.branch_a.label ?? "adapter:branch_a",
      lattice_generation_hash: adapter.branch_a.lattice_generation_hash,
    },
  });

  const branchB = dpMassDistributionFromDensityGrid({
    density: adapter.branch_b.density,
    grid: gridB,
    options: {
      units: adapter.branch_b.units,
      sign_mode: adapter.branch_b.sign_mode,
      scale: adapter.branch_b.scale,
      label: adapter.branch_b.label ?? "adapter:branch_b",
      lattice_generation_hash: adapter.branch_b.lattice_generation_hash,
    },
  });

  const notes = [
    ...(adapter.notes ?? []),
    ...mapAdapterNotes("branch_a:", branchA.notes),
    ...mapAdapterNotes("branch_b:", branchB.notes),
  ];

  return {
    schema_version: "dp_collapse/1",
    ell_m: adapter.ell_m,
    r_c_m: adapter.r_c_m,
    grid: gridA,
    branch_a: branchA.branch,
    branch_b: branchB.branch,
    method: adapter.method,
    coarse_graining: adapter.coarse_graining,
    side_effects: adapter.side_effects,
    constraints: adapter.constraints,
    seed: adapter.seed,
    notes: notes.length ? notes : undefined,
  };
};
