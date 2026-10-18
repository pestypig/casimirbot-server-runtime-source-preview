import { z } from "zod";
import type { ToolHandler, ToolSpecShape } from "@shared/skills";
import type {
  CivilizationActionChannelV1,
  CivilizationBoundsBridgeContextV1,
  CivilizationBoundsBadgeV1,
  CivilizationComparisonCaseV1,
  CivilizationDependencyChainV1,
  CivilizationHypothesisClaimV1,
  CivilizationParameterScopeV1,
  CivilizationProceduralScaffoldV1,
  CivilizationBoundsRoadmapV1,
  CivilizationBoundsRoadmapAuthorityV1,
  CivilizationClaimTierV1,
  CivilizationLayerModeV1,
  CivilizationScopeBoundaryV1,
} from "@shared/civilization-bounds-roadmap";
import {
  buildCivilizationBoundsRoadmapV1,
  buildCivilizationCollaborationBoundV1,
  validateCivilizationBoundsRoadmapV1,
} from "@shared/civilization-bounds-roadmap";
import { buildCivilizationAtlasViewModel } from "@shared/civilization/build-civilization-atlas-view-model";
import {
  buildDefaultCivilizationTraversabilityAtlas,
} from "@shared/civilization/civilization-traversability-fixtures";
import {
  isCivilizationRouteObjective,
  type CivilizationTraversabilityRouteObjectiveV1,
} from "@shared/civilization/civilization-route-objectives";
import type {
  CivilizationTraversabilityAtlasV1,
  CivilizationTraversabilityContextV1,
} from "@shared/civilization-traversability-atlas";
import {
  validateCivilizationScenarioFrameV1,
  type CivilizationConstraintProfileV1,
  type CivilizationScenarioEvidenceModeV1,
  type CivilizationScenarioFrameV1,
} from "@shared/civilization-scenario-frame";
import {
  buildNeedleCivilizationBoundsScenario,
  exportCivilizationBoundsBridgeContext,
  NEEDLE_CIVILIZATION_BOUNDS_SCENARIO_ID,
} from "../../client/src/data/civilizationBoundsNeedleScenario";

export const HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME =
  "helix_ask.reflect_civilization_bounds" as const;

const CivilizationBoundsToolInputSchema = z.object({
  prompt: z.string(),
  scenarioId: z.string().optional(),
  phaseId: z.string().optional(),
  layerMode: z.string().optional(),
  selectedSystemIds: z.array(z.string()).optional(),
  selectedBadgeIds: z.array(z.string()).optional(),
  selectedRouteIds: z.array(z.string()).optional(),
  selectedFieldLayerIds: z.array(z.string()).optional(),
  routeObjective: z.string().optional(),
  timeCursor: z.string().optional(),
  theoryReflectionRef: z.string().optional(),
  ideologyReflectionRef: z.string().optional(),
  scenarioFrame: z.any().optional(),
  refs: z.array(z.string()).optional(),
  options: z
    .object({
      includeBridgeContext: z.boolean().optional(),
      includeCollaborationBounds: z.boolean().optional(),
      includeFalsificationHooks: z.boolean().optional(),
    })
    .optional(),
});

export type HelixAskCivilizationBoundsToolInput = {
  prompt: string;
  scenarioId?: string;
  phaseId?: string;
  layerMode?: CivilizationLayerModeV1;
  selectedSystemIds?: string[];
  selectedBadgeIds?: string[];
  selectedRouteIds?: string[];
  selectedFieldLayerIds?: string[];
  routeObjective?: CivilizationTraversabilityRouteObjectiveV1;
  timeCursor?: string;
  theoryReflectionRef?: string;
  ideologyReflectionRef?: string;
  scenarioFrame?: CivilizationScenarioFrameV1;
  refs?: string[];
  options?: {
    includeBridgeContext?: boolean;
    includeCollaborationBounds?: boolean;
    includeFalsificationHooks?: boolean;
  };
};

export type HelixAskCivilizationBoundsToolOutput = {
  authority: CivilizationBoundsRoadmapAuthorityV1;
  roadmap: CivilizationBoundsRoadmapV1;
  traversabilityAtlas: CivilizationTraversabilityAtlasV1;
  traversabilityContext: CivilizationTraversabilityContextV1;
  scenarioFrame?: CivilizationScenarioFrameV1;
  bridgeContext?: CivilizationBoundsBridgeContextV1;
  missingEvidenceBoundaries: string[];
  analogyBoundaries: string[];
  supportRefs: string[];
  parameterScopes: CivilizationParameterScopeV1[];
  actionChannels: CivilizationActionChannelV1[];
  dependencyChains: CivilizationDependencyChainV1[];
  comparisonCases: CivilizationComparisonCaseV1[];
  hypothesisClaims: CivilizationHypothesisClaimV1[];
  proceduralScaffold: CivilizationProceduralScaffoldV1;
};

const CONSTRAINT_BADGE_LABELS: Record<CivilizationConstraintProfileV1, string> = {
  energy_limited: "Energy budget unknown",
  material_limited: "Material inventory unknown",
  manufacturing_limited: "Manufacturing resolution unknown",
  thermal_limited: "Thermal ceiling unknown",
  compute_limited: "Compute budget unknown",
  signal_latency_limited: "Signal latency unknown",
  transport_limited: "Transport route and latency unknown",
  observability_limited: "Observability coverage unknown",
  governance_limited: "Governance interface unknown",
  consent_limited: "Consent interface unknown",
  ecological_sink_limited: "Ecological sink capacity unknown",
  security_limited: "Security risk interface unknown",
  multi_bottleneck: "Multi-bottleneck dependency graph unknown",
};

const CONSTRAINT_THEORY_BINDINGS: Partial<Record<CivilizationConstraintProfileV1, string[]>> = {
  energy_limited: ["biophysics.membrane.open_system_entropy_flow"],
  material_limited: ["physics.symmetry.energy_momentum_conservation"],
  manufacturing_limited: ["materials.manufacturing.resolution_limit"],
  thermal_limited: ["thermodynamics.heat_sink_capacity"],
  compute_limited: ["information.compute_energy_budget"],
  signal_latency_limited: ["relativity.signal_latency_bound"],
  ecological_sink_limited: ["thermodynamics.entropy_sink_capacity"],
};

const CONSTRAINT_MORAL_BINDINGS: Partial<Record<CivilizationConstraintProfileV1, string[]>> = {
  observability_limited: ["direct_observation", "uncertainty"],
  governance_limited: ["review", "contestability"],
  consent_limited: ["affected_party_consent", "non_harm"],
  security_limited: ["non_harm", "two_key_review"],
  multi_bottleneck: ["revision", "uncertainty"],
};

const PARAMETER_SCOPE_DEFS: Array<{
  kind: CivilizationParameterScopeV1["kind"];
  label: string;
  description: string;
  indicatorRefs: string[];
  missingEvidence: string[];
}> = [
  {
    kind: "material_base",
    label: "Material base",
    description: "Resource, production, logistics, fiscal, and infrastructure constraints before strategic claims are strengthened.",
    indicatorRefs: [
      "world_bank.world_development_indicators",
      "world_bank.open_data",
      "energy_trade_national_statistics",
    ],
    missingEvidence: ["energy_mix_receipts", "material_inventory_receipts", "infrastructure_bottleneck_refs"],
  },
  {
    kind: "governance_institutional_capacity",
    label: "Governance and institutional capacity",
    description: "Formal public capacity, review interfaces, rule of law, regulatory quality, and contestability.",
    indicatorRefs: [
      "world_bank.worldwide_governance_indicators",
      "v_dem.democracy_indices",
      "fragile_states_index.political_indicators",
    ],
    missingEvidence: ["governance_review_record", "rule_of_law_indicator_refs", "public_service_capacity_refs"],
  },
  {
    kind: "security_conflict_exposure",
    label: "Security and conflict exposure",
    description: "Event-level conflict, coercion, protest, strategic development, actor fragmentation, and displacement evidence.",
    indicatorRefs: [
      "acled.event_data",
      "ucdp.armed_conflict_data",
      "global_peace_index",
    ],
    missingEvidence: ["conflict_event_receipts", "actor_identity_refs", "displacement_trend_refs"],
  },
  {
    kind: "social_cohesion_demographic_pressure",
    label: "Social cohesion and demographic pressure",
    description: "Population structure, migration, uneven development, trust, group grievance, and civic participation.",
    indicatorRefs: [
      "fragile_states_index.cohesion_social_indicators",
      "world_bank.population_indicators",
      "un_population_data",
    ],
    missingEvidence: ["demographic_pressure_refs", "public_trust_refs", "migration_displacement_refs"],
  },
  {
    kind: "information_ideology_legitimacy",
    label: "Information, ideology, and legitimacy",
    description: "Narrative capacity, media pluralism, censorship, education reach, civil society, and legitimacy claims.",
    indicatorRefs: [
      "v_dem.civil_liberties_media",
      "media_freedom_datasets",
      "public_opinion_surveys",
    ],
    missingEvidence: ["media_pluralism_refs", "legitimacy_claim_refs", "civil_society_capacity_refs"],
  },
  {
    kind: "environment_entropy_pressure",
    label: "Environment and entropy pressure",
    description: "Climate exposure, disaster frequency, water stress, agriculture vulnerability, energy transition, and pollution load.",
    indicatorRefs: [
      "world_bank.climate_environment_indicators",
      "ipcc_un_climate_sources",
      "our_world_in_data.environment",
    ],
    missingEvidence: ["climate_exposure_refs", "water_stress_refs", "ecological_sink_capacity_measurements"],
  },
];

const ACTION_CHANNEL_DEFS: Array<{
  kind: CivilizationActionChannelV1["kind"];
  label: string;
  sporeAnalogy: string;
  realWorldInterpretation: string;
}> = [
  {
    kind: "economic",
    label: "Economic integration channel",
    sporeAnalogy: "economic city purchase and trade routes",
    realWorldInterpretation: "Trade, credit, investment, supply-chain lock-in, debt leverage, and market access.",
  },
  {
    kind: "coercive",
    label: "Coercive capacity channel",
    sporeAnalogy: "military city takeover",
    realWorldInterpretation: "Armed force, deterrence, repression, occupation, border pressure, or force posture.",
  },
  {
    kind: "persuasive",
    label: "Persuasive legitimacy channel",
    sporeAnalogy: "religious city conversion",
    realWorldInterpretation: "Identity, ideology, education, media, institutional narrative, and legitimacy claims.",
  },
  {
    kind: "diplomatic",
    label: "Diplomatic transfer channel",
    sporeAnalogy: "gifts and relation modifiers",
    realWorldInterpretation: "Aid, sanctions relief, treaty bargaining, side payments, and confidence-building measures.",
  },
  {
    kind: "governance_review",
    label: "Governance review channel",
    sporeAnalogy: "city building mix and morale stability",
    realWorldInterpretation: "Due process, public review, ethics review, affected-party interface, and contestability.",
  },
  {
    kind: "infrastructure_buildout",
    label: "Infrastructure buildout channel",
    sporeAnalogy: "factories, houses, turrets, and vehicles",
    realWorldInterpretation: "Production capacity, housing, energy, logistics, defense hardening, and service reach.",
  },
  {
    kind: "observation",
    label: "Observation and evidence channel",
    sporeAnalogy: "visible city states and map control",
    realWorldInterpretation: "Source freshness, event logs, direct observation, measurement quality, and blind spots.",
  },
];

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "frame";
}

function evidenceModeToClaimTier(mode: CivilizationScenarioEvidenceModeV1): CivilizationClaimTierV1 {
  switch (mode) {
    case "declared_scenario":
      return "declared_scenario";
    case "historical_replay":
      return "historical_observation";
    case "source_backed_observation":
    case "current_observation":
      return "source_backed_observation";
    case "model_projection":
      return "model_projection";
    case "stress_test":
      return "diagnostic_bound";
    case "user_hypothesis":
    case "fictional_construct":
    case "counterfactual":
    default:
      return "hypothetical";
  }
}

function boundaryKindToScopeBoundary(frame: CivilizationScenarioFrameV1): CivilizationScopeBoundaryV1 {
  switch (frame.boundaryKind) {
    case "city":
    case "settlement":
    case "household":
    case "crew":
    case "tribe":
      return "region";
    case "institution":
    case "firm":
      return "research_program";
    case "supply_chain":
      return "supply_chain";
    case "trade_bloc":
      return "trade_bloc";
    case "polity":
      return "polity";
    case "planetary_civilization":
      return "earth";
    case "interplanetary_civilization":
      return "planetary_colony";
    case "fictional_world":
      return "fictional_world";
    case "abstract_agent_system":
    case "machine_society":
    case "multi_species_ecology":
    case "organism":
    default:
      return "abstract_system";
  }
}

function buildParameterScopes(
  frame: CivilizationScenarioFrameV1,
  evidenceRefs: string[],
  claimTier: CivilizationClaimTierV1,
): CivilizationParameterScopeV1[] {
  const frameMissing = new Set(frame.missingEvidence);
  return PARAMETER_SCOPE_DEFS.map((scope) => ({
    scopeId: `parameter:${scope.kind}`,
    kind: scope.kind,
    label: scope.label,
    description: scope.description,
    indicatorRefs: scope.indicatorRefs,
    missingEvidence: Array.from(new Set([
      ...scope.missingEvidence,
      ...frame.missingEvidence.filter((missing) => {
        if (scope.kind === "material_base") return /energy|material|manufactur|transport|bottleneck|collaboration/i.test(missing);
        if (scope.kind === "governance_institutional_capacity") return /governance|review|consent|claim|source/i.test(missing);
        if (scope.kind === "security_conflict_exposure") return /security|risk|conflict|actor|displacement/i.test(missing);
        if (scope.kind === "environment_entropy_pressure") return /ecological|thermal|sink|waste|energy/i.test(missing);
        return frameMissing.has(missing) && /observability|source|claim|receipt/i.test(missing);
      }),
    ])),
    evidenceRefs,
    claimTier,
  }));
}

function buildActionChannels(
  evidenceRefs: string[],
  claimTier: CivilizationClaimTierV1,
): CivilizationActionChannelV1[] {
  return ACTION_CHANNEL_DEFS.map((channel) => ({
    channelId: `action-channel:${channel.kind}`,
    kind: channel.kind,
    label: channel.label,
    sporeAnalogy: channel.sporeAnalogy,
    realWorldInterpretation: channel.realWorldInterpretation,
    admissibleUses: [
      "compare scenario structure",
      "identify dependency evidence",
      "flag missing observations",
      "bound claim strength",
    ],
    blockedUses: [
      "certify prediction",
      "authorize action",
      "treat procedural analogy as moral proof",
      "collapse receipts into terminal answer authority",
    ],
    evidenceRefs,
    claimTier,
  }));
}

function buildComparisonCases(
  frame: CivilizationScenarioFrameV1,
  evidenceRefs: string[],
  claimTier: CivilizationClaimTierV1,
): CivilizationComparisonCaseV1[] {
  return [
    {
      caseId: "comparison:stable_peer",
      label: "Stable peer with similar material base",
      sourceClass: "historical_case",
      similarityAxes: ["material_base", "governance_institutional_capacity", "social_cohesion_demographic_pressure"],
      blockers: ["named_peer_case_refs", "source_scope_and_timestamp"],
      evidenceRefs,
      claimTier,
    },
    {
      caseId: "comparison:stressed_peer",
      label: "Stressed peer with similar dependency bottlenecks",
      sourceClass: "current_snapshot",
      similarityAxes: ["material_base", "security_conflict_exposure", "environment_entropy_pressure"],
      blockers: ["conflict_event_receipts", "resource_bottleneck_refs"],
      evidenceRefs,
      claimTier,
    },
    {
      caseId: "comparison:historical_analogue",
      label: "Historical analogue with explicit mismatch notes",
      sourceClass: "historical_case",
      similarityAxes: ["governance_institutional_capacity", "information_ideology_legitimacy", "material_base"],
      blockers: ["historical_case_scope_refs", "mismatch_axes"],
      evidenceRefs,
      claimTier,
    },
    {
      caseId: "comparison:null_case",
      label: "Null case where surface similarity does not imply shared outcome",
      sourceClass: frame.evidenceMode === "fictional_construct" ? "fictional_construct" : "future_scenario",
      similarityAxes: ["blocked_prediction_finality", "missing_observation_review"],
      blockers: ["counterevidence_refs", "causal_direction_not_certified"],
      evidenceRefs,
      claimTier,
    },
  ];
}

function buildHypothesisClaims(
  frame: CivilizationScenarioFrameV1,
  evidenceRefs: string[],
  claimTier: CivilizationClaimTierV1,
): CivilizationHypothesisClaimV1[] {
  return [
    {
      claimId: "hypothesis:dependency_bottleneck",
      claim: `${frame.title} may be constrained by dependency bottlenecks before any stronger scenario claim is admissible.`,
      strength: frame.evidenceMode === "source_backed_observation" ? "bounded" : "weak",
      blockers: ["dependency_chain_receipts", ...frame.missingEvidence.slice(0, 4)],
      evidenceRefs,
      claimTier,
    },
    {
      claimId: "hypothesis:governance_review_bounds_claim_strength",
      claim: "Governance and consent gaps bound claim strength even when material capacity appears plausible.",
      strength: frame.constraintProfiles.some((profile) => profile === "governance_limited" || profile === "consent_limited")
        ? "bounded"
        : "weak",
      blockers: ["governance_review_record", "affected_party_consent_interface_record"],
      evidenceRefs,
      claimTier,
    },
    {
      claimId: "hypothesis:comparison_not_prediction",
      claim: "Historical or current-world comparison can generate counterevidence questions, not deterministic forecasts.",
      strength: "bounded",
      blockers: ["named_comparison_cases", "mismatch_axes", "causal_direction_not_certified"],
      evidenceRefs,
      claimTier,
    },
  ];
}

function buildProceduralScaffold(evidenceRefs: string[]): CivilizationProceduralScaffoldV1 {
  return {
    scaffoldId: "spore_civilization_stage_procedural_scaffold",
    source: "spore_civilization_stage_research",
    designMetaphor:
      "Spore Civilization Stage supplies a procedural grammar for nodes, resources, action channels, dependencies, and maturity gates; it is not treated as a real-world predictive model.",
    surfaces: [
      { sporeSurface: "city", proceduralMeaning: "concentrated capability node", roadmapField: "systems,badges" },
      { sporeSurface: "spice geyser", proceduralMeaning: "resource anchor", roadmapField: "parameterScopes,badges" },
      { sporeSurface: "vehicle", proceduralMeaning: "mobility or projection capacity", roadmapField: "actionChannels,capabilities" },
      { sporeSurface: "trade route", proceduralMeaning: "dependency and integration edge", roadmapField: "edges,dependencyChains" },
      { sporeSurface: "economic, military, religious takeover", proceduralMeaning: "bounded action channels", roadmapField: "actionChannels,hypothesisClaims" },
      { sporeSurface: "stage completion", proceduralMeaning: "maturity transition into a larger operating environment", roadmapField: "phases,comparisonCases" },
    ],
    blockedInterpretations: [
      "Spore mechanics are not a history model.",
      "Spore pathways do not certify real-world predictions.",
      "Procedural comparison does not authorize policy, coercion, or moral finality.",
    ],
    researchRefs: [
      "docs/audits/research/civilization-bounds-spore-procedural-systems-2026-06-17.md",
    ],
    evidenceRefs,
  };
}

function buildSparseRoadmapFromScenarioFrame(
  frame: CivilizationScenarioFrameV1,
  input: HelixAskCivilizationBoundsToolInput,
): CivilizationBoundsRoadmapV1 {
  const frameSlug = slugId(frame.frameId);
  const systemId = `system:${frameSlug}`;
  const interfaceSystemId = `interface:${frameSlug}`;
  const claimTier = evidenceModeToClaimTier(frame.evidenceMode);
  const frameEvidenceRefs = Array.from(new Set([
    `scenario-frame:${frame.frameId}`,
    ...frame.refs,
    ...(input.refs ?? []),
  ]));
  const constraintProfiles = frame.constraintProfiles.length > 0
    ? frame.constraintProfiles
    : ["multi_bottleneck" as const];
  const constraintBadges: CivilizationBoundsBadgeV1[] = constraintProfiles.map((profile, index) => ({
    badgeId: `badge:${frameSlug}:constraint:${profile}`,
    label: CONSTRAINT_BADGE_LABELS[profile] ?? `${profile} unknown`,
    kind: "constraint",
    systemId,
    phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
    abstractPosition: { x: 0.25 + index * 0.1, y: 0.45, z: 0 },
    layerMode: "gap_bounds",
    weight: 0.65,
    confidence: frame.evidenceMode === "source_backed_observation" ? 0.55 : 0.35,
    theoryBadgeIds: CONSTRAINT_THEORY_BINDINGS[profile] ?? [],
    moralNodeIds: CONSTRAINT_MORAL_BINDINGS[profile] ?? [],
    missingEvidence: frame.missingEvidence,
    evidenceRefs: frameEvidenceRefs,
    claimTier,
  }));
  const badges: CivilizationBoundsBadgeV1[] = [
    {
      badgeId: `badge:${frameSlug}:bounded_system`,
      label: `Bounded system: ${frame.boundaryKind}`,
      kind: "system_actor",
      systemId,
      phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
      abstractPosition: { x: 0.1, y: 0.2, z: 0 },
      layerMode: "gap_bounds",
      weight: 0.8,
      confidence: 0.45,
      missingEvidence: frame.missingEvidence,
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
    {
      badgeId: `badge:${frameSlug}:stage`,
      label: `Developmental stage: ${frame.developmentalStage}`,
      kind: "capability",
      systemId,
      phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
      abstractPosition: { x: 0.24, y: 0.2, z: 0 },
      layerMode: "gap_bounds",
      weight: 0.65,
      confidence: 0.4,
      missingEvidence: ["stage_inheritance_receipts", ...frame.missingEvidence],
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
    ...constraintBadges,
    {
      badgeId: `badge:${frameSlug}:governance_review`,
      label: "Procedural admissibility unknown",
      kind: "governance_interface",
      systemId: interfaceSystemId,
      phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
      abstractPosition: { x: 0.72, y: 0.28, z: 0 },
      layerMode: "gap_bounds",
      weight: 0.7,
      confidence: 0.3,
      moralNodeIds: frame.proceduralBindings.moralBindingHints,
      missingEvidence: ["governance_review_record", "affected_party_consent_interface_record"],
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
    {
      badgeId: `badge:${frameSlug}:collaboration_bound`,
      label: "Collaboration value unavailable until evidence supplied",
      kind: "collaboration_bound",
      systemId: interfaceSystemId,
      phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
      abstractPosition: { x: 0.78, y: 0.55, z: 0 },
      layerMode: "gap_bounds",
      weight: 0.75,
      confidence: 0.25,
      missingEvidence: ["collaboration_factor_measurements", ...frame.missingEvidence],
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
    {
      badgeId: `badge:${frameSlug}:evidence_tier`,
      label: `Evidence mode: ${frame.evidenceMode}`,
      kind: "observation_gap",
      systemId,
      phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
      abstractPosition: { x: 0.48, y: 0.72, z: 0 },
      layerMode: "gap_bounds",
      weight: 0.7,
      confidence: 0.5,
      missingEvidence: frame.missingEvidence,
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
  ];
  const actorBadgeId = `badge:${frameSlug}:bounded_system`;
  const constraintEdges = constraintBadges.map((badge) => ({
    edgeId: `edge:${frameSlug}:${badge.badgeId}`,
    fromBadgeId: actorBadgeId,
    toBadgeId: badge.badgeId,
    relation: "constrains" as const,
    weight: 0.7,
    confidence: 0.35,
    evidenceRefs: frameEvidenceRefs,
    claimTier,
  }));
  const parameterScopes = buildParameterScopes(frame, frameEvidenceRefs, claimTier);
  const actionChannels = buildActionChannels(frameEvidenceRefs, claimTier);
  const dependencyChains: CivilizationDependencyChainV1[] = [
    {
      chainId: `chain:${frameSlug}:constraint_profile`,
      label: "Scenario constraint profile dependency chain",
      nodeBadgeIds: [actorBadgeId, ...constraintBadges.map((badge) => badge.badgeId)],
      edgeIds: constraintEdges.map((edge) => edge.edgeId),
      bottlenecks: constraintProfiles,
      missingEvidence: frame.missingEvidence,
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
    {
      chainId: `chain:${frameSlug}:review_interface`,
      label: "Evidence and review dependency chain",
      nodeBadgeIds: [
        actorBadgeId,
        `badge:${frameSlug}:governance_review`,
        `badge:${frameSlug}:collaboration_bound`,
        `badge:${frameSlug}:evidence_tier`,
      ],
      edgeIds: [],
      bottlenecks: ["governance_review_record", "claim_receipt_identity", "collaboration_factor_measurements"],
      missingEvidence: ["governance_review_record", "claim_receipt_identity", ...frame.missingEvidence],
      evidenceRefs: frameEvidenceRefs,
      claimTier,
    },
  ];
  return buildCivilizationBoundsRoadmapV1({
    title: `Sparse Civilization Bounds: ${frame.title}`,
    scenarioId: frame.frameId,
    activeLayerModes: ["gap_bounds", "ideal_bounds"],
    phases: [
      {
        phaseId: `phase:${frameSlug}:${frame.developmentalStage}`,
        label: `${frame.developmentalStage} bounds`,
        start: "prompt_frame",
        end: "evidence_upgrade",
        summary: "Prompt-derived scenario frame with sparse placeholders and missing-evidence hooks.",
        claimTier,
        evidenceRefs: frameEvidenceRefs,
      },
    ],
    systems: [
      {
        systemId,
        label: frame.title,
        scopeBoundary: boundaryKindToScopeBoundary(frame),
        timeHorizon: { mode: "relative_years", start: 0, end: 10 },
        populationOrAgents: {
          description: frame.boundedActorGrammar.actorUnit,
          agentClasses: [frame.agencyModel],
        },
        energyBudget: {
          label: frame.constraintProfiles.includes("energy_limited")
            ? "energy budget unknown"
            : "energy budget not yet bounded",
          value: null,
          unit: null,
          confidence: 0.2,
          evidenceRefs: frameEvidenceRefs,
        },
        materialInventory: [
          {
            label: "material inventory unknown",
            value: null,
            unit: null,
            confidence: 0.2,
            evidenceRefs: frameEvidenceRefs,
          },
        ],
        manufacturingResolution: {
          label: "manufacturing resolution unknown",
          evidenceRefs: frameEvidenceRefs,
        },
        observabilityCoverage: {
          coverageLabel: "observability coverage unknown",
          coverageScore: 0,
          blindSpots: frame.missingEvidence,
          evidenceRefs: frameEvidenceRefs,
        },
        governanceProcess: {
          processId: `governance:${frameSlug}`,
          label: `${frame.coordinationMode} coordination requires review evidence`,
          decisionRule: "unknown",
          reviewCadence: "unknown",
          evidenceRefs: frameEvidenceRefs,
        },
        consentAndReviewInterfaces: [
          {
            interfaceId: `review:${frameSlug}`,
            label: "affected-party review interface unknown",
            interfaceKind: "unknown",
            coverageScore: 0,
            missingChecks: frame.missingEvidence,
            evidenceRefs: frameEvidenceRefs,
          },
        ],
        capabilities: frame.boundedActorGrammar.capabilitySurfaces,
        dependencies: frame.boundedActorGrammar.resourceInputs,
        risks: frame.boundedActorGrammar.constraintInterfaces,
        evidenceRefs: frameEvidenceRefs,
        claimTier,
      },
      {
        systemId: interfaceSystemId,
        label: "External collaboration interface",
        scopeBoundary: "abstract_system",
        timeHorizon: { mode: "relative_years", start: 0, end: 10 },
        capabilities: ["collaboration interface pending evidence"],
        dependencies: ["physical_capacity_margin", "procedural_admissibility", "reversibility_margin"],
        risks: ["overclaiming generated frame as observation"],
        evidenceRefs: frameEvidenceRefs,
        claimTier,
      },
    ],
    badges,
    edges: constraintEdges,
    collaborationBounds: [
      buildCivilizationCollaborationBoundV1({
        boundId: `collaboration:${frameSlug}:external_interface`,
        fromSystemId: systemId,
        toSystemId: interfaceSystemId,
        physicalCapacityMargin: 0.5,
        materialAvailability: frame.constraintProfiles.includes("material_limited") ? 0.25 : 0.5,
        energyMargin: frame.constraintProfiles.includes("energy_limited") ? 0.25 : 0.5,
        interfaceCompatibility: 0.45,
        evidenceQuality: frame.evidenceMode === "source_backed_observation" ? 0.55 : 0.2,
        proceduralAdmissibility:
          frame.constraintProfiles.includes("governance_limited") || frame.constraintProfiles.includes("consent_limited")
            ? 0.25
            : 0.45,
        reversibilityMargin: frame.evidenceMode === "fictional_construct" ? 0.25 : 0.4,
        limitingFactor: "evidenceQuality",
        missingEvidence: ["collaboration_factor_measurements", ...frame.missingEvidence],
        evidenceRefs: frameEvidenceRefs,
        claimTier,
      }),
    ],
    falsificationHooks: frame.missingEvidence.slice(0, 6).map((missing, index) => ({
      hookId: `hook:${frameSlug}:${slugId(missing)}`,
      claimId: `claim:${frameSlug}:${index}`,
      metric: missing,
      threshold: "receipt supplied or claim remains at generated-frame tier",
      horizon: "before source-backed upgrade",
      revisionTrigger: `Update or remove sparse badge when ${missing} is supplied.`,
      evidenceRefs: frameEvidenceRefs,
    })),
    parameterScopes,
    actionChannels,
    dependencyChains,
    comparisonCases: buildComparisonCases(frame, frameEvidenceRefs, claimTier),
    hypothesisClaims: buildHypothesisClaims(frame, frameEvidenceRefs, claimTier),
    proceduralScaffold: buildProceduralScaffold(frameEvidenceRefs),
    theoryBindings: constraintBadges.map((badge) => ({
      badgeId: badge.badgeId,
      theoryBadgeIds: badge.theoryBadgeIds?.length ? badge.theoryBadgeIds : frame.proceduralBindings.theoryBindingHints,
      relation: "bounds",
      evidenceRefs: frameEvidenceRefs,
    })),
    moralBindings: badges
      .filter((badge) => badge.kind === "governance_interface" || badge.kind === "observation_gap" || badge.kind === "collaboration_bound")
      .map((badge) => ({
        badgeId: badge.badgeId,
        moralNodeIds: badge.moralNodeIds?.length ? badge.moralNodeIds : frame.proceduralBindings.moralBindingHints,
        proceduralEffect: "Keep generated scenario claims contestable, reviewable, and evidence-tiered.",
        refusesAuthority: ["moral_finality", "policy_finality", "execution_permission"],
        evidenceRefs: frameEvidenceRefs,
      })),
    missingEvidence: frame.missingEvidence,
  });
}

function filterRoadmap(
  roadmap: CivilizationBoundsRoadmapV1,
  input: HelixAskCivilizationBoundsToolInput,
): CivilizationBoundsRoadmapV1 {
  const selectedSystemIds = new Set(input.selectedSystemIds ?? []);
  const selectedBadgeIds = new Set(input.selectedBadgeIds ?? []);
  const selectedPhaseId = input.phaseId;
  const selectedLayer = input.layerMode;
  const shouldFilterSystems = selectedSystemIds.size > 0;
  const shouldFilterBadges = selectedBadgeIds.size > 0;
  const badges = roadmap.badges.filter((badge) => {
    if (selectedPhaseId && badge.phaseId && badge.phaseId !== selectedPhaseId) return false;
    if (selectedLayer && badge.layerMode !== selectedLayer) return false;
    if (shouldFilterBadges && !selectedBadgeIds.has(badge.badgeId)) return false;
    if (shouldFilterSystems && badge.systemId && !selectedSystemIds.has(badge.systemId)) return false;
    return true;
  });
  const badgeIds = new Set(badges.map((badge) => badge.badgeId));
  const systemIds = new Set([
    ...badges.flatMap((badge) => (badge.systemId ? [badge.systemId] : [])),
    ...selectedSystemIds,
  ]);
  return {
    ...roadmap,
    phases: selectedPhaseId
      ? roadmap.phases.filter((phase) => phase.phaseId === selectedPhaseId)
      : roadmap.phases,
    systems: shouldFilterSystems || badges.length !== roadmap.badges.length
      ? roadmap.systems.filter((system) => systemIds.has(system.systemId))
      : roadmap.systems,
    badges,
    edges: roadmap.edges.filter(
      (edge) => badgeIds.has(edge.fromBadgeId) && badgeIds.has(edge.toBadgeId),
    ),
    collaborationBounds: input.options?.includeCollaborationBounds === false
      ? []
      : roadmap.collaborationBounds.filter(
          (bound) =>
            systemIds.size === 0 ||
            (systemIds.has(bound.fromSystemId) && systemIds.has(bound.toSystemId)),
        ),
    falsificationHooks: input.options?.includeFalsificationHooks === false
      ? []
      : roadmap.falsificationHooks,
    theoryBindings: roadmap.theoryBindings.filter((binding) => badgeIds.has(binding.badgeId)),
    moralBindings: roadmap.moralBindings.filter((binding) => badgeIds.has(binding.badgeId)),
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

export async function runHelixAskCivilizationBoundsTool(
  input: HelixAskCivilizationBoundsToolInput,
): Promise<HelixAskCivilizationBoundsToolOutput> {
  const scenarioFrame = input.scenarioFrame;
  if (scenarioFrame) {
    const frameIssues = validateCivilizationScenarioFrameV1(scenarioFrame);
    if (frameIssues.length > 0) {
      throw new Error(`civilization_bounds_invalid_scenario_frame:${frameIssues.join("; ")}`);
    }
  }
  const scenarioId = input.scenarioId;
  const useScenarioFrameRoadmap =
    Boolean(scenarioFrame) &&
    scenarioId !== NEEDLE_CIVILIZATION_BOUNDS_SCENARIO_ID;
  const roadmap = useScenarioFrameRoadmap && scenarioFrame
    ? buildSparseRoadmapFromScenarioFrame(scenarioFrame, input)
    : buildNeedleCivilizationBoundsScenario();
  const filtered = filterRoadmap(
    scenarioId === NEEDLE_CIVILIZATION_BOUNDS_SCENARIO_ID ? roadmap : roadmap,
    input,
  );
  const issues = validateCivilizationBoundsRoadmapV1(filtered);
  if (issues.length > 0) {
    throw new Error(`civilization_bounds_invalid_roadmap:${issues.join("; ")}`);
  }
  const traversabilityAtlas = buildDefaultCivilizationTraversabilityAtlas({
    scenarioId: filtered.scenarioId,
    generatedAt: filtered.generatedAt,
    observedAt: input.timeCursor,
  });
  const atlasView = buildCivilizationAtlasViewModel({
    roadmap: filtered,
    atlas: traversabilityAtlas,
    selectedRouteIds: input.selectedRouteIds,
    selectedFieldLayerIds: input.selectedFieldLayerIds,
    routeObjective: isCivilizationRouteObjective(input.routeObjective)
      ? input.routeObjective
      : undefined,
    timeCursor: input.timeCursor,
  });
  const bridgeContext = input.options?.includeBridgeContext === false
    ? undefined
    : exportCivilizationBoundsBridgeContext(filtered, input.selectedBadgeIds);
  const analogyBoundaries = uniqueStrings([
    ...filtered.proceduralScaffold.blockedInterpretations,
    ...filtered.actionChannels.flatMap((channel) => channel.blockedUses),
    ...filtered.comparisonCases.flatMap((comparison) => comparison.blockers),
    "Procedural analogies can suggest flow, dependency, and bottleneck questions; they do not prove organism-level agency.",
    "Civilization bounds evidence may be rejected by the final answer when support refs are weak, missing, or mismatched.",
  ]);
  const missingEvidenceBoundaries = uniqueStrings([
    ...filtered.missingEvidence,
    ...filtered.parameterScopes.flatMap((scope) => scope.missingEvidence),
    ...atlasView.traversabilityContext.missingEvidence,
    ...(bridgeContext?.missingEvidence ?? []),
  ]);
  const supportRefs = uniqueStrings([
    filtered.roadmapId,
    traversabilityAtlas.atlasId,
    ...atlasView.traversabilityContext.evidenceRefs,
    ...(bridgeContext?.evidenceRefs ?? []),
  ]);
  return {
    authority: filtered.authority,
    roadmap: filtered,
    traversabilityAtlas,
    traversabilityContext: atlasView.traversabilityContext,
    ...(scenarioFrame ? { scenarioFrame } : {}),
    missingEvidenceBoundaries,
    analogyBoundaries,
    supportRefs,
    parameterScopes: filtered.parameterScopes,
    actionChannels: filtered.actionChannels,
    dependencyChains: filtered.dependencyChains,
    comparisonCases: filtered.comparisonCases,
    hypothesisClaims: filtered.hypothesisClaims,
    proceduralScaffold: filtered.proceduralScaffold,
    ...(bridgeContext ? { bridgeContext } : {}),
  };
}

export const civilizationBoundsRoadmapSpec: ToolSpecShape = {
  name: HELIX_ASK_CIVILIZATION_BOUNDS_TOOL_NAME,
  desc:
    "Deterministic read-only Civilization Bounds Roadmap reflection. Produces evidence-only system bounds, capability/dependency badges, collaboration constraints, missing checks, and optional Theory/Moral bridge context. Never final authority, prediction certification, policy finality, or execution permission.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      scenarioId: { type: "string" },
      phaseId: { type: "string" },
      layerMode: { type: "string" },
      selectedSystemIds: { type: "array", items: { type: "string" } },
      selectedBadgeIds: { type: "array", items: { type: "string" } },
      selectedRouteIds: { type: "array", items: { type: "string" } },
      selectedFieldLayerIds: { type: "array", items: { type: "string" } },
      routeObjective: { type: "string" },
      timeCursor: { type: "string" },
      theoryReflectionRef: { type: "string" },
      ideologyReflectionRef: { type: "string" },
      scenarioFrame: { type: "object" },
      refs: { type: "array", items: { type: "string" } },
      options: {
        type: "object",
        properties: {
          includeBridgeContext: { type: "boolean" },
          includeCollaborationBounds: { type: "boolean" },
          includeFalsificationHooks: { type: "boolean" },
        },
      },
    },
    required: ["prompt"],
  },
  outputSchema: {
    type: "object",
    properties: {
      authority: { type: "object" },
      roadmap: { type: "object" },
      traversabilityAtlas: { type: "object" },
      traversabilityContext: { type: "object" },
      scenarioFrame: { type: "object" },
      bridgeContext: { type: "object" },
      missingEvidenceBoundaries: { type: "array", items: { type: "string" } },
      analogyBoundaries: { type: "array", items: { type: "string" } },
      supportRefs: { type: "array", items: { type: "string" } },
      parameterScopes: { type: "array", items: { type: "object" } },
      actionChannels: { type: "array", items: { type: "object" } },
      dependencyChains: { type: "array", items: { type: "object" } },
      comparisonCases: { type: "array", items: { type: "object" } },
      hypothesisClaims: { type: "array", items: { type: "object" } },
      proceduralScaffold: { type: "object" },
    },
    required: [
      "authority",
      "roadmap",
      "traversabilityAtlas",
      "traversabilityContext",
      "missingEvidenceBoundaries",
      "analogyBoundaries",
      "supportRefs",
      "parameterScopes",
      "actionChannels",
      "dependencyChains",
      "comparisonCases",
      "hypothesisClaims",
      "proceduralScaffold",
    ],
  },
  deterministic: true,
  rateLimit: { rpm: 120 },
  safety: { risks: [] },
  risk: {
    writesFiles: false,
    touchesNetwork: false,
    privileged: false,
  },
  provenance: {
    maturity: "diagnostic",
    certifying: false,
    metadataComplete: true,
    sourceClass: "declared",
  },
  health: "ok",
};

export const civilizationBoundsRoadmapHandler: ToolHandler = async (input: unknown) => {
  const parsed = CivilizationBoundsToolInputSchema.parse(input);
  return runHelixAskCivilizationBoundsTool({
    prompt: parsed.prompt,
    scenarioId: parsed.scenarioId,
    phaseId: parsed.phaseId,
    layerMode: parsed.layerMode as CivilizationLayerModeV1 | undefined,
    selectedSystemIds: parsed.selectedSystemIds,
    selectedBadgeIds: parsed.selectedBadgeIds,
    selectedRouteIds: parsed.selectedRouteIds,
    selectedFieldLayerIds: parsed.selectedFieldLayerIds,
    routeObjective: isCivilizationRouteObjective(parsed.routeObjective)
      ? parsed.routeObjective
      : undefined,
    timeCursor: parsed.timeCursor,
    theoryReflectionRef: parsed.theoryReflectionRef,
    ideologyReflectionRef: parsed.ideologyReflectionRef,
    scenarioFrame: parsed.scenarioFrame as CivilizationScenarioFrameV1 | undefined,
    refs: parsed.refs,
    options: parsed.options,
  });
};
