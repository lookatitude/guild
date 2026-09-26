/**
 * Backward-compatible public entrypoint.
 *
 * The two-sided parity contract lives in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/domains/distribution/parity-contract";
