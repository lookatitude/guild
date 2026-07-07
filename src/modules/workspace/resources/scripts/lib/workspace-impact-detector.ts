/**
 * Backward-compatible public entrypoint.
 *
 * Workspace impact detection lives in src/modules/workspace so the reorg can
 * move internals without breaking existing imports from scripts/lib.
 */

export * from "../../src/modules/workspace/workflows/workspace-impact-detector";
