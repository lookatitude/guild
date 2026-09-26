/**
 * scripts/rollback-walker.test.ts
 *
 * The compact-history walker (KTD48 / R60). The suite it replaces seeded
 * `v1/v2/v3` snapshot dirs and asserted a whole-file restore proposal; that tree is
 * retired, so the fixtures are now recorded deltas and the proposal is a list of
 * named spans.
 *
 * Verifies:
 *  - enumerates the recorded deltas newest-first and writes nothing;
 *  - `--steps n` emits `proposed_rollback:` naming each span, still writing nothing;
 *  - `--apply` restores the inverse span, and a DRIFTED span exits 2 rather than
 *    overwriting the drift;
 *  - missing `--skill` → exit 1; no history → exit 1.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { createGuildStorage } from "../src/domains/state";
import { applyEvolveDelta } from "../src/domains/evolve";
import { projectTargetRoot } from "../src/domains/evolve";
import { sha256, type EvolveDelta } from "../src/domains/evolve";
import { compactHistoryPath } from "../src/domains/evolve";
import { locatePlaybookSpan } from "../src/domains/knowledge";

const SCRIPT = path.resolve(__dirname, "rollback-walker.ts");

const PLAYBOOK = `# guild-brainstorm

## Question order

Ask the cheap questions first.

## Exit criteria

Seven fields, then stop.
`;

let tmpDir: string;
let repoRoot: string;
let external: string;

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GUILD_STATE_HOME: path.join(external, "state"),
    GUILD_CACHE_HOME: path.join(external, "cache"),
    GUILD_WORKTREE_HOME: path.join(external, "worktrees"),
    GUILD_TEMP_HOME: path.join(external, "temp"),
  };
}

function storage() {
  return createGuildStorage(repoRoot, {
    activeRoot: repoRoot,
    profile: "standalone",
    env: env(),
  });
}

function runScript(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: env(),
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** The sha256 of a named span as it stands — `before_hash` is required on every apply. */
function spanHash(file: string, span: string): string {
  const located = locatePlaybookSpan(fs.readFileSync(file, "utf8"), span);
  if (!located) throw new Error(`fixture: span '${span}' not in ${file}`);
  return sha256(located.text);
}

/** Seed n recorded deltas against one project playbook. Returns its path. */
function seedHistory(slug: string, replacements: string[]): string {
  const st = storage();
  const p = path.join(projectTargetRoot(st, "playbook"), `${slug}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PLAYBOOK, "utf8");
  for (const replacement of replacements) {
    const delta: EvolveDelta = {
      schema_version: "guild.evolve_delta.v1",
      target: "playbook",
      path: p,
      span: "Question order",
      op: "replace",
      replacement,
      proposer: "operator",
      before_hash: spanHash(p, "Question order"),
    };
    applyEvolveDelta(delta, { cwd: repoRoot, storage: st, pluginRoot: repoRoot, historyKey: slug });
  }
  return p;
}

/** Seed ONE `remove` delta. The removal deletes its own anchor (codex r1 #8). */
function seedRemoval(slug: string): string {
  const st = storage();
  const p = path.join(projectTargetRoot(st, "playbook"), `${slug}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, PLAYBOOK, "utf8");
  applyEvolveDelta(
    {
      schema_version: "guild.evolve_delta.v1",
      target: "playbook",
      path: p,
      span: "Question order",
      op: "remove",
      replacement: "",
      proposer: "operator",
      before_hash: spanHash(p, "Question order"),
    },
    { cwd: repoRoot, storage: st, pluginRoot: repoRoot, historyKey: slug },
  );
  return p;
}

describe("rollback-walker.ts — compact history", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rollback-test-"));
    repoRoot = path.join(tmpDir, "repo");
    external = path.join(tmpDir, "external");
    fs.mkdirSync(path.join(repoRoot, ".guild"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("enumeration", () => {
    it("exits 0 and lists every recorded delta", () => {
      seedHistory("guild-brainstorm", ["First.", "Second.", "Third."]);
      const { exitCode, stdout } = runScript(["--skill", "guild-brainstorm", "--cwd", repoRoot]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Compact history — guild-brainstorm");
      expect(stdout).toContain("playbook");
      expect(stdout).toContain("Question order");
      expect((stdout.match(/\| playbook \|/g) ?? []).length).toBe(3);
    });

    it("writes nothing without --apply", () => {
      const p = seedHistory("guild-brainstorm", ["First.", "Second."]);
      const before = fs.readFileSync(p, "utf8");
      runScript(["--skill", "guild-brainstorm", "--steps", "1", "--cwd", repoRoot]);
      expect(fs.readFileSync(p, "utf8")).toBe(before);
    });
  });

  describe("--steps <n>", () => {
    it("emits a proposed rollback naming each span", () => {
      seedHistory("guild-brainstorm", ["First.", "Second.", "Third."]);
      const { stdout, exitCode } = runScript([
        "--skill", "guild-brainstorm", "--steps", "2", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/proposed_rollback:/);
      expect(stdout).toMatch(/steps_back: 2/);
      expect((stdout.match(/span: Question order/g) ?? []).length).toBe(2);
    });

    it("rejects steps that walk past the oldest entry", () => {
      seedHistory("guild-brainstorm", ["First."]);
      const { exitCode, stderr } = runScript([
        "--skill", "guild-brainstorm", "--steps", "5", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/walks past the oldest/i);
    });
  });

  describe("--apply", () => {
    it("restores the inverse span", () => {
      const p = seedHistory("guild-brainstorm", ["First rewrite."]);
      expect(fs.readFileSync(p, "utf8")).toContain("First rewrite.");
      const { exitCode } = runScript([
        "--skill", "guild-brainstorm", "--steps", "1", "--apply", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(0);
      expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
    });

    it("exits 2 on a drifted span and leaves the drift in place", () => {
      const p = seedHistory("guild-brainstorm", ["First rewrite."]);
      const drifted = fs.readFileSync(p, "utf8").replace("First rewrite.", "First rewrite, edited.");
      fs.writeFileSync(p, drifted, "utf8");

      const { exitCode, stdout } = runScript([
        "--skill", "guild-brainstorm", "--steps", "1", "--apply", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(2);
      expect(stdout).toMatch(/blocked_confirm/);
      expect(fs.readFileSync(p, "utf8")).toBe(drifted);
    });
  });

  describe("codex r2 #2 — unrelated edits elsewhere do not block the walker", () => {
    it("--apply exits 0, restores the span, and preserves the other edits", () => {
      const p = seedHistory("guild-brainstorm", ["First rewrite."]);
      const edited = fs
        .readFileSync(p, "utf8")
        .replace("# guild-brainstorm\n", "# guild-brainstorm\n\nOwned by the planning guild.\n")
        .replace("Seven fields, then stop.", "Seven fields, then stop. Then hand off.");
      fs.writeFileSync(p, edited, "utf8");

      const { exitCode, stdout } = runScript([
        "--skill", "guild-brainstorm", "--steps", "1", "--apply", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/status: restored/);

      const after = fs.readFileSync(p, "utf8");
      expect(after).toContain("Ask the cheap questions first.");
      expect(after).not.toContain("First rewrite.");
      expect(after).toContain("Owned by the planning guild.");
      expect(after).toContain("Then hand off.");
    });
  });

  describe("codex r1 #8 — a removal round-trips through the compiled walker", () => {
    it("--apply after a remove exits 0 and restores the file byte-for-byte", () => {
      const p = seedRemoval("guild-brainstorm");
      expect(fs.readFileSync(p, "utf8")).not.toContain("Ask the cheap questions first.");

      const { exitCode, stdout } = runScript([
        "--skill", "guild-brainstorm", "--steps", "1", "--apply", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/status: restored/);
      expect(fs.readFileSync(p, "utf8")).toBe(PLAYBOOK);
    });
  });

  describe("codex r3 #2 — an ambiguous re-insertion point exits 2", () => {
    it("removal → duplicate the file body → --apply blocks and writes nothing", () => {
      const p = seedRemoval("guild-brainstorm");
      const removed = fs.readFileSync(p, "utf8");
      const doubled = removed + removed;
      fs.writeFileSync(p, doubled, "utf8");

      const { exitCode, stdout } = runScript([
        "--skill", "guild-brainstorm", "--steps", "1", "--apply", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(2);
      expect(stdout).toMatch(/blocked_confirm/);
      expect(fs.readFileSync(p, "utf8")).toBe(doubled);
    });

    it("replace → duplicate the span elsewhere → --apply blocks", () => {
      const p = seedHistory("guild-brainstorm", ["First rewrite."]);
      const applied = fs.readFileSync(p, "utf8");
      const withDuplicate = applied + "\n## Appendix\n\nfiller\n\n## Question order\n\nFirst rewrite.\n\n";
      fs.writeFileSync(p, withDuplicate, "utf8");

      const { exitCode } = runScript([
        "--skill", "guild-brainstorm", "--steps", "1", "--apply", "--cwd", repoRoot,
      ]);
      expect(exitCode).toBe(2);
      expect(fs.readFileSync(p, "utf8")).toBe(withDuplicate);
    });
  });

  describe("codex r1 #6 — unreadable history is exit 1, not an empty stack", () => {
    it("refuses rather than reporting no history", () => {
      seedHistory("guild-brainstorm", ["First."]);
      fs.writeFileSync(compactHistoryPath(storage(), "guild-brainstorm"), "{not json", "utf8");
      const { exitCode, stderr } = runScript(["--skill", "guild-brainstorm", "--cwd", repoRoot]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/will not parse|refusing/);
    });
  });

  describe("CLI errors", () => {
    it("exits 1 when --skill is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", repoRoot]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skill/i);
    });

    it("exits 1 when the target has no compact history", () => {
      const { exitCode, stderr } = runScript(["--skill", "ghost-skill", "--cwd", repoRoot]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/no compact history/i);
    });
  });
});
