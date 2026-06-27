/**
 * tests/universal-host/p2-w2-sc5-live-surface-guard.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-5 (DRIFT GUARD) — the install/runtime
 * surface is UNCHANGED since the ratified v2 baseline. The install-channel flip (G7)
 * is now ACTIVE (operator-authorized 2026-06-27): the generated tree is the authoritative
 * install surface, enforced by the `verify:host-packages` CI gate (`--check-claude-install`
 * + SC-2 + SC-7b). This guard is the complementary tripwire — it ensures the frozen surface
 * does not DRIFT from the ratified baseline; the channel gate ensures it equals the inventory
 * render. Airtight against vacuity (codex anti-vacuity gate).
 *
 * RE-RATIFIED 2026-06-27 (operator "ship it all in v2"): the freeze baseline moved from
 * the obsolete pre-Wave-2 anchor (7ac2f06) to the ratified v2 cutover surface (4e91770) —
 * operator-directed v2 work (understand→learn rename, product loop, ideation min-build)
 * legitimately evolved commands/ + skills/ past pre-Wave-2. The REAL cutover-safety gate
 * is `build:hosts` SC-2 byte-parity (generated == committed, GREEN); this guard is the
 * secondary tripwire for FUTURE *unintended* drift from the ratified surface. Bump the
 * pin on the next deliberate surface change (or at the v2→main flip). The skill allowlists
 * are now EMPTY — the surface is frozen as-ratified, with NO permitted deltas.
 *
 * Two halves:
 *  (1) EMPTY-SET live-surface guard, anchored to the PINNED ratified-v2 baseline (4e91770).
 *      `git diff --name-status 4e91770 -- .claude-plugin commands skills` vs the WORKING
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

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const LIVE_PATHS = [".claude-plugin", "commands", "skills"];

/**
 * Skill allowlists — now EMPTY (RE-RATIFIED 2026-06-27, "ship it all in v2"). The baseline anchors
 * to the ratified v2 surface (4e91770), so the prior in-flight Wave-3 additive (product-template) +
 * Wave-7 metadata-mod entries are SUBSUMED into the baseline. `.claude-plugin/**` + `commands/**`
 * stay STRICT byte-frozen, and live `skills/**` is now ZERO-delta too: with an empty allowlist, ANY
 * add/modify/delete/rename from the ratified baseline is a violation. (See the SC-W3-6 guard header
 * for the full rationale; `build:hosts` SC-2 byte-parity is the real cutover-safety gate.) Bump the
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

/**
 * The HARD-PINNED ratified-v2 baseline (4e91770 — the commit at which commands/ + skills/ settled;
 * an ancestor of HEAD, not HEAD). Pinned (not env-derived) so the guard's diff anchor cannot be
 * moved to HEAD/worktree to hide a committed live-surface mutation.
 */
const PINNED_BASELINE = "4e91770"; // RE-RATIFIED to the v2 surface (was 7ac2f06, pre-Wave-2, obsolete)

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
 * Resolve the diff anchor. ALWAYS the pinned ratified-v2 baseline. Validates the pin
 * is real (resolves, is an ancestor of HEAD, is NOT HEAD), and REJECTS a tampered
 * `GUILD_W2_BASELINE_REF` (the bypass vector): it may never be HEAD, must be an
 * ancestor of HEAD, and must be an ancestor-or-equal of the ratified baseline.
 * Even a *valid* override does not move the anchor — the diff is always the pin.
 */
function resolveBaseline(): string {
  const base = revParse(PINNED_BASELINE);
  if (!base) {
    throw new Error(`SC-W2-5: pinned ratified-v2 baseline ${PINNED_BASELINE} does not resolve (history altered?)`);
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
    // Anti-bypass: an override may only make the baseline OLDER (stricter) — ancestor-or-equal of the
    // ratified baseline. It can never move FORWARD (which would shrink the diff and weaken the guard).
    if (!(envSha === base || isAncestor(env, PINNED_BASELINE))) {
      throw new Error(`SC-W2-5: GUILD_W2_BASELINE_REF must be an ancestor-or-equal of the ratified baseline (${PINNED_BASELINE})`);
    }
  }
  // The anchor is ALWAYS the pinned ratified-v2 tree — never the (possibly newer) env ref.
  return base;
}

describe("SC-W2-5 (1) — EMPTY-SET live-surface guard (pinned ratified-v2 baseline)", () => {
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

  it("REJECTS a FORWARD GUILD_W2_BASELINE_REF (must be ancestor-or-equal of the ratified baseline)", () => {
    const prev = process.env["GUILD_W2_BASELINE_REF"];
    // 67e8635 is AFTER the ratified baseline (4e91770) but an ancestor of HEAD — a forward move that
    // would shrink the diff/weaken the guard, so it must be rejected. (Older refs only add strictness.)
    process.env["GUILD_W2_BASELINE_REF"] = "67e8635";
    try {
      expect(() => resolveBaseline()).toThrow(/ancestor-or-equal of the ratified baseline/);
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

  it("strict ZERO delta under .claude-plugin/ + commands/ + skills/ vs the ratified v2 baseline (frozen as-ratified)", () => {
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
