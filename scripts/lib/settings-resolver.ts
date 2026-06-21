/**
 * scripts/lib/settings-resolver.ts — THIN RE-EXPORT SHIM (W3 god-file split)
 *
 * Public entrypoint preserved for backward compatibility per public-entrypoints.txt.
 * All implementation has moved to:
 *   scripts/lib/core/settings-reader.ts — resolveSettings, deepMerge, rigorProfile,
 *                                          ResolvedConfig, ResolveOptions, etc.
 *
 * Importers of this path continue to resolve unchanged.
 */

export * from "./core/settings-reader";
