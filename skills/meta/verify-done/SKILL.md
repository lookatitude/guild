---
name: guild-verify-done
description: Final gate before task close. Runs (1) tests the spec defined, (2) scope check — every changed file traces to a lane, (3) success-criteria match, (4) no open blocker `followups:`, (5) assumptions reviewed. Writes `.guild/runs/<run-id>/verify.md` — pass/fail + run summary. On pass, hands off to `guild:reflect` (lands P5). TRIGGER:  "is this done", "final check", "verify the task is complete", "run the done-gate". DO NOT TRIGGER for: verifying a single PR outside Guild flow (use superpowers:verification-before-completion), reviewing individual handoffs (guild:review), starting new work.
when_to_use: Seventh and final step of /guild lifecycle, after guild:review confirms all lanes passed.
type: meta
---

# guild:verify-done

Implements `guild-plan.md §8` (verify step) and the planning contract's success-criteria rule in `§8.1`. Runs after `guild:review` has produced `.guild/runs/<run-id>/review.md` with no outstanding Stage 1 or Stage 2 blockers, and is the final checkpoint before a Guild task is allowed to close. It is a gate, not a re-implementation: it reads artifacts and says pass or fail, it does not re-do specialist work.

## Input

Three required inputs, all already on disk by the time this skill fires:

1. `.guild/runs/<run-id>/review.md` — the per-lane pass/fail table from `guild:review`. If any lane is ✗, verify-done should never have been called; abort and return control to review.
2. The spec's `success_criteria` — from the source spec (`.guild/brainstorm/<slug>.md` or user-provided spec) referenced by the plan frontmatter. `§8.1` requires these be verifiable; this skill is where they are verified.
3. `.guild/runs/<run-id>/assumptions.md` — the assumption log accumulated across the run per `§8.1`. Every low-significance decision specialists made without asking lands here and must be surfaced to the user before close.

Secondary inputs (re-read for the scope check): `.guild/runs/<run-id>/handoffs/*.md` for the full set of `changed_files` across lanes, and the approved plan for each lane's declared `scope`.

## Five checks

All five must pass. Stop at the first failure and record which check failed.

1. **Tests pass.** Run whatever command the spec defined as the acceptance test. `§8.1` makes success criteria a planning-contract precondition, so there is a command to run — if there isn't, that is itself a fail (the spec was approved without a verifiable criterion). Capture exit code and tail of output into the verify report.
2. **Scope boundary.** Union the `changed_files` across every lane's handoff receipt. For each file, confirm it falls inside the `scope` of the lane that produced it. Any file not traceable to a lane's `scope` is a boundary violation even if review missed it — verify-done is the last place to catch scope creep before merge.
3. **Success criteria match.** Walk the spec's `success_criteria` list item by item and tick each off against the receipts' `evidence:` fields and the test output from check 1. A criterion with no corroborating evidence fails here even if tests pass, because `§8.1` makes criteria the contract, not the test suite.
4. **No open blocker `followups:`.** Scan the union of `followups:` across receipts and `review.md`. A `followup` tagged or phrased as blocking (e.g., "must fix before merge", "blocks release") fails this check. Deferred/nice-to-have follow-ups are allowed through and carried into the run summary.
5. **Assumptions reviewed.** Surface `.guild/runs/<run-id>/assumptions.md` to the user. The user either acknowledges the log (pass) or disputes a specific assumption (fail — that assumption becomes a blocker to resolve before re-running verify-done). Per `§8.1`, review at the end is the whole point of the assumption log; do not skip it just because review.md was clean.

## Output

Write a single artifact:

```
.guild/runs/<run-id>/verify.md
```

It contains, in order:

- **Overall status** — `pass` or `fail`.
- **Per-check result** — the five checks above, each with ✓/✗ and the evidence line (test command + exit code, scope-creep file list if any, criterion-to-evidence mapping, blocker-followup list, assumption-review outcome).
- **Run summary** — what shipped (changed files grouped by lane), which assumptions were acknowledged, open non-blocking follow-ups to carry forward into the next task's plan.

Keep it terse and grep-friendly; downstream (`guild:reflect`) reads this file, not the specialist transcripts.

## Distinction from superpowers:verification-before-completion

`superpowers:verification-before-completion` is a single-PR / single-change discipline: before you claim a piece of work is done, run the verification command and show the output. It knows nothing about lanes, receipts, or assumption logs. `guild:verify-done` is the Guild-task analogue: it verifies a whole multi-lane run — several specialists' receipts, a spec's `success_criteria`, a scope union across lanes, and an assumption log accumulated over the run. Use the superpowers skill inside any single change; use this skill at the end of a full `/guild` lifecycle. Picking the wrong one either under-verifies (superpowers on a Guild run skips scope/assumption review) or over-verifies (this skill on a one-file PR demands artifacts that do not exist). This skill forks rather than references because it consumes Guild-specific artifacts that the superpowers skill has no concept of.

## Handoff

On pass, hand off to `guild:reflect` (lands in P5 — for P1 this is a forward reference and acceptable; if `guild:reflect` is not yet installed, stop here and return the verify.md path to the user). The handoff payload:

- `run_id` — the run directory name.
- `verify_path` — absolute path to `.guild/runs/<run-id>/verify.md`.
- `review_path` — carried forward from `guild:review`.
- `assumptions_path` — `.guild/runs/<run-id>/assumptions.md`, acknowledged.
- `followups` — the non-blocking follow-up list from the run summary, for the next task's plan.

## Failure mode

On fail, annotate `verify.md` with the specific failing check and the evidence that failed it (test output, scope-creep file, unmet criterion, blocker `followup`, or disputed assumption). Do **not** auto-rollback, do **not** re-dispatch specialists, do **not** amend receipts. Return control to the user with the path to `verify.md` and a one-line summary of what failed. The user decides whether to loop back to `guild:execute-plan` (for check-1/3/4 failures), to `guild:plan` (for check-2 scope violations that imply the plan was wrong), or to live with an assumption dispute (check 5). Verify-done is a gate; gates report, they do not self-heal.
