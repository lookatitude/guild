/**
 * learn/lib/graph-query.ts — model-free structural query library (Goal G3).
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
 *   OR (b) it is matched by the resolved entry-point set — by node id, simple
 *   name, OR file relpath. The structural layer (G1) does not record
 *   export/visibility, so an "exported + zero-inbound" rule is not computable from
 *   the graph alone — instead the entry/exported surface is resolved from REAL
 *   on-disk sources of the consuming repo (see resolution below). FOLLOWUP (G1):
 *   once the structural extractor records an `exported` flag, derive the exported
 *   set automatically and fold it in here.
 *
 * ── Entry-point RESOLUTION (REAL on-disk surface, model-free) ──
 *   `resolveEntryPointConfig()` unions four model-free, on-disk sources into one
 *   matcher set (no model, no network — local file reads only):
 *     1. `<repoRoot>/package.json` — `main`, `bin` (string or map), and `exports`
 *        (string or nested condition/subpath tree). These are FILE relpaths: a
 *        match excludes EVERY free function defined in that file (the public
 *        module surface).
 *     2. `<repoRoot>/.guild/settings.json` — `models.entryPoints: string[]`.
 *     3. `<repoRoot>/.guild/indexes/entry_points.json` — `string[]` or
 *        `{ entryPoints: string[] }`. The `.guild`-level override.
 *     4. Explicit caller / CLI entries (`DeadCodeOptions.entryPoints`).
 *   PRECEDENCE: the four sources are UNIONED (purely additive — set union, so no
 *   source can remove another's entries); the explicit set (4) is highest and is
 *   layered last, but because union never subtracts, the documented order only
 *   reflects authoring intent, not a tie-break. The `main`/`__main__` name
 *   heuristic is ALWAYS applied on top, independent of all four. Each matcher is
 *   compared against a node's id, simple name, OR file relpath (leading `./`
 *   stripped); matching is EXACT (no extension stripping) to avoid false-linking,
 *   so a manifest that points at build output (e.g. `dist/`) must reference the
 *   analysed source path or be supplemented via the `entry_points.json` override.
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

import * as fs from "fs";
import * as path from "path";

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

/** The file relpath segment of a node id (`<type>:<relpath>[:<name>]`), or "". */
export function nodeRelPath(id: string): string {
  const parts = id.split(":");
  return parts.length >= 2 ? parts[1] : "";
}

/** Strip a leading `./` and back-slashes so manifest paths match node relpaths. */
function normRel(p: string): string {
  return p.replace(/^\.\//, "").replace(/\\/g, "/");
}

/** A free (module-level) function — type "function" whose name has no ".". */
function isFreeFunction(node: GraphNode): boolean {
  return node.type === "function" && !simpleName(node.id).includes(".");
}

/** Conventional entry point — a function whose simple name is in ENTRY_POINT_NAMES. */
export function isEntryPoint(node: GraphNode): boolean {
  return node.type === "function" && ENTRY_POINT_NAMES.has(simpleName(node.id));
}

/** Normalise a caller/on-disk matcher set (skip non-strings, strip `./`). */
function normalizeMatchers(entries?: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const e of entries ?? []) if (typeof e === "string" && e.length > 0) s.add(normRel(e));
  return s;
}

/**
 * A node is an entry point iff it is a name-heuristic entry (`main`/`__main__`)
 * OR matched by the resolved set via node id, simple name, OR file relpath
 * (EXACT match — see header "Entry-point RESOLUTION"; relpath match covers
 * manifest file paths that mark an entire file as public surface).
 */
function isEntryNode(node: GraphNode, matchers: Set<string>): boolean {
  if (isEntryPoint(node)) return true;
  return (
    matchers.has(node.id) ||
    matchers.has(simpleName(node.id)) ||
    matchers.has(nodeRelPath(node.id))
  );
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
  // Resolved exported/public surface — matched by node id, simple name, OR relpath.
  const matchers = normalizeMatchers(opts.entryPoints);

  const dead = graph.nodes
    .filter((n) => isFreeFunction(n) && !inbound.has(n.id) && !isEntryNode(n, matchers))
    .map((n) => toEvidence(n, 0))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { tier: EVIDENCE_TIER, nodes: dead };
}

/**
 * All entry-point function nodes (sorted). Accepts the SAME entry-point options
 * as {@link kgDeadCode}: the name-heuristic entries (`main`/`__main__`) PLUS any
 * configured/supplied entry matched by id, simple name, or relpath are returned.
 * (Round-3 fix: previously ignored configured entries and returned only `main`.)
 */
export function kgEntryPoints(graph: GraphView, opts: DeadCodeOptions = {}): EvidenceNode[] {
  const matchers = normalizeMatchers(opts.entryPoints);
  return graph.nodes
    .filter((n) => n.type === "function" && isEntryNode(n, matchers))
    .map((n) => toEvidence(n, 0))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Entry-point resolution — REAL on-disk public surface (model-free)
// ---------------------------------------------------------------------------

/** Sources for {@link resolveEntryPointConfig}. */
export interface EntryPointSources {
  /** Repo root holding `package.json`. */
  repoRoot: string;
  /** `.guild` dir holding `settings.json` (defaults to `<repoRoot>/.guild`). */
  guildDir?: string;
  /** `.guild/indexes` dir holding `entry_points.json` (defaults to `<guildDir>/indexes`). */
  indexesDir?: string;
  /** Explicit caller/CLI entries (unioned in last; highest authoring precedence). */
  explicit?: Iterable<string>;
  /** Injectable reader (tests). Defaults to `fs.readFileSync(p, "utf8")`. */
  readFile?: (absPath: string) => string;
}

/** Recurse a `package.json` `exports` tree, collecting every string leaf. */
function collectExports(node: unknown, out: string[]): void {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) collectExports(v, out);
  }
}

/** `main` + `bin` (string|map) + `exports` (string|tree) file paths, or []. */
function manifestEntryPoints(repoRoot: string, read: (p: string) => string): string[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(read(path.join(repoRoot, "package.json"))) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: string[] = [];
  if (typeof pkg.main === "string") out.push(pkg.main);
  if (typeof pkg.bin === "string") out.push(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === "object") {
    for (const v of Object.values(pkg.bin as Record<string, unknown>)) {
      if (typeof v === "string") out.push(v);
    }
  }
  collectExports(pkg.exports, out);
  return out;
}

/** `.guild/settings.json` → `models.entryPoints: string[]`, or []. */
function settingsEntryPoints(guildDir: string, read: (p: string) => string): string[] {
  try {
    const s = JSON.parse(read(path.join(guildDir, "settings.json"))) as {
      models?: { entryPoints?: unknown };
    };
    const ep = s.models?.entryPoints;
    return Array.isArray(ep) ? ep.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** `.guild/indexes/entry_points.json` → `string[]` | `{entryPoints:string[]}`, or []. */
function indexEntryPoints(indexesDir: string, read: (p: string) => string): string[] {
  try {
    const j = JSON.parse(read(path.join(indexesDir, "entry_points.json"))) as unknown;
    const arr = Array.isArray(j)
      ? j
      : j && typeof j === "object" && Array.isArray((j as { entryPoints?: unknown }).entryPoints)
        ? (j as { entryPoints: unknown[] }).entryPoints
        : [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Resolve the entry/exported surface from REAL on-disk sources (see header
 * "Entry-point RESOLUTION"). Returns a sorted, de-duplicated, normalised union of
 * matchers (id | simple name | relpath). Model-free: local file reads only — no
 * model, no network. Missing/malformed sources are skipped silently (each source
 * is optional), so a repo with none yields just the explicit entries.
 */
export function resolveEntryPointConfig(src: EntryPointSources): string[] {
  const guildDir = src.guildDir ?? path.join(src.repoRoot, ".guild");
  const indexesDir = src.indexesDir ?? path.join(guildDir, "indexes");
  const read = src.readFile ?? ((p: string) => fs.readFileSync(p, "utf8"));

  const all = new Set<string>();
  // Union order reflects authoring precedence (1→4); union itself never subtracts.
  for (const m of manifestEntryPoints(src.repoRoot, read)) all.add(normRel(m));
  for (const m of settingsEntryPoints(guildDir, read)) all.add(normRel(m));
  for (const m of indexEntryPoints(indexesDir, read)) all.add(normRel(m));
  for (const m of src.explicit ?? []) if (typeof m === "string" && m.length > 0) all.add(normRel(m));
  return [...all].sort();
}
