/**
 * tests/dot-guild/model-catalog-cache-exclusion.test.ts — lane T4
 * (run-20260730-131020-dynamic-host-model-routing).
 *
 * The model-catalog discovery cache (.guild/indexes/model-catalog/) is
 * runtime-local machine state (guild.model_catalog.v1 §7): it must be denied
 * by every workspace repo's .gitignore AND gated by audit.ts's coverage leg.
 * Anti-vacuity: the audit leg is proven against a planted positive (a
 * trackable and a force-tracked cache file in a scratch git repo) — a green
 * zero-findings result on the real repos is only trusted because the same
 * code flags the planted leaks.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { findModelCatalogCacheLeaks } from "../../scripts/dot-guild/audit";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const WORKSPACE_ROOT = path.resolve(PLUGIN_ROOT, "..");

function git(cwd: string, ...args: string[]): { status: number | null; stdout: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "" };
}

function isGitWorkTree(p: string): boolean {
  if (!fs.existsSync(p)) return false;
  const r = git(p, "rev-parse", "--is-inside-work-tree");
  return r.status === 0 && r.stdout.trim() === "true";
}

// The plugin repo (this test ships in it) is ALWAYS verified — it is the repo
// this CI owns. Sibling repos and the umbrella root are verified only when the
// umbrella-workspace layout is checked out (local dev); in the plugin-only CI
// checkout they are absent, and their .gitignore/audit legs belong to their own
// repos' CI. Filtering to existing git work-trees keeps this checkout-robust
// (mirrors check-docs-architecture's skip-when-umbrella-absent posture) instead
// of asserting against non-existent paths.
const REPOS = [
  PLUGIN_ROOT,
  WORKSPACE_ROOT,
  path.join(WORKSPACE_ROOT, "benchmark"),
  path.join(WORKSPACE_ROOT, "website"),
].filter(isGitWorkTree);

describe("model-catalog cache exclusion (both scrub-policy legs + .gitignore deny)", () => {
  test.each(REPOS)("%s: .gitignore denies .guild/indexes/model-catalog/**", (repo) => {
    const probe = ".guild/indexes/model-catalog/some-key.json";
    const res = git(repo, "check-ignore", probe);
    expect(res.status).toBe(0); // exit 0 = ignored = never shared
  });

  test.each(REPOS)("%s: audit coverage leg reports zero cache leaks today", (repo) => {
    expect(findModelCatalogCacheLeaks(repo)).toEqual([]);
  });

  test("anti-vacuity: planted cache leaks ARE flagged in a scratch git repo", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cache-leak-"));
    git(scratch, "init", "-q");
    const cacheDir = path.join(scratch, ".guild", "indexes", "model-catalog");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "entry.json"), '{"generation":1}\n', "utf8");

    // No deny line yet: the file is git-trackable -> flagged.
    const before = findModelCatalogCacheLeaks(scratch);
    expect(before).toHaveLength(1);
    expect(before[0].kind).toBe("catalog-cache-tracked");
    expect(before[0].detail).toContain("trackable");

    // Adding the canonical deny line clears the trackable flag.
    fs.writeFileSync(path.join(scratch, ".gitignore"), ".guild/indexes/model-catalog/\n", "utf8");
    expect(findModelCatalogCacheLeaks(scratch)).toEqual([]);

    // Force-tracked despite the deny (git add -f) is still flagged as TRACKED.
    git(scratch, "add", "-f", ".guild/indexes/model-catalog/entry.json");
    const tracked = findModelCatalogCacheLeaks(scratch);
    expect(tracked).toHaveLength(1);
    expect(tracked[0].detail).toContain("TRACKED");
    // And the tracked-only CI posture catches it too.
    expect(findModelCatalogCacheLeaks(scratch, true)).toHaveLength(1);
  });

  test("scrub.ts carries the matching warn leg (both legs updated together)", () => {
    const scrubSrc = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts/dot-guild/scrub.ts"), "utf8");
    expect(scrubSrc).toContain("warnTrackableModelCatalogCache");
    expect(scrubSrc).toContain("model-catalog");
  });
});
