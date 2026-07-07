/**
 * Backward-compatible public entrypoint.
 *
 * Trace event schemas live in src/modules/telemetry so the reorg can move
 * internals without breaking imports from scripts/lib/guild-trace-events.
 */

import * as traceEventsImpl from "../../src/modules/telemetry/workflows/guild-trace-events";

export const GUILD_TRACE_SCHEMA_VERSIONS = traceEventsImpl.GUILD_TRACE_SCHEMA_VERSIONS;
export const validateDispatchEvent = traceEventsImpl.validateDispatchEvent;
export const validateRecallEvent = traceEventsImpl.validateRecallEvent;
export const validateRecallDecisionEvent = traceEventsImpl.validateRecallDecisionEvent;
export const validateConfigResolutionEvent = traceEventsImpl.validateConfigResolutionEvent;
export const validateSecurityDecisionEvent = traceEventsImpl.validateSecurityDecisionEvent;
export const validateDegradationEvent = traceEventsImpl.validateDegradationEvent;
export const validateGuildTraceEvent = traceEventsImpl.validateGuildTraceEvent;
export const makeDispatchEvent = traceEventsImpl.makeDispatchEvent;
export const makeRecallEvent = traceEventsImpl.makeRecallEvent;
export const makeRecallDecisionEvent = traceEventsImpl.makeRecallDecisionEvent;
export const makeConfigResolutionEvent = traceEventsImpl.makeConfigResolutionEvent;
export const makeSecurityDecisionEvent = traceEventsImpl.makeSecurityDecisionEvent;
export const makeDegradationEvent = traceEventsImpl.makeDegradationEvent;
export type {
  GuildTraceEventBase,
  DispatchBackend,
  GuildTraceDispatchV1,
  RecallBranch,
  GuildTraceRecallV1,
  LaneOutcome,
  GuildTraceRecallDecisionV1,
  ConfigResolutionLayers,
  GuildTraceConfigResolutionV1,
  SecurityDecisionOutcome,
  GuildTraceSecurityDecisionV1,
  DegradationSurface,
  GuildTraceDegradationV1,
  GuildTraceEvent,
  GuildTraceSchemaVersion,
} from "../../src/modules/telemetry/workflows/guild-trace-events";
