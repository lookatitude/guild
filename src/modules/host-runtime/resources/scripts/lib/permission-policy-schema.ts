/**
 * scripts/lib/permission-policy-schema.ts
 *
 * P1-L0 FOUNDATION — the **permission model**: `host_mode` × `guild_gates`,
 * the load-bearing ORTHOGONALITY INVARIANT predicate, the 4 safety rails, and the
 * C2 baseline-golden resolver contract.
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p1.md §10 (orthogonality invariant + safety rails + baseline golden)
 *   .guild/plan/universal-host-p1.md P1-L10 + §Foundation-contract specifications C2
 *   .guild/wiki/decisions/universal-host-p1-l0-foundation-contracts.md (ADR-addendum)
 *
 * WHY (ADR ~1348/1602, load-bearing): `host_mode` governs HOST tool/edit/sandbox
 * autonomy; `guild_gates` governs GUILD lifecycle gates. They are INDEPENDENT — a
 * host bypass/YOLO mode (`bypass_all`) MUST NOT skip any Guild-layer gate (plan / qa /
 * release / ops / security / destructive) unless `guild_gates` explicitly permits that
 * gate type. Host autonomy NEVER implies gate autonomy.
 *
 * The default per-phase policy must reproduce today's effective behavior — the coarse
 * `auto_approve` flag (default `[]`) + `security.bypass_permissions_policy` (default
 * "audit") — BYTE-IDENTICAL across all 36 (phase × gate-type) cells (C2 baseline golden).
 *
 * CONTRACT: pure types + the orthogonality predicate + 4 safety-rail predicates + the
 * baseline-golden resolver reference + validators. No I/O, no clock, never throws.
 * L10 (hook-engineer) builds the runtime policy + host-launch mappings against this;
 * Lsec adversarially proves no host_mode skips a gate; Ltest asserts the golden.
 *
 * Owned by plugin-architect (P1-L0).
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/** Host autonomy modes (host tool/edit/sandbox). Mirrors PermissionMode in host-capabilities-schema. */
import { sealSet } from "../../src/modules/kernel/workflows/sealed-collections";

export const HOST_MODES = Object.freeze(["read_only", "ask", "accept_edits", "auto", "bypass_all"] as const);
export type HostMode = (typeof HOST_MODES)[number];

/** Guild lifecycle-gate autonomy. */
export const GUILD_GATES = Object.freeze(["ask", "auto-safe", "ask-on-block", "never-auto"] as const);
export type GuildGate = (typeof GUILD_GATES)[number];

/** Lifecycle phases the policy is scoped over. */
export const PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"] as const);
export type Phase = (typeof PHASES)[number];

/** Guild gate TYPES — the kinds of gate `guild_gates` may (or may not) permit. */
export const GATE_TYPES = Object.freeze(["plan", "qa", "release", "ops", "security", "destructive"] as const);
export type GateType = (typeof GATE_TYPES)[number];

/**
 * Bypass-permissions policy (today's `security.bypass_permissions_policy`). The enum
 * MUST match the live config surface verified in source: `"deny" | "audit" | "allow"`
 * (read-guild-config.ts:259 / settings-resolver.ts:144, validated read-guild-config.ts:1081).
 * `"audit"` is the default (audited-not-honored ⇒ no gate skipped); `"allow"` is the
 * only value that actually honors a host bypass. (P1-L0 audit fix: was "honor", the
 * real value is "allow" — flagged by the security-auditor's independent verification.)
 */
export const BYPASS_POLICIES = Object.freeze(["audit", "allow", "deny"] as const);
export type BypassPolicy = (typeof BYPASS_POLICIES)[number];

// ---------------------------------------------------------------------------
// Resolved decision (one per phase × gate-type cell)
// ---------------------------------------------------------------------------

/** The resolved triple for a (phase, gate_type) cell — the golden unit. */
export interface PermissionDecision {
  host_mode: HostMode;
  guild_gates: GuildGate;
  bypass: BypassPolicy;
}

// ---------------------------------------------------------------------------
// ORTHOGONALITY INVARIANT (load-bearing predicate)
// ---------------------------------------------------------------------------

/**
 * The set of gate types a given `guild_gates` value EXPLICITLY permits to be skipped.
 * This is the ONLY thing that can lift a gate requirement — `host_mode` is never
 * consulted. Conservative by construction:
 *   - "ask":          permits NOTHING (every gate required).
 *   - "ask-on-block": permits NOTHING to be auto-skipped (asks on block instead).
 *   - "auto-safe":    permits ONLY non-safety gate types {plan, qa} to auto-proceed;
 *                     NEVER the safety-critical set {release, ops, security, destructive}.
 *   - "never-auto":   permits NOTHING (everything stays manual).
 * (L10 may widen `auto-safe` per explicit config, but the BASELINE permits at most
 * {plan, qa}; release/ops/security/destructive are never auto under any guild_gates
 * value without an explicit per-gate config — see SAFETY_RAILS.)
 */
export function gatesPermittedToSkip(guild_gates: GuildGate): Set<GateType> {
  switch (guild_gates) {
    case "auto-safe":
      return new Set<GateType>(["plan", "qa"]);
    case "ask":
    case "ask-on-block":
    case "never-auto":
    default:
      return new Set<GateType>();
  }
}

/**
 * THE ORTHOGONALITY INVARIANT. Returns whether a Guild gate of `gate_type` is REQUIRED
 * given the resolved `host_mode` + `guild_gates`. The predicate IGNORES `host_mode`
 * entirely — a `bypass_all` host with `guild_gates:"ask"` STILL requires every gate.
 * A gate is NOT required only when `guild_gates` explicitly permits that gate type.
 *
 * @returns true ⇒ the Guild gate must run (cannot be skipped); false ⇒ explicitly permitted to skip.
 */
export function gateRequired(
  _host_mode: HostMode,
  guild_gates: GuildGate,
  gate_type: GateType
): boolean {
  // host_mode is deliberately unused — that IS the invariant. Referenced + voided so
  // any future code that tries to consult it is a visible, reviewable change.
  void _host_mode;
  // Defense-in-depth (security-auditor F1): the always-ask hard set is enforced HERE,
  // by construction — NOT only in evaluateSafetyRails (rail 3). A gate in the hard set
  // is ALWAYS required regardless of what gatesPermittedToSkip returns, so the
  // orthogonality invariant survives any future widening of `auto-safe` (the schema
  // explicitly invites L10 to widen it) without L10 having to remember to re-subtract
  // the hard set. Enforce in code, not prose.
  if (ALWAYS_ASK_HARD_SET.has(gate_type)) return true;
  return !gatesPermittedToSkip(guild_gates).has(gate_type);
}

// ---------------------------------------------------------------------------
// 4 SAFETY RAILS (non-negotiable, independent of host_mode)
// ---------------------------------------------------------------------------

/** Gate types that are NEVER autonomous regardless of any mode/gate config (rail 1). */
export const NEVER_AUTONOMOUS_GATES = sealSet(["ops", "destructive"], "NEVER_AUTONOMOUS_GATES");

/**
 * The always-ask hard set (rail 3): gate types that ALWAYS require a human gate,
 * unconditionally — even if `guild_gates` would otherwise permit a skip. This is the
 * backstop that makes the conservative `gatesPermittedToSkip` safe to widen later:
 * a widened config can never pierce this set.
 */
export const ALWAYS_ASK_HARD_SET = sealSet(["release", "security", "ops", "destructive"], "ALWAYS_ASK_HARD_SET");

/** Result of evaluating the safety rails for a cell. */
export interface SafetyRailEvaluation {
  /** True iff the cell, as resolved, honors all four rails. */
  ok: boolean;
  /** Each rail's pass/fail with a reason (for Lsec audit + receipts). */
  rails: { rail: 1 | 2 | 3 | 4; name: string; pass: boolean; reason: string }[];
}

/**
 * Evaluate the 4 ops safety rails for a resolved cell. These are INDEPENDENT of
 * host_mode and constrain `guild_gates`/run context.
 *
 *   rail 1 — incident/rollback (ops/destructive) NEVER autonomous.
 *   rail 2 — first run is interactive (no autonomy on the first run of a repo).
 *   rail 3 — the always-ask hard set is unconditional.
 *   rail 4 — a mandatory pre-flight dry-run precedes any autonomous action.
 *
 * @param ctx.first_run    is this the first run on the repo?
 * @param ctx.dry_run_done has the mandatory pre-flight dry-run completed?
 */
export function evaluateSafetyRails(
  gate_type: GateType,
  guild_gates: GuildGate,
  ctx: { first_run: boolean; dry_run_done: boolean },
  actualWouldSkip?: boolean
): SafetyRailEvaluation {
  // F3 (security-auditor): when L10 supplies its ACTUAL skip decision, validate THAT — do not
  // rubber-stamp a re-derivation from the conservative predicate (a skip taken via a path the
  // predicate doesn't reflect would otherwise compute wouldSkip=false and pass). Fall back to the
  // predicate only when no actual decision is supplied (pure contract tests).
  const wouldSkip = actualWouldSkip ?? !gateRequired("ask", guild_gates, gate_type); // host_mode irrelevant

  const rails: SafetyRailEvaluation["rails"] = [];

  // Rail 1 — incident/rollback (ops/destructive) never autonomous.
  const rail1Pass = !(NEVER_AUTONOMOUS_GATES.has(gate_type) && wouldSkip);
  rails.push({
    rail: 1,
    name: "incident/rollback never autonomous",
    pass: rail1Pass,
    reason: rail1Pass
      ? "ops/destructive gate requires a human gate"
      : `${gate_type} is in NEVER_AUTONOMOUS_GATES but guild_gates would skip it`,
  });

  // Rail 2 — first run interactive.
  const rail2Pass = !(ctx.first_run && wouldSkip);
  rails.push({
    rail: 2,
    name: "first run interactive",
    pass: rail2Pass,
    reason: rail2Pass ? "not first run, or gate required" : "first run must not auto-skip a gate",
  });

  // Rail 3 — always-ask hard set unconditional.
  const rail3Pass = !(ALWAYS_ASK_HARD_SET.has(gate_type) && wouldSkip);
  rails.push({
    rail: 3,
    name: "always-ask hard set unconditional",
    pass: rail3Pass,
    reason: rail3Pass
      ? "gate not in always-ask set, or required"
      : `${gate_type} is in ALWAYS_ASK_HARD_SET but guild_gates would skip it`,
  });

  // Rail 4 — mandatory pre-flight dry-run before any autonomous action.
  const rail4Pass = !(wouldSkip && !ctx.dry_run_done);
  rails.push({
    rail: 4,
    name: "mandatory pre-flight dry-run",
    pass: rail4Pass,
    reason: rail4Pass
      ? "dry-run completed, or no autonomous action"
      : "autonomous action requires a completed pre-flight dry-run",
  });

  return { ok: rails.every((r) => r.pass), rails };
}

// ---------------------------------------------------------------------------
// C2 — baseline-golden resolver (default policy reproduces today)
// ---------------------------------------------------------------------------

/**
 * Today's verified config defaults (the baseline):
 *   defaults.gates.auto_approve = []            (read-guild-config.ts:409 / settings-resolver:265)
 *   security.bypass_permissions_policy = "audit" (read-guild-config.ts:446 / settings-resolver:303)
 */
export interface BaselineConfig {
  /** Phases (or gate types) the user pre-approved. Default []. */
  auto_approve: string[];
  /** "deny" | "audit" (default) | "allow" — matches the live config enum. */
  bypass_permissions_policy: BypassPolicy;
}

export const BASELINE_DEFAULT_CONFIG: BaselineConfig = {
  auto_approve: [],
  bypass_permissions_policy: "audit",
};

/** A baseline-golden cell key: `<phase>.<gate_type>`. */
export function cellKey(phase: Phase, gate: GateType): string {
  return `${phase}.${gate}`;
}

/**
 * The C2 baseline-golden resolver. Given the (default) config, resolves EVERY one of
 * the 36 (phase × gate-type) cells. Under the default config every cell resolves to the
 * SAME triple `{ host_mode:"ask", guild_gates:"ask", bypass:"audit" }`:
 *   - nothing auto-approved (auto_approve = []) ⇒ guild_gates = "ask"
 *   - host autonomy is the host default ⇒ host_mode = "ask"
 *   - a bypass request is audited-not-honored ⇒ bypass = "audit" (no gate skipped)
 *
 * When a future config sets e.g. auto_approve:["build"], the build-phase cells flip
 * guild_gates → "auto-safe" — but the BASELINE golden is the all-ask table.
 *
 * @returns a map of all 36 `<phase>.<gate_type>` keys → PermissionDecision.
 */
export function resolveBaselineGolden(
  config: BaselineConfig = BASELINE_DEFAULT_CONFIG
): Record<string, PermissionDecision> {
  const out: Record<string, PermissionDecision> = {};
  const approved = new Set(config.auto_approve);
  // Live `autoApproveCovers` (oq11-gate-check.ts:46) is `includes("all") || includes(token)`.
  // Honor "all" here (security-auditor F2) so a non-default `auto_approve:["all"]` flips every
  // soft gate instead of silently matching no phase and dropping the user's config.
  // NOTE (L10 contract boundary): the production resolver owns the auto_approve TOKEN vocabulary
  // (the live tokens are gate/soft-gate names — `spec|plan|build` — NOT lifecycle phases) and the
  // `spec`→phase migration. This reference keys the per-phase flip purely as an illustration of the
  // baseline + the "all" sentinel; the DEFAULT (`[]`) — the load-bearing C2 golden — is exact.
  const allApproved = approved.has("all");
  for (const phase of PHASES) {
    for (const gate of GATE_TYPES) {
      // Baseline: a phase is auto-approved only if "all" or the phase is explicitly listed (default: none).
      const phaseApproved = allApproved || approved.has(phase);
      // Even when a phase is auto-approved, the always-ask hard set never flips.
      const guild_gates: GuildGate =
        phaseApproved && !ALWAYS_ASK_HARD_SET.has(gate) ? "auto-safe" : "ask";
      out[cellKey(phase, gate)] = {
        host_mode: "ask",
        guild_gates,
        bypass: config.bypass_permissions_policy,
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const HOST_MODE_SET = new Set<string>(HOST_MODES);
const GUILD_GATE_SET = new Set<string>(GUILD_GATES);
const BYPASS_SET = new Set<string>(BYPASS_POLICIES);

/** Validate a single PermissionDecision triple. Never throws. */
export function validatePermissionDecision(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["permission decision must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  if (typeof o["host_mode"] !== "string" || !HOST_MODE_SET.has(o["host_mode"] as string)) {
    errors.push(`host_mode must be one of ${HOST_MODES.join("|")}; got ${JSON.stringify(o["host_mode"])}`);
  }
  if (typeof o["guild_gates"] !== "string" || !GUILD_GATE_SET.has(o["guild_gates"] as string)) {
    errors.push(`guild_gates must be one of ${GUILD_GATES.join("|")}; got ${JSON.stringify(o["guild_gates"])}`);
  }
  if (typeof o["bypass"] !== "string" || !BYPASS_SET.has(o["bypass"] as string)) {
    errors.push(`bypass must be one of ${BYPASS_POLICIES.join("|")}; got ${JSON.stringify(o["bypass"])}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a 36-cell baseline-golden table: every `<phase>.<gate_type>` key present
 * exactly once, each a valid decision. Never throws.
 */
export function validateBaselineGoldenTable(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["baseline golden must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  const expected = PHASES.length * GATE_TYPES.length; // 36
  if (keys.length !== expected) {
    errors.push(`baseline golden must have exactly ${expected} cells; got ${keys.length}`);
  }
  for (const phase of PHASES) {
    for (const gate of GATE_TYPES) {
      const k = cellKey(phase, gate);
      if (!(k in o)) {
        errors.push(`missing cell ${k}`);
        continue;
      }
      const r = validatePermissionDecision(o[k]);
      if (!r.valid) for (const e of r.errors) errors.push(`${k}: ${e}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
