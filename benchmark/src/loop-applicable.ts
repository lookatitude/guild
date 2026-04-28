// v1.4.0 adversarial-loops — `loops_applicable` enum + plan-validate
// decision tree.
//
// Architect contract (verbatim, see benchmark/plans/v1.4-loop-skill-contracts.md
// §"`loops_applicable` enum — five valid values" and the T6 carve-out
// decision tree).
//
// The enum values appear in the architect's documented order:
//   none, l3-only, l4-only, both, full
//
// Plan-validate (T3a-backend-config) rejects unknown values with exit 2
// and the literal error:
//   loops_applicable must be one of: none, l3-only, l4-only, both, full
//
// Security-owned lanes have a 4-case decision tree:
//   1. Omits loops_applicable → reject exit 2 with literal error
//      `security-owned lane <lane_id> must set loops_applicable explicitly`.
//   2. Sets loops_applicable: none WITH the literal end-of-line marker
//      `# review lane; loops_applicable=none per T6 carve-out` →
//      ACCEPT (T6 exemption).
//   3. Sets loops_applicable: none WITHOUT the marker → reject exit 2
//      with literal error
//      `security-owned lane <lane_id> sets loops_applicable=none without the T6 exemption marker`.
//   4. Sets l3-only / l4-only / both / full → ACCEPT (normal path).

/**
 * The five valid `loops_applicable` enum values, in the architect's
 * canonical order. Verify-done greps for this exact list:
 *
 *   none, l3-only, l4-only, both, full
 */
export const LOOPS_APPLICABLE_VALUES = [
  "none",
  "l3-only",
  "l4-only",
  "both",
  "full",
] as const;

export type LoopsApplicable = (typeof LOOPS_APPLICABLE_VALUES)[number];

/**
 * Layer-set dispatched per `loops_applicable` value.
 *
 * | Value     | L3 | L4 | security-review |
 * | --------- | -- | -- | --------------- |
 * | none      | no | no | no              |
 * | l3-only   | yes| no | no              |
 * | l4-only   | no | yes| no              |
 * | both      | yes| yes| no              |
 * | full      | yes| yes| yes             |
 */
export interface LayerSet {
  L3: boolean;
  L4: boolean;
  "security-review": boolean;
}

export function layersFor(value: LoopsApplicable): LayerSet {
  switch (value) {
    case "none":
      return { L3: false, L4: false, "security-review": false };
    case "l3-only":
      return { L3: true, L4: false, "security-review": false };
    case "l4-only":
      return { L3: false, L4: true, "security-review": false };
    case "both":
      return { L3: true, L4: true, "security-review": false };
    case "full":
      return { L3: true, L4: true, "security-review": true };
  }
}

/**
 * The literal end-of-line comment marker that signals the T6
 * "review with pattern patch" carve-out. Verify-done greps for this
 * exact substring:
 *
 *   # review lane; loops_applicable=none per T6 carve-out
 *
 * Any non-T6 lane that uses this marker triggers a follow-up
 * (T6-security owns the carve-out).
 */
export const T6_CARVEOUT_MARKER =
  "# review lane; loops_applicable=none per T6 carve-out";

/**
 * The literal error string emitted for an unknown enum value.
 * Verify-done greps for the exact text.
 */
export const LOOPS_APPLICABLE_INVALID_ERROR =
  "loops_applicable must be one of: none, l3-only, l4-only, both, full";

/**
 * Per-lane plan block as parsed by plan-validate. Only the fields
 * relevant to `loops_applicable` validation are typed here; the broader
 * lane shape lives in `guild:plan` and is not duplicated.
 */
export interface PlanLaneBlock {
  lane_id: string;
  owner: string;
  /** Optional: when omitted, the per-owner-type default applies. */
  loops_applicable?: string;
  /**
   * Optional end-of-line comment captured for the same line as
   * `loops_applicable:`. Used to detect the T6 carve-out marker.
   */
  loops_applicable_line_comment?: string;
}

export type ValidationResult =
  | { ok: true; resolved: LoopsApplicable }
  | { ok: false; error: string };

/**
 * Default `loops_applicable` per owner-type, when the plan block omits it.
 *
 * | Owner                                                   | Default      |
 * |---------------------------------------------------------|--------------|
 * | backend / frontend / mobile / devops                    | full         |
 * | qa (when primary implementer of test fixtures)          | l4-only      |
 * | technical-writer / copywriter / social-media            | l4-only      |
 * | researcher / architect (pure design) / marketing /      |              |
 * | sales / seo / non-user-facing copy                      | none         |
 * | security                                                | NO DEFAULT — |
 * |                                                         | plan must    |
 * |                                                         | set explicitly |
 *
 * Returning `null` means the owner has no default — the caller MUST
 * reject the lane if `loops_applicable` is absent. Today only `security`
 * returns null.
 */
export function defaultLoopsApplicable(owner: string): LoopsApplicable | null {
  switch (owner) {
    case "backend":
    case "frontend":
    case "mobile":
    case "devops":
      return "full";
    case "qa":
    case "technical-writer":
    case "copywriter":
    case "social-media":
      return "l4-only";
    case "security":
      return null; // Plan must set explicitly.
    case "researcher":
    case "architect":
    case "marketing":
    case "sales":
    case "seo":
      return "none";
    default:
      // Unknown owner — fall back to "none" rather than crashing. Plan
      // composers can override; this default is conservative.
      return "none";
  }
}

/**
 * Parse + validate a `loops_applicable` value against the 5-value enum.
 * Pure, no side effects. Used by `validatePlanLane` below.
 */
export function parseLoopsApplicable(raw: string): ValidationResult {
  if ((LOOPS_APPLICABLE_VALUES as readonly string[]).includes(raw)) {
    return { ok: true, resolved: raw as LoopsApplicable };
  }
  return { ok: false, error: LOOPS_APPLICABLE_INVALID_ERROR };
}

/**
 * Run the full plan-validate decision tree for a single lane block.
 *
 * Returns `{ok: true, resolved}` on accept; `{ok: false, error}` with
 * the architect's exact stderr message on reject.
 *
 * The 4-case security tree is implemented inline:
 *   1. security + no loops_applicable → reject (must set explicitly).
 *   2. security + none + T6 marker → ACCEPT.
 *   3. security + none + no marker → reject (without T6 marker).
 *   4. security + l3-only/l4-only/both/full → ACCEPT (normal path).
 *
 * Non-security lanes:
 *   - omitted loops_applicable → fall through to defaultLoopsApplicable().
 *   - present loops_applicable → validate against the 5-value enum.
 *
 * Plan-validate exit code on reject is 2 (caller's responsibility; this
 * function only returns the error text).
 */
export function validatePlanLane(lane: PlanLaneBlock): ValidationResult {
  const isSecurity = lane.owner === "security";

  // CASE: security-owned lane omits loops_applicable.
  if (isSecurity && (lane.loops_applicable === undefined || lane.loops_applicable === "")) {
    return {
      ok: false,
      error: `security-owned lane ${lane.lane_id} must set loops_applicable explicitly`,
    };
  }

  // Non-security lane may omit; default applies.
  if (!isSecurity && (lane.loops_applicable === undefined || lane.loops_applicable === "")) {
    const def = defaultLoopsApplicable(lane.owner);
    // For non-security owners defaultLoopsApplicable always returns a value.
    // Defensive: if some future owner returns null without a stricter
    // policy here, treat absence as a hard error.
    if (def === null) {
      return {
        ok: false,
        error: `lane ${lane.lane_id}: owner '${lane.owner}' has no default loops_applicable; set it explicitly`,
      };
    }
    return { ok: true, resolved: def };
  }

  const raw = lane.loops_applicable as string;

  // First gate: must be one of the 5 valid values.
  const parsed = parseLoopsApplicable(raw);
  if (!parsed.ok) {
    return parsed;
  }
  const resolved = parsed.resolved;

  // CASES 2 + 3: security-owned lane with `none`.
  if (isSecurity && resolved === "none") {
    const comment = lane.loops_applicable_line_comment ?? "";
    if (comment.trim() === T6_CARVEOUT_MARKER) {
      return { ok: true, resolved: "none" };
    }
    return {
      ok: false,
      error: `security-owned lane ${lane.lane_id} sets loops_applicable=none without the T6 exemption marker`,
    };
  }

  // CASE 4 (security with l3-only/l4-only/both/full) and all non-security
  // valid values → ACCEPT.
  return { ok: true, resolved };
}
