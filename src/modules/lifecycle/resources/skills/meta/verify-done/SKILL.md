---
name: guild-verify-done
description: Final gate before task close, and the home of Guild's verify-the-claim discipline — no completion language before an independent VCS diff confirms the change exists on disk. Runs five checks: (1) tests the spec defined, (2) scope — every changed file traces to a lane's diff, (3) success-criteria match, (4) no open blocker `followups:`, (5) assumptions reviewed. Writes `.guild/runs/<run-id>/verify.md` (pass/fail + run summary); on pass hands off to `guild:reflect`. TRIGGER: "is this done", "final check", "verify the task is complete", "run the done-gate", "ready to hand off — confirm the diff", "tests pass, are we done". DO NOT TRIGGER for: reviewing individual handoffs (guild:review), or starting new work.
when_to_use: Seventh and final step of Guild lifecycle, after guild:review confirms all lanes passed. Also the per-claim precondition a lane self-applies before emitting a handoff receipt — confirm the change with an independent diff before any success language.
type: meta
---

# guild:verify-done

The final checkpoint before a Guild task is allowed to close. Runs after `guild:review` has produced `.guild/runs/<run-id>/review.md` with no outstanding Stage 1 or Stage 2 blockers. Enforces the planning contract's success-criteria rule: every criterion from the spec must be demonstrably met. It is a gate, not a re-implementation: it reads artifacts and says pass or fail, it does not re-do specialist work.

## Input

Three required inputs, all already on disk by the time this skill fires:

1. `.guild/runs/<run-id>/review.md` — the per-lane pass/fail table from `guild:review`. If any lane is ✗, verify-done should never have been called; abort and return control to review.
2. The spec's `success_criteria` — from the source spec at `.guild/spec/<slug>.md` (written by `guild:brainstorm`) or a user-provided spec path referenced by the plan frontmatter. `§8.1` requires these be verifiable; this skill is where they are verified.
3. `.guild/runs/<run-id>/assumptions.md` — the assumption log aggregated from per-lane receipts by `guild:execute-plan` (see its Receipt collection section). If specialists flagged no assumptions during the run, this file may be empty or absent — treat an empty/missing file as "no assumptions to review" and skip check #5's user-acknowledgement step. Only hard-fail the gate if the file exists with unresolved disputed entries.

Secondary inputs (re-read for the scope check): `.guild/runs/<run-id>/handoffs/*.md` for the full set of `changed_files` across lanes, and the approved plan for each lane's declared `scope`. When a receipt is consumed, the embedded ```` ```guild.handoff.v2 ```` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (see §"Handoff contract" of the communication format policy). Read the `changed_files` / `evidence` / `followups` fields from that one embedded envelope — a frontmatter-only receipt with no embedded v2 block is not a valid machine receipt. Also, when present, `.guild/runs/<run-id>/diff-understanding.json` (`guild.diff_understanding.v1` — bound by pointer to the implementation contract map, row 13; produced at P2 by `guild:plan`'s plan-impact step) for the brownfield blast-radius cross-check in check #2.

## Five checks

All five must pass. Stop at the first failure and record which check failed.

1. **Tests pass.** Run whatever command the spec defined as the acceptance test. `§8.1` makes success criteria a planning-contract precondition, so there is a command to run — if there isn't, that is itself a fail (the spec was approved without a verifiable criterion). Capture exit code and tail of output into the verify report.
2. **Scope boundary.** Union the `changed_files` across every lane's handoff receipt. For each file, confirm it falls inside the `scope` of the lane that produced it. Any file not traceable to a lane's `scope` is a boundary violation even if review missed it — verify-done is the last place to catch scope creep before merge. **Brownfield cross-check (P3 scope-check, when `diff-understanding.json` is present):** the spec's plug point P3 (from the codebase-understanding spec §"Where it sits") feeds this check. Treat its `untraced_files` (changed files no graph node explains) and any `changed_files` whose `affected_layers` exceed what the plan's lanes declared as scope-creep signals — a changed file that the plan-impact step flagged as untraced and that no lane `scope` covers fails this check, not just a soft warning. Do not re-derive the diff here; consume the P2 artifact.
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

## Verify the claim against an independent diff (absorbed)

This skill is the home of Guild's per-claim verification discipline: **no
completion or success language before an independent VCS diff confirms the
change exists on disk.** A completion claim is a hypothesis until the diff
proves it — a lane that writes "done — all changes applied" over an empty tree,
a partial edit, or changes in the wrong path poisons the receipt that
`guild:review` then trusts, and the gap surfaces a lane later, far from its
origin.

One principle, two scopes:

- **Per-claim precondition (every lane, before its receipt).** Before writing
  any of "done", "complete", "finished", "ready to hand off", or "tests pass",
  the specialist takes an independent diff and gates the claim on it — never
  trusting its own running narrative of what it changed:
  ```bash
  git status --porcelain            # every modified/added/untracked path
  git diff --stat HEAD              # scope of the change
  git diff HEAD -- <expected-paths> # the change is where the lane scoped it
  ```
  For every scoped file, confirm a diff hunk exists; for every diff hunk,
  confirm it traces to the lane scope (an out-of-scope edit is a finding, not a
  pass). Run the spec's defined checks and capture the **actual** exit status —
  never infer pass from "it should pass". Diff present + in-scope + checks green
  → the claim is evidence-backed, proceed to the receipt; otherwise do **not**
  claim completion — report the gap with the diff output as evidence and
  continue the work.

- **Final multi-lane gate (the five checks above).** They re-apply the same
  diff-is-the-evidence rule across the whole run: check 2 unions the
  `changed_files` across every receipt and re-confirms each traces to its
  lane's `scope`, and check 1 re-runs the spec's test rather than trusting a
  receipt's word.

The VCS diff — not the narrative — is the single source of truth for what
changed, at both scopes.

## Handoff

On pass, hand off to `guild:reflect` (lands in P5 — for P1 this is a forward reference and acceptable; if `guild:reflect` is not yet installed, stop here and return the verify.md path to the user). The handoff payload:

- `run_id` — the run directory name.
- `verify_path` — absolute path to `.guild/runs/<run-id>/verify.md`.
- `review_path` — carried forward from `guild:review`.
- `assumptions_path` — `.guild/runs/<run-id>/assumptions.md`, acknowledged.
- `followups` — the non-blocking follow-up list from the run summary, for the next task's plan.

## Failure mode

On fail, annotate `verify.md` with the specific failing check and the evidence that failed it (test output, scope-creep file, unmet criterion, blocker `followup`, or disputed assumption). Do **not** auto-rollback, do **not** re-dispatch specialists, do **not** amend receipts. Return control to the user with the path to `verify.md` and a one-line summary of what failed. The user decides whether to loop back to `guild:execute-plan` (for check-1/3/4 failures), to `guild:plan` (for check-2 scope violations that imply the plan was wrong), or to live with an assumption dispute (check 5). Verify-done is a gate; gates report, they do not self-heal.
