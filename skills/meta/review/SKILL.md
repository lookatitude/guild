---
name: guild-review
description: Two-stage review of per-specialist handoff receipts (spec compliance first, then quality), plus Guild's fresh-context code-review request/response discipline — how a lane solicits a reviewer with crafted context, and how it acts on the findings (triage; push back only with technical evidence). Consumes compact receipts from `.guild/runs/<run-id>/handoffs/` — NOT full specialist conversations — and writes `.guild/runs/<run-id>/review.md` with per-lane pass/fail + blocker list. TRIGGER: "review the specialist outputs", "check if this matches the spec", "evaluate the handoffs", "request a code review", "respond to the review findings", "the reviewer found X". DO NOT TRIGGER for: final task-close gating (guild:verify-done), writing more code, or re-planning.
when_to_use: Sixth step of Guild lifecycle, after guild:execute-plan has collected all handoff receipts. Also during build when a lane requests a fresh-context code review or responds to a reviewer's findings.
type: meta
---

# guild:review

Implements `guild-plan.md §8` (review step). Runs after `guild:execute-plan` collects one handoff receipt per lane under `.guild/runs/<run-id>/handoffs/` and before `guild:verify-done`. Performs a **two-stage review — spec compliance first, then quality** — against the §8.2 receipts (fields `changed_files`, `opens_for`, `assumptions`, `evidence`, `followups`), read verbatim.

Do not rehydrate full specialist conversations. The §8.2 receipt contract exists so review is compact and auditable; pulling the transcript back in defeats the design and inflates token cost.

When a receipt is consumed, the embedded ```` ```guild.handoff.v2 ```` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (`docs/knowledge/decisions/communication-format-policy.md §"Handoff contract"`). Read the §8.2 fields below (`changed_files`, `opens_for`, `assumptions`, `evidence`, `followups`) from that one embedded envelope — a frontmatter-only receipt with no embedded v2 block is not a valid machine receipt.

## Input

Three required inputs, all produced upstream:

1. `.guild/runs/<run-id>/handoffs/*.md` — one receipt per lane (`<specialist>-<task-id>.md`), each carrying the §8.2 fields.
2. The spec — `.guild/spec/<slug>.md` (from `guild:brainstorm`, §7.1) or a user-provided spec path recorded in the plan frontmatter. Stage 1 compares against this.
3. The plan — `.guild/plan/<slug>.md` with `approved: true`. Fixes each lane's `scope`, `owner`, `depends-on`, autonomy policy; Stage 1 uses `scope` as the contract a lane's `changed_files` must satisfy.

If any receipt is missing, malformed, or unreadable, halt and loop back to `guild:execute-plan` — review cannot synthesize a receipt that was never written.

## Stage 1 — spec compliance

Per lane, three strict yes/no checks against the §8.2 fields (full criteria in `rubric.md`):

1. **Do `changed_files` satisfy `scope`?** Every file the lane owed must appear; out-of-scope files are a scope-creep flag (auto-fail only if the autonomy policy forbids out-of-scope edits).
2. **Are `assumptions` within the autonomy policy?** An assumption exceeding the lane's tier is a fail.
3. **Are any `followups` blocking merge?** A `followup` naming an unresolved spec requirement fails; merely-deferred work does not.

Output per lane: ✓ pass or ✗ fail with the failing check named. A ✗ means the lane didn't deliver the spec — no quality review fixes that. Record Stage 1 before touching Stage 2.

## Stage 2 — quality

Only lanes that passed Stage 1 (full criteria in `rubric.md`):

1. **Does `evidence` demonstrate the claim?** Per `guild-plan.md §2` (evidence rule) + §8.2 the field must be concrete — a test command + outcome, sample output, grep count, validator pass. "Looks good" / "should work" / a bare tool name with no output fail.
2. **Any concerns the lane raised?** Flag risks surfaced under `assumptions`/`followups` even if Stage 1 passed — they inform `guild:verify-done` and the next plan.

Output per lane: ✓ pass, ✗ fail, or → follow-up.

## Code-review request & response

Beyond receipt-level review, this skill owns Guild's **fresh-context code-review loop** — soliciting a review with precisely crafted context (never your session history) and acting on the findings (triage; push back **only** with technical evidence). The adversarial loop layers (`guild:loop-implement` L3/L4) and the cross-model gate (`guild:codex-review`) invoke this discipline; a specialist lane uses it directly before its handoff receipt is trusted into the two-stage review above. Full request procedure, finding-triage table, and response discipline: see `code-review-loop.md` (which fills the prompt template in `code-reviewer.md`).

## Output

Write a single report to `.guild/runs/<run-id>/review.md`:

- **Per-lane status** — one row per plan lane: `specialist`, `task-id`, Stage 1 result, Stage 2 result, and the failing check (if any). A lane skipped by Stage 2 (because Stage 1 failed) is recorded as such.
- **Aggregated blockers** — every Stage 1 ✗ and Stage 2 ✗ in one list, each with its receipt path and failing check. This is what downstream steps act on.
- **Follow-ups** — every Stage 2 → follow-up, each with the lane and risk text; non-blocking, feeds the next task's plan.

Keep `review.md` terse and grep-friendly — it's the compact artifact `guild:verify-done` and the next-task planner read.

## Loop-back

- **Stage 1 failure:** route the lane back to `guild:execute-plan` with a fix brief naming the failing check and the receipt field (e.g. "`changed_files` missing `<path>` required by scope"), carrying the same `run-id` so the re-dispatched lane writes a replacement receipt into the same `handoffs/`. Stage 1 failures are the only in-review loop-back.
- **Stage 2 failure:** usually a `followups:` entry for the next task — the deliverable is present, only its evidence is weak. It escalates to a "re-run with evidence" loop-back only when the gap is severe enough that `guild:verify-done` can't stand up the deliverable at all. (Loop-back nuance detailed in `rubric.md`.)

## Handoff

When every lane is ✓ at both stages (or Stage 2 follow-ups are acceptable and no ✗ blockers remain), hand off to `guild:verify-done` with:

- `run_id` — the run directory name.
- `review_path` — absolute path to `.guild/runs/<run-id>/review.md`.
- `handoffs_dir` — absolute path to `.guild/runs/<run-id>/handoffs/` (verify-done re-reads receipts for final checks).
- `plan_path` — the approved plan.
- `blockers` — empty on all-pass; otherwise the loop-back fired instead of this handoff.
- `followups` — the Stage 2 follow-up list, carried forward for the next task's plan.

If any lane is still ✗ after a loop-back round, halt and surface the failure to the user. Do not hand off with outstanding blockers — verify-done is the final gate, not a second chance for unresolved spec drift.
