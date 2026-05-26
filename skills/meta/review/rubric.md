# Two-stage review rubric — full criteria

Detail for `guild:review` Stages 1–2. Per `guild-plan.md §8` + §8.2; evidence rule §2.

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

## Loop-back nuance

- **Stage 1 failure** routes the lane back to `guild:execute-plan` (the only in-review loop-back) with a fix brief that names the failing check, points at the relevant receipt field (e.g. "`changed_files` missing `<path>` required by scope"), and reuses the same `run-id` so the re-dispatched lane writes a replacement receipt into the same `handoffs/` directory.
- **Stage 2 failure** usually becomes a `followups:` entry for the next task rather than a same-run loop-back — the deliverable is present; only its evidence is weak. It only escalates to a "re-run with evidence" loop-back when the evidence gap is severe enough that `guild:verify-done` cannot stand up the deliverable at all — and even then the loop-back is framed as "re-run with evidence", not "re-do the work".
