/**
 * scripts/lib/host-router.ts
 *
 * Cluster A — the capability routing function (Cluster A of the cross-host ADR).
 *
 * Contract (BY POINTER): docs/knowledge/decisions/v2-cross-host-orchestration.md
 *   §CR-1 (routing decision function), §CR-2 (capability pre-check),
 *   §CR-3 (ranked fallback chain — NO silent tier downgrade),
 *   §CR-4 (work-type → host affinity), §CR-5 (manifest freshness TTL),
 *   §CR-6 (budget cap deferred — telemetry spend stub only; issue: oc-budget-cap),
 *   §"Null codex/gemini tier-slot fill" (merge precedence).
 * Tier ladder is canonical in cost-aware-tiering-and-lean-context.md §1/§2.
 * The D5 `agent_mode` ladder (mode axis) is canonical in
 *   v2x-command-surface-dispatch-and-internalization.md.
 *
 * This is the deterministic three-axis compose function that resolves what the
 * cost ADR + RE-5 specified: *mode* (D5) × *tier* (cost auto-scorer output) ×
 * *host* (RE-5 `guild.host_capability.v1` manifest). It is PURE and SYNCHRONOUS — no network
 * call, no filesystem read, no clock read unless `opts.now` is omitted — so it
 * satisfies the CR-1 "< 5 ms" budget and is trivially testable.
 *
 * TE-07/DQ-5: the writer now emits canonical ADR field names (`advertised_at`,
 * `tier_models`, `supported_tiers`). The router reads canonical names first and
 * falls back to the pre-TE-07 names (`detected_at`, `tiers`) so that old
 * manifests already on disk remain usable without a forced re-bootstrap.
 * This lenient-reader pattern is the migration bridge — NOT the destination.
 * `tool_support` / `tool_permissions` alignment is a Wave-3 item.
 *
 * Owned by tooling-engineer. RemoteTeamBackend (team-backend.ts) consumes this
 * function's decision when live cross-host dispatch lands a later wave; this
 * wave ships the policy + tests only.
 */

import type { HostCapabilityManifest, HostKind } from "../write-host-capability";
import type { Specialist } from "./team-backend";
// G-11 (SC-6): the settings models.tiers value union (string | {model,effort?,
// verbosity?} | null) is unpacked ONLY via resolveTierModel — the router never
// assumes the operator-override slot is a plain string.
import { resolveTierModel, type TierHostValue } from "../read-guild-config";
// P1-L7: the host registry is the SoT for host IDENTITY. The router reads "is this
// the claude/codex reference host" THROUGH the registry (via the HostKind→registry
// id bridge) instead of comparing the raw HostKind literal from a parallel source.
// The bridge collapses each HostKind to its registry family id (claude-* → claude,
// codex-app → codex, antigravity-2 → antigravity), which is byte-aligned with
// resolveAuthorHost() — so Claude/Codex routing is byte-identical (SC-4 214/214 A/B).
import { hostKindToRegistryId } from "./host-registry";

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
   * G-11 (SC-6): values carry the full union — string | {model, effort?, verbosity?}
   * | null — and are unpacked exclusively through resolveTierModel().
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

/** The minimal `{host, tier, model}` choice (CR-1 return core). */
export interface RouteTarget {
  /** host_id from the manifest. */
  host: string;
  hostKind: HostKind;
  tier: Tier;
  model: string;
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
   * (independence lost — the observable signal defined in docs/v2/07 + 08).
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

// ── Built-in default tier ladder (claude fallback; cost ADR §1) ───────────────

// PHASE-1-DISPATCH-WAVE-1: hardcoded tier-map hoisted to a registry function.
// Currently returns Claude defaults for every host; per-host tuning is
// downstream work tracked in the cross-platform-compatibility followups
// (audit leak D-8: "Model-tier defaults are Claude-specific"). The exhaustive
// switch makes future per-host overrides a compile-time obligation — extending
// HostKind without adding a case will type-error here.
export function getDefaultModelTierMap(host: HostKind): Record<Tier, string> {
  // Claude defaults; reused by every host until per-host overrides land.
  const claudeDefaults: Record<Tier, string> = {
    cheap: "haiku",
    mid: "sonnet",
    powerful: "opus",
  };
  // Per-host overrides land here in downstream initiatives.
  switch (host) {
    case "claude":
    case "codex":
    case "gemini":
    case "pi":
    case "antigravity-2":
    case "claude-code-desktop":
    case "claude-code-web":
    case "codex-app":
    case "claude-ai-connector":
      return claudeDefaults;
  }
}

const DEFAULT_TTL_S = 3600;

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

// ── Mode → required backend capability ────────────────────────────────────────

export function backendForMode(mode: AgentMode): BackendCapability | null {
  switch (mode) {
    case "team":
      return "agent_team";
    case "agent":
      return "independent_agents";
    case "subagent":
      return "subagent";
    case "auto":
    default:
      // `auto` imposes no hard backend requirement — the D5 ladder resolves the
      // concrete backend downstream; here any host qualifies on the backend axis.
      return null;
  }
}

// ── CR-4 work-type → host affinity (soft signal) ─────────────────────────────

const AFFINITY_BOOST = 10;

// ── Registry-sourced host-identity predicates (P1-L7) ─────────────────────────
// The registry (via the HostKind→registry id bridge) is the single authority for
// "is this the claude/codex reference host". Replaces scattered `=== "claude"` /
// `=== "codex"` literals that read identity from a parallel source. Family-collapsed
// (claude-* → claude, codex-app → codex) — byte-aligned with resolveAuthorHost().
function isClaudeHost(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind) === "claude";
}
function isCodexHost(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind) === "codex";
}

/**
 * Soft re-ranking signal (CR-4). Returns a non-negative boost for a host_kind
 * given the work type. It NEVER hard-selects — capability pre-check (CR-2) and
 * fallback (CR-3) dominate; this only orders the already-qualifying hosts.
 */
export function affinityBoost(workType: WorkType | undefined, hostKind: HostKind): number {
  switch (workType) {
    case "interactive_lifecycle":
      // Hooks are Claude Code-specific.
      return isClaudeHost(hostKind) ? AFFINITY_BOOST : 0;
    case "adversarial_review":
      // Independence from the creator host → prefer a NON-claude host.
      return !isClaudeHost(hostKind) ? AFFINITY_BOOST : 0;
    case "background_implementation":
      // Detached headless execution → codex.
      return isCodexHost(hostKind) ? AFFINITY_BOOST : 0;
    case "parallel_local_lanes":
      // Native tmux team backend → claude.
      return isClaudeHost(hostKind) ? AFFINITY_BOOST : 0;
    case "graph_extraction":
    case undefined:
    default:
      // Cheap-tier-wins / host-neutral.
      return 0;
  }
}

// ── Manifest helpers (read the REAL RE-5 shape, lenient on extensions) ────────

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
  // CR-2: reject on a tool gap ONLY when the host advertises an allow-list. The
  // v2.0 RE-5 writer emits no `tool_permissions`, so absent ⇒ no restriction
  // (lenient-reader). Trust ENFORCEMENT (intersection) is the security ADR's.
  if (!requiredTools || requiredTools.length === 0) return [];
  if (!Array.isArray(host.tool_permissions)) return [];
  const allow = new Set(host.tool_permissions);
  return requiredTools.filter((t) => !allow.has(t));
}

/**
 * TE-02/ARCH-2: capability-requirements intersection.
 * Returns a list of unmet requirements (empty = no gap = host qualifies).
 *
 * Lenient-reader strategy:
 * - `needs_parallel` is derived from `tool_support` when `capability_set` is
 *   absent, because `tool_support` is ALREADY present in the v2.0 manifest.
 * - All other requirements are only enforced when the host explicitly advertises
 *   a `capability_set`. When absent, no gap is reported (no rejection).
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
  // (absent = no advertised restriction = lenient-reader, same as tool_permissions).
  if (cs) {
    if (reqs.needs_pr === true && !cs.needs_pr) gaps.push("needs_pr");
    if (reqs.needs_network === true && !cs.needs_network) gaps.push("needs_network");
    if (reqs.isolation === "worktree" && cs.isolation !== "worktree") {
      gaps.push("isolation:worktree");
    }
  }

  return gaps;
}

/**
 * Null-slot fill (CR-1 step 4). Merge precedence:
 *   settings.json models.tiers[tier][host_kind]   (operator override)
 *     → host.tier_models[tier]                     (RE-5 manifest fill, canonical)
 *     → host.tiers[tier]                           (legacy pre-TE-07 fallback)
 *     → built-in default                           (null ⇒ claude fallback)
 */
export function resolveModel(
  tier: Tier,
  host: RoutableHost,
  settingsOverride?: RouteOptions["settingsOverride"]
): string {
  // G-11 (SC-6): unpack the settings tier-value union (string | object form | null)
  // through the single helper. Plain-string overrides resolve byte-identically;
  // the object form contributes its `model` (effort/verbosity are dispatch-time
  // concerns, not part of the frozen RouteTarget shape).
  const override = resolveTierModel(settingsOverride, tier, host.host_kind).model;
  if (override !== null) return override;
  // TE-07: read canonical `tier_models`; fall back to legacy `tiers` for old manifests.
  const fromManifest = host.tier_models?.[tier] ?? host.tiers?.[tier];
  if (typeof fromManifest === "string" && fromManifest.trim()) return fromManifest.trim();
  // PHASE-1-DISPATCH-WAVE-1: was BUILTIN_DEFAULT_TIERS[tier]; now routed through
  // the per-host registry function. Wave-1 values are identical (Claude defaults
  // for every host) so behavior is byte-identical pending downstream per-host work.
  return getDefaultModelTierMap(host.host_kind)[tier];
}

// ── Ranking ───────────────────────────────────────────────────────────────────

function rankScore(host: RoutableHost, lane: LaneRequest): number {
  let s = 0;
  // A team.yaml `host:` selection is a strong preference (ranks that host first)
  // but is still subject to capability pre-check + fallback (CR-3).
  if (lane.preferredHostKind && host.host_kind === lane.preferredHostKind) s += 100;
  s += affinityBoost(lane.workType, host.host_kind);
  return s;
}

// Deterministic tiebreak after score: claude before codex, then host_id asc.
// P1-L7: "is claude" resolved through the registry bridge, not a raw literal.
function hostKindRank(hostKind: HostKind): number {
  return isClaudeHost(hostKind) ? 0 : 1;
}

// ── route() — CR-1 ─────────────────────────────────────────────────────────────

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
  const qualifying: RoutableHost[] = [];

  for (const host of hosts) {
    const tag = (reason: string) =>
      rejected.push({ hostId: host.host_id, hostKind: host.host_kind, reason });

    // cross_host.enabled=false ⇒ Claude-only (single-host behavior).
    // P1-L7: claude-identity via the registry bridge (SoT), not a raw literal.
    if (!crossHostEnabled && !isClaudeHost(host.host_kind)) {
      tag("cross-host disabled (defaults.cross_host.enabled=false)");
      continue;
    }
    // CR-5 freshness.
    if (isStale(host, now, ttlS)) {
      tag(`stale manifest (older than ${ttlS}s TTL)`);
      continue;
    }
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
    // TE-02/ARCH-2: capability requirements intersection (task_run.host.capability_requirements).
    const capGap = capabilityGap(host, lane.capabilityRequirements);
    if (capGap.length > 0) {
      tag(`capability requirements not met: ${capGap.join(", ")}`);
      continue;
    }
    qualifying.push(host);
  }

  // TE-02: degrade-not-throw.
  // When no host qualifies but at least one host manifest was supplied, route to
  // the least-bad candidate (highest rank score from ALL supplied hosts). The
  // cross-host filter is a qualifying rule but NOT a hard block for degradation:
  // "fall to the nearest available adapter" (docs/v2/08 §2) means we use whatever
  // is reachable, recording degraded:true + independence:weak. Only throw when
  // the host list is truly empty — no candidate at all.
  if (qualifying.length === 0) {
    if (hosts.length === 0) {
      throw new RouteError(lane.taskId, rejected);
    }

    // Rank all supplied hosts (same scoring + tiebreak as the normal path).
    const leastBad = [...hosts].sort((a, b) => {
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
  });

  const primaryHost = ranked[0];
  const primary = toTarget(primaryHost);

  // CR-3: ranked fallback chain. All entries stay at the SAME tier (a tier drop
  // requires an explicit escalation signal handled by the cost-ADR auto-score
  // retry path — never an automatic quality regression here). Same-tier
  // different-host alternatives, ordered by the same rank. A qualifying claude
  // host is the level-4 last resort, pushed to the end when fallbackToClaude.
  const rest = ranked.slice(1);
  let fallbackChain: RouteTarget[] = rest.map(toTarget);
  if (fallbackToClaude) {
    // P1-L7: claude-identity via the registry bridge (SoT), not a raw literal.
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
    fallbackChain,
    affinityScore: rankScore(primaryHost, lane),
    degraded: false,
    independence: "strong",
    reason:
      `primary=${primary.host}(${primary.hostKind}) tier=${primary.tier} ` +
      `model=${primary.model}; ${fallbackChain.length} fallback(s); ` +
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

// ── planTeamRouting — per-specialist backend selection (CH-1 launcher wiring) ─

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

/**
 * Route every specialist to its backend THROUGH the CR-1 routing function — the
 * launcher's CH-1 wiring point. For each specialist it builds a `LaneRequest`
 * (its `host:` brand becomes `preferredHostKind`) and calls `route()`; a
 * decision whose `host` equals `localHostId` runs as a local tmux pane,
 * otherwise it is a remote host (RemoteTeamBackend). Pure (delegates to the pure
 * `route()`); returns degraded decisions (never throws) if any lane cannot be
 * fully satisfied — the launcher reads `decision.degraded` to surface the trail.
 *
 * ARCH-6: each specialist may carry its own `tier` field (from the cost
 * auto-scorer result, threaded in by the execute-plan dispatch path). When
 * absent the specialist inherits `opts.tier` (default "mid").
 */
export function planTeamRouting(
  specialists: Array<
    Pick<Specialist, "name" | "scope" | "dependsOn"> & {
      host_kind?: HostKind;
      /**
       * ARCH-6: per-specialist tier from the cost auto-scorer. Overrides the
       * global `opts.tier` fallback for this lane only.
       */
      tier?: Tier;
      /**
       * GAP-A1/ARCH-2: per-lane capability requirements from team.yaml.
       * Forwarded into route()'s LaneRequest.capabilityRequirements so that
       * capabilityGap() runs in production. Absent ⇒ no capability constraint.
       * The launcher populates this from the SAME team.yaml source that the
       * task_run writer reads — ONE object feeds both the written descriptor
       * and the intersection, making the round-trip true and non-driftable.
       */
      capabilityRequirements?: CapabilityRequirements;
    }
  >,
  hosts: RoutableHost[],
  opts: PlanTeamRoutingOpts
): SpecialistRoute[] {
  const { localHostId, tier = "mid", mode = "auto", ...routeOpts } = opts;
  return specialists.map((s) => {
    const laneTier: Tier = s.tier ?? tier; // ARCH-6: per-specialist tier, else global default
    const decision = route(
      {
        taskId: s.name,
        tier: laneTier,
        mode,
        preferredHostKind: s.host_kind,
        // GAP-A1/ARCH-2: forward capability requirements so capabilityGap()
        // runs in the live path, not only in direct route() unit tests.
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
