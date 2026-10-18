/**
 * #219 — init scaffolds an ignore rule for run-local state so a re-init on a
 * committed repo does not churn .guild/runs/. Never clobbers, and never hides
 * runs in a repo that already tracks (shares) them.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { ensureRunsGitignored } from "../lib/runs-gitignore";

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });

describe("ensureRunsGitignored (#219)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-runs-ignore-"));
    git(root, "init", "-q");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("writes .guild/.gitignore so git ignores .guild/runs/", () => {
    expect(ensureRunsGitignored(root)).toBe(true);
    fs.mkdirSync(path.join(root, ".guild", "runs", "run-x"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-x\n");
    fs.writeFileSync(path.join(root, ".guild", "runs", "run-x", "run.yaml"), "status: open\n");
    expect(git(root, "check-ignore", "-q", ".guild/runs/run-x/run.yaml").status).toBe(0);
    expect(git(root, "check-ignore", "-q", ".guild/runs/current-run-id").status).toBe(0);
    expect(git(root, "status", "--porcelain").stdout.trim()).toBe("?? .guild/");
    expect(git(root, "status", "--porcelain", "-uall").stdout.trim()).toBe("?? .guild/.gitignore");
  });

  it("is idempotent and never clobbers an existing .guild/.gitignore", () => {
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", ".gitignore"), "custom\n");
    expect(ensureRunsGitignored(root)).toBe(false);
    expect(fs.readFileSync(path.join(root, ".guild", ".gitignore"), "utf8")).toBe("custom\n");
  });

  it("leaves a repo that already tracks runs alone (run sharing opted in)", () => {
    fs.mkdirSync(path.join(root, ".guild", "runs", "run-a"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs", "run-a", "run.yaml"), "status: closed\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "share runs");
    expect(ensureRunsGitignored(root)).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", ".gitignore"))).toBe(false);
  });

  it("does nothing outside a git work tree", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "guild-runs-ignore-plain-"));
    try {
      expect(ensureRunsGitignored(plain)).toBe(false);
      expect(fs.existsSync(path.join(plain, ".guild"))).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
