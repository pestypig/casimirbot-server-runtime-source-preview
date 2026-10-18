import {
  CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
  INTERNET_SEARCH_CAPABILITY,
  THEORY_CONTEXT_REFLECTION_CAPABILITY,
  VISUAL_OBSERVER_COMPARE_PROFILES_CAPABILITY,
  VISUAL_OBSERVER_QUERY_PROFILES_CAPABILITY,
  VISUAL_OBSERVER_TEST_PROFILE_CAPABILITY,
  readRecord,
  readString,
} from "./explicit-tool-requests";

export const requestKey = (request: Record<string, unknown>): string => {
  const args = readRecord(request.arguments ?? request.args) ?? {};
  const capability = readString(request.capability_id) ?? readString(request.capabilityId) ?? "";
  if (
    capability === THEORY_CONTEXT_REFLECTION_CAPABILITY ||
    capability === CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY ||
    capability === INTERNET_SEARCH_CAPABILITY ||
    capability === VISUAL_OBSERVER_QUERY_PROFILES_CAPABILITY ||
    capability === VISUAL_OBSERVER_TEST_PROFILE_CAPABILITY ||
    capability === VISUAL_OBSERVER_COMPARE_PROFILES_CAPABILITY
  ) {
    return capability;
  }
  const expression = readString(args.expression) ?? readString(args.latex);
  const query = readString(args.query) ?? readString(args.prompt) ?? readString(args.text);
  const sourceTargetIntent = readRecord(args.source_target_intent ?? args.sourceTargetIntent);
  const sourceTarget = readRecord(sourceTargetIntent?.source_target ?? sourceTargetIntent?.sourceTarget);
  const sourceIdentity =
    readString(args.source_url ?? args.sourceUrl) ??
    readString(
      sourceTarget?.canonical_url ??
      sourceTarget?.canonicalUrl ??
      sourceTarget?.source_url ??
      sourceTarget?.sourceUrl,
    );
  const pathList = Array.isArray(args.paths)
    ? args.paths.map(readString).filter(Boolean).join(",")
    : readString(args.path) ?? "";
  return [capability, sourceIdentity, expression, query, pathList].filter(Boolean).join(":");
};

export const appendDedupe = (
  requests: Record<string, unknown>[],
  seen: Set<string>,
  next: Record<string, unknown>[],
): void => {
  for (const request of next) {
    const key = requestKey(request);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    requests.push(request);
  }
};
