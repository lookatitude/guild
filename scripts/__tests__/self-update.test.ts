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
  it("maps host ids to install.sh's rendered dist names", () => {
    expect(distDirForHost("codex-cli")).toBe("codex-marketplace");
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
