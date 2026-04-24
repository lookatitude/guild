# Fixture: pass

Target check: all 8 checks (canonical valid wiki).

Expected outcome: lint passes with zero findings across all 8 checks.

Minimum page count: 7 pages across the 7 canonical categories, plus `index.md`
and `log.md`, plus one raw source under `.guild/raw/sources/`.

Covers:
- §10.1.1 frontmatter completeness on every page.
- `source_refs: [example-source]` on `sources/example-source.md` resolves to
  `raw/sources/example-source/` with `original.txt` + `metadata.json`.
- No `expires_at` in the past.
- No contradictions between any two pages.
- Every page linked from `index.md`.
- No concept term appears ≥3 times across pages without its own
  `concepts/<slug>.md`.
- `decisions/example-decision.md` has both full §10.1.1 base frontmatter AND
  §10.3 ADR-lite additions (`date`, `asker`, `task`, `category`) plus the four
  required body sections.
- Only the seven canonical subdirectories appear under `wiki/`.
