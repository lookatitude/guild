/**
 * scripts/__tests__/frozen-dispatch-authority.test.ts
 *
 * Independent-review blocker 1 (run-identity-and-dispatch, W4): the frozen
 * `snapshot.dispatch` block written by runStartPreflight/U6 to
 * `.guild/runs/<run-id>/resolved-settings.json` must be AUTHORITATIVE on the
 * executable launcher path. Before this fix the launcher re-probed ambient
 * CMUX_WORKSPACE_ID / tmux state at dispatch time, so a mid-run environment
 * change could select a different backend than the run-start decision —
 * violating the central W4 invariant (RID-D-CONSTRAINT: backend resolution is
 * frozen at intake).
 *
 * Production-path regressions (real launcher CLI subprocess):
 *   1. Frozen backend "cmux" + ambient CMUX_WORKSPACE_ID ABSENT at dispatch →
 *      the launcher still emits the {backend:"cmux"} signal (frozen wins).
 *   2. Frozen backend "tmux" + ambient CMUX_WORKSPACE_ID SET at dispatch →
 *      NO cmux signal; the launcher proceeds down the tmux rung (frozen wins;
 *      ambient cannot hijack).
 *   3. Legacy control: NO snapshot on disk + ambient CMUX_WORKSPACE_ID set →
 *      the pre-existing ambient ladder still selects cmux (back-compat for
 *      runs whose snapshot predates the dispatch block).
 *   4. The legacy no---agent-mode path also honors a frozen "cmux" backend
 *      instead of launching tmux panes inside a cmux-frozen run.
 *   5. Legacy frozen direct modes receive the same capability-scope refusal as
 *      explicit direct modes; dry-run previews are non-dispatchable.
 *   6. An approved unknown/project role with no resolved scope retains the
 *      legacy direct-dispatch compatibility path.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createExactClaudePluginFixture } from "./fixtures/exact-claude-plugin-fixture";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const binding = require("../../src/modules/lifecycle/workflows/run-binding") as
  typeof import("../../src/modules/lifecycle/workflows/run-binding");

const FIXTURES = path.resolve(__dirname, "../fixtures");
const RUN_ID = "run-20260811-000800-frozen-dispatch";
const EXACT_CLAUDE_PLUGIN_ROOT = createExactClaudePluginFixture();
const SCRIPT = path.join(EXACT_CLAUDE_PLUGIN_ROOT, "scripts", "agent-team-launcher.ts");

afterAll(() => fs.rmSync(EXACT_CLAUDE_PLUGIN_ROOT, { recursive: true, force: true }));

function seedRepo(tmpDir: string): { teamPath: string } {
  const teamDir = path.join(tmpDir, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const teamPath = path.join(teamDir, "test-slug.yaml");
  fs.copyFileSync(path.join(FIXTURES, "team-agent-team.yaml"), teamPath);
  const runsRoot = path.join(tmpDir, ".guild", "runs");
  fs.mkdirSync(path.join(runsRoot, RUN_ID), { recursive: true });
  fs.writeFileSync(path.join(runsRoot, "current-run-id"), `${RUN_ID}\n`, "utf8");
  binding.mintRunBinding({ root: tmpDir, run_id: RUN_ID });
  const ctxDir = path.join(tmpDir, ".guild", "context", RUN_ID);
  fs.mkdirSync(ctxDir, { recursive: true });
  for (const role of ["architect", "backend", "qa"]) {
    fs.writeFileSync(path.join(ctxDir, `${role}-${role}.md`), `# ${role}\n`);
  }
  return { teamPath };
}

function writeFrozenDispatch(
  tmpDir: string,
  backend: "cmux" | "tmux" | "agent" | "subagent"
): void {
  const snapshot = {
    schema_version: "guild.resolved_settings.v1",
    source_chain: {},
    effective: { agent_mode: "team" },
    providers: { authorHost: "claude", authorTrust: "verified", detected: [], recommended: null },
    roles: {},
    dispatch: {
      backend,
      reason: `test-frozen: intake resolved ${backend}`,
      facts: {
        cmux_workspace_present: backend === "cmux",
        tmux_on_path: true,
        agent_mode: "team",
      },
    },
    communication_contract: "review_result.v1",
    resolved_at_ref: RUN_ID,
  };
  fs.writeFileSync(
    path.join(tmpDir, ".guild", "runs", RUN_ID, "resolved-settings.json"),
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf8"
  );
}

function runLauncher(
  args: string[],
  extraEnv: Record<string, string | undefined> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  delete baseEnv.TMUX;
  delete baseEnv.GUILD_RUN_ID;
  delete baseEnv.GUILD_RUN_BINDING_REF;
  delete baseEnv.GUILD_HOST;
  delete baseEnv.GUILD_HOST_ID;
  delete baseEnv.GUILD_ORCHESTRATOR_HOST;
  delete baseEnv.CMUX_WORKSPACE_ID;
  baseEnv.GUILD_PLUGIN_ROOT = EXACT_CLAUDE_PLUGIN_ROOT;
  baseEnv.GUILD_DISPATCH_APPROVAL_OVERRIDE =
    "frozen-dispatch fixture: approval verification is pinned separately";
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

function makeFakeCmuxBin(root: string): string {
  const binDir = path.join(root, "fake-cmux-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const cmux = path.join(binDir, "cmux");
  fs.writeFileSync(
    cmux,
    ["#!/bin/sh", "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
  return binDir;
}

describe("W4 — frozen snapshot.dispatch is authoritative on the launcher path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-frozen-dispatch-"));
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("frozen cmux wins when ambient CMUX_WORKSPACE_ID is ABSENT at dispatch", () => {
    const { teamPath } = seedRepo(tmpDir);
    writeFrozenDispatch(tmpDir, "cmux");
    const { exitCode, stdout } = runLauncher([
      "--team", teamPath,
      "--cwd", tmpDir,
      "--agent-mode=team",
      "--dry-run",
    ]);
    expect(exitCode).toBe(0);
    const signal = JSON.parse(stdout.trim().split("\n").pop() as string);
    expect(signal.backend).toBe("cmux");
    expect(signal.reason).toMatch(/frozen at run start/i);
  });

  it("real frozen-cmux dispatch refuses adapter preflight before immutable task-cell writes", () => {
    const { teamPath } = seedRepo(tmpDir);
    fs.copyFileSync(path.join(FIXTURES, "team-mixed-host.yaml"), teamPath);
    // An empty .git directory is not a repository and makes the strict
    // specialist-instance source-commit probe fail before dispatch ordering;
    // this case exercises cmux preflight, so retain the normal non-repo fixture.
    fs.rmSync(path.join(tmpDir, ".git"), { recursive: true, force: true });
    writeFrozenDispatch(tmpDir, "cmux");
    const emptyCodexHome = path.join(tmpDir, "empty-codex-home");
    fs.mkdirSync(emptyCodexHome, { recursive: true });
    const fakeBin = makeFakeCmuxBin(tmpDir);

    const { exitCode, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team"],
      {
        CMUX_WORKSPACE_ID: "ws-real-preflight",
        CODEX_HOME: emptyCodexHome,
        OPENAI_API_KEY: undefined,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/cmux preflight refused|no OPENAI_API_KEY/i);
    expect(fs.existsSync(path.join(tmpDir, ".guild", "runs", RUN_ID, "task-cells"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".guild", "runs", RUN_ID, "task-runs"))).toBe(false);
  });

  it("frozen tmux wins when ambient CMUX_WORKSPACE_ID IS set at dispatch", () => {
    const { teamPath } = seedRepo(tmpDir);
    writeFrozenDispatch(tmpDir, "tmux");
    const { exitCode, stdout } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team", "--dry-run"],
      { CMUX_WORKSPACE_ID: "ws-ambient-hijack" }
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/"backend":"cmux"/);
    // The tmux rung proceeded: dry-run prints the planned tmux commands.
    expect(stdout).toMatch(/would execute the following tmux commands/);
  });

  it("LEGACY CONTROL: no snapshot → the ambient ladder still selects cmux", () => {
    const { teamPath } = seedRepo(tmpDir);
    const { exitCode, stdout } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team", "--dry-run"],
      { CMUX_WORKSPACE_ID: "ws-legacy" }
    );
    expect(exitCode).toBe(0);
    const signal = JSON.parse(stdout.trim().split("\n").pop() as string);
    expect(signal.backend).toBe("cmux");
  });

  it("fails closed when a present frozen dispatch block is malformed", () => {
    const { teamPath } = seedRepo(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "runs", RUN_ID, "resolved-settings.json"),
      JSON.stringify({
        schema_version: "guild.resolved_settings.v1",
        dispatch: { backend: "not-a-backend" },
      }) + "\n",
      "utf8",
    );
    const { exitCode, stdout, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=team", "--dry-run"],
      { CMUX_WORKSPACE_ID: "ws-must-not-win" },
    );
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toMatch(/"backend":"cmux"/);
    expect(stderr).toMatch(/frozen dispatch authority has an invalid backend/i);
  });

  it("the legacy no---agent-mode path honors a frozen cmux backend too", () => {
    const { teamPath } = seedRepo(tmpDir);
    writeFrozenDispatch(tmpDir, "cmux");
    const { exitCode, stdout } = runLauncher([
      "--team", teamPath,
      "--cwd", tmpDir,
      "--dry-run",
    ]);
    expect(exitCode).toBe(0);
    const signal = JSON.parse(stdout.trim().split("\n").pop() as string);
    expect(signal.backend).toBe("cmux");
    expect(signal.reason).toMatch(/frozen at run start/i);
    expect(signal.taskCellsWritten).toBe(0);
    expect(signal.plannedCommands).toEqual(expect.arrayContaining([
      expect.stringMatching(/cmux new-pane/),
    ]));
    expect(signal.notes.join(" ")).toMatch(/availability.*withheld.*real dispatch/i);
    expect(signal.teamResult).toBeNull();
    expect(signal.manifest).toBeNull();
    expect(signal.teamResultPreview).toBeDefined();
    expect(signal.manifestPreview).toBeDefined();
  });

  it.each(["agent", "subagent"] as const)(
    "the legacy no---agent-mode path refuses a frozen scoped %s dispatch",
    (backend) => {
      const { teamPath } = seedRepo(tmpDir);
      writeFrozenDispatch(tmpDir, backend);
      const { exitCode, stdout, stderr } = runLauncher([
        "--team", teamPath,
        "--cwd", tmpDir,
      ]);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("REFUSED (capability-scope carriage)");
      expect(stderr).toContain(`backend "${backend}"`);
    },
  );

  it("marks a legacy frozen scoped direct dry-run as preview-only", () => {
    const { teamPath } = seedRepo(tmpDir);
    writeFrozenDispatch(tmpDir, "agent");
    const { exitCode, stdout } = runLauncher([
      "--team", teamPath,
      "--cwd", tmpDir,
      "--dry-run",
    ]);
    expect(exitCode).toBe(0);
    const signal = JSON.parse(stdout.trim().split("\n").pop() as string);
    expect(signal.backend).toBe("agent");
    expect(signal.dispatchAllowed).toBe(false);
    expect(signal.previewOnly).toBe(true);
    expect(signal.teamPath).toBe(teamPath);
    expect(signal.teamSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each(["agent", "subagent"] as const)(
    "never authorizes an unscoped custom-role frozen %s dry-run",
    (backend) => {
      const { teamPath } = seedRepo(tmpDir);
      fs.writeFileSync(
        teamPath,
        [
          "spec: .guild/spec/test-slug.md",
          "backend: agent-team",
          "specialists:",
          "  - name: custom-role",
          "    scope: approved project-specific work",
          "    depends-on: []",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFrozenDispatch(tmpDir, backend);
      const { exitCode, stdout } = runLauncher([
        "--team", teamPath,
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout.trim().split("\n").pop() as string);
      expect(signal.backend).toBe(backend);
      expect(signal.dispatchAllowed).toBe(false);
      expect(signal.previewOnly).toBe(true);
    },
  );

  it("preserves the frozen direct production path for an approved unscoped custom role", () => {
    const { teamPath } = seedRepo(tmpDir);
    fs.writeFileSync(
      teamPath,
      [
        "spec: .guild/spec/test-slug.md",
        "backend: agent-team",
        "specialists:",
        "  - name: custom-role",
        "    scope: approved project-specific work",
        "    depends-on: []",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFrozenDispatch(tmpDir, "subagent");
    const { exitCode, stdout } = runLauncher([
      "--team", teamPath,
      "--cwd", tmpDir,
    ]);
    expect(exitCode).toBe(0);
    const signal = JSON.parse(stdout.trim().split("\n").pop() as string);
    expect(signal.backend).toBe("subagent");
    expect(signal.dispatchAllowed).toBe(true);
    expect(signal.previewOnly).toBe(false);
  });
});
