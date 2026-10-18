import { runBeliefGraphLoop } from "../../../modules/analysis/belief-graph-loop.js";
import {
  EXTERNAL_PRESSURE_BUNDLES,
  type ExternalPressure,
  type ExternalPressureInput,
} from "@shared/ideology/external-pressures";
import { getGuidanceArtifacts } from "./artifacts";

export type IdeologyGuidanceRequest = ExternalPressureInput & {
  topK?: number;
};

export type IdeologyGuidanceResponse = {
  invariant: "system advises, user decides.";
  detectedBundles: string[];
  recommendedNodeIds: string[];
  warnings: string[];
  recommendedArtifacts: string[];
  suggestedVerificationSteps: string[];
};

export const resolveIdeologyGuidance = (req: IdeologyGuidanceRequest): IdeologyGuidanceResponse => {
  const activeSet = new Set<ExternalPressure>(req.activePressures ?? []);
  const detected = EXTERNAL_PRESSURE_BUNDLES.filter((bundle) =>
    bundle.pressures.every((pressure) => activeSet.has(pressure)),
  );

  const trueIds = Array.from(new Set(detected.flatMap((bundle) => bundle.trueIds)));
  const falseIds = Array.from(new Set(detected.flatMap((bundle) => bundle.falseIds)));

  const nodes = Array.from(new Set([...trueIds, ...falseIds])).map((id) => ({
    id,
    score: trueIds.includes(id) ? 1 : -1,
    fixed: true,
  }));

  const edges = detected.flatMap((bundle) =>
    (bundle.edgeBoosts ?? []).map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: "implies" as const,
      weight: edge.weight,
    })),
  );

  const loop = runBeliefGraphLoop({
    graph: { nodes, edges },
    maxIterations: 4,
    stepSize: 0.2,
    thresholds: { violationMax: 0, violationWeightMax: 0 },
  });

  const scores = loop.finalState.nodes
    .map((node) => ({ id: node.id, score: node.score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const topK = req.topK ?? 5;
  const recommendedNodeIds = scores.filter((entry) => entry.score >= 0).slice(0, topK).map((entry) => entry.id);

  const recommendedArtifacts = getGuidanceArtifacts(recommendedNodeIds).map((artifact) => artifact.id);

  return {
    invariant: "system advises, user decides.",
    detectedBundles: detected.map((bundle) => bundle.id),
    recommendedNodeIds,
    warnings: Array.from(new Set(detected.flatMap((bundle) => bundle.warnings ?? []))),
    recommendedArtifacts,
    suggestedVerificationSteps: [
      "Pause and document the active pressure pattern.",
      "Request independent verification before any irreversible action.",
      "Escalate to a trusted review channel if financial risk is present.",
    ],
  };
};
