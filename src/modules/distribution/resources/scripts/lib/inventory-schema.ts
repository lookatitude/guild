/**
 * Backward-compatible public entrypoint.
 *
 * The neutral inventory schema lives in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/distribution/workflows/inventory-schema";
