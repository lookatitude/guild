# Fixture: fail-source-refs

Target check: Check #2 — source_refs resolution (blocking).

Expected outcome: lint fails on check #2 only. Checks #1, #3–#8 pass.

Minimum page count: 1 category page (plus `index.md` and `log.md`).

`sources/example-source.md` declares `source_refs: [missing-slug]`, but
`raw/sources/missing-slug/` does not exist (the `raw/sources/` tree is empty).
The page carries a complete §10.1.1 frontmatter, is linked from `index.md`,
has no `expires_at`, no contradiction, no decision shape requirement, and
uses only the `sources/` canonical subdirectory. Check #2 is the only
failure.
