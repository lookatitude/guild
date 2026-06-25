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
 * `source_refs` (path#Lx-Ly). Callers splice these as grounded facts; they are
 * never a directive to execute.
 *
 * PROVENANCE ENFORCEMENT (per-node tier): `source_refs` are FILTERED to keep
 * only well-formed `#Lx-Ly` line anchors — empty or non-line refs are never
 * passed through. A node that retains at least one line anchor is tagged
 * `tier: "trusted"`; a node with no line provenance is DOWN-TIERED to
 * `tier: "untrusted"` (kept in the result so traversal structure is intact, but
 * never asserted as a grounded fact). The result-envelope `tier` is the default
 * trust of the query mechanism; each node's own `tier` is authoritative for that
 * node.
 *
 * DETERMINISM: every traversal sorts its frontier by node id, so the same graph
 * always yields byte-identical output regardless of node/edge array order.
 * Edge de-dupe/sort uses a FULL stable key (source, target, type, confidence) —
 * parallel `calls` edges that differ only in metadata are NOT collapsed, and
 * reversing the input edge order cannot change the output.
 *
 * ── Node-id convention (LOCKED, codebase-understanding.md §"KnowledgeGraph") ──
 *   file:<relpath>                          (no name segment)
 *   function:<relpath>:<name>               (free function — name has no ".")
 *   function:<relpath>:<Class>.<method>     (method — name contains ".")
 *   class:<relpath>:<Class>
 *
 * ── Entry-point rule (documented; the graph carries no `exported` flag) ──
 *   A `function` node is an entry point iff (a) its simple name is a conventional
 *   program entry name (`main`, `__main__` — the deterministic name heuristic),
 *   OR (b) it is named explicitly in the caller-supplied entry-point set (by node
 *   id OR simple name). The structural layer (G1) does not record
 *   export/visibility, so an "exported + zero-inbound" rule is not yet computable
 *   from the graph alone — callers that know their public surface pass it in via
 *   `DeadCodeOptions.entryPoints`. FOLLOWUP (G1): once the structural extractor
 *   records an `exported` flag, derive the exported set automatically and fold it
 *   in here.
 *
 * ── Dead-code rule (documented, EXPLICITLY SCOPED) ──
 *   Dead code = FREE (module-level) functions with zero inbound `calls` edges,
 *   minus entry points (heuristic + supplied). This measures INTERNAL
 *   REACHABILITY ONLY: with no `exported` flag in the graph, a result is "unused
 *   within the analysed file set". A function reachable only as exported public
 *   API / a CLI / a route handler has zero inbound `calls` here and would be a
 *   FALSE POSITIVE — supply the exported/public surface via
 *   `DeadCodeOptions.entryPoints` to exclude it. METHODS (`<Class>.<method>`) are
 *   deliberately excluded: method reachability needs type/dispatch analysis
 *   (interface, override, reflection) beyond G3's model-free scope, so flagging a
 *   zero-inbound method as dead would be a false positive.
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

/**
 * Per-node trust tier. A node retains "trusted" iff it carries at least one
 * well-formed `#Lx-Ly` line anchor; a node with no line provenance is
 * down-tiered to "untrusted" (see header — provenance enforcement).
 */
export type EvidenceTier = "trusted" | "untrusted";

/** Matches a well-formed `path#Lx-Ly` line anchor (the only provenance we trust). */
const LINE_REF_RE = /#L\d+-L\d+$/;

/** Keep only well-formed `#Lx-Ly` line anchors; drop empty / non-line refs. */
function lineRefs(refs: unknown): string[] {
  return Array.isArray(refs)
    ? refs.filter((r): r is string => typeof r === "string" && LINE_REF_RE.test(r))
    : [];
}

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
  /** `#Lx-Ly` line anchors ONLY (non-line / empty refs filtered out). */
  source_refs: string[];
  /** "trusted" iff at least one `#Lx-Ly` anchor survives; else "untrusted". */
  tier: EvidenceTier;
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

/** Options for {@link kgDeadCode}. */
export interface DeadCodeOptions {
  /**
   * Exported / public surface + real entry points to EXCLUDE from dead code.
   * Each string matches a function node by exact node id OR by simple name.
   * Supplied because the structural graph carries no `exported` flag yet; this
   * is how a caller scopes the "internal reachability" claim to its real public
   * API / CLI / route handlers (see header). Heuristic entry points
   * (`main`/`__main__`) are always excluded regardless of this set.
   */
  entryPoints?: Iterable<string>;
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

/**
 * FULL stable key for a traced edge: source, target, type, AND confidence.
 * Parallel `calls` edges that differ only in metadata get distinct keys, so they
 * are neither collapsed by de-dupe nor reordered nondeterministically by the
 * sort. JSON.stringify gives a printable, NUL-free composite separator.
 */
function traceEdgeKey(e: TraceEdge): string {
  return JSON.stringify([e.source, e.target, e.type, e.confidence ?? null]);
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
  const refs = lineRefs(node.source_refs);
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    source_refs: refs,
    tier: refs.length > 0 ? "trusted" : "untrusted",
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
      // Deterministic neighbour order (full stable key — total order even across
      // parallel edges with differing metadata).
      outgoing.sort((a, b) => {
        const ka = traceEdgeKey(a);
        const kb = traceEdgeKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      for (const e of outgoing) {
        const neighbour = e.source === cur ? e.target : e.source;
        const ek = traceEdgeKey(e);
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
    const ka = traceEdgeKey(a);
    const kb = traceEdgeKey(b);
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
 *
 * SCOPE (see header): this is INTERNAL reachability — "unused within the analysed
 * file set". The graph has no `exported` flag, so callers MUST pass their
 * exported/public surface via `opts.entryPoints` to avoid flagging public API as
 * dead. See header for the rule + why methods are excluded.
 */
export function kgDeadCode(graph: GraphView, opts: DeadCodeOptions = {}): DeadCodeResult {
  const inbound = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === "calls") inbound.add(e.target);
  }
  // Caller-supplied exported/public surface — matched by node id OR simple name.
  const supplied = new Set<string>(opts.entryPoints ?? []);
  const isExcluded = (n: GraphNode): boolean =>
    isEntryPoint(n) || supplied.has(n.id) || supplied.has(simpleName(n.id));

  const dead = graph.nodes
    .filter((n) => isFreeFunction(n) && !inbound.has(n.id) && !isExcluded(n))
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
