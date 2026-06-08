/**
 * scripts/__tests__/write-host-capability.test.ts
 *
 * RE-5 — host-capability manifest writer.
 *
 * Covers:
 *   - buildCapability resolves host kind (claude|codex) from arg/env.
 *   - schema_version + all guild.host_capability.v1 keys present.
 *   - tiers fall back to the built-in ladder, or read settings.json models.tiers.
 *   - tool_support: subagent always true; tmux/agent_team follow the probe;
 *     independent_agents follows the claude/codex heuristic + env override.
 *   - writeHostCapability writes .guild/hosts/<host-id>/capability.json,
 *     idempotently, and never creates .guild/wiki/.
 *   - CLI smoke: writes the file and prints its path.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCapability,
  writeHostCapability,
  type HostCapabilityManifest,
} from "../write-host-capability";

const SCRIPT = path.resolve(__dirname, "../write-host-capability.ts");
const NODE_ENV = { ...process.env, NODE_NO_WARNINGS: "1", PATH: "/opt/homebrew/bin:/usr/bin:/bin" } as NodeJS.ProcessEnv;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-hostcap-"));
}

function readManifest(root: string, hostId: string): HostCapabilityManifest {
  return JSON.parse(
    fs.readFileSync(path.join(root, ".guild", "hosts", hostId, "capability.json"), "utf8")
  );
}

describe("write-host-capability — buildCapability (RE-5)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("defaults to host_kind=claude with the built-in tier ladder", () => {
    const m = buildCapability({ cwd: mkRoot(), env: {}, probeTmux: () => false });
    expect(m.schema_version).toBe("guild.host_capability.v1");
    expect(m.host_kind).toBe("claude");
    // TE-07: canonical field names
    expect(m.tier_models).toEqual({ cheap: "haiku", mid: "sonnet", powerful: "opus" });
    expect(m.supported_tiers).toEqual(["cheap", "mid", "powerful"]);
    expect(m.host_id).toBe("claude");
  });

  it("has all required guild.host_capability.v1 top-level keys", () => {
    const m = buildCapability({ cwd: mkRoot(), env: {}, probeTmux: () => false }) as unknown as Record<string, unknown>;
    // TE-07: canonical ADR field names (advertised_at, tier_models, supported_tiers)
    for (const k of ["schema_version", "host_id", "host_kind", "advertised_at", "source", "tier_models", "supported_tiers", "models", "tool_support"]) {
      expect(m).toHaveProperty(k);
    }
  });

  it("resolves host_kind=codex from --host arg", () => {
    const m = buildCapability({ cwd: mkRoot(), host: "codex", env: {}, probeTmux: () => false });
    expect(m.host_kind).toBe("codex");
  });

  it("resolves host_kind from GUILD_HOST env (codex), auto/unset → claude", () => {
    expect(buildCapability({ cwd: mkRoot(), env: { GUILD_HOST: "codex" }, probeTmux: () => false }).host_kind).toBe("codex");
    expect(buildCapability({ cwd: mkRoot(), env: { GUILD_HOST: "auto" }, probeTmux: () => false }).host_kind).toBe("claude");
  });

  it("host_id can be overridden via GUILD_HOST_ID env", () => {
    const m = buildCapability({ cwd: mkRoot(), env: { GUILD_HOST_ID: "claude-laptop-7" }, probeTmux: () => false });
    expect(m.host_id).toBe("claude-laptop-7");
  });

  it("reads models.tiers + models.list from .guild/settings.json when present", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({
        models: {
          tiers: { cheap: "haiku-3", mid: "sonnet-4", powerful: "opus-4" },
          list: ["haiku-3", "sonnet-4", "opus-4", "extra-model"],
        },
      })
    );
    const m = buildCapability({ cwd: root, env: {}, probeTmux: () => false });
    // TE-07: canonical field name tier_models
    expect(m.tier_models).toEqual({ cheap: "haiku-3", mid: "sonnet-4", powerful: "opus-4" });
    expect(m.models).toContain("extra-model");
  });

  it("falls back to tier values for models when settings has no list", () => {
    const m = buildCapability({ cwd: mkRoot(), env: {}, probeTmux: () => false });
    expect(m.models.sort()).toEqual(["haiku", "opus", "sonnet"]);
  });

  it("tool_support: subagent always true; tmux/agent_team follow the probe", () => {
    const withTmux = buildCapability({ cwd: mkRoot(), env: {}, probeTmux: () => true });
    expect(withTmux.tool_support.subagent).toBe(true);
    expect(withTmux.tool_support.tmux).toBe(true);
    expect(withTmux.tool_support.agent_team).toBe(true);

    const noTmux = buildCapability({ cwd: mkRoot(), env: {}, probeTmux: () => false });
    expect(noTmux.tool_support.tmux).toBe(false);
    expect(noTmux.tool_support.agent_team).toBe(false);
    expect(noTmux.tool_support.subagent).toBe(true);
  });

  it("independent_agents: claude→true, codex→false, env override wins", () => {
    expect(buildCapability({ cwd: mkRoot(), host: "claude", env: {}, probeTmux: () => false }).tool_support.independent_agents).toBe(true);
    expect(buildCapability({ cwd: mkRoot(), host: "codex", env: {}, probeTmux: () => false }).tool_support.independent_agents).toBe(false);
    expect(
      buildCapability({ cwd: mkRoot(), host: "codex", env: { GUILD_INDEPENDENT_AGENTS_SUPPORTED: "1" }, probeTmux: () => false }).tool_support.independent_agents
    ).toBe(true);
    expect(
      buildCapability({ cwd: mkRoot(), host: "claude", env: { GUILD_INDEPENDENT_AGENTS_SUPPORTED: "off" }, probeTmux: () => false }).tool_support.independent_agents
    ).toBe(false);
  });

  // HK-07: pre_tool_use_ask matrix — only claude gets true; all others degrade.
  it("pre_tool_use_ask: claude→true, all other HostKind values→false", () => {
    const mk = (host: Parameters<typeof buildCapability>[0]["host"]) =>
      buildCapability({ cwd: mkRoot(), host, env: {}, probeTmux: () => false }).tool_support.pre_tool_use_ask;
    expect(mk("claude")).toBe(true);
    expect(mk("codex")).toBe(false);
    expect(mk("gemini")).toBe(false);
    expect(mk("pi")).toBe(false);
    expect(mk("antigravity-2")).toBe(false);
    expect(mk("claude-code-desktop")).toBe(false);
    expect(mk("claude-code-web")).toBe(false);
    expect(mk("codex-app")).toBe(false);
    expect(mk("claude-ai-connector")).toBe(false);
  });

  it("pre_tool_use_ask: resolves via GUILD_HOST env (gemini→false, pi→false)", () => {
    expect(
      buildCapability({ cwd: mkRoot(), env: { GUILD_HOST: "gemini" }, probeTmux: () => false }).tool_support.pre_tool_use_ask
    ).toBe(false);
    expect(
      buildCapability({ cwd: mkRoot(), env: { GUILD_HOST: "pi" }, probeTmux: () => false }).tool_support.pre_tool_use_ask
    ).toBe(false);
  });

  it("resolves host_kind=gemini from --host arg and GUILD_HOST env", () => {
    expect(buildCapability({ cwd: mkRoot(), host: "gemini", env: {}, probeTmux: () => false }).host_kind).toBe("gemini");
    expect(buildCapability({ cwd: mkRoot(), env: { GUILD_HOST: "gemini" }, probeTmux: () => false }).host_kind).toBe("gemini");
  });

  it("resolves host_kind=pi from --host arg and GUILD_HOST env", () => {
    expect(buildCapability({ cwd: mkRoot(), host: "pi", env: {}, probeTmux: () => false }).host_kind).toBe("pi");
    expect(buildCapability({ cwd: mkRoot(), env: { GUILD_HOST: "pi" }, probeTmux: () => false }).host_kind).toBe("pi");
  });
});

describe("write-host-capability — writeHostCapability (RE-5)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("writes .guild/hosts/<host-id>/capability.json and returns its path", () => {
    const root = mkRoot();
    const out = writeHostCapability({ cwd: root, env: {}, probeTmux: () => false });
    expect(out).toBe(path.join(root, ".guild", "hosts", "claude", "capability.json"));
    expect(fs.existsSync(out)).toBe(true);
    expect(readManifest(root, "claude").schema_version).toBe("guild.host_capability.v1");
  });

  it("uses host_id in the directory path", () => {
    const root = mkRoot();
    writeHostCapability({ cwd: root, hostId: "codex-ci", host: "codex", env: {}, probeTmux: () => false });
    expect(fs.existsSync(path.join(root, ".guild", "hosts", "codex-ci", "capability.json"))).toBe(true);
  });

  it("idempotent: re-running refreshes without error and keeps schema stable", () => {
    const root = mkRoot();
    writeHostCapability({ cwd: root, env: {}, probeTmux: () => false });
    const first = readManifest(root, "claude");
    writeHostCapability({ cwd: root, env: {}, probeTmux: () => false });
    const second = readManifest(root, "claude");
    expect(second.schema_version).toBe(first.schema_version);
    expect(second.host_id).toBe(first.host_id);
  });

  it("never creates .guild/wiki/", () => {
    const root = mkRoot();
    writeHostCapability({ cwd: root, env: {}, probeTmux: () => false });
    expect(fs.existsSync(path.join(root, ".guild", "wiki"))).toBe(false);
  });

  it("CLI: writes the file and prints its path", () => {
    const root = mkRoot();
    const r = spawnSync("npx", ["tsx", SCRIPT, "--cwd", root, "--host", "claude"], {
      encoding: "utf8",
      env: NODE_ENV,
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toContain(path.join(".guild", "hosts", "claude", "capability.json"));
    expect(fs.existsSync(path.join(root, ".guild", "hosts", "claude", "capability.json"))).toBe(true);
  });

  it("CLI: exits non-zero when --cwd is not a directory", () => {
    const r = spawnSync("npx", ["tsx", SCRIPT, "--cwd", "/tmp/guild-nonexistent-hostcap-zzz"], {
      encoding: "utf8",
      env: NODE_ENV,
      timeout: 30000,
    });
    expect(r.status).not.toBe(0);
  });
});
