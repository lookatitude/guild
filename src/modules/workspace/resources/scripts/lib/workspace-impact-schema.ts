/**
 * Backward-compatible public entrypoint.
 *
 * Workspace impact schema lives in src/modules/workspace so the reorg can move
 * internals without breaking existing imports from scripts/lib.
 */

export * from "../../src/modules/workspace/workflows/workspace-impact-schema";
