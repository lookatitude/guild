/**
 * Backward-compatible public entrypoint.
 *
 * Runtime adapter resolution lives in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/host-runtime/workflows/runtime-adapters";
