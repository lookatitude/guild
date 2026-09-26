/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/distribution so the reorganization can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/domains/distribution/module-resources";
