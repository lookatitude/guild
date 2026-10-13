/**
 * Backward-compatible public entrypoint.
 *
 * Review progress lives in src/modules/review so the reorg can move internals
 * without breaking existing imports from scripts/lib/*.
 */
export {
  isReviewProgressState,
  makeReviewProgressEvent,
  validateReviewProgressEvent,
  makePolicySkipProgress,
  REVIEW_PROGRESS_SCHEMA,
  REVIEW_PROGRESS_STATES,
  type ReviewProgressState,
  type ReviewIndependence,
  type ReviewProgressEvent,
  type ReviewProgressInput,
  type ValidationResult,
  type ReviewProgressContext,
} from "../../src/domains/review/index";
