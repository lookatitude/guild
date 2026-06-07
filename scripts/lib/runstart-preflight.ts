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
} from "./settings-resolver";
import {
  detectProviders,
  recommendProvider,
  selectReviewer,
  type DetectionResult,
  type DetectedProvider,
  type HostFamily,
  type ProbeEnv,
} from "./provider-detect";
import {
  validateModels,
  validateSecurity,
  validateSecretsPolicy,
  validateMcp,
  validateCrossHostBlock,
  validateDefaults,
} from "../read-guild-config";
import { execSync } from "child_process";

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
   * The provider-detect ProbeEnv for detectProviders / recommendProvider.
   * Injected separately so provider tests can be reused across U3+U4.
   */
  providerProbe: ProbeEnv;
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
  };
  /** Provider detection snapshot (the OD-5 per-run detection). */
  providers: {
    authorHost: HostFamily;
    detected: DetectedProvider[];
    recommended: string | null;
    /** The operator-selected provider id, if chosen before run-trace start. */
    selected?: string;
  };
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
  /** Provider detection + recommendation + R-008 selection. */
  providers: {
    authorHost: HostFamily;
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

  const detection: DetectionResult = safeProbe(
    () =>
      detectProviders({
        cwd,
        host: config.host,
        probe: probe.providerProbe,
      }),
    { authorHost: "unknown" as HostFamily, providers: [] }
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

  const providers: PreflightResult["providers"] = {
    authorHost: detection.authorHost,
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
    },
    providers: {
      authorHost: detection.authorHost,
      detected: detection.providers,
      recommended: recResult.recommended,
      // R-008: store the selectReviewer decision in the persisted snapshot so U6/hooks
      // can read the actual provider-to-dispatch from resolved-settings.json.
      ...(selectedProvider !== undefined ? { selected: selectedProvider } : {}),
    },
    communication_contract: "review_result.v1",
    resolved_at_ref: null,
  };

  return {
    resolved,
    sources,       // top-level convenience alias for resolved.sources (U6/U7 contract)
    validation,
    tmux,
    needsTmuxPrompt,
    tmuxPrompt,
    providers,
    snapshot,
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
  // Lazy-import to keep the module import graph clean; the real probe env
  // is provided by provider-detect (already imported above).
  const { defaultProbeEnv } = require("./provider-detect") as typeof import("./provider-detect");
  return {
    tmuxOnPath: () =>
      safeProbe(() => {
        execSync("command -v tmux", { stdio: "ignore" });
        return true;
      }, false),
    providerProbe: defaultProbeEnv(cwd),
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
