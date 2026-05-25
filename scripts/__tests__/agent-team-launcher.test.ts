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
});
