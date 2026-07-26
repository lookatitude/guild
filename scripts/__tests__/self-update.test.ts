/**
 * scripts/__tests__/self-update.test.ts
 *
 * guild-run update (wrapper-host apply adapter): dist-dir mapping, receipt
 * gating, dev-checkout refusal (AC-5), offline fail-open, and the up-to-date
 * short-circuit. The clone/render/swap path is exercised with an injected
 * runner that fabricates the rendered tree — no network, no real npm.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { distDirForHost, readReceipt, runSelfUpdate } from "../lib/self-update";
import { RECEIPT_BASENAME, RECEIPT_SCHEMA } from "../lib/update-check";

const SHA_A = "a".repeat(40);

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function pkgWithReceipt(channel: "beta" | "stable" = "beta"): string {
  const pkg = mkTmp("guild-pkg-");
  fs.writeFileSync(
    path.join(pkg, RECEIPT_BASENAME),
    JSON.stringify({
      schema_version: RECEIPT_SCHEMA,
      host: "codex-cli",
      channel,
      ref: channel === "beta" ? "next" : "main",
      commit: SHA_A,
      version: "2.1.0",
      installed_at: "2026-07-12T00:00:00Z",
    })
  );
  return pkg;
}

const silent = { log: () => {} };

describe("distDirForHost", () => {
  it("maps host ids to the dist tree matching the INSTALLED package root", () => {
    // codex-cli must point at the marketplace's nested PAYLOAD, not the
    // marketplace root: the installed root (Codex plugin cache) has
    // .codex-plugin/plugin.json at top level, and the swap copies this dist
    // path over it verbatim. See the regression suite below for the corruption
    // the root-level mapping caused.
    expect(distDirForHost("codex-cli")).toBe(path.join("codex-marketplace", "plugins", "guild"));
    expect(distDirForHost("pi-cli")).toBe("pi");
    expect(distDirForHost("antigravity-cli")).toBe("antigravity");
    expect(distDirForHost("kiro")).toBe("agents");
    expect(distDirForHost("agents-file")).toBe("agents");
    expect(distDirForHost("cursor")).toBe("cursor");
  });
});

describe("runSelfUpdate gating", () => {
  it("refuses a dev checkout (AC-5) before any network call", () => {
    const pkg = pkgWithReceipt();
    fs.mkdirSync(path.join(pkg, ".git"), { recursive: true });
    fs.writeFileSync(path.join(pkg, ".git", "HEAD"), "ref: refs/heads/next\n");
    let networkTouched = false;
    const rc = runSelfUpdate({
      pkgRoot: pkg,
      deps: { ...silent, run: () => void (networkTouched = true) },
    });
    expect(rc).toBe(1);
    expect(networkTouched).toBe(false);
  });

  it("refuses without a receipt, naming the recovery path", () => {
    const pkg = mkTmp("guild-noreceipt-");
    const lines: string[] = [];
    const rc = runSelfUpdate({ pkgRoot: pkg, deps: { log: (l) => lines.push(l) } });
    expect(rc).toBe(1);
    expect(lines.join("\n")).toContain(RECEIPT_BASENAME);
    expect(lines.join("\n")).toContain("install.sh");
  });

  it("fails open when the remote check errors (offline)", () => {
    const pkg = pkgWithReceipt();
    const rc = runSelfUpdate({
      pkgRoot: pkg,
      deps: {
        ...silent,
        run: () => {
          throw new Error("offline");
        },
      },
    });
    expect(rc).toBe(1);
    // package untouched
    expect(readReceipt(pkg)!.commit).toBe(SHA_A);
  });

});

/** Create a tiny local git repo (main + next branches) to act as the remote. */
function makeLocalRemote(): string {
  const repo = mkTmp("guild-remote-");
  const { execFileSync } = require("child_process") as typeof import("child_process");
  const g = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "f"), "x");
  g("add", "f");
  g("commit", "-qm", "c");
  g("branch", "next");
  return repo;
}

/**
 * REGRESSION — codex-cli staged swap must source the marketplace PAYLOAD.
 *
 * Until xhrd-wi-05 this path was dead for Codex: installs carried no receipt,
 * so runSelfUpdate refused before the swap and the wrong distDirForHost row
 * ("codex-marketplace", the marketplace ROOT) never executed. install.sh now
 * writes a resolvable receipt into the installed cache dir, which arms the
 * swap — and swapping the marketplace ROOT over a payload-shaped install root
 * buries .codex-plugin/plugin.json under plugins/guild/ and corrupts the
 * install on the FIRST real update. This drives the actual clone→render→swap
 * against a local remote + a fabricated render, no network / npm / tsx.
 *
 * NON-VACUITY: verified to FAIL against the pre-fix distDirForHost — the
 * `.codex-plugin/plugin.json at the top of the swapped root` assertion (and
 * the `no plugins/guild nesting` one) both trip when the marketplace root is
 * copied instead of the payload.
 */
describe("runSelfUpdate codex-cli staged swap uses the marketplace payload", () => {
  const cleanups: string[] = [];
  const track = (p: string) => {
    cleanups.push(p);
    return p;
  };
  afterAll(() => {
    for (const p of cleanups) fs.rmSync(p, { recursive: true, force: true });
  });

  it("lands .codex-plugin/plugin.json at the TOP of the swapped root, no plugins/guild nesting", () => {
    const { execFileSync } = require("child_process") as typeof import("child_process");
    // Local "remote": next is one commit ahead of the receipt's commit, and the
    // checkout carries .claude-plugin/plugin.json (runSelfUpdate reads the new
    // version from the CLONE's manifest, not the rendered tree).
    const repo = track(mkTmp("guild-remote-swap-"));
    const g = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    fs.mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "guild", version: "9.9.9" })
    );
    g("add", "-A");
    g("commit", "-qm", "old");
    const oldSha = g("rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "f"), "new-content");
    g("add", "-A");
    g("commit", "-qm", "new");
    const newSha = g("rev-parse", "HEAD");
    g("branch", "next");

    // Installed package root: the PAYLOAD shape install.sh's receipt points at
    // (Codex plugin cache layout) — .codex-plugin/plugin.json at top level.
    const pkg = track(mkTmp("guild-codex-pkg-"));
    fs.mkdirSync(path.join(pkg, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "guild", version: "2.1.0" })
    );
    fs.writeFileSync(
      path.join(pkg, RECEIPT_BASENAME),
      JSON.stringify({
        schema_version: RECEIPT_SCHEMA,
        host: "codex-cli",
        channel: "beta",
        ref: "next",
        commit: oldSha,
        version: "2.1.0",
        installed_at: "2026-07-12T00:00:00Z",
      })
    );
    // The staged-swap siblings live NEXT TO pkg inside its mkdtemp parent, so
    // track() on pkg already covers them; still remove leftovers explicitly.
    track(`${pkg}.update-staging`);
    track(`${pkg}.update-old`);

    // Injected runner: git clone runs for real (local path, offline); npm ci is
    // skipped; the build-host-packages render is FABRICATED with the real
    // renderer's marketplace shape — payload nested under plugins/guild, the
    // marketplace manifest beside it. That nesting is exactly what the buggy
    // mapping used to copy wholesale.
    const run = (cmd: string, args: string[], opts?: { cwd?: string }) => {
      if (cmd === "git") {
        execFileSync(cmd, args, { stdio: "ignore" });
        return;
      }
      if (cmd === "npm") return;
      if (cmd === "npx") {
        const cloneDir = opts?.cwd;
        if (!cloneDir) throw new Error("render invoked without cwd");
        const payload = path.join(cloneDir, "dist", "codex-marketplace", "plugins", "guild");
        fs.mkdirSync(path.join(payload, ".codex-plugin"), { recursive: true });
        fs.writeFileSync(
          path.join(payload, ".codex-plugin", "plugin.json"),
          JSON.stringify({ name: "guild", version: "9.9.9" })
        );
        fs.mkdirSync(path.join(payload, "bin"), { recursive: true });
        fs.writeFileSync(path.join(payload, "bin", "guild-run"), "#!/bin/sh\n");
        fs.mkdirSync(
          path.join(cloneDir, "dist", "codex-marketplace", ".agents", "plugins"),
          { recursive: true }
        );
        fs.writeFileSync(
          path.join(cloneDir, "dist", "codex-marketplace", ".agents", "plugins", "marketplace.json"),
          JSON.stringify({ name: "guild" })
        );
        return;
      }
      throw new Error(`unexpected command: ${cmd}`);
    };

    const lines: string[] = [];
    const rc = runSelfUpdate({ pkgRoot: pkg, repo, deps: { log: (l) => lines.push(l), run } });
    expect(rc).toBe(0);

    // The swapped root must have the PAYLOAD shape: manifest at the top, new
    // version. Under the pre-fix mapping this file does not exist (it sits at
    // plugins/guild/.codex-plugin/plugin.json instead) — the non-vacuity trip.
    const manifestPath = path.join(pkg, ".codex-plugin", "plugin.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(
      (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: string }).version
    ).toBe("9.9.9");
    // No double nesting: the marketplace root's plugins/guild/ and
    // .agents/plugins/marketplace.json must NOT be inside the install root.
    expect(fs.existsSync(path.join(pkg, "plugins", "guild"))).toBe(false);
    expect(fs.existsSync(path.join(pkg, ".agents", "plugins", "marketplace.json"))).toBe(false);
    // Payload contents made it across, and the receipt was regenerated at the
    // new root with the new commit + version (existing behavior).
    expect(fs.existsSync(path.join(pkg, "bin", "guild-run"))).toBe(true);
    const receipt = readReceipt(pkg)!;
    expect(receipt.commit).toBe(newSha);
    expect(receipt.version).toBe("9.9.9");
    // The staged-swap intermediates were cleaned up.
    expect(fs.existsSync(`${pkg}.update-staging`)).toBe(false);
    expect(fs.existsSync(`${pkg}.update-old`)).toBe(false);
  });
});

describe("runSelfUpdate up-to-date with real local remote", () => {
  it("matches SHA → exit 0, nothing changed", () => {
    const repo = makeLocalRemote();
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const nextSha = execFileSync("git", ["-C", repo, "rev-parse", "next"], {
      encoding: "utf8",
    }).trim();
    const pkg = mkTmp("guild-pkg2-");
    fs.writeFileSync(
      path.join(pkg, RECEIPT_BASENAME),
      JSON.stringify({
        schema_version: RECEIPT_SCHEMA,
        host: "codex-cli",
        channel: "beta",
        ref: "next",
        commit: nextSha,
        version: "2.1.0",
        installed_at: "2026-07-12T00:00:00Z",
      })
    );
    const lines: string[] = [];
    const rc = runSelfUpdate({
      pkgRoot: pkg,
      repo,
      deps: { log: (l) => lines.push(l), run: () => {} },
    });
    expect(rc).toBe(0);
    expect(lines.join("\n")).toContain("up to date");
    expect(readReceipt(pkg)!.commit).toBe(nextSha);
  });
});
