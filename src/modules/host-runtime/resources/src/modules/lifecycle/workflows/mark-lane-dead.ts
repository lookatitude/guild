#!/usr/bin/env -S npx tsx
/**
 * scripts/mark-lane-dead.ts
 *
 * R-016 bridge seam — the CLI funnel to hooks' `markLaneDead` checkpoint writer.
 *
 * WHY THIS EXISTS: `markLaneDead` (hooks/lib/run-state.ts) is the SINGLE writer of
 * the lane `dead` status + per-lane `resume.json` checkpoint. Two dispatch paths
 * must reach it on retry exhaustion:
 *   1. SSH path — `runWithRetry`'s `onExhausted` callback imports markLaneDead
 *      directly (TS→TS; the scripts→hooks import direction is already established,
 *      e.g. emit-loop-event.ts imports ../hooks/lib/v1.4/log-jsonl.js).
 *   2. InProcess / subagent PROSE path — the orchestrator (Claude) CANNOT call a TS
 *      function. guild:execute-plan prose runs THIS CLI on exhaustion:
 *        npx tsx scripts/mark-lane-dead.ts <runDir> <laneId> --attempts N \
 *          [--last-error "..."] [--run-id ...] [--plan-slug ...] \
 *          [--program-id ...] [--wave-index N] [--cwd <repo-root>]
 *
 * Both paths converge on markLaneDead → identical run-state + resume semantics
 * regardless of backend. No path invents its own checkpoint logic.
 *
 * Exit: 0 success; 1 arg error / write failure. Never partially writes (markLaneDead
 * is the atomic unit).
 *
 * Contract pointers:
 *   - markLaneDead + RunStateInit + LaneExhaustionSignal: hooks/lib/run-state.ts.
 *   - resume.enabled tolerant read lives in markLaneDead (readResumeEnabled).
 *   - ledger: audit/reconciliation-ledger.md R-016; OD-5 in decisions.md.
 */

import * as path from "path";
import {
  markLaneDead,
  type RunStateInit,
  type LaneExhaustionSignal,
} from "./run-state";

// ── Parsed args ───────────────────────────────────────────────────────────────

export interface MarkLaneDeadArgs {
  /** Absolute path to `.guild/runs/<run-id>/`. */
  runDir: string;
  /** Task-id key matching RunStateV1.lanes. */
  laneId: string;
  /** Total attempts made before exhaustion. */
  attempts: number;
  /** Optional last-error summary. */
  lastError?: string;
  /** Run identity (for seeding run-state when absent). */
  runId?: string;
  planSlug?: string;
  programId?: string;
  waveIndex?: number;
  /** Consuming-repo root (for reading defaults.resume.enabled). */
  cwd?: string;
}

// ── Arg parser (pure, testable) ─────────────────────────────────────────────

/**
 * Parse the CLI argv (already sliced past node + script). Returns the parsed args
 * or `{ error }`. Positionals: <runDir> <laneId>. Required flag: --attempts <n>.
 */
export function parseMarkLaneDeadArgs(
  argv: string[]
): MarkLaneDeadArgs | { error: string } {
  const positionals: string[] = [];
  let attempts: number | undefined;
  let lastError: string | undefined;
  let runId: string | undefined;
  let planSlug: string | undefined;
  let programId: string | undefined;
  let waveIndex: number | undefined;
  let cwd: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--attempts" && argv[i + 1] !== undefined) {
      attempts = Number(argv[++i]);
    } else if (arg.startsWith("--attempts=")) {
      attempts = Number(arg.slice("--attempts=".length));
    } else if (arg === "--last-error" && argv[i + 1] !== undefined) {
      lastError = argv[++i];
    } else if (arg.startsWith("--last-error=")) {
      lastError = arg.slice("--last-error=".length);
    } else if (arg === "--run-id" && argv[i + 1] !== undefined) {
      runId = argv[++i];
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    } else if (arg === "--plan-slug" && argv[i + 1] !== undefined) {
      planSlug = argv[++i];
    } else if (arg.startsWith("--plan-slug=")) {
      planSlug = arg.slice("--plan-slug=".length);
    } else if (arg === "--program-id" && argv[i + 1] !== undefined) {
      programId = argv[++i];
    } else if (arg.startsWith("--program-id=")) {
      programId = arg.slice("--program-id=".length);
    } else if (arg === "--wave-index" && argv[i + 1] !== undefined) {
      waveIndex = Number(argv[++i]);
    } else if (arg.startsWith("--wave-index=")) {
      waveIndex = Number(arg.slice("--wave-index=".length));
    } else if (arg === "--cwd" && argv[i + 1] !== undefined) {
      cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }

  const [runDir, laneId] = positionals;
  if (!runDir || !laneId) {
    return {
      error:
        "usage: mark-lane-dead.ts <runDir> <laneId> --attempts <n> " +
        "[--last-error <s>] [--run-id <s>] [--plan-slug <s>] " +
        "[--program-id <s>] [--wave-index <n>] [--cwd <p>]",
    };
  }
  if (attempts === undefined || !Number.isFinite(attempts) || attempts < 1) {
    return { error: `--attempts <n> is required and must be an integer ≥ 1 (got ${argv.join(" ")})` };
  }

  return {
    runDir,
    laneId,
    attempts: Math.floor(attempts),
    lastError,
    runId,
    planSlug,
    programId,
    waveIndex: waveIndex !== undefined && Number.isFinite(waveIndex) ? Math.floor(waveIndex) : undefined,
    cwd,
  };
}

// ── Resolve repo root from runDir when --cwd absent ─────────────────────────

/**
 * `.guild/runs/<run-id>` → repo root is three levels up. Best-effort; if the
 * runDir doesn't follow that shape, returns the runDir's grandparent's parent
 * anyway (markLaneDead's readResumeEnabled is tolerant — a wrong root just yields
 * the resume.enabled default of true).
 */
function repoRootFromRunDir(runDir: string): string {
  // runDir = <root>/.guild/runs/<id>  →  up 3 = <root>
  return path.resolve(runDir, "..", "..", "..");
}

// ── Core (pure-ish: does fs writes via markLaneDead; returns exit code) ──────

/**
 * Invoke markLaneDead with the parsed args. Returns an exit code (0 ok, 1 error).
 * Never throws — wraps markLaneDead so the CLI and tests share one path.
 */
export function markLaneDeadFromArgs(args: MarkLaneDeadArgs): number {
  const cwd = args.cwd ?? repoRootFromRunDir(args.runDir);
  const runId = args.runId ?? path.basename(args.runDir);

  const init: RunStateInit = {
    runId,
    planSlug: args.planSlug,
    programId: args.programId ?? null,
    waveIndex: args.waveIndex,
  };

  const signal: LaneExhaustionSignal = {
    attempts: args.attempts,
    lastAttemptAt: new Date().toISOString(),
    lastError: args.lastError,
  };

  try {
    markLaneDead(args.runDir, init, args.laneId, signal, cwd);
    return 0;
  } catch (e) {
    process.stderr.write(`[mark-lane-dead] ERROR: ${(e as Error).message}\n`);
    return 1;
  }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

export function runMarkLaneDeadCli(): void {
  const parsed = parseMarkLaneDeadArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[mark-lane-dead] ${parsed.error}\n`);
    process.exit(1);
  }
  const code = markLaneDeadFromArgs(parsed);
  if (code === 0) {
    process.stdout.write(
      `[mark-lane-dead] lane "${parsed.laneId}" marked dead (attempts=${parsed.attempts}) in ${parsed.runDir}\n`
    );
  }
  process.exit(code);
}

if (require.main === module) {
  runMarkLaneDeadCli();
}
