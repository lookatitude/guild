/**
 * understand/__tests__/resolve-calls.test.ts
 *
 * LANE G2 unit gate — accurate, import/type-aware call resolution. Run from
 * plugin/scripts/:  npx jest --no-coverage "resolve-calls|clra-conformance"
 *
 * Covers (the oracle precision/recall + SQLite parity live in
 * clra-conformance.test.ts, which shares the fixture + parity harness):
 *   - Cross-file correctness vs a name-collision local (gate item 2)
 *   - Confidence on EVERY calls edge (gate item 3)
 *   - Determinism preserved (gate item 5)
 *   - External/dynamic calls (console.log) are not falsely linked
 *   - FIX G2-1: enriched/LLM-tier calls edges are preserved, not dropped
 *   - FIX G2-4: alias-imported (tsconfig paths) calls resolve, not vanish
 *   - FIX G2-5: Python `import b; b.add()` qualified module calls resolve
 *   - FIX G2-6: an unimported bare name is NOT falsely linked cross-file
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge } from "../lib/schema";

const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

function build(root: string, rel: string[]) {
  const base = extractStructuralGraph(root, rel, readFile);
  return refineCalls(root, rel, readFile, base);
}

function calls(edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.type === "calls");
}

function tempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Gate item 2 — cross-file correctness over a name collision
// ---------------------------------------------------------------------------

describe("G2 gate 2 — cross-file resolution beats a name collision", () => {
  test("imported compute() resolves to ./b, NOT the same-named def in c.ts", () => {
    const dir = tempRepo({
      "b.ts": "export function compute(): number {\n  return 1;\n}\n",
      "c.ts": "export function compute(): number {\n  return 2;\n}\n",
      "a.ts": [
        'import { compute } from "./b";',
        "export function main(): number {",
        "  return compute();",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const g = build(dir, ["a.ts", "b.ts", "c.ts"]);
      const c = calls(g.edges);
      expect(c.some((e) => e.source === "function:a.ts:main" && e.target === "function:b.ts:compute")).toBe(true);
      // the same-named collision in c.ts must NOT be linked
      expect(c.some((e) => e.source === "function:a.ts:main" && e.target === "function:c.ts:compute")).toBe(false);
      // the resolved cross-file edge is high confidence + flagged cross_file
      const edge = c.find((e) => e.target === "function:b.ts:compute")!;
      expect((edge as Record<string, unknown>).confidence).toBe("high");
      expect((edge as Record<string, unknown>).cross_file).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Python: imported add() resolves to b.py, not a same-named def in c.py", () => {
    const dir = tempRepo({
      "b.py": "def add(a, b):\n    return a + b\n",
      "c.py": "def add(a, b):\n    return 0\n",
      "a.py": "from b import add\n\n\ndef main():\n    return add(1, 2)\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py", "c.py"]);
      const c = calls(g.edges);
      expect(c.some((e) => e.source === "function:a.py:main" && e.target === "function:b.py:add")).toBe(true);
      expect(c.some((e) => e.target === "function:c.py:add")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Gate item 3 — no silent drops; confidence on every edge
// ---------------------------------------------------------------------------

describe("G2 gate 3 — no silent drops, confidence on every calls edge", () => {
  test("EVERY calls edge carries a confidence field (high|medium|low)", () => {
    const FIX = path.join(__dirname, "fixtures", "clra-fixture");
    const rel = ["src/a.ts", "src/b.ts", "src/shapes.ts", "py/a.py", "py/b.py", "py/shapes.py"];
    const g = build(FIX, rel);
    const c = calls(g.edges);
    expect(c.length).toBeGreaterThan(0);
    for (const e of c) {
      expect(["high", "medium", "low"]).toContain((e as Record<string, unknown>).confidence);
    }
  });

});

// ---------------------------------------------------------------------------
// FIX G2-6 — an unimported bare name is NOT falsely linked cross-file
// ---------------------------------------------------------------------------

describe("FIX G2-6 — no false cross-file link without import/same-file evidence", () => {
  test("ambiguous unimported Python name (two defs) is NOT linked cross-file", () => {
    // `shared` is defined in BOTH b.py and c.py and NOT imported → no evidence.
    const dir = tempRepo({
      "b.py": "def shared():\n    return 1\n",
      "c.py": "def shared():\n    return 2\n",
      "a.py": "def main():\n    return shared()\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py", "c.py"]);
      const c = calls(g.edges);
      // No edge to either cross-file `shared` — the bare name is treated as dynamic.
      expect(c.some((x) => x.source === "function:a.py:main" && x.target.endsWith(":shared"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("global-unique-but-unimported Python name is NOT linked cross-file", () => {
    const dir = tempRepo({
      "b.py": "def only_here():\n    return 1\n",
      "a.py": "def main():\n    return only_here()\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py"]);
      // unique global, but unimported → external/dynamic, no false cross-file edge.
      expect(calls(g.edges).some((x) => x.target === "function:b.py:only_here")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX G2-5 — Python qualified module calls (`import b; b.add()`) resolve
// ---------------------------------------------------------------------------

describe("FIX G2-5 — Python `import module` qualified calls resolve", () => {
  test("`import b; b.add()` resolves to function:b.py:add (high, cross_file)", () => {
    const dir = tempRepo({
      "b.py": "def add(a, b):\n    return a + b\n",
      "a.py": "import b\n\n\ndef main():\n    return b.add(1, 2)\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py"]);
      const e = calls(g.edges).find((x) => x.source === "function:a.py:main" && x.target === "function:b.py:add");
      expect(e).toBeDefined();
      expect((e as Record<string, unknown>).confidence).toBe("high");
      expect((e as Record<string, unknown>).cross_file).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`import b as c; c.add()` (aliased module) resolves to function:b.py:add", () => {
    const dir = tempRepo({
      "b.py": "def add(a, b):\n    return a + b\n",
      "a.py": "import b as c\n\n\ndef main():\n    return c.add(1, 2)\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py"]);
      expect(calls(g.edges).some((x) => x.source === "function:a.py:main" && x.target === "function:b.py:add")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a qualified call on a LOCAL (unimported) object is NOT linked", () => {
    const dir = tempRepo({
      "b.py": "def add(a, b):\n    return a + b\n",
      // `obj` is a local, not an imported module — obj.add() must not link to b.add
      "a.py": "def main():\n    obj = make()\n    return obj.add(1, 2)\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py"]);
      expect(calls(g.edges).some((x) => x.target === "function:b.py:add")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX G2-1 — enriched / LLM-tier calls edges are preserved, not dropped
// ---------------------------------------------------------------------------

describe("FIX G2-1 — non-structural calls edges survive refinement", () => {
  test("an LLM-tier calls edge on a handled file is preserved verbatim", () => {
    const dir = tempRepo({
      "b.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "a.ts": [
        'import { add } from "./b";',
        "export function main(): number {",
        "  return add(1, 2);",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const base = extractStructuralGraph(dir, ["a.ts", "b.ts"], readFile);
      // Inject a non-structural (LLM-tier) calls edge that G2 will NOT reproduce
      // (a dynamic call the model inferred). It is on a HANDLED (.ts) file.
      const llmEdge = {
        source: "function:a.ts:main",
        target: "function:b.ts:add",
        type: "calls",
        direction: "out" as const,
        weight: 0.5,
        confidence: "medium",
        extractor: "llm-v1", // NOT structural-v1
        rationale: "model-inferred",
      };
      const dynamicLlmEdge = {
        source: "function:a.ts:main",
        target: "function:b.ts:add",
        type: "depends_on",
        direction: "out" as const,
        weight: 0.5,
        extractor: "llm-v1",
      };
      const enriched = {
        nodes: base.nodes,
        edges: [...base.edges, llmEdge as unknown as GraphEdge, dynamicLlmEdge as unknown as GraphEdge],
      };
      const refined = refineCalls(dir, ["a.ts", "b.ts"], readFile, enriched);
      // The LLM calls edge is preserved with its original provenance (not re-tagged
      // g1-syntactic, not dropped) — foreign edges win on collision.
      const kept = refined.edges.find(
        (e) => e.type === "calls" && e.source === "function:a.ts:main" && e.target === "function:b.ts:add",
      ) as Record<string, unknown>;
      expect(kept).toBeDefined();
      expect(kept.extractor).toBe("llm-v1");
      expect(kept.rationale).toBe("model-inferred");
      // the unrelated non-calls LLM edge survives too
      expect(refined.edges.some((e) => e.type === "depends_on" && (e as Record<string, unknown>).extractor === "llm-v1")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FIX G2-4 — alias-imported (tsconfig paths) calls resolve, not vanish
// ---------------------------------------------------------------------------

describe("FIX G2-4 — tsconfig path-alias imports resolve", () => {
  test("a call imported via a `paths` alias resolves to the real declaration", () => {
    const dir = tempRepo({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } },
      }),
      "src/b.ts": "export function aliased(): number {\n  return 1;\n}\n",
      "src/a.ts": [
        'import { aliased } from "@app/b";',
        "export function main(): number {",
        "  return aliased();",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const g = build(dir, ["src/a.ts", "src/b.ts"]);
      // Without tsconfig paths the alias import would not resolve and the edge
      // would vanish; with FIX G2-4 it resolves to the real declaration.
      expect(
        calls(g.edges).some((e) => e.source === "function:src/a.ts:main" && e.target === "function:src/b.ts:aliased"),
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// External/dynamic calls are not falsely linked
// ---------------------------------------------------------------------------

describe("G2 — external/dynamic calls are not falsely linked", () => {
  test("console.log and a builtin are not turned into internal call edges", () => {
    const dir = tempRepo({
      "a.ts": [
        "export function log(): void {}", // a same-named local that must NOT be hit
        "export function main(): void {",
        "  console.log('hi');",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const g = build(dir, ["a.ts"]);
      // console.log must NOT resolve to the local `log` (compiler knows console is external)
      expect(calls(g.edges).some((e) => e.target === "function:a.ts:log")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism (gate item 5)
// ---------------------------------------------------------------------------

describe("G2 gate 5 — determinism preserved", () => {
  test("two runs over the fixture yield byte-identical refined edges", () => {
    const FIX = path.join(__dirname, "fixtures", "clra-fixture");
    const rel = ["src/a.ts", "src/b.ts", "src/shapes.ts", "py/a.py", "py/b.py", "py/shapes.py"];
    const g1 = build(FIX, rel);
    const g2 = build(FIX, [...rel].reverse());
    expect(JSON.stringify(g1.edges)).toBe(JSON.stringify(g2.edges));
    expect(JSON.stringify(g1.nodes)).toBe(JSON.stringify(g2.nodes));
  });
});
