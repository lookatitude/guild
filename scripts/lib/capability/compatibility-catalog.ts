/**
 * Backward-compatible public entrypoint.
 *
 * `guild.compatibility_catalog.v1` — the read-only catalog over the 15 shipped
 * templates and 58 domain skills (D7) — lives in src/modules/capability so the
 * reorg can move internals without breaking existing imports from
 * scripts/lib/capability/*.
 */

export {
  buildCompatibilityCatalog,
  readCatalogEntry,
  suggestableAssets,
  compatibilityUsageForRead,
  requiredAssetIdsForG5,
  COMPATIBILITY_CATALOG_SCHEMA,
  SHIPPED_TEMPLATE_COUNT,
  SHIPPED_DOMAIN_SKILL_IDS,
  SHIPPED_DOMAIN_SKILL_COUNT,
  SHIPPED_COMPATIBILITY_ASSET_COUNT,
  COMPATIBILITY_ASSET_ROOTS,
  COMPATIBILITY_DEPRECATION_STATES,
  type CompatibilityDeprecationState,
  type CompatibilityCatalogEntry,
  type CompatibilityCatalog,
  type SuggestableAssets,
  type CompatibilityUsageEmission,
} from "../../../src/domains/config/index";
