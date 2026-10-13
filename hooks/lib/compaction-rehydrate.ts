/**
 * hooks/lib/compaction-rehydrate.ts — the `compaction` adapter rung (KTD26 /
 * KTD28 / R42 / R46), hook side.
 *
 * KTD28's row:
 *
 *     compaction | skip-recorded. Disk files still written each heartbeat;
 *                | next session rehydrates.
 *
 * and KTD26's rule for the event itself:
 *
 *     On that event, rehydrate the next turn from disk: working_set, last-5
 *     goal_status, assignment, progress ledger, workflow_cursor. NEVER from a
 *     host transcript summary.
 *
 * "Never from a transcript summary" is a structural claim, so this module is
 * structured to make it true rather than asserted: `rehydrateFromDisk` takes no
 * transcript, no summary, and no hook payload. Its only inputs are a run
 * directory and a working directory. A host summary cannot reach it because
 * there is no parameter for one.
 *
 * Two rungs, one reader:
 *
 *   native         the host fires PreCompact. The snapshot is read from disk and
 *                  rendered into the compact-summary instructions.
 *   skip-recorded  no compaction event exists. The same snapshot is WRITTEN each
 *                  heartbeat so a brand-new session can rehydrate from the files
 *                  instead of from a summary nobody produced.
 *
 * Five sources, each independently optional: a run mid-phase has a working set
 * and a cursor but maybe no cell yet, and a rehydrate that refused to work
 * without all five would be useless exactly when it is needed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage } from "../../src/domains/state/index.js";
import { readWorkingSet, type WorkingSet } from "../../src/domains/knowledge/index.js";
import { readWorkflowCursor, type WorkflowCursor } from "../../src/domains/lifecycle/index.js";
import { progressLedgerPath, validateProgressLedgerV1, type ProgressLedgerV1 } from "../../src/domains/dispatch/index.js";
import { ORCHESTRATOR_WINDOW, foldOrchestratorContext, type OrchestratorContext } from "../../src/domains/teams/index.js";
import { KTD26_TOKEN_CAP, truncateWithPointer } from "./token-cap.js";
import { readScalarField } from "../../scripts/lib/frontmatter";

export const COMPACTION_REHYDRATE_SCHEMA = "guild.compaction_rehydrate.v1" as const;
export const RUNG_RECORD_SCHEMA = "guild.rung_record.v1" as const;

export type CompactionRung = "native" | "skip-recorded";

/**
 * Which compaction rung is in force.
 *
 * A host whose adapter has no compaction event states `skip-recorded` through
 * `GUILD_COMPACTION_RUNG`; a host that is firing this hook is `native`. As with
 * every rung, an unverified value is not guessed upward (KTD5).
 */
export function resolveCompactionRung(env: NodeJS.ProcessEnv): CompactionRung {
  return env["GUILD_COMPACTION_RUNG"] === "skip-recorded" ? "skip-recorded" : "native";
}

export interface RehydrateSnapshot {
  schema_version: typeof COMPACTION_REHYDRATE_SCHEMA;
  run_id: string;
  taken_at: string;
  rung: CompactionRung;
  /** Which of the five sources were actually on disk. */
  sources: {
    working_set: boolean;
    goal_status: boolean;
    assignment: boolean;
    progress_ledger: boolean;
    workflow_cursor: boolean;
  };
  working_set: WorkingSet | null;
  /** Last `ORCHESTRATOR_WINDOW` envelopes in full + the rolling summary (KTD19). */
  goal_status: OrchestratorContext;
  /** The cell's `guild.task_assignment.v2`, verbatim from disk. */
  assignment: Record<string, unknown> | null;
  progress_ledger: ProgressLedgerV1 | null;
  workflow_cursor: WorkflowCursor | null;
}

export interface RehydrateInput {
  /** Absolute run directory. */
  runDir: string;
  /** Working directory for root discovery (the working-set card lives off-repo). */
  cwd: string;
  /** Run id; the caller has already resolved it from the run record + env (R71). */
  runId: string;
  rung?: CompactionRung;
  /** Phase for the working-set card. Falls back to the run record's own phase. */
  phase?: string;
  /** Logical task id for the cell's assignment + ledger. */
  logicalTaskId?: string;
  now?: () => string;
}

function readJsonOrNull(absPath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The run record's `phase:`, read as text.
 *
 * `phase` is a flat scalar on `guild.run.v1`, read through the shared
 * single-line reader (OD-3) rather than a whole-document parse: this is a
 * hot-ish path. A value that is not a bare token leaves the phase unresolved,
 * which is the same as absent.
 */
export function phaseFromRunRecord(runDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
    const v = readScalarField(raw, "phase");
    return v !== undefined && /^[A-Za-z0-9._-]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * R71: an incomplete run is detected from the run RECORD plus the environment —
 * never from a sentinel file. A run id with no readable record on disk is not an
 * active run, whatever any sentinel says.
 */
export function runRecordExists(runDir: string): boolean {
  try {
    return fs.statSync(path.join(runDir, "run.yaml")).isFile();
  } catch {
    return false;
  }
}

/** Where the run's `guild.goal_status.v1` envelopes are kept, one file each. */
export function goalStatusDir(runDir: string): string {
  return path.join(runDir, "goal-status");
}

/**
 * Read every goal_status envelope on disk, oldest first.
 *
 * One file per envelope, NOT an append log: a third JSONL under the run tree is
 * forbidden (KTD38), and the fold only ever needs the set.
 */
function readGoalStatusEnvelopes(runDir: string): unknown[] {
  let names: string[];
  try {
    names = fs.readdirSync(goalStatusDir(runDir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const n of names) {
    const parsed = readJsonOrNull(path.join(goalStatusDir(runDir), n));
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/**
 * The newest `assignment.json` under a cell, across attempts and instances.
 *
 * Newest rather than "attempt 1": a retry writes a NEW attempt (D4), and the
 * assignment a rehydrating session needs is the one the live attempt was given.
 */
function readNewestAssignment(cellDir: string): Record<string, unknown> | null {
  let best: { mtime: number; value: Record<string, unknown> } | null = null;
  const attemptsDir = path.join(cellDir, "attempts");
  let attempts: string[];
  try {
    attempts = fs.readdirSync(attemptsDir);
  } catch {
    return null;
  }
  for (const attempt of attempts) {
    const instancesDir = path.join(attemptsDir, attempt, "instances");
    let instances: string[];
    try {
      instances = fs.readdirSync(instancesDir);
    } catch {
      continue;
    }
    for (const instance of instances) {
      const p = path.join(instancesDir, instance, "assignment.json");
      let mtime: number;
      try {
        mtime = fs.statSync(p).mtimeMs;
      } catch {
        continue;
      }
      const parsed = readJsonOrNull(p);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      if (best === null || mtime > best.mtime) {
        best = { mtime, value: parsed as Record<string, unknown> };
      }
    }
  }
  return best?.value ?? null;
}

/**
 * The durable directory a run directory sits in.
 *
 * Derived from the run directory rather than re-constructed, so this module
 * names no durable path of its own (KTD15) and an overridden run directory
 * still resolves its own siblings.
 */
function durableDirOf(runDir: string): string {
  return path.resolve(runDir, "..", "..");
}

/**
 * Build the rehydrate snapshot from DISK ONLY.
 *
 * There is deliberately no transcript, summary, or hook-payload parameter: the
 * "never from a host transcript summary" rule (KTD26) is enforced by the
 * signature, not by a comment asking callers to behave.
 */
export function rehydrateFromDisk(input: RehydrateInput): RehydrateSnapshot {
  const now = input.now ?? (() => new Date().toISOString());
  const rung = input.rung ?? "native";
  const phase = input.phase ?? phaseFromRunRecord(input.runDir) ?? "build";

  let working_set: WorkingSet | null = null;
  try {
    working_set = readWorkingSet(createGuildStorage(input.cwd), phase);
  } catch {
    working_set = null;
  }

  const envelopes = readGoalStatusEnvelopes(input.runDir);
  const goal_status = foldOrchestratorContext(envelopes, ORCHESTRATOR_WINDOW);

  let assignment: Record<string, unknown> | null = null;
  let progress_ledger: ProgressLedgerV1 | null = null;
  if (input.logicalTaskId !== undefined && input.logicalTaskId.length > 0) {
    const cellDir = path.join(input.runDir, "task-cells", input.logicalTaskId);
    assignment = readNewestAssignment(cellDir);
    try {
      const ledgerPath = progressLedgerPath({
        run_id: input.runId,
        logical_task_id: input.logicalTaskId,
        guildDir: durableDirOf(input.runDir),
      });
      progress_ledger = validateProgressLedgerV1(readJsonOrNull(ledgerPath));
    } catch {
      progress_ledger = null;
    }
  }

  let workflow_cursor: WorkflowCursor | null = null;
  try {
    workflow_cursor = readWorkflowCursor(input.runDir);
  } catch {
    workflow_cursor = null;
  }

  return {
    schema_version: COMPACTION_REHYDRATE_SCHEMA,
    run_id: input.runId,
    taken_at: now(),
    rung,
    sources: {
      working_set: working_set !== null,
      goal_status: envelopes.length > 0,
      assignment: assignment !== null,
      progress_ledger: progress_ledger !== null,
      workflow_cursor: workflow_cursor !== null,
    },
    working_set,
    goal_status,
    assignment,
    progress_ledger,
    workflow_cursor,
  };
}

/** True when nothing was on disk — the caller should stay silent rather than emit a shell. */
export function snapshotIsEmpty(s: RehydrateSnapshot): boolean {
  return Object.values(s.sources).every((present) => present === false);
}

/**
 * Render the snapshot as PLAIN TEXT for the compact-summary instructions.
 *
 * Capped at the KTD26 budget: the point of rehydrating is to spend a little
 * context to recover the run's identity, not to re-inflate everything the
 * compaction just reclaimed. Pointers, not bodies — the assignment and the
 * working-set card stay on disk and are named, not pasted.
 */
export function renderRehydrateInstructions(
  s: RehydrateSnapshot,
  opts: { runDir?: string } = {},
): string {
  const lines: string[] = [];
  lines.push("Guild rehydrate (from disk, not from this summary):");
  lines.push(`- run: ${s.run_id}`);
  if (s.workflow_cursor !== null) {
    lines.push(
      `- workflow: class ${s.workflow_cursor.class} graph ${s.workflow_cursor.graph_id} ` +
        `at node ${s.workflow_cursor.node_id}`,
    );
  }
  if (s.working_set !== null) {
    lines.push(`- working set: phase ${s.working_set.phase} (~${s.working_set.card_tokens} tokens, on disk)`);
  }
  if (s.goal_status.recent.length > 0) {
    lines.push(
      `- cells (last ${s.goal_status.recent.length}): ` +
        s.goal_status.recent.map((e) => `${e.cell_id}=${e.state}`).join(", "),
    );
  }
  if (s.goal_status.rolling_summary.length > 0) lines.push(`- earlier: ${s.goal_status.rolling_summary}`);
  if (s.progress_ledger !== null) {
    const items = s.progress_ledger.items.map((i) => `${i.id}=${i.state}`).join(", ");
    lines.push(`- oracles: ${items.length > 0 ? items : "none declared"}`);
  }
  if (s.assignment !== null) {
    lines.push(`- assignment on disk for cell ${String(s.assignment["logical_task_id"] ?? "unknown")}`);
  }
  lines.push(
    "Read these files for anything you need; do NOT reconstruct run state from the summary text.",
  );
  const text = `${lines.join("\n")}\n`;
  const logPath =
    opts.runDir === undefined ? undefined : path.join(opts.runDir, "rehydrate", "instructions.txt");
  return truncateWithPointer({
    text,
    cap: KTD26_TOKEN_CAP,
    ...(logPath === undefined ? {} : { logPath }),
    label: "compaction rehydrate",
  }).text;
}

/**
 * How stale the skip-recorded snapshot may get before the tool path refreshes it.
 *
 * A skip-recorded host has NO compaction event — which is exactly the event that
 * would otherwise write the snapshot (codex G-lane r1, P2). So the PostToolUse
 * path refreshes it too, on a cadence rather than on every tool call: the
 * rehydrate reads five files and the green after-edit path is budgeted at 250ms,
 * and a snapshot at most 30s behind the disk is as good as one written per tool
 * call for the thing it exists for — letting a brand-new session rehydrate.
 */
export const SNAPSHOT_MAX_AGE_MS = 30_000;

/** Where the skip-recorded snapshot lives. Latest-only. */
export function rehydrateSnapshotPath(runDir: string): string {
  return path.join(runDir, "rehydrate", "compaction.json");
}

/**
 * Is the on-disk snapshot missing or older than `maxAgeMs`?
 *
 * One `stat`, so it is safe to ask on every tool call; the expensive part is the
 * refresh it gates.
 */
export function snapshotIsStale(
  runDir: string,
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
  nowMs = Date.now(),
): boolean {
  try {
    return nowMs - fs.statSync(rehydrateSnapshotPath(runDir)).mtimeMs > maxAgeMs;
  } catch {
    return true; // absent (or unreadable) is stale
  }
}

export interface HeartbeatWriteResult {
  snapshot_path: string | null;
  rung_path: string | null;
}

/**
 * The `skip-recorded` half: write the files a next session rehydrates from.
 *
 * Latest-only (KTD32): both files are REPLACED each heartbeat. A dated append
 * would grow without bound in exactly the tree a crash resume has to read fast.
 */
export function writeRehydrateHeartbeat(
  runDir: string,
  snapshot: RehydrateSnapshot,
  reason = "compaction rung is skip-recorded",
): HeartbeatWriteResult {
  let snapshot_path: string | null = null;
  let rung_path: string | null = null;
  try {
    snapshot_path = rehydrateSnapshotPath(runDir);
    fs.mkdirSync(path.dirname(snapshot_path), { recursive: true });
    fs.writeFileSync(snapshot_path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch {
    snapshot_path = null;
  }
  try {
    const dir = path.join(runDir, "rungs");
    fs.mkdirSync(dir, { recursive: true });
    rung_path = path.join(dir, "compaction.json");
    fs.writeFileSync(
      rung_path,
      `${JSON.stringify(
        {
          schema_version: RUNG_RECORD_SCHEMA,
          rung_id: "compaction",
          rung: snapshot.rung,
          state: snapshot.rung === "skip-recorded" ? "skip-recorded" : "pass",
          reason,
          updated_at: snapshot.taken_at,
          sources: snapshot.sources,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    rung_path = null;
  }
  return { snapshot_path, rung_path };
}
