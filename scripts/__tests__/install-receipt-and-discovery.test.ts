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

  // EXECUTE the selector — round-4/5 found the previous BSD-first mtime chain
  // misbehaves under GNU stat: there `-f` is filesystem-status MODE and "%m" a
  // FILE operand, so the call pollutes the captured value with status garbage
  // (nonzero exit, stdout kept by `$(A || B)`). A source-regex assertion could
  // never have caught any of that. These drive the real function under both
  // stat semantics.
  describe("codex_cache_plugin_dir picks the just-installed version", () => {
    const fnSel = extractFn("codex_cache_plugin_dir");
    let cache: string;
    let gnubin: string;

    beforeAll(() => {
      cache = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cxsel-"));
      for (const v of ["2.10.0", "2.3.2", "2.2.0"]) {
        writeManifest(path.join(cache, "plugins", "cache", "guild", "guild", v, ".codex-plugin"), v);
      }
      // Distinct mtimes a second apart minimum — stat has 1s granularity, and a
      // sub-second fixture ties every mtime and proves nothing (learned the
      // hard way in round 3's first fixture attempt).
      const base = Date.UTC(2026, 0, 1) / 1000;
      const dir = (v: string) => path.join(cache, "plugins", "cache", "guild", "guild", v);
      fs.utimesSync(dir("2.10.0"), base, base);
      fs.utimesSync(dir("2.3.2"), base + 100, base + 100);
      fs.utimesSync(dir("2.2.0"), base + 200, base + 200); // just-installed

      // A GNU-semantics stat shim, PLATFORM-INDEPENDENT: perl supplies the
      // mtime (present on macOS and ubuntu runners alike) — a first version
      // delegated to BSD `/usr/bin/stat`, which broke the shim itself on the
      // Linux CI runner. The `-f` branch models real GNU 9.11 behavior:
      // filesystem-status garbage on STDOUT with a non-zero exit (measured on
      // coreutils 9.11), which inside `$(A || B)` gets captured with B's
      // output appended — the pollution that made the old BSD-first chain's
      // captured value garbage on Linux. These tests prove the POSITIVE
      // contract (correct selection when `-c %Y` is the working spelling);
      // they are not a revert-tripwire, since the polluted capture can still
      // limp to a correct pick on the trailing valid line.
      gnubin = fs.mkdtempSync(path.join(os.tmpdir(), "guild-gnustat-"));
      fs.writeFileSync(
        path.join(gnubin, "stat"),
        [
          "#!/bin/bash",
          'if [ "$1" = "-c" ] && [ "$2" = "%Y" ]; then exec perl -e \'print +(stat($ARGV[0]))[9]\' "$3"; fi',
          'if [ "$1" = "-f" ]; then printf "  File: \\"%s\\"\\n  ID: 0 Namelen: 255 Type: apfs\\n  Inodes: Total: 999999 Free: 424242\\n" "$3"; exit 1; fi',
          "exit 1",
          "",
        ].join("\n"),
        { mode: 0o755 }
      );
    });

    afterAll(() => {
      for (const d of [cache, gnubin]) if (d) fs.rmSync(d, { recursive: true, force: true });
    });

    it("native stat: newest mtime wins, not filesystem order", () => {
      expect(path.basename(sh(`${fnSel}\ncodex_cache_plugin_dir ${cache}`))).toBe("2.2.0");
    });

    it("GNU-semantics stat: still newest — the BSD-first chain polluted its captured value here", () => {
      const out = execFileSync("bash", ["-c", `${fnSel}\ncodex_cache_plugin_dir ${cache}`], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${gnubin}:${process.env.PATH ?? ""}` },
      }).trim();
      expect(path.basename(out)).toBe("2.2.0");
    });

    it("tracks a change in which version is newest — native AND GNU shim", () => {
      const d = path.join(cache, "plugins", "cache", "guild", "guild", "2.3.2");
      const t = Date.UTC(2026, 5, 1) / 1000;
      fs.utimesSync(d, t, t);
      expect(path.basename(sh(`${fnSel}\ncodex_cache_plugin_dir ${cache}`))).toBe("2.3.2");
      // Round-5 caught that the reverse direction only ran under native stat,
      // so "verified under the shim in both directions" was unproven. Run it.
      const out = execFileSync("bash", ["-c", `${fnSel}\ncodex_cache_plugin_dir ${cache}`], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${gnubin}:${process.env.PATH ?? ""}` },
      }).trim();
      expect(path.basename(out)).toBe("2.3.2");
    });

    it("empty/absent cache yields empty so the caller falls back", () => {
      const none = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nocache-"));
      expect(sh(`${fnSel}\ncodex_cache_plugin_dir ${none}; echo "rc=$?"`)).toBe("rc=0");
      fs.rmSync(none, { recursive: true, force: true });
    });
  });

  it("install_codex_cli resolves the INSTALLED CACHE dir, not just the marketplace source", () => {
    const src = fs.readFileSync(INSTALL_SH, "utf8");
    // The cache is populated by `codex plugin add` before write_receipt runs;
    // the marketplace source is only the fallback.
    expect(src).toMatch(/CODEX_PLUGIN_ROOT_DIR="\$\(codex_cache_plugin_dir "\$\{CODEX_HOME:-\$HOME\/\.codex\}"\)"/);
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

  it("does NOT count an entry with no version/installPath — [{}] is not an install", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "guild@guild": [{}] } })
    );
    expect(runUpdate()).not.toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("does NOT count a project-scoped entry for a DIFFERENT project", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "guild@guild": [{ scope: "project", projectPath: "/somewhere/else", version: "2.3.2" }] },
      })
    );
    expect(runUpdate()).not.toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("DOES count a registry-V1 OBJECT entry (no scope field, no array) — round-1 false negative", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({ version: 1, plugins: { "guild@guild": { installPath: "/x/guild", isLocal: false } } })
    );
    expect(runUpdate()).toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("DOES count a project-scoped entry whose path differs only by a trailing slash", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "guild@guild": [{ scope: "project", projectPath: process.cwd() + "/", version: "2.3.2" }] },
      })
    );
    expect(runUpdate()).toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("DOES count a user-scoped entry with a version", () => {
    const reg = path.join(home, ".claude", "plugins");
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(
      path.join(reg, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "guild@guild": [{ scope: "user", version: "2.3.2" }] } })
    );
    expect(runUpdate()).toMatch(/Detected a HOST-NATIVE Claude Code install/);
  });

  it("rejects TOML headers with trailing junk and near-miss names; accepts quoted/spaced", () => {
    // Drives the REAL sed line from install.sh over the shapes the gate named.
    // The extractor is a FOUR-line chain (header table, dotted assignment,
    // inline table under [marketplaces], dotted-key inline table) with
    // first-hit-wins guards — execute ALL of them in file
    // order, exactly as install.sh does. Probing only the first line silently
    // skips the two forms the round-2 gate added.
    const lines = fs
      .readFileSync(INSTALL_SH, "utf8")
      .split("\n")
      .filter((l) => l.includes('_cx_src="$(sed'))
      .map((l) => l.trim());
    expect(lines).toHaveLength(4);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-toml-"));
    const probe = (toml: string): string => {
      const f = path.join(dir, "config.toml");
      fs.writeFileSync(f, toml);
      const script = lines.map((l) => l.replace(/"\$_cx_home\/config.toml"/, f)).join("\n");
      return sh(`${script}\necho "$_cx_src"`);
    };
    try {
      expect(probe('[marketplaces.guild]\nsource_type = "local"\n')).toBe("local");
      expect(probe('[marketplaces."guild"]\nsource_type = "local"\n')).toBe("local");
      expect(probe("[marketplaces.'guild']\nsource_type = \"local\"\n")).toBe("local");
      expect(probe('[ marketplaces . guild ]\nsource_type = "git"\n')).toBe("git");
      expect(probe('[marketplaces.guild].junk\nsource_type = "local"\n')).toBe("");
      // Round-1 gate: three MORE Codex-accepted forms were misclassified.
      expect(probe("[marketplaces.guild] # my note\nsource_type = 'git'\n")).toBe("git");
      expect(probe('["marketplaces"."guild"]\nsource_type = "local"\n')).toBe("local");
      // Round-2 gate: two MORE Codex-accepted spellings.
      expect(probe('marketplaces.guild.source_type = "git"\nmarketplaces.guild.source = "x"\n')).toBe("git");
      expect(probe('[marketplaces]\nguild = { source_type = "local", source = "/x" }\nother = { source_type = "git" }\n')).toBe("local");
      // Round-3 gate: the natural COMBINATION — dotted key = inline table.
      expect(probe('marketplaces.guild = { source_type = "local", source = "/x" }\n')).toBe("local");
      expect(probe('[marketplaces.guilded]\nsource_type = "git"\n')).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
