/**
 * scripts/lib/capability/backend-factory.ts
 *
 * Backend-class re-export facade for TeamBackend implementations — NOT a
 * factory. (Audit correction, plugin-audit-remediation G4c: the prior header
 * claimed "the factory logic is currently inline in the launcher ... this
 * module will own it once W4 extracts it here." That extraction never
 * happened, and a same-day attempt here is not honest-minimal: the D5
 * backend-SELECTION half (`resolveAgentMode` — team/agent/subagent) is a pure
 * function and could move, but backend CONSTRUCTION (`new TmuxTeamBackend`,
 * `new RemoteTeamBackend`) in agent-team-launcher.ts is tightly coupled to
 * launcher-local state this module has no business owning: `resolveAdapter()`
 * closures, cross-host endpoint config read from settings, bounded-retry
 * wiring, dead-lane checkpoint writers, and the launcher's own CLI stderr/
 * exit-code UX. Pulling construction out would mean either re-threading all of
 * that through factory parameters — no real simplification — or leaving
 * launcher behavior split across two files with no test seam covering the
 * split. Simplify or extract when the launcher itself is next materially
 * reworked, not as a drive-by here.)
 *
 * What this file actually does: a stable import path
 * (`scripts/lib/capability/backend-factory`) for the four TeamBackend
 * implementations, so callers don't need to know they live under `host/`.
 *
 * Layer note: despite the `capability/` path, these re-exports DO cross into
 * `host/` (TeamBackend implementations are inherently host-specific — tmux
 * processes, ssh transports). The former docblock claim ("imports from
 * core/contracts + shared/, never host/ directly") was never true of this
 * file's own import statements; corrected here rather than left stale.
 */

export { TmuxTeamBackend, probeTmuxAvailable, composeTmuxCommands, buildPrompt, paneCommand, shellQuote, wrapLoginShell, binaryForHostKind } from "../host/tmux-backend";
export { InProcessTeamBackend, SerialBackend, composeInProcessDispatch } from "../host/inprocess-backend";
export { RemoteTeamBackend, SshRemoteTransport, MockTransport } from "../host/remote-backend";
