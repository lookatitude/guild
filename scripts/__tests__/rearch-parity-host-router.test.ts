/**
 * scripts/__tests__/rearch-parity-host-router.test.ts
 *
 * W3 parity test — host-router.ts split into capability/{router,rank,tiebreak}.ts
 *
 * Asserts that the shim re-export surface is API-equivalent to the pre-split
 * surface. Imports via the ORIGINAL path (scripts/lib/host-router) to verify
 * the shim resolves correctly.
 *
 * Anti-vacuity control: the control case mutates a key input and asserts the
 * result DIFFERS from the baseline, proving the tests are not trivially passing.
 *
 * // @control: anti-vacuity-control (see bottom of file)
 */

import {
  route,
  resolveModel,
  resolveModelParams,
  affinityBoost,
  backendForMode,
  planTeamRouting,
  getDefaultModelTierMap,
  RouteError,
  type RoutableHost,
  type LaneRequest,
} from "../lib/host-router"; // ORIGINAL path — the shim
import * as hostRouterExports from "../lib/host-router";
// hostKindRank moved to capability/tiebreak during the W3 split. The codex G-lane caught a real
// behavior drift here (it had been re-inlined as a registry-prefix check instead of isClaudeHost),
// which the original happy-path parity assertions missed — so this test pins the TIEBREAK ORDERING.
import { hostKindRank } from "../lib/capability/tiebreak";
import { isClaudeHost } from "../lib/capability/rank";

// Fixed clock
const NOW = Date.parse("2026-05-26T12:00:00Z");
const FRESH = "2026-05-26T11:59:00Z";

function makeHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  return {
    schema_version: "guild.host_capability.v1",
    host_id: "claude",
    host_kind: "claude",
    advertised_at: FRESH,
    source: "test",
    supported_tiers: ["cheap", "mid", "powerful"],
    tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    tool_support: {
      agent_team: true,
      independent_agents: true,
      subagent: true,
      mcp: true,
      computer_use: false,
      large_context: true,
    },
    ...overrides,
  } as RoutableHost;
}

const BASIC_LANE: LaneRequest = {
  taskId: "task-1",
  tier: "mid",
  mode: "auto",
};

describe("host-router shim — parity after W3 split", () => {
  // ── shim exports all expected symbols ──────────────────────────────────────
  it("exports route()", () => expect(typeof route).toBe("function"));
  it("exports resolveModel()", () => expect(typeof resolveModel).toBe("function"));
  it("exports resolveModelParams()", () => expect(typeof resolveModelParams).toBe("function"));
  it("exports affinityBoost()", () => expect(typeof affinityBoost).toBe("function"));
  it("exports backendForMode()", () => expect(typeof backendForMode).toBe("function"));
  it("exports planTeamRouting()", () => expect(typeof planTeamRouting).toBe("function"));
  it("exports getDefaultModelTierMap()", () => expect(typeof getDefaultModelTierMap).toBe("function"));
  it("exports RouteError class", () => expect(typeof RouteError).toBe("function"));
  it("exports the exact original runtime shim surface (no helper leaks)", () => {
    expect(Object.keys(hostRouterExports).sort()).toEqual([
      "RouteError",
      "affinityBoost",
      "backendForMode",
      "getDefaultModelTierMap",
      "planTeamRouting",
      "resolveModel",
      "resolveModelParams",
      "route",
    ]);
  });

  // ── route() — basic decision ────────────────────────────────────────────────
  it("route() returns a RoutingDecision for a qualifying host", () => {
    const h = makeHost();
    const decision = route(BASIC_LANE, [h], { now: NOW });
    expect(decision.host).toBe("claude");
    expect(decision.tier).toBe("mid");
    expect(decision.degraded).toBe(false);
    // T7-H2: the router never self-asserts strong independence — that verdict
    // exists only as a written §7a adjudication over both parties' finalized
    // receipts. `hostDiversity` carries the honest host-axis fact instead.
    expect(decision.independence).toBe("weak");
    expect(decision.model).toBe("sonnet");
  });

  it("route() throws RouteError when host list is empty", () => {
    expect(() => route(BASIC_LANE, [], { now: NOW })).toThrow(RouteError);
  });

  it("route() degrades (not throws) when hosts present but none qualify", () => {
    // Capability gap (missing tier support), NOT a policy exclusion — the host
    // stays policy-eligible so degrade-not-throw still applies. (A staleness/
    // cross-host POLICY exclusion is a hard filter now — see the anti-vacuity
    // control below — and would throw instead.)
    const limitedHost = makeHost({
      supported_tiers: ["cheap"],
      tier_models: { cheap: "haiku", mid: "", powerful: "" },
    });
    const decision = route(BASIC_LANE, [limitedHost], { now: NOW });
    expect(decision.degraded).toBe(true);
    expect(decision.independence).toBe("weak");
  });

  // ── resolveModel() ─────────────────────────────────────────────────────────
  it("resolveModel() returns tier model from manifest", () => {
    const h = makeHost();
    expect(resolveModel("cheap", h)).toBe("haiku");
    expect(resolveModel("mid", h)).toBe("sonnet");
    expect(resolveModel("powerful", h)).toBe("opus");
  });

  // ── resolveModelParams() ───────────────────────────────────────────────────
  it("resolveModelParams() returns { model } object", () => {
    const h = makeHost();
    const p = resolveModelParams("mid", h);
    expect(p).toHaveProperty("model", "sonnet");
  });

  // ── affinityBoost() ────────────────────────────────────────────────────────
  it("affinityBoost() returns 10 for interactive_lifecycle + claude host", () => {
    expect(affinityBoost("interactive_lifecycle", "claude")).toBe(10);
  });
  it("affinityBoost() returns 0 for interactive_lifecycle + codex host", () => {
    expect(affinityBoost("interactive_lifecycle", "codex")).toBe(0);
  });

  // ── backendForMode() ───────────────────────────────────────────────────────
  it("backendForMode(team) = agent_team", () => expect(backendForMode("team")).toBe("agent_team"));
  it("backendForMode(agent) = independent_agents", () => expect(backendForMode("agent")).toBe("independent_agents"));

  // — tiebreak ordering (the codex G-lane drift class) —
  // hostKindRank MUST rank a claude host ahead of (lower than) a non-claude host, and MUST be
  // defined in terms of isClaudeHost (not an inlined registry-prefix check). The drift codex
  // caught changed exactly this branch; these assertions fail if it regresses.
  it("hostKindRank ranks claude (0) ahead of non-claude (1)", () => {
    expect(hostKindRank("claude" as never)).toBe(0);
    expect(hostKindRank("codex" as never)).toBe(1);
  });
  it("hostKindRank agrees with isClaudeHost for every kind (anti-drift control)", () => {
    for (const k of ["claude", "codex", "pi", "antigravity"] as const) {
      // the rank is fully determined by isClaudeHost — if a future inline check diverges
      // for any kind, rank(k) and the isClaudeHost-derived expectation disagree → fail.
      expect(hostKindRank(k as never)).toBe(isClaudeHost(k as never) ? 0 : 1);
    }
  });
  it("backendForMode(subagent) = subagent", () => expect(backendForMode("subagent")).toBe("subagent"));
  it("backendForMode(auto) = null", () => expect(backendForMode("auto")).toBe(null));

  // ── getDefaultModelTierMap() ───────────────────────────────────────────────
  it("getDefaultModelTierMap returns claude defaults for 'claude'", () => {
    const m = getDefaultModelTierMap("claude");
    expect(m.cheap).toBe("haiku");
    expect(m.mid).toBe("sonnet");
    expect(m.powerful).toBe("opus");
  });

  // ── planTeamRouting() ──────────────────────────────────────────────────────
  it("planTeamRouting() maps specialists to backend routes", () => {
    const h = makeHost();
    const routes = planTeamRouting(
      [{ name: "backend", scope: "api layer", dependsOn: [] }],
      [h],
      { now: NOW, localHostId: "claude" }
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].specialist).toBe("backend");
    expect(routes[0].backend).toBe("tmux"); // same host as localHostId
  });

  // ── RouteError ─────────────────────────────────────────────────────────────
  it("RouteError carries taskId and rejected list", () => {
    const err = new RouteError("task-x", []);
    expect(err.taskId).toBe("task-x");
    expect(err.rejected).toEqual([]);
    expect(err.name).toBe("RouteError");
  });

  // ── Anti-vacuity control ───────────────────────────────────────────────────
  // @control: anti-vacuity-control
  // Proves the tests are not trivially passing: a STALE host produces a DIFFERENT
  // outcome (degraded decision) than the baseline fresh host. If route() were a
  // no-op, both would produce the same result.
  it("ANTI-VACUITY CONTROL: stale host is hard-policy-excluded — throws, unlike the fresh baseline", () => {
    const fresh = makeHost({ advertised_at: FRESH });
    const stale = makeHost({ advertised_at: "2020-01-01T00:00:00Z" });
    const freshDecision = route(BASIC_LANE, [fresh], { now: NOW });
    // Fresh → succeeds, not degraded.
    expect(freshDecision.degraded).toBe(false);
    expect(freshDecision.independence).toBe("weak"); // T7-H2 — never strong from the router
    // Stale manifest is a hard POLICY gate (untrustworthy data), not a soft
    // capability gap — no policy-eligible host remains, so route() throws
    // rather than silently degrading to it. Different outcomes (value vs.
    // exception) prove non-vacuity.
    expect(() => route(BASIC_LANE, [stale], { now: NOW })).toThrow(RouteError);
  });
});
