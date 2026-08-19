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
import { createHash } from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  buildTaskCell,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
// T3 F3: descriptor writers fail closed without the run's minted binding.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const launcherTestBinding = require("../../src/modules/lifecycle/workflows/run-binding") as
  typeof import("../../src/modules/lifecycle/workflows/run-binding");
function launcherTestBindFor(cwd: string, runId: string): { binding_ref: string } {
  const existing = launcherTestBinding.loadRunBinding({ root: cwd, run_id: runId });
  return {
    binding_ref:
      (existing ?? launcherTestBinding.mintRunBinding({ root: cwd, run_id: runId })).binding_ref,
  };
}
import {
  buildAcceptance,
  markAttemptOrphaned,
  readAttemptForInstance,
  runDeterministicFloor,
  writeAcceptanceRecord,
  findRunTaskCells,
  findOrphanedAttempts,
  type TaskCellInstanceIds,
} from "../../src/modules/dispatch/workflows/task-cell-acceptance";
import { scanReceiptJournal } from "../../src/modules/telemetry";
import { settleFailedCmuxTaskCells } from "../agent-team-launcher";

const SCRIPT = path.resolve(__dirname, "../agent-team-launcher.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");
const INHERITED_RUN_ID = "run-20260811-000000-launcher-test";

function runScript(
  args: string[],
  env: Record<string, string | undefined> = {},
  seedLifecycleRun = true,
): { exitCode: number; stdout: string; stderr: string } {
  // Scrub TMUX from env unless the test wants it set, so host terminal state
  // does not accidentally trip the nested-tmux guard.
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  delete baseEnv.TMUX;
  // T3: scrub the ambient hook binding envelope too — a developer's live Guild
  // session exports GUILD_RUN_ID (and telemetry writers key off it), which
  // would leak a second run dir into the fixture and satisfy/skew the
  // launcher's envelope-based binding resolution. Tests that exercise the
  // envelope path set these explicitly via the `env` param.
  delete baseEnv.GUILD_RUN_ID;
  delete baseEnv.GUILD_RUN_BINDING_REF;
  // Cross-family reproducibility (independent-review blocker 4): scrub the
  // ambient HOST IDENTITY as well. Under a Codex-shaped parent environment
  // (GUILD_HOST=codex-cli etc.) the launcher resolves a codex orchestrator and
  // this suite went 7-red while being green under Claude — a review gate must
  // not change verdict with its parent host. Host-specific cases set these
  // EXPLICITLY via the `env` param.
  delete baseEnv.GUILD_HOST;
  delete baseEnv.GUILD_HOST_ID;
  delete baseEnv.GUILD_ORCHESTRATOR_HOST;
  delete baseEnv.CMUX_WORKSPACE_ID;
  // W1/W2: normal launcher fixtures represent execute-plan after lifecycle
  // start. Seed the lifecycle-owned sentinel + binding when a dispatch caller
  // intentionally omits --run-id; the production launcher must inherit this
  // identity, never mint another one. Tests for the missing-sentinel refusal
  // opt out with the third parameter.
  const cwdIndex = args.indexOf("--cwd");
  const hasExplicitRunId = args.includes("--run-id");
  const isAdministrative = args.includes("--reap") || args.includes("--dismiss-completed");
  if (seedLifecycleRun && cwdIndex >= 0 && !hasExplicitRunId && !isAdministrative) {
    const cwd = args[cwdIndex + 1];
    const runsRoot = path.join(cwd, ".guild", "runs");
    fs.mkdirSync(runsRoot, { recursive: true });
    fs.writeFileSync(path.join(runsRoot, "current-run-id"), `${INHERITED_RUN_ID}\n`, "utf8");
    launcherTestBindFor(cwd, INHERITED_RUN_ID);
    // Real (non-preview) launcher fixtures also represent execute-plan after
    // context assembly. Supply the canonical default owner/task pairs used by
    // the fixture teams so the test reaches the behavior it was written for.
    writeRunContexts(cwd, INHERITED_RUN_ID, [
      ["architect", "architect"],
      ["backend", "backend"],
      ["qa", "qa"],
      ["security", "security"],
      ["kb-viz-engineer", "kb-viz-engineer"],
      ["cursor-reviewer", "cursor-reviewer"],
    ]);
  }
  // T7R-R1-B1: approve-before-dispatch verification is now MANDATORY on the real
  // launcher path, and these fixtures deliberately carry no proposal/decision
  // trail — they exercise routing, scoping, tiering and teardown, not approval.
  // Opt them into the ONE audited escape hatch, with a stated reason, so the
  // gate is exercised rather than disabled. A test that means to exercise the
  // gate itself passes GUILD_DISPATCH_APPROVAL_OVERRIDE: undefined via `env`.
  // The gate's own pins live in __tests__/t7-h1-dispatch-approval.test.ts.
  baseEnv.GUILD_DISPATCH_APPROVAL_OVERRIDE =
    "launcher unit fixture: no team-plan trail; approval verification is pinned separately";
  const finalEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...baseEnv, ...env })) {
    if (v !== undefined) finalEnv[k] = v;
  }
  // GUILD_TSX_BIN pins the TypeScript runner for the spawned launcher. When it is
  // unset the default `npx tsx` path is used, so the repository's own `npm test`
  // is unchanged; when it is set (hermetic/offline runs against a pre-provisioned
  // runner) the child is exec'd directly and npx never resolves or fetches tsx.
  const tsxBin = process.env["GUILD_TSX_BIN"];
  const result = tsxBin
    ? spawnSync(tsxBin, [SCRIPT, ...args], {
        encoding: "utf8",
        env: finalEnv,
        timeout: 120_000,
      })
    : spawnSync("npx", ["tsx", SCRIPT, ...args], {
        encoding: "utf8",
        env: finalEnv,
        timeout: 120_000,
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

function writeRunContexts(cwd: string, runId: string, lanes: Array<[string, string]>): void {
  const dir = path.join(cwd, ".guild", "context", runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [role, taskId] of lanes) {
    fs.writeFileSync(path.join(dir, `${role}-${taskId}.md`), `# ${role}/${taskId}\n`);
  }
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

// Fix B: a fake tmux for REAL (non-dry) launch tests — reports available,
// reports NO existing session (`has-session` exits 1, so the collision gate
// passes), and no-ops every spawn/attach subcommand successfully.
function makeLaunchableTmuxBin(tmpDir: string): string {
  const binDir = path.join(tmpDir, "fakebin-launchable");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "tmux"),
    [
      "#!/bin/sh",
      'case "$1" in',
      '  -V) echo "tmux 3.4 (fake)"; exit 0;;',
      "  has-session) exit 1;;",
      "  list-windows) exit 0;;",
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
  // TE-07: canonical field name is tier_models
  const tierModels =
    hostKind === "codex"
      ? { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" }
      : { cheap: "haiku", mid: "sonnet", powerful: "opus" };
  const manifest = {
    schema_version: "guild.host_capability.v1",
    host_id: hostId,
    host_kind: hostKind,
    // TE-07: canonical field name is advertised_at
    advertised_at: new Date().toISOString(),
    source: "test",
    tier_models: tierModels,
    supported_tiers: ["cheap", "mid", "powerful"],
    models: Object.values(tierModels),
    tool_support: {
      subagent: true,
      agent_team: hostKind === "claude",
      independent_agents: hostKind === "claude",
      tmux: hostKind === "claude",
      mcp: true,
      // HK-07 (Cluster B): required field added by write-host-capability.ts
      pre_tool_use_ask: hostKind === "claude",
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

    it("does not write the retired per-specialist v1 assignment shadow channel", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-test-ta",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir)!;
      // .../runs/<id>/agent-team/session.json → .../runs/<id>
      const runDir = path.dirname(path.dirname(sessionJson));
      expect(fs.existsSync(path.join(runDir, "tasks"))).toBe(false);
      // Fix B (run-identity-and-dispatch): a dry run persists NOTHING under
      // task-cells/ — the records are immutable attempt-1 files whose presence
      // poisoned the next real launch of the same run id.
      expect(fs.existsSync(path.join(runDir, "task-cells"))).toBe(false);
    });

    it("exports GUILD_TASK_ASSIGNMENT into each pane command", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { stdout } = runScript([
        "--team",
        teamPath,
        "--session-name",
        "guild-test-ta-env",
        "--cwd",
        tmpDir,
        "--dry-run",
      ]);
      expect(stdout).toMatch(/GUILD_TASK_ASSIGNMENT=/);
      expect(stdout).toMatch(/GUILD_TASK_CELL_INSTANCE_ID=/);
      expect(stdout).toMatch(/task-cells\/(architect|backend|qa)\/attempts\/1\/instances\/.+\/assignment\.json/);
    });

    it("emits guild.task_assignment.v2 per TASK — a specialist owning 2 tasks → 2 cells, no overwrite (AT1)", () => {
      // task-cell-runtime G3: the authoritative v2 channel replaces the v1
      // representative-first-task collapse. Give `backend` TWO plan lanes so the
      // fan-out MUST write two distinct immutable cells (P0.3 / adversarial test 1).
      // Fix B: cell emission is now REAL-RUN-ONLY (post-gates), so this pin runs
      // a real launch against a launchable fake tmux instead of a dry run.
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(
        path.join(planDir, "test-slug.md"),
        [
          "## Lane: backend contract",
          "- task-id: T1-backend",
          "- owner: backend",
          "",
          "## Lane: backend data layer",
          "- task-id: T2-backend",
          "- owner: backend",
          "",
          "## Lane: architect boundaries",
          "- task-id: T0-architect",
          "- owner: architect",
          "",
        ].join("\n"),
      );
      // Real-run cell emission computes strict per-task context hashes — seed
      // the per-task bundles the plan lanes above resolve to.
      const ctxDir = path.join(tmpDir, ".guild", "context", INHERITED_RUN_ID);
      fs.mkdirSync(ctxDir, { recursive: true });
      for (const bundle of ["backend-T1-backend", "backend-T2-backend", "architect-T0-architect"]) {
        fs.writeFileSync(path.join(ctxDir, `${bundle}.md`), `# ${bundle}\n`);
      }
      runScript(
        [
          "--team",
          teamPath,
          "--session-name",
          "guild-test-v2",
          "--cwd",
          tmpDir,
        ],
        { PATH: `${makeLaunchableTmuxBin(tmpDir)}:${process.env["PATH"] ?? ""}` }
      );
      const sessionJson = findSessionJson(tmpDir)!;
      const runDir = path.dirname(path.dirname(sessionJson));
      const cellsRoot = path.join(runDir, "task-cells");
      expect(fs.existsSync(cellsRoot)).toBe(true);

      const assignmentPath = (lt: string) => {
        const instances = path.join(cellsRoot, lt, "attempts", "1", "instances");
        const instanceIds = fs.readdirSync(instances);
        expect(instanceIds).toHaveLength(1);
        return path.join(instances, instanceIds[0], "assignment.json");
      };

      // backend owns two logical tasks → two distinct, non-overwritten assignment files.
      for (const lt of ["T1-backend", "T2-backend", "T0-architect"]) {
        expect(fs.existsSync(assignmentPath(lt))).toBe(true);
        const a = JSON.parse(fs.readFileSync(assignmentPath(lt), "utf8"));
        expect(a.schema_version).toBe("guild.task_assignment.v2");
        expect(a.logical_task_id).toBe(lt);
        const instance = JSON.parse(
          fs.readFileSync(path.join(path.dirname(assignmentPath(lt)), "instance.json"), "utf8"),
        );
        expect(instance.schema_version).toBe("guild.agent_instance.v1");
        expect(instance.substrate).toBe("tmux");
        // The attempt companion sits ABOVE the instances (one immutable file per attempt).
        expect(
          fs.existsSync(path.join(cellsRoot, lt, "attempts", "1", "attempt.json"))
        ).toBe(true);
      }

      const c1 = JSON.parse(fs.readFileSync(assignmentPath("T1-backend"), "utf8"));
      const c2 = JSON.parse(fs.readFileSync(assignmentPath("T2-backend"), "utf8"));
      // Same specialist (worker_role), distinct instances + fresh contexts + handoffs.
      expect(c1.worker_role).toBe("backend");
      expect(c2.worker_role).toBe("backend");
      expect(c1.instance_id).not.toBe(c2.instance_id);
      expect(c1.context_bundle_id).not.toBe(c2.context_bundle_id);
      expect(c1.handoff_path).not.toBe(c2.handoff_path);
      for (const assignment of [c1, c2]) {
        expect(assignment.context_bundle_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(assignment.host_capabilities_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(assignment.specialist_type_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(assignment.specialist_profile_hash).toMatch(/^[0-9a-f]{64}$/);
      }

      // PCL-09: these identity hashes came from real shipped-template reads.
      // Every concrete read must pass through the compatibility loader and
      // leave a durable, non-synthetic usage receipt for the G5 window.
      const compatibilityReceipts = scanReceiptJournal(
        path.join(runDir, "receipts", "journal.jsonl"),
      ).records.filter(
        (record) =>
          record.scenario_id === "PCL-09" &&
          record.operation_id.startsWith("compatibility-read:task-cell-identity-"),
      );
      expect(compatibilityReceipts).toHaveLength(4);
      expect(compatibilityReceipts.map((record) => record.operation_id).sort()).toEqual([
        "compatibility-read:task-cell-identity-T0-architect-architect",
        "compatibility-read:task-cell-identity-T1-backend-backend",
        "compatibility-read:task-cell-identity-T2-backend-backend",
        "compatibility-read:task-cell-identity-qa-qa",
      ]);
      expect(compatibilityReceipts.every((record) => record.observation_state === "checked_clean")).toBe(true);
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

    it("codex-started dry-run uses codex as orchestrator and default pane host", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { stdout, exitCode } = runScript(
        [
          "--team",
          teamPath,
          "--session-name",
          "guild-codex-started",
          "--cwd",
          tmpDir,
          "--dry-run",
        ],
        { GUILD_HOST_ID: "codex-cli", OPENAI_API_KEY: "sk-test" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/tmux\s+new-session/);
      expect(stdout).toMatch(/codex exec/);
      expect(stdout).toMatch(/agent-bus/);
      expect(stdout).not.toMatch(/TaskCreated/);
      expect(stdout).not.toMatch(/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/);

      const sessionJson = findSessionJson(tmpDir)!;
      const manifest = JSON.parse(fs.readFileSync(sessionJson, "utf8"));
      expect(manifest.orchestrator_host_kind).toBe("codex");
      expect(manifest.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
      const hosts = manifest.teammate_panes.map((p: { host_kind: string }) => p.host_kind);
      expect(new Set(hosts)).toEqual(new Set(["codex"]));
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

    // D5 rung 3 (in-process) — the launcher must ACTUALLY construct
    // InProcessTeamBackend and return its dispatchPlan (dispatch.md
    // §"In-process dispatchPlan consumption" + SKILL.md §"Backend + routing"),
    // not just emit {backend,reason,slug} and exit. Asserts the full agent-rung
    // JSON signal shape execute-plan consumes.
    it("agent-mode=agent: the JSON signal carries a real dispatchPlan (one descriptor per specialist)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      launcherTestBindFor(tmpDir, "run-20260811-010000-agent-shape-test");
      writeRunContexts(tmpDir, "run-20260811-010000-agent-shape-test", [["architect", "architect"], ["backend", "backend"], ["qa", "qa"]]);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=agent", "--run-id", "run-20260811-010000-agent-shape-test"]
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("agent");
      expect(signal.slug).toBe("test-slug");
      expect(signal.ok).toBe(true);
      // No tmux panes on this rung (mirrors RemoteTeamBackend §CH-4 — the
      // orchestrator never gets a descriptor either).
      expect(signal.orchestratorPaneId).toBeNull();
      expect(signal.teammatePaneIds).toEqual({});
      expect(Array.isArray(signal.dispatchPlan)).toBe(true);
      expect(signal.dispatchPlan).toHaveLength(3); // architect, backend, qa
      const names = signal.dispatchPlan.map((d: { name: string }) => d.name);
      expect(names).toEqual(["architect--architect--a1", "backend--backend--a1", "qa--qa--a1"]);
      for (const d of signal.dispatchPlan) {
        expect(typeof d.subagentType).toBe("string");
        expect(d.model).toBeNull(); // tiering is orthogonal — resolved at dispatch
        expect(d.env.GUILD_RUN_ID).toBe("run-20260811-010000-agent-shape-test");
        expect(d.name).toBe(`${d.env.GUILD_SPECIALIST}--${d.env.GUILD_TASK_ID}--a1`);
        expect(d.env.GUILD_TASK_ASSIGNMENT).toMatch(/task-cells\/.+\/assignment\.json$/);
        expect(typeof d.prompt).toBe("string");
        expect(d.prompt.length).toBeGreaterThan(0);
      }
    });

    // dry-run on the agent rung is a semantic no-op (no subprocess to suppress)
    // — same dispatchPlan, annotated notes, per dispatch.md.
    it("agent-mode=agent --dry-run: still returns the full dispatchPlan (declarative, no side effects)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      launcherTestBindFor(tmpDir, "run-20260811-010001-agent-dryrun-test");
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=agent", "--dry-run",
         "--run-id", "run-20260811-010001-agent-dryrun-test"]
      );
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.ok).toBe(true);
      expect(signal.dispatchPlan).toHaveLength(3);
      expect(signal.notes.join(" ")).toMatch(/dry-run/i);
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

    // MH-04 selector reach. Every assertion above is satisfied by BOTH the old
    // inline ladder and the port rewire, because the port reproduces the shipped
    // reason strings verbatim — so none of them can tell the two apart. This one
    // can: it intercepts module loading INSIDE the spawned launcher process and
    // records each call to the port's `selectExecutionSubstrate`. On the pre-MH-04
    // launcher the recording stays empty while stdout is byte-for-byte the same,
    // which is exactly what makes this assertion the discriminating one.
    it("the spawned launcher reaches the port-authored selector (not a launcher-local ladder)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const noTmuxBin = makeUnavailableTmuxBin(tmpDir);
      const recordPath = path.join(tmpDir, "selector-calls.jsonl");

      // A CommonJS preload that wraps the port module's export in the CHILD
      // process. tsx compiles the launcher to CJS, so the port import goes
      // through Module._load; a Proxy is used because esbuild's export getters
      // are non-configurable and cannot be redefined in place.
      const hookPath = path.join(tmpDir, "selector-probe.cjs");
      fs.writeFileSync(
        hookPath,
        [
          'const Module = require("module");',
          'const fsx = require("fs");',
          "const out = process.env.GUILD_SELECTOR_PROBE_FILE;",
          "const load = Module._load;",
          "Module._load = function (request) {",
          "  const exported = load.apply(this, arguments);",
          '  if (typeof request === "string" && request.endsWith("execution-transport-ports") && exported) {',
          "    return new Proxy(exported, {",
          "      get(target, prop, receiver) {",
          "        const value = Reflect.get(target, prop, receiver);",
          '        if (prop === "selectExecutionSubstrate" && typeof value === "function") {',
          "          return function (...callArgs) {",
          "            const selection = value.apply(this, callArgs);",
          '            fsx.appendFileSync(out, JSON.stringify(selection) + "\\n");',
          "            return selection;",
          "          };",
          "        }",
          "        return value;",
          "      },",
          "    });",
          "  }",
          "  return exported;",
          "};",
          "",
        ].join("\n")
      );

      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=auto"],
        {
          TMUX: undefined,
          PATH: `${noTmuxBin}:${process.env.PATH ?? ""}`,
          GUILD_INDEPENDENT_AGENTS_SUPPORTED: "1",
          GUILD_SELECTOR_PROBE_FILE: recordPath,
          NODE_OPTIONS: `--require "${hookPath}"`,
        }
      );

      expect(exitCode).toBe(0);

      // The port-authored selector actually RAN in the launcher process.
      expect(fs.existsSync(recordPath)).toBe(true);
      const calls = fs
        .readFileSync(recordPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(calls.length).toBeGreaterThanOrEqual(1);

      // It returned the versioned contract record — facts the inline ladder
      // never produced, so these cannot be reproduced by copied reason strings.
      const selection = calls[0];
      expect(selection.schema_version).toBe("guild.execution.transports.v1");
      expect(selection.contract_version).toBe(1);
      expect(selection.dispatch_mode).toBe("agent");
      expect(selection.transport_id).toBe("in-process");

      // And the launcher PRINTED the port's decision rather than one of its own.
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe(selection.dispatch_mode);
      expect(signal.reason).toBe(selection.reason);
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
      // Null out BOTH auth paths to deterministically exercise the CH-6 refusal:
      //   1. OPENAI_API_KEY cleared (set to undefined so it is deleted from child env).
      //   2. CODEX_HOME pointed at an empty temp dir so auth.json is absent there too
      //      (without this, a real ~/.codex/auth.json on the host satisfies the new
      //      two-path auth contract and preflight passes — the pre-fix regression).
      const emptyCodexHome = path.join(tmpDir, "empty-codex-home");
      fs.mkdirSync(emptyCodexHome, { recursive: true });
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      const bin = makeFakeMixedBin(tmpDir, { windows: ["other-window"], claudeOk: true, codexOk: true });
      const { exitCode, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          OPENAI_API_KEY: undefined,
          CODEX_HOME: emptyCodexHome,
        }
      );
      expect(exitCode).toBe(1);
      // The refusal message names both missing credential paths (CH-6 two-path contract).
      expect(stderr).toMatch(/OPENAI_API_KEY/);
      expect(stderr).toMatch(/codex login|auth\.json/i);
    });

    it("real run: auth.json present (CODEX_HOME login session) → CH-6 preflight passes (exit 0)", () => {
      // Positive case for the new two-path auth contract: OPENAI_API_KEY absent but
      // a non-empty auth.json exists at the CODEX_HOME path → preflight passes.
      const fakeCodexHome = path.join(tmpDir, "fake-codex-home");
      fs.mkdirSync(fakeCodexHome, { recursive: true });
      fs.writeFileSync(path.join(fakeCodexHome, "auth.json"), JSON.stringify({ token: "tok" }), "utf8");
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      const bin = makeFakeMixedBin(tmpDir, { windows: ["other-window"], claudeOk: true, codexOk: true });
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          OPENAI_API_KEY: undefined,
          CODEX_HOME: fakeCodexHome,
        }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/team window "guild-test-slug" created/);
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

    it("enabled + unmapped starting host refuses instead of defaulting local routing to Claude", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      const { exitCode, stderr } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST: "gemini" }
      );
      expect(exitCode).toBe(1);
      // gemini is now a dropped/unsupported host kind — it refuses at the
      // starting-host guard instead of defaulting local routing to Claude.
      expect(stderr).toMatch(/unsupported starting host/i);
      expect(stderr).toMatch(/GUILD_HOST_ID/);
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

  // ─────────────────────────────────────────────────────────────
  // task-cell-runtime P0.5 (G5) — unified run identity across backends
  //
  // A caller (guild:execute-plan) creates ONE run directory and threads its id
  // via `--run-id`. Every backend — in-process, local tmux, AND remote — MUST
  // honor that id and land context/task-runs/assignments/traces/handoffs/session
  // under the SAME `.guild/runs/<run_id>/` tree. Before the G5 fix the tmux +
  // remote paths minted a FRESH run id (splitting one fixture across different
  // run dirs); these tests FAIL if any backend reverts to minting.
  // ─────────────────────────────────────────────────────────────
  describe("unified run identity — honor caller --run-id on every backend (G5)", () => {
    // Names of run directories that actually exist under .guild/runs/. A run dir
    // is one that carries run state (agent-team/, tasks/, or task-cells/), not a
    // stray sibling like .guild/context.
    function listRunDirs(cwd: string): string[] {
      const runsRoot = path.join(cwd, ".guild", "runs");
      if (!fs.existsSync(runsRoot)) return [];
      return fs
        .readdirSync(runsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    }

    function writeSettingsCrossHost(
      cwd: string,
      hosts: Record<string, { address: string; user?: string; port?: number }>
    ): void {
      const dir = path.join(cwd, ".guild");
      fs.mkdirSync(dir, { recursive: true });
      const settings = { defaults: { cross_host: { enabled: true, hosts } } };
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");
    }

    // ── local tmux backend ────────────────────────────────────────────────
    it("tmux: caller --run-id names the ONE run directory (session + tasks + task-cells under it)", () => {
      const CALLER_ID = "run-20260811-010010-g5-tmux-caller";
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      // T3 F2/F3: the caller (execute-plan) starts the run — which mints its
      // binding — BEFORE threading --run-id to the launcher. Descriptor writers
      // fail closed without it.
      launcherTestBindFor(tmpDir, CALLER_ID);
      // Two plan lanes so a real task-cells tree is written under the run id.
      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(
        path.join(planDir, "test-slug.md"),
        [
          "## Lane: backend contract",
          "- task-id: T1-backend",
          "- owner: backend",
          "",
          "## Lane: architect boundaries",
          "- task-id: T0-architect",
          "- owner: architect",
          "",
        ].join("\n"),
      );
      const contextDir = path.join(tmpDir, ".guild", "context", CALLER_ID);
      fs.mkdirSync(contextDir, { recursive: true });
      const backendContext = "# backend context\ncontract-v1\n";
      fs.writeFileSync(path.join(contextDir, "backend-T1-backend.md"), backendContext);
      // Fix B: cells are emitted only on a REAL launch (post-gates) — run one
      // against a launchable fake tmux; strict hashing needs every lane's bundle.
      fs.writeFileSync(path.join(contextDir, "architect-T0-architect.md"), "# architect\n");
      fs.writeFileSync(path.join(contextDir, "qa-qa.md"), "# qa\n");
      const { exitCode } = runScript(
        [
          "--team", teamPath,
          "--session-name", "guild-g5-tmux",
          "--cwd", tmpDir,
          "--run-id", CALLER_ID,
        ],
        { PATH: `${makeLaunchableTmuxBin(tmpDir)}:${process.env["PATH"] ?? ""}` }
      );
      expect(exitCode).toBe(0);

      // Exactly ONE run directory, named by the caller's id.
      expect(listRunDirs(tmpDir)).toEqual([CALLER_ID]);

      const runDir = path.join(tmpDir, ".guild", "runs", CALLER_ID);
      // Session + authoritative task-cells all live under it; the retired v1
      // per-specialist tasks/ shadow channel must not reappear.
      expect(fs.existsSync(path.join(runDir, "agent-team", "session.json"))).toBe(true);
      expect(fs.existsSync(path.join(runDir, "tasks"))).toBe(false);
      expect(
        fs.readdirSync(path.join(runDir, "task-cells", "T1-backend", "attempts", "1", "instances"))
          .some((instanceId) => fs.existsSync(path.join(runDir, "task-cells", "T1-backend", "attempts", "1", "instances", instanceId, "assignment.json")))
      ).toBe(true);
      const backendInstances = path.join(runDir, "task-cells", "T1-backend", "attempts", "1", "instances");
      const backendInstance = fs.readdirSync(backendInstances)[0];
      const backendAssignment = JSON.parse(fs.readFileSync(
        path.join(backendInstances, backendInstance, "assignment.json"),
        "utf8",
      ));
      expect(backendAssignment.context_bundle_hash).toBe(
        `sha256:${createHash("sha256").update(backendContext).digest("hex")}`,
      );

      // The session.json findable by the generic scanner resolves to the same id.
      const sessionJson = findSessionJson(tmpDir)!;
      expect(path.dirname(path.dirname(sessionJson))).toBe(runDir);
    });

    // ── in-process backend ────────────────────────────────────────────────
    it("in-process (--agent-mode=agent): caller --run-id threads into every dispatchPlan descriptor's GUILD_RUN_ID", () => {
      const CALLER_ID = "run-20260811-010011-g5-agent-caller";
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      launcherTestBindFor(tmpDir, CALLER_ID);
      writeRunContexts(tmpDir, CALLER_ID, [["architect", "architect"], ["backend", "backend"], ["qa", "qa"]]);
      const { exitCode, stdout } = runScript([
        "--team", teamPath,
        "--cwd", tmpDir,
        "--agent-mode=agent",
        "--run-id", CALLER_ID,
      ]);
      expect(exitCode).toBe(0);
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("agent");
      expect(signal.dispatchPlan.length).toBeGreaterThan(0);
      // Every descriptor converges on the caller's run id — never a minted one.
      for (const d of signal.dispatchPlan) {
        expect(d.env.GUILD_RUN_ID).toBe(CALLER_ID);
        expect(d.env.GUILD_TASK_CELL_INSTANCE_ID).toMatch(/\.a1\.i-/);
      }
      const cells = path.join(tmpDir, ".guild", "runs", CALLER_ID, "task-cells");
      const firstTask = fs.readdirSync(cells)[0];
      const instances = path.join(cells, firstTask, "attempts", "1", "instances");
      const firstInstance = fs.readdirSync(instances)[0];
      const instance = JSON.parse(fs.readFileSync(path.join(instances, firstInstance, "instance.json"), "utf8"));
      expect(instance.substrate).toBe("in-process");
    });

    // ── remote backend (cross-host) ───────────────────────────────────────
    it("remote (cross-host): caller --run-id names the ONE run directory for both local + remote-routed lanes", () => {
      const CALLER_ID = "run-20260811-010012-g5-remote-caller";
      // Mixed-host fixture: architect stays local (claude), security routes remote.
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      launcherTestBindFor(tmpDir, CALLER_ID); // T3 F2/F3 — caller-started run mints first

      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeSettingsCrossHost(tmpDir, {
        "codex-remote": { address: "gpu-box.example.com", user: "ci" },
      });
      const { exitCode, stdout } = runScript(
        [
          "--team", teamPath,
          "--session-name", "guild-g5-remote",
          "--cwd", tmpDir,
          "--run-id", CALLER_ID,
          "--dry-run",
        ],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/dry-run.*remote dispatch/i);

      // Exactly ONE run directory, named by the caller's id — remote dispatch did
      // NOT fork a fresh run id from the local tmux path.
      expect(listRunDirs(tmpDir)).toEqual([CALLER_ID]);

      const runDir = path.join(tmpDir, ".guild", "runs", CALLER_ID);
      // Fix B: a dry run persists NO task-cell records (immutable attempt-1
      // files would poison the next real launch) and no v1 shadow channel.
      expect(fs.existsSync(path.join(runDir, "task-cells"))).toBe(false);
      expect(fs.existsSync(path.join(runDir, "tasks"))).toBe(false);
      // Identity is still provable from the PLANNED commands: both the local
      // (architect) and remote-routed (security) lanes carry canonical
      // assignment paths under the caller's ONE run id. Real-path cell content
      // (substrate/host_id per lane) is pinned by the real-launch AT1 test.
      expect(stdout).toContain(
        `.guild/runs/${CALLER_ID}/task-cells/architect/attempts/1/instances/`
      );
      expect(stdout).toContain(
        `.guild/runs/${CALLER_ID}/task-cells/security/attempts/1/instances/`
      );
    });

    // ── no caller id → inherit lifecycle sentinel, never mint ────────────
    it("no --run-id supplied → inherits current-run-id without minting", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode } = runScript([
        "--team", teamPath,
        "--session-name", "guild-g5-mint",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      expect(exitCode).toBe(0);
      expect(listRunDirs(tmpDir)).toEqual([INHERITED_RUN_ID]);
      const manifest = JSON.parse(fs.readFileSync(findSessionJson(tmpDir)!, "utf8"));
      expect(manifest.run_id).toBe(INHERITED_RUN_ID);
    });

    it("refuses dispatch when neither --run-id nor the lifecycle sentinel exists", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const { exitCode, stderr } = runScript([
        "--team", teamPath,
        "--cwd", tmpDir,
        "--dry-run",
      ], {}, false);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/lifecycle run id|required|current-run-id/i);
      expect(listRunDirs(tmpDir)).toEqual([]);
    });

    it("rejects a non-canonical caller run id before creating dispatch state", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      launcherTestBindFor(tmpDir, "run-legacy-caller");
      const { exitCode, stderr } = runScript([
        "--team", teamPath,
        "--cwd", tmpDir,
        "--run-id", "run-legacy-caller",
        "--dry-run",
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/canonical run id/i);
      expect(fs.existsSync(path.join(tmpDir, ".guild", "runs", "run-legacy-caller", "agent-team"))).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // --dismiss-completed (P1-4 auto-dismiss loop)
  // ─────────────────────────────────────────────────────────────
  describe("--dismiss-completed", () => {
    function validReceiptContent(): string {
      return [
        "# Handoff",
        "",
        "## changed_files",
        "- src/api.ts",
        "",
        "## opens_for",
        "- qa",
        "",
        "## assumptions",
        "- DB available",
        "",
        "## evidence",
        "- tests pass",
        "",
        "## followups",
        "- add index",
        "",
        "```guild.handoff.v2",
        JSON.stringify({
          schema_version: "guild.handoff.v2",
          task_id: "task-001",
          tier: "mid",
          status: "done",
          summary: "Done.",
          artifacts: [],
          issues: [],
        }, null, 2),
        "```",
      ].join("\n");
    }

    function writeSessionJson(cwd: string, runId: string, specialists: string[]): void {
      const dir = path.join(cwd, ".guild", "runs", runId, "agent-team");
      fs.mkdirSync(dir, { recursive: true });
      const manifest = {
        run_id: runId,
        teammate_panes: specialists.map((s) => ({
          specialist: s,
          pane_id: "(dry-run: not spawned)",
          host_kind: "claude",
          adapter_version: "1",
        })),
      };
      fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify(manifest, null, 2), "utf8");
    }

    function writeHandoffReceipt(cwd: string, runId: string, specialist: string, taskId: string): void {
      const dir = path.join(cwd, ".guild", "runs", runId, "handoffs");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${specialist}-${taskId}.md`), validReceiptContent(), "utf8");
    }

    const SEED_NOW = () => "2026-07-15T00:00:00.000Z";

    /** Seed a durable acceptance record (+ sibling assignment) authorizing termination. */
    function seedAcceptance(cwd: string, runId: string, logicalTaskId: string, workerRole: string): void {
      const disp: TaskCellDispatchInput = {
        runId,
        logicalTaskId,
        taskRunId: `${logicalTaskId}.tr1`,
        attempt: 1,
        attemptId: `${logicalTaskId}.att1`,
        instanceId: `${logicalTaskId}.a1.i1`,
        cellId: `cell-${logicalTaskId}`,
        goalId: "goal",
        phaseId: "build",
        stepId: logicalTaskId,
        teamId: "guild",
        workerRole,
        specialistTypeId: workerRole,
        specialistTypeVersion: "1",
        specialistTypeHash: "sha256:type",
        specialistProfileId: workerRole,
        specialistProfileHash: "sha256:profile",
        contextBundleId: `.guild/context/${runId}/${workerRole}.md`,
        contextBundleHash: "sha256:ctx",
        hostId: "claude-code-cli",
        adapterId: "claude-code-cli@1",
        hostCapabilitiesHash: "sha256:caps",
        substrate: "tmux",
        modelTier: "mid",
        objective: `implement ${logicalTaskId}`,
        nonGoals: [],
        scopePaths: [],
        outputSchema: "guild.handoff_receipt.v1",
        acceptanceTests: [],
        dependencies: [],
        projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
        autonomyPolicy: "supervised",
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
        deadline: null,
        leadBindingId: "lead-binding",
        now: SEED_NOW,
      };
      const cell = buildTaskCell(disp);
      writeTaskCell(cwd, cell, launcherTestBindFor(cwd, cell.assignment.run_id));
      const validation = runDeterministicFloor({
        assignment: cell.assignment,
        submitted: {
          receipt_id: "r1",
          receipt_path: "handoffs/x.md",
          schema_valid: true,
          claimed_changed_files: [],
          acceptance_tests_passed: [],
          submitted_at: SEED_NOW(),
        },
        validationResultId: "val-1",
        now: SEED_NOW,
      });
      writeAcceptanceRecord(
        cwd,
        buildAcceptance({
          validation,
          acceptancePolicyVersion: "1.0.0",
          authoritiesRequired: ["deterministic_floor", "team_lead"],
          authoritiesObserved: [
            { authority: "deterministic_floor", decision: "accepted", at: SEED_NOW(), reason: null },
            { authority: "team_lead", decision: "accepted", at: SEED_NOW(), reason: null },
          ],
          now: SEED_NOW,
        })
      );
    }

    it("G4 D5: a valid receipt WITHOUT an acceptance record is NOT dismissed", () => {
      const runId = "run-dismiss-test-001";
      writeSessionJson(tmpDir, runId, ["backend"]);
      writeHandoffReceipt(tmpDir, runId, "backend", "task-001");

      const { exitCode, stdout } = runScript([
        "--dismiss-completed",
        "--run-id", runId,
        "--cwd", tmpDir,
      ]);

      expect(exitCode).toBe(0);
      // A receipt on disk authorizes nothing — no dismissal claim (P0.4 fix).
      expect(stdout).not.toMatch(/\[DISMISS\]/);
      expect(stdout).not.toMatch(/\[TERMINATED\]/);
      expect(stdout).toMatch(/does NOT authorize dismissal/);
      expect(stdout).toMatch(/No guild\.handoff_acceptance\.v1 records found/);
    });

    it("G4 D5: a durable acceptance record drives a real termination + terminal record", () => {
      const runId = "run-dismiss-accept-001";
      writeSessionJson(tmpDir, runId, ["backend"]); // pane_id is a dry-run placeholder
      seedAcceptance(tmpDir, runId, "lt-backend", "backend");

      const { exitCode, stdout } = runScript([
        "--dismiss-completed",
        "--run-id", runId,
        "--cwd", tmpDir,
      ]);

      expect(exitCode).toBe(0);
      // Acceptance-gated termination fires (placeholder pane → seal terminal, no kill).
      expect(stdout).toMatch(/\[TERMINATED\]/);
      expect(stdout).toMatch(/specialist="backend"/);
      expect(stdout).toMatch(/logical_task="lt-backend"/);
      // The terminal guild.task_attempt.v1 record was sealed.
      const attempt = readAttemptForInstance(tmpDir, {
        run_id: runId,
        logical_task_id: "lt-backend",
        attempt: 1,
        instance_id: "lt-backend.a1.i1",
      });
      expect(attempt?.terminal_state).toBe("terminated");
      expect(attempt?.immutable).toBe(true);
    });

    // ── G4 M2 + M1: multi-task-specialist guard + production reaper retry ──────
    function makeDisp(runId: string, logicalTaskId: string, workerRole: string): TaskCellDispatchInput {
      return {
        runId, logicalTaskId,
        taskRunId: `${logicalTaskId}.tr1`, attempt: 1,
        attemptId: `${logicalTaskId}.att1`, instanceId: `${logicalTaskId}.a1.i1`,
        cellId: `cell-${logicalTaskId}`, goalId: "goal", phaseId: "build",
        stepId: logicalTaskId, teamId: "guild", workerRole,
        specialistTypeId: workerRole, specialistTypeVersion: "1", specialistTypeHash: "sha256:type",
        specialistProfileId: workerRole, specialistProfileHash: "sha256:profile",
        contextBundleId: `.guild/context/${runId}/${logicalTaskId}.md`, contextBundleHash: "sha256:ctx",
        hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
        substrate: "tmux", modelTier: "mid",
        objective: `implement ${logicalTaskId}`, nonGoals: [], scopePaths: [],
        outputSchema: "guild.handoff_receipt.v1", acceptanceTests: [], dependencies: [],
        projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
        autonomyPolicy: "supervised",
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
        deadline: null, leadBindingId: "lead-binding", now: SEED_NOW,
      };
    }
    function seedCellOnly(cwd: string, runId: string, logicalTaskId: string, workerRole: string): void {
      writeTaskCell(cwd, buildTaskCell(makeDisp(runId, logicalTaskId, workerRole)), launcherTestBindFor(cwd, runId));
    }

    it("W4: cmux launch failure seals confirmed rollbacks failed and parks only survivors orphaned", () => {
      const runId = "run-20260812-000000-cmux-failure";
      seedCellOnly(tmpDir, runId, "T1", "backend");
      seedCellOnly(tmpDir, runId, "T2", "backend");
      const lanes = [
        {
          name: "backend", scope: "T1", dependsOn: [], taskId: "T1",
          dispatch_key: "backend--T1--a1", task_cell_instance_id: "T1.a1.i1",
          task_cell_assignment_path: ".guild/runs/run/task-cells/T1/assignment.json",
        },
        {
          name: "backend", scope: "T2", dependsOn: [], taskId: "T2",
          dispatch_key: "backend--T2--a1", task_cell_instance_id: "T2.a1.i1",
          task_cell_assignment_path: ".guild/runs/run/task-cells/T2/assignment.json",
        },
      ];

      const settled = settleFailedCmuxTaskCells({
        cwd: tmpDir,
        runId,
        lanes,
        unconfirmedPaneIds: { "backend--T2--a1": "surface:2" },
        reason: "cmux send failed",
        now: SEED_NOW,
      });

      expect(settled).toEqual({ failed: 1, orphaned: 1, errors: [] });
      expect(readAttemptForInstance(tmpDir, {
        run_id: runId, logical_task_id: "T1", attempt: 1, instance_id: "T1.a1.i1",
      })?.terminal_state).toBe("failed");
      expect(readAttemptForInstance(tmpDir, {
        run_id: runId, logical_task_id: "T2", attempt: 1, instance_id: "T2.a1.i1",
      })).toMatchObject({ terminal_state: null, orphaned: true });
    });
    function writeSessionJsonRealPane(cwd: string, runId: string, specialist: string, paneId: string): void {
      const dir = path.join(cwd, ".guild", "runs", runId, "agent-team");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({
        run_id: runId,
        teammate_panes: [{ specialist, pane_id: paneId, host_kind: "claude", adapter_version: "1" }],
      }, null, 2), "utf8");
    }

    it("G4 M2: does NOT kill a shared per-specialist pane while a sibling task-cell is unaccepted (DEFER)", () => {
      const runId = "run-m2-defer-001";
      writeSessionJsonRealPane(tmpDir, runId, "backend", "%77"); // real-looking pane id
      seedAcceptance(tmpDir, runId, "lt-a", "backend"); // task A accepted
      seedCellOnly(tmpDir, runId, "lt-b", "backend");   // task B still running, NOT accepted

      const { exitCode, stdout } = runScript(["--dismiss-completed", "--run-id", runId, "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      // The guard defers the kill — the shared pane must NOT be terminated while B runs.
      expect(stdout).toMatch(/\[DEFER\]/);
      expect(stdout).not.toMatch(/\[TERMINATED\]/);
      // Task A's accepted attempt is NOT sealed terminal yet (waits for the whole pane).
      const attemptA = readAttemptForInstance(tmpDir, { run_id: runId, logical_task_id: "lt-a", attempt: 1, instance_id: "lt-a.a1.i1" });
      expect(attemptA?.terminal_state).toBeNull();
    });

    it("G4 M1: --reap retries a parked orphan to a sealed `terminated` record (production end-to-end)", () => {
      const runId = "run-m1-reap-001";
      writeSessionJson(tmpDir, runId, ["backend"]); // placeholder pane → 'already gone'
      seedAcceptance(tmpDir, runId, "lt-x", "backend");
      const ids: TaskCellInstanceIds = { run_id: runId, logical_task_id: "lt-x", attempt: 1, instance_id: "lt-x.a1.i1" };
      // Simulate a prior dismiss whose kill did not confirm: park the attempt orphaned.
      markAttemptOrphaned(tmpDir, ids);
      expect(readAttemptForInstance(tmpDir, ids)?.orphaned).toBe(true);
      expect(readAttemptForInstance(tmpDir, ids)?.terminal_state).toBeNull();

      const { exitCode, stdout } = runScript(["--reap", "--run-id", runId, "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\[REAPED\]/);
      // The PRODUCTION reaper sweep sealed the orphan terminal — not a manual simulation.
      const sealed = readAttemptForInstance(tmpDir, ids);
      expect(sealed?.terminal_state).toBe("terminated");
      expect(sealed?.orphaned).toBe(true); // history preserved
    });

    it("G4: findRunTaskCells enumerates every task-cell tagged by owning worker_role", () => {
      const runId = "run-enum-001";
      seedAcceptance(tmpDir, runId, "lt-1", "backend");
      seedCellOnly(tmpDir, runId, "lt-2", "backend");
      seedCellOnly(tmpDir, runId, "lt-3", "frontend");
      const cells = findRunTaskCells(tmpDir, runId);
      expect(cells).toHaveLength(3);
      const backend = cells.filter((c) => c.worker_role === "backend");
      const frontend = cells.filter((c) => c.worker_role === "frontend");
      expect(backend).toHaveLength(2);
      expect(frontend).toHaveLength(1);
    });

    it("G4: findOrphanedAttempts returns only parked non-terminal orphans", () => {
      const runId = "run-orphan-enum-001";
      seedAcceptance(tmpDir, runId, "lt-live", "backend"); // not orphaned
      seedAcceptance(tmpDir, runId, "lt-orph", "backend");
      const orphIds: TaskCellInstanceIds = { run_id: runId, logical_task_id: "lt-orph", attempt: 1, instance_id: "lt-orph.a1.i1" };
      markAttemptOrphaned(tmpDir, orphIds);
      const orphans = findOrphanedAttempts(tmpDir, runId);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].logical_task_id).toBe("lt-orph");
    });

    it("G4 round-2: --dismiss-completed is idempotent — a second pass re-seals nothing", () => {
      const runId = "run-idempotent-001";
      writeSessionJson(tmpDir, runId, ["backend"]); // placeholder pane → seal directly
      seedAcceptance(tmpDir, runId, "lt-idem", "backend");

      const first = runScript(["--dismiss-completed", "--run-id", runId, "--cwd", tmpDir]);
      expect(first.exitCode).toBe(0);
      expect(first.stdout).toMatch(/\[TERMINATED\]/);
      const afterFirst = readAttemptForInstance(tmpDir, { run_id: runId, logical_task_id: "lt-idem", attempt: 1, instance_id: "lt-idem.a1.i1" });
      expect(afterFirst?.terminal_state).toBe("terminated");

      // Second pass: the attempt is already terminal → no re-seal, no [TERMINATED].
      const second = runScript(["--dismiss-completed", "--run-id", runId, "--cwd", tmpDir]);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).not.toMatch(/\[TERMINATED\]/);
      expect(second.stdout).toMatch(/no acceptance-authorized lanes to terminate/);
    });

    it("exits 0 with no crash when session.json does not exist", () => {
      const { exitCode, stdout, stderr } = runScript([
        "--dismiss-completed",
        "--run-id", "run-nonexistent-999",
        "--cwd", tmpDir,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/no session\.json/);
    });

    it("exits 0 when --run-id is not provided", () => {
      const { exitCode } = runScript(["--dismiss-completed", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("does not print [DISMISS] when receipt is missing for the lane", () => {
      const runId = "run-dismiss-test-002";
      writeSessionJson(tmpDir, runId, ["backend"]);
      // No handoff receipt written

      const { exitCode, stdout } = runScript([
        "--dismiss-completed",
        "--run-id", runId,
        "--cwd", tmpDir,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).not.toMatch(/\[DISMISS\]/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // TE-03: onDecision keys run-state by plan task-id, not specialist name
  // Uses GENERATED-team-shape fixture (default_tier + name-only, plan-joined task-ids)
  // ─────────────────────────────────────────────────────────────
  describe("TE-03: run-state AND task_run files keyed by plan task-id (not specialist name)", () => {
    // Write a guild:plan-shaped plan file with the block-scoped ## Lane: format that
    // readPlanOwnerTaskIds parses. `backend` owns TWO task-ids to prove no collision.
    function writePlanFile(cwd: string, slug: string): void {
      const planDir = path.join(cwd, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      const planContent = [
        `# Plan: ${slug}`,
        "",
        "## Lane: T1-architect",
        "- task-id: T1-architect",
        "- owner: architect",
        "- objective: Design system boundaries.",
        "",
        "## Lane: T2-backend",
        "- task-id: T2-backend",
        "- owner: backend",
        "- objective: Implement REST contract.",
        "",
        "## Lane: T5-backend",
        "- task-id: T5-backend",
        "- owner: backend",
        "- objective: Implement data layer.",
        "",
        "## Lane: T3-qa",
        "- task-id: T3-qa",
        "- owner: qa",
        "- objective: Property-based tests.",
      ].join("\n");
      fs.writeFileSync(path.join(planDir, `${slug}.md`), planContent, "utf8");
    }

    function writeCrossHostSettingsTE03(
      cwd: string,
      opts: { enabled: boolean; hosts: Record<string, { address: string; user?: string }> }
    ): void {
      const dir = path.join(cwd, ".guild");
      fs.mkdirSync(dir, { recursive: true });
      const settings = {
        defaults: { cross_host: { enabled: opts.enabled, hosts: opts.hosts } },
      };
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");
    }

    function findRunStateJson(cwd: string): string | null {
      const runsDir = path.join(cwd, ".guild", "runs");
      if (!fs.existsSync(runsDir)) return null;
      for (const runId of fs.readdirSync(runsDir)) {
        const candidate = path.join(runsDir, runId, "run-state.json");
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    }

    it("GENERATED-shape: multi-task-id specialist produces 2 task-id-keyed run-state entries, no name-key", () => {
      // Use team-generated-shape.yaml (default_tier, no tier:) + plan that gives
      // backend two task-ids (T2-backend, T5-backend). After routing, run-state must
      // have T2-backend AND T5-backend as keys — NOT "backend" as a name-key.
      const slug = "gen-slug";
      const { teamPath } = setupConsumerRepo(tmpDir, slug, "team-generated-shape.yaml");
      writePlanFile(tmpDir, slug);
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsTE03(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));
      const lanes = Object.keys(state.lanes ?? {});

      // backend owns T2-backend + T5-backend → 2 task-id-keyed entries
      expect(lanes).toContain("T2-backend");
      expect(lanes).toContain("T5-backend");
      // Must NOT be keyed by the specialist name
      expect(lanes).not.toContain("backend");

      // Both entries have equal host blocks (same pane → same host decision)
      const t2 = state.lanes["T2-backend"];
      const t5 = state.lanes["T5-backend"];
      expect(t2.host?.selected).toBe(t5.host?.selected);
      expect(t2.host?.degraded).toBe(t5.host?.degraded);
      expect(t2.host?.independence).toBe(t5.host?.independence);
    });

    it("GENERATED-shape: plan absent → no run-state entries written (no name-key fallback)", () => {
      const slug = "no-plan-slug";
      const { teamPath } = setupConsumerRepo(tmpDir, slug, "team-generated-shape.yaml");
      // Do NOT write a plan file — readPlanOwnerTaskIds returns empty map → skip
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsTE03(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      // Either no run-state.json at all, or lanes is empty (no name-key persisted)
      if (rsPath !== null) {
        const state = JSON.parse(fs.readFileSync(rsPath, "utf8"));
        const lanes = Object.keys(state.lanes ?? {});
        // No specialist names as lane keys
        expect(lanes).not.toContain("architect");
        expect(lanes).not.toContain("backend");
        expect(lanes).not.toContain("qa");
      }
    });

    it("GENERATED-shape: single-task-id specialist produces exactly 1 task-id-keyed entry", () => {
      const slug = "gen-slug";
      const { teamPath } = setupConsumerRepo(tmpDir, slug, "team-generated-shape.yaml");
      writePlanFile(tmpDir, slug);
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsTE03(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com" } },
      });

      runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // architect owns exactly T1-architect (one task)
      expect(state.lanes?.["T1-architect"]).toBeDefined();
      expect(state.lanes?.["T1-architect"]?.host).toBeDefined();
      expect(state.lanes?.["architect"]).toBeUndefined(); // name-key must not appear
    });

    // ── task_run file keying (writeTaskRun sites) ─────────────────────────────

    function findTaskRunFiles(cwd: string): string[] {
      const runsDir = path.join(cwd, ".guild", "runs");
      if (!fs.existsSync(runsDir)) return [];
      const files: string[] = [];
      for (const runId of fs.readdirSync(runsDir)) {
        const taskRunsDir = path.join(runsDir, runId, "task-runs");
        if (!fs.existsSync(taskRunsDir)) continue;
        for (const f of fs.readdirSync(taskRunsDir)) {
          files.push(path.join(taskRunsDir, f));
        }
      }
      return files;
    }

    it("GENERATED-shape: multi-task-id specialist (tmux path) produces T2-backend.yaml + T5-backend.yaml, not backend.yaml", () => {
      // team-generated-shape.yaml + plan giving backend 2 task-ids → local tmux path writes
      // one task_run file per plan task-id. Assert T2-backend.yaml + T5-backend.yaml exist
      // and ids.task_id inside each matches the filename (not the specialist name).
      const slug = "gen-slug";
      const { teamPath } = setupConsumerRepo(tmpDir, slug, "team-generated-shape.yaml");
      writePlanFile(tmpDir, slug);

      const { exitCode } = runScript([
        "--team", teamPath, "--cwd", tmpDir, "--dry-run",
      ]);
      expect(exitCode).toBe(0);

      const files = findTaskRunFiles(tmpDir);
      const fileNames = files.map((f) => path.basename(f));

      // backend owns T2-backend + T5-backend → 2 files, NOT a single "backend.yaml"
      expect(fileNames).toContain("T2-backend.yaml");
      expect(fileNames).toContain("T5-backend.yaml");
      expect(fileNames).not.toContain("backend.yaml");

      // ids.task_id in each file must match the filename
      for (const fname of ["T2-backend.yaml", "T5-backend.yaml"]) {
        const fpath = files.find((f) => f.endsWith(fname))!;
        const raw = fs.readFileSync(fpath, "utf8");
        const expectedId = fname.replace(".yaml", "");
        expect(raw).toContain(`task_id: ${expectedId}`);
        // specialist field must still carry the specialist name (backend), not the task-id
        expect(raw).toContain("specialist: backend");
      }
    });

    it("GENERATED-shape: multi-task-id specialist (remote path) produces T2-backend.yaml + T5-backend.yaml, not backend.yaml", () => {
      // team.yaml with backend having host: codex → routes via RemoteTeamBackend.
      // plan gives backend T2-backend + T5-backend → remote writeTaskRun loop must
      // fan-out to N files keyed by plan task-id, NOT one file keyed by specialist name.
      // Mirrors the tmux multi-task-id test above but exercises site (b) (L1019).
      const slug = "gen-slug";
      const teamDir = path.join(tmpDir, ".guild", "team");
      fs.mkdirSync(teamDir, { recursive: true });
      const teamPath = path.join(teamDir, `${slug}.yaml`);
      fs.writeFileSync(
        teamPath,
        [
          "spec: .guild/spec/gen-slug.md",
          "backend: agent-team",
          "allow_larger: false",
          "user_approved_agent_team: true",
          "specialists:",
          "  - name: architect",
          '    scope: "System boundaries and component split."',
          "    depends-on: []",
          "    default_tier: powerful",
          "  - name: backend",
          '    scope: "REST contract and data layer."',
          "    depends-on: [architect]",
          "    default_tier: mid",
          "    host: codex",
        ].join("\n"),
        "utf8"
      );

      writePlanFile(tmpDir, slug);
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsTE03(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const files = findTaskRunFiles(tmpDir);
      const fileNames = files.map((f) => path.basename(f));

      // backend (remote) owns T2-backend + T5-backend → 2 files, NOT a single "backend.yaml"
      expect(fileNames).toContain("T2-backend.yaml");
      expect(fileNames).toContain("T5-backend.yaml");
      expect(fileNames).not.toContain("backend.yaml");

      // ids.task_id in each file must match the filename stem
      for (const fname of ["T2-backend.yaml", "T5-backend.yaml"]) {
        const fpath = files.find((f) => f.endsWith(fname))!;
        const raw = fs.readFileSync(fpath, "utf8");
        const expectedId = fname.replace(".yaml", "");
        expect(raw).toContain(`task_id: ${expectedId}`);
        // specialist field must carry the specialist name (backend), not the task-id
        expect(raw).toContain("specialist: backend");
      }
    });

    it("GENERATED-shape: plan absent → 1 name-keyed task_run file per specialist (TE-01 name-fallback)", () => {
      // No plan file → readPlanOwnerTaskIds returns empty map → name-fallback kicks in:
      // effectiveTaskIds = [spec.name] → one file keyed by specialist name.
      // Every dispatch writes exactly one task_run (plan-absent case uses spec.name as key).
      // NOTE: run-state onDecision STILL skips on empty plan (no name-key in run-state).
      const slug = "no-plan-slug2";
      const teamDir = path.join(tmpDir, ".guild", "team");
      fs.mkdirSync(teamDir, { recursive: true });
      const teamPath = path.join(teamDir, `${slug}.yaml`);
      fs.writeFileSync(teamPath, [
        "backend: agent-team",
        "specialists:",
        "  - name: architect",
        "    scope: test",
        "    depends-on: []",
        "    default_tier: mid",
      ].join("\n"), "utf8");

      const { exitCode } = runScript([
        "--team", teamPath, "--cwd", tmpDir, "--dry-run",
      ]);
      expect(exitCode).toBe(0);

      // Name-fallback: one file keyed by specialist name
      const files = findTaskRunFiles(tmpDir);
      const fileNames = files.map((f) => path.basename(f));
      expect(fileNames).toContain("architect.yaml");
      // task_id inside the file is the specialist name (not a plan task-id)
      const archFile = files.find((f) => f.endsWith("architect.yaml"))!;
      const raw = fs.readFileSync(archFile, "utf8");
      expect(raw).toContain("task_id: architect");
      expect(raw).toContain("specialist: architect");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ARCH-6 Part 1: default_tier parser — generated-team routes at roster tier
  // Uses GENERATED-team-shape fixture (default_tier, not tier:)
  // ─────────────────────────────────────────────────────────────
  describe("ARCH-6 Part 1: default_tier — generated teams route at roster tier, not mid", () => {
    function writeCrossHostSettingsArch6(
      cwd: string,
      opts: { enabled: boolean; hosts: Record<string, { address: string; user?: string }> }
    ): void {
      const dir = path.join(cwd, ".guild");
      fs.mkdirSync(dir, { recursive: true });
      const settings = {
        defaults: { cross_host: { enabled: opts.enabled, hosts: opts.hosts } },
      };
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");
    }

    function findRunStateJson(cwd: string): string | null {
      const runsDir = path.join(cwd, ".guild", "runs");
      if (!fs.existsSync(runsDir)) return null;
      for (const runId of fs.readdirSync(runsDir)) {
        const candidate = path.join(runsDir, runId, "run-state.json");
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    }

    it("GENERATED-shape: default_tier: powerful routes architect at powerful/opus, not mid/sonnet", () => {
      // team-generated-shape.yaml has architect with default_tier: powerful (no tier:).
      // The fixture is GENERATED-shape — team-compose emits default_tier, not tier:.
      const slug = "gen-slug";
      const { teamPath } = setupConsumerRepo(tmpDir, slug, "team-generated-shape.yaml");
      // Write plan so onDecision can persist
      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(path.join(planDir, `${slug}.md`), [
        `# Plan: ${slug}`,
        "## Lane: T1-architect",
        "- task-id: T1-architect",
        "- owner: architect",
      ].join("\n"), "utf8");

      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsArch6(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // architect: default_tier: powerful → LaneState.host.tier must be "powerful"
      const arch = state.lanes?.["T1-architect"];
      expect(arch).toBeDefined();
      expect(arch?.host?.tier).toBe("powerful");
      // Must NOT have collapsed to mid
      expect(arch?.host?.tier).not.toBe("mid");
    });

    it("GENERATED-shape: scored tier: overrides default_tier when both present", () => {
      // Write a team.yaml inline with BOTH default_tier: cheap AND tier: powerful.
      // flush() precedence: tier ?? default_tier → must resolve to powerful.
      const slug = "scored-slug";
      const teamDir = path.join(tmpDir, ".guild", "team");
      fs.mkdirSync(teamDir, { recursive: true });
      const teamContent = [
        "backend: agent-team",
        "specialists:",
        "  - name: architect",
        "    scope: scored override test",
        "    depends-on: []",
        "    default_tier: cheap",
        "    tier: powerful",
      ].join("\n");
      const teamPath = path.join(teamDir, `${slug}.yaml`);
      fs.writeFileSync(teamPath, teamContent, "utf8");

      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(path.join(planDir, `${slug}.md`), [
        `# Plan: ${slug}`,
        "## Lane: T1-architect",
        "- task-id: T1-architect",
        "- owner: architect",
      ].join("\n"), "utf8");

      writeHostManifest(tmpDir, "claude", "claude");
      writeCrossHostSettingsArch6(tmpDir, { enabled: true, hosts: {} });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // scored `tier: powerful` must win over `default_tier: cheap`
      const arch = state.lanes?.["T1-architect"];
      expect(arch?.host?.tier).toBe("powerful");
    });

    it("GENERATED-shape: mixed default_tier team — each lane routes at its own tier, none collapse to mid", () => {
      // team-generated-shape.yaml: architect=powerful, backend=mid, qa=cheap.
      // None should collapse to mid (the old bug).
      const slug = "gen-slug";
      const { teamPath } = setupConsumerRepo(tmpDir, slug, "team-generated-shape.yaml");
      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(path.join(planDir, `${slug}.md`), [
        `# Plan: ${slug}`,
        "## Lane: T1-architect",
        "- task-id: T1-architect",
        "- owner: architect",
        "## Lane: T2-backend",
        "- task-id: T2-backend",
        "- owner: backend",
        "## Lane: T3-qa",
        "- task-id: T3-qa",
        "- owner: qa",
      ].join("\n"), "utf8");

      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsArch6(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // architect → powerful (not mid)
      expect(state.lanes?.["T1-architect"]?.host?.tier).toBe("powerful");
      // backend → mid (correct, not collapsed)
      expect(state.lanes?.["T2-backend"]?.host?.tier).toBe("mid");
      // qa → cheap (not collapsed to mid)
      expect(state.lanes?.["T3-qa"]?.host?.tier).toBe("cheap");
    });

    it("ARCH-2 launcher-seam: needs_parallel: true in team.yaml → parser → planTeamRouting → degraded=true when no host supports parallel", () => {
      // Disconnected-seam proof: host-router.test.ts:549 constructs the specialist directly —
      // this test drives needs_parallel through the LAUNCHER'S YAML PARSER → planTeamRouting
      // → capabilityGap() → degraded decision persisted in run-state. Proves the live seam.
      //
      // planTeamRouting only runs when crossHostEnabled=true (L883 guard). Setup:
      // - Custom claude manifest: agent_team:false + independent_agents:false (no parallel)
      // - Standard codex manifest: also agent_team:false + independent_agents:false
      // - Both hosts fail needs_parallel → qualifying=[] → degraded:true (degrade-not-throw)
      const slug = "arch2-seam-slug";
      const teamDir = path.join(tmpDir, ".guild", "team");
      fs.mkdirSync(teamDir, { recursive: true });
      const teamPath = path.join(teamDir, `${slug}.yaml`);
      fs.writeFileSync(
        teamPath,
        [
          "backend: agent-team",
          "specialists:",
          "  - name: writer",
          '    scope: "Write content."',
          "    depends-on: []",
          "    default_tier: mid",
          "    needs_parallel: true",
        ].join("\n"),
        "utf8"
      );

      // Plan so onDecision can write run-state keyed by plan task-id
      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(
        path.join(planDir, `${slug}.md`),
        [
          `# Plan: ${slug}`,
          "",
          "## Lane: T1-writer",
          "- task-id: T1-writer",
          "- owner: writer",
          "- objective: Write content.",
        ].join("\n"),
        "utf8"
      );

      // Custom claude manifest: agent_team:false + independent_agents:false
      // (standard writeHostManifest sets these true for claude — override here)
      const claudeHostDir = path.join(tmpDir, ".guild", "hosts", "claude");
      fs.mkdirSync(claudeHostDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeHostDir, "capability.json"),
        JSON.stringify({
          schema_version: "guild.host_capability.v1",
          host_id: "claude",
          host_kind: "claude",
          // TE-07: canonical field names
          advertised_at: new Date().toISOString(),
          source: "test",
          tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
          supported_tiers: ["cheap", "mid", "powerful"],
          models: ["haiku", "sonnet", "opus"],
          tool_support: {
            subagent: true,
            agent_team: false,           // ← no parallel
            independent_agents: false,   // ← no parallel
            tmux: true,
            mcp: true,
            pre_tool_use_ask: true,
          },
        }, null, 2),
        "utf8"
      );
      // Standard codex manifest also has agent_team:false + independent_agents:false
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettingsArch6(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // needs_parallel:true parsed from YAML → capabilityGap detects gap on ALL hosts
      // → qualifying=[] → degraded:true (degrade-not-throw; least-bad selected)
      const writerLane = state.lanes?.["T1-writer"];
      expect(writerLane).toBeDefined();
      expect(writerLane?.host?.degraded).toBe(true);
    });

    it("W2-A2 single-source: task_run written BEFORE routing; routing decision agrees with written capability_requirements", () => {
      // Prove the single-source contract: the launcher writes the task_run BEFORE
      // calling planTeamRouting, and the routing decision (degraded=true) must be
      // consistent with the needs_parallel:true captured in the written file.
      // If the two sources ever drifted, either the file would be wrong or the
      // decision would contradict it — this test catches both.
      //
      // Setup: same as ARCH-2 (needs_parallel:true, no qualifying host) so routing
      // degrades. We then check: (a) task_run file exists with needs_parallel:true,
      // (b) run-state lane has degraded:true — both sourced from the same write.
      const slug = "w2a2-single-source-slug";
      const teamDir = path.join(tmpDir, ".guild", "team");
      fs.mkdirSync(teamDir, { recursive: true });
      const teamPath = path.join(teamDir, `${slug}.yaml`);
      fs.writeFileSync(
        teamPath,
        [
          "backend: agent-team",
          "specialists:",
          "  - name: analyst",
          '    scope: "Analyse data."',
          "    depends-on: []",
          "    default_tier: mid",
          "    needs_parallel: true",
        ].join("\n"),
        "utf8"
      );

      // Plan so onDecision can write run-state keyed by plan task-id
      const planDir = path.join(tmpDir, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(
        path.join(planDir, `${slug}.md`),
        [
          `# Plan: ${slug}`,
          "",
          "## Lane: T1-analyst",
          "- task-id: T1-analyst",
          "- owner: analyst",
          "- objective: Analyse data.",
        ].join("\n"),
        "utf8"
      );

      // Both hosts incapable of parallel (no qualifying host → degraded routing)
      const claudeDir = path.join(tmpDir, ".guild", "hosts", "claude-w2a2");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "capability.json"),
        JSON.stringify({
          schema_version: "guild.host_capability.v1",
          host_id: "claude-w2a2",
          host_kind: "claude",
          advertised_at: new Date().toISOString(),
          source: "test",
          tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
          supported_tiers: ["cheap", "mid", "powerful"],
          models: ["haiku", "sonnet", "opus"],
          tool_support: {
            subagent: true,
            agent_team: false,         // ← no parallel
            independent_agents: false, // ← no parallel
            tmux: true,
            mcp: true,
            pre_tool_use_ask: true,
          },
        }, null, 2),
        "utf8"
      );
      writeHostManifest(tmpDir, "codex-w2a2", "codex"); // also agent_team:false
      writeCrossHostSettingsArch6(tmpDir, {
        enabled: true,
        hosts: { "codex-w2a2": { address: "remote.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude-w2a2" }
      );
      expect(exitCode).toBe(0);

      // (a) task_run file must exist and contain needs_parallel: true (written BEFORE routing)
      const runsDir = path.join(tmpDir, ".guild", "runs");
      expect(fs.existsSync(runsDir)).toBe(true);
      let taskRunFile: string | null = null;
      for (const runId of fs.readdirSync(runsDir)) {
        const candidate = path.join(runsDir, runId, "task-runs", "T1-analyst.yaml");
        if (fs.existsSync(candidate)) { taskRunFile = candidate; break; }
      }
      expect(taskRunFile).not.toBeNull();
      const taskRunContent = fs.readFileSync(taskRunFile!, "utf8");
      // The written file must capture needs_parallel: true (from the YAML parser source)
      expect(taskRunContent).toContain("needs_parallel: true");

      // (b) run-state lane must be degraded — routing used the same CR as the written file
      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));
      const analystLane = state.lanes?.["T1-analyst"];
      expect(analystLane).toBeDefined();
      expect(analystLane?.host?.degraded).toBe(true); // single source drives both write + route
    });
  });

  // ─────────────────────────────────────────────────────────────
  // EDIT-2 (TE-03): onDecision persists routing decision into run-state
  // ─────────────────────────────────────────────────────────────
  describe("EDIT-2 (TE-03): onDecision persists routing decision to run-state LaneState.host", () => {
    function writeCrossHostSettings(
      cwd: string,
      opts: { enabled: boolean; hosts: Record<string, { address: string; user?: string }> }
    ): void {
      const dir = path.join(cwd, ".guild");
      fs.mkdirSync(dir, { recursive: true });
      const settings = {
        defaults: { cross_host: { enabled: opts.enabled, hosts: opts.hosts } },
      };
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");
    }

    // TE-03: onDecision now uses readPlanOwnerTaskIds — must write a plan file
    // so the name→task-id join succeeds and upsertLane fires. Lane keys are task-ids.
    function writePlanForMixedHost(cwd: string, slug: string): void {
      const planDir = path.join(cwd, ".guild", "plan");
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(path.join(planDir, `${slug}.md`), [
        `# Plan: ${slug}`,
        "",
        "## Lane: T1-architect",
        "- task-id: T1-architect",
        "- owner: architect",
        "",
        "## Lane: T2-security",
        "- task-id: T2-security",
        "- owner: security",
      ].join("\n"), "utf8");
    }

    function findRunStateJson(cwd: string): string | null {
      const runsDir = path.join(cwd, ".guild", "runs");
      if (!fs.existsSync(runsDir)) return null;
      for (const runId of fs.readdirSync(runsDir)) {
        const candidate = path.join(runsDir, runId, "run-state.json");
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    }

    it("persists LaneState.host with exact selected/degraded/independence/tier/model for a local claude lane", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writePlanForMixedHost(tmpDir, "test-slug");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettings(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // architect routes to the local claude host — keyed by plan task-id T1-architect
      const arch = state.lanes?.["T1-architect"];
      expect(arch).toBeDefined();
      expect(arch?.host).toBeDefined();
      // Exact values — not just presence
      expect(arch?.host?.selected).toBe("claude");
      expect(arch?.host?.degraded).toBe(false);
      // T7-H2: the persisted independence is now ALWAYS "weak" from the router
      // — run-state.json is a SHARED, git-tracked artifact, and a "strong"
      // review verdict may reach it only behind a written §7a adjudication
      // (upsertLane's assertPersistableIndependence refuses otherwise).
      expect(arch?.host?.independence).toBe("weak");
      expect(["cheap", "mid", "powerful"]).toContain(arch?.host?.tier);
      expect(typeof arch?.host?.model).toBe("string");
      expect((arch?.host?.model as string).length).toBeGreaterThan(0);
    });

    it("persists LaneState.host with correct selected host for a remote codex lane", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writePlanForMixedHost(tmpDir, "test-slug");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettings(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
      });

      const { exitCode } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );
      expect(exitCode).toBe(0);

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));

      // security has host: codex → routes to codex-remote — keyed by plan task-id T2-security
      const sec = state.lanes?.["T2-security"];
      expect(sec).toBeDefined();
      expect(sec?.host?.selected).toBe("codex-remote");
      expect(sec?.host?.degraded).toBe(false);
      // T7-H2: cross-HOST routing is not cross-family review INDEPENDENCE. A
      // remote codex lane still persists "weak" — only a written §7a
      // adjudication over both parties' finalized receipts can say otherwise.
      expect(sec?.host?.independence).toBe("weak");
      expect(["cheap", "mid", "powerful"]).toContain(sec?.host?.tier);
    });

    it("both lanes written in a single planTeamRouting call (run-state has two task-id-keyed lanes)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writePlanForMixedHost(tmpDir, "test-slug");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeCrossHostSettings(tmpDir, {
        enabled: true,
        hosts: { "codex-remote": { address: "gpu-box.example.com" } },
      });

      runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );

      const rsPath = findRunStateJson(tmpDir);
      expect(rsPath).not.toBeNull();
      const state = JSON.parse(fs.readFileSync(rsPath!, "utf8"));
      const lanes = Object.keys(state.lanes ?? {});
      // Both specialists should have host blocks, keyed by plan task-ids
      expect(lanes.length).toBeGreaterThanOrEqual(2);
      expect(lanes).toContain("T1-architect");
      expect(lanes).toContain("T2-security");
      for (const laneId of lanes) {
        expect(state.lanes[laneId].host).toBeDefined();
        expect(typeof state.lanes[laneId].host.selected).toBe("string");
        expect(typeof state.lanes[laneId].host.degraded).toBe("boolean");
        expect(["strong", "weak"]).toContain(state.lanes[laneId].host.independence);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // D-CAP Wave-3: capability_scope block-list parsing
  //
  // Verifies that `capability_scope:` YAML block lists in team.yaml are parsed
  // correctly onto each Specialist and threaded into session.json's teammate_panes.
  // The gate (pre-tool-use.ts:479) reads GUILD_CAPABILITY_SCOPE; the injection
  // half (paneCommand / composeInProcessDispatch) is HOLD pending the env-
  // propagation spike. These tests cover the mechanism-INDEPENDENT threading step:
  //   1. Parse block list → Specialist.capability_scope (string[]).
  //   2. Thread onto session.json teammate_panes[*].capability_scope.
  //   3. Absent field → undefined in manifest (no restrictions, backward-compat).
  // ─────────────────────────────────────────────────────────────
  describe("D-CAP: capability_scope block-list parsing (Wave-3)", () => {
    it("parses capability_scope block lists from team.yaml into session.json teammate_panes", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-001",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir);
      expect(sessionJson).not.toBeNull();
      const manifest = JSON.parse(fs.readFileSync(sessionJson!, "utf8"));

      const arch = manifest.teammate_panes.find(
        (p: { specialist: string }) => p.specialist === "architect"
      );
      expect(arch).toBeDefined();
      expect(arch.capability_scope).toEqual(["Read", "Glob", "Grep"]);

      const back = manifest.teammate_panes.find(
        (p: { specialist: string }) => p.specialist === "backend"
      );
      expect(back).toBeDefined();
      expect(back.capability_scope).toEqual(["Read", "Write", "Edit", "Bash"]);
    });

    it("omits capability_scope from teammate_panes when not specified in team.yaml", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-002",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir);
      expect(sessionJson).not.toBeNull();
      const manifest = JSON.parse(fs.readFileSync(sessionJson!, "utf8"));

      // qa specialist in the fixture has NO capability_scope → field must be absent
      const qa = manifest.teammate_panes.find(
        (p: { specialist: string }) => p.specialist === "qa"
      );
      expect(qa).toBeDefined();
      expect(qa.capability_scope).toBeUndefined();
    });

    it("preserves other specialist fields (tier, depends-on) alongside capability_scope", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-003",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir);
      expect(sessionJson).not.toBeNull();
      const manifest = JSON.parse(fs.readFileSync(sessionJson!, "utf8"));

      // All 3 specialists must appear in the manifest
      const names = manifest.teammate_panes.map((p: { specialist: string }) => p.specialist);
      expect(names).toContain("architect");
      expect(names).toContain("backend");
      expect(names).toContain("qa");
      // Standard manifest fields still populated
      expect(manifest.session_name).toBe("guild-dcap-003");
      expect(manifest.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
    });

    it("no regression: team.yaml without any capability_scope still parses all specialists", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "test-slug", "team-generated-shape.yaml"
      );
      runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-004",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      const sessionJson = findSessionJson(tmpDir);
      expect(sessionJson).not.toBeNull();
      const manifest = JSON.parse(fs.readFileSync(sessionJson!, "utf8"));

      expect(manifest.teammate_panes.length).toBe(3);
      // No capability_scope field on any pane when not present in team.yaml
      for (const pane of manifest.teammate_panes as Array<{ capability_scope?: unknown }>) {
        expect(pane.capability_scope).toBeUndefined();
      }
    });

    // D-CAP injection: GUILD_CAPABILITY_SCOPE must appear in the dry-run tmux
    // command output (stdout) for specialists that have capability_scope in team.yaml.
    it("D-CAP inject: dry-run stdout contains GUILD_CAPABILITY_SCOPE for scoped specialists", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      const { stdout } = runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-inject-001",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      // architect has capability_scope: ["Read","Glob","Grep"] in the fixture
      expect(stdout).toContain("GUILD_CAPABILITY_SCOPE");
      expect(stdout).toContain(JSON.stringify(["Read", "Glob", "Grep"]));
    });

    it("D-CAP inject: dry-run stdout omits GUILD_CAPABILITY_SCOPE for unscoped team", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "test-slug", "team-generated-shape.yaml"
      );
      const { stdout } = runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-inject-002",
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      // team-generated-shape.yaml has no capability_scope on any specialist
      expect(stdout).not.toContain("GUILD_CAPABILITY_SCOPE");
    });

    // D-CAP scope-file writer: the launcher must write <runDir>/scope/<taskId>.json
    // BEFORE any pane opens (even in dry-run).  This closes the "reader-without-writer"
    // gap: pre-tool-use.ts:488 reads the file as the env-absent belt-and-suspenders
    // fallback; absent ⇒ no file (additive no-scoping).

    it("D-CAP scope-file: writes scope/<taskId>.json for each scoped specialist", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      runScript(["--team", teamPath, "--cwd", tmpDir, "--dry-run"]);

      const runsDir = path.join(tmpDir, ".guild", "runs");
      const runIds = fs
        .readdirSync(runsDir)
        .filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory());
      expect(runIds.length).toBe(1);
      const runDir = path.join(runsDir, runIds[0]);

      // architect: capability_scope: ["Read","Glob","Grep"]
      const archPath = path.join(runDir, "scope", "architect.json");
      expect(fs.existsSync(archPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(archPath, "utf8")).capability_scope).toEqual(
        ["Read", "Glob", "Grep"],
      );

      // backend: capability_scope: ["Read","Write","Edit","Bash"]
      const backPath = path.join(runDir, "scope", "backend.json");
      expect(fs.existsSync(backPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(backPath, "utf8")).capability_scope).toEqual(
        ["Read", "Write", "Edit", "Bash"],
      );
    });

    it("D-CAP scope-file: does NOT write scope file for specialist without capability_scope", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      runScript(["--team", teamPath, "--cwd", tmpDir, "--dry-run"]);

      const runsDir = path.join(tmpDir, ".guild", "runs");
      const runIds = fs
        .readdirSync(runsDir)
        .filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory());
      const runDir = path.join(runsDir, runIds[0]);

      // qa specialist has NO capability_scope in the fixture → no scope file
      const qaPath = path.join(runDir, "scope", "qa.json");
      expect(fs.existsSync(qaPath)).toBe(false);
    });

    it("D-CAP GUILD_TASK_ID: dry-run tmux command contains GUILD_TASK_ID for each specialist", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "scoped-slug", "team-generated-shape-scoped.yaml"
      );
      const { stdout } = runScript([
        "--team", teamPath,
        "--cwd", tmpDir,
        "--dry-run",
      ]);
      // Each specialist pane command must include GUILD_TASK_ID
      // (task-id = spec.name fallback when no plan exists)
      expect(stdout).toContain("GUILD_TASK_ID");
    });

    it("D-CAP scope-file: writes no scope/ dir for an entirely unscoped team", () => {
      const { teamPath } = setupConsumerRepo(
        tmpDir, "test-slug", "team-agent-team.yaml"
      );
      runScript([
        "--team", teamPath,
        "--session-name", "guild-dcap-scope-003",
        "--cwd", tmpDir,
        "--dry-run",
      ]);

      const runsDir = path.join(tmpDir, ".guild", "runs");
      const runIds = fs
        .readdirSync(runsDir)
        .filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory());
      // There must be a run (session.json is written in dry-run)
      expect(runIds.length).toBe(1);
      const scopeDir = path.join(runsDir, runIds[0], "scope");
      expect(fs.existsSync(scopeDir)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // MH-04 BF-2 — production execution resolves through HostExecutionRuntime
  // ─────────────────────────────────────────────────────────────
  //
  // These assert the PRODUCTION path inside the spawned launcher process, not a
  // source grep: a CommonJS preload wraps `createHostExecutionRuntime` and the
  // shipped backend classes in the CHILD, records every `transportFor()` call and
  // every backend execution, and marks each backend execution with whether a
  // resolved transport port was on the stack when it fired.
  //
  // That flag is the DISCRIMINATING control. A launcher that constructs a backend
  // and calls `.launch()`/`.plan()`/`.spawn()` on it directly still produces the
  // same stdout, the same manifest and the same exit code — but its backend
  // executions carry `via_port: false`, and every test below fails.
  describe("MH-04 BF-2: production dispatch resolves through HostExecutionRuntime", () => {
    interface ProbeEvent {
      event: string;
      requested?: string;
      status?: string;
      method?: string;
      kind?: string;
      via_port?: boolean;
      transports?: string[];
    }

    /**
     * Write the child-process probe. `Module._load` is wrapped (tsx compiles the
     * launcher to CJS, so every import goes through it) and a Proxy is used
     * because esbuild's export getters are non-configurable.
     */
    function writeRuntimeProbe(dir: string): string {
      const hookPath = path.join(dir, "runtime-probe.cjs");
      fs.writeFileSync(
        hookPath,
        [
          'const Module = require("module");',
          'const fsx = require("fs");',
          "const out = process.env.GUILD_RUNTIME_PROBE_FILE;",
          'const emit = (rec) => fsx.appendFileSync(out, JSON.stringify(rec) + "\\n");',
          "// Depth of resolved-transport-port calls currently on the stack.",
          "let portDepth = 0;",
          "const EXEC = new Set([",
          '  "launch", "plan", "spawn", "isAvailable", "preflight",',
          '  "sessionExists", "windowExists", "currentSessionName",',
          "]);",
          "const wrapPort = (id, port) =>",
          "  new Proxy(port, {",
          "    get(t, p, r) {",
          "      const v = Reflect.get(t, p, r);",
          '      if (typeof v !== "function") return v;',
          "      return function (...args) {",
          '        emit({ event: "port_call", requested: id, method: String(p) });',
          "        portDepth += 1;",
          "        try { return v.apply(t, args); } finally { portDepth -= 1; }",
          "      };",
          "    },",
          "  });",
          "const wrapRuntime = (rt) =>",
          "  new Proxy(rt, {",
          "    get(t, p, r) {",
          "      const v = Reflect.get(t, p, r);",
          '      if (p !== "transportFor" || typeof v !== "function") return v;',
          "      return function (id) {",
          "        const outcome = v.call(t, id);",
          '        emit({ event: "transport_for", requested: String(id), status: outcome.status });',
          '        if (outcome.status !== "succeeded" || !outcome.value) return outcome;',
          "        return Object.assign({}, outcome, { value: wrapPort(String(id), outcome.value) });",
          "      };",
          "    },",
          "  });",
          "const wrapBackend = (Ctor, kind) =>",
          "  new Proxy(Ctor, {",
          "    construct(target, args, nt) {",
          '      emit({ event: "backend_constructed", kind });',
          "      const inst = Reflect.construct(target, args, nt);",
          "      return new Proxy(inst, {",
          "        get(t, p, r) {",
          "          const v = Reflect.get(t, p, r);",
          '          if (typeof v !== "function" || !EXEC.has(String(p))) return v;',
          "          return function (...args) {",
          '            emit({ event: "backend_exec", kind, method: String(p), via_port: portDepth > 0 });',
          "            return v.apply(t, args);",
          "          };",
          "        },",
          "      });",
          "    },",
          "  });",
          "const BACKENDS = {",
          '  InProcessTeamBackend: "in-process",',
          '  RemoteTeamBackend: "remote",',
          '  TmuxTeamBackend: "tmux",',
          "};",
          "const load = Module._load;",
          "Module._load = function (request) {",
          "  const exported = load.apply(this, arguments);",
          '  if (typeof request !== "string" || !exported) return exported;',
          '  if (request.endsWith("execution-transport-adapters")) {',
          "    return new Proxy(exported, {",
          "      get(t, p, r) {",
          "        const v = Reflect.get(t, p, r);",
          '        if (p !== "createHostExecutionRuntime" || typeof v !== "function") return v;',
          "        return function (...args) {",
          "          const rt = v.apply(this, args);",
          '          emit({ event: "runtime_created", transports: Array.from(rt.transport_ids) });',
          "          return wrapRuntime(rt);",
          "        };",
          "      },",
          "    });",
          "  }",
          '  if (request.endsWith("lib/team-backend")) {',
          "    return new Proxy(exported, {",
          "      get(t, p, r) {",
          "        const v = Reflect.get(t, p, r);",
          '        if (typeof v === "function" && BACKENDS[String(p)]) return wrapBackend(v, BACKENDS[String(p)]);',
          "        return v;",
          "      },",
          "    });",
          "  }",
          "  return exported;",
          "};",
          "",
        ].join("\n")
      );
      return hookPath;
    }

    function readProbe(file: string): ProbeEvent[] {
      if (!fs.existsSync(file)) return [];
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ProbeEvent);
    }

    function probeEnv(dir: string): { file: string; env: Record<string, string | undefined> } {
      const file = path.join(dir, `runtime-probe-${Math.random().toString(36).slice(2)}.jsonl`);
      const hook = writeRuntimeProbe(dir);
      return { file, env: { GUILD_RUNTIME_PROBE_FILE: file, NODE_OPTIONS: `--require "${hook}"` } };
    }

    /** The control every migrated path must satisfy. */
    function assertResolvedThroughRuntime(events: ProbeEvent[], transport: string): void {
      // 1 · The runtime was built from injected ports, not branched on inline.
      const created = events.filter((e) => e.event === "runtime_created");
      expect(created.length).toBeGreaterThanOrEqual(1);

      // 2 · The chosen transport was resolved through transportFor().
      const resolved = events.filter(
        (e) => e.event === "transport_for" && e.requested === transport
      );
      expect(resolved.length).toBeGreaterThanOrEqual(1);
      expect(resolved.some((e) => e.status === "succeeded")).toBe(true);

      // 3 · Execution actually went THROUGH the resolved port (not merely a
      //     cosmetic transportFor() followed by direct backend execution).
      const portCalls = events.filter(
        (e) => e.event === "port_call" && e.requested === transport
      );
      expect(portCalls.length).toBeGreaterThanOrEqual(1);

      // 4 · DIRECT-CONSTRUCTION CONTROL: no backend executed outside a port.
      const backendExecs = events.filter((e) => e.event === "backend_exec");
      expect(backendExecs.length).toBeGreaterThanOrEqual(1);
      expect(backendExecs.filter((e) => e.via_port !== true)).toEqual([]);
    }

    it("agent rung: in-process dispatch resolves and executes through transportFor", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      launcherTestBindFor(tmpDir, "run-20260811-010020-bf2-agent");
      writeRunContexts(tmpDir, "run-20260811-010020-bf2-agent", [["architect", "architect"], ["backend", "backend"], ["qa", "qa"]]);
      const { file, env } = probeEnv(tmpDir);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--agent-mode=agent", "--run-id", "run-20260811-010020-bf2-agent"],
        env
      );

      expect(exitCode).toBe(0);
      // Equivalence: the shipped agent-rung signal shape is unchanged.
      const signal = JSON.parse(stdout);
      expect(signal.backend).toBe("agent");
      expect(signal.reason).toBe("explicit agent_mode=agent");
      expect(signal.slug).toBe("test-slug");
      expect(signal.ok).toBe(true);
      expect(Array.isArray(signal.dispatchPlan)).toBe(true);
      expect(signal.dispatchPlan.length).toBeGreaterThanOrEqual(1);
      expect(signal.dispatchPlan[0].env.GUILD_RUN_ID).toBe("run-20260811-010020-bf2-agent");
      expect(signal).toHaveProperty("orchestratorPaneId");
      expect(signal).toHaveProperty("teammatePaneIds");
      expect(signal).toHaveProperty("notes");

      assertResolvedThroughRuntime(readProbe(file), "in-process");
    });

    it("remote path: remote dispatch resolves and executes through transportFor", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      fs.mkdirSync(path.join(tmpDir, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".guild", "settings.json"),
        JSON.stringify(
          {
            defaults: {
              cross_host: {
                enabled: true,
                hosts: { "codex-remote": { address: "gpu-box.example.com", user: "ci" } },
              },
            },
          },
          null,
          2
        ),
        "utf8"
      );
      const { file, env } = probeEnv(tmpDir);
      const { exitCode, stdout } = runScript(
        ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
        { ...env, GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" }
      );

      expect(exitCode).toBe(0);
      // Equivalence: the shipped remote dry-run UX is unchanged.
      expect(stdout).toMatch(/dry-run.*remote dispatch/i);
      expect(stdout).toMatch(/security/i);
      expect(stdout).not.toMatch(/not yet wired/i);

      assertResolvedThroughRuntime(readProbe(file), "remote");
    });

    it("tmux team path: tmux dispatch resolves and executes through transportFor", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const fakeBin = makeFakeTmuxBin(tmpDir, ["other-window"]);
      // T3b: mint the run binding so the launcher's binding-verified descriptor
      // writers (guild.task_assignment.v1/v2) resolve the run's minted record on
      // the REAL tmux dispatch path instead of failing closed (session_context §5).
      launcherTestBindFor(tmpDir, "run-20260811-010021-bf2-tmux");
      writeRunContexts(tmpDir, "run-20260811-010021-bf2-tmux", [["architect", "architect"], ["backend", "backend"], ["qa", "qa"]]);
      const { file, env } = probeEnv(tmpDir);
      const { exitCode, stdout } = runScript(
        [
          "--team",
          teamPath,
          "--cwd",
          tmpDir,
          "--run-id",
          "run-20260811-010021-bf2-tmux",
          // T7 approve-before-dispatch is MANDATORY on a real dispatch; this test
          // focuses on the MH-04 transport wiring, so it uses the audited override
          // (gate enforcement itself is pinned in t7-h1-dispatch-approval.test.ts).
          "--approval-override",
          "test: MH-04 tmux transport wiring",
        ],
        {
          ...env,
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        }
      );

      expect(exitCode).toBe(0);
      // Equivalence: collision/availability/attach UX and the manifest survive.
      expect(stdout).toMatch(/team window "guild-test-slug" created/);
      expect(stdout).toMatch(/manifest →/);
      const manifest = path.join(
        tmpDir,
        ".guild",
        "runs",
        "run-20260811-010021-bf2-tmux",
        "agent-team",
        "session.json"
      );
      expect(fs.existsSync(manifest)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
      expect(parsed.mode).toBe("in-session");
      expect(parsed.window_name).toBe("guild-test-slug");

      const lifecycleFile = path.join(
        tmpDir,
        ".guild",
        "runs",
        "run-20260811-010021-bf2-tmux",
        "task-cell-telemetry",
        "events.jsonl",
      );
      expect(fs.existsSync(lifecycleFile)).toBe(true);
      const lifecycle = fs.readFileSync(lifecycleFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(new Set(lifecycle.map((event) => event.event_name))).toEqual(
        new Set(["spawn_started", "spawned", "ready", "assignment_delivered"]),
      );
      expect(new Set(lifecycle.map((event) => event.instance_id)).size).toBe(3);

      const events = readProbe(file);
      assertResolvedThroughRuntime(events, "tmux");
      // The tmux rung must reach the port for the SPAWN, not only for probes.
      const methods = events
        .filter((e) => e.event === "port_call" && e.requested === "tmux")
        .map((e) => e.method);
      expect(methods).toContain("launch");
    });

    it("collision + availability UX still refuses through the port (no direct backend probe)", () => {
      const { teamPath } = setupConsumerRepo(tmpDir, "test-slug", "team-agent-team.yaml");
      const fakeBin = makeFakeTmuxBin(tmpDir, ["other-window", "guild-test-slug"]);
      const { file, env } = probeEnv(tmpDir);
      const { exitCode, stderr } = runScript(["--team", teamPath, "--cwd", tmpDir], {
        ...env,
        TMUX: "/tmp/tmux-1000/default,12345,0",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/already exists|one team|clobber/i);
      expect(stderr).toMatch(/select-window|kill-window/);

      const events = readProbe(file);
      const resolved = events.filter(
        (e) => e.event === "transport_for" && e.requested === "tmux"
      );
      expect(resolved.some((e) => e.status === "succeeded")).toBe(true);
      // The collision probe itself ran through the resolved port.
      expect(events.filter((e) => e.event === "backend_exec" && e.via_port !== true)).toEqual([]);
    });
  });

});
