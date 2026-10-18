import type { SectorControlMode, SectorControlPlan } from "@shared/schema";
import type { EnergyPipelineState } from "../energy-pipeline";
import { evaluateGrConstraintGateFromDiagnostics } from "../gr/constraint-evaluator.js";
import { buildSectorControlPlan, type SectorControlPlannerResult } from "./sectorControlPlanner";

type OperationalMode = EnergyPipelineState["currentMode"];

const MODE_TO_SECTOR_MODE: Record<OperationalMode, SectorControlMode> = {
  standby: "qi_conservative",
  emergency: "qi_conservative",
  nearzero: "diagnostic",
  taxi: "stability_scan",
  hover: "theta_balanced",
  cruise: "theta_balanced",
};

const positiveOrUndefined = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function resolveFordRomanStatus(
  state: EnergyPipelineState,
): SectorControlPlan["constraints"]["FordRomanQI"] {
  if (typeof state.fordRomanCompliance === "boolean") {
    return state.fordRomanCompliance ? "pass" : "fail";
  }
  return "unknown";
}

function resolveThetaAuditStatus(
  state: EnergyPipelineState,
): SectorControlPlan["constraints"]["ThetaAudit"] {
  if (typeof state.natarioConstraint === "boolean") {
    return state.natarioConstraint ? "pass" : "fail";
  }
  const thetaAudit = Number(
    (state as any).theta_audit ?? (state as any).thetaCal ?? (state as any).thetaScaleExpected,
  );
  if (!Number.isFinite(thetaAudit)) return "unknown";
  const thetaLimit = Number(
    (state as any).theta_max ?? (state as any).thetaMax ?? (state as any).thetaLimit ?? 4.4e10,
  );
  if (!Number.isFinite(thetaLimit) || thetaLimit <= 0) return "unknown";
  return Math.abs(thetaAudit) <= thetaLimit ? "pass" : "fail";
}

function resolveGrConstraintStatus(
  state: EnergyPipelineState,
): SectorControlPlan["constraints"]["grConstraintGate"] {
  if (!state.gr?.constraints) {
    return "pass";
  }
  const gateEval = evaluateGrConstraintGateFromDiagnostics(state.gr.constraints);
  if (gateEval.gate.status === "pass") return "pass";
  if (gateEval.gate.status === "fail") return "fail";
  return "unknown";
}

export function resolveModeFallbackMode(requestedMode: OperationalMode): OperationalMode {
  if (requestedMode === "standby") return "standby";
  if (requestedMode === "emergency") return "standby";
  return "emergency";
}

export type ModeTransitionSectorPreflight = {
  required: true;
  requestedMode: OperationalMode;
  plannerMode: SectorControlMode;
  plannerResult: SectorControlPlannerResult;
  fallbackMode: OperationalMode | null;
  fallbackApplied: boolean;
};

export function runModeTransitionSectorPreflight(
  state: EnergyPipelineState,
  requestedMode: OperationalMode,
): ModeTransitionSectorPreflight {
  const plannerMode = MODE_TO_SECTOR_MODE[requestedMode];
  const plannerResult = buildSectorControlPlan({
    mode: plannerMode,
    timing: {
      strobeHz: positiveOrUndefined((state as any).strobeHz),
      sectorPeriod_ms: positiveOrUndefined((state as any).sectorPeriod_ms),
      TS_ratio: positiveOrUndefined(state.TS_ratio),
      tauLC_ms: positiveOrUndefined((state as any).tauLC_ms),
      tauPulse_ms: positiveOrUndefined((state as any).tauPulse_ms),
    },
    allocation: {
      sectorCount: Number.isFinite(state.sectorCount) ? Number(state.sectorCount) : undefined,
      concurrentSectors: Number.isFinite(state.concurrentSectors)
        ? Number(state.concurrentSectors)
        : undefined,
      negativeFraction: Number.isFinite(state.negativeFraction)
        ? Number(state.negativeFraction)
        : undefined,
    },
    duty: {
      dutyCycle: Number.isFinite(state.dutyCycle) ? Number(state.dutyCycle) : undefined,
      dutyBurst: Number.isFinite((state as any).dutyBurst)
        ? Number((state as any).dutyBurst)
        : undefined,
      dutyShip: Number.isFinite(state.dutyShip) ? Number(state.dutyShip) : undefined,
    },
    constraints: {
      FordRomanQI: resolveFordRomanStatus(state),
      ThetaAudit: resolveThetaAuditStatus(state),
      grConstraintGate: resolveGrConstraintStatus(state),
    },
  });

  const fallbackMode = plannerResult.ok ? null : resolveModeFallbackMode(requestedMode);
  return {
    required: true,
    requestedMode,
    plannerMode,
    plannerResult,
    fallbackMode,
    fallbackApplied: Boolean(fallbackMode && fallbackMode !== requestedMode),
  };
}
