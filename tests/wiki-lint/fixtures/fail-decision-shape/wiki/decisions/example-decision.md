---
type: decision
owner: orchestrator
confidence: medium
source_refs: []
created_at: 2026-04-24
updated_at: 2026-04-24
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-04-24
asker: orchestrator
task: fixture-fail-decision-shape-01
category: architecture
---

# example-decision

## Context
Fixture decision that deliberately omits the `## Options considered` body
section required by §10.3.

## Decision
Proceed with option B.

## Consequences
Lint check #7 should flag this page as a blocking finding because the
required `## Options considered` section is absent.
