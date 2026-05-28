# Fixture: fail-dangling-related

Target check: New check #11 — dangling `related:` slugs (slug not found as a page).

Expected outcome: lint fails on check #11 only. Existing checks #1–#10 pass.

Rule source: ADR `docs/knowledge/decisions/knowledge-base-hygiene-and-grading.md §D.2`
(SC-4 — no dangling `related:`/`source_refs:`).

Minimum page count: 1 canonical page (plus `index.md` and `log.md`).

`concepts/example-dangling-related.md` carries complete §10.1.1 frontmatter
including `importance: medium`. Its frontmatter `related:` list contains the slug
`nonexistent-page` which does not correspond to any page file in the fixture.
The resolved slug `example-pattern` (which does exist) is also listed — so the
check fires on `nonexistent-page` only.

The `source_refs: []` is empty so check #2 (source_refs resolution) is vacuous.

Why other checks pass:
- #1 (frontmatter completeness): all §10.1.1 fields present.
- #2 (source_refs resolution): `source_refs: []`.
- #3 (stale claims): no `expires_at`.
- #4 (contradictions): single page.
- #5 (orphan): linked from index.md.
- #6 (missing concept page): no term ≥3 times.
- #7 (decision shape): no `decisions/` page.
- #8 (directory hygiene): only `concepts/` subdirectory.
- #9 (missing-importance): `importance: medium` present.
- #10 (progress-messaging): no C.3 patterns in body.
- #11 (dangling-related): FAILS — `nonexistent-page` slug not found.
