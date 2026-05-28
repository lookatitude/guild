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
category: architecture
---
# benchmark-import-and-fixture-artifact-policy
## Context
The benchmark app needed to inspect real Guild runtime evidence, including
arbitrary `.guild/runs/<run-id>` directories and v1.4 audit logs. Synthetic
fail/timeout fixtures also needed to represent failed behavior without being
mistaken for unexplained missing artifacts.

## Options considered
- Limit benchmark imports to runner-created `events.ndjson` fixtures only.
- Import arbitrary `.guild/runs` evidence but leave fixture `.guild` trees
  ignored and incomplete.
- Add arbitrary audit-log import support and make synthetic fixture `.guild`
  artifacts versionable.

## Decision
Support arbitrary `.guild/runs/<run-id>` import in benchmark API/UI and version
minimal synthetic `.guild` fixture artifacts - because benchmark diagnostics
should work on real plugin runs, and fixture failures should score run behavior
rather than hidden fixture incompleteness.

## Consequences
The importer can fall back from v1.3 `events.ndjson` to supported v1.4 audit-log
events. Benchmark fixture `.guild` trees are intentionally unignored under
`benchmark/fixtures/**/.guild/**`, while ordinary runtime `.guild/` state stays
ignored.

