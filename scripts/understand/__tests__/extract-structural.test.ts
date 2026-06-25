/**
 * understand/__tests__/extract-structural.test.ts
 *
 * LANE G1 validation gate (non-vacuous). Run from plugin/scripts/:
 *   npx jest --no-coverage extract-structural
 *
 * Gates:
 *   1. Determinism      — two runs on the fixture → byte-identical structural subset.
 *   2. Anti-vacuity     — foo()->bar() yields exactly ONE calls edge; removing the
 *                         call removes exactly that edge (bar node still present).
 *   3. Cost             — 0 model/LLM/network calls (proven structurally: the
 *                         extraction sources import no model client and open no socket).
 *   4. Schema-valid     — output validates against lib/schema.ts (validateGraph),
 *                         no structural node/edge dropped.
 *   5. Perf note        — wall-clock on the fixture is logged (recorded, not gated).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import {
  extractStructuralGraph,
  mergeStructuralInto,
  structuralSubset,
  canonicalize,
  STRUCTURAL_PROFILE_KEYS,
  STRUCTURAL_NODE_TYPES,
  STRUCTURAL_EDGE_TYPES,
  STRUCTURAL_EXTRACTOR,
} from "../lib/structural";
import { validateGraph } from "../lib/schema";
import type { GraphEdge, GraphNode } from "../lib/schema";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, "fixtures", "g1-structural");
const REL_FILES = ["a.ts", "b.ts", "mod.py"];
const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

function runOn(repoRoot: string, relFiles: string[]) {
  return extractStructuralGraph(repoRoot, relFiles, readFile);
}

function callsEdge(edges: GraphEdge[], from: string, to: string): GraphEdge[] {
  return edges.filter((e) => e.type === "calls" && e.source === from && e.target === to);
}

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------

describe("G1 gate 1 — determinism (byte-identical structural subset)", () => {
  test("two runs on the fixture produce byte-identical canonical JSON", () => {
    const g1 = runOn(FIXTURE_DIR, REL_FILES);
    const g2 = runOn(FIXTURE_DIR, REL_FILES);
    const s1 = JSON.stringify(structuralSubset(g1), null, 2);
    const s2 = JSON.stringify(structuralSubset(g2), null, 2);
    expect(s1).toBe(s2); // `diff` would exit 0
  });

  test("input file ORDER does not affect output (canonical sort)", () => {
    const g1 = runOn(FIXTURE_DIR, REL_FILES);
    const g2 = runOn(FIXTURE_DIR, [...REL_FILES].reverse());
    expect(JSON.stringify(g1.nodes)).toBe(JSON.stringify(g2.nodes));
    expect(JSON.stringify(g1.edges)).toBe(JSON.stringify(g2.edges));
  });
});

// ---------------------------------------------------------------------------
// 2. Anti-vacuity — the known foo->bar call edge
// ---------------------------------------------------------------------------

describe("G1 gate 2 — anti-vacuity (foo->bar calls edge)", () => {
  test("foo()->bar() produces EXACTLY ONE calls edge (two call sites deduped)", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const e = callsEdge(g.edges, "function:a.ts:foo", "function:a.ts:bar");
    expect(e.length).toBe(1);
  });

  test("removing the call removes EXACTLY that edge; bar node still present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g1-novac-"));
    try {
      // identical base module
      fs.writeFileSync(path.join(dir, "b.ts"), readFile(path.join(FIXTURE_DIR, "b.ts")), "utf8");
      // a.ts where foo NO LONGER calls bar (bar still defined)
      fs.writeFileSync(
        path.join(dir, "a.ts"),
        [
          'import { Base } from "./b";',
          "",
          "export function bar(): number {",
          "  return 1;",
          "}",
          "",
          "export function foo(): number {",
          "  return 0;",
          "}",
          "",
          "export class Derived extends Base {",
          "  run(): number {",
          "    return foo();",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      const g = runOn(dir, ["a.ts", "b.ts"]);
      // the specific edge is gone…
      expect(callsEdge(g.edges, "function:a.ts:foo", "function:a.ts:bar").length).toBe(0);
      // …but bar is still a node (proves the gate isn't vacuously empty)
      expect(g.nodes.some((n) => n.id === "function:a.ts:bar")).toBe(true);
      // and an UNRELATED known edge (run->foo) still fires
      expect(callsEdge(g.edges, "function:a.ts:Derived.run", "function:a.ts:foo").length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cross-file inheritance edge Derived -> Base is produced", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const inh = g.edges.filter(
      (e) => e.type === "inherits" && e.source === "class:a.ts:Derived" && e.target === "class:b.ts:Base",
    );
    expect(inh.length).toBe(1);
  });

  test("import edge a.ts -> b.ts is produced", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const imp = g.edges.filter(
      (e) => e.type === "imports" && e.source === "file:a.ts" && e.target === "file:b.ts",
    );
    expect(imp.length).toBe(1);
  });

  test("Python: Dog inherits Animal, Dog.speak calls bark", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    expect(
      g.edges.some((e) => e.type === "inherits" && e.source === "class:mod.py:Dog" && e.target === "class:mod.py:Animal"),
    ).toBe(true);
    expect(
      callsEdge(g.edges, "function:mod.py:Dog.speak", "function:mod.py:bark").length,
    ).toBe(1);
  });

  test("ambiguous call (d.speak with two speak defs) is NOT linked (no false edge)", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    // main() calls d.speak() — `speak` is defined on both Animal and Dog → ambiguous → skipped
    expect(g.edges.some((e) => e.type === "calls" && e.source === "function:mod.py:main")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Cost — 0 model/network calls (structural proof)
// ---------------------------------------------------------------------------

describe("G1 gate 3 — zero model/LLM/network calls (structural proof)", () => {
  const SOURCES = [
    path.join(__dirname, "..", "lib", "structural.ts"),
    path.join(__dirname, "..", "extract-structural.ts"),
  ];
  const FORBIDDEN = [
    /\banthropic\b/i,
    /\bopenai\b/i,
    /@ai-sdk/i,
    /\bnode-fetch\b/i,
    /\baxios\b/i,
    /\bollama\b/i,
    /\bfetch\s*\(/,
    /https?:\/\//,
    /require\(['"](?:http|https|net|tls)['"]\)/,
    /from\s+['"](?:http|https|net|tls)['"]/,
  ];

  test("extraction sources import no model client and open no socket", () => {
    for (const src of SOURCES) {
      const text = fs.readFileSync(src, "utf8");
      for (const re of FORBIDDEN) {
        expect(text).not.toMatch(re);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Schema validity
// ---------------------------------------------------------------------------

describe("G1 gate 4 — schema-valid against lib/schema.ts", () => {
  function fullGraph(g: { nodes: GraphNode[]; edges: GraphEdge[] }) {
    return {
      version: "guild.knowledge_graph.v1",
      kind: "codebase",
      generated_from_commit: "fixture",
      project: { name: "g1-fixture", description: "" },
      nodes: g.nodes,
      edges: g.edges,
      layers: [],
      tour: [],
    };
  }

  test("validateGraph accepts the output; no structural node/edge dropped", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const result = validateGraph(fullGraph(g));
    expect(result.success).toBe(true);
    expect(result.data?.nodes.length).toBe(g.nodes.length);
    expect(result.data?.edges.length).toBe(g.edges.length);
    expect(result.issues.some((i) => i.level === "dropped")).toBe(false);
  });

  test("all emitted node/edge types are in the structural type sets", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    for (const n of g.nodes) expect(STRUCTURAL_NODE_TYPES.has(n.type)).toBe(true);
    for (const e of g.edges) expect(STRUCTURAL_EDGE_TYPES.has(e.type)).toBe(true);
  });

  test("every node/edge is stamped with the structural extractor marker", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    for (const n of g.nodes) expect((n as Record<string, unknown>).extractor).toBe(STRUCTURAL_EXTRACTOR);
    for (const e of g.edges) expect((e as Record<string, unknown>).extractor).toBe(STRUCTURAL_EXTRACTOR);
  });
});

// ---------------------------------------------------------------------------
// 4b. 25-feature structural profile (sp)
// ---------------------------------------------------------------------------

describe("G1 — 25-feature AST structural profile (sp)", () => {
  test("every function/class node carries an sp with exactly the 25 documented keys", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const code = g.nodes.filter((n) => n.type === "function" || n.type === "class");
    expect(code.length).toBeGreaterThan(0);
    for (const n of code) {
      const sp = (n as Record<string, unknown>).sp as Record<string, number> | undefined;
      expect(sp).toBeDefined();
      expect(Object.keys(sp!).sort()).toEqual([...STRUCTURAL_PROFILE_KEYS].sort());
      for (const k of STRUCTURAL_PROFILE_KEYS) {
        expect(typeof sp![k]).toBe("number");
        expect(Number.isFinite(sp![k])).toBe(true);
      }
    }
  });

  test("sp is sensitive to content (foo with a branch has branch_count > a trivial fn)", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const foo = g.nodes.find((n) => n.id === "function:a.ts:foo");
    const bar = g.nodes.find((n) => n.id === "function:a.ts:bar");
    const fooSp = (foo as Record<string, unknown>).sp as Record<string, number>;
    const barSp = (bar as Record<string, unknown>).sp as Record<string, number>;
    expect(fooSp.branch_count).toBeGreaterThan(barSp.branch_count); // foo has `if` + call sites
    expect(fooSp.call_count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// FIX G1-1 — member calls must not become false free-function edges
// ---------------------------------------------------------------------------

describe("FIX G1-1 — member/qualified calls are not false free-call edges", () => {
  test("obj.bar() does NOT link to a free bar(); a real bar() call DOES", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g1-member-"));
    try {
      fs.writeFileSync(
        path.join(dir, "a.ts"),
        [
          "export function bar(): number {",
          "  return 1;",
          "}",
          "export function viaMember(): number {",
          "  const obj = { bar: () => 2 };",
          "  return obj.bar();", // member call — must NOT link to free `bar`
          "}",
          "export function viaFree(): number {",
          "  return bar();", // free call — MUST link
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      const g = runOn(dir, ["a.ts"]);
      expect(callsEdge(g.edges, "function:a.ts:viaMember", "function:a.ts:bar").length).toBe(0);
      expect(callsEdge(g.edges, "function:a.ts:viaFree", "function:a.ts:bar").length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX G1-5 — collided LLM node keeps structural provenance + counts
// ---------------------------------------------------------------------------

describe("FIX G1-5 — collision provenance is preserved", () => {
  test("an LLM node colliding with a structural symbol stays in the subset + keeps LLM fields", () => {
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const fooId = "function:a.ts:foo";
    const structuralFoo = g.nodes.find((n) => n.id === fooId)!;
    expect(structuralFoo).toBeDefined();

    // Simulate a pre-existing LLM-tier node at the same id (enriched, no `sp`).
    const llmFoo: GraphNode = {
      id: fooId, type: "function", name: "foo",
      source_refs: ["a.ts#L10-L17"], confidence: "high",
      summary: "LLM-written summary", // LLM-only field
    } as GraphNode;
    const otherLlm: GraphNode = {
      id: "concept:domain", type: "concept", name: "Domain",
      source_refs: ["a.ts"], confidence: "medium",
    } as GraphNode;

    const merged = mergeStructuralInto([llmFoo, otherLlm], [], g);
    const mFoo = merged.nodes.find((n) => n.id === fooId)! as Record<string, unknown>;
    expect(mFoo.summary).toBe("LLM-written summary"); // not clobbered
    expect(mFoo.sp).toBeDefined();                    // structural profile attached
    expect(mFoo.structural).toBe(true);               // additive provenance

    // The collided node is COUNTED in the structural subset (not dropped).
    const subset = structuralSubset(merged);
    expect(subset.nodes.some((n) => n.id === fooId)).toBe(true);
    // The pure-LLM node is NOT structural.
    expect(subset.nodes.some((n) => n.id === "concept:domain")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIX G1-6 — zero network/model: dependency-closure scan + runtime fetch spy
// ---------------------------------------------------------------------------

describe("FIX G1-6 — no network/model across the dependency closure", () => {
  function depClosure(entries: string[]): string[] {
    const seen = new Set<string>();
    const stack = [...entries.map((e) => path.resolve(e))];
    const importRe = /(?:from|require\()\s*['"](\.[^'"]+)['"]/g;
    while (stack.length) {
      const real = stack.pop()!;
      if (seen.has(real) || !fs.existsSync(real) || !fs.statSync(real).isFile()) continue;
      seen.add(real);
      const text = fs.readFileSync(real, "utf8");
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(text)) !== null) {
        const base = path.resolve(path.dirname(real), m[1]);
        for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts"]) {
          const cand = base + ext;
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { stack.push(cand); break; }
        }
      }
    }
    return [...seen];
  }

  test("the whole transitive closure imports no model client and opens no socket", () => {
    const here = path.join(__dirname, "..");
    const closure = depClosure([
      path.join(here, "lib", "structural.ts"),
      path.join(here, "extract-structural.ts"),
      path.join(here, "resolve-calls.ts"),
    ]);
    // sanity: the closure actually fanned out beyond the entry files
    expect(closure.length).toBeGreaterThan(5);

    // Usage-precise patterns (a doc URL in a comment is harmless; an actual
    // import/call of a network/model surface is not).
    const FORBIDDEN: RegExp[] = [
      /\banthropic\b/i, /\bopenai\b/i, /@ai-sdk/i, /\bnode-fetch\b/i,
      /\baxios\b/i, /\bollama\b/i, /\bfetch\s*\(/,
      /require\(\s*['"](?:node:)?(?:http|https|net|tls)['"]\s*\)/,
      /from\s+['"](?:node:)?(?:http|https|net|tls)['"]/,
      /new\s+XMLHttpRequest/,
    ];
    for (const f of closure) {
      const text = fs.readFileSync(f, "utf8");
      for (const re of FORBIDDEN) {
        expect({ file: path.relative(here, f), matched: re.test(text) }).toEqual({ file: path.relative(here, f), matched: false });
      }
    }
  });

  test("runtime spy: extraction + call resolution never call global fetch", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { refineCalls } = require("../resolve-calls") as typeof import("../resolve-calls");
    const orig = (globalThis as Record<string, unknown>).fetch;
    let called = false;
    (globalThis as Record<string, unknown>).fetch = () => { called = true; throw new Error("network blocked"); };
    try {
      const base = extractStructuralGraph(FIXTURE_DIR, REL_FILES, readFile);
      refineCalls(FIXTURE_DIR, REL_FILES, readFile, base);
      expect(called).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>).fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// FIX G1-2 + G1-3 + G1-4 — real CLI path: write, validate, sidecar, determinism
// ---------------------------------------------------------------------------

describe("FIX G1-2/3/4 — real extract-structural.ts CLI on a git repo", () => {
  const SCRIPTS_DIR = path.resolve(__dirname, "..", "..");
  const CLI = path.join(SCRIPTS_DIR, "understand", "extract-structural.ts");
  let repo: string;

  function git(args: string[]): void {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  }
  function runCli(): void {
    execFileSync("npx", ["tsx", CLI, "--cwd", repo], { cwd: SCRIPTS_DIR, stdio: "ignore" });
  }
  function readGraph(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-graph.json"), "utf8"));
  }
  function readSidecar(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-graph.json.meta.json"), "utf8"));
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "g1-cli-"));
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "b.ts"), "export function helper(): number {\n  return 42;\n}\nexport class Base {\n  greet(): string {\n    return \"hi\";\n  }\n}\n", "utf8");
    fs.writeFileSync(
      path.join(repo, "src", "a.ts"),
      [
        'import { Base } from "./b";',
        "export function bar(): number { return 1; }",
        "export function foo(): number {",
        "  const x = bar();",
        "  return x + bar();",
        "}",
        "export class Derived extends Base {",
        "  run(): number { return foo(); }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    git(["init"]);
    git(["add", "-A"]);
    git(["commit", "-m", "fixture"]);
    runCli();
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  test("CLI writes a real knowledge-graph.json with the expected structural facts", () => {
    const g = readGraph();
    const nodes = g.nodes as GraphNode[];
    const edges = g.edges as GraphEdge[];
    expect(nodes.some((n) => n.id === "file:src/a.ts")).toBe(true);
    expect(nodes.some((n) => n.id === "function:src/a.ts:foo")).toBe(true);
    expect(nodes.some((n) => n.id === "class:src/a.ts:Derived")).toBe(true);
    expect(edges.some((e) => e.type === "calls" && e.source === "function:src/a.ts:foo" && e.target === "function:src/a.ts:bar")).toBe(true);
    expect(edges.some((e) => e.type === "inherits" && e.source === "class:src/a.ts:Derived" && e.target === "class:src/b.ts:Base")).toBe(true);
    // structural profile rode through the real write path
    const foo = nodes.find((n) => n.id === "function:src/a.ts:foo") as Record<string, unknown>;
    expect(foo.sp).toBeDefined();
  });

  test("FIX G1-3: the written graph validates (validateGraph success)", () => {
    const result = validateGraph(readGraph());
    expect(result.success).toBe(true);
  });

  test("FIX G1-4: commit metadata is in the SIDECAR, not the graph", () => {
    const g = readGraph();
    // graph carries the commit-independent constant, NOT a 40-hex sha
    expect(g.generated_from_commit).toBe("structural");
    expect(String(g.generated_from_commit)).not.toMatch(/^[0-9a-f]{40}$/);
    // sidecar carries the real HEAD sha + 0 model/network
    const sc = readSidecar();
    expect(String(sc.generated_from_commit)).toMatch(/^[0-9a-f]{40}$/);
    expect(sc.model_calls).toBe(0);
    expect(sc.network_calls).toBe(0);
  });

  test("FIX G1-4 anti-vacuity: identical tree at a DIFFERENT commit → byte-identical graph", () => {
    const graph1 = fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    const commit1 = readSidecar().generated_from_commit;

    git(["commit", "--allow-empty", "-m", "empty — same tree, new HEAD"]);
    runCli();

    const graph2 = fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    const commit2 = readSidecar().generated_from_commit;

    expect(graph2).toBe(graph1);      // graph unchanged across the commit
    expect(commit2).not.toBe(commit1); // but the sidecar DID see the new HEAD
  });
});

// ---------------------------------------------------------------------------
// FIX G2-2 + G2-3 — CLI normalizes a stale sha AND writes the VALIDATED graph
// ---------------------------------------------------------------------------

describe("FIX G2-2/G2-3 — stale sha normalized + validated graph written (real CLI)", () => {
  const SCRIPTS_DIR = path.resolve(__dirname, "..", "..");
  const CLI = path.join(SCRIPTS_DIR, "understand", "extract-structural.ts");
  let repo: string;
  const KG = () => path.join(repo, ".guild", "indexes", "knowledge-graph.json");

  function git(args: string[]): void {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  }
  function runCli(): void {
    execFileSync("npx", ["tsx", CLI, "--cwd", repo], { cwd: SCRIPTS_DIR, stdio: "ignore" });
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "g2-norm-"));
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export function foo(): number {\n  return 1;\n}\n", "utf8");
    git(["init"]);
    git(["add", "-A"]);
    git(["commit", "-m", "fixture"]);

    // Seed a PRE-EXISTING graph that (1) carries a stale 40-hex commit sha and
    // (2) holds a non-structural node MISSING `confidence` — which the validator
    // auto-fixes to "low". A faithful run must normalize BOTH.
    const idxDir = path.join(repo, ".guild", "indexes");
    fs.mkdirSync(idxDir, { recursive: true });
    const staleSha = "a".repeat(40);
    const seeded = {
      version: "guild.knowledge_graph.v1",
      kind: "codebase",
      generated_from_commit: staleSha,
      project: { name: "seeded", description: "" },
      nodes: [
        // non-structural LLM-tier node, deliberately missing `confidence`
        { id: "concept:domain", type: "concept", name: "Domain", source_refs: ["src/a.ts"] },
      ],
      edges: [],
      layers: [],
      tour: [],
    };
    fs.writeFileSync(KG(), JSON.stringify(seeded), "utf8");
    runCli();
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  test("FIX G2-2: a stale 40-hex sha in the existing graph is normalized to \"structural\"", () => {
    const g = JSON.parse(fs.readFileSync(KG(), "utf8")) as Record<string, unknown>;
    expect(g.generated_from_commit).toBe("structural");
    expect(String(g.generated_from_commit)).not.toMatch(/^[0-9a-f]{40}$/);
  });

  test("FIX G2-3: the written graph is the VALIDATED one (validator auto-fix applied on disk)", () => {
    const g = JSON.parse(fs.readFileSync(KG(), "utf8")) as { nodes: Array<Record<string, unknown>> };
    const concept = g.nodes.find((n) => n.id === "concept:domain");
    expect(concept).toBeDefined();
    // The seeded node had NO confidence; writing validation.data (not the raw
    // `out`) means the auto-fixed default is what landed on disk.
    expect(concept!.confidence).toBe("low");
    // And the on-disk artifact re-validates clean (idempotent).
    expect(validateGraph(g).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FIX-T4.1-1 — path containment: a `../` out path is refused (real CLI)
// ---------------------------------------------------------------------------

describe("FIX-T4.1-1 — out-path containment (real CLI)", () => {
  const SCRIPTS_DIR = path.resolve(__dirname, "..", "..");
  const CLI = path.join(SCRIPTS_DIR, "understand", "extract-structural.ts");
  let repo: string;
  let outside: string;

  function git(args: string[]): void {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  }

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "g1-contain-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "g1-outside-"));
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export function foo(): number { return 1; }\n", "utf8");
    git(["init"]);
    git(["add", "-A"]);
    git(["commit", "-m", "fixture"]);
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
    if (outside) fs.rmSync(outside, { recursive: true, force: true });
  });

  test("a relative `../` out path escaping the repo is refused (non-zero exit, no write)", () => {
    const escapeRel = path.join("..", path.basename(outside), "escape.json");
    const escapeAbsTarget = path.join(repo, escapeRel); // == outside/escape.json
    let exitCode = 0;
    try {
      execFileSync("npx", ["tsx", CLI, "--cwd", repo, "--out", escapeRel], { cwd: SCRIPTS_DIR, stdio: "pipe" });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).not.toBe(0);
    // the artifact was NOT written outside the repo
    expect(fs.existsSync(escapeAbsTarget)).toBe(false);
    expect(fs.existsSync(path.join(outside, "escape.json"))).toBe(false);
    // …and nothing leaked the cache sidecar either
    expect(fs.existsSync(`${escapeAbsTarget}.structural-cache.json`)).toBe(false);
  });

  test("an ABSOLUTE out path outside the repo is refused (non-zero exit, no write)", () => {
    const absTarget = path.join(outside, "abs-escape.json");
    let exitCode = 0;
    try {
      execFileSync("npx", ["tsx", CLI, "--cwd", repo, "--out", absTarget], { cwd: SCRIPTS_DIR, stdio: "pipe" });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).not.toBe(0);
    expect(fs.existsSync(absTarget)).toBe(false);
  });

  test("a contained out path under the repo is ACCEPTED (proves the guard is not vacuous)", () => {
    const okRel = path.join("sub", "graph.json");
    execFileSync("npx", ["tsx", CLI, "--cwd", repo, "--out", okRel], { cwd: SCRIPTS_DIR, stdio: "ignore" });
    expect(fs.existsSync(path.join(repo, okRel))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Perf note (recorded, not gated)
// ---------------------------------------------------------------------------

describe("G1 gate 5 — perf note (recorded, not gated)", () => {
  test("logs wall-clock for the fixture extraction", () => {
    const t0 = Date.now();
    const g = runOn(FIXTURE_DIR, REL_FILES);
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[G1 perf] fixture (${REL_FILES.length} files): ${g.nodes.length} nodes, ${g.edges.length} edges in ${ms}ms`);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(canonicalize(g).nodes.length).toBe(g.nodes.length);
  });
});
