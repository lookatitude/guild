import {
  createHostAdapter as createDefaultHostAdapter,
  type HostAdapter,
} from "./host-adapter-contract";
import { normalizeHostId } from "./host-id-namespace";
import { HOST_IDS, type HostId } from "./host-registry-schema";
import { createAgentsFileAdapter } from "./host-adapters/agents-file";
import { APP_HOSTS, createAppHostAdapter, type AppHostId } from "./host-adapters/app-host";
import { createAntigravityCliAdapter } from "./host-adapters/antigravity-cli";
import { createClaudeCodeCliAdapter } from "./host-adapters/claude-code-cli";
import { createCodexCliAdapter } from "./host-adapters/codex-cli";
import { createPiCliAdapter } from "./host-adapters/pi-cli";

export function createHostAdapter(host: HostId | string): HostAdapter {
  const hostId = normalizeHostId(host);
  if (hostId === "claude-code-cli") return createClaudeCodeCliAdapter();
  if (hostId === "codex-cli") return createCodexCliAdapter();
  if (hostId === "pi-cli") return createPiCliAdapter();
  if (hostId === "antigravity-cli") return createAntigravityCliAdapter();
  if (hostId === "agents-file") return createAgentsFileAdapter();
  if (hostId !== null && (APP_HOSTS as readonly string[]).includes(hostId)) return createAppHostAdapter(hostId as AppHostId);
  return createDefaultHostAdapter(host);
}

export function createAllHostAdapters(): Record<HostId, HostAdapter> {
  const out = {} as Record<HostId, HostAdapter>;
  for (const hostId of HOST_IDS) out[hostId] = createHostAdapter(hostId);
  return out;
}
