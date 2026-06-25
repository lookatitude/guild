/**
 * understand/__tests__/graph-query.test.ts
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
import * as path from "path";

import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge, GraphNode } from "../lib/schema";
import {
  kgTrace,
  kgNeighbors,
  kgDeadCode,
  kgEntryPoints,
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
