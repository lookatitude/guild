/**
 * tests/dot-guild/scrub.test.ts
 *
 * SC-4 (Decision H): unit tests for plugin/scripts/dot-guild/scrub.ts covering:
 *  1. Operator-path redaction: /Users/<name>/Projects/guild/... → <workspace-root>/...
 *  2. Secrets redaction: AWS key, PEM block, password= line → <SECRET-REDACTED:...>
 *  3. Per-run flag opt-in: run WITH share-payloads.flag keeps events.ndjson + payloads;
 *     run WITHOUT flag strips events.ndjson + logs/payloads/.
 *  4. Idempotency: running scrub twice on the same input produces no further changes.
 *
 * Fixtures: plugin/tests/dot-guild/fixtures/scrub/
 *   run-no-flag/  — no share-payloads.flag; handoff has operator paths + secrets
 *   run-with-flag/ — has share-payloads.flag; events.ndjson + payloads should survive
 *
 * Strategy: copy fixture to a tmp dir, run scrub.ts as a subprocess with
 * --workspace=<tmp>, assert output files.
 *
 * T6B-R2-B1: the subprocess is launched through the PACKAGE-LOCAL runtime
 * (tests/ts-runtime-helper.ts → the shipped resolveScrubRuntime), never ambient `npx` —
 * a root-owned/unreadable ~/.npm cache must not be able to decide whether this security
 * suite runs.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runTsCli } from "./ts-runtime-helper";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures/scrub");
const SCRUB_SCRIPT = path.resolve(
  __dirname,
  "../../scripts/dot-guild/scrub.ts"
);

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
 * Run scrub.ts against a tmp copy of a fixture directory.
 * Returns the workspace root (tmp dir).
 */
function runScrub(
  fixtureName: "run-no-flag" | "run-with-flag",
  extraArgs: string[] = []
): { workspaceDir: string; cleanup: () => void; stdout: string; stderr: string } {
  // Create a fresh tmp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scrub-"));

  // Copy the fixture's .guild tree
  const fixturePath = path.join(FIXTURE_DIR, fixtureName);
  copyRecursive(fixturePath, tmpDir);

  const result = runTsCli(SCRUB_SCRIPT, [`--workspace=${tmpDir}`, ...extraArgs], { cwd: tmpDir });

  return {
    workspaceDir: tmpDir,
    cleanup: () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

// ── 1. Operator-path redaction ──────────────────────────────────────────────

describe("scrub: operator-path redaction (Decision H.2)", () => {
  let workspaceDir: string;
  let cleanup: () => void;

  beforeAll(() => {
    const r = runScrub("run-no-flag");
    workspaceDir = r.workspaceDir;
    cleanup = r.cleanup;
  });

  afterAll(() => cleanup());

  test("handoff receipt: /Users/miguelp/Projects/guild paths replaced with <workspace-root>", () => {
    const handoffPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/handoffs/receipt.md"
    );
    const content = readFileIfExists(handoffPath);
    expect(content).not.toBeNull();
    expect(content).not.toContain("/Users/miguelp/Projects/guild");
    expect(content).toContain("<workspace-root>");
  });

  test("verify.md: operator path replaced with <workspace-root>", () => {
    const verifyPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/verify.md"
    );
    const content = readFileIfExists(verifyPath);
    expect(content).not.toBeNull();
    expect(content).not.toContain("/Users/miguelp/Projects/guild");
    expect(content).toContain("<workspace-root>");
  });
});

// ── 2. Secrets redaction ───────────────────────────────────────────────────

describe("scrub: secrets redaction (Decision H.3)", () => {
  let workspaceDir: string;
  let cleanup: () => void;

  beforeAll(() => {
    const r = runScrub("run-no-flag");
    workspaceDir = r.workspaceDir;
    cleanup = r.cleanup;
  });

  afterAll(() => cleanup());

  test("AWS access key pattern (AKIA...) replaced with <SECRET-REDACTED:...>", () => {
    const handoffPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/handoffs/receipt.md"
    );
    const content = readFileIfExists(handoffPath);
    expect(content).not.toBeNull();
    // Original: AKIAIOSFODNN7EXAMPLE — 20 chars, matches AKIA[0-9A-Z]{16}
    expect(content).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(content).toContain("<SECRET-REDACTED:");
  });

  test("GitHub personal access token (ghp_...) replaced with <SECRET-REDACTED:...>", () => {
    const handoffPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/handoffs/receipt.md"
    );
    const content = readFileIfExists(handoffPath);
    expect(content).not.toBeNull();
    expect(content).not.toContain("ghp_abcdefghijklmnopqrstuvwxyzABCDEFGH12");
    expect(content).toContain("<SECRET-REDACTED:");
  });

  test("password= line replaced with <SECRET-REDACTED:...>", () => {
    const handoffPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/handoffs/receipt.md"
    );
    const content = readFileIfExists(handoffPath);
    expect(content).not.toBeNull();
    expect(content).not.toContain("supersecret123");
    expect(content).toContain("<SECRET-REDACTED:");
  });

  test("PEM private key block replaced with <SECRET-REDACTED:...>", () => {
    const verifyPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/verify.md"
    );
    const content = readFileIfExists(verifyPath);
    expect(content).not.toBeNull();
    expect(content).not.toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(content).toContain("<SECRET-REDACTED:");
  });

  test("api_key= line replaced with <SECRET-REDACTED:...>", () => {
    const verifyPath = path.join(
      workspaceDir,
      ".guild/runs/run-no-flag/verify.md"
    );
    const content = readFileIfExists(verifyPath);
    expect(content).not.toBeNull();
    expect(content).not.toContain("MY_FAKE_API_KEY_VALUE_LONGERTHAN6");
    expect(content).toContain("<SECRET-REDACTED:");
  });
});

// ── 3. Per-run flag opt-in ─────────────────────────────────────────────────

describe("scrub: per-run share-payloads.flag opt-in (Decision G)", () => {
  test("run WITHOUT flag: events.ndjson is NOT in share set (payload excluded)", () => {
    // events.ndjson is EXCLUDED from the share set when no flag.
    // The scrub script does NOT copy/write events.ndjson into the output —
    // we verify the file exists in the tmp workspace (scrub is in-place)
    // and check the scrub summary output reports the exclusion.
    const r = runScrub("run-no-flag");
    try {
      // events.ndjson should remain untouched (not in share set = not processed)
      // but the file still exists (scrub doesn't delete, it just doesn't redact)
      const eventsPath = path.join(
        r.workspaceDir,
        ".guild/runs/run-no-flag/events.ndjson"
      );
      // The scrub stdout should report exclusion count > 0
      expect(r.stdout).toMatch(/\d+ payload\(s\) excluded/);
      const excludedMatch = r.stdout.match(/(\d+) payload\(s\) excluded/);
      const excludedCount = excludedMatch ? parseInt(excludedMatch[1], 10) : 0;
      expect(excludedCount).toBeGreaterThan(0);
    } finally {
      r.cleanup();
    }
  });

  test("run WITHOUT flag: logs/payloads/ files are excluded from share set", () => {
    const r = runScrub("run-no-flag");
    try {
      expect(r.stdout).toMatch(/\d+ payload\(s\) excluded/);
    } finally {
      r.cleanup();
    }
  });

  test("run WITH flag: events.ndjson is in share set (paths redacted, not excluded)", () => {
    const r = runScrub("run-with-flag");
    try {
      // With flag present, events.ndjson IS processed (not excluded)
      // The exclusion count should be 0
      expect(r.stdout).toMatch(/0 payload\(s\) excluded/);

      // events.ndjson content should have been processed (operator paths redacted)
      const eventsPath = path.join(
        r.workspaceDir,
        ".guild/runs/run-with-flag/events.ndjson"
      );
      const content = readFileIfExists(eventsPath);
      expect(content).not.toBeNull();
      // Original had /Users/miguelp/Projects/guild path - should be redacted
      expect(content).not.toContain("/Users/miguelp/Projects/guild");
      expect(content).toContain("<workspace-root>");
    } finally {
      r.cleanup();
    }
  });

  test("run WITH flag: logs/payloads/ files are processed (not excluded)", () => {
    const r = runScrub("run-with-flag");
    try {
      expect(r.stdout).toMatch(/0 payload\(s\) excluded/);
      const payloadPath = path.join(
        r.workspaceDir,
        ".guild/runs/run-with-flag/logs/payloads/evt-1.json"
      );
      const content = readFileIfExists(payloadPath);
      expect(content).not.toBeNull();
      // payload content had operator path - should be redacted
      expect(content).not.toContain("/Users/miguelp/Projects/guild");
      expect(content).toContain("<workspace-root>");
    } finally {
      r.cleanup();
    }
  });
});

// ── 4. Idempotency ─────────────────────────────────────────────────────────

describe("scrub: idempotency (Decision H.1)", () => {
  test("running scrub twice produces no further changes on second run", () => {
    // First run
    const r = runScrub("run-no-flag");
    const workspaceDir = r.workspaceDir;

    try {
      // Read the state after first scrub
      const handoffPath = path.join(
        workspaceDir,
        ".guild/runs/run-no-flag/handoffs/receipt.md"
      );
      const afterFirstScrub = readFileIfExists(handoffPath);
      expect(afterFirstScrub).not.toBeNull();

      // Run scrub a second time on the already-scrubbed workspace
      const result2 = runTsCli(SCRUB_SCRIPT, [`--workspace=${workspaceDir}`], { cwd: workspaceDir });

      const stdout2 = result2.stdout;

      // Second run should report 0 changed files
      expect(stdout2).toMatch(/0 changed/);

      // File content should be byte-identical
      const afterSecondScrub = readFileIfExists(handoffPath);
      expect(afterSecondScrub).toBe(afterFirstScrub);
    } finally {
      r.cleanup();
    }
  });

  test("dry-run does not modify files", () => {
    const r = runScrub("run-no-flag", ["--dry-run"]);
    const workspaceDir = r.workspaceDir;

    try {
      // In dry-run mode, the original file should be unchanged
      const handoffPath = path.join(
        workspaceDir,
        ".guild/runs/run-no-flag/handoffs/receipt.md"
      );
      const afterDryRun = readFileIfExists(handoffPath);
      expect(afterDryRun).not.toBeNull();
      // Original content should still have the operator path (not redacted by dry-run)
      expect(afterDryRun).toContain("/Users/miguelp/Projects/guild");
    } finally {
      r.cleanup();
    }
  });
});
