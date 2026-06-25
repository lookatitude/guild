/**
 * Backward-compatible public entrypoint.
 *
 * Initiative work items live in src/modules/initiatives so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/initiatives/workflows/initiative-workitems";
