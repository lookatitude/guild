/**
 * Backward-compatible public entrypoint.
 *
 * Capability tier defaults live in src/modules/capability so the reorg can move
 * internals without breaking existing imports from scripts/lib/capability/*.
 */
export type { HostTierMap } from "../../../src/domains/config/tier-defaults";
export {
  CLAUDE_TIER_FALLBACK,
  tierDefaults,
  tierDefaultsForHost,
  defaultTierModels,
  defaultTiersMap,
} from "../../../src/domains/config/tier-defaults";
