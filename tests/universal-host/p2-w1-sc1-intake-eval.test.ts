/**
 * tests/universal-host/p2-w1-sc1-intake-eval.test.ts
 *
 * SC-W1-1 (AC30) — the AUTHORITATIVE trigger-accuracy eval for the deterministic
 * product-loop intake classifier (LW1-8 deliverable; the sc1a file is the lane's own
 * smoke). Two halves:
 *   (a) a ≥12-positive / ≥12-negative fixture measuring precision ≥0.9 / recall ≥0.8 over
 *       the SHIPPED `classifyIntake()` (no seam, real path), INCLUDING the lead's
 *       recall-tuning disposition phrasings (prototype-the-concept / explore-whether-
 *       feasible / bare "I want to build X" / "What if we added X"); and
 *   (b) the SC-W1-1b end-to-end routing decision: a vague product prompt routes to
 *       product-loop intake, a normal build/review prompt does not — exercised through
 *       the SAME deterministic decision function the no-slash `using-guild` entry consumes
 *       (the `intake` field, never the raw score).
 *
 * Falsifiable: if the classifier regresses (a disposition positive drops, or a dev prompt
 * over-fires), the precision/recall floor AND the per-case pins fail.
 */
import {
  classifyIntake,
  intakeRouteTarget,
  PRODUCT_LOOP_ENTRY_SKILL,
  type Intake,
} from "../../scripts/lib/classify-intake";

interface Case {
  prompt: string;
  expect: Intake;
}

// ── ≥12 POSITIVES (must route to product_loop) ──────────────────────────────
// Includes the lead recall-tuning disposition: discovery phrasings, bare "I want to
// build X", and "What if we added X".
const POSITIVES: Case[] = [
  { prompt: "I have an idea for an app that helps people track their houseplants", expect: "product_loop" },
  { prompt: "What if we built a tool that summarizes long PDFs?", expect: "product_loop" },
  { prompt: "I want to make a tool that turns voice notes into to-do lists", expect: "product_loop" },
  { prompt: "I wish there was an app that reminded me to call my parents", expect: "product_loop" },
  { prompt: "Got a startup idea: a marketplace for local farmers", expect: "product_loop" },
  { prompt: "Wouldn't it be cool if we had a service that auto-tags photos?", expect: "product_loop" },
  { prompt: "I want to build a product that helps freelancers manage their invoices", expect: "product_loop" },
  { prompt: "Wouldn't it be great to have a platform connecting tutors and students?", expect: "product_loop" },
  // ↓ disposition: discovery phrasings
  { prompt: "Let's prototype the concept for a neighborhood tool-sharing app", expect: "product_loop" },
  { prompt: "I'd like to explore whether a meal-planning app for busy parents is feasible", expect: "product_loop" },
  // ↓ disposition: bare "I want to build X" (no product-domain noun)
  { prompt: "I want to build a habit tracker", expect: "product_loop" },
  { prompt: "I want to build something for runners", expect: "product_loop" },
  // ↓ disposition: "What if we added X"
  { prompt: "What if we added a marketplace where neighbors can rent tools?", expect: "product_loop" },
  { prompt: "What if we added gamified streaks for our language-learning app?", expect: "product_loop" },
  // canonical AC30 bare-idea
  { prompt: "I have an idea for X", expect: "product_loop" },
];

// ── ≥12 NEGATIVES (must route to other) ─────────────────────────────────────
// Includes the five G-lane over-fire prompts that MUST stay `other` (precision floor).
const NEGATIVES: Case[] = [
  { prompt: "Fix the bug where the login button does nothing on mobile", expect: "other" },
  { prompt: "Plan this feature: add SSO to the admin dashboard", expect: "other" },
  { prompt: "Review this PR and tell me if the migration is safe", expect: "other" },
  { prompt: "Refactor the payment module to use the new client", expect: "other" },
  { prompt: "The test suite is failing after the upgrade, diagnose it", expect: "other" },
  { prompt: "Add an endpoint to export users as CSV", expect: "other" },
  // ↓ the five G-lane over-fire prompts (precision floor)
  { prompt: "What if we built an endpoint that creates invoices?", expect: "other" },
  { prompt: "I want to create a script that migrates users to the new table", expect: "other" },
  { prompt: "Thinking about a small script to rotate old logs", expect: "other" },
  { prompt: "What if we made a hook that validates receipts?", expect: "other" },
  { prompt: "I would like to build a tool for debugging flaky tests", expect: "other" },
  // ↓ added-opener must NOT over-fire on an engineering target
  { prompt: "What if we added an endpoint that creates invoices?", expect: "other" },
  { prompt: "Refactor the CLI so the cron daemon reads its config from disk", expect: "other" },
  // ── SCOPE BOUNDARY (FIX 4): host / infra / config / ops prompts are OUT OF SCOPE for
  // product-loop intake. The product loop is for product IDEAS (something a user/market
  // wants), NOT for registering hosts, provisioning build machines, or config/ops. These
  // MUST stay `other`; a SEPARATE universal-host intake path owns host/config/ops routing.
  { prompt: "add a new build server", expect: "other" },
  { prompt: "register the mac mini as a guild host", expect: "other" },
  { prompt: "self-hosted build machine for Guild jobs", expect: "other" },
];

const FIXTURE = [...POSITIVES, ...NEGATIVES];

describe("SC-W1-1 — authoritative trigger-accuracy eval", () => {
  it("fixture has ≥12 positives and ≥12 negatives", () => {
    expect(POSITIVES.length).toBeGreaterThanOrEqual(12);
    expect(NEGATIVES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(FIXTURE)("classifies %j", ({ prompt, expect: want }) => {
    expect(classifyIntake(prompt).intake).toBe(want);
  });

  it("meets the precision ≥0.9 / recall ≥0.8 floor", () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const mismatches: { prompt: string; expect: Intake; got: Intake }[] = [];
    for (const c of FIXTURE) {
      const got = classifyIntake(c.prompt).intake;
      if (got !== c.expect) mismatches.push({ prompt: c.prompt, expect: c.expect, got });
      if (got === "product_loop" && c.expect === "product_loop") tp++;
      else if (got === "product_loop" && c.expect === "other") fp++;
      else if (got === "other" && c.expect === "product_loop") fn++;
    }
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    // Surface any mismatch in the failure message for fast diagnosis.
    expect({ precision, recall, mismatches }).toEqual({
      precision: expect.any(Number),
      recall: expect.any(Number),
      mismatches: [],
    });
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it("the five G-lane over-fire prompts NEVER route to product_loop (precision pin)", () => {
    const overfire = [
      "What if we built an endpoint that creates invoices?",
      "I want to create a script that migrates users to the new table",
      "Thinking about a small script to rotate old logs",
      "What if we made a hook that validates receipts?",
      "I would like to build a tool for debugging flaky tests",
    ];
    for (const p of overfire) expect(classifyIntake(p).intake).toBe("other");
  });
});

// ── SC-W1-1b — end-to-end routing decision (the SHIPPED no-slash decision helper) ──
//
// FIX 1 (codex anti-vacuity): exercise the SHIPPED `intakeRouteTarget()` from the
// classify-intake module — the one-branch decision the no-slash `using-guild` wiring
// consumes (product_loop ⇒ hand off to guild:product-explore; else null = normal
// lifecycle). NO test-local re-implementation of the route decision.
describe("SC-W1-1b — no-slash routing decision (shipped intakeRouteTarget)", () => {
  it("a vague product prompt routes to the product-loop entry skill", () => {
    const r = intakeRouteTarget("I have an idea for an app that helps neighbors share tools");
    expect(r.intake).toBe("product_loop");
    expect(r.next_skill).toBe(PRODUCT_LOOP_ENTRY_SKILL);
    expect(intakeRouteTarget("Let's prototype the concept for a budgeting app").next_skill).toBe(
      PRODUCT_LOOP_ENTRY_SKILL
    );
  });

  it("a normal build/review prompt has next_skill null (no product-loop handoff)", () => {
    for (const p of [
      "Plan this feature: add SSO to the admin dashboard",
      "Review this PR and tell me if the migration is safe",
      "Fix the failing build",
    ]) {
      const r = intakeRouteTarget(p);
      expect(r.intake).toBe("other");
      expect(r.next_skill).toBeNull();
    }
  });

  it("routes on the verdict, not the raw score (a dev prompt with openers still routes normal)", () => {
    const r = intakeRouteTarget("What if we built an endpoint that creates invoices?");
    expect(r.intake).toBe("other");
    expect(r.next_skill).toBeNull();
  });

  it("SCOPE BOUNDARY (FIX 4): host/infra/ops prompts get next_skill null (a separate path owns them)", () => {
    for (const p of [
      "add a new build server",
      "register the mac mini as a guild host",
      "self-hosted build machine for Guild jobs",
    ]) {
      expect(intakeRouteTarget(p).next_skill).toBeNull();
    }
  });
});
