/**
 * scripts/lib/role-model-schema.ts
 *
 * P1-L0 FOUNDATION — the **role model**: types + resolution rules for the three
 * per-run roles `host`, `advisory`, `adversarial`, resolved from the capability
 * matrix (never host-name guessing).
 *
 * Contract authority (SoT):
 *   ADR: universal-host-plugin-architecture (workspace wiki) §Host Role Model
 *   docs/contracts/universal-host-p1-l0-foundation-contracts.md (ADR-addendum)
 *   .guild/plan/universal-host-p1.md P1-L8 + §Foundation-contract specifications
 *
 * WHY: the run resolves each role to the STRONGEST available substrate, driven by
 * the registry's independent columns, NOT the host name. The adversarial role must
 * be a DIFFERENT family from the host to score `strong` (cross-host independence —
 * the same observable signal `independence: strong|weak` the router already emits,
 * host-router.ts:200). The DEFAULT Claude+Codex resolution must match today's
 * implicit behavior (host=claude, advisory=claude/local-advisor, adversarial=codex).
 *
 * CONTRACT: pure types + a pure `resolveRoles()` reference predicate + validators.
 * No I/O, no clock, never throws. L8 wires the resolver into preflight / execute-plan
 * / review-broker; this module is the design-time contract L8 + Ltest assert against.
 *
 * Owned by plugin-architect (P1-L0); consumed by L8 (resolver+wiring), Ltest (SC-5).
 */

import { type HostId, HOST_IDS, type HostRegistryEntry } from "../../host-runtime";

// ---------------------------------------------------------------------------
// Role + strength types
// ---------------------------------------------------------------------------

export const ROLES = ["host", "advisory", "adversarial"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Strength of a role resolution.
 *   - "strong": the substrate fully satisfies the role (and, for adversarial, is a
 *               DIFFERENT family from the host — true cross-host independence).
 *   - "weak":   the role is satisfied only degradedly (e.g. adversarial fell back to
 *               the same family as the host — independence lost; or advisory fell back
 *               to the local advisor). Mirrors host-router's `independence` signal.
 */
export const ROLE_STRENGTHS = ["strong", "weak"] as const;
export type RoleStrength = (typeof ROLE_STRENGTHS)[number];

/** A single resolved role. */
export interface RoleResolution {
  role: Role;
  /** The resolved substrate's registry host id, or null when no substrate qualifies. */
  substrate: HostId | null;
  strength: RoleStrength;
  /** Human-readable why (for the run manifest + receipts). */
  reason: string;
}

/** The full per-run role resolution recorded in the run manifest. */
export interface RoleResolutionSet {
  schema_version: "guild.role_resolution.v1";
  host: RoleResolution;
  advisory: RoleResolution;
  adversarial: RoleResolution;
}

// ---------------------------------------------------------------------------
// Resolution rules (capability-matrix-driven — the reference predicate)
// ---------------------------------------------------------------------------

/**
 * Inputs to role resolution: the available registry rows (the box's detected hosts),
 * plus the resolved `host` substrate (already chosen — advisory/adversarial resolve
 * relative to it). All resolution reads COLUMNS, never the host name.
 */
export interface RoleResolveInput {
  /** Registry rows available on this box, in preference order (registry order = base preference). */
  available: HostRegistryEntry[];
}

/**
 * Rank helper: a substrate's "host strength" = installable here AND dispatch_selectable.
 * The `host` role goes to the strongest such substrate (registry/preference order
 * breaks ties — same convention as provider-detect's registry order).
 */
function isHostCapable(e: HostRegistryEntry): boolean {
  return e.installability !== "none" && e.dispatch_selectable;
}

/**
 * Reference resolver (pure). L8's wired resolver MUST produce the same resolution for
 * the same inputs (contract-tested). The rules:
 *
 *   host        = first `available` row that is installable + dispatch_selectable.
 *   advisory    = first dispatch_selectable row; defaults to the host substrate
 *                 (today's local advisor runs on the host). `strong` when a
 *                 dispatch_selectable substrate exists; never below the host.
 *   adversarial = first `result_adapter` row of a DIFFERENT family from the host →
 *                 `strong`. If only a same-family result_adapter exists → that, `weak`
 *                 (independence lost). If none → null/`weak`.
 *
 * Default Claude+Codex box ⇒ host=claude, advisory=claude(strong, local advisor),
 * adversarial=codex(strong, different family) — byte-identical to today.
 */
export function resolveRoles(input: RoleResolveInput): RoleResolutionSet {
  const avail = input.available;

  // ── host ──────────────────────────────────────────────────────────────────
  const hostEntry = avail.find(isHostCapable) ?? null;
  const host: RoleResolution = hostEntry
    ? {
        role: "host",
        substrate: hostEntry.host_id,
        strength: "strong",
        reason: `strongest installable+dispatch_selectable substrate (${hostEntry.host_id})`,
      }
    : {
        role: "host",
        substrate: null,
        strength: "weak",
        reason: "no installable+dispatch_selectable substrate available",
      };

  // ── advisory ────────────────────────────────────────────────────────────────
  // The advisory substrate is the strongest dispatch_selectable host; defaults to
  // the host substrate (today: the local advisor runs on the host).
  const advisoryEntry = avail.find((e) => e.dispatch_selectable) ?? hostEntry;
  const advisory: RoleResolution = advisoryEntry
    ? {
        role: "advisory",
        substrate: advisoryEntry.host_id,
        strength: "strong",
        reason:
          advisoryEntry === hostEntry
            ? `advisory defaults to the host substrate (${advisoryEntry.host_id}, local advisor)`
            : `strongest dispatch_selectable advisory substrate (${advisoryEntry.host_id})`,
      }
    : {
        role: "advisory",
        substrate: null,
        strength: "weak",
        reason: "no dispatch_selectable advisory substrate available",
      };

  // ── adversarial (different-family-for-strong) ───────────────────────────────
  const hostFamily = hostEntry?.family ?? null;
  const diffFamily = avail.find((e) => e.result_adapter && e.family !== hostFamily) ?? null;
  const sameFamily = avail.find((e) => e.result_adapter && e.family === hostFamily) ?? null;
  let adversarial: RoleResolution;
  if (diffFamily) {
    adversarial = {
      role: "adversarial",
      substrate: diffFamily.host_id,
      strength: "strong",
      reason: `different-family result_adapter substrate (${diffFamily.host_id}) — cross-host independence`,
    };
  } else if (sameFamily) {
    adversarial = {
      role: "adversarial",
      substrate: sameFamily.host_id,
      strength: "weak",
      reason: `only a same-family result_adapter (${sameFamily.host_id}) — independence lost (weak)`,
    };
  } else {
    adversarial = {
      role: "adversarial",
      substrate: null,
      strength: "weak",
      reason: "no result_adapter substrate available — adversarial review degrades",
    };
  }

  return {
    schema_version: "guild.role_resolution.v1",
    host,
    advisory,
    adversarial,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ROLE_SET = new Set<string>(ROLES);
const STRENGTH_SET = new Set<string>(ROLE_STRENGTHS);
const HOST_ID_SET = new Set<string>(HOST_IDS);

function validateRoleResolution(x: unknown, expectedRole: Role, errors: string[]): void {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    errors.push(`${expectedRole} must be a present object`);
    return;
  }
  const r = x as Record<string, unknown>;
  if (r["role"] !== expectedRole || !ROLE_SET.has(r["role"] as string)) {
    errors.push(`${expectedRole}.role must be "${expectedRole}"; got ${JSON.stringify(r["role"])}`);
  }
  // substrate must be null or a KNOWN registry host id (the HostId|null type) — an
  // unknown host (e.g. the sunset "gemini") must be rejected (codex G-lane finding).
  if (!(r["substrate"] === null || (typeof r["substrate"] === "string" && HOST_ID_SET.has(r["substrate"] as string)))) {
    errors.push(
      `${expectedRole}.substrate must be one of ${HOST_IDS.join("|")} or null; got ${JSON.stringify(r["substrate"])}`
    );
  }
  if (typeof r["strength"] !== "string" || !STRENGTH_SET.has(r["strength"] as string)) {
    errors.push(`${expectedRole}.strength must be strong|weak; got ${JSON.stringify(r["strength"])}`);
  }
  if (typeof r["reason"] !== "string" || (r["reason"] as string).trim() === "") {
    errors.push(`${expectedRole}.reason must be a non-empty string`);
  }
}

/** Validate a `guild.role_resolution.v1` set. Never throws. */
export function validateRoleResolutionSet(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["role resolution set must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  if (o["schema_version"] !== "guild.role_resolution.v1") {
    errors.push(
      `schema_version must be "guild.role_resolution.v1"; got ${JSON.stringify(o["schema_version"])}`
    );
  }
  validateRoleResolution(o["host"], "host", errors);
  validateRoleResolution(o["advisory"], "advisory", errors);
  validateRoleResolution(o["adversarial"], "adversarial", errors);
  return { valid: errors.length === 0, errors };
}
