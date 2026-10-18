import { createHash } from "node:crypto";
import { z } from "zod";
import {
  THEORY_BADGE_EDGE_RELATIONS,
  THEORY_BADGE_LEVELS,
  THEORY_BADGE_OBSERVABLE_BRIDGE_KINDS,
  THEORY_BADGE_OBSERVABLE_ERROR_KINDS,
  THEORY_BADGE_OBSERVABLE_MATHEMATICAL_TYPES,
  THEORY_BADGE_SCALE_ENVELOPE_BASES,
  THEORY_BADGE_STATUSES,
  validateTheoryBadgeGraphV1,
} from "../../../shared/contracts/theory-badge-graph.v1";
import { HELIX_CALCULATOR_SETUP_CONTEXT_SCHEMA } from "../../../shared/helix-calculator-setup-context";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../shared/theory/nhm2-theory-badges";

const SCOPE_PREFIXES = {
  nhm2: ["nhm2."],
  casimir: ["casimir."],
  curvature: ["curvature.", "collapse."],
} as const;

export const nhm2TheoryComponentQuerySchema = z.object({
  scope: z.enum(["nhm2", "casimir", "curvature"]).optional(),
  badgeId: z.string().trim().min(1).max(160).optional(),
}).strict();

const catalogEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  level: z.enum(THEORY_BADGE_LEVELS),
  status: z.enum(THEORY_BADGE_STATUSES),
});

const sourceRefSchema = z.object({
  kind: z.enum(["repo_module", "equation_map_node", "visualizer_preset", "test", "doc", "artifact", "literature_ref"]),
  path: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const physicalDimensionSchema = z.object({
  length: z.number(),
  mass: z.number(),
  time: z.number(),
  electric_current: z.number(),
  thermodynamic_temperature: z.number(),
  amount_of_substance: z.number(),
  luminous_intensity: z.number(),
});

const calculatorSetupContextSchema = z.object({
  schema: z.literal(HELIX_CALCULATOR_SETUP_CONTEXT_SCHEMA),
  expression: z.string(),
  display_latex: z.string(),
  subgoal: z.string(),
  domain: z.enum(["photon_energy", "kinetic_energy", "wavelength", "generic"]),
  equation: z.string().nullable().optional(),
  variables: z.array(z.object({
    symbol: z.string(),
    value: z.string(),
    unit: z.string().nullable().optional(),
    meaning: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    dimension: physicalDimensionSchema.nullable().optional(),
    dimension_signature: z.string().nullable().optional(),
  })).optional(),
  quantity: z.string().nullable().optional(),
  unit_system: z.enum(["SI", "custom"]).nullable().optional(),
  input_units: z.record(z.string()).optional(),
  result_unit: z.string().nullable().optional(),
  result_quantity: z.string().nullable().optional(),
  result_dimension: physicalDimensionSchema.nullable().optional(),
  result_dimension_signature: z.string().nullable().optional(),
  assumptions: z.array(z.string()).optional(),
  unit_options: z.array(z.object({
    symbol: z.string(),
    label: z.string(),
    quantity: z.string(),
    dimension: physicalDimensionSchema,
    si_factor: z.number(),
    aliases: z.array(z.string()).optional(),
  })).optional(),
  interpretation_prompt: z.string().nullable().optional(),
});

const badgeSchema = catalogEntrySchema.extend({
  plainMeaning: z.string(),
  whyItMatters: z.string(),
  subjects: z.array(z.string()),
  simulationOwners: z.array(z.string()),
  equationFamilies: z.array(z.string()),
  tags: z.array(z.string()),
  equations: z.array(z.object({
    id: z.string(),
    role: z.enum(["definition", "law", "constraint", "transform", "residual", "gate", "calculator_demo", "noncomputable_reference"]),
    displayLatex: z.string(),
    computableExpression: z.string().nullable().optional(),
    operatorKind: z.enum(["scalar_expression", "field_sample", "tensor_component", "region_aggregate", "worldline_integral", "residual", "gate_status", "noncomputable_reference"]).optional(),
    inputSymbols: z.array(z.string()),
    outputSymbols: z.array(z.string()),
  })),
  units: z.array(z.object({
    symbol: z.string(),
    unit: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    dimensionSignature: z.string().nullable().optional(),
  })),
  assumptions: z.array(z.string()),
  calculatorPayloads: z.array(z.object({
    id: z.string(),
    expression: z.string(),
    displayLatex: z.string(),
    preferredAction: z.enum(["ingest_latex", "solve_expression", "solve_with_steps"]),
    targetVariable: z.string().nullable().optional(),
    setupContext: calculatorSetupContextSchema.nullable().optional(),
  })),
  sourceRefs: z.array(sourceRefSchema),
  scaleEnvelope: z.object({
    characteristicLog10M: z.number().nullable(),
    minLog10M: z.number().nullable(),
    maxLog10M: z.number().nullable(),
    basis: z.enum(THEORY_BADGE_SCALE_ENVELOPE_BASES),
    sourceRefs: z.array(sourceRefSchema),
  }).nullable().optional(),
  observables: z.array(z.object({
    id: z.string(),
    canonicalObservableId: z.string(),
    symbol: z.string(),
    quantity: z.string(),
    mathematicalType: z.enum(THEORY_BADGE_OBSERVABLE_MATHEMATICAL_TYPES),
    unit: z.string().nullable(),
    dimensionSignature: z.string().nullable(),
    coordinateFrame: z.string().nullable(),
    operationalDefinitionRef: z.string(),
    responseModelRef: z.string().nullable(),
  })).optional(),
  hintKeys: z.object({
    subjects: z.array(z.string()),
    symbols: z.array(z.string()),
    unitSignatures: z.array(z.string()),
    repoPaths: z.array(z.string()),
    equationFamilies: z.array(z.string()),
    simulationOwners: z.array(z.string()),
  }),
  claimBoundary: z.object({
    diagnosticOnly: z.boolean(),
    doesValidateNHM2: z.literal(false),
    validationClaimAllowed: z.literal(false),
    physicalMechanismClaimAllowed: z.literal(false),
    promotionAllowed: z.literal(false),
  }),
});

const connectedEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  relation: z.enum(THEORY_BADGE_EDGE_RELATIONS),
  label: z.string(),
  claimBoundaryNote: z.string(),
  observableBridge: z.object({
    fromObservableId: z.string(),
    toObservableId: z.string(),
    kind: z.enum(THEORY_BADGE_OBSERVABLE_BRIDGE_KINDS),
    authority: z.literal("registered"),
    reversible: z.boolean(),
    assumptions: z.array(z.string()),
    sourceRefs: z.array(z.string()),
    validityDomain: z.object({
      scaleLog10M: z.object({ min: z.number().nullable(), max: z.number().nullable() }).nullable(),
      coordinateFrames: z.array(z.string()),
      conditions: z.array(z.string()),
    }),
    errorContract: z.object({
      kind: z.enum(THEORY_BADGE_OBSERVABLE_ERROR_KINDS),
      expression: z.string().nullable(),
    }),
  }).nullable().optional(),
});

export const nhm2TheoryComponentOutputSchema = z.object({
  schemaVersion: z.literal("nhm2_theory_component_mcp/v1"),
  graphId: z.string(),
  graphSchemaVersion: z.string(),
  scope: z.enum(["nhm2", "casimir", "curvature"]),
  catalog: z.array(catalogEntrySchema),
  selectedBadge: badgeSchema.nullable(),
  connectedEdges: z.array(connectedEdgeSchema),
  relatedBadges: z.array(catalogEntrySchema),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  currentProgramRef: z.literal("docs/research/nhm2-spherical-boson-star-v2-work-program.md"),
  archiveEvidenceTool: z.literal("helix_nhm2_canonical_solve_evidence"),
  authority: z.object({
    kind: z.literal("static_theory_reference"),
    selectedRunReceipt: z.literal(false),
    proofExecution: z.literal(false),
    physicalViabilityClaimAllowed: z.literal(false),
    transportClaimAllowed: z.literal(false),
    note: z.string(),
  }),
});

export function readNhm2TheoryComponent(
  query: z.infer<typeof nhm2TheoryComponentQuerySchema>,
) {
  const graph = buildNhm2TheoryBadgeGraphV1();
  const issues = validateTheoryBadgeGraphV1(graph);
  if (issues.length > 0) {
    throw new Error(`Theory badge graph invalid: ${issues.slice(0, 3).join("; ")}`);
  }

  const scope = query.scope ?? "nhm2";
  const prefixes = SCOPE_PREFIXES[scope];
  const scopedBadges = graph.badges.filter((badge) =>
    prefixes.some((prefix) => badge.id.startsWith(prefix)),
  );
  const catalog = scopedBadges.map(({ id, title, level, status }) => ({
    id,
    title,
    level,
    status,
  }));
  const selectedBadge = query.badgeId
    ? scopedBadges.find((badge) => badge.id === query.badgeId) ?? null
    : null;
  if (query.badgeId && !selectedBadge) {
    throw new Error(`Theory badge ${query.badgeId} is unavailable in ${scope} scope`);
  }

  const connectedEdges = selectedBadge
    ? graph.edges.filter((edge) => edge.from === selectedBadge.id || edge.to === selectedBadge.id)
    : [];
  const relatedIds = new Set(
    connectedEdges.flatMap((edge) => [edge.from, edge.to]).filter((id) => id !== selectedBadge?.id),
  );
  const relatedBadges = graph.badges
    .filter((badge) => relatedIds.has(badge.id))
    .map(({ id, title, level, status }) => ({ id, title, level, status }));
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify({ catalog, selectedBadge, connectedEdges, relatedBadges }))
    .digest("hex");

  return nhm2TheoryComponentOutputSchema.parse({
    schemaVersion: "nhm2_theory_component_mcp/v1" as const,
    graphId: graph.graphId,
    graphSchemaVersion: graph.schemaVersion,
    scope,
    catalog,
    selectedBadge,
    connectedEdges,
    relatedBadges,
    contentSha256,
    currentProgramRef: "docs/research/nhm2-spherical-boson-star-v2-work-program.md" as const,
    archiveEvidenceTool: "helix_nhm2_canonical_solve_evidence" as const,
    authority: {
      kind: "static_theory_reference" as const,
      selectedRunReceipt: false as const,
      proofExecution: false as const,
      physicalViabilityClaimAllowed: false as const,
      transportClaimAllowed: false as const,
      note: "A badge and its source paths explain a relation; the hash identifies this code-defined projection. Neither authenticates a current run, material observation, source tensor, QEI dossier, or physical claim.",
    },
  });
}
