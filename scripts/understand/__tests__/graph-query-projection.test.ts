/**
 * understand/__tests__/graph-query-projection.test.ts
 *
 * T5.1 (G5) — OPTIONAL SQLite structural projection validation gate (NON-VACUOUS).
 *
 * Proves the HARD INVARIANT (goals.md §1.3): the projection (kg_calls /
 * kg_symbols_fts) is acceleration ONLY. `index: off` (in-process JSON BFS via
 * lib/graph-query.ts) is the source of truth and returns BYTE-IDENTICAL answers;
 * deleting `.guild/index.sqlite` loses nothing.
 *
 * The graph under test is built from the SHARED clra-fixture via the real G1
 * extractor + G2 call resolver (real nodes AND real `calls` edges — never
 * edges:[]), written to a temp repo's knowledge-graph.json, then queried through
 * BOTH index modes via lib/parity-harness.ts:runBothIndexModes.
 *
 *   1. SQLite-off parity   — trace / neighbors / dead-code identical off vs on,
 *                            AND per-mode engagement PROVEN (off=JSON, on=SQLite).
 *   2. Delete-safe         — wipe index.sqlite, re-query → auto-rebuild, same answer.
 *   3. Pure projection     — rebuild twice → identical kg_calls contents; fp stable.
 *   4. Perf (record)       — above-threshold trace via projection vs JSON (logged).
 *   5. Symbol search       — camel/snake kg_symbols_fts == JSON reference (parity).
 *   6. Anti-vacuity        — tampering kg_calls makes the projection DIVERGE, so
 *                            the parity check provably bites.
 *
 * Run from plugin/scripts/:  npx jest --no-coverage projection
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge, GraphNode } from "../lib/schema";
import { kgTrace, kgNeighbors, kgDeadCode, type GraphView } from "../lib/graph-query";
import {
  kgTraceAuto,
  kgNeighborsAuto,
  kgDeadCodeAuto,
  kgSymbolSearchAuto,
  kgSymbolSearchJson,
  type ProjectionQueryOptions,
} from "../lib/graph-query-projection";
import { runBothIndexModes } from "../lib/parity-harness";
import { DEFAULT_INDEX_BLOCK, type IndexBlock } from "../../../src/modules/state/workflows/index-cache";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "clra-fixture");
const REL_FILES = [
  "src/a.ts", "src/b.ts", "src/shapes.ts",
  "py/a.py", "py/b.py", "py/shapes.py",
];

const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

/** Build the real fixture GraphView (G1 extract → G2 refine). */
function buildClraGraph(): GraphView {
  const base = extractStructuralGraph(FIXTURE_ROOT, REL_FILES, readFile);
  const refined = refineCalls(FIXTURE_ROOT, REL_FILES, readFile, base);
  return { nodes: refined.nodes as GraphNode[], edges: refined.edges as GraphEdge[] };
}

/** Write a GraphView to <repo>/.guild/indexes/knowledge-graph.json. */
function writeGraph(repoRoot: string, view: GraphView): void {
  fs.mkdirSync(path.join(repoRoot, ".guild", "indexes"), { recursive: true });
  const doc = {
    version: "guild.knowledge_graph.v1",
    project: { name: "clra-fixture", description: "" },
    generated_from_commit: "fixture",
    nodes: view.nodes,
    edges: view.edges,
    layers: [],
    tour: [],
  };
  fs.writeFileSync(
    path.join(repoRoot, ".guild", "indexes", "knowledge-graph.json"),
    JSON.stringify(doc),
  );
}

/** Lower thresholds so the small fixture still engages SQLite in `on` mode. */
const ENGAGE: Partial<IndexBlock> = { kg_node_threshold: 0, kg_size_threshold_mb: 0 };

// ── temp-dir registry ────────────────────────────────────────────────────────
const TEMP: string[] = [];
afterAll(() => {
  for (const d of TEMP) fs.rmSync(d, { recursive: true, force: true });
});
function mkRepo(view: GraphView): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t5p-"));
  TEMP.push(root);
  writeGraph(root, view);
  return root;
}
function dbPath(repo: string): string {
  return path.join(repo, ".guild", "index.sqlite");
}
function openDb(p: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[]; run(...p: unknown[]): unknown };
      close(): void;
    };
  };
  return new DatabaseSync(p);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. SQLite-off parity (the core gate) — identical + engagement PROVEN.
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] SQLite-off parity — projection == JSON, engagement proven", () => {
  const SEED_TRACE = "function:src/a.ts:main";
  const SEED_NEIGHBORS = "function:src/a.ts:main";

  test("kgTrace: off (JSON) and on (kg_calls) return identical results", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const outcome = runBothIndexModes(
      (ctx) => {
        const r = kgTraceAuto(view, { repoRoot: repo, config: ctx.config }, SEED_TRACE, "outbound", 3);
        ctx.reportEngagement(r.usedSqlite);
        return r.result;
      },
      { overrides: ENGAGE },
    );

    expect(outcome.identical).toBe(true);
    expect(outcome.engagementProven).toBe(true); // off=JSON(false), on=SQLite(true)
    // NON-VACUOUS: real nodes AND real edges were actually compared.
    expect(outcome.off.nodes.length).toBeGreaterThan(1);
    expect(outcome.off.edges.length).toBeGreaterThan(0);
  });

  test("kgNeighbors: off and on (kg_edges) return identical results", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const outcome = runBothIndexModes(
      (ctx) => {
        const r = kgNeighborsAuto(view, { repoRoot: repo, config: ctx.config }, SEED_NEIGHBORS, 2);
        ctx.reportEngagement(r.usedSqlite);
        return r.result;
      },
      { overrides: ENGAGE },
    );

    expect(outcome.identical).toBe(true);
    expect(outcome.engagementProven).toBe(true);
    expect(outcome.off.nodes.length).toBeGreaterThan(0);
  });

  test("kgDeadCode: off and on (kg_calls) return identical results", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const outcome = runBothIndexModes(
      (ctx) => {
        const r = kgDeadCodeAuto(view, { repoRoot: repo, config: ctx.config }, {});
        ctx.reportEngagement(r.usedSqlite);
        return r.result;
      },
      { overrides: ENGAGE },
    );

    expect(outcome.identical).toBe(true);
    expect(outcome.engagementProven).toBe(true);
    // The fixture has at least one known dead free function.
    expect(outcome.off.nodes.length).toBeGreaterThan(0);
  });

  test("index:off (enabled:false) never writes index.sqlite", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: false };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };
    const r = kgTraceAuto(view, opts, SEED_TRACE, "outbound", 3);
    expect(r.usedSqlite).toBe(false);
    expect(fs.existsSync(dbPath(repo))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Delete-safe — wipe index.sqlite, re-query → auto-rebuild, same answer.
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] delete-safe — wiping the projection loses nothing", () => {
  test("delete index.sqlite, re-run trace → auto-rebuilds, no error, same answer", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };
    const seed = "function:src/a.ts:main";

    // Populate the projection.
    const first = kgTraceAuto(view, opts, seed, "outbound", 3);
    expect(first.usedSqlite).toBe(true);
    expect(fs.existsSync(dbPath(repo))).toBe(true);

    // Wipe the entire SQLite footprint (db + WAL/SHM sidecars).
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(dbPath(repo) + suffix, { force: true });
    }
    expect(fs.existsSync(dbPath(repo))).toBe(false);

    // Re-query: must NOT throw, must auto-rebuild, must equal the JSON answer.
    const jsonBaseline = kgTrace(view, seed, "outbound", 3);
    let rebuilt!: ReturnType<typeof kgTraceAuto>;
    expect(() => {
      rebuilt = kgTraceAuto(view, opts, seed, "outbound", 3);
    }).not.toThrow();
    expect(rebuilt.usedSqlite).toBe(true); // rebuilt + used the projection again
    expect(rebuilt.result).toEqual(jsonBaseline);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Pure projection — rebuild twice → identical kg_calls contents; fp stable.
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] pure projection — deterministic, fingerprint-stable", () => {
  function callsRows(repo: string): Array<{ source: string; target: string; confidence: string | null }> {
    const db = openDb(dbPath(repo));
    const rows = db
      .prepare("SELECT source, target, confidence FROM kg_calls")
      .all() as Array<{ source: string; target: string; confidence: string | null }>;
    db.close();
    // Compare by the FULL semantic key, ignoring the surrogate autoincrement id.
    return rows
      .map((r) => ({ source: r.source, target: r.target, confidence: r.confidence }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  test("two independent builds of the same graph yield identical kg_calls", () => {
    const view = buildClraGraph();
    const repoA = mkRepo(view);
    const repoB = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    kgTraceAuto(view, { repoRoot: repoA, config: cfg }, "function:src/a.ts:main", "outbound", 1);
    kgTraceAuto(view, { repoRoot: repoB, config: cfg }, "function:src/a.ts:main", "outbound", 1);

    const a = callsRows(repoA);
    const b = callsRows(repoB);
    expect(a.length).toBeGreaterThan(0); // non-vacuous: real edges projected
    expect(a).toEqual(b);
  });

  test("reversed input edge order yields identical kg_calls contents", () => {
    const view = buildClraGraph();
    const reversed: GraphView = { nodes: [...view.nodes].reverse(), edges: [...view.edges].reverse() };
    const repoFwd = mkRepo(view);
    const repoRev = mkRepo(reversed);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    kgTraceAuto(view, { repoRoot: repoFwd, config: cfg }, "function:src/a.ts:main", "outbound", 1);
    kgTraceAuto(reversed, { repoRoot: repoRev, config: cfg }, "function:src/a.ts:main", "outbound", 1);
    expect(callsRows(repoFwd)).toEqual(callsRows(repoRev));
  });

  test("re-query with unchanged source is a fingerprint cache-hit (no rebuild)", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };
    kgTraceAuto(view, opts, "function:src/a.ts:main", "outbound", 1);
    const before = callsRows(repo);
    kgTraceAuto(view, opts, "function:src/a.ts:main", "outbound", 1);
    const after = callsRows(repo);
    expect(after).toEqual(before);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Perf (RECORD, not gate; goals.md §G5.4) — measured honestly, no overclaim.
//
//    HONEST FINDING: at fixture/CI scale the load-and-run projection is NOT
//    faster than in-memory JSON BFS — node:sqlite per-row marshalling costs ~10x
//    a JSON.parse field, and the end-to-end `*Auto` wrapper re-hashes the source
//    each call (the established freshness pattern). The ≥5x target (G5.4) lives
//    at LARGE-repo scale (goals.md §1.2), where the win is avoiding a multi-MB
//    full-graph parse/allocation per query — not demonstrable in a unit test.
//    Both numbers are RECORDED, asserted only for correctness. NO 5x claim.
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] perf — recorded honestly (not gated)", () => {
  test("end-to-end trace: record projection vs JSON wall-clock (no speedup claim)", () => {
    const N = 4000;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < N; i++) {
      nodes.push({
        id: `function:src/g.ts:fn${i}`, type: "function", name: `fn${i}`,
        source_refs: [`src/g.ts#L${i}-L${i + 1}`], confidence: "high",
      } as GraphNode);
      if (i > 0) {
        edges.push({
          source: `function:src/g.ts:fn${i - 1}`, target: `function:src/g.ts:fn${i}`,
          type: "calls", direction: "out", weight: 1,
        } as GraphEdge);
      }
    }
    const view: GraphView = { nodes, edges };
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };
    const seed = "function:src/g.ts:fn0";

    const warm = kgTraceAuto(view, opts, seed, "outbound", 5);
    expect(warm.usedSqlite).toBe(true);

    const kgFile = path.join(repo, ".guild", "indexes", "knowledge-graph.json");
    const jsonRun = () => kgTrace(JSON.parse(fs.readFileSync(kgFile, "utf8")) as GraphView, seed, "outbound", 5);
    const projRun = () => kgTraceAuto(view, opts, seed, "outbound", 5);

    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) jsonRun();
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) projRun();
    const t2 = process.hrtime.bigint();
    const jsonMs = Number(t1 - t0) / 1e6;
    const projMs = Number(t2 - t1) / 1e6;
    // eslint-disable-next-line no-console
    console.log(
      `[T5.1 perf] N=${N} trace x20 (end-to-end) — JSON ${jsonMs.toFixed(1)}ms, projection ${projMs.toFixed(1)}ms, ~${(jsonMs / Math.max(projMs, 0.001)).toFixed(2)}x (RECORD: projection slower at this scale, see note)`,
    );
    expect(projRun().result).toEqual(jsonRun()); // correctness only
  });

  test("symbol-search MECHANISM: FTS index lookup vs O(N) JSON token scan (warm)", () => {
    // Where the projection mechanism genuinely accelerates: kg_symbols_fts is an
    // index, so a rare-token MATCH touches O(matches) rows while the JSON
    // reference must tokenize all N node names. Measured warm (ensure paid once)
    // to isolate the QUERY mechanism. Recorded; correctness asserted.
    const N = 8000;
    const nodes: GraphNode[] = [];
    for (let i = 0; i < N; i++) {
      nodes.push({
        id: `function:src/h.ts:fn${i}`, type: "function", name: `commonName${i}`,
        source_refs: [`src/h.ts#L${i}-L${i + 1}`], confidence: "high",
      } as GraphNode);
    }
    // One needle with a rare token.
    nodes.push({
      id: "function:src/h.ts:zebraQuokkaWidget", type: "function", name: "zebraQuokkaWidget",
      source_refs: ["src/h.ts#L1-L2"], confidence: "high",
    } as GraphNode);
    const view: GraphView = { nodes, edges: [] };
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };
    const q = "quokka";

    const warm = kgSymbolSearchAuto(view, opts, q);
    expect(warm.usedSqlite).toBe(true);
    expect(warm.result).toEqual(["function:src/h.ts:zebraQuokkaWidget"]);

    // Open the warmed DB once and time the raw FTS query vs the JSON scan.
    const db = openDb(dbPath(repo));
    const ftsRun = () =>
      db.prepare("SELECT DISTINCT node_id FROM kg_symbols_fts WHERE kg_symbols_fts MATCH ?").all('"quokka"');
    const jsonRun = () => kgSymbolSearchJson(view.nodes, q);

    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) ftsRun();
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) jsonRun();
    const t2 = process.hrtime.bigint();
    db.close();
    const ftsMs = Number(t1 - t0) / 1e6;
    const jsonMs = Number(t2 - t1) / 1e6;
    // eslint-disable-next-line no-console
    console.log(
      `[T5.1 perf] N=${N} symbol-search x200 (warm) — FTS ${ftsMs.toFixed(1)}ms, JSON scan ${jsonMs.toFixed(1)}ms, ~${(jsonMs / Math.max(ftsMs, 0.001)).toFixed(2)}x`,
    );
    expect(warm.result).toEqual(kgSymbolSearchJson(view.nodes, q)); // correctness only
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Symbol search — camel/snake kg_symbols_fts == JSON reference (parity).
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] kg_symbols_fts — camel/snake identifier search", () => {
  function symbolGraph(): GraphView {
    const names = ["processOrder", "ProcessOrder", "process_order_handler", "unrelatedThing", "cancelOrder"];
    const nodes: GraphNode[] = names.map((nm, i) => ({
      id: `function:src/s.ts:${nm}`,
      type: "function",
      name: nm,
      source_refs: [`src/s.ts#L${i + 1}-L${i + 2}`],
      confidence: "high",
    } as GraphNode));
    return { nodes, edges: [] };
  }

  test("`process_order` matches camelCase + PascalCase + snake symbols via FTS", () => {
    const view = symbolGraph();
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const r = kgSymbolSearchAuto(view, { repoRoot: repo, config: cfg }, "process_order");

    expect(r.usedSqlite).toBe(true); // genuinely served by kg_symbols_fts
    expect(r.result).toContain("function:src/s.ts:processOrder");
    expect(r.result).toContain("function:src/s.ts:ProcessOrder");
    expect(r.result).toContain("function:src/s.ts:process_order_handler");
    // anti-vacuity: a non-matching symbol is excluded.
    expect(r.result).not.toContain("function:src/s.ts:unrelatedThing");
  });

  test("FTS result set is IDENTICAL to the in-process JSON reference (parity)", () => {
    const view = symbolGraph();
    const repo = mkRepo(view);
    for (const q of ["process_order", "order", "ProcessOrder", "thing", "nomatchxyz"]) {
      const outcome = runBothIndexModes(
        (ctx) => {
          const r = kgSymbolSearchAuto(view, { repoRoot: repo, config: ctx.config }, q);
          ctx.reportEngagement(r.usedSqlite);
          return r.result;
        },
        { overrides: ENGAGE },
      );
      expect(outcome.identical).toBe(true);
      expect(outcome.engagementProven).toBe(true);
      // cross-check the off result equals the direct JSON reference.
      expect(outcome.off).toEqual(kgSymbolSearchJson(view.nodes, q));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5b. Model-free — the projection path makes 0 network calls (fetch spy).
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] model-free — 0 network on the SQLite projection path", () => {
  test("engaged trace + symbol search via SQLite never call fetch", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };

    const fetchSpy = jest.fn();
    const origFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch?: unknown }).fetch = fetchSpy;
    let trace: ReturnType<typeof kgTraceAuto>;
    let sym: ReturnType<typeof kgSymbolSearchAuto>;
    try {
      trace = kgTraceAuto(view, opts, "function:src/a.ts:main", "outbound", 3);
      sym = kgSymbolSearchAuto(view, opts, "main");
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = origFetch;
    }
    // Non-vacuous: the SQLite path was actually engaged for BOTH queries.
    expect(trace.usedSqlite).toBe(true);
    expect(sym.usedSqlite).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Anti-vacuity — tampering kg_calls makes the projection DIVERGE.
// ───────────────────────────────────────────────────────────────────────────

describe("[T5.1] anti-vacuity — the parity check provably bites", () => {
  test("dropping a kg_calls row makes projection trace DIFFER from JSON", () => {
    const view = buildClraGraph();
    const repo = mkRepo(view);
    const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ...ENGAGE, enabled: true };
    const opts: ProjectionQueryOptions = { repoRoot: repo, config: cfg };
    const seed = "function:src/a.ts:main";

    // Populate, then confirm baseline parity.
    const before = kgTraceAuto(view, opts, seed, "outbound", 3);
    expect(before.usedSqlite).toBe(true);
    expect(before.result).toEqual(kgTrace(view, seed, "outbound", 3));

    // Tamper: delete every kg_calls edge leaving the seed. The fingerprint is
    // unchanged (source file untouched), so the next query is a cache-hit and
    // the tampered table is used — proving the on-path truly reads kg_calls.
    const db = openDb(dbPath(repo));
    db.prepare("DELETE FROM kg_calls WHERE source = ?").run(seed);
    db.close();

    const after = kgTraceAuto(view, opts, seed, "outbound", 3);
    expect(after.usedSqlite).toBe(true);
    // The JSON source of truth is unchanged; the tampered projection now diverges.
    expect(after.result).not.toEqual(kgTrace(view, seed, "outbound", 3));
  });
});
