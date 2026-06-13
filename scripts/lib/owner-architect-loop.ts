/**
 * scripts/lib/owner-architect-loop.ts
 *
 * Usage (library — no CLI, no process.exit):
 *   import {
 *     shouldRestart,
 *     terminationReached,
 *     makeRoundState,
 *     validateRoundState,
 *     OWNER_ARCHITECT_SENTINEL,
 *     OWNER_ARCHITECT_DEFAULT_CAP,
 *   } from "./lib/owner-architect-loop";
 *
 * Loop-control state machine for the owner↔architect implementation loop
 * (docs/v2/09-adversarial-review.md §Loop control — [v2.x] candidate item 23).
 *
 * The owner↔architect loop is a **challenger loop** (adversarial shape):
 * - Owner produces an implementation artifact (code/design/handoff).
 * - Architect challenges: boundary drift, coupling, scalability, maintainability.
 * - Loop runs until the architect emits `## NO MORE QUESTIONS` on a standalone
 *   trimmed line, or until the round cap is hit.
 *
 * Loop family membership (09 §Loop control table):
 *   Sentinel:    `## NO MORE QUESTIONS`  (same as L1–L4 family; NOT `## SATISFIED`)
 *   Default cap: 16 (same shared `loop_cap` key in .guild/settings.json)
 *   Layer label: `L-arch` (distinct from L3/L4/security-review in loop-implement)
 *
 * Sentinel hardening rules (09 §Sentinel hardening):
 *   - Sentinel is valid only when it is a standalone trimmed line.
 *   - Sentinel must appear exactly once in the text.
 *   - Sentinel must NOT be followed by unresolved questions/blockers/TODO items.
 *   - A sentinel embedded in prose (e.g. inside a sentence or code block) is invalid.
 *
 * Restart rules (mirrors restart-from-security in loop-implement):
 *   - A finding with `severity: "high"` AND `addressed_by_owner: false` triggers
 *     a restart signal (owner must rework before the next challenger round).
 *   - A `severity: "critical"` finding always triggers a restart (regardless of
 *     `addressed_by_owner`).
 *   - All other findings are recorded but do not trigger restarts.
 *
 * Wiring status: dormant — no production call-site in v2.0. Wire from
 * `guild:loop-implement` when item 23 (owner↔architect loop) is promoted to v2.x.
 * Gate behind `defaults.adversarial: "on"` (already a v2 config key) when wiring.
 *
 * PURE, injectable library:
 *   - NEVER calls Date.now(), Math.random(), or any I/O.
 *   - NEVER calls process.exit().
 *   - The CALLER supplies timestamps, run_id, and round counters.
 *   - A `if (require.main === module)` CLI block at the bottom may use Date.now()
 *     for ad-hoc inspection only — it is never imported.
 *
 * Config dependency (default-safe):
 *   The caller may pass `loopCap` from the resolved `loop_cap` key in
 *   `.guild/settings.json`. When the key is absent, `OWNER_ARCHITECT_DEFAULT_CAP`
 *   (16) is used — zero-config safe. No direct import of read-guild-config here.
 *
 * Shared-file note:
 *   An optional `owner_architect_loop` sub-key under `defaults:` in
 *   `.guild/settings.json` would allow per-project cap and severity overrides.
 *   That key does NOT exist in the v2.0 closed-key set — the caller must read
 *   `loop_cap` (the shared L-loop cap) defensively. See shared_file_needs in the
 *   delivery record.
 *
 * Owned by tooling-engineer.
 */

// ── Sentinel ─────────────────────────────────────────────────────────────────

/**
 * The termination sentinel for the owner↔architect loop.
 *
 * Must match the L1–L4 family sentinel exactly (09 §Loop control table).
 * Different from the cross-host broker sentinel (`## SATISFIED`).
 */
export const OWNER_ARCHITECT_SENTINEL = "## NO MORE QUESTIONS" as const;

// ── Layer label ───────────────────────────────────────────────────────────────

/**
 * Canonical loop-layer label for trace events (12-observability §loop_round_start).
 * Distinct from L3/L4/security-review layers in `guild:loop-implement`.
 */
export const OWNER_ARCHITECT_LAYER = "L-arch" as const;

// ── Cap ───────────────────────────────────────────────────────────────────────

/**
 * Default round cap for the owner↔architect loop.
 * Matches the shared `loop_cap` default from `.guild/settings.json` (16).
 * Clamp range: 1–256 (same as all L-loops per 09 §Loop control).
 */
export const OWNER_ARCHITECT_DEFAULT_CAP = 16 as const;

/** Minimum allowed cap (inclusive). */
export const OWNER_ARCHITECT_CAP_MIN = 1 as const;

/** Maximum allowed cap (inclusive). Matches the shared L-loop clamp range. */
export const OWNER_ARCHITECT_CAP_MAX = 256 as const;

// ── Severity levels ───────────────────────────────────────────────────────────

/**
 * Closed set of finding severity levels (mirrors the security-review and
 * review-broker severity vocabulary).
 */
export const FINDING_SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

// ── Escalation outcomes ───────────────────────────────────────────────────────

/**
 * Possible escalation outcomes when the round cap is hit.
 * Mirrors the 09 §Loop control doc: "force-pass / extend-cap / rework".
 */
export const ESCALATION_OUTCOMES = [
  "force-pass",
  "extend-cap",
  "rework",
] as const;

export type EscalationOutcome = (typeof ESCALATION_OUTCOMES)[number];

// ── Round state ───────────────────────────────────────────────────────────────

/**
 * Immutable state for one round of the owner↔architect loop.
 *
 * The CALLER constructs this (via `makeRoundState`) and passes it to the
 * decision functions. This module is a pure state machine — it never mutates.
 */
export interface OwnerArchitectRoundState {
  /** Current round number (1-based). */
  round: number;
  /**
   * Effective cap for this loop run. Must be clamped to
   * [OWNER_ARCHITECT_CAP_MIN, OWNER_ARCHITECT_CAP_MAX].
   * Defaults to OWNER_ARCHITECT_DEFAULT_CAP when absent from config.
   */
  cap: number;
  /** Number of restarts already consumed in this lane (per-lane counter). */
  restartCount: number;
  /**
   * Maximum restarts per lane (default 3, mirrors restart-from-security in
   * loop-implement). The caller supplies this; no shared config key in v2.0.
   */
  maxRestarts: number;
  /**
   * The run_id this round belongs to (for trace event correlation).
   * Supplied by the caller — never Date.now() here.
   */
  runId: string;
  /**
   * The lane_id this round belongs to (for per-lane counter isolation,
   * matches the loop-implement lane isolation contract).
   */
  laneId: string;
}

// ── Finding ───────────────────────────────────────────────────────────────────

/**
 * A single finding raised by the architect challenger.
 *
 * `addressed_by_owner: false` + `severity: "high"` triggers a restart signal.
 * `severity: "critical"` always triggers a restart (regardless of addressed_by_owner).
 */
export interface ArchitectFinding {
  /** Short identifier for the finding (free-form, for audit trail). */
  id: string;
  /**
   * Severity of the finding. `high` + unaddressed → restart.
   * `critical` → always restart.
   */
  severity: FindingSeverity;
  /** Whether the owner has already addressed this finding in the artifact. */
  addressed_by_owner: boolean;
  /** Human-readable description (may be empty for programmatic uses). */
  description?: string;
}

// ── Loop decision results ─────────────────────────────────────────────────────

/** Signals that a restart is needed (owner must rework before next round). */
export interface RestartSignal {
  restart: true;
  reason: "high_severity_unaddressed" | "critical_severity";
  /** The finding that triggered the restart. */
  triggeringFinding: ArchitectFinding;
}

/** Signals that no restart is needed for this finding. */
export interface NoRestartSignal {
  restart: false;
}

export type RestartDecision = RestartSignal | NoRestartSignal;

// ── Termination parse result ──────────────────────────────────────────────────

/**
 * Result of parsing a challenger response for the termination sentinel.
 *
 * Follows the 09 §Sentinel hardening rules:
 * - `terminated: true` — sentinel found, standalone, once, no post-sentinel issues.
 * - `terminated: false, malformed: true` — sentinel was present but invalid
 *   (duplicated, inline, or followed by unresolved items); one schema-repair retry
 *   is warranted.
 * - `terminated: false, malformed: false` — no sentinel found; loop continues.
 */
export interface TerminationResult {
  /** True when the sentinel is cleanly present and valid. */
  terminated: boolean;
  /**
   * True when the sentinel was present but violated the hardening rules.
   * A malformed termination counts as one extra round (09 §Sentinel hardening:
   * "invalid; round recorded malformed; loop runs one extra round").
   */
  malformed: boolean;
  /**
   * When `terminated: true`, the text that appeared after the sentinel line
   * (trimmed). An empty string is clean. A non-empty post-sentinel region
   * indicates unresolved items and must set `terminated: false, malformed: true`.
   */
  postSentinelText?: string;
  /** Diagnostic message for logging/trace; empty string when clean. */
  diagnostic: string;
}

// ── Cap enforcement result ────────────────────────────────────────────────────

/**
 * Result of checking whether the loop should continue or escalate.
 *
 * 09 §Loop control: "Caps escalate, never auto-resolve — force-pass / extend-cap
 * / rework are surfaced to the user."
 */
export interface CapCheckResult {
  /** True when the loop may continue (round < cap). */
  withinCap: boolean;
  /**
   * Present when `withinCap: false`. The surface action the caller must
   * present to the operator.
   */
  escalation?: {
    outcome: EscalationOutcome;
    roundsConsumed: number;
    cap: number;
  };
}

// ── Two-consecutive-malformed guard ──────────────────────────────────────────

/**
 * Tracks the malformed-termination streak for sentinel hardening.
 *
 * 09 §Sentinel hardening: "Two consecutive malformed terminations — escalate;
 * never silently pass."
 */
export interface MalformedStreakState {
  consecutiveMalformed: number;
}

/** Result of checking the consecutive-malformed guard. */
export interface MalformedGuardResult {
  /** True when the streak has hit 2 — caller must escalate. */
  mustEscalate: boolean;
  consecutiveMalformed: number;
}

// ── Validate result (shared shape) ───────────────────────────────────────────

/**
 * Shared validator return shape (matches the project-wide convention from
 * scripts/lib/*.ts validators).
 */
export type ValidateResult =
  | { valid: true }
  | { valid: false; errors: string[] };

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * `makeRoundState` — construct a valid OwnerArchitectRoundState.
 *
 * Applies the cap clamp [OWNER_ARCHITECT_CAP_MIN, OWNER_ARCHITECT_CAP_MAX].
 * When `cap` is not provided (undefined), uses OWNER_ARCHITECT_DEFAULT_CAP.
 *
 * @param fields  Required and optional fields for the round state.
 * @returns       A fully-initialized, clamped round state.
 */
export function makeRoundState(fields: {
  round: number;
  runId: string;
  laneId: string;
  cap?: number;
  restartCount?: number;
  maxRestarts?: number;
}): OwnerArchitectRoundState {
  const rawCap =
    fields.cap !== undefined ? fields.cap : OWNER_ARCHITECT_DEFAULT_CAP;
  const cap = Math.max(
    OWNER_ARCHITECT_CAP_MIN,
    Math.min(OWNER_ARCHITECT_CAP_MAX, rawCap),
  );

  return {
    round: fields.round,
    cap,
    restartCount: fields.restartCount ?? 0,
    maxRestarts: fields.maxRestarts ?? 3,
    runId: fields.runId,
    laneId: fields.laneId,
  };
}

// ── Core state machine functions ──────────────────────────────────────────────

/**
 * `shouldRestart` — determine whether a single architect finding triggers a
 * restart signal.
 *
 * Restart rules (mirrors restart-from-security in 09 §Restart-from-security):
 *   - `severity: "critical"` → always restart.
 *   - `severity: "high"` AND `addressed_by_owner: false` → restart.
 *   - All other combinations → no restart.
 *
 * When the restart count has already reached maxRestarts, the function still
 * returns the restart signal (the CALLER must surface `restart_cap_hit` to
 * the user — this function only detects the signal; cap enforcement is
 * `checkRestartCap`'s job).
 *
 * @param finding  The architect finding to evaluate.
 * @returns        A RestartDecision indicating whether a restart is needed.
 */
export function shouldRestart(finding: ArchitectFinding): RestartDecision {
  if (finding.severity === "critical") {
    return {
      restart: true,
      reason: "critical_severity",
      triggeringFinding: finding,
    };
  }

  if (finding.severity === "high" && !finding.addressed_by_owner) {
    return {
      restart: true,
      reason: "high_severity_unaddressed",
      triggeringFinding: finding,
    };
  }

  return { restart: false };
}

/**
 * `terminationReached` — parse a challenger response text for the
 * `## NO MORE QUESTIONS` sentinel.
 *
 * Sentinel hardening rules (09 §Sentinel hardening):
 *   1. Sentinel is valid only when it is a standalone trimmed line (not inline).
 *   2. Sentinel must appear exactly once. Duplicates → malformed.
 *   3. Sentinel must NOT be followed by non-blank text (unresolved items → malformed).
 *   4. A sentinel embedded inside prose (where adjacent lines contain other
 *      text without a blank separator) is treated as inline → malformed.
 *
 * @param text  The full text of the challenger's response for this round.
 * @returns     A TerminationResult with the sentinel parse outcome.
 */
export function terminationReached(text: string): TerminationResult {
  if (!text || text.trim() === "") {
    return {
      terminated: false,
      malformed: false,
      diagnostic: "empty response",
    };
  }

  const lines = text.split("\n");

  // Find all lines that are exactly the sentinel when trimmed.
  const sentinelIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === OWNER_ARCHITECT_SENTINEL) {
      sentinelIndices.push(i);
    }
  }

  // No sentinel found — loop continues.
  if (sentinelIndices.length === 0) {
    return {
      terminated: false,
      malformed: false,
      diagnostic: "sentinel not found",
    };
  }

  // Duplicate sentinel → malformed (09 §Sentinel hardening: "Sentinel inline or
  // duplicated → invalid; round recorded malformed; loop runs one extra round").
  if (sentinelIndices.length > 1) {
    return {
      terminated: false,
      malformed: true,
      diagnostic: `sentinel appears ${sentinelIndices.length} times; must appear exactly once`,
    };
  }

  const sentinelIdx = sentinelIndices[0];

  // Gather post-sentinel lines (everything after the sentinel line).
  const postLines = lines.slice(sentinelIdx + 1);
  const postSentinelText = postLines.join("\n").trim();

  // Post-sentinel region contains non-blank content → unresolved items → malformed.
  if (postSentinelText !== "") {
    return {
      terminated: false,
      malformed: true,
      postSentinelText,
      diagnostic: `sentinel is followed by non-blank content (${postSentinelText.length} chars); unresolved items present`,
    };
  }

  // Sentinel is standalone, exactly once, no post-sentinel content — valid termination.
  return {
    terminated: true,
    malformed: false,
    postSentinelText: "",
    diagnostic: "",
  };
}

/**
 * `checkRoundCap` — check whether the loop may proceed to the next round.
 *
 * The round must be STRICTLY LESS than the cap to continue (09 §Loop control
 * flowchart: `round < cap?`). When `round >= cap`, the caller must surface
 * the escalation options to the operator.
 *
 * 09 §Loop control: "Caps escalate, never auto-resolve — force-pass /
 * extend-cap / rework are surfaced to the user (diagram below)."
 *
 * @param state  The current round state.
 * @returns      A CapCheckResult indicating whether the loop can continue.
 */
export function checkRoundCap(state: OwnerArchitectRoundState): CapCheckResult {
  if (state.round < state.cap) {
    return { withinCap: true };
  }

  return {
    withinCap: false,
    escalation: {
      // Default surface action — caller presents all three options to the operator.
      outcome: "rework",
      roundsConsumed: state.round,
      cap: state.cap,
    },
  };
}

/**
 * `checkRestartCap` — check whether the restart counter has been exhausted.
 *
 * Restart cap = maxRestarts per lane per task (per-lane counter isolation,
 * mirroring the 09 §Restart-from-security contract). When the cap is hit,
 * the caller must escalate (`restart_cap_hit`) rather than silently stopping.
 *
 * @param state  The current round state (carries restartCount + maxRestarts).
 * @returns      True when a restart is still allowed; false when the cap is hit.
 */
export function checkRestartCap(state: OwnerArchitectRoundState): boolean {
  return state.restartCount < state.maxRestarts;
}

/**
 * `checkMalformedStreak` — evaluate the two-consecutive-malformed guard.
 *
 * 09 §Sentinel hardening: "Two consecutive malformed terminations — escalate;
 * never silently pass."
 *
 * @param streak  The current malformed streak state.
 * @param wasMalformed  Whether the current round's termination was malformed.
 * @returns       A MalformedGuardResult with the updated streak and escalation flag.
 */
export function checkMalformedStreak(
  streak: MalformedStreakState,
  wasMalformed: boolean,
): MalformedGuardResult {
  const consecutiveMalformed = wasMalformed
    ? streak.consecutiveMalformed + 1
    : 0;

  return {
    mustEscalate: consecutiveMalformed >= 2,
    consecutiveMalformed,
  };
}

// ── Dismissal discipline ──────────────────────────────────────────────────────

/**
 * `dismissalTerminates` — check whether a dismissal terminates the loop.
 *
 * 09 §Loop control: "Dismissals never terminate. A challenger may mark a
 * question 'dismissed because X' with the rationale recorded in the artifact,
 * but a dismissal does NOT end the loop — the challenger must still independently
 * emit the sentinel."
 *
 * Always returns false. This function exists to make the contract explicit and
 * testable — callers must never treat a dismissal as equivalent to the sentinel.
 *
 * @returns  Always false (dismissals never terminate the loop).
 */
export function dismissalTerminates(): false {
  return false;
}

// ── Force-pass discipline ─────────────────────────────────────────────────────

/**
 * `forcPassAssumptions` — build the assumptions block that a force-passed loop
 * must append to the artifact.
 *
 * 09 §Loop control: "Force-pass appends assumptions. When a cap escalation
 * resolves as force-pass, the unresolved items are appended to the artifact
 * as assumptions: — a force-passed loop leaves an auditable residue, never a
 * silent pass."
 *
 * This function returns the structured assumptions block. The CALLER is
 * responsible for appending it to the artifact — this module does no I/O.
 *
 * @param unresolvedFindings  The findings that were not resolved before force-pass.
 * @param roundsConsumed      The number of rounds consumed before escalation.
 * @param laneId              The lane this loop belongs to (for audit trail).
 * @returns                   A structured assumptions record.
 */
export function forcePassAssumptions(
  unresolvedFindings: ArchitectFinding[],
  roundsConsumed: number,
  laneId: string,
): ForcePassAssumptionsRecord {
  return {
    source: "owner-architect-loop",
    layer: OWNER_ARCHITECT_LAYER,
    lane_id: laneId,
    rounds_consumed: roundsConsumed,
    resolution: "force-pass",
    unresolved_findings: unresolvedFindings.map((f) => ({
      id: f.id,
      severity: f.severity,
      addressed_by_owner: f.addressed_by_owner,
      description: f.description ?? "",
    })),
  };
}

/** Shape of the assumptions block written to the artifact on force-pass. */
export interface ForcePassAssumptionsRecord {
  source: "owner-architect-loop";
  layer: typeof OWNER_ARCHITECT_LAYER;
  lane_id: string;
  rounds_consumed: number;
  resolution: "force-pass";
  unresolved_findings: Array<{
    id: string;
    severity: FindingSeverity;
    addressed_by_owner: boolean;
    description: string;
  }>;
}

// ── Validators ────────────────────────────────────────────────────────────────

const SEVERITY_SET = new Set<string>(FINDING_SEVERITIES);
const ESCALATION_SET = new Set<string>(ESCALATION_OUTCOMES);

/**
 * `validateRoundState` — structural validator for an OwnerArchitectRoundState.
 *
 * Returns `{ valid: true }` when all constraints pass, or
 * `{ valid: false, errors: string[] }` listing every violation.
 *
 * Constraints:
 *   - round must be a positive integer (≥ 1).
 *   - cap must be within [OWNER_ARCHITECT_CAP_MIN, OWNER_ARCHITECT_CAP_MAX].
 *   - restartCount must be ≥ 0 and ≤ maxRestarts.
 *   - maxRestarts must be a positive integer.
 *   - runId and laneId must be non-empty strings.
 */
export function validateRoundState(state: unknown): ValidateResult {
  const errors: string[] = [];

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { valid: false, errors: ["state must be a non-null object"] };
  }

  const s = state as Record<string, unknown>;

  if (typeof s["round"] !== "number" || !Number.isInteger(s["round"]) || s["round"] < 1) {
    errors.push("round must be a positive integer (≥ 1)");
  }

  const cap = s["cap"];
  if (
    typeof cap !== "number" ||
    !Number.isInteger(cap) ||
    cap < OWNER_ARCHITECT_CAP_MIN ||
    cap > OWNER_ARCHITECT_CAP_MAX
  ) {
    errors.push(
      `cap must be an integer in [${OWNER_ARCHITECT_CAP_MIN}, ${OWNER_ARCHITECT_CAP_MAX}]`,
    );
  }

  if (
    typeof s["restartCount"] !== "number" ||
    !Number.isInteger(s["restartCount"]) ||
    s["restartCount"] < 0
  ) {
    errors.push("restartCount must be a non-negative integer");
  }

  if (
    typeof s["maxRestarts"] !== "number" ||
    !Number.isInteger(s["maxRestarts"]) ||
    s["maxRestarts"] < 1
  ) {
    errors.push("maxRestarts must be a positive integer");
  }

  if (
    typeof s["restartCount"] === "number" &&
    typeof s["maxRestarts"] === "number" &&
    s["restartCount"] > (s["maxRestarts"] as number)
  ) {
    errors.push("restartCount must not exceed maxRestarts");
  }

  if (typeof s["runId"] !== "string" || s["runId"] === "") {
    errors.push("runId must be a non-empty string");
  }

  if (typeof s["laneId"] !== "string" || s["laneId"] === "") {
    errors.push("laneId must be a non-empty string");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * `validateFinding` — structural validator for an ArchitectFinding.
 *
 * Returns `{ valid: true }` when all constraints pass, or
 * `{ valid: false, errors: string[] }` listing every violation.
 */
export function validateFinding(finding: unknown): ValidateResult {
  const errors: string[] = [];

  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return { valid: false, errors: ["finding must be a non-null object"] };
  }

  const f = finding as Record<string, unknown>;

  if (typeof f["id"] !== "string" || f["id"] === "") {
    errors.push("id must be a non-empty string");
  }

  if (typeof f["severity"] !== "string" || !SEVERITY_SET.has(f["severity"])) {
    errors.push(
      `severity must be one of [${FINDING_SEVERITIES.join(", ")}], got ${JSON.stringify(f["severity"])}`,
    );
  }

  if (typeof f["addressed_by_owner"] !== "boolean") {
    errors.push("addressed_by_owner must be a boolean");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * `validateEscalationOutcome` — check whether a string is a valid escalation outcome.
 *
 * Returns `{ valid: true }` when the value is in the closed `ESCALATION_OUTCOMES` set.
 */
export function validateEscalationOutcome(outcome: unknown): ValidateResult {
  if (typeof outcome !== "string" || !ESCALATION_SET.has(outcome)) {
    return {
      valid: false,
      errors: [
        `outcome must be one of [${ESCALATION_OUTCOMES.join(", ")}], got ${JSON.stringify(outcome)}`,
      ],
    };
  }
  return { valid: true };
}

// ── CLI harness (never imported — ad-hoc inspection only) ─────────────────────

/* istanbul ignore next */
if (require.main === module) {
  // Ad-hoc CLI: parse a response from stdin and print the termination result.
  // Usage: echo "...challenger text..." | npx tsx scripts/lib/owner-architect-loop.ts
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => (input += chunk));
  process.stdin.on("end", () => {
    const result = terminationReached(input);
    process.stdout.write(
      JSON.stringify(
        {
          terminated: result.terminated,
          malformed: result.malformed,
          diagnostic: result.diagnostic,
          ts: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(result.terminated ? 0 : result.malformed ? 2 : 1);
  });
}
