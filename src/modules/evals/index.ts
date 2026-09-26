/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/evolve/. This file republishes the exact
 * pre-fold public surface of src/modules/evals so existing importers keep working;
 * T16 deletes it. New code imports src/domains/evolve directly.
 */

export {
  DEFINE_SCHEMA_VERSION,
  DEFINE_V1_EXAMPLE,
  EXPLORE_SCHEMA_VERSION,
  EXPLORE_V1_EXAMPLE,
  GOAL_SCHEMA_VERSION,
  GOAL_V1_EXAMPLE,
  TASK_CELL_POLICY_EVAL_OBSERVATION_SCHEMA,
  TASK_GROUP_SCHEMA_VERSION,
  TASK_GROUP_V1_EXAMPLE,
  acceptanceCriterionIds,
  evaluateTaskCellPolicyPromotion,
  isDefineV1,
  isExploreV1,
  isGoalV1,
  isTaskGroupV1,
  runExploreSelfCheck,
  selectGoalSurface,
  validateDefineV1,
  validateExploreV1,
  validateGoalV1,
  validateTaskGroupV1,
} from "../../domains/evolve";
export type {
  AcceptanceCriterion,
  DefineV1,
  DefineValidationResult,
  ExploreV1,
  ExploreValidationResult,
  GoalSurface,
  GoalTaskValidationResult,
  PoverGoalV1,
  TaskCellPolicyEvalObservationV1,
  TaskCellPolicyPromotionInput,
  TaskCellPolicyPromotionResult,
  TaskCellPolicyPromotionThresholds,
  TaskGroupTask,
  TaskGroupV1,
} from "../../domains/evolve";
