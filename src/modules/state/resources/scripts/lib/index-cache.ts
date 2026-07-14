/**
 * Backward-compatible public entrypoint.
 *
 * SQLite index cache internals live in src/modules/state so the reorg can move
 * implementation without breaking imports from scripts/lib/index-cache.
 */

export {
  DEFAULT_INDEX_BLOCK,
  resolveMainRepoRoot,
  ensureKgIndex,
  ensureKgProjectionIndex,
  ensureWikiFtsIndex,
} from "../../src/modules/state/workflows/index-cache";
export type {
  IndexBlock,
  CacheStatus,
  CacheResult,
} from "../../src/modules/state/workflows/index-cache";
