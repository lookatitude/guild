/**
 * Backward-compatible public entrypoint.
 *
 * Host capability rows live in src/modules/host-runtime so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/host-runtime/workflows/host-capabilities-schema";
