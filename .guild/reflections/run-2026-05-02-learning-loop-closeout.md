---
run_id: run-2026-05-02-learning-loop-closeout
date: 2026-05-02
task_slug: guild-residual-closeout-learning-loop
guild_command: '/guild "Capture the learning loop for the Guild residual closeout. Do not edit files in this Claude invocation; summarize the key decisions and rationale for a follow-up .guild reflection/wiki artifact."'
proposals:
  skill_improvement:
    - guild-diagnose
    - guild-codex-review
    - guild-reflect
  missing_specialist: []
  context_issues: []
  followup_backlog:
    - docs/archived-counts
significance: high
---
# Reflection - Guild Residual Closeout Learning Loop

This reflection captures the end-of-project learning loop requested after the
Guild plugin closeout. The `/guild` command above was used to trigger the Guild
learning flow; the durable knowledge is recorded here and in the companion
decision pages under `.guild/wiki/decisions/`.

## Skill Improvement Proposals

### P-001 - Keep `/guild:diagnose` as the self-fix dogfooding command

`/guild:diagnose` was added so Guild has a first-class path for reading recent
`.guild/runs` telemetry, accepting optional user context, producing a diagnosis
and fix plan, and requiring a user gate before edits. This closes the residual
gap where failures could be audited but not converted into an intentional,
reviewable self-fix workflow.

Evidence: `commands/guild-diagnose.md` and `skills/meta/diagnose/SKILL.md`.

### P-002 - Treat Codex review as an opt-in user feature

`--codex-review` moved from an informal development discipline into a documented
opt-in feature for `/guild` and `/guild:diagnose`. The durable review trail stays
under `.guild/runs/<run-id>/codex-review/*.md`, with graceful skip when Codex is
unavailable. This preserves the adversarial-review standard without making it a
default consumer cost or availability dependency.

Evidence: `skills/meta/codex-review/SKILL.md`, `commands/guild.md`, and
`skills/meta/diagnose/SKILL.md`.

### P-003 - Keep telemetry scoped per `/guild` invocation

Per-invocation run scoping was added to avoid mixing telemetry from multiple
`/guild` invocations in one Claude Code session. The current-run sentinel and
metadata make each invocation auditable as a separate run instead of treating a
whole Claude session as one logical Guild run.

Evidence: `scripts/new-run-id.ts`, `hooks/capture-telemetry.ts`, and
`scripts/__tests__/run-scoping-and-loop-event.test.ts`.

### P-004 - Preserve real loop event emission at round boundaries

Loop schema support was not enough by itself; loop skills need concrete
`loop_round_start` and `loop_round_end` events at actual round boundaries. The
shared emitter gives planning and breakdown loops auditable counts and makes the
benchmark/UI loop metrics defensible.

Evidence: `scripts/emit-loop-event.ts`, loop skill instructions, and benchmark
loop metric tests.

### P-005 - Keep benchmark audit imports explicit and inspectable

The benchmark API/UI can import arbitrary `.guild/runs/<run-id>` directories and
fallback from v1.3 `events.ndjson` to supported v1.4 audit-log events. This lets
plugin runtime failures be inspected in the benchmark tooling without pretending
all runs came from the benchmark runner.

Evidence: `benchmark/src/artifact-importer.ts`, `benchmark/src/server.ts`,
`benchmark/tests/server.auditImport.test.ts`, and benchmark UI import screens.

### P-006 - Keep `G-diagnose` in the v1.4 Codex review schema

Once `/guild:diagnose --codex-review` became valid, `codex_review_round` needed
to accept `G-diagnose` anywhere gate values are documented or validated. Without
this, diagnose review telemetry would be emitted by the skill but rejected by
the validator.

Evidence: `scripts/v1.4-log-validator.ts`,
`benchmark/plans/v1.4-jsonl-schema.md`, `benchmark/src/log-jsonl.ts`, and
`benchmark/tests/v1.4-log-validator.test.ts`.

### P-007 - Version benchmark fixture `.guild` artifacts

Synthetic benchmark fail/timeout fixtures now carry minimal `.guild` artifacts,
and fixture `.guild` trees are unignored. This avoids broad combined benchmark
commands reporting unexplained missing artifacts when the intended behavior is
to score failed or timed-out runs.

Evidence: `benchmark/fixtures/synthetic-fail/.guild/`,
`benchmark/fixtures/synthetic-timeout/.guild/`, and
`benchmark/tests/artifact-importer.test.ts`.

## Followup Backlog

### F-001 - Archived phase-gate and audit docs keep historical counts

Old phase-gate and audit records still mention earlier command, skill, and
specialist counts. They were intentionally left untouched because they are
historical evidence, not current product documentation. Active docs were updated
instead.

Evidence: current active docs in `README.md`, `docs/architecture.md`, and
`benchmark/README.md` were updated; archived records under `docs/phase-gates/`
and `docs/audit/` were left as historical records.

## Summary

| ID | Type | Target | Priority | Auto-queue threshold met? |
|---|---|---|---|---|
| P-001 | skill_improvement | guild-diagnose | high | Manual dogfood decision recorded |
| P-002 | skill_improvement | guild-codex-review | high | Manual feature decision recorded |
| P-003 | process | telemetry-run-scoping | high | Implemented and tested |
| P-004 | process | loop-event-emission | high | Implemented and tested |
| P-005 | process | benchmark-audit-import | medium | Implemented and tested |
| P-006 | schema | G-diagnose | high | Implemented and tested |
| P-007 | fixture-policy | synthetic benchmark artifacts | medium | Implemented and tested |
| F-001 | followup_backlog | docs/archived-counts | low | Intentionally not changed |

No proposal is auto-promoted by this reflection. The decisions are captured as
durable knowledge so future `/guild:diagnose`, Codex review, telemetry, and
benchmark work can cite the rationale instead of rediscovering it.

