---
type: decision
owner: docs-engineer
confidence: high
importance: low
source_refs: []
created_at: 2026-05-02
updated_at: 2026-05-02
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-05-02
asker: user
task: guild-residual-closeout-learning-loop
category: other
---
# archived-phase-gates-remain-historical
## Context
After `/guild:diagnose` and related work landed, active counts changed for
commands, specialists, skills, and meta-skills. Older phase-gate and audit
records still contain the counts that were true when those records were written.

## Options considered
- Rewrite archived phase-gate and audit records to current counts.
- Delete archived records that now look stale.
- Leave archived records untouched and update only active docs.

## Decision
Leave archived phase-gate and audit records untouched - because they are
historical evidence of previous gates, not current product truth. Current docs
should carry current counts and behavior.

## Consequences
Future residual scans should classify old count references under
`docs/phase-gates/` and `docs/audit/` as archived unless an active doc links to
them as current truth. Active docs such as `README.md`, `docs/architecture.md`,
and `benchmark/README.md` remain the places to update current behavior.

