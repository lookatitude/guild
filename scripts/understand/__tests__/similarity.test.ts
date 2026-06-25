/**
 * understand/__tests__/similarity.test.ts
 *
 * TASK T8.1 (Goal G8) validation gate (non-vacuous). Run from plugin/scripts/:
 *   npx jest --no-coverage similarity
 *
 * Gates (T8.1.md §"Validation gate"):
 *   1. precision@1   — on the clra-fixture, kgSimilar(clonePair[i][0]) ranks
 *                      clonePair[i][1] #1 for every clone pair. Anti-vacuity: an
 *                      unrelated function never ranks above the true clone.
 *   2. Determinism   — seeded hashing → byte-identical fingerprints/scores across
 *                      runs; reversed node order → identical ranking + edges.
 *   3. Cost          — 0 model tokens, 0 network: proven structurally (no model
 *                      client import; no fetch/http/https/net/tls) AND via a fetch spy.
 *   4. Threshold     — below-threshold pairs excluded; candidate edge count is
 *                      bounded (≤ k·codeNodes), monotone non-increasing in threshold,
 *                      every edge is type "similar_to" + candidate:true (no spam).
 *   5. SQLite-off==on — this module is JSON-only (no SQLite). Stated + asserted by
 *                      the absence of any index-cache/sqlite import. The off-path IS
 *                      the source of truth, so off==on holds vacuously; reversed-order
 *                      parity (gate 2) stands in for the index-mode parity check.
 *   + No literal NUL bytes in the module source.
 */

import * as fs from "fs";
import * as path from "path";

import { extractStructuralGraph } from "../lib/structural";
import {
  kgSimilar,
  buildSimilarEdges,
  computeFingerprints,
  minhashSignature,
  isCodeNode,
} from "../lib/similarity";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, "fixtures", "clra-fixture");
const REL_FILES = [
  "src/a.ts", "src/b.ts", "src/shapes.ts",
  "py/a.py", "py/b.py", "py/shapes.py",
];
const readFile = (abs: string) => fs.readFileSync(abs, "utf8");
const OPTS = { repoRoot: FIXTURE_DIR, readFile };

const ORACLE = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "clra-fixture.expected.json"), "utf8"),
) as { clonePairs: [string, string][] };

const SIMILARITY_SRC = fs.readFileSync(
  path.join(__dirname, "..", "lib", "similarity.ts"),
  "utf8",
);

// Comment-stripped view: the structural cost/no-network proofs must hold over
// CODE, not prose. (The header legitimately says "no embeddings / SQLite: NONE";
// those words must not trip the assertions.)
const SIMILARITY_CODE = SIMILARITY_SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
  .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (keeps http:// in strings, of which there are none)

function buildGraph(rel: string[] = REL_FILES) {
  return extractStructuralGraph(FIXTURE_DIR, rel, readFile);
}

// ---------------------------------------------------------------------------
// 1. precision@1 + anti-vacuity
// ---------------------------------------------------------------------------

describe("G8 gate 1 — precision@1 on clone pairs (+ anti-vacuity)", () => {
  const graph = buildGraph();

  test.each(ORACLE.clonePairs)(
    "kgSimilar(%s) ranks its clone #1",
    (a, b) => {
      const res = kgSimilar(graph, a, 5, 0, OPTS);
      expect(res.neighbors.length).toBeGreaterThan(0);
      // The true clone is the single top-ranked neighbor (precision@1 = 1.0).
      expect(res.neighbors[0].id).toBe(b);
      // The clone is also the symmetric #1 from the other side.
      const back = kgSimilar(graph, b, 5, 0, OPTS);
      expect(back.neighbors[0].id).toBe(a);
    },
  );

  test("an unrelated function never outranks the true clone (anti-vacuity)", () => {
    for (const [a, b] of ORACLE.clonePairs) {
      const res = kgSimilar(graph, a, 10, 0, OPTS);
      const cloneScore = res.neighbors.find((n) => n.id === b)!.score;
      for (const n of res.neighbors) {
        if (n.id === b) continue;
        // No other node may meet or exceed the true clone's score.
        expect(n.score).toBeLessThan(cloneScore);
      }
    }
  });

  test("only function/class code nodes are candidates (files excluded)", () => {
    const [a] = ORACLE.clonePairs[0];
    const res = kgSimilar(graph, a, 20, 0, OPTS);
    for (const n of res.neighbors) {
      expect(["function", "class"]).toContain(n.type);
    }
    const fileNode = graph.nodes.find((n) => n.type === "file")!;
    expect(isCodeNode(fileNode)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Determinism (seeded hashing; order-independent)
// ---------------------------------------------------------------------------

describe("G8 gate 2 — determinism (byte-stable, order-independent)", () => {
  test("two kgSimilar runs produce byte-identical JSON", () => {
    const g = buildGraph();
    const [a] = ORACLE.clonePairs[0];
    const r1 = JSON.stringify(kgSimilar(g, a, 5, 0.3, OPTS));
    const r2 = JSON.stringify(kgSimilar(g, a, 5, 0.3, OPTS));
    expect(r1).toBe(r2);
  });

  test("minhashSignature is a pure function of source text", () => {
    const src = "let total = 0;\nfor (let i = 0; i < xs.length; i++) total = total + xs[i];";
    expect(minhashSignature(src)).toEqual(minhashSignature(src));
  });

  test("reversed input file order → identical ranking AND identical edges", () => {
    const g = buildGraph(REL_FILES);
    const gRev = buildGraph([...REL_FILES].reverse());
    for (const [a] of ORACLE.clonePairs) {
      expect(JSON.stringify(kgSimilar(gRev, a, 5, 0.3, OPTS)))
        .toBe(JSON.stringify(kgSimilar(g, a, 5, 0.3, OPTS)));
    }
    expect(JSON.stringify(buildSimilarEdges(gRev, 0.6, 5, OPTS)))
      .toBe(JSON.stringify(buildSimilarEdges(g, 0.6, 5, OPTS)));
  });

  test("reversed NODE array order → identical fingerprint table", () => {
    const g = buildGraph();
    const gRev = { nodes: [...g.nodes].reverse() };
    const f1 = computeFingerprints(g, OPTS);
    const f2 = computeFingerprints(gRev, OPTS);
    for (const [id, fp] of f1) {
      expect(f2.get(id)).toEqual(fp);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Cost — 0 model tokens, 0 network
// ---------------------------------------------------------------------------

describe("G8 gate 3 — 0 model tokens, 0 network", () => {
  test("module source imports no model client and opens no socket", () => {
    // No LLM / embeddings client (code, not prose).
    expect(SIMILARITY_CODE).not.toMatch(/anthropic|openai|embedding|@ai-sdk|langchain/i);
    // No network call / socket stack.
    expect(SIMILARITY_CODE).not.toMatch(/\b(fetch|XMLHttpRequest)\s*\(/);
    expect(SIMILARITY_CODE).not.toMatch(/require\(["'](http|https|net|tls|dgram|node:http|node:https|node:net|node:tls)["']\)/);
    expect(SIMILARITY_CODE).not.toMatch(/from ["'](http|https|net|tls|dgram|node:http|node:https|node:net|node:tls)["']/);
    // Only fs + path + sibling lib imports are permitted.
    const imports = [...SIMILARITY_CODE.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./schema", "./structural", "fs", "path"]);
  });

  test("running similarity makes no network call (fetch spy)", () => {
    const g = buildGraph();
    const spy = jest.fn();
    const orig = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = spy;
    try {
      for (const [a] of ORACLE.clonePairs) kgSimilar(g, a, 5, 0.3, OPTS);
      buildSimilarEdges(g, 0.6, 5, OPTS);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = orig;
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Threshold — exclusion + bounded candidate edges (no spam)
// ---------------------------------------------------------------------------

describe("G8 gate 4 — threshold exclusion + bounded candidate edges", () => {
  const graph = buildGraph();
  const codeNodeCount = graph.nodes.filter(isCodeNode).length;

  test("emitted edges are similar_to candidates (never auto-promoted)", () => {
    const edges = buildSimilarEdges(graph, 0.6, 5, OPTS);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.type).toBe("similar_to");
      expect((e as { candidate?: unknown }).candidate).toBe(true);
      expect(e.weight).toBeGreaterThanOrEqual(0.6);
      expect(e.source < e.target).toBe(true); // canonical, deduped unordered pair
    }
  });

  test("both clone pairs appear as candidate edges at threshold 0.6", () => {
    const edges = buildSimilarEdges(graph, 0.6, 5, OPTS);
    for (const [a, b] of ORACLE.clonePairs) {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      expect(edges.some((e) => e.source === lo && e.target === hi)).toBe(true);
    }
  });

  test("edge count is bounded and monotone non-increasing in threshold (no spam)", () => {
    const low = buildSimilarEdges(graph, 0.5, 5, OPTS).length;
    const mid = buildSimilarEdges(graph, 0.6, 5, OPTS).length;
    const high = buildSimilarEdges(graph, 0.7, 5, OPTS).length;
    expect(low).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(high);
    // Hard bound: at most k per code node (unordered pairs collapse below this).
    expect(low).toBeLessThanOrEqual(5 * codeNodeCount);
  });

  test("a high threshold excludes below-threshold pairs entirely", () => {
    const edges = buildSimilarEdges(graph, 0.99, 5, OPTS);
    expect(edges.length).toBe(0); // no fixture pair is a 0.99 near-identical match
  });
});

// ---------------------------------------------------------------------------
// 5. SQLite-off==on (JSON-only) + NUL-byte hygiene
// ---------------------------------------------------------------------------

describe("G8 gate 5 — JSON-only (no SQLite) + source hygiene", () => {
  test("module declares no SQLite / index-cache dependency (JSON-only path)", () => {
    expect(SIMILARITY_CODE).not.toMatch(/sqlite|better-sqlite|index-cache|parity-harness/i);
  });

  test("module source contains no literal NUL byte", () => {
    expect(SIMILARITY_SRC.includes(String.fromCharCode(0))).toBe(false);
  });
});
