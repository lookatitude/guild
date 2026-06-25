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

import {
  extractStructuralGraph,
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
