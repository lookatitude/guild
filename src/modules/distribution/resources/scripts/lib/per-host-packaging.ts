/**
 * Backward-compatible public entrypoint.
 *
 * Per-host packaging renderers live in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/distribution/workflows/per-host-packaging";
