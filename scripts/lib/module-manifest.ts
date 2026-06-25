/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/kernel so the reorganization can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/kernel/workflows/module-manifest";
