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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const binding = require("../../src/modules/lifecycle/workflows/run-binding") as
  typeof import("../../src/modules/lifecycle/workflows/run-binding");

const SCRIPT = path.resolve(__dirname, "../agent-team-launcher.ts");
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
  for (const role of ["architect", "backend", "qa"]) {
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

function runLauncher(
  args: string[],
  extraEnv: Record<string, string | undefined> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const baseEnv: Record<string, string | undefined> = { ...process.env };
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
  const tsxBin = process.env["GUILD_TSX_BIN"];
  const result = tsxBin
    ? spawnSync(tsxBin, [SCRIPT, ...args], { encoding: "utf8", env: finalEnv, timeout: 120_000 })
    : spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: finalEnv, timeout: 120_000 });
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
});
