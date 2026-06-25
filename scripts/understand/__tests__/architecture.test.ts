/**
 * understand/__tests__/architecture.test.ts
 *
 * G9 (architecture half) — model-free architecture-skeleton validation gate
 * (NON-VACUOUS). The graph under test is built from the SHARED clra-fixture via
 * the real G1 extractor + G2 call resolver, then analysed purely in-process
 * (no SQLite, no model, no network). Assertions are grounded in the fixture's
 * hand-labeled module structure; each gate carries an anti-vacuity twin proving
 * the check bites.
 *
 * Validation gate (lane T9.2):
 *   1. Clustering yields exactly TWO clusters matching the two obvious modules
 *      (src/ TS module, py/ Python module). Anti-vacuity: merging the two
 *      modules' call edges collapses them to ONE cluster.
 *   2. Hotspots: a high-fan-in/out node ranks ABOVE a leaf (assert ordering).
 *   3. Determinism: the skeleton is byte-identical across runs (reversed
 *      node/edge order → identical output).
 *   4. file:line provenance on cited nodes; no model/network; SQLite optional.
 *
 * Run from plugin/scripts/:  npx jest --no-coverage architecture
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge, GraphNode } from "../lib/schema";
import {
  computeArchitecture,
  EVIDENCE_TIER,
  DEFAULT_TOP_HOTSPOTS,
  type GraphView,
} from "../lib/architecture";
import { runBothIndexModes } from "../lib/parity-harness";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "clra-fixture");
const REL_FILES = [
  "src/a.ts", "src/b.ts", "src/shapes.ts",
  "py/a.py", "py/b.py", "py/shapes.py",
];

const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

function buildGraph(): GraphView {
  const base = extractStructuralGraph(FIXTURE_ROOT, REL_FILES, readFile);
  const refined = refineCalls(FIXTURE_ROOT, REL_FILES, readFile, base);
  return { nodes: refined.nodes as GraphNode[], edges: refined.edges as GraphEdge[] };
}

/** The repo-relative path segment of a node id (`<type>:<relpath>[:<name>]`). */
const relOf = (id: string) => id.split(":")[1] ?? "";

// ---------------------------------------------------------------------------
// Gate 1 — clustering: two obvious modules → exactly two clusters.
// ---------------------------------------------------------------------------

describe("[G9] computeArchitecture — community clustering over `calls`", () => {
  test("the fixture's two modules (src/ TS, py/ Python) yield exactly TWO clusters", () => {
    const g = buildGraph();
    const arch = computeArchitecture(g);

    expect(arch.tier).toBe(EVIDENCE_TIER);
    expect(arch.clusters.length).toBe(2);
    expect(arch.summary.clusterCount).toBe(2);

    // Hand-labeling: each cluster's members live entirely under one module dir.
    for (const c of arch.clusters) {
      const dirs = new Set(c.members.map((m) => relOf(m).split("/")[0]));
      expect(dirs.size).toBe(1);
    }
    const clusterDirs = arch.clusters
      .map((c) => relOf(c.members[0]).split("/")[0])
      .sort();
    expect(clusterDirs).toEqual(["py", "src"]);

    // A dead/isolated function (no `calls` edge) is NOT given a spurious cluster.
    const allMembers = new Set(arch.clusters.flatMap((c) => c.members));
    expect(allMembers.has("function:src/b.ts:unusedHelper")).toBe(false);
    expect(allMembers.has("function:py/b.py:unused_helper")).toBe(false);
  });

  test("anti-vacuity: merging the two modules' call edges collapses to ONE cluster", () => {
    const g = buildGraph();
    // Bridge the two call-disconnected modules with cross-module `calls` edges.
    const bridge: GraphEdge[] = [
      { source: "function:src/a.ts:main", target: "function:py/a.py:main", type: "calls", direction: "out", weight: 1 },
      { source: "function:py/a.py:main", target: "function:src/a.ts:main", type: "calls", direction: "out", weight: 1 },
    ];
    const merged: GraphView = { nodes: g.nodes, edges: [...g.edges, ...bridge] };
    const arch = computeArchitecture(merged);
    expect(arch.clusters.length).toBe(1);
    expect(arch.summary.clusterCount).toBe(1);
    // The single cluster spans BOTH module dirs now.
    const dirs = new Set(arch.clusters[0].members.map((m) => relOf(m).split("/")[0]));
    expect(dirs.has("src")).toBe(true);
    expect(dirs.has("py")).toBe(true);
  });

  test("cluster ids/members are canonical (smallest member id; sorted)", () => {
    const g = buildGraph();
    const arch = computeArchitecture(g);
    for (const c of arch.clusters) {
      const sorted = [...c.members].sort();
      expect(c.members).toEqual(sorted);
      expect(c.id).toBe(sorted[0]);
      expect(c.size).toBe(c.members.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — hotspots: a high-degree node ranks strictly above a leaf.
// ---------------------------------------------------------------------------

describe("[G9] hotspots — degree-ranked, non-vacuous ordering", () => {
  test("the high-fan-out entry (main) ranks ABOVE a leaf utility it calls", () => {
    const g = buildGraph();
    const arch = computeArchitecture(g);

    const rank = new Map(arch.hotspots.map((h, i) => [h.id, i] as const));
    const mainIdx = rank.get("function:src/a.ts:main");
    const addIdx = rank.get("function:src/b.ts:add");
    expect(mainIdx).toBeDefined();
    expect(addIdx).toBeDefined();
    // main (degree 4: calls add/multiply/sumList1/sumListTwo) outranks add (degree 1).
    expect(mainIdx! < addIdx!).toBe(true);

    const main = arch.hotspots.find((h) => h.id === "function:src/a.ts:main")!;
    const add = arch.hotspots.find((h) => h.id === "function:src/b.ts:add")!;
    expect(main.fanOut).toBeGreaterThanOrEqual(4);
    expect(main.degree).toBeGreaterThan(add.degree);
    // The whole point: the ranking would FAIL under a constant degree.
  });

  test("anti-vacuity (mutate): a synthetic hub outranks a leaf, and swapping flips it", () => {
    const mk = (n: string): GraphNode => ({
      id: `function:src/x.ts:${n}`, type: "function", name: n,
      source_refs: [`src/x.ts#L1-L2`], confidence: "high",
    });
    const edge = (s: string, t: string): GraphEdge => ({
      source: `function:src/x.ts:${s}`, target: `function:src/x.ts:${t}`,
      type: "calls", direction: "out", weight: 1,
    });
    // hub is called by 3 callers (fanIn 3); leaf is called by 1 (fanIn 1).
    const nodes = ["hub", "leaf", "c1", "c2", "c3", "d1"].map(mk);
    const edges = [edge("c1", "hub"), edge("c2", "hub"), edge("c3", "hub"), edge("d1", "leaf")];
    const arch = computeArchitecture({ nodes, edges });
    const hub = arch.hotspots.find((h) => h.id === "function:src/x.ts:hub")!;
    const leaf = arch.hotspots.find((h) => h.id === "function:src/x.ts:leaf")!;
    expect(hub.degree).toBeGreaterThan(leaf.degree);
    expect(arch.hotspots.findIndex((h) => h.id === hub.id))
      .toBeLessThan(arch.hotspots.findIndex((h) => h.id === leaf.id));

    // Swap: give leaf the 3 callers and hub only 1 → the ordering flips.
    const swapped = [edge("c1", "leaf"), edge("c2", "leaf"), edge("c3", "leaf"), edge("d1", "hub")];
    const arch2 = computeArchitecture({ nodes, edges: swapped });
    expect(arch2.hotspots.findIndex((h) => h.id === leaf.id))
      .toBeLessThan(arch2.hotspots.findIndex((h) => h.id === hub.id));
  });

  test("topHotspots cap bounds the list; invalid k is REJECTED (not silently unbounded)", () => {
    const g = buildGraph();
    expect(computeArchitecture(g, { topHotspots: 2 }).hotspots.length).toBeLessThanOrEqual(2);
    expect(computeArchitecture(g).hotspots.length).toBeLessThanOrEqual(DEFAULT_TOP_HOTSPOTS);
    // k=0 → an empty (bounded) list, never an unbounded one.
    expect(computeArchitecture(g, { topHotspots: 0 }).hotspots).toEqual([]);
    // Negative / non-integer / NaN k throws — a negative slice must not pass.
    expect(() => computeArchitecture(g, { topHotspots: -1 })).toThrow(RangeError);
    expect(() => computeArchitecture(g, { topHotspots: 1.5 })).toThrow(RangeError);
    expect(() => computeArchitecture(g, { topHotspots: NaN })).toThrow(RangeError);
    // maxIterations must be a positive integer.
    expect(() => computeArchitecture(g, { maxIterations: 0 })).toThrow(RangeError);
    expect(() => computeArchitecture(g, { maxIterations: -3 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Gate 2b — self-call (recursion) policy: ONE consistent policy across degree +
// clustering + counts (FIX-T9.2, closes the MAJOR self-call inconsistency).
// Policy: a self-call (source === target) connects a function to NO OTHER symbol
// and is EXCLUDED, in lock-step, from callEdgeCount, fan-in/out degree, AND
// clustering — never counted in one view and missing from another.
// ---------------------------------------------------------------------------

describe("[G9] self-call policy — recursion handled consistently", () => {
  const mk = (n: string): GraphNode => ({
    id: `function:src/r.ts:${n}`, type: "function", name: n,
    source_refs: [`src/r.ts#L1-L2`], confidence: "high",
  });
  const call = (s: string, t: string): GraphEdge => ({
    source: `function:src/r.ts:${s}`, target: `function:src/r.ts:${t}`,
    type: "calls", direction: "out", weight: 1,
  });

  test("a purely-recursive function (self-call only) is excluded from BOTH degree and clustering", () => {
    // `rec` calls only itself; `a`→`b` is the one inter-symbol edge.
    const nodes = ["rec", "a", "b"].map(mk);
    const edges = [call("rec", "rec"), call("a", "b")];
    const arch = computeArchitecture({ nodes, edges });

    // Excluded from clustering — rec is in NO cluster (a↔b is the only cluster).
    const clustered = new Set(arch.clusters.flatMap((c) => c.members));
    expect(clustered.has("function:src/r.ts:rec")).toBe(false);
    expect(clustered.has("function:src/r.ts:a")).toBe(true);
    expect(clustered.has("function:src/r.ts:b")).toBe(true);

    // Excluded from degree — rec is NOT a hotspot participant (degree 0).
    expect(arch.hotspots.some((h) => h.id === "function:src/r.ts:rec")).toBe(false);

    // Excluded from the edge count — only the inter-symbol a→b edge is counted.
    expect(arch.summary.callEdgeCount).toBe(1);
  });

  test("the self-loop does NOT inflate degree; a real edge still ranks AND clusters the node", () => {
    // `f` recurses AND calls `g`. Its degree reflects ONLY the f→g edge.
    const nodes = ["f", "g"].map(mk);
    const arch = computeArchitecture({ nodes, edges: [call("f", "f"), call("f", "g")] });
    const f = arch.hotspots.find((h) => h.id === "function:src/r.ts:f")!;
    expect(f).toBeDefined();
    expect(f.fanOut).toBe(1);  // g only — the self-loop is ignored
    expect(f.fanIn).toBe(0);   // the self-loop does NOT make f its own caller
    expect(f.degree).toBe(1);
    expect(arch.summary.callEdgeCount).toBe(1);  // only the inter-symbol edge
    // f and g land in the same single cluster.
    expect(arch.clusters.length).toBe(1);
    expect(arch.clusters[0].members).toEqual([
      "function:src/r.ts:f",
      "function:src/r.ts:g",
    ]);
  });

  test("consistency invariant: the degree-participant set EQUALS the clustered set (the old bug broke this)", () => {
    // Under the OLD inconsistent policy a self-call-only node entered the degree
    // participants (callers/callees) but never `undirected`, so it appeared in
    // hotspots yet vanished from clusters — breaking this equality. This invariant
    // is the non-vacuous guard: mutate the policy back and it FAILS.
    const nodes = ["rec", "x", "y", "z"].map(mk);
    const edges = [call("rec", "rec"), call("x", "y"), call("y", "z")];
    const arch = computeArchitecture({ nodes, edges });
    const degreeParticipants = arch.hotspots.filter((h) => h.degree > 0).map((h) => h.id).sort();
    const clustered = [...new Set(arch.clusters.flatMap((c) => c.members))].sort();
    expect(degreeParticipants).toEqual(clustered);
    expect(clustered).not.toContain("function:src/r.ts:rec");
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — determinism: reversed node/edge order → byte-identical skeleton.
// ---------------------------------------------------------------------------

describe("[G9] determinism — order-independent, full stable keys", () => {
  test("reversed node/edge input → byte-identical architecture skeleton", () => {
    const g = buildGraph();
    // Reverse the ACTUAL consumed structures (graph.nodes / graph.edges).
    const shuffled: GraphView = {
      nodes: [...g.nodes].reverse(),
      edges: [...g.edges].reverse(),
    };
    const a = computeArchitecture(g, { entryPoints: ["run"] });
    const b = computeArchitecture(shuffled, { entryPoints: ["run"] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("the skeleton is stable across repeated runs (re-run → identical)", () => {
    const g = buildGraph();
    const a = computeArchitecture(g);
    const b = computeArchitecture(g);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("languages are ranked deterministically (count desc, language asc)", () => {
    const g = buildGraph();
    const arch = computeArchitecture(g);
    // The fixture has 3 TS + 3 Python files.
    const langs = Object.fromEntries(arch.languages.map((l) => [l.language, l.files]));
    expect(langs["typescript"]).toBe(3);
    expect(langs["python"]).toBe(3);
    // Verify the sort is a total order (count desc, then language asc).
    for (let i = 1; i < arch.languages.length; i++) {
      const prev = arch.languages[i - 1];
      const cur = arch.languages[i];
      expect(prev.files > cur.files || (prev.files === cur.files && prev.language <= cur.language)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 4a — provenance: file:line only, down-tier nodes without it.
// ---------------------------------------------------------------------------

describe("[G9] provenance — #Lx-Ly only, untrusted otherwise", () => {
  test("fixture hotspots + entry points all carry file:line provenance", () => {
    const g = buildGraph();
    const arch = computeArchitecture(g);
    for (const h of arch.hotspots) {
      expect(Array.isArray(h.source_refs)).toBe(true);
      expect(h.source_refs.length).toBeGreaterThan(0);
      expect(h.source_refs[0]).toMatch(/#L\d+-L\d+$/);
      expect(h.tier).toBe("trusted");
    }
    expect(arch.entryPoints.length).toBeGreaterThan(0);
    for (const e of arch.entryPoints) {
      expect(e.tier).toBe("trusted");
      expect(e.source_refs[0]).toMatch(/#L\d+-L\d+$/);
    }
  });

  test("a cited node with a non-line ref is down-tiered; no non-line ref passes through", () => {
    const nodes: GraphNode[] = [
      { id: "function:src/x.ts:a", type: "function", name: "a", source_refs: ["src/x.ts#L1-L2"], confidence: "high" },
      { id: "function:src/x.ts:b", type: "function", name: "b", source_refs: ["src/x.ts"], confidence: "high" }, // bare path
      { id: "function:src/x.ts:c", type: "function", name: "c", source_refs: [], confidence: "high" },           // none
    ];
    const edges: GraphEdge[] = [
      { source: "function:src/x.ts:a", target: "function:src/x.ts:b", type: "calls", direction: "out", weight: 1 },
      { source: "function:src/x.ts:b", target: "function:src/x.ts:c", type: "calls", direction: "out", weight: 1 },
    ];
    const arch = computeArchitecture({ nodes, edges });
    const byId = new Map(arch.hotspots.map((h) => [h.id, h]));
    expect(byId.get("function:src/x.ts:a")!.tier).toBe("trusted");
    // b's bare-path ref is filtered out → untrusted, empty refs.
    expect(byId.get("function:src/x.ts:b")!.source_refs).toEqual([]);
    expect(byId.get("function:src/x.ts:b")!.tier).toBe("untrusted");
    expect(byId.get("function:src/x.ts:c")!.tier).toBe("untrusted");
    for (const h of arch.hotspots) for (const r of h.source_refs) expect(r).toMatch(/#L\d+-L\d+$/);
  });

  test("routes surface is empty on a fixture with no endpoints/routes (no crash)", () => {
    const g = buildGraph();
    const arch = computeArchitecture(g);
    expect(arch.routes.endpoints).toEqual([]);
    expect(arch.routes.edges).toEqual([]);
  });

  test("endpoint nodes + routes edges are surfaced when present", () => {
    const nodes: GraphNode[] = [
      { id: "endpoint:src/api.ts:GET /x", type: "endpoint", name: "GET /x", source_refs: ["src/api.ts#L1-L2"], confidence: "high" },
      { id: "function:src/api.ts:handler", type: "function", name: "handler", source_refs: ["src/api.ts#L3-L9"], confidence: "high" },
    ];
    const edges: GraphEdge[] = [
      { source: "endpoint:src/api.ts:GET /x", target: "function:src/api.ts:handler", type: "routes", direction: "out", weight: 1 },
    ];
    const arch = computeArchitecture({ nodes, edges });
    expect(arch.routes.endpoints.map((e) => e.id)).toEqual(["endpoint:src/api.ts:GET /x"]);
    expect(arch.routes.edges).toEqual([
      { source: "endpoint:src/api.ts:GET /x", target: "function:src/api.ts:handler", type: "routes" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Gate 4b — model-free + SQLite-not-required (import-closure proof + parity).
// ---------------------------------------------------------------------------

describe("[G9] model-free — no SQLite, no model, no network", () => {
  const LIB_SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "architecture.ts"), "utf8");
  const CLI_SRC = fs.readFileSync(path.join(__dirname, "..", "architecture.ts"), "utf8");

  test("lib/architecture.ts imports neither SQLite, network, nor in-flight modules (scope guard)", () => {
    const importLines = LIB_SRC.split("\n").filter((l) => /^\s*import\b/.test(l));
    const joined = importLines.join("\n");
    expect(/sqlite|better-sqlite|index-cache/i.test(joined)).toBe(false);
    expect(/\bfetch\b|node:http|require\(["']https?["']\)|from ["']https?:/i.test(LIB_SRC)).toBe(false);
    // Parallel-safety scope guard: do NOT import the in-flight sibling modules.
    expect(joined).not.toMatch(/from ["']\.\/graph-query["']/);
    expect(joined).not.toMatch(/from ["']\.\/structural["']/);
    expect(joined).not.toMatch(/from ["']\.\/resolve-calls/);
    expect(joined).not.toMatch(/from ["']\.\/impact["']/);
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

  test("SQLite-optional: identical skeleton with index off vs on (no projection added)", () => {
    const g = buildGraph();
    // This lane adds NO SQLite projection — the in-process JSON scan is the only
    // path, so off and on are identical by construction. The parity harness
    // proves both modes ran and produced byte-identical output. (engagement is
    // false in BOTH modes precisely because architecture never touches SQLite.)
    const outcome = runBothIndexModes((ctx) => {
      ctx.reportEngagement(false); // model-free, projection-free: never uses SQLite
      return computeArchitecture(g);
    });
    expect(outcome.ranBoth).toBe(true);
    expect(outcome.identical).toBe(true);
    expect(outcome.engagement).toEqual({ off: false, on: false });
  });
});

// ---------------------------------------------------------------------------
// Gate 5 — the REAL CLI path (non-vacuity: rendered + invoked, not the helper).
// ---------------------------------------------------------------------------

describe("[G9] CLI architecture.ts — real invocation against a written graph", () => {
  test("`architecture.ts '<json>' --graph <file>' emits the deterministic skeleton", () => {
    const g = buildGraph();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clra-arch-"));
    const indexesDir = path.join(tmpDir, ".guild", "indexes");
    fs.mkdirSync(indexesDir, { recursive: true });
    const graphFile = path.join(indexesDir, "knowledge-graph.json");
    fs.writeFileSync(
      graphFile,
      JSON.stringify({ version: "guild.knowledge_graph.v1", nodes: g.nodes, edges: g.edges }, null, 2),
      "utf8",
    );

    const cliPath = path.join(__dirname, "..", "architecture.ts");
    const out = execFileSync(
      "npx",
      ["tsx", cliPath, JSON.stringify({}), "--cwd", tmpDir, "--graph", graphFile],
      { cwd: path.join(__dirname, ".."), encoding: "utf-8", timeout: 60_000 },
    );
    const result = JSON.parse(out);

    // Same contract the in-process gate asserts — proven through the real CLI.
    expect(result.clusters.length).toBe(2);
    expect(result.summary.clusterCount).toBe(2);
    const hotspotIds = new Set(result.hotspots.map((h: { id: string }) => h.id));
    expect(hotspotIds.has("function:src/a.ts:main")).toBe(true);

    // CLI output is byte-stable: re-invoking yields identical bytes.
    const out2 = execFileSync(
      "npx",
      ["tsx", cliPath, JSON.stringify({}), "--cwd", tmpDir, "--graph", graphFile],
      { cwd: path.join(__dirname, ".."), encoding: "utf-8", timeout: 60_000 },
    );
    expect(out2).toBe(out);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Gate 6 — CLI input validation + path containment (security, real invocation).
// ---------------------------------------------------------------------------

describe("[G9] CLI architecture.ts — rejects bad input and path traversal", () => {
  const cliPath = path.join(__dirname, "..", "architecture.ts");

  function runExpectingFailure(jsonArg: string, extra: string[], cwd: string) {
    let err: { status?: number; stderr?: Buffer | string } | undefined;
    try {
      execFileSync("npx", ["tsx", cliPath, jsonArg, ...extra], {
        cwd,
        encoding: "utf-8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      err = e as { status?: number; stderr?: Buffer | string };
    }
    expect(err).toBeDefined();
    expect(err!.status).toBe(1);
    return String(err!.stderr ?? "");
  }

  function writeEmptyGraph(dir: string) {
    fs.writeFileSync(
      path.join(dir, "knowledge-graph.json"),
      JSON.stringify({ version: "guild.knowledge_graph.v1", nodes: [], edges: [] }),
      "utf8",
    );
  }

  test("a non-array `entryPoints` (bare string) is rejected, not iterated per-character", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clra-arch-bad-"));
    writeEmptyGraph(tmpDir);
    const stderr = runExpectingFailure(
      JSON.stringify({ entryPoints: "run" }),
      ["--cwd", tmpDir],
      path.join(__dirname, ".."),
    );
    expect(stderr).toMatch(/entryPoints.*must be an array/i);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 90_000);

  test("a negative `topHotspots` is rejected (no negative slice / unbounded output)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clra-arch-bad-"));
    writeEmptyGraph(tmpDir);
    const stderr = runExpectingFailure(
      JSON.stringify({ topHotspots: -1 }),
      ["--cwd", tmpDir],
      path.join(__dirname, ".."),
    );
    expect(stderr).toMatch(/topHotspots.*integer >= 0/i);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 90_000);

  test("a `../`-escaping --graph path is refused (no arbitrary filesystem read)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clra-arch-esc-"));
    const outside = path.join(tmpDir, "outside-secret.json");
    fs.writeFileSync(outside, JSON.stringify({ nodes: [], edges: [] }), "utf8");
    const innerRoot = path.join(tmpDir, "root");
    fs.mkdirSync(path.join(innerRoot, ".guild", "indexes"), { recursive: true });
    const stderr = runExpectingFailure(
      JSON.stringify({}),
      ["--cwd", innerRoot, "--graph", "../../../outside-secret.json"],
      path.join(__dirname, ".."),
    );
    expect(stderr).toMatch(/escapes the indexes dir/i);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 90_000);

  test("an in-repo --graph OUTSIDE .guild/indexes is refused; one INSIDE it is accepted", () => {
    const g = buildGraph();
    const graphWrapper = JSON.stringify(
      { version: "guild.knowledge_graph.v1", nodes: g.nodes, edges: g.edges }, null, 2,
    );
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clra-arch-inrepo-"));
    const inRepoOutside = path.join(repoRoot, "knowledge-graph.json");
    fs.writeFileSync(inRepoOutside, graphWrapper, "utf8");
    const stderr = runExpectingFailure(
      JSON.stringify({}),
      ["--cwd", repoRoot, "--graph", inRepoOutside],
      path.join(__dirname, ".."),
    );
    expect(stderr).toMatch(/escapes the indexes dir/i);

    const indexesDir = path.join(repoRoot, ".guild", "indexes");
    fs.mkdirSync(indexesDir, { recursive: true });
    const inIndexes = path.join(indexesDir, "knowledge-graph.json");
    fs.writeFileSync(inIndexes, graphWrapper, "utf8");
    const out = execFileSync(
      "npx",
      ["tsx", cliPath, JSON.stringify({}), "--cwd", repoRoot, "--graph", inIndexes],
      { cwd: path.join(__dirname, ".."), encoding: "utf-8", timeout: 60_000 },
    );
    const result = JSON.parse(out);
    expect(result.clusters.length).toBe(2);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }, 120_000);
});
