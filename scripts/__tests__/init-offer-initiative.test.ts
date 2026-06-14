/**
 * scripts/__tests__/init-offer-initiative.test.ts
 *
 * Opt-in "create an initiative?" final step of init (deferred item 4).
 * Canonical contract: docs/v2/06-initiatives.md §Init's role + §Opt-in posture.
 *
 * Coverage:
 *   - shouldOfferInitiative: happy-path offer conditions (brownfield + signals).
 *   - shouldOfferInitiative: never offers when an initiative already exists.
 *   - shouldOfferInitiative: never offers for pure greenfield + no signals.
 *   - shouldOfferInitiative: offers for brownfield even with no signals.
 *   - shouldOfferInitiative: offers for greenfield with at least one signal.
 *   - buildInitiativeOffer: happy path — fields present, id/title/scope derived.
 *   - buildInitiativeOffer: cross-repo/cross-team signal → workspace scope.
 *   - buildInitiativeOffer: brownfield-only (no signals) → graceful defaults.
 *   - buildInitiativeOffer: dominant signal priority — explicit_duration beats ongoing.
 *   - buildInitiativeOffer: accept_prompt contains the suggested title.
 *   - validateOfferContext + validateInitOfferState: valid and invalid inputs.
 *   - Edge/malformed: unknown signal in array, empty projectSlug, non-object input.
 *   - Pure + deterministic: identical inputs yield identical outputs.
 */

import {
  shouldOfferInitiative,
  buildInitiativeOffer,
  validateOfferContext,
  validateInitOfferState,
  TASK_COMPLEXITY_SIGNALS,
  type OfferContext,
  type InitOfferState,
} from "../lib/init-offer-initiative";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseContext(overrides: Partial<OfferContext> = {}): OfferContext {
  return {
    isBrownfield: false,
    hasExistingInitiative: false,
    taskComplexitySignals: [],
    ...overrides,
  };
}

function baseState(overrides: Partial<InitOfferState> = {}): InitOfferState {
  return {
    projectSlug: "my-api",
    projectDisplayName: "My API",
    taskComplexitySignals: [],
    isBrownfield: false,
    ...overrides,
  };
}

// ── TASK_COMPLEXITY_SIGNALS closed enum ───────────────────────────────────────

test("TASK_COMPLEXITY_SIGNALS is the closed set specified in the contract", () => {
  expect([...TASK_COMPLEXITY_SIGNALS]).toEqual([
    "ongoing",
    "multi_phase",
    "multi_sprint",
    "rollout",
    "milestone",
    "cross_team",
    "cross_repo",
    "initiative_keyword",
    "explicit_duration",
  ]);
});

// ── shouldOfferInitiative ─────────────────────────────────────────────────────

describe("shouldOfferInitiative", () => {
  test("happy path: brownfield + durable signal → true", () => {
    expect(
      shouldOfferInitiative(baseContext({ isBrownfield: true, taskComplexitySignals: ["ongoing"] }))
    ).toBe(true);
  });

  test("never offers when an initiative already exists", () => {
    expect(
      shouldOfferInitiative(
        baseContext({ isBrownfield: true, hasExistingInitiative: true, taskComplexitySignals: ["ongoing"] })
      )
    ).toBe(false);
    expect(
      shouldOfferInitiative(baseContext({ hasExistingInitiative: true, taskComplexitySignals: ["milestone"] }))
    ).toBe(false);
  });

  test("never offers for pure greenfield with no signals (zero-cost-one-off invariant)", () => {
    expect(shouldOfferInitiative(baseContext())).toBe(false);
  });

  test("offers for brownfield even with no signals", () => {
    expect(
      shouldOfferInitiative(baseContext({ isBrownfield: true }))
    ).toBe(true);
  });

  test("offers for greenfield when at least one signal is present", () => {
    expect(
      shouldOfferInitiative(baseContext({ taskComplexitySignals: ["rollout"] }))
    ).toBe(true);
  });

  test("every signal type individually triggers an offer (greenfield)", () => {
    for (const signal of TASK_COMPLEXITY_SIGNALS) {
      const result = shouldOfferInitiative(baseContext({ taskComplexitySignals: [signal] }));
      if (!result) throw new Error(`signal '${signal}' should trigger offer but got false`);
    }
  });
});

// ── buildInitiativeOffer ──────────────────────────────────────────────────────

describe("buildInitiativeOffer", () => {
  test("happy path: returns all required fields", () => {
    const payload = buildInitiativeOffer(
      baseState({ isBrownfield: true, taskComplexitySignals: ["milestone"] })
    );
    expect(typeof payload.suggested_id).toBe("string");
    expect(payload.suggested_id.length).toBeGreaterThan(0);
    expect(typeof payload.suggested_title).toBe("string");
    expect(payload.suggested_title.length).toBeGreaterThan(0);
    expect(["project", "workspace"]).toContain(payload.suggested_scope);
    expect(typeof payload.rationale).toBe("string");
    expect(payload.rationale.length).toBeGreaterThan(0);
    expect(typeof payload.accept_prompt).toBe("string");
    expect(payload.accept_prompt.length).toBeGreaterThan(0);
  });

  test("cross-repo signal → workspace scope", () => {
    const payload = buildInitiativeOffer(
      baseState({ taskComplexitySignals: ["cross_repo"] })
    );
    expect(payload.suggested_scope).toBe("workspace");
  });

  test("cross-team signal → workspace scope", () => {
    const payload = buildInitiativeOffer(
      baseState({ taskComplexitySignals: ["cross_team"] })
    );
    expect(payload.suggested_scope).toBe("workspace");
  });

  test("non-cross signals → project scope", () => {
    const payload = buildInitiativeOffer(
      baseState({ taskComplexitySignals: ["ongoing", "milestone"] })
    );
    expect(payload.suggested_scope).toBe("project");
  });

  test("brownfield-only (no signals) → graceful defaults, project scope", () => {
    const payload = buildInitiativeOffer(baseState({ isBrownfield: true }));
    expect(payload.suggested_scope).toBe("project");
    expect(payload.suggested_id).toContain("my-api");
    expect(payload.suggested_title).toContain("My API");
    expect(payload.rationale).toMatch(/already has content|durable goals/i);
  });

  test("no signals, not brownfield → minimal valid payload (slug as id)", () => {
    const payload = buildInitiativeOffer(baseState());
    expect(payload.suggested_id).toBe("my-api");
    expect(payload.suggested_scope).toBe("project");
  });

  test("dominant signal priority: explicit_duration beats ongoing", () => {
    const payload = buildInitiativeOffer(
      baseState({ taskComplexitySignals: ["ongoing", "explicit_duration"] })
    );
    expect(payload.suggested_id).toContain("explicit-duration");
    expect(payload.suggested_title).toContain("time-boxed delivery");
  });

  test("dominant signal priority: initiative_keyword beats multi_sprint", () => {
    const payload = buildInitiativeOffer(
      baseState({ taskComplexitySignals: ["multi_sprint", "initiative_keyword"] })
    );
    expect(payload.suggested_id).toContain("initiative-keyword");
  });

  test("accept_prompt contains the suggested title in quotes", () => {
    const payload = buildInitiativeOffer(
      baseState({ taskComplexitySignals: ["rollout"] })
    );
    expect(payload.accept_prompt).toContain(`'${payload.suggested_title}'`);
    expect(payload.accept_prompt).toMatch(/\[y\/N\]/);
  });

  test("suggested_id is derived from projectSlug (slug-safe composition)", () => {
    const payload = buildInitiativeOffer(
      baseState({ projectSlug: "web-app", projectDisplayName: "Web App", taskComplexitySignals: ["multi_phase"] })
    );
    expect(payload.suggested_id).toMatch(/^web-app/);
    expect(payload.suggested_id).not.toMatch(/[A-Z _]/); // slug-safe
  });

  test("pure + deterministic: identical inputs yield identical outputs", () => {
    const state = baseState({ isBrownfield: true, taskComplexitySignals: ["rollout", "cross_repo"] });
    expect(buildInitiativeOffer(state)).toEqual(buildInitiativeOffer(state));
  });
});

// ── validateOfferContext ──────────────────────────────────────────────────────

describe("validateOfferContext", () => {
  test("accepts a well-formed context", () => {
    expect(
      validateOfferContext({
        isBrownfield: true,
        hasExistingInitiative: false,
        taskComplexitySignals: ["ongoing", "rollout"],
      })
    ).toEqual({ valid: true, errors: [] });
  });

  test("accepts an empty signals array", () => {
    expect(
      validateOfferContext({ isBrownfield: false, hasExistingInitiative: false, taskComplexitySignals: [] })
    ).toEqual({ valid: true, errors: [] });
  });

  test("rejects non-object input", () => {
    expect(validateOfferContext(null).valid).toBe(false);
    expect(validateOfferContext("string").valid).toBe(false);
    expect(validateOfferContext(42).valid).toBe(false);
  });

  test("rejects non-boolean isBrownfield / hasExistingInitiative", () => {
    const { errors } = validateOfferContext({
      isBrownfield: "yes",
      hasExistingInitiative: 1,
      taskComplexitySignals: [],
    });
    expect(errors.join(" ")).toMatch(/isBrownfield/);
    expect(errors.join(" ")).toMatch(/hasExistingInitiative/);
  });

  test("rejects non-array taskComplexitySignals", () => {
    const r = validateOfferContext({
      isBrownfield: false,
      hasExistingInitiative: false,
      taskComplexitySignals: "ongoing",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/taskComplexitySignals/);
  });

  test("rejects unknown signal values in array", () => {
    const r = validateOfferContext({
      isBrownfield: false,
      hasExistingInitiative: false,
      taskComplexitySignals: ["ongoing", "bogus_signal"],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/bogus_signal/);
  });
});

// ── validateInitOfferState ────────────────────────────────────────────────────

describe("validateInitOfferState", () => {
  test("accepts a well-formed state", () => {
    expect(
      validateInitOfferState({
        projectSlug: "my-api",
        projectDisplayName: "My API",
        taskComplexitySignals: ["milestone"],
        isBrownfield: true,
      })
    ).toEqual({ valid: true, errors: [] });
  });

  test("rejects empty projectSlug", () => {
    const r = validateInitOfferState({
      projectSlug: "",
      projectDisplayName: "My API",
      taskComplexitySignals: [],
      isBrownfield: false,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/projectSlug/);
  });

  test("rejects empty projectDisplayName", () => {
    const r = validateInitOfferState({
      projectSlug: "slug",
      projectDisplayName: "",
      taskComplexitySignals: [],
      isBrownfield: false,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/projectDisplayName/);
  });

  test("rejects non-object input", () => {
    expect(validateInitOfferState(undefined).valid).toBe(false);
    expect(validateInitOfferState(42).valid).toBe(false);
  });

  test("rejects unknown signal in taskComplexitySignals", () => {
    const r = validateInitOfferState({
      projectSlug: "slug",
      projectDisplayName: "Slug",
      taskComplexitySignals: ["not_a_real_signal"],
      isBrownfield: false,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/not_a_real_signal/);
  });

  test("rejects non-array taskComplexitySignals", () => {
    const r = validateInitOfferState({
      projectSlug: "slug",
      projectDisplayName: "Slug",
      taskComplexitySignals: null,
      isBrownfield: false,
    });
    expect(r.valid).toBe(false);
  });
});

// ── Edge / malformed cases ────────────────────────────────────────────────────

describe("edge and malformed cases", () => {
  test("shouldOfferInitiative handles all-signals brownfield without existing initiative", () => {
    const all = [...TASK_COMPLEXITY_SIGNALS];
    expect(
      shouldOfferInitiative({ isBrownfield: true, hasExistingInitiative: false, taskComplexitySignals: all })
    ).toBe(true);
  });

  test("shouldOfferInitiative: hasExistingInitiative blocks even with all signals + brownfield", () => {
    const all = [...TASK_COMPLEXITY_SIGNALS];
    expect(
      shouldOfferInitiative({ isBrownfield: true, hasExistingInitiative: true, taskComplexitySignals: all })
    ).toBe(false);
  });

  test("buildInitiativeOffer: projectSlug with numbers + hyphens stays safe in id", () => {
    const payload = buildInitiativeOffer(
      baseState({ projectSlug: "proj-v2-api", projectDisplayName: "Proj v2 API", taskComplexitySignals: ["ongoing"] })
    );
    expect(payload.suggested_id).toMatch(/^proj-v2-api/);
  });

  test("buildInitiativeOffer: single cross-repo signal still yields workspace scope", () => {
    expect(
      buildInitiativeOffer(baseState({ taskComplexitySignals: ["cross_repo"] })).suggested_scope
    ).toBe("workspace");
  });
});
