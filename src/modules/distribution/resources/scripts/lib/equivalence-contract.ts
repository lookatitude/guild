/**
 * Backward-compatible public entrypoint.
 *
 * The full-tree equivalence contract lives in src/modules/distribution so the
 * reorg can move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/distribution/workflows/equivalence-contract";
