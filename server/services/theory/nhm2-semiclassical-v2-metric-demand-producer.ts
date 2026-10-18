import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  calculateMetricStressEnergyTensorAtPointFromShiftField,
  calculateNatarioShiftField,
  type NatarioWarpParams,
} from "../../../modules/warp/natario-warp";
import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CLAIM_LOCKS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_COMPONENT_COUNT,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION_SHA256,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EVALUATOR,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EXPECTED_ROUTE_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_OUTPUT_FILE_NAME,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_PRODUCER_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_PRODUCER_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RUN_PROVENANCE_BLOCKERS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_COUNT,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SEMANTIC_LIMITS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES,
  computeNhm2SemiclassicalV2MetricDemandProducerReceiptSha256,
  hasValidNhm2SemiclassicalV2MetricDemandProducerReceiptIntegrity,
  type Nhm2SemiclassicalV2MetricDemandPointV1,
  type Nhm2SemiclassicalV2MetricDemandProducerReceiptV1,
} from "../../../shared/contracts/nhm2-semiclassical-v2-metric-demand-producer.v1";
import {
  Nhm2SecureRunOutputReaderError,
  readNhm2SecureRunOutputs,
} from "./nhm2-secure-run-output-reader";

export const NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_OUTPUT_DIRECTORY_NAME =
  `nhm2-metric-demand-${NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION_SHA256.slice(0, 16)}` as const;

export type Nhm2SemiclassicalV2MetricDemandProducerErrorCode =
  | "producer_input_invalid"
  | "output_parent_invalid"
  | "output_directory_exists"
  | "output_directory_create_failed"
  | "metric_point_evaluation_failed"
  | "metric_route_mismatch"
  | "metric_component_invalid"
  | "metric_demand_degenerate"
  | "metric_output_write_failed"
  | "metric_output_secure_readback_failed"
  | "metric_output_readback_mismatch"
  | "metric_receipt_integrity_failed";

export class Nhm2SemiclassicalV2MetricDemandProducerError extends Error {
  readonly code: Nhm2SemiclassicalV2MetricDemandProducerErrorCode;
  readonly sampleIndex: number | null;
  readonly detailCode: string | null;

  constructor(
    code: Nhm2SemiclassicalV2MetricDemandProducerErrorCode,
    message: string,
    options: {
      cause?: unknown;
      sampleIndex?: number | null;
      detailCode?: string | null;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "Nhm2SemiclassicalV2MetricDemandProducerError";
    this.code = code;
    this.sampleIndex = options.sampleIndex ?? null;
    this.detailCode = options.detailCode ?? null;
  }
}

export type Nhm2SemiclassicalV2MetricDemandEvaluatedSampleV1 = {
  readonly pointM: Nhm2SemiclassicalV2MetricDemandPointV1;
  readonly routeId: string;
  readonly modelTermAdmission: string;
  readonly components: readonly number[];
};

export type Nhm2SemiclassicalV2MetricDemandEncodedSamplesV1 = {
  readonly bytes: Buffer;
  readonly routeIds: readonly string[];
  readonly modelTermAdmissions: readonly string[];
  readonly minimumObservedFrobeniusSI: number;
  readonly maximumObservedFrobeniusSI: number;
};

export type ProduceNhm2SemiclassicalV2MetricDemandInput = {
  /** Existing absolute parent. The server derives and exclusively creates the child. */
  outputParentDirectory: string;
  /** Server clock dependency. Tests may provide a deterministic clock. */
  now?: () => Date;
};

export type ProduceNhm2SemiclassicalV2MetricDemandResult = {
  readonly receipt: Nhm2SemiclassicalV2MetricDemandProducerReceiptV1;
  readonly outputDirectoryRealPath: string;
};

const fail = (
  code: Nhm2SemiclassicalV2MetricDemandProducerErrorCode,
  message: string,
  options: {
    cause?: unknown;
    sampleIndex?: number | null;
    detailCode?: string | null;
  } = {},
): never => {
  throw new Nhm2SemiclassicalV2MetricDemandProducerError(code, message, options);
};

const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value == null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
};

const samePath = (left: string, right: string): boolean =>
  process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return fail("producer_input_invalid", "The producer clock returned an invalid Date.");
  }
  return value.toISOString();
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const stableSymmetricTensorFrobenius = (components: readonly number[]): number => {
  const multiplicities =
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EVALUATOR.componentMultiplicities;
  let scale = 0;
  for (let index = 0; index < components.length; index += 1) {
    scale = Math.max(
      scale,
      Math.sqrt(multiplicities[index]) * Math.abs(components[index]),
    );
  }
  if (scale === 0) return 0;
  let normalizedSquareSum = 0;
  for (let index = 0; index < components.length; index += 1) {
    const normalized = components[index] / scale;
    normalizedSquareSum += multiplicities[index] * normalized * normalized;
  }
  return scale * Math.sqrt(normalizedSquareSum);
};

const pointsEqual = (
  left: Nhm2SemiclassicalV2MetricDemandPointV1,
  right: Nhm2SemiclassicalV2MetricDemandPointV1,
): boolean => left.every((value, index) => Object.is(value, right[index]));

/**
 * Authority-neutral encoder used by the fixed producer after point evaluation.
 * It rejects every route-mixed, non-finite, reordered, or degenerate sample.
 */
export const encodeNhm2SemiclassicalV2MetricDemandSamples = (
  samples: readonly Nhm2SemiclassicalV2MetricDemandEvaluatedSampleV1[],
): Nhm2SemiclassicalV2MetricDemandEncodedSamplesV1 => {
  if (samples.length !== NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_COUNT) {
    return fail(
      "metric_component_invalid",
      `Exactly ${NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_COUNT} samples are required.`,
    );
  }
  const bytes = Buffer.alloc(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES);
  const routeIds: string[] = [];
  const modelTermAdmissions: string[] = [];
  let minimumObservedFrobeniusSI = Number.POSITIVE_INFINITY;
  let maximumObservedFrobeniusSI = 0;
  let byteOffset = 0;
  const floor =
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION.minimumMetricDemandFrobeniusSI;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    if (!pointsEqual(sample.pointM, NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS[sampleIndex])) {
      return fail(
        "metric_component_invalid",
        "A point sample does not match the immutable server-owned sampling order.",
        { sampleIndex },
      );
    }
    if (sample.routeId !== NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EXPECTED_ROUTE_ID) {
      return fail(
        "metric_route_mismatch",
        `Expected ${NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EXPECTED_ROUTE_ID}, observed ${sample.routeId}.`,
        { sampleIndex },
      );
    }
    if (sample.modelTermAdmission !== "experimental_not_admitted") {
      return fail(
        "metric_route_mismatch",
        `Expected experimental_not_admitted, observed ${sample.modelTermAdmission}.`,
        { sampleIndex },
      );
    }
    if (sample.components.length !== NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_COMPONENT_COUNT) {
      return fail(
        "metric_component_invalid",
        `Every sample must contain ${NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_COMPONENT_COUNT} components.`,
        { sampleIndex },
      );
    }
    if (sample.components.some((component) => !Number.isFinite(component))) {
      return fail("metric_component_invalid", "Every metric component must be finite.", {
        sampleIndex,
      });
    }
    const frobenius = stableSymmetricTensorFrobenius(sample.components);
    if (!Number.isFinite(frobenius) || frobenius <= floor) {
      return fail(
        "metric_demand_degenerate",
        `Sample Frobenius norm must be strictly greater than ${floor}.`,
        { sampleIndex },
      );
    }
    minimumObservedFrobeniusSI = Math.min(
      minimumObservedFrobeniusSI,
      frobenius,
    );
    maximumObservedFrobeniusSI = Math.max(
      maximumObservedFrobeniusSI,
      frobenius,
    );
    routeIds.push(sample.routeId);
    modelTermAdmissions.push(sample.modelTermAdmission);
    for (const component of sample.components) {
      bytes.writeDoubleLE(component, byteOffset);
      byteOffset += 8;
    }
  }

  return Object.freeze({
    bytes,
    routeIds: Object.freeze(routeIds),
    modelTermAdmissions: Object.freeze(modelTermAdmissions),
    minimumObservedFrobeniusSI,
    maximumObservedFrobeniusSI,
  });
};

const frozenWarpParams = (): NatarioWarpParams => ({
  bowlRadius: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.bowlRadiusUm,
  sagDepth: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.sagDepthNm,
  gap: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.gapNm,
  cavityQ: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.cavityQ,
  burstDuration:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.burstDurationUs,
  cycleDuration:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.cycleDurationUs,
  sectorCount: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.sectorCount,
  dutyFactor: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.dutyFactor,
  effectiveDuty: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.effectiveDuty,
  shiftAmplitude: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.shiftAmplitude,
  expansionTolerance:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.expansionTolerance,
  warpFieldType: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.metricFamily,
  shiftLapseProfileId:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.shiftLapseProfileId,
  alphaCenterline:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.alphaCenterline,
  bubbleRadius_m:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.bubbleRadiusM,
  bubbleSigma: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.bubbleSigma,
  hullWallThickness_m:
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.hullWallThicknessM,
  epsilonTilt: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.epsilonTilt,
  betaTiltVec: [...NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.betaTiltVec],
});

const evaluateFixedSamples = (): Nhm2SemiclassicalV2MetricDemandEvaluatedSampleV1[] => {
  const shift = calculateNatarioShiftField(
    frozenWarpParams(),
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY.shiftFieldConstructionMassArgumentKg,
  );
  return NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS.map(
    (pointM, sampleIndex) => {
      const evaluated = calculateMetricStressEnergyTensorAtPointFromShiftField(
        shift.evaluateShiftVector,
        [...pointM],
        {
          derivativeStep_m:
            NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EVALUATOR.derivativeStepM,
          scale_m: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EVALUATOR.scaleM,
          modelTermRoutePreference:
            NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EVALUATOR.routePreference,
        },
      );
      if (evaluated == null) {
        return fail(
          "metric_point_evaluation_failed",
          "The fixed point tensor evaluator returned no sample.",
          { sampleIndex },
        );
      }
      const stress = evaluated.stress;
      const routeId = stress.modelTermRoute ?? "missing";
      return Object.freeze({
        pointM,
        routeId,
        modelTermAdmission: stress.modelTermAdmission ?? "missing",
        components: Object.freeze([
          stress.T00,
          stress.T01 ?? Number.NaN,
          stress.T02 ?? Number.NaN,
          stress.T03 ?? Number.NaN,
          stress.T11,
          stress.T12 ?? Number.NaN,
          stress.T13 ?? Number.NaN,
          stress.T22,
          stress.T23 ?? Number.NaN,
          stress.T33,
        ]),
      });
    },
  );
};

const assertOutputParent = async (value: unknown): Promise<string> => {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    return fail("producer_input_invalid", "outputParentDirectory must be absolute.");
  }
  const resolved = path.resolve(value);
  if (path.parse(resolved).root === resolved) {
    return fail("producer_input_invalid", "A filesystem root cannot be an output parent.");
  }
  try {
    const [stats, realPath] = await Promise.all([fs.lstat(resolved), fs.realpath(resolved)]);
    if (!stats.isDirectory() || stats.isSymbolicLink() || !samePath(realPath, resolved)) {
      return fail(
        "output_parent_invalid",
        "The output parent must be a non-symlink directory with an identity-preserving real path.",
      );
    }
    return resolved;
  } catch (error) {
    if (error instanceof Nhm2SemiclassicalV2MetricDemandProducerError) throw error;
    return fail("output_parent_invalid", "The output parent cannot be securely resolved.", {
      cause: error,
    });
  }
};

const createOutputDirectory = async (parent: string): Promise<string> => {
  const outputDirectory = path.join(
    parent,
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_OUTPUT_DIRECTORY_NAME,
  );
  try {
    await fs.lstat(outputDirectory);
    return fail(
      "output_directory_exists",
      "The immutable metric-demand output directory already exists.",
    );
  } catch (error) {
    if (error instanceof Nhm2SemiclassicalV2MetricDemandProducerError) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      return fail(
        "output_directory_create_failed",
        "The metric-demand output prestate could not be observed.",
        { cause: error },
      );
    }
  }
  try {
    await fs.mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      return fail(
        "output_directory_exists",
        "The immutable metric-demand output directory already exists.",
        { cause: error },
      );
    }
    return fail(
      "output_directory_create_failed",
      "The immutable metric-demand output directory could not be created.",
      { cause: error },
    );
  }
  try {
    const [stats, realPath] = await Promise.all([
      fs.lstat(outputDirectory),
      fs.realpath(outputDirectory),
    ]);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !samePath(realPath, outputDirectory)
    ) {
      return fail(
        "output_directory_create_failed",
        "The newly created output directory failed its identity check.",
      );
    }
    return realPath;
  } catch (error) {
    if (error instanceof Nhm2SemiclassicalV2MetricDemandProducerError) throw error;
    return fail(
      "output_directory_create_failed",
      "The newly created output directory could not be securely resolved.",
      { cause: error },
    );
  }
};

const writeExclusive = async (absolutePath: string, bytes: Buffer): Promise<void> => {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(
      absolutePath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (result.bytesWritten <= 0) throw new Error("zero_length_write");
      offset += result.bytesWritten;
    }
    await handle.sync();
  } catch (error) {
    return fail("metric_output_write_failed", "Metric-demand bytes were not written exactly.", {
      cause: error,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export const produceNhm2SemiclassicalV2MetricDemand = async (
  input: ProduceNhm2SemiclassicalV2MetricDemandInput,
): Promise<ProduceNhm2SemiclassicalV2MetricDemandResult> => {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return fail("producer_input_invalid", "Producer input must be an object.");
  }
  if (input.now != null && typeof input.now !== "function") {
    return fail("producer_input_invalid", "now must be a server clock function.");
  }
  const clock = input.now ?? (() => new Date());
  const parent = await assertOutputParent(input.outputParentDirectory);
  const startedAt = nowIso(clock);
  const startedNs = process.hrtime.bigint();
  const encoded = encodeNhm2SemiclassicalV2MetricDemandSamples(evaluateFixedSamples());
  const outputDirectoryRealPath = await createOutputDirectory(parent);
  const outputPath = path.join(
    outputDirectoryRealPath,
    NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_OUTPUT_FILE_NAME,
  );
  const outputSha256 = sha256(encoded.bytes);
  await writeExclusive(outputPath, encoded.bytes);

  let secureRead;
  try {
    secureRead = await readNhm2SecureRunOutputs({
      runDirectory: outputDirectoryRealPath,
      files: [
        {
          relativePath: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_OUTPUT_FILE_NAME,
          expectedSha256: outputSha256,
          expectedSizeBytes: BigInt(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES),
          decode: { kind: "float64_le", shape: [64, 10] },
        },
      ],
      maxFileBytes: BigInt(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES),
      maxAggregateBytes: BigInt(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES),
    });
  } catch (error) {
    const detailCode =
      error instanceof Nhm2SecureRunOutputReaderError ? error.code : null;
    return fail(
      "metric_output_secure_readback_failed",
      "The output failed bounded secure filesystem reread.",
      { cause: error, detailCode },
    );
  }
  const file = secureRead.files[0];
  if (
    file == null ||
    file.sha256 !== outputSha256 ||
    file.sizeBytes !== BigInt(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES) ||
    !file.bytes.equals(encoded.bytes)
  ) {
    return fail(
      "metric_output_readback_mismatch",
      "Securely reread bytes do not match the producer-owned encoded bytes.",
    );
  }
  for (let offset = 0; offset < encoded.bytes.length; offset += 8) {
    if (!Object.is(file.bytes.readDoubleLE(offset), encoded.bytes.readDoubleLE(offset))) {
      return fail(
        "metric_output_readback_mismatch",
        "Float64 decoding did not exactly round-trip after secure reread.",
      );
    }
  }
  const completedNs = process.hrtime.bigint();
  const completedAt = nowIso(clock);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    return fail(
      "producer_input_invalid",
      "The server clock moved backward during metric-demand production.",
    );
  }
  const durationMs = Number(completedNs - startedNs) / 1e6;
  const invocationId = sha256(
    Buffer.from(
      [
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION_SHA256,
        startedAt,
        completedAt,
        outputDirectoryRealPath,
      ].join("\n"),
      "utf8",
    ),
  );

  const unsigned = {
    artifactId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_PRODUCER_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_PRODUCER_CONTRACT_VERSION,
    authority: "server_owned_geometry_only_reduced_order" as const,
    status:
      "diagnostic_metric_demand_bytes_persisted_and_securely_reread" as const,
    generatedAt: completedAt,
    configuration: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION,
    configurationSha256:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION_SHA256,
    execution: {
      invocationId,
      startedAt,
      completedAt,
      durationMs,
      gitSha: null,
      command: null,
      argv: null,
      implementationSourceSha256: null,
      evaluatorSourceSha256: null,
      runProvenanceState: "partial_server_observation" as const,
      provenanceBlockers:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RUN_PROVENANCE_BLOCKERS,
    },
    provenance: {
      inputMode: "frozen_geometry_only" as const,
      sourceTensorInputsAccepted: false as const,
      sourceTensorRead: false as const,
      declaredLeverTensorRead: false as const,
      quantumStateRead: false as const,
      routeIdBySample: [...encoded.routeIds],
      modelTermAdmissionBySample: [...encoded.modelTermAdmissions],
      routeFallbackObserved: false as const,
    },
    nondegeneracy: {
      algorithm:
        "stable_scaled_symmetric_tensor_frobenius_per_sample_float64_v1" as const,
      minimumMetricDemandFrobeniusSI:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION.minimumMetricDemandFrobeniusSI,
      requiredNondegenerateSampleFraction: 1 as const,
      observedNondegenerateSampleCount: 64 as const,
      observedNondegenerateSampleFraction: 1 as const,
      minimumObservedFrobeniusSI: encoded.minimumObservedFrobeniusSI,
      maximumObservedFrobeniusSI: encoded.maximumObservedFrobeniusSI,
    },
    output: {
      absolutePath: file.absolutePath,
      fileName: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_OUTPUT_FILE_NAME,
      sha256: file.sha256,
      sizeBytes: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES,
      dtype: "float64" as const,
      binaryEncoding: "raw_ieee754" as const,
      endianness: "little" as const,
      shape: [64, 10] as const,
      storageOrder: "row-major" as const,
      componentOrder: [
        ...NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EVALUATOR.componentOrder,
      ],
      unit: "J/m^3" as const,
      prestate: "absent_observed_before_create" as const,
      creation: "directory_and_file_created_exclusively" as const,
      freshness: "new" as const,
      secureReadbackVerified: true as const,
      exactFloat64RoundTripVerified: true as const,
      filesystemIdentity: { ...file.filesystemIdentity },
    },
    semanticLimits: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SEMANTIC_LIMITS,
    claimLocks: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CLAIM_LOCKS,
    receiptHashAlgorithm: "sha256" as const,
    receiptCanonicalization: "utf8_lexicographic_object_keys_json_v1" as const,
  };
  const receipt: Nhm2SemiclassicalV2MetricDemandProducerReceiptV1 = {
    ...unsigned,
    receiptSha256:
      computeNhm2SemiclassicalV2MetricDemandProducerReceiptSha256(unsigned),
  };
  if (!hasValidNhm2SemiclassicalV2MetricDemandProducerReceiptIntegrity(receipt)) {
    return fail(
      "metric_receipt_integrity_failed",
      "The server-owned metric-demand receipt failed its integrity contract.",
    );
  }
  return deepFreeze({ receipt, outputDirectoryRealPath });
};
