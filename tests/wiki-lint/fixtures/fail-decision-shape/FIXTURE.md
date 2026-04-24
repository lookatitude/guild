# Fixture: fail-decision-shape

Target check: Check #7 — Decision page shape (blocking).

Expected outcome: lint fails on check #7 only. Checks #1–#6, #8 pass.

Minimum page count: 1 decision page (plus `index.md` and `log.md`).

`decisions/example-decision.md` carries the full §10.1.1 base frontmatter so
check #1 passes. It ALSO carries all four §10.3 ADR-lite additions (`date`,
`asker`, `task`, `category`). Where it fails: the `## Options considered`
body section is missing — check #7 requires all four body sections
(`## Context`, `## Options considered`, `## Decision`, `## Consequences`).

`source_refs: []` so check #2 is vacuous, `expires_at: null` so check #3 is
silent, only one page so no contradiction or concept-gap is possible, the
page is linked from `index.md`, and `decisions/` is a canonical
subdirectory.
