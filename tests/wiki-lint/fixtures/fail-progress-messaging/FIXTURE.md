# Fixture: fail-progress-messaging

Target check: New check #10 — progress-messaging patterns in canonical page body.

Expected outcome: lint fails on check #10 only. Existing checks #1–#9 pass.

Rule source: the knowledge-base hygiene and grading ADR §C.3.

Minimum page count: 1 canonical page (plus `index.md` and `log.md`).

`concepts/example-progress-messaging.md` carries complete §10.1.1 frontmatter
INCLUDING `importance: medium`, so check #9 (missing-importance) passes.
Its body contains progress-messaging text matching C.3 pattern 1:
  "Currently, this feature is TODO and coming next wave."
This is removable-on-sight session narrative that would trigger check #10.

Why other checks pass:
- #1 (frontmatter completeness): all §10.1.1 fields present.
- #2 (source_refs resolution): `source_refs: []`.
- #3 (stale claims): no `expires_at`.
- #4 (contradictions): single page, no contradictions.
- #5 (orphan): linked from index.md.
- #6 (missing concept page): no term appears ≥3 times.
- #7 (decision shape): no `decisions/` page in this fixture.
- #8 (directory hygiene): only `concepts/` subdirectory.
- #9 (missing-importance): `importance: medium` present.
- #10 (progress-messaging): FAILS — body contains C.3 pattern 1 and pattern 2 (emoji).
