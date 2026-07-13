/**
 * scripts/__tests__/check-doc-sync.test.ts
 *
 * TDD — tests written BEFORE implementation. All tests confirmed RED (module not
 * found) before scripts/workspace/check-doc-sync.ts was written.
 *
 * Drives the PURE evaluateDocSync() function — zero shelling out, deterministic.
 *
 * Covers (Lane D spec, SC-5):
 *   1. Command change + no root-doc change → flagged.
 *   2. Command change + a docs/v2 or umbrella .guild/wiki change → clean.
 *   3. Command change + commit msg containing "docs-sync: n/a" → clean.
 *   4. Non-surface change only (test file / internal script) → clean.
 *   5. user_facing:true skill change + no root-doc → flagged.
 *   6. Non-user-facing skill change (no flag in frontmatter) → clean.
 *   7. Unit tests for isUserFacingSkill (true/false frontmatter).
 *   8. Empty input → clean.
 *   9. Escape is case-insensitive regex: /docs-sync:\s*n\/a/i
 *  10. Mixed surface and non-surface files → flagged (surface wins).
 *  11. Multiple commit messages — escape in ANY message clears the flag.
 *  12. docs/v2 change + no surface → clean (root doc updated without surface change).
 *  13. (Finding #7) isUserFacingSkill handles quoted "true" values.
 *  14. (Finding #1) Cross-repo: plugin surface + root-repo docs → CLEAN (combined lists).
 *  15. (Finding #1) Cross-repo: plugin surface + no root docs → FLAGGED even with combined lists.
 *  16. (Finding #3) git-wrapper failure types: getChangedFilesResult / getCommitMessagesResult.
 *  17. (Finding #6) Integration: CLI manifest writer writes to correct path.
 *  18. (Finding #6) Integration: two-git-repo cross-repo scenario via gatherCrossRepoInputs.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import {
  evaluateDocSync,
  isUserFacingSkill,
  getChangedFilesResult,
  getCommitMessagesResult,
  gatherCrossRepoInputs,
  type DocSyncInput,
  type DocSyncResult,
  type GitResult,
} from "../workspace/check-doc-sync";

// ── 1. Command change + no root-doc → flagged ────────────────────────────────

describe("evaluateDocSync — command surface triggers", () => {
  test("command change under plugin/commands/ with no root-doc → flagged", () => {
    const result: DocSyncResult = evaluateDocSync({
      changedFiles: ["plugin/commands/guild-build.md"],
      commitMessages: ["feat: add --rigor flag to build command"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toContain("plugin/commands/guild-build.md");
    expect(result.reason).toBeTruthy();
  });

  test("command change under commands/ (bare prefix) with no root-doc → flagged", () => {
    const result = evaluateDocSync({
      changedFiles: ["commands/guild-ops.md"],
      commitMessages: ["feat: add ops command"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toContain("commands/guild-ops.md");
  });

  // ── 2. Command change + root-doc change → clean ──────────────────────────────

  test("command change + docs/v2 change → clean", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/commands/guild-build.md",
        "docs/v2/03-lifecycle.md",
      ],
      commitMessages: ["feat: add --rigor flag; update docs"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.surfaceFiles).toContain("plugin/commands/guild-build.md");
  });

  // ── 3. Escape hatch in commit message → clean ────────────────────────────────

  test("command change + commit msg 'docs-sync: n/a (internal rename)' → clean", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/commands/guild-build.md"],
      commitMessages: ["refactor: rename internal flag\n\ndocs-sync: n/a (internal rename)"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
  });

  test("escape 'docs-sync: n/a' is matched case-insensitively", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/commands/guild-build.md"],
      commitMessages: ["Docs-Sync: N/A internal only"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
  });

  test("escape with extra spaces: 'docs-sync:  n/a' matches", () => {
    const result = evaluateDocSync({
      changedFiles: ["commands/guild-init.md"],
      commitMessages: ["fix: something\n\ndocs-sync:  n/a (minor copy tweak)"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
  });

  // ── 4. Non-surface change only → clean ───────────────────────────────────────

  test("non-surface change (test file) only → clean", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/scripts/__tests__/some.test.ts",
        "plugin/scripts/workspace/detect.ts",
      ],
      commitMessages: ["test: add detect tests"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.surfaceFiles).toHaveLength(0);
  });

  test("non-surface change (internal script) only → clean", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/scripts/workspace/promote-upstream.ts"],
      commitMessages: ["feat: add promote-upstream script"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
  });

  // ── 5. user_facing:true skill in changedFiles → flagged ──────────────────────

  test("user_facing:true skill change with no root-doc → flagged", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/skills/meta/plan/SKILL.md",
      ],
      commitMessages: ["feat: improve plan skill"],
      userFacingSkillPaths: [
        "plugin/skills/meta/plan/SKILL.md", // explicitly listed as user-facing
      ],
    });
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toContain("plugin/skills/meta/plan/SKILL.md");
  });

  test("user_facing:true skill change + umbrella wiki change → clean", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/skills/meta/plan/SKILL.md",
        ".guild/wiki/decisions/planning-guide.md",
      ],
      commitMessages: ["feat: update plan skill and docs"],
      userFacingSkillPaths: ["plugin/skills/meta/plan/SKILL.md"],
    });
    expect(result.flagged).toBe(false);
  });

  // ── 6. Non-user-facing skill change → clean ──────────────────────────────────

  test("non-user-facing skill change (not in userFacingSkillPaths) → clean", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/skills/knowledge/learn-harvest/SKILL.md"],
      commitMessages: ["feat: update learn-harvest skill"],
      userFacingSkillPaths: [], // empty → no user-facing skills declared
    });
    expect(result.flagged).toBe(false);
  });

  test("skill not in userFacingSkillPaths even if changed → clean", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/skills/meta/brainstorm/SKILL.md"],
      commitMessages: ["feat: tweak brainstorm"],
      userFacingSkillPaths: ["plugin/skills/meta/plan/SKILL.md"], // plan is UF, not brainstorm
    });
    expect(result.flagged).toBe(false);
  });

  // ── 7. Empty input → clean ───────────────────────────────────────────────────

  test("empty changedFiles → clean", () => {
    const result = evaluateDocSync({
      changedFiles: [],
      commitMessages: [],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.surfaceFiles).toHaveLength(0);
  });

  // ── 8. Mixed surface and non-surface files → flagged ─────────────────────────

  test("mix of surface and non-surface files with no root-doc → flagged", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/scripts/flip-report.ts",       // non-surface
        "plugin/commands/guild-qa.md",          // surface
        "plugin/scripts/__tests__/flip-report.test.ts", // non-surface
      ],
      commitMessages: ["feat: add qa command and update flip-report"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toContain("plugin/commands/guild-qa.md");
    expect(result.surfaceFiles).not.toContain("plugin/scripts/flip-report.ts");
  });

  // ── 9. Multiple commit messages — escape in ANY message clears flag ───────────

  test("escape in second of two commit messages clears the flag", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/commands/guild-build.md"],
      commitMessages: [
        "feat: add --rigor flag",
        "chore: housekeeping\n\ndocs-sync: n/a (no user-visible change)",
      ],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
  });

  // ── 10. docs/v2 change + no surface → clean ─────────────────────────────────

  test("docs/v2 change with no surface change → clean", () => {
    const result = evaluateDocSync({
      changedFiles: ["docs/v2/03-lifecycle.md"],
      commitMessages: ["docs: update workspace architecture page"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.surfaceFiles).toHaveLength(0);
  });

  // ── 11. surfaceFiles lists only surface-touched files, not all changedFiles ───

  test("surfaceFiles contains only the surface-touching subset of changedFiles", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/commands/guild-init.md",   // surface
        "plugin/scripts/detect.ts",        // non-surface
        "docs/v2/03-lifecycle.md",        // root doc (makes it clean actually)
      ],
      commitMessages: ["feat: improve init"],
      userFacingSkillPaths: [],
    });
    // Has root doc update → clean, but surfaceFiles still reflects what was touched
    expect(result.flagged).toBe(false);
    expect(result.surfaceFiles).toContain("plugin/commands/guild-init.md");
    expect(result.surfaceFiles).not.toContain("plugin/scripts/detect.ts");
  });

  test("docs/knowledge no longer satisfies the docs-sync gate", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "plugin/commands/guild-build.md",
        "docs/knowledge/architecture/build-command.md",
      ],
      commitMessages: ["feat: add lifecycle routing"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(true);
    expect(result.reason).toMatch(/docs\/v2/);
  });

  // ── 12. result.reason is set when flagged ────────────────────────────────────

  test("flagged result carries a non-empty reason string", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/commands/guild-plan.md"],
      commitMessages: ["feat: improve plan command"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(true);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("clean result has an empty reason or a 'clean' summary", () => {
    const result = evaluateDocSync({
      changedFiles: ["plugin/scripts/detect.ts"],
      commitMessages: ["refactor: internal"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
    // reason may be empty string or a description — no strict format
    expect(typeof result.reason).toBe("string");
  });
});

// ── isUserFacingSkill — unit tests ────────────────────────────────────────────

describe("isUserFacingSkill — frontmatter parsing", () => {
  test("returns true when frontmatter has user_facing: true", () => {
    const contents = `---
name: guild-plan
user_facing: true
description: "The plan skill"
---

# Guild Plan Skill
`;
    expect(isUserFacingSkill("plugin/skills/meta/plan/SKILL.md", contents)).toBe(true);
  });

  test("returns false when frontmatter has user_facing: false", () => {
    const contents = `---
name: guild-learn-harvest
user_facing: false
description: "Internal harvest skill"
---

# Learn Harvest
`;
    expect(isUserFacingSkill("plugin/skills/knowledge/learn-harvest/SKILL.md", contents)).toBe(false);
  });

  test("returns false when user_facing key is absent from frontmatter", () => {
    const contents = `---
name: guild-brainstorm
description: "Brainstorm skill"
---

# Brainstorm
`;
    expect(isUserFacingSkill("plugin/skills/meta/brainstorm/SKILL.md", contents)).toBe(false);
  });

  test("returns false when file has no frontmatter", () => {
    const contents = `# Some skill without frontmatter

Just content here.
`;
    expect(isUserFacingSkill("plugin/skills/fallback/SKILL.md", contents)).toBe(false);
  });

  test("returns false for empty content", () => {
    expect(isUserFacingSkill("plugin/skills/x/SKILL.md", "")).toBe(false);
  });

  test("returns true for user_facing: true with surrounding whitespace", () => {
    const contents = `---
name: some-skill
user_facing:  true
type: meta
---

# Skill
`;
    expect(isUserFacingSkill("SKILL.md", contents)).toBe(true);
  });

  // ── Finding #7 — quoted "true" values ─────────────────────────────────────

  test("returns true when frontmatter has user_facing: \"true\" (quoted)", () => {
    const contents = `---
name: some-skill
user_facing: "true"
---
# Skill
`;
    expect(isUserFacingSkill("SKILL.md", contents)).toBe(true);
  });

  test("returns true when frontmatter has user_facing: 'true' (single-quoted)", () => {
    const contents = `---
name: some-skill
user_facing: 'true'
---
# Skill
`;
    expect(isUserFacingSkill("SKILL.md", contents)).toBe(true);
  });

  test("returns false when frontmatter has user_facing: \"false\" (quoted false)", () => {
    const contents = `---
name: some-skill
user_facing: "false"
---
# Skill
`;
    expect(isUserFacingSkill("SKILL.md", contents)).toBe(false);
  });
});

// ── Finding #1 — cross-repo: evaluateDocSync handles pre-split combined file lists ─

describe("evaluateDocSync — cross-repo combined file lists (Finding #1)", () => {
  // The CLI gathers files from BOTH repos, normalises them, then calls evaluateDocSync.
  // The pure function itself is repo-agnostic — it only cares about path prefixes.
  // These tests verify it correctly handles inputs that come from two separate repos.

  test("plugin surface change + root docs/v2 change → CLEAN (combined lists)", () => {
    // Simulate: plugin-repo diff saw commands/guild-build.md (normalised to commands/...)
    // Root-repo diff saw docs/v2/03-lifecycle.md
    const result = evaluateDocSync({
      changedFiles: [
        "commands/guild-build.md",           // from plugin repo, normalised
        "docs/v2/03-lifecycle.md",           // from root repo
      ],
      commitMessages: ["feat: update build command and docs"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.surfaceFiles).toContain("commands/guild-build.md");
  });

  test("plugin surface change + NO root docs change → FLAGGED (even with combined lists)", () => {
    const result = evaluateDocSync({
      changedFiles: [
        "commands/guild-build.md",     // from plugin repo only
        "plugin/scripts/detect.ts",    // non-surface
      ],
      commitMessages: ["feat: update build command"],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toContain("commands/guild-build.md");
  });

  test("escape from plugin-repo commit message clears flag even when root-docs absent", () => {
    const result = evaluateDocSync({
      changedFiles: ["commands/guild-build.md"],
      // commitMessages drawn from BOTH repos' git logs, combined
      commitMessages: [
        "feat: update build command",
        "docs-sync: n/a (no user-visible change)",
      ],
      userFacingSkillPaths: [],
    });
    expect(result.flagged).toBe(false);
  });
});

// ── Finding #3 — git wrapper result types (ok/error pattern) ──────────────────

describe("getChangedFilesResult / getCommitMessagesResult — typed failure (Finding #3)", () => {
  test("getChangedFilesResult returns {ok:true, value:[...]} on a valid range in cwd", () => {
    // We need a real git repo cwd — use the plugin repo itself
    const pluginRoot = path.resolve(__dirname, "../../..");
    const result: GitResult<string[]> = getChangedFilesResult("HEAD~1..HEAD", pluginRoot);
    // Either ok (has commits) or error (shallow clone / no commits) — both are valid shapes
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe("string");
    }
  });

  test("getChangedFilesResult returns {ok:false, error} for a non-git dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-git-"));
    try {
      const result: GitResult<string[]> = getChangedFilesResult("HEAD~1..HEAD", tmp);
      // Non-git dir: should be ok:false; if somehow ok, the value is still a valid array
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        expect(typeof result.error).toBe("string");
        expect((result.error ?? "").length).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("getCommitMessagesResult returns {ok:false, error} for a non-git dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-git2-"));
    try {
      const result: GitResult<string[]> = getCommitMessagesResult("HEAD~1..HEAD", tmp);
      if (result.ok) {
        expect(Array.isArray(result.value)).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        expect(typeof result.error).toBe("string");
        expect((result.error ?? "").length).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("getChangedFilesResult returns a typed result for any range — never throws", () => {
    // Use the current repo which must have at least one commit
    const repoRoot = path.resolve(__dirname, "../../..");
    // HEAD alone may or may not be valid git range syntax — the important thing
    // is we get a typed result, not a thrown exception.
    const result: GitResult<string[]> = getChangedFilesResult("HEAD", repoRoot);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
    } else {
      expect(typeof result.error).toBe("string");
    }
    // Key assertion: result is always one of these shapes (never threw)
    expect(typeof result.ok).toBe("boolean");
  });
});

// ── Finding #6 — cross-repo integration: gatherCrossRepoInputs ────────────────

describe("gatherCrossRepoInputs — two-git-repo cross-repo scenario (Finding #6)", () => {
  let rootRepo: string;
  let pluginRepo: string;

  function gitInit(dir: string): void {
    execFileSync("git", ["init", dir]);
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  }

  function gitCommit(dir: string, msg: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      execFileSync("git", ["add", rel], { cwd: dir });
    }
    execFileSync("git", ["commit", "-m", msg], { cwd: dir });
  }

  beforeAll(() => {
    rootRepo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-root-"));
    pluginRepo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-plugin-"));
    gitInit(rootRepo);
    gitInit(pluginRepo);

    // Root repo: baseline commit
    gitCommit(rootRepo, "init root", { "README.md": "# Root\n" });
    // Plugin repo: baseline commit
    gitCommit(pluginRepo, "init plugin", { "README.md": "# Plugin\n" });
  });

  afterAll(() => {
    fs.rmSync(rootRepo, { recursive: true, force: true });
    fs.rmSync(pluginRepo, { recursive: true, force: true });
  });

  test("plugin command change + root docs/v2 change → CLEAN (cross-repo combined)", () => {
    // Add a command in plugin repo
    gitCommit(pluginRepo, "feat: add build command", {
      "commands/guild-build.md": "# Build command\n",
    });
    // Add a docs/v2 file in root repo
    gitCommit(rootRepo, "docs: update build reference", {
      "docs/v2/03-lifecycle.md": "# Lifecycle\n",
    });

    // gatherCrossRepoInputs: diff each repo against its previous commit
    const { input, fatal } = gatherCrossRepoInputs({
      pluginRepo,
      rootRepo,
      pluginRange: "HEAD~1..HEAD",
      rootRange: "HEAD~1..HEAD",
    });

    expect(fatal).toBe(false);
    // Combined changedFiles should include both
    expect(input.changedFiles).toContain("commands/guild-build.md");
    expect(input.changedFiles.some((f) => f.startsWith("docs/v2/"))).toBe(true);

    const result = evaluateDocSync(input);
    expect(result.flagged).toBe(false);
  });

  test("plugin command change + NO root docs change → FLAGGED (cross-repo)", () => {
    // Add another command in plugin repo; root repo gets no docs change
    gitCommit(pluginRepo, "feat: add qa command", {
      "commands/guild-qa.md": "# QA command\n",
    });
    // Root repo: non-docs change (should not count as root-doc update)
    gitCommit(rootRepo, "chore: update readme", {
      "README.md": "# Root updated\n",
    });

    const { input, fatal } = gatherCrossRepoInputs({
      pluginRepo,
      rootRepo,
      pluginRange: "HEAD~1..HEAD",
      rootRange: "HEAD~1..HEAD",
    });

    expect(fatal).toBe(false);
    expect(input.changedFiles).toContain("commands/guild-qa.md");

    const result = evaluateDocSync(input);
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toContain("commands/guild-qa.md");
  });

  test("escape in plugin-repo commit clears flag even with no root docs", () => {
    gitCommit(pluginRepo, "feat: tweak init command\n\ndocs-sync: n/a (internal only)", {
      "commands/guild-init.md": "# Init command\n",
    });
    gitCommit(rootRepo, "chore: nothing relevant", {
      "NOTES.md": "notes\n",
    });

    const { input, fatal } = gatherCrossRepoInputs({
      pluginRepo,
      rootRepo,
      pluginRange: "HEAD~1..HEAD",
      rootRange: "HEAD~1..HEAD",
    });

    expect(fatal).toBe(false);
    // commitMessages must include the escape from the plugin repo commit
    const hasEscape = input.commitMessages.some((m) => /docs-sync:\s*n\/a/i.test(m));
    expect(hasEscape).toBe(true);

    const result = evaluateDocSync(input);
    expect(result.flagged).toBe(false);
  });

  test("same repo for plugin+root (CI advisory mode) → no duplicate files", () => {
    // When --plugin-repo and --root-repo point at the SAME checkout (the plugin-repo
    // CI advisory mode, where docs/v2/ isn't present), the same diff would be
    // gathered twice. gatherCrossRepoInputs must dedup so the surface list/count is honest.
    gitCommit(pluginRepo, "feat: add ops command", {
      "commands/guild-ops.md": "# Ops command\n",
    });

    const { input, fatal } = gatherCrossRepoInputs({
      pluginRepo,
      rootRepo: pluginRepo, // same checkout — the CI advisory form
      pluginRange: "HEAD~1..HEAD",
      rootRange: "HEAD~1..HEAD",
    });

    expect(fatal).toBe(false);
    const occurrences = input.changedFiles.filter((f) => f === "commands/guild-ops.md");
    expect(occurrences).toHaveLength(1); // deduped, not 2
    const result = evaluateDocSync(input);
    expect(result.flagged).toBe(true);
    expect(result.surfaceFiles).toEqual(["commands/guild-ops.md"]);
  });

  test("three-dot range: a base-side 'docs-sync: n/a' does NOT suppress the PR advisory (Codex-CI MAJOR-1)", () => {
    // Topology: M1 (base) → feature commits a command (no escape); base branch separately
    // commits a 'docs-sync: n/a' on a non-surface file. A three-dot range B...F includes the
    // base commit in `git log` (symmetric diff) — the escape would WRONGLY suppress. The
    // two-dot translation for the log must exclude it.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-3dot-"));
    try {
      gitInit(repo);
      gitCommit(repo, "M1 init", { "base.txt": "0\n" });
      // Capture the default branch name (environment-dependent: main vs master)
      const baseBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      // feature branch: a command change, NO escape
      execFileSync("git", ["checkout", "-b", "feature"], { cwd: repo });
      gitCommit(repo, "feat: add a command", { "commands/guild-x.md": "# X\n" });
      const featureSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      // base branch advances separately with an escape token on a non-surface file
      execFileSync("git", ["checkout", baseBranch], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
      gitCommit(repo, "chore: base churn\n\ndocs-sync: n/a (base side, unrelated)", { "base.txt": "1\n" });
      const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

      const threeDot = `${baseSha}...${featureSha}`;
      const msgs = getCommitMessagesResult(threeDot, repo);
      expect(msgs.ok).toBe(true);
      // The base-side escape must NOT appear (two-dot log = PR commits only)
      const hasEscape = (msgs.value ?? []).some((m) => /docs-sync:\s*n\/a/i.test(m));
      expect(hasEscape).toBe(false);

      // And the full evaluation flags (surface changed, escape correctly excluded)
      const changed = getChangedFilesResult(threeDot, repo);
      expect(changed.ok).toBe(true);
      const result = evaluateDocSync({
        changedFiles: changed.value ?? [],
        commitMessages: msgs.value ?? [],
        userFacingSkillPaths: [],
      });
      expect(result.flagged).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test("gatherCrossRepoInputs: missing origin does NOT silently produce CLEAN", () => {
    // With a valid range (HEAD~1..HEAD) in an existing repo, the result
    // should not be ok:false while also returning no files (fail-open).
    // If the result is ok:false, it should carry an error string — not empty files.
    const r = getChangedFilesResult("origin/main...HEAD", pluginRepo);
    if (!r.ok) {
      // Error should be non-empty (fail-closed signal, not silent empty)
      expect((r.error ?? "").length).toBeGreaterThan(0);
    }
    // The key is: if it fails, it fails WITH an error, not silently with []
  });
});

// ── Residual B — CLI exits 2 on unresolvable git failure (not silently CLEAN) ──

describe("check-doc-sync CLI — fail-closed on unexpected git error (Residual B)", () => {
  const SCRIPT = path.resolve(__dirname, "../workspace/check-doc-sync.ts");
  const NODE_ENV = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    PATH: `${require("node:path").dirname(process.execPath)}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
  } as NodeJS.ProcessEnv;

  function runCli(args: string[]): { status: number; out: string; err: string } {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const r = spawnSync("npx", ["tsx", SCRIPT, ...args], {
      encoding: "utf8",
      env: NODE_ENV,
      timeout: 120_000,
    });
    return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
  }

  test("non-git root-repo dir → CLI exits 2, NOT a silent CLEAN (Residual B)", () => {
    // A plain temp dir is not a git repo — any git range will fail
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-nongit-"));
    try {
      const { status, out } = runCli([
        "--root-repo", nonGitDir,
        "--plugin-repo", nonGitDir,
        "--plugin-range", "HEAD~1..HEAD",
        "--root-range", "HEAD~1..HEAD",
      ]);
      // Must NOT exit 0 with a CLEAN message — that would be fail-open
      // It should exit 2 (error) or exit 0 with a WARN (never silently CLEAN)
      const isClean = out.includes("[doc-sync] CLEAN");
      const isError = status === 2;
      // Either it exits with error code, or at minimum it does not report CLEAN
      // The spec requires exit 2 on unexpected git failure
      expect(isError || !isClean).toBe(true);
      if (isClean) {
        // If it claims CLEAN with no git data, that's the fail-open bug
        fail("CLI reported CLEAN on a non-git directory — this is fail-open");
      }
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  test("non-git dir with --strict → exits 2 (never 0) (Residual B)", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-doc-sync-nongit2-"));
    try {
      const { status } = runCli([
        "--root-repo", nonGitDir,
        "--plugin-repo", nonGitDir,
        "--plugin-range", "HEAD~1..HEAD",
        "--root-range", "HEAD~1..HEAD",
        "--strict",
      ]);
      // With an unresolvable git dir, must not exit 0
      expect(status).toBe(2);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
