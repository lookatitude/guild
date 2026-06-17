/**
 * scripts/__tests__/retention-guild-root-anchor.test.ts
 *
 * Regression: scripts/lib/retention.ts CLI block must resolve its .guild/
 * base from the repo root (via resolveGuildRoot), not raw process.cwd().
 *
 * Decision: .guild/wiki/decisions/telemetry-anchors-to-repo-root-not-cwd.md
 *
 * Coverage:
 *   (a) From a sub-dir cwd, retention.ts targets the repo-root .guild/ scan
 *       path (not <subdir>/.guild/).
 *   (b) An explicit --guild-dir is honored unchanged — anti-vacuity: prove the
 *       script actually reads the correct dir and reports on its contents.
 *
 * Strategy: spawn `tsx lib/retention.ts` with a controlled cwd and inspect
 * stdout for the guildDir the script actually used. We use a temp repo (with
 * a .guild marker) + a sub-dir so resolveGuildRoot walks correctly.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RETENTION_SCRIPT = path.resolve(__dirname, "../lib/retention.ts");

const SPAWN_ENV = { ...process.env, NODE_NO_WARNINGS: "1" };
delete (SPAWN_ENV as Record<string, string | undefined>)["GUILD_CWD"];

/**
 * Build a minimal expired provenance.json so retention has something to report.
 * Closed 120 days before "now" (2026-01-01) → well past the 90-day threshold.
 */
function makeExpiredRun(runsDir: string, runId: string): void {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "provenance.json"),
    JSON.stringify({
      run_id: runId,
      retention_class: "one-off-90d",
      closed_at: "2025-09-01T00:00:00Z", // 120d before 2026-01-01
    }),
  );
}

describe("retention CLI cwd-anchor regression", () => {
  let repoRoot: string;
  let subDir: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ret-anchor-"));
    // Anchor: .guild dir at the repo root (no .git needed — resolveGuildRoot
    // accepts .guild directories as anchors).
    fs.mkdirSync(path.join(repoRoot, ".guild", "runs"), { recursive: true });

    // sub-dir simulates running from plugin/scripts/ or a similar subdirectory.
    subDir = path.join(repoRoot, "scripts");
    fs.mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("(a) resolves to repo-root .guild/ even when process cwd is a sub-dir", () => {
    // Place an expired run under the REPO ROOT's .guild/runs/ so the script
    // reports it — proving the script actually scanned the correct directory.
    const runId = "run-ret-anchor-test";
    makeExpiredRun(path.join(repoRoot, ".guild", "runs"), runId);

    // Run with --now set to 2026-01-01 so the 2025-09-01 run is definitely expired.
    const result = spawnSync(
      "npx",
      [
        "tsx",
        RETENTION_SCRIPT,
        "--now",
        "2026-01-01T00:00:00Z",
        // No --guild-dir: the CLI block must walk up from cwd=subDir.
      ],
      {
        cwd: subDir,  // <-- intentionally a sub-dir; the bug scenario
        encoding: "utf8",
        timeout: 20000,
        env: SPAWN_ENV,
      },
    );

    expect(result.status).toBe(0);
    // Script found the expired run (proving it targeted <repo-root>/.guild/runs/).
    // In dry-run mode it prints DRY-RUN + the run id.
    expect(result.stdout).toContain("run-ret-anchor-test");
    expect(result.stdout).toContain("DRY-RUN");

    // No stray sub-dir .guild/ created.
    expect(fs.existsSync(path.join(subDir, ".guild"))).toBe(false);
  });

  it("(b) an explicit --guild-dir is honored unchanged (anti-vacuity)", () => {
    // Use an entirely separate temp dir as the --guild-dir target.
    const explicitGuildDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "guild-ret-explicit-"),
    );
    const explicitRunsDir = path.join(explicitGuildDir, "runs");
    fs.mkdirSync(explicitRunsDir, { recursive: true });

    // Only put the expired run in the EXPLICIT dir (not the repo root).
    const runId = "run-explicit-guild-dir";
    makeExpiredRun(explicitRunsDir, runId);

    try {
      const result = spawnSync(
        "npx",
        [
          "tsx",
          RETENTION_SCRIPT,
          "--guild-dir",
          explicitGuildDir,
          "--now",
          "2026-01-01T00:00:00Z",
        ],
        {
          cwd: subDir, // cwd is still the sub-dir, but --guild-dir must win
          encoding: "utf8",
          timeout: 20000,
          env: SPAWN_ENV,
        },
      );

      expect(result.status).toBe(0);
      // Found the run in the EXPLICIT dir — proving --guild-dir was honored.
      expect(result.stdout).toContain("run-explicit-guild-dir");
      expect(result.stdout).toContain("DRY-RUN");

      // The repo-root .guild/ was NOT scanned (it has no expired runs).
      // Since the explicit dir was used, the repo-root run must NOT appear.
      expect(result.stdout).not.toContain("run-ret-anchor-test");
    } finally {
      fs.rmSync(explicitGuildDir, { recursive: true, force: true });
    }
  });
});
