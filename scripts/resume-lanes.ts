#!/usr/bin/env -S npx tsx
/**
 * scripts/resume-lanes.ts
 *
 * R-016 resume READ seam — the consumer that closes the writer-without-reader gap.
 *
 * `markLaneDead` (hooks/lib/run-state.ts) WRITES per-lane `resume.json` checkpoints
 * at `<runDir>/lanes/<laneId>/resume.json` when a lane exhausts its retry budget and
 * `defaults.resume.enabled` is true. Before this CLI, NOTHING read them back. This CLI
 * scans the checkpoints, applies the version guard (loadLaneResumeCheckpoint) +
 * the `defaults.resume.enabled` filter, joins each lane's resolved `tier` from
 * run-state, and prints the resumable dead lanes so the guild:execute-plan
 * "## Resuming dead lanes" prose (triggered by commands/resume.md) re-enters each one.
 *
 * One writer (markLaneDead), one reader (this CLI) — symmetric with mark-lane-dead.ts.
 *
 * Usage (invoked by the resume prose in guild:execute-plan):
 *   npx tsx scripts/resume-lanes.ts <runDir> [--json] [--cwd <repo-root>]
 *
 * Output (--json): a BARE JSON ARRAY, one object per resumable dead lane:
 *   [{ lane_id, attempts, last_error?, last_attempt_at, resumable_at, tier? }, ...]
 *   - Field names are snake_case, verbatim from LaneResumeCheckpoint, PLUS `tier`
 *     joined from run-state `lanes[lane_id].tier` (the checkpoint alone lacks it).
 *   - Sorted by lane_id (deterministic re-entry order).
 *   - Empty array when nothing is resumable OR defaults.resume.enabled is false.
 * Default (human): a readable table.
 *
 * FILTERING (CLI-side, mirrors mark-lane-dead.ts so the skill prose stays simple):
 *   - schema_version guard (guild.lane_resume.v1) via loadLaneResumeCheckpoint.
 *   - defaults.resume.enabled=false ⇒ emit an empty list (resume disabled project-wide).
 *
 * SEMANTICS NOTE: a resumed dead lane gets a FRESH max_attempts budget (the prior
 * `attempts` count is preserved in the checkpoint for AUDIT/display only — it is NOT
 * subtracted). This CLI only REPORTS `attempts`; the re-entry budget is applied by
 * the execute-plan prose via loadRetryOpts on re-dispatch.
 *
 * Exit: 0 on any readable runDir (empty list = success); 1 only on missing-runDir
 *       usage error. Corrupt / wrong-version checkpoints are skipped tolerantly.
 *
 * Contract pointers:
 *   - LaneResumeCheckpoint + loadLaneResumeCheckpoint + readResumeEnabled + loadRunState:
 *     hooks/lib/run-state.ts (the version-guarded readers — single source of truth).
 *   - writer: scripts/mark-lane-dead.ts → markLaneDead. ledger: R-016; OD-5 in decisions.md.
 */

import * as fs from "fs";
import * as path from "path";
import {
  loadLaneResumeCheckpoint,
  loadRunState,
  readResumeEnabled,
  type LaneResumeCheckpoint,
} from "../hooks/lib/run-state";

// ── Output type ─────────────────────────────────────────────────────────────

/** A resumable dead lane: the checkpoint fields + the run-state-joined tier. */
export interface ResumableLane extends LaneResumeCheckpoint {
  /** Resolved tier from run-state lanes[lane_id].tier. Absent if run-state lacks it. */
  tier?: string;
}

// ── Parsed args ───────────────────────────────────────────────────────────────

export interface ResumeLanesArgs {
  runDir: string;
  json: boolean;
  /** Repo root for the defaults.resume.enabled read. Defaults to runDir's repo root. */
  cwd?: string;
}

export function parseResumeLanesArgs(
  argv: string[]
): ResumeLanesArgs | { error: string } {
  const positionals: string[] = [];
  let json = false;
  let cwd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--cwd" && argv[i + 1] !== undefined) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  const [runDir] = positionals;
  if (!runDir) {
    return { error: "usage: resume-lanes.ts <runDir> [--json] [--cwd <repo-root>]" };
  }
  return { runDir, json, cwd };
}

// ── Repo-root resolution (mirrors mark-lane-dead.ts) ────────────────────────

/** `.guild/runs/<run-id>` → repo root is three levels up. */
function repoRootFromRunDir(runDir: string): string {
  return path.resolve(runDir, "..", "..", "..");
}

// ── Core scan (pure read; tolerant) ─────────────────────────────────────────

/**
 * Scan `<runDir>/lanes/*\/resume.json`, applying the version-guarded reader to each
 * and joining the resolved `tier` from run-state. Returns the valid checkpoints
 * sorted by lane_id. Corrupt / wrong-version / missing entries are skipped.
 *
 * Respects `defaults.resume.enabled`: when false (read from `cwd`), returns an
 * empty list — resume is disabled project-wide so nothing is offered for re-entry.
 *
 * Never throws.
 */
export function scanResumableLanes(runDir: string, cwd?: string): ResumableLane[] {
  // CLI-side resume.enabled filter (mirrors mark-lane-dead.ts's write-side gate).
  const repoRoot = cwd ?? repoRootFromRunDir(runDir);
  if (!readResumeEnabled(repoRoot)) {
    return []; // resume disabled → nothing resumable
  }

  const lanesDir = path.join(runDir, "lanes");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(lanesDir, { withFileTypes: true });
  } catch {
    return []; // no lanes/ dir → nothing to resume
  }

  // Join source: run-state lanes[<lane_id>].tier (may be absent).
  const runState = loadRunState(runDir); // null when absent/corrupt — tolerated below.

  const out: ResumableLane[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const laneId = entry.name;
    // loadLaneResumeCheckpoint applies the schema_version guard + JSON-parse tolerance.
    const cp = loadLaneResumeCheckpoint(runDir, laneId);
    if (!cp) continue;

    const tier = runState?.lanes?.[laneId]?.tier;
    out.push(tier !== undefined ? { ...cp, tier } : { ...cp });
  }

  // Deterministic resume order.
  out.sort((a, b) => a.lane_id.localeCompare(b.lane_id));
  return out;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderHuman(runDir: string, lanes: ResumableLane[]): string {
  if (lanes.length === 0) {
    return `[resume-lanes] no resumable dead lanes in ${runDir}\n`;
  }
  const rows: string[] = [
    `[resume-lanes] ${lanes.length} resumable dead lane(s) in ${runDir}:`,
    `  ${"LANE".padEnd(28)} ${"TIER".padEnd(9)} ${"ATTEMPTS".padEnd(9)} LAST_ERROR`,
    `  ${"─".repeat(28)} ${"─".repeat(9)} ${"─".repeat(9)} ${"─".repeat(40)}`,
  ];
  for (const c of lanes) {
    const err = (c.last_error ?? "").slice(0, 60).replace(/\n/g, " ");
    rows.push(
      `  ${c.lane_id.padEnd(28)} ${(c.tier ?? "—").padEnd(9)} ${String(c.attempts).padEnd(9)} ${err}`
    );
  }
  return rows.join("\n") + "\n";
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

function main(): void {
  const parsed = parseResumeLanesArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[resume-lanes] ${parsed.error}\n`);
    process.exit(1);
  }

  const lanes = scanResumableLanes(parsed.runDir, parsed.cwd);

  if (parsed.json) {
    // BARE JSON ARRAY (team-lead's confirmed consume shape for the resume prose).
    process.stdout.write(JSON.stringify(lanes, null, 2) + "\n");
  } else {
    process.stdout.write(renderHuman(parsed.runDir, lanes));
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}
