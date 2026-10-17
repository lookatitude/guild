/**
 * telemetry — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/telemetry/ may reach a sibling module directly.
 *
 * Folded here (KTD36): telemetry.
 */


// ── from src/modules/telemetry ──────────────────────────────────────────
// Keep the receipt boundary first: state/run-analysis can re-enter telemetry
// through dispatch during barrel initialization, and these bindings must
// already exist when that happens.
export * from "./receipt-journal";
export * from "./receipt-reconcile";
export * from "./debug-bundle";
export * from "./receipt-journal-conformance-evaluator";

export * from "./guild-trace-emit";
// Named (not star) re-exports for the two modules whose B03 additions carry
// internal-only analysis machinery: an index export with no outside-domain
// consumer is a coverage-bijection orphan (KTD36) — new names join this list
// only WITH a consumer. In-domain files import the modules directly.
export {
  ANALYSIS_EVENT_CLASSES,
  GUILD_TRACE_SCHEMA_VERSIONS,
  collapseSpanTwins,
  makeAnalysisTraceEvent,
  makeConfigResolutionEvent,
  makeDegradationEvent,
  makeDispatchEvent,
  makeModelInspectionEvent,
  makeRecallDecisionEvent,
  makeRecallEvent,
  makeSecurityDecisionEvent,
  toolActionSignature,
  toolDenialSignature,
  validateAnalysisTraceEvent,
  validateConfigResolutionEvent,
  validateDegradationEvent,
  validateDispatchEvent,
  validateGuildTraceEvent,
  validateModelInspectionEvent,
  validateRecallDecisionEvent,
  validateRecallEvent,
  validateSecurityDecisionEvent,
} from "./guild-trace-events";
export type {
  AnalysisActorType,
  AnalysisEventClass,
  AnalysisEventStatus,
  ConfigResolutionLayers,
  DegradationSurface,
  DispatchBackend,
  GuildTraceAnalysisV2,
  GuildTraceConfigResolutionV1,
  GuildTraceDegradationV1,
  GuildTraceDispatchV1,
  GuildTraceEvent,
  GuildTraceEventBase,
  GuildTraceModelInspectionV1,
  GuildTraceRecallDecisionV1,
  GuildTraceRecallV1,
  GuildTraceSchemaVersion,
  GuildTraceSecurityDecisionV1,
  LaneOutcome,
  RecallBranch,
  SecurityDecisionOutcome,
  ToolDenialCause,
} from "./guild-trace-events";
export * from "./task-cell-telemetry";
export {
  analyzeRun,
  compareRuns,
  decideRecommendation,
  inspectAnalysisArtifact,
  loadOrAnalyzeRun,
  resolveComparisonTarget,
  routeRecommendation,
  updateRecommendationStatus,
  withRecommendationLock,
  writeRunAnalysis,
  writeRunComparison,
} from "./run-analysis";
export type {
  AnalysisFinding,
  AssessmentStatus,
  ComparisonTarget,
  EvidenceCategory,
  ExpectedDecisionContext,
  Recommendation,
  RecommendationDecisionResult,
  RecommendationKind,
  RecommendationRouting,
  RecommendationScope,
  RecommendationStatus,
  RunAnalysis,
  RunComparison,
} from "./run-analysis";

// MHRC-MOD-004: this domain binds host-facing contracts (the lifecycle public
// index), so it states the public-API contract version it was built against.
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;
