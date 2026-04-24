# Fixture: fail-missing-concept

Target check: Check #6 — Missing concept pages (nit).

Expected outcome: lint fails on check #6 only. Checks #1–#5, #7–#8 pass.

Minimum page count: 3 distinct pages mentioning the same concept term (plus
`index.md` and `log.md`).

Three pages — `context/project-overview.md`, `standards/coding-standards.md`,
`products/example-product.md` — each mention the term "Event sourcing"
(capitalized compound term). No `concepts/event-sourcing.md` exists, so
check #6 flags the term as a missing concept candidate.

All three pages carry complete §10.1.1 frontmatter, have `source_refs: []`
so check #2 is vacuous, no `expires_at`, no opposing claims, every page is
linked from `index.md`, no `decisions/` tree, and only canonical
subdirectories are used. No `concepts/` dir exists at all — that is
precisely what check #6 is detecting.
