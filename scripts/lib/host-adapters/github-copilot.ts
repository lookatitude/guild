/**
 * scripts/lib/host-adapters/github-copilot.ts
 *
 * verified-multi-host-support L2 — the `github-copilot` new-CLI adapter (bin `gh`,
 * subcommand `copilot`). A THIN instance of the shared wrapped-CLI base (ADR §4.2);
 * every concern value is read from HOST_REGISTRY_ROWS["github-copilot"], including the
 * `gh copilot` invocation (detection.subcommand). No host facts are re-declared here.
 */
import { createWrappedCliAdapter } from "./wrapped-cli-base";
import type { HostAdapter, HostAdapterResult, PreflightRequest } from "../host-adapter-contract";
import type { HostRegistryEntry } from "../host-registry-schema";

export function createGithubCopilotAdapter(entry?: HostRegistryEntry): HostAdapter {
  const base = createWrappedCliAdapter({ hostId: "github-copilot", label: "GitHub Copilot", entry });
  return {
    ...base,
    // Thin pass-through — NOT a re-implementation. See cursor.ts for why this
    // exists: the coverage gate scans the per-adapter FILE, but the logic
    // still lives in ONE place (wrapped-cli-base.ts, ADR §4.2).
    preflight(request?: PreflightRequest): HostAdapterResult {
      return base.preflight(request);
    },
  };
}
