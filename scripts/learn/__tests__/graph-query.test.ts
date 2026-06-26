/**
 * learn/__tests__/graph-query.test.ts
 *
 * G3 — model-free structural query library validation gate (NON-VACUOUS).
 *
 * The graph under test is built from the SHARED clra-fixture via the real
 * G1 extractor + G2 call resolver, then queried purely in-process (no SQLite,
 * no model). Every assertion is grounded in clra-fixture.expected.json (the
 * oracle), and each gate carries an anti-vacuity twin proving the check bites.
 *
 * Run from plugin/scripts/:  npx jest --no-coverage graph-query
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge, GraphNode } from "../lib/schema";
import {
  kgTrace,
  kgNeighbors,
  kgDeadCode,
  kgEntryPoints,
  resolveEntryPointConfig,
  EVIDENCE_TIER,
  type GraphView,
} from "../lib/graph-query";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "clra-fixture");
const ORACLE_PATH = path.join(FIXTURE_ROOT, "clra-fixture.expected.json");
const REL_FILES = [
  "src/a.ts", "src/b.ts", "src/shapes.ts",
  "py/a.py", "py/b.py", "py/shapes.py",
];

interface Oracle {
  calls: Array<{ from: string; to: string; cross_file: boolean }>;
  deadCode: string[];
  entryPoints: string[];
}

function loadOracle(): Oracle {
  return JSON.parse(fs.readFileSync(ORACLE_PATH, "utf8")) as Oracle;
}

const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

function buildGraph(): GraphView {
  const base = extractStructuralGraph(FIXTURE_ROOT, REL_FILES, readFile);
  const refined = refineCalls(FIXTURE_ROOT, REL_FILES, readFile, base);
  return { nodes: refined.nodes as GraphNode[], edges: refined.edges as GraphEdge[] };
}

const ids = (xs: Array<{ id: string }>) => new Set(xs.map((x) => x.id));

// ---------------------------------------------------------------------------
// Gate 1 — kgTrace returns the known chain; depth bound respected.
// ---------------------------------------------------------------------------

describe("[G3] kgTrace — depth-bounded call-chain BFS", () => {
  test("outbound from main returns its direct callees (the known chain)", () => {
    const g = buildGraph();
    const o = loadOracle();
    const res = kgTrace(g, "function:src/a.ts:main", "outbound", 3);

    expect(res.tier).toBe(EVIDENCE_TIER);
    expect(res.seeds).toEqual(["function:src/a.ts:main"]);

    const reached = ids(res.nodes);
    // every oracle call FROM main (the TS chain) is reached
    for (const c of o.calls.filter((c) => c.from === "function:src/a.ts:main")) {
      expect(reached.has(c.to)).toBe(true);
    }
    // the seed itself is present at depth 0
    expect(res.nodes.find((n) => n.id === "function:src/a.ts:main")!.depth).toBe(0);
  });

  test("depth bound is HARD: no node beyond depth N", () => {
    const g = buildGraph();
    // main's callees are leaves, so depth-1 already covers the chain. Assert the
    // bound mechanism on a synthetic 3-deep chain to prove N is respected.
    const chain: GraphView = {
      nodes: ["a", "b", "c", "d"].map((n) => ({
        id: `function:src/x.ts:${n}`, type: "function", name: n,
        source_refs: [`src/x.ts#L1-L2`], confidence: "high",
      })),
      edges: [
        ["a", "b"], ["b", "c"], ["c", "d"],
      ].map(([s, t]) => ({
        source: `function:src/x.ts:${s}`, target: `function:src/x.ts:${t}`,
        type: "calls", direction: "out", weight: 1,
      })),
    };
    const r2 = kgTrace(chain, "function:src/x.ts:a", "outbound", 2);
    const reached = ids(r2.nodes);
    expect(reached.has("function:src/x.ts:c")).toBe(true);   // depth 2 included
    expect(reached.has("function:src/x.ts:d")).toBe(false);  // depth 3 excluded
    // every returned node's depth is within the bound
    expect(r2.nodes.every((n) => n.depth <= 2)).toBe(true);
  });

  test("anti-vacuity: a node OFF the chain is absent", () => {
    const g = buildGraph();
    const res = kgTrace(g, "function:src/a.ts:main", "outbound", 5);
    const reached = ids(res.nodes);
    // unusedHelper is never called by main — must not appear at any depth.
    expect(reached.has("function:src/b.ts:unusedHelper")).toBe(false);
  });

  test("inbound trace recovers the caller (reverse chain)", () => {
    const g = buildGraph();
    const res = kgTrace(g, "function:src/b.ts:add", "inbound", 3);
    expect(ids(res.nodes).has("function:src/a.ts:main")).toBe(true);
  });

  test("results carry file:line source_refs", () => {
    const g = buildGraph();
    const res = kgTrace(g, "function:src/a.ts:main", "outbound", 1);
    for (const n of res.nodes) {
      expect(Array.isArray(n.source_refs)).toBe(true);
      expect(n.source_refs.length).toBeGreaterThan(0);
      expect(n.source_refs[0]).toMatch(/#L\d+-L\d+$/); // path#Lx-Ly provenance
    }
  });

  // ── Finding 1: full-stable-key edge de-dupe (reversed input → identical) ──
  test("determinism: parallel `calls` edges with differing metadata survive input reversal", () => {
    const nodes: GraphNode[] = ["a", "b"].map((n) => ({
      id: `function:src/x.ts:${n}`, type: "function", name: n,
      source_refs: ["src/x.ts#L1-L2"], confidence: "high",
    }));
    const mk = (confidence: string): GraphEdge => ({
      source: "function:src/x.ts:a", target: "function:src/x.ts:b",
      type: "calls", direction: "out", weight: 1, confidence,
    });
    const forward: GraphView = { nodes, edges: [mk("high"), mk("low")] };
    const reversed: GraphView = { nodes: [...nodes].reverse(), edges: [mk("low"), mk("high")] };

    const rf = kgTrace(forward, "function:src/x.ts:a", "outbound", 2);
    const rr = kgTrace(reversed, "function:src/x.ts:a", "outbound", 2);

    // Reversed input → byte-identical output (would DIFFER under source->target keying).
    expect(JSON.stringify(rf)).toBe(JSON.stringify(rr));
    // Both parallel edges retained (NOT collapsed to one), sorted by full key.
    expect(rf.edges.length).toBe(2);
    expect(rf.edges.map((e) => e.confidence)).toEqual(["high", "low"]);
  });

  // ── Finding 2: provenance enforcement — never pass through non-line refs ──
  test("a node without #Lx-Ly provenance is down-tiered, never passed through as trusted", () => {
    const nodes: GraphNode[] = [
      { id: "function:src/x.ts:a", type: "function", name: "a", source_refs: ["src/x.ts#L1-L2"], confidence: "high" },
      { id: "function:src/x.ts:b", type: "function", name: "b", source_refs: ["src/x.ts"], confidence: "high" }, // bare path, no line range
      { id: "function:src/x.ts:c", type: "function", name: "c", source_refs: [], confidence: "high" },           // no refs at all
    ];
    const edges: GraphEdge[] = [
      { source: "function:src/x.ts:a", target: "function:src/x.ts:b", type: "calls", direction: "out", weight: 1 },
      { source: "function:src/x.ts:a", target: "function:src/x.ts:c", type: "calls", direction: "out", weight: 1 },
    ];
    const g: GraphView = { nodes, edges };
    const res = kgTrace(g, "function:src/x.ts:a", "outbound", 2);
    const byId = new Map(res.nodes.map((n) => [n.id, n]));

    expect(byId.get("function:src/x.ts:a")!.tier).toBe("trusted");
    // b had a non-line ref → filtered out and down-tiered.
    expect(byId.get("function:src/x.ts:b")!.source_refs).toEqual([]);
    expect(byId.get("function:src/x.ts:b")!.tier).toBe("untrusted");
    // c had no refs → untrusted (never silently trusted).
    expect(byId.get("function:src/x.ts:c")!.tier).toBe("untrusted");
    // No returned node carries a non-line source_ref anywhere.
    for (const n of res.nodes) for (const r of n.source_refs) expect(r).toMatch(/#L\d+-L\d+$/);

    // Same enforcement on the kgNeighbors path (Finding 2 cited kgNeighbors).
    const nb = kgNeighbors(g, "function:src/x.ts:a", 1);
    const nbById = new Map(nb.nodes.map((n) => [n.id, n]));
    expect(nbById.get("function:src/x.ts:b")!.tier).toBe("untrusted");
    expect(nbById.get("function:src/x.ts:b")!.source_refs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — kgDeadCode equals oracle.deadCode (precision & recall = 1.0).
// ---------------------------------------------------------------------------

describe("[G3] kgDeadCode — zero-inbound free functions minus entry points", () => {
  test("dead-code list EQUALS oracle.deadCode (precision & recall = 1.0)", () => {
    const g = buildGraph();
    const o = loadOracle();
    const dead = new Set(kgDeadCode(g).nodes.map((n) => n.id));
    expect(dead).toEqual(new Set(o.deadCode));
  });

  test("entry points are excluded from dead code", () => {
    const g = buildGraph();
    const o = loadOracle();
    const dead = new Set(kgDeadCode(g).nodes.map((n) => n.id));
    for (const ep of o.entryPoints) expect(dead.has(ep)).toBe(false);
    // and the entry points are recognised as such
    const eps = new Set(kgEntryPoints(g).map((n) => n.id));
    for (const ep of o.entryPoints) expect(eps.has(ep)).toBe(true);
  });

  test("anti-vacuity: adding a caller to a dead fn removes it from the list", () => {
    const g = buildGraph();
    expect(new Set(kgDeadCode(g).nodes.map((n) => n.id)).has("function:src/b.ts:unusedHelper")).toBe(true);

    const withCaller: GraphView = {
      nodes: g.nodes,
      edges: [
        ...g.edges,
        {
          source: "function:src/a.ts:main", target: "function:src/b.ts:unusedHelper",
          type: "calls", direction: "out", weight: 1,
        },
      ],
    };
    expect(new Set(kgDeadCode(withCaller).nodes.map((n) => n.id)).has("function:src/b.ts:unusedHelper")).toBe(false);
  });

  test("methods are not flagged dead (model-free scope guard)", () => {
    const g = buildGraph();
    const dead = new Set(kgDeadCode(g).nodes.map((n) => n.id));
    // zero-inbound methods exist in the fixture but must NOT be reported.
    expect(dead.has("function:src/shapes.ts:Shape.area")).toBe(false);
    expect(dead.has("function:py/shapes.py:Circle.__init__")).toBe(false);
  });

  // ── Findings 3 & 4: exported/public surface excluded via config (not just `main`) ──
  test("a non-`main` entry point supplied by simple name is NOT reported dead", () => {
    const g = buildGraph();
    // Baseline: unusedHelper has zero inbound calls → dead by default.
    expect(new Set(kgDeadCode(g).nodes.map((n) => n.id)).has("function:src/b.ts:unusedHelper")).toBe(true);
    // Declare it exported/public surface by simple name → excluded.
    const dead = new Set(kgDeadCode(g, { entryPoints: ["unusedHelper"] }).nodes.map((n) => n.id));
    expect(dead.has("function:src/b.ts:unusedHelper")).toBe(false);
    // The supplied entry point is NOT a conventional `main` — proves config, not the name heuristic, did it.
    expect("unusedHelper").not.toBe("main");
  });

  test("a non-`main` entry point supplied by full node id is NOT reported dead", () => {
    const g = buildGraph();
    const dead = new Set(
      kgDeadCode(g, { entryPoints: ["function:src/b.ts:unusedHelper"] }).nodes.map((n) => n.id),
    );
    expect(dead.has("function:src/b.ts:unusedHelper")).toBe(false);
  });

  test("default (no config) still equals the oracle — claim stays scoped to internal reachability", () => {
    const g = buildGraph();
    const o = loadOracle();
    // An unrelated name in the config must not perturb the default oracle match.
    expect(new Set(kgDeadCode(g, { entryPoints: ["does-not-exist"] }).nodes.map((n) => n.id)))
      .toEqual(new Set(o.deadCode));
  });

  // ── Round-3 Finding 1: entry by FILE RELPATH (manifest marks a whole file public) ──
  test("an entry supplied by file relpath excludes every free function in that file", () => {
    const g = buildGraph();
    // unusedHelper lives in src/b.ts; declaring the file as public surface excludes it.
    expect(new Set(kgDeadCode(g).nodes.map((n) => n.id)).has("function:src/b.ts:unusedHelper")).toBe(true);
    const dead = new Set(kgDeadCode(g, { entryPoints: ["src/b.ts"] }).nodes.map((n) => n.id));
    expect(dead.has("function:src/b.ts:unusedHelper")).toBe(false);
    // A leading "./" on the same path is normalised to the same match.
    const deadDot = new Set(kgDeadCode(g, { entryPoints: ["./src/b.ts"] }).nodes.map((n) => n.id));
    expect(deadDot.has("function:src/b.ts:unusedHelper")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate 2b — Round-3 Finding 2: kgEntryPoints honours configured entries.
// ---------------------------------------------------------------------------

describe("[G3] kgEntryPoints — name-heuristic + configured entries (Finding 2)", () => {
  test("default returns the oracle entry points (name heuristic only)", () => {
    const g = buildGraph();
    const o = loadOracle();
    const eps = new Set(kgEntryPoints(g).map((n) => n.id));
    for (const ep of o.entryPoints) expect(eps.has(ep)).toBe(true);
  });

  test("a configured non-`main` entry (by simple name) IS included in kgEntryPoints", () => {
    const g = buildGraph();
    // Baseline: unusedHelper is NOT an entry point by the name heuristic alone.
    expect(new Set(kgEntryPoints(g).map((n) => n.id)).has("function:src/b.ts:unusedHelper")).toBe(false);
    // Configure it → now kgEntryPoints includes it (was the round-3 MAJOR: it ignored config).
    const eps = new Set(kgEntryPoints(g, { entryPoints: ["unusedHelper"] }).map((n) => n.id));
    expect(eps.has("function:src/b.ts:unusedHelper")).toBe(true);
    expect("unusedHelper").not.toBe("main"); // proves config, not the name heuristic
  });

  test("a configured entry by full node id IS included in kgEntryPoints", () => {
    const g = buildGraph();
    const eps = new Set(
      kgEntryPoints(g, { entryPoints: ["function:src/b.ts:unusedHelper"] }).map((n) => n.id),
    );
    expect(eps.has("function:src/b.ts:unusedHelper")).toBe(true);
  });

  test("a configured entry by file relpath includes every free function in that file", () => {
    const g = buildGraph();
    const eps = new Set(kgEntryPoints(g, { entryPoints: ["src/b.ts"] }).map((n) => n.id));
    expect(eps.has("function:src/b.ts:unusedHelper")).toBe(true);
  });

  test("dead-code and entry-points use ONE consistent rule (a configured entry is in EPs and not dead)", () => {
    const g = buildGraph();
    const cfg = { entryPoints: ["function:src/b.ts:unusedHelper"] };
    const eps = new Set(kgEntryPoints(g, cfg).map((n) => n.id));
    const dead = new Set(kgDeadCode(g, cfg).nodes.map((n) => n.id));
    expect(eps.has("function:src/b.ts:unusedHelper")).toBe(true);
    expect(dead.has("function:src/b.ts:unusedHelper")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — kgNeighbors + determinism + perf.
// ---------------------------------------------------------------------------

describe("[G3] kgNeighbors + determinism + perf", () => {
  test("1-hop neighbourhood of main includes its callees, excludes the seed", () => {
    const g = buildGraph();
    const res = kgNeighbors(g, "function:src/a.ts:main", 1);
    const reached = ids(res.nodes);
    expect(reached.has("function:src/b.ts:add")).toBe(true);
    expect(reached.has("function:src/a.ts:main")).toBe(false); // seed excluded
  });

  test("determinism: same graph → byte-identical output (order-independent)", () => {
    const g = buildGraph();
    const shuffled: GraphView = {
      nodes: [...g.nodes].reverse(),
      edges: [...g.edges].reverse(),
    };
    expect(JSON.stringify(kgDeadCode(shuffled))).toBe(JSON.stringify(kgDeadCode(g)));
    expect(JSON.stringify(kgTrace(shuffled, "function:src/a.ts:main", "outbound", 3)))
      .toBe(JSON.stringify(kgTrace(g, "function:src/a.ts:main", "outbound", 3)));
    expect(JSON.stringify(kgNeighbors(shuffled, "function:src/a.ts:main", 2)))
      .toBe(JSON.stringify(kgNeighbors(g, "function:src/a.ts:main", 2)));
  });

  test("query latency < 50 ms on the fixture (perf note, not a hard gate)", () => {
    const g = buildGraph();
    const t0 = process.hrtime.bigint();
    kgTrace(g, "function:src/a.ts:main", "both", 5);
    kgNeighbors(g, "function:src/a.ts:main", 3);
    kgDeadCode(g);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // eslint-disable-next-line no-console
    console.log(`[G3 perf] trace+neighbors+deadcode = ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Gate 4 — seed resolution by name OR id.
// ---------------------------------------------------------------------------

describe("[G3] seed resolution by name | id", () => {
  test("trace resolves a bare name ('main') to the matching node ids", () => {
    const g = buildGraph();
    const res = kgTrace(g, "main", "outbound", 2);
    // both src and py main resolve; their callees are all reached.
    expect(res.seeds).toEqual(["function:py/a.py:main", "function:src/a.ts:main"]);
    expect(ids(res.nodes).has("function:src/b.ts:add")).toBe(true);
    expect(ids(res.nodes).has("function:py/b.py:add")).toBe(true);
  });

  test("an unknown seed yields empty, well-formed evidence (no throw)", () => {
    const g = buildGraph();
    const res = kgTrace(g, "function:src/nope.ts:ghost", "outbound", 3);
    expect(res.seeds).toEqual([]);
    expect(res.nodes).toEqual([]);
    expect(res.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gate 5 — the REAL CLI path with REAL on-disk entry-point sources (Finding 1).
//
// Round-2 made entry points config-injectable only via the JSON arg, and the
// test injected `{entryPoints:["orphan"]}` directly. Codex round-3 = the config
// "isn't real": the CLI read no on-disk surface. These tests build an actual repo
// on disk (package.json / .guild/settings.json / .guild/indexes/entry_points.json)
// and run `dead-code {}` with NO JSON injection — anti-vacuity: remove the entry
// from the on-disk source → the function is reported dead again.
// ---------------------------------------------------------------------------

describe("[G3] graph-query.ts CLI — dead-code reads a REAL on-disk entry surface", () => {
  const SCRIPTS_DIR = path.resolve(__dirname, "..", "..");
  const CLI = path.join(SCRIPTS_DIR, "learn", "graph-query.ts");

  // main→run chain (heuristic entry `main`) + a free `orphan` with zero inbound
  // calls in its OWN file src/lib.ts. The bare (non-line) ref exercises the
  // provenance down-tiering on the real CLI path too.
  const GRAPH = {
    version: "guild.knowledge_graph.v1",
    project: { name: "cli-fixture", description: "" },
    generated_from_commit: "x",
    nodes: [
      { id: "function:src/a.ts:main", type: "function", name: "main", source_refs: ["src/a.ts#L1-L2"], confidence: "high" },
      { id: "function:src/a.ts:run", type: "function", name: "run", source_refs: ["src/a.ts#L5-L9"], confidence: "high" },
      { id: "function:src/lib.ts:orphan", type: "function", name: "orphan", source_refs: ["src/lib.ts"], confidence: "high" },
    ],
    edges: [
      { source: "function:src/a.ts:main", target: "function:src/a.ts:run", type: "calls", direction: "out", weight: 1, confidence: "high" },
    ],
    layers: [],
    tour: [],
  };

  /**
   * Build a real on-disk repo: graph at .guild/indexes/knowledge-graph.json plus
   * the optional manifest/settings/override files. Returns the repo root, which
   * is passed as --cwd so the CLI resolves its entry sources from THIS repo (not
   * the plugin's). The tmpdir is not a git repo, so guildPaths falls back to it.
   */
  function makeRepo(files: {
    packageJson?: object;
    settings?: object;
    entryPointsJson?: unknown;
  }): { repo: string; graphPath: string } {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g3-repo-")));
    const indexes = path.join(repo, ".guild", "indexes");
    fs.mkdirSync(indexes, { recursive: true });
    const graphPath = path.join(indexes, "knowledge-graph.json");
    fs.writeFileSync(graphPath, JSON.stringify(GRAPH), "utf8");
    if (files.packageJson) fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify(files.packageJson), "utf8");
    if (files.settings) fs.writeFileSync(path.join(repo, ".guild", "settings.json"), JSON.stringify(files.settings), "utf8");
    if (files.entryPointsJson !== undefined) fs.writeFileSync(path.join(indexes, "entry_points.json"), JSON.stringify(files.entryPointsJson), "utf8");
    return { repo, graphPath };
  }

  function runCli(verb: string, args: object, repo: string, graphPath: string): unknown {
    const out = execFileSync(
      "npx",
      ["tsx", CLI, verb, JSON.stringify(args), "--cwd", repo, "--graph", graphPath],
      { cwd: SCRIPTS_DIR, encoding: "utf8" },
    );
    return JSON.parse(out);
  }
  const deadIds = (r: unknown) => new Set((r as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id));

  test("anti-vacuity: with NO on-disk entry for orphan, `dead-code {}` reports it (down-tiered)", () => {
    const { repo, graphPath } = makeRepo({ packageJson: { name: "x", main: "src/a.ts" } });
    const res = runCli("dead-code", {}, repo, graphPath) as { nodes: Array<{ id: string; tier: string; source_refs: string[] }> };
    const orphan = res.nodes.find((n) => n.id === "function:src/lib.ts:orphan");
    expect(orphan).toBeDefined();              // not in package.json main → still dead
    expect(orphan!.tier).toBe("untrusted");    // bare ref → no line provenance
    expect(orphan!.source_refs).toEqual([]);   // non-line ref filtered, never passed through
  }, 30000);

  test("package.json `main` (ON DISK) excludes orphan from `dead-code {}` — no JSON injection", () => {
    const { repo, graphPath } = makeRepo({ packageJson: { name: "x", main: "src/lib.ts" } });
    expect(deadIds(runCli("dead-code", {}, repo, graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
  }, 30000);

  test("package.json `bin` map and `exports` tree (ON DISK) also exclude orphan", () => {
    const binRepo = makeRepo({ packageJson: { name: "x", bin: { "x-cli": "src/lib.ts" } } });
    expect(deadIds(runCli("dead-code", {}, binRepo.repo, binRepo.graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
    const expRepo = makeRepo({ packageJson: { name: "x", exports: { ".": { import: "src/lib.ts" } } } });
    expect(deadIds(runCli("dead-code", {}, expRepo.repo, expRepo.graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
  }, 30000);

  test(".guild/settings.json `models.entryPoints` (ON DISK) excludes orphan", () => {
    const { repo, graphPath } = makeRepo({ settings: { models: { entryPoints: ["orphan"] } } });
    expect(deadIds(runCli("dead-code", {}, repo, graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
  }, 30000);

  test(".guild/indexes/entry_points.json override (ON DISK) excludes orphan", () => {
    const { repo, graphPath } = makeRepo({ entryPointsJson: ["function:src/lib.ts:orphan"] });
    expect(deadIds(runCli("dead-code", {}, repo, graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
  }, 30000);

  test("explicit JSON `entryPoints` is still unioned in (and `exported` alias works)", () => {
    const { repo, graphPath } = makeRepo({}); // no on-disk entry sources at all
    expect(deadIds(runCli("dead-code", {}, repo, graphPath)).has("function:src/lib.ts:orphan")).toBe(true);
    expect(deadIds(runCli("dead-code", { entryPoints: ["orphan"] }, repo, graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
    expect(deadIds(runCli("dead-code", { exported: ["function:src/lib.ts:orphan"] }, repo, graphPath)).has("function:src/lib.ts:orphan")).toBe(false);
  }, 30000);

  // Finding 2 on the REAL CLI: entry-points verb reflects the on-disk surface.
  test("`entry-points {}` includes the package.json-configured entry (Finding 2, real CLI)", () => {
    const { repo, graphPath } = makeRepo({ packageJson: { name: "x", main: "src/lib.ts" } });
    const ids = deadIds(runCli("entry-points", {}, repo, graphPath));
    expect(ids.has("function:src/lib.ts:orphan")).toBe(true); // configured via manifest
    expect(ids.has("function:src/a.ts:main")).toBe(true);     // name heuristic still applies
  }, 30000);
});

// ---------------------------------------------------------------------------
// Gate 6 — resolveEntryPointConfig unit: REAL on-disk union + precedence.
// ---------------------------------------------------------------------------

describe("[G3] resolveEntryPointConfig — on-disk union (model-free, injectable reader)", () => {
  test("unions package.json + settings + entry_points.json + explicit (sorted, normalised)", () => {
    const fsmap: Record<string, string> = {
      "/repo/package.json": JSON.stringify({ main: "./src/lib.ts", bin: { cli: "src/cli.ts" }, exports: { ".": "src/index.ts" } }),
      "/repo/.guild/settings.json": JSON.stringify({ models: { entryPoints: ["handler"] } }),
      "/repo/.guild/indexes/entry_points.json": JSON.stringify({ entryPoints: ["function:src/x.ts:run"] }),
    };
    const read = (p: string) => {
      const v = fsmap[p.replace(/\\/g, "/")];
      if (v === undefined) throw new Error("ENOENT " + p);
      return v;
    };
    const got = resolveEntryPointConfig({
      repoRoot: "/repo",
      explicit: ["extra"],
      readFile: read,
    });
    // "./src/lib.ts" normalised to "src/lib.ts"; everything sorted + de-duped.
    expect(got).toEqual([
      "extra",
      "function:src/x.ts:run",
      "handler",
      "src/cli.ts",
      "src/index.ts",
      "src/lib.ts",
    ]);
  });

  test("missing/malformed sources are skipped silently (only explicit survives)", () => {
    const read = (_p: string) => { throw new Error("ENOENT"); };
    expect(resolveEntryPointConfig({ repoRoot: "/repo", explicit: ["only"], readFile: read })).toEqual(["only"]);
    // malformed package.json → skipped, not thrown
    const read2 = (p: string) => (p.endsWith("package.json") ? "{not json" : (() => { throw new Error("ENOENT"); })());
    expect(resolveEntryPointConfig({ repoRoot: "/repo", readFile: read2 })).toEqual([]);
  });
});
