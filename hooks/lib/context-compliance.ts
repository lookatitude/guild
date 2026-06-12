/**
 * hooks/lib/context-compliance.ts
 *
 * Deterministic enforcement of the `guild:execute-plan` per-lane context
 * contract — the durable fix for the recurring `all-lanes/no-assemble`
 * compliance gap (evolve run-5e445ca4 gate.json: COMPLIANCE failure, not a
 * content gap → enforce in code, not skill prose).
 *
 * ── The invariant (deterministic) ────────────────────────────────────────────
 * For every dispatched specialist lane, by the lane's completion the run MUST
 * contain EITHER:
 *   (a) a context-assemble bundle at
 *       `.guild/context/<run-id>/<specialist>-<task-id>.md`  → context_mode=assemble
 *   (b) an inline audit-trail entry in
 *       `.guild/runs/<run-id>/dispatch-trace.md` naming that lane AND its
 *       file-listed working set                              → context_mode=inline
 * Neither present ⇒ compliance VIOLATION                     → context_mode=MISSING
 *
 * This collapses the "valid inline vs forbidden inline" distinction CORRECTLY:
 * the `guild:execute-plan §"Audit trail when inlining"` contract makes the
 * dispatch-trace entry MANDATORY *even under a valid inline shortcut*, so a
 * MISSING is always a violation regardless of autonomy posture — no posture
 * detection needed (which is why this is deterministic and cheap).
 *
 * ── Telemetry (kills the null gap) ───────────────────────────────────────────
 * `recordContextCompliance` emits the per-lane `context_mode` marker into:
 *   1. The v1.4 events path capture-telemetry uses
 *      (`.guild/runs/<run-id>/logs/v1.4-events.jsonl`) as a `hook_event`
 *      (`hook_name: "TaskCompleted"`, status ok|err, mode in the excerpt) —
 *      reuses an EXISTING closed-union event type so the plugin↔benchmark
 *      v1.4 schema is NOT bumped.
 *   2. A dedicated structured log
 *      (`.guild/runs/<run-id>/context-compliance.jsonl`,
 *      schema `guild.context_compliance.v1`) — the clean, queryable signal
 *      `guild:reflect` reads so `no-assemble` is a RECORDED, distinguishable
 *      mode instead of a null.
 *
 * Pure classification (`classifyContextMode` / `hasInlineTraceEntry`) is split
 * from the I/O (`evaluateContextCompliance` / `recordContextCompliance`) so the
 * deterministic rule is unit-testable without a filesystem.
 *
 * All writers are best-effort and non-throwing — a telemetry failure must never
 * block a lane's completion.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { appendEvent, isSafeLaneId, isSafeRunId } from "./v1.4/log-jsonl.js";

// ── Schema ───────────────────────────────────────────────────────────────────

export type ContextMode = "assemble" | "inline" | "MISSING";

export const CONTEXT_COMPLIANCE_SCHEMA = "guild.context_compliance.v1" as const;

export interface ContextComplianceResult {
  /** assemble (bundle present) | inline (dispatch-trace entry) | MISSING (neither). */
  context_mode: ContextMode;
  /** Was a non-empty context-assemble bundle present on disk? */
  bundle_present: boolean;
  /** Did `.guild/runs/<run-id>/dispatch-trace.md` exist? */
  trace_present: boolean;
  /** Did the dispatch-trace contain an entry naming this lane + a file-listed working set? */
  trace_entry_found: boolean;
  /** Repo-relative path the bundle would occupy (for the audit record). */
  bundle_path: string;
  /** Human-readable reason — surfaces in the loud warning + the record. */
  reason: string;
  /** True iff context_mode === "MISSING" (the violation flag). */
  gap: boolean;
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Repo-relative bundle path: `.guild/context/<run-id>/<specialist>-<task-id>.md`. */
export function bundleRelPath(runId: string, specialist: string, taskId: string): string {
  return path.join(".guild", "context", runId, `${specialist}-${taskId}.md`);
}

/** Absolute bundle path under the resolved guild root. */
export function bundleAbsPath(
  guildRoot: string,
  runId: string,
  specialist: string,
  taskId: string,
): string {
  return path.join(guildRoot, bundleRelPath(runId, specialist, taskId));
}

/** Absolute path to the inline audit trail: `<runDir>/dispatch-trace.md`. */
export function dispatchTraceAbsPath(runDir: string): string {
  return path.join(runDir, "dispatch-trace.md");
}

// ── Deterministic classification (pure) ──────────────────────────────────────

/**
 * A "file-listed" token: a filename with an extension, optionally prefixed by
 * path segments. Requires an explicit extension so prose tokens like "and/or"
 * or bare lane ids like "task-001" do NOT count as a working-set file. The char
 * after the dot must be a letter (so version numbers like "v1.4" do not match,
 * but "v1.4-events.jsonl" does via its `.jsonl`).
 */
const FILE_TOKEN_RE = /\b[\w@~+./-]*[\w@~+-]\.[A-Za-z][A-Za-z0-9]{0,8}\b/;

/** Lower-cased lane tokens this lane can be named by in the dispatch trace. */
function laneTokens(specialist: string, taskId: string): string[] {
  const tokens = new Set<string>();
  const t = taskId.trim().toLowerCase();
  const s = specialist.trim().toLowerCase();
  if (t) tokens.add(t);
  if (s && t) tokens.add(`${s}-${t}`);
  return Array.from(tokens);
}

/** Does a single dispatch-trace line mention this lane by id or specialist-id? */
export function traceLineMentionsLane(line: string, specialist: string, taskId: string): boolean {
  const hay = line.toLowerCase();
  return laneTokens(specialist, taskId).some((tok) => hay.includes(tok));
}

/**
 * Deterministic: does `dispatch-trace.md` carry a valid inline audit entry for
 * this lane? An entry is valid when a line names the lane AND that line's
 * contiguous block (up to the next blank line or markdown heading) contains at
 * least one file-listed token. This encodes the skill's "the orchestrator's
 * inlined working set, file-listed" requirement.
 */
export function hasInlineTraceEntry(
  content: string | null,
  specialist: string,
  taskId: string,
): boolean {
  if (!content) return false;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!traceLineMentionsLane(lines[i], specialist, taskId)) continue;
    // Gather the entry block: the mention line + following non-blank,
    // non-heading lines (a blank line or a new heading ends the entry).
    let block = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") break;
      if (/^#{1,6}\s/.test(l)) break;
      block += "\n" + l;
    }
    if (FILE_TOKEN_RE.test(block)) return true;
  }
  return false;
}

/**
 * Pure classifier. Given whether the bundle exists and the (optional)
 * dispatch-trace content, decide the context_mode. No filesystem access.
 * `bundle_path` is left empty here — `evaluateContextCompliance` fills it.
 */
export function classifyContextMode(opts: {
  bundleExists: boolean;
  traceContent: string | null;
  specialist: string;
  taskId: string;
}): ContextComplianceResult {
  const tracePresent = opts.traceContent !== null;

  if (opts.bundleExists) {
    return {
      context_mode: "assemble",
      bundle_present: true,
      trace_present: tracePresent,
      trace_entry_found: false,
      bundle_path: "",
      reason: "context-assemble bundle present",
      gap: false,
    };
  }

  const entryFound =
    tracePresent && hasInlineTraceEntry(opts.traceContent, opts.specialist, opts.taskId);
  if (entryFound) {
    return {
      context_mode: "inline",
      bundle_present: false,
      trace_present: true,
      trace_entry_found: true,
      bundle_path: "",
      reason:
        "no context-assemble bundle, but a dispatch-trace.md entry names this lane with a file-listed working set",
      gap: false,
    };
  }

  const reason = !tracePresent
    ? "no context-assemble bundle and no dispatch-trace.md in the run"
    : "no context-assemble bundle and no dispatch-trace.md entry names this lane with a file-listed working set";
  return {
    context_mode: "MISSING",
    bundle_present: false,
    trace_present: tracePresent,
    trace_entry_found: false,
    bundle_path: "",
    reason,
    gap: true,
  };
}

// ── Evaluation (I/O) ─────────────────────────────────────────────────────────

/**
 * Resolve the lane's context_mode against disk. Reads the bundle (existence +
 * non-empty) and the dispatch-trace, then classifies. Never throws — on any
 * read error it degrades to treating the source as absent (conservative: a
 * read failure cannot mask a MISSING into a pass).
 */
export function evaluateContextCompliance(opts: {
  guildRoot: string;
  runDir: string;
  runId: string;
  specialist: string;
  taskId: string;
}): ContextComplianceResult {
  const { guildRoot, runDir, runId, specialist, taskId } = opts;

  let bundleExists = false;
  try {
    const abs = bundleAbsPath(guildRoot, runId, specialist, taskId);
    bundleExists = fs.existsSync(abs) && fs.statSync(abs).size > 0;
  } catch {
    bundleExists = false;
  }

  let traceContent: string | null = null;
  try {
    const tracePath = dispatchTraceAbsPath(runDir);
    if (fs.existsSync(tracePath)) traceContent = fs.readFileSync(tracePath, "utf8");
  } catch {
    traceContent = null;
  }

  const result = classifyContextMode({ bundleExists, traceContent, specialist, taskId });
  result.bundle_path = bundleRelPath(runId, specialist, taskId);
  return result;
}

// ── Recording (telemetry, best-effort) ───────────────────────────────────────

/**
 * Append the structured `guild.context_compliance.v1` record to
 * `<runDir>/context-compliance.jsonl`. Best-effort, non-throwing.
 */
export function appendComplianceLog(
  runDir: string,
  runId: string,
  specialist: string,
  taskId: string,
  result: ContextComplianceResult,
): boolean {
  try {
    fs.mkdirSync(runDir, { recursive: true });
    const rec = {
      schema_version: CONTEXT_COMPLIANCE_SCHEMA,
      ts: new Date().toISOString(),
      run_id: runId,
      lane_id: taskId,
      specialist,
      task_id: taskId,
      context_mode: result.context_mode,
      bundle_present: result.bundle_present,
      trace_present: result.trace_present,
      trace_entry_found: result.trace_entry_found,
      bundle_path: result.bundle_path,
      gap: result.gap,
      reason: result.reason,
    };
    fs.appendFileSync(
      path.join(runDir, "context-compliance.jsonl"),
      JSON.stringify(rec) + "\n",
      "utf8",
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [context-compliance] compliance-log write failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }
}

/**
 * Emit the per-lane `context_mode` marker into the v1.4 events path as a
 * `hook_event` (an EXISTING closed-union event — no schema bump). The mode is
 * carried in `payload_excerpt_redacted` as a parseable token and mirrored into
 * `status` (ok for assemble/inline, err for MISSING). Best-effort, non-throwing.
 */
export function emitContextModeEvent(
  runDir: string,
  runId: string,
  specialist: string,
  taskId: string,
  result: ContextComplianceResult,
): boolean {
  try {
    if (!isSafeRunId(runId)) return false; // appendEvent would throw on a bad run id
    const laneSafe = isSafeLaneId(taskId);
    appendEvent(runDir, {
      ts: new Date().toISOString(),
      event: "hook_event",
      run_id: runId,
      ...(laneSafe ? { lane_id: taskId } : {}),
      hook_name: "TaskCompleted",
      payload_excerpt_redacted: `context_mode=${result.context_mode} specialist=${specialist} task=${taskId}`,
      latency_ms: 0,
      status: result.context_mode === "MISSING" ? "err" : "ok",
    });
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [context-compliance] v1.4 hook_event emit failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }
}

/**
 * Record the compliance result into BOTH telemetry channels (dedicated log +
 * v1.4 events). Best-effort: each channel fails independently and never blocks.
 */
export function recordContextCompliance(
  runDir: string,
  runId: string,
  specialist: string,
  taskId: string,
  result: ContextComplianceResult,
): void {
  appendComplianceLog(runDir, runId, specialist, taskId, result);
  emitContextModeEvent(runDir, runId, specialist, taskId, result);
}
