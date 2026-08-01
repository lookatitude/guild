/**
 * scripts/__tests__/capability-config.test.ts
 *
 * S5 — `capability.*` config keys (cap-loc-D04 new-install policy, cap-loc-D03
 * migration ladder). Closes audit gaps D12 (no config keys existed), F3 (resolver-mode
 * ownership undefined) and F10 (budget "3–4" → fixed 4).
 *
 * These are the spec's conformance scenarios as executable assertions. The two that
 * carry the most weight are the PLAIN_ENUM_OVERRIDES proof (without that table the keys
 * silently infer as `"string"` and lose closed-set validation entirely — a failure that
 * is invisible until a typo reaches production) and the never-clobber row, which proves
 * auto-advance rides THROUGH `mayReconcileWrite` rather than beside it.
 */

import {
  CAPABILITY_AUTO_CREATE_POLICIES,
  CAPABILITY_RESOLVER_MODES,
  CAPABILITY_RESOLVER_MODE_AFTER_F7,
  CAPABILITY_RESOLVER_MODE_DEFAULT,
  CAPABILITY_SUGGESTION_BUDGET_MAX,
  CAPABILITY_SUGGESTION_BUDGET_MIN,
  DEFAULTS,
} from "../../src/modules/config/workflows/config-defaults";
import { CONFIG_SCHEMA, getFieldSpec, isSecuritySensitiveKey } from "../lib/config-schema";
import { coerceCapabilityBlock, validateCapability } from "../lib/core/config-cli";
import { mayReconcileWrite } from "../lib/config-reconcile-contract";
import { CONFIG_UI_METADATA } from "../lib/config-ui-metadata";
import { renderAllHostConfigs } from "../lib/config-render";
import { resolveBaselineGolden } from "../lib/permission-policy-schema";

const KEYS = [
  "capability.resolver_mode",
  "capability.suggestion_budget",
  "capability.starter_roles",
  "capability.auto_create_policy",
] as const;

describe("S5 — the four capability keys exist in the generated schema", () => {
  it("all four materialize with scope project and none security-sensitive", () => {
    for (const key of KEYS) {
      const spec = getFieldSpec(key);
      expect(spec).toBeDefined();
      // Spec call #2: scope stays "project" — capability ownership is per project by
      // definition, and that is what the generator already emits with zero change.
      expect(spec!.scope).toBe("project");
      // These select WHICH DEFINITIONS RESOLVE, never what a lane may DO.
      expect(spec!.security_sensitive).toBe(false);
      expect(isSecuritySensitiveKey(key)).toBe(false);
    }
  });

  it("defaults match D04: budget fixed at 4, starter_roles empty, auto-create on_approval", () => {
    expect(getFieldSpec("capability.suggestion_budget")!.default).toBe(4);
    // A non-empty default would SHIP A ROSTER — precisely what localization exists to stop.
    expect(getFieldSpec("capability.starter_roles")!.default).toEqual([]);
    expect(getFieldSpec("capability.auto_create_policy")!.default).toBe("on_approval");
  });

  it("ANTI-VACUITY: adding the block did not disturb the rest of the schema", () => {
    // 137 before S5 + 4 = 141. A drop here means a key was displaced, not added.
    expect(CONFIG_SCHEMA.length).toBe(141);
    expect(new Set(CONFIG_SCHEMA.map((s) => s.key)).size).toBe(CONFIG_SCHEMA.length);
  });
});

describe("S5 — PLAIN_ENUM_OVERRIDES (the table without which enum typing is silently lost)", () => {
  it("resolver_mode is type enum carrying all five ladder members", () => {
    const spec = getFieldSpec("capability.resolver_mode")!;
    // Without the third override table this would be `inferType("legacy") === "string"`
    // and enum_values would be absent — no closed-set validation at all.
    expect(spec.type).toBe("enum");
    expect(spec.enum_values).toEqual(["legacy", "observe", "shadow", "project-local", "strict"]);
  });

  it("auto_create_policy is type enum carrying both members", () => {
    const spec = getFieldSpec("capability.auto_create_policy")!;
    expect(spec.type).toBe("enum");
    expect(spec.enum_values).toEqual(["never", "on_approval"]);
  });

  it("carries NO most_restrictive and is NOT nullable — it is neither security nor nullable", () => {
    // The distinction from the two pre-existing tables. `strict` is the most LOCALIZED
    // mode, not the safest, so a fail-closed repair target would be meaningless here.
    for (const key of ["capability.resolver_mode", "capability.auto_create_policy"]) {
      const spec = getFieldSpec(key)!;
      expect(spec.most_restrictive).toBeUndefined();
      expect(spec.nullable).toBeUndefined();
    }
  });

  it("the non-enum keys did NOT get enum treatment", () => {
    expect(getFieldSpec("capability.suggestion_budget")!.type).toBe("number");
    expect(getFieldSpec("capability.starter_roles")!.type).toBe("array");
    expect(getFieldSpec("capability.suggestion_budget")!.enum_values).toBeUndefined();
  });
});

describe("S5 — the shipped resolver_mode default and the F7 precondition", () => {
  it("ships `legacy`, NOT `observe` — F7 (candidate surfacing) has not landed", () => {
    // S5 §"Hard precondition (from D04)": do not ship the `observe` default until F7
    // lands, because an observe install that emits candidates nobody surfaces is a
    // silent no-op — worse than no default.
    expect(CAPABILITY_RESOLVER_MODE_DEFAULT).toBe("legacy");
    expect(DEFAULTS.capability.resolver_mode).toBe("legacy");
    expect(getFieldSpec("capability.resolver_mode")!.default).toBe("legacy");
  });

  it("THE F7 FLIP: when candidate surfacing lands, this constant becomes `observe`", () => {
    // This test documents the transition so the flip is one line plus one expectation
    // rather than a remembered intention. When F7 lands: change
    // CAPABILITY_RESOLVER_MODE_DEFAULT to CAPABILITY_RESOLVER_MODE_AFTER_F7 and swap
    // the assertion above.
    expect(CAPABILITY_RESOLVER_MODE_AFTER_F7).toBe("observe");
    expect(CAPABILITY_RESOLVER_MODES).toContain(CAPABILITY_RESOLVER_MODE_AFTER_F7);
  });

  it("the ladder is ORDERED least→most localized, so progress is comparable", () => {
    expect([...CAPABILITY_RESOLVER_MODES]).toEqual([
      "legacy",
      "observe",
      "shadow",
      "project-local",
      "strict",
    ]);
    expect(CAPABILITY_RESOLVER_MODES.indexOf("legacy")).toBeLessThan(
      CAPABILITY_RESOLVER_MODES.indexOf("project-local"),
    );
  });
});

describe("S5 — validate REJECTS", () => {
  it("accepts a fully valid block with no rejects", () => {
    expect(
      validateCapability({
        resolver_mode: "shadow",
        suggestion_budget: 2,
        starter_roles: ["backend", "qa"],
        auto_create_policy: "never",
      }),
    ).toEqual([]);
  });

  it("an unknown key surfaces (closed key set — a typo must not pass silently)", () => {
    const rejects = validateCapability({ resolver_modee: "observe" });
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatch(/unknown capability key "resolver_modee"/);
  });

  it("an off-ladder resolver mode is rejected and the message names the valid set", () => {
    const rejects = validateCapability({ resolver_mode: "aggressive" });
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatch(/legacy\|observe\|shadow\|project-local\|strict/);
  });

  it("budget over the F10 ceiling is rejected (9 is not a valid budget)", () => {
    const rejects = validateCapability({ suggestion_budget: 9 });
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatch(/\[0, 4\]/);
  });

  it("budget 0 is LEGAL — 'profile but never propose'", () => {
    expect(validateCapability({ suggestion_budget: 0 })).toEqual([]);
  });

  it("a non-integer or negative budget is rejected", () => {
    expect(validateCapability({ suggestion_budget: 2.5 })).toHaveLength(1);
    expect(validateCapability({ suggestion_budget: -1 })).toHaveLength(1);
    expect(validateCapability({ suggestion_budget: "4" })).toHaveLength(1);
  });

  it("starter_roles must be non-empty slugs", () => {
    expect(validateCapability({ starter_roles: ["ok", ""] })).toHaveLength(1);
    expect(validateCapability({ starter_roles: "backend" })).toHaveLength(1);
    expect(validateCapability({ starter_roles: [1, 2] })).toHaveLength(1);
    expect(validateCapability({ starter_roles: [] })).toEqual([]);
  });

  it("an invalid auto_create_policy is rejected", () => {
    expect(validateCapability({ auto_create_policy: "always" })).toHaveLength(1);
  });
});

describe("S5 — repair COERCES (the other half; validate rejects, repair rescues)", () => {
  it("an over-range budget clamps to the ceiling rather than resetting to default", () => {
    // An operator who wrote 9 wanted "as many as possible", and 4 IS that.
    expect(coerceCapabilityBlock({ suggestion_budget: 9 }).suggestion_budget).toBe(
      CAPABILITY_SUGGESTION_BUDGET_MAX,
    );
    expect(coerceCapabilityBlock({ suggestion_budget: -3 }).suggestion_budget).toBe(
      CAPABILITY_SUGGESTION_BUDGET_MIN,
    );
    expect(coerceCapabilityBlock({ suggestion_budget: 2.9 }).suggestion_budget).toBe(2);
  });

  it("an unknown enum member falls back to the shipped default (no partial reading exists)", () => {
    expect(coerceCapabilityBlock({ resolver_mode: "aggressive" }).resolver_mode).toBe(
      CAPABILITY_RESOLVER_MODE_DEFAULT,
    );
    expect(coerceCapabilityBlock({ auto_create_policy: "always" }).auto_create_policy).toBe(
      "on_approval",
    );
  });

  it("starter_roles are trimmed, blank-stripped and DEDUPED in first-seen order", () => {
    // S5 invariant 3. Order preservation keeps the resolved config stable across runs.
    expect(
      coerceCapabilityBlock({ starter_roles: [" qa ", "backend", "qa", "", "backend", 7] })
        .starter_roles,
    ).toEqual(["qa", "backend"]);
  });

  it("ANTI-VACUITY: coercion never mutates the shared DEFAULTS array", () => {
    coerceCapabilityBlock({ starter_roles: ["leaked"] });
    expect(DEFAULTS.capability.starter_roles).toEqual([]);
  });

  it("an empty override yields exactly the defaults", () => {
    expect(coerceCapabilityBlock({})).toEqual({
      resolver_mode: CAPABILITY_RESOLVER_MODE_DEFAULT,
      suggestion_budget: 4,
      starter_roles: [],
      auto_create_policy: "on_approval",
    });
  });
});

describe("S5 — auto-advance rides THROUGH never-clobber, never beside it", () => {
  // D04's mechanism: advance only when the reconciler is allowed to write at all.
  // The point of routing through mayReconcileWrite is that there is no second rule to
  // keep in sync — a user-pinned mode is immutable to the reconciler for free.
  const stamp = "2026-08-01T00:00:00Z";

  it("a default-provenance mode is advanceable", () => {
    expect(
      mayReconcileWrite({
        key: "capability.resolver_mode",
        value: "observe",
        provenance: "default",
        last_reconciled_at: stamp,
      }),
    ).toBe(true);
  });

  it("a reconciled-provenance mode is still advanceable", () => {
    expect(
      mayReconcileWrite({
        key: "capability.resolver_mode",
        value: "shadow",
        provenance: "reconciled",
        last_reconciled_at: stamp,
      }),
    ).toBe(true);
  });

  it("A USER-PINNED MODE IS NEVER ADVANCED — the row that makes the waiver honest", () => {
    expect(
      mayReconcileWrite({
        key: "capability.resolver_mode",
        value: "observe",
        provenance: "user",
        last_reconciled_at: stamp,
      }),
    ).toBe(false);
  });

  it("auto_create_policy `never` is a distinct, explicit suppression", () => {
    // Two independent off-switches: provenance (who owns the value) and policy (whether
    // advancing is wanted at all). Neither implies the other.
    expect(CAPABILITY_AUTO_CREATE_POLICIES).toContain("never");
    expect(DEFAULTS.capability.auto_create_policy).toBe("on_approval");
  });
});

describe("S5 invariant 5 — `capability.*` never leaks into a host config shape", () => {
  // The renderer is an explicit ALLOW-LIST (permissions, models, …), so this holds by
  // construction today. The test exists because that is exactly the property a future
  // "just serialize the resolved config" refactor would silently destroy: capability
  // policy is Guild-internal, not a host setting, and a host has no use for it.
  const rendered = renderAllHostConfigs({
    config: {
      models: { tiers: { cheap: {}, mid: {}, powerful: {} } },
      security: { bypass_permissions_policy: "audit" },
      auto_approve: [],
      // A fully-populated, deliberately distinctive block: if any of it reaches a host
      // shape, the string scan below finds it.
      capability: {
        resolver_mode: "strict",
        suggestion_budget: 3,
        starter_roles: ["leak-canary-role"],
        auto_create_policy: "never",
      },
    } as never,
    permissions: resolveBaselineGolden(),
    options: { renderedAt: "2026-08-01T00:00:00Z", sourceVersion: "2.5.0-beta.1" },
  });

  it("renders every host without error", () => {
    expect(Object.keys(rendered).length).toBeGreaterThan(0);
  });

  it("no host shape carries the block, its sub-keys, or its values", () => {
    for (const [hostId, render] of Object.entries(rendered)) {
      const serialized = JSON.stringify(render);
      expect(serialized).not.toContain("leak-canary-role");
      expect(serialized).not.toContain("resolver_mode");
      expect(serialized).not.toContain("suggestion_budget");
      expect(serialized).not.toContain("starter_roles");
      expect(serialized).not.toContain("auto_create_policy");
      // Guards the assertion itself: a render that silently produced nothing would
      // pass every `not.toContain` above vacuously.
      expect(render.host_id).toBe(hostId);
    }
  });
});

describe("S5 — UI metadata (CI-gated by config-ui-metadata-coverage.test.ts)", () => {
  it("all four keys carry metadata", () => {
    for (const key of KEYS) expect(CONFIG_UI_METADATA[key]).toBeDefined();
  });

  it("resolver_mode is RAISED to danger — it changes which definitions resolve", () => {
    expect(CONFIG_UI_METADATA["capability.resolver_mode"].confirmation_strength).toBe("danger");
  });

  it("the other three stay at their safety-class floor", () => {
    expect(CONFIG_UI_METADATA["capability.suggestion_budget"].confirmation_strength).toBe("normal");
    expect(CONFIG_UI_METADATA["capability.starter_roles"].confirmation_strength).toBe("normal");
    expect(CONFIG_UI_METADATA["capability.auto_create_policy"].confirmation_strength).toBe("normal");
  });

  it("controls match the value shapes", () => {
    expect(CONFIG_UI_METADATA["capability.resolver_mode"].control).toBe("enum");
    expect(CONFIG_UI_METADATA["capability.starter_roles"].control).toBe("string_array");
    expect(CONFIG_UI_METADATA["capability.suggestion_budget"].control).toBe("number");
  });
});
