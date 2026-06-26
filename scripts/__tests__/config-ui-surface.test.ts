/**
 * scripts/__tests__/config-ui-surface.test.ts
 *
 * init-config-goal lane L4 (§E11/§E12 / V10) — the host-adapter CONFIG-UI presentation
 * core + the `config ui` CLI surface.
 *
 * Coverage:
 *   §E11 render — grouped keys/values/sources driven by CONFIG_UI_METADATA; reuses the
 *     config-render HostConfigRender; secret keys never echo; app/connector hosts blocked.
 *   §E12 persist — planConfigUiEdit gates on the metadata's confirmation-strength and
 *     scope_support and performs NO write; the `config ui set` CLI routes the write through
 *     the plugin config API (validate-before-write, never-clobber) and reloads.
 *   V10 boundary — `config ui set` is dispatched with a SPIED config-write seam, proving it
 *     (a) invokes the write API exactly once with the resolved scope/key/value and (b) the
 *     adapter path mutates no fs itself; a direct-fs rewire COUNTEREXAMPLE proves the assertions
 *     are non-vacuous. Plus validate-before-persist and reload-failure→NONZERO (V12).
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildHostConfigUiSurface,
  planConfigUiEdit,
  parseConfirmation,
  requiredConfirmationFor,
  sourceForKey,
  getByPath,
  SECRET_MASK,
  CONFIG_UI_GROUP_ORDER,
} from "../lib/config-ui-surface";
import type { ConfigSource } from "../lib/config-render";
import { cmdUiSet, type UiSetDeps } from "../config-cmd";

const NOW = "2026-06-26T00:00:00Z";

function baseConfig(): Record<string, unknown> {
  return {
    rigor: "deep",
    review: "cross",
    models: {
      tiers: {
        cheap: { "claude-code-cli": "haiku" },
        mid: { "claude-code-cli": "sonnet" },
        powerful: { "claude-code-cli": "opus" },
      },
    },
    security: { bypass_permissions_policy: "audit" },
    auto_approve: [],
    secrets_policy: { redaction_patterns: ["sk-SHOULD-NEVER-ECHO"] },
  };
}

// ---------------------------------------------------------------------------
// §E11 — render
// ---------------------------------------------------------------------------

describe("buildHostConfigUiSurface — §E11 native render", () => {
  it("renders a CLI host as a non-blocked grouped surface with the registry identity", () => {
    const s = buildHostConfigUiSurface({
      host: "claude-code-cli",
      config: baseConfig(),
      renderedAt: NOW,
    });
    expect(s.blocked).toBe(false);
    expect(s.advisory).toBe("ready");
    expect(s.family).toBe("claude");
    expect(s.surface_kind).toBe("cli");
    expect(s.schema_version).toBe("guild.host_config_ui.v1");
    expect(s.key_count).toBeGreaterThan(0);
    expect(s.groups.length).toBeGreaterThan(0);
    // groups are in the fixed display order
    const idx = s.groups.map((g) => CONFIG_UI_GROUP_ORDER.indexOf(g.group));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("renders ALL CLI/agents-file native hosts (none blocked)", () => {
    for (const host of ["claude-code-cli", "codex-cli", "pi-cli", "antigravity-cli", "agents-file"]) {
      const s = buildHostConfigUiSurface({ host, config: baseConfig(), renderedAt: NOW });
      expect(s.blocked).toBe(false);
      expect(s.native_render).not.toBeNull();
      expect(s.native_render!.host_id).toBe(host);
    }
  });

  it("blocks app/connector hosts (no false-native path) — mirrors hostOpenPreflight", () => {
    for (const host of ["claude-code-app", "claude-code-web", "codex-app", "claude-ai-connector"]) {
      const s = buildHostConfigUiSurface({ host, config: baseConfig(), renderedAt: NOW });
      expect(s.blocked).toBe(true);
      expect(s.advisory).toBe("host_unsupported");
      expect(s.groups).toEqual([]);
      expect(s.key_count).toBe(0);
      expect(s.native_render).toBeNull();
    }
  });

  it("reuses the config-render HostConfigRender as the embedded native projection", () => {
    const s = buildHostConfigUiSurface({
      host: "claude-code-cli",
      config: baseConfig(),
      renderedAt: NOW,
    });
    expect(s.native_render).not.toBeNull();
    expect(s.native_render!.schema_version).toBe("guild.host_config_render.v1");
    expect(s.native_render!.models).toEqual({ cheap: "haiku", mid: "sonnet", powerful: "opus" });
  });

  it("NEVER echoes a secret / replace_only value — masks it", () => {
    const s = buildHostConfigUiSurface({
      host: "claude-code-cli",
      config: baseConfig(),
      renderedAt: NOW,
      groupFilter: "safety_platform",
    });
    const secret = s.groups
      .flatMap((g) => g.keys)
      .find((k) => k.key === "secrets_policy.redaction_patterns");
    expect(secret).toBeDefined();
    expect(secret!.redacted).toBe(true);
    expect(secret!.value).toBe(SECRET_MASK);
    // the raw secret must appear nowhere in the serialized surface
    expect(JSON.stringify(s)).not.toContain("sk-SHOULD-NEVER-ECHO");
  });

  it("groupFilter restricts the surface to one group", () => {
    const s = buildHostConfigUiSurface({
      host: "claude-code-cli",
      config: baseConfig(),
      renderedAt: NOW,
      groupFilter: "startup",
    });
    expect(s.groups.length).toBe(1);
    expect(s.groups[0].group).toBe("startup");
  });

  it("resolves value + winning inheritance layer per key", () => {
    const sources: Record<string, ConfigSource> = { rigor: "project", review: "cli" };
    const s = buildHostConfigUiSurface({
      host: "claude-code-cli",
      config: baseConfig(),
      sources,
      renderedAt: NOW,
      groupFilter: "startup",
    });
    const rigor = s.groups[0].keys.find((k) => k.key === "rigor")!;
    expect(rigor.value).toBe("deep");
    expect(rigor.source).toBe("project");
    const review = s.groups[0].keys.find((k) => k.key === "review")!;
    expect(review.source).toBe("cli");
  });
});

describe("value/source helpers", () => {
  it("getByPath reads dotted keys (incl. host-id segments)", () => {
    expect(getByPath(baseConfig(), "models.tiers.cheap.claude-code-cli")).toBe("haiku");
    expect(getByPath(baseConfig(), "does.not.exist")).toBeUndefined();
  });

  it("sourceForKey walks ancestors, defaults to builtin", () => {
    const sources: Record<string, ConfigSource> = { defaults: "workspace" };
    expect(sourceForKey("defaults.team.size", sources)).toBe("workspace");
    expect(sourceForKey("rigor", sources)).toBe("builtin");
    expect(sourceForKey("rigor", undefined)).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// §E12 — edit planning (confirmation-strength gate, NO write)
// ---------------------------------------------------------------------------

describe("planConfigUiEdit — §E12 confirmation gate (no mutation)", () => {
  it("a normal key is auto-satisfied without an explicit confirmation", () => {
    const plan = planConfigUiEdit({ key: "rigor", scope: "project" });
    expect(plan.ok).toBe(true);
    expect(plan.confirmation_required).toBe(false);
    expect(plan.required_confirmation).toBe("normal");
  });

  it("a danger key REQUIRES a danger confirmation", () => {
    expect(planConfigUiEdit({ key: "review", scope: "project" }).ok).toBe(false);
    expect(
      planConfigUiEdit({ key: "review", scope: "project", providedConfirmation: "danger" }).ok
    ).toBe(true);
    // a weaker confirmation is rejected
    expect(
      planConfigUiEdit({ key: "review", scope: "project", providedConfirmation: "advanced" }).ok
    ).toBe(false);
  });

  it("a security_sensitive key REQUIRES strongest", () => {
    expect(
      planConfigUiEdit({ key: "codex_skip_enforcement", scope: "project", providedConfirmation: "danger" }).ok
    ).toBe(false);
    expect(
      planConfigUiEdit({ key: "codex_skip_enforcement", scope: "project", providedConfirmation: "strongest" }).ok
    ).toBe(true);
  });

  it("rejects a scope not in the key's scope_support", () => {
    const plan = planConfigUiEdit({ key: "workspace.mode", scope: "workspace", providedConfirmation: "strongest" });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/scope "workspace" is not supported/);
  });

  it("rejects an unknown key", () => {
    const plan = planConfigUiEdit({ key: "nope.nope", scope: "project" });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/unknown config key/);
  });

  it("requiredConfirmationFor mirrors the metadata", () => {
    expect(requiredConfirmationFor("review")).toBe("danger");
    expect(requiredConfirmationFor("codex_skip_enforcement")).toBe("strongest");
    expect(requiredConfirmationFor("nope")).toBeUndefined();
  });

  it("parseConfirmation accepts known tokens, rejects junk", () => {
    expect(parseConfirmation("strongest")).toBe("strongest");
    expect(parseConfirmation("bogus")).toBeUndefined();
    expect(parseConfirmation(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// V10 — `config ui set` routes its write THROUGH the config API; the adapter
// mutates no fs of its own. This is the real boundary proof: it injects/spies the
// config write seam and asserts (a) it is invoked exactly once with the resolved
// scope/key/value, and (b) the adapter/command path performs NO direct fs write.
// A COUNTEREXAMPLE proves the assertions are non-vacuous: a direct-fs rewire is caught.
// ---------------------------------------------------------------------------

describe("V10 — `config ui set` routes through the config API (boundary proof)", () => {
  /** A reload seam that returns a synthetic resolved config (no I/O) — keeps the unit pure. */
  function fakeReload(value: unknown): UiSetDeps["reload"] {
    return () => ({ config: { rigor: value }, sources: { rigor: "project" } });
  }

  it("invokes the config write API EXACTLY once with the resolved scope/key/value, and the adapter writes no fs itself", () => {
    const dir = mkProject({});
    // Spy fs.writeFileSync AFTER project scaffolding so only adapter-path writes are observed.
    const fsWriteSpy = jest.spyOn(fs, "writeFileSync");
    const persistSpy = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(() => 0);

    const rc = cmdUiSet(dir, "rigor", "deep", "project", undefined, undefined, {
      persist: persistSpy,
      reload: fakeReload("deep"),
    });

    expect(rc).toBe(0);
    // (a) the config write API was invoked exactly once with the resolved scope/key/value
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith("rigor", "deep", "project", dir);
    // (b) the adapter/command path performed NO direct fs mutation — the seam owns every write
    expect(fsWriteSpy).not.toHaveBeenCalled();

    fsWriteSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("COUNTEREXAMPLE — a direct-fs `ui set` rewire FAILS the same boundary assertions (proof is non-vacuous)", () => {
    const dir = mkProject({});
    const fsWriteSpy = jest.spyOn(fs, "writeFileSync");
    // A persist seam standing in for a REWIRED `ui set` that bypasses the config API and writes
    // settings.json DIRECTLY — the exact V10 anti-pattern. It is NOT the routed config API.
    const directFsRewire = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>((k, v, _s, c) => {
      fs.writeFileSync(
        path.join(c, ".guild", "settings.json"),
        JSON.stringify({ [k]: v }, null, 2)
      );
      return 0;
    });

    cmdUiSet(dir, "rigor", "deep", "project", undefined, undefined, {
      persist: directFsRewire,
      reload: fakeReload("deep"),
    });

    // The rewire DID mutate fs directly — so the "(b) no direct fs mutation" assertion that the
    // real routed path PASSES would FAIL here. Assert that failure explicitly: the boundary test
    // genuinely distinguishes routed-through-API from a direct-fs write (it is not vacuous).
    expect(fsWriteSpy).toHaveBeenCalled();
    expect(() => expect(fsWriteSpy).not.toHaveBeenCalled()).toThrow();

    fsWriteSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("VALIDATE-BEFORE-PERSIST — an invalid candidate is rejected BEFORE the write API is called (no half-applied state)", () => {
    const dir = mkProject({});
    const persistSpy = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(() => 0);

    const rc = cmdUiSet(dir, "rigor", "bogus", "project", undefined, undefined, {
      persist: persistSpy,
      reload: fakeReload("bogus"),
    });

    expect(rc).toBe(1); // rejected by validate-before-persist
    expect(persistSpy).not.toHaveBeenCalled(); // the write API was NEVER reached
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("RELOAD FAILURE (V12) — a post-write reload error returns NONZERO, never a swallowed warn", () => {
    const dir = mkProject({});
    const persistSpy = jest.fn<number, [string, string, "workspace" | "project" | "local", string]>(() => 0);
    const writes: string[] = [];
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((s: string | Uint8Array) => {
        writes.push(String(s));
        return true;
      });

    const rc = cmdUiSet(dir, "rigor", "deep", "project", undefined, undefined, {
      persist: persistSpy,
      reload: () => {
        throw new Error("settings file vanished mid-reload");
      },
    });

    stdoutSpy.mockRestore();
    expect(persistSpy).toHaveBeenCalledTimes(1); // the write DID land
    expect(rc).toBe(1); // …but the swallowed reload failure now surfaces as NONZERO
    expect(writes.join("")).toMatch(/post-write reload failed/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("the surface module imports no fs / writeFile surface (secondary static check)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "lib", "config-ui-surface.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']fs["']/);
    expect(src).not.toMatch(/writeFileSync|mkdirSync|appendFileSync/);
  });
});

// ---------------------------------------------------------------------------
// CLI integration — `config ui` routes persistence through the config API
// ---------------------------------------------------------------------------

const SCRIPT = path.resolve(__dirname, "..", "config-cmd.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function runCli(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function mkProject(settings: unknown = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-config-ui-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
  return dir;
}

describe("config ui — CLI surface (§E11/§E12)", () => {
  it("ui list renders grouped keys for a CLI host", () => {
    const dir = mkProject({ rigor: "deep" });
    const r = runCli(["ui", "list", "--group", "startup", "--cwd", dir]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/ui list — host "claude-code-cli"/);
    expect(r.out).toMatch(/rigor/);
    expect(r.out).toMatch(/value=deep\s+\[project\]/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ui list reports BLOCKED for an app host", () => {
    const dir = mkProject();
    const r = runCli(["ui", "list", "--host", "claude-code-app", "--cwd", dir]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/BLOCKED/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ui set refuses a danger key without --confirm and writes NOTHING", () => {
    const dir = mkProject({});
    const r = runCli(["ui", "set", "review", "off", "--scope", "project", "--cwd", dir]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/requires a "danger" confirmation/);
    const after = JSON.parse(fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"));
    expect(after.review).toBeUndefined(); // never persisted
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ui set persists a danger key WITH --confirm and reloads", () => {
    const dir = mkProject({});
    const r = runCli(["ui", "set", "review", "off", "--scope", "project", "--confirm", "danger", "--cwd", dir]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/reloaded: review = "off"\s+\[project\]/);
    const after = JSON.parse(fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"));
    expect(after.review).toBe("off"); // routed through the config API
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ui set never-clobbers an unrelated key (read-modify-write via the config API)", () => {
    const dir = mkProject({ rigor: "deep" });
    const r = runCli(["ui", "set", "review", "off", "--scope", "project", "--confirm", "danger", "--cwd", dir]);
    expect(r.status).toBe(0);
    const after = JSON.parse(fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"));
    expect(after.rigor).toBe("deep"); // preserved
    expect(after.review).toBe("off");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ui set defaults to project scope when --scope is omitted (§E12)", () => {
    const dir = mkProject({});
    const r = runCli(["ui", "set", "rigor", "deep", "--cwd", dir]);
    expect(r.status).toBe(0);
    const after = JSON.parse(fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"));
    expect(after.rigor).toBe("deep"); // written to the project settings.json
    expect(fs.existsSync(path.join(dir, ".guild", "settings.local.json"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ui set rejects an invalid value through the config API validator", () => {
    const dir = mkProject({});
    const r = runCli(["ui", "set", "rigor", "bogus", "--scope", "project", "--cwd", dir]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/invalid value "bogus"/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
