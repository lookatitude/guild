import {
  createHostAdapter as createDefaultHostAdapter,
  type HostAdapter,
} from "./host-adapter-contract";
import { normalizeHostId } from "./host-id-namespace";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "./host-registry-schema";
import { createAgentsFileAdapter } from "./host-adapters/agents-file";
import { APP_HOSTS, createAppHostAdapter, type AppHostId } from "./host-adapters/app-host";
import { createAntigravityCliAdapter } from "./host-adapters/antigravity-cli";
import { createClaudeCodeCliAdapter } from "./host-adapters/claude-code-cli";
import { createCodexCliAdapter } from "./host-adapters/codex-cli";
import { createPiCliAdapter } from "./host-adapters/pi-cli";
import { createCursorAdapter } from "./host-adapters/cursor";
import { createGithubCopilotAdapter } from "./host-adapters/github-copilot";
import { createOpencodeAdapter } from "./host-adapters/opencode";
import { createRovoDevAdapter } from "./host-adapters/rovo-dev";

export function createHostAdapter(host: HostId | string): HostAdapter {
  const hostId = normalizeHostId(host);
  if (hostId === "claude-code-cli") return createClaudeCodeCliAdapter();
  if (hostId === "codex-cli") return createCodexCliAdapter();
  if (hostId === "pi-cli") return createPiCliAdapter();
  if (hostId === "antigravity-cli") return createAntigravityCliAdapter();
  if (hostId === "agents-file") return createAgentsFileAdapter();
  // verified-multi-host-support L2 (AC-ADP-1) — the 4 new-CLI hosts get a concrete
  // adapter on the shared wrapped-CLI base (each is a thin instance reading its registry
  // row). adapter_binding is "self", so they DO NOT hit the agents-file dereference below;
  // wiring them here keeps them off the fail-closed default adapter.
  if (hostId === "cursor") return createCursorAdapter();
  if (hostId === "github-copilot") return createGithubCopilotAdapter();
  if (hostId === "opencode") return createOpencodeAdapter();
  if (hostId === "rovo-dev") return createRovoDevAdapter();
  if (hostId !== null && (APP_HOSTS as readonly string[]).includes(hostId)) return createAppHostAdapter(hostId as AppHostId);
  // adapter_binding dereference (L0 ADR §3.1 / codex C-B2): an IDE file-surface row
  // (kiro/qoder/trae) DEREFERENCES the universal agents-file adapter. This branch MUST
  // precede the default fallback — otherwise an un-wired "agents-file"-bound id silently
  // falls to the fail-closed default adapter (a degraded mis-route) instead of the
  // agents-file adapter. Keyed on the registry `adapter_binding`, so any current-or-future
  // "agents-file"-bound id resolves correctly with no per-id edit (R2 / AC-REG-4: no hidden
  // per-host chain).
  if (hostId !== null && HOST_REGISTRY_ROWS[hostId]?.adapter_binding === "agents-file") {
    return createAgentsFileAdapter();
  }
  return createDefaultHostAdapter(host);
}

export function createAllHostAdapters(): Record<HostId, HostAdapter> {
  const out = {} as Record<HostId, HostAdapter>;
  for (const hostId of HOST_IDS) out[hostId] = createHostAdapter(hostId);
  return out;
}
