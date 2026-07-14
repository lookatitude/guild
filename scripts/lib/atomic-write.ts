/**
 * scripts/lib/atomic-write.ts
 *
 * Backward-compatible public entrypoint.
 *
 * The shared atomic-write helper (same-directory temp file + rename, EXDEV-safe)
 * lives in src/modules/state so the reorg can move internals without breaking
 * imports from scripts/lib/atomic-write.
 */

export * from "../../src/modules/state/workflows/atomic-write";
