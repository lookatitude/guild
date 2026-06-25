/**
 * Backward-compatible public entrypoint.
 *
 * The result-contract registry lives in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/distribution/workflows/result-contracts";
