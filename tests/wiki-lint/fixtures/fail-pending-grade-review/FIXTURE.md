# Fixture: fail-pending-grade-review

Target check: skill check #9 — pending importance review (`importance_draft: true`),
the human gate of the v1→v2 wiki importance backfill. Deterministic twin:
`plugin/scripts/docs-hygiene/scan.ts` rule 7.

Expected outcome: lint fails on check #9 only (severity: important). All other
checks pass.

Rule source: `skills/knowledge/wiki-lint/lint-rules.md §9`; flow:
`https://guildstack.dev/docs/migration-v1-to-v2`; grading taxonomy: the knowledge-base hygiene and grading ADR.

Minimum page count: 2 canonical pages (plus `index.md` and `log.md`) — one
accepted (passes) and one still carrying the migration draft markers (fails).

`standards/example-accepted.md` carries complete §10.1.1 frontmatter INCLUDING
a plain `importance: high` (no draft markers) — passes check #9.

`standards/example-drafted.md` carries complete §10.1.1 frontmatter PLUS the
migration draft markers `importance: high`, `importance_draft: true`,
`graded_by: guild-migrate` — triggers check #9 only. The expected finding
names the page, the drafted grade, and the accept command
(`migrate-guild.ts --accept-grades --root=<repo-root>`); lint must NOT edit
the page (non-destructive rule).

Why other checks pass:
- #1 (frontmatter completeness): all §10.1.1 fields present on both pages
  (`importance_draft`/`graded_by` are additive, not missing fields).
- #2 (source_refs resolution): `source_refs: []` on both pages.
- #3 (stale claims): no `expires_at` on either page.
- #4 (contradictions): no overlapping claims.
- #5 (orphan): both pages are linked from index.md.
- #6 (missing concept page): no term appears ≥3 times.
- #7 (decision shape): no `decisions/` pages in the fixture.
- #8 (directory hygiene): only the `standards/` subdirectory.
- #9 (pending importance review): FAILS on example-drafted.md.
