/**
 * Backward-compatible public entrypoint.
 *
 * The shareable-run validation rail lives in src/modules/lifecycle so the
 * module layer owns it; this shim keeps the stable scripts/lib import path.
 */

export {
  isCanonicalLaneReceipt,
  validateRunRecordDir,
  scanRunsRoot,
  RUN_RECORD_VALIDATION_SCHEMA,
  RUN_RECORD_FINDING_CODES,
  type RunRecordFindingCode,
  type RunRecordFinding,
  type RunRecordValidation,
} from "../../src/domains/lifecycle/index";
