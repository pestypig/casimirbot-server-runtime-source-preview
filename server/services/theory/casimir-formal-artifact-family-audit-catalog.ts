import auditJson from "../../../configs/research/casimir-formal-theorem-audits/lanyon-gr-maxwell-b13da44.v1.json";
import generationLineageAuditJson from "../../../configs/research/casimir-formal-generation-lineage-audits/lanyon-gr-maxwell-b13da44.v1.json";
import {
  validateCasimirFormalArtifactGenerationLineageAuditIntegrityV1,
  type CasimirFormalArtifactGenerationLineageAuditV1,
} from "../../../shared/contracts/casimir-formal-artifact-generation-lineage-audit.v1";
import {
  validateCasimirFormalArtifactFamilyAuditV1,
  type CasimirFormalArtifactFamilyAuditV1,
  type CasimirFormalArtifactFamilyCaseV1,
  type CasimirFormalAuditedTheoremV1,
} from "../../../shared/contracts/casimir-formal-artifact-family-audit.v1";

const AUDIT = auditJson as CasimirFormalArtifactFamilyAuditV1;
const GENERATION_LINEAGE_AUDIT =
  generationLineageAuditJson as CasimirFormalArtifactGenerationLineageAuditV1;

export type CasimirFormalArtifactFamilyTheoremCatalogEntryV1 = {
  auditArtifactSha256: string;
  formalArtifactId: string;
  caseEntry: CasimirFormalArtifactFamilyCaseV1;
  theorem: CasimirFormalAuditedTheoremV1;
  authority: {
    serverGovernedSourceAudit: true;
    exactDeclarationBound: true;
    exactPropositionSourceBound: true;
    generatorLineageRegistered: false;
    observedTheoremTypeBound: false;
    semanticBindingRegistered: false;
    replayEligible: false;
    formalPropositionChecked: false;
    scientificAuthority: false;
    physicalAuthority: false;
    assistantAnswer: false;
    terminalEligible: false;
  };
};

const formalArtifactIdForCase = (caseId: string): string =>
  `casimir:lanyon:${caseId}:formal_source`;

let integrityPromise: Promise<string[]> | null = null;
const integrityIssues = (): Promise<string[]> => {
  integrityPromise ??= (async () => {
    const issues = [
      ...(await validateCasimirFormalArtifactFamilyAuditV1(AUDIT)).map(
        (issue) => `source_audit:${issue}`,
      ),
      ...(
        await validateCasimirFormalArtifactGenerationLineageAuditIntegrityV1(
          GENERATION_LINEAGE_AUDIT,
        )
      ).map((issue) => `generation_lineage_audit:${issue}`),
    ];
    if (
      GENERATION_LINEAGE_AUDIT.sourceAuditArtifactSha256 !==
        AUDIT.artifactSha256 ||
      GENERATION_LINEAGE_AUDIT.repository.producerId !==
        AUDIT.repository.producerId ||
      GENERATION_LINEAGE_AUDIT.repository.uri !== AUDIT.repository.uri ||
      GENERATION_LINEAGE_AUDIT.repository.commitSha !==
        AUDIT.repository.commitSha ||
      GENERATION_LINEAGE_AUDIT.repository.selectedSourceTreeSha256 !==
        AUDIT.repository.selectedSourceTreeSha256 ||
      GENERATION_LINEAGE_AUDIT.repository.canonicalByteSource !==
        AUDIT.repository.canonicalByteSource
    ) {
      issues.push("generation_lineage_audit:source_audit_binding_mismatch");
    }
    return [...new Set(issues)].sort();
  })();
  return integrityPromise;
};

export async function inspectCasimirFormalArtifactFamilyAuditCatalogV1() {
  const issues = await integrityIssues();
  return {
    schema: "casimir.formal_artifact_family_audit_catalog.v1" as const,
    configured: issues.length === 0,
    auditArtifactSha256: issues.length === 0 ? AUDIT.artifactSha256 : null,
    generationLineageAuditArtifactSha256:
      issues.length === 0
        ? GENERATION_LINEAGE_AUDIT.artifactSha256
        : null,
    generatorLineageStatus:
      issues.length === 0
        ? GENERATION_LINEAGE_AUDIT.generatorLineage.status
        : null,
    executionEnrollmentEligible: false,
    executionEnrollmentBlockers:
      issues.length === 0
        ? [GENERATION_LINEAGE_AUDIT.generatorLineage.blockerCode]
        : ["formal_artifact_family_audit_catalog_invalid"],
    repositoryCommitSha:
      issues.length === 0 ? AUDIT.repository.commitSha : null,
    formalArtifactIds:
      issues.length === 0
        ? AUDIT.cases.map((entry) => formalArtifactIdForCase(entry.caseId)).sort()
        : [],
    theoremCount: issues.length === 0 ? AUDIT.theorems.length : 0,
    issues,
    assistantAnswer: false as const,
    terminalEligible: false as const,
  };
}

export async function resolveCasimirFormalArtifactFamilyTheoremCatalogEntryV1(
  input: {
    formalArtifactId: string | null | undefined;
    formalSourceSha256: string | null | undefined;
    theoremName: string | null | undefined;
  },
): Promise<CasimirFormalArtifactFamilyTheoremCatalogEntryV1 | null> {
  if ((await integrityIssues()).length > 0) return null;
  const formalArtifactId = input.formalArtifactId?.trim();
  const formalSourceSha256 = input.formalSourceSha256?.trim();
  const theoremName = input.theoremName?.trim();
  if (!formalArtifactId || !formalSourceSha256 || !theoremName) return null;
  const caseEntry =
    AUDIT.cases.find(
      (entry) =>
        formalArtifactIdForCase(entry.caseId) === formalArtifactId &&
        entry.formalSource.sha256 === formalSourceSha256,
    ) ?? null;
  if (!caseEntry) return null;
  const theorem =
    AUDIT.theorems.find(
      (entry) =>
        entry.caseId === caseEntry.caseId &&
        entry.logicalPath === caseEntry.formalSource.logicalPath &&
        entry.moduleName === caseEntry.formalSource.moduleName &&
        entry.theoremName === theoremName,
    ) ?? null;
  if (!theorem) return null;
  return {
    auditArtifactSha256: AUDIT.artifactSha256,
    formalArtifactId,
    caseEntry,
    theorem,
    authority: {
      serverGovernedSourceAudit: true,
      exactDeclarationBound: true,
      exactPropositionSourceBound: true,
      generatorLineageRegistered: false,
      observedTheoremTypeBound: false,
      semanticBindingRegistered: false,
      replayEligible: false,
      formalPropositionChecked: false,
      scientificAuthority: false,
      physicalAuthority: false,
      assistantAnswer: false,
      terminalEligible: false,
    },
  };
}

export async function queryCasimirFormalArtifactFamilyAuditCatalogV1(input: {
  formalArtifactId?: string | null;
  theoremName?: string | null;
}) {
  const issues = await integrityIssues();
  const formalArtifactId = input.formalArtifactId?.trim() || null;
  const theoremName = input.theoremName?.trim() || null;
  if (issues.length > 0) {
    return {
      ok: false,
      status: "blocked" as const,
      issues: ["formal_artifact_family_audit_catalog_invalid", ...issues],
      auditArtifactSha256: null,
      cases: [],
      selectedCase: null,
      selectedTheorem: null,
      authority: {
        sourceAdmissionAuthority: false,
        formalPropositionChecked: false,
        replayEligible: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    };
  }
  const selectedCase = formalArtifactId
    ? (AUDIT.cases.find(
        (entry) =>
          formalArtifactIdForCase(entry.caseId) === formalArtifactId,
      ) ?? null)
    : null;
  const selectedTheorem =
    selectedCase && theoremName
      ? (AUDIT.theorems.find(
          (entry) =>
            entry.caseId === selectedCase.caseId &&
            entry.theoremName === theoremName,
        ) ?? null)
      : null;
  const queryIssues = [
    ...(formalArtifactId && !selectedCase
      ? ["formal_artifact_family_case_unregistered"]
      : []),
    ...(theoremName && !formalArtifactId
      ? ["formal_artifact_id_required_for_theorem_query"]
      : []),
    ...(selectedCase && theoremName && !selectedTheorem
      ? ["formal_artifact_family_theorem_unregistered"]
      : []),
  ];
  return {
    ok: queryIssues.length === 0,
    status:
      queryIssues.length === 0
        ? ("succeeded" as const)
        : ("blocked" as const),
    issues: queryIssues,
    auditArtifactSha256: AUDIT.artifactSha256,
    generationLineageAudit: {
      auditId: GENERATION_LINEAGE_AUDIT.auditId,
      artifactSha256: GENERATION_LINEAGE_AUDIT.artifactSha256,
      sourceAuditArtifactSha256:
        GENERATION_LINEAGE_AUDIT.sourceAuditArtifactSha256,
      recursiveTreeInspection: {
        ref: GENERATION_LINEAGE_AUDIT.recursiveTreeInspection.ref,
        complete: GENERATION_LINEAGE_AUDIT.recursiveTreeInspection.complete,
        truncated: GENERATION_LINEAGE_AUDIT.recursiveTreeInspection.truncated,
        entryCount:
          GENERATION_LINEAGE_AUDIT.recursiveTreeInspection.entryCount,
        pathSetSha256:
          GENERATION_LINEAGE_AUDIT.recursiveTreeInspection.pathSetSha256,
        generatorCandidatePaths:
          GENERATION_LINEAGE_AUDIT.recursiveTreeInspection
            .generatorCandidatePaths,
      },
      generatorLineage: GENERATION_LINEAGE_AUDIT.generatorLineage,
      authority: GENERATION_LINEAGE_AUDIT.authority,
    },
    repository: {
      uri: AUDIT.repository.uri,
      commitSha: AUDIT.repository.commitSha,
      selectedSourceTreeSha256:
        AUDIT.repository.selectedSourceTreeSha256,
      canonicalByteSource: AUDIT.repository.canonicalByteSource,
    },
    environment: AUDIT.environment,
    cases: AUDIT.cases.map((entry) => ({
      formalArtifactId: formalArtifactIdForCase(entry.caseId),
      caseId: entry.caseId,
      formulation: entry.formulation,
      dimensions: entry.dimensions,
      formalSourceSha256: entry.formalSource.sha256,
      theoremCount: entry.formalSource.theoremCount,
    })),
    selectedCase: selectedCase
      ? {
          formalArtifactId: formalArtifactIdForCase(selectedCase.caseId),
          caseId: selectedCase.caseId,
          formulation: selectedCase.formulation,
          dimensions: selectedCase.dimensions,
          specification: selectedCase.specification,
          formalSource: selectedCase.formalSource,
          implementationSource: selectedCase.implementationSource,
          artifactLineage: {
            specification: selectedCase.specification,
            formalSource: selectedCase.formalSource,
            implementationSource: selectedCase.implementationSource,
            generator: GENERATION_LINEAGE_AUDIT.generatorLineage,
            completeForExecutionEnrollment: false,
          },
          executionEnrollmentReadiness: {
            status: "blocked" as const,
            blockerCodes: [
              GENERATION_LINEAGE_AUDIT.generatorLineage.blockerCode,
              "formal_c_implementation_placeholder_noop",
              "formal_c_refinement_unassessed",
              "formal_environment_unpinned",
              "formal_import_closure_unpinned",
              "semantic_to_lean_binding_required",
              "observed_theorem_type_required",
            ],
            authority: {
              sourceLineageAssessed: true,
              executionEnrollmentAuthority: false,
              assistantAnswer: false,
              terminalEligible: false,
            },
          },
          theorems: AUDIT.theorems
            .filter((entry) => entry.caseId === selectedCase.caseId)
            .map((entry) => ({
              theoremName: entry.theoremName,
              theoremId: entry.theoremId,
              declarationSha256: entry.declarationSha256,
              propositionSourceSha256: entry.propositionSourceSha256,
              propertyKind: entry.propertyKind,
              claimCeiling: entry.claimCeiling,
              deniedPromotions: entry.deniedPromotions,
              replay: entry.replay,
            })),
        }
      : null,
    selectedTheorem,
    authority: {
      sourceAdmissionAuthority: true,
      generatorLineageRegistered: false,
      formalPropositionChecked: false,
      replayEligible: false,
      scientificAuthority: false,
      numericalAuthority: false,
      empiricalAuthority: false,
      physicalAuthority: false,
      assistantAnswer: false,
      terminalEligible: false,
    },
  };
}

export function resetCasimirFormalArtifactFamilyAuditCatalogForTestsV1(): void {
  integrityPromise = null;
}
