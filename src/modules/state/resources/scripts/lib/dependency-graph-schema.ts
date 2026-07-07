/**
 * Backward-compatible public entrypoint.
 *
 * Dependency graph schema lives in src/modules/state so the reorg can move
 * internals without breaking existing imports from scripts/lib.
 */

export * from "../../src/modules/state/workflows/dependency-graph-schema";
