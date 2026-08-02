/**
 * scripts/__tests__/host-injection-facts.test.ts
 *
 * Conformance for the `injection` capability group (decision cap-loc-D11,
 * spec S6, gap-audit D8). Assertion ids map to the wave-5 matrix §S6.
 *
 * The load-bearing one is A6.2, the TWO-FIELD HONESTY rule: no row may carry a
 * `true` capability without a `verified` support value. That is what stops a row
 * asserting something nobody probed — the failure gap-audit E3 records.
 */

import {
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type HostId,
} from "../../src/modules/host-runtime/workflows/host-registry-schema";
import {
  INJECTION_SUPPORT,
  validateHostCapabilitiesV1,
} from "../../src/modules/host-runtime/workflows/host-capabilities-schema";

const ALL = HOST_IDS as readonly HostId[];

/** Hosts with NO dispatch surface — nothing to inject into. */
const NO_DISPATCH: readonly HostId[] = [
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
  "agents-file",
  "kiro",
  "qoder",
  "trae",
];

describe("A6.1 — the injection group is required on every registered host", () => {
  it("all 16 host ids are present", () => {
    expect(ALL).toHaveLength(16);
  });

  it.each(ALL)("%s validates with the required injection group", (id) => {
    const row = HOST_REGISTRY_ROWS[id];
    const result = validateHostCapabilitiesV1(row.capabilities);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(ALL)("%s carries all four injection fields", (id) => {
    const inj = HOST_REGISTRY_ROWS[id].capabilities.injection;
    expect(typeof inj.definition_injection).toBe("boolean");
    expect(typeof inj.skill_bundle_injection).toBe("boolean");
    expect(typeof inj.dynamic_registration).toBe("boolean");
    expect([...INJECTION_SUPPORT]).toContain(inj.definition_injection_support);
    expect([...INJECTION_SUPPORT]).toContain(inj.skill_bundle_injection_support);
    expect([...INJECTION_SUPPORT]).toContain(inj.dynamic_registration_support);
    expect(["prompt_text", "none"]).toContain(inj.fallback);
  });
});

// ── A6.2 — THE HONESTY RULE ─────────────────────────────────────────────────

describe("A6.2 — two-field honesty: no true capability without a verified support", () => {
  it.each(ALL)("%s: every true boolean has support === verified", (id) => {
    const inj = HOST_REGISTRY_ROWS[id].capabilities.injection;
    const pairs = [
      [inj.definition_injection, inj.definition_injection_support],
      [inj.skill_bundle_injection, inj.skill_bundle_injection_support],
      [inj.dynamic_registration, inj.dynamic_registration_support],
    ] as const;
    for (const [b, sup] of pairs) {
      if (b === true) expect(sup).toBe("verified");
    }
  });

  it("NO row starts verified — injection is unbuilt, so nothing has been probed", () => {
    for (const id of ALL) {
      const inj = HOST_REGISTRY_ROWS[id].capabilities.injection;
      expect(inj.definition_injection).toBe(false);
      expect(inj.skill_bundle_injection).toBe(false);
      expect(inj.dynamic_registration).toBe(false);
    }
  });

  it("the validator REJECTS a row that claims true without verified", () => {
    const base = HOST_REGISTRY_ROWS["claude-code-cli"].capabilities;
    const dishonest = {
      ...base,
      injection: { ...base.injection, definition_injection: true }, // support stays "target"
    };
    const result = validateHostCapabilitiesV1(dishonest);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/only a "verified" support value/);
  });

  it("the validator ACCEPTS true when support is verified AND a probe receipt is cited", () => {
    const base = HOST_REGISTRY_ROWS["claude-code-cli"].capabilities;
    const probed = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: true,
        definition_injection_support: "verified" as const,
        definition_injection_verified_by:
          "evidence/host-smoke/claude-code-cli/operator-local-macos.json",
      },
    };
    expect(validateHostCapabilitiesV1(probed).valid).toBe(true);
  });

  // CODEX-REVIEW FIX (S6 round 1, CRITICAL-1): "verified" was an unchecked
  // self-assertion. It must now CITE the probe receipt that proves it.
  it("REJECTS a verified support with no probe-receipt citation", () => {
    const base = HOST_REGISTRY_ROWS["claude-code-cli"].capabilities;
    const uncited = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: true,
        definition_injection_support: "verified" as const,
        definition_injection_verified_by: null, // claims verified, cites nothing
      },
    };
    const result = validateHostCapabilitiesV1(uncited);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/must cite its own probe receipt/);
  });

  it("REJECTS a stray citation when nothing is verified", () => {
    const base = HOST_REGISTRY_ROWS["claude-code-cli"].capabilities;
    const stray = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection_verified_by: "evidence/host-smoke/made-up.json",
      },
    };
    expect(validateHostCapabilitiesV1(stray).valid).toBe(false);
  });

  it("every shipped row cites nothing, because nothing is verified", () => {
    for (const id of ALL) {
      const inj = HOST_REGISTRY_ROWS[id].capabilities.injection;
      expect(inj.definition_injection_verified_by).toBeNull();
      expect(inj.skill_bundle_injection_verified_by).toBeNull();
      expect(inj.dynamic_registration_verified_by).toBeNull();
    }
  });
});

// ── A6.3 / A6.4 — the structural rule ───────────────────────────────────────

describe("A6.3/A6.4 — no dispatch surface ⇒ absent, not target", () => {
  it("exactly 8 hosts have no dispatch surface", () => {
    const actual = ALL.filter((id) => !HOST_REGISTRY_ROWS[id].dispatch_selectable);
    expect([...actual].sort()).toEqual([...NO_DISPATCH].sort());
  });

  it.each(NO_DISPATCH)("%s is absent on all three facts, with fallback none", (id) => {
    const inj = HOST_REGISTRY_ROWS[id].capabilities.injection;
    expect(inj.definition_injection_support).toBe("absent");
    expect(inj.skill_bundle_injection_support).toBe("absent");
    expect(inj.dynamic_registration_support).toBe("absent");
    expect(inj.fallback).toBe("none");
  });

  it("every dispatch-selectable host is target (not absent) for definition injection", () => {
    for (const id of ALL) {
      if (!HOST_REGISTRY_ROWS[id].dispatch_selectable) continue;
      expect(HOST_REGISTRY_ROWS[id].capabilities.injection.definition_injection_support).toBe(
        "target"
      );
      expect(HOST_REGISTRY_ROWS[id].capabilities.injection.fallback).toBe("prompt_text");
    }
  });

  it("CROSS-FIELD: dispatch_selectable and injection support never disagree", () => {
    // The invariant in one place: a pane-less surface cannot be an injection
    // target, and a dispatchable surface is never structurally absent.
    for (const id of ALL) {
      const row = HOST_REGISTRY_ROWS[id];
      const sup = row.capabilities.injection.definition_injection_support;
      expect(row.dispatch_selectable ? sup !== "absent" : sup === "absent").toBe(true);
    }
  });
});

// ── E3 / cap-loc-D12 — the release-bar consequence, pinned ──────────────────

describe("E3 — the 'Claude AND Codex activated proof' bar is unsatisfiable today", () => {
  it("BOTH named hosts are target, not verified — Claude included", () => {
    // The gap audit framed E3 as a Codex-provenance problem. It is not: the
    // capability is unbuilt, so Claude is equally unproven. Any restatement that
    // says "Claude verified, Codex pending" is wrong in the same direction as the
    // original claim.
    for (const id of ["claude-code-cli", "codex-cli"] as const) {
      const inj = HOST_REGISTRY_ROWS[id].capabilities.injection;
      expect(inj.definition_injection_support).toBe("target");
      expect(inj.definition_injection).toBe(false);
    }
  });
});

// ── Codex adversarial review (S6 round 1) — regression coverage ────────────

import { validateHostRegistryEntry } from "../../src/modules/host-runtime/workflows/host-registry-schema";

describe("HIGH-2 fix — the cross-field structural invariant is VALIDATED", () => {
  it("rejects dispatch_selectable:false with target injection facts", () => {
    const base = HOST_REGISTRY_ROWS["kiro"]; // pane-less file surface
    const bad = {
      ...base,
      capabilities: {
        ...base.capabilities,
        injection: {
          ...base.capabilities.injection,
          definition_injection_support: "target" as const,
          fallback: "prompt_text" as const,
        },
      },
    };
    const result = validateHostRegistryEntry(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/nothing to inject into/);
  });

  it("rejects dispatch_selectable:true with absent definition injection", () => {
    const base = HOST_REGISTRY_ROWS["claude-code-cli"];
    const bad = {
      ...base,
      capabilities: {
        ...base.capabilities,
        injection: {
          ...base.capabilities.injection,
          definition_injection_support: "absent" as const,
        },
      },
    };
    const result = validateHostRegistryEntry(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/never structurally absent/);
  });

  it("every shipped registry entry passes the cross-field check", () => {
    for (const id of ALL) {
      const result = validateHostRegistryEntry(HOST_REGISTRY_ROWS[id]);
      expect(result.errors).toEqual([]);
    }
  });
});

describe("HIGH-4 fix — per-capability citations with a validated path grammar", () => {
  const base = HOST_REGISTRY_ROWS["claude-code-cli"].capabilities;
  const RECEIPT = "evidence/host-smoke/claude-code-cli/operator-local-macos.json";

  it("REJECTS an unconstrained citation string like 'x'", () => {
    const bad = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: true,
        definition_injection_support: "verified" as const,
        definition_injection_verified_by: "x",
      },
    };
    const r = validateHostCapabilitiesV1(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/evidence\/host-smoke/);
  });

  it("REJECTS a traversing citation", () => {
    const bad = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: true,
        definition_injection_support: "verified" as const,
        definition_injection_verified_by: "evidence/host-smoke/../../etc/passwd.json",
      },
    };
    expect(validateHostCapabilitiesV1(bad).valid).toBe(false);
  });

  it("citations are INDEPENDENT — verifying one capability does not license another", () => {
    // One shared string could not express this: definition is probed, skill-bundle
    // is not, and each must carry its own evidence (or none).
    const mixed = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: true,
        definition_injection_support: "verified" as const,
        definition_injection_verified_by: RECEIPT,
        // skill_bundle stays target with a null citation
      },
    };
    expect(validateHostCapabilitiesV1(mixed).valid).toBe(true);
  });

  it("REJECTS a citation attached to a capability that is not verified", () => {
    const bad = {
      ...base,
      injection: { ...base.injection, skill_bundle_injection_verified_by: RECEIPT },
    };
    expect(validateHostCapabilitiesV1(bad).valid).toBe(false);
  });
});

describe("HIGH-6 fix — the honesty rule is a BICONDITIONAL", () => {
  const base = HOST_REGISTRY_ROWS["claude-code-cli"].capabilities;
  const RECEIPT = "evidence/host-smoke/claude-code-cli/operator-local-macos.json";

  it("REJECTS verified support with a false boolean (evidence that routing ignores)", () => {
    const incoherent = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: false, // routing says unavailable...
        definition_injection_support: "verified" as const, // ...while claiming a passing probe
        definition_injection_verified_by: RECEIPT,
      },
    };
    const r = validateHostCapabilitiesV1(incoherent);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/means a probe proved the capability PRESENT/);
  });

  it("a probe that found the capability MISSING is 'absent', not verified+false", () => {
    const honest = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: false,
        definition_injection_support: "absent" as const,
        definition_injection_verified_by: null,
      },
    };
    // `absent` on a dispatch-selectable host is rejected by the REGISTRY cross-field
    // guard, not by this validator — the capability-shape check passes.
    expect(validateHostCapabilitiesV1(honest).valid).toBe(true);
  });

  it("both directions hold: verified ⟺ true", () => {
    const ok = {
      ...base,
      injection: {
        ...base.injection,
        definition_injection: true,
        definition_injection_support: "verified" as const,
        definition_injection_verified_by: RECEIPT,
      },
    };
    expect(validateHostCapabilitiesV1(ok).valid).toBe(true);
  });
});
