/**
 * Backward-compatible public entrypoint.
 *
 * Review pairing lives in src/modules/review so the reorg can move internals
 * without breaking existing imports from scripts/lib/*.
 */
export {
  progressForOutcome,
  progressScenariosForPair,
  planReviewPairing,
  type ReviewPairingStatus,
  type ReviewIdentityTrust,
  type ReviewLifecycleOutcome,
  type ReviewPairingPlan,
  type ReviewServedEvidence,
  type PlanReviewPairingInput,
} from "../../src/domains/review/index";
