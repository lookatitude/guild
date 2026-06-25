/**
 * Backward-compatible public entrypoint.
 *
 * Initiative activity lives in src/modules/initiatives so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/initiatives/workflows/initiative-activity";
