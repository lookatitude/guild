/**
 * tests/dot-guild/host-smoke-evidence-gitignore.test.ts
 *
 * verified-multi-host-support L3 — SEC-m1 gitignore disjointness/negation test.
 *
 * The committed host-smoke evidence store (plugin/evidence/host-smoke/**) is
 * narrow-allowlisted in plugin/.gitignore. This test proves against the REAL
 * plugin/.gitignore (copied into a temp git repo — the same method as
 * gitignore-policy.test.ts) that:
 *   1. the receipt tree evidence/host-smoke/** IS admitted (git-trackable),
 *   2. a receipt-shaped file placed ADJACENT (elsewhere under evidence/, or under a
 *      look-alike sibling dir) is NOT un-ignored (SEC-m1 — cannot leak),
 *   3. the allow-list is DISJOINT from /dist/ (packages regenerated, never tracked),
 *      including a receipt-shaped path under dist/.
 *
 * Disjointness of the two audit scopes: the evidence receipt tree (this scan) and any
 * package path (the runs scan / dist) neither overlap nor gap.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync, spawnSync } from "child_process";

const REAL_GITIGNORE = path.resolve(__dirname, "../../.gitignore");

function setupRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-evidence-gi-"));
  fs.copyFileSync(REAL_GITIGNORE, path.join(dir, ".gitignore"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/** true = ignored (git check-ignore exit 0); false = tracked/admitted (exit 1). */
function isIgnored(repoDir: string, relPath: string): boolean {
  const r = spawnSync("git", ["check-ignore", "--no-index", "-q", relPath], { cwd: repoDir, encoding: "utf8" });
  return r.status === 0;
}

describe("host-smoke evidence gitignore (SEC-m1 narrow allow-list, real .gitignore)", () => {
  let dir: string;
  let cleanup: () => void;
  beforeAll(() => { const r = setupRepo(); dir = r.dir; cleanup = r.cleanup; });
  afterAll(() => cleanup());

  // ── 1. receipt tree ADMITTED (the intended tracked path) ─────────────────
  test("evidence/host-smoke/<host>/<box>.json → ADMITTED (tracked)", () => {
    expect(isIgnored(dir, "evidence/host-smoke/cursor/box-a.json")).toBe(false);
    expect(isIgnored(dir, "evidence/host-smoke/github-copilot/box-b.json")).toBe(false);
    expect(isIgnored(dir, "evidence/host-smoke/rovo-dev/box-c.json")).toBe(false);
  });

  // ── 2. adjacent receipt-shaped files IGNORED (SEC-m1) ────────────────────
  test("evidence/<non-host-smoke>/box.json → IGNORED (adjacent, cannot leak)", () => {
    expect(isIgnored(dir, "evidence/scratch/box-a.json")).toBe(true);
    expect(isIgnored(dir, "evidence/local-notes.json")).toBe(true);
  });

  test("evidence/host-smoke-backup/box.json → IGNORED (look-alike sibling dir)", () => {
    // A prefix look-alike must NOT be caught by the host-smoke/ negation.
    expect(isIgnored(dir, "evidence/host-smoke-backup/box-a.json")).toBe(true);
  });

  // ── 3. disjoint from /dist/ (packages regenerated, never tracked) ────────
  test("dist/<host>/<host>-manifest.json → IGNORED (package output, disjoint)", () => {
    expect(isIgnored(dir, "dist/cursor/cursor-manifest.json")).toBe(true);
  });

  test("dist/<host>/host-smoke/box.json → IGNORED (receipt-shaped under dist stays disjoint)", () => {
    expect(isIgnored(dir, "dist/cursor/host-smoke/box-a.json")).toBe(true);
  });

  // ── 4. the share-dot-guild policy block survives (CI gitignore gate) ─────
  test(".gitignore still carries the share-dot-guild policy block", () => {
    const got = fs.readFileSync(REAL_GITIGNORE, "utf8");
    expect(got).toContain("share-dot-guild policy");
  });
});
