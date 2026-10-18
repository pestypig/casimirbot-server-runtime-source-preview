import { performance } from "node:perf_hooks";
import type { ConstraintLoopGate } from "../../../modules/analysis/constraint-loop.js";
import type {
  FeatureWindow,
  NeuroState,
  NeuroStreamKind,
} from "../schemas/neuro.schemas.js";
import {
  computeBandRmsFromWindow,
  computeGammaPlvCrossFromWindows,
  computeGammaPlvFromWindowWithSurrogates,
  deriveGammaPlvZ,
  updateGammaPlvNullBaseline,
  type GammaPlvBand,
  type GammaPlvNullBaseline,
  type GammaPlvSurrogateOptions,
} from "../features/gamma-plv.js";
import {
  NeuroFrameRingBuffer,
  type NeuroFrameWindow,
} from "../sync/ring-buffer.js";

export type NeuroKernelConfig = {
  windowSeconds?: number;
  minSamples?: number;
  minSignalRms?: number;
  maxArtifactRatio?: number;
  artifactAbsMax?: number;
  lockStreakRequired?: number;
  gammaBandHz?: GammaPlvSurrogateOptions["bandHz"];
  gammaAnchorHz?: number;
  gammaAnchorBandwidthHz?: number;
  gammaSurrogateCount?: number;
  gammaSurrogateSeed?: number;
  gammaMinSamples?: number;
  gammaBaselineAlpha?: number;
  gammaBaselineMinCount?: number;
  gammaArtifactRequireEmg?: boolean;
  gammaArtifactEmgPlvMax?: number;
  gammaArtifactEmgBurstRatioMax?: number;
  gammaArtifactEmgBurstBandHz?: GammaPlvBand;
};

type ResolvedNeuroKernelConfig = {
  windowSeconds: number;
  minSamples: number;
  minSignalRms: number;
  maxArtifactRatio: number;
  artifactAbsMax: number;
  lockStreakRequired: number;
  gammaBandHz?: GammaPlvBand;
  gammaAnchorHz?: number;
  gammaAnchorBandwidthHz?: number;
  gammaSurrogateCount: number;
  gammaSurrogateSeed?: number;
  gammaMinSamples: number;
  gammaBaselineAlpha: number;
  gammaBaselineMinCount: number;
  gammaArtifactRequireEmg: boolean;
  gammaArtifactEmgPlvMax: number;
  gammaArtifactEmgBurstRatioMax: number;
  gammaArtifactEmgBurstBandHz: GammaPlvBand;
};

export type NeuroKernelMetrics = {
  sampleCount: number;
  signalRms: number;
  maxAbs: number;
  artifactRatio: number;
  dropoutRate: number;
};

export type NeurostateLoopInput = {
  buffer: NeuroFrameRingBuffer;
  stream: NeuroStreamKind;
  deviceId: string;
  now?: number;
  config?: NeuroKernelConfig;
  lockStreak?: number;
};

export type NeurostateLoopResult = {
  state: NeuroState;
  gate: ConstraintLoopGate;
  window: FeatureWindow | null;
  metrics: NeuroKernelMetrics;
  lockStreak: number;
  lockReason?: string;
};

const DEFAULT_CONFIG: ResolvedNeuroKernelConfig = {
  windowSeconds: 1,
  minSamples: 50,
  minSignalRms: 0.05,
  maxArtifactRatio: 0.08,
  artifactAbsMax: 3,
  lockStreakRequired: 3,
  gammaSurrogateCount: 40,
  gammaMinSamples: 32,
  gammaBaselineAlpha: 0.2,
  gammaBaselineMinCount: 0,
  gammaArtifactRequireEmg: false,
  gammaArtifactEmgPlvMax: 0.3,
  gammaArtifactEmgBurstRatioMax: 0.6,
  gammaArtifactEmgBurstBandHz: { lowHz: 70, highHz: 110 },
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const computeMetrics = (
  frames: ReadonlyArray<{
    samples: number[][];
  }>,
  artifactAbsMax: number,
): NeuroKernelMetrics => {
  let sampleCount = 0;
  let sumSq = 0;
  let maxAbs = 0;
  let artifactHits = 0;
  for (const frame of frames) {
    for (const channel of frame.samples) {
      for (const value of channel) {
        sampleCount += 1;
        sumSq += value * value;
        const abs = Math.abs(value);
        if (abs > maxAbs) {
          maxAbs = abs;
        }
        if (abs >= artifactAbsMax) {
          artifactHits += 1;
        }
      }
    }
  }
  const signalRms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0;
  const artifactRatio = sampleCount > 0 ? artifactHits / sampleCount : 1;
  const dropoutRate = sampleCount > 0 ? 0 : 1;
  return {
    sampleCount,
    signalRms,
    maxAbs,
    artifactRatio,
    dropoutRate,
  };
};

const evaluateGate = (
  metrics: NeuroKernelMetrics,
  config: ResolvedNeuroKernelConfig,
): { gate: ConstraintLoopGate; reason?: string } => {
  if (metrics.sampleCount < config.minSamples) {
    return {
      gate: {
        status: "fail",
        residuals: {
          sampleCount: metrics.sampleCount,
          minSamples: config.minSamples,
        },
        note: "insufficient-samples",
      },
      reason: "insufficient-samples",
    };
  }
  if (metrics.artifactRatio > config.maxArtifactRatio) {
    return {
      gate: {
        status: "fail",
        residuals: {
          artifactRatio: metrics.artifactRatio,
          maxArtifactRatio: config.maxArtifactRatio,
        },
        note: "artifact",
      },
      reason: "artifact",
    };
  }
  if (metrics.signalRms < config.minSignalRms) {
    return {
      gate: {
        status: "fail",
        residuals: {
          signalRms: metrics.signalRms,
          minSignalRms: config.minSignalRms,
        },
        note: "low-signal",
      },
      reason: "low-signal",
    };
  }
  return {
    gate: {
      status: "pass",
      residuals: {
        signalRms: metrics.signalRms,
        artifactRatio: metrics.artifactRatio,
        sampleCount: metrics.sampleCount,
      },
    },
  };
};

type GammaArtifactGate = {
  pass: boolean;
  reason?: string;
  emgGammaPlv?: number;
  emgBurstRatio?: number;
  emgBurstRms?: number;
  emgSignalRms?: number;
};

const evaluateGammaArtifactGate = (input: {
  eegWindow: NeuroFrameWindow | null;
  emgWindow: NeuroFrameWindow | null;
  config: ResolvedNeuroKernelConfig;
}): GammaArtifactGate => {
  const requireEmg = input.config.gammaArtifactRequireEmg;
  if (!input.eegWindow) {
    return { pass: true, reason: "eeg-missing" };
  }
  if (!input.emgWindow) {
    return {
      pass: !requireEmg,
      reason: requireEmg ? "emg-missing" : "emg-unavailable",
    };
  }
  const emgMetrics = computeMetrics(
    input.emgWindow.frames,
    input.config.artifactAbsMax,
  );
  if (emgMetrics.sampleCount < input.config.minSamples) {
    return {
      pass: !requireEmg,
      reason: "emg-insufficient",
      emgSignalRms: emgMetrics.signalRms,
    };
  }
  const cross = computeGammaPlvCrossFromWindows(
    input.eegWindow,
    input.emgWindow,
    {
      bandHz: input.config.gammaBandHz,
      anchorHz: input.config.gammaAnchorHz,
      anchorBandwidthHz: input.config.gammaAnchorBandwidthHz,
      minSamples: input.config.gammaMinSamples,
    },
  );
  const burstBand = input.config.gammaArtifactEmgBurstBandHz;
  const burstRms = burstBand
    ? computeBandRmsFromWindow(input.emgWindow, burstBand, {
        minSamples: input.config.gammaMinSamples,
      })
    : null;
  if (!cross || burstRms === null) {
    return {
      pass: !requireEmg,
      reason: "emg-insufficient",
      emgGammaPlv: cross?.plv,
      emgBurstRms: burstRms ?? undefined,
      emgSignalRms: emgMetrics.signalRms,
    };
  }
  const emgSignalRms = emgMetrics.signalRms;
  const burstRatio = emgSignalRms > 0 ? burstRms / emgSignalRms : 0;
  const pass =
    cross.plv <= input.config.gammaArtifactEmgPlvMax &&
    burstRatio <= input.config.gammaArtifactEmgBurstRatioMax;
  return {
    pass,
    reason: pass ? undefined : "gamma-artifact",
    emgGammaPlv: cross.plv,
    emgBurstRatio: burstRatio,
    emgBurstRms: burstRms,
    emgSignalRms,
  };
};

export const runNeurostateLoop = (
  input: NeurostateLoopInput,
): NeurostateLoopResult => {
  const config: ResolvedNeuroKernelConfig = {
    ...DEFAULT_CONFIG,
    ...(input.config ?? {}),
  };
  const now = input.now ?? performance.now();
  const window = input.buffer.getLatestWindow({
    stream: input.stream,
    deviceId: input.deviceId,
    windowSeconds: config.windowSeconds,
    now,
  });
  const metrics = computeMetrics(window?.frames ?? [], config.artifactAbsMax);
  const { gate, reason } = evaluateGate(metrics, config);
  const prevLockStreak = input.lockStreak ?? 0;
  const nextLockStreak = gate.status === "pass" ? prevLockStreak + 1 : 0;
  const locked =
    gate.status === "pass" && nextLockStreak >= config.lockStreakRequired;
  const lockReason = locked ? undefined : reason ?? "lock-streak";
  const featureWindow: FeatureWindow | null = window
    ? {
        tsStart: window.tsStart,
        tsEnd: window.tsEnd,
        stream: window.stream,
        features: {
          signalRms: metrics.signalRms,
          maxAbs: metrics.maxAbs,
          sampleCount: metrics.sampleCount,
        },
        artifacts: {
          artifactRatio: metrics.artifactRatio,
          dropoutRate: metrics.dropoutRate,
        },
        quality: {
          dropoutRate: metrics.dropoutRate,
          confidence: gate.status === "pass" ? 1 : 0,
        },
      }
    : null;
  const state: NeuroState = {
    ts: window?.tsEnd ?? now,
    locked,
    lockReason,
    artifactScores: {
      artifactRatio: metrics.artifactRatio,
      dropoutRate: metrics.dropoutRate,
    },
    summary: {
      signalRms: metrics.signalRms,
      maxAbs: metrics.maxAbs,
      sampleCount: metrics.sampleCount,
      lockStreak: nextLockStreak,
    },
  };
  return {
    state,
    gate,
    window: featureWindow,
    metrics,
    lockStreak: nextLockStreak,
    lockReason,
  };
};

export class NeurostateKernel {
  private lockStreak = 0;
  private config: NeuroKernelConfig;
  private buffer: NeuroFrameRingBuffer;
  private gammaBaseline: GammaPlvNullBaseline | null = null;

  constructor(buffer: NeuroFrameRingBuffer, config: NeuroKernelConfig = {}) {
    this.buffer = buffer;
    this.config = config;
  }

  updateConfig(next: NeuroKernelConfig): void {
    this.config = { ...this.config, ...next };
  }

  reset(): void {
    this.lockStreak = 0;
    this.gammaBaseline = null;
  }

  getGammaBaseline(): GammaPlvNullBaseline | null {
    return this.gammaBaseline;
  }

  setGammaBaseline(next: GammaPlvNullBaseline | null): void {
    this.gammaBaseline = next;
  }

  tick(input: {
    stream: NeuroStreamKind;
    deviceId: string;
    now?: number;
  }): NeurostateLoopResult {
    const now = input.now ?? performance.now();
    const config: ResolvedNeuroKernelConfig = {
      ...DEFAULT_CONFIG,
      ...(this.config ?? {}),
    };
    const rawWindow = this.buffer.getLatestWindow({
      stream: input.stream,
      deviceId: input.deviceId,
      windowSeconds: config.windowSeconds,
      now,
    });
    const result = runNeurostateLoop({
      buffer: this.buffer,
      stream: input.stream,
      deviceId: input.deviceId,
      now,
      config,
      lockStreak: this.lockStreak,
    });
    const baselineGateEnabled = config.gammaBaselineMinCount > 0;
    let gammaBaselineCount = this.gammaBaseline?.count ?? 0;
    let gammaBaselineReady = !baselineGateEnabled;
    let gammaBaselineProgress = baselineGateEnabled
      ? clamp01(gammaBaselineCount / config.gammaBaselineMinCount)
      : 1;
    const updateBaselineState = () => {
      gammaBaselineCount = this.gammaBaseline?.count ?? 0;
      if (baselineGateEnabled) {
        const denom = Math.max(1, config.gammaBaselineMinCount);
        gammaBaselineProgress = clamp01(gammaBaselineCount / denom);
        gammaBaselineReady = gammaBaselineCount >= config.gammaBaselineMinCount;
      } else {
        gammaBaselineReady = true;
        gammaBaselineProgress = 1;
      }
    };
    updateBaselineState();

    const gammaStats = computeGammaPlvFromWindowWithSurrogates(rawWindow, {
      bandHz: config.gammaBandHz,
      anchorHz: config.gammaAnchorHz,
      anchorBandwidthHz: config.gammaAnchorBandwidthHz,
      surrogateCount: config.gammaSurrogateCount,
      surrogateSeed: config.gammaSurrogateSeed,
      minSamples: config.gammaMinSamples,
    });
    if (gammaStats) {
      this.gammaBaseline = updateGammaPlvNullBaseline(
        this.gammaBaseline,
        gammaStats,
        { alpha: config.gammaBaselineAlpha },
      );
      updateBaselineState();
      const baseline =
        this.gammaBaseline ?? {
          mean: gammaStats.nullMean,
          std: gammaStats.nullStd,
          count: gammaStats.surrogateCount,
        };
      const gammaSync = gammaStats.plv;
      const gammaSyncZ = deriveGammaPlvZ(
        gammaSync,
        baseline.mean,
        baseline.std,
      );
      const gammaValid =
        gammaStats.channelCount >= 2 &&
        gammaStats.sampleCount >= config.gammaMinSamples;
      const gammaDispersion = gammaValid
        ? clamp01(1 - gammaSync)
        : undefined;
      const coherence: Record<string, number> = {
        ...(result.state.coherence ?? {}),
        gamma_sync: gammaSync,
        gamma_sync_z: gammaSyncZ,
        gamma_sync_null_mean: baseline.mean,
        gamma_sync_null_std: baseline.std,
      };
      if (gammaDispersion !== undefined) {
        coherence.phase_dispersion = gammaDispersion;
      }
      const summary: Record<string, number> = {
        ...result.state.summary,
        gamma_sync: gammaSync,
        gamma_sync_z: gammaSyncZ,
      };
      if (gammaDispersion !== undefined) {
        summary.phase_dispersion = gammaDispersion;
      }
      result.state = {
        ...result.state,
        phase_dispersion: gammaDispersion,
        gamma_sync: gammaSync,
        gamma_sync_z: gammaSyncZ,
        gamma_sync_null_mean: baseline.mean,
        gamma_sync_null_std: baseline.std,
        coherence,
        summary,
      };
      if (result.window) {
        const features: Record<string, number> = {
          ...result.window.features,
          gamma_sync: gammaSync,
          gamma_sync_z: gammaSyncZ,
          gamma_sync_null_mean: baseline.mean,
          gamma_sync_null_std: baseline.std,
        };
        if (gammaDispersion !== undefined) {
          features.phase_dispersion = gammaDispersion;
        }
        result.window = {
          ...result.window,
          features,
        };
      }
    }

    if (baselineGateEnabled) {
      const baselineReadyScore = gammaBaselineReady ? 1 : 0;
      const artifactScores: Record<string, number> = {
        ...result.state.artifactScores,
        gamma_baseline_ready: baselineReadyScore,
        gamma_baseline_progress: gammaBaselineProgress,
      };
      const summary: Record<string, number> = {
        ...result.state.summary,
        gamma_baseline_ready: baselineReadyScore,
        gamma_baseline_progress: gammaBaselineProgress,
        gamma_baseline_count: gammaBaselineCount,
      };
      result.state = {
        ...result.state,
        gamma_baseline_ready: baselineReadyScore,
        gamma_baseline_progress: gammaBaselineProgress,
        gamma_baseline_count: gammaBaselineCount,
        artifactScores,
        summary,
      };
      if (result.window) {
        const artifacts: Record<string, number> = {
          ...result.window.artifacts,
          gamma_baseline_ready: baselineReadyScore,
          gamma_baseline_progress: gammaBaselineProgress,
        };
        result.window = {
          ...result.window,
          artifacts,
        };
      }
    }
    if (input.stream === "eeg") {
      const emgWindow = rawWindow
        ? this.buffer.getWindow({
            stream: "emg",
            deviceId: input.deviceId,
            tsStart: rawWindow.tsStart,
            tsEnd: rawWindow.tsEnd,
          })
        : null;
      const gammaArtifact = evaluateGammaArtifactGate({
        eegWindow: rawWindow,
        emgWindow,
        config,
      });
      const baselineGate = baselineGateEnabled && !gammaBaselineReady;
      const gammaArtifactPass = gammaArtifact.pass && !baselineGate;
      const gammaArtifactPassValue = gammaArtifactPass ? 1 : 0;
      const gammaArtifactReason = !gammaArtifact.pass
        ? gammaArtifact.reason ?? "gamma-artifact"
        : baselineGate
          ? "gamma-baseline"
          : undefined;
      const emgGammaPlv = Number.isFinite(gammaArtifact.emgGammaPlv)
        ? (gammaArtifact.emgGammaPlv as number)
        : undefined;
      const emgBurstRatio = Number.isFinite(gammaArtifact.emgBurstRatio)        
        ? (gammaArtifact.emgBurstRatio as number)
        : undefined;
      const artifactScores: Record<string, number> = {
        ...result.state.artifactScores,
        gamma_artifact_pass: gammaArtifactPassValue,
      };
      if (emgGammaPlv !== undefined) {
        artifactScores.gamma_emg_plv = emgGammaPlv;
      }
      if (emgBurstRatio !== undefined) {
        artifactScores.gamma_emg_burst_ratio = emgBurstRatio;
      }
      const coherence: Record<string, number> = {
        ...(result.state.coherence ?? {}),
      };
      if (emgGammaPlv !== undefined) {
        coherence.gamma_emg_plv = emgGammaPlv;
      }
      let summary: Record<string, number> = {
        ...result.state.summary,
        gamma_artifact_pass: gammaArtifactPassValue,
      };
      if (emgGammaPlv !== undefined) {
        summary = {
          ...summary,
          gamma_emg_plv: emgGammaPlv,
        };
      }
      if (emgBurstRatio !== undefined) {
        summary = {
          ...summary,
          gamma_emg_burst_ratio: emgBurstRatio,
        };
      }
      if (!gammaArtifactPass) {
        summary = {
          ...summary,
          lockStreak: 0,
        };
      }
      result.state = {
        ...result.state,
        gamma_artifact_pass: gammaArtifactPassValue,
        gamma_emg_plv: emgGammaPlv,
        gamma_emg_burst_ratio: emgBurstRatio,
        artifactScores,
        coherence,
        summary,
      };
      if (result.window) {
        const artifacts: Record<string, number> = {
          ...result.window.artifacts,
          gamma_artifact_pass: gammaArtifactPassValue,
        };
        if (emgGammaPlv !== undefined) {
          artifacts.gamma_emg_plv = emgGammaPlv;
        }
        if (emgBurstRatio !== undefined) {
          artifacts.gamma_emg_burst_ratio = emgBurstRatio;
        }
        const quality = gammaArtifactPass
          ? result.window.quality
          : { ...result.window.quality, confidence: 0 };
        result.window = {
          ...result.window,
          artifacts,
          quality,
        };
      }
      if (!gammaArtifactPass) {
        result.lockStreak = 0;
        result.lockReason = gammaArtifactReason ?? "gamma-artifact";
        const residuals: Record<string, number> = {
          ...result.gate.residuals,
          gamma_artifact_pass: gammaArtifactPassValue,
        };
        if (baselineGateEnabled) {
          residuals.gamma_baseline_ready = gammaBaselineReady ? 1 : 0;
        }
        if (emgGammaPlv !== undefined) {
          residuals.gamma_emg_plv = emgGammaPlv;
        }
        if (emgBurstRatio !== undefined) {
          residuals.gamma_emg_burst_ratio = emgBurstRatio;
        }
        result.gate = {
          status: "fail",
          residuals,
          note: gammaArtifactReason ?? "gamma-artifact",
        };
        result.state = {
          ...result.state,
          locked: false,
          lockReason: result.lockReason,
        };
      }
    }
    this.lockStreak = result.lockStreak;
    return result;
  }
}
