/**
 * Backward-compatible public entrypoint.
 *
 * Run lifecycle implementation lives in src/modules/lifecycle so the reorg can
 * move internals without breaking existing imports from scripts/lib/run-lifecycle.
 */

export * from "../../src/modules/lifecycle/workflows/run-lifecycle";
