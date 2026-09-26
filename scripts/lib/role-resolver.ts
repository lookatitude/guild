/**
 * Backward-compatible public entrypoint.
 *
 * Role resolver implementation lives in src/modules/capability so the reorg can
 * move internals without breaking existing imports from scripts/lib.
 */

export * from "../../src/domains/config/role-resolver";
