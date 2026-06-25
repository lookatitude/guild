/**
 * Backward-compatible public entrypoint.
 *
 * The template implementation lives in src/modules/templates so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export * from "../../src/modules/templates/workflows/template-schema";
