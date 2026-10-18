import {
  buildTheoryCompoundRunV1,
  type TheoryCompoundRunRowStatus,
  type TheoryCompoundRunRowV1,
  type TheoryCompoundRunSourceKind,
  type TheoryCompoundRunV1,
} from "../../../shared/contracts/theory-compound-run.v1";
import type { TheoryBadgeGraphV1, TheoryBadgeV1 } from "../../../shared/contracts/theory-badge-graph.v1";
import type { TheoryRuntimeMathTraceV1 } from "../../../shared/contracts/theory-runtime-math-trace.v1";
import type { TheoryRuntimeGateStatus, TheoryRuntimeReceiptV1 } from "../../../shared/contracts/theory-runtime-receipt.v1";
import { buildTheoryCompoundRun } from "../../../shared/theory/theory-compound-run-builder";
import { casimirRuntimeAdapter } from "./runtime-adapters/casimir-runtime-adapter";
import { grNhm2RuntimeAdapter } from "./runtime-adapters/gr-nhm2-runtime-adapter";
import { qeiStressEnergyAdapter } from "./runtime-adapters/qei-stress-energy-adapter";
import { solarRuntimeAdapter } from "./runtime-adapters/solar-runtime-adapter";
import { starSimRuntimeAdapter } from "./runtime-adapters/starsim-runtime-adapter";
import { tokamakRuntimeAdapter } from "./runtime-adapters/tokamak-runtime-adapter";
import type { TheoryRuntimeAdapter, TheoryRuntimeAdapterInput } from "./runtime-adapters/theory-runtime-adapter-types";

type BuildTheoryCompoundRunMode = "selected_badges" | "dependency_path" | "locator_matches";

export type BuildArtifactBackedCompoundTheoryRunArgs = {
  graph: TheoryBadgeGraphV1;
  badgeIds: string[];
  mode?: BuildTheoryCompoundRunMode;
  source?: TheoryCompoundRunSourceKind;
  includeScalar?: boolean;
  includeRuntime?: boolean;
  includeEvidence?: boolean;
  includeBoundaries?: boolean;
  runQuick?: boolean;
  projectRoot?: string;
  generatedAt?: string;
};

export const THEORY_READ_ONLY_RUNTIME_ADAPTERS: TheoryRuntimeAdapter[] = [
  grNhm2RuntimeAdapter,
  qeiStressEnergyAdapter,
  casimirRuntimeAdapter,
  solarRuntimeAdapter,
  starSimRuntimeAdapter,
  tokamakRuntimeAdapter,
];

const STATIC_REFERENCE_WARNING = "Static reference trace only; no backend runtime executed.";
const ARTIFACT_BACKED_WARNING = "Artifact-backed runtime context; no backend runtime executed during this load.";
const RUNTIME_EXECUTED_WARNING = "Runtime executed through an explicit quick-runtime adapter.";
const MISSING_EVIDENCE_WARNING = "Blocked by missing evidence.";
const NON_BLOCKING_GATE_STATUSES = new Set<TheoryRuntimeGateStatus>(["pass", "not_applicable"]);

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function rowSupportsRuntime(row: TheoryCompoundRunRowV1): boolean {
  return (
    row.kind === "tensor" ||
    row.kind === "runtime" ||
    row.kind === "reference" ||
    row.kind === "gate" ||
    row.kind === "evidence" ||
    row.kind === "boundary"
  );
}

function hasBlockingGate(receipt: TheoryRuntimeReceiptV1): boolean {
  return Object.entries(receipt.outputs.gates).some(([key, status]) => {
    if (/claim[_-]?boundary/i.test(key)) return false;
    return !NON_BLOCKING_GATE_STATUSES.has(status);
  });
}

function statusFromReceipt(receipt: TheoryRuntimeReceiptV1): TheoryCompoundRunRowStatus {
  if (receipt.status === "failed" || receipt.status === "timeout") return "failed";
  if (receipt.status === "completed" && !hasBlockingGate(receipt)) return "computed";
  return "blocked";
}

function hasArtifactsOrFailedClosedReceipt(receipt: TheoryRuntimeReceiptV1): boolean {
  return receipt.status !== "not_run" || receipt.outputs.artifacts.length > 0;
}

function addTraceBacking(args: {
  trace: TheoryRuntimeMathTraceV1;
  receipt: TheoryRuntimeReceiptV1;
  computedBy: "artifact_reader" | "runtime_executed";
}): TheoryRuntimeMathTraceV1 {
  const artifactRef = args.receipt.outputs.artifacts[0] ?? null;
  const warning = args.computedBy === "runtime_executed" ? RUNTIME_EXECUTED_WARNING : ARTIFACT_BACKED_WARNING;
  return {
    ...args.trace,
    steps: args.trace.steps.map((step) => ({
      ...step,
      computedBy: args.computedBy,
      artifactRef: step.artifactRef ?? artifactRef,
      warnings: unique([...step.warnings.filter((entry) => entry !== STATIC_REFERENCE_WARNING), warning]),
    })),
  };
}

function runtimeInput(args: {
  adapter: TheoryRuntimeAdapter;
  graph: TheoryBadgeGraphV1;
  row: TheoryCompoundRunRowV1;
  projectRoot?: string;
  generatedAt?: string;
}): TheoryRuntimeAdapterInput {
  return {
    runtimeId: args.adapter.runtimeId,
    family: args.adapter.family,
    laneId: args.adapter.laneId,
    badgeIds: [args.row.badgeId],
    graphId: args.graph.graphId,
    projectRoot: args.projectRoot,
    generatedAt: args.generatedAt,
  };
}

function adaptersForBadge(badgeId: string): TheoryRuntimeAdapter[] {
  return THEORY_READ_ONLY_RUNTIME_ADAPTERS.filter((adapter) =>
    adapter.canHandle({
      badgeIds: [badgeId],
    }),
  );
}

function fallbackTraceForAdapter(args: {
  row: TheoryCompoundRunRowV1;
  adapter: TheoryRuntimeAdapter;
  graph: TheoryBadgeGraphV1;
  projectRoot?: string;
  generatedAt?: string;
}): TheoryRuntimeMathTraceV1 | null {
  return args.adapter.buildReferenceTrace?.(
    runtimeInput({
      adapter: args.adapter,
      graph: args.graph,
      row: args.row,
      projectRoot: args.projectRoot,
      generatedAt: args.generatedAt,
    }),
  ) ?? null;
}

async function receiptForAdapter(args: {
  row: TheoryCompoundRunRowV1;
  adapter: TheoryRuntimeAdapter;
  graph: TheoryBadgeGraphV1;
  projectRoot?: string;
  generatedAt?: string;
  runQuick?: boolean;
}): Promise<{ receipt: TheoryRuntimeReceiptV1; computedBy: "artifact_reader" | "runtime_executed" } | null> {
  const input = runtimeInput({
    adapter: args.adapter,
    graph: args.graph,
    row: args.row,
    projectRoot: args.projectRoot,
    generatedAt: args.generatedAt,
  });
  if (args.runQuick && args.adapter.capabilities.includes("quick_runtime") && args.adapter.runQuick) {
    const receipt = await args.adapter.runQuick(input);
    return { receipt, computedBy: "runtime_executed" };
  }
  if (args.adapter.capabilities.includes("artifact_reader") && args.adapter.readArtifacts) {
    const receipt = await args.adapter.readArtifacts(input);
    if (hasArtifactsOrFailedClosedReceipt(receipt)) return { receipt, computedBy: "artifact_reader" };
  }
  return null;
}

function shouldEnrichBadge(badge: TheoryBadgeV1 | undefined): boolean {
  return Boolean(badge && badge.calculatorPayloads.length === 0);
}

function rebuild(run: TheoryCompoundRunV1, rows: TheoryCompoundRunRowV1[]): TheoryCompoundRunV1 {
  return buildTheoryCompoundRunV1({
    generatedAt: run.generatedAt,
    runId: run.runId,
    graphId: run.graphId,
    targetBadgeIds: run.targetBadgeIds,
    source: run.source,
    rows,
  });
}

export async function buildArtifactBackedCompoundTheoryRun(
  args: BuildArtifactBackedCompoundTheoryRunArgs,
): Promise<TheoryCompoundRunV1> {
  const baseRun = buildTheoryCompoundRun({
    graph: args.graph,
    badgeIds: args.badgeIds,
    mode: args.mode,
    source: args.source,
    includeScalar: args.includeScalar,
    includeRuntime: args.includeRuntime,
    includeEvidence: args.includeEvidence,
    includeBoundaries: args.includeBoundaries,
    generatedAt: args.generatedAt,
  });
  const badgesById = new Map(args.graph.badges.map((badge) => [badge.id, badge]));
  const rows: TheoryCompoundRunRowV1[] = [];

  for (const row of baseRun.rows) {
    const badge = badgesById.get(row.badgeId);
    if (!shouldEnrichBadge(badge) || !rowSupportsRuntime(row)) {
      rows.push(row);
      continue;
    }

    const adapters = adaptersForBadge(row.badgeId);
    const adapter = adapters[0];
    if (!adapter) {
      rows.push(row);
      continue;
    }

    const receiptResult = await receiptForAdapter({
      row,
      adapter,
      graph: args.graph,
      projectRoot: args.projectRoot,
      generatedAt: args.generatedAt,
      runQuick: args.runQuick,
    });
    if (receiptResult) {
      const fallbackTrace = row.runtimeMathTraceV1 ??
        fallbackTraceForAdapter({
          row,
          adapter,
          graph: args.graph,
          projectRoot: args.projectRoot,
          generatedAt: args.generatedAt,
        });
      rows.push({
        ...row,
        status: statusFromReceipt(receiptResult.receipt),
        runtimeReceiptV1: receiptResult.receipt,
        runtimeMathTraceV1: fallbackTrace
          ? addTraceBacking({
              trace: fallbackTrace,
              receipt: receiptResult.receipt,
              computedBy: receiptResult.computedBy,
            })
          : row.runtimeMathTraceV1,
        warnings: unique([
          ...row.warnings.filter((entry) => entry !== STATIC_REFERENCE_WARNING),
          ...receiptResult.receipt.outputs.warnings,
          receiptResult.receipt.outputs.missingSignals.length > 0 ? MISSING_EVIDENCE_WARNING : "",
        ]),
      });
      continue;
    }

    const fallbackTrace = row.runtimeMathTraceV1 ??
      fallbackTraceForAdapter({
        row,
        adapter,
        graph: args.graph,
        projectRoot: args.projectRoot,
        generatedAt: args.generatedAt,
      });
    rows.push({
      ...row,
      runtimeMathTraceV1: fallbackTrace,
      status: fallbackTrace ? "computed" : row.status,
      warnings: unique([...row.warnings, fallbackTrace ? STATIC_REFERENCE_WARNING : ""]),
    });
  }

  return rebuild(baseRun, rows);
}
