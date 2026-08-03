/**
 * scripts/__tests__/rearch-parity-read-guild-config.test.ts
 *
 * W3 parity test — read-guild-config.ts split into core/config-cli.ts
 *
 * Imports via ORIGINAL path (scripts/read-guild-config) to verify the shim resolves.
 * Anti-vacuity control: validateModels produces DIFFERENT results for valid vs invalid input.
 *
 * // @control: anti-vacuity-control (see bottom of file)
 */

import {
  validateModels,
  validateSecurity,
  validateSecretsPolicy,
  validateMcp,
  validateRoles,
  validateCrossHostBlock,
  validateDefaults,
  scaffold,
  DEFAULTS,
  HELP,
  type TierModelSpec,
  type ResolvedTierModel,
} from "../read-guild-config"; // ORIGINAL path — the shim
import * as readGuildConfigExports from "../read-guild-config";

describe("read-guild-config shim — parity after W3 split", () => {
  // ── shim exports expected symbols ─────────────────────────────────────────
  it("exports validateModels()", () => expect(typeof validateModels).toBe("function"));
  it("exports validateSecurity()", () => expect(typeof validateSecurity).toBe("function"));
  it("exports validateSecretsPolicy()", () => expect(typeof validateSecretsPolicy).toBe("function"));
  it("exports validateMcp()", () => expect(typeof validateMcp).toBe("function"));
  it("exports validateRoles()", () => expect(typeof validateRoles).toBe("function"));
  it("exports validateCrossHostBlock()", () => expect(typeof validateCrossHostBlock).toBe("function"));
  it("exports validateDefaults()", () => expect(typeof validateDefaults).toBe("function"));
  it("exports scaffold()", () => expect(typeof scaffold).toBe("function"));
  it("exports DEFAULTS", () => expect(DEFAULTS).toBeDefined());
  it("exports HELP", () => expect(HELP).toBeDefined());
  it("exports the exact original runtime shim surface (no __main leak)", () => {
    // This list is a PIN, not a description: it exists so an accidental export (a
    // `__main` leak, an internal helper) is caught. An ADDITION is therefore a
    // deliberate act that must be recorded here, which is exactly what happened for
    // validateCapability below — the pin did its job.
    expect(Object.keys(readGuildConfigExports).sort()).toEqual([
      "DEFAULTS",
      "HELP",
      "scaffold",
      "resolveTierModel",
      // S5 (cap-loc-D04): config-cmd.ts's raw-file sweep needs the capability content
      // validator through the same single-SoT entrypoint every other block uses, so
      // the vocabulary cannot fork. Additive; nothing was removed or renamed.
      "validateCapability",
      "validateCrossHostBlock",
      "validateDefaults",
      "validateHostProfiles",
      "validateMcp",
      "validateModels",
      "validateRoles",
      "validateSecretsPolicy",
      "validateSecurity",
    ].sort());
  });

  it("exports validateCapability()", () =>
    expect(typeof readGuildConfigExports.validateCapability).toBe("function"));

  // ── DEFAULTS sanity ────────────────────────────────────────────────────────
  it("DEFAULTS.rigor = 'standard'", () => expect(DEFAULTS.rigor).toBe("standard"));
  it("DEFAULTS.loop_cap = 16", () => expect(DEFAULTS.loop_cap).toBe(16));
  it("DEFAULTS.review = 'local'", () => expect(DEFAULTS.review).toBe("local"));

  // ── HELP sanity ────────────────────────────────────────────────────────────
  it("HELP.rigor is a non-empty string", () => {
    expect(typeof HELP["rigor"]).toBe("string");
    expect(HELP["rigor"]!.length).toBeGreaterThan(0);
  });

  // ── validateModels() ───────────────────────────────────────────────────────
  it("validateModels() passes on an empty object (all optional)", () => {
    const errs = validateModels({});
    expect(errs).toHaveLength(0);
  });
  it("validateModels() rejects an unknown top-level models key", () => {
    const errs = validateModels({ unknown_key_xyz: true });
    expect(errs.some(e => e.includes("unknown_key_xyz"))).toBe(true);
  });

  // ── validateSecurity() ────────────────────────────────────────────────────
  it("validateSecurity() passes bypass_permissions_policy='audit'", () => {
    const errs = validateSecurity({ bypass_permissions_policy: "audit" });
    expect(errs).toHaveLength(0);
  });
  it("validateSecurity() rejects invalid bypass_permissions_policy", () => {
    const errs = validateSecurity({ bypass_permissions_policy: "INVALID" });
    expect(errs.length).toBeGreaterThan(0);
  });

  // ── validateRoles() ───────────────────────────────────────────────────────
  it("validateRoles() passes a valid roles object", () => {
    const errs = validateRoles({ host: "claude", advisory: null, adversarial: null });
    expect(errs).toHaveLength(0);
  });

  // ── scaffold() ────────────────────────────────────────────────────────────
  it("scaffold() returns a non-empty JSON string with all DEFAULTS keys", () => {
    const s = scaffold();
    expect(s.length).toBeGreaterThan(0);
    const parsed = JSON.parse(s) as Record<string, unknown>;
    expect(parsed).toHaveProperty("rigor");
    expect(parsed).toHaveProperty("loop_cap");
  });

  // ── Anti-vacuity control ───────────────────────────────────────────────────
  // @control: anti-vacuity-control
  // validateModels() returns ZERO errors for a valid input and NON-ZERO for an
  // invalid one. If it were a no-op, both would return empty — this control proves
  // the validator actually executes.
  it("ANTI-VACUITY CONTROL: validateModels() gives DIFFERENT results for valid vs invalid", () => {
    const validErrs = validateModels({ enabled: true });
    const invalidErrs = validateModels({ enabled: true, bogus_key_xyzzy: "bad" });
    expect(validErrs).toHaveLength(0);
    expect(invalidErrs.length).toBeGreaterThan(0);
    expect(invalidErrs.some(e => e.includes("bogus_key_xyzzy"))).toBe(true);
  });
});
