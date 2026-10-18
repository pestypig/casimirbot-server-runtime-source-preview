import { z } from "zod";
import type { CivilizationMappedNetworkRouteCandidateV1 } from "@shared/civilization-traversability-atlas";
import {
  civilizationNaturalEarthHydrographyOutputSchema,
  type CivilizationNaturalEarthHydrographyEvidence,
} from "./natural-earth-hydrography";
import { segmentContact } from "./route-boundary-line-review";

const MAX_ENCOUNTERS = 150;
const MAX_COMPARISONS = 1_000_000;

export type CivilizationRouteHydrographyEncounter = {
  candidateId: string;
  routeSegmentIndex: number;
  mappedEdgeId: string;
  hydrographicLineId: string;
  hydrographicFeatureKind: "river" | "lake_centerline";
  hydrographicLabel: string;
  contactKind: "point" | "overlap";
  position: { lat: number; lon: number };
  sourceRecordUrl: string;
  routeEvidenceRefs: string[];
  hydrographicEvidenceRefs: string[];
};

export type CivilizationRouteHydrographyReview =
  | { status: "not_requested" | "no_candidate"; missingEvidence: string[] }
  | { status: "unavailable"; errorCode: string; missingEvidence: string[] }
  | {
    status: "available";
    source: CivilizationNaturalEarthHydrographyEvidence["source"];
    sourceCoverage: CivilizationNaturalEarthHydrographyEvidence["coverage"];
    encounters: CivilizationRouteHydrographyEncounter[];
    possiblyTruncated: boolean;
    missingEvidence: string[];
  };

const encounterSchema = z.object({
  candidateId: z.string().min(1),
  routeSegmentIndex: z.number().int().nonnegative(),
  mappedEdgeId: z.string().min(1),
  hydrographicLineId: z.string().min(1),
  hydrographicFeatureKind: z.enum(["river", "lake_centerline"]),
  hydrographicLabel: z.string().min(1),
  contactKind: z.enum(["point", "overlap"]),
  position: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict(),
  sourceRecordUrl: z.string().url(),
  routeEvidenceRefs: z.array(z.string()),
  hydrographicEvidenceRefs: z.array(z.string()),
}).strict();

export const civilizationRouteHydrographyReviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("no_candidate"), missingEvidence: z.array(z.string()) }).strict(),
  z.object({
    status: z.literal("unavailable"),
    errorCode: z.string().min(1),
    missingEvidence: z.array(z.string()),
  }).strict(),
  z.object({
    status: z.literal("available"),
    source: civilizationNaturalEarthHydrographyOutputSchema.shape.source,
    sourceCoverage: civilizationNaturalEarthHydrographyOutputSchema.shape.coverage,
    encounters: z.array(encounterSchema).max(MAX_ENCOUNTERS),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
]);

export function reviewRouteHydrographyEncounters(
  candidates: CivilizationMappedNetworkRouteCandidateV1[],
  evidence: CivilizationNaturalEarthHydrographyEvidence,
): CivilizationRouteHydrographyReview {
  const lines = evidence.atlas.hydrographicLines ?? [];
  const encounters: CivilizationRouteHydrographyEncounter[] = [];
  const seen = new Set<string>();
  let comparisons = 0;
  let comparisonLimitReached = false;
  let encounterLimitReached = false;
  outer: for (const candidate of candidates) {
    for (let routeSegmentIndex = 0; routeSegmentIndex < candidate.segments.length; routeSegmentIndex++) {
      const a = candidate.coordinates[routeSegmentIndex];
      const b = candidate.coordinates[routeSegmentIndex + 1];
      if (!a || !b) continue;
      for (const line of lines) {
        for (const part of line.lineParts) {
          for (let index = 1; index < part.length; index++) {
            comparisons++;
            if (comparisons > MAX_COMPARISONS) {
              comparisonLimitReached = true;
              break outer;
            }
            const hit = segmentContact(a, b, part[index - 1], part[index]);
            if (!hit) continue;
            const key = [
              candidate.candidateId, routeSegmentIndex, line.lineId,
              hit.position.lon.toFixed(6), hit.position.lat.toFixed(6),
            ].join(":");
            if (seen.has(key)) continue;
            seen.add(key);
            if (encounters.length >= MAX_ENCOUNTERS) {
              encounterLimitReached = true;
              break outer;
            }
            encounters.push({
              candidateId: candidate.candidateId,
              routeSegmentIndex,
              mappedEdgeId: candidate.segments[routeSegmentIndex].edgeId,
              hydrographicLineId: line.lineId,
              hydrographicFeatureKind: line.featureKind,
              hydrographicLabel: line.label,
              contactKind: hit.kind,
              position: hit.position,
              sourceRecordUrl: line.sourceRecordUrl,
              routeEvidenceRefs: candidate.segments[routeSegmentIndex].evidenceRefs,
              hydrographicEvidenceRefs: line.evidenceRefs,
            });
          }
        }
      }
    }
  }
  const possiblyTruncated = evidence.coverage.possiblyTruncated || comparisonLimitReached || encounterLimitReached;
  return {
    status: "available",
    source: evidence.source,
    sourceCoverage: evidence.coverage,
    encounters,
    possiblyTruncated,
    missingEvidence: [
      ...evidence.coverage.missingEvidence,
      "cartographic_contact_is_not_a_crossing_design_or_navigability_finding",
      "water_level_discharge_seasonality_and_rights_unassessed",
      ...(comparisonLimitReached ? ["geometry_comparison_limit_reached"] : []),
      ...(encounterLimitReached ? ["additional_geometric_encounters_not_returned"] : []),
    ],
  };
}
