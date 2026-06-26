/**
 * tests/dot-guild/structural-cache-gitignore.test.ts
 *
 * FIX-T4.1-r6 — close the Codex MAJOR on the structural-cache trust model.
 *
 * The cache validator (scripts/learn/lib/bundle-validate.ts) trusts the
 * per-file structural cache on PROVENANCE + INTEGRITY (checksum) alone, which is
 * sound ONLY because the cache is a LOCAL-ONLY, never-shared derived artifact.
 * Codex flagged that this assumption was FALSE: `!.guild/indexes/**` re-includes
 * the indexes dir, so `.guild/indexes/<graph>.structural-cache.json` was
 * shareable — a committed, tampered cache with a recomputed checksum would
 * bypass validation on a victim's tree.
 *
 * The fix appends an explicit, later structural-cache-sidecar deny (a
 * "double-star slash star-dot-structural-cache-dot-json" glob) to the local-only
 * re-deny section of every workspace `.gitignore`, AFTER the `!.guild/indexes`
 * re-include so it wins. This test guards that fix against
 * the REAL, shipped `.gitignore` (read from disk, not a fixture) in BOTH
 * directions:
 *   (a) the sidecar is ignored (the trust model now holds), and
 *   (b) a normal index artifact (knowledge-graph.json) is NOT over-ignored.
 *
 * Non-vacuity: removing the deny rule fails (a); broadening it to ignore all of
 * `.guild/indexes/**` fails (b). Both branches are asserted.
 *
 * Strategy mirrors gitignore-policy.test.ts — copy the real `.gitignore` into a
 * temp git repo and use `git check-ignore --no-index` (no working files needed).
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync, spawnSync } from "child_process";

// plugin repo root = two levels up from tests/dot-guild/.
const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const REAL_GITIGNORE = path.join(PLUGIN_ROOT, ".gitignore");

function setupTempRepoFromRealGitignore(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-structcache-"));
  // Copy the REAL shipped .gitignore so this test guards the actual artifact:
  // a future edit that drops the deny rule (or over-broadens it) fails here.
  fs.copyFileSync(REAL_GITIGNORE, path.join(dir, ".gitignore"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", ".gitignore"], { cwd: dir, stdio: "ignore" });
  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/** True iff git ignores `relPath` (check-ignore exit 0). */
function isIgnored(repoDir: string, relPath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "-q", relPath], {
    cwd: repoDir,
    encoding: "utf8",
  });
  return result.status === 0;
}

describe("structural-cache sidecar is gitignored (FIX-T4.1-r6 trust-model precondition)", () => {
  let repoDir: string;
  let cleanup: () => void;

  beforeAll(() => {
    const repo = setupTempRepoFromRealGitignore();
    repoDir = repo.dir;
    cleanup = repo.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  // (a) The sidecar — the path the checksum-only trust model assumes is local-only.
  test(".guild/indexes/<graph>.structural-cache.json → IGNORED (never shareable)", () => {
    expect(isIgnored(repoDir, ".guild/indexes/anything.structural-cache.json")).toBe(true);
  });

  test("nested .guild/indexes/sub/x.structural-cache.json → IGNORED", () => {
    expect(isIgnored(repoDir, ".guild/indexes/sub/x.structural-cache.json")).toBe(true);
  });

  // (b) Anti-over-ignore: the re-include for normal index artifacts must still win
  // for everything that is NOT a structural-cache sidecar.
  test(".guild/indexes/knowledge-graph.json → NOT ignored (still tracked, not over-ignored)", () => {
    expect(isIgnored(repoDir, ".guild/indexes/knowledge-graph.json")).toBe(false);
  });

  test(".guild/indexes/initiatives-registry.yaml → NOT ignored (still tracked)", () => {
    expect(isIgnored(repoDir, ".guild/indexes/initiatives-registry.yaml")).toBe(false);
  });
});
