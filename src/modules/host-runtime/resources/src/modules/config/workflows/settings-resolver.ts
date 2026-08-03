/**
 * src/modules/config/workflows/settings-resolver.ts — settings resolver + R-TRACE config_resolution emit
 *
 * Public compatibility entrypoints under scripts/lib re-export this module.
 *
 * R-TRACE (Wave 6): this shim wraps resolveSettings() to emit guild.trace.config_resolution.v1
 * AFTER the result is computed. The emit is additive-only (try/catch; never changes the result).
 * Placed outside the pure reader so the M3 hard gate (R-HOST) is not tripped by observability work.
 */

import * as path from "path";
import * as crypto from "crypto";

// Re-export all types and functions from the implementation.
export * from "./settings-reader";

// Import the implementation so we can wrap resolveSettings.
import { resolveSettings as _resolveSettings, type ResolveOptions, type ResolveResult } from "./settings-reader";

// R-TRACE imports — additive only.
import { emitTraceEvent } from "../../telemetry";
import { makeConfigResolutionEvent } from "../../telemetry";

/**
 * resolveSettings — thin observability wrapper around the core implementation.
 *
 * Behavior-neutral: calls the core resolveSettings(), then emits
 * guild.trace.config_resolution.v1 in a try/catch AFTER the result is assembled.
 * A trace failure NEVER affects the returned result.
 *
 * R-TRACE emit-point: settings-resolver.ts resolveSettings() wrapper, line ~40
 */
export function resolveSettings(opts: ResolveOptions): ResolveResult {
  const t0 = Date.now();
  const result = _resolveSettings(opts);

  // R-TRACE emit — guild.trace.config_resolution.v1 (additive, try/catch)
  // emit-point: settings-resolver.ts resolveSettings() wrapper, after _resolveSettings() returns
  try {
    const { cwd, flags = {} } = opts;
    const assembled = result.config;
    const _traceRunId = process.env["GUILD_RUN_ID"] ?? "";
    const _traceRunDir = _traceRunId && cwd
      ? path.join(cwd, ".guild", "runs", _traceRunId)
      : undefined;
    if (_traceRunDir) {
      const _fingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify(assembled))
        .digest("hex")
        .slice(0, 16);
      // Determine which layers contributed by inspecting the sources map.
      const sources = result.sources;
      emitTraceEvent(
        makeConfigResolutionEvent({
          ts: new Date().toISOString(),
          run_id: _traceRunId,
          lane_id: process.env["GUILD_LANE_ID"] ?? "",
          rigor: String(assembled.rigor ?? "standard"),
          agent_mode: String(assembled.agent_mode ?? "default"),
          layers: {
            workspace: Object.values(sources).some((s) => s === "workspace"),
            workspace_local: Object.values(sources).some((s) => s === "workspace-local"),
            project: Object.values(sources).some((s) => s === "project"),
            project_local: Object.values(sources).some((s) => s === "project-local"),
            rigor: assembled._rigorExpanded?.rigor ?? null,
            cli: Object.keys(flags).length > 0,
          },
          duration_ms: Date.now() - t0,
          config_fingerprint: _fingerprint,
        }),
        _traceRunDir,
      );
    }
  } catch {
    // Trace must never affect settings resolution — swallow silently
  }

  return result;
}
