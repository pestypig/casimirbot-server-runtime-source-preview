import { HBAR } from "@shared/physics-const";
import { computeDpCollapse, type TDpCollapseInput, type TDpMassDistribution } from "@shared/dp-collapse";
import {
  DpPlanInput,
  DpPlanResult,
  type TDpPlanInput,
  type TDpPlanResult,
} from "@shared/dp-planner";
import { buildInformationBoundary } from "../utils/information-boundary";
import { withDerivedArtifactInformationBoundary } from "@shared/information-boundary-derived";
import { buildDpInputFromAdapter } from "./dp-adapters";

const DEFAULT_VIS_TARGET = 1 / Math.E;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const readDpConstraintsFromEnv = (): TDpCollapseInput["constraints"] | undefined => {
  const toNum = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const heating = toNum(process.env.DP_HEATING_W_KG_MAX);
  const diffusion = toNum(process.env.DP_MOMENTUM_DIFFUSION_MAX);
  const forceNoise = toNum(process.env.DP_FORCE_NOISE_MAX);
  if (heating == null && diffusion == null && forceNoise == null) return undefined;
  return {
    heating_W_kg_max: heating,
    momentum_diffusion_kg2_m2_s3_max: diffusion,
    force_noise_N2_Hz_max: forceNoise,
  };
};

const summarizeBranch = (branch: TDpMassDistribution) => {
  if (branch.kind === "analytic") {
    return {
      kind: branch.kind,
      label: branch.label,
      primitives: branch.primitives,
    };
  }
  return {
    kind: branch.kind,
    label: branch.label,
    lattice_generation_hash: branch.lattice_generation_hash,
  };
};

const summarizeDpInput = (input: TDpCollapseInput) => ({
  ell_m: input.ell_m,
  r_c_m: input.r_c_m,
  grid: input.grid,
  method: input.method,
  coarse_graining: input.coarse_graining,
  side_effects: input.side_effects,
  constraints: input.constraints,
  branch_a: summarizeBranch(input.branch_a),
  branch_b: summarizeBranch(input.branch_b),
});

type DpPlanAdapterInput = NonNullable<TDpPlanInput["dp_adapter"]>;

const summarizeAdapter = (input: TDpPlanInput["dp_adapter"]) => {
  if (!input) return undefined;
  const summarizeBranchMeta = (branch: DpPlanAdapterInput["branch_a"]) => ({
    units: branch.units,
    sign_mode: branch.sign_mode,
    scale: branch.scale,
    label: branch.label,
    lattice_generation_hash: branch.lattice_generation_hash,
    grid: branch.grid ?? branch.grid_spec ?? branch.grid_bounds,
  });
  return {
    ell_m: input.ell_m,
    r_c_m: input.r_c_m,
    method: input.method,
    coarse_graining: input.coarse_graining,
    side_effects: input.side_effects,
    constraints: input.constraints,
    branch_a: summarizeBranchMeta(input.branch_a),
    branch_b: summarizeBranchMeta(input.branch_b),
    notes: input.notes,
  };
};

const toVisibilityCurve = (v0: number, gamma: number, times: number[]) =>
  times.map((t_s) => ({
    t_s,
    v: clamp01(v0 * Math.exp(-gamma * t_s)),
  }));

const resolveVisibility = (input: TDpPlanInput["visibility"], gamma: number, notes: string[]) => {
  if (!input) return undefined;
  const v0 = clamp01(input.v0 ?? 1);
  const target = clamp01(input.target ?? DEFAULT_VIS_TARGET);
  const targetSource = input.target == null ? "default" : "input";
  let targetReachable = true;
  let timeToTarget: number | undefined;

  if (target >= v0) {
    timeToTarget = 0;
  } else if (!(gamma > 0)) {
    targetReachable = false;
    notes.push("visibility_target_unreachable");
  } else {
    const value = Math.log(v0 / target) / gamma;
    if (Number.isFinite(value) && value >= 0) {
      timeToTarget = value;
    } else {
      targetReachable = false;
      notes.push("visibility_target_invalid");
    }
  }

  const times = input.times_s?.filter((t) => Number.isFinite(t) && t >= 0) ?? undefined;
  const curve = times && times.length > 0 ? toVisibilityCurve(v0, gamma, times) : undefined;

  return {
    v0,
    target,
    target_source: targetSource as "default" | "input",
    time_to_target_s: timeToTarget,
    target_reachable: targetReachable,
    ...(curve ? { curve } : {}),
  };
};

const resolveDetectability = (
  input: TDpPlanInput["environment"],
  gamma: number,
  notes: string[],
) => {
  if (!input || input.gamma_env_s == null) {
    return {
      dominance: "unavailable" as const,
    };
  }
  const gammaEnv = input.gamma_env_s;
  if (!(gammaEnv > 0)) {
    notes.push("environment_gamma_zero");
    return {
      gamma_env_s: gammaEnv,
      dominance: gamma > 0 ? "dp_dominant" : "equal",
    };
  }
  const ratio = gamma / gammaEnv;
  const dominance =
    Math.abs(ratio - 1) < 1e-6 ? "equal" : ratio >= 1 ? "dp_dominant" : "env_dominant";
  return {
    gamma_env_s: gammaEnv,
    ratio: Number.isFinite(ratio) && ratio >= 0 ? ratio : undefined,
    dominance,
  };
};

export const buildDpPlanResult = (rawInput: TDpPlanInput, data_cutoff_iso: string): TDpPlanResult => {
  const input = DpPlanInput.parse(rawInput);
  const dpConstraints = readDpConstraintsFromEnv();
  const dpInputRaw = input.dp ?? (input.dp_adapter ? buildDpInputFromAdapter(input.dp_adapter) : null);
  if (!dpInputRaw) {
    throw new Error("dp_plan_missing_dp_input");
  }
  const dpInput = dpConstraints && !dpInputRaw.constraints ? { ...dpInputRaw, constraints: dpConstraints } : dpInputRaw;
  const dpResult = computeDpCollapse(dpInput);
  const gamma_dp_s = dpResult.tau_infinite ? 0 : dpResult.deltaE_J / HBAR;

  const notes: string[] = [];
  if (dpResult.tau_infinite) {
    notes.push("dp_tau_infinite");
  }

  const visibility = resolveVisibility(input.visibility, gamma_dp_s, notes);
  const detectability = resolveDetectability(input.environment, gamma_dp_s, notes);

  const informationBoundary = buildInformationBoundary({
    data_cutoff_iso,
    mode: "observables",
    labels_used_as_features: false,
    event_features_included: false,
    inputs: {
      kind: "dp_plan",
      v: 1,
      dp_source: input.dp ? "dp" : "dp_adapter",
      dp: summarizeDpInput(dpInput),
      dp_adapter: summarizeAdapter(input.dp_adapter),
      visibility: input.visibility,
      environment: input.environment,
    },
    features: {
      kind: "dp_plan",
      v: 1,
      dp: dpResult,
      gamma_dp_s,
      visibility,
      detectability,
    },
  });

  const rawResult = {
    ok: true,
    schema_version: "dp_plan/1" as const,
    dp: dpResult,
    gamma_dp_s,
    tau_s: dpResult.tau_s,
    tau_ms: dpResult.tau_ms,
    ...(visibility ? { visibility } : {}),
    ...(detectability ? { detectability } : {}),
    ...(input.notes || notes.length ? { notes: [...(input.notes ?? []), ...notes] } : {}),
  };

  return DpPlanResult.parse(withDerivedArtifactInformationBoundary(rawResult, informationBoundary));
};
