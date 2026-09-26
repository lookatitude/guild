/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/review/. This file republishes the exact
 * pre-fold public surface of src/modules/quality so existing importers keep working;
 * T16 deletes it. New code imports src/domains/review directly.
 */

export {
  QUALITY_GATE_SKILL_ID,
  isQualitySkillId,
  listQualitySkillIds,
} from "../../domains/review";
export type {
  QualitySkillId,
} from "../../domains/review";
