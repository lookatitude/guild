/**
 * Backward-compatible public entrypoint.
 *
 * The BM25 implementation lives in src/modules/knowledge so the reorg can move
 * internals without breaking existing imports from scripts/lib/shared/*.
 */

export * from "../../../src/modules/knowledge/workflows/bm25";
