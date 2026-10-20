/**
 * src/domains/config/settings-resolver-leaf-provenance.test.ts
 *
 * Issue #145 — provenance is tracked per dotted LEAF, not per top-level key.
 *
 * In mixed workspace/project inheritance a leaf the project never set must keep
 * the layer its value actually came from: workspace-only -> [workspace]; set in
 * both -> [project]; local -> [project-local]; untouched sibling -> [builtin].
 * Before #145 every leaf under a block the project touched read [project].
 *
 * Anti-vacuity: each fixture pins the winning layer AND the value, and the
 * `every DEFAULTS leaf is stamped` check counts leaves from DEFAULTS itself, so a
 * resolver that stamps only top-level keys fails it.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveSettings } from "./settings-resolver";
import { DEFAULTS } from "./config-defaults";

const TMPDIRS: string[] = [];
afterAll(() => {
  for (const d of TMPDIRS) fs.rmSync(d, { recursive: true, force: true });
});

function writeJson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function mkWorkspaceChild(fx: {
  ws?: Record<string, unknown>;
  wsLocal?: Record<string, unknown>;
  child?: Record<string, unknown>;
  childLocal?: Record<string, unknown>;
}): string {
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-leaf-prov-"));
  TMPDIRS.push(wsRoot);
  const child = path.join(wsRoot, "child");
  fs.mkdirSync(path.join(child, ".guild"), { recursive: true });
  writeJson(path.join(wsRoot, ".guild", "workspace.json"), {
    schema_version: "guild.workspace.v1",
    is_workspace: true,
    sub_guilds: [{ name: "child", path: "child", kind: "sub-guild" }],
  });
  if (fx.ws) writeJson(path.join(wsRoot, ".guild", "settings.json"), fx.ws);
  if (fx.wsLocal) writeJson(path.join(wsRoot, ".guild", "settings.local.json"), fx.wsLocal);
  if (fx.child) writeJson(path.join(child, ".guild", "settings.json"), fx.child);
  if (fx.childLocal) writeJson(path.join(child, ".guild", "settings.local.json"), fx.childLocal);
  return child;
}

function leafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) {
      out.push(...leafPaths(v as Record<string, unknown>, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("#145 — dotted-leaf provenance in mixed workspace/project inheritance", () => {
  // The reviewer's exact case: workspace sets one leaf, project sets a sibling.
  const child = mkWorkspaceChild({
    ws: { defaults: { lifecycle_gate: { enabled: false }, team: { size: 4 } } },
    child: { defaults: { team: { size: 7 }, lean_lead: { enabled: false } } },
  });
  const { config, sources } = resolveSettings({ cwd: child });

  it("workspace-only leaf -> [workspace] (not the project that touched the block)", () => {
    expect(config.defaults.lifecycle_gate.enabled).toBe(false);
    expect(sources["defaults.lifecycle_gate.enabled"]).toBe("workspace");
  });

  it("leaf set in both -> [project]", () => {
    expect(config.defaults.team.size).toBe(7);
    expect(sources["defaults.team.size"]).toBe("project");
  });

  it("project-only leaf -> [project]", () => {
    expect(sources["defaults.lean_lead.enabled"]).toBe("project");
  });

  it("untouched sibling leaf inside a touched block -> [builtin]", () => {
    expect(config.defaults.lifecycle_gate.adhoc_activity_threshold).toBe(20);
    expect(sources["defaults.lifecycle_gate.adhoc_activity_threshold"]).toBe("builtin");
    expect(sources["defaults.auto_learn"]).toBe("builtin");
  });

  it("the block itself still reports the highest layer that contributed to it", () => {
    expect(sources.defaults).toBe("project");
  });

  it("every DEFAULTS leaf carries its own stamp (~140 keys)", () => {
    const leaves = leafPaths(DEFAULTS as unknown as Record<string, unknown>);
    expect(leaves.length).toBeGreaterThan(100);
    const missing = leaves.filter((k) => sources[k] === undefined);
    expect(missing).toEqual([]);
  });
});

describe("#145 — local layers stamp their leaves", () => {
  it("project-local leaf -> [project-local]; project sibling stays [project]", () => {
    const child = mkWorkspaceChild({
      ws: { defaults: { lifecycle_gate: { enabled: false } } },
      child: { defaults: { team: { size: 3 } } },
      childLocal: { defaults: { lifecycle_gate: { enabled: true } } },
    });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.defaults.lifecycle_gate.enabled).toBe(true);
    expect(sources["defaults.lifecycle_gate.enabled"]).toBe("project-local");
    expect(sources["defaults.team.size"]).toBe("project");
  });

  it("workspace-local leaf -> [workspace-local]; workspace sibling stays [workspace]", () => {
    const child = mkWorkspaceChild({
      ws: { defaults: { team: { size: 5 } } },
      wsLocal: { defaults: { lifecycle_gate: { enabled: false } } },
    });
    const { sources } = resolveSettings({ cwd: child });
    expect(sources["defaults.lifecycle_gate.enabled"]).toBe("workspace-local");
    expect(sources["defaults.team.size"]).toBe("workspace");
  });

  it("nested model tiers keep per-host provenance across layers", () => {
    const child = mkWorkspaceChild({
      ws: { models: { tiers: { cheap: { claude: "haiku" } } } },
      child: { models: { tiers: { cheap: { codex: "gpt-mini" } } } },
    });
    const { sources } = resolveSettings({ cwd: child });
    expect(sources["models.tiers.cheap.claude-code-cli"]).toBe("workspace");
    expect(sources["models.tiers.cheap.codex-cli"]).toBe("project");
  });

  it("CLI flags stamp their leaves; untouched siblings keep their layer", () => {
    const child = mkWorkspaceChild({ ws: { defaults: { team: { size: 5 } } } });
    const { sources } = resolveSettings({ cwd: child, flags: { rigor: "deep" } });
    expect(sources.rigor).toBe("cli");
    expect(sources["defaults.team.size"]).toBe("workspace");
  });
});

describe("#145 — derived and coerced leaves keep honest provenance", () => {
  it("index:off forcing defaults.index.enabled labels it with index's layer", () => {
    const child = mkWorkspaceChild({ child: { index: "off" } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.defaults.index.enabled).toBe(false);
    expect(sources["defaults.index.enabled"]).toBe("project");
  });

  it("a project capability block stamps only the fields it sets; workspace siblings survive", () => {
    const child = mkWorkspaceChild({
      ws: { capability: { suggestion_budget: 1 } },
      child: { capability: { resolver_mode: "shadow" } },
    });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.capability.suggestion_budget).toBe(1);
    expect(sources["capability.suggestion_budget"]).toBe("workspace");
    expect(sources["capability.resolver_mode"]).toBe("project");
    expect(sources["capability.auto_create_policy"]).toBe("builtin");
  });

  it("an empty project capability block labels no leaf [project]", () => {
    const child = mkWorkspaceChild({ child: { capability: {} } });
    const { sources } = resolveSettings({ cwd: child });
    expect(sources["capability.resolver_mode"]).toBe("builtin");
    expect(sources["capability.starter_roles"]).toBe("builtin");
  });
});
