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
  isValidCapabilityValue,
  isCanonicalRoleSlug,
  roleSlugDedupKey,
} from "../lib/shared/config-defaults";
import { CONFIG_SCHEMA, getFieldSpec, isSecuritySensitiveKey } from "../lib/config-schema";
import { coerceCapabilityBlock, validateCapability } from "../lib/core/config-cli";
import {
  advanceResolverModeOnApproval,
  mayReconcileWrite,
} from "../lib/config-reconcile-contract";
import { CONFIG_UI_METADATA } from "../lib/config-ui-metadata";
import { renderAllHostConfigs } from "../lib/config-render";
import { resolveBaselineGolden } from "../lib/permission-policy-schema";
import { resolveSettings } from "../lib/settings-resolver";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

/** A scratch project root carrying `settings`, returned as its cwd. */
function mkSettings(settings: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-cfg-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings));
  return dir;
}

/** Drive the REAL config-cmd CLI (subprocess), matching config-cmd.test.ts's convention. */
function runConfigCmd(args: string[]): { status: number; out: string; err: string } {
  const script = path.resolve(__dirname, "..", "config-cmd.ts");
  const r = spawnSync("npx", ["tsx", script, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

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
    // +1 (dynamic-host-model-routing T5): capability model_policy (guild.model_policy.v2).
    // +1 (#93): defaults.dispatch.block_unmarked_lanes — the backend-degradation
    // guard's strict rung, promoted from the GUILD_BLOCK_UNMARKED_LANES env flag.
    expect(CONFIG_SCHEMA.length).toBe(143);
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
  it("ships `observe` — F7 (candidate surfacing) HAS landed", () => {
    // S5 §"Hard precondition (from D04)" held this at `legacy` until candidate
    // surfacing existed, because an observe install that emits candidates nobody
    // surfaces is a silent no-op — worse than no default. That surface now ships
    // (scripts/lib/capability/candidate-surface.ts, printed by commands/status.md,
    // round-tripped from a real emission in capability-candidate-surface.test.ts),
    // so the honest default is D04's `observe`.
    expect(CAPABILITY_RESOLVER_MODE_DEFAULT).toBe("observe");
    expect(DEFAULTS.capability.resolver_mode).toBe("observe");
    expect(getFieldSpec("capability.resolver_mode")!.default).toBe("observe");
  });

  it("THE F7 FLIP: candidate surfacing landed, so the default IS the post-F7 value", () => {
    // The test that was pre-written for the transition, now asserting it happened.
    // The two constants are bound by definition rather than by two copies of the
    // same literal, so they cannot drift into disagreeing about what F7 unlocked.
    expect(CAPABILITY_RESOLVER_MODE_AFTER_F7).toBe("observe");
    expect(CAPABILITY_RESOLVER_MODES).toContain(CAPABILITY_RESOLVER_MODE_AFTER_F7);
    expect(CAPABILITY_RESOLVER_MODE_DEFAULT).toBe(CAPABILITY_RESOLVER_MODE_AFTER_F7);
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
    // One reject PER offending entry, not one for the array: an operator fixing a
    // 20-role list should not have to re-run validate 20 times to find them all.
    expect(validateCapability({ starter_roles: [1, 2] })).toHaveLength(2);
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

  it("non-canonical starter_roles are DROPPED, not repaired; canonical ones dedupe in order", () => {
    // S5 invariant 3, tightened by the cross-lane alias-dedup finding: a non-canonical
    // spelling (" qa ") is DROPPED rather than trimmed into "qa". Repairing it would
    // silently decide WHICH ROLE the project asked for — and validate already rejected
    // this input, so anything reaching coerce is being rescued, not blessed.
    expect(
      coerceCapabilityBlock({ starter_roles: [" qa ", "backend", "qa", "", "backend", 7] })
        .starter_roles,
    ).toEqual(["backend", "qa"]);
    // Order preservation keeps the resolved config stable across runs.
    expect(
      coerceCapabilityBlock({ starter_roles: ["qa", "backend"] }).starter_roles,
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

// ===========================================================================
// CODEX ADVERSARIAL ROUND — defects found by an independent reviewer.
// Each case reproduces a REAL defect the first cut shipped. They are written as
// the reviewer described them, not as I would have guessed them.
// ===========================================================================

describe("S5 codex-round — the RUNTIME resolver must honor the block (BLOCKER)", () => {
  // The schema, the CLI loader and the UI all knew about `capability`, but the
  // resolver every runtime consumer actually reads — settings-resolver, backed by
  // src/modules/config/workflows/settings-reader.ts — has its OWN closed TIER1 key
  // set and its own ResolvedConfig. It omitted `capability`, so a project that
  // configured `resolver_mode: "strict"` silently resolved to the shipped default.
  // Config that cannot be read is config that does not exist.
  function resolveIn(settings: Record<string, unknown>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-resolve-"));
    fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings));
    return resolveSettings({ cwd: dir });
  }

  it("a configured resolver_mode survives resolution", () => {
    const resolved = resolveIn({ capability: { resolver_mode: "strict" } });
    expect(resolved.config.capability?.resolver_mode).toBe("strict");
  });

  it("suggestion_budget 0 survives — 0 must not be swallowed as falsy", () => {
    const resolved = resolveIn({ capability: { suggestion_budget: 0 } });
    expect(resolved.config.capability?.suggestion_budget).toBe(0);
  });

  it("an absent block resolves to the shipped defaults", () => {
    const resolved = resolveIn({});
    expect(resolved.config.capability?.resolver_mode).toBe(CAPABILITY_RESOLVER_MODE_DEFAULT);
    expect(resolved.config.capability?.suggestion_budget).toBe(4);
  });

  it("the resolver COERCES a malformed block rather than passing it through", () => {
    const resolved = resolveIn({
      capability: { suggestion_budget: 9, starter_roles: [" qa ", "qa", ""], resolver_mode: "bogus" },
    });
    expect(resolved.config.capability?.suggestion_budget).toBe(4);
    expect(resolved.config.capability?.starter_roles).toEqual(["qa"]);
    expect(resolved.config.capability?.resolver_mode).toBe(CAPABILITY_RESOLVER_MODE_DEFAULT);
  });

  it("a valid block is NOT reported as an unknown top-level key by `config validate`", () => {
    // The second validation entrypoint (config-cli's own TIER1 sweep) also omitted
    // `capability`, so a perfectly valid block was rejected by the very function that
    // then went on to validate its contents.
    const dir = mkSettings({ capability: { resolver_mode: "shadow" } });
    const r = runConfigCmd(["validate", "--effective", "--cwd", dir]);
    expect(`${r.out}${r.err}`).not.toMatch(/unknown .*key .*capability/i);
    expect(r.status).toBe(0);
  });

  it("`config validate` still REJECTS a malformed block (the gate is not merely open)", () => {
    // Anti-vacuity for the row above: accepting the key must not mean accepting
    // anything under it. Before the fix, the resolver dropped the whole block, so a
    // malformed one was replaced by defaults and reported VALID.
    const dir = mkSettings({
      capability: { resolver_modee: "observe", suggestion_budget: 9 },
    });
    const r = runConfigCmd(["validate", "--effective", "--cwd", dir]);
    expect(r.status).not.toBe(0);
  });
});

describe("S5 codex-round — validate and coerce must AGREE on the same input", () => {
  // The reviewer's sharpest catch: `[" qa ", "qa"]` passed validate unchanged, then
  // coerce silently rewrote it to `["qa"]`. A value that validates but is then
  // altered is a value the operator was never told about.
  it("REJECTS an untrimmed slug rather than silently trimming it later", () => {
    expect(validateCapability({ starter_roles: [" qa "] })).toHaveLength(1);
  });

  it("REJECTS duplicates rather than silently deduping them later", () => {
    expect(validateCapability({ starter_roles: ["qa", "qa"] })).toHaveLength(1);
  });

  it("REJECTS a slug with inner whitespace", () => {
    expect(validateCapability({ starter_roles: ["not a slug"] })).toHaveLength(1);
  });

  it("PROPERTY: anything validate accepts, coerce leaves untouched", () => {
    // The invariant that makes the two halves coherent: coercion is only ever
    // reached by input validate would have rejected.
    for (const roles of [[], ["qa"], ["qa", "backend"], ["a-b", "c_d"]]) {
      expect(validateCapability({ starter_roles: roles })).toEqual([]);
      expect(coerceCapabilityBlock({ starter_roles: roles }).starter_roles).toEqual(roles);
    }
    for (const budget of [0, 1, 4]) {
      expect(validateCapability({ suggestion_budget: budget })).toEqual([]);
      expect(coerceCapabilityBlock({ suggestion_budget: budget }).suggestion_budget).toBe(budget);
    }
  });
});

describe("S5 codex-round — auto-advance is CODE, not prose (HIGH)", () => {
  // The reviewer's point: a test that calls mayReconcileWrite directly proves nothing
  // about the advance — it would still pass if a future auto-advance bypassed the
  // predicate entirely. These exercise the production path instead.
  const NOW = "2026-08-01T00:00:00Z";
  const field = (provenance: "default" | "user" | "reconciled", value = "legacy") => ({
    key: "capability.resolver_mode",
    value,
    provenance,
    last_reconciled_at: NOW,
  });

  it("advances a default-provenance mode and stamps it `reconciled`", () => {
    const out = advanceResolverModeOnApproval({
      current: field("default"),
      autoCreatePolicy: "on_approval",
      target: "project-local",
      now: NOW,
    });
    expect(out.advanced).toBe(true);
    expect(out.reason).toBe("advanced");
    expect(out.field).toEqual({
      key: "capability.resolver_mode",
      value: "project-local",
      // `reconciled`, so a later operator pin can still take ownership and freeze it.
      provenance: "reconciled",
      last_reconciled_at: NOW,
    });
  });

  it("A USER-PINNED MODE IS NEVER ADVANCED — through the predicate, not beside it", () => {
    const out = advanceResolverModeOnApproval({
      current: field("user", "observe"),
      autoCreatePolicy: "on_approval",
      target: "project-local",
      now: NOW,
    });
    expect(out.advanced).toBe(false);
    expect(out.reason).toBe("user_pinned");
    expect(out.field).toBeNull();
  });

  it("`auto_create_policy: never` suppresses the advance independently of provenance", () => {
    const out = advanceResolverModeOnApproval({
      current: field("default"),
      autoCreatePolicy: "never",
      target: "project-local",
      now: NOW,
    });
    expect(out.advanced).toBe(false);
    expect(out.reason).toBe("policy_never");
  });

  it("policy `never` wins even when provenance would allow the write", () => {
    // Two INDEPENDENT off-switches; neither implies the other.
    expect(mayReconcileWrite(field("reconciled"))).toBe(true);
    expect(
      advanceResolverModeOnApproval({
        current: field("reconciled"),
        autoCreatePolicy: "never",
        target: "project-local",
        now: NOW,
      }).advanced,
    ).toBe(false);
  });

  it("is idempotent — advancing to the mode already held is a no-op", () => {
    const out = advanceResolverModeOnApproval({
      current: field("reconciled", "project-local"),
      autoCreatePolicy: "on_approval",
      target: "project-local",
      now: NOW,
    });
    expect(out.advanced).toBe(false);
    expect(out.reason).toBe("already_at_target");
  });

  it("an ABSENT field advances (fill is allowed)", () => {
    const out = advanceResolverModeOnApproval({
      current: undefined,
      autoCreatePolicy: "on_approval",
      target: "observe",
      now: NOW,
    });
    expect(out.advanced).toBe(true);
  });
});

describe("S5 codex-round — reconcile repair COERCES capability values (HIGH)", () => {
  // defaultIsValidValue is STRUCTURAL: it accepts any finite number and any array, so
  // suggestion_budget 9 and duplicate starter_roles survived `repair` even at
  // `reconciled` provenance. isValidCapabilityValue is the semantic check that fixes it.
  it("an out-of-range budget is malformed", () => {
    expect(isValidCapabilityValue("capability.suggestion_budget", 9)).toBe(false);
    expect(isValidCapabilityValue("capability.suggestion_budget", 2.5)).toBe(false);
    expect(isValidCapabilityValue("capability.suggestion_budget", 4)).toBe(true);
    expect(isValidCapabilityValue("capability.suggestion_budget", 0)).toBe(true);
  });

  it("duplicate or untrimmed starter_roles are malformed", () => {
    expect(isValidCapabilityValue("capability.starter_roles", ["qa", "qa"])).toBe(false);
    expect(isValidCapabilityValue("capability.starter_roles", [" qa "])).toBe(false);
    expect(isValidCapabilityValue("capability.starter_roles", ["qa", "backend"])).toBe(true);
    expect(isValidCapabilityValue("capability.starter_roles", [])).toBe(true);
  });

  it("an off-ladder mode is malformed", () => {
    expect(isValidCapabilityValue("capability.resolver_mode", "aggressive")).toBe(false);
    expect(isValidCapabilityValue("capability.resolver_mode", "shadow")).toBe(true);
  });

  it("defers on every non-capability key (undefined ⇒ use the structural check)", () => {
    expect(isValidCapabilityValue("rigor", "deep")).toBeUndefined();
    expect(isValidCapabilityValue("loop_cap", 16)).toBeUndefined();
  });
});

// ===========================================================================
// CROSS-LANE DEFECT-CLASS SWEEP — the same three classes, audited against S5.
// ===========================================================================

describe("S5 defect-class 1 — options-object TOCTOU", () => {
  // validateCapability / coerceCapabilityBlock previously read each field TWICE
  // (presence check, then value check). On a caller-supplied object a getter can answer
  // differently to the two reads, so the value validated is not the value used. Each
  // field is now read exactly once into a local.
  it("a getter is read at most once, so validate cannot be tricked by a flip", () => {
    let reads = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "suggestion_budget", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? 2 : 99; // valid on read 1, absurd on read 2
      },
    });
    const rejects = validateCapability(hostile);
    expect(reads).toBeLessThanOrEqual(1);
    expect(rejects).toEqual([]); // it saw 2, and 2 is genuinely valid
  });

  it("coerce reads each field once too", () => {
    let reads = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "resolver_mode", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? "shadow" : "strict";
      },
    });
    expect(coerceCapabilityBlock(hostile).resolver_mode).toBe("shadow");
    expect(reads).toBeLessThanOrEqual(1);
  });

  it("advanceResolverModeOnApproval reads the never-clobber field once", () => {
    let reads = 0;
    const current = { key: "capability.resolver_mode", value: "legacy", last_reconciled_at: null } as Record<
      string,
      unknown
    >;
    Object.defineProperty(current, "provenance", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? "user" : "default"; // pinned, then not
      },
    });
    const out = advanceResolverModeOnApproval({
      current: current as never,
      autoCreatePolicy: "on_approval",
      target: "project-local",
      now: "2026-08-01T00:00:00Z",
    });
    // It must honor the FIRST answer (user-pinned) and refuse.
    expect(out.advanced).toBe(false);
    expect(out.reason).toBe("user_pinned");
  });
});

describe("S5 defect-class 2 — alias dedup on role slugs", () => {
  // The roster is FILESYSTEM-BACKED: `.guild/agents/QA.md` and `.guild/agents/qa.md`
  // are one file on macOS/Windows, so two spellings would claim one slot.
  it("an upper-case slug is REJECTED, never lower-cased", () => {
    expect(validateCapability({ starter_roles: ["QA"] })).toHaveLength(1);
    expect(isCanonicalRoleSlug("QA")).toBe(false);
    expect(isCanonicalRoleSlug("qa")).toBe(true);
  });

  it("case-insensitive duplicates are caught even when each spelling is canonical-ish", () => {
    // Both rejected as non-canonical, and the dedup key would collide regardless.
    expect(roleSlugDedupKey("qa")).toBe(roleSlugDedupKey("QA"));
    expect(validateCapability({ starter_roles: ["qa", "qa"] })).toHaveLength(1);
  });

  it("a path-shaped slug is rejected (a slug names a file, it is not a path)", () => {
    expect(validateCapability({ starter_roles: ["a/b"] })).toHaveLength(1);
    expect(validateCapability({ starter_roles: ["../escape"] })).toHaveLength(1);
  });

  it("ANTI-VACUITY: ordinary slugs still pass", () => {
    expect(validateCapability({ starter_roles: ["qa", "backend", "doc-writer", "a.b_c"] })).toEqual([]);
  });
});

describe("S5 defect-class 3 — unbounded-scalar smuggling", () => {
  const CTRL = String.fromCharCode(1);

  it("an oversized slug is rejected", () => {
    expect(validateCapability({ starter_roles: ["a".repeat(65)] })).toHaveLength(1);
    expect(validateCapability({ starter_roles: ["a".repeat(64)] })).toEqual([]);
  });

  it("CONTROL CHARACTERS are rejected — a slug never contains a newline", () => {
    expect(validateCapability({ starter_roles: ["qa\nsmuggled: true"] })).toHaveLength(1);
    expect(validateCapability({ starter_roles: [`qa${CTRL}`] })).toHaveLength(1);
  });

  it("a 12KB body cannot ride in a role slug", () => {
    // The S4 shape: a field validated as merely "non-empty string" carried an entire
    // agent body past a schema that had no body field.
    const body = `---\nname: evil\n---\n${"x".repeat(12000)}`;
    expect(validateCapability({ starter_roles: [body] })).toHaveLength(1);
    expect(isValidCapabilityValue("capability.starter_roles", [body])).toBe(false);
  });

  it("all four validators AGREE on the same slug (no drift between them)", () => {
    for (const bad of ["QA", " qa", "a b", "a/b", "a".repeat(65), `qa${CTRL}`]) {
      expect(validateCapability({ starter_roles: [bad] }).length).toBeGreaterThan(0);
      expect(isValidCapabilityValue("capability.starter_roles", [bad])).toBe(false);
      expect(coerceCapabilityBlock({ starter_roles: [bad] }).starter_roles).toEqual([]);
    }
    for (const ok of ["qa", "backend", "doc-writer"]) {
      expect(validateCapability({ starter_roles: [ok] })).toEqual([]);
      expect(isValidCapabilityValue("capability.starter_roles", [ok])).toBe(true);
      expect(coerceCapabilityBlock({ starter_roles: [ok] }).starter_roles).toEqual([ok]);
    }
  });
});
