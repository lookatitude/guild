/**
 * understand/__tests__/incremental.test.ts
 *
 * LANE G4 validation gate (non-vacuous). Run from plugin/scripts/:
 *   npx jest --no-coverage incremental
 *
 * Gates (T4.1 brief):
 *   1. Lossless     — full rebuild vs incremental rebuild on the SAME final tree
 *                     produce the same structural graph (canonicalized). Anti-vacuity:
 *                     only the changed file's nodes/edges differ; an unrelated file's
 *                     subtree is byte-identical.
 *   2. Cascade      — editing a body changes only that file's nodes/edges; deleting a
 *                     file removes its nodes AND the edges that referenced them (no
 *                     dangling edges → validateGraph clean).
 *   2b.Cross-file   — adding/renaming/deleting a symbol in ONE file correctly updates
 *                     edges OWNED BY OTHER, UNCHANGED files (the case a naive per-file
 *                     splice gets wrong). Proven losslessly equal to a full rebuild.
 *   3. Determinism  — re-runs are byte-identical; sidecar holds commit/timestamp, the
 *                     graph never does; 0 model/network on the real CLI path.
 *   4. Perf/cost    — a 1-file change re-extracts EXACTLY that file; every other file
 *                     is served from cache (never re-parsed). Wall-clock logged.
 *   5. SQLite-free  — JSON in-process; no .guild/index.sqlite required.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import {
  assembleStructuralGraph,
  buildBundles,
  bundlesToCache,
  mergeStructuralInto,
  refreshStructuralIncremental,
  stripStructural,
  structuralSubset,
  STRUCTURAL_EXTRACTOR,
  STRUCTURAL_CACHE_VERSION,
  type StructuralCache,
} from "../lib/structural";
import { validateGraph } from "../lib/schema";
import type { GraphEdge, GraphNode } from "../lib/schema";

const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

// ---------------------------------------------------------------------------
// Temp-repo helpers (real fs — exercises the real read/parse/resolve path)
// ---------------------------------------------------------------------------

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}
function rm(dir: string, rel: string): void {
  fs.rmSync(path.join(dir, rel), { force: true });
}
function fullStructural(dir: string, files: string[]) {
  return assembleStructuralGraph(dir, buildBundles(dir, files, readFile));
}
function subsetJson(g: { nodes: GraphNode[]; edges: GraphEdge[] }): string {
  return JSON.stringify(structuralSubset(g));
}
function nodesOfFile(g: { nodes: GraphNode[] }, rel: string): GraphNode[] {
  // file node + every symbol declared in `rel`
  return g.nodes
    .filter((n) => n.id === `file:${rel}` || n.id.includes(`:${rel}:`))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// 1. Lossless + anti-vacuity (localized edit)
// ---------------------------------------------------------------------------

describe("G4 gate 1 — incremental == full on the same final tree", () => {
  let dir: string;
  const FILES = ["a.ts", "b.ts"];
  beforeEach(() => {
    dir = tmpRepo("g4-lossless-");
    write(dir, "b.ts", "export class Base {\n  greet(): string { return \"hi\"; }\n}\n");
    write(
      dir,
      "a.ts",
      [
        'import { Base } from "./b";',
        "export function bar(): number { return 1; }",
        "export function foo(): number {",
        "  return bar() + bar();",
        "}",
        "export class Derived extends Base {",
        "  run(): number { return foo(); }",
        "}",
        "",
      ].join("\n"),
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("localized edit: incremental subset == full subset; unrelated file untouched", () => {
    // Baseline cache from tree-1.
    const priorBundles = buildBundles(dir, FILES, readFile);
    const cache = bundlesToCache(priorBundles);
    const bFull1 = fullStructural(dir, FILES);

    // Edit ONLY a.ts: change foo's body (loc/sp shifts) without touching b.ts.
    write(
      dir,
      "a.ts",
      [
        'import { Base } from "./b";',
        "export function bar(): number { return 1; }",
        "export function foo(): number {",
        "  const x = bar();",
        "  if (x > 0) return x + bar();",
        "  return bar();",
        "}",
        "export class Derived extends Base {",
        "  run(): number { return foo(); }",
        "}",
        "",
      ].join("\n"),
    );

    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    // Lossless: byte-identical structural subset.
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));

    // Only a.ts was re-extracted; b.ts served from cache.
    expect(incr.stats.reExtracted).toEqual(["a.ts"]);
    expect(incr.stats.reused).toEqual(["b.ts"]);

    // Anti-vacuity (untouched subtree): b.ts nodes are byte-identical across the edit.
    expect(JSON.stringify(nodesOfFile(incr.structural, "b.ts")))
      .toBe(JSON.stringify(nodesOfFile(bFull1, "b.ts")));

    // Anti-vacuity (mutate-confirm): foo's node DID change (its profile shifted),
    // so the equality above is not vacuously true.
    const fooBefore = bFull1.nodes.find((n) => n.id === "function:a.ts:foo")!;
    const fooAfter = incr.structural.nodes.find((n) => n.id === "function:a.ts:foo")!;
    expect(JSON.stringify(fooAfter)).not.toBe(JSON.stringify(fooBefore));
  });
});

// ---------------------------------------------------------------------------
// 2b. Cross-file propagation — the case a naive per-file splice gets WRONG
// ---------------------------------------------------------------------------

describe("G4 gate 2b — cross-file edges of UNCHANGED files re-resolve losslessly", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("adding a new file an unchanged file imports+calls → edges appear (== full)", () => {
    dir = tmpRepo("g4-addfile-");
    // a.py references b.bar but b.py does not exist yet → no import/calls edge.
    write(dir, "a.py", "from b import bar\n\ndef foo():\n    return bar()\n");

    const cache = bundlesToCache(buildBundles(dir, ["a.py"], readFile));
    const base = fullStructural(dir, ["a.py"]);
    expect(base.edges.some((e) => e.target === "function:b.py:bar")).toBe(false);

    // Add b.py (a.py UNCHANGED).
    write(dir, "b.py", "def bar():\n    return 1\n");
    const FILES = ["a.py", "b.py"];

    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    // The unchanged a.py was reused, yet its calls + import edges to the NEW file
    // appear — because resolution runs over the whole bundle set, not the splice.
    expect(incr.stats.reused).toEqual(["a.py"]);
    expect(incr.stats.newFiles).toEqual(["b.py"]);
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));
    expect(incr.structural.edges.some(
      (e) => e.type === "calls" && e.source === "function:a.py:foo" && e.target === "function:b.py:bar",
    )).toBe(true);
    expect(incr.structural.edges.some(
      (e) => e.type === "imports" && e.source === "file:a.py" && e.target === "file:b.py",
    )).toBe(true);
  });

  test("renaming a symbol in one file updates a CALLER in another unchanged file (== full)", () => {
    dir = tmpRepo("g4-rename-");
    write(dir, "a.py", "from b import bar\n\ndef foo():\n    return bar()\n");
    write(dir, "b.py", "def bar():\n    return 1\n");
    const FILES = ["a.py", "b.py"];
    const cache = bundlesToCache(buildBundles(dir, FILES, readFile));

    // Rename bar→baz in b.py; a.py still calls bar (now unresolved).
    write(dir, "b.py", "def baz():\n    return 1\n");

    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    expect(incr.stats.reExtracted).toEqual(["b.py"]);
    expect(incr.stats.reused).toEqual(["a.py"]);
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));
    // The stale foo→bar calls edge is cascade-removed.
    expect(incr.structural.edges.some((e) => e.target === "function:b.py:bar")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Cascade on delete — nodes AND dangling edges removed; validateGraph clean
// ---------------------------------------------------------------------------

describe("G4 gate 2 — deleting a file cascades its nodes + edges (== full)", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("delete b.py → its nodes gone, edges referencing it gone, no dangling refs", () => {
    dir = tmpRepo("g4-del-");
    write(dir, "a.py", "from b import bar\n\ndef foo():\n    return bar()\n");
    write(dir, "b.py", "def bar():\n    return 1\n");
    const cache = bundlesToCache(buildBundles(dir, ["a.py", "b.py"], readFile));

    // Delete b.py.
    rm(dir, "b.py");
    const FILES = ["a.py"];

    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    expect(incr.stats.deleted).toEqual(["b.py"]);
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));
    // b.py nodes are gone…
    expect(incr.structural.nodes.some((n) => n.id.startsWith("file:b.py") || n.id.includes(":b.py:"))).toBe(false);
    // …and no edge dangles to a missing node (validateGraph drops nothing).
    const ids = new Set(incr.structural.nodes.map((n) => n.id));
    for (const e of incr.structural.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. stripStructural — preserve foreign (LLM) tier; revert collided provenance
// ---------------------------------------------------------------------------

describe("G4 gate 3 — stripStructural keeps LLM tier, never deletes foreign items", () => {
  test("pure structural removed; LLM kept; collided node reverted to pure-LLM", () => {
    const structuralFoo: GraphNode = {
      id: "function:a.ts:foo", type: "function", name: "foo",
      source_refs: ["a.ts#L1-L3"], confidence: "high",
      sp: { loc: 3 } as unknown as GraphNode["sp"], extractor: STRUCTURAL_EXTRACTOR,
    } as GraphNode;
    const llmConcept: GraphNode = {
      id: "concept:domain", type: "concept", name: "Domain",
      source_refs: ["a.ts"], confidence: "medium", summary: "llm",
    } as GraphNode;
    // collided LLM node: keeps summary, carries additive structural+sp from FIX G1-5.
    const collided: GraphNode = {
      id: "function:a.ts:bar", type: "function", name: "bar",
      source_refs: ["a.ts#L5-L7"], confidence: "high", summary: "llm-bar",
      sp: { loc: 2 } as unknown as GraphNode["sp"], structural: true,
    } as unknown as GraphNode;

    const sEdge: GraphEdge = { source: "function:a.ts:foo", target: "function:a.ts:bar", type: "calls", direction: "out", weight: 0.9, extractor: STRUCTURAL_EXTRACTOR };
    const llmEdge: GraphEdge = { source: "concept:domain", target: "function:a.ts:foo", type: "related", direction: "out", weight: 0.5 };

    const out = stripStructural([structuralFoo, llmConcept, collided], [sEdge, llmEdge]);

    // pure structural node removed
    expect(out.nodes.some((n) => n.id === "function:a.ts:foo")).toBe(false);
    // foreign LLM node preserved verbatim
    const concept = out.nodes.find((n) => n.id === "concept:domain")! as Record<string, unknown>;
    expect(concept.summary).toBe("llm");
    // collided node kept, but additive provenance reverted (summary survives)
    const bar = out.nodes.find((n) => n.id === "function:a.ts:bar")! as Record<string, unknown>;
    expect(bar.summary).toBe("llm-bar");
    expect(bar.structural).toBeUndefined();
    expect(bar.sp).toBeUndefined();
    // pure structural edge removed; foreign edge preserved
    expect(out.edges.some((e) => e.type === "calls")).toBe(false);
    expect(out.edges.some((e) => e.type === "related")).toBe(true);
  });

  test("strip + re-merge yields the same structural subset as a clean rebuild + LLM tier", () => {
    const dir = tmpRepo("g4-merge-");
    try {
      write(dir, "a.py", "def bar():\n    return 1\n\ndef foo():\n    return bar()\n");
      const FILES = ["a.py"];
      const struct1 = fullStructural(dir, FILES);

      // Existing graph = LLM concept + the prior structural tier merged in.
      const llm: GraphNode = { id: "concept:x", type: "concept", name: "X", source_refs: ["a.py"], confidence: "low" } as GraphNode;
      const existing = mergeStructuralInto([llm], [], struct1);

      // A localized edit, then prove the strip+re-merge mechanics: stripping the
      // prior structural tier off `existing` and re-merging a fresh tree-2 build
      // must equal a clean rebuild of tree-2 + the LLM tier.
      write(dir, "a.py", "def bar():\n    return 2\n\ndef foo():\n    return bar() + bar()\n");
      const struct2 = fullStructural(dir, FILES);
      const stripped = stripStructural(existing.nodes, existing.edges);
      const remerged = mergeStructuralInto(stripped.nodes, stripped.edges, struct2);

      // LLM concept survives; structural subset equals a clean rebuild of tree-2.
      expect(remerged.nodes.some((n) => n.id === "concept:x")).toBe(true);
      expect(subsetJson(remerged)).toBe(subsetJson(struct2));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Determinism + cost proof at the library level
// ---------------------------------------------------------------------------

describe("G4 gate 4 — determinism + only-changed-file re-extraction", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("two incremental runs are byte-identical; 1-file change re-parses exactly 1 file", () => {
    dir = tmpRepo("g4-det-");
    const FILES: string[] = [];
    for (let i = 0; i < 12; i++) {
      const rel = `m${i}.py`;
      FILES.push(rel);
      write(dir, rel, `def f${i}():\n    return ${i}\n`);
    }
    const cache = bundlesToCache(buildBundles(dir, FILES, readFile));

    // change exactly one file
    write(dir, "m5.py", "def f5():\n    return 500\n");

    const t0 = Date.now();
    const incr1 = refreshStructuralIncremental(dir, FILES, readFile, cache);
    const incrMs = Date.now() - t0;
    const incr2 = refreshStructuralIncremental(dir, [...FILES].reverse(), readFile, cache);

    expect(subsetJson(incr1.structural)).toBe(subsetJson(incr2.structural)); // order-independent
    expect(incr1.stats.reExtracted).toEqual(["m5.py"]);                       // exactly the changed file
    expect(incr1.stats.reused.length).toBe(FILES.length - 1);                 // every other file from cache

    const t1 = Date.now();
    const full = fullStructural(dir, FILES);
    const fullMs = Date.now() - t1;
    expect(subsetJson(incr1.structural)).toBe(subsetJson(full));              // still lossless

    // eslint-disable-next-line no-console
    console.log(`[G4 perf] 1/${FILES.length}-file change: incremental ${incrMs}ms vs full ${fullMs}ms`);
  });

  test("assemble is order-independent in the consumed structure (reversed bundles → identical)", () => {
    dir = tmpRepo("g4-asm-");
    write(dir, "a.py", "from b import bar\n\ndef foo():\n    return bar()\n");
    write(dir, "b.py", "class Base:\n    pass\n\ndef bar():\n    return 1\n");
    const FILES = ["a.py", "b.py"];
    const bundles = buildBundles(dir, FILES, readFile);
    // Reverse the ACTUAL data structure assemble consumes (not an upstream input
    // a deterministic step re-sorts): output must be byte-identical.
    const g1 = assembleStructuralGraph(dir, bundles);
    const g2 = assembleStructuralGraph(dir, [...bundles].reverse());
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
    // non-vacuity: the graph actually carries edges (would fail if assemble dropped them)
    expect(g1.edges.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// FIX-T4.1-3 — cache reuse is version+shape validated, not contentHash-only
// ---------------------------------------------------------------------------

describe("FIX-T4.1-3 — a stale/mismatched cache is invalidated (incremental == full)", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("bundlesToCache stamps the current version", () => {
    dir = tmpRepo("g4-cacheversion-");
    write(dir, "a.py", "def bar():\n    return 1\n");
    const cache = bundlesToCache(buildBundles(dir, ["a.py"], readFile));
    expect(cache.version).toBe(STRUCTURAL_CACHE_VERSION);
  });

  test("a stale cache VERSION forces a full re-extract — and a reused stale bundle WOULD have diverged", () => {
    dir = tmpRepo("g4-staleversion-");
    write(dir, "a.py", "def bar():\n    return 1\n\ndef foo():\n    return bar()\n");
    write(dir, "b.py", "def baz():\n    return 2\n");
    const FILES = ["a.py", "b.py"];

    // Build a cache, then simulate a stale extractor: drop a.py's symbol nodes
    // (as an old extractor version would have) while KEEPING its contentHash, and
    // stamp an old version. The file bytes are unchanged → a contentHash-only
    // check would happily reuse the broken bundle.
    const cache = bundlesToCache(buildBundles(dir, FILES, readFile));
    cache.files["a.py"].symbolNodes = [];
    cache.files["a.py"].callables = [];
    const stale: StructuralCache = { ...cache, version: "structural-v0|sp:1|cfg:0" };

    const full = fullStructural(dir, FILES);

    // Proof the corruption is meaningful: reusing the stale bundle as-is diverges.
    const wouldDiverge = assembleStructuralGraph(dir, Object.values(stale.files));
    expect(subsetJson(wouldDiverge)).not.toBe(subsetJson(full));

    // With the guard: version mismatch invalidates the WHOLE cache → re-extract all.
    const incr = refreshStructuralIncremental(dir, FILES, readFile, stale);
    expect(incr.stats.reused).toEqual([]);                // nothing trusted from the stale cache
    expect(incr.stats.newFiles).toEqual(FILES);           // every file re-extracted
    expect(subsetJson(incr.structural)).toBe(subsetJson(full)); // lossless == full
  });

  test("a pre-fix cache with NO version field is treated as stale (re-extract all)", () => {
    dir = tmpRepo("g4-noversion-");
    write(dir, "a.py", "def bar():\n    return 1\n");
    const cache = bundlesToCache(buildBundles(dir, ["a.py"], readFile));
    // Older caches predate the version stamp.
    delete (cache as unknown as Record<string, unknown>).version;

    const full = fullStructural(dir, ["a.py"]);
    const incr = refreshStructuralIncremental(dir, ["a.py"], readFile, cache as StructuralCache);
    expect(incr.stats.reused).toEqual([]);
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));
  });

  test("a shape-broken bundle (valid version, matching hash) is rejected per-file → re-extract", () => {
    dir = tmpRepo("g4-shape-");
    write(dir, "a.py", "def bar():\n    return 1\n\ndef foo():\n    return bar()\n");
    write(dir, "b.py", "def baz():\n    return 2\n");
    const FILES = ["a.py", "b.py"];

    // Keep the CURRENT version but tamper a.py's bundle shape: drop fileNode and
    // empty its symbols. contentHash still matches the unchanged file on disk.
    const cache = bundlesToCache(buildBundles(dir, FILES, readFile));
    delete (cache.files["a.py"] as unknown as Record<string, unknown>).fileNode;
    cache.files["a.py"].symbolNodes = [];

    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    // a.py's broken bundle is re-extracted; the intact b.py is still reused.
    expect(incr.stats.reExtracted).toEqual(["a.py"]);
    expect(incr.stats.reused).toEqual(["b.py"]);
    expect(subsetJson(incr.structural)).toBe(subsetJson(full)); // lossless == full
  });
});

// ---------------------------------------------------------------------------
// FIX-T4.1-r2 — cache reuse validates EVERY NESTED element, not just array shape
// ---------------------------------------------------------------------------

describe("FIX-T4.1-r2 — a malformed nested cache element forces re-extract (incremental == full)", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A fixture rich enough that EVERY nested element drives observable output:
  //   - Derived(Base)  → an inherits edge (classes element)
  //   - foo() → bar()  → a calls edge (callables element)
  //   - file→symbol contains edges carry the structural extractor marker
  // a.py source (Python): class Base, class Derived(Base), def bar, def foo.
  const A_SRC = [
    "class Base:",
    "    pass",
    "",
    "class Derived(Base):",
    "    pass",
    "",
    "def bar():",
    "    return 1",
    "",
    "def foo():",
    "    return bar()",
    "",
  ].join("\n");

  // Each case OVERWRITES a REAL nested element of a.py (one that produces output)
  // with a malformed one. contentHash STILL matches the file on disk, so the old
  // array-only guard would happily reuse the broken bundle. The deepened guard
  // must reject it → re-extract a.py; b.py (intact) stays a cache hit; the result
  // must EQUAL a full rebuild (no crash, no divergence).
  const cases: Array<{ name: string; corrupt: (b: import("../lib/structural").FileBundle) => void }> = [
    {
      name: "callables[0] = null",
      corrupt: (b) => { (b.callables as unknown as unknown[])[0] = null; },
    },
    {
      name: "callables[0] missing simpleName + non-array callees",
      corrupt: (b) => { (b.callables as unknown as unknown[])[0] = { id: "function:a.py:bar" }; },
    },
    {
      name: "classes element bases not a string[]",
      corrupt: (b) => {
        // Derived(Base) carries the inherits edge — corrupt ITS bases so the edge
        // would vanish (divergence) if the broken bundle were reused.
        const cls = (b.classes as unknown as Record<string, unknown>[]).find(
          (c) => c.simpleName === "Derived",
        )!;
        cls.bases = [42];
      },
    },
    {
      name: "classes[0] = null",
      corrupt: (b) => { (b.classes as unknown as unknown[])[0] = null; },
    },
    {
      name: "symbolNodes[0] missing id",
      corrupt: (b) => {
        (b.symbolNodes as unknown as unknown[])[0] = { type: "function", name: "x", source_refs: [] };
      },
    },
    {
      name: "contains[0] null endpoint",
      corrupt: (b) => {
        const e = (b.contains as unknown as Record<string, unknown>[])[0];
        (e as Record<string, unknown>).target = null;
      },
    },
    {
      name: "importSpecs element non-string",
      corrupt: (b) => { (b.importSpecs as unknown as unknown[]).push(123); },
    },
    // ── FIX-T4.1-r3: VALID-SHAPED but cross-inconsistent elements ──────────────
    // Each element below is individually well-SHAPED (passes the per-element
    // field guards) yet violates the bundle's CROSS-consistency, so only the
    // deepened shared validator (`isValidBundle`) rejects it. Reusing it emits a
    // dropped/dangling/divergent node or edge — the divergence check proves it.
    {
      // phantom callable id: `bar`'s callable id names a symbol node that does
      // NOT exist in this bundle. Pass 2c emits `foo→bar` with the PHANTOM target.
      name: "callables phantom id (no backing symbol node)",
      corrupt: (b) => {
        const c = (b.callables as Record<string, unknown>[]).find((x) => x.simpleName === "bar")!;
        c.id = "function:a.py:ghost";
      },
    },
    {
      // wrong kind: `foo`'s callable id resolves to a CLASS node. Pass 2c would
      // emit a `calls` edge whose SOURCE is the class node, not `foo`.
      name: "callables id resolves to a class node (wrong kind)",
      corrupt: (b) => {
        const c = (b.callables as Record<string, unknown>[]).find((x) => x.simpleName === "foo")!;
        c.id = "class:a.py:Base";
      },
    },
    {
      // wrong name: `bar`'s callable simpleName no longer matches its symbol
      // node. `foo`'s call to `bar` then resolves to nothing → the `foo→bar`
      // calls edge VANISHES (divergence by omission).
      name: "callables simpleName mismatch (wrong name)",
      corrupt: (b) => {
        const c = (b.callables as Record<string, unknown>[]).find((x) => x.simpleName === "bar")!;
        c.simpleName = "Wrong";
      },
    },
    {
      // phantom class id: `Base`'s class id names a symbol node that does NOT
      // exist. `Derived`'s `inherits → Base` resolution still finds `Base` by
      // NAME, but registers the phantom id → the inherits TARGET diverges.
      name: "classes phantom id (no backing symbol node)",
      corrupt: (b) => {
        const c = (b.classes as Record<string, unknown>[]).find((x) => x.simpleName === "Base")!;
        c.id = "class:a.py:ghost";
      },
    },
    {
      // cross-bundle endpoint: a `contains` edge target points at a node OWNED BY
      // ANOTHER bundle (b.py) — outside THIS bundle's node set. Reuse emits a
      // cross-file `contains` edge a full rebuild never produces.
      name: "contains endpoint outside this bundle's nodes (cross-bundle)",
      corrupt: (b) => {
        (b.contains as Record<string, unknown>[])[0].target = "function:b.py:baz";
      },
    },
    {
      // bad provenance: a symbol node's `source_refs` names a FOREIGN file. Reuse
      // surfaces a node whose provenance points outside the file it claims to own.
      name: "symbolNode source_ref names a foreign file (bad provenance)",
      corrupt: (b) => {
        (b.symbolNodes as Record<string, unknown>[])[0].source_refs = ["b.py#L1-L2"];
      },
    },
  ];

  for (const c of cases) {
    test(`${c.name} → a.py re-extracted, b.py reused, incremental == full`, () => {
      dir = tmpRepo("g4-nested-");
      write(dir, "a.py", A_SRC);
      write(dir, "b.py", "def baz():\n    return 2\n");
      const FILES = ["a.py", "b.py"];

      const cache = bundlesToCache(buildBundles(dir, FILES, readFile));
      // Corrupt ONE nested element of a.py; version + contentHash stay valid.
      c.corrupt(cache.files["a.py"]);

      const full = fullStructural(dir, FILES);

      // Meaningfulness: reusing the malformed bundle as-is would CRASH or DIVERGE
      // from a full rebuild — i.e. the corruption is not benign.
      let diverges: boolean;
      try {
        diverges = subsetJson(assembleStructuralGraph(dir, Object.values(cache.files))) !== subsetJson(full);
      } catch {
        diverges = true; // a throw is the worst divergence
      }
      expect(diverges).toBe(true);

      // With the deepened guard: a.py's malformed bundle is rejected → re-extract;
      // the intact b.py stays a cache hit; output equals a clean full rebuild.
      const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);
      expect(incr.stats.reExtracted).toEqual(["a.py"]);
      expect(incr.stats.reused).toEqual(["b.py"]);
      expect(subsetJson(incr.structural)).toBe(subsetJson(full)); // lossless == full, no crash
    });
  }

  test("a fully intact bundle (valid version, matching hash) is STILL reused (cache hit preserved)", () => {
    // Anti-vacuity for the guard: it must not over-reject valid bundles.
    dir = tmpRepo("g4-nested-ok-");
    write(dir, "a.py", "class Acme:\n    pass\n\ndef bar():\n    return 1\n\ndef foo():\n    return bar()\n");
    write(dir, "b.py", "def baz():\n    return 2\n");
    const FILES = ["a.py", "b.py"];

    const cache = bundlesToCache(buildBundles(dir, FILES, readFile));
    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    expect(incr.stats.reExtracted).toEqual([]);       // nothing changed on disk
    expect(incr.stats.reused.sort()).toEqual(FILES);  // BOTH intact bundles reused
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));
  });
});

// ---------------------------------------------------------------------------
// FIX-T4.1-r4 — cache validity DELEGATES to the authoritative validateGraph;
// the structural SUPERSET (extractor / complete sp / exact contracts) is rejected
// when a cached element is one a real extraction would never produce.
// ---------------------------------------------------------------------------

describe("FIX-T4.1-r4 — a cached element no real extraction would produce forces re-extract (incremental == full)", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Same rich fixture as r2: class Base, class Derived(Base), def bar, def foo —
  // every nested element drives observable output (inherits / calls / contains).
  const A_SRC = [
    "class Base:",
    "    pass",
    "",
    "class Derived(Base):",
    "    pass",
    "",
    "def bar():",
    "    return 1",
    "",
    "def foo():",
    "    return bar()",
    "",
  ].join("\n");

  type B = import("../lib/structural").FileBundle;
  const rec = (x: unknown) => x as Record<string, unknown>;

  // Each case overwrites a cached element of a.py with one a FRESH extraction
  // never produces. These are the gaps the r3 hand-written field list missed and
  // the validateGraph-delegation + thin structural-superset layer now close. The
  // `validateGraph` base-shape check would PASS several of them (a non-"high"
  // confidence, a foreign-but-present source_ref, an extra field, a missing
  // `extractor`/`sp`) — yet each DIVERGES from a full rebuild, so the layered
  // structural checks must reject. contentHash + version stay valid throughout.
  const cases: Array<{ name: string; corrupt: (b: B) => void }> = [
    {
      name: "symbolNode missing the extractor marker (node vanishes from the subset)",
      corrupt: (b) => { delete rec(b.symbolNodes[0]).extractor; },
    },
    {
      name: "symbolNode missing sp (sp rides into the graph → diverges)",
      corrupt: (b) => { delete rec(b.symbolNodes[0]).sp; },
    },
    {
      name: "symbolNode incomplete sp (a profile key dropped)",
      corrupt: (b) => { delete (rec(b.symbolNodes[0]).sp as Record<string, unknown>).loc; },
    },
    {
      name: "symbolNode sp value non-numeric",
      corrupt: (b) => { (rec(b.symbolNodes[0]).sp as Record<string, unknown>).loc = "x"; },
    },
    {
      name: "symbolNode carries an EXTRA field (rides wholesale → diverges)",
      corrupt: (b) => { rec(b.symbolNodes[0]).bogus = 1; },
    },
    {
      name: "symbolNode bare source_ref (no #Lx-Ly line anchor)",
      corrupt: (b) => { rec(b.symbolNodes[0]).source_refs = ["a.py"]; },
    },
    {
      name: "symbolNode source_ref bogus fragment (not Lx-Ly)",
      corrupt: (b) => { rec(b.symbolNodes[0]).source_refs = ["a.py#bogus"]; },
    },
    {
      name: "symbolNode confidence not 'high' (passes validateGraph, diverges)",
      corrupt: (b) => { rec(b.symbolNodes[0]).confidence = "medium"; },
    },
    {
      name: "fileNode wrong name (file-node contract beyond id)",
      corrupt: (b) => { rec(b.fileNode).name = "WRONG.py"; },
    },
    {
      name: "fileNode missing the extractor marker (file node vanishes from subset)",
      corrupt: (b) => { delete rec(b.fileNode).extractor; },
    },
    {
      name: "fileNode wrong language",
      corrupt: (b) => { rec(b.fileNode).language = "javascript"; },
    },
    {
      name: "fileNode wrong source_refs (not the bare file path)",
      corrupt: (b) => { rec(b.fileNode).source_refs = ["a.py#L1-L1"]; },
    },
    {
      name: "contains edge missing the extractor marker (edge vanishes from the subset)",
      corrupt: (b) => { delete rec(b.contains[0]).extractor; },
    },
    {
      name: "contains edge carries an EXTRA field (rides wholesale → diverges)",
      corrupt: (b) => { rec(b.contains[0]).bogus = true; },
    },
  ];

  for (const c of cases) {
    test(`${c.name} → a.py re-extracted, b.py reused, incremental == full`, () => {
      dir = tmpRepo("g4-r4-");
      write(dir, "a.py", A_SRC);
      write(dir, "b.py", "def baz():\n    return 2\n");
      const FILES = ["a.py", "b.py"];

      const cache = bundlesToCache(buildBundles(dir, FILES, readFile));
      c.corrupt(cache.files["a.py"]);

      const full = fullStructural(dir, FILES);

      // Meaningfulness: reusing the corrupted bundle as-is DIVERGES from a full
      // rebuild (a vanished node/edge, a changed field, or a throw).
      let diverges: boolean;
      try {
        diverges = subsetJson(assembleStructuralGraph(dir, Object.values(cache.files))) !== subsetJson(full);
      } catch {
        diverges = true;
      }
      expect(diverges).toBe(true);

      // With the delegated+layered guard: a.py is rejected → re-extracted; the
      // intact b.py stays a cache hit; output equals a clean full rebuild.
      const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);
      expect(incr.stats.reExtracted).toEqual(["a.py"]);
      expect(incr.stats.reused).toEqual(["b.py"]);
      expect(subsetJson(incr.structural)).toBe(subsetJson(full)); // lossless == full, no crash
    });
  }

  test("a fully intact bundle is STILL reused (delegation does not over-reject)", () => {
    // Anti-vacuity: a genuinely valid cache passes the authoritative validator
    // AND the structural-superset layer, so it is reused — the guard is not a
    // blanket re-extract.
    dir = tmpRepo("g4-r4-ok-");
    write(dir, "a.py", A_SRC);
    write(dir, "b.py", "def baz():\n    return 2\n");
    const FILES = ["a.py", "b.py"];

    const cache = bundlesToCache(buildBundles(dir, FILES, readFile));
    const full = fullStructural(dir, FILES);
    const incr = refreshStructuralIncremental(dir, FILES, readFile, cache);

    expect(incr.stats.reExtracted).toEqual([]);       // nothing changed on disk
    expect(incr.stats.reused.sort()).toEqual(FILES);  // BOTH intact bundles reused
    expect(subsetJson(incr.structural)).toBe(subsetJson(full));
  });
});

// ---------------------------------------------------------------------------
// FIX-T4.1-2 — --incremental uses the LIVE tree, not a stale CodebaseMap (CLI)
// ---------------------------------------------------------------------------

describe("FIX-T4.1-2 — incremental add/delete is lossless under a STALE codebase-map", () => {
  const SCRIPTS_DIR = path.resolve(__dirname, "..", "..");
  const CLI = path.join(SCRIPTS_DIR, "understand", "extract-structural.ts");
  let repo: string;
  let cleanRepo: string;

  function git(r: string, args: string[]): void {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: r, stdio: "ignore" });
  }
  function runCli(r: string, ...extra: string[]): void {
    execFileSync("npx", ["tsx", CLI, "--cwd", r, ...extra], { cwd: SCRIPTS_DIR, stdio: "ignore" });
  }
  const KG = (r: string) => path.join(r, ".guild", "indexes", "knowledge-graph.json");
  const MAP = (r: string) => path.join(r, ".guild", "indexes", "codebase-map.json");
  const readJ = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

  beforeAll(() => {
    repo = tmpRepo("g4-stalemap-");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    // Initial tree: a.ts + gone.ts. Seed graph + cache via a full run.
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export function foo(): number { return 1; }\n", "utf8");
    fs.writeFileSync(path.join(repo, "src", "gone.ts"), "export function obsolete(): number { return 9; }\n", "utf8");
    git(repo, ["init"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "fixture"]);
    runCli(repo); // full run → graph + structural-cache, file list from walk

    // Mutate the LIVE tree: delete gone.ts, ADD added.ts.
    fs.rmSync(path.join(repo, "src", "gone.ts"));
    fs.writeFileSync(path.join(repo, "src", "added.ts"), "export function fresh(): number { return 7; }\n", "utf8");

    // Write a STALE codebase-map that still lists gone.ts and is MISSING added.ts.
    // A map-driven file list would delete nothing-new and miss the addition.
    fs.mkdirSync(path.join(repo, ".guild", "indexes"), { recursive: true });
    fs.writeFileSync(
      MAP(repo),
      JSON.stringify({
        version: "guild.codebase_map.v1",
        files: [{ path: "src/a.ts" }, { path: "src/gone.ts" }],
      }),
      "utf8",
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "live tree drifts from the map"]);
    runCli(repo, "--incremental");

    // Clean full rebuild of the SAME final tree (no map) for the lossless compare.
    cleanRepo = tmpRepo("g4-stalemap-clean-");
    fs.mkdirSync(path.join(cleanRepo, "src"), { recursive: true });
    fs.copyFileSync(path.join(repo, "src", "a.ts"), path.join(cleanRepo, "src", "a.ts"));
    fs.copyFileSync(path.join(repo, "src", "added.ts"), path.join(cleanRepo, "src", "added.ts"));
    git(cleanRepo, ["init"]);
    git(cleanRepo, ["add", "-A"]);
    git(cleanRepo, ["commit", "-m", "final tree"]);
    runCli(cleanRepo);
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
    if (cleanRepo) fs.rmSync(cleanRepo, { recursive: true, force: true });
  });

  test("the DELETED file (still in the stale map) is gone from the incremental graph", () => {
    const nodes = readJ(KG(repo)).nodes as GraphNode[];
    expect(nodes.some((n) => n.id === "file:src/gone.ts")).toBe(false);
    expect(nodes.some((n) => n.id === "function:src/gone.ts:obsolete")).toBe(false);
  });

  test("the ADDED file (absent from the stale map) IS in the incremental graph", () => {
    const nodes = readJ(KG(repo)).nodes as GraphNode[];
    expect(nodes.some((n) => n.id === "file:src/added.ts")).toBe(true);
    expect(nodes.some((n) => n.id === "function:src/added.ts:fresh")).toBe(true);
  });

  test("incremental (under a stale map) == a clean full rebuild of the live tree", () => {
    expect(subsetJson(readJ(KG(repo)))).toBe(subsetJson(readJ(KG(cleanRepo))));
  });
});

// ---------------------------------------------------------------------------
// 5. Real CLI on a git repo — --incremental engages, sidecar holds commit, cache
//    carries fingerprints, output matches a clean full rebuild, 0 model/network.
// ---------------------------------------------------------------------------

describe("G4 gate 5 — real extract-structural.ts --incremental CLI", () => {
  const SCRIPTS_DIR = path.resolve(__dirname, "..", "..");
  const CLI = path.join(SCRIPTS_DIR, "understand", "extract-structural.ts");
  let repo: string;
  let cleanRepo: string;

  function git(r: string, args: string[]): void {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: r, stdio: "ignore" });
  }
  function runCli(r: string, ...extra: string[]): void {
    execFileSync("npx", ["tsx", CLI, "--cwd", r, ...extra], { cwd: SCRIPTS_DIR, stdio: "ignore" });
  }
  const KG = (r: string) => path.join(r, ".guild", "indexes", "knowledge-graph.json");
  const CACHE = (r: string) => `${KG(r)}.structural-cache.json`;
  const META = (r: string) => `${KG(r)}.meta.json`;
  const readJ = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

  function seed(r: string): void {
    fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src", "b.ts"), "export function helper(): number { return 42; }\nexport class Base {\n  greet(): string { return \"hi\"; }\n}\n", "utf8");
    fs.writeFileSync(
      path.join(r, "src", "a.ts"),
      [
        'import { Base } from "./b";',
        "export function bar(): number { return 1; }",
        "export function foo(): number {",
        "  const x = bar();",
        "  return x + bar();",
        "}",
        "export class Derived extends Base { run(): number { return foo(); } }",
        "",
      ].join("\n"),
      "utf8",
    );
    git(r, ["init"]);
    git(r, ["add", "-A"]);
    git(r, ["commit", "-m", "fixture"]);
  }

  beforeAll(() => {
    repo = tmpRepo("g4-cli-");
    seed(repo);
    runCli(repo);                 // full run — seeds graph + cache
    // Edit ONE file: change foo's body (no symbol rename → localized).
    fs.writeFileSync(
      path.join(repo, "src", "a.ts"),
      [
        'import { Base } from "./b";',
        "export function bar(): number { return 1; }",
        "export function foo(): number {",
        "  const x = bar();",
        "  if (x > 0) return x;",
        "  return bar();",
        "}",
        "export class Derived extends Base { run(): number { return foo(); } }",
        "",
      ].join("\n"),
      "utf8",
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "edit foo body"]);
    runCli(repo, "--incremental");

    // A from-scratch full rebuild of the SAME final tree, for the lossless compare.
    cleanRepo = tmpRepo("g4-cli-clean-");
    fs.mkdirSync(path.join(cleanRepo, "src"), { recursive: true });
    fs.copyFileSync(path.join(repo, "src", "a.ts"), path.join(cleanRepo, "src", "a.ts"));
    fs.copyFileSync(path.join(repo, "src", "b.ts"), path.join(cleanRepo, "src", "b.ts"));
    git(cleanRepo, ["init"]);
    git(cleanRepo, ["add", "-A"]);
    git(cleanRepo, ["commit", "-m", "final tree"]);
    runCli(cleanRepo);
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
    if (cleanRepo) fs.rmSync(cleanRepo, { recursive: true, force: true });
  });

  test("the sidecar records incremental mode + exactly 1 re-extracted file", () => {
    const meta = readJ(META(repo));
    expect(meta.refresh_mode).toBe("incremental");
    expect(meta.reextracted_file_count).toBe(1);
    expect(meta.reused_file_count).toBeGreaterThanOrEqual(1);
    // cost invariants preserved
    expect(meta.model_calls).toBe(0);
    expect(meta.network_calls).toBe(0);
    // commit/timestamp live in the sidecar, never the graph
    expect(String(meta.generated_from_commit)).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof meta.generated_at).toBe("string");
  });

  test("graph carries the commit-independent constant; validates clean", () => {
    const g = readJ(KG(repo));
    expect(g.generated_from_commit).toBe("structural");
    expect(String(g.generated_from_commit)).not.toMatch(/^[0-9a-f]{40}$/);
    expect(validateGraph(g).success).toBe(true);
  });

  test("the bundle cache carries per-file SHA-256 fingerprints", () => {
    const cache = readJ(CACHE(repo));
    expect(cache.schema).toBe("guild.structural_cache.v1");
    const aEntry = cache.files["src/a.ts"];
    expect(aEntry).toBeDefined();
    expect(aEntry.contentHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    // the fingerprint matches the file on disk
    const onDisk = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(repo, "src", "a.ts"))).digest("hex");
    expect(aEntry.contentHash).toBe(onDisk);
  });

  test("incremental output == a clean full rebuild of the same final tree", () => {
    const incr = readJ(KG(repo));
    const full = readJ(CACHE(repo)); void full;
    const incrSubset = subsetJson(incr);
    const cleanFull = subsetJson(readJ(KG(cleanRepo)));
    expect(incrSubset).toBe(cleanFull);
    // and the known cross-file facts survived the incremental path
    const edges = incr.edges as GraphEdge[];
    expect(edges.some((e) => e.type === "calls" && e.source === "function:src/a.ts:foo" && e.target === "function:src/a.ts:bar")).toBe(true);
    expect(edges.some((e) => e.type === "inherits" && e.source === "class:src/a.ts:Derived" && e.target === "class:src/b.ts:Base")).toBe(true);
    expect(edges.some((e) => e.type === "imports" && e.source === "file:src/a.ts" && e.target === "file:src/b.ts")).toBe(true);
  });

  test("SQLite is NOT required (no .guild/index.sqlite written by this path)", () => {
    expect(fs.existsSync(path.join(repo, ".guild", "index.sqlite"))).toBe(false);
  });
});
