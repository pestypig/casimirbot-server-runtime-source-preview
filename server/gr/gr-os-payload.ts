import type { TInformationBoundary } from "../../shared/information-boundary.js";
import type {
  GrConstraintEntry,
  GrEvaluation,
  GrOsAction,
  GrOsPayload,
  GrOsStage,
  GrOsViabilityStatus,
} from "../../shared/schema.js";
import {
  grOsPayloadSchema,
  grOsViabilityStatusSchema,
} from "../../shared/schema.js";
import type { GrPipelineDiagnostics } from "../energy-pipeline.js";

export type GrOsPayloadInput = {
  evaluation: GrEvaluation;
  diagnostics?: GrPipelineDiagnostics | null;
  essenceId?: string;
  informationBoundary?: TInformationBoundary;
};

const pickNumber = (value?: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const coerceViabilityStatus = (value?: string): GrOsViabilityStatus => {
  const parsed = grOsViabilityStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "NOT_CERTIFIED";
};

const buildConstraintMetrics = (evaluation: GrEvaluation) => {
  const metrics: Record<string, number> = {};
  const residuals = evaluation.residuals ?? {};
  const H_rms = pickNumber(residuals.H_rms);
  const M_rms = pickNumber(residuals.M_rms);
  const H_maxAbs = pickNumber(residuals.H_maxAbs);
  const M_maxAbs = pickNumber(residuals.M_maxAbs);
  if (H_rms !== undefined) metrics.H_rms = H_rms;
  if (M_rms !== undefined) metrics.M_rms = M_rms;
  if (H_maxAbs !== undefined) metrics.H_maxAbs = H_maxAbs;
  if (M_maxAbs !== undefined) metrics.M_maxAbs = M_maxAbs;
  return Object.keys(metrics).length ? metrics : undefined;
};

const hardFailIds = (constraints: GrConstraintEntry[]): string[] =>
  constraints
    .filter((entry) => entry.severity === "HARD" && entry.status === "fail")
    .map((entry) => entry.id);

const hasSoftFails = (constraints: GrConstraintEntry[]): boolean =>
  constraints.some(
    (entry) => entry.severity === "SOFT" && entry.status === "fail",
  );

const hasUnknownHard = (constraints: GrConstraintEntry[]): boolean =>
  constraints.some(
    (entry) => entry.severity === "HARD" && entry.status === "unknown",
  );

const resolveConstraintStatus = (
  gateStatus: GrEvaluation["gate"]["status"],
  constraints: GrConstraintEntry[],
): "PASS" | "FAIL" | "WARN" => {
  if (gateStatus === "fail") return "FAIL";
  if (gateStatus === "unknown") return "WARN";
  return hasSoftFails(constraints) ? "WARN" : "PASS";
};

const buildActions = (args: {
  evaluation: GrEvaluation;
  hardFails: string[];
  softFails: boolean;
  unknownHard: boolean;
  certificateOk: boolean;
  certificateStatusOk: boolean;
  requiresCertificate: boolean;
  diagnosticsPresent: boolean;
}): GrOsAction[] => {
  const actions: GrOsAction[] = [];
  const seen = new Set<string>();
  const pushAction = (type: GrOsAction["type"], reason: string) => {
    const key = `${type}:${reason}`;
    if (seen.has(key)) return;
    actions.push({ type, reason });
    seen.add(key);
  };

  if (!args.diagnosticsPresent) {
    pushAction("notify", "missing_diagnostics");
  }
  if (args.evaluation.gate.status === "fail") {
    pushAction("halt", "constraint_gate_failed");
  }
  if (args.evaluation.gate.status === "unknown") {
    pushAction("notify", "constraint_gate_unknown");
  }
  if (args.hardFails.length > 0) {
    pushAction("halt", "hard_constraints_failed");
  }
  if (args.softFails) {
    pushAction("throttle", "soft_constraints_failed");
  }

  if (!args.evaluation.certificate.integrityOk) {
    pushAction("halt", "certificate_integrity_failed");
  }
  if (!args.evaluation.certificate.hasCertificate && args.requiresCertificate) {
    pushAction("halt", "certificate_missing");
  }
  if (args.evaluation.certificate.hasCertificate && !args.certificateStatusOk) {
    pushAction("halt", "certificate_status_not_admissible");
  }
  if (!args.certificateOk && args.evaluation.gate.status === "pass") {
    pushAction("notify", "certificate_gate_blocked");
  }
  if (args.unknownHard) {
    pushAction("notify", "hard_constraints_unknown");
  }

  return actions;
};

const resolveStage = (args: {
  gatePass: boolean;
  certificateOk: boolean;
  diagnosticsPresent: boolean;
  hasUnknownHard: boolean;
  hasProxy: boolean;
  hasSoftFails: boolean;
}): GrOsStage => {
  if (!args.gatePass || !args.certificateOk) {
    return "diagnostic";
  }
  if (
    !args.diagnosticsPresent ||
    args.hasUnknownHard ||
    args.hasProxy ||
    args.hasSoftFails
  ) {
    return "reduced-order";
  }
  return "certified";
};

export function buildGrOsPayload(input: GrOsPayloadInput): GrOsPayload {
  const { evaluation, diagnostics } = input;
  const metrics = buildConstraintMetrics(evaluation);
  const hardFails = hardFailIds(evaluation.constraints);
  const softFails = hasSoftFails(evaluation.constraints);
  const unknownHard = hasUnknownHard(evaluation.constraints);
  const hasProxy = evaluation.constraints.some(
    (entry) => entry.status === "unknown" || entry.proxy,
  );
  const diagnosticsPresent = Boolean(diagnostics);

  const certStatus = evaluation.certificate.status;
  const viabilityStatus = coerceViabilityStatus(certStatus);
  const policy = evaluation.policy?.certificate;
  const allowMarginal = policy?.allowMarginalAsViable ?? false;
  const admissibleStatus = policy?.admissibleStatus ?? "ADMISSIBLE";
  const requiresCertificate =
    policy?.treatMissingCertificateAsNotCertified ?? true;
  const certificateStatusOk =
    certStatus === admissibleStatus ||
    (allowMarginal && certStatus === "MARGINAL");
  const certificateOk =
    evaluation.certificate.integrityOk &&
    (evaluation.certificate.hasCertificate || !requiresCertificate) &&
    (evaluation.certificate.hasCertificate ? certificateStatusOk : true);

  const stage = resolveStage({
    gatePass: evaluation.gate.status === "pass",
    certificateOk,
    diagnosticsPresent,
    hasUnknownHard: unknownHard,
    hasProxy,
    hasSoftFails: softFails,
  });

  const constraintsSummary = {
    gate: {
      mode: evaluation.policy.gate.policy.mode,
      unknownAsFail: evaluation.policy.gate.policy.unknownAsFail,
    },
    status: resolveConstraintStatus(evaluation.gate.status, evaluation.constraints),
    ...(metrics ? { metrics } : {}),
    hard_fail_ids: hardFails,
  };

  const stressEnergy = diagnostics?.matter?.stressEnergy;
  const conservation = stressEnergy?.conservation;
  const stressEnergyPayload =
    conservation || stressEnergy
      ? {
          div_mean: pickNumber(conservation?.divMean),
          div_rms: pickNumber(conservation?.divRms),
          div_max_abs:
            pickNumber(conservation?.divMaxAbs) ??
            (typeof stressEnergy?.divMin === "number" &&
            typeof stressEnergy?.divMax === "number"
              ? Math.max(
                  Math.abs(stressEnergy.divMin),
                  Math.abs(stressEnergy.divMax),
                )
              : undefined),
          net_flux_norm:
            pickNumber(conservation?.netFluxNorm) ??
            (Array.isArray(stressEnergy?.netFlux) &&
            typeof stressEnergy?.avgFluxMagnitude === "number" &&
            stressEnergy.avgFluxMagnitude > 0
              ? Math.hypot(
                  stressEnergy.netFlux[0],
                  stressEnergy.netFlux[1],
                  stressEnergy.netFlux[2],
                ) / stressEnergy.avgFluxMagnitude
              : undefined),
        }
      : undefined;

  const gaugePayload = diagnostics?.gauge
    ? {
        lapse_min: pickNumber(diagnostics.gauge.lapseMin),
        lapse_max: pickNumber(diagnostics.gauge.lapseMax),
        shift_max_abs: pickNumber(diagnostics.gauge.betaMaxAbs),
      }
    : undefined;

  const stabilityPayload =
    diagnostics?.solver || diagnostics?.perf
      ? {
          cfl: pickNumber(diagnostics?.solver?.cfl),
          step_ms: pickNumber(diagnostics?.perf?.msPerStep),
          steps:
            typeof diagnostics?.solver?.steps === "number"
              ? diagnostics.solver.steps
              : undefined,
          total_ms: pickNumber(diagnostics?.perf?.totalMs),
          voxels:
            typeof diagnostics?.perf?.voxels === "number"
              ? diagnostics.perf.voxels
              : undefined,
          channel_count:
            typeof diagnostics?.perf?.channelCount === "number"
              ? diagnostics.perf.channelCount
              : undefined,
        }
      : undefined;

  const voxelSize = diagnostics?.grid?.voxelSize_m
    ? ([
        diagnostics.grid.voxelSize_m[0],
        diagnostics.grid.voxelSize_m[1],
        diagnostics.grid.voxelSize_m[2],
      ] as [number, number, number])
    : undefined;
  const gridPayload = diagnostics?.grid
    ? {
        nx: diagnostics.grid.dims[0],
        ny: diagnostics.grid.dims[1],
        nz: diagnostics.grid.dims[2],
        dx_m: pickNumber(diagnostics.grid.voxelSize_m?.[0]),
        dy_m: pickNumber(diagnostics.grid.voxelSize_m?.[1]),
        dz_m: pickNumber(diagnostics.grid.voxelSize_m?.[2]),
        voxelSize_m: voxelSize,
      }
    : undefined;

  const provenance =
    input.essenceId || input.informationBoundary
      ? {
          ...(input.essenceId ? { essence_id: input.essenceId } : {}),
          ...(input.informationBoundary
            ? { information_boundary: input.informationBoundary }
            : {}),
        }
      : undefined;

  const actions = buildActions({
    evaluation,
    hardFails,
    softFails,
    unknownHard,
    certificateOk,
    certificateStatusOk,
    requiresCertificate,
    diagnosticsPresent,
  });

  const payload: GrOsPayload = {
    schema_version: "gr-os/0.1",
    stage,
    timestamp: new Date(evaluation.updatedAt).toISOString(),
    ...(gridPayload ? { grid: gridPayload } : {}),
    constraints: constraintsSummary,
    ...(stressEnergyPayload ? { stress_energy: stressEnergyPayload } : {}),
    ...(gaugePayload ? { gauge: gaugePayload } : {}),
    ...(stabilityPayload ? { stability: stabilityPayload } : {}),
    viability: {
      status: viabilityStatus,
      certificate_hash: evaluation.certificate.certificateHash ?? null,
      certificate_id: evaluation.certificate.certificateId ?? null,
      integrity_ok: evaluation.certificate.integrityOk,
    },
    ...(provenance ? { provenance } : {}),
    actions,
  };

  return grOsPayloadSchema.parse(payload);
}
