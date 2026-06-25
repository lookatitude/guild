/**
 * understand/__tests__/resolve-calls.test.ts
 *
 * LANE G2 unit gate — accurate, import/type-aware call resolution. Run from
 * plugin/scripts/:  npx jest --no-coverage "resolve-calls|clra-conformance"
 *
 * Covers (the oracle precision/recall + SQLite parity live in
 * clra-conformance.test.ts, which shares the fixture + parity harness):
 *   - Cross-file correctness vs a name-collision local (gate item 2)
 *   - No silent drops: confidence on EVERY calls edge; an ambiguous call is kept
 *     low-confidence, not dropped (gate item 3)
 *   - Determinism preserved (gate item 5)
 *   - External/dynamic calls (console.log) are not falsely linked
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

  test("ambiguous Python call is KEPT low-confidence (deterministic pick), not dropped", () => {
    // `shared` is defined in BOTH b.py and c.py and NOT imported → ambiguous.
    const dir = tempRepo({
      "b.py": "def shared():\n    return 1\n",
      "c.py": "def shared():\n    return 2\n",
      "a.py": "def main():\n    return shared()\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py", "c.py"]);
      const c = calls(g.edges);
      const e = c.find((x) => x.source === "function:a.py:main" && x.target.endsWith(":shared"));
      expect(e).toBeDefined(); // present, NOT silently dropped
      expect((e as Record<string, unknown>).confidence).toBe("low");
      // deterministic pick = lexicographically-first file (b.py before c.py)
      expect(e!.target).toBe("function:b.py:shared");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("global-unique-but-unimported call resolves at MEDIUM confidence", () => {
    const dir = tempRepo({
      "b.py": "def only_here():\n    return 1\n",
      "a.py": "def main():\n    return only_here()\n",
    });
    try {
      const g = build(dir, ["a.py", "b.py"]);
      const e = calls(g.edges).find((x) => x.target === "function:b.py:only_here");
      expect(e).toBeDefined();
      expect((e as Record<string, unknown>).confidence).toBe("medium");
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
