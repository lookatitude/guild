/**
 * learn/lib/impact.ts — model-free impact analysis (Goal G9, impact half).
 *
 * Given a git diff (changed files and/or changed symbols), compute the
 * REVERSE-REACHABLE set over `calls` edges — every symbol that (transitively)
 * calls into the changed code and is therefore at risk — and assign each
 * affected symbol a risk tier (CRITICAL / HIGH / MEDIUM / LOW) from two
 * structural signals: fan-in and distance from a program entry point.
 *
 * SELF-CONTAINED (parallel-safety scope guard): this module implements its OWN
 * reverse-BFS over `calls` edges. It deliberately does NOT import the in-flight
 * graph-query module (`./graph-query`), `./structural`, `./resolve-calls`, or
 * `./similarity` — only the FROZEN type contract from `./schema` and the
 * committed `./git` helper. The in-process JSON scan is the source of truth:
 * no SQLite, no model, no network (proven by the import-closure test).
 *
 * EVIDENCE, NOT INSTRUCTIONS: every affected node carries its `file:line`
 * `source_refs` (path#Lx-Ly). Results are `trusted`-tier evidence — grounded
 * facts a caller splices in, never a directive to execute.
 *
 * PROVENANCE ENFORCEMENT (per-node tier): `source_refs` are FILTERED to keep
 * only well-formed `#Lx-Ly` line anchors; empty / non-line refs are never
 * passed through. A node retaining ≥1 line anchor is tagged `tier: "trusted"`;
 * a node with no line provenance is DOWN-TIERED to `tier: "untrusted"` (kept so
 * the impact structure stays intact, but never asserted as a grounded fact).
 *
 * DETERMINISM (scoped to the ImpactEdge PROJECTION): impact analysis consumes a
 * narrow edge view — `ImpactEdge = {source, target, type:"calls", confidence?}`
 * — and DELIBERATELY drops every other `GraphEdge` field (`direction`, `weight`,
 * `description`, and any extra `resolution`/`backend` metadata). The de-dupe/sort
 * key is the FULL stable key OF THAT PROJECTION (all four projected fields), so:
 *   • parallel `calls` edges that differ in a RETAINED field (`confidence`) get
 *     distinct keys and BOTH survive, in a stable order;
 *   • parallel `calls` edges that differ ONLY in a dropped field (e.g. `weight`)
 *     project to one identical `ImpactEdge` and collapse to a single output edge
 *     — by design, since impact does not key on those fields.
 * Every traversal also sorts its frontier by node id. Reversing the node/edge
 * input order therefore cannot change the (projected) output — byte-identical.
 *
 * ── Node-id convention (LOCKED, codebase-understanding.md §"KnowledgeGraph") ──
 *   file:<relpath>                          (no name segment)
 *   function:<relpath>:<name>               (free function — name has no ".")
 *   function:<relpath>:<Class>.<method>     (method — name contains ".")
 *   class:<relpath>:<Class>
 * The repo-relative path is ALWAYS the second colon-delimited segment.
 *
 * ── Seed (diff → changed symbols) rule (documented, EXPLICITLY SCOPED) ──
 *   Impact is computed over the `calls` graph, so seeds are the `function` nodes
 *   whose file is in `changedFiles` (the call-graph participants) UNION any node
 *   named in `changedSymbols` (by node id OR simple name). A changed `class` /
 *   `config` / `file` node carries no `calls` edge and is therefore OUT OF SCOPE
 *   for reverse-call impact — name it explicitly via `changedSymbols` to force it
 *   in. This keeps the reverse-reachable claim scoped to the call graph, not
 *   overclaimed to every textual change.
 *
 * ── Entry-point rule (documented; the graph carries no `exported` flag) ──
 *   A `function` node is an entry point iff (a) its simple name is a conventional
 *   program entry name (`main`, `__main__` — the deterministic name heuristic),
 *   OR (b) it is named in the caller-supplied entry-point set (by node id OR
 *   simple name). The structural layer records no export/visibility, so an
 *   "exported public surface" entry set must be supplied by the caller via
 *   `ImpactOptions.entryPoints`. `entryDistance` is null for a symbol no entry
 *   point reaches — an honest "not reachable from a known entry" signal, never a
 *   silent 0.
 *
 * ── Risk-tier rule (documented + reproducible) ──
 *   For each affected symbol the tier is a PURE function of three signals:
 *     fanIn         = # of DISTINCT callers (distinct `source` over inbound
 *                     `calls` edges to the symbol) — how many depend on it.
 *     entryDistance = shortest # of `calls` hops from ANY entry point to the
 *                     symbol (forward reachability); null if none reaches it.
 *     isEntryPoint  = the symbol is itself a program entry.
 *   Tiers (FIRST match wins, top → bottom; thresholds are the named constants):
 *     CRITICAL — isEntryPoint, OR (fanIn ≥ CRIT_FANIN and entryDistance ≤ CRIT_DIST)
 *     HIGH     — fanIn ≥ HIGH_FANIN, OR entryDistance ≤ HIGH_DIST
 *     MEDIUM   — fanIn ≥ 1, OR entryDistance is finite (reachable from an entry)
 *     LOW      — otherwise (a leaf utility: no callers, unreached by any entry)
 *   A heavily-depended-upon symbol near an entry point therefore ranks
 *   CRITICAL/HIGH strictly above a zero-caller leaf utility (LOW).
 */

import type { GraphNode, GraphEdge } from "./schema";

export type { GraphNode, GraphEdge } from "./schema";

// ---------------------------------------------------------------------------
// Risk-tier thresholds (named so the rule is documented, not magic numbers)
// ---------------------------------------------------------------------------

/** fanIn at/above which a near-entry symbol is CRITICAL. */
export const CRIT_FANIN = 3;
/** entryDistance at/below which a high-fanIn symbol is CRITICAL. */
export const CRIT_DIST = 2;
/** fanIn at/above which a symbol is at least HIGH. */
export const HIGH_FANIN = 2;
/** entryDistance at/below which a symbol is at least HIGH. */
export const HIGH_DIST = 1;

export type RiskTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** Numeric ordinal for ranking tiers (higher = riskier). */
export const RISK_ORDINAL: Record<RiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Trusted-tier evidence marker. Impact results are deterministic facts read
 * from knowledge-graph.json with file:line provenance — EVIDENCE, never
 * instructions to follow.
 */
export const EVIDENCE_TIER = "trusted" as const;

/** Per-node trust tier (see header — provenance enforcement). */
export type EvidenceTier = "trusted" | "untrusted";

/** Conventional program entry-point simple names. */
export const ENTRY_POINT_NAMES = new Set<string>(["main", "__main__"]);

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

/** A single affected symbol: identity + provenance + the risk signals. */
export interface ImpactNode {
  id: string;
  type: string;
  name: string;
  /** `#Lx-Ly` line anchors ONLY (non-line / empty refs filtered out). */
  source_refs: string[];
  /** "trusted" iff at least one `#Lx-Ly` anchor survives; else "untrusted". */
  tier: EvidenceTier;
  /** assigned risk tier (see header risk-tier rule). */
  risk: RiskTier;
  /** # of DISTINCT callers (inbound `calls` sources). */
  fanIn: number;
  /** shortest `calls` hops from any entry point; null if none reaches it. */
  entryDistance: number | null;
  /** reverse-BFS hops from the nearest changed seed (0 = the changed symbol itself). */
  distanceFromChange: number;
  /** true iff this node is one of the changed seeds. */
  changed: boolean;
  /** true iff this node is itself a program entry point. */
  entryPoint: boolean;
}

/**
 * A traversed inbound `calls` edge (caller → callee), with resolution
 * confidence. This is the DELIBERATE narrow projection impact keys on — it omits
 * `direction`/`weight`/`description` and any other `GraphEdge` metadata. The
 * determinism guarantee is scoped to exactly these four fields (see header).
 */
export interface ImpactEdge {
  source: string;
  target: string;
  type: "calls";
  confidence?: string;
}

/** Per-file roll-up: the max risk among a changed/affected file's symbols. */
export interface ImpactFile {
  path: string;
  risk: RiskTier;
  symbolCount: number;
}

export interface ImpactResult {
  tier: typeof EVIDENCE_TIER;
  /** normalized, sorted changed-file relpaths echoed from the input. */
  changedFiles: string[];
  /** resolved seed node ids (changed symbols), sorted. */
  changedSymbols: string[];
  /** resolved entry-point node ids actually present in the graph, sorted. */
  entryPoints: string[];
  /** the affected set (changed seeds + transitive callers), sorted by id. */
  nodes: ImpactNode[];
  /** inbound `calls` edges traversed during the reverse BFS (sorted, full key). */
  edges: ImpactEdge[];
  /** per-file roll-up of the max risk, sorted by path. */
  files: ImpactFile[];
  /** count of affected symbols per tier. */
  summary: Record<RiskTier, number>;
}

/** Options for {@link computeImpact}. */
export interface ImpactOptions {
  /** Repo-relative paths of changed files (maps to their `function` nodes). */
  changedFiles?: Iterable<string>;
  /** Changed symbols, matched by node id OR simple name (forces inclusion). */
  changedSymbols?: Iterable<string>;
  /**
   * Exported / public surface + real entry points, matched by node id OR simple
   * name. Folded into the entry-point set alongside the `main`/`__main__`
   * heuristic so entryDistance reflects the caller's real public surface.
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

/** The repo-relative path segment of a node id (always the 2nd colon field). */
export function nodeRelpath(id: string): string {
  const parts = id.split(":");
  return parts.length > 1 ? parts[1] : "";
}

/** Conventional entry point — a `function` whose simple name is in ENTRY_POINT_NAMES. */
export function isEntryPointNode(node: GraphNode): boolean {
  return node.type === "function" && ENTRY_POINT_NAMES.has(simpleName(node.id));
}

// ---------------------------------------------------------------------------
// Edge keying (FULL stable key — NUL-free, parallel-edge safe)
// ---------------------------------------------------------------------------

/**
 * FULL stable key for an `ImpactEdge` — every field of the projection:
 * source, target, type, AND confidence. The key is "full" relative to the
 * projected type, NOT the raw `GraphEdge`: two `calls` edges that differ in a
 * RETAINED field (`confidence`) get distinct keys and both survive; two that
 * differ only in a field `toImpactEdge` DROPS (`weight`/`direction`/… ) project
 * to one identical `ImpactEdge`, share a key, and collapse — by design.
 * JSON.stringify gives a printable, NUL-free composite separator.
 */
function impactEdgeKey(e: ImpactEdge): string {
  return JSON.stringify([e.source, e.target, e.type, e.confidence ?? null]);
}

/**
 * Project a raw `GraphEdge` onto the narrow `ImpactEdge` view impact analysis
 * keys on. INTENTIONAL drop of `direction`/`weight`/`description` and any other
 * metadata: impact reasons only about who-calls-whom + resolution `confidence`,
 * so edges differing only in a dropped field are equivalent here and collapse.
 */
function toImpactEdge(e: GraphEdge): ImpactEdge {
  return {
    source: e.source,
    target: e.target,
    type: "calls",
    ...(typeof e.confidence === "string" ? { confidence: e.confidence } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adjacency over `calls` edges (built once per call)
// ---------------------------------------------------------------------------

interface CallsAdjacency {
  /** caller id → callee ids (forward; for entry-distance BFS). */
  out: Map<string, string[]>;
  /** callee id → traversed inbound edges from callers (reverse BFS). */
  in: Map<string, ImpactEdge[]>;
  /** callee id → set of DISTINCT caller ids (fan-in). */
  callers: Map<string, Set<string>>;
}

function buildCallsAdjacency(edges: GraphEdge[]): CallsAdjacency {
  const out = new Map<string, string[]>();
  const inn = new Map<string, ImpactEdge[]>();
  const callers = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.type !== "calls") continue;
    if (typeof e.source !== "string" || typeof e.target !== "string") continue;
    const arr = out.get(e.source);
    if (arr) arr.push(e.target);
    else out.set(e.source, [e.target]);

    const ie = toImpactEdge(e);
    const inArr = inn.get(e.target);
    if (inArr) inArr.push(ie);
    else inn.set(e.target, [ie]);

    const cset = callers.get(e.target);
    if (cset) cset.add(e.source);
    else callers.set(e.target, new Set([e.source]));
  }
  return { out, in: inn, callers };
}

// ---------------------------------------------------------------------------
// Seed + entry-point resolution
// ---------------------------------------------------------------------------

/** Resolve `changedSymbols` (id OR simple name) to concrete node ids present in the graph. */
function resolveSymbolSeeds(nodes: GraphNode[], symbols: Set<string>): Set<string> {
  const hits = new Set<string>();
  if (symbols.size === 0) return hits;
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  for (const s of symbols) {
    if (byId.has(s)) hits.add(s);
  }
  for (const n of nodes) {
    if (symbols.has(simpleName(n.id)) || symbols.has(n.name)) hits.add(n.id);
  }
  return hits;
}

/** All `function` nodes whose file is in `changedFiles`. */
function resolveFileSeeds(nodes: GraphNode[], files: Set<string>): Set<string> {
  const hits = new Set<string>();
  if (files.size === 0) return hits;
  for (const n of nodes) {
    if (n.type === "function" && files.has(nodeRelpath(n.id))) hits.add(n.id);
  }
  return hits;
}

/** Entry-point node ids: heuristic (main/__main__) ∪ supplied (id or simple name). */
function resolveEntryPoints(nodes: GraphNode[], supplied: Set<string>): Set<string> {
  const eps = new Set<string>();
  for (const n of nodes) {
    if (isEntryPointNode(n)) eps.add(n.id);
    else if (supplied.has(n.id) || supplied.has(simpleName(n.id))) eps.add(n.id);
  }
  return eps;
}

// ---------------------------------------------------------------------------
// Forward BFS — entry-point distance (shortest hops entry → node)
// ---------------------------------------------------------------------------

function entryDistances(
  adj: CallsAdjacency,
  byId: Map<string, GraphNode>,
  entryPoints: Set<string>,
): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier: string[] = [];
  for (const ep of entryPoints) {
    if (byId.has(ep) && !dist.has(ep)) {
      dist.set(ep, 0);
      frontier.push(ep);
    }
  }
  let d = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const cur of [...frontier].sort()) {
      for (const callee of [...(adj.out.get(cur) ?? [])].sort()) {
        if (!dist.has(callee) && byId.has(callee)) {
          dist.set(callee, d + 1);
          next.push(callee);
        }
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Risk tier
// ---------------------------------------------------------------------------

/**
 * Pure risk-tier function (see header risk-tier rule). FIRST match wins.
 * `entryDistance` null = no known entry point reaches the symbol.
 */
export function riskTier(
  fanIn: number,
  entryDistance: number | null,
  isEntryPoint: boolean,
): RiskTier {
  const reachable = entryDistance !== null;
  if (isEntryPoint) return "CRITICAL";
  if (fanIn >= CRIT_FANIN && reachable && (entryDistance as number) <= CRIT_DIST) return "CRITICAL";
  if (fanIn >= HIGH_FANIN || (reachable && (entryDistance as number) <= HIGH_DIST)) return "HIGH";
  if (fanIn >= 1 || reachable) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// computeImpact — the reverse-BFS impact analysis (pure, in-process)
// ---------------------------------------------------------------------------

/**
 * Reverse-reachable impact of a diff. From the changed seeds, BFS over inbound
 * `calls` edges (callers of callers …) to collect every at-risk symbol, then
 * assign each a risk tier from its global fan-in + entry-point distance.
 *
 * Deterministic: sorted frontiers, full-stable-key edge dedupe, sorted output —
 * byte-identical regardless of node/edge input order.
 */
export function computeImpact(graph: GraphView, opts: ImpactOptions = {}): ImpactResult {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const adj = buildCallsAdjacency(edges);

  const changedFilesSet = new Set<string>(opts.changedFiles ?? []);
  const changedSymbolsSet = new Set<string>(opts.changedSymbols ?? []);
  const suppliedEntry = new Set<string>(opts.entryPoints ?? []);

  // Seeds = function nodes in changed files ∪ resolved changed symbols.
  const seeds = new Set<string>([
    ...resolveFileSeeds(nodes, changedFilesSet),
    ...resolveSymbolSeeds(nodes, changedSymbolsSet),
  ]);

  const entryPoints = resolveEntryPoints(nodes, suppliedEntry);
  const entryDist = entryDistances(adj, byId, entryPoints);

  // Reverse BFS over inbound `calls` edges: seeds at distance 0, follow callers.
  const distFromChange = new Map<string, number>();
  const edgeKeys = new Set<string>();
  const tracedEdges: ImpactEdge[] = [];

  let frontier: string[] = [];
  for (const s of [...seeds].sort()) {
    if (byId.has(s) && !distFromChange.has(s)) {
      distFromChange.set(s, 0);
      frontier.push(s);
    }
  }
  let d = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const cur of [...frontier].sort()) {
      const inbound = [...(adj.in.get(cur) ?? [])].sort((a, b) => {
        const ka = impactEdgeKey(a);
        const kb = impactEdgeKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      for (const e of inbound) {
        const caller = e.source; // who calls `cur`
        const ek = impactEdgeKey(e);
        if (!edgeKeys.has(ek)) {
          edgeKeys.add(ek);
          tracedEdges.push(e);
        }
        if (!distFromChange.has(caller) && byId.has(caller)) {
          distFromChange.set(caller, d + 1);
          next.push(caller);
        }
      }
    }
    frontier = next;
    d++;
  }

  // Build the affected-node list with risk tiers.
  const impactNodes: ImpactNode[] = [];
  const summary: Record<RiskTier, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const [id, dist] of distFromChange.entries()) {
    const node = byId.get(id)!;
    const refs = lineRefs(node.source_refs);
    const fanIn = adj.callers.get(id)?.size ?? 0;
    const eDist = entryDist.has(id) ? (entryDist.get(id) as number) : null;
    const isEp = entryPoints.has(id);
    const risk = riskTier(fanIn, eDist, isEp);
    summary[risk]++;
    impactNodes.push({
      id,
      type: node.type,
      name: node.name,
      source_refs: refs,
      tier: refs.length > 0 ? "trusted" : "untrusted",
      risk,
      fanIn,
      entryDistance: eDist,
      distanceFromChange: dist,
      changed: seeds.has(id),
      entryPoint: isEp,
    });
  }
  impactNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Per-file roll-up: max risk among each affected file's symbols.
  const fileAgg = new Map<string, { risk: RiskTier; count: number }>();
  for (const n of impactNodes) {
    const rel = nodeRelpath(n.id);
    if (!rel) continue;
    const cur = fileAgg.get(rel);
    if (!cur) {
      fileAgg.set(rel, { risk: n.risk, count: 1 });
    } else {
      cur.count++;
      if (RISK_ORDINAL[n.risk] > RISK_ORDINAL[cur.risk]) cur.risk = n.risk;
    }
  }
  const files: ImpactFile[] = [...fileAgg.entries()]
    .map(([p, v]) => ({ path: p, risk: v.risk, symbolCount: v.count }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  tracedEdges.sort((a, b) => {
    const ka = impactEdgeKey(a);
    const kb = impactEdgeKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    tier: EVIDENCE_TIER,
    changedFiles: [...changedFilesSet].sort(),
    changedSymbols: [...seeds].sort(),
    entryPoints: [...entryPoints].sort(),
    nodes: impactNodes,
    edges: tracedEdges,
    files,
    summary,
  };
}
