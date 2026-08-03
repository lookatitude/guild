/**
 * src/modules/host-runtime/workflows/model-discovery/codex-debug-models.ts
 *
 * Codex CLI `codex debug models` discovery adapter — INTERIM seam behind a
 * VERSIONED parser (catalog §6). The debug surface has proven churn
 * (0.143.0 → 0.146.0 changed the catalog AND the effort vocabulary; run
 * evidence [P1]/[P2]), so the parser declares an exact supported range and
 * resolves honest `unsupported` outside it — never a guess. Prefer the
 * app-server `model/list` seam when reachable.
 *
 * Emits `advertised`: the listing is the subscription-visible catalog with no
 * contract stating dispatchability. `supported_in_api` is advertised catalog
 * metadata about ANOTHER target (matrix §4 F5) — preserved as metadata, never
 * projected into any API target's evidence.
 */

import {
  DiscoveryAdapter,
  DiscoveryIo,
  DiscoveryParseRejected,
  RawDiscoveryResult,
  RawModelEntry,
  failureResult,
} from "./adapter-contract";

export const CODEX_DEBUG_MODELS_ADAPTER_ID = "codex-debug-models";
export const CODEX_DEBUG_MODELS_ADAPTER_VERSION = "1.0.0";

/**
 * Parser v1 evidenced on codex-cli 0.146.0 ([P1]/[P2]); the 0.147+ shape is
 * unverified, so the range is deliberately narrow (out-of-range ⇒ unsupported).
 */
export const CODEX_DEBUG_MODELS_TOOL_VERSIONS = { min: "0.144.0", maxExclusive: "0.147.0" };

interface DebugModelEntry {
  slug: string;
  display_name?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort: string }>;
  visibility?: string;
  supported_in_api?: boolean;
  priority?: number;
  additional_speed_tiers?: string[];
  service_tiers?: Array<{ id: string }>;
  upgrade?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strict structural validation of the `codex debug models` JSON payload. */
export function parseDebugModelsOutput(stdout: string): DebugModelEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new DiscoveryParseRejected("stdout is not valid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new DiscoveryParseRejected("payload.models is not an array");
  }
  const entries: DebugModelEntry[] = [];
  parsed.models.forEach((entry, i) => {
    if (!isRecord(entry)) throw new DiscoveryParseRejected(`models[${i}] is not an object`);
    if (typeof entry.slug !== "string" || entry.slug.length === 0) {
      throw new DiscoveryParseRejected(`models[${i}].slug is not a non-empty string`);
    }
    if (entry.supported_reasoning_levels !== undefined) {
      if (!Array.isArray(entry.supported_reasoning_levels)) {
        throw new DiscoveryParseRejected(`models[${i}].supported_reasoning_levels is not an array`);
      }
      for (const [j, lvl] of entry.supported_reasoning_levels.entries()) {
        if (!isRecord(lvl) || typeof lvl.effort !== "string") {
          throw new DiscoveryParseRejected(`models[${i}].supported_reasoning_levels[${j}].effort missing`);
        }
      }
    }
    entries.push(entry as unknown as DebugModelEntry);
  });
  return entries;
}

/** Map validated debug-catalog entries to raw catalog entries (provider order preserved). */
export function normalizeDebugModels(entries: DebugModelEntry[]): RawModelEntry[] {
  return entries.map((m) => ({
    canonical_id: m.slug,
    display_name: typeof m.display_name === "string" ? m.display_name : undefined,
    reasoning_efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort),
    default_effort: typeof m.default_reasoning_level === "string" ? m.default_reasoning_level : null,
    provider_priority: typeof m.priority === "number" ? m.priority : null,
    provider_default: false, // the debug catalog carries no default flag
    visibility: m.visibility === "hide" ? "hidden" : "listed",
    deprecation: { upgrade_to: null, migration_note: null },
    capabilities: {
      // Advertised subscription-catalog metadata about the API target (F5):
      // preserved verbatim as metadata, never treated as dispatch evidence.
      supported_in_api: typeof m.supported_in_api === "boolean" ? m.supported_in_api : undefined,
      service_tiers: Array.isArray(m.service_tiers) ? m.service_tiers.map((t) => t.id) : [],
      additional_speed_tiers: Array.isArray(m.additional_speed_tiers) ? m.additional_speed_tiers : [],
    },
    evidence_source: "debug_catalog",
    contract_states_availability: false,
  }));
}

export const codexDebugModelsAdapter: DiscoveryAdapter = {
  adapter_id: CODEX_DEBUG_MODELS_ADAPTER_ID,
  adapter_version: CODEX_DEBUG_MODELS_ADAPTER_VERSION,
  target_id: "codex-cli-chatgpt",
  method: "debug_catalog",
  tool_versions: CODEX_DEBUG_MODELS_TOOL_VERSIONS,
  async discover(io: DiscoveryIo): Promise<RawDiscoveryResult> {
    const started = io.monotonicMs();
    const elapsed = () => Math.max(0, io.monotonicMs() - started);
    if (!io.execCapture) {
      return failureResult(this, "unsupported", "io_unavailable", elapsed(), CODEX_DEBUG_MODELS_ADAPTER_ID);
    }
    const { stdout } = await io.execCapture(["codex", "debug", "models"]);
    const models = normalizeDebugModels(parseDebugModelsOutput(stdout));
    return {
      adapter_id: CODEX_DEBUG_MODELS_ADAPTER_ID,
      adapter_version: CODEX_DEBUG_MODELS_ADAPTER_VERSION,
      target_id: "codex-cli-chatgpt",
      method: "debug_catalog",
      source_ref: "codex debug models",
      status: "ok",
      latency_ms: elapsed(),
      failure_reason: null,
      models,
    };
  },
};
