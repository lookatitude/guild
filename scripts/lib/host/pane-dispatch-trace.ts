#!/usr/bin/env -S npx tsx
/**
 * scripts/lib/host/pane-dispatch-trace.ts
 *
 * Issue #76 — make pane-dispatched lanes visible in the ORCHESTRATING run's trace.
 *
 * THE GAP. Guild's dispatch attribution (#58/#66) lives on the in-session
 * `Agent`-tool path: hooks/lib/dispatch-attribution.ts resolves the target role
 * and hooks/lib/trace-v2.ts stamps it as `attribution_specialist` on the tool
 * call the lead session makes. A lane launched into a tmux/cmux PANE is a
 * different animal — it is its own interactive host session, with its own hooks
 * writing into its own context. Nothing the pane does reaches the parent run's
 * `logs/v1.4-events.jsonl`, and the lead session never makes an `Agent` call to
 * attribute. Net effect on a real 10-lane pane run (run-f40a6c53-…):
 * `specialists_dispatched: [(none)]`, and `guild:reflect` sees a solo run.
 *
 * THE FIX — one receipt per lane that reached a backend, in the parent's log.
 * Two entry points, because Guild has two pane-dispatch drivers:
 *
 *   - LIBRARY (`emitPaneDispatchEvents`) — used by `agent-team-launcher.ts` for
 *     the tmux rung (after `TmuxTeamBackend.spawn()` returns real pane ids) and
 *     the remote rung (after `RemoteTeamBackend.launch()` succeeds).
 *   - CLI (this file, run directly) — for the **cmux rung**, which
 *     `skills/meta/execute-plan/SKILL.md §"cmux-first dispatch"` documents as
 *     bypassing the launcher entirely: the lead drives `cmux new-pane` itself
 *     and, per that same section, "explicitly assumes what the launcher
 *     otherwise owns … the dispatch records the launcher would have". This CLI
 *     is that obligation made executable instead of prose.
 *
 * VOCABULARY DISCIPLINE. The v1.4 event vocabulary is FROZEN. This module adds
 * NOTHING to it: it reuses `guild.trace.dispatch.v1`, the R-TRACE family that
 * v1.4-log-validator.ts already accepts as its own line family (`schema_version`
 * instead of `event`) and that write-task-run.ts already emits on the
 * pre-routing path. W4 promotes cmux into that contract's backend enum; the
 * attribution and pane fields remain additive. Reusing the in-log family rather than opening a
 * dedicated sink (the guild.backend_degradation.v1 / guild.tier_dispatch.v1
 * shape) is deliberate: those two carry PreToolUse hook decisions the v1.4
 * validator would reject, whereas a dispatch receipt belongs in the run log
 * every summarizer already reads — which is what the defect report asked for.
 *
 * RECEIPT SEMANTICS. One receipt per lane in the COMMITTED dispatch batch — not
 * per attempt. A backend that rolls back a partial spawn (RemoteTeamBackend
 * tears down every already-spawned pane when a later one fails) is meant to
 * leave no live lane behind, so recording an aborted attempt would over-report
 * the run's specialists. The caller emits after its retry loop settles.
 *
 * KNOWN GAP (#76 followup, NOT closed here). That rollback is best-effort:
 * RemoteTeamBackend's teardown runs `kill-session … || true` and discards the
 * exit status, so a spawn-2-fails + teardown-1-fails interleaving can leave
 * lane 1 alive on the remote with its id already dropped — a live lane no
 * receipt describes. Fixing it means making teardown CONFIRM (the shape
 * `terminatePane` already uses for local panes) and surfacing the unconfirmed
 * survivor; that is remote-backend's contract to change, not this module's.
 *
 * BEHAVIOR-NEUTRAL. `emitPaneDispatchEvents` never throws and never influences
 * the launch outcome. A trace failure must never turn a healthy team launch
 * into a failed one — but it must not be REPORTED as a success either, which is
 * why the returned count comes from `emitTraceEvent`'s own per-write verdict
 * (widened from `void` to `boolean` for exactly this, #76) rather than from a
 * loop counter or a log readback: a readback keyed on run/backend/target cannot
 * tell THIS batch's writes from a concurrent one's.
 *
 * Layer: host/ — no upward imports.
 */

import * as path from "node:path";
import { emitTraceEvent } from "../guild-trace-emit";
import { makeDispatchEvent, type DispatchBackend } from "../guild-trace-events";

/**
 * Host-capability rung of a confirmed lane pane: the FULL substrate, not a
 * fallback. (`backend_rung`: 1 = full … 4 = degraded, 0 = unknown — the value
 * write-task-run.ts uses pre-routing, before the backend is even chosen.)
 */
export const PANE_BACKEND_RUNG = 1;

/** Phase stamped on the receipt when the caller's env names none. */
export const DEFAULT_PANE_DISPATCH_PHASE = "execute";

/** Canonical event-log path, relative to a run directory. */
const EVENTS_RELPATH = path.join("logs", "v1.4-events.jsonl");

/**
 * Concrete pane surface → the dispatch backend enum value it reports as.
 * cmux is first-class under run-identity-and-dispatch W4; `unknown` plus the
 * additive `pane_backend` field remains the extension route for other surfaces.
 */
const SURFACE_TO_BACKEND: Readonly<Record<string, DispatchBackend>> = {
  tmux: "tmux",
  cmux: "cmux",
  remote: "remote",
  agent: "agent",
};

/** One lane that reached a pane/surface. */
export interface PaneDispatchLane {
  /** Resolved specialist role (team.yaml `name`). */
  specialist: string;
  /** Plan task-id the lane owns; falls back to the specialist name. */
  taskId?: string;
  /** Pane/surface id collected from the backend (e.g. `%12`); absent if uncollectable. */
  paneId?: string;
}

export interface EmitPaneDispatchOpts {
  /** Repo root — `.guild/runs/<run-id>/` hangs off this. */
  cwd: string;
  /** The ORCHESTRATING run id (the whole point: the parent's trace, not a new one). */
  runId: string;
  /** tmux session/window name, or the cmux workspace id. */
  target: string;
  lanes: PaneDispatchLane[];
  /**
   * Concrete substrate the lane landed on: "tmux" | "cmux" | "remote" | "agent".
   * Mapped through SURFACE_TO_BACKEND onto the closed wire enum; a surface
   * narrower than its wire value also lands in `pane_backend`. Defaults "tmux".
   */
  surface?: string;
  /** Lifecycle phase; defaults to GUILD_PHASE, else "execute". */
  phase?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Injectable env (phase resolution). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Append one `guild.trace.dispatch.v1` receipt per dispatched lane to
 * `<cwd>/.guild/runs/<runId>/logs/v1.4-events.jsonl`.
 *
 * Returns how many receipts ACTUALLY REACHED THE LOG, summed from
 * `emitTraceEvent`'s own per-write verdict — not a loop counter (which would
 * report "recorded 3" for zero writes) and not a log readback (which cannot
 * attribute lines to THIS batch when another writer is appending).
 *
 * NEVER throws.
 */
export function emitPaneDispatchEvents(opts: EmitPaneDispatchOpts): number {
  try {
    if (!opts.runId || opts.lanes.length === 0) return 0;

    const env = opts.env ?? process.env;
    const phaseFromEnv = env["GUILD_PHASE"];
    const phase =
      opts.phase ??
      (typeof phaseFromEnv === "string" && phaseFromEnv.length > 0
        ? phaseFromEnv
        : DEFAULT_PANE_DISPATCH_PHASE);
    const surface = opts.surface ?? "tmux";
    const backend: DispatchBackend = SURFACE_TO_BACKEND[surface] ?? "unknown";
    // Carry pane_backend only when `backend` cannot name the surface itself.
    const paneBackend = surface !== backend ? surface : undefined;
    const runDir = path.join(opts.cwd, ".guild", "runs", opts.runId);
    const now = opts.now ?? (() => new Date());

    let emitted = 0;
    for (const lane of opts.lanes) {
      // `specialist` and `task_id` are REQUIRED by the contract's validator; a
      // lane missing both is not describable as a dispatch — skip it rather
      // than write a receipt emitTraceEvent would drop anyway.
      const specialist = lane.specialist;
      if (!specialist) continue;
      const taskId = lane.taskId && lane.taskId.length > 0 ? lane.taskId : specialist;
      const ts = now().toISOString();

      const ok = emitTraceEvent(
        makeDispatchEvent({
          ts,
          run_id: opts.runId,
          lane_id: taskId,
          specialist,
          phase,
          task_id: taskId,
          backend,
          backend_rung: PANE_BACKEND_RUNG,
          dispatched_at: ts,
          // #58 parity — same field name the Agent-tool path stamps.
          attribution_specialist: specialist,
          ...(lane.paneId && lane.paneId.length > 0 ? { pane_id: lane.paneId } : {}),
          ...(opts.target && opts.target.length > 0 ? { pane_target: opts.target } : {}),
          ...(paneBackend ? { pane_backend: paneBackend } : {}),
        }),
        runDir,
      );
      if (ok) emitted++;
    }

    return emitted;
  } catch {
    // Observability must never break a launch that actually succeeded.
    return 0;
  }
}

// ── CLI (the cmux rung's launcher-bypass entry point) ────────────────────────

/** `--lane <specialist>[:<task-id>[:<pane-id>]]` — ':' is not legal in any of the three. */
export function parseLaneSpec(raw: string): PaneDispatchLane | null {
  const parts = raw.split(":");
  const specialist = (parts[0] ?? "").trim();
  if (!specialist) return null;
  const lane: PaneDispatchLane = { specialist };
  const taskId = (parts[1] ?? "").trim();
  if (taskId) lane.taskId = taskId;
  const paneId = (parts[2] ?? "").trim();
  if (paneId) lane.paneId = paneId;
  return lane;
}

const CLI_SURFACES: readonly string[] = Object.keys(SURFACE_TO_BACKEND);

export interface ParsedCliArgs {
  cwd: string;
  runId: string;
  target: string;
  surface: string;
  phase?: string;
  lanes: PaneDispatchLane[];
}

export function parseCliArgs(argv: string[]): ParsedCliArgs | { error: string } {
  let cwd = ".";
  let runId = "";
  let target = "";
  let surface = "cmux";
  let phase: string | undefined;
  const lanes: PaneDispatchLane[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (a === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (a === "--target" && i + 1 < argv.length) target = argv[++i];
    else if (a === "--backend" && i + 1 < argv.length) surface = argv[++i];
    else if (a === "--phase" && i + 1 < argv.length) phase = argv[++i];
    else if (a === "--lane" && i + 1 < argv.length) {
      const lane = parseLaneSpec(argv[++i]);
      if (!lane) return { error: `--lane needs a specialist name: got "${argv[i]}"` };
      lanes.push(lane);
    } else return { error: `unknown or incomplete argument: ${a}` };
  }

  if (!runId) return { error: "--run-id <id> is required (the ORCHESTRATING run)" };
  if (lanes.length === 0) return { error: "at least one --lane <specialist>[:<task-id>[:<pane-id>]] is required" };
  if (!CLI_SURFACES.includes(surface)) {
    return { error: `--backend must be one of: ${CLI_SURFACES.join(", ")}` };
  }
  return { cwd, runId, target, surface, phase, lanes };
}

const USAGE =
  "Usage: npx tsx scripts/lib/host/pane-dispatch-trace.ts \\\n" +
  "         --run-id <orchestrating-run-id> [--cwd <repo-root>] \\\n" +
  "         [--target <session-or-workspace>] [--backend cmux|tmux|remote|agent] \\\n" +
  "         [--phase <phase>] --lane <specialist>[:<task-id>[:<pane-id>]] ...\n";

if (require.main === module) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[pane-dispatch-trace] ERROR: ${parsed.error}\n${USAGE}`);
    process.exit(1);
  }
  const emitted = emitPaneDispatchEvents({
    cwd: path.resolve(parsed.cwd),
    runId: parsed.runId,
    target: parsed.target,
    surface: parsed.surface,
    phase: parsed.phase,
    lanes: parsed.lanes,
  });
  process.stdout.write(
    `[pane-dispatch-trace] recorded ${emitted}/${parsed.lanes.length} ` +
      `${parsed.surface} dispatch receipt(s) → .guild/runs/${parsed.runId}/${EVENTS_RELPATH}\n`,
  );
  // A partial write is a real degradation of the run record, not a launch
  // failure: surface it with a non-zero exit so a caller can notice, but the
  // library path (the launcher) still never fails on it.
  process.exit(emitted === parsed.lanes.length ? 0 : 1);
}
