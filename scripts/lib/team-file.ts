/**
 * Backward-compatible public entrypoint.
 *
 * Team-file parsing and phase-aware team artifact resolution live in
 * src/modules/teams so the reorg can move internals without breaking existing
 * imports from scripts/lib/team-file.
 */

export {
  teamFilePath,
  legacyTeamFilePath,
  slugFromTeamPath,
  phaseFromTeamPath,
  readCurrentPhasePointer,
  writeCurrentPhasePointer,
  readActivePhase,
  resolveTeamFile,
  readPlanOwnerTaskIds,
  readPlanTaskIdSet,
  resolveDeadLaneKeys,
} from "../../src/domains/teams/index";
export { CANONICAL_PHASES, isCanonicalPhase } from "../../src/domains/lifecycle/index";
