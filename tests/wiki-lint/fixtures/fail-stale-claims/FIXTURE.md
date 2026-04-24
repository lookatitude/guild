# Fixture: fail-stale-claims

Target check: Check #3 — Stale claims (important).

Expected outcome: lint fails on check #3 only. Checks #1, #2, #4–#8 pass.

Minimum page count: 1 category page (plus `index.md` and `log.md`).

`standards/coding-standards.md` sets `expires_at: 2025-01-01`, which is
strictly earlier than the fixture's reference "now" (2026-04-24). Frontmatter
is otherwise complete, `source_refs: []` so check #2 is vacuous, no
contradictions, page is linked from `index.md`, only one page so no concept
gap is possible, no `decisions/` tree, and only the `standards/` canonical
directory is used.
