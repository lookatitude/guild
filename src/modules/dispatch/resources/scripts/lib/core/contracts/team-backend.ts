/**
 * scripts/lib/core/contracts/team-backend.ts
 *
 * RE-4 — the `TeamBackend` seam: pure interfaces and shared types.
 * Extracted from team-backend.ts (W3 god-file split).
 *
 * Layer: core/contracts/ — zero host-specific imports.
 * Host implementations live in host/{tmux,inprocess,remote}-backend.ts.
 * The thin re-export shim at scripts/lib/team-backend.ts delegates here
 * (+ host/ modules) so all public entrypoint paths remain stable.
 */

import { spawnSync } from "child_process";
import type { HostKind } from "../../host-types";
import type { SpecialistDispatchContract } from "../../../../src/modules/dispatch/workflows/specialist-contract";
export type { HostKind };

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Specialist extends SpecialistDispatchContract {
  backend?: string;
  host_kind?: HostKind;
  tier?: "cheap" | "mid" | "powerful";
  default_tier?: "cheap" | "mid" | "powerful";
  capabilityRequirements?: {
    needs_pr?: boolean;
    needs_parallel?: boolean;
    needs_network?: boolean;
    isolation?: "worktree" | "none";
  };
  capability_scope?: string[];
  taskId?: string;
  /**
   * Agent-definition path written by guild:team-compose (project-root-relative).
   * For a project-local specialist this is `.guild/agents/<role>.md` and is
   * load-bearing: the host has no registered agent under this name, so dispatch
   * must carry the definition itself. For a shipped specialist it is
   * informational (`agents/<role>.md` in the plugin install).
   */
  definition?: string;
  /** Where the definition lives: plugin-shipped roster or project .guild/agents/. */
  definition_source?: "shipped" | "project";
}

/**
 * Host-generic subagent type used when a specialist has no host-registered
 * agent definition (definition_source === "project"): the lane runs as a
 * generic agent whose prompt carries the definition, at the specialist's own
 * tier — the former "degraded mid-tier" fallback made first-class.
 */
export const GENERIC_SUBAGENT_TYPE = "general-purpose";

// ── PaneAdapter seam (CH-2, cross-host ADR) ──────────────────────────────────

export interface PaneSpec {
  name: string;
  scope: string;
  runId: string;
  slug: string;
  prompt: string;
  hostKind: HostKind;
  taskId?: string;
  capability_scope?: string[];
  specialist?: string;
}

export interface PreflightResult {
  ok: boolean;
  message: string;
}

export interface PaneAdapter {
  readonly hostKind: HostKind;
  readonly adapterVersion: string;
  preflight(): PreflightResult;
  command(spec: PaneSpec): string;
  env(spec: PaneSpec): Record<string, string>;
  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request">;
}

export type AdapterResolver = (hostKind: HostKind) => PaneAdapter;

export type LaunchMode = "new-session" | "in-session";

export interface ParsedTmuxCommand {
  argv: string[];
  display: string;
}

// TE-08/ARCH-5: extend union with the serial floor (Rung 4 of the D5 substrate ladder).
export type TeamBackendKind = "tmux" | "in-process" | "remote" | "serial";

export interface TeamLaunchRequest {
  slug: string;
  runId: string;
  cwd: string;
  specialists: Specialist[];
  targetName: string;
  mode: LaunchMode;
  dryRun: boolean;
  orchestratorHostKind?: HostKind;
  teamPath?: string;
}

export interface GuildDispatchDescriptor {
  name: string;
  subagentType: string;
  model: string | null;
  env: Record<string, string>;
  prompt: string;
  /**
   * Set for project-local specialists: the `.guild/agents/<role>.md` definition
   * the prompt instructs the lane to adopt (subagentType is then the host's
   * generic type, not the specialist name).
   */
  definitionPath?: string | null;
}

export interface TeamLaunchResult {
  kind: TeamBackendKind;
  ok: boolean;
  plannedCommands: string[];
  orchestratorPaneId: string | null;
  teammatePaneIds: Record<string, string>;
  notes: string[];
  dispatchPlan?: GuildDispatchDescriptor[];
  parallelism?: 1;
  substrateDegradation?: {
    substrate: "serial";
    degraded_from: string;
    reason: string;
  };
}

export interface TeamBackend {
  readonly kind: TeamBackendKind;
  isAvailable(): boolean;
  launch(req: TeamLaunchRequest): TeamLaunchResult;
}

// ── Injectable subprocess runner (test seam) ─────────────────────────────────

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type RunFn = (
  cmd: string,
  args: string[],
  opts?: Record<string, unknown>
) => RunResult;

export const defaultRun: RunFn = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts } as never);
  return {
    status: r.status,
    stdout: (r.stdout as string | null) ?? "",
    stderr: (r.stderr as string | null) ?? "",
  };
};

// ── TmuxPlan ──────────────────────────────────────────────────────────────────

export interface TmuxPlan {
  mode: LaunchMode;
  targetName: string;
  commands: ParsedTmuxCommand[];
}

// ── TmuxSpawnOutcome ──────────────────────────────────────────────────────────

export interface TmuxSpawnOutcome {
  ok: boolean;
  failedCommand: ParsedTmuxCommand | null;
  stderr: string;
  orchestratorPaneId: string;
  teammatePaneIds: Record<string, string>;
}

// ── Remote transport types ────────────────────────────────────────────────────

export interface RemoteHostTarget {
  hostId: string;
  hostKind: HostKind;
  endpoint: string;
  loginShell?: string;
}

export interface RemoteConnectResult {
  ok: boolean;
  message: string;
}

export interface RemotePaneHandle {
  specialist: string;
  hostId: string;
  hostKind: HostKind;
  endpoint: string;
  remoteId: string;
}

export interface RemoteProbeResult {
  present: string[];
  missing: string[];
}

export interface RemoteTransport {
  readonly kind: string;
  connect(host: RemoteHostTarget): RemoteConnectResult;
  probe(host: RemoteHostTarget, binaries: string[]): RemoteProbeResult;
  spawn(host: RemoteHostTarget, spec: PaneSpec, command: string): RemotePaneHandle;
  send(handle: RemotePaneHandle, payload: string): void;
  teardown(): void;
}

export interface RemoteTeamBackendOpts {
  transport?: RemoteTransport;
  resolveHostTarget?: (spec: Specialist) => RemoteHostTarget;
  resolveAdapter?: AdapterResolver;
}

export interface MockTransportOpts {
  failConnectFor?: (host: RemoteHostTarget) => boolean;
  missingBinaries?: (host: RemoteHostTarget) => string[];
}
