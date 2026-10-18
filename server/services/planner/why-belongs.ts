import type { KnowledgeProjectExport } from "@shared/knowledge";
import type { TMemorySearchHit } from "@shared/essence-persona";
import type { WhyBelongs, WhyBelongsItem, RationaleTag, SpanRef } from "@shared/rationale";
import { defaultWhyBelongsSummary } from "@shared/rationale";
import { DEFAULT_SUMMARY_FOCUS, pickReadableText, type ExecutionResult, type ExecutorStep } from "./chat-b";

type BuildWhyBelongsArgs = {
  goal: string;
  traceId: string;
  summary?: string;
  executorSteps: ExecutorStep[];
  results: ExecutionResult[];
  knowledgeContext?: KnowledgeProjectExport[];
};

const TAG_ORDER: RationaleTag[] = ["evidence", "assumption", "inference", "speculation"];

export function buildWhyBelongs(args: BuildWhyBelongsArgs): WhyBelongs {
  const stepLookup = new Map(args.executorSteps.map((step) => [step.id, step]));
  const items: WhyBelongsItem[] = [];

  const push = (entry: WhyBelongsItem) => {
    if (items.length >= 32) {
      return;
    }
    items.push(entry);
  };

  const traceId =
    typeof args.traceId === "string" && args.traceId.length > 0 ? args.traceId : undefined;
  const messageSpan =
    traceId
      ? ({ kind: "dom", target: `[data-trace-id="${escapeAttr(traceId)}"] [data-message-content]` } satisfies SpanRef)
      : undefined;

  for (const project of args.knowledgeContext ?? []) {
    const excerpt = project.summary || project.files[0]?.preview;
    push({
      tag: "evidence",
      message: `Attached project "${project.project.name}" provided ${project.files.length} artifact(s) for grounding.`,
      source: {
        kind: "doc",
        ref: project.project.id,
        excerpt: excerpt ? truncate(excerpt, 200) : undefined,
      },
      spans: project.project?.id
        ? [
            {
              kind: "dom",
              target: `[data-knowledge-project="${escapeAttr(project.project.id)}"]`,
            },
          ]
        : undefined,
      confidence: 0.8,
    });
  }

  let defaultSummaryFocusUsed = false;

  for (const result of args.results) {
    const planStep = result.id ? stepLookup.get(result.id) : undefined;
    const stepId = typeof result.id === "string" && result.id.length > 0 ? result.id : undefined;
    const stepSpan =
      stepId
        ? ({ kind: "dom", target: `[data-trace-step="${escapeAttr(stepId)}"]` } satisfies SpanRef)
        : undefined;

    if (result.ok === false) {
      const fallbackFailure = pickReadableText((result as ExecutionResult).output) ?? "step failed";
      const failureText =
        typeof (result as ExecutionResult & { error?: string }).error === "string"
          ? (result as ExecutionResult & { error?: string }).error
          : fallbackFailure;
      push({
        tag: "speculation",
        message: `Step ${describeStep(planStep, result)} failed: ${truncate(failureText ?? "step failed", 160)}`,
        spans: buildSpans(stepSpan),
        confidence: 0.2,
      });
      continue;
    }

    if (planStep?.kind === "memory.search") {
      const hits = Array.isArray(result.output) ? (result.output as TMemorySearchHit[]) : [];
      if (hits.length === 0) {
        push({
          tag: "speculation",
          message: `Search "${planStep.query}" returned no stored evidence.`,
          spans: buildSpans(stepSpan),
          confidence: 0.35,
        });
        continue;
      }
      hits.slice(0, 3).forEach((hit, index) => {
        push({
          tag: "evidence",
          message: `Hit ${index + 1}: ${hit.kind} ${hit.id} matched "${planStep.query}".`,
          source: { kind: "doc", ref: hit.id, excerpt: truncate(hit.snippet, 200) },
          spans: buildSpans(stepSpan),
          confidence: clampConfidence(normalizeScore(hit.score), 0.85),
        });
      });
      continue;
    }

    if (planStep?.kind === "summary.compose") {
      const excerpt = pickReadableText(result.output);
      push({
        tag: "inference",
        message: summarizeCitations(`Condensed ${planStep.focus}`, result.citations),
        source: excerpt ? { kind: "calc", ref: result.id, excerpt: truncate(excerpt, 200) } : undefined,
        spans: buildSpans(stepSpan, messageSpan),
        confidence: 0.7,
      });
      if (planStep.focus === DEFAULT_SUMMARY_FOCUS) {
        defaultSummaryFocusUsed = true;
      }
      continue;
    }

    if (planStep?.kind === "tool.call") {
      const excerpt = pickReadableText(result.output);
      push({
        tag: "inference",
        message: summarizeCitations(`Tool ${planStep.tool} combined grounded context`, result.citations),
        source: excerpt ? { kind: "calc", ref: planStep.tool, excerpt: truncate(excerpt, 200) } : undefined,
        spans: buildSpans(stepSpan, messageSpan),
        confidence: 0.75,
      });
      continue;
    }

    if (planStep?.kind === "specialist.run") {
      const excerpt = pickReadableText(result.output);
      const solverMsg = planStep.verifier
        ? `Specialist ${planStep.solver} with verifier ${planStep.verifier}`
        : `Specialist ${planStep.solver}`;
      push({
        tag: "inference",
        message: summarizeCitations(`${solverMsg} solved the math`, result.citations),
        source: excerpt ? { kind: "calc", ref: planStep.solver, excerpt: truncate(excerpt, 200) } : undefined,
        spans: buildSpans(stepSpan, messageSpan),
        confidence: 0.78,
      });
      continue;
    }

    if (planStep?.kind === "specialist.verify") {
      const excerpt = pickReadableText(result.output);
      push({
        tag: "evidence",
        message: summarizeCitations(`Verifier ${planStep.verifier} checked the solver output`, result.citations),
        source: excerpt ? { kind: "calc", ref: planStep.verifier, excerpt: truncate(excerpt, 200) } : undefined,
        spans: buildSpans(stepSpan, messageSpan),
        confidence: 0.82,
      });
      continue;
    }

    const excerpt = pickReadableText(result.output);
    push({
      tag: "inference",
      message: summarizeCitations(`Step ${describeStep(planStep, result)} completed`, result.citations),
      source: excerpt ? { kind: "calc", ref: result.id ?? "step", excerpt: truncate(excerpt, 200) } : undefined,
      spans: buildSpans(stepSpan, messageSpan),
      confidence: 0.6,
    });
  }

  if (defaultSummaryFocusUsed) {
    push({
      tag: "assumption",
      message: `Used default planner summary focus "${DEFAULT_SUMMARY_FOCUS}" because no override was supplied.`,
      source: { kind: "doc", ref: "config:planner.summary_focus", excerpt: DEFAULT_SUMMARY_FOCUS },
      confidence: 0.55,
    });
  }

  if (!items.some((item) => item.tag === "evidence")) {
    push({
      tag: "speculation",
      message: "No explicit evidence items were attached; treat this answer as speculative.",
      confidence: 0.3,
    });
  }

  const summary = items.reduce(
    (acc, item) => {
      if (item.tag === "assumption") acc.assumptions += 1;
      else if (item.tag === "inference") acc.inferences += 1;
      else if (item.tag === "speculation") acc.speculation += 1;
      else acc.evidence += 1;
      return acc;
    },
    { ...defaultWhyBelongsSummary },
  );

  const okCount = args.results.filter((step) => step.ok).length;
  const totalCount = args.results.length;
  const fallbackSummary =
    totalCount > 0
      ? `the planner executed ${okCount}/${totalCount} grounded step(s) for goal "${args.goal}"`
      : `the planner prepared an answer for "${args.goal}"`;
  const sanitizedSummary = (args.summary ?? fallbackSummary).replace(/\s+/g, " ").trim();
  const claim = `This answer belongs because ${truncate(sanitizedSummary, 220)}`;

  const orderedItems = [...items].sort((a, b) => TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag));

  return {
    claim,
    items: orderedItems,
    summary,
  };
}

function summarizeCitations(prefix: string, citations: string[]): string {
  if (!citations || citations.length === 0) {
    return `${prefix} using planner context.`;
  }
  const formatted = citations.slice(0, 6).map((cite) => `#${cite}`);
  const suffix = citations.length > formatted.length ? ` +${citations.length - formatted.length} more` : "";
  return `${prefix} from ${formatted.join(", ")}${suffix}.`;
}

function buildSpans(...spans: Array<SpanRef | undefined>): SpanRef[] | undefined {
  const filtered = spans.filter((span): span is SpanRef => Boolean(span));
  return filtered.length > 0 ? filtered : undefined;
}

function clampConfidence(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
}

function normalizeScore(score: number | undefined): number | undefined {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return undefined;
  }
  if (score > 1) {
    return Math.min(1, score / 100);
  }
  if (score < 0) {
    return 0;
  }
  return score;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 1))}\u2026`;
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]").replace(/\[/g, "\\[");
}

function describeStep(step: ExecutorStep | undefined, result: ExecutionResult): string {
  if (!step) {
    return result.kind ?? "step";
  }
  switch (step.kind) {
    case "memory.search":
      return `search:${step.query}`;
    case "summary.compose":
      return `summary:${step.source}`;
    case "tool.call":
      return `tool:${step.tool}`;
    case "specialist.run":
      return `specialist:${step.solver}`;
    case "specialist.verify":
      return `verify:${step.verifier}`;
    default:
      return result.kind ?? "step";
  }
}
