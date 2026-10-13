/**
 * learning-checkpoint-5.ts — the 5-way LearningCheckpoint (KTD57 / R56 / R69).
 *
 * A DOMAIN FUNCTION, not a skill and not in the host glob. It runs at the review
 * boundary each phase already has, reads the artifacts that phase already wrote,
 * and returns one verdict from a closed five:
 *
 *   none | decision | playbook_span | skill_def | reflect
 *
 * Two properties make this safe to run automatically on every phase boundary, and
 * both are structural rather than promised:
 *
 *   1. It CLASSIFIES. It never writes the wiki — that is harvest's job and
 *      harvest's alone (R56, one promotion law). This module imports no writer and
 *      names no wiki path, which is what `checkpoint-never-writes-wiki` greps for.
 *      A verdict is a proposal; `decision` ENQUEUES harvest, it does not perform it.
 *   2. It FAILS SAFE to `none` (R69). Every target stays `none` unless its
 *      signature actually fired this phase, and malformed input produces `none`
 *      rather than an exception, because a checkpoint that throws would take down
 *      the phase boundary it rides on.
 *
 * The former twelve-target enum is not lost: `reflect` is the catch-all that routes
 * everything the four specific targets do not cover into the existing human-gated
 * `.guild/reflections/<run-id>.md` queue.
 */

/** The closed verdict set. Ordered by promotion strength, strongest first. */
export const CHECKPOINT_VERDICTS = Object.freeze([
  "decision",
  "playbook_span",
  "skill_def",
  "reflect",
  "none",
] as const);
export type CheckpointVerdict = (typeof CHECKPOINT_VERDICTS)[number];

export const CHECKPOINT_SCHEMA = "guild.learning_checkpoint.v1" as const;

/** What each verdict routes to. Used by T11's checkpoint → evolve mapping. */
export const VERDICT_ROUTE: Readonly<Record<CheckpointVerdict, string>> = Object.freeze({
  decision: "harvest",
  playbook_span: "curator",
  skill_def: "curator",
  reflect: "human-queue",
  none: "no-op",
});

export interface CheckpointSignals {
  /** A methodology the run has now used more than once (KTD33). */
  methodology_repeat?: boolean;
  /** The operator redirected the same agent on the same topic ≥3 times this run. */
  redirect_threshold_hit?: boolean;
  /** This phase shipped a new user-visible feature. */
  new_feature?: boolean;
  /** A project playbook span is demonstrably wrong or stale. */
  playbook_span_stale?: boolean;
  /** A project skill definition is demonstrably wrong or missing a case. */
  skill_definition_gap?: boolean;
  /** Anything else worth a human look: gaps, friction, unaddressed followups. */
  followups_open?: boolean;
}

export interface CheckpointInput {
  run_id: string;
  phase: string;
  signals?: CheckpointSignals;
}

export interface CheckpointResult {
  schema_version: typeof CHECKPOINT_SCHEMA;
  run_id: string;
  phase: string;
  verdict: CheckpointVerdict;
  /** Where a non-`none` verdict is routed. `no-op` for `none`. */
  route: string;
  /** The signature that fired, for the reflection entry. Empty on `none`. */
  because: string;
  /** True when harvest should be enqueued. NEVER means "harvest already ran". */
  enqueue_harvest: boolean;
}

function noVerdict(run_id: string, phase: string): CheckpointResult {
  return {
    schema_version: CHECKPOINT_SCHEMA,
    run_id,
    phase,
    verdict: "none",
    route: VERDICT_ROUTE.none,
    because: "",
    enqueue_harvest: false,
  };
}

/**
 * Classify one phase boundary. Pure, total, and never throws.
 *
 * Precedence is strongest-first and deliberately NOT additive: a phase that both
 * repeated a methodology and left followups open is a `decision`, because the
 * decision is the thing that supersedes the followup. Emitting two verdicts would
 * put the same phase in two queues and let a human close one while the other
 * quietly re-opens it.
 */
export function learningCheckpoint(input: CheckpointInput): CheckpointResult {
  const run_id = typeof input?.run_id === "string" ? input.run_id : "";
  const phase = typeof input?.phase === "string" ? input.phase : "";
  const s = input?.signals;
  if (!s || typeof s !== "object") return noVerdict(run_id, phase);

  const verdictFor = (): { verdict: CheckpointVerdict; because: string } | null => {
    if (s.redirect_threshold_hit === true) {
      return { verdict: "decision", because: "operator redirected the same agent/topic ≥3 times this run" };
    }
    if (s.methodology_repeat === true) {
      return { verdict: "decision", because: "a methodology repeated within this run" };
    }
    if (s.new_feature === true) {
      return { verdict: "decision", because: "this phase shipped a new user-visible feature" };
    }
    if (s.playbook_span_stale === true) {
      return { verdict: "playbook_span", because: "a project playbook span is stale" };
    }
    if (s.skill_definition_gap === true) {
      return { verdict: "skill_def", because: "a project skill definition has a gap" };
    }
    if (s.followups_open === true) {
      return { verdict: "reflect", because: "open followups from this phase" };
    }
    return null;
  };

  const hit = verdictFor();
  if (!hit) return noVerdict(run_id, phase);

  return {
    schema_version: CHECKPOINT_SCHEMA,
    run_id,
    phase,
    verdict: hit.verdict,
    route: VERDICT_ROUTE[hit.verdict],
    because: hit.because,
    enqueue_harvest: hit.verdict === "decision",
  };
}
