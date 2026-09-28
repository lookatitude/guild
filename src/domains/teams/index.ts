/**
 * teams — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/teams/ may reach a sibling module directly.
 *
 * Folded here (KTD36): teams, specialists, templates.
 */


// ── from src/modules/teams ──────────────────────────────────────────
export * from "./team-file";
// T8R F2: the canonical-YAML hasher is the shared artifact-integrity primitive
// (self-referential proposal/decision hashes, resolution receipts, shadow
// provenance). It is published here so capability/dispatch consume it through
// the public module entrypoint instead of a private cross-module import.
export * from "./canonical-hash";
export * from "./station-composer";
export * from "./station-signals";
// U-TIER (T08): the two goal nouns and the per-goal roster slice. Exported here
// because the orchestrator lint and the slice are consumed across domains
// (dispatch, lifecycle) and the index is the only cross-domain import surface.
export * from "./goal-contract";
export * from "./compose-scope";
// T13 rework-r3: the one `.guild/agents` creation seam and the minted-profile slice.
export * from "./profile-create";

// ── from src/modules/specialists ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./specialist-roster";
export * from "./roster-contract";

// ── from src/modules/templates ──────────────────────────────────────────
export * from "./template-schema";

// ── consumed outside the domain (T16: every importer goes through this index) ──
export {
  assertDispatchApproved,
  resolveApprovalOverride,
} from "./dispatch-approval";
export {
  buildProposalReview,
  DECISION_VOCABULARY,
  kindCoverage,
  type LoadedDecision,
  loadPersistedDecisions,
  parseDecisionVerb,
  planRestructure,
  preDispatchGate,
  renderProposalReview,
  renderRestructurePlan,
  scanCapReintroduction,
  teamPlanDir,
} from "./team-decision-surface";
export {
  recordDecision,
  type TeamDecisionV1,
  writeDecision,
} from "./team-decision";
export {
  composeProposal,
  type TeamProposalV2,
  writeProposal,
} from "./team-proposal";
export {
  type TeamScheduleV1,
} from "./team-schedule";
