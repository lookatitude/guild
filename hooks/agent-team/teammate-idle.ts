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
 * Staleness check (P4 — conservative variant):
 *   A teammate is considered stale if ANY assigned task lacks a handoff
 *   receipt at .guild/runs/<run-id>/handoffs/<teammate>-<task-id>.md.
 *
 *   This handler also computes an in-progress-log freshness signal at
 *   .guild/runs/<run-id>/in-progress/<teammate>.log (STALE_THRESHOLD_MS
 *   window) and includes it in the nudge payload for orchestrator context,
 *   but does NOT currently gate the nudge on it — the stronger
 *   "stale = no receipt AND no active log" rule is a deliberate P5 refinement
 *   (needs telemetry to avoid false-positive nudges against fast-iterating
 *   teammates). Today: nudge on any pending task; document activity context.
 *
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

// ── Constants ──────────────────────────────────────────────────────────────

/** 10 minutes — in-progress log older than this is considered stale */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

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
  hasActiveLog: boolean;
  pendingTaskIds: string[];
  runDir: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function deriveRunId(sessionId: string): string {
  return `run-${sessionId}`;
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
  const planDir = path.join(cwd, ".guild", "plan");
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
 * Check if the in-progress log for a teammate is recent (active).
 */
function hasActiveProgressLog(runDir: string, teammate: string): boolean {
  const logPath = path.join(runDir, "in-progress", `${teammate}.log`);
  if (!fs.existsSync(logPath)) return false;
  const stat = fs.statSync(logPath);
  return Date.now() - stat.mtimeMs < STALE_THRESHOLD_MS;
}

/**
 * Compose a clear, actionable nudge message for the orchestrator.
 */
function composeNudge(ctx: NudgeContext): string {
  const timestamp = new Date().toISOString();

  if (ctx.pendingTaskIds.length > 0) {
    return (
      `[TeammateIdle ${timestamp}] ` +
      `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ` +
      `${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].\n` +
      `Action required: ${ctx.teammate} should either\n` +
      `  1. Write a handoff receipt at ` +
      `${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md with sections: ` +
      `changed_files, opens_for, assumptions, evidence, followups — then mark the task complete.\n` +
      `  2. Or, if still working, update the in-progress log at ` +
      `${ctx.runDir}/in-progress/${ctx.teammate}.log to signal activity.\n`
    );
  }

  // No assigned tasks found in plan (or plan absent) — conservative nudge
  return (
    `[TeammateIdle ${timestamp}] ` +
    `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.\n` +
    `If you have an active task, please write a handoff receipt or update your ` +
    `in-progress log to signal activity. Receipt path: ` +
    `${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md\n` +
    `Required sections: changed_files, opens_for, assumptions, evidence, followups.\n` +
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
  const runDir = path.join(cwd, ".guild", "runs", runId);

  // Gather context
  const completedIds = findCompletedTaskIds(runDir, teammate);
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = completedIds.size > 0;
  const hasActiveLog = hasActiveProgressLog(runDir, teammate);

  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] ` +
      `completed=[${[...completedIds].join(",")}] pending=[${pendingTaskIds.join(",")}] ` +
      `activeLog=${hasActiveLog}\n`
  );

  const ctx: NudgeContext = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    hasActiveLog,
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
