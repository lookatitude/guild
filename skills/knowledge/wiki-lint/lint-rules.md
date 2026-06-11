# wiki-lint — rule catalog & report format

Full procedures for the nine checks summarised in `SKILL.md`, plus the lint
report template and the per-finding schema. `SKILL.md` is the lean playbook;
this file is the detail the auditor follows when running each check.

Plan anchors: `guild-plan.md §10.1.1` (required frontmatter), `§10.3` (decision
ADR-lite shape), `§10.5` (contradiction policy — `confidence` frontmatter and
"newer wins unless older has `confidence: high`"), `§10.6` (cadence +
advisory-only).

Run all nine checks on every invocation. Each finding is tagged with a
**severity**: **blocking** (the page breaks a hard contract — ingest or
decisions skill violated), **important** (contradicts plan guidance, likely
needs human attention), or **nit** (small hygiene issue).

## 1. Frontmatter completeness — blocking

Every page under `.guild/wiki/<category>/` must carry the full `§10.1.1`
frontmatter block. Required keys:

- `type` — one of `context | standard | product | entity | concept | decision | source`.
- `owner` — specialist slug or `orchestrator`.
- `confidence` — `low | medium | high`.
- `source_refs` — list (may be empty for hand-written pages; never omitted).
- `created_at` — ISO-8601 date.
- `updated_at` — ISO-8601 date.
- `sensitivity` — `public | internal | confidential | secret`.

`expires_at` and `supersedes` are part of the schema but allowed to be `null` —
their absence is not a lint failure. Any missing required field is a blocking
finding.

## 2. source_refs resolution — blocking

For each page, for each slug in `source_refs:`:

- `.guild/raw/sources/<slug>/` must exist as a directory.
- It must contain `metadata.json` AND at least one `original.*` file (any
  extension — the directory contract from `guild:wiki-ingest`).
- `metadata.json` must parse as JSON and contain at minimum the `slug` and
  `original_file` keys documented by `guild:wiki-ingest`.

Any broken slug is a blocking finding — `guild:wiki-query`'s source-resolution
contract depends on this holding. Empty `source_refs: []` is fine; it just
skips this check for that page.

## 3. Stale claims — important

Pages whose `expires_at:` is set AND strictly earlier than the current UTC date
are flagged. The finding records page path, expiry date, and age (days past).
Do not suggest a specific remediation — the user decides whether to refresh,
re-ingest, or delete.

## 4. Contradictions — important (sometimes blocking)

Two or more pages that state contradictory claims on the same topic. Detect
via:

- Same `slug` across two directories (near-duplicate pages not linked via
  `supersedes:`).
- Same strong noun-phrase subject with contradictory predicates in
  `## Summary` or `## Key points` — a lightweight text signal, best-effort.
- Explicit `supersedes:` chains where the superseded page is not archived or
  marked.

Apply the `§10.5` rule: **newer wins unless older has `confidence: high` and
newer does not.** For cases the rule resolves cleanly, mark the finding as
*important* and report the suggested winner. For ambiguous cases (both `high`,
or both `low`, or text-signal rather than structural), mark it *blocking* and
ask the user to adjudicate in the report. Never silently pick — the report
surfaces both pages and their metadata.

## 5. Orphan pages — important

A page is an orphan if it is BOTH:

- Not linked from `.guild/wiki/index.md` (the LLM-maintained catalog per
  `§10.1`).
- Not referenced by any other page's `source_refs:` (i.e. no wiki page names
  its slug).

Pages under `sources/` that only appear in `source_refs:` from their ingesting
wiki page are NOT orphans — that is the expected shape. Decision pages that
appear in `index.md` under the decisions section are not orphans. A page in
`decisions/` that no one links and the index omits is still an orphan.

## 6. Missing concept pages — nit

Walk all page bodies. Count occurrences of noun-phrase tokens that look like
concept names (capitalized compound terms, kebab-case technical terms, and
terms appearing inside backticks repeatedly). If a term appears across ≥ 3
distinct pages and no `.guild/wiki/concepts/<slug>.md` exists for it, record it
as a missing concept candidate.

This check is lossy by design — list candidates, not mandates. The user decides
whether a term warrants its own page.

## 7. Decision page shape — blocking

Every page under `.guild/wiki/decisions/` must carry BOTH the `§10.1.1` base
frontmatter (checked by Check #1) AND the `§10.3` ADR-lite additions owned by
`guild:decisions`. Required `§10.3` additions (beyond the Check #1 base
fields):

- `date` — ISO-8601 date.
- `asker` — specialist slug who raised the question.
- `task` — task identifier.
- `category` — e.g. `architecture | copy | pricing | data-model`.

`supersedes` and `confidence` are already covered by `§10.1.1` base and must
not be duplicated in the additions list.

Required body sections: `## Context`, `## Options considered`, `## Decision`,
`## Consequences`. A decision page missing any of these additions or body
sections is a blocking finding — it either means `guild:wiki-ingest` wrote
where `guild:decisions` should have (ownership boundary violation per
`§10.1.1` and `§10.3`), or `guild:decisions` drifted from its own template.
Report which.

## 8. Directory hygiene — nit

Allowed top-level subdirectories inside `.guild/wiki/` are exactly:

`context/`, `standards/`, `products/`, `entities/`, `concepts/`, `decisions/`,
`sources/`.

Any other subdirectory, or a `.md` file outside those categories at the wiki
root (aside from `index.md`, `log.md`, `lint-*.md`), is a hygiene nit. The
report records the stray path.

## 9. Pending importance review — important

A **deterministic frontmatter predicate** (no judgement involved): flag every
page whose frontmatter contains `importance_draft: true`. These pages were
drafted an `importance:` grade by the v1→v2 migration's wiki importance
backfill (`/guild:migrate`, `graded_by: guild-migrate`) and the operator has
**not yet reviewed/accepted** the grade — the page is sitting at the human
gate. The finding records page path, the drafted grade, and the accept
command:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/dot-guild/migrate-guild.ts --accept-grades --root=<repo-root>
```

Do not edit the grade yourself (the non-destructive rule applies) — the
operator reviews/edits each `importance:` value, then `--accept-grades`
strips the `importance_draft`/`graded_by` markers and keeps the grade. The
flag repeats on every lint run until accepted. The same predicate runs
deterministically in `scripts/docs-hygiene/scan.ts` (rule 7); flow reference:
`plugin/MIGRATION.md §3a`.

## Report template

Write `.guild/wiki/lint-<YYYY-MM-DDTHH:MM:SSZ>.md` using the current UTC
timestamp. The file uses this structure:

```markdown
# Wiki lint report — <YYYY-MM-DDTHH:MM:SSZ>

**Pages walked:** <count>
**Raw sources walked:** <count>
**Blocking findings:** <count>
**Important findings:** <count>
**Nit findings:** <count>

## 1. Frontmatter completeness
<one subsection per affected page, or "No findings." if clean>

## 2. source_refs resolution
...

## 3. Stale claims
...

## 4. Contradictions
...

## 5. Orphan pages
...

## 6. Missing concept pages
...

## 7. Decision page shape
...

## 8. Directory hygiene
...

## 9. Pending importance review
...

## Summary
<one-paragraph roll-up keyed to severity; names the top 3 blockers by page
path and the recommended next step. Never names a specific fix — just
which skill the user should invoke next (e.g. "re-run guild:wiki-ingest
for <slug>", "hand-edit decisions/<slug>.md to add ## Consequences").>
```

## Per-finding schema

Every finding entry includes:

- `path:` — the affected page.
- `severity:` — blocking | important | nit.
- `detail:` — one sentence stating what is wrong (not what to do).
- `references:` — plan anchors that govern the rule (e.g. `§10.1.1`, `§10.3`,
  `§10.5`).

## All-sections rule

If a check has zero findings, still include the section with a literal
`No findings.` line — downstream tooling (`guild:review`, `guild:verify-done`)
expects all nine sections to be present so the report is machine-readable.
