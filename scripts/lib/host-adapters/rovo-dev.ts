/**
 * scripts/lib/host-adapters/rovo-dev.ts
 *
 * verified-multi-host-support L2 — the `rovo-dev` new-CLI adapter (bin `acli`,
 * subcommand `rovodev`). A THIN instance of the shared wrapped-CLI base (ADR §4.2);
 * every concern value is read from HOST_REGISTRY_ROWS["rovo-dev"], including the
 * `acli rovodev` invocation (detection.subcommand). No host facts are re-declared here.
 */
import { createWrappedCliAdapter } from "./wrapped-cli-base";
import type { HostAdapter } from "../host-adapter-contract";
import type { HostRegistryEntry } from "../host-registry-schema";

export function createRovoDevAdapter(entry?: HostRegistryEntry): HostAdapter {
  return createWrappedCliAdapter({ hostId: "rovo-dev", label: "Rovo Dev", entry });
}
