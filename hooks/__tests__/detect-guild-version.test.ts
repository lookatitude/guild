/**
 * hooks/__tests__/detect-guild-version.test.ts
 *
 * TDD: written before detect-guild-version.ts implementation.
 *
 * Verifies SC-2 behaviour:
 *   - v2 tree      → silent (no stdout, exit 0)
 *   - none tree    → silent (no stdout, exit 0)
 *   - v1 tree      → stdout contains the surfaced prompt block (migrate/dry-run/skip)
 *   - mixed tree   → stdout contains the surfaced prompt block (migrate/dry-run/skip)
 *   - corrupt tree → stdout contains the DISTINCT corrupt message (dry-run only)
 *   - missing dir  → silent (no stdout, exit 0)
 *   - bad stdin    → silent (no stdout, exit 0) — never throws
 *   - workspace child: a v1 child repo under a v2 parent → child surfaces (Fix E / F6)
 *
 * Runs the compiled dist/detect-guild-version.js (built by hooks/package.json build).
 * Tests that require the source run via tsx (pre-build dev path).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT_SRC = path.resolve(__dirname, "../detect-guild-version.ts");
const DIST_JS = path.resolve(__dirname, "../dist/detect-guild-version.js");

// SessionStart fixture payload
const SESSION_START_BASE = {
  session_id: "sess-test-123",
  hook_event_name: "SessionStart",
  permission_mode: "default",
};

function makePayload(cwd: string): string {
  return JSON.stringify({ ...SESSION_START_BASE, cwd });
}

function runScript(
  input: string,
  env: Record<string, string> = {},
  useDist = false
): { exitCode: number; stdout: string; stderr: string } {
  const cmd = useDist ? "node" : "npx";
  const args = useDist ? [DIST_JS] : ["tsx", SCRIPT_SRC];
  const result = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ── Fixture helpers ────────────────────────────────────────────────────────

/**
 * Build a minimal v1 .guild tree: config.yml (the definitive v1 signal).
 */
function makeV1GuildDir(tmpDir: string): string {
  const guildDir = path.join(tmpDir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  // config.yml is the canonical v1 marker (P2 in detect.ts)
  fs.writeFileSync(path.join(guildDir, "config.yml"), "agent_team: true\n", "utf8");
  return tmpDir;
}

/**
 * Build a minimal v2 .guild tree: settings.json (the v2 signal, no v1 keys).
 */
function makeV2GuildDir(tmpDir: string): string {
  const guildDir = path.join(tmpDir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildDir, "settings.json"),
    JSON.stringify({ schema_version: "guild.settings.v1" }),
    "utf8"
  );
  return tmpDir;
}

/**
 * Build a mixed .guild tree: both config.yml (M1) and settings.json (M2) present.
 */
function makeMixedGuildDir(tmpDir: string): string {
  const guildDir = path.join(tmpDir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(path.join(guildDir, "config.yml"), "agent_team: true\n", "utf8");
  fs.writeFileSync(
    path.join(guildDir, "settings.json"),
    JSON.stringify({ agent_mode: "auto" }),
    "utf8"
  );
  return tmpDir;
}

/**
 * Build a corrupt .guild tree: settings.json with invalid JSON.
 */
function makeCorruptGuildDir(tmpDir: string): string {
  const guildDir = path.join(tmpDir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(path.join(guildDir, "settings.json"), "{ invalid json !!", "utf8");
  return tmpDir;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("detect-guild-version hook", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hook-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  // ── silent cases ──────────────────────────────────────────────────────────

  test("v2 tree → silent exit 0, no stdout", () => {
    const root = makeV2GuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  test("no .guild dir → silent exit 0, no stdout", () => {
    // tmpBase has no .guild/
    const res = runScript(makePayload(tmpBase));
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  test("bad stdin JSON → silent exit 0, no stdout", () => {
    const res = runScript("not-json-at-all");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  test("empty stdin → silent exit 0, no stdout", () => {
    const res = runScript("");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  // ── v1 surfaces ───────────────────────────────────────────────────────────

  test("v1 tree → surfaces migrate/dry-run/skip block to stdout", () => {
    const root = makeV1GuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("v1 .guild detected");
    expect(res.stdout).toContain("migrate");
    expect(res.stdout).toContain("dry-run");
    expect(res.stdout).toContain("skip");
    // Must include the exact migrate command script name
    expect(res.stdout).toContain("migrate-guild.ts");
    expect(res.stdout).toContain("--mode=migrate");
    expect(res.stdout).toContain("--mode=dry-run");
    // Fix A: dry-run description must be accurate (writes a report, not "nothing")
    expect(res.stdout).not.toContain("writes nothing");
    expect(res.stdout).toContain("dry-run report");
  });

  test("v1 tree → surfaces --workspace flag mention", () => {
    const root = makeV1GuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("--workspace");
  });

  // ── mixed surfaces ────────────────────────────────────────────────────────

  test("mixed tree → surfaces migrate/dry-run/skip block to stdout", () => {
    const root = makeMixedGuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("v1 .guild detected");
    expect(res.stdout).toContain("migrate");
    expect(res.stdout).toContain("dry-run");
    expect(res.stdout).toContain("--mode=migrate");
    expect(res.stdout).toContain("--mode=dry-run");
  });

  // ── corrupt surfaces distinct message ─────────────────────────────────────

  test("corrupt tree → surfaces distinct corrupt message, NOT the migrate offer", () => {
    const root = makeCorruptGuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("corrupt");
    expect(res.stdout).toContain("--mode=dry-run");
    // Must NOT offer --mode=migrate (corrupt is blocked)
    expect(res.stdout).not.toContain("--mode=migrate");
  });

  test("corrupt tree → suggests manual review", () => {
    const root = makeCorruptGuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    // Should contain a manual review hint
    expect(res.stdout.toLowerCase()).toMatch(/manual|inspect|review/);
  });

  // ── GUILD_CWD env override ─────────────────────────────────────────────────

  test("GUILD_CWD env overrides payload cwd", () => {
    const v1Root = makeV1GuildDir(tmpBase);
    // Pass a non-existent cwd in payload but correct one via env
    const payload = makePayload("/nonexistent/path");
    const res = runScript(payload, { GUILD_CWD: v1Root });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("v1 .guild detected");
  });

  // ── Fix E (F6): workspace child — v1 child under v2 parent surfaces ─────────
  //
  // Scenario: a workspace root has a v2 .guild/. One of its child repos has a
  // v1 .guild/. Guild is one-.guild-per-repo: each repo's .guild/ is its own
  // detection unit. When the session cwd is inside the v1 child, resolveGuildRoot
  // walks up and finds the child root — detect() sees v1 → surfaces.
  // When cwd is the v2 parent root, detect() sees v2 → silent.
  //
  // This validates the "surfaced-per-repo" contract: the parent's v2 state does
  // not suppress the child's v1 surface (or vice versa).

  test("workspace: v1 child under v2 parent → child root surfaces, parent root silent", () => {
    // Build parent root with v2 .guild/
    const parentRoot = tmpBase;
    makeV2GuildDir(parentRoot);

    // Build a child repo under the parent (child has its own .git marker + v1 .guild/)
    const childRoot = path.join(parentRoot, "child-repo");
    fs.mkdirSync(childRoot, { recursive: true });
    // Give the child a .git file so resolveGuildRoot anchors at the child
    fs.writeFileSync(path.join(childRoot, ".git"), "gitdir: ../.git/worktrees/child\n", "utf8");
    makeV1GuildDir(childRoot);

    // cwd = child repo root → resolves to child → v1 → surfaces
    const resChild = runScript(makePayload(childRoot));
    expect(resChild.exitCode).toBe(0);
    expect(resChild.stdout).toContain("v1 .guild detected");
    expect(resChild.stdout).toContain("--mode=migrate");

    // cwd = parent root → resolves to parent → v2 → silent
    const resParent = runScript(makePayload(parentRoot));
    expect(resParent.exitCode).toBe(0);
    expect(resParent.stdout.trim()).toBe("");
  });

  // ── dist build smoke test ──────────────────────────────────────────────────

  test("dist/detect-guild-version.js exists", () => {
    expect(fs.existsSync(DIST_JS)).toBe(true);
  });

  test("dist build: v2 tree → silent", () => {
    if (!fs.existsSync(DIST_JS)) {
      console.warn("Skipping dist test — dist/detect-guild-version.js not yet built");
      return;
    }
    const root = makeV2GuildDir(tmpBase);
    const res = runScript(makePayload(root), {}, true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  test("dist build: v1 tree → surfaces", () => {
    if (!fs.existsSync(DIST_JS)) {
      console.warn("Skipping dist test — dist/detect-guild-version.js not yet built");
      return;
    }
    const root = makeV1GuildDir(tmpBase);
    const res = runScript(makePayload(root), {}, true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("v1 .guild detected");
  });

  // ── Fix B redo: path quoting + resolution ────────────────────────────────

  test("Fix B: migrate-guild.ts path is double-quoted in surfaced command", () => {
    // Ensures a path with spaces doesn't break copy-paste.
    const root = makeV1GuildDir(tmpBase);
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    // The migrate-guild.ts path must appear inside double quotes in the command.
    expect(res.stdout).toMatch(/npx tsx ".*migrate-guild\.ts"/);
  });

  test("Fix B: CLAUDE_PLUGIN_ROOT path takes precedence over __dirname fallback", () => {
    const root = makeV1GuildDir(tmpBase);
    // Point CLAUDE_PLUGIN_ROOT at a fake (non-existent) plugin root.
    // The hook should still use that path (it returns the candidate even if absent).
    const fakeRoot = path.join(tmpBase, "fake-plugin-root");
    const expectedPath = path.join(fakeRoot, "scripts/dot-guild/migrate-guild.ts");
    const res = runScript(makePayload(root), { CLAUDE_PLUGIN_ROOT: fakeRoot });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(expectedPath);
  });

  test("Fix B: GUILD_PLUGIN_ROOT takes precedence over CLAUDE_PLUGIN_ROOT", () => {
    const root = makeV1GuildDir(tmpBase);
    const guildRoot = path.join(tmpBase, "guild-plugin-root");
    const claudeRoot = path.join(tmpBase, "claude-plugin-root");
    const expectedPath = path.join(guildRoot, "scripts/dot-guild/migrate-guild.ts");
    const res = runScript(makePayload(root), {
      GUILD_PLUGIN_ROOT: guildRoot,
      CLAUDE_PLUGIN_ROOT: claudeRoot,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(expectedPath);
    expect(res.stdout).not.toContain(path.join(claudeRoot, "scripts/dot-guild/migrate-guild.ts"));
  });

  test("Fix B: dist build uses absolute path (not relative plugin/...)", () => {
    // The dist build must never surface the old hardcoded relative path.
    if (!fs.existsSync(DIST_JS)) {
      console.warn("Skipping dist Fix-B path test — dist not yet built");
      return;
    }
    const root = makeV1GuildDir(tmpBase);
    const res = runScript(makePayload(root), {}, true);
    expect(res.exitCode).toBe(0);
    // Must NOT contain the old hardcoded relative prefix.
    expect(res.stdout).not.toContain("npx tsx plugin/scripts");
    // Must contain an absolute path (starts with /).
    expect(res.stdout).toMatch(/npx tsx "\/.*migrate-guild\.ts"/);
  });

  // ── Fix D redo: node budget counts dirs, not just files ───────────────────
  //
  // We test the walk() budget indirectly by verifying that a v1 tree with a
  // large flat directory count still classifies correctly (doesn't stall or
  // false-positive). A direct unit test of walk() with an empty-dir tree is
  // provided below via the converter's detect() directly (no hook spawn needed).

  test("Fix D: v1 tree with many empty subdirs still classifies correctly", () => {
    // Build a v1 tree that has many empty directories alongside the v1 marker.
    // This exercises the node-budget path without hitting the cap (real .guild/
    // trees are small; we just confirm the classification is correct).
    const root = makeV1GuildDir(tmpBase);
    const guildDir = path.join(root, ".guild");
    // Add 50 empty subdirectories — well within cap but exercises dir counting.
    for (let i = 0; i < 50; i++) {
      fs.mkdirSync(path.join(guildDir, `empty-dir-${i}`), { recursive: true });
    }
    const res = runScript(makePayload(root));
    expect(res.exitCode).toBe(0);
    // Must still surface — classification must not be disrupted by empty dirs.
    expect(res.stdout).toContain("v1 .guild detected");
  });
});
