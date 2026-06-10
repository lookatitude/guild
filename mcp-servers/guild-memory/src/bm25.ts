/**
 * mcp-servers/guild-memory/src/bm25.ts
 *
 * Pure BM25 utility — extracted from index.ts so external callers (tests,
 * ingest-similarity parity assertions) can import without starting the MCP
 * server. No MCP / I/O dependencies; safe to require from any context.
 *
 * Parameters: k1=1.5, b=0.75 — identical to the guild-memory search path.
 * Changing these constants is a breaking change; bump both here and in any
 * consumer that cites parity (scripts/lib/ingest-similarity.ts).
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
