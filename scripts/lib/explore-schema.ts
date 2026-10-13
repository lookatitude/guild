/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/evals so the reorganization can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateExploreV1,
  isExploreV1,
  runExploreSelfCheck as runSelfCheck,
  EXPLORE_SCHEMA_VERSION,
  type ExploreValidationResult as ValidationResult,
  type ExploreV1,
  EXPLORE_V1_EXAMPLE,
} from "../../src/domains/evolve/index";
