---
name: guild-wiki-lint
description: Audits .guild/wiki/ for contradictions between pages, stale claims (expires_at passed), missing §10.1.1 frontmatter fields, orphan pages (not linked from index.md), concepts referenced ≥3x without a page, missing source_refs resolution to .guild/raw/sources/<slug>/, and decision pages not in ADR-lite shape. Produces .guild/wiki/lint-<timestamp>.md. NEVER auto-edits — findings are for the user to act on. TRIGGER for "run wiki-lint", "audit the wiki for contradictions", "check wiki health", "find orphan pages", "any stale wiki pages", "which wiki pages have broken source_refs". DO NOT TRIGGER for: ingesting a new source (guild:wiki-ingest), searching or querying wiki content (guild:wiki-query), capturing a Q&A decision (guild:decisions), or editing a specific wiki page directly.
when_to_use: Weekly schedule, after any batch of 5+ ingests in a session, or on explicit `/guild:wiki lint` invocation.
type: knowledge
---

# guild:wiki-lint

Implements the knowledge layer audit contract: wiki structure + required frontmatter, decision ADR-lite shape, contradiction policy ("newer wins unless older has `confidence: high`"), and the lint-after-write discipline (runs after `guild:wiki-ingest` and `guild:decisions` write). Cadence: weekly + batch threshold + explicit invocation. Health report only; never auto-edits.

Read-only auditor. Complements `guild:wiki-ingest` (write) and `guild:wiki-query` (read) by checking both contracts hold across the whole wiki tree. Finds structural drift; never repairs it.

## Input

- **wiki root** — `.guild/wiki/` walked recursively. Every `.md` is a candidate page EXCEPT `index.md` (catalog), `log.md` (append-only log), and `lint-*.md` (prior reports).
- **raw root** — `.guild/raw/sources/` walked for `source_refs` resolution; each `<slug>/` must contain `original.*` + `metadata.json` per `guild:wiki-ingest`.
- **now** — current UTC timestamp, for `expires_at` comparison and the report filename.

Lint takes no user arguments; it walks the entire wiki on every invocation.

## Step 0 — the deterministic core (always run first)

Run the mechanical checks via the script — never reproduce them by hand:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/wiki-lint-checks.ts --root <repo-root>
```

It owns check #9 (`pending-grade-review` — migration-drafted `importance_draft:
true` grades awaiting operator review; cleared by `migrate-guild.ts
--accept-grades`) and the missing-`importance:` check, exits 0/2, and its
findings are folded verbatim into the report below. The semantic checks
(contradictions, stale claims, ADR shape) remain this skill's own work.

## Checks performed

Run **all nine** checks every invocation. Each finding carries a severity: **blocking** (a hard contract is broken — ingest or decisions skill violated), **important** (contradicts plan guidance, needs human attention), or **nit** (small hygiene issue).

| # | Check | Severity | Flags |
|---|-------|----------|-------|
| 1 | Frontmatter completeness | blocking | a page missing any required `§10.1.1` key |
| 2 | source_refs resolution | blocking | a `source_refs` slug with no resolvable raw dir |
| 3 | Stale claims | important | `expires_at` set and earlier than now |
| 4 | Contradictions | important (sometimes blocking) | two pages with conflicting claims on one topic |
| 5 | Orphan pages | important | page not in `index.md` and not cited by any `source_refs` |
| 6 | Missing concept pages | nit | a term used across ≥ 3 pages with no `concepts/` page |
| 7 | Decision page shape | blocking | a `decisions/` page missing `§10.3` ADR-lite fields/sections |
| 8 | Directory hygiene | nit | a stray subdir or stray `.md` at the wiki root |
| 9 | Pending importance review | important | a page still carrying `importance_draft: true` (v1→v2 migration drafted the grade; operator has not run `--accept-grades`) |

Full procedure for each check — required keys, resolution steps, detection signals, the `§10.5` newer-wins rule, the missing-concept threshold — is in **`lint-rules.md`** (this directory). The table is the index; read `lint-rules.md` for the spec before running.

## Output

Write `.guild/wiki/lint-<YYYY-MM-DDTHH:MM:SSZ>.md` (current UTC): a counts header (pages walked, raw sources walked, blocking/important/nit counts), then **all nine numbered sections** in order, then a `## Summary`. Each section lists one subsection per affected page or the literal `No findings.` line — all nine must always be present so downstream tooling (`guild:review`, `guild:verify-done`) can parse the report.

Every finding carries `path:`, `severity:`, `detail:` (what is wrong, not what to do), and `references:` (governing plan anchors). The Summary names the top 3 blockers by path and which skill to invoke next — never a specific fix.

Full report template + per-finding schema: **`lint-rules.md`**.

## Cadence

Three triggers: (1) **weekly schedule** — a host-side scheduler/hook kicks lint on the default cadence; (2) **batch threshold** — after 5+ ingests in a session (`guild:wiki-ingest` flags this in its `followups:` once the counter crosses 5); (3) **explicit invocation** — `/guild:wiki lint` or any wiki-audit request.

Do not self-trigger between runs. Lint is idempotent: two runs produce two reports and change nothing else.

## Non-destructive rule

Lint NEVER auto-edits any file under `.guild/wiki/` or `.guild/raw/` — no rewriting frontmatter (even a trivially inferable field), no deleting orphans, no collapsing contradictions, no stub concept pages, no purging stale pages. The only write it performs is the lint report under `.guild/wiki/lint-<timestamp>.md`. Every finding is surfaced for the user to act on. This mirrors the `§10.6` guarantee: the lint step is advisory, not corrective.

## Handoff

Return the report's absolute path plus per-severity counts. Downstream: `guild:review` reads the latest report when reviewing a `.guild/wiki/` change (blocking findings on changed pages surface in review); `guild:verify-done` reads it for memory-related tasks (blocking findings introduced since the last clean report are a verification failure).

The handoff receipt must include:

- `changed_files:` — exactly the new `lint-<timestamp>.md` report.
- `evidence:` — pages walked, raw sources walked, blocking/important/nit counts, the report path.
- `assumptions:` — heuristic choices (contradiction-detection tuning, concept-term threshold) so the user can calibrate.
- `followups:` — `- none` when clean; otherwise the top blockers by page path and the downstream skill to invoke. Lint never fixes anything — followups tell the main session where to dispatch next.
