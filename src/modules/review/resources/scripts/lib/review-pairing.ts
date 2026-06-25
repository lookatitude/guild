/**
 * Backward-compatible public entrypoint.
 *
 * Review pairing lives in src/modules/review so the reorg can move internals
 * without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/review/workflows/review-pairing";
