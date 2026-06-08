/**
 * hooks/lib/security/scrubbed-write.ts
 *
 * HK-06 — the SINGLE durable-write choke-point (D-SECRETS).
 *
 * CONTRACT:
 *   docs/v2/11-security.md §D-SECRETS (L171-184)
 *   .guild/initiatives/active/drift-remediation/contracts/
 *     wave2-hk06-secrets-scrub-coverage.md
 *
 * Every durable `.guild/` write in the plugin calls `scrubbedWrite` instead
 * of `fs.writeFileSync`. This guarantees:
 *   1. Built-in 5-group redaction (redactField, always runs) + operator
 *      custom patterns (applySecretsPolicy) applied to content BEFORE write.
 *   2. Fail-mode split enforced:
 *        durable surfaces (handoff/learnings/provenance/wiki/review/bus)
 *          → `fail_mode_durable` (default "closed") — on scrub failure the
 *            write is BLOCKED: file does NOT land on disk.
 *        telemetry surface (logs/*.jsonl)
 *          → `fail_mode_telemetry` (default "open") — on scrub failure the
 *            write proceeds with built-in-redacted value + warning.
 *   3. On fail-CLOSED: `secret_scrub_blocked` security event emitted and
 *      `approval_request` written to agent-bus so a human can decide.
 *   4. For `surface: "bus"`: sha256 is computed over the SCRUBBED bytes
 *      (never the raw bytes) and returned to the caller.
 *
 * ── INVARIANTS ────────────────────────────────────────────────────────────
 * - No raw secret value is ever placed in a security event, warning, or log.
 *   The `detail` field is pre-scrubbed by buildSecurityEvent (redactField).
 * - The function NEVER throws — callers must not be disrupted by I/O failures
 *   in the scrub infrastructure. Errors → stderr + safe return value.
 *
 * ── DERIVE guildRoot ──────────────────────────────────────────────────────
 * runDir = <guildRoot>/.guild/runs/<runId>, so guildRoot is 3 levels up.
 * This derivation is deterministic given the canonical runDir structure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { applySecretsPolicy } from "./secrets.js";
import { readSecurityConfig } from "./config.js";
import { buildSecurityEvent, appendSecurityEvent } from "./events.js";

// Re-export applySecretsPolicy for use in the approval_request inline scrub
// (to avoid circular dependency — writeScrubApprovalRequest is called from
// within scrubbedWrite, so it cannot recursively call scrubbedWrite itself).
// The inline scrub uses applySecretsPolicy directly with fail-OPEN semantics:
// even on custom-pattern failure, the built-in-redacted value is written so
// the approval_request always lands as a notification channel.

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Write-surface classification per D-SECRETS.
 *
 * Durable surfaces (fail-CLOSED by default):
 *   handoff    → runs/<id>/handoffs/
 *   learnings  → runs/<id>/learnings/
 *   provenance → runs/<id>/provenance.json
 *   wiki       → .guild/wiki/**
 *   review     → runs/<id>/review/
 *   bus        → runs/<id>/bus/** (+ sha256 after scrub)
 *
 * Local gitignored (fail-OPEN by default):
 *   telemetry  → runs/<id>/logs/*.jsonl
 */
export type ScrubSurface =
  | "handoff"
  | "learnings"
  | "provenance"
  | "config"        // resolved-settings.json (config snapshot — distinct from provenance.json)
  | "wiki"
  | "review"
  | "bus"
  | "telemetry";

export interface ScrubbedWriteResult {
  /** Whether the file was written to disk. */
  written: boolean;
  /** Whether the write was blocked (fail-CLOSED). */
  blocked: boolean;
  /**
   * SHA-256 hex digest of the SCRUBBED content, only for surface="bus".
   * sha256(stored) === sha256(scrubbed) — content-addressed integrity.
   */
  sha256?: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Derive the guild root from a canonical runDir.
 * runDir = <guildRoot>/.guild/runs/<runId>  →  up 3 levels.
 */
function guildRootFromRunDir(runDir: string): string {
  return path.resolve(runDir, "../../..");
}

/**
 * Write a `guild.approval_request.v1` to the agent-bus approvals directory.
 * Best-effort — never throws; a write failure is swallowed silently.
 * (The security event is the authoritative record; the approval_request is
 * the human-escalation channel.)
 *
 * Exported so callers that implement their own scrub paths (e.g.,
 * task-completed.ts / scrubHandoffReceipt) can emit the same always-ask
 * notification without duplicating the record format.
 */
export function writeScrubApprovalRequest(
  runDir: string,
  runId: string,
  surface: ScrubSurface,
  outPath: string,
  laneId?: string,
): void {
  try {
    const approvalDir = path.join(runDir, "agent-bus", "approvals");
    fs.mkdirSync(approvalDir, { recursive: true });
    const ts = new Date().toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record: Record<string, unknown> = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" — write blocked. Human review required. Path: ${path.basename(outPath)}`,
      permission_mode: "blocked",
      surface,
    };
    if (laneId) record["lane_id"] = laneId;

    // HK-06 (bus surface — inline scrub, fail-OPEN):
    // Do NOT call scrubbedWrite here — this function is invoked FROM within
    // scrubbedWrite (fail-CLOSED path), so recursion would be infinite.
    // Instead, apply applySecretsPolicy inline. Fail-OPEN: the approval_request
    // is a notification channel; even on custom-pattern failure, we write the
    // built-in-redacted content so the notification always lands.
    const rawContent = JSON.stringify(record, null, 2) + "\n";
    let content = rawContent;
    try {
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir));
      const scrubResult = applySecretsPolicy(rawContent, secConfig.secrets_policy);
      // Always use the scrubbed value (built-ins always run; ok or not).
      content = scrubResult.value;
    } catch {
      // best-effort: if policy read fails, write raw (built-ins did not run)
    }
    fs.writeFileSync(path.join(approvalDir, fileName), content, "utf8");
  } catch {
    // best-effort — swallow silently to avoid disrupting the gate decision
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scrub-then-write. The SINGLE durable-write choke-point (D-SECRETS, HK-06).
 *
 * Call this INSTEAD of `fs.writeFileSync` for every `.guild/` write that
 * could carry operator-sensitive content (handoffs, learnings, provenance,
 * wiki, review, bus artifacts, telemetry logs).
 *
 * @param outPath  Absolute path to write.
 * @param content  The raw string content to scrub-then-write.
 * @param opts     Surface classification, run identity, and lane identity.
 * @returns        { written, blocked, sha256? }
 */
export function scrubbedWrite(
  outPath: string,
  content: string,
  opts: {
    surface: ScrubSurface;
    runDir: string;
    runId: string;
    laneId?: string;
  },
): ScrubbedWriteResult {
  // ── 1. Read secrets policy ────────────────────────────────────────────────
  const guildRoot = guildRootFromRunDir(opts.runDir);
  let policy;
  try {
    const secConfig = readSecurityConfig(guildRoot);
    policy = secConfig.secrets_policy;
  } catch {
    // readSecurityConfig never throws by contract, but be safe
    policy = {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed" as const,
      fail_mode_telemetry: "open" as const,
    };
  }

  // ── 2. Apply scrubber ─────────────────────────────────────────────────────
  const scrubResult = applySecretsPolicy(content, policy);

  // ── 3. Decide fail mode ───────────────────────────────────────────────────
  const failMode =
    opts.surface === "telemetry" ? policy.fail_mode_telemetry : policy.fail_mode_durable;

  // ── 4. Route on scrub result + fail mode ─────────────────────────────────

  if (scrubResult.ok) {
    // ── Happy path: scrub succeeded → write scrubbed content ─────────────
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: write failed for surface "${opts.surface}" at ${outPath}: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
      return { written: false, blocked: false };
    }
    const result: ScrubbedWriteResult = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }

  // ── Scrub had failures (ok=false) ─────────────────────────────────────────

  if (failMode === "open") {
    // ── Fail-OPEN (telemetry default): write built-in-redacted value + warn ─
    process.stderr.write(
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" ` +
        `at ${path.basename(outPath)} — writing built-in-redacted content (fail-open). ` +
        `Failures: ${scrubResult.failures.join("; ")}\n`,
    );
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: fail-open write failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return { written: false, blocked: false };
    }
    // Emit degraded security event (best-effort)
    try {
      const evt = buildSecurityEvent({
        run_id: opts.runId,
        lane_id: opts.laneId,
        event_type: "secret_scrub_blocked",
        decision: "degraded",
        tool: "scrubbedWrite",
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path.basename(outPath)}. Built-in-redacted content written.`,
        permission_mode: "degraded",
      });
      appendSecurityEvent(opts.runDir, evt);
    } catch {
      // best-effort
    }
    const result: ScrubbedWriteResult = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }

  // ── Fail-CLOSED (durable default): DO NOT write — block the write ─────────
  //
  // INVARIANT: outPath must NOT exist after this function returns (unless it
  // existed before with prior content). We do not write, no temp file, no rename.

  process.stderr.write(
    `[scrubbed-write] BLOCKED: secret scrub failed for durable surface "${opts.surface}" ` +
      `at ${outPath} — file NOT written. Failures: ${scrubResult.failures.join("; ")}\n`,
  );

  // Emit blocked security event (best-effort)
  try {
    const evt = buildSecurityEvent({
      run_id: opts.runId,
      lane_id: opts.laneId,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "scrubbedWrite",
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path.basename(outPath)} — write blocked (fail-closed).`,
      permission_mode: "blocked",
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
    // best-effort
  }

  // Write approval_request to agent-bus (always-ask channel) — best-effort
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);

  return { written: false, blocked: true };
}
