/**
 * src/runtime/mcp/guild-memory/bm25.ts
 *
 * Thin RE-EXPORT of the canonical, single-source BM25 utility (re-arch WAVE 1).
 * The implementation lives in src/domains/knowledge/bm25.ts — this file only
 * preserves the historical import path (./bm25) for index.ts and external
 * callers (tests, ingest-similarity parity assertions). No logic here.
 */

export { TOKEN_RE, tokenize, bm25Score } from "../../../domains/knowledge/index";
