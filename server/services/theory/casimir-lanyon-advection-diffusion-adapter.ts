import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { HelixAccountType } from "../../../shared/helix-account-session";
import {
  buildCasimirArtifactGenerationReceiptV1,
  type CasimirArtifactGenerationReceiptV1,
  type CasimirArtifactGenerationRequestV1,
  validateCasimirArtifactGenerationReceiptAgainstRequestV1,
  validateCasimirArtifactGenerationReceiptIntegrityV1,
  validateCasimirArtifactGenerationRequestIntegrityV1,
} from "../../../shared/contracts/casimir-artifact-generation.v1";
import {
  buildCasimirLanyonAdapterPolicyV1,
  CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
  CASIMIR_LANYON_ADAPTER_POLICY_SCHEMA_VERSION,
  CASIMIR_LANYON_PRODUCER_ID,
  type CasimirLanyonAdapterPolicyV1,
  type CasimirLanyonAdvectionDiffusionCaseV1,
  type CasimirLanyonSourceArtifactV1,
  validateCasimirLanyonAdapterPolicyIntegrityV1,
} from "../../../shared/contracts/casimir-lanyon-advection-diffusion-adapter.v1";

export const CASIMIR_LANYON_ADAPTER_ADMISSION_SCHEMA =
  "casimir.lanyon_advection_diffusion_adapter_admission.v1" as const;

export type CasimirLanyonInspectedArtifactV1 = CasimirLanyonSourceArtifactV1 & {
  absolutePath: string;
};

export type CasimirLanyonInspectedSnapshotV1 = {
  sourceRoot: string;
  selectedSourceTreeSha256: string;
  artifacts: CasimirLanyonInspectedArtifactV1[];
};

export type CasimirLanyonAdapterAdmissionV1 = {
  schema: typeof CASIMIR_LANYON_ADAPTER_ADMISSION_SCHEMA;
  ok: boolean;
  status: "admitted" | "blocked";
  caseId: string | null;
  policy: {
    schemaVersion: typeof CASIMIR_LANYON_ADAPTER_POLICY_SCHEMA_VERSION;
    policyId: string;
    artifactSha256: string;
  };
  issues: string[];
  receipt: CasimirArtifactGenerationReceiptV1 | null;
  artifactBindings: {
    specificationPath: string;
    formalSourcePath: string;
    implementationSourcePath: string;
    buildManifest: {
      mediaType: "application/json";
      logicalPath: string;
      artifactSha256: string;
      sizeBytes: number;
      canonicalJson: string;
    };
  } | null;
  authority: {
    outputRole: "evidence_for_bounded_synthesis";
    sourceBytesAdmitted: boolean;
    providerOutputTrusted: false;
    formalPropositionChecked: false;
    validatesSemanticIntent: false;
    validatesTheory: false;
    validatesGeneratedCode: false;
    validatesNumericalImplementation: false;
    validatesEmpiricalClaim: false;
    validatesPhysicalMechanism: false;
    assistantAnswer: false;
    terminalEligible: false;
    promotionAllowed: false;
    postToolModelStepRequired: true;
  };
};

type AdapterDependencies = {
  now?: () => Date;
  inspectSnapshot?: (
    sourceRoot: string,
    policy: CasimirLanyonAdapterPolicyV1,
  ) => Promise<CasimirLanyonInspectedSnapshotV1>;
  environmentIdentity?: () => Record<string, unknown>;
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
};

const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(canonical(value))}\n`;

const authority = (
  sourceBytesAdmitted: boolean,
): CasimirLanyonAdapterAdmissionV1["authority"] => ({
  outputRole: "evidence_for_bounded_synthesis",
  sourceBytesAdmitted,
  providerOutputTrusted: false,
  formalPropositionChecked: false,
  validatesSemanticIntent: false,
  validatesTheory: false,
  validatesGeneratedCode: false,
  validatesNumericalImplementation: false,
  validatesEmpiricalClaim: false,
  validatesPhysicalMechanism: false,
  assistantAnswer: false,
  terminalEligible: false,
  promotionAllowed: false,
  postToolModelStepRequired: true,
});

const selectedArtifacts = (
  policy: CasimirLanyonAdapterPolicyV1,
): CasimirLanyonSourceArtifactV1[] =>
  policy.cases
    .flatMap((entry) => [
      entry.specification,
      entry.formalSource,
      entry.implementationSource,
    ])
    .sort((left, right) =>
      left.logicalPath.localeCompare(right.logicalPath, "en"),
    );

async function inspectRegularFile(
  root: string,
  expected: CasimirLanyonSourceArtifactV1,
): Promise<CasimirLanyonInspectedArtifactV1> {
  const candidate = path.resolve(root, ...expected.logicalPath.split("/"));
  const rootPrefix = `${root}${path.sep}`;
  if (
    !candidate.startsWith(rootPrefix) ||
    candidate === root ||
    path.relative(root, candidate).split(path.sep).includes("..")
  ) {
    throw new Error(`source_path_escape:${expected.logicalPath}`);
  }
  const stat = await fs.lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`source_not_regular_file:${expected.logicalPath}`);
  const realPath = await fs.realpath(candidate);
  const same =
    process.platform === "win32"
      ? realPath.toLowerCase() === candidate.toLowerCase()
      : realPath === candidate;
  if (!same)
    throw new Error(`source_path_alias_forbidden:${expected.logicalPath}`);
  const bytes = await fs.readFile(candidate);
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expected.sha256)
    throw new Error(`source_hash_mismatch:${expected.logicalPath}`);
  if (bytes.byteLength !== expected.sizeBytes)
    throw new Error(`source_size_mismatch:${expected.logicalPath}`);
  return { ...expected, absolutePath: candidate };
}

export async function inspectCasimirLanyonPinnedSnapshotV1(
  sourceRoot: string,
  policy: CasimirLanyonAdapterPolicyV1,
): Promise<CasimirLanyonInspectedSnapshotV1> {
  if (!path.isAbsolute(sourceRoot))
    throw new Error("source_root_path_not_absolute");
  const resolvedRoot = path.resolve(sourceRoot);
  const stat = await fs.lstat(resolvedRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("source_root_not_regular_directory");
  const realRoot = await fs.realpath(resolvedRoot);
  const same =
    process.platform === "win32"
      ? realRoot.toLowerCase() === resolvedRoot.toLowerCase()
      : realRoot === resolvedRoot;
  if (!same) throw new Error("source_root_path_alias_forbidden");

  const artifacts: CasimirLanyonInspectedArtifactV1[] = [];
  for (const expected of selectedArtifacts(policy)) {
    artifacts.push(await inspectRegularFile(resolvedRoot, expected));
  }
  const selectedSourceTreeSha256 = sha256(
    `${artifacts
      .map(
        (entry) => `${entry.logicalPath}\t${entry.sha256}\t${entry.sizeBytes}`,
      )
      .join("\n")}\n`,
  );
  if (selectedSourceTreeSha256 !== policy.repository.selectedSourceTreeSha256) {
    throw new Error("selected_source_tree_hash_mismatch");
  }
  return {
    sourceRoot: resolvedRoot,
    selectedSourceTreeSha256,
    artifacts,
  };
}

const blocked = (
  caseId: string | null,
  policy: CasimirLanyonAdapterPolicyV1,
  issues: string[],
): CasimirLanyonAdapterAdmissionV1 => ({
  schema: CASIMIR_LANYON_ADAPTER_ADMISSION_SCHEMA,
  ok: false,
  status: "blocked",
  caseId,
  policy: {
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    artifactSha256: policy.artifactSha256,
  },
  issues: [...new Set(issues)].sort(),
  receipt: null,
  artifactBindings: null,
  authority: authority(false),
});

const findInspected = (
  snapshot: CasimirLanyonInspectedSnapshotV1,
  expected: CasimirLanyonSourceArtifactV1,
): CasimirLanyonInspectedArtifactV1 | null =>
  snapshot.artifacts.find(
    (entry) =>
      entry.logicalPath === expected.logicalPath &&
      entry.sha256 === expected.sha256 &&
      entry.sizeBytes === expected.sizeBytes,
  ) ?? null;

function validateRequestForCase(
  request: CasimirArtifactGenerationRequestV1,
  policy: CasimirLanyonAdapterPolicyV1,
  selectedCase: CasimirLanyonAdvectionDiffusionCaseV1,
): string[] {
  const issues: string[] = [];
  if (
    request.producerPolicy.adapterContractId !==
    CASIMIR_LANYON_ADAPTER_CONTRACT_ID
  ) {
    issues.push("request_adapter_contract_id_mismatch");
  }
  if (request.producerPolicy.adapterContractSha256 !== policy.artifactSha256) {
    issues.push("request_adapter_contract_hash_mismatch");
  }
  if (
    !request.producerPolicy.allowedProducerIds.includes(
      CASIMIR_LANYON_PRODUCER_ID,
    )
  ) {
    issues.push("request_lanyon_producer_not_allowed");
  }
  if (
    request.sourcePacket.artifactSha256 !== selectedCase.specification.sha256
  ) {
    issues.push("request_source_packet_not_pinned_lanyon_specification");
  }
  if (request.sourcePacket.mediaType !== "text/x-racket")
    issues.push("request_source_packet_media_type_must_be_text_x_racket");
  const roles = request.requestedArtifacts.map((entry) => entry.role).sort();
  const expectedRoles = [
    "build_manifest",
    "formal_source",
    "implementation_source",
    "numerical_case",
  ];
  if (JSON.stringify(roles) !== JSON.stringify(expectedRoles))
    issues.push("request_must_contain_exactly_four_lanyon_artifact_roles");
  return issues;
}

export function createCasimirLanyonAdvectionDiffusionAdapter(
  dependencies: AdapterDependencies = {},
) {
  const inspectSnapshot =
    dependencies.inspectSnapshot ?? inspectCasimirLanyonPinnedSnapshotV1;
  const now = dependencies.now ?? (() => new Date());
  const environmentIdentity =
    dependencies.environmentIdentity ??
    (() => ({
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
    }));

  const admit = async (input: {
    accountType: HelixAccountType;
    profileId?: string | null;
    sourceRoot: string;
    caseId: string;
    request: CasimirArtifactGenerationRequestV1;
  }): Promise<CasimirLanyonAdapterAdmissionV1> => {
    const policy = await buildCasimirLanyonAdapterPolicyV1();
    const issues = await validateCasimirLanyonAdapterPolicyIntegrityV1(policy);
    if (input.accountType !== "developer")
      issues.push("developer_account_required");
    const requestIssues =
      await validateCasimirArtifactGenerationRequestIntegrityV1(input.request);
    issues.push(...requestIssues.map((issue) => `request:${issue}`));
    const selectedCase =
      policy.cases.find((entry) => entry.caseId === input.caseId) ?? null;
    if (!selectedCase) issues.push("lanyon_case_not_in_pinned_policy");
    if (requestIssues.length === 0 && selectedCase) {
      issues.push(
        ...validateRequestForCase(input.request, policy, selectedCase),
      );
    }
    if (issues.length > 0) return blocked(input.caseId || null, policy, issues);
    const admittedCase = selectedCase as CasimirLanyonAdvectionDiffusionCaseV1;

    let snapshot: CasimirLanyonInspectedSnapshotV1;
    try {
      snapshot = await inspectSnapshot(input.sourceRoot, policy);
    } catch (error) {
      return blocked(input.caseId, policy, [
        error instanceof Error
          ? error.message
          : "source_snapshot_inspection_failed",
      ]);
    }
    const specification = findInspected(snapshot, admittedCase.specification);
    const formalSource = findInspected(snapshot, admittedCase.formalSource);
    const implementationSource = findInspected(
      snapshot,
      admittedCase.implementationSource,
    );
    if (!specification || !formalSource || !implementationSource) {
      return blocked(input.caseId, policy, [
        "selected_case_artifact_missing_after_snapshot_admission",
      ]);
    }

    const buildManifestValue = {
      schema: "casimir.lanyon_advection_diffusion_build_manifest.v1",
      policy: {
        policyId: policy.policyId,
        artifactSha256: policy.artifactSha256,
      },
      request: {
        requestId: input.request.requestId,
        artifactSha256: input.request.artifactSha256,
        casimirSpecSemanticSha256: input.request.casimirSpec.semanticSha256,
        claimId: input.request.claim.claimId,
        propositionSha256: input.request.claim.propositionSha256,
      },
      upstream: {
        repositoryUri: policy.repository.uri,
        commitSha: policy.repository.commitSha,
        selectedSourceTreeSha256: snapshot.selectedSourceTreeSha256,
      },
      selectedCase: {
        caseId: admittedCase.caseId,
        kind: admittedCase.kind,
        dimensions: admittedCase.dimensions,
      },
      artifacts: [
        {
          role: "formal_source",
          logicalPath: formalSource.logicalPath,
          sha256: formalSource.sha256,
          sizeBytes: formalSource.sizeBytes,
        },
        {
          role: "implementation_source",
          logicalPath: implementationSource.logicalPath,
          sha256: implementationSource.sha256,
          sizeBytes: implementationSource.sizeBytes,
        },
        {
          role: "numerical_case",
          logicalPath: specification.logicalPath,
          sha256: specification.sha256,
          sizeBytes: specification.sizeBytes,
        },
      ],
    };
    const buildManifestJson = canonicalJson(buildManifestValue);
    const buildManifestSha256 = sha256(buildManifestJson);
    const startedAt = now().toISOString();
    const transcript = canonicalJson({
      operation: "admit_pinned_lanyon_snapshot",
      profileId: input.profileId?.trim() || null,
      policySha256: policy.artifactSha256,
      requestSha256: input.request.artifactSha256,
      caseId: input.caseId,
      selectedSourceTreeSha256: snapshot.selectedSourceTreeSha256,
      readOnly: true,
      externalProcessExecuted: false,
      networkUsed: false,
    });
    const completedAt = now().toISOString();
    const requestedByRole = new Map(
      input.request.requestedArtifacts.map((entry) => [entry.role, entry]),
    );
    const sourceDependencyHashes = [
      ...new Set([
        input.request.sourcePacket.artifactSha256,
        specification.sha256,
      ]),
    ].sort();
    const buildDependencies = [
      ...new Set([
        input.request.sourcePacket.artifactSha256,
        specification.sha256,
        formalSource.sha256,
        implementationSource.sha256,
      ]),
    ].sort();
    const generatedArtifacts: CasimirArtifactGenerationReceiptV1["artifacts"] =
      [
        {
          ...requestedByRole.get("build_manifest")!,
          logicalPath: `casimir/lanyon/${input.caseId}/build-manifest.json`,
          artifactSha256: buildManifestSha256,
          sizeBytes: Buffer.byteLength(buildManifestJson),
          derivedFromSha256s: buildDependencies,
        },
        {
          ...requestedByRole.get("formal_source")!,
          logicalPath: formalSource.logicalPath,
          artifactSha256: formalSource.sha256,
          sizeBytes: formalSource.sizeBytes,
          derivedFromSha256s: sourceDependencyHashes,
        },
        {
          ...requestedByRole.get("implementation_source")!,
          logicalPath: implementationSource.logicalPath,
          artifactSha256: implementationSource.sha256,
          sizeBytes: implementationSource.sizeBytes,
          derivedFromSha256s: sourceDependencyHashes,
        },
        {
          ...requestedByRole.get("numerical_case")!,
          logicalPath: specification.logicalPath,
          artifactSha256: specification.sha256,
          sizeBytes: specification.sizeBytes,
          derivedFromSha256s: sourceDependencyHashes,
        },
      ].sort((left, right) =>
        left.artifactId.localeCompare(right.artifactId, "en"),
      );
    const receipt = await buildCasimirArtifactGenerationReceiptV1({
      generatedAt: completedAt,
      receiptId: `lanyon:${input.request.requestId}:${input.caseId}`,
      request: {
        schemaVersion: input.request.schemaVersion,
        requestId: input.request.requestId,
        artifactSha256: input.request.artifactSha256,
        casimirSpec: {
          semanticSha256: input.request.casimirSpec.semanticSha256,
          artifactSha256: input.request.casimirSpec.artifactSha256,
        },
        claimId: input.request.claim.claimId,
        propositionSha256: input.request.claim.propositionSha256,
        masterProblem: {
          planId: input.request.masterProblem.planId,
          artifactSha256: input.request.masterProblem.artifactSha256,
        },
        derivationProgram: {
          programId: input.request.derivationProgram.programId,
          artifactSha256: input.request.derivationProgram.artifactSha256,
        },
      },
      producer: {
        producerId: CASIMIR_LANYON_PRODUCER_ID,
        adapterId: CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
        adapterRevisionSha256: policy.artifactSha256,
        upstreamRepository: {
          uri: policy.repository.uri,
          commitSha: policy.repository.commitSha,
          sourceTreeSha256: snapshot.selectedSourceTreeSha256,
        },
      },
      run: {
        status: "succeeded",
        startedAt,
        completedAt,
        transcriptSha256: sha256(transcript),
        environmentSha256: sha256(
          canonicalJson({
            ...environmentIdentity(),
            policySha256: policy.artifactSha256,
          }),
        ),
      },
      artifacts: generatedArtifacts,
      blockers: [],
    });
    const receiptIssues = [
      ...(await validateCasimirArtifactGenerationReceiptIntegrityV1(receipt)),
      ...validateCasimirArtifactGenerationReceiptAgainstRequestV1(
        receipt,
        input.request,
      ),
    ];
    if (receiptIssues.length > 0) {
      return blocked(
        input.caseId,
        policy,
        receiptIssues.map((issue) => `receipt:${issue}`),
      );
    }
    return {
      schema: CASIMIR_LANYON_ADAPTER_ADMISSION_SCHEMA,
      ok: true,
      status: "admitted",
      caseId: input.caseId,
      policy: {
        schemaVersion: policy.schemaVersion,
        policyId: policy.policyId,
        artifactSha256: policy.artifactSha256,
      },
      issues: [],
      receipt,
      artifactBindings: {
        specificationPath: specification.absolutePath,
        formalSourcePath: formalSource.absolutePath,
        implementationSourcePath: implementationSource.absolutePath,
        buildManifest: {
          mediaType: "application/json",
          logicalPath: `casimir/lanyon/${input.caseId}/build-manifest.json`,
          artifactSha256: buildManifestSha256,
          sizeBytes: Buffer.byteLength(buildManifestJson),
          canonicalJson: buildManifestJson,
        },
      },
      authority: authority(true),
    };
  };
  return { admit };
}

const defaultAdapter = createCasimirLanyonAdvectionDiffusionAdapter();

export const admitCasimirLanyonAdvectionDiffusionSnapshotV1 =
  defaultAdapter.admit;
