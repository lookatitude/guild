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
 *   (decision bound by pointer). The verdict is `age(timestamp) < timeout`,
 *   where the timeout is the configurable `defaults.heartbeat_timeout_ms`
 *   (default 600000 = 10 min, preserving the prior threshold). BACKWARD-COMPAT:
 *   when the JSON record is absent, fall back to the legacy <teammate>.log
 *   mtime (no hard cutover).
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
import { assessLiveness, readHeartbeatTimeoutMs, Liveness } from "../lib/heartbeat.js";

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
  pendingTaskIds: string[];
  runDir: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function deriveRunId(sessionId: string): string {
  // GUILD_RUN_ID honored when the agent-team launcher sets it per pane; else
  // fallback to "run-<session_id>". Same convention as task-completed.ts,
  // capture-telemetry.ts, maybe-reflect.ts.
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}

/**
 * Find all handoff receipts already written for this teammate in this run.
 */
function findCompletedTaskIds(runDir: string, teammate: string): Set<string> {
  const handoffsDir = path.join(runDir, "handoffs");
  if (!fs.existsSync(handoffsDir)) return new Set();
  const prefix = `${teammate}-`;
  return new Set(
    fs
      .readdirSync(handoffsDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
      .map((f) => f.slice(prefix.length, -".md".length))
  );
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
 * Compose a clear, actionable nudge message for the orchestrator. Includes the
 * structured-heartbeat liveness verdict so the orchestrator can distinguish a
 * fast-iterating agent from a genuine stall.
 */
function composeNudge(ctx: NudgeContext): string {
  const timestamp = new Date().toISOString();
  const livenessLine = renderLiveness(ctx.liveness);

  if (ctx.pendingTaskIds.length > 0) {
    return (
      `[TeammateIdle ${timestamp}] ` +
      `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ` +
      `${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].\n` +
      `${livenessLine}\n` +
      `Action required: ${ctx.teammate} should either\n` +
      `  1. Write a handoff receipt at ` +
      `${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md with sections: ` +
      `changed_files, opens_for, assumptions, evidence, followups — then mark the task complete.\n` +
      `  2. Or, if still working, update the structured heartbeat at ` +
      `${ctx.runDir}/in-progress/${ctx.teammate}.json ` +
      `({ timestamp, step, pct_complete, last_action }) to signal progress.\n`
    );
  }

  // No assigned tasks found in plan (or plan absent) — conservative nudge
  return (
    `[TeammateIdle ${timestamp}] ` +
    `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.\n` +
    `${livenessLine}\n` +
    `If you have an active task, please write a handoff receipt or update your ` +
    `structured heartbeat to signal progress. Receipt path: ` +
    `${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md\n` +
    `Heartbeat path: ${ctx.runDir}/in-progress/${ctx.teammate}.json ` +
    `({ timestamp, step, pct_complete, last_action }).\n` +
    `Required receipt sections: changed_files, opens_for, assumptions, evidence, followups.\n` +
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

  // Gather context
  const completedIds = findCompletedTaskIds(runDir, teammate);
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = completedIds.size > 0;

  // Liveness via the structured heartbeat (ADR-RE-3), mtime fallback baked in.
  const timeoutMs = readHeartbeatTimeoutMs(cwd);
  const liveness = assessLiveness(runDir, teammate, timeoutMs);

  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] ` +
      `completed=[${[...completedIds].join(",")}] pending=[${pendingTaskIds.join(",")}] ` +
      `liveness=${liveness.source}/${liveness.fresh ? "fresh" : "stale"} ` +
      `ageMs=${liveness.ageMs ?? "n/a"} timeoutMs=${timeoutMs}\n`
  );

  const ctx: NudgeContext = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    liveness,
    pendingTaskIds,
    runDir,
  };

  // Emit nudge to stdout (orchestrator consumes it)
  process.stdout.write(composeNudge(ctx));

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
