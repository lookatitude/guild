/**
 * scripts/__tests__/resolver-mode.test.ts
 *
 * D4 — the five resolver operating modes.
 *
 * The rows that matter are the ones that keep the ladder HONEST rather than
 * merely green:
 *   - every non-resolution is a TYPED failure, never a silent fallback (the
 *     anti-vacuity row proves an unresolvable capability really does fail);
 *   - `observe` cannot serve a write, so D03's "zero live writes" advance
 *     condition is provable by construction;
 *   - `project-local` REFUSES a live dispatch that has no project definition
 *     rather than reading a shipped template, which is the whole point of the mode;
 *   - `strict` has no compatibility surface at all;
 *   - the G5 counting rule is asymmetric in exactly the way S8 requires — benign
 *     mint/shadow reads must NOT count, or the removal gate can never reach zero.
 */

import {
  CAPABILITY_RESOLUTION_INTENTS,
  MODE_TRANSITION_DIRECTIONS,
  RESOLVER_AUTHORITIES,
  RESOLVER_MODE_FAILURES,
  RESOLVER_MODE_OUTCOME_SCHEMA,
  RESOLVER_MODE_POLICIES,
  classifyCompatibilityRead,
  isResolverModeFailure,
  planModeTransition,
  resolveCapability,
  resolverModePolicy,
  resolverModeRank,
  type CapabilityResolutionIntent,
} from "../lib/capability/resolver-mode";
import {
  CAPABILITY_RESOLVER_MODES,
  CAPABILITY_RESOLVER_MODE_AFTER_F7,
  CAPABILITY_RESOLVER_MODE_DEFAULT,
  type CapabilityResolverMode,
} from "../../src/modules/config";

const AGENT_LOCAL = ".guild/agents/qa.md";
const TEMPLATE = "templates/specialists/qa.md";

/**
 * The classification union is discriminated by a STRING `status`, precisely so it
 * narrows under the repo's non-strict ts-jest transform. This flat view is used
 * anyway so a single helper can read both arms in a table-driven row without a
 * narrowing branch per case. The runtime shape is unchanged.
 */
interface FlatClassification {
  status: string;
  reason?: string;
  counts_as_dependence?: boolean;
  failure?: string;
  detail?: string;
}

const classify = (mode: unknown, intent: unknown): FlatClassification =>
  classifyCompatibilityRead({ mode, intent }) as unknown as FlatClassification;

function req(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "legacy",
    kind: "agent",
    capability_id: "qa",
    project_definition: null,
    compatibility_asset: TEMPLATE,
    intent: "dispatch",
    ...over,
  };
}

describe("D4 — the ladder is complete, ordered, and frozen", () => {
  it("has a policy for every mode and no others", () => {
    expect(Object.keys(RESOLVER_MODE_POLICIES).sort()).toEqual([...CAPABILITY_RESOLVER_MODES].sort());
    for (const mode of CAPABILITY_RESOLVER_MODES) {
      expect(resolverModePolicy(mode)!.mode).toBe(mode);
    }
  });

  it("ranks by the ladder order, and an unknown mode ranks -1", () => {
    expect(resolverModeRank("legacy")).toBe(0);
    expect(resolverModeRank("strict")).toBe(CAPABILITY_RESOLVER_MODES.length - 1);
    expect(resolverModeRank("legacy")).toBeLessThan(resolverModeRank("project-local"));
    expect(resolverModeRank("aggressive")).toBe(-1);
    expect(resolverModeRank(undefined)).toBe(-1);
  });

  it("freezes every exported vocabulary at runtime, not just at compile time", () => {
    // `as const` is erased; a mutable exported array would let a consumer add a
    // failure code or a mode and change what downstream code accepts.
    for (const frozen of [
      RESOLVER_MODE_FAILURES,
      RESOLVER_AUTHORITIES,
      CAPABILITY_RESOLUTION_INTENTS,
      MODE_TRANSITION_DIRECTIONS,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(() => {
        (frozen as unknown as string[]).push("smuggled");
      }).toThrow();
    }
    expect(Object.isFrozen(RESOLVER_MODE_POLICIES)).toBe(true);
    for (const mode of CAPABILITY_RESOLVER_MODES) {
      expect(Object.isFrozen(RESOLVER_MODE_POLICIES[mode])).toBe(true);
      expect(Object.isFrozen(RESOLVER_MODE_POLICIES[mode].compatibility_intents)).toBe(true);
    }
  });

  it("mutating the exported policy record cannot change a verdict", () => {
    const before = resolveCapability(req({ mode: "strict" }));
    try {
      (RESOLVER_MODE_POLICIES as unknown as Record<string, unknown>)["strict"] = {
        ...RESOLVER_MODE_POLICIES["strict"],
        compatibility_available: true,
      };
    } catch {
      /* frozen — the assignment throwing is itself the guarantee */
    }
    expect(resolveCapability(req({ mode: "strict" }))).toEqual(before);
  });

  it("does not decide the shipped default — that stays in config-defaults", () => {
    expect(CAPABILITY_RESOLVER_MODE_DEFAULT).toBe("legacy");
    expect(CAPABILITY_RESOLVER_MODE_AFTER_F7).toBe("observe");
  });
});

describe("D4 — the mode policy matrix", () => {
  const rows: Array<[CapabilityResolverMode, string, boolean]> = [
    ["legacy", "project_resolver_runs", false],
    ["observe", "project_resolver_runs", true],
    ["observe", "capability_writes_permitted", false],
    ["shadow", "capability_writes_permitted", true],
    ["shadow", "project_side_effects_permitted", false],
    ["shadow", "local_creation_permitted", true],
    ["project-local", "project_side_effects_permitted", true],
    ["strict", "compatibility_available", false],
  ];
  it.each(rows)("%s.%s === %s", (mode, field, expected) => {
    expect((resolverModePolicy(mode) as unknown as Record<string, boolean>)[field]).toBe(expected);
  });

  it("authority moves from legacy to project-local exactly once, at project-local", () => {
    expect(CAPABILITY_RESOLVER_MODES.map((m) => resolverModePolicy(m)!.authority)).toEqual([
      "legacy",
      "legacy",
      "legacy",
      "project-local",
      "project-local",
    ]);
  });
});

describe("D4 — resolution never falls back silently", () => {
  it("resolves the project definition when the project resolver runs", () => {
    const out = resolveCapability(req({ mode: "project-local", project_definition: AGENT_LOCAL }));
    expect(out.status).toBe("resolved");
    if (out.status !== "resolved") throw new Error("unreachable");
    expect(out.source).toBe("project");
    expect(out.path).toBe(AGENT_LOCAL);
    expect(out.side_effects_permitted).toBe(true);
    expect(out.compatibility_read).toBeNull();
    expect(out.schema_version).toBe(RESOLVER_MODE_OUTCOME_SCHEMA);
  });

  it("shadow resolves the project answer but FORBIDS the project side effect", () => {
    const out = resolveCapability(req({ mode: "shadow", project_definition: AGENT_LOCAL }));
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.source).toBe("project");
    expect(out.authority).toBe("legacy");
    // The safety property of the phase: the shadow side may answer, never act.
    expect(out.side_effects_permitted).toBe(false);
  });

  it("legacy reads the compatibility asset and marks it as DEPENDENCE", () => {
    const out = resolveCapability(req({ mode: "legacy" }));
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.source).toBe("compatibility");
    expect(out.compatibility_read).toEqual({
      reason: "explicit_legacy_mode",
      counts_as_dependence: true,
    });
  });

  // THE ANTI-VACUITY ROW. If this passes trivially the whole ladder is theatre:
  // the mode's entire purpose is to turn a silent shipped-template read into a
  // visible typed failure.
  it("project-local REFUSES a live dispatch with no project definition", () => {
    const out = resolveCapability(req({ mode: "project-local", project_definition: null }));
    expect(out.status).toBe("unresolved");
    if (out.status !== "unresolved") throw new Error("unreachable");
    expect(out.failure).toBe("intent_not_permitted_in_mode");
    expect(isResolverModeFailure(out.failure)).toBe(true);
    // …and it did NOT quietly return the template that was sitting right there.
    expect(JSON.stringify(out)).not.toContain(TEMPLATE);
  });

  it("strict refuses with compatibility_unavailable_in_mode, for every intent", () => {
    for (const intent of CAPABILITY_RESOLUTION_INTENTS) {
      const out = resolveCapability(req({ mode: "strict", intent }));
      expect(out.status).toBe("unresolved");
      if (out.status !== "unresolved") throw new Error("unreachable");
      expect(
        // `mint` is refused earlier, by the write check — also typed, also explicit.
        ["compatibility_unavailable_in_mode", "write_not_permitted_in_mode"],
      ).toContain(out.failure);
    }
  });

  it("observe cannot serve a mint — D03's zero-live-writes condition is structural", () => {
    const out = resolveCapability(req({ mode: "observe", intent: "mint" }));
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("write_not_permitted_in_mode");
  });

  it("shadow CAN serve a mint (its writes are human-approved creation)", () => {
    const out = resolveCapability(req({ mode: "shadow", intent: "mint" }));
    expect(out.status).toBe("resolved");
  });

  it("reports no_definition_anywhere when neither side has anything", () => {
    const out = resolveCapability(
      req({ mode: "legacy", project_definition: null, compatibility_asset: null }),
    );
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("no_definition_anywhere");
  });

  it("NEVER coerces an unknown mode to the shipped default", () => {
    const out = resolveCapability(req({ mode: "agressive" }));
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("unknown_mode");
    expect(out.mode).toBeNull();
  });
});

describe("D4 — request hardening", () => {
  it("rejects an unknown key rather than ignoring it", () => {
    const out = resolveCapability({ ...req(), extra: 1 });
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("invalid_request");
  });

  it("rejects an accessor without invoking it", () => {
    let invoked = 0;
    const bad = {};
    Object.defineProperty(bad, "mode", {
      enumerable: true,
      get() {
        invoked += 1;
        return "legacy";
      },
    });
    for (const k of ["kind", "capability_id", "project_definition", "compatibility_asset", "intent"]) {
      Object.defineProperty(bad, k, { enumerable: true, value: (req() as Record<string, unknown>)[k] });
    }
    const out = resolveCapability(bad);
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("invalid_request");
    expect(invoked).toBe(0);
  });

  it("rejects a Proxy outright", () => {
    const p = new Proxy(req(), {});
    const out = resolveCapability(p);
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("invalid_request");
  });

  it("rejects symbol-keyed data", () => {
    const withSymbol = { ...req(), [Symbol("x")]: 1 };
    const out = resolveCapability(withSymbol);
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("invalid_request");
  });

  it("REJECTS a non-canonical id rather than normalizing it", () => {
    for (const bad of ["QA", "qa file", "-qa", "qa\n", "a".repeat(129), "qa/x"]) {
      const out = resolveCapability(req({ capability_id: bad }));
      if (out.status !== "unresolved") throw new Error(`expected unresolved for ${JSON.stringify(bad)}`);
      expect(out.failure).toBe("invalid_request");
    }
  });

  it("REJECTS a non-canonical path rather than normalizing it", () => {
    for (const bad of [
      "/abs/qa.md",
      "./a/qa.md",
      "a/../qa.md",
      "a//qa.md",
      "a\\qa.md",
      "a/qa.md/",
      "C:/a/qa.md",
    ]) {
      const out = resolveCapability(req({ mode: "project-local", project_definition: bad }));
      if (out.status !== "unresolved") throw new Error(`expected unresolved for ${bad}`);
      expect(out.failure).toBe("invalid_request");
    }
  });

  it("rejects a control character in a path (the smuggled-body guard)", () => {
    const out = resolveCapability(req({ compatibility_asset: "templates/qa\u0000.md" }));
    if (out.status !== "unresolved") throw new Error("expected unresolved");
    expect(out.failure).toBe("invalid_request");
  });

  it("freezes every outcome it returns", () => {
    expect(Object.isFrozen(resolveCapability(req()))).toBe(true);
    expect(Object.isFrozen(resolveCapability(req({ mode: "nope" })))).toBe(true);
  });
});

describe("D4 — the G5 counting rule has ONE definition", () => {
  const dependence: Array<[CapabilityResolverMode, CapabilityResolutionIntent, string]> = [
    ["legacy", "dispatch", "explicit_legacy_mode"],
    ["observe", "dispatch", "explicit_legacy_mode"],
    ["shadow", "dispatch", "explicit_legacy_mode"],
    ["legacy", "rollback", "rollback"],
    ["legacy", "replay", "explicit_legacy_mode"],
  ];
  it.each(dependence)("(%s, %s) counts as dependence via %s", (mode, intent, reason) => {
    const c = classify(mode, intent);
    expect(c.status).toBe("classified");
    expect(c.reason).toBe(reason);
    expect(c.counts_as_dependence).toBe(true);
  });

  // The asymmetry S8 calls load-bearing: without these two exclusions the total
  // never reaches zero and the removal gate can never pass.
  const benign: Array<[CapabilityResolverMode, CapabilityResolutionIntent, string]> = [
    ["shadow", "mint", "mint_source"],
    ["shadow", "shadow_compare", "shadow_comparison"],
    ["project-local", "mint", "mint_source"],
  ];
  it.each(benign)("(%s, %s) is BENIGN via %s", (mode, intent, reason) => {
    const c = classify(mode, intent);
    expect(c.status).toBe("classified");
    expect(c.reason).toBe(reason);
    expect(c.counts_as_dependence).toBe(false);
  });

  it("refuses to classify a read the mode does not permit — no default reason", () => {
    const c = classify("project-local", "dispatch");
    expect(c.status).toBe("refused");
    expect(c.failure).toBe("intent_not_permitted_in_mode");
    // No reason was invented for a read that should not have happened.
    expect(c.reason).toBeUndefined();
  });

  it("refuses a shadow_compare outside a shadow-capable mode", () => {
    expect(classify("legacy", "shadow_compare").status).toBe("refused");
  });

  it("rejects an unknown intent and an unknown mode", () => {
    expect(classify("legacy", "vibes").status).toBe("refused");
    expect(classify("vibes", "dispatch").status).toBe("refused");
  });

  it("the resolution outcome carries the SAME classification as the classifier", () => {
    // Two definitions of the counting rule would eventually disagree; this pins
    // that resolveCapability delegates rather than re-deriving.
    for (const mode of ["legacy", "observe", "shadow"] as CapabilityResolverMode[]) {
      const out = resolveCapability(req({ mode, intent: "rollback" }));
      if (out.status !== "resolved") throw new Error("expected resolved");
      const direct = classify(mode, "rollback");
      expect(direct.status).toBe("classified");
      expect(out.compatibility_read).toEqual({
        reason: direct.reason,
        counts_as_dependence: direct.counts_as_dependence,
      });
    }
  });
});

describe("D4 — mode transitions are typed, never clamped", () => {
  it("allows a single-rung advance with a reason", () => {
    const out = planModeTransition({ from: "legacy", to: "observe", reason: "D03 phase 1" });
    expect(out.status).toBe("allowed");
    if (out.status !== "allowed") throw new Error("unreachable");
    expect(out.direction).toBe("advance");
    expect(out.rungs).toBe(1);
  });

  it("REFUSES a multi-rung advance unless the skip is acknowledged", () => {
    const refused = planModeTransition({ from: "legacy", to: "project-local", reason: "hurry" });
    if (refused.status !== "rejected") throw new Error("expected rejected");
    expect(refused.failure).toBe("transition_skips_rungs");

    const allowed = planModeTransition({
      from: "legacy",
      to: "project-local",
      reason: "greenfield project, no legacy side exists",
      allow_skip: true,
    });
    expect(allowed.status).toBe("allowed");
  });

  it("allows a regression (rollback along the ladder) with a reason", () => {
    const out = planModeTransition({ from: "project-local", to: "legacy", reason: "adoption failed" });
    if (out.status !== "allowed") throw new Error("expected allowed");
    expect(out.direction).toBe("regress");
    expect(out.rungs).toBe(3);
  });

  it("rejects a no-op rather than recording it as a migration step", () => {
    const out = planModeTransition({ from: "shadow", to: "shadow", reason: "x" });
    if (out.status !== "rejected") throw new Error("expected rejected");
    expect(out.failure).toBe("transition_is_noop");
  });

  it("requires a non-empty, control-character-free reason", () => {
    for (const bad of ["", "a\u0000b", 5, null, undefined]) {
      const out = planModeTransition({ from: "legacy", to: "observe", reason: bad });
      if (out.status !== "rejected") throw new Error(`expected rejected for ${String(bad)}`);
      expect(out.failure).toBe("invalid_request");
    }
  });

  it("rejects unknown modes on either side, and never clamps to a legal one", () => {
    const a = planModeTransition({ from: "nope", to: "observe", reason: "x" });
    if (a.status !== "rejected") throw new Error("expected rejected");
    expect(a.failure).toBe("unknown_mode");
    expect(a.from).toBeNull();

    const b = planModeTransition({ from: "legacy", to: "nope", reason: "x" });
    if (b.status !== "rejected") throw new Error("expected rejected");
    expect(b.failure).toBe("unknown_mode");
    expect(b.to).toBeNull();
  });

  it("rejects a proxy/accessor/unknown-key transition request", () => {
    expect(planModeTransition(new Proxy({}, {})).status).toBe("rejected");
    expect(
      planModeTransition({ from: "legacy", to: "observe", reason: "x", extra: 1 }).status,
    ).toBe("rejected");
  });
});
