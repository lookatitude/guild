#!/usr/bin/env -S npx tsx
/**
 * scripts/agent-team-launcher.ts
 *
 * Launches Claude Code's experimental agent-team backend in a tmux session:
 * one pane per specialist listed in .guild/team/<slug>.yaml. The orchestrator
 * (main Claude Code) runs in the first pane; each specialist runs in its own
 * pane with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 exported, per
 * guild-plan.md §7.3 (agent-team backend is opt-in, requires the env var, one
 * team per session, no nested teams).
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
 *   1  Precondition failure (missing args, wrong backend, nested tmux, tmux
 *      missing, session name collision).
 *   2  tmux command failure while creating the real session.
 *
 * Invariants:
 *   - Never writes to .guild/wiki/ (forbidden per tooling-engineer scope).
 *   - Never runs agent-team mode recursively (refuses when $TMUX is set;
 *     the plan mandates one team per session).
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
}

interface ParsedTmuxCommand {
  argv: string[];
  display: string;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { team: null, sessionName: null, cwd: ".", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--team" && i + 1 < argv.length) out.team = argv[++i];
    else if (a === "--session-name" && i + 1 < argv.length) out.sessionName = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) out.cwd = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
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

function buildPrompt(slug: string, specialist: Specialist | null): string {
  if (!specialist) {
    return (
      `You are the Guild orchestrator for team \`${slug}\`. ` +
      `The plan is at \`.guild/plan/${slug}.md\`. ` +
      `Dispatch specialists when their dependencies clear.`
    );
  }
  return (
    `You are the \`${specialist.name}\` teammate. ` +
    `Your lane in the plan is scoped to \`${specialist.scope}\`. ` +
    `Wait for a \`TaskCreated\` event, then proceed.`
  );
}

function composeTmuxCommands(opts: {
  sessionName: string;
  cwd: string;
  slug: string;
  specialists: Specialist[];
}): ParsedTmuxCommand[] {
  const { sessionName, cwd, slug, specialists } = opts;
  const cmds: ParsedTmuxCommand[] = [];

  // Claude Code invocation is the same for every pane: set the env var, cd
  // into the consumer repo, then launch `claude` with a staging prompt. We
  // rely on the user's PATH to find the `claude` binary; if it is unresolved
  // the pane will surface that error directly.
  const orchestratorPrompt = buildPrompt(slug, null);

  // Pane 1: detached session with the orchestrator.
  cmds.push({
    argv: [
      "tmux",
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-n",
      "orchestrator",
      "-c",
      cwd,
      paneCommand(orchestratorPrompt),
    ],
    display:
      `tmux new-session -d -s ${shellQuote(sessionName)} ` +
      `-n orchestrator -c ${shellQuote(cwd)} ` +
      shellQuote(paneCommand(orchestratorPrompt)),
  });

  // One split per specialist.
  for (const spec of specialists) {
    const cmd = paneCommand(buildPrompt(slug, spec));
    cmds.push({
      argv: [
        "tmux",
        "split-window",
        "-t",
        sessionName,
        "-c",
        cwd,
        cmd,
      ],
      display:
        `tmux split-window -t ${shellQuote(sessionName)} ` +
        `-c ${shellQuote(cwd)} ${shellQuote(cmd)}`,
    });
    cmds.push({
      argv: ["tmux", "select-pane", "-T", spec.name],
      display: `tmux select-pane -T ${shellQuote(spec.name)}`,
    });
  }

  // Even out pane sizes and select orchestrator pane last.
  cmds.push({
    argv: ["tmux", "select-layout", "-t", sessionName, "tiled"],
    display: `tmux select-layout -t ${shellQuote(sessionName)} tiled`,
  });

  return cmds;
}

function paneCommand(prompt: string): string {
  // The agent-team env var must be exported in every pane (§7.3). We keep the
  // pane alive after `claude` exits so the user can inspect handoffs.
  return (
    `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; ` +
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

// ── Manifest write ─────────────────────────────────────────────────────────

interface Manifest {
  session_name: string;
  created_at: string;
  orchestrator_pane_id: string;
  teammate_panes: Array<{ specialist: string; pane_id: string }>;
  env: Record<string, string>;
}

function buildManifest(opts: {
  sessionName: string;
  specialists: Specialist[];
  dryRun: boolean;
  realPaneIds: { orchestrator: string; teammates: Record<string, string> } | null;
}): Manifest {
  const { sessionName, specialists, dryRun, realPaneIds } = opts;
  return {
    session_name: sessionName,
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
    env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" },
  };
}

function makeRunId(): string {
  // ISO timestamp compacted for filesystem use. Keeps sortable order.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeManifest(cwd: string, manifest: Manifest): string {
  const runId = makeRunId();
  const dir = path.join(cwd, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "session.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return out;
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

  // Nested-tmux guard: §7.3 forbids one team per session. If we are already
  // inside a tmux session, refuse to spawn another team — it would violate
  // "no nested teams."
  if (process.env["TMUX"]) {
    process.stderr.write(
      "[agent-team-launcher] ERROR: already inside a tmux session " +
        "($TMUX is set). Agent-team mode allows only one team per session " +
        "and forbids nested teams (guild-plan.md §7.3). Exit this tmux " +
        "session, then re-run from a plain shell.\n"
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

  if (team.backend !== "agent-team") {
    process.stderr.write(
      `[agent-team-launcher] ERROR: team.yaml declares backend: ${team.backend || "(missing)"}.\n` +
        `  This launcher only runs when backend is exactly "agent-team".\n` +
        `  For backend: subagent, use the standard guild:execute-plan dispatch path\n` +
        `  (it invokes specialists via the Agent tool, not tmux).\n`
    );
    process.exit(1);
  }

  if (team.specialists.length === 0) {
    process.stderr.write(
      "[agent-team-launcher] ERROR: team.yaml has no specialists; nothing to spawn.\n"
    );
    process.exit(1);
  }

  const slug = slugFromTeamPath(args.team);
  const sessionName =
    args.sessionName ??
    `guild-${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const cwd = path.resolve(args.cwd);

  // For real (non-dry-run) launches: tmux must be installed and the target
  // session name must not already exist (refuse to clobber).
  if (!args.dryRun) {
    if (!tmuxAvailable()) {
      process.stderr.write(
        "[agent-team-launcher] ERROR: `tmux` is not installed or not on PATH.\n" +
          "  Install tmux (macOS: `brew install tmux`; Debian/Ubuntu: `apt install tmux`),\n" +
          "  then re-run.\n"
      );
      process.exit(1);
    }
    if (sessionExists(sessionName)) {
      process.stderr.write(
        `[agent-team-launcher] ERROR: tmux session "${sessionName}" already exists.\n` +
          `  Refusing to clobber. Re-run with --session-name <unique-name>.\n`
      );
      process.exit(1);
    }
  }

  const commands = composeTmuxCommands({
    sessionName,
    cwd,
    slug,
    specialists: team.specialists,
  });

  if (args.dryRun) {
    process.stdout.write(
      "[agent-team-launcher] dry-run — would execute the following tmux commands:\n"
    );
    for (const c of commands) process.stdout.write(`  ${c.display}\n`);
    process.stdout.write(
      `  tmux attach-session -t ${shellQuote(sessionName)}\n`
    );

    const manifestPath = writeManifest(
      cwd,
      buildManifest({
        sessionName,
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
      // Best-effort teardown of the partially-created session.
      spawnSync("tmux", ["kill-session", "-t", sessionName]);
      process.exit(2);
    }
  }

  // Collect real pane IDs. `tmux list-panes -t <session> -F "#{pane_index} #{pane_id} #{pane_title}"`
  const panesR = spawnSync(
    "tmux",
    [
      "list-panes",
      "-t",
      sessionName,
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
      sessionName,
      specialists: team.specialists,
      dryRun: false,
      realPaneIds: { orchestrator: orchestratorId, teammates },
    })
  );
  process.stdout.write(
    `[agent-team-launcher] session ${sessionName} created; manifest → ${manifestPath}\n`
  );

  // Attach user's terminal to the new session.
  const attach = spawnSync("tmux", ["attach-session", "-t", sessionName], {
    stdio: "inherit",
  });
  process.exit(attach.status ?? 0);
}

main();
