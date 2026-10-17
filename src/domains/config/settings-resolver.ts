/**
 * src/domains/config/settings-resolver.ts — settings resolver + R-TRACE config_resolution emit
 *
 * Public compatibility entrypoints under scripts/lib re-export this module.
 *
 * R-TRACE (Wave 6): this shim wraps resolveSettings() to emit guild.trace.config_resolution.v1
 * AFTER the result is computed. The emit is additive-only (try/catch; never changes the result).
 * Placed outside the pure reader so the M3 hard gate (R-HOST) is not tripped by observability work.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Re-export all types and functions from the implementation.
export * from "./settings-reader";

// Import the implementation so we can wrap resolveSettings.
import { resolveSettings as _resolveSettings, type ResolveOptions, type ResolveResult } from "./settings-reader";

import { durableGuildDir } from "../state";

// R-TRACE telemetry, loaded lazily from a separate compiled chunk (C04/KTD29): a
// top-level `import … from "../telemetry"` made esbuild inline the telemetry graph
// into EVERY bundle that resolves settings — config-cmd.js was 12 domains wide.
// Author plane (.ts) requires the source barrel; compiled plane (.js) walks up to
// the package's runtime/scripts/telemetry-api.js and fails closed if it is absent
// (KTD10: no tsx fallback). Both specifiers are non-analyzable on purpose.
type TelemetryApi = typeof import("../telemetry");
let _telemetryApi: TelemetryApi | null = null;
function telemetryApi(): TelemetryApi {
  if (_telemetryApi !== null) return _telemetryApi;
  if (__filename.endsWith(".ts")) {
    const sourceBarrel = path.join(__dirname, "..", "telemetry");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _telemetryApi = require(sourceBarrel) as TelemetryApi;
    return _telemetryApi;
  }
  // Resolution is BOUNDED to the owning package (codex C04 r1): sibling chunk in
  // the runtime/scripts layout, else the NEAREST package root must carry it. The
  // walk never continues past a package root, so an incomplete dist/<host>
  // package fails closed instead of borrowing a checkout's chunk.
  const sibling = path.join(__dirname, "telemetry-api.js");
  if (fs.existsSync(sibling)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _telemetryApi = require(sibling) as TelemetryApi;
    return _telemetryApi;
  }
  for (let dir = path.dirname(__dirname); ; ) {
    const isPackageRoot =
      fs.existsSync(path.join(dir, "runtime")) ||
      fs.existsSync(path.join(dir, ".claude-plugin")) ||
      fs.existsSync(path.join(dir, ".codex-plugin")) ||
      fs.existsSync(path.join(dir, "guild.inventory.json"));
    if (isPackageRoot) {
      const chunk = path.join(dir, "runtime", "scripts", "telemetry-api.js");
      if (!fs.existsSync(chunk)) {
        throw new Error(
          `guild: runtime/scripts/telemetry-api.js missing from package root ${dir} — incomplete package; run \`bun run compile\` (KTD10 fail-closed)`,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _telemetryApi = require(chunk) as TelemetryApi;
      return _telemetryApi;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `guild: no package root found above ${__dirname} for telemetry-api.js (KTD10 fail-closed)`,
  );
}

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
  //
  // The telemetry CHUNK is resolved OUTSIDE the additive catch (codex C04 r1):
  // a missing/corrupt shipped chunk is an incomplete package and fails closed
  // (KTD10), never a silent R-TRACE suppression. Only the emission I/O itself
  // stays swallowed.
  const { cwd, flags = {} } = opts;
  const _traceRunId = process.env["GUILD_RUN_ID"] ?? "";
  const _traceRunDir = _traceRunId && cwd
    ? path.join(durableGuildDir(cwd), "runs", _traceRunId)
    : undefined;
  const _telemetry = _traceRunDir ? telemetryApi() : null;
  try {
    const assembled = result.config;
    if (_traceRunDir && _telemetry) {
      const _fingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify(assembled))
        .digest("hex")
        .slice(0, 16);
      // Determine which layers contributed by inspecting the sources map.
      const sources = result.sources;
      _telemetry.emitTraceEvent(
        _telemetry.makeConfigResolutionEvent({
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
