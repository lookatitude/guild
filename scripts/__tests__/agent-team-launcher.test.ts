/**
 * scripts/__tests__/agent-team-launcher.test.ts
 *
 * TDD: written before scripts/agent-team-launcher.ts implementation.
 * Spawns the script via tsx with a temp consumer-repo layout, verifies:
 *  - --dry-run with agent-team yaml → writes session.json + prints tmux commands
 *    and does NOT invoke tmux (dry-run is always safe).
 *  - --dry-run with subagent yaml → exit 1 with clear error.
 *  - Missing --team arg → exit 1.
 *  - Nested tmux ($TMUX set) → exit 1 (one team per session per §7.3).
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
  // Nested tmux ($TMUX set)
  // ─────────────────────────────────────────────────────────────
  describe("nested tmux (TMUX env set)", () => {
    it("exits 1 and refuses to spawn a nested team", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stderr } = runScript(
        [
          "--team",
          teamPath,
          "--session-name",
          "guild-nested-001",
          "--cwd",
          tmpDir,
          "--dry-run",
        ],
        { TMUX: "/tmp/tmux-1000/default,12345,0" }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/tmux|nested|one team/i);
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
