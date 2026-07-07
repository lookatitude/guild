/**
 * scripts/__tests__/config-inheritance-fixtures.test.ts
 *
 * init-config-goal lane L5 (§V / V8) — workspace→child inheritance FIXTURES.
 *
 * Proves the resolver's documented inheritance policy as concrete fixtures a host
 * config-UI surface depends on (the `source` column it renders is exactly this
 * layering): workspace→child precedence, deep-merge of nested objects, wholesale
 * array REPLACEMENT (not merge), role-pin + model-tier deep-merge, team/loop caps,
 * cross-host/security/MCP inheritance, the non-inheritable keys (workspace.mode,
 * initiative_default), and the full local-layer ordering
 * (project-local > project > workspace-local > workspace > builtin).
 *
 * Anti-vacuity (spec §V8): every fixture pins BOTH the winning layer's value AND
 * the value it must NOT take (the losing layer), so silently breaking the merge —
 * inheriting the wrong layer, merging an array instead of replacing it, or letting a
 * non-inheritable key leak workspace→child — fails the assertion. A dedicated
 * mutate-and-confirm test proves the fixtures are not vacuously green.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveSettings, type Source } from "../lib/settings-resolver";

// ---------------------------------------------------------------------------
// Fixture scaffolding (mirrors settings-resolver.test.ts conventions)
// ---------------------------------------------------------------------------

const TMPDIRS: string[] = [];
afterAll(() => {
  for (const d of TMPDIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function writeJson(filePath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

interface WsFixture {
  /** workspace-root .guild/settings.json */
  ws?: Record<string, unknown>;
  /** workspace-root .guild/settings.local.json */
  wsLocal?: Record<string, unknown>;
  /** child .guild/settings.json */
  child?: Record<string, unknown>;
  /** child .guild/settings.local.json */
  childLocal?: Record<string, unknown>;
}

/**
 * Build a workspace root with a child sub-project and return both paths. The
 * workspace.json (is_workspace:true) is what `discoverWorkspace` walks up to find.
 */
function mkWorkspaceChild(fx: WsFixture): { wsRoot: string; child: string } {
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-inherit-ws-"));
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
  return { wsRoot, child };
}

// ===========================================================================
// V8.1 — workspace→child scalar precedence
// ===========================================================================

describe("V8.1 — workspace→child scalar precedence", () => {
  it("child inherits a workspace scalar, with source=workspace", () => {
    const { child } = mkWorkspaceChild({ ws: { rigor: "deep" } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.rigor).toBe("deep");
    expect(sources.rigor as Source).toBe("workspace");
  });

  it("child's own scalar OVERRIDES the workspace value (source=project)", () => {
    const { child } = mkWorkspaceChild({ ws: { rigor: "deep" }, child: { rigor: "quick" } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.rigor).toBe("quick");
    expect(config.rigor).not.toBe("deep"); // anti-vacuity: workspace must NOT win
    expect(sources.rigor as Source).toBe("project");
  });
});

// ===========================================================================
// V8.2 — nested objects deep-merge (sibling sub-keys survive)
// ===========================================================================

describe("V8.2 — nested objects deep-merge across workspace→child", () => {
  it("a child sub-key override keeps the workspace sibling sub-keys", () => {
    const { child } = mkWorkspaceChild({
      ws: { models: { thresholds: { mid: 5, powerful: 9 }, scoreWeights: { security: 3 } } },
      child: { models: { thresholds: { mid: 7 } } },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.models.thresholds.mid).toBe(7); // child wins
    expect(config.models.thresholds.mid).not.toBe(5); // anti-vacuity
    expect(config.models.thresholds.powerful).toBe(9); // workspace sibling preserved (deep merge)
    expect(config.models.scoreWeights.security).toBe(3); // workspace-only sub-block preserved
  });
});

// ===========================================================================
// V8.3 — arrays REPLACE wholesale (never merge — Decision F.2)
// ===========================================================================

describe("V8.3 — arrays replace wholesale, never merge", () => {
  it("child auto_approve replaces (not concatenates) the workspace array", () => {
    const { child } = mkWorkspaceChild({
      ws: { auto_approve: ["spec", "plan"] },
      child: { auto_approve: ["qa"] },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.auto_approve).toEqual(["qa"]); // wholesale replacement
    expect(config.auto_approve).not.toContain("spec"); // anti-vacuity: not merged
    expect(config.auto_approve).not.toContain("plan");
  });

  it("a string-array under a nested block also replaces wholesale", () => {
    const { child } = mkWorkspaceChild({
      ws: { secrets_policy: { env_allowlist: ["A", "B"] } },
      child: { secrets_policy: { env_allowlist: ["C"] } },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.secrets_policy.env_allowlist).toEqual(["C"]);
    expect(config.secrets_policy.env_allowlist).not.toContain("A");
  });
});

// ===========================================================================
// V8.4 — role pins + model tiers deep-merge across layers
// ===========================================================================

describe("V8.4 — role pins + model tiers deep-merge", () => {
  it("workspace role pin + child role pin both survive (object deep-merge)", () => {
    const { child } = mkWorkspaceChild({
      ws: { roles: { host: "claude-code-cli" } },
      child: { roles: { advisory: "codex-cli" } },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.roles.host).toBe("claude-code-cli"); // inherited
    expect(config.roles.advisory).toBe("codex-cli"); // child's own
  });

  it("model tiers merge per host; a same-cell child value overrides the workspace one", () => {
    const { child } = mkWorkspaceChild({
      ws: { models: { tiers: { cheap: { "claude-code-cli": "haiku" } } } },
      child: { models: { tiers: { mid: { "codex-cli": "o4" }, cheap: { "claude-code-cli": "sonnet" } } } },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.models.tiers.cheap["claude-code-cli"]).toBe("sonnet"); // same cell → child wins
    expect(config.models.tiers.cheap["claude-code-cli"]).not.toBe("haiku"); // anti-vacuity
    expect(config.models.tiers.mid["codex-cli"]).toBe("o4"); // child-only cell present
  });
});

// ===========================================================================
// V8.5 — team / loop caps inheritance
// ===========================================================================

describe("V8.5 — team + loop caps inheritance", () => {
  it("child inherits team size but overrides loop_cap", () => {
    const { child } = mkWorkspaceChild({
      ws: { defaults: { team: { size: 6 } }, loop_cap: 10 },
      child: { loop_cap: 4 },
    });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.defaults.team.size).toBe(6); // inherited
    expect(config.loop_cap).toBe(4); // child wins
    expect(config.loop_cap).not.toBe(10); // anti-vacuity
    expect(sources.loop_cap as Source).toBe("project");
  });
});

// ===========================================================================
// V8.6 — cross-host / security / MCP inheritance
// ===========================================================================

describe("V8.6 — cross-host / security / mcp inheritance", () => {
  it("cross_host.hosts deep-merges entries; enabled inherits", () => {
    const { child } = mkWorkspaceChild({
      ws: { defaults: { cross_host: { enabled: true, hosts: { a: { address: "10.0.0.1" } } } } },
      child: { defaults: { cross_host: { hosts: { b: { address: "10.0.0.2" } } } } },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.defaults.cross_host.enabled).toBe(true); // inherited
    expect(config.defaults.cross_host.hosts.a).toEqual({ address: "10.0.0.1" }); // workspace entry
    expect(config.defaults.cross_host.hosts.b).toEqual({ address: "10.0.0.2" }); // child entry
  });

  it("security policy inherits; mcp transport flags deep-merge", () => {
    const { child } = mkWorkspaceChild({
      ws: { security: { bypass_permissions_policy: "audit" }, mcp: { stdio_available: true } },
      child: { mcp: { http_available: true } },
    });
    const { config } = resolveSettings({ cwd: child });
    expect(config.security.bypass_permissions_policy).toBe("audit"); // inherited
    expect(config.mcp.stdio_available).toBe(true); // workspace flag preserved
    expect(config.mcp.http_available).toBe(true); // child flag
  });
});

// ===========================================================================
// V8.7 — non-inheritable keys do NOT leak workspace→child
// ===========================================================================

describe("V8.7 — non-inheritable keys (workspace.mode, initiative_default)", () => {
  it("workspace.mode is detection-only — NOT inherited by the child", () => {
    const { child } = mkWorkspaceChild({ ws: { workspace: { mode: "on" } } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.workspace.mode).toBe("auto"); // built-in default, NOT "on"
    expect(config.workspace.mode).not.toBe("on"); // anti-vacuity
    expect(sources["workspace.mode"] as Source).toBe("builtin");
  });

  it("a non-workspace-scoped initiative_default does NOT inherit (safe default null)", () => {
    const { child } = mkWorkspaceChild({ ws: { initiative_default: "some-init" } });
    const { config } = resolveSettings({ cwd: child });
    expect(config.initiative_default).toBeNull();
  });

  it("the child's OWN workspace.mode still applies to the child", () => {
    const { child } = mkWorkspaceChild({ ws: { workspace: { mode: "on" } }, child: { workspace: { mode: "off" } } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.workspace.mode).toBe("off");
    expect(sources["workspace.mode"] as Source).toBe("project");
  });
});

// ===========================================================================
// V8.8 — full local-layer ordering
//   project-local > project > workspace-local > workspace > builtin
// ===========================================================================

describe("V8.8 — local-layer ordering (4-layer precedence)", () => {
  it("project-local wins over project over workspace-local over workspace", () => {
    const { child } = mkWorkspaceChild({
      ws: { loop_cap: 10 },
      wsLocal: { loop_cap: 11 },
      child: { loop_cap: 12 },
      childLocal: { loop_cap: 13 },
    });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.loop_cap).toBe(13);
    expect(sources.loop_cap as Source).toBe("project-local");
  });

  it("dropping the top layer falls through to the next (project)", () => {
    const { child } = mkWorkspaceChild({
      ws: { loop_cap: 10 },
      wsLocal: { loop_cap: 11 },
      child: { loop_cap: 12 },
    });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.loop_cap).toBe(12);
    expect(sources.loop_cap as Source).toBe("project");
  });

  it("dropping project + project-local falls through to workspace-local", () => {
    const { child } = mkWorkspaceChild({ ws: { loop_cap: 10 }, wsLocal: { loop_cap: 11 } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.loop_cap).toBe(11);
    expect(sources.loop_cap as Source).toBe("workspace-local");
  });

  it("only the workspace layer set → workspace wins", () => {
    const { child } = mkWorkspaceChild({ ws: { loop_cap: 10 } });
    const { config, sources } = resolveSettings({ cwd: child });
    expect(config.loop_cap).toBe(10);
    expect(sources.loop_cap as Source).toBe("workspace");
  });
});

// ===========================================================================
// V8.9 — anti-vacuity proof: a wrong expectation actually FAILS
// ===========================================================================

describe("V8.9 — fixtures are non-vacuous (mutate-and-confirm)", () => {
  it("asserting the LOSING layer's value throws (the merge is genuinely tested)", () => {
    const { child } = mkWorkspaceChild({
      ws: { models: { thresholds: { mid: 5, powerful: 9 } } },
      child: { models: { thresholds: { mid: 7 } } },
    });
    const { config } = resolveSettings({ cwd: child });
    // The real value is 7 (child). Asserting the workspace value (5) MUST fail —
    // proving V8.2 is not vacuously green.
    expect(() => expect(config.models.thresholds.mid).toBe(5)).toThrow();
    // And asserting a merged array (instead of replacement) MUST fail.
    const arr = mkWorkspaceChild({ ws: { auto_approve: ["spec"] }, child: { auto_approve: ["qa"] } });
    const merged = resolveSettings({ cwd: arr.child }).config.auto_approve;
    expect(() => expect(merged).toEqual(["spec", "qa"])).toThrow();
  });
});
