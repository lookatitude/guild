/**
 * scripts/lib/host-router.ts
 *
 * Cluster A — the capability routing function (Cluster A of the cross-host ADR).
 *
 * Contract (BY POINTER): docs/knowledge/decisions/v2-cross-host-orchestration.md
 *   §CR-1 (routing decision function), §CR-2 (capability pre-check),
 *   §CR-3 (ranked fallback chain — NO silent tier downgrade),
 *   §CR-4 (work-type → host affinity), §CR-5 (manifest freshness TTL),
 *   §CR-6 (budget cap deferred to v2.1 — telemetry spend stub only),
 *   §"Null codex/gemini tier-slot fill" (merge precedence).
 * Tier ladder is canonical in cost-aware-tiering-and-lean-context.md §1/§2.
 * The D5 `agent_mode` ladder (mode axis) is canonical in
 *   v2x-command-surface-dispatch-and-internalization.md.
 *
 * This is the deterministic three-axis compose function the cost ADR + RE-5 left
 * unwired: *mode* (D5) × *tier* (cost auto-scorer output) × *host* (RE-5
 * `guild.host_capability.v1` manifest). It is PURE and SYNCHRONOUS — no network
 * call, no filesystem read, no clock read unless `opts.now` is omitted — so it
 * satisfies the CR-1 "< 5 ms" budget and is trivially testable.
 *
 * It reads the REAL manifest shape emitted by scripts/write-host-capability.ts
 * (`tiers` / `models` / `tool_support` / `detected_at`), NOT the idealized field
 * names in the ADR prose (`supported_tiers` / `tier_models` / `tool_permissions`
 * / `advertised_at`). Optional forward-compatible extension fields
 * (`supported_tiers`, `tool_permissions`, `advertised_at`) are honored when a
 * future manifest carries them, and treated leniently when absent.
 *
 * Owned by tooling-engineer. RemoteTeamBackend (team-backend.ts) consumes this
 * function's decision when live cross-host dispatch lands a later wave; this
 * wave ships the policy + tests only.
 */

import type { HostCapabilityManifest, HostKind } from "../write-host-capability";

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
 * A routable host = the real RE-5 manifest, plus OPTIONAL forward-compatible
 * extension fields the ADR names but the v2.0 writer does not yet emit. Honored
 * when present, lenient when absent.
 */
export type RoutableHost = HostCapabilityManifest & {
  /** ADR `supported_tiers`. Absent ⇒ derived from `tiers[tier]` truthiness. */
  supported_tiers?: Tier[];
  /** ADR `tool_permissions` allow-list (CR-2). Absent ⇒ no advertised restriction. */
  tool_permissions?: string[];
  /** ADR `advertised_at`. Absent ⇒ fall back to `detected_at` for freshness. */
  advertised_at?: string;
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
   */
  settingsOverride?: Partial<Record<Tier, Partial<Record<HostKind, string>>>>;
  /**
   * CR-6 telemetry spend stub. Invoked once with the final decision so actual
   * routing spend can be recorded now; the budget CAP itself is deferred to v2.1
   * (oc-budget-cap). Default: no-op.
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
  /** Ranked alternatives at the SAME tier (CR-3 — no silent downgrade). */
  fallbackChain: RouteTarget[];
  /** Rank score of the selected primary (CR-1 step 2 affinity input). */
  affinityScore: number;
  reason: string;
  rejected: RejectedHost[];
  notes: string[];
}

// ── Built-in default tier ladder (claude fallback; cost ADR §1) ───────────────

const BUILTIN_DEFAULT_TIERS: Record<Tier, string> = {
  cheap: "haiku",
  mid: "sonnet",
  powerful: "opus",
};

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

/**
 * Soft re-ranking signal (CR-4). Returns a non-negative boost for a host_kind
 * given the work type. It NEVER hard-selects — capability pre-check (CR-2) and
 * fallback (CR-3) dominate; this only orders the already-qualifying hosts.
 */
export function affinityBoost(workType: WorkType | undefined, hostKind: HostKind): number {
  switch (workType) {
    case "interactive_lifecycle":
      // Hooks are Claude Code-specific.
      return hostKind === "claude" ? AFFINITY_BOOST : 0;
    case "adversarial_review":
      // Independence from the creator host → prefer a NON-claude host.
      return hostKind !== "claude" ? AFFINITY_BOOST : 0;
    case "background_implementation":
      // Detached headless execution → codex.
      return hostKind === "codex" ? AFFINITY_BOOST : 0;
    case "parallel_local_lanes":
      // Native tmux team backend → claude.
      return hostKind === "claude" ? AFFINITY_BOOST : 0;
    case "graph_extraction":
    case undefined:
    default:
      // Cheap-tier-wins / host-neutral.
      return 0;
  }
}

// ── Manifest helpers (read the REAL RE-5 shape, lenient on extensions) ────────

function manifestTimestamp(host: RoutableHost): number | null {
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
  // Explicit ADR `supported_tiers` extension wins when present…
  if (Array.isArray(host.supported_tiers)) {
    return host.supported_tiers.includes(tier);
  }
  // …else a tier is supported iff the manifest carries a non-empty model for it.
  const model = host.tiers?.[tier];
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
 * Null-slot fill (CR-1 step 4). Merge precedence:
 *   settings.json models.tiers[tier][host_kind]   (operator override)
 *     → host.tiers[tier]                           (RE-5 manifest fill)
 *     → built-in default                           (null ⇒ claude fallback)
 */
export function resolveModel(
  tier: Tier,
  host: RoutableHost,
  settingsOverride?: RouteOptions["settingsOverride"]
): string {
  const override = settingsOverride?.[tier]?.[host.host_kind];
  if (typeof override === "string" && override.trim()) return override.trim();
  const fromManifest = host.tiers?.[tier];
  if (typeof fromManifest === "string" && fromManifest.trim()) return fromManifest.trim();
  return BUILTIN_DEFAULT_TIERS[tier];
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
function hostKindRank(hostKind: HostKind): number {
  return hostKind === "claude" ? 0 : 1;
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
    if (!crossHostEnabled && host.host_kind !== "claude") {
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
    qualifying.push(host);
  }

  if (qualifying.length === 0) {
    throw new RouteError(lane.taskId, rejected);
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
    const claudeIdx = fallbackChain.findIndex((t) => t.hostKind === "claude");
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
    reason:
      `primary=${primary.host}(${primary.hostKind}) tier=${primary.tier} ` +
      `model=${primary.model}; ${fallbackChain.length} fallback(s); ` +
      `backend=${requiredBackend ?? "any"}; workType=${lane.workType ?? "none"}`,
    rejected,
    notes: [
      "budget-cap deferred to v2.1 (oc-budget-cap, CR-6); spend recorded via telemetry stub",
    ],
  };

  // CR-6 telemetry spend stub.
  opts.onDecision?.(decision);

  return decision;
}
