/**
 * understand/lib/graph-query-projection.ts — T5.1 (G5) transparent projection
 * read seam for the model-free structural query library.
 *
 * lib/graph-query.ts is the SOURCE OF TRUTH: pure, in-process BFS/scan over the
 * frozen knowledge-graph.json, no SQLite, no model, no network. Its own header
 * declares that the optional SQLite projection "MUST return identical results —
 * never consulted here". This module is that optional accelerator, kept SEPARATE
 * so graph-query.ts stays pure and free of any SQLite dependency.
 *
 * Each `*Auto` function PREFERS the SQLite projection (T5.1: kg_calls /
 * kg_symbols_fts, plus the existing kg_nodes / kg_edges) when it is enabled,
 * above-threshold, and fingerprint-fresh; otherwise it falls back to the
 * in-process JSON path — selected transparently. Parity is by CONSTRUCTION: the
 * projection path reloads the SAME node/edge data into the SAME pure query
 * functions (kgTrace / kgNeighbors / kgDeadCode), so `index: off` and
 * `index: on` are byte-identical. The HARD INVARIANT (goals.md §1.3) holds:
 * deleting `.guild/index.sqlite` loses nothing; SQLite is acceleration only.
 *
 * Every function returns `{ result, usedSqlite }` so callers (and the parity
 * harness) can PROVE which path ran — a non-vacuous engagement signal:
 * `index: off` reports `usedSqlite:false`, an engaged `index: on` reports
 * `usedSqlite:true`. On ANY projection error the seam silently degrades to JSON
 * (never throws), preserving correctness.
 */

import {
  kgTrace,
  kgNeighbors,
  kgDeadCode,
  type GraphView,
  type Direction,
  type DeadCodeOptions,
  type TraceResult,
  type NeighborsResult,
  type DeadCodeResult,
} from "./graph-query";
import type { GraphNode, GraphEdge } from "./schema";
import {
  ensureKgIndex,
  ensureKgProjectionIndex,
  type IndexBlock,
} from "../../../src/modules/state/workflows/index-cache";
import { tokenizeIdentifierAware } from "../../../src/modules/knowledge/workflows/bm25";

// ── node:sqlite read-only handle (minimal stub; mirrors index-cache.ts) ──────

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteReadDb {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/** Open a read handle on an already-migrated/populated index.sqlite, or null. */
function openReadDb(dbPath: string): SqliteReadDb | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteReadDb;
    };
    return new DatabaseSync(dbPath);
  } catch {
    return null;
  }
}

/** Options shared by every `*Auto` query: where the repo lives + index config. */
export interface ProjectionQueryOptions {
  /** Repo root whose `.guild/index.sqlite` + knowledge-graph.json are read. */
  repoRoot: string;
  /** Index config. `enabled:false` forces the JSON path (index: off). */
  config: IndexBlock;
}

/** A query outcome plus a PROOF of which path executed (non-vacuous). */
export interface ProjectionQueryResult<T> {
  result: T;
  /** true iff the SQLite projection actually served this query. */
  usedSqlite: boolean;
}

// ── Projection loaders — reconstruct the GraphView the pure fns consume ──────

/** Reconstruct nodes from kg_nodes (only the fields the query fns read). */
function loadNodes(db: SqliteReadDb): GraphNode[] {
  const rows = db
    .prepare("SELECT id, type, name, source_refs, confidence FROM kg_nodes")
    .all() as Array<{
    id: string;
    type: string | null;
    name: string | null;
    source_refs: string | null;
    confidence: string | null;
  }>;
  return rows.map((r) => {
    let refs: string[] = [];
    if (typeof r.source_refs === "string") {
      try {
        const parsed = JSON.parse(r.source_refs) as unknown;
        if (Array.isArray(parsed)) refs = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        /* leave refs empty on malformed JSON */
      }
    }
    return {
      id: r.id,
      type: r.type ?? "",
      name: r.name ?? "",
      source_refs: refs,
      confidence: (r.confidence ?? "low") as GraphNode["confidence"],
    } as GraphNode;
  });
}

/** Reconstruct the `calls` edges from kg_calls (denormalized fast path). */
function loadCallsEdges(db: SqliteReadDb): GraphEdge[] {
  const rows = db
    .prepare("SELECT source, target, confidence FROM kg_calls")
    .all() as Array<{ source: string; target: string; confidence: string | null }>;
  return rows.map(
    (r) =>
      ({
        source: r.source,
        target: r.target,
        type: "calls",
        direction: "out",
        weight: 1,
        ...(typeof r.confidence === "string" ? { confidence: r.confidence } : {}),
      }) as GraphEdge,
  );
}

/** Reconstruct ALL edges from kg_edges (for undirected neighbourhoods). */
function loadAllEdges(db: SqliteReadDb): GraphEdge[] {
  const rows = db
    .prepare("SELECT source, target, type FROM kg_edges")
    .all() as Array<{ source: string; target: string; type: string | null }>;
  return rows.map(
    (r) =>
      ({
        source: r.source,
        target: r.target,
        type: r.type ?? "",
        direction: "out",
        weight: 1,
      }) as GraphEdge,
  );
}

/** True for a usable ensure-result (the projection table is fresh). */
function fresh(r: ReturnType<typeof ensureKgIndex>): r is { status: "cache-hit" | "populated"; dbPath: string } {
  return !!r && (r.status === "cache-hit" || r.status === "populated") && typeof r.dbPath === "string";
}

/**
 * Try to build the projected GraphView for a given edge need.
 *   kind "calls" → kg_nodes (nodes) + kg_calls (call edges only).
 *   kind "all"   → kg_nodes (nodes) + kg_edges (every edge).
 * Returns null when the projection is unavailable (disabled / below threshold /
 * stale / open error) so the caller falls back to the JSON source of truth.
 */
function tryProjectionView(opts: ProjectionQueryOptions, kind: "calls" | "all"): GraphView | null {
  const baseIdx = ensureKgIndex(opts.repoRoot, opts.config);
  if (!fresh(baseIdx)) return null;

  let callsFresh = true;
  if (kind === "calls") {
    const proj = ensureKgProjectionIndex(opts.repoRoot, opts.config);
    callsFresh = fresh(proj);
  }
  if (!callsFresh) return null;

  const db = openReadDb(baseIdx.dbPath);
  if (!db) return null;
  try {
    const nodes = loadNodes(db);
    const edges = kind === "calls" ? loadCallsEdges(db) : loadAllEdges(db);
    return { nodes, edges };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// ── Auto queries — projection-preferring, identical results either way ───────

/** kgTrace, preferring the kg_calls projection; identical to the JSON path. */
export function kgTraceAuto(
  jsonView: GraphView,
  opts: ProjectionQueryOptions,
  query: string,
  direction: Direction = "outbound",
  depth = 3,
): ProjectionQueryResult<TraceResult> {
  const view = tryProjectionView(opts, "calls");
  if (view) return { result: kgTrace(view, query, direction, depth), usedSqlite: true };
  return { result: kgTrace(jsonView, query, direction, depth), usedSqlite: false };
}

/** kgNeighbors, preferring the kg_edges projection; identical to the JSON path. */
export function kgNeighborsAuto(
  jsonView: GraphView,
  opts: ProjectionQueryOptions,
  query: string,
  hops = 1,
): ProjectionQueryResult<NeighborsResult> {
  const view = tryProjectionView(opts, "all");
  if (view) return { result: kgNeighbors(view, query, hops), usedSqlite: true };
  return { result: kgNeighbors(jsonView, query, hops), usedSqlite: false };
}

/** kgDeadCode, preferring the kg_calls projection; identical to the JSON path. */
export function kgDeadCodeAuto(
  jsonView: GraphView,
  opts: ProjectionQueryOptions,
  deadOpts: DeadCodeOptions = {},
): ProjectionQueryResult<DeadCodeResult> {
  const view = tryProjectionView(opts, "calls");
  if (view) return { result: kgDeadCode(view, deadOpts), usedSqlite: true };
  return { result: kgDeadCode(jsonView, deadOpts), usedSqlite: false };
}

// ── Symbol search — camel/snake identifier lookup over kg_symbols_fts ────────

/**
 * In-process reference: a node matches iff its name's identifier-aware token
 * set intersects the query's identifier-aware token set. Returns SORTED, unique
 * node ids (deterministic; ranking is the recall layer's concern, out of scope).
 * This is the SOURCE OF TRUTH the FTS path must match exactly.
 */
export function kgSymbolSearchJson(nodes: GraphNode[], query: string): string[] {
  const qTokens = new Set(tokenizeIdentifierAware(query));
  if (qTokens.size === 0) return [];
  const hits = new Set<string>();
  for (const n of nodes) {
    const name = typeof n.name === "string" ? n.name : "";
    if (name.length === 0) continue;
    const nTokens = tokenizeIdentifierAware(name);
    if (nTokens.some((t) => qTokens.has(t))) hits.add(n.id);
  }
  return [...hits].sort();
}

/**
 * FTS path over kg_symbols_fts. The table stores the SAME identifier-aware
 * tokens of each node name (see index-cache.ts:ensureKgProjectionIndex), so an
 * OR-of-tokens MATCH is set-equivalent to {@link kgSymbolSearchJson}. Tokens are
 * alphanumeric-only (no FTS metacharacters) and double-quoted so an `or`/`and`
 * token is a literal, not an operator. Returns null when MATCH is unavailable
 * (FTS5 fallback table) so the caller degrades to the JSON reference.
 */
function kgSymbolSearchSqlite(db: SqliteReadDb, query: string): string[] | null {
  const qTokens = [...new Set(tokenizeIdentifierAware(query))];
  if (qTokens.length === 0) return [];
  const match = qTokens.map((t) => `"${t}"`).join(" OR ");
  try {
    const rows = db
      .prepare("SELECT DISTINCT node_id FROM kg_symbols_fts WHERE kg_symbols_fts MATCH ?")
      .all(match) as Array<{ node_id: string }>;
    return [...new Set(rows.map((r) => r.node_id))].sort();
  } catch {
    return null;
  }
}

/**
 * Camel/snake identifier search, preferring the kg_symbols_fts projection.
 * Identical (sorted, unique id set) to the JSON reference either way.
 */
export function kgSymbolSearchAuto(
  jsonView: GraphView,
  opts: ProjectionQueryOptions,
  query: string,
): ProjectionQueryResult<string[]> {
  const proj = ensureKgProjectionIndex(opts.repoRoot, opts.config);
  if (fresh(proj)) {
    const db = openReadDb(proj.dbPath);
    if (db) {
      try {
        const r = kgSymbolSearchSqlite(db, query);
        if (r !== null) return { result: r, usedSqlite: true };
      } catch {
        /* fall through to JSON */
      } finally {
        db.close();
      }
    }
  }
  return { result: kgSymbolSearchJson(jsonView.nodes, query), usedSqlite: false };
}
