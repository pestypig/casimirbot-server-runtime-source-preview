import type { PublicBadge } from "./catalog";

// This is a bounded catalog locator, not a claim classifier. The host may
// propose a principle that the user did not name; the active question must
// still overlap the located public badge before it can be returned.
const STOP = new Set([
  "about", "after", "again", "against", "before", "between", "could", "does", "from",
  "have", "into", "more", "only", "other", "same", "should", "that", "their", "there",
  "these", "this", "those", "what", "when", "where", "which", "while", "with", "would",
  "badge", "boundary", "context", "diagnostic", "evidence", "graph", "hypothesis",
  "principle", "reflection", "theory", "moral", "public", "model", "question", "result",
  "make", "made", "page", "quote", "quotes", "quoted", "show", "shows", "says",
  "claim", "claims", "effect", "effects", "infer", "inference", "inferences",
  "measure", "measured", "measurement", "measurements", "alternative", "alternatives",
  "versus",
]);
const stem = (word: string): string => {
  if (word === "axes") return "axis";
  const root = word.length > 6
    ? word.replace(/(?:ations|ation|ities|ivity|ingly|ments|ment|ness|ing|ions|ion|ies|ed|es|s)$/, "")
    : word.length > 4 ? word.replace(/(?:es|s)$/, "") : word;
  return root.length > 5 ? root.replace(/e$/, "") : root;
};
const terms = (text: string): Set<string> => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  .filter((word) => !STOP.has(word)).map(stem)
  .filter((word) => word.length >= 4 && !STOP.has(word)));
export const publicContextTerms = terms;
export type PublicPrincipleBridge = { principle: string; question_excerpt: string };
const EXPLORATORY_STOP = new Set(["comparison", "condit", "first", "physic"]);
const exploratoryTerms = (text: string): Set<string> =>
  new Set([...terms(text)].filter((word) => !EXPLORATORY_STOP.has(word)));
const overlap = (left: Set<string>, right: Set<string>): number =>
  [...left].filter((word) => right.has(word)).length;
const identity = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const currentPublicQuestion = (activeQuestion: string): string =>
  /\b(?:my|our|the)\s+(?:actual|real|current)\s+question\s+is\b[:\s]*(.*)/i.exec(activeQuestion)?.[1] || activeQuestion;
export const scopedTheoryProjectFits = (id: string, activeQuestion: string): boolean => {
  if (id.startsWith("solar.")) return /\b(?:solar|sun|sunspot|heliophysic(?:s|al)?)\b/i.test(activeQuestion);
  const scope = /^(?:study\.([^.]+)|lab\.([^.]+)|nhm2)\./.exec(id);
  if (!scope) return true;
  const projectName = scope[1] ?? scope[2] ?? "nhm2";
  return identity(activeQuestion).includes(identity(projectName));
};

// A natural question can contain enough public, distinctive terms to surface
// a nearby concept without asking the host to name that concept first. This
// is deliberately an exploratory locator: two source-linked badges in the
// same graph family must independently clear the bar, and close family ties
// abstain. No private graph metadata or inferred factual claim is used.
export function findPublicQuestionOnlyCandidates(
  badges: readonly PublicBadge[], activeQuestion: string,
): string[] {
  // When the user explicitly redirects from earlier context, the locator
  // grounds only the stated active request, not the old topic's vocabulary.
  const request = currentPublicQuestion(activeQuestion);
  const query = terms(request);
  if (query.size < 2) return [];
  const indexed = badges.map((badge) => ({ badge, visible: terms(`${badge.title} ${badge.summary}`) }));
  const frequency = new Map<string, number>();
  for (const { visible } of indexed) {
    for (const word of visible) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  const families = new Map<string, Array<{ id: string; score: number }>>();
  for (const { badge, visible } of indexed) {
    if (!badge.source_refs.some((ref) => /^https:\/\//.test(ref)) ||
      !scopedTheoryProjectFits(badge.id, request)) continue;
    const shared = [...query].filter((word) => visible.has(word));
    if (shared.length < 2) continue;
    const score = shared.reduce((total, word) =>
      total + Math.log((badges.length + 1) / ((frequency.get(word) ?? 0) + 1)), 0);
    if (score < 10) continue;
    const family = badge.id.split(".").slice(0, 2).join(".");
    if (!family.includes(".")) continue;
    const candidates = families.get(family) ?? [];
    candidates.push({ id: badge.id, score });
    families.set(family, candidates);
  }
  const ranked = [...families].flatMap(([family, candidates]) => {
    candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return candidates.length >= 2 ? [{ family, candidates,
      score: candidates[0].score + candidates[1].score }] : [];
  }).sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
  if (!ranked.length || ranked[1] && ranked[0].score - ranked[1].score < 2) return [];
  return ranked[0].candidates.slice(0, 3).map(({ id }) => id);
}

// A proposal matching only the first half of a relational title must not
// locate the badge's different target ("access to counsel" from "access",
// or "care before judgment" from "care"). This applies to all catalog
// entries with the same title shape, rather than named badge exceptions.
const relationalTitleTargetFits = (title: string, activeQuestion: string, hint: Set<string>): boolean => {
  const target = /\b(?:to|before|without)\s+([a-z][a-z-]*)\b/i.exec(title.replace(/-/g, " "))?.[1];
  if (!target) return true;
  const targetTerms = terms(target);
  if (!targetTerms.size) return true;
  const grounded = new Set([...terms(activeQuestion), ...hint]);
  return [...targetTerms].some((word) => grounded.has(word));
};

// A slash title explicitly relates multiple concepts. A single shared word
// such as "body" cannot locate "Drive / Body Curvature Ratio" for an unrelated
// two-body collision. Apply this stricter screen only to weak quote bridges.
const slashTitleSidesFit = (title: string, activeQuestion: string, hint: Set<string>): boolean => {
  if (!title.includes("/")) return true;
  const grounded = new Set([...terms(activeQuestion), ...hint]);
  return title.split("/").map(terms)
    .filter((side) => side.size > 0)
    .every((side) => overlap(side, grounded) > 0);
};

// The host can infer a concept that the user did not name. An exact excerpt
// proves only that the host grounded its hypothesis in the active question;
// it does not prove the semantic bridge or promote a badge to evidence.
export function findPublicQuestionAnchoredCandidates(
  badges: readonly PublicBadge[], activeQuestion: string,
  bridges: readonly PublicPrincipleBridge[], excludedIds: ReadonlySet<string> = new Set(),
): string[] {
  if (!activeQuestion.trim() || !bridges.length) return [];
  const normalizedQuestion = activeQuestion.toLowerCase().replace(/\s+/g, " ");
  const titleFrequency = new Map<string, number>();
  for (const badge of badges) {
    for (const word of terms(badge.title)) {
      titleFrequency.set(word, (titleFrequency.get(word) ?? 0) + 1);
    }
  }
  const rareLimit = Math.max(2, Math.floor(badges.length * 0.02));
  const ranked = new Map<string, number>();
  for (const bridge of bridges.slice(0, 3)) {
    if (bridge.principle.length > 100 || bridge.question_excerpt.length > 160) continue;
    const excerpt = bridge.question_excerpt.trim().toLowerCase().replace(/\s+/g, " ");
    const hint = terms(bridge.principle);
    if (excerpt.length < 12 || !normalizedQuestion.includes(excerpt) ||
      terms(excerpt).size < 2 || hint.size < 2) continue;
    const candidates = badges.flatMap((badge) => {
      if (excludedIds.has(badge.id) || !scopedTheoryProjectFits(badge.id, activeQuestion)) return [];
      if (!relationalTitleTargetFits(badge.title, activeQuestion, hint)) return [];
      if (!slashTitleSidesFit(badge.title, activeQuestion, hint)) return [];
      const title = terms(badge.title);
      const rareTitleMatches = [...hint].filter((word) => title.has(word) &&
        (titleFrequency.get(word) ?? badges.length) <= rareLimit);
      if (!rareTitleMatches.length) return [];
      const summary = terms(badge.summary);
      const score = rareTitleMatches.length * 20 + overlap(hint, title) * 4 +
        overlap(hint, summary) * 2;
      return [{ id: badge.id, score }];
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (!candidates.length || candidates[1]?.score === candidates[0].score) continue;
    const best = candidates[0];
    ranked.set(best.id, Math.max(ranked.get(best.id) ?? 0, best.score));
  }
  return [...ranked].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3).map(([id]) => id);
}

export function findPublicPrincipleHypotheses(
  badges: readonly PublicBadge[], activeQuestion: string, candidatePrinciples: readonly string[],
  searchText: ReadonlyMap<string, string> = new Map(),
  options: { allowRareTitleAnchor?: boolean } = {},
): string[] {
  if (!candidatePrinciples.length || !activeQuestion.trim()) return [];
  const questionTerms = terms(activeQuestion);
  if (!questionTerms.size) return [];
  const documentFrequency = new Map<string, number>();
  if (options.allowRareTitleAnchor) {
    for (const badge of badges) {
      for (const word of terms(`${badge.id} ${badge.title} ${badge.summary} ${searchText.get(badge.id) ?? ""}`)) {
        documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
      }
    }
  }
  const rareTermLimit = Math.max(2, Math.floor(badges.length * 0.05));
  const ranked = new Map<string, { score: number; questionSupport: Set<string> }>();
  for (const principle of candidatePrinciples.slice(0, 3)) {
    if (principle.length > 100) continue;
    const hint = terms(principle);
    const named = identity(principle);
    if (hint.size < 2 && !badges.some((badge) => named === identity(badge.id) || named === identity(badge.title))) continue;
    const candidates: Array<{ id: string; score: number; questionSupport: Set<string> }> = [];
    for (const badge of badges) {
      if (!relationalTitleTargetFits(badge.title, activeQuestion, hint)) continue;
      const title = terms(`${badge.id} ${badge.title}`);
      const summary = terms(badge.summary);
      const metadata = terms(searchText.get(badge.id) ?? "");
      const badgeTerms = new Set([...title, ...summary, ...metadata]);
      const hintCoverage = overlap(hint, badgeTerms);
      const questionCoverage = overlap(questionTerms, badgeTerms);
      const questionTitleCoverage = overlap(questionTerms, title);
      const questionSummaryCoverage = overlap(questionTerms, summary);
      const titleCoverage = overlap(hint, title);
      const summaryCoverage = overlap(hint, summary);
      const metadataCoverage = overlap(hint, metadata);
      const exactIdentity = named === identity(badge.id) || named === identity(badge.title);
      // Project-scoped diagnostics need that domain in the active question;
      // generic spectral or field words cannot turn a laboratory observation
      // into a Solar card or a terrestrial measurement into an NHM2 study.
      if (!exactIdentity && !scopedTheoryProjectFits(badge.id, activeQuestion)) continue;
      const hintLocated = hintCoverage >= 2 && hintCoverage / hint.size >= 0.25 &&
        (titleCoverage >= 1 || summaryCoverage >= 2 || metadataCoverage >= 2) && questionCoverage >= 1;
      const questionLocated = questionTitleCoverage >= 2 && questionCoverage >= 2 &&
        (titleCoverage >= 1 || summaryCoverage >= 1);
      // A single uncommon title word can be a meaningful bridge when both
      // the question and the host's proposed principle use it. Common words
      // such as "energy" must still pass the stronger multiword checks.
      const rareTitleAnchor = Boolean(options.allowRareTitleAnchor) && [...hint].some((word) => questionTerms.has(word) && title.has(word) &&
        (documentFrequency.get(word) ?? badges.length) <= rareTermLimit);
      // A question-only match must not turn an unrelated host hint into a
      // catalog card. Every non-exact proposal needs support from both the
      // active question and the proposed principle.
      if (!exactIdentity && !hintLocated && !questionLocated && !rareTitleAnchor) continue;
      if (exactIdentity && questionCoverage < 1) continue;
      candidates.push({ id: badge.id, questionSupport: new Set([...questionTerms].filter((word) => badgeTerms.has(word))),
        // The proposed principle's overlap with a reviewed badge title is
        // stronger than generic words shared by the question and private
        // search metadata (for example "measured" or "state").
        score: (exactIdentity ? 100 : 0) + questionTitleCoverage * 5 +
          questionSummaryCoverage * 3 + Math.min(questionCoverage, 3) * 2 +
          titleCoverage * 16 + summaryCoverage * 3 + hintCoverage * 2 });
    }
    candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (!candidates.length || candidates[0].score < 8 ||
      (candidates[1] && candidates[0].score - candidates[1].score < 2)) continue;
    const selected = candidates[0];
    if (selected.score > (ranked.get(selected.id)?.score ?? 0)) {
      ranked.set(selected.id, { score: selected.score, questionSupport: selected.questionSupport });
    }
  }
  const ordered = [...ranked].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  // A weakly supported neighboring card can use up one of only three visible
  // slots. A lower-ranked card supported by no additional words in the active
  // question is redundant; other hypotheses can still contribute a new lens.
  const retained: typeof ordered = [];
  for (const candidate of ordered) {
    const support = candidate[1].questionSupport;
    if (retained.some(([, prior]) => [...support].every((word) => prior.questionSupport.has(word)))) continue;
    retained.push(candidate);
  }
  return retained.slice(0, 3)
    .map(([id]) => id);
}

// Exploratory alternatives are deliberately weaker than admitted context
// cards. They let the host compare reviewed concepts when a short mechanism
// hint has one rare term, while retaining a question overlap and a strict
// output budget. Callers must label these as unverified search leads.
export function findPublicExploratoryCandidates(
  badges: readonly PublicBadge[], activeQuestion: string, candidatePrinciples: readonly string[],
  searchText: ReadonlyMap<string, string> = new Map(), excludedIds: ReadonlySet<string> = new Set(),
): string[] {
  if (!candidatePrinciples.length || !activeQuestion.trim()) return [];
  const question = exploratoryTerms(activeQuestion);
  if (!question.size) return [];
  const allHints = new Set(candidatePrinciples.slice(0, 3)
    .filter((hint) => hint.length <= 100)
    .flatMap((hint) => [...exploratoryTerms(hint)]));
  const documentFrequency = new Map<string, number>();
  const indexed = badges.map((badge) => {
    const title = exploratoryTerms(`${badge.id} ${badge.title}`);
    const summary = exploratoryTerms(badge.summary);
    const metadata = exploratoryTerms(searchText.get(badge.id) ?? "");
    const all = new Set([...title, ...summary, ...metadata]);
    for (const word of all) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    return { badge, title, summary, all };
  });
  const rareLimit = Math.max(2, Math.floor(badges.length * 0.05));
  const ranked = new Map<string, number>();
  for (const hint of candidatePrinciples.slice(0, 3)) {
    if (hint.length > 100) continue;
    for (const word of exploratoryTerms(hint)) {
      if ((documentFrequency.get(word) ?? badges.length) > rareLimit) continue;
      const candidates = indexed.flatMap(({ badge, title, summary, all }) => {
        if (excludedIds.has(badge.id) || (!title.has(word) && !summary.has(word)) ||
          overlap(allHints, all) < 2) return [];
        if (!relationalTitleTargetFits(badge.title, activeQuestion, allHints)) return [];
        if (!scopedTheoryProjectFits(badge.id, activeQuestion)) return [];
        const questionCoverage = overlap(question, all);
        if (!questionCoverage) return [];
        return [{ id: badge.id, score: (title.has(word) ? 12 : 0) +
          (summary.has(word) ? 8 : 0) + Math.min(questionCoverage, 3) * 2 +
          overlap(question, title) * 3 + overlap(question, summary) * 2 }];
      });
      candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      for (const candidate of candidates.slice(0, 2)) {
        ranked.set(candidate.id, Math.max(ranked.get(candidate.id) ?? 0, candidate.score));
      }
    }
  }
  return [...ranked].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6).map(([id]) => id);
}
