/**
 * tests/integration/update-matrix.test.ts — F03: the updater host matrix.
 *
 * Exercises ALL 16 registry host rows through the PRODUCTION hook bundle
 * (hooks/dist/update-check.js) with isolated host registries under a fixture
 * HOME — no real account/config writes, no network (PATH carries no git, so
 * the detached refresh fails open).
 *
 * Honesty boundaries (F03-AC2):
 *   - These are SIMULATED registries. Passing here proves signal/apply/
 *     degradation WIRING per declared row; it verifies no host rung and
 *     broadens no capability claim. The pinned-matrix test fails if any row's
 *     declared claim is widened.
 *   - Live-host verification stays out of scope (KTD5); residual parser and
 *     cadence results are linked for H01/H02 from the F03 report.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { HOST_REGISTRY_ROWS, type HostId } from "../../src/domains/config";

const DIST_JS = path.resolve(__dirname, "../../hooks/dist/update-check.js");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const CACHE_SCHEMA = "guild.update_check_cache.v1";
const RECEIPT_SCHEMA = "guild.install_receipt.v1";
const RECEIPT_BASENAME = "guild-install-receipt.json";

const ALL_HOSTS = Object.keys(HOST_REGISTRY_ROWS) as HostId[];

/**
 * The DECLARED matrix, pinned row by row (F03-AC2). A capability change that
 * widens any claim — a new auto_capable host, a new apply path, a new command —
 * must consciously edit this table, never ride in on a passing simulation.
 */
const PINNED_MATRIX: Record<string, { check: string; apply: string; command: string | null; auto_capable: boolean }> = {
  "claude-code-cli": { check: "marketplace_clone", apply: "marketplace_cli", command: "claude plugin marketplace update guild && claude plugin update guild@guild", auto_capable: true },
  "codex-cli": { check: "receipt", apply: "reinstall_command", command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update", auto_capable: false },
  "pi-cli": { check: "receipt", apply: "self_update", command: "guild-run update", auto_capable: false },
  "antigravity-cli": { check: "receipt", apply: "self_update", command: "guild-run update", auto_capable: false },
  "agents-file": { check: "receipt", apply: "reinstall_command", command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update", auto_capable: false },
  "claude-code-app": { check: "none", apply: "none", command: null, auto_capable: false },
  "claude-code-web": { check: "none", apply: "none", command: null, auto_capable: false },
  "codex-app": { check: "none", apply: "none", command: null, auto_capable: false },
  "claude-ai-connector": { check: "none", apply: "none", command: null, auto_capable: false },
  cursor: { check: "receipt", apply: "self_update", command: "guild-run update", auto_capable: false },
  "github-copilot": { check: "receipt", apply: "self_update", command: "guild-run update", auto_capable: false },
  opencode: { check: "receipt", apply: "self_update", command: "guild-run update", auto_capable: false },
  "rovo-dev": { check: "receipt", apply: "self_update", command: "guild-run update", auto_capable: false },
  kiro: { check: "receipt", apply: "reinstall_command", command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update", auto_capable: false },
  qoder: { check: "receipt", apply: "reinstall_command", command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update", auto_capable: false },
  trae: { check: "receipt", apply: "reinstall_command", command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update", auto_capable: false },
};

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface Fixture {
  home: string;
  cwd: string;
  pluginRoot: string;
  emptyPath: string;
}

function makeFixture(version: string | null, manifestDir = ".claude-plugin"): Fixture {
  const home = mkTmp("guild-matrix-home-");
  const cwd = mkTmp("guild-matrix-cwd-");
  const pluginRoot = mkTmp("guild-matrix-pkg-");
  const emptyPath = mkTmp("guild-matrix-path-");
  if (version !== null) {
    fs.mkdirSync(path.join(pluginRoot, manifestDir), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, manifestDir, "plugin.json"), JSON.stringify({ name: "guild", version }));
  }
  return { home, cwd, pluginRoot, emptyPath };
}

function writeCache(
  home: string,
  remote: Partial<{ latest_tag: string | null; next_head_sha: string | null; main_head_sha: string | null }>,
  checkedAt = new Date().toISOString()
): void {
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

function writeReceipt(pluginRoot: string, hostId: string, channel: "stable" | "beta", version: string, commit: string | null): void {
  fs.writeFileSync(
    path.join(pluginRoot, RECEIPT_BASENAME),
    JSON.stringify({
      schema_version: RECEIPT_SCHEMA,
      host: hostId,
      channel,
      ref: channel === "beta" ? "next" : "main",
      commit,
      version,
      installed_at: "2026-01-01T00:00:00Z",
    })
  );
}

function setUpdateMode(cwd: string, mode: "auto" | "notify" | "off"): void {
  const guildDir = path.join(cwd, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(path.join(guildDir, "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }));
  fs.writeFileSync(path.join(guildDir, "settings.json"), JSON.stringify({ defaults: { update: { mode } } }));
}

function runHook(f: Fixture, opts: { args?: string[]; env?: Record<string, string> } = {}): { exitCode: number; stdout: string } {
  const r = spawnSync(process.execPath, [DIST_JS, ...(opts.args ?? [])], {
    cwd: f.cwd,
    input: "{}",
    encoding: "utf8",
    timeout: 30_000,
    env: {
      HOME: f.home,
      PATH: f.emptyPath,
      GUILD_PLUGIN_ROOT: f.pluginRoot,
      ...(opts.env ?? {}),
    },
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? "" };
}

describe("pinned declared matrix (F03-AC2 — no claim broadening)", () => {
  it("the 16 registry rows equal the pinned declaration, byte for byte", () => {
    expect(ALL_HOSTS.length).toBe(16);
    expect(Object.keys(PINNED_MATRIX).sort()).toEqual([...ALL_HOSTS].sort());
    for (const h of ALL_HOSTS) {
      expect({ host: h, ...HOST_REGISTRY_ROWS[h].capabilities.package.update }).toEqual({ host: h, ...PINNED_MATRIX[h] });
    }
  });

  it("exactly one auto-capable host exists and it is claude-code-cli", () => {
    const auto = ALL_HOSTS.filter((h) => HOST_REGISTRY_ROWS[h].capabilities.package.update.auto_capable);
    expect(auto).toEqual(["claude-code-cli"]);
  });
});

describe("signal + degradation per host row, through the production hook (F03-AC1)", () => {
  for (const hostId of ALL_HOSTS) {
    const row = PINNED_MATRIX[hostId];

    it(`${hostId}: stable staleness signals with the row's exact command posture`, () => {
      const f = makeFixture("2.0.0");
      writeReceipt(f.pluginRoot, hostId, "stable", "2.0.0", null);
      writeCache(f.home, { latest_tag: "v9.9.9" });
      const r = runHook(f, { args: ["--host", hostId] });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Guild update available on stable: 2.0.0 → 9.9.9");
      if (row.command) {
        expect(r.stdout).toContain(`run: ${row.command}`);
      } else {
        // check:none rows degrade honestly: signal without a command claim.
        expect(r.stdout).not.toContain("run:");
      }
    });

    it(`${hostId}: beta SHA staleness signals by exact ref`, () => {
      const f = makeFixture("2.1.0-beta.1");
      writeReceipt(f.pluginRoot, hostId, "beta", "2.1.0-beta.1", SHA_A);
      writeCache(f.home, { next_head_sha: SHA_B });
      const r = runHook(f, { args: ["--host", hostId] });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain(`Guild update available on beta (next): ${SHA_A.slice(0, 7)} → ${SHA_B.slice(0, 7)}`);
      // Same version, SAME commit: silent (exact-ref comparison, not version shape).
      const f2 = makeFixture("2.1.0-beta.1");
      writeReceipt(f2.pluginRoot, hostId, "beta", "2.1.0-beta.1", SHA_A);
      writeCache(f2.home, { next_head_sha: SHA_A });
      expect(runHook(f2, { args: ["--host", hostId] }).stdout).toBe("");
    });

    it(`${hostId}: auto mode never silently applies unless the row is auto_capable`, async () => {
      const f = makeFixture("2.0.0");
      setUpdateMode(f.cwd, "auto");
      writeReceipt(f.pluginRoot, hostId, "stable", "2.0.0", null);
      writeCache(f.home, { latest_tag: "v9.9.9" });
      // Recording shims for EVERY apply vocabulary the rows can name: the
      // assertion is on actual command execution, not on printed messages
      // (codex G-lane F03-1 — a message-only check cannot see a rogue spawn).
      const applyLog = path.join(f.emptyPath, "apply-log");
      for (const bin of ["claude", "guild-run", "curl", "bash"]) {
        const shim = path.join(f.emptyPath, bin);
        fs.writeFileSync(shim, `#!/bin/sh\necho "${bin} $@" >> "${applyLog}"\nexit 0\n`);
        fs.chmodSync(shim, 0o755);
      }
      const r = runHook(f, { args: ["--host", hostId] });
      expect(r.exitCode).toBe(0);
      if (row.auto_capable) {
        expect(r.stdout).toContain("update staged");
        // The staged command really executes (detached): the shim records it.
        // Poll until BOTH chain links appear — the log exists after the first
        // link, and stopping there races the second under scheduler contention.
        const deadline = Date.now() + 8_000;
        let log = "";
        while (Date.now() < deadline) {
          try {
            log = fs.readFileSync(applyLog, "utf8");
            if (log.includes("claude plugin marketplace update guild") && log.includes("claude plugin update guild@guild")) break;
          } catch {
            // not written yet
          }
          await new Promise((res) => setTimeout(res, 150));
        }
        expect(log).toContain("claude plugin marketplace update guild");
        expect(log).toContain("claude plugin update guild@guild");
      } else {
        expect(r.stdout).toContain("cannot auto-apply");
        expect(r.stdout).not.toContain("update staged");
        expect(fs.existsSync(path.join(f.home, ".guild", "update-staged.json"))).toBe(false);
        // ZERO apply executions for an unsupported row, detached or otherwise.
        await new Promise((res) => setTimeout(res, 1_200));
        expect(fs.existsSync(applyLog)).toBe(false);
      }
    });

    it(`${hostId}: TTL/offline — no cache is silent; startup never blocks`, () => {
      const f = makeFixture("2.0.0");
      writeReceipt(f.pluginRoot, hostId, "stable", "2.0.0", null);
      const r = runHook(f, { args: ["--host", hostId] });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("");
    });

    it(`${hostId}: dev checkout stays silent (dev guard)`, () => {
      const f = makeFixture("2.0.0");
      fs.mkdirSync(path.join(f.pluginRoot, ".git", "refs", "heads"), { recursive: true });
      fs.writeFileSync(path.join(f.pluginRoot, ".git", "HEAD"), "ref: refs/heads/next\n");
      fs.writeFileSync(path.join(f.pluginRoot, ".git", "refs", "heads", "next"), `${SHA_B}\n`);
      writeCache(f.home, { latest_tag: "v9.9.9", next_head_sha: SHA_A });
      const r = runHook(f, { args: ["--host", hostId] });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("");
    });
  }
});

describe("cold cache → background refresh → NEXT session signal (the declared cadence)", () => {
  it("session 1 on a COLD cache is silent but refreshes; session 2 signals from the new cache", async () => {
    const f = makeFixture("2.0.0");
    writeReceipt(f.pluginRoot, "codex-cli", "stable", "2.0.0", null);
    // No cache at all. git shim sleeps 3s (simulated network), then serves a
    // newer stable tag — so a cold-cache-only blocking regression fails the
    // timing assertion below (codex G-lane F03-R2-2).
    const shim = path.join(f.emptyPath, "git");
    fs.writeFileSync(
      shim,
      `#!/bin/sh\n/bin/sleep 3\nprintf '${SHA_A}\\trefs/heads/main\\n${SHA_B}\\trefs/tags/v9.9.9\\n'\n`
    );
    fs.chmodSync(shim, 0o755);

    const started = Date.now();
    const first = runHook(f, { args: ["--host", "codex-cli"] });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe(""); // cold cache: silent THIS session
    expect(Date.now() - started).toBeLessThan(2500); // and never blocked on the 3s fetch

    // The detached worker lands the cache.
    const cacheFile = path.join(f.home, ".guild", "update-check.json");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        if (JSON.parse(fs.readFileSync(cacheFile, "utf8")).remote.latest_tag === "v9.9.9") break;
      } catch {
        // not written yet
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    const second = runHook(f, { args: ["--host", "codex-cli"] });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("Guild update available on stable: 2.0.0 → 9.9.9");
  });
});

describe("native registry identities through the production hook (custom roots / aliases / parser variants)", () => {
  it("claude-code-cli: marketplace clone under a custom CLAUDE_CONFIG_DIR resolves beta identity", () => {
    const f = makeFixture("2.1.0-beta.1");
    const customRoot = path.join(mkTmp("guild-matrix-ccd-"), "cfg dir");
    const pkg = path.join(customRoot, "plugins", "cache", "guild", "guild", "2.1.0-beta.1");
    const marketplace = path.join(customRoot, "plugins", "marketplaces", "guild");
    fs.mkdirSync(path.join(pkg, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(pkg, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "guild", version: "2.1.0-beta.1" }));
    fs.mkdirSync(path.join(marketplace, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(marketplace, ".git", "HEAD"), "ref: refs/heads/next\n");
    fs.writeFileSync(path.join(marketplace, ".git", "refs", "heads", "next"), `${SHA_A}\n`);
    fs.writeFileSync(
      path.join(customRoot, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "guild@guild": [{ installPath: pkg, gitCommitSha: SHA_A }] } })
    );
    fs.writeFileSync(
      path.join(customRoot, "plugins", "known_marketplaces.json"),
      JSON.stringify({ guild: { installLocation: marketplace } })
    );
    writeCache(f.home, { next_head_sha: SHA_B });
    const r = runHook(
      { ...f, pluginRoot: pkg },
      { args: ["--host", "claude-code-cli"], env: { CLAUDE_CONFIG_DIR: customRoot } }
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`Guild update available on beta (next): ${SHA_A.slice(0, 7)} → ${SHA_B.slice(0, 7)}`);
    // No receipt minted from live registry identity.
    expect(fs.existsSync(path.join(pkg, RECEIPT_BASENAME))).toBe(false);
  });

  it("codex-cli: quoted-alias TOML variant under a CODEX_HOME with spaces resolves identity", () => {
    const f = makeFixture(null);
    const codexHome = path.join(mkTmp("guild-matrix-codex-"), "codex home");
    const pkg = path.join(codexHome, "marketplaces", "guild mp", "package");
    fs.mkdirSync(path.join(pkg, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(path.join(pkg, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "guild", version: "2.1.0-beta.1" }));
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `# registry\n[marketplaces."guild mp"]  # quoted alias with a space\nurl = 'https://github.com/lookatitude/guild'\nref = "next"\nlast_revision = "${SHA_A}"\n`
    );
    writeCache(f.home, { next_head_sha: SHA_B });
    const r = runHook({ ...f, pluginRoot: pkg }, { args: ["--host", "codex-cli"], env: { CODEX_HOME: codexHome } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Guild update available on beta (next)");
  });

  it("codex-cli: a malformed registry (duplicate keys) refuses identity; candidate version reports channel-undetermined", () => {
    const f = makeFixture("2.1.0-beta.1", ".codex-plugin");
    const codexHome = path.join(f.home, ".codex");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "config.toml"), `[marketplaces.guild]\nref = "main"\nref = "next"\n`);
    writeCache(f.home, { latest_tag: "v9.9.9", next_head_sha: SHA_B });
    const r = runHook(f, { args: ["--host", "codex-cli"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("channel undetermined");
    expect(r.stdout).not.toContain("update available");
    expect(fs.existsSync(path.join(f.pluginRoot, RECEIPT_BASENAME))).toBe(false);
  });

  it("stableSemVer fallback: commit-less stable receipt compares versions, prerelease core-equal stays quiet", () => {
    const f = makeFixture("2.7.0-beta.20");
    writeReceipt(f.pluginRoot, "codex-cli", "stable", "2.7.0-beta.20", null);
    writeCache(f.home, { latest_tag: "v2.7.0" });
    const r = runHook(f, { args: ["--host", "codex-cli"] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(""); // equal-core candidate label is the same published bytes
  });
});
