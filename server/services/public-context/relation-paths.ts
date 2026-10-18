import { buildNhm2TheoryBadgeGraphV1 } from "@shared/theory/nhm2-theory-badges";
import type { TheoryBadgeEdgeV1 } from "@shared/contracts/theory-badge-graph.v1";
import type { PublicBadge } from "./catalog";
import { publicBadgePath } from "./catalog";
import { resolveCasimirPublicBaseUrl } from "../public-base-url";
import { currentPublicQuestion, publicContextTerms, scopedTheoryProjectFits } from "./principle-hypotheses";

export type PublicRelationPathLead = {
  status: "unverified_graph_lead";
  from_id: string;
  to_id: string;
  steps: Array<{
    from_id: string;
    to_id: string;
    relation: string;
    label: string;
    claim_boundary: string;
  }>;
  intermediate_badges: Array<{
    id: string;
    title: string;
    concept: string;
    url: string;
    catalog_source_pointers: string[];
  }>;
};

export type PublicConvergentRelationLead = {
  status: "unverified_graph_lead";
  target_badge: {
    id: string;
    title: string;
    concept: string;
    url: string;
    catalog_source_pointers: string[];
    claim_boundaries: string[];
  };
  incoming_steps: Array<{
    from_id: string;
    relation: string;
    label: string;
    claim_boundary: string;
  }>;
};

const allowedRelations = new Set(["requires", "bounds", "blocks", "documents"]);
const family = (id: string): string => id.split(".")[0] ?? "";
const unsafePublicText = /(?:[A-Z]:[\\/]|file:\/\/|localhost|127\.0\.0\.1|\bBearer\s+\S+|api[_-]?key\s*[:=]|access[_-]?token\s*[:=])/i;
let publicEdges: TheoryBadgeEdgeV1[] | undefined;
const edges = (): TheoryBadgeEdgeV1[] => publicEdges ??= buildNhm2TheoryBadgeGraphV1().edges
  .filter((edge) => allowedRelations.has(edge.relation) &&
    !unsafePublicText.test(edge.label) && !unsafePublicText.test(edge.claimBoundaryNote));

// Two independently located public cards may converge on an omitted check.
// This only offers the target as a source-inspection lead. A graph edge and a
// catalog pointer cannot establish that its claim applies to the question.
export function findPublicConvergentRelationLeads(
  selectedIds: readonly string[], badges: readonly PublicBadge[], maxLeads = 2,
): PublicConvergentRelationLead[] {
  if (selectedIds.length < 2 || maxLeads < 1) return [];
  const selected = new Set(selectedIds);
  const allowed = new Map(badges.map((badge) => [badge.id, badge]));
  const incoming = new Map<string, TheoryBadgeEdgeV1[]>();
  for (const edge of edges()) {
    if (!selected.has(edge.from) || selected.has(edge.to) ||
      !allowed.has(edge.from) || !allowed.has(edge.to) ||
      family(edge.from) !== family(edge.to)) continue;
    const target = allowed.get(edge.to) as PublicBadge;
    if (!target.source_refs.some((ref) => /^https:\/\//.test(ref))) continue;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }
  return [...incoming].flatMap(([id, steps]) => {
    const distinct = [...new Map(steps.map((edge) => [edge.from, edge])).values()]
      .sort((a, b) => a.from.localeCompare(b.from));
    if (distinct.length < 2) return [];
    const target = allowed.get(id) as PublicBadge;
    return [{
      status: "unverified_graph_lead" as const,
      target_badge: {
        id, title: target.title, concept: target.summary,
        url: `${resolveCasimirPublicBaseUrl()}${publicBadgePath("theory", id)}`,
        catalog_source_pointers: target.source_refs.filter((ref) => /^https:\/\//.test(ref)).slice(0, 2),
        claim_boundaries: target.claim_boundaries.slice(0, 2),
      },
      incoming_steps: distinct.slice(0, 3).map((edge) => ({
        from_id: edge.from, relation: edge.relation,
        label: edge.label, claim_boundary: edge.claimBoundaryNote,
      })),
    }];
  }).sort((a, b) => b.incoming_steps.length - a.incoming_steps.length ||
    a.target_badge.id.localeCompare(b.target_badge.id)).slice(0, maxLeads);
}

// A single high-specificity public-text anchor may have a weaker neighbor
// whose relevance becomes legible through an explicit graph relation. This
// returns only tentative search leads and is enabled solely for the local
// relation trial. It does not make a no-match into evidence.
export function findPublicGraphAnchoredCandidates(
  activeQuestion: string, badges: readonly PublicBadge[],
): string[] {
  const request = currentPublicQuestion(activeQuestion);
  const query = publicContextTerms(request);
  if (query.size < 2) return [];
  const indexed = badges.map((badge) => ({ badge,
    terms: publicContextTerms(`${badge.title} ${badge.summary}`) }));
  const frequency = new Map<string, number>();
  for (const item of indexed) for (const word of item.terms)
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const score = new Map<string, { value: number; shared: number }>();
  for (const { badge, terms } of indexed) {
    if (!badge.source_refs.some((ref) => /^https:\/\//.test(ref)) ||
      !scopedTheoryProjectFits(badge.id, request)) continue;
    const shared = [...query].filter((word) => terms.has(word));
    score.set(badge.id, { shared: shared.length, value: shared.reduce((total, word) =>
      total + Math.log((badges.length + 1) / ((frequency.get(word) ?? 0) + 1)), 0) });
  }
  const anchors = [...score].filter(([, result]) => result.shared >= 2 && result.value >= 10)
    .sort((a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0]));
  if (!anchors.length || anchors[1] && anchors[0][1].value - anchors[1][1].value < 2) return [];
  const start = anchors[0][0];
  const adjacent = edges().filter((edge) => edge.from === start && family(edge.to) === family(start));
  const routes: Array<{ ids: string[]; value: number }> = [];
  for (const first of adjacent) {
    const secondScore = score.get(first.to);
    if (!secondScore || secondScore.shared < 1 || secondScore.value < 4) continue;
    routes.push({ ids: [start, first.to], value: secondScore.value });
    for (const second of edges()) {
      if (second.from !== first.to || second.to === start || family(second.to) !== family(start)) continue;
      const thirdScore = score.get(second.to);
      if (!thirdScore || thirdScore.shared < 1 || thirdScore.value < 4) continue;
      routes.push({ ids: [start, first.to, second.to], value: secondScore.value + thirdScore.value });
    }
  }
  routes.sort((a, b) => b.value - a.value || b.ids.length - a.ids.length ||
    a.ids.join("/").localeCompare(b.ids.join("/")));
  return routes[0]?.ids ?? [];
}

// A relation is considered only if it connects two badges the reflection
// already retrieved. One intervening public badge may make the graph's
// procedural path legible, but this is a search lead, never claim evidence.
export function findPublicRelationPathLeads(
  selectedIds: readonly string[], badges: readonly PublicBadge[], maxPaths = 2,
): PublicRelationPathLead[] {
  if (selectedIds.length < 2 || maxPaths < 1) return [];
  const selected = new Set(selectedIds);
  const allowed = new Map(badges.map((badge) => [badge.id, badge]));
  // Cross-family edges often describe a research adjacency rather than a
  // question's governing mechanism. Keep this first public trial inside one
  // named family so an atomic spectroscopy lead cannot bridge into a molecular
  // question merely because a host offered a broad spectral hypothesis.
  const available = edges().filter((edge) => allowed.has(edge.from) && allowed.has(edge.to) &&
    family(edge.from) === family(edge.to));
  const outgoing = new Map<string, TheoryBadgeEdgeV1[]>();
  for (const edge of available) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const paths: TheoryBadgeEdgeV1[][] = [];
  for (const start of selected) {
    for (const first of outgoing.get(start) ?? []) {
      if (selected.has(first.to)) paths.push([first]);
      if (!selected.has(first.to)) {
        for (const second of outgoing.get(first.to) ?? []) {
          if (second.to !== start && selected.has(second.to)) paths.push([first, second]);
        }
      }
    }
  }
  paths.sort((a, b) => a.length - b.length ||
    `${a[0].from}/${a.at(-1)?.to}/${a.map((step) => step.id).join("/")}`.localeCompare(
      `${b[0].from}/${b.at(-1)?.to}/${b.map((step) => step.id).join("/")}`));
  const seen = new Set<string>();
  return paths.flatMap((path) => {
    const fromId = path[0].from;
    const toId = path.at(-1)?.to as string;
    const pair = `${fromId}/${toId}`;
    if (seen.has(pair)) return [];
    seen.add(pair);
    const middle = path.length === 2 ? allowed.get(path[0].to) : undefined;
    return [{
      status: "unverified_graph_lead" as const,
      from_id: fromId,
      to_id: toId,
      steps: path.map((edge) => ({ from_id: edge.from, to_id: edge.to,
        relation: edge.relation, label: edge.label, claim_boundary: edge.claimBoundaryNote })),
      intermediate_badges: middle ? [{
        id: middle.id, title: middle.title, concept: middle.summary,
        url: `${resolveCasimirPublicBaseUrl()}${publicBadgePath("theory", middle.id)}`,
        catalog_source_pointers: middle.source_refs.filter((ref) => /^https:\/\//.test(ref)).slice(0, 2),
      }] : [],
    }];
  }).slice(0, maxPaths);
}
