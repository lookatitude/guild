/**
 * tests/dot-guild/t7-audit-fail-closed.test.ts
 *
 * T7 security-audit remediation — H3 + M1 regression pins.
 *
 * H3: `git check-ignore` exit 128 (and any spawn error / non-1 status) used to
 *     SILENTLY DISABLE the catalog-cache leak gate. 128 is git's generic fatal
 *     exit, not a "not a git repo" signal — it also fires on `safe.directory`
 *     dubious ownership (ubiquitous in containers/CI), a corrupt `.git/config`,
 *     and an unreadable `.git`. The auditor reproduced a byte-identical tree
 *     with the machine-local fingerprint salt force-committed rendering as
 *     "No actionable flags — safe to proceed with SC-10 commits", exit 0.
 *
 * M1: a non-existent (or typo'd / CWD-relative) `--repos` path yielded a clean
 *     audit pass, making the whole leak gate vacuous while reporting success.
 *
 * REAL PATH, NO SEAM. Every case below drives the SHIPPED `audit.ts` CLI as a
 * subprocess through the package-local runtime — the same entry point CI runs.
 * Nothing here imports an internal helper to stand in for the gate.
 *
 * ANTI-VACUITY. Each fail-closed case is paired with a POSITIVE control over a
 * byte-identical HEALTHY tree that must still produce the real leak flags — so
 * a green here can never mean "the audit stopped detecting anything".
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { runTsCli } from "./ts-runtime-helper";

const AUDIT = path.resolve(__dirname, "../../scripts/dot-guild/audit.ts");

function git(cwd: string, ...args: string[]): number | null {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).status;
}

/**
 * Build the auditor's exact fixture: a git repo whose `.guild/indexes/model-catalog/`
 * carries the machine-local `.fp-salt` + a cache entry, both FORCE-ADDED to the
 * index despite the deny line. With the salt in hand every `fp-…` digest is
 * brute-forceable, so this is the SC-13 non-reversibility collapse case.
 */
function makeLeakingRepo(root: string, name: string): string {
  const repo = path.join(root, name);
  const cacheDir = path.join(repo, ".guild", "indexes", "model-catalog");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(repo, ".gitignore"), ".guild/indexes/model-catalog/\n", "utf8");
  fs.writeFileSync(path.join(cacheDir, ".fp-salt"), "0123456789abcdef0123456789abcdef", "utf8");
  fs.writeFileSync(path.join(cacheDir, "entry-a.json"), '{"generation":1}\n', "utf8");
  git(repo, "init", "-q");
  git(repo, "add", "-f", ".guild/indexes/model-catalog/.fp-salt");
  git(repo, "add", "-f", ".guild/indexes/model-catalog/entry-a.json");
  return repo;
}

/** Break git for this repo the way the auditor did: a corrupt `.git/config`. */
function breakGit(repo: string): void {
  fs.appendFileSync(path.join(repo, ".git", "config"), "\nthis is not valid config\n", "utf8");
}

describe("T7-H3/M1 — audit.ts git legs fail CLOSED (real CLI)", () => {
  let workspace: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "t7-audit-failclosed-"));
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  // ── ANTI-VACUITY POSITIVE CONTROL ────────────────────────────────────────
  test("POSITIVE CONTROL: a healthy git tree still flags the force-committed salt + cache entry", () => {
    const repo = makeLeakingRepo(workspace, "healthy");
    const run = runTsCli(AUDIT, [`--workspace=${workspace}`, `--repos=${repo}`]);

    expect(run.status).toBe(1); // actionable ⇒ CI/gate fails
    expect(run.out).toContain("catalog-cache-tracked");
    expect(run.out).toContain(".guild/indexes/model-catalog/.fp-salt");
    expect(run.out).toContain(".guild/indexes/model-catalog/entry-a.json");
    // The detection leg is what proves the fail-closed cases below are non-vacuous.
    expect(run.out).not.toContain("No actionable flags");
  });

  // ── H3 ────────────────────────────────────────────────────────────────────
  test("H3: a git that exits 128 is `audit-unavailable`, NOT a clean pass", () => {
    const repo = makeLeakingRepo(workspace, "broken-git");
    breakGit(repo);
    // Precondition: this really is the 128 the auditor reproduced.
    expect(spawnSync("git", ["-C", repo, "check-ignore", "--stdin", "-z"], {
      input: "",
      encoding: "utf8",
    }).status).toBe(128);

    const run = runTsCli(AUDIT, [`--workspace=${workspace}`, `--repos=${repo}`]);

    expect(run.status).toBe(1); // was 0
    expect(run.out).toContain("audit-unavailable");
    expect(run.out).toContain("FAIL-CLOSED");
    // The old report said "No actionable flags — safe to proceed with SC-10 commits".
    expect(run.out).not.toContain("No actionable flags");
    expect(run.out).not.toContain("safe to proceed with SC-10 commits");
  });

  test("H3: 'not a git repo' is determined POSITIVELY (filesystem), never inferred from an exit code", () => {
    // A directory with NO .git anywhere upward is genuinely outside a work tree.
    // It must be classified differently from a broken-git tree — the whole point
    // of the fix is that an error code can no longer masquerade as "not a repo".
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "t7-nogit-"));
    try {
      const run = runTsCli(AUDIT, [`--workspace=${outside}`, `--repos=${outside}`]);
      expect(run.status).toBe(1);
      expect(run.out).toContain("not inside a git work tree");
      expect(run.out).not.toContain("No actionable flags");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // ── M1 ────────────────────────────────────────────────────────────────────
  test("M1: a non-existent --repos path fails closed instead of passing clean", () => {
    const run = runTsCli(AUDIT, [
      `--workspace=${workspace}`,
      `--repos=${path.join(workspace, "DOES-NOT-EXIST")}`,
    ]);

    expect(run.status).toBe(1); // was 0
    expect(run.out).toContain("audit-unavailable");
    expect(run.out).toContain("does not exist");
    expect(run.out).not.toContain("No actionable flags");
  });

  test("M1: a RELATIVE --repos entry resolves against --workspace, not the process CWD", () => {
    // `--repos=healthy` must reach <workspace>/healthy (the leaking repo built
    // above), not `<cwd>/healthy`. The old code resolved against the plugin CWD
    // and reported a clean pass over a path that does not exist.
    const run = runTsCli(AUDIT, [`--workspace=${workspace}`, "--repos=healthy"], {
      cwd: path.resolve(__dirname, "../.."), // plugin/ — deliberately NOT the workspace
    });

    expect(run.status).toBe(1);
    expect(run.out).toContain("catalog-cache-tracked");
    // The resolved ABSOLUTE path is printed per repo (M1's reporting leg).
    expect(run.stderr).toContain(path.join(workspace, "healthy"));
  });
});
