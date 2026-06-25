/**
 * Backward-compatible public entrypoint.
 *
 * The declarative live-surface manifest validator lives in src/modules/distribution
 * so the reorg can move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/distribution/workflows/surface-manifest";
