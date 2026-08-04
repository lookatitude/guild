/**
 * src/modules/host-runtime/workflows/model-discovery/openai-api.ts
 *
 * OpenAI API `GET /v1/models` discovery adapter (catalog §6). The contract
 * says only "Lists the currently available models" with NO statement that the
 * list is filtered to the requesting key/org/project (matrix §6 [C11]), so a
 * listing supports at most high-confidence `advertised` — never `available` —
 * until dispatch evidence upgrades a specific (target, model) pair.
 *
 * The listing is metadata-poor (id / created / owned_by only): no capability,
 * context-window, or effort metadata exists on this surface.
 */

import {
  DiscoveryAdapter,
  DiscoveryIo,
  DiscoveryParseRejected,
  RawDiscoveryResult,
  RawModelEntry,
  failureResult,
} from "./adapter-contract";

export const OPENAI_API_ADAPTER_ID = "openai-api-models";
export const OPENAI_API_ADAPTER_VERSION = "1.0.0";
export const OPENAI_API_MODELS_URL = "https://api.openai.com/v1/models";

interface OpenAiApiModel {
  id: string;
  created?: number;
  owned_by?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Versioned family-mapping table (adapter v1): a catalog family is recorded
 * only for exact, known prefixes; anything else stays `unknown` (never guessed).
 */
export function openAiFamilyFor(id: string): string {
  if (id.startsWith("gpt-")) return "gpt";
  return "unknown";
}

/** Strict structural validation of the `GET /v1/models` response. */
export function parseOpenAiModelsResponse(raw: unknown): OpenAiApiModel[] {
  if (!isRecord(raw)) throw new DiscoveryParseRejected("response is not an object");
  if (!Array.isArray(raw.data)) throw new DiscoveryParseRejected("response.data is not an array");
  const models: OpenAiApiModel[] = [];
  raw.data.forEach((entry, i) => {
    if (!isRecord(entry)) throw new DiscoveryParseRejected(`data[${i}] is not an object`);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new DiscoveryParseRejected(`data[${i}].id is not a non-empty string`);
    }
    models.push(entry as unknown as OpenAiApiModel);
  });
  return models;
}

/** Map validated OpenAI models to raw catalog entries (provider order preserved). */
export function normalizeOpenAiModels(models: OpenAiApiModel[]): RawModelEntry[] {
  return models.map((m) => ({
    canonical_id: m.id,
    model_family: openAiFamilyFor(m.id),
    reasoning_efforts: [], // not stated on this surface — never copied from other targets
    default_effort: null,
    provider_priority: null,
    provider_default: false,
    visibility: "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: {},
    evidence_source: "native_list",
    contract_states_availability: false, // scope-ambiguous contract ⇒ advertised at most
  }));
}

export const openAiApiAdapter: DiscoveryAdapter = {
  adapter_id: OPENAI_API_ADAPTER_ID,
  adapter_version: OPENAI_API_ADAPTER_VERSION,
  target_id: "openai-api",
  method: "native_list",
  tool_versions: null,
  async discover(io: DiscoveryIo): Promise<RawDiscoveryResult> {
    const started = io.monotonicMs();
    const elapsed = () => Math.max(0, io.monotonicMs() - started);
    if (!io.httpGetJson) {
      return failureResult(this, "unsupported", "io_unavailable", elapsed(), OPENAI_API_ADAPTER_ID);
    }
    const raw = await io.httpGetJson(OPENAI_API_MODELS_URL, {});
    const models = normalizeOpenAiModels(parseOpenAiModelsResponse(raw));
    return {
      adapter_id: OPENAI_API_ADAPTER_ID,
      adapter_version: OPENAI_API_ADAPTER_VERSION,
      target_id: "openai-api",
      method: "native_list",
      source_ref: "openai-api GET /v1/models",
      status: "ok",
      latency_ms: elapsed(),
      failure_reason: null,
      models,
    };
  },
};
