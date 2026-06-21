/**
 * scripts/lib/capability/backend-factory.ts
 *
 * Backend factory — negotiation/selection logic for TeamBackend implementations.
 * W3 split placeholder: the factory logic is currently inline in the launcher
 * (agent-team-launcher.ts D5 backend-selection ladder). This module will own it
 * once W4 capability hardening extracts it here.
 *
 * Layer: capability/ — imports from core/contracts + shared/, never host/ directly.
 * Re-exports the backend classes for callers that import via this path.
 */

export { TmuxTeamBackend, probeTmuxAvailable, composeTmuxCommands, buildPrompt, paneCommand, shellQuote, wrapLoginShell, binaryForHostKind } from "../host/tmux-backend";
export { InProcessTeamBackend, SerialBackend, composeInProcessDispatch } from "../host/inprocess-backend";
export { RemoteTeamBackend, SshRemoteTransport, MockTransport } from "../host/remote-backend";
