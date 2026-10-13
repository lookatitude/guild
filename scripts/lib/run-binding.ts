/**
 * Backward-compatible public entrypoint.
 *
 * Run-binding core (guild.session_context.v1 §5) lives in
 * src/modules/lifecycle so the reorg can move internals without breaking
 * imports from scripts/lib/*.
 */
export {
  runBindingPath,
  pendingSubstantiveOperationPath,
  readPendingSubstantiveOperation,
  stagePendingSubstantiveOperation,
  completePendingSubstantiveOperation,
  assertNoPendingSubstantiveOperation,
  withRunBindingExclusion,
  initializeRunBindingExclusion,
  mintRunBinding,
  validateRunBindingRecord,
  readRunBindingRecord,
  loadRunBinding,
  closeRunBinding,
  reopenRunBinding,
  verifyRunBinding,
  assertWritableBinding,
  locateCandidateRunId,
  readHookBindingEnvelope,
  type RunBindingRecord,
  type BindingRejectReason,
  type BindingVerdict,
  BindingRejectedError,
  type BindingFs,
  PENDING_SUBSTANTIVE_OPERATION_SCHEMA,
  type PendingSubstantiveOperationRecord,
  type RunBindingLocator,
  type RunBindingReadResult,
  type VerifyRunBindingInput,
  type IntakeCandidate,
  HOOK_BINDING_ENV_RUN_ID,
  HOOK_BINDING_ENV_BINDING_REF,
  type HookBindingEnvelope,
} from "../../src/domains/lifecycle/index";
