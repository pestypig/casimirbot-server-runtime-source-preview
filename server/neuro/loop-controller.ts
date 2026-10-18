import type { NeuroDriver } from "./drivers/driver.base.js";
import { NeuroSimulatorDriver, type NeuroSimulatorOptions } from "./drivers/driver.simulator.js";
import type { NeuroFrame, NeuroState, NeuroStreamKind } from "./schemas/neuro.schemas.js";
import { NeuroFrameRingBuffer } from "./sync/ring-buffer.js";
import { NeurostateKernel, type NeuroKernelConfig } from "./kernel/neurostate-loop.js";
import {
  DEFAULT_GAMMA_BAND,
  type GammaPlvBand,
} from "./features/gamma-plv.js";
import {
  buildGammaBaselineKey,
  createFileBaselineStore,
  type GammaBaselineRecord,
  type GammaBaselineStore,
} from "./baseline-store.js";
import {
  CalibrationSession,
  type CalibrationSummary,
  saveCalibrationSummary,
} from "./calibration-session.js";
import {
  ingestNeuroFeatures,
  type NeuroFeaturePayload,
} from "./feature-bridge.js";

type NeuroLoopDriverConfig = {
  kind: "sim";
  options?: NeuroSimulatorOptions;
};

type NeuroLoopBaselineConfig = {
  persist?: boolean;
  storePath?: string;
  minCount?: number;
  persistIntervalMs?: number;
  key?: string;
};

export type NeuroLoopStartOptions = {
  sessionId?: string;
  sessionType?: string;
  hostMode?: string;
  hostId?: string;
  hostMassNorm?: number;
  hostRadiusNorm?: number;
  stream?: NeuroStreamKind;
  deviceId?: string;
  postIntervalMs?: number;
  ringBufferSeconds?: number;
  kernel?: NeuroKernelConfig;
  driver?: NeuroLoopDriverConfig;
  driverInstance?: NeuroDriver;
  baseline?: NeuroLoopBaselineConfig;
};

type ResolvedNeuroLoopConfig = {
  sessionId: string;
  sessionType: string;
  hostMode: string;
  hostId?: string;
  hostMassNorm?: number;
  hostRadiusNorm?: number;
  stream: NeuroStreamKind;
  deviceId: string;
  postIntervalMs: number;
  ringBufferSeconds: number;
  kernel: NeuroKernelConfig;
};

export type NeuroLoopStatus = {
  running: boolean;
  driver?: { kind: string; id: string };
  sessionId?: string;
  sessionType?: string;
  hostMode?: string;
  hostId?: string;
  stream?: NeuroStreamKind;
  deviceId?: string;
  postIntervalMs?: number;
  ringBufferSeconds?: number;
  lastFrameAt?: number;
  lastPostAt?: number;
  lastError?: string;
  lastFeature?: NeuroFeaturePayload;
  lastState?: {
    locked?: boolean;
    lockReason?: string;
    gamma_sync_z?: number;
    phase_dispersion?: number;
    gamma_artifact_pass?: number;
    gamma_baseline_ready?: number;
    gamma_baseline_progress?: number;
    gamma_baseline_count?: number;
  };
  baseline?: {
    enabled?: boolean;
    key?: string;
    minCount?: number;
    ready?: boolean;
    progress?: number;
    count?: number;
    persist?: boolean;
    persistIntervalMs?: number;
    lastSavedAt?: number;
    lastError?: string;
  };
  calibration?: {
    active: boolean;
    label?: string;
    startedAt?: number;
    updateCount?: number;
    sampleTotal?: number;
    lastSummary?: CalibrationSummary;
    lastSavedPath?: string;
  };
};

type PostFn = (payload: NeuroFeaturePayload) => Promise<unknown> | unknown;

const DEFAULT_POST_INTERVAL_MS = 250;
const DEFAULT_WINDOW_SECONDS = 1;
const DEFAULT_BASELINE_PERSIST_INTERVAL_MS = 15000;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const resolveStream = (value?: NeuroStreamKind): NeuroStreamKind =>
  value ?? "eeg";

const resolveSessionType = (value?: string): string =>
  value?.trim() ? value.trim() : "lab";

const resolveHostMode = (value?: string): string =>
  value?.trim() ? value.trim() : "brain_like";

const resolvePostIntervalMs = (
  postIntervalMs: number | undefined,
  windowSeconds: number,
): number => {
  if (Number.isFinite(postIntervalMs) && (postIntervalMs as number) >= 0) {     
    return Math.round(postIntervalMs as number);
  }
  return Math.max(100, Math.round(windowSeconds * DEFAULT_POST_INTERVAL_MS));   
};

const resolveGammaBand = (config: NeuroKernelConfig): GammaPlvBand => {
  if (Number.isFinite(config.gammaAnchorHz ?? NaN)) {
    const anchor = config.gammaAnchorHz as number;
    const width = Math.max(1, config.gammaAnchorBandwidthHz ?? 10);
    const half = width / 2;
    const low = Math.max(0.1, anchor - half);
    const high = Math.max(low + 1, anchor + half);
    return { lowHz: low, highHz: high };
  }
  return config.gammaBandHz ?? DEFAULT_GAMMA_BAND;
};

const resolveBaselinePersistInterval = (
  value?: number,
): number => {
  if (Number.isFinite(value ?? NaN) && (value as number) > 0) {
    return Math.max(1000, Math.round(value as number));
  }
  return DEFAULT_BASELINE_PERSIST_INTERVAL_MS;
};

const resolveBaselineMinCount = (
  value?: number,
): number | undefined => {
  if (!Number.isFinite(value ?? NaN)) return undefined;
  return Math.max(0, Math.round(value as number));
};

const buildArtifactFlags = (
  state: NeuroState,
): Record<string, number> | undefined => {
  const flags: Record<string, number> = {};
  const add = (key: string, value?: number) => {
    if (!Number.isFinite(value ?? NaN)) return;
    flags[key] = clamp01(value as number);
  };
  add("gamma_artifact_pass", state.gamma_artifact_pass);
  add("gamma_baseline_ready", state.gamma_baseline_ready);
  add("gamma_baseline_progress", state.gamma_baseline_progress);
  add("gamma_emg_plv", state.gamma_emg_plv);
  add("gamma_emg_burst_ratio", state.gamma_emg_burst_ratio);
  add("artifact_ratio", state.artifactScores?.artifactRatio);
  add("dropout_rate", state.artifactScores?.dropoutRate);
  return Object.keys(flags).length ? flags : undefined;
};

const buildStateSummary = (state?: NeuroState) => {
  if (!state) return undefined;
  return {
    locked: state.locked,
    lockReason: state.lockReason,
    gamma_sync_z: state.gamma_sync_z,
    phase_dispersion: state.phase_dispersion,
    gamma_artifact_pass: state.gamma_artifact_pass,
    gamma_baseline_ready: state.gamma_baseline_ready,
    gamma_baseline_progress: state.gamma_baseline_progress,
    gamma_baseline_count: state.gamma_baseline_count,
  };
};

const resolveDriver = (
  config: ResolvedNeuroLoopConfig,
  driverConfig?: NeuroLoopDriverConfig,
  driverInstance?: NeuroDriver,
): NeuroDriver => {
  if (driverInstance) return driverInstance;
  const resolved = driverConfig ?? { kind: "sim" };
  if (resolved.kind === "sim") {
    return new NeuroSimulatorDriver({
      ...(resolved.options ?? {}),
      stream: config.stream,
      deviceId: config.deviceId,
    });
  }
  throw new Error(`unsupported_neuro_driver:${resolved.kind}`);
};

export class NeuroLoopController {
  private running = false;
  private config: ResolvedNeuroLoopConfig | null = null;
  private buffer: NeuroFrameRingBuffer | null = null;
  private kernel: NeurostateKernel | null = null;
  private driver: NeuroDriver | null = null;
  private unsubscribeFrame: (() => void) | null = null;
  private lastFrameAt?: number;
  private lastPostAt?: number;
  private lastPostMono?: number;
  private lastError?: string;
  private lastFeature?: NeuroFeaturePayload;
  private lastState?: NeuroState;
  private baselineStore: GammaBaselineStore | null = null;
  private baselineKey?: string;
  private baselinePersistIntervalMs = DEFAULT_BASELINE_PERSIST_INTERVAL_MS;
  private baselinePersistEnabled = false;
  private baselineMinCount?: number;
  private baselineLastSavedAt?: number;
  private baselineLastCount?: number;
  private baselineLastError?: string;
  private baselineSaving = false;
  private lastSampleRateHz?: number;
  private calibration: CalibrationSession | null = null;
  private lastCalibrationSummary?: CalibrationSummary;
  private lastCalibrationSavedPath?: string;
  private inflight = false;
  private postFn: PostFn;

  constructor(options: { postFn?: PostFn } = {}) {
    this.postFn = options.postFn ?? ((payload) => ingestNeuroFeatures(payload));
  }

  async start(options: NeuroLoopStartOptions): Promise<NeuroLoopStatus> {
    await this.stop();
    const stream = resolveStream(options.stream);
    const deviceId = options.deviceId?.trim() || options.driver?.options?.deviceId || "neuro-loop";
    const kernelConfig: NeuroKernelConfig = {
      ...(options.kernel ?? {}),
    };
    const baselineOptions = options.baseline ?? {};
    const baselineMinCount = resolveBaselineMinCount(
      baselineOptions.minCount ?? kernelConfig.gammaBaselineMinCount,
    );
    if (baselineMinCount !== undefined) {
      kernelConfig.gammaBaselineMinCount = baselineMinCount;
    }
    if (!Number.isFinite(kernelConfig.windowSeconds ?? NaN)) {
      kernelConfig.windowSeconds = DEFAULT_WINDOW_SECONDS;
    }
    const windowSeconds = kernelConfig.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
    const ringBufferSeconds =
      Number.isFinite(options.ringBufferSeconds ?? NaN)
        ? Math.max(1, options.ringBufferSeconds as number)
        : Math.max(5, Math.round(windowSeconds * 6));
    const postIntervalMs = resolvePostIntervalMs(
      options.postIntervalMs,
      windowSeconds,
    );
    const sessionId =
      options.sessionId?.trim() ||
      `neuro-${deviceId}`;
    const resolved: ResolvedNeuroLoopConfig = {
      sessionId,
      sessionType: resolveSessionType(options.sessionType),
      hostMode: resolveHostMode(options.hostMode),
      hostId: options.hostId,
      hostMassNorm: options.hostMassNorm,
      hostRadiusNorm: options.hostRadiusNorm,
      stream,
      deviceId,
      postIntervalMs,
      ringBufferSeconds,
      kernel: kernelConfig,
    };
    this.config = resolved;
    this.buffer = new NeuroFrameRingBuffer({ maxSeconds: ringBufferSeconds });
    this.kernel = new NeurostateKernel(this.buffer, kernelConfig);
    this.lastSampleRateHz = undefined;
    this.baselinePersistEnabled =
      baselineOptions.persist === true || !!baselineOptions.storePath;
    this.baselinePersistIntervalMs = resolveBaselinePersistInterval(
      baselineOptions.persistIntervalMs,
    );
    this.baselineMinCount = baselineMinCount;
    this.baselineLastSavedAt = undefined;
    this.baselineLastCount = undefined;
    this.baselineLastError = undefined;
    this.baselineSaving = false;
    this.baselineKey = undefined;
    this.baselineStore = null;
    if (this.baselinePersistEnabled) {
      const bandHz = resolveGammaBand(kernelConfig);
      const baselineKey =
        baselineOptions.key?.trim() ||
        buildGammaBaselineKey({
          stream,
          deviceId,
          bandHz,
          anchorHz: kernelConfig.gammaAnchorHz,
          anchorBandwidthHz: kernelConfig.gammaAnchorBandwidthHz,
        });
      this.baselineKey = baselineKey;
      this.baselineStore = createFileBaselineStore(
        baselineOptions.storePath ?? undefined,
      );
      try {
        const record = await this.baselineStore.load(baselineKey);
        if (record?.baseline) {
          this.kernel.setGammaBaseline(record.baseline);
          this.baselineLastSavedAt = record.updatedAt;
          this.baselineLastCount = record.baseline.count;
        }
      } catch (error) {
        this.baselineLastError =
          error instanceof Error ? error.message : String(error);
      }
    }
    this.calibration = null;
    this.lastCalibrationSummary = undefined;
    this.lastCalibrationSavedPath = undefined;
    this.driver = resolveDriver(resolved, options.driver, options.driverInstance);
    this.unsubscribeFrame = this.driver.onFrame((frame) => {
      this.handleFrame(frame);
    });
    await this.driver.start();
    this.running = true;
    this.lastError = undefined;
    return this.getStatus();
  }

  async stop(): Promise<NeuroLoopStatus> {
    if (this.unsubscribeFrame) {
      this.unsubscribeFrame();
      this.unsubscribeFrame = null;
    }
    if (this.driver) {
      await this.driver.stop();
      this.driver = null;
    }
    await this.persistBaseline(true);
    if (this.calibration) {
      this.lastCalibrationSummary = this.calibration.finish(Date.now());
      this.calibration = null;
    }
    this.running = false;
    return this.getStatus();
  }

  getStatus(): NeuroLoopStatus {
    const baselineReady =
      typeof this.lastState?.gamma_baseline_ready === "number"
        ? this.lastState.gamma_baseline_ready >= 0.5
        : undefined;
    const calibrationActive = this.calibration !== null;
    return {
      running: this.running,
      driver: this.driver ? { kind: this.driver.kind, id: this.driver.id } : undefined,
      sessionId: this.config?.sessionId,
      sessionType: this.config?.sessionType,
      hostMode: this.config?.hostMode,
      hostId: this.config?.hostId,
      stream: this.config?.stream,
      deviceId: this.config?.deviceId,
      postIntervalMs: this.config?.postIntervalMs,
      ringBufferSeconds: this.config?.ringBufferSeconds,
      lastFrameAt: this.lastFrameAt,
      lastPostAt: this.lastPostAt,
      lastError: this.lastError,
      lastFeature: this.lastFeature,
      lastState: buildStateSummary(this.lastState),
      baseline: {
        enabled: (this.baselineMinCount ?? 0) > 0,
        key: this.baselineKey,
        minCount: this.baselineMinCount,
        ready: baselineReady,
        progress: this.lastState?.gamma_baseline_progress,
        count: this.lastState?.gamma_baseline_count,
        persist: this.baselinePersistEnabled,
        persistIntervalMs: this.baselinePersistIntervalMs,
        lastSavedAt: this.baselineLastSavedAt,
        lastError: this.baselineLastError,
      },
      calibration: {
        active: calibrationActive,
        label: this.calibration?.label,
        startedAt: this.calibration?.startedAt,
        updateCount: this.calibration?.getUpdateCount(),
        sampleTotal: this.calibration?.getSampleTotal(),
        lastSummary: this.lastCalibrationSummary,
        lastSavedPath: this.lastCalibrationSavedPath,
      },
    };
  }

  startCalibration(options: { label?: string } = {}): NeuroLoopStatus {
    if (!this.running || !this.config) {
      throw new Error("neuro_loop_not_running");
    }
    this.calibration = new CalibrationSession({
      sessionId: this.config.sessionId,
      label: options.label,
      stream: this.config.stream,
      deviceId: this.config.deviceId,
    });
    return this.getStatus();
  }

  async stopCalibration(options: {
    save?: boolean;
    path?: string;
  } = {}): Promise<{
    summary: CalibrationSummary;
    savedPath?: string;
    status: NeuroLoopStatus;
  }> {
    if (!this.calibration) {
      throw new Error("calibration_not_active");
    }
    const summary = this.calibration.finish(Date.now());
    this.lastCalibrationSummary = summary;
    this.calibration = null;
    const save = options.save ?? true;
    let savedPath: string | undefined;
    if (save) {
      savedPath = await saveCalibrationSummary(summary, options.path);
      this.lastCalibrationSavedPath = savedPath;
    } else {
      this.lastCalibrationSavedPath = undefined;
    }
    return { summary, savedPath, status: this.getStatus() };
  }

  private async persistBaseline(force: boolean): Promise<void> {
    if (
      !this.baselinePersistEnabled ||
      !this.baselineStore ||
      !this.kernel ||
      !this.config ||
      !this.baselineKey
    ) {
      return;
    }
    const baseline = this.kernel.getGammaBaseline();
    if (!baseline) return;
    const now = Date.now();
    const count = baseline.count;
    const intervalElapsed =
      force ||
      !this.baselineLastSavedAt ||
      now - this.baselineLastSavedAt >= this.baselinePersistIntervalMs;
    const countChanged = count !== this.baselineLastCount;
    if (!force && (!intervalElapsed || !countChanged)) return;
    if (this.baselineSaving) return;
    this.baselineSaving = true;
    const record: GammaBaselineRecord = {
      id: this.baselineKey,
      stream: this.config.stream,
      deviceId: this.config.deviceId,
      bandHz: resolveGammaBand(this.config.kernel),
      anchorHz: this.config.kernel.gammaAnchorHz,
      anchorBandwidthHz: this.config.kernel.gammaAnchorBandwidthHz,
      sampleRateHz: this.lastSampleRateHz,
      windowSeconds: this.config.kernel.windowSeconds,
      baseline,
      updatedAt: now,
    };
    try {
      await this.baselineStore.save(record);
      this.baselineLastSavedAt = now;
      this.baselineLastCount = count;
      this.baselineLastError = undefined;
    } catch (error) {
      this.baselineLastError =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.baselineSaving = false;
    }
  }

  private handleFrame(frame: NeuroFrame): void {
    if (!this.running || !this.buffer || !this.kernel || !this.config) {
      return;
    }
    if (frame.stream !== this.config.stream || frame.deviceId !== this.config.deviceId) {
      return;
    }
    this.lastSampleRateHz = frame.sampleRateHz;
    this.buffer.push(frame);
    this.lastFrameAt = Date.now();
    const nowMono = frame.tsAligned ?? frame.tsRecvMono;
    const shouldPost =
      !Number.isFinite(this.lastPostMono ?? NaN) ||
      (nowMono as number) - (this.lastPostMono as number) >= this.config.postIntervalMs;
    if (!shouldPost) return;

    const result = this.kernel.tick({
      stream: this.config.stream,
      deviceId: this.config.deviceId,
      now: nowMono,
    });
    this.lastState = result.state;
    if (this.calibration) {
      this.calibration.record(
        {
          gamma_sync_z: result.state.gamma_sync_z,
          gamma_sync: result.state.gamma_sync,
          phase_dispersion: result.state.phase_dispersion,
          gamma_artifact_pass: result.state.gamma_artifact_pass,
          gamma_emg_plv: result.state.gamma_emg_plv,
          gamma_emg_burst_ratio: result.state.gamma_emg_burst_ratio,
          artifact_ratio: result.metrics.artifactRatio,
          dropout_rate: result.metrics.dropoutRate,
          signal_rms: result.metrics.signalRms,
          max_abs: result.metrics.maxAbs,
        },
        result.metrics.sampleCount,
      );
    }
    void this.persistBaseline(false);
    const artifactFlags = buildArtifactFlags(result.state);
    const payload: NeuroFeaturePayload = {
      session_id: this.config.sessionId,
      session_type: this.config.sessionType,
      device_id: this.config.deviceId,
      host_id: this.config.hostId,
      host_mode: this.config.hostMode,
      host_mass_norm: this.config.hostMassNorm,
      host_radius_norm: this.config.hostRadiusNorm,
      gamma_sync_z: result.state.gamma_sync_z,
      phase_dispersion: result.state.phase_dispersion,
      artifact_flags: artifactFlags,
      sample_count: result.metrics.sampleCount,
      timestamp: Date.now(),
      origin: "system",
    };
    this.lastPostMono = nowMono as number;
    this.lastPostAt = Date.now();
    this.lastFeature = payload;
    if (this.inflight) {
      return;
    }
    try {
      const result = this.postFn(payload);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        this.inflight = true;
        (result as Promise<unknown>)
          .catch((error) => {
            this.lastError = error instanceof Error ? error.message : String(error);
          })
          .finally(() => {
            this.inflight = false;
          });
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}

const readNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const readBool = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return undefined;
};

export const neuroLoopController = new NeuroLoopController();

export const autoStartNeuroLoopFromEnv = async (): Promise<void> => {
  if (process.env.NEURO_LOOP_AUTO_START !== "1") {
    return;
  }
  if (neuroLoopController.getStatus().running) {
    return;
  }
  const windowSeconds = readNumber(process.env.NEURO_LOOP_WINDOW_S);
  const postIntervalMs = readNumber(process.env.NEURO_LOOP_POST_INTERVAL_MS);   
  const baselinePersist = readBool(process.env.NEURO_LOOP_BASELINE_PERSIST);
  const baselineStorePath = process.env.NEURO_LOOP_BASELINE_STORE_PATH;
  const baselineMinCount = readNumber(process.env.NEURO_LOOP_BASELINE_MIN_COUNT);
  const baselinePersistIntervalMs = readNumber(
    process.env.NEURO_LOOP_BASELINE_PERSIST_INTERVAL_MS,
  );
  const baselineKey = process.env.NEURO_LOOP_BASELINE_KEY;
  const driverOptions: NeuroSimulatorOptions = {
    sampleRateHz: readNumber(process.env.NEURO_LOOP_SAMPLE_RATE_HZ),
    frameSize: readNumber(process.env.NEURO_LOOP_FRAME_SIZE),
    channelCount: readNumber(process.env.NEURO_LOOP_CHANNELS),
    signalHz: readNumber(process.env.NEURO_LOOP_SIGNAL_HZ),
    amplitude: readNumber(process.env.NEURO_LOOP_AMPLITUDE),
    noiseStd: readNumber(process.env.NEURO_LOOP_NOISE_STD),
    markerEveryMs: readNumber(process.env.NEURO_LOOP_MARKER_MS),
    artifactEveryMs: readNumber(process.env.NEURO_LOOP_ARTIFACT_MS),
    artifactDurationMs: readNumber(process.env.NEURO_LOOP_ARTIFACT_DURATION_MS),
    artifactAmplitude: readNumber(process.env.NEURO_LOOP_ARTIFACT_AMPLITUDE),
  };
  const kernelConfig: NeuroKernelConfig = { windowSeconds };
  if (baselineMinCount !== undefined) {
    kernelConfig.gammaBaselineMinCount = baselineMinCount;
  }
  await neuroLoopController.start({
    sessionId: process.env.NEURO_LOOP_SESSION_ID,
    sessionType: process.env.NEURO_LOOP_SESSION_TYPE,
    hostMode: process.env.NEURO_LOOP_HOST_MODE,
    hostId: process.env.NEURO_LOOP_HOST_ID,
    stream: process.env.NEURO_LOOP_STREAM as NeuroStreamKind | undefined,       
    deviceId: process.env.NEURO_LOOP_DEVICE_ID,
    postIntervalMs,
    kernel: kernelConfig,
    baseline: {
      persist: baselinePersist,
      storePath: baselineStorePath,
      minCount: baselineMinCount,
      persistIntervalMs: baselinePersistIntervalMs,
      key: baselineKey,
    },
    driver: { kind: "sim", options: driverOptions },
  });
};



