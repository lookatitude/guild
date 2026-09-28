/**
 * Backward-compatible public entrypoint.
 *
 * The two-sided parity contract lives in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  checkCoverage,
  checkSubset,
  checkParity,
  type DiscoveryRule,
  DISCOVERY_RULES,
  COVERAGE_ENFORCED_CATEGORIES,
  type DiscoveredSurfaces,
  type CoverageCategoryResult,
  type CoverageResult,
  type PackageReferences,
  type SubsetResult,
  type ParityResult,
} from "../../src/domains/distribution/index";
