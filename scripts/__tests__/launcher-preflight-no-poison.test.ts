/**
 * scripts/__tests__/launcher-preflight-no-poison.test.ts
 *
 * Fix B of the W4/W5 completion lane (run-identity-and-dispatch): a failed or
 * dry preflight must not persist immutable attempt-1 TaskCell records.
 *
 * Reproduced defect: the tmux rung called `emitTaskCellsV2` (which writes the
 * immutable `guild.task_assignment.v2` + `guild.task_attempt.v1` records)
 * BEFORE the availability / collision / preflight gates, and the emit helper's
 * `dryRun` parameter only relaxed hash computation — it never suppressed the
 * writes. Consequences, both reproduced by the lead:
 *   - `--dry-run` left attempt-1 records on disk;
 *   - a real launch refused at a pre-pane gate (collision, missing binary)
 *     exited 1 with attempt-1 records already written, so the NEXT launch of
 *     the same run id hit the fail-closed overwrite guard and died
 *     ("poisoned" attempt 1).
 *
 * Contract under test:
 *   1. `--dry-run` writes NO task-cell records (and still exits 0).
 *   2. A real launch refused at a pre-pane gate exits 1 with NO task-cell
 *      records persisted — the run id stays launchable.
 *
 * Real-entry tests: the launcher CLI is spawned as a subprocess against a temp
 * consumer repo (same pattern as agent-team-launcher.test.ts).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createExactClaudePluginFixture } from "./fixtures/exact-claude-plugin-fixture";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const binding = require("../../src/modules/lifecycle/workflows/run-binding") as
  typeof import("../../src/modules/lifecycle/workflows/run-binding");

const EXACT_CLAUDE_PLUGIN_ROOT = createExactClaudePluginFixture();

afterAll(() => fs.rmSync(EXACT_CLAUDE_PLUGIN_ROOT, { recursive: true, force: true }));
const FIXTURES = path.resolve(__dirname, "../fixtures");
const RUN_ID = "run-20260811-000000-no-poison";

function seedRepo(tmpDir: string): { teamPath: string } {
  const teamDir = path.join(tmpDir, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const teamPath = path.join(teamDir, "test-slug.yaml");
  fs.copyFileSync(path.join(FIXTURES, "team-agent-team.yaml"), teamPath);
  const runsRoot = path.join(tmpDir, ".guild", "runs");
  fs.mkdirSync(runsRoot, { recursive: true });
  fs.writeFileSync(path.join(runsRoot, "current-run-id"), `${RUN_ID}\n`, "utf8");
  binding.mintRunBinding({ root: tmpDir, run_id: RUN_ID });
  const ctxDir = path.join(tmpDir, ".guild", "context", RUN_ID);
  fs.mkdirSync(ctxDir, { recursive: true });
  for (const role of ["architect", "backend", "qa", "security"]) {
    fs.writeFileSync(path.join(ctxDir, `${role}-${role}.md`), `# ${role}\n`);
  }
  return { teamPath };
}

/**
 * A fake tmux for the refused-gate leg: reports available (`-V`) and reports
 * EVERY session as already existing (`has-session` → 0), so a real new-session
 * launch is refused at the collision gate before any pane could spawn.
 */
function makeCollidingTmux(tmpDir: string): string {
  const binDir = path.join(tmpDir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  const tmuxPath = path.join(binDir, "tmux");
  fs.writeFileSync(
    tmuxPath,
    ["#!/bin/sh", 'case "$1" in', "  -V) echo 'tmux 3.4'; exit 0;;", "  has-session) exit 0;;", "  *) exit 0;;", "esac"].join(
      "\n"
    ) + "\n",
    { mode: 0o755 }
  );
  return binDir;
}

/** Available tmux with an empty session namespace; no launch command should run. */
function makeAvailableTmux(tmpDir: string): string {
  const binDir = path.join(tmpDir, "available-fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  const tmuxPath = path.join(binDir, "tmux");
  fs.writeFileSync(
    tmuxPath,
    [
      "#!/bin/sh",
      'case "$1" in',
      "  -V) echo 'tmux 3.4'; exit 0;;",
      "  has-session) exit 1;;",
      "  list-windows) exit 1;;",
      "  *) echo 'unexpected tmux launch' >&2; exit 97;;",
      "esac",
    ].join("\n") + "\n",
    { mode: 0o755 }
  );
  return binDir;
}

/**
 * Mixed-host preflight mutates the exact package only after its first package
 * verification. The final tmux plan must refuse before spawn and the launcher
 * must terminally settle the immutable attempts it wrote between those checks.
 */
function makeMutatingMixedHostBin(tmpDir: string): string {
  const binDir = makeAvailableTmux(tmpDir);
  fs.writeFileSync(
    path.join(binDir, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(binDir, "codex"),
    [
      "#!/bin/sh",
      'printf "\\nmutated after exact preflight\\n" >> "$GUILD_MUTATE_PLUGIN_ROOT/README.md"',
      "exit 0",
    ].join("\n") + "\n",
    { mode: 0o755 },
  );
  return binDir;
}

function runLauncher(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
  pluginRoot: string = EXACT_CLAUDE_PLUGIN_ROOT,
): { exitCode: number; stdout: string; stderr: string } {
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  baseEnv.GUILD_PLUGIN_ROOT = pluginRoot;
  delete baseEnv.TMUX;
  delete baseEnv.GUILD_RUN_ID;
  delete baseEnv.GUILD_RUN_BINDING_REF;
  // Cross-family reproducibility (independent-review blocker 4): the verdict
  // must not depend on the parent host's identity or cmux workspace.
  delete baseEnv.GUILD_HOST;
  delete baseEnv.GUILD_HOST_ID;
  delete baseEnv.GUILD_ORCHESTRATOR_HOST;
  delete baseEnv.CMUX_WORKSPACE_ID;
  baseEnv.GUILD_DISPATCH_APPROVAL_OVERRIDE =
    "no-poison fixture: approval verification is pinned separately";
  const finalEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...baseEnv, ...extraEnv })) {
    if (v !== undefined) finalEnv[k] = v;
  }
  const script = path.join(pluginRoot, "scripts", "agent-team-launcher.ts");
  const tsxBin = process.env["GUILD_TSX_BIN"];
  const result = tsxBin
    ? spawnSync(tsxBin, [script, ...args], { encoding: "utf8", env: finalEnv, timeout: 120_000 })
    : spawnSync("npx", ["tsx", script, ...args], { encoding: "utf8", env: finalEnv, timeout: 120_000 });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function taskCellRecords(tmpDir: string): string[] {
  const root = path.join(tmpDir, ".guild", "runs", RUN_ID, "task-cells");
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(abs);
    }
  };
  walk(root);
  return out;
}

describe("Fix B — failed/dry preflight cannot poison attempt-1 records", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-no-poison-"));
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--dry-run exits 0 and persists ZERO task-cell records", () => {
    const { teamPath } = seedRepo(tmpDir);
    const { exitCode, stderr } = runLauncher([
      "--team",
      teamPath,
      "--cwd",
      tmpDir,
      "--dry-run",
    ]);
    expect(stderr).not.toMatch(/ERROR/);
    expect(exitCode).toBe(0);
    expect(taskCellRecords(tmpDir)).toEqual([]);
  });

  it("a real launch refused at the collision gate exits 1 with ZERO task-cell records", () => {
    const { teamPath } = seedRepo(tmpDir);
    const binDir = makeCollidingTmux(tmpDir);
    const { exitCode, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir],
      { PATH: `${binDir}:${process.env["PATH"] ?? ""}` }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/already exists/);
    // The poison: pre-fix, attempt-1 records were already on disk here.
    expect(taskCellRecords(tmpDir)).toEqual([]);
  });

  it("a real launch with invalid exact-plugin activation refuses before TaskCells", () => {
    const { teamPath } = seedRepo(tmpDir);
    const binDir = makeAvailableTmux(tmpDir);
    const invalidRoot = path.join(tmpDir, "missing-plugin-package");
    const { exitCode, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir],
      {
        GUILD_PLUGIN_ROOT: invalidRoot,
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/preflight failed.*explicit Guild plugin root.*invalid/is);
    expect(taskCellRecords(tmpDir)).toEqual([]);
  });

  it("a dry run with invalid exact-plugin activation refuses instead of reporting success", () => {
    const { teamPath } = seedRepo(tmpDir);
    const invalidRoot = path.join(tmpDir, "missing-plugin-package");
    const { exitCode, stdout, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { GUILD_PLUGIN_ROOT: invalidRoot }
    );
    expect(exitCode).toBe(2);
    expect(stdout).not.toMatch(/dry-run complete/);
    expect(stderr).toMatch(/tmux command failed.*explicit Guild plugin root.*invalid/is);
    expect(taskCellRecords(tmpDir)).toEqual([]);
  });

  it("settles attempt-1 failed when final exact-package planning refuses before pane spawn", () => {
    const pluginRoot = createExactClaudePluginFixture();
    try {
      const { teamPath } = seedRepo(tmpDir);
      fs.copyFileSync(path.join(FIXTURES, "team-mixed-host.yaml"), teamPath);
      const binDir = makeMutatingMixedHostBin(tmpDir);
      const { exitCode, stderr } = runLauncher(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          GUILD_MUTATE_PLUGIN_ROOT: pluginRoot,
          OPENAI_API_KEY: "test-only",
          PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
        },
        pluginRoot,
      );
      expect(stderr).toMatch(/tmux no-pane failure lifecycle: \d+ failed, 0 orphaned/i);
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/complete payload digest differs/i);
      const attempts = taskCellRecords(tmpDir)
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
        .filter((record) => record["schema_version"] === "guild.task_attempt.v1");
      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts.every((attempt) => attempt["terminal_state"] === "failed")).toBe(true);
    } finally {
      fs.rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

});
