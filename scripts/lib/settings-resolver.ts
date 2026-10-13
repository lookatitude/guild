/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/config so the reorganization can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export {
  resolveSettings,
  isPlainObject,
  deepMerge,
  rigorProfile,
  initiativeIsWorkspaceScoped,
  type Source,
  type ResolvedConfig,
  type ResolveOptions,
  type ResolveResult,
  RESOLVER_TIER1_KEYS,
  type RigorProfile,
} from "../../src/domains/config/index";
