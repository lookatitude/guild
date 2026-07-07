---
type: decision
owner: architect
confidence: medium
source_refs: []
created_at: 2026-04-24
updated_at: 2026-04-24
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-04-24
asker: orchestrator
task: fixture-missing-importance-01
category: architecture
---

# example-missing-importance

## Context
Fixture decision page that omits the `importance:` frontmatter field.
This triggers check #9 (missing-importance) only.

## Options considered
- A: Include `importance:`.
- B: Omit `importance:` to exercise the missing-importance lint check.

## Decision
B — deliberately omitting `importance:` so the lint check fires.

## Consequences
Check #9 (missing-importance) flags this page. All other checks pass.
