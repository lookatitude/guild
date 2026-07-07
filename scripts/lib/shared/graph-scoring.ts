/**
 * Backward-compatible public entrypoint.
 *
 * The KnowledgeGraph scoring implementation lives in src/modules/knowledge so
 * the reorg can move internals without breaking imports from scripts/lib/shared/*.
 */

export * from "../../../src/modules/knowledge/workflows/graph-scoring";
