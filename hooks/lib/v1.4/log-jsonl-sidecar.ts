/**
 * log-jsonl-sidecar.ts — PreToolUse / PostToolUse pairing protocol.
 *
 * Single responsibility: the SIDECAR layer of the v1.4 telemetry log.
 * Split from log-jsonl.ts (M9 behavior-neutral decomposition, Wave 3 split-5).
 *
 * Consumers import from log-jsonl.ts (the re-export shim); this module is an
 * implementation detail. Do not import directly from outside hooks/lib/v1.4/.
 *
 * LOC target: ~390 (sidecar only; no schema defs, no main-log writer).
 *
 * Architect audit (`v1.4-claude-plugin-surface-audit.md` §1b):
 *   "Both hooks share a per-(run_id, lane_id, tool, pre_ts) correlation key
 *    so the post-handler can resolve the pre-handler's captured
 *    `command_redacted` and timestamp."
 *
 * "PostToolUse fires →
 *    tool-call-pre.jsonl is scanned for the matching pre-record
 *    (same run_id+lane_id+tool, pre_ts < post_ts, oldest unmatched)."
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { redactEventFields } from "./redact-log.js";
import { withStableLock } from "./v1.4-lock.js";

import {
  type ToolCallTool,
  type ToolCallEvent,
  assertSafeRunId,
  assertSafeLaneId,
} from "./log-jsonl-schema.js";
import { sidecarPath } from "./log-jsonl-writer.js";

// ──────────────────────────────────────────────────────────────────────────
// Sidecar entry shape
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sidecar entry shape — written by PreToolUse, consumed by PostToolUse.
 *
 * Correlation key per architect audit §1b:
 *   `(run_id, lane_id, tool, pre_ts)` 4-tuple, with oldest-unmatched
 *   selection when more than one pre-record matches the first three
 *   fields.
 *
 * `call_id` is retained (informational; useful for ops debugging) but
 * is NOT the correlation key — the four-field tuple is.
 */
export interface SidecarPreEntry {
  /** Run id (correlation key field 1). */
  run_id: string;
  /** Lane id (correlation key field 2). Optional for top-level calls outside a lane. */
  lane_id?: string;
  /** Tool name (correlation key field 3). */
  tool: ToolCallTool;
  /**
   * ISO timestamp of the PreToolUse fire (correlation key field 4).
   * `pre_ts` < `post_ts` and oldest-unmatched among ties.
   */
  ts_pre: string;
  command_redacted: string;
  /** Informational id; may aid debugging but is not the correlation key. */
  call_id?: string;
}

/** Sidecar file cap. Stale PreToolUse entries are best-effort telemetry; keep bounded. */
export const SIDECAR_MAX_BYTES = 1024 * 1024;

export interface SidecarAppendOptions {
  /** Override sidecar file cap for tests. */
  maxBytes?: number;
  /** Override redactable field-size cap for tests. */
  fieldCap?: number;
}

/**
 * Match-key fields used by `consumeSidecarPre` for oldest-unmatched
 * lookup. The four-field tuple is the binding contract.
 */
export interface SidecarMatchKey {
  run_id: string;
  lane_id?: string;
  tool: ToolCallTool;
  /** Optional upper bound — only entries with `ts_pre < post_ts` are eligible. */
  post_ts?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

function validateSidecarEntry(entry: SidecarPreEntry): void {
  assertSafeRunId(entry.run_id);
  if (entry.lane_id !== undefined) assertSafeLaneId(entry.lane_id);
}

function capSidecarText(existing: string, incomingLine: string, maxBytes: number): string {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`log-jsonl: sidecar maxBytes must be positive; got ${maxBytes}`);
  }
  const combined = existing + incomingLine;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
  const lines = combined.split("\n").filter((line) => line.length > 0);
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const bytes = Buffer.byteLength(line + "\n", "utf8");
    if (kept.length > 0 && total + bytes > maxBytes) break;
    if (bytes > maxBytes) {
      return "";
    }
    kept.unshift(line);
    total += bytes;
  }
  return kept.length === 0 ? "" : kept.join("\n") + "\n";
}

/**
 * Architect contract field-equality for the correlation key. Same
 * `run_id` + same `tool` + same `lane_id` (treating both `undefined`
 * as a match — no-lane PreToolUse pairs with no-lane PostToolUse).
 */
function sidecarKeyMatches(
  entry: SidecarPreEntry,
  key: SidecarMatchKey,
): boolean {
  if (entry.run_id !== key.run_id) return false;
  if (entry.tool !== key.tool) return false;
  if ((entry.lane_id ?? undefined) !== (key.lane_id ?? undefined)) return false;
  if (key.post_ts !== undefined) {
    const preMs = Date.parse(entry.ts_pre);
    const postMs = Date.parse(key.post_ts);
    if (Number.isFinite(preMs) && Number.isFinite(postMs) && preMs >= postMs) {
      return false;
    }
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Append a PreToolUse sidecar entry. Uses the same shared lock as the
 * live log because the sidecar lives under the same `logs/` dir; we do
 * NOT want a partial sidecar write to interleave with a rotation pass.
 */
export function appendSidecarPre(
  runDir: string,
  entry: SidecarPreEntry,
  opts: SidecarAppendOptions = {},
): void {
  validateSidecarEntry(entry);
  const path = sidecarPath(runDir);
  mkdirSync(dirname(path), { recursive: true });
  const redacted = redactEventFields(entry as unknown as Record<string, unknown>, opts.fieldCap) as unknown as SidecarPreEntry;
  const line = JSON.stringify(redacted) + "\n";
  const maxBytes = opts.maxBytes ?? SIDECAR_MAX_BYTES;
  const appendCapped = (): void => {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    writeFileSync(path, capSidecarText(existing, line, maxBytes));
  };
  if (process.platform === "win32") {
    appendCapped();
    return;
  }
  withStableLock(runDir, () => {
    appendCapped();
  });
}

/**
 * Find the matching sidecar pre-record for a PostToolUse fire and
 * remove it from the sidecar file. Match by the architect's 4-tuple
 * (`run_id`, `lane_id`, `tool`, `pre_ts < post_ts`) with oldest-
 * unmatched selection.
 *
 * Returns the matched entry (or `null` when no match exists — caller
 * decides whether to orphan-emit).
 *
 * The legacy `call_id`-only signature is retained as a convenience
 * overload for backward compatibility with existing callers/tests; the
 * 4-tuple form is the authoritative contract.
 */
export function consumeSidecarPre(
  runDir: string,
  matchOrCallId: SidecarMatchKey | string,
): SidecarPreEntry | null {
  const path = sidecarPath(runDir);
  if (!existsSync(path)) return null;

  const apply = (
    text: string,
  ): { match: SidecarPreEntry | null; rest: string } => {
    const lines = text.split("\n");
    // Build (rawLine, parsed) pairs to preserve untouched lines verbatim
    // (including malformed ones — they're flushed by sweep, not consumed
    // here).
    type ParsedLine = { raw: string; parsed: SidecarPreEntry | null };
    const parsedLines: ParsedLine[] = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        parsedLines.push({ raw, parsed: JSON.parse(raw) as SidecarPreEntry });
      } catch {
        parsedLines.push({ raw, parsed: null });
      }
    }
    // Find the oldest-unmatched eligible entry.
    let pickIdx = -1;
    let pickTs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p || p.parsed === null) continue;
      const eligible =
        typeof matchOrCallId === "string"
          ? p.parsed.call_id === matchOrCallId
          : sidecarKeyMatches(p.parsed, matchOrCallId);
      if (!eligible) continue;
      const ts = Date.parse(p.parsed.ts_pre);
      // Treat unparseable ts as "least old" so a parseable-ts entry wins.
      const tsForSort = Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
      if (tsForSort < pickTs) {
        pickTs = tsForSort;
        pickIdx = i;
      }
    }
    let match: SidecarPreEntry | null = null;
    const remainingLines: string[] = [];
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p) continue;
      if (i === pickIdx && p.parsed !== null) {
        match = p.parsed;
        continue;
      }
      remainingLines.push(p.raw);
    }
    const rest =
      remainingLines.length === 0 ? "" : remainingLines.join("\n") + "\n";
    return { match, rest };
  };

  if (process.platform === "win32") {
    const text = readFileSync(path, "utf8");
    const { match, rest } = apply(text);
    writeFileSync(path, rest);
    return match;
  }
  return withStableLock(runDir, () => {
    const text = readFileSync(path, "utf8");
    const { match, rest } = apply(text);
    writeFileSync(path, rest);
    return match;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Tool-call event builders
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build a `tool_call` event from a paired sidecar pre + post-data.
 * The architect contract: latency_ms = ts_post - ts_pre; status from
 * the post path; result_excerpt_redacted captured at post.
 *
 * If the sidecar entry is missing (orphan), the caller emits a
 * synthetic event with `status: "err"` and the literal sentinel
 * `result_excerpt_redacted: "<orphaned — pre/post pairing failed>"`.
 */
export function buildToolCallFromPair(
  pre: SidecarPreEntry,
  post: {
    ts_post: string;
    run_id: string;
    status: ToolCallEvent["status"];
    result_excerpt_redacted: string;
    tokens_in?: number;
    tokens_out?: number;
  },
): ToolCallEvent {
  const tsPostMs = Date.parse(post.ts_post);
  const tsPreMs = Date.parse(pre.ts_pre);
  const latency = Number.isFinite(tsPostMs) && Number.isFinite(tsPreMs)
    ? Math.max(0, tsPostMs - tsPreMs)
    : 0;
  const out: ToolCallEvent = {
    ts: post.ts_post,
    event: "tool_call",
    run_id: post.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: post.status,
    latency_ms: latency,
    result_excerpt_redacted: post.result_excerpt_redacted,
  };
  if (pre.lane_id !== undefined) out.lane_id = pre.lane_id;
  if (post.tokens_in !== undefined) out.tokens_in = post.tokens_in;
  if (post.tokens_out !== undefined) out.tokens_out = post.tokens_out;
  return out;
}

/**
 * Sentinel value emitted when the PostToolUse hook fires without a
 * matching PreToolUse sidecar entry (orphan handling). Architect
 * contract: `status: "err"`, this exact literal in result_excerpt.
 */
export const ORPHAN_RESULT_EXCERPT = "<orphaned — pre/post pairing failed>";

/**
 * Sentinel `latency_ms` value emitted for orphans flushed by the sweep.
 * Architect audit §1b: "stale pre-records flush after 5 minutes with
 * `latency_ms: -1` and `status: "err"`".
 */
export const ORPHAN_LATENCY_MS = -1 as const;

/**
 * Build the synthetic `tool_call` event the orphan-sweep contract
 * requires. Architect audit: `status: "err"`, `latency_ms: -1`,
 * `result_excerpt_redacted: ORPHAN_RESULT_EXCERPT`. The orphan's
 * `ts_pre` is preserved as the event `ts` so the audit trail surfaces
 * "this is when the unmatched Pre fired".
 */
export function buildOrphanedToolCall(
  pre: SidecarPreEntry,
): ToolCallEvent {
  const out: ToolCallEvent = {
    ts: pre.ts_pre,
    event: "tool_call",
    run_id: pre.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: "err",
    latency_ms: ORPHAN_LATENCY_MS,
    result_excerpt_redacted: ORPHAN_RESULT_EXCERPT,
  };
  if (pre.lane_id !== undefined) out.lane_id = pre.lane_id;
  return out;
}

/**
 * Build the `tool_call` event for the **POST-without-PRE** path —
 * distinct from the **PRE-without-POST** orphan-sweep path above. Per
 * `guild-benchmark/plans/v1.4-claude-plugin-surface-audit.md` lines 133-135:
 *
 *   "If not found: emit a tool_call event with command_redacted absent
 *    (treat as observability gap; status=\"ok\"; result and latency
 *    captured from Post alone)."
 *
 * `command_redacted` is the empty string (the audit calls this
 * "absent"; the schema's required-string field carries empty). Status
 * is literal `"ok"` per the audit — the missing-Pre case is an
 * *observability* gap, not a tool error; the tool's actual outcome is
 * preserved verbatim in `result_excerpt_redacted`. `latency_ms` is 0
 * because no Pre means no measurable Pre→Post duration; callers that
 * have Post-side `duration_ms` from Claude Code's hook payload may
 * pass it via `latency_ms_override`.
 *
 * This function is the single non-paired emit path for the post
 * handler; `buildOrphanedToolCall` covers the inverse case (sweep of
 * unmatched Pre records older than 5 min). Conflating the two is the
 * audit-conformance bug Codex G-lane round 2 caught.
 */
export function buildToolCallFromPostOnly(opts: {
  ts_post: string;
  run_id: string;
  tool: ToolCallTool;
  result_excerpt_redacted: string;
  lane_id?: string;
  latency_ms_override?: number;
  tokens_in?: number;
  tokens_out?: number;
}): ToolCallEvent {
  const out: ToolCallEvent = {
    ts: opts.ts_post,
    event: "tool_call",
    run_id: opts.run_id,
    tool: opts.tool,
    command_redacted: "",
    status: "ok",
    latency_ms: typeof opts.latency_ms_override === "number"
      ? opts.latency_ms_override
      : 0,
    result_excerpt_redacted: opts.result_excerpt_redacted,
  };
  if (opts.lane_id !== undefined) out.lane_id = opts.lane_id;
  if (opts.tokens_in !== undefined) out.tokens_in = opts.tokens_in;
  if (opts.tokens_out !== undefined) out.tokens_out = opts.tokens_out;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Orphan sweep
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sweep result — both the raw orphan entries (for caller diagnostics)
 * and the contract-shaped `tool_call` events ready to append to the
 * JSONL log. Callers that respect the contract simply iterate
 * `events`; callers that want the original `ts_pre` etc. iterate
 * `orphans`.
 */
export interface OrphanSweepResult {
  orphans: SidecarPreEntry[];
  events: ToolCallEvent[];
}

/**
 * Sweep sidecar entries older than `maxAgeMs` (default 5 minutes per
 * architect contract) and return both the raw orphans AND the
 * contract-shaped `tool_call` events for direct append to the live
 * log. Architect audit §1b enforces:
 *   - `status: "err"`
 *   - `latency_ms: -1`
 *   - `result_excerpt_redacted: ORPHAN_RESULT_EXCERPT`
 *
 * Sweep is idempotent and safe to call on every PostToolUse hook
 * invocation. Malformed sidecar lines (unparseable JSON) are dropped
 * silently — there is no `ts_pre` to age them against, so they cannot
 * be triaged.
 */
export function sweepOrphanedSidecar(
  runDir: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = 5 * 60 * 1000,
): SidecarPreEntry[] {
  return sweepOrphanedSidecarFull(runDir, nowMs, maxAgeMs).orphans;
}

/**
 * Same as `sweepOrphanedSidecar` but also returns the synthesized
 * `tool_call` events. Prefer this in new callers — the architect
 * contract requires the events to be emitted, not just collected.
 */
export function sweepOrphanedSidecarFull(
  runDir: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = 5 * 60 * 1000,
): OrphanSweepResult {
  const path = sidecarPath(runDir);
  if (!existsSync(path)) return { orphans: [], events: [] };

  const apply = (text: string): { orphans: SidecarPreEntry[]; rest: string } => {
    const lines = text.split("\n");
    const orphans: SidecarPreEntry[] = [];
    const kept: string[] = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        const parsed = JSON.parse(raw) as SidecarPreEntry;
        const tsMs = Date.parse(parsed.ts_pre);
        if (Number.isFinite(tsMs) && nowMs - tsMs > maxAgeMs) {
          orphans.push(parsed);
          continue;
        }
        kept.push(raw);
      } catch {
        // Malformed line; drop it (no way to know its age).
        continue;
      }
    }
    const rest = kept.length === 0 ? "" : kept.join("\n") + "\n";
    return { orphans, rest };
  };

  let orphans: SidecarPreEntry[];
  if (process.platform === "win32") {
    const text = readFileSync(path, "utf8");
    const out = apply(text);
    writeFileSync(path, out.rest);
    orphans = out.orphans;
  } else {
    orphans = withStableLock(runDir, () => {
      const text = readFileSync(path, "utf8");
      const out = apply(text);
      writeFileSync(path, out.rest);
      return out.orphans;
    });
  }
  const events = orphans.map(buildOrphanedToolCall);
  return { orphans, events };
}
