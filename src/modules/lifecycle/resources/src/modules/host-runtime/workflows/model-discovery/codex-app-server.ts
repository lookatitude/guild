/**
 * src/modules/host-runtime/workflows/model-discovery/codex-app-server.ts
 *
 * Codex app-server `model/list` discovery adapter — the PREFERRED long-term
 * Codex seam (catalog §6; live shape captured 2026-07-30 as run evidence [P3],
 * codex-cli 0.146.0). Emits `advertised`: the protocol contract never states
 * that a listing reflects account entitlements (matrix §5), so a listing alone
 * can never ground `available`.
 *
 * Provider effort order, visibility, upgrade/deprecation metadata, and
 * serviceTiers are preserved per the catalog §6 row. Provider output is DATA:
 * strictly schema-validated, never executed; validation failures surface as
 * the redacted `parse_rejected` failure class.
 */

import {
  DiscoveryAdapter,
  DiscoveryIo,
  DiscoveryParseRejected,
  RawDiscoveryResult,
  RawModelEntry,
  failureResult,
} from "./adapter-contract";

export const CODEX_APP_SERVER_ADAPTER_ID = "codex-app-server-model-list";
export const CODEX_APP_SERVER_ADAPTER_VERSION = "1.0.0";

/** Range evidenced live: model/list verified on codex-cli 0.146.0 ([P3]). */
export const CODEX_APP_SERVER_TOOL_VERSIONS = { min: "0.144.0", maxExclusive: "2.0.0" };

interface AppServerReasoningEffort {
  reasoningEffort: string;
}

interface AppServerModel {
  id: string;
  model: string;
  displayName?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: AppServerReasoningEffort[];
  defaultReasoningEffort?: string | null;
  inputModalities?: string[];
  additionalSpeedTiers?: string[];
  serviceTiers?: Array<{ id: string; name?: string }>;
  defaultServiceTier?: string | null;
  isDefault?: boolean;
  upgrade?: string | null;
  upgradeInfo?: { model?: string | null; migrationMarkdown?: string | null } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Strict structural validation of a `model/list` JSON-RPC RESULT (the value of
 * the response's `result` field: `{ data: [...], nextCursor }`).
 */
export function parseModelListResult(raw: unknown): AppServerModel[] {
  if (!isRecord(raw)) throw new DiscoveryParseRejected("result is not an object");
  const data = raw.data;
  if (!Array.isArray(data)) throw new DiscoveryParseRejected("result.data is not an array");
  const models: AppServerModel[] = [];
  data.forEach((entry, i) => {
    if (!isRecord(entry)) throw new DiscoveryParseRejected(`data[${i}] is not an object`);
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      throw new DiscoveryParseRejected(`data[${i}].model is not a non-empty string`);
    }
    if (entry.supportedReasoningEfforts !== undefined) {
      if (!Array.isArray(entry.supportedReasoningEfforts)) {
        throw new DiscoveryParseRejected(`data[${i}].supportedReasoningEfforts is not an array`);
      }
      for (const [j, eff] of entry.supportedReasoningEfforts.entries()) {
        if (!isRecord(eff) || typeof eff.reasoningEffort !== "string") {
          throw new DiscoveryParseRejected(`data[${i}].supportedReasoningEfforts[${j}].reasoningEffort missing`);
        }
      }
    }
    if (entry.hidden !== undefined && typeof entry.hidden !== "boolean") {
      throw new DiscoveryParseRejected(`data[${i}].hidden is not a boolean`);
    }
    models.push(entry as unknown as AppServerModel);
  });
  return models;
}

/** Map validated app-server models to raw catalog entries (provider order preserved). */
export function normalizeAppServerModels(models: AppServerModel[]): RawModelEntry[] {
  return models.map((m) => ({
    canonical_id: m.model,
    display_name: typeof m.displayName === "string" ? m.displayName : undefined,
    // No family field is provider-stated on this surface.
    reasoning_efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
    default_effort: typeof m.defaultReasoningEffort === "string" ? m.defaultReasoningEffort : null,
    provider_priority: null, // app-server exposes order, not a numeric priority field
    provider_default: m.isDefault === true,
    visibility: m.hidden === true ? "hidden" : "listed",
    deprecation: {
      upgrade_to: typeof m.upgrade === "string" ? m.upgrade : null,
      migration_note:
        typeof m.upgradeInfo?.migrationMarkdown === "string" ? m.upgradeInfo.migrationMarkdown : null,
    },
    capabilities: {
      image_input: Array.isArray(m.inputModalities) ? m.inputModalities.includes("image") : undefined,
      // Superset-schema extensions preserved from the provider listing:
      service_tiers: Array.isArray(m.serviceTiers) ? m.serviceTiers.map((t) => t.id) : [],
      additional_speed_tiers: Array.isArray(m.additionalSpeedTiers) ? m.additionalSpeedTiers : [],
      default_service_tier: typeof m.defaultServiceTier === "string" ? m.defaultServiceTier : null,
    },
    evidence_source: "native_list",
    contract_states_availability: false, // entitlement semantics contractually undefined
  }));
}

export const codexAppServerAdapter: DiscoveryAdapter = {
  adapter_id: CODEX_APP_SERVER_ADAPTER_ID,
  adapter_version: CODEX_APP_SERVER_ADAPTER_VERSION,
  target_id: "codex-app-server",
  method: "native_list",
  tool_versions: CODEX_APP_SERVER_TOOL_VERSIONS,
  async discover(io: DiscoveryIo, opts = {}): Promise<RawDiscoveryResult> {
    const started = io.monotonicMs();
    const elapsed = () => Math.max(0, io.monotonicMs() - started);
    if (!io.jsonRpcCall) {
      return failureResult(this, "unsupported", "io_unavailable", elapsed(), CODEX_APP_SERVER_ADAPTER_ID);
    }
    const includeHidden = (opts as { includeHidden?: boolean }).includeHidden === true;
    const result = await io.jsonRpcCall("model/list", includeHidden ? { includeHidden: true } : {});
    const models = normalizeAppServerModels(parseModelListResult(result));
    return {
      adapter_id: CODEX_APP_SERVER_ADAPTER_ID,
      adapter_version: CODEX_APP_SERVER_ADAPTER_VERSION,
      target_id: "codex-app-server",
      method: "native_list",
      source_ref: "codex-app-server model/list",
      status: "ok",
      latency_ms: elapsed(),
      failure_reason: null,
      models,
    };
  },
};
