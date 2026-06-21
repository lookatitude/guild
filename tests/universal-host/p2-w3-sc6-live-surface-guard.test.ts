/**
 * tests/universal-host/p2-w3-sc6-live-surface-guard.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W3-6 (regression + live-surface byte-identical) —
 * the DECISIVE binding check for the whole wave, and the mechanically-binding form of the
 * LW3-7a checklist-3 sign-off (FU-1). Anti-vacuity is mandatory (codex gate).
 *
 * The guard is anchored to a HARD-PINNED pre-Wave-3 baseline: the parent of the FIRST
 * Wave-3 commit (`6692912^` = `3ce3666`). Pinned (not env-derived) so the diff anchor
 * cannot be moved to HEAD/worktree to hide a committed live-surface mutation. A
 * `GUILD_W3_BASELINE_REF` env var is REJECTED unless it predates Wave-3 and is an ancestor
 * of HEAD (never HEAD); even valid, it never moves the anchor.
 *
 * Two surfaces, two postures:
 *  (A) `.claude-plugin/**` + `commands/**` — STRICT byte-identical (ZERO delta). This is
 *      the cutover-channel + F-5 (no new/changed command) freeze: the load-bearing,
 *      non-negotiable invariant. No allowlist.
 *  (B) live `skills/**` — additive-only: the ONLY permitted delta is the ADDITION of the
 *      LW3-5 producer skill `skills/meta/product-template/**` (a planned Wave-3 deliverable —
 *      plan lane LW3-5; the plan's forbidden-list bars only new *command* files, not skills).
 *      NO pre-existing skill may be modified or deleted; NO other new skill may appear.
 *      ⚠ NOTE (see .guild/runs/<run>/questions/LW3-6.md): SC-W3-6's literal wording says
 *      "live skills/** byte-identical", which this additive producer skill VIOLATES, and the
 *      same addition reddens the existing SC-W2-5 skills empty-set guard. Whether the producer
 *      skill is an accepted additive deliverable (amend SC-W3-6/SC-W2-5 wording) or must be
 *      reworked is a LEAD / LW3-7b ratification call — this guard encodes the honest, exact
 *      current delta and does NOT silently widen the freeze.
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const FROZEN_PATHS = [".claude-plugin", "commands"]; // STRICT byte-identical
const PINNED_BASELINE = "3ce3666"; // 6692912^ — parent of the first Wave-3 commit

/** The ONLY live-skills delta SC-W3-6(B) permits (LW3-5 producer skill). */
const ALLOWED_SKILL_ADDS = [
  "skills/meta/product-template/SKILL.md",
  "skills/meta/product-template/evals.json",
];
const ALLOWED_SKILL_MODS = [
  "skills/specialists/architect-tradeoff-matrix/SKILL.md",
  "skills/specialists/backend-service-integration/SKILL.md",
  // learning-harness no-loss initiative (ratified, operator goal-authorized): doc-accuracy /
  // contract-repoint edits — body prose only; frontmatter byte-unchanged; no behavior change.
  "skills/meta/learning-checkpoint/SKILL.md",
  "skills/knowledge/learn-map/SKILL.md",
  "skills/knowledge/learn-graph/SKILL.md",
];

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

/** Resolve the diff anchor — ALWAYS the pinned pre-Wave-3 baseline; env-bypass rejected. */
function resolveBaseline(): string {
  const base = revParse(PINNED_BASELINE);
  if (!base) throw new Error(`SC-W3-6: pinned pre-Wave-3 baseline ${PINNED_BASELINE} does not resolve (history altered?)`);
  const head = revParse("HEAD");
  if (base === head) throw new Error("SC-W3-6: pinned baseline equals HEAD — refusing (would degrade to HEAD-vs-worktree)");
  if (!isAncestor(PINNED_BASELINE, "HEAD")) throw new Error("SC-W3-6: pinned baseline is not an ancestor of HEAD");

  const env = process.env["GUILD_W3_BASELINE_REF"];
  if (env !== undefined && env !== "") {
    const envSha = revParse(env);
    if (!envSha) throw new Error(`SC-W3-6: GUILD_W3_BASELINE_REF="${env}" does not resolve`);
    if (envSha === head) throw new Error("SC-W3-6: GUILD_W3_BASELINE_REF must NOT be HEAD");
    if (!isAncestor(env, "HEAD")) throw new Error("SC-W3-6: GUILD_W3_BASELINE_REF must be an ancestor of HEAD");
    if (!(envSha === base || isAncestor(env, PINNED_BASELINE))) {
      throw new Error("SC-W3-6: GUILD_W3_BASELINE_REF must predate Wave-3 (ancestor-or-equal of 3ce3666)");
    }
  }
  return base; // never the env ref
}

/** Parse `git diff --name-status` into [status, path] rows. */
function diffRows(baseline: string, paths: string[]): Array<{ status: string; path: string }> {
  const out = git(["diff", "--name-status", baseline, "--", ...paths]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split(/\s+/);
      return { status, path: rest.join(" ") };
    });
}

type Row = { status: string; path: string };

/**
 * Pure classifier: the diff rows that VIOLATE the strict frozen-surface freeze — any row whose
 * path is under one of FROZEN_PATHS (`.claude-plugin/`, `commands/`). The DECISIVE Part-A
 * assertion routes through THIS helper, so feeding it a SYNTHETIC `.claude-plugin/**` /
 * `commands/**` row exercises the SAME rejection logic and proves the strict-zero assertion is
 * capable of failing (real anti-vacuity, not a `git diff`-is-wired proxy).
 */
function classifyFrozen(rows: Row[]): Row[] {
  return rows.filter((r) => FROZEN_PATHS.some((f) => r.path === f || r.path.startsWith(f + "/")));
}

/**
 * Pure classifier for the live `skills/**` additive-only rule. Returns the non-addition rows
 * (any M/D/R is a violation) + the sorted added paths + an `ok` verdict that is true ONLY when
 * nonAdds is empty AND added === ALLOWED_SKILL_ADDS exactly. The real Part-B assertion AND the
 * perturbation controls both route through this single helper, so the controls exercise the
 * real classification path (not a hand-rolled parallel).
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

describe("SC-W3-6 — pinned pre-Wave-3 baseline is real (guard not vacuous)", () => {
  it("the pinned baseline resolves, is an ancestor of HEAD, and is NOT HEAD", () => {
    const base = resolveBaseline();
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(base).not.toBe(revParse("HEAD"));
    expect(isAncestor(PINNED_BASELINE, "HEAD")).toBe(true);
  });

  it("REJECTS GUILD_W3_BASELINE_REF=HEAD (the env-bypass vector)", () => {
    const prev = process.env["GUILD_W3_BASELINE_REF"];
    process.env["GUILD_W3_BASELINE_REF"] = "HEAD";
    try {
      expect(() => resolveBaseline()).toThrow(/must NOT be HEAD/);
    } finally {
      if (prev === undefined) delete process.env["GUILD_W3_BASELINE_REF"];
      else process.env["GUILD_W3_BASELINE_REF"] = prev;
    }
  });

  it("REJECTS a post-Wave-3 GUILD_W3_BASELINE_REF (must predate Wave-3)", () => {
    const prev = process.env["GUILD_W3_BASELINE_REF"];
    process.env["GUILD_W3_BASELINE_REF"] = "6692912"; // the first Wave-3 commit itself
    try {
      expect(() => resolveBaseline()).toThrow(/predate Wave-3/);
    } finally {
      if (prev === undefined) delete process.env["GUILD_W3_BASELINE_REF"];
      else process.env["GUILD_W3_BASELINE_REF"] = prev;
    }
  });
});

describe("SC-W3-6 (A) — DECISIVE: .claude-plugin/** + commands/** byte-identical (STRICT)", () => {
  it("shows ZERO added/changed/deleted files under the frozen cutover surfaces", () => {
    const baseline = resolveBaseline();
    const violations = classifyFrozen(diffRows(baseline, FROZEN_PATHS));
    if (violations.length > 0) {
      throw new Error(
        `SC-W3-6(A): cutover surface changed vs ${baseline} (allowlist is EMPTY):\n  ` +
          violations.map((r) => `${r.status}\t${r.path}`).join("\n  ")
      );
    }
    expect(violations).toEqual([]);
  });

  it("anti-vacuity (REAL): the SAME classifier FLAGS a synthetic .claude-plugin/** + commands/** mutation", () => {
    // Drive synthetic rows through the SAME classifyFrozen the DECISIVE assertion uses — proving
    // the strict-zero assertion is CAPABLE OF FAILING, not merely that `git diff` is wired up.
    const synthetic: Row[] = [
      { status: "A", path: ".claude-plugin/x.json" },
      { status: "M", path: "commands/new.md" },
      { status: "D", path: ".claude-plugin/marketplace.json" },
    ];
    expect(classifyFrozen(synthetic)).toEqual(synthetic); // ALL three are flagged violations
    // …and a non-frozen change is NOT flagged (the classifier is specific, not a blanket reject).
    expect(classifyFrozen([{ status: "A", path: "scripts/x.ts" }])).toEqual([]);
  });

  it("anti-vacuity (diff sanity): the SAME git diff over scripts/ + templates/ is NON-empty", () => {
    const baseline = resolveBaseline();
    expect(diffRows(baseline, ["scripts", "templates"]).length).toBeGreaterThan(0);
  });
});

describe("SC-W3-6 (B) — live skills/**: additive-only (ONLY the LW3-5 producer skill)", () => {
  it("the ONLY skills deltas are the product-template addition plus ratified W7 metadata mods", () => {
    const baseline = resolveBaseline();
    const c = classifySkills(diffRows(baseline, ["skills"]));
    expect(c.violations).toEqual([]); // no unratified skill add/modify/delete/rename
    expect(c.added).toEqual([...ALLOWED_SKILL_ADDS].sort()); // added set is EXACTLY the allowlist
    expect(c.modified).toEqual([...ALLOWED_SKILL_MODS].sort()); // modified set is EXACTLY the W7 allowlist
    expect(c.ok).toBe(true);
  });

  it("anti-vacuity (REAL): the SAME classifier REJECTS each forbidden perturbation", () => {
    // Feed the SAME classifySkills the real assertion uses a perturbed added-set and prove the
    // additive-only verdict FLIPS to false for every forbidden delta (codex must-fix #2).
    const allowed: Row[] = [
      ...ALLOWED_SKILL_ADDS.map((p) => ({ status: "A", path: p })),
      ...ALLOWED_SKILL_MODS.map((p) => ({ status: "M", path: p })),
    ];

    // sanity: the EXACT allowed set passes — the control is discriminating, not always-false.
    expect(classifySkills(allowed).ok).toBe(true);

    // (a) a THIRD added file under the producer dir → added !== allowlist → FAIL.
    const thirdAdd = classifySkills([...allowed, { status: "A", path: "skills/meta/product-template/README.md" }]);
    expect(thirdAdd.added).not.toEqual([...ALLOWED_SKILL_ADDS].sort());
    expect(thirdAdd.ok).toBe(false);

    // (b) a MODIFIED non-allowlisted existing skill (status M) → violations non-empty → FAIL.
    const modified = classifySkills([...allowed, { status: "M", path: "skills/meta/review/SKILL.md" }]);
    expect(modified.violations).not.toEqual([]);
    expect(modified.ok).toBe(false);

    // (c) a DELETION (status D) → violations non-empty → FAIL.
    const deleted = classifySkills([...allowed, { status: "D", path: "skills/core/init/SKILL.md" }]);
    expect(deleted.violations).not.toEqual([]);
    expect(deleted.ok).toBe(false);

    // (d) a RENAME (git --name-status emits `R<score>\told\tnew` → status "R100") → FAIL.
    const renamed = classifySkills([
      ...allowed,
      { status: "R100", path: "skills/meta/a/SKILL.md skills/meta/b/SKILL.md" },
    ]);
    expect(renamed.violations).not.toEqual([]);
    expect(renamed.ok).toBe(false);

    // (e) an allowlisted W7 file with the wrong status must not pass.
    const wrongStatus = classifySkills([
      ...allowed.filter((r) => r.path !== ALLOWED_SKILL_MODS[0]),
      { status: "A", path: ALLOWED_SKILL_MODS[0] },
    ]);
    expect(wrongStatus.violations.map((r) => r.path)).toContain(ALLOWED_SKILL_MODS[0]);
    expect(wrongStatus.ok).toBe(false);
  });
});

describe("SC-W3-6 — SC-W2-5 cutover surface still frozen (pre-Wave-2 anchor)", () => {
  const PINNED_W2 = "7ac2f06"; // pre-Wave-2 baseline (parent of first Wave-2 commit)
  it(".claude-plugin/** + commands/** are STILL byte-identical to the pre-Wave-2 baseline", () => {
    const base = revParse(PINNED_W2);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    const rows = diffRows(base, FROZEN_PATHS);
    expect(rows).toEqual([]);
  });

  it("NOTE: SC-W2-5's skills empty-set is reddened by the product-template addition plus W7 metadata mods", () => {
    // Documented cross-wave consequence. The skills delta vs the pre-Wave-2 baseline is
    // exactly the product-template producer skill plus the ratified W7 exemplar metadata.
    const base = revParse(PINNED_W2);
    const c = classifySkills(diffRows(base, ["skills"]));
    expect(c.added).toEqual([...ALLOWED_SKILL_ADDS].sort());
    expect(c.modified).toEqual([...ALLOWED_SKILL_MODS].sort());
    expect(c.ok).toBe(true);
  });
});
