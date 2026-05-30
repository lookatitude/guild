/**
 * scripts/__tests__/host-router.test.ts
 *
 * Cluster A — capability routing function (cross-host ADR §CR-1..CR-6).
 *
 * Covers the decision matrix:
 *   - 3-axis filter (mode→backend × tier × host) + capability pre-check (CR-1/CR-2).
 *   - null codex/gemini tier-slot fill via the merge precedence (CR-1 step 4 /
 *     "Null tier-slot fill"): settings override → manifest tiers → built-in.
 *   - ranked fallback chain with NO silent tier downgrade (CR-3).
 *   - work-type → host affinity soft ranking (CR-4).
 *   - manifest freshness TTL exclusion (CR-5).
 *   - cross_host.enabled=false ⇒ Claude-only behavior.
 *   - telemetry spend stub invoked (CR-6); budget cap deferred.
 *   - RouteError when nothing qualifies; determinism.
 *
 * Reads the REAL guild.host_capability.v1 shape from write-host-capability.ts.
 */

import {
  route,
  resolveModel,
  affinityBoost,
  backendForMode,
  RouteError,
  type RoutableHost,
  type LaneRequest,
  type RoutingDecision,
} from "../lib/host-router";
import type { HostCapabilityManifest } from "../write-host-capability";

// Fixed clock so freshness math is deterministic.
const NOW = Date.parse("2026-05-26T12:00:00Z");
const FRESH = "2026-05-26T11:59:00Z"; // 1 min ago
const STALE = "2026-05-26T10:00:00Z"; // 2 h ago (> 1 h default TTL)

function host(overrides: Partial<RoutableHost> = {}): RoutableHost {
  const base: HostCapabilityManifest = {
    schema_version: "guild.host_capability.v1",
    host_id: "claude",
    host_kind: "claude",
    detected_at: FRESH,
    source: "test",
    tiers: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    models: ["haiku", "sonnet", "opus"],
    tool_support: {
      subagent: true,
      agent_team: true,
      independent_agents: true,
      tmux: true,
      mcp: true,
    },
  };
  return { ...base, ...overrides } as RoutableHost;
}

function codexHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  return host({
    host_id: "codex",
    host_kind: "codex",
    tiers: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" },
    models: ["gpt-4o-mini", "gpt-4o", "o3"],
    tool_support: {
      subagent: true,
      agent_team: false, // codex cannot join the Claude team bus
      independent_agents: false,
      tmux: false,
      mcp: true,
    },
    ...overrides,
  });
}

function lane(overrides: Partial<LaneRequest> = {}): LaneRequest {
  return { taskId: "t-1", tier: "mid", mode: "subagent", ...overrides };
}

const baseOpts = { now: NOW };

describe("backendForMode (mode axis)", () => {
  it("maps D5 modes to the backend capability key", () => {
    expect(backendForMode("team")).toBe("agent_team");
    expect(backendForMode("agent")).toBe("independent_agents");
    expect(backendForMode("subagent")).toBe("subagent");
    expect(backendForMode("auto")).toBeNull(); // no hard requirement
  });
});

describe("affinityBoost (CR-4 soft signal)", () => {
  it("interactive_lifecycle & parallel_local_lanes prefer claude", () => {
    expect(affinityBoost("interactive_lifecycle", "claude")).toBeGreaterThan(0);
    expect(affinityBoost("interactive_lifecycle", "codex")).toBe(0);
    expect(affinityBoost("parallel_local_lanes", "claude")).toBeGreaterThan(0);
  });
  it("adversarial_review prefers a NON-claude host (independence)", () => {
    expect(affinityBoost("adversarial_review", "codex")).toBeGreaterThan(0);
    expect(affinityBoost("adversarial_review", "claude")).toBe(0);
  });
  it("background_implementation prefers codex; graph/unset is neutral", () => {
    expect(affinityBoost("background_implementation", "codex")).toBeGreaterThan(0);
    expect(affinityBoost("graph_extraction", "claude")).toBe(0);
    expect(affinityBoost(undefined, "claude")).toBe(0);
  });
});

describe("resolveModel — null tier-slot fill merge precedence", () => {
  it("manifest tiers fill the model when no override (VC-CR-2)", () => {
    expect(resolveModel("mid", codexHost())).toBe("gpt-4o");
  });
  it("settings.json override beats the manifest (VC-CR-2)", () => {
    const m = resolveModel("mid", codexHost(), { mid: { codex: "gpt-4o-2026" } });
    expect(m).toBe("gpt-4o-2026");
  });
  it("falls back to the built-in claude default when the manifest tier is empty", () => {
    const h = codexHost({ tiers: { cheap: "", mid: "", powerful: "" } });
    expect(resolveModel("powerful", h)).toBe("opus");
  });
});

describe("route — single-host (cross_host disabled, the default)", () => {
  it("routes a claude lane and excludes codex hosts entirely", () => {
    const d = route(lane(), [host(), codexHost()], baseOpts);
    expect(d.host).toBe("claude");
    expect(d.hostKind).toBe("claude");
    expect(d.tier).toBe("mid");
    expect(d.model).toBe("sonnet");
    expect(d.rejected.some((r) => r.hostKind === "codex")).toBe(true);
  });

  it("throws RouteError when only a (filtered-out) codex host is present", () => {
    expect(() => route(lane(), [codexHost()], baseOpts)).toThrow(RouteError);
  });
});

describe("route — cross-host enabled", () => {
  const opts = { ...baseOpts, crossHostEnabled: true };

  it("null-slot fill is operational: a codex 'mid' lane resolves a concrete model", () => {
    const d = route(
      lane({ preferredHostKind: "codex" }),
      [host(), codexHost()],
      opts
    );
    expect(d.hostKind).toBe("codex");
    expect(d.model).toBe("gpt-4o"); // filled from the manifest, not null
  });

  it("adversarial_review affinity ranks codex above claude", () => {
    const d = route(
      lane({ workType: "adversarial_review", tier: "powerful" }),
      [host(), codexHost()],
      opts
    );
    expect(d.hostKind).toBe("codex");
    expect(d.model).toBe("o3");
  });

  it("interactive_lifecycle affinity ranks claude above codex", () => {
    const d = route(lane({ workType: "interactive_lifecycle" }), [codexHost(), host()], opts);
    expect(d.hostKind).toBe("claude");
  });

  it("team.yaml host: preference ranks that host first (subject to pre-check)", () => {
    const d = route(lane({ preferredHostKind: "codex" }), [host(), codexHost()], opts);
    expect(d.hostKind).toBe("codex");
  });

  it("is deterministic — repeated calls return the same primary", () => {
    const l = lane({ workType: "graph_extraction" });
    const hosts = [host(), codexHost()];
    const a = route(l, hosts, opts);
    const b = route(l, hosts, opts);
    expect(a.host).toBe(b.host);
    expect(a.model).toBe(b.model);
  });
});

describe("route — capability pre-check (CR-1/CR-2)", () => {
  const opts = { ...baseOpts, crossHostEnabled: true };

  it("rejects a host lacking the required backend (team → agent_team)", () => {
    // codex lacks agent_team; only claude qualifies for a team lane.
    const d = route(lane({ mode: "team" }), [host(), codexHost()], opts);
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/agent_team/);
  });

  it("rejects a host missing a tier (supported via empty model string)", () => {
    const noPowerful = codexHost({ tiers: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "" } });
    const d = route(lane({ tier: "powerful" }), [host(), noPowerful], opts);
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/tier "powerful"/);
  });

  it("honors an explicit supported_tiers extension when present", () => {
    const limited = codexHost({ supported_tiers: ["cheap"] });
    expect(() =>
      route(lane({ tier: "mid", preferredHostKind: "codex" }), [limited], opts)
    ).toThrow(RouteError);
  });

  it("CR-2 tool pre-check: rejects on a tool_permissions gap, lenient when absent", () => {
    const restricted = codexHost({ tool_permissions: ["Read", "Grep"] });
    const d = route(
      lane({ requiredTools: ["Read", "Bash"], preferredHostKind: "codex" }),
      [host(), restricted],
      opts
    );
    // codex rejected (missing Bash); falls to claude (no allow-list ⇒ lenient).
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/Bash/);
  });
});

describe("route — fallback chain (CR-3, no silent downgrade)", () => {
  const opts = { ...baseOpts, crossHostEnabled: true };

  it("fallback chain holds the SAME tier across every entry", () => {
    const d = route(
      lane({ tier: "powerful", preferredHostKind: "codex" }),
      [host(), codexHost()],
      opts
    );
    expect(d.tier).toBe("powerful");
    expect(d.fallbackChain.length).toBeGreaterThan(0);
    for (const f of d.fallbackChain) expect(f.tier).toBe("powerful"); // never downgraded
  });

  it("demotes a claude fallback to the last resort when fallbackToClaude=true", () => {
    const d = route(
      lane({ workType: "adversarial_review", tier: "mid" }),
      [host(), codexHost()],
      { ...opts, fallbackToClaude: true }
    );
    // codex primary; claude present as the LAST fallback entry (level 4).
    expect(d.hostKind).toBe("codex");
    expect(d.fallbackChain[d.fallbackChain.length - 1].hostKind).toBe("claude");
  });
});

describe("route — manifest freshness (CR-5)", () => {
  const opts = { ...baseOpts, crossHostEnabled: true };

  it("excludes a stale manifest from routing", () => {
    const staleCodex = codexHost({ detected_at: STALE });
    const d = route(lane({ preferredHostKind: "codex" }), [host(), staleCodex], opts);
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/stale/);
  });

  it("honors advertised_at when present (overrides detected_at)", () => {
    const h = codexHost({ detected_at: STALE, advertised_at: FRESH });
    const d = route(lane({ preferredHostKind: "codex" }), [host(), h], opts);
    expect(d.hostKind).toBe("codex"); // fresh via advertised_at
  });

  it("treats a missing/unparseable timestamp as stale", () => {
    const h = host({ detected_at: "" });
    expect(() => route(lane(), [h], opts)).toThrow(RouteError);
  });

  it("a custom TTL re-admits a manifest within the window", () => {
    const h = codexHost({ detected_at: STALE });
    const d = route(lane({ preferredHostKind: "codex" }), [h], {
      ...opts,
      manifestTtlS: 24 * 3600, // 24 h window
    });
    expect(d.hostKind).toBe("codex");
  });
});

describe("route — telemetry spend stub (CR-6) + decision log shape", () => {
  it("invokes onDecision exactly once with the final decision", () => {
    const seen: RoutingDecision[] = [];
    const d = route(lane(), [host()], { ...baseOpts, onDecision: (x) => seen.push(x) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(d);
  });

  it("records the budget-cap deferral note (oc-budget-cap, CR-6)", () => {
    const d = route(lane(), [host()], baseOpts);
    expect(d.notes.join(" ")).toMatch(/budget-cap deferred.*oc-budget-cap/i);
  });

  it("the decision carries the full {host, hostKind, tier, model} + reason", () => {
    const d = route(lane(), [host()], baseOpts);
    expect(d).toMatchObject({
      taskId: "t-1",
      host: "claude",
      hostKind: "claude",
      tier: "mid",
      model: "sonnet",
    });
    expect(typeof d.reason).toBe("string");
    expect(Array.isArray(d.rejected)).toBe(true);
  });
});

describe("route — RouteError detail", () => {
  it("names the rejected hosts and reasons; empty host list is a clear error", () => {
    try {
      route(lane({ mode: "team" }), [codexHost()], { ...baseOpts, crossHostEnabled: true });
      throw new Error("expected RouteError");
    } catch (e) {
      expect(e).toBeInstanceOf(RouteError);
      expect((e as RouteError).rejected.length).toBeGreaterThan(0);
      expect((e as Error).message).toMatch(/agent_team/);
    }
    expect(() => route(lane(), [], baseOpts)).toThrow(RouteError);
  });
});
