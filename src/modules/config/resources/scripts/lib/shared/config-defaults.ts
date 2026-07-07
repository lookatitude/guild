/**
 * Backward-compatible public entrypoint.
 *
 * Guild settings defaults live in src/modules/config so the reorg can move
 * internals without breaking existing imports from scripts/lib/shared/*.
 */

export * from "../../../src/modules/config/workflows/config-defaults";
