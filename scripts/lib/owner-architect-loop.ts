#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public entrypoint.
 *
 * Owner/architect loop control lives in src/modules/loops so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
import { runOwnerArchitectLoopCli } from "../../src/domains/lifecycle/index";

export {
  makeRoundState,
  shouldRestart,
  terminationReached,
  checkRoundCap,
  checkRestartCap,
  checkMalformedStreak,
  dismissalTerminates,
  forcePassAssumptions,
  validateRoundState,
  validateFinding,
  validateEscalationOutcome,
  runOwnerArchitectLoopCli,
  OWNER_ARCHITECT_SENTINEL,
  OWNER_ARCHITECT_LAYER,
  OWNER_ARCHITECT_DEFAULT_CAP,
  OWNER_ARCHITECT_CAP_MIN,
  OWNER_ARCHITECT_CAP_MAX,
  FINDING_SEVERITIES,
  type FindingSeverity,
  ESCALATION_OUTCOMES,
  type EscalationOutcome,
  type OwnerArchitectRoundState,
  type ArchitectFinding,
  type RestartSignal,
  type NoRestartSignal,
  type RestartDecision,
  type TerminationResult,
  type CapCheckResult,
  type MalformedStreakState,
  type MalformedGuardResult,
  type ValidateResult,
  type ForcePassAssumptionsRecord,
} from "../../src/domains/lifecycle/index";

if (require.main === module) runOwnerArchitectLoopCli();
