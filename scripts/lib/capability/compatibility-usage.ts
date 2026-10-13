/**
 * Backward-compatible public entrypoint.
 *
 * `guild.compatibility_usage.v1` lives in src/modules/capability so the reorg can
 * move internals without breaking existing imports from scripts/lib/capability/*.
 */

export {
  parseCompatibilityUsageV1,
  isCompatibilityUsageV1,
  isDependenceRead,
  rollupCompatibilityUsage,
  evaluateG5,
  COMPATIBILITY_USAGE_SCHEMA,
  COMPATIBILITY_USAGE_EVENT_NAME,
  COMPATIBILITY_USAGE_OUTCOME_TYPE,
  COMPATIBILITY_USAGE_DISPOSITION,
  COMPATIBILITY_ASSET_KINDS,
  type CompatibilityAssetKind,
  COMPATIBILITY_READ_REASONS,
  type CompatibilityReadReason,
  BENIGN_COMPATIBILITY_READ_REASONS,
  DEPENDENCE_COMPATIBILITY_READ_REASONS,
  type CompatibilityUsageV1,
  type CompatibilityUsageRollup,
  type CompatibilityUsageRollupInput,
  G5_MIN_CLEAN_RELEASES,
  type G5Verdict,
  type G5Input,
} from "../../../src/domains/config/index";
