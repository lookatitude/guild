/**
 * scripts/__tests__/cloud-consent-gate.test.ts
 *
 * TDD suite for scripts/lib/cloud-consent-gate.ts (ITEM 25 — Cloud-reviewer
 * consent egress gate, v2.x).
 *
 * Contract under test:
 *   docs/v2/09-adversarial-review.md §"The review artifact bus"
 *     §Cloud-reviewer consent (egress gate) [v2.x]
 *   docs/v2/08-dispatch-execution.md §2 (cloud_opt_in checkpoint)
 *
 * Key invariants verified:
 *   1. Default DENY: absent / false / null cloud_opt_in → allowed: false.
 *   2. Happy path: cloud_opt_in=true + recognized cloud host → allowed: true.
 *   3. Local hosts are denied even with cloud_opt_in=true (not a cloud target).
 *   4. Unrecognized / empty / absent reviewerHost → denied.
 *   5. Non-boolean truthy cloud_opt_in (e.g. "true", 1, {}) → denied (strict).
 *   6. isCloudReviewer() closed-set classification.
 *   7. alwaysAskConsentCheckpoint convenience wrapper.
 *   8. result shape invariants (allowed, reason, evaluatedHost, isCloudHost).
 *
 * All tests are PURE — no filesystem access. The gate function has no I/O.
 */

import {
  cloudConsentGate,
  isCloudReviewer,
  alwaysAskConsentCheckpoint,
  CLOUD_REVIEWER_HOSTS,
  type ConsentGateInput,
  type ConsentGateResult,
} from "../lib/cloud-consent-gate";

// ---------------------------------------------------------------------------
// Section A — isCloudReviewer: closed-set classification
// ---------------------------------------------------------------------------

describe("Section A — isCloudReviewer", () => {
  it("A1: codex-cloud is recognized as a cloud reviewer", () => {
    expect(isCloudReviewer("codex-cloud")).toBe(true);
  });

  it("A2: gemini-cloud is recognized as a cloud reviewer", () => {
    expect(isCloudReviewer("gemini-cloud")).toBe(true);
  });

  it("A3: codex-plugin is NOT a cloud reviewer (local adapter)", () => {
    expect(isCloudReviewer("codex-plugin")).toBe(false);
  });

  it("A4: codex-cli is NOT a cloud reviewer", () => {
    expect(isCloudReviewer("codex-cli")).toBe(false);
  });

  it("A5: claude is NOT a cloud reviewer", () => {
    expect(isCloudReviewer("claude")).toBe(false);
  });

  it("A6: undefined returns false", () => {
    expect(isCloudReviewer(undefined)).toBe(false);
  });

  it("A7: null returns false", () => {
    expect(isCloudReviewer(null)).toBe(false);
  });

  it("A8: empty string returns false", () => {
    expect(isCloudReviewer("")).toBe(false);
  });

  it("A9: arbitrary unknown host is not in closed set", () => {
    expect(isCloudReviewer("future-cloud-reviewer")).toBe(false);
  });

  it("A10: CLOUD_REVIEWER_HOSTS contains exactly the recognized cloud set", () => {
    expect(Array.isArray(CLOUD_REVIEWER_HOSTS)).toBe(true);
    expect(CLOUD_REVIEWER_HOSTS).toContain("codex-cloud");
    expect(CLOUD_REVIEWER_HOSTS).toContain("gemini-cloud");
    // Ensure local adapters are NOT in the set
    expect(CLOUD_REVIEWER_HOSTS).not.toContain("codex-plugin");
    expect(CLOUD_REVIEWER_HOSTS).not.toContain("codex-cli");
    expect(CLOUD_REVIEWER_HOSTS).not.toContain("claude");
  });
});

// ---------------------------------------------------------------------------
// Section B — Happy path: cloud_opt_in=true + recognized cloud host → ALLOW
// ---------------------------------------------------------------------------

describe("Section B — Happy path (allowed)", () => {
  it("B1: codex-cloud + cloud_opt_in=true → allowed: true", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(true);
  });

  it("B2: gemini-cloud + cloud_opt_in=true → allowed: true", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "gemini-cloud" });
    expect(result.allowed).toBe(true);
  });

  it("B3: allowed result has non-empty reason", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("B4: allowed result has isCloudHost=true", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(result.isCloudHost).toBe(true);
  });

  it("B5: allowed result carries back the evaluatedHost", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(result.evaluatedHost).toBe("codex-cloud");
  });

  it("B6: reason mentions the host on allow", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(result.reason).toMatch(/codex-cloud/);
  });

  it("B7: context is included in allowed reason when provided", () => {
    const result = cloudConsentGate({
      cloud_opt_in: true,
      reviewerHost: "codex-cloud",
      context: "G-lane:task-001",
    });
    expect(result.reason).toMatch(/G-lane:task-001/);
  });
});

// ---------------------------------------------------------------------------
// Section C — Default DENY: absent / false / null cloud_opt_in
// ---------------------------------------------------------------------------

describe("Section C — Default DENY (missing or false opt-in)", () => {
  it("C1: cloud_opt_in absent → denied for cloud host", () => {
    const result = cloudConsentGate({ reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("C2: cloud_opt_in=false → denied for cloud host", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("C3: cloud_opt_in=undefined → denied (explicit undefined treated as absent)", () => {
    const result = cloudConsentGate({ cloud_opt_in: undefined, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("C4: cloud_opt_in=null → denied (null is not true)", () => {
    const result = cloudConsentGate({ cloud_opt_in: null, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("C5: denial reason is non-empty and explains the denial", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reason).toMatch(/DENY/);
  });

  it("C6: denial reason mentions filesystem / egress boundary", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.reason).toMatch(/filesystem|boundary|egress/i);
  });

  it("C7: denial result has isCloudHost=true (host was recognized, opt-in was absent)", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.isCloudHost).toBe(true);
  });

  it("C8: denial result carries back the evaluatedHost", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.evaluatedHost).toBe("codex-cloud");
  });

  it("C9: denial mentions 'degrade' or 'local' path for broker guidance", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.reason).toMatch(/degrade|local/i);
  });
});

// ---------------------------------------------------------------------------
// Section D — DENY: non-boolean truthy cloud_opt_in values (strict boolean guard)
// ---------------------------------------------------------------------------

describe("Section D — Strict boolean guard (non-boolean truthy values denied)", () => {
  it('D1: cloud_opt_in="true" (string) → denied — not strictly boolean true', () => {
    const result = cloudConsentGate({ cloud_opt_in: "true" as unknown, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("D2: cloud_opt_in=1 (number) → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: 1 as unknown, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("D3: cloud_opt_in={} (object) → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: {} as unknown, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("D4: cloud_opt_in=[] (array) → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: [] as unknown, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });

  it("D5: cloud_opt_in=0 (falsy number) → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: 0 as unknown, reviewerHost: "codex-cloud" });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section E — DENY: local / unrecognized reviewerHost
// ---------------------------------------------------------------------------

describe("Section E — DENY: local or unrecognized reviewerHost", () => {
  it("E1: codex-plugin (local adapter) → denied even with cloud_opt_in=true", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-plugin" });
    expect(result.allowed).toBe(false);
  });

  it("E2: codex-cli (local adapter) → denied even with cloud_opt_in=true", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cli" });
    expect(result.allowed).toBe(false);
  });

  it("E3: claude (local author host) → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "claude" });
    expect(result.allowed).toBe(false);
  });

  it("E4: local-host denial has isCloudHost=false", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-plugin" });
    expect(result.isCloudHost).toBe(false);
  });

  it("E5: local-host denial reason explains it is not a recognized cloud host", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-plugin" });
    expect(result.reason).toMatch(/DENY/);
    expect(result.reason).toMatch(/not a recognized cloud reviewer/i);
  });

  it("E6: unknown future host → denied (not in closed set)", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "future-cloud-host-v3" });
    expect(result.allowed).toBe(false);
  });

  it("E7: absent reviewerHost → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: true });
    expect(result.allowed).toBe(false);
  });

  it("E8: empty string reviewerHost → denied", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "" });
    expect(result.allowed).toBe(false);
  });

  it("E9: whitespace-only reviewerHost → denied (treated as empty)", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "   " });
    expect(result.allowed).toBe(false);
  });

  it("E10: absent reviewerHost → evaluatedHost is null", () => {
    const result = cloudConsentGate({ cloud_opt_in: true });
    expect(result.evaluatedHost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section F — Result shape invariants
// ---------------------------------------------------------------------------

describe("Section F — Result shape invariants", () => {
  const cases: Array<{ label: string; input: ConsentGateInput }> = [
    { label: "allow",               input: { cloud_opt_in: true,  reviewerHost: "codex-cloud"  } },
    { label: "deny-no-optin",       input: { cloud_opt_in: false, reviewerHost: "codex-cloud"  } },
    { label: "deny-no-host",        input: { cloud_opt_in: true                                } },
    { label: "deny-local-host",     input: { cloud_opt_in: true,  reviewerHost: "codex-plugin" } },
    { label: "deny-empty-host",     input: { cloud_opt_in: true,  reviewerHost: ""             } },
    { label: "deny-absent-optin",   input: {                       reviewerHost: "codex-cloud"  } },
  ];

  for (const { label, input } of cases) {
    it(`F-shape[${label}]: result always has allowed, reason, evaluatedHost, isCloudHost`, () => {
      const result: ConsentGateResult = cloudConsentGate(input);
      expect(result).toHaveProperty("allowed");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("evaluatedHost");
      expect(result).toHaveProperty("isCloudHost");
      expect(typeof result.allowed).toBe("boolean");
      expect(typeof result.reason).toBe("string");
      expect(typeof result.isCloudHost).toBe("boolean");
      expect(result.reason.length).toBeGreaterThan(0);
    });
  }

  it("F-evaluatedHost: non-null when a non-empty reviewerHost was provided", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(result.evaluatedHost).toBe("codex-cloud");
  });

  it("F-evaluatedHost: null when reviewerHost is absent", () => {
    const result = cloudConsentGate({ cloud_opt_in: true });
    expect(result.evaluatedHost).toBeNull();
  });

  it("F-immutable: result fields do not change between two identical calls (pure)", () => {
    const input: ConsentGateInput = { cloud_opt_in: true, reviewerHost: "codex-cloud" };
    const r1 = cloudConsentGate(input);
    const r2 = cloudConsentGate(input);
    expect(r1.allowed).toBe(r2.allowed);
    expect(r1.reason).toBe(r2.reason);
    expect(r1.evaluatedHost).toBe(r2.evaluatedHost);
    expect(r1.isCloudHost).toBe(r2.isCloudHost);
  });
});

// ---------------------------------------------------------------------------
// Section G — alwaysAskConsentCheckpoint convenience wrapper
// ---------------------------------------------------------------------------

describe("Section G — alwaysAskConsentCheckpoint", () => {
  it("G1: cloud host + no explicit opt-in → denied (the fallback always-ask posture)", () => {
    const result = alwaysAskConsentCheckpoint("codex-cloud");
    expect(result.allowed).toBe(false);
  });

  it("G2: cloud host + explicit opt-in=true → allowed", () => {
    const result = alwaysAskConsentCheckpoint("codex-cloud", true);
    expect(result.allowed).toBe(true);
  });

  it("G3: local host → denied even with opt-in=true", () => {
    const result = alwaysAskConsentCheckpoint("codex-plugin", true);
    expect(result.allowed).toBe(false);
  });

  it("G4: absent host → denied", () => {
    const result = alwaysAskConsentCheckpoint(undefined, true);
    expect(result.allowed).toBe(false);
  });

  it("G5: result reason includes always-ask-checkpoint context marker", () => {
    const result = alwaysAskConsentCheckpoint("codex-cloud");
    expect(result.reason).toMatch(/always-ask-checkpoint/);
  });

  it("G6: delegates to cloudConsentGate (same shape contract)", () => {
    const direct = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud", context: "always-ask-checkpoint" });
    const wrapper = alwaysAskConsentCheckpoint("codex-cloud", true);
    expect(wrapper.allowed).toBe(direct.allowed);
    expect(wrapper.isCloudHost).toBe(direct.isCloudHost);
    expect(wrapper.evaluatedHost).toBe(direct.evaluatedHost);
  });
});

// ---------------------------------------------------------------------------
// Section H — Edge cases and malformed inputs
// ---------------------------------------------------------------------------

describe("Section H — Edge cases and malformed inputs", () => {
  it("H1: completely empty input → denied with reason", () => {
    const result = cloudConsentGate({});
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("H2: reviewerHost with leading/trailing whitespace is trimmed for evaluation", () => {
    // '  codex-cloud  ' should still be recognized after trim
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "  codex-cloud  " });
    expect(result.allowed).toBe(true);
    expect(result.evaluatedHost).toBe("codex-cloud");
  });

  it("H3: context field does not affect the allowed decision", () => {
    const withCtx    = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud", context: "test" });
    const withoutCtx = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(withCtx.allowed).toBe(withoutCtx.allowed);
  });

  it("H4: gemini-cloud + opt-in=true → allowed (second cloud host in closed set)", () => {
    const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "gemini-cloud" });
    expect(result.allowed).toBe(true);
    expect(result.isCloudHost).toBe(true);
  });

  it("H5: codex-cloud and gemini-cloud are the only cloud hosts that can be allowed", () => {
    // Verify that only the two closed-set members can produce allowed=true
    for (const host of CLOUD_REVIEWER_HOSTS) {
      const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: host });
      expect(result.allowed).toBe(true);
    }
    // Non-members cannot
    const nonCloud = ["codex-plugin", "codex-cli", "claude", "gemini-local", "unknown-host"];
    for (const host of nonCloud) {
      const result = cloudConsentGate({ cloud_opt_in: true, reviewerHost: host });
      expect(result.allowed).toBe(false);
    }
  });

  it("H6: denial reason always mentions the host id when reviewerHost is provided", () => {
    const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    expect(result.reason).toMatch(/codex-cloud/);
  });

  it("H7: the gate is pure — no side effects on repeated calls with different inputs", () => {
    // Call with allowed path, then denied path — result is independent
    const allow = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    const deny  = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
    // Re-check allow — result must be unchanged (no shared mutable state)
    const allowAgain = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
    expect(allowAgain.allowed).toBe(allow.allowed);
    expect(deny.allowed).toBe(false);
    expect(allow.allowed).toBe(true);
  });
});
