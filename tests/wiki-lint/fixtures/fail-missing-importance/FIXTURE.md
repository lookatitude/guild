# Fixture: fail-missing-importance

Target check: New check #9 — missing `importance:` on canonical page.

Expected outcome: lint fails on check #9 only. Existing checks #1–#8 pass.

Rule source: the knowledge-base hygiene and grading ADR §A.3.

Minimum page count: 2 canonical pages (plus `index.md` and `log.md`) — one
with `importance:` (passes) and one without (fails).

`concepts/example-pattern.md` carries complete §10.1.1 frontmatter INCLUDING
`importance: high` — passes check #9.

`decisions/example-missing-importance.md` carries complete §10.1.1 frontmatter
but OMITS `importance:` — triggers check #9 only.

The `decisions/` page has `type: decision` and includes the §10.3 ADR-lite
fields (date, asker, task, category) so check #7 (decision page shape) passes.
Both pages are linked from `index.md` so check #5 (orphan) passes. Neither has
`source_refs:` values so check #2 is vacuous. No `expires_at`. No contradictory
content. No concept-term repetition gap.

Why other checks pass:
- #1 (frontmatter completeness): all §10.1.1 fields present on both pages.
- #2 (source_refs resolution): `source_refs: []` on both pages.
- #3 (stale claims): no `expires_at` on either page.
- #4 (contradictions): no overlapping claims.
- #5 (orphan): both pages are linked from index.md.
- #6 (missing concept page): no term appears ≥3 times.
- #7 (decision shape): example-missing-importance.md has all §10.3 fields.
- #8 (directory hygiene): only `concepts/` and `decisions/` subdirectories.
- #9 (missing-importance): FAILS on example-missing-importance.md.
