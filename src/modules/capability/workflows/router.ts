/**
 * src/modules/capability/workflows/router.ts
 *
 * Cluster A — the capability routing function (Cluster A of the cross-host ADR).
 * Extracted from host-router.ts (W3 god-file split).
 *
 * Contract (BY POINTER): ADR: v2-cross-host-orchestration (workspace wiki)
 *   §CR-1 (routing decision function), §CR-2 (capability pre-check),
 *   §CR-3 (ranked fallback chain — NO silent tier downgrade),
 *   §CR-4 (work-type → host affinity), §CR-5 (manifest freshness TTL),
 *   §CR-6 (budget cap deferred — telemetry spend stub only; issue: oc-budget-cap),
 *   §"Null codex tier-slot fill" (merge precedence).
 * Tier ladder is canonical in cost-aware-tiering-and-lean-context.md §1/§2.
 * The D5 `agent_mode` ladder (mode axis) is canonical in
 *   v2x-command-surface-dispatch-and-internalization.md.
 *
 * This is the deterministic three-axis compose function that resolves what the
 * cost ADR + RE-5 specified: *mode* (D5) × *tier* (cost auto-scorer output) ×
 * *host* (RE-5 `guild.host_capability.v1` manifest). It is PURE and SYNCHRONOUS.
 *
 * Layer: capability/ — imports from core/contracts + shared/, never host/*.
 */

import type { HostCapabilityManifest, HostKind } from "../../host-runtime";
import type { SpecialistDispatchContract } from "../../dispatch";
import { resolveTierModel, type ResolvedTierModel, type TierHostValue } from "../../config";
import { rankScore, backendForMode, getDefaultModelTierMap, isClaudeHost } from "./rank";
import { hostKindRank } from "./tiebreak";

// ── Axes + request ────────────────────────────────────────────────────────────

export type Tier = "cheap" | "mid" | "powerful";

/** D5 dispatch modes (the mode axis). */
export type AgentMode = "team" | "agent" | "subagent" | "auto";

/** Soft work-type signal driving CR-4 host affinity. */
export type WorkType =
  | "interactive_lifecycle"
  | "adversarial_review"
  | "background_implementation"
  | "parallel_local_lanes"
  | "graph_extraction";

/**
 * The backend-capability keys carried by `guild.host_capability.v1.tool_support`.
 * A lane requiring `team` needs `agent_team`; `agent` needs `independent_agents`;
 * `subagent` needs `subagent` (always true — the universal fallback).
 */
export type BackendCapability = keyof HostCapabilityManifest["tool_support"];

/**
 * Capability requirements from `task_run.host.capability_requirements` (FROZEN
 * target-architecture.md §task_run). Read by the router per TE-02/ARCH-2.
 * All fields are optional — absent means "no requirement on this axis."
 */
export interface CapabilityRequirements {
  /** Lane needs a host that can open/merge PRs (e.g. Codex cloud). */
  needs_pr?: boolean;
  /** Lane needs parallel execution (agent_team OR independent_agents). */
  needs_parallel?: boolean;
  /** Lane requires network access. */
  needs_network?: boolean;
  /** Lane requires worktree isolation. */
  isolation?: "worktree" | "none";
}

/**
 * A host's advertised capability set (forward-compatible extension on the
 * manifest). The v2.0 writer does not yet emit this field, so its absence
 * is lenient for all axes EXCEPT `needs_parallel`, which is derived from
 * the already-present `tool_support` flags.
 */
export interface HostCapabilitySet {
  needs_pr?: boolean;
  needs_parallel?: boolean;
  needs_network?: boolean;
  isolation?: "worktree" | "none";
}

/**
 * A routable host = the real RE-5 manifest, plus OPTIONAL forward-compatible
 * extension fields the ADR names but the v2.0 writer does not yet emit. Honored
 * when present, lenient when absent.
 */
export type RoutableHost = HostCapabilityManifest & {
  /**
   * ADR `tool_permissions` allow-list (CR-2). Absent ⇒ no advertised restriction.
   * (Not yet emitted by write-host-capability.ts — Wave-3 alignment item.)
   */
  tool_permissions?: string[];
  /**
   * TE-07 legacy fallback fields: pre-TE-07 manifests on disk still carry
   * `detected_at` and `tiers`. The router reads canonical names first and falls
   * back to these so old manifests remain usable without forced re-bootstrap.
   */
  detected_at?: string;
  tiers?: { cheap?: string; mid?: string; powerful?: string };
  /**
   * TE-02/ARCH-2: per-host capability advertisement (forward-compatible).
   * Absent ⇒ lenient for needs_pr/needs_network/isolation; needs_parallel is
   * derived from tool_support when capability_set is absent.
   */
  capability_set?: HostCapabilitySet;
};

export interface LaneRequest {
  /** Lane / task id (logged into the routing decision). */
  taskId: string;
  /** Tier already resolved by the cost auto-scorer (cost ADR §2). */
  tier: Tier;
  /** D5 mode; maps to a required backend capability unless requiredBackend set. */
  mode: AgentMode;
  /** Explicit backend requirement; overrides the mode→backend mapping. */
  requiredBackend?: BackendCapability;
  /** CR-2 tool pre-check: required against a host's tool_permissions allow-list. */
  requiredTools?: string[];
  /** CR-4 soft affinity signal. */
  workType?: WorkType;
  /** Per-specialist `host:` from team.yaml — a strong preference, not a hard pin. */
  preferredHostKind?: HostKind;
  /**
   * TE-02/ARCH-2: capability requirements from `task_run.host.capability_requirements`.
   * When set, the router intersects these requirements against each adapter's
   * capability_set before routing. Absent = no extra capability gate.
   */
  capabilityRequirements?: CapabilityRequirements;
}

export interface RouteOptions {
  /** Epoch ms for freshness math. Default Date.now() (the only impurity). */
  now?: number;
  /** CR-5 staleness TTL in seconds. Default 3600 (defaults.capability_manifest_ttl_s). */
  manifestTtlS?: number;
  /**
   * defaults.cross_host.enabled. Default false ⇒ Claude-only behavior,
   * byte-identical to today (non-claude hosts are filtered out entirely).
   */
  crossHostEnabled?: boolean;
  /** CR-3 level-4 Claude-only fallback. Default true (defaults.cross_host.fallback_to_claude). */
  fallbackToClaude?: boolean;
  /**
   * Operator model override: settings.json models.tiers[tier][host_kind].
   * Highest-precedence step of the null-slot fill. Passed in (router stays pure).
   * G-11/R5: values carry the full union — string |
   * {model, effort?, reasoning?, thinking?, verbosity?} | null — and are
   * unpacked exclusively through resolveTierModel().
   */
  settingsOverride?: Partial<Record<Tier, Partial<Record<HostKind, TierHostValue>>>>;
  /**
   * CR-6 telemetry spend stub. Invoked once with the final decision so actual
   * routing spend can be recorded now; the budget CAP itself is deferred
   * (tracked as oc-budget-cap). Default: no-op.
   */
  onDecision?: (decision: RoutingDecision) => void;
}

// ── Decision ────────────────────────────────────────────────────────────────

export interface ModelParams {
  /**
   * G4b: optional, not a guaranteed string. A host with NO Guild-mapped model at
   * this tier (e.g. codex-cli, or any dispatch_selectable registry row whose
   * capabilities.models[tier].model is null) yields `model: undefined` — "no
   * override, let the host use its own default" — rather than silently
   * backfilling a Claude model name (getDefaultModelTierMap's prior behavior;
   * see tier-defaults.ts CLAUDE_TIER_FALLBACK for the ONE remaining case that
   * still applies it: a HostKind with no registry row at all).
   */
  model?: string;
  effort?: string;
  reasoning?: string;
  thinking?: string;
  verbosity?: string;
  [key: string]: string | undefined;
}

/** The minimal `{host, tier, model, modelParams}` choice (CR-1/R5 return core). */
export interface RouteTarget {
  /** host_id from the manifest. */
  host: string;
  hostKind: HostKind;
  tier: Tier;
  /**
   * Legacy scalar retained for old receipts and docs. Mirrors modelParams.model.
   * G4b: `null` means the same thing `modelParams.model === undefined` means — no
   * Guild-mapped model at this tier for this host; the host runs its own default.
   */
  model: string | null;
  /** R5 full model parameter object carried into dispatch and trace/run records. */
  modelParams: ModelParams;
}

export interface RejectedHost {
  hostId: string;
  hostKind: HostKind;
  reason: string;
}

/** The full logged routing decision (→ run-state.lanes[id].routing_decision). */
export interface RoutingDecision extends RouteTarget {
  taskId: string;
  /**
   * TE-03: true when no fully-qualifying host was found and the router fell
   * back to the least-bad candidate. Always false on the normal qualifying path.
   * Persisted via onDecision into the lane's run-state entry + the receipt host block.
   */
  degraded: boolean;
  /**
   * TE-03: "strong" = reviewer on a DIFFERENT host than the producer (full
   * cross-host adversarial independence). "weak" = reviewer on the SAME host
   * (independence lost — the observable signal defined in docs/v2/host-adversarial-adaptability.html + 08).
   * Set to "weak" whenever degraded=true.
   */
  independence: "strong" | "weak";
  /** Ranked alternatives at the SAME tier (CR-3 — no silent downgrade). */
  fallbackChain: RouteTarget[];
  /** Rank score of the selected primary (CR-1 step 2 affinity input). */
  affinityScore: number;
  reason: string;
  rejected: RejectedHost[];
  notes: string[];
}

// ── Specialist backend ────────────────────────────────────────────────────────

/** The execution backend a specialist's routing decision maps to. */
export type SpecialistBackend = "tmux" | "remote";

export interface SpecialistRoute {
  specialist: string;
  hostKind: HostKind;
  decision: RoutingDecision;
  /**
   * "tmux" = a LOCAL pane on the orchestrator host (TmuxTeamBackend);
   * "remote" = a DIFFERENT physical host (RemoteTeamBackend). The split is
   * decision.host vs the local host id.
   */
  backend: SpecialistBackend;
}

export interface PlanTeamRoutingOpts extends RouteOptions {
  /** host_id of the local/orchestrator host; lanes resolving here run local. */
  localHostId: string;
  /** Tier applied to every lane (per-lane tiers are a later wave). Default "mid". */
  tier?: Tier;
  /** D5 mode applied to every lane. Default "auto" (no hard backend requirement). */
  mode?: AgentMode;
}

// ── RouteError ────────────────────────────────────────────────────────────────

/** Thrown when no host satisfies the lane after the capability pre-check. */
export class RouteError extends Error {
  readonly taskId: string;
  readonly rejected: RejectedHost[];
  constructor(taskId: string, rejected: RejectedHost[]) {
    const detail = rejected.length
      ? rejected.map((r) => `${r.hostId} (${r.hostKind}): ${r.reason}`).join("; ")
      : "no host manifests supplied";
    super(`No host can route task "${taskId}" — ${detail}`);
    this.name = "RouteError";
    this.taskId = taskId;
    this.rejected = rejected;
  }
}

const DEFAULT_TTL_S = 3600;

// ── Manifest helpers ──────────────────────────────────────────────────────────

function manifestTimestamp(host: RoutableHost): number | null {
  // TE-07: read canonical `advertised_at`; fall back to legacy `detected_at`
  // for manifests written before the TE-07 rename (migration bridge).
  const raw = host.advertised_at ?? host.detected_at;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function isStale(host: RoutableHost, now: number, ttlS: number): boolean {
  const ts = manifestTimestamp(host);
  // No parseable timestamp ⇒ treat as stale (can't prove freshness — CR-5).
  if (ts === null) return true;
  return now - ts > ttlS * 1000;
}

function supportsTier(host: RoutableHost, tier: Tier): boolean {
  // TE-07: `supported_tiers` is now a primary field (emitted by updated writer).
  if (Array.isArray(host.supported_tiers)) {
    return host.supported_tiers.includes(tier);
  }
  // Lenient fallback: derive from tier_models (canonical) or legacy tiers object.
  const model = host.tier_models?.[tier] ?? host.tiers?.[tier];
  return typeof model === "string" && model.trim().length > 0;
}

function toolGap(host: RoutableHost, requiredTools: string[] | undefined): string[] {
  // CR-2: reject on a tool gap ONLY when the host advertises an allow-list.
  if (!requiredTools || requiredTools.length === 0) return [];
  if (!Array.isArray(host.tool_permissions)) return [];
  const allow = new Set(host.tool_permissions);
  return requiredTools.filter((t) => !allow.has(t));
}

/**
 * TE-02/ARCH-2: capability-requirements intersection.
 * Returns a list of unmet requirements (empty = no gap = host qualifies).
 */
function capabilityGap(
  host: RoutableHost,
  reqs: CapabilityRequirements | undefined
): string[] {
  if (!reqs) return [];
  const gaps: string[] = [];
  const cs = host.capability_set;

  // needs_parallel: derive from tool_support when capability_set absent
  if (reqs.needs_parallel === true) {
    const canParallel =
      cs?.needs_parallel ??
      Boolean(host.tool_support?.agent_team || host.tool_support?.independent_agents);
    if (!canParallel) gaps.push("needs_parallel");
  }

  // The remaining requirements are only enforced when capability_set is present
  if (cs) {
    if (reqs.needs_pr === true && !cs.needs_pr) gaps.push("needs_pr");
    if (reqs.needs_network === true && !cs.needs_network) gaps.push("needs_network");
    if (reqs.isolation === "worktree" && cs.isolation !== "worktree") {
      gaps.push("isolation:worktree");
    }
  }

  return gaps;
}

// ── Model resolution ──────────────────────────────────────────────────────────

function toModelParams(resolved: ResolvedTierModel): ModelParams | null {
  if (resolved.model === null) return null;
  const params: ModelParams = { model: resolved.model };
  if (resolved.effort !== undefined) params.effort = resolved.effort;
  if (resolved.reasoning !== undefined) params.reasoning = resolved.reasoning;
  if (resolved.thinking !== undefined) params.thinking = resolved.thinking;
  if (resolved.verbosity !== undefined) params.verbosity = resolved.verbosity;
  return params;
}

/**
 * Null-slot fill (CR-1 step 4). Merge precedence:
 *   settings.json models.tiers[tier][host_kind]   (operator override)
 *     → host.tier_models[tier]                     (RE-5 manifest fill, canonical)
 *     → host.tiers[tier]                           (legacy pre-TE-07 fallback)
 *     → built-in default                           (registry-derived; null stays
 *                                                    null — G4b, see ModelParams)
 */
export function resolveModel(
  tier: Tier,
  host: RoutableHost,
  settingsOverride?: RouteOptions["settingsOverride"]
): string | null {
  return resolveModelParams(tier, host, settingsOverride).model ?? null;
}

/**
 * Resolve the full model parameter object for a tier+host.
 */
export function resolveModelParams(
  tier: Tier,
  host: RoutableHost,
  settingsOverride?: RouteOptions["settingsOverride"]
): ModelParams {
  // G-11/R5: unpack the settings tier-value union through the single helper.
  const overrideResolved = resolveTierModel(settingsOverride, tier, host.host_kind);
  const overrideParams = toModelParams(overrideResolved);
  if (overrideParams !== null) return overrideParams;
  // TE-07: read canonical `tier_models`; fall back to legacy `tiers` for old manifests.
  const fromManifest = host.tier_models?.[tier] ?? host.tiers?.[tier];
  if (typeof fromManifest === "string" && fromManifest.trim()) return { model: fromManifest.trim() };
  // G4b: the built-in default is now registry-derived and HONEST — a host whose
  // registry row has no Guild-mapped model at this tier (e.g. codex-cli, or any of
  // the new wrapped-CLI hosts) yields `model: undefined` here, NOT a silently
  // backfilled Claude model name. `getDefaultModelTierMap` still returns
  // CLAUDE_TIER_FALLBACK for a HostKind with no registry row at all (a dropped/
  // unmapped kind) — that ONE case is unaffected.
  const builtIn = getDefaultModelTierMap(host.host_kind)[tier];
  return builtIn === null ? {} : { model: builtIn };
}

// ── route() — CR-1 ───────────────────────────────────────────────────────────

/**
 * Deterministic three-axis routing. Returns the full logged decision (the
 * `{host, hostKind, tier, model}` core + the ranked fallback chain + the reject
 * trail). Throws RouteError when no host satisfies the lane.
 */
export function route(
  lane: LaneRequest,
  hosts: RoutableHost[],
  opts: RouteOptions = {}
): RoutingDecision {
  const now = opts.now ?? Date.now();
  const ttlS = opts.manifestTtlS ?? DEFAULT_TTL_S;
  const crossHostEnabled = opts.crossHostEnabled ?? false;
  const fallbackToClaude = opts.fallbackToClaude ?? true;
  const requiredBackend = lane.requiredBackend ?? backendForMode(lane.mode);

  const rejected: RejectedHost[] = [];
  const policyEligible: RoutableHost[] = [];
  const qualifying: RoutableHost[] = [];

  // Single pass, SAME gate order/messages as before the fix (so the `rejected`
  // trail and the qualifying path stay byte-identical to pre-fix behavior).
  // The only addition is `policyEligible`: a host that clears the two hard
  // POLICY gates (cross-host disabled, stale manifest) is bookmarked there —
  // regardless of whether it goes on to fail a softer CAPABILITY gate below —
  // so the TE-02 degrade-to-least-bad path can rank ONLY policy-eligible
  // hosts. A policy-rejected host (an operator/trust decision, not a soft
  // capability shortfall) must never win as "least-bad".
  for (const host of hosts) {
    const tag = (reason: string) =>
      rejected.push({ hostId: host.host_id, hostKind: host.host_kind, reason });

    // cross_host.enabled=false ⇒ Claude-only (single-host behavior).
    if (!crossHostEnabled && !isClaudeHost(host.host_kind)) {
      tag("cross-host disabled (defaults.cross_host.enabled=false)");
      continue;
    }
    // CR-5 freshness.
    if (isStale(host, now, ttlS)) {
      tag(`stale manifest (older than ${ttlS}s TTL)`);
      continue;
    }
    policyEligible.push(host);

    // CR-1 step 1: tier support.
    if (!supportsTier(host, lane.tier)) {
      tag(`tier "${lane.tier}" not supported`);
      continue;
    }
    // CR-1 step 1: backend support.
    if (requiredBackend && !host.tool_support?.[requiredBackend]) {
      tag(`backend "${requiredBackend}" not supported`);
      continue;
    }
    // CR-2 tool pre-check (advertised allow-list only; lenient when absent).
    const gap = toolGap(host, lane.requiredTools);
    if (gap.length > 0) {
      tag(`missing required tools: ${gap.join(", ")}`);
      continue;
    }
    // TE-02/ARCH-2: capability requirements intersection.
    const capGap = capabilityGap(host, lane.capabilityRequirements);
    if (capGap.length > 0) {
      tag(`capability requirements not met: ${capGap.join(", ")}`);
      continue;
    }
    qualifying.push(host);
  }

  // TE-02: degrade-not-throw — but only among POLICY-ELIGIBLE hosts. A host
  // excluded by a hard policy gate (cross-host disabled, stale manifest) must
  // never win as "least-bad": that would silently violate the policy the gate
  // exists to enforce. When no host is even policy-eligible, there is truly
  // nothing to degrade to.
  if (qualifying.length === 0) {
    if (policyEligible.length === 0) {
      throw new RouteError(lane.taskId, rejected);
    }

    // Rank only policy-eligible hosts (same scoring + tiebreak as the normal path).
    const leastBad = [...policyEligible].sort((a, b) => {
      const sa = rankScore(a, lane);
      const sb = rankScore(b, lane);
      if (sb !== sa) return sb - sa;
      const ka = hostKindRank(a.host_kind);
      const kb = hostKindRank(b.host_kind);
      if (ka !== kb) return ka - kb;
      return a.host_id < b.host_id ? -1 : a.host_id > b.host_id ? 1 : 0;
    })[0];

    const degradedDecision: RoutingDecision = {
      taskId: lane.taskId,
      host: leastBad.host_id,
      hostKind: leastBad.host_kind,
      tier: lane.tier,
      model: resolveModel(lane.tier, leastBad, opts.settingsOverride),
      modelParams: resolveModelParams(lane.tier, leastBad, opts.settingsOverride),
      fallbackChain: [],
      affinityScore: rankScore(leastBad, lane),
      degraded: true,
      independence: "weak",
      reason:
        `DEGRADED: no host fully qualified for task "${lane.taskId}"; ` +
        `routed to least-bad candidate ${leastBad.host_id}(${leastBad.host_kind}); ` +
        `${rejected.length} rejection(s) recorded; ` +
        `backend=${requiredBackend ?? "any"}; workType=${lane.workType ?? "none"}`,
      rejected,
      notes: [
        "budget-cap deferred (oc-budget-cap, CR-6); spend recorded via telemetry stub",
        "degraded: true — no fully-qualifying host found; weak-independence recorded (doc 08 §2, TE-02/TE-03)",
      ],
    };

    opts.onDecision?.(degradedDecision);
    return degradedDecision;
  }

  // CR-1 step 2: rank by score, then deterministic tiebreak.
  const ranked = [...qualifying].sort((a, b) => {
    const sa = rankScore(a, lane);
    const sb = rankScore(b, lane);
    if (sb !== sa) return sb - sa; // higher score first
    const ka = hostKindRank(a.host_kind);
    const kb = hostKindRank(b.host_kind);
    if (ka !== kb) return ka - kb; // claude before codex
    return a.host_id < b.host_id ? -1 : a.host_id > b.host_id ? 1 : 0; // id asc
  });

  const toTarget = (h: RoutableHost): RouteTarget => ({
    host: h.host_id,
    hostKind: h.host_kind,
    tier: lane.tier, // SAME tier across the whole chain — CR-3 no silent downgrade
    model: resolveModel(lane.tier, h, opts.settingsOverride),
    modelParams: resolveModelParams(lane.tier, h, opts.settingsOverride),
  });

  const primaryHost = ranked[0];
  const primary = toTarget(primaryHost);

  // CR-3: ranked fallback chain. All entries stay at the SAME tier.
  const rest = ranked.slice(1);
  let fallbackChain: RouteTarget[] = rest.map(toTarget);
  if (fallbackToClaude) {
    const claudeIdx = fallbackChain.findIndex((t) => isClaudeHost(t.hostKind));
    if (claudeIdx >= 0) {
      const [claudeLast] = fallbackChain.splice(claudeIdx, 1);
      fallbackChain.push(claudeLast); // demote to last-resort
    }
  }

  const decision: RoutingDecision = {
    taskId: lane.taskId,
    host: primary.host,
    hostKind: primary.hostKind,
    tier: primary.tier,
    model: primary.model,
    modelParams: primary.modelParams,
    fallbackChain,
    affinityScore: rankScore(primaryHost, lane),
    degraded: false,
    independence: "strong",
    reason:
      `primary=${primary.host}(${primary.hostKind}) tier=${primary.tier} ` +
      `model=${primary.model ?? "(host default — no Guild-mapped model)"}; ${fallbackChain.length} fallback(s); ` +
      `backend=${requiredBackend ?? "any"}; workType=${lane.workType ?? "none"}`,
    rejected,
    notes: [
      "budget-cap deferred (oc-budget-cap, CR-6); spend recorded via telemetry stub",
    ],
  };

  // CR-6 telemetry spend stub.
  opts.onDecision?.(decision);

  return decision;
}

// ── planTeamRouting — per-specialist backend selection ────────────────────────

/**
 * Route every specialist to its backend THROUGH the CR-1 routing function — the
 * launcher's CH-1 wiring point.
 */
export function planTeamRouting(
  specialists: Array<
    SpecialistDispatchContract & {
      host_kind?: HostKind;
      tier?: Tier;
      capabilityRequirements?: CapabilityRequirements;
    }
  >,
  hosts: RoutableHost[],
  opts: PlanTeamRoutingOpts
): SpecialistRoute[] {
  const { localHostId, tier = "mid", mode = "auto", ...routeOpts } = opts;
  return specialists.map((s) => {
    const laneTier: Tier = s.tier ?? tier;
    const decision = route(
      {
        taskId: s.name,
        tier: laneTier,
        mode,
        preferredHostKind: s.host_kind,
        capabilityRequirements: s.capabilityRequirements,
      },
      hosts,
      routeOpts
    );
    return {
      specialist: s.name,
      hostKind: decision.hostKind,
      decision,
      backend: decision.host === localHostId ? "tmux" : "remote",
    };
  });
}
