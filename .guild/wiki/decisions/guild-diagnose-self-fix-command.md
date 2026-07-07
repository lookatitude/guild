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
# guild-diagnose-self-fix-command
## Context
Guild needed a dogfooding path for turning runtime failures, telemetry, and
operator-supplied symptoms into a concrete diagnosis and fix plan. Audit and
benchmark tooling could expose evidence, but there was no user-facing command
that tied the evidence to an explicit self-fix gate.

## Options considered
- Keep diagnosis as ad hoc maintainer work in the chat transcript.
- Add a hidden development-only diagnose skill.
- Add a user-facing `/guild:diagnose` command with a skill-owned workflow.

## Decision
Add a user-facing diagnose command backed by `guild:diagnose` skill - because
self-fix should be dogfooded through the same command/skill/plugin surface users
operate, and edits must remain gated by explicit user approval. In v2 this command
is `/guild fix` (renamed from `/guild:diagnose`; see
`plugin/.guild/wiki/entities/command-surface.md §5`).

## Consequences
Guild has a standard way to inspect recent `.guild/runs` evidence, accept
optional error context, produce a fix plan, optionally request cross-host review
(`--review=cross`), and pause before edits. Future diagnose behavior should
preserve the user gate and avoid turning diagnosis into automatic mutation.

