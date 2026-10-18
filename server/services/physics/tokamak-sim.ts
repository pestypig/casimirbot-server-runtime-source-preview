import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  TokamakSimCommandInput,
  TokamakSimState,
  type TTokamakSimConfig,
  type TTokamakSimState,
} from "@shared/tokamak-sim";
import { TokamakPrecursorScoreKey } from "@shared/tokamak-precursor";
import type { TTokamakPrecursorDataset, TTokamakPrecursorReport } from "@shared/tokamak-precursor";
import { hashStableJson } from "../../utils/information-boundary";
import {
  loadTokamakPrecursorDataset,
  runTokamakPrecursorDataset,
} from "../../../tools/tokamak-precursor-runner";

const DEFAULT_DATASET_PATH = path.resolve(
  process.cwd(),
  "datasets",
  "tokamak-rz-precursor.fixture.json",
);

const DEFAULT_CONFIG: TTokamakSimConfig = {
  score_key: "k_combo_v1",
  boundary: "dirichlet0",
};

type ReportCache = {
  dataset_path: string;
  config_hash: string;
  dataset: TTokamakPrecursorDataset;
  report: TTokamakPrecursorReport;
};

let reportCache: ReportCache | null = null;

let state: TTokamakSimState = TokamakSimState.parse({
  status: "idle",
  updated_at: new Date().toISOString(),
  dataset_path: DEFAULT_DATASET_PATH,
  config: DEFAULT_CONFIG,
});

const buildConfigHash = (datasetPath: string, config: TTokamakSimConfig): string =>
  hashStableJson({
    dataset_path: datasetPath,
    config: {
      score_key: config.score_key ?? DEFAULT_CONFIG.score_key,
      boundary: config.boundary ?? DEFAULT_CONFIG.boundary,
      drive_hz: config.drive_hz,
      max_link_distance_m: config.max_link_distance_m,
    },
  });

const ensureReport = async (
  datasetPath: string,
  config: TTokamakSimConfig,
): Promise<ReportCache> => {
  const normalizedConfig = { ...DEFAULT_CONFIG, ...config };
  const configHash = buildConfigHash(datasetPath, normalizedConfig);
  if (
    reportCache &&
    reportCache.dataset_path === datasetPath &&
    reportCache.config_hash === configHash
  ) {
    return reportCache;
  }
  const dataset = await loadTokamakPrecursorDataset(datasetPath);
  const report = runTokamakPrecursorDataset(dataset, {
    dataset_path: datasetPath,
    score_key: TokamakPrecursorScoreKey.parse(
      normalizedConfig.score_key ?? "k_combo_v1",
    ),
    tracking: {
      ...(normalizedConfig.drive_hz ? { drive_hz: normalizedConfig.drive_hz } : {}),
      ...(normalizedConfig.max_link_distance_m
        ? { max_link_distance_m: normalizedConfig.max_link_distance_m }
        : {}),
    },
    boundary: normalizedConfig.boundary ?? "dirichlet0",
  });
  reportCache = {
    dataset_path: datasetPath,
    config_hash: configHash,
    dataset,
    report,
  };
  return reportCache;
};

const buildTelemetry = (
  report: TTokamakPrecursorReport,
  frameIndex: number,
) => {
  const frame = report.frames[frameIndex];
  if (!frame) return undefined;
  return {
    frame_id: frame.id,
    timestamp_iso: frame.timestamp_iso,
    frame_index: frameIndex,
    k0: frame.metrics.k0,
    k1: frame.metrics.k1,
    k2: frame.metrics.k2,
    k3: frame.metrics.k3,
    fragmentation_rate: frame.metrics.fragmentation_rate,
    ridge_count: frame.metrics.ridge_count,
    score: frame.score,
    event_present: frame.label.event_present,
  };
};

const nextIso = () => new Date().toISOString();

export function getTokamakSimState(): TTokamakSimState {
  return state;
}

export async function commandTokamakSimulation(
  rawInput: unknown,
): Promise<TTokamakSimState> {
  const command = TokamakSimCommandInput.parse(rawInput ?? {});
  const now = nextIso();
  const nextConfig = command.config
    ? { ...state.config, ...command.config }
    : state.config;
  const datasetPath =
    command.dataset_path ?? state.dataset_path ?? DEFAULT_DATASET_PATH;

  let updated: TTokamakSimState = {
    ...state,
    updated_at: now,
    dataset_path: datasetPath,
    config: nextConfig,
    last_command: {
      action: command.action,
      issued_at: now,
      params: {
        ...(command.dataset_path ? { dataset_path: command.dataset_path } : {}),
        ...(command.config ? { config: command.config } : {}),
      },
    },
  };

  try {
    if (command.action === "stop") {
      updated = {
        ...updated,
        status: "idle",
        telemetry: undefined,
        error: undefined,
      };
    } else if (command.action === "pause") {
      updated = { ...updated, status: "paused" };
    } else if (command.action === "resume") {
      updated = { ...updated, status: "running" };
    } else if (command.action === "load_dataset") {
      await ensureReport(datasetPath, nextConfig);
      updated = {
        ...updated,
        status: "idle",
        error: undefined,
        telemetry: undefined,
      };
    } else {
      const cache = await ensureReport(datasetPath, nextConfig);
      const totalFrames = cache.report.frames.length;
      const currentIndex = updated.telemetry?.frame_index ?? 0;
      const nextIndex =
        command.action === "step"
          ? Math.min(currentIndex + 1, Math.max(0, totalFrames - 1))
          : 0;
      const telemetry = buildTelemetry(cache.report, nextIndex);
      const status =
        nextIndex >= Math.max(0, totalFrames - 1) &&
        (command.action === "step" || command.action === "start")
          ? "completed"
          : command.action === "start"
            ? "running"
            : updated.status;
      updated = {
        ...updated,
        status,
        run_id: command.action === "start" ? randomUUID() : updated.run_id,
        telemetry,
        report: {
          auc: cache.report.auc,
          report_hash: cache.report.report_hash,
        },
        error: undefined,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "tokamak_sim_failed";
    updated = {
      ...updated,
      status: "error",
      error: message,
    };
  }

  state = TokamakSimState.parse(updated);
  return state;
}
