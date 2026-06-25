/**
 * understand/lib/graph-query.ts — model-free structural query library (Goal G3).
 *
 * Deterministic, in-process BFS/scan over the FROZEN KnowledgeGraph
 * (`.guild/indexes/knowledge-graph.json`). This module is the SOURCE OF TRUTH:
 * no SQLite, no model, no network. The optional SQLite projection (T5.1) is a
 * transparent accelerator that MUST return identical results — never consulted
 * here.
 *
 * Three queries, all reading G1/G2 structural facts:
 *   - kgTrace(name|id, direction, depth) — depth-bounded BFS over `calls` edges.
 *   - kgNeighbors(node, hops)            — N-hop neighbourhood over ALL edges.
 *   - kgDeadCode()                       — free functions w/ zero inbound calls
 *                                          minus entry points.
 *
 * EVIDENCE, NOT INSTRUCTIONS: every result node carries its `file:line`
 * `source_refs` (path#Lx-Ly) copied verbatim from the graph and is tagged
 * `tier: "trusted"`. Callers splice these as grounded facts; they are never a
 * directive to execute.
 *
 * DETERMINISM: every traversal sorts its frontier by node id, so the same graph
 * always yields byte-identical output regardless of node/edge array order.
 *
 * ── Node-id convention (LOCKED, codebase-understanding.md §"KnowledgeGraph") ──
 *   file:<relpath>                          (no name segment)
 *   function:<relpath>:<name>               (free function — name has no ".")
 *   function:<relpath>:<Class>.<method>     (method — name contains ".")
 *   class:<relpath>:<Class>
 *
 * ── Entry-point rule (documented; the graph carries no `exported` flag) ──
 *   A `function` node is an entry point iff its simple name is a conventional
 *   program entry name (`main`, `__main__`). This is a deterministic name
 *   heuristic — the structural layer (G1) does not record export/visibility, so
 *   an "exported + zero-inbound" rule is not yet computable. Centralised in
 *   ENTRY_POINT_NAMES so callers can extend it.
 *
 * ── Dead-code rule (documented) ──
 *   Dead code = FREE (module-level) functions with zero inbound `calls` edges,
 *   minus entry points. METHODS (`<Class>.<method>`) are deliberately excluded:
 *   method reachability needs type/dispatch analysis (a method may be reached
 *   via an interface, override, or reflection) beyond G3's model-free scope.
 *   Flagging a zero-inbound method as dead would be a false positive.
 */

import type { GraphNode, GraphEdge } from "./schema";

export type { GraphNode, GraphEdge } from "./schema";

/** Trace/neighbour direction (callee-ward, caller-ward, or both). */
export type Direction = "inbound" | "outbound" | "both";

/**
 * Trusted-tier evidence marker. Query results are deterministic facts read from
 * knowledge-graph.json with file:line provenance — they are EVIDENCE, never
 * instructions to follow.
 */
export const EVIDENCE_TIER = "trusted" as const;

/** Conventional program entry-point simple names (see header). */
export const ENTRY_POINT_NAMES = new Set<string>(["main", "__main__"]);

/** The two structural views this library reads. */
export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** A single result node: identity + file:line provenance + hop depth. */
export interface EvidenceNode {
  id: string;
  type: string;
  name: string;
  /** path#Lx-Ly provenance copied from the graph node (may be []). */
  source_refs: string[];
  /** hop distance from the query seed (0 = seed). */
  depth: number;
}

/** A traversed `calls` edge, with its resolution confidence when present. */
export interface TraceEdge {
  source: string;
  target: string;
  type: "calls";
  confidence?: string;
}

export interface TraceResult {
  tier: typeof EVIDENCE_TIER;
  /** the resolved seed node id(s) the BFS started from (sorted). */
  seeds: string[];
  direction: Direction;
  /** depth bound applied. */
  depth: number;
  /** all reachable nodes within the bound, seeds at depth 0 (sorted). */
  nodes: EvidenceNode[];
  /** the call edges actually traversed (sorted). */
  edges: TraceEdge[];
}

export interface NeighborsResult {
  tier: typeof EVIDENCE_TIER;
  seeds: string[];
  hops: number;
  /** distinct nodes within `hops` of a seed, EXCLUDING the seed(s) (sorted). */
  nodes: EvidenceNode[];
}

export interface DeadCodeResult {
  tier: typeof EVIDENCE_TIER;
  /** free functions with zero inbound calls, minus entry points (sorted by id). */
  nodes: EvidenceNode[];
}

// ---------------------------------------------------------------------------
// Id helpers
// ---------------------------------------------------------------------------

/** The trailing name segment of a node id, or "" for file ids. */
export function simpleName(id: string): string {
  const parts = id.split(":");
  return parts.length > 2 ? parts.slice(2).join(":") : "";
}

/** A free (module-level) function — type "function" whose name has no ".". */
function isFreeFunction(node: GraphNode): boolean {
  return node.type === "function" && !simpleName(node.id).includes(".");
}

/** Conventional entry point — a function whose simple name is in ENTRY_POINT_NAMES. */
export function isEntryPoint(node: GraphNode): boolean {
  return node.type === "function" && ENTRY_POINT_NAMES.has(simpleName(node.id));
}

// ---------------------------------------------------------------------------
// Adjacency — built once per query (calls-only + undirected-all)
// ---------------------------------------------------------------------------

interface CallsAdjacency {
  /** caller id → traversed edges to callees. */
  out: Map<string, TraceEdge[]>;
  /** callee id → traversed edges from callers. */
  in: Map<string, TraceEdge[]>;
}

function pushMap<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function buildCallsAdjacency(edges: GraphEdge[]): CallsAdjacency {
  const out = new Map<string, TraceEdge[]>();
  const inn = new Map<string, TraceEdge[]>();
  for (const e of edges) {
    if (e.type !== "calls") continue;
    const te: TraceEdge = {
      source: e.source,
      target: e.target,
      type: "calls",
      ...(typeof e.confidence === "string" ? { confidence: e.confidence } : {}),
    };
    pushMap(out, e.source, te);
    pushMap(inn, e.target, te);
  }
  return { out, in: inn };
}

/** Undirected adjacency over ALL edge types (for neighbourhoods). */
function buildUndirectedAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adj.get(a);
    if (set) set.add(b);
    else adj.set(a, new Set([b]));
  };
  for (const e of edges) {
    if (typeof e.source !== "string" || typeof e.target !== "string") continue;
    link(e.source, e.target);
    link(e.target, e.source);
  }
  return adj;
}

// ---------------------------------------------------------------------------
// Seed resolution (name | id)
// ---------------------------------------------------------------------------

/**
 * Resolve a `name | id` query to concrete graph node ids.
 *   - exact id match → that single id.
 *   - else every node whose simple name OR display name equals the query.
 * Returns a sorted, de-duplicated list (deterministic, multi-root tolerant).
 */
export function resolveSeeds(graph: GraphView, query: string): string[] {
  const byId = new Set(graph.nodes.map((n) => n.id));
  if (byId.has(query)) return [query];
  const hits = new Set<string>();
  for (const n of graph.nodes) {
    if (simpleName(n.id) === query || n.name === query) hits.add(n.id);
  }
  return [...hits].sort();
}

function toEvidence(node: GraphNode, depth: number): EvidenceNode {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    source_refs: Array.isArray(node.source_refs) ? node.source_refs : [],
    depth,
  };
}

// ---------------------------------------------------------------------------
// kgTrace — depth-bounded BFS over `calls` edges
// ---------------------------------------------------------------------------

/**
 * BFS the call graph from `query` up to `depth` hops.
 *   direction "outbound" → follow callees;
 *   direction "inbound"  → follow callers;
 *   direction "both"     → union.
 * The depth bound is HARD: no node beyond `depth` hops is returned, and no edge
 * leaving a depth-`depth` node is traversed.
 */
export function kgTrace(
  graph: GraphView,
  query: string,
  direction: Direction = "outbound",
  depth = 3,
): TraceResult {
  const bound = Math.max(0, Math.floor(depth));
  const seeds = resolveSeeds(graph, query);
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const adj = buildCallsAdjacency(graph.edges);

  const depthOf = new Map<string, number>();
  const edgeKeys = new Set<string>();
  const tracedEdges: TraceEdge[] = [];

  // Seeds at depth 0 (only those that exist as nodes).
  let frontier: string[] = [];
  for (const s of seeds) {
    if (byId.has(s) && !depthOf.has(s)) {
      depthOf.set(s, 0);
      frontier.push(s);
    }
  }

  for (let d = 0; d < bound; d++) {
    const next: string[] = [];
    for (const cur of [...frontier].sort()) {
      const outgoing: TraceEdge[] = [];
      if (direction === "outbound" || direction === "both") outgoing.push(...(adj.out.get(cur) ?? []));
      if (direction === "inbound" || direction === "both") outgoing.push(...(adj.in.get(cur) ?? []));
      // Deterministic neighbour order.
      outgoing.sort((a, b) => {
        const ka = `${a.source}->${a.target}`;
        const kb = `${b.source}->${b.target}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      for (const e of outgoing) {
        const neighbour = e.source === cur ? e.target : e.source;
        const ek = `${e.source}->${e.target}`;
        if (!edgeKeys.has(ek)) {
          edgeKeys.add(ek);
          tracedEdges.push(e);
        }
        if (!depthOf.has(neighbour) && byId.has(neighbour)) {
          depthOf.set(neighbour, d + 1);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }

  const nodes = [...depthOf.entries()]
    .map(([id, dep]) => toEvidence(byId.get(id)!, dep))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  tracedEdges.sort((a, b) => {
    const ka = `${a.source}->${a.target}`;
    const kb = `${b.source}->${b.target}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { tier: EVIDENCE_TIER, seeds, direction, depth: bound, nodes, edges: tracedEdges };
}

// ---------------------------------------------------------------------------
// kgNeighbors — N-hop undirected neighbourhood over ALL edges
// ---------------------------------------------------------------------------

/**
 * All distinct nodes within `hops` of `query`, over edges of ANY type
 * (undirected). The seed node(s) themselves are excluded from the result.
 */
export function kgNeighbors(graph: GraphView, query: string, hops = 1): NeighborsResult {
  const bound = Math.max(0, Math.floor(hops));
  const seeds = resolveSeeds(graph, query);
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const adj = buildUndirectedAdjacency(graph.edges);

  const depthOf = new Map<string, number>();
  let frontier: string[] = [];
  for (const s of seeds) {
    if (byId.has(s) && !depthOf.has(s)) {
      depthOf.set(s, 0);
      frontier.push(s);
    }
  }

  for (let d = 0; d < bound; d++) {
    const next: string[] = [];
    for (const cur of [...frontier].sort()) {
      const neighbours = [...(adj.get(cur) ?? [])].sort();
      for (const nb of neighbours) {
        if (!depthOf.has(nb) && byId.has(nb)) {
          depthOf.set(nb, d + 1);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }

  const seedSet = new Set(seeds);
  const nodes = [...depthOf.entries()]
    .filter(([id]) => !seedSet.has(id))
    .map(([id, dep]) => toEvidence(byId.get(id)!, dep))
    .sort((a, b) => (a.depth - b.depth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { tier: EVIDENCE_TIER, seeds, hops: bound, nodes };
}

// ---------------------------------------------------------------------------
// kgDeadCode — free functions with zero inbound calls, minus entry points
// ---------------------------------------------------------------------------

/**
 * Free (module-level) functions that are never called and are not entry points.
 * See header for the rule + why methods are excluded.
 */
export function kgDeadCode(graph: GraphView): DeadCodeResult {
  const inbound = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === "calls") inbound.add(e.target);
  }
  const dead = graph.nodes
    .filter((n) => isFreeFunction(n) && !inbound.has(n.id) && !isEntryPoint(n))
    .map((n) => toEvidence(n, 0))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { tier: EVIDENCE_TIER, nodes: dead };
}

/** All entry-point function nodes (sorted) — exposed for callers/diagnostics. */
export function kgEntryPoints(graph: GraphView): EvidenceNode[] {
  return graph.nodes
    .filter(isEntryPoint)
    .map((n) => toEvidence(n, 0))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
