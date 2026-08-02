/**
 * Backward-compatible public entrypoint.
 *
 * `guild.resolver_mode_outcome.v1` — the five resolver operating modes (D4) —
 * lives in src/modules/capability so the reorg can move internals without
 * breaking existing imports from scripts/lib/capability/*.
 */

export * from "../../../src/modules/capability/workflows/resolver-mode";
