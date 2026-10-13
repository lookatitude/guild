/**
 * Backward-compatible public entrypoint.
 *
 * The full-tree equivalence contract lives in src/modules/distribution so the
 * reorg can move internals without breaking existing imports from scripts/lib/*.
 */

export {
  normalizeJson,
  normalizeText,
  jsonEquivalent,
  textEquivalent,
  checkClaudeEquivalence,
  type LogicalPackage,
  EQUIVALENCE_SURFACES,
  type IntentionalExclusion,
  INTENTIONAL_EXCLUSIONS,
  PROVENANCE_FIELDS,
  SORTED_MANIFEST_ARRAYS,
  type EquivalenceResult,
  type ExpectedSurfaces,
} from "../../src/domains/distribution/index";
