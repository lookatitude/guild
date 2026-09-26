/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/review/. This file republishes the exact
 * pre-fold public surface of src/modules/review so existing importers keep working;
 * T16 deletes it. New code imports src/domains/review directly.
 */

export {
  ADVISORY_BACKENDS,
  ADVISORY_CONFIDENCE,
  ADVISORY_PHASES,
  ADVISORY_RECORD_SCHEMA,
  ADVISORY_SUBSTRATES,
  DEFAULT_ADVISORY_SUBSTRATE,
  MODULE_PUBLIC_API_VERSION,
  REVIEW_PROGRESS_SCHEMA,
  REVIEW_PROGRESS_STATES,
  appendAdvisoryRecord,
  isReviewProgressState,
  makeAdvisoryRecord,
  makePolicySkipProgress,
  makeReviewProgressEvent,
  planReviewPairing,
  progressForOutcome,
  progressScenariosForPair,
  validateAdvisoryRecord,
  validateReviewProgressEvent,
} from "../../domains/review";
export type {
  AdvisorEntry,
  AdvisorRecommendation,
  AdvisoryBackend,
  AdvisoryConfidence,
  AdvisoryPhase,
  AdvisoryRecord,
  AdvisorySubstrate,
  AppendFsSeam,
  AppendResult,
  PlanReviewPairingInput,
  ReviewIdentityTrust,
  ReviewIndependence,
  ReviewLifecycleOutcome,
  ReviewPairingPlan,
  ReviewPairingStatus,
  ReviewProgressContext,
  ReviewProgressEvent,
  ReviewProgressInput,
  ReviewProgressState,
  ReviewServedEvidence,
  ValidationResult,
} from "../../domains/review";
