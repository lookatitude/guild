/**
 * src/modules/host-runtime/workflows/host-capability-manifest.ts
 *
 * Canonical type contract for guild.host_capability.v1. The writer remains at
 * scripts/write-host-capability.ts for CLI compatibility; routers and tests can
 * import this module-owned contract directly.
 */

import type { HostKind } from "./host-types";

export type { HostKind };

export interface HostCapabilityManifest {
  schema_version: "guild.host_capability.v1";
  host_id: string;
  host_kind: HostKind;
  /**
   * TE-07/DQ-5: canonical ADR name (`advertised_at`).
   * Old manifests on disk still carry `detected_at` — the router's lenient
   * reader handles both via `advertised_at ?? detected_at`.
   */
  advertised_at: string;
  source: string;
  /**
   * TE-07/DQ-5: canonical ADR name (`tier_models`).
   * Old manifests on disk still carry `tiers` — the router's lenient reader
   * handles both via `tier_models ?? tiers`.
   */
  tier_models: {
    cheap: string;
    mid: string;
    powerful: string;
  };
  /**
   * TE-07/DQ-5: canonical ADR field (`supported_tiers` array).
   * Derived from the tier_models keys at write time. The router prefers this
   * array for tier-support checks (supportsTier) when present.
   */
  supported_tiers: ("cheap" | "mid" | "powerful")[];
  /** Flat list of models this host can reach. */
  models: string[];
  /** Runtime feature support consulted by the cross-host router. */
  tool_support: {
    subagent: boolean;
    agent_team: boolean;
    independent_agents: boolean;
    tmux: boolean;
    mcp: boolean;
    /**
     * HK-07 (D-OBS-1 / 11-security.md §enforcement): whether this host natively
     * supports the `PreToolUse ask` permission primitive (Claude Code's
     * permissionDecision:"ask" hook output). When false the pre-tool-use hook
     * degrades to writing an `approval_request` file to the agent-bus and
     * recording `permission_mode: degraded` in the security-event log.
     */
    pre_tool_use_ask: boolean;
  };
}
