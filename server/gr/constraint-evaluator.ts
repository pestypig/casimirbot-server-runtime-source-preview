import type {
  GrConstraintEntry,
  GrConstraintGate,
  GrConstraintMetrics,
  GrConstraintPolicy,
  GrConstraintThresholds,
} from "../../shared/schema.js";
import type { GrPipelineDiagnostics } from "../energy-pipeline.js";
import type { BssnState } from "../../modules/gr/bssn-state.ts";
import type { StressEnergyFieldSet } from "../../modules/gr/stress-energy.ts";
import {
  computeBssnConstraints,
  type ConstraintFields,
  type StencilParams,
} from "../../modules/gr/bssn-evolve.ts";

export type SemiclassicalResiduals = {
  G_mu_nu_rms?: number;
  T_mu_nu_renorm_rms?: number;
  mismatch_rms?: number;
};

export type SemiclassicalPolicyHooks = {
  mismatchMax?: number;
  severity?: "HARD" | "SOFT";
  firstFailId?: string;
};

export type GrConstraintGateEvaluation = {
  constraints: GrConstraintEntry[];
  gate: GrConstraintGate;
  notes: string[];
  semiclassicalResiduals?: SemiclassicalResiduals;
  firstFailId?: string;
};

export const DEFAULT_GR_CONSTRAINT_THRESHOLDS: GrConstraintThresholds = {
  H_rms_max: 1e-2,
  M_rms_max: 1e-3,
  H_maxAbs_max: 1e-1,
  M_maxAbs_max: 1e-2,
};

export const DEFAULT_GR_CONSTRAINT_POLICY: GrConstraintPolicy = {
  mode: "hard-only",
  unknownAsFail: true,
};

const mergeOverrides = <T extends Record<string, unknown>>(
  base: T,
  overrides?: Partial<T>,
): T => {
  if (!overrides) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
};

const formatLimit = (value: number) => `<= ${value}`;

const rmsFromArray = (data: Float32Array): number => {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
};

const maxAbsFromArray = (data: Float32Array): number => {
  let maxAbs = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = Math.abs(data[i]);
    if (v > maxAbs) maxAbs = v;
  }
  return maxAbs;
};

const rmsFromVector = (
  x: Float32Array,
  y: Float32Array,
  z: Float32Array,
): number => {
  const len = Math.min(x.length, y.length, z.length);
  if (!len) return 0;
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    const vx = x[i];
    const vy = y[i];
    const vz = z[i];
    sum += vx * vx + vy * vy + vz * vz;
  }
  return Math.sqrt(sum / len);
};

const maxAbsFromVector = (
  x: Float32Array,
  y: Float32Array,
  z: Float32Array,
): number => {
  const len = Math.min(x.length, y.length, z.length);
  if (!len) return 0;
  let maxAbs = 0;
  for (let i = 0; i < len; i += 1) {
    const v = Math.hypot(x[i], y[i], z[i]);
    if (v > maxAbs) maxAbs = v;
  }
  return maxAbs;
};

const sanitizeMetric = (value: number): number =>
  Number.isFinite(value) ? value : 0;

export const summarizeConstraintFields = (
  constraints: ConstraintFields,
): GrConstraintMetrics => ({
  H_rms: sanitizeMetric(rmsFromArray(constraints.H)),
  M_rms: sanitizeMetric(
    rmsFromVector(constraints.Mx, constraints.My, constraints.Mz),
  ),
  H_maxAbs: sanitizeMetric(maxAbsFromArray(constraints.H)),
  M_maxAbs: sanitizeMetric(
    maxAbsFromVector(constraints.Mx, constraints.My, constraints.Mz),
  ),
});

const buildEntry = ({
  id,
  severity,
  value,
  limit,
  label,
}: {
  id: string;
  severity: GrConstraintEntry["severity"];
  value?: number;
  limit?: number;
  label: string;
}): GrConstraintEntry => {
  const hasValue = Number.isFinite(value);
  const hasLimit = Number.isFinite(limit);
  let status: GrConstraintEntry["status"] = "unknown";
  let note: string | undefined;

  if (!hasValue) {
    note = `Missing ${label} diagnostics.`;
  } else if (!hasLimit) {
    note = `Threshold not configured for ${label}.`;
  } else {
    status = (value as number) <= (limit as number) ? "pass" : "fail";
  }

  return {
    id,
    severity,
    status,
    ...(hasValue ? { value: value as number } : {}),
    ...(hasLimit ? { limit: formatLimit(limit as number) } : {}),
    proxy: false,
    ...(note ? { note } : {}),
  };
};

const evaluateFromMetrics = (
  metrics: {
    H_rms?: number;
    M_rms?: number;
    H_maxAbs?: number;
    M_maxAbs?: number;
    semiclassical_G_mu_nu_rms?: number;
    semiclassical_T_mu_nu_renorm_rms?: number;
    semiclassical_mismatch_rms?: number;
  },
  options?: {
    thresholds?: Partial<GrConstraintThresholds>;
    policy?: Partial<GrConstraintPolicy>;
    semiclassical?: SemiclassicalPolicyHooks;
  },
): GrConstraintGateEvaluation => {
  const thresholds = mergeOverrides(
    { ...DEFAULT_GR_CONSTRAINT_THRESHOLDS },
    options?.thresholds,
  );
  const policy = mergeOverrides(
    { ...DEFAULT_GR_CONSTRAINT_POLICY },
    options?.policy,
  );

  const constraints: GrConstraintEntry[] = [
    buildEntry({
      id: "BSSN_H_rms",
      severity: "HARD",
      value: metrics.H_rms,
      limit: thresholds.H_rms_max,
      label: "H_rms",
    }),
    buildEntry({
      id: "BSSN_M_rms",
      severity: "HARD",
      value: metrics.M_rms,
      limit: thresholds.M_rms_max,
      label: "M_rms",
    }),
  ];

  if (Number.isFinite(thresholds.H_maxAbs_max)) {
    constraints.push(
      buildEntry({
        id: "BSSN_H_maxAbs",
        severity: "SOFT",
        value: metrics.H_maxAbs,
        limit: thresholds.H_maxAbs_max,
        label: "H_maxAbs",
      }),
    );
  }


  const semiclassical = options?.semiclassical;
  const semiclassicalResiduals =
    Number.isFinite(metrics.semiclassical_G_mu_nu_rms) ||
    Number.isFinite(metrics.semiclassical_T_mu_nu_renorm_rms) ||
    Number.isFinite(metrics.semiclassical_mismatch_rms)
      ? {
          G_mu_nu_rms: Number.isFinite(metrics.semiclassical_G_mu_nu_rms)
            ? metrics.semiclassical_G_mu_nu_rms
            : undefined,
          T_mu_nu_renorm_rms: Number.isFinite(metrics.semiclassical_T_mu_nu_renorm_rms)
            ? metrics.semiclassical_T_mu_nu_renorm_rms
            : undefined,
          mismatch_rms: Number.isFinite(metrics.semiclassical_mismatch_rms)
            ? metrics.semiclassical_mismatch_rms
            : undefined,
        }
      : undefined;

  if (Number.isFinite(semiclassical?.mismatchMax)) {
    const mismatchEntry = buildEntry({
      id: "SEMICLASSICAL_COUPLING_MISMATCH",
      severity: semiclassical?.severity ?? "HARD",
      value: metrics.semiclassical_mismatch_rms,
      limit: semiclassical?.mismatchMax,
      label: "semiclassical_mismatch_rms",
    });
    constraints.push(mismatchEntry);
  }

  if (Number.isFinite(thresholds.M_maxAbs_max)) {
    constraints.push(
      buildEntry({
        id: "BSSN_M_maxAbs",
        severity: "SOFT",
        value: metrics.M_maxAbs,
        limit: thresholds.M_maxAbs_max,
        label: "M_maxAbs",
      }),
    );
  }

  const relevant =
    policy.mode === "hard-only"
      ? constraints.filter((entry) => entry.severity === "HARD")
      : constraints;
  const hasFail = relevant.some((entry) => entry.status === "fail");
  const hasUnknown = relevant.some((entry) => entry.status === "unknown");

  let status: GrConstraintGate["status"] = "pass";
  if (hasFail) {
    status = "fail";
  } else if (hasUnknown) {
    status = policy.unknownAsFail ? "fail" : "unknown";
  }

  const notes: string[] = [];
  const missingHardNotes = constraints
    .filter(
      (entry) =>
        entry.severity === "HARD" &&
        entry.status === "unknown" &&
        entry.note,
    )
    .map((entry) => entry.note as string);
  for (const note of missingHardNotes) {
    if (!notes.includes(note)) {
      notes.push(note);
    }
  }
  const hasAnyMetric = Object.values(metrics).some((value) =>
    Number.isFinite(value),
  );
  if (!hasAnyMetric) {
    notes.push("Missing GR constraint diagnostics; cannot evaluate.");
  }

  const firstFail = relevant.find((entry) => entry.status === "fail" && entry.severity === "HARD");
  const firstFailId = firstFail?.id === "SEMICLASSICAL_COUPLING_MISMATCH"
    ? (semiclassical?.firstFailId ?? "SEMICLASSICAL_COUPLING_MISMATCH_HARD_FAIL")
    : firstFail?.id;

  const gate: GrConstraintGate = {
    status,
    evaluatedAt: Date.now(),
    thresholds,
    policy,
  };

  return {
    constraints,
    gate,
    notes,
    semiclassicalResiduals,
    ...(firstFailId ? { firstFailId } : {}),
  };
};

export function evaluateGrConstraintGateFromMetrics(
  metrics: Partial<
    GrConstraintMetrics & {
      semiclassical_G_mu_nu_rms?: number;
      semiclassical_T_mu_nu_renorm_rms?: number;
      semiclassical_mismatch_rms?: number;
    }
  >,
  options?: {
    thresholds?: Partial<GrConstraintThresholds>;
    policy?: Partial<GrConstraintPolicy>;
    semiclassical?: SemiclassicalPolicyHooks;
  },
): GrConstraintGateEvaluation {
  return evaluateFromMetrics(metrics, options);
}

export function evaluateGrConstraintGateFromDiagnostics(
  diagnostics?: (GrPipelineDiagnostics["constraints"] & {
    semiclassical?: {
      G_mu_nu_rms?: number;
      T_mu_nu_renorm_rms?: number;
      mismatch_rms?: number;
    };
  }) | null,
  options?: {
    thresholds?: Partial<GrConstraintThresholds>;
    policy?: Partial<GrConstraintPolicy>;
    semiclassical?: SemiclassicalPolicyHooks;
  },
): GrConstraintGateEvaluation {
  const metrics = {
    H_rms: diagnostics?.H_constraint?.rms,
    M_rms: diagnostics?.M_constraint?.rms,
    H_maxAbs: diagnostics?.H_constraint?.maxAbs,
    M_maxAbs: diagnostics?.M_constraint?.maxAbs,
    semiclassical_G_mu_nu_rms: diagnostics?.semiclassical?.G_mu_nu_rms,
    semiclassical_T_mu_nu_renorm_rms: diagnostics?.semiclassical?.T_mu_nu_renorm_rms,
    semiclassical_mismatch_rms: diagnostics?.semiclassical?.mismatch_rms,
  };
  return evaluateFromMetrics(metrics, options);
}

export function evaluateGrConstraintGateFromConstraintFields(
  constraints: ConstraintFields,
  options?: {
    thresholds?: Partial<GrConstraintThresholds>;
    policy?: Partial<GrConstraintPolicy>;
    semiclassical?: SemiclassicalPolicyHooks;
  },
): GrConstraintGateEvaluation {
  const metrics = {
    H_rms: rmsFromArray(constraints.H),
    M_rms: rmsFromVector(constraints.Mx, constraints.My, constraints.Mz),
    H_maxAbs: maxAbsFromArray(constraints.H),
    M_maxAbs: maxAbsFromVector(constraints.Mx, constraints.My, constraints.Mz),
  };
  return evaluateFromMetrics(metrics, options);
}

export function evaluateGrConstraintGateFromState(
  state: BssnState,
  params: {
    stencils?: StencilParams;
    matter?: StressEnergyFieldSet | null;
    thresholds?: Partial<GrConstraintThresholds>;
    policy?: Partial<GrConstraintPolicy>;
    semiclassical?: SemiclassicalPolicyHooks;
  } = {},
): GrConstraintGateEvaluation {
  const constraints = computeBssnConstraints(state, {
    stencils: params.stencils,
    matter: params.matter ?? null,
  });
  return evaluateGrConstraintGateFromConstraintFields(constraints, params);
}
