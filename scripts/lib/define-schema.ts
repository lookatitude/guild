/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/evals so the reorganization can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateDefineV1,
  isDefineV1,
  acceptanceCriterionIds,
  runDefineSelfCheck as runSelfCheck,
  DEFINE_SCHEMA_VERSION,
  type DefineValidationResult as ValidationResult,
  type AcceptanceCriterion,
  type DefineV1,
  DEFINE_V1_EXAMPLE,
} from "../../src/domains/evolve/index";
