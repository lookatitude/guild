/**
 * scripts/lib/cloud-consent-gate.ts
 *
 * Cloud-reviewer consent egress gate (ITEM 25, v2.x).
 *
 * Contract (BY POINTER): docs/v2/09-adversarial-review.md §"The review artifact bus"
 *   §Cloud-reviewer consent (egress gate) [v2.x]
 * Dispatch diagram reference: docs/v2/08-dispatch-execution.md §2 (cloud_opt_in
 *   checkpoint in the host-adapter-router flowchart).
 *
 * This module implements the **pre-dispatch consent gate** that MUST fire before
 * any packet is sent to a cloud reviewer (`codex-cloud`).
 * (A speculative `gemini-cloud` endpoint was removed when Gemini was sunset 2026-06-14.)
 * The gate is a hard always-ask checkpoint: it fires regardless of
 * `--auto-approve`. Absent explicit cloud_opt_in, the result is DENY and the
 * broker degrades to the local/weak path.
 *
 * Design:
 *   - PURE: no I/O, no Date.now(), no Math.random() inside exported functions.
 *     Callers supply all inputs. The gate is deterministic and trivially testable.
 *   - DEFAULT DENY: any input that does not carry an explicit, truthy
 *     `cloud_opt_in` results in `allowed: false`. This includes absent / null /
 *     false / undefined — the safe default is never "allow on ambiguity".
 *   - DORMANT SURFACE: in v2.0 no cloud reviewer is selectable
 *     (`codex-plugin`/`codex-cli` are the only selectable providers). This gate
 *     is wired when the first cloud adapter ships. Until then, callers that
 *     encounter a non-cloud reviewerHost will receive `allowed: false` with a
 *     reason that correctly describes the gate's purpose.
 *   - DEFENSIVE CONFIG READ: `cloud_opt_in` is not yet a tracked key in
 *     `read-guild-config.ts`. Callers pass it in from the resolved settings object
 *     defensively (safe default: false when absent). See `shared_file_needs`.
 *
 * Usage:
 *   import { cloudConsentGate, isCloudReviewer } from "./lib/cloud-consent-gate";
 *
 *   const result = cloudConsentGate({ cloud_opt_in: false, reviewerHost: "codex-cloud" });
 *   // result.allowed === false, result.reason describes the denial.
 *
 *   const result2 = cloudConsentGate({ cloud_opt_in: true, reviewerHost: "codex-cloud" });
 *   // result2.allowed === true — consent given, caller may proceed to egress.
 *
 * Owned by tooling-engineer (scripts/ scope). Security event emission for egress
 * decisions is [v2.x] — see docs/v2/11-security.md (guild.security_event.v1).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The set of reviewer host ids recognized as cloud (off-box) endpoints.
 * Closed set: new cloud reviewers must be added here explicitly — an
 * unrecognized host string is never silently promoted to cloud status.
 */
export const CLOUD_REVIEWER_HOSTS = ["codex-cloud"] as const;

/** A member of the closed cloud-reviewer host set. */
export type CloudReviewerHost = (typeof CLOUD_REVIEWER_HOSTS)[number];

/**
 * Input to the consent gate. All fields are optional so callers can pass a
 * partial resolved-settings object defensively — missing fields default safe.
 */
export interface ConsentGateInput {
  /**
   * Explicit per-run human-approved cloud opt-in (the `cloud_opt_in` config
   * key — v2.x; not yet tracked in read-guild-config.ts; see shared_file_needs).
   * Default: false (DENY). Must be `true` — truthy non-boolean values are
   * normalized to boolean to prevent accidental string-coercion bypasses.
   */
  cloud_opt_in?: boolean | unknown;
  /**
   * The reviewer host id the broker is about to dispatch to.
   * Examples: "codex-cloud", "codex-plugin", "codex-cli", "claude".
   * When absent or empty the gate defaults to DENY (cannot determine host).
   */
  reviewerHost?: string;
  /**
   * Optional caller-supplied context string included in the `reason` on denial.
   * Useful for logging which gate / packet triggered the check.
   */
  context?: string;
}

/**
 * The gate's verdict. Immutable; callers may not mutate fields.
 *
 *   allowed: true  — consent present AND reviewerHost is a known cloud endpoint;
 *                    caller may proceed to packet egress.
 *   allowed: false — denied; broker MUST degrade to local/weak path and record
 *                    the downgrade. `reason` is always a non-empty string.
 */
export interface ConsentGateResult {
  readonly allowed: boolean;
  /** Human-readable denial or approval reason. Always non-empty. */
  readonly reason: string;
  /**
   * The normalized reviewerHost the gate evaluated against. Useful for the
   * caller to confirm the gate saw the same host it passed in.
   */
  readonly evaluatedHost: string | null;
  /**
   * True when the reviewerHost was recognized as a cloud endpoint. False when
   * the host is local/unknown (the gate denies unknown hosts too — safer than
   * allowing an unrecognized target).
   */
  readonly isCloudHost: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Type-guard: is `host` a member of the CLOUD_REVIEWER_HOSTS closed set?
 * Only cloud hosts require this consent gate. Local hosts (codex-plugin,
 * codex-cli, claude-code) are always-allowed for dispatch — they do not export
 * artifacts past the filesystem boundary and do not need a consent check.
 */
export function isCloudReviewer(host: string | undefined | null): host is CloudReviewerHost {
  if (!host) return false;
  return (CLOUD_REVIEWER_HOSTS as readonly string[]).includes(host);
}

/**
 * Normalize the `cloud_opt_in` input to a strict boolean.
 * Any non-`true` value (including non-boolean truthy values) is treated as
 * false. This prevents accidental string-coercion bypasses (e.g. "false" as
 * a string is truthy in JS — we require the literal boolean `true`).
 */
function normalizeOptIn(value: unknown): boolean {
  return value === true;
}

// ---------------------------------------------------------------------------
// cloudConsentGate — the exported pure gate function
// ---------------------------------------------------------------------------

/**
 * Pre-dispatch consent gate for cloud reviewers.
 *
 * Decision matrix:
 *
 * | reviewerHost       | cloud_opt_in | Result   |
 * |--------------------|--------------|----------|
 * | absent / empty     | any          | DENY     |
 * | local (non-cloud)  | any          | DENY*    |
 * | cloud (closed set) | false/absent | DENY     |
 * | cloud (closed set) | true         | ALLOW    |
 *
 * (*) Local hosts do not require this gate. Passing a local host to this
 * function is itself a mis-call — the caller should only invoke this gate
 * when `isCloudReviewer(host)` is true. The gate still returns DENY for
 * local hosts rather than ALLOW, because allowing an unrecognized host
 * through a consent gate is never safe.
 *
 * Pure: no I/O, no side effects, no impure calls. Safe to call in tests
 * without any filesystem setup.
 */
export function cloudConsentGate(input: ConsentGateInput): ConsentGateResult {
  const host = input.reviewerHost ?? null;
  const trimmedHost = typeof host === "string" && host.trim().length > 0 ? host.trim() : null;
  const isCloud = isCloudReviewer(trimmedHost ?? undefined);
  const optIn = normalizeOptIn(input.cloud_opt_in);
  const ctx = input.context ? ` [context: ${input.context}]` : "";

  // Gate 1: no host supplied — cannot evaluate, deny.
  if (trimmedHost === null) {
    return {
      allowed: false,
      reason:
        `cloud-consent-gate DENY: no reviewerHost supplied — cannot evaluate egress consent.` +
        ` Broker must degrade to local/weak path.${ctx}`,
      evaluatedHost: null,
      isCloudHost: false,
    };
  }

  // Gate 2: host is not in the closed cloud set — not a cloud dispatch, deny
  // (caller should not have invoked this gate for a local host; deny is the
  // safe posture for any unrecognized target).
  if (!isCloud) {
    return {
      allowed: false,
      reason:
        `cloud-consent-gate DENY: '${trimmedHost}' is not a recognized cloud reviewer` +
        ` (known cloud hosts: ${CLOUD_REVIEWER_HOSTS.join(", ")}).` +
        ` This gate only governs cloud egress; local reviewers do not require consent.` +
        ` Broker must degrade to local/weak path.${ctx}`,
      evaluatedHost: trimmedHost,
      isCloudHost: false,
    };
  }

  // Gate 3: cloud host confirmed, but no explicit opt-in — deny (default DENY rule).
  if (!optIn) {
    return {
      allowed: false,
      reason:
        `cloud-consent-gate DENY: cloud_opt_in is not set (or is false) for cloud reviewer` +
        ` '${trimmedHost}'. Dispatching to a cloud reviewer exports .guild/ artifacts past` +
        ` the filesystem boundary — explicit per-run human-approved consent is required,` +
        ` regardless of --auto-approve. Broker must degrade to local/weak path.${ctx}`,
      evaluatedHost: trimmedHost,
      isCloudHost: true,
    };
  }

  // Gate 4: cloud host + explicit opt-in — allow.
  return {
    allowed: true,
    reason:
      `cloud-consent-gate ALLOW: cloud_opt_in=true for cloud reviewer '${trimmedHost}'.` +
      ` Egress checkpoint passed — caller may proceed to packet dispatch.${ctx}`,
    evaluatedHost: trimmedHost,
    isCloudHost: true,
  };
}

// ---------------------------------------------------------------------------
// Convenience: gate for the always-ask fallback (the broker's checkpoint)
// ---------------------------------------------------------------------------

/**
 * The always-ask fallback checkpoint (docs/v2/09 §"Cloud-reviewer consent"):
 * when `cloud_opt_in` is absent from the resolved settings, fire this check
 * before dispatching and treat any non-explicit-true as DENY.
 *
 * This is the same as `cloudConsentGate` with `cloud_opt_in` defaulting to
 * false — it is a named entry point so broker code is self-documenting.
 *
 * The "always-ask" semantics (fires regardless of `--auto-approve`) are
 * enforced by the CALLER (the broker skill), not by this function. This
 * function is pure and always uses default-DENY regardless of any
 * auto-approve context passed in.
 */
export function alwaysAskConsentCheckpoint(
  reviewerHost: string | undefined,
  explicitOptIn?: boolean
): ConsentGateResult {
  return cloudConsentGate({
    cloud_opt_in: explicitOptIn,
    reviewerHost,
    context: "always-ask-checkpoint",
  });
}
