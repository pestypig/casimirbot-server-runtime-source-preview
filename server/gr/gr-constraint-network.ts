import {
  buildBssnRhs,
  computeBssnConstraints,
  evolveBssn,
  runInitialDataSolve,
  type BoundaryParams,
  type FixupParams,
  type GaugeParams,
  type StencilParams,
} from "./evolution/index.js";
import type { GrUnitSystem } from "../../shared/gr-units.js";
import { toGeometricTime } from "../../shared/gr-units.js";
import type { Vec3 } from "../curvature-brick.js";
import type { StressEnergyBrickParams } from "../stress-energy-brick.js";
import type { StressEnergyBuildOptions } from "./evolution/stress-energy.js";
import type { StressEnergyFieldSet } from "../../modules/gr/stress-energy.ts";
import type {
  GrConstraintGateStatus,
  GrConstraintMetrics,
  GrConstraintNetwork4d,
  GrConstraintPolicy,
  GrConstraintThresholds,
  GrConstraintTrend,
} from "../../shared/schema.js";
import {
  evaluateGrConstraintGateFromMetrics,
  summarizeConstraintFields,
} from "./constraint-evaluator.js";

export type GrConstraintNetwork4dParams = {
  dims?: [number, number, number];
  bounds?: { min: Vec3; max: Vec3 };
  time_s?: number;
  dt_s?: number;
  steps?: number;
  unitSystem?: GrUnitSystem;
  gauge?: GaugeParams;
  stencils?: StencilParams;
  boundary?: BoundaryParams;
  fixups?: FixupParams;
  thresholds?: Partial<GrConstraintThresholds>;
  policy?: Partial<GrConstraintPolicy>;
  initialIterations?: number;
  initialTolerance?: number;
  includeSeries?: boolean;
  matter?: StressEnergyFieldSet | null;
  usePipelineMatter?: boolean;
  sourceParams?: Partial<StressEnergyBrickParams>;
  sourceOptions?: StressEnergyBuildOptions;
};

const emptyMetrics = (): GrConstraintMetrics => ({
  H_rms: 0,
  M_rms: 0,
  H_maxAbs: 0,
  M_maxAbs: 0,
});

const maxMetrics = (
  current: GrConstraintMetrics,
  next: GrConstraintMetrics,
): GrConstraintMetrics => ({
  H_rms: Math.max(current.H_rms, next.H_rms),
  M_rms: Math.max(current.M_rms, next.M_rms),
  H_maxAbs: Math.max(current.H_maxAbs, next.H_maxAbs),
  M_maxAbs: Math.max(current.M_maxAbs, next.M_maxAbs),
});

const computeTrend = (
  initial: GrConstraintMetrics,
  final: GrConstraintMetrics,
  steps: number,
): GrConstraintTrend => {
  const denom = Math.max(1, steps);
  return {
    H_rms: (final.H_rms - initial.H_rms) / denom,
    M_rms: (final.M_rms - initial.M_rms) / denom,
    H_maxAbs: (final.H_maxAbs - initial.H_maxAbs) / denom,
    M_maxAbs: (final.M_maxAbs - initial.M_maxAbs) / denom,
  };
};

export function runGrConstraintNetwork4d(
  params: GrConstraintNetwork4dParams,
): GrConstraintNetwork4d {
  const steps = Math.max(0, Math.floor(params.steps ?? 0));
  const dt_s = Math.max(0, params.dt_s ?? 0);
  const time_s = Math.max(0, params.time_s ?? 0);
  const unitSystem: GrUnitSystem = params.unitSystem ?? "SI";
  const includeSeries = params.includeSeries !== false;

  const initial = runInitialDataSolve({
    dims: params.dims,
    bounds: params.bounds,
    iterations: params.initialIterations,
    tolerance: params.initialTolerance,
    stencils: params.stencils,
    matter: params.matter,
    usePipelineMatter: params.usePipelineMatter,
    unitSystem,
    sourceParams: params.sourceParams,
    sourceOptions: params.sourceOptions,
  });

  const grid = initial.grid;
  const state = initial.state;
  const matter = initial.matter ?? null;

  const series: GrConstraintNetwork4d["series"] = [];
  const notes: string[] = [];

  let peak = emptyMetrics();
  let initialMetrics = emptyMetrics();
  let finalMetrics = emptyMetrics();

  const recordStep = (
    step: number,
    time: number,
    metrics: GrConstraintMetrics,
    gateStatus: GrConstraintGateStatus,
  ) => {
    finalMetrics = metrics;
    peak = maxMetrics(peak, metrics);
    if (step === 0) {
      initialMetrics = metrics;
    }
    if (includeSeries) {
      series.push({
        step,
        time_s: time,
        metrics,
        gateStatus,
      });
    }
  };

  const initialMetricsComputed = summarizeConstraintFields(initial.constraints);
  const initialGate = evaluateGrConstraintGateFromMetrics(
    initialMetricsComputed,
    {
      thresholds: params.thresholds,
      policy: params.policy,
    },
  );
  recordStep(0, time_s, initialMetricsComputed, initialGate.gate.status);

  const dt_geom = unitSystem === "SI" ? toGeometricTime(dt_s) : dt_s;
  let scratch: ReturnType<typeof evolveBssn> | undefined;
  const rhs = buildBssnRhs({
    gauge: params.gauge,
    stencils: params.stencils,
    matter,
  });

  for (let step = 1; step <= steps; step += 1) {
    if (dt_geom > 0) {
      scratch = evolveBssn(
        state,
        dt_geom,
        1,
        {
          rhs,
          gauge: params.gauge,
          stencils: params.stencils,
          boundary: params.boundary,
          fixups: params.fixups,
          matter,
        },
        scratch,
      );
    }

    const constraints = computeBssnConstraints(state, {
      stencils: params.stencils,
      matter,
    });
    const metrics = summarizeConstraintFields(constraints);
    const gateEval = evaluateGrConstraintGateFromMetrics(metrics, {
      thresholds: params.thresholds,
      policy: params.policy,
    });
    recordStep(step, time_s + step * dt_s, metrics, gateEval.gate.status);
  }

  const summaryGate = evaluateGrConstraintGateFromMetrics(peak, {
    thresholds: params.thresholds,
    policy: params.policy,
  });

  const certified = initial.solver.status === "CERTIFIED";
  if (!certified) {
    notes.push(
      `Initial data solve ${initial.solver.status.toLowerCase()}; interpret network cautiously.`,
    );
  }

  return {
    kind: "gr-constraint-network-4d",
    version: 1,
    updatedAt: Date.now(),
    pass: summaryGate.gate.status === "pass" && certified,
    grid: {
      dims: grid.dims,
      bounds: grid.bounds ?? {
        min: params.bounds?.min ?? [-1, -1, -1],
        max: params.bounds?.max ?? [1, 1, 1],
      },
      voxelSize_m: grid.spacing,
      time_s,
      dt_s,
      steps,
    },
    initial: {
      status: initial.solver.status,
      iterations: initial.solver.iterations,
      residual: initial.solver.residual,
      tolerance: initial.solver.tolerance,
      ...(initial.solver.reason ? { reason: initial.solver.reason } : {}),
    },
    gate: summaryGate.gate,
    constraints: summaryGate.constraints,
    summary: {
      max: peak,
      final: finalMetrics,
      trend: computeTrend(initialMetrics, finalMetrics, steps),
      steps,
    },
    series: includeSeries ? series : [],
    ...(notes.length ? { notes } : {}),
  };
}
