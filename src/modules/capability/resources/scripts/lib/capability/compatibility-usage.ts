/**
 * Backward-compatible public entrypoint.
 *
 * `guild.compatibility_usage.v1` lives in src/modules/capability so the reorg can
 * move internals without breaking existing imports from scripts/lib/capability/*.
 */

export * from "../../../src/modules/capability/workflows/compatibility-usage";
