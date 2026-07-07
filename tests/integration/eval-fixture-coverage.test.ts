/**
 * tests/integration/eval-fixture-coverage.test.ts
 *
 * Eval-fixture coverage tests for skills changed by the
 * cost-aware-tiering-and-lean-context ADR (VC-12 / SC-12).
 *
 * Verifies that the evals.json files added/updated by skill lanes:
 *   1. Are valid parseable JSON.
 *   2. Contain the minimum required trigger density (≥3 should_trigger,
 *      ≥3 should_not_trigger) per the eval-engineer quality checklist.
 *   3. Include at least one case that exercises the tiering/recall/escalate
 *      vocabulary introduced by the ADR (cheaptiering, recall, escalate,
 *      dispatch at tier, etc.) in the appropriate skills.
 *
 * Skills covered (those whose evals.json the ADR changed or added cases to):
 *   - learn-map  (tiering: cheap-scan, no powerful calls on plain init)
 *   - learn-graph (tiering: powerful-tier graph-schema, escalate trigger)
 *   - learn-onboard (tiering: cheap→mid split; recall/escalate NOT triggers)
 *   - learn-diff (tiering: recall cases; settings NOT triggers)
 *   - learn-explain (recall cases; settings NOT triggers)
 *   - execute-plan (dispatch-at-tier / escalate-to-advisor triggers)
 *
 * This test does NOT touch evals.json files — it reads and asserts on them.
 * Fixes go to skill-author (per handoff contract: eval-engineer files bugs,
 * does not fix skill bodies or their evals.json).
 *
 * guild-plan.md §15.2 risk row 4 (evolve overfit) + VC-12 (SC-12).
 */

import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

const SKILLS_ROOT = path.resolve(__dirname, "../../skills");

interface EvalsJson {
  should_trigger: string[];
  should_not_trigger: string[];
}

function loadEvals(skillPath: string): EvalsJson {
  const filePath = path.join(SKILLS_ROOT, skillPath, "evals.json");
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as EvalsJson;
}

/**
 * Returns true if any item in the array matches any of the keywords
 * (case-insensitive substring match).
 */
function anyMatches(items: string[], ...keywords: string[]): boolean {
  return items.some((item) =>
    keywords.some((kw) => item.toLowerCase().includes(kw.toLowerCase()))
  );
}

// ── Minimum density check ────────────────────────────────────────────────────

const TIER_SKILLS: Array<{ slug: string; path: string }> = [
  { slug: "learn-map", path: "knowledge/learn-map" },
  { slug: "learn-graph", path: "knowledge/learn-graph" },
  { slug: "learn-onboard", path: "knowledge/learn-onboard" },
  { slug: "learn-diff", path: "knowledge/learn-diff" },
  { slug: "learn-explain", path: "knowledge/learn-explain" },
  { slug: "execute-plan", path: "meta/execute-plan" },
];

describe("eval-fixture density — ≥3 trigger cases per changed skill (VC-12)", () => {
  for (const { slug, path: skillPath } of TIER_SKILLS) {
    test(`${slug}: evals.json is valid JSON`, () => {
      // loadEvals throws if file missing or invalid JSON — that is the assertion
      expect(() => loadEvals(skillPath)).not.toThrow();
    });

    test(`${slug}: should_trigger has ≥3 cases`, () => {
      const ev = loadEvals(skillPath);
      expect(ev.should_trigger.length).toBeGreaterThanOrEqual(3);
    });

    test(`${slug}: should_not_trigger has ≥3 cases`, () => {
      const ev = loadEvals(skillPath);
      expect(ev.should_not_trigger.length).toBeGreaterThanOrEqual(3);
    });

    test(`${slug}: all should_trigger entries are non-empty strings`, () => {
      const ev = loadEvals(skillPath);
      for (const entry of ev.should_trigger) {
        expect(typeof entry).toBe("string");
        expect(entry.trim().length).toBeGreaterThan(0);
      }
    });

    test(`${slug}: all should_not_trigger entries are non-empty strings`, () => {
      const ev = loadEvals(skillPath);
      for (const entry of ev.should_not_trigger) {
        expect(typeof entry).toBe("string");
        expect(entry.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

// ── Tiering / recall / escalate vocabulary coverage ─────────────────────────
// The ADR introduces new trigger vocabulary. Each affected skill must have
// at least one case that exercises the relevant vocabulary.

describe("eval-fixture vocabulary — tiering/recall/escalate cases present (ADR VC-1/VC-5/VC-6)", () => {
  // learn-map: must have a "cheap" / "cheap-scan" / "cheap tier" trigger case
  // and a "powerful" NOT-trigger case (plain init never invokes powerful — VC-1)

  test("learn-map should_trigger includes a cheap-tier / cheap-scan vocabulary case", () => {
    const ev = loadEvals("knowledge/learn-map");
    const hasCheap = anyMatches(
      ev.should_trigger,
      "cheap",
      "cheap-scan",
      "cheap tier"
    );
    expect(hasCheap).toBe(true);
  });

  test("learn-map should_not_trigger includes a powerful-tier guard (plain init never calls powerful)", () => {
    const ev = loadEvals("knowledge/learn-map");
    const hasPowerfulGuard = anyMatches(
      ev.should_not_trigger,
      "powerful",
      "deep knowledge",
      "graph-schema"
    );
    expect(hasPowerfulGuard).toBe(true);
  });

  // learn-graph: must have a "powerful-tier" / "graph-schema" / "escalate" trigger case
  // and a "cheap-scan" NOT-trigger case

  test("learn-graph should_trigger includes a powerful-tier or graph-schema vocabulary case", () => {
    const ev = loadEvals("knowledge/learn-graph");
    const hasPowerful = anyMatches(
      ev.should_trigger,
      "powerful",
      "graph-schema",
      "schema",
      "deep knowledge",
      "deeply"
    );
    expect(hasPowerful).toBe(true);
  });

  test("learn-graph should_not_trigger includes a cheap-scan guard", () => {
    const ev = loadEvals("knowledge/learn-graph");
    const hasCheapGuard = anyMatches(
      ev.should_not_trigger,
      "cheap",
      "cheap-scan",
      "init"
    );
    expect(hasCheapGuard).toBe(true);
  });

  // learn-onboard: settings/config keys must NOT trigger it (they belong to learn-map/learn-graph)

  test("learn-onboard should_not_trigger includes at least one settings-config vocabulary guard", () => {
    const ev = loadEvals("knowledge/learn-onboard");
    const hasSettingsGuard = anyMatches(
      ev.should_not_trigger,
      "settings",
      "models.",
      "recallScore",
      "cacheTTL",
      "config"
    );
    expect(hasSettingsGuard).toBe(true);
  });

  // learn-diff: settings/config NOT-trigger guard (prevents routing config edits here)

  test("learn-diff should_not_trigger includes a settings-config vocabulary guard", () => {
    const ev = loadEvals("knowledge/learn-diff");
    const hasSettingsGuard = anyMatches(
      ev.should_not_trigger,
      "settings",
      "models.",
      "thresholds",
      "recallScore",
      "config"
    );
    expect(hasSettingsGuard).toBe(true);
  });

  // learn-explain: settings/config NOT-trigger guard

  test("learn-explain should_not_trigger includes a settings-config vocabulary guard", () => {
    const ev = loadEvals("knowledge/learn-explain");
    const hasSettingsGuard = anyMatches(
      ev.should_not_trigger,
      "settings",
      "models.",
      "recallScore",
      "cacheTTL",
      "config"
    );
    expect(hasSettingsGuard).toBe(true);
  });

  // execute-plan: must have "dispatch at tier" / "lowest viable tier" trigger case
  // and an "escalate" trigger case (the advisor-escalation dispatch path)

  test("execute-plan should_trigger includes a dispatch-at-tier vocabulary case", () => {
    const ev = loadEvals("meta/execute-plan");
    const hasTierDispatch = anyMatches(
      ev.should_trigger,
      "tier",
      "dispatch",
      "lowest viable",
      "cheap"
    );
    expect(hasTierDispatch).toBe(true);
  });

  test("execute-plan should_trigger includes an escalate / advisor vocabulary case", () => {
    const ev = loadEvals("meta/execute-plan");
    const hasEscalate = anyMatches(
      ev.should_trigger,
      "escalat",
      "advisor",
      "stuck"
    );
    expect(hasEscalate).toBe(true);
  });

  // execute-plan: settings-edit must NOT trigger execute-plan (config edits are not execution)

  test("execute-plan should_not_trigger includes a settings-edit guard (config edit is not execution)", () => {
    const ev = loadEvals("meta/execute-plan");
    const hasSettingsGuard = anyMatches(
      ev.should_not_trigger,
      "settings",
      "models.",
      "tiers",
      "config",
      "edit"
    );
    expect(hasSettingsGuard).toBe(true);
  });
});

// ── No trigger/should_not_trigger overlap ────────────────────────────────────
// A case that appears in both arrays is a definite eval defect.

describe("eval-fixture integrity — no trigger/non-trigger overlap (defect guard)", () => {
  for (const { slug, path: skillPath } of TIER_SKILLS) {
    test(`${slug}: no exact string appears in both should_trigger and should_not_trigger`, () => {
      const ev = loadEvals(skillPath);
      const triggerSet = new Set(ev.should_trigger);
      const overlaps = ev.should_not_trigger.filter((s) => triggerSet.has(s));
      expect(overlaps).toHaveLength(0);
    });
  }
});
