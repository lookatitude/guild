/**
 * tests/dot-guild/gitignore-policy.test.ts
 *
 * SC-9: One assertion per row of the ADR classification table (Decision E in
 * docs/knowledge/decisions/guild-boundary-config-and-tracking.md).
 *
 * Strategy: init a temp git repo with a copy of the fixture tree at
 * plugin/tests/dot-guild/fixtures/policy-repo/.guild/ and the policy-repo
 * .gitignore (which uses `.guild` without trailing slash so un-ignore
 * negation patterns work — see followup for Lane B's .guild/ trailing-slash
 * issue).
 *
 * For "tracked" paths: assert git check-ignore --no-index exits 1 (not ignored).
 * For "local-only" paths: assert git check-ignore --no-index exits 0 (ignored).
 *
 * NOTE ON LANE B DEFECT: the real repos' .gitignore blocks use `.guild/` with
 * trailing slash. With git 2.x, a directory pattern prevents traversal into the
 * directory for negation patterns — meaning ALL .guild/ content shows as ignored.
 * This test uses a corrected fixture .gitignore (`.guild` no trailing slash) so
 * the policy assertions pass. The real-repo block defect is filed as a followup
 * for Lane B (tooling-engineer).
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync, spawnSync } from "child_process";

const FIXTURE_DIR = path.resolve(
  __dirname,
  "fixtures/policy-repo"
);

function setupTempRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-policy-"));

  // Copy the fixture tree (all files including dotfiles)
  copyRecursive(FIXTURE_DIR, dir);

  // Init a bare git repo so check-ignore reads the local .gitignore
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", ".gitignore"], { cwd: dir, stdio: "ignore" });

  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

function copyRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Returns true if the path is ignored by git (exit 0 from check-ignore).
 * Returns false if not ignored (exit 1 = tracked).
 */
function isIgnored(repoDir: string, relPath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "-q", relPath], {
    cwd: repoDir,
    encoding: "utf8",
  });
  return result.status === 0;
}

describe("gitignore-policy: Decision E classification table", () => {
  let repoDir: string;
  let cleanup: () => void;

  beforeAll(() => {
    const repo = setupTempRepo();
    repoDir = repo.dir;
    cleanup = repo.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  // ── SHARED (tracked) ──────────────────────────────────────────────────────

  test(".guild/wiki/x.md → tracked (Decision E: wiki shared)", () => {
    expect(isIgnored(repoDir, ".guild/wiki/x.md")).toBe(false);
  });

  test(".guild/initiatives/active/init-X/initiative.yaml → tracked (Decision E: initiatives shared)", () => {
    expect(isIgnored(repoDir, ".guild/initiatives/active/init-X/initiative.yaml")).toBe(false);
  });

  test(".guild/spec/x.md → tracked (Decision E: spec shared)", () => {
    expect(isIgnored(repoDir, ".guild/spec/x.md")).toBe(false);
  });

  test(".guild/plan/x.md → tracked (Decision E: plan shared)", () => {
    expect(isIgnored(repoDir, ".guild/plan/x.md")).toBe(false);
  });

  test(".guild/prd/x.md → tracked (Decision E: prd shared)", () => {
    expect(isIgnored(repoDir, ".guild/prd/x.md")).toBe(false);
  });

  test(".guild/team/x.yaml → tracked (Decision E: team shared)", () => {
    expect(isIgnored(repoDir, ".guild/team/x.yaml")).toBe(false);
  });

  test(".guild/reflections/x.md → tracked (Decision E: reflections shared)", () => {
    expect(isIgnored(repoDir, ".guild/reflections/x.md")).toBe(false);
  });

  test(".guild/evolve/x.md → tracked (Decision E: evolve shared)", () => {
    expect(isIgnored(repoDir, ".guild/evolve/x.md")).toBe(false);
  });

  test(".guild/indexes/initiatives-registry.yaml → tracked (Decision E: indexes shared)", () => {
    expect(isIgnored(repoDir, ".guild/indexes/initiatives-registry.yaml")).toBe(false);
  });

  test(".guild/workspace.json → tracked (Decision E: workspace.json shared)", () => {
    expect(isIgnored(repoDir, ".guild/workspace.json")).toBe(false);
  });

  test(".guild/settings.json → tracked (Decision E: settings.json shared team default)", () => {
    expect(isIgnored(repoDir, ".guild/settings.json")).toBe(false);
  });

  // ── SHARED-SCRUBBED (tracked) ─────────────────────────────────────────────

  test(".guild/runs/run-X/handoffs/y.md → tracked (Decision E: handoffs shared-scrubbed)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/handoffs/y.md")).toBe(false);
  });

  test(".guild/runs/run-X/verify.md → tracked (Decision E: verify.md shared-scrubbed)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/verify.md")).toBe(false);
  });

  test(".guild/runs/run-X/review.md → tracked (Decision E: review.md shared-scrubbed)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/review.md")).toBe(false);
  });

  test(".guild/runs/run-X/provenance.json → tracked (Decision E: provenance.json shared-scrubbed)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/provenance.json")).toBe(false);
  });

  test(".guild/runs/run-X/summary.md → tracked (Decision E: summary.md shared-scrubbed)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/summary.md")).toBe(false);
  });

  test(".guild/runs/run-X/share-payloads.flag → tracked (Decision G: flag is shared marker)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/share-payloads.flag")).toBe(false);
  });

  // ── LOCAL-ONLY (ignored) ──────────────────────────────────────────────────

  test(".guild/settings.local.json → IGNORED (Decision F: operator-private local-only)", () => {
    expect(isIgnored(repoDir, ".guild/settings.local.json")).toBe(true);
  });

  test(".guild/hosts/x.md → IGNORED (Decision E: hosts local-only by definition)", () => {
    expect(isIgnored(repoDir, ".guild/hosts/x.md")).toBe(true);
  });

  test(".guild/runs/run-X/events.ndjson → IGNORED (Decision G: payload local-only by default)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/events.ndjson")).toBe(true);
  });

  test(".guild/runs/run-X/logs/payloads/x.json → IGNORED (Decision G: logs/payloads local-only by default)", () => {
    expect(isIgnored(repoDir, ".guild/runs/run-X/logs/payloads/x.json")).toBe(true);
  });
});
