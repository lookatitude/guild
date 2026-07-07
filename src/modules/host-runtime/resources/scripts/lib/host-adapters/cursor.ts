/**
 * scripts/lib/host-adapters/cursor.ts
 *
 * verified-multi-host-support L2 — the `cursor` new-CLI adapter (bin `cursor-agent`).
 * A THIN instance of the shared wrapped-CLI base (ADR §4.2); every concern value is read
 * from HOST_REGISTRY_ROWS["cursor"]. No host facts are re-declared here.
 */
import { createWrappedCliAdapter } from "./wrapped-cli-base";
import type { HostAdapter } from "../host-adapter-contract";
import type { HostRegistryEntry } from "../host-registry-schema";

export function createCursorAdapter(entry?: HostRegistryEntry): HostAdapter {
  return createWrappedCliAdapter({ hostId: "cursor", label: "Cursor", entry });
}
