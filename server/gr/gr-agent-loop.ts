import {
  buildGrRequestPayload,
  evaluateQiGuardrail,
  getGlobalPipelineState,
  resolveBubbleRadiusM,
  setGlobalPipelineState,
  updateParameters,
  type EnergyPipelineState,
  type GrRequestPayload,
} from "../energy-pipeline.js";
import type { GrInitialBrickStats } from "../gr-initial-brick.js";
import {
  buildGrDiagnostics,
  buildGrEvolveBrick,
  type GrEvolveBrick,
} from "../gr-evolve-brick.js";
import type { Vec3 } from "../curvature-brick.js";
import type { StressEnergyBrickParams } from "../stress-energy-brick.js";
import type { WarpConfig } from "../../types/warpViability.js";
import type { PipelineSnapshot } from "../../types/pipeline.js";
import type {
  GrConstraintPolicy,
  GrConstraintThresholds,
  GrEvaluation,
} from "../../shared/schema.js";
import {
  runInitialDataSolve,
  type BoundaryParams,
  type FixupParams,
  type GaugeParams,
  type StencilParams,
} from "./evolution/index.js";
import type { GrUnitSystem } from "../../shared/gr-units.js";
import { runGrEvaluation } from "./gr-evaluation.js";
import { withSpan } from "../services/observability/otel-tracing.js";
import { C } from "../../shared/physics-const.js";

export type GrAgentLoopProposal = {
  label?: string;
  params?: Partial<EnergyPipelineState>;
};

export type GrAgentLoopStrategy = {
  dutyDecay?: number;
  gammaGeoDecay?: number;
  gammaVdBDecay?: number;
  qSpoilGrow?: number;
};

export type GrAgentLoopBudget = {
  maxTotalMs?: number;
  maxAttemptMs?: number;
};

export type GrAgentLoopEscalation = {
  enabled?: boolean;
  dimsScale?: number;
  stepsScale?: number;
  initialIterationsScale?: number;
  evolveIterationsScale?: number;
  maxDims?: [number, number, number];
  maxSteps?: number;
  maxInitialIterations?: number;
  maxEvolveIterations?: number;
  includeExtraAfter?: number;
};

export type GrAgentLoopState =
  | "idle"
  | "proposing"
  | "initializing"
  | "evolving"
  | "evaluating"
  | "accepted"
  | "rejected"
  | "budget-exhausted"
  | "restored"
  | "completed";

export type GrAgentLoopStateEvent = {
  state: GrAgentLoopState;
  atMs: number;
  iteration?: number;
  note?: string;
};

export type GrAgentLoopFidelity = {
  dims: [number, number, number];
  bounds: { min: Vec3; max: Vec3 };
  unitSystem?: GrUnitSystem;
  initialIterations: number;
  initialTolerance: number;
  evolveSteps: number;
  evolveDt_s: number;
  evolveIterations: number;
  evolveTolerance: number;
  includeExtra: boolean;
  includeMatter: boolean;
  includeKij: boolean;
  includeInvariants: boolean;
};

export type GrAgentLoopTiming = {
  totalMs: number;
  initialMs: number;
  evolveMs: number;
  evaluationMs: number;
};

export type GrAgentLoopGrParams = {
  dims?: [number, number, number];
  bounds?: { min: Vec3; max: Vec3 };
  unitSystem?: GrUnitSystem;
  stencils?: StencilParams;
  gauge?: GaugeParams;
  boundary?: BoundaryParams;
  fixups?: FixupParams;
  includeExtra?: boolean;
  includeMatter?: boolean;
  includeKij?: boolean;
  includeInvariants?: boolean;
  initialIterations?: number;
  initialTolerance?: number;
  evolveSteps?: number;
  evolveDt_s?: number;
  evolveIterations?: number;
  evolveTolerance?: number;
};

export type GrAgentLoopOptions = {
  maxIterations?: number;
  proposals?: GrAgentLoopProposal[];
  strategy?: GrAgentLoopStrategy;
  warpConfig?: WarpConfig;
  thresholds?: Partial<GrConstraintThresholds>;
  policy?: Partial<GrConstraintPolicy>;
  useLiveSnapshot?: boolean;
  commitAccepted?: boolean;
  budget?: GrAgentLoopBudget;
  escalation?: GrAgentLoopEscalation;
  gr?: GrAgentLoopGrParams;
  ciFastPath?: boolean;
};

export type GrAgentLoopAttempt = {
  iteration: number;
  proposal: GrAgentLoopProposal;
  grRequest: GrRequestPayload;
  fidelity: GrAgentLoopFidelity;
  initial: Pick<
    GrInitialBrickStats,
    "status" | "iterations" | "residual" | "tolerance" | "reason"
  >;
  evolution: {
    steps: number;
    dt_s: number;
    stats: Pick<GrEvolveBrick["stats"], "H_rms" | "M_rms" | "cfl">;
  };
  evaluation: GrEvaluation;
  timing: GrAgentLoopTiming;
  accepted: boolean;
};

export type GrAgentLoopBudgetReport = {
  maxTotalMs?: number;
  maxAttemptMs?: number;
  totalMs: number;
  exhausted?: "total" | "attempt";
};

export type GrAgentLoopResult = {
  accepted: boolean;
  acceptedIteration?: number;
  attempts: GrAgentLoopAttempt[];
  finalState: EnergyPipelineState;
  restored: boolean;
  state: GrAgentLoopState;
  stateHistory: GrAgentLoopStateEvent[];
  budget: GrAgentLoopBudgetReport;
};

const DEFAULT_STRATEGY: Required<GrAgentLoopStrategy> = {
  dutyDecay: 0.85,
  gammaGeoDecay: 0.97,
  gammaVdBDecay: 0.97,
  qSpoilGrow: 1.05,
};

const DEFAULT_ESCALATION: Required<GrAgentLoopEscalation> = {
  enabled: false,
  dimsScale: 1.25,
  stepsScale: 1.5,
  initialIterationsScale: 1.2,
  evolveIterationsScale: 1.2,
  maxDims: [128, 128, 128],
  maxSteps: 64,
  maxInitialIterations: 200,
  maxEvolveIterations: 8,
  includeExtraAfter: 2,
};

const DEFAULT_CFL_TARGET = 0.25;

const resolveEvolveDtSeconds = (
  bounds: { min: Vec3; max: Vec3 },
  dims: [number, number, number],
  requested?: number,
): number => {
  if (Number.isFinite(requested) && (requested as number) > 0) {
    return requested as number;
  }
  const spanX = Math.abs(bounds.max[0] - bounds.min[0]);
  const spanY = Math.abs(bounds.max[1] - bounds.min[1]);
  const spanZ = Math.abs(bounds.max[2] - bounds.min[2]);
  const dx = spanX / Math.max(1, dims[0]);
  const dy = spanY / Math.max(1, dims[1]);
  const dz = spanZ / Math.max(1, dims[2]);
  const minSpacing = Math.max(1e-12, Math.min(dx, dy, dz));
  const dtGeom = minSpacing * DEFAULT_CFL_TARGET;
  return dtGeom / C;
};

const cloneState = (state: EnergyPipelineState): EnergyPipelineState => {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(state) as EnergyPipelineState;
    } catch (error) {
      // Fall back to JSON clone when pipeline state includes non-cloneable values.
    }
  }
  return JSON.parse(JSON.stringify(state)) as EnergyPipelineState;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const clampInt = (value: number, min: number, max?: number): number => {
  const capped = Math.max(min, Math.floor(value));
  return max !== undefined ? Math.min(capped, Math.floor(max)) : capped;
};

const scaleInt = (
  value: number,
  factor: number,
  step: number,
  max?: number,
): number => {
  const scaled = value * Math.pow(factor, step);
  return clampInt(scaled, 1, max);
};

const resolveBounds = (
  state: EnergyPipelineState,
  override?: { min: Vec3; max: Vec3 },
): { min: Vec3; max: Vec3 } => {
  if (override) return override;
  const hull = state.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173 };
  const min: Vec3 = [-hull.Lx_m / 2, -hull.Ly_m / 2, -hull.Lz_m / 2];
  const max: Vec3 = [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2];
  return { min, max };
};

const resolvePressureFactor = (state: EnergyPipelineState): number | undefined => {
  const stress = (state as any)?.warp?.stressEnergyTensor ?? (state as any)?.stressEnergy;
  const t00 = Number(stress?.T00);
  const t11 = Number(stress?.T11);
  if (!Number.isFinite(t00) || !Number.isFinite(t11) || t00 === 0) return undefined;
  return t11 / t00;
};

const resolveSourceParams = (
  state: EnergyPipelineState,
  bounds: { min: Vec3; max: Vec3 },
): Partial<StressEnergyBrickParams> => {
  const hull = state.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173, wallThickness_m: 0.45 };
  const dutyRaw =
    (state as any).dutyEffective_FR ??
    (state as any).dutyEffectiveFR ??
    state.dutyShip ??
    state.dutyCycle;
  return {
    bounds,
    hullAxes: [hull.Lx_m / 2, hull.Ly_m / 2, hull.Lz_m / 2],
    hullWall: hull.wallThickness_m ?? 0.45,
    dutyFR: Number.isFinite(dutyRaw) ? Number(dutyRaw) : 0.0025,
    q: Number.isFinite(state.qSpoilingFactor) ? Number(state.qSpoilingFactor) : 1,
    gammaGeo: Number.isFinite(state.gammaGeo) ? Number(state.gammaGeo) : 26,
    gammaVdB: Number.isFinite(state.gammaVanDenBroeck)
      ? Number(state.gammaVanDenBroeck)
      : 1,
    zeta: Number.isFinite((state as any).zeta) ? Number((state as any).zeta) : 0.84,
    phase01: Number.isFinite(state.phase01) ? Number(state.phase01) : 0,
  };
};

const resolveWarpConfig = (
  state: EnergyPipelineState,
  override?: WarpConfig,
): WarpConfig => {
  const hull = state.hull ?? { Lx_m: 1007, Ly_m: 264, Lz_m: 173, wallThickness_m: 0.45 };
  const bubbleRadius = resolveBubbleRadiusM(state, hull.Lz_m / 2);
  return {
    bubbleRadius_m: bubbleRadius,
    wallThickness_m: hull.wallThickness_m ?? 0.45,
    dutyCycle: state.dutyCycle,
    gammaGeoOverride: state.gammaGeo,
    ...(override ?? {}),
  };
};

const buildEvaluationSnapshot = (
  state: EnergyPipelineState,
  diagnostics: GrPipelineDiagnostics,
): PipelineSnapshot => {
  const guardInput = cloneState(state) as any;
  guardInput.gr = diagnostics;
  const sampler =
    typeof (state as any).qi?.sampler === "string" && String((state as any).qi.sampler).length > 0
      ? String((state as any).qi.sampler)
      : undefined;
  const fieldType =
    typeof (state as any).qi?.fieldType === "string" && String((state as any).qi.fieldType).length > 0
      ? String((state as any).qi.fieldType)
      : undefined;
  const tauMs =
    Number.isFinite((state as any).qi?.tau_s_ms) && Number((state as any).qi?.tau_s_ms) > 0
      ? Number((state as any).qi.tau_s_ms)
      : undefined;
  const qiGuardrail = evaluateQiGuardrail(guardInput, {
    ...(sampler ? { sampler: sampler as any } : {}),
    ...(fieldType ? { fieldType } : {}),
    ...(tauMs !== undefined ? { tau_ms: tauMs } : {}),
  });
  return {
    gr: diagnostics as unknown as PipelineSnapshot["gr"],
    qiGuardrail: qiGuardrail as unknown as PipelineSnapshot["qiGuardrail"],
    qi: (state as any).qi ?? null,
  };
};

const buildStrategyProposal = (
  state: EnergyPipelineState,
  strategy: Required<GrAgentLoopStrategy>,
  iteration: number,
): GrAgentLoopProposal => {
  if (iteration === 0) return { label: "baseline", params: {} };
  const dutyCycle = Number.isFinite(state.dutyCycle)
    ? clamp01(state.dutyCycle * strategy.dutyDecay)
    : undefined;
  const gammaGeo = Number.isFinite(state.gammaGeo)
    ? state.gammaGeo * strategy.gammaGeoDecay
    : undefined;
  const gammaVdB = Number.isFinite(state.gammaVanDenBroeck)
    ? state.gammaVanDenBroeck * strategy.gammaVdBDecay
    : undefined;
  const qSpoil = Number.isFinite(state.qSpoilingFactor)
    ? state.qSpoilingFactor * strategy.qSpoilGrow
    : undefined;
  return {
    label: "decay",
    params: {
      ...(dutyCycle !== undefined ? { dutyCycle } : {}),
      ...(gammaGeo !== undefined ? { gammaGeo } : {}),
      ...(gammaVdB !== undefined ? { gammaVanDenBroeck: gammaVdB } : {}),
      ...(qSpoil !== undefined ? { qSpoilingFactor: qSpoil } : {}),
    },
  };
};

const normalizeBudget = (budget?: GrAgentLoopBudget): GrAgentLoopBudget => {
  if (!budget) return {};
  const maxTotalMs =
    budget.maxTotalMs !== undefined && budget.maxTotalMs >= 0
      ? budget.maxTotalMs
      : undefined;
  const maxAttemptMs =
    budget.maxAttemptMs !== undefined && budget.maxAttemptMs >= 0
      ? budget.maxAttemptMs
      : undefined;
  return { maxTotalMs, maxAttemptMs };
};

const normalizeEscalation = (
  escalation?: GrAgentLoopEscalation,
): Required<GrAgentLoopEscalation> => ({
  ...DEFAULT_ESCALATION,
  ...(escalation ?? {}),
  enabled: escalation?.enabled ?? Boolean(escalation),
});

const resolveFidelity = (
  iteration: number,
  bounds: { min: Vec3; max: Vec3 },
  options: {
    gr?: GrAgentLoopGrParams;
    escalation: Required<GrAgentLoopEscalation>;
    ciFastPath: boolean;
  },
): GrAgentLoopFidelity => {
  const base = options.gr ?? {};
  const escalation = options.escalation;
  const step = escalation.enabled ? iteration : 0;
  const baseDims: [number, number, number] = base.dims ?? [32, 32, 32];
  const dims: [number, number, number] = [
    scaleInt(baseDims[0], escalation.dimsScale, step, escalation.maxDims[0]),
    scaleInt(baseDims[1], escalation.dimsScale, step, escalation.maxDims[1]),
    scaleInt(baseDims[2], escalation.dimsScale, step, escalation.maxDims[2]),
  ];
  const baseSteps = base.evolveSteps ?? 8;
  const baseInitialIterations = base.initialIterations ?? 80;
  const baseEvolveIterations = base.evolveIterations ?? 0;
  const initialIterations = scaleInt(
    baseInitialIterations,
    escalation.initialIterationsScale,
    step,
    escalation.maxInitialIterations,
  );
  const evolveSteps = scaleInt(
    baseSteps,
    escalation.stepsScale,
    step,
    escalation.maxSteps,
  );
  const evolveIterations = scaleInt(
    baseEvolveIterations,
    escalation.evolveIterationsScale,
    step,
    escalation.maxEvolveIterations,
  );
  const includeExtraBase = base.includeExtra ?? false;
  const includeExtra =
    includeExtraBase ||
    (escalation.enabled &&
      escalation.includeExtraAfter >= 0 &&
      iteration >= escalation.includeExtraAfter);
  const includeMatter = base.includeMatter ?? includeExtra;
  const includeKij = base.includeKij ?? includeExtra;
  const includeInvariantsBase = base.includeInvariants ?? includeExtra;
  const includeInvariants =
    includeInvariantsBase ||
    (escalation.enabled &&
      escalation.includeExtraAfter >= 0 &&
      iteration >= escalation.includeExtraAfter);
  const evolveDt_s = resolveEvolveDtSeconds(
    bounds,
    dims,
    base.evolveDt_s,
  );

  if (options.ciFastPath) {
    return {
      dims: [Math.min(dims[0], 12), Math.min(dims[1], 12), Math.min(dims[2], 12)],
      bounds,
      unitSystem: base.unitSystem,
      initialIterations: Math.min(initialIterations, 8),
      initialTolerance: base.initialTolerance ?? 0,
      evolveSteps: Math.min(evolveSteps, 1),
      evolveDt_s,
      evolveIterations: Math.min(evolveIterations, 1),
      evolveTolerance: base.evolveTolerance ?? 0,
      // Keep extra channels available so invariants can be materialized for G4 applicability.
      includeExtra: true,
      includeMatter: false,
      includeKij: false,
      // Preserve curvature applicability observability even in fast CI mode.
      includeInvariants: true,
    };
  }

  return {
    dims,
    bounds,
    unitSystem: base.unitSystem,
    initialIterations,
    initialTolerance: base.initialTolerance ?? 0,
    evolveSteps,
    evolveDt_s,
    evolveIterations,
    evolveTolerance: base.evolveTolerance ?? 0,
    includeExtra,
    includeMatter,
    includeKij,
    includeInvariants,
  };
};

export async function runGrAgentLoop(
  options: GrAgentLoopOptions = {},
): Promise<GrAgentLoopResult> {
  return withSpan(
    "gr.agent_loop.run",
    {
      spanKind: "internal",
      attributes: {
        "gr.loop.max_iterations": options.maxIterations ?? 4,
        "gr.loop.commit_accepted": Boolean(options.commitAccepted),
      },
    },
    async (span) => {
      const ciFastPath = Boolean(options.ciFastPath);
      const maxIterations = Math.max(1, ciFastPath ? Math.min(options.maxIterations ?? 4, 1) : options.maxIterations ?? 4);
      const strategy = { ...DEFAULT_STRATEGY, ...(options.strategy ?? {}) };
      const escalation = normalizeEscalation(options.escalation);
      const budget = normalizeBudget(options.budget);
      const baseState = getGlobalPipelineState();
      const baseSnapshot = cloneState(baseState);
      let workingState = cloneState(baseState);
      let acceptedIteration: number | undefined;
      const attempts: GrAgentLoopAttempt[] = [];
      const stateHistory: GrAgentLoopStateEvent[] = [];
      const recordState = (
        state: GrAgentLoopState,
        iteration?: number,
        note?: string,
      ) => {
        stateHistory.push({
          state,
          atMs: Date.now(),
          ...(iteration !== undefined ? { iteration } : {}),
          ...(note ? { note } : {}),
        });
      };
      recordState("idle");
      const runStart = Date.now();
      let budgetExhausted: GrAgentLoopBudgetReport["exhausted"] | undefined;

      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const elapsed = Date.now() - runStart;
        if (budget.maxTotalMs !== undefined && elapsed > budget.maxTotalMs) {
          budgetExhausted = "total";
          recordState("budget-exhausted", iteration, "total-budget");
          break;
        }
        const proposal = options.proposals?.[iteration] ?? buildStrategyProposal(
          workingState,
          strategy,
          iteration,
        );
        recordState("proposing", iteration);
        workingState = await updateParameters(workingState, proposal.params ?? {});
        setGlobalPipelineState(workingState);

        const grRequest = buildGrRequestPayload(workingState);
        const bounds = resolveBounds(workingState, options.gr?.bounds);
        const sourceParams = resolveSourceParams(workingState, bounds);
        const pressureFactor = resolvePressureFactor(workingState);
        const sourceOptions =
          pressureFactor !== undefined ? { pressureFactor } : undefined;
        const fidelity = resolveFidelity(iteration, bounds, {
          gr: options.gr,
          escalation,
          ciFastPath,
        });
        const attemptStart = Date.now();
        recordState("initializing", iteration);
        const initialStart = Date.now();
        const initial = runInitialDataSolve({
          dims: fidelity.dims,
          bounds,
          iterations: fidelity.initialIterations,
          tolerance: fidelity.initialTolerance,
          unitSystem: fidelity.unitSystem,
          stencils: options.gr?.stencils,
          sourceParams,
          sourceOptions,
        });
        const initialMs = Date.now() - initialStart;

        recordState("evolving", iteration);
        const evolveStart = Date.now();
        const evolve = buildGrEvolveBrick({
          dims: fidelity.dims,
          bounds,
          time_s: 0,
          dt_s: fidelity.evolveDt_s,
          steps: fidelity.evolveSteps,
          iterations: fidelity.evolveIterations,
          tolerance: fidelity.evolveTolerance,
          unitSystem: fidelity.unitSystem,
          gauge: options.gr?.gauge,
          stencils: options.gr?.stencils,
          boundary: options.gr?.boundary,
          fixups: options.gr?.fixups,
          includeExtra: fidelity.includeExtra,
          includeMatter: fidelity.includeMatter,
          includeKij: fidelity.includeKij,
          includeInvariants: fidelity.includeInvariants,
          initialState: initial.state,
          matter: initial.matter ?? null,
          sourceParams,
          sourceOptions,
        });
        const evolveMs = Date.now() - evolveStart;
        const diagnostics = buildGrDiagnostics(evolve);

        recordState("evaluating", iteration);
        const evaluationStart = Date.now();
        const evaluationResult = await runGrEvaluation({
          diagnostics,
          snapshot: buildEvaluationSnapshot(workingState, diagnostics),
          warpConfig: resolveWarpConfig(workingState, options.warpConfig),
          thresholds: options.thresholds,
          policy: options.policy,
          useLiveSnapshot: options.useLiveSnapshot,
          useDiagnosticsSnapshot: true,
        });
        const evaluationMs = Date.now() - evaluationStart;

        const accepted =
          evaluationResult.evaluation.pass && initial.solver.status === "CERTIFIED";
        const totalMs = Date.now() - attemptStart;

        attempts.push({
          iteration,
          proposal,
          grRequest,
          fidelity,
          initial: {
            status: initial.solver.status,
            iterations: initial.solver.iterations,
            residual: initial.solver.residual,
            tolerance: initial.solver.tolerance,
            reason: initial.solver.reason,
          },
          evolution: {
            steps: evolve.stats.steps,
            dt_s: evolve.dt_s,
            stats: {
              H_rms: evolve.stats.H_rms,
              M_rms: evolve.stats.M_rms,
              cfl: evolve.stats.cfl,
            },
          },
          evaluation: evaluationResult.evaluation,
          timing: {
            totalMs,
            initialMs,
            evolveMs,
            evaluationMs,
          },
          accepted,
        });

        if (accepted) {
          acceptedIteration = iteration;
          recordState("accepted", iteration);
          break;
        }

        if (budget.maxAttemptMs !== undefined && totalMs > budget.maxAttemptMs) {
          budgetExhausted = "attempt";
          recordState("budget-exhausted", iteration, "attempt-budget");
          break;
        }

        const totalElapsed = Date.now() - runStart;
        if (budget.maxTotalMs !== undefined && totalElapsed > budget.maxTotalMs) {
          budgetExhausted = "total";
          recordState("budget-exhausted", iteration, "total-budget");
          break;
        }
      }

      if (acceptedIteration === undefined && !budgetExhausted) {
        const lastIteration = attempts.length
          ? attempts[attempts.length - 1].iteration
          : undefined;
        recordState("rejected", lastIteration);
      }

      const shouldCommit =
        options.commitAccepted && acceptedIteration !== undefined;
      if (!shouldCommit) {
        setGlobalPipelineState(baseSnapshot);
      }
      recordState(shouldCommit ? "completed" : "restored");

      const totalMs = Date.now() - runStart;
      const state: GrAgentLoopState =
        acceptedIteration !== undefined
          ? "accepted"
          : budgetExhausted
            ? "budget-exhausted"
            : "rejected";
      const result = {
        accepted: acceptedIteration !== undefined,
        ...(acceptedIteration !== undefined ? { acceptedIteration } : {}),
        attempts,
        finalState: shouldCommit ? workingState : baseSnapshot,
        restored: !shouldCommit,
        state,
        stateHistory,
        budget: {
          ...budget,
          totalMs,
          ...(budgetExhausted ? { exhausted: budgetExhausted } : {}),
        },
      };

      span.addAttributes({
        "gr.loop.accepted": result.accepted,
        "gr.loop.attempts": attempts.length,
        "gr.loop.state": state,
        "gr.loop.duration_ms": totalMs,
      });
      span.status = result.accepted
        ? { code: "OK" }
        : { code: "ERROR", message: state };
      return result;
    },
  );
}
