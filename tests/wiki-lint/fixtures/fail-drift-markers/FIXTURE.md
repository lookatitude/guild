# Fixture: fail-drift-markers

Target check: New check #12 — v1/single-repo drift markers in canonical page body.

Expected outcome: lint fails on check #12 only. Existing checks #1–#11 pass.

Rule source: ADR `docs/knowledge/decisions/knowledge-base-hygiene-and-grading.md §Decision A`
(SC-1 — v1→v2/single-repo drift purged).

Minimum page count: 1 canonical page (plus `index.md` and `log.md`).

`concepts/example-drift-markers.md` carries complete §10.1.1 frontmatter
including `importance: medium`. Its body contains a v1 command reference
`/guild-wiki` (the old v1 command prefix — v2 uses `/guild:wiki`).

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
- #11 (dangling-related): `related: []`, no slugs.
- #12 (drift-markers): FAILS — body contains `/guild-wiki` (v1 command).
