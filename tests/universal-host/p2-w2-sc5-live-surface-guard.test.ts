/**
 * tests/universal-host/p2-w2-sc5-live-surface-guard.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-5 (DEFERRAL GUARD) — the install/runtime
 * surface is UNCHANGED by Wave-2 (the channel was NOT flipped). This guard protects
 * the DEFERRED cutover, so it is airtight against vacuity (codex anti-vacuity gate).
 *
 * Two halves:
 *  (1) EMPTY-SET live-surface guard, anchored to a PINNED pre-Wave-2 baseline.
 *      `git diff --name-status 7ac2f06 -- .claude-plugin commands skills` (the parent
 *      of the first Wave-2 commit f226a8e) vs the WORKING TREE must show ZERO entries.
 *      The baseline is HARD-PINNED — it can NEVER be HEAD/worktree (which would turn
 *      the diff into HEAD-vs-worktree and hide a COMMITTED live-surface mutation). A
 *      `GUILD_W2_BASELINE_REF` env var is REJECTED (throw) unless it names a commit
 *      that predates Wave-2 and is an ancestor of HEAD (never HEAD); even when valid
 *      it does NOT move the diff anchor — the diff is ALWAYS against the pinned tree.
 *  (2) build-inventory RESOLVED-ENTRY A/B — a GENUINE pre/post comparison. The SAME
 *      `discoverSurfaces` resolver is run against the PRE-Wave-2 tree (extracted from
 *      the pinned baseline via `git archive`) AND the current tree; the resolved
 *      skill/command runtime set must be byte-identical. A Wave-2 surface ADD/CHANGE
 *      under live skills/ or commands/ would make the two sets differ → caught (this
 *      is NOT a current-vs-current determinism check).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverSurfaces } from "../../scripts/build-inventory";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const LIVE_PATHS = [".claude-plugin", "commands", "skills"];

/**
 * Wave-3 RATIFIED additive allowlist (operator decision 2026-06-17): the LW3-5 product-loop
 * template producer ships its invocation skill as an ADDITIVE new skill. `.claude-plugin/**`
 * and `commands/**` remain STRICT byte-frozen (the cutover + F-5 freeze, ZERO delta); live
 * `skills/**` is additive-only — a NEW skill is permitted, but NO existing skill may change.
 * The allowlist is exactly these two files; everything else under skills/ stays frozen.
 */
// EXACT two-file allowlist (not a directory prefix — a prefix would let a third file like
// product-template/README.md or product-template/extra/SKILL.md slip through; codex G-lane LW3-6).
const WAVE3_SKILL_ADDITION_FILES = [
  "skills/meta/product-template/SKILL.md",
  "skills/meta/product-template/evals.json",
];
const WAVE7_SKILL_MODIFICATION_FILES = [
  "skills/specialists/architect-tradeoff-matrix/SKILL.md",
  "skills/specialists/backend-service-integration/SKILL.md",
  // learning-harness no-loss initiative (ratified, operator goal-authorized): doc-accuracy /
  // contract-repoint edits — body prose only; frontmatter (name/description/when_to_use/type)
  // byte-unchanged; no trigger/dispatch behavior change.
  "skills/meta/learning-checkpoint/SKILL.md",
  "skills/knowledge/learn-map/SKILL.md",
  "skills/knowledge/learn-graph/SKILL.md",
];
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
	    // skills/** is additive-only for Wave 3 plus exact ratified Wave 7 metadata mods.
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

function subtractAllowlistedResolvedSkills<T extends ResolvedSkill>(skills: T[]): T[] {
  return skills.filter((s) => !isAllowlistedSkillAddition(s.source_path));
}

/**
 * The HARD-PINNED pre-Wave-2 baseline: the parent of the first Wave-2 commit
 * (`f226a8e^`). Pinned (not env-derived) so the guard's diff anchor cannot be
 * moved to HEAD/worktree to hide a committed live-surface mutation.
 */
const PINNED_BASELINE = "7ac2f06";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: PLUGIN_ROOT, encoding: "utf8" }).trim();
}
function revParse(ref: string): string {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    return "";
  }
}
function isAncestor(a: string, b: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: PLUGIN_ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the diff anchor. ALWAYS the pinned pre-Wave-2 baseline. Validates the pin
 * is real (resolves, is an ancestor of HEAD, is NOT HEAD), and REJECTS a tampered
 * `GUILD_W2_BASELINE_REF` (the bypass vector): it may never be HEAD, must be an
 * ancestor of HEAD, and must predate Wave-2 (ancestor-or-equal of the pinned base).
 * Even a *valid* override does not move the anchor — the diff is always the pin.
 */
function resolveBaseline(): string {
  const base = revParse(PINNED_BASELINE);
  if (!base) {
    throw new Error(`SC-W2-5: pinned pre-Wave-2 baseline ${PINNED_BASELINE} does not resolve (history altered?)`);
  }
  const head = revParse("HEAD");
  if (base === head) {
    throw new Error("SC-W2-5: pinned baseline equals HEAD — refusing (would degrade to HEAD-vs-worktree)");
  }
  if (!isAncestor(PINNED_BASELINE, "HEAD")) {
    throw new Error("SC-W2-5: pinned baseline is not an ancestor of HEAD");
  }

  const env = process.env["GUILD_W2_BASELINE_REF"];
  if (env !== undefined && env !== "") {
    const envSha = revParse(env);
    if (!envSha) throw new Error(`SC-W2-5: GUILD_W2_BASELINE_REF="${env}" does not resolve to a commit`);
    if (envSha === head) {
      throw new Error("SC-W2-5: GUILD_W2_BASELINE_REF must NOT be HEAD (HEAD-vs-worktree hides committed live-surface changes)");
    }
    if (!isAncestor(env, "HEAD")) {
      throw new Error("SC-W2-5: GUILD_W2_BASELINE_REF must be an ancestor of HEAD");
    }
    // predates Wave-2 ⇔ ancestor-or-equal of the pinned pre-Wave-2 baseline.
    if (!(envSha === base || isAncestor(env, PINNED_BASELINE))) {
      throw new Error("SC-W2-5: GUILD_W2_BASELINE_REF must predate Wave-2 (ancestor-or-equal of 7ac2f06)");
    }
  }
  // The anchor is ALWAYS the pinned pre-Wave-2 tree — never the (possibly newer) env ref.
  return base;
}

describe("SC-W2-5 (1) — EMPTY-SET live-surface guard (pinned pre-Wave-2 baseline)", () => {
  it("the pinned baseline is real, an ancestor of HEAD, and NOT HEAD (guard not vacuous)", () => {
    const base = resolveBaseline();
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(base).not.toBe(revParse("HEAD"));
    expect(isAncestor(PINNED_BASELINE, "HEAD")).toBe(true);
  });

  it("REJECTS GUILD_W2_BASELINE_REF=HEAD (the env-bypass vector)", () => {
    const prev = process.env["GUILD_W2_BASELINE_REF"];
    process.env["GUILD_W2_BASELINE_REF"] = "HEAD";
    try {
      expect(() => resolveBaseline()).toThrow(/must NOT be HEAD/);
    } finally {
      if (prev === undefined) delete process.env["GUILD_W2_BASELINE_REF"];
      else process.env["GUILD_W2_BASELINE_REF"] = prev;
    }
  });

  it("REJECTS a post-Wave-2 GUILD_W2_BASELINE_REF (must predate Wave-2)", () => {
    const prev = process.env["GUILD_W2_BASELINE_REF"];
    // The first Wave-2 commit itself does NOT predate Wave-2 → must be rejected.
    process.env["GUILD_W2_BASELINE_REF"] = "f226a8e";
    try {
      expect(() => resolveBaseline()).toThrow(/predate Wave-2/);
    } finally {
      if (prev === undefined) delete process.env["GUILD_W2_BASELINE_REF"];
      else process.env["GUILD_W2_BASELINE_REF"] = prev;
    }
  });

  it("diff is ALWAYS anchored to the pin even when a VALID older override is set", () => {
    const prev = process.env["GUILD_W2_BASELINE_REF"];
    // The pinned baseline's own parent is a valid pre-Wave-2 ancestor; setting it must
    // NOT change the anchor (still the pin) — proven by an identical return value.
    const grandparent = revParse(`${PINNED_BASELINE}^`);
    if (grandparent) {
      process.env["GUILD_W2_BASELINE_REF"] = grandparent;
      try {
        expect(resolveBaseline()).toBe(revParse(PINNED_BASELINE));
      } finally {
        if (prev === undefined) delete process.env["GUILD_W2_BASELINE_REF"];
        else process.env["GUILD_W2_BASELINE_REF"] = prev;
      }
    }
  });

  it("strict ZERO delta under .claude-plugin/ + commands/; skills/ additive-only (ratified allowlist)", () => {
    const baseline = resolveBaseline();
    // `git diff <ref> -- paths` spans <ref>..WORKING TREE, so it catches BOTH a
    // committed AND an uncommitted live-surface mutation (the committed case is the
    // env-bypass attack this guard closes).
    const verdict = evaluateLiveSurfaceRows(parseDiffRows(git(["diff", "--name-status", baseline, "--", ...LIVE_PATHS])));
    if (verdict.violations.length > 0) {
      throw new Error(
        `SC-W2-5: live surface changed vs ${baseline} beyond the ratified additive allowlist:\n  ${verdict.violations.map((v) => v.raw).join("\n  ")}`,
      );
    }
    expect(verdict.violations).toEqual([]);
	    // EXACT-SET: the ADDED files under skills/ must be EXACTLY the two ratified files — no fewer
	    // (each individually present) and no more (a third file under the dir would fail this equality).
	    expect(verdict.addedSkillFiles).toEqual([...WAVE3_SKILL_ADDITION_FILES].sort());
	    expect(verdict.modifiedSkillFiles).toEqual([...WAVE7_SKILL_MODIFICATION_FILES].sort());
	    expect(verdict.ok).toBe(true);
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

	    for (const required of WAVE3_SKILL_ADDITION_FILES) {
	      const missingRequired = evaluateLiveSurfaceRows(allowedRows.filter((r) => r.path !== required));
	      expect(missingRequired.addedSkillFiles).not.toEqual([...WAVE3_SKILL_ADDITION_FILES].sort());
	      expect(missingRequired.ok).toBe(false);
	    }
	    for (const required of WAVE7_SKILL_MODIFICATION_FILES) {
	      const missingRequired = evaluateLiveSurfaceRows(allowedRows.filter((r) => r.path !== required));
	      expect(missingRequired.modifiedSkillFiles).not.toEqual([...WAVE7_SKILL_MODIFICATION_FILES].sort());
	      expect(missingRequired.ok).toBe(false);
	    }

	    const wrongStatus = evaluateLiveSurfaceRows([
	      ...allowedRows.filter((r) => r.path !== WAVE7_SKILL_MODIFICATION_FILES[0]),
	      { status: "A", path: WAVE7_SKILL_MODIFICATION_FILES[0], raw: `A\t${WAVE7_SKILL_MODIFICATION_FILES[0]}` },
	    ]);
	    expect(wrongStatus.violations.map((v) => v.path)).toContain(WAVE7_SKILL_MODIFICATION_FILES[0]);
	    expect(wrongStatus.ok).toBe(false);

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

  it("the guard is anti-vacuous: the SAME diff over Wave-2-CHANGED trees is NON-empty", () => {
    // Proves the diff command actually detects change — the empty live-surface result
    // is a real 'unchanged', not a no-op/broken invocation.
    const baseline = resolveBaseline();
    const changedElsewhere = git(["diff", "--name-status", baseline, "--", "scripts", "skill-src", "command-src"])
      .split("\n").map((l) => l.trim()).filter(Boolean);
    expect(changedElsewhere.length).toBeGreaterThan(0);
  });
});

describe("SC-W2-5 (2) — build-inventory resolved-entry A/B (GENUINE pre/post)", () => {
  /** Run the REAL `discoverSurfaces` resolver against the live trees at `baseSha`. */
  function resolveAtBaseline(baseSha: string): { skills: unknown; commands: unknown } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-w2-baseline-"));
    try {
      const tarPath = path.join(tmp, "tree.tar");
      // Extract the PRE-Wave-2 live surface trees from the pinned commit.
      execFileSync("git", ["archive", "--format=tar", "-o", tarPath, baseSha, "skills", "commands"], {
        cwd: PLUGIN_ROOT,
      });
      execFileSync("tar", ["-xf", tarPath, "-C", tmp]);
      const d = discoverSurfaces(tmp); // SAME resolver L1 uses, now over the baseline tree
      return { skills: d.skills, commands: d.commands };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const baseline = resolveBaseline();
  const pre = resolveAtBaseline(baseline);
  const cur = discoverSurfaces(PLUGIN_ROOT);

  it("baseline resolution actually produced a non-empty resolved set (not vacuous)", () => {
    expect((pre.skills as unknown[]).length).toBeGreaterThan(0);
    expect((pre.commands as unknown[]).length).toBeGreaterThan(0);
  });

  it("the RESOLVED SKILL set is byte-identical pre/post EXCEPT the ratified additive skill", () => {
    // Current minus the ratified Wave-3 addition must byte-equal the pre-Wave-2 resolved set —
    // i.e. NOTHING changed about any pre-existing skill; the only delta is the allowed new one.
    const curMinusAdditions = subtractAllowlistedResolvedSkills(cur.skills as { source_path: string }[]);
    expect(JSON.stringify(curMinusAdditions)).toBe(JSON.stringify(pre.skills));
    // And the allowlisted addition IS actually present in current (the delta is real, not vacuous).
    // Subtraction is by EXACT source_path membership (not a dir prefix), so a resolved skill living
    // under the dir but NOT one of the two ratified files would survive in curMinusAdditions and
    // break the equality above — i.e. the allowlist can't be silently widened.
    const additions = (cur.skills as { source_path: string }[]).filter((s) =>
      isAllowlistedSkillAddition(s.source_path),
    );
    expect(additions.length).toBeGreaterThan(0);
    expect(additions.every((s) => WAVE3_SKILL_ADDITION_FILES.includes(s.source_path))).toBe(true);
  });

  it("anti-vacuity: resolved-skill subtraction is exact source_path equality, not a product-template prefix", () => {
    const resolved = [
      { id: "allowed", source_path: "skills/meta/product-template/SKILL.md" },
      { id: "readme", source_path: "skills/meta/product-template/README.md" },
      { id: "nested", source_path: "skills/meta/product-template/extra/SKILL.md" },
      { id: "existing", source_path: "skills/core/init/SKILL.md" },
    ];
    expect(subtractAllowlistedResolvedSkills(resolved).map((s) => s.source_path)).toEqual([
      "skills/meta/product-template/README.md",
      "skills/meta/product-template/extra/SKILL.md",
      "skills/core/init/SKILL.md",
    ]);
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
