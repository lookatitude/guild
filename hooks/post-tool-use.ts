#!/usr/bin/env -S npx tsx
/**
 * hooks/post-tool-use.ts
 *
 * Event:   PostToolUse (matcher widened to `*` per architect's
 *          v1.4-claude-plugin-surface-audit.md §"Tool-call pre/post pairing")
 * Purpose: Consume the matching sidecar Pre entry written by
 *          hooks/pre-tool-use.ts (T3c's `consumeSidecarPre()` API),
 *          compute latency_ms = ts_post - ts_pre, and emit a
 *          `tool_call` JSONL event via T3c's `appendEvent()`. Also
 *          run the orphan sweep on every fire to flush stale Pre
 *          entries (>5 min) as `tool_call status: "err"` with the
 *          architect's literal ORPHAN_RESULT_EXCERPT sentinel.
 *
 *          The legacy `capture-telemetry.ts` handler continues to
 *          run alongside this one (additive). It writes to
 *          `events.ndjson` which is the v1.3 trace channel; the v1.4
 *          tool_call event lives in `<runDir>/logs/v1.4-events.jsonl`.
 *
 * Stdin:   JSON — Claude Code PostToolUse hook payload.
 * Stdout:  Silent.
 * Stderr:  Diagnostic warnings only.
 * Exit:    Always 0 — telemetry must not block.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { resolveGuildRoot } from "./lib/guild-root.js";
import { authorizeHookWrite, formatBindingRejected } from "./lib/hook-binding.js";
import {
  appendEvent,
  buildToolCallFromPair,
  buildToolCallFromPostOnly,
  consumeSidecarPre,
  isSafeLaneId,
  isSafeRunId,
  sweepOrphanedSidecarFull,
  type SidecarMatchKey,
  type ToolCallEvent,
  TOOL_CALL_TOOL_VALUES,
  type ToolCallTool,
} from "./lib/v1.4/log-jsonl.js";
// guild.trace_event.v2 additive fields (D-OBS-1/6). Bound BY POINTER — see
// lib/trace-v2.ts header + contract-map §B-post.
import { normalizeTokens, resolveTraceV2Fields, type TraceTokens } from "./lib/trace-v2.js";
// HK-06: durable-surface (wiki/review/handoffs/provenance) PostToolUse scrub-in-place (D-SECRETS).
import { scrubbedWrite, type ScrubSurface } from "./lib/security/scrubbed-write.js";
import { buildSecurityEvent, appendSecurityEvent } from "./lib/security/events.js";
// G-9 (SC-5): structured heartbeat WRITE side — backend-agnostic liveness.
import { writeHeartbeatFromEnv } from "./lib/heartbeat-write.js";
// L5a: host-neutral hook payload + Claude emitter. PostToolUsePayload is now the
// shared `GuildHookEvent`; for Claude the emitter mapping is the identity, so the
// PostToolUse behavior is preserved byte-for-byte.
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";

function isKnownTool(name: string | undefined): name is ToolCallTool {
  if (typeof name !== "string") return false;
  return (TOOL_CALL_TOOL_VALUES as readonly string[]).includes(name);
}

function isOk(payload: GuildHookEvent): "ok" | "err" {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return "ok";
  if (typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    if (r["success"] === false) return "err";
    if (typeof r["error"] === "string" && r["error"].length > 0) return "err";
  }
  return "ok";
}

function resultExcerpt(payload: GuildHookEvent): string {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return "";
  if (typeof resp === "string") return resp;
  try {
    return JSON.stringify(resp);
  } catch {
    return "";
  }
}

// ── HK-06: durable-surface PostToolUse scrub-in-place helpers ────────────────

/**
 * Classify an absolute path as a scrub-target surface.
 *   "wiki"       → .guild/wiki/**
 *   "review"     → .guild/runs/<id>/review/**
 *   "handoff"    → .guild/runs/<id>/handoffs/**   (D-SECRETS coverage fix:
 *                  model-written handoff receipts via the Write tool — the
 *                  subagent/in-process backends — previously bypassed the
 *                  in-place scrub; only the team-backend hook path
 *                  (task-completed.ts) covered handoffs)
 *   "provenance" → .guild/runs/<id>/provenance.json
 *   null         → not a target (no scrub)
 */
function classifyGuildScrubSurface(absPath: string, guildRoot: string): ScrubSurface | null {
  const rel = path.relative(guildRoot, absPath);
  const parts = rel.split(path.sep);
  if (parts[0] === ".guild" && parts[1] === "wiki") return "wiki";
  // .guild/runs/<runId>/<leaf>  (parts: [".guild", "runs", "<id>", <leaf>, ...])
  if (parts[0] === ".guild" && parts[1] === "runs" && parts.length >= 4) {
    if (parts[3] === "review") return "review";
    if (parts[3] === "handoffs") return "handoff";
    if (parts[3] === "provenance.json" && parts.length === 4) return "provenance";
  }
  return null;
}

/**
 * HK-06: PostToolUse scrub-in-place for the durable surfaces (wiki, review, handoffs, provenance.json).
 *
 * When Write|Edit completes against .guild/wiki/** or .guild/runs/<id>/review/**,
 * read the on-disk file (already written by the tool) and route it through
 * scrubbedWrite. The file is replaced with scrubbed content (ok) or quarantined
 * (ok=false → fail-CLOSED: file renamed to path+".quarantined" and
 * secret_scrub_blocked event emitted via scrubbedWrite).
 *
 * `runDir` and `runId` may be undefined when invoked before the run-id gate
 * (e.g., wiki writes that have no active run). In those cases synthetic
 * fallback values are used so security events still land and the scrub fires.
 *
 * Non-blocking: PostToolUse always exits 0; this function never throws.
 * "Sub-second pre-commit window" — runs synchronously before exit.
 */
function runGuildArtifactScrub(
  payload: GuildHookEvent,
  guildRoot: string,
  runDir: string | undefined,
  runId: string | undefined,
  laneId: string | undefined,
): void {
  // Synthetic fallbacks for project-scoped writes (e.g. wiki) with no active run.
  const effectiveRunId = typeof runId === "string" && runId.length > 0 ? runId : "no-active-run";
  const effectiveRunDir =
    typeof runDir === "string" && runDir.length > 0
      ? runDir
      : path.join(guildRoot, ".guild", "runs", effectiveRunId);
  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return;

  const ti = payload.tool_input as Record<string, unknown> | null | undefined;
  if (!ti || typeof ti !== "object") return;
  const rawFilePath = ti["file_path"];
  if (typeof rawFilePath !== "string" || rawFilePath.length === 0) return;

  const absPath = path.isAbsolute(rawFilePath)
    ? rawFilePath
    : path.resolve(guildRoot, rawFilePath);

  const surface = classifyGuildScrubSurface(absPath, guildRoot);
  if (surface === null) return;

  // Read the file as written by the tool (already on disk).
  let diskContent: string;
  try {
    diskContent = fs.readFileSync(absPath, "utf8");
  } catch {
    return; // File missing/unreadable — nothing to scrub
  }

  // Route through scrubbedWrite: scrub-then-overwrite, or block-and-event.
  const result = scrubbedWrite(absPath, diskContent, {
    surface,
    runDir: effectiveRunDir,
    runId: effectiveRunId,
    laneId,
  });

  if (result.blocked) {
    // fail-CLOSED: scrubbedWrite did NOT overwrite. The original file still
    // exists at absPath with unredacted content.
    //
    // Failure ladder — raw MUST NOT survive at the canonical path:
    //   STEP 1: Best-effort quarantine rename (preserves content for human review).
    //   STEP 2: If rename failed, MUST destroy raw at canonical: overwrite then unlink.
    //   HARD:   If canonical removal also fails → critical event + process.exit(1).

    let quarantineDone = false;
    try {
      fs.renameSync(absPath, absPath + ".quarantined");
      quarantineDone = true;
    } catch {
      // Rename failed — proceed to canonical removal.
    }

    if (!quarantineDone) {
      let canonicalRemoved = false;
      // Try overwrite with a safe redaction notice first.
      try {
        fs.writeFileSync(
          absPath,
          `[SCRUB-BLOCKED: ${surface} file content removed by Guild HK-06 secret scrub ` +
            `— quarantine rename failed, raw destroyed at canonical path]\n`,
          "utf8",
        );
        canonicalRemoved = true;
      } catch {
        // Try unlink as last resort.
        try {
          fs.unlinkSync(absPath);
          canonicalRemoved = true;
        } catch {
          // All removal attempts exhausted.
        }
      }

      if (!canonicalRemoved) {
        // HARD FAILURE: raw secret persists at canonical path — critical breach.
        // Emit critical event (best-effort), then exit non-zero.
        process.stderr.write(
          `[CRITICAL] [post-tool-use] HK-06: CANNOT remove raw secret from canonical ` +
            `path "${path.basename(absPath)}" — quarantine AND canonical-removal ` +
            `(overwrite+unlink) both failed. Exiting non-zero. Manual remediation required.\n`,
        );
        try {
          const evt = buildSecurityEvent({
            run_id: effectiveRunId,
            lane_id: laneId,
            event_type: "secret_scrub_blocked",
            decision: "blocked",
            tool: "post-tool-use/hk06-scrub",
            detail:
              `CRITICAL: Cannot remove raw ${surface} write from canonical path ` +
              `"${path.basename(absPath)}" — quarantine AND canonical-removal both failed. ` +
              `Raw secret may persist. Manual remediation required.`,
            permission_mode: "blocked",
          });
          appendSecurityEvent(effectiveRunDir, evt);
        } catch {}
        process.exit(1);
      }

      process.stderr.write(
        `warn: [post-tool-use] HK-06: quarantine rename failed but canonical ` +
          `path overwritten/unlinked for ${path.basename(absPath)}.\n`,
      );
    }

    process.stderr.write(
      `warn: [post-tool-use] HK-06: ${surface} write BLOCKED by secret scrub at ` +
        `${path.basename(absPath)} — quarantined/removed. secret_scrub_blocked event emitted.\n`,
    );
  } else if (result.written) {
    process.stderr.write(
      `info: [post-tool-use] HK-06: ${surface} file scrubbed in place: ${path.basename(absPath)}.\n`,
    );
  }
}

// ── Run ID helpers ────────────────────────────────────────────────────────────

/**
 * T3b (session_context §5): run identity for this hook's WRITE legs (v1.4
 * tool_call events, heartbeats, run-state) resolves from the explicit binding
 * env and is verified against the run's minted binding — never a sentinel, so
 * a moved current-run-id cannot redirect a write (SC-1). A refused binding
 * returns undefined; callers fall through (no emit) as before.
 */
function resolveRunId(guildRoot: string): string | undefined {
  const auth = authorizeHookWrite(guildRoot);
  if (auth.ok === false) {
    process.stderr.write(formatBindingRejected("post-tool-use", auth));
    return undefined;
  }
  return auth.run_id;
}

export async function main(): Promise<void> {
  const raw = await readHookStdin();
  let payload: GuildHookEvent = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.stderr.write("warn: [post-tool-use] invalid JSON on stdin; skipping pairing.\n");
    return;
  }

  const toolName = payload.tool_name ?? "";
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  // Walk up from cwd to find the repo root — ensures .guild/ always lands at
  // the nearest .git / .guild ancestor, never in a subdirectory.
  const guildRoot = resolveGuildRoot(cwd);

  // ── G-9 (SC-5): structured heartbeat write ────────────────────────────────
  // When GUILD_RUN_ID + GUILD_SPECIALIST are both exported (the dispatch path
  // sets them per lane), every PostToolUse refreshes the lane's structured
  // heartbeat at <runDir>/in-progress/<specialist>.json — the write side of
  // ADR-RE-3 that makes stall detection backend-agnostic (not tmux-only).
  // T3b rework F2: writeHeartbeatFromEnv verifies the COMPLETE hook binding
  // envelope (GUILD_RUN_ID + GUILD_RUN_BINDING_REF via authorizeHookWrite)
  // BEFORE touching the filesystem — an absent/blank/closed/mismatched ref
  // refuses (reason binding_rejected:<...>) with no heartbeat and no temp
  // file. Fail-open by contract (never throws) and near-zero cost when the
  // env vars are absent.
  {
    const hb = writeHeartbeatFromEnv({ toolName: payload.tool_name, cwd });
    if (!hb.written && hb.reason !== null && hb.reason !== "env-absent") {
      process.stderr.write(
        `warn: [post-tool-use] heartbeat write skipped (non-fatal): ${hb.reason}\n`,
      );
    }
  }
  // ── end G-9 ────────────────────────────────────────────────────────────────

  // ── HK-06: durable-surface PostToolUse scrub-in-place ───────────────────
  // Placed BEFORE the run-id gate: wiki pages (.guild/wiki/**) are project-
  // scoped and have NO run-id — gating on runId permanently bypasses the wiki
  // surface. The scrub uses synthetic fallback values when runId is absent.
  // Non-blocking: always exits 0. Non-throwing by contract.
  {
    const earlyRunId = resolveRunId(guildRoot);
    const earlyRunIdSafe =
      typeof earlyRunId === "string" && earlyRunId.length > 0 && isSafeRunId(earlyRunId)
        ? earlyRunId
        : undefined;
    const earlyRunDir = earlyRunIdSafe
      ? (process.env["GUILD_RUN_DIR"] ?? path.join(guildRoot, ".guild", "runs", earlyRunIdSafe))
      : undefined;
    const earlyRawLaneId = process.env["GUILD_LANE_ID"];
    const earlyLaneId =
      typeof earlyRawLaneId === "string" &&
      earlyRawLaneId.length > 0 &&
      isSafeLaneId(earlyRawLaneId)
        ? earlyRawLaneId
        : undefined;
    try {
      runGuildArtifactScrub(payload, guildRoot, earlyRunDir, earlyRunIdSafe, earlyLaneId);
    } catch (err) {
      process.stderr.write(
        `warn: [post-tool-use] HK-06 scrub threw (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  // ── end HK-06 ────────────────────────────────────────────────────────────

  const runId = resolveRunId(guildRoot);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [post-tool-use] GUILD_RUN_ID unset and current-run-id missing — falling through (no tool_call emit).\n",
    );
    return;
  }
  if (!isSafeRunId(runId)) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_RUN_ID/current-run-id — falling through (no tool_call emit).\n",
    );
    return;
  }

  const runDir =
    process.env["GUILD_RUN_DIR"] ??
    path.join(guildRoot, ".guild", "runs", runId);
  const rawLaneId = process.env["GUILD_LANE_ID"];
  const laneId =
    typeof rawLaneId === "string" && rawLaneId.length > 0 && isSafeLaneId(rawLaneId)
      ? rawLaneId
      : undefined;
  if (typeof rawLaneId === "string" && rawLaneId.length > 0 && laneId === undefined) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_LANE_ID — omitting lane_id.\n",
    );
  }
  const tsPost = new Date().toISOString();

  // Always run the orphan sweep first — flushes stale Pre entries from
  // crashed earlier dispatches as `status: "err"` events. Architect
  // contract: every PostToolUse invocation runs this sweep.
  try {
    const sweep = sweepOrphanedSidecarFull(runDir);
    for (const ev of sweep.events) {
      try {
        appendEvent(runDir, ev);
      } catch (err) {
        process.stderr.write(
          `warn: [post-tool-use] orphan emit failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] sweep failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  // If the tool isn't in the closed enum, we cannot emit a valid
  // tool_call (the validator would reject it). Fall through silently
  // after the orphan sweep so the audit channel still drains.
  if (!isKnownTool(toolName)) {
    return;
  }

  // Match by 4-tuple: (run_id, lane_id, tool, ts_pre < post_ts).
  const matchKey: SidecarMatchKey = {
    run_id: runId,
    tool: toolName,
    post_ts: tsPost,
  };
  if (laneId !== undefined) {
    matchKey.lane_id = laneId;
  }

  let event: ToolCallEvent;
  try {
    const pre = consumeSidecarPre(runDir, matchKey);
    if (pre === null) {
      // POST-without-PRE: per audit lines 133-135, this is an
      // *observability gap*, not a pairing error. Emit with
      // command_redacted absent (empty string), status="ok",
      // result + latency captured from Post alone. This is distinct
      // from the orphan-sweep path (PRE-without-POST > 5 min, status="err").
      // The duration_ms from Claude Code's hook payload, when present,
      // becomes latency_ms_override so we still get a usable timing.
      event = buildToolCallFromPostOnly({
        ts_post: tsPost,
        run_id: runId,
        tool: toolName,
        result_excerpt_redacted: resultExcerpt(payload),
        ...(laneId !== undefined ? { lane_id: laneId } : {}),
        ...(typeof payload.duration_ms === "number"
          ? { latency_ms_override: payload.duration_ms }
          : {}),
      });
    } else {
      event = buildToolCallFromPair(pre, {
        ts_post: tsPost,
        run_id: runId,
        status: isOk(payload),
        result_excerpt_redacted: resultExcerpt(payload),
      });
    }
    // D-OBS-1/6: attach guild.trace_event.v2 fields. tokens only for LLM-call
    // tools (Agent/Skill) and only when the payload actually carried usage.
    const isLlmCallTool = toolName === "Agent" || toolName === "Skill";
    const tokens: TraceTokens | undefined = isLlmCallTool
      ? normalizeTokens(payload.tokens ?? payload.usage)
      : undefined;
    const traceV2 = resolveTraceV2Fields({
      runId,
      eventType: "tool_call",
      ts: tsPost,
      actorId: laneId ?? "main",
      tokens,
    });
    appendEvent(runDir, event, { traceV2 });
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] tool_call emit failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("post-tool-use.ts") ||
    process.argv[1].endsWith("post-tool-use.js"))
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [post-tool-use] ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(0);
  });
}
