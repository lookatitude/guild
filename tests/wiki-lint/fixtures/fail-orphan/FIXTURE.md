# Fixture: fail-orphan

Target check: Check #5 — Orphan pages (important).

Expected outcome: lint fails on check #5 only. Checks #1–#4, #6–#8 pass.

Minimum page count: 2 category pages (plus `index.md` and `log.md`) — one
linked so the index is non-empty, one deliberately unlinked.

`context/project-overview.md` is linked from `index.md`. `standards/orphan-standard.md`
is NOT linked from `index.md` and is NOT named in any other page's
`source_refs:`. Both pages carry complete §10.1.1 frontmatter, have
`source_refs: []` (so check #2 is vacuous), no `expires_at`, no contradictory
content, no `decisions/` tree, and both live in canonical directories
(`context/` and `standards/`).
