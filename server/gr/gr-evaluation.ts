import { issueWarpViabilityCertificate } from "../../tools/warpViabilityCertificate.js";
import { verifyCertificateIntegrity, verifyPhysicsCertificate } from "../../tools/verifyCertificate.js";
import type {
  GrConstraintPolicy,
  GrConstraintThresholds,
  GrEvaluation,
} from "../../shared/schema.js";
import type { PipelineSnapshot } from "../../types/pipeline.js";
import type { WarpConfig, WarpViabilityCertificate } from "../../types/warpViability.js";
import type { GrPipelineDiagnostics } from "../energy-pipeline.js";
import {
  evaluateGrConstraintGateFromDiagnostics,
  type SemiclassicalPolicyHooks,
} from "./constraint-evaluator.js";
import { resolveGrConstraintPolicyBundle } from "./gr-constraint-policy.js";
import { withSpan } from "../services/observability/otel-tracing.js";

export type GrEvaluationInput = {
  diagnostics?: GrPipelineDiagnostics | null;
  snapshot?: PipelineSnapshot;
  warpConfig?: WarpConfig;
  thresholds?: Partial<GrConstraintThresholds>;
  policy?: Partial<GrConstraintPolicy>;
  semiclassical?: SemiclassicalPolicyHooks;
  useLiveSnapshot?: boolean;
  useDiagnosticsSnapshot?: boolean;
};

export type GrEvaluationResult = {
  evaluation: GrEvaluation;
  certificate: WarpViabilityCertificate;
  integrityOk: boolean;
};

export type G4ConstraintDiagnostics = {
  fordRomanStatus: "pass" | "fail" | "unknown" | "missing";
  thetaAuditStatus: "pass" | "fail" | "unknown" | "missing";
  source: "evaluator_constraints" | "synthesized_unknown";
  reason: string[];
  reasonCode: string[];
  applicabilityStatus?: string;
  curvatureOk?: boolean;
  curvatureRatio?: number;
};

const G4_REASON_CODES = {
  marginExceeded: "G4_QI_MARGIN_EXCEEDED",
  sourceNotMetric: "G4_QI_SOURCE_NOT_METRIC",
  contractMissing: "G4_QI_CONTRACT_MISSING",
  curvatureWindowFail: "G4_QI_CURVATURE_WINDOW_FAIL",
  applicabilityNotPass: "G4_QI_APPLICABILITY_NOT_PASS",
  signalMissing: "G4_QI_SIGNAL_MISSING",
} as const;
const G4_REASON_CODE_ORDER = [
  G4_REASON_CODES.signalMissing,
  G4_REASON_CODES.sourceNotMetric,
  G4_REASON_CODES.contractMissing,
  G4_REASON_CODES.curvatureWindowFail,
  G4_REASON_CODES.applicabilityNotPass,
  G4_REASON_CODES.marginExceeded,
] as const;

const SYNTHESIZED_SOURCE_PREFIX = "source=synthesized_unknown";
const readConstraintMessage = (
  entry: { note?: string; message?: string } | undefined,
): string | undefined => {
  const note = entry?.note;
  if (typeof note === "string" && note.trim().length > 0) return note;
  const message = entry?.message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  return undefined;
};

const readConstraintReasonCode = (
  entry: { note?: string } | undefined,
): string[] => {
  const note = entry?.note;
  if (typeof note !== "string") return [];
  return Array.from(note.matchAll(/reasonCode=([A-Z0-9_]+)/g)).map((m) => m[1]);
};


const parseFordField = (entry: { note?: string } | undefined, key: string): string | undefined => {
  if (typeof entry?.note !== "string") return undefined;
  const segments = entry.note.split(/[;|]/g).map((segment) => segment.trim());
  const match = segments.find((segment) => segment.startsWith(`${key}=`));
  if (!match) return undefined;
  const value = match.slice(key.length + 1).trim();
  return value.length > 0 ? value : undefined;
};

const parseFinite = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const orderReasonCodes = (codes: string[]): string[] => {
  const unique = Array.from(new Set(codes));
  return unique.sort((a, b) => {
    const ia = G4_REASON_CODE_ORDER.indexOf(a as (typeof G4_REASON_CODE_ORDER)[number]);
    const ib = G4_REASON_CODE_ORDER.indexOf(b as (typeof G4_REASON_CODE_ORDER)[number]);
    const na = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
    const nb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
    return na - nb || a.localeCompare(b);
  });
};

export const extractG4ConstraintDiagnostics = (constraints: GrEvaluation["constraints"]): G4ConstraintDiagnostics => {
  const ford = constraints.find((entry) => entry.id === "FordRomanQI");
  const theta = constraints.find((entry) => entry.id === "ThetaAudit");
  const normalize = (status: string | undefined): G4ConstraintDiagnostics["fordRomanStatus"] => {
    if (!status) return "missing";
    if (status === "pass" || status === "fail" || status === "unknown") return status;
    return "unknown";
  };
  const hasSynthesizedTag = [ford, theta].some(
    (entry) => typeof entry?.note === "string" && entry.note.includes(SYNTHESIZED_SOURCE_PREFIX),
  );
  const missingAnyHardSource = !ford || !theta;
  const source: G4ConstraintDiagnostics["source"] =
    hasSynthesizedTag || missingAnyHardSource ? "synthesized_unknown" : "evaluator_constraints";
  const reason = [readConstraintMessage(ford), readConstraintMessage(theta)].filter(
    (entry): entry is string => Boolean(entry && entry.trim()),
  );
  const reasonCode = [...readConstraintReasonCode(ford), ...readConstraintReasonCode(theta)];

  if ((!ford || !theta) && !reasonCode.includes(G4_REASON_CODES.signalMissing)) {
    reasonCode.push(G4_REASON_CODES.signalMissing);
    reason.push(`${SYNTHESIZED_SOURCE_PREFIX};reasonCode=${G4_REASON_CODES.signalMissing};G4 hard-source payload incomplete in evaluation constraints.`);
  }

  const applicabilityStatus = parseFordField(ford, "applicabilityStatus");
  const curvatureOkRaw = parseFordField(ford, "curvatureOk");
  const curvatureOk =
    curvatureOkRaw === "true"
      ? true
      : curvatureOkRaw === "false"
        ? false
        : undefined;
  const curvatureRatio = parseFinite(parseFordField(ford, "curvatureRatio"));

  return {
    fordRomanStatus: normalize(ford?.status),
    thetaAuditStatus: normalize(theta?.status),
    source,
    reason,
    reasonCode: orderReasonCodes(reasonCode),
    applicabilityStatus,
    curvatureOk,
    curvatureRatio,
  };
};


const normalizeConstraintStatus = (status: string | undefined): "pass" | "fail" | "unknown" => {
  if (status === "pass" || status === "fail" || status === "unknown") return status;
  return "unknown";
};

const toHardConstraintEntry = (
  input: { id: string; severity: "HARD" | "SOFT"; passed: boolean; note?: string; details?: string } | undefined,
  id: "FordRomanQI" | "ThetaAudit",
): GrEvaluation["constraints"][number] => {
  if (!input) {
    return {
      id,
      severity: "HARD",
      status: "unknown",
      proxy: false,
      note: `reasonCode=${G4_REASON_CODES.signalMissing};${SYNTHESIZED_SOURCE_PREFIX};${id} missing from warp-viability evaluator constraints.`,
    };
  }

  const detail = [input.details, input.note]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" | ");
  return {
    id,
    severity: "HARD",
    status: input.passed ? "pass" : "fail",
    proxy: false,
    ...(detail ? { note: detail } : {}),
  };
};

const ensureHardConstraintEntries = (
  constraints: GrEvaluation["constraints"],
  certificate: WarpViabilityCertificate,
): GrEvaluation["constraints"] => {
  const byId = new Map(constraints.map((entry) => [entry.id, entry]));
  const certificateConstraints = certificate.payload?.constraints ?? [];
  const ford = certificateConstraints.find((entry) => entry.id === "FordRomanQI");
  const theta = certificateConstraints.find((entry) => entry.id === "ThetaAudit");
  byId.set("FordRomanQI", toHardConstraintEntry(ford, "FordRomanQI"));
  byId.set("ThetaAudit", toHardConstraintEntry(theta, "ThetaAudit"));

  for (const [id, entry] of byId) {
    byId.set(id, { ...entry, status: normalizeConstraintStatus(entry.status) });
  }

  return Array.from(byId.values());
};

export async function runGrEvaluation(
  input: GrEvaluationInput,
): Promise<GrEvaluationResult> {
  return withSpan(
    "gr.constraint.evaluate",
    {
      spanKind: "internal",
      attributes: {
        "gr.has_diagnostics": Boolean(input.diagnostics),
        "gr.use_live_snapshot": Boolean(input.useLiveSnapshot),
      },
    },
    async (span) => {
      const diagnostics = input.diagnostics ?? null;
      const policyBundle = await resolveGrConstraintPolicyBundle({
        thresholds: input.thresholds,
        policy: input.policy,
      });
      const gateEval = evaluateGrConstraintGateFromDiagnostics(
        diagnostics?.constraints ?? null,
        {
          thresholds: policyBundle.gate.thresholds,
          policy: policyBundle.gate.policy,
          semiclassical: input.semiclassical,
        },
      );
      const diagnosticsSnapshot =
        input.snapshot ??
        (input.useDiagnosticsSnapshot && diagnostics
          ? ({ gr: diagnostics } as unknown as PipelineSnapshot)
          : undefined);
      const certificate = await issueWarpViabilityCertificate(
        input.warpConfig ?? {},
        {
          useLiveSnapshot: input.useLiveSnapshot,
          ...(diagnosticsSnapshot ? { snapshot: diagnosticsSnapshot } : {}),
        },
      );
      const integrityOk = verifyCertificateIntegrity(certificate);
      const authenticity = verifyPhysicsCertificate(certificate, {
        authenticityConsequence: "low",
      }).authenticity;
      const certificateStatus = certificate.payload?.status ?? "NOT_CERTIFIED";
      const admissibleStatus = policyBundle.certificate.admissibleStatus;
      const allowMarginal = policyBundle.certificate.allowMarginalAsViable;
      const hasCertificate = Boolean(certificate.certificateHash);
      const requiresCertificate =
        policyBundle.certificate.treatMissingCertificateAsNotCertified;
      const statusOk =
        certificateStatus === admissibleStatus ||
        (allowMarginal && certificateStatus === "MARGINAL");

      const residuals = {
        H_rms: diagnostics?.constraints?.H_constraint?.rms,
        M_rms: diagnostics?.constraints?.M_constraint?.rms,
        H_maxAbs: diagnostics?.constraints?.H_constraint?.maxAbs,
        M_maxAbs: diagnostics?.constraints?.M_constraint?.maxAbs,
        semiclassical: gateEval.semiclassicalResiduals,
      };

      const notes = [...gateEval.notes];
      const cfl = diagnostics?.solver?.cfl;
      if (Number.isFinite(cfl) && (cfl as number) > 1) {
        notes.push(
          `CFL=${(cfl as number).toExponential(2)} too high; lower evolveDt_s or increase grid resolution.`,
        );
      } else if (!Number.isFinite(cfl)) {
        notes.push("CFL is non-finite; check GR evolve step settings.");
      }
      if (gateEval.firstFailId) {
        notes.push(`Deterministic first-fail id: ${gateEval.firstFailId}`);
      }
      if (!integrityOk) {
        notes.push("Warp viability certificate integrity check failed.");
      }
      if (!hasCertificate && requiresCertificate) {
        notes.push("Warp viability certificate missing; policy requires certification.");
      }
      if (hasCertificate && !statusOk) {
        const allowed = allowMarginal ? `${admissibleStatus} or MARGINAL` : admissibleStatus;
        notes.push(`Warp viability status ${certificateStatus} does not satisfy policy (${allowed}).`);
      }

      const certificateOk =
        integrityOk &&
        (hasCertificate || !requiresCertificate) &&
        (hasCertificate ? statusOk : true);
      const pass = gateEval.gate.status === "pass" && certificateOk;

      span.addAttributes({
        "gr.gate.status": gateEval.gate.status,
        "gr.constraints.count": gateEval.constraints.length,
        "gr.pass": pass,
        "warp.certificate.status": certificateStatus,
        "warp.certificate.integrity_ok": integrityOk,
        "warp.certificate.authenticity_ok": authenticity.ok,
        "warp.certificate.authenticity_required": authenticity.enforced,
      });
      span.status = pass
        ? { code: "OK" }
        : { code: "ERROR", message: "GR constraint gate failed" };

      const completeConstraints = ensureHardConstraintEntries(gateEval.constraints, certificate);
      const g4Diagnostics = extractG4ConstraintDiagnostics(completeConstraints);
      if (g4Diagnostics.reason.length > 0) {
        notes.push(`G4 diagnostics: FordRomanQI=${g4Diagnostics.fordRomanStatus}, ThetaAudit=${g4Diagnostics.thetaAuditStatus}, source=${g4Diagnostics.source}. ${g4Diagnostics.reason.join(" | ")}`);
      }

      const evaluation: GrEvaluation = {
        kind: "gr-evaluation",
        updatedAt: Date.now(),
        policy: policyBundle,
        residuals,
        gate: { ...gateEval.gate, status: normalizeConstraintStatus(gateEval.gate.status) },
        constraints: completeConstraints,
        certificate: {
          status: certificateStatus,
          admissibleStatus,
          hasCertificate,
          certificateHash: certificate.certificateHash ?? null,
          certificateId: certificate.header?.id ?? null,
          integrityOk,
          authenticityOk: authenticity.ok,
          authenticityRequired: authenticity.enforced,
          authenticityConsequence: authenticity.consequence,
          authenticityReasonCodes: authenticity.reasonCodes,
        },
        pass,
        notes: notes.length ? notes : undefined,
      };

      return { evaluation, certificate, integrityOk };
    },
  );
}
