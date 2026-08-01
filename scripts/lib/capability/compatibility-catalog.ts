/**
 * Backward-compatible public entrypoint.
 *
 * `guild.compatibility_catalog.v1` — the read-only catalog over the 15 shipped
 * templates and 58 domain skills (D7) — lives in src/modules/capability so the
 * reorg can move internals without breaking existing imports from
 * scripts/lib/capability/*.
 */

export * from "../../../src/modules/capability/workflows/compatibility-catalog";
