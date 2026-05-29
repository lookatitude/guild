/**
 * tests/dot-guild/scrub-coverage.test.ts
 *
 * SC-7 blind-spot guard (security-auditor finding, 2026-05-29).
 *
 * audit.ts only parses scrub.ts's per-file dry-run lines, so any run-dir file
 * that is git-trackable (would be committed/shared) but OUTSIDE scrub's
 * share-set never reaches a redaction pass and silently escapes the SC-7 leak
 * gate. findScrubCoverageGaps closes that hole: it walks each run dir, asks git
 * which files are trackable (NOT ignored), and flags any not covered by scrub.
 *
 * Strategy: plant a temp git repo whose .gitignore mirrors the real run
 * allow-list, drop files into a run dir, and assert audit.ts flags exactly the
 * git-trackable-but-uncovered ones.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawnSync } from "child_process";

const AUDIT_SCRIPT = path.resolve(__dirname, "../../scripts/dot-guild/audit.ts");

// Mirror the real .guild/runs/ allow-list: everything under a run dir is
// ignored EXCEPT handoffs/**, the named scrub-set files, and share-payloads.flag.
const RUN_GITIGNORE = [
  // Mirror the real two-line dir re-open: `.guild` (no slash) ignores the dir,
  // `!.guild/` re-opens it so descendant negations apply (real .gitignore L11-12).
  ".guild",
  "!.guild/",
  "!.guild/runs/",
  "!.guild/runs/*/",
  ".guild/runs/*/**",
  "!.guild/runs/*/handoffs/",
  "!.guild/runs/*/handoffs/**",
  "!.guild/runs/*/verify.md",
  "!.guild/runs/*/review.md",
  "!.guild/runs/*/provenance.json",
  "!.guild/runs/*/summary.md",
  "!.guild/runs/*/share-payloads.flag",
  "",
].join("\n");

function setupRepo(allowRunYaml: boolean): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scrubcov-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  let ignore = RUN_GITIGNORE;
  if (allowRunYaml) ignore += "!.guild/runs/*/run.yaml\n";
  fs.writeFileSync(path.join(dir, ".gitignore"), ignore);
  return {
    dir,
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

function mkRunFile(dir: string, runId: string, rel: string, body = "x\n"): void {
  const full = path.join(dir, ".guild", "runs", runId, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function runAudit(workspaceDir: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("npx", ["tsx", AUDIT_SCRIPT, `--workspace=${workspaceDir}`], { encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

describe("scrub-coverage guard (SC-7 blind spot): git-trackable but uncovered run files", () => {
  test("run.yaml allow-listed but NOT in scrub share-set is flagged scrub-uncovered", () => {
    // Simulates the pre-fix world: run.yaml widened into the allow-list but
    // scrub.ts has no entry for it. (run.yaml IS now in scrub's set, so to
    // reproduce the blind spot we use a differently-named uncovered file.)
    const { dir, cleanup } = setupRepo(false);
    try {
      // ledger.json: invented file, allow-listed via a custom rule, no scrub cover.
      fs.appendFileSync(path.join(dir, ".gitignore"), "!.guild/runs/*/ledger.json\n");
      mkRunFile(dir, "run-A", "ledger.json", "cwd: /Users/op/Projects/secret\n");
      const r = runAudit(dir);
      expect(r.stdout).toMatch(/scrub-uncovered/);
      expect(r.stdout).toMatch(/ledger\.json/);
      expect(r.status).toBe(1); // actionable ⇒ CI fails
    } finally { cleanup(); }
  });

  test("covered files (verify.md, handoffs/**) are NOT flagged scrub-uncovered", () => {
    const { dir, cleanup } = setupRepo(false);
    try {
      mkRunFile(dir, "run-B", "verify.md");
      mkRunFile(dir, "run-B", "handoffs/receipt.md");
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/scrub-uncovered/);
    } finally { cleanup(); }
  });

  test("ignored (non-shared) files are NOT flagged — events.ndjson without flag", () => {
    const { dir, cleanup } = setupRepo(false);
    try {
      // events.ndjson is ignored by the allow-list (no opt-in) ⇒ not shared ⇒
      // not a coverage gap even though it's outside the named scrub-set.
      mkRunFile(dir, "run-C", "events.ndjson", "{}\n");
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/scrub-uncovered/);
    } finally { cleanup(); }
  });

  test("share-payloads.flag is exempt — trackable but carries no operator content", () => {
    const { dir, cleanup } = setupRepo(false);
    try {
      mkRunFile(dir, "run-D", "share-payloads.flag", "");
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/scrub-uncovered/);
    } finally { cleanup(); }
  });

  test("run.yaml IS now covered by scrub — allow-listing it does NOT trip the guard", () => {
    // Post-fix: run.yaml is in scrub's SHARED_SCRUBBED_NAMES, so even when the
    // allow-list widens to share it, the guard stays quiet (scrub covers it).
    const { dir, cleanup } = setupRepo(true);
    try {
      mkRunFile(dir, "run-E", "run.yaml", "cwd: /Users/op/Projects/x\nroot: /Users/op/Projects/x\n");
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/scrub-uncovered/);
    } finally { cleanup(); }
  });
});
