/**
 * Backward-compatible public entrypoint.
 *
 * Review progress lives in src/modules/review so the reorg can move internals
 * without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/review/workflows/review-progress";
