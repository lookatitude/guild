/**
 * hooks/__tests__/update-check.test.ts — F02: update notices, cache timing and
 * identity receipts through the PRODUCTION hook bundle (hooks/dist/update-check.js).
 *
 * Covers:
 *   F02-AC1 cold/stale cache follows the declared next-session semantics:
 *           cold cache is silent this session; a present-but-stale cache still
 *           signals from cached data without touching the network.
 *   F02-AC2 Claude auto staging is deduplicated per host+target; a non-Claude
 *           host (auto_capable: false) never silently auto-applies.
 *   F02-AC3 offline/error/missing identity never blocks startup and never
 *           asserts a false installed channel: a candidate-shaped version with
 *           no host identity reports channel-undetermined honestly, mints NO
 *           receipt, and claims no stable update.
 *
 * Every case spawns the compiled bundle exactly as the host does (node, stdin
 * ignored by the hook) with a controlled HOME and an EMPTY PATH dir so the
 * detached --refresh worker finds no `git` and fails open with no network.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DIST_JS = path.resolve(__dirname, "../dist/update-check.js");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const CACHE_SCHEMA = "guild.update_check_cache.v1";
const RECEIPT_BASENAME = "guild-install-receipt.json";

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface Fixture {
  home: string;
  cwd: string;
  pluginRoot: string;
  emptyPath: string;
}

function makeFixture(version: string | null): Fixture {
  const home = mkTmp("guild-hook-home-");
  const cwd = mkTmp("guild-hook-cwd-");
  const pluginRoot = mkTmp("guild-hook-pkg-");
  const emptyPath = mkTmp("guild-hook-path-");
  if (version !== null) {
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "guild", version })
    );
  }
  return { home, cwd, pluginRoot, emptyPath };
}

function writeCache(home: string, remote: Partial<{ latest_tag: string | null; next_head_sha: string | null; main_head_sha: string | null }>, checkedAt: string): void {
  const file = path.join(home, ".guild", "update-check.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      schema_version: CACHE_SCHEMA,
      checked_at: checkedAt,
      source_repo: "repo",
      remote: { latest_tag: null, next_head_sha: null, main_head_sha: null, ...remote },
    })
  );
}

function setUpdateMode(cwd: string, mode: "auto" | "notify" | "off"): void {
  const guildDir = path.join(cwd, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  // Layout marker so the hook's detect-only storage probe sees a current root.
  fs.writeFileSync(path.join(guildDir, "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }));
  fs.writeFileSync(path.join(guildDir, "settings.json"), JSON.stringify({ defaults: { update: { mode } } }));
}

// Under `bun test` the repo preload (test-preload.ts, item 6) repoints
// process.execPath at the PATH `node`, so this spawns the bundle under the
// REAL user runtime (KTD10/KTD11), not Bun. Assert that here so a preload
// change cannot silently turn these into Bun-runtime tests.
if (!/node/.test(path.basename(process.execPath))) {
  throw new Error(`hooks update-check tests must run the bundle under node, got: ${process.execPath}`);
}

function runHook(
  f: Fixture,
  opts: { args?: string[]; env?: Record<string, string> } = {}
): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [DIST_JS, ...(opts.args ?? [])], {
    cwd: f.cwd,
    input: "{}",
    encoding: "utf8",
    timeout: 30_000,
    env: {
      HOME: f.home,
      PATH: f.emptyPath, // no git: the detached refresh fails open, no network
      GUILD_PLUGIN_ROOT: f.pluginRoot,
      ...(opts.env ?? {}),
    },
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const FRESH = () => new Date().toISOString();
const STALE = "2020-01-01T00:00:00Z";

describe("cold/stale cache semantics (F02-AC1)", () => {
  it("cold cache: silent this session, exit 0 (signal lands next session)", () => {
    const f = makeFixture("2.0.0");
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("a present-but-STALE cache still signals from cached data (no network wait)", () => {
    const f = makeFixture("2.0.0");
    writeCache(f.home, { latest_tag: "v9.9.9" }, STALE);
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Guild update available on stable: 2.0.0 → 9.9.9");
  });

  it("fresh cache, up to date: silent", () => {
    const f = makeFixture("2.0.0");
    writeCache(f.home, { latest_tag: "v2.0.0" }, FRESH());
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("a stale cache schedules the DETACHED background refresh without blocking this session", async () => {
    const f = makeFixture("2.0.0");
    writeCache(f.home, { latest_tag: "v2.0.0" }, STALE);
    // git shim: sleeps, records that it ran, then emits a valid ls-remote line.
    const marker = path.join(f.emptyPath, "git-ran");
    const shim = path.join(f.emptyPath, "git");
    fs.writeFileSync(
      shim,
      // Absolute /bin/sleep: PATH holds only the shim dir, and a bare `sleep`
      // would fail instantly and void the timing assertion (codex F02-R2-2).
      `#!/bin/sh\n/bin/sleep 3\necho ran > "${marker}"\nprintf '${SHA_B}\\trefs/tags/v9.9.9\\n'\n`
    );
    fs.chmodSync(shim, 0o755);
    const started = Date.now();
    const r = runHook(f);
    const elapsed = Date.now() - started;
    expect(r.exitCode).toBe(0);
    // Session start returned long before the 3s network call finished, and the
    // worker really is still sleeping (the delay demonstrably happened).
    expect(elapsed).toBeLessThan(2500);
    expect(fs.existsSync(marker)).toBe(false);
    // The detached worker DID run: the marker appears and the cache is rewritten.
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 200));
    }
    expect(fs.existsSync(marker)).toBe(true);
    const cacheDeadline = Date.now() + 5_000;
    let latest: string | null = null;
    while (Date.now() < cacheDeadline) {
      try {
        latest = JSON.parse(fs.readFileSync(path.join(f.home, ".guild", "update-check.json"), "utf8")).remote.latest_tag;
        if (latest === "v9.9.9") break;
      } catch {
        // worker still writing
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    expect(latest).toBe("v9.9.9");
  });

  it("a FRESH cache schedules no refresh at all", async () => {
    const f = makeFixture("2.0.0");
    writeCache(f.home, { latest_tag: "v2.0.0" }, FRESH());
    const marker = path.join(f.emptyPath, "git-ran");
    const shim = path.join(f.emptyPath, "git");
    fs.writeFileSync(shim, `#!/bin/sh\necho ran > "${marker}"\n`);
    fs.chmodSync(shim, 0o755);
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    await new Promise((res) => setTimeout(res, 2000));
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("mode off silences everything", () => {
    const f = makeFixture("2.0.0");
    setUpdateMode(f.cwd, "off");
    writeCache(f.home, { latest_tag: "v9.9.9" }, FRESH());
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("a dev checkout stays silent even with an update in the cache (dev guard preserved)", () => {
    const f = makeFixture("2.0.0");
    fs.mkdirSync(path.join(f.pluginRoot, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(f.pluginRoot, ".git", "HEAD"), "ref: refs/heads/next\n");
    fs.writeFileSync(path.join(f.pluginRoot, ".git", "refs", "heads", "next"), `${SHA_B}\n`);
    writeCache(f.home, { latest_tag: "v9.9.9", next_head_sha: SHA_A }, FRESH());
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(fs.existsSync(path.join(f.pluginRoot, RECEIPT_BASENAME))).toBe(false);
  });
});

describe("channel-undetermined honesty (F02-AC3)", () => {
  it("candidate-shaped version with no identity: honest info line, NO receipt, NO stable claim", () => {
    const f = makeFixture("3.1.0-beta.1");
    writeCache(f.home, { latest_tag: "v9.9.9", main_head_sha: SHA_A, next_head_sha: SHA_B }, FRESH());
    const r = runHook(f);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("channel undetermined");
    expect(r.stdout).not.toContain("update available on stable");
    expect(r.stdout).not.toContain("update available on beta");
    expect(fs.existsSync(path.join(f.pluginRoot, RECEIPT_BASENAME))).toBe(false);
  });

  it("a launcher-declared beta channel mints the explicit-authority receipt and never announces a STABLE update", () => {
    const f = makeFixture("3.1.0-beta.1");
    // A cache with a newer stable tag must NOT produce a stable claim for the
    // just-declared beta install (codex G-lane F02-1: the pre-mint "default
    // stable" state leaked into the first session's signal).
    writeCache(f.home, { latest_tag: "v9.9.9", next_head_sha: SHA_B }, FRESH());
    const r = runHook(f, { env: { GUILD_ACTIVATION_CHANNEL: "beta" } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("update available on stable");
    const receipt = JSON.parse(fs.readFileSync(path.join(f.pluginRoot, RECEIPT_BASENAME), "utf8"));
    expect(receipt).toMatchObject({ channel: "beta", channel_confidence: "launcher-declared" });
  });

  it("launcher authority holds even when the receipt cannot be persisted (unwritable root)", () => {
    const f = makeFixture("3.1.0-beta.1");
    writeCache(f.home, { latest_tag: "v9.9.9", next_head_sha: SHA_B }, FRESH());
    fs.chmodSync(f.pluginRoot, 0o555);
    try {
      const r = runHook(f, { env: { GUILD_ACTIVATION_CHANNEL: "beta" } });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain("update available on stable");
      expect(fs.existsSync(path.join(f.pluginRoot, RECEIPT_BASENAME))).toBe(false);
    } finally {
      fs.chmodSync(f.pluginRoot, 0o755);
    }
  });

  it("a KNOWN native registry identity stays live evidence: no receipt is minted from it", () => {
    const f = makeFixture("3.1.0-beta.1");
    const codexHome = path.join(f.home, ".codex");
    const pkg = path.join(codexHome, "marketplaces", "guild", "package");
    fs.mkdirSync(path.join(pkg, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(path.join(pkg, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "guild", version: "3.1.0-beta.1" }));
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nref = "next"\nlast_revision = "${SHA_A}"\n`
    );
    const f2: Fixture = { ...f, pluginRoot: pkg };
    writeCache(f.home, { next_head_sha: SHA_B }, FRESH());
    const r = runHook(f2, { args: ["--host", "codex-cli"] });
    expect(r.exitCode).toBe(0);
    // Live registry identity drives the beta signal...
    expect(r.stdout).toContain("Guild update available on beta (next)");
    // ...and is NOT frozen into a receipt.
    expect(fs.existsSync(path.join(pkg, RECEIPT_BASENAME))).toBe(false);
  });

  it("corrupt cache + malformed codex registry + broken claude registry: exit 0, no crash, no false channel", () => {
    const f = makeFixture("3.1.0-beta.1");
    const cacheFile = path.join(f.home, ".guild", "update-check.json");
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, "{not json");
    const codexHome = path.join(f.home, ".codex");
    fs.mkdirSync(codexHome, { recursive: true });
    // duplicate keys — the shared parser refuses, identity stays null
    fs.writeFileSync(path.join(codexHome, "config.toml"), `[marketplaces.guild]\nref = "main"\nref = "next"\n`);
    fs.mkdirSync(path.join(f.home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(path.join(f.home, ".claude", "plugins", "installed_plugins.json"), "also {not json");
    const r = runHook(f, { args: ["--host", "codex-cli"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("channel undetermined");
    expect(r.stdout).not.toContain("update available");
    expect(fs.existsSync(path.join(f.pluginRoot, RECEIPT_BASENAME))).toBe(false);
  });
});

describe("auto staging gate + dedupe (F02-AC2)", () => {
  it("claude (auto_capable): stages once per host+target, dedupes the second run", () => {
    const f = makeFixture("2.0.0");
    setUpdateMode(f.cwd, "auto");
    writeCache(f.home, { latest_tag: "v9.9.9" }, FRESH());

    const first = runHook(f);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("update staged");
    const marker = JSON.parse(fs.readFileSync(path.join(f.home, ".guild", "update-staged.json"), "utf8"));
    expect(marker.target).toBe("claude-code-cli@9.9.9");

    const second = runHook(f);
    expect(second.stdout).toContain("already staged");
  });

  it("non-Claude (auto_capable: false) degrades to notify and never silently applies", () => {
    const f = makeFixture("2.0.0");
    setUpdateMode(f.cwd, "auto");
    // Receipt-backed codex install so the stable signal fires.
    fs.writeFileSync(
      path.join(f.pluginRoot, RECEIPT_BASENAME),
      JSON.stringify({
        schema_version: "guild.install_receipt.v1",
        host: "codex-cli",
        channel: "stable",
        ref: "main",
        commit: null,
        version: "2.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      })
    );
    writeCache(f.home, { latest_tag: "v9.9.9" }, FRESH());
    const r = runHook(f, { args: ["--host", "codex-cli"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("cannot auto-apply");
    expect(r.stdout).not.toContain("update staged");
    expect(fs.existsSync(path.join(f.home, ".guild", "update-staged.json"))).toBe(false);
  });

  it("an unknown --host fails closed: notify without naming a wrong command", () => {
    const f = makeFixture("2.0.0");
    writeCache(f.home, { latest_tag: "v9.9.9" }, FRESH());
    const r = runHook(f, { args: ["--host", "mystery-host"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Guild update available on stable");
    expect(r.stdout).not.toContain("run:");
  });
});
