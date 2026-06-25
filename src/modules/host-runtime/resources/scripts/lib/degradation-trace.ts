/**
 * Backward-compatible public entrypoint.
 *
 * Degradation trace row builders live in src/modules/host-runtime so the reorg
 * can move internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/host-runtime/workflows/degradation-trace";
