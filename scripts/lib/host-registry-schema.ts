/**
 * Backward-compatible public entrypoint.
 *
 * Host registry schema rows live in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/domains/config/host-registry-schema";
