/**
 * scripts/__tests__/guild-root-cwd-anchor.test.ts
 *
 * Regression test: telemetry write side must resolve to the REPO ROOT's
 * .guild/ regardless of process cwd.
 *
 * Decision: .guild/wiki/decisions/telemetry-anchors-to-repo-root-not-cwd.md
 *
 * The bug: when emit-loop-event.ts / run-lifecycle.ts ran with
 * cwd=plugin/scripts/, they used raw process.cwd() as the .guild/ base,
 * accreting a stray scripts/.guild/ (21 run dirs, 16 MB).
 *
 * Coverage:
 *   1. resolveGuildRoot (scripts/lib/guild-root) — walk-up and anchor.
 *   2. emit-loop-event.ts — with CWD set to a sub-dir of a temp repo root,
 *      the write lands at <repo-root>/.guild/runs/, NOT <subdir>/.guild/.
 *   3. Anti-vacuity: the write ALSO appears under the correct repo-root path
 *      (so the test is not trivially green by writing nothing).
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveGuildRoot } from "../lib/guild-root";

const EMIT_LOOP_EVENT = path.resolve(__dirname, "../emit-loop-event.ts");

// Suppress Node-internal/tsx-loader warnings so stderr assertions are clean.
const SPAWN_ENV = { ...process.env, NODE_NO_WARNINGS: "1" };
delete (SPAWN_ENV as Record<string, string | undefined>)["GUILD_RUN_ID"];
delete (SPAWN_ENV as Record<string, string | undefined>)["GUILD_CWD"];

// ── 1. resolveGuildRoot unit ──────────────────────────────────────────────────

describe("resolveGuildRoot (scripts/lib/guild-root)", () => {
  let repoRoot: string;
  let subDir: string;

  beforeEach(() => {
    // Hermetic temp repo: a parent with .git marker, plus a sub-directory.
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-root-test-repo-"));
    // Create a .git FILE (like a git worktree) — resolveGuildRoot accepts both
    // directory and file for .git.
    fs.writeFileSync(path.join(repoRoot, ".git"), "gitdir: /tmp/fake");
    subDir = path.join(repoRoot, "scripts");
    fs.mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns the repo root when called with the repo root itself", () => {
    const resolved = resolveGuildRoot(repoRoot);
    expect(resolved).toBe(repoRoot);
  });

  it("walks UP from a sub-dir to the repo root (the .git anchor)", () => {
    const resolved = resolveGuildRoot(subDir);
    expect(resolved).toBe(repoRoot);
    // Key invariant: the resolved root is NOT the sub-dir.
    expect(resolved).not.toBe(subDir);
    expect(resolved).not.toContain(path.join(subDir, ""));
  });

  it("falls back to startCwd when no anchor exists above", () => {
    // A truly isolated dir with no .git or .guild above it.
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "guild-root-isolated-"));
    try {
      const resolved = resolveGuildRoot(isolated);
      // Should return the isolated dir itself (fallback), not some ancestor.
      expect(path.resolve(resolved)).toBe(path.resolve(isolated));
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("also anchors at a .guild directory (for repos without .git)", () => {
    const noGitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-root-nogit-"));
    fs.mkdirSync(path.join(noGitRoot, ".guild"), { recursive: true });
    const deep = path.join(noGitRoot, "scripts", "lib");
    fs.mkdirSync(deep, { recursive: true });
    try {
      const resolved = resolveGuildRoot(deep);
      expect(resolved).toBe(noGitRoot);
    } finally {
      fs.rmSync(noGitRoot, { recursive: true, force: true });
    }
  });
});

// ── 2. emit-loop-event sub-dir cwd regression ─────────────────────────────────

describe("emit-loop-event sub-dir cwd regression", () => {
  let repoRoot: string;
  let subDir: string;

  beforeEach(() => {
    // Hermetic temp repo: parent with .guild marker + .guild/runs/ pre-created.
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-emit-loop-test-"));
    fs.mkdirSync(path.join(repoRoot, ".guild", "runs"), { recursive: true });

    // sub-dir simulates cwd=plugin/scripts/ (the bug scenario).
    subDir = path.join(repoRoot, "scripts");
    fs.mkdirSync(subDir, { recursive: true });

    // Write the current-run-id sentinel to <repo-root>/.guild/runs/ so
    // emit-loop-event can resolve the run-id via the sentinel path.
    const runId = "run-guild-root-regression";
    fs.writeFileSync(
      path.join(repoRoot, ".guild", "runs", "current-run-id"),
      runId,
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("writes to <repo-root>/.guild/runs/ even when cwd is a sub-dir", () => {
    const runId = "run-guild-root-regression";

    // Spawn emit-loop-event with --cwd pointing at the SUB-DIR (the bug scenario).
    const result = spawnSync(
      "npx",
      [
        "tsx",
        EMIT_LOOP_EVENT,
        "--cwd",
        subDir,          // <-- intentionally a sub-dir, not the repo root
        "--event",
        "loop_round_start",
        "--layer",
        "L1",
        "--lane",
        "phase:build",
        "--round",
        "1",
        "--cap",
        "5",
      ],
      { encoding: "utf8", timeout: 20000, env: SPAWN_ENV },
    );

    // Script must exit 0 (telemetry failures don't block execution).
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    // ── Anti-vacuity: the event MUST appear at the repo-root path ──────────
    const correctLogPath = path.join(
      repoRoot,
      ".guild",
      "runs",
      runId,
      "logs",
      "v1.4-events.jsonl",
    );
    expect(fs.existsSync(correctLogPath)).toBe(true);
    const lines = fs.readFileSync(correctLogPath, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse(lines[0]);
    expect(event).toMatchObject({
      event: "loop_round_start",
      run_id: runId,
      lane_id: "phase:build",
      loop_layer: "L1",
      round_number: 1,
      cap: 5,
    });

    // ── No stray <sub-dir>/.guild/ created ──────────────────────────────────
    const strayGuild = path.join(subDir, ".guild");
    expect(fs.existsSync(strayGuild)).toBe(false);
  });

  it("ALSO writes correctly when --cwd is the repo root (canonical path unchanged)", () => {
    const runId = "run-guild-root-regression";

    const result = spawnSync(
      "npx",
      [
        "tsx",
        EMIT_LOOP_EVENT,
        "--cwd",
        repoRoot,        // <-- canonical path
        "--event",
        "loop_round_start",
        "--layer",
        "L2",
        "--lane",
        "phase:qa",
        "--round",
        "1",
        "--cap",
        "10",
      ],
      { encoding: "utf8", timeout: 20000, env: SPAWN_ENV },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const logPath = path.join(
      repoRoot,
      ".guild",
      "runs",
      runId,
      "logs",
      "v1.4-events.jsonl",
    );
    expect(fs.existsSync(logPath)).toBe(true);
    const event = JSON.parse(
      fs.readFileSync(logPath, "utf8").trim().split("\n")[0],
    );
    expect(event).toMatchObject({
      event: "loop_round_start",
      run_id: runId,
      loop_layer: "L2",
      lane_id: "phase:qa",
    });
  });
});
