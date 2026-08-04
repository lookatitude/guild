/**
 * scripts/__tests__/u5-consumer-migration.test.ts
 *
 * U5 consumer migration pinning + inheritance tests.
 *
 * For each consumer migrated to resolveSettings():
 *   (a) pinning test — behavior unchanged for single-repo case
 *   (b) inheritance test — child now correctly inherits workspace value
 *
 * Consumers under test:
 *   - scripts/workspace/detect.ts       (workspace.mode — NON-inheritable, OD-1 caveat)
 *   - scripts/lib/run-lifecycle.ts      (record_status_runs — inherits)
 *   - scripts/agent-team-launcher.ts    (defaults.cross_host — inherits)
 *   - scripts/score-tier.ts            (models.scoreWeights/thresholds/tiers — inherits)
 *
 * Note: detect.ts uses import.meta.url (ESM guard) so it cannot be directly
 * imported under ts-jest/commonjs. It is tested via spawnSync subprocess, exactly
 * as workspace-detect.test.ts does.
 *
 * AC-11: direct reads removed/justified.
 * AC-12: no regression — existing test counts stay.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const DETECT_SCRIPT = path.resolve(__dirname, "../workspace/detect.ts");
const NODE_ENV = {
  ...process.env,
  NODE_NO_WARNINGS: "1",
  PATH: `${require("node:path").dirname(process.execPath)}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
} as NodeJS.ProcessEnv;

function runDetect(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", DETECT_SCRIPT, ...args], {
    encoding: "utf8",
    env: NODE_ENV,
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-u5-"));
}

function writeSettings(dir: string, obj: object): void {
  const guildDir = path.join(dir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildDir, "settings.json"),
    JSON.stringify(obj, null, 2)
  );
}

function writeWorkspaceManifest(dir: string): void {
  const guildDir = path.join(dir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildDir, "workspace.json"),
    JSON.stringify({ is_workspace: true, sub_guilds: [] }, null, 2)
  );
}

// ── Import the consumers that CAN be directly imported ───────────────────────

// run-lifecycle exports readRecordStatusRuns
import { readRecordStatusRuns } from "../lib/run-lifecycle";

// score-tier exports scoreTier (pure function)
import { scoreTier } from "../score-tier";
import type { ScorerOpts } from "../score-tier";

// resolveSettings for direct projection tests
import { resolveSettings } from "../lib/settings-resolver";

// ── detect.ts: workspace.mode pinning (via subprocess) ───────────────────────

describe("U5/detect — workspace.mode via resolver (pinning, OD-1 caveat)", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  test("absent settings.json → mode defaults to auto (pinning)", () => {
    const root = mkRoot();
    const { status, out } = runDetect(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.detection.mode).toBe("auto");
  });

  test("settings.json workspace.mode=off → detect returns regular (pinning)", () => {
    const root = mkRoot();
    const child = path.join(root, "plugin");
    fs.mkdirSync(path.join(child, ".git"), { recursive: true });
    writeSettings(root, { workspace: { mode: "off" } });
    const { status, out } = runDetect(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("regular");
    expect(j.detection.mode).toBe("off");
  });

  test("settings.json workspace.mode=on → detect returns workspace even on empty root (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, { workspace: { mode: "on" } });
    const { status, out } = runDetect(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
    expect(j.detection.mode).toBe("on");
  });

  test("CLI --mode override wins over settings.json (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, { workspace: { mode: "off" } });
    const { status, out } = runDetect(["--cwd", root, "--mode", "on"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.detection.mode).toBe("on");
    expect(j.kind).toBe("workspace");
  });

  /**
   * OD-1 workspace.mode caveat:
   * workspace.mode must NOT inherit from parent workspace settings.
   * A child's own settings.json drives its detection, not the parent's.
   *
   * Workspace root: workspace.json + settings.json { workspace: { mode: "on" } }
   * Child: .guild/ exists but NO settings.json of its own.
   * Expected: child detect uses built-in default "auto" (mode NOT inherited).
   */
  test("OD-1: workspace.mode does NOT inherit — child runs with built-in default auto", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, { workspace: { mode: "on" } });

    // Child project inside the workspace
    const childDir = path.join(wsRoot, "plugin");
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    // No settings.json in child → should fall back to built-in default "auto"

    const { status, out } = runDetect(["--cwd", childDir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    // workspace.mode is non-inheritable → child sees "auto" (built-in default)
    expect(j.detection.mode).toBe("auto");
  });

  test("OD-1: child can set its own workspace.mode independently from workspace root", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, { workspace: { mode: "on" } });

    const childDir = path.join(wsRoot, "plugin");
    writeSettings(childDir, { workspace: { mode: "off" } }); // child explicitly off

    const { status, out } = runDetect(["--cwd", childDir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    // Child's own setting wins (not the parent's "on")
    expect(j.detection.mode).toBe("off");
  });
});

// ── run-lifecycle.ts: record_status_runs pinning + inheritance ────────────────

describe("U5/run-lifecycle — readRecordStatusRuns pinning (no regression)", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  test("absent settings.json → returns true (default, pinning)", () => {
    const root = mkRoot();
    expect(readRecordStatusRuns(root)).toBe(true);
  });

  test("settings.json record_status_runs: false → returns false (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, { record_status_runs: false });
    expect(readRecordStatusRuns(root)).toBe(false);
  });

  test("settings.json record_status_runs: true → returns true (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, { record_status_runs: true });
    expect(readRecordStatusRuns(root)).toBe(true);
  });

  test("malformed settings.json → returns true (lenient, pinning)", () => {
    const root = mkRoot();
    const guildDir = path.join(root, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    fs.writeFileSync(path.join(guildDir, "settings.json"), "{ invalid json !!");
    expect(readRecordStatusRuns(root)).toBe(true);
  });

  /**
   * Inheritance: record_status_runs SHOULD inherit from workspace.
   * When workspace root sets it false and child has no settings.json,
   * the resolver returns false for the child (inheritance applies here).
   */
  test("inheritance: child inherits record_status_runs: false from workspace root via resolver", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, { record_status_runs: false });

    const childDir = path.join(wsRoot, "plugin");
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });

    const { config } = resolveSettings({ cwd: childDir });
    expect(config.record_status_runs).toBe(false);
  });

  test("inheritance: child can override record_status_runs independently", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, { record_status_runs: false });

    const childDir = path.join(wsRoot, "plugin");
    writeSettings(childDir, { record_status_runs: true });

    const { config } = resolveSettings({ cwd: childDir });
    expect(config.record_status_runs).toBe(true);
  });
});

// ── agent-team-launcher.ts: defaults.cross_host resolver projection ───────────

/**
 * loadCrossHostConfig is private in agent-team-launcher.ts.
 * We test the resolver projection that the migrated code reads.
 * The subprocess integration (writeSettingsCrossHost tests) already exists
 * in agent-team-launcher.test.ts CH-1 suite.
 */
describe("U5/agent-team-launcher — defaults.cross_host resolver projection (pinning + inheritance)", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  test("absent settings.json → cross_host.enabled defaults to false via resolver (pinning)", () => {
    const root = mkRoot();
    const { config } = resolveSettings({ cwd: root });
    expect(config.defaults.cross_host.enabled).toBe(false);
    expect(config.defaults.cross_host.hosts).toEqual({});
  });

  test("settings.json defaults.cross_host.enabled: true → resolver returns true (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, {
      defaults: {
        cross_host: { enabled: true, hosts: { "codex-box": { address: "10.0.0.1" } } },
      },
    });
    const { config } = resolveSettings({ cwd: root });
    expect(config.defaults.cross_host.enabled).toBe(true);
    expect(config.defaults.cross_host.hosts["codex-box"]?.address).toBe("10.0.0.1");
  });

  test("settings.json defaults.cross_host.enabled: false → resolver returns false (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, {
      defaults: { cross_host: { enabled: false, hosts: {} } },
    });
    const { config } = resolveSettings({ cwd: root });
    expect(config.defaults.cross_host.enabled).toBe(false);
  });

  test("inheritance: child inherits defaults.cross_host from workspace root", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, {
      defaults: {
        cross_host: {
          enabled: true,
          hosts: { "gpu-box": { address: "192.168.1.5", user: "ci" } },
        },
      },
    });

    const childDir = path.join(wsRoot, "plugin");
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });

    const { config } = resolveSettings({ cwd: childDir });
    expect(config.defaults.cross_host.enabled).toBe(true);
    expect(config.defaults.cross_host.hosts["gpu-box"]?.address).toBe("192.168.1.5");
  });

  test("inheritance: child can override defaults.cross_host.enabled independently", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, {
      defaults: {
        cross_host: { enabled: true, hosts: { "gpu-box": { address: "10.0.0.1" } } },
      },
    });

    const childDir = path.join(wsRoot, "plugin");
    writeSettings(childDir, {
      defaults: { cross_host: { enabled: false, hosts: {} } },
    });

    const { config } = resolveSettings({ cwd: childDir });
    expect(config.defaults.cross_host.enabled).toBe(false);
  });
});

// ── score-tier.ts: models resolver projection pinning + inheritance ────────────

describe("U5/score-tier — models resolver projection (pinning + inheritance)", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  test("absent settings.json → resolver returns built-in defaults for models (pinning)", () => {
    const root = mkRoot();
    const { config } = resolveSettings({ cwd: root });
    expect(config.models.thresholds.mid).toBe(1);
    expect(config.models.thresholds.powerful).toBe(3);
    expect(config.models.tiers.cheap["claude-code-cli"]).toBe("haiku");
    expect(config.models.tiers.mid["claude-code-cli"]).toBe("sonnet");
    expect(config.models.tiers.powerful["claude-code-cli"]).toBe("opus");
    expect(config.models.scoreWeights.blastRadius).toBe(1);
  });

  test("custom models settings → resolver projection yields overridden values (pinning)", () => {
    const root = mkRoot();
    writeSettings(root, {
      models: {
        thresholds: { mid: 2, powerful: 5 },
        tiers: {
          cheap: { "claude-code-cli": "haiku-3", "codex-cli": null, "agents-file": null },
          mid: { "claude-code-cli": "sonnet-4", "codex-cli": null, "agents-file": null },
          powerful: { "claude-code-cli": "opus-4", "codex-cli": null, "agents-file": null },
        },
        scoreWeights: { blastRadius: 2, security: 3, dependsOn: 1, priorEscalation: 1, workType: 0 },
      },
    });
    const { config } = resolveSettings({ cwd: root });
    expect(config.models.thresholds.mid).toBe(2);
    expect(config.models.thresholds.powerful).toBe(5);
    expect(config.models.tiers.mid["claude-code-cli"]).toBe("sonnet-4");
    expect(config.models.scoreWeights.blastRadius).toBe(2);
  });

  test("resolver projection feeds scoreTier correctly (end-to-end for single-repo)", () => {
    const root = mkRoot();
    writeSettings(root, {
      models: {
        thresholds: { mid: 0, powerful: 2 }, // score 0 → mid; score >= 2 → powerful
        tiers: {
          cheap:    { "claude-code-cli": "haiku",  "codex-cli": null, "agents-file": null },
          mid:      { "claude-code-cli": "sonnet", "codex-cli": null, "agents-file": null },
          powerful: { "claude-code-cli": "opus",   "codex-cli": null, "agents-file": null },
        },
        scoreWeights: { blastRadius: 1, security: 1, dependsOn: 1, priorEscalation: 1, workType: 0 },
      },
    });
    const { config } = resolveSettings({ cwd: root });
    const opts: ScorerOpts = {
      scoreWeights: config.models.scoreWeights,
      thresholds: config.models.thresholds,
      tiers: config.models.tiers,
    };
    // read workType → delta 0, score 0 → meets mid threshold (mid=0) → mid
    const r = scoreTier({ workType: "read" }, opts);
    expect(r.tier).toBe("mid");
    expect(r.model).toBe("sonnet");
  });

  test("inheritance: child inherits models.thresholds from workspace root", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, {
      models: {
        thresholds: { mid: 0, powerful: 10 },
      },
    });

    const childDir = path.join(wsRoot, "plugin");
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });

    const { config } = resolveSettings({ cwd: childDir });
    expect(config.models.thresholds.mid).toBe(0);
    expect(config.models.thresholds.powerful).toBe(10);
  });

  test("inheritance: child overrides thresholds while workspace provides other model keys (deep merge)", () => {
    const wsRoot = mkTmp();
    tmpDirs.push(wsRoot);
    writeWorkspaceManifest(wsRoot);
    writeSettings(wsRoot, {
      models: {
        thresholds: { mid: 0, powerful: 10 },
        tiers: {
          cheap:    { "claude-code-cli": "haiku-ws",  "codex-cli": null, "agents-file": null },
          mid:      { "claude-code-cli": "sonnet-ws", "codex-cli": null, "agents-file": null },
          powerful: { "claude-code-cli": "opus-ws",   "codex-cli": null, "agents-file": null },
        },
      },
    });

    const childDir = path.join(wsRoot, "plugin");
    writeSettings(childDir, {
      models: {
        thresholds: { mid: 2, powerful: 5 }, // child overrides only thresholds
      },
    });

    const { config } = resolveSettings({ cwd: childDir });
    // Child's thresholds win
    expect(config.models.thresholds.mid).toBe(2);
    expect(config.models.thresholds.powerful).toBe(5);
    // Workspace's tiers are still inherited (deep merge)
    expect(config.models.tiers.cheap["claude-code-cli"]).toBe("haiku-ws");
    expect(config.models.tiers.mid["claude-code-cli"]).toBe("sonnet-ws");
  });
});

// ── agent-team-launcher.ts: malformed cross_host guard — subprocess coverage ──

/**
 * Finding 1 (MAJOR): the migrated loadCrossHostConfig cast resolver values
 * directly, dropping the old `enabled === true` strict boolean guard and the
 * `isPlainObject(hosts)` fallback guard.
 *
 * These tests drive the REAL agent-team-launcher.ts CLI subprocess so they
 * exercise the actual private consumer path rather than just the resolver
 * projection. They verify that:
 *   - enabled:"yes"  (non-boolean truthy)  → treated as DISABLED (cross-host off)
 *   - hosts:"invalid" (non-object)         → treated as {} (no endpoints, cross-host inert)
 *
 * We use `--dry-run` + a single-host team so the test never spawns real tmux.
 * The team file used is `team-agent-team.yaml` (already in fixtures — single-host,
 * no remote specialist → cross-host routing block is bypassed when disabled).
 */

const LAUNCHER_SCRIPT = path.resolve(__dirname, "../agent-team-launcher.ts");
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

function runLauncher(
  args: string[],
  env: Record<string, string | undefined> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  delete baseEnv.TMUX; // prevent host terminal state from tripping tests
  // T7R-R1-B1: these fixtures carry no team-plan trail and are about consumer
  // migration, not approval. Opt into the ONE audited escape hatch with a stated
  // reason; the gate's own pins live in t7-h1-dispatch-approval.test.ts.
  baseEnv.GUILD_DISPATCH_APPROVAL_OVERRIDE =
    "consumer-migration fixture: no team-plan trail; approval verification is pinned separately";
  const finalEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...baseEnv, ...env })) {
    if (v !== undefined) finalEnv[k] = v;
  }
  const r = spawnSync("npx", ["tsx", LAUNCHER_SCRIPT, ...args], {
    encoding: "utf8",
    env: finalEnv,
    timeout: 120_000,
  });
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function setupLauncherRepo(
  tmpDir: string,
  slug: string,
  fixtureFile: string
): { teamPath: string } {
  const teamDir = path.join(tmpDir, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const src = path.join(FIXTURES_DIR, fixtureFile);
  const dst = path.join(teamDir, `${slug}.yaml`);
  fs.copyFileSync(src, dst);
  return { teamPath: dst };
}

describe("U5/agent-team-launcher — cross_host malformed-value guard (subprocess, MAJOR fix)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-u5-atl-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Malformed `enabled`: string "yes" is truthy in JS but must NOT enable
   * cross-host. The guard must require `enabled === true` (strict boolean).
   * Without the guard, the launcher would try to enable cross-host routing
   * and (with no endpoint) exit 1 with "no SSH endpoint" rather than
   * proceeding normally with a single-host local tmux path.
   *
   * With the guard: enabled is false → single-host path → exits 0 on dry-run.
   */
  test('malformed enabled:"yes" (non-boolean truthy) → cross-host treated as DISABLED (dry-run exits 0)', () => {
    const { teamPath } = setupLauncherRepo(tmpDir, "test-slug", "team-agent-team.yaml");
    // Write settings.json with a string "yes" instead of boolean true
    const guildDir = path.join(tmpDir, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    fs.writeFileSync(
      path.join(guildDir, "settings.json"),
      JSON.stringify({
        defaults: {
          cross_host: {
            enabled: "yes",   // non-boolean truthy — must NOT activate cross-host
            hosts: {},
          },
        },
      }, null, 2)
    );
    const { exitCode, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { GUILD_CROSS_HOST_ENABLED: undefined }
    );
    // Cross-host must be off → no "route to a REMOTE host" error
    expect(stderr).not.toMatch(/route to a REMOTE host/i);
    expect(exitCode).toBe(0);
  });

  /**
   * Malformed `enabled`: integer 1 is truthy but not boolean true.
   * Same guard applies.
   */
  test('malformed enabled:1 (non-boolean truthy) → cross-host treated as DISABLED (dry-run exits 0)', () => {
    const { teamPath } = setupLauncherRepo(tmpDir, "test-slug", "team-agent-team.yaml");
    const guildDir = path.join(tmpDir, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    fs.writeFileSync(
      path.join(guildDir, "settings.json"),
      // Write raw JSON with numeric 1 (not valid JSON boolean)
      `{"defaults":{"cross_host":{"enabled":1,"hosts":{}}}}`
    );
    const { exitCode, stderr } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { GUILD_CROSS_HOST_ENABLED: undefined }
    );
    expect(stderr).not.toMatch(/route to a REMOTE host/i);
    expect(exitCode).toBe(0);
  });

  /**
   * Malformed `hosts`: a non-object value (string) must fall back to {}.
   * If hosts were cast through, routing could receive a corrupt value.
   * With the guard: hosts falls back to {} → no endpoints → cross-host inert.
   * Even with enabled:true, no endpoint means no remote dispatch (the launcher
   * handles that separately — here we just confirm hosts is not leaked).
   */
  test('malformed hosts (string instead of object) → hosts falls back to {} → cross-host inert (dry-run exits 0)', () => {
    const { teamPath } = setupLauncherRepo(tmpDir, "test-slug", "team-agent-team.yaml");
    const guildDir = path.join(tmpDir, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    fs.writeFileSync(
      path.join(guildDir, "settings.json"),
      // hosts is a string instead of an object
      JSON.stringify({
        defaults: {
          cross_host: {
            enabled: false,         // disabled → safe; this just confirms hosts guard fires
            hosts: "not-an-object", // non-object hosts → must fall back to {}
          },
        },
      }, null, 2)
    );
    const { exitCode } = runLauncher(
      ["--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { GUILD_CROSS_HOST_ENABLED: undefined }
    );
    // Should not crash trying to iterate a string as hosts map
    expect(exitCode).toBe(0);
  });
});

// ── score-tier.ts: CLI --cwd subprocess tests (MINOR fix — real consumer path) ─

/**
 * Finding 2 (MINOR): the u5 pinning tests for score-tier exercised the resolver
 * projection and scoreTier() directly but NOT the real loadConfigModels consumer
 * path that main() calls when --cwd is supplied.
 *
 * These tests drive the real score-tier.ts CLI with --cwd pointing at a
 * temp dir that contains a settings.json, verifying the migrated loadConfigModels
 * actually reads and applies the settings through the resolver.
 */

const SCORE_TIER_SCRIPT = path.resolve(__dirname, "../score-tier.ts");
const SCORE_TIER_ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function runScoreTierCli(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCORE_TIER_SCRIPT, ...args], {
    encoding: "utf8",
    env: SCORE_TIER_ENV,
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("U5/score-tier — CLI --cwd drives real loadConfigModels (MINOR fix — subprocess)", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  /**
   * Baseline: no --cwd → built-in defaults → read workType → cheap.
   * Confirms the CLI still works without a settings.json (no regression).
   */
  test("no --cwd → built-in defaults used → read/cheap (CLI subprocess, pinning)", () => {
    const { status, out } = runScoreTierCli([
      "--signals", JSON.stringify({ workType: "read" }),
    ]);
    expect(status).toBe(0);
    const j = JSON.parse(out.trim());
    expect(j.tier).toBe("cheap");
    expect(j.model).toBe("haiku");
  });

  /**
   * Custom thresholds via --cwd: settings.json has mid:0 so score=0 → mid.
   * This exercises the real loadConfigModels path end-to-end.
   */
  test("--cwd with custom thresholds (mid:0) → read workType score 0 → mid (CLI subprocess)", () => {
    const root = mkRoot();
    writeSettings(root, {
      models: {
        thresholds: { mid: 0, powerful: 10 },
        tiers: {
          cheap:    { "claude-code-cli": "haiku",  "codex-cli": null, "agents-file": null },
          mid:      { "claude-code-cli": "sonnet", "codex-cli": null, "agents-file": null },
          powerful: { "claude-code-cli": "opus",   "codex-cli": null, "agents-file": null },
        },
      },
    });
    const { status, out } = runScoreTierCli([
      "--signals", JSON.stringify({ workType: "read" }),
      "--cwd", root,
    ]);
    expect(status).toBe(0);
    const j = JSON.parse(out.trim());
    // With mid:0, score=0 meets the mid threshold → mid tier
    expect(j.tier).toBe("mid");
    expect(j.model).toBe("sonnet");
  });

  /**
   * Custom tiers via --cwd: settings.json provides alternate model names.
   * Verifies that the real CLI consumer path picks up the override tiers.
   */
  test("--cwd with custom tiers → model name from settings (CLI subprocess)", () => {
    const root = mkRoot();
    writeSettings(root, {
      models: {
        tiers: {
          cheap:    { "claude-code-cli": "haiku-3",  "codex-cli": null, "agents-file": null },
          mid:      { "claude-code-cli": "sonnet-4", "codex-cli": null, "agents-file": null },
          powerful: { "claude-code-cli": "opus-4",   "codex-cli": null, "agents-file": null },
        },
      },
    });
    const { status, out } = runScoreTierCli([
      "--signals", JSON.stringify({ workType: "draft" }),
      "--cwd", root,
    ]);
    expect(status).toBe(0);
    const j = JSON.parse(out.trim());
    expect(j.tier).toBe("mid");
    expect(j.model).toBe("sonnet-4");
  });

  /**
   * --model-tier pin overrides settings.json thresholds even with --cwd.
   * The pin is top of the precedence ladder: pin > scored tier > settings.
   */
  test("--model-tier pin overrides settings.json custom thresholds (CLI subprocess)", () => {
    const root = mkRoot();
    writeSettings(root, {
      models: {
        thresholds: { mid: 0, powerful: 0 }, // everything would score powerful
        tiers: {
          cheap:    { "claude-code-cli": "haiku",  "codex-cli": null, "agents-file": null },
          mid:      { "claude-code-cli": "sonnet", "codex-cli": null, "agents-file": null },
          powerful: { "claude-code-cli": "opus",   "codex-cli": null, "agents-file": null },
        },
      },
    });
    const { status, out } = runScoreTierCli([
      "--signals", JSON.stringify({ workType: "read" }),
      "--cwd", root,
      "--model-tier", "cheap",
    ]);
    expect(status).toBe(0);
    const j = JSON.parse(out.trim());
    // Pin wins regardless of thresholds
    expect(j.tier).toBe("cheap");
    expect(j.model).toBe("haiku");
  });

  /**
   * Absent settings.json under --cwd → graceful fallback to built-in defaults.
   * The real loadConfigModels catch-path returns {} so scoreTier uses its own defaults.
   */
  test("--cwd with absent settings.json → graceful fallback to built-in defaults (CLI subprocess)", () => {
    const root = mkRoot();
    // No settings.json written — just an empty dir
    const { status, out } = runScoreTierCli([
      "--signals", JSON.stringify({ workType: "architect", sensitivity: true }),
      "--cwd", root,
    ]);
    expect(status).toBe(0);
    const j = JSON.parse(out.trim());
    // Built-in: architect(2) + security(1) = 3 → powerful
    expect(j.tier).toBe("powerful");
    expect(j.model).toBe("opus");
  });
});
