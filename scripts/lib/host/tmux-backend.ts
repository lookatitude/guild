/**
 * scripts/lib/host/tmux-backend.ts
 *
 * TmuxTeamBackend — the shipping tmux implementation behind the TeamBackend seam.
 * Extracted from team-backend.ts (W3 god-file split).
 *
 * Layer: host/ — imports from core/contracts + shared/, no upward imports.
 */

import { hostKindToRegistryId, getRegistryEntry } from "../host-registry";
import { buildPrompt } from "../../../src/modules/prompting/workflows/team-prompt";
import type {
  AdapterResolver,
  LaunchMode,
  ParsedTmuxCommand,
  PaneSpec,
  RunFn,
  Specialist,
  TeamBackend,
  TeamLaunchRequest,
  TeamLaunchResult,
  TmuxPlan,
  TmuxSpawnOutcome,
} from "../core/contracts/team-backend";
import {
  defaultRun,
} from "../core/contracts/team-backend";
import type { HostKind } from "../host-types";

// ── Pure command composition helpers ─────────────────────────────────────────

export function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function wrapLoginShell(command: string, loginShell: string): string {
  return `${loginShell} -lic ${shellQuote(command)}`;
}

export { buildPrompt };

// ── Worker-pane lifecycle (P0.4 / task-cell-runtime G4) ──────────────────────
//
// A completed worker's pane MUST disappear — the old tail `claude <prompt>; exec
// $SHELL` kept the pane alive after the agent exited, so "pane exists" no longer
// meant "worker alive" and the launcher's dismiss/reap could never tell a live
// worker from a lingering shell (audit finding P0.4). The default is now: run the
// worker, and let the pane close when the worker exits.
//
// An operator debug shell is available ONLY behind an explicit opt-in
// (`GUILD_PANE_DEBUG=1`, default OFF). To keep a debug shell from ever being
// confusable with a live worker (adversarial test 14), the debug tail RETITLES its
// own pane to the `guild-debug:` sentinel before dropping into the shell, so every
// liveness / termination check can exclude it via `isDebugShellTitle`.

/** Pane-title prefix stamped on an opt-in operator debug shell — NEVER a live worker. */
export const DEBUG_PANE_TITLE_PREFIX = "guild-debug:";

/** True when `GUILD_PANE_DEBUG=1` opts a completed worker's pane into an operator debug shell. */
export function paneDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["GUILD_PANE_DEBUG"] === "1";
}

/** A pane whose title carries the debug sentinel is an operator shell, not a live worker (AT14). */
export function isDebugShellTitle(title: string): boolean {
  return title.startsWith(DEBUG_PANE_TITLE_PREFIX);
}

export function paneCommand(
  prompt: string,
  runId: string,
  capabilityScope?: string[],
  taskId?: string,
  specialist?: string,
  debug: boolean = paneDebugEnabled(),
): string {
  const taskFragment =
    taskId !== undefined && taskId.length > 0
      ? `export GUILD_TASK_ID=${shellQuote(taskId)}; `
      : "";
  const specialistFragment =
    specialist !== undefined && specialist.length > 0
      ? `export GUILD_SPECIALIST=${shellQuote(specialist)}; `
      : "";
  // guild.task_assignment.v1 — point the pane at its own assignment file so it can
  // read its bounded task via readTaskAssignment (docs/v2 §08). Run-relative path.
  const assignmentFragment =
    specialist !== undefined && specialist.length > 0
      ? `export GUILD_TASK_ASSIGNMENT=${shellQuote(`.guild/runs/${runId}/tasks/${specialist}.json`)}; `
      : "";
  const statuslineFragment =
    process.env["GUILD_STATUSLINE"] === "1" ? `export GUILD_STATUSLINE=1; ` : "";
  const scopeFragment =
    capabilityScope !== undefined
      ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(capabilityScope))}; `
      : "";
  // Worker teardown tail. Default (debug OFF): the pane closes when `claude` exits
  // — no lingering shell, so "pane alive" unambiguously means "worker alive".
  // Debug ON: retitle the pane to the `guild-debug:` sentinel FIRST (so liveness
  // checks never mistake it for a worker), print an unmistakable notice, then drop
  // into a shell for the operator.
  const debugTitle = DEBUG_PANE_TITLE_PREFIX + (specialist !== undefined && specialist.length > 0 ? specialist : "orchestrator");
  const teardownTail = debug
    ? `claude ${shellQuote(prompt)}; ` +
      `tmux select-pane -t "$TMUX_PANE" -T ${shellQuote(debugTitle)} 2>/dev/null || true; ` +
      `echo ${shellQuote("[GUILD_PANE_DEBUG] worker process exited — this is an operator debug shell, NOT a live worker.")}; ` +
      `exec $SHELL`
    : `claude ${shellQuote(prompt)}`;
  return (
    `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; ` +
    `export GUILD_RUN_ID=${shellQuote(runId)}; ` +
    taskFragment +
    specialistFragment +
    assignmentFragment +
    statuslineFragment +
    scopeFragment +
    teardownTail
  );
}

export function composeTmuxCommands(opts: {
  mode: LaunchMode;
  targetName: string;
  cwd: string;
  slug: string;
  runId: string;
  specialists: Specialist[];
  resolveAdapter?: AdapterResolver;
  orchestratorHostKind?: HostKind;
  teamPath?: string;
}): ParsedTmuxCommand[] {
  const {
    mode,
    targetName,
    cwd,
    slug,
    runId,
    specialists,
    resolveAdapter,
    orchestratorHostKind = "claude",
    teamPath,
  } = opts;
  const cmds: ParsedTmuxCommand[] = [];

  const commandFor = (spec: Specialist | null): string => {
    const hostKind: HostKind = spec?.host_kind ?? orchestratorHostKind;
    const prompt = buildPrompt(slug, runId, spec, teamPath, hostKind);
    if (!resolveAdapter)
      return paneCommand(prompt, runId, spec?.capability_scope, spec?.taskId, spec?.name);
    return resolveAdapter(hostKind).command({
      name: spec?.name ?? "orchestrator",
      scope: spec?.scope ?? "",
      runId,
      slug,
      prompt,
      hostKind,
      taskId: spec?.taskId,
      capability_scope: spec?.capability_scope,
      specialist: spec?.name,
    });
  };

  const orchestratorCmd = commandFor(null);

  if (mode === "new-session") {
    cmds.push({
      argv: [
        "tmux", "new-session", "-d", "-s", targetName, "-n", "orchestrator", "-c", cwd, orchestratorCmd,
      ],
      display:
        `tmux new-session -d -s ${shellQuote(targetName)} ` +
        `-n orchestrator -c ${shellQuote(cwd)} ` +
        shellQuote(orchestratorCmd),
    });
  } else {
    cmds.push({
      argv: ["tmux", "new-window", "-n", targetName, "-c", cwd, orchestratorCmd],
      display:
        `tmux new-window -n ${shellQuote(targetName)} ` +
        `-c ${shellQuote(cwd)} ${shellQuote(orchestratorCmd)}`,
    });
  }

  // Title the orchestrator's own pane (applies to the currently-active pane —
  // the one just created by new-session/new-window, before any split moves
  // "active" to a specialist pane below) so spawn() can identify it by title
  // in the pane listing, the same way specialist panes are identified.
  cmds.push({
    argv: ["tmux", "select-pane", "-T", "orchestrator"],
    display: `tmux select-pane -T orchestrator`,
  });

  for (const spec of specialists) {
    const cmd = commandFor(spec);
    cmds.push({
      argv: ["tmux", "split-window", "-t", targetName, "-c", cwd, cmd],
      display:
        `tmux split-window -t ${shellQuote(targetName)} ` +
        `-c ${shellQuote(cwd)} ${shellQuote(cmd)}`,
    });
    cmds.push({
      argv: ["tmux", "select-pane", "-T", spec.name],
      display: `tmux select-pane -T ${shellQuote(spec.name)}`,
    });
  }

  cmds.push({
    argv: ["tmux", "select-layout", "-t", targetName, "tiled"],
    display: `tmux select-layout -t ${shellQuote(targetName)} tiled`,
  });

  if (mode === "in-session") {
    cmds.push({
      argv: ["tmux", "select-window", "-t", targetName],
      display: `tmux select-window -t ${shellQuote(targetName)}`,
    });
  }

  return cmds;
}

export function probeTmuxAvailable(run: RunFn = defaultRun): boolean {
  return run("tmux", ["-V"]).status === 0;
}

// ── Real termination primitive (task-cell-runtime G4, ADR D5) ────────────────
//
// The old `[DISMISS]`/`[AUTO-DISMISS]` was signal-only: it announced a dismissal
// but never killed a live worker's pane, and the reaper only pruned ALREADY-DEAD
// panes. `terminatePane` is the real thing: it kills the pane by id and CONFIRMS
// the death by polling that the pane_id is gone. A kill that does not confirm is an
// ORPHAN — the caller parks the attempt for the reaper, which simply calls this
// again (adversarial test 6). tmux being unavailable is a recorded DEGRADATION, not
// a silent success.

/** The set of live tmux pane ids, or null when tmux is unavailable / errored. */
export function livePaneIds(run: RunFn = defaultRun): Set<string> | null {
  const r = run("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  if (r.status !== 0) return null;
  return new Set(
    r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** True when `paneId` is present in the live pane listing. Fail-closed: unknown tmux state → not alive. */
export function isPaneAlive(paneId: string, run: RunFn = defaultRun): boolean {
  const ids = livePaneIds(run);
  return ids !== null && ids.has(paneId);
}

export interface TerminatePaneOutcome {
  /** True only when the pane is CONFIRMED gone after the kill. */
  ok: boolean;
  /** Whether the poll confirmed the pane_id is no longer live. */
  confirmed: boolean;
  mechanism: "tmux kill-pane";
  paneId: string;
  /** Number of confirmation polls performed. */
  polls: number;
  /** True when tmux was unavailable — a recorded degradation, NOT a silent success (D5). */
  degraded: boolean;
  error?: string;
}

/**
 * Kill a worker's pane and CONFIRM its death.
 *
 *   1. If the pane is already gone → confirmed (idempotent reap).
 *   2. `tmux kill-pane -t <paneId>`.
 *   3. Poll `list-panes` up to `pollAttempts` times; confirmed the moment the
 *      pane_id disappears.
 *
 * `ok: false, confirmed: false` means the pane SURVIVED the kill — an orphan the
 * caller must park for the reaper. `degraded: true` means tmux was unavailable
 * (host-unavailable is a recorded degradation, D5).
 */
export function terminatePane(
  paneId: string,
  opts: { run?: RunFn; pollAttempts?: number } = {},
): TerminatePaneOutcome {
  const run = opts.run ?? defaultRun;
  const pollAttempts = opts.pollAttempts ?? 5;
  const base = { mechanism: "tmux kill-pane" as const, paneId };

  // Dry-run placeholder ids (e.g. "(dry-run)") can never be terminated.
  if (!paneId || paneId.startsWith("(")) {
    return { ...base, ok: false, confirmed: false, polls: 0, degraded: false, error: "no real pane_id (placeholder)" };
  }

  const before = livePaneIds(run);
  if (before === null) {
    return { ...base, ok: false, confirmed: false, polls: 0, degraded: true, error: "tmux unavailable" };
  }
  if (!before.has(paneId)) {
    // Already gone — a confirmed teardown (idempotent).
    return { ...base, ok: true, confirmed: true, polls: 0, degraded: false };
  }

  run("tmux", ["kill-pane", "-t", paneId]);

  let polls = 0;
  for (let i = 0; i < Math.max(1, pollAttempts); i++) {
    polls++;
    const now = livePaneIds(run);
    if (now === null) {
      return { ...base, ok: false, confirmed: false, polls, degraded: true, error: "tmux unavailable during confirm" };
    }
    if (!now.has(paneId)) {
      return { ...base, ok: true, confirmed: true, polls, degraded: false };
    }
  }
  // The pane survived every confirmation poll — an orphan for the reaper.
  return {
    ...base,
    ok: false,
    confirmed: false,
    polls,
    degraded: false,
    error: `pane ${paneId} still live after ${polls} confirmation poll(s)`,
  };
}

// ── TmuxTeamBackend ───────────────────────────────────────────────────────────

export class TmuxTeamBackend implements TeamBackend {
  readonly kind = "tmux" as const;
  private run: RunFn;
  private resolveAdapter?: AdapterResolver;

  constructor(opts: { run?: RunFn; resolveAdapter?: AdapterResolver } = {}) {
    this.run = opts.run ?? defaultRun;
    this.resolveAdapter = opts.resolveAdapter;
  }

  isAvailable(): boolean {
    return probeTmuxAvailable(this.run);
  }

  sessionExists(name: string): boolean {
    return (
      this.run("tmux", ["has-session", "-t", name], {
        stdio: ["ignore", "ignore", "ignore"],
      }).status === 0
    );
  }

  windowExists(name: string): boolean {
    const r = this.run("tmux", ["list-windows", "-F", "#{window_name}"]);
    if (r.status !== 0) return false;
    return r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(name);
  }

  currentSessionName(): string | null {
    const r = this.run("tmux", ["display-message", "-p", "#{session_name}"]);
    if (r.status !== 0) return null;
    const name = r.stdout.trim();
    return name || null;
  }

  plan(req: TeamLaunchRequest): TmuxPlan {
    const commands = composeTmuxCommands({
      mode: req.mode,
      targetName: req.targetName,
      cwd: req.cwd,
      slug: req.slug,
      runId: req.runId,
      specialists: req.specialists,
      resolveAdapter: this.resolveAdapter,
      orchestratorHostKind: req.orchestratorHostKind ?? "claude",
      teamPath: req.teamPath,
    });
    return { mode: req.mode, targetName: req.targetName, commands };
  }

  preflight(specialists: Specialist[], orchestratorHostKind: HostKind = "claude"): {
    ok: boolean;
    failures: Array<{ specialist: string; hostKind: HostKind; message: string }>;
  } {
    if (!this.resolveAdapter) return { ok: true, failures: [] };
    const failures: Array<{ specialist: string; hostKind: HostKind; message: string }> = [];
    const panes: Array<{ name: string; hostKind: HostKind }> = [
      { name: "orchestrator", hostKind: orchestratorHostKind },
      ...specialists.map((s) => ({ name: s.name, hostKind: s.host_kind ?? orchestratorHostKind })),
    ];
    const probed = new Set<HostKind>();
    for (const pane of panes) {
      if (probed.has(pane.hostKind)) continue;
      probed.add(pane.hostKind);
      const r = this.resolveAdapter(pane.hostKind).preflight();
      if (!r.ok) {
        failures.push({ specialist: pane.name, hostKind: pane.hostKind, message: r.message });
      }
    }
    return { ok: failures.length === 0, failures };
  }

  spawn(plan: TmuxPlan): TmuxSpawnOutcome {
    for (const c of plan.commands) {
      const r = this.run(c.argv[0], c.argv.slice(1));
      if (r.status !== 0) {
        if (plan.mode === "in-session") {
          this.run("tmux", ["kill-window", "-t", plan.targetName]);
        } else {
          this.run("tmux", ["kill-session", "-t", plan.targetName]);
        }
        return {
          ok: false,
          failedCommand: c,
          stderr: r.stderr,
          orchestratorPaneId: "",
          teammatePaneIds: {},
        };
      }
    }

    // Scoped to THIS session's window (no `-a`, which lists panes SERVER-WIDE
    // across every other session too — a correctness bug, not just a broader
    // scope: a concurrent guild-team session with a same-named specialist pane
    // title could silently clobber this collection).
    const paneArgs = ["list-panes", "-t", plan.targetName, "-F", "#{pane_index}\t#{pane_id}\t#{pane_title}"];
    const panesR = this.run("tmux", paneArgs);
    const teammates: Record<string, string> = {};
    let orchestratorPaneId = "";
    if (panesR.status === 0) {
      for (const line of panesR.stdout.split("\n")) {
        const [, id, title] = line.split("\t");
        if (!id) continue;
        if (title === "orchestrator") {
          orchestratorPaneId = id;
        } else if (title && title in teammates === false) {
          teammates[title] = id;
        }
      }
    }
    return {
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId,
      teammatePaneIds: teammates,
    };
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    const plan = this.plan(req);
    const plannedCommands = plan.commands.map((c) => c.display);
    if (req.dryRun) {
      return {
        kind: this.kind,
        ok: true,
        plannedCommands,
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: ["dry-run: tmux not invoked"],
      };
    }
    const outcome = this.spawn(plan);
    return {
      kind: this.kind,
      ok: outcome.ok,
      plannedCommands,
      orchestratorPaneId: outcome.orchestratorPaneId || null,
      teammatePaneIds: outcome.teammatePaneIds,
      notes: outcome.ok
        ? []
        : [
            `tmux command failed: ${outcome.failedCommand?.display ?? "(unknown)"}`,
            outcome.stderr,
          ].filter(Boolean),
    };
  }
}

// ── binaryForHostKind (used by remote-backend.ts) ────────────────────────────

export function binaryForHostKind(hostKind: HostKind): string {
  if (hostKind === "antigravity-2") return "agy";
  // NOTE: codex-app used to be special-cased to "claude" here — that was both
  // wrong (a codex-app surface has no reason to launch the claude binary) and
  // unreachable in practice (parseHostKind normalizes "codex-app" before a real
  // dispatch ever reaches this function). Removing the special case doesn't
  // change the resolved value: codex-app's registry row has detection.bin:null
  // (it's a no-CLI app surface), so it still falls through to the generic
  // "claude" default below — now honestly, via that fallback, not a fake branch.
  const id = hostKindToRegistryId(hostKind);
  const bin = id ? getRegistryEntry(id)?.detection.bin : null;
  return bin ?? "claude";
}
