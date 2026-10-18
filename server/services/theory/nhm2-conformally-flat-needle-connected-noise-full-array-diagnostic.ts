import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import {
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_CANONICAL_JSON,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_SIZE_BYTES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_CANONICAL_JSON,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_SIZE_BYTES,
} from "../../../shared/contracts/nhm2-conformally-flat-needle-connected-noise-diagnostic-cubature-policy.v1";
import {
  canonicalNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMapJson,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SIZE_BYTES,
} from "./nhm2-conformally-flat-needle-connected-noise-spectral-moment-map";

export const NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FULL_ARRAY_DIAGNOSTIC_SCHEMA_VERSION =
  "nhm2_conformally_flat_needle_connected_noise_full_array_diagnostic/v1" as const;

const ENVELOPE_SCHEMA_VERSION =
  "nhm2_conformally_flat_needle_connected_noise_full_array_diagnostic_envelope/v1" as const;
const WORKER_METADATA_SCHEMA_VERSION =
  "nhm2_conformally_flat_needle_connected_noise_full_array_diagnostic_worker/v1" as const;
const EXPECTED_WORKER_POLICY_SHA256 =
  "a07fa41375f2cdb00340d5eaef1fbd9fa1a9d573520a55ad13c7ff737270212f" as const;
const EXPECTED_WORKER_POLICY_SIZE_BYTES = 18_704 as const;
const EXPECTED_FULL_POLICY_SHA256 =
  "84ecd8e8755bc79d2fb482ffe4d4df4fe4c63dfd651169643c4b31e37475d199" as const;
const EXPECTED_FULL_POLICY_SIZE_BYTES = 22_389 as const;
const EXPECTED_POLICY_SOURCE_SHA256 =
  "e526c2126682c4d665e359c1755213e71f1d5aa46f85f5a7fce09b007970e909" as const;
const EXPECTED_POLICY_SOURCE_SIZE_BYTES = 73_414 as const;
const EXPECTED_MOMENT_MAP_SHA256 =
  "4a09a273d759851979b6b7ef7a1f381d19dec82474e4fc5088cbdf87ac086fff" as const;
const EXPECTED_MOMENT_MAP_SIZE_BYTES = 7_738 as const;
const EXPECTED_WORKER_SOURCE_SHA256 =
  "99e8735030e8e177e2340b1b808d44635763c755c7fcb7b7e2c62a9b5de072e5" as const;
const EXPECTED_WORKER_SOURCE_SIZE_BYTES = 38_389 as const;
const EXPECTED_PYTHON_VERSION = "3.13.7" as const;
const EXPECTED_NUMPY_VERSION = "2.2.6" as const;
const EXPECTED_SCIPY_VERSION = "1.16.1" as const;
const RAW_ARRAY_BYTES = 3_276_800;
const RAW_INVENTORY_BYTES = 9_830_400;
const MAX_METADATA_BYTES = 65_536;
const MAX_STDOUT_BYTES = 8 + MAX_METADATA_BYTES + RAW_INVENTORY_BYTES;
const MAX_STDERR_BYTES = 65_536;
const MAX_STDIN_BYTES = 65_536;
const TIMEOUT_MS = 15 * 60 * 1_000;
const THREAD_ENVIRONMENT = Object.freeze({
  OPENBLAS_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  OMP_NUM_THREADS: "1",
  VECLIB_MAXIMUM_THREADS: "1",
  NUMEXPR_NUM_THREADS: "1",
});
const WORKER_ENVIRONMENT = Object.freeze({
  ...THREAD_ENVIRONMENT,
  PYTHONHASHSEED: "0",
  PYTHONNOUSERSITE: "1",
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONIOENCODING: "utf-8",
  ...(process.platform === "win32"
    ? {
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        PYTHONPATH:
          "C:\\Users\\dan\\AppData\\Roaming\\Python\\Python313\\site-packages",
      }
    : {}),
});

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WRAPPER_SOURCE_PATH = fileURLToPath(import.meta.url);
const WORKER_PATH = fileURLToPath(
  new URL(
    "../../../tools/nhm2-semiclassical/connected_noise_full_array_diagnostic.py",
    import.meta.url,
  ),
);
const POLICY_SOURCE_PATH = fileURLToPath(
  new URL(
    "../../../shared/contracts/nhm2-conformally-flat-needle-connected-noise-diagnostic-cubature-policy.v1.ts",
    import.meta.url,
  ),
);
const MOMENT_MAP_SOURCE_PATH = fileURLToPath(
  new URL(
    "./nhm2-conformally-flat-needle-connected-noise-spectral-moment-map.ts",
    import.meta.url,
  ),
);
const PYTHON_EXECUTABLE =
  process.platform === "win32"
    ? "C:\\Python313\\python.exe"
    : "/usr/local/bin/python3.13";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

if (
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_SHA256 !==
    EXPECTED_WORKER_POLICY_SHA256 ||
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_SIZE_BYTES !==
    EXPECTED_WORKER_POLICY_SIZE_BYTES ||
  sha256(
    Buffer.from(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_CANONICAL_JSON,
      "utf8",
    ),
  ) !== EXPECTED_WORKER_POLICY_SHA256 ||
  Buffer.byteLength(
    NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_CANONICAL_JSON,
    "utf8",
  ) !== EXPECTED_WORKER_POLICY_SIZE_BYTES ||
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_SHA256 !==
    EXPECTED_FULL_POLICY_SHA256 ||
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_SIZE_BYTES !==
    EXPECTED_FULL_POLICY_SIZE_BYTES ||
  sha256(
    Buffer.from(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_CANONICAL_JSON,
      "utf8",
    ),
  ) !== EXPECTED_FULL_POLICY_SHA256 ||
  Buffer.byteLength(
    NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_CANONICAL_JSON,
    "utf8",
  ) !== EXPECTED_FULL_POLICY_SIZE_BYTES ||
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SHA256 !==
    EXPECTED_MOMENT_MAP_SHA256 ||
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SIZE_BYTES !==
    EXPECTED_MOMENT_MAP_SIZE_BYTES
) {
  throw new Error(
    "nhm2_connected_noise_full_array_diagnostic_upstream_literal_pin_mismatch",
  );
}

const boundary =
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY.content;
if (
  boundary.diagnosticWorkerImplementationInputsFrozen !== true ||
  boundary.authoritativeExecutionReady !== false ||
  boundary.inputBoundary.acceptedCallerConfigurationKeys.length !== 0 ||
  Object.entries(boundary.inputBoundary).some(([key, value]) =>
    key === "contractOwnedValuesOnly"
      ? value !== true
      : Array.isArray(value)
        ? false
        : value !== false,
  ) ||
  boundary.outputAuthority.deterministicEnclosure !== null ||
  boundary.outputAuthority.simultaneousAbsoluteUncertainty95 !== null ||
  boundary.outputAuthority.tailEnclosure !== null ||
  Object.entries(boundary.outputAuthority).some(([key, value]) =>
    key.endsWith("Authority") || key === "mayFeedFixedBackgroundRun"
      ? value !== false
      : false,
  )
) {
  throw new Error(
    "nhm2_connected_noise_full_array_diagnostic_blocked_boundary_drift",
  );
}

type FileObservation = Readonly<{
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
}>;

export type Nhm2ConnectedNoiseRawDiagnosticObservation = Readonly<{
  id: "central" | "refinement_observation" | "cutoff_observation";
  shape: readonly [64, 64, 100];
  elementRepresentation: "ieee754_binary64_little_endian";
  status: string;
  sha256: string;
  sizeBytes: 3_276_800;
  freshness: "new_process_stdout_bytes";
  rawBytes: Buffer;
}>;

export type Nhm2ConnectedNoiseFullArrayDiagnosticResult = Readonly<{
  schemaVersion: typeof NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FULL_ARRAY_DIAGNOSTIC_SCHEMA_VERSION;
  status: "diagnostic_full_shape_central_and_observations_produced_not_enclosed";
  diagnosticOnly: true;
  repositoryCommit: string;
  process: Readonly<{
    command: string;
    args: readonly [string];
    cwd: string;
    environment: typeof WORKER_ENVIRONMENT;
    startedAt: string;
    completedAt: string;
    durationNanoseconds: number;
    exitCode: 0;
    signal: null;
    timedOut: false;
    stdoutBytes: number;
    stderrBytes: 0;
  }>;
  sources: Readonly<{
    wrapper: FileObservation;
    worker: FileObservation;
    cubaturePolicy: FileObservation;
    momentMap: FileObservation;
    pythonExecutable: FileObservation;
  }>;
  workerMetadata: Readonly<Record<string, unknown>>;
  outputs: readonly [
    Nhm2ConnectedNoiseRawDiagnosticObservation,
    Nhm2ConnectedNoiseRawDiagnosticObservation,
    Nhm2ConnectedNoiseRawDiagnosticObservation,
  ];
  deterministicEnclosure: null;
  simultaneousAbsoluteUncertainty95: null;
  tailEnclosure: null;
  mayFeedFixedBackgroundRun: false;
  authority: Readonly<Record<string, false>>;
  claimLocks: Readonly<Record<string, false>>;
}>;

export class Nhm2ConnectedNoiseFullArrayDiagnosticError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "Nhm2ConnectedNoiseFullArrayDiagnosticError";
    this.code = code;
  }
}

const fail = (code: string): never => {
  throw new Nhm2ConnectedNoiseFullArrayDiagnosticError(code);
};

const samePath = (left: string, right: string): boolean => {
  const normalize = (value: string) => {
    const normalized = path.resolve(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
};

const observeRegularFile = async (
  absolutePath: string,
  maximumBytes: number,
): Promise<FileObservation> => {
  const resolved = path.resolve(absolutePath);
  const pathStat = await fs
    .lstat(resolved)
    .catch(() => fail("required_source_file_unreadable"));
  if (
    pathStat.isSymbolicLink() ||
    !pathStat.isFile() ||
    pathStat.nlink !== 1 ||
    pathStat.size <= 0 ||
    pathStat.size > maximumBytes
  ) {
    fail("required_source_file_not_bounded_regular_single_link");
  }
  const real = await fs
    .realpath(resolved)
    .catch(() => fail("required_source_file_realpath_failed"));
  if (!samePath(real, resolved)) fail("required_source_file_reparse_forbidden");
  const handle = await fs
    .open(resolved, "r")
    .catch(() => fail("required_source_file_open_failed"));
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== after.size ||
      bytes.byteLength > maximumBytes
    ) {
      fail("required_source_file_changed_while_observed");
    }
    return Object.freeze({
      absolutePath: resolved,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    });
  } finally {
    await handle.close();
  }
};

const execFileAsync = promisify(execFile);
const observeRepositoryCommit = async (): Promise<string> => {
  const { stdout, stderr } = await execFileAsync(
    "git",
    ["-C", REPO_ROOT, "rev-parse", "HEAD"],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096, windowsHide: true },
  ).catch(() => fail("repository_commit_observation_failed"));
  if (stderr.length !== 0 || !/^[a-f0-9]{40}\r?\n$/.test(stdout)) {
    fail("repository_commit_observation_invalid");
  }
  return stdout.trim();
};

const terminateProcessTree = (child: ChildProcessWithoutNullStreams): void => {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
};

type ProcessObservation = {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  completedAt: string;
  durationNanoseconds: number;
  timedOut: boolean;
  stdoutLimitExceeded: boolean;
  stderrLimitExceeded: boolean;
};

const runWorker = async (stdin: Buffer): Promise<ProcessObservation> => {
  const startedAt = new Date().toISOString();
  const started = process.hrtime.bigint();
  return await new Promise<ProcessObservation>((resolve, reject) => {
    const child = spawn(PYTHON_EXECUTABLE, [WORKER_PATH], {
      cwd: REPO_ROOT,
      env: WORKER_ENVIRONMENT,
      windowsHide: true,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let stdoutLimitExceeded = false;
    let stderrLimitExceeded = false;
    let spawnError: Error | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, TIMEOUT_MS);
    timeout.unref();
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stdoutLimitExceeded = true;
        terminateProcessTree(child);
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        stderrLimitExceeded = true;
        terminateProcessTree(child);
        return;
      }
      stderr.push(Buffer.from(chunk));
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (spawnError != null) {
        reject(spawnError);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode,
        signal,
        startedAt,
        completedAt: new Date().toISOString(),
        durationNanoseconds: Number(process.hrtime.bigint() - started),
        timedOut,
        stdoutLimitExceeded,
        stderrLimitExceeded,
      });
    });
    child.stdin.on("error", () => {
      terminateProcessTree(child);
    });
    child.stdin.end(stdin);
  }).catch(() => fail("worker_spawn_failed"));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const everyFalse = (value: unknown): value is Record<string, false> =>
  isRecord(value) &&
  Object.keys(value).length > 0 &&
  Object.values(value).every((entry) => entry === false);

const assertFiniteCanonicalF64Le = (bytes: Buffer): void => {
  if (bytes.byteLength !== RAW_ARRAY_BYTES) fail("raw_array_size_invalid");
  for (let offset = 0; offset < bytes.byteLength; offset += 8) {
    const value = bytes.readDoubleLE(offset);
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail("raw_array_nonfinite_or_negative_zero");
    }
  }
};

const parseFrame = (
  frame: Buffer,
): {
  metadata: Record<string, unknown>;
  arrays: readonly [Buffer, Buffer, Buffer];
} => {
  if (frame.byteLength < 8 + RAW_INVENTORY_BYTES)
    fail("worker_frame_truncated");
  const metadataLengthBig = frame.readBigUInt64LE(0);
  if (metadataLengthBig > BigInt(MAX_METADATA_BYTES)) {
    fail("worker_metadata_limit_exceeded");
  }
  const metadataLength = Number(metadataLengthBig);
  if (frame.byteLength !== 8 + metadataLength + RAW_INVENTORY_BYTES) {
    fail("worker_frame_size_invalid");
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      frame.subarray(8, 8 + metadataLength).toString("utf8"),
    );
  } catch {
    fail("worker_metadata_json_invalid");
  }
  if (!isRecord(metadata)) return fail("worker_metadata_root_invalid");
  const metadataRecord = metadata as Record<string, unknown>;
  const rawStart = 8 + metadataLength;
  const arrays = [0, 1, 2].map((ordinal) =>
    Buffer.from(
      frame.subarray(
        rawStart + ordinal * RAW_ARRAY_BYTES,
        rawStart + (ordinal + 1) * RAW_ARRAY_BYTES,
      ),
    ),
  ) as [Buffer, Buffer, Buffer];
  arrays.forEach(assertFiniteCanonicalF64Le);
  return { metadata: metadataRecord, arrays };
};

const exactWorkerOutputMetadata = (
  metadata: Record<string, unknown>,
  arrays: readonly [Buffer, Buffer, Buffer],
  worker: FileObservation,
  python: FileObservation,
): Array<
  Omit<Nhm2ConnectedNoiseRawDiagnosticObservation, "freshness" | "rawBytes">
> => {
  if (
    metadata.schemaVersion !== WORKER_METADATA_SCHEMA_VERSION ||
    metadata.status !==
      "diagnostic_full_shape_central_and_observations_produced_not_enclosed" ||
    metadata.diagnosticOnly !== true ||
    metadata.deterministicEnclosure !== null ||
    metadata.simultaneousAbsoluteUncertainty95 !== null ||
    metadata.tailEnclosure !== null ||
    metadata.mayFeedFixedBackgroundRun !== false ||
    !everyFalse(metadata.authority) ||
    !everyFalse(metadata.claimLocks)
  ) {
    fail("worker_metadata_claim_boundary_invalid");
  }
  const bindings = metadata.descriptorBindings;
  const runtime = metadata.runtime;
  if (
    !isRecord(bindings) ||
    bindings.cubatureWorkerPolicySha256 !== EXPECTED_WORKER_POLICY_SHA256 ||
    bindings.cubatureWorkerPolicySizeBytes !==
      EXPECTED_WORKER_POLICY_SIZE_BYTES ||
    bindings.cubatureFullPolicySha256 !== EXPECTED_FULL_POLICY_SHA256 ||
    bindings.cubatureFullPolicySizeBytes !== EXPECTED_FULL_POLICY_SIZE_BYTES ||
    bindings.spectralMomentMapSha256 !== EXPECTED_MOMENT_MAP_SHA256 ||
    bindings.spectralMomentMapSizeBytes !== EXPECTED_MOMENT_MAP_SIZE_BYTES ||
    !isRecord(runtime) ||
    runtime.implementation !== "CPython" ||
    runtime.pythonVersion !== EXPECTED_PYTHON_VERSION ||
    runtime.numpyVersion !== EXPECTED_NUMPY_VERSION ||
    runtime.scipyVersion !== EXPECTED_SCIPY_VERSION ||
    runtime.workerSourceSha256 !== worker.sha256 ||
    runtime.workerSourceSizeBytes !== worker.sizeBytes ||
    runtime.pythonExecutableSha256 !== python.sha256 ||
    runtime.pythonExecutableSizeBytes !== python.sizeBytes ||
    runtime.peakResidentBytesObserved == null ||
    typeof runtime.peakResidentBytesObserved !== "number" ||
    runtime.peakResidentBytesObserved > 268_435_456
  ) {
    fail("worker_metadata_binding_or_runtime_invalid");
  }
  const outputs = metadata.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 3) {
    fail("worker_metadata_output_inventory_invalid");
  }
  const outputEntries = outputs as unknown[];
  const ids = [
    "central",
    "refinement_observation",
    "cutoff_observation",
  ] as const;
  return outputEntries.map((entry, ordinal) => {
    if (
      !isRecord(entry) ||
      entry.id !== ids[ordinal] ||
      JSON.stringify(entry.shape) !== "[64,64,100]" ||
      entry.elementRepresentation !== "ieee754_binary64_little_endian" ||
      entry.sizeBytes !== RAW_ARRAY_BYTES ||
      entry.sha256 !== sha256(arrays[ordinal]) ||
      typeof entry.status !== "string"
    ) {
      fail("worker_metadata_output_inventory_invalid");
    }
    const outputRecord = entry as Record<string, unknown> & {
      status: string;
      sha256: string;
    };
    return {
      id: ids[ordinal],
      shape: [64, 64, 100] as const,
      elementRepresentation: "ieee754_binary64_little_endian" as const,
      status: outputRecord.status,
      sha256: outputRecord.sha256,
      sizeBytes: RAW_ARRAY_BYTES as 3_276_800,
    };
  });
};

/**
 * Executes the one frozen, bounded diagnostic plan. The public API is
 * intentionally zero-argument: callers cannot supply paths, numbers, work,
 * tolerances, metrics, lever tensors, environment, or authority overrides.
 */
export const runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic =
  async (
    ...unknownInput: never[]
  ): Promise<Nhm2ConnectedNoiseFullArrayDiagnosticResult> => {
    if (unknownInput.length !== 0) fail("public_api_accepts_no_input");
    const [
      repositoryCommit,
      wrapperBefore,
      workerBefore,
      policyBefore,
      momentBefore,
      pythonBefore,
    ] = await Promise.all([
      observeRepositoryCommit(),
      observeRegularFile(WRAPPER_SOURCE_PATH, 128 * 1024),
      observeRegularFile(WORKER_PATH, 128 * 1024),
      observeRegularFile(POLICY_SOURCE_PATH, 128 * 1024),
      observeRegularFile(MOMENT_MAP_SOURCE_PATH, 128 * 1024),
      observeRegularFile(PYTHON_EXECUTABLE, 512 * 1024 * 1024),
    ]);
    if (
      workerBefore.sha256 !== EXPECTED_WORKER_SOURCE_SHA256 ||
      workerBefore.sizeBytes !== EXPECTED_WORKER_SOURCE_SIZE_BYTES ||
      policyBefore.sha256 !== EXPECTED_POLICY_SOURCE_SHA256 ||
      policyBefore.sizeBytes !== EXPECTED_POLICY_SOURCE_SIZE_BYTES
    ) {
      fail("worker_or_policy_source_literal_pin_mismatch");
    }
    const momentMapCanonicalJson =
      canonicalNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMapJson();
    const envelope = Buffer.from(
      JSON.stringify({
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        policyCanonicalJson:
          NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_WORKER_POLICY_CANONICAL_JSON,
        policySha256: EXPECTED_WORKER_POLICY_SHA256,
        policySizeBytes: EXPECTED_WORKER_POLICY_SIZE_BYTES,
        fullPolicyCanonicalJson:
          NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_DIAGNOSTIC_CUBATURE_POLICY_CANONICAL_JSON,
        fullPolicySha256: EXPECTED_FULL_POLICY_SHA256,
        fullPolicySizeBytes: EXPECTED_FULL_POLICY_SIZE_BYTES,
        momentMapCanonicalJson,
        momentMapSha256: EXPECTED_MOMENT_MAP_SHA256,
        momentMapSizeBytes: EXPECTED_MOMENT_MAP_SIZE_BYTES,
        workerSourceSha256: workerBefore.sha256,
        workerSourceSizeBytes: workerBefore.sizeBytes,
      }),
      "utf8",
    );
    if (envelope.byteLength > MAX_STDIN_BYTES)
      fail("worker_stdin_limit_exceeded");

    const processObservation = await runWorker(envelope);
    if (
      processObservation.timedOut ||
      processObservation.stdoutLimitExceeded ||
      processObservation.stderrLimitExceeded ||
      processObservation.exitCode !== 0 ||
      processObservation.signal !== null ||
      processObservation.stderr.byteLength !== 0
    ) {
      fail("worker_process_failed_closed");
    }
    const parsed = parseFrame(processObservation.stdout);
    const [wrapperAfter, workerAfter, policyAfter, momentAfter, pythonAfter] =
      await Promise.all([
        observeRegularFile(WRAPPER_SOURCE_PATH, 128 * 1024),
        observeRegularFile(WORKER_PATH, 128 * 1024),
        observeRegularFile(POLICY_SOURCE_PATH, 128 * 1024),
        observeRegularFile(MOMENT_MAP_SOURCE_PATH, 128 * 1024),
        observeRegularFile(PYTHON_EXECUTABLE, 512 * 1024 * 1024),
      ]);
    for (const [before, after] of [
      [wrapperBefore, wrapperAfter],
      [workerBefore, workerAfter],
      [policyBefore, policyAfter],
      [momentBefore, momentAfter],
      [pythonBefore, pythonAfter],
    ] as const) {
      if (
        before.sha256 !== after.sha256 ||
        before.sizeBytes !== after.sizeBytes
      ) {
        fail("source_changed_across_worker_execution");
      }
    }
    const inventory = exactWorkerOutputMetadata(
      parsed.metadata,
      parsed.arrays,
      workerAfter,
      pythonAfter,
    );
    const outputs = inventory.map((entry, ordinal) =>
      Object.freeze({
        ...entry,
        freshness: "new_process_stdout_bytes" as const,
        rawBytes: parsed.arrays[ordinal],
      }),
    ) as [
      Nhm2ConnectedNoiseRawDiagnosticObservation,
      Nhm2ConnectedNoiseRawDiagnosticObservation,
      Nhm2ConnectedNoiseRawDiagnosticObservation,
    ];
    const authority = Object.freeze({
      numericalEnclosureAuthority: false as const,
      fixedBackgroundRunAuthority: false as const,
      executionAuthority: false as const,
      replayAuthority: false as const,
      agreementAuthority: false as const,
      lampAuthority: false as const,
      constraintAuthority: false as const,
      admConstraintAuthority: false as const,
      bracketAuthority: false as const,
      physicalClaimAuthority: false as const,
      propulsionAuthority: false as const,
      transportAuthority: false as const,
      certificateAuthority: false as const,
    });
    const claimLocks = Object.freeze({
      connectedNoiseDiagnosticPass: false as const,
      semiclassicalStressNoiseLamp: false as const,
      constraintClosureLamp: false as const,
      admConstraintClosure: false as const,
      bracketClosure: false as const,
      physicalViability: false as const,
      propulsion: false as const,
      transport: false as const,
      certificateEligibility: false as const,
      certificateIssued: false as const,
    });
    return Object.freeze({
      schemaVersion:
        NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FULL_ARRAY_DIAGNOSTIC_SCHEMA_VERSION,
      status:
        "diagnostic_full_shape_central_and_observations_produced_not_enclosed",
      diagnosticOnly: true,
      repositoryCommit,
      process: Object.freeze({
        command: PYTHON_EXECUTABLE,
        args: Object.freeze([WORKER_PATH]) as readonly [string],
        cwd: REPO_ROOT,
        environment: WORKER_ENVIRONMENT,
        startedAt: processObservation.startedAt,
        completedAt: processObservation.completedAt,
        durationNanoseconds: processObservation.durationNanoseconds,
        exitCode: 0 as const,
        signal: null,
        timedOut: false as const,
        stdoutBytes: processObservation.stdout.byteLength,
        stderrBytes: 0 as const,
      }),
      sources: Object.freeze({
        wrapper: wrapperAfter,
        worker: workerAfter,
        cubaturePolicy: policyAfter,
        momentMap: momentAfter,
        pythonExecutable: pythonAfter,
      }),
      workerMetadata: Object.freeze(parsed.metadata),
      outputs: Object.freeze(outputs),
      deterministicEnclosure: null,
      simultaneousAbsoluteUncertainty95: null,
      tailEnclosure: null,
      mayFeedFixedBackgroundRun: false,
      authority,
      claimLocks,
    });
  };
