/**
 * scripts/__tests__/host-router-registry-expanded.test.ts
 *
 * P1-L7 (operator-mandated expansion) — characterizes the registry-unification of
 * host-router.ts + team-backend.ts host-IDENTITY reads across ALL 9 HostKinds, not
 * just the Claude/Codex SC-4 surface.
 *
 * Two jobs:
 *  1. REGRESSION GUARD — the 81-case matrix (binaryForHostKind, affinityBoost,
 *     route() over a claude+<kind> pair, cross on/off) must match the POST golden.
 *  2. INTENT LEDGER — the unification routes identity through the registry's
 *     HostKind→id bridge, which family-collapses the NON-canonical variant kinds
 *     (claude-code-desktop/web, claude-ai-connector → claude; codex-app → codex).
 *     This file asserts BOTH that the canonical kinds + binaryForHostKind stay
 *     byte-identical to the original literals AND that the 16 variant deltas are the
 *     intended family-correct behavior — so the change is documented, not silent.
 *
 * The Claude/Codex byte-identical guarantee (SC-4) is proven separately, exhaustively,
 * by host-registry-ab.test.ts (214/214). This file is the broader-than-SC-4 ledger.
 */

import * as fs from "fs";
import * as path from "path";
import {
  route,
  affinityBoost,
  type RoutableHost,
  type WorkType,
} from "../lib/host-router";
import { binaryForHostKind } from "../lib/team-backend";
import type { HostKind } from "../lib/host-types";
import type { HostCapabilityManifest } from "../write-host-capability";
import { canonicalJSON } from "../lib/routing-ab-contract";

const NOW = Date.parse("2026-06-15T12:00:00Z");
const FRESH = "2026-06-15T11:59:00Z";

// gemini was sunset 2026-06-14 and removed from HostKind — no longer in the matrix.
const KINDS: HostKind[] = [
  "claude",
  "codex",
  "pi",
  "antigravity-2",
  "claude-code-desktop",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
];
const WT: Array<WorkType | undefined> = [
  undefined,
  "adversarial_review",
  "background_implementation",
  "interactive_lifecycle",
  "parallel_local_lanes",
  "graph_extraction",
];

function mani(hk: HostKind): RoutableHost {
  const b: HostCapabilityManifest = {
    schema_version: "guild.host_capability.v1",
    host_id: hk,
    host_kind: hk,
    advertised_at: FRESH,
    source: "x",
    tier_models: { cheap: "c", mid: "m", powerful: "p" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["c", "m", "p"],
    tool_support: {
      subagent: true,
      agent_team: true,
      independent_agents: true,
      tmux: true,
      mcp: true,
      pre_tool_use_ask: true,
    },
  };
  return b as RoutableHost;
}

function runExpandedMatrix(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const hk of KINDS) {
    out[`bin:${hk}`] = canonicalJSON(binaryForHostKind(hk));
    for (const wt of WT) out[`aff:${wt ?? "none"}:${hk}`] = canonicalJSON(affinityBoost(wt, hk));
  }
  for (const hk of KINDS) {
    for (const cross of [false, true]) {
      const d = route(
        { taskId: "t", tier: "mid", mode: "auto", workType: "adversarial_review" },
        [mani("claude"), mani(hk)],
        { now: NOW, crossHostEnabled: cross }
      );
      out[`route2:${hk}:cross=${cross}`] = canonicalJSON(d);
    }
  }
  return out;
}

const GOLDEN_PATH = path.join(__dirname, "fixtures", "routing-expanded-golden.json");

describe("P1-L7 expanded host-identity unification (all 8 HostKinds)", () => {
  const actual = runExpandedMatrix();
  // Regenerate after an intentional HostKind change (the gemini sunset dropped a kind):
  // UPDATE_GOLDEN=1.
  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + "\n");
  }
  const golden: Record<string, string> = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));

  it("matches the POST golden (regression guard)", () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
    const drift: string[] = [];
    for (const [k, v] of Object.entries(golden)) if (actual[k] !== v) drift.push(k);
    expect(drift).toEqual([]);
  });

  // binaryForHostKind is registry-anchored with 3 documented overrides — byte-identical
  // to the ORIGINAL literal switch for every HostKind.
  it("binaryForHostKind is byte-identical to the pre-registry literals (all 8 kinds)", () => {
    const expected: Record<HostKind, string> = {
      claude: "claude",
      codex: "codex",
      pi: "pi",
      "antigravity-2": "agy",
      "claude-code-desktop": "claude",
      "claude-code-web": "claude",
      "codex-app": "claude", // preserved latent quirk (was default-fallthrough)
      "claude-ai-connector": "claude",
    };
    for (const hk of KINDS) expect(binaryForHostKind(hk)).toBe(expected[hk]);
  });

  // The canonical kinds (the SC-4 surface + the unchanged-family kinds) keep their
  // exact original affinity — the unification touched ONLY variant kinds.
  it("canonical HostKinds keep their original affinity (no drift)", () => {
    expect(affinityBoost("interactive_lifecycle", "claude")).toBe(10);
    expect(affinityBoost("adversarial_review", "claude")).toBe(0);
    expect(affinityBoost("adversarial_review", "codex")).toBe(10);
    expect(affinityBoost("background_implementation", "codex")).toBe(10);
    // pi/antigravity-2 are non-claude, non-codex → unchanged by the collapse.
    expect(affinityBoost("adversarial_review", "antigravity-2")).toBe(10);
    expect(affinityBoost("background_implementation", "antigravity-2")).toBe(0);
    expect(affinityBoost("interactive_lifecycle", "pi")).toBe(0);
  });

  // INTENT LEDGER: the registry now classifies the variant kinds into their families.
  // This is the deliberate unification (was the parallel-source gap). Documented here
  // as assertions so the behavior is intentional + reviewable, not silent.
  it("variant HostKinds now resolve to their registry family (intended unification)", () => {
    // claude-* variants are claude-family → claude affinities, NOT the non-claude path.
    for (const v of ["claude-code-desktop", "claude-code-web", "claude-ai-connector"] as HostKind[]) {
      expect(affinityBoost("interactive_lifecycle", v)).toBe(10); // was 0
      expect(affinityBoost("parallel_local_lanes", v)).toBe(10); // was 0
      expect(affinityBoost("adversarial_review", v)).toBe(0); // was 10 (treated as non-claude)
    }
    // codex-app is codex-family → gets the background_implementation boost.
    expect(affinityBoost("background_implementation", "codex-app")).toBe(10); // was 0
    // And the cross-host-OFF filter now admits a claude-* variant as claude-family
    // (was rejected as non-claude). route() primary is claude; the variant qualifies.
    const offDecision = JSON.parse(actual["route2:claude-code-desktop:cross=false"]);
    expect(offDecision.rejected).toEqual([]); // was a cross-host rejection
    expect(offDecision.fallbackChain.length).toBe(1);
  });
});
