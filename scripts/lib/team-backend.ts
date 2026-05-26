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

/**
 * CLI brand of a host. Canonical home for the cross-host union (CH-1/CH-2 of
 * docs/knowledge/decisions/v2-cross-host-orchestration.md). `pane-adapter.ts`
 * and `host-router.ts` import it from here; `write-host-capability.ts` declares
 * an identical `"claude" | "codex"` union (kept separate to avoid a module
 * import cycle — the two are structurally assignable).
 */
export type HostKind = "claude" | "codex";

export interface Specialist {
  name: string;
  scope: string;
  dependsOn: string[];
  backend?: string;
  /**
   * CH-1 (cross-host ADR): per-specialist host brand from `team.yaml`'s `host:`
   * field. Optional + additive — absent ⇒ the orchestrator host (claude), so a
   * team with no `host_kind` on any specialist composes byte-identically to the
   * Claude-only path. Consulted only when a PaneAdapter resolver is wired.
   */
  host_kind?: HostKind;
}

// ── PaneAdapter seam (CH-2, cross-host ADR) ──────────────────────────────────
//
// The provider-neutral seam that lets `TmuxTeamBackend` spawn a pane on any CLI
// brand. The interface lives HERE (the lowest-level lib) so composeTmuxCommands
// can type against it without importing the concrete adapters; the concrete
// `ClaudePaneAdapter` / `CodexPaneAdapter` + the `host_kind`-keyed `ADAPTERS`
// map live in `pane-adapter.ts` (one-directional import → no cycle).
// Canonical body: docs/knowledge/decisions/v2-cross-host-orchestration.md §CH-2.

/** What a single pane needs to render its launch command + env. */
export interface PaneSpec {
  /** Specialist name, or "orchestrator" for the lead pane. */
  name: string;
  scope: string;
  runId: string;
  slug: string;
  /** Pre-built staging prompt (from buildPrompt). */
  prompt: string;
  hostKind: HostKind;
}

/** Result of a pre-spawn binary/credential probe (CH-6 fail-fast). */
export interface PreflightResult {
  ok: boolean;
  message: string;
}

/**
 * Provider-neutral pane adapter. One implementation per `host_kind`. Adding a
 * future host (Gemini, …) is one new adapter file — no launcher-core change.
 */
export interface PaneAdapter {
  readonly hostKind: HostKind;
  /** Bumped when the spawn command/env shape changes (recorded in CH-5). */
  readonly adapterVersion: string;
  /** Binary + credential check run BEFORE any pane spawns (CH-6). */
  preflight(): PreflightResult;
  /** Shell command for the pane (self-contained: exports env inline). */
  command(spec: PaneSpec): string;
  /** Env vars for the pane (informational / manifest; command() inlines them). */
  env(spec: PaneSpec): Record<string, string>;
  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request">;
}

/** Resolver: host brand → its adapter (default map lives in pane-adapter.ts). */
export type AdapterResolver = (hostKind: HostKind) => PaneAdapter;

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
  /**
   * CH-1 (cross-host): optional per-pane adapter resolver. When ABSENT the
   * legacy Claude-only path runs verbatim (`paneCommand(buildPrompt(...))`),
   * so single-host teams compose byte-identically to today (the launcher
   * regression anchor). When PRESENT, each pane's command is produced by the
   * adapter for its `host_kind` — the orchestrator pane is ALWAYS the claude
   * host (CH-4: orchestrator = the starting host).
   */
  resolveAdapter?: AdapterResolver;
}): ParsedTmuxCommand[] {
  const { mode, targetName, cwd, slug, runId, specialists, resolveAdapter } = opts;
  const cmds: ParsedTmuxCommand[] = [];

  // Per-pane command builder. Default (no resolver) path is the legacy
  // Claude-only invocation: set env vars, cd into the consumer repo, then
  // launch `claude` with a staging prompt — relying on PATH to find `claude`.
  // With a resolver, the pane's host_kind picks the adapter; the orchestrator
  // (spec === null) is pinned to claude regardless (CH-4).
  const commandFor = (spec: Specialist | null): string => {
    const prompt = buildPrompt(slug, runId, spec);
    if (!resolveAdapter) return paneCommand(prompt, runId);
    const hostKind: HostKind = spec?.host_kind ?? "claude";
    return resolveAdapter(hostKind).command({
      name: spec?.name ?? "orchestrator",
      scope: spec?.scope ?? "",
      runId,
      slug,
      prompt,
      hostKind,
    });
  };

  const orchestratorCmd = commandFor(null);

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
  /**
   * CH-1 (cross-host): optional per-pane adapter resolver. When undefined the
   * backend behaves exactly as the shipped Claude-only launcher (the
   * regression anchor). The launcher constructs `new TmuxTeamBackend()` with no
   * resolver, so its default path is unchanged. A mixed-host caller injects a
   * resolver (e.g. pane-adapter's `resolveAdapter`) to spawn per-host panes.
   */
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
      resolveAdapter: this.resolveAdapter,
    });
    return { mode: req.mode, targetName: req.targetName, commands };
  }

  /**
   * CH-6 — fail-fast preflight. Probe every pane's adapter (orchestrator =
   * claude, plus each specialist's host) BEFORE any pane spawns. On the first
   * failure the caller MUST abort with zero panes opened, naming the failing
   * specialist + host + missing dependency (no partial spawn).
   *
   * No-op (always ok) when no adapter resolver is wired — the legacy Claude-only
   * launcher never preflighted (it let the pane surface a missing `claude`), so
   * this preserves that behavior for single-host teams.
   */
  preflight(specialists: Specialist[]): {
    ok: boolean;
    failures: Array<{ specialist: string; hostKind: HostKind; message: string }>;
  } {
    if (!this.resolveAdapter) return { ok: true, failures: [] };
    const failures: Array<{ specialist: string; hostKind: HostKind; message: string }> = [];
    // Orchestrator pane is always the claude host (CH-4).
    const panes: Array<{ name: string; hostKind: HostKind }> = [
      { name: "orchestrator", hostKind: "claude" },
      ...specialists.map((s) => ({ name: s.name, hostKind: s.host_kind ?? "claude" })),
    ];
    // De-dupe identical (host) probes — preflight per distinct host is enough,
    // but we report against the first specialist that needs it.
    for (const pane of panes) {
      const r = this.resolveAdapter(pane.hostKind).preflight();
      if (!r.ok) {
        failures.push({ specialist: pane.name, hostKind: pane.hostKind, message: r.message });
      }
    }
    return { ok: failures.length === 0, failures };
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
