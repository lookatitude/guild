/**
 * Backward-compatible public entrypoint.
 *
 * Trace emission lives in src/modules/telemetry so the reorg can move internals
 * without breaking imports from scripts/lib/guild-trace-emit.
 */

import * as traceEmitImpl from "../../src/domains/telemetry/guild-trace-emit";

export const emitTraceEvent = traceEmitImpl.emitTraceEvent;
