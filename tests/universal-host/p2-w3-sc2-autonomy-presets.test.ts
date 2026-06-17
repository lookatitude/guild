/**
 * tests/universal-host/p2-w3-sc2-autonomy-presets.test.ts
 *
 * AUTHORITATIVE cross-cutting acceptance test for SC-W3-2 (ADR step 18 / AC21 — named
 * autonomy presets that express autonomy ONLY via host_mode + guild_gates).
 *
 * Binding assertions (anti-vacuity mandatory):
 *  (1) AC21 INVARIANT over EVERY shipped preset: each protected gate (plan/qa/release/ops/
 *      security/destructive) stays NON-auto unless guild_gates EXPLICITLY names it; a preset
 *      that would auto-continue a protected gate without an explicit grant is REJECTED.
 *  (2) No `auto_approve` axis: a preset carrying auto_approve (or any security key) is REJECTED.
 *  (3) A DEFAULT-EQUIVALENT preset (conservative) plans writes:[] (byte-identical to no-preset).
 *  (4) NEVER-CLOBBER: a candidate key whose current value is user-set is skipped, not overwritten.
 *  Each has a control proving the assertion can fail (a crafted violating preset is rejected; a
 *  non-default preset DOES write).
 */

import {
  AUTONOMY_PRESETS,
  AUTONOMY_PRESET_NAMES,
  AUTONOMY_PRESET_SCHEMA_VERSION,
  validateAutonomyPreset,
  validateAllPresets,
  expandPreset,
  presetGateRequired,
  planPresetWrite,
  type AutonomyPreset,
} from "../../scripts/lib/autonomy-presets";
import {
  GATE_TYPES,
  ALWAYS_ASK_HARD_SET,
} from "../../scripts/lib/permission-policy-schema";
import type { MaterializedField } from "../../scripts/lib/config-reconcile-contract";

const NOW = "2026-06-17T00:00:00Z";

describe("SC-W3-2 (1) — AC21 invariant holds for every shipped preset", () => {
  it("every shipped preset validates (AC21 included)", () => {
    const all = validateAllPresets();
    for (const name of AUTONOMY_PRESET_NAMES) {
      expect(all[name].errors).toEqual([]);
      expect(all[name].valid).toBe(true);
    }
  });

  it.each(AUTONOMY_PRESET_NAMES)(
    "%s: every protected gate that auto-continues is EXPLICITLY named in guild_gates",
    (name) => {
      const preset = AUTONOMY_PRESETS[name];
      const expansion = expandPreset(preset);
      for (const g of expansion.gates) {
        if (!g.required) {
          // auto-continues ⇒ MUST be explicitly named
          expect(g.explicitly_named).toBe(true);
        }
      }
    }
  );

  it.each(AUTONOMY_PRESET_NAMES)(
    "%s: NO hard gate (release/ops/security/destructive) ever auto-continues",
    (name) => {
      const preset = AUTONOMY_PRESETS[name];
      for (const gate of GATE_TYPES) {
        if (ALWAYS_ASK_HARD_SET.has(gate)) {
          // gateRequired must be true (asks) for every hard gate, under every preset.
          expect(presetGateRequired(preset, gate)).toBe(true);
        }
      }
    }
  );

  it("CONTROL: a preset that auto-continues a protected gate WITHOUT a grant is REJECTED", () => {
    // 'release' would auto-continue here only if granted; we instead try to grant a hard gate
    // autonomy (auto-safe) — AC21 must reject it.
    const violating: AutonomyPreset = {
      ...AUTONOMY_PRESETS.standard,
      guild_gates: { plan: "auto-safe", release: "auto-safe" } as AutonomyPreset["guild_gates"],
    };
    const r = validateAutonomyPreset(violating);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /AC21/.test(e))).toBe(true);
  });

  it("CONTROL: a preset naming an always-ask hard gate with autonomy is REJECTED", () => {
    const violating: AutonomyPreset = {
      ...AUTONOMY_PRESETS.standard,
      guild_gates: { plan: "auto-safe", qa: "auto-safe", security: "auto-safe" } as AutonomyPreset["guild_gates"],
    };
    expect(validateAutonomyPreset(violating).valid).toBe(false);
  });
});

describe("SC-W3-2 (2) — no auto_approve axis (the bypass path is closed)", () => {
  it("REJECTS a preset carrying an auto_approve key", () => {
    const withAuto = { ...AUTONOMY_PRESETS.standard, auto_approve: ["build"] } as unknown;
    const r = validateAutonomyPreset(withAuto);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /auto_approve/.test(e))).toBe(true);
  });

  it("the bypass preset's gate posture is IDENTICAL to standard (host bypass ≠ gate bypass)", () => {
    const std = expandPreset(AUTONOMY_PRESETS.standard).gates.map((g) => [g.gate_type, g.required]);
    const byp = expandPreset(AUTONOMY_PRESETS.bypass).gates.map((g) => [g.gate_type, g.required]);
    expect(byp).toEqual(std);
    expect(AUTONOMY_PRESETS.bypass.host_mode).toBe("bypass_all"); // host axis differs
  });
});

describe("SC-W3-2 (3) — default-equivalent preset ⇒ writes:[]", () => {
  it("conservative (default posture) plans NO writes against an empty config", () => {
    const plan = planPresetWrite(AUTONOMY_PRESETS.conservative, {}, "project", NOW);
    expect(plan.rejected).toBe(false);
    expect(plan.writes).toEqual([]);
  });

  it("CONTROL: a NON-default preset (standard) DOES write (proves the no-op skip is real)", () => {
    const plan = planPresetWrite(AUTONOMY_PRESETS.standard, {}, "project", NOW);
    expect(plan.rejected).toBe(false);
    expect(plan.writes.length).toBeGreaterThan(0);
    // every written field carries provenance "user".
    for (const w of plan.writes) expect(w.provenance).toBe("user");
  });
});

describe("SC-W3-2 (4) — never-clobber a user-set sibling", () => {
  it("a user-set host_mode is SKIPPED (recorded), never overwritten", () => {
    const current: Record<string, MaterializedField> = {
      host_mode: { key: "host_mode", value: "ask", provenance: "user", last_reconciled_at: NOW },
    };
    // standard wants host_mode "accept_edits"; the user already set "ask" → never-clobber.
    const plan = planPresetWrite(AUTONOMY_PRESETS.standard, current, "project", NOW);
    expect(plan.skipped_user_keys).toContain("host_mode");
    expect(plan.writes.some((w) => w.key === "host_mode")).toBe(false);
  });

  it("schema_version constant is the frozen v1", () => {
    expect(AUTONOMY_PRESET_SCHEMA_VERSION).toBe("guild.autonomy_preset.v1");
  });
});
