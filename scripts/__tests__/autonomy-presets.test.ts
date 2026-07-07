/**
 * __tests__/autonomy-presets.test.ts
 *
 * LW3-2 (SC-W3-2 / AC21) — lane self-test for the autonomy presets module. The
 * AUTHORITATIVE cross-cutting eval is LW3-6 (eval-engineer); this proves the module's
 * core invariants locally so the G-lane gate has falsifiable evidence:
 *   - AC21: every preset, every protected gate non-auto unless explicitly named;
 *   - the validator REJECTS auto-continue-without-grant + hard-set autonomy grants + the
 *     closed bypass axis (auto_approve);
 *   - never-clobber + fail-closed-on-security in the write planner;
 *   - default (conservative) byte-identical to today (all gates ask);
 *   - bypass orthogonality (host bypass never lifts a Guild gate).
 */

import {
  AUTONOMY_PRESETS,
  AUTONOMY_PRESET_NAMES,
  AUTONOMY_PRESET_SCHEMA_VERSION,
  type AutonomyPreset,
  presetGateRequired,
  expandPreset,
  validateAutonomyPreset,
  validateAllPresets,
  planPresetWrite,
  PRESET_HOST_MODE_KEY,
  presetGuildGateKey,
  getPreset,
} from "../lib/autonomy-presets";
import { GATE_TYPES, ALWAYS_ASK_HARD_SET } from "../lib/permission-policy-schema";
import { isSecuritySensitiveKey } from "../lib/config-schema";
import type { MaterializedField } from "../lib/config-reconcile-contract";

const NOW = "2026-06-17T00:00:00Z";

describe("shipped presets validate", () => {
  it("all three presets pass validation", () => {
    const results = validateAllPresets();
    for (const name of AUTONOMY_PRESET_NAMES) {
      expect(results[name]).toEqual({ valid: true, errors: [] });
    }
  });

  it("getPreset resolves known names and rejects unknown", () => {
    expect(getPreset("standard")).toBe(AUTONOMY_PRESETS.standard);
    expect(getPreset("nope")).toBeUndefined();
  });
});

describe("AC21 invariant — protected gate non-auto unless explicitly named", () => {
  it("for EVERY preset, any auto-continuing gate is explicitly named", () => {
    for (const name of AUTONOMY_PRESET_NAMES) {
      const exp = expandPreset(AUTONOMY_PRESETS[name]);
      for (const g of exp.gates) {
        if (!g.required) {
          // would auto-continue ⇒ must be explicitly named
          expect(g.explicitly_named).toBe(true);
        }
      }
    }
  });

  it("the always-ask hard set is required under EVERY preset (host bypass cannot lift it)", () => {
    for (const name of AUTONOMY_PRESET_NAMES) {
      for (const gate of GATE_TYPES) {
        if (ALWAYS_ASK_HARD_SET.has(gate)) {
          expect(presetGateRequired(AUTONOMY_PRESETS[name], gate)).toBe(true);
        }
      }
    }
  });

  it("standard auto-continues exactly {plan, qa}; nothing else", () => {
    const exp = expandPreset(AUTONOMY_PRESETS.standard);
    const auto = exp.gates.filter((g) => !g.required).map((g) => g.gate_type).sort();
    expect(auto).toEqual(["plan", "qa"]);
  });
});

describe("default byte-identical (conservative == today's all-ask)", () => {
  it("conservative requires EVERY gate and uses host_mode 'ask'", () => {
    const exp = expandPreset(AUTONOMY_PRESETS.conservative);
    expect(exp.host_mode).toBe("ask");
    for (const g of exp.gates) expect(g.required).toBe(true);
    expect(AUTONOMY_PRESETS.conservative.guild_gates).toEqual({});
  });
});

describe("bypass orthogonality", () => {
  it("bypass uses host_mode 'bypass_all' but the SAME gate posture as standard", () => {
    expect(AUTONOMY_PRESETS.bypass.host_mode).toBe("bypass_all");
    const bypass = expandPreset(AUTONOMY_PRESETS.bypass).gates.map((g) => [g.gate_type, g.required]);
    const standard = expandPreset(AUTONOMY_PRESETS.standard).gates.map((g) => [g.gate_type, g.required]);
    expect(bypass).toEqual(standard);
  });
});

describe("validator REJECTS unsafe presets (fail-closed)", () => {
  function base(): AutonomyPreset {
    return {
      schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
      name: "standard",
      description: "x",
      host_mode: "ask",
      guild_gates: {},
    };
  }

  it("rejects an autonomy grant on an always-ask hard gate", () => {
    for (const hard of [...ALWAYS_ASK_HARD_SET]) {
      const bad = base();
      (bad.guild_gates as Record<string, string>)[hard] = "auto-safe";
      const r = validateAutonomyPreset(bad);
      expect(r.valid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/AC21.*hard gate/);
    }
  });

  it("rejects a preset carrying the auto_approve axis (closed bypass path)", () => {
    const bad: Record<string, unknown> = { ...base(), auto_approve: ["all"] };
    const r = validateAutonomyPreset(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/auto_approve/);
  });

  it("rejects an invalid host_mode", () => {
    const bad: Record<string, unknown> = { ...base(), host_mode: "yolo" };
    expect(validateAutonomyPreset(bad).valid).toBe(false);
  });

  it("rejects a guild_gates value outside the GuildGate enum", () => {
    const bad = base();
    (bad.guild_gates as Record<string, string>)["plan"] = "always-auto";
    expect(validateAutonomyPreset(bad).valid).toBe(false);
  });

  it("rejects a non-gate key in guild_gates", () => {
    const bad = base();
    (bad.guild_gates as Record<string, string>)["spec"] = "auto-safe";
    expect(validateAutonomyPreset(bad).valid).toBe(false);
  });

  it("fail-closed: a NON-enumerable malformed grant cannot bypass validation", () => {
    const bad = base();
    Object.defineProperty(bad.guild_gates, "plan", {
      enumerable: false,
      configurable: true,
      value: [], // malformed (not a GuildGate string)
    });
    const v = validateAutonomyPreset(bad);
    expect(v.valid).toBe(false);
    // and the planner must NOT emit the malformed key
    const plan = planPresetWrite(bad, {}, "project", NOW);
    expect(plan.rejected).toBe(true);
  });

  it("fail-closed: a NON-enumerable auto_approve axis cannot bypass the closed-axis guard", () => {
    const bad: Record<string, unknown> = { ...base() };
    Object.defineProperty(bad, "auto_approve", {
      enumerable: false,
      configurable: true,
      value: ["all"],
    });
    const v = validateAutonomyPreset(bad);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/auto_approve/);
  });
});

describe("write planner — never-clobber + fail-closed on security keys", () => {
  it("writes host_mode + named guild_gates keys with provenance 'user'", () => {
    const plan = planPresetWrite(AUTONOMY_PRESETS.standard, {}, "project", NOW);
    expect(plan.rejected).toBe(false);
    const keys = plan.writes.map((w) => w.key).sort();
    expect(keys).toEqual(
      [PRESET_HOST_MODE_KEY, presetGuildGateKey("plan"), presetGuildGateKey("qa")].sort()
    );
    for (const w of plan.writes) {
      expect(w.provenance).toBe("user");
      expect(w.last_reconciled_at).toBe(NOW);
    }
  });

  it("NO produced write key is security-sensitive", () => {
    for (const name of AUTONOMY_PRESET_NAMES) {
      const plan = planPresetWrite(AUTONOMY_PRESETS[name], {}, "project", NOW);
      for (const w of plan.writes) expect(isSecuritySensitiveKey(w.key)).toBe(false);
    }
  });

  it("never-clobbers a user-set sibling key", () => {
    const current: Record<string, MaterializedField> = {
      [PRESET_HOST_MODE_KEY]: {
        key: PRESET_HOST_MODE_KEY,
        value: "read_only",
        provenance: "user",
        last_reconciled_at: null,
      },
    };
    const plan = planPresetWrite(AUTONOMY_PRESETS.standard, current, "project", NOW);
    expect(plan.skipped_user_keys).toContain(PRESET_HOST_MODE_KEY);
    expect(plan.writes.map((w) => w.key)).not.toContain(PRESET_HOST_MODE_KEY);
  });

  it("overwrites a default/reconciled sibling (not user-set)", () => {
    const current: Record<string, MaterializedField> = {
      [PRESET_HOST_MODE_KEY]: {
        key: PRESET_HOST_MODE_KEY,
        value: "ask",
        provenance: "reconciled",
        last_reconciled_at: null,
      },
    };
    const plan = planPresetWrite(AUTONOMY_PRESETS.standard, current, "project", NOW);
    expect(plan.skipped_user_keys).not.toContain(PRESET_HOST_MODE_KEY);
    expect(plan.writes.map((w) => w.key)).toContain(PRESET_HOST_MODE_KEY);
  });

  it("fail-closed: rejects a hostile preset whose getter throws (never throws)", () => {
    const hostile: Record<string, unknown> = {
      schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
      name: "standard",
      description: "x",
      host_mode: "ask",
    };
    Object.defineProperty(hostile, "guild_gates", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const v = validateAutonomyPreset(hostile);
    expect(v.valid).toBe(false);
    const plan = planPresetWrite(hostile as unknown as AutonomyPreset, {}, "project", NOW);
    expect(plan.rejected).toBe(true);
    expect(plan.writes).toEqual([]);
  });

  it("fail-closed: planPresetWrite rejects a hostile preset whose `name` getter throws", () => {
    const hostile: Record<string, unknown> = {
      schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
      description: "x",
      host_mode: "ask",
      guild_gates: {},
    };
    Object.defineProperty(hostile, "name", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const plan = planPresetWrite(hostile as unknown as AutonomyPreset, {}, "project", NOW);
    expect(plan.rejected).toBe(true);
    expect(plan.writes).toEqual([]);
  });

  it("MINIMAL-DIFF: a DEFAULT-EQUIVALENT preset (conservative) is byte-identical to no-preset (writes:[])", () => {
    // conservative = host_mode 'ask' (the effective default) + no gate grants ⇒ nothing
    // differs from the no-preset baseline, so NOTHING is written.
    const plan = planPresetWrite(AUTONOMY_PRESETS.conservative, {}, "project", NOW);
    expect(plan.rejected).toBe(false);
    expect(plan.writes).toEqual([]); // byte-identical to no-preset
    expect(plan.skipped_user_keys).toEqual([]); // a no-op is NOT a user-clobber skip
    // even when host_mode is already explicitly present at the default value, still writes:[]
    const current: Record<string, MaterializedField> = {
      [PRESET_HOST_MODE_KEY]: {
        key: PRESET_HOST_MODE_KEY,
        value: "ask",
        provenance: "reconciled",
        last_reconciled_at: null,
      },
    };
    const plan2 = planPresetWrite(AUTONOMY_PRESETS.conservative, current, "project", NOW);
    expect(plan2.writes).toEqual([]);
    expect(plan2.skipped_user_keys).toEqual([]);
  });

  it("MINIMAL-DIFF: a non-default preset writes ONLY the keys whose value differs", () => {
    // host_mode already equals standard's 'accept_edits' (no-op), so only the differing
    // guild_gates keys are written — even though host_mode is reconciler-writable.
    const current: Record<string, MaterializedField> = {
      [PRESET_HOST_MODE_KEY]: {
        key: PRESET_HOST_MODE_KEY,
        value: "accept_edits",
        provenance: "reconciled",
        last_reconciled_at: null,
      },
    };
    const plan = planPresetWrite(AUTONOMY_PRESETS.standard, current, "project", NOW);
    expect(plan.rejected).toBe(false);
    expect(plan.writes.map((w) => w.key).sort()).toEqual(
      [presetGuildGateKey("plan"), presetGuildGateKey("qa")].sort()
    );
    expect(plan.writes.map((w) => w.key)).not.toContain(PRESET_HOST_MODE_KEY); // no-op skipped
    expect(plan.skipped_user_keys).toEqual([]); // no-op is not a clobber skip
  });

  it("rejects (writes nothing) when the preset is invalid", () => {
    const bad: AutonomyPreset = {
      schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
      name: "standard",
      description: "x",
      host_mode: "ask",
      guild_gates: { release: "auto-safe" },
    };
    const plan = planPresetWrite(bad, {}, "project", NOW);
    expect(plan.rejected).toBe(true);
    expect(plan.writes).toEqual([]);
  });
});
