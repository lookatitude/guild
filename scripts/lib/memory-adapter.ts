/**
 * Backward-compatible public entrypoint.
 *
 * Host-neutral memory retrieval lives in src/modules/context so the reorg can
 * move internals without breaking imports from scripts/lib/memory-adapter.
 */

import * as memoryAdapterImpl from "../../src/domains/knowledge/memory-adapter";

export const selectMemoryTransport = memoryAdapterImpl.selectMemoryTransport;
export const queryGuildMemory = memoryAdapterImpl.queryGuildMemory;
export type {
  MemoryTransport,
  MemoryCapabilities,
  MemoryQuery,
  MemoryPayload,
  MemoryReceipt,
} from "../../src/domains/knowledge/memory-adapter";
