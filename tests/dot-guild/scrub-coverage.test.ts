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
// T6B-R2-B1: the audit CLI runs through the PACKAGE-LOCAL runtime (no ambient npx).
import { runTsCli } from "./ts-runtime-helper";

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
  "!.guild/runs/*/logs/",
  "!.guild/runs/*/logs/v1.4-events.jsonl",
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

function runAudit(
  workspaceDir: string,
  env?: Record<string, string>,
): { stdout: string; stderr: string; status: number | null; out: string } {
  const result = runTsCli(AUDIT_SCRIPT, [`--workspace=${workspaceDir}`], { env });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, out: result.out };
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

  test("canonical lifecycle log is trackable and covered without share-payloads.flag", () => {
    const { dir, cleanup } = setupRepo(false);
    try {
      mkRunFile(dir, "run-F", "logs/v1.4-events.jsonl", "{}\n");
      expect(spawnSync("git", ["-C", dir, "check-ignore", "-q", ".guild/runs/run-F/logs/v1.4-events.jsonl"]).status).toBe(1);
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/scrub-uncovered/);
    } finally { cleanup(); }
  });
});

// ── T6B-R2-B1: the coverage gate must FAIL CLOSED, and must actually bite ─────────
//
// Round-2 review, verbatim: a git-trackable `.guild/runs/<r>/handoffs/receipt.md`
// carrying a bearer token and `/home/y/private/file` produced exit 0 + "No actionable
// flags", because audit.ts spawned AMBIENT `npx` and checked neither `result.error` nor
// `result.status`. Two independent properties are pinned below:
//
//   (1) ANTI-VACUITY — the exact planted receipt IS flagged (and a clean one is not),
//       so a green audit means something.
//   (2) FAIL-CLOSED — when the scrub coverage pass cannot execute (launch failure,
//       non-zero exit, or a runtime that exits 0 without running scrub), the audit
//       exits non-zero and says so; it NEVER prints "No actionable flags".
//
// Both drive the shipped CLI through the package-local runtime. The scrub-launch
// failure is induced through the SHIPPED `GUILD_TSX_RUNTIME` resolution path — the
// same code that resolves the real runtime — not a test-only branch inside audit.ts.
describe("audit fail-closed + trackable-handoff anti-vacuity (T6B-R2-B1)", () => {
  // The literal planted values from the round-2 finding.
  const BEARER = "Authorization: Bearer sk-live-abcdefghijklmnop1234567890";
  const PRIVATE_PATH = "/home/y/private/file";

  /** A repo whose .gitignore really shares handoffs/** , with one planted receipt. */
  function repoWithHandoff(body: string): { dir: string; cleanup: () => void; receiptRel: string } {
    const { dir, cleanup } = setupRepo(false);
    const receiptRel = ".guild/runs/run-r2/handoffs/receipt.md";
    mkRunFile(dir, "run-r2", "handoffs/receipt.md", body);
    return { dir, cleanup, receiptRel };
  }

  /** Proof the planted receipt really would be shared (git does NOT ignore it). */
  function isGitTrackable(dir: string, rel: string): boolean {
    const r = spawnSync("git", ["-C", dir, "check-ignore", "-q", rel], { encoding: "utf8" });
    return r.status === 1; // 0 = ignored, 1 = NOT ignored ⇒ trackable/shareable
  }

  /** A stand-in "runtime" that never runs scrub — used for the fail-closed probes. */
  function stubRuntime(dir: string, name: string, script: string): string {
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, script, { mode: 0o755 });
    fs.chmodSync(abs, 0o755);
    return abs;
  }

  test("planted bearer token + /home/y/private/file in a TRACKABLE handoff → audit FLAGS it (exit 1)", () => {
    const { dir, cleanup, receiptRel } = repoWithHandoff(
      `# receipt\ntoken: ${BEARER}\npath: ${PRIVATE_PATH}\n`,
    );
    try {
      // Non-vacuity precondition: the file is genuinely git-trackable (would be shared).
      expect(isGitTrackable(dir, receiptRel)).toBe(true);

      const r = runAudit(dir);
      expect(r.status).toBe(1);                       // actionable ⇒ gate fails
      expect(r.stdout).toMatch(/\bsecret\b/);          // the bearer token is caught
      expect(r.stdout).toMatch(/operator-path/);       // /home/y/private/file is caught
      expect(r.stdout).toMatch(/run-r2/);
      expect(r.stdout).toMatch(/handoffs\/receipt\.md/);
      expect(r.out).not.toMatch(/No actionable flags/);
    } finally { cleanup(); }
  });

  test("clean trackable handoff → NO flags, exit 0 (the gate is not always-firing)", () => {
    const { dir, cleanup, receiptRel } = repoWithHandoff("# receipt\nstatus: done\nlane: T6b\n");
    try {
      expect(isGitTrackable(dir, receiptRel)).toBe(true);
      const r = runAudit(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toMatch(/operator-path|scrub-uncovered/);
      expect(r.out).toMatch(/No actionable flags/);
      expect(r.out).not.toMatch(/FAIL-CLOSED/);
    } finally { cleanup(); }
  });

  test("scrub CANNOT LAUNCH → audit FAILS CLOSED (exit 1, never 'No actionable flags')", () => {
    // Same secret-bearing tree as the anti-vacuity case: had the audit failed OPEN,
    // it would have reported this tree clean — exactly the round-2 defect.
    const { dir, cleanup } = repoWithHandoff(`# receipt\ntoken: ${BEARER}\npath: ${PRIVATE_PATH}\n`);
    try {
      const r = runAudit(dir, { GUILD_TSX_RUNTIME: path.join(dir, "no-such-runtime") });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/FAIL-CLOSED/);
      expect(r.stderr).toMatch(/scrub coverage could not run/);
      expect(r.stdout).toMatch(/scrub-unavailable/);
      expect(r.out).not.toMatch(/No actionable flags/);
    } finally { cleanup(); }
  });

  test("scrub exits NON-ZERO → audit FAILS CLOSED (status is checked, not just stdout)", () => {
    const { dir, cleanup } = repoWithHandoff("# receipt\nstatus: done\n");
    try {
      const stub = stubRuntime(dir, "exit3.sh", "#!/bin/sh\nexit 3\n");
      const r = runAudit(dir, { GUILD_TSX_RUNTIME: stub });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/FAIL-CLOSED/);
      expect(r.stderr).toMatch(/status 3/);
      expect(r.out).not.toMatch(/No actionable flags/);
    } finally { cleanup(); }
  });

  test("scrub exits 0 but never ran (no summary marker) → audit STILL fails closed", () => {
    const { dir, cleanup } = repoWithHandoff("# receipt\nstatus: done\n");
    try {
      const stub = stubRuntime(dir, "silent-ok.sh", "#!/bin/sh\nexit 0\n");
      const r = runAudit(dir, { GUILD_TSX_RUNTIME: stub });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/FAIL-CLOSED/);
      expect(r.stderr).toMatch(/no scrub summary marker/);
      expect(r.out).not.toMatch(/No actionable flags/);
    } finally { cleanup(); }
  });
});
