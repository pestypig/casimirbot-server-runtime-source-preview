import { z } from "zod";
import { buildHelixTheoryBadgeGraphV1 } from "@shared/theory/helix-theory-badge-graph";
import {
  LIGHT_SPEED_M_S,
  STANDARD_GRAVITY_M_S2,
  YB171_CLOCK_FREQUENCY_HZ,
  idealSuccessfulPairsForUncertainty,
  responseCoefficients,
  terrestrialClockSignal,
} from "@shared/theory/ytterbium-clock-proposal-calculation";

const BADGE_IDS = [
  "clock.yb171.terrestrial_redshift_prediction",
  "clock.yb171.opposite_energy_spin_preparations",
  "clock.yb171.dimensionless_response_test",
] as const;

export const ytterbiumClockProposalQuerySchema = z.object({
  heightsM: z.array(z.number().finite().positive().max(1000)).min(1).max(8).optional(),
  interrogationS: z.number().finite().positive().max(1000).optional(),
  contrast: z.number().finite().positive().max(1).optional(),
  targetCoefficientUncertainty: z.number().finite().positive().max(1).optional(),
  kappaPlus: z.number().finite().optional(),
  kappaMinus: z.number().finite().optional(),
}).strict().refine(
  value => (value.kappaPlus === undefined) === (value.kappaMinus === undefined),
  "kappaPlus and kappaMinus must be provided together",
);

export const ytterbiumClockProposalOutputSchema = z.object({
  schemaVersion: z.literal("ytterbium_clock_theory_graph_mcp/v1"),
  graphId: z.string(),
  badgeIds: z.array(z.string()),
  badges: z.array(z.any()),
  edges: z.array(z.any()),
  model: z.object({
    kind: z.literal("stationary_weak_field_constant_gravity"),
    clockFrequencyHz: z.number(),
    gravityM_S2: z.number(),
    lightSpeedM_S: z.number(),
    equations: z.array(z.string()),
  }),
  designRows: z.array(z.object({
    heightDifferenceM: z.number(),
    potentialDifferenceM2S2: z.number(),
    fractionalRateDifference: z.number(),
    frequencyDifferenceHz: z.number(),
    phaseRateRadS: z.number(),
    phaseRad: z.number(),
    secondsForHalfRadian: z.number(),
    idealSuccessfulPairs: z.number().nullable(),
  })),
  interrogationS: z.number(),
  response: z.object({ kappa0: z.number(), etaES: z.number() }).nullable(),
  standardPrediction: z.object({ kappaCl: z.literal(1), kappa0: z.literal(1), etaES: z.literal(0) }),
  sourcePaths: z.array(z.string()),
  authority: z.object({
    status: z.literal("analytic_design_only"),
    measuredResult: z.literal(false),
    apparatusDemonstrated: z.literal(false),
    terminalEligible: z.literal(false),
    claimBoundary: z.string(),
  }),
});

export function readYtterbiumClockProposal(
  query: z.infer<typeof ytterbiumClockProposalQuerySchema>,
) {
  const graph = buildHelixTheoryBadgeGraphV1();
  const badgeIds = new Set<string>(BADGE_IDS);
  const heights = query.heightsM ?? [0.01, 1, 10, 100, 450];
  const interrogationS = query.interrogationS ?? 1;
  const designRows = heights.map(height => {
    const signal = terrestrialClockSignal(height);
    return {
      heightDifferenceM: signal.heightDifferenceM,
      potentialDifferenceM2S2: signal.potentialDifferenceM2S2,
      fractionalRateDifference: signal.fractionalRateDifference,
      frequencyDifferenceHz: signal.frequencyDifferenceHz,
      phaseRateRadS: signal.phaseRateRadS,
      phaseRad: signal.phaseRateRadS * interrogationS,
      secondsForHalfRadian: signal.secondsForHalfRadian,
      idealSuccessfulPairs: query.contrast !== undefined && query.targetCoefficientUncertainty !== undefined
        ? idealSuccessfulPairsForUncertainty(height, interrogationS, query.contrast, query.targetCoefficientUncertainty)
        : null,
    };
  });
  return {
    schemaVersion: "ytterbium_clock_theory_graph_mcp/v1" as const,
    graphId: graph.graphId,
    badgeIds: [...BADGE_IDS],
    badges: graph.badges.filter(badge => badgeIds.has(badge.id)),
    edges: graph.edges.filter(edge => badgeIds.has(edge.from) && badgeIds.has(edge.to)),
    model: {
      kind: "stationary_weak_field_constant_gravity" as const,
      clockFrequencyHz: YB171_CLOCK_FREQUENCY_HZ,
      gravityM_S2: STANDARD_GRAVITY_M_S2,
      lightSpeedM_S: LIGHT_SPEED_M_S,
      equations: ["Delta_U = g * height", "Delta_nu = nu_0 * Delta_U / c^2", "phase = 2*pi*Delta_nu*T", "kappa_0 = (kappa_plus+kappa_minus)/2", "eta_ES = (kappa_plus-kappa_minus)/2"],
    },
    designRows,
    interrogationS,
    response: query.kappaPlus !== undefined && query.kappaMinus !== undefined
      ? responseCoefficients(query.kappaPlus, query.kappaMinus)
      : null,
    standardPrediction: { kappaCl: 1 as const, kappa0: 1 as const, etaES: 0 as const },
    sourcePaths: [
      "docs/research/ytterbium-energy-spin-gravitational-clock-proposal.md",
      "docs/research/ytterbium-clock-proposal-calculations.json",
      "shared/theory/ytterbium-clock-proposal-calculation.ts",
    ],
    authority: {
      status: "analytic_design_only" as const,
      measuredResult: false as const,
      apparatusDemonstrated: false as const,
      terminalEligible: false as const,
      claimBoundary: "Calculated design values and graph context only. No measured gravitational response, Bell-state verification, apparatus performance, or new spin-gravity mechanism is established.",
    },
  };
}
