#!/usr/bin/env -S npx tsx
/**
 * hooks/agent-team/task-completed.ts
 *
 * Event:   TaskCompleted
 * Purpose: Blocks task completion (exit non-zero) unless the specialist has
 *          written a handoff receipt at:
 *            .guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md
 *          The receipt must contain ALL five §8.2 required sections:
 *            - changed_files
 *            - opens_for
 *            - assumptions
 *            - evidence
 *            - followups
 *          Exits 0 when:
 *            - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is unset or not "1" (opt-in gate).
 *            - The receipt exists and has all required fields.
 *
 * Stdin:   JSON — Claude Code TaskCompleted hook payload:
 *   {
 *     "session_id": string,
 *     "cwd": string,
 *     "hook_event_name": "TaskCompleted",
 *     "task_id": string,
 *     "task_subject": string,
 *     "task_description"?: string,
 *     "teammate_name"?: string,
 *     "team_name"?: string
 *   }
 *
 * Stdout:  Silent (Claude Code may consume stdout).
 * Stderr:  Human-readable reason if blocking.
 *
 * Run ID derivation: "run-<session_id>" — kept simple so task-created,
 * task-completed, and teammate-idle all agree on the path.
 *
 * Manual usage:
 *   echo '{"hook_event_name":"TaskCompleted","task_id":"task-001","session_id":"sess-abc123","cwd":"/path/to/project","teammate_name":"backend","team_name":"guild"}' \
 *     | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx hooks/agent-team/task-completed.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ── Types ──────────────────────────────────────────────────────────────────

interface TaskCompletedPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * §8.2 required fields that every handoff receipt must contain.
 * Keys must appear as markdown headings or YAML-style labels.
 */
const REQUIRED_FIELDS: ReadonlyArray<string> = [
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function die(reason: string): never {
  process.stderr.write(`[task-completed] BLOCKED: ${reason}\n`);
  process.exit(1);
}

/**
 * Derive run ID. Honors GUILD_RUN_ID env var if set (agent-team launcher
 * exports it per pane so hooks converge on the launcher's session manifest
 * path). Falls back to "run-<session_id>" otherwise — consistent across all
 * three agent-team handlers + capture-telemetry + maybe-reflect.
 */
function deriveRunId(sessionId: string): string {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}

/**
 * Locate the handoff receipt for specialist+task in the run directory.
 * Path: <cwd>/.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md
 */
function receiptPath(cwd: string, runId: string, specialist: string, taskId: string): string {
  return path.join(cwd, ".guild", "runs", runId, "handoffs", `${specialist}-${taskId}.md`);
}

/**
 * Check whether the receipt markdown contains all required sections.
 * Accepts either markdown heading form (## changed_files) or
 * label form (changed_files:) — case-insensitive.
 */
function missingFields(content: string): string[] {
  return REQUIRED_FIELDS.filter((field) => {
    const pattern = new RegExp(
      `(?:^##?\\s+${field}\\b|^${field}\\s*:)`,
      "im"
    );
    return !pattern.test(content);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Opt-in gate
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

  let payload: TaskCompletedPayload;
  try {
    payload = JSON.parse(raw) as TaskCompletedPayload;
  } catch {
    die(`Invalid JSON on stdin: ${raw.slice(0, 120)}`);
  }

  const sessionId = payload.session_id ?? "unknown";
  const taskId = payload.task_id ?? "(unknown)";
  const specialist = (payload.teammate_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();

  const runId = deriveRunId(sessionId);
  const rPath = receiptPath(cwd, runId, specialist, taskId);

  // ── Check receipt exists ───────────────────────────────────────────────────
  if (!fs.existsSync(rPath)) {
    die(
      `Task "${taskId}" (specialist: "${specialist}") has no handoff receipt. ` +
        `Expected at: ${rPath}\n` +
        `Write the receipt with sections: ${REQUIRED_FIELDS.join(", ")} before marking complete.`
    );
  }

  // ── Check all required fields are present ─────────────────────────────────
  const content = fs.readFileSync(rPath, "utf8");
  const missing = missingFields(content);
  if (missing.length > 0) {
    die(
      `Task "${taskId}" receipt at "${rPath}" is missing required §8.2 fields: ` +
        `[${missing.join(", ")}]. ` +
        `Add the missing sections before marking complete.`
    );
  }

  process.stderr.write(
    `[task-completed] OK: task "${taskId}" receipt verified at "${rPath}".\n`
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[task-completed] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
