/**
 * Backward-compatible public entrypoint.
 *
 * Host runtime registry accessors live in src/modules/host-runtime so the reorg
 * can move internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/domains/config/host-registry";
