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
import { resolveDispatchAttribution } from "./lib/dispatch-attribution.js";
import { resolveLaneAttribution } from "./lib/lane-attribution.js";
// HK-06: durable-surface (wiki/review/handoffs/provenance) PostToolUse scrub-in-place (D-SECRETS).
import { scrubbedWrite, type ScrubSurface } from "./lib/security/scrubbed-write.js";
import { buildSecurityEvent, appendSecurityEvent } from "./lib/security/events.js";
import { readSecurityConfig, type SecretsPolicy } from "./lib/security/config.js";
import { applySecretsPolicy, resolveTelemetryField } from "./lib/security/secrets.js";
// G-9 (SC-5): structured heartbeat WRITE side — backend-agnostic liveness.
import { writeHeartbeatFromEnv } from "./lib/heartbeat-write.js";
// T10 (KTD23/R45): a hook is a write-capable entry, so it runs the layout
// bootstrap itself. Fail-open wrapper over the canonical implementation.
import { ensureStorageLayout } from "./lib/ensure-layout.js";
// T10 (R36/KTD28/KTD30): the `verify.after_edit` adapter rung — native |
// wrapped | skip-recorded. Green is 0 tokens; a skip is a RECORDED loss.
import {
  VERIFY_CHECKS_FILENAME,
  runVerifyAfterEdit,
} from "./lib/verify-after-edit.js";
// T10 (KTD26): tool results crossing into T1/T0 are capped at 2000 tokens with
// the full bytes on disk.
import { truncateToolResultForParent } from "./lib/tool-result-truncate.js";
// T10 rework (KTD28 P2): a skip-recorded compaction rung has no PreCompact, so
// the tool path keeps its disk snapshot current on a bounded cadence.
import {
  rehydrateFromDisk,
  resolveCompactionRung,
  runRecordExists,
  snapshotIsStale,
  writeRehydrateHeartbeat,
} from "./lib/compaction-rehydrate.js";
// L5a: host-neutral hook payload + Claude emitter. PostToolUsePayload is now the
// shared `GuildHookEvent`; for Claude the emitter mapping is the identity, so the
// PostToolUse behavior is preserved byte-for-byte.
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";
import { emitTraceEvent, makeAnalysisTraceEvent } from "../src/modules/telemetry/index.js";
import { durableGuildDir } from "../src/domains/state";

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

/**
 * The tool result as it is allowed to travel.
 *
 * Two caps in a fixed order, and the order is the security half:
 *
 *  1. **Scrub** (D-SECRETS). Must come first, because step 2 writes the full
 *     bytes to the run tree — writing an unscrubbed 50k log to disk to satisfy
 *     a token budget would trade a context problem for a secrets leak.
 *  2. **Cap** (KTD26). A result at or over 2000 tokens becomes a ≤2000-token
 *     pointer; the scrubbed remainder lives at the path the pointer names.
 *
 * Step 2 is a BELT on an existing brace, and normally a no-op: redaction
 * already caps this field at the schema's 4 KiB (`FIELD_SIZE_CAP_BYTES`), which
 * is well inside 2000 tokens, so nothing that survives step 1 is big enough to
 * truncate here today. It is wired anyway because the KTD26 number is the one
 * this field is contractually bound to, and a later widening of the schema cap
 * should not silently widen what a lead's context sees. The seam where the cap
 * is load-bearing is the verify-fail stderr below and the exported
 * `truncateToolResultForParent` that T15 routes parent-bound results through.
 */
function resultExcerpt(
  payload: GuildHookEvent,
  policy: SecretsPolicy,
  cap: { runDir?: string; toolName: string; id: string },
): string {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return "";
  let raw: string;
  if (typeof resp === "string") raw = resp;
  else {
    try {
      raw = JSON.stringify(resp);
    } catch {
      return "";
    }
  }
  const scrub = applySecretsPolicy(raw, policy);
  const resolved = resolveTelemetryField(scrub, policy);
  if (resolved.warn) {
    process.stderr.write(
      `warn: [post-tool-use] result excerpt scrub degraded ` +
        `(fail_mode_telemetry=${policy.fail_mode_telemetry}).\n`,
    );
  }
  const scrubbed = resolved.value ?? "";
  if (scrubbed.length === 0) return "";
  return truncateToolResultForParent({
    text: scrubbed,
    toolName: cap.toolName,
    id: cap.id,
    ...(cap.runDir === undefined ? {} : { runDir: cap.runDir }),
  }).text;
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
      : path.join(durableGuildDir(guildRoot), "runs", effectiveRunId);
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
 * `GUILD_RUN_DIR`, honoured only when it is a non-empty ABSOLUTE path.
 *
 * A bare `??` accepts "" (an empty string is not nullish), and every write then
 * lands at a RELATIVE path under whatever cwd the hook inherited — observed
 * creating `rungs/` and `logs/` inside the repo from a test spawn. An unusable
 * override is treated as absent so the caller falls back to this root's own run
 * directory; a hook never writes outside the run tree it resolved.
 */
function runDirOverride(): string | undefined {
  const raw = process.env["GUILD_RUN_DIR"];
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return path.isAbsolute(raw) ? raw : undefined;
}

/**
 * R71 / C2: the active run is the run RECORD plus `GUILD_RUN_ID`.
 *
 * This used to fall back to the workspace-global `current-run-id` sentinel, and
 * that fallback was the C2 defect: a sentinel is interactive command INTAKE and
 * must never authorize a runtime write, because moving it mid-run redirects an
 * in-flight writer onto another run's log. The sentinel is not read here and is
 * never written anywhere — it is not recreated by any hook.
 */
function resolveRunId(): string | undefined {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return undefined;
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

  // ── T10 (KTD23): layout bootstrap on a write-capable entry ────────────────
  // This hook mutates durable state (event log, sidecar sweep, in-place scrub),
  // so it runs the bootstrap itself rather than assuming an earlier entry did.
  // On a current root this is a stat plus one marker read; the wrapper is
  // fail-open, so a refused root degrades to "no upgrade ran" and the hook
  // still exits 0.
  const layout = ensureStorageLayout(guildRoot, "post-tool-use");
  // KTD23 fails CLOSED on a layout this build does not understand: a future
  // marker means every write below would land in a root that is not ours.
  if (!layout.ok) {
    process.stderr.write(`warn: [post-tool-use] .guild layout refused (${layout.refused}) — no writes\n`);
    return;
  }

  // ── G-9 (SC-5): structured heartbeat write ────────────────────────────────
  // When GUILD_RUN_ID + GUILD_SPECIALIST are both exported (the dispatch path
  // sets them per lane), every PostToolUse refreshes the lane's structured
  // heartbeat at <runDir>/in-progress/<specialist>.json — the write side of
  // ADR-RE-3 that makes stall detection backend-agnostic (not tmux-only).
  // Fail-open by contract (writeHeartbeatFromEnv never throws) and near-zero
  // cost when the env vars are absent. Placed BEFORE the run-id gate: the
  // heartbeat keys off its own env contract, not the sentinel file.
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
    const earlyRunId = resolveRunId();
    const earlyRunIdSafe =
      typeof earlyRunId === "string" && earlyRunId.length > 0 && isSafeRunId(earlyRunId)
        ? earlyRunId
        : undefined;
    const earlyRunDir = earlyRunIdSafe
      ? (runDirOverride() ?? path.join(durableGuildDir(guildRoot), "runs", earlyRunIdSafe))
      : undefined;
    // oir-wi-57: GUILD_LANE_ID has no producer anywhere in this codebase — every
    // real dispatch backend (inprocess-backend.ts, tmux-backend.ts,
    // pane-adapter.ts) threads `GUILD_TASK_ID` into a dispatched lane's own
    // process env instead. resolveLaneAttribution tries GUILD_LANE_ID first,
    // then GUILD_TASK_ID — each independently validated, so a blank/unsafe
    // GUILD_LANE_ID never masks a valid GUILD_TASK_ID (round-5 fix; a bare
    // `??` would have silently done exactly that).
    const earlyLaneId = resolveLaneAttribution();
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

  // ── T10 (R36/R45/KTD28/KTD30): the `verify.after_edit` rung ───────────────
  // The INNER verify: after an edit lands, run the project's own check. Placed
  // BEFORE the run-id gate on purpose — an edit deserves its check whether or
  // not a Guild run is bound; the run directory only decides WHERE the verdict
  // is recorded, not whether the oracle runs.
  //
  // Three outcomes, and none of them is a silent pass:
  //   pass           nothing on stdout, nothing on stderr, 0 assistant tokens.
  //   fail           a KTD26-capped excerpt on stderr, full log on disk.
  //   skip-recorded  no declared check (or a host that states the rung is
  //                  absent) — written to the run tree as a recorded LOSS, so
  //                  the outer qa gate sees an unverified cell.
  if (toolName === "Write" || toolName === "Edit") {
    try {
      const durableDir = durableGuildDir(guildRoot);
      const verifyRunId = resolveRunId();
      const verifyRunDir =
        runDirOverride() ??
        (verifyRunId !== undefined && isSafeRunId(verifyRunId)
          ? path.join(durableDir, "runs", verifyRunId)
          : undefined);
      const outcome = runVerifyAfterEdit({
        configPath: path.join(durableDir, VERIFY_CHECKS_FILENAME),
        cwd: guildRoot,
        ...(verifyRunDir === undefined ? {} : { runDir: verifyRunDir }),
      });
      if (outcome.state === "fail" && outcome.stderr_excerpt.length > 0) {
        process.stderr.write(outcome.stderr_excerpt);
      }
    } catch (err) {
      // The rung's own contract is never-throw; this is the belt to that braces,
      // because a verify defect may not break the user's edit.
      process.stderr.write(
        `warn: [post-tool-use] verify.after_edit rung threw (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  // ── end verify.after_edit ────────────────────────────────────────────────

  // ── T10 rework (KTD28/R42 P2): skip-recorded compaction, from the tool path ─
  // KTD28 says a skip-recorded compaction rung still writes its disk files "each
  // heartbeat" — and the heartbeat cannot be PreCompact, because a skip-recorded
  // host is precisely one with no compaction event. So the snapshot a next
  // session rehydrates from is refreshed here, gated on a single `stat`: the
  // rehydrate reads five files and this path is budgeted at 250ms, so it runs at
  // most once every SNAPSHOT_MAX_AGE_MS rather than on every tool call.
  if (resolveCompactionRung(process.env) === "skip-recorded") {
    try {
      const snapRunId = resolveRunId();
      const snapRunDir =
        runDirOverride() ??
        (snapRunId !== undefined && isSafeRunId(snapRunId)
          ? path.join(durableGuildDir(guildRoot), "runs", snapRunId)
          : undefined);
      if (
        snapRunId !== undefined &&
        snapRunDir !== undefined &&
        runRecordExists(snapRunDir) &&
        snapshotIsStale(snapRunDir)
      ) {
        const snapshot = rehydrateFromDisk({
          runDir: snapRunDir,
          cwd: guildRoot,
          runId: snapRunId,
          rung: "skip-recorded",
          ...(process.env["GUILD_PHASE"] ? { phase: process.env["GUILD_PHASE"] } : {}),
          ...(process.env["GUILD_TASK_ID"] ? { logicalTaskId: process.env["GUILD_TASK_ID"] } : {}),
        });
        writeRehydrateHeartbeat(
          snapRunDir,
          snapshot,
          "compaction rung is skip-recorded; snapshot refreshed from the tool path",
        );
      }
    } catch (err) {
      process.stderr.write(
        `warn: [post-tool-use] compaction snapshot refresh failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  // ── end skip-recorded compaction ─────────────────────────────────────────

  const runId = resolveRunId();
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [post-tool-use] GUILD_RUN_ID unset — falling through (no tool_call emit).\n",
    );
    return;
  }
  if (!isSafeRunId(runId)) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_RUN_ID — falling through (no tool_call emit).\n",
    );
    return;
  }

  const runDir = runDirOverride() ?? path.join(durableGuildDir(guildRoot), "runs", runId);
  // Sidecar PAIRING key — MUST stay GUILD_LANE_ID-only, matching
  // hooks/pre-tool-use.ts's own resolution byte-for-byte (that file is a
  // sibling lane's and out of scope here). Broadening this to include
  // GUILD_TASK_ID would desync the Pre/Post lane_id used as part of the
  // sidecar match key (log-jsonl-sidecar.ts SidecarMatchKey), since
  // pre-tool-use.ts's own sidecar "pre" write would still key off
  // GUILD_LANE_ID alone — every real lane-worker call would then miss its
  // pairing, falling through as an orphaned pre-entry PLUS a degraded
  // post-only event (oir-wi-57 round-2 regression, caught by review).
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
  // oir-wi-57: the ATTRIBUTION stamped onto the FINAL emitted event's
  // lane_id — separate from the pairing key above. GUILD_TASK_ID is the
  // real per-lane env var every shipped dispatch backend actually threads
  // into a dispatched lane's own process (GUILD_LANE_ID has zero producers
  // anywhere in this codebase). resolveLaneAttribution evaluates each
  // candidate independently (round-5 fix: a bare `??` would let a blank/
  // unsafe GUILD_LANE_ID mask a valid GUILD_TASK_ID) and never leaves an
  // identified worker's event lane-less. Applied AFTER pairing/latency
  // computation below, so it never touches sidecar lookup/matching.
  const attributionLaneId = resolveLaneAttribution();
  const tsPost = new Date().toISOString();
  const secretsPolicy = readSecurityConfig(cwd).secrets_policy;

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
        result_excerpt_redacted: resultExcerpt(payload, secretsPolicy, {
          runDir,
          toolName,
          id: tsPost,
        }),
        ...(attributionLaneId !== undefined ? { lane_id: attributionLaneId } : {}),
        ...(typeof payload.duration_ms === "number"
          ? { latency_ms_override: payload.duration_ms }
          : {}),
      });
    } else {
      event = buildToolCallFromPair(pre, {
        ts_post: tsPost,
        run_id: runId,
        status: isOk(payload),
        result_excerpt_redacted: resultExcerpt(payload, secretsPolicy, {
          runDir,
          toolName,
          id: tsPost,
        }),
      });
      // oir-wi-57: buildToolCallFromPair otherwise inherits pre.lane_id (the
      // PRE sidecar's own GUILD_LANE_ID-only resolution, always absent in
      // production today) — override with the broader attribution AFTER
      // pairing so a real lane worker's paired event still carries it.
      if (attributionLaneId !== undefined) {
        event.lane_id = attributionLaneId;
      }
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
      actorId: attributionLaneId ?? "main",
      tokens,
    });
    // #58 — stamp the resolved specialist role on an Agent dispatch so post-hoc
    // audits can tell a real specialist lane from a bare generic agent (both
    // dispatch as subagent_type="general-purpose"). Resolved from the dispatch's
    // own tool_input (GUILD_SPECIALIST/GUILD_AGENT_DEFINITION env, else the
    // adoption prompt) — NOT process.env, which belongs to the lead, not the
    // dispatched lane.
    // Gated on isSpecialistLane: only a real specialist lane is attributed. An
    // ordinary generic call is left UNSTAMPED — stamping one would defeat the
    // very distinction the field exists to record.
    if (toolName === "Agent") {
      const attr = resolveDispatchAttribution(payload.tool_input);
      if (attr?.isSpecialistLane === true && attr.specialist !== undefined) {
        traceV2.attribution_specialist = attr.specialist;
      }
    }
    appendEvent(runDir, event, { traceV2 });
    const common = {
      run_id: runId,
      lane_id: attributionLaneId ?? "",
      actor_type: "tool" as const,
      actor_id: toolName,
      span_id: traceV2.span_id,
      parent_span_id: traceV2.parent_span_id,
      phase: process.env["GUILD_PHASE"] || undefined,
      task_id: process.env["GUILD_TASK_ID"] || undefined,
      config_snapshot_ref: fs.existsSync(path.join(runDir, "plugin-config-snapshot.json"))
        ? "plugin-config-snapshot.json"
        : undefined,
    };
    const startedMs = Math.max(0, Date.parse(tsPost) - event.latency_ms);
    emitTraceEvent(
      makeAnalysisTraceEvent({
        ...common,
        ts: new Date(startedMs).toISOString(),
        event_class: "tool_call_started",
        status: "ok",
      }),
      runDir,
    );
    emitTraceEvent(
      makeAnalysisTraceEvent({
        ...common,
        ts: tsPost,
        event_class: event.status === "err" ? "tool_call_failed" : "tool_call_finished",
        status: event.status === "err" ? "error" : event.status === "n/a" ? "unknown" : "ok",
        duration_ms: event.latency_ms,
        tokens,
      }),
      runDir,
    );
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
