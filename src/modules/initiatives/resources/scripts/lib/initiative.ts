/**
 * Backward-compatible public entrypoint.
 *
 * Initiative contracts live in src/modules/initiatives so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/initiatives/workflows/initiative";
