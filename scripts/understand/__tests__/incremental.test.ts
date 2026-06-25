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
