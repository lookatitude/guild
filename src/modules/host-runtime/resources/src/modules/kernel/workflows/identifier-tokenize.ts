/**
 * src/modules/kernel/workflows/identifier-tokenize.ts
 *
 * Generic identifier-aware tokenizer PRIMITIVE (base layer). This is lower-level
 * than BM25 scoring: it is the camel/snake-aware tokenizer shared by callers at
 * different layers — knowledge's file-BM25 (knowledge/workflows/bm25) AND state's
 * FTS projection (state/workflows/index-cache, the kg_symbols_fts build). It lives
 * in `kernel` (the dependency base, depends_on nothing) so BOTH can import ONE
 * implementation downward, without `state` taking an upward dependency on the
 * higher `knowledge` module. bm25.ts re-exports `TOKEN_RE` and
 * `tokenizeIdentifierAware` so every existing consumer import path is unchanged.
 *
 * Pure: no I/O, no module deps. Safe to import from any context (tests too).
 */

/** Alphanumeric run boundary — the tokenization unit shared with BM25's `tokenize`. */
export const TOKEN_RE = /[A-Za-z0-9]+/g;

/**
 * Split ONE alphanumeric run into camelCase / PascalCase / acronym sub-words.
 * Digits stay attached to the preceding letters (so `v2`/`bm25` are NOT split),
 * which keeps this a strict super-set of `tokenize` for all-lowercase/digit text.
 *   processOrder   → [process, Order]
 *   ProcessOrder   → [Process, Order]
 *   HTTPRequest    → [HTTP, Request]
 *   bm25           → [bm25]           (no internal uppercase → unchanged)
 */
export function splitCamel(run: string): string[] {
  return run
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // fooBar / v2Bar → foo Bar / v2 Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // HTTPRequest → HTTP Request
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Identifier-aware tokenizer (G7): like BM25's `tokenize`, but ALSO emits the
 * camelCase/PascalCase sub-words of each run, so `process_order` (→ process,
 * order) matches `processOrder` (→ processorder, process, order). The full
 * lowercased run is always kept first, so exact-match behaviour is preserved.
 *
 * INVARIANT — strict super-set of BM25's `tokenize`: for any text with NO internal
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
