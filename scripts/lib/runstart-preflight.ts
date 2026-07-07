/**
 * Backward-compatible public entrypoint.
 *
 * Run-start preflight lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing imports from scripts/lib/runstart-preflight.
 */

export * from "../../src/modules/lifecycle/workflows/runstart-preflight";
