/**
 * mcp-servers/guild-memory/src/bm25.ts
 *
 * Thin RE-EXPORT of the canonical, single-source BM25 utility (re-arch WAVE 1).
 * The implementation lives in scripts/lib/shared/bm25.ts — this file only
 * preserves the historical import path (./bm25) for index.ts and external
 * callers (tests, ingest-similarity parity assertions). No logic here.
 *
 * esbuild --bundle (the guild-memory build) inlines the shared module, so the
 * shipped dist/index.js remains self-contained.
 */

export { TOKEN_RE, tokenize, bm25Score } from "../../../scripts/lib/shared/bm25";
