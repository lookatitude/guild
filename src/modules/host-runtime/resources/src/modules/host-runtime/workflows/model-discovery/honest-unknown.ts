/**
 * src/modules/host-runtime/workflows/model-discovery/honest-unknown.ts
 *
 * Honest-`unknown` discovery adapters (catalog §6) for every target class the
 * T0 evidence matrix shows has NO authoritative availability-listing seam:
 *
 *  - `claude-cli-subscription` — the server-backed picker check is interactive
 *    only; no headless listing exists. Post-dispatch `modelUsage` upgrades
 *    evidence per catalog §4 (owned by the transition machinery, not here).
 *  - `claude-app` / `claude-web` — no programmatic surface at all (SC-3).
 *  - `claude-gateway-bedrock` / `-vertex` / `-foundry` — gateway-NATIVE
 *    evidence only, and none is evidenced today. The Anthropic `/v1/models`
 *    availability contract is NEVER projected onto a gateway (catalog §2/§6).
 *  - `codex-cli-api-key` — a distinct target from `codex-cli-chatgpt`; no
 *    listing was evidenced under API-key auth, so it resolves honest unknown
 *    (binding adapters to evidenced seams only).
 *
 * Optional static hints fill METADATA and emit at most `advertised`
 * (confidence low) — they can never produce `available` (catalog §4 hard rule).
 */

import {
  DiscoveryAdapter,
  DiscoveryIo,
  RawDiscoveryResult,
  RawModelEntry,
} from "./adapter-contract";

export const HONEST_UNKNOWN_ADAPTER_VERSION = "1.0.0";

export interface StaticHint {
  canonical_id: string;
  display_name?: string;
  aliases?: string[];
  model_family?: string;
}

/** Static-hint rows → advertised(low) metadata entries; never inventory, never `available`. */
export function staticHintEntries(hints: StaticHint[]): RawModelEntry[] {
  return hints.map((h) => ({
    canonical_id: h.canonical_id,
    display_name: h.display_name,
    aliases: h.aliases,
    model_family: h.model_family,
    reasoning_efforts: [],
    default_effort: null,
    provider_priority: null,
    provider_default: false,
    visibility: "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: {},
    evidence_source: "static_hint",
    contract_states_availability: false,
  }));
}

export function makeHonestUnknownAdapter(
  targetId: string,
  opts: { staticHints?: StaticHint[]; surfaceNote?: string } = {}
): DiscoveryAdapter {
  const hints = opts.staticHints ?? [];
  const adapterId = `honest-unknown-${targetId}`;
  return {
    adapter_id: adapterId,
    adapter_version: HONEST_UNKNOWN_ADAPTER_VERSION,
    target_id: targetId,
    method: hints.length > 0 ? "static_hint" : "none",
    tool_versions: null,
    async discover(io: DiscoveryIo): Promise<RawDiscoveryResult> {
      const started = io.monotonicMs();
      return {
        adapter_id: adapterId,
        adapter_version: HONEST_UNKNOWN_ADAPTER_VERSION,
        target_id: targetId,
        method: hints.length > 0 ? "static_hint" : "none",
        source_ref: opts.surfaceNote ?? "no evidenced availability-listing surface",
        // The receipt itself is honest: no listing surface exists for this
        // target, so discovery is `unsupported` and the target-level evidence
        // state stays `unknown` (static hints only fill model metadata).
        status: "unsupported",
        latency_ms: Math.max(0, io.monotonicMs() - started),
        failure_reason: "surface_absent",
        models: staticHintEntries(hints),
      };
    },
  };
}

/** The §6 honest-unknown target rows, ready-made. */
export const claudeCliSubscriptionAdapter = makeHonestUnknownAdapter("claude-cli-subscription", {
  surfaceNote: "picker is interactive-only; headless entitlement unprovable pre-dispatch",
});
export const claudeAppAdapter = makeHonestUnknownAdapter("claude-app", {
  surfaceNote: "no programmatic discovery surface exists",
});
export const claudeWebAdapter = makeHonestUnknownAdapter("claude-web", {
  surfaceNote: "no programmatic discovery surface exists",
});
export const claudeGatewayBedrockAdapter = makeHonestUnknownAdapter("claude-gateway-bedrock", {
  surfaceNote: "gateway-native evidence only; no availability listing evidenced",
});
export const claudeGatewayVertexAdapter = makeHonestUnknownAdapter("claude-gateway-vertex", {
  surfaceNote: "gateway-native evidence only; no availability listing evidenced",
});
export const claudeGatewayFoundryAdapter = makeHonestUnknownAdapter("claude-gateway-foundry", {
  surfaceNote: "gateway-native evidence only; no availability listing evidenced",
});
export const codexCliApiKeyAdapter = makeHonestUnknownAdapter("codex-cli-api-key", {
  surfaceNote: "no listing evidenced under API-key auth (distinct target from codex-cli-chatgpt)",
});
