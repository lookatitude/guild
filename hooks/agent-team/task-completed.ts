#!/usr/bin/env -S npx tsx
/**
 * hooks/agent-team/task-completed.ts
 *
 * Event:   TaskCompleted
 * Purpose:
 *   1. Validates a `guild.handoff.v2` envelope in the agent's handoff receipt,
 *      extracting `learnings[]` into the run record under
 *      `.guild/runs/<run-id>/learnings/<specialist>-<task-id>.json`.
 *   2. Rejects (exit non-zero) if the envelope is invalid or fails the
 *      lint/bloat check (SC-7 / VC-7).
 *   3. For backwards compatibility, also checks that the markdown receipt at
 *      `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` exists and
 *      has the §8.2 required sections (changed_files, opens_for, assumptions,
 *      evidence, followups).
 *   4. Persists the run-state checkpoint (`guild.run_state.v1`, ADR-RE-1) at
 *      `.guild/runs/<run-id>/run-state.json`: after the lane terminates it
 *      upserts `lanes[task-id]` with the terminal status (done / failed),
 *      depends_on (best-effort from the payload), the receipt pointer, and the
 *      resolved tier. Atomic temp-then-rename under the per-run `.lock`
 *      discipline (see hooks/lib/run-state.ts — contract bound by pointer). The
 *      `in_progress` transition is DISPATCH-owned (the agent-team launcher, via
 *      `markLaneInProgress`); there is no "TaskStarted" hook event. The
 *      checkpoint is a rebuildable speed-cache (never the system of record), so
 *      a write failure here is non-fatal — the receipt remains authoritative.
 *   5. Signals §task§agent dismiss (no idle): on a clean pass the agent
 *      terminates — no idle agents persist (ADR §6 D3).
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
 * Run ID derivation: GUILD_RUN_ID env var (set by launcher) OR "run-<session_id>".
 *
 * Manual usage:
 *   echo '{"hook_event_name":"TaskCompleted","task_id":"task-001","session_id":"sess-abc123",
 *          "cwd":"/path/to/project","teammate_name":"backend","team_name":"guild"}' \
 *     | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx hooks/agent-team/task-completed.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveGuildRoot } from "../lib/guild-root.js";
import { validateHandoffV2, HandoffV2 } from "../lib/handoff-v2.js";
import {
  upsertLane,
  LaneStatus,
  LaneTier,
  LanePatch,
  RunStateInit,
} from "../lib/run-state.js";

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
 * §8.2 required fields that every handoff receipt markdown must contain.
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
 * path). Falls back to "run-<session_id>" otherwise.
 */
function deriveRunId(sessionId: string): string {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}

/**
 * Locate the handoff receipt markdown for specialist+task in the run directory.
 * Path: <guild-root>/.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md
 */
function receiptPath(guildRoot: string, runId: string, specialist: string, taskId: string): string {
  return path.join(guildRoot, ".guild", "runs", runId, "handoffs", `${specialist}-${taskId}.md`);
}

/**
 * Locate the learnings output path for the run record.
 * Path: <guild-root>/.guild/runs/<run-id>/learnings/<specialist>-<task-id>.json
 */
function learningsPath(
  guildRoot: string,
  runId: string,
  specialist: string,
  taskId: string
): string {
  return path.join(guildRoot, ".guild", "runs", runId, "learnings", `${specialist}-${taskId}.json`);
}

/**
 * Check whether a markdown receipt contains all required §8.2 sections.
 * Accepts markdown heading form (## changed_files) or label form (changed_files:).
 */
function missingFields(content: string): string[] {
  return REQUIRED_FIELDS.filter((field) => {
    const pattern = new RegExp(`(?:^##?\\s+${field}\\b|^${field}\\s*:)`, "im");
    return !pattern.test(content);
  });
}

/**
 * Extract `guild.handoff.v2` envelope from a markdown receipt if present.
 * Looks for a fenced JSON block tagged with `guild.handoff.v2`.
 *
 * ```guild.handoff.v2
 * { ... }
 * ```
 *
 * Returns the parsed value or null if no such block is found.
 */
function extractHandoffEnvelope(content: string): unknown | null {
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/;
  const match = pattern.exec(content);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Write learnings from a valid `guild.handoff.v2` envelope into the run record.
 * Silently skips if no learnings are present.
 */
function persistLearnings(
  envelope: HandoffV2,
  outPath: string,
  specialist: string,
  taskId: string
): void {
  if (!envelope.learnings || envelope.learnings.length === 0) return;

  const record = {
    schema_version: "guild.learnings.v1",
    task_id: taskId,
    specialist,
    tier: envelope.tier,
    timestamp: new Date().toISOString(),
    learnings: envelope.learnings,
  };

  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  process.stderr.write(`[task-completed] learnings persisted to ${outPath}\n`);
}

/**
 * Best-effort extraction of inlined `depends-on: <id>` references from the
 * payload text (mirrors task-created.ts). Used to mirror the plan lane's gating
 * edges into the run-state checkpoint when no launcher-seeded value exists.
 */
function extractDependsOn(text: string): string[] {
  const matches = text.matchAll(/depends[\s-]on:\s*([^\s,;]+)/gi);
  return Array.from(matches, (m) => m[1].trim());
}

/**
 * Map the terminal `guild.handoff.v2` status onto a `guild.run_state.v1` lane
 * status. A clean `done` is `done`; any other terminal disposition (`blocked`,
 * `escalate`) or a legacy receipt with no envelope is recorded conservatively.
 */
function laneStatusFor(envelopeStatus: HandoffV2["status"] | null): LaneStatus {
  if (envelopeStatus === null) return "done"; // legacy receipt passed validation
  return envelopeStatus === "done" ? "done" : "failed";
}

/**
 * Derive the top-level run identity for a fresh checkpoint. Existing top-level
 * fields are preserved by upsertLane; these defaults only apply on first write.
 * Honors launcher-exported env (GUILD_PLAN_SLUG / GUILD_PROGRAM_ID /
 * GUILD_WAVE_INDEX) when present.
 */
function deriveRunStateInit(runId: string): RunStateInit {
  const planSlug = process.env["GUILD_PLAN_SLUG"];
  const programId = process.env["GUILD_PROGRAM_ID"];
  const waveRaw = process.env["GUILD_WAVE_INDEX"];
  const waveIndex = waveRaw !== undefined ? Number.parseInt(waveRaw, 10) : NaN;
  return {
    runId,
    planSlug: planSlug && planSlug.trim() !== "" ? planSlug : undefined,
    programId: programId && programId.trim() !== "" ? programId : null,
    waveIndex: Number.isFinite(waveIndex) ? waveIndex : undefined,
  };
}

/**
 * Persist the terminal lane state into run-state.json (ADR-RE-1). NON-FATAL:
 * the checkpoint is a rebuildable cache, never the system of record — a write
 * failure is logged and swallowed so it never blocks a clean completion.
 */
function persistRunState(
  runDir: string,
  runId: string,
  specialist: string,
  taskId: string,
  status: LaneStatus,
  tier: LaneTier | undefined,
  dependsOn: string[]
): void {
  try {
    const patch: LanePatch = {
      status,
      receipt_ref: path.join("handoffs", `${specialist}-${taskId}.md`),
    };
    if (tier !== undefined) patch.tier = tier;
    // Only set depends_on when we actually found edges; otherwise preserve any
    // launcher-seeded value (upsertLane keeps the prior array on undefined).
    if (dependsOn.length > 0) patch.depends_on = dependsOn;

    upsertLane(runDir, deriveRunStateInit(runId), taskId, patch);
    process.stderr.write(
      `[task-completed] run-state checkpoint updated: lane "${taskId}" → ${status} ` +
        `(${runStatePathHint(runDir)}).\n`
    );
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: run-state checkpoint write failed (non-fatal, ` +
        `rebuildable cache): ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

function runStatePathHint(runDir: string): string {
  return path.join(runDir, "run-state.json");
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

  const guildRoot = resolveGuildRoot(cwd);
  const runId = deriveRunId(sessionId);
  const runDir = path.join(guildRoot, ".guild", "runs", runId);
  const rPath = receiptPath(guildRoot, runId, specialist, taskId);

  // ── Check receipt exists ───────────────────────────────────────────────────
  if (!fs.existsSync(rPath)) {
    die(
      `Task "${taskId}" (specialist: "${specialist}") has no handoff receipt. ` +
        `Expected at: ${rPath}\n` +
        `Write the receipt with sections: ${REQUIRED_FIELDS.join(", ")} before marking complete.`
    );
  }

  const content = fs.readFileSync(rPath, "utf8");

  // ── Check §8.2 required markdown fields ───────────────────────────────────
  const missing = missingFields(content);
  if (missing.length > 0) {
    die(
      `Task "${taskId}" receipt at "${rPath}" is missing required §8.2 fields: ` +
        `[${missing.join(", ")}]. ` +
        `Add the missing sections before marking complete.`
    );
  }

  // ── Validate guild.handoff.v2 envelope if present ─────────────────────────
  const rawEnvelope = extractHandoffEnvelope(content);
  let envelopeStatus: HandoffV2["status"] | null = null;
  let laneTier: LaneTier | undefined;
  if (rawEnvelope !== null) {
    const { valid, errors } = validateHandoffV2(rawEnvelope);
    if (!valid) {
      die(
        `Task "${taskId}" receipt at "${rPath}" contains an invalid guild.handoff.v2 envelope.\n` +
          `Validation errors (SC-7 lint):\n` +
          errors.map((e) => `  - ${e}`).join("\n")
      );
    }
    // Extract learnings into run record (§6 D3 Extract phase)
    const envelope = rawEnvelope as HandoffV2;
    envelopeStatus = envelope.status;
    laneTier = envelope.tier;
    const lPath = learningsPath(guildRoot, runId, specialist, taskId);
    persistLearnings(envelope, lPath, specialist, taskId);

    process.stderr.write(
      `[task-completed] OK: task "${taskId}" envelope validated (tier: ${envelope.tier}, ` +
        `status: ${envelope.status}).\n`
    );
  } else {
    process.stderr.write(
      `[task-completed] NOTE: no guild.handoff.v2 envelope found in receipt — ` +
        `validation skipped (envelope optional for legacy receipts).\n`
    );
  }

  // ── Persist run-state checkpoint (ADR-RE-1) — lane has terminated ─────────
  // Non-fatal: run-state is a rebuildable cache, the receipt is authoritative.
  const laneStatus = laneStatusFor(envelopeStatus);
  const dependsOn = extractDependsOn(`${payload.task_subject ?? ""} ${payload.task_description ?? ""}`);
  persistRunState(runDir, runId, specialist, taskId, laneStatus, laneTier, dependsOn);

  // §task§agent dismiss: agent terminates cleanly here (no idle, D3 §6).
  process.stderr.write(
    `[task-completed] OK: task "${taskId}" receipt verified at "${rPath}". Agent dismissed.\n`
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[task-completed] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
