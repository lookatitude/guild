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
  planTeamRouting,
  RouteError,
  type RoutableHost,
  type LaneRequest,
  type RoutingDecision,
  type Tier,
  type CapabilityRequirements,
} from "../lib/host-router";
import type { HostCapabilityManifest } from "../write-host-capability";
import type { HostKind } from "../lib/host-types";

// Fixed clock so freshness math is deterministic.
const NOW = Date.parse("2026-05-26T12:00:00Z");
const FRESH = "2026-05-26T11:59:00Z"; // 1 min ago
const STALE = "2026-05-26T10:00:00Z"; // 2 h ago (> 1 h default TTL)

function host(overrides: Partial<RoutableHost> = {}): RoutableHost {
  const base: HostCapabilityManifest = {
    schema_version: "guild.host_capability.v1",
    host_id: "claude",
    host_kind: "claude",
    // TE-07: canonical field name
    advertised_at: FRESH,
    source: "test",
    // TE-07: canonical field name
    tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["haiku", "sonnet", "opus"],
    tool_support: {
      subagent: true,
      agent_team: true,
      independent_agents: true,
      tmux: true,
      mcp: true,
      pre_tool_use_ask: true,
    },
  };
  return { ...base, ...overrides } as RoutableHost;
}

function codexHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  return host({
    host_id: "codex",
    host_kind: "codex",
    // TE-07: canonical field name
    tier_models: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["gpt-4o-mini", "gpt-4o", "o3"],
    tool_support: {
      subagent: true,
      agent_team: false, // codex cannot join the Claude team bus
      independent_agents: false,
      tmux: false,
      mcp: true,
      pre_tool_use_ask: false,
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
    // TE-07: use canonical tier_models field
    const h = codexHost({ tier_models: { cheap: "", mid: "", powerful: "" } });
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

  it("TE-02: degrades (not throws) when only a cross-host-disabled codex is present", () => {
    // codex is filtered by cross_host.enabled=false; no claude host → degrade to codex
    const d = route(lane(), [codexHost()], baseOpts);
    expect(d.degraded).toBe(true);
    expect(d.independence).toBe("weak");
    expect(d.hostKind).toBe("codex"); // only candidate
    expect(d.rejected.length).toBeGreaterThan(0);
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
    // TE-07: use canonical tier_models field; supported_tiers array must also be overridden to reflect gap
    const noPowerful = codexHost({ tier_models: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "" }, supported_tiers: ["cheap", "mid"] });
    const d = route(lane({ tier: "powerful" }), [host(), noPowerful], opts);
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/tier "powerful"/);
  });

  it("honors an explicit supported_tiers extension when present", () => {
    // Only a codex host that only supports cheap — mid request cannot qualify.
    // TE-02: degrades instead of throwing; routes to the only available host.
    const limited = codexHost({ supported_tiers: ["cheap"] });
    const d = route(lane({ tier: "mid", preferredHostKind: "codex" }), [limited], opts);
    expect(d.degraded).toBe(true);
    expect(d.independence).toBe("weak");
    expect(d.hostKind).toBe("codex"); // only candidate even though it lacks the tier
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
    // TE-07: staleness is checked via advertised_at (canonical)
    const staleCodex = codexHost({ advertised_at: STALE });
    const d = route(lane({ preferredHostKind: "codex" }), [host(), staleCodex], opts);
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/stale/);
  });

  it("honors advertised_at when present; lenient reader falls back to detected_at for legacy manifests", () => {
    // advertised_at stale → rejected (canonical wins)
    const hStale = codexHost({ advertised_at: STALE });
    const d1 = route(lane({ preferredHostKind: "codex" }), [host(), hStale], opts);
    expect(d1.hostKind).toBe("claude");
    // Legacy: only detected_at present (advertised_at overridden to undefined) → lenient reader uses it
    const hLegacy = codexHost({ detected_at: FRESH, advertised_at: undefined as unknown as string });
    const d2 = route(lane({ preferredHostKind: "codex" }), [host(), hLegacy], opts);
    expect(d2.hostKind).toBe("codex"); // fresh via detected_at fallback
  });

  it("treats a missing/unparseable timestamp as stale — TE-02: degrades instead of throwing", () => {
    // Single host with no parseable timestamp: stale → no qualifier → degrade to it.
    // TE-07: use canonical advertised_at field
    const h = host({ advertised_at: "" });
    const d = route(lane(), [h], opts);
    expect(d.degraded).toBe(true);
    expect(d.independence).toBe("weak");
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.some((r) => r.reason.match(/stale/i))).toBe(true);
  });

  it("a custom TTL re-admits a manifest within the window", () => {
    // TE-07: use canonical advertised_at field
    const h = codexHost({ advertised_at: STALE });
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

describe("route — RouteError + degradation trail", () => {
  it("TE-02: empty host list still throws RouteError (no candidate to degrade to)", () => {
    expect(() => route(lane(), [], baseOpts)).toThrow(RouteError);
    expect(() => route(lane(), [], { ...baseOpts, crossHostEnabled: true })).toThrow(RouteError);
  });

  it("TE-02: non-qualifying hosts yield a degraded decision, rejected trail preserved", () => {
    // codex lacks agent_team; cross-host enabled but no other host → degrade to codex
    const d = route(lane({ mode: "team" }), [codexHost()], {
      ...baseOpts,
      crossHostEnabled: true,
    });
    expect(d.degraded).toBe(true);
    expect(d.independence).toBe("weak");
    expect(d.rejected.length).toBeGreaterThan(0);
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/agent_team/);
    expect(d.reason).toMatch(/DEGRADED/i);
  });

  it("RouteError message names rejected hosts when thrown (empty-hosts path)", () => {
    const err = (() => {
      try {
        route(lane(), [], baseOpts);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(RouteError);
    expect((err as Error).message).toMatch(/no host manifests supplied/i);
  });
});

// ── TE-03: degraded + independence fields ──────────────────────────────────────

describe("route — TE-03: RoutingDecision.degraded + independence fields", () => {
  it("normal qualifying path: degraded=false, independence=strong", () => {
    const d = route(lane(), [host()], baseOpts);
    expect(d.degraded).toBe(false);
    expect(d.independence).toBe("strong");
  });

  it("degraded path: degraded=true, independence=weak", () => {
    const d = route(lane(), [codexHost()], baseOpts); // codex only, cross-host off
    expect(d.degraded).toBe(true);
    expect(d.independence).toBe("weak");
  });

  it("onDecision receives the degradation flags (TE-03 persistence path)", () => {
    const seen: RoutingDecision[] = [];
    const d = route(lane(), [codexHost()], {
      ...baseOpts,
      onDecision: (x) => seen.push(x),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(d);
    expect(seen[0].degraded).toBe(true);
    expect(seen[0].independence).toBe("weak");
  });

  it("degraded decision notes mention weak-independence signal", () => {
    const d = route(lane(), [codexHost()], baseOpts);
    expect(d.notes.join(" ")).toMatch(/weak.independen/i);
  });

  it("cross-host enabled: picks the best-ranked candidate when all degrade", () => {
    // All stale — degradation picks highest-scored (claude tiebreaks over codex)
    // TE-07: use canonical advertised_at field
    const staleC = host({ advertised_at: STALE });
    const staleK = codexHost({ advertised_at: STALE });
    const d = route(lane(), [staleK, staleC], { ...baseOpts, crossHostEnabled: true });
    expect(d.degraded).toBe(true);
    expect(d.hostKind).toBe("claude"); // claude wins tiebreak
  });
});

// ── TE-02/ARCH-2: capability requirements intersection ────────────────────────

describe("route — TE-02/ARCH-2: capabilityRequirements intersection", () => {
  const opts = { ...baseOpts, crossHostEnabled: true };

  it("needs_parallel=true rejects a host whose tool_support has no parallel capability", () => {
    // codexHost: agent_team=false, independent_agents=false → no parallel
    const d = route(
      lane({ capabilityRequirements: { needs_parallel: true } }),
      [host(), codexHost()],
      opts
    );
    expect(d.hostKind).toBe("claude");
    expect(d.rejected.find((r) => r.hostKind === "codex")?.reason).toMatch(/needs_parallel/);
  });

  it("needs_parallel=false (or absent) imposes no rejection", () => {
    const d = route(
      lane({ capabilityRequirements: { needs_parallel: false } }),
      [codexHost()],
      opts
    );
    // codex qualifies — parallel not required
    expect(d.degraded).toBe(false);
    expect(d.hostKind).toBe("codex");
  });

  it("capabilityRequirements absent: no extra rejection (fully lenient)", () => {
    const d = route(lane(), [codexHost()], opts);
    expect(d.hostKind).toBe("codex");
    expect(d.degraded).toBe(false);
  });

  it("needs_pr=true with explicit capability_set.needs_pr=false rejects the host", () => {
    const noPr = host({ capability_set: { needs_pr: false } } as Partial<RoutableHost>);
    const d = route(
      lane({ capabilityRequirements: { needs_pr: true } }),
      [noPr, codexHost()],
      opts
    );
    // claude-noPr rejected; codex has no capability_set → lenient pass
    expect(d.hostKind).toBe("codex");
    expect(d.rejected.find((r) => r.hostKind === "claude")?.reason).toMatch(/needs_pr/);
  });

  it("needs_pr=true with NO capability_set on host: lenient (no rejection)", () => {
    // codex host has no capability_set → lenient, no rejection
    const d = route(
      lane({ capabilityRequirements: { needs_pr: true } }),
      [codexHost()],
      opts
    );
    expect(d.hostKind).toBe("codex");
    expect(d.degraded).toBe(false);
  });

  it("needs_network=true rejects a host with capability_set.needs_network=false", () => {
    const noNet = host({ capability_set: { needs_network: false } } as Partial<RoutableHost>);
    const d = route(
      lane({ capabilityRequirements: { needs_network: true } }),
      [noNet, codexHost()],
      opts
    );
    expect(d.rejected.find((r) => r.hostKind === "claude")?.reason).toMatch(/needs_network/);
  });

  it("isolation:worktree rejects a host with capability_set.isolation=none", () => {
    const noWorktree = host({
      capability_set: { isolation: "none" },
    } as Partial<RoutableHost>);
    const d = route(
      lane({ capabilityRequirements: { isolation: "worktree" } }),
      [noWorktree, codexHost()],
      opts
    );
    expect(d.rejected.find((r) => r.hostKind === "claude")?.reason).toMatch(/isolation/);
  });
});

// ── ARCH-6: per-specialist tier threading ─────────────────────────────────────

// Minimal specialist fixture (only the fields planTeamRouting needs).
function spec(
  name: string,
  overrides: { host_kind?: HostKind; tier?: Tier; capabilityRequirements?: CapabilityRequirements } = {}
): {
  name: string;
  scope: string;
  dependsOn: string[];
  host_kind?: HostKind;
  tier?: Tier;
  capabilityRequirements?: CapabilityRequirements;
} {
  return { name, scope: "", dependsOn: [], ...overrides };
}

describe("planTeamRouting — ARCH-6: per-specialist tier", () => {
  it("uses the specialist's own tier when provided", () => {
    const routes = planTeamRouting(
      [spec("arch", { host_kind: "claude", tier: "powerful" })],
      [host()],
      { ...baseOpts, localHostId: "claude" }
    );
    expect(routes[0].decision.tier).toBe("powerful");
    expect(routes[0].decision.model).toBe("opus");
  });

  it("falls back to opts.tier when specialist carries no tier", () => {
    const routes = planTeamRouting(
      [spec("backend", { host_kind: "claude" })],
      [host()],
      { ...baseOpts, localHostId: "claude", tier: "cheap" }
    );
    expect(routes[0].decision.tier).toBe("cheap");
    expect(routes[0].decision.model).toBe("haiku");
  });

  it("default tier remains 'mid' when neither specialist nor opts provide one", () => {
    const routes = planTeamRouting(
      [spec("docs", { host_kind: "claude" })],
      [host()],
      { ...baseOpts, localHostId: "claude" }
    );
    expect(routes[0].decision.tier).toBe("mid");
    expect(routes[0].decision.model).toBe("sonnet");
  });

  it("per-specialist tiers compose independently (different tiers per lane)", () => {
    const routes = planTeamRouting(
      [
        spec("arch", { host_kind: "claude", tier: "powerful" }),
        spec("backend", { host_kind: "claude", tier: "cheap" }),
        spec("docs", { host_kind: "claude" }), // no tier → inherits opts.tier
      ],
      [host()],
      { ...baseOpts, localHostId: "claude", tier: "mid" }
    );
    expect(routes[0].decision.tier).toBe("powerful");
    expect(routes[1].decision.tier).toBe("cheap");
    expect(routes[2].decision.tier).toBe("mid");
  });

  it("ARCH-6: planTeamRouting degraded path also sets degraded+independence correctly", () => {
    // Only a codex host, cross-host off → every lane degrades
    const routes = planTeamRouting(
      [spec("backend", { host_kind: "claude", tier: "mid" })],
      [codexHost()],
      { ...baseOpts, localHostId: "claude" }
    );
    expect(routes[0].decision.degraded).toBe(true);
    expect(routes[0].decision.independence).toBe("weak");
  });
});

describe("planTeamRouting — GAP-A1/ARCH-2: capabilityRequirements end-to-end through planTeamRouting", () => {
  const opts = { localHostId: "claude", crossHostEnabled: true, now: NOW };

  it("needs_parallel lane + non-parallel codex host → degraded via planTeamRouting (round-trip)", () => {
    // codexHost has agent_team:false + independent_agents:false → capabilityGap
    // detects needs_parallel gap → host not qualified → degrade-not-throw
    const routes = planTeamRouting(
      [spec("writer", { capabilityRequirements: { needs_parallel: true } })],
      [codexHost()],
      opts
    );
    expect(routes[0].decision.degraded).toBe(true);
    expect(routes[0].decision.independence).toBe("weak");
    // rejected trail must include the capability gap reason
    expect(
      routes[0].decision.rejected.some((r) => r.reason.includes("needs_parallel"))
    ).toBe(true);
  });

  it("needs_parallel lane with a parallel-capable claude host → qualifies, not degraded", () => {
    // claude has agent_team:true + independent_agents:true → needs_parallel satisfied
    const routes = planTeamRouting(
      [spec("writer", { capabilityRequirements: { needs_parallel: true } })],
      [host()], // claude with agent_team:true
      opts
    );
    expect(routes[0].decision.degraded).toBe(false);
    expect(routes[0].decision.independence).toBe("strong");
    expect(routes[0].decision.rejected).toHaveLength(0);
  });

  it("no capabilityRequirements on specialist → no gap, claude qualifies (null-safe path)", () => {
    // Absent capabilityRequirements ⇒ capabilityGap() receives undefined ⇒ returns []
    const routes = planTeamRouting(
      [spec("backend")], // no capabilityRequirements
      [host()],
      opts
    );
    expect(routes[0].decision.degraded).toBe(false);
    expect(routes[0].decision.rejected).toHaveLength(0);
  });

  it("mixed team: one lane needs_parallel (claude ok), one lane no requirement (codex ok)", () => {
    const routes = planTeamRouting(
      [
        spec("orchestrator", { capabilityRequirements: { needs_parallel: true } }),
        spec("security", { host_kind: "codex" }), // no capability requirement
      ],
      [host(), codexHost()],
      opts
    );
    // orchestrator: needs_parallel → claude qualifies (strong)
    expect(routes[0].decision.degraded).toBe(false);
    expect(routes[0].decision.host).toBe("claude");
    // security: no constraint → codex preferred (host_kind: codex)
    expect(routes[1].decision.host).toBe("codex");
  });
});
