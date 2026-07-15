/**
 * tests/universal-host/p2-w3-sc6-live-surface-guard.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W3-6 (regression + live-surface byte-identical) —
 * the DECISIVE binding check for the whole wave, and the mechanically-binding form of the
 * LW3-7a checklist-3 sign-off (FU-1). Anti-vacuity is mandatory (codex gate).
 *
 * RE-RATIFIED 2026-06-27 (operator "ship it all in v2"): the freeze baseline moved from the
 * obsolete pre-Wave-3 anchor (`3ce3666`) to the ratified v2 cutover surface (`4e91770`).
 * Operator-directed v2 work (understand→learn rename, product loop, ideation min-build)
 * legitimately evolved commands/ + skills/ past pre-Wave-3, so freezing against it was stale.
 * The REAL cutover-safety gate is `build:hosts` SC-2 normalized equivalence (generated ≡ committed, GREEN);
 * this guard is the secondary tripwire for FUTURE *unintended* drift from the ratified surface.
 *
 * The guard is anchored to a HARD-PINNED baseline (`PINNED_BASELINE` below, the ratified
 * surface). Pinned (not env-derived) so the diff anchor cannot be moved to HEAD/worktree to hide
 * a committed live-surface mutation. A `GUILD_W3_BASELINE_REF` env var is REJECTED unless it is an
 * ancestor-or-equal of the ratified baseline and an ancestor of HEAD (never HEAD, never forward);
 * even valid, it never moves the anchor.
 *
 * Two surfaces, two postures (both now frozen as-ratified — empty allowlists):
 *  (A) `.claude-plugin/**` + `commands/**` — STRICT byte-identical (ZERO delta vs the ratified
 *      baseline): the cutover-channel + F-5 freeze, the load-bearing invariant.
 *  (B) live `skills/**` — ZERO delta vs the ratified baseline (the prior product-template /
 *      Wave-7 allowlist entries are subsumed into the baseline). NO add/modify/delete/rename is
 *      permitted from the frozen surface; the next deliberate surface change bumps the pin.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const FROZEN_PATHS = [".claude-plugin", "commands"]; // STRICT byte-identical
// RE-RATIFIED 2026-06-27 (operator "ship it all in v2" directive): the cutover-surface freeze now
// anchors to the ratified surface (`PINNED_BASELINE` below — the last surface-touching commit,
// an ancestor of HEAD; originally 4e91770), NOT the obsolete pre-Wave-3 anchor (3ce3666). Operator-directed v2 work (the
// understand→learn rename, the product loop, the ideation min-build wiring) legitimately evolved
// commands/ + skills/ past pre-Wave-3, so freezing against it was stale. The REAL cutover-safety gate
// is `build:hosts` SC-2 normalized equivalence (generated tree ≡ committed tree, GREEN) — this guard is the
// secondary tripwire for FUTURE *unintended* drift from the ratified v2 surface. Bump this on the next
// deliberate surface change (or at the v2→main flip).
// RE-RATIFICATION RULE (read before bumping): the pin is the LAST commit on branch history that
// deliberately changed the frozen surface (`.claude-plugin/**`, `commands/**`, live `skills/**`) and
// is an ancestor of HEAD but NOT HEAD. It must leave ZERO delta to the working tree so the guard is
// GREEN now; it then trips the instant a NEW (unreleased) surface change lands on top. On any
// deliberate surface change, bump this pin to that change's commit. Do NOT auto-follow HEAD — a pin
// that chased HEAD would let a committed surface mutation hide itself (the whole reason it is pinned).
const PINNED_BASELINE = "631e1b5"; // RE-RATIFIED 2026-07-15 for the deliberate specialist-creation authority change. Commit 631e1b5 updates the live create-specialist and team-compose skill surfaces so human-requested specialists can be registered without historical evolution evidence while evolution-proposed specialists retain the evidence gate. Pinning that surface-changing commit restores zero delta and keeps the guard strict for every subsequent change.
const DIFF_SANITY_ANCHOR = "3ce3666"; // an OLD ancestor — used ONLY to prove `git diff` is wired (non-empty)

// The v2 surface is now the baseline, so there are no permitted deltas FROM it — the surface is frozen
// as-ratified. (The pre-Wave-3 allowlist of in-flight v2 changes is subsumed into the baseline.)
const ALLOWED_SKILL_ADDS: string[] = [];
const ALLOWED_SKILL_MODS: string[] = [];

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

/** Resolve the diff anchor — ALWAYS the pinned ratified-v2 baseline; env-bypass rejected. */
function resolveBaseline(): string {
  const base = revParse(PINNED_BASELINE);
  if (!base) throw new Error(`SC-W3-6: pinned ratified-v2 baseline ${PINNED_BASELINE} does not resolve (history altered?)`);
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
      // Anti-bypass: an env override may only make the baseline OLDER (stricter) — an
      // ancestor-or-equal of the ratified baseline. It can never move it FORWARD (which would
      // shrink the diff and weaken the guard).
      throw new Error(`SC-W3-6: GUILD_W3_BASELINE_REF must be an ancestor-or-equal of the ratified baseline (${PINNED_BASELINE})`);
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

// ── Release version-bump tolerance ─────────────────────────────────────────
// A release bumps the `version` field inside `.claude-plugin/plugin.json` +
// `marketplace.json` — a legitimate, release-only change to files this guard otherwise
// freezes byte-identical. Without this, every release would force a pin re-ratification
// commit. `stripVersions()` masks EVERY `version` key (plugin.json's top-level;
// marketplace.json's `plugins[].version`) and NOTHING else, so a PURE version bump is
// exempted while any other manifest change — a command/skill/agent declaration, name,
// source, description — still differs and stays a violation.
const VERSION_EXEMPT_MANIFESTS = new Set([".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]);

function stripVersions(jsonText: string): string {
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        out[k] = k === "version" ? " VERSION " : walk(v);
      }
      return out;
    }
    return o;
  };
  return JSON.stringify(walk(JSON.parse(jsonText)));
}

// True IFF `p` is a version-bearing manifest whose ONLY diff vs `baseline` is the version
// field. Added/deleted/unreadable/parse-fail all return false (fail-closed → stays a violation).
function isVersionOnlyManifestChange(baseline: string, p: string): boolean {
  if (!VERSION_EXEMPT_MANIFESTS.has(p)) return false;
  let base: string;
  let cur: string;
  try {
    base = git(["show", `${baseline}:${p}`]);
    cur = fs.readFileSync(path.join(PLUGIN_ROOT, p), "utf8");
  } catch {
    return false;
  }
  try {
    return stripVersions(base) === stripVersions(cur);
  } catch {
    return false;
  }
}

// Real frozen-surface violations vs `baseline`, with pure version-bump manifest changes
// removed. classifyFrozen stays pure (synthetic-row anti-vacuity below still exercises it);
// the version filter is applied only to REAL diff rows here.
function frozenSurfaceViolations(baseline: string): Row[] {
  const rows = diffRows(baseline, FROZEN_PATHS).filter(
    (r) => !(r.status === "M" && isVersionOnlyManifestChange(baseline, r.path)),
  );
  return classifyFrozen(rows);
}

/**
 * Pure classifier for the live `skills/**` rule (frozen as-ratified: empty allowlist ⇒ additive-only
 * degenerates to ZERO permitted deltas). Returns the non-addition rows
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

describe("SC-W3-6 — pinned ratified-v2 baseline is real (guard not vacuous)", () => {
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

  it("REJECTS a FORWARD GUILD_W3_BASELINE_REF (must be ancestor-or-equal of the ratified baseline)", () => {
    // Anti-bypass: an override that moves the baseline FORWARD (past the ratified anchor) would
    // shrink the diff and weaken the guard, so it must be rejected. Derive the forward ref (the
    // first commit AFTER the pin that is not HEAD) rather than hardcode a SHA, so it stays valid
    // across pin bumps. (An OLDER ref only adds strictness and is accepted — proven below.)
    const head = revParse("HEAD");
    const forwardRef = git(["rev-list", "--reverse", `${PINNED_BASELINE}..HEAD`])
      .split("\n").map((s) => s.trim()).filter(Boolean).find((s) => s !== head);
    expect(forwardRef).toBeTruthy(); // anti-vacuity: a real forward commit must exist to test with
    const prev = process.env["GUILD_W3_BASELINE_REF"];
    process.env["GUILD_W3_BASELINE_REF"] = forwardRef!; // forward of the pin ⇒ must be rejected
    try {
      expect(() => resolveBaseline()).toThrow(/ancestor-or-equal of the ratified baseline/);
    } finally {
      if (prev === undefined) delete process.env["GUILD_W3_BASELINE_REF"];
      else process.env["GUILD_W3_BASELINE_REF"] = prev;
    }
  });
});

describe("SC-W3-6 (A) — DECISIVE: .claude-plugin/** + commands/** byte-identical (STRICT)", () => {
  it("shows ZERO added/changed/deleted files under the frozen cutover surfaces", () => {
    const baseline = resolveBaseline();
    const violations = frozenSurfaceViolations(baseline);
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
    // Prove `git diff` is genuinely wired (not a no-op that would make the frozen-zero assertion
    // vacuous). Uses an OLD ancestor anchor: the ratified baseline is recent, so scripts/ may be
    // unchanged since it — but the diff MACHINERY must still demonstrably produce rows.
    expect(diffRows(DIFF_SANITY_ANCHOR, ["scripts", "templates"]).length).toBeGreaterThan(0);
  });

  it("version-bump tolerance is SPECIFIC — exempts a pure bump, still flags a surface change", () => {
    // plugin.json: top-level version. A pure bump masks equal; a bump that ALSO edits the
    // `commands`/`skills`/`agents` surface must NOT be masked equal (stays a violation).
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
    expect(isVersionOnlyManifestChange("HEAD", "commands/guild.md")).toBe(false);
    expect(isVersionOnlyManifestChange("HEAD", "skills/meta/init/SKILL.md")).toBe(false);
  });
});

describe("SC-W3-6 (B) — live skills/**: ZERO delta vs the ratified v2 baseline (frozen as-ratified)", () => {
  it("skills/** has ZERO delta from the ratified v2 baseline (frozen as-ratified)", () => {
    const baseline = resolveBaseline();
    const c = classifySkills(diffRows(baseline, ["skills"]));
    expect(c.violations).toEqual([]); // no unratified skill add/modify/delete/rename
    expect(c.added).toEqual([...ALLOWED_SKILL_ADDS].sort()); // added set is EXACTLY the allowlist
    expect(c.modified).toEqual([...ALLOWED_SKILL_MODS].sort()); // modified set is EXACTLY the W7 allowlist
    expect(c.ok).toBe(true);
  });

  it("anti-vacuity (REAL): the SAME classifier REJECTS each forbidden perturbation", () => {
    // Feed the SAME classifySkills the real assertion uses a perturbed added-set and prove the
    // frozen-surface verdict FLIPS to false for every forbidden delta (codex must-fix #2).
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

    // (e) with the ratified-surface allowlist now EMPTY, even a single benign skill MOD is a
    // violation — the surface is frozen as-ratified, so NO delta from the baseline is permitted.
    const loneMod = classifySkills([{ status: "M", path: "skills/meta/brainstorm/SKILL.md" }]);
    expect(loneMod.violations).not.toEqual([]);
    expect(loneMod.ok).toBe(false);
    // …and a lone ADD is equally rejected (added !== the empty allowlist).
    const loneAdd = classifySkills([{ status: "A", path: "skills/meta/newthing/SKILL.md" }]);
    expect(loneAdd.ok).toBe(false);
  });
});

describe("SC-W3-6 — cutover surface frozen vs the ratified v2 baseline", () => {
  it(".claude-plugin/** + commands/** are byte-identical to the ratified v2 baseline", () => {
    const base = revParse(PINNED_BASELINE);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    // Byte-identical EXCEPT a pure release version bump in the two .claude-plugin manifests.
    expect(frozenSurfaceViolations(base)).toEqual([]);
  });

  it("skills/** has zero delta from the ratified v2 baseline (surface frozen as-ratified)", () => {
    // RE-RATIFIED: the pre-Wave-2/3 anchors are obsolete — operator-directed v2 work evolved the
    // surface, and `build:hosts` SC-2 normalized equivalence (generated ≡ committed) is the real cutover-safety
    // gate. From the ratified baseline there are no permitted deltas; any future change re-reds this.
    const base = revParse(PINNED_BASELINE);
    const c = classifySkills(diffRows(base, ["skills"]));
    expect(c.added).toEqual([]);
    expect(c.modified).toEqual([]);
    expect(c.violations).toEqual([]);
    expect(c.ok).toBe(true);
  });
});
