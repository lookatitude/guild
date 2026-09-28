/**
 * Backward-compatible public entrypoint.
 *
 * Run lifecycle implementation lives in src/modules/lifecycle so the reorg can
 * move internals without breaking existing imports from scripts/lib/run-lifecycle.
 */

export {
  capabilityRunStartIdentityHash,
  isCanonicalRunId,
  assertCanonicalRunId,
  makeCanonicalRunId,
  isCanonicalPhase,
  appendPhase,
  createRunLifecycle,
  createRealEnv,
  validateRunId,
  writeResolvedSettingsSnapshot,
  writePluginConfigSnapshot,
  readResolvedSettingsSnapshot,
  readWorkspaceKnowledgeConfig,
  readRecordStatusRuns,
  appendGateOutcome,
  readRunStartedAt,
  type RunLifecycleEnv,
  CAPABILITY_RUN_START_SNAPSHOT_SCHEMA,
  type CapabilityBaselineCaptureEvidence,
  type TargetKind,
  type RunClass,
  type RunScope,
  type AttachmentSource,
  type AttachmentConfidence,
  type RunStatus,
  type TerminalStatus,
  type StartRunOpts,
  type CloseRunOpts,
  type RunLifecycle,
  CANONICAL_PHASES,
  type CanonicalPhase,
  type ProvenanceFsSeam,
  type WriteSnapshotOpts,
  type WorkspaceKnowledgeConfig,
  type GateOutcomeRecord,
} from "../../src/domains/lifecycle/index";
