/**
 * hooks/lib/heartbeat-write.ts
 *
 * G-9 (SC-5) — the WRITE side of the structured liveness heartbeat
 * (ADR-RE-3). `hooks/lib/heartbeat.ts` is the read side (readHeartbeat /
 * assessLiveness); until this module landed, the write side did not exist
 * and stall detection was tmux-only (pane-alive + TeammateIdle mtime
 * fallback). With it, EVERY PostToolUse on EVERY backend rung (team /
 * agent / subagent) refreshes `<runDir>/in-progress/<specialist>.json` —
 * backend-agnostic liveness.
 *
 * Trigger contract:
 *   - Fires ONLY when env GUILD_RUN_ID and GUILD_SPECIALIST are BOTH set
 *     (the dispatch path exports them per lane). When either is absent the
 *     call is near-zero-cost: two env reads, no fs touch.
 *   - T3b rework F2: the write additionally requires the COMPLETE verified
 *     hook binding envelope (GUILD_RUN_ID + GUILD_RUN_BINDING_REF, verified
 *     via authorizeHookWrite against the run's minted binding) BEFORE any
 *     filesystem touch — absent/blank/closed/mismatched refs refuse with
 *     reason "binding_rejected:<reason>" and create no heartbeat and no
 *     temp file. GUILD_RUN_ID + GUILD_SPECIALIST alone never authorize.
 *   - Record shape mirrors EXACTLY what readHeartbeat() parses:
 *       { timestamp: <ISO now>, step: env GUILD_STEP || null,
 *         last_action: <tool_name from the hook payload> }
 *     (readHeartbeat ignores non-string step/last_action, so `null` is a
 *     safe "unset" marker.)
 *   - Atomic: temp + rename — a reader never observes a partial file.
 *   - Fail-open: NEVER throws; a write failure must never break the tool
 *     call (PostToolUse exits 0 regardless).
 *
 * Caller: hooks/post-tool-use.ts (PostToolUse, matcher `*`).
 * Tests:  hooks/__tests__/heartbeat-write.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "./guild-root.js";
import { heartbeatPath } from "./heartbeat.js";
import { authorizeHookWrite, type HookWriteAuth } from "./hook-binding.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** The record this module writes — the readHeartbeat()-parsable shape. */
export interface HeartbeatWriteRecord {
  /** ISO-8601 write timestamp (the liveness signal). */
  timestamp: string;
  /** Phase/step label from env GUILD_STEP; null when unset. */
  step: string | null;
  /** Tool name from the PostToolUse hook payload; null when unknown. */
  last_action: string | null;
}

/** Outcome of a writeHeartbeatFromEnv call (diagnostic, never throws). */
export interface HeartbeatWriteResult {
  written: boolean;
  /** Final heartbeat path when written; null otherwise. */
  path: string | null;
  /** Why nothing was written ("env-absent" is the cheap fast-path). */
  reason: string | null;
}

// ── Id hygiene ──────────────────────────────────────────────────────────────

/**
 * Conservative path-component allowlist: the run id and specialist name are
 * both used as filesystem path segments, so anything with separators,
 * traversal dots, or exotic characters is refused (fail-open: no write).
 */
const SAFE_PATH_COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSafePathComponent(id: string): boolean {
  return SAFE_PATH_COMPONENT_RE.test(id) && id !== "." && id !== "..";
}

// ── Atomic write ─────────────────────────────────────────────────────────────

/**
 * Atomically write a heartbeat record to
 * `<runDir>/in-progress/<specialist>.json` (temp sibling + rename — rename
 * is atomic on a single filesystem, so readers never see a partial file).
 * Throws on I/O failure — writeHeartbeatFromEnv wraps it fail-open.
 *
 * T3b rework F2: accepts ONLY a pre-verified HookWriteAuth — a non-ok
 * verdict throws before any fs touch, so no caller can reach the atomic
 * writer without the run's verified binding envelope.
 */
export function writeHeartbeat(
  auth: HookWriteAuth,
  runDir: string,
  specialist: string,
  record: HeartbeatWriteRecord
): string {
  // `!== true` literal comparison — the test runners compile non-strict,
  // where truthiness narrowing of a boolean discriminant does not apply.
  if (auth.ok !== true) {
    throw new Error(
      `binding_rejected (${auth.reason}): heartbeat write refused for run ` +
        `${auth.run_id ?? "<unresolved>"} — no verified binding envelope.`
    );
  }
  const finalPath = heartbeatPath(runDir, specialist);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath); // never leave a partial temp behind
    } catch {
      /* best-effort */
    }
    throw err;
  }
  return finalPath;
}

// ── Env-gated entry (the PostToolUse seam) ──────────────────────────────────

export interface WriteHeartbeatFromEnvOpts {
  /** Tool name from the PostToolUse payload (becomes last_action). */
  toolName?: string;
  /** Starting cwd for guild-root resolution (default process.cwd()). */
  cwd?: string;
  /** Env seam for tests (default process.env). */
  env?: Record<string, string | undefined>;
  /** Clock seam for tests (default Date.now-based ISO). */
  now?: () => string;
}

/**
 * G-9: write the structured heartbeat when (and only when) GUILD_RUN_ID and
 * GUILD_SPECIALIST are both set AND the complete binding envelope
 * (GUILD_RUN_ID + GUILD_RUN_BINDING_REF) verifies against the run's minted
 * binding (T3b rework F2 — verified BEFORE any fs write). Resolution of the
 * run dir mirrors post-tool-use.ts: GUILD_RUN_DIR wins; else
 * `<resolveGuildRoot(cwd)>/.guild/runs/<GUILD_RUN_ID>`.
 *
 * NEVER throws (fail-open by contract — a heartbeat failure must not break
 * the tool call). Near-zero-cost when the env vars are absent.
 */
export function writeHeartbeatFromEnv(
  opts: WriteHeartbeatFromEnvOpts = {}
): HeartbeatWriteResult {
  try {
    const env = opts.env ?? process.env;
    const runId = env["GUILD_RUN_ID"];
    const specialist = env["GUILD_SPECIALIST"];
    // Fast path: both env vars must be present + non-empty. No fs I/O here.
    if (typeof runId !== "string" || runId.length === 0) {
      return { written: false, path: null, reason: "env-absent" };
    }
    if (typeof specialist !== "string" || specialist.length === 0) {
      return { written: false, path: null, reason: "env-absent" };
    }
    if (!isSafePathComponent(runId) || !isSafePathComponent(specialist)) {
      return { written: false, path: null, reason: "unsafe-id" };
    }

    // T3b rework F2: verify the COMPLETE binding envelope before the run-dir
    // path is even computed. The nonce must be caller-presented in the env
    // (GUILD_RUN_BINDING_REF) and verify against the run's minted binding —
    // GUILD_RUN_ID + GUILD_SPECIALIST alone never authorize a write.
    const root = resolveGuildRoot(opts.cwd ?? process.cwd());
    const auth = authorizeHookWrite(root, {
      runId,
      env: env as Record<string, string | undefined>,
    });
    if (auth.ok !== true) {
      return { written: false, path: null, reason: `binding_rejected:${auth.reason}` };
    }

    const envRunDir = env["GUILD_RUN_DIR"];
    const runDir =
      typeof envRunDir === "string" && envRunDir.length > 0
        ? envRunDir
        : path.join(root, ".guild", "runs", runId);

    const step = env["GUILD_STEP"];
    const record: HeartbeatWriteRecord = {
      timestamp: opts.now ? opts.now() : new Date().toISOString(),
      step: typeof step === "string" && step.length > 0 ? step : null,
      last_action:
        typeof opts.toolName === "string" && opts.toolName.length > 0
          ? opts.toolName
          : null,
    };

    const finalPath = writeHeartbeat(auth, runDir, specialist, record);
    return { written: true, path: finalPath, reason: null };
  } catch (err) {
    // Fail-open: report, never throw.
    return {
      written: false,
      path: null,
      reason: `write-failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
