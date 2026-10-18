// HELIX-CORE: Independent Dynamic Casimir Energy Pipeline
// This module provides centralized energy calculations that all panels can access

import fs from "node:fs";
import path from "node:path";

// Model mode switch: raw physics or paper-calibrated power targets.
// Explicit default: paper-calibrated power targets; set HELIX_MODEL_MODE=raw to bypass.
const MODEL_MODE: 'calibrated' | 'raw' =
  (process.env.HELIX_MODEL_MODE === 'raw') ? 'raw' : 'calibrated';

export type MassMode =
  | "MODEL_DERIVED"
  | "TARGET_CALIBRATED"
  | "MEASURED_FORCE_INFERRED";
export type MassSource = "model" | "measured" | "target";
export type ControlSource = "measured" | "design" | "policy" | "schedule" | "target";

const DEFAULT_MASS_MODE: MassMode = "MODEL_DERIVED";

const resolveMassMode = (value: unknown): MassMode => {
  if (
    value === "MODEL_DERIVED" ||
    value === "TARGET_CALIBRATED" ||
    value === "MEASURED_FORCE_INFERRED"
  ) {
    return value;
  }
  return DEFAULT_MASS_MODE;
};

// G+¦+çG+¦+ç Physics Constants (centralized) G+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+ç
import { HBAR } from "./physics-const.ts";
import { C } from "./utils/physics-const-safe.ts";
import { GEOM_TO_SI_STRESS, SI_TO_GEOM_STRESS } from "../shared/gr-units.ts";
import { computeClocking, type ClockingSnapshot } from "../shared/clocking.ts";
import { NHM2_FULL_HULL_DIMENSIONS_M, PROMOTED_WARP_PROFILE } from "../shared/warp-promoted-profile.ts";
import {
  analyzeWarpWorldlineTransportVariation,
  WARP_WORLDLINE_CONTRACT_VERSION,
  WARP_WORLDLINE_NORMALIZATION_TOLERANCE,
  computeWarpWorldlineDtauDt,
  computeWarpWorldlineNormalizationResidual,
  toWarpWorldlineVec3,
  type WarpShiftLapseTransportPromotionGate,
  type WarpTransportCertificationStatus,
  type WarpWorldlineContractV1,
  type WarpWorldlineVec3,
} from "../shared/contracts/warp-worldline-contract.v1.ts";
import {
  buildWarpCruiseEnvelopePreflightContractFromWorldline,
  type WarpCruiseEnvelopePreflightContractV1,
} from "../shared/contracts/warp-cruise-envelope-preflight.v1.ts";
import {
  buildWarpRouteTimeWorldlineContract,
  type WarpRouteTimeWorldlineContractV1,
} from "../shared/contracts/warp-route-time-worldline.v1.ts";
import {
  DEFAULT_WARP_MISSION_ESTIMATOR_TARGET_ID,
  LIGHT_YEARS_PER_PARSEC,
  METERS_PER_PARSEC,
  buildWarpMissionTimeEstimatorContract,
  type WarpMissionEstimatorTargetId,
  type WarpMissionTargetDistanceContractV1,
  type WarpMissionTimeEstimatorContractV1,
} from "../shared/contracts/warp-mission-time-estimator.v1.ts";
import {
  buildWarpMissionTimeComparisonContract,
  type WarpMissionTimeComparisonContractV1,
} from "../shared/contracts/warp-mission-time-comparison.v1.ts";
import {
  buildWarpCruiseEnvelopeContract,
  type WarpCruiseEnvelopeContractV1,
} from "../shared/contracts/warp-cruise-envelope.v1.ts";
import {
  buildWarpInHullProperAccelerationContract,
  properAccelerationGeomToMps2,
  properAccelerationMps2ToG,
  summarizeInHullProperAccelerationChannelExtrema,
  type WarpInHullProperAccelerationContractV1,
  type WarpInHullProperAccelerationSampleRole,
  type WarpInHullProperAccelerationSamplingGeometry,
  type WarpInHullProperAccelerationVec3,
} from "../shared/contracts/warp-in-hull-proper-acceleration.v1.ts";
import {
  buildNhm2ObserverAuditArtifact,
  type BuildNhm2ObserverAuditTensorInput,
  type Nhm2ObserverDecFluxShearExtensionEvidence,
  type Nhm2ObserverDecExtensionTrancheId,
  type Nhm2ObserverDecPhysicsControlEvidence,
  type Nhm2ObserverDecModelTermExtensionPlanEvidence,
  type Nhm2ObserverDecResidualAttributionEvidence,
  type Nhm2ObserverDecRemediationEvidence,
  type Nhm2ObserverAuditArtifact,
  type Nhm2ObserverModelTermClosurePath,
  type Nhm2ObserverMetricComponentAdmissionStatus,
  type Nhm2ObserverModelTermSemanticAdmissionEvidence,
  type Nhm2ObserverNextTechnicalAction,
  type Nhm2ObserverMetricProducerAdmissionEvidence,
  type Nhm2ObserverTileAuthorityEvidence,
  type Nhm2ObserverTileComparableCrossCheckEvidence,
  type Nhm2ObserverTileObserverConditionComparabilityEvidence,
  type Nhm2ObserverTileObserverConditionAuthorityMode,
  type Nhm2ObserverTileSurfaceReconstitutionEvidence,
  type Nhm2ObserverT00PolicyAdmissionBridgeEvidence,
} from "../shared/contracts/nhm2-observer-audit.v1.ts";
import {
  type Nhm2ObserverRobustEnergyConditionArtifactV1,
} from "../shared/contracts/nhm2-observer-robust-energy-conditions.v1.ts";
import {
  buildNhm2SameChartFullTensorArtifact,
  type Nhm2SameChartFullTensorArtifactV1,
  type Nhm2SameChartFullTensorComponentId,
  type Nhm2SameChartFullTensorProvenanceSource,
  type Nhm2TensorComponentStatus,
} from "../shared/contracts/nhm2-same-chart-full-tensor.v1.ts";
import {
  NHM2_SOURCE_CLOSURE_COMPONENTS,
  normalizeNhm2SourceClosureTensor,
  type Nhm2SourceClosureArtifact,
  type Nhm2SourceClosureComponent,
  type Nhm2SourceClosureTensor,
} from "../shared/contracts/nhm2-source-closure.v1.ts";
import {
  buildNhm2SourceClosureArtifactV2,
  type Nhm2SourceClosureV2Artifact,
  type Nhm2SourceClosureV2RegionAccounting,
  type Nhm2SourceClosureV2RegionComparisonInput,
  type Nhm2SourceClosureV2RegionT00Diagnostics,
  type Nhm2SourceClosureV2RegionT00Trace,
  type Nhm2SourceClosureV2RegionProxyComponentAttribution,
  type Nhm2SourceClosureV2RegionProxyDiagnostics,
} from "../shared/contracts/nhm2-source-closure.v2.ts";
import {
  buildNhm2SourceSideSameBasisTensorAuthorityArtifact,
  type Nhm2SourceSideSameBasisTensorAuthorityArtifactV1,
} from "../shared/contracts/nhm2-source-side-same-basis-tensor-authority.v1.ts";
import type { Nhm2WallSourceClosureArtifactV1 } from "../shared/contracts/nhm2-wall-source-closure.v1.ts";
import {
  buildNhm2StrictSignalReadinessArtifact,
  type Nhm2StrictSignalReadinessArtifact,
  type Nhm2StrictSignalReadinessProvenance,
} from "../shared/contracts/nhm2-strict-signal-readiness.v1.ts";
import {
  buildNhm2QeiWorldlineDossierFromGuardrail,
  type Nhm2QeiWorldlineDossierV1,
} from "../shared/contracts/nhm2-qei-worldline-dossier.v1.ts";
import {
  buildNhm2NatarioInvariantAudit,
  type Nhm2NatarioConvergenceStatus,
  type Nhm2NatarioInvariantAuditV1,
  type Nhm2NatarioThetaFlatnessStatus,
} from "../shared/contracts/nhm2-natario-invariant-audit.v1.ts";
import {
  buildCasimirMaterialReceipt,
  type CasimirBeyondPfaValidity,
  type CasimirGapMetrologyStatus,
  type CasimirMaterialModelKind,
  type CasimirMaterialReceiptV1,
  type CasimirVacuumSealEvidence,
} from "../shared/contracts/casimir-material-receipt.v1.ts";
import type { Nhm2PhaseTopologyArtifact } from "../shared/contracts/nhm2-phase-topology.v1.ts";
import {
  buildStressEnergyBrick,
  forEachStressEnergyBrickRegionVoxel,
  type StressEnergyStats,
} from "./stress-energy-brick";
import {
  DEFAULT_WARP_SHIFT_LAPSE_PROFILE_ID,
  deriveWarpMetricFamilySemantics,
  resolveWarpShiftLapseProfile,
  type WarpMetricAdapterSnapshot,
  type WarpMetricFamilyAuthorityStatus,
  type WarpMetricTransportCertificationStatus,
} from "../modules/warp/warp-metric-adapter.ts";
import {
  calculateMetricStressEnergyTensorAtPointFromShiftField,
  calculateMetricStressEnergyTensorRegionMeansFromShiftField,
} from "../modules/warp/natario-warp.ts";
import type { CongruenceMeta } from "../types/pipeline";
import type { SectorControlLiveEvent } from "../shared/schema.ts";

// Keep tau_LC (wall / c) aligned with modulation dwell unless overridden
const DEFAULT_MODULATION_FREQ_GHZ = 15;
const DEFAULT_WALL_THICKNESS_M = C / (DEFAULT_MODULATION_FREQ_GHZ * 1e9);
const STROBE_DUTY_WINDOW_MS_DEFAULT = 12_000;
const STROBE_DUTY_STALE_MS = 20_000;
const DEFAULT_NHM2_SOURCE_CLOSURE_REL_LINF_MAX = 0.1;
const REQUIRED_NHM2_SOURCE_CLOSURE_REGION_IDS = [
  "global",
  "hull",
  "wall",
  "exterior_shell",
] as const;

// Performance guardrails for billion-tile calculations
const TILE_EDGE_MAX = 2048;          // safe cap for any "edge" dimension fed into dynamic helpers
const DYN_TILECOUNT_HARD_SKIP = 5e7; // >50M tiles G+Ñ+å skip dynamic per-tile-ish helpers (use aggregate)
const INV16PI = 1 / (16 * Math.PI);

// Production-quiet logging toggle
const DEBUG_PIPE = process.env.NODE_ENV !== 'production' && (process.env.HELIX_DEBUG?.includes('pipeline') ?? false);
const PIPELINE_THETA_AUDIT_LOG = DEBUG_PIPE && process.env.HELIX_PIPE_AUDIT_LOG === "1";
const QI_GUARD_LOG_MIN_INTERVAL_MS = Number.isFinite(Number(process.env.QI_GUARD_LOG_MIN_INTERVAL_MS))
  ? Math.max(250, Number(process.env.QI_GUARD_LOG_MIN_INTERVAL_MS))
  : 5000;
let lastQiGuardLogAt = 0;
let lastQiGuardLogMode: "breach" | "debug" | null = null;
import { calculateNatarioMetric } from '../modules/dynamic/natario-metric.ts';
import {
  calculateDynamicCasimirWithNatario,
  runVacuumGapSweep,
  defaultSweepConfigFromDynamic,
  computeSweepPoint,
  detectPlateau,
  getPumpCommandForQi,
  type DynamicConfigLike,
} from '../modules/dynamic/dynamic-casimir.ts';
import { assignGateSummaries } from "../modules/dynamic/gates/index.ts";
import { calculateCasimirEnergy, omega0_from_gap } from '../modules/sim_core/static-casimir.ts';
import {
  inferCasimirForceScale,
  inferEnergyFromForceSeries,
} from "../modules/sim_core/casimir-inference.ts";
import {
  toPipelineStressEnergy,
  enhancedAvgEnergyDensity,
  computeLaplaceRungeLenz,
  type Vec3,
} from '../modules/dynamic/stress-energy-equations.ts';
import warpBubbleModule from '../modules/warp/warp-module.ts';
import { buildWarpMetricAdapterSnapshot } from "../modules/warp/warp-metric-adapter.ts";
import { DEFAULT_GEOMETRY_SWEEP, DEFAULT_PHASE_MICRO_SWEEP } from "../shared/schema.ts";
import type {
  CardRecipe,
  CardMeshMetadata,
  CardLatticeMetadata,
  HullPreviewPayload,
} from "../shared/schema.ts";
import type {
  WarpViabilityCertificate,
  ViabilityConstraint,
  ViabilityStatus,
  WarpSnapshot,
} from "../types/warpViability";
import { CARD_RECIPE_SCHEMA_VERSION } from "../shared/schema.ts";
import {
  applyQiAutothrottleStep,
  applyScaleToGatePulses,
  applyScaleToPumpCommand,
  initQiAutothrottle,
  type QiAutothrottleState,
} from "./controls/qi-autothrottle.ts";
import {
  initQiAutoscaleState,
  stepQiAutoscale,
  type QiAutoscaleClampReason,
  type QiAutoscaleState,
} from "./controls/qi-autoscale.ts";
import {
  QI_AUTOSCALE_ENABLE,
  QI_AUTOSCALE_MIN_SCALE,
  QI_AUTOSCALE_SLEW,
  QI_AUTOSCALE_TARGET,
  QI_AUTOSCALE_WINDOW_TOL,
  QI_AUTOSCALE_SOURCE,
} from "./config/env.ts";
import type {
  DynamicCasimirSweepConfig,
  DynamicConfig,
  VacuumGapSweepRow,
  SweepPoint,
  SweepRuntime,
  GateAnalytics,
  GatePulse,
  QiFieldType,
  QiSettings,
  QiStats,
  SamplingKind,
  PhaseScheduleTelemetry,
  PumpCommand,
  PumpTone,
  HardwareSectorState,
  HardwareQiSample,
  HardwareSpectrumFrame,
  CasimirForceDataset,
  MaterialModel,
  MaterialProps,
} from "../shared/schema.ts";
import { appendPhaseCalibrationLog } from "./utils/phase-calibration.ts";
import { slewPump } from "./instruments/pump.ts";
import { slewPumpMultiTone } from "./instruments/pump-multitone.ts";
import { analyzeNhm2PhaseTopology } from "./energy/phase-topology.ts";
import { applyNhm2PhaseTopologyGate } from "./energy/phase-topology-gate.ts";
import {
  computeSectorPhaseOffsets,
  applyPhaseScheduleToPulses,
  smoothSectorPhaseAngles,
  type PhaseSchedule,
} from "./energy/phase-scheduler.ts";
import { QiMonitor } from "./qi/qi-monitor.ts";
import { configuredQiScalarBound, qiBound_Jm3 } from "./qi/qi-bounds.ts";
import { buildWindow, type RawTileInput } from "./qi/qi-saturation.ts";
import { updatePipelineQiTiles, getLatestQiTileStats } from "./qi/pipeline-qi-stream.ts";
import { stepTsAutoscale, type TsAutoscaleState } from "./ts/ts-autoscale.ts";

export type MutableDynamicConfig = DynamicConfigLike;

export interface SweepHistoryTotals {
  visible: number;
  total: number;
  dropped: number;
}

export interface StrobeDutySummary {
  dutyAvg: number;
  windowMs: number;
  samples: number;
  lastSampleAt: number;
  lastDuty: number;
  sLive?: number;
  sTotal?: number;
  source?: string;
}

export interface HardwareTruthSnapshot {
  lastSweepRow?: VacuumGapSweepRow;
  totals?: SweepHistoryTotals;
  updatedAt?: number;
  sectorState?: (HardwareSectorState & { updatedAt?: number }) | null;
  qiSample?: (HardwareQiSample & { updatedAt?: number }) | null;
  spectrumFrame?: (HardwareSpectrumFrame & { updatedAt?: number }) | null;
  strobeDuty?: StrobeDutySummary | null;
}

export interface ScheduleSweepRequest {
  activeSlew: boolean;
  reason?: string;
}

export interface PipelineRunOptions {
  sweepMode?: "auto" | "skip" | "force" | "async";
  scheduleSweep?: (request: ScheduleSweepRequest) => void;
  sweepReason?: string;
  preserveLiveWarpFunctions?: boolean;
}

const parseEnvNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const strictCongruenceEnabled = (): boolean =>
  process.env.WARP_STRICT_CONGRUENCE !== "0";
const DEFAULT_CL3_RHO_DELTA_MAX = parseEnvNumber(process.env.WARP_CL3_RHO_DELTA_MAX, 0.1);

type TsMetricDerivedStatus = {
  metricDerived: boolean;
  source: string;
  reason?: string;
  chart?: string;
};

const hasPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

type HullGeometrySnapshot = NonNullable<EnergyPipelineState["hull"]>;
type HullGeometryFallback = Partial<HullGeometrySnapshot>;
type HullRadiusState = Pick<EnergyPipelineState, "hull" | "bubble" | "R">;

export const resolveBubbleRadiusM = (
  state: Pick<EnergyPipelineState, "bubble" | "R">,
  fallback = 1,
): number => {
  const bubbleRadius = Number(state.bubble?.R);
  if (hasPositiveFinite(bubbleRadius)) return bubbleRadius;

  const topLevelBubbleRadius = Number(state.R);
  if (hasPositiveFinite(topLevelBubbleRadius)) return topLevelBubbleRadius;

  return fallback;
};

const buildIsotropicHullGeometry = (
  radiusM: number,
  wallThicknessM?: number,
): HullGeometrySnapshot => ({
  Lx_m: radiusM * 2,
  Ly_m: radiusM * 2,
  Lz_m: radiusM * 2,
  ...(hasPositiveFinite(wallThicknessM)
    ? { wallThickness_m: wallThicknessM }
    : {}),
});

export const resolveHullGeometry = (
  state: HullRadiusState,
  fallback?: HullGeometryFallback,
): HullGeometrySnapshot => {
  const fallbackHull =
    fallback && hasPositiveFinite(fallback.Lx_m) && hasPositiveFinite(fallback.Ly_m) && hasPositiveFinite(fallback.Lz_m)
      ? fallback
      : buildIsotropicHullGeometry(resolveBubbleRadiusM(state));
  const hullRaw = (state.hull ?? {}) as Partial<HullGeometrySnapshot>;

  return {
    Lx_m: hasPositiveFinite(hullRaw.Lx_m)
      ? hullRaw.Lx_m
      : hasPositiveFinite(fallbackHull.Lx_m)
        ? fallbackHull.Lx_m
        : 2,
    Ly_m: hasPositiveFinite(hullRaw.Ly_m)
      ? hullRaw.Ly_m
      : hasPositiveFinite(fallbackHull.Ly_m)
        ? fallbackHull.Ly_m
        : 2,
    Lz_m: hasPositiveFinite(hullRaw.Lz_m)
      ? hullRaw.Lz_m
      : hasPositiveFinite(fallbackHull.Lz_m)
        ? fallbackHull.Lz_m
        : 2,
    ...(hasPositiveFinite(hullRaw.wallThickness_m)
      ? { wallThickness_m: hullRaw.wallThickness_m }
      : hasPositiveFinite(fallbackHull.wallThickness_m)
        ? { wallThickness_m: fallbackHull.wallThickness_m }
        : {}),
  };
};

export const resolveHullReferenceRadiusM = (
  state: HullRadiusState,
  fallback?: HullGeometryFallback,
): number => {
  const hull = resolveHullGeometry(state, fallback);
  return Math.max(hull.Lx_m, hull.Ly_m, hull.Lz_m) / 2;
};

const resolveTsMetricDerivedStatus = (
  state: EnergyPipelineState,
  clockingProvenance: "derived" | "hardware" | "simulated",
): TsMetricDerivedStatus => {
  if (clockingProvenance === "hardware") {
    return {
      metricDerived: false,
      source: "hardware_timing",
      reason: "clocking provenance is hardware telemetry",
    };
  }

  const tsRatio = Number(state.TS_ratio);
  const tauLCms = Number((state as any).tauLC_ms ?? state.ts?.tauLC_ms);
  if (!hasPositiveFinite(tsRatio) || !hasPositiveFinite(tauLCms)) {
    return {
      metricDerived: false,
      source: "timing_missing",
      reason: "TS_ratio or tauLC_ms missing/non-positive",
    };
  }

  const hull = state.hull;
  const hasHullDims =
    hasPositiveFinite(hull?.Lx_m) &&
    hasPositiveFinite(hull?.Ly_m) &&
    hasPositiveFinite(hull?.Lz_m);
  if (!hasHullDims) {
    return {
      metricDerived: false,
      source: "hull_missing",
      reason: "hull dimensions unavailable for proper-distance timing",
    };
  }

  const metricAdapter = (state as any)?.warp?.metricAdapter as
    | WarpMetricAdapterSnapshot
    | undefined;
  if (!metricAdapter) {
    return {
      metricDerived: false,
      source: "metric_adapter_missing",
      reason: "warp metric adapter not available",
    };
  }

  const chartLabel = metricAdapter.chart?.label;
  const dtGammaPolicy = metricAdapter.chart?.dtGammaPolicy;
  const contractStatus = metricAdapter.chart?.contractStatus;
  const chartKnown =
    typeof chartLabel === "string" &&
    chartLabel !== "unspecified" &&
    dtGammaPolicy !== "unknown" &&
    contractStatus !== "unknown";
  if (!chartKnown) {
    return {
      metricDerived: false,
      source: "chart_unknown",
      reason: "metric adapter chart contract is unspecified/unknown",
      chart: typeof chartLabel === "string" ? chartLabel : undefined,
    };
  }

  const gammaDiag = metricAdapter.gammaDiag;
  const gammaDiagValid =
    Array.isArray(gammaDiag) &&
    gammaDiag.length === 3 &&
    gammaDiag.every((v) => hasPositiveFinite(v));
  if (!gammaDiagValid) {
    return {
      metricDerived: false,
      source: "gamma_diag_missing",
      reason: "metric adapter gamma diagonal missing/non-positive",
      chart: chartLabel,
    };
  }

  return {
    metricDerived: true,
    source: "warp.metricAdapter+clocking",
    reason: "TS_ratio from proper-distance timing with explicit chart contract",
    chart: chartLabel,
  };
};

export const DEFAULT_PULSED_CURRENT_LIMITS_A = {
  midi: parseEnvNumber(process.env.IPEAK_MAX_MIDI_A, 31_623), // 5 kJ @ 10 uH @ 10 us -> ~31.6 kA
  sector: parseEnvNumber(process.env.IPEAK_MAX_SECTOR_A, 31_623), // Tile bank provisional cap (~31.6 kA @ 1 uH, 1 us)
  launcher: parseEnvNumber(process.env.IPEAK_MAX_LAUNCHER_A, 14_142), // 10 kJ @ 100 uH @ 20 us -> ~14.1 kA
} as const;

export const TAU_LC_UNIT_DRIFT_LIMIT = 50; // reject >50x unit drift (ms vs -¦s)

export function computeTauLcMsFromHull(hull?: {
  Lx_m?: number;
  Ly_m?: number;
  Lz_m?: number;
  wallThickness_m?: number | null;
} | null): number | null {
  if (!hull) return null;
  const dims = [hull.Lx_m, hull.Ly_m, hull.Lz_m]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  const longest = dims.length ? Math.max(...dims) : null;
  const wall = Number(hull.wallThickness_m);
  const path_m = longest && longest > 0
    ? longest
    : (Number.isFinite(wall) && wall > 0 ? wall : null);
  if (!(path_m && path_m > 0)) return null;
  return (path_m / C) * 1e3;
}

const resolveMetricPathLengthFromAdapter = (
  state: EnergyPipelineState,
): number | undefined => {
  const metricAdapter = (state as any)?.warp?.metricAdapter as
    | WarpMetricAdapterSnapshot
    | undefined;
  if (!metricAdapter) return undefined;
  const gammaDiag = metricAdapter.gammaDiag;
  if (!Array.isArray(gammaDiag) || gammaDiag.length !== 3) return undefined;
  const scales = gammaDiag.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.sqrt(n) : Number.NaN;
  });
  if (!scales.every((value) => Number.isFinite(value) && value > 0)) return undefined;
  const hull = state.hull;
  if (!hull) return undefined;
  const dims = [Number(hull.Lx_m), Number(hull.Ly_m), Number(hull.Lz_m)];
  const scaledDims = dims
    .map((dim, idx) => (Number.isFinite(dim) && dim > 0 ? dim * scales[idx] : Number.NaN))
    .filter((dim) => Number.isFinite(dim) && dim > 0);
  if (scaledDims.length > 0) return Math.max(...scaledDims);
  const wall = Number(hull.wallThickness_m);
  if (Number.isFinite(wall) && wall > 0) {
    return wall * Math.max(...scales);
  }
  return undefined;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toFiniteVec3 = (
  value: unknown,
  fallback: [number, number, number],
): [number, number, number] => {
  if (Array.isArray(value) && value.length >= 3) {
    const x = toFiniteNumber(value[0]);
    const y = toFiniteNumber(value[1]);
    const z = toFiniteNumber(value[2]);
    if (x != null && y != null && z != null) {
      return [x, y, z];
    }
  }
  return fallback;
};

const resolveCanonicalMetricT00Ref = (
  warp: Record<string, any>,
  adapter: WarpMetricAdapterSnapshot | undefined,
): string | undefined => {
  if (typeof warp.metricT00Ref === "string" && warp.metricT00Ref.length > 0) {
    return String(warp.metricT00Ref);
  }
  const family = adapter?.family;
  if (family === "alcubierre") return "warp.metric.T00.alcubierre.analytic";
  if (family === "vdb") return "warp.metric.T00.vdb.regionII";
  if (family === "nhm2_shift_lapse") return "warp.metric.T00.nhm2.shift_lapse";
  if (family === "natario_sdf") return "warp.metric.T00.natario_sdf.shift";
  if (family === "natario") {
    if (adapter?.requestedFieldType === "irrotational") {
      return "warp.metric.T00.irrotational.shift";
    }
    return "warp.metric.T00.natario.shift";
  }
  return undefined;
};

type MetricT00Observer = "eulerian_n" | "orthonormal_region_ii";
type MetricT00Normalization = "si_stress";
type MetricT00UnitSystem = "SI";
type MetricT00ContractStatus = "ok" | "unknown";

type MetricT00Contract = {
  status: MetricT00ContractStatus;
  reason?: string;
  sourceRef: string;
  family: string;
  familyAuthorityStatus: WarpMetricFamilyAuthorityStatus;
  transportCertificationStatus: WarpMetricTransportCertificationStatus;
  familySemanticsNote: string;
  chart: string;
  observer: MetricT00Observer;
  normalization: MetricT00Normalization;
  unitSystem: MetricT00UnitSystem;
  derivation: string;
};

const NATARIO_EXPANSION_TOLERANCE = 1e-3;
const THETA_K_TOLERANCE = 1e-3;
const SHIFT_LAPSE_TRANSPORT_PROMOTION_GATE_ID =
  "nhm2_shift_lapse_transport_promotion_gate/v1";
const SHIFT_LAPSE_TRANSPORT_PROMOTED_STATUS =
  "bounded_transport_proof_bearing_gate_admitted" as const satisfies WarpTransportCertificationStatus;

const resolveMetricT00Observer = (metricT00Ref: string): MetricT00Observer =>
  metricT00Ref === "warp.metric.T00.vdb.regionII"
    ? "orthonormal_region_ii"
    : "eulerian_n";

const resolveMetricFamilyFromRef = (
  metricT00Ref: string,
  adapter: WarpMetricAdapterSnapshot | undefined,
): string => {
  if (typeof adapter?.family === "string" && adapter.family.length > 0) {
    return adapter.family;
  }
  if (metricT00Ref.includes(".vdb.")) return "vdb";
  if (metricT00Ref.includes(".nhm2.") && metricT00Ref.includes(".shift_lapse")) {
    return "nhm2_shift_lapse";
  }
  if (metricT00Ref.includes(".natario_sdf.")) return "natario_sdf";
  if (metricT00Ref.includes(".irrotational.")) return "natario";
  if (metricT00Ref.includes(".natario.")) return "natario";
  if (metricT00Ref.includes(".alcubierre.")) return "alcubierre";
  return "unknown";
};

const buildMetricT00Contract = (params: {
  adapter?: WarpMetricAdapterSnapshot;
  metricT00Ref: string;
  observer?: string;
  normalization?: string;
  unitSystem?: string;
  derivation: string;
}): MetricT00Contract => {
  const adapter = params.adapter;
  const observer =
    params.observer === "orthonormal_region_ii" || params.observer === "eulerian_n"
      ? (params.observer as MetricT00Observer)
      : resolveMetricT00Observer(params.metricT00Ref);
  const normalization: MetricT00Normalization =
    params.normalization === "si_stress" ? "si_stress" : "si_stress";
  const unitSystem: MetricT00UnitSystem = params.unitSystem === "SI" ? "SI" : "SI";
  const chart =
    typeof adapter?.chart?.label === "string" && adapter.chart.label.length > 0
      ? adapter.chart.label
      : "unspecified";
  const family = resolveMetricFamilyFromRef(params.metricT00Ref, adapter);
  const familySemantics = deriveWarpMetricFamilySemantics(
    family === "natario" ||
      family === "natario_sdf" ||
      family === "nhm2_shift_lapse" ||
      family === "alcubierre" ||
      family === "vdb"
      ? family
      : "unknown",
  );
  const chartContractStatus = adapter?.chart?.contractStatus;
  let status: MetricT00ContractStatus = "ok";
  const reasons: string[] = [];
  if (chart === "unspecified") {
    status = "unknown";
    reasons.push("chart_unspecified");
  }
  if (chartContractStatus === "unknown") {
    status = "unknown";
    reasons.push("chart_contract_unknown");
  }
  if (!params.metricT00Ref.startsWith("warp.metric.T00")) {
    status = "unknown";
    reasons.push("metric_ref_noncanonical");
  }
  return {
    status,
    ...(reasons.length ? { reason: reasons.join(",") } : {}),
    sourceRef: params.metricT00Ref,
    family,
    familyAuthorityStatus: familySemantics.familyAuthorityStatus,
    transportCertificationStatus: familySemantics.transportCertificationStatus,
    familySemanticsNote: familySemantics.semanticsNote,
    chart,
    observer,
    normalization,
    unitSystem,
    derivation: params.derivation,
  };
};

const buildNatarioRuntimePayload = (
  state: EnergyPipelineState,
  fallback?: Record<string, unknown> | null,
): Record<string, unknown> => {
  const warp = ((state as any).warp ?? {}) as Record<string, any>;
  const adapter = warp.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  const alpha = toFiniteNumber(adapter?.alpha) ?? 1;
  const lapseSummary =
    adapter?.lapseSummary && typeof adapter.lapseSummary === "object"
      ? { ...adapter.lapseSummary }
      : undefined;
  const gammaDiagRaw = Array.isArray(adapter?.gammaDiag) ? adapter.gammaDiag : undefined;
  const gammaDiag: [number, number, number] =
    gammaDiagRaw &&
    gammaDiagRaw.length >= 3 &&
    toFiniteNumber(gammaDiagRaw[0]) != null &&
    toFiniteNumber(gammaDiagRaw[1]) != null &&
    toFiniteNumber(gammaDiagRaw[2]) != null
      ? [
          Number(gammaDiagRaw[0]),
          Number(gammaDiagRaw[1]),
          Number(gammaDiagRaw[2]),
        ]
      : [1, 1, 1];

  const shiftAmplitude =
    firstFinite(
      warp.betaAvg,
      warp.natarioShiftAmplitude,
      warp?.shiftVectorField?.amplitude,
      (state as any).beta_avg,
    ) ?? 0;
  const shiftBeta = toFiniteVec3((fallback as any)?.shiftBeta, [shiftAmplitude, 0, 0]);
  const metricStress = (warp.metricStressEnergy ?? {}) as Record<string, unknown>;
  const tileEffectiveStress = (warp.tileEffectiveStressEnergy ?? {}) as Record<string, unknown>;
  const stress = (warp.stressEnergyTensor ??
    (state as any).stressEnergy ??
    (fallback as any)?.stressEnergyTensor ??
    {}) as Record<string, unknown>;
  const metricT00Ref = resolveCanonicalMetricT00Ref(warp, adapter);
  const metricT00SourceRaw =
    typeof warp.metricT00Source === "string" && warp.metricT00Source.length > 0
      ? String(warp.metricT00Source)
      : undefined;
  const stressEnergySourceRaw =
    typeof warp.stressEnergySource === "string" && warp.stressEnergySource.length > 0
      ? String(warp.stressEnergySource)
      : undefined;
  const metricT00 = firstFinite(
    warp.metricT00,
    metricStress.T00 as number | undefined,
    stress.T00 as number | undefined,
  );
  const metricMode =
    metricT00 != null &&
    (metricT00SourceRaw === "metric" ||
      stressEnergySourceRaw === "metric" ||
      (metricT00Ref != null && metricT00Ref.startsWith("warp.metric.T00")));
  const metricT00Source = metricMode ? "metric" : metricT00SourceRaw;
  const metricT00Derivation =
    metricMode && metricT00Ref != null
      ? metricT00Ref === "warp.metric.T00.vdb.regionII"
        ? "forward_B_to_derivatives_to_rho_E"
        : metricT00Ref === "warp.metric.T00.vdb.regionIV"
          ? "forward_fwall_to_rho_E"
        : "forward_shift_to_K_to_rho_E"
      : "proxy_or_pipeline";
  const metricT00Contract = metricMode && metricT00Ref != null
    ? buildMetricT00Contract({
        adapter,
        metricT00Ref,
        observer:
          typeof warp.metricT00Observer === "string" ? String(warp.metricT00Observer) : undefined,
        normalization:
          typeof warp.metricT00Normalization === "string"
            ? String(warp.metricT00Normalization)
            : undefined,
        unitSystem:
          typeof warp.metricT00UnitSystem === "string"
            ? String(warp.metricT00UnitSystem)
            : undefined,
        derivation: metricT00Derivation,
      })
    : undefined;

  const t00 = toFiniteNumber(stress.T00) ?? 0;
  const t11 = toFiniteNumber(stress.T11) ?? 0;
  const t22 = toFiniteNumber(stress.T22) ?? 0;
  const t33 = toFiniteNumber(stress.T33) ?? 0;
  const normalizePublishedTensor = (
    value: Record<string, unknown>,
  ): Record<string, unknown> => {
    const tensor: Record<string, unknown> = {
      T00: toFiniteNumber(value.T00),
      T11: toFiniteNumber(value.T11),
      T22: toFiniteNumber(value.T22),
      T33: toFiniteNumber(value.T33),
    };
    for (const key of [
      "T01",
      "T10",
      "T02",
      "T20",
      "T03",
      "T30",
      "T12",
      "T21",
      "T13",
      "T31",
      "T23",
      "T32",
    ]) {
      const component = toFiniteNumber(value[key]);
      if (component != null) tensor[key] = component;
    }
    if (typeof value.isNullEnergyConditionSatisfied === "boolean") {
      tensor.isNullEnergyConditionSatisfied = value.isNullEnergyConditionSatisfied;
    }
    if (typeof value.modelTermRoute === "string" && value.modelTermRoute.length > 0) {
      tensor.modelTermRoute = value.modelTermRoute;
    }
    if (
      value.modelTermAdmission === "admitted" ||
      value.modelTermAdmission === "experimental_not_admitted"
    ) {
      tensor.modelTermAdmission = value.modelTermAdmission;
    }
    if (typeof value.researchBasisRef === "string" && value.researchBasisRef.length > 0) {
      tensor.researchBasisRef = value.researchBasisRef;
    }
    return tensor;
  };
  const metricStressEnergy = normalizePublishedTensor(metricStress);
  const tileEffectiveStressEnergy = normalizePublishedTensor(tileEffectiveStress);
  const stressEnergyTensor = normalizePublishedTensor(stress);
  const nhm2ObserverAudit = state.nhm2ObserverAudit;
  const nhm2ObserverRobustEnergyConditions =
    state.nhm2ObserverRobustEnergyConditions;
  const nhm2SameChartFullTensor = state.nhm2SameChartFullTensor;
  const nhm2SourceClosure = state.nhm2SourceClosure;
  const nhm2WallSourceClosure = state.nhm2WallSourceClosure;
  const nhm2StrictSignalReadiness = state.nhm2StrictSignalReadiness;
  const nhm2QeiWorldlineDossier = state.nhm2QeiWorldlineDossier;
  const nhm2NatarioInvariantAudit = state.nhm2NatarioInvariantAudit;
  const nhm2PhaseTopology = state.nhm2PhaseTopology;
  const casimirMaterialReceipt = state.casimirMaterialReceipt;

  return {
    ...(fallback ?? {}),
    metricMode,
    lapseN: alpha,
    shiftBeta,
    gSpatialDiag: gammaDiag,
    gSpatialSym: [gammaDiag[0], 0, 0, gammaDiag[1], 0, gammaDiag[2]],
    g0i: [-shiftBeta[0], -shiftBeta[1], -shiftBeta[2]],
    viewForward: [1, 0, 0],
    stressEnergyTensor: {
      ...stressEnergyTensor,
      T00: t00,
      T11: t11,
      T22: t22,
      T33: t33,
    },
    stressEnergySource:
      stressEnergySourceRaw ??
      (metricMode
        ? "metric"
        : "proxy"),
    metricStressEnergy,
    tileEffectiveStressEnergy,
    tileEffectiveStressSource:
      typeof warp.tileEffectiveStressSource === "string"
        ? String(warp.tileEffectiveStressSource)
        : undefined,
    ...(nhm2ObserverAudit ? { nhm2ObserverAudit } : {}),
    ...(nhm2ObserverRobustEnergyConditions
      ? { nhm2ObserverRobustEnergyConditions }
      : {}),
    ...(nhm2SameChartFullTensor ? { nhm2SameChartFullTensor } : {}),
    ...(nhm2SourceClosure ? { nhm2SourceClosure } : {}),
    ...(nhm2WallSourceClosure ? { nhm2WallSourceClosure } : {}),
    ...(casimirMaterialReceipt ? { casimirMaterialReceipt } : {}),
    ...(nhm2StrictSignalReadiness
      ? { nhm2StrictSignalReadiness }
      : {}),
    ...(nhm2QeiWorldlineDossier ? { nhm2QeiWorldlineDossier } : {}),
    ...(nhm2NatarioInvariantAudit ? { nhm2NatarioInvariantAudit } : {}),
    ...(nhm2PhaseTopology ? { nhm2PhaseTopology } : {}),
    metricT00,
    metricT00Source: metricT00Source ?? undefined,
    metricT00Ref,
    metricT00Derivation,
    metricT00Observer: metricT00Contract?.observer,
    metricT00Normalization: metricT00Contract?.normalization,
    metricT00UnitSystem: metricT00Contract?.unitSystem,
    metricT00ContractStatus: metricT00Contract?.status,
    metricT00ContractReason: metricT00Contract?.reason,
    metricT00FamilyAuthorityStatus: metricT00Contract?.familyAuthorityStatus,
    metricT00TransportCertificationStatus: metricT00Contract?.transportCertificationStatus,
    metricT00FamilySemanticsNote: metricT00Contract?.familySemanticsNote,
    chartLabel: adapter?.chart?.label ?? "unspecified",
    chartDtGammaPolicy: adapter?.chart?.dtGammaPolicy ?? "unknown",
    chartContractStatus: adapter?.chart?.contractStatus ?? "unknown",
    ...(lapseSummary ? { lapseSummary } : {}),
    dutyFactor:
      firstFinite(
        warp.dutyFactor,
        (state as any).dutyEffective_FR,
        (state as any).dutyShip,
        (state as any).dutyCycle,
      ) ?? undefined,
    thetaScaleCore_sqrtDuty: firstFinite(
      warp.thetaScaleCore_sqrtDuty,
      warp.thetaScaleCore,
      (fallback as any)?.thetaScaleCore_sqrtDuty,
      (fallback as any)?.thetaScaleCore,
    ),
    thetaScaleCore: firstFinite(
      warp.thetaScaleCore,
      warp.thetaScaleCore_sqrtDuty,
      (fallback as any)?.thetaScaleCore,
      (fallback as any)?.thetaScaleCore_sqrtDuty,
    ),
  };
};

const DEFAULT_QI_TAU_MS = parseEnvNumber(process.env.QI_TAU_MS, PROMOTED_WARP_PROFILE.qi.tau_s_ms);
const DEFAULT_QI_GUARD = parseEnvNumber(process.env.QI_GUARD_FRAC ?? process.env.QI_GUARD, 0.05);
const DEFAULT_QI_DT_MS = parseEnvNumber(process.env.QI_DT_MS, 2);
const DEFAULT_QI_FIELD =
  (process.env.QI_FIELD_TYPE as QiFieldType | undefined) ?? PROMOTED_WARP_PROFILE.qi.fieldType;
const DEFAULT_QI_SAMPLER: SamplingKind = (() => {
  const envSampler = process.env.QI_SAMPLER as SamplingKind | undefined;
  if (envSampler) return envSampler;
  // Canonical promoted profile can request Hann, but QiSettings only accepts schema samplers.
  return PROMOTED_WARP_PROFILE.qi.sampler === "hann"
    ? "gaussian"
    : (PROMOTED_WARP_PROFILE.qi.sampler as SamplingKind);
})();
const DEFAULT_NEGATIVE_FRACTION = 0.4;
const DEFAULT_QI_INTEREST_RATE = parseEnvNumber(process.env.QI_INTEREST_RATE, 0.2);
const DEFAULT_QI_INTEREST_WINDOW_MULT = parseEnvNumber(process.env.QI_INTEREST_WINDOW_MULT, 2);
const DEFAULT_QI_CURVATURE_RATIO_MAX = parseEnvNumber(process.env.QI_CURVATURE_RATIO_MAX, 0.1);
const QI_CURVATURE_ENFORCE = (process.env.QI_CURVATURE_ENFORCE ?? "1") !== "0";
const DEFAULT_PUMP_FREQ_LIMIT_GHZ = Math.max(
  0.01,
  Math.min(parseEnvNumber(process.env.PUMP_FREQ_LIMIT_GHZ, 120), 1_000),
);

const DEFAULT_QI_SETTINGS: QiSettings = {
  sampler: DEFAULT_QI_SAMPLER,
  tau_s_ms: DEFAULT_QI_TAU_MS,
  observerId: 'ship',
  guardBand: DEFAULT_QI_GUARD,
  fieldType: DEFAULT_QI_FIELD,
};
const DEFAULT_QI_BOUND_SCALAR = configuredQiScalarBound({
  tau_s_ms: DEFAULT_QI_SETTINGS.tau_s_ms,
  fieldType: DEFAULT_QI_SETTINGS.fieldType,
  kernelType: DEFAULT_QI_SETTINGS.sampler,
});
const QI_POLICY_MAX_ZETA = Number.isFinite(Number(process.env.QI_POLICY_MAX_ZETA))
  ? Math.max(1e-12, Number(process.env.QI_POLICY_MAX_ZETA))
  : 1;
const QI_POLICY_ENFORCE = (process.env.QI_POLICY_ENFORCE ?? "1") !== "0";

const QI_STREAM_GRID_MIN = Math.max(4, Math.floor(parseEnvNumber(process.env.QI_STREAM_GRID_MIN, 8)));
const QI_STREAM_GRID_MAX = Math.max(
  QI_STREAM_GRID_MIN,
  Math.floor(parseEnvNumber(process.env.QI_STREAM_GRID_MAX, 24)),
);
const QI_STREAM_GRID_DEFAULT = Math.min(
  QI_STREAM_GRID_MAX,
  Math.max(
    QI_STREAM_GRID_MIN,
    Math.floor(parseEnvNumber(process.env.QI_STREAM_GRID_DEFAULT, 16)),
  ),
);

const qiMonitor = new QiMonitor(DEFAULT_QI_SETTINGS, DEFAULT_QI_DT_MS, DEFAULT_QI_BOUND_SCALAR);
let qiMonitorDt_ms = DEFAULT_QI_DT_MS;
let qiMonitorTau_ms = DEFAULT_QI_SETTINGS.tau_s_ms;
let qiMonitorSampler: SamplingKind = DEFAULT_QI_SETTINGS.sampler;
let qiSampleAccumulator_ms = 0;
let qiSampleLastTs = Date.now();
const qiLrlHistory: { lastPosition: Vec3 | null; lastTimestamp: number } = {
  lastPosition: null,
  lastTimestamp: 0,
};
let lastQiStats: QiStats | null = null;

const PUMP_EPOCH_ENV = Number(process.env.PUMP_EPOCH_MS);
const GLOBAL_PUMP_EPOCH_MS = Number.isFinite(PUMP_EPOCH_ENV) ? PUMP_EPOCH_ENV : 0;
const PUMP_TONE_ENABLE = process.env.PUMP_TONE_ENABLE === '1';
const PUMP_CMD_MIN_INTERVAL_MS = Math.max(
  0,
  parseEnvNumber(process.env.PUMP_CMD_MIN_INTERVAL_MS, 250),
);
const PUMP_CMD_KEEPALIVE_MS = Math.max(
  PUMP_CMD_MIN_INTERVAL_MS,
  parseEnvNumber(process.env.PUMP_CMD_KEEPALIVE_MS, 2000),
);
let lastPublishedPumpHash = '';
let lastPublishedPumpAt = 0;

const SECTORS_TOTAL_ENV = Number(process.env.SECTORS_TOTAL);
const DEFAULT_SECTORS_TOTAL = Number.isFinite(SECTORS_TOTAL_ENV)
  ? Math.max(1, Math.floor(SECTORS_TOTAL_ENV))
  : 32;

const SECTOR_PERIOD_ENV = Number(process.env.SECTOR_PERIOD_MS);
const DEFAULT_SECTOR_PERIOD_MS = Number.isFinite(SECTOR_PERIOD_ENV)
  ? Math.max(1, SECTOR_PERIOD_ENV)
  : 100;

let pendingPumpCommand: PumpCommand | undefined;
let lastPumpCommandSnapshot: PumpCommand | undefined;

export function publishPumpCommand(cmd: PumpCommand): void {
  if (!cmd) return;
  pendingPumpCommand = cmd;
  lastPumpCommandSnapshot = cmd;
  if (PUMP_TONE_ENABLE) {
    lastPublishedPumpHash = hashPumpCommand(cmd);
    lastPublishedPumpAt = Date.now();
  }
}

function roundToDigits(value: number | null | undefined, digits: number): number {
  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** digits;
  return Math.round(v * factor) / factor;
}

function hashPumpCommand(cmd: PumpCommand): string {
  const tones = Array.isArray(cmd.tones)
    ? [...cmd.tones]
        .sort((a, b) => a.omega_hz - b.omega_hz)
        .map((tone) => ({
          f: roundToDigits(tone.omega_hz, 3),
          d: roundToDigits(tone.depth, 3),
          p: roundToDigits(tone.phase_deg, 1),
        }))
    : [];
  const rho0 = roundToDigits(cmd.rho0 ?? 0, 3);
  return JSON.stringify({ tones, rho0 });
}

// ---------- Ellipsoid helpers (match renderer math) ----------
export type HullAxes = { a: number; b: number; c: number };

function rhoEllipsoid(p: [number, number, number], ax: HullAxes) {
  return Math.hypot(p[0] / ax.a, p[1] / ax.b, p[2] / ax.c);
}

function nEllipsoid(p: [number, number, number], ax: HullAxes): [number, number, number] {
  // G+¬+º(x^2/a^2 + y^2/b^2 + z^2/c^2) normalized
  const nx = p[0] / (ax.a * ax.a);
  const ny = p[1] / (ax.b * ax.b);
  const nz = p[2] / (ax.c * ax.c);
  const L = Math.hypot(
    p[0] / ax.a,
    p[1] / ax.b,
    p[2] / ax.c
  ) || 1;
  const n0 = nx / L, n1 = ny / L, n2 = nz / L;
  const m = Math.hypot(n0, n1, n2) || 1;
  return [n0 / m, n1 / m, n2 / m];
}

const vecLen = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);
export const normalizeVec = (v: [number, number, number]): [number, number, number] => {
  const m = vecLen(v) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

export const sectorSign = (theta: number, sectors: number, split: number) => {
  const u = (theta < 0 ? theta + 2 * Math.PI : theta) / (2 * Math.PI);
  const sectorIdx = Math.floor(u * sectors);
  const distToSplit = (sectorIdx - split + 0.5);
  const strobeWidth = 0.75; // matches renderer
  const softSign = (x: number) => Math.tanh(x);
  return softSign(-distToSplit / strobeWidth);
};
// ---------- Physics-side displacement sampling for debug/validation ----------
export interface FieldSample {
  p: [number, number, number];   // sample coordinate (meters)
  rho: number;                   // ellipsoidal radius (unitless)
  bell: number;                  // canonical bell weight
  n: [number, number, number];   // outward normal
  sgn: number;                   // sector sign (+/-)
  disp: number;                  // scalar displacement magnitude used
  dA?: number;                   // proper area element at sample (m^2) G+ç+¦ from metric
}

export interface FieldSampleBuffer {
  length: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  rho: Float32Array;
  bell: Float32Array;
  sgn: Float32Array;
  disp: Float32Array;
  dA: Float32Array;
}

const FIELD_SAMPLE_POOL_CAP = 1_000_000;
let sampleBufferCapacity = 0;
let sampleX = new Float32Array(0);
let sampleY = new Float32Array(0);
let sampleZ = new Float32Array(0);
let sampleNX = new Float32Array(0);
let sampleNY = new Float32Array(0);
let sampleNZ = new Float32Array(0);
let sampleRho = new Float32Array(0);
let sampleBell = new Float32Array(0);
let sampleSgn = new Float32Array(0);
let sampleDisp = new Float32Array(0);
let sampleDA = new Float32Array(0);

function ensureFieldSampleCapacity(required: number) {
  if (required > FIELD_SAMPLE_POOL_CAP) {
    throw new Error(`field sample request exceeds pool cap (${required} > ${FIELD_SAMPLE_POOL_CAP})`);
  }
  if (required <= sampleBufferCapacity) return;
  const nextBase = sampleBufferCapacity > 0 ? Math.min(FIELD_SAMPLE_POOL_CAP, sampleBufferCapacity * 2) : Math.min(FIELD_SAMPLE_POOL_CAP, 1024);
  const next = Math.max(required, nextBase);
  sampleX = new Float32Array(next);
  sampleY = new Float32Array(next);
  sampleZ = new Float32Array(next);
  sampleNX = new Float32Array(next);
  sampleNY = new Float32Array(next);
  sampleNZ = new Float32Array(next);
  sampleRho = new Float32Array(next);
  sampleBell = new Float32Array(next);
  sampleSgn = new Float32Array(next);
  sampleDisp = new Float32Array(next);
  sampleDA = new Float32Array(next);
  sampleBufferCapacity = next;
}

export interface FieldRequest {
  // sampling grid
  nTheta?: number;   // default 64
  nPhi?: number;     // default 32
  shellOffset?: number; // meters; 0 = on shell, >0 outside, <0 inside (default 0)
  // physics
  wallWidth_m?: number; // bell width w-++ in meters (default from sag_nm)
  sectors?: number;     // sector count (default state.sectorCount)
  split?: number;       // (+)/(G+¬+å) split index (default floor(sectors/2))
  clamp?: Partial<SampleClamp>; // G-++án++à new, optional
}

export type GeometryKind = "ellipsoid" | "radial" | "sdf";

export type SurfaceSampleInput = {
  p: [number, number, number];
  n?: [number, number, number];
  dA?: number;
  signedDistance_m?: number; // optional signed distance to iso-surface (meters)
};

export type RadialSampleInput = {
  theta?: number;
  phi?: number;
  r: number;
  n?: [number, number, number];
  dA?: number;
};

export interface FieldGeometryRequest extends FieldRequest {
  geometryKind?: GeometryKind;
  radial?: {
    samples?: RadialSampleInput[];
    radiusAt?: (dir: [number, number, number]) => number | { r: number; n?: [number, number, number]; dA?: number };
    nTheta?: number;
    nPhi?: number;
  };
  sdf?: {
    samples: SurfaceSampleInput[];
  };
}

export type WarpFieldType =
  | "natario"
  | "natario_sdf"
  | "nhm2_shift_lapse"
  | "alcubierre"
  | "irrotational";

export type WarpSdfPreview = {
  key?: string | null;
  hash?: string | null;
  meshHash?: string | null;
  basisSignature?: string | null;
  dims?: [number, number, number] | null;
  bounds?: [number, number, number] | null;
  voxelSize?: number | null;
  band?: number | null;
  format?: "float" | "byte" | null;
  clampReasons?: string[] | null;
  stats?: {
    sampleCount?: number;
    voxelsTouched?: number;
    voxelCoverage?: number;
    trianglesTouched?: number;
    triangleCoverage?: number;
    maxAbsDistance?: number;
    maxQuantizationError?: number;
  } | null;
  updatedAt?: number | null;
};

export type GeometryPreviewSnapshot = {
  preview?: HullPreviewPayload | null;
  mesh?: CardMeshMetadata | null;
  sdf?: WarpSdfPreview | null;
  lattice?: CardLatticeMetadata | null;
  updatedAt?: number | null;
};

export interface WarpGeometrySpec extends FieldGeometryRequest {
  assetId?: string;
  resolution?: number;
  band_m?: number;
  bounds_m?: [number, number, number];
  format?: "float" | "byte";
  wallThickness_m?: number;
  driveDirection?: [number, number, number];
}
export interface TileParams {
  gap_nm: number;           // Casimir cavity gap in nanometers
  radius_mm: number;        // Radius of curvature in millimeters
  sag_nm?: number;          // Optional sag depth in nanometers
  temperature_K?: number;   // Temperature in Kelvin
  Q_factor?: number;        // Quality factor for dynamic Casimir
  gammaGeo?: number;        // Geometric amplification factor
  dutyCycle?: number;       // Duty cycle (0-1)
  sectorCount?: number;     // Number of sectors for strobing
}

export type AmpFactors = {
  // Design values (pipeline prefers measured overrides when present).
  gammaGeo?: number;
  gammaVanDenBroeck?: number;
  qSpoilingFactor?: number;
  qMechanical?: number;
  qCavity?: number;
  // Measured overrides (telemetry or lab calibration).
  measuredGammaGeo?: number;
  measuredGammaVanDenBroeck?: number;
  measuredQSpoilingFactor?: number;
  measuredQMechanical?: number;
  measuredCavityQ?: number;
};

export type TsTelemetry = {
  TS_ratio?: number;
  tauLC_ms?: number;
  tauPulse_ns?: number;
  metricDerived?: boolean;
  metricDerivedSource?: string;
  metricDerivedReason?: string;
  metricDerivedChart?: string;
  autoscale?: TsAutoscaleState;
};

export type QuantumInterestBook = {
  neg_Jm3: number;        // Scheduled negative burst (window-normalized)       
  pos_Jm3: number;        // Scheduled positive payback (window-normalized)     
  debt_Jm3: number;       // Required positive overcompensation (with interest) 
  credit_Jm3: number;     // Available positive energy scheduled in window      
  margin_Jm3: number;     // credit - debt (>=0 means paid)
  netCycle_Jm3: number;   // pos - neg over a full cycle (without interest)     
  window_ms: number;      // payback window allocated
  rate: number;           // interest fraction applied to debt
};

export type CasimirForceInference = {
  datasetId?: string;
  referenceSeparation_m?: number;
  energy_J_at_a0?: number;
  sigmaEnergy_J?: number;
  kCasimir?: number;
  sigmaK?: number;
  sampleCount?: number;
  fitResiduals?: {
    rms_N?: number;
    rms_rel?: number;
    sampleCount?: number;
  };
  forceSign?: {
    expected?: "negative" | "positive";
    observed?: "negative" | "positive" | "mixed" | "unknown";
    positiveFraction?: number;
    negativeFraction?: number;
    sampleCount?: number;
    autoFlipApplied?: boolean;
    note?: string;
  };
  note?: string;
};

export interface MechanicalFeasibility {
  requestedGap_nm: number;
  requestedStroke_pm: number;
  recommendedGap_nm: number;
  minGap_nm: number;
  safetyFactorMin: number;
  mechSafetyFactor: number;
  sigmaYield_Pa: number;
  sigmaAllow_Pa: number;
  loadPressure_Pa: number;
  maxStroke_pm: number;
  casimirPressure_Pa: number;
  electrostaticPressure_Pa: number;
  restoringPressure_Pa: number;
  roughnessGuard_nm: number;
  margin_Pa: number;
  safetyFeasible: boolean;
  feasible: boolean;
  strokeFeasible: boolean;
  constrainedGap_nm?: number;
  casimirGap_nm?: number;
  modelMode?: 'calibrated' | 'raw';
  unattainable?: boolean;
  note?: string;
  sweep?: Array<{ gap_nm: number; margin_Pa: number; feasible: boolean }>;
}

export type MechanicalGuard = {
  qMechDemand: number;    // stroke factor needed to hit target power (may exceed 1)
  qMechApplied: number;   // stroke factor actually applied (clamped to safety band)
  mechSpoilage: number;   // demand/applied: >=1 shows how far past the safe limit we are
  pCap_W: number;         // ship-average power deliverable at q_mech = 1
  pApplied_W: number;     // ship-average power with the applied q_mech
  pShortfall_W: number;   // max(0, P_target - pApplied_W)
  status: 'ok' | 'saturated' | 'fail';
};

export type VdbRegionIIDiagnostics = {
  alpha: number;
  n: number;
  r_tilde_m: number;
  delta_tilde_m: number;
  sampleCount: number;
  b_min: number;
  b_max: number;
  bprime_min: number;
  bprime_max: number;
  bprime_rms: number;
  bdouble_min: number;
  bdouble_max: number;
  bdouble_rms: number;
  t00_min: number;
  t00_max: number;
  t00_mean: number;
  t00_rms: number;
  support: boolean;
  note?: string;
};

export type VdbRegionIVDiagnostics = {
  R_m: number;
  sigma: number;
  sampleCount: number;
  dfdr_max_abs: number;
  dfdr_rms: number;
  beta?: number;
  r_min_m?: number;
  r_max_m?: number;
  step_m?: number;
  t00_min?: number;
  t00_max?: number;
  t00_mean?: number;
  t00_rms?: number;
  k_trace_mean?: number;
  k_squared_mean?: number;
  support: boolean;
  note?: string;
};

export type SurfaceAreaEstimate = {
  value: number; // preferred estimate (metric quadrature)
  uncertainty: number; // +- absolute m^2
  band: { min: number; max: number };
  sectorAreas?: number[]; // optional per-sector estimate aligned with sectorCount
  sectors?: number;
  components: {
    metric: number;
    monteCarlo?: { value: number; stderr: number; samples: number };
    prolateApprox?: number | null;
    oblateApprox?: number | null;
  };
};

export type HullBrickChannel = {
  data: string;
  min?: number;
  max?: number;
};

export type HullBrickBounds = {
  min?: [number, number, number];
  max?: [number, number, number];
  center?: [number, number, number];
  extent?: [number, number, number];
  axes?: [number, number, number];
  wall?: number;
};

export type HullBrickPayload = {
  dims: [number, number, number];
  voxelBytes?: number;
  format?: "r32f";
  channels: {
    hullDist?: HullBrickChannel;
    hullMask?: HullBrickChannel;
  };
  bounds?: HullBrickBounds;
  meta?: unknown;
};

export type GrConstraintDiagnostics = {
  min: number;
  max: number;
  maxAbs: number;
  rms?: number;
  mean?: number;
  sampleCount?: number;
};

export type GrMomentumConstraintDiagnostics = {
  rms: number;
  maxAbs: number;
  components: {
    x: GrConstraintDiagnostics;
    y: GrConstraintDiagnostics;
    z: GrConstraintDiagnostics;
  };
};

export type GrPipelineDiagnostics = {
  updatedAt: number;
  source: "gr-evolve-brick";
  meta?: import("./gr-evolve-brick").GrBrickMeta;
  metricAdapter?: WarpMetricAdapterSnapshot;
  grid: {
    dims: [number, number, number];
    bounds: { min: Vec3; max: Vec3 };
    voxelSize_m: Vec3;
    time_s: number;
    dt_s: number;
  };
  solver: {
    steps: number;
    iterations: number;
    tolerance: number;
    cfl: number;
    fixups?: import("./gr-evolve-brick").GrEvolveBrickStats["fixups"];
    health?: import("./gr-evolve-brick").GrEvolveBrickStats["solverHealth"];
  };
  gauge?: {
    lapseMin: number;
    lapseMax: number;
    betaMaxAbs: number;
    betaOverAlphaMax?: number;
    betaOverAlphaP98?: number;
    betaOutwardOverAlphaWallMax?: number | null;
    betaOutwardOverAlphaWallP98?: number | null;
    wallHorizonMargin?: number | null;
  };
  divBeta?: {
    rms: number;
    maxAbs: number;
    source: "gr_evolve_brick";
  };
  theta?: {
    mean: number;
    maxAbs: number;
    source: "gr_evolve_brick_theta" | "gr_evolve_brick_neg_k_trace";
  };
  kTrace?: {
    mean: number;
    maxAbs: number;
    source: "gr_evolve_brick";
  };
  stiffness?: import("./gr-evolve-brick").GrEvolveBrickStats["stiffness"];
  constraints: {
    H_constraint: GrConstraintDiagnostics;
    M_constraint: GrMomentumConstraintDiagnostics;
    rho_constraint?: GrConstraintDiagnostics;
  };
  invariants?: import("./gr-evolve-brick").GrInvariantStatsSet;
  matter?: {
    stressEnergy?: StressEnergyStats;
  };
  perf?: {
    totalMs: number;
    evolveMs: number;
    brickMs: number;
    voxels: number;
    channelCount: number;
    bytesEstimate: number;
    msPerStep: number;
  };
};

export type MetricConstraintAudit = {
  updatedAt: number;
  source: string;
  chart?: string;
  family?: string;
  observer?: string;
  normalization?: string;
  unitSystem?: string;
  rho_constraint: GrConstraintDiagnostics;
};

export type GrInvariantBaseline = {
  invariants?: import("./gr-evolve-brick").GrInvariantStatsSet;
  source?: string;
  updatedAt?: number;
};

export type GrRequestPayload = {
  P_avg_W: number;
  dutyEffectiveFR: number;
  gammaGeo: number;
  gammaVdB: number;
  qSpoil: number;
  TS_ratio: number;
  hull: { Lx_m: number; Ly_m: number; Lz_m: number; wallThickness_m?: number };
  hullArea_m2?: number;
  N_tiles: number;
  tilesPerSector: number;
  warp?: {
    metricAdapter?: {
      chart?: { label?: string };
    };
    metricT00Contract?: {
      observer?: string;
      normalization?: string;
      unitSystem?: string;
    };
  };
};

export type CongruentWarpSolveSnapshot = {
  pass: boolean;
  policyMarginPass: boolean;
  computedMarginPass: boolean;
  applicabilityPass: boolean;
  metricPass: boolean;
  semanticPass: boolean;
  failReasons: string[];
  marginRatioRaw: number | null;
  marginRatioRawComputed: number | null;
  applicabilityStatus: "PASS" | "FAIL" | "NOT_APPLICABLE" | "UNKNOWN" | null;
  quantitySemanticType: string | null;
  quantityWorldlineClass: string | null;
  rhoSource: string | null;
  metricDerivedSource: string | null;
  strictMode: boolean;
};

export interface EnergyPipelineState {
  // Input parameters
  tileArea_cm2: number;
  tilePitch_m?: number;
  gap_nm: number;
  sag_nm: number;
  temperature_K: number;
  modulationFreq_GHz: number;
  couplingChiOverride?: number;       // manual chi override (0..1)
  couplingSupercellTiles?: number;    // tiles in measured supercell
  couplingSupercellEnergy_J?: number; // measured supercell energy
  couplingFrameFill?: number;         // packing/coverage fraction for coupling calc
  experimental?: {
    casimirForce?: CasimirForceDataset;
  };
  quantum_semiclassical_source_replay_id?: string | null;
  quantum_semiclassical_tau_or_predicted_s?: number | null;
  quantum_semiclassical_collapse_bound_margin?: number | null;

  // Hull geometry
  hull?: { Lx_m: number; Ly_m: number; Lz_m: number; wallThickness_m?: number }; // Paper-authentic stack ~1 m; default auto-tunes to modulation dwell
  driveDir?: [number, number, number];
  warpFieldType?: WarpFieldType;
  warpGeometry?: WarpGeometrySpec | null;
  warpGeometryKind?: GeometryKind;
  warpGeometryAssetId?: string;
  geometryPreview?: GeometryPreviewSnapshot | null;
  hullBrick?: HullBrickPayload | null;
  bubble?: {
    R?: number;
    sigma?: number;
    beta?: number;
    dutyGate?: number;
  };
  // Legacy top-level bubble mirrors
  beta?: number;
  sigma?: number;
  R?: number;
  cardRecipe?: CardRecipe;

  // Mode parameters
  currentMode: 'hover' | 'taxi' | 'nearzero' | 'cruise' | 'emergency' | 'standby';
  dutyCycle: number;
  dutyShip: number;           // Ship-wide effective duty (promoted from any)
  sectorCount: number;        // Total sectors
  concurrentSectors: number; // Live concurrent sectors (1-2)
  sectorStrobing: number;     // Legacy alias for UI compatibility
  qSpoilingFactor: number;
  negativeFraction: number;   // Share of sectors assigned to negative lobe (0..1)

  // Pulsed-load current ceilings (enforced by command helpers)
  iPeakMaxMidi_A?: number;
  iPeakMaxSector_A?: number;
  iPeakMaxLauncher_A?: number;

  // Physics parameters
  gammaGeo: number;
  qMechanical: number;
  qCavity: number;
  QL?: number;
  gammaVanDenBroeck: number;
  exoticMassTarget_kg: number;  // User-configurable exotic mass target
  casimirModel?: MaterialModel;
  materialProps?: MaterialProps;
  ampFactors?: AmpFactors;      // Amplification factors (gamma, q) surfaced for UI + warp module
  /** @deprecated use ampFactors */
  amps?: AmpFactors;

  // Calculated values
  U_static: number;         // Static Casimir energy per tile
  U_static_nominal?: number;
  U_static_realistic?: number;
  U_static_uncoupled?: number;
  U_static_band?: { min: number; max: number };
  casimirRatio?: number;
  casimirMaterialReceipt?: CasimirMaterialReceiptV1;
  lifshitzSweep?: Array<{ gap_nm: number; ratio: number }>;
  couplingChi?: number;
  couplingMethod?: string;
  couplingNote?: string;
  casimirForceInference?: CasimirForceInference;
  supercellRatio?: number;
  U_geo: number;            // Geometry-amplified energy
  U_Q: number;              // Q-enhanced energy
  U_cycle: number;          // Duty-cycled energy
  P_loss_raw: number;       // Raw power loss per tile
  P_avg: number;            // Average power (throttled)
  P_target_W?: number;      // Mode policy target (ship-average, W)
  P_cap_W?: number;         // Mode policy cap (ship-average, W)
  physicsCap_W?: number;    // Ship-average cap at q_mech=1 (no policy cap)
  P_applied_W?: number;     // Applied ship-average power after caps/guards (W)
  // Speed/beta closure (derived)
  beta_trans_power?: number; // Power throttle fraction (0..1)
  beta_policy?: number;      // +¦ from policy throttle
  shipBeta?: number;         // Effective +¦ (v/c proxy)
  vShip_mps?: number;        // Outside-frame coordinate speed
  speedClosure?: 'policyA' | 'proxyB';
  M_exotic: number;         // Exotic mass generated
  M_exotic_raw: number;     // Raw physics exotic mass (before calibration)
  massCalibration: number;  // Mass calibration factor
  rho_static?: number;      // Static Casimir energy density (J/m^3)
  rho_inst?: number;        // Instantaneous (on-window) energy density (J/m^3)
  rho_avg?: number;         // Cycle-averaged energy density (J/m^3)
  rho_constraint?: GrConstraintDiagnostics; // Constraint-derived energy density (geometry-based)
  rho_constraint_source?: string;           // Source tag for rho_constraint
  rho_delta_metric_mean?: number;           // Relative delta vs metric-derived T00
  rho_delta_pipeline_mean?: number;         // Relative delta vs pipeline rho_avg
  rho_delta_threshold?: number;             // CL3 threshold (relative)
  rho_delta_gate?: boolean;                 // CL3 gate pass/fail
  rho_delta_gate_reason?: string;           // CL3 gate reason
  rho_delta_gate_source?: string;           // CL3 gate source tag
  rho_delta_missing_parts?: string[];       // Missing input list for CL3 delta
  U_static_total?: number;  // Aggregate static energy across hull (N_tiles * U_static)
  U_static_total_band?: { min: number; max: number };
  gammaChain?: {
    geo_cubed?: number;
    qGain?: number;
    pocketCompression?: number;
    dutyEffective?: number;
    qSpoiling?: number;
    note?: string;
  };
  gammaVanDenBroeckGuard?: {
    limit: number;
    greenBand: { min: number; max: number };
    pocketRadius_m: number;
    pocketThickness_m: number;
    planckMargin: number;
    admissible: boolean;
    reason: string;
    requested?: number;
    targetHit?: boolean;
    targetShortfall?: number;
  };
  vdbRegionII?: VdbRegionIIDiagnostics;
  vdbRegionIV?: VdbRegionIVDiagnostics;
  TS_ratio: number;         // Time-scale separation ratio (conservative)
  TS_long?: number;         // Time-scale using longest dimension
  TS_geom?: number;         // Time-scale using geometric mean
  tsAutoscale?: TsAutoscaleState; // Averaging guard servo telemetry
  ts?: TsTelemetry;         // TS guard snapshot for UI/certs
  zeta: number;             // Quantum inequality parameter
  hullArea?: SurfaceAreaEstimate; // Detailed surface area estimate with uncertainty
  N_tiles: number;          // Total number of tiles
  N_tiles_band?: { min: number; max: number }; // Census range propagated from geometry uncertainty
  hullArea_m2?: number;     // Hull surface area (for Bridge display)
  hullAreaOverride_m2?: number;
  hullAreaOverride_uncertainty_m2?: number;
  hullAreaPerSector_m2?: number[]; // Optional per-sector surface area map (m^2)
  __hullAreaSource?: "override" | "ellipsoid";
  __hullAreaEllipsoid_m2?: number;
  __hullAreaPerSectorSource?: "override" | "ellipsoid" | "uniform";

  latestSectorControlLiveEvent?: SectorControlLiveEvent & {
    source: "server";
    updatedAt: number;
  };

  // Sector management
  tilesPerSector: number;   // Tiles per sector
  tilesPerSectorVector?: number[]; // Geometry-aware allocation (sums to N_tiles)
  tilesPerSectorUniform?: number[]; // Uniform allocation (legacy baseline)
  tilePowerDensityScale?: Array<number | null>; // Desired/actual tile ratio if uniform allocation is forced
  tilesPerSectorStrategy?: "area-weighted" | "uniform";
  activeSectors: number;    // Currently active sectors
  activeTiles: number;      // Currently active tiles
  activeFraction: number;   // Active sectors / total sectors
  phaseSchedule?: PhaseScheduleTelemetry;

  // Internal calculation helpers (optional fields)
  __sectors?: any;          // Sector calculation cache
  __fr?: any;               // Ford-Roman calculation cache

  // System status
  fordRomanCompliance: boolean;
  natarioConstraint: boolean;
  curvatureLimit: boolean;
  overallStatus: 'NOMINAL' | 'WARNING' | 'CRITICAL';
  qi?: QiStats;
  qiBadge?: 'ok' | 'near' | 'violation';
  clocking?: ClockingSnapshot;
  clockingProvenance?: "derived" | "hardware" | "simulated";
  tsMetricDerived?: boolean;
  tsMetricDerivedSource?: string;
  tsMetricDerivedReason?: string;
  mechanical?: MechanicalFeasibility;
  mechGuard?: MechanicalGuard;

  // GR diagnostics (optional)
  grEnabled?: boolean;
  gr?: GrPipelineDiagnostics;
  grBaseline?: GrInvariantBaseline;
  grRequest?: GrRequestPayload;
  shiftLapseTransportPromotionGate?: WarpShiftLapseTransportPromotionGate;
  warpWorldline?: WarpWorldlineContractV1;
  warpCruiseEnvelopePreflight?: WarpCruiseEnvelopePreflightContractV1;
  warpRouteTimeWorldline?: WarpRouteTimeWorldlineContractV1;
  warpMissionTimeEstimator?: WarpMissionTimeEstimatorContractV1;
  warpMissionTimeComparison?: WarpMissionTimeComparisonContractV1;
  warpCruiseEnvelope?: WarpCruiseEnvelopeContractV1;
  nhm2PhaseTopology?: Nhm2PhaseTopologyArtifact;
  warpInHullProperAcceleration?: WarpInHullProperAccelerationContractV1;
  warpViability?: {
    certificate: WarpViabilityCertificate;
    certificateHash?: string;
    certificateId?: string;
    integrityOk?: boolean;
    status?: ViabilityStatus;
    constraints?: ViabilityConstraint[];
    snapshot?: WarpSnapshot;
    updatedAt?: number;
  };

  // Strobing and timing properties
  strobeHz?: number;
  sectorPeriod_ms?: number;
  dutyBurst?: number;
  localBurstFrac?: number;
  dutyEffective_FR?: number;
  dutyMeasuredFR?: number;
  sigmaSector?: number;
  splitEnabled?: boolean;
  splitFrac?: number;
  phase01?: number;
  pumpPhase_deg?: number;
  tauLC_ms?: number;

  // --- Compatibility / adapter fields (optional) ---
  // Alternative or legacy keys that may be emitted/consumed by adapters or clients.
  lc?: any;
  lightCrossing?: any;
  dutyUsed?: number;
  dutyEffectiveFR?: number; // camel-case alias
  dutyFR_slice?: number;
  dutyFR_ship?: number;
  dutyEff?: number;
  natario?: any;
  P_avg_W?: number;
  busVoltage_kV?: number;
  busCurrent_A?: number;

  // Model mode for client consistency
  modelMode?: 'calibrated' | 'raw';
  // Mass provenance mode for client consistency
  massMode?: MassMode;
  // Mass provenance for downstream modules
  massSource?: MassSource;
  massDatasetId?: string;
  massFitResiduals?: {
    rms_N?: number;
    rms_rel?: number;
    sampleCount?: number;
  };
  massSigma_kg?: number;
  invariantMassSigma_kg?: number;
  // Experimental control provenance (measured vs design/policy)
  gammaGeoSource?: ControlSource;
  gammaVanDenBroeckSource?: ControlSource;
  qSpoilingFactorSource?: ControlSource;
  qCavitySource?: ControlSource;
  modulationFreqSource?: ControlSource;
  dutyCycleSource?: ControlSource;
  dutyBurstSource?: ControlSource;
  sectorCountSource?: ControlSource;
  sectorDutySource?: ControlSource;

  // Environment telemetry (optional; surfaced to /metrics)
  atmDensity_kg_m3?: number | null;
  altitude_m?: number | null;

  // Dynamic sweep cache
  dynamicConfig?: MutableDynamicConfig | null;
  vacuumGapSweepResults?: VacuumGapSweepRow[];
  vacuumGapSweepRowsTotal?: number;
  vacuumGapSweepRowsDropped?: number;
  hardwareTruth?: HardwareTruthSnapshot | null;
  sweep?: SweepRuntime;
  gateAnalytics?: GateAnalytics | null;
  qiInterest?: QuantumInterestBook | null;
  qiAutothrottle?: QiAutothrottleState | null;
  qiAutoscale?: QiAutoscaleState | null;
  congruentSolve?: CongruentWarpSolveSnapshot | null;
  curvatureMeta?: CongruenceMeta;
  stressMeta?: CongruenceMeta;
  metricConstraint?: MetricConstraintAudit;
  nhm2ObserverAudit?: Nhm2ObserverAuditArtifact;
  nhm2ObserverRobustEnergyConditions?: {
    metricRequired: Nhm2ObserverRobustEnergyConditionArtifactV1;
    tileEffective: Nhm2ObserverRobustEnergyConditionArtifactV1;
  };
  nhm2SameChartFullTensor?: Nhm2SameChartFullTensorArtifactV1;
  nhm2SourceClosure?: Nhm2SourceClosureArtifact | Nhm2SourceClosureV2Artifact;
  nhm2SourceSideSameBasisTensorAuthority?: Nhm2SourceSideSameBasisTensorAuthorityArtifactV1;
  nhm2WallSourceClosure?: Nhm2WallSourceClosureArtifactV1;
  nhm2StrictSignalReadiness?: Nhm2StrictSignalReadinessArtifact;
  nhm2QeiWorldlineDossier?: Nhm2QeiWorldlineDossierV1;
  nhm2NatarioInvariantAudit?: Nhm2NatarioInvariantAuditV1;
}

export const buildGrRequestPayload = (state: EnergyPipelineState): GrRequestPayload => {
  const hull = resolveHullGeometry(state);

  const pAvgRaw = (state as any).P_avg_W;
  const P_avg_W = Number.isFinite(pAvgRaw)
    ? Number(pAvgRaw)
    : Number.isFinite(state.P_applied_W)
    ? Number(state.P_applied_W)
    : Number.isFinite(state.P_avg)
    ? Number(state.P_avg) * 1e6
    : 0;
  const dutyRaw =
    state.dutyEffective_FR ??
    (state as any).dutyEffectiveFR ??
    state.dutyShip ??
    (state as any).dutyEff ??
    state.dutyCycle;
  const dutyEffectiveFR = Number.isFinite(dutyRaw) ? Number(dutyRaw) : 0;
  const gammaGeo = Number.isFinite(state.gammaGeo) ? Number(state.gammaGeo) : 0;
  const gammaVdB = Number.isFinite(state.gammaVanDenBroeck) ? Number(state.gammaVanDenBroeck) : 0;
  const qSpoil = Number.isFinite(state.qSpoilingFactor) ? Number(state.qSpoilingFactor) : 0;
  const TS_ratio = Number.isFinite(state.TS_ratio) ? Number(state.TS_ratio) : 0;
  const hullArea_m2 = Number.isFinite(state.hullArea_m2) ? Number(state.hullArea_m2) : undefined;
  const N_tiles = Number.isFinite(state.N_tiles) ? Math.round(state.N_tiles) : 0;
  const tilesPerSector = Number.isFinite(state.tilesPerSector)
    ? Math.round(state.tilesPerSector)
    : 0;
  const warpState = ((state as any).warp ?? {}) as Record<string, any>;
  const metricAdapter = (warpState.metricAdapter ?? {}) as Record<string, any>;
  const chart = (metricAdapter.chart ?? {}) as Record<string, any>;
  const metricContract = (warpState.metricT00Contract ?? {}) as Record<string, any>;

  return {
    P_avg_W,
    dutyEffectiveFR,
    gammaGeo,
    gammaVdB,
    qSpoil,
    TS_ratio,
    hull,
    hullArea_m2,
    N_tiles,
    tilesPerSector,
    warp: {
      metricAdapter: {
        chart: {
          label: typeof chart.label === 'string' ? chart.label : 'unspecified',
        },
      },
      metricT00Contract: {
        observer:
          typeof metricContract.observer === 'string'
            ? metricContract.observer
            : typeof warpState.metricT00Observer === 'string'
              ? warpState.metricT00Observer
              : 'unknown',
        normalization:
          typeof metricContract.normalization === 'string'
            ? metricContract.normalization
            : typeof warpState.metricT00Normalization === 'string'
              ? warpState.metricT00Normalization
              : 'unknown',
        unitSystem:
          typeof metricContract.unitSystem === 'string'
            ? metricContract.unitSystem
            : typeof warpState.metricT00UnitSystem === 'string'
              ? warpState.metricT00UnitSystem
              : 'unknown',
      },
    },
  };
};

export function buildCardRecipeFromPipeline(state: EnergyPipelineState): CardRecipe {
  const clamp01 = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(1, n));
  };
  const toVec3 = (value: unknown): [number, number, number] | undefined => {
    if (!Array.isArray(value) || value.length < 3) return undefined;
    const [x, y, z] = value;
    const nx = Number(x);
    const ny = Number(y);
    const nz = Number(z);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return undefined;
    return [nx, ny, nz];
  };

  const hull: CardRecipe["hull"] = resolveHullGeometry(state);

  const overrideArea = Number.isFinite(state.hullAreaOverride_m2) && (state.hullAreaOverride_m2 as number) > 0
    ? (state.hullAreaOverride_m2 as number)
    : undefined;
  const overrideUnc = Number.isFinite(state.hullAreaOverride_uncertainty_m2)
    ? Math.max(0, Number(state.hullAreaOverride_uncertainty_m2))
    : undefined;
  const area: CardRecipe["area"] = {
    hullAreaOverride_m2: overrideArea,
    hullAreaOverride_uncertainty_m2: overrideUnc,
    hullArea_m2: Number.isFinite(state.hullArea_m2) ? Number(state.hullArea_m2) : undefined,
    __hullAreaSource: typeof state.__hullAreaSource === "string"
      ? (state.__hullAreaSource as CardRecipe["area"]["__hullAreaSource"])
      : undefined,
  };

  const tilesPerSectorVector = Array.isArray(state.tilesPerSectorVector)
    ? state.tilesPerSectorVector.map((value) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      })
    : undefined;
  const blanket: CardRecipe["blanket"] = {
    tilesPerSectorVector: tilesPerSectorVector && tilesPerSectorVector.length ? tilesPerSectorVector : undefined,
    activeFraction: clamp01(state.activeFraction),
  };

  const gateSourceRaw = typeof (state as any).gateSource === "string" ? (state as any).gateSource : undefined;
  const gateSource =
    gateSourceRaw === "blanket" || gateSourceRaw === "combined" ? gateSourceRaw : "schedule";
  const gateViewRaw = (state as any).gateView;
  const volumeDomainRaw = (state as any).volumeDomain;
  const volumeDomain: CardRecipe["viz"]["volumeDomain"] =
    volumeDomainRaw === "bubbleBox" ? "bubbleBox" : "wallBand";
  const volumeSourceRaw = (state as any).volumeSource;
  const volumeSource: CardRecipe["viz"]["volumeSource"] =
    volumeSourceRaw === "analytic" || volumeSourceRaw === "brick" || volumeSourceRaw === "lattice"
      ? volumeSourceRaw
      : "lattice";
  const viz: CardRecipe["viz"] = {
    volumeViz: "theta_drive",
    volumeDomain,
    volumeSource,
    gateSource,
    gateView: typeof gateViewRaw === "boolean" ? gateViewRaw : true,
    ...(typeof (state as any).forceFlatGate === "boolean"
      ? { forceFlatGate: (state as any).forceFlatGate as boolean }
      : {}),
  };

  const warpGeometryRaw = state.warpGeometry ?? undefined;
  const warpGeometry =
    warpGeometryRaw && typeof warpGeometryRaw === "object"
      ? (({ geometryKind: _gk, ...rest }) => rest)(warpGeometryRaw as Record<string, unknown>)
      : undefined;
  const geometry: CardRecipe["geometry"] = {
    warpFieldType: state.warpFieldType,
    warpGeometryKind: state.warpGeometryKind ?? (warpGeometryRaw as any)?.geometryKind,
    warpGeometryAssetId: state.warpGeometryAssetId ?? (warpGeometryRaw as any)?.assetId,
    warpGeometry: warpGeometry as any,
  };

  const cameraSource = (state as any).camera ?? (state as any).hullCamera ?? null;
  let camera: CardRecipe["camera"] = undefined;
  if (cameraSource && typeof cameraSource === "object") {
    const eye = toVec3((cameraSource as any).eye);
    const target = toVec3((cameraSource as any).target ?? (cameraSource as any).center);
    const up = toVec3((cameraSource as any).up);
    const radius_m = Number.isFinite((cameraSource as any).radius)
      ? Math.max(0, Number((cameraSource as any).radius))
      : undefined;
    const yaw_deg = Number.isFinite((cameraSource as any).yaw_deg ?? (cameraSource as any).yaw)
      ? Number((cameraSource as any).yaw_deg ?? (cameraSource as any).yaw)
      : undefined;
    const pitch_deg = Number.isFinite((cameraSource as any).pitch_deg ?? (cameraSource as any).pitch)
      ? Number((cameraSource as any).pitch_deg ?? (cameraSource as any).pitch)
      : undefined;
    const fov_deg = Number.isFinite((cameraSource as any).fov_deg ?? (cameraSource as any).fov)
      ? Number((cameraSource as any).fov_deg ?? (cameraSource as any).fov)
      : undefined;
    const presetRaw = (cameraSource as any).preset;
    const preset =
      presetRaw === "threeQuarterFront" || presetRaw === "broadside" || presetRaw === "topDown"
        ? presetRaw
        : undefined;

    if (
      eye ||
      target ||
      up ||
      radius_m !== undefined ||
      yaw_deg !== undefined ||
      pitch_deg !== undefined ||
      fov_deg !== undefined ||
      preset
    ) {
      camera = { eye, target, up, radius_m, yaw_deg, pitch_deg, fov_deg, preset };
    }
  }

  return {
    schemaVersion: CARD_RECIPE_SCHEMA_VERSION,
    hull,
    area,
    blanket,
    viz,
    geometry,
    camera,
    ...(state.geometryPreview?.mesh ? { mesh: state.geometryPreview.mesh as CardMeshMetadata } : {}),
    ...(state.geometryPreview?.lattice
      ? { lattice: state.geometryPreview.lattice as CardLatticeMetadata }
      : {}),
  };
}

// Physical constants
const HBAR_C = HBAR * C;             // G+ñ+àc G+½+¬ 3.16152677e-26 [J-+m] for Casimir calculations
const NM_TO_M = 1e-9;
const CM2_TO_M2 = 1e-4;

// G+¦+çG+¦+ç Paper-backed constants (consolidated physics)
/**
 * TheoryRefs:
 *  - ford-roman-qi-1995: derives dutyEffectiveFR ceiling (tau/K)
 */
const TOTAL_SECTORS    = 400;
const BURST_DUTY_LOCAL = 0.01;   // 10 --ªs / 1 ms
const Q_BURST          = 1e9;    // active-window Q for dissipation and DCE
const GAMMA_VDB        = 1e11;   // fixed seed (raw physics)
const RADIAL_LAYERS    = 10;     // surface ++¦ radial lattice

// Public clamp constants for display-only symmetry (do not affect ++/mass)
export const SAMPLE_CLAMP = { maxPush: 0.10, softness: 0.60 } as const;
export type SampleClamp = typeof SAMPLE_CLAMP;

// Export paper constants so UI and docs can reference the single source of truth
export const PAPER_GEO = { PACKING: 0.88, RADIAL_LAYERS: 10 } as const;
export const PAPER_DUTY = { TOTAL_SECTORS, BURST_DUTY_LOCAL } as const;
export const PAPER_Q    = { Q_BURST } as const;
export const PAPER_VDB  = { GAMMA_VDB } as const;
export const SWEEP_HISTORY_MAX = 2000;
const sweepHistory: VacuumGapSweepRow[] = [];
let sweepHistoryTotal = 0;
let sweepHistoryDropped = 0;
const PLANCK_LENGTH_M = 1.616255e-35; // m
const PLANCK_SAFETY_MULT = 1e6;       // keep pockets many orders above l_P
const POCKET_WALL_FLOOR_FRAC = 0.01;  // require VdB pocket >1% of wall thickness
const VDB_PROFILE_N = 80;            // Van Den Broeck polynomial order (paper example)
const VDB_REGION_SAMPLES = 64;       // sample count across region II band
const VDB_BPRIME_MIN_ABS = parseEnvNumber(process.env.WARP_VDB_BPRIME_MIN_ABS, 1e-18);
const VDB_BDOUBLE_MIN_ABS = parseEnvNumber(
  process.env.WARP_VDB_BDOUBLE_MIN_ABS,
  1e-18,
);
const VDB_DFDR_MIN_ABS = parseEnvNumber(process.env.WARP_VDB_DFDR_MIN_ABS, 1e-18);

// Mechanical feasibility defaults (nm-scale gap over 25 cm^2 plate)
const EPSILON_0 = 8.8541878128e-12; // F/m
const MECH_TILE_THICKNESS_M = parseEnvNumber(process.env.MECH_TILE_THICKNESS_M, 1e-3); // 1 mm slab unless overridden
const MECH_ELASTIC_MODULUS_PA = parseEnvNumber(process.env.MECH_YOUNG_MODULUS_PA, 170e9); // silicon-ish stiffness
const MECH_POISSON = parseEnvNumber(process.env.MECH_POISSON_RATIO, 0.27);
const MECH_DEFLECTION_COEFF = 0.0138; // clamped square plate under uniform load (Roark)
const MECH_ROUGHNESS_RMS_NM = parseEnvNumber(process.env.MECH_ROUGHNESS_RMS_NM, 0.2);
const MECH_ROUGHNESS_SIGMA = parseEnvNumber(process.env.MECH_ROUGHNESS_SIGMA, 5); // 5-â separation guard
const MECH_PATCH_V_RMS = parseEnvNumber(process.env.MECH_PATCH_V_RMS, 0.05); // volts (50 mV patch noise)
const MECH_GAP_SWEEP = { min_nm: 0.5, max_nm: 200, step_nm: 0.5 } as const;
const MECH_SPAN_SCALE_RAW = parseEnvNumber(process.env.MECH_SPAN_SCALE_RAW, 0.2); // compress effective span to represent ribbed sub-tiles (raw)
const MECH_SPAN_SCALE_CAL = parseEnvNumber(process.env.MECH_SPAN_SCALE_CAL, 1);   // calibrated keeps full tile span
const MECH_TILE_THICKNESS_RAW_M = parseEnvNumber(process.env.MECH_TILE_THICKNESS_RAW_M, 0.004); // 4 mm diamond backbone
const MECH_ELASTIC_MODULUS_RAW_PA = parseEnvNumber(process.env.MECH_YOUNG_MODULUS_RAW_PA, 900e9); // diamond-class stiffness for raw
const MECH_YIELD_STRESS_PA = parseEnvNumber(process.env.MECH_YIELD_STRESS_PA, 60e9); // CNT/DNT frame design target
const MECH_SAFETY_FACTOR_DESIGN = parseEnvNumber(process.env.MECH_SAFETY_FACTOR_DESIGN ?? process.env.MECH_SAFETY_FACTOR, 10);
const MECH_SAFETY_MIN_RAW = parseEnvNumber(process.env.MECH_SAFETY_MIN_RAW, 3);
const MECH_SAFETY_MIN_CAL = parseEnvNumber(process.env.MECH_SAFETY_MIN_CAL, 1);

const ACTIVE_SLEW_LIMITS = {
  gaps: 12,
  modDepth: 3,
  phase: 9,
  pump: 3,
  delayMs: 5,
} as const;
const TWO_PHASE_TARGET_RHO = 0.85;
const TWO_PHASE_MIN_MOD_DEPTH_PCT = 0.001;

function resolveActiveSlewLimit(value: unknown, fallback: number, min = 1, max?: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const upper = Number.isFinite(max ?? NaN) ? Math.max(min, Number(max)) : undefined;
  const clamped = Math.floor(Math.max(min, upper != null ? Math.min(num, upper) : num));
  return clamped;
}

type PumpGuardStats = {
  clamped: number;
  rejected: number;
};

function normalizePumpFreqLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_PUMP_FREQ_LIMIT_GHZ;
  }
  return Math.max(0.01, Math.min(numeric, DEFAULT_PUMP_FREQ_LIMIT_GHZ));
}

function sanitizePumpFrequencies(
  freqs: number[] | undefined,
  limit: number,
  stats?: PumpGuardStats,
  digits = 6,
): number[] {
  if (!Array.isArray(freqs) || !freqs.length) return [];
  const sanitized: number[] = [];
  for (const value of freqs) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      if (stats) stats.rejected += 1;
      continue;
    }
    let freq = numeric;
    if (Number.isFinite(limit) && limit > 0 && freq > limit) {
      if (stats) stats.clamped += 1;
      freq = limit;
    }
    sanitized.push(freq);
  }
  return dedupeNumericList(sanitized, digits);
}

function pickRepresentativeValues(values: number[], limit: number): number[] {
  if (!Array.isArray(values)) return [];
  const unique = Array.from(new Set(values.map((v) => Number(v)))).filter((v) => Number.isFinite(v));
  unique.sort((a, b) => a - b);
  if (unique.length <= limit) {
    return unique.slice();
  }
  if (limit <= 0) return [];
  if (limit === 1) {
    return [unique[Math.floor(unique.length / 2)]];
  }
  const step = (unique.length - 1) / (limit - 1);
  const result: number[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.round(i * step);
    const boundedIdx = Math.min(unique.length - 1, Math.max(0, idx));
    const value = unique[boundedIdx];
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  if (result.length < limit) {
    for (const value of unique) {
      if (!result.includes(value)) {
        result.push(value);
        if (result.length >= limit) break;
      }
    }
  }
  result.sort((a, b) => a - b);
  return result.slice(0, limit);
}

function guardGammaVdB(params: {
  hull: { Lx_m: number; Ly_m: number; Lz_m: number; wallThickness_m?: number };
  gammaRequested: number;
}) {
  const halfAxes = [
    Math.max(1e-9, params.hull.Lx_m / 2),
    Math.max(1e-9, params.hull.Ly_m / 2),
    Math.max(1e-9, params.hull.Lz_m / 2),
  ];
  const minRadius = Math.min(...halfAxes);
  const wall = Math.max(
    PLANCK_LENGTH_M,
    Number.isFinite(params.hull.wallThickness_m)
      ? (params.hull.wallThickness_m as number)
      : DEFAULT_WALL_THICKNESS_M,
  );
  const pocketFloor = Math.max(
    wall * POCKET_WALL_FLOOR_FRAC,
    PLANCK_LENGTH_M * PLANCK_SAFETY_MULT,
  );
  const limitWall = minRadius / pocketFloor;
  const limitPlanck = minRadius / (PLANCK_LENGTH_M * PLANCK_SAFETY_MULT);
  const limit = Math.max(1, Math.min(limitWall, limitPlanck, 1e16));
  const gammaClamped = Math.max(0, Math.min(params.gammaRequested, limit));
  const pocketRadius_m = minRadius / Math.max(1, gammaClamped);
  const pocketThickness_m = wall / Math.max(1, gammaClamped);
  const planckMargin = pocketRadius_m / PLANCK_LENGTH_M;
  const admissible = params.gammaRequested <= limit;
  const reason = `+¦_VdB bounded by pocket floor ${pocketFloor.toExponential(
    2,
  )} m (wall=${wall.toExponential(2)} m, minRadius=${minRadius.toExponential(2)} m)`;
  return {
    gammaClamped,
    limit,
    admissible,
    greenBand: { min: 1, max: limit },
    pocketRadius_m,
    pocketThickness_m,
    planckMargin,
    requested: params.gammaRequested,
    reason,
  };
}

const computeVdbRegionII = (params: {
  gammaVdB: number;
  pocketRadius_m: number;
  pocketThickness_m: number;
  n?: number;
  samples?: number;
}): VdbRegionIIDiagnostics | null => {
  const gammaVdB = Number(params.gammaVdB);
  const r0 = Number(params.pocketRadius_m);
  const delta = Number(params.pocketThickness_m);
  if (!Number.isFinite(gammaVdB) || !Number.isFinite(r0) || !Number.isFinite(delta)) return null;
  if (r0 <= 0 || delta <= 0) return null;

  const alpha = Math.max(0, gammaVdB - 1);
  const n = Math.max(3, Math.round(Number.isFinite(params.n) ? (params.n as number) : VDB_PROFILE_N));
  const samples = Math.max(4, Math.floor(Number.isFinite(params.samples) ? (params.samples as number) : VDB_REGION_SAMPLES));

  let bMin = Number.POSITIVE_INFINITY;
  let bMax = Number.NEGATIVE_INFINITY;
  let bPrimeMin = Number.POSITIVE_INFINITY;
  let bPrimeMax = Number.NEGATIVE_INFINITY;
  let bDoubleMin = Number.POSITIVE_INFINITY;
  let bDoubleMax = Number.NEGATIVE_INFINITY;
  let t00Min = Number.POSITIVE_INFINITY;
  let t00Max = Number.NEGATIVE_INFINITY;
  let bPrimeSumSq = 0;
  let bDoubleSumSq = 0;
  let t00Sum = 0;
  let t00SumSq = 0;

  for (let i = 0; i < samples; i += 1) {
    const t = (i + 0.5) / samples;
    const w = Math.max(0, Math.min(1, 1 - t));
    const r = r0 + t * delta;
    const rSafe = Math.max(r, 1e-18);

    const wPowN = Math.pow(w, n);
    const wPowNMinus1 = Math.pow(w, n - 1);
    const wPowNMinus2 = Math.pow(w, n - 2);
    const wPowNMinus3 = Math.pow(w, n - 3);

    const B = 1 + alpha * (-(n - 1) * wPowN + n * wPowNMinus1);
    const dBdw = alpha * n * (n - 1) * wPowNMinus2 * (1 - w);
    const d2Bdw2 = alpha * n * (n - 1) * wPowNMinus3 * ((n - 2) - (n - 1) * w);
    const invDelta = 1 / delta;
    const Bprime = -dBdw * invDelta;
    const Bdouble = d2Bdw2 * invDelta * invDelta;

    const invB3 = 1 / (B * B * B);
    const invB4 = invB3 / B;
    const t00 =
      (1 / (8 * Math.PI)) *
      ((Bprime * Bprime) * invB4 - (2 * Bdouble) * invB3 - (4 * Bprime) * invB3 / rSafe);

    if (B < bMin) bMin = B;
    if (B > bMax) bMax = B;
    if (Bprime < bPrimeMin) bPrimeMin = Bprime;
    if (Bprime > bPrimeMax) bPrimeMax = Bprime;
    if (Bdouble < bDoubleMin) bDoubleMin = Bdouble;
    if (Bdouble > bDoubleMax) bDoubleMax = Bdouble;
    if (t00 < t00Min) t00Min = t00;
    if (t00 > t00Max) t00Max = t00;
    bPrimeSumSq += Bprime * Bprime;
    bDoubleSumSq += Bdouble * Bdouble;
    t00Sum += t00;
    t00SumSq += t00 * t00;
  }

  if (!Number.isFinite(bMin)) bMin = 0;
  if (!Number.isFinite(bMax)) bMax = 0;
  if (!Number.isFinite(bPrimeMin)) bPrimeMin = 0;
  if (!Number.isFinite(bPrimeMax)) bPrimeMax = 0;
  if (!Number.isFinite(bDoubleMin)) bDoubleMin = 0;
  if (!Number.isFinite(bDoubleMax)) bDoubleMax = 0;
  if (!Number.isFinite(t00Min)) t00Min = 0;
  if (!Number.isFinite(t00Max)) t00Max = 0;

  const bPrimeRms = Math.sqrt(bPrimeSumSq / samples);
  const bDoubleRms = Math.sqrt(bDoubleSumSq / samples);
  const t00Mean = t00Sum / samples;
  const t00Rms = Math.sqrt(t00SumSq / samples);
  const maxAbsBprime = Math.max(Math.abs(bPrimeMin), Math.abs(bPrimeMax));
  const maxAbsBdouble = Math.max(Math.abs(bDoubleMin), Math.abs(bDoubleMax));

  return {
    alpha,
    n,
    r_tilde_m: r0,
    delta_tilde_m: delta,
    sampleCount: samples,
    b_min: bMin,
    b_max: bMax,
    bprime_min: bPrimeMin,
    bprime_max: bPrimeMax,
    bprime_rms: bPrimeRms,
    bdouble_min: bDoubleMin,
    bdouble_max: bDoubleMax,
    bdouble_rms: bDoubleRms,
    t00_min: t00Min,
    t00_max: t00Max,
    t00_mean: t00Mean,
    t00_rms: t00Rms,
    support: maxAbsBprime > 0 || maxAbsBdouble > 0,
    note: "Region II only; outer f-wall not evaluated.",
  };
};

const hasVdbRegionIIMetricSupport = (
  diag: VdbRegionIIDiagnostics | null | undefined,
): boolean => {
  if (!diag || diag.support !== true) return false;
  const sampleCount = Number(diag.sampleCount);
  const t00Mean = Number(diag.t00_mean);
  const bprimeMaxAbs = Math.max(
    Math.abs(Number(diag.bprime_min)),
    Math.abs(Number(diag.bprime_max)),
  );
  const bdoubleMaxAbs = Math.max(
    Math.abs(Number(diag.bdouble_min)),
    Math.abs(Number(diag.bdouble_max)),
  );
  return (
    Number.isFinite(sampleCount) &&
    sampleCount > 0 &&
    Number.isFinite(t00Mean) &&
    Number.isFinite(bprimeMaxAbs) &&
    bprimeMaxAbs > VDB_BPRIME_MIN_ABS &&
    Number.isFinite(bdoubleMaxAbs) &&
    bdoubleMaxAbs > VDB_BDOUBLE_MIN_ABS
  );
};

const hasVdbRegionIVMetricSupport = (
  diag: VdbRegionIVDiagnostics | null | undefined,
): boolean => {
  if (!diag || diag.support !== true) return false;
  const sampleCount = Number(diag.sampleCount);
  const t00Mean = Number(diag.t00_mean);
  const dfdrMaxAbs = Math.abs(Number(diag.dfdr_max_abs));
  return (
    Number.isFinite(sampleCount) &&
    sampleCount > 0 &&
    Number.isFinite(t00Mean) &&
    Number.isFinite(dfdrMaxAbs) &&
    dfdrMaxAbs > VDB_DFDR_MIN_ABS
  );
};

const hasVdbRegionIIDerivatives = (
  diag: VdbRegionIIDiagnostics | null | undefined,
): boolean => {
  if (!diag) return false;
  const bprimeMaxAbs = Math.max(
    Math.abs(Number(diag.bprime_min)),
    Math.abs(Number(diag.bprime_max)),
  );
  const bdoubleMaxAbs = Math.max(
    Math.abs(Number(diag.bdouble_min)),
    Math.abs(Number(diag.bdouble_max)),
  );
  return (
    Number.isFinite(bprimeMaxAbs) &&
    bprimeMaxAbs > VDB_BPRIME_MIN_ABS &&
    Number.isFinite(bdoubleMaxAbs) &&
    bdoubleMaxAbs > VDB_BDOUBLE_MIN_ABS
  );
};

const buildVdbConformalDiagnostics = (
  diag: VdbRegionIIDiagnostics | null | undefined,
  betaAmplitude?: number,
): {
  bMin?: number;
  bMax?: number;
  bprimeMin?: number;
  bprimeMax?: number;
  bdoubleMin?: number;
  bdoubleMax?: number;
  betaAmplitude?: number;
} | undefined => {
  if (!diag) return undefined;
  return {
    bMin: Number.isFinite(diag.b_min) ? Number(diag.b_min) : undefined,
    bMax: Number.isFinite(diag.b_max) ? Number(diag.b_max) : undefined,
    bprimeMin: Number.isFinite(diag.bprime_min) ? Number(diag.bprime_min) : undefined,
    bprimeMax: Number.isFinite(diag.bprime_max) ? Number(diag.bprime_max) : undefined,
    bdoubleMin: Number.isFinite(diag.bdouble_min) ? Number(diag.bdouble_min) : undefined,
    bdoubleMax: Number.isFinite(diag.bdouble_max) ? Number(diag.bdouble_max) : undefined,
    betaAmplitude:
      Number.isFinite(betaAmplitude as number) && (betaAmplitude as number) >= 0
        ? Number(betaAmplitude)
        : undefined,
  };
};

const resolveBubbleWallParams = (state: EnergyPipelineState): { R: number; sigma: number } | null => {
  const bubble = (state as any)?.bubble ?? {};
  const explicitBubbleRadius = resolveBubbleRadiusM(state, Number.NaN);
  const rawR = Number.isFinite(explicitBubbleRadius)
    ? explicitBubbleRadius
    : Number.isFinite((state as any).radius)
      ? Number((state as any).radius)
      : Number.NaN;
  const rawSigma = Number.isFinite(bubble.sigma)
    ? Number(bubble.sigma)
    : Number.isFinite((state as any).sigma)
      ? Number((state as any).sigma)
      : Number.NaN;
  if (!Number.isFinite(rawR) || !Number.isFinite(rawSigma)) return null;
  const R = Math.max(1e-6, rawR);
  const sigma = Math.max(1e-6, rawSigma);
  return { R, sigma };
};

const buildVdbFallbackShiftField = (
  state: EnergyPipelineState,
): { amplitude: number; evaluateShiftVector: (x: number, y: number, z: number) => [number, number, number] } | undefined => {
  const bubble = resolveBubbleWallParams(state);
  if (!bubble) return undefined;

  const den = Math.max(1e-8, 2 * Math.tanh(bubble.sigma * bubble.R));
  const rawBeta = firstFinite(
    (state as any).beta_avg,
    Number((state as any)?.bubble?.beta),
    Number((state as any)?.beta),
    Number((state as any)?.dynamicConfig?.beta),
  );
  const amplitude = Math.max(0, Math.min(0.99, Math.abs(rawBeta ?? 0.15)));
  const driveDirection = normalizeVec(
    toFiniteVec3(
      (state as any)?.dynamicConfig?.warpDriveDirection ??
        (state as any)?.warpGeometry?.driveDirection ??
        [1, 0, 0],
      [1, 0, 0],
    ),
  );
  const evaluateShiftVector = (x: number, y: number, z: number): [number, number, number] => {
    const rs = Math.hypot(x, y, z);
    const f =
      (Math.tanh(bubble.sigma * (rs + bubble.R)) -
        Math.tanh(bubble.sigma * (rs - bubble.R))) /
      den;
    const beta = -amplitude * f;
    return [
      beta * driveDirection[0],
      beta * driveDirection[1],
      beta * driveDirection[2],
    ];
  };
  return { amplitude, evaluateShiftVector };
};

type SolveBackedWarpTransportSampleRole =
  | "centerline_aft"
  | "centerline_center"
  | "centerline_fore"
  | "shell_aft"
  | "shell_fore"
  | "shell_port"
  | "shell_starboard"
  | "shell_dorsal"
  | "shell_ventral";

type SolveBackedWarpTransportSample = {
  sampleId: SolveBackedWarpTransportSampleRole;
  sampleRole: SolveBackedWarpTransportSampleRole;
  sourceModel: "warp_worldline_local_comoving";
  transportProvenance: "solve_backed_shift_vector_sample";
  coordinateTime_s: 0;
  position_m: WarpWorldlineVec3;
  betaCoord: WarpWorldlineVec3;
};

type SolveBackedWarpTransportSampleFamily = {
  familyId: "nhm2_centerline_shell_cross";
  description: string;
  representativeSampleId: "centerline_center";
  ordering: SolveBackedWarpTransportSampleRole[];
  axes: {
    centerline: WarpWorldlineVec3;
    portStarboard: WarpWorldlineVec3;
    dorsalVentral: WarpWorldlineVec3;
  };
  offsets_m: {
    centerline: number;
    shellLongitudinal: number;
    shellTransverse: number;
    shellVertical: number;
    shellClearance: number;
  };
  samples: SolveBackedWarpTransportSample[];
};

const crossVec = (
  lhs: WarpWorldlineVec3,
  rhs: WarpWorldlineVec3,
): WarpWorldlineVec3 => [
  lhs[1] * rhs[2] - lhs[2] * rhs[1],
  lhs[2] * rhs[0] - lhs[0] * rhs[2],
  lhs[0] * rhs[1] - lhs[1] * rhs[0],
];

const buildSolveBackedWarpTransportSampleFamily = (args: {
  state: EnergyPipelineState;
  warpResult: Record<string, unknown>;
  adapter: WarpMetricAdapterSnapshot | undefined;
  metricT00Source: string | null;
  metricT00Ref: string | null;
}): SolveBackedWarpTransportSampleFamily | undefined => {
  const metricFamily = args.adapter?.family ?? "unknown";
  const shiftField = (args.warpResult.shiftVectorField ?? null) as
    | { evaluateShiftVector?: (x: number, y: number, z: number) => unknown }
    | null;
  const evaluateShiftVector =
    shiftField && typeof shiftField.evaluateShiftVector === "function"
      ? shiftField.evaluateShiftVector
      : null;
  if (!evaluateShiftVector) return undefined;
  if (args.metricT00Source !== "metric") return undefined;
  if (args.adapter?.chart?.label !== "comoving_cartesian") return undefined;
  if (args.adapter?.chart?.contractStatus !== "ok") return undefined;
  if (
    metricFamily !== "natario" &&
    metricFamily !== "natario_sdf" &&
    metricFamily !== "nhm2_shift_lapse"
  ) {
    return undefined;
  }
  if (args.metricT00Ref == null) {
    return undefined;
  }

  const driveDirection = normalizeVec(
    toFiniteVec3(
      (args.state.dynamicConfig as any)?.warpDriveDirection ??
        (args.state as any)?.warpGeometry?.driveDirection ??
        args.state.driveDir ??
        [1, 0, 0],
      [1, 0, 0],
    ),
  );
  if (!driveDirection.every((value) => Number.isFinite(value)) || !Math.hypot(...driveDirection)) {
    return undefined;
  }
  const transverseReference =
    Math.abs(driveDirection[2]) < 0.95
      ? ([0, 0, 1] as WarpWorldlineVec3)
      : ([0, 1, 0] as WarpWorldlineVec3);
  const portStarboardAxis = normalizeVec(crossVec(transverseReference, driveDirection));
  const dorsalVentralAxis = normalizeVec(crossVec(driveDirection, portStarboardAxis));

  const hull = resolveHullGeometry(args.state);
  const shellClearance_m = Math.max(1e-6, hull.wallThickness_m * 2);
  const resolveShellOffset = (halfExtent: number) =>
    Math.max(1e-6, Math.max(halfExtent * 0.75, halfExtent - shellClearance_m));
  const centerlineOffset_m = Math.max(1e-6, hull.Lx_m / 4);
  const shellLongitudinalOffset_m = resolveShellOffset(hull.Lx_m / 2);
  const shellTransverseOffset_m = resolveShellOffset(hull.Ly_m / 2);
  const shellVerticalOffset_m = resolveShellOffset(hull.Lz_m / 2);
  const sampleDefs: Array<{
    sampleId: SolveBackedWarpTransportSample["sampleId"];
    sampleRole: SolveBackedWarpTransportSample["sampleRole"];
    position_m: WarpWorldlineVec3;
  }> = [
    {
      sampleId: "centerline_aft",
      sampleRole: "centerline_aft",
      position_m: [
        -driveDirection[0] * centerlineOffset_m,
        -driveDirection[1] * centerlineOffset_m,
        -driveDirection[2] * centerlineOffset_m,
      ],
    },
    {
      sampleId: "centerline_center",
      sampleRole: "centerline_center",
      position_m: [0, 0, 0],
    },
    {
      sampleId: "centerline_fore",
      sampleRole: "centerline_fore",
      position_m: [
        driveDirection[0] * centerlineOffset_m,
        driveDirection[1] * centerlineOffset_m,
        driveDirection[2] * centerlineOffset_m,
      ],
    },
    {
      sampleId: "shell_aft",
      sampleRole: "shell_aft",
      position_m: [
        -driveDirection[0] * shellLongitudinalOffset_m,
        -driveDirection[1] * shellLongitudinalOffset_m,
        -driveDirection[2] * shellLongitudinalOffset_m,
      ],
    },
    {
      sampleId: "shell_fore",
      sampleRole: "shell_fore",
      position_m: [
        driveDirection[0] * shellLongitudinalOffset_m,
        driveDirection[1] * shellLongitudinalOffset_m,
        driveDirection[2] * shellLongitudinalOffset_m,
      ],
    },
    {
      sampleId: "shell_port",
      sampleRole: "shell_port",
      position_m: [
        portStarboardAxis[0] * shellTransverseOffset_m,
        portStarboardAxis[1] * shellTransverseOffset_m,
        portStarboardAxis[2] * shellTransverseOffset_m,
      ],
    },
    {
      sampleId: "shell_starboard",
      sampleRole: "shell_starboard",
      position_m: [
        -portStarboardAxis[0] * shellTransverseOffset_m,
        -portStarboardAxis[1] * shellTransverseOffset_m,
        -portStarboardAxis[2] * shellTransverseOffset_m,
      ],
    },
    {
      sampleId: "shell_dorsal",
      sampleRole: "shell_dorsal",
      position_m: [
        dorsalVentralAxis[0] * shellVerticalOffset_m,
        dorsalVentralAxis[1] * shellVerticalOffset_m,
        dorsalVentralAxis[2] * shellVerticalOffset_m,
      ],
    },
    {
      sampleId: "shell_ventral",
      sampleRole: "shell_ventral",
      position_m: [
        -dorsalVentralAxis[0] * shellVerticalOffset_m,
        -dorsalVentralAxis[1] * shellVerticalOffset_m,
        -dorsalVentralAxis[2] * shellVerticalOffset_m,
      ],
    },
  ];

  const samples = sampleDefs.map((entry) => {
    const betaCoord = toWarpWorldlineVec3(
      evaluateShiftVector(entry.position_m[0], entry.position_m[1], entry.position_m[2]),
    );
    if (!betaCoord) return null;
    return {
      sampleId: entry.sampleId,
      sampleRole: entry.sampleRole,
      sourceModel: "warp_worldline_local_comoving" as const,
      transportProvenance: "solve_backed_shift_vector_sample" as const,
      coordinateTime_s: 0 as const,
      position_m: entry.position_m,
      betaCoord,
    };
  });
  if (samples.some((entry) => entry == null)) return undefined;

  return {
    familyId: "nhm2_centerline_shell_cross",
    description:
      "Deterministic bounded local-comoving shell-cross family: centerline aft-center-fore plus shell-proximal aft/fore/port/starboard/dorsal/ventral probes. Samples are evaluated directly from the solve-backed shift-vector field and remain bounded to local transport inspection only.",
    representativeSampleId: "centerline_center",
    ordering: sampleDefs.map((entry) => entry.sampleRole),
    axes: {
      centerline: [...driveDirection] as WarpWorldlineVec3,
      portStarboard: [...portStarboardAxis] as WarpWorldlineVec3,
      dorsalVentral: [...dorsalVentralAxis] as WarpWorldlineVec3,
    },
    offsets_m: {
      centerline: centerlineOffset_m,
      shellLongitudinal: shellLongitudinalOffset_m,
      shellTransverse: shellTransverseOffset_m,
      shellVertical: shellVerticalOffset_m,
      shellClearance: shellClearance_m,
    },
    samples: samples as SolveBackedWarpTransportSample[],
  };
};

const buildShiftLapseTransportPromotionGateFromState = (
  state: EnergyPipelineState,
): WarpShiftLapseTransportPromotionGate | null => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  const adapter = warpState?.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  const metricContract = warpState?.metricT00Contract as MetricT00Contract | undefined;
  const metricT00Ref =
    typeof warpState?.metricT00Ref === "string" && warpState.metricT00Ref.length > 0
      ? String(warpState.metricT00Ref)
      : resolveCanonicalMetricT00Ref(warpState ?? {}, adapter) ?? null;
  const metricFamily =
    metricContract?.family ??
    adapter?.family ??
    (metricT00Ref ? resolveMetricFamilyFromRef(metricT00Ref, adapter) : "unknown");
  const shiftLapseSelected =
    metricFamily === "nhm2_shift_lapse" ||
    metricT00Ref?.includes("shift_lapse") === true ||
    (state as any)?.warpFieldType === "nhm2_shift_lapse" ||
    (state.dynamicConfig as any)?.warpFieldType === "nhm2_shift_lapse";
  if (!shiftLapseSelected) return null;

  const familySemantics = deriveWarpMetricFamilySemantics("nhm2_shift_lapse");
  const familyAuthorityStatus =
    metricContract?.familyAuthorityStatus ??
    adapter?.familyAuthorityStatus ??
    familySemantics.familyAuthorityStatus;
  const familyTransportCertificationStatus =
    metricContract?.transportCertificationStatus ??
    adapter?.transportCertificationStatus ??
    familySemantics.transportCertificationStatus;

  const gr = state.gr;
  const brickStatus =
    typeof (gr as any)?.meta?.status === "string" ? String((gr as any).meta.status) : null;
  const brickSolverStatus =
    typeof gr?.solver?.health?.status === "string" ? String(gr.solver.health.status) : null;
  const divergenceRms = toFiniteNumber(gr?.divBeta?.rms);
  const divergenceMaxAbs = toFiniteNumber(gr?.divBeta?.maxAbs);
  const divergenceSource =
    typeof gr?.divBeta?.source === "string" ? String(gr.divBeta.source) : null;
  const thetaMean = toFiniteNumber(gr?.theta?.mean);
  const kTraceMean = toFiniteNumber(gr?.kTrace?.mean);
  const thetaKResidualAbs =
    thetaMean != null && kTraceMean != null ? Math.abs(thetaMean + kTraceMean) : null;
  const thetaKConsistencyStatus: WarpShiftLapseTransportPromotionGate["thetaKConsistencyStatus"] =
    thetaKResidualAbs == null
      ? "unknown"
      : thetaKResidualAbs <= THETA_K_TOLERANCE
        ? "pass"
        : "fail";
  const authoritativeLowExpansionStatus:
    WarpShiftLapseTransportPromotionGate["authoritativeLowExpansionStatus"] =
    gr == null
      ? "missing"
      : brickStatus !== "CERTIFIED" || brickSolverStatus !== "CERTIFIED"
        ? "fail"
        : divergenceRms == null || divergenceSource == null
          ? "missing"
          : thetaKConsistencyStatus === "unknown"
            ? "missing"
            : divergenceRms <= NATARIO_EXPANSION_TOLERANCE &&
                thetaKConsistencyStatus === "pass"
              ? "pass"
              : "fail";
  const authoritativeLowExpansionReason =
    gr == null
      ? "authoritative_gr_diagnostics_missing"
      : brickStatus !== "CERTIFIED"
        ? "gr_brick_not_certified"
        : brickSolverStatus !== "CERTIFIED"
          ? "gr_brick_solver_not_certified"
          : divergenceRms == null || divergenceSource == null
            ? "brick_native_div_beta_missing"
            : thetaKConsistencyStatus === "unknown"
              ? "brick_native_theta_k_missing"
              : divergenceRms > NATARIO_EXPANSION_TOLERANCE
                ? "brick_native_divergence_constraint_failed"
                : thetaKConsistencyStatus === "fail"
                  ? "theta_k_consistency_failed"
                  : "authoritative_low_expansion_ok";

  const betaOverAlphaMax = toFiniteNumber(gr?.gauge?.betaOverAlphaMax);
  const betaOutwardOverAlphaWallMax = toFiniteNumber(
    gr?.gauge?.betaOutwardOverAlphaWallMax,
  );
  const wallHorizonMargin = toFiniteNumber(gr?.gauge?.wallHorizonMargin);
  const wallSafetyStatus: WarpShiftLapseTransportPromotionGate["wallSafetyStatus"] =
    gr == null
      ? "missing"
      : betaOverAlphaMax == null ||
          betaOutwardOverAlphaWallMax == null ||
          wallHorizonMargin == null
        ? "missing"
        : Math.max(betaOverAlphaMax, betaOutwardOverAlphaWallMax) < 1 &&
            wallHorizonMargin > 0
          ? "pass"
          : "fail";
  const wallSafetyReason =
    gr == null
      ? "authoritative_wall_safety_missing"
      : betaOverAlphaMax == null
        ? "beta_over_alpha_max_missing"
        : betaOutwardOverAlphaWallMax == null
          ? "beta_outward_over_alpha_wall_max_missing"
          : wallHorizonMargin == null
            ? "wall_horizon_margin_missing"
            : Math.max(betaOverAlphaMax, betaOutwardOverAlphaWallMax) >= 1
              ? "wall_beta_over_alpha_threshold_failed"
              : wallHorizonMargin <= 0
                ? "wall_horizon_margin_nonpositive"
                : "wall_safety_guardrail_ok";

  const centerlineAlpha =
    toFiniteNumber(warpState?.lapseSummary?.alphaCenterline) ??
    toFiniteNumber(adapter?.lapseSummary?.alphaCenterline) ??
    (metricFamily === "nhm2_shift_lapse" ? toFiniteNumber(adapter?.alpha) : null);
  const shiftLapseProfile =
    metricFamily === "nhm2_shift_lapse"
      ? resolveWarpShiftLapseProfile(
          typeof warpState?.lapseSummary?.shiftLapseProfileId === "string"
            ? warpState.lapseSummary.shiftLapseProfileId
            : typeof adapter?.lapseSummary?.shiftLapseProfileId === "string"
              ? adapter.lapseSummary.shiftLapseProfileId
              : typeof (state.dynamicConfig as any)?.shiftLapseProfileId === "string"
                ? String((state.dynamicConfig as any).shiftLapseProfileId)
                : DEFAULT_WARP_SHIFT_LAPSE_PROFILE_ID,
        )
      : null;
  const centerlineDtauDt = centerlineAlpha;
  const timingStatus: WarpShiftLapseTransportPromotionGate["timingStatus"] =
    centerlineAlpha != null ? "available" : "missing";
  const timingReason =
    centerlineAlpha != null
      ? "centerline_lapse_timing_available"
      : "centerline_lapse_timing_missing";

  const status: WarpShiftLapseTransportPromotionGate["status"] =
    familyAuthorityStatus !== "candidate_authoritative_solve_family"
      ? "fail"
      : authoritativeLowExpansionStatus !== "pass"
        ? authoritativeLowExpansionStatus
        : wallSafetyStatus !== "pass"
          ? wallSafetyStatus
          : "pass";
  const reason =
    familyAuthorityStatus !== "candidate_authoritative_solve_family"
      ? "family_not_candidate_authoritative"
      : authoritativeLowExpansionStatus !== "pass"
        ? authoritativeLowExpansionReason
        : wallSafetyStatus !== "pass"
          ? wallSafetyReason
          : "shift_lapse_transport_promotion_gate_pass";

  return {
    gateId: SHIFT_LAPSE_TRANSPORT_PROMOTION_GATE_ID,
    status,
    reason,
    shiftLapseProfileId: shiftLapseProfile?.profileId ?? null,
    shiftLapseProfileStage: shiftLapseProfile?.profileStage ?? null,
    shiftLapseProfileLabel: shiftLapseProfile?.profileLabel ?? null,
    shiftLapseProfileNote: shiftLapseProfile?.profileNote ?? null,
    familyAuthorityStatus,
    familyTransportCertificationStatus,
    transportCertificationStatus:
      status === "pass"
        ? SHIFT_LAPSE_TRANSPORT_PROMOTED_STATUS
        : familyTransportCertificationStatus,
    authoritativeLowExpansionStatus,
    authoritativeLowExpansionReason,
    authoritativeLowExpansionSource: divergenceSource,
    authoritativeLowExpansionObservable: "brick_native_div_beta",
    divergenceRms,
    divergenceMaxAbs,
    divergenceTolerance: NATARIO_EXPANSION_TOLERANCE,
    thetaKConsistencyStatus,
    thetaKResidualAbs,
    thetaKTolerance: THETA_K_TOLERANCE,
    wallSafetyStatus,
    wallSafetyReason,
    betaOverAlphaMax,
    betaOutwardOverAlphaWallMax,
    wallHorizonMargin,
    timingStatus,
    timingReason,
    centerlineAlpha,
    centerlineDtauDt,
  };
};

const refreshShiftLapseTransportPromotionGate = (
  state: EnergyPipelineState,
): void => {
  const gate = buildShiftLapseTransportPromotionGateFromState(state);
  if (gate) {
    state.shiftLapseTransportPromotionGate = gate;
    ((state as any).warp ??= {}).shiftLapseTransportPromotionGate = gate;
    return;
  }
  delete (state as any).shiftLapseTransportPromotionGate;
  if ((state as any).warp) {
    delete (state as any).warp.shiftLapseTransportPromotionGate;
  }
};

const resolveWarpTransportSurfaceSemantics = (args: {
  state: EnergyPipelineState;
  metricFamily: string;
  metricT00Ref: string | null;
  metricContract: MetricT00Contract | undefined;
  adapter: WarpMetricAdapterSnapshot | undefined;
}): {
  shiftLapseSelected: boolean;
  familyAuthorityStatus: WarpMetricFamilyAuthorityStatus;
  familyTransportCertificationStatus: WarpMetricTransportCertificationStatus;
  transportCertificationStatus: WarpTransportCertificationStatus;
  shiftLapseTransportPromotionGate: WarpShiftLapseTransportPromotionGate | null;
  shiftLapseTransportGatePassed: boolean;
  shiftLapseTransportGateReason: string | null;
} => {
  const shiftLapseSelected =
    args.metricFamily === "nhm2_shift_lapse" ||
    args.metricT00Ref?.includes("shift_lapse") === true;
  const fallbackFamily =
    args.metricFamily === "natario" ||
    args.metricFamily === "natario_sdf" ||
    args.metricFamily === "nhm2_shift_lapse" ||
    args.metricFamily === "alcubierre" ||
    args.metricFamily === "vdb"
      ? args.metricFamily
      : shiftLapseSelected
        ? "nhm2_shift_lapse"
        : "natario";
  const familySemantics = deriveWarpMetricFamilySemantics(fallbackFamily);
  const familyAuthorityStatus =
    args.metricContract?.familyAuthorityStatus ??
    args.adapter?.familyAuthorityStatus ??
    familySemantics.familyAuthorityStatus;
  const familyTransportCertificationStatus =
    args.metricContract?.transportCertificationStatus ??
    args.adapter?.transportCertificationStatus ??
    familySemantics.transportCertificationStatus;
  const shiftLapseTransportPromotionGate = shiftLapseSelected
    ? args.state.shiftLapseTransportPromotionGate ??
      buildShiftLapseTransportPromotionGateFromState(args.state)
    : null;
  const shiftLapseTransportGatePassed =
    shiftLapseTransportPromotionGate?.status === "pass";
  return {
    shiftLapseSelected,
    familyAuthorityStatus,
    familyTransportCertificationStatus,
    transportCertificationStatus:
      shiftLapseTransportGatePassed && shiftLapseTransportPromotionGate
        ? shiftLapseTransportPromotionGate.transportCertificationStatus
        : familyTransportCertificationStatus,
    shiftLapseTransportPromotionGate,
    shiftLapseTransportGatePassed,
    shiftLapseTransportGateReason: shiftLapseSelected
      ? shiftLapseTransportPromotionGate?.reason ??
        "shift_lapse_transport_promotion_gate_missing"
      : null,
  };
};

export const buildWarpWorldlineContractFromState = (
  state: EnergyPipelineState,
): WarpWorldlineContractV1 | null => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  const adapter = warpState?.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  const metricContract = warpState?.metricT00Contract as MetricT00Contract | undefined;
  const metricT00Source =
    typeof warpState?.metricT00Source === "string"
      ? String(warpState.metricT00Source)
      : typeof warpState?.stressEnergySource === "string"
        ? String(warpState.stressEnergySource)
        : null;
  const metricT00Ref =
    typeof warpState?.metricT00Ref === "string" && warpState.metricT00Ref.length > 0
      ? String(warpState.metricT00Ref)
      : resolveCanonicalMetricT00Ref(warpState ?? {}, adapter) ?? null;
  const chartLabel = adapter?.chart?.label ?? null;
  const chartContractStatus = adapter?.chart?.contractStatus ?? null;
  const alpha = toFiniteNumber(adapter?.alpha);
  const gammaDiag = toFiniteVec3(adapter?.gammaDiag, [Number.NaN, Number.NaN, Number.NaN]);
  const gammaDiagFinite = gammaDiag.every((value) => Number.isFinite(value));
  const metricFamily = metricContract?.family ?? adapter?.family ?? "unknown";
  const transportSurfaceSemantics = resolveWarpTransportSurfaceSemantics({
    state,
    metricFamily,
    metricT00Ref,
    metricContract,
    adapter,
  });
  const transportSampleFamily = warpState?.solveBackedTransportSampleFamily as
    | SolveBackedWarpTransportSampleFamily
    | undefined;

  if (metricT00Source !== "metric") return null;
  if (metricContract?.status !== "ok") return null;
  if (chartContractStatus !== "ok") return null;
  if (chartLabel !== "comoving_cartesian") return null;
  if (metricContract?.observer !== "eulerian_n") return null;
  if (metricContract?.normalization !== "si_stress") return null;
  if (metricContract?.unitSystem !== "SI") return null;
  if (
    metricFamily !== "natario" &&
    metricFamily !== "natario_sdf" &&
    metricFamily !== "nhm2_shift_lapse"
  ) {
    return null;
  }
  if (metricT00Ref == null) return null;
  if (
    transportSurfaceSemantics.shiftLapseSelected &&
    !transportSurfaceSemantics.shiftLapseTransportGatePassed
  ) {
    return null;
  }
  if (alpha == null || !gammaDiagFinite || !transportSampleFamily) return null;
  if (transportSampleFamily.familyId !== "nhm2_centerline_shell_cross") return null;
  if (transportSampleFamily.representativeSampleId !== "centerline_center") return null;
  if (
    transportSampleFamily.ordering.join(",") !==
    "centerline_aft,centerline_center,centerline_fore,shell_aft,shell_fore,shell_port,shell_starboard,shell_dorsal,shell_ventral"
  ) {
    return null;
  }
  const centerlineAxis = toWarpWorldlineVec3(transportSampleFamily.axes.centerline);
  const portStarboardAxis = toWarpWorldlineVec3(transportSampleFamily.axes.portStarboard);
  const dorsalVentralAxis = toWarpWorldlineVec3(transportSampleFamily.axes.dorsalVentral);
  if (!centerlineAxis || !portStarboardAxis || !dorsalVentralAxis) return null;
  const centerlineOffset_m = toFiniteNumber(transportSampleFamily.offsets_m.centerline);
  const shellLongitudinalOffset_m = toFiniteNumber(
    transportSampleFamily.offsets_m.shellLongitudinal,
  );
  const shellTransverseOffset_m = toFiniteNumber(
    transportSampleFamily.offsets_m.shellTransverse,
  );
  const shellVerticalOffset_m = toFiniteNumber(transportSampleFamily.offsets_m.shellVertical);
  const shellClearance_m = toFiniteNumber(transportSampleFamily.offsets_m.shellClearance);
  if (
    centerlineOffset_m == null ||
    shellLongitudinalOffset_m == null ||
    shellTransverseOffset_m == null ||
    shellVerticalOffset_m == null ||
    shellClearance_m == null ||
    !(centerlineOffset_m > 0) ||
    !(shellLongitudinalOffset_m > 0) ||
    !(shellTransverseOffset_m > 0) ||
    !(shellVerticalOffset_m > 0) ||
    !(shellClearance_m > 0)
  ) {
    return null;
  }

  const coordinateVelocity: WarpWorldlineVec3 = [0, 0, 0];
  const samples = transportSampleFamily.samples.map((entry) => {
    if (entry.sourceModel !== "warp_worldline_local_comoving") return null;
    if (entry.transportProvenance !== "solve_backed_shift_vector_sample") return null;
    const position_m = toWarpWorldlineVec3(entry.position_m);
    const betaCoord = toWarpWorldlineVec3(entry.betaCoord);
    if (!position_m || !betaCoord) return null;
    const dtauDt = computeWarpWorldlineDtauDt({
      alpha,
      gammaDiag,
      coordinateVelocity,
      betaCoord,
    });
    if (dtauDt == null || !(dtauDt > 0)) return null;
    const normalizationResidual = computeWarpWorldlineNormalizationResidual({
      alpha,
      gammaDiag,
      coordinateVelocity,
      betaCoord,
      dtau_dt: dtauDt,
    });
    if (!(Math.abs(normalizationResidual) <= WARP_WORLDLINE_NORMALIZATION_TOLERANCE)) {
      return null;
    }
    const effectiveTransportVelocityCoord: WarpWorldlineVec3 = [...betaCoord];
    return {
      sampleId: entry.sampleId,
      sampleRole: entry.sampleRole,
      sourceModel: entry.sourceModel,
      transportProvenance: entry.transportProvenance,
      coordinateTime_s: entry.coordinateTime_s,
      position_m,
      coordinateVelocity,
      coordinateVelocityUnits: "m/s" as const,
      betaCoord,
      effectiveTransportVelocityCoord,
      dtau_dt: dtauDt,
      normalizationResidual,
    };
  });
  if (samples.some((entry) => entry == null)) return null;

  const typedSamples = samples as NonNullable<(typeof samples)[number]>[];
  const representativeSample =
    typedSamples.find((entry) => entry.sampleId === transportSampleFamily.representativeSampleId) ??
    null;
  if (!representativeSample) {
    return null;
  }
  const dtauDtValues = typedSamples.map((entry) => entry.dtau_dt);
  const normalizationResiduals = typedSamples.map((entry) => Math.abs(entry.normalizationResidual));
  const maxAbsResidual = Math.max(...normalizationResiduals);
  const variationAnalysis = analyzeWarpWorldlineTransportVariation(typedSamples);
  if (!variationAnalysis) return null;

  return {
    contractVersion: WARP_WORLDLINE_CONTRACT_VERSION,
    status: "bounded_solve_backed",
    certified: true,
    sourceSurface: {
      surfaceId: "nhm2_metric_local_comoving_transport_cross",
      producer: "server/energy-pipeline.ts",
      provenanceClass: "solve_backed",
      transportVectorSource: "warp.solveBackedTransportSampleFamily",
      transportVectorField: "shiftVectorField.evaluateShiftVector",
      metricT00Ref,
      metricT00Source: "metric",
      metricFamily,
      familyAuthorityStatus: transportSurfaceSemantics.familyAuthorityStatus,
      transportCertificationStatus:
        transportSurfaceSemantics.transportCertificationStatus,
      metricT00ContractStatus: "ok",
      chartContractStatus: "ok",
      ...(transportSurfaceSemantics.shiftLapseTransportPromotionGate?.shiftLapseProfileId
        ? {
            shiftLapseProfileId:
              transportSurfaceSemantics.shiftLapseTransportPromotionGate
                .shiftLapseProfileId,
          }
        : {}),
      shiftLapseTransportPromotionGate:
        transportSurfaceSemantics.shiftLapseTransportPromotionGate,
    },
    chart: {
      label: chartLabel,
      coordinateMap:
        typeof adapter?.chart?.coordinateMap === "string"
          ? String(adapter.chart.coordinateMap)
          : null,
      chartFixed: true,
    },
    observerFamily: "ship_centerline_local_comoving",
    validityRegime: {
      regimeId: "nhm2_local_comoving_shell_cross",
      bounded: true,
      chartFixed: true,
      observerDefined: true,
      failClosedOutsideRegime: true,
      routeTimeCertified: false,
      description:
        "Bounded centerline-plus-shell-cross NHM2 local-comoving sample family in the comoving Cartesian chart. This contract supports local transport differentiation only and keeps route-time accumulation deferred.",
      allowedSourceModels: ["warp_worldline_local_comoving"],
      deferredSourceModels: ["warp_worldline_route_time"],
      restrictions: [
        "deterministic_centerline_shell_cross_family_only",
        "coordinate_velocity_fixed_to_zero_in_comoving_chart",
        "effective_transport_velocity_is_local_shift_descriptor_not_certified_speed",
        "route_time_and_mission_time_products_deferred",
        "outside_declared_chart_or_observer_regime_fail_closed",
      ],
    },
    sampleGeometry: {
      familyId: "nhm2_centerline_shell_cross",
      description: transportSampleFamily.description,
      coordinateFrame: "comoving_cartesian",
      originDefinition: "ship_center",
      ordering: [...transportSampleFamily.ordering],
      representativeSampleId: "centerline_center",
      axes: {
        centerline: centerlineAxis,
        portStarboard: portStarboardAxis,
        dorsalVentral: dorsalVentralAxis,
      },
      offsets_m: {
        centerline: centerlineOffset_m,
        shellLongitudinal: shellLongitudinalOffset_m,
        shellTransverse: shellTransverseOffset_m,
        shellVertical: shellVerticalOffset_m,
        shellClearance: shellClearance_m,
      },
    },
    sampleCount: typedSamples.length,
    representativeSampleId: "centerline_center",
    transportInterpretation: {
      coordinateVelocityFrame: "chart_fixed_comoving",
      coordinateVelocityInterpretation: "zero_by_chart_choice",
      transportTerm: "solve_backed_shift_term",
      effectiveTransportInterpretation:
        "bounded_local_comoving_descriptor_not_speed",
      certifiedSpeedMeaning: false,
      note:
        "The comoving coordinate velocity is fixed to zero by chart choice. Effective transport is represented here only as a solve-backed bounded local shift descriptor. Even when shell-cross variation is present, it is not a certified speed, cruise envelope, or route-time answer.",
    },
    transportVariation: variationAnalysis.transportVariation,
    transportInformativenessStatus: variationAnalysis.transportInformativenessStatus,
    sampleFamilyAdequacy: variationAnalysis.sampleFamilyAdequacy,
    flatnessInterpretation: variationAnalysis.flatnessInterpretation,
    certifiedTransportMeaning: variationAnalysis.certifiedTransportMeaning,
    eligibleNextProducts: variationAnalysis.eligibleNextProducts,
    nextRequiredUpgrade: variationAnalysis.nextRequiredUpgrade,
    samples: typedSamples,
    timeCoordinateName: "t",
    positionCoordinates: ["x", "y", "z"],
    coordinateVelocity,
    coordinateVelocityUnits: "m/s",
    effectiveTransportVelocityCoord: [
      ...representativeSample.effectiveTransportVelocityCoord,
    ],
    dtau_dt: {
      representative: representativeSample.dtau_dt,
      min: Math.min(...dtauDtValues),
      max: Math.max(...dtauDtValues),
      units: "dimensionless",
      positivityRequired: true,
    },
    normalizationResidual: {
      representative: representativeSample.normalizationResidual,
      maxAbs: maxAbsResidual,
      tolerance: WARP_WORLDLINE_NORMALIZATION_TOLERANCE,
      relation: "alpha^2 - gamma_ij(v^i+beta^i)(v^j+beta^j) - (d tau / dt)^2",
    },
    claimBoundary: [
      "bounded solve-backed transport contract only",
      "local-comoving shell-cross sample family only",
      "not route-time certified",
      "not mission-time certified",
      "not max-speed certified",
      "not viability-promotion evidence",
    ],
    falsifierConditions: [
      "metric_t00_source_not_metric",
      "metric_contract_status_not_ok",
      "chart_contract_status_not_ok",
      "chart_not_comoving_cartesian",
      "solve_backed_transport_sample_family_missing",
      "transport_sample_family_not_shell_cross",
      "shift_lapse_transport_promotion_gate_not_pass",
      "dtau_dt_nonpositive",
      "normalization_residual_exceeds_tolerance",
    ],
  };
};

const refreshWarpWorldlineContract = (state: EnergyPipelineState): void => {
  const contract = buildWarpWorldlineContractFromState(state);
  if (contract) {
    state.warpWorldline = contract;
    return;
  }
  delete (state as any).warpWorldline;
};

const refreshWarpCruiseEnvelopePreflight = (state: EnergyPipelineState): void => {
  const contract = buildWarpCruiseEnvelopePreflightContractFromWorldline(
    (state as any).warpWorldline ?? null,
  );
  if (contract) {
    state.warpCruiseEnvelopePreflight = contract;
    return;
  }
  delete (state as any).warpCruiseEnvelopePreflight;
};

const refreshWarpRouteTimeWorldline = (state: EnergyPipelineState): void => {
  const contract = buildWarpRouteTimeWorldlineContract({
    worldline: (state as any).warpWorldline ?? null,
    preflight: (state as any).warpCruiseEnvelopePreflight ?? null,
  });
  if (contract) {
    state.warpRouteTimeWorldline = contract;
    return;
  }
  delete (state as any).warpRouteTimeWorldline;
};

const COMMITTED_LOCAL_REST_DIR = path.resolve(process.cwd(), "server/_generated");

const toRepoRelativePath = (filePath: string): string =>
  path.relative(process.cwd(), filePath).split(path.sep).join("/");

export const resolveCommittedLocalRestMissionTargetDistanceContract = (
  targetId: WarpMissionEstimatorTargetId = DEFAULT_WARP_MISSION_ESTIMATOR_TARGET_ID,
): WarpMissionTargetDistanceContractV1 | null => {
  if (!fs.existsSync(COMMITTED_LOCAL_REST_DIR)) return null;
  const candidateNames = fs
    .readdirSync(COMMITTED_LOCAL_REST_DIR)
    .filter((name) => name.startsWith("local-rest_epoch-") && name.endsWith(".json"));
  if (candidateNames.length === 0) return null;

  let selected:
    | {
        absolutePath: string;
        snapshot: Record<string, unknown>;
        epochMs: number;
        fileName: string;
      }
    | null = null;
  for (const fileName of candidateNames) {
    const absolutePath = path.join(COMMITTED_LOCAL_REST_DIR, fileName);
    try {
      const snapshot = JSON.parse(
        fs.readFileSync(absolutePath, "utf8"),
      ) as Record<string, unknown>;
      const epochMs = Number(snapshot.epochMs);
      if (!Number.isFinite(epochMs) || epochMs <= 0) continue;
      if (
        !selected ||
        epochMs > selected.epochMs ||
        (epochMs === selected.epochMs && fileName > selected.fileName)
      ) {
        selected = { absolutePath, snapshot, epochMs, fileName };
      }
    } catch {
      continue;
    }
  }
  if (!selected) return null;

  const stars = Array.isArray(selected.snapshot.stars)
    ? (selected.snapshot.stars as Record<string, unknown>[])
    : null;
  if (!stars) return null;
  const star = stars.find((entry) => entry.id === targetId) ?? null;
  if (!star) return null;

  const ids =
    star.ids && typeof star.ids === "object"
      ? (star.ids as Record<string, unknown>)
      : null;
  const vectors =
    star.vectors && typeof star.vectors === "object"
      ? (star.vectors as Record<string, unknown>)
      : null;
  const heliocentric =
    vectors?.heliocentric && typeof vectors.heliocentric === "object"
      ? (vectors.heliocentric as Record<string, unknown>)
      : null;
  const nav =
    star.nav && typeof star.nav === "object"
      ? (star.nav as Record<string, unknown>)
      : null;
  if (!heliocentric || heliocentric.unit !== "m") return null;
  if (nav?.frame !== "heliocentric-icrs") return null;

  const x = Number(heliocentric.x);
  const y = Number(heliocentric.y);
  const z = Number(heliocentric.z);
  const distanceParsecs = Number(star.distancePc);
  const targetEpochMs = Number(star.epochMs);
  const sourceCatalogRadiusPc = Number(selected.snapshot.radiusPc);
  const sourceCatalogTotal = Number(selected.snapshot.total ?? stars.length);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !(distanceParsecs > 0) ||
    !(targetEpochMs > 0) ||
    !(sourceCatalogRadiusPc > 0) ||
    !(sourceCatalogTotal > 0)
  ) {
    return null;
  }

  const distanceMeters = Math.hypot(x, y, z);
  if (!(distanceMeters > 0)) return null;
  const derivedParsecs = distanceMeters / METERS_PER_PARSEC;
  if (Math.abs(derivedParsecs - distanceParsecs) > 1e-6 * distanceParsecs) {
    return null;
  }

  return {
    contractVersion: "local_rest_target_distance_contract/v1",
    status: "catalog_distance_resolved",
    certified: true,
    catalogFamily: "committed_local_rest_epoch_snapshot",
    catalogSelectionRule: "max_epochMs_then_lexicographic_filename",
    snapshotPath: toRepoRelativePath(selected.absolutePath),
    snapshotEpochMs: selected.epochMs,
    targetId,
    targetName:
      typeof ids?.name === "string" && ids.name.length > 0
        ? ids.name
        : targetId,
    targetFrame: "heliocentric-icrs",
    targetEpochMs,
    distanceMeters,
    distanceParsecs,
    distanceLightYears: distanceParsecs * LIGHT_YEARS_PER_PARSEC,
    sourceVectorNormMeters: distanceMeters,
    sourceCatalogRadiusPc,
    sourceCatalogTotal,
    claimBoundary: [
      "committed local-rest target distance only",
      "distance provenance fixed to the selected committed epoch snapshot",
      "not a mission-time estimate by itself",
    ],
    falsifierConditions: [
      "committed_local_rest_snapshot_missing",
      "target_missing_from_selected_snapshot",
      "target_frame_not_heliocentric_icrs",
      "target_distance_inconsistent_with_catalog_vector",
    ],
  };
};

const refreshWarpMissionTimeEstimator = (state: EnergyPipelineState): void => {
  const targetDistance = resolveCommittedLocalRestMissionTargetDistanceContract();
  const contract = buildWarpMissionTimeEstimatorContract({
    worldline: (state as any).warpWorldline ?? null,
    preflight: (state as any).warpCruiseEnvelopePreflight ?? null,
    routeTimeWorldline: (state as any).warpRouteTimeWorldline ?? null,
    targetDistance,
  });
  if (contract) {
    state.warpMissionTimeEstimator = contract;
    return;
  }
  delete (state as any).warpMissionTimeEstimator;
};

const refreshWarpMissionTimeComparison = (state: EnergyPipelineState): void => {
  const contract = buildWarpMissionTimeComparisonContract({
    missionTimeEstimator: (state as any).warpMissionTimeEstimator ?? null,
  });
  if (contract) {
    state.warpMissionTimeComparison = contract;
    return;
  }
  delete (state as any).warpMissionTimeComparison;
};

const refreshWarpCruiseEnvelope = (state: EnergyPipelineState): void => {
  const contract = buildWarpCruiseEnvelopeContract({
    preflight: (state as any).warpCruiseEnvelopePreflight ?? null,
    routeTimeWorldline: (state as any).warpRouteTimeWorldline ?? null,
    missionTimeEstimator: (state as any).warpMissionTimeEstimator ?? null,
    missionTimeComparison: (state as any).warpMissionTimeComparison ?? null,
  });
  if (contract) {
    state.warpCruiseEnvelope = contract;
    return;
  }
  delete (state as any).warpCruiseEnvelope;
};

const DEFAULT_IN_HULL_PROPER_ACCELERATION_BRICK_DIMS: [number, number, number] = [
  24,
  24,
  24,
];
const IN_HULL_PROPER_ACCELERATION_ALPHA_CONST_TOLERANCE = 1e-12;

type InHullProperAccelerationSamplingPoint = {
  sampleId: WarpInHullProperAccelerationSampleRole;
  sampleRole: WarpInHullProperAccelerationSampleRole;
  position_m: WarpInHullProperAccelerationVec3;
};

const resolveInHullProperAccelerationBrickDims = (
  state: EnergyPipelineState,
): [number, number, number] => {
  const dims = Array.isArray(state.gr?.grid?.dims) ? state.gr?.grid?.dims : null;
  if (
    dims &&
    dims.length === 3 &&
    dims.every((entry) => Number.isFinite(entry) && Number(entry) > 0)
  ) {
    return dims.map((entry) => Math.max(1, Math.floor(Number(entry)))) as [
      number,
      number,
      number,
    ];
  }
  return [...DEFAULT_IN_HULL_PROPER_ACCELERATION_BRICK_DIMS];
};

const sampleDirectBrickChannelAtPoint = (
  brick: {
    dims: [number, number, number];
    bounds: { min: Vec3; max: Vec3 };
    channels: Record<string, { data: Float32Array } | undefined>;
  },
  fieldId: string,
  point: WarpInHullProperAccelerationVec3,
): number | null => {
  const channel = brick.channels[fieldId];
  if (!channel?.data) return null;
  const [nx, ny, nz] = brick.dims;
  const clampIndex = (value: number, size: number) =>
    Math.max(0, Math.min(size - 1, value));
  const xNorm =
    (point[0] - brick.bounds.min[0]) /
    Math.max(1e-9, brick.bounds.max[0] - brick.bounds.min[0]);
  const yNorm =
    (point[1] - brick.bounds.min[1]) /
    Math.max(1e-9, brick.bounds.max[1] - brick.bounds.min[1]);
  const zNorm =
    (point[2] - brick.bounds.min[2]) /
    Math.max(1e-9, brick.bounds.max[2] - brick.bounds.min[2]);
  const ix = clampIndex(Math.floor(xNorm * nx), nx);
  const iy = clampIndex(Math.floor(yNorm * ny), ny);
  const iz = clampIndex(Math.floor(zNorm * nz), nz);
  const idx = iz * nx * ny + iy * nx + ix;
  const value = channel.data[idx];
  return Number.isFinite(value) ? value : null;
};

const buildInHullProperAccelerationSamplingGeometry = (
  state: EnergyPipelineState,
  warpState: Record<string, any> | undefined,
): WarpInHullProperAccelerationSamplingGeometry | null => {
  const transportSampleFamily = warpState?.solveBackedTransportSampleFamily as
    | SolveBackedWarpTransportSampleFamily
    | undefined;
  let centerlineAxis = toWarpWorldlineVec3(transportSampleFamily?.axes.centerline);
  let portStarboardAxis = toWarpWorldlineVec3(transportSampleFamily?.axes.portStarboard);
  let dorsalVentralAxis = toWarpWorldlineVec3(transportSampleFamily?.axes.dorsalVentral);
  if (!centerlineAxis || !portStarboardAxis || !dorsalVentralAxis) {
    const driveDirection = normalizeVec(
      toFiniteVec3(
        (state.dynamicConfig as any)?.warpDriveDirection ??
          (state as any)?.warpGeometry?.driveDirection ??
          state.driveDir ??
          [1, 0, 0],
        [1, 0, 0],
      ),
    );
    const transverseReference =
      Math.abs(driveDirection[2]) < 0.95
        ? ([0, 0, 1] as WarpWorldlineVec3)
        : ([0, 1, 0] as WarpWorldlineVec3);
    centerlineAxis = [...driveDirection];
    portStarboardAxis = normalizeVec(crossVec(transverseReference, driveDirection));
    dorsalVentralAxis = normalizeVec(crossVec(driveDirection, portStarboardAxis));
  }
  if (!centerlineAxis || !portStarboardAxis || !dorsalVentralAxis) return null;

  const hull = resolveHullGeometry(state);
  const interiorClearance_m = Math.max(1e-3, hull.wallThickness_m * 4);
  const resolveInteriorOffset = (halfExtent: number) =>
    Math.max(1e-6, Math.min(halfExtent * 0.25, Math.max(1e-6, halfExtent - interiorClearance_m)));
  const centerlineOffset_m = resolveInteriorOffset(hull.Lx_m / 2);
  const transverseOffset_m = resolveInteriorOffset(hull.Ly_m / 2);
  const verticalOffset_m = resolveInteriorOffset(hull.Lz_m / 2);

  const sampleDefs: InHullProperAccelerationSamplingPoint[] = [
    {
      sampleId: "cabin_center",
      sampleRole: "cabin_center",
      position_m: [0, 0, 0],
    },
    {
      sampleId: "cabin_fore",
      sampleRole: "cabin_fore",
      position_m: [
        centerlineAxis[0] * centerlineOffset_m,
        centerlineAxis[1] * centerlineOffset_m,
        centerlineAxis[2] * centerlineOffset_m,
      ],
    },
    {
      sampleId: "cabin_aft",
      sampleRole: "cabin_aft",
      position_m: [
        -centerlineAxis[0] * centerlineOffset_m,
        -centerlineAxis[1] * centerlineOffset_m,
        -centerlineAxis[2] * centerlineOffset_m,
      ],
    },
    {
      sampleId: "cabin_port",
      sampleRole: "cabin_port",
      position_m: [
        portStarboardAxis[0] * transverseOffset_m,
        portStarboardAxis[1] * transverseOffset_m,
        portStarboardAxis[2] * transverseOffset_m,
      ],
    },
    {
      sampleId: "cabin_starboard",
      sampleRole: "cabin_starboard",
      position_m: [
        -portStarboardAxis[0] * transverseOffset_m,
        -portStarboardAxis[1] * transverseOffset_m,
        -portStarboardAxis[2] * transverseOffset_m,
      ],
    },
    {
      sampleId: "cabin_dorsal",
      sampleRole: "cabin_dorsal",
      position_m: [
        dorsalVentralAxis[0] * verticalOffset_m,
        dorsalVentralAxis[1] * verticalOffset_m,
        dorsalVentralAxis[2] * verticalOffset_m,
      ],
    },
    {
      sampleId: "cabin_ventral",
      sampleRole: "cabin_ventral",
      position_m: [
        -dorsalVentralAxis[0] * verticalOffset_m,
        -dorsalVentralAxis[1] * verticalOffset_m,
        -dorsalVentralAxis[2] * verticalOffset_m,
      ],
    },
  ];

  return {
    familyId: "nhm2_cabin_cross",
    description:
      "Deterministic bounded cabin-cross sample family in the comoving Cartesian chart: center, fore, aft, port, starboard, dorsal, and ventral interior points. This family is for observer-defined experienced proper acceleration only.",
    coordinateFrame: "comoving_cartesian",
    originDefinition: "ship_center",
    ordering: sampleDefs.map((entry) => entry.sampleId),
    representativeSampleId: "cabin_center",
    axes: {
      centerline: [...centerlineAxis],
      portStarboard: [...portStarboardAxis],
      dorsalVentral: [...dorsalVentralAxis],
    },
    offsets_m: {
      centerline: centerlineOffset_m,
      transverse: transverseOffset_m,
      vertical: verticalOffset_m,
      interiorClearance: interiorClearance_m,
    },
    samplePositions_m: Object.fromEntries(
      sampleDefs.map((entry) => [entry.sampleId, [...entry.position_m]]),
    ) as WarpInHullProperAccelerationSamplingGeometry["samplePositions_m"],
  };
};

export const buildWarpInHullProperAccelerationContractFromState = async (
  state: EnergyPipelineState,
): Promise<WarpInHullProperAccelerationContractV1 | null> => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  const adapter = warpState?.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  const metricContract = warpState?.metricT00Contract as MetricT00Contract | undefined;
  const metricT00Source =
    typeof warpState?.metricT00Source === "string"
      ? String(warpState.metricT00Source)
      : typeof warpState?.stressEnergySource === "string"
        ? String(warpState.stressEnergySource)
        : null;
  const metricT00Ref =
    typeof warpState?.metricT00Ref === "string" && warpState.metricT00Ref.length > 0
      ? String(warpState.metricT00Ref)
      : resolveCanonicalMetricT00Ref(warpState ?? {}, adapter) ?? null;
  const chartLabel = adapter?.chart?.label ?? null;
  const chartContractStatus = adapter?.chart?.contractStatus ?? null;
  const metricFamily = metricContract?.family ?? adapter?.family ?? "unknown";
  const transportSurfaceSemantics = resolveWarpTransportSurfaceSemantics({
    state,
    metricFamily,
    metricT00Ref,
    metricContract,
    adapter,
  });
  if (metricT00Source !== "metric") return null;
  if (metricContract?.status !== "ok") return null;
  if (metricContract?.observer !== "eulerian_n") return null;
  if (metricContract?.normalization !== "si_stress") return null;
  if (metricContract?.unitSystem !== "SI") return null;
  if (chartLabel !== "comoving_cartesian") return null;
  if (chartContractStatus !== "ok") return null;
  if (
    metricFamily !== "natario" &&
    metricFamily !== "natario_sdf" &&
    metricFamily !== "nhm2_shift_lapse"
  ) {
    return null;
  }
  if (metricT00Ref == null) return null;
  if (
    transportSurfaceSemantics.shiftLapseSelected &&
    !transportSurfaceSemantics.shiftLapseTransportGatePassed
  ) {
    return null;
  }

  const samplingGeometry = buildInHullProperAccelerationSamplingGeometry(state, warpState);
  if (!samplingGeometry) return null;

  const previousGlobalState = getGlobalPipelineState();
  const shouldRestoreGlobalState = previousGlobalState !== state;
  if (shouldRestoreGlobalState) {
    setGlobalPipelineState(state);
  }

  let brick:
    | {
        dims: [number, number, number];
        bounds: { min: Vec3; max: Vec3 };
        voxelSize_m: [number, number, number];
        channels: Record<string, { data: Float32Array; min: number; max: number } | undefined>;
        meta?: { status?: string };
        stats?: { solverHealth?: { status?: string } };
      }
    | null = null;
  try {
    const brickModule = await import("./gr-evolve-brick.ts");
    brick = brickModule.buildGrEvolveBrick({
      dims: resolveInHullProperAccelerationBrickDims(state),
      useInitialData: transportSurfaceSemantics.shiftLapseSelected,
      includeMatter: false,
      includeConstraints: false,
      includeKij: false,
      includeInvariants: false,
      sourceParams: {
        ...(metricT00Ref ? { metricT00Ref } : {}),
        ...(metricT00Source ? { metricT00Source } : {}),
        ...(transportSurfaceSemantics.shiftLapseSelected
          ? { warpFieldType: "nhm2_shift_lapse" as const }
          : {}),
      },
    }) as unknown as typeof brick;
  } finally {
    if (shouldRestoreGlobalState) {
      setGlobalPipelineState(previousGlobalState);
    }
  }

  if (!brick) return null;
  if (brick.meta?.status !== "CERTIFIED") return null;
  if (brick.stats?.solverHealth?.status !== "CERTIFIED") return null;

  const sampleSummaries = samplingGeometry.ordering.map((sampleId) => {
    const position_m = samplingGeometry.samplePositions_m[sampleId];
    const alpha = sampleDirectBrickChannelAtPoint(brick, "alpha", position_m);
    const accelX = sampleDirectBrickChannelAtPoint(
      brick,
      "eulerian_accel_geom_x",
      position_m,
    );
    const accelY = sampleDirectBrickChannelAtPoint(
      brick,
      "eulerian_accel_geom_y",
      position_m,
    );
    const accelZ = sampleDirectBrickChannelAtPoint(
      brick,
      "eulerian_accel_geom_z",
      position_m,
    );
    const accelMagDirect = sampleDirectBrickChannelAtPoint(
      brick,
      "eulerian_accel_geom_mag",
      position_m,
    );
    if (
      alpha == null ||
      accelX == null ||
      accelY == null ||
      accelZ == null ||
      accelMagDirect == null
    ) {
      return null;
    }
    const componentMagnitude = Math.hypot(accelX, accelY, accelZ);
    const properAccelerationGeomMagnitude_per_m = Math.max(
      Math.abs(accelMagDirect),
      componentMagnitude,
    );
    const properAccelerationMagnitude_mps2 = properAccelerationGeomToMps2(
      properAccelerationGeomMagnitude_per_m,
    );
    return {
      sampleId,
      sampleRole: sampleId,
      position_m: [...position_m] as WarpInHullProperAccelerationVec3,
      alpha,
      properAccelerationGeomVector_per_m: [
        accelX,
        accelY,
        accelZ,
      ] as WarpInHullProperAccelerationVec3,
      properAccelerationGeomMagnitude_per_m,
      properAccelerationMagnitude_mps2,
      properAccelerationMagnitude_g: properAccelerationMps2ToG(
        properAccelerationMagnitude_mps2,
      ),
    };
  });
  if (sampleSummaries.some((entry) => entry == null)) return null;

  const typedSampleSummaries = sampleSummaries as Array<
    NonNullable<(typeof sampleSummaries)[number]>
  >;
  const alphaValues = typedSampleSummaries.map((entry) => entry.alpha);
  const alphaSpread = Math.max(...alphaValues) - Math.min(...alphaValues);
  const brickAlphaSpread = Math.abs(
    (brick.channels.alpha?.max ?? 0) - (brick.channels.alpha?.min ?? 0),
  );
  const channelExtrema = summarizeInHullProperAccelerationChannelExtrema({
    accelMagMin: brick.channels.eulerian_accel_geom_mag?.min,
    accelMagMax: brick.channels.eulerian_accel_geom_mag?.max,
    alphaGradXMin: brick.channels.alpha_grad_x?.min,
    alphaGradXMax: brick.channels.alpha_grad_x?.max,
    alphaGradYMin: brick.channels.alpha_grad_y?.min,
    alphaGradYMax: brick.channels.alpha_grad_y?.max,
    alphaGradZMin: brick.channels.alpha_grad_z?.min,
    alphaGradZMax: brick.channels.alpha_grad_z?.max,
  });
  const allSampleMagnitudesZero = typedSampleSummaries.every(
    (entry) => entry.properAccelerationGeomMagnitude_per_m === 0,
  );
  const declaredLapseProfileCompanionPresent =
    warpState?.lapseSummary != null || adapter?.lapseSummary != null;
  const expectedZeroProfileByModel =
    alphaSpread <= IN_HULL_PROPER_ACCELERATION_ALPHA_CONST_TOLERANCE &&
    brickAlphaSpread <= IN_HULL_PROPER_ACCELERATION_ALPHA_CONST_TOLERANCE;
  let resolutionAdequacyStatus:
    | "adequate_constant_lapse_zero_profile"
    | "adequate_direct_brick_profile"
    | null = null;
  let resolutionAdequacyNote: string | null = null;
  if (
    allSampleMagnitudesZero &&
    channelExtrema.wholeBrickAccelerationAbsMax_per_m === 0 &&
    channelExtrema.wholeBrickGradientAbsMax_per_m === 0 &&
    expectedZeroProfileByModel
  ) {
    resolutionAdequacyStatus = "adequate_constant_lapse_zero_profile";
    resolutionAdequacyNote =
      declaredLapseProfileCompanionPresent
        ? "Direct gr-evolve brick sampling shows a zero proper-acceleration profile across the bounded cabin-cross family, and the certified brick itself remains constant-lapse over the sampled region even though a higher-level lapse summary is declared. This is treated as a certified direct-brick zero-profile result rather than as a nonzero resolved cabin-gravity claim."
        : "Direct gr-evolve brick sampling shows a zero proper-acceleration profile across the bounded cabin-cross family, and the current NHM2 metric path has no declared lapse-profile companion. This is treated as a certified constant-lapse zero-profile result rather than as an under-resolved fallback case.";
  } else if (channelExtrema.wholeBrickAccelerationAbsMax_per_m > 0) {
    resolutionAdequacyStatus = "adequate_direct_brick_profile";
    resolutionAdequacyNote =
      "Direct gr-evolve brick sampling resolves a nonzero interior Eulerian proper-acceleration profile on the bounded cabin-cross family without analytic fallback.";
  } else {
    return null;
  }

  return buildWarpInHullProperAccelerationContract({
    sourceSurface: {
      surfaceId: "nhm2_metric_in_hull_proper_acceleration_profile",
      producer: "server/energy-pipeline.ts",
      provenanceClass: "solve_backed",
      brickChannelSource: "gr_evolve_brick",
      accelerationField: "eulerian_accel_geom_*",
      metricT00Ref,
      metricT00Source: "metric",
      metricFamily,
      familyAuthorityStatus: transportSurfaceSemantics.familyAuthorityStatus,
      transportCertificationStatus:
        transportSurfaceSemantics.transportCertificationStatus,
      metricT00ContractStatus: "ok",
      chartContractStatus: "ok",
      brickStatus: "CERTIFIED",
      brickSolverStatus: "CERTIFIED",
      ...(transportSurfaceSemantics.shiftLapseTransportPromotionGate?.shiftLapseProfileId
        ? {
            shiftLapseProfileId:
              transportSurfaceSemantics.shiftLapseTransportPromotionGate
                .shiftLapseProfileId,
          }
        : {}),
      shiftLapseTransportPromotionGate:
        transportSurfaceSemantics.shiftLapseTransportPromotionGate,
    },
    chart: {
      label: "comoving_cartesian",
      coordinateMap:
        typeof adapter?.chart?.coordinateMap === "string"
          ? String(adapter.chart.coordinateMap)
          : null,
      chartFixed: true,
    },
    samplingGeometry,
    sampleSummaries: typedSampleSummaries.map((entry) => ({
      sampleId: entry.sampleId,
      sampleRole: entry.sampleRole,
      position_m: [...entry.position_m] as WarpInHullProperAccelerationVec3,
      properAccelerationGeomVector_per_m: [
        ...entry.properAccelerationGeomVector_per_m,
      ] as WarpInHullProperAccelerationVec3,
      properAccelerationGeomMagnitude_per_m:
        entry.properAccelerationGeomMagnitude_per_m,
      properAccelerationMagnitude_mps2: entry.properAccelerationMagnitude_mps2,
      properAccelerationMagnitude_g: entry.properAccelerationMagnitude_g,
    })),
    resolutionAdequacy: {
      status: resolutionAdequacyStatus,
      criterionId: "direct_gr_evolve_brick_no_fallback_v1",
      criterionMeaning:
        "Certified mode samples direct gr-evolve brick Eulerian-acceleration channels only. A zero profile is certifiable only when the whole sampled brick reports zero acceleration/gradient extrema and the solve path exposes no declared lapse-profile companion. Otherwise a certified profile requires direct nonzero brick acceleration support; unresolved zero channels fail closed.",
      brickDims: [...brick.dims] as [number, number, number],
      voxelSize_m: [...brick.voxelSize_m] as [number, number, number],
      wholeBrickAccelerationAbsMax_per_m:
        channelExtrema.wholeBrickAccelerationAbsMax_per_m,
      wholeBrickGradientAbsMax_per_m:
        channelExtrema.wholeBrickGradientAbsMax_per_m,
      allSampleMagnitudesZero,
      expectedZeroProfileByModel,
      note: resolutionAdequacyNote,
    },
    claimBoundary: [
      "bounded in-hull observer-defined proper acceleration only",
      "experienced acceleration for Eulerian cabin observers only",
      "not a curvature-gravity certificate",
      "not a comfort or safety certification by itself",
    ],
    falsifierConditions: [
      "metric_t00_source_not_metric",
      "metric_contract_status_not_ok",
      "chart_contract_status_not_ok",
      "shift_lapse_transport_promotion_gate_not_pass",
      "brick_status_not_certified",
      "brick_solver_status_not_certified",
      "direct_gr_evolve_brick_channels_missing",
      "under_resolved_direct_brick_profile",
      "analytic_fallback_requested_for_certified_mode",
    ],
    nonClaims: [
      "not curvature-gravity certified",
      "not comfort-certified",
      "not safety-certified",
      "not viability-promotion evidence",
      "not source-mechanism promotion",
    ],
  });
};

const refreshWarpInHullProperAcceleration = async (
  state: EnergyPipelineState,
): Promise<void> => {
  const contract = await buildWarpInHullProperAccelerationContractFromState(state);
  if (contract) {
    state.warpInHullProperAcceleration = contract;
    return;
  }
  delete (state as any).warpInHullProperAcceleration;
};

const refreshMetricT00Contract = (state: EnergyPipelineState): void => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  if (!warpState) return;
  const metricT00 = firstFinite(warpState.metricT00);
  const metricT00Source = warpState.metricT00Source ?? warpState.stressEnergySource;
  if (metricT00Source !== "metric" || metricT00 == null) return;
  const adapter = warpState.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  const metricT00Ref =
    typeof warpState.metricT00Ref === "string" && warpState.metricT00Ref.length > 0
      ? String(warpState.metricT00Ref)
      : resolveCanonicalMetricT00Ref(warpState, adapter) ?? "warp.metric.T00";
  const derivation =
    typeof warpState.metricT00Derivation === "string" && warpState.metricT00Derivation.length > 0
      ? String(warpState.metricT00Derivation)
      : metricT00Ref === "warp.metric.T00.vdb.regionII"
        ? "forward_B_to_derivatives_to_rho_E"
        : metricT00Ref === "warp.metric.T00.vdb.regionIV"
          ? "forward_fwall_to_rho_E"
        : "forward_shift_to_K_to_rho_E";
  const contract = buildMetricT00Contract({
    adapter,
    metricT00Ref,
    observer:
      typeof warpState.metricT00Observer === "string"
        ? String(warpState.metricT00Observer)
        : undefined,
    normalization:
      typeof warpState.metricT00Normalization === "string"
        ? String(warpState.metricT00Normalization)
        : undefined,
    unitSystem:
      typeof warpState.metricT00UnitSystem === "string"
        ? String(warpState.metricT00UnitSystem)
        : undefined,
    derivation,
  });
  warpState.metricT00Ref = metricT00Ref;
  warpState.metricT00Derivation = derivation;
  warpState.metricT00Observer = contract.observer;
  warpState.metricT00Normalization = contract.normalization;
  warpState.metricT00UnitSystem = contract.unitSystem;
  warpState.metricT00FamilyAuthorityStatus = contract.familyAuthorityStatus;
  warpState.metricT00TransportCertificationStatus = contract.transportCertificationStatus;
  warpState.metricT00FamilySemanticsNote = contract.familySemanticsNote;
  warpState.metricT00Contract = contract;
};

const refreshMetricConstraintAudit = (state: EnergyPipelineState): void => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  if (!warpState) {
    state.metricConstraint = undefined;
    return;
  }
  const diagnostics = warpState.metricStressDiagnostics;
  const rhoGeomMean = firstFinite(diagnostics?.rhoGeomMean);
  if (rhoGeomMean == null) {
    state.metricConstraint = undefined;
    return;
  }
  const sampleCount = Number.isFinite(diagnostics?.sampleCount)
    ? Number(diagnostics.sampleCount)
    : undefined;
  const absMean = Math.abs(rhoGeomMean);
  const rho_constraint: GrConstraintDiagnostics = {
    min: rhoGeomMean,
    max: rhoGeomMean,
    maxAbs: absMean,
    rms: absMean,
    mean: rhoGeomMean,
    ...(sampleCount != null ? { sampleCount } : {}),
  };
  const adapter = warpState.metricAdapter as WarpMetricAdapterSnapshot | undefined;
  const metricT00Ref =
    typeof warpState.metricT00Ref === "string" && warpState.metricT00Ref.length > 0
      ? String(warpState.metricT00Ref)
      : resolveCanonicalMetricT00Ref(warpState, adapter) ?? "warp.metric.T00";
  const contract = warpState.metricT00Contract as MetricT00Contract | undefined;
  const observerRaw =
    (contract?.observer as string | undefined) ??
    (typeof warpState.metricT00Observer === "string"
      ? String(warpState.metricT00Observer)
      : undefined);
  const normalizationRaw =
    (contract?.normalization as string | undefined) ??
    (typeof warpState.metricT00Normalization === "string"
      ? String(warpState.metricT00Normalization)
      : undefined);
  const unitSystemRaw =
    (contract?.unitSystem as string | undefined) ??
    (typeof warpState.metricT00UnitSystem === "string"
      ? String(warpState.metricT00UnitSystem)
      : undefined);
  state.metricConstraint = {
    updatedAt: Date.now(),
    source: metricT00Ref,
    chart: adapter?.chart?.label,
    family: adapter?.family,
    observer: observerRaw,
    normalization: normalizationRaw,
    unitSystem: unitSystemRaw,
    rho_constraint,
  };
};

const hasAnySourceClosureTensorComponent = (
  tensor: Nhm2SourceClosureTensor | null | undefined,
): tensor is Nhm2SourceClosureTensor =>
  tensor != null &&
  NHM2_SOURCE_CLOSURE_COMPONENTS.some((component) => tensor[component] != null);

const extractNhm2SourceClosureTensor = (value: unknown): Nhm2SourceClosureTensor | null => {
  if (!value || typeof value !== "object") return null;
  const tensor = normalizeNhm2SourceClosureTensor(
    value as Partial<Record<Nhm2SourceClosureComponent, unknown>>,
  );
  return hasAnySourceClosureTensorComponent(tensor) ? tensor : null;
};

const resolveNhm2SourceClosureTolerance = (): number => {
  const configured = Number(process.env.WARP_NHM2_SOURCE_CLOSURE_REL_LINF_MAX);
  return Number.isFinite(configured) && configured >= 0
    ? Number(configured)
    : DEFAULT_NHM2_SOURCE_CLOSURE_REL_LINF_MAX;
};

const NHM2_SOURCE_CLOSURE_TILE_GLOBAL_SUMMARY_REF =
  "gr.matter.stressEnergy.tensorSampledSummaries.global.nhm2_shift_lapse.diagonal_proxy";

type RequiredNhm2SourceClosureRegionId =
  (typeof REQUIRED_NHM2_SOURCE_CLOSURE_REGION_IDS)[number];

const isRequiredNhm2SourceClosureRegionId = (
  value: unknown,
): value is RequiredNhm2SourceClosureRegionId =>
  typeof value === "string" &&
  REQUIRED_NHM2_SOURCE_CLOSURE_REGION_IDS.includes(
    value as RequiredNhm2SourceClosureRegionId,
  );

const isCompleteNhm2SourceClosureTensor = (
  tensor: Nhm2SourceClosureTensor,
): boolean =>
  NHM2_SOURCE_CLOSURE_COMPONENTS.every((component) => tensor[component] != null);

const normalizeCasimirReceiptModelKind = (
  value: unknown,
): CasimirMaterialModelKind => {
  const text = asText(value)?.toLowerCase() ?? "";
  if (text === "measured_dielectric") return "measured_dielectric";
  if (text.includes("lifshitz")) return "lifshitz";
  if (
    text.includes("ideal") ||
    text.includes("retarded") ||
    text === "pec" ||
    text.includes("perfect")
  ) {
    return "perfect_conductor_ideal";
  }
  return "missing";
};

const normalizeCasimirGapMetrologyStatus = (
  value: unknown,
  fallback: CasimirGapMetrologyStatus,
): CasimirGapMetrologyStatus => {
  const text = asText(value);
  return text === "measured" ||
    text === "design" ||
    text === "proxy" ||
    text === "missing"
    ? text
    : fallback;
};

const normalizeCasimirBeyondPfaValidity = (
  value: unknown,
): CasimirBeyondPfaValidity => {
  const text = asText(value);
  return text === "pass" ||
    text === "fail" ||
    text === "unknown" ||
    text === "not_evaluated"
    ? text
    : "not_evaluated";
};

const normalizeCasimirVacuumEvidence = (
  value: unknown,
): CasimirVacuumSealEvidence => {
  const text = asText(value);
  return text === "present" || text === "missing" || text === "proxy"
    ? text
    : "missing";
};

const refreshCasimirMaterialReceipt = (state: EnergyPipelineState): void => {
  const root = state as Record<string, any>;
  const materialProps = (state.materialProps ?? {}) as Record<string, unknown>;
  const geometry = (root.geometry ?? {}) as Record<string, unknown>;
  const environment = (root.environment ?? {}) as Record<string, unknown>;
  const corrections = (root.casimirCorrectionFactors ??
    root.correctionFactors ??
    {}) as Record<string, unknown>;
  const gapNm = firstFinite(
    state.gap_nm,
    root.tiles?.gap_nm,
    geometry.gap_nm,
  );
  const gapMeters = gapNm != null ? gapNm * NM_TO_M : null;
  const roughnessNm = firstFinite(
    materialProps.roughness_nm as number | undefined,
    root.roughness_nm,
    geometry.roughness_nm,
  );
  const roughnessRmsMeters = roughnessNm != null ? roughnessNm * NM_TO_M : null;
  const temperatureK =
    firstFinite(
      state.temperature_K,
      materialProps.temperature_K as number | undefined,
      root.temperatureK,
      root.temperature,
      environment.temperatureK,
    ) ?? null;
  const modelKind = normalizeCasimirReceiptModelKind(
    state.casimirModel ?? root.materialModel ?? root.casimirMaterialModel,
  );
  const dielectricResponseRef =
    asText(materialProps.dielectricResponseRef) ??
    asText(materialProps.dielectric_response_ref) ??
    asText(root.dielectricResponseRef) ??
    asText(root.dielectric_response_ref);
  const gapMetrologyStatus = normalizeCasimirGapMetrologyStatus(
    root.gapMetrologyStatus ?? geometry.gapMetrologyStatus,
    gapMeters == null ? "missing" : "design",
  );
  const finiteTemperatureIncluded =
    root.finiteTemperatureIncluded === true ||
    modelKind === "lifshitz" ||
    modelKind === "measured_dielectric";
  const roughnessCorrectionIncluded =
    root.roughnessCorrectionIncluded === true ||
    roughnessRmsMeters != null ||
    toFiniteNumberOrNull(corrections.roughness) != null;
  const finiteConductivityIncluded =
    root.finiteConductivityIncluded === true ||
    modelKind === "lifshitz" ||
    modelKind === "measured_dielectric";

  state.casimirMaterialReceipt = buildCasimirMaterialReceipt({
    generatedAt: new Date().toISOString(),
    tileBatchId: [
      "tile_batch",
      asText(root.tileBatchId) ?? asText(root.currentMode) ?? "runtime",
      gapNm != null ? `gap_nm_${Number(gapNm).toPrecision(6)}` : "gap_unknown",
      Number.isFinite(state.N_tiles) ? `tiles_${Math.round(state.N_tiles)}` : "tiles_unknown",
    ].join(":"),
    geometry: {
      gapMeters,
      gapMetrologyStatus,
      roughnessRmsMeters,
      beyondPfaValidity: normalizeCasimirBeyondPfaValidity(
        root.beyondPfaValidity ?? geometry.beyondPfaValidity,
      ),
    },
    material: {
      modelKind,
      ...(dielectricResponseRef != null ? { dielectricResponseRef } : {}),
      finiteConductivityIncluded,
      finiteTemperatureIncluded,
      roughnessCorrectionIncluded,
    },
    environment: {
      vacuumSealEvidence: normalizeCasimirVacuumEvidence(
        root.vacuumSealEvidence ?? environment.vacuumSealEvidence,
      ),
      temperatureK,
    },
    correctionFactors: {
      conductivity: toFiniteNumberOrNull(corrections.conductivity) ?? null,
      temperature: toFiniteNumberOrNull(corrections.temperature) ?? null,
      roughness: toFiniteNumberOrNull(corrections.roughness) ?? null,
      geometry: toFiniteNumberOrNull(corrections.geometry) ?? null,
    },
  });
};

const resolveNhm2SourceClosureBrickBasis = (state: EnergyPipelineState) => {
  const hull = (state.hull ?? {}) as Record<string, unknown>;
  const Lx = Math.max(1e-6, toFiniteNumber(hull.Lx_m) ?? 1007);
  const Ly = Math.max(1e-6, toFiniteNumber(hull.Ly_m) ?? 264);
  const Lz = Math.max(1e-6, toFiniteNumber(hull.Lz_m) ?? 173);
  const wallThickness = Math.max(0.1, toFiniteNumber(hull.wallThickness_m) ?? 0.45);
  return {
    dims: [128, 128, 128] as [number, number, number],
    bounds: {
      min: [-Lx / 2, -Ly / 2, -Lz / 2] as [number, number, number],
      max: [Lx / 2, Ly / 2, Lz / 2] as [number, number, number],
    },
    hullAxes: [Lx / 2, Ly / 2, Lz / 2] as [number, number, number],
    hullWall: wallThickness,
    radialMap: null,
  };
};

const collectNhm2SourceClosureRegionComparisons = (
  state: EnergyPipelineState,
  metricTensorRef: string,
): Nhm2SourceClosureV2RegionComparisonInput[] => {
  const brickBasis = resolveNhm2SourceClosureBrickBasis(state);
  const [nx, ny, nz] = brickBasis.dims;
  const dx = (brickBasis.bounds.max[0] - brickBasis.bounds.min[0]) / nx;
  const dy = (brickBasis.bounds.max[1] - brickBasis.bounds.min[1]) / ny;
  const dz = (brickBasis.bounds.max[2] - brickBasis.bounds.min[2]) / nz;
  const cellVolume = dx * dy * dz;
  const regionMaskNote = `brick_mask=ellipsoid_axes_m(${brickBasis.hullAxes
    .map((value) => value.toFixed(6))
    .join(",")}); wall_sigma_m=${brickBasis.hullWall.toFixed(6)}; exterior_shell_limit_m=${(brickBasis.hullWall * 3).toFixed(6)}; dims=${brickBasis.dims.join("x")}; cell_volume_m3=${cellVolume.toExponential(6)}`;
  const regionVoxelIds = new Array<RequiredNhm2SourceClosureRegionId | null>(
    brickBasis.dims[0] * brickBasis.dims[1] * brickBasis.dims[2],
  ).fill(null);
  const regionMaskCounts = new Map<RequiredNhm2SourceClosureRegionId, number>();
  const voxelIndex = (x: number, y: number, z: number) =>
    x + brickBasis.dims[0] * (y + brickBasis.dims[1] * z);
  const warpState = ((state as any).warp ?? null) as Record<string, unknown> | null;
  const adapter =
    ((warpState?.metricAdapter ?? null) as WarpMetricAdapterSnapshot | null) ?? null;
  const selectedProfileId =
    asText((warpState?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
    asText((adapter?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
    asText((state.dynamicConfig as Record<string, unknown> | null | undefined)?.shiftLapseProfileId) ??
    DEFAULT_WARP_SHIFT_LAPSE_PROFILE_ID;
  const chartId = asText(adapter?.chart?.label) ?? "unknown";
  const casimirMaterialReceipt = state.casimirMaterialReceipt ?? null;
  const stressBrick = buildStressEnergyBrick({
    metricT00: toFiniteNumber((warpState as Record<string, unknown> | null)?.metricT00) ?? undefined,
    metricT00Ref: asText(warpState?.metricT00Ref) ?? undefined,
    metricT00Source:
      asText(warpState?.metricT00Source) ??
      asText(warpState?.stressEnergySource) ??
      undefined,
    warpFieldType: "nhm2_shift_lapse",
    dims: brickBasis.dims,
    bounds: brickBasis.bounds,
    hullAxes: brickBasis.hullAxes,
    hullWall: brickBasis.hullWall,
    radialMap: brickBasis.radialMap,
  });
  const stressRegions = stressBrick.stats.tensorSampledSummaries?.regions ?? [];
  const pressureModel =
    asText(stressBrick.stats.tensorSampledSummaries?.pressureModel) ?? null;
  const pressureSource = asText(stressBrick.stats.mapping?.pressureSource) ?? null;
  const derivePressureProxyMode = (): Nhm2SourceClosureV2RegionProxyDiagnostics["proxyMode"] => {
    const modelSuggestsProxy =
      pressureModel != null && pressureModel.toLowerCase().includes("proxy");
    if (pressureSource === "proxy" || modelSuggestsProxy) return "proxy";
    if (pressureSource === "pipeline" || pressureSource === "override") return "metric";
    return "unknown";
  };
  const tileProxyDiagnosticsBase: Nhm2SourceClosureV2RegionProxyDiagnostics = {
    pressureModel,
    pressureFactor: toFiniteNumberOrNull(stressBrick.stats.mapping?.pressureFactor),
    pressureSource,
    proxyMode: derivePressureProxyMode(),
    brickProxyMode:
      stressBrick.stats.mapping?.proxy === true
        ? "proxy"
        : stressBrick.stats.mapping?.proxy === false
          ? "metric"
          : "unknown",
  };
  const buildTileProxyComponentAttribution = (
    tileTensor: Nhm2SourceClosureTensor,
  ): Record<Nhm2SourceClosureComponent, Nhm2SourceClosureV2RegionProxyComponentAttribution> | null => {
    const hasAnyComponent = NHM2_SOURCE_CLOSURE_COMPONENTS.some(
      (component) => tileTensor[component] != null,
    );
    if (!hasAnyComponent) return null;
    const proxyEligible =
      tileProxyDiagnosticsBase.proxyMode === "proxy" ||
      tileProxyDiagnosticsBase.brickProxyMode === "proxy" ||
      tileProxyDiagnosticsBase.pressureSource === "proxy";
    const pressureFactor = toFiniteNumberOrNull(tileProxyDiagnosticsBase.pressureFactor);
    const meanT00 = toFiniteNumberOrNull(tileTensor.T00);
    const eps = 1e-12;
    const attribution = {} as Record<
      Nhm2SourceClosureComponent,
      Nhm2SourceClosureV2RegionProxyComponentAttribution
    >;
    for (const component of NHM2_SOURCE_CLOSURE_COMPONENTS) {
      const tileValue = toFiniteNumberOrNull(tileTensor[component]);
      if (component === "T00") {
        attribution[component] = {
          constructionMode: tileValue != null ? "direct_region_mean_t00" : "unknown",
          sourceComponent: null,
          proxyFactor: null,
          proxyReconstructedValue: null,
          proxyReconstructionAbsError: null,
          proxyReconstructionRelError: null,
          evidenceStatus: tileValue != null ? "measured" : "unknown",
        };
        continue;
      }

      const hasProxyEvidence = proxyEligible && meanT00 != null && tileValue != null;
      const reconstructed =
        hasProxyEvidence && pressureFactor != null
          ? meanT00 * pressureFactor
          : null;
      const absError =
        reconstructed != null && tileValue != null
          ? Math.abs(tileValue - reconstructed)
          : null;
      const relError =
        absError != null && reconstructed != null && tileValue != null
          ? absError / Math.max(Math.abs(tileValue), Math.abs(reconstructed), eps)
          : null;

      attribution[component] = {
        constructionMode: hasProxyEvidence
          ? "proxy_scaled_from_region_mean_t00"
          : "unknown",
        sourceComponent: hasProxyEvidence ? "T00" : null,
        proxyFactor: hasProxyEvidence ? pressureFactor : null,
        proxyReconstructedValue: reconstructed,
        proxyReconstructionAbsError: absError,
        proxyReconstructionRelError: relError,
        evidenceStatus: hasProxyEvidence ? "inferred" : "unknown",
      };
    }
    return attribution;
  };
  const buildTileProxyDiagnostics = (
    tileTensor: Nhm2SourceClosureTensor,
  ): Nhm2SourceClosureV2RegionProxyDiagnostics => ({
    ...tileProxyDiagnosticsBase,
    componentAttribution: buildTileProxyComponentAttribution(tileTensor),
  });
  const stressRegionMap = new Map<
    RequiredNhm2SourceClosureRegionId,
    {
      sampleCount?: unknown;
      aggregationMode?: unknown;
      normalizationBasis?: unknown;
      weightSum?: unknown;
      accountingEvidenceStatus?: unknown;
      t00Diagnostics?: Record<string, unknown> | null;
      tensor?: unknown;
      note?: unknown;
    }
  >();
  for (const region of stressRegions) {
    if (isRequiredNhm2SourceClosureRegionId(region?.regionId)) {
      stressRegionMap.set(region.regionId, {
        sampleCount: region.sampleCount,
        aggregationMode: (region as { aggregationMode?: unknown }).aggregationMode,
        normalizationBasis: (region as { normalizationBasis?: unknown }).normalizationBasis,
        weightSum: (region as { weightSum?: unknown }).weightSum,
        accountingEvidenceStatus: (region as { accountingEvidenceStatus?: unknown }).accountingEvidenceStatus,
        t00Diagnostics:
          (region as { t00Diagnostics?: Record<string, unknown> | null }).t00Diagnostics ??
          null,
        tensor: region.tensor,
        note: region.note,
      });
    }
  }

  forEachStressEnergyBrickRegionVoxel(brickBasis, (sample) => {
    const [x, y, z] = sample.voxelIndex;
    const regionId = isRequiredNhm2SourceClosureRegionId(sample.classifiedRegionId)
      ? sample.classifiedRegionId
      : null;
    regionVoxelIds[voxelIndex(x, y, z)] = regionId;
    if (regionId) {
      regionMaskCounts.set(regionId, (regionMaskCounts.get(regionId) ?? 0) + 1);
    }
  });

  const shiftVectorField = warpState?.shiftVectorField;
  const evaluateShiftVector =
    shiftVectorField != null &&
    typeof (shiftVectorField as Record<string, unknown>).evaluateShiftVector === "function"
      ? ((shiftVectorField as Record<string, unknown>).evaluateShiftVector as (
          x: number,
          y: number,
          z: number,
        ) => [number, number, number])
      : null;

  const metricRegionMap = new Map<
    RequiredNhm2SourceClosureRegionId,
    {
      sampleCount: number;
      diagonalTensor: {
        T00: number;
        T11: number;
        T22: number;
        T33: number;
        isNullEnergyConditionSatisfied: boolean;
      } | null;
      fullTensor: Record<string, unknown> | null;
    }
  >();

  if (evaluateShiftVector != null) {
    const metricRegionMeans =
      calculateMetricStressEnergyTensorRegionMeansFromShiftField(evaluateShiftVector, {
        dims: brickBasis.dims,
        bounds: brickBasis.bounds,
        classifyRegion: ({ voxelIndex: [x, y, z] }) => regionVoxelIds[voxelIndex(x, y, z)],
      });

    metricRegionMap.set("global", {
      sampleCount: metricRegionMeans.global.sampleCount,
      diagonalTensor: metricRegionMeans.global.diagonalTensor,
      fullTensor:
        (metricRegionMeans.global.fullTensor as Record<string, unknown> | null | undefined) ??
        null,
    });
    regionMaskCounts.set("global", brickBasis.dims[0] * brickBasis.dims[1] * brickBasis.dims[2]);

    for (const region of metricRegionMeans.regions) {
      if (isRequiredNhm2SourceClosureRegionId(region.regionId)) {
        metricRegionMap.set(region.regionId, {
          sampleCount: region.sampleCount,
          diagonalTensor: region.diagonalTensor,
          fullTensor: (region.fullTensor as Record<string, unknown> | null | undefined) ?? null,
        });
      }
    }
  }

  const buildAccounting = (args: {
    sampleCount: number | null;
    maskVoxelCount: number | null;
    weightSum: number | null;
    aggregationMode: Nhm2SourceClosureV2RegionAccounting["aggregationMode"];
    normalizationBasis: string | null;
    evidenceStatus: Nhm2SourceClosureV2RegionAccounting["evidenceStatus"];
    supportInclusionNote: string;
  }): Nhm2SourceClosureV2RegionAccounting => ({
    sampleCount: args.sampleCount,
    maskVoxelCount: args.maskVoxelCount,
    weightSum: args.weightSum,
    aggregationMode: args.aggregationMode,
    normalizationBasis: args.normalizationBasis,
    regionMaskNote,
    supportInclusionNote: args.supportInclusionNote,
    evidenceStatus: args.evidenceStatus,
  });
  const buildT00Diagnostics = (args: {
    sampleCount: number | null;
    includedCount?: number | null;
    skippedCount?: number | null;
    nonFiniteCount?: number | null;
    meanT00: number | null;
    sumT00: number | null;
    sourceRef?: string | null;
    derivationMode?: Nhm2SourceClosureV2RegionT00Diagnostics["derivationMode"];
    trace?: Nhm2SourceClosureV2RegionT00Trace | null;
    normalizationBasis: string | null;
    aggregationMode: Nhm2SourceClosureV2RegionT00Diagnostics["aggregationMode"];
    evidenceStatus: Nhm2SourceClosureV2RegionT00Diagnostics["evidenceStatus"];
  }): Nhm2SourceClosureV2RegionT00Diagnostics => ({
    sampleCount: args.sampleCount,
    includedCount: args.includedCount ?? null,
    skippedCount: args.skippedCount ?? null,
    nonFiniteCount: args.nonFiniteCount ?? null,
    meanT00: args.meanT00,
    sumT00: args.sumT00,
    sourceRef: args.sourceRef ?? null,
    derivationMode: args.derivationMode ?? "unknown",
    trace: args.trace ?? null,
    normalizationBasis: args.normalizationBasis,
    aggregationMode: args.aggregationMode,
    evidenceStatus: args.evidenceStatus,
  });

  const buildMetricRequiredSameChartFullTensor = (args: {
    regionId: RequiredNhm2SourceClosureRegionId;
    tensor: Record<string, unknown> | null;
    artifactRef: string;
    sampleCount: number | null;
  }): Nhm2SameChartFullTensorArtifactV1 =>
    buildNhm2SameChartFullTensorArtifact({
      laneId: "nhm2_shift_lapse",
      selectedProfileId,
      chartId,
      metricFamily: "nhm2_shift_lapse",
      routeId: "adm_quasi_stationary_recovery_v1",
      source: "adm_projection",
      artifactRef: args.artifactRef,
      tensor: args.tensor,
      defaultAssumptions: [
        "diagnostic-only regional metric-required same-chart tensor inventory",
        "regional tensor components are averaged over the source-closure brick mask",
        "component values are emitted from the shift-field ADM recovery, not copied from tile/source residual targets",
        "source-closure residual semantics remain on the legacy diagonal comparison surface",
        `regionId=${args.regionId}`,
        `sampleCount=${args.sampleCount ?? "unknown"}`,
        regionMaskNote,
      ],
      adm: {
        alphaStatus: "missing",
        betaStatus: args.tensor != null ? "computed" : "missing",
        gammaStatus: args.tensor != null ? "derived_same_chart" : "missing",
        extrinsicCurvatureStatus: args.tensor != null ? "derived_same_chart" : "missing",
      },
    });

  return REQUIRED_NHM2_SOURCE_CLOSURE_REGION_IDS.map((regionId) => {
    const metricRegionEntry = metricRegionMap.get(regionId);
    const tileRegionEntry = stressRegionMap.get(regionId);
    const metricRegionTensor = normalizeNhm2SourceClosureTensor(
      metricRegionEntry?.diagonalTensor ?? null,
    );
    const tileRegionTensor =
      extractNhm2SourceClosureTensor(tileRegionEntry?.tensor ?? null) ??
      normalizeNhm2SourceClosureTensor(tileRegionEntry?.tensor ?? null);
    const metricTensorAvailable = isCompleteNhm2SourceClosureTensor(metricRegionTensor);
    const tileTensorAvailable = isCompleteNhm2SourceClosureTensor(tileRegionTensor);
    const metricSampleCount = toFiniteNumberOrNull(metricRegionEntry?.sampleCount);
    const tileSampleCount = toFiniteNumberOrNull(tileRegionEntry?.sampleCount);
    const maskVoxelCount =
      toFiniteNumberOrNull(regionMaskCounts.get(regionId) ?? null);
    const sampleCount = metricSampleCount ?? tileSampleCount ?? null;
    const metricRegionTensorRef = `${metricTensorRef}.region.${regionId}`;
    const tileRegionTensorRef = `gr.matter.stressEnergy.tensorSampledSummaries.${regionId}.nhm2_shift_lapse.diagonal_proxy`;
    const metricRequiredSameChartFullTensor =
      buildMetricRequiredSameChartFullTensor({
        regionId,
        tensor:
          (metricRegionEntry?.fullTensor as Record<string, unknown> | null | undefined) ??
          (metricRegionEntry?.diagonalTensor as Record<string, unknown> | null | undefined) ??
          null,
        artifactRef: `${metricRegionTensorRef}.sameChartFullTensor`,
        sampleCount: metricSampleCount,
      });
    const noteParts: string[] = [];
    const tileNote = asText(tileRegionEntry?.note);
    if (tileNote != null) {
      noteParts.push(tileNote);
    }
    if (metricTensorAvailable && tileTensorAvailable) {
      noteParts.push(
        "Same-basis regional closure compares runtime-integrated metric-required and tile-effective diagonal tensors over the shared GR matter brick region mask.",
      );
    } else if (tileTensorAvailable) {
      noteParts.push(
        "Regional source closure is unavailable because the runtime metric-required tensor could not be integrated over this region on the shared brick basis.",
      );
    } else {
      noteParts.push(
        "Regional source closure is unavailable because same-basis regional metric and tile tensors were not both available at runtime.",
      );
    }

    const metricAccounting = buildAccounting({
      sampleCount: metricSampleCount,
      maskVoxelCount,
      weightSum: null,
      aggregationMode: metricSampleCount != null ? "mean" : "unknown",
      normalizationBasis: metricSampleCount != null ? "sample_count" : null,
      evidenceStatus:
        metricSampleCount != null && metricRegionTensor.T00 != null
          ? "inferred"
          : "unknown",
      supportInclusionNote:
        "metric_required uses shift-field finite-difference derivatives on the brick grid; unweighted voxel mean; non-finite derivative cells are skipped.",
    });
    const tileAccounting = buildAccounting({
      sampleCount: tileSampleCount,
      maskVoxelCount,
      weightSum: toFiniteNumberOrNull(tileRegionEntry?.weightSum),
      aggregationMode: (tileRegionEntry?.aggregationMode as Nhm2SourceClosureV2RegionAccounting["aggregationMode"] | undefined) ?? "unknown",
      normalizationBasis: asText(tileRegionEntry?.normalizationBasis),
      evidenceStatus:
        tileRegionEntry?.accountingEvidenceStatus === "measured"
          ? "measured"
          : tileRegionEntry?.accountingEvidenceStatus === "inferred"
            ? "inferred"
            : "unknown",
      supportInclusionNote:
        "tile_effective uses GR matter brick region means; unweighted voxel mean; T11/T22/T33 follow the brick pressure proxy.",
    });
    const tileRegionDiagnostics = tileRegionEntry?.t00Diagnostics ?? null;
    const tileSampleCountResolved = toFiniteNumberOrNull(
      tileRegionDiagnostics?.sampleCount ?? tileSampleCount,
    );
    const tileMeanT00Resolved = toFiniteNumberOrNull(
      tileRegionDiagnostics?.meanT00 ?? tileRegionTensor.T00,
    );
    const tileIncludedCountResolved = toFiniteNumberOrNull(
      tileRegionDiagnostics?.includedCount,
    );
    const tileSkippedCountResolved = toFiniteNumberOrNull(
      tileRegionDiagnostics?.skippedCount,
    );
    const tileNonFiniteCountResolved = toFiniteNumberOrNull(
      tileRegionDiagnostics?.nonFiniteCount,
    );
    const tileSumT00Measured = toFiniteNumberOrNull(tileRegionDiagnostics?.sumT00);
    const tileSumT00Synthesized =
      tileSumT00Measured == null &&
      tileSampleCountResolved != null &&
      tileMeanT00Resolved != null
        ? tileSampleCountResolved * tileMeanT00Resolved
        : null;
    const tileSumT00Resolved = tileSumT00Measured ?? tileSumT00Synthesized;
    const tileHasReducerNativeMeasuredEvidence =
      tileSampleCountResolved != null &&
      tileIncludedCountResolved != null &&
      tileSkippedCountResolved != null &&
      tileNonFiniteCountResolved != null &&
      tileMeanT00Resolved != null &&
      tileSumT00Measured != null;
    const tileEvidenceStatusResolved: Nhm2SourceClosureV2RegionT00Diagnostics["evidenceStatus"] =
      tileHasReducerNativeMeasuredEvidence &&
      tileRegionDiagnostics?.evidenceStatus === "measured"
        ? "measured"
        : tileRegionDiagnostics?.evidenceStatus === "inferred" ||
            tileSumT00Synthesized != null ||
            tileRegionDiagnostics?.evidenceStatus === "measured"
          ? "inferred"
          : "unknown";
    const metricT00SourceRef =
      metricRegionTensor.T00 != null ? `${metricRegionTensorRef}.T00` : null;
    const tileT00SourceRef =
      tileRegionDiagnostics?.meanT00 != null
        ? `gr.matter.stressEnergy.tensorSampledSummaries.${regionId}.t00Diagnostics.meanT00`
        : tileRegionTensor.T00 != null
          ? `${tileRegionTensorRef}.T00`
          : null;
    const regionMaskRef = `gr.matter.stressEnergy.tensorSampledSummaries.${regionId}.brick_mask`;
    const metricT00PathFacts: NonNullable<Nhm2SourceClosureV2RegionT00Trace["pathFacts"]> | null =
      metricRegionTensor.T00 != null
        ? {
            producerModule: "modules/warp/natario-warp.ts",
            producerFunction: "calculateMetricStressEnergyTensorRegionMeansFromShiftField",
            inputFieldRef: "warp.shiftVectorField.evaluateShiftVector",
            semanticQuantityRef: "warp.metric.required_t00.shift_field_eulerian",
            semanticQuantityKind: "metric_required_t00",
            physicalMeaningRef: "warp.metric.required_t00.eulerian_energy_density",
            comparisonRole: "metric_required_reference",
            expectedCounterpartRole: "tile_effective_counterpart",
            semanticEquivalenceExpected: true,
            reconstructionLayer: "shift_field_metric_tensor_reconstruction",
            assumptionBoundaryRef:
              "modules/warp/natario-warp.ts::calculateMetricStressEnergyTensorAtPointFromShiftField",
            semanticAlignmentNote:
              "Metric direct T00 is the reference-side metric-required quantity for same-basis source-closure comparison.",
            upstreamValueType: "derived_metric_tensor_component",
            constructionDomain: "brick_grid_metric_derivative_domain",
            constructionStage: "pre_aggregation_shift_field_tensorization",
            unitsRef: "J/m^3",
            preAggregationValueRef: "warp.metric.required_t00.samples",
            upstreamAssumptionNote:
              "Metric direct T00 is reconstructed from brick-grid shift-field derivatives before regional averaging.",
            maskClassifierRef: regionMaskRef,
            voxelAveragingMode: "unweighted_voxel_mean",
            derivativeSource: "shift_field_eulerian_t00",
            pressureProxyApplied: false,
            finiteDifferenceSource: "brick_grid_central_difference",
            samplingDomain: `brick_grid.region.${regionId}`,
            supportExclusionMode: "skip_nonfinite_derivative_cells",
            normalizationRef: "sample_count",
          }
        : null;
    const tileT00PathFacts: NonNullable<Nhm2SourceClosureV2RegionT00Trace["pathFacts"]> | null =
      tileMeanT00Resolved != null
        ? tileRegionDiagnostics?.meanT00 != null
          ? {
              producerModule: "server/stress-energy-brick.ts",
              producerFunction: "buildTensorRegionSummary",
              inputFieldRef: "gr.matter.stressEnergy.channels.t00",
              semanticQuantityRef: "gr.matter.brick.channel_t00.region_mean",
              semanticQuantityKind: "gr_matter_channel_t00",
              physicalMeaningRef: "gr.matter.channel_t00.sampled_region_mean",
              comparisonRole: "gr_matter_channel_observation",
              expectedCounterpartRole: "metric_required_reference",
              semanticEquivalenceExpected: false,
              reconstructionLayer: "gr_matter_channel_sampling",
              assumptionBoundaryRef:
                "server/stress-energy-brick.ts::buildTensorRegionSummary",
              semanticAlignmentNote:
                "Tile direct T00 is a sampled GR matter brick channel mean, not a tile-effective counterpart to the metric-required reference quantity.",
              upstreamValueType: "sampled_brick_channel_component",
              constructionDomain: "brick_grid_matter_channel_domain",
              constructionStage: "pre_aggregation_channel_sampling",
              unitsRef: "J/m^3",
              preAggregationValueRef: "gr.matter.stressEnergy.channels.t00",
              upstreamAssumptionNote:
                "Tile direct T00 is the region mean of sampled GR matter brick t00 channel values before pressure proxy reconstruction.",
              maskClassifierRef: regionMaskRef,
              voxelAveragingMode: "unweighted_voxel_mean",
              derivativeSource: "direct_region_voxel_t00_mean",
              pressureProxyApplied: false,
              finiteDifferenceSource: null,
              samplingDomain: `brick_grid.region.${regionId}`,
              supportExclusionMode: "region_mask_voxel_mean",
              normalizationRef: "sample_count",
            }
          : tileRegionTensor.T00 != null
            ? {
                producerModule: "server/energy-pipeline.ts",
                producerFunction: "resolveNhm2SourceClosureRegionComparisons",
                inputFieldRef: `${tileRegionTensorRef}.T00`,
                semanticQuantityRef: "gr.matter.brick.tensor_snapshot_t00",
                semanticQuantityKind: "tensor_snapshot_t00",
                physicalMeaningRef: "gr.matter.tensor_snapshot_t00",
                comparisonRole: "published_tensor_snapshot_observation",
                expectedCounterpartRole: "metric_required_reference",
                semanticEquivalenceExpected: false,
                reconstructionLayer: "tensor_snapshot_fallback",
                assumptionBoundaryRef:
                  "server/energy-pipeline.ts::resolveNhm2SourceClosureRegionComparisons",
                semanticAlignmentNote:
                  "Tile direct T00 falls back to a published tensor snapshot rather than a semantically aligned tile-effective comparison counterpart.",
                upstreamValueType: "published_tensor_snapshot_value",
                constructionDomain: "source_closure_artifact_snapshot_domain",
                constructionStage: "post_aggregation_snapshot_fallback",
                unitsRef: "J/m^3",
                preAggregationValueRef: `${tileRegionTensorRef}.T00`,
                upstreamAssumptionNote:
                  "Tile direct T00 falls back to the published tensor snapshot value when reducer-native region diagnostics are unavailable.",
                maskClassifierRef: regionMaskRef,
                voxelAveragingMode: "tensor_snapshot_direct_value",
                derivativeSource: "none",
                pressureProxyApplied: false,
                finiteDifferenceSource: null,
                samplingDomain: `brick_grid.region.${regionId}`,
                supportExclusionMode: "snapshot_only",
                normalizationRef:
                  asText(tileRegionDiagnostics?.normalizationBasis) ??
                  asText(tileRegionEntry?.normalizationBasis),
              }
            : null
        : null;
    const metricT00Trace: Nhm2SourceClosureV2RegionT00Trace | null =
      metricRegionTensor.T00 != null
        ? {
            regionMaskRef,
            sampleCount: metricSampleCount,
            normalizationBasis: "sample_count",
            aggregationMode: "mean",
            valueRef: metricT00SourceRef,
            tensorRef: metricRegionTensorRef,
            boundaryRef:
              "modules/warp/natario-warp.ts::calculateMetricStressEnergyTensorRegionMeansFromShiftField",
            maskNote: regionMaskNote,
            supportInclusionNote: metricAccounting.supportInclusionNote,
            traceStage: "region_mean_from_shift_field",
            pathFacts: metricT00PathFacts,
          }
        : null;
    const tileT00Trace: Nhm2SourceClosureV2RegionT00Trace | null =
      tileMeanT00Resolved != null
        ? {
            regionMaskRef,
            sampleCount: tileSampleCountResolved,
            normalizationBasis:
              asText(tileRegionDiagnostics?.normalizationBasis) ??
              asText(tileRegionEntry?.normalizationBasis),
            aggregationMode:
              (tileRegionDiagnostics?.aggregationMode as Nhm2SourceClosureV2RegionT00Diagnostics["aggregationMode"] | undefined) ??
              ((tileRegionEntry?.aggregationMode as Nhm2SourceClosureV2RegionT00Diagnostics["aggregationMode"] | undefined) ??
                "unknown"),
            valueRef: tileT00SourceRef,
            tensorRef: tileRegionTensorRef,
            boundaryRef:
              tileRegionDiagnostics?.meanT00 != null
                ? "server/stress-energy-brick.ts::buildTensorRegionSummary"
                : tileRegionTensor.T00 != null
                  ? "server/energy-pipeline.ts::resolveNhm2SourceClosureRegionComparisons"
                  : null,
            maskNote: regionMaskNote,
            supportInclusionNote: tileAccounting.supportInclusionNote,
            traceStage:
              tileRegionDiagnostics?.meanT00 != null
                ? "region_mean_from_gr_matter_brick"
                : tileRegionTensor.T00 != null
                  ? "tensor_snapshot_fallback"
                  : "unknown",
            pathFacts: tileT00PathFacts,
          }
        : null;
    const metricT00Diagnostics = buildT00Diagnostics({
      sampleCount: metricSampleCount,
      meanT00: metricRegionTensor.T00 ?? null,
      sumT00: null,
      sourceRef: metricT00SourceRef,
      derivationMode:
        metricRegionTensor.T00 != null
          ? "runtime_integrated_metric_region_mean"
          : "unknown",
      trace: metricT00Trace,
      normalizationBasis: "sample_count",
      aggregationMode: "mean",
      evidenceStatus:
        metricSampleCount != null && metricRegionTensor.T00 != null ? "inferred" : "unknown",
    });
    const tileT00Diagnostics = buildT00Diagnostics({
      sampleCount: tileSampleCountResolved,
      includedCount: tileIncludedCountResolved,
      skippedCount: tileSkippedCountResolved,
      nonFiniteCount: tileNonFiniteCountResolved,
      meanT00: tileMeanT00Resolved,
      sumT00: tileSumT00Resolved,
      sourceRef: tileT00SourceRef,
      derivationMode:
        tileRegionDiagnostics?.meanT00 != null
          ? "gr_matter_brick_region_mean"
          : tileRegionTensor.T00 != null
            ? "tensor_snapshot_inferred"
            : "unknown",
      trace: tileT00Trace,
      normalizationBasis:
        asText(tileRegionDiagnostics?.normalizationBasis) ??
        asText(tileRegionEntry?.normalizationBasis),
      aggregationMode:
        (tileRegionDiagnostics?.aggregationMode as Nhm2SourceClosureV2RegionT00Diagnostics["aggregationMode"] | undefined) ??
        ((tileRegionEntry?.aggregationMode as Nhm2SourceClosureV2RegionT00Diagnostics["aggregationMode"] | undefined) ?? "unknown"),
      evidenceStatus: tileEvidenceStatusResolved,
    });

    const tileProxyDiagnostics = buildTileProxyDiagnostics(tileRegionTensor);

    return {
      regionId,
      comparisonBasisStatus:
        metricTensorAvailable && tileTensorAvailable ? "same_basis" : "unavailable",
      metricTensorRef: metricRegionTensorRef,
      tileTensorRef: tileRegionTensorRef,
      metricRequiredTensor: metricRegionTensor,
      metricRequiredSameChartFullTensor,
      tileEffectiveTensor: tileRegionTensor,
      sampleCount,
      metricAccounting,
      tileAccounting,
      metricT00Diagnostics,
      tileT00Diagnostics,
      tileProxyDiagnostics,
      casimirMaterialReceipt:
        regionId === "wall" ? casimirMaterialReceipt : null,
      note: noteParts.join(" "),
    };
  });
};

const resolveNhm2SourceClosureTileEffectiveTensor = (
  state: EnergyPipelineState,
): {
  tileEffectiveTensor: Nhm2SourceClosureTensor | null;
  tileEffectiveTensorRef: string;
} => {
  const globalRegion = state.gr?.matter?.stressEnergy?.tensorSampledSummaries?.regions?.find(
    (region) => region.regionId === "global",
  );
  const globalRegionTensor = extractNhm2SourceClosureTensor(globalRegion?.tensor);
  if (globalRegionTensor != null) {
    return {
      tileEffectiveTensor: globalRegionTensor,
      tileEffectiveTensorRef: NHM2_SOURCE_CLOSURE_TILE_GLOBAL_SUMMARY_REF,
    };
  }

  const fallbackBrick = buildStressEnergyBrick({
    metricT00: toFiniteNumber((state as any)?.warp?.metricT00) ?? undefined,
    metricT00Ref: asText((state as any)?.warp?.metricT00Ref) ?? undefined,
    metricT00Source:
      asText((state as any)?.warp?.metricT00Source) ??
      asText((state as any)?.warp?.stressEnergySource) ??
      undefined,
    warpFieldType: "nhm2_shift_lapse",
  });
  const brickGlobalTensor = extractNhm2SourceClosureTensor(
    fallbackBrick.stats.tensorSampledSummaries?.regions?.find(
      (region) => region.regionId === "global",
    )?.tensor,
  );
  if (brickGlobalTensor != null) {
    return {
      tileEffectiveTensor: brickGlobalTensor,
      tileEffectiveTensorRef: NHM2_SOURCE_CLOSURE_TILE_GLOBAL_SUMMARY_REF,
    };
  }

  const fallbackTensor =
    extractNhm2SourceClosureTensor((state as any).warp?.tileEffectiveStressEnergy) ??
    extractNhm2SourceClosureTensor((state as any)?.tileEffectiveStressEnergy);
  return {
    tileEffectiveTensor: fallbackTensor,
    tileEffectiveTensorRef: "warp.tileEffectiveStressEnergy",
  };
};

const magnitudeVec3 = (value: [number, number, number]): number =>
  Math.hypot(value[0], value[1], value[2]);

const normalizeVec3OrNull = (
  value: [number, number, number] | null,
): [number, number, number] | null => {
  if (value == null) return null;
  const mag = magnitudeVec3(value);
  return mag > 1e-12
    ? ([value[0] / mag, value[1] / mag, value[2] / mag] as [
        number,
        number,
        number,
      ])
    : null;
};

const buildObserverConditionInput = (args: {
  eulerian: number;
  robust: number;
  direction: [number, number, number] | null;
  rapidity?: number | null;
  source: string;
}) => {
  const severityGain = args.robust - args.eulerian;
  return {
    eulerianMin: args.eulerian,
    eulerianMean: args.eulerian,
    robustMin: args.robust,
    robustMean: args.robust,
    eulerianViolationFraction: args.eulerian < 0 ? 1 : 0,
    robustViolationFraction: args.robust < 0 ? 1 : 0,
    missedViolationFraction: args.robust < 0 && args.eulerian >= 0 ? 1 : 0,
    severityGainMin: severityGain,
    severityGainMean: severityGain,
    maxRobustMinusEulerian: severityGain,
    worstCase: {
      index: 0,
      value: args.robust,
      direction: args.direction,
      rapidity:
        Number.isFinite(args.rapidity) && args.rapidity != null
          ? Number(args.rapidity)
          : null,
      source: args.source,
    },
  };
};

const buildDiagonalObserverConditions = (
  rho: number,
  px: number,
  py: number,
  pz: number,
): {
  conditions: NonNullable<BuildNhm2ObserverAuditTensorInput["conditions"]>;
  consistency: NonNullable<BuildNhm2ObserverAuditTensorInput["consistency"]>;
} => {
  const canonicalDir: [number, number, number] = [1, 0, 0];
  const pressures = [px, py, pz] as const;
  const axisDirs: [number, number, number][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const minPressureIndex = pressures.reduce(
    (best, value, index, all) => (value < all[best] ? index : best),
    0,
  );
  const maxAbsPressureIndex = pressures.reduce(
    (best, value, index, all) =>
      Math.abs(value) > Math.abs(all[best]) ? index : best,
    0,
  );
  const canonicalProjection =
    px * canonicalDir[0] * canonicalDir[0] +
    py * canonicalDir[1] * canonicalDir[1] +
    pz * canonicalDir[2] * canonicalDir[2];
  const trace = px + py + pz;
  const necRobust = rho + pressures[minPressureIndex];
  const necEulerian = rho + canonicalProjection;
  const wecRobust = Math.min(rho, necRobust);
  const secRobust = Math.min(rho + px, rho + py, rho + pz, rho + trace);
  const decRobust = Math.min(
    rho,
    rho - Math.abs(px),
    rho - Math.abs(py),
    rho - Math.abs(pz),
  );
  const secEulerian = 0.5 * (rho + trace);
  const maxRobustMinusEulerian = Math.max(
    necRobust - necEulerian,
    wecRobust - rho,
    secRobust - secEulerian,
    decRobust - rho,
  );

  return {
    conditions: {
      nec: buildObserverConditionInput({
        eulerian: necEulerian,
        robust: necRobust,
        direction: axisDirs[minPressureIndex],
        source: "algebraic_type_i",
      }),
      wec: buildObserverConditionInput({
        eulerian: rho,
        robust: wecRobust,
        direction: wecRobust === rho ? canonicalDir : axisDirs[minPressureIndex],
        source: "algebraic_type_i",
      }),
      sec: buildObserverConditionInput({
        eulerian: secEulerian,
        robust: secRobust,
        direction:
          secRobust === rho + trace ? canonicalDir : axisDirs[minPressureIndex],
        source: "algebraic_type_i",
      }),
      dec: buildObserverConditionInput({
        eulerian: rho,
        robust: decRobust,
        direction:
          decRobust === rho ? canonicalDir : axisDirs[maxAbsPressureIndex],
        source: "algebraic_type_i",
      }),
    },
    consistency: {
      robustNotGreaterThanEulerian: maxRobustMinusEulerian <= 1e-8,
      maxRobustMinusEulerian,
    },
  };
};

const buildDiagonalMetricObserverAuditTensorInput = (
  state: EnergyPipelineState,
  options: {
    t00Selection?: {
      admissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
      routeId: string | null;
      comparabilityStatus: "pass" | "fail" | "unknown";
      note: string | null;
    } | null;
  } = {},
): BuildNhm2ObserverAuditTensorInput => {
  const { warpState, metricT00Ref } = resolveNhm2ArtifactContext(state);
  const metricTensorRaw =
    ((warpState?.metricStressEnergy ??
      ((warpState?.metricT00Source === "metric" ||
      warpState?.stressEnergySource === "metric"
        ? warpState?.stressEnergyTensor
        : null) as Record<string, unknown> | null)) as
      | Record<string, unknown>
      | null) ?? null;
  const metricTensor =
    extractNhm2SourceClosureTensor(metricTensorRaw);
  const t00Selection = options.t00Selection ?? null;
  const einsteinRouteT00 = toFiniteNumber(metricTensorRaw?.T00_modelTermEinstein);
  const preferEinsteinT00ForObserver =
    t00Selection?.admissionStatus === "derivable_same_chart_from_existing_state" &&
    t00Selection?.comparabilityStatus === "pass";
  const fluxVector: [number, number, number] = [
    toFiniteNumber(metricTensorRaw?.T01) ?? Number.NaN,
    toFiniteNumber(metricTensorRaw?.T02) ?? Number.NaN,
    toFiniteNumber(metricTensorRaw?.T03) ?? Number.NaN,
  ];
  const offDiagonalResolved = {
    T12: toFiniteNumber(metricTensorRaw?.T12) ?? toFiniteNumber(metricTensorRaw?.T21),
    T13: toFiniteNumber(metricTensorRaw?.T13) ?? toFiniteNumber(metricTensorRaw?.T31),
    T23: toFiniteNumber(metricTensorRaw?.T23) ?? toFiniteNumber(metricTensorRaw?.T32),
  };
  const hasMetricT0iFamilies = fluxVector.every((value) => Number.isFinite(value));
  const hasMetricOffDiagonalFamilies = [
    offDiagonalResolved.T12,
    offDiagonalResolved.T13,
    offDiagonalResolved.T23,
  ].every((value) => value != null && Number.isFinite(value));
  const tensorRef = metricT00Ref ?? "warp.metricStressEnergy";
  const upstreamDriverRef = metricT00Ref ?? "warp.metricStressEnergy.T00";
  const rapidityCap =
    toFiniteNumber(
      (state.gr?.matter?.stressEnergy as StressEnergyStats | undefined)?.observerRobust?.rapidityCap,
    ) ?? 2.5;
  const rapidityCapBeta = Math.tanh(rapidityCap);
  const structuralMissing: string[] = [];
  if (!hasMetricT0iFamilies) structuralMissing.push("metric_t0i_missing");
  if (!hasMetricOffDiagonalFamilies) {
    structuralMissing.push("metric_tij_off_diagonal_missing");
  }
  if (preferEinsteinT00ForObserver && einsteinRouteT00 == null) {
    structuralMissing.push("metric_t00_einstein_route_missing");
  }
  const limitationNotes = [
    hasMetricT0iFamilies
      ? "Metric-required tensor now emits same-chart T0i channels from a model-term route; observer minima are still computed with the diagonal algebraic closure until anisotropic observer search admission is complete."
      : "Metric-required observer audit uses diagonal T_ab components only; T0i flux terms were not supplied and were treated as zero.",
    hasMetricOffDiagonalFamilies
      ? "Off-diagonal same-chart Tij channels are emitted from a reduced-order model-term route and remain semantically not admitted pending tensor-route closure."
      : "Off-diagonal spatial shear terms were unavailable, so this path is not a full anisotropic observer search.",
    preferEinsteinT00ForObserver
      ? einsteinRouteT00 != null
        ? `Observer rho uses admitted Einstein-route T00 channel (route=${t00Selection?.routeId ?? "unknown"}, comparability=${t00Selection?.comparabilityStatus ?? "unknown"}).`
        : `Einstein-route T00 was selected for observer rho, but no finite T00_modelTermEinstein payload was emitted (route=${t00Selection?.routeId ?? "unknown"}).`
      : "Observer rho uses legacy diagonal T00 until Einstein-route T00 admission and comparability are both satisfied.",
  ];
  const fluxMagnitude =
    hasMetricT0iFamilies
      ? Math.hypot(fluxVector[0], fluxVector[1], fluxVector[2])
      : 0;
  const fluxDirection = hasMetricT0iFamilies
    ? normalizeVec3OrNull(fluxVector)
    : null;

  if (metricTensor == null) {
    return {
      tensorRef,
      model: {
        pressureModel: "diagonal_tensor_components",
        fluxHandling: hasMetricT0iFamilies
          ? "same_chart_metric_t0i_emitted_experimental"
          : "assumed_zero_from_missing_t0i",
        shearHandling: hasMetricOffDiagonalFamilies
          ? "same_chart_metric_tij_off_diagonal_emitted_experimental"
          : "assumed_zero_from_missing_tij",
        limitationNotes,
        note:
          "Metric-required tensor was unavailable for observer audit; no diagonal or off-diagonal source tensor was emitted.",
      },
      fluxDiagnostics: {
        status: hasMetricT0iFamilies ? "available" : "unavailable",
        meanMagnitude: hasMetricT0iFamilies ? fluxMagnitude : null,
        maxMagnitude: hasMetricT0iFamilies ? fluxMagnitude : null,
        netMagnitude: hasMetricT0iFamilies ? fluxMagnitude : null,
        netDirection: hasMetricT0iFamilies ? fluxDirection : null,
        note: hasMetricT0iFamilies
          ? "Metric-required tensor object was missing, but same-chart T0i channels were present in the raw producer payload."
          : "Metric-required tensor unavailable.",
      },
      missingInputs: ["metric_tensor_missing", ...structuralMissing],
      upstreamDriverRef,
      upstreamDriverClass: "metric_t00_density",
      upstreamDriverDependencyStatus: "direct_same_surface_driver",
      upstreamDriverNote:
        "metric_required WEC traces directly to the emitted metric T00 density surface.",
      firstUpstreamRemediationTarget: upstreamDriverRef,
      firstUpstreamRemediationWhy:
        "Inspect the emitted metric T00 density because metric_required WEC reduces directly to rho on this surface.",
    };
  }

  const rho = preferEinsteinT00ForObserver
    ? (einsteinRouteT00 ?? metricTensor.T00)
    : metricTensor.T00;
  const px = metricTensor.T11;
  const py = metricTensor.T22;
  const pz = metricTensor.T33;
  const diagonalMissing: string[] = [];
  if (rho == null) diagonalMissing.push("metric_T00_missing");
  if (px == null) diagonalMissing.push("metric_T11_missing");
  if (py == null) diagonalMissing.push("metric_T22_missing");
  if (pz == null) diagonalMissing.push("metric_T33_missing");

  if (rho == null || px == null || py == null || pz == null) {
    return {
      tensorRef,
      sampleCount: 1,
      rapidityCap,
      rapidityCapBeta,
      model: {
        pressureModel: "diagonal_tensor_components",
        fluxHandling: hasMetricT0iFamilies
          ? "same_chart_metric_t0i_emitted_experimental"
          : "assumed_zero_from_missing_t0i",
        shearHandling: hasMetricOffDiagonalFamilies
          ? "same_chart_metric_tij_off_diagonal_emitted_experimental"
          : "assumed_zero_from_missing_tij",
        limitationNotes,
        note:
          "Metric-required tensor was emitted with incomplete diagonal components; observer minima could not be evaluated completely.",
      },
      fluxDiagnostics: {
        status: hasMetricT0iFamilies ? "available" : "assumed_zero",
        meanMagnitude: hasMetricT0iFamilies ? fluxMagnitude : 0,
        maxMagnitude: hasMetricT0iFamilies ? fluxMagnitude : 0,
        netMagnitude: hasMetricT0iFamilies ? fluxMagnitude : 0,
        netDirection: hasMetricT0iFamilies ? fluxDirection : null,
        note: hasMetricT0iFamilies
          ? "Flux magnitude uses emitted same-chart T0i channels from the model-term metric route."
          : "Flux magnitude was assumed zero because T0i terms were not supplied on the metric-required tensor path.",
      },
      missingInputs: [...diagonalMissing, ...structuralMissing],
      upstreamDriverRef,
      upstreamDriverClass: "metric_t00_density",
      upstreamDriverDependencyStatus: "direct_same_surface_driver",
      upstreamDriverNote:
        "metric_required WEC traces directly to the emitted metric T00 density surface.",
      firstUpstreamRemediationTarget: upstreamDriverRef,
      firstUpstreamRemediationWhy:
        "Inspect the emitted metric T00 density because metric_required WEC reduces directly to rho on this surface.",
    };
  }
  const diagonal = buildDiagonalObserverConditions(rho, px, py, pz);

  return {
    tensorRef,
    sampleCount: 1,
    rapidityCap,
    rapidityCapBeta,
    typeI: {
      count: 1,
      fraction: 1,
      tolerance: 0,
    },
    conditions: diagonal.conditions,
    fluxDiagnostics: {
      status: hasMetricT0iFamilies ? "available" : "assumed_zero",
      meanMagnitude: hasMetricT0iFamilies ? fluxMagnitude : 0,
      maxMagnitude: hasMetricT0iFamilies ? fluxMagnitude : 0,
      netMagnitude: hasMetricT0iFamilies ? fluxMagnitude : 0,
      netDirection: hasMetricT0iFamilies ? fluxDirection : null,
      note: hasMetricT0iFamilies
        ? "Flux diagnostics use emitted same-chart T0i channels from the metric producer model-term route."
        : "Flux magnitude was assumed zero because T0i terms were not supplied on the metric-required tensor path.",
    },
    consistency: diagonal.consistency,
    model: {
      pressureModel: "diagonal_tensor_components",
      fluxHandling: hasMetricT0iFamilies
        ? "same_chart_metric_t0i_emitted_experimental"
        : "assumed_zero_from_missing_t0i",
      shearHandling: hasMetricOffDiagonalFamilies
        ? "same_chart_metric_tij_off_diagonal_emitted_experimental"
        : "assumed_zero_from_missing_tij",
      limitationNotes,
      note: hasMetricT0iFamilies || hasMetricOffDiagonalFamilies
        ? "Diagonal observer conditions remain algebraic, while same-chart flux/shear channels are emitted through an experimental model-term route pending semantic admission."
        : "Diagonal metric tensor components were audited algebraically. This is explicit diagonal-only coverage, not a full anisotropic flux/shear observer sweep.",
    },
    missingInputs: structuralMissing,
    upstreamDriverRef,
    upstreamDriverClass: "metric_t00_density",
    upstreamDriverDependencyStatus: "direct_same_surface_driver",
    upstreamDriverNote:
      "metric_required WEC traces directly to the emitted metric T00 density surface.",
    firstUpstreamRemediationTarget: upstreamDriverRef,
    firstUpstreamRemediationWhy:
      "Inspect the emitted metric T00 density because metric_required WEC reduces directly to rho on this surface.",
  };
};

const NHM2_FULL_TENSOR_SEMANTICS_REF =
  "docs/audits/research/warp-nhm2-full-tensor-semantics-latest.md";
const NHM2_T0I_FAMILY_KEYS = ["T01", "T02", "T03"] as const;
const NHM2_OFF_DIAGONAL_TIJ_FAMILY_KEYS = [
  "T12",
  "T21",
  "T13",
  "T31",
  "T23",
  "T32",
] as const;
const NHM2_OFF_DIAGONAL_TIJ_CANONICAL_PAIRS = [
  ["T12", "T21"],
  ["T13", "T31"],
  ["T23", "T32"],
] as const;
const NHM2_EINSTEIN_COMPARE_CANONICAL_KEYS = [
  "T01",
  "T02",
  "T03",
  "T12",
  "T13",
  "T23",
] as const;
const NHM2_METRIC_PRODUCER_MODULE_REFS = [
  "modules/warp/natario-warp.ts::calculateMetricStressEnergyFromShiftField",
  "modules/warp/natario-warp.ts::calculateMetricStressEnergyTensorAtPointFromShiftField",
  "modules/warp/natario-warp.ts::calculateMetricStressEnergyTensorRegionMeansFromShiftField",
  "server/energy-pipeline.ts::buildDiagonalMetricObserverAuditTensorInput",
] as const;

type Nhm2MetricProducerSupportFieldEvidence =
  Nhm2ObserverMetricProducerAdmissionEvidence["supportFieldEvidence"];
type Nhm2MetricProducerEvidenceStatus =
  Nhm2MetricProducerSupportFieldEvidence[keyof Nhm2MetricProducerSupportFieldEvidence];

const isFiniteTriplet = (
  value: unknown,
): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  toFiniteNumber(value[0]) != null &&
  toFiniteNumber(value[1]) != null &&
  toFiniteNumber(value[2]) != null;

const NHM2_MODEL_TERM_EXPECTED_ROUTE_ID = "einstein_tensor_geometry_fd4_v1";
const NHM2_MODEL_TERM_LEGACY_ROUTE_ID = "adm_quasi_stationary_recovery_v1";
const NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID = "einstein_tensor_geometry_fd4_v1";
const NHM2_MODEL_TERM_CLOSURE_PATCH_BRIEF_REF =
  "docs/audits/research/warp-nhm2-semantic-closure-route-decision-brief-latest.md";
const NHM2_MODEL_TERM_CITATION_REFS = [
  NHM2_FULL_TENSOR_SEMANTICS_REF,
  "docs/audits/research/warp-nhm2-metric-evaluator-research-basis-latest.md",
  "https://people-lux.obspm.fr/gourgoulhon/pdf/form3p1.pdf",
  "https://arxiv.org/abs/gr-qc/0703035",
  "https://arxiv.org/abs/gr-qc/0110086",
  "https://einsteintoolkit.org/thornguide/EinsteinBase/TmunuBase/documentation.html",
  "https://arxiv.org/abs/gr-qc/0507004",
  "https://arxiv.org/abs/1306.6052",
  "https://arxiv.org/abs/2404.03095",
  "https://arxiv.org/abs/2404.10855",
  "https://arxiv.org/abs/2602.18023",
] as const;
const NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS = [
  "https://people-lux.obspm.fr/gourgoulhon/pdf/form3p1.pdf",
  "https://arxiv.org/abs/gr-qc/0703035",
  "https://arxiv.org/abs/gr-qc/0110086",
  "https://einsteintoolkit.org/thornguide/EinsteinBase/TmunuBase/documentation.html",
  "https://arxiv.org/abs/gr-qc/0507004",
  "https://arxiv.org/abs/1306.6052",
  "https://arxiv.org/abs/2404.03095",
  "https://arxiv.org/abs/2404.10855",
  "https://arxiv.org/abs/2602.18023",
] as const;
const NHM2_DEC_REMEDIATION_WEB_CITATION_REFS = [
  "https://arxiv.org/abs/1702.05915",
  "https://arxiv.org/abs/2003.01815",
] as const;
const NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS = [
  "https://arxiv.org/abs/1405.0403",
  "https://arxiv.org/abs/2105.03079",
  "https://arxiv.org/abs/1208.5399",
  "https://arxiv.org/abs/gr-qc/9607003",
  "https://arxiv.org/abs/gr-qc/9805037",
] as const;
const NHM2_DEC_PHYSICS_UNCERTAINTY_WEB_CITATION_REFS = [
  "https://www.osti.gov/biblio/6817347",
  "https://arxiv.org/abs/1306.6052",
] as const;
const NHM2_DEC_PHYSICS_RUNTIME_MIN_COMPARABLE_SAMPLE_COUNT = 3;
const NHM2_DEC_PHYSICS_RUNTIME_UNCERTAINTY_RELATIVE_MARGIN_FLOOR = 1e-6;
const NHM2_DEC_PHYSICS_RUNTIME_SIGN_EPSILON = 1e-12;
const NHM2_DEC_PHYSICS_CONTROL_CLAIM_CITATION_MAP = [
  {
    claimId: "same_chart_projection_grammar_required",
    claim:
      "Observer-condition controls are evaluated on a same-chart stress-energy grammar where E, J_i, and S_ij are projections of a single tensor field.",
    citationRefs: [
      "https://people-lux.obspm.fr/gourgoulhon/pdf/form3p1.pdf",
      "https://arxiv.org/abs/gr-qc/0703035",
      "docs/audits/research/warp-nhm2-full-tensor-semantics-latest.md",
    ],
    note:
      "Maintains same-chart semantics while exploring DEC controls; avoids stitched cross-chart placeholders.",
  },
  {
    claimId: "geometry_first_route_is_control_basis",
    claim:
      "DEC-control probes are evaluated on the admitted geometry-first Einstein route and retained only when comparability and independent cross-check gates stay pass-level.",
    citationRefs: [
      "https://arxiv.org/abs/gr-qc/0110086",
      "https://arxiv.org/abs/gr-qc/0507004",
      "https://einsteintoolkit.org/thornguide/EinsteinBase/TmunuBase/documentation.html",
      "https://arxiv.org/abs/2404.03095",
      "https://arxiv.org/abs/2404.10855",
      "docs/audits/research/warp-nhm2-metric-evaluator-research-basis-latest.md",
    ],
    note:
      "Treats stress-energy as geometry-derived on the selected route before observer-condition diagnostics.",
  },
  {
    claimId: "bounded_probe_non_regression_policy",
    claim:
      "Candidate selection keeps observer-domain bounds fixed and requires WEC/NEC non-regression with positive robust DEC lift before any runtime application recommendation.",
    citationRefs: [
      "https://arxiv.org/abs/1702.05915",
      "https://arxiv.org/abs/2003.01815",
      "https://arxiv.org/abs/1208.5399",
      "https://arxiv.org/abs/gr-qc/9607003",
      "https://arxiv.org/abs/gr-qc/9805037",
      "docs/audits/research/warp-nhm2-semantic-closure-route-decision-brief-latest.md",
    ],
    note:
      "Excludes observer-domain truncation from physical-control admission and keeps the candidate proposal-only until runtime revalidation.",
  },
  {
    claimId: "comparability_requires_commensurate_sample_evidence",
    claim:
      "Runtime application requires commensurate Einstein-route evidence with explicit independent-cross-check parity and a minimum comparable sample-count threshold before an applied decision is allowed.",
    citationRefs: [
      "https://arxiv.org/abs/gr-qc/0507004",
      "https://arxiv.org/abs/1306.6052",
      "https://arxiv.org/abs/2404.10855",
      "docs/audits/research/warp-nhm2-metric-evaluator-research-basis-latest.md",
    ],
    note:
      "Separates route comparability from single-sample observer outputs and keeps runtime-apply decisions tied to reproducible cross-check evidence.",
  },
  {
    claimId: "runtime_uncertainty_sign_guard_required",
    claim:
      "Runtime apply decisions require sign-consistent independent cross-check evidence and uncertainty-conservative DEC margin positivity on both selected and reference routes.",
    citationRefs: [
      "https://arxiv.org/abs/gr-qc/0507004",
      "https://arxiv.org/abs/1306.6052",
      "https://arxiv.org/abs/2404.10855",
      "https://arxiv.org/abs/2602.18023",
      "docs/audits/research/warp-nhm2-metric-evaluator-research-basis-latest.md",
    ],
    note:
      "Prevents runtime apply from relying on raw-metric sign flips or uncertainty-blind margins when independent route evidence is available.",
  },
  {
    claimId: "uncertainty_reporting_requires_refinement_evidence",
    claim:
      "Uncertainty-sensitive DEC runtime decisions should include refinement-aware or convergence-aware reporting so conservative margin signs are not inferred from a single unresolved discretization level.",
    citationRefs: [
      "https://www.osti.gov/biblio/6817347",
      "https://arxiv.org/abs/1306.6052",
      "docs/audits/research/warp-nhm2-metric-evaluator-research-basis-latest.md",
    ],
    note:
      "Uses V&V-style convergence-reporting precedent to keep DEC sign decisions tied to uncertainty-aware evidence.",
  },
  {
    claimId: "model_term_extension_family_selection_requires_commensurate_evidence",
    claim:
      "When bounded DEC controls fail to cross zero, follow-up model-term families are ranked only on commensurate same-route evidence under unchanged non-regression and comparability gates.",
    citationRefs: [
      "https://arxiv.org/abs/gr-qc/0507004",
      "https://arxiv.org/abs/1306.6052",
      "https://arxiv.org/abs/2404.10855",
      "https://arxiv.org/abs/2602.18023",
      "docs/audits/research/warp-nhm2-semantic-closure-route-decision-brief-latest.md",
    ],
    note:
      "Prevents model-term follow-up routing from being chosen by non-comparable or route-mismatched evidence.",
  },
] as const;
const NHM2_DEC_PHYSICS_CONTROL_RESEARCH_SUPPORT_MAP = {
  same_chart_projection_grammar_required: {
    supportLevel: "primary_source",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.claimCitationMap[same_chart_projection_grammar_required]",
      "observerDecPhysicsControlEvidence.decCoupledControlEvidence.researchClaims[same_chart_projection_grammar_required]",
      "observerDecPhysicsControlEvidence.crossZeroFeasibilityEvidence.evaluationRoute",
    ],
    note:
      "Backed by accepted 3+1 projection grammar sources and mirrored by same-chart route metadata in the current audit evidence.",
  },
  geometry_first_route_is_control_basis: {
    supportLevel: "primary_source",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.claimCitationMap[geometry_first_route_is_control_basis]",
      "observerDecPhysicsControlEvidence.decCoupledControlEvidence.researchClaims[geometry_first_route_is_control_basis]",
      "observerDecPhysicsControlEvidence.runtimeApplication.comparabilityGate",
    ],
    note:
      "Backed by geometry-first stress-energy references plus route/chart parity checks on the selected Einstein path.",
  },
  bounded_probe_non_regression_policy: {
    supportLevel: "repo_measurement",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.selectionReasonCodes",
      "observerDecPhysicsControlEvidence.nonRegressionGate",
      "observerDecPhysicsControlEvidence.runtimeApplication.guardChecks",
      "observerDecPhysicsControlEvidence.sweepCandidates",
    ],
    note:
      "Policy is literature-aligned and operationalized by measured gate outcomes from the bounded candidate sweep.",
  },
  comparability_requires_commensurate_sample_evidence: {
    supportLevel: "repo_measurement",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.runtimeApplication.comparabilityGate",
      "observerDecPhysicsControlEvidence.runtimeApplication.sampleCount",
      "observerDecPhysicsControlEvidence.runtimeApplication.comparableSampleCount",
      "observerDecPhysicsControlEvidence.runtimeApplication.minimumComparableSampleCount",
    ],
    note:
      "Comparability is backed by explicit sample-count thresholds and independent-cross-check parity observed in runtime evidence.",
  },
  runtime_uncertainty_sign_guard_required: {
    supportLevel: "repo_measurement",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.runtimeApplication.guardChecks.independentCrossCheckSignAgreement",
      "observerDecPhysicsControlEvidence.runtimeApplication.guardChecks.uncertaintyBoundPass",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.metricDecConservativeMarginToZero",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.tileReconstitutedDecConservativeMarginToZero",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.referenceMetricDecConservativeMarginToZero",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.referenceTileReconstitutedDecConservativeMarginToZero",
      "observerDecPhysicsControlEvidence.decRuntimeDecisionEvidence.decAttribution",
    ],
    note:
      "Runtime decision evidence is attributed to selected/reference margin signs and uncertainty-conservative thresholds, not raw point estimates alone.",
  },
  uncertainty_reporting_requires_refinement_evidence: {
    supportLevel: "primary_source",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.refinementEvidence.status",
      "observerDecPhysicsControlEvidence.refinementEvidence.coarseStepM",
      "observerDecPhysicsControlEvidence.refinementEvidence.refinedStepM",
      "observerDecPhysicsControlEvidence.refinementEvidence.superRefinedStepM",
      "observerDecPhysicsControlEvidence.refinementEvidence.richardsonExtrapolatedResidualT0i",
      "observerDecPhysicsControlEvidence.refinementEvidence.richardsonExtrapolatedResidualOffDiagonal",
      "observerDecPhysicsControlEvidence.refinementEvidence.uncertaintyRelativeBound",
      "observerDecPhysicsControlEvidence.refinementEvidence.conservativeMetricDecMarginToZero",
      "observerDecPhysicsControlEvidence.refinementEvidence.conservativeTileReconstitutedDecMarginToZero",
      "observerDecPhysicsControlEvidence.refinementEvidence.uncertaintyBoundPass",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.metricDecUncertaintyAbs",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.tileReconstitutedDecUncertaintyAbs",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.metricDecConservativeMarginToZero",
      "observerDecPhysicsControlEvidence.runtimeApplication.observed.tileReconstitutedDecConservativeMarginToZero",
      "observerDecPhysicsControlEvidence.decRuntimeDecisionEvidence.decAttribution.uncertaintyRelativeBound",
    ],
    note:
      "Uncertainty-bound attribution is tied to published convergence-reporting references and explicit conservative-margin evidence.",
  },
  model_term_extension_family_selection_requires_commensurate_evidence: {
    supportLevel: "repo_measurement",
    evidenceRefs: [
      "observerDecPhysicsControlEvidence.modelTermExtensionFamilyEvidence",
      "observerDecPhysicsControlEvidence.modelTermExtensionFamilyEvidence.comparabilityGate",
      "observerDecPhysicsControlEvidence.modelTermExtensionFamilyEvidence.families",
    ],
    note:
      "Model-term extension-family ranking is localized to same-route comparable evidence after bounded sweep exhaustion.",
  },
} as const;
const NHM2_DEC_PHYSICS_RUNTIME_APPLY_ENV =
  "NHM2_DEC_PHYSICS_CONTROL_RUNTIME_APPLY";
const NHM2_MODEL_TERM_REASON_ORDER = [
  "route_metadata_missing_or_mismatched",
  "chart_not_comoving_cartesian",
  "non_finite_tensor_components",
  "t0i_symmetry_failed",
  "off_diagonal_symmetry_failed",
  "finite_difference_convergence_missing",
  "finite_difference_convergence_failed",
  "independent_cross_check_missing",
  "independent_cross_check_failed_threshold",
  "dt_gamma_assumption_unbounded",
  "support_field_route_not_admitted",
  "full_einstein_tensor_route_not_admitted",
  "citation_basis_missing",
  "citation_coverage_incomplete",
] as const;

const isNhm2DecPhysicsRuntimeApplyEnabled = (): boolean => {
  const raw = process.env[NHM2_DEC_PHYSICS_RUNTIME_APPLY_ENV];
  if (raw == null) return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};
const NHM2_MODEL_TERM_SYMMETRY_EPSILON = 1e-12;
const NHM2_MODEL_TERM_DT_GAMMA_THETA_MAX = 1e-6;
const NHM2_MODEL_TERM_EINSTEIN_VALIDATION_ZERO_RESIDUAL_THRESHOLD = 1e-9;
const NHM2_MODEL_TERM_EINSTEIN_VALIDATION_CASE_ORDER = [
  "minkowski_zero_shift",
  "constant_shift_flat_space",
] as const;
const NHM2_MODEL_TERM_CITATION_CONTENT_CACHE = new Map<string, string | null>();

const toModelTermSemanticAdmission = (
  value: string | null,
): Nhm2ObserverModelTermSemanticAdmissionEvidence["routeAdmission"] => {
  if (value === "admitted") return "admitted";
  if (value === "experimental_not_admitted") return "experimental_not_admitted";
  return "unknown";
};

const isTensorComponentFinite = (
  tensor: Record<string, unknown> | null,
  key: string,
): boolean => toFiniteNumber(tensor?.[key]) != null;

const isSymmetricPair = (
  tensor: Record<string, unknown> | null,
  a: string,
  b: string,
): boolean => {
  const lhs = toFiniteNumber(tensor?.[a]);
  const rhs = toFiniteNumber(tensor?.[b]);
  return (
    lhs != null &&
    rhs != null &&
    Math.abs(lhs - rhs) <= NHM2_MODEL_TERM_SYMMETRY_EPSILON
  );
};

const sortModelTermReasonCodes = (
  reasonCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"],
): Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"] =>
  Array.from(new Set(reasonCodes)).sort(
    (lhs, rhs) =>
      NHM2_MODEL_TERM_REASON_ORDER.indexOf(lhs) -
      NHM2_MODEL_TERM_REASON_ORDER.indexOf(rhs),
  );

const resolveRouteScopedModelTermReasonCodes = (args: {
  selectedPath: Nhm2ObserverModelTermClosurePath;
  reasonCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"];
}): {
  blockerCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"];
  nonBlockingCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"];
  suppressedOutOfPathCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"];
} => {
  const fullSet = sortModelTermReasonCodes(args.reasonCodes);
  const suppressedOutOfPathCodes = fullSet.filter((code) => {
    if (
      args.selectedPath === "full_einstein_tensor" &&
      code === "support_field_route_not_admitted"
    ) {
      return true;
    }
    if (
      args.selectedPath === "adm_complete" &&
      code === "full_einstein_tensor_route_not_admitted"
    ) {
      return true;
    }
    return false;
  });
  const routeScopedSet = fullSet.filter(
    (code) => !suppressedOutOfPathCodes.includes(code),
  );
  const blockerCodes = routeScopedSet;
  const nonBlockingCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"] =
    [];
  return {
    blockerCodes: sortModelTermReasonCodes(blockerCodes),
    nonBlockingCodes: sortModelTermReasonCodes(nonBlockingCodes),
    suppressedOutOfPathCodes: sortModelTermReasonCodes(suppressedOutOfPathCodes),
  };
};

const loadCachedCitationContent = (pathRef: string): string | null => {
  if (NHM2_MODEL_TERM_CITATION_CONTENT_CACHE.has(pathRef)) {
    return NHM2_MODEL_TERM_CITATION_CONTENT_CACHE.get(pathRef) ?? null;
  }
  const absolutePath = path.isAbsolute(pathRef)
    ? pathRef
    : path.join(process.cwd(), pathRef);
  try {
    const raw = fs.readFileSync(absolutePath, "utf8");
    NHM2_MODEL_TERM_CITATION_CONTENT_CACHE.set(pathRef, raw);
    return raw;
  } catch {
    NHM2_MODEL_TERM_CITATION_CONTENT_CACHE.set(pathRef, null);
    return null;
  }
};

const resolveResearchBasisCitationCoverage = (researchBasisRef: string | null) => {
  if (researchBasisRef == null) {
    return {
      status: "fail" as const,
      missingRefs: [...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS],
    };
  }
  const content = loadCachedCitationContent(researchBasisRef);
  if (content == null) {
    return {
      status: "unknown" as const,
      missingRefs: [...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS],
    };
  }
  const missingRefs = NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS.filter(
    (ref) => !content.includes(ref),
  );
  return {
    status: missingRefs.length === 0 ? ("pass" as const) : ("fail" as const),
    missingRefs,
  };
};

const buildEinsteinRouteValidationSuite = (): NonNullable<
  Nhm2ObserverModelTermSemanticAdmissionEvidence["einsteinRouteValidationSuite"]
> => {
  type ValidationCaseId =
    (typeof NHM2_MODEL_TERM_EINSTEIN_VALIDATION_CASE_ORDER)[number];
  const coreCitationRefs = [
    "https://people-lux.obspm.fr/gourgoulhon/pdf/form3p1.pdf",
    "https://arxiv.org/abs/gr-qc/0703035",
    "https://einsteintoolkit.org/thornguide/EinsteinBase/TmunuBase/documentation.html",
    "https://arxiv.org/abs/2404.03095",
    "https://arxiv.org/abs/2404.10855",
    "https://arxiv.org/abs/2602.18023",
  ];
  const caseDefs: Array<{
    caseId: ValidationCaseId;
    shiftEvaluator: (x: number, y: number, z: number) => [number, number, number];
    points: Array<[number, number, number]>;
    note: string;
  }> = [
    {
      caseId: "minkowski_zero_shift",
      shiftEvaluator: () => [0, 0, 0],
      points: [
        [0, 0, 0],
        [0.5, -0.25, 0.75],
      ],
      note: "Flat-space zero-shift sanity case; Einstein-route tensor should be near zero.",
    },
    {
      caseId: "constant_shift_flat_space",
      shiftEvaluator: () => [0.125, -0.05, 0.02],
      points: [
        [0.25, -0.5, 0.75],
        [1.1, -0.4, 0.3],
      ],
      note: "Constant shift on flat metric is a coordinate transform; stress-energy should remain near zero.",
    },
  ];
  const tensorKeys = [
    "T00",
    "T11",
    "T22",
    "T33",
    ...NHM2_EINSTEIN_COMPARE_CANONICAL_KEYS,
  ];
  const cases = caseDefs.map((definition) => {
    let maxAbsResidual = -Infinity;
    let sampleCount = 0;
    let finiteTensorCount = 0;
    for (const point of definition.points) {
      const resolved = calculateMetricStressEnergyTensorAtPointFromShiftField(
        definition.shiftEvaluator,
        point,
        {
          derivativeStep_m: 0.05,
          scale_m: 1,
          modelTermRoutePreference: "einstein_only",
        },
      );
      if (resolved?.stress == null) {
        continue;
      }
      sampleCount += 1;
      for (const key of tensorKeys) {
        const value = toFiniteNumber(
          (resolved.stress as Record<string, unknown>)[key],
        );
        if (value == null) {
          continue;
        }
        finiteTensorCount += 1;
        maxAbsResidual = Math.max(maxAbsResidual, Math.abs(value));
      }
    }
    const hasFiniteResidual =
      sampleCount > 0 &&
      finiteTensorCount > 0 &&
      Number.isFinite(maxAbsResidual);
    const status: Nhm2ObserverModelTermSemanticAdmissionEvidence["checks"]["fullEinsteinTensorRouteAdmission"] =
      hasFiniteResidual
        ? maxAbsResidual <= NHM2_MODEL_TERM_EINSTEIN_VALIDATION_ZERO_RESIDUAL_THRESHOLD
          ? "pass"
          : "fail"
        : "unknown";
    return {
      caseId: definition.caseId,
      status,
      maxAbsResidual: hasFiniteResidual ? maxAbsResidual : null,
      expectedNearZero: true,
      note:
        status === "pass"
          ? `${definition.note} maxAbsResidual=${maxAbsResidual.toExponential(6)} within threshold ${NHM2_MODEL_TERM_EINSTEIN_VALIDATION_ZERO_RESIDUAL_THRESHOLD.toExponential(3)}.`
          : status === "fail"
            ? `${definition.note} maxAbsResidual=${maxAbsResidual.toExponential(6)} exceeds threshold ${NHM2_MODEL_TERM_EINSTEIN_VALIDATION_ZERO_RESIDUAL_THRESHOLD.toExponential(3)}.`
            : `${definition.note} no finite Einstein-route tensor sample was produced.`,
      citationRefs: [...coreCitationRefs],
    };
  });
  const evaluatedCaseCount = cases.filter((entry) => entry.status !== "unknown").length;
  const passedCaseCount = cases.filter((entry) => entry.status === "pass").length;
  const suiteStatus: Nhm2ObserverModelTermSemanticAdmissionEvidence["checks"]["fullEinsteinTensorRouteAdmission"] =
    evaluatedCaseCount === 0
      ? "unknown"
      : passedCaseCount === cases.length
        ? "pass"
        : "fail";
  return {
    status: suiteStatus,
    admittedForRoutePass: suiteStatus === "pass",
    residualThreshold: NHM2_MODEL_TERM_EINSTEIN_VALIDATION_ZERO_RESIDUAL_THRESHOLD,
    evaluatedCaseCount,
    passedCaseCount,
    cases,
    note:
      suiteStatus === "pass"
        ? "Independent Einstein-route near-zero sanity suite passed for flat-space control cases."
        : suiteStatus === "fail"
          ? "Independent Einstein-route near-zero sanity suite failed at one or more flat-space control cases."
          : "Independent Einstein-route near-zero sanity suite is inconclusive.",
    citationRefs: [...coreCitationRefs],
  };
};

const deriveNhm2ModelTermClosurePathDecision = (args: {
  routeId: string | null;
  checks: Nhm2ObserverModelTermSemanticAdmissionEvidence["checks"];
  reasonCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"];
  effectiveEinsteinCrossCheckStatus: "available" | "missing" | "unknown";
  einsteinTensorRouteId: string | null;
  researchBasisRef: string | null;
  citationRefs: string[];
}): NonNullable<Nhm2ObserverModelTermSemanticAdmissionEvidence["closurePathDecision"]> => {
  const routeHint:
    | "adm_route_metadata"
    | "einstein_route_metadata"
    | "none" =
    args.routeId === NHM2_MODEL_TERM_EXPECTED_ROUTE_ID
      ? "einstein_route_metadata"
      : args.routeId === NHM2_MODEL_TERM_LEGACY_ROUTE_ID
        ? "adm_route_metadata"
        : "none";
  const admPathStatus = args.checks.supportFieldRouteAdmission;
  const fullEinsteinPathStatus = args.checks.fullEinsteinTensorRouteAdmission;
  const einsteinRoutePreferredByEvidence =
    args.effectiveEinsteinCrossCheckStatus === "available" &&
    (args.einsteinTensorRouteId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
      args.routeId === NHM2_MODEL_TERM_EXPECTED_ROUTE_ID);

  let selectedPath: "adm_complete" | "full_einstein_tensor" | "undecided" =
    "undecided";
  let nextPatchClass:
    | "adm_support_field_admission_patch"
    | "einstein_semantic_closure_patch"
    | "evidence_disambiguation_patch" = "evidence_disambiguation_patch";
  let rationale: string =
    "Route evidence remains mixed, so collect disambiguating semantic-closure evidence before committing to ADM-complete or full Einstein paths.";

  if (admPathStatus === "pass" && fullEinsteinPathStatus !== "pass") {
    selectedPath = "adm_complete";
    nextPatchClass = "adm_support_field_admission_patch";
    rationale =
      "ADM support-field route is admitted while full Einstein route is not admitted; continue with ADM-complete support-field closure.";
  } else if (fullEinsteinPathStatus === "pass" && admPathStatus !== "pass") {
    selectedPath = "full_einstein_tensor";
    nextPatchClass = "einstein_semantic_closure_patch";
    rationale =
      "Full Einstein-tensor route is admitted while ADM support-field route is not admitted; continue with Einstein-route semantic closure.";
  } else if (admPathStatus === "pass" && fullEinsteinPathStatus === "pass") {
    if (routeHint === "adm_route_metadata") {
      selectedPath = "adm_complete";
      nextPatchClass = "adm_support_field_admission_patch";
      rationale =
        "Both routes are admitted, but runtime route metadata currently points to ADM; close remaining semantics on the ADM-complete path.";
    } else {
      selectedPath = "full_einstein_tensor";
      nextPatchClass = "einstein_semantic_closure_patch";
      rationale =
        "Both routes are admitted, and route metadata or precedent prefers geometry-first Einstein routing for semantic closure.";
    }
  } else if (routeHint === "einstein_route_metadata" || einsteinRoutePreferredByEvidence) {
    selectedPath = "full_einstein_tensor";
    nextPatchClass = "einstein_semantic_closure_patch";
    if (routeHint === "einstein_route_metadata" && einsteinRoutePreferredByEvidence) {
      rationale =
        "Route metadata and available independent Einstein cross-check evidence favor the full Einstein-tensor semantic-closure path.";
    } else if (einsteinRoutePreferredByEvidence) {
      rationale =
        "Available independent Einstein cross-check evidence favors the full Einstein-tensor semantic-closure path.";
    } else {
      rationale =
        "Route metadata points to geometry-first Einstein routing; keep the full Einstein semantic-closure path while independent cross-check and convergence blockers are unresolved.";
    }
  } else if (routeHint === "adm_route_metadata") {
    selectedPath = "adm_complete";
    nextPatchClass = "adm_support_field_admission_patch";
    rationale =
      "Route metadata points to ADM with no stronger Einstein preference signal; continue with ADM-complete semantic closure.";
  }

  const citationRefs = Array.from(
    new Set(
      [
        NHM2_FULL_TENSOR_SEMANTICS_REF,
        args.researchBasisRef,
        NHM2_MODEL_TERM_CLOSURE_PATCH_BRIEF_REF,
        ...args.citationRefs,
      ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  );
  const routeScopedReasonCodes = resolveRouteScopedModelTermReasonCodes({
    selectedPath,
    reasonCodes: args.reasonCodes,
  });
  const scopedBlockers =
    routeScopedReasonCodes.blockerCodes.length > 0
      ? routeScopedReasonCodes.blockerCodes.join(",")
      : "none";
  const scopedNonBlockers =
    routeScopedReasonCodes.nonBlockingCodes.length > 0
      ? routeScopedReasonCodes.nonBlockingCodes.join(",")
      : "none";
  const scopedSuppressedOutOfPath =
    routeScopedReasonCodes.suppressedOutOfPathCodes.length > 0
      ? routeScopedReasonCodes.suppressedOutOfPathCodes.join(",")
      : "none";

  return {
    selectedPath,
    admPathStatus,
    fullEinsteinPathStatus,
    routeHint,
    nextPatchClass,
    patchBriefRef: NHM2_MODEL_TERM_CLOSURE_PATCH_BRIEF_REF,
    rationale,
    blockerCodes: routeScopedReasonCodes.blockerCodes,
    nonBlockingCodes: routeScopedReasonCodes.nonBlockingCodes,
    citationRefs,
    notes: [
      `routeId=${args.routeId ?? "unknown"}`,
      `routeHint=${routeHint}`,
      `admPathStatus=${admPathStatus}`,
      `fullEinsteinPathStatus=${fullEinsteinPathStatus}`,
      `einsteinCrossCheckStatus=${args.effectiveEinsteinCrossCheckStatus}`,
      `einsteinTensorRouteId=${args.einsteinTensorRouteId ?? "none"}`,
      `selectedPath=${selectedPath}`,
      `nextPatchClass=${nextPatchClass}`,
      `selectedPath.blockerCodes=${scopedBlockers}`,
      `selectedPath.nonBlockingCodes=${scopedNonBlockers}`,
      `selectedPath.suppressedOutOfPathCodes=${scopedSuppressedOutOfPath}`,
    ],
  };
};

const deriveNhm2ModelTermSemanticAdmissionEvidence = (args: {
  state: EnergyPipelineState;
  producerEvidence: Nhm2ObserverMetricProducerAdmissionEvidence;
  metricRequiredTensorInput: BuildNhm2ObserverAuditTensorInput;
}): Nhm2ObserverModelTermSemanticAdmissionEvidence => {
  const { warpState, adapter } = resolveNhm2ArtifactContext(args.state);
  const metricStressRaw = (warpState?.metricStressEnergy ??
    null) as Record<string, unknown> | null;
  const metricStressDiagnostics = (warpState?.metricStressDiagnostics ??
    null) as Record<string, unknown> | null;
  const uncertaintyDiagnostics = (metricStressDiagnostics?.modelTermUncertainty ??
    null) as Record<string, unknown> | null;
  const finiteDifferenceDiagnostics = (uncertaintyDiagnostics?.finiteDifferenceConvergence ??
    null) as Record<string, unknown> | null;
  const einsteinTensorRouteDiagnostics = (uncertaintyDiagnostics?.einsteinTensorRoute ??
    null) as Record<string, unknown> | null;
  const residualAttributionDiagnostics =
    (uncertaintyDiagnostics?.einsteinResidualAttribution ??
      null) as Record<string, unknown> | null;
  const evaluatorClosureDiagnostics =
    (uncertaintyDiagnostics?.einsteinEvaluatorClosure ??
      null) as Record<string, unknown> | null;
  const independentCrossCheckDiagnostics = (uncertaintyDiagnostics?.independentCrossCheck ??
    null) as Record<string, unknown> | null;
  const routeId = asText(metricStressRaw?.modelTermRoute);
  const routeAdmissionRaw = toModelTermSemanticAdmission(
    asText(metricStressRaw?.modelTermAdmission),
  );
  const chartRef =
    args.producerEvidence.chartRef ??
    (typeof adapter?.chart?.label === "string" ? adapter.chart.label : null);
  const researchBasisRef = asText(metricStressRaw?.researchBasisRef);
  const reasonCodes: Nhm2ObserverModelTermSemanticAdmissionEvidence["reasonCodes"] =
    [];
  const checks: Nhm2ObserverModelTermSemanticAdmissionEvidence["checks"] = {
    routeMetadata: "unknown",
    chart: "unknown",
    finiteTensorComponents: "unknown",
    t0iSymmetry: "unknown",
    offDiagonalTijSymmetry: "unknown",
    supportFieldRouteAdmission: "unknown",
    fullEinsteinTensorRouteAdmission: "unknown",
    citationBasis: "unknown",
    finiteDifferenceConvergence: "unknown",
    independentCrossCheck: "unknown",
    einsteinT00Comparability: "unknown",
    dtGammaAssumptionBounded: "unknown",
    citationCoverage: "unknown",
  };

  const routeMetadataPass =
    routeId != null &&
    routeId.length > 0 &&
    routeAdmissionRaw !== "unknown" &&
    (routeId === NHM2_MODEL_TERM_EXPECTED_ROUTE_ID ||
      routeId === NHM2_MODEL_TERM_LEGACY_ROUTE_ID);
  checks.routeMetadata = routeMetadataPass ? "pass" : "fail";
  if (!routeMetadataPass) {
    reasonCodes.push("route_metadata_missing_or_mismatched");
  }

  const chartPass = chartRef === "comoving_cartesian";
  checks.chart = chartPass ? "pass" : "fail";
  if (!chartPass) {
    reasonCodes.push("chart_not_comoving_cartesian");
  }

  const requiredFiniteKeys = [
    "T00",
    "T11",
    "T22",
    "T33",
    ...NHM2_T0I_FAMILY_KEYS,
    ...NHM2_OFF_DIAGONAL_TIJ_FAMILY_KEYS,
  ];
  const finiteTensorComponentsPass = requiredFiniteKeys.every((key) =>
    isTensorComponentFinite(metricStressRaw, key),
  );
  checks.finiteTensorComponents = finiteTensorComponentsPass ? "pass" : "fail";
  if (!finiteTensorComponentsPass) {
    reasonCodes.push("non_finite_tensor_components");
  }

  const t0iSymmetryPass =
    isSymmetricPair(metricStressRaw, "T01", "T10") &&
    isSymmetricPair(metricStressRaw, "T02", "T20") &&
    isSymmetricPair(metricStressRaw, "T03", "T30");
  checks.t0iSymmetry = t0iSymmetryPass ? "pass" : "fail";
  if (!t0iSymmetryPass) {
    reasonCodes.push("t0i_symmetry_failed");
  }

  const offDiagonalSymmetryPass =
    isSymmetricPair(metricStressRaw, "T12", "T21") &&
    isSymmetricPair(metricStressRaw, "T13", "T31") &&
    isSymmetricPair(metricStressRaw, "T23", "T32");
  checks.offDiagonalTijSymmetry = offDiagonalSymmetryPass ? "pass" : "fail";
  if (!offDiagonalSymmetryPass) {
    reasonCodes.push("off_diagonal_symmetry_failed");
  }

  const support = args.producerEvidence.supportFieldEvidence;
  const supportFieldRouteAdmissionPass =
    support.beta_i === "present_admitted" &&
    support.gamma_ij === "present_admitted" &&
    support.K_ij === "present_admitted" &&
    support.D_j_Kj_i_minus_D_i_K_route === "present_admitted" &&
    support.time_derivative_or_Kij_evolution_route === "present_admitted";
  checks.supportFieldRouteAdmission = supportFieldRouteAdmissionPass
    ? "pass"
    : "fail";
  if (!supportFieldRouteAdmissionPass) {
    reasonCodes.push("support_field_route_not_admitted");
  }
  const einsteinRouteValidationSuite = buildEinsteinRouteValidationSuite();
  const einsteinRouteValidationSuitePass =
    einsteinRouteValidationSuite.status === "pass" &&
    einsteinRouteValidationSuite.admittedForRoutePass;

  const finiteDifferenceStatusRaw = asText(finiteDifferenceDiagnostics?.status);
  const finiteCoarseStep_m = toFiniteNumber(finiteDifferenceDiagnostics?.coarseStep_m);
  const finiteRefinedStep_m = toFiniteNumber(finiteDifferenceDiagnostics?.refinedStep_m);
  const finiteSuperRefinedStep_m = toFiniteNumber(
    finiteDifferenceDiagnostics?.superRefinedStep_m,
  );
  const finiteComparedSampleCount = toFiniteNumber(
    finiteDifferenceDiagnostics?.comparedSampleCount,
  );
  const finiteRouteLocalComparedSampleCount = toFiniteNumber(
    finiteDifferenceDiagnostics?.routeLocalComparedSampleCount,
  );
  const finiteRouteSuppressedSampleCount = toFiniteNumber(
    finiteDifferenceDiagnostics?.routeSuppressedSampleCount,
  );
  const finiteNumericalFloorSuppressedSampleCount = toFiniteNumber(
    finiteDifferenceDiagnostics?.numericalFloorSuppressedSampleCount,
  );
  const finiteTripletComparedSampleCount = toFiniteNumber(
    finiteDifferenceDiagnostics?.tripletComparedSampleCount,
  );
  const finiteConvergenceFailureMode = asText(
    finiteDifferenceDiagnostics?.failureMode,
  );
  const finiteConvergenceSignificanceFloorRelativeToT00 = toFiniteNumber(
    finiteDifferenceDiagnostics?.significanceFloorRelativeToT00,
  );
  const finiteRelativeThreshold = toFiniteNumber(
    finiteDifferenceDiagnostics?.relativeDriftThreshold,
  );
  const finiteT0iDriftMax = toFiniteNumber(
    finiteDifferenceDiagnostics?.t0iRelativeDriftMax,
  );
  const finiteT0iRefinedDriftMax = toFiniteNumber(
    finiteDifferenceDiagnostics?.t0iRelativeDriftRefinedMax,
  );
  const finiteT0iConvergenceOrderMean = toFiniteNumber(
    finiteDifferenceDiagnostics?.t0iConvergenceOrderMean,
  );
  const finiteOffDiagonalDriftMax = toFiniteNumber(
    finiteDifferenceDiagnostics?.offDiagonalRelativeDriftMax,
  );
  const finiteOffDiagonalRefinedDriftMax = toFiniteNumber(
    finiteDifferenceDiagnostics?.offDiagonalRelativeDriftRefinedMax,
  );
  const finiteOffDiagonalConvergenceOrderMean = toFiniteNumber(
    finiteDifferenceDiagnostics?.offDiagonalConvergenceOrderMean,
  );
  const einsteinTensorRouteStatusRaw = asText(einsteinTensorRouteDiagnostics?.status);
  const einsteinTensorRouteStatus: "available" | "missing" | "unknown" =
    einsteinTensorRouteStatusRaw === "available" || einsteinTensorRouteStatusRaw === "missing"
      ? einsteinTensorRouteStatusRaw
      : "unknown";
  const einsteinTensorRouteId = asText(einsteinTensorRouteDiagnostics?.routeId);
  const einsteinTensorTensorSource = asText(
    einsteinTensorRouteDiagnostics?.tensorSource,
  );
  const einsteinTensorComparedSampleCount = toFiniteNumber(
    einsteinTensorRouteDiagnostics?.comparedSampleCount,
  );
  const einsteinTensorMaxRelativeResidual = toFiniteNumber(
    einsteinTensorRouteDiagnostics?.maxRelativeResidual,
  );
  const einsteinTensorT00ComparedSampleCount = toFiniteNumber(
    einsteinTensorRouteDiagnostics?.t00ComparedSampleCount,
  );
  const einsteinTensorT00MaxRelativeResidual = toFiniteNumber(
    einsteinTensorRouteDiagnostics?.t00MaxRelativeResidual,
  );
  const einsteinTensorT00RelativeResidualThreshold = toFiniteNumber(
    einsteinTensorRouteDiagnostics?.t00RelativeResidualThreshold,
  );
  const einsteinTensorRouteNote = asText(einsteinTensorRouteDiagnostics?.note);
  const residualAttributionStatusRaw = asText(residualAttributionDiagnostics?.status);
  const residualAttributionStatus: "available" | "missing" | "unknown" =
    residualAttributionStatusRaw === "available" ||
    residualAttributionStatusRaw === "missing"
      ? residualAttributionStatusRaw
      : "unknown";
  const residualAttributionSampleCount = toFiniteNumber(
    residualAttributionDiagnostics?.sampleCount,
  );
  const residualAttributionMaxRelativeResidual = toFiniteNumber(
    residualAttributionDiagnostics?.maxRelativeResidual,
  );
  const residualAttributionComponentsRaw = (residualAttributionDiagnostics?.componentResiduals ??
    null) as Record<string, unknown> | null;
  const residualAttributionComponentResiduals = {
    T01: toFiniteNumber(residualAttributionComponentsRaw?.T01),
    T02: toFiniteNumber(residualAttributionComponentsRaw?.T02),
    T03: toFiniteNumber(residualAttributionComponentsRaw?.T03),
    T12: toFiniteNumber(residualAttributionComponentsRaw?.T12),
    T13: toFiniteNumber(residualAttributionComponentsRaw?.T13),
    T23: toFiniteNumber(residualAttributionComponentsRaw?.T23),
  };
  const residualAttributionSweepRaw = Array.isArray(
    residualAttributionDiagnostics?.conventionSweep,
  )
    ? (residualAttributionDiagnostics?.conventionSweep as unknown[])
    : [];
  const residualAttributionConventionSweep = residualAttributionSweepRaw
    .filter((entry): entry is Record<string, unknown> => {
      if (entry == null || typeof entry !== "object") return false;
      const candidateId = asText(entry.candidateId);
      return candidateId != null;
    })
    .map((entry) => {
      const statusRaw = asText(entry.status);
      const status: "available" | "missing" | "unknown" =
        statusRaw === "available" || statusRaw === "missing"
          ? statusRaw
          : "unknown";
      return {
        candidateId: asText(entry.candidateId) ?? "unknown",
        status,
        maxRelativeResidual: toFiniteNumber(entry.maxRelativeResidual),
        note: asText(entry.note),
      };
    });
  const residualAttributionBestCandidateId = asText(
    residualAttributionDiagnostics?.bestCandidateId,
  );
  const residualAttributionBestCandidateResidual = toFiniteNumber(
    residualAttributionDiagnostics?.bestCandidateResidual,
  );
  const residualAttributionDiagnosisClassRaw = asText(
    residualAttributionDiagnostics?.diagnosisClass,
  );
  const residualAttributionDiagnosisClass:
    | "convention_mismatch"
    | "projection_mismatch"
    | "unit_factor_mismatch"
    | "discretization_mismatch"
    | "mixed"
    | "unknown" =
    residualAttributionDiagnosisClassRaw === "convention_mismatch" ||
    residualAttributionDiagnosisClassRaw === "projection_mismatch" ||
    residualAttributionDiagnosisClassRaw === "unit_factor_mismatch" ||
    residualAttributionDiagnosisClassRaw === "discretization_mismatch" ||
    residualAttributionDiagnosisClassRaw === "mixed"
      ? residualAttributionDiagnosisClassRaw
      : "unknown";
  const residualAttributionNote = asText(residualAttributionDiagnostics?.note);
  const evaluatorClosureStatusRaw = asText(evaluatorClosureDiagnostics?.status);
  const evaluatorClosureStatus: "available" | "missing" | "unknown" =
    evaluatorClosureStatusRaw === "available" || evaluatorClosureStatusRaw === "missing"
      ? evaluatorClosureStatusRaw
      : "unknown";
  const evaluatorClosureChartRef = asText(evaluatorClosureDiagnostics?.chartRef);
  const evaluatorClosureRouteId = asText(evaluatorClosureDiagnostics?.routeId);
  const evaluatorClosureUnitConvention = asText(
    evaluatorClosureDiagnostics?.unitConvention,
  );
  const evaluatorClosureSignConvention = asText(
    evaluatorClosureDiagnostics?.signConvention,
  );
  const evaluatorResolutionSweepRaw = (evaluatorClosureDiagnostics?.resolutionSweep ??
    null) as Record<string, unknown> | null;
  const evaluatorCoarseSweepRaw = (evaluatorResolutionSweepRaw?.coarse ??
    null) as Record<string, unknown> | null;
  const evaluatorRefinedSweepRaw = (evaluatorResolutionSweepRaw?.refined ??
    null) as Record<string, unknown> | null;
  const evaluatorSuperRefinedSweepRaw =
    (evaluatorResolutionSweepRaw?.superRefined ??
      null) as Record<string, unknown> | null;
  const parseEvaluatorResolutionSweepEntry = (
    entry: Record<string, unknown> | null,
  ) => ({
    step_m: toFiniteNumber(entry?.step_m),
    comparedSampleCount: toFiniteNumber(entry?.comparedSampleCount),
    t0iMaxRelativeResidual: toFiniteNumber(entry?.t0iMaxRelativeResidual),
    offDiagonalMaxRelativeResidual: toFiniteNumber(
      entry?.offDiagonalMaxRelativeResidual,
    ),
  });
  const evaluatorCoarseSweep = parseEvaluatorResolutionSweepEntry(
    evaluatorCoarseSweepRaw,
  );
  const evaluatorRefinedSweep = parseEvaluatorResolutionSweepEntry(
    evaluatorRefinedSweepRaw,
  );
  const evaluatorSuperRefinedSweep = parseEvaluatorResolutionSweepEntry(
    evaluatorSuperRefinedSweepRaw,
  );
  const evaluatorConvergenceOrderRaw =
    (evaluatorClosureDiagnostics?.observedConvergenceOrder ??
      null) as Record<string, unknown> | null;
  const evaluatorObservedConvergenceOrderT0i = toFiniteNumber(
    evaluatorConvergenceOrderRaw?.t0i,
  );
  const evaluatorObservedConvergenceOrderOffDiagonal = toFiniteNumber(
    evaluatorConvergenceOrderRaw?.offDiagonal,
  );
  const evaluatorRichardsonResidualRaw =
    (evaluatorClosureDiagnostics?.richardsonExtrapolatedResidual ??
      null) as Record<string, unknown> | null;
  const evaluatorRichardsonResidualT0i = toFiniteNumber(
    evaluatorRichardsonResidualRaw?.t0i,
  );
  const evaluatorRichardsonResidualOffDiagonal = toFiniteNumber(
    evaluatorRichardsonResidualRaw?.offDiagonal,
  );
  const evaluatorClosureConventionSweepRaw = Array.isArray(
    evaluatorClosureDiagnostics?.conventionSweep,
  )
    ? (evaluatorClosureDiagnostics?.conventionSweep as unknown[])
    : [];
  const evaluatorClosureConventionSweep = evaluatorClosureConventionSweepRaw
    .filter((entry): entry is Record<string, unknown> => {
      if (entry == null || typeof entry !== "object") return false;
      const candidateId = asText(entry.candidateId);
      return candidateId != null;
    })
    .map((entry) => {
      const statusRaw = asText(entry.status);
      const status: "available" | "missing" | "unknown" =
        statusRaw === "available" || statusRaw === "missing"
          ? statusRaw
          : "unknown";
      return {
        candidateId: asText(entry.candidateId) ?? "unknown",
        status,
        maxRelativeResidual: toFiniteNumber(entry.maxRelativeResidual),
        note: asText(entry.note),
      };
    });
  const evaluatorClosureBestCandidateId = asText(
    evaluatorClosureDiagnostics?.bestCandidateId,
  );
  const evaluatorClosureDiagnosisClassRaw = asText(
    evaluatorClosureDiagnostics?.diagnosisClass,
  );
  const evaluatorClosureDiagnosisClass:
    | "convention_mismatch"
    | "projection_mismatch"
    | "unit_factor_mismatch"
    | "discretization_mismatch"
    | "mixed"
    | "unknown" =
    evaluatorClosureDiagnosisClassRaw === "convention_mismatch" ||
    evaluatorClosureDiagnosisClassRaw === "projection_mismatch" ||
    evaluatorClosureDiagnosisClassRaw === "unit_factor_mismatch" ||
    evaluatorClosureDiagnosisClassRaw === "discretization_mismatch" ||
    evaluatorClosureDiagnosisClassRaw === "mixed"
      ? evaluatorClosureDiagnosisClassRaw
      : "unknown";
  const evaluatorClosureNote = asText(evaluatorClosureDiagnostics?.note);
  const evaluatorClosureCitationRefs = Array.isArray(
    evaluatorClosureDiagnostics?.citationRefs,
  )
    ? (evaluatorClosureDiagnostics?.citationRefs as unknown[])
        .map((entry) => asText(entry))
        .filter((entry): entry is string => entry != null)
    : [];
  const resolveFamilyResidualMax = (
    values: Array<number | null>,
  ): number | null => {
    const finiteValues = values.filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
    if (finiteValues.length === 0) return null;
    return finiteValues.reduce((max, value) => Math.max(max, value), -Infinity);
  };
  const isFiniteResidual = (value: number | null): value is number =>
    value != null && Number.isFinite(value);
  const evaluatorClosureComparableToEinsteinRoute =
    evaluatorClosureStatus === "available" &&
    (evaluatorClosureRouteId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
      einsteinTensorRouteId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
      routeId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID);
  const evaluatorCoarseComparable =
    evaluatorCoarseSweep.comparedSampleCount != null &&
    evaluatorCoarseSweep.comparedSampleCount > 0 &&
    isFiniteResidual(evaluatorCoarseSweep.t0iMaxRelativeResidual) &&
    isFiniteResidual(evaluatorCoarseSweep.offDiagonalMaxRelativeResidual);
  const evaluatorRefinedComparable =
    evaluatorRefinedSweep.comparedSampleCount != null &&
    evaluatorRefinedSweep.comparedSampleCount > 0 &&
    isFiniteResidual(evaluatorRefinedSweep.t0iMaxRelativeResidual) &&
    isFiniteResidual(evaluatorRefinedSweep.offDiagonalMaxRelativeResidual);
  const evaluatorSuperRefinedComparable =
    evaluatorSuperRefinedSweep.comparedSampleCount != null &&
    evaluatorSuperRefinedSweep.comparedSampleCount > 0 &&
    isFiniteResidual(evaluatorSuperRefinedSweep.t0iMaxRelativeResidual) &&
    isFiniteResidual(evaluatorSuperRefinedSweep.offDiagonalMaxRelativeResidual);
  const evaluatorHasComparablePair =
    evaluatorClosureComparableToEinsteinRoute &&
    evaluatorCoarseComparable &&
    evaluatorRefinedComparable;
  const evaluatorHasComparableTriplet =
    evaluatorHasComparablePair && evaluatorSuperRefinedComparable;
  const evaluatorFiniteDifferenceThreshold = finiteRelativeThreshold;
  const evaluatorFinestComparableSweep = evaluatorSuperRefinedComparable
    ? evaluatorSuperRefinedSweep
    : evaluatorRefinedComparable
      ? evaluatorRefinedSweep
      : evaluatorCoarseComparable
        ? evaluatorCoarseSweep
        : null;
  const evaluatorFinestT0iResidual = evaluatorFinestComparableSweep
    ?.t0iMaxRelativeResidual as number | null;
  const evaluatorFinestOffDiagonalResidual = evaluatorFinestComparableSweep
    ?.offDiagonalMaxRelativeResidual as number | null;
  const evaluatorResidualThresholdPass =
    evaluatorFiniteDifferenceThreshold != null &&
    isFiniteResidual(evaluatorFinestT0iResidual) &&
    isFiniteResidual(evaluatorFinestOffDiagonalResidual)
      ? Math.max(evaluatorFinestT0iResidual, evaluatorFinestOffDiagonalResidual) <=
        evaluatorFiniteDifferenceThreshold
      : null;
  const evaluatorMonotonicPass = evaluatorHasComparablePair
    ? (() => {
        const coarseT0i = evaluatorCoarseSweep.t0iMaxRelativeResidual as number;
        const refinedT0i = evaluatorRefinedSweep.t0iMaxRelativeResidual as number;
        const coarseOffDiag =
          evaluatorCoarseSweep.offDiagonalMaxRelativeResidual as number;
        const refinedOffDiag =
          evaluatorRefinedSweep.offDiagonalMaxRelativeResidual as number;
        if (coarseT0i + NHM2_MODEL_TERM_SYMMETRY_EPSILON < refinedT0i) {
          return false;
        }
        if (coarseOffDiag + NHM2_MODEL_TERM_SYMMETRY_EPSILON < refinedOffDiag) {
          return false;
        }
        if (!evaluatorSuperRefinedComparable) return true;
        const superT0i = evaluatorSuperRefinedSweep.t0iMaxRelativeResidual as number;
        const superOffDiag =
          evaluatorSuperRefinedSweep.offDiagonalMaxRelativeResidual as number;
        if (refinedT0i + NHM2_MODEL_TERM_SYMMETRY_EPSILON < superT0i) {
          return false;
        }
        if (refinedOffDiag + NHM2_MODEL_TERM_SYMMETRY_EPSILON < superOffDiag) {
          return false;
        }
        return true;
      })()
    : null;
  let finiteDifferenceFallbackPass: boolean | null = null;
  let finiteDifferenceFallbackFailureMode:
    | "none"
    | "non_comparable_route"
    | "missing_evidence"
    | "threshold_failed"
    | "non_monotonic_refinement" = "missing_evidence";
  let finiteDifferenceFallbackComparedSampleCount: number | null = null;
  const finiteDifferenceLowSignalOnly =
    finiteConvergenceFailureMode === "numerical_floor_insufficient_signal";
  if (finiteDifferenceLowSignalOnly) {
    if (!evaluatorClosureComparableToEinsteinRoute) {
      finiteDifferenceFallbackFailureMode = "non_comparable_route";
    } else if (!evaluatorHasComparablePair) {
      finiteDifferenceFallbackFailureMode = "missing_evidence";
    } else {
      const comparableCounts = [
        evaluatorCoarseSweep.comparedSampleCount,
        evaluatorRefinedSweep.comparedSampleCount,
        evaluatorSuperRefinedComparable
          ? evaluatorSuperRefinedSweep.comparedSampleCount
          : null,
      ].filter((value): value is number => value != null && Number.isFinite(value));
      finiteDifferenceFallbackComparedSampleCount =
        comparableCounts.length > 0
          ? Math.min(...comparableCounts)
          : null;
      if (evaluatorResidualThresholdPass === false) {
        finiteDifferenceFallbackPass = false;
        finiteDifferenceFallbackFailureMode = "threshold_failed";
      } else if (evaluatorMonotonicPass === false) {
        finiteDifferenceFallbackPass = false;
        finiteDifferenceFallbackFailureMode = "non_monotonic_refinement";
      } else if (evaluatorResidualThresholdPass === true) {
        finiteDifferenceFallbackPass = true;
        finiteDifferenceFallbackFailureMode = "none";
      } else {
        finiteDifferenceFallbackFailureMode = "missing_evidence";
      }
    }
  }
  let finiteDifferencePass: boolean | null = null;
  if (finiteDifferenceStatusRaw === "pass") {
    finiteDifferencePass = true;
  } else if (finiteDifferenceStatusRaw === "fail") {
    finiteDifferencePass =
      finiteDifferenceLowSignalOnly && einsteinRouteValidationSuitePass
        ? null
        : false;
  } else if (
    finiteComparedSampleCount != null &&
    finiteComparedSampleCount > 0 &&
    finiteRelativeThreshold != null &&
    finiteT0iDriftMax != null &&
    finiteOffDiagonalDriftMax != null
  ) {
    finiteDifferencePass =
      Math.max(finiteT0iDriftMax, finiteOffDiagonalDriftMax) <=
      finiteRelativeThreshold;
  }
  if (finiteDifferenceLowSignalOnly && finiteDifferencePass === false) {
    finiteDifferencePass = einsteinRouteValidationSuitePass ? null : false;
  }
  if (finiteDifferenceLowSignalOnly && finiteDifferencePass == null) {
    finiteDifferencePass = finiteDifferenceFallbackPass;
  }
  checks.finiteDifferenceConvergence =
    finiteDifferencePass == null
      ? "unknown"
      : finiteDifferencePass
        ? "pass"
        : "fail";
  if (checks.finiteDifferenceConvergence === "unknown") {
    reasonCodes.push("finite_difference_convergence_missing");
  } else if (checks.finiteDifferenceConvergence === "fail") {
    reasonCodes.push("finite_difference_convergence_failed");
  }

  const independentCrossCheckStatusRaw = asText(independentCrossCheckDiagnostics?.status);
  const independentCrossCheckReference = asText(
    independentCrossCheckDiagnostics?.reference,
  );
  const independentCrossCheckComparedSampleCount = toFiniteNumber(
    independentCrossCheckDiagnostics?.comparedSampleCount,
  );
  const independentCrossCheckReferenceRouteSuppressedSampleCount = toFiniteNumber(
    independentCrossCheckDiagnostics?.referenceRouteSuppressedSampleCount,
  );
  const independentCrossCheckMaxRelativeResidual = toFiniteNumber(
    independentCrossCheckDiagnostics?.maxRelativeResidual,
  );
  const independentCrossCheckRelativeResidualThreshold = toFiniteNumber(
    independentCrossCheckDiagnostics?.relativeResidualThreshold,
  );
  const independentCrossCheckT00ComparedSampleCount = toFiniteNumber(
    independentCrossCheckDiagnostics?.t00ComparedSampleCount,
  );
  const independentCrossCheckT00MaxRelativeResidual = toFiniteNumber(
    independentCrossCheckDiagnostics?.t00MaxRelativeResidual,
  );
  const independentCrossCheckT00ReferenceComparableRaw =
    independentCrossCheckDiagnostics?.t00ReferenceComparable;
  const independentCrossCheckRouteIndependentRaw =
    independentCrossCheckDiagnostics?.routeIndependent;
  const independentCrossCheckFailureMode = asText(
    independentCrossCheckDiagnostics?.failureMode,
  );
  const independentCrossCheckRouteIndependent =
    typeof independentCrossCheckRouteIndependentRaw === "boolean"
      ? independentCrossCheckRouteIndependentRaw
      : null;
  const independentCrossCheckT00ReferenceComparable =
    typeof independentCrossCheckT00ReferenceComparableRaw === "boolean"
      ? independentCrossCheckT00ReferenceComparableRaw
      : null;
  const independentCrossCheckReferenceLower =
    independentCrossCheckReference?.toLowerCase() ?? null;
  const independentCrossCheckReferenceLooksEinstein =
    independentCrossCheckReferenceLower?.includes("einstein") === true;
  const independentCrossCheckReferenceRouteId =
    independentCrossCheckReferenceLower?.startsWith("same_route:") === true
      ? independentCrossCheckReference.slice("same_route:".length)
      : independentCrossCheckReference;
  const independentCrossCheckDeclaredSameRoute =
    independentCrossCheckReferenceLower?.includes("same_route") === true ||
    (routeId != null && independentCrossCheckReference === routeId);
  const independentCrossCheckReferenceLooksLegacyAdm =
    independentCrossCheckReferenceRouteId === NHM2_MODEL_TERM_LEGACY_ROUTE_ID;
  const independentCrossCheckPrimaryRouteLooksEinstein =
    routeId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
    einsteinTensorRouteId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID;
  const independentCrossCheckResidualPass =
    independentCrossCheckMaxRelativeResidual != null &&
    independentCrossCheckRelativeResidualThreshold != null
      ? independentCrossCheckMaxRelativeResidual <=
        independentCrossCheckRelativeResidualThreshold
      : null;
  const independentCrossCheckT00ResidualPass =
    independentCrossCheckT00MaxRelativeResidual != null &&
    independentCrossCheckRelativeResidualThreshold != null
      ? independentCrossCheckT00MaxRelativeResidual <=
        independentCrossCheckRelativeResidualThreshold
      : null;
  const independentCrossCheckEvidencePresent =
    independentCrossCheckStatusRaw === "available" &&
    independentCrossCheckComparedSampleCount != null &&
    independentCrossCheckComparedSampleCount > 0;
  const independentCrossCheckThresholdFailed =
    independentCrossCheckEvidencePresent &&
    independentCrossCheckResidualPass === false;
  const independentCrossCheckRouteIndependentEffective =
    independentCrossCheckRouteIndependent ??
    (independentCrossCheckReference != null &&
      !independentCrossCheckDeclaredSameRoute &&
      (routeId == null || independentCrossCheckReference !== routeId));
  // The ADM fallback route is retained only as a legacy recovery path. Treat
  // Einstein-vs-legacy-ADM residual mismatches as non-comparable cross-check
  // evidence instead of threshold failures.
  const independentCrossCheckReferenceComparable =
    independentCrossCheckEvidencePresent
      ? !(
          independentCrossCheckPrimaryRouteLooksEinstein &&
          independentCrossCheckReferenceLooksLegacyAdm
        )
      : null;
  const independentCrossCheckEvidenceStatus: "available" | "missing" | "unknown" =
    independentCrossCheckEvidencePresent
      ? "available"
      : independentCrossCheckStatusRaw === "missing"
        ? "missing"
        : "unknown";
  const independentCrossCheckAdmissionStatus: "pass" | "fail" | "unknown" =
    independentCrossCheckEvidenceStatus === "available"
      ? independentCrossCheckRouteIndependentEffective === true &&
        !independentCrossCheckDeclaredSameRoute &&
        independentCrossCheckReferenceComparable !== false &&
        independentCrossCheckResidualPass !== false
        ? "pass"
        : "fail"
      : independentCrossCheckEvidenceStatus === "missing"
        ? "fail"
        : "unknown";
  const independentCrossCheckAdmissionFailureMode =
    independentCrossCheckAdmissionStatus === "pass"
      ? "none"
      : independentCrossCheckReferenceComparable === false
        ? "reference_route_non_comparable"
        : independentCrossCheckThresholdFailed
        ? "threshold_failed"
        : independentCrossCheckRouteIndependentEffective === false ||
            independentCrossCheckDeclaredSameRoute
          ? "same_route_not_independent"
          : independentCrossCheckEvidenceStatus === "available"
            ? "admission_ambiguous"
            : "missing_evidence";
  const declaredIndependentEinsteinCrossCheckStatus:
    | "available"
    | "missing"
    | "unknown" =
    independentCrossCheckAdmissionStatus === "pass"
      ? "available"
      : independentCrossCheckAdmissionStatus === "fail"
        ? "missing"
        : "unknown";
  const effectiveEinsteinRouteEvidenceStatus:
    | "available"
    | "missing"
    | "unknown" =
    einsteinTensorRouteStatus !== "unknown"
      ? einsteinTensorRouteStatus
      : declaredIndependentEinsteinCrossCheckStatus === "available"
        ? "available"
        : support.full_einstein_tensor_route === "present_admitted" ||
            support.full_einstein_tensor_route === "present_but_not_admitted"
          ? "available"
          : support.full_einstein_tensor_route === "missing"
            ? "missing"
            : "unknown";
  const inferredIndependentEinsteinCrossCheckStatus:
    | "available"
    | "missing"
    | "unknown" =
    effectiveEinsteinRouteEvidenceStatus === "available" &&
    routeId != null &&
    routeId !== NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID
      ? "available"
      : effectiveEinsteinRouteEvidenceStatus === "available" &&
          routeId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID
        ? "missing"
        : "unknown";
  const effectiveEinsteinCrossCheckStatus =
    declaredIndependentEinsteinCrossCheckStatus !== "unknown"
      ? declaredIndependentEinsteinCrossCheckStatus
      : inferredIndependentEinsteinCrossCheckStatus !== "unknown"
        ? inferredIndependentEinsteinCrossCheckStatus
        : effectiveEinsteinRouteEvidenceStatus === "missing"
          ? "missing"
          : "unknown";
  const effectiveResidualAttributionStatus =
    residualAttributionStatus !== "unknown"
      ? residualAttributionStatus
      : effectiveEinsteinRouteEvidenceStatus;
  const effectiveResidualAttributionSampleCount =
    residualAttributionSampleCount ??
    einsteinTensorComparedSampleCount ??
    (effectiveResidualAttributionStatus === "available" ? 0 : null);
  const effectiveResidualAttributionMaxRelativeResidual =
    residualAttributionMaxRelativeResidual ??
    einsteinTensorMaxRelativeResidual ??
    null;
  const effectiveResidualAttributionConventionSweep =
    residualAttributionConventionSweep.length > 0
      ? residualAttributionConventionSweep
      : [
          {
            candidateId: "raw_geometry_fd4",
            status: effectiveResidualAttributionStatus,
            maxRelativeResidual: effectiveResidualAttributionMaxRelativeResidual,
            note:
              effectiveResidualAttributionStatus === "available"
                ? "Only baseline geometry-first Einstein residual diagnostic is available on this runtime payload."
                : "No residual-attribution sweep was emitted by the producer diagnostics.",
          },
        ];
  const effectiveResidualAttributionBestCandidateId =
    residualAttributionBestCandidateId ??
    (effectiveResidualAttributionConventionSweep.length > 0
      ? effectiveResidualAttributionConventionSweep.reduce(
          (best, candidate) => {
            if (candidate.maxRelativeResidual == null) return best;
            if (best == null) return candidate;
            if (best.maxRelativeResidual == null) return candidate;
            return candidate.maxRelativeResidual < best.maxRelativeResidual
              ? candidate
              : best;
          },
          null as
            | {
                candidateId: string;
                status: "available" | "missing" | "unknown";
                maxRelativeResidual: number | null;
                note: string | null;
              }
            | null,
        )?.candidateId ?? null
      : null);
  const effectiveResidualAttributionBestCandidateResidual =
    residualAttributionBestCandidateResidual ??
    (effectiveResidualAttributionBestCandidateId == null
      ? null
      : effectiveResidualAttributionConventionSweep.find(
          (candidate) =>
            candidate.candidateId === effectiveResidualAttributionBestCandidateId,
        )?.maxRelativeResidual ?? null);
  const effectiveResidualAttributionDiagnosisClass =
    residualAttributionDiagnosisClass !== "unknown"
      ? residualAttributionDiagnosisClass
      : checks.finiteDifferenceConvergence === "fail"
        ? "discretization_mismatch"
        : "unknown";
  const effectiveResidualAttributionNote =
    residualAttributionNote ??
    (effectiveResidualAttributionStatus === "available"
      ? "Residual-attribution diagnostics defaulted to baseline Einstein-route residual evidence."
      : "Residual-attribution diagnostics were not emitted by the producer path.");
  const effectiveEvaluatorClosureStatus =
    evaluatorClosureStatus !== "unknown"
      ? evaluatorClosureStatus
      : effectiveResidualAttributionStatus;
  const residualT0iFamilyMax = resolveFamilyResidualMax([
    residualAttributionComponentResiduals.T01,
    residualAttributionComponentResiduals.T02,
    residualAttributionComponentResiduals.T03,
  ]);
  const residualOffDiagonalFamilyMax = resolveFamilyResidualMax([
    residualAttributionComponentResiduals.T12,
    residualAttributionComponentResiduals.T13,
    residualAttributionComponentResiduals.T23,
  ]);
  const effectiveEvaluatorClosureResolutionSweep = {
    coarse: {
      step_m: evaluatorCoarseSweep.step_m ?? finiteCoarseStep_m ?? null,
      comparedSampleCount:
        evaluatorCoarseSweep.comparedSampleCount ??
        effectiveResidualAttributionSampleCount ??
        null,
      t0iMaxRelativeResidual:
        evaluatorCoarseSweep.t0iMaxRelativeResidual ?? residualT0iFamilyMax,
      offDiagonalMaxRelativeResidual:
        evaluatorCoarseSweep.offDiagonalMaxRelativeResidual ??
        residualOffDiagonalFamilyMax,
    },
    refined: {
      step_m: evaluatorRefinedSweep.step_m ?? finiteRefinedStep_m ?? null,
      comparedSampleCount: evaluatorRefinedSweep.comparedSampleCount ?? null,
      t0iMaxRelativeResidual: evaluatorRefinedSweep.t0iMaxRelativeResidual ?? null,
      offDiagonalMaxRelativeResidual:
        evaluatorRefinedSweep.offDiagonalMaxRelativeResidual ?? null,
    },
    superRefined: {
      step_m:
        evaluatorSuperRefinedSweep.step_m ?? finiteSuperRefinedStep_m ?? null,
      comparedSampleCount:
        evaluatorSuperRefinedSweep.comparedSampleCount ?? null,
      t0iMaxRelativeResidual:
        evaluatorSuperRefinedSweep.t0iMaxRelativeResidual ?? null,
      offDiagonalMaxRelativeResidual:
        evaluatorSuperRefinedSweep.offDiagonalMaxRelativeResidual ?? null,
    },
  };
  const effectiveEvaluatorClosureConvergenceOrder = {
    t0i:
      evaluatorObservedConvergenceOrderT0i ?? finiteT0iConvergenceOrderMean ?? null,
    offDiagonal:
      evaluatorObservedConvergenceOrderOffDiagonal ??
      finiteOffDiagonalConvergenceOrderMean ??
      null,
  };
  const effectiveEvaluatorClosureRichardsonResidual = {
    t0i: evaluatorRichardsonResidualT0i,
    offDiagonal: evaluatorRichardsonResidualOffDiagonal,
  };
  const effectiveEvaluatorClosureConventionSweep =
    evaluatorClosureConventionSweep.length > 0
      ? evaluatorClosureConventionSweep
      : effectiveResidualAttributionConventionSweep;
  const effectiveEvaluatorClosureBestCandidateId =
    evaluatorClosureBestCandidateId ??
    effectiveResidualAttributionBestCandidateId ??
    (effectiveEvaluatorClosureConventionSweep.length > 0
      ? effectiveEvaluatorClosureConventionSweep[0]?.candidateId ?? null
      : null);
  const effectiveEvaluatorClosureDiagnosisClass =
    evaluatorClosureDiagnosisClass !== "unknown"
      ? evaluatorClosureDiagnosisClass
      : effectiveResidualAttributionDiagnosisClass;
  const effectiveEvaluatorClosureNote =
    evaluatorClosureNote ??
    (effectiveEvaluatorClosureStatus === "available"
      ? "Evaluator closure diagnostics were synthesized from available Einstein-route residual and finite-difference evidence."
      : "Evaluator closure diagnostics are unavailable because Einstein-route diagnostics are missing.");
  const effectiveEvaluatorClosureCitationRefs = Array.from(
    new Set(
      [
        ...evaluatorClosureCitationRefs,
        ...NHM2_MODEL_TERM_CITATION_REFS,
      ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  );
  const hasEinsteinRouteEvidenceForAdmission =
    effectiveEinsteinRouteEvidenceStatus === "available" &&
    (einsteinTensorRouteId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
      routeId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
      einsteinTensorTensorSource === "geometry_first_einstein_tensor");
  const einsteinT00ResidualThreshold =
    einsteinTensorT00RelativeResidualThreshold ??
    independentCrossCheckRelativeResidualThreshold;
  const einsteinRouteT00EvidencePresent =
    einsteinTensorT00ComparedSampleCount != null &&
    einsteinTensorT00ComparedSampleCount > 0 &&
    einsteinTensorT00MaxRelativeResidual != null &&
    einsteinT00ResidualThreshold != null;
  const einsteinRouteT00ResidualPass =
    einsteinRouteT00EvidencePresent &&
    einsteinTensorT00MaxRelativeResidual <= einsteinT00ResidualThreshold;
  const independentCrossCheckT00EvidencePresent =
    independentCrossCheckEvidencePresent &&
    independentCrossCheckT00ComparedSampleCount != null &&
    independentCrossCheckT00ComparedSampleCount > 0 &&
    independentCrossCheckT00ResidualPass != null;
  const independentCrossCheckT00Comparable =
    independentCrossCheckT00ReferenceComparable ??
    (independentCrossCheckReferenceComparable !== false &&
      independentCrossCheckRouteIndependentEffective === true &&
      !independentCrossCheckDeclaredSameRoute);
  const independentCrossCheckT00Pass =
    independentCrossCheckT00EvidencePresent &&
    independentCrossCheckT00Comparable !== false &&
    independentCrossCheckT00ResidualPass !== false;
  checks.einsteinT00Comparability =
    einsteinRouteT00ResidualPass && independentCrossCheckT00Pass
      ? "pass"
      : einsteinRouteT00EvidencePresent || independentCrossCheckT00EvidencePresent
        ? "fail"
        : "unknown";
  checks.independentCrossCheck =
    independentCrossCheckAdmissionStatus === "pass"
      ? "pass"
      : independentCrossCheckAdmissionStatus === "fail"
        ? "fail"
        : "unknown";
  if (checks.independentCrossCheck !== "pass") {
    reasonCodes.push(
      independentCrossCheckAdmissionFailureMode === "threshold_failed"
        ? "independent_cross_check_failed_threshold"
        : "independent_cross_check_missing",
    );
  }
  const chartRecord = adapter?.chart as Record<string, unknown> | undefined;
  const dtGammaPolicy = asText(chartRecord?.dtGammaPolicy);
  const gammaDiag = (adapter?.gammaDiag ?? null) as [number, number, number] | null;
  const hasStaticEuclideanGamma =
    gammaDiag != null &&
    isFiniteTriplet(gammaDiag) &&
    Math.abs(gammaDiag[0] - 1) <= 1e-12 &&
    Math.abs(gammaDiag[1] - 1) <= 1e-12 &&
    Math.abs(gammaDiag[2] - 1) <= 1e-12;
  const hasExpectedModelTermRoute =
    routeId === NHM2_MODEL_TERM_EXPECTED_ROUTE_ID;
  const dtGammaThetaCandidates = [
    toFiniteNumber((adapter?.betaDiagnostics as Record<string, unknown>)?.thetaMax),
    toFiniteNumber(
      (adapter?.betaDiagnostics as Record<string, unknown>)?.divBetaMaxAbs,
    ),
    toFiniteNumber((warpState?.hodgeDiagnostics as Record<string, unknown>)?.maxDiv),
  ].filter((value): value is number => value != null);
  const dtGammaThetaMax =
    dtGammaThetaCandidates.length > 0
      ? dtGammaThetaCandidates.reduce(
          (maxValue, value) => Math.max(maxValue, Math.abs(value)),
          0,
        )
      : null;
  let dtGammaPass: boolean | null = null;
  let dtGammaClosureMode: "computed_policy" | "static_euclidean_gamma" | "theta_bound" | "unknown" =
    "unknown";
  if (dtGammaPolicy === "computed") {
    dtGammaPass = true;
    dtGammaClosureMode = "computed_policy";
  } else if (dtGammaPolicy === "assumed_zero") {
    if (hasStaticEuclideanGamma && hasExpectedModelTermRoute) {
      dtGammaPass = true;
      dtGammaClosureMode = "static_euclidean_gamma";
    } else if (dtGammaThetaMax != null) {
      dtGammaPass = dtGammaThetaMax <= NHM2_MODEL_TERM_DT_GAMMA_THETA_MAX;
      dtGammaClosureMode = "theta_bound";
    }
  }
  checks.dtGammaAssumptionBounded =
    dtGammaPass == null ? "unknown" : dtGammaPass ? "pass" : "fail";
  if (checks.dtGammaAssumptionBounded !== "pass") {
    reasonCodes.push("dt_gamma_assumption_unbounded");
  }

  const citationRefs = Array.from(
    new Set(
      [
        NHM2_FULL_TENSOR_SEMANTICS_REF,
        researchBasisRef,
        ...NHM2_MODEL_TERM_CITATION_REFS,
      ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  );
  const citationBasisPass =
    researchBasisRef != null &&
    citationRefs.length >= NHM2_MODEL_TERM_CITATION_REFS.length;
  checks.citationBasis = citationBasisPass ? "pass" : "fail";
  if (!citationBasisPass) {
    reasonCodes.push("citation_basis_missing");
  }
  const citationCoverage = resolveResearchBasisCitationCoverage(researchBasisRef);
  const citationRefsCoveragePass = NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS.every(
    (ref) => citationRefs.includes(ref),
  );
  const citationRefsMissingRefs = NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS.filter(
    (ref) => !citationRefs.includes(ref),
  );
  checks.citationCoverage =
    citationCoverage.status === "pass" && citationRefsCoveragePass
      ? "pass"
      : citationCoverage.status === "fail"
        ? "fail"
        : citationRefsCoveragePass
          ? "unknown"
        : "unknown";
  if (checks.citationCoverage !== "pass") {
    reasonCodes.push("citation_coverage_incomplete");
  }
  const fullEinsteinStructuralChecksPass =
    checks.routeMetadata === "pass" &&
    checks.chart === "pass" &&
    checks.finiteTensorComponents === "pass" &&
    checks.t0iSymmetry === "pass" &&
    checks.offDiagonalTijSymmetry === "pass" &&
    checks.finiteDifferenceConvergence === "pass" &&
    checks.independentCrossCheck === "pass" &&
    checks.citationBasis === "pass" &&
    checks.dtGammaAssumptionBounded === "pass" &&
    checks.citationCoverage === "pass";
  const fullEinsteinPolicyAdmissionPass = routeAdmissionRaw === "admitted";
  const fullEinsteinEvidenceAdmissionPass =
    hasEinsteinRouteEvidenceForAdmission &&
    einsteinRouteValidationSuitePass &&
    fullEinsteinStructuralChecksPass;
  checks.fullEinsteinTensorRouteAdmission = fullEinsteinEvidenceAdmissionPass
    ? "pass"
    : "fail";
  if (!fullEinsteinEvidenceAdmissionPass) {
    reasonCodes.push("full_einstein_tensor_route_not_admitted");
  }

  const routeAdmissionEffective: Nhm2ObserverModelTermSemanticAdmissionEvidence["routeAdmission"] =
    routeAdmissionRaw === "admitted"
      ? "admitted"
      : fullEinsteinEvidenceAdmissionPass
        ? "admitted"
        : routeAdmissionRaw;
  const routeAdmissionPromotionBasis: Nhm2ObserverModelTermSemanticAdmissionEvidence["routeAdmissionPromotionBasis"] =
    routeAdmissionRaw === "admitted"
      ? "producer_declared_admitted"
      : fullEinsteinEvidenceAdmissionPass
        ? "evidence_gate_promoted_full_einstein"
        : routeAdmissionRaw === "experimental_not_admitted"
          ? "evidence_gate_not_satisfied"
          : "unknown";

  const structuralPass =
    checks.routeMetadata === "pass" &&
    checks.chart === "pass" &&
    checks.finiteTensorComponents === "pass" &&
    checks.t0iSymmetry === "pass" &&
    checks.offDiagonalTijSymmetry === "pass" &&
    checks.citationBasis === "pass" &&
    checks.finiteDifferenceConvergence === "pass" &&
    checks.independentCrossCheck === "pass" &&
    checks.dtGammaAssumptionBounded === "pass" &&
    checks.citationCoverage === "pass";
  const derivationRoutePass =
    checks.supportFieldRouteAdmission === "pass" ||
    checks.fullEinsteinTensorRouteAdmission === "pass";
  const decision: Nhm2ObserverModelTermSemanticAdmissionEvidence["decision"] =
    routeAdmissionEffective === "admitted" && structuralPass && derivationRoutePass
      ? "admit"
      : routeAdmissionEffective === "unknown" && reasonCodes.length === 0
        ? "unknown"
        : "do_not_admit";
  const closurePathDecision = deriveNhm2ModelTermClosurePathDecision({
    routeId,
    checks,
    reasonCodes,
    effectiveEinsteinCrossCheckStatus,
    einsteinTensorRouteId,
    researchBasisRef,
    citationRefs,
  });
  const routeScopedReasonCodes = resolveRouteScopedModelTermReasonCodes({
    selectedPath: closurePathDecision.selectedPath,
    reasonCodes,
  });

  const chartLabel =
    chartRef ??
    (typeof adapter?.chart?.label === "string" && adapter.chart.label.length > 0
      ? adapter.chart.label
      : "unknown");
  const tensorRef = args.metricRequiredTensorInput.tensorRef ?? "warp.metricStressEnergy";

  return {
    semanticsRef: args.producerEvidence.semanticsRef ?? NHM2_FULL_TENSOR_SEMANTICS_REF,
    researchBasisRef,
    chartRef: chartLabel,
    routeId,
    routeAdmissionRaw,
    routeAdmissionEffective,
    routeAdmissionPromotionBasis,
    routeAdmission: routeAdmissionEffective,
    decision,
    reasonCodes: routeScopedReasonCodes.blockerCodes,
    checks,
    einsteinTensorRouteEvidence: {
      status: effectiveEinsteinRouteEvidenceStatus,
      routeId:
        effectiveEinsteinRouteEvidenceStatus === "available"
          ? einsteinTensorRouteId ??
            (independentCrossCheckReferenceLooksEinstein
              ? independentCrossCheckReference
              : null) ??
            NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID
          : einsteinTensorRouteId ?? null,
      tensorSource: einsteinTensorTensorSource,
      comparedSampleCount: einsteinTensorComparedSampleCount,
      maxRelativeResidual: einsteinTensorMaxRelativeResidual,
      t00ComparedSampleCount: einsteinTensorT00ComparedSampleCount,
      t00MaxRelativeResidual: einsteinTensorT00MaxRelativeResidual,
      t00RelativeResidualThreshold: einsteinT00ResidualThreshold,
      note:
        einsteinTensorRouteNote ??
        (effectiveEinsteinRouteEvidenceStatus === "available"
          ? checks.independentCrossCheck === "pass"
            ? "Geometry-first Einstein-tensor route is available with an independent cross-check path."
            : "Geometry-first Einstein-tensor route is available, but independent cross-check evidence is missing or same-route."
          : "Geometry-first Einstein-tensor route evidence is missing."),
    },
    einsteinResidualAttributionEvidence: {
      status: effectiveResidualAttributionStatus,
      sampleCount: effectiveResidualAttributionSampleCount,
      maxRelativeResidual: effectiveResidualAttributionMaxRelativeResidual,
      componentResiduals: {
        T01: residualAttributionComponentResiduals.T01,
        T02: residualAttributionComponentResiduals.T02,
        T03: residualAttributionComponentResiduals.T03,
        T12: residualAttributionComponentResiduals.T12,
        T13: residualAttributionComponentResiduals.T13,
        T23: residualAttributionComponentResiduals.T23,
      },
      conventionSweep: effectiveResidualAttributionConventionSweep,
      bestCandidateId: effectiveResidualAttributionBestCandidateId,
      bestCandidateResidual: effectiveResidualAttributionBestCandidateResidual,
      diagnosisClass: effectiveResidualAttributionDiagnosisClass,
      note: effectiveResidualAttributionNote,
    },
    einsteinEvaluatorClosureEvidence: {
      status: effectiveEvaluatorClosureStatus,
      chartRef: evaluatorClosureChartRef ?? chartLabel,
      routeId:
        evaluatorClosureRouteId ??
        einsteinTensorRouteId ??
        (effectiveEvaluatorClosureStatus === "available"
          ? NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID
          : null),
      unitConvention:
        evaluatorClosureUnitConvention ??
        (effectiveEvaluatorClosureStatus === "available"
          ? "si_from_geometry_via_inv8pi_and_geom_to_si_stress"
          : null),
      signConvention:
        evaluatorClosureSignConvention ??
        (effectiveEvaluatorClosureStatus === "available"
          ? "T_munu_equals_plus_G_munu_over_8pi"
          : null),
      resolutionSweep: effectiveEvaluatorClosureResolutionSweep,
      observedConvergenceOrder: effectiveEvaluatorClosureConvergenceOrder,
      richardsonExtrapolatedResidual: effectiveEvaluatorClosureRichardsonResidual,
      conventionSweep: effectiveEvaluatorClosureConventionSweep,
      bestCandidateId: effectiveEvaluatorClosureBestCandidateId,
      diagnosisClass: effectiveEvaluatorClosureDiagnosisClass,
      note: effectiveEvaluatorClosureNote,
      citationRefs: effectiveEvaluatorClosureCitationRefs,
    },
    einsteinRouteValidationSuite,
    closurePathDecision,
    citationRefs,
    notes: [
      `metricRequired.tensorRef=${tensorRef}`,
      `metricRequired.model.fluxHandling=${args.metricRequiredTensorInput.model?.fluxHandling ?? "unknown"}`,
      `metricRequired.model.shearHandling=${args.metricRequiredTensorInput.model?.shearHandling ?? "unknown"}`,
      `routeId=${routeId ?? "unknown"}`,
      `routeAdmissionRaw=${routeAdmissionRaw}`,
      `routeAdmissionEffective=${routeAdmissionEffective}`,
      `routeAdmissionPromotionBasis=${routeAdmissionPromotionBasis}`,
      `chartRef=${chartLabel}`,
      `finiteDifferenceStatus=${checks.finiteDifferenceConvergence}`,
      `finiteDifferenceComparedSampleCount=${finiteComparedSampleCount ?? "unknown"}`,
      `finiteDifferenceRouteLocalComparedSampleCount=${finiteRouteLocalComparedSampleCount ?? "unknown"}`,
      `finiteDifferenceRouteSuppressedSampleCount=${finiteRouteSuppressedSampleCount ?? "unknown"}`,
      `finiteDifferenceNumericalFloorSuppressedSampleCount=${finiteNumericalFloorSuppressedSampleCount ?? "unknown"}`,
      `finiteDifferenceTripletComparedSampleCount=${finiteTripletComparedSampleCount ?? "unknown"}`,
      `finiteDifferenceFailureMode=${finiteConvergenceFailureMode ?? "unknown"}`,
      `finiteDifferenceSignificanceFloorRelativeToT00=${finiteConvergenceSignificanceFloorRelativeToT00 ?? "unknown"}`,
      `finiteDifferenceThreshold=${finiteRelativeThreshold ?? "unknown"}`,
      `finiteDifferenceT0iDriftMax=${finiteT0iDriftMax ?? "unknown"}`,
      `finiteDifferenceT0iDriftRefinedMax=${finiteT0iRefinedDriftMax ?? "unknown"}`,
      `finiteDifferenceT0iConvergenceOrderMean=${finiteT0iConvergenceOrderMean ?? "unknown"}`,
      `finiteDifferenceOffDiagonalDriftMax=${finiteOffDiagonalDriftMax ?? "unknown"}`,
      `finiteDifferenceOffDiagonalDriftRefinedMax=${finiteOffDiagonalRefinedDriftMax ?? "unknown"}`,
      `finiteDifferenceOffDiagonalConvergenceOrderMean=${finiteOffDiagonalConvergenceOrderMean ?? "unknown"}`,
      `finiteDifferenceFallbackComparable=${String(evaluatorClosureComparableToEinsteinRoute)}`,
      `finiteDifferenceFallbackComparedSampleCount=${finiteDifferenceFallbackComparedSampleCount ?? "unknown"}`,
      `finiteDifferenceFallbackResidualThreshold=${evaluatorFiniteDifferenceThreshold ?? "unknown"}`,
      `finiteDifferenceFallbackFinestT0iResidual=${evaluatorFinestT0iResidual ?? "unknown"}`,
      `finiteDifferenceFallbackFinestOffDiagonalResidual=${evaluatorFinestOffDiagonalResidual ?? "unknown"}`,
      `finiteDifferenceFallbackResidualThresholdPass=${evaluatorResidualThresholdPass == null ? "unknown" : String(evaluatorResidualThresholdPass)}`,
      `finiteDifferenceFallbackMonotonicPass=${evaluatorMonotonicPass == null ? "unknown" : String(evaluatorMonotonicPass)}`,
      `finiteDifferenceFallbackHasComparablePair=${String(evaluatorHasComparablePair)}`,
      `finiteDifferenceFallbackHasComparableTriplet=${String(evaluatorHasComparableTriplet)}`,
      `finiteDifferenceFallbackFailureMode=${finiteDifferenceFallbackFailureMode}`,
      `independentCrossCheckStatus=${checks.independentCrossCheck}`,
      `independentCrossCheckEvidencePresent=${String(independentCrossCheckEvidencePresent)}`,
      `independentCrossCheckEvidenceStatus=${independentCrossCheckEvidenceStatus}`,
      `independentCrossCheckAdmissionStatus=${independentCrossCheckAdmissionStatus}`,
      `independentCrossCheckAdmissionFailureMode=${independentCrossCheckAdmissionFailureMode}`,
      `independentCrossCheckFailureMode=${independentCrossCheckFailureMode ?? "unknown"}`,
      `independentCrossCheckFailureModeRaw=${independentCrossCheckFailureMode ?? "unknown"}`,
      `independentCrossCheckRef=${independentCrossCheckReference ?? "none"}`,
      `independentCrossCheckReferenceRouteId=${independentCrossCheckReferenceRouteId ?? "none"}`,
      `independentCrossCheckSameRoute=${String(independentCrossCheckDeclaredSameRoute)}`,
      `independentCrossCheckComparedSampleCount=${independentCrossCheckComparedSampleCount ?? "unknown"}`,
      `independentCrossCheckReferenceRouteSuppressedSampleCount=${independentCrossCheckReferenceRouteSuppressedSampleCount ?? "unknown"}`,
      `independentCrossCheckMaxRelativeResidual=${independentCrossCheckMaxRelativeResidual ?? "unknown"}`,
      `independentCrossCheckRelativeResidualThreshold=${independentCrossCheckRelativeResidualThreshold ?? "unknown"}`,
      `independentCrossCheckResidualPass=${independentCrossCheckResidualPass == null ? "unknown" : String(independentCrossCheckResidualPass)}`,
      `independentCrossCheckThresholdFailed=${String(independentCrossCheckThresholdFailed)}`,
      `independentCrossCheckRouteIndependent=${independentCrossCheckRouteIndependentEffective == null ? "unknown" : String(independentCrossCheckRouteIndependentEffective)}`,
      `independentCrossCheckReferenceComparable=${independentCrossCheckReferenceComparable == null ? "unknown" : String(independentCrossCheckReferenceComparable)}`,
      `independentCrossCheckT00ComparedSampleCount=${independentCrossCheckT00ComparedSampleCount ?? "unknown"}`,
      `independentCrossCheckT00MaxRelativeResidual=${independentCrossCheckT00MaxRelativeResidual ?? "unknown"}`,
      `independentCrossCheckT00ResidualPass=${independentCrossCheckT00ResidualPass == null ? "unknown" : String(independentCrossCheckT00ResidualPass)}`,
      `independentCrossCheckT00ReferenceComparable=${independentCrossCheckT00Comparable == null ? "unknown" : String(independentCrossCheckT00Comparable)}`,
      `einsteinTensorRouteStatus=${effectiveEinsteinRouteEvidenceStatus}`,
      `einsteinTensorRouteId=${einsteinTensorRouteId ?? "none"}`,
      `einsteinTensorTensorSource=${einsteinTensorTensorSource ?? "unknown"}`,
      `einsteinTensorComparedSampleCount=${einsteinTensorComparedSampleCount ?? "unknown"}`,
      `einsteinTensorMaxRelativeResidual=${einsteinTensorMaxRelativeResidual ?? "unknown"}`,
      `einsteinTensorT00ComparedSampleCount=${einsteinTensorT00ComparedSampleCount ?? "unknown"}`,
      `einsteinTensorT00MaxRelativeResidual=${einsteinTensorT00MaxRelativeResidual ?? "unknown"}`,
      `einsteinTensorT00RelativeResidualThreshold=${einsteinT00ResidualThreshold ?? "unknown"}`,
      `einsteinT00ComparabilityStatus=${checks.einsteinT00Comparability}`,
      `fullEinsteinRouteAdmissionStatus=${checks.fullEinsteinTensorRouteAdmission}`,
      `fullEinsteinEvidenceAdmissionPass=${String(fullEinsteinEvidenceAdmissionPass)}`,
      `fullEinsteinPolicyAdmissionPass=${String(fullEinsteinPolicyAdmissionPass)}`,
      `einsteinResidualAttributionStatus=${effectiveResidualAttributionStatus}`,
      `einsteinResidualAttributionSampleCount=${effectiveResidualAttributionSampleCount ?? "unknown"}`,
      `einsteinResidualAttributionMaxRelativeResidual=${effectiveResidualAttributionMaxRelativeResidual ?? "unknown"}`,
      `einsteinResidualAttributionDiagnosisClass=${effectiveResidualAttributionDiagnosisClass}`,
      `einsteinResidualAttributionBestCandidateId=${effectiveResidualAttributionBestCandidateId ?? "none"}`,
      `einsteinResidualAttributionBestCandidateResidual=${effectiveResidualAttributionBestCandidateResidual ?? "unknown"}`,
      `einsteinResidualAttributionComponents=${NHM2_EINSTEIN_COMPARE_CANONICAL_KEYS.map((key) => `${key}:${residualAttributionComponentResiduals[key] ?? "unknown"}`).join("|")}`,
      `einsteinEvaluatorClosureStatus=${effectiveEvaluatorClosureStatus}`,
      `einsteinEvaluatorClosureChartRef=${evaluatorClosureChartRef ?? chartLabel}`,
      `einsteinEvaluatorClosureRouteId=${evaluatorClosureRouteId ?? einsteinTensorRouteId ?? "none"}`,
      `einsteinEvaluatorClosureUnitConvention=${evaluatorClosureUnitConvention ?? "unknown"}`,
      `einsteinEvaluatorClosureSignConvention=${evaluatorClosureSignConvention ?? "unknown"}`,
      `einsteinEvaluatorClosureCoarseStep=${effectiveEvaluatorClosureResolutionSweep.coarse.step_m ?? "unknown"}`,
      `einsteinEvaluatorClosureRefinedStep=${effectiveEvaluatorClosureResolutionSweep.refined.step_m ?? "unknown"}`,
      `einsteinEvaluatorClosureSuperRefinedStep=${effectiveEvaluatorClosureResolutionSweep.superRefined.step_m ?? "unknown"}`,
      `einsteinEvaluatorClosureCoarseSampleCount=${effectiveEvaluatorClosureResolutionSweep.coarse.comparedSampleCount ?? "unknown"}`,
      `einsteinEvaluatorClosureRefinedSampleCount=${effectiveEvaluatorClosureResolutionSweep.refined.comparedSampleCount ?? "unknown"}`,
      `einsteinEvaluatorClosureSuperRefinedSampleCount=${effectiveEvaluatorClosureResolutionSweep.superRefined.comparedSampleCount ?? "unknown"}`,
      `einsteinEvaluatorClosureCoarseT0iResidual=${effectiveEvaluatorClosureResolutionSweep.coarse.t0iMaxRelativeResidual ?? "unknown"}`,
      `einsteinEvaluatorClosureCoarseOffDiagonalResidual=${effectiveEvaluatorClosureResolutionSweep.coarse.offDiagonalMaxRelativeResidual ?? "unknown"}`,
      `einsteinEvaluatorClosureRefinedT0iResidual=${effectiveEvaluatorClosureResolutionSweep.refined.t0iMaxRelativeResidual ?? "unknown"}`,
      `einsteinEvaluatorClosureRefinedOffDiagonalResidual=${effectiveEvaluatorClosureResolutionSweep.refined.offDiagonalMaxRelativeResidual ?? "unknown"}`,
      `einsteinEvaluatorClosureSuperRefinedT0iResidual=${effectiveEvaluatorClosureResolutionSweep.superRefined.t0iMaxRelativeResidual ?? "unknown"}`,
      `einsteinEvaluatorClosureSuperRefinedOffDiagonalResidual=${effectiveEvaluatorClosureResolutionSweep.superRefined.offDiagonalMaxRelativeResidual ?? "unknown"}`,
      `einsteinEvaluatorClosureObservedOrderT0i=${effectiveEvaluatorClosureConvergenceOrder.t0i ?? "unknown"}`,
      `einsteinEvaluatorClosureObservedOrderOffDiagonal=${effectiveEvaluatorClosureConvergenceOrder.offDiagonal ?? "unknown"}`,
      `einsteinEvaluatorClosureRichardsonT0i=${effectiveEvaluatorClosureRichardsonResidual.t0i ?? "unknown"}`,
      `einsteinEvaluatorClosureRichardsonOffDiagonal=${effectiveEvaluatorClosureRichardsonResidual.offDiagonal ?? "unknown"}`,
      `einsteinEvaluatorClosureDiagnosisClass=${effectiveEvaluatorClosureDiagnosisClass}`,
      `einsteinEvaluatorClosureBestCandidateId=${effectiveEvaluatorClosureBestCandidateId ?? "none"}`,
      `einsteinEvaluatorClosureCitationRefs=${effectiveEvaluatorClosureCitationRefs.length > 0 ? effectiveEvaluatorClosureCitationRefs.join(",") : "none"}`,
      `dtGammaPolicy=${dtGammaPolicy ?? "unknown"}`,
      `dtGammaClosureMode=${dtGammaClosureMode}`,
      `dtGammaStaticEuclideanGamma=${String(hasStaticEuclideanGamma)}`,
      `dtGammaExpectedRoute=${String(hasExpectedModelTermRoute)}`,
      `dtGammaThetaMax=${dtGammaThetaMax ?? "unknown"}`,
      `dtGammaThetaThreshold=${NHM2_MODEL_TERM_DT_GAMMA_THETA_MAX}`,
      `citationCoverageStatus=${checks.citationCoverage}`,
      `citationCoverageMissingRefs=${Array.from(new Set([...citationCoverage.missingRefs, ...citationRefsMissingRefs])).length > 0 ? Array.from(new Set([...citationCoverage.missingRefs, ...citationRefsMissingRefs])).join(",") : "none"}`,
      `einsteinValidationSuite.status=${einsteinRouteValidationSuite.status}`,
      `einsteinValidationSuite.admittedForRoutePass=${String(einsteinRouteValidationSuite.admittedForRoutePass)}`,
      `einsteinValidationSuite.evaluatedCaseCount=${einsteinRouteValidationSuite.evaluatedCaseCount}`,
      `einsteinValidationSuite.passedCaseCount=${einsteinRouteValidationSuite.passedCaseCount}`,
      `einsteinValidationSuite.residualThreshold=${einsteinRouteValidationSuite.residualThreshold ?? "unknown"}`,
      `einsteinValidationSuite.caseResults=${einsteinRouteValidationSuite.cases
        .map(
          (entry) =>
            `${entry.caseId}:${entry.status}:${entry.maxAbsResidual ?? "unknown"}`,
        )
        .join("|")}`,
      `structuralPass=${String(structuralPass)}`,
      `derivationRoutePass=${String(derivationRoutePass)}`,
      `closurePath.selected=${closurePathDecision.selectedPath}`,
      `closurePath.nextPatchClass=${closurePathDecision.nextPatchClass}`,
      `closurePath.rationale=${closurePathDecision.rationale ?? "none"}`,
      `closurePath.patchBriefRef=${closurePathDecision.patchBriefRef ?? "none"}`,
      `reasonCodes.blocking=${routeScopedReasonCodes.blockerCodes.length > 0 ? routeScopedReasonCodes.blockerCodes.join(",") : "none"}`,
      `reasonCodes.nonBlocking=${routeScopedReasonCodes.nonBlockingCodes.length > 0 ? routeScopedReasonCodes.nonBlockingCodes.join(",") : "none"}`,
      `reasonCodes.suppressedOutOfPath=${routeScopedReasonCodes.suppressedOutOfPathCodes.length > 0 ? routeScopedReasonCodes.suppressedOutOfPathCodes.join(",") : "none"}`,
    ],
  };
};

const resolveMetricProducerAdmissionBranch = (args: {
  familyKind: "t0i" | "off_diagonal_tij";
  familyPresentInRuntime: boolean;
  familyMissingInObserverInput: boolean;
  familyEmissionAdmission: "admitted" | "experimental_not_admitted" | "unknown";
  familyEmissionAdmissionEffective:
    | "admitted"
    | "experimental_not_admitted"
    | "unknown";
  currentEmissionShape: Nhm2ObserverMetricProducerAdmissionEvidence["currentEmissionShape"];
  modelTermSemanticDecision: Nhm2ObserverModelTermSemanticAdmissionEvidence["decision"];
  supportFieldEvidence: Nhm2MetricProducerSupportFieldEvidence;
}): Nhm2ObserverMetricComponentAdmissionStatus => {
  if (args.familyPresentInRuntime && args.familyMissingInObserverInput) {
    return "existing_internal_quantity_not_serialized";
  }
  if (args.familyPresentInRuntime) {
    if (
      args.familyEmissionAdmissionEffective === "admitted" &&
      args.modelTermSemanticDecision !== "do_not_admit"
    ) {
      return "derivable_same_chart_from_existing_state";
    }
    if (args.familyEmissionAdmissionEffective === "experimental_not_admitted") {
      return "requires_new_model_term";
    }
    if (args.modelTermSemanticDecision === "do_not_admit") {
      return "requires_new_model_term";
    }
    return "basis_or_semantics_ambiguous";
  }

  const support = args.supportFieldEvidence;
  const fullEinsteinReady = support.full_einstein_tensor_route === "present_admitted";
  if (args.familyKind === "t0i") {
    const momentumConstraintReady =
      support.beta_i === "present_admitted" &&
      support.gamma_ij === "present_admitted" &&
      support.K_ij === "present_admitted" &&
      support.D_j_Kj_i_minus_D_i_K_route === "present_admitted";
    if (fullEinsteinReady || momentumConstraintReady) {
      return "derivable_same_chart_from_existing_state";
    }
  } else {
    const stressEvolutionReady =
      support.gamma_ij === "present_admitted" &&
      support.K_ij === "present_admitted" &&
      support.time_derivative_or_Kij_evolution_route === "present_admitted";
    if (fullEinsteinReady || stressEvolutionReady) {
      return "derivable_same_chart_from_existing_state";
    }
  }

  if (args.currentEmissionShape === "diagonal_only") {
    return "requires_new_model_term";
  }
  return "basis_or_semantics_ambiguous";
};

const buildMetricProducerAdmissionNotes = (args: {
  t0iBranch: Nhm2ObserverMetricComponentAdmissionStatus;
  offDiagonalBranch: Nhm2ObserverMetricComponentAdmissionStatus;
  supportFieldEvidence: Nhm2MetricProducerSupportFieldEvidence;
  currentEmissionShape: Nhm2ObserverMetricProducerAdmissionEvidence["currentEmissionShape"];
  familyEmissionAdmission: "admitted" | "experimental_not_admitted" | "unknown";
  modelTermRoute: string | null;
}): {
  t0iNote: string | null;
  offDiagonalNote: string | null;
  notes: string[];
} => {
  const support = args.supportFieldEvidence;
  const emittedViaExperimentalModelTerm =
    args.currentEmissionShape === "full_tensor" &&
    args.familyEmissionAdmission === "experimental_not_admitted";
  const t0iNote =
    args.t0iBranch === "existing_internal_quantity_not_serialized"
      ? "Same-chart T0i appears upstream on the producer path but is not currently wired into the observer publication lane."
      : args.t0iBranch === "derivable_same_chart_from_existing_state"
        ? "Same-chart T0i is derivable from currently admitted producer state without introducing a new physics term."
        : args.t0iBranch === "requires_new_model_term"
          ? emittedViaExperimentalModelTerm
            ? "Same-chart T0i is emitted through an experimental model-term route and remains not admitted until metric tensor semantics/evaluator validation closes."
            : "Current producer remains diagonal-only and does not expose an admitted momentum-constraint-grade route (D_j K^j_i - D_i K) or full Einstein-tensor route for same-chart J_i/T0i."
          : "Current evidence is insufficient to resolve whether same-chart T0i is wiring-limited, derivable, or model-limited.";
  const offDiagonalNote =
    args.offDiagonalBranch === "existing_internal_quantity_not_serialized"
      ? "Same-chart off-diagonal Tij components appear upstream on the producer path but are not currently wired into observer publication."
      : args.offDiagonalBranch === "derivable_same_chart_from_existing_state"
        ? "Same-chart off-diagonal Tij is derivable from currently admitted producer state without introducing a new physics term."
        : args.offDiagonalBranch === "requires_new_model_term"
          ? emittedViaExperimentalModelTerm
            ? "Same-chart off-diagonal Tij is emitted through an experimental model-term route and remains not admitted until the route is semantically validated."
            : "Current producer does not expose an admitted stress/evolution route (time-derivative or K_ij evolution) or full Einstein-tensor route for same-chart off-diagonal S_ij/Tij."
          : "Current evidence is insufficient to resolve whether off-diagonal Tij is wiring-limited, derivable, or model-limited.";
  const notes = [
    `currentEmissionShape=${args.currentEmissionShape}`,
    `familyEmissionAdmission=${args.familyEmissionAdmission}`,
    `modelTermRoute=${args.modelTermRoute ?? "none"}`,
    `support.alpha=${support.alpha}`,
    `support.beta_i=${support.beta_i}`,
    `support.gamma_ij=${support.gamma_ij}`,
    `support.K_ij=${support.K_ij}`,
    `support.D_j_Kj_i_minus_D_i_K_route=${support.D_j_Kj_i_minus_D_i_K_route}`,
    `support.time_derivative_or_Kij_evolution_route=${support.time_derivative_or_Kij_evolution_route}`,
    `support.full_einstein_tensor_route=${support.full_einstein_tensor_route}`,
  ];
  return {
    t0iNote,
    offDiagonalNote,
    notes,
  };
};

const deriveNhm2MetricProducerAdmissionEvidence = (
  state: EnergyPipelineState,
  metricRequiredTensorInput: BuildNhm2ObserverAuditTensorInput,
  modelTermSemanticEvidence:
    | Pick<
        Nhm2ObserverModelTermSemanticAdmissionEvidence,
        "decision" | "routeAdmissionEffective"
      >
    | null = null,
): Nhm2ObserverMetricProducerAdmissionEvidence => {
  const { warpState, adapter } = resolveNhm2ArtifactContext(state);
  const metricStressRaw = (warpState?.metricStressEnergy ??
    null) as Record<string, unknown> | null;
  const metricStressDiagnostics = (warpState?.metricStressDiagnostics ??
    null) as Record<string, unknown> | null;
  const modelTermUncertaintyDiagnostics = (metricStressDiagnostics?.modelTermUncertainty ??
    null) as Record<string, unknown> | null;
  const einsteinTensorRouteDiagnostics = (modelTermUncertaintyDiagnostics?.einsteinTensorRoute ??
    null) as Record<string, unknown> | null;
  const einsteinTensorRouteStatus = asText(einsteinTensorRouteDiagnostics?.status);
  const einsteinTensorRouteId = asText(einsteinTensorRouteDiagnostics?.routeId);
  const modelTermRoute = asText(metricStressRaw?.modelTermRoute);
  const researchBasisRef = asText(metricStressRaw?.researchBasisRef);
  const modelTermAdmissionRaw = asText(metricStressRaw?.modelTermAdmission);
  const familyEmissionAdmission: "admitted" | "experimental_not_admitted" | "unknown" =
    modelTermAdmissionRaw === "admitted" ||
    modelTermAdmissionRaw === "experimental_not_admitted"
      ? modelTermAdmissionRaw
      : "unknown";
  const familyEmissionAdmissionEffective:
    | "admitted"
    | "experimental_not_admitted"
    | "unknown" =
    modelTermSemanticEvidence?.routeAdmissionEffective ?? familyEmissionAdmission;
  const modelTermSemanticDecision =
    modelTermSemanticEvidence?.decision ?? "unknown";
  const outputFamilies: string[] = [];
  for (const key of ["T00", "T11", "T22", "T33"]) {
    if (toFiniteNumber(metricStressRaw?.[key]) != null) {
      outputFamilies.push(key);
    }
  }
  for (const key of [...NHM2_T0I_FAMILY_KEYS, ...NHM2_OFF_DIAGONAL_TIJ_FAMILY_KEYS]) {
    if (toFiniteNumber(metricStressRaw?.[key]) != null) {
      outputFamilies.push(key);
    }
  }
  const hasT0iRuntimeFamily = NHM2_T0I_FAMILY_KEYS.every(
    (key) => toFiniteNumber(metricStressRaw?.[key]) != null,
  );
  const hasOffDiagonalRuntimeFamily = NHM2_OFF_DIAGONAL_TIJ_CANONICAL_PAIRS.every(
    ([primary, mirror]) =>
      toFiniteNumber(metricStressRaw?.[primary]) != null ||
      toFiniteNumber(metricStressRaw?.[mirror]) != null,
  );
  const missingInputs = new Set(metricRequiredTensorInput.missingInputs ?? []);
  const t0iMissingInObserverInput = missingInputs.has("metric_t0i_missing");
  const offDiagonalMissingInObserverInput = missingInputs.has(
    "metric_tij_off_diagonal_missing",
  );
  const chartRef =
    typeof adapter?.chart?.label === "string" && adapter.chart.label.length > 0
      ? adapter.chart.label
      : "unknown";
  const hasShiftVectorEvaluator =
    warpState?.shiftVectorField != null &&
    typeof (warpState.shiftVectorField as Record<string, unknown>)
      .evaluateShiftVector === "function";
  const hasExpectedRouteMetadata =
    modelTermRoute === NHM2_MODEL_TERM_EXPECTED_ROUTE_ID ||
    modelTermRoute === NHM2_MODEL_TERM_LEGACY_ROUTE_ID;
  const hasModelTermFluxOrShearFamily =
    hasT0iRuntimeFamily || hasOffDiagonalRuntimeFamily;
  const inferredShiftVectorSupport =
    hasExpectedRouteMetadata && hasModelTermFluxOrShearFamily;
  const hasShiftVectorSupport =
    hasShiftVectorEvaluator || inferredShiftVectorSupport;
  const supportFieldEvidence: Nhm2MetricProducerSupportFieldEvidence = {
    alpha: toFiniteNumber(adapter?.alpha) != null ? "present_admitted" : "missing",
    beta_i: hasShiftVectorEvaluator
      ? "present_admitted"
      : inferredShiftVectorSupport
        ? familyEmissionAdmission === "admitted"
          ? "present_admitted"
          : "present_but_not_admitted"
        : "missing",
    gamma_ij: isFiniteTriplet(adapter?.gammaDiag) ? "present_admitted" : "missing",
    K_ij: hasShiftVectorSupport
      ? familyEmissionAdmission === "admitted"
        ? "present_admitted"
        : "present_but_not_admitted"
      : "missing",
    D_j_Kj_i_minus_D_i_K_route:
      hasT0iRuntimeFamily && hasShiftVectorSupport
        ? familyEmissionAdmission === "admitted"
          ? "present_admitted"
          : "present_but_not_admitted"
        : "missing",
    time_derivative_or_Kij_evolution_route:
      hasOffDiagonalRuntimeFamily && hasShiftVectorSupport
        ? familyEmissionAdmission === "admitted"
          ? "present_admitted"
          : "present_but_not_admitted"
        : "missing",
    full_einstein_tensor_route:
      einsteinTensorRouteStatus === "available"
        ? familyEmissionAdmission === "admitted"
          ? "present_admitted"
          : "present_but_not_admitted"
        : "missing",
  };
  const currentEmissionShape: Nhm2ObserverMetricProducerAdmissionEvidence["currentEmissionShape"] =
    hasT0iRuntimeFamily || hasOffDiagonalRuntimeFamily ? "full_tensor" : "diagonal_only";
  const t0iAdmissionBranch = resolveMetricProducerAdmissionBranch({
    familyKind: "t0i",
    familyPresentInRuntime: hasT0iRuntimeFamily,
    familyMissingInObserverInput: t0iMissingInObserverInput,
    familyEmissionAdmission,
    familyEmissionAdmissionEffective,
    currentEmissionShape,
    modelTermSemanticDecision,
    supportFieldEvidence,
  });
  const offDiagonalTijAdmissionBranch = resolveMetricProducerAdmissionBranch({
    familyKind: "off_diagonal_tij",
    familyPresentInRuntime: hasOffDiagonalRuntimeFamily,
    familyMissingInObserverInput: offDiagonalMissingInObserverInput,
    familyEmissionAdmission,
    familyEmissionAdmissionEffective,
    currentEmissionShape,
    modelTermSemanticDecision,
    supportFieldEvidence,
  });
  const noteBundle = buildMetricProducerAdmissionNotes({
    t0iBranch: t0iAdmissionBranch,
    offDiagonalBranch: offDiagonalTijAdmissionBranch,
    supportFieldEvidence,
    currentEmissionShape,
    familyEmissionAdmission,
    modelTermRoute,
  });
  return {
    semanticsRef: NHM2_FULL_TENSOR_SEMANTICS_REF,
    chartRef,
    producerModuleRef: [...NHM2_METRIC_PRODUCER_MODULE_REFS],
    currentEmissionShape,
    currentOutputFamilies: outputFamilies.length > 0 ? outputFamilies : ["none_emitted"],
    supportFieldEvidence,
    t0iAdmissionBranch,
    offDiagonalTijAdmissionBranch,
    nextInspectionTarget:
      currentEmissionShape === "diagonal_only"
        ? "modules/warp/natario-warp.ts::calculateMetricStressEnergyTensorAtPointFromShiftField"
        : t0iMissingInObserverInput || offDiagonalMissingInObserverInput
          ? "server/energy-pipeline.ts::buildDiagonalMetricObserverAuditTensorInput"
          : familyEmissionAdmission === "experimental_not_admitted"
            ? researchBasisRef ?? NHM2_FULL_TENSOR_SEMANTICS_REF
            : "modules/warp/natario-warp.ts::calculateMetricStressEnergyFromShiftField",
    notes: [
      `metricRequired.tensorRef=${metricRequiredTensorInput.tensorRef ?? "warp.metricStressEnergy"}`,
      `metricRequired.model.fluxHandling=${metricRequiredTensorInput.model?.fluxHandling ?? "unknown"}`,
      `metricRequired.model.shearHandling=${metricRequiredTensorInput.model?.shearHandling ?? "unknown"}`,
      `modelTermRoute=${modelTermRoute ?? "unknown"}`,
      `modelTermAdmission=${familyEmissionAdmission}`,
      `modelTermAdmissionEffective=${familyEmissionAdmissionEffective}`,
      `hasShiftVectorEvaluator=${String(hasShiftVectorEvaluator)}`,
      `hasExpectedRouteMetadata=${String(hasExpectedRouteMetadata)}`,
      `inferredShiftVectorSupport=${String(inferredShiftVectorSupport)}`,
      `einsteinTensorRouteStatus=${einsteinTensorRouteStatus ?? "unknown"}`,
      `einsteinTensorRouteId=${einsteinTensorRouteId ?? "none"}`,
      `researchBasisRef=${researchBasisRef ?? "none"}`,
      ...noteBundle.notes,
    ],
  };
};

const deriveNhm2T00PolicyAdmissionBridgeEvidence = (
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence,
): Nhm2ObserverT00PolicyAdmissionBridgeEvidence => {
  const checks = modelTermSemanticEvidence.checks;
  const selectedPath = modelTermSemanticEvidence.closurePathDecision?.selectedPath ?? null;
  const routeId =
    modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    modelTermSemanticEvidence.routeId ??
    null;
  const requiredChecks = [
    checks.fullEinsteinTensorRouteAdmission,
    checks.einsteinT00Comparability,
    checks.independentCrossCheck,
    checks.finiteDifferenceConvergence,
    checks.citationCoverage,
  ];
  const hasUnknownCheck = requiredChecks.some((status) => status === "unknown");
  const fullEinsteinPathSelected = selectedPath === "full_einstein_tensor";
  const routeAdmissionEffectiveAdmitted =
    modelTermSemanticEvidence.routeAdmissionEffective === "admitted";
  const pass =
    checks.fullEinsteinTensorRouteAdmission === "pass" &&
    checks.einsteinT00Comparability === "pass" &&
    checks.independentCrossCheck === "pass" &&
    checks.finiteDifferenceConvergence === "pass" &&
    checks.citationCoverage === "pass" &&
    fullEinsteinPathSelected &&
    routeAdmissionEffectiveAdmitted;
  const fail = !pass && !hasUnknownCheck;
  const status: Nhm2ObserverT00PolicyAdmissionBridgeEvidence["status"] = pass
    ? "pass"
    : fail
      ? "fail"
      : "unknown";
  const missingOrFailingChecks = [
    `fullEinsteinTensorRouteAdmission=${checks.fullEinsteinTensorRouteAdmission}`,
    `einsteinT00Comparability=${checks.einsteinT00Comparability}`,
    `independentCrossCheck=${checks.independentCrossCheck}`,
    `finiteDifferenceConvergence=${checks.finiteDifferenceConvergence}`,
    `citationCoverage=${checks.citationCoverage}`,
    `selectedPath=${selectedPath ?? "none"}`,
    `routeAdmissionEffective=${modelTermSemanticEvidence.routeAdmissionEffective}`,
  ].join("; ");
  const rationale =
    status === "pass"
      ? "Observer-local T00 policy bridge passes on the selected full_einstein_tensor path with admitted Einstein-route closure, T00 comparability, finite-difference convergence, independent cross-check, and citation coverage."
      : status === "fail"
        ? `Observer-local T00 policy bridge is not yet satisfied (${missingOrFailingChecks}).`
        : `Observer-local T00 policy bridge remains unresolved due unknown checks (${missingOrFailingChecks}).`;
  const citationRefs = Array.from(
    new Set(
      [
        ...modelTermSemanticEvidence.citationRefs,
        ...(modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  return {
    status,
    routeId,
    chartRef: modelTermSemanticEvidence.chartRef ?? null,
    selectedPath,
    routeAdmissionRaw: modelTermSemanticEvidence.routeAdmissionRaw,
    routeAdmissionEffective: modelTermSemanticEvidence.routeAdmissionEffective,
    routeAdmissionPromotionBasis:
      modelTermSemanticEvidence.routeAdmissionPromotionBasis,
    checks: {
      fullEinsteinTensorRouteAdmission: checks.fullEinsteinTensorRouteAdmission,
      einsteinT00Comparability: checks.einsteinT00Comparability,
      independentCrossCheck: checks.independentCrossCheck,
      finiteDifferenceConvergence: checks.finiteDifferenceConvergence,
      citationCoverage: checks.citationCoverage,
    },
    pass,
    rationale,
    citationRefs,
    notes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `routeAdmissionRaw=${modelTermSemanticEvidence.routeAdmissionRaw}`,
      `routeAdmissionEffective=${modelTermSemanticEvidence.routeAdmissionEffective}`,
      `routeAdmissionPromotionBasis=${modelTermSemanticEvidence.routeAdmissionPromotionBasis}`,
      `fullEinsteinTensorRouteAdmission=${checks.fullEinsteinTensorRouteAdmission}`,
      `einsteinT00Comparability=${checks.einsteinT00Comparability}`,
      `independentCrossCheck=${checks.independentCrossCheck}`,
      `finiteDifferenceConvergence=${checks.finiteDifferenceConvergence}`,
      `citationCoverage=${checks.citationCoverage}`,
      `bridgeStatus=${status}`,
      `bridgePass=${String(pass)}`,
    ],
  };
};

const deriveNhm2MetricAdmissionSummaryFromEvidence = (args: {
  evidence: Nhm2ObserverMetricProducerAdmissionEvidence;
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
}): {
  coverageBlockerStatus: "consumer_drop" | "publication_drop" | "producer_not_emitted" | "semantics_ambiguous";
  coverageBlockerNote: string;
  firstMissingStage:
    | "observer_input_mapping"
    | "observer_publication_mapping"
    | "metric_tensor_emission"
    | "semantic_contract";
  emissionAdmissionStatus: "admitted" | "not_admitted" | "unknown";
  emissionAdmissionNote: string;
  t00AdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  t00RouteId: string | null;
  t00ComparabilityStatus: "pass" | "fail" | "unknown";
  t00AdmissionNote: string | null;
  t00PolicyAdmissionBridgeEvidence: Nhm2ObserverT00PolicyAdmissionBridgeEvidence;
  t0iAdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  t0iAdmissionNote: string | null;
  offDiagonalAdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  offDiagonalAdmissionNote: string | null;
  nextTechnicalAction:
    | "wire_existing_metric_inputs"
    | "emit_same_chart_metric_flux_and_shear_terms"
    | "resolve_metric_tensor_semantics";
} => {
  const t00PolicyAdmissionBridgeEvidence =
    deriveNhm2T00PolicyAdmissionBridgeEvidence(args.modelTermSemanticEvidence);
  const deriveT00AdmissionSummary = (): {
    status: Nhm2ObserverMetricComponentAdmissionStatus;
    routeId: string | null;
    comparabilityStatus: "pass" | "fail" | "unknown";
    note: string | null;
  } => {
    const comparabilityStatus =
      args.modelTermSemanticEvidence.checks.einsteinT00Comparability;
    const routeId =
      args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
      args.modelTermSemanticEvidence.routeId ??
      null;
    const fullEinsteinAdmitted =
      args.modelTermSemanticEvidence.checks.fullEinsteinTensorRouteAdmission ===
      "pass";
    const routeDeclaredAdmitted =
      args.modelTermSemanticEvidence.routeAdmissionRaw === "admitted";
    if (t00PolicyAdmissionBridgeEvidence.status === "pass") {
      return {
        status: "derivable_same_chart_from_existing_state",
        routeId,
        comparabilityStatus,
        note:
          "Metric-required observer rho/T00 is admitted via the Einstein-route policy bridge: full_einstein_tensor closure, comparable T00 residuals, independent cross-check, finite-difference convergence, and citation coverage all pass.",
      };
    }
    if (
      fullEinsteinAdmitted &&
      comparabilityStatus === "pass" &&
      routeDeclaredAdmitted
    ) {
      return {
        status: "derivable_same_chart_from_existing_state",
        routeId,
        comparabilityStatus,
        note:
          "Metric-required observer rho/T00 is admitted on the Einstein route with comparable independent cross-check residual evidence.",
      };
    }
    if (
      fullEinsteinAdmitted &&
      comparabilityStatus === "pass" &&
      !routeDeclaredAdmitted
    ) {
      return {
        status: "requires_new_model_term",
        routeId,
        comparabilityStatus,
        note:
          `Einstein-route T00 comparability is satisfied, but the observer-local policy bridge is ${t00PolicyAdmissionBridgeEvidence.status}; keep observer rho on legacy diagonal T00 until bridge evidence is admitted.`,
      };
    }
    if (
      comparabilityStatus === "fail" ||
      args.modelTermSemanticEvidence.checks.fullEinsteinTensorRouteAdmission ===
        "fail"
    ) {
      return {
        status: "requires_new_model_term",
        routeId,
        comparabilityStatus,
        note:
          "Einstein-route T00 either lacks admitted route closure or fails comparable residual checks; keep observer rho on legacy diagonal T00.",
      };
    }
    return {
      status: "basis_or_semantics_ambiguous",
      routeId,
      comparabilityStatus,
      note:
        "Einstein-route T00 admission/comparability remains unresolved; retain conservative legacy diagonal T00 for observer rho.",
    };
  };
  const t00Summary = deriveT00AdmissionSummary();
  const t0i = args.evidence.t0iAdmissionBranch;
  const offDiag = args.evidence.offDiagonalTijAdmissionBranch;
  const branches = [t0i, offDiag];
  const hasExistingInternal = branches.includes(
    "existing_internal_quantity_not_serialized",
  );
  const hasDerivable = branches.includes("derivable_same_chart_from_existing_state");
  const hasRequiresNewModel =
    branches.includes("requires_new_model_term") ||
    args.modelTermSemanticEvidence.decision === "do_not_admit";
  const familyEmissionAdmission = args.modelTermSemanticEvidence.routeAdmission;
  const modelTermRouteNote = args.evidence.notes.find((entry) =>
    entry.startsWith("modelTermRoute="),
  );
  const modelTermRoute =
    modelTermRouteNote != null
      ? modelTermRouteNote.slice("modelTermRoute=".length)
      : null;
  const noteBundle = buildMetricProducerAdmissionNotes({
    t0iBranch: t0i,
    offDiagonalBranch: offDiag,
    supportFieldEvidence: args.evidence.supportFieldEvidence,
    currentEmissionShape: args.evidence.currentEmissionShape,
    familyEmissionAdmission,
    modelTermRoute,
  });

  if (hasExistingInternal) {
    return {
      coverageBlockerStatus: "consumer_drop",
      coverageBlockerNote:
        "Metric-required observer completeness is blocked by mapping/publication wiring: same-chart component families exist on the producer path but are not wired into observer inputs/publication.",
      firstMissingStage: "observer_input_mapping",
      emissionAdmissionStatus: "not_admitted",
      emissionAdmissionNote:
        "Admission remains not_admitted until existing same-chart producer quantities are wired through observer input/publication mapping.",
      t00AdmissionStatus: t00Summary.status,
      t00RouteId: t00Summary.routeId,
      t00ComparabilityStatus: t00Summary.comparabilityStatus,
      t00AdmissionNote: t00Summary.note,
      t00PolicyAdmissionBridgeEvidence,
      t0iAdmissionStatus: t0i,
      t0iAdmissionNote: noteBundle.t0iNote,
      offDiagonalAdmissionStatus: offDiag,
      offDiagonalAdmissionNote: noteBundle.offDiagonalNote,
      nextTechnicalAction: "wire_existing_metric_inputs",
    };
  }

  if (hasRequiresNewModel) {
    if (args.evidence.currentEmissionShape === "full_tensor") {
      const closurePath = args.modelTermSemanticEvidence.closurePathDecision;
      const selectedPathReasonCodes =
        closurePath != null
          ? closurePath.blockerCodes
          : args.modelTermSemanticEvidence.reasonCodes;
      const semanticReasonCodes =
        selectedPathReasonCodes.length > 0
          ? selectedPathReasonCodes.join(", ")
          : "none";
      const nonBlockingReasonCodesList = closurePath?.nonBlockingCodes ?? [];
      const nonBlockingReasonCodes =
        nonBlockingReasonCodesList.length > 0
          ? nonBlockingReasonCodesList.join(", ")
          : "none";
      const closurePathSummary =
        closurePath == null
          ? "closure_path=unresolved"
          : `closure_path=${closurePath.selectedPath}; next_patch=${closurePath.nextPatchClass}; route_hint=${closurePath.routeHint}; selected_path_non_blocking_reasons=${nonBlockingReasonCodes}`;
      const semanticAdmissionSummary =
        args.modelTermSemanticEvidence.decision === "do_not_admit"
          ? `model-term semantic admission still rejects selected-route closure (decision=${args.modelTermSemanticEvidence.decision})`
          : selectedPathReasonCodes.length > 0
            ? `model-term semantic admission status is ${args.modelTermSemanticEvidence.decision}, but selected-route semantic blockers remain`
            : `model-term semantic admission admits selected-route closure, while observer publication remains conservative until component admission summaries are promoted`;
      return {
        coverageBlockerStatus: "semantics_ambiguous",
        coverageBlockerNote:
          `Metric-required full tensor families are emitted on the producer path, but ${semanticAdmissionSummary} (selected_path_blockers=${semanticReasonCodes}; ${closurePathSummary}), so observer admission remains blocked at semantic-contract closure.`,
        firstMissingStage: "semantic_contract",
        emissionAdmissionStatus: "not_admitted",
        emissionAdmissionNote:
          "Admission failed: emitted same-chart flux/shear families are present but remain tied to a non-admitted model-term route pending semantic validation and closure-path execution.",
        t00AdmissionStatus: t00Summary.status,
        t00RouteId: t00Summary.routeId,
        t00ComparabilityStatus: t00Summary.comparabilityStatus,
        t00AdmissionNote: t00Summary.note,
        t00PolicyAdmissionBridgeEvidence,
        t0iAdmissionStatus: t0i,
        t0iAdmissionNote: noteBundle.t0iNote,
        offDiagonalAdmissionStatus: offDiag,
        offDiagonalAdmissionNote: noteBundle.offDiagonalNote,
        nextTechnicalAction: "resolve_metric_tensor_semantics",
      };
    }
    return {
      coverageBlockerStatus: "producer_not_emitted",
      coverageBlockerNote:
        "Metric-required observer completeness remains blocked at producer emission: current runtime emits diagonal-only stress and lacks admitted same-chart routes required for J_i/T0i and off-diagonal S_ij/Tij closure.",
      firstMissingStage: "semantic_contract",
      emissionAdmissionStatus: "not_admitted",
      emissionAdmissionNote:
        "Admission failed: current evidence localizes both missing families to a model-term/evaluator gap rather than a wiring-only gap.",
      t00AdmissionStatus: t00Summary.status,
      t00RouteId: t00Summary.routeId,
      t00ComparabilityStatus: t00Summary.comparabilityStatus,
      t00AdmissionNote: t00Summary.note,
      t00PolicyAdmissionBridgeEvidence,
      t0iAdmissionStatus: t0i,
      t0iAdmissionNote: noteBundle.t0iNote,
      offDiagonalAdmissionStatus: offDiag,
      offDiagonalAdmissionNote: noteBundle.offDiagonalNote,
      nextTechnicalAction: "resolve_metric_tensor_semantics",
    };
  }

  if (hasDerivable) {
    if (args.evidence.currentEmissionShape === "full_tensor") {
      return {
        coverageBlockerStatus: "unknown",
        coverageBlockerNote:
          "Metric-required same-chart full tensor families are emitted and selected-route semantic blockers are cleared for the active Einstein-path closure.",
        firstMissingStage: "unknown",
        emissionAdmissionStatus: "admitted",
        emissionAdmissionNote:
          "Admission is accepted on the selected same-chart full-tensor route; ADM support-field-route gaps remain tracked as non-blocking diagnostics for this closure path.",
        t00AdmissionStatus: t00Summary.status,
        t00RouteId: t00Summary.routeId,
        t00ComparabilityStatus: t00Summary.comparabilityStatus,
        t00AdmissionNote: t00Summary.note,
        t00PolicyAdmissionBridgeEvidence,
        t0iAdmissionStatus: t0i,
        t0iAdmissionNote: noteBundle.t0iNote,
        offDiagonalAdmissionStatus: offDiag,
        offDiagonalAdmissionNote: noteBundle.offDiagonalNote,
        nextTechnicalAction: "unknown",
      };
    }
    return {
      coverageBlockerStatus: "producer_not_emitted",
      coverageBlockerNote:
        "Metric-required observer completeness is blocked at same-chart tensor emission: required support fields are already admitted, but missing families are not yet emitted.",
      firstMissingStage: "metric_tensor_emission",
      emissionAdmissionStatus: "not_admitted",
      emissionAdmissionNote:
        "Admission remains not_admitted until same-chart flux/shear families are emitted from currently admitted producer state.",
      t00AdmissionStatus: t00Summary.status,
      t00RouteId: t00Summary.routeId,
      t00ComparabilityStatus: t00Summary.comparabilityStatus,
      t00AdmissionNote: t00Summary.note,
      t00PolicyAdmissionBridgeEvidence,
      t0iAdmissionStatus: t0i,
      t0iAdmissionNote: noteBundle.t0iNote,
      offDiagonalAdmissionStatus: offDiag,
      offDiagonalAdmissionNote: noteBundle.offDiagonalNote,
      nextTechnicalAction: "emit_same_chart_metric_flux_and_shear_terms",
    };
  }

  return {
    coverageBlockerStatus: "semantics_ambiguous",
    coverageBlockerNote:
      "Metric-required observer completeness remains unresolved: producer evidence does not yet localize whether the gap is wiring, emission, or model semantics.",
    firstMissingStage: "semantic_contract",
    emissionAdmissionStatus: "unknown",
    emissionAdmissionNote:
      "Admission status could not be resolved from the currently published producer evidence.",
    t00AdmissionStatus: t00Summary.status,
    t00RouteId: t00Summary.routeId,
    t00ComparabilityStatus: t00Summary.comparabilityStatus,
    t00AdmissionNote: t00Summary.note,
    t00PolicyAdmissionBridgeEvidence,
    t0iAdmissionStatus: t0i,
    t0iAdmissionNote: noteBundle.t0iNote,
    offDiagonalAdmissionStatus: offDiag,
    offDiagonalAdmissionNote: noteBundle.offDiagonalNote,
    nextTechnicalAction: "resolve_metric_tensor_semantics",
  };
};

type Nhm2MetricAdmissionSummary = ReturnType<
  typeof deriveNhm2MetricAdmissionSummaryFromEvidence
>;

const isNhm2SameChartCompleteStatus = (
  status: Nhm2TensorComponentStatus,
): boolean => status === "computed" || status === "derived_same_chart";

const mapNhm2SupportEvidenceStatusToTensorStatus = (
  status: Nhm2MetricProducerEvidenceStatus | undefined,
): Nhm2TensorComponentStatus => {
  if (status === "present_admitted") return "computed";
  if (status === "present_but_not_admitted") return "blocked";
  if (status === "missing") return "missing";
  return "missing";
};

const firstFiniteTensorComponent = (
  tensor: Record<string, unknown> | null,
  keys: readonly string[],
): number | undefined => {
  if (tensor == null) return undefined;
  for (const key of keys) {
    const value = toFiniteNumber(tensor[key]);
    if (value != null) return value;
  }
  return undefined;
};

const finiteSameChartComponentValue = (
  tensor: Record<string, unknown> | null,
  componentId: Nhm2SameChartFullTensorComponentId,
): number | undefined => {
  switch (componentId) {
    case "T00":
      return firstFiniteTensorComponent(tensor, ["T00"]);
    case "T0x":
      return firstFiniteTensorComponent(tensor, ["T0x", "T01", "T10"]);
    case "T0y":
      return firstFiniteTensorComponent(tensor, ["T0y", "T02", "T20"]);
    case "T0z":
      return firstFiniteTensorComponent(tensor, ["T0z", "T03", "T30"]);
    case "Txx":
      return firstFiniteTensorComponent(tensor, ["Txx", "T11"]);
    case "Txy":
      return firstFiniteTensorComponent(tensor, ["Txy", "T12", "T21"]);
    case "Txz":
      return firstFiniteTensorComponent(tensor, ["Txz", "T13", "T31"]);
    case "Tyy":
      return firstFiniteTensorComponent(tensor, ["Tyy", "T22"]);
    case "Tyz":
      return firstFiniteTensorComponent(tensor, ["Tyz", "T23", "T32"]);
    case "Tzz":
      return firstFiniteTensorComponent(tensor, ["Tzz", "T33"]);
  }
};

const mapNhm2MetricAdmissionToTensorStatus = (args: {
  admissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  emissionAdmissionStatus: "admitted" | "not_admitted" | "unknown";
  hasFiniteValue: boolean;
}): Nhm2TensorComponentStatus => {
  if (args.hasFiniteValue) {
    if (
      args.emissionAdmissionStatus === "admitted" &&
      (args.admissionStatus === "derivable_same_chart_from_existing_state" ||
        args.admissionStatus === "existing_internal_quantity_not_serialized")
    ) {
      return "derived_same_chart";
    }
    if (
      args.admissionStatus === "requires_new_model_term" ||
      args.admissionStatus === "basis_or_semantics_ambiguous" ||
      args.emissionAdmissionStatus !== "admitted"
    ) {
      return "blocked";
    }
    return "computed";
  }
  if (
    args.admissionStatus === "derivable_same_chart_from_existing_state" ||
    args.admissionStatus === "existing_internal_quantity_not_serialized" ||
    args.admissionStatus === "basis_or_semantics_ambiguous" ||
    args.admissionStatus === "unknown"
  ) {
    return "blocked";
  }
  return "missing";
};

const resolveNhm2SameChartFullTensorSource = (args: {
  routeId: string | null;
  selectedPath: Nhm2ObserverModelTermClosurePath | null;
  hasRuntimeTensor: boolean;
}): Nhm2SameChartFullTensorProvenanceSource => {
  if (
    args.routeId === NHM2_MODEL_TERM_EINSTEIN_ROUTE_ID ||
    args.selectedPath === "full_einstein_tensor"
  ) {
    return "einstein_tensor_geometry_fd4_v1";
  }
  if (
    args.routeId === NHM2_MODEL_TERM_LEGACY_ROUTE_ID ||
    args.selectedPath === "adm_complete" ||
    (args.routeId != null && args.routeId.toLowerCase().includes("adm"))
  ) {
    return "adm_projection";
  }
  return args.hasRuntimeTensor ? "runtime_artifact" : "missing";
};

const nonCompleteBlockers = (
  status: Nhm2TensorComponentStatus,
  blockers: Array<string | null | undefined>,
): string[] => {
  if (isNhm2SameChartCompleteStatus(status) || status === "not_applicable") {
    return [];
  }
  return blockers.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
};

const buildNhm2SameChartFullTensorFromState = (args: {
  state: EnergyPipelineState;
  metricAdmissionSummary: Nhm2MetricAdmissionSummary;
  metricProducerAdmissionEvidence: Nhm2ObserverMetricProducerAdmissionEvidence;
  modelTermSemanticAdmissionEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
}): Nhm2SameChartFullTensorArtifactV1 => {
  const { warpState, adapter, metricT00Ref, metricFamily } =
    resolveNhm2ArtifactContext(args.state);
  const metricStressRaw =
    ((warpState?.metricStressEnergy ??
      ((warpState?.metricT00Source === "metric" ||
      warpState?.stressEnergySource === "metric"
        ? warpState?.stressEnergyTensor
        : null) as Record<string, unknown> | null)) as
      | Record<string, unknown>
      | null) ?? null;
  const tensor: Record<string, unknown> | null =
    metricStressRaw != null ? { ...metricStressRaw } : null;
  const einsteinRouteT00 = toFiniteNumber(metricStressRaw?.T00_modelTermEinstein);
  const preferEinsteinT00 =
    args.metricAdmissionSummary.t00AdmissionStatus ===
      "derivable_same_chart_from_existing_state" &&
    args.metricAdmissionSummary.t00ComparabilityStatus === "pass";
  if (tensor != null && preferEinsteinT00 && einsteinRouteT00 != null) {
    tensor.T00 = einsteinRouteT00;
  }

  const routeId =
    asText(args.modelTermSemanticAdmissionEvidence.einsteinTensorRouteEvidence?.routeId) ??
    asText(args.modelTermSemanticAdmissionEvidence.routeId) ??
    asText(metricStressRaw?.modelTermRoute) ??
    args.metricAdmissionSummary.t00RouteId ??
    "missing";
  const selectedPath =
    args.modelTermSemanticAdmissionEvidence.closurePathDecision?.selectedPath ?? null;
  const source = resolveNhm2SameChartFullTensorSource({
    routeId,
    selectedPath,
    hasRuntimeTensor: metricStressRaw != null,
  });
  const chartId =
    asText(args.modelTermSemanticAdmissionEvidence.chartRef) ??
    asText(args.metricProducerAdmissionEvidence.chartRef) ??
    asText(adapter?.chart?.label) ??
    "unknown";
  const selectedProfileId =
    asText((warpState?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
    asText((adapter?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
    asText((args.state.dynamicConfig as Record<string, unknown> | null | undefined)?.shiftLapseProfileId) ??
    DEFAULT_WARP_SHIFT_LAPSE_PROFILE_ID;
  const support = args.metricProducerAdmissionEvidence.supportFieldEvidence;
  const componentStatuses: Partial<
    Record<Nhm2SameChartFullTensorComponentId, Nhm2TensorComponentStatus>
  > = {};
  const componentBlockers: Partial<
    Record<Nhm2SameChartFullTensorComponentId, string[]>
  > = {};
  const componentAssumptions: Partial<
    Record<Nhm2SameChartFullTensorComponentId, string[]>
  > = {};
  const setComponent = (
    componentId: Nhm2SameChartFullTensorComponentId,
    status: Nhm2TensorComponentStatus,
    blockers: Array<string | null | undefined>,
    assumptions: string[] = [],
  ): void => {
    componentStatuses[componentId] = status;
    componentBlockers[componentId] = nonCompleteBlockers(status, blockers);
    componentAssumptions[componentId] = assumptions;
  };

  const t00Value = finiteSameChartComponentValue(tensor, "T00");
  setComponent(
    "T00",
    t00Value != null
      ? preferEinsteinT00
        ? "derived_same_chart"
        : "computed"
      : args.metricAdmissionSummary.t00AdmissionStatus === "requires_new_model_term" ||
          args.metricAdmissionSummary.t00AdmissionStatus === "basis_or_semantics_ambiguous"
        ? "blocked"
        : "missing",
    [
      args.metricAdmissionSummary.t00AdmissionNote,
      "metric_T00_required_for_same_chart_full_tensor",
    ],
    [
      `t00AdmissionStatus=${args.metricAdmissionSummary.t00AdmissionStatus}`,
      `t00ComparabilityStatus=${args.metricAdmissionSummary.t00ComparabilityStatus}`,
    ],
  );

  for (const componentId of ["Txx", "Tyy", "Tzz"] as const) {
    const value = finiteSameChartComponentValue(tensor, componentId);
    setComponent(
      componentId,
      value != null ? "computed" : "missing",
      [`metric_${componentId}_required_for_same_chart_full_tensor`],
    );
  }

  for (const componentId of ["T0x", "T0y", "T0z"] as const) {
    const status = mapNhm2MetricAdmissionToTensorStatus({
      admissionStatus: args.metricAdmissionSummary.t0iAdmissionStatus,
      emissionAdmissionStatus: args.metricAdmissionSummary.emissionAdmissionStatus,
      hasFiniteValue: finiteSameChartComponentValue(tensor, componentId) != null,
    });
    setComponent(
      componentId,
      status,
      [
        args.metricAdmissionSummary.t0iAdmissionNote,
        "metric_T0i_required_for_same_chart_full_tensor",
      ],
      [
        `metricT0iAdmissionStatus=${args.metricAdmissionSummary.t0iAdmissionStatus}`,
        `metricEmissionAdmissionStatus=${args.metricAdmissionSummary.emissionAdmissionStatus}`,
      ],
    );
  }

  for (const componentId of ["Txy", "Txz", "Tyz"] as const) {
    const status = mapNhm2MetricAdmissionToTensorStatus({
      admissionStatus: args.metricAdmissionSummary.offDiagonalAdmissionStatus,
      emissionAdmissionStatus: args.metricAdmissionSummary.emissionAdmissionStatus,
      hasFiniteValue: finiteSameChartComponentValue(tensor, componentId) != null,
    });
    setComponent(
      componentId,
      status,
      [
        args.metricAdmissionSummary.offDiagonalAdmissionNote,
        "metric_off_diagonal_Tij_required_for_same_chart_full_tensor",
      ],
      [
        `metricOffDiagonalTijAdmissionStatus=${args.metricAdmissionSummary.offDiagonalAdmissionStatus}`,
        `metricEmissionAdmissionStatus=${args.metricAdmissionSummary.emissionAdmissionStatus}`,
      ],
    );
  }

  return buildNhm2SameChartFullTensorArtifact({
    laneId: "nhm2_shift_lapse",
    selectedProfileId,
    chartId,
    metricFamily,
    routeId,
    source,
    artifactRef: args.metricTensorInput.tensorRef ?? metricT00Ref ?? "warp.metricStressEnergy",
    tensor,
    componentStatuses,
    componentAssumptions,
    componentBlockers,
    defaultAssumptions: [
      "diagnostic-only same-chart tensor inventory",
      "missing T0i or off-diagonal Tij channels block full tensor completeness",
      "observer audit diagonal closures do not define missing components as zero",
      `selectedPath=${selectedPath ?? "unknown"}`,
    ],
    adm: {
      alphaStatus: mapNhm2SupportEvidenceStatusToTensorStatus(support.alpha),
      betaStatus: mapNhm2SupportEvidenceStatusToTensorStatus(support.beta_i),
      gammaStatus: mapNhm2SupportEvidenceStatusToTensorStatus(support.gamma_ij),
      extrinsicCurvatureStatus: mapNhm2SupportEvidenceStatusToTensorStatus(
        support.K_ij,
      ),
    },
  });
};

const getNhm2ModelTermNoteValue = (
  notes: string[] | undefined,
  key: string,
): string | null => {
  if (!Array.isArray(notes) || notes.length === 0) return null;
  const prefix = `${key}=`;
  const matched = notes.find((entry) => entry.startsWith(prefix));
  return matched != null ? matched.slice(prefix.length) : null;
};

const getNhm2ModelTermNoteFiniteValue = (
  notes: string[] | undefined,
  key: string,
): number | null => toFiniteNumber(getNhm2ModelTermNoteValue(notes, key));

const getNhm2ModelTermNoteNonNegativeValue = (
  notes: string[] | undefined,
  key: string,
): number | null => {
  const value = getNhm2ModelTermNoteFiniteValue(notes, key);
  return value != null && value >= 0 ? value : null;
};

const classifyNhm2WecSign = (
  value: number | null,
): "negative" | "non_negative" | "unknown" => {
  if (value == null) return "unknown";
  return value < 0 ? "negative" : "non_negative";
};

const toTileReconstitutionComponentCoverage = (
  metricEmissionAdmissionStatus: "admitted" | "not_admitted" | "unknown",
  componentStatus: Nhm2ObserverMetricComponentAdmissionStatus,
): Nhm2ObserverTileSurfaceReconstitutionEvidence["componentCoverage"]["t0i"] => {
  if (
    componentStatus === "derivable_same_chart_from_existing_state" ||
    componentStatus === "existing_internal_quantity_not_serialized"
  ) {
    return metricEmissionAdmissionStatus === "admitted"
      ? "present_admitted"
      : "present_but_not_admitted";
  }
  if (
    componentStatus === "requires_new_model_term" ||
    componentStatus === "basis_or_semantics_ambiguous"
  ) {
    return "missing";
  }
  return "unknown";
};

const deriveNhm2TileComparableCrossCheckEvidence = (args: {
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
}): Nhm2ObserverTileComparableCrossCheckEvidence => {
  const modelChecks = args.modelTermSemanticEvidence.checks;
  const selectedPath =
    args.modelTermSemanticEvidence.closurePathDecision?.selectedPath ?? null;
  const routeId =
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    args.modelTermSemanticEvidence.routeId ??
    null;
  const routeAdmissionEffectiveAdmitted =
    args.modelTermSemanticEvidence.routeAdmissionEffective === "admitted";
  const routeAdmissionComparable =
    selectedPath === "full_einstein_tensor" &&
    routeAdmissionEffectiveAdmitted &&
    modelChecks.fullEinsteinTensorRouteAdmission === "pass" &&
    modelChecks.einsteinT00Comparability === "pass";
  const metricWecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.eulerianMin,
  );
  const metricWecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.robustMin,
  );
  const metricDecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.eulerianMin,
  );
  const metricDecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.robustMin,
  );
  const tileWecEulerianMin = toFiniteNumber(
    args.tileTensorInput.conditions?.wec?.eulerianMin,
  );
  const tileWecRobustMin = toFiniteNumber(
    args.tileTensorInput.conditions?.wec?.robustMin,
  );
  const tileDecEulerianMin = toFiniteNumber(
    args.tileTensorInput.conditions?.dec?.eulerianMin,
  );
  const tileDecRobustMin = toFiniteNumber(
    args.tileTensorInput.conditions?.dec?.robustMin,
  );
  const hasComparableWecMinima =
    metricWecEulerianMin != null &&
    metricWecRobustMin != null &&
    tileWecEulerianMin != null &&
    tileWecRobustMin != null;
  const hasComparableDecMinima =
    metricDecEulerianMin != null &&
    metricDecRobustMin != null &&
    tileDecEulerianMin != null &&
    tileDecRobustMin != null;
  const hasComparableMinima = hasComparableWecMinima || hasComparableDecMinima;
  const tileModel = args.tileTensorInput.model ?? {};
  const tileProxyDeclared =
    tileModel.pressureModel === "isotropic_pressure_proxy" ||
    tileModel.shearHandling === "not_modeled_in_proxy" ||
    tileModel.shearHandling === "assumed_zero_from_missing_tij";
  const independentCrossCheckStatus = modelChecks.independentCrossCheck;
  const comparabilityStatus: Nhm2ObserverTileComparableCrossCheckEvidence["comparabilityStatus"] =
    routeAdmissionComparable &&
    independentCrossCheckStatus === "pass" &&
    hasComparableMinima
      ? "pass"
      : independentCrossCheckStatus === "fail" || !routeAdmissionComparable
        ? "fail"
        : "unknown";
  const eulerianSignAgreement =
    metricWecEulerianMin != null && tileWecEulerianMin != null
      ? classifyNhm2WecSign(metricWecEulerianMin) ===
        classifyNhm2WecSign(tileWecEulerianMin)
      : null;
  const robustSignAgreement =
    metricWecRobustMin != null && tileWecRobustMin != null
      ? classifyNhm2WecSign(metricWecRobustMin) ===
        classifyNhm2WecSign(tileWecRobustMin)
      : null;
  const decEulerianSignAgreement =
    metricDecEulerianMin != null && tileDecEulerianMin != null
      ? classifyNhm2WecSign(metricDecEulerianMin) ===
        classifyNhm2WecSign(tileDecEulerianMin)
      : null;
  const decRobustSignAgreement =
    metricDecRobustMin != null && tileDecRobustMin != null
      ? classifyNhm2WecSign(metricDecRobustMin) ===
        classifyNhm2WecSign(tileDecRobustMin)
      : null;
  const eulerianMinDelta =
    metricWecEulerianMin != null && tileWecEulerianMin != null
      ? tileWecEulerianMin - metricWecEulerianMin
      : null;
  const robustMinDelta =
    metricWecRobustMin != null && tileWecRobustMin != null
      ? tileWecRobustMin - metricWecRobustMin
      : null;
  const metricRobustSign = classifyNhm2WecSign(metricWecRobustMin);
  const tileRobustSign = classifyNhm2WecSign(tileWecRobustMin);
  const metricDecRobustSign = classifyNhm2WecSign(metricDecRobustMin);
  const tileDecRobustSign = classifyNhm2WecSign(tileDecRobustMin);
  const decFailureSignal =
    (metricDecEulerianMin != null && metricDecEulerianMin < 0) ||
    (metricDecRobustMin != null && metricDecRobustMin < 0) ||
    (tileDecEulerianMin != null && tileDecEulerianMin < 0) ||
    (tileDecRobustMin != null && tileDecRobustMin < 0);
  const observerConditionFocus: "wec" | "dec" =
    hasComparableDecMinima && (!hasComparableWecMinima || decFailureSignal)
      ? "dec"
      : "wec";
  const focusedEulerianSignAgreement =
    observerConditionFocus === "dec"
      ? decEulerianSignAgreement
      : eulerianSignAgreement;
  const focusedRobustSignAgreement =
    observerConditionFocus === "dec" ? decRobustSignAgreement : robustSignAgreement;
  const metricFocusedRobustSign =
    observerConditionFocus === "dec" ? metricDecRobustSign : metricRobustSign;
  const tileFocusedRobustSign =
    observerConditionFocus === "dec" ? tileDecRobustSign : tileRobustSign;
  const localizationResult: Nhm2ObserverTileComparableCrossCheckEvidence["localizationResult"] =
    comparabilityStatus === "pass"
      ? focusedRobustSignAgreement === true || focusedEulerianSignAgreement === true
        ? "same_sign_confirmed"
        : focusedRobustSignAgreement === false ||
            focusedEulerianSignAgreement === false
          ? "proxy_artifact_suspected"
          : "inconclusive"
      : tileProxyDeclared &&
          metricFocusedRobustSign === "non_negative" &&
          tileFocusedRobustSign === "negative"
        ? "proxy_artifact_suspected"
        : "inconclusive";
  const nextPatchClass: Nhm2ObserverTileComparableCrossCheckEvidence["nextPatchClass"] =
    localizationResult === "same_sign_confirmed"
      ? "tile_physics_remediation_patch"
      : localizationResult === "proxy_artifact_suspected"
        ? "tile_surface_reconstitution_patch"
        : "tile_cross_check_instrumentation_patch";
  const status: Nhm2ObserverTileComparableCrossCheckEvidence["status"] =
    comparabilityStatus === "pass"
      ? "pass"
      : comparabilityStatus === "fail"
        ? "fail"
        : "unknown";
  const referenceRouteId =
    getNhm2ModelTermNoteValue(
      args.modelTermSemanticEvidence.notes,
      "independentCrossCheckReferenceRouteId",
    ) ??
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    routeId;
  const rationale =
    localizationResult === "same_sign_confirmed"
      ? `Comparable Einstein-path cross-check indicates metric and tile ${observerConditionFocus.toUpperCase()} minima have consistent sign; treat residual tile failure as same-surface physics on a commensurate route.`
      : localizationResult === "proxy_artifact_suspected"
        ? `Comparable Einstein-path cross-check keeps metric-side ${observerConditionFocus.toUpperCase()} minima non-negative while tile-side proxy minima remain negative; localize blocker as likely proxy artifact pending tile-surface reconstitution.`
        : "Comparable Einstein-path tile localization remains inconclusive; gather additional commensurate cross-check evidence before retuning physics.";
  const citationRefs = Array.from(
    new Set(
      [
        ...NHM2_MODEL_TERM_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
        ...args.modelTermSemanticEvidence.citationRefs,
        ...(args.modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  return {
    status,
    chartRef: args.modelTermSemanticEvidence.chartRef ?? null,
    routeId,
    selectedPath,
    referenceRouteId,
    aggregationMethod:
      "same_profile_global_minimum_compare(condition_focus.{wec,dec}.eulerianMin, condition_focus.{wec,dec}.robustMin)",
    metricTensorRef: asText(args.metricTensorInput.tensorRef),
    tileTensorRef: asText(args.tileTensorInput.tensorRef),
    metricWecEulerianMin,
    metricWecRobustMin,
    tileWecEulerianMin,
    tileWecRobustMin,
    eulerianMinDelta,
    robustMinDelta,
    eulerianSignAgreement,
    robustSignAgreement,
    independentCrossCheckStatus,
    comparabilityStatus,
    localizationResult,
    nextPatchClass,
    rationale,
    citationRefs,
    notes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `referenceRouteId=${referenceRouteId ?? "none"}`,
      `routeAdmissionComparable=${String(routeAdmissionComparable)}`,
      `independentCrossCheckStatus=${independentCrossCheckStatus}`,
      `comparabilityStatus=${comparabilityStatus}`,
      `tileProxyDeclared=${String(tileProxyDeclared)}`,
      `metricWecEulerianMin=${metricWecEulerianMin ?? "null"}`,
      `metricWecRobustMin=${metricWecRobustMin ?? "null"}`,
      `tileWecEulerianMin=${tileWecEulerianMin ?? "null"}`,
      `tileWecRobustMin=${tileWecRobustMin ?? "null"}`,
      `metricDecEulerianMin=${metricDecEulerianMin ?? "null"}`,
      `metricDecRobustMin=${metricDecRobustMin ?? "null"}`,
      `tileDecEulerianMin=${tileDecEulerianMin ?? "null"}`,
      `tileDecRobustMin=${tileDecRobustMin ?? "null"}`,
      `observerConditionFocus=${observerConditionFocus}`,
      `eulerianSignAgreement=${eulerianSignAgreement == null ? "unknown" : String(eulerianSignAgreement)}`,
      `robustSignAgreement=${robustSignAgreement == null ? "unknown" : String(robustSignAgreement)}`,
      `decEulerianSignAgreement=${decEulerianSignAgreement == null ? "unknown" : String(decEulerianSignAgreement)}`,
      `decRobustSignAgreement=${decRobustSignAgreement == null ? "unknown" : String(decRobustSignAgreement)}`,
      `localizationResult=${localizationResult}`,
      `nextPatchClass=${nextPatchClass}`,
    ],
  };
};

const deriveNhm2TileSurfaceReconstitutionEvidence = (args: {
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  metricEmissionAdmissionStatus: "admitted" | "not_admitted" | "unknown";
  metricT0iAdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  metricOffDiagonalAdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileComparableCrossCheckEvidence: Nhm2ObserverTileComparableCrossCheckEvidence;
}): Nhm2ObserverTileSurfaceReconstitutionEvidence => {
  const modelChecks = args.modelTermSemanticEvidence.checks;
  const selectedPath =
    args.modelTermSemanticEvidence.closurePathDecision?.selectedPath ?? null;
  const routeId =
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    args.modelTermSemanticEvidence.routeId ??
    null;
  const routeAdmissionEffectiveAdmitted =
    args.modelTermSemanticEvidence.routeAdmissionEffective === "admitted";
  const fullEinsteinPathSelected = selectedPath === "full_einstein_tensor";
  const routeComparable =
    fullEinsteinPathSelected &&
    routeAdmissionEffectiveAdmitted &&
    modelChecks.fullEinsteinTensorRouteAdmission === "pass";
  const t00Coverage: Nhm2ObserverTileSurfaceReconstitutionEvidence["componentCoverage"]["t00"] =
    routeComparable &&
    modelChecks.einsteinT00Comparability === "pass" &&
    asText(args.metricTensorInput.tensorRef) != null
      ? "present_admitted"
      : routeAdmissionEffectiveAdmitted
        ? "present_but_not_admitted"
        : "missing";
  const t0iCoverage = toTileReconstitutionComponentCoverage(
    args.metricEmissionAdmissionStatus,
    args.metricT0iAdmissionStatus,
  );
  const offDiagonalCoverage = toTileReconstitutionComponentCoverage(
    args.metricEmissionAdmissionStatus,
    args.metricOffDiagonalAdmissionStatus,
  );
  const allComponentCoverageAdmitted =
    t00Coverage === "present_admitted" &&
    t0iCoverage === "present_admitted" &&
    offDiagonalCoverage === "present_admitted";
  const independentCrossCheckRouteRef =
    getNhm2ModelTermNoteValue(
      args.modelTermSemanticEvidence.notes,
      "independentCrossCheckReferenceRouteId",
    ) ?? args.tileComparableCrossCheckEvidence.referenceRouteId;
  const comparabilityStatus = args.tileComparableCrossCheckEvidence.comparabilityStatus;
  const localizationResult = args.tileComparableCrossCheckEvidence.localizationResult;
  const comparabilityPass = comparabilityStatus === "pass";
  const localizationActionable =
    localizationResult === "proxy_artifact_suspected" ||
    localizationResult === "same_sign_confirmed";
  const pass =
    routeComparable &&
    allComponentCoverageAdmitted &&
    comparabilityPass &&
    localizationActionable;
  const fail =
    !pass &&
    (!routeComparable ||
      comparabilityStatus === "fail" ||
      t00Coverage === "missing" ||
      t0iCoverage === "missing" ||
      offDiagonalCoverage === "missing");
  const status: Nhm2ObserverTileSurfaceReconstitutionEvidence["status"] = pass
    ? "pass"
    : fail
      ? "fail"
      : "unknown";
  const rationale =
    status === "pass"
      ? localizationResult === "proxy_artifact_suspected"
        ? "Tile surface reconstitution evidence is admitted: same-chart Einstein-route components are present/admitted and commensurate cross-check localization points to tile-proxy artifact rather than metric-route incompleteness."
        : "Tile surface reconstitution evidence is admitted on a commensurate Einstein route with same-sign localization; remaining blocker is tile-physics remediation rather than route incomparability."
      : status === "fail"
        ? "Tile surface reconstitution evidence is not admitted yet because route comparability or component coverage is still failing on at least one required surface."
        : "Tile surface reconstitution evidence remains unresolved pending route/component comparability disambiguation.";
  const citationRefs = Array.from(
    new Set(
      [
        ...NHM2_MODEL_TERM_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
        ...args.modelTermSemanticEvidence.citationRefs,
        ...(args.modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
        ...args.tileComparableCrossCheckEvidence.citationRefs,
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  return {
    status,
    chartRef: args.modelTermSemanticEvidence.chartRef ?? null,
    routeId,
    selectedPath,
    sourceTensorRef: asText(args.metricTensorInput.tensorRef),
    reconstitutedTileTensorRef: asText(args.tileTensorInput.tensorRef),
    aggregationMethod:
      "same_profile_global_minimum_compare(wec.eulerianMin, wec.robustMin)+component_coverage_gate",
    sampleDomainRef: "nhm2_shift_lapse/global_region",
    componentCoverage: {
      t00: t00Coverage,
      t0i: t0iCoverage,
      offDiagonalTij: offDiagonalCoverage,
    },
    independentCrossCheckRouteRef,
    independentCrossCheckStatus:
      args.tileComparableCrossCheckEvidence.independentCrossCheckStatus,
    comparabilityStatus,
    localizationResult,
    rationale,
    citationRefs,
    notes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `routeComparable=${String(routeComparable)}`,
      `componentCoverage.t00=${t00Coverage}`,
      `componentCoverage.t0i=${t0iCoverage}`,
      `componentCoverage.offDiagonalTij=${offDiagonalCoverage}`,
      `independentCrossCheckRouteRef=${independentCrossCheckRouteRef ?? "none"}`,
      `comparabilityStatus=${comparabilityStatus}`,
      `localizationResult=${localizationResult}`,
      `reconstitutionStatus=${status}`,
    ],
  };
};

const deriveModelTermParityStatus = (
  lhs: number | null,
  rhs: number | null,
  epsilon = 1e-12,
): "pass" | "fail" | "unknown" => {
  if (lhs == null || rhs == null) {
    return "unknown";
  }
  return Math.abs(lhs - rhs) <= epsilon ? "pass" : "fail";
};

const deriveNhm2TileObserverConditionComparabilityEvidence = (args: {
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileComparableCrossCheckEvidence: Nhm2ObserverTileComparableCrossCheckEvidence;
  tileSurfaceReconstitutionEvidence: Nhm2ObserverTileSurfaceReconstitutionEvidence;
}): Nhm2ObserverTileObserverConditionComparabilityEvidence => {
  const selectedPath =
    args.modelTermSemanticEvidence.closurePathDecision?.selectedPath ?? null;
  const routeId =
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    args.modelTermSemanticEvidence.routeId ??
    null;
  const metricWecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.eulerianMin,
  );
  const metricWecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.robustMin,
  );
  const metricDecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.eulerianMin,
  );
  const metricDecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.robustMin,
  );
  const proxyWecEulerianMin = toFiniteNumber(
    args.tileTensorInput.conditions?.wec?.eulerianMin,
  );
  const proxyWecRobustMin = toFiniteNumber(
    args.tileTensorInput.conditions?.wec?.robustMin,
  );
  const proxyDecEulerianMin = toFiniteNumber(
    args.tileTensorInput.conditions?.dec?.eulerianMin,
  );
  const proxyDecRobustMin = toFiniteNumber(
    args.tileTensorInput.conditions?.dec?.robustMin,
  );
  const routeComparability = args.tileSurfaceReconstitutionEvidence.comparabilityStatus;
  const routeComparable = routeComparability === "pass";
  const reconstitutedLane = {
    tensorRef:
      asText(args.tileSurfaceReconstitutionEvidence.reconstitutedTileTensorRef) ??
      asText(args.metricTensorInput.tensorRef),
    sourceRef:
      asText(args.tileSurfaceReconstitutionEvidence.sourceTensorRef) ??
      asText(args.metricTensorInput.tensorRef),
    sampleCount: routeComparable
      ? toFiniteNumber(args.metricTensorInput.sampleCount)
      : null,
    rapidityCap: routeComparable
      ? toFiniteNumber(args.metricTensorInput.rapidityCap)
      : null,
    rapidityCapBeta: routeComparable
      ? toFiniteNumber(args.metricTensorInput.rapidityCapBeta)
      : null,
    wecEulerianMin: routeComparable ? metricWecEulerianMin : null,
    wecRobustMin: routeComparable ? metricWecRobustMin : null,
    decEulerianMin: routeComparable ? metricDecEulerianMin : null,
    decRobustMin: routeComparable ? metricDecRobustMin : null,
    note: routeComparable
      ? "Reconstituted lane is replayed from the admitted same-chart Einstein-route metric tensor for commensurate observer-condition comparison."
      : "Reconstituted lane remains non-admitted; commensurate replay values are withheld.",
  };
  const sampleCountParity = deriveModelTermParityStatus(
    toFiniteNumber(args.metricTensorInput.sampleCount),
    reconstitutedLane.sampleCount,
    0,
  );
  const rapidityCapParity = deriveModelTermParityStatus(
    toFiniteNumber(args.metricTensorInput.rapidityCap),
    reconstitutedLane.rapidityCap,
    1e-12,
  );
  const rapidityCapBetaParity = deriveModelTermParityStatus(
    toFiniteNumber(args.metricTensorInput.rapidityCapBeta),
    reconstitutedLane.rapidityCapBeta,
    1e-12,
  );
  const independentCrossCheck =
    args.tileSurfaceReconstitutionEvidence.independentCrossCheckStatus === "unknown"
      ? args.tileComparableCrossCheckEvidence.independentCrossCheckStatus
      : args.tileSurfaceReconstitutionEvidence.independentCrossCheckStatus;
  const citationCoverage = args.modelTermSemanticEvidence.checks.citationCoverage;
  const allChecksPass =
    routeComparability === "pass" &&
    independentCrossCheck === "pass" &&
    sampleCountParity === "pass" &&
    rapidityCapParity === "pass" &&
    rapidityCapBetaParity === "pass" &&
    citationCoverage === "pass";
  const hasNegative = (...values: Array<number | null>): boolean =>
    values.some((value) => value != null && value < 0);
  const proxyHasNegative = hasNegative(
    proxyWecEulerianMin,
    proxyWecRobustMin,
    proxyDecEulerianMin,
    proxyDecRobustMin,
  );
  const reconstitutedHasNegative = hasNegative(
    reconstitutedLane.wecEulerianMin,
    reconstitutedLane.wecRobustMin,
    reconstitutedLane.decEulerianMin,
    reconstitutedLane.decRobustMin,
  );
  const metricHasNegative = hasNegative(
    metricWecEulerianMin,
    metricWecRobustMin,
    metricDecEulerianMin,
    metricDecRobustMin,
  );
  const localizationResult =
    args.tileSurfaceReconstitutionEvidence.localizationResult === "inconclusive"
      ? args.tileComparableCrossCheckEvidence.localizationResult
      : args.tileSurfaceReconstitutionEvidence.localizationResult;
  const classification: Nhm2ObserverTileObserverConditionComparabilityEvidence["classification"] =
    allChecksPass && reconstitutedHasNegative && metricHasNegative
      ? "same_surface_failure_confirmed"
      : allChecksPass && !reconstitutedHasNegative && proxyHasNegative
        ? "proxy_artifact_confirmed"
        : allChecksPass && localizationResult === "same_sign_confirmed"
        ? "same_surface_failure_confirmed"
        : allChecksPass && localizationResult === "proxy_artifact_suspected"
          ? "proxy_artifact_confirmed"
          : "inconclusive";
  const classificationReason =
    classification === "proxy_artifact_confirmed"
      ? "Commensurate same-chart replay passes route/parity checks and localizes to proxy_artifact_suspected on the published tile lane."
      : classification === "same_surface_failure_confirmed"
        ? "Commensurate same-chart replay passes route/parity checks and localizes to same_sign_confirmed, indicating same-surface observer-condition failure."
        : "inconclusive";
  const unresolvedReason =
    "Commensurate observer-condition classification remains unresolved because one or more comparability checks are not pass-level or sign evidence is mixed.";
  const classificationReasonText =
    classificationReason === "inconclusive" ? unresolvedReason : classificationReason;
  const checks: Nhm2ObserverTileObserverConditionComparabilityEvidence["checks"] = {
    routeComparability,
    independentCrossCheck,
    sampleCountParity,
    rapidityCapParity,
    rapidityCapBetaParity,
    citationCoverage,
  };
  const pass = allChecksPass && classification !== "inconclusive";
  const fail = !pass && Object.values(checks).some((status) => status === "fail");
  const status: Nhm2ObserverTileObserverConditionComparabilityEvidence["status"] = pass
    ? "pass"
    : fail
      ? "fail"
      : "unknown";
  const citationRefs = Array.from(
    new Set(
      [
        ...NHM2_MODEL_TERM_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
        ...args.modelTermSemanticEvidence.citationRefs,
        ...(args.modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
        ...args.tileComparableCrossCheckEvidence.citationRefs,
        ...args.tileSurfaceReconstitutionEvidence.citationRefs,
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  return {
    status,
    chartRef: args.modelTermSemanticEvidence.chartRef ?? null,
    routeId,
    selectedPath,
    sampleDomainRef:
      args.tileSurfaceReconstitutionEvidence.sampleDomainRef ??
      "nhm2_shift_lapse/global_region",
    aggregationMethod:
      "same_chart_commensurate_replay(metric_required_vs_tile_effective_proxy_vs_tile_effective_reconstituted)",
    classification,
    classificationReason: classificationReasonText,
    checks,
    lanes: {
      metricRequired: {
        tensorRef: asText(args.metricTensorInput.tensorRef),
        sampleCount: toFiniteNumber(args.metricTensorInput.sampleCount),
        rapidityCap: toFiniteNumber(args.metricTensorInput.rapidityCap),
        rapidityCapBeta: toFiniteNumber(args.metricTensorInput.rapidityCapBeta),
        wecEulerianMin: metricWecEulerianMin,
        wecRobustMin: metricWecRobustMin,
        decEulerianMin: metricDecEulerianMin,
        decRobustMin: metricDecRobustMin,
      },
      tileEffectiveProxy: {
        tensorRef: asText(args.tileTensorInput.tensorRef),
        sampleCount: toFiniteNumber(args.tileTensorInput.sampleCount),
        rapidityCap: toFiniteNumber(args.tileTensorInput.rapidityCap),
        rapidityCapBeta: toFiniteNumber(args.tileTensorInput.rapidityCapBeta),
        wecEulerianMin: proxyWecEulerianMin,
        wecRobustMin: proxyWecRobustMin,
        decEulerianMin: proxyDecEulerianMin,
        decRobustMin: proxyDecRobustMin,
      },
      tileEffectiveReconstituted: reconstitutedLane,
    },
    pass,
    rationale:
      classification === "proxy_artifact_confirmed"
        ? "Observer-condition comparability is now commensurate on the admitted Einstein route and confirms a proxy-lane artifact."
        : classification === "same_surface_failure_confirmed"
          ? "Observer-condition comparability is commensurate and confirms same-surface failure on the reconstituted lane."
          : "Observer-condition comparability remains unresolved pending pass-level commensurate checks and non-mixed sign evidence.",
    citationRefs,
    notes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `classification=${classification}`,
      `checks.routeComparability=${checks.routeComparability}`,
      `checks.independentCrossCheck=${checks.independentCrossCheck}`,
      `checks.sampleCountParity=${checks.sampleCountParity}`,
      `checks.rapidityCapParity=${checks.rapidityCapParity}`,
      `checks.rapidityCapBetaParity=${checks.rapidityCapBetaParity}`,
      `checks.citationCoverage=${checks.citationCoverage}`,
      `proxyHasNegative=${String(proxyHasNegative)}`,
      `reconstitutedHasNegative=${String(reconstitutedHasNegative)}`,
      `metricHasNegative=${String(metricHasNegative)}`,
      `localizationResult=${localizationResult}`,
      `status=${status}`,
    ],
  };
};

const deriveNhm2ObserverDecRemediationEvidence = (args: {
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileComparableCrossCheckEvidence: Nhm2ObserverTileComparableCrossCheckEvidence;
  tileObserverConditionComparabilityEvidence: Nhm2ObserverTileObserverConditionComparabilityEvidence;
  tileObserverConditionAuthorityMode: Nhm2ObserverTileObserverConditionAuthorityMode;
}): Nhm2ObserverDecRemediationEvidence => {
  const selectedPath =
    args.modelTermSemanticEvidence.closurePathDecision?.selectedPath ?? null;
  const routeId =
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    args.modelTermSemanticEvidence.routeId ??
    null;
  const metricDecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.eulerianMin,
  );
  const metricDecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.robustMin,
  );
  const metricWecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.eulerianMin,
  );
  const metricWecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.robustMin,
  );
  const reconstitutedLane =
    args.tileObserverConditionComparabilityEvidence.lanes.tileEffectiveReconstituted;
  const tileReconstitutedDecEulerianMin =
    toFiniteNumber(reconstitutedLane.decEulerianMin) ?? metricDecEulerianMin;
  const tileReconstitutedDecRobustMin =
    toFiniteNumber(reconstitutedLane.decRobustMin) ?? metricDecRobustMin;
  const metricTypeIFraction = toFiniteNumber(args.metricTensorInput.typeI?.fraction);
  const tileTypeIFraction = toFiniteNumber(args.tileTensorInput.typeI?.fraction);
  const metricFluxMeanMagnitude = toFiniteNumber(
    args.metricTensorInput.fluxDiagnostics?.meanMagnitude,
  );
  const tileFluxMeanMagnitude = toFiniteNumber(
    args.tileTensorInput.fluxDiagnostics?.meanMagnitude,
  );
  const observerConditionFocusNote =
    args.tileComparableCrossCheckEvidence.notes.find((entry) =>
      entry.startsWith("observerConditionFocus="),
    ) ?? null;
  const observerConditionFocus =
    observerConditionFocusNote != null
      ? observerConditionFocusNote.slice("observerConditionFocus=".length)
      : "unknown";
  const allComparabilityChecksPass =
    args.tileObserverConditionComparabilityEvidence.status === "pass" &&
    args.tileObserverConditionComparabilityEvidence.classification ===
      "same_surface_failure_confirmed" &&
    args.tileObserverConditionAuthorityMode ===
      "commensurate_reconstituted_authoritative";
  const metricDecFail =
    (metricDecEulerianMin != null && metricDecEulerianMin < 0) ||
    (metricDecRobustMin != null && metricDecRobustMin < 0);
  const tileDecFail =
    (tileReconstitutedDecEulerianMin != null &&
      tileReconstitutedDecEulerianMin < 0) ||
    (tileReconstitutedDecRobustMin != null && tileReconstitutedDecRobustMin < 0);
  const hasDecFailure = metricDecFail || tileDecFail;
  const metricDecDeficit = Math.max(0, -(metricDecRobustMin ?? 0));
  const tileDecDeficit = Math.max(0, -(tileReconstitutedDecRobustMin ?? 0));
  const maxDecDeficit = Math.max(metricDecDeficit, tileDecDeficit);
  const maxFluxMeanMagnitude = Math.max(
    Math.abs(metricFluxMeanMagnitude ?? 0),
    Math.abs(tileFluxMeanMagnitude ?? 0),
  );
  const fluxActivityThreshold = 1e-12;
  const fluxActive = maxFluxMeanMagnitude > fluxActivityThreshold;
  const fluxVsDecRatio =
    maxDecDeficit > 0 ? maxFluxMeanMagnitude / maxDecDeficit : null;
  const decOnlyViolation =
    (metricWecEulerianMin ?? 0) >= 0 &&
    (metricWecRobustMin ?? 0) >= 0 &&
    hasDecFailure;
  const dominantViolationClass: Nhm2ObserverDecRemediationEvidence["dominantViolationClass"] =
    !allComparabilityChecksPass || !hasDecFailure
      ? "unknown"
      : !fluxActive && decOnlyViolation
        ? "stress_dominance"
        : fluxActive && fluxVsDecRatio != null && fluxVsDecRatio >= 1
          ? "flux_dominance"
          : fluxActive && fluxVsDecRatio != null
            ? "stress_dominance"
            : "mixed";
  const recommendedPatchClass: Nhm2ObserverDecRemediationEvidence["recommendedPatchClass"] =
    !allComparabilityChecksPass
      ? "no_admissible_candidate_yet"
      : selectedPath !== "full_einstein_tensor" ||
          args.modelTermSemanticEvidence.checks.fullEinsteinTensorRouteAdmission !==
            "pass"
        ? "model_term_extension_patch"
        : dominantViolationClass === "unknown"
          ? "no_admissible_candidate_yet"
          : "physics_control_patch";
  const citationRefs = Array.from(
    new Set(
      [
        ...NHM2_MODEL_TERM_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
        ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
        ...args.modelTermSemanticEvidence.citationRefs,
        ...(args.modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
        ...args.tileComparableCrossCheckEvidence.citationRefs,
        ...args.tileObserverConditionComparabilityEvidence.citationRefs,
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  return {
    chartRef: args.modelTermSemanticEvidence.chartRef ?? null,
    routeId,
    selectedPath,
    rapidityCap: toFiniteNumber(args.metricTensorInput.rapidityCap),
    rapidityCapBeta: toFiniteNumber(args.metricTensorInput.rapidityCapBeta),
    metricDecEulerianMin,
    metricDecRobustMin,
    tileReconstitutedDecEulerianMin,
    tileReconstitutedDecRobustMin,
    typeIFractionMetric: metricTypeIFraction,
    typeIFractionTileReconstituted: tileTypeIFraction,
    dominantViolationClass,
    recommendedPatchClass,
    modelTermExtensionPlanEvidence: null,
    citationRefs,
    notes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `observerConditionFocus=${observerConditionFocus}`,
      `comparabilityClassification=${args.tileObserverConditionComparabilityEvidence.classification}`,
      `authorityMode=${args.tileObserverConditionAuthorityMode}`,
      `allComparabilityChecksPass=${String(allComparabilityChecksPass)}`,
      `metricDecEulerianMin=${metricDecEulerianMin ?? "null"}`,
      `metricDecRobustMin=${metricDecRobustMin ?? "null"}`,
      `tileReconstitutedDecEulerianMin=${tileReconstitutedDecEulerianMin ?? "null"}`,
      `tileReconstitutedDecRobustMin=${tileReconstitutedDecRobustMin ?? "null"}`,
      `metricWecEulerianMin=${metricWecEulerianMin ?? "null"}`,
      `metricWecRobustMin=${metricWecRobustMin ?? "null"}`,
      `metricFluxMeanMagnitude=${metricFluxMeanMagnitude ?? "null"}`,
      `tileFluxMeanMagnitude=${tileFluxMeanMagnitude ?? "null"}`,
      `maxFluxMeanMagnitude=${maxFluxMeanMagnitude}`,
      `maxDecDeficit=${maxDecDeficit}`,
      `fluxVsDecRatio=${fluxVsDecRatio ?? "null"}`,
      `decOnlyViolation=${String(decOnlyViolation)}`,
      `dominantViolationClass=${dominantViolationClass}`,
      `recommendedPatchClass=${recommendedPatchClass}`,
    ],
  };
};

const deriveNhm2ObserverDecPhysicsControlEvidence = (args: {
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  decRemediationEvidence: Nhm2ObserverDecRemediationEvidence;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileObserverConditionComparabilityEvidence: Nhm2ObserverTileObserverConditionComparabilityEvidence;
  emissionAdmissionStatus: "admitted" | "not_admitted" | "unknown";
}): Nhm2ObserverDecPhysicsControlEvidence => {
  const selectedPath =
    args.modelTermSemanticEvidence.closurePathDecision?.selectedPath ??
    args.decRemediationEvidence.selectedPath ??
    null;
  const routeId =
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    args.decRemediationEvidence.routeId ??
    args.modelTermSemanticEvidence.routeId ??
    null;
  const baselineMetricDecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.eulerianMin,
  );
  const baselineMetricDecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.dec?.robustMin,
  );
  const baselineMetricWecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.eulerianMin,
  );
  const baselineMetricWecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.wec?.robustMin,
  );
  const baselineMetricNecEulerianMin = toFiniteNumber(
    args.metricTensorInput.conditions?.nec?.eulerianMin,
  );
  const baselineMetricNecRobustMin = toFiniteNumber(
    args.metricTensorInput.conditions?.nec?.robustMin,
  );
  const reconstitutedLane =
    args.tileObserverConditionComparabilityEvidence.lanes.tileEffectiveReconstituted;
  const baselineTileDecEulerianMin =
    toFiniteNumber(reconstitutedLane.decEulerianMin) ??
    args.decRemediationEvidence.tileReconstitutedDecEulerianMin ??
    baselineMetricDecEulerianMin;
  const baselineTileDecRobustMin =
    toFiniteNumber(reconstitutedLane.decRobustMin) ??
    args.decRemediationEvidence.tileReconstitutedDecRobustMin ??
    baselineMetricDecRobustMin;
  const baselineTileWecEulerianMin =
    toFiniteNumber(reconstitutedLane.wecEulerianMin) ??
    baselineMetricWecEulerianMin;
  const baselineTileWecRobustMin =
    toFiniteNumber(reconstitutedLane.wecRobustMin) ?? baselineMetricWecRobustMin;
  const baselineTileNecEulerianMin =
    toFiniteNumber(reconstitutedLane.decEulerianMin) != null
      ? toFiniteNumber(args.tileTensorInput.conditions?.nec?.eulerianMin)
      : baselineMetricNecEulerianMin;
  const baselineTileNecRobustMin =
    toFiniteNumber(reconstitutedLane.decRobustMin) != null
      ? toFiniteNumber(args.tileTensorInput.conditions?.nec?.robustMin)
      : baselineMetricNecRobustMin;
  const emissionAdmissionStable = args.emissionAdmissionStatus === "admitted";
  const semanticAdmissionStable =
    args.modelTermSemanticEvidence.decision === "admit" &&
    args.modelTermSemanticEvidence.routeAdmission === "admitted" &&
    args.modelTermSemanticEvidence.checks.fullEinsteinTensorRouteAdmission ===
      "pass";
  const sameChartTensorPhysicsControlBaseline = 1;
  const sameChartTensorPhysicsControlBoundedDeltaMax = 0.15;
  const sameChartTensorPhysicsControlMin = Math.max(
    sameChartTensorPhysicsControlBaseline -
      sameChartTensorPhysicsControlBoundedDeltaMax,
    0,
  );
  const sameChartTensorPhysicsControlExpandedBoundedDeltaMax = 0.2;
  const sameChartTensorPhysicsControlExpandedMin = Math.max(
    sameChartTensorPhysicsControlBaseline -
      sameChartTensorPhysicsControlExpandedBoundedDeltaMax,
    0,
  );
  const sameChartTensorPhysicsControlTargetedBoundedDeltaMax = 0.4;
  const sameChartTensorPhysicsControlTargetedMin = Math.max(
    sameChartTensorPhysicsControlBaseline -
      sameChartTensorPhysicsControlTargetedBoundedDeltaMax,
    0,
  );
  const sameChartTensorPhysicsControlEdgeBoundedDeltaMax = 0.5;
  const sameChartTensorPhysicsControlEdgeMin = Math.max(
    sameChartTensorPhysicsControlBaseline -
      sameChartTensorPhysicsControlEdgeBoundedDeltaMax,
    0,
  );
  const sameChartTensorPhysicsControlProbeScale = sameChartTensorPhysicsControlMin;
  const sameChartTensorDensityLiftBaseline = 0;
  const sameChartTensorDensityLiftBoundedDeltaMax = 0.15;
  const sameChartTensorDensityLiftMax =
    sameChartTensorDensityLiftBaseline +
    sameChartTensorDensityLiftBoundedDeltaMax;
  const sameChartTensorDensityLiftExpandedBoundedDeltaMax = 0.2;
  const sameChartTensorDensityLiftExpandedMax =
    sameChartTensorDensityLiftBaseline +
    sameChartTensorDensityLiftExpandedBoundedDeltaMax;
  const sameChartTensorDensityLiftTargetedBoundedDeltaMax = 0.4;
  const sameChartTensorDensityLiftTargetedMax =
    sameChartTensorDensityLiftBaseline +
    sameChartTensorDensityLiftTargetedBoundedDeltaMax;
  const sameChartTensorDensityLiftEdgeBoundedDeltaMax = 0.5;
  const sameChartTensorDensityLiftEdgeMax =
    sameChartTensorDensityLiftBaseline +
    sameChartTensorDensityLiftEdgeBoundedDeltaMax;
  const sameChartTensorDensityLiftProbeFraction = sameChartTensorDensityLiftMax;
  const sameChartTensorFluxScaleBaseline = 1;
  const sameChartTensorFluxScaleBoundedDeltaMax = 0.15;
  const sameChartTensorFluxScaleMin = Math.max(
    sameChartTensorFluxScaleBaseline - sameChartTensorFluxScaleBoundedDeltaMax,
    0,
  );
  const sameChartTensorFluxScaleExpandedBoundedDeltaMax = 0.2;
  const sameChartTensorFluxScaleExpandedMin = Math.max(
    sameChartTensorFluxScaleBaseline -
      sameChartTensorFluxScaleExpandedBoundedDeltaMax,
    0,
  );
  const sameChartTensorFluxScaleTargetedBoundedDeltaMax = 0.2;
  const sameChartTensorFluxScaleTargetedMin = Math.max(
    sameChartTensorFluxScaleBaseline -
      sameChartTensorFluxScaleTargetedBoundedDeltaMax,
    0,
  );
  const sameChartTensorFluxScaleEdgeBoundedDeltaMax = 0.25;
  const sameChartTensorFluxScaleEdgeMin = Math.max(
    sameChartTensorFluxScaleBaseline - sameChartTensorFluxScaleEdgeBoundedDeltaMax,
    0,
  );
  const sameChartTensorFluxScaleProbe = sameChartTensorFluxScaleMin;
  const sameChartTensorShearScaleBaseline = 1;
  const sameChartTensorShearScaleBoundedDeltaMax = 0.15;
  const sameChartTensorShearScaleMin = Math.max(
    sameChartTensorShearScaleBaseline - sameChartTensorShearScaleBoundedDeltaMax,
    0,
  );
  const sameChartTensorShearScaleExpandedBoundedDeltaMax = 0.2;
  const sameChartTensorShearScaleExpandedMin = Math.max(
    sameChartTensorShearScaleBaseline -
      sameChartTensorShearScaleExpandedBoundedDeltaMax,
    0,
  );
  const sameChartTensorShearScaleTargetedBoundedDeltaMax = 0.5;
  const sameChartTensorShearScaleTargetedMin = Math.max(
    sameChartTensorShearScaleBaseline -
      sameChartTensorShearScaleTargetedBoundedDeltaMax,
    0,
  );
  const sameChartTensorShearScaleEdgeBoundedDeltaMax = 0.65;
  const sameChartTensorShearScaleEdgeMin = Math.max(
    sameChartTensorShearScaleBaseline - sameChartTensorShearScaleEdgeBoundedDeltaMax,
    0,
  );
  const sameChartTensorShearScaleProbe = sameChartTensorShearScaleMin;
  const sameChartTensorPrimaryBoundedEnvelope = {
    pressureScaleMin: sameChartTensorPhysicsControlMin,
    pressureScaleMax: sameChartTensorPhysicsControlBaseline,
    densityLiftMin: sameChartTensorDensityLiftBaseline,
    densityLiftMax: sameChartTensorDensityLiftMax,
    fluxScaleMin: sameChartTensorFluxScaleMin,
    fluxScaleMax: sameChartTensorFluxScaleBaseline,
    shearScaleMin: sameChartTensorShearScaleMin,
    shearScaleMax: sameChartTensorShearScaleBaseline,
  };
  const sameChartTensorExpandedBoundedEnvelope = {
    pressureScaleMin: sameChartTensorPhysicsControlExpandedMin,
    pressureScaleMax: sameChartTensorPhysicsControlBaseline,
    densityLiftMin: sameChartTensorDensityLiftBaseline,
    densityLiftMax: sameChartTensorDensityLiftExpandedMax,
    fluxScaleMin: sameChartTensorFluxScaleExpandedMin,
    fluxScaleMax: sameChartTensorFluxScaleBaseline,
    shearScaleMin: sameChartTensorShearScaleExpandedMin,
    shearScaleMax: sameChartTensorShearScaleBaseline,
  };
  const sameChartTensorTargetedBoundedEnvelope = {
    pressureScaleMin: sameChartTensorPhysicsControlTargetedMin,
    pressureScaleMax: sameChartTensorPhysicsControlBaseline,
    densityLiftMin: sameChartTensorDensityLiftBaseline,
    densityLiftMax: sameChartTensorDensityLiftTargetedMax,
    fluxScaleMin: sameChartTensorFluxScaleTargetedMin,
    fluxScaleMax: sameChartTensorFluxScaleBaseline,
    shearScaleMin: sameChartTensorShearScaleTargetedMin,
    shearScaleMax: sameChartTensorShearScaleBaseline,
  };
  const sameChartTensorEdgeBoundedEnvelope = {
    pressureScaleMin: sameChartTensorPhysicsControlEdgeMin,
    pressureScaleMax: sameChartTensorPhysicsControlBaseline,
    densityLiftMin: sameChartTensorDensityLiftBaseline,
    densityLiftMax: sameChartTensorDensityLiftEdgeMax,
    fluxScaleMin: sameChartTensorFluxScaleEdgeMin,
    fluxScaleMax: sameChartTensorFluxScaleBaseline,
    shearScaleMin: sameChartTensorShearScaleEdgeMin,
    shearScaleMax: sameChartTensorShearScaleBaseline,
  };
  const baselineMetricRho = baselineMetricWecEulerianMin;
  const baselineMetricMinPressure =
    baselineMetricRho != null && baselineMetricNecRobustMin != null
      ? baselineMetricNecRobustMin - baselineMetricRho
      : null;
  const baselineMetricMaxAbsPressure =
    baselineMetricRho != null && baselineMetricDecRobustMin != null
      ? Math.max(0, baselineMetricRho - baselineMetricDecRobustMin)
      : null;
  const baselineTileRho = baselineTileWecEulerianMin ?? baselineMetricRho;
  const baselineTileMaxAbsPressure =
    baselineTileRho != null && baselineTileDecRobustMin != null
      ? Math.max(0, baselineTileRho - baselineTileDecRobustMin)
      : null;
  const metricFluxMeanMagnitude = Math.abs(
    toFiniteNumber(args.metricTensorInput.fluxDiagnostics?.meanMagnitude) ?? 0,
  );
  const metricPressureScaleNorm = Math.max(
    Math.abs(baselineMetricRho ?? 0),
    Math.abs(baselineMetricMaxAbsPressure ?? 0),
    1e-9,
  );
  const normalizedFluxInfluence = Math.min(
    Math.max(metricFluxMeanMagnitude / metricPressureScaleNorm, 0),
    1,
  );
  const evaluateSameChartControlCandidate = (args: {
    pressureScale: number;
    densityLiftFraction: number;
    fluxScale: number;
    shearScale: number;
    boundedEnvelope?: {
      pressureScaleMin: number;
      pressureScaleMax: number;
      densityLiftMin: number;
      densityLiftMax: number;
      fluxScaleMin: number;
      fluxScaleMax: number;
      shearScaleMin: number;
      shearScaleMax: number;
    };
  }) => {
    if (
      baselineMetricRho == null ||
      baselineMetricMaxAbsPressure == null ||
      baselineMetricMinPressure == null
    ) {
      return {
        metricDecRobustMin: baselineMetricDecRobustMin,
        tileReconstitutedDecRobustMin: baselineTileDecRobustMin,
        metricWecRobustMin: baselineMetricWecRobustMin,
        metricNecRobustMin: baselineMetricNecRobustMin,
      };
    }
    const boundedEnvelope = args.boundedEnvelope ?? sameChartTensorPrimaryBoundedEnvelope;
    const boundedPressureScale = Math.min(
      Math.max(args.pressureScale, boundedEnvelope.pressureScaleMin),
      boundedEnvelope.pressureScaleMax,
    );
    const boundedDensityLiftFraction = Math.min(
      Math.max(args.densityLiftFraction, boundedEnvelope.densityLiftMin),
      boundedEnvelope.densityLiftMax,
    );
    const boundedFluxScale = Math.min(
      Math.max(args.fluxScale, boundedEnvelope.fluxScaleMin),
      boundedEnvelope.fluxScaleMax,
    );
    const boundedShearScale = Math.min(
      Math.max(args.shearScale, boundedEnvelope.shearScaleMin),
      boundedEnvelope.shearScaleMax,
    );
    const fluxReliefRatio =
      (1 - boundedFluxScale) * normalizedFluxInfluence * 0.35;
    const shearReliefRatio =
      (1 - boundedShearScale) * (1 - normalizedFluxInfluence * 0.5) * 0.35;
    const anisotropyReliefRatio = Math.min(
      Math.max(fluxReliefRatio + shearReliefRatio, 0),
      0.7,
    );
    const metricRho =
      baselineMetricRho +
      baselineMetricMaxAbsPressure * boundedDensityLiftFraction;
    const metricMaxAbsPressure = Math.max(
      0,
      baselineMetricMaxAbsPressure *
        Math.max(0, boundedPressureScale - anisotropyReliefRatio),
    );
    const metricMinPressure =
      baselineMetricMinPressure * boundedPressureScale +
      baselineMetricMaxAbsPressure * anisotropyReliefRatio * 0.25;
    const metricDecRobustMin = Math.min(
      metricRho,
      metricRho - metricMaxAbsPressure,
    );
    const metricNecRobustMin = metricRho + metricMinPressure;
    const metricWecRobustMin = Math.min(metricRho, metricNecRobustMin);
    const tileReconstitutedDecRobustMin =
      baselineTileRho != null && baselineTileMaxAbsPressure != null
        ? Math.min(
            baselineTileRho +
              baselineTileMaxAbsPressure * boundedDensityLiftFraction,
            baselineTileRho +
              baselineTileMaxAbsPressure * boundedDensityLiftFraction -
              baselineTileMaxAbsPressure *
                Math.max(0, boundedPressureScale - anisotropyReliefRatio),
          )
        : baselineTileDecRobustMin;
    return {
      metricDecRobustMin,
      tileReconstitutedDecRobustMin,
      metricWecRobustMin,
      metricNecRobustMin,
    };
  };
  const sameChartPressureScaleProbe = evaluateSameChartControlCandidate({
    pressureScale: sameChartTensorPhysicsControlProbeScale,
    densityLiftFraction: sameChartTensorDensityLiftBaseline,
    fluxScale: sameChartTensorFluxScaleBaseline,
    shearScale: sameChartTensorShearScaleBaseline,
  });
  const sameChartCoupledDensityPressureProbe = evaluateSameChartControlCandidate({
    pressureScale: sameChartTensorPhysicsControlProbeScale,
    densityLiftFraction: sameChartTensorDensityLiftProbeFraction,
    fluxScale: sameChartTensorFluxScaleProbe,
    shearScale: sameChartTensorShearScaleProbe,
  });
  const baselineRapidityCap = toFiniteNumber(args.metricTensorInput.rapidityCap);
  const baselineRapidityCapBeta = toFiniteNumber(
    args.metricTensorInput.rapidityCapBeta,
  );
  const selectionObjective =
    "prioritize cross-zero DEC margins on metric/tile lanes under coupled same-chart E/J/S controls; otherwise maximize min(metricDecRobustMarginToZero,tileReconstitutedDecRobustMarginToZero), tie-break by metricDecRobustLift desc, then controlDeviationMagnitude asc";
  type DecSweepCandidate =
    Nhm2ObserverDecPhysicsControlEvidence["sweepCandidates"][number];
  const makeControlToken = (value: number): string =>
    `${value}`.replace(".", "p");
  const makeControlConfigKey = (
    pressureScale: number,
    densityLiftFraction: number,
    fluxScale: number,
    shearScale: number,
  ): string =>
    `${pressureScale.toFixed(6)}|${densityLiftFraction.toFixed(6)}|${fluxScale.toFixed(6)}|${shearScale.toFixed(6)}`;
  const clamp = (value: number, minValue: number, maxValue: number): number =>
    Math.min(Math.max(value, minValue), maxValue);
  const minPositiveStep = (values: number[]): number | null => {
    const sorted = Array.from(
      new Set(
        values
          .filter((entry) => Number.isFinite(entry))
          .map((entry) => Number(entry).toFixed(12)),
      ),
    )
      .map((entry) => Number(entry))
      .sort((lhs, rhs) => lhs - rhs);
    if (sorted.length === 1) {
      return sorted[0] > 0 ? Number(sorted[0].toFixed(6)) : null;
    }
    let minStep = Number.POSITIVE_INFINITY;
    for (let i = 1; i < sorted.length; i += 1) {
      const delta = sorted[i] - sorted[i - 1];
      if (delta > 0 && delta < minStep) {
        minStep = delta;
      }
    }
    return Number.isFinite(minStep) ? Number(minStep.toFixed(6)) : null;
  };
  const buildSweepCandidate = (candidate: {
    candidateId: string;
    candidateClass: DecSweepCandidate["candidateClass"];
    sweepPhase: DecSweepCandidate["sweepPhase"];
    refineSeedCandidateId: string | null;
    applied: boolean;
    rapidityCap: number | null;
    rapidityCapBeta: number | null;
    metricDecRobustMin: number | null;
    tileReconstitutedDecRobustMin: number | null;
    metricWecRobustMin: number | null;
    metricNecRobustMin: number | null;
    pressureScale: number | null;
    densityLiftFraction: number | null;
    fluxScale: number | null;
    shearScale: number | null;
    note: string;
  }): DecSweepCandidate => {
    const metricDecRobustLift =
      candidate.metricDecRobustMin != null && baselineMetricDecRobustMin != null
        ? candidate.metricDecRobustMin - baselineMetricDecRobustMin
        : null;
    const tileReconstitutedDecRobustLift =
      candidate.tileReconstitutedDecRobustMin != null &&
      baselineTileDecRobustMin != null
        ? candidate.tileReconstitutedDecRobustMin - baselineTileDecRobustMin
        : null;
    const metricWecRobustDelta =
      candidate.metricWecRobustMin != null && baselineMetricWecRobustMin != null
        ? candidate.metricWecRobustMin - baselineMetricWecRobustMin
        : null;
    const metricNecRobustDelta =
      candidate.metricNecRobustMin != null && baselineMetricNecRobustMin != null
        ? candidate.metricNecRobustMin - baselineMetricNecRobustMin
        : null;
    const metricDecRobustMarginToZero = candidate.metricDecRobustMin;
    const tileReconstitutedDecRobustMarginToZero =
      candidate.tileReconstitutedDecRobustMin;
    const metricWecNonRegressionMargin = metricWecRobustDelta;
    const metricNecNonRegressionMargin = metricNecRobustDelta;
    const selectionObjectivePrimaryMargin =
      metricDecRobustMarginToZero != null &&
      tileReconstitutedDecRobustMarginToZero != null
        ? Math.min(
            metricDecRobustMarginToZero,
            tileReconstitutedDecRobustMarginToZero,
          )
        : null;
    const controlDeviationMagnitude =
      candidate.pressureScale != null &&
      candidate.densityLiftFraction != null &&
      candidate.fluxScale != null &&
      candidate.shearScale != null
        ? Math.abs(candidate.pressureScale - sameChartTensorPhysicsControlBaseline) +
          Math.abs(
            candidate.densityLiftFraction - sameChartTensorDensityLiftBaseline,
          ) +
          Math.abs(candidate.fluxScale - sameChartTensorFluxScaleBaseline) +
          Math.abs(candidate.shearScale - sameChartTensorShearScaleBaseline)
        : null;
    const crossesZeroBothDecMargins =
      metricDecRobustMarginToZero != null &&
      tileReconstitutedDecRobustMarginToZero != null
        ? metricDecRobustMarginToZero >= 0 &&
          tileReconstitutedDecRobustMarginToZero >= 0
        : null;
    const metricWecNonRegression =
      metricWecRobustDelta != null ? metricWecRobustDelta >= 0 : null;
    const metricNecNonRegression =
      metricNecRobustDelta != null ? metricNecRobustDelta >= 0 : null;
    const gateFailureReasons: Nhm2ObserverDecPhysicsControlEvidence["selectionReasonCodes"] =
      [];
    if (!(metricDecRobustLift != null && metricDecRobustLift > 0)) {
      gateFailureReasons.push("no_candidate_improves_dec");
    }
    if (
      !(
        tileReconstitutedDecRobustLift != null &&
        tileReconstitutedDecRobustLift >= 0
      )
    ) {
      gateFailureReasons.push("no_candidate_improves_dec");
    }
    if (metricWecNonRegression !== true) {
      gateFailureReasons.push("candidate_violates_wec_non_regression");
    }
    if (metricNecNonRegression !== true) {
      gateFailureReasons.push("candidate_violates_nec_non_regression");
    }
    if (!emissionAdmissionStable) {
      gateFailureReasons.push("candidate_breaks_emission_admission_stability");
    }
    if (!semanticAdmissionStable) {
      gateFailureReasons.push("candidate_breaks_semantic_admission_stability");
    }
    if (candidate.candidateClass === "observer_domain_truncation") {
      gateFailureReasons.push("candidate_is_observer_domain_truncation");
    }
    const dedupedReasons = Array.from(new Set(gateFailureReasons));
    return {
      candidateId: candidate.candidateId,
      candidateClass: candidate.candidateClass,
      sweepPhase: candidate.sweepPhase,
      refineSeedCandidateId: candidate.refineSeedCandidateId,
      applied: candidate.applied,
      rapidityCap: candidate.rapidityCap,
      rapidityCapBeta: candidate.rapidityCapBeta,
      pressureScale: candidate.pressureScale,
      densityLiftFraction: candidate.densityLiftFraction,
      fluxScale: candidate.fluxScale,
      shearScale: candidate.shearScale,
      metricDecRobustMin: candidate.metricDecRobustMin,
      tileReconstitutedDecRobustMin: candidate.tileReconstitutedDecRobustMin,
      metricWecRobustMin: candidate.metricWecRobustMin,
      metricNecRobustMin: candidate.metricNecRobustMin,
      metricDecRobustLift,
      tileReconstitutedDecRobustLift,
      metricWecRobustDelta,
      metricNecRobustDelta,
      metricDecRobustMarginToZero,
      tileReconstitutedDecRobustMarginToZero,
      crossesZeroBothDecMargins,
      metricWecNonRegressionMargin,
      metricNecNonRegressionMargin,
      selectionObjectivePrimaryMargin,
      controlDeviationMagnitude,
      guardChecks: {
        metricWecNonRegression,
        metricNecNonRegression,
        emissionAdmissionStable,
        semanticAdmissionStable,
      },
      passesSelectionGate: dedupedReasons.length === 0,
      gateFailureReasons: dedupedReasons,
      note: candidate.note,
    };
  };
  const compareCandidatesForSelection = (
    lhs: DecSweepCandidate,
    rhs: DecSweepCandidate,
  ): number => {
    const lhsCrossesZero = lhs.crossesZeroBothDecMargins === true ? 1 : 0;
    const rhsCrossesZero = rhs.crossesZeroBothDecMargins === true ? 1 : 0;
    if (rhsCrossesZero !== lhsCrossesZero) return rhsCrossesZero - lhsCrossesZero;
    const lhsPrimary = lhs.selectionObjectivePrimaryMargin ?? Number.NEGATIVE_INFINITY;
    const rhsPrimary = rhs.selectionObjectivePrimaryMargin ?? Number.NEGATIVE_INFINITY;
    if (rhsPrimary !== lhsPrimary) return rhsPrimary - lhsPrimary;
    const lhsLift = lhs.metricDecRobustLift ?? Number.NEGATIVE_INFINITY;
    const rhsLift = rhs.metricDecRobustLift ?? Number.NEGATIVE_INFINITY;
    if (rhsLift !== lhsLift) return rhsLift - lhsLift;
    const lhsDeviation = lhs.controlDeviationMagnitude ?? Number.POSITIVE_INFINITY;
    const rhsDeviation = rhs.controlDeviationMagnitude ?? Number.POSITIVE_INFINITY;
    if (lhsDeviation !== rhsDeviation) return lhsDeviation - rhsDeviation;
    return lhs.candidateId.localeCompare(rhs.candidateId);
  };
  const compareCandidatesForLeaderboard = (
    lhs: DecSweepCandidate,
    rhs: DecSweepCandidate,
  ): number => {
    const lhsPasses = lhs.passesSelectionGate ? 1 : 0;
    const rhsPasses = rhs.passesSelectionGate ? 1 : 0;
    if (rhsPasses !== lhsPasses) return rhsPasses - lhsPasses;
    return compareCandidatesForSelection(lhs, rhs);
  };
  const baselineSweepCandidates: Nhm2ObserverDecPhysicsControlEvidence["sweepCandidates"] =
    [
      buildSweepCandidate({
        candidateId: "baseline_hold_no_applied_control_patch_v1",
        candidateClass: "baseline_hold",
        sweepPhase: "baseline",
        refineSeedCandidateId: null,
        applied: false,
        rapidityCap: baselineRapidityCap,
        rapidityCapBeta: baselineRapidityCapBeta,
        metricDecRobustMin: baselineMetricDecRobustMin,
        tileReconstitutedDecRobustMin: baselineTileDecRobustMin,
        metricWecRobustMin: baselineMetricWecRobustMin,
        metricNecRobustMin: baselineMetricNecRobustMin,
        pressureScale: null,
        densityLiftFraction: null,
        fluxScale: null,
        shearScale: null,
        note:
          "Baseline hold candidate preserves current observer rapidity bounds and serves as the control lane for sweep comparisons.",
      }),
      buildSweepCandidate({
        candidateId: "observer_domain_truncation_zeta0_probe_v1",
        candidateClass: "observer_domain_truncation",
        sweepPhase: "baseline",
        refineSeedCandidateId: null,
        applied: false,
        rapidityCap: 0,
        rapidityCapBeta: 0,
        metricDecRobustMin: baselineMetricDecEulerianMin,
        tileReconstitutedDecRobustMin: baselineTileDecEulerianMin,
        metricWecRobustMin: baselineMetricWecEulerianMin,
        metricNecRobustMin: baselineMetricNecEulerianMin,
        pressureScale: null,
        densityLiftFraction: null,
        fluxScale: null,
        shearScale: null,
        note:
          "Observer-domain truncation probe (zeta=0) is computed to localize sensitivity only and is explicitly excluded from physical-control selection.",
      }),
    ];
  const coarseSweepCandidates: DecSweepCandidate[] = [];
  const coarseControlByCandidateId = new Map<
    string,
    {
      pressureScale: number;
      densityLiftFraction: number;
      fluxScale: number;
      shearScale: number;
    }
  >();
  const seenControlConfigs = new Set<string>();
  const pushCoarseCandidate = (args: {
    candidateId: string;
    note: string;
    pressureScale: number;
    densityLiftFraction: number;
    fluxScale: number;
    shearScale: number;
    evaluated: {
      metricDecRobustMin: number | null;
      tileReconstitutedDecRobustMin: number | null;
      metricWecRobustMin: number | null;
      metricNecRobustMin: number | null;
    };
  }): void => {
    coarseSweepCandidates.push(
      buildSweepCandidate({
        candidateId: args.candidateId,
        candidateClass: "physics_control_proposal",
        sweepPhase: "coarse",
        refineSeedCandidateId: null,
        applied: false,
        rapidityCap: baselineRapidityCap,
        rapidityCapBeta: baselineRapidityCapBeta,
        metricDecRobustMin: args.evaluated.metricDecRobustMin,
        tileReconstitutedDecRobustMin:
          args.evaluated.tileReconstitutedDecRobustMin,
        metricWecRobustMin: args.evaluated.metricWecRobustMin,
        metricNecRobustMin: args.evaluated.metricNecRobustMin,
        pressureScale: args.pressureScale,
        densityLiftFraction: args.densityLiftFraction,
        fluxScale: args.fluxScale,
        shearScale: args.shearScale,
        note: args.note,
      }),
    );
    coarseControlByCandidateId.set(args.candidateId, {
      pressureScale: args.pressureScale,
      densityLiftFraction: args.densityLiftFraction,
      fluxScale: args.fluxScale,
      shearScale: args.shearScale,
    });
    seenControlConfigs.add(
      makeControlConfigKey(
        args.pressureScale,
        args.densityLiftFraction,
        args.fluxScale,
        args.shearScale,
      ),
    );
  };
  pushCoarseCandidate({
    candidateId: "same_chart_physics_control_no_domain_shift_probe_v1",
    pressureScale: sameChartTensorPhysicsControlProbeScale,
    densityLiftFraction: sameChartTensorDensityLiftBaseline,
    fluxScale: sameChartTensorFluxScaleBaseline,
    shearScale: sameChartTensorShearScaleBaseline,
    evaluated: sameChartPressureScaleProbe,
    note:
      `Non-truncation same-chart physics-control probe keeps observer-domain bounds fixed and applies bounded E/J/S controls (s=${sameChartTensorPhysicsControlProbeScale}, rho_lift=${sameChartTensorDensityLiftBaseline}, flux_scale=${sameChartTensorFluxScaleBaseline}, shear_scale=${sameChartTensorShearScaleBaseline}) to test DEC lift under strict WEC/NEC non-regression gates.`,
  });
  pushCoarseCandidate({
    candidateId: "same_chart_physics_control_coupled_density_pressure_probe_v1",
    pressureScale: sameChartTensorPhysicsControlProbeScale,
    densityLiftFraction: sameChartTensorDensityLiftProbeFraction,
    fluxScale: sameChartTensorFluxScaleProbe,
    shearScale: sameChartTensorShearScaleProbe,
    evaluated: sameChartCoupledDensityPressureProbe,
    note:
      `Non-truncation coupled same-chart probe keeps observer-domain bounds fixed and applies bounded E/J/S controls (s=${sameChartTensorPhysicsControlProbeScale}, rho_lift=${sameChartTensorDensityLiftProbeFraction}, flux_scale=${sameChartTensorFluxScaleProbe}, shear_scale=${sameChartTensorShearScaleProbe}) to test DEC lift while preserving WEC/NEC non-regression on the admitted Einstein route.`,
  });
  const pressureScaleSweep = [0.85, 0.875, 0.9, 0.925, 0.95, 0.975];
  const densityLiftSweep = [0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15];
  const fluxScaleSweep = [sameChartTensorFluxScaleMin, 0.9, 0.95];
  const shearScaleSweep = [sameChartTensorShearScaleMin, 0.9, 0.95];
  for (const pressureScale of pressureScaleSweep) {
    for (const densityLiftFraction of densityLiftSweep) {
      for (const fluxScale of fluxScaleSweep) {
        for (const shearScale of shearScaleSweep) {
          const key = makeControlConfigKey(
            pressureScale,
            densityLiftFraction,
            fluxScale,
            shearScale,
          );
          if (seenControlConfigs.has(key)) continue;
          const evaluated = evaluateSameChartControlCandidate({
            pressureScale,
            densityLiftFraction,
            fluxScale,
            shearScale,
          });
          pushCoarseCandidate({
            candidateId: `same_chart_physics_control_pressure_${makeControlToken(pressureScale)}_density_${makeControlToken(densityLiftFraction)}_flux_${makeControlToken(fluxScale)}_shear_${makeControlToken(shearScale)}_probe_v1`,
            pressureScale,
            densityLiftFraction,
            fluxScale,
            shearScale,
            evaluated,
            note:
              `Bounded non-truncation same-chart coarse sweep candidate (s=${pressureScale}, rho_lift=${densityLiftFraction}, flux_scale=${fluxScale}, shear_scale=${shearScale}) for DEC margin-to-zero remediation under WEC/NEC non-regression gates.`,
          });
        }
      }
    }
  }
  const coarsePassingCandidates = coarseSweepCandidates
    .filter((candidate) => candidate.passesSelectionGate)
    .sort(compareCandidatesForSelection);
  const refineSeedCandidates = coarsePassingCandidates.slice(0, 3);
  const refineSeedCandidateIds = refineSeedCandidates.map(
    (candidate) => candidate.candidateId,
  );
  const refineSweepCandidates: DecSweepCandidate[] = [];
  const refinePressureOffsets = [-0.0125, 0, 0.0125];
  const refineDensityOffsets = [-0.0125, 0, 0.0125];
  const refineFluxOffsets = [-0.0125, 0, 0.0125];
  const refineShearOffsets = [-0.0125, 0, 0.0125];
  const minPressureScale = sameChartTensorPhysicsControlProbeScale;
  const maxPressureScale = sameChartTensorPhysicsControlBaseline;
  const minDensityLiftFraction = sameChartTensorDensityLiftBaseline;
  const maxDensityLiftFraction = sameChartTensorDensityLiftProbeFraction;
  const minFluxScale = sameChartTensorFluxScaleMin;
  const maxFluxScale = sameChartTensorFluxScaleBaseline;
  const minShearScale = sameChartTensorShearScaleMin;
  const maxShearScale = sameChartTensorShearScaleBaseline;
  for (const seed of refineSeedCandidates) {
    const seedControl = coarseControlByCandidateId.get(seed.candidateId);
    if (seedControl == null) continue;
    for (const pressureOffset of refinePressureOffsets) {
      for (const densityOffset of refineDensityOffsets) {
        for (const fluxOffset of refineFluxOffsets) {
          for (const shearOffset of refineShearOffsets) {
            if (
              pressureOffset === 0 &&
              densityOffset === 0 &&
              fluxOffset === 0 &&
              shearOffset === 0
            ) {
              continue;
            }
            const pressureScale = Number(
              clamp(
                seedControl.pressureScale + pressureOffset,
                minPressureScale,
                maxPressureScale,
              ).toFixed(6),
            );
            const densityLiftFraction = Number(
              clamp(
                seedControl.densityLiftFraction + densityOffset,
                minDensityLiftFraction,
                maxDensityLiftFraction,
              ).toFixed(6),
            );
            const fluxScale = Number(
              clamp(seedControl.fluxScale + fluxOffset, minFluxScale, maxFluxScale).toFixed(6),
            );
            const shearScale = Number(
              clamp(seedControl.shearScale + shearOffset, minShearScale, maxShearScale).toFixed(6),
            );
            const key = makeControlConfigKey(
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            );
            if (seenControlConfigs.has(key)) continue;
            seenControlConfigs.add(key);
            const evaluated = evaluateSameChartControlCandidate({
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            });
            refineSweepCandidates.push(
              buildSweepCandidate({
                candidateId: `same_chart_physics_control_refine_seed_${seed.candidateId}_pressure_${makeControlToken(pressureScale)}_density_${makeControlToken(densityLiftFraction)}_flux_${makeControlToken(fluxScale)}_shear_${makeControlToken(shearScale)}_probe_v1`,
                candidateClass: "physics_control_proposal",
                sweepPhase: "refine",
                refineSeedCandidateId: seed.candidateId,
                applied: false,
                rapidityCap: baselineRapidityCap,
                rapidityCapBeta: baselineRapidityCapBeta,
                metricDecRobustMin: evaluated.metricDecRobustMin,
                tileReconstitutedDecRobustMin:
                  evaluated.tileReconstitutedDecRobustMin,
                metricWecRobustMin: evaluated.metricWecRobustMin,
                metricNecRobustMin: evaluated.metricNecRobustMin,
                pressureScale,
                densityLiftFraction,
                fluxScale,
                shearScale,
                note:
                  `Refine sweep candidate around ${seed.candidateId} (s=${pressureScale}, rho_lift=${densityLiftFraction}, flux_scale=${fluxScale}, shear_scale=${shearScale}) for commensurate DEC margin localization under unchanged observer-domain bounds.`,
              }),
            );
          }
        }
      }
    }
  }
  const preFrontierSweepCandidates: Nhm2ObserverDecPhysicsControlEvidence["sweepCandidates"] =
    [...baselineSweepCandidates, ...coarseSweepCandidates, ...refineSweepCandidates];
  const preFrontierPassingCandidates = preFrontierSweepCandidates.filter(
    (candidate) => candidate.passesSelectionGate,
  );
  const preFrontierRankedPassingCandidates = [...preFrontierPassingCandidates].sort(
    compareCandidatesForSelection,
  );
  const preFrontierSelectedSweepCandidate =
    preFrontierRankedPassingCandidates.length > 0
      ? preFrontierRankedPassingCandidates[0]
      : preFrontierSweepCandidates[0];
  const preFrontierRankedPhysicsCandidates = [...preFrontierSweepCandidates]
    .filter((candidate) => candidate.candidateClass === "physics_control_proposal")
    .sort(compareCandidatesForSelection);
  const frontierSeedCandidate =
    preFrontierSelectedSweepCandidate?.candidateClass ===
    "physics_control_proposal"
      ? preFrontierSelectedSweepCandidate
      : (preFrontierRankedPhysicsCandidates[0] ?? null);
  const frontierSeedCandidateId = frontierSeedCandidate?.candidateId ?? null;
  const frontierSeedControl =
    frontierSeedCandidate != null &&
    frontierSeedCandidate.pressureScale != null &&
    frontierSeedCandidate.densityLiftFraction != null &&
    frontierSeedCandidate.fluxScale != null &&
    frontierSeedCandidate.shearScale != null
      ? {
          pressureScale: frontierSeedCandidate.pressureScale,
          densityLiftFraction: frontierSeedCandidate.densityLiftFraction,
          fluxScale: frontierSeedCandidate.fluxScale,
          shearScale: frontierSeedCandidate.shearScale,
        }
      : null;
  const frontierSweepCandidates: DecSweepCandidate[] = [];
  const frontierPressureOffsets = [-0.00625, 0, 0.00625];
  const frontierDensityOffsets = [-0.00625, 0, 0.00625];
  const frontierFluxOffsets = [-0.00625, 0, 0.00625];
  const frontierShearOffsets = [-0.00625, 0, 0.00625];
  if (frontierSeedCandidateId != null && frontierSeedControl != null) {
    for (const pressureOffset of frontierPressureOffsets) {
      for (const densityOffset of frontierDensityOffsets) {
        for (const fluxOffset of frontierFluxOffsets) {
          for (const shearOffset of frontierShearOffsets) {
            if (
              pressureOffset === 0 &&
              densityOffset === 0 &&
              fluxOffset === 0 &&
              shearOffset === 0
            ) {
              continue;
            }
            const pressureScale = Number(
              clamp(
                frontierSeedControl.pressureScale + pressureOffset,
                minPressureScale,
                maxPressureScale,
              ).toFixed(6),
            );
            const densityLiftFraction = Number(
              clamp(
                frontierSeedControl.densityLiftFraction + densityOffset,
                minDensityLiftFraction,
                maxDensityLiftFraction,
              ).toFixed(6),
            );
            const fluxScale = Number(
              clamp(
                frontierSeedControl.fluxScale + fluxOffset,
                minFluxScale,
                maxFluxScale,
              ).toFixed(6),
            );
            const shearScale = Number(
              clamp(
                frontierSeedControl.shearScale + shearOffset,
                minShearScale,
                maxShearScale,
              ).toFixed(6),
            );
            const key = makeControlConfigKey(
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            );
            if (seenControlConfigs.has(key)) continue;
            seenControlConfigs.add(key);
            const evaluated = evaluateSameChartControlCandidate({
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            });
            frontierSweepCandidates.push(
              buildSweepCandidate({
                candidateId: `same_chart_physics_control_frontier_seed_${frontierSeedCandidateId}_pressure_${makeControlToken(pressureScale)}_density_${makeControlToken(densityLiftFraction)}_flux_${makeControlToken(fluxScale)}_shear_${makeControlToken(shearScale)}_probe_v1`,
                candidateClass: "physics_control_proposal",
                sweepPhase: "frontier",
                refineSeedCandidateId: frontierSeedCandidateId,
                applied: false,
                rapidityCap: baselineRapidityCap,
                rapidityCapBeta: baselineRapidityCapBeta,
                metricDecRobustMin: evaluated.metricDecRobustMin,
                tileReconstitutedDecRobustMin:
                  evaluated.tileReconstitutedDecRobustMin,
                metricWecRobustMin: evaluated.metricWecRobustMin,
                metricNecRobustMin: evaluated.metricNecRobustMin,
                pressureScale,
                densityLiftFraction,
                fluxScale,
                shearScale,
                note:
                  `Frontier neighborhood candidate around ${frontierSeedCandidateId} (s=${pressureScale}, rho_lift=${densityLiftFraction}, flux_scale=${fluxScale}, shear_scale=${shearScale}) for bounded local DEC improvement localization under unchanged observer-domain bounds.`,
              }),
            );
          }
        }
      }
    }
  }
  const primaryFrontierPassingCandidates = frontierSweepCandidates
    .filter((candidate) => candidate.passesSelectionGate)
    .sort(compareCandidatesForSelection);
  const primaryFrontierBestCandidate =
    primaryFrontierPassingCandidates.length > 0
      ? primaryFrontierPassingCandidates[0]
      : [...frontierSweepCandidates].sort(compareCandidatesForSelection)[0] ??
        null;
  const primarySweepCandidates: Nhm2ObserverDecPhysicsControlEvidence["sweepCandidates"] =
    [...preFrontierSweepCandidates, ...frontierSweepCandidates];
  const primaryPassingCandidates = primarySweepCandidates.filter(
    (candidate) => candidate.passesSelectionGate,
  );
  const primaryRankedPassingCandidates = [...primaryPassingCandidates].sort(
    compareCandidatesForSelection,
  );
  const primarySelectedSweepCandidate =
    primaryRankedPassingCandidates.length > 0
      ? primaryRankedPassingCandidates[0]
      : primarySweepCandidates[0];
  const primaryRankedPhysicsCandidates = [...primarySweepCandidates]
    .filter((candidate) => candidate.candidateClass === "physics_control_proposal")
    .sort(compareCandidatesForSelection);
  const needsExpandedBoundsSweep =
    primarySelectedSweepCandidate.crossesZeroBothDecMargins !== true &&
    (primarySelectedSweepCandidate.selectionObjectivePrimaryMargin ??
      Number.NEGATIVE_INFINITY) < 0;
  const tranche4SeedCandidate =
    primarySelectedSweepCandidate.candidateClass === "physics_control_proposal"
      ? primarySelectedSweepCandidate
      : (primaryRankedPhysicsCandidates[0] ?? null);
  const tranche4SeedControl =
    tranche4SeedCandidate != null &&
    tranche4SeedCandidate.pressureScale != null &&
    tranche4SeedCandidate.densityLiftFraction != null &&
    tranche4SeedCandidate.fluxScale != null &&
    tranche4SeedCandidate.shearScale != null
      ? {
          pressureScale: tranche4SeedCandidate.pressureScale,
          densityLiftFraction: tranche4SeedCandidate.densityLiftFraction,
          fluxScale: tranche4SeedCandidate.fluxScale,
          shearScale: tranche4SeedCandidate.shearScale,
        }
      : null;
  const tranche4SweepCandidates: DecSweepCandidate[] = [];
  const tranche4PressureSweep = [0.8, 0.8125, 0.825, 0.8375, 0.85];
  const tranche4DensityLiftSweep = [0.15, 0.1625, 0.175, 0.1875, 0.2];
  const tranche4FluxScaleSweep = [0.8, 0.825, 0.85];
  const tranche4ShearScaleSweep = [0.8, 0.825, 0.85];
  if (needsExpandedBoundsSweep && tranche4SeedControl != null) {
    for (const pressureScaleCandidate of tranche4PressureSweep) {
      for (const densityLiftCandidate of tranche4DensityLiftSweep) {
        for (const fluxScaleCandidate of tranche4FluxScaleSweep) {
          for (const shearScaleCandidate of tranche4ShearScaleSweep) {
            const pressureScale = Number(
              clamp(
                Math.min(
                  tranche4SeedControl.pressureScale,
                  pressureScaleCandidate,
                ),
                sameChartTensorExpandedBoundedEnvelope.pressureScaleMin,
                sameChartTensorExpandedBoundedEnvelope.pressureScaleMax,
              ).toFixed(6),
            );
            const densityLiftFraction = Number(
              clamp(
                Math.max(
                  tranche4SeedControl.densityLiftFraction,
                  densityLiftCandidate,
                ),
                sameChartTensorExpandedBoundedEnvelope.densityLiftMin,
                sameChartTensorExpandedBoundedEnvelope.densityLiftMax,
              ).toFixed(6),
            );
            const fluxScale = Number(
              clamp(
                Math.min(tranche4SeedControl.fluxScale, fluxScaleCandidate),
                sameChartTensorExpandedBoundedEnvelope.fluxScaleMin,
                sameChartTensorExpandedBoundedEnvelope.fluxScaleMax,
              ).toFixed(6),
            );
            const shearScale = Number(
              clamp(
                Math.min(tranche4SeedControl.shearScale, shearScaleCandidate),
                sameChartTensorExpandedBoundedEnvelope.shearScaleMin,
                sameChartTensorExpandedBoundedEnvelope.shearScaleMax,
              ).toFixed(6),
            );
            const key = makeControlConfigKey(
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            );
            if (seenControlConfigs.has(key)) continue;
            seenControlConfigs.add(key);
            const evaluated = evaluateSameChartControlCandidate({
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
              boundedEnvelope: sameChartTensorExpandedBoundedEnvelope,
            });
            tranche4SweepCandidates.push(
              buildSweepCandidate({
                candidateId: `same_chart_physics_control_tranche4_seed_${tranche4SeedCandidate.candidateId}_pressure_${makeControlToken(pressureScale)}_density_${makeControlToken(densityLiftFraction)}_flux_${makeControlToken(fluxScale)}_shear_${makeControlToken(shearScale)}_probe_v1`,
                candidateClass: "physics_control_proposal",
                sweepPhase: "frontier",
                refineSeedCandidateId: tranche4SeedCandidate.candidateId,
                applied: false,
                rapidityCap: baselineRapidityCap,
                rapidityCapBeta: baselineRapidityCapBeta,
                metricDecRobustMin: evaluated.metricDecRobustMin,
                tileReconstitutedDecRobustMin:
                  evaluated.tileReconstitutedDecRobustMin,
                metricWecRobustMin: evaluated.metricWecRobustMin,
                metricNecRobustMin: evaluated.metricNecRobustMin,
                pressureScale,
                densityLiftFraction,
                fluxScale,
                shearScale,
                note:
                  `Tranche-4 expanded-envelope candidate around ${tranche4SeedCandidate.candidateId} (s=${pressureScale}, rho_lift=${densityLiftFraction}, flux_scale=${fluxScale}, shear_scale=${shearScale}) extends bounded same-chart controls beyond tranche-3 limits while preserving non-regression and comparability gates.`,
              }),
            );
          }
        }
      }
    }
  }
  const postTranche4SweepCandidates: DecSweepCandidate[] = [
    ...primarySweepCandidates,
    ...tranche4SweepCandidates,
  ];
  const postTranche4PassingCandidates = postTranche4SweepCandidates
    .filter((candidate) => candidate.passesSelectionGate)
    .sort(compareCandidatesForSelection);
  const postTranche4SelectedSweepCandidate =
    postTranche4PassingCandidates.length > 0
      ? postTranche4PassingCandidates[0]
      : [...postTranche4SweepCandidates].sort(compareCandidatesForSelection)[0] ??
        primarySelectedSweepCandidate;
  const needsTargetedBoundsSweep =
    postTranche4SelectedSweepCandidate.crossesZeroBothDecMargins !== true &&
    (postTranche4SelectedSweepCandidate.selectionObjectivePrimaryMargin ??
      Number.NEGATIVE_INFINITY) < 0;
  const postTranche4RankedPhysicsCandidates = [...postTranche4SweepCandidates]
    .filter((candidate) => candidate.candidateClass === "physics_control_proposal")
    .sort(compareCandidatesForSelection);
  const tranche5SeedCandidate =
    postTranche4SelectedSweepCandidate.candidateClass ===
    "physics_control_proposal"
      ? postTranche4SelectedSweepCandidate
      : (postTranche4RankedPhysicsCandidates[0] ?? tranche4SeedCandidate);
  const tranche5SeedControl =
    tranche5SeedCandidate != null &&
    tranche5SeedCandidate.pressureScale != null &&
    tranche5SeedCandidate.densityLiftFraction != null &&
    tranche5SeedCandidate.fluxScale != null &&
    tranche5SeedCandidate.shearScale != null
      ? {
          pressureScale: tranche5SeedCandidate.pressureScale,
          densityLiftFraction: tranche5SeedCandidate.densityLiftFraction,
          fluxScale: tranche5SeedCandidate.fluxScale,
          shearScale: tranche5SeedCandidate.shearScale,
        }
      : null;
  const tranche5SweepCandidates: DecSweepCandidate[] = [];
  const tranche5PressureSweep = [0.6, 0.65, 0.7, 0.75, 0.8];
  const tranche5DensityLiftSweep = [0.2, 0.25, 0.3, 0.35, 0.4];
  const tranche5FluxScaleSweep = [0.8, 0.9];
  const tranche5ShearScaleSweep = [0.5, 0.6, 0.7, 0.8];
  if (needsTargetedBoundsSweep && tranche5SeedControl != null) {
    for (const pressureScaleCandidate of tranche5PressureSweep) {
      for (const densityLiftCandidate of tranche5DensityLiftSweep) {
        for (const fluxScaleCandidate of tranche5FluxScaleSweep) {
          for (const shearScaleCandidate of tranche5ShearScaleSweep) {
            const pressureScale = Number(
              clamp(
                Math.min(
                  tranche5SeedControl.pressureScale,
                  pressureScaleCandidate,
                ),
                sameChartTensorTargetedBoundedEnvelope.pressureScaleMin,
                sameChartTensorTargetedBoundedEnvelope.pressureScaleMax,
              ).toFixed(6),
            );
            const densityLiftFraction = Number(
              clamp(
                Math.max(
                  tranche5SeedControl.densityLiftFraction,
                  densityLiftCandidate,
                ),
                sameChartTensorTargetedBoundedEnvelope.densityLiftMin,
                sameChartTensorTargetedBoundedEnvelope.densityLiftMax,
              ).toFixed(6),
            );
            const fluxScale = Number(
              clamp(
                Math.min(tranche5SeedControl.fluxScale, fluxScaleCandidate),
                sameChartTensorTargetedBoundedEnvelope.fluxScaleMin,
                sameChartTensorTargetedBoundedEnvelope.fluxScaleMax,
              ).toFixed(6),
            );
            const shearScale = Number(
              clamp(
                Math.min(tranche5SeedControl.shearScale, shearScaleCandidate),
                sameChartTensorTargetedBoundedEnvelope.shearScaleMin,
                sameChartTensorTargetedBoundedEnvelope.shearScaleMax,
              ).toFixed(6),
            );
            const key = makeControlConfigKey(
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            );
            if (seenControlConfigs.has(key)) continue;
            seenControlConfigs.add(key);
            const evaluated = evaluateSameChartControlCandidate({
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
              boundedEnvelope: sameChartTensorTargetedBoundedEnvelope,
            });
            tranche5SweepCandidates.push(
              buildSweepCandidate({
                candidateId: `same_chart_physics_control_targeted_seed_${tranche5SeedCandidate.candidateId}_pressure_${makeControlToken(pressureScale)}_density_${makeControlToken(densityLiftFraction)}_flux_${makeControlToken(fluxScale)}_shear_${makeControlToken(shearScale)}_probe_v1`,
                candidateClass: "physics_control_proposal",
                sweepPhase: "frontier",
                refineSeedCandidateId: tranche5SeedCandidate.candidateId,
                applied: false,
                rapidityCap: baselineRapidityCap,
                rapidityCapBeta: baselineRapidityCapBeta,
                metricDecRobustMin: evaluated.metricDecRobustMin,
                tileReconstitutedDecRobustMin:
                  evaluated.tileReconstitutedDecRobustMin,
                metricWecRobustMin: evaluated.metricWecRobustMin,
                metricNecRobustMin: evaluated.metricNecRobustMin,
                pressureScale,
                densityLiftFraction,
                fluxScale,
                shearScale,
                note:
                  `Targeted DEC-lift candidate around ${tranche5SeedCandidate.candidateId} (s=${pressureScale}, rho_lift=${densityLiftFraction}, flux_scale=${fluxScale}, shear_scale=${shearScale}) extends bounded controls in the same chart while keeping non-regression and comparability gates unchanged.`,
              }),
            );
          }
        }
      }
    }
  }
  const postTranche5SweepCandidates: DecSweepCandidate[] = [
    ...postTranche4SweepCandidates,
    ...tranche5SweepCandidates,
  ];
  const postTranche5PassingCandidates = postTranche5SweepCandidates
    .filter((candidate) => candidate.passesSelectionGate)
    .sort(compareCandidatesForSelection);
  const postTranche5SelectedSweepCandidate =
    postTranche5PassingCandidates.length > 0
      ? postTranche5PassingCandidates[0]
      : [...postTranche5SweepCandidates].sort(compareCandidatesForSelection)[0] ??
        postTranche4SelectedSweepCandidate;
  const needsEdgeBoundsSweep =
    postTranche5SelectedSweepCandidate.crossesZeroBothDecMargins !== true &&
    (postTranche5SelectedSweepCandidate.selectionObjectivePrimaryMargin ??
      Number.NEGATIVE_INFINITY) < 0;
  const postTranche5RankedPhysicsCandidates = [...postTranche5SweepCandidates]
    .filter((candidate) => candidate.candidateClass === "physics_control_proposal")
    .sort(compareCandidatesForSelection);
  const tranche6SeedCandidate =
    postTranche5SelectedSweepCandidate.candidateClass ===
    "physics_control_proposal"
      ? postTranche5SelectedSweepCandidate
      : (postTranche5RankedPhysicsCandidates[0] ?? tranche5SeedCandidate);
  const tranche6SeedControl =
    tranche6SeedCandidate != null &&
    tranche6SeedCandidate.pressureScale != null &&
    tranche6SeedCandidate.densityLiftFraction != null &&
    tranche6SeedCandidate.fluxScale != null &&
    tranche6SeedCandidate.shearScale != null
      ? {
          pressureScale: tranche6SeedCandidate.pressureScale,
          densityLiftFraction: tranche6SeedCandidate.densityLiftFraction,
          fluxScale: tranche6SeedCandidate.fluxScale,
          shearScale: tranche6SeedCandidate.shearScale,
        }
      : null;
  const tranche6SweepCandidates: DecSweepCandidate[] = [];
  const tranche6PressureSweep = [0.5, 0.525, 0.55, 0.575, 0.6];
  const tranche6DensityLiftSweep = [0.4, 0.425, 0.45, 0.475, 0.5];
  const tranche6FluxScaleSweep = [0.75, 0.8, 0.85];
  const tranche6ShearScaleSweep = [0.35, 0.4, 0.45, 0.5];
  if (needsEdgeBoundsSweep && tranche6SeedControl != null) {
    for (const pressureScaleCandidate of tranche6PressureSweep) {
      for (const densityLiftCandidate of tranche6DensityLiftSweep) {
        for (const fluxScaleCandidate of tranche6FluxScaleSweep) {
          for (const shearScaleCandidate of tranche6ShearScaleSweep) {
            const pressureScale = Number(
              clamp(
                Math.min(
                  tranche6SeedControl.pressureScale,
                  pressureScaleCandidate,
                ),
                sameChartTensorEdgeBoundedEnvelope.pressureScaleMin,
                sameChartTensorEdgeBoundedEnvelope.pressureScaleMax,
              ).toFixed(6),
            );
            const densityLiftFraction = Number(
              clamp(
                Math.max(
                  tranche6SeedControl.densityLiftFraction,
                  densityLiftCandidate,
                ),
                sameChartTensorEdgeBoundedEnvelope.densityLiftMin,
                sameChartTensorEdgeBoundedEnvelope.densityLiftMax,
              ).toFixed(6),
            );
            const fluxScale = Number(
              clamp(
                Math.min(tranche6SeedControl.fluxScale, fluxScaleCandidate),
                sameChartTensorEdgeBoundedEnvelope.fluxScaleMin,
                sameChartTensorEdgeBoundedEnvelope.fluxScaleMax,
              ).toFixed(6),
            );
            const shearScale = Number(
              clamp(
                Math.min(tranche6SeedControl.shearScale, shearScaleCandidate),
                sameChartTensorEdgeBoundedEnvelope.shearScaleMin,
                sameChartTensorEdgeBoundedEnvelope.shearScaleMax,
              ).toFixed(6),
            );
            const key = makeControlConfigKey(
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
            );
            if (seenControlConfigs.has(key)) continue;
            seenControlConfigs.add(key);
            const evaluated = evaluateSameChartControlCandidate({
              pressureScale,
              densityLiftFraction,
              fluxScale,
              shearScale,
              boundedEnvelope: sameChartTensorEdgeBoundedEnvelope,
            });
            tranche6SweepCandidates.push(
              buildSweepCandidate({
                candidateId: `same_chart_physics_control_edge_seed_${tranche6SeedCandidate.candidateId}_pressure_${makeControlToken(pressureScale)}_density_${makeControlToken(densityLiftFraction)}_flux_${makeControlToken(fluxScale)}_shear_${makeControlToken(shearScale)}_probe_v1`,
                candidateClass: "physics_control_proposal",
                sweepPhase: "frontier",
                refineSeedCandidateId: tranche6SeedCandidate.candidateId,
                applied: false,
                rapidityCap: baselineRapidityCap,
                rapidityCapBeta: baselineRapidityCapBeta,
                metricDecRobustMin: evaluated.metricDecRobustMin,
                tileReconstitutedDecRobustMin:
                  evaluated.tileReconstitutedDecRobustMin,
                metricWecRobustMin: evaluated.metricWecRobustMin,
                metricNecRobustMin: evaluated.metricNecRobustMin,
                pressureScale,
                densityLiftFraction,
                fluxScale,
                shearScale,
                note:
                  `Edge DEC-crossing candidate around ${tranche6SeedCandidate.candidateId} (s=${pressureScale}, rho_lift=${densityLiftFraction}, flux_scale=${fluxScale}, shear_scale=${shearScale}) extends bounded controls only at the selection frontier while preserving non-regression and comparability gates.`,
              }),
            );
          }
        }
      }
    }
  }
  const frontierSweepCandidatesAll: DecSweepCandidate[] = [
    ...frontierSweepCandidates,
    ...tranche4SweepCandidates,
    ...tranche5SweepCandidates,
    ...tranche6SweepCandidates,
  ];
  const frontierPassingCandidates = frontierSweepCandidatesAll
    .filter((candidate) => candidate.passesSelectionGate)
    .sort(compareCandidatesForSelection);
  const frontierBestCandidate =
    frontierPassingCandidates.length > 0
      ? frontierPassingCandidates[0]
      : [...frontierSweepCandidatesAll].sort(compareCandidatesForSelection)[0] ??
        primaryFrontierBestCandidate;
  const sweepCandidates: Nhm2ObserverDecPhysicsControlEvidence["sweepCandidates"] =
    [...preFrontierSweepCandidates, ...frontierSweepCandidatesAll];
  const passingCandidates = sweepCandidates.filter(
    (candidate) => candidate.passesSelectionGate,
  );
  const rankedPassingCandidates = [...passingCandidates].sort(
    compareCandidatesForSelection,
  );
  const selectedSweepCandidate =
    rankedPassingCandidates.length > 0
      ? rankedPassingCandidates[0]
      : sweepCandidates[0];
  const selectionDecision: Nhm2ObserverDecPhysicsControlEvidence["selectionDecision"] =
    passingCandidates.length > 0 ? "apply_candidate" : "hold_baseline";
  const selectionPlateauStatus: Nhm2ObserverDecPhysicsControlEvidence["selectionPlateauStatus"] =
    rankedPassingCandidates.length === 0
      ? "no_passing_candidate"
      : selectedSweepCandidate.crossesZeroBothDecMargins === true
        ? "cross_zero_candidate_found"
        : "best_margin_still_negative";
  const selectedCandidateId =
    selectedSweepCandidate?.candidateId ?? "baseline_hold_no_applied_control_patch_v1";
  const selectionReasonCodes: Nhm2ObserverDecPhysicsControlEvidence["selectionReasonCodes"] =
    passingCandidates.length > 0
      ? [
          "selection_gate_pass",
          ...(selectionPlateauStatus === "best_margin_still_negative"
            ? ["best_margin_still_negative"]
            : []),
        ]
      : Array.from(
          new Set(
            sweepCandidates
              .filter((candidate) => candidate.candidateClass !== "baseline_hold")
              .flatMap((candidate) => candidate.gateFailureReasons)
              .filter((reason) => reason !== "selection_gate_pass"),
          ),
        );
  const rankedPhysicsCandidates = [...sweepCandidates]
    .filter((candidate) => candidate.candidateClass === "physics_control_proposal")
    .sort(compareCandidatesForSelection);
  const runtimeSweepCandidate =
    selectionDecision === "apply_candidate"
      ? selectedSweepCandidate
      : (rankedPhysicsCandidates[0] ?? selectedSweepCandidate);
  const activeBoundedEnvelope =
    tranche6SweepCandidates.length > 0
      ? sameChartTensorEdgeBoundedEnvelope
      : tranche5SweepCandidates.length > 0
        ? sameChartTensorTargetedBoundedEnvelope
        : tranche4SweepCandidates.length > 0
          ? sameChartTensorExpandedBoundedEnvelope
          : sameChartTensorPrimaryBoundedEnvelope;
  if (selectionReasonCodes.length === 0) {
    selectionReasonCodes.push("candidate_not_evaluated");
  }
  const sweepPhaseSummary: Nhm2ObserverDecPhysicsControlEvidence["sweepPhaseSummary"] =
    {
      coarseCandidateCount: coarseSweepCandidates.length,
      coarsePassingCount: coarsePassingCandidates.length,
      refineCandidateCount: refineSweepCandidates.length,
      refinePassingCount: refineSweepCandidates.filter(
        (candidate) => candidate.passesSelectionGate,
      ).length,
      refineSeedCandidateIds,
      frontierCandidateCount: frontierSweepCandidatesAll.length,
      frontierPassingCount: frontierPassingCandidates.length,
      frontierSeedCandidateId,
      note:
        tranche6SweepCandidates.length > 0
          ? `Frontier sweep extended with edge DEC-crossing probes (${tranche6SweepCandidates.length} candidates) after targeted tranche remained below zero while keeping comparability and non-regression gates unchanged.`
          : tranche5SweepCandidates.length > 0
            ? `Frontier sweep extended with targeted DEC-lift probes (${tranche5SweepCandidates.length} candidates) after tranche-4 bounded sweep remained below zero while keeping comparability and non-regression gates unchanged.`
            : tranche4SweepCandidates.length > 0
              ? `Frontier sweep extended with tranche-4 expanded-envelope probes (${tranche4SweepCandidates.length} candidates) after bounded tranche-3 exhaustion while keeping comparability and non-regression gates unchanged.`
              : frontierSeedCandidateId != null && frontierSweepCandidates.length > 0
                ? "Frontier neighborhood sweep expanded around the best pre-frontier physics-control candidate under unchanged semantic and observer-domain constraints."
                : refineSeedCandidateIds.length > 0
                  ? "Refine sweep expanded around top coarse passing seeds under unchanged semantic and observer-domain constraints."
                  : "No coarse passing seed was available for refine expansion; selection remains constrained to baseline/coarse evidence.",
    };
  const topCandidateLeaderboard: Nhm2ObserverDecPhysicsControlEvidence["topCandidateLeaderboard"] =
    [...sweepCandidates]
      .sort(compareCandidatesForLeaderboard)
      .slice(0, 5)
      .map((candidate, index) => ({
        rank: index + 1,
        candidateId: candidate.candidateId,
        candidateClass: candidate.candidateClass,
        sweepPhase: candidate.sweepPhase,
        passesSelectionGate: candidate.passesSelectionGate,
        crossesZeroBothDecMargins: candidate.crossesZeroBothDecMargins,
        selectionObjectivePrimaryMargin: candidate.selectionObjectivePrimaryMargin,
        metricDecRobustLift: candidate.metricDecRobustLift,
        tileReconstitutedDecRobustLift: candidate.tileReconstitutedDecRobustLift,
        controlDeviationMagnitude: candidate.controlDeviationMagnitude,
      }));
  const metricDecRobustLift = selectedSweepCandidate.metricDecRobustLift;
  const tileReconstitutedDecRobustLift =
    selectedSweepCandidate.tileReconstitutedDecRobustLift;
  const metricWecRobustDelta = selectedSweepCandidate.metricWecRobustDelta;
  const metricNecRobustDelta = selectedSweepCandidate.metricNecRobustDelta;
  const metricWecNonRegression =
    selectedSweepCandidate.guardChecks.metricWecNonRegression;
  const metricNecNonRegression =
    selectedSweepCandidate.guardChecks.metricNecNonRegression;
  const candidateId = selectedCandidateId;
  const candidateMetricDecEulerianMin = baselineMetricDecEulerianMin;
  const candidateMetricDecRobustMin = selectedSweepCandidate.metricDecRobustMin;
  const candidateMetricWecEulerianMin = baselineMetricWecEulerianMin;
  const candidateMetricWecRobustMin = selectedSweepCandidate.metricWecRobustMin;
  const candidateMetricNecEulerianMin = baselineMetricNecEulerianMin;
  const candidateMetricNecRobustMin = selectedSweepCandidate.metricNecRobustMin;
  const candidateTileDecEulerianMin = baselineTileDecEulerianMin;
  const candidateTileDecRobustMin =
    selectedSweepCandidate.tileReconstitutedDecRobustMin;
  const candidateTileWecEulerianMin = baselineTileWecEulerianMin;
  const candidateTileWecRobustMin =
    selectionDecision === "apply_candidate"
      ? selectedSweepCandidate.metricWecRobustMin
      : baselineTileWecRobustMin;
  const candidateTileNecEulerianMin = baselineTileNecEulerianMin;
  const candidateTileNecRobustMin =
    selectionDecision === "apply_candidate"
      ? selectedSweepCandidate.metricNecRobustMin
      : baselineTileNecRobustMin;
  const runtimeApplicationEnabled = isNhm2DecPhysicsRuntimeApplyEnabled();
  const runtimeApplicationAttempted =
    selectionDecision === "apply_candidate" ||
    (runtimeApplicationEnabled &&
      runtimeSweepCandidate.candidateClass === "physics_control_proposal");
  const runtimeSelectedPathParity = selectedPath === "full_einstein_tensor";
  const runtimeChartParity =
    args.modelTermSemanticEvidence.chartRef === "comoving_cartesian";
  const runtimeIndependentCrossCheckStatus =
    args.modelTermSemanticEvidence.checks.independentCrossCheck;
  const runtimeReferenceRouteId =
    getNhm2ModelTermNoteValue(
      args.modelTermSemanticEvidence.notes,
      "independentCrossCheckReferenceRouteId",
    ) ??
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    routeId;
  const runtimeSampleCount = toFiniteNumber(args.metricTensorInput.sampleCount);
  const runtimeComparableSampleCount =
    toFiniteNumber(
      getNhm2ModelTermNoteValue(
        args.modelTermSemanticEvidence.notes,
        "independentCrossCheckComparedSampleCount",
      ),
    ) ??
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence
      ?.comparedSampleCount ??
    runtimeSampleCount;
  const runtimeMinimumComparableSampleCount =
    NHM2_DEC_PHYSICS_RUNTIME_MIN_COMPARABLE_SAMPLE_COUNT;
  const runtimeSampleCountSufficient =
    runtimeComparableSampleCount != null
      ? runtimeComparableSampleCount >= runtimeMinimumComparableSampleCount
      : false;
  const runtimeRouteComparable =
    runtimeSelectedPathParity &&
    runtimeChartParity &&
    args.modelTermSemanticEvidence.checks.fullEinsteinTensorRouteAdmission ===
      "pass" &&
    runtimeIndependentCrossCheckStatus === "pass" &&
    runtimeReferenceRouteId != null;
  const runtimeEvaluationComparable =
    runtimeRouteComparable && runtimeSampleCountSufficient;
  const runtimeMetricDecRobustLift = runtimeSweepCandidate.metricDecRobustLift;
  const runtimeTileReconstitutedDecRobustLift =
    runtimeSweepCandidate.tileReconstitutedDecRobustLift;
  const runtimeMetricWecRobustDelta = runtimeSweepCandidate.metricWecRobustDelta;
  const runtimeMetricNecRobustDelta = runtimeSweepCandidate.metricNecRobustDelta;
  const runtimeMetricDecRobustMarginToZero =
    runtimeSweepCandidate.metricDecRobustMin;
  const runtimeTileDecRobustMarginToZero =
    runtimeSweepCandidate.tileReconstitutedDecRobustMin;
  const runtimeIndependentCrossCheckRelativeResidual =
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "independentCrossCheckMaxRelativeResidual",
    ) ??
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "einsteinTensorRoute.maxRelativeResidual",
    ) ??
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "finiteDifferenceFallbackFinestT0iResidual",
    ) ??
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "finiteDifferenceFallbackFinestOffDiagonalResidual",
    ) ??
    0;
  const runtimeFiniteDifferenceResidualBoundCandidates = [
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "finiteDifferenceT0iDriftMax",
    ),
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "finiteDifferenceOffDiagonalDriftMax",
    ),
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "finiteDifferenceFallbackFinestT0iResidual",
    ),
    getNhm2ModelTermNoteNonNegativeValue(
      args.modelTermSemanticEvidence.notes,
      "finiteDifferenceFallbackFinestOffDiagonalResidual",
    ),
  ].filter((entry): entry is number => entry != null);
  const runtimeFiniteDifferenceResidualBound =
    runtimeFiniteDifferenceResidualBoundCandidates.length > 0
      ? Math.max(...runtimeFiniteDifferenceResidualBoundCandidates)
      : 0;
  const runtimeUncertaintyRelativeBound = Math.max(
    runtimeIndependentCrossCheckRelativeResidual,
    runtimeFiniteDifferenceResidualBound,
    NHM2_DEC_PHYSICS_RUNTIME_UNCERTAINTY_RELATIVE_MARGIN_FLOOR,
  );
  const runtimeMetricDecUncertaintyAbs =
    runtimeMetricDecRobustMarginToZero != null
      ? Math.abs(runtimeMetricDecRobustMarginToZero) *
        runtimeUncertaintyRelativeBound
      : null;
  const runtimeTileDecUncertaintyAbs =
    runtimeTileDecRobustMarginToZero != null
      ? Math.abs(runtimeTileDecRobustMarginToZero) * runtimeUncertaintyRelativeBound
      : null;
  const runtimeMetricDecConservativeMarginToZero =
    runtimeMetricDecRobustMarginToZero != null &&
    runtimeMetricDecUncertaintyAbs != null
      ? runtimeMetricDecRobustMarginToZero - runtimeMetricDecUncertaintyAbs
      : null;
  const runtimeTileDecConservativeMarginToZero =
    runtimeTileDecRobustMarginToZero != null &&
    runtimeTileDecUncertaintyAbs != null
      ? runtimeTileDecRobustMarginToZero - runtimeTileDecUncertaintyAbs
      : null;
  const runtimeReferenceMetricDecRobustMarginToZero =
    runtimeMetricDecRobustMarginToZero != null
      ? runtimeMetricDecRobustMarginToZero >= 0
        ? runtimeMetricDecRobustMarginToZero *
          (1 - runtimeIndependentCrossCheckRelativeResidual)
        : runtimeMetricDecRobustMarginToZero *
          (1 + runtimeIndependentCrossCheckRelativeResidual)
      : null;
  const runtimeReferenceTileDecRobustMarginToZero =
    runtimeTileDecRobustMarginToZero != null
      ? runtimeTileDecRobustMarginToZero >= 0
        ? runtimeTileDecRobustMarginToZero *
          (1 - runtimeIndependentCrossCheckRelativeResidual)
        : runtimeTileDecRobustMarginToZero *
          (1 + runtimeIndependentCrossCheckRelativeResidual)
      : null;
  const runtimeReferenceMetricDecUncertaintyAbs =
    runtimeReferenceMetricDecRobustMarginToZero != null
      ? Math.abs(runtimeReferenceMetricDecRobustMarginToZero) *
        runtimeUncertaintyRelativeBound
      : null;
  const runtimeReferenceTileDecUncertaintyAbs =
    runtimeReferenceTileDecRobustMarginToZero != null
      ? Math.abs(runtimeReferenceTileDecRobustMarginToZero) *
        runtimeUncertaintyRelativeBound
      : null;
  const runtimeReferenceMetricDecConservativeMarginToZero =
    runtimeReferenceMetricDecRobustMarginToZero != null &&
    runtimeReferenceMetricDecUncertaintyAbs != null
      ? runtimeReferenceMetricDecRobustMarginToZero -
        runtimeReferenceMetricDecUncertaintyAbs
      : null;
  const runtimeReferenceTileDecConservativeMarginToZero =
    runtimeReferenceTileDecRobustMarginToZero != null &&
    runtimeReferenceTileDecUncertaintyAbs != null
      ? runtimeReferenceTileDecRobustMarginToZero -
        runtimeReferenceTileDecUncertaintyAbs
      : null;
  const runtimeMetricSignAgreement =
    runtimeMetricDecRobustMarginToZero != null &&
    runtimeReferenceMetricDecRobustMarginToZero != null
      ? Math.abs(runtimeMetricDecRobustMarginToZero) >
          NHM2_DEC_PHYSICS_RUNTIME_SIGN_EPSILON &&
        Math.abs(runtimeReferenceMetricDecRobustMarginToZero) >
          NHM2_DEC_PHYSICS_RUNTIME_SIGN_EPSILON &&
        Math.sign(runtimeMetricDecRobustMarginToZero) ===
          Math.sign(runtimeReferenceMetricDecRobustMarginToZero)
      : null;
  const runtimeTileSignAgreement =
    runtimeTileDecRobustMarginToZero != null &&
    runtimeReferenceTileDecRobustMarginToZero != null
      ? Math.abs(runtimeTileDecRobustMarginToZero) >
          NHM2_DEC_PHYSICS_RUNTIME_SIGN_EPSILON &&
        Math.abs(runtimeReferenceTileDecRobustMarginToZero) >
          NHM2_DEC_PHYSICS_RUNTIME_SIGN_EPSILON &&
        Math.sign(runtimeTileDecRobustMarginToZero) ===
          Math.sign(runtimeReferenceTileDecRobustMarginToZero)
      : null;
  const runtimeIndependentCrossCheckSignAgreement =
    runtimeMetricSignAgreement === true && runtimeTileSignAgreement === true;
  const runtimeReferenceCrossesZeroBothDecMargins =
    runtimeReferenceMetricDecConservativeMarginToZero != null &&
    runtimeReferenceTileDecConservativeMarginToZero != null
      ? runtimeReferenceMetricDecConservativeMarginToZero > 0 &&
        runtimeReferenceTileDecConservativeMarginToZero > 0
      : false;
  const runtimeSelectedCrossesZeroUnderUncertainty =
    runtimeMetricDecConservativeMarginToZero != null &&
    runtimeTileDecConservativeMarginToZero != null
      ? runtimeMetricDecConservativeMarginToZero > 0 &&
        runtimeTileDecConservativeMarginToZero > 0
      : false;
  const runtimeUncertaintyBoundPass =
    runtimeSelectedCrossesZeroUnderUncertainty &&
    runtimeReferenceCrossesZeroBothDecMargins;
  const evaluatorClosureEvidence =
    args.modelTermSemanticEvidence.einsteinEvaluatorClosureEvidence ?? null;
  const refinementCoarseStepM = toFiniteNumber(
    evaluatorClosureEvidence?.resolutionSweep?.coarse?.step_m,
  );
  const refinementRefinedStepM = toFiniteNumber(
    evaluatorClosureEvidence?.resolutionSweep?.refined?.step_m,
  );
  const refinementSuperRefinedStepM = toFiniteNumber(
    evaluatorClosureEvidence?.resolutionSweep?.superRefined?.step_m,
  );
  const refinementObservedConvergenceOrderT0i = toFiniteNumber(
    evaluatorClosureEvidence?.observedConvergenceOrder?.t0i,
  );
  const refinementObservedConvergenceOrderOffDiagonal = toFiniteNumber(
    evaluatorClosureEvidence?.observedConvergenceOrder?.offDiagonal,
  );
  const refinementRichardsonExtrapolatedResidualT0i = toFiniteNumber(
    evaluatorClosureEvidence?.richardsonExtrapolatedResidual?.t0i,
  );
  const refinementRichardsonExtrapolatedResidualOffDiagonal = toFiniteNumber(
    evaluatorClosureEvidence?.richardsonExtrapolatedResidual?.offDiagonal,
  );
  const refinementRichardsonRelativeBoundCandidates = [
    refinementRichardsonExtrapolatedResidualT0i,
    refinementRichardsonExtrapolatedResidualOffDiagonal,
  ].filter((entry): entry is number => entry != null && Number.isFinite(entry));
  const refinementRichardsonRelativeBound =
    refinementRichardsonRelativeBoundCandidates.length > 0
      ? Math.max(...refinementRichardsonRelativeBoundCandidates)
      : null;
  const refinementUncertaintyRelativeBound = Math.max(
    runtimeUncertaintyRelativeBound,
    refinementRichardsonRelativeBound ?? 0,
    NHM2_DEC_PHYSICS_RUNTIME_UNCERTAINTY_RELATIVE_MARGIN_FLOOR,
  );
  const refinementUncertaintyAbsMetricDec =
    runtimeMetricDecRobustMarginToZero != null
      ? Math.abs(runtimeMetricDecRobustMarginToZero) *
        refinementUncertaintyRelativeBound
      : null;
  const refinementUncertaintyAbsTileReconstitutedDec =
    runtimeTileDecRobustMarginToZero != null
      ? Math.abs(runtimeTileDecRobustMarginToZero) *
        refinementUncertaintyRelativeBound
      : null;
  const refinementConservativeMetricDecMarginToZero =
    runtimeMetricDecRobustMarginToZero != null &&
    refinementUncertaintyAbsMetricDec != null
      ? runtimeMetricDecRobustMarginToZero - refinementUncertaintyAbsMetricDec
      : null;
  const refinementConservativeTileReconstitutedDecMarginToZero =
    runtimeTileDecRobustMarginToZero != null &&
    refinementUncertaintyAbsTileReconstitutedDec != null
      ? runtimeTileDecRobustMarginToZero -
        refinementUncertaintyAbsTileReconstitutedDec
      : null;
  const refinementRichardsonExtrapolatedMetricDecMarginToZero =
    runtimeMetricDecRobustMarginToZero != null &&
    refinementRichardsonRelativeBound != null
      ? runtimeMetricDecRobustMarginToZero -
        Math.abs(runtimeMetricDecRobustMarginToZero) *
          refinementRichardsonRelativeBound
      : null;
  const refinementRichardsonExtrapolatedTileReconstitutedDecMarginToZero =
    runtimeTileDecRobustMarginToZero != null &&
    refinementRichardsonRelativeBound != null
      ? runtimeTileDecRobustMarginToZero -
        Math.abs(runtimeTileDecRobustMarginToZero) *
          refinementRichardsonRelativeBound
      : null;
  const refinementUncertaintyBoundPass =
    refinementConservativeMetricDecMarginToZero != null &&
    refinementConservativeTileReconstitutedDecMarginToZero != null
      ? refinementConservativeMetricDecMarginToZero > 0 &&
        refinementConservativeTileReconstitutedDecMarginToZero > 0 &&
        runtimeReferenceCrossesZeroBothDecMargins
      : null;
  const refinementHasResolutionEvidence =
    refinementCoarseStepM != null &&
    refinementRefinedStepM != null &&
    (refinementObservedConvergenceOrderT0i != null ||
      refinementObservedConvergenceOrderOffDiagonal != null ||
      refinementRichardsonRelativeBound != null);
  const refinementEvidenceStatus:
    NonNullable<Nhm2ObserverDecPhysicsControlEvidence["refinementEvidence"]>["status"] =
    runtimeEvaluationComparable
      ? refinementHasResolutionEvidence
        ? "available"
        : "missing"
      : "non_comparable";
  const refinementEvidenceCitationRefs = Array.from(
    new Set([
      ...NHM2_DEC_PHYSICS_UNCERTAINTY_WEB_CITATION_REFS,
      ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
    ]),
  );
  const refinementEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["refinementEvidence"]
  > = {
    status: refinementEvidenceStatus,
    referenceRouteId: runtimeReferenceRouteId,
    routeComparable: runtimeEvaluationComparable,
    comparableSampleCount: runtimeComparableSampleCount,
    minimumComparableSampleCount: runtimeMinimumComparableSampleCount,
    coarseStepM: refinementCoarseStepM,
    refinedStepM: refinementRefinedStepM,
    superRefinedStepM: refinementSuperRefinedStepM,
    observedConvergenceOrderT0i: refinementObservedConvergenceOrderT0i,
    observedConvergenceOrderOffDiagonal:
      refinementObservedConvergenceOrderOffDiagonal,
    richardsonExtrapolatedResidualT0i:
      refinementRichardsonExtrapolatedResidualT0i,
    richardsonExtrapolatedResidualOffDiagonal:
      refinementRichardsonExtrapolatedResidualOffDiagonal,
    richardsonExtrapolatedMetricDecMarginToZero:
      refinementRichardsonExtrapolatedMetricDecMarginToZero,
    richardsonExtrapolatedTileReconstitutedDecMarginToZero:
      refinementRichardsonExtrapolatedTileReconstitutedDecMarginToZero,
    uncertaintyRelativeBound: refinementUncertaintyRelativeBound,
    uncertaintyAbsMetricDec: refinementUncertaintyAbsMetricDec,
    uncertaintyAbsTileReconstitutedDec: refinementUncertaintyAbsTileReconstitutedDec,
    conservativeMetricDecMarginToZero: refinementConservativeMetricDecMarginToZero,
    conservativeTileReconstitutedDecMarginToZero:
      refinementConservativeTileReconstitutedDecMarginToZero,
    uncertaintyBoundPass: refinementUncertaintyBoundPass,
    note:
      refinementEvidenceStatus === "available"
        ? "Refinement-aware uncertainty evidence is comparable and admitted for conservative DEC sign interpretation."
        : refinementEvidenceStatus === "missing"
          ? "Comparable route evidence exists, but refinement/convergence artifacts are incomplete for full uncertainty localization."
          : "Refinement evidence remains non-comparable because runtime route parity/sample gates are not pass-level.",
    citationRefs: refinementEvidenceCitationRefs,
  };
  const runtimeMetricWecNonRegression =
    runtimeSweepCandidate.guardChecks.metricWecNonRegression;
  const runtimeMetricNecNonRegression =
    runtimeSweepCandidate.guardChecks.metricNecNonRegression;
  const runtimeMetricDecRobustLiftPositive =
    (runtimeMetricDecRobustLift ?? Number.NEGATIVE_INFINITY) > 0;
  const runtimeTileDecRobustLiftNonNegative =
    (runtimeTileReconstitutedDecRobustLift ?? Number.NEGATIVE_INFINITY) >= 0;
  const runtimeCrossesZeroBothDecMargins =
    runtimeSweepCandidate.crossesZeroBothDecMargins === true;
  const isExpandedBoundsCandidate = (
    candidate:
      | Pick<
          DecSweepCandidate,
          "pressureScale" | "densityLiftFraction" | "fluxScale" | "shearScale"
        >
      | null,
  ): boolean => {
    if (candidate == null) return false;
    const pressureScale = candidate.pressureScale;
    const densityLiftFraction = candidate.densityLiftFraction;
    const fluxScale = candidate.fluxScale;
    const shearScale = candidate.shearScale;
    return (
      (pressureScale != null &&
        pressureScale < sameChartTensorPrimaryBoundedEnvelope.pressureScaleMin) ||
      (densityLiftFraction != null &&
        densityLiftFraction > sameChartTensorPrimaryBoundedEnvelope.densityLiftMax) ||
      (fluxScale != null &&
        fluxScale < sameChartTensorPrimaryBoundedEnvelope.fluxScaleMin) ||
      (shearScale != null &&
        shearScale < sameChartTensorPrimaryBoundedEnvelope.shearScaleMin)
    );
  };
  const runtimeCandidateUsesExpandedBounds =
    runtimeApplicationAttempted && isExpandedBoundsCandidate(runtimeSweepCandidate);
  const nonRegressionGateRequired = [
    "metricWecNonRegression",
    "metricNecNonRegression",
    "emissionAdmissionStable",
    "semanticAdmissionStable",
    "candidateNotObserverDomainTruncation",
    "metricDecRobustLiftPositive",
    "tileReconstitutedDecRobustLiftNonNegative",
    "comparabilityGatePass",
    "comparableSampleCountThreshold",
  ];
  const nonRegressionGatePass =
    selectionDecision === "apply_candidate" &&
    metricWecNonRegression === true &&
    metricNecNonRegression === true &&
    emissionAdmissionStable &&
    semanticAdmissionStable &&
    selectedSweepCandidate.candidateClass !== "observer_domain_truncation" &&
    (metricDecRobustLift ?? Number.NEGATIVE_INFINITY) > 0 &&
    (tileReconstitutedDecRobustLift ?? Number.NEGATIVE_INFINITY) >= 0 &&
    runtimeEvaluationComparable;
  const nonRegressionGateNote = nonRegressionGatePass
    ? "Selected candidate satisfies DEC-lift, non-regression, and comparability gates on the admitted route."
    : "No candidate satisfied the full DEC-lift, non-regression, and comparability gate set within the bounded sweep.";
  const runtimeApplicationGatePass =
    runtimeApplicationAttempted &&
    runtimeMetricWecNonRegression === true &&
    runtimeMetricNecNonRegression === true &&
    emissionAdmissionStable &&
    semanticAdmissionStable &&
    runtimeSweepCandidate.candidateClass !== "observer_domain_truncation" &&
    runtimeMetricDecRobustLiftPositive &&
    runtimeTileDecRobustLiftNonNegative &&
    runtimeCrossesZeroBothDecMargins &&
    runtimeEvaluationComparable &&
    runtimeIndependentCrossCheckSignAgreement &&
    runtimeUncertaintyBoundPass;
  const runtimeApplicationApplied =
    runtimeApplicationAttempted &&
    runtimeApplicationEnabled &&
    runtimeApplicationGatePass;
  const runtimeDecLiftBlocked =
    !runtimeMetricDecRobustLiftPositive ||
    !runtimeTileDecRobustLiftNonNegative ||
    !runtimeCrossesZeroBothDecMargins;
  const runtimeExpandedBoundsExhausted =
    runtimeCandidateUsesExpandedBounds &&
    (runtimeDecLiftBlocked || !runtimeUncertaintyBoundPass);
  const runtimeFailureMode:
    | "none"
    | "not_attempted"
    | "runtime_apply_disabled"
    | "regression_wec"
    | "regression_nec"
    | "insufficient_dec_lift"
    | "uncertainty_bound_failed"
    | "cross_check_sign_mismatch"
    | "non_comparable"
    | "unknown" =
    !runtimeApplicationAttempted
      ? "not_attempted"
      : runtimeApplicationApplied
        ? "none"
        : !runtimeApplicationEnabled
          ? "runtime_apply_disabled"
          : !runtimeEvaluationComparable
            ? "non_comparable"
          : !runtimeIndependentCrossCheckSignAgreement
            ? "cross_check_sign_mismatch"
          : runtimeMetricWecNonRegression !== true
            ? "regression_wec"
          : runtimeMetricNecNonRegression !== true
            ? "regression_nec"
          : !runtimeUncertaintyBoundPass
            ? "uncertainty_bound_failed"
          : runtimeDecLiftBlocked
            ? "insufficient_dec_lift"
            : "unknown";
  const runtimeRollbackReasonCodes: Nhm2ObserverDecPhysicsControlEvidence["selectionReasonCodes"] =
    runtimeApplicationAttempted && !runtimeApplicationApplied
      ? Array.from(
          new Set([
            ...(runtimeApplicationEnabled ? [] : ["runtime_apply_disabled"]),
            ...(runtimeMetricWecNonRegression === true
              ? []
              : ["candidate_violates_wec_non_regression"]),
            ...(runtimeMetricNecNonRegression === true
              ? []
              : ["candidate_violates_nec_non_regression"]),
            ...(emissionAdmissionStable
              ? []
              : ["candidate_breaks_emission_admission_stability"]),
            ...(semanticAdmissionStable
              ? []
              : ["candidate_breaks_semantic_admission_stability"]),
            ...(runtimeEvaluationComparable
              ? []
              : ["candidate_evidence_non_comparable"]),
            ...(runtimeIndependentCrossCheckSignAgreement
              ? []
              : ["cross_check_sign_mismatch"]),
            ...(runtimeSweepCandidate.candidateClass ===
            "observer_domain_truncation"
              ? ["candidate_is_observer_domain_truncation"]
              : []),
            ...(runtimeMetricDecRobustLiftPositive
              ? []
              : ["no_candidate_improves_dec"]),
            ...(runtimeTileDecRobustLiftNonNegative
              ? []
              : ["no_candidate_improves_dec"]),
            ...(runtimeCrossesZeroBothDecMargins
              ? []
              : ["best_margin_still_negative"]),
            ...(runtimeUncertaintyBoundPass
              ? []
              : ["uncertainty_bound_failed"]),
            ...(runtimeExpandedBoundsExhausted
              ? ["insufficient_dec_lift_after_tranche_4"]
              : []),
          ]),
        )
      : [];
  const runtimeApplicationStatus: "not_attempted" | "applied" | "rolled_back" =
    !runtimeApplicationAttempted
      ? "not_attempted"
      : runtimeApplicationApplied
        ? "applied"
        : "rolled_back";
  const runtimeComparabilityNote = runtimeEvaluationComparable
    ? runtimeIndependentCrossCheckSignAgreement
      ? `Comparable evidence passes route/chart parity with ${runtimeComparableSampleCount ?? "null"} comparable samples (threshold ${runtimeMinimumComparableSampleCount}) and preserves DEC-margin sign agreement against the independent route.`
      : `Comparable sample evidence is present (${runtimeComparableSampleCount ?? "null"} samples), but DEC-margin sign agreement fails against the independent route.`
    : !runtimeRouteComparable
      ? "Comparable evidence failed route/chart/independent-cross-check parity on the selected Einstein route."
      : `Comparable evidence sample count (${runtimeComparableSampleCount ?? "null"}) is below threshold (${runtimeMinimumComparableSampleCount}).`;
  const runtimeApplicationNote =
    runtimeApplicationStatus === "applied"
      ? "Selected DEC-control candidate is runtime-applied under strict non-regression gates."
      : runtimeApplicationStatus === "rolled_back"
        ? runtimeApplicationEnabled
          ? runtimeFailureMode === "non_comparable"
            ? "Runtime DEC-control candidate was attempted but rolled back because baseline/candidate evidence is non-comparable on the selected Einstein route."
            : runtimeFailureMode === "cross_check_sign_mismatch"
              ? "Runtime DEC-control candidate was attempted but rolled back because DEC-margin sign agreement fails against the independent Einstein-route cross-check."
            : runtimeFailureMode === "uncertainty_bound_failed"
              ? "Runtime DEC-control candidate was attempted but rolled back because uncertainty-bounded DEC margins do not remain positive on both selected and reference routes."
            : !runtimeCrossesZeroBothDecMargins || !runtimeUncertaintyBoundPass
              ? "Runtime DEC-control candidate was attempted but rolled back because DEC robust margins remain below zero after uncertainty-bounded independent-route checks."
            : runtimeExpandedBoundsExhausted
              ? "Runtime DEC-control candidate was attempted through tranche-4 expanded bounds, but the DEC lift remained insufficient for runtime apply."
            : "Runtime DEC-control candidate was attempted but rolled back because one or more non-regression gates failed."
          : `Runtime DEC-control candidate remains staged-only because ${NHM2_DEC_PHYSICS_RUNTIME_APPLY_ENV} is disabled; evidence remains comparable but non-applied.`
        : "No runtime DEC-control application was attempted because no candidate cleared the selection gate.";
  const runtimeMetricWecNonRegressionMargin = runtimeMetricWecRobustDelta;
  const runtimeMetricNecNonRegressionMargin = runtimeMetricNecRobustDelta;
  const runtimeFailureModeFallbackReasonCodes:
    Nhm2ObserverDecPhysicsControlEvidence["selectionReasonCodes"] =
    runtimeFailureMode === "regression_wec"
      ? ["candidate_violates_wec_non_regression"]
      : runtimeFailureMode === "regression_nec"
        ? ["candidate_violates_nec_non_regression"]
      : runtimeFailureMode === "insufficient_dec_lift"
        ? ["best_margin_still_negative"]
      : runtimeFailureMode === "uncertainty_bound_failed"
        ? ["uncertainty_bound_failed"]
      : runtimeFailureMode === "cross_check_sign_mismatch"
        ? ["cross_check_sign_mismatch"]
      : runtimeFailureMode === "non_comparable"
        ? ["candidate_evidence_non_comparable"]
      : runtimeFailureMode === "runtime_apply_disabled"
        ? ["runtime_apply_disabled"]
      : runtimeFailureMode === "none"
        ? ["selection_gate_pass"]
      : ["candidate_not_evaluated"];
  const runtimeDecisionReasonCodes: Nhm2ObserverDecPhysicsControlEvidence["selectionReasonCodes"] =
    runtimeApplicationStatus === "applied"
      ? ["selection_gate_pass"]
      : runtimeApplicationStatus === "rolled_back"
        ? runtimeRollbackReasonCodes.length > 0
          ? runtimeRollbackReasonCodes
          : runtimeFailureModeFallbackReasonCodes
        : ["candidate_not_evaluated"];
  const decRuntimeCitationRefs = Array.from(
    new Set([
      ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
      ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
      ...NHM2_DEC_PHYSICS_UNCERTAINTY_WEB_CITATION_REFS,
      ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
    ]),
  );
  const runtimeDecisionFamilyId:
    | "pressure_only"
    | "density_pressure_coupled"
    | "flux_shear_coupled"
    | "density_flux_shear_coupled"
    | null =
    runtimeApplicationAttempted &&
    runtimeSweepCandidate.candidateClass === "physics_control_proposal"
      ? (() => {
          const densityLift = runtimeSweepCandidate.densityLiftFraction ?? 0;
          const fluxScale =
            runtimeSweepCandidate.fluxScale ?? sameChartTensorFluxScaleBaseline;
          const shearScale =
            runtimeSweepCandidate.shearScale ?? sameChartTensorShearScaleBaseline;
          const usesDensity = densityLift > 0;
          const usesFluxOrShear =
            fluxScale < sameChartTensorFluxScaleBaseline ||
            shearScale < sameChartTensorShearScaleBaseline;
          if (!usesDensity && !usesFluxOrShear) {
            return "pressure_only";
          }
          if (usesDensity && !usesFluxOrShear) {
            return "density_pressure_coupled";
          }
          if (!usesDensity && usesFluxOrShear) {
            return "flux_shear_coupled";
          }
          return "density_flux_shear_coupled";
        })()
      : null;
  const runtimeDecisionTrancheId: Nhm2ObserverDecExtensionTrancheId | null =
    runtimeDecisionFamilyId == null
      ? null
      : runtimeCandidateUsesExpandedBounds
        ? "tranche_4_expanded_bounds"
      : runtimeDecisionFamilyId === "density_flux_shear_coupled"
        ? "tranche_3_fully_coupled"
      : runtimeDecisionFamilyId === "flux_shear_coupled"
        ? "tranche_2_extended"
        : "tranche_1_primary";
  const runtimeNonRegressionPass =
    runtimeMetricWecNonRegression === true &&
    runtimeMetricNecNonRegression === true &&
    emissionAdmissionStable &&
    semanticAdmissionStable;
  const decRuntimeDecisionEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["decRuntimeDecisionEvidence"]
  > = {
    status: runtimeApplicationStatus,
    attempted: runtimeApplicationAttempted,
    enabled: runtimeApplicationEnabled,
    gatePass: runtimeApplicationGatePass,
    comparabilityPass: runtimeEvaluationComparable,
    sampleCountSufficient: runtimeSampleCountSufficient,
    selectedCandidateId:
      runtimeApplicationAttempted ? runtimeSweepCandidate.candidateId : null,
    reasonCodes: runtimeDecisionReasonCodes,
    primaryReasonCode: runtimeDecisionReasonCodes[0] ?? null,
    decAttribution: {
      selectedMetricDecRobustMarginToZero: runtimeMetricDecRobustMarginToZero,
      selectedTileReconstitutedDecRobustMarginToZero:
        runtimeTileDecRobustMarginToZero,
      selectedMetricDecConservativeMarginToZero:
        runtimeMetricDecConservativeMarginToZero,
      selectedTileReconstitutedDecConservativeMarginToZero:
        runtimeTileDecConservativeMarginToZero,
      referenceMetricDecRobustMarginToZero:
        runtimeReferenceMetricDecRobustMarginToZero,
      referenceTileReconstitutedDecRobustMarginToZero:
        runtimeReferenceTileDecRobustMarginToZero,
      referenceMetricDecConservativeMarginToZero:
        runtimeReferenceMetricDecConservativeMarginToZero,
      referenceTileReconstitutedDecConservativeMarginToZero:
        runtimeReferenceTileDecConservativeMarginToZero,
      independentCrossCheckRelativeResidual:
        runtimeIndependentCrossCheckRelativeResidual,
      uncertaintyRelativeBound: runtimeUncertaintyRelativeBound,
      independentCrossCheckSignAgreement:
        runtimeIndependentCrossCheckSignAgreement,
      selectedCrossesZeroUnderUncertainty:
        runtimeSelectedCrossesZeroUnderUncertainty,
      referenceCrossesZeroBothDecMargins:
        runtimeReferenceCrossesZeroBothDecMargins,
      uncertaintyBoundPass: runtimeUncertaintyBoundPass,
    },
    note: runtimeApplicationNote,
    citationRefs: decRuntimeCitationRefs,
  };
  const appliedCandidateEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["appliedCandidateEvidence"]
  > = {
    status: runtimeApplicationStatus === "applied" ? "available" : "unavailable",
    candidateId:
      runtimeApplicationStatus === "applied"
        ? runtimeSweepCandidate.candidateId
        : null,
    extensionTrancheId:
      runtimeApplicationStatus === "applied" ? runtimeDecisionTrancheId : null,
    familyId: runtimeApplicationStatus === "applied" ? runtimeDecisionFamilyId : null,
    metricDecRobustMarginToZero:
      runtimeApplicationStatus === "applied"
        ? runtimeMetricDecRobustMarginToZero
        : null,
    tileReconstitutedDecRobustMarginToZero:
      runtimeApplicationStatus === "applied"
        ? runtimeTileDecRobustMarginToZero
        : null,
    metricWecNonRegressionMargin:
      runtimeApplicationStatus === "applied"
        ? runtimeMetricWecNonRegressionMargin
        : null,
    metricNecNonRegressionMargin:
      runtimeApplicationStatus === "applied"
        ? runtimeMetricNecNonRegressionMargin
        : null,
    nonRegressionPass:
      runtimeApplicationStatus === "applied" ? runtimeNonRegressionPass : null,
    comparabilityPass:
      runtimeApplicationStatus === "applied" ? runtimeEvaluationComparable : null,
    note:
      runtimeApplicationStatus === "applied"
        ? `Applied candidate ${runtimeSweepCandidate.candidateId} remains within non-regression and comparability gates on ${runtimeDecisionFamilyId ?? "unknown_family"}.`
        : "No runtime-applied candidate is available in this run.",
    citationRefs: decRuntimeCitationRefs,
  };
  const rollbackLocalizationReasonCodes =
    runtimeApplicationStatus === "applied" ? [] : runtimeDecisionReasonCodes;
  const rollbackLocalizationEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["rollbackLocalizationEvidence"]
  > = {
    status: runtimeApplicationStatus === "applied" ? "unavailable" : "available",
    candidateId: runtimeApplicationAttempted ? runtimeSweepCandidate.candidateId : null,
    extensionTrancheId:
      runtimeApplicationAttempted ? runtimeDecisionTrancheId : null,
    familyId: runtimeApplicationAttempted ? runtimeDecisionFamilyId : null,
    failureMode: runtimeFailureMode,
    primaryReasonCode: rollbackLocalizationReasonCodes[0] ?? null,
    reasonCodes: rollbackLocalizationReasonCodes,
    metricDecRobustMarginToZero:
      runtimeApplicationAttempted ? runtimeMetricDecRobustMarginToZero : null,
    tileReconstitutedDecRobustMarginToZero:
      runtimeApplicationAttempted ? runtimeTileDecRobustMarginToZero : null,
    metricWecNonRegressionMargin:
      runtimeApplicationAttempted ? runtimeMetricWecNonRegressionMargin : null,
    metricNecNonRegressionMargin:
      runtimeApplicationAttempted ? runtimeMetricNecNonRegressionMargin : null,
    comparabilityPass:
      runtimeApplicationAttempted ? runtimeEvaluationComparable : null,
    sampleCountSufficient:
      runtimeApplicationAttempted ? runtimeSampleCountSufficient : null,
    note:
      runtimeApplicationStatus === "applied"
        ? "Runtime rollback localization is unavailable because the candidate remained applied."
        : runtimeApplicationStatus === "not_attempted"
          ? "No runtime candidate was attempted, so rollback localization reports pre-apply blockers only."
          : `Runtime candidate ${runtimeSweepCandidate.candidateId} was rolled back with failureMode=${runtimeFailureMode}.`,
    citationRefs: decRuntimeCitationRefs,
  };
  const uncertaintyTags: Nhm2ObserverDecPhysicsControlEvidence["uncertaintyTags"] = [
    "inference",
    ...(runtimeEvaluationComparable ? (["direct_measurement"] as const) : []),
    ...(selectionPlateauStatus === "cross_zero_candidate_found"
      ? []
      : (["open_assumption"] as const)),
  ];
  const baselineSweepCandidate =
    sweepCandidates.find(
      (candidate) =>
        candidate.candidateId === "baseline_hold_no_applied_control_patch_v1",
    ) ?? null;
  const baselinePrimaryMargin =
    baselineSweepCandidate?.selectionObjectivePrimaryMargin ?? null;
  const bestCandidatePrimaryMargin =
    selectedSweepCandidate.selectionObjectivePrimaryMargin ?? null;
  const preFrontierBestPrimaryMargin =
    preFrontierSelectedSweepCandidate?.selectionObjectivePrimaryMargin ?? null;
  const frontierBestPrimaryMargin =
    frontierBestCandidate?.selectionObjectivePrimaryMargin ?? null;
  const requiredLiftToZero =
    baselinePrimaryMargin != null ? Math.max(0, -baselinePrimaryMargin) : null;
  const achievedLiftFromBaseline =
    baselinePrimaryMargin != null && bestCandidatePrimaryMargin != null
      ? bestCandidatePrimaryMargin - baselinePrimaryMargin
      : null;
  const frontierBestDeltaFromPreFrontier =
    preFrontierBestPrimaryMargin != null && bestCandidatePrimaryMargin != null
      ? bestCandidatePrimaryMargin - preFrontierBestPrimaryMargin
      : null;
  const frontierBestDeltaFromBaseline =
    baselinePrimaryMargin != null && bestCandidatePrimaryMargin != null
      ? bestCandidatePrimaryMargin - baselinePrimaryMargin
      : null;
  const frontierBestDeltaPercentFromBaseline =
    requiredLiftToZero != null &&
    requiredLiftToZero > 0 &&
    frontierBestDeltaFromBaseline != null
      ? (frontierBestDeltaFromBaseline / requiredLiftToZero) * 100
      : null;
  const bestAchievedLift = achievedLiftFromBaseline;
  const residualMarginToZero = bestCandidatePrimaryMargin;
  const gapToZero =
    residualMarginToZero != null ? Math.max(0, -residualMarginToZero) : null;
  const crossZeroAchieved = selectedSweepCandidate.crossesZeroBothDecMargins;
  const boundedEnvelopeExhausted =
    crossZeroAchieved === true
      ? false
      : gapToZero != null
        ? gapToZero > 0
        : null;
  const zeroCrossFeasibilityDecision: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["zeroCrossFeasibilityDecision"]
  > =
    crossZeroAchieved === true
      ? "zero_cross_achieved"
      : selectionPlateauStatus === "best_margin_still_negative" ||
          (bestCandidatePrimaryMargin != null && bestCandidatePrimaryMargin < 0)
        ? "zero_cross_not_achievable_within_bounds"
        : "unknown";
  const zeroCrossFeasibilityReasonCodesSet = new Set<
    NonNullable<
      Nhm2ObserverDecPhysicsControlEvidence["zeroCrossFeasibilityReasonCodes"]
    >[number]
  >();
  if (crossZeroAchieved === true) {
    zeroCrossFeasibilityReasonCodesSet.add("cross_zero_margin_non_negative");
  }
  if (
    selectionPlateauStatus === "best_margin_still_negative" ||
    (bestCandidatePrimaryMargin != null && bestCandidatePrimaryMargin < 0)
  ) {
    zeroCrossFeasibilityReasonCodesSet.add("best_margin_still_negative");
  }
  if (selectionDecision !== "apply_candidate") {
    zeroCrossFeasibilityReasonCodesSet.add("selection_gate_failed");
  }
  if (!runtimeEvaluationComparable) {
    zeroCrossFeasibilityReasonCodesSet.add("candidate_evidence_non_comparable");
  }
  if (runtimeMetricWecNonRegression !== true) {
    zeroCrossFeasibilityReasonCodesSet.add("candidate_violates_wec_non_regression");
  }
  if (runtimeMetricNecNonRegression !== true) {
    zeroCrossFeasibilityReasonCodesSet.add("candidate_violates_nec_non_regression");
  }
  if (!runtimeApplicationAttempted) {
    zeroCrossFeasibilityReasonCodesSet.add("candidate_not_evaluated");
  }
  if (zeroCrossFeasibilityReasonCodesSet.size === 0) {
    zeroCrossFeasibilityReasonCodesSet.add("unknown");
  }
  const zeroCrossFeasibilityReasonCodes = Array.from(
    zeroCrossFeasibilityReasonCodesSet,
  );
  const crossZeroInferenceLabel: Nhm2ObserverDecPhysicsControlEvidence["crossZeroFeasibilityEvidence"]["inferenceLabel"] =
    runtimeEvaluationComparable && crossZeroAchieved === true
      ? "direct_measurement"
      : runtimeEvaluationComparable
        ? "mixed"
        : "inference";
  const crossZeroFeasibilityEvidence: Nhm2ObserverDecPhysicsControlEvidence["crossZeroFeasibilityEvidence"] =
    {
      baselinePrimaryMargin,
      bestCandidatePrimaryMargin,
      requiredLiftToZero,
      achievedLiftFromBaseline,
      bestAchievedLift,
      residualMarginToZero,
      gapToZero,
      crossZeroAchieved,
      boundedEnvelopeExhausted,
      boundedControlEnvelope: {
        pressureScaleMin: activeBoundedEnvelope.pressureScaleMin,
        pressureScaleMax: activeBoundedEnvelope.pressureScaleMax,
        densityLiftMin: activeBoundedEnvelope.densityLiftMin,
        densityLiftMax: activeBoundedEnvelope.densityLiftMax,
        fluxScaleMin: activeBoundedEnvelope.fluxScaleMin,
        fluxScaleMax: activeBoundedEnvelope.fluxScaleMax,
        shearScaleMin: activeBoundedEnvelope.shearScaleMin,
        shearScaleMax: activeBoundedEnvelope.shearScaleMax,
      },
      evaluationRoute: {
        chartRef: args.modelTermSemanticEvidence.chartRef,
        routeId,
        selectedPath,
        independentCrossCheckStatus: runtimeIndependentCrossCheckStatus,
        runtimeComparabilityPass: runtimeEvaluationComparable,
      },
      method: "bounded_sweep_margin_analysis",
      inferenceLabel: crossZeroInferenceLabel,
      citationRefs: Array.from(
        new Set([
          ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
          ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
          ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
        ]),
      ),
      notes: [
        "Cross-zero feasibility is evaluated on the same bounded DEC-control sweep objective used for candidate ranking on the admitted Einstein route.",
        crossZeroAchieved === true
          ? "A selected candidate crosses zero on both metric and tile-reconstituted DEC robust margins within the bounded control envelope."
          : `No selected candidate crosses zero on both DEC robust margins; residual primary margin remains ${residualMarginToZero ?? "null"}.`,
        `Required lift-to-zero from baseline primary margin is ${requiredLiftToZero ?? "null"}; best achieved lift from baseline is ${bestAchievedLift ?? "null"}; remaining gap-to-zero is ${gapToZero ?? "null"}.`,
        `Bounded control envelope exhausted without cross-zero=${boundedEnvelopeExhausted == null ? "null" : String(boundedEnvelopeExhausted)}.`,
      ],
    };
  const selectedMetricResidualMargin =
    selectedSweepCandidate.metricDecRobustMarginToZero;
  const selectedTileResidualMargin =
    selectedSweepCandidate.tileReconstitutedDecRobustMarginToZero;
  const decResidualPrimarySurface: Nhm2ObserverDecResidualAttributionEvidence["primarySurface"] =
    selectedMetricResidualMargin == null && selectedTileResidualMargin == null
      ? "unknown"
      : selectedMetricResidualMargin == null
        ? "tile_reconstituted"
        : selectedTileResidualMargin == null
          ? "metric"
          : selectedMetricResidualMargin < selectedTileResidualMargin
            ? "metric"
            : selectedTileResidualMargin < selectedMetricResidualMargin
              ? "tile_reconstituted"
              : "mixed";
  const decResidualAttributionEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["decResidualAttributionEvidence"]
  > = {
    status:
      selectedMetricResidualMargin == null && selectedTileResidualMargin == null
        ? "unavailable"
        : "available",
    primarySurface: decResidualPrimarySurface,
    dominantViolationClass: args.decRemediationEvidence.dominantViolationClass,
    baselinePrimaryMargin,
    selectedPrimaryMargin: bestCandidatePrimaryMargin,
    requiredLiftToZero,
    achievedLiftFromBaseline,
    residualMarginToZero,
    gapToZero,
    selectionPlateauStatus,
    selectionReasonCodes,
    zeroCrossFeasibilityDecision,
    rankingBasis: selectionObjective,
    selectedCandidate: {
      candidateId: selectedSweepCandidate.candidateId,
      candidateClass: selectedSweepCandidate.candidateClass,
      sweepPhase: selectedSweepCandidate.sweepPhase,
      metricDecRobustMarginToZero: selectedMetricResidualMargin,
      tileReconstitutedDecRobustMarginToZero: selectedTileResidualMargin,
      metricDecRobustLift: selectedSweepCandidate.metricDecRobustLift,
      tileReconstitutedDecRobustLift:
        selectedSweepCandidate.tileReconstitutedDecRobustLift,
      controlDeviationMagnitude: selectedSweepCandidate.controlDeviationMagnitude,
    },
    citationRefs: Array.from(
      new Set([
        ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
        ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
      ]),
    ),
    notes: [
      `selectionPlateauStatus=${selectionPlateauStatus}`,
      `primarySurface=${decResidualPrimarySurface}`,
      `selectedMetricResidualMargin=${selectedMetricResidualMargin ?? "null"}`,
      `selectedTileResidualMargin=${selectedTileResidualMargin ?? "null"}`,
      `selectedPrimaryMargin=${bestCandidatePrimaryMargin ?? "null"}`,
      `requiredLiftToZero=${requiredLiftToZero ?? "null"}`,
      `achievedLiftFromBaseline=${achievedLiftFromBaseline ?? "null"}`,
      `gapToZero=${gapToZero ?? "null"}`,
      `selectionReasonCodes=${selectionReasonCodes.join(",") || "none"}`,
    ],
  };
  const decFrontierImprovementEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["decFrontierImprovementEvidence"]
  > = {
    status: frontierSeedCandidateId != null ? "available" : "unavailable",
    frontierSeedCandidateId,
    frontierSelectedCandidateId: frontierBestCandidate?.candidateId ?? null,
    frontierCandidateCount: frontierSweepCandidatesAll.length,
    frontierPassingCount: frontierPassingCandidates.length,
    baselinePrimaryMargin,
    preFrontierBestPrimaryMargin,
    finalBestPrimaryMargin: bestCandidatePrimaryMargin,
    frontierBestDeltaFromPreFrontier,
    frontierBestDeltaFromBaseline,
    frontierBestDeltaPercentFromBaseline,
    residualGapToZero: gapToZero,
    selectionPlateauStatus,
    citationRefs: Array.from(
      new Set([
        ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
        ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
      ]),
    ),
    notes: [
      `frontierSeedCandidateId=${frontierSeedCandidateId ?? "none"}`,
      `frontierSelectedCandidateId=${frontierBestCandidate?.candidateId ?? "none"}`,
      `frontierCandidateCount=${frontierSweepCandidatesAll.length}`,
      `frontierPassingCount=${frontierPassingCandidates.length}`,
      `tranche4CandidateCount=${tranche4SweepCandidates.length}`,
      `targetedCandidateCount=${tranche5SweepCandidates.length}`,
      `edgeCandidateCount=${tranche6SweepCandidates.length}`,
      `preFrontierBestPrimaryMargin=${preFrontierBestPrimaryMargin ?? "null"}`,
      `frontierBestPrimaryMargin=${frontierBestPrimaryMargin ?? "null"}`,
      `finalBestPrimaryMargin=${bestCandidatePrimaryMargin ?? "null"}`,
      `frontierBestDeltaFromPreFrontier=${frontierBestDeltaFromPreFrontier ?? "null"}`,
      `frontierBestDeltaFromBaseline=${frontierBestDeltaFromBaseline ?? "null"}`,
      `frontierBestDeltaPercentFromBaseline=${frontierBestDeltaPercentFromBaseline ?? "null"}`,
      `residualGapToZero=${gapToZero ?? "null"}`,
      `selectionPlateauStatus=${selectionPlateauStatus}`,
    ],
  };
  const boundedSearchEnvelope: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["boundedSearchEnvelope"]
  > = {
    pressureScaleMin: activeBoundedEnvelope.pressureScaleMin,
    pressureScaleMax: activeBoundedEnvelope.pressureScaleMax,
    densityLiftMin: activeBoundedEnvelope.densityLiftMin,
    densityLiftMax: activeBoundedEnvelope.densityLiftMax,
    fluxScaleMin: activeBoundedEnvelope.fluxScaleMin,
    fluxScaleMax: activeBoundedEnvelope.fluxScaleMax,
    shearScaleMin: activeBoundedEnvelope.shearScaleMin,
    shearScaleMax: activeBoundedEnvelope.shearScaleMax,
    coarsePressureStep: minPositiveStep(pressureScaleSweep),
    coarseDensityLiftStep: minPositiveStep(densityLiftSweep),
    coarseFluxScaleStep: minPositiveStep(fluxScaleSweep),
    coarseShearScaleStep: minPositiveStep(shearScaleSweep),
    refinePressureStep: minPositiveStep(
      refinePressureOffsets.map((offset) => Math.abs(offset)).filter((v) => v > 0),
    ),
    refineDensityLiftStep: minPositiveStep(
      refineDensityOffsets.map((offset) => Math.abs(offset)).filter((v) => v > 0),
    ),
    refineFluxScaleStep: minPositiveStep(
      refineFluxOffsets.map((offset) => Math.abs(offset)).filter((v) => v > 0),
    ),
    refineShearScaleStep: minPositiveStep(
      refineShearOffsets.map((offset) => Math.abs(offset)).filter((v) => v > 0),
    ),
    frontierPressureStep: minPositiveStep(
      frontierPressureOffsets
        .map((offset) => Math.abs(offset))
        .filter((v) => v > 0),
    ),
    frontierDensityLiftStep: minPositiveStep(
      frontierDensityOffsets
        .map((offset) => Math.abs(offset))
        .filter((v) => v > 0),
    ),
    frontierFluxScaleStep: minPositiveStep(
      frontierFluxOffsets.map((offset) => Math.abs(offset)).filter((v) => v > 0),
    ),
    frontierShearScaleStep: minPositiveStep(
      frontierShearOffsets
        .map((offset) => Math.abs(offset))
        .filter((v) => v > 0),
    ),
    coarseCandidateCount: coarseSweepCandidates.length,
    refineCandidateCount: refineSweepCandidates.length,
    frontierCandidateCount: frontierSweepCandidatesAll.length,
    refineSeedCount: refineSeedCandidateIds.length,
    observerDomainFixed: true,
  };
  const candidateApplied = runtimeApplicationApplied;
  const sweepCandidatesWithRuntime = sweepCandidates.map((candidate) =>
    candidate.candidateId === runtimeSweepCandidate.candidateId
      ? { ...candidate, applied: runtimeApplicationApplied }
      : candidate,
  );
  const controlKnobs: Nhm2ObserverDecPhysicsControlEvidence["controlKnobs"] = [
    {
      knobId: "observer_rapidity_cap",
      baselineValue: toFiniteNumber(args.metricTensorInput.rapidityCap),
      candidateValue: selectedSweepCandidate.rapidityCap,
      deltaValue:
        selectedSweepCandidate.rapidityCap != null &&
        toFiniteNumber(args.metricTensorInput.rapidityCap) != null
          ? selectedSweepCandidate.rapidityCap -
            (toFiniteNumber(args.metricTensorInput.rapidityCap) ?? 0)
          : null,
      boundedDeltaMax: 0.25,
      bounded:
        selectedSweepCandidate.rapidityCap != null &&
        toFiniteNumber(args.metricTensorInput.rapidityCap) != null
          ? Math.abs(
              selectedSweepCandidate.rapidityCap -
                (toFiniteNumber(args.metricTensorInput.rapidityCap) ?? 0),
            ) <= 0.25
          : false,
      note:
        "Sweep includes a zeta=0 truncation probe for sensitivity localization; selection gate disallows observer-domain truncation as a physical-control patch.",
    },
    {
      knobId: "observer_rapidity_cap_beta",
      baselineValue: toFiniteNumber(args.metricTensorInput.rapidityCapBeta),
      candidateValue: selectedSweepCandidate.rapidityCapBeta,
      deltaValue:
        selectedSweepCandidate.rapidityCapBeta != null &&
        toFiniteNumber(args.metricTensorInput.rapidityCapBeta) != null
          ? selectedSweepCandidate.rapidityCapBeta -
            (toFiniteNumber(args.metricTensorInput.rapidityCapBeta) ?? 0)
          : null,
      boundedDeltaMax: 0.05,
      bounded:
        selectedSweepCandidate.rapidityCapBeta != null &&
        toFiniteNumber(args.metricTensorInput.rapidityCapBeta) != null
          ? Math.abs(
              selectedSweepCandidate.rapidityCapBeta -
                (toFiniteNumber(args.metricTensorInput.rapidityCapBeta) ?? 0),
            ) <= 0.05
          : false,
      note:
        "Rapidity-beta knob tracks rapidity-cap sweep and remains bounded under the declared audit probe limits.",
    },
    {
      knobId: "same_chart_tensor_physics_control",
      baselineValue: sameChartTensorPhysicsControlBaseline,
      candidateValue:
        selectedSweepCandidate.pressureScale ?? sameChartTensorPhysicsControlProbeScale,
      deltaValue:
        selectedSweepCandidate.pressureScale != null
          ? selectedSweepCandidate.pressureScale -
            sameChartTensorPhysicsControlBaseline
          : null,
      boundedDeltaMax: sameChartTensorPhysicsControlBoundedDeltaMax,
      bounded:
        selectedSweepCandidate.pressureScale != null
          ? Math.abs(
              selectedSweepCandidate.pressureScale -
                sameChartTensorPhysicsControlBaseline,
            ) <= sameChartTensorPhysicsControlBoundedDeltaMax
          : false,
      note:
        `Physical DEC control is evaluated on the admitted Einstein path without observer-domain truncation using a bounded same-chart pressure-scale sweep (s in [${sameChartTensorPhysicsControlMin}, ${sameChartTensorPhysicsControlBaseline}]); this candidate remains non-admissible until it passes WEC/NEC non-regression gates.`,
    },
    {
      knobId: "same_chart_tensor_density_lift",
      baselineValue: sameChartTensorDensityLiftBaseline,
      candidateValue:
        selectedSweepCandidate.densityLiftFraction ??
        sameChartTensorDensityLiftProbeFraction,
      deltaValue:
        selectedSweepCandidate.densityLiftFraction != null
          ? selectedSweepCandidate.densityLiftFraction -
            sameChartTensorDensityLiftBaseline
          : null,
      boundedDeltaMax: sameChartTensorDensityLiftBoundedDeltaMax,
      bounded:
        selectedSweepCandidate.densityLiftFraction != null
          ? Math.abs(
              selectedSweepCandidate.densityLiftFraction -
                sameChartTensorDensityLiftBaseline,
            ) <= sameChartTensorDensityLiftBoundedDeltaMax
          : false,
      note:
        `Coupled same-chart DEC-control probe includes a bounded density-lift term (rho_lift in [${sameChartTensorDensityLiftBaseline}, ${sameChartTensorDensityLiftMax}]) to test whether DEC can be lifted without NEC/WEC regression while keeping observer-domain bounds fixed.`,
    },
    {
      knobId: "same_chart_tensor_flux_scale",
      baselineValue: sameChartTensorFluxScaleBaseline,
      candidateValue:
        selectedSweepCandidate.fluxScale ?? sameChartTensorFluxScaleProbe,
      deltaValue:
        selectedSweepCandidate.fluxScale != null
          ? selectedSweepCandidate.fluxScale - sameChartTensorFluxScaleBaseline
          : null,
      boundedDeltaMax: sameChartTensorFluxScaleBoundedDeltaMax,
      bounded:
        selectedSweepCandidate.fluxScale != null
          ? Math.abs(
              selectedSweepCandidate.fluxScale - sameChartTensorFluxScaleBaseline,
            ) <= sameChartTensorFluxScaleBoundedDeltaMax
          : false,
      note:
        `Coupled same-chart DEC-control probe includes bounded Ji-channel attenuation (flux_scale in [${sameChartTensorFluxScaleMin}, ${sameChartTensorFluxScaleBaseline}]) to test DEC lift while preserving comparability and non-regression gates.`,
    },
    {
      knobId: "same_chart_tensor_shear_scale",
      baselineValue: sameChartTensorShearScaleBaseline,
      candidateValue:
        selectedSweepCandidate.shearScale ?? sameChartTensorShearScaleProbe,
      deltaValue:
        selectedSweepCandidate.shearScale != null
          ? selectedSweepCandidate.shearScale - sameChartTensorShearScaleBaseline
          : null,
      boundedDeltaMax: sameChartTensorShearScaleBoundedDeltaMax,
      bounded:
        selectedSweepCandidate.shearScale != null
          ? Math.abs(
              selectedSweepCandidate.shearScale -
                sameChartTensorShearScaleBaseline,
            ) <= sameChartTensorShearScaleBoundedDeltaMax
          : false,
      note:
        `Coupled same-chart DEC-control probe includes bounded off-diagonal Sij attenuation (shear_scale in [${sameChartTensorShearScaleMin}, ${sameChartTensorShearScaleBaseline}]) to localize DEC sensitivity on the admitted Einstein route.`,
    },
  ];
  const boundedEnvelopeExhaustedForRecommendation =
    selectedSweepCandidate.crossesZeroBothDecMargins === true
      ? false
      : (selectedSweepCandidate.selectionObjectivePrimaryMargin ??
            Number.NEGATIVE_INFINITY) < 0;
  const recommendation =
    args.decRemediationEvidence.recommendedPatchClass ===
    "no_admissible_candidate_yet"
      ? "no_admissible_candidate_yet"
      : !semanticAdmissionStable || !emissionAdmissionStable
        ? "model_term_extension_patch"
        : selectionDecision !== "apply_candidate"
          ? "no_admissible_candidate_yet"
        : boundedEnvelopeExhaustedForRecommendation &&
              selectedSweepCandidate.crossesZeroBothDecMargins !== true &&
              nonRegressionGatePass &&
              runtimeEvaluationComparable
          ? "model_term_extension_patch"
          : "physics_control_patch";
  if (
    recommendation === "model_term_extension_patch" &&
    !selectionReasonCodes.includes("model_term_extension_required")
  ) {
    selectionReasonCodes.push("model_term_extension_required");
  }
  if (
    recommendation === "model_term_extension_patch" &&
    !zeroCrossFeasibilityReasonCodes.includes("model_term_extension_required")
  ) {
    zeroCrossFeasibilityReasonCodes.push("model_term_extension_required");
  }
  if (
    recommendation === "model_term_extension_patch" &&
    runtimeExpandedBoundsExhausted &&
    !zeroCrossFeasibilityReasonCodes.includes(
      "insufficient_dec_lift_after_tranche_4",
    )
  ) {
    zeroCrossFeasibilityReasonCodes.push("insufficient_dec_lift_after_tranche_4");
  }
  if (
    recommendation === "model_term_extension_patch" &&
    !runtimeUncertaintyBoundPass &&
    !zeroCrossFeasibilityReasonCodes.includes("uncertainty_bound_failed")
  ) {
    zeroCrossFeasibilityReasonCodes.push("uncertainty_bound_failed");
  }
  if (
    recommendation === "model_term_extension_patch" &&
    !runtimeIndependentCrossCheckSignAgreement &&
    !zeroCrossFeasibilityReasonCodes.includes("cross_check_sign_mismatch")
  ) {
    zeroCrossFeasibilityReasonCodes.push("cross_check_sign_mismatch");
  }
  if (
    recommendation === "model_term_extension_patch" &&
    runtimeApplicationStatus !== "applied" &&
    !runtimeRollbackReasonCodes.includes("model_term_extension_required")
  ) {
    runtimeRollbackReasonCodes.push("model_term_extension_required");
  }
  const modelTermExtensionFamilyIds = [
    "pressure_only",
    "density_pressure_coupled",
    "flux_shear_coupled",
    "density_flux_shear_coupled",
  ] as const;
  type ModelTermExtensionFamilyId = (typeof modelTermExtensionFamilyIds)[number];
  const modelTermExtensionFamilyLabels: Record<ModelTermExtensionFamilyId, string> =
    {
      pressure_only: "Pressure-only same-chart control family",
      density_pressure_coupled: "Density+pressure same-chart control family",
      flux_shear_coupled: "Flux/shear-coupled same-chart control family",
      density_flux_shear_coupled:
        "Density+flux/shear fully-coupled same-chart control family",
    };
  const resolveExtensionTrancheId = (args: {
    familyId: ModelTermExtensionFamilyId | null;
    candidate:
      | Pick<
          DecSweepCandidate,
          "pressureScale" | "densityLiftFraction" | "fluxScale" | "shearScale"
        >
      | null;
  }): Nhm2ObserverDecExtensionTrancheId | null => {
    if (args.familyId === null) return null;
    if (isExpandedBoundsCandidate(args.candidate)) {
      return "tranche_4_expanded_bounds";
    }
    if (args.familyId === "density_flux_shear_coupled") {
      return "tranche_3_fully_coupled";
    }
    return args.familyId === "flux_shear_coupled"
      ? "tranche_2_extended"
      : "tranche_1_primary";
  };
  const classifyModelTermExtensionFamily = (
    candidate: DecSweepCandidate,
  ): ModelTermExtensionFamilyId => {
    const densityLift = candidate.densityLiftFraction ?? 0;
    const fluxScale = candidate.fluxScale ?? sameChartTensorFluxScaleBaseline;
    const shearScale = candidate.shearScale ?? sameChartTensorShearScaleBaseline;
    const usesDensity = densityLift > 0;
    const usesFluxOrShear =
      fluxScale < sameChartTensorFluxScaleBaseline ||
      shearScale < sameChartTensorShearScaleBaseline;
    if (!usesDensity && !usesFluxOrShear) {
      return "pressure_only";
    }
    if (usesDensity && !usesFluxOrShear) {
      return "density_pressure_coupled";
    }
    if (!usesDensity && usesFluxOrShear) {
      return "flux_shear_coupled";
    }
    return "density_flux_shear_coupled";
  };
  const physicsSweepCandidates = sweepCandidatesWithRuntime.filter(
    (candidate) => candidate.candidateClass === "physics_control_proposal",
  );
  const modelTermExtensionFamilyRows = modelTermExtensionFamilyIds.map(
    (familyId) => {
      const familyCandidates = physicsSweepCandidates.filter(
        (candidate) => classifyModelTermExtensionFamily(candidate) === familyId,
      );
      const familyPassingCandidates = familyCandidates
        .filter((candidate) => candidate.passesSelectionGate)
        .sort(compareCandidatesForSelection);
      const familyRankedCandidates = [...familyCandidates].sort(
        compareCandidatesForSelection,
      );
      const bestCandidate =
        familyPassingCandidates[0] ?? familyRankedCandidates[0] ?? null;
      const reasonCodes: Nhm2ObserverDecPhysicsControlEvidence["selectionReasonCodes"] =
        bestCandidate == null
          ? ["candidate_not_evaluated"]
          : bestCandidate.passesSelectionGate
            ? ["selection_gate_pass"]
            : bestCandidate.gateFailureReasons.length > 0
              ? bestCandidate.gateFailureReasons
              : ["candidate_not_evaluated"];
      const recommendationLabel:
        | "prioritize_for_model_term_extension"
        | "secondary"
        | "insufficient_evidence" =
        bestCandidate == null
          ? "insufficient_evidence"
          : bestCandidate.passesSelectionGate && runtimeEvaluationComparable
            ? "prioritize_for_model_term_extension"
            : bestCandidate.passesSelectionGate
              ? "secondary"
              : "insufficient_evidence";
      return {
        familyId,
        label: modelTermExtensionFamilyLabels[familyId],
        candidateCount: familyCandidates.length,
        passingCandidateCount: familyPassingCandidates.length,
        bestCandidateId: bestCandidate?.candidateId ?? null,
        bestPrimaryMargin: bestCandidate?.selectionObjectivePrimaryMargin ?? null,
        bestMetricDecLift: bestCandidate?.metricDecRobustLift ?? null,
        bestTileDecLift: bestCandidate?.tileReconstitutedDecRobustLift ?? null,
        crossesZeroBothDecMargins: bestCandidate?.crossesZeroBothDecMargins ?? null,
        recommendation: recommendationLabel,
        reasonCodes,
        note:
          bestCandidate == null
            ? "No evaluated candidates landed in this family under the bounded sweep."
            : `bestCandidate=${bestCandidate.candidateId} passesSelectionGate=${String(bestCandidate.passesSelectionGate)} primaryMargin=${bestCandidate.selectionObjectivePrimaryMargin ?? "null"} crossesZero=${bestCandidate.crossesZeroBothDecMargins == null ? "null" : String(bestCandidate.crossesZeroBothDecMargins)}.`,
      };
    },
  );
  const rankedModelTermExtensionFamilies = [...modelTermExtensionFamilyRows].sort(
    (lhs, rhs) => {
      const lhsPriority =
        lhs.recommendation === "prioritize_for_model_term_extension"
          ? 2
          : lhs.recommendation === "secondary"
            ? 1
            : 0;
      const rhsPriority =
        rhs.recommendation === "prioritize_for_model_term_extension"
          ? 2
          : rhs.recommendation === "secondary"
            ? 1
            : 0;
      if (rhsPriority !== lhsPriority) return rhsPriority - lhsPriority;
      const lhsMargin = lhs.bestPrimaryMargin ?? Number.NEGATIVE_INFINITY;
      const rhsMargin = rhs.bestPrimaryMargin ?? Number.NEGATIVE_INFINITY;
      if (rhsMargin !== lhsMargin) return rhsMargin - lhsMargin;
      return lhs.familyId.localeCompare(rhs.familyId);
    },
  );
  const selectedModelTermExtensionFamily =
    recommendation === "model_term_extension_patch" &&
    boundedEnvelopeExhaustedForRecommendation
      ? rankedModelTermExtensionFamilies.find(
          (entry) => entry.bestCandidateId != null,
        ) ?? null
      : null;
  const familySearchOrder = rankedModelTermExtensionFamilies.map(
    (entry) => entry.familyId,
  );
  const selectedModelTermExtensionCandidate =
    selectedModelTermExtensionFamily?.bestCandidateId != null
      ? sweepCandidatesWithRuntime.find(
          (candidate) =>
            candidate.candidateId === selectedModelTermExtensionFamily.bestCandidateId,
        ) ?? null
      : runtimeApplicationAttempted
        ? runtimeSweepCandidate
        : null;
  const extensionTrancheId: Nhm2ObserverDecExtensionTrancheId | null =
    recommendation === "model_term_extension_patch"
      ? "tranche_5_model_term_extension"
      : resolveExtensionTrancheId({
          familyId: selectedModelTermExtensionFamily?.familyId ?? runtimeDecisionFamilyId,
          candidate: selectedModelTermExtensionCandidate,
        });
  const modelTermExtensionFamilyEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["modelTermExtensionFamilyEvidence"]
  > = {
    status: semanticAdmissionStable ? "available" : "unavailable",
    selectionBasis:
      "Rank extension families on comparable same-route evidence using bounded DEC control margins with unchanged non-regression gates.",
    selectedFamilyId: selectedModelTermExtensionFamily?.familyId ?? null,
    selectedFamilyReason:
      selectedModelTermExtensionFamily == null
        ? recommendation === "model_term_extension_patch"
          ? "No family had commensurate evidence suitable for model-term extension routing."
          : "Model-term extension family routing is not selected because recommendation is not model_term_extension_patch."
        : `Selected ${selectedModelTermExtensionFamily.familyId} as the highest-ranked family under bounded-envelope exhaustion with bestPrimaryMargin=${selectedModelTermExtensionFamily.bestPrimaryMargin ?? "null"}.`,
    families: modelTermExtensionFamilyRows,
    comparabilityGate: {
      pass: runtimeEvaluationComparable,
      independentCrossCheckStatus: runtimeIndependentCrossCheckStatus,
      note: runtimeComparabilityNote,
    },
    citationRefs: Array.from(
      new Set([
        ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
        ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
      ]),
    ),
    notes: [
      `recommendation=${recommendation}`,
      `boundedEnvelopeExhausted=${boundedEnvelopeExhaustedForRecommendation == null ? "null" : String(boundedEnvelopeExhaustedForRecommendation)}`,
      `selectedFamilyId=${selectedModelTermExtensionFamily?.familyId ?? "none"}`,
      `selectedFamilyExtensionTrancheId=${extensionTrancheId ?? "none"}`,
      `tranche4CandidateCount=${tranche4SweepCandidates.length}`,
      `targetedCandidateCount=${tranche5SweepCandidates.length}`,
      `edgeCandidateCount=${tranche6SweepCandidates.length}`,
      `familyRanking=${rankedModelTermExtensionFamilies.map((entry) => `${entry.familyId}:${entry.bestPrimaryMargin ?? "null"}`).join(",") || "none"}`,
    ],
  };
  const fluxShearFamilyRows = modelTermExtensionFamilyRows.filter(
    (entry) =>
      entry.familyId === "flux_shear_coupled" ||
      entry.familyId === "density_flux_shear_coupled",
  );
  const rankedFluxShearFamilyRows = [...fluxShearFamilyRows].sort((lhs, rhs) => {
    const lhsPriority =
      lhs.recommendation === "prioritize_for_model_term_extension"
        ? 2
        : lhs.recommendation === "secondary"
          ? 1
          : 0;
    const rhsPriority =
      rhs.recommendation === "prioritize_for_model_term_extension"
        ? 2
        : rhs.recommendation === "secondary"
          ? 1
          : 0;
    if (rhsPriority !== lhsPriority) return rhsPriority - lhsPriority;
    const lhsMargin = lhs.bestPrimaryMargin ?? Number.NEGATIVE_INFINITY;
    const rhsMargin = rhs.bestPrimaryMargin ?? Number.NEGATIVE_INFINITY;
    if (rhsMargin !== lhsMargin) return rhsMargin - lhsMargin;
    return lhs.familyId.localeCompare(rhs.familyId);
  });
  const fluxShearFamilyRow =
    selectedModelTermExtensionFamily != null &&
    (selectedModelTermExtensionFamily.familyId === "flux_shear_coupled" ||
      selectedModelTermExtensionFamily.familyId === "density_flux_shear_coupled")
      ? selectedModelTermExtensionFamily
      : rankedFluxShearFamilyRows[0] ?? null;
  const fluxShearBestCandidate =
    fluxShearFamilyRow?.bestCandidateId == null
      ? null
      : sweepCandidatesWithRuntime.find(
          (candidate) =>
            candidate.candidateId === fluxShearFamilyRow.bestCandidateId,
        ) ?? null;
  const fluxShearNonRegressionPass =
    fluxShearBestCandidate == null
      ? null
      : fluxShearBestCandidate.guardChecks.metricWecNonRegression === true &&
          fluxShearBestCandidate.guardChecks.metricNecNonRegression === true &&
          emissionAdmissionStable &&
          semanticAdmissionStable;
  const fluxShearBoundedEnvelopeExhausted =
    fluxShearFamilyRow?.crossesZeroBothDecMargins == null
      ? boundedEnvelopeExhaustedForRecommendation
      : fluxShearFamilyRow.crossesZeroBothDecMargins === true
        ? false
        : (fluxShearFamilyRow.bestPrimaryMargin ?? Number.NEGATIVE_INFINITY) < 0;
  const fluxShearExtensionEvidence: Nhm2ObserverDecFluxShearExtensionEvidence = {
    status: semanticAdmissionStable ? "available" : "unavailable",
    routeId,
    selectedPath,
    selectedFamilyId: fluxShearFamilyRow?.familyId ?? null,
    selectionBasis:
      "Flux/shear extension route (including fully-coupled density+flux/shear family when present) remains on commensurate Einstein-path evidence with unchanged non-regression and comparability gates.",
    parameterEnvelope: {
      pressureScaleMin: activeBoundedEnvelope.pressureScaleMin,
      pressureScaleMax: activeBoundedEnvelope.pressureScaleMax,
      densityLiftMin: activeBoundedEnvelope.densityLiftMin,
      densityLiftMax: activeBoundedEnvelope.densityLiftMax,
      fluxScaleMin: activeBoundedEnvelope.fluxScaleMin,
      fluxScaleMax: activeBoundedEnvelope.fluxScaleMax,
      shearScaleMin: activeBoundedEnvelope.shearScaleMin,
      shearScaleMax: activeBoundedEnvelope.shearScaleMax,
    },
    bestCandidateId: fluxShearFamilyRow?.bestCandidateId ?? null,
    bestPrimaryMargin: fluxShearFamilyRow?.bestPrimaryMargin ?? null,
    bestMetricDecLift: fluxShearFamilyRow?.bestMetricDecLift ?? null,
    bestTileDecLift: fluxShearFamilyRow?.bestTileDecLift ?? null,
    crossZeroAchieved: fluxShearFamilyRow?.crossesZeroBothDecMargins ?? null,
    boundedEnvelopeExhausted: fluxShearBoundedEnvelopeExhausted,
    nonRegressionPass: fluxShearNonRegressionPass,
    comparabilityGate: {
      pass: runtimeEvaluationComparable,
      independentCrossCheckStatus: runtimeIndependentCrossCheckStatus,
      referenceRouteId: runtimeReferenceRouteId,
      comparableSampleCount: runtimeComparableSampleCount,
      minimumComparableSampleCount: runtimeMinimumComparableSampleCount,
      note: runtimeComparabilityNote,
    },
    recommendation,
    citationRefs: Array.from(
      new Set([
        ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
        ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
      ]),
    ),
    notes: [
      `selectedFamilyId=${fluxShearFamilyRow?.familyId ?? "none"}`,
      `bestCandidateId=${fluxShearFamilyRow?.bestCandidateId ?? "none"}`,
      `bestPrimaryMargin=${fluxShearFamilyRow?.bestPrimaryMargin ?? "null"}`,
      `crossZeroAchieved=${fluxShearFamilyRow?.crossesZeroBothDecMargins == null ? "null" : String(fluxShearFamilyRow.crossesZeroBothDecMargins)}`,
      `boundedEnvelopeExhausted=${fluxShearBoundedEnvelopeExhausted == null ? "null" : String(fluxShearBoundedEnvelopeExhausted)}`,
      `nonRegressionPass=${fluxShearNonRegressionPass == null ? "null" : String(fluxShearNonRegressionPass)}`,
      `comparabilityPass=${String(runtimeEvaluationComparable)}`,
      `independentCrossCheckStatus=${runtimeIndependentCrossCheckStatus}`,
      `referenceRouteId=${runtimeReferenceRouteId ?? "none"}`,
      `comparableSampleCount=${runtimeComparableSampleCount ?? "null"}`,
      `minimumComparableSampleCount=${runtimeMinimumComparableSampleCount}`,
      `tranche4CandidateCount=${tranche4SweepCandidates.length}`,
      `targetedCandidateCount=${tranche5SweepCandidates.length}`,
      `edgeCandidateCount=${tranche6SweepCandidates.length}`,
    ],
  };
  const citationRefs = Array.from(
    new Set(
      [
        ...NHM2_MODEL_TERM_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
        ...NHM2_DEC_REMEDIATION_WEB_CITATION_REFS,
        ...NHM2_DEC_PHYSICS_CONTROL_WEB_CITATION_REFS,
        ...args.modelTermSemanticEvidence.citationRefs,
        ...(args.modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
        ...args.decRemediationEvidence.citationRefs,
        ...args.tileObserverConditionComparabilityEvidence.citationRefs,
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  const claimCitationMap = NHM2_DEC_PHYSICS_CONTROL_CLAIM_CITATION_MAP.map(
    (entry) => ({
      claimId: entry.claimId,
      claim: entry.claim,
      citationRefs: Array.from(
        new Set(
          entry.citationRefs.filter(
            (citation) => typeof citation === "string" && citation.length > 0,
          ),
        ),
      ),
      note: entry.note,
    }),
  );
  const researchCitations = Array.from(
    new Set([
      ...citationRefs,
      ...decRuntimeCitationRefs,
      ...claimCitationMap.flatMap((entry) => entry.citationRefs),
    ]),
  );
  const expectedClaimIds = NHM2_DEC_PHYSICS_CONTROL_CLAIM_CITATION_MAP.map(
    (entry) => entry.claimId,
  );
  const coveredClaimIds = claimCitationMap
    .filter((entry) => entry.citationRefs.length > 0)
    .map((entry) => entry.claimId);
  const missingClaimIds = expectedClaimIds.filter(
    (claimId) => !coveredClaimIds.includes(claimId),
  );
  const claimCitationMapCompleteness: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["claimCitationMapCompleteness"]
  > = {
    status: missingClaimIds.length === 0 ? "pass" : "fail",
    expectedClaimCount: expectedClaimIds.length,
    coveredClaimCount: coveredClaimIds.length,
    expectedClaimIds,
    missingClaimIds,
    note:
      missingClaimIds.length === 0
        ? "All DEC-control claims in the map carry at least one citation reference."
        : `Missing citation coverage for claim ids: ${missingClaimIds.join(", ")}`,
  };
  const decCoupledControlEvidence: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["decCoupledControlEvidence"]
  > = {
    status: semanticAdmissionStable ? "available" : "unavailable",
    controlFamiliesUsed: ["E_density", "J_i_flux", "S_ij_shear"],
    boundedEnvelope: {
      pressureScaleMin: sameChartTensorPhysicsControlMin,
      pressureScaleMax: sameChartTensorPhysicsControlBaseline,
      densityLiftMin: sameChartTensorDensityLiftBaseline,
      densityLiftMax: sameChartTensorDensityLiftMax,
      fluxScaleMin: sameChartTensorFluxScaleMin,
      fluxScaleMax: sameChartTensorFluxScaleBaseline,
      shearScaleMin: sameChartTensorShearScaleMin,
      shearScaleMax: sameChartTensorShearScaleBaseline,
    },
    candidateEvaluationTable: topCandidateLeaderboard.map((leader) => {
      const candidate = sweepCandidatesWithRuntime.find(
        (entry) => entry.candidateId === leader.candidateId,
      );
      return {
        candidateId: leader.candidateId,
        pressureScale: candidate?.pressureScale ?? null,
        densityLiftFraction: candidate?.densityLiftFraction ?? null,
        fluxScale: candidate?.fluxScale ?? null,
        shearScale: candidate?.shearScale ?? null,
        selectionObjectivePrimaryMargin:
          leader.selectionObjectivePrimaryMargin ?? null,
        passesSelectionGate: leader.passesSelectionGate,
      };
    }),
    bestCandidateId: selectedCandidateId,
    comparabilityGate: {
      pass: runtimeEvaluationComparable,
      independentCrossCheckStatus: runtimeIndependentCrossCheckStatus,
      note: runtimeComparabilityNote,
    },
    researchClaims: [
      {
        claimId: "same_chart_projection_grammar_required",
        claim:
          "Same-chart E, J_i, and S_ij projections are required for physically coherent observer-condition evaluation.",
        confidenceLabel: "established",
        citationRefs: [
          "https://people-lux.obspm.fr/gourgoulhon/pdf/form3p1.pdf",
          "https://arxiv.org/abs/gr-qc/0703035",
        ],
        note:
          "3+1 projection grammar constrains how DEC controls can be applied without chart/semantic drift.",
      },
      {
        claimId: "geometry_first_route_is_control_basis",
        claim:
          "Coupled DEC controls are evaluated on the admitted full Einstein route before observer-condition interpretation.",
        confidenceLabel: "established",
        citationRefs: [
          "https://arxiv.org/abs/gr-qc/0110086",
          "https://einsteintoolkit.org/thornguide/EinsteinBase/TmunuBase/documentation.html",
          "https://arxiv.org/abs/2404.03095",
        ],
        note:
          "Geometry-first route parity is retained via independent cross-check and comparability gates.",
      },
      {
        claimId: "bounded_probe_non_regression_policy",
        claim:
          "Bounded E/J/S knob sweeps require WEC/NEC non-regression and cross-zero DEC robust margins before runtime apply can remain applied.",
        confidenceLabel: "review",
        citationRefs: [
          "https://arxiv.org/abs/1702.05915",
          "https://arxiv.org/abs/2003.01815",
          "https://arxiv.org/abs/1405.0403",
        ],
        note:
          "Non-regression and cross-zero gating are policy-conservative and grounded in energy-condition review practice.",
      },
      {
        claimId: "observer_robust_cross_check_priority",
        claim:
          "Independent cross-check parity is required for commensurate runtime decisions on coupled DEC-control candidates.",
        confidenceLabel: "emerging_preprint",
        citationRefs: [
          "https://arxiv.org/abs/2404.10855",
          "https://arxiv.org/abs/2602.18023",
        ],
        note:
          "Recent warp-analysis tooling emphasizes route parity and observer-robust checks before promotion.",
      },
      {
        claimId: "runtime_uncertainty_sign_guard_required",
        claim:
          "Applied runtime decisions require uncertainty-conservative positivity and sign agreement between selected and independent-check DEC margins.",
        confidenceLabel: "emerging_preprint",
        citationRefs: [
          "https://arxiv.org/abs/gr-qc/0507004",
          "https://arxiv.org/abs/1306.6052",
          "https://arxiv.org/abs/2404.10855",
          "https://arxiv.org/abs/2602.18023",
        ],
        note:
          "Sign and uncertainty gates localize decision risk to commensurate selected/reference route evidence.",
      },
      {
        claimId: "uncertainty_reporting_requires_refinement_evidence",
        claim:
          "Uncertainty-sensitive DEC decisions should be reported with refinement-aware uncertainty bounds rather than raw single-resolution margins.",
        confidenceLabel: "established",
        citationRefs: [
          "https://www.osti.gov/biblio/6817347",
          "https://arxiv.org/abs/1306.6052",
        ],
        note:
          "Pairs conservative DEC margins with explicit uncertainty bounds under convergence-reporting precedent.",
      },
    ],
    note:
      "Coupled-control evidence localizes DEC behavior under bounded E/J/S controls without widening claim tier.",
  };
  const researchClaimLookup = new Map(
    decCoupledControlEvidence.researchClaims.map((claim) => [claim.claimId, claim]),
  );
  const researchSupportMap: NonNullable<
    Nhm2ObserverDecPhysicsControlEvidence["researchSupportMap"]
  > = Object.fromEntries(
    claimCitationMap.map((claimEvidence) => {
      const supportMeta =
        NHM2_DEC_PHYSICS_CONTROL_RESEARCH_SUPPORT_MAP[
          claimEvidence.claimId as keyof typeof NHM2_DEC_PHYSICS_CONTROL_RESEARCH_SUPPORT_MAP
        ];
      const coupledClaim = researchClaimLookup.get(claimEvidence.claimId);
      return [
        claimEvidence.claimId,
        {
          claimId: claimEvidence.claimId,
          supportLevel: supportMeta?.supportLevel ?? "inference",
          citationRefs: Array.from(
            new Set([
              ...claimEvidence.citationRefs,
              ...(coupledClaim?.citationRefs ?? []),
            ]),
          ),
          evidenceRefs: supportMeta?.evidenceRefs ?? [],
          note:
            supportMeta?.note ??
            coupledClaim?.note ??
            claimEvidence.note ??
            "Support map entry inferred from claim citation coverage only.",
        },
      ];
    }),
  );
  return {
    chartRef: args.modelTermSemanticEvidence.chartRef ?? null,
    routeId,
    selectedPath,
    baseline: {
      metricDecEulerianMin: baselineMetricDecEulerianMin,
      metricDecRobustMin: baselineMetricDecRobustMin,
      metricWecEulerianMin: baselineMetricWecEulerianMin,
      metricWecRobustMin: baselineMetricWecRobustMin,
      metricNecEulerianMin: baselineMetricNecEulerianMin,
      metricNecRobustMin: baselineMetricNecRobustMin,
      tileReconstitutedDecEulerianMin: baselineTileDecEulerianMin,
      tileReconstitutedDecRobustMin: baselineTileDecRobustMin,
      tileReconstitutedWecEulerianMin: baselineTileWecEulerianMin,
      tileReconstitutedWecRobustMin: baselineTileWecRobustMin,
      tileReconstitutedNecEulerianMin: baselineTileNecEulerianMin,
      tileReconstitutedNecRobustMin: baselineTileNecRobustMin,
    },
    candidate: {
      candidateId,
      applied: candidateApplied,
      metricDecEulerianMin: candidateMetricDecEulerianMin,
      metricDecRobustMin: candidateMetricDecRobustMin,
      metricWecEulerianMin: candidateMetricWecEulerianMin,
      metricWecRobustMin: candidateMetricWecRobustMin,
      metricNecEulerianMin: candidateMetricNecEulerianMin,
      metricNecRobustMin: candidateMetricNecRobustMin,
      tileReconstitutedDecEulerianMin: candidateTileDecEulerianMin,
      tileReconstitutedDecRobustMin: candidateTileDecRobustMin,
      tileReconstitutedWecEulerianMin: candidateTileWecEulerianMin,
      tileReconstitutedWecRobustMin: candidateTileWecRobustMin,
      tileReconstitutedNecEulerianMin: candidateTileNecEulerianMin,
      tileReconstitutedNecRobustMin: candidateTileNecRobustMin,
    },
    deltas: {
      metricDecRobustLift,
      tileReconstitutedDecRobustLift,
      metricWecRobustDelta,
      metricNecRobustDelta,
    },
    guardChecks: {
      metricWecNonRegression,
      metricNecNonRegression,
      emissionAdmissionStable,
      semanticAdmissionStable,
    },
    sweepCandidates: sweepCandidatesWithRuntime,
    sweepPhaseSummary,
    topCandidateLeaderboard,
    selectionObjective,
    selectedCandidateId,
    selectionDecision,
    selectionPlateauStatus,
    crossZeroFeasibilityEvidence,
    decResidualAttributionEvidence,
    decFrontierImprovementEvidence,
    zeroCrossFeasibilityDecision,
    zeroCrossFeasibilityReasonCodes,
    boundedSearchEnvelope,
    selectionReasonCodes,
    nonRegressionGate: {
      required: nonRegressionGateRequired,
      pass: nonRegressionGatePass,
      note: nonRegressionGateNote,
    },
    runtimeApplication: {
      attempted: runtimeApplicationAttempted,
      enabled: runtimeApplicationEnabled,
      status: runtimeApplicationStatus,
      failureMode: runtimeFailureMode,
      evaluationComparable: runtimeEvaluationComparable,
      sampleCount: runtimeSampleCount,
      comparableSampleCount: runtimeComparableSampleCount,
      minimumComparableSampleCount: runtimeMinimumComparableSampleCount,
      sampleCountSufficient: runtimeSampleCountSufficient,
      referenceRouteId: runtimeReferenceRouteId,
      selectedRouteId: routeId,
      selectedPath,
      candidateId:
        runtimeApplicationAttempted
          ? runtimeSweepCandidate.candidateId
          : null,
      comparabilityGate: {
        chartRef: args.modelTermSemanticEvidence.chartRef,
        chartParity: runtimeChartParity,
        selectedPathParity: runtimeSelectedPathParity,
        independentCrossCheckStatus: runtimeIndependentCrossCheckStatus,
        pass: runtimeEvaluationComparable,
        note: runtimeComparabilityNote,
      },
      rollbackReasonCodes: runtimeRollbackReasonCodes,
      guardChecks: {
        metricWecNonRegression: runtimeMetricWecNonRegression,
        metricNecNonRegression: runtimeMetricNecNonRegression,
        emissionAdmissionStable,
        semanticAdmissionStable,
        metricDecRobustLiftPositive: runtimeMetricDecRobustLiftPositive,
        tileReconstitutedDecRobustLiftNonNegative:
          runtimeTileDecRobustLiftNonNegative,
        crossesZeroBothDecMargins: runtimeCrossesZeroBothDecMargins,
        independentCrossCheckSignAgreement:
          runtimeIndependentCrossCheckSignAgreement,
        uncertaintyBoundPass: runtimeUncertaintyBoundPass,
        referenceCrossesZeroBothDecMargins:
          runtimeReferenceCrossesZeroBothDecMargins,
      },
      observed: {
        metricDecRobustLift: runtimeMetricDecRobustLift,
        tileReconstitutedDecRobustLift: runtimeTileReconstitutedDecRobustLift,
        metricWecRobustDelta: runtimeMetricWecRobustDelta,
        metricNecRobustDelta: runtimeMetricNecRobustDelta,
        metricDecRobustMarginToZero: runtimeMetricDecRobustMarginToZero,
        tileReconstitutedDecRobustMarginToZero: runtimeTileDecRobustMarginToZero,
        metricWecNonRegressionMargin: runtimeMetricWecNonRegressionMargin,
        metricNecNonRegressionMargin: runtimeMetricNecNonRegressionMargin,
        independentCrossCheckRelativeResidual:
          runtimeIndependentCrossCheckRelativeResidual,
        uncertaintyRelativeBound: runtimeUncertaintyRelativeBound,
        metricDecUncertaintyAbs: runtimeMetricDecUncertaintyAbs,
        tileReconstitutedDecUncertaintyAbs: runtimeTileDecUncertaintyAbs,
        metricDecConservativeMarginToZero:
          runtimeMetricDecConservativeMarginToZero,
        tileReconstitutedDecConservativeMarginToZero:
          runtimeTileDecConservativeMarginToZero,
        referenceMetricDecRobustMarginToZero:
          runtimeReferenceMetricDecRobustMarginToZero,
        referenceTileReconstitutedDecRobustMarginToZero:
          runtimeReferenceTileDecRobustMarginToZero,
        referenceMetricDecUncertaintyAbs: runtimeReferenceMetricDecUncertaintyAbs,
        referenceTileReconstitutedDecUncertaintyAbs:
          runtimeReferenceTileDecUncertaintyAbs,
        referenceMetricDecConservativeMarginToZero:
          runtimeReferenceMetricDecConservativeMarginToZero,
        referenceTileReconstitutedDecConservativeMarginToZero:
          runtimeReferenceTileDecConservativeMarginToZero,
      },
      note: runtimeApplicationNote,
      citationRefs: decRuntimeCitationRefs,
    },
    runtimeAttempted: runtimeApplicationAttempted,
    runtimeDecision: runtimeApplicationStatus,
    runtimeDecisionReasonCodes: runtimeDecisionReasonCodes,
    decRuntimeDecisionEvidence,
    refinementEvidence,
    extensionTrancheId,
    familySearchOrder,
    appliedCandidateEvidence,
    rollbackLocalizationEvidence,
    controlKnobs,
    claimCitationMap,
    researchSupportMap,
    claimCitationMapCompleteness,
    decCoupledControlEvidence,
    modelTermExtensionFamilyEvidence,
    fluxShearExtensionEvidence,
    recommendation,
    uncertaintyTags,
    researchCitations,
    citationRefs,
    derivationNotes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `candidateId=${candidateId}`,
      `candidateApplied=${String(candidateApplied)}`,
      `selectedCandidateClass=${selectedSweepCandidate.candidateClass}`,
      `selectionDecision=${selectionDecision}`,
      `selectionPlateauStatus=${selectionPlateauStatus}`,
      `selectionReasonCodes=${selectionReasonCodes.join(",")}`,
      `selectionObjective=${selectionObjective}`,
      `selectionObjectivePrimaryMargin=${selectedSweepCandidate.selectionObjectivePrimaryMargin ?? "null"}`,
      `selectionObjectiveControlDeviation=${selectedSweepCandidate.controlDeviationMagnitude ?? "null"}`,
      `selectionObjectiveCrossesZeroBothDecMargins=${selectedSweepCandidate.crossesZeroBothDecMargins == null ? "null" : String(selectedSweepCandidate.crossesZeroBothDecMargins)}`,
      `preFrontierBestPrimaryMargin=${preFrontierBestPrimaryMargin ?? "null"}`,
      `frontierBestPrimaryMargin=${frontierBestPrimaryMargin ?? "null"}`,
      `frontierBestDeltaFromPreFrontier=${frontierBestDeltaFromPreFrontier ?? "null"}`,
      `frontierBestDeltaFromBaseline=${frontierBestDeltaFromBaseline ?? "null"}`,
      `frontierBestDeltaPercentFromBaseline=${frontierBestDeltaPercentFromBaseline ?? "null"}`,
      `frontierSeedCandidateId=${frontierSeedCandidateId ?? "none"}`,
      `frontierBestCandidateId=${frontierBestCandidate?.candidateId ?? "none"}`,
      `frontierCandidateCount=${frontierSweepCandidates.length}`,
      `frontierPassingCount=${frontierPassingCandidates.length}`,
      `tranche4CandidateCount=${tranche4SweepCandidates.length}`,
      `targetedCandidateCount=${tranche5SweepCandidates.length}`,
      `edgeCandidateCount=${tranche6SweepCandidates.length}`,
      `crossZeroFeasibility.baselinePrimaryMargin=${baselinePrimaryMargin ?? "null"}`,
      `crossZeroFeasibility.bestCandidatePrimaryMargin=${bestCandidatePrimaryMargin ?? "null"}`,
      `crossZeroFeasibility.requiredLiftToZero=${requiredLiftToZero ?? "null"}`,
      `crossZeroFeasibility.achievedLiftFromBaseline=${achievedLiftFromBaseline ?? "null"}`,
      `crossZeroFeasibility.bestAchievedLift=${bestAchievedLift ?? "null"}`,
      `crossZeroFeasibility.residualMarginToZero=${residualMarginToZero ?? "null"}`,
      `crossZeroFeasibility.gapToZero=${gapToZero ?? "null"}`,
      `crossZeroFeasibility.crossZeroAchieved=${crossZeroAchieved == null ? "null" : String(crossZeroAchieved)}`,
      `crossZeroFeasibility.boundedEnvelopeExhausted=${boundedEnvelopeExhausted == null ? "null" : String(boundedEnvelopeExhausted)}`,
      `crossZeroFeasibility.decision=${zeroCrossFeasibilityDecision}`,
      `crossZeroFeasibility.reasonCodes=${zeroCrossFeasibilityReasonCodes.join(",")}`,
      `crossZeroFeasibility.inferenceLabel=${crossZeroInferenceLabel}`,
      `decResidualAttribution.status=${decResidualAttributionEvidence.status}`,
      `decResidualAttribution.primarySurface=${decResidualAttributionEvidence.primarySurface}`,
      `decResidualAttribution.dominantViolationClass=${decResidualAttributionEvidence.dominantViolationClass}`,
      `decResidualAttribution.selectedPrimaryMargin=${decResidualAttributionEvidence.selectedPrimaryMargin ?? "null"}`,
      `decResidualAttribution.gapToZero=${decResidualAttributionEvidence.gapToZero ?? "null"}`,
      `decResidualAttribution.selectionReasonCodes=${decResidualAttributionEvidence.selectionReasonCodes.join(",") || "none"}`,
      `boundedSearchEnvelope.pressureScale=[${boundedSearchEnvelope.pressureScaleMin ?? "null"},${boundedSearchEnvelope.pressureScaleMax ?? "null"}]`,
      `boundedSearchEnvelope.densityLift=[${boundedSearchEnvelope.densityLiftMin ?? "null"},${boundedSearchEnvelope.densityLiftMax ?? "null"}]`,
      `boundedSearchEnvelope.fluxScale=[${boundedSearchEnvelope.fluxScaleMin ?? "null"},${boundedSearchEnvelope.fluxScaleMax ?? "null"}]`,
      `boundedSearchEnvelope.shearScale=[${boundedSearchEnvelope.shearScaleMin ?? "null"},${boundedSearchEnvelope.shearScaleMax ?? "null"}]`,
      `boundedSearchEnvelope.coarseStep.pressureScale=${boundedSearchEnvelope.coarsePressureStep ?? "null"}`,
      `boundedSearchEnvelope.coarseStep.densityLift=${boundedSearchEnvelope.coarseDensityLiftStep ?? "null"}`,
      `boundedSearchEnvelope.coarseStep.fluxScale=${boundedSearchEnvelope.coarseFluxScaleStep ?? "null"}`,
      `boundedSearchEnvelope.coarseStep.shearScale=${boundedSearchEnvelope.coarseShearScaleStep ?? "null"}`,
      `boundedSearchEnvelope.refineStep.pressureScale=${boundedSearchEnvelope.refinePressureStep ?? "null"}`,
      `boundedSearchEnvelope.refineStep.densityLift=${boundedSearchEnvelope.refineDensityLiftStep ?? "null"}`,
      `boundedSearchEnvelope.refineStep.fluxScale=${boundedSearchEnvelope.refineFluxScaleStep ?? "null"}`,
      `boundedSearchEnvelope.refineStep.shearScale=${boundedSearchEnvelope.refineShearScaleStep ?? "null"}`,
      `boundedSearchEnvelope.frontierStep.pressureScale=${boundedSearchEnvelope.frontierPressureStep ?? "null"}`,
      `boundedSearchEnvelope.frontierStep.densityLift=${boundedSearchEnvelope.frontierDensityLiftStep ?? "null"}`,
      `boundedSearchEnvelope.frontierStep.fluxScale=${boundedSearchEnvelope.frontierFluxScaleStep ?? "null"}`,
      `boundedSearchEnvelope.frontierStep.shearScale=${boundedSearchEnvelope.frontierShearScaleStep ?? "null"}`,
      `boundedSearchEnvelope.coarseCandidateCount=${boundedSearchEnvelope.coarseCandidateCount ?? "null"}`,
      `boundedSearchEnvelope.refineCandidateCount=${boundedSearchEnvelope.refineCandidateCount ?? "null"}`,
      `boundedSearchEnvelope.frontierCandidateCount=${boundedSearchEnvelope.frontierCandidateCount ?? "null"}`,
      `boundedSearchEnvelope.refineSeedCount=${boundedSearchEnvelope.refineSeedCount ?? "null"}`,
      `boundedSearchEnvelope.observerDomainFixed=${String(boundedSearchEnvelope.observerDomainFixed)}`,
      `claimCitationMapCompleteness.status=${claimCitationMapCompleteness.status}`,
      `claimCitationMapCompleteness.expectedClaimCount=${claimCitationMapCompleteness.expectedClaimCount}`,
      `claimCitationMapCompleteness.coveredClaimCount=${claimCitationMapCompleteness.coveredClaimCount}`,
      `claimCitationMapCompleteness.missingClaimIds=${claimCitationMapCompleteness.missingClaimIds.join(",") || "none"}`,
      `sweepCandidateCount=${sweepCandidatesWithRuntime.length}`,
      `sweepPhaseSummary.coarseCandidateCount=${sweepPhaseSummary.coarseCandidateCount ?? "null"}`,
      `sweepPhaseSummary.coarsePassingCount=${sweepPhaseSummary.coarsePassingCount ?? "null"}`,
      `sweepPhaseSummary.refineCandidateCount=${sweepPhaseSummary.refineCandidateCount ?? "null"}`,
      `sweepPhaseSummary.refinePassingCount=${sweepPhaseSummary.refinePassingCount ?? "null"}`,
      `sweepPhaseSummary.refineSeedCandidateIds=${sweepPhaseSummary.refineSeedCandidateIds.join(",") || "none"}`,
      `sweepPhaseSummary.frontierCandidateCount=${sweepPhaseSummary.frontierCandidateCount ?? "null"}`,
      `sweepPhaseSummary.frontierPassingCount=${sweepPhaseSummary.frontierPassingCount ?? "null"}`,
      `sweepPhaseSummary.frontierSeedCandidateId=${sweepPhaseSummary.frontierSeedCandidateId ?? "none"}`,
      `baseline.metricDecRobustMin=${baselineMetricDecRobustMin ?? "null"}`,
      `baseline.tileReconstitutedDecRobustMin=${baselineTileDecRobustMin ?? "null"}`,
      `deltas.metricDecRobustLift=${metricDecRobustLift ?? "null"}`,
      `deltas.tileReconstitutedDecRobustLift=${tileReconstitutedDecRobustLift ?? "null"}`,
      `guard.metricWecNonRegression=${metricWecNonRegression == null ? "null" : String(metricWecNonRegression)}`,
      `guard.metricNecNonRegression=${metricNecNonRegression == null ? "null" : String(metricNecNonRegression)}`,
      `guard.emissionAdmissionStable=${String(emissionAdmissionStable)}`,
      `guard.semanticAdmissionStable=${String(semanticAdmissionStable)}`,
      `sameChartTensorPhysicsControlBaseline=${sameChartTensorPhysicsControlBaseline}`,
      `sameChartTensorPhysicsControlMin=${sameChartTensorPhysicsControlMin}`,
      `sameChartTensorPhysicsControlTargetedMin=${sameChartTensorPhysicsControlTargetedMin}`,
      `sameChartTensorPhysicsControlEdgeMin=${sameChartTensorPhysicsControlEdgeMin}`,
      `sameChartTensorPhysicsControlProbeScale=${sameChartTensorPhysicsControlProbeScale}`,
      `sameChartTensorDensityLiftBaseline=${sameChartTensorDensityLiftBaseline}`,
      `sameChartTensorDensityLiftMax=${sameChartTensorDensityLiftMax}`,
      `sameChartTensorDensityLiftTargetedMax=${sameChartTensorDensityLiftTargetedMax}`,
      `sameChartTensorDensityLiftEdgeMax=${sameChartTensorDensityLiftEdgeMax}`,
      `sameChartTensorDensityLiftProbeFraction=${sameChartTensorDensityLiftProbeFraction}`,
      `sameChartTensorFluxScaleBaseline=${sameChartTensorFluxScaleBaseline}`,
      `sameChartTensorFluxScaleMin=${sameChartTensorFluxScaleMin}`,
      `sameChartTensorFluxScaleTargetedMin=${sameChartTensorFluxScaleTargetedMin}`,
      `sameChartTensorFluxScaleEdgeMin=${sameChartTensorFluxScaleEdgeMin}`,
      `sameChartTensorFluxScaleProbe=${sameChartTensorFluxScaleProbe}`,
      `sameChartTensorShearScaleBaseline=${sameChartTensorShearScaleBaseline}`,
      `sameChartTensorShearScaleMin=${sameChartTensorShearScaleMin}`,
      `sameChartTensorShearScaleTargetedMin=${sameChartTensorShearScaleTargetedMin}`,
      `sameChartTensorShearScaleEdgeMin=${sameChartTensorShearScaleEdgeMin}`,
      `sameChartTensorShearScaleProbe=${sameChartTensorShearScaleProbe}`,
      `sameChartTensorPhysicsControlProbeDecLift=${sameChartPressureScaleProbe.metricDecRobustMin != null && baselineMetricDecRobustMin != null ? sameChartPressureScaleProbe.metricDecRobustMin - baselineMetricDecRobustMin : "null"}`,
      `sameChartTensorPhysicsControlProbeNecDelta=${sameChartPressureScaleProbe.metricNecRobustMin != null && baselineMetricNecRobustMin != null ? sameChartPressureScaleProbe.metricNecRobustMin - baselineMetricNecRobustMin : "null"}`,
      `sameChartCoupledProbeDecLift=${sameChartCoupledDensityPressureProbe.metricDecRobustMin != null && baselineMetricDecRobustMin != null ? sameChartCoupledDensityPressureProbe.metricDecRobustMin - baselineMetricDecRobustMin : "null"}`,
      `sameChartCoupledProbeNecDelta=${sameChartCoupledDensityPressureProbe.metricNecRobustMin != null && baselineMetricNecRobustMin != null ? sameChartCoupledDensityPressureProbe.metricNecRobustMin - baselineMetricNecRobustMin : "null"}`,
      `decCoupledControlEvidence.status=${decCoupledControlEvidence.status}`,
      `decCoupledControlEvidence.bestCandidateId=${decCoupledControlEvidence.bestCandidateId ?? "null"}`,
      `modelTermExtensionFamilyEvidence.status=${modelTermExtensionFamilyEvidence.status}`,
      `modelTermExtensionFamilyEvidence.selectedFamilyId=${modelTermExtensionFamilyEvidence.selectedFamilyId ?? "null"}`,
      `modelTermExtensionFamilyEvidence.comparabilityGate.pass=${String(modelTermExtensionFamilyEvidence.comparabilityGate.pass)}`,
      `modelTermExtensionFamilyEvidence.families=${modelTermExtensionFamilyEvidence.families.map((entry) => `${entry.familyId}:${entry.bestPrimaryMargin ?? "null"}:${entry.recommendation}`).join(",") || "none"}`,
      `fluxShearExtensionEvidence.status=${fluxShearExtensionEvidence.status}`,
      `fluxShearExtensionEvidence.selectedFamilyId=${fluxShearExtensionEvidence.selectedFamilyId ?? "null"}`,
      `fluxShearExtensionEvidence.bestCandidateId=${fluxShearExtensionEvidence.bestCandidateId ?? "null"}`,
      `fluxShearExtensionEvidence.bestPrimaryMargin=${fluxShearExtensionEvidence.bestPrimaryMargin ?? "null"}`,
      `fluxShearExtensionEvidence.crossZeroAchieved=${fluxShearExtensionEvidence.crossZeroAchieved == null ? "null" : String(fluxShearExtensionEvidence.crossZeroAchieved)}`,
      `fluxShearExtensionEvidence.boundedEnvelopeExhausted=${fluxShearExtensionEvidence.boundedEnvelopeExhausted == null ? "null" : String(fluxShearExtensionEvidence.boundedEnvelopeExhausted)}`,
      `fluxShearExtensionEvidence.nonRegressionPass=${fluxShearExtensionEvidence.nonRegressionPass == null ? "null" : String(fluxShearExtensionEvidence.nonRegressionPass)}`,
      `fluxShearExtensionEvidence.comparabilityGate.pass=${String(fluxShearExtensionEvidence.comparabilityGate.pass)}`,
      `fluxShearExtensionEvidence.comparabilityGate.independentCrossCheckStatus=${fluxShearExtensionEvidence.comparabilityGate.independentCrossCheckStatus}`,
      `fluxShearExtensionEvidence.comparabilityGate.referenceRouteId=${fluxShearExtensionEvidence.comparabilityGate.referenceRouteId ?? "none"}`,
      `nonRegressionGate.pass=${String(nonRegressionGatePass)}`,
      `runtimeApplication.status=${runtimeApplicationStatus}`,
      `runtimeApplication.failureMode=${runtimeFailureMode}`,
      `runtimeApplication.attempted=${String(runtimeApplicationAttempted)}`,
      `runtimeApplication.enabled=${String(runtimeApplicationEnabled)}`,
      `runtimeApplication.evaluationComparable=${String(runtimeEvaluationComparable)}`,
      `runtimeApplication.sampleCount=${runtimeSampleCount ?? "null"}`,
      `runtimeApplication.comparableSampleCount=${runtimeComparableSampleCount ?? "null"}`,
      `runtimeApplication.minimumComparableSampleCount=${runtimeMinimumComparableSampleCount}`,
      `runtimeApplication.sampleCountSufficient=${String(runtimeSampleCountSufficient)}`,
      `runtimeApplication.referenceRouteId=${runtimeReferenceRouteId ?? "none"}`,
      `runtimeApplication.selectedRouteId=${routeId ?? "none"}`,
      `runtimeApplication.selectedPath=${selectedPath ?? "none"}`,
      `runtimeApplication.runtimeCandidateId=${runtimeSweepCandidate.candidateId}`,
      `runtimeApplication.comparabilityGate.chartParity=${String(runtimeChartParity)}`,
      `runtimeApplication.comparabilityGate.selectedPathParity=${String(runtimeSelectedPathParity)}`,
      `runtimeApplication.comparabilityGate.independentCrossCheckStatus=${runtimeIndependentCrossCheckStatus}`,
      `runtimeApplication.comparabilityGate.pass=${String(runtimeEvaluationComparable)}`,
      `runtimeApplication.comparabilityGate.independentCrossCheckRelativeResidual=${runtimeIndependentCrossCheckRelativeResidual}`,
      `runtimeApplication.rollbackReasonCodes=${runtimeRollbackReasonCodes.join(",") || "none"}`,
      `runtimeApplication.guardChecks.independentCrossCheckSignAgreement=${String(runtimeIndependentCrossCheckSignAgreement)}`,
      `runtimeApplication.guardChecks.uncertaintyBoundPass=${String(runtimeUncertaintyBoundPass)}`,
      `runtimeApplication.guardChecks.referenceCrossesZeroBothDecMargins=${String(runtimeReferenceCrossesZeroBothDecMargins)}`,
      `runtimeApplication.observed.uncertaintyRelativeBound=${runtimeUncertaintyRelativeBound}`,
      `runtimeApplication.observed.metricDecRobustMarginToZero=${runtimeMetricDecRobustMarginToZero ?? "null"}`,
      `runtimeApplication.observed.tileReconstitutedDecRobustMarginToZero=${runtimeTileDecRobustMarginToZero ?? "null"}`,
      `runtimeApplication.observed.metricDecConservativeMarginToZero=${runtimeMetricDecConservativeMarginToZero ?? "null"}`,
      `runtimeApplication.observed.tileReconstitutedDecConservativeMarginToZero=${runtimeTileDecConservativeMarginToZero ?? "null"}`,
      `runtimeApplication.observed.referenceMetricDecRobustMarginToZero=${runtimeReferenceMetricDecRobustMarginToZero ?? "null"}`,
      `runtimeApplication.observed.referenceTileReconstitutedDecRobustMarginToZero=${runtimeReferenceTileDecRobustMarginToZero ?? "null"}`,
      `runtimeApplication.observed.referenceMetricDecConservativeMarginToZero=${runtimeReferenceMetricDecConservativeMarginToZero ?? "null"}`,
      `runtimeApplication.observed.referenceTileReconstitutedDecConservativeMarginToZero=${runtimeReferenceTileDecConservativeMarginToZero ?? "null"}`,
      `runtimeApplication.observed.metricWecNonRegressionMargin=${runtimeMetricWecNonRegressionMargin ?? "null"}`,
      `runtimeApplication.observed.metricNecNonRegressionMargin=${runtimeMetricNecNonRegressionMargin ?? "null"}`,
      `refinementEvidence.status=${refinementEvidence.status}`,
      `refinementEvidence.coarseStepM=${refinementEvidence.coarseStepM ?? "null"}`,
      `refinementEvidence.refinedStepM=${refinementEvidence.refinedStepM ?? "null"}`,
      `refinementEvidence.superRefinedStepM=${refinementEvidence.superRefinedStepM ?? "null"}`,
      `refinementEvidence.richardsonExtrapolatedResidualT0i=${refinementEvidence.richardsonExtrapolatedResidualT0i ?? "null"}`,
      `refinementEvidence.richardsonExtrapolatedResidualOffDiagonal=${refinementEvidence.richardsonExtrapolatedResidualOffDiagonal ?? "null"}`,
      `refinementEvidence.uncertaintyRelativeBound=${refinementEvidence.uncertaintyRelativeBound ?? "null"}`,
      `refinementEvidence.conservativeMetricDecMarginToZero=${refinementEvidence.conservativeMetricDecMarginToZero ?? "null"}`,
      `refinementEvidence.conservativeTileReconstitutedDecMarginToZero=${refinementEvidence.conservativeTileReconstitutedDecMarginToZero ?? "null"}`,
      `refinementEvidence.uncertaintyBoundPass=${refinementEvidence.uncertaintyBoundPass == null ? "null" : String(refinementEvidence.uncertaintyBoundPass)}`,
      `decRuntimeDecisionEvidence.status=${decRuntimeDecisionEvidence.status}`,
      `decRuntimeDecisionEvidence.gatePass=${String(decRuntimeDecisionEvidence.gatePass)}`,
      `decRuntimeDecisionEvidence.primaryReasonCode=${decRuntimeDecisionEvidence.primaryReasonCode ?? "none"}`,
      `extensionTrancheId=${extensionTrancheId ?? "none"}`,
      `familySearchOrder=${familySearchOrder.join(",") || "none"}`,
      `appliedCandidateEvidence.status=${appliedCandidateEvidence.status}`,
      `appliedCandidateEvidence.familyId=${appliedCandidateEvidence.familyId ?? "none"}`,
      `appliedCandidateEvidence.candidateId=${appliedCandidateEvidence.candidateId ?? "none"}`,
      `rollbackLocalizationEvidence.status=${rollbackLocalizationEvidence.status}`,
      `rollbackLocalizationEvidence.failureMode=${rollbackLocalizationEvidence.failureMode}`,
      `rollbackLocalizationEvidence.primaryReasonCode=${rollbackLocalizationEvidence.primaryReasonCode ?? "none"}`,
      `rollbackLocalizationEvidence.familyId=${rollbackLocalizationEvidence.familyId ?? "none"}`,
      `rollbackLocalizationEvidence.candidateId=${rollbackLocalizationEvidence.candidateId ?? "none"}`,
      `researchSupportMap.claimIds=${Object.keys(researchSupportMap).join(",") || "none"}`,
      `recommendation=${recommendation}`,
    ],
    uncertaintyNotes: [
      "Bounded sweep includes an observer-domain truncation probe (zeta=0) for sensitivity localization only; it is excluded from physical-control admission.",
      nonRegressionGatePass
        ? runtimeApplicationApplied
          ? `Bounded non-truncation coupled same-chart probe (s=${sameChartTensorPhysicsControlProbeScale}, rho_lift=${sameChartTensorDensityLiftProbeFraction}) satisfies DEC-lift and WEC/NEC non-regression gates on the admitted Einstein route and is runtime-applied for this evidence pass.`
          : `Bounded non-truncation coupled same-chart probe (s=${sameChartTensorPhysicsControlProbeScale}, rho_lift=${sameChartTensorDensityLiftProbeFraction}) satisfies DEC-lift and WEC/NEC non-regression gates on the admitted Einstein route; runtime application is still gated by explicit opt-in and revalidation.`
        : `A bounded non-truncation same-chart pressure-scale probe (s=${sameChartTensorPhysicsControlProbeScale}) was evaluated with fixed observer-domain bounds; it lifted DEC but reduced NEC, so baseline hold is retained under strict non-regression policy.`,
      `Refinement evidence status=${refinementEvidence.status}; uncertaintyBoundPass=${refinementEvidence.uncertaintyBoundPass == null ? "null" : String(refinementEvidence.uncertaintyBoundPass)}; coarseStepM=${refinementEvidence.coarseStepM ?? "null"}; refinedStepM=${refinementEvidence.refinedStepM ?? "null"}; superRefinedStepM=${refinementEvidence.superRefinedStepM ?? "null"}.`,
    ],
  };
};

const overrideNhm2ObserverConditionRobustMin = (args: {
  condition: Record<string, unknown> | null | undefined;
  robustMin: number | null;
}): Record<string, unknown> | null => {
  const conditionRecord =
    args.condition != null && typeof args.condition === "object"
      ? { ...args.condition }
      : null;
  const nextRobustMin = toFiniteNumber(args.robustMin);
  if (nextRobustMin == null) {
    return conditionRecord;
  }
  const eulerianMin = toFiniteNumber(conditionRecord?.eulerianMin);
  const robustMinusEulerian =
    eulerianMin != null ? nextRobustMin - eulerianMin : null;
  const baseWorstCase =
    conditionRecord?.worstCase != null &&
    typeof conditionRecord.worstCase === "object"
      ? { ...(conditionRecord.worstCase as Record<string, unknown>) }
      : null;
  return {
    ...(conditionRecord ?? {}),
    robustMin: nextRobustMin,
    robustMean: nextRobustMin,
    robustViolationFraction: nextRobustMin < 0 ? 1 : 0,
    missedViolationFraction:
      eulerianMin != null && eulerianMin >= 0 && nextRobustMin < 0 ? 1 : 0,
    severityGainMin: robustMinusEulerian,
    severityGainMean: robustMinusEulerian,
    maxRobustMinusEulerian: robustMinusEulerian,
    worstCase:
      baseWorstCase != null
        ? {
            ...baseWorstCase,
            value: nextRobustMin,
          }
        : {
            index: 0,
            value: nextRobustMin,
            direction: null,
            rapidity: 0,
            source: "runtime_dec_control_projection",
          },
  };
};

const applyNhm2DecPhysicsRuntimeAppliedTensorConditions = (args: {
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
  decPhysicsControlEvidence: Nhm2ObserverDecPhysicsControlEvidence;
}): {
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
} => {
  if (args.decPhysicsControlEvidence.runtimeApplication.status !== "applied") {
    return {
      metricTensorInput: args.metricTensorInput,
      tileTensorInput: args.tileTensorInput,
    };
  }
  const candidate = args.decPhysicsControlEvidence.candidate;
  const runtimeCandidateId =
    args.decPhysicsControlEvidence.runtimeApplication.candidateId ??
    args.decPhysicsControlEvidence.selectedCandidateId ??
    candidate.candidateId ??
    "unknown_candidate";
  const runtimeComparabilityPass =
    args.decPhysicsControlEvidence.runtimeApplication.comparabilityGate.pass === true;
  const runtimeSignAgreementPass =
    args.decPhysicsControlEvidence.runtimeApplication.guardChecks
      .independentCrossCheckSignAgreement === true;
  const runtimeUncertaintyPass =
    args.decPhysicsControlEvidence.runtimeApplication.guardChecks.uncertaintyBoundPass ===
    true;
  const runtimePublicationAdmissionPass =
    runtimeComparabilityPass && runtimeSignAgreementPass && runtimeUncertaintyPass;
  const metricRuntimeNote = `Runtime-applied DEC control candidate (${runtimeCandidateId}) is projected onto metric_required robust minima for this publication pass.`;
  const tileRuntimeNote = `Runtime-applied DEC control candidate (${runtimeCandidateId}) is projected onto tile_effective robust minima for this publication pass.`;
  const metricConditions =
    args.metricTensorInput.conditions != null &&
    typeof args.metricTensorInput.conditions === "object"
      ? { ...args.metricTensorInput.conditions }
      : {};
  const tileConditions =
    args.tileTensorInput.conditions != null &&
    typeof args.tileTensorInput.conditions === "object"
      ? { ...args.tileTensorInput.conditions }
      : {};
  const metricLimitationNotes = Array.from(
    new Set([...(args.metricTensorInput.model?.limitationNotes ?? []), metricRuntimeNote]),
  );
  const tileLimitationNotes = Array.from(
    new Set([...(args.tileTensorInput.model?.limitationNotes ?? []), tileRuntimeNote]),
  );
  const metricRuntimeAdmissionNote =
    runtimePublicationAdmissionPass
      ? "Runtime publication admission is pass-level: Einstein-route comparability, independent-cross-check sign agreement, and uncertainty guards are all satisfied."
      : "Runtime publication admission is review-level: one or more comparability/sign/uncertainty guards remain non-pass, so conservative limitation notes are retained.";
  const tileRuntimeAdmissionNote = metricRuntimeAdmissionNote;
  const metricModelNote = [args.metricTensorInput.model?.note, metricRuntimeAdmissionNote]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ");
  const tileModelNote = [args.tileTensorInput.model?.note, tileRuntimeAdmissionNote]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ");
  return {
    metricTensorInput: {
      ...args.metricTensorInput,
      conditions: {
        ...metricConditions,
        dec: overrideNhm2ObserverConditionRobustMin({
          condition: metricConditions.dec as Record<string, unknown> | null | undefined,
          robustMin: candidate.metricDecRobustMin,
        }),
        wec: overrideNhm2ObserverConditionRobustMin({
          condition: metricConditions.wec as Record<string, unknown> | null | undefined,
          robustMin: candidate.metricWecRobustMin,
        }),
        nec: overrideNhm2ObserverConditionRobustMin({
          condition: metricConditions.nec as Record<string, unknown> | null | undefined,
          robustMin: candidate.metricNecRobustMin,
        }),
      },
      model: {
        ...(args.metricTensorInput.model ?? {}),
        limitationNotes: runtimePublicationAdmissionPass ? [] : metricLimitationNotes,
        note: metricModelNote || null,
      },
    },
    tileTensorInput: {
      ...args.tileTensorInput,
      conditions: {
        ...tileConditions,
        dec: overrideNhm2ObserverConditionRobustMin({
          condition: tileConditions.dec as Record<string, unknown> | null | undefined,
          robustMin: candidate.tileReconstitutedDecRobustMin,
        }),
        wec: overrideNhm2ObserverConditionRobustMin({
          condition: tileConditions.wec as Record<string, unknown> | null | undefined,
          robustMin: candidate.tileReconstitutedWecRobustMin,
        }),
        nec: overrideNhm2ObserverConditionRobustMin({
          condition: tileConditions.nec as Record<string, unknown> | null | undefined,
          robustMin: candidate.tileReconstitutedNecRobustMin,
        }),
      },
      model: {
        ...(args.tileTensorInput.model ?? {}),
        limitationNotes: runtimePublicationAdmissionPass ? [] : tileLimitationNotes,
        note: tileModelNote || null,
      },
    },
  };
};

const resolveNhm2ObserverNextTechnicalAction = (args: {
  fallbackAction: Nhm2ObserverNextTechnicalAction;
  emissionAdmissionStatus: "admitted" | "not_admitted" | "unknown";
  decRemediationEvidence: Nhm2ObserverDecRemediationEvidence | null;
}): Nhm2ObserverNextTechnicalAction => {
  if (args.emissionAdmissionStatus !== "admitted") {
    return args.fallbackAction;
  }
  const evidence = args.decRemediationEvidence;
  if (evidence == null) {
    return args.fallbackAction;
  }
  if (evidence.recommendedPatchClass === "physics_control_patch") {
    return "targeted_dec_physics_remediation";
  }
  if (evidence.recommendedPatchClass === "model_term_extension_patch") {
    return "extend_model_term_route";
  }
  if (evidence.recommendedPatchClass === "no_admissible_candidate_yet") {
    return "research_basis_gap_review";
  }
  return args.fallbackAction;
};

const deriveNhm2ObserverDecModelTermExtensionPlanEvidence = (args: {
  decRemediationEvidence: Nhm2ObserverDecRemediationEvidence;
  decPhysicsControlEvidence: Nhm2ObserverDecPhysicsControlEvidence;
  recommendedPatchClass: Nhm2ObserverDecRemediationEvidence["recommendedPatchClass"];
}): Nhm2ObserverDecModelTermExtensionPlanEvidence | null => {
  const recommendation = args.recommendedPatchClass;
  const selectedPath =
    args.decPhysicsControlEvidence.selectedPath ??
    args.decRemediationEvidence.selectedPath ??
    null;
  const routeId =
    args.decPhysicsControlEvidence.routeId ?? args.decRemediationEvidence.routeId ?? null;
  const chartRef =
    args.decPhysicsControlEvidence.chartRef ??
    args.decRemediationEvidence.chartRef ??
    null;
  const crossZero = args.decPhysicsControlEvidence.crossZeroFeasibilityEvidence;
  const runtimeDecision = args.decPhysicsControlEvidence.decRuntimeDecisionEvidence;
  const runtimeComparabilityPass =
    runtimeDecision?.comparabilityPass ??
    args.decPhysicsControlEvidence.runtimeApplication.comparabilityGate.pass;
  const semanticOrEmissionNotStable =
    args.decPhysicsControlEvidence.guardChecks.semanticAdmissionStable === false ||
    args.decPhysicsControlEvidence.guardChecks.emissionAdmissionStable === false;
  const trigger: Nhm2ObserverDecModelTermExtensionPlanEvidence["trigger"] =
    recommendation !== "model_term_extension_patch"
      ? "none"
      : semanticOrEmissionNotStable
        ? "semantic_or_emission_not_stable"
        : crossZero.boundedEnvelopeExhausted === true &&
            runtimeComparabilityPass === true
          ? "bounded_envelope_exhausted"
          : crossZero.crossZeroAchieved === false &&
              runtimeComparabilityPass === true
            ? "cross_zero_not_achieved"
            : "unknown";
  const preferredImplementationRoute: Nhm2ObserverDecModelTermExtensionPlanEvidence["preferredImplementationRoute"] =
    selectedPath === "full_einstein_tensor"
      ? "full_einstein_tensor"
      : selectedPath === "adm_complete"
        ? "adm_complete"
        : "unknown";
  const citationRefs = Array.from(
    new Set(
      [
        ...args.decRemediationEvidence.citationRefs,
        ...args.decPhysicsControlEvidence.citationRefs,
        ...crossZero.citationRefs,
        ...(runtimeDecision?.citationRefs ?? []),
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  const notes = [
    `status=${recommendation === "model_term_extension_patch" ? "required" : "not_required"}`,
    `trigger=${trigger}`,
    `selectedPath=${selectedPath ?? "none"}`,
    `routeId=${routeId ?? "none"}`,
    `dominantViolationClass=${args.decRemediationEvidence.dominantViolationClass}`,
    `crossZeroAchieved=${crossZero.crossZeroAchieved == null ? "null" : String(crossZero.crossZeroAchieved)}`,
    `boundedEnvelopeExhausted=${crossZero.boundedEnvelopeExhausted == null ? "null" : String(crossZero.boundedEnvelopeExhausted)}`,
    `runtimeComparabilityPass=${runtimeComparabilityPass == null ? "null" : String(runtimeComparabilityPass)}`,
    `requiredLiftToZero=${crossZero.requiredLiftToZero ?? "null"}`,
    `bestAchievedLift=${crossZero.bestAchievedLift ?? "null"}`,
    `residualMarginToZero=${crossZero.residualMarginToZero ?? "null"}`,
    `gapToZero=${crossZero.gapToZero ?? "null"}`,
  ];
  if (recommendation !== "model_term_extension_patch") {
    return null;
  }
  return {
    status: "required",
    trigger,
    chartRef,
    routeId,
    selectedPath,
    dominantViolationClass: args.decRemediationEvidence.dominantViolationClass,
    requiredLiftToZero: crossZero.requiredLiftToZero,
    bestAchievedLift: crossZero.bestAchievedLift,
    residualMarginToZero: crossZero.residualMarginToZero,
    gapToZero: crossZero.gapToZero,
    preferredImplementationRoute,
    nextPatchClass: recommendation,
    citationRefs,
    notes,
  };
};

const harmonizeNhm2ObserverDecRemediationEvidence = (args: {
  decRemediationEvidence: Nhm2ObserverDecRemediationEvidence;
  decPhysicsControlEvidence: Nhm2ObserverDecPhysicsControlEvidence;
}): Nhm2ObserverDecRemediationEvidence => {
  const recommendation = args.decPhysicsControlEvidence.recommendation;
  const modelTermExtensionPlanEvidence =
    deriveNhm2ObserverDecModelTermExtensionPlanEvidence({
      decRemediationEvidence: args.decRemediationEvidence,
      decPhysicsControlEvidence: args.decPhysicsControlEvidence,
      recommendedPatchClass: recommendation,
    });
  if (
    recommendation !== "model_term_extension_patch" ||
    args.decRemediationEvidence.recommendedPatchClass ===
      "model_term_extension_patch"
  ) {
    return {
      ...args.decRemediationEvidence,
      modelTermExtensionPlanEvidence,
    };
  }
  return {
    ...args.decRemediationEvidence,
    recommendedPatchClass: "model_term_extension_patch",
    modelTermExtensionPlanEvidence,
    notes: Array.from(
      new Set([
        ...args.decRemediationEvidence.notes,
        "recommendedPatchClassOverride=model_term_extension_patch",
        "recommendedPatchClassOverrideReason=bounded_dec_control_envelope_exhausted_with_comparable_non_regression_pass",
      ]),
    ),
  };
};

const deriveNhm2TileObserverConditionAuthorityFromComparabilityEvidence = (
  evidence: Nhm2ObserverTileObserverConditionComparabilityEvidence | null,
): {
  mode: Nhm2ObserverTileObserverConditionAuthorityMode;
  note: string;
} => {
  if (evidence == null) {
    return {
      mode: "legacy_proxy_published",
      note:
        "Legacy tile-proxy observer-condition lane remains authoritative because commensurate comparability evidence is unavailable.",
    };
  }
  const checks = evidence.checks;
  const classificationSupportsAuthority =
    evidence.classification === "proxy_artifact_confirmed" ||
    evidence.classification === "same_surface_failure_confirmed";
  const comparabilityGatePass =
    evidence.status === "pass" &&
    classificationSupportsAuthority &&
    checks.routeComparability === "pass" &&
    checks.independentCrossCheck === "pass" &&
    checks.sampleCountParity === "pass" &&
    checks.rapidityCapParity === "pass" &&
    checks.rapidityCapBetaParity === "pass" &&
    checks.citationCoverage === "pass";
  if (comparabilityGatePass) {
    return {
      mode: "commensurate_reconstituted_authoritative",
      note: `Commensurate observer-condition authority gate passed (${evidence.classification}), so blocker derivation now uses the reconstituted same-chart lane.`,
    };
  }
  return {
    mode: "legacy_proxy_published",
    note:
      "Legacy tile-proxy observer-condition lane remains authoritative because commensurate authority gate is not pass-level.",
  };
};

const buildNhm2TileObserverLegacyProxyDiagnostics = (
  tileProxyTensorInput: BuildNhm2ObserverAuditTensorInput,
  authorityMode: Nhm2ObserverTileObserverConditionAuthorityMode,
): {
  tensorRef: string | null;
  sampleCount: number | null;
  rapidityCap: number | null;
  rapidityCapBeta: number | null;
  wecEulerianMin: number | null;
  wecRobustMin: number | null;
  decEulerianMin: number | null;
  decRobustMin: number | null;
  note: string;
} => ({
  tensorRef: asText(tileProxyTensorInput.tensorRef),
  sampleCount: toFiniteNumber(tileProxyTensorInput.sampleCount),
  rapidityCap: toFiniteNumber(tileProxyTensorInput.rapidityCap),
  rapidityCapBeta: toFiniteNumber(tileProxyTensorInput.rapidityCapBeta),
  wecEulerianMin: toFiniteNumber(
    tileProxyTensorInput.conditions?.wec?.eulerianMin,
  ),
  wecRobustMin: toFiniteNumber(tileProxyTensorInput.conditions?.wec?.robustMin),
  decEulerianMin: toFiniteNumber(
    tileProxyTensorInput.conditions?.dec?.eulerianMin,
  ),
  decRobustMin: toFiniteNumber(tileProxyTensorInput.conditions?.dec?.robustMin),
  note:
    authorityMode === "commensurate_reconstituted_authoritative"
      ? "Legacy tile-proxy diagnostics preserved for provenance while blocker derivation is switched to the commensurate reconstituted lane."
      : "Legacy tile-proxy diagnostics remain authoritative for blocker derivation until commensurate authority gate passes.",
});

const applyNhm2TileObserverConditionAuthority = (args: {
  mode: Nhm2ObserverTileObserverConditionAuthorityMode;
  authorityNote: string;
  metricTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileProxyTensorInput: BuildNhm2ObserverAuditTensorInput;
  comparabilityEvidence: Nhm2ObserverTileObserverConditionComparabilityEvidence | null;
}): BuildNhm2ObserverAuditTensorInput => {
  if (args.mode !== "commensurate_reconstituted_authoritative") {
    return args.tileProxyTensorInput;
  }

  const reconstitutedLane =
    args.comparabilityEvidence?.lanes?.tileEffectiveReconstituted ?? null;
  if (reconstitutedLane == null) {
    return args.tileProxyTensorInput;
  }

  const metricConditions = args.metricTensorInput.conditions ?? {};
  const tileProxyConditions = args.tileProxyTensorInput.conditions ?? {};
  const nextCondition = (
    key: "nec" | "wec" | "sec" | "dec",
  ): Record<string, unknown> | null => {
    const metricCondition = metricConditions[key];
    const proxyCondition = tileProxyConditions[key];
    if (metricCondition != null && typeof metricCondition === "object") {
      return { ...metricCondition };
    }
    if (proxyCondition != null && typeof proxyCondition === "object") {
      return { ...proxyCondition };
    }
    return null;
  };

  const wecCondition = nextCondition("wec");
  const decCondition = nextCondition("dec");

  return {
    ...args.tileProxyTensorInput,
    tensorRef:
      asText(reconstitutedLane.tensorRef) ??
      asText(args.tileProxyTensorInput.tensorRef),
    sampleCount:
      toFiniteNumber(reconstitutedLane.sampleCount) ??
      toFiniteNumber(args.tileProxyTensorInput.sampleCount),
    rapidityCap:
      toFiniteNumber(reconstitutedLane.rapidityCap) ??
      toFiniteNumber(args.tileProxyTensorInput.rapidityCap),
    rapidityCapBeta:
      toFiniteNumber(reconstitutedLane.rapidityCapBeta) ??
      toFiniteNumber(args.tileProxyTensorInput.rapidityCapBeta),
    typeI:
      args.metricTensorInput.typeI != null
        ? { ...args.metricTensorInput.typeI }
        : args.tileProxyTensorInput.typeI != null
          ? { ...args.tileProxyTensorInput.typeI }
          : null,
    conditions: {
      nec: nextCondition("nec"),
      wec: {
        ...(wecCondition ?? {}),
        eulerianMin:
          toFiniteNumber(reconstitutedLane.wecEulerianMin) ??
          toFiniteNumber(wecCondition?.eulerianMin),
        robustMin:
          toFiniteNumber(reconstitutedLane.wecRobustMin) ??
          toFiniteNumber(wecCondition?.robustMin),
      },
      sec: nextCondition("sec"),
      dec: {
        ...(decCondition ?? {}),
        eulerianMin:
          toFiniteNumber(reconstitutedLane.decEulerianMin) ??
          toFiniteNumber(decCondition?.eulerianMin),
        robustMin:
          toFiniteNumber(reconstitutedLane.decRobustMin) ??
          toFiniteNumber(decCondition?.robustMin),
      },
    },
    fluxDiagnostics:
      args.metricTensorInput.fluxDiagnostics != null
        ? { ...args.metricTensorInput.fluxDiagnostics }
        : args.tileProxyTensorInput.fluxDiagnostics != null
          ? { ...args.tileProxyTensorInput.fluxDiagnostics }
          : null,
    consistency:
      args.metricTensorInput.consistency != null
        ? { ...args.metricTensorInput.consistency }
        : args.tileProxyTensorInput.consistency != null
          ? { ...args.tileProxyTensorInput.consistency }
          : null,
    model: {
      ...(args.tileProxyTensorInput.model ?? {}),
      pressureModel: "same_chart_metric_tensor_projection",
      fluxHandling: "same_chart_metric_t0i_projection",
      shearHandling: "same_chart_metric_tij_projection",
      limitationNotes: Array.from(
        new Set([
          ...(args.tileProxyTensorInput.model?.limitationNotes ?? []),
          "Observer-condition blocker derivation now uses the commensurate reconstituted lane after proxy-artifact confirmation.",
        ]),
      ),
      note: `${args.authorityNote} Legacy proxy diagnostics are preserved under tileObserverLegacyProxyDiagnostics.`,
    },
    missingInputs: [],
    upstreamDriverDependencyStatus: "direct_same_surface_driver",
    upstreamDriverNote:
      "tile_effective observer-condition blocker derivation is now anchored to the same-surface commensurate reconstituted lane.",
  };
};

const deriveNhm2TileAuthorityEvidence = (args: {
  modelTermSemanticEvidence: Nhm2ObserverModelTermSemanticAdmissionEvidence;
  metricEmissionAdmissionStatus: "admitted" | "not_admitted" | "unknown";
  metricT0iAdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  metricOffDiagonalAdmissionStatus: Nhm2ObserverMetricComponentAdmissionStatus;
  tileTensorInput: BuildNhm2ObserverAuditTensorInput;
  tileComparableCrossCheckEvidence: Nhm2ObserverTileComparableCrossCheckEvidence;
  tileSurfaceReconstitutionEvidence: Nhm2ObserverTileSurfaceReconstitutionEvidence;
}): Nhm2ObserverTileAuthorityEvidence => {
  const modelChecks = args.modelTermSemanticEvidence.checks;
  const selectedPath =
    args.modelTermSemanticEvidence.closurePathDecision?.selectedPath ?? null;
  const routeId =
    args.modelTermSemanticEvidence.einsteinTensorRouteEvidence?.routeId ??
    args.modelTermSemanticEvidence.routeId ??
    null;
  const routeAdmissionEffectiveAdmitted =
    args.modelTermSemanticEvidence.routeAdmissionEffective === "admitted";
  const fullEinsteinPathSelected = selectedPath === "full_einstein_tensor";
  const routeAdmission: Nhm2ObserverTileAuthorityEvidence["checks"]["routeAdmission"] =
    fullEinsteinPathSelected &&
    routeAdmissionEffectiveAdmitted &&
    modelChecks.fullEinsteinTensorRouteAdmission === "pass"
      ? "pass"
      : modelChecks.fullEinsteinTensorRouteAdmission === "fail" ||
          !fullEinsteinPathSelected ||
          !routeAdmissionEffectiveAdmitted
        ? "fail"
        : "unknown";
  const t0iComparable =
    args.metricT0iAdmissionStatus === "derivable_same_chart_from_existing_state" ||
    args.metricT0iAdmissionStatus === "existing_internal_quantity_not_serialized";
  const offDiagonalComparable =
    args.metricOffDiagonalAdmissionStatus ===
      "derivable_same_chart_from_existing_state" ||
    args.metricOffDiagonalAdmissionStatus ===
      "existing_internal_quantity_not_serialized";
  const fullTensorComponents: Nhm2ObserverTileAuthorityEvidence["checks"]["fullTensorComponents"] =
    args.metricEmissionAdmissionStatus === "admitted" &&
    t0iComparable &&
    offDiagonalComparable
      ? "pass"
      : args.metricEmissionAdmissionStatus === "not_admitted" ||
          args.metricT0iAdmissionStatus === "requires_new_model_term" ||
          args.metricOffDiagonalAdmissionStatus === "requires_new_model_term" ||
          args.metricT0iAdmissionStatus === "basis_or_semantics_ambiguous" ||
          args.metricOffDiagonalAdmissionStatus === "basis_or_semantics_ambiguous"
        ? "fail"
        : "unknown";
  const tileModel = args.tileTensorInput.model ?? {};
  const tileProxyDeclared =
    tileModel.pressureModel === "isotropic_pressure_proxy" ||
    tileModel.shearHandling === "not_modeled_in_proxy" ||
    tileModel.shearHandling === "assumed_zero_from_missing_tij";
  const reconstitutionCoverage = args.tileSurfaceReconstitutionEvidence.componentCoverage;
  const reconstitutionCoveragePass =
    reconstitutionCoverage.t00 === "present_admitted" &&
    reconstitutionCoverage.t0i === "present_admitted" &&
    reconstitutionCoverage.offDiagonalTij === "present_admitted";
  const reconstitutionComparable =
    args.tileSurfaceReconstitutionEvidence.comparabilityStatus === "pass" &&
    (args.tileSurfaceReconstitutionEvidence.localizationResult ===
      "same_sign_confirmed" ||
      args.tileSurfaceReconstitutionEvidence.localizationResult ===
        "proxy_artifact_suspected");
  const reconstitutionFail =
    args.tileSurfaceReconstitutionEvidence.status === "fail" ||
    args.tileSurfaceReconstitutionEvidence.comparabilityStatus === "fail";
  const comparability: Nhm2ObserverTileAuthorityEvidence["checks"]["comparability"] =
    reconstitutionComparable
      ? "pass"
      : reconstitutionFail
        ? "fail"
        : "unknown";
  const fullTensorComponentsFromReconstitution: Nhm2ObserverTileAuthorityEvidence["checks"]["fullTensorComponents"] =
    reconstitutionCoveragePass
      ? "pass"
      : reconstitutionCoverage.t00 === "missing" ||
          reconstitutionCoverage.t0i === "missing" ||
          reconstitutionCoverage.offDiagonalTij === "missing"
        ? "fail"
        : fullTensorComponents;
  const checks: Nhm2ObserverTileAuthorityEvidence["checks"] = {
    routeAdmission,
    fullTensorComponents: fullTensorComponentsFromReconstitution,
    comparability,
    citationCoverage: modelChecks.citationCoverage,
  };
  const pass =
    checks.routeAdmission === "pass" &&
    checks.fullTensorComponents === "pass" &&
    checks.comparability === "pass" &&
    checks.citationCoverage === "pass";
  const fail =
    !pass &&
    Object.values(checks).some((status) => status === "fail");
  const status: Nhm2ObserverTileAuthorityEvidence["status"] = pass
    ? "pass"
    : fail
      ? "fail"
      : "unknown";
  const tileRoute: Nhm2ObserverTileAuthorityEvidence["tileRoute"] = pass
    ? "metric_einstein_tensor_projection"
    : tileProxyDeclared || fail
      ? "proxy_tile_brick"
      : "unknown";
  const rationale =
    status === "pass"
      ? "Tile-effective observer authority is admitted on the same-chart Einstein projection route with matched full-tensor components, commensurate comparability checks, and citation coverage."
      : tileProxyDeclared
      ? "Tile-effective observer authority remains proxy-limited because the published tile tensor path still declares isotropic-pressure/shear-proxy semantics even though the Einstein route is available on the metric-required lane."
        : status === "fail"
          ? "Tile-effective observer authority remains non-admitted because one or more route/component/comparability checks fail."
          : "Tile-effective observer authority remains unresolved pending route/component/comparability disambiguation.";
  const citationRefs = Array.from(
    new Set(
      [
        ...NHM2_MODEL_TERM_CITATION_REFS,
        ...NHM2_MODEL_TERM_REQUIRED_WEB_CITATION_REFS,
        ...args.modelTermSemanticEvidence.citationRefs,
        ...(args.modelTermSemanticEvidence.closurePathDecision?.citationRefs ?? []),
      ].filter((entry) => typeof entry === "string" && entry.length > 0),
    ),
  );
  return {
    status,
    chartRef: args.modelTermSemanticEvidence.chartRef ?? null,
    routeId,
    selectedPath,
    tileRoute,
    checks,
    pass,
    rationale,
    citationRefs,
    notes: [
      `selectedPath=${selectedPath ?? "none"}`,
      `routeId=${routeId ?? "none"}`,
      `routeAdmission=${checks.routeAdmission}`,
      `fullTensorComponents=${checks.fullTensorComponents}`,
      `comparability=${checks.comparability}`,
      `citationCoverage=${checks.citationCoverage}`,
      `tileSurfaceReconstitution.status=${args.tileSurfaceReconstitutionEvidence.status}`,
      `tileSurfaceReconstitution.comparabilityStatus=${args.tileSurfaceReconstitutionEvidence.comparabilityStatus}`,
      `tileSurfaceReconstitution.localizationResult=${args.tileSurfaceReconstitutionEvidence.localizationResult}`,
      `tileSurfaceReconstitution.componentCoverage.t00=${reconstitutionCoverage.t00}`,
      `tileSurfaceReconstitution.componentCoverage.t0i=${reconstitutionCoverage.t0i}`,
      `tileSurfaceReconstitution.componentCoverage.offDiagonalTij=${reconstitutionCoverage.offDiagonalTij}`,
      `metricEmissionAdmissionStatus=${args.metricEmissionAdmissionStatus}`,
      `metricT0iAdmissionStatus=${args.metricT0iAdmissionStatus}`,
      `metricOffDiagonalAdmissionStatus=${args.metricOffDiagonalAdmissionStatus}`,
      `tileModel.pressureModel=${tileModel.pressureModel ?? "unknown"}`,
      `tileModel.fluxHandling=${tileModel.fluxHandling ?? "unknown"}`,
      `tileModel.shearHandling=${tileModel.shearHandling ?? "unknown"}`,
      `tileProxyDeclared=${String(tileProxyDeclared)}`,
      `tileComparableLocalization=${args.tileComparableCrossCheckEvidence.localizationResult}`,
      `tileComparableNextPatchClass=${args.tileComparableCrossCheckEvidence.nextPatchClass}`,
      `authorityStatus=${status}`,
      `authorityPass=${String(pass)}`,
    ],
  };
};

const deriveNhm2TileAuthoritySummaryFromEvidence = (
  evidence: Nhm2ObserverTileAuthorityEvidence,
): {
  status: "full_tensor_authority" | "proxy_limited" | "unknown";
  note: string;
} => {
  if (
    evidence.status === "pass" &&
    evidence.pass &&
    evidence.tileRoute === "metric_einstein_tensor_projection"
  ) {
    return {
      status: "full_tensor_authority",
      note:
        "Tile-effective observer authority is admitted via the same-chart Einstein projection route with pass-level route admission, full-tensor component coverage, comparability, and citation checks.",
    };
  }
  if (evidence.tileRoute === "proxy_tile_brick") {
    return {
      status: "proxy_limited",
      note:
        `Tile-effective observer authority remains proxy-limited (routeAdmission=${evidence.checks.routeAdmission}; fullTensorComponents=${evidence.checks.fullTensorComponents}; comparability=${evidence.checks.comparability}).`,
    };
  }
  return {
    status: "unknown",
    note:
      "Tile-effective observer authority remains unresolved pending explicit route admission and comparability evidence.",
  };
};

const NHM2_TILE_EFFECTIVE_UPSTREAM_DRIVER_REF =
  "gr.matter.stressEnergy.tensorSampledSummaries.global.nhm2_shift_lapse.diagonal_proxy";

const buildTileObserverAuditTensorInput = (
  state: EnergyPipelineState,
  options: {
    tileAuthorityEvidence?: Nhm2ObserverTileAuthorityEvidence | null;
  } = {},
): BuildNhm2ObserverAuditTensorInput => {
  const { warpState, nhm2Active } = resolveNhm2ArtifactContext(state);
  const stressStats = (state.gr?.matter?.stressEnergy ??
    null) as StressEnergyStats | null;
  const fallbackBrick =
    nhm2Active && (stressStats == null || stressStats.observerRobust == null)
      ? buildStressEnergyBrick({
          metricT00: toFiniteNumber((state as any)?.warp?.metricT00) ?? undefined,
          metricT00Ref: asText((state as any)?.warp?.metricT00Ref) ?? undefined,
          metricT00Source:
            asText((state as any)?.warp?.metricT00Source) ??
            asText((state as any)?.warp?.stressEnergySource) ??
            undefined,
          warpFieldType: "nhm2_shift_lapse",
        })
      : null;
  const effectiveStressStats =
    stressStats ?? (fallbackBrick?.stats as StressEnergyStats | null) ?? null;
  const observerRobust = effectiveStressStats?.observerRobust;
  const globalRegion = effectiveStressStats?.tensorSampledSummaries?.regions?.find(
    (region) => region.regionId === "global",
  );
  const tileTensor =
    (nhm2Active
      ? extractNhm2SourceClosureTensor(globalRegion?.tensor)
      : null) ??
    extractNhm2SourceClosureTensor(warpState?.tileEffectiveStressEnergy) ??
    extractNhm2SourceClosureTensor((state as any)?.tileEffectiveStressEnergy);
  const netFlux = Array.isArray(effectiveStressStats?.netFlux)
    ? toFiniteVec3(effectiveStressStats.netFlux, [0, 0, 0])
    : [0, 0, 0];
  const netMagnitude = magnitudeVec3(netFlux);
  const diagonalReady =
    tileTensor?.T00 != null &&
    tileTensor?.T11 != null &&
    tileTensor?.T22 != null &&
    tileTensor?.T33 != null;
  const diagonal =
    diagonalReady && tileTensor != null
      ? buildDiagonalObserverConditions(
          tileTensor.T00 as number,
          tileTensor.T11 as number,
          tileTensor.T22 as number,
          tileTensor.T33 as number,
        )
      : null;
  const authorityEvidence = options.tileAuthorityEvidence ?? null;
  const useMetricEinsteinProjection =
    authorityEvidence?.status === "pass" &&
    authorityEvidence.pass &&
    authorityEvidence.tileRoute === "metric_einstein_tensor_projection";
  const authorityRouteId = authorityEvidence?.routeId ?? "unknown";
  const upstreamDriverRef = nhm2Active
    ? NHM2_TILE_EFFECTIVE_UPSTREAM_DRIVER_REF
    : "warp.tileEffectiveStressEnergy.T00";
  return {
    tensorRef: "warp.tileEffectiveStressEnergy",
    sampleCount: globalRegion?.sampleCount ?? null,
    rapidityCap:
      toFiniteNumber(observerRobust?.rapidityCap) ??
      (diagonalReady ? 2.5 : null),
    rapidityCapBeta:
      toFiniteNumber(observerRobust?.rapidityCapBeta) ??
      (diagonalReady ? Math.tanh(2.5) : null),
    typeI: {
      count:
        toFiniteNumber(observerRobust?.typeI?.count) ??
        (diagonalReady ? 1 : null),
      fraction:
        toFiniteNumber(observerRobust?.typeI?.fraction) ??
        (diagonalReady ? 1 : null),
      tolerance:
        toFiniteNumber(observerRobust?.typeI?.tolerance) ??
        (diagonalReady ? 0 : null),
    },
    conditions: observerRobust
      ? {
          nec: observerRobust.nec,
          wec: observerRobust.wec,
          sec: observerRobust.sec,
          dec: observerRobust.dec,
        }
      : diagonal?.conditions,
    fluxDiagnostics: {
      status:
        observerRobust != null || effectiveStressStats != null
          ? "available"
          : diagonalReady
            ? "unavailable"
            : "unavailable",
      meanMagnitude: toFiniteNumber(effectiveStressStats?.avgFluxMagnitude) ?? null,
      maxMagnitude: null,
      netMagnitude: Number.isFinite(netMagnitude) ? netMagnitude : null,
      netDirection: normalizeVec3OrNull(
        Number.isFinite(netMagnitude) && netMagnitude > 1e-12 ? netFlux : null,
      ),
      note:
        observerRobust != null || effectiveStressStats != null
          ? "Flux diagnostics come from the tile-effective brick S_i channels."
          : diagonalReady
            ? "Tile-effective tensor fell back to diagonal-only observer audit; flux direction diagnostics were unavailable because S_i channels were not emitted."
            : "Tile-effective observer diagnostics were not emitted by the GR matter brick.",
    },
    consistency: observerRobust
      ? {
          robustNotGreaterThanEulerian:
            observerRobust.consistency?.robustNotGreaterThanEulerian,
          maxRobustMinusEulerian:
            toFiniteNumber(observerRobust.consistency?.maxRobustMinusEulerian) ?? null,
        }
      : diagonal?.consistency,
    model: {
      pressureModel:
        useMetricEinsteinProjection
          ? "same_chart_metric_tensor_projection"
          : observerRobust != null || effectiveStressStats != null
            ? "isotropic_pressure_proxy"
            : diagonalReady
              ? "diagonal_tensor_components"
              : "isotropic_pressure_proxy",
      fluxHandling:
        useMetricEinsteinProjection
          ? "same_chart_metric_t0i_projection"
          : observerRobust != null || effectiveStressStats != null
            ? "voxel_flux_field"
            : "missing_t0i_flux_channels",
      shearHandling:
        useMetricEinsteinProjection
          ? "same_chart_metric_tij_projection"
          : observerRobust != null || effectiveStressStats != null
            ? "not_modeled_in_proxy"
            : "assumed_zero_from_missing_tij",
      limitationNotes:
        useMetricEinsteinProjection
          ? []
          : observerRobust != null || effectiveStressStats != null
            ? [
                "Tile-effective observer audit uses the brick isotropic-pressure proxy (p = pressureFactor * rho).",
                "Voxel flux S_i is resolved, but anisotropic pressure/shear terms are not promoted as full tensor truth in this artifact.",
              ]
            : [
                "Tile-effective tensor fell back to a diagonal-only observer audit because GR brick flux diagnostics were unavailable.",
                "This fallback does not supply flux magnitude search over T0i terms.",
              ],
      note:
        useMetricEinsteinProjection
          ? `Tile-effective observer authority is promoted to same-chart Einstein projection (route=${authorityRouteId}) while preserving emitted tile observer condition values.`
          : typeof warpState?.tileEffectiveStressSource === "string"
          ? `Tile-effective tensor source: ${String(warpState.tileEffectiveStressSource)}`
          : observerRobust != null || effectiveStressStats != null
            ? "Tile-effective observer audit comes from the GR matter brick surrogate."
            : "Tile-effective observer audit used the emitted diagonal tensor fallback.",
    },
    missingInputs:
      useMetricEinsteinProjection
        ? []
        : observerRobust != null
          ? []
          : diagonalReady
            ? ["tile_t0i_flux_channels_missing"]
            : ["tile_observer_diagnostics_missing"],
    upstreamDriverRef,
    upstreamDriverClass: useMetricEinsteinProjection
      ? "tile_t00_density"
      : "tile_energy_density_proxy",
    upstreamDriverDependencyStatus: useMetricEinsteinProjection
      ? "direct_same_surface_driver"
      : "proxy_derived_driver",
    upstreamDriverNote:
      useMetricEinsteinProjection
        ? `tile_effective WEC remains localized on the emitted tile tensor surface with Einstein-route authority evidence (route=${authorityRouteId}).`
        : "tile_effective WEC traces to the emitted tile energy-density proxy surface rather than a full flux/shear-resolved tensor.",
    firstUpstreamRemediationTarget: upstreamDriverRef,
    firstUpstreamRemediationWhy:
      useMetricEinsteinProjection
        ? "Inspect the emitted tile tensor surface and Einstein-route authority evidence because tile_effective WEC negativity remains the primary blocker."
        : "Inspect the emitted tile energy-density proxy because tile_effective WEC negativity is inherited from that published proxy surface.",
  };
};

const resolveNhm2ArtifactContext = (state: EnergyPipelineState) => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  const adapter = (warpState?.metricAdapter ?? null) as WarpMetricAdapterSnapshot | null;
  const metricT00Ref = asText(warpState?.metricT00Ref);
  const metricFamily =
    adapter?.family ??
    (metricT00Ref ? resolveMetricFamilyFromRef(metricT00Ref, adapter ?? undefined) : "unknown");
  const nhm2Active =
    metricFamily === "nhm2_shift_lapse" ||
    (state as any)?.warpFieldType === "nhm2_shift_lapse" ||
    (state.dynamicConfig as any)?.warpFieldType === "nhm2_shift_lapse";
  return { warpState, adapter, metricT00Ref, metricFamily, nhm2Active };
};

const NHM2_TS_MISSING_SOURCE_CODES = new Set([
  "timing_missing",
  "hull_missing",
  "metric_adapter_missing",
  "chart_unknown",
  "gamma_diag_missing",
]);

const resolveNhm2ThetaStrictSignalInput = (state: EnergyPipelineState) => {
  const thetaMetricDerived =
    typeof (state as any).theta_metric_derived === "boolean"
      ? Boolean((state as any).theta_metric_derived)
      : null;
  const thetaMetricSource = asText((state as any).theta_metric_source);
  const thetaSource =
    thetaMetricDerived === true
      ? thetaMetricSource
      : asText((state as any).theta_source) ?? asText((state as any).theta_proxy_source);
  const reasonCode =
    thetaMetricDerived === true
      ? null
      : asText((state as any).theta_metric_reason) ??
        (thetaSource == null ? "missing_theta_geom" : "theta_geom_proxy");
  const provenance: Nhm2StrictSignalReadinessProvenance =
    thetaMetricDerived === true
      ? "metric"
      : thetaSource != null
        ? "proxy"
        : "missing";
  return {
    metricDerived: thetaMetricDerived,
    provenance,
    sourcePath: thetaSource,
    reasonCode,
    reason: reasonCode,
  };
};

const resolveNhm2TsStrictSignalInput = (state: EnergyPipelineState) => {
  const tsMetricDerived =
    typeof state.tsMetricDerived === "boolean" ? Boolean(state.tsMetricDerived) : null;
  const tsSourceRaw = asText(state.tsMetricDerivedSource);
  const sourceMissing =
    tsSourceRaw == null || NHM2_TS_MISSING_SOURCE_CODES.has(tsSourceRaw);
  const provenance: Nhm2StrictSignalReadinessProvenance =
    tsMetricDerived === true
      ? "metric"
      : sourceMissing
        ? "missing"
        : "proxy";
  return {
    metricDerived: tsMetricDerived,
    provenance,
    sourcePath: provenance === "proxy" || tsMetricDerived === true ? tsSourceRaw : null,
    reasonCode: tsMetricDerived === true ? null : tsSourceRaw ?? "timing_missing",
    reason:
      tsMetricDerived === true ? null : asText(state.tsMetricDerivedReason),
  };
};

const resolveNhm2QiStrictSignalInput = (state: EnergyPipelineState) => {
  const qiGuard =
    ((state as any).qiGuardrail &&
    typeof (state as any).qiGuardrail === "object"
      ? (state as any).qiGuardrail
      : null) as Record<string, unknown> | null;
  const metricDerived =
    typeof qiGuard?.metricDerived === "boolean"
      ? Boolean(qiGuard.metricDerived)
      : null;
  const rhoSource = asText(qiGuard?.rhoSource);
  const sourceRaw = asText(qiGuard?.metricDerivedSource) ?? rhoSource;
  const sourceMissing =
    sourceRaw == null || sourceRaw === "unknown" || sourceRaw === "metric-missing";
  const provenance: Nhm2StrictSignalReadinessProvenance =
    metricDerived === true
      ? "metric"
      : sourceMissing
        ? "missing"
        : "proxy";
  const reasonCode =
    metricDerived === true
      ? null
      : asText(qiGuard?.metricDerivedReason) ??
        (sourceMissing ? "strict_signal_missing" : "insufficient_provenance");
  return {
    metricDerived,
    provenance,
    sourcePath: provenance === "proxy" || metricDerived === true ? sourceRaw : null,
    rhoSource,
    reasonCode,
    reason: metricDerived === true ? null : asText(qiGuard?.metricDerivedReason) ?? reasonCode,
    applicabilityStatus: asText(qiGuard?.applicabilityStatus),
    applicabilityReasonCode: asText(qiGuard?.applicabilityReasonCode),
  };
};

const refreshNhm2QeiWorldlineDossier = (state: EnergyPipelineState): void => {
  const { warpState, adapter, nhm2Active } = resolveNhm2ArtifactContext(state);

  if (!nhm2Active) {
    delete state.nhm2QeiWorldlineDossier;
    return;
  }

  const qiGuard =
    ((state as any).qiGuardrail &&
    typeof (state as any).qiGuardrail === "object"
      ? (state as any).qiGuardrail
      : null) as Record<string, unknown> | null;
  state.nhm2QeiWorldlineDossier = buildNhm2QeiWorldlineDossierFromGuardrail({
    generatedAt: new Date().toISOString(),
    laneId: "nhm2_shift_lapse",
    selectedProfileId:
      asText((adapter?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
      asText(warpState?.shiftLapseProfileId) ??
      "runtime",
    chartId: asText(adapter?.chart?.label) ?? "unknown",
    qiGuardrail: qiGuard,
  });
};

const asPlainRecord = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const pickFiniteScalar = (value: unknown): number | null => {
  const direct = toFiniteNumber(value);
  if (direct != null) return direct;
  const record = asPlainRecord(value);
  if (record == null) return null;
  for (const key of ["value", "mean", "p98", "max", "maxAbs", "rms"] as const) {
    const picked = toFiniteNumber(record[key]);
    if (picked != null) return picked;
  }
  return null;
};

const firstFiniteRecordScalar = (
  records: Array<Record<string, unknown> | null | undefined>,
  keys: readonly string[],
): number | null => {
  for (const record of records) {
    if (record == null) continue;
    for (const key of keys) {
      const value = pickFiniteScalar(record[key]);
      if (value != null) return value;
    }
  }
  return null;
};

const firstTextRecordValue = (
  records: Array<Record<string, unknown> | null | undefined>,
  keys: readonly string[],
): string | null => {
  for (const record of records) {
    if (record == null) continue;
    for (const key of keys) {
      const value = asText(record[key]);
      if (value != null) return value;
    }
  }
  return null;
};

const normalizeNatarioThetaStatus = (
  value: unknown,
): Nhm2NatarioThetaFlatnessStatus | null => {
  const normalized = asText(value)?.toLowerCase();
  if (normalized === "pass" || normalized === "fail" || normalized === "missing") {
    return normalized;
  }
  return null;
};

const normalizeNatarioConvergenceStatus = (
  value: unknown,
): Nhm2NatarioConvergenceStatus | null => {
  const normalized = asText(value)?.toLowerCase();
  if (
    normalized === "pass" ||
    normalized === "fail" ||
    normalized === "missing" ||
    normalized === "not_run"
  ) {
    return normalized;
  }
  return null;
};

const finiteSameChartAuditComponent = (
  artifact: Nhm2SameChartFullTensorArtifactV1 | undefined,
  componentId: Nhm2SameChartFullTensorComponentId,
): number | null => {
  const component = artifact?.components.find(
    (entry) => entry.componentId === componentId,
  );
  if (component == null || !isNhm2SameChartCompleteStatus(component.status)) {
    return null;
  }
  return toFiniteNumberOrNull(component.valueSI);
};

const refreshNhm2NatarioInvariantAudit = (state: EnergyPipelineState): void => {
  const { warpState, adapter, metricFamily, nhm2Active } =
    resolveNhm2ArtifactContext(state);

  if (!nhm2Active) {
    delete state.nhm2NatarioInvariantAudit;
    return;
  }

  const betaDiagnostics = asPlainRecord(adapter?.betaDiagnostics);
  const lowExpansionGate =
    asPlainRecord((state as any).shiftLapseTransportPromotionGate) ??
    asPlainRecord(warpState?.shiftLapseTransportPromotionGate);
  const thetaMaxAbsRaw = firstFiniteRecordScalar(
    [
      betaDiagnostics,
      lowExpansionGate,
      asPlainRecord((state as any).thetaDiagnostics),
      asPlainRecord((state as any).warp?.thetaDiagnostics),
    ],
    ["thetaMaxAbs", "thetaMax", "theta_max_abs", "theta_abs_max", "theta"],
  );
  const expansionLeakageBound = firstFiniteRecordScalar(
    [
      betaDiagnostics,
      lowExpansionGate,
      asPlainRecord((state as any).thetaDiagnostics),
      asPlainRecord((state as any).warp?.thetaDiagnostics),
    ],
    ["expansionLeakageBound", "thetaTolerance", "divergenceTolerance", "tolerance"],
  );
  const thetaFlatnessStatus =
    normalizeNatarioThetaStatus(lowExpansionGate?.authoritativeLowExpansionStatus) ??
    normalizeNatarioThetaStatus(lowExpansionGate?.thetaKConsistencyStatus) ??
    normalizeNatarioThetaStatus(betaDiagnostics?.thetaFlatnessStatus) ??
    null;

  const gr = asPlainRecord((state as any).gr);
  const grStats = asPlainRecord(gr?.stats);
  const grInvariants = asPlainRecord(gr?.invariants);
  const extraChannels = asPlainRecord(gr?.extraChannels);
  const invariantRecords = [
    asPlainRecord((state as any).invariants),
    asPlainRecord((state as any).grInvariantStats),
    grInvariants,
    grStats,
    extraChannels,
    asPlainRecord(warpState?.metricStressDiagnostics),
    asPlainRecord(asPlainRecord(warpState?.metricStressDiagnostics)?.invariants),
    asPlainRecord((adapter as Record<string, unknown> | null | undefined)?.invariants),
  ];
  const ricciScalar = firstFiniteRecordScalar(invariantRecords, [
    "ricciScalar",
    "ricci4",
    "ricci4_mean",
    "gr_ricci4_mean",
    "R4_mean",
    "ricciInvariant",
  ]);
  const kretschmannScalar = firstFiniteRecordScalar(invariantRecords, [
    "kretschmannScalar",
    "kretschmann",
    "kretschmann_mean",
    "gr_kretschmann_mean",
    "K_mean",
  ]);
  const weylScalarProxy = firstFiniteRecordScalar(invariantRecords, [
    "weylScalarProxy",
    "weylScalar",
    "weylI",
    "weylI_mean",
    "weyl_mean",
  ]);
  const petrovClass = firstTextRecordValue(invariantRecords, [
    "petrovClass",
    "petrov_class",
  ]);

  const metricStress =
    asPlainRecord(warpState?.metricStressEnergy) ??
    asPlainRecord(warpState?.stressEnergyTensor);
  const Jx =
    finiteSameChartAuditComponent(state.nhm2SameChartFullTensor, "T0x") ??
    firstFiniteRecordScalar([metricStress], ["T0x", "T01", "T10"]);
  const Jy =
    finiteSameChartAuditComponent(state.nhm2SameChartFullTensor, "T0y") ??
    firstFiniteRecordScalar([metricStress], ["T0y", "T02", "T20"]);
  const Jz =
    finiteSameChartAuditComponent(state.nhm2SameChartFullTensor, "T0z") ??
    firstFiniteRecordScalar([metricStress], ["T0z", "T03", "T30"]);

  const stabilityRecords = [
    asPlainRecord((state as any).stability),
    asPlainRecord((state as any).grStability),
    asPlainRecord(gr?.stability),
    asPlainRecord(gr?.meta),
    asPlainRecord(warpState?.stability),
  ];
  const tidalMax = firstFiniteRecordScalar(stabilityRecords, [
    "tidalMax",
    "tidal_max",
    "tidalMaxAbs",
    "tidal_max_abs",
  ]);
  const blueshiftMax = firstFiniteRecordScalar(
    [
      ...stabilityRecords,
      lowExpansionGate,
      asPlainRecord((state as any).warpMechanics),
    ],
    ["blueshiftMax", "blueshift_max", "betaOverAlphaMax", "beta_over_alpha_max"],
  );
  const convergenceStatus =
    normalizeNatarioConvergenceStatus(firstTextRecordValue(stabilityRecords, [
      "convergenceStatus",
      "meshConvergenceStatus",
      "curvatureConvergenceStatus",
    ])) ?? "not_run";

  state.nhm2NatarioInvariantAudit = buildNhm2NatarioInvariantAudit({
    generatedAt: new Date().toISOString(),
    laneId: "nhm2_shift_lapse",
    selectedProfileId:
      asText((adapter?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
      asText(warpState?.shiftLapseProfileId) ??
      "runtime",
    metricFamily:
      metricFamily === "natario" || metricFamily === "natario_sdf"
        ? "natario_zero_expansion"
        : metricFamily,
    expansion: {
      thetaMaxAbs: thetaMaxAbsRaw == null ? null : Math.abs(thetaMaxAbsRaw),
      thetaFlatnessStatus,
      expansionLeakageBound,
    },
    invariants: {
      ricciScalar,
      kretschmannScalar,
      weylScalarProxy,
      petrovClass,
    },
    momentumDensity: {
      Jx,
      Jy,
      Jz,
    },
    stability: {
      tidalMax,
      blueshiftMax,
      convergenceStatus,
    },
  });
};

const refreshNhm2SourceClosure = (state: EnergyPipelineState): void => {
  const { warpState, adapter, metricT00Ref, nhm2Active } =
    resolveNhm2ArtifactContext(state);

  if (!nhm2Active) {
    delete state.nhm2SourceClosure;
    delete state.nhm2SourceSideSameBasisTensorAuthority;
    delete state.nhm2WallSourceClosure;
    return;
  }

  const metricRequiredTensor =
    extractNhm2SourceClosureTensor(warpState?.metricStressEnergy) ??
    extractNhm2SourceClosureTensor(
      warpState?.metricT00Source === "metric" || warpState?.stressEnergySource === "metric"
        ? warpState?.stressEnergyTensor
        : null,
    );
  const { tileEffectiveTensor, tileEffectiveTensorRef } =
    resolveNhm2SourceClosureTileEffectiveTensor(state);
  const metricTensorRef =
    metricRequiredTensor != null
      ? metricT00Ref ?? "warp.metricStressEnergy"
      : "warp.metricStressEnergy";
  const regionComparisons = collectNhm2SourceClosureRegionComparisons(
    state,
    metricTensorRef,
  );

  const sourceClosure = buildNhm2SourceClosureArtifactV2({
    generatedAt: new Date().toISOString(),
    laneId: "nhm2_shift_lapse",
    selectedProfileId:
      asText((adapter?.lapseSummary as Record<string, unknown> | undefined)?.shiftLapseProfileId) ??
      asText(warpState?.shiftLapseProfileId) ??
      "runtime",
    chartId: asText(adapter?.chart?.label) ?? "unknown",
    metricTensorRef,
    tileEffectiveTensorRef,
    metricRequiredTensor,
    tileEffectiveTensor,
    requiredRegionIds: [...REQUIRED_NHM2_SOURCE_CLOSURE_REGION_IDS],
    regionComparisons,
    casimirMaterialReceipt: state.casimirMaterialReceipt ?? null,
    toleranceRelLInf: resolveNhm2SourceClosureTolerance(),
    scalarCl3RhoDeltaRel:
      Number.isFinite(state.rho_delta_metric_mean) ? Number(state.rho_delta_metric_mean) : null,
  });
  const sourceSideSameBasisTensorAuthority =
    buildNhm2SourceSideSameBasisTensorAuthorityArtifact({
      generatedAt: sourceClosure.wallSourceClosure.generatedAt,
      laneId: "nhm2_shift_lapse",
      selectedProfileId: sourceClosure.wallSourceClosure.selectedProfileId,
      chartId: sourceClosure.wallSourceClosure.chartId,
      sourceModelId: "nhm2_source_closure_region_projection",
      sourceClosureRegions: sourceClosure.regionComparisons.regions,
      requiredRegionIds: [...REQUIRED_NHM2_SOURCE_CLOSURE_REGION_IDS],
      casimirMaterialReceipt: state.casimirMaterialReceipt ?? null,
    });
  state.nhm2SourceClosure = sourceClosure;
  state.nhm2SourceSideSameBasisTensorAuthority =
    sourceSideSameBasisTensorAuthority;
  state.nhm2WallSourceClosure = sourceClosure.wallSourceClosure;
};

const refreshNhm2ObserverAudit = (state: EnergyPipelineState): void => {
  const { nhm2Active } = resolveNhm2ArtifactContext(state);

  if (!nhm2Active) {
    delete state.nhm2ObserverAudit;
    delete state.nhm2ObserverRobustEnergyConditions;
    delete state.nhm2SameChartFullTensor;
    return;
  }

  const initialMetricRequired = buildDiagonalMetricObserverAuditTensorInput(state);
  const provisionalMetricProducerEvidence =
    deriveNhm2MetricProducerAdmissionEvidence(
      state,
      initialMetricRequired,
      null,
    );
  const provisionalModelTermSemanticEvidence =
    deriveNhm2ModelTermSemanticAdmissionEvidence({
      state,
      producerEvidence: provisionalMetricProducerEvidence,
      metricRequiredTensorInput: initialMetricRequired,
    });
  const metricProducerAdmissionEvidence = deriveNhm2MetricProducerAdmissionEvidence(
    state,
    initialMetricRequired,
    provisionalModelTermSemanticEvidence,
  );
  const modelTermSemanticAdmissionEvidence =
    deriveNhm2ModelTermSemanticAdmissionEvidence({
      state,
      producerEvidence: metricProducerAdmissionEvidence,
      metricRequiredTensorInput: initialMetricRequired,
    });
  const metricAdmissionSummary = deriveNhm2MetricAdmissionSummaryFromEvidence({
    evidence: metricProducerAdmissionEvidence,
    modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
  });
  const metricRequired = buildDiagonalMetricObserverAuditTensorInput(state, {
    t00Selection: {
      admissionStatus: metricAdmissionSummary.t00AdmissionStatus,
      routeId: metricAdmissionSummary.t00RouteId,
      comparabilityStatus: metricAdmissionSummary.t00ComparabilityStatus,
      note: metricAdmissionSummary.t00AdmissionNote,
    },
  });
  const provisionalTileEffective = buildTileObserverAuditTensorInput(state);
  const tileComparableCrossCheckEvidence =
    deriveNhm2TileComparableCrossCheckEvidence({
      modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
      metricTensorInput: metricRequired,
      tileTensorInput: provisionalTileEffective,
    });
  const tileSurfaceReconstitutionEvidence =
    deriveNhm2TileSurfaceReconstitutionEvidence({
      modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
      metricEmissionAdmissionStatus: metricAdmissionSummary.emissionAdmissionStatus,
      metricT0iAdmissionStatus: metricAdmissionSummary.t0iAdmissionStatus,
      metricOffDiagonalAdmissionStatus:
        metricAdmissionSummary.offDiagonalAdmissionStatus,
      metricTensorInput: metricRequired,
      tileTensorInput: provisionalTileEffective,
      tileComparableCrossCheckEvidence,
    });
  const tileObserverConditionComparabilityEvidence =
    deriveNhm2TileObserverConditionComparabilityEvidence({
      modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
      metricTensorInput: metricRequired,
      tileTensorInput: provisionalTileEffective,
      tileComparableCrossCheckEvidence,
      tileSurfaceReconstitutionEvidence,
    });
  const tileObserverConditionAuthority =
    deriveNhm2TileObserverConditionAuthorityFromComparabilityEvidence(
      tileObserverConditionComparabilityEvidence,
    );
  const tileObserverLegacyProxyDiagnostics =
    buildNhm2TileObserverLegacyProxyDiagnostics(
      provisionalTileEffective,
      tileObserverConditionAuthority.mode,
    );
  const tileAuthorityEvidence = deriveNhm2TileAuthorityEvidence({
    modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
    metricEmissionAdmissionStatus: metricAdmissionSummary.emissionAdmissionStatus,
    metricT0iAdmissionStatus: metricAdmissionSummary.t0iAdmissionStatus,
    metricOffDiagonalAdmissionStatus:
      metricAdmissionSummary.offDiagonalAdmissionStatus,
    tileTensorInput: provisionalTileEffective,
    tileComparableCrossCheckEvidence,
    tileSurfaceReconstitutionEvidence,
  });
  const tileAuthoritySummary =
    deriveNhm2TileAuthoritySummaryFromEvidence(tileAuthorityEvidence);
  const tileEffectiveProxy = buildTileObserverAuditTensorInput(state, {
    tileAuthorityEvidence,
  });
  const tileEffective = applyNhm2TileObserverConditionAuthority({
    mode: tileObserverConditionAuthority.mode,
    authorityNote: tileObserverConditionAuthority.note,
    metricTensorInput: metricRequired,
    tileProxyTensorInput: tileEffectiveProxy,
    comparabilityEvidence: tileObserverConditionComparabilityEvidence,
  });
  const observerDecRemediationEvidence = deriveNhm2ObserverDecRemediationEvidence({
    modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
    metricTensorInput: metricRequired,
    tileTensorInput: tileEffective,
    tileComparableCrossCheckEvidence,
    tileObserverConditionComparabilityEvidence,
    tileObserverConditionAuthorityMode: tileObserverConditionAuthority.mode,
  });
  const observerDecPhysicsControlEvidence =
    deriveNhm2ObserverDecPhysicsControlEvidence({
      modelTermSemanticEvidence: modelTermSemanticAdmissionEvidence,
      decRemediationEvidence: observerDecRemediationEvidence,
      metricTensorInput: metricRequired,
      tileTensorInput: tileEffective,
      tileObserverConditionComparabilityEvidence,
      emissionAdmissionStatus: metricAdmissionSummary.emissionAdmissionStatus,
    });
  const observerDecRemediationEvidenceFinal =
    harmonizeNhm2ObserverDecRemediationEvidence({
      decRemediationEvidence: observerDecRemediationEvidence,
      decPhysicsControlEvidence: observerDecPhysicsControlEvidence,
    });
  const runtimeAppliedTensorProjection =
    applyNhm2DecPhysicsRuntimeAppliedTensorConditions({
      metricTensorInput: metricRequired,
      tileTensorInput: tileEffective,
      decPhysicsControlEvidence: observerDecPhysicsControlEvidence,
    });
  const observerNextTechnicalAction = resolveNhm2ObserverNextTechnicalAction({
    fallbackAction: metricAdmissionSummary.nextTechnicalAction,
    emissionAdmissionStatus: metricAdmissionSummary.emissionAdmissionStatus,
    decRemediationEvidence: observerDecRemediationEvidenceFinal,
  });
  const sameChartFullTensor = buildNhm2SameChartFullTensorFromState({
    state,
    metricAdmissionSummary,
    metricProducerAdmissionEvidence,
    modelTermSemanticAdmissionEvidence,
    metricTensorInput: metricRequired,
  });
  state.nhm2SameChartFullTensor = sameChartFullTensor;
  state.nhm2ObserverAudit = buildNhm2ObserverAuditArtifact({
    familyId: "nhm2_shift_lapse",
    metricRequired: runtimeAppliedTensorProjection.metricTensorInput,
    tileEffective: runtimeAppliedTensorProjection.tileTensorInput,
    observerMetricCoverageBlockerStatus:
      metricAdmissionSummary.coverageBlockerStatus,
    observerMetricCoverageBlockerNote: metricAdmissionSummary.coverageBlockerNote,
    observerMetricFirstMissingStage: metricAdmissionSummary.firstMissingStage,
    observerMetricEmissionAdmissionStatus:
      metricAdmissionSummary.emissionAdmissionStatus,
    observerMetricEmissionAdmissionNote:
      metricAdmissionSummary.emissionAdmissionNote,
    observerMetricT00AdmissionStatus: metricAdmissionSummary.t00AdmissionStatus,
    observerMetricT00RouteId: metricAdmissionSummary.t00RouteId,
    observerMetricT00ComparabilityStatus:
      metricAdmissionSummary.t00ComparabilityStatus,
    observerMetricT00AdmissionNote: metricAdmissionSummary.t00AdmissionNote,
    observerMetricT0iAdmissionStatus: metricAdmissionSummary.t0iAdmissionStatus,
    observerMetricT0iAdmissionNote: metricAdmissionSummary.t0iAdmissionNote,
    observerMetricOffDiagonalTijAdmissionStatus:
      metricAdmissionSummary.offDiagonalAdmissionStatus,
    observerMetricOffDiagonalTijAdmissionNote:
      metricAdmissionSummary.offDiagonalAdmissionNote,
    observerTileAuthorityStatus: tileAuthoritySummary.status,
    observerTileAuthorityNote: tileAuthoritySummary.note,
    observerNextTechnicalAction,
    metricProducerAdmissionEvidence,
    modelTermSemanticAdmissionEvidence,
    observerDecRemediationEvidence: observerDecRemediationEvidenceFinal,
    observerDecPhysicsControlEvidence,
    t00PolicyAdmissionBridgeEvidence:
      metricAdmissionSummary.t00PolicyAdmissionBridgeEvidence,
    tileAuthorityEvidence,
    tileComparableCrossCheckEvidence,
    tileSurfaceReconstitutionEvidence,
    tileObserverConditionComparabilityEvidence,
    tileObserverConditionAuthorityMode: tileObserverConditionAuthority.mode,
    tileObserverConditionAuthorityNote: tileObserverConditionAuthority.note,
    tileObserverLegacyProxyDiagnostics,
    sameChartFullTensor,
  });
  state.nhm2ObserverRobustEnergyConditions =
    state.nhm2ObserverAudit.observerRobustEnergyConditions ?? undefined;
};

const refreshNhm2StrictSignalReadiness = (state: EnergyPipelineState): void => {
  const { warpState, adapter, nhm2Active } = resolveNhm2ArtifactContext(state);

  if (!nhm2Active) {
    delete state.nhm2StrictSignalReadiness;
    return;
  }

  state.nhm2StrictSignalReadiness = buildNhm2StrictSignalReadinessArtifact({
    familyId: "nhm2_shift_lapse",
    familyAuthorityStatus:
      asText(adapter?.familyAuthorityStatus) ?? asText(warpState?.familyAuthorityStatus),
    transportCertificationStatus:
      asText(adapter?.transportCertificationStatus) ??
      asText(warpState?.transportCertificationStatus),
    lapseSummary:
      (warpState?.lapseSummary as Record<string, unknown> | null | undefined) ??
      (adapter?.lapseSummary as Record<string, unknown> | null | undefined) ??
      null,
    strictModeEnabled: strictCongruenceEnabled(),
    theta: resolveNhm2ThetaStrictSignalInput(state),
    ts: resolveNhm2TsStrictSignalInput(state),
    qi: resolveNhm2QiStrictSignalInput(state),
  });
};

const refreshCl3Telemetry = (state: EnergyPipelineState): void => {
  const strict = strictCongruenceEnabled();
  const missingParts: string[] = [];
  const grConstraint = state.gr?.constraints?.rho_constraint;
  const metricConstraint = state.metricConstraint?.rho_constraint;
  const rhoConstraint = grConstraint ?? metricConstraint;
  const rhoConstraintMean = firstFinite(rhoConstraint?.mean);
  const rhoConstraintSource = grConstraint
    ? "gr.rho_constraint"
    : metricConstraint
      ? state.metricConstraint?.source
        ? `metricConstraint:${state.metricConstraint.source}`
        : "metricConstraint"
      : undefined;

  const metricDebug: EffectiveRhoDebug = {};
  const metricRhoSi = resolveMetricRhoFromState(state, metricDebug, {
    allowConstraintFallback: false,
  });
  const metricSource = metricDebug.source;
  const metricRhoGeom =
    metricRhoSi != null ? metricRhoSi * SI_TO_GEOM_STRESS : undefined;

  const pipelineRhoAvg = firstFinite(state.rho_avg);
  const pipelineRhoAvgGeom =
    pipelineRhoAvg != null ? pipelineRhoAvg * SI_TO_GEOM_STRESS : undefined;

  const deltaMetric =
    rhoConstraintMean != null && metricRhoGeom != null
      ? relDelta(rhoConstraintMean, metricRhoGeom)
      : undefined;
  const deltaPipeline =
    rhoConstraintMean != null && pipelineRhoAvgGeom != null
      ? relDelta(rhoConstraintMean, pipelineRhoAvgGeom)
      : undefined;

  const warpState = (state as any).warp as Record<string, any> | undefined;
  const metricContractStatus =
    (warpState as any)?.metricT00Contract?.status ??
    (warpState as any)?.metricT00ContractStatus ??
    (state as any)?.natario?.metricT00ContractStatus;
  const metricContractOk =
    typeof metricContractStatus === "string" ? metricContractStatus === "ok" : undefined;

  if (rhoConstraintMean == null) missingParts.push("missing_rho_constraint");
  if (metricRhoGeom == null || !metricSource) missingParts.push("missing_metric_t00");
  if (strict && metricRhoGeom != null && metricContractOk === false) {
    missingParts.push("missing_metric_contract");
  }

  const missingReason = missingParts.length
    ? missingParts.includes("missing_metric_t00")
      ? "metric_source_missing"
      : missingParts.includes("missing_metric_contract")
        ? "metric_contract_missing"
        : "constraint_rho_missing"
    : undefined;

  const gateDelta = deltaMetric;
  const gateSource =
    gateDelta != null
      ? metricSource
      : missingReason === "metric_source_missing"
        ? "metric-missing"
        : missingReason === "metric_contract_missing"
          ? "metric-contract-missing"
          : missingReason === "constraint_rho_missing"
            ? "constraint-missing"
            : "missing_inputs";
  const gatePass = gateDelta != null ? gateDelta <= DEFAULT_CL3_RHO_DELTA_MAX : false;
  const gateReason =
    gateDelta != null
      ? gatePass
        ? "within_threshold"
        : "above_threshold"
      : missingReason ?? "missing_inputs";

  state.rho_constraint = rhoConstraint;
  state.rho_constraint_source = rhoConstraintSource;
  state.rho_delta_metric_mean = deltaMetric;
  state.rho_delta_pipeline_mean = deltaPipeline;
  state.rho_delta_threshold = gateDelta != null ? DEFAULT_CL3_RHO_DELTA_MAX : undefined;
  state.rho_delta_gate = gatePass;
  state.rho_delta_gate_reason = gateReason;
  state.rho_delta_gate_source = gateSource;
  state.rho_delta_missing_parts = missingParts.length ? missingParts : undefined;
};

const refreshThetaAuditFromMetricAdapter = (state: EnergyPipelineState): void => {
  const authoritativeTheta = state.gr?.theta;
  const authoritativeKTrace = state.gr?.kTrace;
  const authoritativeThetaGeomCandidate =
    authoritativeTheta?.mean ??
    (Number.isFinite(authoritativeKTrace?.mean)
      ? -Number(authoritativeKTrace?.mean)
      : undefined);
  const authoritativeThetaGeom =
    Number.isFinite(authoritativeThetaGeomCandidate)
      ? Number(authoritativeThetaGeomCandidate)
      : undefined;
  const authoritativeThetaGeomUsable =
    authoritativeThetaGeom != null &&
    ((typeof authoritativeTheta?.source === "string" &&
      authoritativeTheta.source.length > 0) ||
      (typeof authoritativeKTrace?.source === "string" &&
        authoritativeKTrace.source.length > 0));
  const authoritativeThetaGeomSource = authoritativeThetaGeomUsable
    ? authoritativeTheta?.source === "gr_evolve_brick_theta"
      ? "pipeline.gr.theta.mean"
      : "pipeline.gr.kTrace.mean"
    : undefined;
  const metricBeta = (state as any).warp?.metricAdapter?.betaDiagnostics;
  const projectionThetaGeomCandidate = metricBeta?.thetaMax ?? metricBeta?.thetaRms;
  const projectionThetaGeom =
    Number.isFinite(projectionThetaGeomCandidate)
      ? Number(projectionThetaGeomCandidate)
      : undefined;
  const projectionThetaGeomProxy = metricBeta?.method === "not-computed";
  const projectionThetaGeomUsable =
    projectionThetaGeom != null && !projectionThetaGeomProxy;
  const thetaProxySource =
    (state as any).thetaCal != null
      ? "pipeline.thetaCal"
      : (state as any).thetaScaleExpected != null
        ? "pipeline.thetaScaleExpected"
        : undefined;
  const projectionThetaGeomSource =
    projectionThetaGeom != null
      ? metricBeta?.thetaMax != null
        ? "warp.metricAdapter.betaDiagnostics.thetaMax"
        : "warp.metricAdapter.betaDiagnostics.thetaRms"
      : undefined;
  const thetaGeom = authoritativeThetaGeomUsable
    ? authoritativeThetaGeom
    : projectionThetaGeom;
  const thetaGeomSource = authoritativeThetaGeomUsable
    ? authoritativeThetaGeomSource
    : projectionThetaGeomSource;
  const thetaGeomProxy = authoritativeThetaGeomUsable ? false : projectionThetaGeomProxy;
  const thetaGeomUsable = authoritativeThetaGeomUsable || projectionThetaGeomUsable;
  const thetaProxy = (state as any).thetaCal ?? (state as any).thetaScaleExpected;
  const thetaAudit = thetaGeomUsable ? thetaGeom : thetaProxy;
  const thetaMetricReason = authoritativeThetaGeomUsable
    ? authoritativeTheta?.source === "gr_evolve_brick_theta"
      ? "gr_evolve_brick_theta_mean"
      : "gr_evolve_brick_neg_k_trace_mean"
    : projectionThetaGeomUsable
      ? "metric_adapter_theta_projection"
      : projectionThetaGeom == null
      ? "missing_theta_geom"
      : "theta_geom_proxy";

  (state as any).theta_geom = thetaGeom;
  (state as any).theta_geom_source = thetaGeomSource;
  (state as any).theta_geom_proxy = thetaGeomProxy;
  (state as any).theta_geom_projection = projectionThetaGeom;
  (state as any).theta_geom_projection_source = projectionThetaGeomSource;
  (state as any).theta_geom_projection_proxy = projectionThetaGeomProxy;
  (state as any).theta_proxy = thetaProxy;
  (state as any).theta_proxy_source = thetaProxySource;
  (state as any).theta_audit = thetaAudit;
  (state as any).theta_metric_derived = thetaGeomUsable;
  (state as any).theta_metric_source = thetaGeomUsable ? thetaGeomSource : undefined;
  (state as any).theta_metric_reason = thetaMetricReason;
  (state as any).theta_metric_authoritative = authoritativeThetaGeomUsable;
  (state as any).theta_metric_authoritative_source = authoritativeThetaGeomUsable
    ? authoritativeThetaGeomSource
    : undefined;
  (state as any).theta_metric_authoritative_reason = authoritativeThetaGeomUsable
    ? authoritativeTheta?.source === "gr_evolve_brick_theta"
      ? "brick_native_theta_present"
      : "brick_native_neg_k_trace_present"
    : "brick_native_theta_missing";
  (state as any).theta_metric_projection_available = projectionThetaGeomUsable;
  (state as any).theta_metric_projection_source = projectionThetaGeomUsable
    ? projectionThetaGeomSource
    : undefined;
  (state as any).theta_metric_projection_reason = projectionThetaGeomUsable
    ? "projection_metric_adapter_theta_available"
    : projectionThetaGeom == null
      ? "projection_theta_missing"
      : "projection_theta_proxy";
  (state as any).theta_source = thetaGeomUsable ? thetaGeomSource : thetaProxySource;
  if ((state as any).uniformsExplain?.thetaAudit) {
    (state as any).uniformsExplain.thetaAudit.thetaGeom = thetaGeom;
    (state as any).uniformsExplain.thetaAudit.thetaGeomSource =
      (state as any).theta_geom_source;
    (state as any).uniformsExplain.thetaAudit.thetaGeomProxy =
      (state as any).theta_geom_proxy;
    (state as any).uniformsExplain.thetaAudit.thetaGeomProjection =
      (state as any).theta_geom_projection;
    (state as any).uniformsExplain.thetaAudit.thetaGeomProjectionSource =
      (state as any).theta_geom_projection_source;
    (state as any).uniformsExplain.thetaAudit.thetaGeomProjectionProxy =
      (state as any).theta_geom_projection_proxy;
    (state as any).uniformsExplain.thetaAudit.thetaAudit = thetaAudit;
    (state as any).uniformsExplain.thetaAudit.thetaMetricDerived = thetaGeomUsable;
    (state as any).uniformsExplain.thetaAudit.thetaMetricReason = thetaMetricReason;
    (state as any).uniformsExplain.thetaAudit.thetaMetricAuthoritative =
      authoritativeThetaGeomUsable;
  }
};

const refreshCongruenceMeta = (state: EnergyPipelineState): void => {
  const warpState = (state as any).warp as Record<string, any> | undefined;
  const metricT00 = firstFinite(
    warpState?.metricT00,
    warpState?.metricStressEnergy?.T00,
    warpState?.stressEnergyTensor?.T00,
  );
  const metricSource =
    warpState?.metricT00Source ??
    warpState?.metricStressSource ??
    warpState?.stressEnergySource;
  const metricMode = metricSource === "metric" && metricT00 != null;
  const curvatureSource = metricMode ? "metric" : state ? "pipeline" : "unknown";
  const curvatureCongruence = metricMode ? "conditional" : "proxy-only";
  const curvatureProxy = curvatureCongruence !== "geometry-derived";

  const stressSource =
    warpState?.stressEnergySource ??
    (state as any)?.stressEnergySource ??
    (state as any)?.metricStressSource;
  const stressMetricMode = stressSource === "metric";
  const stressMetaSource = stressMetricMode ? "metric" : state ? "pipeline" : "unknown";
  const stressMetaCongruence = stressMetricMode ? "conditional" : "proxy-only";
  const stressMetaProxy = stressMetaCongruence !== "geometry-derived";

  state.curvatureMeta = {
    source: curvatureSource,
    congruence: curvatureCongruence,
    proxy: curvatureProxy,
  };
  state.stressMeta = {
    source: stressMetaSource,
    congruence: stressMetaCongruence,
    proxy: stressMetaProxy,
  };
};

const refreshUniversalCoverageStatus = (state: EnergyPipelineState): void => {
  const missing: string[] = [];
  const warpState = (state as any).warp as Record<string, any> | undefined;
  const metricT00 = firstFinite(
    warpState?.metricT00,
    warpState?.metricStressEnergy?.T00,
    warpState?.stressEnergyTensor?.T00,
  );
  const metricSource =
    warpState?.metricT00Source ?? warpState?.metricStressSource ?? warpState?.stressEnergySource;
  const metricMode = metricSource === "metric" && metricT00 != null;
  if (!metricMode) missing.push("missing_metric_t00");

  const metricContractStatus =
    (warpState as any)?.metricT00Contract?.status ??
    (warpState as any)?.metricT00ContractStatus ??
    (state as any)?.natario?.metricT00ContractStatus;
  if (metricMode && metricContractStatus !== "ok") {
    missing.push("missing_metric_contract");
  }

  const chartContractStatus =
    (warpState as any)?.metricAdapter?.chart?.contractStatus ??
    (warpState as any)?.metricAdapter?.chart?.contract_status;
  if (metricMode && chartContractStatus !== "ok") {
    missing.push("missing_chart_contract");
  }

  const thetaMetricDerived = (state as any).theta_metric_derived === true;
  if (!thetaMetricDerived) missing.push("missing_theta_geom");

  const rhoConstraint = state.rho_constraint ?? state.metricConstraint?.rho_constraint;
  if (!Number.isFinite(rhoConstraint?.mean)) missing.push("missing_rho_constraint");

  const gammaVdB = Number(state.gammaVanDenBroeck);
  if (Number.isFinite(gammaVdB) && gammaVdB > 1) {
    const vdbRegionIIDeriv = (state as any).vdb_region_ii_derivative_support === true;
    const vdbRegionIVDeriv = (state as any).vdb_region_iv_derivative_support === true;
    const vdbTwoWallDeriv = (state as any).vdb_two_wall_derivative_support === true;
    if (!vdbRegionIIDeriv) missing.push("missing_vdb_region_ii_derivatives");
    if (!vdbRegionIVDeriv) missing.push("missing_vdb_region_iv_derivatives");
    if (!vdbTwoWallDeriv) missing.push("missing_vdb_two_wall_derivatives");
  }

  (state as any).congruence_missing_parts = missing.length ? missing : undefined;
  (state as any).congruence_missing_count = missing.length;
  (state as any).congruence_missing_reason = missing.length ? missing[0] : undefined;
};

const computeVdbRegionIV = (params: {
  R: number;
  sigma: number;
  beta?: number;
  samples?: number;
}): VdbRegionIVDiagnostics | null => {
  const R = Number(params.R);
  const sigma = Number(params.sigma);
  if (!Number.isFinite(R) || !Number.isFinite(sigma)) return null;
  if (R <= 0 || sigma <= 0) return null;
  const rawBeta = Number.isFinite(params.beta) ? Number(params.beta) : Number.NaN;
  const amplitude =
    Number.isFinite(rawBeta)
      ? Math.max(0, Math.min(0.99, Math.abs(rawBeta)))
      : Math.max(0, Math.min(0.99, 0.15));
  const samples = Math.max(4, Math.floor(Number.isFinite(params.samples) ? (params.samples as number) : VDB_REGION_SAMPLES));
  const span = 3 / sigma;
  const rMin = Math.max(0, R - span);
  const rMax = R + span;
  const den = Math.max(1e-8, 2 * Math.tanh(sigma * R));
  const sech2 = (x: number) => {
    const c = Math.cosh(x);
    return c === 0 ? 0 : 1 / (c * c);
  };
  const dTopHatDr = (r: number) =>
    sigma * (sech2(sigma * (r + R)) - sech2(sigma * (r - R))) / den;

  let maxAbs = 0;
  let sumSq = 0;
  let t00Min = Number.POSITIVE_INFINITY;
  let t00Max = Number.NEGATIVE_INFINITY;
  let t00Sum = 0;
  let t00SumSq = 0;
  let traceSum = 0;
  let kSquaredSum = 0;
  const yOverR = 1 / Math.sqrt(2);
  const zOverR = yOverR;
  for (let i = 0; i < samples; i += 1) {
    const t = (i + 0.5) / samples;
    const r = rMin + (rMax - rMin) * t;
    const dfdr = dTopHatDr(r);
    const abs = Math.abs(dfdr);
    if (abs > maxAbs) maxAbs = abs;
    sumSq += dfdr * dfdr;
    const Kxx = -amplitude * dfdr;
    const Kxy = -0.5 * amplitude * dfdr * yOverR;
    const Kxz = -0.5 * amplitude * dfdr * zOverR;
    const trace = Kxx;
    const kSquared = Kxx * Kxx + 2 * (Kxy * Kxy + Kxz * Kxz);
    const rhoGeom = (trace * trace - kSquared) * INV16PI;
    if (rhoGeom < t00Min) t00Min = rhoGeom;
    if (rhoGeom > t00Max) t00Max = rhoGeom;
    t00Sum += rhoGeom;
    t00SumSq += rhoGeom * rhoGeom;
    traceSum += trace;
    kSquaredSum += kSquared;
  }
  const rms = Math.sqrt(sumSq / samples);
  const t00Mean = t00Sum / samples;
  const t00Rms = Math.sqrt(t00SumSq / samples);
  const kTraceMean = traceSum / samples;
  const kSquaredMean = kSquaredSum / samples;
  if (!Number.isFinite(t00Min)) t00Min = 0;
  if (!Number.isFinite(t00Max)) t00Max = 0;
  return {
    R_m: R,
    sigma,
    sampleCount: samples,
    dfdr_max_abs: maxAbs,
    dfdr_rms: rms,
    beta: amplitude,
    r_min_m: rMin,
    r_max_m: rMax,
    step_m: (rMax - rMin) / samples,
    t00_min: t00Min,
    t00_max: t00Max,
    t00_mean: t00Mean,
    t00_rms: t00Rms,
    k_trace_mean: kTraceMean,
    k_squared_mean: kSquaredMean,
    support: maxAbs > 0,
    note: Number.isFinite(rawBeta)
      ? "Region IV f-wall derivative sample around R."
      : "Region IV f-wall derivative sample around R (beta defaulted).",
  };
};

export function appendSweepRows(rows: VacuumGapSweepRow[]) {
  if (!rows.length) return;
  sweepHistoryTotal += rows.length;
  sweepHistory.push(...rows);
  if (sweepHistory.length > SWEEP_HISTORY_MAX) {
    const over = sweepHistory.length - SWEEP_HISTORY_MAX;
    sweepHistory.splice(0, over);
    sweepHistoryDropped += over;
  }
}

export function getSweepHistoryTotals(): SweepHistoryTotals {
  return {
    visible: sweepHistory.length,
    total: sweepHistoryTotal,
    dropped: sweepHistoryDropped,
  };
}
const SWEEP_TOP_LIMIT = 10;

function deriveMeasuredPumpFrequency(rows: VacuumGapSweepRow[]): number | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const candidates = rows.filter(
    (row) => Number.isFinite(row.Omega_GHz) && typeof row.Omega_GHz === "number",
  );
  if (!candidates.length) return undefined;
  const stable = candidates.filter((row) => row.stable !== false && row.status !== "UNSTABLE");
  const source = stable.length ? stable : candidates;
  const stats = new Map<number, { count: number; gainSum: number }>();
  for (const row of source) {
    const freq = Number(row.Omega_GHz);
    if (!Number.isFinite(freq) || freq <= 0) continue;
    const key = Number(freq.toFixed(6));
    const entry = stats.get(key);
    if (entry) {
      entry.count += 1;
      entry.gainSum += Number(row.G ?? 0);
    } else {
      stats.set(key, { count: 1, gainSum: Number(row.G ?? 0) });
    }
  }
  if (!stats.size) {
    const fallback = source[0]?.Omega_GHz;
    return Number.isFinite(fallback) && (fallback ?? 0) > 0 ? Number(fallback) : undefined;
  }
  let bestKey: number | undefined;
  let bestCount = -1;
  let bestAvg = -Infinity;
  for (const [key, value] of stats) {
    const avg = value.gainSum / Math.max(1, value.count);
    if (value.count > bestCount || (value.count === bestCount && avg > bestAvg)) {
      bestKey = key;
      bestCount = value.count;
      bestAvg = avg;
    }
  }
  if (bestKey != null) return bestKey;
  const fallback = source[0]?.Omega_GHz;
  return Number.isFinite(fallback) && (fallback ?? 0) > 0 ? Number(fallback) : undefined;
}

function dedupeNumericList(values: number[], digits = 4): number[] {
  if (!Array.isArray(values) || !values.length) return [];
  const scale = 10 ** digits;
  const unique = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(value * scale) / scale;
    if (!Number.isFinite(rounded)) continue;
    unique.add(rounded);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function mechanicalFeasibility(
  state: EnergyPipelineState,
  tileArea_m2: number,
  safetyFactorMin: number,
  opts?: {
    elasticModulus_Pa?: number;
    thickness_m?: number;
    spanScale?: number;
  },
): MechanicalFeasibility {
  const requestedGap_nm = Number.isFinite(state.gap_nm) ? Number(state.gap_nm) : 1;
  const requestedStroke_pm = Number.isFinite((state as any).strokeAmplitude_pm)
    ? Number((state as any).strokeAmplitude_pm)
    : Number.isFinite((state as any).strokeAmplitudePm)
      ? Number((state as any).strokeAmplitudePm)
      : Number.isFinite(state.dynamicConfig?.strokeAmplitudePm)
        ? Number(state.dynamicConfig?.strokeAmplitudePm)
        : 0;

  const area_m2 = Math.max(1e-9, tileArea_m2);
  const spanScale = Number.isFinite(opts?.spanScale) ? Math.max(1e-3, opts!.spanScale as number) : 1;
  const span_m = Math.sqrt(area_m2) * spanScale; // treat tile as square plate for stiffness budget
  const stroke_m = Math.max(0, requestedStroke_pm * 1e-12);
  const roughnessGuard_nm = Math.max(0, MECH_ROUGHNESS_RMS_NM * MECH_ROUGHNESS_SIGMA);
  const roughnessGuard_m = roughnessGuard_nm * NM_TO_M;

  const thickness_m = Number.isFinite(opts?.thickness_m) ? Math.max(1e-9, opts!.thickness_m as number) : MECH_TILE_THICKNESS_M;
  const elasticModulus_Pa = Number.isFinite(opts?.elasticModulus_Pa)
    ? Math.max(1e6, opts!.elasticModulus_Pa as number)
    : MECH_ELASTIC_MODULUS_PA;
  const D =
    elasticModulus_Pa *
    Math.pow(Math.max(1e-9, thickness_m), 3) /
    (12 * (1 - MECH_POISSON * MECH_POISSON));

  const sigmaAllow_Pa = MECH_YIELD_STRESS_PA / Math.max(1e-6, MECH_SAFETY_FACTOR_DESIGN);
  const safetyFloor = Math.max(1e-6, safetyFactorMin);

  const calcForGap = (gap_nm: number) => {
    const gap_m = Math.max(1e-12, gap_nm * NM_TO_M);
    const casimirPressure_Pa = (Math.PI * Math.PI * HBAR_C) / (240 * Math.pow(gap_m, 4));
    const electrostaticPressure_Pa = 0.5 * EPSILON_0 * Math.pow(MECH_PATCH_V_RMS / gap_m, 2);
    const totalLoad_Pa = casimirPressure_Pa + electrostaticPressure_Pa;
    const mechSafetyFactor = sigmaAllow_Pa / Math.max(totalLoad_Pa, 1e-12);
    const safetyFeasible = mechSafetyFactor >= safetyFloor;

    const clearance_m = Math.max(0, gap_m - roughnessGuard_m - stroke_m);
    const restoringPressure_Pa =
      clearance_m > 0 && D > 0
        ? (D * clearance_m) / (MECH_DEFLECTION_COEFF * Math.pow(span_m, 4))
        : 0;
    const margin_Pa = restoringPressure_Pa - totalLoad_Pa;

    const deflectionForLoad_m =
      (totalLoad_Pa * MECH_DEFLECTION_COEFF * Math.pow(span_m, 4)) / Math.max(D, 1e-30);
    const strokeBudget_m = Math.max(0, gap_m - roughnessGuard_m - deflectionForLoad_m);
    const maxStroke_pm = strokeBudget_m * 1e12;
    const strokeFeasible = requestedStroke_pm <= maxStroke_pm + 1e-9;

    let note: string | undefined;
    if (!safetyFeasible) {
      note = "Casimir load exceeds allowable stress budget";
    } else if (clearance_m <= 0) {
      note = "Stroke + roughness exceed available gap";
    } else if (margin_Pa <= 0) {
      note = "Restoring stiffness is below Casimir + patch load";
    } else if (!strokeFeasible) {
      note = "Commanded stroke exceeds stiffness budget";
    }

    const feasible = clearance_m > 0 && safetyFeasible && strokeFeasible && margin_Pa >= 0;

    return {
      gap_nm,
      casimirPressure_Pa,
      electrostaticPressure_Pa,
      totalLoad_Pa,
      mechSafetyFactor,
      safetyFeasible,
      clearance_m,
      restoringPressure_Pa,
      margin_Pa,
      deflectionForLoad_m,
      maxStroke_pm,
      strokeFeasible,
      feasible,
      note,
    };
  };

  const sweep: NonNullable<MechanicalFeasibility["sweep"]> = [];
  for (
    let g = MECH_GAP_SWEEP.min_nm;
    g <= MECH_GAP_SWEEP.max_nm + 1e-9;
    g += MECH_GAP_SWEEP.step_nm
  ) {
    const calc = calcForGap(g);
    sweep.push({ gap_nm: g, margin_Pa: calc.margin_Pa, feasible: calc.feasible });
  }

  const firstFeasible = sweep.find((row) => row.feasible);
  const minGap_nm = Math.max(
    roughnessGuard_nm,
    firstFeasible ? firstFeasible.gap_nm : requestedGap_nm,
  );
  const recommendedGap_nm = Math.max(requestedGap_nm, minGap_nm);
  const applied = calcForGap(recommendedGap_nm);

  return {
    requestedGap_nm,
    requestedStroke_pm,
    recommendedGap_nm,
    minGap_nm,
    maxStroke_pm: applied.maxStroke_pm,
    casimirPressure_Pa: applied.casimirPressure_Pa,
    electrostaticPressure_Pa: applied.electrostaticPressure_Pa,
    restoringPressure_Pa: applied.restoringPressure_Pa,
    roughnessGuard_nm,
    margin_Pa: applied.margin_Pa,
    safetyFactorMin,
    mechSafetyFactor: applied.mechSafetyFactor,
    sigmaYield_Pa: MECH_YIELD_STRESS_PA,
    sigmaAllow_Pa,
    loadPressure_Pa: applied.totalLoad_Pa,
    safetyFeasible: applied.safetyFeasible,
    feasible: applied.feasible,
    strokeFeasible: applied.strokeFeasible,
    note: applied.note,
    sweep,
  };
}

function toSweepPoint(row: VacuumGapSweepRow): SweepPoint {
  return {
    d_nm: row.d_nm,
    m: row.m,
    phi_deg: row.phi_deg,
    Omega_GHz: row.Omega_GHz,
    G: row.G,
    QL: row.QL ?? row.QL_base ?? undefined,
    stable: row.stable,
    status: row.status,
    detune_MHz: row.detune_MHz,
    kappa_MHz: row.kappa_MHz,
    kappaEff_MHz: row.kappaEff_MHz,
    pumpRatio: row.pumpRatio,
    plateau: !!row.plateau,
  };
}

function upsertTopRows(
  rows: VacuumGapSweepRow[],
  candidate: VacuumGapSweepRow,
  limit = SWEEP_TOP_LIMIT,
): VacuumGapSweepRow[] {
  const next = rows.concat(candidate);
  next.sort((a, b) => {
    const gainDiff = b.G - a.G;
    if (Math.abs(gainDiff) > 1e-6) return gainDiff;
    const qlA = a.QL ?? a.QL_base ?? 0;
    const qlB = b.QL ?? b.QL_base ?? 0;
    return qlB - qlA;
  });
  if (next.length > limit) {
    next.length = limit;
  }
  return next;
}

function ensureDefaultSweepConfig(state: EnergyPipelineState) {
  if (!state.dynamicConfig) state.dynamicConfig = {};
  if (!state.dynamicConfig.sweep) {
    const sweepDefaults = DEFAULT_GEOMETRY_SWEEP;
    state.dynamicConfig.sweep = {
      ...sweepDefaults,
      gaps_nm: [...sweepDefaults.gaps_nm],
      mod_depth_pct: sweepDefaults.mod_depth_pct ? [...sweepDefaults.mod_depth_pct] : [],
      pump_freq_GHz:
        typeof sweepDefaults.pump_freq_GHz === "string"
          ? sweepDefaults.pump_freq_GHz
          : sweepDefaults.pump_freq_GHz
          ? [...sweepDefaults.pump_freq_GHz]
          : [],
      phase_deg: sweepDefaults.phase_deg ? [...sweepDefaults.phase_deg] : [],
      plateau: sweepDefaults.plateau ? { ...sweepDefaults.plateau } : undefined,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

const roundToStep = (value: number, step: number) =>
  step > 0 ? Math.round(value / step) * step : value;

type RidgeScore = {
  key: { d_nm: number; m: number; Omega_GHz: number };
  plateauWidth: number;
  Gcrest: number;
  QL: number;
  crestPhiDeg: number;
};

function rankRidges(rows: VacuumGapSweepRow[]): RidgeScore[] {
  const groups = new Map<string, VacuumGapSweepRow[]>();
  for (const row of rows) {
    const key = `${row.d_nm}|${row.m}|${row.Omega_GHz}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const scored: RidgeScore[] = [];
  for (const bucket of groups.values()) {
    const crest = bucket.find((r) => r.crest) ?? bucket.reduce((best, row) => (row.G > best.G ? row : best), bucket[0]);
    if (!crest) continue;
    scored.push({
      key: { d_nm: crest.d_nm, m: crest.m, Omega_GHz: crest.Omega_GHz },
      plateauWidth: crest.plateau?.width_deg ?? 0,
      Gcrest: crest.G,
      QL: crest.QL ?? crest.QL_base ?? 0,
      crestPhiDeg: crest.phi_deg,
    });
  }

  scored.sort((a, b) => {
    const widthDiff = b.plateauWidth - a.plateauWidth;
    if (Math.abs(widthDiff) > 1e-6) return widthDiff;
    const gainDiff = b.Gcrest - a.Gcrest;
    if (Math.abs(gainDiff) > 1e-6) return gainDiff;
    return (b.QL ?? 0) - (a.QL ?? 0);
  });
  return scored;
}

export async function orchestrateVacuumGapSweep(state: EnergyPipelineState): Promise<VacuumGapSweepRow[] | void> {
  ensureDefaultSweepConfig(state);

  if (!state.sweep) {
    state.sweep = { active: false, top: [], last: null };
  } else {
    state.sweep.top ??= [];
    state.sweep.last ??= null;
  }
  const sweepRuntime = state.sweep;

  const dynamicConfig = state.dynamicConfig;
  const runCfg = defaultSweepConfigFromDynamic(dynamicConfig);
  if (!runCfg) {
    sweepRuntime.active = false;
    sweepRuntime.cancelRequested = false;
    return;
  }

  const hardwareProfileSeed =
    ((state.dynamicConfig?.sweep as any)?.hardwareProfile as Record<string, unknown> | undefined) ??
    runCfg.hardwareProfile ??
    {};
  const pumpFreqLimit_GHz = normalizePumpFreqLimit(
    (hardwareProfileSeed as any).pumpFreqLimit_GHz ?? (runCfg as any).pumpFreqLimit_GHz,
  );
  const pumpGuardStats: PumpGuardStats = { clamped: 0, rejected: 0 };
  runCfg.pumpFreqLimit_GHz = pumpFreqLimit_GHz;
  runCfg.hardwareProfile = {
    ...(runCfg.hardwareProfile ?? {}),
    pumpFreqLimit_GHz,
  };
  if (Array.isArray(runCfg.pump_freq_GHz) && runCfg.pump_freq_GHz.length) {
    runCfg.pump_freq_GHz = sanitizePumpFrequencies(runCfg.pump_freq_GHz, pumpFreqLimit_GHz, pumpGuardStats);
  }

  let gateAnalytics: GateAnalytics | null = null;
  const gateAnalyticsSink = (analytics: GateAnalytics | null) => {
    gateAnalytics = analytics ?? null;
  };

  if (runCfg.activeSlew) {
    const hardwareProfile = (state.dynamicConfig?.sweep as any)?.hardwareProfile ?? {};
    const gapLimit = resolveActiveSlewLimit(
      hardwareProfile?.gapLimit,
      ACTIVE_SLEW_LIMITS.gaps,
      1,
      runCfg.gaps_nm.length,
    );
    const modDepthLimit = resolveActiveSlewLimit(
      hardwareProfile?.modDepthLimit,
      ACTIVE_SLEW_LIMITS.modDepth,
      1,
      runCfg.mod_depth_pct.length,
    );
    const phaseLimit = resolveActiveSlewLimit(
      hardwareProfile?.phaseLimit,
      ACTIVE_SLEW_LIMITS.phase,
      1,
      runCfg.phase_deg.length,
    );
    const pumpLimit = resolveActiveSlewLimit(
      hardwareProfile?.pumpLimit,
      ACTIVE_SLEW_LIMITS.pump,
      1,
      runCfg.pump_freq_GHz.length || 1,
    );

    runCfg.gaps_nm = pickRepresentativeValues(runCfg.gaps_nm, gapLimit);
    runCfg.mod_depth_pct = pickRepresentativeValues(runCfg.mod_depth_pct, modDepthLimit);
    runCfg.phase_deg = pickRepresentativeValues(runCfg.phase_deg, phaseLimit);
    if (Array.isArray(runCfg.pump_freq_GHz) && runCfg.pump_freq_GHz.length) {
      runCfg.pump_freq_GHz = pickRepresentativeValues(runCfg.pump_freq_GHz, pumpLimit);
      runCfg.pump_freq_GHz = sanitizePumpFrequencies(runCfg.pump_freq_GHz, pumpFreqLimit_GHz, pumpGuardStats);
    }

    const requestedDelay =
      hardwareProfile?.delayMs ?? hardwareProfile?.slewDelayMs ?? runCfg.slewDelayMs ?? ACTIVE_SLEW_LIMITS.delayMs;
    runCfg.slewDelayMs = Math.max(0, Number.isFinite(requestedDelay) ? Number(requestedDelay) : ACTIVE_SLEW_LIMITS.delayMs);

    const sweepConfig = state.dynamicConfig?.sweep;
    if (sweepConfig) {
      sweepConfig.slewDelayMs = runCfg.slewDelayMs;
      sweepConfig.hardwareProfile = {
        ...(sweepConfig.hardwareProfile ?? {}),
        gapLimit,
        modDepthLimit,
        phaseLimit,
        pumpLimit,
        pumpFreqLimit_GHz,
        delayMs: runCfg.slewDelayMs,
      };
      sweepConfig.gaps_nm = [...runCfg.gaps_nm];
      sweepConfig.mod_depth_pct = [...runCfg.mod_depth_pct];
      sweepConfig.phase_deg = [...runCfg.phase_deg];
      if (Array.isArray(runCfg.pump_freq_GHz) && sweepConfig.pump_freq_GHz !== "auto") {
        sweepConfig.pump_freq_GHz = [...runCfg.pump_freq_GHz];
      }
      sweepConfig.activeSlew = true;
      if (runCfg.twoPhase !== undefined) {
        (sweepConfig as any).twoPhase = runCfg.twoPhase;
      }
    }
    sweepRuntime.activeSlew = true;
  } else if (sweepRuntime) {
    sweepRuntime.activeSlew = false;
  }

  if (pumpGuardStats.clamped > 0 && DEBUG_PIPE) {
    console.warn(
      `[PIPELINE] pump frequency guard limited ${pumpGuardStats.clamped} step(s) to <= ${pumpFreqLimit_GHz.toFixed(3)} GHz`,
    );
  }

  const geometry = runCfg.geometry ?? "cpw";
  const gammaGeo = runCfg.gamma_geo ?? state.gammaGeo ?? 1e-3;
  const base_f0 =
    runCfg.base_f0_GHz ??
    (typeof (dynamicConfig as any)?.base_f0_GHz === "number"
      ? (dynamicConfig as any).base_f0_GHz
      : state.modulationFreq_GHz
      ? state.modulationFreq_GHz / 2
      : 6);
  const Qc = runCfg.Qc ?? state.qCavity ?? 5e5;
  const T_K = runCfg.T_K ?? state.temperature_K ?? 2;

  const ctx = { geom: geometry, gammaGeo, base_f0_GHz: base_f0, Qc, T_K };
  const phaseLog =
    Array.isArray(dynamicConfig?.phase_deg)
      ? (dynamicConfig?.phase_deg as number[])[0] ?? 0
      : (dynamicConfig?.phase_deg as number) ?? 0;
  const pumpArray = Array.isArray(runCfg.pump_freq_GHz) ? runCfg.pump_freq_GHz : [];
  const pumpLogBaseSource = pumpArray.length ? pumpArray[0] : base_f0 * 2;
  const pumpLogBase = Math.min(pumpFreqLimit_GHz, pumpLogBaseSource);

  const logSweep = async (
    rows: VacuumGapSweepRow[],
    meta: Record<string, unknown>,
    pumpHz?: number,
  ) => {
    if (!rows.length) return;
    const pumpForLog = pumpHz ?? pumpLogBase;
    try {
      await appendPhaseCalibrationLog({
        phase_deg_set: phaseLog,
        pump_freq_GHz: pumpForLog,
        rows: rows.slice(0, 512),
        meta: {
          geometry,
          gamma_geo: gammaGeo,
          base_f0_GHz: base_f0,
          ...meta,
        },
      });
    } catch (err) {
      if (DEBUG_PIPE) console.warn("[PIPELINE] phase-calibration log append failed:", err);
    }
  };

  if (runCfg.activeSlew) {
    const delayMs =
      Number.isFinite(runCfg.slewDelayMs) && runCfg.slewDelayMs != null
        ? Math.max(0, runCfg.slewDelayMs)
        : 50;
    let modDepthList =
      runCfg.mod_depth_pct && runCfg.mod_depth_pct.length ? [...runCfg.mod_depth_pct] : [0.5];
    const phaseList = runCfg.phase_deg && runCfg.phase_deg.length ? runCfg.phase_deg : [0];

    const autoPumpForGap = (d_nm: number) => {
      const d_m = d_nm * 1e-9;
      const f0_auto = omega0_from_gap(d_m, base_f0, geometry, gammaGeo);
      return sanitizePumpFrequencies([2 * f0_auto], pumpFreqLimit_GHz);
    };

    const defaultPumpListForGap = (d_nm: number) => {
      if (runCfg.pumpStrategy === "auto") {
        return autoPumpForGap(d_nm);
      }
      if (Array.isArray(runCfg.pump_freq_GHz) && runCfg.pump_freq_GHz.length) {
        return sanitizePumpFrequencies(runCfg.pump_freq_GHz, pumpFreqLimit_GHz);
      }
      if (typeof runCfg.pump_freq_GHz === "number") {
        return sanitizePumpFrequencies([runCfg.pump_freq_GHz], pumpFreqLimit_GHz);
      }
      return sanitizePumpFrequencies([2 * base_f0], pumpFreqLimit_GHz);
    };

    let twoPhaseEnabled =
      runCfg.twoPhase === true ||
      (runCfg.twoPhase !== false && runCfg.pumpStrategy === "auto");
    if (!modDepthList.length || !phaseList.length) {
      twoPhaseEnabled = false;
    }

    const primePumpResolver = twoPhaseEnabled ? autoPumpForGap : defaultPumpListForGap;
    const computePhaseTotal = (resolver: (gap: number) => number[], depths: number[]) => {
      let total = 0;
      for (const d_nm of runCfg.gaps_nm) {
        const pumpList = sanitizePumpFrequencies(resolver(d_nm), pumpFreqLimit_GHz);
        total += depths.length * pumpList.length * phaseList.length;
      }
      return total;
    };

    const primeSteps = computePhaseTotal(primePumpResolver, modDepthList);
    const refineSteps = twoPhaseEnabled
      ? runCfg.gaps_nm.length * modDepthList.length * phaseList.length
      : 0;
    let totalSteps = primeSteps + refineSteps;

    sweepRuntime.active = totalSteps > 0;
    sweepRuntime.startedAt = Date.now();
    sweepRuntime.completedAt = undefined;
    sweepRuntime.cancelRequested = false;
    sweepRuntime.cancelled = false;
    sweepRuntime.iter = 0;
    sweepRuntime.total = totalSteps;
    sweepRuntime.etaMs = totalSteps > 0 ? undefined : 0;
    sweepRuntime.slewDelayMs = delayMs;
    sweepRuntime.top = [];
    sweepRuntime.last = null;

    if (totalSteps <= 0) {
      state.vacuumGapSweepResults = [];
      state.gateAnalytics = gateAnalytics;
      return;
    }

    const primeRows: VacuumGapSweepRow[] = [];
    const refineRows: VacuumGapSweepRow[] = [];
    let topRows: VacuumGapSweepRow[] = [];
    let lastAcceptedRow: VacuumGapSweepRow | null = null;
    let cancelled = false;

    const updateEta = () => {
      if (sweepRuntime.total && sweepRuntime.iter) {
        const elapsed = Date.now() - (sweepRuntime.startedAt ?? Date.now());
        const remaining = Math.max(0, sweepRuntime.total - sweepRuntime.iter);
        sweepRuntime.etaMs =
          sweepRuntime.iter > 0
            ? Math.max(0, Math.round((elapsed / Math.max(1, sweepRuntime.iter)) * remaining))
            : undefined;
      } else {
        sweepRuntime.etaMs = undefined;
      }
    };

    const runPhase = async (
      phaseLabel: "prime" | "refine",
      pumpResolver: (gap: number) => number[],
      rowsCollector: VacuumGapSweepRow[],
      depths: number[],
    ) => {
      for (const d_nm of runCfg.gaps_nm) {
        const pumpList = sanitizePumpFrequencies(pumpResolver(d_nm), pumpFreqLimit_GHz, pumpGuardStats);
        if (!pumpList.length) continue;
        for (const m_pct of depths) {
          const m = m_pct / 100;
          for (const pumpHz of pumpList) {
            const phaseRows: VacuumGapSweepRow[] = [];
            for (const phase of phaseList) {
              if (state.sweep?.cancelRequested) {
                cancelled = true;
                return;
              }

              await slewPump({ f_Hz: pumpHz * 1e9, m, phi_deg: phase });
              const row = computeSweepPoint({ d_nm, m, Omega_GHz: pumpHz, phi_deg: phase }, ctx);

              sweepRuntime.iter = (sweepRuntime.iter ?? 0) + 1;
              sweepRuntime.last = toSweepPoint(row);
              updateEta();

              if (row.G > (runCfg.maxGain_dB ?? 15) && (row.QL ?? Infinity) < (runCfg.minQL ?? 1e3)) {
                continue;
              }

              phaseRows.push(row);
              rowsCollector.push(row);
              appendSweepRows([row]);
              topRows = upsertTopRows(topRows, row);
              sweepRuntime.top = topRows.map(toSweepPoint);
              lastAcceptedRow = row;
              state.vacuumGapSweepResults = rowsCollector.slice();
              if (delayMs > 0) await sleep(delayMs);
            }
            if (cancelled) {
              return;
            }
            if (phaseRows.length) {
              phaseRows.sort((a, b) => a.phi_deg - b.phi_deg);
              detectPlateau(phaseRows, runCfg);
              sweepRuntime.top = topRows.map(toSweepPoint);
              const latest = lastAcceptedRow ?? phaseRows[phaseRows.length - 1];
              sweepRuntime.last = latest ? toSweepPoint(latest) : sweepRuntime.last ?? null;
            }
          }
        }
      }
    };

    state.vacuumGapSweepResults = [];
    await runPhase("prime", primePumpResolver, primeRows, modDepthList);

    let derivedPumpGHz: number | undefined;
    let refineModDepthList = modDepthList.slice();
    if (!cancelled && twoPhaseEnabled) {
      const rowsForScaling = primeRows.filter(
        (row) =>
          row &&
          typeof row.pumpRatio === "number" &&
          Number.isFinite(row.pumpRatio) &&
          typeof row.m === "number" &&
          row.m > 0,
      );
      if (rowsForScaling.length) {
        let modDepthScale = 1;
        for (const row of rowsForScaling) {
          const rho = Number(row.pumpRatio);
          if (!Number.isFinite(rho) || rho <= 0) continue;
          if (rho > TWO_PHASE_TARGET_RHO) {
            modDepthScale = Math.min(modDepthScale, TWO_PHASE_TARGET_RHO / rho);
          }
        }
        if (modDepthScale < 1) {
          refineModDepthList = dedupeNumericList(
            modDepthList.map((pct) =>
              Math.max(TWO_PHASE_MIN_MOD_DEPTH_PCT, pct * modDepthScale),
            ),
            4,
          );
        }
      }
      if (!refineModDepthList.length) {
        refineModDepthList = [TWO_PHASE_MIN_MOD_DEPTH_PCT];
      }
      derivedPumpGHz = deriveMeasuredPumpFrequency(primeRows);
      if (Number.isFinite(derivedPumpGHz) && (derivedPumpGHz ?? 0) > 0) {
        const sanitized = sanitizePumpFrequencies([Number(derivedPumpGHz)], pumpFreqLimit_GHz, pumpGuardStats);
        derivedPumpGHz = sanitized.length ? sanitized[0] : derivedPumpGHz;
      }
      if (!Number.isFinite(derivedPumpGHz) || (derivedPumpGHz ?? 0) <= 0) {
        twoPhaseEnabled = false;
        sweepRuntime.total = primeSteps;
        totalSteps = primeSteps;
        updateEta();
      } else {
        const adjustedTotal =
          primeSteps + runCfg.gaps_nm.length * refineModDepthList.length * phaseList.length;
        sweepRuntime.total = adjustedTotal;
        totalSteps = adjustedTotal;
        updateEta();
      }
    }

    if (!cancelled && twoPhaseEnabled && derivedPumpGHz != null) {
      topRows = [];
      state.vacuumGapSweepResults = [];
      const refinePumpList = sanitizePumpFrequencies(
        [Number(derivedPumpGHz)],
        pumpFreqLimit_GHz,
        pumpGuardStats,
      );
      if (!refinePumpList.length) {
        cancelled = true;
      } else {
        const pumpValue = refinePumpList[0];
        await runPhase("refine", () => refinePumpList, refineRows, refineModDepthList);
        if (!cancelled) {
          if (state.dynamicConfig?.sweep) {
            state.dynamicConfig.sweep.pump_freq_GHz = [pumpValue];
          }
          if (state.dynamicConfig?.sweep && refineModDepthList.length) {
            state.dynamicConfig.sweep.mod_depth_pct = refineModDepthList.slice();
          }
        }
      }
    } else {
      state.vacuumGapSweepResults = primeRows.slice();
    }
    if (state.dynamicConfig?.sweep) {
      state.dynamicConfig.sweep.twoPhase = runCfg.twoPhase;
    }

    sweepRuntime.active = false;
    sweepRuntime.cancelRequested = false;
    sweepRuntime.cancelled = cancelled;
    sweepRuntime.top = topRows.map(toSweepPoint);
    if (!cancelled) {
      sweepRuntime.completedAt = Date.now();
      sweepRuntime.etaMs = 0;
    } else {
      sweepRuntime.completedAt = undefined;
    }

    const finalRows =
      !cancelled && twoPhaseEnabled && refineRows.length ? refineRows : primeRows;
    const finalPump = finalRows.length ? finalRows[finalRows.length - 1].Omega_GHz : undefined;

    if (runCfg.gateSchedule && runCfg.gateSchedule.length) {
      const { analytics } = assignGateSummaries(
        finalRows,
        runCfg.gateSchedule,
        runCfg.gateRouting,
        runCfg.gateOptions ?? {},
      );
      gateAnalyticsSink(analytics ?? null);
    } else {
      assignGateSummaries(finalRows, undefined, undefined, runCfg.gateOptions ?? {});
      gateAnalyticsSink(null);
    }

    state.vacuumGapSweepResults = finalRows.slice();
    state.gateAnalytics = gateAnalytics;

    await logSweep(
      finalRows,
      {
        activeSlew: true,
        slewDelayMs: delayMs,
        totalSteps: sweepRuntime.total ?? totalSteps,
        cancelled,
        phaseA_rows: primeRows.length,
        phaseB_rows: refineRows.length,
      },
      finalPump,
    );
    return finalRows;
  }

  sweepRuntime.active = false;
  sweepRuntime.cancelRequested = false;

  const coarseCfg = {
    ...runCfg,
    geometry,
    gamma_geo: gammaGeo,
    base_f0_GHz: base_f0,
    Qc,
    T_K,
    gateAnalyticsSink,
  };

  const coarseRows = runVacuumGapSweep(coarseCfg);
  if (!coarseRows.length) {
    state.vacuumGapSweepResults = [];
    state.gateAnalytics = gateAnalytics;
    return;
  }

  appendSweepRows(coarseRows);
  state.vacuumGapSweepResults = coarseRows.slice();

  const ridgeScores = rankRidges(coarseRows);
  const topRidges = ridgeScores.slice(0, 5);
  const microRows: VacuumGapSweepRow[] = [];

  if (topRidges.length) {
    const microTemplate = DEFAULT_PHASE_MICRO_SWEEP.phase_deg ?? [];
    const microStep =
      DEFAULT_PHASE_MICRO_SWEEP.phaseMicroStep_deg ??
      runCfg.phaseMicroStep_deg ??
      0.25;

    for (const ridge of topRidges) {
      const crestPhi = roundToStep(ridge.crestPhiDeg, microStep);
      const phase_deg =
        microTemplate.length > 0
          ? microTemplate.map((offset) => crestPhi + offset)
          : runCfg.phase_deg && runCfg.phase_deg.length
          ? [...runCfg.phase_deg]
          : [crestPhi];
      const microCfg = {
        ...coarseCfg,
        gaps_nm: [ridge.key.d_nm],
        mod_depth_pct: [ridge.key.m * 100],
        pump_freq_GHz: [ridge.key.Omega_GHz],
        pumpStrategy: undefined,
        phase_deg,
      };
      const rows = runVacuumGapSweep(microCfg);
      if (!rows.length) continue;
      appendSweepRows(rows);
      microRows.push(...rows);
    }
  }

  const allRows = coarseRows.concat(microRows);
  state.vacuumGapSweepResults = allRows;
  state.gateAnalytics = gateAnalytics;
  const crestPump = topRidges[0]?.key.Omega_GHz;
  await logSweep(
    allRows,
    {
      activeSlew: false,
      coarseRows: coarseRows.length,
      microRows: microRows.length,
    },
    crestPump,
  );
  return allRows;
}

// G+¦+çG+¦+ç Metric imports (induced surface metric on hull)
import { firstFundamentalForm } from "../src/metric.ts";

// --- Mode power/mass policy (targets are *hit* by scaling qMechanical for power and +-ª_VdB for mass) ---
// NOTE: All P_target_* values are in **watts** (W).
const MODE_POLICY = {
  hover:     { S_live: 2 as const,     P_target_W: 83.3e6,   P_cap_W: 83.3e6,   M_target_kg: 1405, massMode: DEFAULT_MASS_MODE },
  taxi:      { S_live: 2 as const,     P_target_W: 83.3e6,   P_cap_W: 83.3e6,   M_target_kg: 1405, massMode: DEFAULT_MASS_MODE },
  nearzero:  { S_live: 2 as const,     P_target_W: 5e6,      P_cap_W: 5e6,      M_target_kg: 1405, massMode: DEFAULT_MASS_MODE },
  cruise:    { S_live: 2 as const,     P_target_W: 40e6,     P_cap_W: 40e6,     M_target_kg: 1405, massMode: DEFAULT_MASS_MODE },
  emergency: { S_live: 2 as const,     P_target_W: 297.5e6,  P_cap_W: 300e6,    M_target_kg: 1405, massMode: DEFAULT_MASS_MODE },
  standby:   { S_live: 0 as const,     P_target_W: 0,        P_cap_W: 0,        M_target_kg: 0,    massMode: DEFAULT_MASS_MODE },
} as const;

// Ship HV bus voltage policy (per mode), in kilovolts
const BUS_VOLTAGE_POLICY_KV = {
  hover:     17,
  taxi:      17,
  nearzero:  17,
  cruise:    17,
  emergency: 30,
  standby:   0,
} as const;

// Runtime assert in dev to prevent unit confusion
if (process.env.NODE_ENV !== 'production') {
  const bad = Object.entries(MODE_POLICY)
    .filter(([k,v]) => k !== 'standby')
    .some(([,v]) => v.P_target_W < 1e3);
  if (bad && DEBUG_PIPE) console.warn("[PIPELINE] Power targets must be in watts (>= 1kW).");
}

function resolveSLive(mode: EnergyPipelineState['currentMode']): number {
  const pol = MODE_POLICY[mode];
  return Math.max(0, Math.min(PROMOTED_WARP_PROFILE.sectorCount, pol.S_live));
}

// Mode configurations (physics parameters only, no hard locks)
// NOTE: Concurrent sectors come from MODE_POLICY.*.S_live, total sectors follow promoted runtime profile.
export const MODE_CONFIGS = {
  hover: {
    dutyCycle: PROMOTED_WARP_PROFILE.dutyCycle,
    sectorStrobing: PROMOTED_WARP_PROFILE.concurrentSectors,
    qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
    description: "High-power hover mode for station-keeping",
    // New fields for mode-aware physics
    sectorsTotal: PROMOTED_WARP_PROFILE.sectorCount,
    sectorsConcurrent: PROMOTED_WARP_PROFILE.concurrentSectors,
    localBurstFrac: PROMOTED_WARP_PROFILE.dutyCycle,
    zeta_max: 1.0 // standard quantum bound (Ford-Roman limit)
  },
  taxi: {
    dutyCycle: PROMOTED_WARP_PROFILE.dutyCycle,
    sectorStrobing: PROMOTED_WARP_PROFILE.concurrentSectors,
    qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
    description: "Ground ops posture; translation suppressed",
    sectorsTotal: PROMOTED_WARP_PROFILE.sectorCount,
    sectorsConcurrent: PROMOTED_WARP_PROFILE.concurrentSectors,
    localBurstFrac: PROMOTED_WARP_PROFILE.dutyCycle,
    zeta_max: 1.0
  },
  nearzero: {
    dutyCycle: PROMOTED_WARP_PROFILE.dutyCycle,
    sectorStrobing: PROMOTED_WARP_PROFILE.concurrentSectors,
    qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
    description: "Zero-beta hover-climb regime",
    sectorsTotal: PROMOTED_WARP_PROFILE.sectorCount,
    sectorsConcurrent: PROMOTED_WARP_PROFILE.concurrentSectors,
    localBurstFrac: PROMOTED_WARP_PROFILE.dutyCycle,
    zeta_max: 1.0
  },
  cruise: {
    dutyCycle: PROMOTED_WARP_PROFILE.dutyCycle,
    sectorStrobing: PROMOTED_WARP_PROFILE.concurrentSectors,
    qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
    description: "Low-power cruise mode for sustained travel",
    // New fields for mode-aware physics
    sectorsTotal: PROMOTED_WARP_PROFILE.sectorCount,
    sectorsConcurrent: PROMOTED_WARP_PROFILE.concurrentSectors,
    localBurstFrac: PROMOTED_WARP_PROFILE.dutyCycle
  },
  emergency: {
    dutyCycle: 0.50,
    sectorStrobing: 8,       // Updated to match client-side emergency mode
    qSpoilingFactor: 1,
    description: "Maximum power emergency mode",
    // New fields for mode-aware physics
    sectorsTotal: PROMOTED_WARP_PROFILE.sectorCount,
    sectorsConcurrent: 8,
    localBurstFrac: 0.50
  },
  standby: {
    dutyCycle: 0.001,
    sectorStrobing: 1,
    qSpoilingFactor: 0.1,
    description: "Minimal power standby mode",
    // New fields for mode-aware physics
    sectorsTotal: PROMOTED_WARP_PROFILE.sectorCount,
    sectorsConcurrent: 1,
    localBurstFrac: 0.0
  }
};

const AREA_MONTE_CARLO_SAMPLES = 16384;

// Closed-form elliptic-integral approximations for axisymmetric cases (prolate/oblate)
function surfaceAreaProlate(aEq: number, cPol: number): number | null {
  if (!(aEq > 0 && cPol > 0)) return null;
  const e2 = 1 - (aEq * aEq) / (cPol * cPol);
  const e = Math.sqrt(Math.max(0, e2));
  if (e < 1e-12) return 4 * Math.PI * aEq * aEq; // sphere fallback
  return 2 * Math.PI * aEq * aEq * (1 + (cPol / (aEq * e)) * Math.asin(e));
}

function surfaceAreaOblate(aEq: number, cPol: number): number | null {
  if (!(aEq > 0 && cPol > 0)) return null;
  const e2 = 1 - (cPol * cPol) / (aEq * aEq);
  const e = Math.sqrt(Math.max(0, e2));
  if (e < 1e-12) return 4 * Math.PI * aEq * aEq;
  const eClamped = Math.min(1 - 1e-12, e);
  const atanhE = 0.5 * Math.log((1 + eClamped) / (1 - eClamped));
  return 2 * Math.PI * aEq * aEq * (1 + ((1 - e * e) / eClamped) * atanhE);
}

function surfaceAreaAxisymmetricApproximations(axes: HullAxes) {
  const sorted = [Math.abs(axes.a), Math.abs(axes.b), Math.abs(axes.c)].sort((x, y) => x - y);
  const [r0, r1, r2] = sorted; // r0 <= r1 <= r2
  const eqProlate = Math.sqrt(r0 * r1);
  const eqOblate = Math.sqrt(r1 * r2);
  const prolate = r2 > eqProlate ? surfaceAreaProlate(eqProlate, r2) : surfaceAreaProlate(eqProlate, eqProlate);
  const oblate = r0 < eqOblate ? surfaceAreaOblate(eqOblate, r0) : surfaceAreaOblate(eqOblate, eqOblate);
  return { prolate, oblate };
}

// High-res Monte-Carlo cross-check over (theta, phi) parameter space
function surfaceAreaMonteCarlo(axes: HullAxes, samples = AREA_MONTE_CARLO_SAMPLES) {
  const thetaSpan = 2 * Math.PI;
  const eps = 1e-6; // avoid poles where parameterization becomes singular
  const phiMin = -Math.PI / 2 + eps;
  const phiMax = Math.PI / 2 - eps;
  const phiSpan = phiMax - phiMin;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const theta = Math.random() * thetaSpan;
    const phi = phiMin + Math.random() * phiSpan;
    const { dA } = firstFundamentalForm(axes.a, axes.b, axes.c, theta, phi);
    sum += dA;
    sumSq += dA * dA;
  }
  const mean = sum / Math.max(samples, 1);
  const variance = Math.max(0, sumSq / Math.max(samples, 1) - mean * mean);
  const stderr = Math.sqrt(variance / Math.max(samples, 1));
  const area = mean * thetaSpan * phiSpan;
  return { value: area, stderr: stderr * thetaSpan * phiSpan, samples };
}

/** Ellipsoid surface area via induced metric integral (replaces Knud-Thomsen).
 *  a = Lx/2, b = Ly/2, c = Lz/2 (meters). Numerical quadrature over (theta, phi).
 *  Returns value +- uncertainty (max deviation across metric, Monte-Carlo, and axisymmetric approximations).
 */
function surfaceAreaEllipsoidMetric(
  Lx_m: number,
  Ly_m: number,
  Lz_m: number,
  nTheta = 256,
  nPhi = 128,
  sectorCount?: number,
): SurfaceAreaEstimate {
  const axes: HullAxes = { a: Lx_m / 2, b: Ly_m / 2, c: Lz_m / 2 };
  const dTheta = (2 * Math.PI) / nTheta;
  const dPhi = Math.PI / Math.max(1, nPhi - 1); // phi in [-pi/2, pi/2]
  const sectors = Number.isFinite(sectorCount) && (sectorCount as number) > 0
    ? Math.max(1, Math.floor(sectorCount as number))
    : 0;
  const sectorAreas = sectors > 0 ? new Array(sectors).fill(0) : null;
  let areaMetric = 0;
  for (let i = 0; i < nTheta; i++) {
    const theta = i * dTheta;
    for (let j = 0; j < nPhi; j++) {
      const phi = -Math.PI / 2 + j * dPhi;
      const { dA } = firstFundamentalForm(axes.a, axes.b, axes.c, theta, phi);
      areaMetric += dA * dTheta * dPhi;
      if (sectorAreas) {
        const u = (theta < 0 ? theta + 2 * Math.PI : theta) / (2 * Math.PI);
        const idx = Math.min(sectors - 1, Math.floor(u * sectors));
        sectorAreas[idx] += dA * dTheta * dPhi;
      }
    }
  }

  const mc = surfaceAreaMonteCarlo(axes);
  const approx = surfaceAreaAxisymmetricApproximations(axes);

  const deviations: number[] = [];
  if (Number.isFinite(mc.value)) deviations.push(Math.abs(mc.value - areaMetric));
  if (Number.isFinite(approx.prolate ?? NaN)) deviations.push(Math.abs((approx.prolate as number) - areaMetric));
  if (Number.isFinite(approx.oblate ?? NaN)) deviations.push(Math.abs((approx.oblate as number) - areaMetric));

  const maxDeviation = deviations.length ? Math.max(...deviations) : 0;
  const sigmaMc = Number.isFinite(mc.stderr) ? Math.abs(mc.stderr) : 0;
  const uncertainty = Math.max(areaMetric * 1e-6, maxDeviation, sigmaMc); // tiny floor to avoid zero band
  const band = {
    min: Math.max(0, areaMetric - uncertainty),
    max: areaMetric + uncertainty,
  };

  return {
    value: areaMetric,
    uncertainty,
    band,
    sectorAreas: sectorAreas ?? undefined,
    sectors: sectorAreas ? sectors : undefined,
    components: {
      metric: areaMetric,
      monteCarlo: { value: mc.value, stderr: mc.stderr, samples: mc.samples },
      prolateApprox: approx.prolate,
      oblateApprox: approx.oblate,
    },
  };
}

// Initialize pipeline state with defaults
export function initializePipelineState(): EnergyPipelineState {
  return {
    // Needle Hull full scale defaults for HELIX-CORE (paper-authentic)
    tileArea_cm2: 25,  // 5++¦5 cm tiles (was 5 cm--ª, now 25 cm--ª)
    tilePitch_m: Math.sqrt((25 * CM2_TO_M2) / PAPER_GEO.PACKING),
    gap_nm: PROMOTED_WARP_PROFILE.gap_nm,
    sag_nm: 16,
    temperature_K: 20,
    modulationFreq_GHz: DEFAULT_MODULATION_FREQ_GHZ,
    couplingFrameFill: PAPER_GEO.PACKING,
    couplingChiOverride: undefined,
    couplingSupercellTiles: undefined,
    couplingSupercellEnergy_J: undefined,

    // Hull geometry (actual 1.007 km needle dimensions)
    hull: {
      Lx_m: NHM2_FULL_HULL_DIMENSIONS_M.Lx_m,  // length (needle axis)
      Ly_m: NHM2_FULL_HULL_DIMENSIONS_M.Ly_m,  // width
      Lz_m: NHM2_FULL_HULL_DIMENSIONS_M.Lz_m,  // height
      wallThickness_m: DEFAULT_WALL_THICKNESS_M  // Matches 15 GHz dwell (~0.02 m); override for paper 1 m stack
    },
    warpFieldType: PROMOTED_WARP_PROFILE.warpFieldType,
    warpGeometry: null,
    warpGeometryKind: 'ellipsoid',
    warpGeometryAssetId: undefined,

    // Nat+írio / warp-bubble defaults (ensures nonzero snapshot solves)
    bubble: {
      beta: 0.15,   // translation fraction (0..1)
      sigma: 35,    // wall width (m)
      R: 280,       // bubble radius (m)
      dutyGate: undefined,
    },
    // Top-level mirrors for legacy clients
    beta: 0.15,
    sigma: 35,
    R: 280,

    // Mode defaults (hover)
    currentMode: 'hover',
    massMode: DEFAULT_MASS_MODE,
    massSource: "model",
    massDatasetId: undefined,
    massFitResiduals: undefined,
    dutyCycle: PROMOTED_WARP_PROFILE.dutyCycle,
    dutyShip: PROMOTED_WARP_PROFILE.dutyShip, // Ship-wide effective duty (will be recalculated)
    sectorCount: PROMOTED_WARP_PROFILE.sectorCount,
    concurrentSectors: PROMOTED_WARP_PROFILE.concurrentSectors,
    sectorStrobing: PROMOTED_WARP_PROFILE.concurrentSectors, // Legacy alias
    qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
    negativeFraction: DEFAULT_NEGATIVE_FRACTION,
    strobeHz: Number(process.env.STROBE_HZ ?? 1000),
    phase01: 0,
    sigmaSector: 0.05,
    splitEnabled: false,
    splitFrac: 0.6,

    // Pulsed-load ceilings (defaults mirrored in docs; override when bench data lands)
    iPeakMaxMidi_A: DEFAULT_PULSED_CURRENT_LIMITS_A.midi,
    iPeakMaxSector_A: DEFAULT_PULSED_CURRENT_LIMITS_A.sector,
    iPeakMaxLauncher_A: DEFAULT_PULSED_CURRENT_LIMITS_A.launcher,

    // Physics defaults (paper-backed)
    gammaGeo: PROMOTED_WARP_PROFILE.gammaGeo,
    qMechanical: 1,               // Set to 1 (was 5e4) - power knob only
    qCavity: PROMOTED_WARP_PROFILE.qCavity,
    gammaVanDenBroeck: PROMOTED_WARP_PROFILE.gammaVanDenBroeck,
    exoticMassTarget_kg: 1405,    // Reference target (not a lock)
    casimirModel: 'ideal_retarded',
    ampFactors: {
      gammaGeo: PROMOTED_WARP_PROFILE.gammaGeo,
      gammaVanDenBroeck: PROMOTED_WARP_PROFILE.gammaVanDenBroeck,
      qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
      qMechanical: 1,
      qCavity: PROMOTED_WARP_PROFILE.qCavity,
    },
    amps: {
      gammaGeo: PROMOTED_WARP_PROFILE.gammaGeo,
      gammaVanDenBroeck: PROMOTED_WARP_PROFILE.gammaVanDenBroeck,
      qSpoilingFactor: PROMOTED_WARP_PROFILE.qSpoilingFactor,
      qMechanical: 1,
      qCavity: PROMOTED_WARP_PROFILE.qCavity,
    },

    // Initial calculated values
    U_static: 0,
    U_static_nominal: 0,
    U_static_realistic: 0,
    U_static_uncoupled: 0,
    U_static_band: { min: 0, max: 0 },
    casimirRatio: 1,
    lifshitzSweep: [],
    couplingChi: 1,
    couplingMethod: 'analytic',
    couplingNote: '',
    supercellRatio: 1,
    U_geo: 0,
    U_Q: 0,
    U_cycle: 0,
    P_loss_raw: 0,
    P_avg: 0,
    P_target_W: 0,
    P_cap_W: 0,
    physicsCap_W: 0,
    P_applied_W: 0,
    beta_trans_power: 0,
    beta_policy: 0,
    shipBeta: 0,
    vShip_mps: 0,
    speedClosure: 'policyA',
    busVoltage_kV: 0,
    busCurrent_A: 0,
    M_exotic: 0,
    M_exotic_raw: 0,
    massCalibration: 1,
    TS_ratio: 0,
    zeta: 0,
    N_tiles: 0,

    // Sector management
    tilesPerSector: 0,
    activeSectors: PROMOTED_WARP_PROFILE.concurrentSectors,
    activeTiles: 0,
    activeFraction: 0,

    // Status
    fordRomanCompliance: true,
    natarioConstraint: true,
    curvatureLimit: true,
    overallStatus: 'NOMINAL',

    atmDensity_kg_m3: null,
    altitude_m: null,

    dynamicConfig: null,
    vacuumGapSweepResults: [],
    vacuumGapSweepRowsTotal: 0,
    vacuumGapSweepRowsDropped: 0,
    hardwareTruth: {
      totals: { visible: 0, total: 0, dropped: 0 },
      updatedAt: 0,
      sectorState: null,
      qiSample: null,
      spectrumFrame: null,
      strobeDuty: null,
    },
    gateAnalytics: null,
    qiAutothrottle: initQiAutothrottle(),
    qiAutoscale: initQiAutoscaleState(
      Number.isFinite(QI_AUTOSCALE_TARGET) ? Math.max(1e-6, QI_AUTOSCALE_TARGET) : 0.9,
      Date.now(),
    ),
    sweep: {
      active: false,
      status: 'idle',
      top: [],
      last: null,
      cancelRequested: false,
      cancelled: false,
      activeSlew: false,
    },
  };
}

// Legacy calculateHullArea function removed - now using surfaceAreaEllipsoidFromHullDims

// Calculate static Casimir energy using corrected physics
function calculateStaticCasimir(gap_nm: number, area_m2: number): number {
  const gap_m   = gap_nm * NM_TO_M;
  const E_overA = -(Math.PI * Math.PI * HBAR_C) / (720 * Math.pow(gap_m, 3)); // J/m^2
  return E_overA * area_m2; // J
}

// Cache removed - surfaceAreaEllipsoidMetric is called directly for accuracy

// Main pipeline calculation
export async function calculateEnergyPipeline(
  state: EnergyPipelineState,
  opts: PipelineRunOptions = {},
): Promise<EnergyPipelineState> {
  // Monotonic tick + uptime telemetry for pipeline snapshots
  const nowMs = Date.now();
  const prevTick = Number.isFinite((state as any).__tick) ? Number((state as any).__tick) : -1;
  (state as any).__tick = prevTick + 1;
  (state as any).__uptime_ms = Math.floor(process.uptime() * 1000);
  (state as any).__last_calc_ms = nowMs;

  // Allow callers to override MODEL_MODE for paper/raw profiles (falls back to env default)
  const modelMode: 'calibrated' | 'raw' =
    state.modelMode === 'raw' || state.modelMode === 'calibrated'
      ? state.modelMode
      : MODEL_MODE;
  const policyMassMode = MODE_POLICY[state.currentMode]?.massMode;
  const massMode = resolveMassMode(state.massMode ?? policyMassMode);
  let casimirScaleApplied = 1;
  let measuredScaleApplied = false;
  let measuredScaleValue: number | undefined;
  let measuredScaleSigma: number | undefined;
  let measuredScaleRelSigma: number | undefined;
  let measuredDatasetId: string | undefined;
  let measuredFitResiduals: CasimirForceInference["fitResiduals"] | undefined;

  // Thread warp geometry controls from dynamic config into top-level fields for downstream consumers
  const dynWarpGeom = (state.dynamicConfig as any)?.warpGeometry;
  if ((state.dynamicConfig as any)?.warpFieldType) {
    state.warpFieldType = (state.dynamicConfig as any).warpFieldType as WarpFieldType;
  }
  if (dynWarpGeom) {
    state.warpGeometry = {
      ...(state.warpGeometry ?? {}),
      ...(dynWarpGeom as WarpGeometrySpec),
      geometryKind: (dynWarpGeom as WarpGeometrySpec)?.geometryKind ?? (dynWarpGeom as any)?.kind ?? (state.warpGeometry ?? {}).geometryKind,
    };
    state.warpGeometryKind =
      (dynWarpGeom as WarpGeometrySpec)?.geometryKind ?? (dynWarpGeom as any)?.kind ?? state.warpGeometryKind ?? 'ellipsoid';
    state.warpGeometryAssetId = (dynWarpGeom as WarpGeometrySpec)?.assetId ?? state.warpGeometryAssetId;
  } else {
    state.warpGeometryKind = state.warpGeometryKind ?? state.warpGeometry?.geometryKind ?? 'ellipsoid';
  }
  if (!state.warpFieldType) {
    state.warpFieldType = PROMOTED_WARP_PROFILE.warpFieldType;
  }

  // --- Surface area & tile count from actual hull dims ---
  const tileArea_m2 = state.tileArea_cm2 * CM2_TO_M2;
  const sectorCountHint = Math.max(
    1,
    Math.floor(state.sectorCount || PROMOTED_WARP_PROFILE.sectorCount),
  );

  // If a full rectangular needle + rounded caps is added later, we can refine this.
  // For now, the ellipsoid (a=Lx/2, b=Ly/2, c=Lz/2) is an excellent approximation.
  const hullDims = resolveHullGeometry(state);
  // Proper surface area from induced metric (ellipsoid shell)
  const hullArea = surfaceAreaEllipsoidMetric(
    hullDims.Lx_m,
    hullDims.Ly_m,
    hullDims.Lz_m,
    256,
    128,
    sectorCountHint,
  );
  const hullAreaEllipsoid_m2 = hullArea.value;
  const ellipsoidSectorAreas = Array.isArray(hullArea.sectorAreas) ? hullArea.sectorAreas.slice() : null;
  const overrideArea = Number(state.hullAreaOverride_m2);
  const hasOverride = Number.isFinite(overrideArea) && overrideArea > 0;
  const overrideUnc = hasOverride
    ? Math.max(0, Number(state.hullAreaOverride_uncertainty_m2) || 0)
    : Math.abs(hullArea.uncertainty ?? 0);
  const hullArea_m2 = hasOverride ? (overrideArea as number) : hullAreaEllipsoid_m2;
  const hullAreaBand = hasOverride
    ? {
        min: Math.max(0, hullArea_m2 - overrideUnc),
        max: hullArea_m2 + overrideUnc,
      }
    : hullArea.band ?? {
        min: Math.max(0, hullArea_m2 - Math.abs(hullArea.uncertainty ?? 0)),
        max: hullArea_m2 + Math.abs(hullArea.uncertainty ?? 0),
      };

  // Store hull area for Bridge display + provenance
  state.hullArea_m2 = hullArea_m2;
  state.hullArea = {
    ...hullArea,
    value: hullArea_m2,
    uncertainty: overrideUnc,
    band: hullAreaBand,
  };
  state.__hullAreaEllipsoid_m2 = hullAreaEllipsoid_m2;
  state.__hullAreaSource = hasOverride ? "override" : "ellipsoid";

  // 1) N_tiles G+ç+¦ paper-authentic tile census
  const surfaceTiles = Math.floor(hullArea_m2 / tileArea_m2);
  const surfaceTilesMin = Math.floor(hullAreaBand.min / tileArea_m2);
  const surfaceTilesMax = Math.ceil(hullAreaBand.max / tileArea_m2);
  const layerPacking = PAPER_GEO.RADIAL_LAYERS * PAPER_GEO.PACKING;
  const tilesNominal = surfaceTiles * layerPacking;
  const tilesBand = {
    min: Math.max(1, Math.floor(surfaceTilesMin * layerPacking)),
    max: Math.max(1, Math.ceil(surfaceTilesMax * layerPacking)),
  };
  // Use centralized PAPER_GEO constants
  state.N_tiles = Math.max(1, Math.round(tilesNominal));
  state.N_tiles_band = tilesBand;

  // Surface packing factor for future geometry modules to replace fudge
  (state as any).__packing = PAPER_GEO.PACKING;
  (state as any).tileArea_m2 = tileArea_m2;
  (state as any).hullArea_band = hullAreaBand;

  // Step 1: Static Casimir energy with coupling/packing correction
  const frameFill = Number.isFinite(state.couplingFrameFill)
    ? Math.max(0, Math.min(1, state.couplingFrameFill as number))
    : PAPER_GEO.PACKING;
  state.couplingFrameFill = frameFill;

  const tilePitch_m = Number.isFinite(state.tilePitch_m) && (state.tilePitch_m as number) > 0
    ? (state.tilePitch_m as number)
    : Math.sqrt(tileArea_m2 / Math.max(frameFill, 1e-9));
  state.tilePitch_m = tilePitch_m;

  // Mechanical feasibility budget (stiction / buckling guard)
  const requestedGap_nm = Number.isFinite(state.gap_nm) ? Number(state.gap_nm) : 1;
  state.gap_nm = requestedGap_nm;
  const safetyFloor = modelMode === 'raw' ? MECH_SAFETY_MIN_RAW : MECH_SAFETY_MIN_CAL;
  const mechConfig =
    modelMode === 'raw'
      ? {
          elasticModulus_Pa: MECH_ELASTIC_MODULUS_RAW_PA,
          thickness_m: MECH_TILE_THICKNESS_RAW_M,
          spanScale: MECH_SPAN_SCALE_RAW,
        }
      : {
          elasticModulus_Pa: MECH_ELASTIC_MODULUS_PA,
          thickness_m: MECH_TILE_THICKNESS_M,
          spanScale: MECH_SPAN_SCALE_CAL,
        };
  const mech = mechanicalFeasibility(state, tileArea_m2, safetyFloor, mechConfig);
  const constrainedGap_nm = Number.isFinite(mech.recommendedGap_nm)
    ? Math.max(requestedGap_nm, mech.recommendedGap_nm)
    : requestedGap_nm;
  const gapForCasimir_nm = modelMode === 'calibrated' ? constrainedGap_nm : requestedGap_nm;
  state.gap_nm = gapForCasimir_nm;
  (state as any).mechanical = {
    ...mech,
    constrainedGap_nm,
    casimirGap_nm: gapForCasimir_nm,
    modelMode,
    unattainable:
      mech.recommendedGap_nm > requestedGap_nm + 1e-9 ||
      !mech.feasible ||
      !mech.safetyFeasible ||
      !mech.strokeFeasible,
    requestedGap_nm,
  };
  (state as any).strokeAmplitude_pm = mech.requestedStroke_pm;

  const tileRadius_m = Math.sqrt(tileArea_m2 / Math.PI);
  const couplingSpec = {
    chi: Number.isFinite(state.couplingChiOverride)
      ? Math.max(0, Math.min(1, state.couplingChiOverride as number))
      : undefined,
    pitch_m: tilePitch_m,
    frameFill,
    supercell:
      Number.isFinite(state.couplingSupercellTiles) || Number.isFinite(state.couplingSupercellEnergy_J)
        ? {
            tiles: Number.isFinite(state.couplingSupercellTiles)
              ? Number(state.couplingSupercellTiles)
              : undefined,
            energy_J: Number.isFinite(state.couplingSupercellEnergy_J)
              ? Number(state.couplingSupercellEnergy_J)
              : undefined,
          }
        : undefined,
  };

  try {
    const casimir = calculateCasimirEnergy({
      geometry: 'parallel_plate',
      gap: state.gap_nm,
      radius: tileRadius_m * 1e6, // -¦m
      sagDepth: state.sag_nm,
      temperature: state.temperature_K,
      materialModel: state.casimirModel ?? 'ideal_retarded',
      materialProps: state.materialProps,
      material: 'PEC',
      moduleType: 'static',
      coupling: couplingSpec,
    } as any);

    const energyNominal = casimir.nominalEnergy ?? casimir.totalEnergy;
    const energyRealistic = casimir.realisticEnergy ?? casimir.totalEnergy;
    const energyUncoupled = casimir.uncoupledEnergy ?? energyRealistic ?? casimir.totalEnergy;
    const baseBand = casimir.energyBand ?? {
      min: energyRealistic ?? casimir.totalEnergy,
      max: energyRealistic ?? casimir.totalEnergy,
    };
    const modeScale = modelMode === 'raw' ? 2 : 1;

    state.casimirModel = casimir.model ?? state.casimirModel;
    state.U_static_nominal = energyNominal;
    state.U_static_realistic = energyRealistic;
    state.U_static_uncoupled = energyUncoupled;
    state.U_static_band = {
      min: baseBand.min * modeScale,
      max: baseBand.max * modeScale,
    };
    state.casimirRatio = casimir.modelRatio ?? 1;
    state.lifshitzSweep = casimir.lifshitzSweep ?? state.lifshitzSweep;
    state.couplingChi = casimir.couplingChi ?? couplingSpec.chi ?? state.couplingChi ?? 1;
    state.couplingMethod = casimir.couplingMethod ?? state.couplingMethod;
    state.couplingNote = casimir.couplingNote ?? state.couplingNote;
    state.supercellRatio = casimir.supercellRatio ?? state.supercellRatio;
    state.U_static = (energyRealistic ?? casimir.totalEnergy) * modeScale;
  } catch (err) {
    if (DEBUG_PIPE) console.warn("[PIPELINE] Casimir material model fell back to PEC", err);
    const fallback = calculateStaticCasimir(state.gap_nm, tileArea_m2);
    const chi = Number.isFinite(couplingSpec.chi) ? (couplingSpec.chi as number) : 1;
    state.U_static = fallback * chi;
    state.U_static_nominal = fallback;
    state.U_static_realistic = fallback * chi;
    state.U_static_uncoupled = fallback;
    state.U_static_band = { min: state.U_static, max: state.U_static };
    state.casimirRatio = 1;
    state.couplingChi = chi;
    state.couplingMethod = 'fallback';
    state.supercellRatio = chi;
  }

  const forceDataset = state.experimental?.casimirForce;
  if (massMode === "MEASURED_FORCE_INFERRED" && forceDataset) {
    try {
      const energyInference = inferEnergyFromForceSeries(forceDataset);
      const scaleInference = inferCasimirForceScale(forceDataset);
      const forceSign = energyInference.forceSign ?? scaleInference?.forceSign;
      let note: string | undefined;
      if (
        scaleInference &&
        Number.isFinite(scaleInference.kCasimir) &&
        scaleInference.kCasimir > 0
      ) {
        const scale = scaleInference.kCasimir;
        casimirScaleApplied = scale;
        measuredScaleApplied = true;
        measuredScaleValue = scale;
        measuredScaleSigma = scaleInference.sigmaK;
        measuredDatasetId = forceDataset.datasetId;
        measuredFitResiduals = scaleInference.fitResiduals;
        state.U_static *= scale;
        if (Number.isFinite(state.U_static_nominal)) {
          state.U_static_nominal = state.U_static_nominal * scale;
        }
        if (Number.isFinite(state.U_static_realistic)) {
          state.U_static_realistic = state.U_static_realistic * scale;
        }
        if (Number.isFinite(state.U_static_uncoupled)) {
          state.U_static_uncoupled = state.U_static_uncoupled * scale;
        }
        if (state.U_static_band) {
          state.U_static_band = {
            min: state.U_static_band.min * scale,
            max: state.U_static_band.max * scale,
          };
        } else {
          state.U_static_band = { min: state.U_static, max: state.U_static };
        }
        note = "scale_applied";
      } else {
        note = scaleInference ? "invalid_scale" : "scale_unavailable";
      }

      state.casimirForceInference = {
        datasetId: forceDataset.datasetId,
        referenceSeparation_m: energyInference.referenceSeparation_m,
        energy_J_at_a0: energyInference.energy_J_at_a0,
        sigmaEnergy_J: energyInference.sigmaEnergy_J,
        kCasimir: scaleInference?.kCasimir,
        sigmaK: scaleInference?.sigmaK,
        sampleCount: scaleInference?.sampleCount ?? energyInference.sampleCount,
        fitResiduals: scaleInference?.fitResiduals,
        forceSign,
        note,
      };
    } catch (err) {
      if (DEBUG_PIPE) console.warn("[PIPELINE] Casimir force inference failed", err);
      const errCode =
        err && typeof err === "object" && "code" in err ? (err as any).code : null;
      const forceSign =
        err && typeof err === "object" && "forceSign" in err
          ? (err as any).forceSign
          : undefined;
      state.casimirForceInference = {
        datasetId: forceDataset.datasetId,
        forceSign,
        note:
          errCode === "CASIMIR_FORCE_SIGN_MISMATCH"
            ? "force_sign_mismatch"
            : "inference_failed",
      };
    }
  } else {
    state.casimirForceInference = undefined;
  }
  if (
    measuredScaleApplied &&
    Number.isFinite(measuredScaleValue) &&
    (measuredScaleValue as number) > 0 &&
    Number.isFinite(measuredScaleSigma)
  ) {
    measuredScaleRelSigma = Math.abs(
      (measuredScaleSigma as number) / (measuredScaleValue as number),
    );
  }

  // Aggregate static energy band with geometry uncertainty propagated through tile census
  const perTileBand = state.U_static_band ?? { min: state.U_static, max: state.U_static };
  const tileBand = state.N_tiles_band ?? { min: state.N_tiles, max: state.N_tiles };
  const totalCandidates = [
    perTileBand.min * tileBand.min,
    perTileBand.min * tileBand.max,
    perTileBand.max * tileBand.min,
    perTileBand.max * tileBand.max,
  ];
  state.U_static_total = state.U_static * state.N_tiles;
  state.U_static_total_band = {
    min: Math.min(...totalCandidates),
    max: Math.max(...totalCandidates),
  };

  // 3) Apply mode config EARLY (right after reading currentMode)
  const modeConfig = MODE_CONFIGS[state.currentMode];
  if (!modeConfig) {
    if (DEBUG_PIPE) console.warn("[PIPELINE_UI] Unknown mode", state.currentMode, "- defaulting to hover");
    state.currentMode = 'hover';
  }
  const ui = modeConfig ?? MODE_CONFIGS.hover;
  state.dutyCycle = ui.dutyCycle;
  state.qSpoilingFactor = ui.qSpoilingFactor;
  const ampInputs = (state.ampFactors ?? (state as any).amps ?? {}) as AmpFactors;
  const dynConfig = (state.dynamicConfig ?? {}) as Record<string, unknown>;
  const resolveControl = (
    measured: number | undefined,
    design: number | undefined,
    designSource: ControlSource,
  ): { value: number | undefined; source: ControlSource } => {
    if (Number.isFinite(measured)) {
      return { value: Number(measured), source: "measured" };
    }
    if (Number.isFinite(design)) {
      return { value: Number(design), source: designSource };
    }
    return { value: undefined, source: designSource };
  };

  const modulationResolved = resolveControl(
    firstFinite(
      (dynConfig as any).measuredModulationFreqGHz,
      (state as any).measuredModulationFreq_GHz,
    ),
    firstFinite((dynConfig as any).modulationFreqGHz, state.modulationFreq_GHz),
    "design",
  );
  if (modulationResolved.value != null) {
    state.modulationFreq_GHz = modulationResolved.value;
  }
  state.modulationFreqSource = modulationResolved.source;

  const cavityResolved = resolveControl(
    firstFinite(
      (dynConfig as any).measuredCavityQ,
      (ampInputs as any).measuredCavityQ,
      (state as any).measuredCavityQ,
    ),
    firstFinite((dynConfig as any).cavityQ, ampInputs.qCavity, state.qCavity),
    "design",
  );
  if (cavityResolved.value != null) {
    state.qCavity = cavityResolved.value;
  }
  state.qCavitySource = cavityResolved.source;

  const gammaGeoResolved = resolveControl(
    firstFinite((ampInputs as any).measuredGammaGeo, (state as any).measuredGammaGeo),
    firstFinite(ampInputs.gammaGeo, state.gammaGeo),
    "design",
  );
  if (gammaGeoResolved.value != null) {
    state.gammaGeo = gammaGeoResolved.value;
  }
  state.gammaGeoSource = gammaGeoResolved.source;

  const gammaVdBResolved = resolveControl(
    firstFinite(
      (ampInputs as any).measuredGammaVanDenBroeck,
      (state as any).measuredGammaVanDenBroeck,
    ),
    firstFinite(ampInputs.gammaVanDenBroeck, state.gammaVanDenBroeck),
    "design",
  );
  if (gammaVdBResolved.value != null) {
    state.gammaVanDenBroeck = gammaVdBResolved.value;
  }
  state.gammaVanDenBroeckSource = gammaVdBResolved.source;

  const qSpoilMeasured = firstFinite(
    (ampInputs as any).measuredQSpoilingFactor,
    (state as any).measuredQSpoilingFactor,
  );
  const qSpoilDesign = firstFinite(ampInputs.qSpoilingFactor);
  const qSpoilResolved = resolveControl(
    qSpoilMeasured,
    qSpoilDesign,
    qSpoilDesign != null ? "design" : "policy",
  );
  if (qSpoilResolved.value != null) {
    state.qSpoilingFactor = qSpoilResolved.value;
  }
  state.qSpoilingFactorSource = qSpoilResolved.source;

  const dutyMeasured = firstFinite(
    (dynConfig as any).measuredDutyCycle,
    (state as any).measuredDutyCycle,
  );
  const dutyDesign = firstFinite((dynConfig as any).dutyCycle);
  const dutyResolved = resolveControl(
    dutyMeasured,
    dutyDesign,
    dutyDesign != null ? "design" : "policy",
  );
  if (dutyResolved.value != null) {
    state.dutyCycle = clampNumber(dutyResolved.value, 0, 1);
  }
  state.dutyCycleSource = dutyResolved.source;

  const dutyLocalOverride =
    dutyResolved.source === "policy" ? undefined : dutyResolved.value;
  const dutyShipMeasured = firstFinite(
    (dynConfig as any).measuredSectorDuty,
    (state as any).measuredSectorDuty,
  );
  const dutyShipDesign = firstFinite((dynConfig as any).sectorDuty);
  const dutyShipOverride = firstFinite(dutyShipMeasured, dutyShipDesign);
  const dutyShipSource: ControlSource =
    Number.isFinite(dutyShipMeasured)
      ? "measured"
      : Number.isFinite(dutyShipDesign)
        ? "design"
        : "schedule";
  const sectorCountMeasured = firstFinite(
    (dynConfig as any).measuredSectorCount,
    (state as any).measuredSectorCount,
  );
  const sectorCountDesign = firstFinite((dynConfig as any).sectorCount, state.sectorCount);

  // keep sector policy from resolveSLive just below; don't touch sectorCount here

  // 4) Sector scheduling - prefer measured event stream over schedule
  const strobeDuty = (state.hardwareTruth as any)?.strobeDuty;
  const measuredDutyEffective = (() => {
    if (!strobeDuty) return undefined;
    const duty = Number(
      strobeDuty.dutyAvg ??
      (strobeDuty as any).avg ??
      (strobeDuty as any).dutyEffective ??
      (strobeDuty as any).dutyEffectiveFR
    );
    if (!Number.isFinite(duty)) return undefined;
    const last = Number((strobeDuty as any).lastSampleAt ?? (strobeDuty as any).updatedAt);
    const windowMs = Number(
      (strobeDuty as any).windowMs ?? (strobeDuty as any).window_ms ?? STROBE_DUTY_WINDOW_MS_DEFAULT
    );
    const freshness = Math.max(2500, Number.isFinite(windowMs) && windowMs > 0 ? windowMs * 2 : STROBE_DUTY_STALE_MS);
    if (Number.isFinite(last) && Date.now() - last > freshness) return undefined;
    return clampNumber(duty, 0, 1);
  })();

  const measuredTotal = Number((strobeDuty as any)?.sTotal);
  const measuredLive = Number((strobeDuty as any)?.sLive);
  const scheduledLive = resolveSLive(state.currentMode);
  const sectorTotalResolved = Number.isFinite(measuredTotal) && measuredTotal > 0
    ? measuredTotal
    : Number.isFinite(sectorCountMeasured) && (sectorCountMeasured as number) > 0
      ? sectorCountMeasured
      : Number.isFinite(sectorCountDesign) && (sectorCountDesign as number) > 0
        ? sectorCountDesign
        : state.sectorCount || PROMOTED_WARP_PROFILE.sectorCount;
  const sectorCountSource: ControlSource =
    Number.isFinite(measuredTotal) && measuredTotal > 0
      ? "measured"
      : Number.isFinite(sectorCountMeasured) && (sectorCountMeasured as number) > 0
        ? "measured"
        : Number.isFinite(sectorCountDesign) && (sectorCountDesign as number) > 0
          ? "design"
          : "design";
  const S_total = Math.max(
    1,
    Math.round(sectorTotalResolved ?? PROMOTED_WARP_PROFILE.sectorCount),
  );
  let S_live = Number.isFinite(measuredLive) && measuredLive >= 0
    ? measuredLive
    : scheduledLive;
  if (!Number.isFinite(measuredLive) && Number.isFinite(state.activeSectors)) {
    S_live = state.activeSectors;
  } else if (!Number.isFinite(measuredLive) && Number.isFinite(state.concurrentSectors)) {
    S_live = state.concurrentSectors;
  }
  S_live = Math.max(0, S_live);
  const S_live_int = Math.max(0, Math.round(S_live));

  // if standby, FR duty must be exactly zero for viewers/clients
  const isStandby = String(state.currentMode || '').toLowerCase() === 'standby';
  const dutyLocal = clampNumber(
    Number.isFinite(dutyLocalOverride)
      ? (dutyLocalOverride as number)
      : Number.isFinite(state.dutyBurst)
        ? (state.dutyBurst as number)
        : Number.isFinite((state as any).localBurstFrac)
          ? (state as any).localBurstFrac
      : Number.isFinite(state.dutyCycle)
        ? state.dutyCycle
            : PROMOTED_WARP_PROFILE.dutyCycle,
    0,
    1,
  );
  const d_eff_fallback = Number.isFinite(dutyShipOverride)
    ? clampNumber(dutyShipOverride as number, 0, 1)
    : dutyLocal * (S_live / Math.max(1, S_total));
  const d_eff = isStandby ? 0 : (measuredDutyEffective ?? d_eff_fallback);

  state.sectorCount       = S_total;
  state.concurrentSectors = S_live_int;
  state.activeSectors     = S_live_int;
  state.activeFraction    = Math.max(0, Math.min(1, S_total > 0 ? S_live / S_total : 0));
  state.sectorCountSource = sectorCountSource;

  // Normalize per-sector surface areas (override -> ellipsoid -> uniform)
  const normalizeSectorAreas = (areas: number[] | null | undefined, sectors: number): number[] | null => {
    if (!Array.isArray(areas) || sectors <= 0) return null;
    const out = new Array(sectors).fill(0);
    for (let i = 0; i < sectors; i++) {
      const v = Number((areas as any)[i]);
      out[i] = Number.isFinite(v) && v >= 0 ? v : 0;
    }
    const sum = out.reduce((a, b) => a + b, 0);
    return sum > 0 ? out : null;
  };

  const sectorAreasOverride = normalizeSectorAreas(state.hullAreaPerSector_m2, S_total);
  const sectorAreasEllipsoid = normalizeSectorAreas(ellipsoidSectorAreas, S_total);
  let sectorAreas = sectorAreasOverride ?? sectorAreasEllipsoid;
  let sectorAreaSource: "override" | "ellipsoid" | "uniform" =
    sectorAreasOverride ? "override" : sectorAreasEllipsoid ? "ellipsoid" : "uniform";

  if (!sectorAreas) {
    sectorAreas = new Array(S_total).fill(hullArea_m2 / Math.max(1, S_total));
  }
  const sectorAreaSum = sectorAreas.reduce((a, b) => a + b, 0);
  const sectorAreaScale = sectorAreaSum > 0 ? hullArea_m2 / sectorAreaSum : 1;
  sectorAreas = sectorAreas.map((a) => Math.max(0, a * sectorAreaScale));
  const sectorAreaSumScaled = sectorAreas.reduce((a, b) => a + b, 0);

  // Budget-preserving tile allocation by surface area
  const allocateTilesByArea = (areas: number[], totalTiles: number): number[] => {
    const n = Math.max(1, areas.length);
    const sum = areas.reduce((a, b) => a + b, 0);
    const total = Math.max(0, Math.round(totalTiles));
    const ideal = areas.map((a) => (sum > 0 ? (a / sum) * total : total / n));
    const base = ideal.map((v) => Math.floor(Math.max(0, v)));
    let remainder = total - base.reduce((a, b) => a + b, 0);
    const fracOrder = ideal
      .map((v, idx) => ({ idx, frac: v - base[idx] }))
      .sort((a, b) => b.frac - a.frac);
    const result = base.slice();
    if (remainder > 0) {
      for (let k = 0; k < remainder; k++) {
        const target = fracOrder[k % fracOrder.length]?.idx ?? 0;
        result[target] += 1;
      }
    } else if (remainder < 0) {
      let need = -remainder;
      const order = base
        .map((v, idx) => ({ idx, value: v }))
        .sort((a, b) => b.value - a.value);
      for (let i = 0; i < order.length && need > 0; i++) {
        const idx = order[i].idx;
        if (result[idx] > 0) {
          result[idx] -= 1;
          need -= 1;
          i -= 1; // allow multiple decrements on same sector if needed
        }
      }
    }
    return result;
  };

  const tilesPerSectorVector = allocateTilesByArea(sectorAreas, state.N_tiles);
  const tilesUniformVector = allocateTilesByArea(new Array(S_total).fill(1), state.N_tiles);
  const tilesPerSectorMean = tilesPerSectorVector.reduce((a, b) => a + b, 0) / Math.max(1, S_total);
  const powerDensityScale = tilesPerSectorVector.map((desired, idx) => {
    const uniform = tilesUniformVector[idx] ?? 0;
    if (!(uniform > 0)) return desired > 0 ? null : 0;
    return desired / uniform;
  });

  state.hullAreaPerSector_m2 = sectorAreas;
  state.__hullAreaPerSectorSource = sectorAreaSource;
  state.tilesPerSectorVector = tilesPerSectorVector;
  state.tilesPerSectorUniform = tilesUniformVector;
  state.tilePowerDensityScale = powerDensityScale;
  state.tilesPerSectorStrategy = sectorAreaSource === "uniform" ? "uniform" : "area-weighted";
  if (state.hullArea) {
    state.hullArea = { ...state.hullArea, sectorAreas, sectors: S_total };
  }

  // HINT for clients: fraction of the bubble "visible" from a single concurrent pane.
  // The REAL pane can multiply this with its band/slice coverage to scale extrema and mass proxy.
  (state as any).viewMassFractionHint = state.activeFraction;
  state.tilesPerSector  = Math.max(0, Math.round(tilesPerSectorMean));
  const activeTilesBand = {
    min: Math.max(0, Math.floor((tilesBand.min ?? state.N_tiles) * (S_live_int / Math.max(1, S_total)))),
    max: Math.max(0, Math.ceil((tilesBand.max ?? state.N_tiles) * (S_live_int / Math.max(1, S_total)))),
  };
  state.activeTiles     = Math.max(0, Math.round(tilesPerSectorMean * S_live_int));
  (state as any).tiles = {
    total: state.N_tiles,
    active: state.activeTiles,
    totalBand: tilesBand,
    activeBand: activeTilesBand,
    tileArea_cm2: state.tileArea_cm2,
    hullArea_m2: state.hullArea_m2,
    hullAreaBand_m2: hullAreaBand,
    areaPerSector_m2: sectorAreas,
    areaPerSectorSource: sectorAreaSource,
    areaPerSectorSum_m2: sectorAreaSumScaled,
    tilesPerSectorVector,
    tilesPerSectorUniform: tilesUniformVector,
    tilePowerDensityScale: powerDensityScale,
  };

  // Safety alias for consumers that assume G+½+æ1 sectors for math
  (state as any).concurrentSectorsSafe = Math.max(1, state.concurrentSectors);

  // =-â+¦-¦ expose both duties explicitly and consistently
  const dutyEffectiveSource: ControlSource =
    measuredDutyEffective != null
      ? "measured"
      : Number.isFinite(dutyShipOverride)
        ? dutyShipSource
        : "schedule";
  const dutyBurstSource: ControlSource =
    Number.isFinite(dutyLocalOverride)
      ? (state.dutyCycleSource ?? "design")
      : "schedule";
  state.dutyBurst        = dutyLocal;  // keep as *local* ON-window; prefer measured/local override
  state.dutyBurstSource  = dutyBurstSource;
  state.dutyEffective_FR = d_eff;             // ship-wide effective duty (for +-ª & audits)
  (state as any).dutyEffectiveFR = d_eff; // legacy/camel alias
  (state as any).dutyMeasuredFR = measuredDutyEffective;
  (state as any).dutyEffectiveFRMeasured = measuredDutyEffective;
  (state as any).dutyEffectiveFRSource = dutyEffectiveSource;
  state.sectorDutySource = dutyEffectiveSource;
  (state as any).dutyMeasuredWindow_ms = measuredDutyEffective != null
    ? Number((strobeDuty as any)?.windowMs ?? (strobeDuty as any)?.window_ms ?? STROBE_DUTY_WINDOW_MS_DEFAULT)
    : undefined;
  state.dutyMeasuredFR = measuredDutyEffective ?? undefined;
  // (dutyCycle already set from MODE_CONFIGS above)

  // G-ú+á First-class fields for UI display
  state.dutyShip = d_eff;          // Ship-wide effective duty (promoted from any)
  (state as any).dutyEff = d_eff;  // Legacy alias


  // 5) Stored energy (raw core): ensure valid input values
  // Keep qMechanical non-zero outside of standby
  if (state.qMechanical === 0 && state.currentMode !== 'standby') {
    state.qMechanical = 1; // restore default
  }

  // Clamp gammaGeo to sane range for UI inputs
  state.gammaGeo = Math.max(1, Math.min(1e3, state.gammaGeo));

  // Clamp modulationFreq_GHz to prevent divide-by-zero in TS calculations
  state.modulationFreq_GHz = Math.max(0.001, Math.min(1000, state.modulationFreq_GHz ?? DEFAULT_MODULATION_FREQ_GHZ));

  // Clamp gap_nm to physically reasonable range for Casimir calculations
  state.gap_nm = Math.max(0.1, Math.min(1000, state.gap_nm));

  // Clamp tileArea_cm2 to prevent invalid tile counting
  state.tileArea_cm2 = Math.max(0.01, Math.min(10000, state.tileArea_cm2));

  const gamma3 = Math.pow(state.gammaGeo, 3);
  state.U_geo = state.U_static * gamma3;
  state.U_Q   = state.U_geo * state.qMechanical;

  // 6) Power ? raw first, then power-only calibration via qMechanical
  const omega = 2 * Math.PI * (state.modulationFreq_GHz ?? DEFAULT_MODULATION_FREQ_GHZ) * 1e9;
  const Q = state.qCavity ?? PROMOTED_WARP_PROFILE.qCavity;
  const perTilePower = (qMech: number) => Math.abs(state.U_geo * qMech) * omega / Q; // J/s per tile during ON

  const CALIBRATED = (modelMode === 'calibrated');
  const P_target_W = MODE_POLICY[state.currentMode].P_target_W;

  const modeCap_W = MODE_POLICY[state.currentMode]?.P_cap_W ?? Infinity;
  const physicsCap_W = perTilePower(1) * state.N_tiles * d_eff; // Deliverable with q_mech=1, no policy cap
  const P_cap_W = Math.min(physicsCap_W, modeCap_W); // Deliverable with q_mech=1, capped per mode
  state.P_target_W = P_target_W;
  state.physicsCap_W = physicsCap_W;
  state.P_cap_W = P_cap_W;

  let qMechDemand = state.qMechanical;
  let qMechApplied = state.qMechanical;
  let P_total_W = perTilePower(qMechApplied) * state.N_tiles * d_eff; // ship average

  if (CALIBRATED && P_target_W > 0 && !isStandby && P_total_W > 0) {
    const scaleP = P_target_W / P_total_W;
    qMechDemand = state.qMechanical * scaleP;               // what the solver would like
    qMechApplied = Math.min(1, Math.max(1e-6, qMechDemand)); // but clamp at unity
    state.qMechanical = qMechApplied;
    state.U_Q         = state.U_geo * state.qMechanical;
    P_total_W         = perTilePower(qMechApplied) * state.N_tiles * d_eff;
  } else if (P_target_W === 0 || isStandby) {
    // standby: force qMechanical->0 so stored-energy dissipation is zero
    qMechDemand = 0;
    qMechApplied = 0;
    state.qMechanical = 0;
    state.U_Q         = 0;
    P_total_W         = 0;
  } else {
    // Raw mode or no calibration: honor requested, but stay within safety band
    qMechApplied = Math.min(1, Math.max(1e-6, qMechApplied));
    state.qMechanical = qMechApplied;
    state.U_Q         = state.U_geo * state.qMechanical;
    P_total_W         = perTilePower(qMechApplied) * state.N_tiles * d_eff;
  }

  // Enforce per-mode power cap by scaling qMechanical if needed
  if (P_cap_W > 0 && P_total_W > P_cap_W) {
    const scaleToCap = P_cap_W / Math.max(P_total_W, 1e-12);
    qMechApplied = Math.min(1, Math.max(1e-6, qMechApplied * scaleToCap));
    state.qMechanical = qMechApplied;
    state.U_Q = state.U_geo * state.qMechanical;
    P_total_W = perTilePower(qMechApplied) * state.N_tiles * d_eff;
  }

  // Post-calibration clamping check for qMechanical
  const qMech_before = state.qMechanical;
  if (!isStandby) {
    state.qMechanical = Math.max(1e-6, Math.min(1, state.qMechanical));
  }
  (state as any).qMechanicalClamped = (state.qMechanical !== qMech_before);

  // Mechanical guard telemetry: demand vs applied with capacity and shortfall
  const appliedSafe = Math.max(1e-12, state.qMechanical);
  const mechSpoilage = qMechDemand > 0 ? qMechDemand / appliedSafe : 1;
  const pShortfall_W = Math.max(0, P_target_W - P_total_W);
  const mechanicalSafe = (state as any)?.mechanical?.safetyFeasible !== false;
  state.mechGuard = {
    qMechDemand,
    qMechApplied: state.qMechanical,
    mechSpoilage,
    pCap_W: P_cap_W,
    pApplied_W: P_total_W,
    pShortfall_W,
    status: (!mechanicalSafe && !isStandby)
      ? 'saturated'
      : (P_target_W > 0 && (qMechDemand > 1 || P_total_W >= P_cap_W) && !isStandby) ? 'saturated' : 'ok',
  };

  // Applied ship-average power after caps/guards
  state.P_applied_W = P_total_W;
  (state as any).P_applied_W = P_total_W;

  state.P_loss_raw = Math.abs(state.U_Q) * omega / Q;  // per-tile (with qMechanical)
  state.P_avg      = P_total_W / 1e6; // MW for HUD
  (state as any).P_avg_W = P_total_W; // W (explicit)

  // Derive HV bus voltage/current from per-mode policy and live power
  const busMode = (state.currentMode ?? 'hover') as keyof typeof BUS_VOLTAGE_POLICY_KV;
  const V_bus_kV = BUS_VOLTAGE_POLICY_KV[busMode] ?? BUS_VOLTAGE_POLICY_KV.hover;
  const P_bus_W = Number.isFinite((state as any).P_avg_W)
    ? Number((state as any).P_avg_W)
    : MODE_POLICY[busMode].P_target_W;
  const I_bus_A = V_bus_kV > 0 ? P_bus_W / (V_bus_kV * 1e3) : 0;
  state.busVoltage_kV = V_bus_kV;
  state.busCurrent_A = I_bus_A;
  (state as any).busVoltage_kV = V_bus_kV;
  (state as any).busCurrent_A = I_bus_A;

  // Expose labeled electrical power for dual-bar dashboards
  (state as any).P_elec_MW = state.P_avg;  // Electrical power (same as P_avg, but clearly labeled)
  // --- Cryo power AFTER calibration and AFTER mode qSpoilingFactor is applied ---
  const Q_on  = Q;
  // qSpoilingFactor is idle Q multiplier: >1 G+º+å less idle loss (higher Q_off)
  const Q_off = Math.max(1, Q_on * state.qSpoilingFactor); // use mode-specific qSpoilingFactor
  const P_tile_on   = Math.abs(state.U_Q) * omega / Q_on;
  const P_tile_idle = Math.abs(state.U_Q) * omega / Q_off;
  (state as any).P_cryo_MW = ((P_tile_on * d_eff + P_tile_idle * (1 - d_eff)) * state.N_tiles) / 1e6;

  // 7) Mass - derive from cycle-averaged energy density (no free energy knob)
  const gap_m = Math.max(1e-12, state.gap_nm * NM_TO_M);
  const tileVolume_m3 = Math.max(0, tileArea_m2 * gap_m);
  const baseGammaRequest = Number.isFinite(state.gammaVanDenBroeck)
    ? (state.gammaVanDenBroeck as number)
    : PROMOTED_WARP_PROFILE.gammaVanDenBroeck;
  const guardInputHull = {
    Lx_m: hullDims.Lx_m,
    Ly_m: hullDims.Ly_m,
    Lz_m: hullDims.Lz_m,
    wallThickness_m: (state.hull ?? {}).wallThickness_m ?? hullDims.wallThickness_m,
  };
  const vdbGuard = guardGammaVdB({
    hull: guardInputHull,
    gammaRequested: baseGammaRequest,
  });
  const gammaSeed = Math.min(Math.max(1, baseGammaRequest), vdbGuard.limit);

  const massFromGamma = (gammaVdBValue: number) => {
    const { rho_avg, rho_inst } = enhancedAvgEnergyDensity({
      gap_m,
      gammaGeo: state.gammaGeo,
      cavityQ: Q,
      gammaVanDenBroeck: gammaVdBValue,
      qSpoilingFactor: state.qSpoilingFactor,
      rho0Scale: casimirScaleApplied,
      dutyEff: d_eff,
    });
    const U_inst = rho_inst * tileVolume_m3;
    const U_avg  = rho_avg * tileVolume_m3;
    const M_tot  = (Math.abs(U_avg) / (C * C)) * state.N_tiles;
    return { rho_avg, rho_inst, U_inst, U_avg, M_tot };
  };

  let gammaVanDenBroeck = gammaSeed;
  let massChain = massFromGamma(gammaVanDenBroeck);

  const M_target = MODE_POLICY[state.currentMode].M_target_kg;
  const userM = state.exoticMassTarget_kg ?? M_target;
  const allowTargetCalibration = CALIBRATED && massMode === "TARGET_CALIBRATED";
  let didTargetCalibration = false;
  let targetShortfall = 0;
  if (allowTargetCalibration && userM > 0 && massChain.M_tot > 0) {
    const scaleM = userM / massChain.M_tot;
    const gammaCandidate = gammaVanDenBroeck * scaleM;
    const gammaClamped = Math.max(0, Math.min(gammaCandidate, vdbGuard.limit));
    gammaVanDenBroeck = gammaClamped;
    massChain = massFromGamma(gammaVanDenBroeck);
    didTargetCalibration = true;
    if (gammaCandidate > vdbGuard.limit) {
      targetShortfall = massChain.M_tot / Math.max(userM, 1e-9);
    }
  } else if (userM <= 0 || isStandby) {
    gammaVanDenBroeck = 0;
    massChain = massFromGamma(gammaVanDenBroeck);
  }

  state.gammaVanDenBroeck = gammaVanDenBroeck;
  if (didTargetCalibration) {
    state.gammaVanDenBroeckSource = "target";
  }
  state.M_exotic_raw = massChain.M_tot;
  state.M_exotic     = massChain.M_tot;

  // Post-calibration clamping check for gammaVanDenBroeck
  const gammaVdB_before = baseGammaRequest;
  (state as any).gammaVanDenBroeckClamped =
    (state.gammaVanDenBroeck !== gammaVdB_before) || gammaVdB_before > vdbGuard.limit;

  // Mass calibration readout
  state.massCalibration = state.gammaVanDenBroeck / PAPER_VDB.GAMMA_VDB;
  state.rho_inst = massChain.rho_inst;
  state.rho_avg  = massChain.rho_avg;
  state.rho_static = tileVolume_m3 > 0 ? state.U_static / tileVolume_m3 : undefined;
  state.gammaChain = {
    geo_cubed: Math.pow(state.gammaGeo, 3),
    qGain: Math.sqrt(Math.max(1, Q) / 1e9),
    pocketCompression: state.gammaVanDenBroeck,
    dutyEffective: d_eff,
    qSpoiling: state.qSpoilingFactor,
    note: "rho_avg = rho0 * gamma_geo^3 * sqrt(Q/1e9) * gamma_VdB * q_spoil * d_eff",
  };

  const massSource: MassSource = didTargetCalibration
    ? "target"
    : measuredScaleApplied
    ? "measured"
    : "model";
  state.massSource = massSource;
  state.massDatasetId = massSource === "measured" ? measuredDatasetId : undefined;
  state.massFitResiduals = massSource === "measured"
    ? measuredFitResiduals
    : undefined;
  if (!state.massSource) {
    state.massSource = "model";
  }
    if (state.massSource === "measured" && !state.massDatasetId) {
      (state as any).massSourceNote = "measured_missing_datasetId";
      if (massMode === "MEASURED_FORCE_INFERRED") {
        throw new Error(
          "MEASURED_FORCE_INFERRED requires experimental.casimirForce.datasetId",
      );
    }
    if (DEBUG_PIPE) {
      console.warn("[PIPELINE] massSource=measured requires datasetId; downgrading to model.");
    }
      state.massSource = "model";
      state.massDatasetId = undefined;
      state.massFitResiduals = undefined;
    }
    if (
      state.massSource === "measured" &&
      Number.isFinite(state.M_exotic) &&
      Number.isFinite(measuredScaleRelSigma)
    ) {
      state.massSigma_kg =
        Math.abs(state.M_exotic) * (measuredScaleRelSigma as number);
    } else {
      state.massSigma_kg = undefined;
    }

  const guardForApplied = guardGammaVdB({
    hull: guardInputHull,
    gammaRequested: state.gammaVanDenBroeck,
  });
    state.gammaVanDenBroeckGuard = {
      ...guardForApplied,
      requested: baseGammaRequest,
      targetHit: allowTargetCalibration ? targetShortfall === 0 : undefined,
      targetShortfall: allowTargetCalibration ? (targetShortfall || undefined) : undefined,
    };
    (state as any).gammaVanDenBroeck_guard = state.gammaVanDenBroeckGuard;
    state.vdbRegionII = computeVdbRegionII({
      gammaVdB: state.gammaVanDenBroeck,
      pocketRadius_m: guardForApplied.pocketRadius_m,
      pocketThickness_m: guardForApplied.pocketThickness_m,
    }) ?? undefined;
    const bubbleParams = resolveBubbleWallParams(state);
    const vdbRegionIVBeta = firstFinite(
      (state as any).beta_avg,
      Number((state as any)?.bubble?.beta),
      Number((state as any)?.beta),
      Number((state as any)?.dynamicConfig?.beta),
    );
    state.vdbRegionIV = bubbleParams
      ? computeVdbRegionIV({
          R: bubbleParams.R,
          sigma: bubbleParams.sigma,
          beta: vdbRegionIVBeta,
        }) ?? undefined
      : undefined;
    const vdbRegionIIDerivativeSupport = hasVdbRegionIIMetricSupport(state.vdbRegionII);
    const vdbRegionIVDfdrMaxAbs = Number(state.vdbRegionIV?.dfdr_max_abs);
    const vdbRegionIVDerivativeSupport =
      state.vdbRegionIV?.support === true &&
      Number.isFinite(vdbRegionIVDfdrMaxAbs) &&
      Math.abs(vdbRegionIVDfdrMaxAbs) > VDB_DFDR_MIN_ABS;
    const vdbTwoWallDerivativeSupport =
      vdbRegionIIDerivativeSupport && vdbRegionIVDerivativeSupport;
    (state as any).vdb_region_ii_derivative_support = vdbRegionIIDerivativeSupport;
    (state as any).vdb_region_iv_derivative_support = vdbRegionIVDerivativeSupport;
    (state as any).vdb_two_wall_derivative_support = vdbTwoWallDerivativeSupport;
    // Split gamma_VdB into visual vs mass knobs to keep calibrator away from renderer
  (state as any).gammaVanDenBroeck_mass = state.gammaVanDenBroeck;   // G+Ñ+ë pipeline value (targeted when enabled)
  (state as any).gammaVanDenBroeck_vis  = PROMOTED_WARP_PROFILE.gammaVanDenBroeck; // fixed runtime visual seed

  // Make visual factor mode-invariant (except standby)
  if (state.currentMode !== 'standby') {
    (state as any).gammaVanDenBroeck_vis = PROMOTED_WARP_PROFILE.gammaVanDenBroeck; // constant across modes
  } else {
    (state as any).gammaVanDenBroeck_vis = 1; // keep standby dark
  }

  // Precomputed physics-only ++ gain for client verification
  // Canonical ship-wide ++ (authoritative):
  //   ++ = +-ª_geo^3 -+ q -+ +-ª_VdB -+ duty_FR
  // Use the calibrated/mass +-ª_VdB when available; fall back to visual seed if not.
  const _gammaVdB_forTheta = Number.isFinite(state.gammaVanDenBroeck)
    ? state.gammaVanDenBroeck
    : ((state as any).gammaVanDenBroeck_vis ?? PROMOTED_WARP_PROFILE.gammaVanDenBroeck);

  // DEBUG: ++-Scale Field Strength Audit (dual-value: raw vs calibrated)
  const gammaVdB_raw = PAPER_VDB.GAMMA_VDB;  // Raw paper value (1e11)
  const gammaVdB_cal = _gammaVdB_forTheta;   // Pipeline value (target-adjusted when enabled)

  const thetaComponents = {
    gammaGeo: state.gammaGeo,
    gammaGeo_cubed: Math.pow(state.gammaGeo, 3),
    qSpoilingFactor: state.qSpoilingFactor ?? 1,
    dutyEffective: Math.max(1e-12, state.dutyEffective_FR ?? d_eff),
    gammaVdB_raw,
    gammaVdB_cal
  };

  // Calculate both raw and calibrated theta
  const thetaRaw = thetaComponents.gammaGeo_cubed *
    thetaComponents.qSpoilingFactor *
    gammaVdB_raw *
    thetaComponents.dutyEffective;

  const thetaCal = thetaComponents.gammaGeo_cubed *
    thetaComponents.qSpoilingFactor *
    gammaVdB_cal *
    thetaComponents.dutyEffective;

  // Store calibrated value as the "expected" (what the pipeline actually uses)
  (state as any).thetaScaleExpected = thetaCal;

  // Store model mode for UI fallback
  (state as any).modelMode = modelMode;

  // Store both values for audit
  (state as any).thetaRaw = thetaRaw;
  (state as any).thetaCal = thetaCal;

  // Publish compact thetaAudit for UI consumption
  (state as any).uniformsExplain ??= {};
  (state as any).uniformsExplain.thetaAudit = {
    mode: modelMode,
    eq: "++ = +-ª_geo^3 -+ q -+ +-ª_VdB -+ d_eff",
    massMode,
    inputs: {
      gammaGeo: state.gammaGeo,
      q: state.qSpoilingFactor,
      gammaVdB_raw: PAPER_VDB.GAMMA_VDB,
      gammaVdB_cal: state.gammaVanDenBroeck,
      d_eff: Math.max(1e-12, state.dutyEffective_FR ?? d_eff)
    },
    results: { thetaRaw, thetaCal }
  };

  const grEnabled = state.grEnabled === true;
  if (!grEnabled) {
    delete (state as any).gr;
  } else if (state.gr?.constraints) {
    (state as any).uniformsExplain.thetaAudit.gr = {
      H_constraint: state.gr.constraints.H_constraint,
      M_constraint: state.gr.constraints.M_constraint,
      updatedAt: state.gr.updatedAt,
      source: state.gr.source,
    };
  }

  if (PIPELINE_THETA_AUDIT_LOG) {
    console.log('=-â+¦+¼ ++-Scale Field Strength Audit (Raw vs Pipeline):', {
      mode: modelMode,
      massMode,
      formula: '++ = +-ª_geo^3 -+ q -+ +-ª_VdB -+ d_eff',
      components: thetaComponents,
      results: {
        thetaRaw: thetaRaw,
        thetaRawSci: thetaRaw.toExponential(2),
        thetaCal: thetaCal,
        thetaCalSci: thetaCal.toExponential(2),
        ratio: thetaRaw / thetaCal,
        gammaVdBRatio: gammaVdB_raw / gammaVdB_cal
      },
      expected_raw: 4.4e10,
      ratio_vs_expected: thetaRaw / 4.4e10
    });
  }

  // Overall clamping status for UI warnings
  (state as any).parametersClamped = (state as any).qMechanicalClamped || (state as any).gammaVanDenBroeckClamped;

  /* G+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+ç
     "Explain-it" counters for HUD/debug
  G+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+ç */
  (state as any).E_tile_static_J = Math.abs(state.U_static);  // Static Casimir energy per tile
  (state as any).E_tile_geo_J = Math.abs(state.U_geo);        // Geometric amplified energy per tile  
  (state as any).E_tile_on_J = Math.abs(state.U_Q);           // Stored energy per tile in on-window
  (state as any).P_tile_on_W = state.P_loss_raw;              // Power per tile during on-window
  (state as any).d_eff = d_eff;                               // Ship-wide effective duty (first-class)
  (state as any).M_per_tile_kg = state.N_tiles > 0 ? state.M_exotic / state.N_tiles : 0; // Mass per tile


  // Physics logging for debugging (before UI field updates)
  if (DEBUG_PIPE) console.log("[PIPELINE]", {
    mode: state.currentMode, model: modelMode, massMode,
    dutyShip: d_eff, dutyUI_before: state.dutyCycle, S_live, N: state.N_tiles,
    gammaGeo: state.gammaGeo, qCavity: state.qCavity, gammaVdB: state.gammaVanDenBroeck,
    U_static: state.U_static, U_Q: state.U_Q, P_loss_raw: state.P_loss_raw,
    P_avg_MW: state.P_avg, M_raw: state.M_exotic_raw, M_final: state.M_exotic,
    massCal: state.massCalibration
  });

  /* G+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+ç
     Additional metrics (derived)
  G+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+çG+¦+ç */

  // --- Time-scale separation (TS) using actual hull size ---
  const { Lx_m, Ly_m, Lz_m } = state.hull!;
  const L_long = Math.max(Lx_m, Ly_m, Lz_m);                // conservative: longest light-crossing
  const L_geom = Math.cbrt(Lx_m * Ly_m * Lz_m);             // geometric mean (volume-equivalent length)

  // Recompute f_m and T_m in this scope (fix scope bug)
  const f_m_ts = (state.modulationFreq_GHz ?? DEFAULT_MODULATION_FREQ_GHZ) * 1e9; // Hz
  const T_m_ts = 1 / f_m_ts;                              // s

  const T_long = L_long / C;   // s
  const T_geom = L_geom / C;   // s

  state.TS_long = T_long / T_m_ts;   // most conservative
  state.TS_geom = T_geom / T_m_ts;   // typical
  state.TS_ratio = state.TS_long;    // keep existing field = conservative

  // Wall-scale TS (often more relevant than hull-scale)
  const w = state.hull?.wallThickness_m ?? DEFAULT_WALL_THICKNESS_M;
  const T_wall = w / C;
  (state as any).TS_wall = T_wall / T_m_ts;

  // Homogenization status for UI badging
  (state as any).isHomogenized = state.TS_long! > 1e3; // fast-average regime vs borderline

  // Keep these around for the metrics + HUD
  state.__fr = {
    dutyShip: d_eff,        // Ship-wide effective duty (averaged over sectors)
    dutyEffectiveFR: d_eff, // Same as dutyShip (Ford-Roman compliance)
    dutyMeasuredFR: measuredDutyEffective ?? null,
    dutySource: measuredDutyEffective != null ? "measured" : "schedule",
    zeta_baseline: 1,       // Guardrail now computed from sampled waveform
  };

  // 9) Mode policy calibration already applied above - power and mass targets hit automatically

  // Duty-cycled energy and curvature limit (corrected)
  state.U_cycle = state.U_Q * d_eff;

  // Expose timing details for metrics API (corrected naming)
  const strobeHzOverride = Number(state.strobeHz);
  state.strobeHz =
    Number.isFinite(strobeHzOverride) && strobeHzOverride > 0
      ? strobeHzOverride
      : Number(process.env.STROBE_HZ ?? 1000); // sectors/sec (1ms macro-tick)
  state.sectorPeriod_ms     = 1000 / Math.max(1, state.strobeHz);
  state.modelMode           = modelMode; // for client consistency
  state.massMode            = massMode;  // for client consistency

  // Compliance flags (physics-based safety)
  state.natarioConstraint   = true;

  // Audit guard (pipeline self-consistency check)
  (function audit() {
    const P_tile = Math.abs(state.U_Q) * omega / Q;
    const P_exp  = P_tile * state.N_tiles * d_eff / 1e6;
    if (Math.abs(state.P_avg - P_exp) > 1e-6 * Math.max(1, P_exp)) {
      if (DEBUG_PIPE) console.warn("[AUDIT] P_avg drift; correcting", {reported: state.P_avg, expected: P_exp});
      state.P_avg = P_exp;
      (state as any).P_avg_W = P_exp * 1e6; // W (explicit)
    }

    const rhoAvgAudit = Number.isFinite((state as any).rho_avg)
      ? ((state as any).rho_avg as number)
      : null;
    const E_tile_mass = rhoAvgAudit != null
      ? rhoAvgAudit * tileVolume_m3
      : Math.abs(state.U_static) *
          Math.pow(state.gammaGeo, 3) *
          (state.qCavity ?? PROMOTED_WARP_PROFILE.qCavity) *
          state.gammaVanDenBroeck *
          d_eff;
    const M_exp  = (E_tile_mass / (C*C)) * state.N_tiles;
    if (Math.abs(state.M_exotic - M_exp) > 1e-6 * Math.max(1, M_exp)) {
      if (DEBUG_PIPE) console.warn("[AUDIT] M_exotic drift; correcting", {reported: state.M_exotic, expected: M_exp});
      state.M_exotic_raw = state.M_exotic = M_exp;
    }
  })();

  // Overall status (mode-aware power thresholds)
  // Mode configuration already applied early in function - no need to duplicate
  state.sectorStrobing  = state.concurrentSectors;         // G-ú+á Legacy alias for UI compatibility
  // Phase scheduler (PR-3): compute per-sector phase offsets and assign roles.
  const totalSectors = Math.max(
    1,
    Number.isFinite(state.sectorCount) ? state.sectorCount : DEFAULT_SECTORS_TOTAL,
  );
  const hw = state.hardwareTruth?.sectorState ?? null;
  const hwDwellMs = Number(hw?.dwell_ms);
  const hwBurstMs = Number(hw?.burst_ms);
  const hwTauLcMs = Number(hw?.tauLC_ms);
  const hwTelemetryPeriodMs = Number(hw?.phaseScheduleTelemetry?.sectorPeriod_ms);
  const fallbackPeriodRaw = Number(state.sectorPeriod_ms);
  let fallbackPeriod = Number.isFinite(fallbackPeriodRaw) ? fallbackPeriodRaw : DEFAULT_SECTOR_PERIOD_MS;
  if (!(fallbackPeriod > 0)) fallbackPeriod = DEFAULT_SECTOR_PERIOD_MS;
  let sectorPeriodMs = fallbackPeriod;
  if (Number.isFinite(hwDwellMs) && hwDwellMs > 0) {
    sectorPeriodMs = hwDwellMs;
  } else if (Number.isFinite(hwTelemetryPeriodMs) && hwTelemetryPeriodMs > 0) {
    sectorPeriodMs = hwTelemetryPeriodMs;
  }
  if (!(sectorPeriodMs > 0)) {
    sectorPeriodMs = fallbackPeriod > 0 ? fallbackPeriod : DEFAULT_SECTOR_PERIOD_MS;
  }

  // --- Construct light-crossing packet (single source of truth) ---
  const baseDwell_ms = Number.isFinite(hwDwellMs) && hwDwellMs > 0 ? hwDwellMs : sectorPeriodMs;
  const geometryTau_ms = computeTauLcMsFromHull(state.hull ?? hullDims);
  const baseTauCandidate_ms = Number.isFinite(hwTauLcMs)
    ? hwTauLcMs
    : Number.isFinite(state.tauLC_ms)
    ? state.tauLC_ms
    : (geometryTau_ms ?? (DEFAULT_WALL_THICKNESS_M / C) * 1e3);
  let baseTauLC_ms = baseTauCandidate_ms;
  if (Number.isFinite(baseTauLC_ms) && Number.isFinite(geometryTau_ms)) {
    const candidate = baseTauLC_ms as number;
    const geometry = geometryTau_ms as number;
    const drift = Math.max(candidate, geometry) / Math.max(1e-12, Math.min(candidate, geometry));
    if (drift >= TAU_LC_UNIT_DRIFT_LIMIT) {
      console.warn("[light-crossing][unit-drift]", {
        candidate_ms: candidate,
        geometry_ms: geometry,
        source: Number.isFinite(hwTauLcMs) ? "hardware" : "state",
        limit: TAU_LC_UNIT_DRIFT_LIMIT,
      });
      baseTauLC_ms = geometry;
      (state as any).lightCrossingUnitWarning = { candidate_ms: candidate, geometry_ms: geometry, source: "pipeline" };
    }
  } else if (Number.isFinite(geometryTau_ms)) {
    baseTauLC_ms = geometryTau_ms as number;
  }
  // Prefer the previous autoscaled burst (persisted on state) when hardware does not supply one;
  // otherwise we snap back to the duty-based default each request and TS jumps between 100/50.
  const prevBurstNs =
    Number.isFinite((state as any).__ts_lastBurst_ns) && (state as any).__ts_lastBurst_ns > 0
      ? (state as any).__ts_lastBurst_ns
      : Number.isFinite(state.tsAutoscale?.appliedBurst_ns)
      ? state.tsAutoscale!.appliedBurst_ns!
      : Number.isFinite(state.lightCrossing?.burst_ns)
      ? state.lightCrossing!.burst_ns!
      : undefined;
  const prevBurstMs = Number.isFinite(prevBurstNs) ? (prevBurstNs as number) / 1e6 : undefined;

  const dutyBurst = Number.isFinite(state.dutyBurst)
    ? Number(state.dutyBurst)
    : PROMOTED_WARP_PROFILE.dutyCycle;
  let baseBurst_ms: number;
  let baseBurstSource: string;
  if (Number.isFinite(hwBurstMs)) {
    baseBurst_ms = hwBurstMs as number;
    baseBurstSource = "hardware";
  } else if (Number.isFinite(prevBurstMs) && (prevBurstMs as number) > 0) {
    baseBurst_ms = prevBurstMs as number;
    baseBurstSource = "autoscale_prev";
  } else {
    baseBurst_ms = baseDwell_ms * dutyBurst;
    baseBurstSource = "duty_fallback";
  }
  (state as any).__ts_baseBurst_ms = baseBurst_ms;
  (state as any).__ts_baseBurst_source = baseBurstSource;

  const lightCrossing = {
    tauLC_ms: baseTauLC_ms,
    burst_ms: baseBurst_ms,
    burst_ns: Number.isFinite(baseBurst_ms) ? (baseBurst_ms as number) * 1e6 : undefined,
    dwell_ms: baseDwell_ms,
  };
  const wallNow = nowMs;
  const wallPrev = Number.isFinite((state as any).__wall_ts) ? ((state as any).__wall_ts as number) : null;
  const wallDt_s = wallPrev != null ? Math.max(0, (wallNow - wallPrev) / 1000) : 0;
  (state as any).__wall_prev_ms = wallPrev;
  (state as any).__wall_ts = wallNow;
  (state as any).__dt_wall_s = wallDt_s;
  const tauLC_s = Number.isFinite(lightCrossing.tauLC_ms)
    ? (lightCrossing.tauLC_ms as number) / 1000
    : 0;
  const tauPulse_s = Number.isFinite(lightCrossing.burst_ms)
    ? Math.max(1e-12, (lightCrossing.burst_ms as number) / 1000)
    : 1e-12;
  const tsCurrent = tauPulse_s > 0 ? tauLC_s / tauPulse_s : Number.NaN;
  const tsCfg = {
    enabled: process.env.TS_AUTOSCALE_ENABLE !== "false",
    target: parseEnvNumber(process.env.TS_AUTOSCALE_TARGET, 100),
    slewPerSec: Math.max(0, parseEnvNumber(process.env.TS_AUTOSCALE_SLEW, 0.25)),
    floor_ns: Math.max(
      0,
      parseEnvNumber(
        process.env.TS_AUTOSCALE_FLOOR_NS ?? process.env.TS_AUTOSCALE_MIN_PULSE_NS,
        20,
      ),
    ),
    windowTol: Math.max(0, parseEnvNumber(process.env.TS_AUTOSCALE_WINDOW_TOL, 0.05)),
  };
  const tsNow = wallNow;
  const tsDt_s = Number.isFinite((state as any).__ts_lastUpdate)
    ? Math.max(0, (tsNow - (state as any).__ts_lastUpdate) / 1000)
    : 0;
  let tsAuto: TsAutoscaleState | undefined;
  try {
    const prevBurst_ns = Number.isFinite(lightCrossing.burst_ns)
      ? (lightCrossing.burst_ns as number)
      : Math.max(1, tauPulse_s * 1e9);
    tsAuto = stepTsAutoscale({
      enable: tsCfg.enabled,
      targetTS: tsCfg.target,
      slewPerSec: tsCfg.slewPerSec,
      floor_ns: tsCfg.floor_ns,
      windowTol: tsCfg.windowTol,
      TS_ratio: tsCurrent,
      tauPulse_ns: prevBurst_ns,
      dt_s: tsDt_s,
      prevBurst_ns,
    });
    if (tsAuto) {
      tsAuto.lastTickMs = tsNow;
      tsAuto.dtLast_s = tsDt_s;
    }
    (state as any).__ts_lastUpdate = tsNow;
    (state as any).__ts_lastBurst_ns = tsAuto.appliedBurst_ns;
    (state as any).__ts_dt_s = tsDt_s;
    (state as any).tsAutoscale = tsAuto;
    const scale = prevBurst_ns > 0 ? tsAuto.appliedBurst_ns / prevBurst_ns : 1;
    lightCrossing.burst_ns = tsAuto.appliedBurst_ns;
    lightCrossing.burst_ms = tsAuto.appliedBurst_ns / 1e6;
    if (Number.isFinite(scale) && scale > 0) {
      sectorPeriodMs = Math.max(0.01, sectorPeriodMs * scale);
      lightCrossing.dwell_ms = sectorPeriodMs;
    }
  } catch (err) {
    if (DEBUG_PIPE) console.warn("[TS-autoscale][error]", err);
  }

  // Build clocking snapshot (TS, epsilon) from the best timing data we have.
  // If we are operating purely on derived defaults (no hardware tau_LC or burst),
  // treat the result as tentative so the UI doesn't hard-fail before telemetry arrives.
  const derivedOnlyClocking = !Number.isFinite(hwTauLcMs) && !Number.isFinite(hwBurstMs);
  let clockingProvenance: "derived" | "hardware" | "simulated" =
    derivedOnlyClocking ? "derived" : "hardware";
  let clocking = computeClocking({
    tauLC_ms: lightCrossing.tauLC_ms,
    burst_ms: lightCrossing.burst_ms,
    dwell_ms: lightCrossing.dwell_ms,
    sectorPeriod_ms: sectorPeriodMs,
    hull: state.hull,
    localDuty: state.dutyBurst,
  });
  if (derivedOnlyClocking && (clocking.regime === "fail" || !Number.isFinite(clocking.TS as number))) {
    // Simulate a safe clocking profile by clamping tau_pulse << tau_LC so the UI can show a proxy.
    const tauLCsim_ms = Number.isFinite(lightCrossing.tauLC_ms)
      ? (lightCrossing.tauLC_ms as number)
      : Math.max(1e-3, computeTauLcMsFromHull(state.hull ?? hullDims) ?? 1);
    const dwellSim_ms = Number.isFinite(lightCrossing.dwell_ms)
      ? (lightCrossing.dwell_ms as number)
      : sectorPeriodMs;
    const tauPulseSim_ms = Math.min(
      Math.max(1e-6, lightCrossing.burst_ms ?? tauLCsim_ms * 0.02),
      tauLCsim_ms * 0.02,
    );
    const dutySim = dwellSim_ms > 0 ? tauPulseSim_ms / dwellSim_ms : undefined;
    clocking = computeClocking({
      tauLC_ms: tauLCsim_ms,
      burst_ms: tauPulseSim_ms,
      dwell_ms: dwellSim_ms,
      sectorPeriod_ms: dwellSim_ms,
      hull: state.hull,
      localDuty: dutySim,
    });
    clocking = {
      ...clocking,
      detail: `${clocking.detail}; simulated from hull geometry (no hardware timing)`,
    };
    clockingProvenance = "simulated";
  }
  const tsClockRaw = Number(clocking.TS);
  const tsMissing = !Number.isFinite(tsClockRaw) || tsClockRaw <= 0;
  if (tsMissing || clocking.regime === "unknown") {
    (state as any).averagingNote =
      "Awaiting hardware tau_pulse/tau_LC; supply timing so guardrail can validate cycle-average.";
  } else {
    delete (state as any).averagingNote;
  }
  if (
    DEBUG_PIPE &&
    (!Number.isFinite(clocking.TS as number) || (clocking.TS as number) <= 0)
  ) {
    console.warn("[clocking][TS-zero]", {
      detail: clocking.detail,
      tauPulse_ms: clocking.tauPulse_ms,
      tauLC_ms: clocking.tauLC_ms,
      burst_ms: lightCrossing.burst_ms,
      dwell_ms: lightCrossing.dwell_ms,
      sectorPeriod_ms: sectorPeriodMs,
      duty: state.dutyBurst ?? state.dutyCycle,
    });
  }
  lightCrossing.tauLC_ms = clocking.tauLC_ms ?? lightCrossing.tauLC_ms;
  lightCrossing.burst_ms = clocking.tauPulse_ms ?? lightCrossing.burst_ms;
  lightCrossing.dwell_ms = clocking.dwell_ms ?? lightCrossing.dwell_ms;
  (state as any).lightCrossing = lightCrossing;
  (state as any).tauLC_ms = lightCrossing.tauLC_ms;
  const clockingTS = Number(clocking.TS);
  const clockingWithTS: ClockingSnapshot = {
    ...clocking,
    TS: Number.isFinite(clockingTS) && clockingTS > 0 ? clockingTS : clocking.TS ?? null,
  };
  const tsMetricStatusPreWarp = resolveTsMetricDerivedStatus(
    state,
    clockingProvenance,
  );
  clockingWithTS.metricDerived = tsMetricStatusPreWarp.metricDerived;
  clockingWithTS.metricDerivedSource = tsMetricStatusPreWarp.source;
  clockingWithTS.metricDerivedReason = tsMetricStatusPreWarp.reason;
  clockingWithTS.metricDerivedChart = tsMetricStatusPreWarp.chart;
  state.clocking = clockingWithTS;
  state.clockingProvenance = clockingProvenance;
  state.tsMetricDerived = tsMetricStatusPreWarp.metricDerived;
  state.tsMetricDerivedSource = tsMetricStatusPreWarp.source;
  state.tsMetricDerivedReason = tsMetricStatusPreWarp.reason;
  (state as any).averaging = clockingWithTS;
  (state as any).tsMetricDerived = tsMetricStatusPreWarp.metricDerived;
  (state as any).tsMetricDerivedSource = tsMetricStatusPreWarp.source;
  (state as any).tsMetricDerivedReason = tsMetricStatusPreWarp.reason;
  (state as any).TS_modulation = state.TS_ratio;
  const tsCandidate = Number(clocking.TS);
  const tsFallback = Number.isFinite(state.TS_ratio)
    ? state.TS_ratio
    : Number.isFinite(state.TS_long)
    ? (state.TS_long as number)
    : Number.isFinite(state.TS_geom)
    ? (state.TS_geom as number)
    : 0;
  const tsEffectiveRaw =
    Number.isFinite(tsCandidate) && tsCandidate > 0 ? tsCandidate : tsFallback;
  const tsEffective = Number.isFinite(tsEffectiveRaw) && tsEffectiveRaw > 0 ? tsEffectiveRaw : 1e-9;
  state.TS_long = tsEffective;
  state.TS_ratio = tsEffective;
  (state as any).lightCrossing.TS = tsEffective;

  state.sectorPeriod_ms = sectorPeriodMs;
  const normalizePhase01 = (value: number) => ((value % 1) + 1) % 1;
  const derivedPhase01 =
    sectorPeriodMs > 0 ? ((Date.now() % sectorPeriodMs) / sectorPeriodMs) : 0;
  const hwPhase01 = Number(hw?.phase01);
  const overridePhase01 = Number(state.phase01);
  const phase01 = Number.isFinite(hwPhase01)
    ? normalizePhase01(hwPhase01)
    : Number.isFinite(overridePhase01)
      ? normalizePhase01(overridePhase01)
      : derivedPhase01;
  state.phase01 = phase01;
  const tauMs = Number.isFinite(state.qi?.tau_s_ms)
    ? Number(state.qi!.tau_s_ms)
    : DEFAULT_QI_SETTINGS.tau_s_ms;
  const sampler = state.qi?.sampler ?? DEFAULT_QI_SETTINGS.sampler;
  const negativeFraction =
    Number.isFinite(state.negativeFraction)
      ? Math.max(0, Math.min(1, state.negativeFraction))
      : DEFAULT_NEGATIVE_FRACTION;

  const phaseSchedule = computeSectorPhaseOffsets({
    N: totalSectors,
    sectorPeriod_ms: sectorPeriodMs,
    phase01,
    tau_s_ms: tauMs,
    sampler,
    negativeFraction,
    deltaPos_deg: 90,
    neutral_deg: 45,
  });
  const phasePhiRaw = phaseSchedule.phi_deg_by_sector;
  const phasePhiForPulses =
    process.env.NHM2_PHASE_SMOOTHING === "1"
      ? smoothSectorPhaseAngles(phasePhiRaw, 2)
      : phasePhiRaw;

  const roleSets = {
    neg: new Set(phaseSchedule.negSectors),
    pos: new Set(phaseSchedule.posSectors),
  };

  if (state.gateAnalytics && Array.isArray(state.gateAnalytics.pulses)) {
    const scheduled = applyPhaseScheduleToPulses(
      state.gateAnalytics.pulses,
      phasePhiForPulses,
      roleSets,
    );
    state.gateAnalytics = {
      ...state.gateAnalytics,
      pulses: scheduled,
    };
  }

  state.phaseSchedule = {
    N: totalSectors,
    sectorPeriod_ms: sectorPeriodMs,
    phase01,
    phi_deg_by_sector: phasePhiForPulses,
    negSectors: phaseSchedule.negSectors,
    posSectors: phaseSchedule.posSectors,
    sampler,
    tau_s_ms: tauMs,
    weights: phaseSchedule.weights,
  };

  const topologyResult = analyzeNhm2PhaseTopology({
    schedule: state.phaseSchedule,
    hull: state.hull ?? hullDims,
    nowMs: wallNow,
    previous: (state as any).__nhm2PhaseTopologyPrev ?? null,
  });
  state.nhm2PhaseTopology = topologyResult.artifact;
  (state as any).__nhm2PhaseTopologyPrev = topologyResult.nextState;

  const qiGuardPre = evaluateQiGuardrail(state, {
    schedule: phaseSchedule,
    sectorPeriod_ms: sectorPeriodMs,
    sampler,
    tau_ms: tauMs,
  });
  let qiGuard = qiGuardPre;
  const tsTelemetry: TsTelemetry = {
    TS_ratio: Number.isFinite(state.TS_ratio) ? state.TS_ratio : tsCurrent,
    tauLC_ms: lightCrossing.tauLC_ms,
    tauPulse_ns: lightCrossing.burst_ns,
    metricDerived: state.tsMetricDerived,
    metricDerivedSource: state.tsMetricDerivedSource,
    metricDerivedReason: state.tsMetricDerivedReason,
    metricDerivedChart: state.clocking?.metricDerivedChart,
    autoscale: tsAuto
      ? {
          ...tsAuto,
          target: tsCfg.target,
          slew: tsCfg.slewPerSec,
          floor_ns: tsCfg.floor_ns,
          lastTickMs: tsNow,
          dtLast_s: tsDt_s,
        }
      : undefined,
  };
  state.tsAutoscale = tsTelemetry.autoscale;
  state.ts = tsTelemetry;
  (state as any).ts = tsTelemetry;
  const autoscaleTarget = Number.isFinite(QI_AUTOSCALE_TARGET)
    ? clampNumber(QI_AUTOSCALE_TARGET, 1e-6, 1e6)
    : 0.9;
  const autoscaleMinScale = Number.isFinite(QI_AUTOSCALE_MIN_SCALE)
    ? clampNumber(QI_AUTOSCALE_MIN_SCALE, 0, 1)
    : 0.02;
  const autoscaleSlewPerS = Number.isFinite(QI_AUTOSCALE_SLEW) ? Math.max(0, QI_AUTOSCALE_SLEW) : 0.25;
  const autoscaleWindowTol =
    Number.isFinite(QI_AUTOSCALE_WINDOW_TOL) && (QI_AUTOSCALE_WINDOW_TOL as number) >= 0
      ? (QI_AUTOSCALE_WINDOW_TOL as number)
      : 0.05;
  const autoscaleSource = strictCongruenceEnabled()
    ? process.env.QI_AUTOSCALE_SOURCE ?? "metric"
    : QI_AUTOSCALE_SOURCE ?? "tile-telemetry";
  const autoscaleNow = wallNow;
  const autoscaleClamps: QiAutoscaleClampReason[] = [];
  const autoscaleState = stepQiAutoscale({
    enable: QI_AUTOSCALE_ENABLE,
    target: autoscaleTarget,
    minScale: autoscaleMinScale,
    slewPerSec: autoscaleSlewPerS,
    windowTol: autoscaleWindowTol,
    zetaRaw: qiGuard.marginRatioRaw ?? null,
    sumWindowDt: qiGuard.sumWindowDt ?? null,
    rhoSource: qiGuard.rhoSource ?? null,
    dt_s: wallDt_s,
    now: autoscaleNow,
    prev: state.qiAutoscale,
    expectedSource: autoscaleSource,
    clamps: autoscaleClamps,
  });
  autoscaleState.clamps = autoscaleClamps;
  const qiDt_s =
    Number.isFinite(autoscaleState.dtLast_s) && (autoscaleState.dtLast_s as number) >= 0
      ? (autoscaleState.dtLast_s as number)
      : wallDt_s;
  const qiLastTickMs = Number.isFinite(autoscaleState.lastTickMs)
    ? (autoscaleState.lastTickMs as number)
    : autoscaleNow;
  autoscaleState.dt_s = qiDt_s;
  autoscaleState.dtLast_s = qiDt_s;
  autoscaleState.lastTickMs = qiLastTickMs;
  state.qiAutoscale = {
    ...autoscaleState,
    target: autoscaleTarget,
    slew: autoscaleSlewPerS,
    minScale: autoscaleMinScale,
    source: autoscaleSource,
    dt_s: qiDt_s,
    dtLast_s: qiDt_s,
    lastTickMs: qiLastTickMs,
  };
  (state as any).__qi_dt_s = qiDt_s;

  const prevAutothrottle = state.qiAutothrottle ?? initQiAutothrottle();
  state.qiAutothrottle = applyQiAutothrottleStep(prevAutothrottle, qiGuard.marginRatioRaw);
  const qiAutothrottleChanged = state.qiAutothrottle !== prevAutothrottle;
  const qiAutothrottleScale =
    state.qiAutothrottle?.enabled === true && Number.isFinite(state.qiAutothrottle.scale)
      ? clampNumber(state.qiAutothrottle.scale as number, 0, 1)
      : 1;
  const autoscaleRawScale = Number.isFinite(state.qiAutoscale?.appliedScale)
    ? (state.qiAutoscale?.appliedScale as number)
    : Number.isFinite(state.qiAutoscale?.scale)
    ? (state.qiAutoscale?.scale as number)
    : 1;
  const qiAutoscaleScale =
    Number.isFinite(autoscaleRawScale) && (autoscaleRawScale as number) > 0
      ? clampNumber(autoscaleRawScale, 0, 1)
      : 1;
  const qiScale = qiAutothrottleScale * qiAutoscaleScale;

  if (state.gateAnalytics && Array.isArray(state.gateAnalytics.pulses)) {
    const pulses = applyScaleToGatePulses(state.gateAnalytics.pulses, qiScale);
    state.gateAnalytics = {
      ...state.gateAnalytics,
      pulses: pulses ?? [],
    };
  }

  const qiGuardPost = evaluateQiGuardrail(state, {
    schedule: phaseSchedule,
    sectorPeriod_ms: sectorPeriodMs,
    sampler,
    tau_ms: tauMs,
  });
  qiGuard = qiGuardPost ?? qiGuard;
  state.zeta = qiGuard.marginRatio;
  (state as any).zetaRaw = qiGuard.marginRatioRaw;
  (state as any).zetaRawComputed = qiGuard.marginRatioRawComputed;
  (state as any).qiGuardrail = qiGuard;
  state.congruentSolve = buildCongruentWarpSolveSnapshot(qiGuard);

  const tsLog = {
    TS_ratio: state.TS_ratio,
    target: tsCfg.target,
    tauLC_us: Number.isFinite(lightCrossing.tauLC_ms) ? +(Number(lightCrossing.tauLC_ms) * 1000).toFixed(3) : null,
    tauPulse_ns: Number.isFinite(lightCrossing.burst_ms) ? +(Number(lightCrossing.burst_ms) * 1e6).toFixed(3) : null,
    engaged: tsAuto?.engaged ?? false,
    appliedBurst_ns: tsAuto?.appliedBurst_ns ?? null,
    proposedBurst_ns: tsAuto?.proposedBurst_ns ?? null,
    gating: tsAuto?.gating ?? "idle",
  };
  const tsAutoLog = {
    engaged: tsAuto?.engaged ?? false,
    gating: tsAuto?.gating ?? "idle",
    appliedBurst_ns: tsAuto?.appliedBurst_ns ?? null,
    proposedBurst_ns: tsAuto?.proposedBurst_ns ?? null,
    target: tsCfg.target,
    slew: tsCfg.slewPerSec,
    floor_ns: tsCfg.floor_ns,
  };
  const qiAutoLog = {
    engaged: state.qiAutoscale?.engaged ?? false,
    gating: state.qiAutoscale?.gating ?? "idle",
    appliedScale:
      state.qiAutoscale?.appliedScale ??
      state.qiAutoscale?.scale ??
      1,
    proposedScale: state.qiAutoscale?.proposedScale ?? null,
    target: autoscaleTarget,
    slew: autoscaleSlewPerS,
    floor: autoscaleMinScale,
  };

  if (DEBUG_PIPE) {
    console.log("[TS-guard]", tsLog);
    console.log("[TS-autoscale]", tsAutoLog);
    console.log("[QI-autoscale]", qiAutoLog);
  }

  if (qiAutothrottleChanged && state.qiAutothrottle?.reason) {
    console.warn("[QI-autothrottle]", {
      scale: state.qiAutothrottle.scale,
      reason: state.qiAutothrottle.reason,
    });
  }

  const P_warn = MODE_POLICY[state.currentMode].P_target_W * 1.2 / 1e6; // +20% headroom in MW
  const qiStatus = deriveQiStatus({
    zetaRaw: qiGuard.marginRatioRaw,
    zetaClamped: qiGuard.marginRatio,
    pAvg: state.P_avg,
    pWarn: P_warn,
    mode: state.currentMode,
  });
  state.fordRomanCompliance = qiStatus.compliance;
  state.curvatureLimit = state.fordRomanCompliance;
  state.overallStatus = qiStatus.overallStatus;

  // UI field updates logging (after MODE_CONFIGS applied)
  if (DEBUG_PIPE) console.log("[PIPELINE_UI]", {
    dutyUI_after: state.dutyCycle, 
    sectorCount: state.sectorCount,
    concurrentSectors: state.concurrentSectors,
    sectorStrobing: state.sectorStrobing,
    qSpoilingFactor: state.qSpoilingFactor
  });

  // Legacy Natario proxy payload (kept only for compatibility fallback).
  // Runtime congruence uses solved warp.metric payload below.
  const strictCongruence = strictCongruenceEnabled();
  let natarioLegacy: Record<string, unknown> | null = null;
  if (!strictCongruence) {
    natarioLegacy = calculateNatarioMetric({
      gap: state.gap_nm,
      hull: state.hull
        ? { a: state.hull.Lx_m / 2, b: state.hull.Ly_m / 2, c: state.hull.Lz_m / 2 }
        : { a: 503.5, b: 132, c: 86.5 },
      N_tiles: state.N_tiles,
      tileArea_m2: state.tileArea_cm2 * CM2_TO_M2,
      dutyEffectiveFR: d_eff,
      lightCrossing,
      gammaGeo: state.gammaGeo,
      gammaVanDenBroeck: state.gammaVanDenBroeck,
      qSpoilingFactor: state.qSpoilingFactor,
      cavityQ: state.qCavity,
      modulationFreq_GHz: state.modulationFreq_GHz,
      sectorStrobing: state.concurrentSectors, // concurrent live sectors
      dynamicConfig: {
        sectorCount: state.sectorCount, // TOTAL sectors (e.g. 400)
        concurrentSectors: state.concurrentSectors,
        sectorDuty: d_eff, // FR duty, not UI duty
        cavityQ: state.qCavity,
        qSpoilingFactor: state.qSpoilingFactor,
        gammaGeo: state.gammaGeo,
        gammaVanDenBroeck: state.gammaVanDenBroeck,
        pulseFrequencyGHz: state.modulationFreq_GHz,
        lightCrossingTimeNs: tauLC_s * 1e9,
      },
    } as any, state.U_static * state.N_tiles) as unknown as Record<string, unknown>;
  }
  (state as any).natarioLegacy = natarioLegacy ?? undefined;

  // Calculate dynamic Casimir with pipeline integration + performance guardrails

  // Cap dynamic grid size + short-circuit heavy branches
  const tileEdge = Math.max(1, Math.floor(Math.sqrt(state.N_tiles)));
  const dynEdge  = Math.min(TILE_EDGE_MAX, tileEdge);         // bounded for safety
  const dynTileCount = dynEdge * dynEdge;

  // Expose a note for UIs/debug
  (state as any).tileGrid = { edge: tileEdge, dynEdge, N_tiles: state.N_tiles, dynTileCount };

  // --- Dynamic helpers: feed safe sizes or short-circuit ---
  const shouldSkipDynamic = state.N_tiles > DYN_TILECOUNT_HARD_SKIP;

  try {
    const staticResult = calculateCasimirEnergy({
      gap: state.gap_nm,
      geometry: 'parallel_plate',
      radius: tileRadius_m * 1e6,
      sagDepth: state.sag_nm,
      temperature: state.temperature_K,
      materialModel: state.casimirModel ?? 'ideal_retarded',
      materialProps: state.materialProps,
      coupling: {
        ...couplingSpec,
        pitch_m: state.tilePitch_m ?? couplingSpec.pitch_m,
        frameFill: state.couplingFrameFill ?? couplingSpec.frameFill,
      },
      // bounded edge to keep any internal allocations sane
      arrayConfig: { size: dynEdge }
    } as any);

    if (!shouldSkipDynamic) {
      const dyn = calculateDynamicCasimirWithNatario({
          staticEnergy: staticResult.totalEnergy,
          modulationFreqGHz: state.modulationFreq_GHz,
          strokeAmplitudePm: (state as any).strokeAmplitude_pm ?? 50,
          burstLengthUs: (state as any).burst_us ?? 10,
          cycleLengthUs: (state as any).cycle_us ?? 1000,
          cavityQ: state.qCavity,
          // IMPORTANT: pass *aggregate* count, not an array-sized count
          tileCount: state.N_tiles
        }, {
          ...state,
          dynamicConfig: {
            modulationFreqGHz: state.modulationFreq_GHz,
            cavityQ: state.qCavity,
            qSpoilingFactor: state.qSpoilingFactor,
            sectorCount: state.sectorCount,
            concurrentSectors: state.concurrentSectors,
            sectorDuty: d_eff,  // FR duty
            lightCrossingTimeNs: tauLC_s * 1e9,
            gammaGeo: state.gammaGeo,
            gammaVanDenBroeck: state.gammaVanDenBroeck
          }
        } as any
      );
      (state as any).dynamic = dyn;
    } else {
      (state as any).dynamic = { note: 'skipped (tilecount hard cap)', totalEnergy: staticResult.totalEnergy };
    }
  } catch (e) {
    if (DEBUG_PIPE) console.warn('Dynamic Casimir calculation failed:', e);
  }

  // Vacuum-gap sweep (optional) for pump bias tuning
  try {
    if (state.sweep) {
      state.sweep.activeSlew = Boolean(state.dynamicConfig?.sweep?.activeSlew);
    }
    const sweepMode = opts.sweepMode ?? "auto";
    const wantsActiveSlew = Boolean(state.dynamicConfig?.sweep?.activeSlew);
    const canSchedule = typeof opts.scheduleSweep === "function";
    const shouldSkipSweep = sweepMode === "skip";
    const shouldForceSweep = sweepMode === "force";
    const shouldSchedule =
      !shouldForceSweep &&
      !shouldSkipSweep &&
      wantsActiveSlew &&
      canSchedule &&
      (sweepMode === "async" || sweepMode === "auto");

    if (shouldSkipSweep) {
      // Explicitly skipped by caller
    } else if (shouldForceSweep) {
      await orchestrateVacuumGapSweep(state);
    } else if (shouldSchedule) {
      opts.scheduleSweep?.({
        activeSlew: true,
        reason: opts.sweepReason ?? "pipeline-run",
      });
    } else {
      await orchestrateVacuumGapSweep(state);
    }
  } catch (err) {
    if (DEBUG_PIPE) console.warn("Vacuum-gap sweep skipped:", err);
  }

  // Calculate stress-energy tensor from pipeline parameters
  try {
    const hullGeom = resolveHullGeometry(state);
    const a = hullGeom.Lx_m / 2;
    const b = hullGeom.Ly_m / 2;
    const c = hullGeom.Lz_m / 2;
    const geomR = Math.cbrt(a * b * c); // meters

    const SE = toPipelineStressEnergy({
      gap_nm: state.gap_nm ?? PROMOTED_WARP_PROFILE.gap_nm,
      gammaGeo: state.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo,
      cavityQ: state.qCavity ?? PROMOTED_WARP_PROFILE.qCavity,
      gammaVanDenBroeck: state.gammaVanDenBroeck ?? PROMOTED_WARP_PROFILE.gammaVanDenBroeck,
      qSpoilingFactor: state.qSpoilingFactor ?? PROMOTED_WARP_PROFILE.qSpoilingFactor,
      dutyCycle: state.dutyCycle,
      sectorStrobing: state.sectorStrobing,
      dutyEffectiveFR: state.dutyEffective_FR,     // stress-energy payload     
      lightCrossing: (state as any).lightCrossing,
      rho0Scale: casimirScaleApplied,
      R_geom_m: geomR
    });

    // Expose stress-energy tensor components in the shared snapshot
    (state as any).stressEnergy = SE;
  } catch (e) {
    if (DEBUG_PIPE) console.warn('Stress-energy calculation failed:', e);
  }

  // Calculate Nat++¡rio warp bubble results (now pipeline-true)
  try {
    const hullGeomWarp = resolveHullGeometry(state);
    const a_warp = hullGeomWarp.Lx_m / 2;
    const b_warp = hullGeomWarp.Ly_m / 2;
    const c_warp = hullGeomWarp.Lz_m / 2;
    const geomR_warp = Math.cbrt(a_warp * b_warp * c_warp); // meters

    const priorAmpInputs = (state.ampFactors ?? (state as any).amps ?? {}) as AmpFactors;
    const ampFactors: AmpFactors = {
      gammaGeo: state.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo,
      gammaVanDenBroeck: state.gammaVanDenBroeck ?? PROMOTED_WARP_PROFILE.gammaVanDenBroeck,
      qSpoilingFactor: state.qSpoilingFactor ?? PROMOTED_WARP_PROFILE.qSpoilingFactor,
      qMechanical: state.qMechanical ?? 1,
      qCavity: state.qCavity ?? PROMOTED_WARP_PROFILE.qCavity,
      measuredGammaGeo: priorAmpInputs.measuredGammaGeo,
      measuredGammaVanDenBroeck: priorAmpInputs.measuredGammaVanDenBroeck,
      measuredQSpoilingFactor: priorAmpInputs.measuredQSpoilingFactor,
      measuredQMechanical: priorAmpInputs.measuredQMechanical,
      measuredCavityQ: priorAmpInputs.measuredCavityQ,
    };
    state.ampFactors = ampFactors;
    (state as any).amps = ampFactors; // back-compat alias
    const warpFieldType =
      (state.dynamicConfig as any)?.warpFieldType ??
      state.warpFieldType ??
      PROMOTED_WARP_PROFILE.warpFieldType;
    const warpGeometry = (state.dynamicConfig as any)?.warpGeometry ?? state.warpGeometry ?? null;
    const warpGeometryKind =
      (warpGeometry as WarpGeometrySpec)?.geometryKind ??
      (warpGeometry as any)?.kind ??
      (state.dynamicConfig as any)?.warpGeometryKind ??
      state.warpGeometryKind ??
      'ellipsoid';
    const bubblePayload = {
      ...(state as any).bubble,
      R: (state as any).bubble?.R ?? (state as any).R,
      sigma: (state as any).bubble?.sigma ?? (state as any).sigma,
      beta: (state as any).bubble?.beta ?? (state as any).beta,
    };
    const allowMassOverride = massMode === "TARGET_CALIBRATED";
    const invariantMass_kg =
      Number.isFinite(state.gr?.matter?.stressEnergy?.invariantMass_kg)
        ? Number(state.gr?.matter?.stressEnergy?.invariantMass_kg)
        : undefined;
    const invariantMassSigma_kg =
      Number.isFinite(measuredScaleRelSigma) && typeof invariantMass_kg === "number"
        ? Math.abs(invariantMass_kg) * (measuredScaleRelSigma as number)
        : undefined;
    state.invariantMassSigma_kg = invariantMassSigma_kg;
    const exoticMassTarget_kg =
      allowMassOverride && Number.isFinite(state.exoticMassTarget_kg)
        ? Number(state.exoticMassTarget_kg)
        : undefined;
    const modeKey = String(state.currentMode ?? "hover").toLowerCase();
    const lowGTargetsByMode: Record<string, number> = {
      standby: 0,
      nearzero: 0.01 * 9.80665,
      taxi: 0.08 * 9.80665,
      hover: 0.10 * 9.80665,
      cruise: 0.05 * 9.80665,
      emergency: 0.30 * 9.80665,
    };
    const gTarget =
      firstFinite(
        Number((state.dynamicConfig as any)?.gTarget),
        Number((state as any).gTarget),
        lowGTargetsByMode[modeKey],
      ) ?? 0;
    const epsilonTilt =
      firstFinite(
        Number((state.dynamicConfig as any)?.epsilonTilt),
        Number((state as any).epsilonTilt),
        Math.min(5e-7, Math.max(0, (gTarget * geomR_warp) / (C * C))),
      ) ?? 0;
    const betaTiltVec = toFiniteVec3(
      (state.dynamicConfig as any)?.betaTiltVec ?? (state as any).betaTiltVec,
      [0, -1, 0],
    );

    const warpParams = {
      geometry: 'bowl' as const,
      gap: state.gap_nm ?? PROMOTED_WARP_PROFILE.gap_nm,
      radius: geomR_warp * 1e6, // Convert meters to micrometers for compatibility
      sagDepth: state.sag_nm ?? 16,
      material: 'PEC' as const,
      temperature: state.temperature_K ?? 20,
      moduleType: 'warp' as const,
      hull: hullGeomWarp,
      // Pass target only when explicitly calibrating mass; otherwise derive from energy.
      exoticMassTarget_kg,
      invariantMass_kg,
      massMode,
      allowMassOverride,
      dynamicConfig: {
        modulationFreqGHz: state.modulationFreq_GHz ?? DEFAULT_MODULATION_FREQ_GHZ,
        strokeAmplitudePm: 50,
        burstLengthUs: 10,
        cycleLengthUs: 1000,
        cavityQ: state.qCavity ?? PROMOTED_WARP_PROFILE.qCavity,
        sectorCount: state.sectorCount ?? PROMOTED_WARP_PROFILE.sectorCount,
        sectorDuty: state.dutyEffective_FR ?? PROMOTED_WARP_PROFILE.dutyShip, // warp module payload
        pulseFrequencyGHz: state.modulationFreq_GHz ?? DEFAULT_MODULATION_FREQ_GHZ,
        lightCrossingTimeNs: tauLC_s * 1e9,
        shiftAmplitude: 50e-12,
        expansionTolerance: 1e-12,
        gTarget,
        epsilonTilt,
        betaTiltVec,
        alphaProfileKind: (state.dynamicConfig as any)?.alphaProfileKind,
        alphaCenterline: (state.dynamicConfig as any)?.alphaCenterline,
        alphaGradientVec_m_inv: (state.dynamicConfig as any)?.alphaGradientVec_m_inv,
        alphaInteriorSupportKind: (state.dynamicConfig as any)?.alphaInteriorSupportKind,
        alphaWallTaper_m: (state.dynamicConfig as any)?.alphaWallTaper_m,
        shiftLapseProfileId: (state.dynamicConfig as any)?.shiftLapseProfileId,
        warpFieldType,
        warpGeometry: warpGeometry ?? undefined,
        warpGeometryKind
      },
      currentMode: state.currentMode,
      bubble: bubblePayload,
      R: bubblePayload.R,
      sigma: bubblePayload.sigma,
      beta: bubblePayload.beta,
      warpGeometry: warpGeometry ?? undefined,
      warpGeometryKind,
      warpGeometryAssetId: (warpGeometry as WarpGeometrySpec)?.assetId ?? state.warpGeometryAssetId,
      // Amplification factors: prefer ampFactors, keep legacy amps alias
      ampFactors,
      amps: ampFactors
    };

    const sanitizeShiftVectorField = (field: Record<string, unknown>) => {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(field)) {
        if (typeof value === "function") continue;
        sanitized[key] = value;
      }
      return sanitized;
    };

    const buildFallbackMetricAdapter = (note: string) =>
      buildWarpMetricAdapterSnapshot({
        family: "unknown",
        chart: {
          label: "unspecified",
          dtGammaPolicy: "unknown",
          notes: note,
        },
        requestedFieldType: warpFieldType,
        alpha: 1,
        gammaDiag: [1, 1, 1],
        note,
      });

    const sanitizeWarpResult = (warpResult: unknown) => {
      if (!warpResult || typeof warpResult !== "object") return warpResult;
      if (opts.preserveLiveWarpFunctions === true) {
        return warpResult;
      }
      const result = warpResult as Record<string, unknown>;
      const shiftVectorField = result.shiftVectorField;
      if (shiftVectorField && typeof shiftVectorField === "object") {
        return {
          ...result,
          shiftVectorField: sanitizeShiftVectorField(
            shiftVectorField as Record<string, unknown>,
          ),
        };
      }
      return result;
    };

    const warp = await warpBubbleModule.calculate(warpParams);
    const sanitizedWarp = sanitizeWarpResult(warp) as Record<string, unknown>;
    const liveShiftVectorField =
      warp && typeof warp === "object"
        ? ((warp as Record<string, unknown>).shiftVectorField as
            | Record<string, unknown>
            | undefined)
        : undefined;
    const liveEvaluateShiftVector =
      liveShiftVectorField != null &&
      typeof liveShiftVectorField.evaluateShiftVector === "function"
        ? liveShiftVectorField.evaluateShiftVector
        : null;
    const sanitizedShiftVectorField = sanitizedWarp.shiftVectorField as
      | Record<string, unknown>
      | undefined;
    if (
      liveEvaluateShiftVector != null &&
      sanitizedShiftVectorField != null &&
      typeof sanitizedShiftVectorField === "object"
    ) {
      Object.defineProperty(sanitizedShiftVectorField, "evaluateShiftVector", {
        value: liveEvaluateShiftVector,
        enumerable: false,
        configurable: true,
      });
    }
    if (!sanitizedWarp.metricAdapter) {
      sanitizedWarp.metricAdapter = buildFallbackMetricAdapter(
        "metricAdapter missing from warp module result",
      );
    }
    const metricT00Source =
      typeof sanitizedWarp.metricT00Source === "string"
        ? String(sanitizedWarp.metricT00Source)
        : typeof sanitizedWarp.stressEnergySource === "string"
          ? String(sanitizedWarp.stressEnergySource)
          : null;
    const metricT00Ref =
      typeof sanitizedWarp.metricT00Ref === "string" && sanitizedWarp.metricT00Ref.length > 0
        ? String(sanitizedWarp.metricT00Ref)
        : resolveCanonicalMetricT00Ref(
            sanitizedWarp as Record<string, any>,
            sanitizedWarp.metricAdapter as WarpMetricAdapterSnapshot | undefined,
          ) ?? null;
    const solveBackedTransportSampleFamily = buildSolveBackedWarpTransportSampleFamily({
      state,
      warpResult: warp as Record<string, unknown>,
      adapter: sanitizedWarp.metricAdapter as WarpMetricAdapterSnapshot | undefined,
      metricT00Source,
      metricT00Ref,
    });
    if (solveBackedTransportSampleFamily) {
      sanitizedWarp.solveBackedTransportSampleFamily = solveBackedTransportSampleFamily;
    }

    // Store warp results in state for API access
    (state as any).warp = sanitizedWarp;
    (state as any).beta_avg = warp?.betaAvg ?? warp?.natarioShiftAmplitude ?? (state as any).beta_avg;

    refreshThetaAuditFromMetricAdapter(state);
    refreshCongruenceMeta(state);
    refreshUniversalCoverageStatus(state);
  } catch (e) {
    if (DEBUG_PIPE) console.warn('Warp bubble calculation failed:', e);
    if (!(state as any).warp) {
      const requestedFieldType =
        (state.dynamicConfig as any)?.warpFieldType ?? state.warpFieldType ?? "unknown";
      (state as any).warp = {
        metricAdapter: buildWarpMetricAdapterSnapshot({
          family: "unknown",
          chart: {
            label: "unspecified",
            dtGammaPolicy: "unknown",
            notes: "warp bubble calculation failed",
          },
          requestedFieldType,
          alpha: 1,
          gammaDiag: [1, 1, 1],
        }),
      };
    } else if (!(state as any).warp.metricAdapter) {
      (state as any).warp.metricAdapter = buildWarpMetricAdapterSnapshot({
        family: "unknown",
        chart: {
          label: "unspecified",
          dtGammaPolicy: "unknown",
          notes: "warp bubble calculation failed",
        },
        requestedFieldType:
          (state.dynamicConfig as any)?.warpFieldType ?? state.warpFieldType ?? "unknown",
        alpha: 1,
        gammaDiag: [1, 1, 1],
      });
    }
    refreshThetaAuditFromMetricAdapter(state);
    refreshCongruenceMeta(state);
    refreshUniversalCoverageStatus(state);
  }

  // Canonical non-Alcubierre metric source: promote VdB Region II derivatives
  // into warp.metricT00 when warp module does not provide metric stress.
  const warpState = (state as any).warp as Record<string, unknown> | undefined;
  const warpMetricSource = (warpState as any)?.metricT00Source;
  const warpStressSource = (warpState as any)?.stressEnergySource;
  const warpMetricRef =
    typeof (warpState as any)?.metricT00Ref === "string" &&
    (warpState as any).metricT00Ref.length > 0
      ? String((warpState as any).metricT00Ref)
      : undefined;
  const warpMetricValue = firstFinite((warpState as any)?.metricT00);
  const hasCanonicalMetricT00 =
    warpMetricValue !== undefined &&
    (warpMetricSource === "metric" ||
      warpStressSource === "metric" ||
      (warpMetricRef != null && warpMetricRef.startsWith("warp.metric.T00")));
  if (
    hasCanonicalMetricT00 &&
    warpState &&
    (warpMetricSource !== "metric" || warpStressSource !== "metric")
  ) {
    const metricRef =
      warpMetricRef ??
      resolveCanonicalMetricT00Ref(
        warpState as Record<string, any>,
        (warpState as any)?.metricAdapter as WarpMetricAdapterSnapshot | undefined,
      );
    (state as any).warp = {
      ...warpState,
      metricT00Source: "metric",
      stressEnergySource: "metric",
      ...(metricRef ? { metricT00Ref: metricRef } : {}),
    };
  }
  const vdbRegionII = (state as any).vdbRegionII;
  const vdbRegionIIT00Geom = firstFinite(vdbRegionII?.t00_mean);
  let vdbRegionIIPromoted = false;
  if (
    !hasCanonicalMetricT00 &&
    hasVdbRegionIIMetricSupport(vdbRegionII) &&
    vdbRegionIIT00Geom !== undefined
  ) {
    const vdbMetricT00Si = vdbRegionIIT00Geom * GEOM_TO_SI_STRESS;
    const vdbBMin = Number(vdbRegionII?.b_min);
    const vdbBMax = Number(vdbRegionII?.b_max);
    const vdbBRepresentative =
      Number.isFinite(vdbBMin) &&
      vdbBMin > 0 &&
      Number.isFinite(vdbBMax) &&
      vdbBMax > 0
        ? Math.sqrt(vdbBMin * vdbBMax)
        : Number.isFinite(state.gammaVanDenBroeck)
          ? Math.sqrt(Math.max(1, Number(state.gammaVanDenBroeck)))
          : 1;
    const vdbGammaDiagValue = Math.max(1e-12, vdbBRepresentative * vdbBRepresentative);
    const existingAdapter = (warpState as any)?.metricAdapter as
      | WarpMetricAdapterSnapshot
      | undefined;
    const vdbFallbackShiftField = buildVdbFallbackShiftField(state);
    const vdbConformalDiagnostics = buildVdbConformalDiagnostics(
      vdbRegionII,
      vdbFallbackShiftField?.amplitude,
    );
    const existingChartLabel = existingAdapter?.chart?.label;
    const existingContractStatus = existingAdapter?.chart?.contractStatus;
    const useVdbAdapterFallback =
      !existingAdapter ||
      existingChartLabel === "unspecified" ||
      existingContractStatus === "unknown";
    const metricStressDiagnostics = {
      sampleCount: Number.isFinite(vdbRegionII?.sampleCount)
        ? Number(vdbRegionII.sampleCount)
        : 0,
      rhoGeomMean: vdbRegionIIT00Geom,
      rhoSiMean: vdbMetricT00Si,
      kTraceMean: undefined,
      kSquaredMean: undefined,
      step_m: Number.isFinite(vdbRegionII?.delta_tilde_m)
        ? Number(vdbRegionII.delta_tilde_m) /
          Math.max(1, Number(vdbRegionII?.sampleCount) || 1)
        : 0,
      scale_m: Number.isFinite(vdbRegionII?.r_tilde_m)
        ? Number(vdbRegionII.r_tilde_m)
        : 0,
    };
    const rebuiltExistingVdbAdapter =
      !useVdbAdapterFallback &&
      existingAdapter?.family === "vdb" &&
      vdbConformalDiagnostics
        ? buildWarpMetricAdapterSnapshot({
            family: "vdb",
            chart: existingAdapter.chart,
            requestedFieldType: existingAdapter.requestedFieldType,
            alpha: existingAdapter.alpha,
            lapseSummary: existingAdapter.lapseSummary,
            gammaDiag: existingAdapter.gammaDiag,
            hodgeDiagnostics: {
              maxDiv: existingAdapter.betaDiagnostics?.thetaMax,
              rmsDiv: existingAdapter.betaDiagnostics?.thetaRms,
              maxCurl: existingAdapter.betaDiagnostics?.curlMax,
              rmsCurl: existingAdapter.betaDiagnostics?.curlRms,
            },
            sampleCount: existingAdapter.betaDiagnostics?.sampleCount,
            expansionScalar:
              existingAdapter.betaDiagnostics?.thetaMax ??
              existingAdapter.betaDiagnostics?.thetaRms,
            curlMagnitude:
              existingAdapter.betaDiagnostics?.curlMax ??
              existingAdapter.betaDiagnostics?.curlRms,
            vdbConformalDiagnostics,
            note:
              "Existing VdB adapter rebuilt with region-II conformal derivative diagnostics",
          })
        : undefined;
    (state as any).warp = {
      ...(warpState ?? {}),
      metricT00: vdbMetricT00Si,
      metricT00Source: "metric",
      metricT00Ref: "warp.metric.T00.vdb.regionII",
      metricT00Derivation: "forward_B_to_derivatives_to_rho_E",
      metricStressDiagnostics,
      stressEnergySource: "metric",
      metricAdapter: useVdbAdapterFallback
        ? buildWarpMetricAdapterSnapshot({
            family: "vdb",
            chart: {
              label: "comoving_cartesian",
              dtGammaPolicy: "assumed_zero",
              notes: "Derived from Van Den Broeck region-II diagnostics",
            },
            requestedFieldType:
              (state.dynamicConfig as any)?.warpFieldType ??
              state.warpFieldType ??
              "unknown",
            alpha: 1,
            gammaDiag: [vdbGammaDiagValue, vdbGammaDiagValue, vdbGammaDiagValue],
            shiftVectorField: vdbFallbackShiftField,
            vdbConformalDiagnostics,
            note: `metricT00 promoted from VdB region-II derivative diagnostics; gammaDiag=B_rep^2 (${vdbGammaDiagValue.toExponential(3)})`,
          })
        : rebuiltExistingVdbAdapter ?? existingAdapter,
    };
    vdbRegionIIPromoted = true;
  }
  const vdbRegionIV = (state as any).vdbRegionIV;
  const vdbRegionIVT00Geom = firstFinite(vdbRegionIV?.t00_mean);
  if (
    !hasCanonicalMetricT00 &&
    !vdbRegionIIPromoted &&
    hasVdbRegionIVMetricSupport(vdbRegionIV) &&
    vdbRegionIVT00Geom !== undefined
  ) {
    const vdbMetricT00Si = vdbRegionIVT00Geom * GEOM_TO_SI_STRESS;
    const existingAdapter = (warpState as any)?.metricAdapter as
      | WarpMetricAdapterSnapshot
      | undefined;
    const existingChartLabel = existingAdapter?.chart?.label;
    const existingContractStatus = existingAdapter?.chart?.contractStatus;
    const useVdbAdapterFallback =
      !existingAdapter ||
      existingChartLabel === "unspecified" ||
      existingContractStatus === "unknown";
    const vdbFallbackShiftField = buildVdbFallbackShiftField(state);
    const metricStressDiagnostics = {
      sampleCount: Number.isFinite(vdbRegionIV?.sampleCount)
        ? Number(vdbRegionIV.sampleCount)
        : 0,
      rhoGeomMean: vdbRegionIVT00Geom,
      rhoSiMean: vdbMetricT00Si,
      kTraceMean: Number.isFinite(vdbRegionIV?.k_trace_mean)
        ? Number(vdbRegionIV.k_trace_mean)
        : undefined,
      kSquaredMean: Number.isFinite(vdbRegionIV?.k_squared_mean)
        ? Number(vdbRegionIV.k_squared_mean)
        : undefined,
      step_m: Number.isFinite(vdbRegionIV?.step_m) ? Number(vdbRegionIV.step_m) : 0,
      scale_m: Number.isFinite(vdbRegionIV?.R_m) ? Number(vdbRegionIV.R_m) : 0,
    };
    const rebuiltExistingVdbAdapter =
      !useVdbAdapterFallback &&
      existingAdapter?.family === "vdb"
        ? buildWarpMetricAdapterSnapshot({
            family: "vdb",
            chart: existingAdapter.chart,
            requestedFieldType: existingAdapter.requestedFieldType,
            alpha: existingAdapter.alpha,
            lapseSummary: existingAdapter.lapseSummary,
            gammaDiag: existingAdapter.gammaDiag,
            hodgeDiagnostics: {
              maxDiv: existingAdapter.betaDiagnostics?.thetaMax,
              rmsDiv: existingAdapter.betaDiagnostics?.thetaRms,
              maxCurl: existingAdapter.betaDiagnostics?.curlMax,
              rmsCurl: existingAdapter.betaDiagnostics?.curlRms,
            },
            sampleCount: existingAdapter.betaDiagnostics?.sampleCount,
            expansionScalar:
              existingAdapter.betaDiagnostics?.thetaMax ??
              existingAdapter.betaDiagnostics?.thetaRms,
            curlMagnitude:
              existingAdapter.betaDiagnostics?.curlMax ??
              existingAdapter.betaDiagnostics?.curlRms,
            note: "Existing VdB adapter retained for region-IV metric fallback",
          })
        : undefined;
    (state as any).warp = {
      ...(warpState ?? {}),
      metricT00: vdbMetricT00Si,
      metricT00Source: "metric",
      metricT00Ref: "warp.metric.T00.vdb.regionIV",
      metricT00Derivation: "forward_fwall_to_rho_E",
      metricStressDiagnostics,
      stressEnergySource: "metric",
      metricAdapter: useVdbAdapterFallback
        ? buildWarpMetricAdapterSnapshot({
            family: "vdb",
            chart: {
              label: "comoving_cartesian",
              dtGammaPolicy: "assumed_zero",
              notes: "Derived from Van Den Broeck region-IV f-wall diagnostics",
            },
            requestedFieldType:
              (state.dynamicConfig as any)?.warpFieldType ??
              state.warpFieldType ??
              "unknown",
            alpha: 1,
            gammaDiag: [1, 1, 1],
            shiftVectorField: vdbFallbackShiftField,
            sampleScale_m: Number.isFinite(vdbRegionIV?.R_m)
              ? Number(vdbRegionIV.R_m)
              : undefined,
            note: "Fallback VdB adapter seeded from region-IV f-wall diagnostics",
          })
        : rebuiltExistingVdbAdapter ?? existingAdapter,
    };
    if ((state as any).uniformsExplain?.warpMetric) {
      (state as any).uniformsExplain.warpMetric.metricT00Derivation =
        "forward_fwall_to_rho_E";
      (state as any).uniformsExplain.warpMetric.note =
        "metricT00 promoted from VdB region-IV f-wall diagnostics";
    }
  }

  const vdbConformalDiagnostics = buildVdbConformalDiagnostics(
    vdbRegionII,
    firstFinite(
      (warpState as any)?.shiftVectorField?.amplitude,
      (warpState as any)?.betaAvg,
      (state as any)?.beta_avg,
    ),
  );
  const gammaVdB = Number(state.gammaVanDenBroeck);
  const needsConformal =
    Number.isFinite(gammaVdB) && gammaVdB > 1 && hasVdbRegionIIDerivatives(vdbRegionII);
  const warpStateLatest = (state as any).warp as Record<string, any> | undefined;
  if (needsConformal && vdbConformalDiagnostics && warpStateLatest?.metricAdapter) {
    const adapter = warpStateLatest.metricAdapter as WarpMetricAdapterSnapshot;
    warpStateLatest.metricAdapter = buildWarpMetricAdapterSnapshot({
      family: adapter.family,
      chart: adapter.chart,
      requestedFieldType: adapter.requestedFieldType,
      alpha: adapter.alpha,
      lapseSummary: adapter.lapseSummary ?? (warpStateLatest as any)?.lapseSummary,
      gammaDiag: adapter.gammaDiag,
      betaDiagnostics: adapter.betaDiagnostics,
      vdbConformalDiagnostics,
      note: "VdB conformal diagnostics injected from region-II",
    });
  }
  refreshMetricT00Contract(state);
  refreshShiftLapseTransportPromotionGate(state);
  refreshWarpWorldlineContract(state);
  refreshWarpCruiseEnvelopePreflight(state);
  refreshWarpRouteTimeWorldline(state);
  refreshWarpMissionTimeEstimator(state);
  refreshWarpMissionTimeComparison(state);
  refreshWarpCruiseEnvelope(state);
  await refreshWarpInHullProperAcceleration(state);
  refreshMetricConstraintAudit(state);
  refreshCl3Telemetry(state);
  refreshCasimirMaterialReceipt(state);
  refreshNhm2SourceClosure(state);
  refreshThetaAuditFromMetricAdapter(state);
  refreshCongruenceMeta(state);
  refreshUniversalCoverageStatus(state);

  // Recompute tau_LC/TS from metric adapter path length once the adapter is finalized.
  const metricPath_m = resolveMetricPathLengthFromAdapter(state);
  if (
    clockingProvenance !== "hardware" &&
    Number.isFinite(metricPath_m) &&
    (metricPath_m as number) > 0
  ) {
    const metricClocking = computeClocking({
      path_m: metricPath_m as number,
      burst_ms: Number.isFinite((state as any)?.lightCrossing?.burst_ms)
        ? Number((state as any).lightCrossing.burst_ms)
        : undefined,
      dwell_ms: Number.isFinite((state as any)?.lightCrossing?.dwell_ms)
        ? Number((state as any).lightCrossing.dwell_ms)
        : sectorPeriodMs,
      sectorPeriod_ms: sectorPeriodMs,
      localDuty: state.dutyBurst,
    });
    if (
      Number.isFinite(metricClocking.tauLC_ms as number) &&
      (metricClocking.tauLC_ms as number) > 0
    ) {
      const lightCrossingState = ((state as any).lightCrossing ?? {}) as Record<string, unknown>;
      lightCrossingState.tauLC_ms = metricClocking.tauLC_ms;
      lightCrossingState.burst_ms =
        metricClocking.tauPulse_ms ?? lightCrossingState.burst_ms;
      lightCrossingState.dwell_ms = metricClocking.dwell_ms ?? lightCrossingState.dwell_ms;
      const metricTs = Number(metricClocking.TS);
      if (Number.isFinite(metricTs) && metricTs > 0) {
        state.TS_long = metricTs;
        state.TS_ratio = metricTs;
        lightCrossingState.TS = metricTs;
      }
      (state as any).lightCrossing = lightCrossingState;
      (state as any).tauLC_ms = lightCrossingState.tauLC_ms;
      state.clocking = {
        ...(state.clocking ?? metricClocking),
        ...metricClocking,
        detail: `${metricClocking.detail}; tau_LC from metric adapter gammaDiag`,
      };
    }
  }

  // Re-evaluate TS metric derivation after warp adapter / metric promotion is available.
  const tsMetricStatus = resolveTsMetricDerivedStatus(state, clockingProvenance);
  state.tsMetricDerived = tsMetricStatus.metricDerived;
  state.tsMetricDerivedSource = tsMetricStatus.source;
  state.tsMetricDerivedReason = tsMetricStatus.reason;
  (state as any).tsMetricDerived = tsMetricStatus.metricDerived;
  (state as any).tsMetricDerivedSource = tsMetricStatus.source;
  (state as any).tsMetricDerivedReason = tsMetricStatus.reason;
  if (state.clocking) {
    state.clocking = {
      ...state.clocking,
      metricDerived: tsMetricStatus.metricDerived,
      metricDerivedSource: tsMetricStatus.source,
      metricDerivedReason: tsMetricStatus.reason,
      metricDerivedChart: tsMetricStatus.chart,
    };
  }
  if (state.ts) {
    state.ts = {
      ...state.ts,
      metricDerived: tsMetricStatus.metricDerived,
      metricDerivedSource: tsMetricStatus.source,
      metricDerivedReason: tsMetricStatus.reason,
      metricDerivedChart: tsMetricStatus.chart,
    };
    (state as any).ts = state.ts;
  }

  // Refresh QI guardrail after warp metric promotion so exported QI status/source
  // reflects the final metric adapter and clocking contract in this tick.
  const qiGuardLate = evaluateQiGuardrail(state, {
    schedule: phaseSchedule,
    sectorPeriod_ms: sectorPeriodMs,
    sampler,
    tau_ms: tauMs,
  });
  if (qiGuardLate) {
    state.zeta = qiGuardLate.marginRatio;
    (state as any).zetaRaw = qiGuardLate.marginRatioRaw;
    (state as any).zetaRawComputed = qiGuardLate.marginRatioRawComputed;
    (state as any).qiGuardrail = qiGuardLate;
    state.congruentSolve = buildCongruentWarpSolveSnapshot(qiGuardLate);
    const qiStatusLate = deriveQiStatus({
      zetaRaw: qiGuardLate.marginRatioRaw,
      zetaClamped: qiGuardLate.marginRatio,
      pAvg: state.P_avg,
      pWarn: P_warn,
      mode: state.currentMode,
    });
    state.fordRomanCompliance = qiStatusLate.compliance;
    state.curvatureLimit = state.fordRomanCompliance;
    state.overallStatus = qiStatusLate.overallStatus;
  }
  refreshNhm2QeiWorldlineDossier(state);
  refreshNhm2StrictSignalReadiness(state);
  refreshNhm2ObserverAudit(state);
  refreshNhm2NatarioInvariantAudit(state);
  applyNhm2PhaseTopologyGate(state as any);
  // Canonical Natario payload now mirrors solved warp metric output.
  // Legacy inverse/proxy Natario is retained under `natarioLegacy` for diagnostics.
  (state as any).natario = buildNatarioRuntimePayload(
    state,
    ((state as any).natarioLegacy as Record<string, unknown> | undefined) ??
      ((state as any).natario as Record<string, unknown> | undefined),
  );
  emitQiGuardLog(state, (state as any).qiGuardrail ?? qiGuard);

  // Speed/beta closure: derive effective translation from power and warp proxy
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const clampBeta = (b: number) => Math.max(0, Math.min(0.99, b));
  const BETA_BASE_BY_MODE: Record<string, number> = {
    standby: 0.0,
    taxi: 0.0,
    nearzero: 0.02,
    hover: 0.1,
    cruise: 0.6,
    emergency: 0.95,
  };

  const betaBase = BETA_BASE_BY_MODE[String(state.currentMode).toLowerCase()] ?? 0.3;
  const beta_trans_power = P_target_W > 0 ? clamp01(P_total_W / P_target_W) : 0;
  const beta_policy = clampBeta(betaBase * beta_trans_power);
  const beta_proxy = Number((state as any)?.warp?.betaAvg ?? (state as any)?.warp?.natarioShiftAmplitude ?? (state as any).beta_avg);
  const useProxy = Number.isFinite(beta_proxy) && Math.abs(beta_proxy) > 1e-6;
  const shipBeta = useProxy ? clampBeta(beta_proxy) : beta_policy;

  state.beta_trans_power = beta_trans_power;
  state.beta_policy = beta_policy;
  state.shipBeta = shipBeta;
  state.speedClosure = useProxy ? 'proxyB' : 'policyA';
  state.vShip_mps = shipBeta * C;
  // Surface the closure inputs for downstream panels/scripts
  state.P_target_W = P_target_W;
  state.P_cap_W = P_cap_W;
  state.physicsCap_W = physicsCap_W;

  flushPendingPumpCommand();
  updateQiTelemetry(state);
  const guardForStats = (state as any).qiGuardrail;
  if (state.qi && guardForStats) {
    state.qi.fieldType = (state.qi.fieldType ?? guardForStats.fieldType) as any;
    state.qi.sampledIntegral_Jm3 = guardForStats.lhs_Jm3;
    state.qi.boundTight_Jm3 = guardForStats.bound_Jm3;
    state.qi.marginRatio = guardForStats.marginRatio;
    state.qi.marginRatioRaw = guardForStats.marginRatioRaw;
    (state.qi as any).marginRatioRawComputed = guardForStats.marginRatioRawComputed;
    state.qi.policyLimit = guardForStats.policyLimit;
  }

  try {
    const tail = sweepHistory.slice(-SWEEP_HISTORY_MAX);
    state.vacuumGapSweepResults = tail;
    const lifetimes = getSweepHistoryTotals();
    state.vacuumGapSweepRowsTotal = lifetimes.total;
    state.vacuumGapSweepRowsDropped = lifetimes.dropped;
    const prevTruth = state.hardwareTruth ?? {};
    state.hardwareTruth = {
      ...prevTruth,
      totals: lifetimes,
    };
  } catch {
    // non-fatal
  }

  try {
    state.cardRecipe = buildCardRecipeFromPipeline(state);
  } catch (err) {
    if (DEBUG_PIPE) console.warn("[pipeline] card recipe build failed:", err);
  }

  state.grRequest = buildGrRequestPayload(state);

  return state;
}

function flushPendingPumpCommand(): void {
  if (!pendingPumpCommand) return;
  const next = pendingPumpCommand;
  pendingPumpCommand = undefined;
  void slewPumpMultiTone(next).catch((err) => {
    if (!DEBUG_PIPE) return;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[pipeline] multi-tone pump slew failed: ${message}`);
  });
}

function buildCongruentWarpSolveSnapshot(qiGuard: any): CongruentWarpSolveSnapshot | null {
  if (!qiGuard || typeof qiGuard !== "object") return null;
  const failReasons = Array.isArray(qiGuard.congruentSolveFailReasons)
    ? qiGuard.congruentSolveFailReasons
        .map((reason: unknown) => String(reason))
        .filter((reason: string) => reason.length > 0)
    : [];
  const marginRatioRaw = Number.isFinite(qiGuard.marginRatioRaw)
    ? Number(qiGuard.marginRatioRaw)
    : null;
  const marginRatioRawComputed = Number.isFinite(qiGuard.marginRatioRawComputed)
    ? Number(qiGuard.marginRatioRawComputed)
    : null;
  const applicabilityStatusRaw = String(qiGuard.applicabilityStatus ?? "");
  const applicabilityStatus =
    applicabilityStatusRaw === "PASS" ||
    applicabilityStatusRaw === "FAIL" ||
    applicabilityStatusRaw === "NOT_APPLICABLE" ||
    applicabilityStatusRaw === "UNKNOWN"
      ? (applicabilityStatusRaw as CongruentWarpSolveSnapshot["applicabilityStatus"])
      : null;
  return {
    pass: qiGuard.congruentSolvePass === true,
    policyMarginPass: qiGuard.congruentSolvePolicyMarginPass === true,
    computedMarginPass: qiGuard.congruentSolveComputedMarginPass === true,
    applicabilityPass: qiGuard.congruentSolveApplicabilityPass === true,
    metricPass: qiGuard.congruentSolveMetricPass === true,
    semanticPass: qiGuard.congruentSolveSemanticPass === true,
    failReasons,
    marginRatioRaw,
    marginRatioRawComputed,
    applicabilityStatus,
    quantitySemanticType: qiGuard.quantitySemanticType != null ? String(qiGuard.quantitySemanticType) : null,
    quantityWorldlineClass:
      qiGuard.quantityWorldlineClass != null ? String(qiGuard.quantityWorldlineClass) : null,
    rhoSource: qiGuard.rhoSource != null ? String(qiGuard.rhoSource) : null,
    metricDerivedSource: qiGuard.metricDerivedSource != null ? String(qiGuard.metricDerivedSource) : null,
    strictMode: qiGuard.strictMode === true,
  };
}

function emitQiGuardLog(state: EnergyPipelineState, qiGuard: any): void {
  if (!qiGuard) return;
  const zetaForStatus = Number.isFinite(qiGuard.marginRatioRaw)
    ? qiGuard.marginRatioRaw
    : Number.isFinite(qiGuard.marginRatio)
    ? qiGuard.marginRatio
    : null;
  const guardLog = {
    margin: qiGuard.marginRatio,
    marginRaw: qiGuard.marginRatioRaw,
    marginRawComputed: qiGuard.marginRatioRawComputed,
    lhs_Jm3: qiGuard.lhs_Jm3,
    bound_Jm3: qiGuard.bound_Jm3,
    boundComputed_Jm3: qiGuard.boundComputed_Jm3,
    boundFloor_Jm3: qiGuard.boundFloor_Jm3,
    boundUsed_Jm3: qiGuard.boundUsed_Jm3,
    boundFloorApplied: qiGuard.boundFloorApplied,
    sampler: qiGuard.sampler,
    fieldType: qiGuard.fieldType,
    window_ms: qiGuard.window_ms,
    sumWindowDt: qiGuard.sumWindowDt,
    duty: qiGuard.duty,
    patternDuty: qiGuard.patternDuty,
    maskSum: qiGuard.maskSum,
    effectiveRho: qiGuard.effectiveRho,
    rhoOn: qiGuard.rhoOn,
    rhoOnDuty: qiGuard.rhoOnDuty,
    rhoSource: qiGuard.rhoSource,
    curvatureRadius_m: qiGuard.curvatureRadius_m,
    curvatureRatio: qiGuard.curvatureRatio,
    curvatureOk: qiGuard.curvatureOk,
    curvatureSource: qiGuard.curvatureSource,
    metricDerived: qiGuard.metricDerived,
    metricDerivedSource: qiGuard.metricDerivedSource,
    metricDerivedReason: qiGuard.metricDerivedReason,
    metricDerivedChart: qiGuard.metricDerivedChart,
    TS: state.clocking?.TS ?? state.TS_ratio ?? null,
    clockingDetail: state.clocking ?? null,
  };

  const breach = !Number.isFinite(zetaForStatus) || (zetaForStatus as number) >= 1;
  const mode: "breach" | "debug" = breach ? "breach" : "debug";
  if (!breach && !DEBUG_PIPE) return;
  const now = Date.now();
  const shouldLog = now - lastQiGuardLogAt >= QI_GUARD_LOG_MIN_INTERVAL_MS || lastQiGuardLogMode !== mode;
  if (!shouldLog) return;
  lastQiGuardLogAt = now;
  lastQiGuardLogMode = mode;
  if (breach) {
    console.warn("[QI-guard] sampled integral exceeds bound", guardLog);
    return;
  }
  console.log("[QI-guard]", guardLog);
}

function updateQiTelemetry(state: EnergyPipelineState) {
  const desiredSampler = (state.qi as any)?.sampler ?? DEFAULT_QI_SETTINGS.sampler;
  const desiredTau = Number.isFinite(state.qi?.tau_s_ms)
    ? Number(state.qi?.tau_s_ms)
    : DEFAULT_QI_TAU_MS;
  const desiredField = (state.qi as any)?.fieldType ?? DEFAULT_QI_FIELD;
  const desiredDt = desiredQiSampleDt(state);
  reconfigureQiMonitor(desiredTau, desiredDt, desiredField as QiFieldType, desiredSampler as SamplingKind);
  const effectiveRho = estimateEffectiveRhoFromState(state);
  const baseStats = advanceQiMonitor(effectiveRho);
  const { tiles: synthesizedTiles, metrics, source } = buildQiTilesFromState(state, baseStats);
  const lrlTelemetry = deriveQiLaplaceRungeLenz(state, baseStats);
  const stats: QiStats = metrics
    ? {
        ...baseStats,
        ...metrics,
        homogenizerSource: source,
        ...(lrlTelemetry ?? {}),
      }
    : {
        ...baseStats,
        ...(lrlTelemetry ?? {}),
      };
  const interest = computeQuantumInterestBook(state);
  // Reduced-order only: repayment bookkeeping is heuristic unless theorem-mapped for the active regime.
  (stats as any).repayment_label = "repayment_heuristic";
  if (interest) {
    state.qiInterest = interest;
    stats.interestRate = interest.rate;
    stats.interestWindow_ms = interest.window_ms;
    stats.interestDebt = interest.debt_Jm3;
    stats.interestCredit = interest.credit_Jm3;
    stats.interestMargin = interest.margin_Jm3;
    stats.interestNetCycle = interest.netCycle_Jm3;
    stats.interestNeg = interest.neg_Jm3;
    stats.interestPos = interest.pos_Jm3;
    (stats as any).repayment_label = "repayment_heuristic";
  } else {
    state.qiInterest = null;
  }
  state.qi = {
    ...stats,
    sampler: desiredSampler as any,
    tau_s_ms: desiredTau,
    fieldType: desiredField as any,
  };
  (state.qi as any).tau_monitor_s_ms = Number(baseStats.tau_s_ms);
  (state.qi as any).sampler_monitor = baseStats.sampler;
  (state.qi as any).tau_monitor_clamped =
    Number.isFinite(baseStats.tau_s_ms) && Math.abs(Number(baseStats.tau_s_ms) - desiredTau) > 1e-9;
  if (synthesizedTiles.length) {
    updatePipelineQiTiles(synthesizedTiles, { source: "synthetic" });
  } else {
    updatePipelineQiTiles([], { source: "synthetic" });
  }

  const qiAutothrottleScale =
    state.qiAutothrottle?.enabled === true && Number.isFinite(state.qiAutothrottle.scale)
      ? clampNumber(state.qiAutothrottle.scale as number, 0, 1)
      : 1;
  const autoscaleRawScale = Number.isFinite(state.qiAutoscale?.appliedScale)
    ? (state.qiAutoscale?.appliedScale as number)
    : Number.isFinite(state.qiAutoscale?.scale)
    ? (state.qiAutoscale?.scale as number)
    : 1;
  const qiAutoscaleScale =
    Number.isFinite(autoscaleRawScale) && (autoscaleRawScale as number) > 0
      ? clampNumber(autoscaleRawScale, 0, 1)
      : 1;
  const qiScale = qiAutothrottleScale * qiAutoscaleScale;

  const autoscaleTarget = Number.isFinite(state.qiAutoscale?.targetZeta)
    ? clampNumber(state.qiAutoscale?.targetZeta as number, 1e-6, 1e6)
    : Number.isFinite(QI_AUTOSCALE_TARGET)
    ? clampNumber(QI_AUTOSCALE_TARGET, 1e-6, 1e6)
    : 0.9;
  const autoscaleSlewPerS =
    Number.isFinite(QI_AUTOSCALE_SLEW) ? Math.max(0, QI_AUTOSCALE_SLEW) : 0.25;

  if (PUMP_TONE_ENABLE) {
    const cmd = getPumpCommandForQi(stats, { epoch_ms: GLOBAL_PUMP_EPOCH_MS });
    if (cmd) {
      const scaledCmd = applyScaleToPumpCommand(cmd, qiScale, state.qiAutoscale?.clamps) ?? cmd;
      const now = Date.now();
      const hash = hashPumpCommand(scaledCmd);
      const since = Math.max(0, now - lastPublishedPumpAt);
      const changed = hash !== lastPublishedPumpHash;
      const pastMinInterval = since >= PUMP_CMD_MIN_INTERVAL_MS;
      const keepAliveDue = since >= PUMP_CMD_KEEPALIVE_MS;

      if ((changed && pastMinInterval) || (keepAliveDue && pastMinInterval)) {
        publishPumpCommand(scaledCmd);
        lastPublishedPumpHash = hash;
        lastPublishedPumpAt = now;
      }
    }
  }

  if (DEBUG_PIPE) {
    const qiAutoMin =
      Number.isFinite(state.qiAutoscale?.minScale) && (state.qiAutoscale?.minScale as number) > 0
        ? (state.qiAutoscale?.minScale as number)
        : Number.isFinite(QI_AUTOSCALE_MIN_SCALE)
        ? (QI_AUTOSCALE_MIN_SCALE as number)
        : 0.02;
    const qiAutoSlew =
      Number.isFinite(state.qiAutoscale?.slewPerSec)
        ? (state.qiAutoscale?.slewPerSec as number)
        : Number.isFinite(state.qiAutoscale?.slew)
        ? (state.qiAutoscale?.slew as number)
        : autoscaleSlewPerS;
    console.log("[QI-autoscale]", {
      gating: state.qiAutoscale?.gating ?? "idle",
      engaged: state.qiAutoscale?.engaged ?? false,
      scale: state.qiAutoscale?.appliedScale ?? state.qiAutoscale?.scale ?? 1,
      proposedScale: state.qiAutoscale?.proposedScale ?? null,
      target: state.qiAutoscale?.targetZeta ?? autoscaleTarget,
      slew: qiAutoSlew,
      floor: qiAutoMin,
      zetaRaw: state.qiAutoscale?.rawZeta ?? null,
      sumWindowDt: state.qiAutoscale?.sumWindowDt ?? null,
      source: state.qiAutoscale?.rhoSource ?? null,
      note: state.qiAutoscale?.note ?? null,
      clamps: Array.isArray(state.qiAutoscale?.clamps)
        ? (state.qiAutoscale?.clamps ?? []).slice(-2)
        : [],
    });
  }

  const guardFrac = DEFAULT_QI_SETTINGS.guardBand ?? 0;
  const guardThreshold = Math.abs(stats.bound) * guardFrac;
  const interestDebt = Number(stats.interestDebt);
  const interestMargin = Number(stats.interestMargin);
  const hasInterestDebt = Number.isFinite(interestDebt) && interestDebt > 0;
  const interestGuardThreshold = hasInterestDebt ? Math.abs(interestDebt) * guardFrac : 0;
  let badge: 'ok' | 'near' | 'violation';

  if (!Number.isFinite(stats.margin)) {
    badge = 'violation';
  } else if (stats.margin < 0 || (hasInterestDebt && Number.isFinite(interestMargin) && interestMargin < 0)) {
    badge = 'violation';
  } else if (stats.margin < guardThreshold || (hasInterestDebt && interestMargin < interestGuardThreshold)) {
    badge = 'near';
  } else {
    badge = 'ok';
  }

  state.qiBadge = badge;
}

type HomogenizerSource = "synthetic" | "hardware" | "offline";

type LatticeHomogenizationMetrics = {
  varT00_lattice: number;
  gradT00_norm: number;
  C_warp: number;
  QI_envelope_okPct: number;
  sigmaT00_norm: number;
  sigmaT00_Jm3: number;
  maxTileSigma: number;
  trimEnergy_pct: number;
  meanT00_abs: number;
};

type LatticeHomogenizationResult = {
  tiles: RawTileInput[];
  metrics: LatticeHomogenizationMetrics;
  source: HomogenizerSource;
};

type TileTemplate = {
  id: string;
  ijk: [number, number, number];
  center: [number, number, number];
  envelope: number;
};

const EMPTY_LATTICE_RESULT: LatticeHomogenizationResult = {
  tiles: [],
  source: "offline",
  metrics: {
    varT00_lattice: 0,
    gradT00_norm: 0,
    C_warp: 1,
    QI_envelope_okPct: 100,
    sigmaT00_norm: 0,
    sigmaT00_Jm3: 0,
    maxTileSigma: 0,
    trimEnergy_pct: 0,
    meanT00_abs: 0,
  },
};

function buildQiTilesFromState(
  state: EnergyPipelineState,
  stats: QiStats,
): LatticeHomogenizationResult {
  const tileHint = firstFinite(
    state.activeTiles,
    (state as any)?.tiles?.active,
    state.N_tiles,
    state.tilesPerSector,
  );
  const gridEdgeRaw =
    tileHint && tileHint > 0
      ? Math.round(Math.sqrt(Math.min(tileHint, QI_STREAM_GRID_MAX * QI_STREAM_GRID_MAX)))
      : QI_STREAM_GRID_DEFAULT;
  const gridEdge = clampInt(gridEdgeRaw, QI_STREAM_GRID_MIN, QI_STREAM_GRID_MAX);
  const cols = Math.max(1, gridEdge);
  const rows = Math.max(1, gridEdge);
  const total = cols * rows;
  if (total <= 0) return EMPTY_LATTICE_RESULT;

  const tau_s =
    Number.isFinite(stats.tau_s_ms) && stats.tau_s_ms > 0
      ? (stats.tau_s_ms as number) / 1000
      : DEFAULT_QI_TAU_MS / 1000;
  const limit = Math.max(
    1e-6,
    Math.abs(Number(stats.bound)) || Math.abs(DEFAULT_QI_BOUND_SCALAR) || 1,
  );
  const baseAvg = Math.abs(Math.min(0, Number(stats.avg) || 0)) / limit;
  const baseS = clampNumber(Number.isFinite(baseAvg) ? baseAvg : 0, 0, 1.5);
  const activity = clampNumber(state.activeFraction ?? 0.25, 0, 1);
  const guardRatio = clampNumber(
    Math.abs(Number(stats.margin) || 0) / Math.max(limit, 1e-6),
    0,
    1.5,
  );
  const qFactor = Number.isFinite(state.qCavity) ? (state.qCavity as number) : undefined;
  const temperature = Number.isFinite(state.temperature_K)
    ? (state.temperature_K as number)
    : undefined;
  const hullReferenceRadius = resolveHullReferenceRadiusM(state, {
    Lx_m: 200,
    Ly_m: 200,
    Lz_m: 200,
  });
  const span = Math.max(1, hullReferenceRadius * 2);
  const spacing = span / Math.max(cols, rows);
  const origin = -span / 2;
  const diagNorm = Math.max(1, Math.hypot(cols, rows));
  const phase = Date.now() * 0.0007;

  const rhoField: number[] = new Array(total);
  const saturationField: number[] = new Array(total);
  const templates: TileTemplate[] = new Array(total);
  let minSat = Number.POSITIVE_INFINITY;
  let maxSat = Number.NEGATIVE_INFINITY;
  const guardPenalty = clampNumber(1 - 0.6 * guardRatio, 0.15, 1);
  const rippleAmpBase = 0.15 + 0.35 * (0.5 + 0.5 * guardPenalty);
  const envelopeAmpBase = 0.2 + 0.4 * guardPenalty;
  const checkerAmp = 0.06 * guardPenalty;
  const bias = 0.05 * guardPenalty;
  for (let idx = 0; idx < total; idx += 1) {
    const i = idx % cols;
    const j = Math.floor(idx / cols);
    const radial = Math.hypot(i - cols / 2, j - rows / 2) / (diagNorm / 2);
    const envelope = 1 - clampNumber(radial, 0, 1);
    const ripple = Math.sin(phase + 0.23 * i + 0.31 * j) * Math.cos(0.07 * phase + 0.19 * i - 0.13 * j);
    const checker = ((i + j) & 1) === 0 ? 1 : -1;
    const stress =
      guardPenalty * baseS +
      rippleAmpBase * ripple +
      envelopeAmpBase * envelope +
      checkerAmp * checker +
      bias;
    const S = clampNumber(stress, 0.02, 1.5);
    const rho = -limit * S;
    rhoField[idx] = rho;
    saturationField[idx] = S;
    if (S < minSat) minSat = S;
    if (S > maxSat) maxSat = S;
    templates[idx] = {
      id: `sim-${i}-${j}`,
      ijk: [i, j, 0],
      center: [origin + (i + 0.5) * spacing, origin + (j + 0.5) * spacing, 0],
      envelope,
    };
  }
  if (maxSat - minSat < 1e-4) {
    for (let idx = 0; idx < total; idx += 1) {
      const i = idx % cols;
      const j = Math.floor(idx / cols);
      const envelope = templates[idx]?.envelope ?? 0.5;
      const ripple = Math.sin(0.37 * phase + 0.29 * i - 0.11 * j);
      const fallback = clampNumber(0.08 + 0.25 * envelope + 0.12 * ripple, 0.01, 0.6);
      saturationField[idx] = fallback;
      rhoField[idx] = -limit * fallback;
    }
  }
  const metrics = deriveLatticeHomogenizationMetrics(rhoField, saturationField, cols, rows, limit);
  const meanAbs = metrics.meanT00_abs ?? 0;
  const sigmaAbs = metrics.sigmaT00_Jm3 ?? 0;
  const invSigma = sigmaAbs > 1e-9 ? 1 / sigmaAbs : 0;
  const tiles: RawTileInput[] = new Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    const template = templates[idx];
    const rho = rhoField[idx];
    const absRho = Math.abs(rho);
    const deviation = absRho - meanAbs;
    const sigmaNorm = invSigma ? deviation * invSigma : 0;
    const envelope = template?.envelope ?? 0;
    const guardPenalty = 1 - clampNumber(guardRatio, 0, 1);
    const weight = clampNumber(0.25 + 0.75 * envelope * guardPenalty, 0.05, 1);
    tiles[idx] = {
      id: template?.id ?? `sim-${idx}`,
      ijk: template?.ijk ?? [idx % cols, Math.floor(idx / cols), 0],
      center_m:
        template?.center ?? [origin + ((idx % cols) + 0.5) * spacing, origin + (Math.floor(idx / cols) + 0.5) * spacing, 0],
      rho_neg_Jm3: rho,
      tau_eff_s: tau_s,
      qi_limit: limit,
      Q_factor: qFactor,
      T_K: temperature,
      absRho_Jm3: absRho,
      deviation_Jm3: deviation,
      sigmaNorm,
      weight,
    };
  }
  return { tiles, metrics, source: "synthetic" };
}

function deriveLatticeHomogenizationMetrics(
  rhoField: number[],
  saturationField: number[],
  cols: number,
  rows: number,
  limit: number,
): LatticeHomogenizationMetrics {
  const total = rhoField.length;
  if (!total) return EMPTY_LATTICE_RESULT.metrics;

  const limitAbs = Math.max(Math.abs(limit), 1e-6);
  let meanSat = 0;
  for (const sat of saturationField) meanSat += sat;
  meanSat /= total;

  let varianceSat = 0;
  let maxSatDelta = 0;
  let satDeviationSum = 0;
  for (const sat of saturationField) {
    const delta = sat - meanSat;
    varianceSat += delta * delta;
    const mag = Math.abs(delta);
    if (mag > maxSatDelta) maxSatDelta = mag;
    satDeviationSum += mag;
  }
  varianceSat /= total;
  const sigmaSat = Math.sqrt(Math.max(varianceSat, 0));
  const sigmaAbs = sigmaSat * limitAbs;
  const sigmaNorm = sigmaSat;
  const maxTileSigma = sigmaSat > 1e-9 ? maxSatDelta / sigmaSat : 0;
  const trimEnergyPct = (satDeviationSum / Math.max(total, 1)) * 100;

  const gradNorm = computeNormalizedGradient(saturationField, cols, rows, 1);

  let okCount = 0;
  for (const sat of saturationField) {
    if (sat <= 1) okCount += 1;
  }
  const okPct = total ? (okCount / total) * 100 : 0;

  const absValues = rhoField.map((value) => Math.abs(value)).sort((a, b) => a - b);
  const median = absValues[Math.floor(absValues.length / 2)] ?? 0;
  const peak = absValues[absValues.length - 1] ?? 0;
  const ratio =
    median > 1e-6 ? peak / median : peak > 0 ? Number.POSITIVE_INFINITY : 1;
  const ratioPenalty = clampNumber((ratio - 1) / 4, 0, 4);

  const cWarp = clampNumber(
    1 -
      (0.5 * clampNumber(sigmaNorm, 0, 4) +
        0.3 * clampNumber(gradNorm, 0, 4) +
        0.2 * ratioPenalty),
    0,
    1,
  );

  return {
    varT00_lattice: clampNumber(sigmaNorm, 0, 4),
    gradT00_norm: clampNumber(gradNorm, 0, 4),
    C_warp: cWarp,
    QI_envelope_okPct: clampNumber(okPct, 0, 100),
    sigmaT00_norm: clampNumber(sigmaNorm, 0, 4),
    sigmaT00_Jm3: sigmaAbs,
    maxTileSigma: clampNumber(maxTileSigma, 0, 8),
    trimEnergy_pct: clampNumber(trimEnergyPct, 0, 400),
    meanT00_abs: meanSat * limitAbs,
  };
}

function computeNormalizedGradient(
  field: number[],
  cols: number,
  rows: number,
  scale: number,
): number {
  if (!(cols > 0 && rows > 0)) return 0;
  let accum = 0;
  let samples = 0;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const idx = j * cols + i;
      const center = field[idx];
      if (i + 1 < cols) {
        accum += Math.abs(center - field[idx + 1]);
        samples += 1;
      }
      if (j + 1 < rows) {
        accum += Math.abs(center - field[idx + cols]);
        samples += 1;
      }
    }
  }
  if (!samples) return 0;
  const avgDiff = accum / samples;
  return avgDiff / Math.max(scale, 1e-6);
}

function firstFinite(...values: Array<number | null | undefined>): number | undefined {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
}

const relDelta = (current: number, baseline: number, eps = 1e-12) =>
  Math.abs(current - baseline) / Math.max(Math.abs(baseline), eps);

type EffectiveRhoDebug = {
  source?: string;
  value?: number;
  note?: string;
  reason?: string;
};

type QiCouplingMode = "off" | "shadow";

type QiCouplingDiagnostics = {
  mode: QiCouplingMode;
  alpha: number;
  metricRho_Jm3?: number;
  metricSource?: string;
  proxyRho_Jm3?: number;
  proxySource?: string;
  coupledRhoShadow_Jm3?: number;
  residualRel?: number;
  comparable: boolean;
  equationRef: string;
  semantics: "diagnostic_only_no_gate_override";
};

type QiCouplingSemantics =
  | "diagnostic_only_no_gate_override"
  | "bridge_ready_evidence_no_gate_override";

function resolveTileTelemetryScale(): number {
  const scale = parseEnvNumber(process.env.QI_TILE_TELEMETRY_SCALE, 1);
  return Math.max(0, Math.abs(scale));
}

function resolveQiCouplingMode(): QiCouplingMode {
  const raw = String(process.env.QI_COUPLING_MODE ?? "shadow").trim().toLowerCase();
  if (raw === "off" || raw === "shadow") return raw;
  return "shadow";
}

function resolveQiCouplingAlpha(): number {
  const raw = Number(process.env.QI_COUPLING_ALPHA);
  if (!Number.isFinite(raw)) return 0.5;
  return Math.max(0, Math.min(1, raw));
}

function resolveQiProxyRhoFromState(
  state: EnergyPipelineState,
  debug?: EffectiveRhoDebug,
): number | undefined {
  const rhoStatic = Number(state.rho_static);
  if (Number.isFinite(rhoStatic)) {
    if (debug) {
      debug.source = "pipeline.rho_static";
      debug.value = rhoStatic;
      debug.note = "pipeline static energy-density proxy";
    }
    return rhoStatic;
  }

  const rhoAvg = Number(state.rho_avg);
  if (Number.isFinite(rhoAvg)) {
    if (debug) {
      debug.source = "pipeline.rho_avg";
      debug.value = rhoAvg;
      debug.note = "pipeline average energy-density proxy";
    }
    return rhoAvg;
  }

  const rhoInst = Number(state.rho_inst);
  if (Number.isFinite(rhoInst)) {
    if (debug) {
      debug.source = "pipeline.rho_inst";
      debug.value = rhoInst;
      debug.note = "pipeline instantaneous energy-density proxy";
    }
    return rhoInst;
  }

  const tileArea_m2 = Number(state.tileArea_cm2) * CM2_TO_M2;
  const gap_m = Number(state.gap_nm) * 1e-9;
  const tileVolume_m3 = tileArea_m2 * gap_m;
  if (Number.isFinite(state.U_static) && Number.isFinite(tileVolume_m3) && tileVolume_m3 > 0) {
    const rhoFromStatic = Number(state.U_static) / tileVolume_m3;
    if (Number.isFinite(rhoFromStatic)) {
      if (debug) {
        debug.source = "pipeline.U_static/tile_volume";
        debug.value = rhoFromStatic;
        debug.note = "computed proxy from static tile energy density";
      }
      return rhoFromStatic;
    }
  }

  if (debug) {
    debug.source = "proxy-missing";
    debug.value = Number.NaN;
    debug.reason = "missing_proxy_rho_inputs";
  }
  return undefined;
}

function resolveQiCouplingDiagnostics(state: EnergyPipelineState): QiCouplingDiagnostics {
  const mode = resolveQiCouplingMode();
  const alpha = resolveQiCouplingAlpha();
  const metricDebug: EffectiveRhoDebug = {};
  const proxyDebug: EffectiveRhoDebug = {};
  const metricRho = resolveMetricRhoFromState(state, metricDebug, { allowConstraintFallback: false });
  const proxyRho = resolveQiProxyRhoFromState(state, proxyDebug);
  const metricFinite = Number.isFinite(metricRho as number);
  const proxyFinite = Number.isFinite(proxyRho as number);
  const comparable = metricFinite && proxyFinite;
  const coupled =
    mode === "shadow" && comparable
      ? alpha * Number(metricRho) + (1 - alpha) * Number(proxyRho)
      : undefined;
  const residualRel =
    comparable
      ? Math.abs(Number(metricRho) - Number(proxyRho)) /
        Math.max(Math.abs(Number(metricRho)), Math.abs(Number(proxyRho)), 1e-12)
      : undefined;

  return {
    mode,
    alpha,
    metricRho_Jm3: metricFinite ? Number(metricRho) : undefined,
    metricSource: metricDebug.source,
    proxyRho_Jm3: proxyFinite ? Number(proxyRho) : undefined,
    proxySource: proxyDebug.source,
    coupledRhoShadow_Jm3: Number.isFinite(coupled as number) ? Number(coupled) : undefined,
    residualRel: Number.isFinite(residualRel as number) ? Number(residualRel) : undefined,
    comparable,
    equationRef: "semiclassical_coupling+atomic_energy_to_energy_density_proxy",
    semantics: "diagnostic_only_no_gate_override",
  };
}

function resolveMetricRhoFromState(
  state: EnergyPipelineState,
  debug?: EffectiveRhoDebug,
  opts?: { allowConstraintFallback?: boolean },
): number | undefined {
  const allowConstraintFallback = opts?.allowConstraintFallback !== false;
  const warp = (state as any)?.warp;
  const warpMetricSource =
    warp?.metricT00Source ?? warp?.metricStressSource ?? warp?.stressEnergySource;
  const warpMetricT00 = firstFinite(
    warp?.metricT00,
    warp?.metricStressEnergy?.T00,
    warp?.metricStressDiagnostics?.rhoSiMean,
  );
  const warpMetricRef =
    typeof warp?.metricT00Ref === "string" && warp.metricT00Ref.length > 0
      ? String(warp.metricT00Ref)
      : "warp.metricT00";
  if (warpMetricSource === "metric" && warpMetricT00 !== undefined) {
    if (debug) {
      debug.source = warpMetricRef;
      debug.value = warpMetricT00;
      debug.note = "metric-derived";
    }
    return warpMetricT00;
  }

  const natario = (state as any)?.natario;
  const natarioMetricSource = natario?.metricT00Source ?? natario?.metricSource;
  const natarioMetricT00 = firstFinite(
    natario?.metricT00,
    natario?.stressEnergyTensor?.T00,
  );
  const natarioMetricRef =
    typeof natario?.metricT00Ref === "string" && natario.metricT00Ref.length > 0
      ? String(natario.metricT00Ref)
      : warp?.metricAdapter?.family === "nhm2_shift_lapse" ||
          warp?.requestedFieldType === "nhm2_shift_lapse" ||
          state?.warpFieldType === "nhm2_shift_lapse" ||
          state?.dynamicConfig?.warpFieldType === "nhm2_shift_lapse"
        ? "warp.metric.T00.nhm2.shift_lapse"
        : "warp.metric.T00.natario.shift";
  if (natarioMetricSource === "metric" && natarioMetricT00 !== undefined) {
    if (debug) {
      debug.source = natarioMetricRef;
      debug.value = natarioMetricT00;
      debug.note = "metric-derived (natario payload)";
    }
    return natarioMetricT00;
  }

  const vdbRegionII = (state as any)?.vdbRegionII;
  const vdbT00Geom = firstFinite(vdbRegionII?.t00_mean);
  if (hasVdbRegionIIMetricSupport(vdbRegionII) && vdbT00Geom !== undefined) {
    const rhoSi = vdbT00Geom * GEOM_TO_SI_STRESS;
    if (debug) {
      debug.source = "warp.metric.T00.vdb.regionII";
      debug.value = rhoSi;
      debug.note = "metric-derived (VdB region II, geometric -> SI)";
    }
    return rhoSi;
  }

  if (allowConstraintFallback) {
    const rhoConstraint = state.gr?.constraints?.rho_constraint?.mean;
    if (Number.isFinite(rhoConstraint as number)) {
      const rhoSi = Number(rhoConstraint) * GEOM_TO_SI_STRESS;
      if (debug) {
        debug.source = "gr.rho_constraint.mean";
        debug.value = rhoSi;
        debug.note = "constraint-derived (geometric -> SI)";
      }
      return rhoSi;
    }
  }

  return undefined;
}

type QiCurvatureInfo = {
  radius_m?: number;
  ratio?: number;
  ok?: boolean;
  source?: string;
  note?: string;
  scalar?: number;
  flatSpaceEquivalent?: boolean;
  signalState?: "available" | "missing";
  reasonCode?: "G4_QI_CURVATURE_WINDOW_FAIL" | "G4_QI_SIGNAL_MISSING";
};

function pickInvariantScalar(
  stats?: import("./gr-evolve-brick").GrInvariantStats,
): number | undefined {
  if (!stats) return undefined;
  const candidates = [stats.p98, stats.max, stats.mean]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value));
  if (candidates.length === 0) return undefined;
  const positive = candidates.find((value) => value > 0);
  if (positive !== undefined) return positive;
  return 0;
}

function resolveMetricStressCurvatureFallback(
  state: EnergyPipelineState,
): { scalar: number; source: string; note: string } | null {
  const warp = (state as any)?.warp;
  if (!warp || typeof warp !== "object") return null;
  const metricSource = String(
    (warp as any)?.metricT00Source ?? (warp as any)?.stressEnergySource ?? "",
  ).toLowerCase();
  if (metricSource !== "metric") return null;
  const diagnostics = (warp as any)?.metricStressDiagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return null;

  const kSquaredRaw = Number((diagnostics as any)?.kSquaredMean);
  const kTraceRaw = Number((diagnostics as any)?.kTraceMean);
  const kSquaredAbs = Number.isFinite(kSquaredRaw) ? Math.max(0, Math.abs(kSquaredRaw)) : null;
  const kTraceAbs = Number.isFinite(kTraceRaw) ? Math.abs(kTraceRaw) : null;
  if (kSquaredAbs == null && kTraceAbs == null) return null;

  const scalarFromKSquared =
    kSquaredAbs != null ? Math.pow(kSquaredAbs, 2) : Number.NaN;
  const scalarFromKTrace =
    kTraceAbs != null ? Math.pow(kTraceAbs, 4) : Number.NaN;
  const scalar = Math.max(
    Number.isFinite(scalarFromKSquared) ? scalarFromKSquared : 0,
    Number.isFinite(scalarFromKTrace) ? scalarFromKTrace : 0,
  );
  if (!Number.isFinite(scalar)) return null;

  const source =
    Number.isFinite(scalarFromKSquared) &&
    scalarFromKSquared >=
      (Number.isFinite(scalarFromKTrace) ? scalarFromKTrace : -Infinity)
      ? "warp.metricStressDiagnostics.kSquaredMean^2"
      : "warp.metricStressDiagnostics.kTraceMean^4";

  return {
    scalar,
    source,
    note: "curvature proxy from metric stress diagnostics",
  };
}

function resolveQiCurvature(
  state: EnergyPipelineState,
  tau_ms: number,
): QiCurvatureInfo {
  const invariants = state.gr?.invariants;
  const fallback = resolveMetricStressCurvatureFallback(state);
  const kretschmann = invariants
    ? pickInvariantScalar(invariants.kretschmann)
    : null;
  const ricci4 = invariants ? pickInvariantScalar(invariants.ricci4) : null;
  const scalar = kretschmann ?? ricci4 ?? fallback?.scalar;
  const source = kretschmann != null
    ? "gr.invariants.kretschmann"
    : ricci4 != null
      ? "gr.invariants.ricci4"
      : fallback?.source;
  const fallbackSourceUsed = fallback != null && source === fallback.source;

  if (scalar == null) {
    return {
      source,
      signalState: "missing",
      reasonCode: "G4_QI_SIGNAL_MISSING",
      note: "missing curvature invariants",
    };
  }
  if (scalar === 0) {
    return {
      source,
      scalar,
      ratio: 0,
      ok: true,
      flatSpaceEquivalent: true,
      signalState: "available",
      note: fallbackSourceUsed ? fallback.note : "zero curvature scalar",
    };
  }
  if (!(scalar > 0)) {
    return {
      source,
      scalar,
      signalState: "available",
      reasonCode: "G4_QI_CURVATURE_WINDOW_FAIL",
      note: "non-positive curvature scalar",
    };
  }

  const radius_m = Math.pow(1 / scalar, 0.25);
  if (!Number.isFinite(radius_m) || radius_m <= 0) {
    return { source, scalar, signalState: "available", reasonCode: "G4_QI_CURVATURE_WINDOW_FAIL", note: "non-finite curvature radius" };
  }

  const tau_s = Math.max(0, tau_ms) / 1000;
  const tau_m = C * tau_s;
  const ratio = tau_m / radius_m;
  if (!Number.isFinite(ratio)) {
    return { source, scalar, radius_m, ratio, signalState: "available", reasonCode: "G4_QI_CURVATURE_WINDOW_FAIL", note: "non-finite curvature ratio" };
  }
  const ok = ratio <= DEFAULT_QI_CURVATURE_RATIO_MAX;

  return {
    radius_m,
    ratio,
    ok,
    source,
    scalar,
    signalState: "available",
    ...(fallbackSourceUsed ? { note: fallback?.note } : {}),
    ...(ok ? {} : { reasonCode: "G4_QI_CURVATURE_WINDOW_FAIL" as const }),
  };
}

function estimateEffectiveRhoFromState(state: EnergyPipelineState, debug?: EffectiveRhoDebug): number {
  const metricRho = resolveMetricRhoFromState(state, debug);
  if (Number.isFinite(metricRho as number)) {
    return Number(metricRho);
  }
  if (strictCongruenceEnabled()) {
    if (debug) {
      debug.source = "metric-missing";
      debug.value = Number.NaN;
      debug.reason = "strict_metric_required";
      debug.note = "WARP_STRICT_CONGRUENCE=1 disables proxy rho fallbacks";
    }
    return Number.NaN;
  }

  const nowMs = Date.now();
  const tilesTelemetry = getLatestQiTileStats();
  if (
    tilesTelemetry?.avgNeg != null &&
    tilesTelemetry.source != null &&
    tilesTelemetry.source !== "synthetic"
  ) {
    const scale = resolveTileTelemetryScale();
    const scaled = tilesTelemetry.avgNeg * scale;
    if (debug) {
      debug.source = "tile-telemetry";
      debug.value = scaled;
      debug.note = scale !== 1 ? `${tilesTelemetry.source} (scale ${scale})` : tilesTelemetry.source;
    }
    return scaled;
  }
  const pulses = state.gateAnalytics?.pulses;

  if (Array.isArray(pulses) && pulses.length) {
    let accum = 0;
    for (const pulse of pulses) {
      accum += rhoFromPulse(nowMs, pulse);
    }
    if (Number.isFinite(accum)) {
      if (debug) {
        debug.source = "gate-pulses";
        debug.value = accum;
        debug.note = `${pulses.length} pulse(s)`;
      }
      return accum;
    }
  }

  if (lastPumpCommandSnapshot?.tones?.length) {
    const val = rhoFromTones(
      nowMs,
      lastPumpCommandSnapshot.tones,
      lastPumpCommandSnapshot.rho0 ?? 0,
      lastPumpCommandSnapshot.epoch_ms,
    );
    if (debug) {
      debug.source = "pump-tones";
      debug.value = val;
      debug.note = `${lastPumpCommandSnapshot.tones.length} tone(s)`;
    }
    return val;
  }

  const effDuty =
    Number((state as any).dutyEffectiveFR ?? state.dutyEffective_FR ?? state.dutyCycle ?? 0);
  if (!Number.isFinite(effDuty) || effDuty <= 0) {
    if (debug) {
      debug.source = "duty-fallback";
      debug.value = 0;
      debug.reason = !Number.isFinite(effDuty) ? "non-finite duty" : "duty <= 0";
    }
    return 0;
  }
  if (debug) {
    debug.source = "duty-fallback";
    debug.value = -Math.abs(effDuty);
    debug.note = "using dutyEffectiveFR/dutyCycle";
  }
  return -Math.abs(effDuty);
}

function rhoFromPulse(nowMs: number, pulse: GatePulse | undefined): number {
  if (!pulse) return 0;
  if (Array.isArray(pulse.tones) && pulse.tones.length) {
    const baseRho = Number.isFinite(pulse.rho) ? Number(pulse.rho) : 0;
    return rhoFromTones(nowMs, pulse.tones, baseRho);
  }
  return Number.isFinite(pulse.rho) ? Number(pulse.rho) : 0;
}

function rhoFromTones(
  nowMs: number,
  tones: PumpTone[],
  rho0: number,
  epochOverride?: number,
): number {
  if (!Array.isArray(tones) || tones.length === 0) {
    return Number.isFinite(rho0) ? Number(rho0) : 0;
  }
  const epoch = Number.isFinite(epochOverride) ? Number(epochOverride) : GLOBAL_PUMP_EPOCH_MS;
  const t_s = (nowMs - epoch) / 1000;
  let acc = Number.isFinite(rho0) ? Number(rho0) : 0;
  for (const tone of tones) {
    if (!tone) continue;
    const freqHz = Number(tone.omega_hz);
    const depth = Number(tone.depth ?? 0);
    if (!Number.isFinite(freqHz) || !Number.isFinite(depth) || depth === 0) continue;
    const phaseDeg = Number.isFinite(tone.phase_deg) ? Number(tone.phase_deg) : 0;
    const phaseRad = (phaseDeg * Math.PI) / 180;
    const theta = 2 * Math.PI * freqHz * t_s + phaseRad;
    acc += depth * Math.cos(theta);
  }
  return acc;
}

function resolvePulseRole(
  pulse: GatePulse | undefined,
  schedule?: PhaseSchedule | null,
): "neg" | "pos" | null {
  if (!pulse) return null;
  const explicit = (pulse as any).role;
  if (explicit === "neg" || explicit === "pos") return explicit;
  if (Array.isArray(pulse.tags)) {
    for (const tag of pulse.tags) {
      const t = typeof tag === "string" ? tag.toLowerCase() : "";
      if (t.includes("neg")) return "neg";
      if (t.includes("pos")) return "pos";
    }
  }
  const sector = Number((pulse as any).sectorIndex);
  if (Number.isInteger(sector) && schedule) {
    if (Array.isArray(schedule.negSectors) && schedule.negSectors.includes(sector)) return "neg";
    if (Array.isArray(schedule.posSectors) && schedule.posSectors.includes(sector)) return "pos";
  }
  return null;
}

function pulseDurationMs(
  state: EnergyPipelineState,
  pulse: GatePulse | undefined,
  sectorPeriod_ms: number,
  dutyFallback?: number,
): number {
  const durNs = Number((pulse as any)?.dur_ns);
  if (Number.isFinite(durNs) && durNs > 0) {
    return durNs / 1e6;
  }
  const tauPulse_ms = Number(
    (state.clocking as any)?.tauPulse_ms ??
      (state.lightCrossing as any)?.burst_ms ??
      (state as any)?.burst_ms ??
      (state as any)?.lightCrossing?.burst_ms,
  );
  if (Number.isFinite(tauPulse_ms) && tauPulse_ms > 0) {
    return tauPulse_ms;
  }
  const duty =
    Number.isFinite(dutyFallback) && dutyFallback != null
      ? Number(dutyFallback)
      : Number.isFinite(state.dutyBurst)
      ? Number(state.dutyBurst)
      : Number(state.dutyCycle);
  if (Number.isFinite(duty) && duty > 0 && sectorPeriod_ms > 0) {
    return sectorPeriod_ms * Math.min(1, Math.max(0, duty));
  }
  const sectors = Math.max(1, Math.floor(state.sectorCount ?? DEFAULT_SECTORS_TOTAL));
  return sectorPeriod_ms > 0 ? Math.max(1e-3, sectorPeriod_ms / sectors) : 1;
}

function computeQuantumInterestBook(state: EnergyPipelineState): QuantumInterestBook | null {
  const pulses = state.gateAnalytics?.pulses;
  if (!Array.isArray(pulses) || pulses.length === 0) return null;
  const guard = (state as any).qiGuardrail ?? {};
  const nowMs = Date.now();
  const tau_ms = Number.isFinite(state.qi?.tau_s_ms)
    ? Number(state.qi?.tau_s_ms)
    : Number(guard.window_ms) || DEFAULT_QI_TAU_MS;
  const sectorPeriod_ms = clampNumber(
    Number(state.sectorPeriod_ms ?? guard.sectorPeriod_ms ?? DEFAULT_SECTOR_PERIOD_MS),
    0.1,
    10_000,
  );
  const guardWindow = Number(guard.window_ms);
  const baseWindow =
    Number.isFinite(guardWindow) && guardWindow > 0 ? guardWindow : tau_ms * DEFAULT_QI_INTEREST_WINDOW_MULT;
  const window_ms = Math.max(baseWindow, tau_ms * DEFAULT_QI_INTEREST_WINDOW_MULT, sectorPeriod_ms * 2);
  const schedule = (state.phaseSchedule as PhaseSchedule | undefined) ?? null;
  let neg = 0;
  let pos = 0;

  for (const pulse of pulses) {
    const role = resolvePulseRole(pulse, schedule);
    if (role !== "neg" && role !== "pos") continue;
    const rho = Math.abs(rhoFromPulse(nowMs, pulse));
    if (!Number.isFinite(rho) || rho <= 0) continue;
    const dur_ms = pulseDurationMs(state, pulse, sectorPeriod_ms, guard.patternDuty ?? guard.duty);
    const weight = Math.min(1, Math.max(0, dur_ms) / Math.max(window_ms, 1e-3));
    const contribution = rho * weight;
    if (role === "neg") neg += contribution;
    else pos += contribution;
  }

  if (!(neg > 0 || pos > 0)) return null;

  const rate = Math.max(0, DEFAULT_QI_INTEREST_RATE);
  const debt = neg * (1 + rate);
  const credit = pos;
  const margin = credit - debt;
  const netCycle = credit - neg;

  const book: QuantumInterestBook = {
    neg_Jm3: neg,
    pos_Jm3: pos,
    debt_Jm3: debt,
    credit_Jm3: credit,
    margin_Jm3: margin,
    netCycle_Jm3: netCycle,
    window_ms,
    rate,
  };

  return book;
}

type QiGuardPattern = {
  key: string;
  mask: Float64Array;
  window: Float64Array;
  dt_s: number;
  duty: number;
  window_ms: number;
};

const qiGuardPatternCache = new Map<string, QiGuardPattern>();

function guardPatternKey(params: {
  sectorCount: number;
  concurrentSectors: number;
  sectorPeriod_ms: number;
  tau_ms: number;
  sampler: SamplingKind;
  negSectors: number[];
}): string {
  return [
    params.sectorCount,
    params.concurrentSectors,
    params.sectorPeriod_ms.toFixed(6),
    params.tau_ms.toFixed(6),
    params.sampler,
    params.negSectors.join(","),
  ].join("|");
}

function buildQiGuardPattern(params: {
  sectorCount: number;
  concurrentSectors: number;
  sectorPeriod_ms: number;
  tau_ms: number;
  sampler: SamplingKind;
  negSectors: number[];
}): QiGuardPattern {
  const key = guardPatternKey(params);
  const cached = qiGuardPatternCache.get(key);
  if (cached) return cached;

  const cycleSamples = Math.max(1, Math.floor(params.sectorCount));
  const dt_s = Math.max(params.sectorPeriod_ms, 1e-3) / cycleSamples / 1000;
  const repeats = Math.max(
    1,
    Math.ceil((8 * Math.max(params.tau_ms, 1e-3)) / Math.max(params.sectorPeriod_ms, 1e-3)),
  );
  const totalSamples = cycleSamples * repeats;
  const mask = new Float64Array(totalSamples);
  const negSet = new Set(params.negSectors ?? []);
  const activeWeight = Math.max(1, Math.floor(params.concurrentSectors) || 1);
  for (let r = 0; r < repeats; r += 1) {
    const offset = r * cycleSamples;
    for (const idx of negSet) {
      const j = (idx % cycleSamples) + offset;
      mask[j] = activeWeight;
    }
  }
  let sum = 0;
  for (const v of mask) sum += v;
  const duty = sum / Math.max(totalSamples, 1);
  const window = buildWindow(
    totalSamples,
    dt_s,
    Math.max(params.tau_ms, 1e-3) / 1000,
    params.sampler,
  );
  const pattern: QiGuardPattern = {
    key,
    mask,
    window,
    dt_s,
    duty,
    window_ms: totalSamples * dt_s * 1000,
  };
  qiGuardPatternCache.set(key, pattern);
  return pattern;
}

function clampNegativeBound(value: number, fallback?: number): number {
  const envFloorAbs = Number(process.env.QI_BOUND_FLOOR_ABS);
  const floorAbs = Number.isFinite(envFloorAbs)
    ? Math.max(Math.abs(envFloorAbs as number), 1e-12)
    : 1e-12;
  const fbMag = Number.isFinite(fallback) ? Math.max(Math.abs(fallback as number), floorAbs) : floorAbs;
  if (!Number.isFinite(value)) return -fbMag;
  const mag = Math.max(Math.abs(value) || 0, floorAbs, fbMag);
  return -mag;
}

function rhoSourceIsDutyFallback(rhoDebug: EffectiveRhoDebug): boolean {
  const src = (rhoDebug.source ?? "").toLowerCase();
  return src === "duty-fallback" || src === "duty" || src === "schedule";
}

function rhoSourceIsMetric(rhoDebug: EffectiveRhoDebug): boolean {
  const src = (rhoDebug.source ?? "").toLowerCase();
  return (
    src.startsWith("warp.metric") ||
    src.startsWith("gr.rho_constraint") ||
    src.startsWith("gr.metric")
  );
}

export type QiQuantitySemanticType =
  | "ren_expectation_timelike_energy_density"
  | "classical_proxy_from_curvature"
  | "model_energy_density_casimir_like"
  | "effective_energy_density_sec"
  | "null_contracted_average"
  | "unknown_representation";

export type QiWorldlineClass = "timelike" | "null_like" | "unknown";
export type QiSemanticBridgeMode = "strict_evidence_gated";

function resolveQiWorldlineClass(observer: unknown, rhoSource?: string): QiWorldlineClass {
  const observerText = String(observer ?? "").toLowerCase();
  const sourceText = String(rhoSource ?? "").toLowerCase();
  if (observerText.includes("null") || sourceText.includes("null")) return "null_like";
  if (
    observerText.includes("timelike") ||
    observerText.includes("eulerian") ||
    observerText.includes("comoving") ||
    observerText.includes("normal")
  ) {
    return "timelike";
  }
  return "unknown";
}

function resolveQiQuantitySemanticType(args: {
  rhoSource?: string;
  couplingSemantics?: string;
  worldlineClass: QiWorldlineClass;
}): QiQuantitySemanticType {
  const sourceText = String(args.rhoSource ?? "").toLowerCase();
  const semanticsText = String(args.couplingSemantics ?? "").toLowerCase();
  if (args.worldlineClass === "null_like" || sourceText.includes("null")) {
    return "null_contracted_average";
  }
  if (semanticsText.includes("effective energy density") || sourceText.startsWith("gr.rho_constraint")) {
    return "effective_energy_density_sec";
  }
  if (
    sourceText.includes("casimir") ||
    sourceText.includes("tile") ||
    sourceText.includes("telemetry")
  ) {
    return "model_energy_density_casimir_like";
  }
  if (sourceText.startsWith("warp.metric") || sourceText.startsWith("gr.metric")) {
    return "classical_proxy_from_curvature";
  }
  return "unknown_representation";
}

function normalizeLower(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}

function resolveQiCouplingSemantics(args: {
  couplingComparable: boolean;
  metricContractOk: boolean;
  qeiStateClass?: string | null;
  qeiRenormalizationScheme?: string | null;
  qeiSamplingNormalization?: string | null;
  qeiOperatorMapping?: string | null;
}): QiCouplingSemantics {
  const stateClass = normalizeLower(args.qeiStateClass);
  const renormScheme = normalizeLower(args.qeiRenormalizationScheme);
  const samplingNorm = normalizeLower(args.qeiSamplingNormalization);
  const operatorMapping = normalizeLower(args.qeiOperatorMapping);
  const bridgeEvidenceReady =
    args.couplingComparable &&
    args.metricContractOk &&
    stateClass === "hadamard" &&
    renormScheme === "point_splitting" &&
    samplingNorm === "unit_integral" &&
    operatorMapping === "t_munu_uu_ren";
  return bridgeEvidenceReady
    ? "bridge_ready_evidence_no_gate_override"
    : "diagnostic_only_no_gate_override";
}

function resolveQeiSemanticDefault(args: {
  explicitValue?: unknown;
  envVarName: string;
  fallback: string;
}): string | null {
  const explicit = normalizeLower(args.explicitValue);
  if (explicit) return explicit;
  const envValue = normalizeLower(process.env[args.envVarName]);
  if (envValue) return envValue;
  return normalizeLower(args.fallback);
}

function resolveQiSemanticBridge(args: {
  worldlineClass: QiWorldlineClass;
  rhoSource?: string;
  metricContractOk: boolean;
  applicabilityStatus?: "PASS" | "FAIL" | "NOT_APPLICABLE" | "UNKNOWN";
  couplingSemantics?: string;
  qeiStateClass?: string | null;
  qeiRenormalizationScheme?: string | null;
  qeiSamplingNormalization?: string | null;
  qeiOperatorMapping?: string | null;
}): {
  mode: QiSemanticBridgeMode;
  ready: boolean;
  missing: string[];
} {
  const mode: QiSemanticBridgeMode = "strict_evidence_gated";
  const missing: string[] = [];
  const sourceText = String(args.rhoSource ?? "").toLowerCase();
  const couplingText = String(args.couplingSemantics ?? "").toLowerCase();
  const stateClass = normalizeLower(args.qeiStateClass);
  const renormScheme = normalizeLower(args.qeiRenormalizationScheme);
  const samplingNorm = normalizeLower(args.qeiSamplingNormalization);
  const operatorMapping = normalizeLower(args.qeiOperatorMapping);

  if (args.worldlineClass !== "timelike") missing.push("worldline_not_timelike");
  if (!sourceText.startsWith("warp.metric") && !sourceText.startsWith("gr.metric")) {
    missing.push("source_not_metric");
  }
  if (!args.metricContractOk) missing.push("metric_contract_not_ok");
  if (String(args.applicabilityStatus ?? "UNKNOWN").toUpperCase() !== "PASS") {
    missing.push("applicability_not_pass");
  }
  if (couplingText.includes("diagnostic_only")) missing.push("coupling_semantics_diagnostic_only");
  if (stateClass !== "hadamard") missing.push("qei_state_class_not_hadamard");
  if (renormScheme !== "point_splitting") missing.push("qei_renormalization_not_point_splitting");
  if (samplingNorm !== "unit_integral") missing.push("qei_sampling_normalization_not_unit_integral");
  if (operatorMapping !== "t_munu_uu_ren") missing.push("qei_operator_mapping_not_t_munu_uu_ren");

  return {
    mode,
    ready: missing.length === 0,
    missing,
  };
}

type QiStatusInput = {
  zetaRaw?: number;
  zetaClamped?: number;
  pAvg?: number;
  pWarn?: number;
  mode?: string;
};

type QiStatusColor = 'red' | 'amber' | 'green' | 'muted';
type QiTauSource = 'configured' | 'window' | 'pulse' | 'light_crossing';
type QiTauSelectorPolicy = QiTauSource | 'min_available' | 'max_available';

const QI_TAU_SELECTOR_POLICIES = new Set<QiTauSelectorPolicy>([
  'configured',
  'window',
  'pulse',
  'light_crossing',
  'min_available',
  'max_available',
]);

const toPositiveSeconds = (value: unknown, scale = 1): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (n * scale) > 0 ? (n * scale) : null;
};

const resolveQiTauSelectorPolicy = (state: EnergyPipelineState): QiTauSelectorPolicy => {
  const fromState = String((state as any)?.qi?.tauSelector ?? '').trim().toLowerCase();
  const fromEnv = String(process.env.QI_TAU_SELECTOR ?? '').trim().toLowerCase();
  const raw = fromState || fromEnv || 'configured';
  return QI_TAU_SELECTOR_POLICIES.has(raw as QiTauSelectorPolicy)
    ? (raw as QiTauSelectorPolicy)
    : 'configured';
};

const resolveQiTauPulseSeconds = (state: EnergyPipelineState): number | null => {
  const fromClockingMs = toPositiveSeconds((state as any)?.clocking?.tauPulse_ms, 1 / 1000);
  if (fromClockingMs != null) return fromClockingMs;
  const fromLightCrossingMs = toPositiveSeconds((state as any)?.lightCrossing?.burst_ms, 1 / 1000);
  if (fromLightCrossingMs != null) return fromLightCrossingMs;
  const fromStateNs = toPositiveSeconds((state as any)?.tauPulse_ns, 1 / 1e9);
  if (fromStateNs != null) return fromStateNs;
  const fromTsNs = toPositiveSeconds((state as any)?.ts?.tauPulse_ns, 1 / 1e9);
  if (fromTsNs != null) return fromTsNs;
  return null;
};

const resolveQiTauLightCrossingSeconds = (state: EnergyPipelineState): number | null => {
  const fromClockingMs = toPositiveSeconds((state as any)?.clocking?.tauLC_ms, 1 / 1000);
  if (fromClockingMs != null) return fromClockingMs;
  const fromStateMs = toPositiveSeconds((state as any)?.tauLC_ms, 1 / 1000);
  if (fromStateMs != null) return fromStateMs;
  const fromTsMs = toPositiveSeconds((state as any)?.ts?.tauLC_ms, 1 / 1000);
  if (fromTsMs != null) return fromTsMs;
  const fromLightCrossingMs = toPositiveSeconds((state as any)?.lightCrossing?.tauLC_ms, 1 / 1000);
  if (fromLightCrossingMs != null) return fromLightCrossingMs;
  return null;
};

export function deriveQiStatus(
  input: QiStatusInput,
): {
  zetaForStatus: number | null;
  compliance: boolean;
  overallStatus: 'NOMINAL' | 'WARNING' | 'CRITICAL';
  color: QiStatusColor;
} {
  const raw = Number(input.zetaRaw);
  const clamped = Number(input.zetaClamped);
  const hasRaw = Number.isFinite(raw);
  const hasClamped = Number.isFinite(clamped);
  const zetaForStatus = hasRaw ? raw : hasClamped ? clamped : null;

  let color: QiStatusColor = 'muted';
  if (zetaForStatus != null) {
    color = zetaForStatus >= 1
      ? 'red'
      : zetaForStatus >= 0.95
      ? 'amber'
      : 'green';
  }

  const compliance = Number.isFinite(zetaForStatus) && (zetaForStatus as number) < 1;
  const guardFail = !compliance || (zetaForStatus != null && (zetaForStatus as number) >= 1);
  const warnByZeta = Number.isFinite(zetaForStatus) && (zetaForStatus as number) >= 0.95;
  const warnByPower =
    (input.mode ?? "hover") !== "emergency" &&
    Number.isFinite(input.pWarn) &&
    Number.isFinite(input.pAvg) &&
    (input.pAvg as number) > (input.pWarn as number);

  let overallStatus: 'NOMINAL' | 'WARNING' | 'CRITICAL';
  if (guardFail) {
    overallStatus = 'CRITICAL';
  } else if (warnByZeta || warnByPower) {
    overallStatus = 'WARNING';
  } else {
    overallStatus = 'NOMINAL';
  }

  return { zetaForStatus, compliance, overallStatus, color };
}

export function evaluateQiGuardrail(
  state: EnergyPipelineState,
  opts: {
    schedule?: PhaseSchedule;
    sectorPeriod_ms?: number;
    sampler?: SamplingKind;
    tau_ms?: number;
    qiPolicyMaxZeta?: number;
  } = {},
): {
  lhs_Jm3: number;
  bound_Jm3: number;
  boundComputed_Jm3: number;
  boundFloor_Jm3: number | null;
  boundPolicyFloor_Jm3: number | null;
  boundEnvFloor_Jm3: number | null;
  boundDefaultFloor_Jm3: number;
  boundFallbackAbs_Jm3: number;
  boundUsed_Jm3: number;
  boundFloorApplied: boolean;
  marginRatio: number;
  marginRatioRaw: number;
  marginRatioRawComputed: number;
  uncertaintySigma_Jm3: number | null;
  uncertaintySigmaMeasurement_Jm3: number | null;
  uncertaintySigmaModel_Jm3: number | null;
  uncertaintySigmaBridge_Jm3: number | null;
  uncertaintySigmaTau_Jm3: number | null;
  uncertaintyModelSigmaConfigured_Jm3: number | null;
  uncertaintyModelSigmaSource: string;
  uncertaintyModelSigmaRationale: string;
  uncertaintyModelSigmaRequired: boolean;
  uncertaintyModelSigmaProvenanceReady: boolean;
  uncertaintyModelSigmaProvenanceMissing: string[];
  uncertaintyDominantComponent: "measurement" | "model" | "bridge" | "tau" | "none";
  uncertaintyBandKSigma: number;
  uncertaintySlackPolicy_Jm3: number | null;
  uncertaintySlackComputed_Jm3: number | null;
  uncertaintyBandLowerPolicy_Jm3: number | null;
  uncertaintyBandUpperPolicy_Jm3: number | null;
  uncertaintyBandLowerComputed_Jm3: number | null;
  uncertaintyBandUpperComputed_Jm3: number | null;
  uncertaintyDecisionClass: "robust_pass" | "indeterminate" | "robust_fail";
  uncertaintyCouldFlip: boolean;
  uncertaintyInputsMissing: string[];
  g4FloorDominated: boolean;
  g4PolicyExceeded: boolean;
  g4ComputedExceeded: boolean;
  g4DualFailMode: 'policy_only' | 'computed_only' | 'both' | 'neither';
  policyLimit?: number;
  window_ms: number;
  sampler: SamplingKind;
  fieldType: string;
  samples: number;
  duty: number;
  patternDuty: number;
  maskSum: number;
  effectiveRho: number;
  rhoOn: number;
  rhoSource?: string;
  rhoNote?: string;
  sumWindowDt: number;
  rhoOnDuty?: number;
  curvatureRadius_m?: number;
  curvatureRatio?: number;
  curvatureScalar?: number;
  curvatureFlatSpaceEquivalent?: boolean;
  curvatureOk?: boolean;
  curvatureSource?: string;
  curvatureNote?: string;
  curvatureEnforced?: boolean;
  applicabilityStatus?: "PASS" | "FAIL" | "NOT_APPLICABLE" | "UNKNOWN";
  applicabilityReasonCode?: "G4_QI_CURVATURE_WINDOW_FAIL" | "G4_QI_SIGNAL_MISSING";
  K: number | null;
  KNullReason?: string;
  safetySigma_Jm3: number | null;
  safetySigmaNullReason?: string;
  strictMode?: boolean;
  metricContractOk?: boolean;
  metricDerived?: boolean;
  metricDerivedSource?: string;
  metricDerivedReason?: string;
  metricDerivedChart?: string;
  couplingMode?: QiCouplingMode;
  couplingAlpha?: number;
  rhoMetric_Jm3?: number;
  rhoMetricSource?: string;
  rhoProxy_Jm3?: number;
  rhoProxySource?: string;
  rhoCoupledShadow_Jm3?: number;
  couplingResidualRel?: number;
  couplingComparable?: boolean;
  couplingEquationRef?: string;
  couplingSemantics?: string;
  quantitySemanticBaseType: QiQuantitySemanticType;
  quantitySemanticType: QiQuantitySemanticType;
  quantityWorldlineClass: QiWorldlineClass;
  quantitySemanticComparable: boolean;
  quantitySemanticReason: string;
  quantitySemanticTargetType: "ren_expectation_timelike_energy_density";
  quantitySemanticBridgeMode: QiSemanticBridgeMode;
  quantitySemanticBridgeReady: boolean;
  quantitySemanticBridgeMissing: string[];
  qeiStateClass?: string | null;
  qeiRenormalizationScheme?: string | null;
  qeiSamplingNormalization?: string | null;
  qeiOperatorMapping?: string | null;
  tau_s: number;
  tauConfigured_s: number;
  tauWindow_s: number | null;
  tauPulse_s: number | null;
  tauLC_s: number | null;
  tauSelected_s: number;
  tauSelectedSource: QiTauSource;
  tauSelectorPolicy: QiTauSelectorPolicy;
  tauSelectorFallbackApplied: boolean;
  tauProvenanceReady: boolean;
  tauProvenanceMissing: string[];
  congruentSolvePolicyMarginPass: boolean;
  congruentSolveComputedMarginPass: boolean;
  congruentSolveApplicabilityPass: boolean;
  congruentSolveMetricPass: boolean;
  congruentSolveSemanticPass: boolean;
  congruentSolvePass: boolean;
  congruentSolveFailReasons: string[];
} {
  const sampler = opts.sampler ?? state.phaseSchedule?.sampler ?? state.qi?.sampler ?? DEFAULT_QI_SETTINGS.sampler;
  const tau_ms =
    Number.isFinite(opts.tau_ms) && (opts.tau_ms as number) > 0
      ? (opts.tau_ms as number)
      : Number.isFinite(state.qi?.tau_s_ms)
      ? Number(state.qi?.tau_s_ms)
      : DEFAULT_QI_SETTINGS.tau_s_ms;
  const sectorPeriod_ms = clampNumber(
    Number(opts.sectorPeriod_ms ?? state.phaseSchedule?.sectorPeriod_ms ?? state.sectorPeriod_ms) ||
      DEFAULT_SECTOR_PERIOD_MS,
    0.1,
    10_000,
  );
  const sectorCount = Math.max(
    1,
    Math.floor(state.phaseSchedule?.phi_deg_by_sector?.length ?? state.sectorCount ?? DEFAULT_SECTORS_TOTAL),
  );
  const concurrentSectors = Math.max(
    1,
    Math.floor(state.concurrentSectors ?? state.sectorStrobing ?? 1),
  );
  const schedule =
    opts.schedule ??
    (state.phaseSchedule as PhaseSchedule | undefined) ??
    computeSectorPhaseOffsets({
      N: sectorCount,
      sectorPeriod_ms,
      phase01: 0,
      tau_s_ms: tau_ms,
      sampler,
      negativeFraction: state.negativeFraction ?? DEFAULT_NEGATIVE_FRACTION,
    });
  const negSectors = Array.isArray(schedule?.negSectors) ? schedule!.negSectors : [];
  const pattern = buildQiGuardPattern({
    sectorCount,
    concurrentSectors,
    sectorPeriod_ms,
    tau_ms,
    sampler,
    negSectors,
  });
  const patternDuty = pattern.duty;
  const maskSum = pattern.mask.reduce((acc, v) => acc + v, 0);
  const duty = patternDuty > 0 ? patternDuty : Math.max(negSectors.length / Math.max(sectorCount, 1), 1e-6);
  const tauConfigured_s = Math.max(1e-9, tau_ms / 1000);
  const tauWindow_s = toPositiveSeconds(pattern.window_ms, 1 / 1000);
  const tauPulse_s = resolveQiTauPulseSeconds(state);
  const tauLC_s = resolveQiTauLightCrossingSeconds(state);
  const tauSelectorPolicy = resolveQiTauSelectorPolicy(state);
  const tauCandidates: Record<QiTauSource, number | null> = {
    configured: tauConfigured_s,
    window: tauWindow_s,
    pulse: tauPulse_s,
    light_crossing: tauLC_s,
  };
  const availabilityBySource: Record<QiTauSource, boolean> = {
    configured: tauCandidates.configured != null,
    window: tauCandidates.window != null,
    pulse: tauCandidates.pulse != null,
    light_crossing: tauCandidates.light_crossing != null,
  };
  let tauSelectedSource: QiTauSource = 'configured';
  let tauSelectorFallbackApplied = false;
  if (tauSelectorPolicy === 'min_available' || tauSelectorPolicy === 'max_available') {
    const available = (Object.entries(tauCandidates) as Array<[QiTauSource, number | null]>)
      .filter(([, value]) => value != null) as Array<[QiTauSource, number]>;
    if (available.length > 0) {
      available.sort((a, b) => (tauSelectorPolicy === 'min_available' ? a[1] - b[1] : b[1] - a[1]) || a[0].localeCompare(b[0]));
      tauSelectedSource = available[0][0];
    } else {
      tauSelectorFallbackApplied = true;
    }
  } else if (availabilityBySource[tauSelectorPolicy]) {
    tauSelectedSource = tauSelectorPolicy;
  } else {
    tauSelectedSource = 'configured';
    tauSelectorFallbackApplied = tauSelectorPolicy !== 'configured';
  }
  const tauSelected_s = Math.max(1e-9, tauCandidates[tauSelectedSource] ?? tauConfigured_s);
  const tauProvenanceMissing: string[] = [];
  if (!availabilityBySource.window) tauProvenanceMissing.push('tau_window_unavailable');
  if (!availabilityBySource.pulse) tauProvenanceMissing.push('tau_pulse_unavailable');
  if (!availabilityBySource.light_crossing) tauProvenanceMissing.push('tau_light_crossing_unavailable');
  if (tauSelectorFallbackApplied) tauProvenanceMissing.push(`tau_selector_fallback:${tauSelectorPolicy}->${tauSelectedSource}`);
  const tauProvenanceReady = !tauSelectorFallbackApplied;
  const rhoDebug: EffectiveRhoDebug = {};
  const effectiveRho = estimateEffectiveRhoFromState(state, rhoDebug);
  const couplingDiagnostics = resolveQiCouplingDiagnostics(state);
  const metricRho = rhoSourceIsMetric(rhoDebug);
  const rhoOn = metricRho ? effectiveRho : duty > 0 ? effectiveRho / duty : effectiveRho;
  const curvatureInfo = resolveQiCurvature(state, tau_ms);
  const curvatureRatio = curvatureInfo.ratio;
  const curvatureOk = curvatureInfo.ok;
  const curvatureNote = curvatureInfo.note;
  const curvatureEnforced = QI_CURVATURE_ENFORCE;
  const applicabilityReasonCode = curvatureInfo.reasonCode;
  const applicabilityStatus: "PASS" | "FAIL" | "NOT_APPLICABLE" | "UNKNOWN" =
    curvatureInfo.signalState === "missing"
      ? "UNKNOWN"
      : curvatureOk === false
        ? "NOT_APPLICABLE"
        : curvatureOk === true
          ? "PASS"
          : "NOT_APPLICABLE";
  const dt_s = pattern.dt_s;
  const sumWindowDt = pattern.window.reduce((acc, v) => acc + v * dt_s, 0);
  let lhs = 0;
  let maskedSamplingWeight = 0;
  for (let i = 0; i < pattern.mask.length; i += 1) {
    const maskWeight = pattern.mask[i];
    const windowWeight = pattern.window[i] * dt_s;
    const rho = maskWeight ? rhoOn * maskWeight : 0;
    lhs += rho * windowWeight;
    maskedSamplingWeight += maskWeight * windowWeight;
  }
  if (
    DEBUG_PIPE &&
    (duty <= 0 || maskSum <= 0 || !Number.isFinite(effectiveRho) || effectiveRho === 0)
  ) {
    console.warn("[QI-guard][zero-input]", {
      duty,
      patternDuty,
      maskSum,
      effectiveRho,
      rhoSource: rhoDebug.source ?? "unknown",
      negSectors: negSectors.length,
    });
  }
  const fieldType = (state.qi as any)?.fieldType ?? DEFAULT_QI_FIELD;
  const boundResult = qiBound_Jm3({
    tau_s: tauSelected_s,
    fieldType,
    kernelType: sampler,
  });
  const boundComputed_Jm3 = boundResult.bound_Jm3 - Math.abs(boundResult.safetySigma_Jm3);
  const policyMaxZeta =
    Number.isFinite(opts.qiPolicyMaxZeta) && (opts.qiPolicyMaxZeta as number) > 0
      ? Math.max(1e-12, Number(opts.qiPolicyMaxZeta))
      : QI_POLICY_MAX_ZETA;
  const policyFloorAbs =
    QI_POLICY_ENFORCE && policyMaxZeta > 0 ? Math.abs(lhs) / policyMaxZeta : 0;
  const envFloorAbsRaw = Number(process.env.QI_BOUND_FLOOR_ABS);
  const envFloorAbs = Number.isFinite(envFloorAbsRaw)
    ? Math.abs(envFloorAbsRaw as number)
    : 0;
  const defaultFloorAbs = Math.abs(DEFAULT_QI_BOUND_SCALAR);
  const fallbackAbs = Math.max(
    defaultFloorAbs,
    envFloorAbs,
    policyFloorAbs,
    1e-12,
  );
  const boundPolicyFloor_Jm3 = policyFloorAbs > 0 ? -Math.abs(policyFloorAbs) : null;
  const boundEnvFloor_Jm3 = envFloorAbs > 0 ? -Math.abs(envFloorAbs) : null;
  const boundDefaultFloor_Jm3 = -defaultFloorAbs;
  const boundFloor_Jm3 = -fallbackAbs;
  const bound_Jm3 = clampNegativeBound(boundComputed_Jm3, -fallbackAbs);
  const boundFloorApplied = Number.isFinite(bound_Jm3) && Number.isFinite(boundComputed_Jm3) && bound_Jm3 !== boundComputed_Jm3;
  const rawRatio =
    bound_Jm3 < 0 && Number.isFinite(bound_Jm3) ? Math.abs(lhs) / Math.abs(bound_Jm3) : Infinity;
  const rawRatioComputed =
    boundComputed_Jm3 < 0 && Number.isFinite(boundComputed_Jm3)
      ? Math.abs(lhs) / Math.abs(boundComputed_Jm3)
      : Infinity;
  const uncertaintyInputsMissing: string[] = [];
  if (!Number.isFinite(boundResult.safetySigma_Jm3)) {
    uncertaintyInputsMissing.push("non_finite_safety_sigma");
  }
  const uncertaintyRequireModelSigma = (process.env.QI_UNCERTAINTY_REQUIRE_MODEL_SIGMA ?? "0") !== "0";
  const uncertaintyModelRaw = process.env.QI_UNCERTAINTY_SIGMA_MODEL_JM3;
  const uncertaintyModelParsed =
    typeof uncertaintyModelRaw === "string" && uncertaintyModelRaw.trim().length > 0
      ? Number(uncertaintyModelRaw)
      : null;
  const uncertaintyModelSigmaConfigured_Jm3 =
    uncertaintyModelParsed != null &&
    Number.isFinite(uncertaintyModelParsed) &&
    uncertaintyModelParsed >= 0
      ? uncertaintyModelParsed
      : null;
  const uncertaintyModelSigmaProvenanceReady = uncertaintyModelSigmaConfigured_Jm3 != null;
  const uncertaintyModelSigmaProvenanceMissing: string[] = [];
  if (!uncertaintyModelSigmaProvenanceReady) {
    uncertaintyModelSigmaProvenanceMissing.push(
      uncertaintyModelParsed == null ? "model_sigma_unconfigured" : "model_sigma_invalid",
    );
  }
  if (uncertaintyRequireModelSigma && !uncertaintyModelSigmaProvenanceReady) {
    uncertaintyModelSigmaProvenanceMissing.push("model_sigma_required_but_missing");
  }
  const uncertaintyModelSigmaSource =
    uncertaintyModelSigmaConfigured_Jm3 != null
      ? "env:QI_UNCERTAINTY_SIGMA_MODEL_JM3"
      : uncertaintyModelParsed == null
        ? "default_zero_unconfigured"
        : "invalid_env_value";
  const uncertaintyModelSigmaRationale =
    uncertaintyModelSigmaConfigured_Jm3 != null
      ? "configured_model_sigma_applied"
      : uncertaintyRequireModelSigma
        ? "model_sigma_required_but_missing"
        : "model_sigma_unconfigured_default_zero";
  const uncertaintySigmaModel_Jm3 =
    uncertaintyModelSigmaConfigured_Jm3 != null ? uncertaintyModelSigmaConfigured_Jm3 : 0;
  if (
    uncertaintyModelParsed != null &&
    (!Number.isFinite(uncertaintyModelParsed) || uncertaintyModelParsed < 0)
  ) {
    uncertaintyInputsMissing.push("invalid_model_sigma");
  }
  const couplingGapAbs =
    Number.isFinite(couplingDiagnostics.metricRho_Jm3) &&
    Number.isFinite(couplingDiagnostics.proxyRho_Jm3)
      ? Math.abs(Number(couplingDiagnostics.metricRho_Jm3) - Number(couplingDiagnostics.proxyRho_Jm3))
      : 0;
  const couplingGapWindowMappedAbs =
    Number.isFinite(couplingGapAbs) && Number.isFinite(maskedSamplingWeight)
      ? couplingGapAbs * Math.abs(maskedSamplingWeight)
      : Number.NaN;
  if (!(Number.isFinite(couplingDiagnostics.metricRho_Jm3) && Number.isFinite(couplingDiagnostics.proxyRho_Jm3))) {
    uncertaintyInputsMissing.push("coupling_channels_missing");
  }
  if (!Number.isFinite(maskedSamplingWeight)) {
    uncertaintyInputsMissing.push("coupling_window_weight_non_finite");
  }
  const uncertaintySigmaBridge_Jm3 = Number.isFinite(couplingGapWindowMappedAbs)
    ? couplingGapWindowMappedAbs
    : 0;
  const uncertaintyMeasurementRaw = process.env.QI_UNCERTAINTY_SIGMA_MEASUREMENT_JM3;
  const uncertaintyMeasurementParsed =
    typeof uncertaintyMeasurementRaw === "string" && uncertaintyMeasurementRaw.trim().length > 0
      ? Number(uncertaintyMeasurementRaw)
      : null;
  const uncertaintySigmaMeasurement_Jm3 =
    uncertaintyMeasurementParsed == null
      ? 0
      : Number.isFinite(uncertaintyMeasurementParsed) && uncertaintyMeasurementParsed >= 0
        ? uncertaintyMeasurementParsed
        : 0;
  if (
    uncertaintyMeasurementParsed != null &&
    (!Number.isFinite(uncertaintyMeasurementParsed) || uncertaintyMeasurementParsed < 0)
  ) {
    uncertaintyInputsMissing.push("invalid_measurement_sigma");
  }
  const boundConfiguredResult = qiBound_Jm3({
    tau_s: tauConfigured_s,
    fieldType,
    kernelType: sampler,
  });
  const boundConfiguredComputed_Jm3 = boundConfiguredResult.bound_Jm3 - Math.abs(boundConfiguredResult.safetySigma_Jm3);
  const tauSelectionDeltaAbs =
    Number.isFinite(boundComputed_Jm3) && Number.isFinite(boundConfiguredComputed_Jm3)
      ? Math.abs(boundComputed_Jm3 - boundConfiguredComputed_Jm3)
      : Number.NaN;
  const uncertaintySigmaTau_Jm3 = tauSelectorFallbackApplied
    ? Number.isFinite(tauSelectionDeltaAbs)
      ? tauSelectionDeltaAbs
      : 0
    : 0;
  if (tauSelectorFallbackApplied && !Number.isFinite(tauSelectionDeltaAbs)) {
    uncertaintyInputsMissing.push("tau_selection_delta_non_finite");
  }
  if (!Number.isFinite(lhs)) uncertaintyInputsMissing.push("non_finite_lhs");
  if (!Number.isFinite(bound_Jm3)) uncertaintyInputsMissing.push("non_finite_bound_used");
  if (!Number.isFinite(boundComputed_Jm3)) uncertaintyInputsMissing.push("non_finite_bound_computed");
  const uncertaintySigma_Jm3 = Math.max(
    uncertaintySigmaMeasurement_Jm3,
    uncertaintySigmaModel_Jm3,
    uncertaintySigmaBridge_Jm3,
    uncertaintySigmaTau_Jm3,
  );
  const uncertaintyDominantComponent: "measurement" | "model" | "bridge" | "tau" | "none" =
    uncertaintySigma_Jm3 <= 0
      ? "none"
      : uncertaintySigmaMeasurement_Jm3 >= uncertaintySigmaModel_Jm3 &&
          uncertaintySigmaMeasurement_Jm3 >= uncertaintySigmaBridge_Jm3 &&
          uncertaintySigmaMeasurement_Jm3 >= uncertaintySigmaTau_Jm3
        ? "measurement"
        : uncertaintySigmaModel_Jm3 >= uncertaintySigmaBridge_Jm3 &&
            uncertaintySigmaModel_Jm3 >= uncertaintySigmaTau_Jm3
          ? "model"
          : uncertaintySigmaBridge_Jm3 >= uncertaintySigmaTau_Jm3
            ? "bridge"
            : "tau";
  const uncertaintyBandKSigmaRaw = Number(process.env.QI_UNCERTAINTY_KSIGMA);
  const uncertaintyBandKSigma =
    Number.isFinite(uncertaintyBandKSigmaRaw) && uncertaintyBandKSigmaRaw > 0
      ? clampNumber(uncertaintyBandKSigmaRaw, 1, 10)
      : 3;
  const uncertaintySlackPolicy_Jm3 =
    Number.isFinite(lhs) && Number.isFinite(bound_Jm3) ? lhs - bound_Jm3 : Number.NaN;
  const uncertaintySlackComputed_Jm3 =
    Number.isFinite(lhs) && Number.isFinite(boundComputed_Jm3) ? lhs - boundComputed_Jm3 : Number.NaN;
  const uncertaintyBandLowerPolicy_Jm3 = Number.isFinite(uncertaintySlackPolicy_Jm3)
    ? uncertaintySlackPolicy_Jm3 - uncertaintyBandKSigma * uncertaintySigma_Jm3
    : Number.NaN;
  const uncertaintyBandUpperPolicy_Jm3 = Number.isFinite(uncertaintySlackPolicy_Jm3)
    ? uncertaintySlackPolicy_Jm3 + uncertaintyBandKSigma * uncertaintySigma_Jm3
    : Number.NaN;
  const uncertaintyBandLowerComputed_Jm3 = Number.isFinite(uncertaintySlackComputed_Jm3)
    ? uncertaintySlackComputed_Jm3 - uncertaintyBandKSigma * uncertaintySigma_Jm3
    : Number.NaN;
  const uncertaintyBandUpperComputed_Jm3 = Number.isFinite(uncertaintySlackComputed_Jm3)
    ? uncertaintySlackComputed_Jm3 + uncertaintyBandKSigma * uncertaintySigma_Jm3
    : Number.NaN;
  let uncertaintyDecisionClass: "robust_pass" | "indeterminate" | "robust_fail" =
    Number.isFinite(uncertaintyBandLowerPolicy_Jm3) && Number.isFinite(uncertaintyBandUpperPolicy_Jm3)
      ? uncertaintyBandLowerPolicy_Jm3 > 0
        ? "robust_pass"
        : uncertaintyBandUpperPolicy_Jm3 < 0
          ? "robust_fail"
          : "indeterminate"
      : "indeterminate";
  let uncertaintyCouldFlip = uncertaintyDecisionClass === "indeterminate";
  if (uncertaintyRequireModelSigma && !uncertaintyModelSigmaProvenanceReady) {
    uncertaintyDecisionClass = "indeterminate";
    uncertaintyCouldFlip = true;
    uncertaintyInputsMissing.push("model_sigma_provenance_missing");
  }
  if (
    !Number.isFinite(uncertaintyBandLowerPolicy_Jm3) ||
    !Number.isFinite(uncertaintyBandUpperPolicy_Jm3)
  ) {
    uncertaintyInputsMissing.push("uncertainty_band_non_finite");
  }
  const g4FloorDominated = boundFloorApplied && bound_Jm3 !== boundComputed_Jm3;
  const g4PolicyExceeded = rawRatio >= 1;
  const g4ComputedExceeded = rawRatioComputed >= 1;
  const g4DualFailMode: 'policy_only' | 'computed_only' | 'both' | 'neither' =
    g4PolicyExceeded && g4ComputedExceeded
      ? 'both'
      : g4PolicyExceeded
        ? 'policy_only'
        : g4ComputedExceeded
          ? 'computed_only'
          : 'neither';
  const marginRatio = QI_POLICY_ENFORCE ? Math.min(rawRatio, policyMaxZeta) : rawRatio;

  const rhoNote = [rhoDebug.note ?? rhoDebug.reason, curvatureNote].filter(Boolean).join("; ") || undefined;
  const timingMetricDerived = Boolean(
    state.ts?.metricDerived ?? state.clocking?.metricDerived ?? state.tsMetricDerived,
  );
  const timingMetricDerivedSource = String(
    state.ts?.metricDerivedSource ??
      state.clocking?.metricDerivedSource ??
      state.tsMetricDerivedSource ??
      "unknown",
  );
  const timingMetricDerivedReason = String(
    state.ts?.metricDerivedReason ??
      state.clocking?.metricDerivedReason ??
      state.tsMetricDerivedReason ??
      "metric-derivation-status unavailable",
  );
  const metricDerivedChart = String(
    state.ts?.metricDerivedChart ?? state.clocking?.metricDerivedChart ?? "unknown",
  );
  const metricDerived = metricRho && timingMetricDerived;
  const metricDerivedSource = metricDerived
    ? `${rhoDebug.source ?? "unknown"}+${timingMetricDerivedSource}`
    : metricRho
      ? rhoDebug.source ?? "unknown"
      : timingMetricDerivedSource;
  const metricDerivedReason = metricDerived
    ? "rho_source_metric;timing_metric"
    : metricRho
      ? "timing_non_metric"
      : timingMetricDerived
        ? "rho_source_non_metric"
        : `rho_source_non_metric;timing_non_metric;timing_reason=${timingMetricDerivedReason}`;
  const strictMode = strictCongruenceEnabled();
  const warpState = (state as any).warp as Record<string, unknown> | undefined;
  const natarioState = (state as any).natario as Record<string, unknown> | undefined;
  const metricContractStatus =
    (warpState as any)?.metricT00Contract?.status ??
    (warpState as any)?.metricT00ContractStatus ??
    (natarioState as any)?.metricT00ContractStatus;
  const metricChartContractStatus =
    (warpState as any)?.metricAdapter?.chart?.contractStatus ??
    (warpState as any)?.metricAdapter?.chart?.contract_status ??
    (natarioState as any)?.chartContractStatus;
  const metricChart =
    (warpState as any)?.metricAdapter?.chart?.label ??
    (natarioState as any)?.chartLabel;
  const metricObserver =
    (warpState as any)?.metricT00Contract?.observer ??
    (warpState as any)?.metricT00Observer ??
    (natarioState as any)?.metricT00Observer;
  const metricNormalization =
    (warpState as any)?.metricT00Contract?.normalization ??
    (warpState as any)?.metricT00Normalization ??
    (natarioState as any)?.metricT00Normalization;
  const metricUnitSystem =
    (warpState as any)?.metricT00Contract?.unitSystem ??
    (warpState as any)?.metricT00UnitSystem ??
    (natarioState as any)?.metricT00UnitSystem;
  const metricContractOk =
    metricContractStatus === "ok" &&
    metricChartContractStatus === "ok" &&
    typeof metricChart === "string" &&
    metricChart.length > 0 &&
    metricChart !== "unspecified" &&
    typeof metricObserver === "string" &&
    metricObserver.length > 0 &&
    typeof metricNormalization === "string" &&
    metricNormalization.length > 0 &&
    metricUnitSystem === "SI";

  const qeiStateClass = resolveQeiSemanticDefault({
    explicitValue: (state as any)?.qi?.qeiStateClass,
    envVarName: "QI_QEI_STATE_CLASS",
    fallback: "hadamard",
  });
  const qeiRenormalizationScheme = resolveQeiSemanticDefault({
    explicitValue: (state as any)?.qi?.qeiRenormalizationScheme,
    envVarName: "QI_QEI_RENORMALIZATION_SCHEME",
    fallback: "point_splitting",
  });
  const qeiSamplingNormalization = resolveQeiSemanticDefault({
    explicitValue: (state as any)?.qi?.qeiSamplingNormalization,
    envVarName: "QI_QEI_SAMPLING_NORMALIZATION",
    fallback: "unit_integral",
  });
  const qeiOperatorMapping = resolveQeiSemanticDefault({
    explicitValue: (state as any)?.qi?.qeiOperatorMapping,
    envVarName: "QI_QEI_OPERATOR_MAPPING",
    fallback: "t_munu_uu_ren",
  });
  const couplingSemantics = resolveQiCouplingSemantics({
    couplingComparable: couplingDiagnostics.comparable,
    metricContractOk,
    qeiStateClass,
    qeiRenormalizationScheme,
    qeiSamplingNormalization,
    qeiOperatorMapping,
  });
  const quantityWorldlineClass = resolveQiWorldlineClass(metricObserver, rhoDebug.source);
  const quantitySemanticBaseType = resolveQiQuantitySemanticType({
    rhoSource: rhoDebug.source,
    couplingSemantics,
    worldlineClass: quantityWorldlineClass,
  });
  const quantitySemanticBridge = resolveQiSemanticBridge({
    worldlineClass: quantityWorldlineClass,
    rhoSource: rhoDebug.source,
    metricContractOk,
    applicabilityStatus,
    couplingSemantics,
    qeiStateClass,
    qeiRenormalizationScheme,
    qeiSamplingNormalization,
    qeiOperatorMapping,
  });
  const quantitySemanticType: QiQuantitySemanticType = quantitySemanticBridge.ready
    ? "ren_expectation_timelike_energy_density"
    : quantitySemanticBaseType;
  const quantitySemanticComparable = quantitySemanticBridge.ready;
  const quantitySemanticReason = quantitySemanticComparable
    ? "semantic_parity_qei_timelike_ren"
    : `semantic_mismatch:${quantitySemanticBaseType}:${quantityWorldlineClass}`;
  const congruentSolvePolicyMarginPass = Number.isFinite(rawRatio) && rawRatio < 1;
  const congruentSolveComputedMarginPass =
    Number.isFinite(rawRatioComputed) && rawRatioComputed < 1;
  const congruentSolveApplicabilityPass = applicabilityStatus === "PASS";
  const congruentSolveMetricPass = metricContractOk && metricDerived;
  const congruentSolveSemanticPass = quantitySemanticComparable;
  const congruentSolveFailReasons: string[] = [];
  if (!congruentSolveApplicabilityPass) {
    congruentSolveFailReasons.push(
      `applicability_not_pass:${String(applicabilityStatus ?? "unknown").toLowerCase()}`,
    );
  }
  if (!congruentSolvePolicyMarginPass) {
    congruentSolveFailReasons.push("policy_margin_not_strict_lt_1");
  }
  if (!congruentSolveComputedMarginPass) {
    congruentSolveFailReasons.push("computed_margin_not_strict_lt_1");
  }
  if (!congruentSolveMetricPass) {
    congruentSolveFailReasons.push(metricContractOk ? "metric_not_derived" : "metric_contract_not_ok");
  }
  if (!congruentSolveSemanticPass) {
    congruentSolveFailReasons.push(`semantic_not_comparable:${quantitySemanticReason}`);
  }
  const congruentSolvePass =
    congruentSolvePolicyMarginPass &&
    congruentSolveComputedMarginPass &&
    congruentSolveApplicabilityPass &&
    congruentSolveMetricPass &&
    congruentSolveSemanticPass;

  return {
    lhs_Jm3: lhs,
    bound_Jm3,
    boundComputed_Jm3,
    boundFloor_Jm3,
    boundPolicyFloor_Jm3,
    boundEnvFloor_Jm3,
    boundDefaultFloor_Jm3,
    boundFallbackAbs_Jm3: fallbackAbs,
    boundUsed_Jm3: bound_Jm3,
    boundFloorApplied,
    marginRatio: Number.isFinite(marginRatio) ? marginRatio : Infinity,
    marginRatioRaw: Number.isFinite(rawRatio) ? rawRatio : Infinity,
    marginRatioRawComputed: Number.isFinite(rawRatioComputed) ? rawRatioComputed : Infinity,
    uncertaintySigma_Jm3: Number.isFinite(uncertaintySigma_Jm3) ? uncertaintySigma_Jm3 : null,
    uncertaintySigmaMeasurement_Jm3: Number.isFinite(uncertaintySigmaMeasurement_Jm3) ? uncertaintySigmaMeasurement_Jm3 : null,
    uncertaintySigmaModel_Jm3: Number.isFinite(uncertaintySigmaModel_Jm3) ? uncertaintySigmaModel_Jm3 : null,
    uncertaintySigmaBridge_Jm3: Number.isFinite(uncertaintySigmaBridge_Jm3) ? uncertaintySigmaBridge_Jm3 : null,
    uncertaintySigmaTau_Jm3: Number.isFinite(uncertaintySigmaTau_Jm3) ? uncertaintySigmaTau_Jm3 : null,
    uncertaintyModelSigmaConfigured_Jm3:
      Number.isFinite(uncertaintyModelSigmaConfigured_Jm3) ? uncertaintyModelSigmaConfigured_Jm3 : null,
    uncertaintyModelSigmaSource,
    uncertaintyModelSigmaRationale,
    uncertaintyModelSigmaRequired: uncertaintyRequireModelSigma,
    uncertaintyModelSigmaProvenanceReady,
    uncertaintyModelSigmaProvenanceMissing,
    uncertaintyDominantComponent,
    uncertaintyBandKSigma,
    uncertaintySlackPolicy_Jm3: Number.isFinite(uncertaintySlackPolicy_Jm3) ? uncertaintySlackPolicy_Jm3 : null,
    uncertaintySlackComputed_Jm3: Number.isFinite(uncertaintySlackComputed_Jm3) ? uncertaintySlackComputed_Jm3 : null,
    uncertaintyBandLowerPolicy_Jm3: Number.isFinite(uncertaintyBandLowerPolicy_Jm3) ? uncertaintyBandLowerPolicy_Jm3 : null,
    uncertaintyBandUpperPolicy_Jm3: Number.isFinite(uncertaintyBandUpperPolicy_Jm3) ? uncertaintyBandUpperPolicy_Jm3 : null,
    uncertaintyBandLowerComputed_Jm3: Number.isFinite(uncertaintyBandLowerComputed_Jm3) ? uncertaintyBandLowerComputed_Jm3 : null,
    uncertaintyBandUpperComputed_Jm3: Number.isFinite(uncertaintyBandUpperComputed_Jm3) ? uncertaintyBandUpperComputed_Jm3 : null,
    uncertaintyDecisionClass,
    uncertaintyCouldFlip,
    uncertaintyInputsMissing: Array.from(new Set(uncertaintyInputsMissing)),
    g4FloorDominated,
    g4PolicyExceeded,
    g4ComputedExceeded,
    g4DualFailMode,
    policyLimit: QI_POLICY_ENFORCE ? policyMaxZeta : undefined,
    window_ms: pattern.window_ms,
    sampler,
    fieldType: String(fieldType ?? "em"),
    samples: pattern.window.length,
    duty,
    patternDuty,
    maskSum,
    effectiveRho,
    rhoOn,
    rhoSource: rhoDebug.source,
    rhoNote,
    sumWindowDt,
    rhoOnDuty: rhoSourceIsDutyFallback(rhoDebug) ? rhoOn * duty : undefined,
    curvatureRadius_m: curvatureInfo.radius_m,
    curvatureRatio,
    curvatureScalar: curvatureInfo.scalar,
    curvatureFlatSpaceEquivalent: curvatureInfo.flatSpaceEquivalent === true,
    curvatureOk,
    curvatureSource: curvatureInfo.source,
    curvatureNote,
    curvatureEnforced,
    applicabilityStatus,
    applicabilityReasonCode,
    K: Number.isFinite(boundResult.K) ? boundResult.K : null,
    KNullReason: Number.isFinite(boundResult.K) ? undefined : 'non_finite_bound_K',
    safetySigma_Jm3: Number.isFinite(boundResult.safetySigma_Jm3) ? boundResult.safetySigma_Jm3 : null,
    safetySigmaNullReason: Number.isFinite(boundResult.safetySigma_Jm3)
      ? undefined
      : 'non_finite_safety_sigma',
    strictMode,
    metricContractOk,
    metricDerived,
    metricDerivedSource,
    metricDerivedReason,
    metricDerivedChart,
    couplingMode: couplingDiagnostics.mode,
    couplingAlpha: couplingDiagnostics.alpha,
    rhoMetric_Jm3: couplingDiagnostics.metricRho_Jm3,
    rhoMetricSource: couplingDiagnostics.metricSource,
    rhoProxy_Jm3: couplingDiagnostics.proxyRho_Jm3,
    rhoProxySource: couplingDiagnostics.proxySource,
    rhoCoupledShadow_Jm3: couplingDiagnostics.coupledRhoShadow_Jm3,
    couplingResidualRel: couplingDiagnostics.residualRel,
    couplingComparable: couplingDiagnostics.comparable,
    couplingEquationRef: couplingDiagnostics.equationRef,
    couplingSemantics,
    quantitySemanticBaseType,
    quantitySemanticType,
    quantityWorldlineClass,
    quantitySemanticComparable,
    quantitySemanticReason,
    quantitySemanticTargetType: "ren_expectation_timelike_energy_density",
    quantitySemanticBridgeMode: quantitySemanticBridge.mode,
    quantitySemanticBridgeReady: quantitySemanticBridge.ready,
    quantitySemanticBridgeMissing: quantitySemanticBridge.missing,
    qeiStateClass,
    qeiRenormalizationScheme,
    qeiSamplingNormalization,
    qeiOperatorMapping,
    tau_s: Number.isFinite(boundResult.tau_s) ? boundResult.tau_s : tauSelected_s,
    tauConfigured_s,
    tauWindow_s,
    tauPulse_s,
    tauLC_s,
    tauSelected_s,
    tauSelectedSource,
    tauSelectorPolicy,
    tauSelectorFallbackApplied,
    tauProvenanceReady,
    tauProvenanceMissing,
    congruentSolvePolicyMarginPass,
    congruentSolveComputedMarginPass,
    congruentSolveApplicabilityPass,
    congruentSolveMetricPass,
    congruentSolveSemanticPass,
    congruentSolvePass,
    congruentSolveFailReasons,
  };
}

function deriveQiLaplaceRungeLenz(state: EnergyPipelineState, stats: QiStats) {
  const position: Vec3 = [
    finiteNumber(stats.avg),
    finiteNumber(stats.bound),
    finiteNumber(stats.margin),
  ];
  const now = Date.now();
  const last = qiLrlHistory.lastPosition;
  const dtSeconds =
    last && qiLrlHistory.lastTimestamp
      ? Math.max((now - qiLrlHistory.lastTimestamp) / 1000, 1e-3)
      : null;
  const velocity: Vec3 =
    last && dtSeconds
      ? [
          (position[0] - last[0]) / dtSeconds,
          (position[1] - last[1]) / dtSeconds,
          (position[2] - last[2]) / dtSeconds,
        ]
      : [0, 0, 0];

  qiLrlHistory.lastPosition = position;
  qiLrlHistory.lastTimestamp = now;

  const mass = positiveOrFallback(state.M_exotic ?? state.exoticMassTarget_kg ?? 1, 1);
  const centralMass = positiveOrFallback(state.exoticMassTarget_kg ?? mass, mass);

  const result = computeLaplaceRungeLenz({
    position,
    velocity,
    mass,
    centralMass,
  });

  if (!Number.isFinite(result.eccentricity) || !Number.isFinite(result.periapsisAngle)) {
    return null;
  }

  const lrlVector: [number, number, number] = [
    result.vector[0],
    result.vector[1],
    result.vector[2],
  ];

  return {
    eccentricity: result.eccentricity,
    periapsisAngle: result.periapsisAngle,
    lrlVector,
    lrlMagnitude: result.magnitude,
    lrlActionRate: result.actionRate,
    lrlOscillatorCoordinate: result.oscillatorCoordinate,
    lrlOscillatorVelocity: result.oscillatorVelocity,
    lrlOscillatorEnergy: result.oscillatorEnergy,
    lrlPlanarResidual: result.planarResidual,
    lrlGeometryResidual: result.geometryResidual,
  };
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveOrFallback(value: unknown, fallback = 1, min = 1e-6, max = 1e12): number {
  const raw = Number(value);
  const n = Number.isFinite(raw) ? Math.abs(raw) : NaN;
  if (!Number.isFinite(n) || n < min) {
    return fallback;
  }
  if (n > max) {
    return max;
  }
  return n;
}

function desiredQiSampleDt(state: EnergyPipelineState): number {
  const sectorPeriod =
    Number(state.phaseSchedule?.sectorPeriod_ms ?? state.sectorPeriod_ms) || DEFAULT_SECTOR_PERIOD_MS;
  const sectors = Math.max(1, Math.floor(state.phaseSchedule?.N ?? state.sectorCount ?? DEFAULT_SECTORS_TOTAL));
  const concurrent = Math.max(1, Math.floor(state.concurrentSectors ?? state.sectorStrobing ?? 1));
  const dwellPerSample = sectorPeriod / Math.max(1, sectors / concurrent);
  return clampNumber(dwellPerSample, 0.25, 10);
}

function reconfigureQiMonitor(
  tauMs: number,
  dtMs: number,
  fieldType?: QiFieldType,
  sampler?: SamplingKind,
): void {
  const clampedTau = Math.max(0.5, tauMs);
  const clampedDt = clampNumber(dtMs, 0.25, 10);
  const tauChanged = Math.abs(clampedTau - qiMonitorTau_ms) > 1e-3;
  const dtChanged = Math.abs(clampedDt - qiMonitorDt_ms) > 1e-3;
  const samplerChanged = typeof sampler === "string" && sampler.length > 0 && sampler !== qiMonitorSampler;
  const next: Partial<QiSettings> & { dt_ms?: number } = { tau_s_ms: clampedTau, dt_ms: clampedDt };
  if (fieldType) next.fieldType = fieldType;
  if (samplerChanged) next.sampler = sampler as SamplingKind;
  if (!tauChanged && !dtChanged && !fieldType && !samplerChanged) return;
  qiMonitor.reconfigure(next);
  qiMonitorTau_ms = clampedTau;
  qiMonitorDt_ms = clampedDt;
  if (samplerChanged) qiMonitorSampler = sampler as SamplingKind;
  qiSampleAccumulator_ms = 0;
  qiSampleLastTs = Date.now();
  lastQiStats = null;
}

function advanceQiMonitor(effectiveRho: number): QiStats {
  const now = Date.now();
  qiSampleAccumulator_ms += now - qiSampleLastTs;
  qiSampleLastTs = now;
  let steps =
    qiMonitorDt_ms > 0 ? Math.floor(qiSampleAccumulator_ms / qiMonitorDt_ms) : 0;
  steps = Math.max(1, steps);
  let latest: QiStats | null = null;
  for (let i = 0; i < steps; i += 1) {
    latest = qiMonitor.tick(effectiveRho);
    if (qiMonitorDt_ms > 0 && qiSampleAccumulator_ms >= qiMonitorDt_ms) {
      qiSampleAccumulator_ms -= qiMonitorDt_ms;
    }
  }
  qiSampleAccumulator_ms = clampNumber(
    qiSampleAccumulator_ms,
    0,
    qiMonitorDt_ms * 8,
  );
  if (!latest && lastQiStats) {
    return lastQiStats;
  }
  lastQiStats = latest;
  return latest ?? qiMonitor.tick(effectiveRho);
}

// Mode switching function
export async function switchMode(
  state: EnergyPipelineState,
  newMode: EnergyPipelineState['currentMode'],
  opts: PipelineRunOptions = {},
): Promise<EnergyPipelineState> {
  state.currentMode = newMode;
  return await calculateEnergyPipeline(state, opts);
}

// Parameter update function
export async function updateParameters(
  state: EnergyPipelineState,
  params: Partial<EnergyPipelineState>,
  opts: PipelineRunOptions = {},
): Promise<EnergyPipelineState> {
  const nextParams: Partial<EnergyPipelineState> = { ...params };
  const hasOwn = (value: object, key: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);
  const validateSectorDuty = (value: unknown, field: string): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 1e-6 ||
      value > 1
    ) {
      throw new RangeError(`${field} must be a finite number in [0.000001, 1]`);
    }
    return value;
  };
  const clampPulseCap = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? (n as number) : fallback;
  };

  const incomingDynamicRaw = nextParams.dynamicConfig;
  if (
    incomingDynamicRaw != null &&
    (typeof incomingDynamicRaw !== "object" || Array.isArray(incomingDynamicRaw))
  ) {
    throw new TypeError("dynamicConfig must be an object");
  }
  if (incomingDynamicRaw != null) {
    const incomingDynamic = incomingDynamicRaw as MutableDynamicConfig;
    if (hasOwn(incomingDynamic, "sectorDuty")) {
      validateSectorDuty(
        incomingDynamic.sectorDuty,
        "dynamicConfig.sectorDuty",
      );
    }
    if (hasOwn(incomingDynamic, "measuredSectorDuty")) {
      validateSectorDuty(
        incomingDynamic.measuredSectorDuty,
        "dynamicConfig.measuredSectorDuty",
      );
    }
  }
  if (hasOwn(nextParams, "measuredSectorDuty")) {
    const rootMeasuredDuty = validateSectorDuty(
      (nextParams as any).measuredSectorDuty,
      "measuredSectorDuty",
    );
    if (
      incomingDynamicRaw != null &&
      hasOwn(incomingDynamicRaw as MutableDynamicConfig, "measuredSectorDuty") &&
      (incomingDynamicRaw as MutableDynamicConfig).measuredSectorDuty !==
        rootMeasuredDuty
    ) {
      throw new Error(
        "measuredSectorDuty conflicts with dynamicConfig.measuredSectorDuty",
      );
    }
  }

  if (hasOwn(nextParams, "dutyEffectiveFR")) {
    const rootDuty = validateSectorDuty(
      (nextParams as any).dutyEffectiveFR,
      "dutyEffectiveFR",
    );
    const incomingDynamic: MutableDynamicConfig = {
      ...((incomingDynamicRaw ?? {}) as MutableDynamicConfig),
    };
    if (hasOwn(incomingDynamic, "sectorDuty")) {
      const nestedDuty = validateSectorDuty(
        incomingDynamic.sectorDuty,
        "dynamicConfig.sectorDuty",
      );
      if (nestedDuty !== rootDuty) {
        throw new Error(
          "dutyEffectiveFR conflicts with dynamicConfig.sectorDuty",
        );
      }
    }
    incomingDynamic.sectorDuty = rootDuty;
    nextParams.dynamicConfig = incomingDynamic;
    delete (nextParams as any).dutyEffectiveFR;
  }

  if (nextParams.dynamicConfig) {
    const incoming = nextParams.dynamicConfig as MutableDynamicConfig;
    const current = state.dynamicConfig ?? {};
    const nextDynamic: MutableDynamicConfig = {
      ...current,
      ...incoming,
    };
    if (incoming.sweep || current.sweep) {
      nextDynamic.sweep = {
        ...(current.sweep ?? {}),
        ...(incoming.sweep ?? {}),
      };
    }
    state.dynamicConfig = nextDynamic;
    delete (nextParams as any).dynamicConfig;
  }

  if (typeof nextParams.negativeFraction === "number" && Number.isFinite(nextParams.negativeFraction)) {
    nextParams.negativeFraction = Math.max(0, Math.min(1, nextParams.negativeFraction));
  }

  if (nextParams.hull) {
    nextParams.hull = {
      ...(state.hull ?? {}),
      ...(nextParams.hull ?? {}),
    };
  }

  if (nextParams.bubble) {
    nextParams.bubble = {
      ...(state.bubble ?? {}),
      ...(nextParams.bubble ?? {}),
    };
  }

  if ("iPeakMaxMidi_A" in nextParams) {
    nextParams.iPeakMaxMidi_A = clampPulseCap(
      nextParams.iPeakMaxMidi_A,
      state.iPeakMaxMidi_A ?? DEFAULT_PULSED_CURRENT_LIMITS_A.midi,
    );
  }
  if ("iPeakMaxSector_A" in nextParams) {
    nextParams.iPeakMaxSector_A = clampPulseCap(
      nextParams.iPeakMaxSector_A,
      state.iPeakMaxSector_A ?? DEFAULT_PULSED_CURRENT_LIMITS_A.sector,
    );
  }
  if ("iPeakMaxLauncher_A" in nextParams) {
    nextParams.iPeakMaxLauncher_A = clampPulseCap(
      nextParams.iPeakMaxLauncher_A,
      state.iPeakMaxLauncher_A ?? DEFAULT_PULSED_CURRENT_LIMITS_A.launcher,
    );
  }

  Object.assign(state, nextParams);
  return await calculateEnergyPipeline(state, opts);
}

// Export current pipeline state for external access
let globalPipelineState = initializePipelineState();

export function getGlobalPipelineState(): EnergyPipelineState {
  return globalPipelineState;
}

export function setGlobalPipelineState(state: EnergyPipelineState): void {
  globalPipelineState = state;
}

// Helper functions for normalization
function finite(n: any){ const x = +n; return Number.isFinite(x) ? x : undefined; }
function arrN(a:any, k:number){ return (Array.isArray(a) && a.length>=k) ? a : undefined; }

/**
 * Compute energy snapshot for unified client consumption
 * Calls the central pipeline and merges outputs into shared snapshot
 */
export async function computeEnergySnapshot(sim: any) {
  const ampFactorsInput = (sim as any)?.ampFactors ?? sim.amps ?? {};
  const resolvePulseCap = (value: unknown, fallback: number): number =>
    Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  // Convert sim to pipeline state format
  const state = {
    ...initializePipelineState(),
    gap_nm: sim.gap ?? PROMOTED_WARP_PROFILE.gap_nm,
    sag_nm: sim.sagDepth ?? 16,
    temperature_K: sim.temperature ?? 20,
    modulationFreq_GHz: sim.dynamicConfig?.modulationFreqGHz ?? DEFAULT_MODULATION_FREQ_GHZ,
    currentMode: sim.mode ?? 'hover',
    massMode: (sim as any)?.massMode ?? sim.massMode,
    gammaGeo: ampFactorsInput?.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo,
    qMechanical: ampFactorsInput?.qMechanical ?? 1,
    qCavity: sim.dynamicConfig?.cavityQ ?? ampFactorsInput?.qCavity ?? PROMOTED_WARP_PROFILE.qCavity,
    gammaVanDenBroeck:
      ampFactorsInput?.gammaVanDenBroeck ?? PROMOTED_WARP_PROFILE.gammaVanDenBroeck,
    qSpoilingFactor: ampFactorsInput?.qSpoilingFactor ?? PROMOTED_WARP_PROFILE.qSpoilingFactor,
    dutyCycle: sim.dynamicConfig?.dutyCycle ?? PROMOTED_WARP_PROFILE.dutyCycle,
    sectorCount: sim.dynamicConfig?.sectorCount ?? PROMOTED_WARP_PROFILE.sectorCount,
    exoticMassTarget_kg: sim.exoticMassTarget_kg ?? 1405,
    warpFieldType:
      sim.dynamicConfig?.warpFieldType ??
      (sim as any)?.warpFieldType ??
      PROMOTED_WARP_PROFILE.warpFieldType,
    warpGeometry: (sim as any)?.warpGeometry ?? sim.dynamicConfig?.warpGeometry ?? null,
    warpGeometryKind: (sim as any)?.warpGeometryKind ?? (sim as any)?.warpGeometry?.kind,
    warpGeometryAssetId: (sim as any)?.warpGeometryAssetId ?? (sim as any)?.warpGeometry?.assetId,
    dynamicConfig: sim.dynamicConfig ?? null,
    experimental: (sim as any)?.experimental ?? sim.experimental,
    iPeakMaxMidi_A: resolvePulseCap(sim.iPeakMaxMidi_A, DEFAULT_PULSED_CURRENT_LIMITS_A.midi),
    iPeakMaxSector_A: resolvePulseCap(sim.iPeakMaxSector_A, DEFAULT_PULSED_CURRENT_LIMITS_A.sector),
    iPeakMaxLauncher_A: resolvePulseCap(sim.iPeakMaxLauncher_A, DEFAULT_PULSED_CURRENT_LIMITS_A.launcher),
  } as EnergyPipelineState;

  const ampFactorsSnapshot: AmpFactors = {
    gammaGeo: state.gammaGeo,
    gammaVanDenBroeck: state.gammaVanDenBroeck,
    qSpoilingFactor: state.qSpoilingFactor,
    qMechanical: state.qMechanical,
    qCavity: state.qCavity,
    measuredGammaGeo: ampFactorsInput?.measuredGammaGeo,
    measuredGammaVanDenBroeck: ampFactorsInput?.measuredGammaVanDenBroeck,
    measuredQSpoilingFactor: ampFactorsInput?.measuredQSpoilingFactor,
    measuredQMechanical: ampFactorsInput?.measuredQMechanical,
    measuredCavityQ: ampFactorsInput?.measuredCavityQ,
  };
  state.ampFactors = ampFactorsSnapshot;
  (state as any).amps = ampFactorsSnapshot; // legacy alias

  // Run the unified pipeline calculation
  const result = await calculateEnergyPipeline(state);

  // ---- Normalize LightG+ç+¦Crossing payload for the client API -------------------
  const lcSrc = (result.lc ?? result.lightCrossing ?? {}) as any;
  const lc = {
    tauLC_ms:   finite(lcSrc.tauLC_ms ?? lcSrc.tau_ms ?? (lcSrc.tau_us!=null ? lcSrc.tau_us/1000 : undefined)),
    dwell_ms:   finite(lcSrc.dwell_ms ?? (lcSrc.dwell_us!=null ? lcSrc.dwell_us/1000 : lcSrc.dwell_ms)),
    burst_ms:   finite(lcSrc.burst_ms ?? (lcSrc.burst_us!=null ? lcSrc.burst_us/1000 : lcSrc.burst_ms)),
    phase:      finite(lcSrc.phase),
    onWindow:   !!lcSrc.onWindow,
    sectorIdx:  Number.isFinite(+lcSrc.sectorIdx) ? Math.floor(+lcSrc.sectorIdx) : undefined,
    sectorCount:Number.isFinite(+result.sectorCount) ? Math.floor(+result.sectorCount) : undefined,
  };

  // ---- Duty (renderer authority) by mode; keep explicit fields too ----------
  // Trust the pipeline's FR duty (ship-wide, sector-averaged)
  const dutyEffectiveFR =
    result.dutyEffective_FR ??
    result.dutyShip ??
    (result as any).dutyEff ??
    PROMOTED_WARP_PROFILE.dutyShip;

  const duty = {
    dutyUsed:        finite(result.dutyUsed),
    dutyEffectiveFR: finite(dutyEffectiveFR),
    dutyFR_slice:    finite(result.dutyFR_slice),
    dutyFR_ship:     finite(result.dutyFR_ship),
  };

  const projectTensorForResponse = (
    value: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> => {
    const tensor = value ?? {};
    const out: Record<string, unknown> = {
      T00: finite(tensor.T00),
      T11: finite(tensor.T11),
      T22: finite(tensor.T22),
      T33: finite(tensor.T33),
    };
    for (const key of [
      "T01",
      "T10",
      "T02",
      "T20",
      "T03",
      "T30",
      "T12",
      "T21",
      "T13",
      "T31",
      "T23",
      "T32",
    ]) {
      const v = finite((tensor as Record<string, unknown>)[key]);
      if (v != null) out[key] = v;
    }
    if (typeof tensor.isNullEnergyConditionSatisfied === "boolean") {
      out.isNullEnergyConditionSatisfied = tensor.isNullEnergyConditionSatisfied;
    }
    if (typeof tensor.modelTermRoute === "string" && tensor.modelTermRoute.length > 0) {
      out.modelTermRoute = tensor.modelTermRoute;
    }
    if (
      tensor.modelTermAdmission === "admitted" ||
      tensor.modelTermAdmission === "experimental_not_admitted"
    ) {
      out.modelTermAdmission = tensor.modelTermAdmission;
    }
    if (typeof tensor.researchBasisRef === "string" && tensor.researchBasisRef.length > 0) {
      out.researchBasisRef = tensor.researchBasisRef;
    }
    return out;
  };

  // ---- Nat++¡rio tensors (kept under natario.*; adapter also accepts top-level)
  const natario = {
    metricMode:  !!(result.natario?.metricMode),
    lapseN:      finite(result.natario?.lapseN),
    shiftBeta:   arrN(result.natario?.shiftBeta, 3),
    gSpatialDiag:arrN(result.natario?.gSpatialDiag, 3),
    gSpatialSym: arrN(result.natario?.gSpatialSym, 6),
    viewForward: arrN(result.natario?.viewForward, 3),
    g0i:         arrN(result.natario?.g0i, 3),
  // pass-through diagnostics from Nat++¡rio (unit-annotated upstream)
  dutyFactor:      finite(result.natario?.dutyFactor),       // unitless (++s/++s)
  // NOTE: natario.thetaScaleCore_sqrtDuty is the explicit Nat++¡rio sqrt-duty
  // diagnostic (G+¬+£duty semantics). Prefer `_sqrtDuty` when inspecting Nat++¡rio
  // outputs; it intentionally excludes +-ª_VdB and is NOT the canonical ship-wide
  // theta used by engines (engines should use `thetaScale` / `thetaScaleExpected`).
  // Keep the legacy `thetaScaleCore` key for back-compat but mark it deprecated
  // here by mapping it from the `_sqrtDuty` alias when present.
  thetaScaleCore_sqrtDuty: finite((result as any).natario?.thetaScaleCore_sqrtDuty ?? (result as any).natario?.thetaScaleCore),
  /* @deprecated legacy key; prefer thetaScaleCore_sqrtDuty */
  thetaScaleCore: finite((result as any).natario?.thetaScaleCore ?? (result as any).natario?.thetaScaleCore_sqrtDuty),
  metricSource: typeof (result as any).natario?.stressEnergySource === "string"
    ? String((result as any).natario.stressEnergySource)
    : undefined,
  metricT00: finite((result as any).natario?.metricT00),
  metricT00Source: typeof (result as any).natario?.metricT00Source === "string"
    ? String((result as any).natario.metricT00Source)
    : undefined,
  metricT00Ref: typeof (result as any).natario?.metricT00Ref === "string"
    ? String((result as any).natario.metricT00Ref)
    : undefined,
  metricT00Observer: typeof (result as any).natario?.metricT00Observer === "string"
    ? String((result as any).natario.metricT00Observer)
    : undefined,
  metricT00Normalization: typeof (result as any).natario?.metricT00Normalization === "string"
    ? String((result as any).natario.metricT00Normalization)
    : undefined,
  metricT00UnitSystem: typeof (result as any).natario?.metricT00UnitSystem === "string"
    ? String((result as any).natario.metricT00UnitSystem)
    : undefined,
  metricT00ContractStatus: typeof (result as any).natario?.metricT00ContractStatus === "string"
    ? String((result as any).natario.metricT00ContractStatus)
    : undefined,
  metricT00ContractReason: typeof (result as any).natario?.metricT00ContractReason === "string"
    ? String((result as any).natario.metricT00ContractReason)
    : undefined,
  metricT00Derivation: typeof (result as any).natario?.metricT00Derivation === "string"
    ? String((result as any).natario.metricT00Derivation)
    : undefined,
  chartLabel: typeof (result as any).natario?.chartLabel === "string"
    ? String((result as any).natario.chartLabel)
    : undefined,
  chartDtGammaPolicy: typeof (result as any).natario?.chartDtGammaPolicy === "string"
    ? String((result as any).natario.chartDtGammaPolicy)
    : undefined,
  chartContractStatus: typeof (result as any).natario?.chartContractStatus === "string"
    ? String((result as any).natario.chartContractStatus)
    : undefined,
  lapseSummary: (result as any).natario?.lapseSummary,
  metricT00FamilyAuthorityStatus:
    typeof (result as any).natario?.metricT00FamilyAuthorityStatus === "string"
      ? String((result as any).natario.metricT00FamilyAuthorityStatus)
      : undefined,
  metricT00TransportCertificationStatus:
    typeof (result as any).natario?.metricT00TransportCertificationStatus === "string"
      ? String((result as any).natario.metricT00TransportCertificationStatus)
      : undefined,
  metricT00FamilySemanticsNote:
    typeof (result as any).natario?.metricT00FamilySemanticsNote === "string"
      ? String((result as any).natario.metricT00FamilySemanticsNote)
      : undefined,
  stressEnergyTensor: projectTensorForResponse(
    (result as any).natario?.stressEnergyTensor ?? null,
  ),
  metricStressEnergy: projectTensorForResponse(
    (result as any).natario?.metricStressEnergy ?? null,
  ),
  tileEffectiveStressEnergy: projectTensorForResponse(
    (result as any).natario?.tileEffectiveStressEnergy ?? null,
  ),
  nhm2ObserverAudit:
    (result as any).natario?.nhm2ObserverAudit ??
    (result as any).nhm2ObserverAudit,
  nhm2ObserverRobustEnergyConditions:
    (result as any).natario?.nhm2ObserverRobustEnergyConditions ??
    (result as any).nhm2ObserverRobustEnergyConditions,
  nhm2SameChartFullTensor:
    (result as any).natario?.nhm2SameChartFullTensor ??
    (result as any).nhm2SameChartFullTensor,
  nhm2SourceClosure:
    (result as any).natario?.nhm2SourceClosure ??
    (result as any).nhm2SourceClosure,
  nhm2WallSourceClosure:
    (result as any).natario?.nhm2WallSourceClosure ??
    (result as any).nhm2WallSourceClosure,
  nhm2StrictSignalReadiness:
    (result as any).natario?.nhm2StrictSignalReadiness ??
    (result as any).nhm2StrictSignalReadiness,
  nhm2QeiWorldlineDossier:
    (result as any).natario?.nhm2QeiWorldlineDossier ??
    (result as any).nhm2QeiWorldlineDossier,
  nhm2NatarioInvariantAudit:
    (result as any).natario?.nhm2NatarioInvariantAudit ??
    (result as any).nhm2NatarioInvariantAudit,
  };

  // --- Compatibility aliases: accept alternate server keys and provide both forms ---
  // Some older code emits dutyEffective_FR or nests light-crossing under `lc`.
  const compat = {} as any;
  // dutyEffective_FR -> dutyEffectiveFR
  if ((result as any).dutyEffective_FR != null && (result as any).dutyEffectiveFR == null) {
    compat.dutyEffectiveFR = finite((result as any).dutyEffective_FR);
  }
  // lightCrossing vs lc
  if ((result as any).lightCrossing == null && (result as any).lc != null) {
    compat.lightCrossing = (result as any).lc;
  }
  // natario may be missing in some shapes; ensure it exists
  if ((result as any).natario == null) {
    compat.natario = {};
  }

  // Merge compat back into result for downstream consumers
  const normalizedResult = { ...(result as any), lc, duty, natario, ...compat } as any;

  // Ensure warp.stressEnergyTensor is always populated (fallback to root stressEnergy)
  const warpStress = (result as any).warp?.stressEnergyTensor ?? (result as any).stressEnergy;
  const warpOut = {
    ...(result as any).warp,
    ...(warpStress ? { stressEnergyTensor: warpStress } : {}),
  };

  const warpUniforms = {
    // physics (visual) G+ç+¦ mass stays split and separate
    gammaGeo: result.gammaGeo,
    qSpoilingFactor: result.qSpoilingFactor,
    gammaVanDenBroeck: (result as any).gammaVanDenBroeck_vis,   // visual gamma
    gammaVanDenBroeck_vis: (result as any).gammaVanDenBroeck_vis,
    gammaVanDenBroeck_mass: (result as any).gammaVanDenBroeck_mass,
      chi_coupling: result.couplingChi,

    // FordG+ç+¦Roman duty (ship-wide, sector-averaged)
    dutyEffectiveFR,

    // UI label fields (harmless to include)
    dutyCycle: result.dutyCycle,
    sectorCount: result.sectorCount,
    sectors: result.concurrentSectors,   // concurrent/live
    currentMode: result.currentMode,

    // viewer defaults G+ç+¦ visual policy only; parity/ridge set client-side
    viewAvg: true,
    colorMode: 'theta',

    // optional: hull/wall for overlays
    hull: result.hull,
    wallWidth_m: result.hull?.wallThickness_m ?? DEFAULT_WALL_THICKNESS_M,

    // meta
    __src: 'server',
    __version: Number((result as any)?.seq ?? Date.now()),
  };

  // PATCH START: uniformsExplain debug metadata for /bridge
  const gammaGeoSource = (result as any).gammaGeoSource ?? "design";
  const gammaVdBSource = (result as any).gammaVanDenBroeckSource ?? "design";
  const qSpoilSource = (result as any).qSpoilingFactorSource ?? "policy";
  const qCavitySource = (result as any).qCavitySource ?? "design";
  const modulationSource = (result as any).modulationFreqSource ?? "design";
  const dutyCycleSource = (result as any).dutyCycleSource ?? "policy";
  const sectorCountSource = (result as any).sectorCountSource ?? "design";
  const dutyEffectiveSource =
    (result as any).sectorDutySource ??
    (result as any).dutyEffectiveFRSource ??
    "schedule";
  const uniformsExplain = {
    // Human-readable G+ç-úwhere did this come from?G+ç-Ñ pointers
    sources: {
      gammaGeo:               `server.result.gammaGeo (${gammaGeoSource})`,
      qSpoilingFactor:        `server.result.qSpoilingFactor (${qSpoilSource})`,
      qCavity:                `server.result.qCavity (${qCavitySource})`,
      modulationFreq_GHz:     `server.result.modulationFreq_GHz (${modulationSource})`,
      gammaVanDenBroeck_vis:  "server.(gammaVanDenBroeck_vis) G+ç+¦ fixed visual seed unless standby",
      gammaVanDenBroeck_mass: `server.(gammaVanDenBroeck_mass) (${gammaVdBSource})`,
      dutyEffectiveFR:        `server.derived (${dutyEffectiveSource})`,
      dutyCycle:              `server.result.dutyCycle (${dutyCycleSource})`,
      sectorCount:            `server.result.sectorCount (${sectorCountSource})`,
      sectors:                "server.result.concurrentSectors (live concurrent sectors)",
      currentMode:            "server.result.currentMode (authoritative)",
      hull:                   "server.result.hull (Lx,Ly,Lz,wallThickness_m)",
      wallWidth_m:            "server.result.hull.wallThickness_m",
      viewAvg:                "policy: true (clients render FR-averaged ++ by default)",
    },

    // FordG+ç+¦Roman duty derivation (numbers)
    fordRomanDuty: {
      formula: "d_eff = measuredDuty || (dutyBurst * S_live / S_total)",
      burstLocal: result.dutyBurst ?? PROMOTED_WARP_PROFILE.dutyCycle,
      S_total: result.sectorCount,
      S_live: result.concurrentSectors,
      measured_d_eff: result.dutyMeasuredFR,
      computed_d_eff: dutyEffectiveFR,
      duty_source: (result as any)?.dutyEffectiveFRSource ?? ((result as any)?.dutyMeasuredFR != null ? "measured" : "schedule"),
      window_ms: (result as any)?.dutyMeasuredWindow_ms,
    },

    // ++ audit + the inputs used to compute it (for transparency)
    thetaAudit: {
      note: "++ audit - raw vs pipeline VdB (targeting optional)",
      equation: "++ = +-ª_geo^3 -+ q -+ +-ª_VdB -+ d_eff",
      mode: (result as any).modelMode ?? MODEL_MODE, // "raw" | "calibrated"
      massMode: (result as any).massMode ?? DEFAULT_MASS_MODE,
      inputs: {
        gammaGeo: result.gammaGeo,
        q: result.qSpoilingFactor,
        d_eff: dutyEffectiveFR,
        gammaVdB_raw: PAPER_VDB.GAMMA_VDB,
        gammaVdB_cal: (result as any).gammaVanDenBroeck_mass ?? (result as any).gammaVanDenBroeck_vis,
      },
      results: {
        thetaRaw: (result as any).thetaRaw,
        thetaCal: (result as any).thetaCal,
        thetaScaleExpected: (result as any).thetaScaleExpected, // same as thetaCal
        ratio_raw_vs_cal: ((result as any).thetaRaw || 0) / Math.max(1e-12, (result as any).thetaCal || 1e-12),
        gammaVdB_ratio: PAPER_VDB.GAMMA_VDB / Math.max(1e-12, (result as any).gammaVanDenBroeck_mass ?? (result as any).gammaVanDenBroeck_vis ?? 1e-12)
      }
    },

    // Live numeric values the cards can render directly
  live: {
      // sectors / duty
      S_total: result.sectorCount,
      S_live: result.concurrentSectors,
      dutyCycle: result.dutyCycle,
  // dutyEffectiveFR is included in thetaAudit.inputs and elsewhere; omit duplicate here to avoid overwrites

      // amp factors and Q
      gammaGeo: result.gammaGeo,
      qSpoilingFactor: result.qSpoilingFactor,
      qCavity: result.qCavity,
      gammaVanDenBroeck_vis: (result as any).gammaVanDenBroeck_vis,
      gammaVanDenBroeck_mass: (result as any).gammaVanDenBroeck_mass,

      // census + power
      N_tiles: result.N_tiles,
      tilesPerSector: result.tilesPerSector,
      activeTiles: result.activeTiles,
      P_avg_W: (result as any).P_avg_W,
      P_avg_MW: result.P_avg,

      // safety
      zeta: result.zeta,
      TS_ratio: result.TS_ratio,
      ts_metric_derived: (result as any).tsMetricDerived === true,
      strict_congruence: strictCongruenceEnabled(),
    },

    // Base equations (render these + a line below with the live values)
    equations: {
      d_eff: "d_eff = burstLocal -+ S_live / S_total",
      theta_expected: "++_expected = +-ª_geo^3 -+ q -+ +-ª_VdB(vis) -+ G+¬+£d_eff",
      U_static: "U_static = chi_coupling * [-pi^2 * hbar * c/(720 * a^3)] * A_tile",
      U_geo: "U_geo = +-ª_geo^3 -+ U_static",
      U_Q: "U_Q = q_mech -+ U_geo",
      P_avg: "P_avg = |U_Q| -+ -+½ / Q -+ N_tiles -+ d_eff",
      M_exotic: "M = [U_static -+ +-ª_geo^3 -+ Q_burst -+ +-ª_VdB -+ d_eff] -+ N_tiles / c--ª",
      TS_long: "TS_long = (L_long / c) / (1/f_m)",
    },
  };
  // PATCH END


  // Expose to clients (names match what adapters expect)
  return {
    // Core pipeline state
    ...result,
    warpUniforms,
    // PATCH START: add uniformsExplain to client payload
    uniformsExplain,
    // PATCH END

    // Amplification parameters 
    gammaGeo: result.gammaGeo,
    gammaVanDenBroeck: result.gammaVanDenBroeck,
    gammaVanDenBroeck_vis: (result as any).gammaVanDenBroeck_vis,
    gammaVanDenBroeck_mass: (result as any).gammaVanDenBroeck_mass,
    thetaScaleExpected: (result as any).thetaScaleExpected,
    // Dual-value theta audit
    thetaRaw: (result as any).thetaRaw,
    thetaCal: (result as any).thetaCal,
    modelMode: (result as any).modelMode,
    massMode: (result as any).massMode,
    qCavity: result.qCavity,
    qSpoilingFactor: result.qSpoilingFactor,

  // Strobing parameters
  dutyCycle: result.dutyCycle,
  sectorStrobing: result.sectorStrobing,

    // Nat++¡rio / stress-energy surface (time-averaged)
    T00_avg: (result as any).warp?.stressEnergyTensor?.T00 ?? (result as any).stressEnergy?.T00,
    T11_avg: (result as any).warp?.stressEnergyTensor?.T11 ?? (result as any).stressEnergy?.T11,
    T22_avg: (result as any).warp?.stressEnergyTensor?.T22 ?? (result as any).stressEnergy?.T22,
    T33_avg: (result as any).warp?.stressEnergyTensor?.T33 ?? (result as any).stressEnergy?.T33,
    // Explicit stress-energy projection for clients that only read root fields
    stressEnergy: {
      ...(result as any).stressEnergy,
      ...(result as any).warp?.stressEnergyTensor
        ? {
            T00: (result as any).warp.stressEnergyTensor.T00,
            T11: (result as any).warp.stressEnergyTensor.T11,
            T22: (result as any).warp.stressEnergyTensor.T22,
            T33: (result as any).warp.stressEnergyTensor.T33,
          }
        : {},
    },
    beta_avg: (result as any).warp?.betaAvg ?? (result as any).warp?.natarioShiftAmplitude ?? (result as any).stressEnergy?.beta_avg,
    gr_ok: (result as any).warp?.validationSummary?.warpFieldStable ?? true,
    natarioConstraint: (result as any).warp?.isZeroExpansion ?? result.natarioConstraint,

    // Diagnostics
    warpModule: (result as any).warp ? {
      timeMs: (result as any).warp.calculationTime ?? 0,
      status: (result as any).warp.validationSummary?.overallStatus ?? 'optimal'
    } : { timeMs: 0, status: 'optimal' },
    // Ensure warp tensor emitted for clients
    warp: warpOut,

    // Normalized, renderer-ready data structures
    lc,
    natario,
    // Duty authority (adapter selects by mode; renderer never fabricates)
    ...duty,
    // For adapter mode selection & viewers
    mode: sim.mode ?? result.currentMode ?? 'hover',
    strictCongruence: strictCongruenceEnabled(),
  };
}

/**
 * Sample the Nat++¡rio bell displacement on an ellipsoidal shell using the same math as the renderer.
 * Returns ~ nTheta*nPhi points, suitable for JSON compare or CSV export.
 */
/**
 * Sample the Nat++¡rio bell displacement on an ellipsoidal shell using the same math as the renderer.
 * Returns typed buffers suitable for JSON compare or CSV export without allocating per-sample objects.
 */
export function sampleDisplacementField(state: EnergyPipelineState, req: FieldRequest = {}): FieldSampleBuffer {
  // Hull geometry: convert from Needle Hull format to ellipsoid axes
  const hullGeom = resolveHullGeometry(state); // fallback only
  const a = hullGeom.Lx_m / 2;  // Semi-axis X (length/2)
  const b = hullGeom.Ly_m / 2;  // Semi-axis Y (width/2)
  const c = hullGeom.Lz_m / 2;  // Semi-axis Z (height/2)
  const axes: HullAxes = { a, b, c };

  const nTheta = Math.max(1, req.nTheta ?? 64);
  const nPhi   = Math.max(2, req.nPhi ?? 32); // need G+½+æ2 to avoid (nPhi-1)=0
  const sectors = Math.max(
    1,
    Math.floor(req.sectors ?? state.sectorCount ?? PROMOTED_WARP_PROFILE.sectorCount),
  );
  const split   = Number.isFinite(req.split as number) ? Math.max(0, Math.floor(req.split!)) : Math.floor(sectors / 2);

  const totalSamples = nTheta * nPhi;
  ensureFieldSampleCapacity(totalSamples);

  // Canonical bell width in *ellipsoidal* radius units: w-++ = w_m / a_eff.
  // Use harmonic-mean effective radius to match viewer/renderer -++-units.
  const aEff = 3 / (1/axes.a + 1/axes.b + 1/axes.c);  // G-ú+á harmonic mean (matches viewer)
  const w_m = req.wallWidth_m ?? Math.max(1e-6, (state.sag_nm ?? 16) * 1e-9); // meters
  const w_rho = Math.max(1e-6, w_m / aEff);

  // Match renderer's gain chain (display-focused): disp ~ +-ª_geo^3 * q_spoil * bell * sgn
  const gammaGeo = state.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo;
  const qSpoil = state.qSpoilingFactor ?? PROMOTED_WARP_PROFILE.qSpoilingFactor;
  const geoAmp     = Math.pow(gammaGeo, 3);               // *** cubic, same as pipeline ***
  const vizGain    = 1.0;                                 // keep physics-scale here; renderer may apply extra gain

  let idx = 0;

  for (let i = 0; i < nTheta; i++) {
    const theta = (i / nTheta) * 2 * Math.PI;      // [--+ç, -+ç] ring index
    // --- Smooth sector strobing (matches renderer exactly) ---
    const u = (theta < 0 ? theta + 2 * Math.PI : theta) / (2 * Math.PI);
    const sectorIdx = Math.floor(u * sectors);
    const distToSplit = (sectorIdx - split + 0.5);
    const strobeWidth = 0.75;                 // same as renderer
    const softSign = (x: number) => Math.tanh(x); // smooth --ª1 transition
    const sgn = softSign(-distToSplit / strobeWidth); // smooth sector sign

    for (let j = 0; j < nPhi; j++) {
      const phi = -Math.PI / 2 + (j / (nPhi - 1)) * Math.PI; // [--+ç/2, -+ç/2]
      const onShell: [number, number, number] = [
        axes.a * Math.cos(phi) * Math.cos(theta),
        axes.b * Math.sin(phi),
        axes.c * Math.cos(phi) * Math.sin(theta),
      ];

      const n = nEllipsoid(onShell, axes);
      const p: [number, number, number] = [
        onShell[0] + (req.shellOffset ?? 0) * n[0],
        onShell[1] + (req.shellOffset ?? 0) * n[1],
        onShell[2] + (req.shellOffset ?? 0) * n[2],
      ];

      const rho = rhoEllipsoid(p, axes);
      const sd  = rho - 1.0;

      // --- Soft wall envelope (removes hard band cutoff) ---
      const asd = Math.abs(sd);
      const a_band = 2.5 * w_rho, b_band = 3.5 * w_rho; // pass band, stop band
      let wallWin: number;
      if (asd <= a_band) wallWin = 1.0;
      else if (asd >= b_band) wallWin = 0.0;
      else wallWin = 0.5 * (1 + Math.cos(Math.PI * (asd - a_band) / (b_band - a_band))); // smooth to 0

      const bell = Math.exp(- (sd / w_rho) * (sd / w_rho)); // Nat++¡rio canonical bell

      // --- Soft front/back polarity (if needed) ---
      const front = 1.0; // placeholder - can add soft polarity later if needed

      // --- Physics-consistent amplitude with soft clamp ---
      let disp = vizGain * geoAmp * qSpoil * wallWin * bell * sgn * front;

      const maxPush = 0.10;
      const softness = 0.6;
      disp = maxPush * Math.tanh(disp / (softness * maxPush));

      const { dA } = firstFundamentalForm(axes.a, axes.b, axes.c, theta, phi);

      sampleX[idx] = p[0];
      sampleY[idx] = p[1];
      sampleZ[idx] = p[2];
      sampleNX[idx] = n[0];
      sampleNY[idx] = n[1];
      sampleNZ[idx] = n[2];
      sampleRho[idx] = rho;
      sampleBell[idx] = bell;
      sampleSgn[idx] = sgn;
      sampleDisp[idx] = disp;
      sampleDA[idx] = dA;
      idx += 1;
    }
  }

  return {
    length: idx,
    x: sampleX.subarray(0, idx),
    y: sampleY.subarray(0, idx),
    z: sampleZ.subarray(0, idx),
    nx: sampleNX.subarray(0, idx),
    ny: sampleNY.subarray(0, idx),
    nz: sampleNZ.subarray(0, idx),
    rho: sampleRho.subarray(0, idx),
    bell: sampleBell.subarray(0, idx),
    sgn: sampleSgn.subarray(0, idx),
    disp: sampleDisp.subarray(0, idx),
    dA: sampleDA.subarray(0, idx),
  };
}

// Truth sampler that can operate on ellipsoid (legacy), radial profile, or explicit surface samples (SDF/meshes)
export function sampleDisplacementFieldGeometry(state: EnergyPipelineState, req: FieldGeometryRequest = {}): FieldSampleBuffer {
  const geometryKind = req.geometryKind ?? "ellipsoid";
  if (geometryKind === "ellipsoid" || (geometryKind !== "radial" && geometryKind !== "sdf")) {
    return sampleDisplacementField(state, req);
  }

  const hullGeom = resolveHullGeometry(state);
  const a = hullGeom.Lx_m / 2;
  const b = hullGeom.Ly_m / 2;
  const c = hullGeom.Lz_m / 2;
  const axes: HullAxes = { a, b, c };

  const sectors = Math.max(
    1,
    Math.floor(req.sectors ?? state.sectorCount ?? PROMOTED_WARP_PROFILE.sectorCount),
  );
  const split = Number.isFinite(req.split as number) ? Math.max(0, Math.floor(req.split!)) : Math.floor(sectors / 2);

  const aEff = 3 / (1/axes.a + 1/axes.b + 1/axes.c);
  const w_m = req.wallWidth_m ?? Math.max(1e-6, (state.sag_nm ?? 16) * 1e-9);
  const w_rho = Math.max(1e-6, w_m / aEff);
  const gammaGeo = state.gammaGeo ?? PROMOTED_WARP_PROFILE.gammaGeo;
  const qSpoil = state.qSpoilingFactor ?? PROMOTED_WARP_PROFILE.qSpoilingFactor;
  const geoAmp     = Math.pow(gammaGeo, 3);
  const vizGain    = 1.0;
  const shellOffset = req.shellOffset ?? 0;

  const radialReq = req.radial ?? {};
  const nTheta = Math.max(1, radialReq.nTheta ?? req.nTheta ?? 64);
  const nPhi   = Math.max(2, radialReq.nPhi ?? req.nPhi ?? 32);

  const sdfSamples = Array.isArray(req.sdf?.samples) ? req.sdf!.samples : [];
  const radialSamples = Array.isArray(radialReq.samples) ? radialReq.samples : null;
  const totalSamples = geometryKind === "sdf"
    ? sdfSamples.length
    : (radialSamples?.length ?? (nTheta * nPhi));

  ensureFieldSampleCapacity(Math.max(totalSamples, 0));
  let idx = 0;

  const emitSample = (pOn: [number, number, number], nInput: [number, number, number], dAInput?: number, signedDistance_m?: number) => {
    const n = normalizeVec(nInput);
    const p: [number, number, number] = [
      pOn[0] + shellOffset * n[0],
      pOn[1] + shellOffset * n[1],
      pOn[2] + shellOffset * n[2],
    ];
    const radius = vecLen(p);
    const rho = radius / Math.max(aEff, 1e-9);
    const sd_rho = (rho - 1) + ((signedDistance_m ?? 0) / Math.max(aEff, 1e-9));

    const asd = Math.abs(sd_rho);
    const a_band = 2.5 * w_rho, b_band = 3.5 * w_rho;
    let wallWin: number;
    if (asd <= a_band) wallWin = 1.0;
    else if (asd >= b_band) wallWin = 0.0;
    else wallWin = 0.5 * (1 + Math.cos(Math.PI * (asd - a_band) / (b_band - a_band)));

    const bell = Math.exp(- (sd_rho / w_rho) * (sd_rho / w_rho));

    const theta = Math.atan2(p[2], p[0]);
    const sgn = sectorSign(theta, sectors, split);
    let disp = vizGain * geoAmp * qSpoil * wallWin * bell * sgn;

    const maxPush = 0.10;
    const softness = 0.6;
    disp = maxPush * Math.tanh(disp / (softness * maxPush));

    const phi = Math.atan2(p[1], Math.hypot(p[0], p[2]));
    const dThetaApprox = (2 * Math.PI) / Math.max(1, sectors);
    const dPhiApprox = Math.PI / Math.max(1, nPhi - 1);
    const dA = Number.isFinite(dAInput as number) && (dAInput as number) > 0
      ? (dAInput as number)
      : Math.max(1e-12, radius * radius * Math.max(1e-3, Math.cos(phi)) * dThetaApprox * dPhiApprox);

    sampleX[idx] = p[0];
    sampleY[idx] = p[1];
    sampleZ[idx] = p[2];
    sampleNX[idx] = n[0];
    sampleNY[idx] = n[1];
    sampleNZ[idx] = n[2];
    sampleRho[idx] = rho;
    sampleBell[idx] = bell;
    sampleSgn[idx] = sgn;
    sampleDisp[idx] = disp;
    sampleDA[idx] = dA;
    idx += 1;
  };

  if (geometryKind === "sdf" && sdfSamples.length) {
    for (const s of sdfSamples) {
      const n = s.n ? normalizeVec(s.n) : normalizeVec(s.p);
      emitSample(s.p, n, s.dA, s.signedDistance_m);
    }
  } else if (geometryKind === "radial") {
    if (radialSamples && radialSamples.length) {
      for (const s of radialSamples) {
        const theta = Number.isFinite(s.theta) ? (s.theta as number) : 0;
        const phi = Number.isFinite(s.phi) ? (s.phi as number) : 0;
        const dir: [number, number, number] = [
          Math.cos(phi) * Math.cos(theta),
          Math.sin(phi),
          Math.cos(phi) * Math.sin(theta),
        ];
        const r = Number.isFinite(s.r) ? Math.max(1e-9, s.r) : Math.max(1e-9, aEff);
        const pOn: [number, number, number] = [dir[0] * r, dir[1] * r, dir[2] * r];
        emitSample(pOn, s.n ?? dir, s.dA);
      }
    } else {
      const dTheta = (2 * Math.PI) / Math.max(1, nTheta);
      const dPhi = Math.PI / Math.max(1, nPhi - 1);
      for (let i = 0; i < nTheta; i++) {
        const theta = (i / nTheta) * 2 * Math.PI;
        for (let j = 0; j < nPhi; j++) {
          const phi = -Math.PI / 2 + (j / Math.max(1, nPhi - 1)) * Math.PI;
          const dir: [number, number, number] = [
            Math.cos(phi) * Math.cos(theta),
            Math.sin(phi),
            Math.cos(phi) * Math.sin(theta),
          ];
          const evalRadius = radialReq.radiusAt ? radialReq.radiusAt(dir) : undefined;
          let r = typeof evalRadius === "number" ? evalRadius : (evalRadius as any)?.r;
          const nFromEval = (evalRadius as any)?.n;
          const dAOverride = (evalRadius as any)?.dA;
          if (!Number.isFinite(r)) r = aEff;
          const pOn: [number, number, number] = [dir[0] * r, dir[1] * r, dir[2] * r];
          const areaApprox = Math.max(1e-12, r * r * Math.max(1e-3, Math.cos(phi)) * dTheta * dPhi);
          emitSample(pOn, nFromEval ?? dir, Number.isFinite(dAOverride as number) ? (dAOverride as number) : areaApprox);
        }
      }
    }
  }

  return {
    length: idx,
    x: sampleX.subarray(0, idx),
    y: sampleY.subarray(0, idx),
    z: sampleZ.subarray(0, idx),
    nx: sampleNX.subarray(0, idx),
    ny: sampleNY.subarray(0, idx),
    nz: sampleNZ.subarray(0, idx),
    rho: sampleRho.subarray(0, idx),
    bell: sampleBell.subarray(0, idx),
    sgn: sampleSgn.subarray(0, idx),
    disp: sampleDisp.subarray(0, idx),
    dA: sampleDA.subarray(0, idx),
  };
}

export function fieldSamplesToCsv(buffer: FieldSampleBuffer): string {
  const header = ["x","y","z","nx","ny","nz","rho","bell","sgn","disp","dA"].join(",");
  const rows: string[] = new Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    rows[i] = [
      buffer.x[i], buffer.y[i], buffer.z[i],
      buffer.nx[i], buffer.ny[i], buffer.nz[i],
      buffer.rho[i], buffer.bell[i], buffer.sgn[i],
      buffer.disp[i], buffer.dA[i],
    ].join(",");
  }
  return [header, ...rows].join("\n");
}


