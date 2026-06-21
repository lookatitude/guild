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
// W4 D2: tierDefaults() is the runtime-computed single source for tier→model defaults.
// Replaces the hand-typed `claudeDefaults` switch that was duplicated ×3 (audit A2).
import { tierDefaultsForHost } from "./tier-defaults";

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
// EXACT Claude Code CLI (not the claude *family*). Some call sites gate on a CLI-native
// capability that the desktop/web/app variants do NOT share (e.g. native PreToolUse ask,
// in-process independent agents). For those, `isClaudeHost` (family-wide) is too broad —
// use this exact check. Behavior-equivalent to the historical `hostKind === "claude"` literal
// (only the `claude` HostKind maps to the `claude-code-cli` registry id), but registry-sourced.
export function isClaudeCli(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind) === "claude-code-cli";
}
// EXACT Codex CLI (not the codex family/app). Behavior-equivalent to the historical
// `hostKind === "codex"` literal (only `codex` maps to `codex-cli`), but registry-sourced.
export function isCodexCli(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind) === "codex-cli";
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

// ── Built-in default tier ladder (W4 D2: runtime-from-registry) ──────────────

// W4 D2 SINGLE-SOURCE: `getDefaultModelTierMap` now delegates to `tierDefaultsForHost`
// (scripts/lib/capability/tier-defaults.ts), which reads the tier→model slots from
// the HOST_REGISTRY_ROWS at runtime. No hand-typed model names here.
// Adding a host means editing HOST_REGISTRY_ROWS only — zero edits here.
// Parity proof: rearch-tier-defaults-parity.test.ts asserts computed == prior literals
// for all 9 hosts (anti-vacuous: a divergent row fails the test).
export function getDefaultModelTierMap(host: HostKind): Record<Tier, string> {
  return tierDefaultsForHost(host);
}
