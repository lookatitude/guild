/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/config so the reorganization can move
 * internals without breaking existing imports from scripts/lib/core/*.
 */

export * from "../../../src/domains/config/settings-reader";
