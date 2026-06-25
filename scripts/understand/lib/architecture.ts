/**
 * understand/lib/architecture.ts — model-free architecture skeleton (Goal G9,
 * architecture half).
 *
 * Computes, DETERMINISTICALLY from the FROZEN KnowledgeGraph, the structural
 * "skeleton" of a codebase that an LLM can LATER narrate (the narration is NOT
 * built here — this module emits only the computed, byte-identical skeleton):
 *   - languages   — file count per detected language (from file-node `language`).
 *   - entryPoints — program entry functions (main/__main__ heuristic ∪ supplied).
 *   - hotspots    — degree-ranked symbols (fan-in + fan-out over `calls` edges).
 *   - clusters    — community clustering over `calls` edges via DETERMINISTIC
 *                   label propagation; each cluster is a candidate module.
 *   - routes      — `endpoint` nodes + `routes` edges, when present (else empty).
 *
 * SELF-CONTAINED (parallel-safety scope guard): this module implements its OWN
 * undirected scan + label propagation over `calls` edges. It deliberately does
 * NOT import the in-flight sibling modules (`./graph-query`, `./structural`,
 * `./resolve-calls*`, `./impact`, `./similarity`) — only the FROZEN type
 * contract from `./schema`. The in-process JSON scan is the source of truth: no
 * SQLite, no model, no network (proven by the import-closure test). No optional
 * SQLite projection is added by this lane (scope: lib/architecture.ts + CLI +
 * test only), so the in-process path is the only path and is identical by
 * construction across `index: off|on`.
 *
 * EVIDENCE, NOT INSTRUCTIONS: every emitted evidence node (hotspot, entry point,
 * route endpoint) carries its `file:line` `source_refs` (path#Lx-Ly), FILTERED
 * to keep only well-formed line anchors; a node retaining ≥1 line anchor is
 * tagged `tier: "trusted"`, a node with no line provenance is DOWN-TIERED to
 * `tier: "untrusted"` (kept so the structure stays intact, never asserted as a
 * grounded fact). Results are facts a caller splices in, never a directive.
 *
 * DETERMINISM (byte-identical across runs / reversed input): every list is
 * sorted by a FULL stable key. Clustering is seeded (each node starts labelled
 * by its own id), processed in sorted id order, ties broken by the smallest
 * label id — so the same graph always yields byte-identical clusters regardless
 * of node/edge array order. A cluster's canonical id is the smallest member id.
 *
 * ── Node-id convention (LOCKED, codebase-understanding.md §"KnowledgeGraph") ──
 *   file:<relpath>                          (no name segment)
 *   function:<relpath>:<name>               (free function — name has no ".")
 *   function:<relpath>:<Class>.<method>     (method — name contains ".")
 *   class:<relpath>:<Class>
 *
 * ── Clustering scope (documented, EXPLICITLY SCOPED) ──
 *   Communities are detected over the UNDIRECTED graph induced by `calls` edges,
 *   restricted to nodes that PARTICIPATE in at least one `calls` edge (both
 *   endpoints present in the graph). A symbol with no `calls` edge (e.g. a dead
 *   helper) is NOT part of any module's call structure and is therefore EXCLUDED
 *   from clustering — it is not assigned a spurious singleton cluster. Two
 *   call-disconnected modules thus yield exactly two clusters; bridging them with
 *   a call edge collapses them to one (the anti-vacuity gate).
 *
 * ── Entry-point rule (documented; the graph carries no `exported` flag) ──
 *   A `function` node is an entry point iff (a) its simple name is a conventional
 *   program entry name (`main`/`__main__`), OR (b) it is named in the caller-
 *   supplied entry set (by node id OR simple name). The structural layer records
 *   no export/visibility, so a fuller "exported public surface" set must be
 *   supplied by the caller via `ArchitectureOptions.entryPoints`.
 */

import type { GraphNode, GraphEdge } from "./schema";

export type { GraphNode, GraphEdge } from "./schema";

/**
 * Trusted-tier evidence marker. Skeleton facts are read from
 * knowledge-graph.json with file:line provenance — EVIDENCE, never instructions.
 */
export const EVIDENCE_TIER = "trusted" as const;

/** Per-node trust tier (see header — provenance enforcement). */
export type EvidenceTier = "trusted" | "untrusted";

/** Conventional program entry-point simple names. */
export const ENTRY_POINT_NAMES = new Set<string>(["main", "__main__"]);

/** Default cap on the number of degree-ranked hotspots returned. */
export const DEFAULT_TOP_HOTSPOTS = 20;

/** Default hard iteration cap for label propagation (also bounded per-call). */
export const DEFAULT_MAX_ITERATIONS = 100;

/** Matches a well-formed `path#Lx-Ly` line anchor (the only provenance we trust). */
const LINE_REF_RE = /#L\d+-L\d+$/;

/** Keep only well-formed `#Lx-Ly` line anchors; drop empty / non-line refs. */
function lineRefs(refs: unknown): string[] {
  return Array.isArray(refs)
    ? refs.filter((r): r is string => typeof r === "string" && LINE_REF_RE.test(r))
    : [];
}

/** The two structural views this module reads. */
export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** A single evidence node: identity + file:line provenance + trust tier. */
export interface EvidenceNode {
  id: string;
  type: string;
  name: string;
  /** `#Lx-Ly` line anchors ONLY (non-line / empty refs filtered out). */
  source_refs: string[];
  /** "trusted" iff at least one `#Lx-Ly` anchor survives; else "untrusted". */
  tier: EvidenceTier;
}

/** A degree-ranked hotspot symbol (fan-in + fan-out over `calls`). */
export interface HotspotNode extends EvidenceNode {
  /** # of DISTINCT callers (inbound `calls` sources). */
  fanIn: number;
  /** # of DISTINCT callees (outbound `calls` targets). */
  fanOut: number;
  /** fanIn + fanOut — the ranking key (desc), id ascending on ties. */
  degree: number;
}

/** A detected community over `calls` edges — a candidate module. */
export interface Cluster {
  /** Canonical id = the lexicographically smallest member node id. */
  id: string;
  /** Member node ids, sorted. */
  members: string[];
  /** members.length. */
  size: number;
}

/** A traversed `routes` edge (route → handler), when present. */
export interface RouteEdge {
  source: string;
  target: string;
  type: "routes";
}

/** Per-language file count. */
export interface LanguageStat {
  language: string;
  files: number;
}

/** The computed, deterministic architecture skeleton (LLM narrates it later). */
export interface ArchitectureSkeleton {
  tier: typeof EVIDENCE_TIER;
  /** file count per language, sorted by count desc then language asc. */
  languages: LanguageStat[];
  /** program entry-point functions, sorted by id. */
  entryPoints: EvidenceNode[];
  /** top degree-ranked symbols, sorted by degree desc then id asc (capped). */
  hotspots: HotspotNode[];
  /** community clusters over `calls`, sorted by cluster id. */
  clusters: Cluster[];
  /** route surface, when present (else both empty). */
  routes: { endpoints: EvidenceNode[]; edges: RouteEdge[] };
  /** structural roll-up counts. */
  summary: {
    fileCount: number;
    functionCount: number;
    classCount: number;
    callEdgeCount: number;
    clusterCount: number;
  };
}

/** Options for {@link computeArchitecture}. */
export interface ArchitectureOptions {
  /**
   * Cap on the number of degree-ranked hotspots returned. Must be a finite
   * non-negative integer; defaults to {@link DEFAULT_TOP_HOTSPOTS}.
   */
  topHotspots?: number;
  /**
   * Exported / public surface + real entry points, matched by node id OR simple
   * name; folded into the entry-point set alongside the `main`/`__main__`
   * heuristic.
   */
  entryPoints?: Iterable<string>;
  /**
   * Hard cap on label-propagation iterations. Must be a finite positive integer;
   * defaults to {@link DEFAULT_MAX_ITERATIONS}.
   */
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Id helpers
// ---------------------------------------------------------------------------

/** The trailing name segment of a node id, or "" for file ids. */
export function simpleName(id: string): string {
  const parts = id.split(":");
  return parts.length > 2 ? parts.slice(2).join(":") : "";
}

/** Conventional entry point — a `function` whose simple name is in ENTRY_POINT_NAMES. */
export function isEntryPointNode(node: GraphNode): boolean {
  return node.type === "function" && ENTRY_POINT_NAMES.has(simpleName(node.id));
}

/** A free (module-level) function — type "function" whose name has no ".". */
function isFreeFunction(node: GraphNode): boolean {
  return node.type === "function" && !simpleName(node.id).includes(".");
}

// ---------------------------------------------------------------------------
// Input validation (numeric bounds — checklist: validate k/iterations)
// ---------------------------------------------------------------------------

/** A finite non-negative integer (for `topHotspots`). */
function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** A finite positive integer (for `maxIterations`). */
function isPosInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

// ---------------------------------------------------------------------------
// Evidence projection (provenance filter + tier)
// ---------------------------------------------------------------------------

function toEvidence(node: GraphNode): EvidenceNode {
  const refs = lineRefs(node.source_refs);
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    source_refs: refs,
    tier: refs.length > 0 ? "trusted" : "untrusted",
  };
}

const byIdAsc = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * File count per language, read from each `file` node's `language` field
 * (absent/non-string → "unknown"). Sorted by count DESC, then language ASC —
 * a total order, so the output is byte-identical regardless of input order.
 */
function computeLanguages(nodes: GraphNode[]): LanguageStat[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.type !== "file") continue;
    const lang = (n as unknown as Record<string, unknown>).language;
    const key = typeof lang === "string" && lang.length > 0 ? lang : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || (a.language < b.language ? -1 : a.language > b.language ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Degree adjacency over `calls` edges (distinct caller/callee sets)
// ---------------------------------------------------------------------------

interface CallsDegree {
  /** callee id → distinct caller ids (fan-in). */
  callers: Map<string, Set<string>>;
  /** caller id → distinct callee ids (fan-out). */
  callees: Map<string, Set<string>>;
  /** undirected neighbour sets over `calls` (for clustering). */
  undirected: Map<string, Set<string>>;
  /** count of `calls` edges with both endpoints present. */
  callEdgeCount: number;
}

function addTo(m: Map<string, Set<string>>, k: string, v: string): void {
  const s = m.get(k);
  if (s) s.add(v);
  else m.set(k, new Set([v]));
}

function buildCallsDegree(nodes: GraphNode[], edges: GraphEdge[]): CallsDegree {
  const ids = new Set(nodes.map((n) => n.id));
  const callers = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();
  const undirected = new Map<string, Set<string>>();
  let callEdgeCount = 0;
  for (const e of edges) {
    if (e.type !== "calls") continue;
    if (typeof e.source !== "string" || typeof e.target !== "string") continue;
    // Only edges whose BOTH endpoints exist as nodes — no phantom membership.
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    callEdgeCount++;
    addTo(callees, e.source, e.target);
    addTo(callers, e.target, e.source);
    if (e.source !== e.target) {
      addTo(undirected, e.source, e.target);
      addTo(undirected, e.target, e.source);
    }
  }
  return { callers, callees, undirected, callEdgeCount };
}

// ---------------------------------------------------------------------------
// Hotspots — degree-ranked symbols
// ---------------------------------------------------------------------------

function computeHotspots(
  nodes: GraphNode[],
  deg: CallsDegree,
  k: number,
): HotspotNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  // Every node that participates in at least one `calls` edge (degree > 0).
  const participants = new Set<string>([...deg.callers.keys(), ...deg.callees.keys()]);
  const ranked: HotspotNode[] = [];
  for (const id of participants) {
    const node = byId.get(id);
    if (!node) continue;
    const fanIn = deg.callers.get(id)?.size ?? 0;
    const fanOut = deg.callees.get(id)?.size ?? 0;
    const ev = toEvidence(node);
    ranked.push({ ...ev, fanIn, fanOut, degree: fanIn + fanOut });
  }
  // Rank by degree DESC, then id ASC (a total order → deterministic). Slice top k.
  ranked.sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ranked.slice(0, k);
}

// ---------------------------------------------------------------------------
// Clustering — deterministic, seeded label propagation over `calls` (undirected)
// ---------------------------------------------------------------------------

/**
 * Deterministic synchronous-per-node label propagation:
 *   - seed: every participating node is labelled by its own id.
 *   - each pass, in sorted node-id order, a node adopts the MOST FREQUENT label
 *     among {itself ∪ its neighbours}; ties broken by the SMALLEST label id.
 *   - including the node's own label damps the bipartite oscillation that breaks
 *     naive synchronous LPA, so disconnected components converge to one label
 *     each (and a bridged graph collapses to one).
 *   - repeat until a pass makes no change, or `maxIter` is hit.
 * Order-independent: neighbour SETS and the smallest-label tie-break do not
 * depend on edge/node array order, and nodes are visited in sorted id order.
 */
function detectClusters(deg: CallsDegree, maxIter: number): Cluster[] {
  const nodes = [...deg.undirected.keys()].sort();
  if (nodes.length === 0) return [];

  const label = new Map<string, string>();
  for (const n of nodes) label.set(n, n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const n of nodes) {
      const counts = new Map<string, number>();
      const own = label.get(n)!;
      counts.set(own, 1);
      for (const nb of deg.undirected.get(n)!) {
        const l = label.get(nb)!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      // Most frequent label; tie → smallest label id (total order, order-free).
      let best = own;
      let bestCount = -1;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l < best)) {
          best = l;
          bestCount = c;
        }
      }
      if (best !== own) {
        label.set(n, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group members by final label, then re-key each cluster to its smallest member.
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const l = label.get(n)!;
    const arr = groups.get(l);
    if (arr) arr.push(n);
    else groups.set(l, [n]);
  }
  const clusters: Cluster[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort();
    clusters.push({ id: sorted[0], members: sorted, size: sorted.length });
  }
  clusters.sort(byIdAsc);
  return clusters;
}

// ---------------------------------------------------------------------------
// Entry points + routes
// ---------------------------------------------------------------------------

function computeEntryPoints(nodes: GraphNode[], supplied: Set<string>): EvidenceNode[] {
  const out: EvidenceNode[] = [];
  for (const n of nodes) {
    if (n.type !== "function") continue;
    if (isEntryPointNode(n) || supplied.has(n.id) || supplied.has(simpleName(n.id))) {
      out.push(toEvidence(n));
    }
  }
  out.sort(byIdAsc);
  return out;
}

/** `routes` edge full stable key (NUL-free composite via JSON.stringify). */
function routeEdgeKey(e: RouteEdge): string {
  return JSON.stringify([e.source, e.target, e.type]);
}

function computeRoutes(nodes: GraphNode[], edges: GraphEdge[]): {
  endpoints: EvidenceNode[];
  edges: RouteEdge[];
} {
  const ids = new Set(nodes.map((n) => n.id));
  const endpoints = nodes
    .filter((n) => n.type === "endpoint")
    .map(toEvidence)
    .sort(byIdAsc);

  const seen = new Set<string>();
  const routeEdges: RouteEdge[] = [];
  for (const e of edges) {
    if (e.type !== "routes") continue;
    if (typeof e.source !== "string" || typeof e.target !== "string") continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const re: RouteEdge = { source: e.source, target: e.target, type: "routes" };
    const key = routeEdgeKey(re);
    if (seen.has(key)) continue;
    seen.add(key);
    routeEdges.push(re);
  }
  routeEdges.sort((a, b) => {
    const ka = routeEdgeKey(a);
    const kb = routeEdgeKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { endpoints, edges: routeEdges };
}

// ---------------------------------------------------------------------------
// computeArchitecture — the deterministic skeleton (pure, in-process)
// ---------------------------------------------------------------------------

/**
 * Compute the model-free architecture skeleton of a graph. Pure, deterministic,
 * in-process: no SQLite, no model, no network. The LLM narration layer (not
 * built here) is the only non-deterministic part.
 *
 * @throws RangeError if `topHotspots`/`maxIterations` are out of range — an
 *   invalid `k` must never silently emit unbounded/empty output.
 */
export function computeArchitecture(
  graph: GraphView,
  opts: ArchitectureOptions = {},
): ArchitectureSkeleton {
  // ── Validate numeric inputs BEFORE use (checklist: bounded k/iterations) ──
  const k = opts.topHotspots ?? DEFAULT_TOP_HOTSPOTS;
  if (!isNonNegInt(k)) {
    throw new RangeError(`topHotspots must be a finite non-negative integer, got ${String(opts.topHotspots)}`);
  }
  const maxIter = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!isPosInt(maxIter)) {
    throw new RangeError(`maxIterations must be a finite positive integer, got ${String(opts.maxIterations)}`);
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  const deg = buildCallsDegree(nodes, edges);
  const supplied = new Set<string>();
  for (const e of opts.entryPoints ?? []) {
    if (typeof e === "string" && e.length > 0) supplied.add(e);
  }

  const languages = computeLanguages(nodes);
  const entryPoints = computeEntryPoints(nodes, supplied);
  const hotspots = computeHotspots(nodes, deg, k);
  const clusters = detectClusters(deg, maxIter);
  const routes = computeRoutes(nodes, edges);

  let fileCount = 0;
  let functionCount = 0;
  let classCount = 0;
  for (const n of nodes) {
    if (n.type === "file") fileCount++;
    else if (n.type === "function" && isFreeFunction(n)) functionCount++;
    else if (n.type === "class") classCount++;
  }

  return {
    tier: EVIDENCE_TIER,
    languages,
    entryPoints,
    hotspots,
    clusters,
    routes,
    summary: {
      fileCount,
      functionCount,
      classCount,
      callEdgeCount: deg.callEdgeCount,
      clusterCount: clusters.length,
    },
  };
}
