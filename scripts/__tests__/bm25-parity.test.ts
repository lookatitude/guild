/**
 * scripts/__tests__/bm25-parity.test.ts
 *
 * Re-arch WAVE 1 (M9 single-source floor) — PARITY GUARD for the BM25 utility.
 *
 * Unit 1 collapsed three BM25 copies (guild-memory/src/bm25.ts,
 * scripts/lib/ingest-similarity.ts, and the import in scripts/lib/recall.ts)
 * into ONE canonical impl at scripts/lib/shared/bm25.ts. This test proves the
 * collapse was behavior-neutral and stays that way:
 *
 *   (A) PARITY:        canonical(sample) === frozen-reference(sample) for the
 *                      exact algorithm that was deleted (k1=1.5, b=0.75).
 *   (B) ANTI-VACUITY:  a deliberately divergent variant (k1=2.0) produces a
 *                      DIFFERENT result on the same sample — proving the parity
 *                      assertion has teeth and would FAIL if the canonical impl
 *                      ever drifted from the frozen reference.
 *   (C) SINGLE-IMPL:   exactly one file in the source tree DEFINES bm25Score;
 *                      every other consumer re-exports/imports it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  tokenize as canonicalTokenize,
  bm25Score as canonicalBm25Score,
} from "../lib/shared/bm25";

// ── Frozen reference: the verbatim algorithm that lived in ingest-similarity.ts
//    and guild-memory/src/bm25.ts BEFORE the WAVE-1 single-source collapse.
//    Hard-coded here so a future drift in the canonical impl is detected even
//    though the old copies were deleted. `k1Override` exists ONLY for the
//    anti-vacuity control; the reference itself uses 1.5 (the shipped constant).
const REF_TOKEN_RE = /[A-Za-z0-9]+/g;

function refTokenize(s: string): string[] {
  const out: string[] = [];
  const m = s.toLowerCase().match(REF_TOKEN_RE);
  if (!m) return out;
  for (const tok of m) if (tok.length > 1) out.push(tok);
  return out;
}

function refBm25Score(
  queryTokens: string[],
  docs: { tokens: string[] }[],
  k1Override?: number,
): number[] {
  const k1 = k1Override ?? 1.5;
  const b = 0.75;
  const N = docs.length;
  if (N === 0) return [];
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;

  const df = new Map<string, number>();
  for (const q of new Set(queryTokens)) {
    let count = 0;
    for (const d of docs) {
      if (d.tokens.includes(q)) count++;
    }
    df.set(q, count);
  }

  const scores: number[] = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const doc = docs[i]!;
    const dl = doc.tokens.length || 1;
    const tf = new Map<string, number>();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let s = 0;
    for (const q of queryTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const num = f * (k1 + 1);
      const den = f + k1 * (1 - b + b * (dl / avgdl));
      s += idf * (num / den);
    }
    scores[i] = s;
  }
  return scores;
}

// Representative corpus + queries (mix of overlap, repetition, length variance).
const CORPUS = [
  "the quick brown fox jumps over the lazy dog",
  "BM25 ranking with k1 and b parameters over wiki pages",
  "prototype pollution guard rejects __proto__ constructor keys",
  "guild memory search ranks pages by token frequency frequency frequency",
  "a short doc",
  "knowledge graph scoring importance confidence proximity topic subtopic",
];
const QUERIES = [
  "bm25 ranking pages",
  "quick fox dog",
  "frequency token frequency",
  "nonexistent zzz term",
  "graph scoring importance",
];

function docsFromCorpus(tok: (s: string) => string[]) {
  return CORPUS.map((c) => ({ tokens: tok(c) }));
}

describe("WAVE-1 Unit 1 — BM25 single-source parity", () => {
  test("(A) parity: canonical bm25Score matches the frozen reference on every query", () => {
    for (const q of QUERIES) {
      const canonical = canonicalBm25Score(canonicalTokenize(q), docsFromCorpus(canonicalTokenize));
      const reference = refBm25Score(refTokenize(q), docsFromCorpus(refTokenize));
      expect(canonical).toEqual(reference);
    }
  });

  test("(A) parity: canonical tokenizer matches the frozen reference", () => {
    for (const c of [...CORPUS, ...QUERIES, "", "X y-Z_99 a", "ALL CAPS TEXT"]) {
      expect(canonicalTokenize(c)).toEqual(refTokenize(c));
    }
  });

  test("(B) anti-vacuity control: a divergent k1 (2.0) yields a DIFFERENT result", () => {
    // Proves the parity equality above is non-vacuous: if the canonical impl ever
    // drifted (e.g. someone changed k1), test (A) would fail. We assert at least
    // one query where the divergent variant disagrees with the canonical impl.
    let sawDivergence = false;
    for (const q of QUERIES) {
      const qt = canonicalTokenize(q);
      const docs = docsFromCorpus(canonicalTokenize);
      const canonical = canonicalBm25Score(qt, docs);
      const divergent = refBm25Score(qt, docs, /* k1 */ 2.0);
      if (JSON.stringify(canonical) !== JSON.stringify(divergent)) sawDivergence = true;
    }
    expect(sawDivergence).toBe(true);
  });

  test("(C) single-impl: exactly one source file DEFINES bm25Score", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const roots = [
      path.join(repoRoot, "scripts"),
      path.join(repoRoot, "mcp-servers"),
    ];
    const SKIP = new Set(["node_modules", "dist", ".git", "build", "coverage"]);
    const definers: string[] = [];

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) continue;
          walk(path.join(dir, e.name));
        } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          const src = fs.readFileSync(path.join(dir, e.name), "utf8");
          // A DEFINITION (not a re-export `export { bm25Score } from ...`).
          if (/function\s+bm25Score\s*\(/.test(src)) {
            definers.push(path.relative(repoRoot, path.join(dir, e.name)));
          }
        }
      }
    }
    for (const r of roots) walk(r);

    expect(definers).toEqual(["scripts/lib/shared/bm25.ts"]);
  });
});
