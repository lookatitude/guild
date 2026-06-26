/**
 * learn/__tests__/similarity.test.ts
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
import * as os from "os";
import * as path from "path";

import type { GraphNode } from "../lib/schema";
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

const SIMILARITY_ENTRY = path.join(__dirname, "..", "lib", "similarity.ts");
const SIMILARITY_SRC = fs.readFileSync(SIMILARITY_ENTRY, "utf8");

// Comment-stripped view: the structural cost/no-network proofs must hold over
// CODE, not prose. (The header legitimately says "no embeddings / SQLite: NONE";
// those words must not trip the assertions.)
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")    // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (keeps http:// in strings, of which there are none)
const SIMILARITY_CODE = stripComments(SIMILARITY_SRC);

/**
 * Module-specifier source, covering EVERY import form (finding T8.1-r2#1):
 *   - bare side-effect    `import "x";`
 *   - static default/named `import x from "x"` / `import {a} from "x"` / `import * as x from "x"`
 *   - re-export            `export {a} from "x"` / `export * from "x"`
 *   - dynamic             `import("x")`
 *   - CommonJS            `require("x")`
 * The capture group is the specifier. `\bimport\s*\(?` matches both the bare
 * side-effect form (no `(`) and the dynamic form (`import(`); `\bfrom` covers the
 * static/re-export forms; `\brequire\s*\(` covers CJS. A regex (not a TS parser) is
 * sufficient and dependency-free for this hygiene scan — it errs toward MORE matches.
 */
const SPEC_SRC = `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)["']([^"']+)["']`;

/**
 * Deny regex: ANY of the import forms above targeting a network/socket builtin
 * (`http`/`https`/`net`/`tls`/`dgram`, bare or `node:`-prefixed). Shared by the
 * top-file check, the transitive-closure check, and the synthetic detection test
 * below so the proof that "a network import is caught" exercises the SAME matcher
 * the real scans use (non-vacuity).
 */
const NET_IMPORT_RE = new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)["'](?:node:)?(?:http|https|net|tls|dgram)["']`,
);

/**
 * Transitive LOCAL import closure of `entryAbs`: follow every relative (`.`-prefixed)
 * specifier — across ALL import forms ({@link SPEC_SRC}: static, bare side-effect,
 * dynamic, re-export, require) — to its `.ts` file and recurse. Used to prove the
 * no-network / no-model property over the WHOLE local closure, not just the top
 * file (findings T8.1#2 / T8.1-r2#1). Bare specifiers (fs/path/crypto) and node
 * builtins stop the walk (they are not followed, but ARE denied by NET_IMPORT_RE).
 */
function localImportClosure(entryAbs: string): string[] {
  const seen = new Set<string>();
  const stack = [path.resolve(entryAbs)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    const dir = path.dirname(file);
    // Fresh regex per file — a shared /g/ instance would carry lastIndex across files.
    const re = new RegExp(SPEC_SRC, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // only FOLLOW local relative imports
      const candidates = [
        path.resolve(dir, `${spec}.ts`),
        path.resolve(dir, `${spec}.tsx`),
        path.resolve(dir, spec, "index.ts"),
        path.resolve(dir, spec),
      ];
      const resolved = candidates.find(
        (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
      );
      if (resolved) stack.push(resolved);
    }
  }
  return [...seen];
}

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

  test("reversed CONSUMED node+edge arrays → identical ranking AND identical edges", () => {
    // Reverse the arrays kgSimilar/buildSimilarEdges actually consume — NOT the
    // file-order input, which extractStructuralGraph re-sorts (that would make this
    // test vacuous, finding T8.1#1). Order-independence must hold for the real path.
    const g = buildGraph();
    const gRev = { nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    // Guard: the reversal is real (the node order genuinely differs).
    expect(gRev.nodes.map((n) => n.id)).not.toEqual(g.nodes.map((n) => n.id));
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
  test("module source imports no model client and opens no socket (top file)", () => {
    // No LLM / embeddings client (code, not prose).
    expect(SIMILARITY_CODE).not.toMatch(/anthropic|openai|embedding|@ai-sdk|langchain/i);
    // No network call / socket stack — deny across EVERY import form (T8.1-r2#1):
    // static, bare side-effect `import "net"`, dynamic `import("net")`, require.
    expect(SIMILARITY_CODE).not.toMatch(/\b(fetch|XMLHttpRequest)\s*\(/);
    expect(SIMILARITY_CODE).not.toMatch(NET_IMPORT_RE);
    // Only fs + path + sibling lib imports are permitted.
    const imports = [...SIMILARITY_CODE.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./schema", "./structural", "fs", "path"]);
  });

  test("TRANSITIVE local import closure opens no socket and pulls no model client", () => {
    // Finding T8.1#2: the cost proof must cover everything similarity.ts pulls in
    // (./schema, ./structural, and their deps), not just the top file.
    const closure = localImportClosure(SIMILARITY_ENTRY);
    // Non-vacuity: the closure genuinely followed the sibling imports + their deps.
    expect(closure.length).toBeGreaterThan(3);
    expect(closure.some((f) => f.endsWith(path.join("lib", "structural.ts")))).toBe(true);
    expect(closure.some((f) => f.endsWith(path.join("lib", "schema.ts")))).toBe(true);
    for (const file of closure) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      expect(code).not.toMatch(/anthropic|openai|embedding|@ai-sdk|langchain/i);
      expect(code).not.toMatch(/\b(fetch|XMLHttpRequest)\s*\(/);
      expect(code).not.toMatch(NET_IMPORT_RE);
    }
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

  test("a BARE side-effect network import in the closure is followed AND denied (T8.1-r2#1)", () => {
    // Build a synthetic local closure whose only network reference is a bare
    // side-effect import — `import "net";` — reached through a bare side-effect
    // RELATIVE import — `import "./mid";`. The old `(?:from|require\()` regex saw
    // neither form, so such a module would have evaded the no-network proof.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clra-closure-"));
    try {
      const entry = path.join(dir, "entry.ts");
      const mid = path.join(dir, "mid.ts");
      // Reached only via the bare side-effect relative form (no `from`, no `require`).
      fs.writeFileSync(entry, 'import "./mid";\nexport const x = 1;\n');
      // The hidden network access — a bare side-effect import of a socket builtin.
      fs.writeFileSync(mid, 'import "net";\nexport const y = 2;\n');

      // The walker now follows the bare side-effect relative import to `mid.ts`.
      const closure = localImportClosure(entry);
      expect(closure.some((f) => f === fs.realpathSync(mid) || f === mid)).toBe(true);

      // Across the closure, the SAME NET_IMPORT_RE the real scan uses flags `mid`'s
      // bare side-effect `import "net";` — detected and denied.
      const offender = closure.find((f) =>
        NET_IMPORT_RE.test(stripComments(fs.readFileSync(f, "utf8"))),
      );
      expect(offender).toBeDefined();

      // Mutation guard (non-vacuity): drop the bare side-effect form back to the old
      // `from`/`require`-only matcher and the same offender is MISSED — proving the
      // broadened form-coverage is what catches it.
      const oldNetRe = /(?:from|require\()\s*["'](?:node:)?(?:http|https|net|tls|dgram)["']/;
      expect(
        closure.some((f) => oldNetRe.test(stripComments(fs.readFileSync(f, "utf8")))),
      ).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dynamic import() and require() of a network builtin are denied too (T8.1-r2#1)", () => {
    // The deny matcher must also bite on the dynamic and CJS forms, not just static.
    expect('const m = await import("https");').toMatch(NET_IMPORT_RE);
    expect('const m = require("dgram");').toMatch(NET_IMPORT_RE);
    expect('import "node:tls";').toMatch(NET_IMPORT_RE);
    // ...but a benign local/builtin module is NOT a false positive.
    expect('import "./schema";').not.toMatch(NET_IMPORT_RE);
    expect('import * as fs from "fs";').not.toMatch(NET_IMPORT_RE);
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

  test("a high threshold keeps ONLY the true clone pairs (everything else excluded)", () => {
    // After type-2 normalization (finding T8.1#3) the genuine clone pairs are
    // near-identical (≈1.0), so a 0.99 threshold admits exactly those and excludes
    // every non-clone pair — proving threshold exclusion still bites.
    const edges = buildSimilarEdges(graph, 0.99, 5, OPTS);
    expect(edges.length).toBe(ORACLE.clonePairs.length);
    for (const [a, b] of ORACLE.clonePairs) {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      expect(edges.some((e) => e.source === lo && e.target === hi)).toBe(true);
    }
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

// ---------------------------------------------------------------------------
// 6. Adversarial: rename-invariant fingerprint (finding T8.1#3)
// ---------------------------------------------------------------------------

describe("G8 gate 6 — rename-invariant fingerprint (a renamed clone beats a same-name non-clone)", () => {
  // Q vs T: structurally identical, every local identifier renamed (true clone).
  // Q vs D: D reuses Q's identifier names verbatim but has a DIFFERENT structure.
  // Verbatim shingling would let D (same names) outrank T (renamed) — finding #3.
  const Q_SRC =
    "function f(xs) { let total = 0; for (let i = 0; i < xs.length; i++) { total = total + xs[i]; } return total; }";
  const T_SRC =
    "function renamed(items) { let sum = 0; for (let k = 0; k < items.length; k++) { sum = sum + items[k]; } return sum; }";
  const D_SRC =
    "function f(xs) { let total = xs; let i = total; total = i; return i; }";

  test("minhashSignature is rename-invariant AND structure-sensitive", () => {
    // Renaming all locals must NOT change the signature (would FAIL on verbatim hashing).
    expect(minhashSignature(Q_SRC)).toEqual(minhashSignature(T_SRC));
    // A same-identifier but structurally different body MUST change the signature.
    expect(minhashSignature(Q_SRC)).not.toEqual(minhashSignature(D_SRC));
  });

  test("kgSimilar ranks the renamed true clone above the same-identifier non-clone", () => {
    const nodes = [
      { id: "Q", type: "function", name: "f", source_refs: [], src: Q_SRC },
      { id: "T", type: "function", name: "renamed", source_refs: [], src: T_SRC },
      { id: "D", type: "function", name: "f2", source_refs: [], src: D_SRC },
    ] as unknown as GraphNode[];
    // alpha:1 isolates the MinHash signal (the path finding #3 is about); cosine off.
    const res = kgSimilar({ nodes }, "Q", 5, 0, { alpha: 1 });
    expect(res.neighbors[0].id).toBe("T");
    const tScore = res.neighbors.find((n) => n.id === "T")!.score;
    const dScore = res.neighbors.find((n) => n.id === "D")!.score;
    expect(tScore).toBeGreaterThan(dScore);
  });
});

// ---------------------------------------------------------------------------
// 7. Security: path containment + numeric-input validation (findings T8.1#4/#5)
// ---------------------------------------------------------------------------

describe("G8 gate 7 — path containment + input validation", () => {
  test("a ../ source_ref that escapes the repo root is refused (no out-of-root read)", () => {
    const reads: string[] = [];
    const spyRead = (abs: string) => {
      reads.push(abs);
      return readFile(abs);
    };
    const evilNode = {
      id: "function:evil",
      type: "function",
      name: "evil",
      source_refs: ["../../../../../../etc/passwd#L1-L1"],
    } as unknown as GraphNode;
    const fps = computeFingerprints(
      { nodes: [evilNode] },
      { repoRoot: FIXTURE_DIR, readFile: spyRead },
    );
    // Traversal ref resolved to nothing → empty fingerprint, reader never invoked.
    expect(fps.get("function:evil")!.minhash).toEqual([]);
    expect(reads).toEqual([]);

    // Positive control: a legit in-root ref IS read through the same spy (proves the
    // refusal above is specific to the escape, not a dead reader).
    const goodNode = {
      id: "function:good",
      type: "function",
      name: "good",
      source_refs: ["src/a.ts#L22-L28"],
    } as unknown as GraphNode;
    const fpsGood = computeFingerprints(
      { nodes: [goodNode] },
      { repoRoot: FIXTURE_DIR, readFile: spyRead },
    );
    expect(reads.some((p) => p.endsWith(path.join("src", "a.ts")))).toBe(true);
    expect(fpsGood.get("function:good")!.minhash.length).toBeGreaterThan(0);
  });

  test("invalid k / threshold / alpha are rejected before any output", () => {
    const g = buildGraph();
    const [a] = ORACLE.clonePairs[0];
    expect(() => kgSimilar(g, a, -1, 0, OPTS)).toThrow(/k must be a non-negative integer/);
    expect(() => kgSimilar(g, a, 1.5, 0, OPTS)).toThrow(/k must be a non-negative integer/);
    expect(() => kgSimilar(g, a, 5, Number.NaN, OPTS)).toThrow(/threshold/);
    expect(() => kgSimilar(g, a, 5, Number.POSITIVE_INFINITY, OPTS)).toThrow(/threshold/);
    // Out-of-[0,1] threshold rejected on BOTH APIs (T8.1-r2#2): `<0` admits every
    // pair (no exclusion / unbounded edges); `>1` excludes all — both out of contract.
    expect(() => kgSimilar(g, a, 5, -1, OPTS)).toThrow(/threshold must be a finite number in \[0,1\]/);
    expect(() => kgSimilar(g, a, 5, 2, OPTS)).toThrow(/threshold must be a finite number in \[0,1\]/);
    expect(() => buildSimilarEdges(g, -1, 5, OPTS)).toThrow(/threshold must be a finite number in \[0,1\]/);
    expect(() => buildSimilarEdges(g, 2, 5, OPTS)).toThrow(/threshold must be a finite number in \[0,1\]/);
    // Inclusive bounds 0 and 1 remain valid (no spurious rejection at the edges).
    expect(() => kgSimilar(g, a, 5, 0, OPTS)).not.toThrow();
    expect(() => kgSimilar(g, a, 5, 1, OPTS)).not.toThrow();
    expect(() => buildSimilarEdges(g, 1, 5, OPTS)).not.toThrow();
    expect(() => kgSimilar(g, a, 5, 0, { ...OPTS, alpha: 2 })).toThrow(/alpha/);
    expect(() => buildSimilarEdges(g, 0.6, -3, OPTS)).toThrow(/k must be a non-negative integer/);
    // k = 0 is the valid empty floor — bounded, never the slice(0,-n) leak.
    expect(kgSimilar(g, a, 0, 0, OPTS).neighbors).toEqual([]);
  });
});
