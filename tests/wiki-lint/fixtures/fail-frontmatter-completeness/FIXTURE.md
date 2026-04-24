# Fixture: fail-frontmatter-completeness

Target check: Check #1 — Frontmatter completeness (blocking).

Expected outcome: lint fails on check #1 only. Checks #2–#8 pass.

Minimum page count: 1 category page (plus `index.md` and `log.md`).

The single page `context/project-overview.md` omits the required
`sensitivity:` field from its §10.1.1 frontmatter. All other required fields
(`type`, `owner`, `confidence`, `source_refs`, `created_at`, `updated_at`) are
present. The page is linked from `index.md` so it is not an orphan, has
`source_refs: []` so check #2 is vacuous, no `expires_at`, no contradictions,
no concept-page gaps, no `decisions/` dir, and uses only the `context/`
canonical subdirectory.
