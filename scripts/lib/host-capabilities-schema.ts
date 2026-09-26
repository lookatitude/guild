/**
 * Backward-compatible public entrypoint.
 *
 * Host capability rows live in src/modules/host-runtime so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/adapters/host-capabilities-schema";
