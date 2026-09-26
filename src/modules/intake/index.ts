/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/lifecycle/. This file republishes the exact
 * pre-fold public surface of src/modules/intake so existing importers keep working;
 * T16 deletes it. New code imports src/domains/lifecycle directly.
 */

export {
  CLASS_THRESHOLD,
  INTAKE_SMOKE_FIXTURE,
  PRODUCT_LOOP_ENTRY_SKILL,
  THRESHOLD,
  TYPED_VERB_CLASS,
  WORK_CLASSES,
  bindWorkClass,
  classifyIntake,
  classifyWorkClass,
  intakeRouteTarget,
  runClassifyIntakeCli,
  runIntakeSmoke,
} from "../../domains/lifecycle";
export type {
  ClassBindInput,
  ClassBindSource,
  ClassBinding,
  Intake,
  IntakeResult,
  IntakeRoute,
  IntakeSignal,
  SignalCategory,
  SmokeCase,
  WorkClass,
  WorkClassResult,
  WorkClassSignal,
  WorkClassVerdict,
} from "../../domains/lifecycle";
