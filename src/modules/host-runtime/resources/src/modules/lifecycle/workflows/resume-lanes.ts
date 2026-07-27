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
} from "./run-state";
import { readPlanTaskIdSet } from "../../teams";

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
  /**
   * Plan slug for lane_id validation. The caller (execute-plan) knows the slug and
   * should pass it; falls back to run-state `plan_slug` when omitted.
   */
  slug?: string;
}

export function parseResumeLanesArgs(
  argv: string[]
): ResumeLanesArgs | { error: string } {
  const positionals: string[] = [];
  let json = false;
  let cwd: string | undefined;
  let slug: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--cwd" && argv[i + 1] !== undefined) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (arg === "--slug" && argv[i + 1] !== undefined) slug = argv[++i];
    else if (arg.startsWith("--slug=")) slug = arg.slice("--slug=".length);
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  const [runDir] = positionals;
  if (!runDir) {
    return { error: "usage: resume-lanes.ts <runDir> [--json] [--cwd <repo-root>] [--slug <slug>]" };
  }
  return { runDir, json, cwd, slug };
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
export function scanResumableLanes(runDir: string, cwd?: string, slug?: string): ResumableLane[] {
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

  // READER-SIDE LANE-KEY VALIDATION (R-016 r4 MAJOR-A/B): the reader is the single
  // guarantor that only checkpoints whose lane_id is a REAL plan task-id are offered
  // as resumable. This catches EVERY bad-key source — the [specName] fallback, an
  // orphan specialist with zero plan lanes, or a parser miss — so execute-plan (which
  // re-enters by lane_id) is never handed a key it can't map back to a plan lane.
  //
  // The plan task-id set is the authority. Slug resolution: caller-supplied --slug
  // (execute-plan knows it) → run-state.plan_slug fallback. When the plan IS resolvable
  // (non-empty task-id set) we OMIT any checkpoint whose lane_id is not in it (with a
  // stderr note — never silent). When the plan is genuinely unresolvable (empty set:
  // no slug / no plan file) we cannot validate, so we skip validation rather than
  // drop every valid lane — the write-side task-id join remains the primary defense.
  const planSlug = slug ?? runState?.plan_slug ?? null;
  const planTaskIds = planSlug ? readPlanTaskIdSet(repoRoot, planSlug) : new Set<string>();
  const validateAgainstPlan = planTaskIds.size > 0;
  const omittedOrphans: string[] = [];

  const out: ResumableLane[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const laneId = entry.name;
    // loadLaneResumeCheckpoint applies the schema_version guard + JSON-parse tolerance.
    const cp = loadLaneResumeCheckpoint(runDir, laneId);
    if (!cp) continue;

    // Orphan / bad-key guard: only offer checkpoints whose lane_id is a real plan task-id.
    if (validateAgainstPlan && !planTaskIds.has(cp.lane_id)) {
      omittedOrphans.push(cp.lane_id);
      continue;
    }

    const tier = runState?.lanes?.[laneId]?.tier;
    out.push(tier !== undefined ? { ...cp, tier } : { ...cp });
  }

  if (omittedOrphans.length > 0) {
    process.stderr.write(
      `[resume-lanes] WARN: omitted ${omittedOrphans.length} non-resumable checkpoint(s) whose ` +
        `lane_id is not a plan task-id (orphan/fallback/name-keyed): ${omittedOrphans.join(", ")} ` +
        `— these cannot be auto-mapped to a plan lane (plan slug: ${planSlug}).\n`,
    );
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

export function runResumeLanesCli(): void {
  const parsed = parseResumeLanesArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[resume-lanes] ${parsed.error}\n`);
    process.exit(1);
  }

  const lanes = scanResumableLanes(parsed.runDir, parsed.cwd, parsed.slug);

  if (parsed.json) {
    // BARE JSON ARRAY (team-lead's confirmed consume shape for the resume prose).
    process.stdout.write(JSON.stringify(lanes, null, 2) + "\n");
  } else {
    process.stdout.write(renderHuman(parsed.runDir, lanes));
  }
  process.exit(0);
}

if (require.main === module) {
  runResumeLanesCli();
}
