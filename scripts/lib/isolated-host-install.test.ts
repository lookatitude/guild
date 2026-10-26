/**
 * scripts/lib/isolated-host-install.test.ts
 *
 * The isolated real-install mode drives the REAL host install path, so these
 * cases stand fake `claude` / `codex` executables in for the hosts. Every case
 * runs against a fixture "real HOME" so the guard and the planted write
 * controls never touch the operator's live config.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ISOLATED_INSTALL_REFUSALS,
  checkIsolatedRoot,
  runIsolatedInstall,
  type IsolatedInstallHost,
} from "./isolated-host-install";

let sandbox: string;
let realHome: string;
let packagesRoot: string;
let isolatedRoot: string;
let binDir: string;

const VERSION = "9.9.9-beta.1";

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "guild-iso-test-")));
  realHome = join(sandbox, "operator-home");
  mkdirSync(join(realHome, ".claude", "plugins"), { recursive: true });
  mkdirSync(join(realHome, ".codex"), { recursive: true });
  writeFileSync(join(realHome, ".claude", "settings.json"), "{}\n");
  writeFileSync(join(realHome, ".codex", "config.toml"), "# live\n");
  packagesRoot = join(sandbox, "packages");
  mkdirSync(join(packagesRoot, "claude-code", ".claude-plugin"), { recursive: true });
  writeFileSync(join(packagesRoot, "claude-code", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "guild" }));
  mkdirSync(join(packagesRoot, "codex-marketplace", ".agents", "plugins"), { recursive: true });
  writeFileSync(join(packagesRoot, "codex-marketplace", ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "guild" }));
  isolatedRoot = join(sandbox, "isolated");
  binDir = join(sandbox, "bin");
  mkdirSync(binDir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * A fake claude. It installs into $CLAUDE_CONFIG_DIR, lists the install, and
 * prints a stream-json session whose init/hook events are toggled by `opts`.
 */
function fakeClaude(opts: { initPlugin?: boolean; hook?: boolean; escapeInstall?: boolean; plantLiveWrite?: string } = {}): string {
  const { initPlugin = true, hook = true, escapeInstall = false, plantLiveWrite } = opts;
  const script = `#!/usr/bin/env node
const fs = require("fs"); const path = require("path");
const args = process.argv.slice(2); const cfg = process.env.CLAUDE_CONFIG_DIR;
fs.appendFileSync(path.join(cfg, "env.log"), JSON.stringify({ args, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: cfg, TMPDIR: process.env.TMPDIR, GUILD: Object.keys(process.env).filter((k) => k.startsWith("GUILD_")) }) + "\\n");
${plantLiveWrite ? `fs.writeFileSync(${JSON.stringify(plantLiveWrite)}, "planted\\n");` : ""}
const install = ${escapeInstall ? JSON.stringify(join(sandbox, "escaped")) : 'path.join(cfg, "plugins", "cache", "guild", "guild", "' + VERSION + '")'};
if (args[0] === "plugin" && args[1] === "marketplace") { process.exit(0); }
if (args[0] === "plugin" && args[1] === "install") { fs.mkdirSync(install, { recursive: true }); process.exit(0); }
if (args[0] === "plugin" && args[1] === "list") {
  fs.mkdirSync(install, { recursive: true });
  console.log(JSON.stringify([{ id: "guild@guild", version: "${VERSION}", enabled: true, installPath: install }])); process.exit(0);
}
if (args[0] === "-p") {
  const out = [];
  if (${hook}) out.push({ type: "system", subtype: "hook_response", hook_event: "SessionStart", exit_code: 0, outcome: "success", output: "Guild ${VERSION} banner" });
  out.push({ type: "system", subtype: "init", plugins: ${initPlugin} ? [{ name: "guild", source: "guild@guild", version: "${VERSION}" }] : [], slash_commands: ${initPlugin} ? ["guild:guild", "guild:plan"] : [], mcp_servers: [] });
  out.push({ type: "result", subtype: "success" });
  for (const o of out) console.log(JSON.stringify(o));
  process.exit(1);
}
process.exit(3);
`;
  const p = join(binDir, "claude");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return p;
}

/** A fake codex. `skillVisible` toggles the Guild skill in the rendered prompt input. */
function fakeCodex(opts: { skillVisible?: boolean } = {}): string {
  const { skillVisible = true } = opts;
  const script = `#!/usr/bin/env node
const fs = require("fs"); const path = require("path");
const args = process.argv.slice(2); const home = process.env.CODEX_HOME;
const install = path.join(home, "plugins", "cache", "guild", "guild", "${VERSION}");
if (args[0] === "plugin" && args[1] === "marketplace") { console.log(JSON.stringify({ marketplaceName: "guild" })); process.exit(0); }
if (args[0] === "plugin" && args[1] === "add") {
  fs.mkdirSync(path.join(install, ".agents", "skills", "guild", "quality"), { recursive: true });
  fs.writeFileSync(path.join(install, ".agents", "skills", "guild", "quality", "SKILL.md"), "---\\nname: guild-quality\\n---\\n");
  console.log(JSON.stringify({ pluginId: "guild@guild", version: "${VERSION}", installedPath: install })); process.exit(0);
}
if (args[0] === "plugin" && args[1] === "list") {
  console.log(JSON.stringify({ installed: [{ pluginId: "guild@guild", version: "${VERSION}", installed: true, enabled: true }] })); process.exit(0);
}
if (args[0] === "debug" && args[1] === "prompt-input") {
  const text = "### Skill roots\\n- \`r1\` = \`" + path.join(install, ".agents", "skills") + "\`\\n### Available skills\\n" + (${skillVisible} ? "- guild:guild-quality: the gate (file: r1/guild/quality/SKILL.md)\\n" : "");
  console.log(JSON.stringify([{ type: "message", content: [{ type: "input_text", text }] }])); process.exit(0);
}
process.exit(3);
`;
  const p = join(binDir, "codex");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return p;
}

function run(host: IsolatedInstallHost, bin: string, root = isolatedRoot, tmpRoot = sandbox) {
  return runIsolatedInstall({ host, bin, packagesRoot, isolatedRoot: root, expectedVersion: VERSION, realHome, tmpRoot });
}

function checkState(result: ReturnType<typeof run>, concern: string): { state: string; evidence: string } {
  const c = result.checks.find((x) => x.concern === concern);
  if (!c) throw new Error(`no ${concern} check`);
  return c;
}

describe("checkIsolatedRoot — the live-config guard", () => {
  it("refuses a root inside the real HOME .claude", () => {
    // @control: a root inside the live .claude must never pass the guard.
    const r = checkIsolatedRoot(join(realHome, ".claude", "iso"), realHome, sandbox);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("isolated_root_in_live_config");
  });

  it("refuses a root inside the real HOME .codex", () => {
    expect(checkIsolatedRoot(join(realHome, ".codex"), realHome, sandbox).code).toBe("isolated_root_in_live_config");
  });

  it("refuses a root that contains the real HOME", () => {
    expect(checkIsolatedRoot(sandbox, realHome, sandbox).code).toBe("isolated_root_in_live_config");
  });

  it("refuses a root outside the OS temp root", () => {
    const otherTmp = join(sandbox, "other-tmp");
    mkdirSync(otherTmp);
    expect(checkIsolatedRoot(isolatedRoot, realHome, otherTmp).code).toBe("isolated_root_outside_os_temp");
  });

  it("refuses a symlinked root that resolves into the real HOME config", () => {
    // @control: a symlink must not launder a live-config root past the guard.
    const { symlinkSync } = require("node:fs") as typeof import("node:fs");
    const link = join(sandbox, "sneaky");
    symlinkSync(join(realHome, ".claude"), link);
    expect(checkIsolatedRoot(link, realHome, sandbox).code).toBe("isolated_root_in_live_config");
  });

  it("accepts a fresh root under the temp root, outside the real HOME", () => {
    expect(checkIsolatedRoot(isolatedRoot, realHome, sandbox)).toEqual({ ok: true, code: "ok", detail: expect.any(String) });
  });

  it("every refusal code is a closed enum member", () => {
    for (const code of ["isolated_root_in_live_config", "isolated_root_outside_os_temp", "live_config_mutated", "plugin_load_not_observed", "install_path_escaped"]) {
      expect(ISOLATED_INSTALL_REFUSALS as readonly string[]).toContain(code);
    }
  });
});

describe("runIsolatedInstall — claude-code-cli", () => {
  it("verifies install + plugin load when both are observed", () => {
    const r = run("claude-code-cli", fakeClaude());
    expect(r).toMatchObject({ ok: true, code: "ok" });
    expect(checkState(r, "real_install_activation").state).toBe("verified");
    expect(checkState(r, "native_plugin_load").state).toBe("verified");
    expect(checkState(r, "real_install_activation").evidence.startsWith("isolated-install:")).toBe(true);
    expect(checkState(r, "native_plugin_load").evidence).toContain("guild:guild");
  });

  it("runs the host with HOME and CLAUDE_CONFIG_DIR inside the isolated root and no GUILD_* env", () => {
    process.env.GUILD_RUN_ID_LEAK_PROBE = "x";
    try {
      run("claude-code-cli", fakeClaude());
    } finally {
      delete process.env.GUILD_RUN_ID_LEAK_PROBE;
    }
    const log = readFileSync(join(isolatedRoot, "claude", "claude-config", "env.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      for (const key of ["HOME", "CLAUDE_CONFIG_DIR", "TMPDIR"]) expect(entry[key].startsWith(isolatedRoot)).toBe(true);
      expect(entry.GUILD).toEqual([]);
    }
  });

  it("refuses before launching the host when the root is inside the live config", () => {
    const bin = fakeClaude();
    const r = run("claude-code-cli", bin, join(realHome, ".claude", "iso"));
    expect(r.code).toBe("isolated_root_in_live_config");
    expect(existsSync(join(realHome, ".claude", "iso"))).toBe(false);
    expect(checkState(r, "real_install_activation").state).toBe("refused");
    expect(checkState(r, "native_plugin_load").state).toBe("refused");
  });

  it("PLANTED CONTROL: a host that writes the real HOME config is refused", () => {
    // @control: a planted write to the live install state must flip the run to refused.
    const r = run("claude-code-cli", fakeClaude({ plantLiveWrite: join(realHome, ".claude", "plugins", "installed_plugins.json") }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("live_config_mutated");
    expect(checkState(r, "real_install_activation").state).toBe("refused");
    expect(checkState(r, "real_install_activation").evidence).toContain("live_config_mutated");
  });

  it("PLANTED CONTROL: a write inside an existing live plugin cache file is refused", () => {
    // @control: changed bytes deep in the live cache must flip the run to refused.
    const cached = join(realHome, ".claude", "plugins", "cache", "other", "other", "1.0.0", "hooks", "hooks.json");
    mkdirSync(join(cached, ".."), { recursive: true });
    writeFileSync(cached, "{}\n");
    const r = run("claude-code-cli", fakeClaude({ plantLiveWrite: cached }));
    expect(r.code).toBe("live_config_mutated");
  });

  it("PLANTED CONTROL: a per-host root symlinked into the live config is refused", () => {
    // @control: a planted <root>/claude symlink must not redirect the install.
    const { symlinkSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(isolatedRoot, { recursive: true });
    symlinkSync(join(realHome, ".claude"), join(isolatedRoot, "claude"));
    const bin = fakeClaude();
    const r = run("claude-code-cli", bin);
    expect(r.code).toBe("isolated_root_not_fresh");
    expect(existsSync(join(realHome, ".claude", "claude-config"))).toBe(false);
  });

  it("refuses with an exact code when the live install state cannot be read", () => {
    // @control: an unreadable watch set must refuse, never pass as unchanged.
    rmSync(join(realHome, ".claude", "settings.json"));
    mkdirSync(join(realHome, ".claude", "settings.json"));
    const r = run("claude-code-cli", fakeClaude());
    expect(r.code).toBe("live_config_unreadable");
    expect(checkState(r, "native_plugin_load").state).toBe("refused");
  });

  it("refuses with an exact code when a live plugin tree cannot be listed", () => {
    // @control: a permission-denied tree must refuse, never read as an empty tree.
    const cache = join(realHome, ".claude", "plugins", "cache");
    mkdirSync(cache, { recursive: true });
    chmodSync(cache, 0o000);
    try {
      expect(run("claude-code-cli", fakeClaude()).code).toBe("live_config_unreadable");
    } finally {
      chmodSync(cache, 0o755);
    }
  });

  it("refuses with an exact code when a watched live file cannot be read", () => {
    // @control: a permission-denied file must refuse, never read as absent.
    const { symlinkSync } = require("node:fs") as typeof import("node:fs");
    const locked = join(realHome, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "settings.json"), "{}\n");
    rmSync(join(realHome, ".claude", "settings.json"));
    symlinkSync(join(locked, "settings.json"), join(realHome, ".claude", "settings.json"));
    chmodSync(locked, 0o000);
    try {
      expect(run("claude-code-cli", fakeClaude()).code).toBe("live_config_unreadable");
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("PLANTED CONTROL: an install path outside the isolated root is refused", () => {
    // @control: an install the host reports outside the root must be refused.
    const r = run("claude-code-cli", fakeClaude({ escapeInstall: true }));
    expect(r.code).toBe("install_path_escaped");
  });

  it("refuses plugin load when the session init does not list Guild", () => {
    const r = run("claude-code-cli", fakeClaude({ initPlugin: false }));
    expect(r.code).toBe("plugin_load_not_observed");
    expect(checkState(r, "real_install_activation").state).toBe("verified");
    expect(checkState(r, "native_plugin_load").state).toBe("refused");
  });

  it("refuses plugin load when no Guild SessionStart hook fired", () => {
    expect(run("claude-code-cli", fakeClaude({ hook: false })).code).toBe("plugin_load_not_observed");
  });

  it("refuses when the host binary is absent", () => {
    expect(run("claude-code-cli", join(binDir, "missing-claude")).code).toBe("marketplace_add_failed");
  });
});

describe("runIsolatedInstall — codex-cli", () => {
  it("verifies install + model-visible Guild skill from the isolated install", () => {
    const r = run("codex-cli", fakeCodex());
    expect(r).toMatchObject({ ok: true, code: "ok" });
    expect(checkState(r, "real_install_activation").state).toBe("verified");
    expect(checkState(r, "native_plugin_load").state).toBe("verified");
    expect(checkState(r, "native_plugin_load").evidence).toContain("guild:guild-quality");
  });

  it("refuses plugin load when the Guild skill is not model-visible", () => {
    const r = run("codex-cli", fakeCodex({ skillVisible: false }));
    expect(r.code).toBe("plugin_load_not_observed");
    expect(checkState(r, "native_plugin_load").state).toBe("refused");
  });

  it("refuses a root outside the OS temp root without launching codex", () => {
    const otherTmp = join(sandbox, "other-tmp");
    mkdirSync(otherTmp);
    const r = run("codex-cli", fakeCodex(), isolatedRoot, otherTmp);
    expect(r.code).toBe("isolated_root_outside_os_temp");
    expect(existsSync(isolatedRoot)).toBe(false);
  });
});
