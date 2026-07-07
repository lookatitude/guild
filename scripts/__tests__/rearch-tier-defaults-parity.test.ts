/**
 * scripts/__tests__/rearch-tier-defaults-parity.test.ts
 *
 * W4 D2 — Parity test for `tierDefaults()` (M2/M6 single-source proof).
 *
 * Asserts: the computed tier→model map from `tierDefaults()` / `tierDefaultsForHost()`
 * equals the prior hard-typed literals for all 9 HostKinds across all 3 tiers.
 *
 * The three prior literals being replaced:
 *   1. rank.ts      claudeDefaults { cheap:"haiku", mid:"sonnet", powerful:"opus" } for every host
 *   2. write-host-capability.ts  DEFAULT_TIER_MODELS (same values)
 *   3. score-tier.ts DEFAULT_TIERS { cheap:{claude:"haiku",codex:null,...}, ... }
 *
 * Anti-vacuity control: a synthetic host row with a DIVERGENT tier model is injected
 * into the descriptors; the test asserts that the computed map DIFFERS from the baseline,
 * proving the computation reads the registry (not a stale constant). A test that always
 * returns the same constant regardless of input would be trivially passing and must fail
 * this control.
 *
 * Ordering + edge coverage:
 *   - all 9 HostKind values (not just claude)
 *   - all 3 tiers (cheap, mid, powerful)
 *   - null-model slots (codex in DEFAULT_TIERS) preserved as null in defaultTiersMap
 *   - gemini (dropped D10, no registry row) falls back to CLAUDE_TIER_FALLBACK
 *
 * // @control: anti-vacuity-control (divergent synthetic row)
 */

import {
  tierDefaults,
  tierDefaultsForHost,
  defaultTierModels,
  defaultTiersMap,
  CLAUDE_TIER_FALLBACK,
} from "../lib/capability/tier-defaults";
import { HOST_REGISTRY_ROWS } from "../lib/host-registry-schema";
import type { HostRegistryEntry } from "../lib/host-registry-schema";

// ── Prior literal values (the baselines we're replacing) ─────────────────────

/** The prior claude defaults — every host returned these in the old switch. */
const PRIOR_CLAUDE_DEFAULTS = { cheap: "haiku", mid: "sonnet", powerful: "opus" };

/** The prior DEFAULT_TIERS from score-tier.ts. */
const PRIOR_DEFAULT_TIERS = {
  cheap:    { claude: "haiku",  codex: null },
  mid:      { claude: "sonnet", codex: null },
  powerful: { claude: "opus",   codex: null },
};

// ── Parity: tierDefaultsForHost() matches prior literals ─────────────────────

describe("W4 D2 parity: tierDefaultsForHost() == prior hand-typed claudeDefaults", () => {
  const ALL_HOST_KINDS = [
    "claude",
    "codex",
    "gemini", // the sunset host (2026-06-14) — retained to verify a DROPPED kind still falls back to claudeDefaults
    "pi",
    "antigravity-2",
    "claude-code-desktop",
    "claude-code-web",
    "codex-app",
    "claude-ai-connector",
  ] as const;

  for (const hk of ALL_HOST_KINDS) {
    it(`${hk}: computed == prior claudeDefaults for all 3 tiers`, () => {
      const computed = tierDefaultsForHost(hk as never);
      // Every host kind (including the sunset gemini, as a dropped-kind fallback) returns
      // claudeDefaults regardless of host. Verify the computed result matches that expectation.
      expect(computed.cheap).toBe(PRIOR_CLAUDE_DEFAULTS.cheap);
      expect(computed.mid).toBe(PRIOR_CLAUDE_DEFAULTS.mid);
      expect(computed.powerful).toBe(PRIOR_CLAUDE_DEFAULTS.powerful);
    });
  }
});

// ── Parity: defaultTierModels() matches prior DEFAULT_TIER_MODELS ─────────────

describe("W4 D2 parity: defaultTierModels() == prior DEFAULT_TIER_MODELS", () => {
  it("cheap tier", () => expect(defaultTierModels().cheap).toBe(PRIOR_CLAUDE_DEFAULTS.cheap));
  it("mid tier",   () => expect(defaultTierModels().mid).toBe(PRIOR_CLAUDE_DEFAULTS.mid));
  it("powerful tier", () => expect(defaultTierModels().powerful).toBe(PRIOR_CLAUDE_DEFAULTS.powerful));
});

// ── Parity: defaultTiersMap() matches prior DEFAULT_TIERS for the slots that existed ──

describe("W4 D2 parity: defaultTiersMap() slots match prior DEFAULT_TIERS", () => {
  const computed = defaultTiersMap();

  it("cheap.claude == prior 'haiku'", () => expect(computed.cheap["claude"]).toBe(PRIOR_DEFAULT_TIERS.cheap.claude));
  it("mid.claude == prior 'sonnet'",  () => expect(computed.mid["claude"]).toBe(PRIOR_DEFAULT_TIERS.mid.claude));
  it("powerful.claude == prior 'opus'", () => expect(computed.powerful["claude"]).toBe(PRIOR_DEFAULT_TIERS.powerful.claude));

  // codex: the registry row has model: null for all tiers → preserved as null (not claude fallback)
  it("cheap.codex == prior null (no Guild model mapped)",    () => expect(computed.cheap["codex"]).toBeNull());
  it("mid.codex == prior null",   () => expect(computed.mid["codex"]).toBeNull());
  it("powerful.codex == prior null", () => expect(computed.powerful["codex"]).toBeNull());
});

// ── CLAUDE_TIER_FALLBACK matches the Claude registry row ─────────────────────

describe("W4 D2: CLAUDE_TIER_FALLBACK matches registry", () => {
  const claudeRow = HOST_REGISTRY_ROWS["claude-code-cli"];
  it("fallback.cheap == claude row models.cheap.model", () =>
    expect(CLAUDE_TIER_FALLBACK.cheap).toBe(claudeRow.capabilities.models.cheap.model));
  it("fallback.mid == claude row models.mid.model", () =>
    expect(CLAUDE_TIER_FALLBACK.mid).toBe(claudeRow.capabilities.models.mid.model));
  it("fallback.powerful == claude row models.powerful.model", () =>
    expect(CLAUDE_TIER_FALLBACK.powerful).toBe(claudeRow.capabilities.models.powerful.model));
});

// ── Anti-vacuity control ──────────────────────────────────────────────────────
// @control: anti-vacuity-control (divergent synthetic row)
// Inject a synthetic registry row with a DIFFERENT model at "cheap" and assert
// that the computed map reflects the injected value (not the constant fallback).
// A test that always returns the constant regardless of input FAILS this control.

describe("W4 D2 anti-vacuity control: divergent synthetic row is detected", () => {
  // Build a synthetic descriptors map: clone the real rows but replace claude's cheap model.
  const syntheticClaudeRow: HostRegistryEntry = {
    ...HOST_REGISTRY_ROWS["claude-code-cli"],
    capabilities: {
      ...HOST_REGISTRY_ROWS["claude-code-cli"].capabilities,
      models: {
        cheap: { model: "haiku-SYNTHETIC" },  // divergent!
        mid: { model: "sonnet" },
        powerful: { model: "opus" },
      },
    },
  };
  const syntheticDescriptors = {
    ...HOST_REGISTRY_ROWS,
    "claude-code-cli": syntheticClaudeRow,
  };

  it("cheap tier with synthetic row reflects injected model (not constant)", () => {
    const computed = tierDefaultsForHost("claude" as never, syntheticDescriptors);
    // MUST differ from the real baseline — proves computation reads the registry
    expect(computed.cheap).toBe("haiku-SYNTHETIC");
    expect(computed.cheap).not.toBe(PRIOR_CLAUDE_DEFAULTS.cheap);
  });

  it("mid/powerful tiers with synthetic row are unchanged (control is scoped)", () => {
    const computed = tierDefaultsForHost("claude" as never, syntheticDescriptors);
    expect(computed.mid).toBe(PRIOR_CLAUDE_DEFAULTS.mid);
    expect(computed.powerful).toBe(PRIOR_CLAUDE_DEFAULTS.powerful);
  });

  it("defaultTierModels with synthetic descriptors reflects injected cheap model", () => {
    const computed = defaultTierModels(syntheticDescriptors);
    expect(computed.cheap).toBe("haiku-SYNTHETIC");
  });

  it("defaultTiersMap with synthetic descriptors reflects injected cheap.claude model", () => {
    const map = defaultTiersMap(syntheticDescriptors);
    expect(map.cheap["claude"]).toBe("haiku-SYNTHETIC");
  });
});
