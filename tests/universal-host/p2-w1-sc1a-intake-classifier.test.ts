/**
 * tests/universal-host/p2-w1-sc1a-intake-classifier.test.ts
 *
 * SC-W1-1a (LW1-2) — SMOKE coverage for the deterministic product-loop intake
 * classifier. This is the lane's own minimal self-evidence over the inline smoke
 * set; the authoritative ≥12+/≥12- trigger-accuracy eval with the measured
 * precision ≥0.9 / recall ≥0.8 floor is LW1-8 (eval-engineer).
 *
 * REAL PATH (no seam): drives the SHIPPED `classifyIntake()` directly.
 */
import {
  classifyIntake,
  runIntakeSmoke,
  INTAKE_SMOKE_FIXTURE,
  THRESHOLD,
} from "../../scripts/lib/classify-intake";

describe("classifyIntake — determinism & shape", () => {
  it("is deterministic (same prompt → same result)", () => {
    const p = "I have an idea for an app that tracks plants";
    expect(classifyIntake(p)).toEqual(classifyIntake(p));
  });

  it("fails safe on non-string / empty input", () => {
    expect(classifyIntake("")).toEqual({ intake: "other", score: 0, signals: [] });
    expect(classifyIntake("   ")).toEqual({ intake: "other", score: 0, signals: [] });
    expect(classifyIntake(undefined)).toEqual({ intake: "other", score: 0, signals: [] });
    expect(classifyIntake(42)).toEqual({ intake: "other", score: 0, signals: [] });
  });

  it("returns matched signals with polarity + weight", () => {
    const r = classifyIntake("What if we built a tool that summarizes PDFs?");
    expect(r.intake).toBe("product_loop");
    expect(r.signals.some((s) => s.polarity === "product")).toBe(true);
    expect(r.signals.every((s) => s.weight > 0)).toBe(true);
  });

  it("routes a clear product opener over THRESHOLD and an engineering veto under it", () => {
    expect(classifyIntake("I have an idea for a new app").score).toBeGreaterThanOrEqual(THRESHOLD);
    expect(classifyIntake("Fix the failing build").score).toBeLessThan(THRESHOLD);
  });
});

describe("classifyIntake — inline smoke set (precision-leaning)", () => {
  it.each(INTAKE_SMOKE_FIXTURE)("classifies %j", ({ prompt, expect: want }) => {
    expect(classifyIntake(prompt).intake).toBe(want);
  });

  it("meets the precision ≥0.9 / recall ≥0.8 floor over the smoke set", () => {
    const { precision, recall, mismatches } = runIntakeSmoke();
    expect(mismatches).toEqual([]);
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it("has at least 12 positive and 12 negative cases", () => {
    const pos = INTAKE_SMOKE_FIXTURE.filter((c) => c.expect === "product_loop").length;
    const neg = INTAKE_SMOKE_FIXTURE.filter((c) => c.expect === "other").length;
    expect(pos).toBeGreaterThanOrEqual(12);
    expect(neg).toBeGreaterThanOrEqual(12);
  });
});

// G-lane MUST-FIX regression — these dev prompts must NEVER route to product_loop
// on a single broad opener. Each pairs an ideation opener with an engineering
// target; the opener×specificity gate (and/or a veto) must keep them `other`.
// Canonical AC30 pin — the bare-idea statement is a standalone product trigger and
// MUST route to product_loop even with no product-specificity noun. Guards against
// the gate over-correcting (a green suite that does not pin this is vacuous on it).
describe("classifyIntake — canonical AC30 bare-idea pin", () => {
  const CANONICAL = [
    "I have an idea for X",
    "I have an idea for a budgeting app",
    "I've got an idea for a product",
    "I have an idea",
    "My idea is a recipe-sharing app",
  ];
  it.each(CANONICAL)("routes %j to product_loop", (prompt) => {
    expect(classifyIntake(prompt).intake).toBe("product_loop");
  });

  it("a bare idea with a dev veto still routes to other (veto wins)", () => {
    expect(classifyIntake("I have an idea to refactor the auth module").intake).toBe("other");
  });
});

describe("classifyIntake — over-fire regression (G-lane MUST-FIX)", () => {
  const OVER_FIRE = [
    "What if we built an endpoint that creates invoices?",
    "I want to create a script that migrates users to the new table",
    "Thinking about a small script to rotate old logs",
    "What if we made a hook that validates receipts?",
    "I would like to build a tool for debugging flaky tests",
  ];
  it.each(OVER_FIRE)("routes %j to other (no over-fire)", (prompt) => {
    expect(classifyIntake(prompt).intake).toBe("other");
  });
});
