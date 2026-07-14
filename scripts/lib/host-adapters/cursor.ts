/**
 * scripts/lib/host-adapters/cursor.ts
 *
 * verified-multi-host-support L2 — the `cursor` new-CLI adapter (bin `cursor-agent`).
 * A THIN instance of the shared wrapped-CLI base (ADR §4.2); every concern value is read
 * from HOST_REGISTRY_ROWS["cursor"]. No host facts are re-declared here.
 */
import { createWrappedCliAdapter } from "./wrapped-cli-base";
import type { HostAdapter, HostAdapterResult, PreflightRequest } from "../host-adapter-contract";
import type { HostRegistryEntry } from "../host-registry-schema";

export function createCursorAdapter(entry?: HostRegistryEntry): HostAdapter {
  const base = createWrappedCliAdapter({ hostId: "cursor", label: "Cursor", entry });
  return {
    ...base,
    // Thin pass-through — NOT a re-implementation. The session-open preflight
    // surface (V2 init-config-goal §V) must be visible per-adapter file (the
    // host-open-preflight-coverage gate scans the file, not the shared base),
    // but the actual logic still lives in ONE place (wrapped-cli-base.ts,
    // ADR §4.2 — no host facts or behavior re-declared here).
    preflight(request?: PreflightRequest): HostAdapterResult {
      return base.preflight(request);
    },
  };
}
