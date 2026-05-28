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
# codex-review-user-facing-opt-in
## Context
Codex adversarial review started as a development discipline for Guild's own
plugin work. `/guild:diagnose` and the broader loop work made it useful as an
operator-requested second opinion, but making it default would add cost and
availability risk.

## Options considered
- Keep Codex review dev-only and undocumented for users.
- Enable Codex review by default on all `/guild` runs.
- Expose it as an explicit `--codex-review` opt-in with graceful skip.

## Decision
Promote adversarial review to a documented opt-in feature via `--review=cross` (v2;
v1 flag was `--codex-review`, replaced at v2) - because users should be able to
request cross-host review when the stakes justify it, while default Guild runs
stay independent of Codex availability and cost.

## Consequences
Codex review trails are durable under `.guild/runs/<run-id>/codex-review/*.md`.
The feature must skip cleanly when Codex is unavailable, and schema support must
cover every documented gate. The `--codex-review` flag is superseded by
`--review=local|cross|off` (see `docs/knowledge/architecture/command-surface.md §D`).

