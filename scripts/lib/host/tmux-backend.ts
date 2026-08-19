/**
 * scripts/lib/host/tmux-backend.ts
 *
 * TmuxTeamBackend — the shipping tmux implementation behind the TeamBackend seam.
 * Extracted from team-backend.ts (W3 god-file split).
 *
 * Layer: host/ — imports from core/contracts + shared/, no upward imports.
 */

import { hostKindToRegistryId, getRegistryEntry } from "../host-registry";
import { buildPrompt } from "../../../src/modules/prompting/workflows/team-prompt";
import type {
  AdapterResolver,
  PaneAdapter,
  LaunchMode,
  ParsedTmuxCommand,
  PaneSpec,
  RunFn,
  Specialist,
  TeamBackend,
  TeamLaunchRequest,
  TeamLaunchResult,
  TmuxPlan,
  TmuxSpawnOutcome,
  GuildDispatchDescriptor,
} from "../core/contracts/team-backend";
import type { ProjectDefinitionRefV1 } from "../core/contracts/project-definition-ref";
import {
  defaultRun,
  dispatchModelForSpecialist,
  dispatchModelParamsForSpecialist,
  DISPATCH_PRODUCER_ENV,
  DISPATCH_PRODUCER_TOKEN,
  resolvedSpecialistCapabilityScope,
  specialistDispatchKey,
} from "../core/contracts/team-backend";
import type { HostKind } from "../host-types";
// P1-L10 permission-policy machinery (issue #54): resolve the host-native
// launch flags a spawned Claude team pane should carry, instead of dropping
// the resolved host_mode on the floor and launching every pane bare (which
// stalls an unattended team run on a native permission prompt nobody is
// watching). See resolveTeamPaneHostMode's own comment for the team-pane
// "ask" -> "bypass_all" default and why it does not weaken Guild's own gates.
import {
  resolveHostLaunch,
  RUNTIME_DEFAULT_CONFIG,
  readRuntimePermissionConfig,
  type RuntimePermissionConfig,
} from "../permission-policy";
import type { HostMode } from "../permission-policy-schema";

// ── Pure command composition helpers ─────────────────────────────────────────

export function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function wrapLoginShell(command: string, loginShell: string): string {
  return `${loginShell} -lic ${shellQuote(command)}`;
}

export { buildPrompt };

// ── Worker-pane lifecycle (P0.4 / task-cell-runtime G4) ──────────────────────
//
// A completed worker's pane MUST disappear — the old tail `claude <prompt>; exec
// $SHELL` kept the pane alive after the agent exited, so "pane exists" no longer
// meant "worker alive" and the launcher's dismiss/reap could never tell a live
// worker from a lingering shell (audit finding P0.4). The default is now: run the
// worker, and let the pane close when the worker exits.
//
// An operator debug shell is available ONLY behind an explicit opt-in
// (`GUILD_PANE_DEBUG=1`, default OFF). To keep a debug shell from ever being
// confusable with a live worker (adversarial test 14), the debug tail RETITLES its
// own pane to the `guild-debug:` sentinel before dropping into the shell, so every
// liveness / termination check can exclude it via `isDebugShellTitle`.

/** Pane-title prefix stamped on an opt-in operator debug shell — NEVER a live worker. */
export const DEBUG_PANE_TITLE_PREFIX = "guild-debug:";

/** True when `GUILD_PANE_DEBUG=1` opts a completed worker's pane into an operator debug shell. */
export function paneDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["GUILD_PANE_DEBUG"] === "1";
}

/** A pane whose title carries the debug sentinel is an operator shell, not a live worker (AT14). */
export function isDebugShellTitle(title: string): boolean {
  return title.startsWith(DEBUG_PANE_TITLE_PREFIX);
}

// ── Host launch-flag resolution for spawned LOCAL tmux team panes (issue #54) ─
//
// A spawned team pane is unattended by definition — no operator sits in it to
// answer a native permission prompt. The capability_scope + security PreToolUse
// hooks are the REAL guardrail (permission-policy.ts's orthogonality invariant:
// host_mode can never lift a Guild gate), so a host-native "ask" prompt on a
// team pane adds no safety, only a stall.
//
// Scope, deliberately narrow: this overlay is wired ONLY inside
// composeTmuxCommands below — for EVERY Claude pane it builds (and, since issue
// #94, for a codex pane through its own separate resolver), whether or not
// `resolveAdapter` is wired for other (non-Claude) panes in the same local
// team. composeTmuxCommands is exclusively the LOCAL tmux path
// (`TmuxTeamBackend.plan()`); `RemoteTeamBackend` (remote-backend.ts) owns an
// entirely separate `commandFor` and never calls into this file's
// composeTmuxCommands, so this can never reach a remote/SSH pane. Guild's own
// hooks are certainly installed for any local tmux pane (same local Claude
// Code session that's running them). `paneCommand`'s own DEFAULT stays
// byte-identical to its pre-fix behavior (bare `claude <prompt>`, no flags) —
// so every OTHER caller is untouched:
//   - `ClaudePaneAdapter.command()` (pane-adapter.ts) delegates to
//     `paneCommand` with no launchArgs and stays the BARE path used for any
//     remote host whose hooks are unproven. rf-wi-04 (G4) closed the former
//     followup: RemoteTeamBackend now runs a hook-install preflight
//     (RemoteTransport.probeHooks — Phase 1.6 in remote-backend.ts) and, ONLY
//     when a far host proves Guild's hook bundle installed, resolves the remote
//     Claude pane's command through `paneCommand(..., claudeLaunchArgs)`
//     (bypassing the bare adapter) — so the permission-mode flag reaches a
//     remote pane exclusively behind the proven Guild-side guardrail. A host
//     that fails the preflight still launches bare (recorded, never silent).
//   - Codex WAS never touched here. Issue #94 changed that: now that a codex
//     pane's PreToolUse deny is wired and probe-verified, composeTmuxCommands
//     also resolves a codex pane's argv (resolveCodexTeamLaunchArgs, same
//     permissionConfig ladder) and hands it to the adapter — which still
//     withholds it unless the pane is scoped AND the probe passes. The two
//     resolvers stay separate functions so neither can be asked for the other
//     host's flags.

/**
 * Resolve the host_mode a spawned team pane should launch under, given the
 * project's `RuntimePermissionConfig`. An explicit non-"ask" `host_mode` (an
 * operator opting a run into a stricter posture) is honored verbatim. The
 * unset/default "ask" lifts to "bypass_all" for team panes specifically —
 * matching the field-verified interim patch from issue #54.
 */
export function resolveTeamPaneHostMode(config: RuntimePermissionConfig): HostMode {
  const configured = config.host_mode ?? "ask";
  return configured === "ask" ? "bypass_all" : configured;
}

/**
 * The Claude launch argv (e.g. `["--permission-mode", "bypassPermissions"]`)
 * for a local team pane. Hard-coded to `"claude"` — NOT a generic per-host
 * resolver — so this can never be asked to produce a Codex (or any other
 * host's) flag: there is no parameter through which a caller could request
 * one.
 */
export function resolveClaudeTeamLaunchArgs(
  config: RuntimePermissionConfig = RUNTIME_DEFAULT_CONFIG,
): string[] {
  return resolveHostLaunch("claude", resolveTeamPaneHostMode(config)).args;
}

/**
 * ISSUE #94 — the Codex launch argv for a local team pane, resolved from the
 * SAME `host_mode` ladder as Claude's. Codex used to be excluded here on
 * purpose: with no PreToolUse enforcement on that host, handing a codex pane a
 * bypass flag was a net safety regression. Now that the deny bridge is wired,
 * the exclusion is obsolete — but this function is only HALF the decision.
 *
 * Returning args does NOT mean a pane gets them. `CodexPaneAdapter` applies them
 * only behind its own gates: an explicit opt-in (these args), a scoped pane, and
 * a probe proving the deny actually executes. Whatever this resolves to, an
 * unproven box still launches bare.
 */
export function resolveCodexTeamLaunchArgs(
  config: RuntimePermissionConfig = RUNTIME_DEFAULT_CONFIG,
): string[] {
  return resolveHostLaunch("codex", resolveTeamPaneHostMode(config)).args;
}

export function paneCommand(
  prompt: string,
  runId: string,
  capabilityScope?: string[],
  taskId?: string,
  specialist?: string,
  debug: boolean = paneDebugEnabled(),
  /**
   * Extra argv spliced between the binary and the prompt (issue #54). Empty
   * by default — a caller that doesn't pass this gets the ORIGINAL,
   * pre-issue-#54 command, byte-for-byte. Only composeTmuxCommands's local
   * `hostKind === "claude"` branch supplies a non-empty value today
   * (`resolveClaudeTeamLaunchArgs`), regardless of whether a resolver is
   * wired for other (non-Claude) panes in the same local team; see this
   * file's header comment above `resolveTeamPaneHostMode` for why every
   * other caller (ClaudePaneAdapter/remote dispatch) stays untouched.
   */
  launchArgs: string[] = [],
  /**
   * T6-R2-F5: the evidenced-M2 selected model this pane must run at. Absent ⇒
   * the emitted command is byte-identical to the pre-model one (no --model, no
   * GUILD_MODEL export) — the flag-off path never changes a single byte. Rides
   * ALONGSIDE `launchArgs` (#54): the final argv is `${launchFragment}${modelArg}`.
   */
  model?: string,
  /** Exact v2 assignment pointer for a concrete TaskCell launch lane. */
  assignmentPath?: string,
  /** Exact TaskCell runtime identity for lifecycle trace and usage attribution. */
  taskCellInstanceId?: string,
  /**
   * Fix A (run-identity-and-dispatch W4/W5 lane): the pinned
   * `guild.project_definition_ref.v1` for this lane, exported verbatim as
   * GUILD_DEFINITION_REF so a claude tmux pane carries the EXACT hash-bound
   * definition bundle instead of dropping it (the pre-fix claude branch passed
   * nothing here while the codex/generic adapter branches carried the ref).
   * Absent ⇒ the emitted command is byte-identical to the pre-fix one.
   */
  definitionRef?: ProjectDefinitionRefV1,
): string {
  const taskFragment =
    taskId !== undefined && taskId.length > 0
      ? `export GUILD_TASK_ID=${shellQuote(taskId)}; `
      : "";
  const specialistFragment =
    specialist !== undefined && specialist.length > 0
      ? `export GUILD_SPECIALIST=${shellQuote(specialist)}; `
      : "";
  // Concrete TaskCell lanes carry the immutable v2 pointer. Legacy callers that
  // have not expanded per task retain the v1 specialist channel temporarily.
  const assignmentFragment =
    specialist !== undefined && specialist.length > 0
      ? `export GUILD_TASK_ASSIGNMENT=${shellQuote(assignmentPath ?? `.guild/runs/${runId}/tasks/${specialist}.json`)}; `
      : "";
  const taskCellInstanceFragment =
    taskCellInstanceId !== undefined && taskCellInstanceId.length > 0
      ? `export GUILD_TASK_CELL_INSTANCE_ID=${shellQuote(taskCellInstanceId)}; `
      : "";
  const statuslineFragment =
    process.env["GUILD_STATUSLINE"] === "1" ? `export GUILD_STATUSLINE=1; ` : "";
  const scopeFragment =
    capabilityScope !== undefined
      ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(capabilityScope))}; `
      : "";
  // Fix A: the hash-bound definition bundle rides the pane env verbatim. The
  // pane then READS and equality-checks that exact value before the host starts:
  // forwarding is therefore consumed on the substrate, not merely asserted by
  // the launcher. Any mutation or omission exits before `claude` can spawn.
  const serializedDefinitionRef =
    definitionRef !== undefined ? JSON.stringify(definitionRef) : null;
  const quotedDefinitionRef =
    serializedDefinitionRef !== null ? shellQuote(serializedDefinitionRef) : null;
  const definitionRefFragment =
    quotedDefinitionRef !== null
      ? `export GUILD_DEFINITION_REF=${quotedDefinitionRef}; ` +
        `test "$GUILD_DEFINITION_REF" = ${quotedDefinitionRef} || { ` +
        `echo '[GUILD_DEFINITION_REF] exact-carriage check failed' >&2; exit 66; }; `
      : "";
  // Worker teardown tail. Default (debug OFF): the pane closes when `claude` exits
  // — no lingering shell, so "pane alive" unambiguously means "worker alive".
  // Debug ON: retitle the pane to the `guild-debug:` sentinel FIRST (so liveness
  // checks never mistake it for a worker), print an unmistakable notice, then drop
  // into a shell for the operator.
  const launchFragment = launchArgs.length > 0 ? `${launchArgs.map(shellQuote).join(" ")} ` : "";
  const debugTitle = DEBUG_PANE_TITLE_PREFIX + (specialist !== undefined && specialist.length > 0 ? specialist : "orchestrator");
  // T6-R2-F5: `claude --model <selected>` is what makes the M2 selection real —
  // the pane process itself runs at the resolver's frozen model. No model ⇒ the
  // invocation is exactly the legacy `claude '<prompt>'`.
  const modelArg =
    model !== undefined && model.length > 0 ? `--model ${shellQuote(model)} ` : "";
  const modelFragment =
    model !== undefined && model.length > 0
      ? `export GUILD_MODEL=${shellQuote(model)}; `
      : "";
  const teardownTail = debug
    ? `command claude ${launchFragment}${modelArg}${shellQuote(prompt)}; ` +
      `tmux select-pane -t "$TMUX_PANE" -T ${shellQuote(debugTitle)} 2>/dev/null || true; ` +
      `echo ${shellQuote("[GUILD_PANE_DEBUG] worker process exited — this is an operator debug shell, NOT a live worker.")}; ` +
      `exec $SHELL`
    : `command claude ${launchFragment}${modelArg}${shellQuote(prompt)}`;
  return (
    `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; ` +
    // rf-wi-03 (G3) — the universal structured producer marker on every pane env,
    // parity with composeInProcessDispatch (the prompt also carries the line-1
    // twin via buildPrompt).
    `export ${DISPATCH_PRODUCER_ENV}=${shellQuote(DISPATCH_PRODUCER_TOKEN)}; ` +
    `export GUILD_RUN_ID=${shellQuote(runId)}; ` +
    taskFragment +
    specialistFragment +
    assignmentFragment +
    taskCellInstanceFragment +
    statuslineFragment +
    scopeFragment +
    modelFragment +
    // Keep the exact-carriage guard adjacent to the real host launch. The
    // verifier accepts only this generated grammar, so no wrapper, mutation,
    // or decoy command can fit between the equality check and `claude`.
    definitionRefFragment +
    teardownTail
  );
}

export function composeTmuxCommands(opts: {
  mode: LaunchMode;
  targetName: string;
  cwd: string;
  slug: string;
  runId: string;
  specialists: Specialist[];
  resolveAdapter?: AdapterResolver;
  orchestratorHostKind?: HostKind;
  teamPath?: string;
  /** Issue #54: the project's permission config, feeding paneCommand's host launch-flag resolution. */
  permissionConfig?: RuntimePermissionConfig;
}): ParsedTmuxCommand[] {
  const {
    mode,
    targetName,
    cwd,
    slug,
    runId,
    specialists,
    resolveAdapter,
    orchestratorHostKind = "claude",
    teamPath,
    permissionConfig = RUNTIME_DEFAULT_CONFIG,
  } = opts;
  const cmds: ParsedTmuxCommand[] = [];

  const commandFor = (spec: Specialist | null): string => {
    const hostKind: HostKind = spec?.host_kind ?? orchestratorHostKind;
    const capabilityScope = spec === null ? undefined : resolvedSpecialistCapabilityScope(spec);
    const prompt = buildPrompt(slug, runId, spec, teamPath, hostKind);
    // T6-R2-F5: an evidenced-M2 selection reaches the pane spawn HERE — both
    // the adapter path and the legacy inline path. `null` on every lane whose
    // provenance is legacy/shadow, so M0/M1 panes stay byte-identical.
    const model = dispatchModelForSpecialist(spec) ?? undefined;
    const modelParams = dispatchModelParamsForSpecialist(spec);
    // Issue #54: EVERY local Claude pane gets the resolved launch flags —
    // whether or not `resolveAdapter` is wired for OTHER (non-Claude) panes
    // in this same local team. composeTmuxCommands is exclusively the LOCAL
    // tmux path: RemoteTeamBackend (remote-backend.ts) owns its own separate
    // commandFor and never calls this function, so this branch can never run
    // for a remote/SSH pane — that's what keeps this scoped to the verified-
    // safe case (Guild's own hooks are certainly installed locally) without
    // needing to thread anything through pane-adapter.ts's ClaudePaneAdapter
    // (used by both local-mixed-host AND remote dispatch, so it stays
    // untouched — see resolveClaudeTeamLaunchArgs's header comment).
    // Resolved lazily, only when actually used, so there is no path where
    // this computation happens without a claude pane consuming it.
    if (hostKind === "claude") {
      return paneCommand(
        prompt,
        runId,
        capabilityScope,
        spec?.taskId,
        spec?.name,
        undefined, // keep paneCommand's own GUILD_PANE_DEBUG default
        resolveClaudeTeamLaunchArgs(permissionConfig),
        model,
        spec?.task_cell_assignment_path,
        spec?.task_cell_instance_id,
        // Fix A: the claude branch was the ONE local pane path that dropped the
        // pinned definition bundle (codex + generic adapter branches already
        // carried it). The exact hash-bound ref now rides GUILD_DEFINITION_REF.
        spec?.definition_ref,
      );
    }
    // ISSUE #94: a codex pane's opt-in bypass argv is resolved HERE, from the
    // same permissionConfig-driven host_mode ladder the claude branch above
    // uses. The adapter still withholds it unless the pane is scoped AND its
    // PreToolUse deny probe passes — see CodexPaneAdapter.command().
    if (hostKind === "codex" && resolveAdapter) {
      // Duck-typed rather than `instanceof CodexPaneAdapter`: pane-adapter.ts
      // already imports `paneCommand` from this file, so importing its class
      // back would close an import cycle for a one-line type test.
      const adapter = resolveAdapter("codex") as PaneAdapter & {
        withLaunchArgs?: (args: string[], projectCwd?: string) => PaneAdapter;
      };
      const codexAdapter =
        typeof adapter.withLaunchArgs === "function"
          ? adapter.withLaunchArgs(resolveCodexTeamLaunchArgs(permissionConfig), cwd)
          : adapter;
      return codexAdapter.command({
        name: spec ? specialistDispatchKey(spec) : "orchestrator",
        scope: spec ? "lane" : "orchestrator",
        runId,
        slug,
        prompt,
        hostKind,
        ...(spec?.taskId ? { taskId: spec.taskId } : {}),
        ...(capabilityScope ? { capability_scope: capabilityScope } : {}),
        ...(spec?.name ? { specialist: spec.name } : {}),
        ...(spec?.task_cell_assignment_path ? { assignmentPath: spec.task_cell_assignment_path } : {}),
        ...(spec?.task_cell_instance_id ? { taskCellInstanceId: spec.task_cell_instance_id } : {}),
        ...(spec?.definition_ref ? { definition_ref: spec.definition_ref } : {}),
        ...(model ? { model } : {}),
        ...(modelParams ? { modelParams } : {}),
      });
    }
    if (!resolveAdapter) {
      // Pre-#54 fallback contract, preserved verbatim: no resolver and a
      // non-claude host_kind (should not occur via agent-team-launcher.ts's
      // `adapterBacked` gate, but composeTmuxCommands is also called
      // directly in tests) — paneCommand always builds a plain `claude`
      // invocation with no launch flags.
      return paneCommand(
        prompt, runId, capabilityScope, spec?.taskId, spec?.name,
        undefined, [], undefined, spec?.task_cell_assignment_path, spec?.task_cell_instance_id,
      );
    }
    return resolveAdapter(hostKind).command({
      name: spec ? specialistDispatchKey(spec) : "orchestrator",
      scope: spec?.scope ?? "",
      runId,
      slug,
      prompt,
      hostKind,
      taskId: spec?.taskId,
      capability_scope: capabilityScope,
      specialist: spec?.name,
      assignmentPath: spec?.task_cell_assignment_path,
      taskCellInstanceId: spec?.task_cell_instance_id,
      ...(spec?.definition_ref ? { definition_ref: spec.definition_ref } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(modelParams !== undefined ? { modelParams } : {}),
    });
  };

  const orchestratorCmd = commandFor(null);

  if (mode === "new-session") {
    cmds.push({
      argv: [
        "tmux", "new-session", "-d", "-s", targetName, "-n", "orchestrator", "-c", cwd, orchestratorCmd,
      ],
      display:
        `tmux new-session -d -s ${shellQuote(targetName)} ` +
        `-n orchestrator -c ${shellQuote(cwd)} ` +
        shellQuote(orchestratorCmd),
    });
  } else {
    cmds.push({
      argv: ["tmux", "new-window", "-n", targetName, "-c", cwd, orchestratorCmd],
      display:
        `tmux new-window -n ${shellQuote(targetName)} ` +
        `-c ${shellQuote(cwd)} ${shellQuote(orchestratorCmd)}`,
    });
  }

  // Title the orchestrator's own pane (applies to the currently-active pane —
  // the one just created by new-session/new-window, before any split moves
  // "active" to a specialist pane below) so spawn() can identify it by title
  // in the pane listing, the same way specialist panes are identified.
  cmds.push({
    argv: ["tmux", "select-pane", "-T", "orchestrator"],
    display: `tmux select-pane -T orchestrator`,
  });

  for (const spec of specialists) {
    const cmd = commandFor(spec);
    cmds.push({
      argv: ["tmux", "split-window", "-t", targetName, "-c", cwd, cmd],
      display:
        `tmux split-window -t ${shellQuote(targetName)} ` +
        `-c ${shellQuote(cwd)} ${shellQuote(cmd)}`,
    });
    cmds.push({
      argv: ["tmux", "select-pane", "-T", specialistDispatchKey(spec)],
      display: `tmux select-pane -T ${shellQuote(specialistDispatchKey(spec))}`,
    });
  }

  cmds.push({
    argv: ["tmux", "select-layout", "-t", targetName, "tiled"],
    display: `tmux select-layout -t ${shellQuote(targetName)} tiled`,
  });

  if (mode === "in-session") {
    cmds.push({
      argv: ["tmux", "select-window", "-t", targetName],
      display: `tmux select-window -t ${shellQuote(targetName)}`,
    });
  }

  return cmds;
}

export function probeTmuxAvailable(run: RunFn = defaultRun): boolean {
  return run("tmux", ["-V"]).status === 0;
}

// ── Real termination primitive (task-cell-runtime G4, ADR D5) ────────────────
//
// The old `[DISMISS]`/`[AUTO-DISMISS]` was signal-only: it announced a dismissal
// but never killed a live worker's pane, and the reaper only pruned ALREADY-DEAD
// panes. `terminatePane` is the real thing: it kills the pane by id and CONFIRMS
// the death by polling that the pane_id is gone. A kill that does not confirm is an
// ORPHAN — the caller parks the attempt for the reaper, which simply calls this
// again (adversarial test 6). tmux being unavailable is a recorded DEGRADATION, not
// a silent success.

/** The set of live tmux pane ids, or null when tmux is unavailable / errored. */
export function livePaneIds(run: RunFn = defaultRun): Set<string> | null {
  const r = run("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  if (r.status !== 0) return null;
  return new Set(
    r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** True when `paneId` is present in the live pane listing. Fail-closed: unknown tmux state → not alive. */
export function isPaneAlive(paneId: string, run: RunFn = defaultRun): boolean {
  const ids = livePaneIds(run);
  return ids !== null && ids.has(paneId);
}

export interface TerminatePaneOutcome {
  /** True only when the pane is CONFIRMED gone after the kill. */
  ok: boolean;
  /** Whether the poll confirmed the pane_id is no longer live. */
  confirmed: boolean;
  mechanism: "tmux kill-pane";
  paneId: string;
  /** Number of confirmation polls performed. */
  polls: number;
  /** True when tmux was unavailable — a recorded degradation, NOT a silent success (D5). */
  degraded: boolean;
  error?: string;
}

/**
 * Kill a worker's pane and CONFIRM its death.
 *
 *   1. If the pane is already gone → confirmed (idempotent reap).
 *   2. `tmux kill-pane -t <paneId>`.
 *   3. Poll `list-panes` up to `pollAttempts` times; confirmed the moment the
 *      pane_id disappears.
 *
 * `ok: false, confirmed: false` means the pane SURVIVED the kill — an orphan the
 * caller must park for the reaper. `degraded: true` means tmux was unavailable
 * (host-unavailable is a recorded degradation, D5).
 */
export function terminatePane(
  paneId: string,
  opts: { run?: RunFn; pollAttempts?: number } = {},
): TerminatePaneOutcome {
  const run = opts.run ?? defaultRun;
  const pollAttempts = opts.pollAttempts ?? 5;
  const base = { mechanism: "tmux kill-pane" as const, paneId };

  // Dry-run placeholder ids (e.g. "(dry-run)") can never be terminated.
  if (!paneId || paneId.startsWith("(")) {
    return { ...base, ok: false, confirmed: false, polls: 0, degraded: false, error: "no real pane_id (placeholder)" };
  }

  const before = livePaneIds(run);
  if (before === null) {
    return { ...base, ok: false, confirmed: false, polls: 0, degraded: true, error: "tmux unavailable" };
  }
  if (!before.has(paneId)) {
    // Already gone — a confirmed teardown (idempotent).
    return { ...base, ok: true, confirmed: true, polls: 0, degraded: false };
  }

  run("tmux", ["kill-pane", "-t", paneId]);

  let polls = 0;
  for (let i = 0; i < Math.max(1, pollAttempts); i++) {
    polls++;
    const now = livePaneIds(run);
    if (now === null) {
      return { ...base, ok: false, confirmed: false, polls, degraded: true, error: "tmux unavailable during confirm" };
    }
    if (!now.has(paneId)) {
      return { ...base, ok: true, confirmed: true, polls, degraded: false };
    }
  }
  // The pane survived every confirmation poll — an orphan for the reaper.
  return {
    ...base,
    ok: false,
    confirmed: false,
    polls,
    degraded: false,
    error: `pane ${paneId} still live after ${polls} confirmation poll(s)`,
  };
}

// ── TmuxTeamBackend ───────────────────────────────────────────────────────────

/**
 * Fix A (run-identity-and-dispatch): the per-specialist FORWARDING PROOF for
 * pinned definition bundles on the tmux substrate.
 *
 * The declaring dispatch port (`supports_definition_injection: true`) verifies
 * carriage via `portHonoredInjection` against the launch result's dispatch
 * plan. A tmux launch used to return NO plan, so the port could never verify —
 * and therefore could never declare — leaving exact project `definition_ref`
 * injection refused on tmux.
 *
 * This helper derives one declarative entry per specialist from the COMPOSED
 * PLAN, not from the request: a specialist's `definition_ref` appears on its
 * entry ONLY when its own pane command demonstrably carries the ref bytes
 * (the GUILD_DEFINITION_REF export including the exact content_hash). An echo
 * of the request without carriage would be a fabricated proof; a backend that
 * drops the ref therefore produces an entry WITHOUT it, which the declaring
 * port fails as `invalid_request` — detection, not trust.
 */
export function dispatchPlanFromTmuxPlan(
  specialists: readonly Specialist[],
  commands: readonly ParsedTmuxCommand[],
  runId?: string,
): GuildDispatchDescriptor[] {
  return specialists.map((spec) => {
    const key = specialistDispatchKey(spec);
    const titleLikeIndexes: number[] = [];
    const titleIndexes = commands.flatMap((c, index) =>
      (
        c.argv.length >= 4 &&
        c.argv[0] === "tmux" &&
        c.argv[1] === "select-pane" &&
        c.argv[2] === "-T" &&
        c.argv[3] === key
      )
        ? (titleLikeIndexes.push(index), c.argv.length === 4 ? [index] : [])
        : [],
    );
    // One generated specialist lane has exactly one exact title command.
    // Prefix matches and duplicate titles are ambiguous and cannot prove
    // which payload the substrate associates with this dispatch key.
    const titleIndex =
      titleLikeIndexes.length === 1 && titleIndexes.length === 1
        ? titleIndexes[0]
        : -1;
    const paneCmd = titleIndex > 0 ? commands[titleIndex - 1] : undefined;
    const carried =
      spec.definition_ref !== undefined &&
      paneCmd !== undefined &&
      commandCarriesAndConsumesDefinitionRef(paneCmd.argv, spec, runId);
    return {
      // `name` is the dispatch-plan handle, not the semantic role name. A
      // specialist may own multiple task lanes, so the role name cannot bind
      // proof to one concrete launch identity.
      name: key,
      // Declarative pane metadata, not an Agent-tool descriptor: the lane runs
      // as a tmux pane process, so there is no subagent type or prompt replay
      // here — the prompt already rides the pane command itself.
      subagentType: "tmux-pane",
      model: dispatchModelForSpecialist(spec),
      env: {},
      prompt: "",
      ...(carried ? { definition_ref: spec.definition_ref } : {}),
    };
  });
}

/** Exact, mutation-sensitive evidence over the argv handed to tmux. */
function carriesPreSpawnDefinitionProof(
  command: string,
  exported: string,
  consumed: string,
  prefixMatchesLane: (prefix: string) => boolean,
): boolean {
  const guard =
    `${exported} ${consumed} { ` +
    `echo '[GUILD_DEFINITION_REF] exact-carriage check failed' >&2; exit 66; }; `;
  const guardIndex = command.indexOf(guard);
  if (guardIndex < 0 || command.indexOf(guard, guardIndex + guard.length) >= 0) return false;
  const launchIndex = guardIndex + guard.length;
  if (!command.startsWith("command claude ", launchIndex)) return false;
  const prefix = command.slice(0, guardIndex);
  return isGeneratedPreGuardExportPrefix(prefix) && prefixMatchesLane(prefix);
}

const GENERATED_PRE_GUARD_EXPORTS = Object.freeze([
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
  "GUILD_DISPATCH_PRODUCER",
  "GUILD_RUN_ID",
  "GUILD_TASK_ID",
  "GUILD_SPECIALIST",
  "GUILD_TASK_ASSIGNMENT",
  "GUILD_TASK_CELL_INSTANCE_ID",
  "GUILD_STATUSLINE",
  "GUILD_CAPABILITY_SCOPE",
  "GUILD_MODEL",
] as const);

function consumeGeneratedShellWord(input: string, start: number): number {
  if (input[start] === "'") {
    let cursor = start + 1;
    while (cursor < input.length) {
      if (input[cursor] !== "'") {
        cursor++;
        continue;
      }
      if (input.slice(cursor, cursor + 4) === "'\\''") {
        cursor += 4;
        continue;
      }
      return cursor + 1;
    }
    return -1;
  }
  let cursor = start;
  while (cursor < input.length && /[A-Za-z0-9_@%+=:,./-]/.test(input[cursor])) cursor++;
  return cursor === start ? -1 : cursor;
}

/** Accept only the ordered `export KEY=shellQuote(value); ` grammar emitted by paneCommand. */
function isGeneratedPreGuardExportPrefix(prefix: string): boolean {
  let cursor = 0;
  let previousRank = -1;
  const seen = new Set<string>();
  while (cursor < prefix.length) {
    if (!prefix.startsWith("export ", cursor)) return false;
    cursor += "export ".length;
    const equals = prefix.indexOf("=", cursor);
    if (equals < 0) return false;
    const key = prefix.slice(cursor, equals);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || seen.has(key)) return false;
    const rank = GENERATED_PRE_GUARD_EXPORTS.indexOf(key as typeof GENERATED_PRE_GUARD_EXPORTS[number]);
    if (rank < 0 || rank <= previousRank) return false;
    const wordEnd = consumeGeneratedShellWord(prefix, equals + 1);
    if (wordEnd < 0 || !prefix.startsWith("; ", wordEnd)) return false;
    seen.add(key);
    previousRank = rank;
    cursor = wordEnd + 2;
  }
  return (
    seen.has("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS") &&
    seen.has("GUILD_DISPATCH_PRODUCER") &&
    seen.has("GUILD_RUN_ID")
  );
}

/**
 * Return only the shell payload tmux actually executes for the exact
 * specialist split-window shape emitted by composeTmuxCommands.
 *
 * Never scan arbitrary argv elements for proof: targets, working directories,
 * and unused trailing arguments are metadata, not executable carriage.
 */
function tmuxSpecialistPayload(argv: readonly string[]): string | null {
  return (
    argv.length === 7 &&
    argv[0] === "tmux" &&
    argv[1] === "split-window" &&
    argv[2] === "-t" &&
    argv[4] === "-c"
  )
    ? argv[6]
    : null;
}

function generatedPrefixCarriesLaneIdentity(
  prefix: string,
  spec: Specialist,
  runId?: string,
): boolean {
  const hasExport = (key: string): boolean => prefix.includes(`export ${key}=`);
  const hasExactExport = (key: string, value: string): boolean =>
    prefix.includes(`export ${key}=${shellQuote(value)}; `);
  if (runId !== undefined && !hasExactExport("GUILD_RUN_ID", runId)) return false;
  if (!hasExactExport("GUILD_SPECIALIST", spec.name)) return false;
  if (spec.taskId !== undefined && spec.taskId.length > 0) {
    if (!hasExactExport("GUILD_TASK_ID", spec.taskId)) return false;
  } else if (hasExport("GUILD_TASK_ID")) {
    return false;
  }
  const assignment =
    spec.task_cell_assignment_path ??
    (runId === undefined ? null : `.guild/runs/${runId}/tasks/${spec.name}.json`);
  if (assignment !== null && !hasExactExport("GUILD_TASK_ASSIGNMENT", assignment)) return false;
  if (spec.task_cell_instance_id !== undefined && spec.task_cell_instance_id.length > 0) {
    if (!hasExactExport("GUILD_TASK_CELL_INSTANCE_ID", spec.task_cell_instance_id)) return false;
  } else if (hasExport("GUILD_TASK_CELL_INSTANCE_ID")) {
    return false;
  }
  return true;
}

function commandCarriesAndConsumesDefinitionRef(
  argv: readonly string[],
  spec: Specialist,
  runId?: string,
): boolean {
  const ref = spec.definition_ref;
  if (ref === undefined) return false;
  try {
    const payload = tmuxSpecialistPayload(argv);
    if (payload === null) return false;
    const quoted = shellQuote(JSON.stringify(ref));
    const exported = `export GUILD_DEFINITION_REF=${quoted};`;
    const consumed = `test "$GUILD_DEFINITION_REF" = ${quoted} ||`;
    return carriesPreSpawnDefinitionProof(
      payload,
      exported,
      consumed,
      (prefix) => generatedPrefixCarriesLaneIdentity(prefix, spec, runId),
    );
  } catch {
    return false;
  }
}

export class TmuxTeamBackend implements TeamBackend {
  readonly kind = "tmux" as const;
  private run: RunFn;
  private resolveAdapter?: AdapterResolver;

  constructor(opts: { run?: RunFn; resolveAdapter?: AdapterResolver } = {}) {
    this.run = opts.run ?? defaultRun;
    this.resolveAdapter = opts.resolveAdapter;
  }

  isAvailable(): boolean {
    return probeTmuxAvailable(this.run);
  }

  sessionExists(name: string): boolean {
    return (
      this.run("tmux", ["has-session", "-t", name], {
        stdio: ["ignore", "ignore", "ignore"],
      }).status === 0
    );
  }

  windowExists(name: string): boolean {
    const r = this.run("tmux", ["list-windows", "-F", "#{window_name}"]);
    if (r.status !== 0) return false;
    return r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(name);
  }

  currentSessionName(): string | null {
    const r = this.run("tmux", ["display-message", "-p", "#{session_name}"]);
    if (r.status !== 0) return null;
    const name = r.stdout.trim();
    return name || null;
  }

  plan(req: TeamLaunchRequest): TmuxPlan {
    // Issue #54: composeTmuxCommands defaults permissionConfig to
    // RUNTIME_DEFAULT_CONFIG (host_mode unset), which resolveTeamPaneHostMode
    // lifts to "bypass_all" for a team pane — the field-verified fix. rf-wi-01
    // (v23x-deferred-followups G1 codex-review fix, P1) registered `host_mode` as
    // a real settings.json surface AND wires it here: an operator's configured
    // host_mode (project settings.json, overridable via settings.local.json) now
    // actually reaches the spawned pane's launch flags via readRuntimePermissionConfig
    // + resolveTeamPaneHostMode, instead of `show --sources` reporting a value the
    // dispatch path silently ignored. readRuntimePermissionConfig never throws
    // (degrades to RUNTIME_DEFAULT_CONFIG-equivalent on any read/parse failure), so
    // this call is safe even on a missing/corrupt settings.json.
    const permissionConfig = readRuntimePermissionConfig(req.cwd);
    const commands = composeTmuxCommands({
      mode: req.mode,
      targetName: req.targetName,
      cwd: req.cwd,
      slug: req.slug,
      runId: req.runId,
      specialists: req.specialists,
      resolveAdapter: this.resolveAdapter,
      orchestratorHostKind: req.orchestratorHostKind ?? "claude",
      teamPath: req.teamPath,
      permissionConfig,
    });
    return { mode: req.mode, targetName: req.targetName, commands };
  }

  preflight(specialists: Specialist[], orchestratorHostKind: HostKind = "claude"): {
    ok: boolean;
    failures: Array<{ specialist: string; hostKind: HostKind; message: string }>;
  } {
    if (!this.resolveAdapter) return { ok: true, failures: [] };
    const failures: Array<{ specialist: string; hostKind: HostKind; message: string }> = [];
    const panes: Array<{ name: string; hostKind: HostKind }> = [
      { name: "orchestrator", hostKind: orchestratorHostKind },
      ...specialists.map((s) => ({ name: s.name, hostKind: s.host_kind ?? orchestratorHostKind })),
    ];
    const probed = new Set<HostKind>();
    for (const pane of panes) {
      if (probed.has(pane.hostKind)) continue;
      probed.add(pane.hostKind);
      const r = this.resolveAdapter(pane.hostKind).preflight();
      if (!r.ok) {
        failures.push({ specialist: pane.name, hostKind: pane.hostKind, message: r.message });
      }
    }
    return { ok: failures.length === 0, failures };
  }

  spawn(plan: TmuxPlan): TmuxSpawnOutcome {
    for (const c of plan.commands) {
      const r = this.run(c.argv[0], c.argv.slice(1));
      if (r.status !== 0) {
        if (plan.mode === "in-session") {
          this.run("tmux", ["kill-window", "-t", plan.targetName]);
        } else {
          this.run("tmux", ["kill-session", "-t", plan.targetName]);
        }
        return {
          ok: false,
          failedCommand: c,
          stderr: r.stderr,
          orchestratorPaneId: "",
          teammatePaneIds: {},
        };
      }
    }

    // Scoped to THIS session's window (no `-a`, which lists panes SERVER-WIDE
    // across every other session too — a correctness bug, not just a broader
    // scope: a concurrent guild-team session with a same-named specialist pane
    // title could silently clobber this collection).
    const paneArgs = ["list-panes", "-t", plan.targetName, "-F", "#{pane_index}\t#{pane_id}\t#{pane_title}"];
    const panesR = this.run("tmux", paneArgs);
    const teammates: Record<string, string> = {};
    let orchestratorPaneId = "";
    if (panesR.status === 0) {
      for (const line of panesR.stdout.split("\n")) {
        const [, id, title] = line.split("\t");
        if (!id) continue;
        if (title === "orchestrator") {
          orchestratorPaneId = id;
        } else if (title && title in teammates === false) {
          teammates[title] = id;
        }
      }
    }
    return {
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId,
      teammatePaneIds: teammates,
    };
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    const plan = this.plan(req);
    const plannedCommands = plan.commands.map((c) => c.display);
    // Fix A: the per-specialist forwarding proof (see dispatchPlanFromTmuxPlan)
    // rides every launch result — dry and real — so the declaring dispatch
    // port can verify exact definition_ref carriage on this substrate.
    const dispatchPlan = dispatchPlanFromTmuxPlan(req.specialists, plan.commands, req.runId);
    if (req.dryRun) {
      return {
        kind: this.kind,
        ok: true,
        plannedCommands,
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: ["dry-run: tmux not invoked"],
        dispatchPlan,
      };
    }
    const outcome = this.spawn(plan);
    return {
      kind: this.kind,
      ok: outcome.ok,
      plannedCommands,
      orchestratorPaneId: outcome.orchestratorPaneId || null,
      teammatePaneIds: outcome.teammatePaneIds,
      notes: outcome.ok
        ? []
        : [
            `tmux command failed: ${outcome.failedCommand?.display ?? "(unknown)"}`,
            outcome.stderr,
          ].filter(Boolean),
      dispatchPlan,
    };
  }
}

// ── binaryForHostKind (used by remote-backend.ts) ────────────────────────────

export function binaryForHostKind(hostKind: HostKind): string {
  if (hostKind === "antigravity-2") return "agy";
  // NOTE: codex-app used to be special-cased to "claude" here — that was both
  // wrong (a codex-app surface has no reason to launch the claude binary) and
  // unreachable in practice (parseHostKind normalizes "codex-app" before a real
  // dispatch ever reaches this function). Removing the special case doesn't
  // change the resolved value: codex-app's registry row has detection.bin:null
  // (it's a no-CLI app surface), so it still falls through to the generic
  // "claude" default below — now honestly, via that fallback, not a fake branch.
  const id = hostKindToRegistryId(hostKind);
  const bin = id ? getRegistryEntry(id)?.detection.bin : null;
  return bin ?? "claude";
}
