#!/usr/bin/env -S npx tsx
/**
 * hooks/agent-team/teammate-idle.ts
 *
 * Event:   TeammateIdle
 * Purpose: Nudges an idle teammate whose assigned task is still incomplete.
 *          Reads run state and plan to identify staleness, then emits an
 *          actionable nudge message to stdout (the orchestrator consumes it).
 *          NEVER exits non-zero — no exit-code gating.
 *
 * Liveness check (ADR-RE-3 — structured heartbeat; replaces the mtime heuristic):
 *   A teammate is considered to have pending work if ANY assigned task lacks a
 *   handoff receipt at .guild/runs/<run-id>/handoffs/<teammate>-<task-id>.md.
 *
 *   Liveness ("is the agent still making progress?") is now read from a
 *   STRUCTURED heartbeat at .guild/runs/<run-id>/in-progress/<teammate>.json
 *   ({ timestamp, step, pct_complete, last_action }) — see hooks/lib/heartbeat.ts
 *   (decision bound by pointer). The verdict is `age(timestamp) < timeout`.
 *   G-10 (SC-5): the timeout is TIER-SCALED — the lane's tier from the
 *   run-state lane record picks the built-in default (cheap 180000 / mid
 *   600000 / powerful 1200000; unresolvable tier → mid, preserving the prior
 *   600000 threshold). An EXPLICITLY-SET `defaults.heartbeat_timeout_ms`
 *   always wins over the tier map (byte-identical for configs that set it).
 *   BACKWARD-COMPAT: when the JSON record is absent, fall back to the legacy
 *   <teammate>.log mtime (no hard cutover).
 *
 *   SCOPE BOUNDARY: this heartbeat is LIVENESS/stall detection only. It is NOT
 *   the deferred O-3 "anomalously short output" quality-escalation heuristic
 *   (cost-aware-tiering-and-lean-context.md O-3 → DEFER) — distinct signal,
 *   left deferred. Nothing here inspects output length or quality.
 *
 *   The nudge surfaces the heartbeat phase + staleness for orchestrator
 *   context but (P5 refinement, still deferred) does NOT yet gate the nudge on
 *   liveness — today: nudge on any pending task; report the liveness verdict.
 *   If the plan file (.guild/plan/*.md) or run state directory don't exist,
 *   the nudge is still emitted — conservative default.
 *
 * Stdin:   JSON — Claude Code TeammateIdle hook payload:
 *   {
 *     "session_id": string,
 *     "cwd": string,
 *     "hook_event_name": "TeammateIdle",
 *     "teammate_name"?: string,
 *     "team_name"?: string
 *   }
 *
 * Stdout:  Nudge message (consumed by the orchestrator).
 * Stderr:  Diagnostic info (never consumed by Claude Code).
 *
 * Manual usage:
 *   echo '{"hook_event_name":"TeammateIdle","teammate_name":"backend","team_name":"guild","session_id":"sess-abc123","cwd":"/path/to/project"}' \
 *     | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx hooks/agent-team/teammate-idle.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveGuildRoot } from "../lib/guild-root.js";
import { validateHandoffV2, extractHandoffEnvelope } from "../lib/handoff-v2.js";
import {
  assessLiveness,
  resolveHeartbeatTimeoutMs,
  resolveLaneTier,
  Liveness,
} from "../lib/heartbeat.js";
import { emitBusEvent } from "../lib/bus-emit.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface TeammateIdlePayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  teammate_name?: string;
  team_name?: string;
}

interface NudgeContext {
  teammate: string;
  teamName: string;
  runId: string;
  hasReceipt: boolean;
  /** Structured liveness verdict (ADR-RE-3): heartbeat → mtime fallback. */
  liveness: Liveness;
  /** Task IDs that have NO receipt file. */
  pendingTaskIds: string[];
  /**
   * Task IDs whose receipt exists but contains no valid guild.handoff.v2 envelope.
   * A2 (P1-2): receipt-present + envelope-valid is the deterministic dismissal signal.
   * The launcher (P1-3) keys off [LANE-COMPLETE]/safe-to-dismiss in the nudge output.
   */
  invalidReceiptTaskIds: string[];
  /** Task IDs whose receipt exists and has a valid guild.handoff.v2 envelope. */
  validReceiptTaskIds: string[];
  /** Full assessments for valid receipts (carries receiptPath + envelopeStatus). */
  validReceipts: ReceiptAssessment[];
  runDir: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function deriveRunId(sessionId: string): string {
  // GUILD_RUN_ID honored when the agent-team launcher sets it per pane; else
  // fallback to "run-<session_id>". Same convention as task-completed.ts,
  // capture-telemetry.ts, maybe-reflect.ts.
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}

/** Per-receipt validity verdict used to build the nudge context. */
interface ReceiptAssessment {
  taskId: string;
  receiptPath: string;
  /** True iff the receipt contains a valid guild.handoff.v2 envelope. */
  envelopeValid: boolean;
  envelopeErrors: string[];
  /** Status from the validated envelope (present only when envelopeValid is true). */
  envelopeStatus?: string;
}

/**
 * Assess all handoff receipts already written for this teammate in this run.
 *
 * For each receipt file found at `<runDir>/handoffs/<teammate>-<task-id>.md`:
 *   - Extract the guild.handoff.v2 envelope (if present).
 *   - Validate it via validateHandoffV2.
 *   - Record valid/invalid verdict.
 *
 * A receipt with no envelope is recorded as invalid: the single-channel
 * protocol (R4a/P1-2) requires the envelope; a missing envelope means the
 * teammate has not yet completed the handoff.
 */
function assessReceipts(runDir: string, teammate: string): ReceiptAssessment[] {
  const handoffsDir = path.join(runDir, "handoffs");
  if (!fs.existsSync(handoffsDir)) return [];
  const prefix = `${teammate}-`;
  const results: ReceiptAssessment[] = [];
  const files = fs
    .readdirSync(handoffsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".md"));

  for (const file of files) {
    const taskId = file.slice(prefix.length, -".md".length);
    const rPath = path.join(handoffsDir, file);
    let envelopeValid = false;
    let envelopeErrors: string[] = [];
    let envelopeStatus: string | undefined;
    try {
      const content = fs.readFileSync(rPath, "utf8");
      const rawEnvelope = extractHandoffEnvelope(content);
      if (rawEnvelope !== null) {
        const result = validateHandoffV2(rawEnvelope);
        envelopeValid = result.valid;
        envelopeErrors = result.errors;
        if (result.valid) {
          const env = rawEnvelope as Record<string, unknown>;
          envelopeStatus = typeof env["status"] === "string" ? env["status"] : undefined;
        }
      } else {
        envelopeErrors = ["no guild.handoff.v2 envelope found in receipt"];
      }
    } catch (err) {
      envelopeErrors = [
        `could not read receipt: ${err instanceof Error ? err.message : String(err)}`,
      ];
    }
    results.push({ taskId, receiptPath: rPath, envelopeValid, envelopeErrors, envelopeStatus });
  }
  return results;
}

/**
 * Find task IDs assigned to this teammate in any plan file.
 */
function findAssignedTaskIds(cwd: string, teammate: string): string[] {
  const planDir = path.join(resolveGuildRoot(cwd), ".guild", "plan");
  if (!fs.existsSync(planDir)) return [];
  const files = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  const ids: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(planDir, file), "utf8");
    // Look for assignment patterns: "owner: <teammate>" or "assigned: <teammate>"
    // near a task ID line
    const blocks = content.split(/\n(?=[-*#]|\w)/);
    for (const block of blocks) {
      const isAssigned =
        new RegExp(`(?:owner|assigned|teammate):\\s*${teammate}\\b`, "i").test(block);
      if (isAssigned) {
        const idMatch = block.match(/\bid:\s*(task-[\w-]+)/i) ??
          block.match(/^\s*[-*]\s*(task-[\w-]+):/im);
        if (idMatch) ids.push(idMatch[1]);
      }
    }
  }
  return ids;
}

/**
 * Render the structured liveness verdict (ADR-RE-3) as a one-line context
 * string for the nudge. Surfaces the heartbeat phase + age, or the mtime
 * fallback, or "no heartbeat".
 */
function renderLiveness(liveness: Liveness): string {
  if (liveness.source === "none") {
    return `liveness: no heartbeat or progress log found (cannot confirm activity)`;
  }
  const ageSec = liveness.ageMs !== null ? Math.round(liveness.ageMs / 1000) : "?";
  const freshness = liveness.fresh ? "FRESH (active)" : "STALE (possible stall)";
  if (liveness.source === "heartbeat") {
    const phase = liveness.step ? ` phase="${liveness.step}"` : "";
    const pct = liveness.pctComplete !== undefined ? ` ${liveness.pctComplete}%` : "";
    return `liveness: heartbeat ${freshness}, last progress ${ageSec}s ago${phase}${pct}`;
  }
  return `liveness: legacy log mtime ${freshness}, last touched ${ageSec}s ago (no structured heartbeat)`;
}

/**
 * Compose a clear, actionable nudge message for the orchestrator.
 *
 * R4a (P1-2) single-channel enforcement:
 *
 *   • LANE-COMPLETE / safe-to-dismiss — emitted when the teammate has a valid
 *     guild.handoff.v2 receipt for every known task and has no pending work.
 *     The launcher (P1-3) keys off the "[LANE-COMPLETE]" sentinel to dismiss
 *     the pane (A2 deterministic dismissal signal).
 *
 *   • Specific receipt nudge — emitted when tasks have no receipt or the
 *     receipt lacks a valid guild.handoff.v2 envelope.  Includes the EXACT
 *     canonical path and "do not paste it in chat" to enforce the
 *     single-channel rule (R1/R2 — file receipt is the source of truth).
 *
 *   • Conservative nudge — emitted when no plan file exists and no receipts
 *     have been written; includes the canonical path template and the
 *     single-channel reminder.
 *
 * The structured-heartbeat liveness verdict (ADR-RE-3) is always included so
 * the orchestrator can distinguish a fast-iterating agent from a genuine stall.
 */
function composeNudge(ctx: NudgeContext): string {
  const timestamp = new Date().toISOString();
  const livenessLine = renderLiveness(ctx.liveness);

  const hasPending = ctx.pendingTaskIds.length > 0;
  const hasInvalid = ctx.invalidReceiptTaskIds.length > 0;
  const hasValid = ctx.validReceiptTaskIds.length > 0;

  // ── A2: deterministic dismissal signal ─────────────────────────────────────
  // Receipt present + valid envelope = safe-to-dismiss.  The launcher (P1-3)
  // keys off the [LANE-COMPLETE] sentinel.  Always exit-0 — non-gating.
  if (hasValid && !hasPending && !hasInvalid) {
    const receipts = ctx.validReceipts.map((r) => r.receiptPath).join(", ");
    const pointerLines = ctx.validReceipts
      .map(
        (r) =>
          `done · ${r.taskId} · status:${r.envelopeStatus ?? "done"} · receipt:${r.receiptPath}`
      )
      .join("\n");
    const dismissLines = ctx.validReceipts
      .map(
        (r) =>
          `[AUTO-DISMISS] teammate="${ctx.teammate}" team="${ctx.teamName}" reason=valid-receipt task=${r.taskId}`
      )
      .join("\n");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `[LANE-COMPLETE] teammate="${ctx.teammate}" team="${ctx.teamName}" ` +
      `status=safe-to-dismiss\n` +
      `${livenessLine}\n` +
      `Valid guild.handoff.v2 receipt(s) confirmed: ${receipts}\n` +
      `${pointerLines}\n` +
      `${dismissLines}\n` +
      `The launcher may safely dismiss this pane.\n`
    );
  }

  // ── R4a: missing receipt — specific, actionable nudge ──────────────────────
  if (hasPending) {
    const paths = ctx.pendingTaskIds
      .map((tid) => `${ctx.runDir}/handoffs/${ctx.teammate}-${tid}.md`)
      .join(", ");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ` +
      `${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].\n` +
      `${livenessLine}\n` +
      `write your guild.handoff.v2 receipt to ${paths}; do not paste it in chat.\n` +
      `Required sections: changed_files, opens_for, assumptions, evidence, followups.\n` +
      `Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):\n` +
      `\`\`\`guild.handoff.v2\n` +
      `{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }\n` +
      `\`\`\`\n` +
      `Or, if still working, update the structured heartbeat at ` +
      `${ctx.runDir}/in-progress/${ctx.teammate}.json ` +
      `({ timestamp, step, pct_complete, last_action }) to signal progress.\n`
    );
  }

  // ── R4a: receipt exists but envelope missing/invalid ───────────────────────
  if (hasInvalid) {
    const paths = ctx.invalidReceiptTaskIds
      .map((tid) => `${ctx.runDir}/handoffs/${ctx.teammate}-${tid}.md`)
      .join(", ");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") has a receipt but the ` +
      `guild.handoff.v2 envelope is missing or invalid.\n` +
      `${livenessLine}\n` +
      `write your guild.handoff.v2 receipt to ${paths}; do not paste it in chat.\n` +
      `Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):\n` +
      `\`\`\`guild.handoff.v2\n` +
      `{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }\n` +
      `\`\`\`\n`
    );
  }

  // ── Conservative nudge: no plan, no receipts ───────────────────────────────
  // Use GUILD_TASK_ID env var (set by the launcher) for a more specific path.
  const taskIdHint = process.env["GUILD_TASK_ID"] ?? "<task-id>";
  return (
    `[TeammateIdle ${timestamp}] ` +
    `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.\n` +
    `${livenessLine}\n` +
    `If you have an active task, write your guild.handoff.v2 receipt to ` +
    `${ctx.runDir}/handoffs/${ctx.teammate}-${taskIdHint}.md; do not paste it in chat.\n` +
    `Required sections: changed_files, opens_for, assumptions, evidence, followups.\n` +
    `Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):\n` +
    `\`\`\`guild.handoff.v2\n` +
    `{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }\n` +
    `\`\`\`\n` +
    `Heartbeat path: ${ctx.runDir}/in-progress/${ctx.teammate}.json ` +
    `({ timestamp, step, pct_complete, last_action }).\n` +
    `If all tasks are complete, no action is needed.\n`
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Opt-in gate — but always exits 0
  const agentTeamEnabled = process.env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1";
  if (!agentTeamEnabled) {
    process.exit(0);
  }

  // Read JSON payload from stdin
  const rl = readline.createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const raw = lines.join("\n").trim();

  let payload: TeammateIdlePayload;
  try {
    payload = JSON.parse(raw) as TeammateIdlePayload;
  } catch {
    process.stderr.write(`[teammate-idle] WARN: Invalid JSON on stdin: ${raw.slice(0, 120)}\n`);
    // Always exits 0 — no gating
    process.exit(0);
  }

  const sessionId = payload.session_id ?? "unknown";
  const teammate = (payload.teammate_name ?? "").trim() || "unknown";
  const teamName = (payload.team_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();

  const runId = deriveRunId(sessionId);
  const runDir = path.join(resolveGuildRoot(cwd), ".guild", "runs", runId);

  // Gather context — assess receipt validity first (R4a).
  const receiptAssessments = assessReceipts(runDir, teammate);
  const validReceiptTaskIds = receiptAssessments
    .filter((r) => r.envelopeValid)
    .map((r) => r.taskId);
  const invalidReceiptTaskIds = receiptAssessments
    .filter((r) => !r.envelopeValid)
    .map((r) => r.taskId);
  const completedIds = new Set(receiptAssessments.map((r) => r.taskId));
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = receiptAssessments.length > 0;

  // Liveness via the structured heartbeat (ADR-RE-3), mtime fallback baked in.
  // G-10 (SC-5): tier-scaled timeout — lane tier from the run-state lane
  // record (cheap 3m / mid 10m / powerful 20m); an EXPLICIT
  // defaults.heartbeat_timeout_ms in settings.json still wins when set, and
  // an unresolvable tier falls back to mid (byte-identical to the old default).
  const laneTier = resolveLaneTier(runDir, teammate, assignedIds);
  const timeoutMs = resolveHeartbeatTimeoutMs(cwd, laneTier);
  const liveness = assessLiveness(runDir, teammate, timeoutMs);

  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] ` +
      `validReceipts=[${validReceiptTaskIds.join(",")}] ` +
      `invalidReceipts=[${invalidReceiptTaskIds.join(",")}] ` +
      `pending=[${pendingTaskIds.join(",")}] ` +
      `liveness=${liveness.source}/${liveness.fresh ? "fresh" : "stale"} ` +
      `ageMs=${liveness.ageMs ?? "n/a"} timeoutMs=${timeoutMs} ` +
      `tier=${laneTier ?? "unresolved(mid-fallback)"}\n`
  );

  const validReceipts = receiptAssessments.filter((r) => r.envelopeValid);

  const ctx: NudgeContext = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    liveness,
    pendingTaskIds,
    invalidReceiptTaskIds,
    validReceiptTaskIds,
    validReceipts,
    runDir,
  };

  // Emit nudge to stdout (orchestrator consumes it)
  process.stdout.write(composeNudge(ctx));

  // Emit idle bus event (SK-5 / CMD-007: agent-bus producer). Best-effort — never blocks.
  emitBusEvent(runDir, {
    run_id: runId,
    event: "idle",
    lane_id: teammate,
    team_name: teamName !== "unknown" ? teamName : undefined,
    detail: ctx.pendingTaskIds.length > 0
      ? `pending tasks: [${ctx.pendingTaskIds.join(", ")}]`
      : undefined,
  });

  // Always exit 0 — no exit-code gating
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[teammate-idle] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  // Always exits 0 — no gating
  process.exit(0);
});
