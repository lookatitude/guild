/**
 * scripts/lib/host-adapters/opencode.ts
 *
 * verified-multi-host-support L2 — the `opencode` new-CLI adapter (bin `opencode`).
 * A THIN instance of the shared wrapped-CLI base (ADR §4.2); every concern value is read
 * from HOST_REGISTRY_ROWS["opencode"]. No host facts are re-declared here.
 */
import { createWrappedCliAdapter } from "./wrapped-cli-base";
import type { HostAdapter } from "../host-adapter-contract";
import type { HostRegistryEntry } from "../host-registry-schema";

export function createOpencodeAdapter(entry?: HostRegistryEntry): HostAdapter {
  return createWrappedCliAdapter({ hostId: "opencode", label: "opencode", entry });
}
