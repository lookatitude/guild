/**
 * scripts/lib/routing-ab-contract.ts
 *
 * P1-L0 FOUNDATION — C4: the **routing A/B compare contract**. The decision surfaces
 * were CLOSED at G-spec; this module restates them and ships the canonical-JSON
 * deep-equal compare method the SC-4 A/B (L7) uses to prove the registry unification
 * is byte-identical for Claude/Codex.
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p1.md SC-4
 *   .guild/plan/universal-host-p1.md §Foundation-contract specifications C4
 *   docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md (ADR-addendum)
 *
 * The two named decision surfaces (byte-identical pre/post-registry for Claude+Codex):
 *   - `RoutingDecision` (host-router.ts:186) from `route()`        (host-router.ts:433–595)
 *   - `SelectResult`    (provider-detect.ts:130) from `selectReviewer()` (provider-detect.ts:424–536)
 *
 * Both are serialized via canonical-JSON (recursively sorted keys) and compared
 * deep-equal. The compare is structural — NOT reference-equality — so L7 can swap the
 * registry behind the surface and assert the SERIALIZED decision is unchanged.
 *
 * CONTRACT: pure functions only. No I/O, no clock, never throws (except on a value that
 * cannot be canonicalized — circular refs; the surfaces are plain data and never cyclic).
 *
 * Owned by plugin-architect (P1-L0); consumed by L7 (registry A/B), Ltest (SC-4).
 */

// Re-export the two surface SHAPES so L7/Ltest import them from one contract module.
export type { RoutingDecision } from "./host-router";
export type { SelectResult } from "./provider-detect";

// ---------------------------------------------------------------------------
// Canonical JSON (recursively sorted keys)
// ---------------------------------------------------------------------------

/**
 * Produce a canonical JSON string for `value`: object keys sorted recursively,
 * arrays preserved in order, primitives as `JSON.stringify` renders them. Two values
 * that are deep-equal (modulo key order) produce the SAME string. `undefined` object
 * properties are dropped (matching `JSON.stringify`), so an absent key and an
 * explicit-`undefined` key canonicalize identically.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Recursively rebuild `value` with sorted object keys. Pure. */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue; // mirror JSON.stringify: drop undefined props
    out[key] = canonicalize(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deep-equal compare (the SC-4 A/B method)
// ---------------------------------------------------------------------------

/** Deep structural equality via canonical-JSON. The SC-4 A/B compare method. */
export function deepEqualCanonical(a: unknown, b: unknown): boolean {
  return canonicalJSON(a) === canonicalJSON(b);
}

/** Diff result for a failed A/B compare — surfaces the two canonical strings for the test. */
export interface AbCompareResult {
  equal: boolean;
  /** Present only when !equal. */
  expected_canonical?: string;
  actual_canonical?: string;
}

/**
 * Compare a pre-registry (`expected`) decision against a post-registry (`actual`) one.
 * On mismatch returns both canonical strings so the failing test can show the byte diff.
 * Generic over the surface type (`RoutingDecision` | `SelectResult`).
 */
export function compareRoutingAb<T>(expected: T, actual: T): AbCompareResult {
  const e = canonicalJSON(expected);
  const a = canonicalJSON(actual);
  if (e === a) return { equal: true };
  return { equal: false, expected_canonical: e, actual_canonical: a };
}
