#!/usr/bin/env -S npx tsx
/**
 * hooks/pre-compact.ts
 *
 * Event:   PreCompact
 * Purpose: Two jobs. (1) Trace point: PreCompact fires before Claude Code
 *          compacts conversation context (clearing the working buffer), so we
 *          emit a `hook_event` JSONL line via T3c's appendEvent() to capture the
 *          compact boundary in the audit log. (2) Gap G1 re-anchor (oir-wi-00):
 *          when an active OPEN run exists under the resolved guild root, emit a
 *          compact re-anchor header (lead posture, agent_mode/backend,
 *          named-specialist dispatch, tier contract, next pending gate,
 *          guild:resume pointer) as `hookSpecificOutput.additionalContext` into
 *          the context the host preserves.
 *
 *          PreCompact fires BEFORE compaction, so the injected header is
 *          best-effort — the RELIABLE surface is the SessionStart source=compact
 *          branch (hooks/session-reanchor.ts), which fires AFTER compaction. We
 *          ship BOTH per the work-item. Both fall through cleanly (no stdout, no
 *          log) when no active OPEN run exists — zero noise.
 *
 *          LEAD-ONLY re-anchor (oir-wi-57 round-4 fix): PreCompact is
 *          globally registered, so it ALSO fires inside every dispatched
 *          specialist's own pane/subagent session, not just the lead's. The
 *          re-anchor header ("you are the lean LEAD, not a lane worker") is
 *          gated on this invocation's OWN environment carrying no
 *          GUILD_LANE_ID/GUILD_TASK_ID — a compacted specialist reading that
 *          text and abandoning its lane to assume orchestration would
 *          recreate the exact role-collapse class issue #57 exists to
 *          prevent. The telemetry hook_event is still recorded uncondition-
 *          ally either way, WITH attribution, so hooks/lib/lean-lead-guard.ts
 *          can tell a worker's own compaction apart from the lead's.
 *
 * Stdin:   JSON — Claude Code PreCompact hook payload.
 * Stdout:  The re-anchor additionalContext envelope when an active OPEN run
 *          exists AND this invocation is the lead's own session (no
 *          GUILD_LANE_ID/GUILD_TASK_ID); otherwise silent.
 * Stderr:  Diagnostic warnings only.
 * Exit:    Always 0 — telemetry / re-anchor must not block compaction.
 *
 * Run-id resolution: process.env.GUILD_RUN_ID. Unset → fall through.
 *
 * runDir resolution:
 *   1. process.env.GUILD_RUN_DIR
 *   2. resolveGuildRoot(GUILD_CWD | payload.cwd | process.cwd()) + .guild/runs/<run-id>
 *      resolveGuildRoot walks UP from the starting cwd to the nearest .git / .guild
 *      ancestor so .guild/ always lands at the repo root, never in a subdirectory.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { resolveGuildRoot } from "./lib/guild-root.js";
import {
  buildReanchorHeader,
  buildAdditionalContextEnvelope,
  buildCompactSummaryInstructions,
} from "./lib/reanchor.js";
import { appendEvent, type HookEvent } from "./lib/v1.4/log-jsonl.js";
// guild.trace_event.v2 additive fields (D-OBS-1/6). Bound BY POINTER — see
// lib/trace-v2.ts header. Hook events are not LLM calls → no tokens.
import { resolveTraceV2Fields } from "./lib/trace-v2.js";
import { resolveLaneAttribution } from "./lib/lane-attribution.js";

interface PreCompactPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  /** Optional per-host payload — the architect contract treats it as opaque. */
  payload?: unknown;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * Build a short string excerpt from an arbitrary payload value. The
 * downstream `redactEventFields` applies token-shape patterns + field
 * caps; here we only stringify so the redaction pipeline has something
 * to work with.
 */
function payloadExcerpt(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

function readCurrentRunId(guildRoot: string): string | undefined {
  const sentinelPath = path.join(guildRoot, ".guild", "runs", "current-run-id");
  try {
    const value = fs.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveRunId(guildRoot: string): string | undefined {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(guildRoot);
}

export async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: PreCompactPayload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed: unknown = JSON.parse(raw.trim());
      // Type-guard the JSON boundary: VALID JSON can be null / a number / an
      // array, and casting straight to the payload interface would make the
      // `payload.cwd` read below throw. Only a plain object is usable; anything
      // else degrades to an empty payload (bare event, cwd from env/process).
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as PreCompactPayload;
      }
    }
  } catch {
    process.stderr.write("warn: [pre-compact] invalid JSON on stdin; emitting bare event.\n");
  }

  // `cwd` is only usable when it is actually a string.
  const payloadCwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const cwd = process.env["GUILD_CWD"] ?? payloadCwd ?? process.cwd();
  // Walk up from cwd to find the repo root — ensures .guild/ always lands at
  // the nearest .git / .guild ancestor, never in a subdirectory.
  const guildRoot = resolveGuildRoot(cwd);

  // oir-wi-57 round-4/5: PreCompact is a globally-registered hook — it fires
  // inside every dispatched specialist's own pane/subagent session too, not
  // just the lead's. Resolved BEFORE the re-anchor emission below (moved up
  // from its original post-telemetry position) so the "you are the lean
  // LEAD, not a lane worker" header is never sent into a compacted
  // SPECIALIST's own context — that would recreate the exact role-collapse
  // class issue #57 exists to prevent (a compacted specialist reading "you
  // are the lead" and abandoning its own lane to assume orchestration).
  // resolveLaneAttribution is undefined iff this is NOT a worker invocation
  // at all (round-5 fix: independently validates GUILD_LANE_ID/GUILD_TASK_ID
  // rather than a bare `??`, so a blank/unsafe GUILD_LANE_ID can never mask a
  // valid GUILD_TASK_ID and wrongly let the lead header through to a worker).
  const laneId = resolveLaneAttribution();

  // Gap G1 (oir-wi-00): emit a compact re-anchor header into the context the
  // host preserves BEFORE it compacts. Best-effort — PreCompact fires before
  // compaction, so this may or may not survive; the reliable surface is the
  // SessionStart source=compact branch (hooks/session-reanchor.ts). We ship
  // BOTH per the work-item. Zero-noise: buildReanchorHeader returns null when
  // there is no active OPEN run, and we write nothing. Wrapped so a re-anchor
  // failure never blocks compaction (telemetry emit below still runs).
  // LEAD-ONLY: skip entirely when `laneId` is set — a dispatched specialist's
  // own compaction gets its telemetry recorded (below, with attribution) but
  // never the lead's posture header.
  if (laneId === undefined) {
    try {
      const header = buildReanchorHeader(guildRoot);
      if (header !== null) {
        // G5(c) (v23x-deferred-followups rf-wi-05, origin oir-wi-58): the
        // compaction path already CONSUMES `newCustomInstructions` — nothing
        // emitted it. Use it as the SECOND channel (alongside the existing
        // `additionalContext` header) to shape the post-compact SUMMARY
        // itself, telling the compactor to preserve the run's identity/
        // phase/next-gate facts verbatim. Derived from the identical facts
        // the header uses, so the two channels never disagree; null only
        // when the header is also null (same zero-noise gate).
        const customInstructions = buildCompactSummaryInstructions(guildRoot);
        process.stdout.write(
          buildAdditionalContextEnvelope("PreCompact", header, customInstructions ?? undefined),
        );
      }
    } catch (err) {
      process.stderr.write(
        `warn: [pre-compact] re-anchor header build failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }

  const runId = resolveRunId(guildRoot);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [pre-compact] GUILD_RUN_ID unset and current-run-id missing — falling through (no log emit).\n",
    );
    return;
  }

  const runDir =
    process.env["GUILD_RUN_DIR"] ??
    path.join(guildRoot, ".guild", "runs", runId);

  const ts = new Date().toISOString();
  // laneId resolved above (before the re-anchor gate). Stamping it here lets
  // a consumer like hooks/lib/lean-lead-guard.ts distinguish "the LEAD's own
  // context just compacted" from "an unrelated specialist pane's context
  // compacted" — the latter has no bearing on the lead's own budget.
  const event: HookEvent = {
    ts,
    event: "hook_event",
    run_id: runId,
    hook_name: "PreCompact",
    payload_excerpt_redacted: payloadExcerpt(payload.payload),
    latency_ms: 0,
    status: "ok",
    ...(laneId !== undefined ? { lane_id: laneId } : {}),
  };
  // D-OBS-1/6: span_id + env-threaded tier/model/parent (no tokens for hooks).
  const traceV2 = resolveTraceV2Fields({
    runId,
    eventType: "hook_event",
    ts,
    actorId: laneId ?? "main",
  });

  try {
    appendEvent(runDir, event, { traceV2 });
  } catch (err) {
    process.stderr.write(
      `warn: [pre-compact] log emit failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("pre-compact.ts") ||
    process.argv[1].endsWith("pre-compact.js"))
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [pre-compact] ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(0);
  });
}
