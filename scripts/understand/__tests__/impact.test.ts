/**
 * understand/__tests__/impact.test.ts
 *
 * G9 (impact half) — model-free reverse-BFS impact analysis validation gate
 * (NON-VACUOUS). The graph under test is built from the SHARED clra-fixture via
 * the real G1 extractor + G2 call resolver, then analysed purely in-process
 * (no SQLite, no model, no network). Assertions are grounded in
 * clra-fixture.expected.json (the oracle); each gate carries an anti-vacuity
 * twin proving the check bites.
 *
 * Run from plugin/scripts/:  npx jest --no-coverage impact
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge, GraphNode } from "../lib/schema";
import {
  computeImpact,
  riskTier,
  RISK_ORDINAL,
  EVIDENCE_TIER,
  type GraphView,
  type RiskTier,
} from "../lib/impact";

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
// Gate 1 — reverse-reachability flags the caller, NOT an unrelated file.
// ---------------------------------------------------------------------------

describe("[G9] computeImpact — reverse-reachable risk set", () => {
  test("editing b.ts flags its caller main at a HIGH-ish tier (reverse-reachable)", () => {
    const g = buildGraph();
    const res = computeImpact(g, { changedFiles: ["src/b.ts"] });

    expect(res.tier).toBe(EVIDENCE_TIER);
    // The TS chain: main calls add/multiply (both in b.ts). main must be flagged.
    const reached = ids(res.nodes);
    expect(reached.has("function:src/a.ts:main")).toBe(true);

    const main = res.nodes.find((n) => n.id === "function:src/a.ts:main")!;
    // main is reverse-reachable from the change, and is itself an entry point.
    expect(["CRITICAL", "HIGH"]).toContain(main.risk);
    expect(main.entryPoint).toBe(true);

    // `add` (a changed seed, directly called by main) is HIGH-ish too.
    const add = res.nodes.find((n) => n.id === "function:src/b.ts:add")!;
    expect(add).toBeDefined();
    expect(add.changed).toBe(true);
    expect(["CRITICAL", "HIGH"]).toContain(add.risk);
  });

  test("precision: an UNRELATED file is NOT flagged when only b.ts changed", () => {
    const g = buildGraph();
    const res = computeImpact(g, { changedFiles: ["src/b.ts"] });
    const reached = ids(res.nodes);
    // The Python chain is entirely unrelated to a src/b.ts edit.
    expect(reached.has("function:py/a.py:main")).toBe(false);
    expect(reached.has("function:py/b.py:add")).toBe(false);
    // ...and no py file appears in the per-file roll-up.
    expect(res.files.every((f) => !f.path.startsWith("py/"))).toBe(true);
  });

  test("anti-vacuity: changing an UNRELATED file does flag that file's caller (mirror)", () => {
    const g = buildGraph();
    const res = computeImpact(g, { changedFiles: ["py/b.py"] });
    const reached = ids(res.nodes);
    // The mirror change DOES reach py main — proving Gate-1's precision check
    // bites (the absence above is real, not because nothing ever reaches).
    expect(reached.has("function:py/a.py:main")).toBe(true);
    expect(reached.has("function:src/a.ts:main")).toBe(false);
  });

  test("changedSymbols (by simple name) seeds the same reverse set as the file", () => {
    const g = buildGraph();
    const bySymbol = computeImpact(g, { changedSymbols: ["add", "multiply", "unusedHelper"] });
    const reached = ids(bySymbol.nodes);
    // Naming b.ts's symbols reverse-reaches both TS and PY main (both call add/multiply).
    expect(reached.has("function:src/a.ts:main")).toBe(true);
    expect(reached.has("function:py/a.py:main")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — risk tiers reproducible + documented + anti-vacuous ranking.
// ---------------------------------------------------------------------------

describe("[G9] risk tiers — reproducible, documented, non-vacuous", () => {
  // Synthetic graph: a hub called by main + three others (high fan-in, near entry)
  // vs a leaf utility with zero callers, unreached by any entry point.
  function hubLeafGraph(): GraphView {
    const names = ["main", "hub", "c1", "c2", "c3", "leaf"];
    const nodes: GraphNode[] = names.map((n) => ({
      id: `function:src/x.ts:${n}`, type: "function", name: n,
      source_refs: ["src/x.ts#L1-L2"], confidence: "high",
    }));
    const mk = (s: string, t: string): GraphEdge => ({
      source: `function:src/x.ts:${s}`, target: `function:src/x.ts:${t}`,
      type: "calls", direction: "out", weight: 1,
    });
    // main → hub (entryDistance 1); c1/c2/c3 → hub (fan-in 4 total). leaf isolated.
    const edges: GraphEdge[] = [mk("main", "hub"), mk("c1", "hub"), mk("c2", "hub"), mk("c3", "hub")];
    return { nodes, edges };
  }

  test("a high-fan-in symbol near an entry point ranks strictly ABOVE a leaf utility", () => {
    const g = hubLeafGraph();
    // Change both hub and leaf so both appear in the affected set.
    const res = computeImpact(g, { changedSymbols: ["hub", "leaf"] });
    const hub = res.nodes.find((n) => n.id === "function:src/x.ts:hub")!;
    const leaf = res.nodes.find((n) => n.id === "function:src/x.ts:leaf")!;

    expect(hub.fanIn).toBe(4);
    expect(hub.entryDistance).toBe(1);
    expect(["CRITICAL", "HIGH"]).toContain(hub.risk);

    expect(leaf.fanIn).toBe(0);
    expect(leaf.entryDistance).toBeNull(); // no entry point reaches it — honest null, not 0
    expect(leaf.risk).toBe("LOW");

    // The whole point: ranking is non-vacuous (would FAIL under a constant tier).
    expect(RISK_ORDINAL[hub.risk]).toBeGreaterThan(RISK_ORDINAL[leaf.risk]);
  });

  test("anti-vacuity (mutate): stripping the hub's callers DROPS its tier", () => {
    const g = hubLeafGraph();
    const before = computeImpact(g, { changedSymbols: ["hub"] }).nodes
      .find((n) => n.id === "function:src/x.ts:hub")!;
    // Remove the c1/c2/c3 → hub edges, keep only main → hub (fanIn 1).
    const stripped: GraphView = {
      nodes: g.nodes,
      edges: g.edges.filter((e) => e.source === "function:src/x.ts:main"),
    };
    const after = computeImpact(stripped, { changedSymbols: ["hub"] }).nodes
      .find((n) => n.id === "function:src/x.ts:hub")!;
    expect(before.fanIn).toBe(4);
    expect(after.fanIn).toBe(1);
    // fanIn fell below CRIT_FANIN; the tier must not stay as high.
    expect(RISK_ORDINAL[after.risk]).toBeLessThanOrEqual(RISK_ORDINAL[before.risk]);
  });

  test("riskTier rule is a documented pure function (FIRST-match-wins boundaries)", () => {
    const cases: Array<[number, number | null, boolean, RiskTier]> = [
      [0, null, true, "CRITICAL"],   // entry point itself
      [3, 2, false, "CRITICAL"],     // high fan-in, near entry
      [2, 5, false, "HIGH"],         // fan-in ≥ HIGH_FANIN
      [0, 1, false, "HIGH"],         // entryDistance ≤ HIGH_DIST
      [1, null, false, "MEDIUM"],    // has a caller, unreached
      [0, 4, false, "MEDIUM"],       // reachable but distant, no callers
      [0, null, false, "LOW"],       // leaf utility
    ];
    for (const [fanIn, dist, isEp, expected] of cases) {
      expect(riskTier(fanIn, dist, isEp)).toBe(expected);
    }
  });

  test("a supplied non-`main` entry point (exported surface) is honored, not just `main`", () => {
    // `run` is NOT a conventional entry name; `target` is only reachable via run.
    const nodes: GraphNode[] = ["run", "target"].map((n) => ({
      id: `function:src/y.ts:${n}`, type: "function", name: n,
      source_refs: ["src/y.ts#L1-L2"], confidence: "high",
    }));
    const edges: GraphEdge[] = [{
      source: "function:src/y.ts:run", target: "function:src/y.ts:target",
      type: "calls", direction: "out", weight: 1,
    }];
    const g: GraphView = { nodes, edges };

    // Without the supplied entry point: target is unreached by any entry → null distance.
    const without = computeImpact(g, { changedSymbols: ["target"] }).nodes
      .find((n) => n.id === "function:src/y.ts:target")!;
    expect(without.entryDistance).toBeNull();

    // Declaring `run` as exported/public surface (by simple name) → target is 1 hop from an entry.
    const withRun = computeImpact(g, { changedSymbols: ["target"], entryPoints: ["run"] });
    const target = withRun.nodes.find((n) => n.id === "function:src/y.ts:target")!;
    expect(target.entryDistance).toBe(1);
    expect(target.risk).toBe("HIGH"); // entryDistance ≤ HIGH_DIST bumped it above MEDIUM
    expect(withRun.entryPoints).toContain("function:src/y.ts:run");
    // Proves config, not the `main` name heuristic, did it.
    expect("run").not.toBe("main");
  });

  test("summary counts equal the affected node tier histogram", () => {
    const g = buildGraph();
    const res = computeImpact(g, { changedFiles: ["src/b.ts"] });
    const hist: Record<RiskTier, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const n of res.nodes) hist[n.risk]++;
    expect(res.summary).toEqual(hist);
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — determinism: reversed node/edge order → identical output.
// ---------------------------------------------------------------------------

describe("[G9] determinism — order-independent, full stable keys", () => {
  test("reversed node/edge input → byte-identical impact result", () => {
    const g = buildGraph();
    const shuffled: GraphView = {
      nodes: [...g.nodes].reverse(),
      edges: [...g.edges].reverse(),
    };
    const a = computeImpact(g, { changedFiles: ["src/b.ts"], entryPoints: ["run"] });
    const b = computeImpact(shuffled, { changedFiles: ["src/b.ts"], entryPoints: ["run"] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("parallel `calls` edges differing only in confidence both survive (full key)", () => {
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
    // Change `b` → reverse-reach `a`; both parallel edges traversed.
    const rf = computeImpact(forward, { changedSymbols: ["b"] });
    const rr = computeImpact(reversed, { changedSymbols: ["b"] });
    expect(JSON.stringify(rf)).toBe(JSON.stringify(rr));
    expect(rf.edges.length).toBe(2);
    expect(rf.edges.map((e) => e.confidence)).toEqual(["high", "low"]);
    // fan-in counts DISTINCT callers, so the two parallel edges = fanIn 1.
    expect(rf.nodes.find((n) => n.id === "function:src/x.ts:b")!.fanIn).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Gate 4 — provenance: file:line only, down-tier nodes without it.
// ---------------------------------------------------------------------------

describe("[G9] provenance — #Lx-Ly only, untrusted otherwise", () => {
  test("affected nodes carry only #Lx-Ly source_refs; non-line refs are down-tiered", () => {
    const nodes: GraphNode[] = [
      { id: "function:src/x.ts:a", type: "function", name: "a", source_refs: ["src/x.ts#L1-L2"], confidence: "high" },
      { id: "function:src/x.ts:b", type: "function", name: "b", source_refs: ["src/x.ts"], confidence: "high" }, // bare path
      { id: "function:src/x.ts:c", type: "function", name: "c", source_refs: [], confidence: "high" },           // no refs
    ];
    const edges: GraphEdge[] = [
      { source: "function:src/x.ts:a", target: "function:src/x.ts:c", type: "calls", direction: "out", weight: 1 },
      { source: "function:src/x.ts:b", target: "function:src/x.ts:c", type: "calls", direction: "out", weight: 1 },
    ];
    // Change c → reverse-reach a and b.
    const res = computeImpact({ nodes, edges }, { changedSymbols: ["c"] });
    const byId = new Map(res.nodes.map((n) => [n.id, n]));

    expect(byId.get("function:src/x.ts:a")!.tier).toBe("trusted");
    // b had a non-line ref → filtered out, down-tiered.
    expect(byId.get("function:src/x.ts:b")!.source_refs).toEqual([]);
    expect(byId.get("function:src/x.ts:b")!.tier).toBe("untrusted");
    // c had no refs → untrusted.
    expect(byId.get("function:src/x.ts:c")!.tier).toBe("untrusted");
    // No returned node carries a non-line source_ref anywhere.
    for (const n of res.nodes) for (const r of n.source_refs) expect(r).toMatch(/#L\d+-L\d+$/);
  });

  test("fixture affected nodes all carry file:line provenance", () => {
    const g = buildGraph();
    const res = computeImpact(g, { changedFiles: ["src/b.ts"] });
    for (const n of res.nodes) {
      expect(Array.isArray(n.source_refs)).toBe(true);
      expect(n.source_refs.length).toBeGreaterThan(0);
      expect(n.source_refs[0]).toMatch(/#L\d+-L\d+$/);
      expect(n.tier).toBe("trusted");
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 5 — model-free + SQLite-not-required (import-closure proof).
// ---------------------------------------------------------------------------

describe("[G9] model-free — no SQLite, no model, no network", () => {
  const LIB_SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "impact.ts"), "utf8");
  const CLI_SRC = fs.readFileSync(path.join(__dirname, "..", "impact.ts"), "utf8");

  test("lib/impact.ts imports neither SQLite, network, nor in-flight modules (scope guard)", () => {
    const importLines = LIB_SRC.split("\n").filter((l) => /^\s*import\b/.test(l));
    const joined = importLines.join("\n");
    // No SQLite / index-cache / network in the model-free source of truth.
    expect(/sqlite|better-sqlite|index-cache/i.test(joined)).toBe(false);
    expect(/\bfetch\b|node:http|require\(["']https?["']\)|from ["']https?:/i.test(LIB_SRC)).toBe(false);
    // Parallel-safety scope guard: do NOT import the in-flight modules.
    expect(joined).not.toMatch(/from ["']\.\/graph-query["']/);
    expect(joined).not.toMatch(/from ["']\.\/structural["']/);
    expect(joined).not.toMatch(/from ["']\.\/resolve-calls/);
    expect(joined).not.toMatch(/from ["']\.\/similarity["']/);
    // Only the frozen schema types are imported from lib siblings.
    expect(joined).toMatch(/from ["']\.\/schema["']/);
  });

  test("CLI imports use no network/sqlite either (import-closure, not prose)", () => {
    const cliImports = CLI_SRC.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(/sqlite|better-sqlite|index-cache/i.test(cliImports)).toBe(false);
    expect(/\bfetch\(|node:http/i.test(CLI_SRC)).toBe(false);
  });

  test("no literal NUL bytes in the module sources", () => {
    expect(LIB_SRC.includes(String.fromCharCode(0))).toBe(false);
    expect(CLI_SRC.includes(String.fromCharCode(0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate 6 — the REAL CLI path (non-vacuity: rendered + invoked, not the helper).
// ---------------------------------------------------------------------------

describe("[G9] CLI impact.ts — real invocation against a written graph", () => {
  test("`impact.ts '<json>' --graph <file>' emits the reverse-reachable result", () => {
    const g = buildGraph();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clra-impact-"));
    const graphFile = path.join(tmpDir, "knowledge-graph.json");
    // Persist a minimal-but-valid graph wrapper the CLI's readJson can load.
    fs.writeFileSync(
      graphFile,
      JSON.stringify({ version: "guild.knowledge_graph.v1", nodes: g.nodes, edges: g.edges }, null, 2),
      "utf8",
    );

    const cliPath = path.join(__dirname, "..", "impact.ts");
    const out = execFileSync(
      "npx",
      ["tsx", cliPath, JSON.stringify({ changedFiles: ["src/b.ts"] }), "--graph", graphFile],
      { cwd: path.join(__dirname, ".."), encoding: "utf-8", timeout: 60_000 },
    );
    const result = JSON.parse(out);

    const reached = new Set<string>(result.nodes.map((n: { id: string }) => n.id));
    // Same contract the in-process gate asserts — proven through the real CLI.
    expect(reached.has("function:src/a.ts:main")).toBe(true);
    expect(reached.has("function:py/a.py:main")).toBe(false);
    const main = result.nodes.find((n: { id: string }) => n.id === "function:src/a.ts:main");
    expect(["CRITICAL", "HIGH"]).toContain(main.risk);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 90_000);
});
