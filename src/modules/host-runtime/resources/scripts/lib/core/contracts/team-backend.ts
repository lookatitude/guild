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
  /**
   * The raw cost-scorer score for this lane (rf-wi-03 / G3), when a producer has
   * one. Optional and audit-only: the tier guard records it in the dispatch line
   * but never gates on it (a per-lane pin legitimately overrides the score→tier
   * banding). Present ⇒ composeInProcessDispatch carries it as GUILD_TIER_SCORE.
   */
  score?: number;
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

// ── Structured producer marker (rf-wi-03 / G3) ───────────────────────────────
//
// Every Guild dispatch a producer composes carries this marker on BOTH the
// dispatch env (unforgeable structural carrier — `composeInProcessDispatch`,
// `paneCommand`) AND, via `buildPrompt`, as the prompt's line-1 identity anchor.
// It is the universal, machine-detectable signal that "a Guild producer built
// this dispatch" — the durable fix the backend-degradation guard's comment
// queued behind the descriptor work. Two effects:
//   - the backend-degradation guard's prompt-only rung can now BLOCK a lane that
//     carries NO producer marker (drift) once the marker is universal (G3-3);
//   - dispatch-attribution can read identity from a single line-1 anchor for
//     every dispatch, unblocking the removal of the legacy 300-char producer-head
//     parsing (rf-wi-07c / G7c — a downstream lane).
// The hooks bundle restates these literals (same doctrine as GENERIC_SUBAGENT_TYPE);
// keep the values in step.

/** The dispatch-env key + prompt line-1 key naming a producer-composed dispatch. */
export const DISPATCH_PRODUCER_ENV = "GUILD_DISPATCH_PRODUCER";
/** The producer marker's self-versioned schema token (the marker's value). */
export const DISPATCH_PRODUCER_TOKEN = "guild.dispatch.v1";

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
  /**
   * T6-R2-F5: the model this pane must actually run at, when the evidenced M2
   * gate selected one. Absent (the M0/M1 default) ⇒ the adapter emits its
   * legacy command byte-identically and the host picks its own model.
   */
  model?: string;
  /** Frozen model parameters for `model` (e.g. `{ model, effort }`). */
  modelParams?: Record<string, unknown>;
}

// ── T6-R2-F5: the ONE model-consumption rule, shared by every backend ────────
//
// The v2 selection reaches dispatch on the specialist's `modelProvenance`
// (stamped by planProductionDispatchModel). These two helpers are the ONLY
// place that reads it, so tmux panes, in-process descriptors, the serial floor
// and the remote backend can never disagree about which model a lane runs at.

/** The selected model for a lane, or null — null ⇒ legacy resolution, unchanged. */
export function dispatchModelForSpecialist(spec: Specialist | null | undefined): string | null {
  const prov = spec?.modelProvenance;
  if (!prov || prov.source !== "v2") return null;
  return typeof prov.selected_model === "string" && prov.selected_model.length > 0
    ? prov.selected_model
    : null;
}

/** Frozen model params for a lane (`{model, effort?}`), or undefined when no v2 model. */
export function dispatchModelParamsForSpecialist(
  spec: Specialist | null | undefined
): Record<string, unknown> | undefined {
  const model = dispatchModelForSpecialist(spec);
  if (model === null) return undefined;
  const effort = spec?.modelProvenance?.selected_effort;
  return { model, ...(typeof effort === "string" && effort.length > 0 ? { effort } : {}) };
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
  /**
   * rf-wi-04 item 1 — per-host hook-install preflight verdicts (remote backend).
   * A host with `installed:false` had the bypass flag WITHHELD from its Claude
   * panes (they launched bare) — recorded, never silent.
   */
  remoteHookProbes?: Array<{ hostId: string; endpoint: string; installed: boolean; detail: string }>;
  /**
   * rf-wi-04 item 2 — the teardown verdict from a rollback teardown (e.g. after a
   * spawn failure). `outcome === "orphaned"` ⇒ a remote lane may still be live.
   */
  remoteTeardown?: TeardownVerdict;
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
  /** Carried through from RemoteHostTarget so teardown can re-apply the same wrap. */
  loginShell?: string;
}

export interface RemoteProbeResult {
  present: string[];
  missing: string[];
}

/**
 * rf-wi-04 (G4) item 1 — the hook-install preflight verdict for a far host.
 * `installed:true` is the PRECONDITION that lets a remote Claude pane launch
 * under a resolved permission-mode bypass flag: it proves Guild's own hook
 * gate (PreToolUse etc.) is present on the remote, so bypassing the host's
 * native prompt does not remove a guardrail without a Guild-side one behind it.
 * `installed:false` ⇒ the pane MUST launch bare (no bypass flag) — an honest
 * partial, never an unsafe bypass.
 */
export interface RemoteHookProbeResult {
  installed: boolean;
  detail: string;
}

/**
 * rf-wi-04 (G4) item 2 — the teardown verdict. Teardown can no longer fail
 * silently: a spawn-fail + teardown-fail must SURFACE any pane whose kill hop
 * did not confirm, so a live remote lane is recorded (`orphaned`) rather than
 * leaked with no receipt describing it.
 */
export interface TeardownVerdict {
  /** "clean" ⇒ every tracked pane confirmed torn down; "orphaned" ⇒ ≥1 unknown. */
  outcome: "clean" | "orphaned";
  /** remoteIds whose kill hop returned success. */
  killed: string[];
  /** Panes whose teardown hop failed — they MAY still be live with no receipt. */
  orphaned: RemotePaneHandle[];
  detail: string;
}

export interface RemoteTransport {
  readonly kind: string;
  connect(host: RemoteHostTarget): RemoteConnectResult;
  probe(host: RemoteHostTarget, binaries: string[]): RemoteProbeResult;
  /**
   * rf-wi-04 item 1 — verify Guild's hook bundle is installed on the far host
   * BEFORE a remote Claude pane is trusted with a permission-mode bypass flag.
   * Distinct from `probe` (which only checks binaries on PATH): a host can have
   * `claude` + `tmux` yet no Guild plugin/hooks, in which case bypassing native
   * prompts would strip the host's own guardrail with nothing behind it.
   */
  probeHooks(host: RemoteHostTarget): RemoteHookProbeResult;
  /**
   * Spawn the pane's command on the remote host. Implementations MUST detach
   * the process (e.g. wrap in `tmux new-session -d`) so it outlives this call
   * — a bare blocking spawn can never work for a long-lived interactive lane.
   * There is no separate "send the task brief" channel: the command already
   * carries the full prompt as an argv, and GUILD_TASK_ASSIGNMENT (written by
   * the launcher pre-routing, per docs/v2 §08 `guild.task_assignment.v1`) is
   * already exported into the command's env by paneCommand/PaneAdapter — the
   * former inbox-file `send()` had no reader and duplicated both.
   */
  spawn(host: RemoteHostTarget, spec: PaneSpec, command: string): RemotePaneHandle;
  /**
   * Tear down every pane this transport spawned. Returns a {@link TeardownVerdict}
   * (rf-wi-04 item 2) so a failed teardown hop surfaces an orphaned lane instead
   * of vanishing — the former `void` return let a spawn-fail + teardown-fail
   * leave a live remote pane no receipt described.
   */
  teardown(): TeardownVerdict;
}

export interface RemoteTeamBackendOpts {
  transport?: RemoteTransport;
  resolveHostTarget?: (spec: Specialist) => RemoteHostTarget;
  resolveAdapter?: AdapterResolver;
  /**
   * rf-wi-04 item 3 — resolved `--permission-mode …` argv spliced onto a remote
   * CLAUDE pane's launch, applied ONLY when that host's hook-install preflight
   * (item 1) verified AND the caller passed these args. Absent/empty ⇒ BARE — the
   * remote path deliberately does NOT default to the local tmux bypass args,
   * because probeHooks proves the hook bundle is present, not that Claude loaded
   * it (a stale remote checkout would be a false positive). Remote bypass is
   * therefore OPT-IN on top of the presence proof. Codex/other panes are never
   * touched (only `hostKind === "claude"` consumes it).
   */
  claudeLaunchArgs?: string[];
  /**
   * rf-wi-04 item 2 (codex review Q2a, round 2) — durable sink for an orphaned-
   * lane warning, emitted at DETECTION time inside launch(). This exists because
   * the production caller wraps launch() in bounded retry (retry-lane.ts): a
   * later successful attempt DISCARDS an earlier failed attempt's result, which
   * would otherwise drop the orphan record surfaced only in that result. Emitting
   * here guarantees the orphan reaches a durable channel regardless of how the
   * caller handles the returned envelope. Defaults to a stderr writer.
   */
  warn?: (message: string) => void;
}

export interface MockTransportOpts {
  failConnectFor?: (host: RemoteHostTarget) => boolean;
  missingBinaries?: (host: RemoteHostTarget) => string[];
  /** rf-wi-04 item 1 — simulate the far-host hook-install verdict (default: not installed). */
  hooksInstalledFor?: (host: RemoteHostTarget) => boolean;
  /** rf-wi-04 item 2 — simulate a spawn failure on matching hosts. */
  failSpawnFor?: (host: RemoteHostTarget) => boolean;
  /** rf-wi-04 item 2 — simulate a teardown hop that leaves spawned panes orphaned. */
  orphanOnTeardown?: boolean;
}
