/**
 * scripts/__tests__/agent-team-launcher.test.ts
 *
 * Spawns the script via tsx with a temp consumer-repo layout, verifies:
 *  - --dry-run with agent-team yaml → writes session.json + prints tmux commands
 *    and does NOT invoke tmux (dry-run is always safe).
 *  - --dry-run with subagent yaml → exit 1 with clear error.
 *  - Missing --team arg → exit 1.
 *  - In-session ($TMUX set) → in-session mode: new-window + split-window
 *    targeting that window + select-window (NOT new-session, NOT exit 1).
 *  - In-session one-team-per-session guard → exit 1 when a team window of the
 *    same name already exists (verified with a mocked tmux on PATH).
 *  - $TMUX unset → new-session + attach (unchanged legacy behavior).
 *  - Existing tmux session collision → exit 1 (refuse to clobber).
 */
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../agent-team-launcher.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  args: string[],
  env: Record<string, string | undefined> = {}
): { exitCode: number; stdout: string; stderr: string } {
  // Scrub TMUX from env unless the test wants it set, so host terminal state
  // does not accidentally trip the nested-tmux guard.
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  delete baseEnv.TMUX;
  const finalEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...baseEnv, ...env })) {
    if (v !== undefined) finalEnv[k] = v;
  }
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    env: finalEnv,
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function setupConsumerRepo(
  tmpDir: string,
  slug: string,
  fixtureFile: string
): { teamPath: string } {
  const teamDir = path.join(tmpDir, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const src = path.join(FIXTURES, fixtureFile);
  const dst = path.join(teamDir, `${slug}.yaml`);
  fs.copyFileSync(src, dst);
  return { teamPath: dst };
}

function findSessionJson(cwd: string): string | null {
  const runsDir = path.join(cwd, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return null;
  for (const runId of fs.readdirSync(runsDir)) {
    const candidate = path.join(runsDir, runId, "agent-team", "session.json");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Writes a stub `tmux` executable into a temp bin dir and returns that dir so
// callers can prepend it to PATH. This lets the in-session collision guard be
// exercised deterministically without spawning real tmux: `-V` reports a
// version (tmux "available"), `list-windows` reports a window list, and every
// other subcommand is a successful no-op.
function makeFakeTmuxBin(tmpDir: string, existingWindows: string[]): string {
  const binDir = path.join(tmpDir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  const tmuxPath = path.join(binDir, "tmux");
  const windowList = existingWindows.join("\\n");
  fs.writeFileSync(
    tmuxPath,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  -V) echo "tmux 3.4 (fake)"; exit 0;;',
      `  list-windows) printf '${windowList}\\n'; exit 0;;`,
      "  *) exit 0;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

// Fake bin dir with tmux + claude + codex stubs for mixed-host preflight tests.
// `claudeOk` / `codexOk` toggle each binary's `--version` exit status so the
// CH-6 fail-fast path is exercisable; tmux behaves like makeFakeTmuxBin.
function makeFakeMixedBin(
  tmpDir: string,
  opts: { windows?: string[]; claudeOk?: boolean; codexOk?: boolean } = {}
): string {
  const binDir = path.join(tmpDir, "fakebin-mixed");
  fs.mkdirSync(binDir, { recursive: true });
  const windowList = (opts.windows ?? []).join("\\n");
  fs.writeFileSync(
    path.join(binDir, "tmux"),
    [
      "#!/bin/sh",
      'case "$1" in',
      '  -V) echo "tmux 3.4 (fake)"; exit 0;;',
      `  list-windows) printf '${windowList}\\n'; exit 0;;`,
      "  *) exit 0;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(binDir, "claude"),
    ["#!/bin/sh", opts.claudeOk === false ? "exit 1" : "exit 0", ""].join("\n"),
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(binDir, "codex"),
    ["#!/bin/sh", opts.codexOk === false ? "exit 1" : "exit 0", ""].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

// Write a guild.host_capability.v1 manifest the launcher's routing block reads.
function writeHostManifest(cwd: string, hostId: string, hostKind: "claude" | "codex"): void {
  const dir = path.join(cwd, ".guild", "hosts", hostId);
  fs.mkdirSync(dir, { recursive: true });
  const tiers =
    hostKind === "codex"
      ? { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" }
      : { cheap: "haiku", mid: "sonnet", powerful: "opus" };
  const manifest = {
    schema_version: "guild.host_capability.v1",
    host_id: hostId,
    host_kind: hostKind,
    detected_at: new Date().toISOString(),
    source: "test",
    tiers,
    models: Object.values(tiers),
    tool_support: {
      subagent: true,
      agent_team: hostKind === "claude",
      independent_agents: hostKind === "claude",
      tmux: hostKind === "claude",
      mcp: true,
    },
  };
  fs.writeFileSync(path.join(dir, "capability.json"), JSON.stringify(manifest, null, 2), "utf8");
}

describe("agent-team-launcher.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-atl-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────
  // --dry-run with agent-team yaml → succeeds
  // ─────────────────────────────────────────────────────────────
  describe("dry-run + agent-team yaml", () => {
    it("exits 0", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode } = runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-test-001",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      expect(exitCode).toBe(0);
    });

    it("writes session.json under .guild/runs/<run-id>/agent-team/", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-test-001",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir);
      expect(sessionJson).not.toBeNull();
    });

    it("session.json contains session_name, env, teammate_panes for all specialists", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-test-002",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir)!;
      const manifest = JSON.parse(fs.readFileSync(sessionJson, "utf8"));
      expect(manifest.session_name).toBe("guild-test-002");
      expect(manifest.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
      expect(Array.isArray(manifest.teammate_panes)).toBe(true);
      const specialists = manifest.teammate_panes.map((p: { specialist: string }) => p.specialist);
      expect(specialists).toContain("architect");
      expect(specialists).toContain("backend");
      expect(specialists).toContain("qa");
    });

    it("prints tmux commands to stdout in dry-run mode", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { stdout } = runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-test-003",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      expect(stdout).toMatch(/tmux\s+new-session/);
      expect(stdout).toMatch(/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/);
    });

    it("does NOT invoke real tmux (session must not exist after dry-run)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const sessionName = `guild-dryrun-${Date.now()}`;
      runScript([
        "--team",
        teamPath,
        "--session-name",
        sessionName,
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      // Probe whether any real tmux session was created. If tmux is not
      // installed, this will simply return a non-zero exit with no match —
      // which still satisfies "no session created."
      const probe = spawnSync("tmux", ["has-session", "-t", sessionName], {
        encoding: "utf8",
      });
      // has-session returns 0 only if the session exists; anything else means
      // the dry-run did not actually create it.
      expect(probe.status === 0).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // --dry-run with subagent yaml → refused
  // ─────────────────────────────────────────────────────────────
  describe("dry-run + subagent yaml", () => {
    it("exits 1 with stderr pointing at the subagent path", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "subagent-slug", "team-subagent.yaml");
      const { exitCode, stderr } = runScript([
        "--team",
        teamPath,
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      expect(exitCode).toBe(1);
      // Must name the expected backend ("agent-team") and point at the
      // subagent execution path so the user knows what to do next.
      expect(stderr).toMatch(/agent-team/i);
      expect(stderr).toMatch(/execute-plan|subagent/i);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Missing --team arg
  // ─────────────────────────────────────────────────────────────
  describe("missing --team", () => {
    it("exits 1 and surfaces a clear error", () => {
      const { exitCode, stderr } = runScript(["--dry-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/--team/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // In-session ($TMUX set) → spawn a visible team window, not refuse
  // ─────────────────────────────────────────────────────────────
  describe("in-session (TMUX env set)", () => {
    it("does NOT refuse — exits 0 instead of the old exit-1", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { TMUX: "/tmp/tmux-1000/default,12345,0" }
      );
      expect(exitCode).toBe(0);
    });

    it("emits new-window + split-window targeting that window + select-window", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { TMUX: "/tmp/tmux-1000/default,12345,0" }
      );
      // Window name defaults to guild-<slug> (no timestamp) in in-session mode.
      expect(stdout).toMatch(/tmux\s+new-window\s+-n\s+guild-test-slug/);
      expect(stdout).toMatch(/tmux\s+split-window\s+-t\s+guild-test-slug/);
      expect(stdout).toMatch(/tmux\s+select-window\s+-t\s+guild-test-slug/);
    });

    it("does NOT create a new session and does NOT attach in-session", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { TMUX: "/tmp/tmux-1000/default,12345,0" }
      );
      expect(stdout).not.toMatch(/tmux\s+new-session/);
      expect(stdout).not.toMatch(/tmux\s+attach-session/);
    });

    it("records mode=in-session + window_name in the manifest", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      runScript(["--team", teamPath, "--cwd", tmpDir, "--dry-run"], {
        TMUX: "/tmp/tmux-1000/default,12345,0",
      });
      const sessionJson = findSessionJson(tmpDir)!;
      const manifest = JSON.parse(fs.readFileSync(sessionJson, "utf8"));
      expect(manifest.mode).toBe("in-session");
      expect(manifest.window_name).toBe("guild-test-slug");
    });

    // One-team-per-session guard: a real (non-dry-run) launch must refuse to
    // clobber an existing team window of the same name. Verified with a mocked
    // tmux on PATH so no real tmux server is spawned.
    it("refuses when a team window of the same name already exists", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const fakeBin = makeFakeTmuxBin(tmpDir, ["other-window", "guild-test-slug"]);
      const { exitCode, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/already exists|one team|clobber/i);
      // Message must tell the operator how to switch to / remove the window.
      expect(stderr).toMatch(/select-window|kill-window/);
    });

    it("proceeds when no team window of that name exists (mocked tmux)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      // Fake tmux reports only unrelated windows → guard must NOT fire. The
      // no-op stub makes every spawn succeed, so the launcher reaches exit 0.
      const fakeBin = makeFakeTmuxBin(tmpDir, ["other-window"]);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/team window "guild-test-slug" created/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // $TMUX unset → unchanged new-session + attach behavior
  // ─────────────────────────────────────────────────────────────
  describe("no tmux session (TMUX unset)", () => {
    it("uses new-session and ends by attaching (dry-run, legacy behavior)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stdout } = runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-legacy-001",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/tmux\s+new-session/);
      expect(stdout).toMatch(/tmux\s+attach-session\s+-t\s+guild-legacy-001/);
      // new-session mode must NOT use the in-session window commands.
      expect(stdout).not.toMatch(/tmux\s+new-window/);
      expect(stdout).not.toMatch(/tmux\s+select-window/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // D5 dispatch ladder (--agent-mode)
  // ─────────────────────────────────────────────────────────────

  // Helper: fake tmux that makes -V exit 1 (tmux "unavailable")
  function makeUnavailableTmuxBin(dir: string): string {
    const binDir = path.join(dir, "fakebin-notmux");
    fs.mkdirSync(binDir, { recursive: true });
    const tmuxPath = path.join(binDir, "tmux");
    fs.writeFileSync(tmuxPath, ["#!/bin/sh", "exit 1", ""].join("\n"), { mode: 0o755 });
    return binDir;
  }

  describe("D5 dispatch ladder (--agent-mode)", () => {
    // Step 1: --agent-mode=auto + $TMUX set → team in-session (covered by existing in-session tests).
    // We verify the dry-run output targets a window (not a session).
    it("auto + TMUX set → team in-session (new-window in dry-run output)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=auto", "--dry-run"],
        { TMUX: "/tmp/tmux-1000/default,12345,0" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/new-window/); // in-session: window, not a session
      expect(stdout).not.toMatch(/new-session/);
    });

    // Step 2: --agent-mode=auto + $TMUX unset + tmux installed → team new-session
    it("auto + TMUX unset + tmux available → team new-session (dry-run output)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const fakeBin = makeFakeTmuxBin(tmpDir, []);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=auto",
         "--session-name", "guild-ladder-test-001", "--dry-run"],
        { TMUX: undefined, PATH: `${fakeBin}:${process.env.PATH ?? ""}` }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/new-session/);
      expect(stdout).not.toMatch(/new-window/);
    });

    // Step 3: --agent-mode=auto + no tmux + GUILD_INDEPENDENT_AGENTS_SUPPORTED=1 → agent signal
    it("auto + no tmux + independent agents supported → agent JSON signal", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const noTmuxBin = makeUnavailableTmuxBin(tmpDir);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=auto"],
        {
          TMUX: undefined,
          PATH: `${noTmuxBin}:${process.env.PATH ?? ""}`,
          GUILD_INDEPENDENT_AGENTS_SUPPORTED: "1",
        }
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("agent");
      expect(signal.reason).toMatch(/agent|independent/i);
    });

    // Step 4: --agent-mode=auto + no tmux + GUILD_INDEPENDENT_AGENTS_SUPPORTED=0 → subagent signal
    it("auto + no tmux + no agent support → subagent JSON signal", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const noTmuxBin = makeUnavailableTmuxBin(tmpDir);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=auto"],
        {
          TMUX: undefined,
          PATH: `${noTmuxBin}:${process.env.PATH ?? ""}`,
          GUILD_INDEPENDENT_AGENTS_SUPPORTED: "0",
        }
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("subagent");
      expect(signal.reason).toMatch(/subagent|fallback/i);
    });

    // Explicit --agent-mode=subagent → subagent signal regardless of tmux/env
    it("explicit --agent-mode=subagent emits subagent signal and exits 0", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=subagent"]
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("subagent");
      expect(signal.slug).toBe("test-slug");
    });

    // Explicit --agent-mode=agent → agent signal regardless of tmux/env
    it("explicit --agent-mode=agent emits agent signal and exits 0", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=agent"]
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("agent");
    });

    // Explicit --agent-mode=team + TMUX set → in-session (dry-run)
    it("explicit --agent-mode=team + TMUX set → in-session mode (dry-run)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team", "--dry-run"],
        { TMUX: "/tmp/tmux-1000/default,12345,0" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/new-window/); // in-session: uses new-window
    });

    // Explicit --agent-mode=team + no TMUX → new-session (dry-run skips tmux-available check)
    it("explicit --agent-mode=team + no TMUX + dry-run → new-session mode", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const noTmuxBin = makeUnavailableTmuxBin(tmpDir);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team",
         "--session-name", "guild-ladder-pin-001", "--dry-run"],
        { TMUX: undefined, PATH: `${noTmuxBin}:${process.env.PATH ?? ""}` }
      );
      // dry-run: availability check is skipped, so team mode proceeds as requested
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/new-session/);
    });

    // Explicit --agent-mode=team + no TMUX + real run + no tmux → falls back to subagent
    it("explicit --agent-mode=team + no tmux on real run → subagent fallback signal", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const noTmuxBin = makeUnavailableTmuxBin(tmpDir);
      const { exitCode, stdout, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team"],
        { TMUX: undefined, PATH: `${noTmuxBin}:${process.env.PATH ?? ""}` }
      );
      expect(exitCode).toBe(0); // fallback, not crash
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("subagent");
      expect(stderr).toMatch(/WARN.*agent_mode=team.*tmux/i);
    });

    // --agent-mode with subagent.yaml (non-agent-team yaml) → still emits signal
    // (agent_mode overrides team.yaml backend check)
    it("--agent-mode=agent with subagent yaml → agent signal (no backend check error)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "subagent-slug", "team-subagent.yaml");
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=agent"]
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("agent");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Session-name collision
  // ─────────────────────────────────────────────────────────────
  describe("session-name collision (non-dry-run)", () => {
    it("exits 1 when the requested tmux session already exists", () => {
      // Only meaningful on a host that has tmux available. Otherwise the
      // "tmux not installed" branch fires first — also exit 1, which still
      // satisfies the contract (collision-or-missing-tmux both refuse).
      const tmuxProbe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
      if (tmuxProbe.status !== 0) {
        // tmux not installed — launcher should still exit 1.
        const { teamPath } = setupConsumerRepo(
          tmpDir,
          "test-slug",
          "team-agent-team.yaml"
        );
        const { exitCode } = runScript([
          "--team",
          teamPath,
          "--session-name",
          "guild-collision-001",
          "--cwd",
          tmpDir,
        ]);
        expect(exitCode).toBe(1);
        return;
      }

      // tmux is available — create a real session to force a collision.
      const sessionName = `guild-collision-${Date.now()}`;
      const create = spawnSync(
        "tmux",
        ["new-session", "-d", "-s", sessionName, "sleep", "10"],
        { encoding: "utf8" }
      );
      // If tmux refuses to create (e.g. no server available), skip assertion.
      if (create.status !== 0) return;

      try {
        const { teamPath } = setupConsumerRepo(
          tmpDir,
          "test-slug",
          "team-agent-team.yaml"
        );
        const { exitCode, stderr } = runScript([
          "--team",
          teamPath,
          "--session-name",
          sessionName,
          "--cwd",
          tmpDir,
        ]);
        expect(exitCode).toBe(1);
        expect(stderr).toMatch(/session|exist|collision|clobber/i);
      } finally {
        spawnSync("tmux", ["kill-session", "-t", sessionName]);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CH-1/CH-2/CH-5/CH-6 — mixed-host `host:` teams
  // ─────────────────────────────────────────────────────────────
  describe("mixed-host (per-specialist host:)", () => {
    it("dry-run: emits a `codex exec` pane for the codex specialist, claude for the rest", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      const { exitCode, stdout } = runScript(["--team", teamPath, "--cwd", tmpDir, "--dry-run"]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/codex exec/);
      // Orchestrator + the claude specialist still carry the Claude team gate.
      expect(stdout).toMatch(/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/);
    });

    it("dry-run: session.json records host_kind + adapter_version per pane (CH-5)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      runScript(["--team", teamPath, "--cwd", tmpDir, "--dry-run"]);
      const manifest = JSON.parse(fs.readFileSync(findSessionJson(tmpDir)!, "utf8"));
      const byName: Record<string, { host_kind: string; adapter_version: string }> =
        Object.fromEntries(manifest.teammate_panes.map((p: { specialist: string }) => [p.specialist, p]));
      expect(byName.security.host_kind).toBe("codex");
      expect(byName.architect.host_kind).toBe("claude");
      expect(byName.security.adapter_version).toBe("1");
    });

    it("real run: preflight passes with claude+codex bins + OPENAI_API_KEY (exit 0)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      const bin = makeFakeMixedBin(tmpDir, { windows: ["other-window"], claudeOk: true, codexOk: true });
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          OPENAI_API_KEY: "sk-x",
        }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/team window "guild-test-slug" created/);
    });

    it("real run: missing codex binary → CH-6 preflight aborts (exit 1, zero panes)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      const bin = makeFakeMixedBin(tmpDir, { windows: ["other-window"], claudeOk: true, codexOk: false });
      const { exitCode, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          OPENAI_API_KEY: "sk-x",
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/preflight failed/i);
      expect(stderr).toMatch(/security/);
      expect(stderr).toMatch(/codex/);
    });

    it("real run: missing OPENAI_API_KEY → CH-6 preflight aborts (exit 1)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      const bin = makeFakeMixedBin(tmpDir, { windows: ["other-window"], claudeOk: true, codexOk: true });
      const { exitCode, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          OPENAI_API_KEY: undefined,
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/OPENAI_API_KEY/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CH-1 — routing to local tmux vs remote, via host-router
  // ─────────────────────────────────────────────────────────────
  describe("cross-host routing detection (host-router)", () => {
    // Helper: write .guild/settings.json with defaults.cross_host config.
    function writeSettingsCrossHost(
      cwd: string,
      opts: { enabled: boolean; hosts: Record<string, { address: string; user?: string; port?: number }> }
    ): void {
      const dir = path.join(cwd, ".guild");
      fs.mkdirSync(dir, { recursive: true });
      const settings = {
        defaults: { cross_host: { enabled: opts.enabled, hosts: opts.hosts } },
      };
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");
    }

    it("enabled + remote manifest + no endpoint in config → refuses with missing-endpoint message", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      // No endpoint configured → should surface+refuse.
      const { exitCode, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/route to a REMOTE host/i);
      expect(stderr).toMatch(/no SSH endpoint/i);
      expect(stderr).toMatch(/security/);
      expect(stderr).toMatch(/codex-remote/);
    });

    it("enabled + remote manifest + endpoint configured → dispatches via RemoteTeamBackend (dry-run, exit 0)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      // Configure the endpoint for codex-remote.
      writeSettingsCrossHost(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);
      // Remote dispatch message should appear.
      expect(stdout).toMatch(/dry-run.*remote dispatch/i);
      // The planned command should reference the remote specialist.
      expect(stdout).toMatch(/security/i);
      // No REFUSED/residual message.
      expect(stdout).not.toMatch(/not yet wired/i);
    });

    it("enabled via settings.json (no env) + endpoint configured → dispatches (dry-run, exit 0)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      // Enable via settings.json (no env var).
      writeSettingsCrossHost(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "10.0.1.5" } },
      });
      // Explicitly unset the env var to ensure settings.json drives it.
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: undefined, GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/dry-run.*remote dispatch/i);
    });

    it("disabled via settings.json (enabled:false) + env absent → inert, single-host tmux path", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeSettingsCrossHost(tmpDir, {
        enabled: false,
        hosts: { "codex-remote": { address: "10.0.1.5" } },
      });
      // No env and settings.json disabled → routing block inert → local mixed-host tmux.
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: undefined }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/codex exec/);
    });

    it("disabled (default, no settings.json): same team + manifests stays local (exit 0, codex pane runs locally)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      // No GUILD_CROSS_HOST_ENABLED, no settings.json → routing block inert → local mixed-host tmux.
      const { exitCode, stdout } = runScript(["--team", teamPath, "--cwd", tmpDir, "--dry-run"]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/codex exec/);
    });
  });
});
