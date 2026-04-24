#!/usr/bin/env -S npx tsx
/**
 * hooks/agent-team/task-created.ts
 *
 * Event:   TaskCreated
 * Purpose: Validates a task BEFORE it enters the agent-team shared queue.
 *          Blocks creation (exit non-zero) if:
 *            1. No owner specialist assigned (teammate_name is empty/missing).
 *            2. Output contract missing (task_description is absent/empty).
 *            3. depends-on: references in the task_subject/description point
 *               to task IDs that don't exist in the run's plan file at
 *               .guild/plan/<slug>.md  (best-effort: if no plan file exists
 *               the deps check is skipped with a warning).
 *          Exits 0 (pass-through) when:
 *            - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is unset or not "1" (opt-in gate).
 *            - The task passes all three validations.
 *
 * Stdin:   JSON — Claude Code TaskCreated hook payload:
 *   {
 *     "session_id": string,
 *     "cwd": string,
 *     "hook_event_name": "TaskCreated",
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
 * Manual usage:
 *   echo '{"hook_event_name":"TaskCreated","task_id":"t1","task_subject":"Build auth","task_description":"Add JWT login","teammate_name":"backend","team_name":"guild","session_id":"s1","cwd":"/path/to/project"}' \
 *     | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx hooks/agent-team/task-created.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ── Types ──────────────────────────────────────────────────────────────────

interface TaskCreatedPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function die(reason: string): never {
  process.stderr.write(`[task-created] BLOCKED: ${reason}\n`);
  process.exit(1);
}

function warn(msg: string): void {
  process.stderr.write(`[task-created] WARN: ${msg}\n`);
}

/** Extract all "depends-on: <id>" references from a string */
function extractDependsOn(text: string): string[] {
  const matches = text.matchAll(/depends[\s-]on:\s*([^\s,;]+)/gi);
  return Array.from(matches, (m) => m[1].trim());
}

/** Return all task IDs found in a plan markdown file (lines like "- task-001:" or "id: task-001") */
function loadPlanTaskIds(cwd: string): Set<string> | null {
  // Look for any .guild/plan/*.md
  const planDir = path.join(cwd, ".guild", "plan");
  if (!fs.existsSync(planDir)) return null;
  const files = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return null;

  const ids = new Set<string>();
  for (const file of files) {
    const content = fs.readFileSync(path.join(planDir, file), "utf8");
    // Match patterns: `id: task-001`, `- task-001:`, `task_id: task-001`, `**task-001**`
    const patterns = [
      /\bid:\s*(task-[\w-]+)/gi,
      /^\s*[-*]\s*(task-[\w-]+):/gim,
      /task_id:\s*(task-[\w-]+)/gi,
      /\*\*(task-[\w-]+)\*\*/gi,
    ];
    for (const re of patterns) {
      for (const m of content.matchAll(re)) {
        ids.add(m[1].toLowerCase());
      }
    }
  }
  return ids.size > 0 ? ids : null;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Opt-in gate: agent-team backend must be explicitly enabled
  const agentTeamEnabled = process.env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1";
  if (!agentTeamEnabled) {
    // No-op: feature not enabled
    process.exit(0);
  }

  // Read JSON payload from stdin
  const rl = readline.createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const raw = lines.join("\n").trim();

  let payload: TaskCreatedPayload;
  try {
    payload = JSON.parse(raw) as TaskCreatedPayload;
  } catch {
    die(`Invalid JSON on stdin: ${raw.slice(0, 120)}`);
  }

  const taskId = payload.task_id ?? "(unknown)";
  const subject = payload.task_subject ?? "";
  const description = payload.task_description ?? "";
  const owner = (payload.teammate_name ?? "").trim();
  const cwd = payload.cwd ?? process.cwd();

  // ── Validation 1: owner must be assigned ──────────────────────────────────
  if (!owner) {
    die(
      `Task "${taskId}" has no owner specialist assigned (teammate_name is empty). ` +
        `Assign a specialist before queueing this task.`
    );
  }

  // ── Validation 2: output contract (description/scope) must be present ─────
  const combinedText = `${subject} ${description}`.trim();
  if (!description.trim()) {
    die(
      `Task "${taskId}" is missing an output contract. ` +
        `Provide a task_description with success criteria or scope before queueing.`
    );
  }

  // ── Validation 3: depends-on references must exist in plan ────────────────
  const deps = extractDependsOn(combinedText);
  if (deps.length > 0) {
    const planIds = loadPlanTaskIds(cwd);
    if (planIds === null) {
      warn(
        `Task "${taskId}" has depends-on references [${deps.join(", ")}] ` +
          `but no plan file found at ${path.join(cwd, ".guild/plan/")}. Skipping dependency check.`
      );
    } else {
      const missing = deps.filter((d) => !planIds.has(d.toLowerCase()));
      if (missing.length > 0) {
        die(
          `Task "${taskId}" has depends-on references to unknown task IDs: [${missing.join(", ")}]. ` +
            `Ensure those tasks exist in the plan before adding dependencies.`
        );
      }
    }
  }

  // All validations passed
  process.stderr.write(
    `[task-created] OK: task "${taskId}" owned by "${owner}" passed all validations.\n`
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[task-created] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
