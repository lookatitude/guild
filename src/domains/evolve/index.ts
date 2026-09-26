/**
 * evolve — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/evolve/ may reach a sibling module directly.
 *
 * Folded here (KTD36): evals, evolution.
 */


// ── from src/modules/evals ──────────────────────────────────────────
export {
  DEFINE_SCHEMA_VERSION,
  DEFINE_V1_EXAMPLE,
  acceptanceCriterionIds,
  isDefineV1,
  validateDefineV1,
  type AcceptanceCriterion,
  type DefineV1,
  type ValidationResult as DefineValidationResult,
} from "./define-schema";
export {
  EXPLORE_SCHEMA_VERSION,
  EXPLORE_V1_EXAMPLE,
  isExploreV1,
  runSelfCheck as runExploreSelfCheck,
  validateExploreV1,
  type ExploreV1,
  type ValidationResult as ExploreValidationResult,
} from "./explore-schema";
export {
  GOAL_SCHEMA_VERSION,
  GOAL_V1_EXAMPLE,
  TASK_GROUP_SCHEMA_VERSION,
  TASK_GROUP_V1_EXAMPLE,
  isGoalV1,
  isTaskGroupV1,
  selectGoalSurface,
  validateGoalV1,
  validateTaskGroupV1,
  type GoalSurface,
  type PoverGoalV1,
  type TaskGroupTask,
  type TaskGroupV1,
  type ValidationResult as GoalTaskValidationResult,
} from "./goal-task-schema";
export * from "./task-cell-policy-eval";

// ── from src/modules/evolution ──────────────────────────────────────────
// U-RSI (T11): one evolve gate, two homes.
export * from "./evolve-targets";
export * from "./evolve-delta";
export * from "./compact-history";
export * from "./evolve-apply";
export * from "./learning-candidate";
export * from "./learning-signatures";
