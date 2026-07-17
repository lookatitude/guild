/**
 * scripts/__tests__/ideation-min-build.test.ts
 *
 * Focused jest tests for the ideation min-build spec resolver.
 * Spec pointer: docs/v2/lifecycle.md §"Phase continuity" / "A min-build spec [v2.x]"
 *
 * Coverage:
 *   1. needsMinBuild — happy paths (wiki absent / present)
 *   2. needsMinBuild — partial-init edge cases (projectYaml present, wiki absent)
 *   3. resolveMinBuildSpec — happy path: all facts supplied → grounded-in stamp
 *   4. resolveMinBuildSpec — contract guarantees: gap always in constraints[]
 *   5. resolveMinBuildSpec — placeholders injected for missing facts
 *   6. resolveMinBuildSpec — resolvedAt forwarded when supplied, absent when not
 *   7. resolveMinBuildSpec — determinism: same input → identical output
 *   8. validateMinBuildSpec — accepts a valid spec
 *   9. validateMinBuildSpec — rejects wrong grounded_in
 *  10. validateMinBuildSpec — rejects empty goal / audience / gap / projectName
 *  11. validateMinBuildSpec — rejects missing / empty constraints
 *  12. validateMinBuildSpec — rejects gap not present in constraints
 *  13. validateMinBuildSpec — rejects non-object inputs (null, string, array)
 *  14. Edge: resolveMinBuildSpec with empty/whitespace-only strings in facts
 *  15. Edge: resolveMinBuildSpec with knownConstraints merges gap notice correctly
 */

import {
  needsMinBuild,
  resolveMinBuildSpec,
  validateMinBuildSpec,
  GROUNDED_IN_INIT_MINIMAL,
  type InitState,
  type ProjectFacts,
  type MinBuildSpec,
  type MinBuildInput,
} from "../lib/ideation-min-build";

// ── needsMinBuild ─────────────────────────────────────────────────────────────

describe("needsMinBuild", () => {
  it("returns true when hasInitWiki is false", () => {
    const state: InitState = { hasInitWiki: false };
    expect(needsMinBuild(state)).toBe(true);
  });

  it("returns false when hasInitWiki is true", () => {
    const state: InitState = { hasInitWiki: true };
    expect(needsMinBuild(state)).toBe(false);
  });

  it("returns true when hasInitWiki is false even if hasGuildYaml is true (partial-init)", () => {
    const state: InitState = { hasInitWiki: false, hasGuildYaml: true };
    expect(needsMinBuild(state)).toBe(true);
  });

  it("returns false when hasInitWiki is true regardless of hasGuildYaml", () => {
    const stateWithYaml: InitState = { hasInitWiki: true, hasGuildYaml: true };
    const stateNoYaml: InitState = { hasInitWiki: true, hasGuildYaml: false };
    expect(needsMinBuild(stateWithYaml)).toBe(false);
    expect(needsMinBuild(stateNoYaml)).toBe(false);
  });
});

// ── resolveMinBuildSpec ───────────────────────────────────────────────────────

describe("resolveMinBuildSpec", () => {
  // 3. Happy path — all facts supplied
  it("stamps grounded_in as 'init_minimal' always", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.grounded_in).toBe(GROUNDED_IN_INIT_MINIMAL);
  });

  it("uses projectFacts.description as the goal when provided", () => {
    const facts: ProjectFacts = { description: "Build a task manager app" };
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts });
    expect(spec.goal).toBe("Build a task manager app");
  });

  it("uses projectFacts.name as projectName when provided", () => {
    const facts: ProjectFacts = { name: "my-project" };
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts });
    expect(spec.projectName).toBe("my-project");
  });

  it("uses projectFacts.primaryLanguage when provided", () => {
    const facts: ProjectFacts = { primaryLanguage: "TypeScript" };
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts });
    expect(spec.primaryLanguage).toBe("TypeScript");
  });

  it("lists owners in audience when provided", () => {
    const facts: ProjectFacts = { owners: ["alice", "bob"] };
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts });
    expect(spec.audience).toContain("alice");
    expect(spec.audience).toContain("bob");
  });

  // 4. Contract guarantee: gap is always present in constraints[]
  it("always includes the gap notice in constraints[]", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.constraints).toContain(spec.gap);
  });

  it("gap is a non-empty string describing the missing-init risk", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(typeof spec.gap).toBe("string");
    expect(spec.gap.length).toBeGreaterThan(0);
    expect(spec.gap.toLowerCase()).toContain("init");
  });

  // 5. Placeholders injected for missing facts
  it("injects a placeholder goal when description is absent", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.goal).toMatch(/PLACEHOLDER/);
  });

  it("injects a placeholder audience when owners are absent", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.audience).toMatch(/PLACEHOLDER/);
  });

  it("injects [unknown-project] as projectName when name is absent", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.projectName).toBe("[unknown-project]");
  });

  it("sets primaryLanguage to empty string when not supplied", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.primaryLanguage).toBe("");
  });

  // 6. resolvedAt forwarding
  it("sets resolvedAt on the spec when caller supplies it", () => {
    const ts = "2026-06-13T12:00:00.000Z";
    const spec = resolveMinBuildSpec({ hasInitWiki: false }, ts);
    expect(spec.resolvedAt).toBe(ts);
  });

  it("does not set resolvedAt when not supplied", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false });
    expect(spec.resolvedAt).toBeUndefined();
  });

  // 7. Determinism
  it("produces identical output for the same inputs (determinism)", () => {
    const input = {
      hasInitWiki: false,
      projectFacts: { name: "demo", description: "A demo project", primaryLanguage: "Go" },
    };
    const a = resolveMinBuildSpec(input, "2026-01-01T00:00:00.000Z");
    const b = resolveMinBuildSpec(input, "2026-01-01T00:00:00.000Z");
    expect(a).toEqual(b);
  });

  // 14. Edge: whitespace-only strings in facts treated as absent
  it("treats whitespace-only description as absent and uses placeholder", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: { description: "   " } });
    expect(spec.goal).toMatch(/PLACEHOLDER/);
  });

  it("treats whitespace-only name as absent and uses [unknown-project]", () => {
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: { name: "\t\n" } });
    expect(spec.projectName).toBe("[unknown-project]");
  });

  // 15. knownConstraints are merged with the gap notice
  it("merges knownConstraints with the gap notice in constraints[]", () => {
    const facts: ProjectFacts = { knownConstraints: ["Must run on Linux", "No external deps"] };
    const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts });
    expect(spec.constraints).toContain("Must run on Linux");
    expect(spec.constraints).toContain("No external deps");
    expect(spec.constraints).toContain(spec.gap);
    expect(spec.constraints.length).toBe(3); // 2 known + 1 gap
  });

  it("does not mutate the input knownConstraints array", () => {
    const knownConstraints = ["Constraint A"];
    resolveMinBuildSpec({ hasInitWiki: false, projectFacts: { knownConstraints } });
    expect(knownConstraints).toHaveLength(1); // original array unchanged
  });
});

// ── validateMinBuildSpec ──────────────────────────────────────────────────────

describe("validateMinBuildSpec", () => {
  /** Build a valid MinBuildSpec for use in mutation tests. */
  function validSpec(): MinBuildSpec {
    return resolveMinBuildSpec(
      { hasInitWiki: false, projectFacts: { name: "test-project", description: "A test" } },
      "2026-01-01T00:00:00.000Z",
    );
  }

  // 8. Accepts a valid spec
  it("returns valid=true for a correctly formed spec", () => {
    const result = validateMinBuildSpec(validSpec());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // 9. Rejects wrong grounded_in
  it("rejects a spec with wrong grounded_in value", () => {
    const spec = { ...validSpec(), grounded_in: "real_wiki" };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("grounded_in"))).toBe(true);
  });

  // 10. Rejects empty required string fields
  it("rejects a spec with an empty goal", () => {
    const spec = { ...validSpec(), goal: "" };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("goal"))).toBe(true);
  });

  it("rejects a spec with an empty audience", () => {
    const spec = { ...validSpec(), audience: "" };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("audience"))).toBe(true);
  });

  it("rejects a spec with an empty gap", () => {
    const spec = { ...validSpec(), gap: "" };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("gap"))).toBe(true);
  });

  it("rejects a spec with an empty projectName", () => {
    const spec = { ...validSpec(), projectName: "" };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("projectName"))).toBe(true);
  });

  // 11. Rejects empty constraints
  it("rejects a spec with an empty constraints array", () => {
    const spec = { ...validSpec(), constraints: [] };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("constraints"))).toBe(true);
  });

  it("rejects a spec with constraints that is not an array", () => {
    const spec = { ...validSpec(), constraints: "not-an-array" as unknown as string[] };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("constraints"))).toBe(true);
  });

  // 12. Rejects gap not present in constraints
  it("rejects when gap is not in constraints[]", () => {
    const base = validSpec();
    const spec = {
      ...base,
      constraints: ["some-constraint"], // gap notice NOT included
      gap: base.gap,
    };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("gap"))).toBe(true);
  });

  // 13. Rejects non-object inputs
  it("rejects null input", () => {
    const result = validateMinBuildSpec(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a string input", () => {
    const result = validateMinBuildSpec("not-an-object");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an array input", () => {
    const result = validateMinBuildSpec([]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Multiple errors can accumulate
  it("accumulates multiple errors when several fields are invalid", () => {
    const spec = {
      grounded_in: "wrong",
      goal: "",
      audience: "",
      constraints: [],
      gap: "",
      projectName: "",
    };
    const result = validateMinBuildSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

// ── Integration: resolveMinBuildSpec → validateMinBuildSpec ──────────────────

describe("resolveMinBuildSpec output always passes validateMinBuildSpec", () => {
  const cases: Array<[string, MinBuildInput]> = [
    ["no facts at all", { hasInitWiki: false }],
    ["only name", { hasInitWiki: false, projectFacts: { name: "proj" } }],
    ["only description", { hasInitWiki: false, projectFacts: { description: "A thing" } }],
    ["all facts", {
      hasInitWiki: false,
      projectFacts: {
        name: "full-project",
        description: "Full spec",
        primaryLanguage: "Rust",
        owners: ["charlie"],
        knownConstraints: ["Linux only"],
      },
    }],
    ["empty projectFacts object", { hasInitWiki: false, projectFacts: {} }],
  ];

  for (const [label, input] of cases) {
    it(`validates correctly for: ${label}`, () => {
      const spec = resolveMinBuildSpec(input, "2026-01-01T00:00:00.000Z");
      const result = validateMinBuildSpec(spec);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  }
});
