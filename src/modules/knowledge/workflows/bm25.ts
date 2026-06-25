/**
 * src/modules/knowledge/workflows/bm25.ts
 *
 * CANONICAL, single-source BM25 utility (re-arch WAVE 1, M9 single-source floor).
 * This is the ONE implementation of the BM25 tokenizer + scorer in the repo.
 * Every consumer imports from here:
 *   - mcp-servers/guild-memory/src/bm25.ts  (thin re-export — keeps its import path)
 *   - mcp-servers/guild-memory/src/index.ts (via ./bm25)
 *   - scripts/lib/recall.ts                  (file-BM25 branch)
 *   - scripts/lib/ingest-similarity.ts       (re-exports tokenize/bm25Score)
 *
 * Pure: no MCP / I/O dependencies; safe to import from any context (tests too).
 *
 * Parameters: k1=1.5, b=0.75 — identical to the guild-memory search path.
 * Changing these constants is a breaking change for every consumer above and is
 * guarded by scripts/__tests__/bm25-parity.test.ts (parity + anti-vacuity).
 */

export const TOKEN_RE = /[A-Za-z0-9]+/g;

/**
 * Tokenize a string: lowercase, split on non-alphanumeric, drop length-1 tokens.
 * Identical to the tokenizer used by guild-memory's BM25 search path.
 */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const m = s.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (const tok of m) if (tok.length > 1) out.push(tok);
  return out;
}

/**
 * Split ONE alphanumeric run into camelCase / PascalCase / acronym sub-words.
 * Digits stay attached to the preceding letters (so `v2`/`bm25` are NOT split),
 * which keeps this a strict super-set of `tokenize` for all-lowercase/digit text.
 *   processOrder   → [process, Order]
 *   ProcessOrder   → [Process, Order]
 *   HTTPRequest    → [HTTP, Request]
 *   bm25           → [bm25]           (no internal uppercase → unchanged)
 */
function splitCamel(run: string): string[] {
  return run
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // fooBar / v2Bar → foo Bar / v2 Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // HTTPRequest → HTTP Request
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Identifier-aware tokenizer (G7): like {@link tokenize}, but ALSO emits the
 * camelCase/PascalCase sub-words of each run, so `process_order` (→ process,
 * order) matches `processOrder` (→ processorder, process, order). The full
 * lowercased run is always kept first, so exact-match behaviour is preserved.
 *
 * INVARIANT — strict super-set of {@link tokenize}: for any text with NO internal
 * uppercase boundary (plain prose, snake_case, all-lowercase, digits) this returns
 * EXACTLY what `tokenize` returns. Extra sub-tokens appear ONLY for camel/Pascal
 * identifiers. This is the ONE shared identifier tokenizer for the recall
 * file-BM25 + FTS query paths (used on BOTH query and document side so the two
 * agree); it deliberately does NOT replace `tokenize` on the guild-memory MCP
 * search path (kept byte-stable by bm25-parity.test.ts).
 */
export function tokenizeIdentifierAware(s: string): string[] {
  const out: string[] = [];
  const runs = s.match(TOKEN_RE);
  if (!runs) return out;
  for (const run of runs) {
    const lowerFull = run.toLowerCase();
    if (lowerFull.length > 1) out.push(lowerFull);
    const parts = splitCamel(run);
    if (parts.length > 1) {
      for (const p of parts) {
        const lp = p.toLowerCase();
        if (lp.length > 1) out.push(lp);
      }
    }
  }
  return out;
}

/**
 * Classic BM25 (k1=1.5, b=0.75) scoring.
 * Returns one score per doc in the same order as `docs`.
 * IDF floor: `log(1 + (N - n + 0.5) / (n + 0.5))` — same as guild-memory.
 */
export function bm25Score(
  queryTokens: string[],
  docs: { tokens: string[] }[],
): number[] {
  const k1 = 1.5;
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
