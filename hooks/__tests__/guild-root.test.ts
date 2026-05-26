/**
 * hooks/__tests__/guild-root.test.ts
 *
 * Unit tests for resolveGuildRoot (hooks/lib/guild-root.ts).
 *
 * Invariant under test: .guild/ must only ever land at a repo root,
 * never in a subdirectory — even when the hook fires with a CWD that
 * is a deep subdirectory of the repo.
 *
 * All fixtures are ephemeral mkdtemp directories; no real repo state is
 * touched.
 *
 * Test matrix:
 *   1. Walks up and finds .git (directory form — normal repo)
 *   2. Walks up and finds .git (file form — git worktree)
 *   3. Walks up and finds .guild ancestor when no .git present
 *   4. Graceful fallback to startCwd when neither is found up to fs root
 *   5. startCwd itself contains .git — no walk needed
 *   6. startCwd itself contains .guild — no walk needed
 *   7. Sanity check: plugin/scripts → plugin (mirrors real repo layout)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveGuildRoot } from "../lib/guild-root";

// ── helpers ───────────────────────────────────────────────────────────────

/** Create a fresh isolated temp dir for each test. */
function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-root-test-"));
}

/** Recursively remove a temp dir. */
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("resolveGuildRoot — walk-up to .git (directory form)", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpRoot(); });
  afterEach(() => { cleanup(tmp); });

  it("returns the ancestor that contains .git/", () => {
    // Layout: tmp/.git/  +  tmp/plugin/scripts/  (startCwd)
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    const startCwd = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(startCwd, { recursive: true });

    expect(resolveGuildRoot(startCwd)).toBe(tmp);
  });

  it("returns the immediate parent when .git is one level up", () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    const startCwd = path.join(tmp, "scripts");
    fs.mkdirSync(startCwd, { recursive: true });

    expect(resolveGuildRoot(startCwd)).toBe(tmp);
  });
});

describe("resolveGuildRoot — walk-up to .git (file form / git worktree)", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpRoot(); });
  afterEach(() => { cleanup(tmp); });

  it("returns the ancestor that contains a .git FILE (git worktree)", () => {
    // In a git worktree .git is a file, not a directory
    fs.writeFileSync(path.join(tmp, ".git"), "gitdir: ../../.git/worktrees/foo\n", "utf8");
    const startCwd = path.join(tmp, "deep", "subdir");
    fs.mkdirSync(startCwd, { recursive: true });

    expect(resolveGuildRoot(startCwd)).toBe(tmp);
  });
});

describe("resolveGuildRoot — walk-up to .guild ancestor (no .git)", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpRoot(); });
  afterEach(() => { cleanup(tmp); });

  it("returns the ancestor that contains .guild/ when no .git exists", () => {
    // Layout: tmp/.guild/  +  tmp/src/components/  (startCwd)
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
    const startCwd = path.join(tmp, "src", "components");
    fs.mkdirSync(startCwd, { recursive: true });

    expect(resolveGuildRoot(startCwd)).toBe(tmp);
  });
});

describe("resolveGuildRoot — graceful fallback when neither .git nor .guild found", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpRoot(); });
  afterEach(() => { cleanup(tmp); });

  it("falls back to startCwd when no ancestor has .git or .guild", () => {
    // Note: tmpDir itself is under os.tmpdir() which (on macOS /tmp, Linux /tmp)
    // should never have a .git or .guild above it.  If the host OS tmpdir is
    // somehow inside a repo the test is vacuously correct anyway (root found).
    const startCwd = path.join(tmp, "no-repo", "deep");
    fs.mkdirSync(startCwd, { recursive: true });

    const result = resolveGuildRoot(startCwd);
    // Either it fell back to startCwd OR it legitimately found a repo root
    // above os.tmpdir() (edge case on unusual setups).  The invariant is that
    // the function never throws and always returns a string.
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // On a normal host the fallback fires:
    if (!fs.existsSync(path.join(result, ".git")) && !fs.existsSync(path.join(result, ".guild"))) {
      expect(result).toBe(startCwd);
    }
  });
});

describe("resolveGuildRoot — startCwd already IS the root", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpRoot(); });
  afterEach(() => { cleanup(tmp); });

  it("returns startCwd when .git is in startCwd itself", () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    expect(resolveGuildRoot(tmp)).toBe(tmp);
  });

  it("returns startCwd when .guild is in startCwd itself (no .git)", () => {
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
    expect(resolveGuildRoot(tmp)).toBe(tmp);
  });
});

describe("resolveGuildRoot — sanity check: plugin/scripts → plugin", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpRoot(); });
  afterEach(() => { cleanup(tmp); });

  it("resolves plugin/scripts to plugin when .git is at plugin/", () => {
    // Mirrors the real repo layout:
    //   <tmp>/plugin/.git
    //   <tmp>/plugin/scripts/        ← startCwd (where a hook might fire)
    // Expected root: <tmp>/plugin
    const pluginDir = path.join(tmp, "plugin");
    fs.mkdirSync(path.join(pluginDir, ".git"), { recursive: true });
    const startCwd = path.join(pluginDir, "scripts");
    fs.mkdirSync(startCwd, { recursive: true });

    const result = resolveGuildRoot(startCwd);

    expect(result).toBe(pluginDir);
    // Confirm the derived runDir would be plugin/.guild/runs, NOT plugin/scripts/.guild/runs
    const runDir = path.join(result, ".guild", "runs", "my-run");
    expect(runDir).toBe(path.join(pluginDir, ".guild", "runs", "my-run"));
    expect(runDir).not.toContain("scripts");
  });
});
