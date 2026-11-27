/**
 * The E00 public facade, pinned by name (CD14; R52 KTD36 bijection).
 *
 * The E00 TA tests resolve these through requireExport(), a dynamic lookup the
 * coverage bijection's static consumer scan does not see, so the names read as
 * orphans. This file is their static consumer: removing a name from its index
 * breaks the build here, and adding a facade name means adding it here.
 */
import { describe, it, expect } from "bun:test";
import {
  COOPERATIVE_LOCAL_PROVIDER as dispatch_COOPERATIVE_LOCAL_PROVIDER,
  ControllerRefusal as dispatch_ControllerRefusal,
  EXECUTABLE_COMMAND_TIMEOUT_MAX_MS as dispatch_EXECUTABLE_COMMAND_TIMEOUT_MAX_MS,
  EXECUTABLE_ORACLE_KINDS as dispatch_EXECUTABLE_ORACLE_KINDS,
  SpawnOutcomeUnknownError as dispatch_SpawnOutcomeUnknownError,
  TASK_CELL_CONTROLLER_STATUS_VIEW as dispatch_TASK_CELL_CONTROLLER_STATUS_VIEW,
  WORKER_TRUST_POLICIES as dispatch_WORKER_TRUST_POLICIES,
  canonicalOracleJson as dispatch_canonicalOracleJson,
  classifyPersistedAcceptance as dispatch_classifyPersistedAcceptance,
  classifyPersistedTerminal as dispatch_classifyPersistedTerminal,
  classifyPersistedValidation as dispatch_classifyPersistedValidation,
  decodeExecutableTarget as dispatch_decodeExecutableTarget,
  deriveReviewerCellAuthority as dispatch_deriveReviewerCellAuthority,
  isWorkerTrustPolicy as dispatch_isWorkerTrustPolicy,
  locateAssignment as dispatch_locateAssignment,
  publishPersistedLifecycleRecord as dispatch_publishPersistedLifecycleRecord,
  readApprovedOraclePlan as dispatch_readApprovedOraclePlan,
  readRootIdentity as dispatch_readRootIdentity,
  reviewPacketId as dispatch_reviewPacketId,
  selectPrincipalProvider as dispatch_selectPrincipalProvider,
  verifyPrereleaseBusJoins as dispatch_verifyPrereleaseBusJoins,
} from "../../src/domains/dispatch";
import type {
  AcceptanceRecordOracleTarget,
  ArtifactExistsOracleTarget,
  CommandOracleTarget,
  DecodeExecutableTargetResult,
  ExecutableDoneWhenCheck,
  ExecutableDoneWhenContext,
  ExecutableOracleKind,
  ExecutableTargetValue,
  ExpectedPaneIdentity,
  IntendedAcceptance,
  IntendedTerminal,
  PaneIdentityPort,
  PersistedLifecycleKind,
  PersistedPublication,
  PersistedRecordClass,
  PrereleaseBusJoin,
  PrincipalProvider,
  PrincipalSelection,
  QualificationVerdict,
  ReconcilePersistedResult,
  ReleaseConsumerContext,
  ReviewerAuthority,
  RuntimeReconciliation,
  WorkerTrustPolicy,
} from "../../src/domains/dispatch";
import {
  INVOCATION_ADAPTER_JOIN_FIELDS as distribution_INVOCATION_ADAPTER_JOIN_FIELDS,
  REVIEW_INVOCATION_SCHEMA as distribution_REVIEW_INVOCATION_SCHEMA,
} from "../../src/domains/distribution";
import type {
  FileRefV1,
  ReviewFindingV1,
  ReviewInvocationV1,
  ReviewResultV1,
} from "../../src/domains/distribution";
import {
  assertManagedBudgetAdmission as lifecycle_assertManagedBudgetAdmission,
  markManagedAttemptUncertain as lifecycle_markManagedAttemptUncertain,
  updateRunAttachment as lifecycle_updateRunAttachment,
} from "../../src/domains/lifecycle";
import type {
  BuiltD8Input,
  LoadedManifest,
  ManagedAttemptClaim,
  ManagedAttemptInput,
  ManagedRunOutcome,
  ManagedUsageObservation,
  ManagedWorkerAcceptance,
  ManagedWorkerRequest,
  StackFacadeOptions,
} from "../../src/domains/lifecycle";
import {
  MANAGED_CLAUDE_PROFILE as adapters_MANAGED_CLAUDE_PROFILE,
  buildManagedClaudeLaunch as adapters_buildManagedClaudeLaunch,
  createManagedClaudeParser as adapters_createManagedClaudeParser,
  inspectManagedWorker as adapters_inspectManagedWorker,
} from "../../src/adapters";

describe("E00 public facade surface", () => {
  it("dispatch: the E00 public values are exported from the index", () => {
    for (const v of [dispatch_COOPERATIVE_LOCAL_PROVIDER, dispatch_ControllerRefusal, dispatch_EXECUTABLE_COMMAND_TIMEOUT_MAX_MS, dispatch_EXECUTABLE_ORACLE_KINDS, dispatch_SpawnOutcomeUnknownError, dispatch_TASK_CELL_CONTROLLER_STATUS_VIEW, dispatch_WORKER_TRUST_POLICIES, dispatch_canonicalOracleJson, dispatch_classifyPersistedAcceptance, dispatch_classifyPersistedTerminal, dispatch_classifyPersistedValidation, dispatch_decodeExecutableTarget, dispatch_deriveReviewerCellAuthority, dispatch_isWorkerTrustPolicy, dispatch_locateAssignment, dispatch_publishPersistedLifecycleRecord, dispatch_readApprovedOraclePlan, dispatch_readRootIdentity, dispatch_reviewPacketId, dispatch_selectPrincipalProvider, dispatch_verifyPrereleaseBusJoins]) expect(v).toBeDefined();
  });
  it("dispatch: the E00 public types are exported from the index (compile-time)", () => {
    const names: Array<AcceptanceRecordOracleTarget | undefined | ArtifactExistsOracleTarget | undefined | CommandOracleTarget | undefined | DecodeExecutableTargetResult | undefined | ExecutableDoneWhenCheck | undefined | ExecutableDoneWhenContext | undefined | ExecutableOracleKind | undefined | ExecutableTargetValue | undefined | ExpectedPaneIdentity | undefined | IntendedAcceptance | undefined | IntendedTerminal | undefined | PaneIdentityPort | undefined | PersistedLifecycleKind | undefined | PersistedPublication | undefined | PersistedRecordClass | undefined | PrereleaseBusJoin | undefined | PrincipalProvider | undefined | PrincipalSelection | undefined | QualificationVerdict | undefined | ReconcilePersistedResult | undefined | ReleaseConsumerContext | undefined | ReviewerAuthority | undefined | RuntimeReconciliation | undefined | WorkerTrustPolicy | undefined> = [];
    expect(names).toEqual([]);
  });
  it("distribution: the E00 public values are exported from the index", () => {
    for (const v of [distribution_INVOCATION_ADAPTER_JOIN_FIELDS, distribution_REVIEW_INVOCATION_SCHEMA]) expect(v).toBeDefined();
  });
  it("distribution: the E00 public types are exported from the index (compile-time)", () => {
    const names: Array<FileRefV1 | undefined | ReviewFindingV1 | undefined | ReviewInvocationV1 | undefined | ReviewResultV1 | undefined> = [];
    expect(names).toEqual([]);
  });
  it("lifecycle: the E00 public values are exported from the index", () => {
    for (const v of [lifecycle_assertManagedBudgetAdmission, lifecycle_markManagedAttemptUncertain, lifecycle_updateRunAttachment]) expect(v).toBeDefined();
  });
  it("lifecycle: the E00 public types are exported from the index (compile-time)", () => {
    const names: Array<BuiltD8Input | undefined | LoadedManifest | undefined | ManagedAttemptClaim | undefined | ManagedAttemptInput | undefined | ManagedRunOutcome | undefined | ManagedUsageObservation | undefined | ManagedWorkerAcceptance | undefined | ManagedWorkerRequest | undefined | StackFacadeOptions | undefined> = [];
    expect(names).toEqual([]);
  });
  it("adapters: the E00 public values are exported from the index", () => {
    for (const v of [adapters_MANAGED_CLAUDE_PROFILE, adapters_buildManagedClaudeLaunch, adapters_createManagedClaudeParser, adapters_inspectManagedWorker]) expect(v).toBeDefined();
  });
});
