/**
 * scripts/lib/runstart-preflight.ts
 *
 * Usage (library — no CLI, no process.exit):
 *   import { runStartPreflight, persistTmuxTeamArgv } from "./lib/runstart-preflight";
 *   const result = runStartPreflight({ cwd, flags?, probe? });
 *   // if result.needsTmuxPrompt: ask the operator, then on yes:
 *   //   run config-cmd with result.tmuxPrompt.persistCommand (U2's config set)
 *
 * Unit 3 of the settings-control-and-tmux initiative.
 *
 * PURE, injectable library — it NEVER writes settings, never starts a run trace.
 * The interactive prompt and run-trace start are the ORCHESTRATOR's job (U7 wires
 * this into each /guild:* command's intake). This library computes decisions and
 * returns a structured result so it is deterministically testable.
 *
 * Wiring contract for U7 (per-command intake):
 *   1. Call runStartPreflight({ cwd, flags?, probe? }) before run-trace start.
 *   2. If result.needsTmuxPrompt, ask the operator:
 *        result.tmuxPrompt.question
 *      On yes, invoke config-cmd with result.tmuxPrompt.persistCommand:
 *        npx tsx scripts/config-cmd.ts <...result.tmuxPrompt.persistCommand> --cwd <cwd>
 *      On no, continue with the current resolved backend.
 *   3. Proceed to run-trace start (U6 writes the resolved snapshot to disk).
 *
 * OD-3 (OPERATOR-CONFIRMED 2026-05-31): The tmux prompt fires when the effective
 * agent_mode !== "team". This means "auto" DOES trigger the prompt. On yes,
 * `agent_mode: "team"` is persisted deterministically via config-cmd set (U2),
 * which is a HARD-SET write (always-ask under auto-approve). Persistence NEVER
 * happens directly in this library — the orchestrator runs the argv.
 *
 * ResolvedSettingsSnapshot is the data object U6 will persist to
 * .guild/runs/<id>/resolved-settings.json. This library only RETURNS the object —
 * it does NOT write any file. U6 owns the write + adds resolved_at (timestamp).
 *
 * Probe injection (PreflightProbe): tests pass a fake probe; production uses
 * defaultPreflightProbe(cwd) which shells out for tmux + uses the real provider
 * probe env. CI-safe — never hard-depends on tmux or codex being installed.
 */

import {
  resolveSettings,
  type ResolvedConfig,
  type ResolveResult,
  type Source,
} from "../../config";
import {
  HOST_ADAPTER_CONTRACT_VERSION,
  detectProviders,
  defaultProbeEnv,
  recommendProvider,
  selectReviewer,
  type AuthorIdentityTrust,
  type DetectionResult,
  type DetectedProvider,
  type HostFamily,
  type NativeAdapterIdentity,
  type ProbeEnv,
} from "../../host-runtime";
// P1-L8: resolve the three per-run roles (host/advisory/adversarial) from the live
// detection and record them in the snapshot (capability-matrix-driven, not host-name).
import { resolveRolesForRun, type RoleResolutionSet } from "../../capability";
import {
  validateModels,
  validateSecurity,
  validateSecretsPolicy,
  validateMcp,
  validateCrossHostBlock,
  validateDefaults,
} from "../../config";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Injectable probe seam. Tests pass a fake; production uses defaultPreflightProbe.
 * No method may throw — each returns a safe falsy default on failure.
 */
export interface PreflightProbe {
  /** Is `tmux` on PATH? */
  tmuxOnPath(): boolean;
  /**
   * W4 (run-identity-and-dispatch): is CMUX_WORKSPACE_ID present — i.e. is
   * this run starting inside a cmux workspace? OPTIONAL and additive: a probe
   * that predates the cmux rung yields the honest `false` fact, never a
   * fabricated one. Read once here and FROZEN into the snapshot; later phases
   * consume the snapshot instead of re-probing (RID-D-CONSTRAINT: backend
   * resolution is frozen at intake).
   */
  cmuxWorkspacePresent?(): boolean;
  /**
   * The provider-detect ProbeEnv for detectProviders / recommendProvider.
   * Injected separately so provider tests can be reused across U3+U4.
   */
  providerProbe: ProbeEnv;
  /**
   * Incomplete-run detection (06-initiatives session intake, step zero).
   * Returns the run id from .guild/runs/current-run-id when that run's dir
   * exists and carries no verify.md (i.e. the previous run never reached
   * verify-done); null otherwise. Best-effort + non-throwing.
   */
  incompleteRun(): { runId: string; runDir: string } | null;
  /**
   * T3 (guild.session_context.v1 §4 step 2): identity injected by the native
   * adapter that actually started this process — trust `verified`. The default
   * probe reads the host-set process markers (e.g. CLAUDECODE / a plugin-root
   * env the Claude Code host exports). Absent/undefined ⇒ no native identity,
   * and an `auto` host resolves the honest `unknown` (§3) — never claude.
   */
  hostIdentity?(): NativeAdapterIdentity | null;
}

/**
 * Version of Guild's native Claude host-adapter contract. This is deliberately
 * independent of the Claude Code executable version: session-context has a
 * separate `execution_target.tool_version` field for the running host binary.
 */
export const CLAUDE_CODE_NATIVE_ADAPTER_VERSION = HOST_ADAPTER_CONTRACT_VERSION;

/**
 * Resolve the native Claude adapter only after a host-set marker is present.
 * The host marker is the identity proof. The adapter version names Guild's
 * stable adapter contract, not whichever `claude` executable PATH happens to
 * resolve after the session has already started.
 */
export function detectClaudeNativeAdapterIdentity(
  env: Record<string, string | undefined>,
): NativeAdapterIdentity | null {
  if (env["CLAUDECODE"] !== "1" && !env["CLAUDE_PLUGIN_ROOT"]) return null;
  return {
    family: "claude",
    surface: "cli",
    adapter_id: "claude-code-native",
    adapter_version: CLAUDE_CODE_NATIVE_ADAPTER_VERSION,
    evidence:
      "host-set process env marker (CLAUDECODE / CLAUDE_PLUGIN_ROOT) " +
      "injected by the Claude Code host at spawn; interpreted by Guild " +
      `adapter contract ${CLAUDE_CODE_NATIVE_ADAPTER_VERSION}`,
  };
}

/** Options for runStartPreflight. */
export interface PreflightOptions {
  /** The project root whose settings to resolve. */
  cwd: string;
  /**
   * CLI flag overrides (passed to resolveSettings as `flags`). Only keys
   * present here override the layered result.
   */
  flags?: Partial<ResolvedConfig>;
  /**
   * Injected probe. Defaults to defaultPreflightProbe(cwd) (shells out).
   * Always inject in tests — never rely on real tmux/codex existing in CI.
   */
  probe?: PreflightProbe;
}

/**
 * The resolved settings snapshot shape U6 will persist.
 * This library RETURNS this object; U6 writes it to disk and fills in
 * resolved_at (timestamp). resolved_at_ref is null here — U6 provides it.
 */
export interface ResolvedSettingsSnapshot {
  /** Stable schema identifier. */
  schema_version: "guild.resolved_settings.v1";
  /**
   * Per-key source map from resolveSettings. Maps each ResolvedConfig top-level
   * key to its winning source layer.
   */
  source_chain: Record<string, string>;
  /** The effective values U7/U6 need at a glance. */
  effective: {
    agent_mode: ResolvedConfig["agent_mode"];
    host: ResolvedConfig["host"];
    review: ResolvedConfig["review"];
    rigor: ResolvedConfig["rigor"];
    loops: ResolvedConfig["loops"];
    loop_cap: ResolvedConfig["loop_cap"];
    /**
     * #93 — the resolved `defaults.dispatch.block_unmarked_lanes`, hoisted to the
     * snapshot's flat `effective` block for the same reason `agent_mode` is here:
     * `hooks/lib/backend-degradation.ts` runs inside `pre-tool-use.js`, which
     * fires on EVERY tool call and therefore cannot afford to import the settings
     * resolver (doing so takes that bundle from 110 KB to 923 KB). Reading the
     * frozen snapshot gives the guard the FULL resolver fidelity — workspace
     * inheritance, `settings.local.json`, the whole 5-layer chain — at the cost
     * of one ADDITIONAL `fs.readFileSync` of the same snapshot file the guard
     * path already opens for `agent_mode` (a second read, not a free ride on the
     * first). That read is paid only after every cheap-first short-circuit in
     * `pre-tool-use.ts` has passed, so it never lands on the ordinary tool call.
     *
     * OPTIONAL on the read side: a run whose snapshot predates #93 has no field,
     * and the guard falls back to the registered default (OFF).
     */
    block_unmarked_lanes: ResolvedConfig["defaults"]["dispatch"]["block_unmarked_lanes"];
  };
  /** Provider detection snapshot (the OD-5 per-run detection). */
  providers: {
    authorHost: HostFamily;
    /**
     * T3 F4: trust of the author identity the detection ran under
     * (session_context §3). `asserted` identity never yields a selected cross
     * reviewer or a strong adversarial role — recorded so downstream consumers
     * (execute-plan, review broker) can branch honestly.
     */
    authorTrust: AuthorIdentityTrust;
    detected: DetectedProvider[];
    recommended: string | null;
    /** The operator-selected provider id, if chosen before run-trace start. */
    selected?: string;
  };
  /**
   * P1-L8: the resolved per-run role set (host/advisory/adversarial), capability-matrix
   * driven. Default Claude+Codex ⇒ host=claude, advisory=claude (local advisor),
   * adversarial=codex (different family, strong). Recorded so execute-plan can route
   * advisory advice and the review path can pick the adversarial substrate.
   */
  roles: RoleResolutionSet;
  /**
   * W4 (run-identity-and-dispatch): the dispatch backend RESOLVED AND FROZEN at
   * intake, with the raw capability facts it was resolved from. cmux is a
   * first-class value here (preferred over tmux when the workspace fact is
   * present) — not a hooks-only degradation branch. Later phases read this
   * snapshot; they never re-probe and never re-decide.
   */
  dispatch: RunStartDispatchResolution;
  /**
   * The review communication contract version. UNCHANGED per AC-9.
   * All providers communicate through packet/result/trail under
   * .guild/runs/<id>/review/<gate>/ using this schema.
   */
  communication_contract: "review_result.v1";
  /**
   * Timestamp / run-id reference added by U6 when writing to disk.
   * null here — U6 fills it in.
   */
  resolved_at_ref: null;
}

// ---------------------------------------------------------------------------
// W4 — run-start dispatch-backend resolution (frozen at intake)
// ---------------------------------------------------------------------------

/** The first-class backend values the intake freeze can resolve. */
export type RunStartDispatchBackend = "cmux" | "tmux" | "agent" | "subagent";

/** The raw capability facts the backend was resolved from — persisted verbatim. */
export interface RunStartDispatchFacts {
  cmux_workspace_present: boolean;
  tmux_on_path: boolean;
  agent_mode: string;
}

export interface RunStartDispatchResolution {
  backend: RunStartDispatchBackend;
  reason: string;
  facts: RunStartDispatchFacts;
}

/**
 * The PURE intake ladder for the frozen backend value. Mirrors the substrate
 * ladders in `selectExecutionSubstrate` (dispatch module) and the hooks'
 * `resolveTeamSubstrate` — restated here because lifecycle may not import the
 * dispatch module (the dependency points the other way); the pinned tests in
 * cmux-backend-selection.test.ts keep the three ladders in step.
 *
 *   team/auto : cmux workspace → "cmux"  (rung 0 — BEFORE any tmux fact)
 *               tmux on PATH  → "tmux"
 *               otherwise     → "subagent" (honest floor)
 *   agent     : "agent"    (explicit pin, never hijacked)
 *   subagent  : "subagent" (explicit pin, never hijacked)
 */
export function resolveRunStartDispatchBackend(
  agentMode: string,
  facts: { cmuxWorkspacePresent: boolean; tmuxOnPath: boolean }
): RunStartDispatchResolution {
  const base: RunStartDispatchFacts = {
    cmux_workspace_present: facts.cmuxWorkspacePresent,
    tmux_on_path: facts.tmuxOnPath,
    agent_mode: agentMode,
  };
  if (agentMode === "agent") {
    return { backend: "agent", reason: "explicit agent_mode=agent", facts: base };
  }
  if (agentMode === "subagent") {
    return { backend: "subagent", reason: "explicit agent_mode=subagent", facts: base };
  }
  // team / auto (and any unrecognized value, resolved conservatively team-ward)
  if (facts.cmuxWorkspacePresent) {
    return {
      backend: "cmux",
      reason: `agent_mode=${agentMode} + CMUX_WORKSPACE_ID present → visible cmux surfaces (lead-driven)`,
      facts: base,
    };
  }
  if (facts.tmuxOnPath) {
    return {
      backend: "tmux",
      reason: `agent_mode=${agentMode} + tmux on PATH → tmux team panes`,
      facts: base,
    };
  }
  return {
    backend: "subagent",
    reason: `agent_mode=${agentMode} with no team substrate (no cmux workspace, no tmux) → subagent floor`,
    facts: base,
  };
}

/** The structured result runStartPreflight returns. */
export interface PreflightResult {
  /** Full resolveSettings result: config + per-key source map. */
  resolved: ResolveResult;
  /**
   * Per-key source map — hoisted to the top level for U6/U7 consumers.
   * Identical content to `resolved.sources`; present here so callers can
   * destructure `{ resolved, sources, validation, ... }` without reaching
   * into the nested `resolved` object. snapshot.source_chain is consistent
   * with this map.
   */
  sources: Record<string, Source>;
  /** Closed-key validation of the RESOLVED config via the exported validators. */
  validation: {
    ok: boolean;
    errors: string[];
  };
  /** tmux availability and whether the effective backend is "team". */
  tmux: {
    /** True iff tmux is on PATH (injectable probe). */
    available: boolean;
    /**
     * True iff the effective agent_mode is "team". This is the OD-3 check:
     * inEffect = (resolved.config.agent_mode === "team").
     */
    inEffect: boolean;
  };
  /**
   * OD-3: true IFF tmux.available AND effective agent_mode !== "team".
   * "auto" triggers the prompt — the operator asked for deterministic "team".
   */
  needsTmuxPrompt: boolean;
  /**
   * Present when needsTmuxPrompt is true; null otherwise.
   * Carries the operator-facing question and the argv for config-cmd set.
   *
   * AC-5: The question is a clear English sentence. The persistCommand is the
   * exact argv to pass to config-cmd.ts (the orchestrator runs it on yes).
   * Persistence NEVER happens here — the library stays read-only w.r.t. settings.
   */
  tmuxPrompt: {
    /** The question to show the operator. */
    question: string;
    /**
     * The argv to run config-cmd with on operator yes.
     * Flow: npx tsx scripts/config-cmd.ts <...persistCommand> --cwd <cwd>
     * This is always the U2 "HARD-SET" path — never a direct settings write.
     */
    persistCommand: string[];
  } | null;
  /**
   * Incomplete-run intake (06-initiatives): present when .guild/runs/current-run-id
   * names a run directory without a verify.md — the previous run never completed.
   * Detection only; the consuming entrypoint surfaces the question BEFORE
   * initiative classification. null when the prior run is closed or absent.
   */
  incompleteRun: {
    runId: string;
    runDir: string;
    /** Operator-facing question (resume / restart / attach / ignore). */
    question: string;
  } | null;
  /** Provider detection + recommendation + R-008 selection. */
  providers: {
    authorHost: HostFamily;
    /** T3 F4: trust of the author identity (see ResolvedSettingsSnapshot). */
    authorTrust: AuthorIdentityTrust;
    detected: DetectedProvider[];
    recommended: string | null;
    reason: string;
    /**
     * R-008: The deterministically SELECTED provider via selectReviewer (AC-8 hard rule).
     * Present when selectReviewer returns status="selected" (explicit pin honored, or
     * auto-pick succeeded). Undefined when degraded-local or skipped.
     * The orchestrator MUST use `selected` (not `recommended`) as the dispatch target
     * when non-undefined — `selected` has passed the AC-8 false-signoff guard.
     */
    selected?: string;
  };
  /**
   * T3 (guild.session_context.v1): the adapter-injected identity inputs the
   * run-start entrypoint threads into startRun's `session_identity` so the
   * frozen session context records the §4 precedence honestly. `envelope_host`
   * is the explicit (non-"auto") host setting — an ASSERTION; `native_adapter`
   * is the probe-detected host identity — `verified`. Both may be absent, in
   * which case the context records the terminal `unknown` (§3).
   */
  session_identity: {
    envelope_host?: string;
    native_adapter: NativeAdapterIdentity | null;
  };
  /**
   * The data object U6 will write to .guild/runs/<id>/resolved-settings.json.
   * This library only computes and returns it; U6 owns the file write + timestamp.
   */
  snapshot: ResolvedSettingsSnapshot;
}

// ---------------------------------------------------------------------------
// persistTmuxTeamArgv — the argv helper
// ---------------------------------------------------------------------------

/**
 * Returns the argv to pass to config-cmd.ts to persist `agent_mode: "team"` at
 * the given scope. Default scope is "workspace" (writes the workspace-root
 * .guild/settings.json, per OD-3 and the operator preference for workspace-level
 * settings).
 *
 * The orchestrator runs this on operator yes:
 *   npx tsx scripts/config-cmd.ts <...persistTmuxTeamArgv()> --cwd <cwd>
 *
 * IMPORTANT: this flows through U2's config set (HARD-SET), never a direct write.
 * The library is read-only w.r.t. settings.
 */
export function persistTmuxTeamArgv(
  scope: "workspace" | "project" | "local" = "workspace"
): string[] {
  return ["set", "agent_mode", "team", "--scope", scope];
}

// ---------------------------------------------------------------------------
// runStartPreflight — the main entry point
// ---------------------------------------------------------------------------

/**
 * Compute the full run-start preflight decision.
 *
 * 1. Resolve the settings chain via resolveSettings (U1).
 * 2. Validate the resolved config via the closed-key validators (U2/read-guild-config).
 * 3. Probe tmux availability (injectable; CI-safe).
 * 4. Compute needsTmuxPrompt (OD-3).
 * 5. Detect host+providers via detectProviders + recommendProvider (U4).
 * 6. Build the ResolvedSettingsSnapshot (for U6 to persist).
 *
 * The library NEVER writes settings, NEVER starts a run trace.
 */
export function runStartPreflight(opts: PreflightOptions): PreflightResult {
  const { cwd, flags, probe: injectedProbe } = opts;
  const probe = injectedProbe ?? defaultPreflightProbe(cwd);

  // ------------------------------------------------------------------
  // Step 1 — Resolve settings through the inheritance chain (U1)
  // ------------------------------------------------------------------
  const resolved = resolveSettings({ cwd, flags: flags ?? {} });
  const { config, sources } = resolved;

  // ------------------------------------------------------------------
  // Step 2 — Validate closed keys in the resolved config
  // ------------------------------------------------------------------
  const validationErrors: string[] = [];

  // models block
  if (config.models) {
    validationErrors.push(
      ...validateModels(config.models as unknown as Record<string, unknown>)
    );
  }
  // security block
  if (config.security) {
    validationErrors.push(
      ...validateSecurity(config.security as unknown as Record<string, unknown>)
    );
  }
  // secrets_policy block
  if (config.secrets_policy) {
    validationErrors.push(
      ...validateSecretsPolicy(config.secrets_policy as unknown as Record<string, unknown>)
    );
  }
  // mcp block
  if (config.mcp) {
    validationErrors.push(
      ...validateMcp(config.mcp as unknown as Record<string, unknown>)
    );
  }
  // defaults block (including defaults.cross_host via validateDefaults)
  if (config.defaults) {
    validationErrors.push(
      ...validateDefaults(config.defaults as unknown as Record<string, unknown>, false)
    );
  }

  const validation = {
    ok: validationErrors.length === 0,
    errors: validationErrors,
  };

  // ------------------------------------------------------------------
  // Step 3 — Probe tmux (injectable)
  // ------------------------------------------------------------------
  const tmuxAvailable = safeProbe(() => probe.tmuxOnPath(), false);
  const agentModeIsTeam = config.agent_mode === "team";

  const tmux = {
    available: tmuxAvailable,
    inEffect: agentModeIsTeam,
  };

  // W4: read the cmux workspace fact ONCE and resolve the dispatch backend the
  // run is frozen to. An absent optional probe member is the honest `false`.
  const cmuxWorkspacePresent = safeProbe(
    () => probe.cmuxWorkspacePresent?.() === true,
    false
  );
  const dispatch = resolveRunStartDispatchBackend(String(config.agent_mode), {
    cmuxWorkspacePresent,
    tmuxOnPath: tmuxAvailable,
  });

  // ------------------------------------------------------------------
  // Step 4 — Compute needsTmuxPrompt (OD-3, operator-confirmed)
  // Prompt fires when tmux is available AND effective agent_mode !== "team".
  // "auto" DOES trigger — operator wants deterministic "team" pinning.
  // ------------------------------------------------------------------
  const needsTmuxPrompt = tmuxAvailable && !agentModeIsTeam;

  const tmuxPrompt: PreflightResult["tmuxPrompt"] = needsTmuxPrompt
    ? {
        question:
          "tmux is available on this machine. Update settings to use tmux agent teams " +
          "for all Guild runs? (Recommended — gives you visible team panes and " +
          "deterministic team dispatch.)",
        persistCommand: persistTmuxTeamArgv("workspace"),
      }
    : null;

  // ------------------------------------------------------------------
  // Step 5 — Detect host + providers (U4, injectable probe)
  // ------------------------------------------------------------------
  // Build the review projection from the resolved config.
  // R-008: use the adversarial_review_provider pin from settings when set.
  // Falls back to "auto" (provider-detect selects best) when absent or "auto".
  // config.adversarial_review_provider is always a string (default "auto") per ResolvedConfig.
  const resolvedProvider: string =
    config.adversarial_review_provider !== "auto"
      ? config.adversarial_review_provider
      : "auto";

  const reviewProjection = {
    mode: config.review,
    provider: resolvedProvider,
  } as { mode: typeof config.review; provider: string };

  // T3 — guild.session_context.v1 §3/§4: an explicit non-"auto" host setting
  // is a caller ASSERTION (precedence step 1, canonical registry id from the
  // settings resolver); the native-adapter identity is `verified` (step 2).
  // Rework F4: downstream provider/reviewer/role resolution consumes the
  // RESOLVED identity + trust:
  //   - VERIFIED native evidence ALWAYS wins the resolved author family. A
  //     verified value that CONTRADICTS the assertion REPLACES it before any
  //     reviewer selection (the frozen session context records the conflict) —
  //     a contradicted assertion can never steer a same-family reviewer into a
  //     cross-family "strong" sign-off.
  //   - An assertion with no verification stays `asserted`: it resolves the
  //     family for detection, but selection/roles degrade (asserted ⇒ weak).
  //   - Nothing present resolves the honest terminal "unknown"/`asserted`.
  const explicitHost: string | undefined =
    config.host && config.host !== "auto" ? config.host : undefined;
  const nativeIdentity: NativeAdapterIdentity | null = probe.hostIdentity
    ? safeProbe(() => probe.hostIdentity!(), null)
    : null;
  const identityHost: string | undefined = nativeIdentity
    ? nativeIdentity.family
    : explicitHost;
  const identityTrust: AuthorIdentityTrust = nativeIdentity ? "verified" : "asserted";

  const detection: DetectionResult = safeProbe(
    () =>
      detectProviders({
        cwd,
        host: identityHost,
        trust: identityTrust,
        probe: probe.providerProbe,
      }),
    { authorHost: "unknown" as HostFamily, authorTrust: "asserted", providers: [] }
  );

  const recResult = safeProbe(
    () => recommendProvider(detection, reviewProjection),
    { recommended: null as string | null, reason: "provider detection failed" }
  );

  // R-008: when adversarial_review_provider is explicitly pinned (not "auto"),
  // route through selectReviewer (AC-8 hard-rule) so the pin is actually honored.
  // selectReviewer enforces the false-signoff guard (same-family rejection) and
  // the selectability check — it never silently substitutes another provider.
  // recommendProvider (OD-5 auto recommendation) is kept for the `providers.recommended`
  // field so auto-detection still surfaces the best available provider for informational
  // purposes, but `providers.selected` is what the orchestrator MUST use when non-null.
  const selResult = safeProbe(
    () => selectReviewer(detection, reviewProjection),
    { provider: null as string | null, status: "skipped" as const, reason: "selectReviewer failed" }
  );
  const selectedProvider: string | undefined =
    selResult.status === "selected" ? (selResult.provider ?? undefined) : undefined;

  // P1-L8: resolve the three per-run roles from the live detection (pure; reads the
  // registry capability columns, never the host name). Defensive fallback mirrors the
  // detection-failure posture: no substrate, weak — never a false `strong`.
  const roles: RoleResolutionSet = safeProbe(
    () => resolveRolesForRun(detection),
    {
      schema_version: "guild.role_resolution.v1",
      host: { role: "host", substrate: null, strength: "weak", reason: "role resolution failed" },
      advisory: { role: "advisory", substrate: null, strength: "weak", reason: "role resolution failed" },
      adversarial: { role: "adversarial", substrate: null, strength: "weak", reason: "role resolution failed" },
    }
  );

  const providers: PreflightResult["providers"] = {
    authorHost: detection.authorHost,
    // R3-F1: authorTrust is non-optional on DetectionResult — always present.
    authorTrust: detection.authorTrust,
    detected: detection.providers,
    recommended: recResult.recommended,
    reason: recResult.reason,
    // R-008: populated when a provider is deterministically selected (explicit pin or auto).
    // undefined when degraded-local or skipped.
    ...(selectedProvider !== undefined ? { selected: selectedProvider } : {}),
  };

  // ------------------------------------------------------------------
  // Step 6 — Build the ResolvedSettingsSnapshot (U6 will persist this)
  // ------------------------------------------------------------------
  const snapshot: ResolvedSettingsSnapshot = {
    schema_version: "guild.resolved_settings.v1",
    source_chain: sources,
    effective: {
      agent_mode: config.agent_mode,
      host: config.host,
      review: config.review,
      rigor: config.rigor,
      loops: config.loops,
      loop_cap: config.loop_cap,
      // #93: the backend-degradation guard's strict rung, resolved once here so
      // the per-tool-call hook never has to re-resolve it.
      block_unmarked_lanes: config.defaults.dispatch.block_unmarked_lanes,
    },
    providers: {
      authorHost: detection.authorHost,
      authorTrust: detection.authorTrust,
      detected: detection.providers,
      recommended: recResult.recommended,
      // R-008: store the selectReviewer decision in the persisted snapshot so U6/hooks
      // can read the actual provider-to-dispatch from resolved-settings.json.
      ...(selectedProvider !== undefined ? { selected: selectedProvider } : {}),
    },
    roles,
    dispatch,
    communication_contract: "review_result.v1",
    resolved_at_ref: null,
  };

  // ------------------------------------------------------------------
  // Incomplete-run intake (06-initiatives) — deterministic detection only.
  // Runs BEFORE initiative classification in the consuming entrypoint.
  // ------------------------------------------------------------------
  const incompleteHit = safeProbe(() => probe.incompleteRun(), null);
  const incompleteRun = incompleteHit
    ? {
        runId: incompleteHit.runId,
        runDir: incompleteHit.runDir,
        question:
          `Run ${incompleteHit.runId} is still open (no verify.md). ` +
          `Resume it, restart the phase, attach this work to it, or ignore and start fresh? ` +
          `[resume / restart / attach / ignore]`,
      }
    : null;

  return {
    resolved,
    sources,       // top-level convenience alias for resolved.sources (U6/U7 contract)
    validation,
    tmux,
    needsTmuxPrompt,
    tmuxPrompt,
    incompleteRun,
    providers,
    snapshot,
    session_identity: {
      ...(explicitHost !== undefined ? { envelope_host: explicitHost } : {}),
      native_adapter: nativeIdentity,
    },
  };
}

// ---------------------------------------------------------------------------
// Default (production) probe — shells out; never used in tests.
// ---------------------------------------------------------------------------

/**
 * The production PreflightProbe. Every method is best-effort + non-throwing.
 * Never import real binaries into tests — always inject a fake PreflightProbe.
 */
export function defaultPreflightProbe(cwd: string): PreflightProbe {
  return {
    tmuxOnPath: () =>
      safeProbe(() => {
        execSync("command -v tmux", { stdio: "ignore" });
        return true;
      }, false),
    // W4: the cmux workspace fact — a cheap host-set env marker, no subprocess.
    cmuxWorkspacePresent: () =>
      safeProbe(() => (process.env["CMUX_WORKSPACE_ID"] ?? "").trim().length > 0, false),
    providerProbe: defaultProbeEnv(cwd),
    incompleteRun: () =>
      safeProbe(() => {
        const idFile = join(cwd, ".guild", "runs", "current-run-id");
        if (!existsSync(idFile)) return null;
        const runId = readFileSync(idFile, "utf8").trim();
        if (!runId) return null;
        const runDir = join(cwd, ".guild", "runs", runId);
        if (!existsSync(runDir)) return null;
        if (existsSync(join(runDir, "verify.md"))) return null;
        return { runId, runDir };
      }, null),
    // T3 — session_context §4 step 2: the Claude Code host sets CLAUDECODE=1
    // (and a plugin-root env) in every process it spawns; that host-set marker
    // is native-adapter evidence for family "claude". No marker ⇒ null — the
    // caller then records the honest "unknown", never a defaulted family.
    hostIdentity: () =>
      safeProbe<NativeAdapterIdentity | null>(() => {
        return detectClaudeNativeAdapterIdentity(process.env);
      }, null),
  };
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function safeProbe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
