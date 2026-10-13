/**
 * Backward-compatible public entrypoint.
 *
 * Adapter fallback ladders live in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */
export {
  rungLoss,
  isHostInferred,
  resolveRung,
  validateDegradationReceipt,
  validateLadderTableComplete,
  RUNGS,
  type Rung,
  ADAPTER_SURFACES,
  type AdapterSurface,
  FALLBACK_LADDER_TABLE,
  INFERRED_HOSTS,
  type DegradationReceipt,
  type LadderValidationResult as ValidationResult,
} from "../../src/domains/config/index";
