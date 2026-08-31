/**
 * src/modules/host-runtime/workflows/model-discovery/claude-api.ts
 *
 * Claude API `GET /v1/models` discovery adapter — the ONLY listing surface
 * whose contract states account availability for the requesting target
 * ("The Models API response can be used to determine which models are
 * available for use in the API" — matrix §3 [C2]). A live authenticated
 * listing may therefore ground `available`, scoped to the `claude-api` target
 * ONLY (catalog §2: never projected to subscriptions, apps, or gateways).
 *
 * The documented response schema is the reference shape for the normalized
 * capability object, including per-model effort support flags (low…max).
 * NOTE: no authenticated call is made by this module itself — IO is injected;
 * absent IO/credentials resolve to an honest `unsupported` receipt.
 */

import {
  DiscoveryAdapter,
  DiscoveryIo,
  DiscoveryParseRejected,
  RawDiscoveryResult,
  RawModelEntry,
  failureResult,
} from "./adapter-contract";

export const CLAUDE_API_ADAPTER_ID = "claude-api-models";
export const CLAUDE_API_ADAPTER_VERSION = "1.0.0";
export const CLAUDE_API_MODELS_URL = "https://api.anthropic.com/v1/models";
export const CLAUDE_API_VERSION_HEADER = "2023-06-01";
/** Bounded pagination: the contract allows limit 1–1000; we never loop unbounded. */
export const CLAUDE_API_MAX_PAGES = 5;

/** Documented per-level effort flags, in the schema's own order ([C2]). */
export const CLAUDE_EFFORT_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"] as const);

interface ClaudeApiModel {
  id: string;
  display_name?: string;
  created_at?: string;
  type?: string;
  capabilities?: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strict structural validation of one `GET /v1/models` response page. */
export function parseClaudeModelsPage(raw: unknown): {
  models: ClaudeApiModel[];
  hasMore: boolean;
  lastId: string | null;
} {
  if (!isRecord(raw)) throw new DiscoveryParseRejected("response is not an object");
  if (!Array.isArray(raw.data)) throw new DiscoveryParseRejected("response.data is not an array");
  const models: ClaudeApiModel[] = [];
  raw.data.forEach((entry, i) => {
    if (!isRecord(entry)) throw new DiscoveryParseRejected(`data[${i}] is not an object`);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new DiscoveryParseRejected(`data[${i}].id is not a non-empty string`);
    }
    if (entry.capabilities !== undefined && !isRecord(entry.capabilities)) {
      throw new DiscoveryParseRejected(`data[${i}].capabilities is not an object`);
    }
    models.push(entry as unknown as ClaudeApiModel);
  });
  return {
    models,
    hasMore: raw.has_more === true,
    lastId: typeof raw.last_id === "string" ? raw.last_id : null,
  };
}

/** Effort support flags → provider-ordered effort list (schema order, [C2]). */
export function effortsFromCapabilities(capabilities: Record<string, unknown> | undefined): string[] {
  const effort = capabilities?.effort;
  if (!isRecord(effort)) return [];
  return CLAUDE_EFFORT_LEVELS.filter((level) => effort[level] === true);
}

/** Map validated Claude API models to raw catalog entries (provider order preserved). */
export function normalizeClaudeApiModels(models: ClaudeApiModel[]): RawModelEntry[] {
  return models.map((m) => ({
    canonical_id: m.id,
    display_name: typeof m.display_name === "string" ? m.display_name : undefined,
    model_family: "claude", // this authenticated first-party catalog lists Claude models
    reasoning_efforts: effortsFromCapabilities(m.capabilities),
    default_effort: null, // the listing carries support flags, not a default
    provider_priority: null,
    provider_default: false,
    visibility: "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: isRecord(m.capabilities) ? m.capabilities : {},
    evidence_source: "contract_api_list",
    // The one row whose contract states availability for the requesting target.
    contract_states_availability: true,
  }));
}

export const claudeApiAdapter: DiscoveryAdapter = {
  adapter_id: CLAUDE_API_ADAPTER_ID,
  adapter_version: CLAUDE_API_ADAPTER_VERSION,
  target_id: "claude-api",
  method: "contract_api_list",
  tool_versions: null, // versioned REST surface; gated by anthropic-version header, not CLI version
  async discover(io: DiscoveryIo): Promise<RawDiscoveryResult> {
    const started = io.monotonicMs();
    const elapsed = () => Math.max(0, io.monotonicMs() - started);
    if (!io.httpGetJson) {
      return failureResult(this, "unsupported", "io_unavailable", elapsed(), CLAUDE_API_ADAPTER_ID);
    }
    const all: RawModelEntry[] = [];
    let url = `${CLAUDE_API_MODELS_URL}?limit=1000`;
    for (let page = 0; page < CLAUDE_API_MAX_PAGES; page += 1) {
      const raw = await io.httpGetJson(url, { "anthropic-version": CLAUDE_API_VERSION_HEADER });
      const { models, hasMore, lastId } = parseClaudeModelsPage(raw);
      all.push(...normalizeClaudeApiModels(models));
      if (!hasMore || !lastId) {
        return {
          adapter_id: CLAUDE_API_ADAPTER_ID,
          adapter_version: CLAUDE_API_ADAPTER_VERSION,
          target_id: "claude-api",
          method: "contract_api_list",
          source_ref: "claude-api GET /v1/models",
          status: "ok",
          latency_ms: elapsed(),
          failure_reason: null,
          models: all,
        };
      }
      url = `${CLAUDE_API_MODELS_URL}?limit=1000&after_id=${encodeURIComponent(lastId)}`;
    }
    // Page cap hit: an honest partial listing, never an unbounded loop.
    return {
      adapter_id: CLAUDE_API_ADAPTER_ID,
      adapter_version: CLAUDE_API_ADAPTER_VERSION,
      target_id: "claude-api",
      method: "contract_api_list",
      source_ref: "claude-api GET /v1/models",
      status: "partial",
      latency_ms: elapsed(),
      failure_reason: null,
      models: all,
    };
  },
};
