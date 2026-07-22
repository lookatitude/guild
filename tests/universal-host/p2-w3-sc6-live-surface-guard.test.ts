/**
 * tests/universal-host/p2-w3-sc6-live-surface-guard.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W3-6 (regression + live-surface frozen) —
 * the DECISIVE binding check for the whole wave, and the mechanically-binding form of the
 * LW3-7a checklist-3 sign-off (FU-1). Anti-vacuity is mandatory (codex gate).
 *
 * ── 2026-07-17: the anchor is a TREE hash, not a commit pin ────────────────────
 * This guard used to pin a commit SHA and assert `isAncestor(PINNED_BASELINE, HEAD)`.
 * That is fundamentally incompatible with squash-merging: a squash rewrites the commit,
 * orphaning the pin, and the guard then throws "pinned baseline is not an ancestor of
 * HEAD" — going DARK on the channel branch. It happened three times running (#37, #38,
 * #39), each squash orphaning the pin the previous PR had just re-ratified, and nobody
 * noticed because nothing re-runs the guard on `next` itself.
 *
 * The anchor is now the git TREE of each frozen path — content identity, which a squash
 * preserves. That DELETES an attack surface rather than adding one: a commit pin is a
 * movable ref, so the old design needed resolveBaseline() + an ancestry check + a
 * not-HEAD check + a GUILD_W3_BASELINE_REF bypass-rejector. A hardcoded tree hash has no
 * ref to move — nothing to point at HEAD, nothing to move forward, nothing to override.
 * Rationale, ratified values, and the re-ratification rule: ./live-surface-anchor.ts.
 *
 * Two surfaces, two postures (both frozen as-ratified — empty allowlists):
 *  (A) `.claude-plugin/**` + `commands/**` — the cutover-channel + F-5 freeze.
 *      commands/ is anchored by raw tree hash. `.claude-plugin/` is anchored per-file on a
 *      VERSION-STRIPPED hash instead, because a release legitimately bumps `version` inside
 *      the two manifests; its file SET is asserted separately so a new file cannot slip in.
 *  (B) live `skills/**` — anchored by raw tree hash. No add/modify/delete/rename permitted.
 *
 * The REAL cutover-safety gate is `build:hosts` SC-2 normalized equivalence (generated ≡
 * committed); this guard is the secondary tripwire for FUTURE *unintended* drift.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  PLUGIN_ROOT,
  RATIFIED_CLAUDE_PLUGIN_FILES,
  RATIFIED_MANIFESTS,
  RATIFIED_TREES,
  claudePluginFileSet,
  describeTreeDelta,
  git,
  manifestStrippedHash,
  stripVersions,
  worktreeTreeHash,
} from "./live-surface-anchor";

// The v2 surface is frozen as-ratified — there are no permitted deltas from it.
const ALLOWED_SKILL_ADDS: string[] = [];
const ALLOWED_SKILL_MODS: string[] = [];

type Row = { status: string; path: string };

const FROZEN_PATHS = [".claude-plugin/", "commands/"];

/**
 * Pure classifier: the rows that VIOLATE the strict frozen-surface freeze — any row under
 * `.claude-plugin/` or `commands/`. Retained as the DIAGNOSTIC classifier and as a
 * synthetic-row anti-vacuity control: feeding it a synthetic row exercises the same
 * rejection logic, proving the strict-zero posture is capable of failing.
 */
function classifyFrozen(rows: Row[]): Row[] {
  return rows.filter((r) => FROZEN_PATHS.some((f) => r.path.startsWith(f)));
}

/**
 * Pure classifier for the live `skills/**` rule (frozen as-ratified: empty allowlist ⇒
 * ZERO permitted deltas). Returns violations + the sorted added/modified paths + an `ok`
 * verdict true ONLY when nothing violates and the sets match the (empty) allowlists.
 */
function classifySkills(rows: Row[]): { violations: Row[]; added: string[]; modified: string[]; ok: boolean } {
  const violations = rows.filter((r) => {
    if (r.status === "A") return !ALLOWED_SKILL_ADDS.includes(r.path);
    if (r.status === "M") return !ALLOWED_SKILL_MODS.includes(r.path);
    return true;
  });
  const added = rows.filter((r) => r.status === "A").map((r) => r.path).sort();
  const modified = rows.filter((r) => r.status === "M").map((r) => r.path).sort();
  const allow = [...ALLOWED_SKILL_ADDS].sort();
  const allowMods = [...ALLOWED_SKILL_MODS].sort();
  const ok =
    violations.length === 0 &&
    added.length === allow.length &&
    added.every((p, i) => p === allow[i]) &&
    modified.length === allowMods.length &&
    modified.every((p, i) => p === allowMods[i]);
  return { violations, added, modified, ok };
}

describe("SC-W3-6 — the ratified anchor is real (guard not vacuous)", () => {
  it("every ratified TREE anchor is well-formed and resolves to a real git tree object", () => {
    // A typo'd anchor would mismatch forever and be indistinguishable from a real surface
    // change, so assert the objects EXIST rather than merely look hex-shaped.
    for (const [p, tree] of Object.entries(RATIFIED_TREES)) {
      expect(p).toBeTruthy();
      expect(tree).toMatch(/^[0-9a-f]{40}$/);
      expect(git(["cat-file", "-t", tree])).toBe("tree");
    }
  });

  it("SURVIVES a squash-merge — the property the old commit pin lacked", () => {
    // The decisive regression test for this redesign, proven on REAL history rather than
    // asserted. 0f965e1 is the pre-squash feature tip; 4c4156f is its squashed counterpart
    // on next (guild#38). A commit pin could not survive that rewrite — the subtree hash does.
    const preSquash = "0f965e1";
    const squashed = "4c4156f";
    const haveBoth = [preSquash, squashed].every((r) => {
      try {
        git(["cat-file", "-e", `${r}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    });
    if (!haveBoth) {
      // A shallow clone may lack the historical objects; skip rather than fail spuriously.
      // The invariant is still enforced on every run by the anchors themselves.
      return;
    }
    expect(git(["rev-parse", `${preSquash}:commands`])).toBe(git(["rev-parse", `${squashed}:commands`]));
  });

  it("anti-vacuity: worktreeTreeHash DETECTS a perturbation (it is not a constant)", () => {
    // If the hash were constant, every zero-delta assertion below would be vacuous.
    // Perturb a REAL frozen file, confirm the hash MOVES, restore, confirm it returns.
    const victim = path.join(PLUGIN_ROOT, "commands", "guild.md");
    const original = fs.readFileSync(victim);
    const before = worktreeTreeHash("commands");
    try {
      fs.appendFileSync(victim, "\n<!-- anti-vacuity probe -->\n");
      expect(worktreeTreeHash("commands")).not.toBe(before);
    } finally {
      fs.writeFileSync(victim, original);
    }
    expect(worktreeTreeHash("commands")).toBe(before);
  });

  it("anti-vacuity: the anchor reads the WORKTREE, not HEAD (an uncommitted edit is caught)", () => {
    // Hashing HEAD:<path> would make the guard blind to exactly what it exists to catch.
    const victim = path.join(PLUGIN_ROOT, "skills", "meta", "brainstorm", "SKILL.md");
    const original = fs.readFileSync(victim);
    try {
      fs.appendFileSync(victim, "\n<!-- worktree probe -->\n");
      // HEAD is unchanged by an uncommitted edit; the worktree hash must diverge from it.
      expect(worktreeTreeHash("skills")).not.toBe(git(["rev-parse", "HEAD:skills"]));
    } finally {
      fs.writeFileSync(victim, original);
    }
  });
});

describe("SC-W3-6 (A) — DECISIVE: .claude-plugin/** + commands/** frozen (STRICT)", () => {
  it("commands/** is byte-identical to the ratified tree", () => {
    const actual = worktreeTreeHash("commands");
    if (actual !== RATIFIED_TREES["commands"]) {
      throw new Error(
        `SC-W3-6(A): commands/ changed vs the ratified tree ${RATIFIED_TREES["commands"]}:\n  ` +
          describeTreeDelta("commands", RATIFIED_TREES["commands"]!, actual).join("\n  ") +
          "\n\nIf this change is DELIBERATE, re-ratify: re-run worktreeTreeHash('commands') and update " +
          "RATIFIED_TREES in live-surface-anchor.ts in the SAME commit, with a note saying what changed and why."
      );
    }
    expect(actual).toBe(RATIFIED_TREES["commands"]);
  });

  it(".claude-plugin/** matches the ratified manifests, with the release version bump exempt", () => {
    for (const [p, expected] of Object.entries(RATIFIED_MANIFESTS)) {
      const actual = manifestStrippedHash(p);
      if (actual !== expected) {
        throw new Error(
          `SC-W3-6(A): ${p} changed beyond a pure version bump (version-stripped hash ${actual} != ` +
            `ratified ${expected}). A release-only version bump is exempt; any other edit is a violation.`
        );
      }
      expect(actual).toBe(expected);
    }
  });

  it("the .claude-plugin/** FILE SET is exactly the ratified manifests (no new file slips in)", () => {
    // The manifests are anchored PER-FILE (they need the version tolerance), so without
    // this a NEW file under .claude-plugin/ would be anchored by nothing at all.
    expect(claudePluginFileSet()).toEqual([...RATIFIED_CLAUDE_PLUGIN_FILES]);
  });

  it("anti-vacuity: an UNTRACKED new .claude-plugin/ file is CAUGHT (regression)", () => {
    // A bare `git ls-files` reports only TRACKED files, so an untracked manifest would be
    // invisible to the file-set assertion — anchored by nothing until someone staged it.
    // That is exactly the drift this guard exists to catch, and the commands/skills path
    // (git add -A) already catches untracked additions, so the two must not disagree.
    const probe = path.join(PLUGIN_ROOT, ".claude-plugin", "__untracked_probe.json");
    try {
      fs.writeFileSync(probe, "{}\n");
      const withProbe = claudePluginFileSet();
      expect(withProbe).toContain(".claude-plugin/__untracked_probe.json");
      // …and the real assertion above would therefore FAIL, which is the point.
      expect(withProbe).not.toEqual([...RATIFIED_CLAUDE_PLUGIN_FILES]);
    } finally {
      fs.rmSync(probe, { force: true });
    }
    expect(claudePluginFileSet()).toEqual([...RATIFIED_CLAUDE_PLUGIN_FILES]); // restored
  });

  it("anti-vacuity (REAL): the SAME classifier FLAGS a synthetic .claude-plugin/** + commands/** mutation", () => {
    const synthetic: Row[] = [
      { status: "A", path: ".claude-plugin/x.json" },
      { status: "M", path: "commands/new.md" },
      { status: "D", path: ".claude-plugin/marketplace.json" },
    ];
    expect(classifyFrozen(synthetic)).toEqual(synthetic); // ALL three are flagged
    // …and a non-frozen change is NOT flagged (specific, not a blanket reject).
    expect(classifyFrozen([{ status: "A", path: "scripts/x.ts" }])).toEqual([]);
  });

  it("version-bump tolerance is SPECIFIC — exempts a pure bump, still flags a surface change", () => {
    // plugin.json: top-level version. A pure bump masks equal; a bump that ALSO edits the
    // commands/skills/agents surface must NOT be masked equal.
    const a = JSON.stringify({ name: "guild", version: "2.1.0", commands: ["a.md", "b.md"] });
    const bumpOnly = JSON.stringify({ name: "guild", version: "2.2.0", commands: ["a.md", "b.md"] });
    const bumpPlusSurface = JSON.stringify({ name: "guild", version: "2.2.0", commands: ["a.md", "c.md"] });
    expect(stripVersions(a)).toBe(stripVersions(bumpOnly));
    expect(stripVersions(a)).not.toBe(stripVersions(bumpPlusSurface));
    // marketplace.json: NESTED plugins[].version is masked; `source` (and all else) is not.
    const mA = JSON.stringify({ plugins: [{ name: "guild", version: "2.1.0", source: "x" }] });
    const mBump = JSON.stringify({ plugins: [{ name: "guild", version: "2.2.0", source: "x" }] });
    const mSource = JSON.stringify({ plugins: [{ name: "guild", version: "2.2.0", source: "y" }] });
    expect(stripVersions(mA)).toBe(stripVersions(mBump));
    expect(stripVersions(mA)).not.toBe(stripVersions(mSource));
    // The version tolerance is scoped to the two manifests ONLY. Everything else is anchored
    // by a raw tree hash, which no version masking can soften.
    expect(Object.keys(RATIFIED_MANIFESTS).sort()).toEqual([...RATIFIED_CLAUDE_PLUGIN_FILES]);
    expect(Object.keys(RATIFIED_TREES).sort()).toEqual(["commands", "skills"]);
  });
});

describe("SC-W3-6 (B) — live skills/**: frozen as-ratified", () => {
  it("skills/** is byte-identical to the ratified tree", () => {
    const actual = worktreeTreeHash("skills");
    if (actual !== RATIFIED_TREES["skills"]) {
      throw new Error(
        `SC-W3-6(B): skills/ changed vs the ratified tree ${RATIFIED_TREES["skills"]}:\n  ` +
          describeTreeDelta("skills", RATIFIED_TREES["skills"]!, actual).join("\n  ") +
          "\n\nIf this change is DELIBERATE, re-ratify: re-run worktreeTreeHash('skills') and update " +
          "RATIFIED_TREES in live-surface-anchor.ts in the SAME commit, with a note saying what changed and why."
      );
    }
    expect(actual).toBe(RATIFIED_TREES["skills"]);
  });

  it("anti-vacuity (REAL): the SAME classifier REJECTS each forbidden perturbation", () => {
    const allowed: Row[] = [
      ...ALLOWED_SKILL_ADDS.map((p) => ({ status: "A", path: p })),
      ...ALLOWED_SKILL_MODS.map((p) => ({ status: "M", path: p })),
    ];
    // sanity: the EXACT allowed set passes — the control discriminates, it is not always-false.
    expect(classifySkills(allowed).ok).toBe(true);

    // (a) a non-allowlisted ADD → added !== allowlist → FAIL.
    const add = classifySkills([...allowed, { status: "A", path: "skills/meta/product-template/README.md" }]);
    expect(add.added).not.toEqual([...ALLOWED_SKILL_ADDS].sort());
    expect(add.ok).toBe(false);

    // (b) a MODIFIED non-allowlisted existing skill → violations non-empty → FAIL.
    const modified = classifySkills([...allowed, { status: "M", path: "skills/meta/review/SKILL.md" }]);
    expect(modified.violations).not.toEqual([]);
    expect(modified.ok).toBe(false);

    // (c) a DELETION → violations non-empty → FAIL.
    const deleted = classifySkills([...allowed, { status: "D", path: "skills/core/init/SKILL.md" }]);
    expect(deleted.violations).not.toEqual([]);
    expect(deleted.ok).toBe(false);

    // (d) a RENAME (git --name-status emits `R<score>\told\tnew`) → FAIL.
    const renamed = classifySkills([
      ...allowed,
      { status: "R100", path: "skills/meta/a/SKILL.md skills/meta/b/SKILL.md" },
    ]);
    expect(renamed.violations).not.toEqual([]);
    expect(renamed.ok).toBe(false);

    // (e) with the allowlist EMPTY, even a single benign MOD is a violation — frozen as-ratified.
    const loneMod = classifySkills([{ status: "M", path: "skills/meta/brainstorm/SKILL.md" }]);
    expect(loneMod.violations).not.toEqual([]);
    expect(loneMod.ok).toBe(false);
    // …and a lone ADD is equally rejected.
    expect(classifySkills([{ status: "A", path: "skills/meta/newthing/SKILL.md" }]).ok).toBe(false);
  });
});
