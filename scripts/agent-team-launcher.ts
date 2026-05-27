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
// RE-4: the tmux spawn logic now lives behind the TeamBackend seam. The
// launcher is the CLI front-end (arg parse + D5 ladder + collision UX +
// manifest + attach) and delegates compose/probe/spawn to TmuxTeamBackend.
// See scripts/lib/team-backend.ts and the §RE-4 contract pointer there.
import {
  TmuxTeamBackend,
  RemoteTeamBackend,
  SshRemoteTransport,
  probeTmuxAvailable,
  shellQuote,
  type Specialist,
  type LaunchMode,
  type HostKind,
  type RemoteHostTarget,
} from "./lib/team-backend";
// P1-3 A2a/A2b: dismissible detection + force-reap of dead panes.
import {
  detectDismissible,
  reapDeadMembers,
  sessionJsonPath,
  listRunnableRunIds,
} from "./lib/reaping";
// CH-1/CH-2: mixed-host pane adapters (claude + codex) for a mixed `host:` team.
import { resolveAdapter } from "./lib/pane-adapter";
// CH-1: route each specialist to its backend (local tmux vs remote) via the
// CR-1 routing function, reading guild.host_capability.v1 manifests.
import { planTeamRouting, RouteError, type RoutableHost } from "./lib/host-router";

const ADAPTER_VERSION = "1"; // CH-5 — PaneAdapter version recorded per pane.

// ── Types ──────────────────────────────────────────────────────────────────

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
  /**
   * P1-3 A2b: force-reap dead members from the team registry.
   * When set, skip the normal launch path and run reapDeadMembers for the
   * specified run (--run-id) or all runs under <cwd>/.guild/runs/ that have a
   * session.json.  Exits 0 on completion.
   */
  reap: boolean;
  /**
   * P1-3: explicit run ID (used with --reap or future ops).
   * null = not provided; callers may default to scanning all runs.
   */
  runId: string | null;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

const VALID_AGENT_MODE_VALUES = new Set(["team", "agent", "subagent", "auto"]);

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    team: null,
    sessionName: null,
    cwd: ".",
    dryRun: false,
    agentMode: null,
    reap: false,
    runId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--team" && i + 1 < argv.length) out.team = argv[++i];
    else if (a === "--session-name" && i + 1 < argv.length) out.sessionName = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) out.cwd = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reap") out.reap = true;
    else if (a === "--run-id" && i + 1 < argv.length) out.runId = argv[++i];
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
        host_kind: cur.host_kind,
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
  // CH-1: per-specialist `host:` brand. Only the known brands are accepted; an
  // unknown value is ignored (the pane defaults to the orchestrator host,
  // claude), keeping the parser lenient like the rest of the known schema.
  else if (key === "host" || key === "host_kind") {
    const hk = parseHostKind(value);
    if (hk) target.host_kind = hk;
  }
}

function parseHostKind(value: string): HostKind | undefined {
  const v = stripQuotes(value).trim().toLowerCase();
  return v === "claude" || v === "codex" ? v : undefined;
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
//
// buildPrompt / paneCommand / shellQuote / composeTmuxCommands and the tmux
// probes (availability, session/window collision, current-session name) moved
// to scripts/lib/team-backend.ts (RE-4) and are reached through a single
// `tmux` TmuxTeamBackend instance in main(). slugFromTeamPath stays here — it
// is CLI-path parsing, not tmux behavior.

function slugFromTeamPath(teamPath: string): string {
  const base = path.basename(teamPath);
  return base.replace(/\.ya?ml$/i, "");
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
  // CH-5: `host_kind` + `adapter_version` are additive optional per-pane fields
  // under the lenient-reader rule (no schema_version bump). Existing readers
  // ignore them; resume/telemetry read host_kind from here rather than
  // re-inferring the CLI brand.
  teammate_panes: Array<{
    specialist: string;
    pane_id: string;
    host_kind: HostKind;
    adapter_version: string;
  }>;
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
      host_kind: s.host_kind ?? "claude",
      adapter_version: ADAPTER_VERSION,
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

// ── Cross-host routing inputs (CH-1) ─────────────────────────────────────────
//
// Best-effort load of the guild.host_capability.v1 manifests the CR-1 router
// reads. Absent dir / unreadable files ⇒ empty list (single-host behavior).

function loadHostManifests(cwd: string): RoutableHost[] {
  const dir = path.join(cwd, ".guild", "hosts");
  let ids: string[];
  try {
    ids = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: RoutableHost[] = [];
  for (const id of ids) {
    try {
      const raw = fs.readFileSync(path.join(dir, id, "capability.json"), "utf8");
      const m = JSON.parse(raw) as RoutableHost;
      if (m && typeof m.host_id === "string") out.push(m);
    } catch {
      // skip a missing/unreadable manifest — the router excludes absent hosts.
    }
  }
  return out;
}

// ── defaults.cross_host config reader ─────────────────────────────────────────
//
// SECURITY: stores address/port/user only — NO secrets, NO passwords.
// Auth via ssh keys/agent. This mirrors read-guild-config.ts DefaultsBlock.cross_host.

interface CrossHostEndpointCfg {
  address: string;
  port?: number;
  user?: string;
}
interface CrossHostConfig {
  enabled: boolean;
  hosts: Record<string, CrossHostEndpointCfg>;
}

/** Read defaults.cross_host from .guild/settings.json. Graceful on missing/parse errors. */
function loadCrossHostConfig(cwd: string): CrossHostConfig {
  const settingsPath = path.join(cwd, ".guild", "settings.json");
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defaults = parsed?.defaults as Record<string, unknown> | undefined;
    const ch = defaults?.cross_host as Record<string, unknown> | undefined;
    if (!ch || typeof ch !== "object") return { enabled: false, hosts: {} };
    return {
      enabled: ch.enabled === true,
      hosts:
        typeof ch.hosts === "object" && ch.hosts !== null
          ? (ch.hosts as Record<string, CrossHostEndpointCfg>)
          : {},
    };
  } catch {
    return { enabled: false, hosts: {} };
  }
}

// `defaults.cross_host.enabled` is the canonical settings.json key.
// GUILD_CROSS_HOST_ENABLED env mirrors it with higher precedence when explicitly set.
function crossHostEnabled(env: NodeJS.ProcessEnv, cwd: string): boolean {
  const v = (env["GUILD_CROSS_HOST_ENABLED"] ?? "").trim().toLowerCase();
  // Explicit env wins in both directions (set to 1 or 0).
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  // Env not set → fall through to settings.json defaults.cross_host.enabled.
  return loadCrossHostConfig(cwd).enabled;
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
    if (!dryRun && !probeTmuxAvailable()) {
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
  if (probeTmuxAvailable()) {
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

  // ── P1-3 A2b: --reap path ──────────────────────────────────────────────────
  // When --reap is passed, skip the normal launch flow and force-reap dead
  // members from the session registry.  Requires --cwd (defaults to ".").
  // Optionally scoped to a single run via --run-id; without it, all runs that
  // have a session.json are checked.
  //
  // Usage:
  //   agent-team-launcher.ts --reap --cwd /path/to/repo [--run-id run-2026-...]
  //
  // Exit 0 always (reaping is a maintenance op, never a hard failure).
  if (args.reap) {
    const cwd = path.resolve(args.cwd);
    const runIds: string[] = args.runId
      ? [args.runId]
      : listRunnableRunIds(cwd);

    if (runIds.length === 0) {
      process.stdout.write(
        "[agent-team-launcher] --reap: no runs with session.json found " +
          `under ${path.join(cwd, ".guild", "runs")}\n`
      );
      process.exit(0);
    }

    let totalReaped = 0;
    for (const runId of runIds) {
      const sjPath = sessionJsonPath(cwd, runId);
      if (!fs.existsSync(sjPath)) continue;

      const result = reapDeadMembers(sjPath);
      if (result.reaped.length > 0) {
        totalReaped += result.reaped.length;
        process.stdout.write(
          `[agent-team-launcher] --reap: run "${runId}" — reaped ${result.reaped.length} ` +
            `dead pane(s): [${result.reaped.join(", ")}]; ` +
            `live: [${result.live.join(", ") || "none"}]; ` +
            `skipped: [${result.skipped.join(", ") || "none"}]; ` +
            `session.json ${result.updated ? "updated" : "NOT updated (write failed)"}\n`
        );
      } else if (result.skipped.length > 0) {
        process.stdout.write(
          `[agent-team-launcher] --reap: run "${runId}" — all panes skipped ` +
            `(dry-run placeholders or tmux unavailable): [${result.skipped.join(", ")}]\n`
        );
      } else {
        process.stdout.write(
          `[agent-team-launcher] --reap: run "${runId}" — all panes live ` +
            `[${result.live.join(", ") || "none"}]; nothing to reap.\n`
        );
      }
    }

    process.stdout.write(
      `[agent-team-launcher] --reap: done. ` +
        `${totalReaped} dead pane(s) pruned across ${runIds.length} run(s).\n`
    );
    process.exit(0);
  }

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

  // Mint the unified run-id ONCE per launcher invocation and thread it through
  // both prompts and the manifest. Exported into each pane's env so hooks
  // inside (capture-telemetry, maybe-reflect, agent-team handlers) converge
  // on the same `.guild/runs/<run-id>/` path. Defined here (before the cross-
  // host block) so both remote + local tmux paths share the same run ID.
  const runId = makeRunId();

  // ── CH-1 routing: local tmux vs remote, via host-router ──────────────────
  // When cross-host is enabled (env OR defaults.cross_host.enabled in settings.json)
  // AND host-capability manifests exist, route each specialist THROUGH the CR-1
  // routing function and detect any that resolve to a remote host.
  //
  // For each remote-routed specialist:
  //   - endpoint configured in defaults.cross_host.hosts → dispatch via RemoteTeamBackend
  //   - endpoint NOT configured → surface + refuse (safe, no partial dispatch)
  //
  // Disabled OR no manifests → inert, single-host behavior byte-identical to today.
  if (crossHostEnabled(process.env, cwd)) {
    const manifests = loadHostManifests(cwd);
    if (manifests.length > 0) {
      const localHostId =
        process.env["GUILD_HOST_ID"] ?? process.env["GUILD_HOST"] ?? "claude";
      try {
        const routes = planTeamRouting(team.specialists, manifests, {
          localHostId,
          crossHostEnabled: true,
        });
        const remote = routes.filter((r) => r.backend === "remote");
        if (remote.length > 0) {
          const chConfig = loadCrossHostConfig(cwd);
          // Partition: specialists with endpoint config vs. those without.
          const withEndpoint = remote.filter((r) => !!chConfig.hosts[r.decision.host]);
          const noEndpoint = remote.filter((r) => !chConfig.hosts[r.decision.host]);

          if (noEndpoint.length > 0) {
            // Safe surface+refuse: never silently drop a specialist.
            const lines = noEndpoint
              .map(
                (r) =>
                  `    - ${r.specialist} → ${r.decision.host} (${r.hostKind}) — no SSH endpoint configured`
              )
              .join("\n");
            process.stderr.write(
              `[agent-team-launcher] ERROR: ${noEndpoint.length} specialist(s) route to a REMOTE host ` +
                `with no SSH endpoint in defaults.cross_host.hosts:\n${lines}\n` +
                `  Add defaults.cross_host.hosts["<host_id>"].address to .guild/settings.json\n` +
                `  or drop \`host:\` from team.yaml to keep those specialists local.\n`
            );
            process.exit(1);
          }

          // All remote specialists have endpoints — dispatch via RemoteTeamBackend.
          // SECURITY: endpoint carries address/user only; auth via ssh keys/agent (no passwords).
          const remoteSpecialists = withEndpoint.map(
            (r) => team.specialists.find((s) => s.name === r.specialist)!
          );

          const resolveHostTarget = (spec: Specialist): RemoteHostTarget => {
            const r = routes.find((rt) => rt.specialist === spec.name)!;
            const entry = chConfig.hosts[r.decision.host];
            // Build ssh endpoint: [user@]address. Port belongs in ~/.ssh/config.
            // SECURITY: address/user only — no passwords.
            const endpoint = entry.user
              ? `${entry.user}@${entry.address}`
              : entry.address;
            return { hostId: r.decision.host, hostKind: r.hostKind, endpoint };
          };

          const remoteBackend = new RemoteTeamBackend({
            transport: new SshRemoteTransport(),
            resolveHostTarget,
            resolveAdapter: resolveAdapter(),
          });

          const remoteResult = remoteBackend.launch({
            slug,
            runId,
            cwd,
            specialists: remoteSpecialists,
            targetName,
            mode,
            dryRun: args.dryRun,
          });

          if (!remoteResult.ok) {
            process.stderr.write(
              `[agent-team-launcher] ERROR: remote dispatch failed — ` +
                `${remoteResult.notes?.join("; ") ?? "unknown"}\n`
            );
            process.exit(2);
          }

          if (args.dryRun) {
            process.stdout.write(
              `[agent-team-launcher] dry-run — remote dispatch (${remoteSpecialists.length} specialist(s)):\n`
            );
            for (const cmd of remoteResult.plannedCommands ?? []) {
              process.stdout.write(`  ${cmd}\n`);
            }
          }

          // Remove dispatched-remote specialists from the local tmux pool.
          const remoteNames = new Set(remote.map((r) => r.specialist));
          team.specialists = team.specialists.filter((s) => !remoteNames.has(s.name));

          if (team.specialists.length === 0) {
            // All specialists dispatched remotely — no local tmux session needed.
            if (args.dryRun) {
              process.stdout.write(
                "[agent-team-launcher] dry-run: all specialists remote; no local tmux session.\n"
              );
            } else {
              process.stdout.write(
                "[agent-team-launcher] all specialists dispatched remotely.\n"
              );
            }
            process.exit(0);
          }
        }
      } catch (err) {
        if (err instanceof RouteError) {
          process.stderr.write(
            `[agent-team-launcher] ERROR: cross-host routing failed — ${err.message}\n`
          );
          process.exit(1);
        }
        throw err;
      }
    }
  }

  // CH-1: a team is "mixed-host" when any specialist names a non-claude `host:`.
  // For a mixed team we wire pane-adapter's resolver so each pane spawns via its
  // brand's adapter (codex → `codex exec`); a pure-claude team keeps the legacy
  // resolver-less path (byte-identical to the shipped launcher — the regression
  // anchor).
  const mixedHost = team.specialists.some((s) => s.host_kind && s.host_kind !== "claude");

  // RE-4: the tmux spawn logic lives behind the TeamBackend seam. The launcher
  // drives one TmuxTeamBackend for probes (availability, collision), pure
  // command composition (plan), and the spawn/teardown loop. The launcher keeps
  // the CLI-specific UX (exact error messages, exit codes, manifest, attach).
  const tmux = new TmuxTeamBackend(mixedHost ? { resolveAdapter: resolveAdapter() } : {});

  // For real (non-dry-run) launches: tmux must be installed, and the target must
  // not already exist (refuse to clobber). Which collision we check depends on
  // the mode: a session name (new-session) or a team window in the current
  // session (in-session). dry-run skips this — it never invokes tmux.
  if (!args.dryRun) {
    if (!tmux.isAvailable()) {
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
      if (tmux.windowExists(targetName)) {
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
    } else if (tmux.sessionExists(targetName)) {
      process.stderr.write(
        `[agent-team-launcher] ERROR: tmux session "${targetName}" already exists.\n` +
          `  Refusing to clobber. Re-run with --session-name <unique-name>.\n`
      );
      process.exit(1);
    }

    // CH-6: fail-fast preflight for a mixed-host team. Probe every pane's
    // adapter (orchestrator = claude + each specialist's host) BEFORE any pane
    // spawns; on failure abort naming the specialist + host + missing
    // dependency, with ZERO panes opened (no partial spawn). No-op for a
    // pure-claude team (no resolver wired → preflight returns ok).
    if (mixedHost) {
      const pf = tmux.preflight(team.specialists);
      if (!pf.ok) {
        const lines = pf.failures
          .map((f) => `    - ${f.specialist} [${f.hostKind}]: ${f.message}`)
          .join("\n");
        process.stderr.write(
          `[agent-team-launcher] ERROR: mixed-host preflight failed ` +
            `(CH-6 fail-fast — zero panes opened):\n${lines}\n`
        );
        process.exit(1);
      }
    }
  }

  const plan = tmux.plan({
    mode,
    targetName,
    cwd,
    slug,
    runId,
    specialists: team.specialists,
    dryRun: args.dryRun,
  });
  const commands = plan.commands;

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

  // Real run: execute the plan through the backend. The backend runs each tmux
  // command, tears down the partial target on first failure (kill-window
  // in-session / kill-session new-session), and collects teammate pane ids.
  const outcome = tmux.spawn(plan);
  if (!outcome.ok) {
    process.stderr.write(
      `[agent-team-launcher] tmux command failed: ${outcome.failedCommand?.display ?? "(unknown)"}\n` +
        `  stderr: ${outcome.stderr}\n`
    );
    process.exit(2);
  }

  const manifestPath = writeManifest(
    cwd,
    buildManifest({
      runId,
      mode,
      sessionName:
        mode === "in-session"
          ? tmux.currentSessionName() ?? "(current tmux session)"
          : targetName,
      windowName: mode === "in-session" ? targetName : null,
      specialists: team.specialists,
      dryRun: false,
      realPaneIds: {
        orchestrator: outcome.orchestratorPaneId,
        teammates: outcome.teammatePaneIds,
      },
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
