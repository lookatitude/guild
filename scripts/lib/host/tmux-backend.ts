/**
 * scripts/lib/host/tmux-backend.ts
 *
 * TmuxTeamBackend — the shipping tmux implementation behind the TeamBackend seam.
 * Extracted from team-backend.ts (W3 god-file split).
 *
 * Layer: host/ — imports from core/contracts + shared/, no upward imports.
 */

import { createHash, randomUUID } from "node:crypto";
import { hostKindToRegistryId, getRegistryEntry } from "../host-registry";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPrompt } from "../../../src/domains/config/index";
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
import {
  readVerifiedNativeClaudePackageIdentity,
  readVerifiedReleasePackageIdentity,
  type ReleasePackageIdentityV1,
} from "../release-package-identity";
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
import { ownPluginRoot } from "../../../src/domains/kernel";
import {
  claimIsolatedLaunches,
  assertLaneInstanceExported,
  TmuxExecutionTransport,
  taskCellPaths,
  type TaskCellWorkerPort,
  type TaskCellMechanicsResult,
  type TaskCellSpawnResult,
} from "../../../src/domains/dispatch";

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

function physicalDirectory(candidate: string): string {
  if (!path.isAbsolute(candidate)) throw new Error("root is not absolute");
  const stats = fs.lstatSync(candidate);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("root is not a physical directory");
  }
  return fs.realpathSync(candidate);
}

function readPhysicalFile(filePath: string, label: string): Buffer {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a physical regular file`);
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`${label} changed type`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readGuildManifestVersion(root: string, relativePath: string): string {
  const manifest = JSON.parse(
    readPhysicalFile(path.join(root, relativePath), "manifest").toString("utf8"),
  ) as unknown;
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    (manifest as Record<string, unknown>)["name"] !== "guild" ||
    typeof (manifest as Record<string, unknown>)["version"] !== "string" ||
    ((manifest as Record<string, unknown>)["version"] as string).length === 0
  ) {
    throw new Error("manifest is not a versioned Guild package");
  }
  return (manifest as Record<string, string>)["version"]!;
}

function hasClaudeManifest(root: string): boolean {
  try {
    fs.lstatSync(path.join(root, ".claude-plugin", "plugin.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function installedClaudePluginRegistry(env: NodeJS.ProcessEnv): {
  installations: Array<{ root: string }>;
  pluginIds: string[];
} {
  const configRoot = env["CLAUDE_CONFIG_DIR"]?.trim()
    || (env["HOME"]?.trim() ? path.join(env["HOME"]!.trim(), ".claude") : undefined);
  if (!configRoot) return { installations: [], pluginIds: ["guild@guild"] };
  if (!path.isAbsolute(configRoot)) {
    throw new Error("Claude config root is not absolute");
  }

  const registryPath = path.join(configRoot, "plugins", "installed_plugins.json");
  let raw: Buffer;
  try {
    raw = readPhysicalFile(registryPath, "Claude installed-plugin registry");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { installations: [], pluginIds: ["guild@guild"] };
    }
    throw error;
  }
  if (raw.length > 1024 * 1024) {
    throw new Error("Claude installed-plugin registry exceeds 1 MiB");
  }

  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude installed-plugin registry is not an object");
  }
  const plugins = (parsed as Record<string, unknown>)["plugins"];
  if (plugins === null || typeof plugins !== "object" || Array.isArray(plugins)) {
    throw new Error("Claude installed-plugin registry has no plugin map");
  }

  const installations: Array<{ root: string }> = [];
  const pluginIds = new Set<string>(["guild@guild"]);
  for (const [pluginId, value] of Object.entries(plugins as Record<string, unknown>)) {
    if (!/^guild@/.test(pluginId)) continue;
    pluginIds.add(pluginId);
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const installPath = (entry as Record<string, unknown>)["installPath"];
      if (typeof installPath === "string" && path.isAbsolute(installPath.trim())) {
        installations.push({ root: installPath.trim() });
      }
    }
  }
  return { installations, pluginIds: [...pluginIds].sort() };
}

function exactClaudeActivationArgs(root: string, ambientGuildIds: string[]): string[] {
  const enabledPlugins = Object.fromEntries(ambientGuildIds.map((id) => [id, false]));
  return [
    "--settings",
    JSON.stringify({ enabledPlugins }),
    "--plugin-dir",
    root,
  ];
}

function assertSameGeneratedHostIdentity(
  ownerRoot: string,
  claudeRoot: string,
): string {
  const candidateRoot = physicalDirectory(claudeRoot);
  const ownerIdentity = readVerifiedReleasePackageIdentity(ownerRoot);
  let claudeIdentity: ReleasePackageIdentityV1;
  try {
    claudeIdentity = readVerifiedReleasePackageIdentity(candidateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const nativeIdentity = readVerifiedNativeClaudePackageIdentity(candidateRoot);
    if (
      nativeIdentity.release_version !== ownerIdentity.release_version ||
      nativeIdentity.payload_digest !== ownerIdentity.native_claude_payload_digest
    ) {
      throw new Error("native Claude payload identity does not match generated owner release");
    }
    return candidateRoot;
  }
  if (ownerIdentity.current_package === "claude-code") {
    throw new Error("non-Claude launcher carries a Claude package identity");
  }
  if (claudeIdentity.current_package !== "claude-code") {
    throw new Error("activation candidate is not the generated Claude package");
  }
  if (
    ownerIdentity.release_version !== claudeIdentity.release_version ||
    ownerIdentity.release_id !== claudeIdentity.release_id
  ) {
    throw new Error("generated host complete release identities do not match");
  }
  return candidateRoot;
}

/**
 * Bind spawned LOCAL Claude panes to the exact release package that owns the
 * launcher. A Claude-owned launcher activates itself. A generated non-Claude
 * package discovers an installed Claude package from an explicit root, its
 * physical build-tree sibling, or Claude's authoritative installed-plugin
 * registry. A build-emitted release identity re-hashes every shipped file in
 * both packages and binds all package digests to one release id before activation. A
 * session settings overlay disables ambient installed Guild IDs so the exact
 * package is the only enabled Guild instance in the spawned Claude process.
 *
 * GUILD_PLUGIN_ROOT is the explicit launcher selection and takes precedence
 * over an inherited CLAUDE_PLUGIN_ROOT. Invalid, symlinked, non-Guild, foreign,
 * or cross-release roots fail closed; discovery never falls back to Claude's
 * ambient default plugin selection.
 */
export interface ClaudePluginActivation {
  args: string[];
  pluginRoot: string;
}

export function resolveClaudePluginActivation(
  env: NodeJS.ProcessEnv = process.env,
  ownerPluginRoot: string = ownPluginRoot(__dirname),
): ClaudePluginActivation {
  let ownerRealRoot: string;
  try {
    ownerRealRoot = physicalDirectory(ownerPluginRoot);
  } catch (error) {
    throw new Error(
      `launcher-owning Guild plugin root is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const guildRoot = env["GUILD_PLUGIN_ROOT"]?.trim();
  const claudeRoot = env["CLAUDE_PLUGIN_ROOT"]?.trim();
  const selected = guildRoot || (hasClaudeManifest(ownerRealRoot) ? claudeRoot : undefined);
  if (selected) {
    let selectedRealRoot: string;
    try {
      selectedRealRoot = physicalDirectory(selected);
    } catch (error) {
      const key = guildRoot ? "GUILD_PLUGIN_ROOT" : "CLAUDE_PLUGIN_ROOT";
      throw new Error(
        `explicit Guild plugin root ${key} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (selectedRealRoot !== ownerRealRoot) {
      throw new Error(
        "explicit Guild plugin root does not match the package that owns the launcher; refusing cross-package activation",
      );
    }
  }

  let installedRegistry: {
    installations: Array<{ root: string }>;
    pluginIds: string[];
  };
  try {
    installedRegistry = installedClaudePluginRegistry(env);
  } catch (error) {
    throw new Error(
      `Claude installed-plugin registry is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (hasClaudeManifest(ownerRealRoot)) {
    try {
      readGuildManifestVersion(ownerRealRoot, path.join(".claude-plugin", "plugin.json"));
      try {
        const generatedIdentity = readVerifiedReleasePackageIdentity(ownerRealRoot);
        if (generatedIdentity.current_package !== "claude-code") {
          throw new Error("launcher-owning Claude package has a non-Claude release identity");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        readVerifiedNativeClaudePackageIdentity(ownerRealRoot);
      }
    } catch (error) {
      throw new Error(
        `launcher-owning Claude plugin root is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return {
      args: exactClaudeActivationArgs(ownerRealRoot, installedRegistry.pluginIds),
      pluginRoot: ownerRealRoot,
    };
  }

  const candidates: Array<{ label: string; root: string }> = [];
  if (claudeRoot) candidates.push({ label: "CLAUDE_PLUGIN_ROOT", root: claudeRoot });
  candidates.push({
    label: "generated claude-code sibling",
    root: path.join(path.dirname(ownerRealRoot), "claude-code"),
  });

  const rejections: string[] = [];
  for (const installation of installedRegistry.installations) {
    candidates.push({
      label: "Claude installed-plugin registry",
      root: installation.root,
    });
  }

  const attempted = new Set<string>();
  for (const candidate of candidates) {
    const attemptKey = candidate.root;
    if (attempted.has(attemptKey)) continue;
    attempted.add(attemptKey);
    try {
      const matchedRoot = assertSameGeneratedHostIdentity(
        ownerRealRoot,
        candidate.root,
      );
      return {
        args: exactClaudeActivationArgs(matchedRoot, installedRegistry.pluginIds),
        pluginRoot: matchedRoot,
      };
    } catch (error) {
      rejections.push(
        `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `launcher-owning non-Claude package has no identity-matched installed Claude package (${rejections.join("; ")})`,
  );
}

/** Backward-compatible argv-only view used by callers that do not spawn a shell. */
export function resolveClaudePluginActivationArgs(
  env: NodeJS.ProcessEnv = process.env,
  ownerPluginRoot: string = ownPluginRoot(__dirname),
): string[] {
  return resolveClaudePluginActivation(env, ownerPluginRoot).args;
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
  /** Verified Claude package root exported so spawned hooks resolve this package, not the parent host. */
  pluginRoot?: string,
): string {
  // plr-wi-15-4: a task id never reaches a pane without its admitted instance id.
  assertLaneInstanceExported({ runId, taskId, taskCellInstanceId });
  const pluginDirIndexes = launchArgs.flatMap((arg, index) => arg === "--plugin-dir" ? [index] : []);
  if (pluginDirIndexes.length > 0 && pluginRoot === undefined) {
    throw new Error("--plugin-dir activation requires the paired child GUILD_PLUGIN_ROOT");
  }
  if (pluginRoot !== undefined) {
    if (
      !path.isAbsolute(pluginRoot) ||
      pluginDirIndexes.length !== 1 ||
      launchArgs[pluginDirIndexes[0]! + 1] !== pluginRoot
    ) {
      throw new Error("child GUILD_PLUGIN_ROOT must exactly match one absolute --plugin-dir argument");
    }
  }
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
  const pluginRootFragment =
    pluginRoot !== undefined && pluginRoot.length > 0
      ? `export GUILD_PLUGIN_ROOT=${shellQuote(pluginRoot)}; `
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
    pluginRootFragment +
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
  /** Validated exact-package argv for local Claude panes. */
  claudePluginActivationArgs?: string[];
  /** Verified root paired with claudePluginActivationArgs; exported into the child process. */
  claudePluginRoot?: string;
  /** FU08: compose a pure preview; adapter enforcement probes are forbidden. */
  preview?: boolean;
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
    claudePluginActivationArgs = [],
    claudePluginRoot,
    preview = false,
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
        [...claudePluginActivationArgs, ...resolveClaudeTeamLaunchArgs(permissionConfig)],
        model,
        spec?.task_cell_assignment_path,
        spec?.task_cell_instance_id,
        // Fix A: the claude branch was the ONE local pane path that dropped the
        // pinned definition bundle (codex + generic adapter branches already
        // carried it). The exact hash-bound ref now rides GUILD_DEFINITION_REF.
        spec?.definition_ref,
        claudePluginRoot,
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
        !preview && typeof adapter.withLaunchArgs === "function"
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

  // F3: the creating command prints the identity of what it created (unique
  // session/window ids + the server's pid and start_time), so cleanup and pane
  // capture bind to this launch's own target, never to the reusable name.
  const createFmt = CREATE_IDENTITY_FORMAT;
  if (mode === "new-session") {
    cmds.push({
      argv: [
        "tmux", "new-session", "-d", "-P", "-F", createFmt, "-s", targetName, "-n", "orchestrator", "-c", cwd, orchestratorCmd,
      ],
      display:
        `tmux new-session -d -P -F ${shellQuote(createFmt)} -s ${shellQuote(targetName)} ` +
        `-n orchestrator -c ${shellQuote(cwd)} ` +
        shellQuote(orchestratorCmd),
    });
  } else {
    cmds.push({
      argv: ["tmux", "new-window", "-P", "-F", createFmt, "-n", targetName, "-c", cwd, orchestratorCmd],
      display:
        `tmux new-window -P -F ${shellQuote(createFmt)} -n ${shellQuote(targetName)} ` +
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

/**
 * This file's default subprocess runner: the shared core defaultRun with a sanitized
 * CLONE of the env the child would otherwise get (an explicit per-call env, else the
 * inherited process env), so no run binding reaches a tmux client, server or pane.
 * The parent and every supplied env/options object are left untouched.
 */
const safeDefaultRun: RunFn = (cmd, args, opts = {}) =>
  defaultRun(cmd, args, { ...opts, env: sanitizedWorkerEnv((opts["env"] as NodeJS.ProcessEnv | undefined) ?? process.env) });

export function probeTmuxAvailable(run: RunFn = safeDefaultRun): boolean {
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
export function livePaneIds(run: RunFn = safeDefaultRun): Set<string> | null {
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
export function isPaneAlive(paneId: string, run: RunFn = safeDefaultRun): boolean {
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
  const run = opts.run ?? safeDefaultRun;
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
  "GUILD_PLUGIN_ROOT",
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
  const payload = tmuxSpecialistPayload(argv);
  return payload !== null && paneCommandCarriesDefinitionRef(payload, spec, runId);
}

/**
 * The same carriage proof over one generated pane payload (the shell string tmux
 * executes), for launch paths that do not use the split-window plan shape.
 */
export function paneCommandCarriesDefinitionRef(
  payload: string,
  spec: Specialist,
  runId?: string,
): boolean {
  const ref = spec.definition_ref;
  if (ref === undefined) return false;
  try {
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

// ── Launch-owned identity (L1-F3, carrier capture) ───────────────────────────

/** What a creating command prints about the target it created. */
export const CREATE_IDENTITY_FORMAT = "#{session_id} #{window_id} #{pid} #{start_time}";

export interface TmuxCreateIdentity {
  verb: "new-session" | "new-window";
  session_id: string;
  window_id: string;
  server_pid: number;
  server_process_start: string;
}

export interface TmuxCapturedPane {
  pane_id: string;
  pane_pid: number;
  pane_process_start: string;
  window_id: string;
  title: string;
}

export interface TmuxCleanupResult {
  attempted: true;
  confirmed_gone: boolean;
  identity_check: "verified" | "mismatch" | "unavailable";
  error: string | null;
}

/** Everything one spawn(plan) observed; nothing in it is synthesized. */
export interface TmuxSpawnCapture {
  creating: TmuxCreateIdentity | null;
  panes: TmuxCapturedPane[];
  cleanup: TmuxCleanupResult | null;
  error: string | null;
}

function parseCreateIdentity(verb: TmuxCreateIdentity["verb"], stdout: string): TmuxCreateIdentity | null {
  const [sessionId, windowId, pid, start] = fields(stdout);
  if (!/^\$\d+$/.test(sessionId ?? "") || !/^@\d+$/.test(windowId ?? "")) return null;
  const server = parseServerFields(pid, start);
  if (!server) return null;
  return { verb, session_id: sessionId!, window_id: windowId!, server_pid: server.pid, server_process_start: server.process_start };
}

/**
 * The panes of the created window, from one answer of the creating server. Any
 * line from another server or window, an unparseable line, an unreadable pane
 * process or a duplicate title records nothing at all.
 */
function captureLaunchPanes(c: TmuxCreateIdentity, run: RunFn): TmuxCapturedPane[] {
  const r = run("tmux", ["list-panes", "-t", c.window_id, "-F", "#{pid} #{start_time} #{window_id} #{pane_id} #{pane_pid} #{pane_title}"]);
  if (r.status !== 0) return [];
  const panes: TmuxCapturedPane[] = [];
  const titles = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const [pid, start, windowId, paneId, panePid, ...titleParts] = fields(line);
    const server = parseServerFields(pid, start);
    const title = titleParts.join(" ");
    const pp = Number(panePid);
    if (!server || server.pid !== c.server_pid || server.process_start !== c.server_process_start ||
        windowId !== c.window_id || !/^%\d+$/.test(paneId ?? "") || !Number.isInteger(pp) || pp <= 0 ||
        title.length === 0 || titles.has(title)) {
      return [];
    }
    const paneStart = processStartOf(pp, run);
    if (paneStart === null) return [];
    titles.add(title);
    panes.push({ pane_id: paneId!, pane_pid: pp, pane_process_start: paneStart, window_id: windowId!, title });
  }
  return panes;
}

/**
 * Remove only the captured target, through the server-side identity check, and
 * confirm from the creating server (or, with no server answering, from the
 * captured pane processes). A mismatch or unreadable state leaves it untouched.
 */
function cleanupCapturedTarget(
  c: TmuxCreateIdentity,
  mode: LaunchMode,
  panes: readonly TmuxCapturedPane[],
  run: RunFn,
): TmuxCleanupResult {
  const target = mode === "in-session" ? c.window_id : c.session_id;
  const verb = mode === "in-session" ? "kill-window" : "kill-session";
  const startDigits = c.server_process_start.slice(TMUX_SERVER_START_PREFIX.length);
  const result = (confirmed_gone: boolean, identity_check: TmuxCleanupResult["identity_check"], error: string | null): TmuxCleanupResult =>
    ({ attempted: true, confirmed_gone, identity_check, error });
  const action = run("tmux", ["if-shell", "-F", "-t", target, `#{==:#{pid}/#{start_time},${c.server_pid}/${startDigits}}`, `${verb} -t ${target}`]);
  if (action.status === null) return result(false, "unavailable", "tmux unavailable at cleanup");
  const listed = run("tmux", ["list-panes", "-a", "-F", "#{pid} #{start_time} #{window_id}"]);
  if (listed.status === 0) {
    let sameServer = true;
    let stillThere = false;
    for (const line of listed.stdout.split("\n")) {
      if (line.trim().length === 0) continue;
      const [pid, start, windowId] = fields(line);
      const server = parseServerFields(pid, start);
      if (!server) return result(false, "unavailable", "pane listing did not parse");
      if (server.pid !== c.server_pid || server.process_start !== c.server_process_start) sameServer = false;
      if (windowId === c.window_id) stillThere = true;
    }
    if (!sameServer) return result(false, "mismatch", "a different tmux server answers this socket");
    return stillThere ? result(false, "verified", `${target} still present after cleanup`) : result(true, "verified", null);
  }
  if (listed.status !== null && isNoServer(listed)) {
    if (panes.length === 0) return result(false, "unavailable", "no server answers and no pane process was captured to check");
    const gone = panes.map((p) => recordedProcessGone(p.pane_pid, p.pane_process_start, run));
    if (gone.every((g) => g === true)) return result(true, "verified", null);
    return result(false, "unavailable", "no server answers and a captured pane process is alive or unreadable");
  }
  return result(false, "unavailable", `pane listing failed: ${(listed.stderr ?? "").trim()}`);
}

// ── Per-instance pane identity carrier (approved r1, l-pane-carrier-approved-r1) ──

export const PANE_IDENTITY_SCHEMA = "guild.task_cell_pane_identity.v1" as const;

export interface PaneCarrierIds { run_id: string; logical_task_id: string; attempt: number; instance_id: string }

export interface PaneIdentityCarrierV1 extends PaneCarrierIds {
  schema_version: typeof PANE_IDENTITY_SCHEMA;
  launch_id: string;
  created_at: string;
  creating_command: TmuxCreateIdentity;
  pane: Omit<TmuxCapturedPane, never>;
  shared_members: Array<{ logical_task_id: string; attempt: number; instance_id: string; dispatch_key: string; specialist: string }>;
}

/** The carrier's one exact location: beside the instance record. */
export function paneIdentityCarrierPath(cwd: string, ids: PaneCarrierIds): string {
  return path.join(path.resolve(cwd, taskCellPaths(ids).instance_dir), "pane-identity.json");
}

/** Exclusive create, then re-read: a fault or any byte difference is an error. */
export function writePaneIdentityCarrier(cwd: string, carrier: PaneIdentityCarrierV1): void {
  const abs = paneIdentityCarrierPath(cwd, carrier);
  const text = JSON.stringify(carrier, null, 2) + "\n";
  fs.writeFileSync(abs, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  if (fs.readFileSync(abs, "utf8") !== text) throw new Error(`pane identity carrier ${abs} did not read back exactly`);
}

/** A required carrier string: holds a non-whitespace character; never trimmed or rewritten. */
const nonEmpty = (v: unknown): v is string => typeof v === "string" && /\S/u.test(v);
const positiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** The writer's `new Date().toISOString()`: exact form and a real instant. */
const isIsoTimestamp = (v: unknown): boolean =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

/** Every member of one pane carries the captured pane title as its dispatch key (the writer's mapping). */
const isMember = (m: unknown, title: string): m is PaneIdentityCarrierV1["shared_members"][number] => {
  const r = m as Record<string, unknown> | null;
  return !!r && nonEmpty(r["logical_task_id"]) && positiveInt(r["attempt"]) &&
    nonEmpty(r["instance_id"]) && r["dispatch_key"] === title && nonEmpty(r["specialist"]);
};

/** The validated carrier for exactly these ids, or why there is none. */
export function readPaneIdentityCarrier(cwd: string, ids: PaneCarrierIds): { ok: true; carrier: PaneIdentityCarrierV1 } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    const abs = paneIdentityCarrierPath(cwd, ids);
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, reason: "identity_metadata_invalid: not a regular file" };
    raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "identity_metadata_missing" : "identity_metadata_invalid: unreadable" };
  }
  const c = raw as PaneIdentityCarrierV1;
  const cc = c?.creating_command;
  const p = c?.pane;
  const valid = !!c && c.schema_version === PANE_IDENTITY_SCHEMA &&
    c.run_id === ids.run_id && c.logical_task_id === ids.logical_task_id && c.attempt === ids.attempt && c.instance_id === ids.instance_id &&
    nonEmpty(c.launch_id) && isIsoTimestamp(c.created_at) &&
    !!cc && (cc.verb === "new-session" || cc.verb === "new-window") &&
    typeof cc.session_id === "string" && /^\$\d+$/.test(cc.session_id) && typeof cc.window_id === "string" && /^@\d+$/.test(cc.window_id) &&
    positiveInt(cc.server_pid) && typeof cc.server_process_start === "string" &&
    new RegExp(`^${TMUX_SERVER_START_PREFIX}\\d+$`).test(cc.server_process_start) &&
    !!p && typeof p.pane_id === "string" && /^%\d+$/.test(p.pane_id) && positiveInt(p.pane_pid) &&
    // The writer stores processStartOf's normalized form, so the raw value must already be canonical.
    typeof p.pane_process_start === "string" && isCLocaleStart(p.pane_process_start) &&
    p.window_id === cc.window_id && nonEmpty(p.title) &&
    Array.isArray(c.shared_members) && c.shared_members.every((m) => isMember(m, p.title)) &&
    c.shared_members.filter((m) => m.instance_id === ids.instance_id && m.logical_task_id === ids.logical_task_id && m.attempt === ids.attempt).length === 1 &&
    new Set(c.shared_members.map((m) => `${m.logical_task_id}/${m.attempt}/${m.instance_id}`)).size === c.shared_members.length;
  return valid ? { ok: true, carrier: c } : { ok: false, reason: "identity_metadata_invalid: schema or identity mismatch" };
}

/** The bound teardown identity a carrier proves. */
export function boundIdentityOf(c: PaneIdentityCarrierV1): BoundPaneIdentity {
  return {
    pane_id: c.pane.pane_id, pane_pid: c.pane.pane_pid, pane_process_start: c.pane.pane_process_start,
    server_pid: c.creating_command.server_pid, server_process_start: c.creating_command.server_process_start,
  };
}

/**
 * Every shared peer's own carrier must exist, validate, and agree on launch_id,
 * creating provenance, pane tuple and the complete member set. Anything else defers.
 */
export function sharedPeersAgree(cwd: string, c: PaneIdentityCarrierV1): { ok: true } | { ok: false; reason: string } {
  const key = (x: PaneIdentityCarrierV1) =>
    JSON.stringify([x.launch_id, x.creating_command, x.pane, [...x.shared_members].sort((a, b) =>
      `${a.logical_task_id}/${a.attempt}/${a.instance_id}`.localeCompare(`${b.logical_task_id}/${b.attempt}/${b.instance_id}`))]);
  const mine = key(c);
  for (const m of c.shared_members) {
    const peer = readPaneIdentityCarrier(cwd, { run_id: c.run_id, logical_task_id: m.logical_task_id, attempt: m.attempt, instance_id: m.instance_id });
    if (!peer.ok) return { ok: false, reason: `shared peer ${m.instance_id}: ${peer.reason}` };
    if (key(peer.carrier) !== mine) return { ok: false, reason: `shared peer ${m.instance_id} disagrees` };
  }
  return { ok: true };
}

export class TmuxTeamBackend implements TeamBackend {
  readonly kind = "tmux" as const;
  private run: RunFn;
  private resolveAdapter?: AdapterResolver;
  private env: NodeJS.ProcessEnv;
  private pluginOwnerRoot: string;
  private readonly captures = new Map<string, TmuxSpawnCapture>();

  constructor(opts: {
    run?: RunFn;
    resolveAdapter?: AdapterResolver;
    env?: NodeJS.ProcessEnv;
    pluginOwnerRoot?: string;
  } = {}) {
    // Every physical subprocess of this backend, injected or default, gets a sanitized
    // clone of its effective env (explicit per-call env first, else the inherited one).
    const base = opts.run ?? defaultRun;
    this.run = (cmd, args, o = {}) =>
      base(cmd, args, { ...o, env: sanitizedWorkerEnv((o["env"] as NodeJS.ProcessEnv | undefined) ?? process.env) });
    this.resolveAdapter = opts.resolveAdapter;
    this.env = opts.env ?? process.env;
    this.pluginOwnerRoot = opts.pluginOwnerRoot ?? ownPluginRoot(__dirname);
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
    const orchestratorHostKind = req.orchestratorHostKind ?? "claude";
    const hasClaudePane =
      orchestratorHostKind === "claude" ||
      req.specialists.some(
        (specialist) => (specialist.host_kind ?? orchestratorHostKind) === "claude",
      );
    const claudePluginActivation = hasClaudePane
      ? resolveClaudePluginActivation(this.env, this.pluginOwnerRoot)
      : null;
    const commands = composeTmuxCommands({
      mode: req.mode,
      targetName: req.targetName,
      cwd: req.cwd,
      slug: req.slug,
      runId: req.runId,
      specialists: req.specialists,
      resolveAdapter: this.resolveAdapter,
      orchestratorHostKind,
      teamPath: req.teamPath,
      permissionConfig,
      claudePluginActivationArgs: claudePluginActivation?.args ?? [],
      claudePluginRoot: claudePluginActivation?.pluginRoot,
      preview: req.dryRun,
    });
    return { mode: req.mode, targetName: req.targetName, commands };
  }

  preflight(specialists: Specialist[], orchestratorHostKind: HostKind = "claude"): {
    ok: boolean;
    failures: Array<{ specialist: string; hostKind: HostKind; message: string }>;
  } {
    const failures: Array<{ specialist: string; hostKind: HostKind; message: string }> = [];
    const panes: Array<{ name: string; hostKind: HostKind }> = [
      { name: "orchestrator", hostKind: orchestratorHostKind },
      ...specialists.map((s) => ({ name: s.name, hostKind: s.host_kind ?? orchestratorHostKind })),
    ];

    // Exact package activation is itself a pre-pane dependency. Validate it
    // here so the launcher can refuse before persisting immutable TaskCells.
    // plan() deliberately validates again immediately before command emission
    // so a package mutation between preflight and launch still fails closed.
    if (panes.some((pane) => pane.hostKind === "claude")) {
      try {
        resolveClaudePluginActivation(this.env, this.pluginOwnerRoot);
      } catch (error) {
        failures.push({
          specialist: "orchestrator",
          hostKind: "claude",
          message: `exact Guild plugin activation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    if (!this.resolveAdapter) return { ok: failures.length === 0, failures };
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

  /**
   * Execute the plan. The first command creates the target and prints its own
   * identity; everything this launch later captures or cleans is bound to that
   * identity. What was observed is kept for the owning launcher
   * (takeSpawnCapture), also when a later step fails or throws.
   */
  spawn(plan: TmuxPlan): TmuxSpawnOutcome {
    const capture: TmuxSpawnCapture = { creating: null, panes: [], cleanup: null, error: null };
    this.captures.set(plan.targetName, capture);
    const [first, ...rest] = plan.commands;
    const fail = (c: ParsedTmuxCommand, stderr: string): TmuxSpawnOutcome => {
      // Nothing proven created means nothing is cleaned up; otherwise only the
      // captured target, through the server-side identity check.
      if (capture.creating) capture.cleanup = cleanupCapturedTarget(capture.creating, plan.mode, capture.panes, this.run);
      return { ok: false, failedCommand: c, stderr, orchestratorPaneId: "", teammatePaneIds: {} };
    };
    if (!first) return { ok: false, failedCommand: null, stderr: "empty plan", orchestratorPaneId: "", teammatePaneIds: {} };
    // A client-side env cannot remove a key an existing server already holds: verify
    // absence (or no server) before any create. The server is never cleared or killed.
    const before = probeServerCredential(this.run);
    if (before.state === "present" || before.state === "unverifiable") {
      capture.error = `refused before create: credential_env_${before.state === "present" ? "present_in_tmux_server" : "unverifiable"}: ${before.detail}`;
      return { ok: false, failedCommand: null, stderr: capture.error, orchestratorPaneId: "", teammatePaneIds: {} };
    }
    try {
      const created = this.run(first.argv[0], first.argv.slice(1));
      if (created.status !== 0) {
        capture.error = `create exited ${created.status === null ? "without a status" : created.status}`;
        return fail(first, created.stderr);
      }
      capture.creating = parseCreateIdentity(first.argv[1] === "new-session" ? "new-session" : "new-window", created.stdout);
      if (!capture.creating) {
        capture.error = `create identity did not parse: ${JSON.stringify(created.stdout.trim())}`;
        return fail(first, capture.error);
      }
      for (const c of rest) {
        const r = this.run(c.argv[0], c.argv.slice(1));
        if (r.status !== 0) return fail(c, r.stderr);
      }
      capture.panes = captureLaunchPanes(capture.creating, this.run);
      // After the create only an observed absence verifies; anything else is a failure
      // through the identity-bound cleanup of the captured target, never a success.
      const after = probeServerCredential(this.run);
      if (after.state !== "absent") {
        capture.error = `post-create credential check: ${after.state}${"detail" in after ? ` (${after.detail})` : ""}`;
        return fail(first, capture.error);
      }
    } catch (error) {
      capture.error = `spawn threw: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }

    const teammates: Record<string, string> = {};
    let orchestratorPaneId = "";
    for (const p of capture.panes) {
      if (p.title === "orchestrator") orchestratorPaneId = p.pane_id;
      else if (p.title && !(p.title in teammates)) teammates[p.title] = p.pane_id;
    }
    return {
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId,
      teammatePaneIds: teammates,
    };
  }

  /** The identity this backend observed for the named launch, consumed once. */
  takeSpawnCapture(targetName: string): TmuxSpawnCapture | null {
    const c = this.captures.get(targetName) ?? null;
    this.captures.delete(targetName);
    return c;
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    let plan: TmuxPlan;
    try {
      plan = this.plan(req);
    } catch (error) {
      return {
        kind: this.kind,
        ok: false,
        plannedCommands: [],
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: [
          `tmux plan failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
        dispatchPlan: [],
      };
    }
    const plannedCommands = plan.commands.map((c) => c.display);
    // Fix A: the per-specialist forwarding proof (see dispatchPlanFromTmuxPlan)
    // rides every launch result — dry and real — so the declaring dispatch
    // port can verify exact definition_ref carriage on this substrate.
    const dispatchPlan = dispatchPlanFromTmuxPlan(req.specialists, plan.commands, req.runId);
    if (req.dryRun) {
      const paneHosts = [
        req.orchestratorHostKind ?? "claude",
        ...req.specialists.map((specialist) =>
          specialist.host_kind ?? req.orchestratorHostKind ?? "claude"),
      ];
      const codexBypassWithheld =
        paneHosts.includes("codex") &&
        resolveCodexTeamLaunchArgs(readRuntimePermissionConfig(req.cwd)).length > 0;
      const adapterPreflightWithheld = paneHosts.some((host) => host !== "claude");
      const uncoveredAdapterPreflightWithheld = paneHosts.some(
        (host) => host !== "claude" && !(host === "codex" && codexBypassWithheld),
      );
      return {
        kind: this.kind,
        ok: true,
        plannedCommands,
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: [
          "dry-run: tmux not invoked",
          `tmux availability and ${req.mode === "in-session" ? "window" : "session"} ` +
            "target-collision probes withheld until real dispatch; real dispatch may refuse " +
            "before writing attempt records or launching panes",
          ...(codexBypassWithheld
            ? ["Codex bypass and enforcement preflight withheld in preview; planned Codex commands are bare"]
            : []),
          ...(adapterPreflightWithheld && uncoveredAdapterPreflightWithheld
            ? ["mixed-host adapter preflight withheld until real dispatch"]
            : []),
        ],
        dispatchPlan,
      };
    }
    // plr-wi-15-4: every lane pane is an admitted TaskCell instance with a
    // written v2 assignment, and this launch consumes its one launch claim, or
    // nothing spawns.
    try {
      claimIsolatedLaunches({
        cwd: req.cwd,
        runId: req.runId,
        launchId: `tmux:${req.targetName}:${process.pid}:${randomUUID()}`,
        lanes: req.specialists.map((lane) => ({
          logicalTaskId: lane.taskId,
          instanceId: lane.task_cell_instance_id,
        })),
      });
    } catch (error) {
      return {
        kind: this.kind,
        ok: false,
        plannedCommands,
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: [error instanceof Error ? error.message : String(error)],
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

// ── Identity-bound teardown (E00 L4, CD6) ────────────────────────────────────
//
// A pane id is unique only within one server lifetime, and the tmux socket can
// name a replacement server between any client-side read and a later kill. The
// kill is therefore ONE server-side command: `if-shell -F` evaluates the captured
// server pid, server start_time and pane_pid inside whichever server receives it,
// and only a server whose identity matches runs `kill-pane`. Client-side reads
// only classify the outcome; they never authorize a kill.

/** server_process_start values this backend records carry tmux's own #{start_time}. */
export const TMUX_SERVER_START_PREFIX = "tmux-start_time:";

/** The recorded pane identity a bound teardown must find (never a fresh replacement). */
export interface BoundPaneIdentity {
  pane_id: string;
  pane_pid: number;
  pane_process_start: string;
  server_pid: number;
  server_process_start: string;
}

export interface BoundTerminateOutcome extends TerminatePaneOutcome {
  identity_check: "verified" | "mismatch" | "unavailable";
}

const normalizedStart = (s: string | null): string | null => (s === null ? null : s.trim().replace(/\s+/g, " "));

/**
 * Identity formats use an ASCII space, never a tab: a server started under the C
 * locale prints a tab in `-F` output as `_`. No identity field (pane id, pids,
 * start_time) can contain a space.
 */
const fields = (text: string): string[] => text.trim().split(" ");

/** `ps` runs under the C locale so lstart text compares across processes and sessions. */
const PS_LOCALE = { LC_ALL: "C", LANG: "C" } as const;
const psRun = (run: RunFn, args: string[]) =>
  run("ps", args, { env: sanitizedWorkerEnv({ ...process.env, ...PS_LOCALE }) });

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A whitespace-normalized C-locale `lstart` ("Tue Oct 27 10:00:00 2026") naming a real date and its weekday. */
function isCLocaleStart(s: string | null): boolean {
  const m = s === null ? null : /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(s);
  if (!m) return false;
  const month = (MONTHS as readonly string[]).indexOf(m[2]!);
  const [day, hh, mm, ss, year] = [m[3], m[4], m[5], m[6], m[7]].map(Number) as [number, number, number, number, number];
  if (month < 0 || hh > 23 || mm > 59 || ss > 59) return false;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day && WEEKDAYS[date.getUTCDay()] === m[1];
}

/**
 * One authoritative process observation. The whole table is read (`ps -A`) and every
 * row must validate (pid, C-locale start, no duplicate pid) before any pid is looked
 * up, so a pid missing from a clean table is proven absent; a failed, noisy,
 * unparseable or ambiguous read is unavailable and never proves absence.
 */
export type ProcessObservation =
  | { kind: "observed"; start: string }
  | { kind: "absent" }
  | { kind: "unavailable"; detail: string };

export function observeProcessStart(pid: number, run: RunFn = safeDefaultRun): ProcessObservation {
  let r: ReturnType<RunFn>;
  try {
    r = psRun(run, ["-A", "-o", "pid=,lstart="]);
  } catch (error) {
    return { kind: "unavailable", detail: `ps threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (r.status !== 0) return { kind: "unavailable", detail: `ps exited ${r.status === null ? "without a status" : r.status}` };
  if ((r.stderr ?? "").trim().length > 0) return { kind: "unavailable", detail: `ps reported: ${(r.stderr ?? "").trim()}` };
  const lines = (r.stdout ?? "").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const starts = new Map<number, string>();
  for (const line of lines) {
    // Right-aligned pid, ASCII spaces, lstart; pid 0 is a real row on some systems. Only
    // ASCII spaces separate fields, so no control or other whitespace is normalized away.
    const m = /^ *(\d+) +([A-Za-z0-9: ]+)$/.exec(line);
    if (!m) return { kind: "unavailable", detail: "ps table line did not parse" };
    const rowPid = Number(m[1]);
    const start = normalizedStart(m[2]!);
    if (!Number.isSafeInteger(rowPid) || !isCLocaleStart(start)) return { kind: "unavailable", detail: "ps table row is not a C-locale pid/start" };
    if (starts.has(rowPid)) return { kind: "unavailable", detail: `ps table lists pid ${rowPid} twice` };
    starts.set(rowPid, start!);
  }
  if (starts.size === 0) return { kind: "unavailable", detail: "empty ps table" };
  const start = starts.get(pid);
  return start === undefined ? { kind: "absent" } : { kind: "observed", start };
}

/** The observed start, or null when absent OR unavailable; capture paths fail closed on null. */
export function processStartOf(pid: number, run: RunFn = safeDefaultRun): string | null {
  const o = observeProcessStart(pid, run);
  return o.kind === "observed" ? o.start : null;
}

/** true: the recorded process (pid + start) is gone; false: it is alive; null: unavailable. */
function recordedProcessGone(pid: number, start: string, run: RunFn): boolean | null {
  const o = observeProcessStart(pid, run);
  if (o.kind === "unavailable") return null;
  if (o.kind === "absent") return true;
  return o.start !== normalizedStart(start);
}

/**
 * Authoritative "no server" (l-enoent-absence-scope-decision.json, l-r2-parser-scope-decisions.json):
 * a nonzero exit with empty stdout whose whole stderr is exactly one line, either
 * tmux's own "no server running on <socket>" or a connect that failed because the
 * socket path does not exist (ENOENT; tmux 3.8 prints this for a fresh -S/-L socket).
 * The socket must be an absolute printable path without whitespace or parentheses, so
 * a socket path containing either fails closed (a recorded support limit). Any other
 * errno, suffix, CR, extra line or mixed output stays unavailable. Callers that
 * confirm a death still need the original pid + start proven gone.
 */
const isNoServer = (r: { status: number | null; stdout?: string; stderr?: string }): boolean => {
  // A finite nonzero integer status and two real streams; a missing stream is unknown, not empty.
  if (!Number.isInteger(r.status) || r.status === 0 || r.stdout !== "" || typeof r.stderr !== "string") return false;
  // At most one final LF is stripped; the anchored patterns admit nothing else. The
  // socket path is printable (no whitespace, parentheses, control or format character).
  const err = r.stderr.replace(/\n$/, "");
  return /^no server running on \/[^\s()\p{C}]+$/u.test(err) || /^error connecting to \/[^\s()\p{C}]+ \(No such file or directory\)$/u.test(err);
};

/**
 * Whether the reachable tmux server's global env holds the run credential, from one exact
 * answer (shared by the team backend and the worker port). Verified absence is only
 * `-KEY` or `unknown variable: KEY`; an exact isNoServer answer is no_server (a fresh
 * server starts from the sanitized env). Everything else is unverifiable.
 */
function probeServerCredential(run: RunFn): { state: "absent" | "no_server" } | { state: "present" | "unverifiable"; detail: string } {
  const key = "GUILD_RUN_BINDING_REF";
  let r: ReturnType<RunFn>;
  try {
    r = run("tmux", ["show-environment", "-g", key]);
  } catch {
    // Never the exception's message or code: either may carry environment bytes.
    return { state: "unverifiable", detail: "show-environment threw" };
  }
  // Raw streams, never trimmed; a missing stream or a non-integer status is unknown, not empty.
  const status: unknown = r.status;
  const out: unknown = r.stdout;
  const err: unknown = r.stderr;
  const bytes = (s: unknown) => (typeof s === "string" ? `${Buffer.byteLength(s)} bytes` : "unavailable");
  // Safe shape only: an integer status and observed byte counts, never stream content.
  const unverifiable = (what: string) => ({
    state: "unverifiable" as const,
    detail: `show-environment ${what} (status ${Number.isInteger(status) ? status : "invalid"}, stdout ${bytes(out)}, stderr ${bytes(err)})`,
  });
  if (!Number.isInteger(status) || typeof out !== "string" || typeof err !== "string") return unverifiable("answer is incomplete");
  const oneLine = (s: string, text: string) => s === text || s === `${text}\n`;
  if (status === 0) {
    if (err === "" && oneLine(out, `-${key}`)) return { state: "absent" };
    if (err === "" && new RegExp(`^${key}=[^\\p{C}]*\\n?$`, "u").test(out)) return { state: "present", detail: key };
    return unverifiable("printed a noncanonical answer");
  }
  if (out === "" && oneLine(err, `unknown variable: ${key}`)) return { state: "absent" };
  if (isNoServer(r)) return { state: "no_server" };
  return unverifiable("exited with a noncanonical answer");
}

function parseServerFields(pid: string | undefined, start: string | undefined): { pid: number; process_start: string } | null {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0 || !/^\d+$/.test(start ?? "")) return null;
  return { pid: n, process_start: `${TMUX_SERVER_START_PREFIX}${start}` };
}

/** The identity tmux reports for the server the default socket reaches now. */
export function tmuxServerIdentity(run: RunFn = safeDefaultRun): { pid: number; process_start: string } | null {
  const r = run("tmux", ["display-message", "-p", "#{pid} #{start_time}"]);
  if (r.status !== 0) return null;
  const [pid, start] = fields(r.stdout);
  return parseServerFields(pid, start);
}

/** The pane's pane_pid as the reachable server reports it, or null. */
export function tmuxPanePid(paneId: string, run: RunFn = safeDefaultRun): number | null {
  const r = run("tmux", ["display-message", "-p", "-t", paneId, "#{pane_pid}"]);
  const pid = Number(r.stdout.trim());
  return r.status === 0 && Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * One answering server's view of a pane. `absent` means that server listed all its
 * panes and this id was not among them; it is absence only on THAT server.
 */
type PaneServerView =
  | { kind: "present"; server_pid: number; server_process_start: string; pane_pid: number }
  | { kind: "absent"; server_pid: number; server_process_start: string }
  | { kind: "no_server" }
  | { kind: "unavailable"; degraded: boolean };

/**
 * `list-panes -a` carries the answering server's pid + start_time on every line, so
 * presence and server identity come from one answer of one server. A targeted
 * `display-message -t <gone pane>` exits 0 with empty pane fields while a sibling
 * pane lives, which is why it is not used for presence.
 */
function paneServerView(paneId: string, run: RunFn): PaneServerView {
  const r = run("tmux", ["list-panes", "-a", "-F", "#{pid} #{start_time} #{pane_id} #{pane_pid}"]);
  if (r.status === null) return { kind: "unavailable", degraded: true };
  if (r.status !== 0) {
    // Only tmux's own "no server running on <socket>" is authoritative; "error
    // connecting to" (EACCES and others) and any other failure are unavailable.
    return isNoServer(r) ? { kind: "no_server" } : { kind: "unavailable", degraded: false };
  }
  const lines = r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { kind: "unavailable", degraded: false };
  let server: { pid: number; process_start: string } | null = null;
  let panePid: number | null = null;
  for (const line of lines) {
    const [pid, start, id, pp] = fields(line);
    const s = parseServerFields(pid, start);
    const n = Number(pp);
    if (!s || !/^%\d+$/.test(id ?? "") || !Number.isInteger(n) || n <= 0) return { kind: "unavailable", degraded: false };
    if (server && (server.pid !== s.pid || server.process_start !== s.process_start)) return { kind: "unavailable", degraded: false };
    server = s;
    if (id === paneId) panePid = n;
  }
  return panePid === null
    ? { kind: "absent", server_pid: server!.pid, server_process_start: server!.process_start }
    : { kind: "present", server_pid: server!.pid, server_process_start: server!.process_start, pane_pid: panePid };
}

const boundKillCondition = (serverPid: number, serverStart: string, panePid: number): string =>
  `#{==:#{pid}/#{start_time}/#{pane_pid},${serverPid}/${serverStart}/${panePid}}`;

/**
 * Kill exactly the recorded pane and confirm it is gone.
 *
 * `identity_check`: verified (the recorded server answered and the server-side
 * check bound the kill), mismatch (another pane or server answers for this id;
 * nothing was killed by this call there), unavailable (no tmux-bound identity, or
 * tmux could not be read). Only `ok && confirmed` with `verified` is a teardown.
 */
export function terminateBoundPane(
  paneId: string,
  expected: BoundPaneIdentity,
  opts: { run?: RunFn; pollAttempts?: number } = {},
): BoundTerminateOutcome {
  const run = opts.run ?? safeDefaultRun;
  const pollAttempts = Math.max(1, opts.pollAttempts ?? 5);
  const out = (o: Omit<BoundTerminateOutcome, "mechanism" | "paneId">): BoundTerminateOutcome =>
    ({ mechanism: "tmux kill-pane", paneId, ...o });
  const refused = (identity_check: "mismatch" | "unavailable", error: string, degraded = false, polls = 0) =>
    out({ ok: false, confirmed: false, polls, degraded, identity_check, error });

  if (!/^%\d+$/.test(paneId) || expected.pane_id !== paneId) return refused("mismatch", "pane id is not the recorded pane");
  if (typeof expected.server_process_start !== "string" || !expected.server_process_start.startsWith(TMUX_SERVER_START_PREFIX)) {
    return refused("unavailable", "recorded server identity is not tmux-bound; no server-side check is possible");
  }
  const serverStart = expected.server_process_start.slice(TMUX_SERVER_START_PREFIX.length);
  if (!/^\d+$/.test(serverStart) || !Number.isInteger(expected.pane_pid) || !Number.isInteger(expected.server_pid)) {
    return refused("unavailable", "recorded identity is malformed");
  }
  const fromRecordedServer = (v: { server_pid: number; server_process_start: string }): boolean =>
    v.server_pid === expected.server_pid && v.server_process_start === expected.server_process_start;
  const isRecorded = (v: PaneServerView): boolean =>
    v.kind === "present" && fromRecordedServer(v) && v.pane_pid === expected.pane_pid;
  // Gone only on evidence: the recorded server itself lists its panes without this
  // one (siblings may live), or no server answers at all (the recorded one exits with
  // its last pane) and the recorded pane process (pid + start) is physically gone.
  const absent = (v: Extract<PaneServerView, { kind: "absent" }>, polls: number): BoundTerminateOutcome =>
    fromRecordedServer(v)
      ? out({ ok: true, confirmed: true, polls, degraded: false, identity_check: "verified" })
      : refused("mismatch", "a different tmux server answers this socket; the recorded pane's fate is not observable", false, polls);
  const noServer = (polls: number): BoundTerminateOutcome => {
    const gone = recordedProcessGone(expected.pane_pid, expected.pane_process_start, run);
    if (gone === true) return out({ ok: true, confirmed: true, polls, degraded: false, identity_check: "verified" });
    return refused(
      "unavailable",
      gone === false
        ? "no tmux server answers but the recorded pane process is still alive"
        : "no tmux server answers and the pane process table is unreadable",
      false,
      polls,
    );
  };

  const pre = paneServerView(paneId, run);
  if (pre.kind === "unavailable") return refused("unavailable", pre.degraded ? "tmux unavailable" : "tmux pane listing unreadable", pre.degraded);
  if (pre.kind === "no_server") return noServer(0);
  if (pre.kind === "absent") return absent(pre, 0);
  if (!isRecorded(pre)) return refused("mismatch", "the live pane's server or pane_pid differs from the record; no kill issued");
  const start = processStartOf(expected.pane_pid, run);
  if (start === null || start !== normalizedStart(expected.pane_process_start)) {
    return refused("mismatch", "the pane process start differs from the record; no kill issued");
  }

  const action = run("tmux", [
    "if-shell", "-F", "-t", paneId, boundKillCondition(expected.server_pid, serverStart, expected.pane_pid), `kill-pane -t ${paneId}`,
  ]);
  if (action.status === null) return refused("unavailable", "tmux unavailable at the bound kill", true);

  let polls = 0;
  for (let i = 0; i < pollAttempts; i++) {
    polls++;
    const now = paneServerView(paneId, run);
    if (now.kind === "unavailable") {
      return refused("unavailable", now.degraded ? "tmux unavailable during confirm" : "tmux pane listing unreadable during confirm", now.degraded, polls);
    }
    if (now.kind === "no_server") return noServer(polls);
    if (now.kind === "absent") return absent(now, polls);
    if (!isRecorded(now)) {
      return refused("mismatch", "a replacement server or pane answers for this id after the bound kill; not confirmed", false, polls);
    }
  }
  return out({
    ok: false, confirmed: false, polls, degraded: false, identity_check: "verified",
    error: `pane ${paneId} still live after ${polls} confirmation poll(s)`,
  });
}

// ── E00 controller worker port (CD11, CD21) ──────────────────────────────────

type TaskCellSpawnInput = Parameters<TaskCellWorkerPort["spawn"]>[0];
type TaskCellInstance = TaskCellSpawnInput["instance"];

/** The resolved, hash-checked definition a TaskCell pane must carry. */
export interface TaskCellPaneDefinition {
  ref: ProjectDefinitionRefV1;
  /** Absolute path of the definition bytes `ref.content_hash` covers. */
  definition_abs: string;
}

export interface TmuxTaskCellWorkerPortOpts {
  /** Absolute Guild root; every pane starts here. */
  cwd: string;
  /** Dedicated tmux session that holds this controller's worker windows. */
  sessionName: string;
  /**
   * Absolute controller-owned directory for the per-instance definition snapshot
   * Claude receives through --append-system-prompt-file (the declared injection).
   */
  snapshotDir: string;
  resolveDefinition(instance: TaskCellInstance): TaskCellPaneDefinition | { error: string };
  /** Absolute path of the lane receipt the controller polls for this instance. */
  receiptPath(instance: TaskCellInstance): string;
  /** argv prefix of the packaged ack CLI; the port appends `--assignment <abs>`. */
  ackArgv: readonly string[];
  /** Launch-plan forwarding evidence for one spawned instance. */
  recordLaunch?(instanceId: string, evidence: Record<string, unknown>): void;
  run?: RunFn;
  env?: NodeJS.ProcessEnv;
  pluginOwnerRoot?: string;
  /** Package activation for the pane; defaults to the verified resolveClaudePluginActivation. */
  activate?: (env: NodeJS.ProcessEnv, ownerRoot: string) => ClaudePluginActivation;
  nudge?: TmuxExecutionTransport;
}

/** Keys that hold a run credential and never reach a tmux client, server or pane. */
export function isBindingEnvKey(key: string): boolean {
  return key === "GUILD_RUN_BINDING_REF" || /BINDING_REF$/.test(key);
}

export function sanitizedWorkerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!isBindingEnvKey(k)) out[k] = v;
  return out;
}

const bareHash = (h: string | null | undefined): string | null => (h ? h.replace(/^sha256:/, "") : null);

/** Shells that run the generated launch prefix before the host process starts. */
const LAUNCH_SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "login"]);

function isClaudeHostId(hostId: string): boolean {
  const id = getRegistryEntry(hostId as never) ? hostId : hostKindToRegistryId(hostId as HostKind);
  return !!id && getRegistryEntry(id as never)?.detection.bin === "claude";
}

export function taskCellWorkerPrompt(i: {
  role: string; runId: string; taskId: string; instanceId: string; root: string;
  definitionAbs: string; contentHash: string; assignmentAbs: string; receiptAbs: string; ackArgv: readonly string[];
}): string {
  const ack = [...i.ackArgv, "--assignment", i.assignmentAbs].map(shellQuote).join(" ");
  return [
    `You are the \`${i.role}\` worker for TaskCell ${i.taskId} (instance ${i.instanceId}) in run ${i.runId}.`,
    `Read your role definition at ${i.definitionAbs} first (content_hash ${i.contentHash}) and adopt it fully.`,
    `The controller writes your assignment at ${i.assignmentAbs}. Wait until that file exists, then read and validate it (guild.task_assignment.v2). Never edit it.`,
    `Claim the assignment only by running: ${ack}`,
    "Never write ack, instance, attempt, ledger, acceptance, handoff.json or bus files, and never read a run's binding.json.",
    `Read the context bundle named by the assignment's context_bundle_id (relative to ${i.root}) and work only inside its scope_paths.`,
    `When done, write your receipt at ${i.receiptAbs} with the sections changed_files, opens_for, assumptions, evidence and followups plus exactly one fenced guild.handoff.v2 block.`,
    "Use absolute paths; do not change the shell working directory.",
  ].join("\n");
}

/**
 * The controller-owned tmux TaskCell worker port. One Claude pane per admitted
 * instance, launched through the generated paneCommand grammar with the
 * exact-carriage definition guard; credential env never reaches tmux; the
 * captured server/pane identity drives every later readiness, nudge and kill.
 */
export class TmuxTaskCellWorkerPort implements TaskCellWorkerPort {
  readonly mode = "native" as const;
  readonly losses: readonly string[] = Object.freeze([]);
  private readonly run: RunFn;
  private readonly env: NodeJS.ProcessEnv;
  private readonly pluginOwnerRoot: string;
  private readonly nudge: TmuxExecutionTransport;
  private readonly panes = new Map<string, BoundPaneIdentity>();
  /** The exact declared-injection argument only this instance's host process carries. */
  private readonly hostArgs = new Map<string, string>();

  constructor(private readonly opts: TmuxTaskCellWorkerPortOpts) {
    this.env = sanitizedWorkerEnv(opts.env ?? process.env);
    const base = opts.run ?? defaultRun;
    this.run = (cmd, args, o = {}) => base(cmd, args, { ...o, env: cmd === "ps" ? { ...this.env, ...PS_LOCALE } : this.env });
    this.pluginOwnerRoot = opts.pluginOwnerRoot ?? ownPluginRoot(__dirname);
    this.nudge = opts.nudge ?? new TmuxExecutionTransport({ run: this.run });
  }

  isAvailable(): boolean {
    return probeTmuxAvailable(this.run);
  }

  paneIdentity(instanceId: string): BoundPaneIdentity | null {
    return this.panes.get(instanceId) ?? null;
  }

  /**
   * Whether the reachable server's global env holds the credential. Only these are
   * verified absence: tmux's `-KEY` (removed) or `unknown variable: KEY`. An exact
   * `isNoServer` answer is no_server (a fresh server starts from the sanitized env;
   * accepted before the create only). Everything else is unverifiable.
   */
  private credentialProbe(): { state: "absent" | "no_server" } | { state: "present" | "unverifiable"; detail: string } {
    return probeServerCredential(this.run);
  }

  private matchesRecorded(id: BoundPaneIdentity): PaneServerView["kind"] | "mismatch" {
    const view = paneServerView(id.pane_id, this.run);
    if (view.kind !== "present") return view.kind;
    return view.server_pid === id.server_pid && view.server_process_start === id.server_process_start &&
      view.pane_pid === id.pane_pid ? "present" : "mismatch";
  }

  /**
   * Every refusal before the create command is issued is proven no-action
   * (`spawn_effect: "none"`). Once `new-session`/`new-window` has been issued, any
   * failure, lost or invalid identity, or throw is `"unknown"`: a pane may be live.
   */
  spawn(input: TaskCellSpawnInput): TaskCellSpawnResult {
    const inst = input.instance;
    const refuse = (reason: string): TaskCellSpawnResult => ({ ok: false, reason, spawn_effect: "none" });
    if (!isClaudeHostId(inst.host_id)) return refuse(`host_unsupported:${inst.host_id} (this port launches Claude panes only)`);
    const def = this.opts.resolveDefinition(inst);
    if ("error" in def) return refuse(`definition_unresolved:${def.error}`);
    const ref = def.ref;
    if (ref.kind !== "agent" || ref.id !== inst.worker_role ||
        bareHash(ref.specialist_profile_hash) !== bareHash(inst.specialist_profile_hash) ||
        bareHash(ref.specialist_type_hash) !== bareHash(inst.specialist_type_hash)) {
      return refuse("definition_hash_mismatch");
    }
    let definitionBytes: Buffer;
    try {
      definitionBytes = fs.readFileSync(def.definition_abs);
    } catch (error) {
      return refuse(`definition_unreadable:${error instanceof Error ? error.message : String(error)}`);
    }
    const definitionSha = createHash("sha256").update(definitionBytes).digest("hex");
    if (definitionSha !== bareHash(ref.content_hash)) return refuse("definition_bytes_mismatch");
    // The hash-checked bytes themselves are what Claude reads: an exclusive,
    // read-only snapshot passed by --append-system-prompt-file, re-hashed after write.
    const snapshot = path.join(this.opts.snapshotDir, `${inst.instance_id}.definition.md`);
    try {
      fs.mkdirSync(this.opts.snapshotDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(snapshot, definitionBytes, { flag: "wx", mode: 0o444 });
      if (createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex") !== definitionSha) {
        return refuse("definition_snapshot_mismatch");
      }
    } catch (error) {
      return refuse(`definition_snapshot_failed:${error instanceof Error ? error.message : String(error)}`);
    }
    const credential = this.credentialProbe();
    if (credential.state === "present") return refuse(`credential_env_present_in_tmux_server:${credential.detail}`);
    if (credential.state === "unverifiable") return refuse(`credential_env_unverifiable: ${credential.detail}`);

    const root = path.resolve(this.opts.cwd);
    const assignmentAbs = path.resolve(root, input.assignment_path);
    const receiptAbs = this.opts.receiptPath(inst);
    let activation: ClaudePluginActivation;
    try {
      activation = (this.opts.activate ?? resolveClaudePluginActivation)(this.env, this.pluginOwnerRoot);
    } catch (error) {
      return refuse(`plugin_activation_failed:${error instanceof Error ? error.message : String(error)}`);
    }
    const prompt = taskCellWorkerPrompt({
      role: inst.worker_role, runId: inst.run_id, taskId: inst.logical_task_id, instanceId: inst.instance_id, root,
      definitionAbs: def.definition_abs, contentHash: ref.content_hash, assignmentAbs, receiptAbs, ackArgv: this.opts.ackArgv,
    });
    const scope = [...inst.projection.tools];
    const command = paneCommand(
      prompt, inst.run_id, scope, inst.logical_task_id, inst.worker_role, false,
      [
        ...activation.args,
        ...resolveClaudeTeamLaunchArgs(readRuntimePermissionConfig(root)),
        "--append-system-prompt-file", snapshot,
      ],
      inst.model_id ?? undefined, assignmentAbs, inst.instance_id, ref, activation.pluginRoot,
    );
    const proofSpec = {
      name: inst.worker_role, scope: "", dependsOn: [], taskId: inst.logical_task_id,
      task_cell_assignment_path: assignmentAbs, task_cell_instance_id: inst.instance_id, definition_ref: ref,
    } as unknown as Specialist;
    if (!paneCommandCarriesDefinitionRef(command, proofSpec, inst.run_id)) return refuse("definition_carriage_unproven");

    const fmt = "#{pane_id} #{pane_pid} #{pid} #{start_time}";
    const session = this.opts.sessionName;
    const probe = this.run("tmux", ["has-session", "-t", session]);
    if (probe.status === null) return refuse("spawn_failed:tmux did not run (no create issued)");
    const exists = probe.status === 0;

    // From here the create has been issued: nothing proves the absence of a live pane.
    const unknown = (reason: string): TaskCellSpawnResult => ({ ok: false, reason, spawn_effect: "unknown" });
    // Without the full identity nothing may kill or re-adopt the pane: record the
    // observation durably (best effort; the unknown result stands either way).
    const recordUnknown = (observed: Record<string, unknown>): string | null => {
      try {
        this.opts.recordLaunch?.(inst.instance_id, {
          schema_version: "guild.task_cell_launch_evidence.v1",
          instance_id: inst.instance_id,
          state: "identity_unknown",
          session,
          ...observed,
          live_pane_may_remain: true,
        });
        return null;
      } catch (error) {
        return `; launch record failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    let created: ReturnType<RunFn>;
    try {
      created = exists
        ? this.run("tmux", ["new-window", "-d", "-P", "-F", fmt, "-t", `${session}:`, "-n", inst.instance_id, "-c", root, command])
        : this.run("tmux", ["new-session", "-d", "-P", "-F", fmt, "-s", session, "-n", inst.instance_id, "-c", root, command]);
    } catch (error) {
      const note = recordUnknown({ observed_spawn_error: error instanceof Error ? error.message : String(error) });
      return unknown(`spawn_outcome_unknown: create threw after it was issued${note ?? ""}`);
    }
    if (created.status !== 0) {
      const note = recordUnknown({ observed_spawn_status: created.status, observed_spawn_stderr: (created.stderr ?? "").trim() });
      return unknown(
        `spawn_outcome_unknown: create ${created.status === null ? "did not return a status" : `exited ${created.status}`}` +
          ` after it was issued (${(created.stderr ?? "").trim()})${note ?? ""}`,
      );
    }
    let paneId: string | undefined;
    let pid = NaN;
    let server: { pid: number; process_start: string } | null = null;
    let paneStart: string | null = null;
    try {
      const [p, pp, serverPid, serverStart] = fields(created.stdout);
      paneId = p;
      server = parseServerFields(serverPid, serverStart);
      pid = Number(pp);
      paneStart = Number.isInteger(pid) && pid > 0 ? processStartOf(pid, this.run) : null;
    } catch (error) {
      const note = recordUnknown({ observed_spawn_output: created.stdout.trim(), observed_error: error instanceof Error ? error.message : String(error) });
      return unknown(`spawn_outcome_unknown: identity capture threw (${JSON.stringify(created.stdout.trim())})${note ?? ""}`);
    }
    if (!/^%\d+$/.test(paneId ?? "") || !server || paneStart === null) {
      const note = recordUnknown({
        observed_spawn_output: created.stdout.trim(),
        observed: { pane_id: paneId ?? null, pane_pid: Number.isInteger(pid) && pid > 0 ? pid : null, server, pane_process_start: paneStart },
      });
      return unknown(`spawn_identity_unavailable: a created pane may remain live and untracked (${JSON.stringify(created.stdout.trim())})${note ?? ""}`);
    }
    const identity: BoundPaneIdentity = {
      pane_id: paneId!, pane_pid: pid, pane_process_start: paneStart,
      server_pid: server.pid, server_process_start: server.process_start,
    };
    // The verified identity is retained before any further bookkeeping, so a later
    // failure below still leaves the pane terminable by its exact identity.
    this.panes.set(inst.instance_id, identity);
    this.hostArgs.set(inst.instance_id, `--append-system-prompt-file ${snapshot}`);
    // R1: the server that now holds the pane may have started (or changed) after the
    // pre-create probe. Re-check it; the pane is kept by identity, never used.
    // After the create, only an observed absent variable on the reachable server
    // verifies the pane's env; "no server running" no longer observes the server
    // that holds the pane. Anything else is unknown, identity retained, never used.
    const after = this.credentialProbe();
    if (after.state !== "absent") {
      return unknown(
        `spawn_outcome_unknown: verified pane ${identity.pane_id} spawned but its server env was ` +
          `${"detail" in after ? `${after.state} (${after.detail})` : "not observable (no server running)"}; identity retained`,
      );
    }
    try {
      this.recordVerifiedLaunch(inst, identity, session, command, ref, def.definition_abs, definitionSha, snapshot, assignmentAbs, scope, activation);
    } catch (error) {
      return unknown(
        `spawn_outcome_unknown: verified pane ${identity.pane_id} spawned but launch evidence was not recorded ` +
          `(${error instanceof Error ? error.message : String(error)}); identity retained`,
      );
    }
    return { ok: true, reason: null };
  }

  private recordVerifiedLaunch(
    inst: TaskCellInstance, identity: BoundPaneIdentity, session: string, command: string, ref: ProjectDefinitionRefV1,
    definitionAbs: string, definitionSha: string, snapshot: string, assignmentAbs: string, scope: string[],
    activation: ClaudePluginActivation,
  ): void {
    const def = { definition_abs: definitionAbs };
    this.opts.recordLaunch?.(inst.instance_id, {
      schema_version: "guild.task_cell_launch_evidence.v1",
      instance_id: inst.instance_id,
      pane: identity,
      session,
      pane_command: command,
      pane_command_sha256: createHash("sha256").update(command).digest("hex"),
      definition_ref: ref,
      definition_path: def.definition_abs,
      definition_sha256: definitionSha,
      definition_injection: { flag: "--append-system-prompt-file", path: snapshot, sha256: definitionSha },
      definition_carriage_verified: true,
      assignment_path: assignmentAbs,
      capability_scope: scope,
      requested_model: inst.model_id ?? null,
      plugin_root: activation.pluginRoot ?? null,
      credential_env_removed: Object.keys(this.opts.env ?? process.env).filter(isBindingEnvKey),
    });
  }

  ready(input: { instance_id: string; run_id: string }): TaskCellMechanicsResult {
    const id = this.panes.get(input.instance_id);
    if (!id) return { ok: false, reason: "no recorded pane for this instance" };
    const state = this.matchesRecorded(id);
    if (state !== "present") return { ok: false, reason: `recorded pane not present (${state})` };
    // Ready means the declared host process exists: a non-shell process at or under the
    // recorded pane_pid whose argv carries this instance's own declared-injection
    // argument. The launch shell's -c string also contains it, so shells never count;
    // guards and helpers do not carry it. Host or model qualification is never
    // inferred, and acknowledgement is observed separately via the ack claim.
    const hostArg = this.hostArgs.get(input.instance_id);
    if (!hostArg) return { ok: false, reason: "no declared host argument recorded" };
    const host = this.declaredHostProcess(id.pane_pid, hostArg);
    if (host === null) return { ok: false, reason: "process table unreadable" };
    if (host === "absent") return { ok: false, reason: "declared host process not started under the recorded pane" };
    return { ok: true, reason: `declared host process observed (pid ${host.pid}, ${host.comm})` };
  }

  /** The declared host under `panePid`, "absent", or null when ps cannot run. */
  private declaredHostProcess(panePid: number, hostArg: string): { pid: number; comm: string } | "absent" | null {
    const table = psRun(this.run, ["-axww", "-o", "pid=,ppid="]);
    if (table.status !== 0) return null;
    const children = new Map<number, number[]>();
    for (const line of table.stdout.split("\n")) {
      const [pid, ppid] = fields(line.replace(/\s+/g, " ")).map(Number);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      children.set(ppid!, [...(children.get(ppid!) ?? []), pid!]);
    }
    const queue = [panePid];
    const seen = new Set<number>();
    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      queue.push(...(children.get(pid) ?? []));
      const comm = psRun(this.run, ["-ww", "-o", "comm=", "-p", String(pid)]);
      const args = psRun(this.run, ["-ww", "-o", "args=", "-p", String(pid)]);
      if (comm.status !== 0 || args.status !== 0) continue;
      const name = path.basename(comm.stdout.trim()).replace(/^-/, "");
      const argv = args.stdout.trim();
      const at = argv.indexOf(` ${hostArg}`);
      const bounded = at >= 0 && (argv.length === at + hostArg.length + 1 || /\s/.test(argv[at + hostArg.length + 1]!));
      if (bounded && name.length > 0 && !LAUNCH_SHELLS.has(name)) return { pid, comm: name };
    }
    return "absent";
  }

  notifyAssignment(input: { instance_id: string; run_id: string; assignment_path: string }): TaskCellMechanicsResult {
    const id = this.panes.get(input.instance_id);
    if (!id) return { ok: false, reason: "no recorded pane for this instance" };
    const assignmentAbs = path.resolve(this.opts.cwd, input.assignment_path);
    if (!fs.existsSync(assignmentAbs)) return { ok: false, reason: "assignment not on disk" };
    const state = this.matchesRecorded(id);
    if (state !== "present") return { ok: false, reason: `recorded pane not present (${state})` };
    const ack = [...this.opts.ackArgv, "--assignment", assignmentAbs].map(shellQuote).join(" ");
    const sent = this.nudge.send(
      { transport_id: "tmux", handle_id: id.pane_id, host_id: null, host_kind: "claude", invocation: null },
      `Your assignment is at ${assignmentAbs}. Validate it, then claim it with: ${ack}`,
    );
    // The launch prompt already names the absolute assignment path, so delivery does
    // not depend on the nudge; a held nudge is reported, never hidden.
    return { ok: true, reason: sent.status === "succeeded" ? null : `nudge not delivered: ${sent.detail ?? sent.reason_code}` };
  }

  terminate(input: { instance_id: string; run_id: string; reason: string }): TaskCellMechanicsResult {
    const id = this.panes.get(input.instance_id);
    if (!id) return { ok: false, reason: "no recorded pane for this instance" };
    const out = terminateBoundPane(id.pane_id, id, { run: this.run });
    if (out.ok && out.confirmed && out.identity_check === "verified") return { ok: true, reason: null };
    return { ok: false, reason: `${out.degraded ? "degraded" : "unconfirmed"} (${out.identity_check}): ${out.error ?? "not confirmed"}` };
  }
}
