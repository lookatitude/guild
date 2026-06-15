/**
 * tests/universal-host/_p1-helpers.ts
 *
 * Shared REAL-PATH input builders for the Universal-Host **P1** SC suite
 * (SC-1/2/4/5/6/7/8/9 — distinct from the earlier L6 inventory/equivalence
 * `sc2..sc7` files in this directory, which assert a DIFFERENT initiative's
 * success criteria and stay green as P1's SC-9 no-regression baseline).
 *
 * Test-the-real-path discipline (the #1 recurring defect class — injected-seam
 * tests masking real-path misses): these builders NEVER re-implement the function
 * under test. They construct only the function's REAL public inputs and call the
 * shipped function:
 *
 *   - `route()` is exercised with real `guild.host_capability.v1` manifests + a
 *     FIXED clock (`now`) — the same manifest shape `write-host-capability.ts`
 *     emits, the same `RoutableHost` the production caller passes.
 *   - `selectReviewer()` is exercised through the production `detectProviders()`
 *     entrypoint driven by the module's OWN sanctioned `ProbeEnv` injection
 *     (provider-detect.ts docstring: "The seam that makes detection CI-safe +
 *     deterministic. Tests inject a fake; production uses defaultProbeEnv(cwd)").
 *     We inject the PROBE WORLD, never the detection result — so the real
 *     family-resolution + selectability logic runs.
 *
 * The L0 contract modules under test (host-registry / role-model / config-reconcile
 * / permission-policy / adapter-fallback / routing-ab) are pure; their tests import
 * the shipped validators/predicates directly and feed them real + fail-fixture data.
 */

import type {
  RoutableHost,
  LaneRequest,
  RoutingDecision,
} from "../../scripts/lib/host-router";
import { route } from "../../scripts/lib/host-router";
import type {
  ProbeEnv,
  DetectionResult,
  ResolvedReview,
  SelectResult,
} from "../../scripts/lib/provider-detect";
import { detectProviders, selectReviewer } from "../../scripts/lib/provider-detect";
import type { HostCapabilityManifest } from "../../scripts/write-host-capability";

// ── Fixed clock so route() freshness math is deterministic across runs ──────────
export const NOW = Date.parse("2026-06-15T12:00:00Z");
export const FRESH = "2026-06-15T11:59:00Z"; // 1 min ago — inside the 1 h default TTL

/** A real Claude host manifest (the reference author host). */
export function claudeHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  const base: HostCapabilityManifest = {
    schema_version: "guild.host_capability.v1",
    host_id: "claude",
    host_kind: "claude",
    advertised_at: FRESH,
    source: "p1-test",
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

/** A real Codex host manifest (the cross-review / second host). */
export function codexHost(overrides: Partial<RoutableHost> = {}): RoutableHost {
  return claudeHost({
    host_id: "codex",
    host_kind: "codex",
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

/**
 * The SC-4 routing-decision A/B input matrix. ONE definition is shared by the
 * golden generator (scripts side) and the test (assert side) so the golden can
 * never drift from what the test re-derives. Each entry pins a lane + the host
 * set + the routing options; `now` is always fixed.
 */
export interface RoutingCase {
  name: string;
  lane: LaneRequest;
  hosts: RoutableHost[];
  crossHostEnabled: boolean;
}

export function routingAbCases(): RoutingCase[] {
  const both = [claudeHost(), codexHost()];
  return [
    {
      name: "claude-only/mid/team (cross disabled — today's default)",
      lane: { taskId: "L-mid-team", tier: "mid", mode: "team" },
      hosts: both,
      crossHostEnabled: false,
    },
    {
      name: "cross-enabled/adversarial-review/powerful",
      lane: {
        taskId: "L-adv-powerful",
        tier: "powerful",
        mode: "subagent",
        workType: "adversarial_review",
      },
      hosts: both,
      crossHostEnabled: true,
    },
    {
      name: "cross-enabled/cheap/agent",
      lane: { taskId: "L-cheap-agent", tier: "cheap", mode: "agent" },
      hosts: both,
      crossHostEnabled: true,
    },
    {
      name: "codex preferred but team-backend required ⇒ claude (capability filter)",
      lane: {
        taskId: "L-pref-codex-team",
        tier: "mid",
        mode: "team",
        preferredHostKind: "codex",
      },
      hosts: both,
      crossHostEnabled: true,
    },
  ];
}

/** Drive the REAL route() over a case with the fixed clock. */
export function runRoutingCase(c: RoutingCase): RoutingDecision {
  return route(c.lane, c.hosts, { now: NOW, crossHostEnabled: c.crossHostEnabled });
}

// ── selectReviewer A/B (driven through the REAL detectProviders + ProbeEnv) ─────

interface ProbeWorld {
  onPath?: string[];
  versionOk?: string[];
  codexStoredAuth?: boolean;
  env?: Record<string, string>;
  capabilityProviders?: string[];
  pluginAdapters?: string[];
}

export function makeProbe(world: ProbeWorld): ProbeEnv {
  const onPath = new Set(world.onPath ?? []);
  const versionOk = new Set(world.versionOk ?? []);
  const plugins = new Set(world.pluginAdapters ?? []);
  const env = world.env ?? {};
  return {
    commandOnPath: (bin: string) => onPath.has(bin),
    probeVersion: (bin: string) => versionOk.has(bin),
    readStoredCodexAuth: () => world.codexStoredAuth === true,
    readEnv: (name: string) => env[name],
    readCapabilityProviders: () => world.capabilityProviders ?? [],
    readPluginAdapter: (id: string) => plugins.has(id),
  };
}

const CWD = "/tmp/guild-p1-selectreviewer-fixture"; // never read — probes injected

export interface SelectReviewerCase {
  name: string;
  host?: string;
  world: ProbeWorld;
  review: ResolvedReview;
}

export function selectReviewerAbCases(): SelectReviewerCase[] {
  // The reference machine posture: Claude author + codex-plugin reference adapter
  // present + authed (stored codex auth), exactly the "codex IS reachable" reality.
  const codexReachable: ProbeWorld = {
    onPath: ["codex"],
    versionOk: ["codex"],
    codexStoredAuth: true,
    pluginAdapters: ["codex-plugin"],
  };
  return [
    {
      name: "claude-author + codex-plugin + cross/auto ⇒ selected codex-plugin",
      world: codexReachable,
      review: { mode: "cross", provider: "auto" },
    },
    {
      name: "review=off ⇒ skipped",
      world: codexReachable,
      review: { mode: "off", provider: "auto" },
    },
    {
      name: "review=local ⇒ degraded-local",
      world: codexReachable,
      review: { mode: "local", provider: "auto" },
    },
    {
      name: "cross + pin gemini-cli (no adapter) ⇒ skipped (honor-or-refuse)",
      world: codexReachable,
      review: { mode: "cross", provider: "gemini-cli" },
    },
    {
      name: "cross + pin claude (same family as author) ⇒ skipped (no self-review)",
      world: codexReachable,
      review: { mode: "cross", provider: "claude" },
    },
    {
      name: "cross/auto + empty world ⇒ skipped (no cross reviewer)",
      world: {},
      review: { mode: "cross", provider: "auto" },
    },
  ];
}

/** Drive the REAL detectProviders → selectReviewer path for a case. */
export function runSelectReviewerCase(c: SelectReviewerCase): SelectResult {
  const detection: DetectionResult = detectProviders({
    cwd: CWD,
    host: c.host,
    probe: makeProbe(c.world),
  });
  return selectReviewer(detection, c.review);
}
