import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EssenceEnvelope } from "@shared/essence-schema";
import type { ToolHandler, ToolSpecShape } from "@shared/skills";
import {
  grConstraintPolicySchema,
  grConstraintThresholdSchema,
  grGroundingSchema,
  grOsPayloadSchema,
  type GrConstraintEntry,
  type GrGrounding,
} from "@shared/schema";
import type { WarpConfig } from "../../types/warpViability";
import { loadWarpAgentsConfig } from "../../modules/physics/warpAgents";
import { getGlobalPipelineState } from "../energy-pipeline";
import { buildGrOsPayload } from "../gr/gr-os-payload";
import { runGrEvaluation } from "../gr/gr-evaluation";
import { SupplementSchema, type Supplement } from "../services/planner/supplements";
import { putBlob } from "../storage";
import { buildInformationBoundary, sha256Hex } from "../utils/information-boundary";
import { stableJsonStringify } from "../utils/stable-json";
import { putEnvelopeWithPolicy } from "./provenance";
import { recordGrOsPayload } from "../services/observability/gr-os-payload-store";

const GR_GROUNDING_TOOL_NAME = "physics.gr.grounding";

const WarpConfigSchema = z
  .object({
    bubbleRadius_m: z.number().optional(),
    wallThickness_m: z.number().optional(),
    targetVelocity_c: z.number().optional(),
    tileConfigId: z.string().optional(),
    tileCount: z.number().optional(),
    dutyCycle: z.number().min(0).max(1).optional(),
    gammaGeoOverride: z.number().optional(),
  })
  .passthrough();

const GrGroundingInput = z
  .object({
    warpConfig: WarpConfigSchema.optional(),
    config: WarpConfigSchema.optional(),
    thresholds: grConstraintThresholdSchema.partial().optional(),
    policy: grConstraintPolicySchema.partial().optional(),
    useLiveSnapshot: z.boolean().optional(),
  })
  .passthrough();

const GrGroundingOutputSchema = grGroundingSchema.extend({
  supplement: SupplementSchema.optional(),
  essence_id: z.string().optional(),
  os_payload: grOsPayloadSchema.optional(),
});

const formatNumber = (value?: number): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) {
    return value.toExponential(3);
  }
  return Number(value.toPrecision(6)).toString();
};

const formatConstraintLine = (constraint: GrConstraintEntry): string => {
  const status = constraint.status.toUpperCase();
  const value =
    constraint.value !== undefined && constraint.value !== null
      ? formatNumber(constraint.value)
      : "n/a";
  const limit = constraint.limit ?? "n/a";
  return `${status} ${constraint.id} (${constraint.severity}) value=${value} limit=${limit}`;
};

const pickFirstFail = (
  constraints: GrConstraintEntry[],
): GrConstraintEntry | undefined =>
  constraints.find((entry) => entry.severity === "HARD" && entry.status === "fail") ??
  constraints.find((entry) => entry.status === "fail");

const buildPolicyVersion = async (args: {
  gateVersion?: number;
  overridesApplied?: boolean;
}): Promise<string> => {
  const parts: string[] = [];
  try {
    const config = await loadWarpAgentsConfig();
    parts.push(`warp-agents-v${config.version}`);
  } catch {
    parts.push("warp-agents-unknown");
  }
  if (args.gateVersion) {
    parts.push(`gate-v${args.gateVersion}`);
  }
  if (args.overridesApplied) {
    parts.push("overrides");
  }
  return parts.join(":");
};

const buildSupplement = (grounding: GrGrounding): Supplement => {
  const residuals = grounding.residuals;
  const certificate = grounding.certificate;
  const lines: string[] = [
    `policy: ${grounding.policyVersion}`,
    `pass: ${grounding.pass ? "true" : "false"}`,
    `residuals: H_rms=${formatNumber(residuals.H_rms)} M_rms=${formatNumber(
      residuals.M_rms,
    )} H_maxAbs=${formatNumber(residuals.H_maxAbs)} M_maxAbs=${formatNumber(
      residuals.M_maxAbs,
    )}`,
    `certificate: status=${certificate.status}${
      certificate.certificateHash ? ` hash=${certificate.certificateHash}` : ""
    }`,
  ];
  const firstFail = pickFirstFail(grounding.constraints);
  if (firstFail) {
    lines.push(`first_fail: ${firstFail.id} (${firstFail.severity})`);
  }
  if (grounding.proxy) {
    lines.push("proxy: true");
  }
  const constraintLines = grounding.constraints.map(formatConstraintLine);
  lines.push("constraints:");
  lines.push(...constraintLines);
  if (grounding.notes && grounding.notes.length > 0) {
    lines.push(`notes: ${grounding.notes.join(" | ")}`);
  }
  return {
    kind: "metrics",
    tool: GR_GROUNDING_TOOL_NAME,
    title: "GR Grounding",
    summary: `GR grounding ${grounding.pass ? "pass" : "fail"} (policy ${grounding.policyVersion})`,
    detail: lines.join("\n"),
    importance: 0.85,
  };
};

export const grGroundingSpec: ToolSpecShape = {
  name: GR_GROUNDING_TOOL_NAME,
  desc: "Summarize GR constraint residuals with policy version and certificate reference",
  inputSchema: GrGroundingInput,
  outputSchema: GrGroundingOutputSchema,
  deterministic: true,
  rateLimit: { rpm: 30 },
  safety: { risks: [] },
  risk: { writesFiles: false, touchesNetwork: false, privileged: false },
  health: "ok",
};

export const grGroundingHandler: ToolHandler = async (rawInput, ctx) => {
  const startedAt = Date.now();
  const input = GrGroundingInput.parse(rawInput ?? {});
  const state = getGlobalPipelineState();
  const diagnostics = (state as any)?.gr ?? null;
  const warpConfig = (input.warpConfig ?? input.config ?? {}) as WarpConfig;
  const evaluation = await runGrEvaluation({
    diagnostics,
    warpConfig,
    thresholds: input.thresholds,
    policy: input.policy,
    useLiveSnapshot: input.useLiveSnapshot,
  });
  const overridesApplied =
    Boolean(input.thresholds || input.policy) ||
    Boolean(evaluation.evaluation.policy?.gate?.overridesApplied);
  const policyVersion = await buildPolicyVersion({
    gateVersion: evaluation.evaluation.policy?.gate?.version,
    overridesApplied,
  });
  const proxy =
    !diagnostics ||
    evaluation.evaluation.constraints.some(
      (entry) => entry.status === "unknown" || entry.proxy,
    );
  const grounding: GrGrounding = {
    kind: "gr-grounding",
    version: 1,
    updatedAt: evaluation.evaluation.updatedAt,
    policyVersion,
    residuals: evaluation.evaluation.residuals,
    constraints: evaluation.evaluation.constraints,
    certificate: {
      status: evaluation.evaluation.certificate.status,
      admissibleStatus: evaluation.evaluation.certificate.admissibleStatus,
      hasCertificate: evaluation.evaluation.certificate.hasCertificate,
      certificateHash: evaluation.evaluation.certificate.certificateHash ?? null,
      certificateId: evaluation.evaluation.certificate.certificateId ?? null,
      integrityOk: evaluation.evaluation.certificate.integrityOk,
    },
    pass: evaluation.evaluation.pass,
    ...(evaluation.evaluation.notes ? { notes: evaluation.evaluation.notes } : {}),
    ...(proxy ? { proxy: true } : {}),
  };

  const nowIso = new Date().toISOString();
  const dataCutoffIso =
    typeof (ctx as { dataCutoffIso?: string } | undefined)?.dataCutoffIso === "string" &&
    (ctx as { dataCutoffIso?: string }).dataCutoffIso?.trim()
      ? new Date((ctx as { dataCutoffIso: string }).dataCutoffIso).toISOString()
      : nowIso;
  const envelopeId = randomUUID();
  const creatorId =
    typeof (ctx as { personaId?: string } | undefined)?.personaId === "string"
      ? (ctx as { personaId: string }).personaId
      : "persona:unknown";

  const payloadBase = buildGrOsPayload({
    evaluation: evaluation.evaluation,
    diagnostics,
    essenceId: envelopeId,
  });
  const inputPayload = {
    warpConfig,
    thresholds: input.thresholds ?? null,
    policy: input.policy ?? null,
    useLiveSnapshot: input.useLiveSnapshot ?? null,
    diagnostics: diagnostics ?? null,
    evaluation: {
      policy: evaluation.evaluation.policy,
      residuals: evaluation.evaluation.residuals,
      gate: evaluation.evaluation.gate,
      constraints: evaluation.evaluation.constraints,
      certificate: evaluation.evaluation.certificate,
      pass: evaluation.evaluation.pass,
    },
  };
  const payloadForBoundary = {
    ...payloadBase,
    ...(payloadBase.provenance
      ? { provenance: { essence_id: payloadBase.provenance.essence_id } }
      : {}),
  };
  const informationBoundary = buildInformationBoundary({
    data_cutoff_iso: dataCutoffIso,
    mode: "observables",
    labels_used_as_features: false,
    event_features_included: false,
    inputs: inputPayload,
    features: payloadForBoundary,
  });
  const osPayload = grOsPayloadSchema.parse({
    ...payloadBase,
    provenance: {
      ...(payloadBase.provenance ?? {}),
      information_boundary: informationBoundary,
    },
  });

  const payloadJson = stableJsonStringify(osPayload);
  const outputHash = sha256Hex(payloadJson);
  const inputHash = sha256Hex(stableJsonStringify(inputPayload));
  const blob = await putBlob(Buffer.from(payloadJson, "utf8"), {
    contentType: "application/json",
  });

  const envelope = EssenceEnvelope.parse({
    header: {
      id: envelopeId,
      version: "essence/1.0",
      modality: "text",
      created_at: nowIso,
      source: {
        uri: blob.uri,
        original_hash: { algo: "sha256", value: outputHash },
        mime: "application/json",
        creator_id: creatorId,
        license: "CC-BY-4.0",
        cid: blob.cid,
      },
      rights: {
        allow_mix: true,
        allow_remix: true,
        allow_commercial: false,
        attribution: true,
      },
      acl: { visibility: "private", groups: [] },
    },
    features: {
      physics: {
        kind: "gr-os",
        payload: osPayload,
      },
    },
    embeddings: [],
    provenance: {
      pipeline: [
        {
          name: "gr-os-payload",
          impl_version: "1.0.0",
          lib_hash: {
            algo: "sha256",
            value: sha256Hex(Buffer.from("gr-os-payload@1")),
          },
          params: {
            warpConfig,
            thresholds: input.thresholds,
            policy: input.policy,
            useLiveSnapshot: input.useLiveSnapshot,
          },
          input_hash: { algo: "sha256", value: inputHash },
          output_hash: { algo: "sha256", value: outputHash },
          started_at: nowIso,
          ended_at: nowIso,
        },
      ],
      merkle_root: { algo: "sha256", value: outputHash },
      previous: null,
      signatures: [],
      information_boundary: informationBoundary,
    },
  });

  await putEnvelopeWithPolicy(envelope);
  recordGrOsPayload({
    stage: osPayload.stage,
    pass: grounding.pass,
    constraints_status: osPayload.constraints?.status,
    viability_status: osPayload.viability?.status,
    certificate_hash: osPayload.viability?.certificate_hash ?? null,
    integrity_ok: osPayload.viability?.integrity_ok,
    essence_id: envelopeId,
    payload: osPayload,
    ts: new Date(startedAt).toISOString(),
  });

  const supplement = buildSupplement(grounding);
  return GrGroundingOutputSchema.parse({
    ...grounding,
    supplement,
    essence_id: envelopeId,
    os_payload: osPayload,
  });
};
