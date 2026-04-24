---
name: guild-review
description: Two-stage review of per-specialist handoff receipts (spec compliance first, then quality). Consumes compact receipts from `.guild/runs/<run-id>/handoffs/` — NOT full specialist conversations. Writes `.guild/runs/<run-id>/review.md` with per-lane pass/fail + blocker list. TRIGGER: "review the specialist outputs", "check if this matches the spec", "evaluate the handoffs". DO NOT TRIGGER for: reviewing a PR unrelated to Guild flow (use superpowers:code-reviewer), writing more code, re-planning, final verification (guild:verify-done).
when_to_use: Sixth step of /guild lifecycle, after guild:execute-plan has collected all handoff receipts.
type: meta
---

# guild:review

Implements `guild-plan.md §8` (review step). Runs after `guild:execute-plan` has collected one handoff receipt per lane under `.guild/runs/<run-id>/handoffs/` and before `guild:verify-done`. Performs a two-stage review — spec compliance first, then quality — against the receipts, not against raw specialist transcripts. The receipt shape is fixed by `guild-plan.md §8.2` (fields `changed_files`, `opens_for`, `assumptions`, `evidence`, `followups`, etc.), and this skill reads those fields verbatim.

Do not rehydrate full specialist conversations. The whole point of the §8.2 receipt contract is that review is compact and auditable; pulling the transcript back in defeats the design and inflates token cost.

## Input

Three required inputs, all produced by upstream skills:

1. `.guild/runs/<run-id>/handoffs/*.md` — one receipt per lane in the plan, written by each specialist during `guild:execute-plan`. Filename is `<specialist>-<task-id>.md`. Every receipt must contain the §8.2 fields (`changed_files`, `opens_for`, `assumptions`, `evidence`, `followups`).
2. The spec — the source artifact the plan was derived from (typically `.guild/brainstorm/<slug>.md` or a user-provided spec path recorded in the plan frontmatter). Stage 1 compares receipts against this.
3. The plan — `.guild/plan/<slug>.md` with `approved: true`. The plan fixes each lane's `scope`, `owner`, `depends-on`, and autonomy policy; Stage 1 uses `scope` as the contract a lane's `changed_files` must satisfy.

If any receipt is missing, malformed, or unreadable, halt and loop back to `guild:execute-plan` — review cannot synthesize a receipt that was never written.

## Stage 1 — spec compliance

Per lane, answer three strict yes/no questions against the receipt's §8.2 fields:

1. **Do `changed_files` satisfy `scope`?** Cross-reference the receipt's `changed_files` list against the lane's `scope` in the plan. Every file the lane was supposed to produce or modify must appear. Files outside the lane's `scope` are a scope-creep signal — flag them but do not auto-fail unless the plan's autonomy policy forbids out-of-scope edits.
2. **Are `assumptions` within the autonomy policy?** The plan records a per-lane autonomy tier (see `guild-plan.md §5`/§8). An assumption that exceeds the tier (e.g., a lane on "implement-only" tier inventing new API surface) is a Stage 1 failure. An assumption within tier is fine.
3. **Are any `followups` blocking merge?** Receipts may list `followups` that are merely deferred work; those are not blockers. But a `followup` that names an unresolved spec requirement is a Stage 1 failure — the lane did not finish what it was asked to do.

Output per lane: ✓ pass or ✗ fail, with the failing check named. A ✗ here means the lane did not deliver the spec; no amount of quality review fixes that. Record the Stage 1 result before touching Stage 2.

## Stage 2 — quality

Only lanes that passed Stage 1 are evaluated here. For each such lane:

1. **Does `evidence` actually demonstrate the claim?** Per `guild-plan.md §2` (evidence rule) and §8.2, the `evidence:` field must be concrete: a test command with outcome, a sample output, a grep count, a validator pass. "Looks good", "should work", "manually verified" without detail, or a bare tool name with no output — these fail Stage 2. The receipt's own artifact must back the specialist's claim.
2. **Any concerns the lane raised?** Receipts sometimes surface risks the specialist discovered but could not resolve (recorded under `assumptions` or `followups`). Flag those even if Stage 1 passed — they inform `guild:verify-done` and the next task's plan.

Output per lane: ✓ pass, ✗ fail, or → follow-up. A ✗ at Stage 2 means the claim is not supported by its evidence; that lane's work must be re-run with better evidence before merge. A → follow-up means the claim is supported but the lane flagged something worth tracking.

## Output

Write a single review report to:

```
.guild/runs/<run-id>/review.md
```

The report contains:

- **Per-lane status.** One row per lane from the plan: `specialist`, `task-id`, Stage 1 result, Stage 2 result, and the specific failing check (if any). A lane that was skipped by Stage 2 (because Stage 1 failed) is recorded as such.
- **Aggregated blockers.** Every Stage 1 ✗ and every Stage 2 ✗ collected into a single list, each with the receipt path it came from and the failing check. This list is what downstream steps act on.
- **Follow-ups.** Every Stage 2 → follow-up collected into a separate list, each with the lane and the risk text. These do not block merge but feed the next task's plan.

The `review.md` is the compact artifact `guild:verify-done` and the next-task planner read; keep it terse and grep-friendly.

## Loop-back

- **Stage 1 failure:** route the lane back to `guild:execute-plan` with a fix brief for the specific specialist. The fix brief names the failing check from Stage 1, points at the relevant receipt field (e.g., "`changed_files` missing `<path>` required by scope"), and carries the same `run-id` so the re-dispatched lane writes a replacement receipt into the same `handoffs/` directory. Stage 1 failures are the only case that loops back during review.
- **Stage 2 failure:** usually becomes a `followups:` entry for the next task rather than a same-run loop-back. The lane's deliverable is present; only its evidence is weak. Record the gap in `review.md`'s follow-ups list and let `guild:verify-done` decide whether it is mergeable. A Stage 2 ✗ only escalates to a loop-back when the evidence gap is severe enough that verify-done cannot stand up the deliverable at all — and in that case the loop-back is framed as "re-run with evidence" not "re-do the work".

## Handoff

When every lane is ✓ at both stages (or Stage 2 follow-ups are acceptable and no ✗ blockers remain), hand off to `guild:verify-done` with:

- `run_id` — the run directory name.
- `review_path` — absolute path to `.guild/runs/<run-id>/review.md`.
- `handoffs_dir` — absolute path to `.guild/runs/<run-id>/handoffs/` (verify-done re-reads receipts for final checks).
- `plan_path` — the approved plan.
- `blockers` — empty list on all-pass; otherwise the loop-back was triggered instead of this handoff.
- `followups` — the Stage 2 follow-up list, carried forward for the next task's plan.

If any lane is still ✗ after a loop-back round, halt and surface the failure to the user. Do not hand off to `guild:verify-done` with outstanding blockers — verify-done is the final gate, not a second chance for unresolved spec drift.
