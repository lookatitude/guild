#!/usr/bin/env -S npx tsx
/**
 * scripts/agent-team-launcher.ts
 *
 * Launches Claude Code's experimental agent-team backend in tmux: one pane per
 * specialist listed in .guild/team/<slug>.yaml. The orchestrator (main Claude
 * Code) runs in the first pane; each specialist runs in its own pane with
 * CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 exported, per guild-plan.md §7.3
 * (agent-team backend is opt-in, requires the env var, one team per session).
 *
 * Two launch modes, selected automatically by whether we are already inside a
 * tmux session ($TMUX env var):
 *   - new-session  ($TMUX unset): create a detached session, build the panes,
 *                  then attach the terminal to it.
 *   - in-session   ($TMUX set):   create a NEW WINDOW in the CURRENT session and
 *                  build the panes inside that window, then select it so the
 *                  team is visible. The operator's currently-active pane is
 *                  never split, and no existing pane/window is ever killed.
 * Both modes share the per-pane command/env construction (paneCommand) and the
 * specialist-splitting loop (composeTmuxCommands) so they cannot drift.
 *
 * Called by guild:execute-plan when team.yaml declares backend: agent-team.
 *
 * Usage:
 *   agent-team-launcher --team <path> [--session-name <name>] [--cwd <path>] [--dry-run]
 *
 * Options:
 *   --team <path>          (required) Path to .guild/team/<slug>.yaml.
 *   --session-name <name>  (optional, default: guild-<slug>-<timestamp>)
 *   --cwd <path>           (optional, default ".") Consuming repo root.
 *   --dry-run              (optional) Print tmux commands without executing.
 *
 * Exit codes:
 *   0  Success.
 *   1  Precondition failure (missing args, wrong backend, tmux missing,
 *      session-name collision, or — in-session — team-window collision).
 *   2  tmux command failure while creating the real session/window.
 *
 * Invariants:
 *   - Never writes to .guild/wiki/ (forbidden per tooling-engineer scope).
 *   - One team per session: when $TMUX is set we spawn the team in a NEW window
 *     of the current session (never a nested session) and refuse to clobber an
 *     existing team window of the same name.
 *   - Only auto-runs when team.yaml explicitly declares backend: agent-team.
 *   - All writes stay under <cwd>/.guild/runs/<run-id>/agent-team/.
 *   - --dry-run is always safe: it prints tmux commands + writes session.json
 *     but never invokes tmux.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface Specialist {
  name: string;
  scope: string;
  dependsOn: string[];
  backend?: string;
}

interface TeamYaml {
  backend: string;
  specialists: Specialist[];
}

interface CliArgs {
  team: string | null;
  sessionName: string | null;
  cwd: string;
  dryRun: boolean;
  /** Explicit agent_mode override (D5). null = not provided → use team.yaml backend check (old behavior). */
  agentMode: "team" | "agent" | "subagent" | "auto" | null;
}

interface ParsedTmuxCommand {
  argv: string[];
  display: string;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

const VALID_AGENT_MODE_VALUES = new Set(["team", "agent", "subagent", "auto"]);

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { team: null, sessionName: null, cwd: ".", dryRun: false, agentMode: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--team" && i + 1 < argv.length) out.team = argv[++i];
    else if (a === "--session-name" && i + 1 < argv.length) out.sessionName = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) out.cwd = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--agent-mode=")) {
      const v = a.slice("--agent-mode=".length);
      if (VALID_AGENT_MODE_VALUES.has(v)) out.agentMode = v as CliArgs["agentMode"];
    }
  }
  return out;
}

// ── Minimal YAML parser for our known schema ───────────────────────────────
//
// team.yaml is authored by guild:team-compose with a fixed shape: scalar
// top-level keys (`backend`, `allow_larger`, `spec`, …) and a `specialists:`
// list of inline-or-block maps with `name`, `scope`, `depends-on`. Rather
// than pull in js-yaml as a direct dep, we parse the narrow schema by hand
// and reject anything surprising.

function parseYaml(raw: string): TeamYaml {
  const lines = raw.split(/\r?\n/);
  let backend = "";
  const specialists: Specialist[] = [];
  let inSpecialists = false;
  let cur: Partial<Specialist> | null = null;

  const flush = () => {
    if (cur && cur.name) {
      specialists.push({
        name: cur.name,
        scope: cur.scope ?? "",
        dependsOn: cur.dependsOn ?? [],
        backend: cur.backend,
      });
    }
    cur = null;
  };

  for (const rawLine of lines) {
    // Strip comments outside of quoted strings. Team yaml scope values may
    // contain colons but never unquoted `#`, so this is safe for our schema.
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;

    // Top-level keys (no leading indentation).
    if (!/^\s/.test(line)) {
      flush();
      inSpecialists = false;
      const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim();
      if (key === "specialists") {
        inSpecialists = true;
      } else if (key === "backend") {
        backend = stripQuotes(value);
      }
      continue;
    }

    if (!inSpecialists) continue;

    // List item opener:  "  - name: architect"
    const itemMatch = /^\s+-\s+(.*)$/.exec(line);
    if (itemMatch) {
      flush();
      cur = {};
      const rest = itemMatch[1];
      applyMapEntry(cur, rest);
      continue;
    }

    // Continuation of current map item: "    scope: …"
    if (cur && /^\s+\S/.test(line)) {
      const content = line.replace(/^\s+/, "");
      applyMapEntry(cur, content);
    }
  }
  flush();

  if (!backend) {
    throw new Error("team.yaml missing required top-level `backend:` key");
  }
  return { backend, specialists };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function applyMapEntry(target: Partial<Specialist>, raw: string): void {
  const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
  if (!m) return;
  const key = m[1];
  const value = m[2].trim();
  if (key === "name") target.name = stripQuotes(value);
  else if (key === "scope") target.scope = stripQuotes(value);
  else if (key === "depends-on" || key === "depends_on" || key === "dependsOn") {
    target.dependsOn = parseFlowList(value);
  } else if (key === "backend") target.backend = stripQuotes(value);
}

function parseFlowList(value: string): string[] {
  const t = value.trim();
  if (!t || t === "[]") return [];
  if (t.startsWith("[") && t.endsWith("]")) {
    return t
      .slice(1, -1)
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  return [];
}

// ── tmux command composition ───────────────────────────────────────────────

function slugFromTeamPath(teamPath: string): string {
  const base = path.basename(teamPath);
  return base.replace(/\.ya?ml$/i, "");
}

function buildPrompt(
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

type LaunchMode = "new-session" | "in-session";

function composeTmuxCommands(opts: {
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

function paneCommand(prompt: string, runId: string): string {
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

function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ── Preconditions ──────────────────────────────────────────────────────────

function tmuxAvailable(): boolean {
  const r = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  return r.status === 0;
}

function sessionExists(name: string): boolean {
  const r = spawnSync("tmux", ["has-session", "-t", name], {
    encoding: "utf8",
    // tmux prints to stderr; drop it.
    stdio: ["ignore", "ignore", "ignore"],
  });
  return r.status === 0;
}

// tmux has no `has-window`, so list the current session's windows by name and
// check for an exact match. Used by the in-session one-team-per-session guard:
// if a team window of this name already exists we refuse to clobber it (mirror
// of the new-session sessionExists() collision guard, applied to the window).
function windowExists(name: string): boolean {
  const r = spawnSync("tmux", ["list-windows", "-F", "#{window_name}"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return false;
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(name);
}

// Best-effort resolution of the name of the current ($TMUX) session, for the
// manifest only. Returns null if tmux can't tell us (e.g. dry-run).
function currentSessionName(): string | null {
  const r = spawnSync(
    "tmux",
    ["display-message", "-p", "#{session_name}"],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return null;
  const name = r.stdout.trim();
  return name || null;
}

// ── Manifest write ─────────────────────────────────────────────────────────

interface Manifest {
  run_id: string;
  mode: LaunchMode;
  session_name: string;
  // Non-null only in in-session mode: the window we created in the current
  // session. Null in new-session mode (the whole session is ours).
  window_name: string | null;
  created_at: string;
  orchestrator_pane_id: string;
  teammate_panes: Array<{ specialist: string; pane_id: string }>;
  env: Record<string, string>;
}

function buildManifest(opts: {
  runId: string;
  mode: LaunchMode;
  // Session name (new-session) or the resolved current session (in-session).
  sessionName: string;
  // Window name — only set in in-session mode.
  windowName: string | null;
  specialists: Specialist[];
  dryRun: boolean;
  realPaneIds: { orchestrator: string; teammates: Record<string, string> } | null;
}): Manifest {
  const { runId, mode, sessionName, windowName, specialists, dryRun, realPaneIds } = opts;
  return {
    run_id: runId,
    mode,
    session_name: sessionName,
    window_name: windowName,
    created_at: new Date().toISOString(),
    orchestrator_pane_id: dryRun
      ? "(dry-run: not spawned)"
      : realPaneIds?.orchestrator ?? "(unknown)",
    teammate_panes: specialists.map((s) => ({
      specialist: s.name,
      pane_id: dryRun
        ? "(dry-run: not spawned)"
        : realPaneIds?.teammates?.[s.name] ?? "(unknown)",
    })),
    env: {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      // GUILD_RUN_ID is exported into each pane at spawn time (see composeTmuxCommands)
      // so hooks inside the panes converge on this run-id.
      GUILD_RUN_ID: runId,
    },
  };
}

function makeRunId(): string {
  // Launcher has no session_id — use compact ISO timestamp with "run-" prefix
  // to match the hooks' convention (run-<session_id> / run-<timestamp>).
  // Kept sortable for filesystem listing.
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function writeManifest(cwd: string, manifest: Manifest): string {
  const runId = manifest.run_id;
  const dir = path.join(cwd, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "session.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return out;
}

// ── D5 dispatch ladder ─────────────────────────────────────────────────────
//
// Resolves the execution backend per D5 (v2x-command-surface-dispatch-and-
// internalization.md). Explicit `agent_mode` wins over auto-detection.
// auto resolution order:
//   1. $TMUX set → team (in-session window — PRESERVE shipped in-session fix)
//   2. tmux installed → team (new detached session)
//   3. Host (claude|codex) signals independent agent support → agent
//   4. Fallback → subagent

type AgentModeExplicit = "team" | "agent" | "subagent" | "auto";
interface ResolvedMode {
  mode: "team" | "agent" | "subagent";
  reason: string;
}

/**
 * Returns true when the host signals it supports independent (non-tmux) agents.
 * Signaled via GUILD_INDEPENDENT_AGENTS_SUPPORTED env var. When absent, falls
 * back to GUILD_HOST: claude|auto is assumed to support them; codex currently
 * does not. This env probe is intentionally cheap — no subprocess spawn.
 */
function hostSupportsIndependentAgents(): boolean {
  const explicit = process.env["GUILD_INDEPENDENT_AGENTS_SUPPORTED"];
  if (explicit !== undefined) {
    const s = explicit.trim().toLowerCase();
    return !(s === "0" || s === "false" || s === "no" || s === "off");
  }
  // Default: assume claude (the expected host) supports independent agents.
  const host = (process.env["GUILD_HOST"] ?? "auto").toLowerCase();
  return host === "claude" || host === "auto";
}

/**
 * Resolve the D5 ladder. `dryRun=true` still checks $TMUX and tmux availability
 * so the dry-run output accurately reflects what a real launch would choose.
 *
 * When `explicit` is non-null and not "auto", that value is used directly
 * (subject to availability: pinning "team" on a tmux-less host warns + falls
 * back to "subagent" for real runs; dry-run leaves team as-is to show intent).
 */
function resolveAgentMode(explicit: AgentModeExplicit | null, dryRun: boolean): ResolvedMode {
  const val: AgentModeExplicit = explicit ?? "auto";

  if (val === "team") {
    // Pinned team: validate tmux availability for real launches.
    if (!dryRun && !tmuxAvailable()) {
      process.stderr.write(
        "[agent-team-launcher] WARN: agent_mode=team pinned but tmux is not available — " +
          "falling back to subagent. Install tmux or use agent_mode=auto.\n"
      );
      return { mode: "subagent", reason: "agent_mode=team pinned but tmux unavailable → subagent fallback" };
    }
    return { mode: "team", reason: "explicit agent_mode=team" };
  }

  if (val === "agent") {
    return { mode: "agent", reason: "explicit agent_mode=agent" };
  }

  if (val === "subagent") {
    return { mode: "subagent", reason: "explicit agent_mode=subagent" };
  }

  // auto — D5 ladder
  // Step 1: inside a tmux session → team in-session (preserves shipped fix)
  if (process.env["TMUX"]) {
    return { mode: "team", reason: "auto: $TMUX set → team in-session" };
  }

  // Step 2: tmux installed but not currently inside one → team new-session
  if (tmuxAvailable()) {
    return { mode: "team", reason: "auto: tmux installed → team new-session" };
  }

  // Step 3: host signals independent agent support → agent
  if (hostSupportsIndependentAgents()) {
    return { mode: "agent", reason: "auto: host supports independent agents → agent" };
  }

  // Step 4: fallback
  return { mode: "subagent", reason: "auto: no tmux, no independent-agent support → subagent" };
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.team) {
    process.stderr.write(
      "[agent-team-launcher] ERROR: --team <path> is required.\n"
    );
    process.exit(1);
  }

  if (!fs.existsSync(args.team)) {
    process.stderr.write(
      `[agent-team-launcher] ERROR: team file not found: ${args.team}\n`
    );
    process.exit(1);
  }

  let team: TeamYaml;
  try {
    team = parseYaml(fs.readFileSync(args.team, "utf8"));
  } catch (err) {
    process.stderr.write(
      `[agent-team-launcher] ERROR: could not parse ${args.team}: ${(err as Error).message}\n`
    );
    process.exit(1);
  }

  // ── D5 dispatch ladder ────────────────────────────────────────────────────
  // When --agent-mode is provided, run the D5 ladder. Non-team modes emit a
  // JSON signal so the caller (guild:execute-plan) can route accordingly.
  // When --agent-mode is absent, fall through to the legacy team.backend check
  // for backward compatibility with existing callers.
  if (args.agentMode !== null) {
    const { mode: resolvedMode, reason } = resolveAgentMode(args.agentMode, args.dryRun);
    if (resolvedMode !== "team") {
      // Non-team backend: emit JSON signal and exit 0. The caller reads this
      // to dispatch via the Agent tool (agent) or inline subagent path.
      const signal = {
        backend: resolvedMode,
        reason,
        slug: slugFromTeamPath(args.team),
      };
      process.stdout.write(JSON.stringify(signal) + "\n");
      process.exit(0);
    }
    // resolvedMode === "team" → fall through to the tmux launch below.
    // (Skip the legacy team.backend check — agent_mode=team|auto overrides it.)
  } else {
    // Legacy behavior: require team.yaml to declare backend: agent-team.
    if (team.backend !== "agent-team") {
      process.stderr.write(
        `[agent-team-launcher] ERROR: team.yaml declares backend: ${team.backend || "(missing)"}.\n` +
          `  This launcher only runs when backend is exactly "agent-team".\n` +
          `  For backend: subagent, use the standard guild:execute-plan dispatch path\n` +
          `  (it invokes specialists via the Agent tool, not tmux).\n`
      );
      process.exit(1);
    }
  }

  // Launch-mode selection (guild-plan.md §7.3, one team per session). If we are
  // already inside a tmux session ($TMUX set), DO NOT refuse — instead spawn the
  // team in a NEW WINDOW of the current session (in-session mode) so the panes
  // are visible. Outside tmux we create + attach a fresh detached session.
  const mode: LaunchMode = process.env["TMUX"] ? "in-session" : "new-session";

  if (team.specialists.length === 0) {
    process.stderr.write(
      "[agent-team-launcher] ERROR: team.yaml has no specialists; nothing to spawn.\n"
    );
    process.exit(1);
  }

  const slug = slugFromTeamPath(args.team);
  // The `-t` target name. In new-session mode it is the session name and carries
  // a timestamp so back-to-back runs never self-collide. In in-session mode it
  // is the window name: deterministic (no timestamp) so the one-team-per-session
  // guard below actually fires when the same team is re-launched in a session.
  const targetName =
    args.sessionName ??
    (mode === "in-session"
      ? `guild-${slug}`
      : `guild-${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const cwd = path.resolve(args.cwd);

  // For real (non-dry-run) launches: tmux must be installed, and the target must
  // not already exist (refuse to clobber). Which collision we check depends on
  // the mode: a session name (new-session) or a team window in the current
  // session (in-session). dry-run skips this — it never invokes tmux.
  if (!args.dryRun) {
    if (!tmuxAvailable()) {
      process.stderr.write(
        "[agent-team-launcher] ERROR: `tmux` is not installed or not on PATH.\n" +
          "  Install tmux (macOS: `brew install tmux`; Debian/Ubuntu: `apt install tmux`),\n" +
          "  then re-run. (Without tmux, use backend: subagent — guild:execute-plan\n" +
          "  dispatches specialists via the Agent tool, no tmux required.)\n"
      );
      process.exit(1);
    }
    if (mode === "in-session") {
      // One-team-per-session guard (§7.3): refuse to clobber an existing team
      // window of the same name in the current session.
      if (windowExists(targetName)) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: a Guild team window "${targetName}" already exists ` +
            `in the current tmux session.\n` +
            `  Refusing to clobber it (one team per session, guild-plan.md §7.3).\n` +
            `  Switch to it:  tmux select-window -t ${shellQuote(targetName)}\n` +
            `  Or remove it:  tmux kill-window -t ${shellQuote(targetName)}\n` +
            `  Then re-run, or pass --session-name <unique-name> for a differently-named window.\n`
        );
        process.exit(1);
      }
    } else if (sessionExists(targetName)) {
      process.stderr.write(
        `[agent-team-launcher] ERROR: tmux session "${targetName}" already exists.\n` +
          `  Refusing to clobber. Re-run with --session-name <unique-name>.\n`
      );
      process.exit(1);
    }
  }

  // Mint the unified run-id ONCE per launcher invocation and thread it through
  // both prompts and the manifest. Exported into each pane's env so hooks
  // inside (capture-telemetry, maybe-reflect, agent-team handlers) converge
  // on the same `.guild/runs/<run-id>/` path.
  const runId = makeRunId();

  const commands = composeTmuxCommands({
    mode,
    targetName,
    cwd,
    slug,
    runId,
    specialists: team.specialists,
  });

  if (args.dryRun) {
    process.stdout.write(
      "[agent-team-launcher] dry-run — would execute the following tmux commands:\n"
    );
    for (const c of commands) process.stdout.write(`  ${c.display}\n`);
    // new-session mode finishes by attaching the terminal; in-session mode does
    // NOT attach (the select-window above already surfaced the team window).
    if (mode === "new-session") {
      process.stdout.write(
        `  tmux attach-session -t ${shellQuote(targetName)}\n`
      );
    }

    const manifestPath = writeManifest(
      cwd,
      buildManifest({
        runId,
        mode,
        sessionName: mode === "in-session" ? "(dry-run: current tmux session)" : targetName,
        windowName: mode === "in-session" ? targetName : null,
        specialists: team.specialists,
        dryRun: true,
        realPaneIds: null,
      })
    );
    process.stdout.write(
      `[agent-team-launcher] wrote session manifest → ${manifestPath}\n`
    );
    process.exit(0);
  }

  // Real run: execute tmux commands.
  for (const c of commands) {
    const r = spawnSync(c.argv[0], c.argv.slice(1), { encoding: "utf8" });
    if (r.status !== 0) {
      process.stderr.write(
        `[agent-team-launcher] tmux command failed: ${c.display}\n` +
          `  stderr: ${r.stderr}\n`
      );
      // Best-effort teardown of the partially-created target. In in-session mode
      // we must ONLY kill the window we created — never the operator's session.
      if (mode === "in-session") {
        spawnSync("tmux", ["kill-window", "-t", targetName]);
      } else {
        spawnSync("tmux", ["kill-session", "-t", targetName]);
      }
      process.exit(2);
    }
  }

  // Collect real pane IDs. In new-session mode we scan all panes (-a) and map by
  // title; in in-session mode we scope to the team window so we don't pick up
  // panes from the operator's other windows.
  const panesR = spawnSync(
    "tmux",
    mode === "in-session"
      ? [
          "list-panes",
          "-t",
          targetName,
          "-F",
          "#{pane_index}\t#{pane_id}\t#{pane_title}",
        ]
      : [
          "list-panes",
          "-t",
          targetName,
          "-a",
          "-F",
          "#{pane_index}\t#{pane_id}\t#{pane_title}",
        ],
    { encoding: "utf8" }
  );
  const orchestratorId = "";
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

  const manifestPath = writeManifest(
    cwd,
    buildManifest({
      runId,
      mode,
      sessionName:
        mode === "in-session"
          ? currentSessionName() ?? "(current tmux session)"
          : targetName,
      windowName: mode === "in-session" ? targetName : null,
      specialists: team.specialists,
      dryRun: false,
      realPaneIds: { orchestrator: orchestratorId, teammates },
    })
  );

  if (mode === "in-session") {
    // Already attached to this session — selecting the window (done above) is
    // what surfaces the team. Do NOT attach; just tell the operator where it is.
    process.stdout.write(
      `[agent-team-launcher] team window "${targetName}" created in the current session; ` +
        `manifest → ${manifestPath}\n` +
        `  Switch to it any time with: tmux select-window -t ${shellQuote(targetName)}\n`
    );
    process.exit(0);
  }

  process.stdout.write(
    `[agent-team-launcher] session ${targetName} created; manifest → ${manifestPath}\n`
  );

  // Attach user's terminal to the new session.
  const attach = spawnSync("tmux", ["attach-session", "-t", targetName], {
    stdio: "inherit",
  });
  process.exit(attach.status ?? 0);
}

main();
