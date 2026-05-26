/**
 * scripts/lib/team-backend.ts
 *
 * RE-4 — the `TeamBackend` seam.
 *
 * Contract (BY POINTER): docs/knowledge/decisions/v2-runtime-and-execution-model.md
 *   §RE-4 (TeamBackend seam), §RE-5/§RE-6 are siblings owned by
 *   scripts/write-host-capability.ts and scripts/write-run-manifest.ts.
 * D5 dispatch ladder (which backend `auto` resolves to) is canonical in
 *   docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md.
 *
 * Extracts the tmux spawn logic that used to live inline in
 * scripts/agent-team-launcher.ts behind a backend-agnostic interface so the
 * runtime can grow non-tmux execution targets without re-touching the launcher:
 *
 *   - TmuxTeamBackend     — the shipping behavior, refactored behind the seam.
 *                           Owns tmux probes (availability, session/window
 *                           collision), pure command composition, and the
 *                           spawn/teardown loop. The launcher delegates to it.
 *   - InProcessTeamBackend — stub. Conforms to the interface; spawn is not yet
 *                           implemented (returns ok:false with a note, never
 *                           throws — graceful so callers can fall back).
 *   - RemoteTeamBackend    — SEAM ONLY. Interface present, `launch()` throws
 *                           NotImplemented. Cross-host dispatch lands a later
 *                           wave; this file declares the shape it must satisfy.
 *
 * REGRESSION INVARIANT: TmuxTeamBackend reproduces the launcher's prior tmux
 * behavior byte-for-byte — identical `display` strings, identical spawnSync
 * calls, identical teardown (kill-window in-session / kill-session new-session),
 * identical pane-id collection. The launcher's externally-observable output
 * (stdout / stderr / exit codes / session.json) is unchanged.
 */

import { spawnSync } from "child_process";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface Specialist {
  name: string;
  scope: string;
  dependsOn: string[];
  backend?: string;
}

export type LaunchMode = "new-session" | "in-session";

export interface ParsedTmuxCommand {
  argv: string[];
  display: string;
}

export type TeamBackendKind = "tmux" | "in-process" | "remote";

/**
 * Backend-agnostic launch request. `mode` / `targetName` are tmux topology
 * hints; non-tmux backends may ignore them.
 */
export interface TeamLaunchRequest {
  slug: string;
  runId: string;
  cwd: string;
  specialists: Specialist[];
  targetName: string;
  mode: LaunchMode;
  dryRun: boolean;
}

/** Backend-agnostic launch outcome (what callers that use the seam see). */
export interface TeamLaunchResult {
  kind: TeamBackendKind;
  ok: boolean;
  /** Human-readable planned actions (dry-run prints these). */
  plannedCommands: string[];
  orchestratorPaneId: string | null;
  teammatePaneIds: Record<string, string>;
  notes: string[];
}

/**
 * The seam. Every execution target implements this. The current tmux launcher
 * leans on the richer TmuxTeamBackend surface (below) for its collision UX, but
 * any caller that does not care about tmux specifics can drive a team through
 * just these three members.
 */
export interface TeamBackend {
  readonly kind: TeamBackendKind;
  /** Usable in the current environment? */
  isAvailable(): boolean;
  /** Plan + spawn a team. RemoteTeamBackend is the only impl that throws. */
  launch(req: TeamLaunchRequest): TeamLaunchResult;
}

// ── Injectable subprocess runner (test seam) ─────────────────────────────────

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type RunFn = (
  cmd: string,
  args: string[],
  opts?: Record<string, unknown>
) => RunResult;

const defaultRun: RunFn = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts } as never);
  return {
    status: r.status,
    stdout: (r.stdout as string | null) ?? "",
    stderr: (r.stderr as string | null) ?? "",
  };
};

// ── Pure command composition (exported for reuse + testing) ──────────────────

export function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function buildPrompt(
  slug: string,
  runId: string,
  specialist: Specialist | null
): string {
  if (!specialist) {
    return (
      `You are the Guild orchestrator for team \`${slug}\`, run-id \`${runId}\`. ` +
      `The spec is at \`.guild/spec/${slug}.md\`, the team at \`.guild/team/${slug}.yaml\`, ` +
      `and the approved plan at \`.guild/plan/${slug}.md\`. ` +
      `Per-specialist context bundles are under \`.guild/context/${runId}/<specialist>-<task-id>.md\` ` +
      `(build them via guild:context-assemble before dispatch). ` +
      `Teammate handoff receipts will land at \`.guild/runs/${runId}/handoffs/<specialist>-<task-id>.md\`. ` +
      `Dispatch specialists via TaskCreated events when their plan dependencies clear, ` +
      `then aggregate handoffs and invoke guild:review → guild:verify-done → guild:reflect.`
    );
  }
  return (
    `You are the \`${specialist.name}\` teammate for run-id \`${runId}\`. ` +
    `Your lane scope: \`${specialist.scope}\`. ` +
    `Read your context bundle at \`.guild/context/${runId}/${specialist.name}-<task-id>.md\` — ` +
    `it is authoritative; privilege it over any ambient CLAUDE.md / auto-memory (§9.1). ` +
    `When you finish, write your §8.2 handoff receipt to ` +
    `\`.guild/runs/${runId}/handoffs/${specialist.name}-<task-id>.md\` with all 5 fields ` +
    `(changed_files, opens_for, assumptions, evidence, followups). ` +
    `Wait for a \`TaskCreated\` event from the orchestrator before starting.`
  );
}

export function paneCommand(prompt: string, runId: string): string {
  // The agent-team env var must be exported in every pane (§7.3).
  // GUILD_RUN_ID is also exported so hooks inside the pane converge on the
  // launcher's session manifest path (unified run-id convention with
  // capture-telemetry.ts / maybe-reflect.ts / agent-team handlers).
  // We keep the pane alive after `claude` exits so the user can inspect handoffs.
  return (
    `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; ` +
    `export GUILD_RUN_ID=${shellQuote(runId)}; ` +
    `claude ${shellQuote(prompt)}; ` +
    `exec $SHELL`
  );
}

export interface TmuxPlan {
  mode: LaunchMode;
  targetName: string;
  commands: ParsedTmuxCommand[];
}

export function composeTmuxCommands(opts: {
  mode: LaunchMode;
  // In new-session mode this is the tmux session name; in in-session mode it is
  // the name of the new window created inside the current session. Either way
  // it is the `-t` target every subsequent split/layout/select command points
  // at, so the two paths share the specialist-splitting loop below.
  targetName: string;
  cwd: string;
  slug: string;
  runId: string;
  specialists: Specialist[];
}): ParsedTmuxCommand[] {
  const { mode, targetName, cwd, slug, runId, specialists } = opts;
  const cmds: ParsedTmuxCommand[] = [];

  // Claude Code invocation is the same for every pane: set env vars, cd
  // into the consumer repo, then launch `claude` with a staging prompt. We
  // rely on the user's PATH to find the `claude` binary; if it is unresolved
  // the pane will surface that error directly.
  const orchestratorCmd = paneCommand(buildPrompt(slug, runId, null), runId);

  if (mode === "new-session") {
    // Pane 1: detached session with the orchestrator.
    cmds.push({
      argv: [
        "tmux",
        "new-session",
        "-d",
        "-s",
        targetName,
        "-n",
        "orchestrator",
        "-c",
        cwd,
        orchestratorCmd,
      ],
      display:
        `tmux new-session -d -s ${shellQuote(targetName)} ` +
        `-n orchestrator -c ${shellQuote(cwd)} ` +
        shellQuote(orchestratorCmd),
    });
  } else {
    // in-session: create the orchestrator in a NEW WINDOW of the CURRENT
    // session. This does NOT touch the operator's currently-active pane — it
    // adds a sibling window we will populate and then select. The window name
    // (targetName) doubles as the `-t` target for the splits below.
    cmds.push({
      argv: ["tmux", "new-window", "-n", targetName, "-c", cwd, orchestratorCmd],
      display:
        `tmux new-window -n ${shellQuote(targetName)} ` +
        `-c ${shellQuote(cwd)} ${shellQuote(orchestratorCmd)}`,
    });
  }

  // One split per specialist. `-t targetName` resolves to the active pane of
  // the target session (new-session) or window (in-session); after each split
  // the new pane becomes active, so the next split chains off it. Shared by
  // both modes so the pane/env construction cannot drift.
  for (const spec of specialists) {
    const cmd = paneCommand(buildPrompt(slug, runId, spec), runId);
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

  // Even out pane sizes.
  cmds.push({
    argv: ["tmux", "select-layout", "-t", targetName, "tiled"],
    display: `tmux select-layout -t ${shellQuote(targetName)} tiled`,
  });

  // in-session: make the team window visible. We do NOT attach (we are already
  // attached to this session) — selecting the window is what surfaces the panes.
  if (mode === "in-session") {
    cmds.push({
      argv: ["tmux", "select-window", "-t", targetName],
      display: `tmux select-window -t ${shellQuote(targetName)}`,
    });
  }

  return cmds;
}

// ── tmux availability probe (shared by launcher's D5 ladder + the backend) ───

export function probeTmuxAvailable(run: RunFn = defaultRun): boolean {
  return run("tmux", ["-V"]).status === 0;
}

// ── TmuxTeamBackend — the shipping implementation, behind the seam ───────────

export interface TmuxSpawnOutcome {
  ok: boolean;
  failedCommand: ParsedTmuxCommand | null;
  stderr: string;
  orchestratorPaneId: string;
  teammatePaneIds: Record<string, string>;
}

export class TmuxTeamBackend implements TeamBackend {
  readonly kind = "tmux" as const;
  private run: RunFn;

  constructor(opts: { run?: RunFn } = {}) {
    this.run = opts.run ?? defaultRun;
  }

  isAvailable(): boolean {
    return probeTmuxAvailable(this.run);
  }

  sessionExists(name: string): boolean {
    return (
      this.run("tmux", ["has-session", "-t", name], {
        // tmux prints to stderr; drop it.
        stdio: ["ignore", "ignore", "ignore"],
      }).status === 0
    );
  }

  // tmux has no `has-window`, so list the current session's windows by name and
  // check for an exact match (mirror of the new-session sessionExists guard).
  windowExists(name: string): boolean {
    const r = this.run("tmux", ["list-windows", "-F", "#{window_name}"]);
    if (r.status !== 0) return false;
    return r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(name);
  }

  // Best-effort name of the current ($TMUX) session, for the manifest only.
  currentSessionName(): string | null {
    const r = this.run("tmux", ["display-message", "-p", "#{session_name}"]);
    if (r.status !== 0) return null;
    const name = r.stdout.trim();
    return name || null;
  }

  /** Pure: compose the tmux command list for this request. No side effects. */
  plan(req: TeamLaunchRequest): TmuxPlan {
    const commands = composeTmuxCommands({
      mode: req.mode,
      targetName: req.targetName,
      cwd: req.cwd,
      slug: req.slug,
      runId: req.runId,
      specialists: req.specialists,
    });
    return { mode: req.mode, targetName: req.targetName, commands };
  }

  /**
   * Execute a plan. On first failure, tear down the partial target (kill the
   * window we created in-session; kill the whole session in new-session) and
   * return ok:false with the offending command + stderr. On success, collect
   * teammate pane ids (best-effort; scoped to the window in-session, all panes
   * in new-session). The orchestrator pane id is intentionally left empty to
   * match the prior launcher behavior.
   */
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

    const paneArgs =
      plan.mode === "in-session"
        ? [
            "list-panes",
            "-t",
            plan.targetName,
            "-F",
            "#{pane_index}\t#{pane_id}\t#{pane_title}",
          ]
        : [
            "list-panes",
            "-t",
            plan.targetName,
            "-a",
            "-F",
            "#{pane_index}\t#{pane_id}\t#{pane_title}",
          ];
    const panesR = this.run("tmux", paneArgs);
    const teammates: Record<string, string> = {};
    if (panesR.status === 0) {
      for (const line of panesR.stdout.split("\n")) {
        const [, id, title] = line.split("\t");
        if (!id) continue;
        if (title && title in teammates === false) {
          teammates[title] = id;
        }
      }
    }
    return {
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "",
      teammatePaneIds: teammates,
    };
  }

  /** Seam-conformant coarse entry: plan + (unless dry-run) spawn. */
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

// ── InProcessTeamBackend — stub (RE-4) ───────────────────────────────────────

/**
 * Spawns teammates in-process (no tmux, no separate panes). Not yet
 * implemented — conforms to the seam so the launcher/router can target it, but
 * `launch()` is a graceful no-op that returns ok:false with a note. It never
 * throws, so a caller can fall back to another backend.
 */
export class InProcessTeamBackend implements TeamBackend {
  readonly kind = "in-process" as const;

  // In-process spawn needs no tmux, so the host is "capable"; the impl is what
  // is pending. Kept true so the seam is discoverable; callers check the
  // launch() result's `ok`/`notes` before relying on it.
  isAvailable(): boolean {
    return true;
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    return {
      kind: this.kind,
      ok: false,
      plannedCommands: [],
      orchestratorPaneId: null,
      teammatePaneIds: {},
      notes: [
        `InProcessTeamBackend is a stub — in-process team spawn not yet ` +
          `implemented (RE-4 seam; team \`${req.slug}\`, run-id \`${req.runId}\`).`,
      ],
    };
  }
}

// ── RemoteTeamBackend — SEAM ONLY (RE-4) ─────────────────────────────────────

/**
 * Cross-host team dispatch. SEAM ONLY for this wave: the shape is declared so
 * the cross-host router (next wave, reading guild.host_capability.v1) can be
 * typed against it, but `launch()` throws NotImplemented. `isAvailable()`
 * returns false so an `auto` resolver never selects it yet.
 */
export class RemoteTeamBackend implements TeamBackend {
  readonly kind = "remote" as const;

  isAvailable(): boolean {
    return false;
  }

  launch(_req: TeamLaunchRequest): TeamLaunchResult {
    throw new Error(
      "RemoteTeamBackend not implemented — cross-host team dispatch lands a " +
        "later wave (RE-4 seam; see docs/knowledge/decisions/" +
        "v2-runtime-and-execution-model.md §RE-4)."
    );
  }
}
