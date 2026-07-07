---
type: decision
owner: docs-engineer
confidence: high
importance: medium
source_refs: []
created_at: 2026-05-02
updated_at: 2026-05-02
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-05-02
asker: user
task: guild-residual-closeout-learning-loop
category: architecture
---
# run-scoped-telemetry-and-loop-events
## Context
Multiple `/guild` invocations can happen in one Claude Code session. Without a
per-invocation run id, hook telemetry can mix separate runs. Separately, loop
schemas existed before the loop skills had a concrete event emission path.

## Options considered
- Treat one Claude Code session as one logical Guild run.
- Require users to provide run ids manually.
- Use a current-run sentinel and helper scripts to scope telemetry and emit loop
  boundary events.

## Decision
Use per-`/guild` invocation run scoping plus explicit loop event helpers -
because audit logs need to distinguish runs automatically, and loop counts are
only meaningful when `loop_round_start` and `loop_round_end` are emitted at real
round boundaries.

## Consequences
Telemetry consumers should read the current-run sentinel/metadata when available
and avoid aggregating across invocations by session alone. Loop skills should use
the shared emitter rather than appending bespoke JSONL rows.

