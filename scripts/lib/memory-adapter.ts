/**
 * scripts/lib/memory-adapter.ts
 *
 * R6 host-neutral memory adapter. The core chooses a transport from advertised
 * host capability and records the retrieval/degradation path; `.guild/` remains
 * the canonical memory store regardless of transport.
 */

import { recall, resolveCompositeConfig, type RecallResult } from "./recall";
import { discoverGuild, type GuildDiscovery } from "./guild-discovery";

export type MemoryTransport = "mcp" | "http-mcp" | "bridge-package" | "filesystem-bm25";

export interface MemoryCapabilities {
  mcp?: boolean;
  httpMcp?: boolean;
  bridgePackage?: boolean;
  filesystem?: boolean;
}

export interface MemoryQuery {
  cwd: string;
  query: string;
  category?: string;
  limit?: number;
  capabilities: MemoryCapabilities;
  runtime?: {
    mcp?: (query: MemoryQuery) => MemoryPayload | null | undefined;
    httpMcp?: (query: MemoryQuery) => MemoryPayload | null | undefined;
    bridgePackage?: (query: MemoryQuery) => MemoryPayload | null | undefined;
    filesystem?: (query: MemoryQuery, discovery: GuildDiscovery) => MemoryPayload;
  };
}

export interface MemoryPayload {
  results?: unknown[];
  recall?: RecallResult;
}

export interface MemoryReceipt {
  schema_version: "guild.memory_retrieval.v1";
  transport: MemoryTransport;
  degraded: boolean;
  degradation_reason: string | null;
  active_root: string;
  canonical_memory: GuildDiscovery["canonicalMemory"];
  payload: MemoryPayload;
}

export function selectMemoryTransport(caps: MemoryCapabilities): MemoryTransport {
  if (caps.mcp) return "mcp";
  if (caps.httpMcp) return "http-mcp";
  if (caps.bridgePackage) return "bridge-package";
  return "filesystem-bm25";
}

function fallbackPayload(query: MemoryQuery, discovery: GuildDiscovery): MemoryPayload {
  if (query.runtime?.filesystem) return query.runtime.filesystem(query, discovery);
  // Config-driven composite recall (models.compositeRecall + importanceGate) — resolved here
  // so the host-adapter memory path honors the default, not just the recall CLI. undefined ⇒
  // legacy BM25-only ranking.
  const composite = resolveCompositeConfig(discovery.activeRoot);
  return {
    recall: recall(query.query, {
      cwd: discovery.activeRoot,
      category: query.category,
      limit: query.limit,
      _indexConfig: { enabled: false },
      ...(composite ? { composite } : {}),
    }),
  };
}

export function queryGuildMemory(query: MemoryQuery): MemoryReceipt {
  const discovery = discoverGuild(query.cwd);
  const transport = selectMemoryTransport(query.capabilities);
  let payload: MemoryPayload | null | undefined = null;

  if (transport === "mcp" && query.runtime?.mcp) payload = query.runtime.mcp(query);
  if (transport === "http-mcp" && query.runtime?.httpMcp) payload = query.runtime.httpMcp(query);
  if (transport === "bridge-package" && query.runtime?.bridgePackage) payload = query.runtime.bridgePackage(query);

  const hasNativePayload = payload !== null && payload !== undefined;
  if (!payload) payload = fallbackPayload(query, discovery);

  return {
    schema_version: "guild.memory_retrieval.v1",
    transport: hasNativePayload ? transport : "filesystem-bm25",
    degraded: !hasNativePayload && transport !== "filesystem-bm25",
    degradation_reason: !hasNativePayload && transport !== "filesystem-bm25"
      ? `${transport} unavailable; used filesystem-bm25 fallback`
      : null,
    active_root: discovery.activeRoot,
    canonical_memory: discovery.canonicalMemory,
    payload,
  };
}
