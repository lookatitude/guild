/**
 * Backward-compatible public entrypoint.
 *
 * The `guild.advisory.v1` record is review-domain code (T12 fold, KTD36).
 */

export {
  makeAdvisoryRecord,
  validateAdvisoryRecord,
  appendAdvisoryRecord,
  ADVISORY_RECORD_SCHEMA,
  ADVISORY_BACKENDS,
  type AdvisoryBackend,
  ADVISORY_SUBSTRATES,
  type AdvisorySubstrate,
  DEFAULT_ADVISORY_SUBSTRATE,
  ADVISORY_CONFIDENCE,
  type AdvisoryConfidence,
  ADVISORY_PHASES,
  type AdvisoryPhase,
  type AdvisorEntry,
  type AdvisorRecommendation,
  type AdvisoryRecord,
  type AppendResult,
  type AppendFsSeam,
} from "../../src/domains/review/index";
