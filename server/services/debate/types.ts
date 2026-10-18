import type { TViabilityStatus, TWarpConstraintEvidence, TWarpGrounding } from "@shared/essence-debate";

export type ViabilityStatus = TViabilityStatus;
export type WarpConstraintEvidence = TWarpConstraintEvidence;
export type WarpGrounding = TWarpGrounding;

export const DEBATE_CLAIM_TIERS = ["diagnostic", "reduced-order", "certified"] as const;
export const DEBATE_PROVENANCE_CLASSES = ["measured", "proxy", "inferred"] as const;
export const DEBATE_STRICT_PROVENANCE_FAIL_REASON = "DEBATE_EVIDENCE_PROVENANCE_MISSING" as const;

export type DebateClaimTier = (typeof DEBATE_CLAIM_TIERS)[number];
export type DebateProvenanceClass = (typeof DEBATE_PROVENANCE_CLASSES)[number];

export type DebateEvidenceProvenance = {
  provenance_class: DebateProvenanceClass;
  claim_tier: DebateClaimTier;
  certifying: boolean;
  fail_reason?: typeof DEBATE_STRICT_PROVENANCE_FAIL_REASON;
};

export const DEFAULT_DEBATE_EVIDENCE_PROVENANCE: DebateEvidenceProvenance = {
  provenance_class: "proxy",
  claim_tier: "diagnostic",
  certifying: false,
};
