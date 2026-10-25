/**
 * hooks/lib/run-close.ts — the one run-close implementation.
 *
 * Two callers, one path (#277): the Stop hook (hooks/run-trace-close.ts, run id
 * from GUILD_RUN_ID) and the `run-trace close --run-id <id>` CLI
 * (hooks/run-trace.ts, no hook payload). Both call closeGuildRun, so the guards
 * (NN#7 started-run, Fix C active-work deferral, Blocker 2 premature-close
 * recovery, reopen-on-activity) and the close effects (provenance.json, run.yaml
 * flip, run_closed trace line, HK-09 checkpoint, corroborated touched tasks) are
 * identical. Diagnostics keep the caller's tag; the outcome tells the caller
 * what happened so the CLI can exit non-zero and the hook can stay exit-0.
 */

import * as fs from "fs";
import * as path from "path";

import {
  defaultResolveHost,
  emitRunClosed,
  newestPostCloseActivityMs,
} from "./run-trace.js";
import type { HookResolveHost } from "./run-trace.js";
// T3 §5: the reopen-on-activity leg re-opens the run's binding with the run's
// OWN exact nonce before re-closing (reopenRunBinding is fail-closed on
// absent/malformed/mismatched records). Rework F1: the nonce is CALLER-
// PRESENTED only (an explicit ref, or the GUILD_RUN_BINDING_REF env envelope
// naming this exact run). It is NEVER recovered from binding.json.
import {
  readHookBindingEnvelope,
  reopenRunBinding,
} from "../../scripts/lib/run-binding.js";
import { readScalarField } from "../../scripts/lib/frontmatter.js";
import { authorizeHookWrite } from "./hook-binding.js";
import { durableGuildDir } from "../../src/domains/state";

/**
 * Tolerance window (ms) for the reopen-on-activity check (see header). Newer
 * activity strictly beyond this margin past `closed_at` is treated as a
 * genuinely later turn; activity within it is attributed to the close
 * operation's own second-precision timestamp + its own trace-line write.
 */
const REOPEN_TOLERANCE_MS = 2000;

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const TERMINAL_LANE_STATUSES = new Set(["done", "failed", "dead", "skipped"]);
const MAX_PROVENANCE_LANES = 512;
const MAX_ATTEMPTS_PER_LANE = 64;

function readRegularJson(filePath: string): Record<string, unknown> | null {
  let descriptor: number | null = null;
  try {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(descriptor).isFile()) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function pathIsPhysicallyContained(parent: string, candidate: string): boolean {
  try {
    const realParent = fs.realpathSync(parent);
    const realCandidate = fs.realpathSync(candidate);
    return realCandidate.startsWith(`${realParent}${path.sep}`);
  } catch {
    return false;
  }
}

function directoryChainIsPhysical(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  let current = parent;
  try {
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      const stats = fs.lstatSync(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) return false;
    }
    return pathIsPhysicallyContained(parent, candidate);
  } catch {
    return false;
  }
}

/**
 * Derive terminal task provenance from the two production-owned dispatch
 * records that must agree: run-state's terminal lane and the immutable
 * task-cell attempt for that same run + logical task. A hand-authored lane,
 * a symlinked tree, a mismatched run/task id, or an unbounded checkpoint earns
 * no provenance claim.
 */
export function collectCorroboratedTouchedTasks(runDir: string, runId: string): string[] {
  const state = readRegularJson(path.join(runDir, "run-state.json"));
  const lanes = state?.["lanes"];
  if (
    state?.["schema_version"] !== "guild.run_state.v1" ||
    state?.["run_id"] !== runId ||
    lanes === null || typeof lanes !== "object" || Array.isArray(lanes)
  ) return [];

  const entries = Object.entries(lanes as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_PROVENANCE_LANES) return [];
  const touched: string[] = [];

  for (const [taskId, rawLane] of entries) {
    if (!SAFE_TASK_ID.test(taskId) || rawLane === null || typeof rawLane !== "object" || Array.isArray(rawLane)) continue;
    const lane = rawLane as Record<string, unknown>;
    if (typeof lane["status"] !== "string" || !TERMINAL_LANE_STATUSES.has(lane["status"])) continue;

    const attemptsDir = path.join(runDir, "task-cells", taskId, "attempts");
    if (!directoryChainIsPhysical(runDir, attemptsDir)) continue;
    let attemptNames: string[];
    try {
      attemptNames = fs.readdirSync(attemptsDir)
        .filter((name) => SAFE_TASK_ID.test(name))
        .sort();
    } catch {
      continue;
    }
    if (attemptNames.length === 0 || attemptNames.length > MAX_ATTEMPTS_PER_LANE) continue;

    const corroborated = attemptNames.some((attemptName) => {
      const attemptPath = path.join(attemptsDir, attemptName, "attempt.json");
      if (!directoryChainIsPhysical(runDir, path.dirname(attemptPath)) || !pathIsPhysicallyContained(runDir, attemptPath)) return false;
      const attempt = readRegularJson(attemptPath);
      return attempt?.["schema_version"] === "guild.task_attempt.v1"
        && attempt["run_id"] === runId
        && attempt["logical_task_id"] === taskId
        && attempt["immutable"] === true
        && typeof attempt["terminal_state"] === "string"
        && attempt["terminal_state"].length > 0
        && typeof attempt["terminated_at"] === "string"
        && Number.isFinite(Date.parse(attempt["terminated_at"]));
    });
    if (corroborated) touched.push(taskId);
  }

  return touched.sort();
}

// ── Fix C (run-identity-and-dispatch) — active-worker close guard ─────────

/**
 * Deterministic, file-based liveness check: is any worker of this run still
 * active? Two legs, both pure reads:
 *
 *   1. `run-state.json` carries a lane with status "in_progress" — the
 *      dispatch-time DAG says a lane is mid-flight.
 *   2. Any `task-cells/<task>/attempts/<n>/attempt.json` records
 *      `terminal_state: null` — a spawned teammate instance that has not been
 *      terminated (the durable liveness record of the agent-team runtime).
 *
 * Returns a human-readable reason when active work is found, null otherwise.
 *
 * WHY: the launcher-created (redundant) orchestrator's Stop hook closed
 * run-20260811-000117-run-identity-and-dispatch while its tooling-engineer
 * worker held a live non-terminal attempt. Closing is DEFERRED, not lost: the
 * next Stop after the workers terminate closes normally, and a genuinely
 * abandoned run is finalized by `closeStalePriorOpenRun` when the next run
 * starts. Fail direction: unreadable/malformed records cannot PROVE liveness,
 * so they never block the close — only a readable in_progress lane or a
 * readable non-terminal attempt defers it.
 *
 * EXPORTED for the pinning tests (run-trace-close-active-guard.test.ts).
 */
export function findActiveWork(runDir: string): string | null {
  // Leg 1 — run-state lanes.
  try {
    const raw = fs.readFileSync(path.join(runDir, "run-state.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      schema_version?: string;
      lanes?: Record<string, { status?: string }>;
    };
    if (parsed?.schema_version === "guild.run_state.v1" && parsed.lanes) {
      for (const [laneId, lane] of Object.entries(parsed.lanes)) {
        if (lane?.status === "in_progress") {
          return `run-state lane "${laneId}" is in_progress`;
        }
      }
    }
  } catch {
    /* unreadable run-state proves nothing — never blocks the close */
  }

  // Leg 2 — non-terminal task-cell attempts.
  const cellsRoot = path.join(runDir, "task-cells");
  try {
    for (const cell of fs.readdirSync(cellsRoot, { withFileTypes: true })) {
      if (!cell.isDirectory()) continue;
      const attemptsDir = path.join(cellsRoot, cell.name, "attempts");
      let attempts: fs.Dirent[];
      try {
        attempts = fs.readdirSync(attemptsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const attempt of attempts) {
        if (!attempt.isDirectory()) continue;
        try {
          const record = JSON.parse(
            fs.readFileSync(path.join(attemptsDir, attempt.name, "attempt.json"), "utf8"),
          ) as { schema_version?: string; attempt_id?: string; terminal_state?: unknown };
          if (
            record?.schema_version === "guild.task_attempt.v1" &&
            record.terminal_state === null
          ) {
            return `task-cell attempt "${record.attempt_id ?? `${cell.name}/${attempt.name}`}" is non-terminal`;
          }
        } catch {
          /* unreadable attempt proves nothing */
        }
      }
    }
  } catch {
    /* no task-cells tree — nothing to defer on */
  }

  return null;
}

// ── Blocker 2 — premature-close recovery (the upgrade race) ────────────────

/**
 * Deterministic, atomic recovery for the premature-terminal contradiction the
 * pre-Fix-C bundle left behind: `provenance.json` records a terminal status
 * (closed/failed) while `run.yaml` is still OPEN and workers are active.
 *
 * Scope is EXACTLY that contradiction class:
 *   - provenance terminal  AND  run.yaml `status: open`  → rewrite provenance
 *     atomically (temp+rename) to the non-terminal "resumable" status,
 *     preserving the stale terminal fields as premature_close_* audit metadata.
 *   - provenance absent/non-terminal, or run.yaml NOT open → do nothing (a
 *     genuinely closed run is never blindly reopened).
 *
 * Idempotent (a recovered record is non-terminal, so a second pass is a no-op)
 * and fail-safe (any read/parse failure recovers nothing — an unreadable
 * record cannot prove the contradiction). Runs BEFORE the active-work refusal
 * returns, so a Stop during active work leaves consistent durable state
 * instead of preserving "terminal AND active" forever.
 *
 * EXPORTED for the pinning tests (run-trace-close-active-guard.test.ts).
 */
export function recoverPrematureClose(runDir: string, activeWork: string): string | null {
  const provenanceFile = path.join(runDir, "provenance.json");
  let prov: Record<string, unknown>;
  try {
    prov = JSON.parse(fs.readFileSync(provenanceFile, "utf8")) as Record<string, unknown>;
  } catch {
    return null; // absent/unreadable — nothing to recover
  }
  const status = prov["status"];
  if (status !== "closed" && status !== "failed") return null; // non-terminal — consistent

  let runYamlOpen = false;
  try {
    runYamlOpen = readScalarField(
      fs.readFileSync(path.join(runDir, "run.yaml"), "utf8"),
      "status",
    ) === "open";
  } catch {
    return null; // unreadable run.yaml cannot prove the contradiction
  }
  if (!runYamlOpen) return null; // run genuinely closed — never blindly reopen

  const recovered = {
    ...prov,
    status: "resumable",
    premature_close_previous_status: status,
    premature_close_recovered_at: new Date().toISOString(),
    premature_close_reason: `premature terminal provenance while run.yaml is open and ${activeWork}`,
  };
  const tmpPath = `${provenanceFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(recovered, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, provenanceFile);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
  return `recovered premature terminal provenance (was "${String(status)}", now "resumable")`;
}

// ── HK-09 — terminal learning checkpoint resolution ───────────────────────

/**
 * Find the terminal `guild.learning_checkpoint.v1` YAML for the given run.
 *
 * Preference order:
 *   1. `reflection-<runId>.yaml` (the terminal phase) — preferred regardless
 *      of mtime, as reflection is always the last phase in the lifecycle.
 *   2. Last-modified `.yaml` file in the `learning/` directory — fallback
 *      when no reflection-phase checkpoint was written (e.g. run stopped
 *      mid-lifecycle).
 *
 * Returns `null` when:
 *   - the `learning/` directory does not exist, or
 *   - the `learning/` directory has no `.yaml` files.
 *
 * EXPORTED: consumed by tests (TDD) and callable by future tooling.
 */
export function findTerminalCheckpoint(runDir: string, runId: string): string | null {
  const learningDir = path.join(runDir, "learning");
  if (!fs.existsSync(learningDir)) return null;

  // 1. Prefer the reflection-phase checkpoint (always the terminal phase).
  const reflectionFile = path.join(learningDir, `reflection-${runId}.yaml`);
  if (fs.existsSync(reflectionFile)) return reflectionFile;

  // 2. Fall back to the last-modified .yaml file.
  let yamlFiles: string[];
  try {
    yamlFiles = fs.readdirSync(learningDir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return null;
  }
  if (yamlFiles.length === 0) return null;

  const sorted = yamlFiles
    .map((f) => path.join(learningDir, f))
    .sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

  return sorted[0] ?? null;
}

// ── #277 — the shared close path ──────────────────────────────────────────

export type RunCloseOutcome =
  | "closed" // first close of an open run
  | "reclosed" // a terminal run with later activity was closed again
  | "not_started" // no run.yaml — NN#7, never fabricate a close
  | "deferred" // Fix C — workers still active
  | "already_closed" // terminal, no newer activity — idempotent no-op
  | "binding_rejected" // caller did not present this run's nonce
  | "failed"; // closeRun threw or left no terminal pointer

export interface CloseGuildRunOpts {
  /** Diagnostic tag, e.g. "run-trace-close" (hook) or "run-trace" (CLI). */
  tag: string;
  /** Explicit binding nonce; else the env envelope must name this run. */
  bindingRef?: string;
  resolveHost?: HookResolveHost;
}

/**
 * Close `runId` under `root`. Writes the same stderr diagnostics the Stop hook
 * always wrote for the deferred / re-close / refusal legs; the silent outcomes
 * (not_started, already_closed) write nothing and leave messaging to the caller.
 */
export function closeGuildRun(root: string, runId: string, opts: CloseGuildRunOpts): RunCloseOutcome {
  const tag = opts.tag;
  const resolveHost = opts.resolveHost ?? defaultResolveHost;
  const runDir = path.join(durableGuildDir(root), "runs", runId);
  // NN#7 guard — only close a run B2's startRun actually opened.
  if (!fs.existsSync(path.join(runDir, "run.yaml"))) return "not_started";

  // Fix C — active-worker close guard: a close from ANY session bound to this
  // run (including a redundant launcher-created orchestrator) must not close
  // the run while a lane is in_progress or a teammate's task-cell attempt is
  // non-terminal. Deferred, never lost — see findActiveWork's header.
  const activeWork = findActiveWork(runDir);
  if (activeWork !== null) {
    // Blocker 2 — BEFORE refusing, reconcile the premature-close upgrade race:
    // a stale terminal provenance record contradicting this run's open
    // run.yaml is atomically rewritten to "resumable" so durable state is
    // consistent-open instead of "terminal AND active" forever. The rewrite is
    // a write, so it needs the caller-presented nonce like every other leg.
    try {
      const auth = authorizeHookWrite(root, { runId, bindingRef: opts.bindingRef });
      const recovered = auth.ok === false ? null : recoverPrematureClose(runDir, activeWork);
      if (recovered !== null) {
        process.stderr.write(`[${tag}] ${runId}: ${recovered}.\n`);
      }
    } catch (err) {
      process.stderr.write(
        `[${tag}] WARN: premature-close recovery failed for ${runId}: ` +
          `${err instanceof Error ? err.message : String(err)} — close still refused.\n`,
      );
    }
    process.stderr.write(
      `[${tag}] refusing to close ${runId}: ${activeWork} — workers are still ` +
        `active; the close is deferred until they terminate.\n`,
    );
    return "deferred";
  }

  // Already closed? Check whether it's GENUINELY done or whether more tool
  // activity landed after the earlier close (reopen-on-activity, see the
  // run-trace-close.ts header).
  let reclosing = false;
  const provenanceFile = path.join(runDir, "provenance.json");
  if (fs.existsSync(provenanceFile)) {
    let terminal = true; // conservative default: an unreadable provenance.json is never reopened
    let closedAtMs = 0;
    try {
      const prov = JSON.parse(fs.readFileSync(provenanceFile, "utf8")) as {
        status?: string;
        closed_at?: string;
      };
      terminal = prov.status === "closed" || prov.status === "failed";
      closedAtMs = typeof prov.closed_at === "string" ? Date.parse(prov.closed_at) : 0;
    } catch {
      /* unreadable provenance.json — terminal stays true, closedAtMs stays 0 */
    }
    if (terminal) {
      const latestActivityMs = newestPostCloseActivityMs(root, runId);
      // Tolerance absorbs two sources of same-invocation "self" lag that are
      // NOT genuine later activity: (a) `closed_at` is second-precision
      // (env.now() strips milliseconds — see lib/run-trace.ts), so it is
      // always <= the real wall-clock instant it was captured at; (b)
      // emitRunClosed's OWN run_closed trace-line append lands in
      // logs/v1.4-events.jsonl (one of the candidate files) a few ms AFTER
      // `closed_at` was computed, as an unavoidable side effect of the close
      // that just happened. REOPEN_TOLERANCE_MS is generous relative to (a)+(b)
      // (well under a second in practice) while staying far below the gap a
      // genuinely later assistant turn would produce (seconds to minutes).
      const noNewActivity =
        latestActivityMs === 0 ||
        !Number.isFinite(closedAtMs) ||
        latestActivityMs <= closedAtMs + REOPEN_TOLERANCE_MS;
      if (noNewActivity) return "already_closed"; // genuinely done — idempotent no-op
      process.stderr.write(
        `[${tag}] run ${runId} received tool activity after its prior close ` +
          `(closed_at=${new Date(closedAtMs).toISOString()}) — re-closing with the latest state.\n`,
      );
      // T3 §5: the run is being REOPENED (it was not genuinely done), so its
      // binding state follows — reopen with the run's own exact nonce, fail
      // closed on absent/malformed/mismatch. Rework F1: the nonce is the
      // caller-presented ref or the env envelope naming this exact run — never
      // recovered from binding.json. Without it the re-close is refused
      // (emitRunClosed also fails closed downstream).
      const envelope = readHookBindingEnvelope(process.env);
      const recloseRef =
        opts.bindingRef ?? (envelope && envelope.run_id === runId ? envelope.binding_ref : undefined);
      if (recloseRef === undefined) {
        process.stderr.write(
          `[${tag}] WARN: binding_rejected — cannot re-close ${runId}: the ` +
            `GUILD_RUN_BINDING_REF envelope does not name this run. No write performed.\n`,
        );
        return "binding_rejected";
      }
      try {
        reopenRunBinding({ root, run_id: runId }, recloseRef);
      } catch (err) {
        process.stderr.write(
          `[${tag}] WARN: ${err instanceof Error ? err.message : String(err)} — ` +
            `re-close refused (fail closed).\n`,
        );
        return "binding_rejected";
      }
      reclosing = true;
      // Fall through — recompute + re-emit the close below.
    }
    // terminal === false (e.g. status: "resumable") falls through unconditionally.
  }

  // HK-09: populate provenance.json.final_learning_checkpoint
  const finalLearningCheckpoint = findTerminalCheckpoint(runDir, runId);
  const touchedTasks = collectCorroboratedTouchedTasks(runDir, runId);
  const emitted = emitRunClosed(root, runId, resolveHost, {
    status: "closed",
    ...(opts.bindingRef !== undefined ? { binding_ref: opts.bindingRef } : {}),
    touched: { tasks: touchedTasks },
    ...(finalLearningCheckpoint !== null
      ? { final_learning_checkpoint: finalLearningCheckpoint }
      : {}),
  });
  if (emitted !== "closed") return emitted;
  return reclosing ? "reclosed" : "closed";
}
