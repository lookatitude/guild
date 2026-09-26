/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/lifecycle/. This file republishes the exact
 * pre-fold public surface of src/modules/loops so existing importers keep working;
 * T16 deletes it. New code imports src/domains/lifecycle directly.
 */

export {
  ESCALATION_OUTCOMES,
  FINDING_SEVERITIES,
  OWNER_ARCHITECT_CAP_MAX,
  OWNER_ARCHITECT_CAP_MIN,
  OWNER_ARCHITECT_DEFAULT_CAP,
  OWNER_ARCHITECT_LAYER,
  OWNER_ARCHITECT_SENTINEL,
  checkMalformedStreak,
  checkRestartCap,
  checkRoundCap,
  dismissalTerminates,
  forcePassAssumptions,
  makeRoundState,
  runOwnerArchitectLoopCli,
  shouldRestart,
  terminationReached,
  validateEscalationOutcome,
  validateFinding,
  validateRoundState,
} from "../../domains/lifecycle";
export type {
  ArchitectFinding,
  CapCheckResult,
  EscalationOutcome,
  FindingSeverity,
  ForcePassAssumptionsRecord,
  MalformedGuardResult,
  MalformedStreakState,
  NoRestartSignal,
  OwnerArchitectRoundState,
  RestartDecision,
  RestartSignal,
  TerminationResult,
  ValidateResult,
} from "../../domains/lifecycle";
