/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/evals so the reorganization can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/evals/workflows/define-schema";
