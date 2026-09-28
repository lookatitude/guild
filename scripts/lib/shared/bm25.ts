/**
 * Backward-compatible public entrypoint.
 *
 * The BM25 implementation lives in src/modules/knowledge so the reorg can move
 * internals without breaking existing imports from scripts/lib/shared/*.
 */

export { TOKEN_RE, bm25Score, tokenize, tokenizeIdentifierAware } from "../../../src/domains/knowledge/index";
