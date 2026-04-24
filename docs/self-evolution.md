# Self-Evolution

Implements `guild-plan.md §11` (+ §12 for specialist creation).

Guild evolves skills and specialists through a single pipeline with two entry
triggers: automatic reflection accumulation, and explicit `/guild:evolve`. The
pipeline combines the skill-creator eval loop, AgentDevel-style flip-centered
promotion gating, and versioned rollback.

## Two triggers

**Automatic — reflection threshold.** Post-task `guild-reflect` (run by the
`Stop` hook via `hooks/maybe-reflect.ts` when the completion heuristic passes)
files proposed edits under `.guild/reflections/<skill>/`. When ≥ 3 proposed
edits accumulate for a single skill, the orchestrator queues it for evolve.

**Explicit — `/guild:evolve [skill] [--auto]`.** The user triggers evolution for
a specific skill on demand. `--auto` runs unattended through the gate. See
`commands/guild-evolve.md`.

**Extraction (specialist candidate).** A cluster of related skill edits
repeatedly co-activating, exceeding the token budget, or appearing as a missing
role in ≥ 3 team-compose runs queues a candidate specialist — not an immediate
add. Incubates under `agents/proposed/<role>.md` until the gates pass.

## Pipeline — 10 steps mapped to scripts and skills

Driven by `skills/meta/evolve-skill/SKILL.md`, with tooling under `scripts/`:

1. **Snapshot** current skill → `.guild/skill-versions/<skill>/v<n>/`.
   Handled by `scripts/evolve-loop.ts` (§11.2 step 1).
2. **Load eval cases** from `skills/<path>/evals/evals.json`. When none exist,
   bootstrap 2–3 cases from accumulated reflections.
3. **Spawn paired subagents in the same turn:** A = current skill, B = proposed
   edit. Net-new skill: A = no-skill baseline, B = proposed.
4. **Drafter writes assertions** in parallel while the runs execute.
5. **Grader evaluates** each assertion → `.guild/evolve/<run-id>/grading.json`.
6. **Benchmark + flip report** — `scripts/flip-report.ts` reads the grading file
   and computes `pass_rate`, `duration_ms`, `total_tokens`, mean ± stddev, delta;
   P→F regressions vs F→P fixes. Writes `flip-report.md`.
7. **Shadow mode** — `scripts/shadow-mode.ts` replays the proposed skill against
   historical traces under `.guild/runs/*/events.ndjson`, recording trigger
   accuracy, boundary collisions, token deltas. Diagnostic only, never blocks
   (always exits 0).
8. **Promotion gate** — see below.
9. **Description optimizer** — on promote, `scripts/description-optimizer.ts`
   derives a ≤ 1024-char description from the skill's `should_trigger` /
   `should_not_trigger` evals. Deterministic heuristic, not an LLM.
10. **Reject path** — archive the attempt under `.guild/evolve/<run-id>/archive/`
    for future iterations.

Cross-cutting test fixtures for this pipeline live under `tests/evolve/` and
`tests/shadow/`.

## Promotion gate (3 criteria)

Promote if **any** of:

- **0 regressions AND ≥ 1 fix.** The proposed edit strictly improves coverage.
- **No flip change AND tokens ↓ ≥ 10%.** No behavioral change, real efficiency
  win.
- **Regressions present AND user approves** via the review viewer.

On promote: `scripts/description-optimizer.ts` runs, the commit lands, version
is bumped. On reject: the attempt is archived and no live state changes.

## Versioning and rollback (§11.3)

Every skill edit is a versioned artifact under
`.guild/skill-versions/<skill>/v<n>/`. Nothing is destructive:

- `/guild:rollback <skill> [n]` walks back the stack. See
  `commands/guild-rollback.md`.
- `scripts/rollback-walker.ts` enumerates versions and, with `--steps <n>`,
  emits a `proposed_rollback` YAML action. **Never mutates skill-versions** — it
  is read-only and the actual rollback is performed by
  `skills/meta/rollback-skill/SKILL.md`.
- Rollbacks themselves snapshot as new versions. No operation destroys history.

## Shadow mode

Shadow mode (step 7) is the safety valve before promotion. `scripts/shadow-mode.ts`
runs the proposed skill against historical traces without changing live routing,
recording:

- trigger accuracy vs the live skill on the same prompt
- boundary collisions with adjacent specialists
- token deltas vs baseline
- output-quality divergence

Fixtures in `tests/shadow/` validate the harness. Shadow is diagnostic — it
never blocks the pipeline — but its `shadow-report.md` feeds the user's
decision on the promotion gate when regressions are flagged.

## Description optimizer

`scripts/description-optimizer.ts` is the last step before commit. Purpose:
prevent under-trigger bias and 1024-char overruns that Claude Code's skill
description field enforces.

- Inputs: the skill's `evals.json` `should_trigger` / `should_not_trigger` arrays.
- Output: a YAML document `description: <...>` to stdout (no file writes).
- Deterministic — no LLM call. Tests in `scripts/__tests__/` pin the output for
  a given input fixture.

## Specialist creation (§12) — same gate

`skills/meta/create-specialist/SKILL.md` handles the net-new-specialist path
referenced by team-compose's "auto-create" gap-handling option. The flow:

1. Interview the user for role, responsibilities, example outputs, dependencies.
2. Draft `agents/proposed/<new>.md` + 2–5 proposed T5 skills.
3. **Boundary scan** — description-similarity against all existing `agents/*.md`.
4. **Propose boundary edits** — `DO NOT TRIGGER for: <new-domain>` lines on each
   overlapping specialist's description.
5. **Gate the boundary edits** through `guild-evolve-skill` — paired evals
   verify the adjacent specialist still triggers correctly for its domain but
   no longer steals the new specialist's triggers.
6. **Gate the new specialist itself** — paired evals + shadow mode on historical
   specs (`tests/boundary/` fixtures validate the scan).
7. **Register** — move proposed files to `agents/` and `skills/specialists/`;
   add to `guild-team-compose`'s candidate list.

Failure at any gate stops the process and returns refinement options.

## See also

- `guild-plan.md §11` — full evolution pipeline + risks.
- `guild-plan.md §12` — specialist-creation flow.
- `scripts/README.md` — script contracts and exit codes.
- `tests/evolve/` and `tests/shadow/` — cross-cutting eval fixtures.
- `commands/guild-evolve.md`, `commands/guild-rollback.md` — user-facing entry points.
