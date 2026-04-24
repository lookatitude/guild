# Fixture: fail-directory-hygiene

Target check: Check #8 — Directory hygiene (nit).

Expected outcome: lint fails on check #8 only. Checks #1–#7 pass.

Minimum page count: 1 page in a non-canonical subdirectory (plus `index.md`
and `log.md`).

`misc/stray.md` lives under `.guild/wiki/misc/`, which is NOT one of the
seven canonical subdirectories (`context/`, `standards/`, `products/`,
`entities/`, `concepts/`, `decisions/`, `sources/`). The page carries
complete §10.1.1 frontmatter, is linked from `index.md` (so it is not an
orphan), has `source_refs: []`, no `expires_at`, no contradictions, and is
not a decision page so check #7 does not apply.
