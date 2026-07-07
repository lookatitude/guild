/**
 * Backward-compatible public entrypoint.
 *
 * Learning signatures live in src/modules/evolution so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/evolution/workflows/learning-signatures";
