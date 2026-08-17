/**
 * tests/universal-host/p2-w2-sc5-live-surface-guard.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-5 (DRIFT GUARD) — the install/runtime
 * surface is UNCHANGED since the ratified v2 baseline. The install-channel flip (G7)
 * is now ACTIVE (operator-authorized 2026-06-27): the generated tree is the authoritative
 * install surface, enforced by the `verify:host-packages` CI gate — `--check-claude-install`
 * (BYTE-compares the `.claude-plugin` metadata against the inventory render) + SC-2 (full-tree
 * NORMALIZED equivalence, not byte-identity) + SC-7b (subset). This guard is the complementary
 * tripwire — it ensures the frozen surface does not DRIFT from the ratified baseline; the channel
 * gate ensures it equals the inventory render. Airtight against vacuity (codex anti-vacuity gate).
 *
 * RE-RATIFIED 2026-06-27 (operator "ship it all in v2"): the freeze baseline moved from
 * the obsolete pre-Wave-2 anchor (7ac2f06) to the ratified v2 cutover surface (4e91770) —
 * operator-directed v2 work (understand→learn rename, product loop, ideation min-build)
 * legitimately evolved commands/ + skills/ past pre-Wave-2. The REAL cutover-safety gate
 * is `build:hosts` SC-2 normalized equivalence (generated ≡ committed, GREEN); this guard is the
 * secondary tripwire for FUTURE *unintended* drift from the ratified surface. Bump the
 * pin on the next deliberate surface change (or at the v2→main flip). The skill allowlists
 * are now EMPTY — the surface is frozen as-ratified, with NO permitted deltas.
 *
 * Two halves:
 *  (1) EMPTY-SET live-surface guard, anchored to the ratified TREE hashes (./live-surface-anchor.ts).
 *      `git diff --name-status <PINNED_BASELINE> -- .claude-plugin commands skills` vs the WORKING
 *      TREE must show ZERO entries. The baseline is HARD-PINNED — it can NEVER be
 *      HEAD/worktree (which would turn the diff into HEAD-vs-worktree and hide a COMMITTED
 *      live-surface mutation). A `GUILD_W2_BASELINE_REF` env var is REJECTED (throw) unless
 *      it is an ancestor-or-equal of the ratified baseline and an ancestor of HEAD (never
 *      HEAD, never forward); even when valid it does NOT move the diff anchor — the diff is
 *      ALWAYS against the pinned tree.
 *  (2) build-inventory RESOLVED-ENTRY A/B — a GENUINE pre/post comparison. The SAME
 *      `discoverSurfaces` resolver is run against the ratified-baseline tree (extracted via
 *      `git archive`) AND the current tree; the resolved skill/command runtime set must be
 *      byte-identical. Any surface ADD/CHANGE under live skills/ or commands/ since the
 *      ratified baseline would make the two sets differ → caught.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverSurfaces } from "../../scripts/build-inventory";
import {
  PLUGIN_ROOT,
  RATIFIED_CLAUDE_PLUGIN_FILES,
  RATIFIED_MANIFESTS,
  RATIFIED_TREES,
  claudePluginFileSet,
  describeTreeDelta,
  git,
  manifestStrippedHash,
  ratifiedSurfaceTree,
  stripVersions,
  withLiveSurfaceLock,
  worktreeTreeHash,
} from "./live-surface-anchor";
const LIVE_PATHS = [".claude-plugin", "commands", "skills"];

/**
 * Skill allowlists — now EMPTY (RE-RATIFIED 2026-06-27, "ship it all in v2"). The baseline anchors
 * to the ratified surface (`PINNED_BASELINE` below; originally 4e91770), so the prior in-flight Wave-3 additive (product-template) +
 * Wave-7 metadata-mod entries are SUBSUMED into the baseline. `.claude-plugin/**` + `commands/**`
 * stay STRICT byte-frozen, and live `skills/**` is now ZERO-delta too: with an empty allowlist, ANY
 * add/modify/delete/rename from the ratified baseline is a violation. (See the SC-W3-6 guard header
 * for the full rationale; `build:hosts` SC-2 normalized equivalence is the real cutover-safety gate.) Bump the
 * pin on the next deliberate surface change rather than re-populating these.
 */
const WAVE3_SKILL_ADDITION_FILES: string[] = [];
const WAVE7_SKILL_MODIFICATION_FILES: string[] = [];
const isAllowlistedSkillAddition = (p: string): boolean => WAVE3_SKILL_ADDITION_FILES.includes(p);
const isAllowlistedSkillModification = (p: string): boolean => WAVE7_SKILL_MODIFICATION_FILES.includes(p);

type DiffRow = { status: string; path: string; raw: string };
type ResolvedSkill = { source_path: string };

function parseDiffRows(out: string): DiffRow[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const [status, ...rest] = raw.split(/\s+/);
      return { status, path: rest.join(" "), raw };
    });
}

function evaluateLiveSurfaceRows(rows: DiffRow[]): {
	  violations: DiffRow[];
	  addedSkillFiles: string[];
	  modifiedSkillFiles: string[];
	  ok: boolean;
	} {
	  const violations = rows.filter(({ status, path: p }) => {
    // .claude-plugin/** and commands/** are STRICT — any delta is a violation.
    if (p.startsWith(".claude-plugin/") || p.startsWith("commands/")) return true;
	    // skills/** is frozen as-ratified (empty allowlist) — ANY add/modify/delete/rename is a violation.
	    // Any delete/rename, non-allowlisted add, or non-allowlisted modify remains a violation.
	    if (p.startsWith("skills/")) {
	      return !(
	        (status === "A" && isAllowlistedSkillAddition(p)) ||
	        (status === "M" && isAllowlistedSkillModification(p))
	      );
	    }
	    return true;
	  });
	  const addedSkillFiles = rows
	    .filter((r) => r.status === "A" && r.path.startsWith("skills/"))
	    .map((r) => r.path)
	    .sort();
	  const modifiedSkillFiles = rows
	    .filter((r) => r.status === "M" && r.path.startsWith("skills/"))
	    .map((r) => r.path)
	    .sort();
	  const expected = [...WAVE3_SKILL_ADDITION_FILES].sort();
	  const expectedModified = [...WAVE7_SKILL_MODIFICATION_FILES].sort();
	  return {
	    violations,
	    addedSkillFiles,
	    modifiedSkillFiles,
	    ok:
	      violations.length === 0 &&
	      addedSkillFiles.length === expected.length &&
	      addedSkillFiles.every((p, i) => p === expected[i]) &&
	      modifiedSkillFiles.length === expectedModified.length &&
	      modifiedSkillFiles.every((p, i) => p === expectedModified[i]),
	  };
	}

// ── The anchor: TREE hashes, not a commit pin ────────────────────────────────
// See ./live-surface-anchor.ts. A commit pin is orphaned by every squash-merge (#37,
// #38, #39 in a row left this guard DARK on `next`); a tree hash is content identity,
// which a squash preserves. With no movable ref there is nothing to point at HEAD,
// move forward, or override — so resolveBaseline(), the ancestry/not-HEAD checks and
// the GUILD_W2_BASELINE_REF bypass-rejector are deleted along with the vector they
// defended.

/** Run the REAL `discoverSurfaces` resolver over the RATIFIED baseline trees. */
function resolveAtRatifiedBaseline(): { skills: unknown; commands: unknown } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-w2-baseline-"));
  try {
    const tarPath = path.join(tmp, "tree.tar");
    // `git archive` accepts any tree-ish: synthesize a tree holding exactly the ratified
    // frozen subtrees, so the baseline is anchored on CONTENT and survives a squash.
    execFileSync("git", ["archive", "--format=tar", "-o", tarPath, ratifiedSurfaceTree()], {
      cwd: PLUGIN_ROOT,
    });
    execFileSync("tar", ["-xf", tarPath, "-C", tmp]);
    const d = discoverSurfaces(tmp); // SAME resolver L1 uses, now over the ratified tree
    return { skills: d.skills, commands: d.commands };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("SC-W2-5 (1) — EMPTY-SET live-surface guard (pinned ratified-v2 baseline)", () => {
  it("every ratified TREE anchor resolves to a real git tree object", () => {
    for (const [p, tree] of Object.entries(RATIFIED_TREES)) {
      expect(p).toBeTruthy();
      expect(tree).toMatch(/^[0-9a-f]{40}$/);
      expect(git(["cat-file", "-t", tree])).toBe("tree");
    }
  });

  it("anti-vacuity: worktreeTreeHash DETECTS a perturbation (it is not a constant)", () => {
    // FIC-48: this suite's perturbation victim TREE is `commands/` (SC-W3-6's is
    // `skills/`), and the whole before→perturb→restore→after window holds the
    // cross-worker live-surface lock — a sibling worker hashing `commands` inside
    // this window would otherwise capture the probe and false-fail at restore time.
    withLiveSurfaceLock(() => {
      const victim = path.join(PLUGIN_ROOT, "commands", "init.md");
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
  });

  it("strict ZERO delta under .claude-plugin/ + commands/ + skills/ vs the ratified surface", () => {
    // Tree hashes compare the RATIFIED CONTENT to the WORKING TREE, so this catches BOTH a
    // committed and an uncommitted live-surface mutation — and, unlike the old commit pin,
    // it is not orphaned by a squash-merge.
    // FIC-48: reads every pinned live tree, so it takes the same lock the
    // perturbation windows hold — a probe mid-flight is a sibling's, not drift.
    withLiveSurfaceLock(() => {
      for (const p of Object.keys(RATIFIED_TREES)) {
        const actual = worktreeTreeHash(p);
        if (actual !== RATIFIED_TREES[p]) {
          throw new Error(
            `SC-W2-5: ${p}/ changed vs the ratified tree ${RATIFIED_TREES[p]}:\n  ` +
              describeTreeDelta(p, RATIFIED_TREES[p]!, actual).join("\n  ") +
              "\n\nIf DELIBERATE, re-ratify RATIFIED_TREES in live-surface-anchor.ts in the SAME commit."
          );
        }
        expect(actual).toBe(RATIFIED_TREES[p]);
      }
      // `.claude-plugin/` is per-file (release version bump is exempt) + an exact file set.
      for (const [m, expected] of Object.entries(RATIFIED_MANIFESTS)) {
        expect(manifestStrippedHash(m)).toBe(expected);
      }
      expect(claudePluginFileSet()).toEqual([...RATIFIED_CLAUDE_PLUGIN_FILES]);
    });
  });

  it("anti-vacuity: the SAME live-surface evaluator rejects widened, missing, or frozen-surface deltas", () => {
	    const allowedRows = [
	      ...WAVE3_SKILL_ADDITION_FILES.map((p) => ({ status: "A", path: p, raw: `A\t${p}` })),
	      ...WAVE7_SKILL_MODIFICATION_FILES.map((p) => ({ status: "M", path: p, raw: `M\t${p}` })),
	    ];

    expect(evaluateLiveSurfaceRows(allowedRows).ok).toBe(true);

    const thirdFile = evaluateLiveSurfaceRows([
      ...allowedRows,
      { status: "A", path: "skills/meta/product-template/README.md", raw: "A\tskills/meta/product-template/README.md" },
    ]);
    expect(thirdFile.violations.map((v) => v.path)).toContain("skills/meta/product-template/README.md");
    expect(thirdFile.ok).toBe(false);

	    // With the ratified-surface allowlist now EMPTY, EVERY skills delta is a violation — a lone add
	    // and a lone modify are both rejected (the surface is frozen as-ratified).
	    const loneAdd = evaluateLiveSurfaceRows([{ status: "A", path: "skills/meta/newthing/SKILL.md", raw: "A\tskills/meta/newthing/SKILL.md" }]);
	    expect(loneAdd.ok).toBe(false);
	    const loneMod = evaluateLiveSurfaceRows([{ status: "M", path: "skills/meta/brainstorm/SKILL.md", raw: "M\tskills/meta/brainstorm/SKILL.md" }]);
	    expect(loneMod.ok).toBe(false);
	    // A delete and a rename are always violations under skills/ too.
	    const loneDel = evaluateLiveSurfaceRows([{ status: "D", path: "skills/core/init/SKILL.md", raw: "D\tskills/core/init/SKILL.md" }]);
	    expect(loneDel.ok).toBe(false);
	    const loneRename = evaluateLiveSurfaceRows([
	      { status: "R100", path: "skills/meta/a/SKILL.md skills/meta/b/SKILL.md", raw: "R100\tskills/meta/a/SKILL.md\tskills/meta/b/SKILL.md" },
	    ]);
	    expect(loneRename.violations).not.toEqual([]);
	    expect(loneRename.ok).toBe(false);

	    const frozenMutation = evaluateLiveSurfaceRows([
	      ...allowedRows,
      { status: "M", path: ".claude-plugin/plugin.json", raw: "M\t.claude-plugin/plugin.json" },
      { status: "A", path: "commands/dashboard.md", raw: "A\tcommands/dashboard.md" },
    ]);
    expect(frozenMutation.violations.map((v) => v.path)).toEqual([
      ".claude-plugin/plugin.json",
      "commands/dashboard.md",
    ]);
    expect(frozenMutation.ok).toBe(false);
  });

  it("the guard is anti-vacuous: the SAME diff over CHANGED trees is NON-empty", () => {
    // Proves the diff command actually detects change — the empty live-surface result
    // is a real 'unchanged', not a no-op/broken invocation. Anchored to a STABLE old ancestor
    // (the previous ratified baseline) rather than the current pin, so the diff-is-wired proof
    // stays non-vacuous no matter how close the current pin sits to HEAD.
    const PRIOR_RATIFIED = "4e91770"; // previous pin — a real ancestor with changes vs the worktree
    const changedElsewhere = git(["diff", "--name-status", PRIOR_RATIFIED, "--", "scripts", "skill-src", "command-src"])
      .split("\n").map((l) => l.trim()).filter(Boolean);
    expect(changedElsewhere.length).toBeGreaterThan(0);
  });

  it("version-bump tolerance is SPECIFIC — exempts a pure bump, still flags a surface change", () => {
    // plugin.json: top-level version masked; the `commands`/`skills`/`agents` surface is not.
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
    // Only the two .claude-plugin manifests are version-exempt PATHS — everything else is strict.
    // The version tolerance is scoped to the two manifests ONLY — everything else is
    // anchored by a raw tree hash, which no version masking can soften.
    expect(Object.keys(RATIFIED_MANIFESTS).sort()).toEqual([...RATIFIED_CLAUDE_PLUGIN_FILES]);
    expect(Object.keys(RATIFIED_TREES).sort()).toEqual(["commands", "skills"]);
  });
});

describe("SC-W2-5 (2) — build-inventory resolved-entry A/B (GENUINE pre/post)", () => {
  /** Run the REAL `discoverSurfaces` resolver against the live trees at `baseSha`. */
  const pre = resolveAtRatifiedBaseline();
  // FIC-48: the live-tree resolution also excludes sibling perturbation windows.
  const cur = withLiveSurfaceLock(() => discoverSurfaces(PLUGIN_ROOT));

  it("baseline resolution actually produced a non-empty resolved set (not vacuous)", () => {
    expect((pre.skills as unknown[]).length).toBeGreaterThan(0);
    expect((pre.commands as unknown[]).length).toBeGreaterThan(0);
  });

  it("the RESOLVED SKILL set is byte-identical pre/post the ratified v2 baseline (zero delta)", () => {
    // The cutover surface is frozen as-ratified, so the REAL resolver (`discoverSurfaces`) over the
    // baseline tree must byte-equal the current resolved set — NOTHING changed since the ratified
    // baseline. (Pre-ratification this permitted exactly the product-template addition; that delta is
    // now subsumed into the baseline, so the expected delta is ZERO.)
    expect(JSON.stringify(cur.skills)).toBe(JSON.stringify(pre.skills));
  });

  it("anti-vacuity: the resolved-skill comparison is capable of detecting a perturbation", () => {
    // Prove the byte-identical comparison can FAIL — mutating a single resolved source_path makes the
    // JSON differ from the baseline. Guards against a vacuous always-equal comparison.
    const skills = cur.skills as { source_path: string }[];
    expect(skills.length).toBeGreaterThan(0);
    const perturbed = skills.map((s, i) => (i === 0 ? { ...s, source_path: s.source_path + ".MUTATED" } : s));
    expect(JSON.stringify(perturbed)).not.toBe(JSON.stringify(pre.skills));
  });

  it("the RESOLVED COMMAND set is byte-identical pre/post Wave-2", () => {
    expect(JSON.stringify(cur.commands)).toBe(JSON.stringify(pre.commands));
  });

  it("the A/B is anti-vacuous: an injected extra skill in the baseline set would differ", () => {
    // Sanity that JSON equality discriminates — a perturbed baseline must NOT equal current.
    const perturbed = [...(pre.skills as unknown[]), { id: "__phantom__", source_path: "skills/x/SKILL.md" }];
    expect(JSON.stringify(cur.skills)).not.toBe(JSON.stringify(perturbed));
  });

  it("no resolved entry is sourced from the new neutral source trees (skill-src/command-src)", () => {
    const allPaths = [...(cur.skills as { source_path: string }[]), ...(cur.commands as { source_path: string }[])].map(
      (e) => e.source_path,
    );
    expect(allPaths.some((p) => p.includes("skill-src/") || p.includes("command-src/"))).toBe(false);
  });

  it("the P0 using-guild resolved entry is UNCHANGED (still its co-located SKILL.src.md)", () => {
    const ug = (cur.skills as { id: string; source_path: string }[]).find((s) => s.id === "using-guild");
    expect(ug).toBeDefined();
    expect(ug!.source_path).toBe("skills/meta/using-guild/SKILL.src.md");
  });
});
