/**
 * scripts/__tests__/config-defaults-tiers-host-ids.test.ts
 *
 * G4b (host-reachability) — guard test. config-defaults.ts's DEFAULTS.models.tiers
 * is a hand-written literal (the file cannot import HOST_IDS at runtime — see its
 * own doc comment: it must stay free of internal runtime imports so core settings
 * code can load it before the host-runtime layer). That literal previously carried
 * only 9 of the registry's 16 host ids — cursor/github-copilot/opencode/rovo-dev/
 * kiro/qoder/trae had no tier slot at all. This test is the drift guard: it asserts
 * the literal's key set is EXACTLY HOST_IDS, for every tier, so the two can never
 * silently diverge again.
 */

import { DEFAULTS } from "../lib/shared/config-defaults";
import { HOST_IDS } from "../lib/host-registry-schema";

describe("config-defaults DEFAULTS.models.tiers — every registry HOST_ID has a slot", () => {
  const expectedKeys = [...HOST_IDS].sort();

  for (const tier of ["cheap", "mid", "powerful"] as const) {
    it(`tiers.${tier} carries exactly the 16 HOST_IDS keys`, () => {
      const keys = Object.keys(DEFAULTS.models.tiers[tier]).sort();
      expect(keys).toEqual(expectedKeys);
    });
  }

  it("only claude-code-cli has non-null defaults (every other registry row's model is null today)", () => {
    expect(DEFAULTS.models.tiers.cheap["claude-code-cli"]).toBe("haiku");
    expect(DEFAULTS.models.tiers.mid["claude-code-cli"]).toBe("sonnet");
    expect(DEFAULTS.models.tiers.powerful["claude-code-cli"]).toBe("opus");
    for (const id of HOST_IDS) {
      if (id === "claude-code-cli") continue;
      expect(DEFAULTS.models.tiers.cheap[id]).toBeNull();
      expect(DEFAULTS.models.tiers.mid[id]).toBeNull();
      expect(DEFAULTS.models.tiers.powerful[id]).toBeNull();
    }
  });

  it("non-vacuity: HOST_IDS itself is non-empty and has more than the original 9 (else this guard proves nothing)", () => {
    expect(HOST_IDS.length).toBeGreaterThan(9);
  });
});
