/**
 * scripts/__tests__/settings-resolver.test.ts
 *
 * TDD suite for scripts/lib/settings-resolver.ts
 *
 * Order:
 *  1. Pinning test  — prove parity with read-guild-config before refactor
 *  2. root-only     — workspace root resolves its own settings normally
 *  3. AC-1          — child with no settings.json inherits workspace agent_mode
 *  4. AC-2          — child with {agent_mode:"subagent"} overrides only that child
 *  5. isolated      — project with no ancestor workspace.json behaves exactly like today
 *  6. local-prec    — OD-2 chain: workspace.local < project < project.local
 *  7. source-map    — each layer's key reports the correct Source tag
 *  8. non-inherit   — OD-1: child does NOT inherit workspace initiative_default
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveSettings, ResolvedConfig, Source } from "../lib/settings-resolver";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-resolver-"));
}

/** Set up a minimal directory with a .guild/ subfolder. */
function mkGuildDir(root: string): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
}

function writeJson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function writeSettings(dir: string, obj: unknown): void {
  writeJson(path.join(dir, ".guild", "settings.json"), obj);
}

function writeLocal(dir: string, obj: unknown): void {
  writeJson(path.join(dir, ".guild", "settings.local.json"), obj);
}

function writeWorkspaceManifest(
  wsRoot: string,
  subGuildPaths: string[],
  extras: Record<string, unknown> = {}
): void {
  writeJson(path.join(wsRoot, ".guild", "workspace.json"), {
    schema_version: "guild.workspace.v1",
    is_workspace: true,
    sub_guilds: subGuildPaths.map((p) => ({
      name: path.basename(p),
      path: path.relative(wsRoot, p),
      kind: "sub-guild",
    })),
    ...extras,
  });
}

// ---------------------------------------------------------------------------
// Cleanup registry
// ---------------------------------------------------------------------------

const TMPDIRS: string[] = [];
afterAll(() => {
  for (const d of TMPDIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tmpDir(): string {
  const d = mkTmp();
  TMPDIRS.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// 1. Pinning test — prove resolver output matches read-guild-config baseline
//    for the single-repo (no workspace) case.
// ---------------------------------------------------------------------------

describe("1 — Pinning: parity with read-guild-config (no workspace)", () => {
  test("no settings.json: built-in defaults apply (agent_mode=auto, rigor=standard)", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    // no settings.json

    const { config } = resolveSettings({ cwd: dir });

    expect(config.agent_mode).toBe("auto");
    expect(config.rigor).toBe("standard");
    expect(config.review).toBe("local");
    expect(config.loop_cap).toBe(16);
    expect(config.codex_cap).toBe(5);
    expect(config.record_status_runs).toBe(true);
    expect(config.codex_skip_enforcement).toBe("warn");
    expect(config.workspace.mode).toBe("auto");
  });

  test("settings.json overrides built-in (rigor=deep, agent_mode=team)", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "deep", agent_mode: "team" });

    const { config } = resolveSettings({ cwd: dir });

    expect(config.rigor).toBe("deep");
    expect(config.agent_mode).toBe("team");
  });

  test("CLI flags override settings.json and built-ins", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "deep", review: "cross" });

    const { config } = resolveSettings({
      cwd: dir,
      flags: { rigor: "quick", review: "off" },
    });

    expect(config.rigor).toBe("quick");
    expect(config.review).toBe("off");
  });

  test("settings.local.json overrides settings.json, CLI still beats both", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { review: "local" });
    writeLocal(dir, { review: "off" });

    const localWins = resolveSettings({ cwd: dir });
    expect(localWins.config.review).toBe("off");

    const cliWins = resolveSettings({ cwd: dir, flags: { review: "cross" } });
    expect(cliWins.config.review).toBe("cross");
  });

  test("rigor expansion preserved: deep → loops=all when no explicit override", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "deep" });

    const { config } = resolveSettings({ cwd: dir });

    // rigor=deep expands loops to "all" when not explicitly set
    expect(config.rigor).toBe("deep");
    // loops is derived from rigor when not explicitly set in settings or flags
    expect(config._rigorExpanded).toBeDefined();
    expect(config._rigorExpanded!.rigor).toBe("deep");
  });
});

// ---------------------------------------------------------------------------
// 2. Root-only — workspace root resolves its own settings as the project layer
// ---------------------------------------------------------------------------

describe("2 — Root-only: workspace root resolves its own settings", () => {
  test("workspace root with settings.json: values resolve from project layer", () => {
    const wsRoot = tmpDir();
    mkGuildDir(wsRoot);
    writeSettings(wsRoot, { agent_mode: "team", rigor: "deep" });
    writeWorkspaceManifest(wsRoot, []);

    const { config, sources } = resolveSettings({ cwd: wsRoot });

    expect(config.agent_mode).toBe("team");
    expect(config.rigor).toBe("deep");
    // When cwd IS the workspace root, settings come from the 'project' layer
    expect(sources.agent_mode).toBe("project");
    expect(sources.rigor).toBe("project");
  });

  test("workspace root with no settings.json: built-in defaults apply", () => {
    const wsRoot = tmpDir();
    mkGuildDir(wsRoot);
    writeWorkspaceManifest(wsRoot, []);
    // no settings.json

    const { config } = resolveSettings({ cwd: wsRoot });

    expect(config.agent_mode).toBe("auto");
    expect(config.rigor).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// 3. AC-1 — child with NO settings.json inherits workspace root's agent_mode
// ---------------------------------------------------------------------------

describe("3 — AC-1: child with no settings.json inherits workspace agent_mode", () => {
  test("child dir absent settings.json → resolves workspace agent_mode=team, source=workspace", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    // Workspace root settings: agent_mode: team
    writeSettings(wsRoot, { agent_mode: "team", rigor: "deep" });
    writeWorkspaceManifest(wsRoot, [childDir]);
    // child has NO settings.json

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.agent_mode).toBe("team");
    expect(sources.agent_mode).toBe("workspace");
  });

  test("child dir absent settings.json → also inherits rigor from workspace", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "benchmark");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { rigor: "deep", agent_mode: "team" });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.rigor).toBe("deep");
    expect(sources.rigor).toBe("workspace");
    expect(sources.agent_mode).toBe("workspace");
  });

  test("AC-1: built-in keys NOT present in workspace settings.json remain at built-in source", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    // Workspace only sets agent_mode
    writeSettings(wsRoot, { agent_mode: "team" });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.agent_mode).toBe("team");
    expect(sources.agent_mode).toBe("workspace");
    // record_status_runs not set in workspace → built-in
    expect(sources.record_status_runs).toBe("builtin");
    expect(config.record_status_runs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. AC-2 — child WITH {agent_mode:"subagent"} overrides only that child;
//    root and siblings resolve root value unchanged.
// ---------------------------------------------------------------------------

describe("4 — AC-2: child override doesn't affect root or siblings", () => {
  test("child settings.json agent_mode=subagent only affects that child, source=project", () => {
    const wsRoot = tmpDir();
    const childA = path.join(wsRoot, "plugin");
    const childB = path.join(wsRoot, "website");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childA, ".guild"), { recursive: true });
    fs.mkdirSync(path.join(childB, ".guild"), { recursive: true });
    writeSettings(wsRoot, { agent_mode: "team" });
    writeWorkspaceManifest(wsRoot, [childA, childB]);
    writeSettings(childA, { agent_mode: "subagent" });
    // childB has no settings.json

    const childAResult = resolveSettings({ cwd: childA });
    const childBResult = resolveSettings({ cwd: childB });
    const rootResult   = resolveSettings({ cwd: wsRoot });

    // childA has its own override
    expect(childAResult.config.agent_mode).toBe("subagent");
    expect(childAResult.sources.agent_mode).toBe("project");

    // childB inherits from workspace
    expect(childBResult.config.agent_mode).toBe("team");
    expect(childBResult.sources.agent_mode).toBe("workspace");

    // root is unaffected
    expect(rootResult.config.agent_mode).toBe("team");
    expect(rootResult.sources.agent_mode).toBe("project");
  });

  test("child override of rigor does not bleed into sibling resolution", () => {
    const wsRoot = tmpDir();
    const childA = path.join(wsRoot, "plugin");
    const childB = path.join(wsRoot, "benchmark");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childA, ".guild"), { recursive: true });
    fs.mkdirSync(path.join(childB, ".guild"), { recursive: true });
    writeSettings(wsRoot, { rigor: "standard", agent_mode: "team" });
    writeWorkspaceManifest(wsRoot, [childA, childB]);
    writeSettings(childA, { rigor: "quick" });

    const childAResult = resolveSettings({ cwd: childA });
    const childBResult = resolveSettings({ cwd: childB });

    expect(childAResult.config.rigor).toBe("quick");
    expect(childBResult.config.rigor).toBe("standard");
    expect(childBResult.sources.rigor).toBe("workspace");
  });
});

// ---------------------------------------------------------------------------
// 5. Isolated project — no ancestor workspace.json; behaves exactly like today
// ---------------------------------------------------------------------------

describe("5 — Isolated project: no ancestor workspace, own settings is complete spec", () => {
  test("project with no workspace ancestor uses its own settings over built-ins", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { agent_mode: "agent", rigor: "quick" });
    // no workspace.json anywhere in ancestry

    const { config, sources } = resolveSettings({ cwd: dir });

    expect(config.agent_mode).toBe("agent");
    expect(config.rigor).toBe("quick");
    expect(sources.agent_mode).toBe("project");
    expect(sources.rigor).toBe("project");
  });

  test("isolated project with no settings.json falls through to built-ins", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    // no settings.json, no workspace ancestor

    const { config, sources } = resolveSettings({ cwd: dir });

    expect(config.agent_mode).toBe("auto");
    expect(sources.agent_mode).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// 6. Local precedence — OD-2 chain:
//    built-in < workspace settings < workspace local < project settings < project local < CLI
// ---------------------------------------------------------------------------

describe("6 — Local precedence (OD-2)", () => {
  test("workspace.local wins over workspace settings.json", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { review: "local" });
    writeLocal(wsRoot, { review: "cross" });       // workspace local
    writeWorkspaceManifest(wsRoot, [childDir]);
    // child has no settings.json, no local

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.review).toBe("cross");
    expect(sources.review).toBe("workspace-local");
  });

  test("project settings.json wins over workspace.local", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { review: "local" });
    writeLocal(wsRoot, { review: "cross" });       // workspace local says "cross"
    writeSettings(childDir, { review: "off" });    // project says "off"
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.review).toBe("off");
    expect(sources.review).toBe("project");
  });

  test("project.local wins over project settings.json", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { review: "local" });
    writeSettings(childDir, { review: "off" });
    writeLocal(childDir, { review: "cross" });     // project local wins
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.review).toBe("cross");
    expect(sources.review).toBe("project-local");
  });

  test("CLI flag wins over project.local", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { review: "local" });
    writeSettings(childDir, { review: "off" });
    writeLocal(childDir, { review: "cross" });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({
      cwd: childDir,
      flags: { review: "local" },
    });

    expect(config.review).toBe("local");
    expect(sources.review).toBe("cli");
  });

  test("full 5-layer chain for a single key — each level overrides the previous", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeWorkspaceManifest(wsRoot, [childDir]);

    // Step 1: only built-in
    const r1 = resolveSettings({ cwd: childDir });
    expect(r1.config.review).toBe("local");    // built-in default
    expect(r1.sources.review).toBe("builtin");

    // Step 2: add workspace settings
    writeSettings(wsRoot, { review: "cross" });
    const r2 = resolveSettings({ cwd: childDir });
    expect(r2.config.review).toBe("cross");
    expect(r2.sources.review).toBe("workspace");

    // Step 3: add workspace local
    writeLocal(wsRoot, { review: "off" });
    const r3 = resolveSettings({ cwd: childDir });
    expect(r3.config.review).toBe("off");
    expect(r3.sources.review).toBe("workspace-local");

    // Step 4: add project settings
    writeSettings(childDir, { review: "local" });
    const r4 = resolveSettings({ cwd: childDir });
    expect(r4.config.review).toBe("local");
    expect(r4.sources.review).toBe("project");

    // Step 5: add project local
    writeLocal(childDir, { review: "cross" });
    const r5 = resolveSettings({ cwd: childDir });
    expect(r5.config.review).toBe("cross");
    expect(r5.sources.review).toBe("project-local");

    // Step 6: CLI flag
    const r6 = resolveSettings({ cwd: childDir, flags: { review: "off" } });
    expect(r6.config.review).toBe("off");
    expect(r6.sources.review).toBe("cli");
  });
});

// ---------------------------------------------------------------------------
// 7. Source-map correctness — each layer is tagged correctly
// ---------------------------------------------------------------------------

describe("7 — Source-map: each key tagged with correct Source", () => {
  test("built-in source tagged for all keys when no settings files present", () => {
    const dir = tmpDir();
    mkGuildDir(dir);

    const { sources } = resolveSettings({ cwd: dir });

    expect(sources.agent_mode).toBe("builtin");
    expect(sources.rigor).toBe("builtin");
    expect(sources.review).toBe("builtin");
    expect(sources.loop_cap).toBe("builtin");
  });

  test("project source tagged when key comes from project settings.json", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { agent_mode: "team" });

    const { sources } = resolveSettings({ cwd: dir });

    expect(sources.agent_mode).toBe("project");
    expect(sources.rigor).toBe("builtin");   // not set in project file
  });

  test("project-local source tagged when key comes from project settings.local.json", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { agent_mode: "subagent" });
    writeLocal(dir, { agent_mode: "team" });

    const { sources } = resolveSettings({ cwd: dir });

    expect(sources.agent_mode).toBe("project-local");
  });

  test("workspace source tagged when key comes from workspace settings.json and child lacks it", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { rigor: "deep" });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { sources } = resolveSettings({ cwd: childDir });

    expect(sources.rigor).toBe("workspace");
  });

  test("workspace-local source tagged when key comes from workspace settings.local.json", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { rigor: "standard" });
    writeLocal(wsRoot, { rigor: "deep" });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { sources } = resolveSettings({ cwd: childDir });

    expect(sources.rigor).toBe("workspace-local");
  });

  test("cli source tagged for every key explicitly passed via flags", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "standard" });

    const { sources } = resolveSettings({ cwd: dir, flags: { rigor: "deep", review: "off" } });

    expect(sources.rigor).toBe("cli");
    expect(sources.review).toBe("cli");
    // keys NOT in flags retain their layer
    expect(sources.agent_mode).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// 8. Non-inherit (OD-1) — child does NOT inherit initiative_default
// ---------------------------------------------------------------------------

describe("8 — OD-1: initiative_default does NOT inherit from workspace", () => {
  test("child resolves null initiative_default even when workspace has one set", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, {
      agent_mode: "team",
      initiative_default: "workspace-initiative-123",
    });
    writeWorkspaceManifest(wsRoot, [childDir]);
    // child has no settings.json

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.initiative_default).toBeNull();
    // agent_mode does inherit (it's a normal key)
    expect(config.agent_mode).toBe("team");
    // initiative_default resolves from built-in (null), not workspace
    expect(sources.initiative_default).toBe("builtin");
  });

  test("child's own initiative_default is used when set in child settings.json", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { initiative_default: "ws-initiative" });
    writeSettings(childDir, { initiative_default: "child-initiative" });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.initiative_default).toBe("child-initiative");
    expect(sources.initiative_default).toBe("project");
  });

  test("workspace root resolves its own initiative_default (no inheritance issue at root)", () => {
    const wsRoot = tmpDir();
    mkGuildDir(wsRoot);
    writeSettings(wsRoot, { initiative_default: "ws-initiative" });
    writeWorkspaceManifest(wsRoot, []);

    const { config, sources } = resolveSettings({ cwd: wsRoot });

    expect(config.initiative_default).toBe("ws-initiative");
    expect(sources.initiative_default).toBe("project");
  });
});

// ---------------------------------------------------------------------------
// 9. workspace.mode non-inherit guard
// ---------------------------------------------------------------------------

describe("9 — workspace.mode: child detection not contaminated by workspace root value", () => {
  test("child sees workspace.mode=auto (built-in) even if root sets workspace.mode=on", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { workspace: { mode: "on" } });
    writeWorkspaceManifest(wsRoot, [childDir]);

    const { config, sources } = resolveSettings({ cwd: childDir });

    // workspace.mode should NOT be inherited — it's root-detection-only
    expect(config.workspace.mode).toBe("auto");
    expect(sources["workspace.mode"]).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// 10. Edge cases
// ---------------------------------------------------------------------------

describe("10 — Edge cases", () => {
  test("workspace.json with is_workspace=false is NOT treated as a workspace root", () => {
    const dir = tmpDir();
    const childDir = path.join(dir, "sub");
    fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    // not a workspace — is_workspace: false
    writeJson(path.join(dir, ".guild", "workspace.json"), {
      schema_version: "guild.workspace.v1",
      is_workspace: false,
      sub_guilds: [{ name: "sub", path: "sub", kind: "sub-guild" }],
    });
    writeSettings(dir, { agent_mode: "team" });
    // no settings.json in childDir

    const { config, sources } = resolveSettings({ cwd: childDir });

    // should NOT inherit from dir since is_workspace=false
    expect(config.agent_mode).toBe("auto");   // built-in default
    expect(sources.agent_mode).toBe("builtin");
  });

  test("walk stops at filesystem root — no infinite loop", () => {
    // Using a well-nested tmp dir with no .guild/workspace.json anywhere
    const base = tmpDir();
    const nested = path.join(base, "a", "b", "c");
    fs.mkdirSync(path.join(nested, ".guild"), { recursive: true });
    writeSettings(nested, { rigor: "quick" });

    const { config } = resolveSettings({ cwd: nested });

    expect(config.rigor).toBe("quick");
  });

  test("cwd without a .guild dir resolves built-in defaults (graceful)", () => {
    const dir = tmpDir();
    // No .guild/ created at all

    const { config } = resolveSettings({ cwd: dir });

    expect(config.agent_mode).toBe("auto");
    expect(config.rigor).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// CODEX G-lane findings — regression tests written FIRST (RED) then fixed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Finding 1 — MAJOR: cross-layer defaults.* sub-blocks must deep-merge,
//   not wholesale-replace. A higher layer overrides only the exact nested
//   path it sets; sibling nested keys from lower layers must survive.
// ---------------------------------------------------------------------------

describe("F1 — nested defaults.* blocks deep-merge across layers (no sibling clobber)", () => {
  test("workspace defaults.quality + child defaults.team.size — sibling sub-block survives", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    // Workspace sets defaults.quality budget (non-default value)
    writeSettings(wsRoot, {
      defaults: {
        quality: { budget: { per_class_minutes: 20, total_minutes: 60 } },
        team: { size: 5, always_include: [] },
      },
    });
    writeWorkspaceManifest(wsRoot, [childDir]);
    // Child overrides ONLY defaults.team.size — must NOT clobber quality
    writeSettings(childDir, {
      defaults: {
        team: { size: 2, always_include: ["architect"] },
      },
    });

    const { config } = resolveSettings({ cwd: childDir });

    // Child value wins for the key it set
    expect(config.defaults.team.size).toBe(2);
    expect(config.defaults.team.always_include).toEqual(["architect"]);
    // Workspace quality must survive — child did not touch it
    expect(config.defaults.quality.budget.per_class_minutes).toBe(20);
    expect(config.defaults.quality.budget.total_minutes).toBe(60);
  });

  test("workspace models.thresholds + child models.advisorRounds — sibling sub-field survives", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, {
      models: { thresholds: { mid: 2, powerful: 5 }, advisorRounds: 4 },
    });
    writeWorkspaceManifest(wsRoot, [childDir]);
    // Child only overrides advisorRounds
    writeSettings(childDir, {
      models: { advisorRounds: 1 },
    });

    const { config } = resolveSettings({ cwd: childDir });

    expect(config.models.advisorRounds).toBe(1);
    // thresholds from workspace must survive
    expect(config.models.thresholds.mid).toBe(2);
    expect(config.models.thresholds.powerful).toBe(5);
  });

  test("project-local partial defaults override preserves sibling keys from project settings", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, {
      defaults: {
        quality: { budget: { per_class_minutes: 15, total_minutes: 45 } },
        reporting: "verbose",
      },
    });
    writeLocal(dir, {
      defaults: { reporting: "quiet" },
    });

    const { config } = resolveSettings({ cwd: dir });

    expect(config.defaults.reporting).toBe("quiet");
    // quality must survive from project settings
    expect(config.defaults.quality.budget.per_class_minutes).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Finding 2 — MAJOR: project-local workspace.mode must be honoured.
//   The final workspace block must read project < project-local < flags,
//   never inheriting from workspace root.
// ---------------------------------------------------------------------------

describe("F2 — project settings.local.json workspace.mode is applied", () => {
  test("child settings.local.json {workspace:{mode:'off'}} → workspace.mode=off, source=project-local", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { agent_mode: "team" });
    writeWorkspaceManifest(wsRoot, [childDir]);
    // Child has no settings.json but has settings.local.json with workspace.mode override
    writeLocal(childDir, { workspace: { mode: "off" } });

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.workspace.mode).toBe("off");
    expect(sources["workspace.mode"]).toBe("project-local");
  });

  test("project settings.json workspace.mode=on, local overrides to off → off wins", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { workspace: { mode: "on" } });
    writeLocal(dir, { workspace: { mode: "off" } });

    const { config, sources } = resolveSettings({ cwd: dir });

    expect(config.workspace.mode).toBe("off");
    expect(sources["workspace.mode"]).toBe("project-local");
  });

  test("workspace root sets mode=on; child project settings.json overrides to off — child wins, not root", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { workspace: { mode: "on" } });
    writeWorkspaceManifest(wsRoot, [childDir]);
    writeSettings(childDir, { workspace: { mode: "off" } });

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.workspace.mode).toBe("off");
    expect(sources["workspace.mode"]).toBe("project");
  });
});

// ---------------------------------------------------------------------------
// Finding 3 — MAJOR: loadLocal inflates into DEFAULTS+base, making merged.review
//   appear explicit even when only an unrelated key was in the local file.
//   Fix: track per-layer explicit key sets and base rigor-explicitness only on
//   whether loops/loop_cap/review were set by SOME layer, not on the inflated merge.
// ---------------------------------------------------------------------------

describe("F3 — unrelated local-file key must not suppress rigor-derived loops/review", () => {
  test("settings.json {rigor:deep} + settings.local.json {agent_mode:subagent} → loops/review from rigor profile", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "deep" });
    writeLocal(dir, { agent_mode: "subagent" });

    const { config } = resolveSettings({ cwd: dir });

    // rigor=deep should still expand loops to "all" and review to "cross"
    expect(config.rigor).toBe("deep");
    expect(config.loops).toBe("all");
    expect(config.review).toBe("cross");
    // The local key that was set explicitly should still apply
    expect(config.agent_mode).toBe("subagent");
  });

  test("workspace {rigor:deep} + child local {agent_mode:subagent} → rigor expansion still fires", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { rigor: "deep" });
    writeWorkspaceManifest(wsRoot, [childDir]);
    writeLocal(childDir, { agent_mode: "subagent" });

    const { config } = resolveSettings({ cwd: childDir });

    expect(config.loops).toBe("all");
    expect(config.review).toBe("cross");
    expect(config.agent_mode).toBe("subagent");
  });

  test("settings.json {rigor:standard} + settings.local.json {review:cross} → local review wins (not rigor-derived)", () => {
    // This verifies the complement: when local DOES explicitly set review, it should win
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "standard" });
    writeLocal(dir, { review: "cross" });

    const { config } = resolveSettings({ cwd: dir });

    // local review=cross should beat the rigor-standard-derived review=local
    expect(config.review).toBe("cross");
    expect(config.rigor).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// Finding 4 — MAJOR: malformed inner workspace.json must not block discovery
//   of a valid outer workspace root. On parse failure, continue walking up.
// ---------------------------------------------------------------------------

describe("F4 — malformed inner workspace.json does not block outer workspace discovery", () => {
  test("malformed inner workspace.json + valid outer workspace → outer is found", () => {
    const outerWs = tmpDir();
    const middleDir = path.join(outerWs, "middle");
    const childDir = path.join(middleDir, "plugin");
    mkGuildDir(outerWs);
    fs.mkdirSync(path.join(middleDir, ".guild"), { recursive: true });
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    // Outer is a valid workspace
    writeSettings(outerWs, { agent_mode: "team" });
    writeWorkspaceManifest(outerWs, [middleDir]);
    // Middle has a MALFORMED workspace.json (bad JSON)
    fs.writeFileSync(
      path.join(middleDir, ".guild", "workspace.json"),
      "{ this is not valid JSON %%% "
    );

    const { config, sources } = resolveSettings({ cwd: childDir });

    // Should have found the outer workspace and inherited agent_mode
    expect(config.agent_mode).toBe("team");
    expect(sources.agent_mode).toBe("workspace");
  });

  test("workspace.json with is_workspace:false still stops walk (not treated as parse error)", () => {
    const outerWs = tmpDir();
    const middleDir = path.join(outerWs, "middle");
    const childDir = path.join(middleDir, "plugin");
    mkGuildDir(outerWs);
    fs.mkdirSync(path.join(middleDir, ".guild"), { recursive: true });
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(outerWs, { agent_mode: "team" });
    writeWorkspaceManifest(outerWs, [middleDir]);
    // Middle has is_workspace: false — this is NOT a parse error, should stop
    writeJson(path.join(middleDir, ".guild", "workspace.json"), {
      is_workspace: false,
    });

    const { config, sources } = resolveSettings({ cwd: childDir });

    // is_workspace:false is a deliberate stop — outer not reached
    expect(config.agent_mode).toBe("auto");
    expect(sources.agent_mode).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// Finding 5 — MAJOR: prototype pollution via __proto__ key in settings.local.json.
//   Both validateLocalKeysOrThrow and deepMerge must guard against it.
// ---------------------------------------------------------------------------

describe("F5 — prototype pollution prevention in settings.local.json", () => {
  test("__proto__ key in settings.local.json is rejected — no prototype pollution", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "standard" });
    // Write a malicious local file with __proto__ key (raw write to bypass JSON.stringify safety)
    fs.writeFileSync(
      path.join(dir, ".guild", "settings.local.json"),
      '{"__proto__": {"polluted": true}}'
    );

    // Must not throw (library is silent), must not pollute prototype
    const before = (Object.prototype as Record<string, unknown>)["polluted"];
    resolveSettings({ cwd: dir });
    const after = (Object.prototype as Record<string, unknown>)["polluted"];

    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });

  test("prototype key in settings.local.json is rejected — no pollution", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "standard" });
    fs.writeFileSync(
      path.join(dir, ".guild", "settings.local.json"),
      '{"prototype": {"polluted2": true}}'
    );

    const before = (Object.prototype as Record<string, unknown>)["polluted2"];
    resolveSettings({ cwd: dir });
    const after = (Object.prototype as Record<string, unknown>)["polluted2"];

    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });

  test("constructor key in settings.local.json is rejected — no pollution", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "standard" });
    fs.writeFileSync(
      path.join(dir, ".guild", "settings.local.json"),
      '{"constructor": {"polluted3": true}}'
    );

    const before = (Object.prototype as Record<string, unknown>)["polluted3"];
    resolveSettings({ cwd: dir });
    const after = (Object.prototype as Record<string, unknown>)["polluted3"];

    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });

  test("nested __proto__ inside a valid key is also blocked", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "standard" });
    // Nested pollution attempt via defaults block
    fs.writeFileSync(
      path.join(dir, ".guild", "settings.local.json"),
      '{"defaults": {"__proto__": {"nestedPolluted": true}}}'
    );

    const before = (Object.prototype as Record<string, unknown>)["nestedPolluted"];
    resolveSettings({ cwd: dir });
    const after = (Object.prototype as Record<string, unknown>)["nestedPolluted"];

    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Finding 6 — MINOR: when rigor fills loops and loop_cap, their source entries
//   must also be tagged 'rigor', not left as 'builtin' or prior-layer.
// ---------------------------------------------------------------------------

describe("F6 — rigor expansion tags loops, loop_cap, AND review as source=rigor", () => {
  test("rigor from workspace layer → sources.loops/loop_cap/review all report rigor", () => {
    const wsRoot = tmpDir();
    const childDir = path.join(wsRoot, "plugin");
    mkGuildDir(wsRoot);
    fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
    writeSettings(wsRoot, { rigor: "deep" });
    writeWorkspaceManifest(wsRoot, [childDir]);
    // child has no settings.json — rigor inherited from workspace

    const { config, sources } = resolveSettings({ cwd: childDir });

    expect(config.loops).toBe("all");
    expect(sources.loops).toBe("rigor");
    expect(sources.loop_cap).toBe("rigor");
    expect(sources.review).toBe("rigor");
  });

  test("rigor from project settings.json → sources.loops/loop_cap/review = rigor", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "deep" });

    const { config, sources } = resolveSettings({ cwd: dir });

    expect(config.loops).toBe("all");
    expect(sources.loops).toBe("rigor");
    expect(sources.loop_cap).toBe("rigor");
    expect(sources.review).toBe("rigor");
  });

  test("rigor=quick from project → loops/review tagged rigor (loop_cap N/A for quick)", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "quick" });

    const { sources, config } = resolveSettings({ cwd: dir });

    expect(config.loops).toBe("none");
    expect(sources.loops).toBe("rigor");
    expect(sources.review).toBe("rigor");
    // loop_cap is N/A for quick (not applied by the profile)
  });

  test("explicit loops in settings.json beats rigor → loops source stays project, not rigor", () => {
    const dir = tmpDir();
    mkGuildDir(dir);
    writeSettings(dir, { rigor: "deep", loops: "none" });

    const { sources } = resolveSettings({ cwd: dir });

    // loops was set explicitly — should NOT be tagged rigor
    expect(sources.loops).toBe("project");
    // review and loop_cap still derived from rigor
    expect(sources.review).toBe("rigor");
    expect(sources.loop_cap).toBe("rigor");
  });
});
