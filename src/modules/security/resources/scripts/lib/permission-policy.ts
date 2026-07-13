/**
 * scripts/lib/permission-policy.ts
 *
 * P1-L10 — the RUNTIME permission policy: phase-scoped `host_mode` / `guild_gates`
 * resolution, host-native launch-flag mappings, the load-bearing ORTHOGONALITY
 * INVARIANT, and the 4 safety rails — built on the L0 contract and the L3 wrapper.
 *
 * Contract authority (SoT — consumed, NEVER re-spelled):
 *   scripts/lib/permission-policy-schema.ts (P1-L0) — the model + predicates:
 *     resolveBaselineGolden / gateRequired / gatesPermittedToSkip /
 *     evaluateSafetyRails / ALWAYS_ASK_HARD_SET.  (C2 baseline golden.)
 *   scripts/lib/guild-run-wrapper.ts (P1-L3) — resolveLaunchMode (AC20 minimum-loss
 *     host launch-flag mapping; degrade-and-record, NEVER escalate).
 *   scripts/lib/host-registry.ts — DERIVED_HOST_CAPABILITY_ROWS (registry-derived,
 *     one row per registry host id + the legacy HostKind aliases; supersedes the
 *     hand-authored host-capabilities-schema.ts map, which had drifted for
 *     pi/antigravity and never carried the 4 wrapped-CLI hosts) + the P1-L0
 *     PermissionMode / per-host `permissions.launch_modes` types.
 *   .guild/spec/universal-host-p1.md §10 · .guild/plan/universal-host-p1.md P1-L10 + C2.
 *
 * WHY this is a thin tie-layer, not a re-implementation
 * ────────────────────────────────────────────────────
 *  - DEFAULT == baseline golden, BYTE-IDENTICAL: `resolvePermissionPolicy` does
 *    not re-derive the 36-cell table — it translates the live `auto_approve` token
 *    vocabulary into the L0 `BaselineConfig` and DELEGATES to the very
 *    `resolveBaselineGolden()` that GENERATED the committed golden fixture. The
 *    default config (`auto_approve:[]`, `bypass:"audit"`) therefore reproduces the
 *    golden by construction — drift is impossible.
 *  - HOST LAUNCH FLAGS: `resolveHostLaunch` delegates to L3 `resolveLaunchMode`.
 *    The flags map ONLY host autonomy (Claude `--permission-mode …`, Codex
 *    `--dangerously-bypass-approvals-and-sandbox`); they are NEVER consulted by the
 *    Guild-gate decision (the orthogonality invariant, proven structurally below).
 *  - ORTHOGONALITY: `guildGateRequired` is a function of `guild_gates` + `gate_type`
 *    ONLY. `host_mode` (and therefore the launch flags / a host YOLO/bypass mode) is
 *    structurally unreachable from the gate decision — a host bypass can NEVER skip a
 *    Guild gate unless `guild_gates` explicitly permits that gate type.
 *  - SAFETY RAILS evaluate L10's ACTUAL skip decision (F3), not a re-derivation.
 *
 * Security-auditor findings honored: F2 (the runtime resolver handles the `"all"`
 * sentinel + the `spec`→phase token migration the L0 reference deferred here);
 * F3 (rails take the real would-skip decision).
 *
 * PURITY: pure resolvers (no I/O, no clock, never throw), plus ONE best-effort
 * config reader (`readRuntimePermissionConfig`) that never throws — same discipline
 * as hooks/lib/security/config.ts. The CLI lives in scripts/permission-policy.ts.
 *
 * Owned by hook-engineer (P1-L10).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  type HostMode,
  type GuildGate,
  type Phase,
  type GateType,
  type BypassPolicy,
  type PermissionDecision,
  type BaselineConfig,
  type SafetyRailEvaluation,
  resolveBaselineGolden,
  gateRequired,
  evaluateSafetyRails,
  cellKey,
  PHASES,
  GATE_TYPES,
  ALWAYS_ASK_HARD_SET,
} from "./permission-policy-schema";

import {
  resolveLaunchMode,
  type LaunchModeResolution,
} from "./guild-run-wrapper";

import {
  type GuildHostCapabilitiesV1,
  type PermissionMode,
} from "./host-capabilities-schema";

// Registry-derived capability rows (G4b): a strict superset of the legacy
// hand-authored map — same rows for the keys this policy historically resolved
// (claude/codex/agents-file byte-identical; pi/antigravity permissions now match
// the registry's on-host-verified values), plus every registry host id, so e.g.
// "claude-code-cli" or "cursor" resolves to a real row instead of the
// unknown-host fallback.
import { DERIVED_HOST_CAPABILITY_ROWS as HOST_CAPABILITY_ROWS } from "./host-registry";

// ---------------------------------------------------------------------------
// Runtime config (the REAL config surface this policy is scoped over)
// ---------------------------------------------------------------------------

/**
 * The live permission-relevant config. Mirrors the two verified defaults the L0
 * C2 contract is grounded in:
 *   defaults.gates.auto_approve         (string[], default [])
 *   security.bypass_permissions_policy  ("deny"|"audit"|"allow", default "audit")
 *
 * `auto_approve` carries the LIVE token vocabulary — soft-gate names
 * (`spec|plan|build`) + the `all` sentinel — NOT lifecycle phase names. The
 * translation to phases happens in `resolvePermissionPolicy` (F2).
 */
export interface RuntimePermissionConfig {
  auto_approve: string[];
  bypass_permissions_policy: BypassPolicy;
  /**
   * Optional GLOBAL host-autonomy override (spec §10: `host_mode` per lifecycle
   * phase). Absent ⇒ the host default `"ask"` (today's behavior). Setting this
   * changes ONLY the host autonomy axis (→ launch flags); it NEVER changes
   * `guild_gates` or `bypass` (those come from the golden) — that is the
   * orthogonality invariant. A `bypass_all` here makes the host launch under
   * `--permission-mode bypassPermissions` / `--dangerously-bypass-…` while every
   * Guild gate the live `guild_gates` requires STILL fires.
   */
  host_mode?: HostMode;
  /** Optional PER-PHASE host-autonomy override; takes precedence over `host_mode`. */
  host_mode_by_phase?: Partial<Record<Phase, HostMode>>;
}

/** The baseline default — byte-identical inputs to the L0 BASELINE_DEFAULT_CONFIG. */
export const RUNTIME_DEFAULT_CONFIG: RuntimePermissionConfig = {
  auto_approve: [],
  bypass_permissions_policy: "audit",
};

// ---------------------------------------------------------------------------
// auto_approve token vocabulary → phase migration (F2)
// ---------------------------------------------------------------------------

/**
 * Live soft-gate `auto_approve` token → lifecycle phase. The live interactive
 * soft gates (oq11-gate-check.ts) are `spec | plan | build`; `spec` is the
 * IDEATE-phase spec gate, so it migrates to `ideate`. `plan`/`build` are their own
 * phases. The `all` sentinel is passed through verbatim (resolveBaselineGolden
 * honors it). Any token already equal to a phase name passes through unchanged.
 *
 * (F2: the L0 reference resolver explicitly deferred this token vocabulary +
 * `spec`→phase migration to the L10 production resolver.)
 */
const AUTO_APPROVE_TOKEN_TO_PHASE: Record<string, string> = {
  spec: "ideate",
  plan: "plan",
  build: "build",
  // "all" intentionally NOT mapped here — passed through as the sentinel.
};

/**
 * Mirror of `autoApproveCovers` (oq11-gate-check.ts:46) — `includes("all")` OR an
 * exact token match. Re-stated (not imported: the live one is a file-local helper)
 * with this pointer so a drift is caught by the L10 test that pins this behavior.
 */
export function autoApproveCovers(autoApprove: readonly string[], token: string): boolean {
  return autoApprove.includes("all") || autoApprove.includes(token);
}

/** Translate a live auto_approve token list into L0 phase-keyed approvals (F2). */
function toPhaseApprovals(autoApprove: readonly string[]): string[] {
  const out: string[] = [];
  for (const tok of autoApprove) {
    if (tok === "all") {
      out.push("all"); // sentinel — resolveBaselineGolden flips every non-hard-set cell
      continue;
    }
    out.push(AUTO_APPROVE_TOKEN_TO_PHASE[tok] ?? tok);
  }
  return out;
}

// ---------------------------------------------------------------------------
// (1) Phase-scoped policy resolution — default == baseline golden, byte-identical
// ---------------------------------------------------------------------------

/**
 * Resolve the full 36-cell `<phase>.<gate_type>` permission table for the given
 * live config. DELEGATES to the L0 `resolveBaselineGolden()` (the generator of the
 * committed golden) after translating the live token vocabulary — so the DEFAULT
 * config reproduces the C2 baseline golden BYTE-IDENTICALLY by construction, and
 * a non-default config flips ONLY the safe gate types (the L0 resolver keeps the
 * always-ask hard set unconditional).
 */
export function resolvePermissionPolicy(
  config: RuntimePermissionConfig = RUNTIME_DEFAULT_CONFIG
): Record<string, PermissionDecision> {
  const baselineConfig: BaselineConfig = {
    auto_approve: toPhaseApprovals(config.auto_approve),
    bypass_permissions_policy: config.bypass_permissions_policy,
  };
  const table = resolveBaselineGolden(baselineConfig);

  // Host-autonomy overlay (orthogonal axis). When NO override is present the
  // golden is returned UNTOUCHED — guaranteeing the default config reproduces the
  // C2 baseline golden byte-for-byte. An override changes ONLY decision.host_mode
  // (the host autonomy axis); guild_gates + bypass are left exactly as the golden
  // resolved them, so it cannot lift a Guild gate.
  const byPhase = config.host_mode_by_phase;
  const global = config.host_mode;
  if (!global && (!byPhase || Object.keys(byPhase).length === 0)) {
    return table;
  }
  const out: Record<string, PermissionDecision> = {};
  for (const phase of PHASES) {
    const override = byPhase?.[phase] ?? global;
    for (const gate of GATE_TYPES) {
      const k = cellKey(phase, gate);
      const cell = table[k];
      out[k] = override ? { ...cell, host_mode: override } : cell;
    }
  }
  return out;
}

/** Resolve a single cell's decision triple for `(phase, gate_type)`. */
export function resolveCell(
  phase: Phase,
  gate_type: GateType,
  config: RuntimePermissionConfig = RUNTIME_DEFAULT_CONFIG
): PermissionDecision {
  return resolvePermissionPolicy(config)[cellKey(phase, gate_type)];
}

// ---------------------------------------------------------------------------
// (2) Host-native launch-flag mapping (host_mode → host autonomy flags ONLY)
// ---------------------------------------------------------------------------

/** A resolved host launch mapping: the host id + the L3 launch resolution. */
export interface HostLaunchResolution extends LaunchModeResolution {
  /** The host the flags are for. */
  host: string;
  /** True when the host id is unknown to the registry (⇒ degraded, no flags). */
  unknown_host?: boolean;
}

/**
 * Resolve the host-native launch flags for a resolved `host_mode`. Delegates to
 * the L3 `resolveLaunchMode` (AC20: degrade to the closest LOWER-autonomy recipe,
 * never escalate, always record the loss). An unknown host degrades to the host
 * default (no flags) and records it — NEVER silently claims a mode.
 *
 * These flags govern HOST autonomy ONLY (tool/edit/sandbox). They are never an
 * input to the Guild-gate decision (`guildGateRequired`) — that is the
 * orthogonality invariant, enforced by construction (separate functions, no
 * shared input).
 */
export function resolveHostLaunch(host: string, host_mode: HostMode): HostLaunchResolution {
  const caps: GuildHostCapabilitiesV1 | undefined = HOST_CAPABILITY_ROWS[host];
  if (!caps) {
    return {
      host,
      unknown_host: true,
      requested: host_mode as PermissionMode,
      effective: host_mode as PermissionMode,
      args: [],
      degraded: true,
      host_default: true,
      reason: `host "${host}" is not in the registry; running with the host's own default (no autonomy flags) — minimum-loss, recorded.`,
    };
  }
  const res = resolveLaunchMode(caps, host_mode as PermissionMode);
  return { host, ...res };
}

// ---------------------------------------------------------------------------
// (3) ORTHOGONALITY INVARIANT — the Guild-gate decision ignores host_mode
// ---------------------------------------------------------------------------

/**
 * Whether a Guild gate of `gate_type` is REQUIRED, given ONLY the resolved
 * `guild_gates`. `host_mode` is structurally not a parameter here — a host
 * bypass/YOLO mode can NEVER reach this decision. Delegates to the L0
 * `gateRequired` predicate (which itself ignores host_mode and enforces the
 * always-ask hard set by construction — F1).
 *
 * THE orthogonality invariant, in code: `host_mode ⊥ gate decision`.
 *
 * @returns true ⇒ the Guild gate must run; false ⇒ guild_gates explicitly permits skip.
 */
export function guildGateRequired(guild_gates: GuildGate, gate_type: GateType): boolean {
  // The L0 predicate's first arg (host_mode) is `void`ed inside it. We pass a
  // fixed, meaningless sentinel to make the call site read unambiguously: the
  // gate decision does NOT vary with host_mode. (Proven across all 5 host_modes
  // in the L10 test.)
  const HOST_MODE_IRRELEVANT: HostMode = "ask";
  return gateRequired(HOST_MODE_IRRELEVANT, guild_gates, gate_type);
}

// ---------------------------------------------------------------------------
// (4) Integrated effective policy — ties the two orthogonal axes together
// ---------------------------------------------------------------------------

/** Run context for the 4 safety rails. */
export interface PolicyRunContext {
  /** Is this the first run on the repo? (rail 2) */
  first_run: boolean;
  /** Has the mandatory pre-flight dry-run completed? (rail 4) */
  dry_run_done: boolean;
}

export interface EffectivePolicy {
  phase: Phase;
  gate_type: GateType;
  /** The resolved {host_mode, guild_gates, bypass} triple (default == golden). */
  decision: PermissionDecision;
  /** Host-native launch flags for decision.host_mode (host autonomy axis ONLY). */
  host_launch: HostLaunchResolution;
  /** Whether the Guild gate is required — function of guild_gates + gate_type ONLY. */
  gate_required: boolean;
  /** The 4 safety rails, evaluated against the ACTUAL skip decision (F3). */
  rails: SafetyRailEvaluation;
  /**
   * The FINAL effective decision: a gate is skipped ONLY when it is not required
   * AND every safety rail passes. Required ⇒ never skipped, regardless of any
   * host autonomy mode (orthogonality) or rail state.
   */
  effective_skip: boolean;
}

/**
 * Resolve the full effective policy for `(host, phase, gate_type)` under `config`.
 * The two axes are computed by SEPARATE functions with NO shared input:
 *   - host autonomy  → `resolveHostLaunch(host, decision.host_mode)`
 *   - Guild gate     → `guildGateRequired(decision.guild_gates, gate_type)`
 * so the launch flags can never influence the gate decision. The final skip also
 * requires all 4 rails to pass.
 */
export function resolveEffectivePolicy(opts: {
  host: string;
  phase: Phase;
  gate_type: GateType;
  config?: RuntimePermissionConfig;
  ctx?: PolicyRunContext;
}): EffectivePolicy {
  const config = opts.config ?? RUNTIME_DEFAULT_CONFIG;
  const ctx = opts.ctx ?? { first_run: false, dry_run_done: true };

  const decision = resolveCell(opts.phase, opts.gate_type, config);

  // Axis A — host autonomy (depends ONLY on host + decision.host_mode).
  const host_launch = resolveHostLaunch(opts.host, decision.host_mode);

  // Axis B — Guild gate (depends ONLY on decision.guild_gates + gate_type).
  const gate_required = guildGateRequired(decision.guild_gates, opts.gate_type);

  // Rails take the REAL would-skip decision (F3): the gate is a candidate to skip
  // iff it is not required; the rails then decide whether that skip is permitted.
  const wouldSkip = !gate_required;
  const rails = evaluateSafetyRails(opts.gate_type, decision.guild_gates, ctx, wouldSkip);

  // FINAL: skip only when not required AND all rails pass. Required ⇒ never skip.
  const effective_skip = wouldSkip && rails.ok;

  return { phase: opts.phase, gate_type: opts.gate_type, decision, host_launch, gate_required, rails, effective_skip };
}

// ---------------------------------------------------------------------------
// Best-effort config reader (never throws — same discipline as security/config.ts)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Read the runtime permission config from `<cwd>/.guild/settings.json`:
 *   defaults.gates.auto_approve         → auto_approve   (default [])
 *   security.bypass_permissions_policy  → bypass         (default "audit")
 * Returns the documented defaults on ANY failure (missing file / parse error /
 * mistyped value). NEVER throws.
 *
 * (Reads the SAME locations as hooks/lib/security/config.ts `readSettingsAutoApprove`
 * + `parseSecurityConfig`, kept consistent so the policy and the PreToolUse hook
 * agree on the live posture.)
 */
export function readRuntimePermissionConfig(cwd: string): RuntimePermissionConfig {
  const out: RuntimePermissionConfig = {
    auto_approve: [],
    bypass_permissions_policy: "audit",
  };
  let parsed: unknown;
  try {
    const settingsPath = path.join(cwd, ".guild", "settings.json");
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return out;
  }
  if (!isPlainObject(parsed)) return out;

  // defaults.gates.auto_approve
  if (isPlainObject(parsed["defaults"])) {
    const gates = (parsed["defaults"] as Record<string, unknown>)["gates"];
    if (isPlainObject(gates) && isStringArray(gates["auto_approve"])) {
      out.auto_approve = gates["auto_approve"];
    }
  }
  // security.bypass_permissions_policy
  if (isPlainObject(parsed["security"])) {
    const bpp = (parsed["security"] as Record<string, unknown>)["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience: the full table as a flat array (for CLI / receipts)
// ---------------------------------------------------------------------------

export interface PolicyCell {
  phase: Phase;
  gate_type: GateType;
  decision: PermissionDecision;
  gate_required: boolean;
}

/** All 36 cells as an ordered array (phases × gate-types), gate-required folded in. */
export function resolvePolicyCells(
  config: RuntimePermissionConfig = RUNTIME_DEFAULT_CONFIG
): PolicyCell[] {
  const table = resolvePermissionPolicy(config);
  const cells: PolicyCell[] = [];
  for (const phase of PHASES) {
    for (const gate_type of GATE_TYPES) {
      const decision = table[cellKey(phase, gate_type)];
      cells.push({
        phase,
        gate_type,
        decision,
        gate_required: guildGateRequired(decision.guild_gates, gate_type),
      });
    }
  }
  return cells;
}

/** Re-export the hard set for callers that want to display the unliftable gates. */
export { ALWAYS_ASK_HARD_SET };
