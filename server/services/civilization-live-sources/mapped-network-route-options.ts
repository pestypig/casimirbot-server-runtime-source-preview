import { z } from "zod";
import {
  buildCivilizationTraversabilityAtlasV1,
  validateCivilizationTraversabilityAtlasV1,
  type CivilizationInfrastructureEdgeV1,
  type CivilizationMappedNetworkRouteCandidateV1,
  type CivilizationMappedNetworkRouteSegmentV1,
  type CivilizationTraversabilityAtlasV1,
} from "@shared/civilization-traversability-atlas";
import {
  civilizationInfrastructureKindSchema,
  civilizationOsmInfrastructureOutputSchema,
  readOsmInfrastructureEvidence,
  type CivilizationInfrastructureKind,
  type CivilizationOsmInfrastructureEvidence,
} from "./osm-infrastructure-evidence";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";
import {
  readNaturalEarthBoundaryLines,
  type CivilizationNaturalEarthBoundaryLineEvidence,
} from "./natural-earth-boundary-lines";
import {
  civilizationRouteBoundaryLineReviewSchema,
  reviewRouteBoundaryLineEncounters,
  type CivilizationRouteBoundaryLineReview,
} from "./route-boundary-line-review";
import {
  readNaturalEarthHydrography,
  type CivilizationNaturalEarthHydrographyEvidence,
} from "./natural-earth-hydrography";
import {
  civilizationRouteHydrographyReviewSchema,
  reviewRouteHydrographyEncounters,
  type CivilizationRouteHydrographyReview,
} from "./route-hydrography-review";
import { readNaturalEarthLakes, type CivilizationNaturalEarthLakesEvidence } from "./natural-earth-lakes";
import { civilizationRouteLakeReviewSchema, reviewLakeContacts, type CivilizationRouteLakeReview } from "./route-lake-review";

const MAX_DETOUR_SEARCHES = 24;
const MAX_GAP_NODE_PAIRS = 100_000;

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).strict();
type Point = z.infer<typeof pointSchema>;

export const civilizationMappedNetworkGapHypothesisSchema = z.object({
  networkKind: civilizationInfrastructureKindSchema,
  fromNodeRef: z.string().min(1), toNodeRef: z.string().min(1),
  from: pointSchema, to: pointSchema,
  straightLineDistanceKm: z.number().nonnegative(),
  fromSourceRecordUrl: z.string().url(), toSourceRecordUrl: z.string().url(),
  geometryMeaning: z.literal("unscreened_straight_line_between_mapped_components"),
  connectionStatus: z.literal("unverified_hypothesis"),
  missingEvidence: z.array(z.string()),
}).strict();
export type CivilizationMappedNetworkGapHypothesis = z.infer<typeof civilizationMappedNetworkGapHypothesisSchema>;

const gapReviewSchema = z.object({
  status: z.enum(["mapped_candidate_found", "no_endpoint_snap", "same_undirected_component_or_direction_review", "no_same_kind_anchor_pair", "disconnected_components", "incomplete_search"]),
  nodePairsConsidered: z.number().int().nonnegative(),
  searchExhaustive: z.boolean(),
  hypotheses: z.array(civilizationMappedNetworkGapHypothesisSchema).max(3),
  missingEvidence: z.array(z.string()),
}).strict();
export type CivilizationMappedNetworkGapReview = z.infer<typeof gapReviewSchema>;

export const civilizationMappedNetworkRouteQuerySchema = z.object({
  bbox: z.tuple([
    z.number().min(-180).max(180), z.number().min(-90).max(90),
    z.number().min(-180).max(180), z.number().min(-90).max(90),
  ]),
  origin: pointSchema,
  destination: pointSchema,
  networkKinds: z.array(civilizationInfrastructureKindSchema).min(1).max(6),
  objective: z.literal("shortest_mapped_length"),
  evaluatedAt: z.string().datetime({ offset: true }),
  maxSnapKm: z.number().min(0.05).max(5).default(1),
  maxWays: z.number().int().min(1).max(200).default(200),
  maxCandidates: z.number().int().min(1).max(3).default(3),
  includeBoundaryLineReview: z.boolean().default(false),
  includeHydrographyReview: z.boolean().default(false),
  includeLakeReview: z.boolean().default(false),
}).strict();
export type CivilizationMappedNetworkRouteQuery = z.infer<typeof civilizationMappedNetworkRouteQuerySchema>;

export const civilizationMappedNetworkRouteOutputSchema = z.object({
  schemaVersion: z.literal("civilization_mapped_network_route_options/v6"),
  query: civilizationMappedNetworkRouteQuerySchema,
  source: civilizationOsmInfrastructureOutputSchema.shape.source,
  coverage: z.object({
    status: z.enum(["candidate_found", "endpoint_not_connected_to_inventory", "endpoints_snap_to_same_node", "no_path_between_considered_nodes"]),
    mappedWays: z.number().int().nonnegative(),
    graphWays: z.number().int().nonnegative(),
    mappedOneWayRoadWays: z.number().int().nonnegative(),
    waterwayInventoryScope: z.literal("mapped_canal_ways_only"),
    graphNodes: z.number().int().nonnegative(),
    snapPairsConsidered: z.number().int().nonnegative(),
    detourSearchesAttempted: z.number().int().nonnegative(),
    alternativeSearchExhaustive: z.literal(false),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
  candidates: z.array(z.any()),
  gapReview: gapReviewSchema,
  boundaryLineReview: civilizationRouteBoundaryLineReviewSchema,
  hydrographyReview: civilizationRouteHydrographyReviewSchema,
  lakeReview: civilizationRouteLakeReviewSchema,
  atlas: z.any(),
  authority: z.object({
    assistant_answer: z.literal(false),
    terminal_eligible: z.literal(false),
    execution_permission: z.literal(false),
  }).strict(),
}).strict();

export type CivilizationMappedNetworkRouteOptions = {
  schemaVersion: "civilization_mapped_network_route_options/v6";
  query: CivilizationMappedNetworkRouteQuery;
  source: CivilizationOsmInfrastructureEvidence["source"];
  coverage: {
    status: "candidate_found" | "endpoint_not_connected_to_inventory" | "endpoints_snap_to_same_node" | "no_path_between_considered_nodes";
    mappedWays: number;
    graphWays: number;
    mappedOneWayRoadWays: number;
    waterwayInventoryScope: "mapped_canal_ways_only";
    graphNodes: number;
    snapPairsConsidered: number;
    detourSearchesAttempted: number;
    alternativeSearchExhaustive: false;
    possiblyTruncated: boolean;
    missingEvidence: string[];
  };
  candidates: CivilizationMappedNetworkRouteCandidateV1[];
  gapReview: CivilizationMappedNetworkGapReview;
  boundaryLineReview: CivilizationRouteBoundaryLineReview;
  hydrographyReview: CivilizationRouteHydrographyReview;
  lakeReview: CivilizationRouteLakeReview;
  atlas: CivilizationTraversabilityAtlasV1;
  authority: { assistant_answer: false; terminal_eligible: false; execution_permission: false };
};

type Arc = {
  from: string;
  to: string;
  edge: CivilizationInfrastructureEdgeV1;
  distanceKm: number;
};

class MinHeap<T> {
  private items: Array<{ priority: number; value: T }> = [];
  get size(): number { return this.items.length; }
  push(priority: number, value: T): void {
    const item = { priority, value };
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop(): { priority: number; value: T } | undefined {
    const first = this.items[0];
    const tail = this.items.pop();
    if (!first || !tail || this.items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.items.length) break;
      const right = left + 1;
      const child = right < this.items.length && this.items[right].priority < this.items[left].priority
        ? right : left;
      if (this.items[child].priority >= tail.priority) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = tail;
    return first;
  }
}

function distanceKm(a: Point, b: Point): number {
  const radians = Math.PI / 180;
  const latDelta = (b.lat - a.lat) * radians;
  const lonDelta = (b.lon - a.lon) * radians;
  const sine = Math.sin(latDelta / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(lonDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(sine), Math.sqrt(Math.max(0, 1 - sine)));
}

function inside(point: Point, bbox: [number, number, number, number]): boolean {
  return point.lon >= bbox[0] && point.lon <= bbox[2] &&
    point.lat >= bbox[1] && point.lat <= bbox[3];
}

type NodeSnap = { ref: string; distanceKm: number };

function nearestNodes(nodes: Map<string, Point>, point: Point, maxSnapKm: number): NodeSnap[] {
  const best: NodeSnap[] = [];
  for (const [ref, candidate] of nodes) {
    const distance = distanceKm(point, candidate);
    if (distance > maxSnapKm) continue;
    best.push({ ref, distanceKm: distance });
    best.sort((left, right) => left.distanceKm - right.distanceKm || left.ref.localeCompare(right.ref));
    if (best.length > 4) best.pop();
  }
  return best;
}

function shortestPath(
  adjacency: Map<string, Arc[]>, start: string, target: string,
  excludedMappedWayId?: string,
): Arc[] | null {
  const heap = new MinHeap<string>();
  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, Arc>();
  heap.push(0, start);
  while (heap.size > 0) {
    const current = heap.pop();
    if (!current || current.priority !== distances.get(current.value)) continue;
    if (current.value === target) break;
    for (const arc of adjacency.get(current.value) ?? []) {
      if (arc.edge.edgeId === excludedMappedWayId) continue;
      const next = current.priority + arc.distanceKm;
      if (next >= (distances.get(arc.to) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(arc.to, next);
      previous.set(arc.to, arc);
      heap.push(next, arc.to);
    }
  }
  if (!previous.has(target)) return null;
  const path: Arc[] = [];
  let cursor = target;
  while (cursor !== start) {
    const arc = previous.get(cursor);
    if (!arc) return null;
    path.push(arc);
    cursor = arc.from;
  }
  return path.reverse();
}

function buildGraph(
  edges: CivilizationInfrastructureEdgeV1[], bbox: [number, number, number, number],
): {
  nodes: Map<string, Point>;
  adjacency: Map<string, Arc[]>;
  graphWays: number;
  mappedOneWayRoadWays: number;
  excludedWays: number;
  clippedSegments: boolean;
} {
  const nodes = new Map<string, Point>();
  const adjacency = new Map<string, Arc[]>();
  let graphWays = 0;
  let mappedOneWayRoadWays = 0;
  let excludedWays = 0;
  let clippedSegments = false;
  const addArc = (arc: Arc) => adjacency.set(arc.from, [...(adjacency.get(arc.from) ?? []), arc]);
  for (const edge of edges) {
    if (edge.nodeRefs.length !== edge.coordinates.length ||
        ["construction", "disused", "abandoned"].some((key) =>
          edge.sourceAttributes[key] && edge.sourceAttributes[key] !== "no")) {
      excludedWays++;
      continue;
    }
    let used = false;
    const mappedRoadDirection = edge.networkKind === "road" ? edge.sourceAttributes.oneway?.toLowerCase() : undefined;
    const forwardAllowed = mappedRoadDirection !== "-1";
    const reverseAllowed = !["yes", "true", "1"].includes(mappedRoadDirection ?? "");
    for (let index = 0; index < edge.nodeRefs.length - 1; index++) {
      const fromPoint = edge.coordinates[index];
      const toPoint = edge.coordinates[index + 1];
      if (!inside(fromPoint, bbox) || !inside(toPoint, bbox)) {
        clippedSegments = true;
        continue;
      }
      const from = edge.nodeRefs[index];
      const to = edge.nodeRefs[index + 1];
      if (from === to) continue;
      const length = distanceKm(fromPoint, toPoint);
      nodes.set(from, fromPoint);
      nodes.set(to, toPoint);
      if (forwardAllowed) addArc({ from, to, edge, distanceKm: length });
      if (reverseAllowed) addArc({ from: to, to: from, edge, distanceKm: length });
      used = true;
    }
    if (used) {
      graphWays++;
      if (!forwardAllowed || !reverseAllowed) mappedOneWayRoadWays++;
    }
  }
  return { nodes, adjacency, graphWays, mappedOneWayRoadWays, excludedWays, clippedSegments };
}

function reviewMappedNetworkGaps(
  graph: ReturnType<typeof buildGraph>, query: CivilizationMappedNetworkRouteQuery,
  mappedCandidateFound: boolean, endpointSnapMissing: boolean,
): CivilizationMappedNetworkGapReview {
  const missingEvidence = [
    "osm_inventory_is_not_a_complete_asset_register",
    "straight_link_is_not_an_engineered_alignment",
    "terrain_hydrography_protected_areas_and_border_contact_not_screened_for_link",
    "asset_operation_capacity_access_rights_and_interconnection_unverified",
    "land_rights_affected_parties_consultation_and_environmental_review_required",
    "no_inference_that_new_construction_is_needed_or_feasible",
  ];
  if (mappedCandidateFound) return { status: "mapped_candidate_found", nodePairsConsidered: 0,
    searchExhaustive: true, hypotheses: [], missingEvidence };
  if (endpointSnapMissing) return { status: "no_endpoint_snap", nodePairsConsidered: 0,
    searchExhaustive: true, hypotheses: [], missingEvidence };
  const nodeKindLinks = new Map<CivilizationInfrastructureKind, Map<string, Set<string>>>();
  const nodeSources = new Map<string, string>();
  for (const [from, arcs] of graph.adjacency) {
    for (const arc of arcs) {
      const kind = arc.edge.networkKind as CivilizationInfrastructureKind;
      const links = nodeKindLinks.get(kind) ?? new Map<string, Set<string>>();
      nodeKindLinks.set(kind, links);
      for (const [a, b] of [[from, arc.to], [arc.to, from]]) {
        const neighbors = links.get(a) ?? new Set<string>();
        neighbors.add(b);
        links.set(a, neighbors);
      }
      nodeSources.set(`${kind}:${from}`, arc.edge.sourceRecordUrl);
      nodeSources.set(`${kind}:${arc.to}`, arc.edge.sourceRecordUrl);
    }
  }
  let nodePairsConsidered = 0;
  let searchExhaustive = true;
  let sameComponent = false;
  let sameKindAnchorPair = false;
  const hypotheses: CivilizationMappedNetworkGapHypothesis[] = [];
  for (const kind of query.networkKinds) {
    const links = nodeKindLinks.get(kind);
    if (!links) continue;
    const nodes = new Map([...links.keys()].flatMap((ref) => {
      const point = graph.nodes.get(ref);
      return point ? [[ref, point] as const] : [];
    }));
    const fromSnaps = nearestNodes(nodes, query.origin, query.maxSnapKm);
    const toSnaps = nearestNodes(nodes, query.destination, query.maxSnapKm);
    if (!fromSnaps.length || !toSnaps.length) continue;
    sameKindAnchorPair = true;
    const componentByNode = new Map<string, number>();
    let componentCount = 0;
    for (const ref of links.keys()) {
      if (componentByNode.has(ref)) continue;
      const stack = [ref];
      componentByNode.set(ref, componentCount);
      while (stack.length) {
        for (const neighbor of links.get(stack.pop()!) ?? []) {
          if (componentByNode.has(neighbor)) continue;
          componentByNode.set(neighbor, componentCount);
          stack.push(neighbor);
        }
      }
      componentCount++;
    }
    const fromComponents = new Set(fromSnaps.map((snap) => componentByNode.get(snap.ref)));
    const toComponents = new Set(toSnaps.map((snap) => componentByNode.get(snap.ref)));
    if ([...fromComponents].some((component) => toComponents.has(component))) {
      sameComponent = true;
      continue;
    }
    const fromNodes = [...nodes].filter(([ref]) => fromComponents.has(componentByNode.get(ref)));
    const toNodes = [...nodes].filter(([ref]) => toComponents.has(componentByNode.get(ref)));
    let best: { fromRef: string; toRef: string; from: Point; to: Point; distanceKm: number } | null = null;
    for (const [fromRef, from] of fromNodes) {
      for (const [toRef, to] of toNodes) {
        if (nodePairsConsidered >= MAX_GAP_NODE_PAIRS) { searchExhaustive = false; break; }
        nodePairsConsidered++;
        const distance = distanceKm(from, to);
        if (!best || distance < best.distanceKm) best = { fromRef, toRef, from, to, distanceKm: distance };
      }
      if (!searchExhaustive) break;
    }
    if (best) hypotheses.push({
      networkKind: kind, fromNodeRef: best.fromRef, toNodeRef: best.toRef,
      from: best.from, to: best.to, straightLineDistanceKm: best.distanceKm,
      fromSourceRecordUrl: nodeSources.get(`${kind}:${best.fromRef}`)!,
      toSourceRecordUrl: nodeSources.get(`${kind}:${best.toRef}`)!,
      geometryMeaning: "unscreened_straight_line_between_mapped_components",
      connectionStatus: "unverified_hypothesis", missingEvidence,
    });
    if (!searchExhaustive) break;
  }
  hypotheses.sort((a, b) => a.straightLineDistanceKm - b.straightLineDistanceKm ||
    a.networkKind.localeCompare(b.networkKind));
  const status = !searchExhaustive ? "incomplete_search" as const
    : hypotheses.length ? "disconnected_components" as const
      : sameComponent ? "same_undirected_component_or_direction_review" as const
        : sameKindAnchorPair ? "same_undirected_component_or_direction_review" as const
          : graph.nodes.size === 0 ? "no_endpoint_snap" as const : "no_same_kind_anchor_pair" as const;
  return { status, nodePairsConsidered, searchExhaustive,
    hypotheses: hypotheses.slice(0, 3), missingEvidence };
}

function candidateFromPath(
  path: Arc[], query: CivilizationMappedNetworkRouteQuery,
  originSnap: { ref: string; distanceKm: number },
  destinationSnap: { ref: string; distanceKm: number },
  optionIndex: number,
  excludedMappedWayId: string | null,
): CivilizationMappedNetworkRouteCandidateV1 {
  const segments: CivilizationMappedNetworkRouteSegmentV1[] = path.map((arc) => ({
    edgeId: arc.edge.edgeId,
    networkKind: arc.edge.networkKind,
    fromNodeRef: arc.from,
    toNodeRef: arc.to,
    distanceKm: arc.distanceKm,
    sourceRecordUrl: arc.edge.sourceRecordUrl,
    evidenceRefs: arc.edge.evidenceRefs,
  }));
  const nodePositions = new Map<string, Point>();
  for (const arc of path) {
    for (let index = 0; index < arc.edge.nodeRefs.length; index++) {
      nodePositions.set(arc.edge.nodeRefs[index], arc.edge.coordinates[index]);
    }
  }
  const coordinates = [nodePositions.get(path[0].from)!, ...path.map((arc) => nodePositions.get(arc.to)!)];
  const networkKinds = [...new Set(segments.map((segment) => segment.networkKind))];
  const hasNetworkTransition = segments.some((segment, index) => index > 0 &&
    segment.networkKind !== segments[index - 1].networkKind);
  const hasDirectionTag = path.some((arc) => Boolean(arc.edge.sourceAttributes.oneway));
  const hasAccessTag = path.some((arc) => Boolean(arc.edge.sourceAttributes.access));
  const pipelineWays = [...new Map(path.filter((arc) => arc.edge.networkKind === "pipeline")
    .map((arc) => [arc.edge.edgeId, arc.edge])).values()].map((edge) => ({
    edgeId: edge.edgeId, sourceRecordUrl: edge.sourceRecordUrl,
    substanceTag: edge.sourceAttributes.substance?.trim() || null,
  }));
  const distinctSubstanceTags = [...new Set(pipelineWays.flatMap((way) => way.substanceTag ? [way.substanceTag] : []))];
  const untaggedWayCount = pipelineWays.filter((way) => !way.substanceTag).length;
  const pipelineTagStatus = !pipelineWays.length ? "not_applicable" as const
    : distinctSubstanceTags.length > 1 ? "tagged_values_differ" as const
      : untaggedWayCount === pipelineWays.length ? "all_untagged" as const
        : untaggedWayCount > 0 ? "partially_tagged" as const : "all_tagged_same_text" as const;
  return {
    candidateId: `mapped-network:${query.evaluatedAt}:${originSnap.ref}:${destinationSnap.ref}:${optionIndex}`,
    optionIndex,
    generation: excludedMappedWayId === null ? "shortest_for_snapped_pair" : "detour_excluding_mapped_way",
    excludedMappedWayId,
    objective: "shortest_mapped_length",
    pathKind: "topological_alignment",
    evaluatedAt: query.evaluatedAt,
    requestedOrigin: query.origin,
    requestedDestination: query.destination,
    snappedOriginNodeRef: originSnap.ref,
    snappedDestinationNodeRef: destinationSnap.ref,
    originSnapDistanceKm: originSnap.distanceKm,
    destinationSnapDistanceKm: destinationSnap.distanceKm,
    distanceKm: path.reduce((sum, arc) => sum + arc.distanceKm, 0),
    selectionCostKm: path.reduce((sum, arc) => sum + arc.distanceKm, 0) +
      originSnap.distanceKm + destinationSnap.distanceKm,
    networkKinds,
    segments,
    pipelineTagReview: {
      status: pipelineTagStatus, wayCount: pipelineWays.length, untaggedWayCount,
      distinctSubstanceTags, ways: pipelineWays,
      productCompatibility: "unverified", flowDirection: "unverified",
    },
    coordinates,
    operationalStatus: "unknown",
    capacityStatus: "unknown",
    physicalFeasibility: "unknown",
    jurisdictionalPermission: "unknown",
    hazardAssessment: "unknown",
    evidenceRefs: [...new Set(path.flatMap((arc) => arc.edge.evidenceRefs))],
    missingEvidence: [
      "independent_asset_verification", "operational_status", "capacity",
      "physical_connectivity_verification", "jurisdictional_permissions", "natural_hazards",
      "validity_at_evaluation_time",
      "mode_specific_direction_and_turn_restrictions", "flow_direction_and_transfer_compatibility",
      "alternative_search_not_exhaustive",
      ...(hasNetworkTransition ? ["network_transition_facility_and_permission"] : []),
      ...(hasDirectionTag ? ["oneway_tag_requires_mode_specific_review"] : []),
      ...(hasAccessTag ? ["access_tag_requires_legal_review"] : []),
      ...(pipelineWays.length ? ["pipeline_product_and_flow_direction_unverified"] : []),
      ...(pipelineTagStatus === "tagged_values_differ" ? ["mapped_pipeline_substance_tags_differ_review_product_continuity"] : []),
      ...(pipelineTagStatus === "all_untagged" || pipelineTagStatus === "partially_tagged"
        ? ["mapped_pipeline_substance_tags_incomplete"] : []),
    ],
    claimTier: "hypothetical",
  };
}

function pathKey(path: Arc[]): string {
  return path.map((arc) => `${arc.edge.edgeId}:${arc.from}:${arc.to}`).join("|");
}

function mappedLength(path: Arc[]): number {
  return path.reduce((sum, arc) => sum + arc.distanceKm, 0);
}

export async function readMappedNetworkRouteOptions(
  input: unknown,
  infrastructureReader: (query: unknown) => Promise<CivilizationOsmInfrastructureEvidence> = readOsmInfrastructureEvidence,
  boundaryLineReader: (query: unknown) => Promise<CivilizationNaturalEarthBoundaryLineEvidence> = readNaturalEarthBoundaryLines,
  hydrographyReader: (query: unknown) => CivilizationNaturalEarthHydrographyEvidence | Promise<CivilizationNaturalEarthHydrographyEvidence> = readNaturalEarthHydrography,
  lakeReader: (query: unknown) => CivilizationNaturalEarthLakesEvidence | Promise<CivilizationNaturalEarthLakesEvidence> = readNaturalEarthLakes,
): Promise<CivilizationMappedNetworkRouteOptions> {
  const parsed = civilizationMappedNetworkRouteQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Mapped-network route query is invalid.");
  }
  const query = parsed.data;
  if (new Set(query.networkKinds).size !== query.networkKinds.length ||
      !inside(query.origin, query.bbox) || !inside(query.destination, query.bbox)) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Network kinds must be unique and both endpoints must lie inside the query area.");
  }
  const infrastructure = await infrastructureReader({
    bbox: query.bbox,
    kinds: query.networkKinds as CivilizationInfrastructureKind[],
    maxWays: query.maxWays,
  });
  const edges = infrastructure.atlas.infrastructureEdges ?? [];
  const graph = buildGraph(edges, query.bbox);
  const originSnaps = nearestNodes(graph.nodes, query.origin, query.maxSnapKm);
  const destinationSnaps = nearestNodes(graph.nodes, query.destination, query.maxSnapKm);
  const snapPairsConsidered = originSnaps.length * destinationSnaps.length;
  const pairPaths: Array<{ originSnap: NodeSnap; destinationSnap: NodeSnap; path: Arc[]; totalKm: number }> = [];
  for (const originSnap of originSnaps) {
    for (const destinationSnap of destinationSnaps) {
      if (originSnap.ref === destinationSnap.ref) continue;
      const path = shortestPath(graph.adjacency, originSnap.ref, destinationSnap.ref);
      if (!path) continue;
      pairPaths.push({
        originSnap, destinationSnap, path,
        totalKm: mappedLength(path) + originSnap.distanceKm + destinationSnap.distanceKm,
      });
    }
  }
  pairPaths.sort((left, right) => left.totalKm - right.totalKm ||
    mappedLength(left.path) - mappedLength(right.path));
  const selectedPair = pairPaths[0];
  const candidates: CivilizationMappedNetworkRouteCandidateV1[] = [];
  let detourSearchesAttempted = 0;
  if (selectedPair) {
    const { originSnap, destinationSnap, path } = selectedPair;
    const chosenPaths: Array<{ path: Arc[]; excludedMappedWayId: string | null }> = [
      { path, excludedMappedWayId: null },
    ];
    const seenPaths = new Set([pathKey(path)]);
    while (chosenPaths.length < query.maxCandidates) {
      const alternatives: Array<{ path: Arc[]; excludedMappedWayId: string }> = [];
      const triedWayIds = new Set<string>();
      for (const selected of chosenPaths) {
        if (detourSearchesAttempted >= MAX_DETOUR_SEARCHES) break;
        const wayIds = [...new Set(selected.path.map((arc) => arc.edge.edgeId))].slice(0, 12);
        for (const edgeId of wayIds) {
          if (detourSearchesAttempted >= MAX_DETOUR_SEARCHES) break;
          if (triedWayIds.has(edgeId)) continue;
          triedWayIds.add(edgeId);
          detourSearchesAttempted++;
          const detour = shortestPath(graph.adjacency, originSnap.ref, destinationSnap.ref, edgeId);
          if (detour && !seenPaths.has(pathKey(detour))) {
            alternatives.push({ path: detour, excludedMappedWayId: edgeId });
          }
        }
      }
      alternatives.sort((left, right) => mappedLength(left.path) - mappedLength(right.path));
      const next = alternatives[0];
      if (!next) break;
      chosenPaths.push(next);
      seenPaths.add(pathKey(next.path));
    }
    chosenPaths.forEach((chosen, index) => candidates.push(candidateFromPath(
      chosen.path, query, originSnap, destinationSnap, index + 1, chosen.excludedMappedWayId,
    )));
  }
  const status = candidates.length > 0 ? "candidate_found" as const
    : originSnaps.length === 0 || destinationSnaps.length === 0 ? "endpoint_not_connected_to_inventory" as const
      : originSnaps.length === 1 && destinationSnaps.length === 1 &&
        originSnaps[0].ref === destinationSnaps[0].ref ? "endpoints_snap_to_same_node" as const
        : "no_path_between_considered_nodes" as const;
  const gapReview = reviewMappedNetworkGaps(graph, query, candidates.length > 0,
    originSnaps.length === 0 || destinationSnaps.length === 0);
  const missingEvidence = [
    ...infrastructure.coverage.missingEvidence,
    ...(graph.excludedWays > 0 ? ["ways_without_usable_topology_or_with_inactive_tags_excluded"] : []),
    ...(graph.mappedOneWayRoadWays > 0 ? ["mapped_road_oneway_tags_screen_direction_not_current_traffic_rules"] : []),
    ...(graph.clippedSegments ? ["segments_outside_bbox_omitted"] : []),
    ...(status === "candidate_found" ? [] : ["a_missing_path_here_does_not_prove_no_real_route"]),
    "turn_restrictions_and_transfer_facilities_unverified",
    "jurisdictional_crossings_unassessed",
    "natural_constraints_unassessed",
    "only_four_nearest_nodes_per_endpoint_considered",
    "alternative_search_not_exhaustive",
  ];
  let boundaryLineReview: CivilizationRouteBoundaryLineReview = query.includeBoundaryLineReview
    ? { status: "no_candidate", missingEvidence: ["no_mapped_candidate_to_compare", "jurisdictional_crossings_unassessed"] }
    : { status: "not_requested", missingEvidence: ["boundary_line_contact_not_requested", "jurisdictional_crossings_unassessed"] };
  if (query.includeBoundaryLineReview && candidates.length > 0) {
    try {
      const boundaryEvidence = await boundaryLineReader({
        bbox: query.bbox,
        maxLines: 75,
      });
      boundaryLineReview = reviewRouteBoundaryLineEncounters(candidates, boundaryEvidence);
    } catch (error) {
      boundaryLineReview = {
        status: "unavailable",
        errorCode: error instanceof CivilizationGeospatialSourceError ? error.code : "boundary_line_source_unavailable",
        missingEvidence: ["boundary_line_source_unavailable", "jurisdictional_crossings_unassessed"],
      };
    }
  }
  let hydrographyReview: CivilizationRouteHydrographyReview = query.includeHydrographyReview
    ? { status: "no_candidate", missingEvidence: ["no_mapped_candidate_to_compare", "hydrographic_contacts_unassessed"] }
    : { status: "not_requested", missingEvidence: ["hydrography_review_not_requested", "hydrographic_contacts_unassessed"] };
  if (query.includeHydrographyReview && candidates.length > 0) {
    try {
      const hydrographicEvidence = await hydrographyReader({
        bbox: query.bbox,
        kinds: ["river", "lake_centerline"],
        maxLines: 100,
      });
      hydrographyReview = reviewRouteHydrographyEncounters(candidates, hydrographicEvidence);
    } catch (error) {
      hydrographyReview = {
        status: "unavailable",
        errorCode: error instanceof CivilizationGeospatialSourceError ? error.code : "hydrography_source_unavailable",
        missingEvidence: ["hydrography_source_unavailable", "hydrographic_contacts_unassessed"],
      };
    }
  }
  let lakeReview: CivilizationRouteLakeReview = query.includeLakeReview
    ? { status: "no_candidate", missingEvidence: ["no_mapped_candidate_to_compare", "lake_outline_contacts_unassessed"] }
    : { status: "not_requested", missingEvidence: ["lake_review_not_requested", "lake_outline_contacts_unassessed"] };
  if (query.includeLakeReview && candidates.length > 0) {
    try {
      const lakeEvidence = await lakeReader({ bbox: query.bbox, maxLakes: 100 });
      lakeReview = reviewLakeContacts(candidates.flatMap((candidate) => candidate.segments.flatMap((segment, segmentIndex) => {
        const start = candidate.coordinates[segmentIndex];
        const end = candidate.coordinates[segmentIndex + 1];
        return start && end ? [{ candidateId: candidate.candidateId, segmentIndex,
          mappedEdgeId: segment.edgeId, start, end, routeEvidenceRefs: segment.evidenceRefs }] : [];
      })), lakeEvidence);
    } catch (error) {
      lakeReview = { status: "unavailable",
        errorCode: error instanceof CivilizationGeospatialSourceError ? error.code : "lake_source_unavailable",
        missingEvidence: ["lake_source_unavailable", "lake_outline_contacts_unassessed"] };
    }
  }
  const atlas = buildCivilizationTraversabilityAtlasV1({
    generatedAt: infrastructure.source.fetchedAt,
    atlasId: `civilization-traversability:mapped-network-route:${infrastructure.source.fetchedAt}`,
    scenarioId: "bounded_osm_topological_alignment",
    title: "OSM mapped network alignment candidates",
    temporalFrame: infrastructure.atlas.temporalFrame,
    fieldLayers: [],
    infrastructureNodes: [],
    infrastructureEdges: edges,
    mappedNetworkRouteCandidates: candidates,
    routeCandidates: [],
    observedFlows: [],
  });
  const issues = validateCivilizationTraversabilityAtlasV1(atlas);
  if (issues.length > 0) {
    throw new CivilizationGeospatialSourceError("atlas_invalid", issues.join("; "));
  }
  return {
    schemaVersion: "civilization_mapped_network_route_options/v6",
    query,
    source: infrastructure.source,
    coverage: {
      status,
      mappedWays: infrastructure.coverage.mappedWays,
      graphWays: graph.graphWays,
      mappedOneWayRoadWays: graph.mappedOneWayRoadWays,
      waterwayInventoryScope: infrastructure.coverage.waterwayInventoryScope,
      graphNodes: graph.nodes.size,
      snapPairsConsidered,
      detourSearchesAttempted,
      alternativeSearchExhaustive: false,
      possiblyTruncated: infrastructure.coverage.possiblyTruncated,
      missingEvidence,
    },
    candidates,
    gapReview,
    boundaryLineReview,
    hydrographyReview,
    lakeReview,
    atlas,
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false },
  };
}
