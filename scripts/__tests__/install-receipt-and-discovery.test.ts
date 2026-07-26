/**
 * scripts/__tests__/install-receipt-and-discovery.test.ts
 *
 * INSTALL RECEIPT + HOST-NATIVE DISCOVERY RAIL
 * (initiative cross-host-release-distribution, work item xhrd-wi-05 / G5).
 *
 * WHY THIS EXISTS — AND WHY THE FIRST ATTEMPT SHIPPED BROKEN.
 * The first version of this lane changed `plugin_version_from()` to probe
 * `.codex-plugin/plugin.json`, and it was verified by calling that FUNCTION
 * against synthetic fixtures. It passed. It also did nothing: `install_codex_cli`
 * hands `write_receipt` the MARKETPLACE ROOT, while the renderer puts the
 * manifest at `plugins/guild/.codex-plugin/plugin.json` one level deeper. The
 * probe missed, execution fell through to the checkout's Claude manifest, and
 * the receipt recorded Claude's version — byte-identical to the old behaviour.
 *
 * So this rail exercises the SHELL FUNCTIONS AS install.sh CALLS THEM, against
 * a directory laid out the way the renderer actually lays one out. Testing a
 * function in isolation is what let the defect through; testing the call path
 * is the fix.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const INSTALL_SH = path.join(PLUGIN_ROOT, "install.sh");

/**
 * Extract one shell function from install.sh so it can be EXECUTED.
 *
 * Brace-aware: an earlier version stopped at the first standalone `}`, which
 * silently truncates any function containing a nested block. It now tracks
 * depth from the opening brace and returns the whole body.
 */
function extractFn(name: string): string {
  const src = fs.readFileSync(INSTALL_SH, "utf8");
  const start = src.indexOf(`${name}() {`);
  if (start === -1) throw new Error(`install.sh no longer defines ${name}()`);
  const lines = src.slice(start).split("\n");
  const out: string[] = [];
  let depth = 0;
  for (const line of lines) {
    out.push(line);
    if (/\{\s*$/.test(line)) depth++;
    if (/^\}/.test(line)) {
      depth--;
      if (depth <= 0) break;
    }
  }
  return out.join("\n");
}

function sh(script: string): string {
  return execFileSync("bash", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Write a manifest the way the real ones are written — multi-line, indented. */
function writeManifest(dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.json"), `{\n  "name": "guild",\n  "version": "${version}"\n}\n`);
}

describe("plugin_version_from resolves each host's OWN manifest", () => {
  const fn = extractFn("plugin_version_from");
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-receipt-"));
  });
  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves a Codex-only package (no .claude-plugin present)", () => {
    const pkg = path.join(tmp, "codex-only");
    writeManifest(path.join(pkg, ".codex-plugin"), "9.9.9-CODEX");
    expect(sh(`${fn}\nplugin_version_from ${pkg}`)).toBe("9.9.9-CODEX");
  });

  it("resolves a Claude package", () => {
    const pkg = path.join(tmp, "claude-only");
    writeManifest(path.join(pkg, ".claude-plugin"), "1.1.1-CLAUDE");
    expect(sh(`${fn}\nplugin_version_from ${pkg}`)).toBe("1.1.1-CLAUDE");
  });

  it("returns empty for a directory with neither, without erroring", () => {
    const pkg = path.join(tmp, "neither");
    fs.mkdirSync(pkg, { recursive: true });
    expect(sh(`${fn}\nplugin_version_from ${pkg}; echo "rc=$?"`)).toBe("rc=0");
  });

  it("survives inherited errexit when the first candidate is absent", () => {
    // `set -euo pipefail` plus POSIX-mode errexit inheritance made the
    // non-matching first probe abort before the .codex-plugin candidate.
    const pkg = path.join(tmp, "errexit");
    writeManifest(path.join(pkg, ".codex-plugin"), "3.3.3");
    expect(sh(`set -euo pipefail\n${fn}\nplugin_version_from ${pkg}`)).toBe("3.3.3");
  });
});

describe("REGRESSION: the receipt path install.sh actually uses", () => {
  const fn = extractFn("plugin_version_from");
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-mkt-"));
  });
  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the Codex manifest is NOT at the marketplace root — it is under plugins/guild", () => {
    // Mirrors writeCodexMarketplaceTree's real layout. This is the exact fact
    // the first attempt got wrong.
    const mkt = path.join(tmp, "codex-marketplace");
    writeManifest(path.join(mkt, "plugins", "guild", ".codex-plugin"), "2.3.2");

    // What the FIRST version passed to write_receipt — misses.
    expect(sh(`${fn}\nplugin_version_from ${mkt}`)).toBe("");
    // What install_codex_cli passes now — resolves.
    expect(sh(`${fn}\nplugin_version_from ${path.join(mkt, "plugins", "guild")}`)).toBe("2.3.2");
  });

  // EXECUTE write_receipt — do not regex the source. The whole defect class
  // this lane exists for is "the code reads right and does nothing", and a
  // source-text assertion cannot tell those apart.
  it("REGRESSION: write_receipt records the CODEX version, not the checkout's Claude version", () => {
    const fnW = extractFn("write_receipt");
    const checkout = path.join(tmp, "checkout");
    writeManifest(path.join(checkout, ".claude-plugin"), "1.1.1-CLAUDE");
    const pkg = path.join(tmp, "installed-cache", "guild", "9.9.9-CODEX");
    writeManifest(path.join(pkg, ".codex-plugin"), "9.9.9-CODEX");
    const receipts = path.join(tmp, "receipts-out");

    // Drive it exactly as install.sh does: pkg_dir supplied, SCRIPT_DIR being
    // the checkout, RENDERED_DIST unset.
    sh(
      [
        "set -u",
        `RECEIPTS_DIR=${receipts}`,
        `SCRIPT_DIR=${checkout}`,
        'RENDERED_DIST=""',
        "DRY_RUN=0",
        'CHANNEL="stable"',
        'SOURCE_REF="main"',
        'SOURCE_COMMIT=""',
        fn,
        fnW,
        `write_receipt codex-cli ${pkg}`,
      ].join("\n")
    );

    const machine = JSON.parse(fs.readFileSync(path.join(receipts, "codex-cli.json"), "utf8")) as {
      version: string;
      host: string;
    };
    expect(machine.host).toBe("codex-cli");
    // The exact regression. Verified against the origin/next baseline, where
    // this same drive produces "1.1.1-CLAUDE" — NOT against an intermediate
    // commit of this lane, which already carried half the fix and made the
    // comparison vacuous.
    expect(machine.version).toBe("9.9.9-CODEX");

    // …and the package-local copy must land IN the supplied package root, which
    // for a real install is the cache dir guild-run/self-update read.
    expect(fs.existsSync(path.join(pkg, "guild-install-receipt.json"))).toBe(true);
  });

  it("install_codex_cli resolves the INSTALLED CACHE dir, not just the marketplace source", () => {
    const src = fs.readFileSync(INSTALL_SH, "utf8");
    // The cache is populated by `codex plugin add` before write_receipt runs;
    // the marketplace source is only the fallback.
    expect(src).toMatch(/plugins\/cache\/guild/);
    expect(src).toMatch(/\[ -z "\$CODEX_PLUGIN_ROOT_DIR" \] && CODEX_PLUGIN_ROOT_DIR="\$CODEX_MARKETPLACE_PATH\/plugins\/guild"/);
    expect(src).toMatch(/write_receipt codex-cli "\$CODEX_PLUGIN_ROOT_DIR"/);
  });
});

describe("host-native discovery on --update with no receipts", () => {
  let home: string;
  let codexHome: string;
  let receipts: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-disc-"));
    home = path.join(base, "home");
    codexHome = path.join(base, "codex");
    receipts = path.join(base, "receipts");
    fs.mkdirSync(home, { recursive: true });
  });

  function runUpdate(): string {
    try {
      execFileSync("bash", [INSTALL_SH, "--update"], {
        encoding: "utf8",
        env: { ...process.env, HOME: home, CODEX_HOME: codexHome, GUILD_RECEIPTS_DIR: receipts },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return "";
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string };
      return String(err.stderr ?? "") + String(err.stdout ?? "");
    }
  }

  it("does NOT report an install for an EMPTY codex cache dir", () => {
    // A bare directory is not an install. The first attempt reported it as one.
    fs.mkdirSync(path.join(codexHome, "plugins", "cache", "guild"), { recursive: true });
    const out = runUpdate();
    expect(out).toMatch(/No host-native Guild install detected/);
    expect(out).not.toMatch(/Detected a HOST-NATIVE Codex install/);
  });

  it("detects a real Codex payload and, for a LOCAL marketplace, does not advise `marketplace upgrade`", () => {
    writeManifest(path.join(codexHome, "plugins", "cache", "guild", "guild", "2.2.0", ".codex-plugin"), "2.2.0");
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[marketplaces.guild]\nsource_type = "local"\nsource = "/somewhere/dist/codex-marketplace"\n'
    );
    const out = runUpdate();
    expect(out).toMatch(/Detected a HOST-NATIVE Codex install \(version 2\.2\.0\)/);
    // The command that would FAIL for a local source must not be the advice.
    expect(out).not.toMatch(/codex plugin marketplace upgrade/);
    expect(out).toMatch(/NORMAL install \(not --update\)/);
  });

  it("advises `marketplace upgrade` when the source IS git", () => {
    writeManifest(path.join(codexHome, "plugins", "cache", "guild", "guild", "2.3.2", ".codex-plugin"), "2.3.2");
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      '[marketplaces.guild]\nsource_type = "git"\nsource = "https://github.com/lookatitude/guild.git"\n'
    );
    expect(runUpdate()).toMatch(/codex plugin marketplace upgrade/);
  });

  it("reads Claude's AUTHORITATIVE registry, not directory names", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "guild@guild": [{ scope: "user", version: "2.3.2" }] } })
    );
    expect(runUpdate()).toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("does NOT false-positive on an EMPTY plugin array", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "guild@guild": [] } })
    );
    expect(runUpdate()).not.toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("does NOT false-positive on the string appearing in unrelated metadata", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: {}, notes: 'saw "guild@guild" once' })
    );
    expect(runUpdate()).not.toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("does NOT treat MALFORMED json containing the string as an install", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, "installed_plugins.json"), '{ "plugins": { "guild@guild": [ {} ');
    expect(runUpdate()).not.toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("does NOT false-positive on a marketplace-only directory", () => {
    // The first attempt grepped top-level directory names and matched this.
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(path.join(reg, "marketplaces", "guild-marketplace-only"), { recursive: true });
    fs.writeFileSync(path.join(reg, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {} }));
    const out = runUpdate();
    expect(out).not.toMatch(/Detected a HOST-NATIVE Claude Code install/);
    expect(out).toMatch(/No host-native Guild install detected/);
  });
});
