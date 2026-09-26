/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/lifecycle/. This file republishes the exact
 * pre-fold public surface of src/modules/operations so existing importers keep working;
 * T16 deletes it. New code imports src/domains/lifecycle directly.
 */

export {
  OPERATIONS_ROUTER_SKILL_ID,
  OPERATIONS_RUNBOOK_SKILLS,
  isOperationsSkillId,
  listOperationsRunbooks,
  listOperationsSkillIds,
} from "../../domains/lifecycle";
export type {
  OperationsRunbook,
  OperationsSkillId,
} from "../../domains/lifecycle";
