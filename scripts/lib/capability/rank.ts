/**
 * scripts/lib/capability/rank.ts
 *
 * Host ranking helpers — affinity boost, backend-for-mode, default tier map.
 * Extracted from host-router.ts (W3 god-file split).
 *
 * Depends: host-registry (via tiebreak layer), shared/ — no host/ imports.
 */

import { hostKindToRegistryId } from "../host-registry";
import type { HostKind } from "../host-types";
import type { LaneRequest, RoutableHost, Tier, AgentMode, BackendCapability, WorkType } from "./router";

const AFFINITY_BOOST = 10;

// ── Registry-sourced host-identity predicates (P1-L7) ──────────────────────────
// The registry (via the HostKind→registry id bridge) is the single authority for
// "is this the claude/codex reference host". Replaces scattered `=== "claude"` /
// `=== "codex"` literals that read identity from a parallel source.
export function isClaudeHost(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind)?.startsWith("claude-") ?? false;
}
export function isCodexHost(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind)?.startsWith("codex-") ?? false;
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

/** Rank a single host for a given lane. */
export function rankScore(host: RoutableHost, lane: LaneRequest): number {
  let s = 0;
  // A team.yaml `host:` selection is a strong preference (ranks that host first)
  // but is still subject to capability pre-check + fallback (CR-3).
  if (lane.preferredHostKind && host.host_kind === lane.preferredHostKind) s += 100;
  s += affinityBoost(lane.workType, host.host_kind);
  return s;
}

// ── Mode → required backend capability ──────────────────────────────────────────

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

// ── Built-in default tier ladder (claude fallback; cost ADR §1) ────────────────

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
