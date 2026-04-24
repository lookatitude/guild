# Fixture: fail-contradictions

Target check: Check #4 — Contradictions (important).

Expected outcome: lint fails on check #4 only. Checks #1–#3, #5–#8 pass.

Minimum page count: 2 pages making opposing claims on the same subject
(plus `index.md` and `log.md`).

`standards/indentation-rule-a.md` claims "Example Project code uses TWO-SPACE
indentation." `standards/indentation-rule-b.md` claims "Example Project code
uses FOUR-SPACE indentation." Both pages carry complete §10.1.1 frontmatter,
are linked from `index.md`, have `source_refs: []` so check #2 is vacuous,
no `expires_at`, no `decisions/` tree, and both live in the canonical
`standards/` directory.

The two pages have different `updated_at` dates and different `confidence`
values so the §10.5 "newer wins unless older has confidence: high" rule
resolves the winner cleanly — the finding is *important*, not *blocking*.
