/**
 * t09-intake-six-way.test.ts — U-LOOP intake fixtures (KTD41 / R55 / R58 / R69).
 *
 * The named "Done when" clauses this file pins:
 *   - a "fix this crash" prompt binds `debug`
 *   - bare /guild with an idea prompt binds `product` WITHOUT requiring a verb
 *   - a typed verb outranks the classifier
 *   - low confidence asks the operator instead of guessing
 */

import {
  CLASS_THRESHOLD,
  TYPED_VERB_CLASS,
  WORK_CLASSES,
  bindWorkClass,
  classifyWorkClass,
} from "../../src/modules/intake/workflows/work-class";
import { classifyIntake } from "../../src/modules/intake/workflows/classify-intake";

describe("six-way intake classification", () => {
  it('binds debug for "fix this crash"', () => {
    const r = classifyWorkClass("fix this crash in the payment worker");
    expect(r.class).toBe("debug");
    expect(r.scores.debug).toBeGreaterThanOrEqual(CLASS_THRESHOLD);
  });

  it("binds debug for a root-cause prompt with no product opener", () => {
    expect(classifyWorkClass("root cause why the nightly job keeps failing").class).toBe("debug");
  });

  it("binds product for a bare idea prompt, with no verb typed", () => {
    const binding = bindWorkClass({ prompt: "I have an idea for an app that tracks plants" });
    expect(binding.class).toBe("product");
    expect(binding.bound_from).toBe("intake");
    expect(binding.needs_operator).toBe(false);
  });

  it("binds research for a find-out / compare prompt", () => {
    expect(classifyWorkClass("find out what the docs say about retry semantics").class).toBe("research");
    expect(classifyWorkClass("compare the options for the queue backend").class).toBe("research");
  });

  it("binds ops for a deploy / incident prompt", () => {
    expect(classifyWorkClass("roll back the production deploy").class).toBe("ops");
    expect(classifyWorkClass("write the incident postmortem for last night").class).toBe("ops");
  });

  it("binds init for an onboarding prompt", () => {
    expect(classifyWorkClass("set up guild on this existing codebase").class).toBe("init");
  });

  it("answers `other` on a prompt with no class signal, so T0 asks", () => {
    const binding = bindWorkClass({ prompt: "hi" });
    expect(binding.class).toBe("other");
    expect(binding.needs_operator).toBe(true);
  });

  it("never invents a sixth class", () => {
    for (const prompt of [
      "fix this crash",
      "I have an idea for an app",
      "compare the options",
      "roll back the deploy",
      "onboard this repo",
      "",
    ]) {
      const c = classifyWorkClass(prompt).class;
      expect(c === "other" || (WORK_CLASSES as readonly string[]).includes(c)).toBe(true);
    }
  });

  it("does not re-derive the product rule — it delegates to the shipped classifier", () => {
    const prompt = "I have an idea for a marketplace for neighbours";
    expect(classifyIntake(prompt).intake).toBe("product_loop");
    expect(classifyWorkClass(prompt).signals.some((s) => s.id === "product-loop-intake")).toBe(true);
  });
});

describe("class binding order (KTD41)", () => {
  it("a typed verb outranks the classifier", () => {
    const binding = bindWorkClass({
      typedVerb: "ops",
      prompt: "I have an idea for an app that tracks plants",
    });
    expect(binding.class).toBe("ops");
    expect(binding.bound_from).toBe("typed_verb");
  });

  it("`research` and `debug` are sub-verbs that bind a class (KTD69)", () => {
    expect(TYPED_VERB_CLASS["research"]).toBe("research");
    expect(TYPED_VERB_CLASS["debug"]).toBe("debug");
    expect(bindWorkClass({ typedVerb: "research" }).class).toBe("research");
  });

  it("--class= outranks the classifier but not a typed verb", () => {
    expect(bindWorkClass({ classFlag: "init", prompt: "fix this crash" }).class).toBe("init");
    expect(bindWorkClass({ typedVerb: "ops", classFlag: "init" }).class).toBe("ops");
  });

  it("an unrecognised verb or flag asks the operator rather than guessing past a typo", () => {
    expect(bindWorkClass({ typedVerb: "opps" }).needs_operator).toBe(true);
    expect(bindWorkClass({ classFlag: "prodcut" }).needs_operator).toBe(true);
  });
});
