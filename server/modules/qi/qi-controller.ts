import express from "express";
import type {
  QiControllerState,
  QiTileTelemetry,
  QiTileControllerState,
  QiSetpointSuggestion,
  QiControllerSafetyState,
  SamplingKind,
} from "../../../shared/schema.js";
import { qiSetpointSuggestionSchema } from "../../../shared/schema.js";
import { qiBound_Jm3 } from "../../qi/qi-bounds.js";
import { computeSectorPhaseOffsets } from "../../energy/phase-scheduler.js";
import { getGlobalPipelineState } from "../../energy-pipeline.js";
import { HBAR, C } from "../../physics-const.js";
import type { RawTileInput } from "../../qi/qi-saturation.js";
import { updatePipelineQiTiles } from "../../qi/pipeline-qi-stream.js";
import { PROMOTED_WARP_PROFILE } from "../../../shared/warp-promoted-profile.js";

const NM_TO_M = 1e-9;
const CASIMIR_COEFF = ((Math.PI ** 2) * HBAR * C) / 720;
const DEG2RAD = Math.PI / 180;

type TileRuntime = {
  telemetry: QiTileTelemetry;
  prevSetpoint: {
    gap: number;
    duty: number;
  };
  pendingUserInput?: boolean;
  diagnostics?: TileDiagnostics;
};

type TileDiagnostics = {
  margin_Jm3: number;
  safetyBound_Jm3: number;
  rhoAvg_Jm3: number;
};

type TileRole = "neg" | "pos" | "neutral";

type ControllerIntentInternal = {
  intent: QiSetpointSuggestion["intent"];
  aggressiveness: number;
  issuedAt: number;
  expiresAt: number;
  summary?: string;
};

const envelopeGain: Record<string, number> = {
  rectangular: 1,
  gaussian: 0.92,
  raised_cosine: 0.88,
};

const clamp01 = (value: number) => clampNumber(value, 0, 1);

const DEFAULTS = {
  cadenceHz: Math.max(5, Math.min(50, Number(process.env.QI_CONTROLLER_HZ) || 20)),
  guardFrac: clamp01(Number(process.env.QI_GUARD_FRAC ?? process.env.QI_GUARD) || 0.12),
  intentHoldMs: Number(process.env.QI_INTENT_HOLD_MS) || 12_000,
  gapStep_nm: Number(process.env.QI_MAX_GAP_STEP_NM) || 10,
  dutyStep: clamp01(Number(process.env.QI_MAX_DUTY_STEP) || 0.02),
  dutyMin: clamp01(Number(process.env.QI_DUTY_MIN) || 0.001),
  dutyMax: clamp01(Number(process.env.QI_DUTY_MAX) || 0.35),
  repRateHz: Number(process.env.QI_REP_RATE_HZ) || 1000,
};

const MARGIN_CONFIG = {
  target: Math.max(0.05, Number(process.env.QI_MARGIN_OK_JM3 ?? process.env.QI_MARGIN_TARGET_JM3) || 0.5),
  hysteresis: Math.max(0.1, Number(process.env.QI_MARGIN_HYSTERESIS_JM3 ?? process.env.QI_MARGIN_HYST_JM3) || 0.5),
  paybackFraction: clamp01(Number(process.env.QI_PAYBACK_SECTOR_FRAC) || 0.04),
  paybackMin: Math.max(1, Math.round(Number(process.env.QI_PAYBACK_SECTOR_MIN) || 12)),
};

export class QiController {
  private tiles = new Map<string, TileRuntime>();
  private intents: ControllerIntentInternal[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastState: QiControllerState = {
    updatedAt: Date.now(),
    safetyState: "HARD_STOP",
    marginMin_Jm3: 0,
    tiles: [],
    notes: ["controller-initializing"],
  };
  private lastCycleMs = 0;
  private evaluating = false;
  private lastStaggering: QiControllerState["staggering"] | undefined;
  private lastNegSectors = new Set<number>();
  private lastPosSectors = new Set<number>();
  private lastWeightVector: number[] = [];
  private paybackTargets = new Set<number>();
  private marginMode: "increase_margin" | "hold" = "increase_margin";

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(10, Math.round(1000 / DEFAULTS.cadenceHz));
    this.timer = setInterval(() => {
      this.step();
    }, intervalMs);
    // Run once immediately so the API has data before the first tick interval.
    this.step();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): QiControllerState {
    return this.lastState;
  }

  ingestTileTelemetry(update: Partial<QiTileTelemetry> & { tileId: string }): void {
    if (!update?.tileId) return;
    const now = Date.now();
    const runtime = this.tiles.get(update.tileId);
    if (runtime) {
      runtime.telemetry = {
        ...runtime.telemetry,
        ...update,
        telemetryAt: now,
      } as QiTileTelemetry;
      runtime.pendingUserInput = true;
      return;
    }
    // If the tile does not exist yet, seed it with a conservative default
    const tau = update.tau_s && update.tau_s > 0 ? update.tau_s : 5e-3;
    const newTile: QiTileTelemetry = {
      tileId: update.tileId,
      label: update.label ?? update.tileId,
      gap_nm: update.gap_nm ?? 80,
      gapMin_nm: update.gapMin_nm ?? 20,
      gapMax_nm: update.gapMax_nm ?? 400,
      maxDeltaGap_nm_perTick: update.maxDeltaGap_nm_perTick ?? DEFAULTS.gapStep_nm,
      duty: clamp01(update.duty ?? PROMOTED_WARP_PROFILE.dutyCycle),
      dutyMin: clamp01(update.dutyMin ?? DEFAULTS.dutyMin),
      dutyMax: clamp01(update.dutyMax ?? DEFAULTS.dutyMax),
      maxDutyStep: clamp01(update.maxDutyStep ?? DEFAULTS.dutyStep),
      Q_eff: update.Q_eff ?? 1e6,
      Q_min: update.Q_min ?? 1e5,
      temperatureK: update.temperatureK ?? 4,
      T_maxK: update.T_maxK ?? 15,
      area_mm2: update.area_mm2 ?? 50,
      gammaGeo: update.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo,
      roughness_nm: update.roughness_nm ?? 1,
      fieldType: update.fieldType ?? "em",
      kernelType: update.kernelType ?? "lorentzian",
      tau_s: tau,
      guardBandFrac: update.guardBandFrac ?? DEFAULTS.guardFrac,
      dutyNominal: update.duty ?? PROMOTED_WARP_PROFILE.dutyCycle,
      envelopeType: update.envelopeType ?? "rectangular",
      sectorId: update.sectorId ?? 0,
      drivePhase_rad: update.drivePhase_rad ?? 0,
      repRate_Hz: update.repRate_Hz ?? DEFAULTS.repRateHz,
      safetySigma_Jm3: update.safetySigma_Jm3 ?? 80,
      tauKernel_s: update.tauKernel_s ?? tau,
      slewLimit_nm_per_s: update.slewLimit_nm_per_s ?? DEFAULTS.gapStep_nm * DEFAULTS.repRateHz,
      telemetryAt: now,
    };
    this.tiles.set(update.tileId, {
      telemetry: newTile,
      prevSetpoint: { gap: newTile.gap_nm, duty: newTile.duty },
      pendingUserInput: true,
    });
  }

  applySuggestion(payload: QiSetpointSuggestion): QiControllerState {
    const now = Date.now();
    if (payload.intent === "hold") {
      this.intents = [];
    } else {
      const intent: ControllerIntentInternal = {
        intent: payload.intent,
        aggressiveness: clamp01(payload.aggressiveness ?? 0.5),
        issuedAt: now,
        expiresAt: now + DEFAULTS.intentHoldMs,
        summary: payload.notes,
      };
      this.intents = [intent];
    }

    if (Array.isArray(payload.tiles)) {
      for (const spec of payload.tiles) {
        const runtime = this.tiles.get(spec.tileId);
        if (!runtime) continue;
        const next = { ...runtime.telemetry };
        if (typeof spec.gap_nm === "number" && Number.isFinite(spec.gap_nm)) {
          next.gap_nm = clampNumber(spec.gap_nm, next.gapMin_nm, next.gapMax_nm);
          runtime.pendingUserInput = true;
        }
        if (typeof spec.duty === "number" && Number.isFinite(spec.duty)) {
          next.duty = clampNumber(spec.duty, next.dutyMin, next.dutyMax);
          runtime.pendingUserInput = true;
        }
        if (typeof spec.tau_s === "number" && spec.tau_s > 0) {
          next.tau_s = spec.tau_s;
        }
        runtime.telemetry = next;
      }
    }

    // Recompute immediately to reflect the new intent
    this.step();
    return this.lastState;
  }

  private step(): void {
    if (this.evaluating) return;
    this.evaluating = true;
    const start = performanceNow();
    try {
      this.cleanupIntents();
      this.syncFromPipeline();
      const tiles = Array.from(this.tiles.values());
      if (tiles.length === 0) {
        this.lastState = {
          updatedAt: Date.now(),
          safetyState: "HARD_STOP",
          marginMin_Jm3: 0,
          tiles: [],
          notes: ["no-tiles-configured"],
        };
        return;
      }
      this.updatePaybackTargets();
      const results: QiTileControllerState[] = [];
      let minMargin = Number.POSITIVE_INFINITY;
      let aggregateSafety: QiControllerSafetyState = "OK";
      let achievedEnergy = 0;
      let targetEnergy = 0;
      let paybackAchieved = 0;
      for (const runtime of tiles) {
        const state = this.solveTile(runtime);
        results.push(state);
        if (state.margin_Jm3 < minMargin) minMargin = state.margin_Jm3;
        if (state.margin_Jm3 >= MARGIN_CONFIG.target) paybackAchieved += 1;
        if (state.safetyState === "QI_AT_RISK" || state.safetyState === "HARD_STOP") {
          aggregateSafety = "QI_AT_RISK";
        } else if (aggregateSafety === "OK" && state.margin_Jm3 < MARGIN_CONFIG.target) {
          aggregateSafety = "MARGIN_LOW";
        }
        achievedEnergy += Math.abs(Math.min(0, state.rhoAvg_Jm3));
        targetEnergy += Math.abs(Math.min(0, state.bound_Jm3 + state.guardBand_Jm3));
      }

      const now = Date.now();
      const marginMin = Number.isFinite(minMargin) ? minMargin : 0;
      this.updateMarginMode(marginMin);
      if (aggregateSafety !== "QI_AT_RISK") {
        aggregateSafety = this.marginMode === "hold" ? "OK" : "MARGIN_LOW";
      }
      const paybackRequired = this.computePaybackRequirement(results.length);
      this.lastState = {
        updatedAt: now,
        cycleTime_ms: performanceNow() - start,
        safetyState: aggregateSafety,
        marginMin_Jm3: marginMin,
        marginTarget_Jm3: MARGIN_CONFIG.target,
        marginHysteresis_Jm3: MARGIN_CONFIG.hysteresis,
        marginMode: this.marginMode,
        tiles: results.sort((a, b) => a.sectorId - b.sectorId),
        optimizer: {
          iterations: 1,
          infeasible: aggregateSafety === "QI_AT_RISK",
          targetEnergy_Jm3: targetEnergy,
          achievedEnergy_Jm3: achievedEnergy,
        },
        intents: this.intents.map((intent) => ({
          intent: intent.intent,
          aggressiveness: intent.aggressiveness,
          issuedAt: intent.issuedAt,
          expiresAt: intent.expiresAt,
          summary: intent.summary,
        })),
        staggering: this.lastStaggering,
        payback: {
          required: paybackRequired,
          achieved: paybackAchieved,
          sectors: Array.from(this.paybackTargets).sort((a, b) => a - b),
        },
      };
      this.publishTilesToStream(this.lastState);
      this.lastCycleMs = this.lastState.cycleTime_ms ?? 0;
    } finally {
      this.evaluating = false;
    }
  }

  private solveTile(runtime: TileRuntime): QiTileControllerState {
    const telem = runtime.telemetry;
    const sectorId = telem.sectorId ?? -1;
    const role = this.classifySector(sectorId);
    const weight = this.sectorWeight(sectorId);
    const limits = this.resolveTileLimits(telem);
    let guardBand = limits.guardBand_Jm3;
    const safetyBound = limits.safetyBound_Jm3;
    const bound_Jm3 = limits.bound_Jm3;
    const repRate = limits.repRateHz;
    const maxDutyStepBase = telem.maxDutyStep ?? DEFAULTS.dutyStep;
    const maxGapStepBase = telem.maxDeltaGap_nm_perTick ?? DEFAULTS.gapStep_nm;
    const dutyStepLimit = role === "neg" ? maxDutyStepBase * 0.75 : maxDutyStepBase;
    const maxGapForRole = role === "neg" ? maxGapStepBase * 0.85 : maxGapStepBase;
    const activeIntent = this.intents[0];

    if (activeIntent) {
      if (activeIntent.intent === "increase_margin") {
        guardBand *= 1 + 0.8 * activeIntent.aggressiveness;
      } else if (activeIntent.intent === "increase_negative_energy") {
        guardBand *= Math.max(0.2, 1 - 0.7 * activeIntent.aggressiveness);
      }
    }
    if (role === "neg") {
      guardBand *= 0.7;
    } else if (role === "pos") {
      guardBand *= 1.4;
    }

    const prev = runtime.prevSetpoint;
    let dutyTarget = clampNumber(telem.duty, telem.dutyMin, telem.dutyMax);
    let gapTarget = clampNumber(telem.gap_nm, telem.gapMin_nm, telem.gapMax_nm);

    dutyTarget = clampNumber(
      dutyTarget,
      Math.max(telem.dutyMin, prev.duty - dutyStepLimit),
      Math.min(telem.dutyMax, prev.duty + dutyStepLimit),
    );
    gapTarget = clampNumber(
      gapTarget,
      Math.max(telem.gapMin_nm, prev.gap - maxGapForRole),
      Math.min(telem.gapMax_nm, prev.gap + maxGapForRole),
    );

    let rhoEff = rhoEff_Jm3(gapTarget, telem);
    let rhoAvg = rhoAvg_Jm3(rhoEff, dutyTarget, telem, repRate);
    let margin = rhoAvg - safetyBound;

    const marginGoal = this.computeMarginGoal(role, guardBand, weight, activeIntent);
    let iterations = 0;
    while (margin < marginGoal && iterations < 4) {
      let adjusted = false;
      if (Math.abs(rhoAvg) > 0) {
        const desiredAvg = safetyBound + marginGoal;
        const ratio = Math.abs(desiredAvg) / Math.max(1e-9, Math.abs(rhoAvg));
        const nextDuty = clampNumber(dutyTarget * ratio, telem.dutyMin, telem.dutyMax);
        if (Math.abs(nextDuty - dutyTarget) > 1e-4) {
          dutyTarget = clampNumber(
            nextDuty,
            Math.max(telem.dutyMin, prev.duty - dutyStepLimit),
            Math.min(telem.dutyMax, prev.duty + dutyStepLimit),
          );
          adjusted = true;
        }
      }
      rhoEff = rhoEff_Jm3(gapTarget, telem);
      rhoAvg = rhoAvg_Jm3(rhoEff, dutyTarget, telem, repRate);
      margin = rhoAvg - safetyBound;

      if (margin < marginGoal) {
        const desiredAvg = safetyBound + marginGoal;
        const ratio = Math.abs(rhoAvg) / Math.max(1e-9, Math.abs(desiredAvg));
        const gapScale = Math.pow(ratio, 0.25);
        const nextGap = clampNumber(gapTarget * gapScale, telem.gapMin_nm, telem.gapMax_nm);
        if (Math.abs(nextGap - gapTarget) > 1e-3) {
          gapTarget = clampNumber(
            nextGap,
            Math.max(telem.gapMin_nm, prev.gap - maxGapForRole),
            Math.min(telem.gapMax_nm, prev.gap + maxGapForRole),
          );
          adjusted = true;
        }
      }

      rhoEff = rhoEff_Jm3(gapTarget, telem);
      rhoAvg = rhoAvg_Jm3(rhoEff, dutyTarget, telem, repRate);
      margin = rhoAvg - safetyBound;
      if (!adjusted) break;
      iterations += 1;
    }

    if (activeIntent?.intent === "increase_negative_energy" && margin > marginGoal * 1.4) {
      const desired = safetyBound + marginGoal * Math.max(0.3, 1 - 0.5 * activeIntent.aggressiveness);
      if (desired < rhoAvg) {
        const ratio = Math.abs(desired) / Math.max(1e-9, Math.abs(rhoAvg));
        dutyTarget = clampNumber(dutyTarget * ratio, telem.dutyMin, telem.dutyMax);
        const gapScale = Math.pow(Math.abs(rhoAvg) / Math.max(1e-9, Math.abs(desired)), 0.25);
        const candidateGap = clampNumber(gapTarget / gapScale, telem.gapMin_nm, telem.gapMax_nm);
        gapTarget = clampNumber(
          candidateGap,
          Math.max(telem.gapMin_nm, prev.gap - maxGapForRole),
          Math.min(telem.gapMax_nm, prev.gap + maxGapForRole),
        );
        rhoEff = rhoEff_Jm3(gapTarget, telem);
        rhoAvg = rhoAvg_Jm3(rhoEff, dutyTarget, telem, repRate);
        margin = rhoAvg - safetyBound;
      }
    }

    runtime.prevSetpoint = { gap: gapTarget, duty: dutyTarget };
    runtime.pendingUserInput = false;
    runtime.diagnostics = {
      margin_Jm3: margin,
      safetyBound_Jm3: safetyBound,
      rhoAvg_Jm3: rhoAvg,
    };

    const limitFlags: string[] = [];
    if (Math.abs(gapTarget - telem.gapMin_nm) < 1e-3) limitFlags.push("gap-min");
    if (Math.abs(gapTarget - telem.gapMax_nm) < 1e-3) limitFlags.push("gap-max");
    if (Math.abs(dutyTarget - telem.dutyMin) < 1e-5) limitFlags.push("duty-min");
    if (Math.abs(dutyTarget - telem.dutyMax) < 1e-5) limitFlags.push("duty-max");

    let safetyState: QiControllerSafetyState = "OK";
    if (margin < 0) safetyState = "QI_AT_RISK";
    else if (margin < MARGIN_CONFIG.target) safetyState = "MARGIN_LOW";

    const suggestions: string[] = [];
    if (role === "pos") suggestions.push("payback-target");
    if (margin < 0) suggestions.push("margin-negative");
    else if (margin < marginGoal) suggestions.push("margin-ramping");

    return {
      tileId: telem.tileId,
      label: telem.label,
      sectorId: telem.sectorId,
      drivePhase_rad: telem.drivePhase_rad,
      drivePhaseTarget_rad: telem.drivePhase_rad,
      gap_nm: telem.gap_nm,
      gapTarget_nm: gapTarget,
      gapMin_nm: telem.gapMin_nm,
      gapMax_nm: telem.gapMax_nm,
      duty: telem.duty,
      dutyTarget,
      dutyMin: telem.dutyMin,
      dutyMax: telem.dutyMax,
      tau_s: telem.tau_s,
      fieldType: telem.fieldType,
      kernelType: telem.kernelType,
      envelopeType: telem.envelopeType,
      rhoEff_Jm3: rhoEff,
      rhoAvg_Jm3: rhoAvg,
      bound_Jm3,
      guardBand_Jm3: guardBand,
      safetyBound_Jm3: safetyBound,
      margin_Jm3: margin,
      targetMargin_Jm3: marginGoal,
      qEff: telem.Q_eff,
      temperatureK: telem.temperatureK,
      T_maxK: telem.T_maxK,
      limitFlags: limitFlags.length ? limitFlags : undefined,
      suggestions: suggestions.length ? suggestions : undefined,
      role,
      safetyState,
      slewActive:
        Math.abs(gapTarget - telem.gap_nm) > 1e-3 ||
        Math.abs(dutyTarget - telem.duty) > 1e-5,
      pendingUserInput: runtime.pendingUserInput,
    };
  }

  private resolveTileLimits(tile: QiTileTelemetry): {
    repRateHz: number;
    bound_Jm3: number;
    guardBand_Jm3: number;
    safetyBound_Jm3: number;
  } {
    const repRateHz = tile.repRate_Hz > 0 ? tile.repRate_Hz : DEFAULTS.repRateHz;
    const { bound_Jm3, safetySigma_Jm3 } = qiBound_Jm3({
      tau_s: tile.tau_s,
      fieldType: tile.fieldType,
      kernelType: tile.kernelType,
      safetySigma_Jm3: tile.safetySigma_Jm3,
    });
    const guardFrac = tile.guardBandFrac ?? DEFAULTS.guardFrac;
    const guardFloor = Math.max(1e-4, MARGIN_CONFIG.target);
    const guardBand_Jm3 = Math.max(guardFloor, Math.abs(bound_Jm3) * guardFrac);
    const sigmaRaw = Number.isFinite(safetySigma_Jm3) ? Math.max(0, safetySigma_Jm3) : 0;
    const sigmaLimitFromBound = Math.max(1e-6, Math.abs(bound_Jm3) - 1e-6);
    const sigmaLimit = Math.min(
      sigmaLimitFromBound,
      Math.max(guardBand_Jm3, MARGIN_CONFIG.target),
    );
    const sigmaClamp = clampNumber(sigmaRaw, 0, sigmaLimit);
    const safetyCap = -Math.max(guardBand_Jm3, MARGIN_CONFIG.target);
    const safetyBound_Jm3 = Math.min(bound_Jm3 + sigmaClamp, safetyCap);
    return { repRateHz, bound_Jm3, guardBand_Jm3, safetyBound_Jm3 };
  }

  private computeMarginGoal(
    role: TileRole,
    guardBand: number,
    weight: number,
    activeIntent?: ControllerIntentInternal,
  ): number {
    let goal = guardBand;
    if (role === "pos") {
      goal = Math.max(MARGIN_CONFIG.target, guardBand * (1 + 0.4 * weight));
    } else if (role === "neg") {
      const weightBias = clampNumber(1 - weight, 0, 1);
      const guardFrac = clampNumber(0.2 + 0.25 * weightBias, 0.15, 0.45);
      const targetFrac = clampNumber(0.35 + 0.25 * weightBias, 0.25, 0.65);
      const guardScaled = guardBand * guardFrac;
      const targetScaled = MARGIN_CONFIG.target * targetFrac;
      goal = Math.max(0, Math.min(guardScaled, targetScaled));
    } else {
      goal = Math.max(guardBand, MARGIN_CONFIG.target * 0.85);
    }
    if (activeIntent) {
      if (activeIntent.intent === "increase_margin") {
        goal *= 1 + 0.8 * activeIntent.aggressiveness;
      } else if (activeIntent.intent === "increase_negative_energy") {
        goal *= Math.max(0.35, 1 - 0.6 * activeIntent.aggressiveness);
      }
    }
    return Math.max(0, goal);
  }

  private estimateMargin(runtime: TileRuntime): number {
    if (runtime.diagnostics) return runtime.diagnostics.margin_Jm3;
    const telem = runtime.telemetry;
    const limits = this.resolveTileLimits(telem);
    const rhoEff = rhoEff_Jm3(telem.gap_nm, telem);
    const rhoAvg = rhoAvg_Jm3(rhoEff, telem.duty, telem, limits.repRateHz);
    return rhoAvg - limits.safetyBound_Jm3;
  }

  private computePaybackRequirement(count: number): number {
    if (count <= 0) return 0;
    const frac = Math.round(count * MARGIN_CONFIG.paybackFraction);
    const required = Math.max(MARGIN_CONFIG.paybackMin, frac);
    return Math.min(count, required);
  }

  private updatePaybackTargets(): void {
    const tiles = Array.from(this.tiles.values());
    const required = this.computePaybackRequirement(tiles.length);
    if (!required) {
      this.paybackTargets.clear();
      return;
    }
    const ranked = tiles
      .map((runtime) => {
        const telem = runtime.telemetry;
        const sectorId = telem.sectorId ?? -1;
        const margin = this.estimateMargin(runtime);
        const weight = this.sectorWeight(sectorId);
        const roleBias = this.lastPosSectors.has(sectorId)
          ? 0.15
          : this.lastNegSectors.has(sectorId)
            ? -0.15
            : 0;
        return {
          sectorId,
          score: margin + weight * 0.2 + roleBias,
        };
      })
      .filter((entry) => entry.sectorId >= 0)
      .sort((a, b) => b.score - a.score);
    this.paybackTargets = new Set(ranked.slice(0, required).map((entry) => entry.sectorId));
  }

  private updateMarginMode(minMargin: number): void {
    if (!Number.isFinite(minMargin)) return;
    if (minMargin < 0) {
      this.marginMode = "increase_margin";
      return;
    }
    const resume = Math.max(0, MARGIN_CONFIG.target - MARGIN_CONFIG.hysteresis);
    if (this.marginMode === "hold" && minMargin <= resume) {
      this.marginMode = "increase_margin";
    } else if (this.marginMode !== "hold" && minMargin >= MARGIN_CONFIG.target) {
      this.marginMode = "hold";
    }
  }

  private cleanupIntents(): void {
    const now = Date.now();
    this.intents = this.intents.filter((intent) => intent.expiresAt > now);
  }

  private syncFromPipeline(): void {
    let pipeline;
    try {
      pipeline = getGlobalPipelineState();
    } catch {
      return;
    }
    if (!pipeline) return;

    const sectors = Math.max(
      1,
      Math.floor(
        pipeline.phaseSchedule?.N ??
          pipeline.sectorCount ??
          pipeline.tilesPerSector ??
          1,
      ),
    );
    const repRateHz =
      pipeline.sectorPeriod_ms && pipeline.sectorPeriod_ms > 0
        ? 1000 / pipeline.sectorPeriod_ms
        : pipeline.strobeHz ?? DEFAULTS.repRateHz;
    const tau_ms =
      pipeline.qi?.tau_s_ms ??
      Number(process.env.QI_TAU_MS) ??
      PROMOTED_WARP_PROFILE.qi.tau_s_ms;
    const tau_s = Math.max(1e-6, tau_ms / 1000);
    const sampler: SamplingKind = pipeline.qi?.sampler ?? "lorentzian";
    const baseGap = pipeline.gap_nm ?? PROMOTED_WARP_PROFILE.gap_nm;
    const baseDuty =
      pipeline.dutyEffectiveFR ??
      pipeline.localBurstFrac ??
      pipeline.dutyCycle ??
      PROMOTED_WARP_PROFILE.dutyCycle;
    const qEff = Math.max(1e4, pipeline.qCavity ?? PROMOTED_WARP_PROFILE.qCavity);
    const temperature = pipeline.temperature_K ?? 4;
    const area_mm2 = Math.max(1, (pipeline.tileArea_cm2 ?? 0.5) * 100);
    const gammaGeo = Math.max(1, pipeline.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo);
    const negFrac = clamp01(pipeline.negativeFraction ?? 0.4);
    const phaseSchedule = pipeline.phaseSchedule;
    const phaseOffsets = phaseSchedule?.phi_deg_by_sector?.map((deg) => deg * DEG2RAD);
    if (phaseOffsets) {
      this.lastStaggering = {
        strategy: "pipeline",
        repRate_Hz: repRateHz,
        tau_s,
        phaseOffsets_rad: phaseOffsets,
        sectorPeriod_ms: pipeline.sectorPeriod_ms ?? 1000 / repRateHz,
        sectorCount: sectors,
        negSectors: phaseSchedule?.negSectors,
        posSectors: phaseSchedule?.posSectors,
        weights: phaseSchedule?.weights,
      };
    } else {
      const schedule = computeSectorPhaseOffsets({
        N: sectors,
        sectorPeriod_ms: pipeline.sectorPeriod_ms ?? 1000 / repRateHz,
        phase01: pipeline.phaseSchedule?.phase01 ?? 0,
        tau_s_ms: tau_s * 1000,
        sampler,
        negativeFraction: negFrac,
      });
      this.lastStaggering = {
        strategy: "uniform",
        repRate_Hz: repRateHz,
        tau_s,
        phaseOffsets_rad: schedule.phi_deg_by_sector.map((deg) => deg * DEG2RAD),
        sectorPeriod_ms: pipeline.sectorPeriod_ms ?? 1000 / repRateHz,
        sectorCount: sectors,
        negSectors: schedule.negSectors,
        posSectors: schedule.posSectors,
        weights: schedule.weights,
      };
    }

    const negSet = new Set(this.lastStaggering?.negSectors ?? []);
    const posSet = new Set(this.lastStaggering?.posSectors ?? []);
    this.lastNegSectors = negSet;
    this.lastPosSectors = posSet;
    this.lastWeightVector = this.lastStaggering?.weights ?? [];
    const activeIds = new Set<string>();

    for (let sectorId = 0; sectorId < sectors; sectorId += 1) {
      const tileId = `sector-${sectorId}`;
      activeIds.add(tileId);
      const runtime = this.tiles.get(tileId);
      const existing = runtime?.telemetry;
      const sectorRole = negSet.has(sectorId)
        ? "neg"
        : posSet.has(sectorId)
          ? "pos"
          : "neutral";
      const phaseWeight = this.lastStaggering?.weights?.[sectorId] ?? 0.5;
      const gapMinSeed = Math.max(5, baseGap - 220);
      const gapMaxSeed = baseGap + 240;
      const gapMin_nm =
        existing?.gapMin_nm ??
        (sectorRole === "neg" ? Math.max(5, baseGap - 260) : gapMinSeed);
      const gapMax_nm =
        existing?.gapMax_nm ??
        (sectorRole === "pos" ? baseGap + 900 : gapMaxSeed);
      const gapScale =
        sectorRole === "neg"
          ? clampNumber(0.55 - 0.25 * phaseWeight, 0.3, 0.9)
          : sectorRole === "pos"
            ? clampNumber(1.6 + 0.5 * (1 - phaseWeight), 1.2, 3.2)
            : clampNumber(1 + 0.1 * (0.5 - phaseWeight), 0.8, 1.2);
      const gapSeed = clampNumber(
        (existing?.gap_nm ?? baseGap) * gapScale,
        gapMin_nm,
        gapMax_nm,
      );
      const dutyMinRole =
        sectorRole === "pos"
          ? Math.min(existing?.dutyMin ?? DEFAULTS.dutyMin, 1e-4)
          : existing?.dutyMin ?? DEFAULTS.dutyMin;
      const dutyMaxRole =
        sectorRole === "neg"
          ? Math.max(
              existing?.dutyMax ?? DEFAULTS.dutyMax,
              clampNumber(baseDuty * 2, DEFAULTS.dutyMin, DEFAULTS.dutyMax),
            )
          : existing?.dutyMax ?? Math.max(DEFAULTS.dutyMin, baseDuty * 1.2);
      const dutyBias =
        sectorRole === "neg"
          ? clampNumber(1.5 + 0.4 * phaseWeight, 1, 2.3)
          : sectorRole === "pos"
            ? 0.02
            : 0.6;
      const weightBias = clampNumber(0.7 + 0.6 * phaseWeight, 0.4, 1.4);
      const dutySeed = (existing?.duty ?? baseDuty) * dutyBias * weightBias;
      const duty = clampNumber(dutySeed, dutyMinRole, dutyMaxRole);
      const telem: QiTileTelemetry = {
        tileId,
        label: existing?.label ?? `Sector ${sectorId + 1}`,
        gap_nm: gapSeed,
        gapMin_nm,
        gapMax_nm,
        maxDeltaGap_nm_perTick: existing?.maxDeltaGap_nm_perTick ?? DEFAULTS.gapStep_nm,
        duty,
        dutyMin: dutyMinRole,
        dutyMax: dutyMaxRole,
        maxDutyStep: existing?.maxDutyStep ?? DEFAULTS.dutyStep,
        Q_eff: existing?.Q_eff ?? qEff,
        Q_min: existing?.Q_min ?? qEff * 0.25,
        temperatureK: existing?.temperatureK ?? temperature,
        T_maxK: existing?.T_maxK ?? temperature + 40,
        area_mm2: existing?.area_mm2 ?? area_mm2,
        gammaGeo: existing?.gammaGeo ?? gammaGeo,
        roughness_nm: existing?.roughness_nm ?? 1,
        fieldType: existing?.fieldType ?? "em",
        kernelType: sampler,
        tau_s,
        guardBandFrac: existing?.guardBandFrac ?? DEFAULTS.guardFrac,
        dutyNominal: baseDuty,
        envelopeType: existing?.envelopeType ?? "rectangular",
        sectorId,
        drivePhase_rad: this.lastStaggering?.phaseOffsets_rad?.[sectorId] ?? 0,
        repRate_Hz: repRateHz,
        safetySigma_Jm3: existing?.safetySigma_Jm3 ?? undefined,
        tauKernel_s: existing?.tauKernel_s ?? tau_s,
        slewLimit_nm_per_s: existing?.slewLimit_nm_per_s ?? DEFAULTS.gapStep_nm * repRateHz,
        telemetryAt: Date.now(),
      };

      if (runtime) {
        runtime.telemetry = { ...runtime.telemetry, ...telem };
      } else {
        this.tiles.set(tileId, {
          telemetry: telem,
          prevSetpoint: { gap: telem.gap_nm, duty: telem.duty },
        });
      }
    }

    for (const key of Array.from(this.tiles.keys())) {
      if (!activeIds.has(key)) {
        this.tiles.delete(key);
      }
    }
  }

  private publishTilesToStream(state: QiControllerState): void {
    if (!state?.tiles?.length) return;
    const sectorCount = state.staggering?.sectorCount ?? state.tiles.length;
    const denom = Math.max(1, sectorCount);
    const radius = 1;
    const rawTiles: RawTileInput[] = state.tiles.map((tile, index) => {
      const sector = Number.isFinite(tile.sectorId) ? tile.sectorId : index;
      const theta = (2 * Math.PI * sector) / denom;
      const center: [number, number, number] = [
        Math.cos(theta) * radius,
        Math.sin(theta) * radius,
        0,
      ];
      const rhoAvg = Number.isFinite(tile.rhoAvg_Jm3) ? (tile.rhoAvg_Jm3 as number) : 0;
      const rhoNeg = Math.min(0, rhoAvg);
      const limit = Math.max(1e-6, Math.abs(tile.bound_Jm3 ?? 0));
      const guard = Math.max(1e-6, Math.abs(tile.guardBand_Jm3 ?? 0));
      const deviation = Math.abs(rhoNeg) - limit;
      const sigmaNorm = guard > 0 ? clampNumber((tile.margin_Jm3 ?? 0) / guard, -1.5, 1.5) : 0;
      const weight =
        tile.safetyState === "QI_AT_RISK"
          ? 1
          : tile.safetyState === "MARGIN_LOW"
            ? 0.75
            : 0.5;

      return {
        id: tile.tileId ?? `sector-${sector}`,
        ijk: [sector ?? index, 0, 0],
        center_m: center,
        rho_neg_Jm3: rhoNeg,
        tau_eff_s: Math.max(1e-6, tile.tau_s ?? 5e-3),
        qi_limit: limit,
        Q_factor: tile.qEff,
        T_K: tile.temperatureK,
        absRho_Jm3: Math.abs(rhoAvg),
        deviation_Jm3: deviation,
        sigmaNorm,
        weight,
      };
    });
    updatePipelineQiTiles(rawTiles, { source: "controller" });
  }

  private classifySector(sectorId: number): TileRole {
    if (this.paybackTargets.has(sectorId)) return "pos";
    if (this.lastNegSectors.has(sectorId)) return "neg";
    if (this.lastPosSectors.has(sectorId)) return "pos";
    return "neutral";
  }

  private sectorWeight(sectorId: number): number {
    const weight = this.lastWeightVector[sectorId];
    if (!Number.isFinite(weight)) return 0.5;
    return clampNumber(weight, 0, 1);
  }
}

function rhoEff_Jm3(gap_nm: number, tile: QiTileTelemetry): number {
  const gap_m = Math.max(1e-9, gap_nm) * NM_TO_M;
  const base = -CASIMIR_COEFF / Math.pow(gap_m, 4);
  const qFactor = Math.max(tile.Q_eff ?? 1, 1);
  const qRef = Math.max(tile.Q_min ?? 1e5, 1e5);
  const qScale = clampNumber(qFactor / qRef, 0.05, 2);
  const thermal = clampNumber(1 - Math.pow(tile.temperatureK / Math.max(tile.T_maxK, 1), 2), 0.05, 1);
  const rough = 1 / (1 + (tile.roughness_nm ?? 0) / 20);
  return base * qScale * thermal * rough * (tile.gammaGeo ?? 1);
}

function rhoAvg_Jm3(
  rhoEff: number,
  duty: number,
  tile: QiTileTelemetry,
  repRateHz: number,
): number {
  const gain = kernelDutyGain(duty, tile.tau_s, repRateHz, tile.kernelType);
  const envelope = envelopeGain[tile.envelopeType ?? "rectangular"] ?? 1;
  return rhoEff * duty * gain * envelope;
}

function kernelDutyGain(
  duty: number,
  tau_s: number,
  repRateHz: number,
  sampler: SamplingKind,
): number {
  const cycle_s = repRateHz > 0 ? 1 / repRateHz : tau_s;
  const pulse_s = clampNumber(duty, 0, 1) * cycle_s;
  const ratio = pulse_s / Math.max(1e-9, tau_s);
  if (sampler === "gaussian") {
    return clampNumber(Math.min(1, Math.sqrt(2 / Math.PI) * ratio), 0.05, 1);
  }
  return clampNumber(ratio / (ratio + 1), 0.05, 1);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function performanceNow(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

export const qiController = new QiController();

export const qiControllerRouter = express.Router();

qiControllerRouter.get("/controller-state", (req, res) => {
  res.json(qiController.getState());
});

qiControllerRouter.post("/setpoint", (req, res) => {
  const parsed = qiSetpointSuggestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-setpoint", details: parsed.error.flatten() });
    return;
  }
  const next = qiController.applySuggestion(parsed.data);
  res.json(next);
});

export function startQiController(): void {
  qiController.start();
}

export function ingestQiTileTelemetry(update: Partial<QiTileTelemetry> & { tileId: string }): void {
  qiController.ingestTileTelemetry(update);
}
