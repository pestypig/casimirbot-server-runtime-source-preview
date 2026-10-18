import { z } from "zod";
import { createHash } from "node:crypto";
import type { CivilizationInfrastructureEdgeV1 } from "@shared/civilization-traversability-atlas";
import { civilizationCorridorScalePlanQuerySchema, planCivilizationCorridorScaleEvidence } from "./corridor-scale-evidence-plan";
import {
  civilizationInfrastructureKindSchema,
  readOsmInfrastructureEvidence,
  type CivilizationOsmInfrastructureEvidence,
} from "./osm-infrastructure-evidence";
import { CivilizationGeospatialSourceError } from "./usgs-geospatial-evidence";

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();
type Point = z.infer<typeof pointSchema>;
const MAX_RETURNED_PATH_SEGMENTS = 1000;

export const civilizationCorridorScaleNetworkQuerySchema = z.object({
  plan: civilizationCorridorScalePlanQuerySchema,
  startWindowSequence: z.number().int().positive(),
  maxWindows: z.number().int().min(1).max(3).default(2),
  networkKind: civilizationInfrastructureKindSchema,
  maxWaysPerWindow: z.number().int().min(1).max(100).default(100),
  maxSnapKm: z.number().min(0.05).max(5).default(2),
}).strict();

const localSourceSchema = z.object({
  windowSequence: z.number().int().positive(),
  status: z.enum(["available", "unavailable"]),
  sourceUrl: z.string().url().nullable(),
  sourceSnapshotAt: z.string().datetime({ offset: true }).nullable(),
  fetchedAt: z.string().datetime({ offset: true }).nullable(),
  mappedWays: z.number().int().nonnegative().nullable(),
  possiblyTruncated: z.boolean().nullable(),
  errorCode: z.string().nullable(),
}).strict();

export const civilizationCorridorScaleNetworkOutputSchema = z.object({
  schemaVersion: z.literal("civilization_corridor_scale_network_topology/v4"),
  query: civilizationCorridorScaleNetworkQuerySchema,
  sourceWindows: z.array(localSourceSchema).min(1).max(3),
  coverage: z.object({
    selectedWindowCount: z.number().int().min(1).max(3),
    plannedWindowCount: z.number().int().positive(),
    unplannedWindowCount: z.number().int().nonnegative(),
    otherPlannedWindowsNotReadInThisRequest: z.number().int().nonnegative(),
    graphWays: z.number().int().nonnegative(),
    graphNodes: z.number().int().nonnegative(),
    graphSegments: z.number().int().nonnegative(),
    excludedWayCount: z.number().int().nonnegative(),
    conflictingWayCount: z.number().int().nonnegative(),
    conflictingNodeCount: z.number().int().nonnegative(),
    graphSegmentLimitReached: z.boolean(),
    possiblyTruncated: z.boolean(),
    missingEvidence: z.array(z.string()),
  }).strict(),
  route: z.discriminatedUnion("status", [
    z.object({ status: z.literal("mapped_topology_candidate"),
      snappedOriginNodeRef: z.string(), snappedDestinationNodeRef: z.string(),
      originSnapDistanceKm: z.number().nonnegative(), destinationSnapDistanceKm: z.number().nonnegative(),
      mappedLengthKm: z.number().nonnegative(), mappedSegmentCount: z.number().int().positive(),
      mappedWayRecordUrls: z.array(z.string().url()).max(300),
      mappedWayRecordUrlCount: z.number().int().positive(),
      mappedWayRecordUrlsOmitted: z.number().int().nonnegative(),
      pathSha256: z.string().regex(/^[a-f0-9]{64}$/),
      pathGeometry: z.discriminatedUnion("status", [
        z.object({ status: z.literal("complete"), segments: z.array(z.object({
          fromNodeRef: z.string(), toNodeRef: z.string(), from: pointSchema, to: pointSchema,
          sourceRecordUrl: z.string().url(), windowSequence: z.number().int().positive(),
        }).strict()).min(1).max(MAX_RETURNED_PATH_SEGMENTS), segmentCount: z.number().int().positive() }).strict(),
        z.object({ status: z.literal("exceeds_response_limit"), segments: z.tuple([]),
          segmentCount: z.number().int().min(MAX_RETURNED_PATH_SEGMENTS + 1),
          responseLimit: z.literal(MAX_RETURNED_PATH_SEGMENTS) }).strict(),
      ]),
      interpretation: z.literal("A directed path exists in the returned OSM-node graph for one selected infrastructure kind. This is mapped topology only; endpoint snaps, asset operation, compatible transfers, product or flow direction, capacity, rights, ecological effects, and permissions are unverified."),
    }).strict(),
    z.object({ status: z.enum(["no_usable_source", "no_endpoint_snap", "no_path_in_considered_graph"]),
      interpretation: z.literal("No mapped path was found in this bounded, possibly incomplete OSM inventory. This does not establish that no real route or constructible alternative exists."),
    }).strict(),
  ]),
  authority: z.object({ assistant_answer: z.literal(false), terminal_eligible: z.literal(false), execution_permission: z.literal(false), policy_finality: z.literal(false) }).strict(),
}).strict();
export type CivilizationCorridorScaleNetworkTopology = z.infer<typeof civilizationCorridorScaleNetworkOutputSchema>;

type Arc = { from: string; to: string; distanceKm: number; sourceRecordUrl: string };
class MinHeap {
  private items: Array<{ priority: number; node: string }> = [];
  push(priority: number, node: string): void {
    const item = { priority, node };
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].priority <= priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop(): { priority: number; node: string } | undefined {
    const first = this.items[0];
    const tail = this.items.pop();
    if (!first || !tail || this.items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.items.length) break;
      const right = left + 1;
      const child = right < this.items.length && this.items[right].priority < this.items[left].priority ? right : left;
      if (this.items[child].priority >= tail.priority) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = tail;
    return first;
  }
  get size(): number { return this.items.length; }
}

function distanceKm(a: Point, b: Point): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const sin = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(sin)));
}

function sameWay(left: CivilizationInfrastructureEdgeV1, right: CivilizationInfrastructureEdgeV1): boolean {
  if (left.nodeRefs.length !== right.nodeRefs.length || left.coordinates.length !== right.coordinates.length ||
      left.sourceEditedAt !== right.sourceEditedAt ||
      JSON.stringify(left.sourceAttributes) !== JSON.stringify(right.sourceAttributes) ||
      JSON.stringify(left.evidenceRefs) !== JSON.stringify(right.evidenceRefs)) return false;
  return left.nodeRefs.every((ref, index) => ref === right.nodeRefs[index] &&
    left.coordinates[index].lat === right.coordinates[index].lat &&
    left.coordinates[index].lon === right.coordinates[index].lon);
}

function inside(point: Point, bbox: readonly number[]): boolean {
  return point.lon >= bbox[0] && point.lon <= bbox[2] && point.lat >= bbox[1] && point.lat <= bbox[3];
}

function shortestPath(adjacency: Map<string, Arc[]>, start: string, target: string): Arc[] | null {
  if (start === target) return null;
  const heap = new MinHeap();
  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, Arc>();
  heap.push(0, start);
  while (heap.size) {
    const current = heap.pop();
    if (!current || current.priority !== distances.get(current.node)) continue;
    if (current.node === target) break;
    for (const arc of adjacency.get(current.node) ?? []) {
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

export async function readCivilizationCorridorScaleNetworkTopology(
  input: unknown,
  infrastructureReader: (query: unknown) => Promise<CivilizationOsmInfrastructureEvidence> = readOsmInfrastructureEvidence,
): Promise<CivilizationCorridorScaleNetworkTopology> {
  const parsed = civilizationCorridorScaleNetworkQuerySchema.safeParse(input);
  if (!parsed.success) throw new CivilizationGeospatialSourceError("invalid_query", "Corridor-scale network query is invalid.");
  const query = parsed.data;
  const plan = planCivilizationCorridorScaleEvidence(query.plan);
  if (query.startWindowSequence > plan.windows.length) {
    throw new CivilizationGeospatialSourceError("invalid_query", "Start window is outside the returned plan budget.");
  }
  const windows = plan.windows.slice(query.startWindowSequence - 1, query.startWindowSequence - 1 + query.maxWindows);
  const sourceWindows: CivilizationCorridorScaleNetworkTopology["sourceWindows"] = [];
  const returned: CivilizationOsmInfrastructureEvidence[] = [];
  for (const window of windows) {
    try {
      const evidence = await infrastructureReader({ bbox: window.bbox, kinds: [query.networkKind], maxWays: query.maxWaysPerWindow });
      returned.push(evidence);
      sourceWindows.push({ windowSequence: window.sequence, status: "available", sourceUrl: evidence.source.sourceUrl,
        sourceSnapshotAt: evidence.source.sourceSnapshotAt, fetchedAt: evidence.source.fetchedAt,
        mappedWays: evidence.coverage.mappedWays, possiblyTruncated: evidence.coverage.possiblyTruncated, errorCode: null });
    } catch (error) {
      sourceWindows.push({ windowSequence: window.sequence, status: "unavailable", sourceUrl: null,
        sourceSnapshotAt: null, fetchedAt: null, mappedWays: null, possiblyTruncated: null,
        errorCode: error instanceof CivilizationGeospatialSourceError ? error.code : "source_unavailable" });
    }
  }
  const edges = new Map<string, CivilizationInfrastructureEdgeV1>();
  const conflictingWays = new Set<string>();
  for (const source of returned) {
    for (const edge of source.atlas.infrastructureEdges ?? []) {
      if (edge.networkKind !== query.networkKind || conflictingWays.has(edge.edgeId)) continue;
      const previous = edges.get(edge.edgeId);
      if (previous && !sameWay(previous, edge)) {
        conflictingWays.add(edge.edgeId);
        edges.delete(edge.edgeId);
      } else if (!previous) edges.set(edge.edgeId, edge);
    }
  }
  const nodePositions = new Map<string, Point>();
  const conflictingNodes = new Set<string>();
  for (const edge of edges.values()) {
    if (edge.nodeRefs.length !== edge.coordinates.length) continue;
    for (let index = 0; index < edge.nodeRefs.length; index++) {
      const ref = edge.nodeRefs[index];
      const point = edge.coordinates[index];
      const prior = nodePositions.get(ref);
      if (prior && (prior.lat !== point.lat || prior.lon !== point.lon)) conflictingNodes.add(ref);
      else nodePositions.set(ref, point);
    }
  }
  const adjacency = new Map<string, Arc[]>();
  const graphNodes = new Map<string, Point>();
  let graphWays = 0;
  let graphSegments = 0;
  let excludedWayCount = 0;
  let graphSegmentLimitReached = false;
  const addArc = (arc: Arc) => {
    const outgoing = adjacency.get(arc.from);
    if (outgoing) outgoing.push(arc);
    else adjacency.set(arc.from, [arc]);
  };
  for (const edge of edges.values()) {
    if (edge.nodeRefs.length !== edge.coordinates.length ||
        ["construction", "disused", "abandoned"].some((key) => edge.sourceAttributes[key] && edge.sourceAttributes[key] !== "no")) {
      excludedWayCount++;
      continue;
    }
    let used = false;
    const roadDirection = edge.networkKind === "road" ? edge.sourceAttributes.oneway?.toLowerCase() : undefined;
    const forwardAllowed = roadDirection !== "-1";
    const reverseAllowed = !["yes", "true", "1"].includes(roadDirection ?? "");
    for (let index = 0; index < edge.nodeRefs.length - 1; index++) {
      const fromPoint = edge.coordinates[index];
      const toPoint = edge.coordinates[index + 1];
      if (!windows.some((window) => inside(fromPoint, window.bbox) && inside(toPoint, window.bbox))) continue;
      const from = edge.nodeRefs[index];
      const to = edge.nodeRefs[index + 1];
      if (from === to || conflictingNodes.has(from) || conflictingNodes.has(to)) continue;
      if (graphSegments >= 150_000) { graphSegmentLimitReached = true; break; }
      const length = distanceKm(fromPoint, toPoint);
      graphNodes.set(from, fromPoint);
      graphNodes.set(to, toPoint);
      if (forwardAllowed) addArc({ from, to, distanceKm: length, sourceRecordUrl: edge.sourceRecordUrl });
      if (reverseAllowed) addArc({ from: to, to: from, distanceKm: length, sourceRecordUrl: edge.sourceRecordUrl });
      graphSegments++;
      used = true;
    }
    if (used) graphWays++;
    if (graphSegmentLimitReached) break;
  }
  const snap = (point: Point) => [...graphNodes.entries()].map(([ref, node]) => ({ ref, distanceKm: distanceKm(point, node) }))
    .filter((entry) => entry.distanceKm <= query.maxSnapKm)
    .sort((left, right) => left.distanceKm - right.distanceKm || left.ref.localeCompare(right.ref)).slice(0, 2);
  const originSnaps = snap(windows[0].from);
  const destinationSnaps = snap(windows[windows.length - 1].to);
  let best: { path: Arc[]; origin: typeof originSnaps[number]; destination: typeof destinationSnaps[number]; totalKm: number } | null = null;
  for (const origin of originSnaps) for (const destination of destinationSnaps) {
    const path = shortestPath(adjacency, origin.ref, destination.ref);
    if (!path) continue;
    const totalKm = path.reduce((sum, arc) => sum + arc.distanceKm, origin.distanceKm + destination.distanceKm);
    if (!best || totalKm < best.totalKm) best = { path, origin, destination, totalKm };
  }
  const mappedWayRecordUrls = best ? [...new Set(best.path.map((arc) => arc.sourceRecordUrl))] : [];
  const pathSha256 = best ? createHash("sha256").update(JSON.stringify(best.path.map((arc) => [
    arc.from, arc.to, arc.sourceRecordUrl, graphNodes.get(arc.from), graphNodes.get(arc.to),
  ]))).digest("hex") : null;
  const citationsOmitted = mappedWayRecordUrls.length > 300;
  const pathGeometryOmitted = !!best && best.path.length > MAX_RETURNED_PATH_SEGMENTS;
  const possiblyTruncated = citationsOmitted || pathGeometryOmitted || graphSegmentLimitReached || conflictingWays.size > 0 ||
    conflictingNodes.size > 0 || excludedWayCount > 0 || sourceWindows.some((source) =>
    source.status === "unavailable" || source.possiblyTruncated === true);
  const missingEvidence = [
    "OSM inventory and window budgets do not prove complete mapped or real-world infrastructure coverage.",
    "Only the selected infrastructure kind is searched; mode transfers and compatibility are not established.",
    "Road one-way tags constrain graph direction; non-road flow direction, service, capacity, access, and product compatibility remain unverified.",
    "The first and last sketch points are snapped to nearby OSM nodes, not verified entrances, terminals, or connection rights.",
    "Graph segments are retained only when both OSM nodes lie inside one selected local window; long boundary-spanning segments may be omitted.",
    "Source snapshot times may differ across windows, and the evaluation date does not establish feature validity at that time.",
    "Other planned windows and affected lands, waters, communities, governments, finance, and construction conditions require separate review.",
    ...(graphSegmentLimitReached || sourceWindows.some((source) => source.status === "unavailable" || source.possiblyTruncated === true)
      ? ["Some source reads or the graph segment budget were incomplete; no-path results cannot rule out a mapped connection."] : []),
    ...(citationsOmitted ? ["The summary way-link list is capped; use complete path geometry for every segment citation, or obtain a smaller path window when geometry is over limit."] : []),
    ...(pathGeometryOmitted ? ["The path geometry exceeds the response cap; no partial node sequence is supplied for geographic contact screening."] : []),
  ];
  const pathGeometry = best && !pathGeometryOmitted ? {
    status: "complete" as const,
    segments: best.path.map((arc) => ({
      fromNodeRef: arc.from, toNodeRef: arc.to,
      from: graphNodes.get(arc.from)!, to: graphNodes.get(arc.to)!,
      sourceRecordUrl: arc.sourceRecordUrl,
      windowSequence: windows.find((window) => inside(graphNodes.get(arc.from)!, window.bbox) &&
        inside(graphNodes.get(arc.to)!, window.bbox))!.sequence,
    })),
    segmentCount: best.path.length,
  } : best ? { status: "exceeds_response_limit" as const, segments: [] as [],
    segmentCount: best.path.length, responseLimit: MAX_RETURNED_PATH_SEGMENTS as typeof MAX_RETURNED_PATH_SEGMENTS } : null;
  return {
    schemaVersion: "civilization_corridor_scale_network_topology/v4",
    query,
    sourceWindows,
    coverage: {
      selectedWindowCount: windows.length, plannedWindowCount: plan.windows.length,
      unplannedWindowCount: plan.coverage.unplannedWindowCount,
      otherPlannedWindowsNotReadInThisRequest: plan.windows.length - windows.length,
      graphWays, graphNodes: graphNodes.size, graphSegments, excludedWayCount,
      conflictingWayCount: conflictingWays.size, conflictingNodeCount: conflictingNodes.size,
      graphSegmentLimitReached, possiblyTruncated, missingEvidence,
    },
    route: best ? {
      status: "mapped_topology_candidate",
      snappedOriginNodeRef: best.origin.ref, snappedDestinationNodeRef: best.destination.ref,
      originSnapDistanceKm: best.origin.distanceKm, destinationSnapDistanceKm: best.destination.distanceKm,
      mappedLengthKm: best.path.reduce((sum, arc) => sum + arc.distanceKm, 0),
      mappedSegmentCount: best.path.length, mappedWayRecordUrls: mappedWayRecordUrls.slice(0, 300),
      mappedWayRecordUrlCount: mappedWayRecordUrls.length,
      mappedWayRecordUrlsOmitted: Math.max(0, mappedWayRecordUrls.length - 300),
      pathSha256: pathSha256!,
      pathGeometry: pathGeometry!,
      interpretation: "A directed path exists in the returned OSM-node graph for one selected infrastructure kind. This is mapped topology only; endpoint snaps, asset operation, compatible transfers, product or flow direction, capacity, rights, ecological effects, and permissions are unverified.",
    } : {
      status: !returned.length ? "no_usable_source" : !originSnaps.length || !destinationSnaps.length ? "no_endpoint_snap" : "no_path_in_considered_graph",
      interpretation: "No mapped path was found in this bounded, possibly incomplete OSM inventory. This does not establish that no real route or constructible alternative exists.",
    },
    authority: { assistant_answer: false, terminal_eligible: false, execution_permission: false, policy_finality: false },
  };
}
