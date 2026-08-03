/**
 * scripts/lib/team-backend.ts — THIN RE-EXPORT SHIM (W3 god-file split)
 *
 * Public entrypoint preserved for backward compatibility per public-entrypoints.txt.
 * All implementation has moved to:
 *   scripts/lib/core/contracts/team-backend.ts  — interfaces + shared types
 *   scripts/lib/host/tmux-backend.ts            — TmuxTeamBackend + helpers
 *   scripts/lib/host/inprocess-backend.ts       — InProcessTeamBackend + SerialBackend
 *   scripts/lib/host/remote-backend.ts          — RemoteTeamBackend + transports
 *   scripts/lib/capability/backend-factory.ts   — factory re-exports
 *
 * Importers of this path continue to resolve unchanged.
 */

export type {
  HostKind,
  Specialist,
  PaneSpec,
  PreflightResult,
  PaneAdapter,
  AdapterResolver,
  LaunchMode,
  ParsedTmuxCommand,
  TeamBackendKind,
  TeamLaunchRequest,
  GuildDispatchDescriptor,
  TeamLaunchResult,
  TeamBackend,
  RunResult,
  RunFn,
  TmuxPlan,
  TmuxSpawnOutcome,
  RemoteHostTarget,
  RemoteConnectResult,
  RemotePaneHandle,
  RemoteProbeResult,
  RemoteHookProbeResult,
  TeardownVerdict,
  RemoteTransport,
  MockTransportOpts,
  RemoteTeamBackendOpts,
} from "./core/contracts/team-backend";
export {
  shellQuote,
  wrapLoginShell,
  buildPrompt,
  paneCommand,
  composeTmuxCommands,
  probeTmuxAvailable,
  TmuxTeamBackend,
} from "./host/tmux-backend";
export { composeInProcessDispatch, InProcessTeamBackend, SerialBackend } from "./host/inprocess-backend";
export { binaryForHostKind } from "./host/tmux-backend";
export { MockTransport, SshRemoteTransport, RemoteTeamBackend } from "./host/remote-backend";
