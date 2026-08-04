/**
 * src/modules/host-runtime/workflows/model-discovery/index.ts
 *
 * Per-target discovery adapter registry — one adapter per session_context §2
 * target row, bound to the seams the T0 evidence matrix actually evidenced
 * (catalog §6). Normalization into guild.model_catalog.v1 and all evidence
 * semantics live in src/modules/capability/workflows/model-catalog.ts
 * (capability depends on host-runtime; never the reverse).
 */

import {
  DiscoveryAdapter,
  DiscoveryIo,
  DiscoveryStatus,
  RawDiscoveryResult,
  runAdapter,
} from "./adapter-contract";
import { claudeApiAdapter } from "./claude-api";
import { codexAppServerAdapter } from "./codex-app-server";
import { codexDebugModelsAdapter } from "./codex-debug-models";
import { openAiApiAdapter } from "./openai-api";
import {
  claudeAppAdapter,
  claudeCliSubscriptionAdapter,
  claudeGatewayBedrockAdapter,
  claudeGatewayFoundryAdapter,
  claudeGatewayVertexAdapter,
  claudeWebAdapter,
  codexCliApiKeyAdapter,
} from "./honest-unknown";

export * from "./adapter-contract";
export {
  CODEX_APP_SERVER_ADAPTER_ID,
  CODEX_APP_SERVER_ADAPTER_VERSION,
  CODEX_APP_SERVER_TOOL_VERSIONS,
  codexAppServerAdapter,
  normalizeAppServerModels,
  parseModelListResult,
} from "./codex-app-server";
export {
  CODEX_DEBUG_MODELS_ADAPTER_ID,
  CODEX_DEBUG_MODELS_ADAPTER_VERSION,
  CODEX_DEBUG_MODELS_TOOL_VERSIONS,
  codexDebugModelsAdapter,
  normalizeDebugModels,
  parseDebugModelsOutput,
} from "./codex-debug-models";
export {
  CLAUDE_API_ADAPTER_ID,
  CLAUDE_API_ADAPTER_VERSION,
  CLAUDE_API_MODELS_URL,
  CLAUDE_EFFORT_LEVELS,
  claudeApiAdapter,
  effortsFromCapabilities,
  normalizeClaudeApiModels,
  parseClaudeModelsPage,
} from "./claude-api";
export {
  OPENAI_API_ADAPTER_ID,
  OPENAI_API_ADAPTER_VERSION,
  OPENAI_API_MODELS_URL,
  normalizeOpenAiModels,
  openAiApiAdapter,
  openAiFamilyFor,
  parseOpenAiModelsResponse,
} from "./openai-api";
export {
  HONEST_UNKNOWN_ADAPTER_VERSION,
  claudeAppAdapter,
  claudeCliSubscriptionAdapter,
  claudeGatewayBedrockAdapter,
  claudeGatewayFoundryAdapter,
  claudeGatewayVertexAdapter,
  claudeWebAdapter,
  codexCliApiKeyAdapter,
  makeHonestUnknownAdapter,
  staticHintEntries,
  type StaticHint,
} from "./honest-unknown";

/** target_id → discovery adapter, for every §2 primary target row. */
export const DISCOVERY_ADAPTER_REGISTRY: Readonly<Record<string, DiscoveryAdapter>> = Object.freeze({
  "claude-cli-subscription": claudeCliSubscriptionAdapter,
  "claude-app": claudeAppAdapter,
  "claude-web": claudeWebAdapter,
  "claude-api": claudeApiAdapter,
  "claude-gateway-bedrock": claudeGatewayBedrockAdapter,
  "claude-gateway-vertex": claudeGatewayVertexAdapter,
  "claude-gateway-foundry": claudeGatewayFoundryAdapter,
  "codex-cli-chatgpt": codexDebugModelsAdapter,
  "codex-app-server": codexAppServerAdapter,
  "codex-cli-api-key": codexCliApiKeyAdapter,
  "openai-api": openAiApiAdapter,
});

/** Resolve the adapter for a target id; null for an unregistered target (honest, never guessed). */
export function adapterForTarget(targetId: string): DiscoveryAdapter | null {
  return DISCOVERY_ADAPTER_REGISTRY[targetId] ?? null;
}

// ── Codex seam preference (catalog §6: app-server model/list preferred) ──────

/**
 * The §6 preference order for discovering the Codex CLI catalog: the
 * app-server `model/list` JSON-RPC seam is the PREFERRED long-term seam; the
 * version-gated `codex debug models` parser is the interim fallback.
 */
export const CODEX_SEAM_PREFERENCE = Object.freeze(["app-server", "debug-models"] as const);
export type CodexSeam = (typeof CODEX_SEAM_PREFERENCE)[number];

export interface CodexDiscoveryOutcome {
  /** The result of the first seam that produced an honest listing (or the last honest failure). */
  result: RawDiscoveryResult;
  seam: CodexSeam;
  /** Audit trail of every seam tried, in preference order. */
  attempted: Array<{ seam: CodexSeam; status: DiscoveryStatus }>;
}

const CODEX_SEAM_ADAPTERS: Readonly<Record<CodexSeam, DiscoveryAdapter>> = Object.freeze({
  "app-server": codexAppServerAdapter,
  "debug-models": codexDebugModelsAdapter,
});

/**
 * Executable Codex seam selection: try app-server `model/list` first; fall
 * back to the versioned debug-models parser only when the preferred seam
 * cannot produce a listing (absent IO, out-of-range version, error/timeout).
 * TARGET-SAFE: each RawDiscoveryResult stays bound to the adapter's own
 * target row (`codex-app-server` vs `codex-cli-chatgpt`); normalizeDiscovery's
 * target guard still applies, so a fallback never projects one row's evidence
 * onto the other. When every seam fails, the LAST honest failure receipt is
 * returned — never a guess.
 */
export async function discoverCodexModels(
  io: DiscoveryIo,
  opts: { budgetMs?: number; toolVersion?: string } = {}
): Promise<CodexDiscoveryOutcome> {
  const attempted: Array<{ seam: CodexSeam; status: DiscoveryStatus }> = [];
  let last: { result: RawDiscoveryResult; seam: CodexSeam } | null = null;
  for (const seam of CODEX_SEAM_PREFERENCE) {
    const result = await runAdapter(CODEX_SEAM_ADAPTERS[seam], io, opts);
    attempted.push({ seam, status: result.status });
    last = { result, seam };
    if (result.status === "ok" || result.status === "partial") break;
  }
  // CODEX_SEAM_PREFERENCE is non-empty, so last is always set.
  return { result: last!.result, seam: last!.seam, attempted };
}
