---
name: guild-wiki-lint
description: Audits .guild/wiki/ for contradictions between pages, stale claims (expires_at passed), missing §10.1.1 frontmatter fields, orphan pages (not linked from index.md), concepts referenced ≥3x without a page, missing source_refs resolution to .guild/raw/sources/<slug>/, and decision pages not in ADR-lite shape. Produces .guild/wiki/lint-<timestamp>.md. NEVER auto-edits — findings are for the user to act on. TRIGGER for "run wiki-lint", "audit the wiki for contradictions", "check wiki health", "find orphan pages", "any stale wiki pages", "which wiki pages have broken source_refs". DO NOT TRIGGER for: ingesting a new source (guild:wiki-ingest), searching or querying wiki content (guild:wiki-query), capturing a Q&A decision (guild:decisions), or editing a specific wiki page directly.
when_to_use: Weekly schedule per `guild-plan.md §10.6`, after any batch of 5+ ingests in a session, or on explicit `/guild:wiki lint` invocation.
type: knowledge
---

# guild:wiki-lint

Implements `guild-plan.md §10` (knowledge layer), `§10.1` (categorized wiki structure), `§10.1.1` (required page frontmatter), `§10.3` (decision capture ADR-lite shape), `§10.5` (contradiction policy — `confidence` frontmatter and "newer wins unless older has `confidence: high`"), `§10.5.1` (memory write path — lint audits AFTER `guild:wiki-ingest` and `guild:decisions` have written), and `§10.6` (lint cadence — weekly, after batches of 5+ ingests, or explicit `/guild:wiki lint`; produces a health report; never auto-edits).

Read-only auditor. Complements `guild:wiki-ingest` (write path) and `guild:wiki-query` (read path) by checking that both contracts are upheld across the whole wiki tree. Finds structural drift; never repairs it.

## Input

- **wiki root** — `.guild/wiki/` walked recursively. Every `.md` file under the tree is a candidate page except:
  - `.guild/wiki/index.md` — the catalog itself.
  - `.guild/wiki/log.md` — append-only chronological log.
  - `.guild/wiki/lint-*.md` — prior lint reports (this skill's own output).
- **raw root** — `.guild/raw/sources/` walked for `source_refs` resolution. Each `<slug>/` directory must contain both `original.*` and `metadata.json` per `guild:wiki-ingest`'s output contract.
- **now** — current UTC timestamp, used for `expires_at` comparison and for the report filename.

Lint takes no user arguments; it walks the entire wiki on every invocation.

## Checks performed

Run all eight checks on every invocation. Each finding is tagged with a severity: **blocking** (the page breaks a hard contract — ingest or decisions skill violated), **important** (contradicts plan guidance, likely needs human attention), or **nit** (small hygiene issue).

### 1. Frontmatter completeness — blocking

Every page under `.guild/wiki/<category>/` must carry the full `§10.1.1` frontmatter block. Required keys:

- `type` — one of `context | standard | product | entity | concept | decision | source`.
- `owner` — specialist slug or `orchestrator`.
- `confidence` — `low | medium | high`.
- `source_refs` — list (may be empty for hand-written pages; never omitted).
- `created_at` — ISO-8601 date.
- `updated_at` — ISO-8601 date.
- `sensitivity` — `public | internal | confidential | secret`.

`expires_at` and `supersedes` are part of the schema but allowed to be `null` — their absence is not a lint failure. Any missing required field is a blocking finding.

### 2. source_refs resolution — blocking

For each page, for each slug in `source_refs:`:

- `.guild/raw/sources/<slug>/` must exist as a directory.
- It must contain `metadata.json` AND at least one `original.*` file (any extension — the directory contract from `guild:wiki-ingest`).
- `metadata.json` must parse as JSON and contain at minimum the `slug` and `original_file` keys documented by `guild:wiki-ingest`.

Any broken slug is a blocking finding — `guild:wiki-query`'s source-resolution contract depends on this holding. Empty `source_refs: []` is fine; it just skips this check for that page.

### 3. Stale claims — important

Pages whose `expires_at:` is set AND strictly earlier than the current UTC date are flagged. The finding records page path, expiry date, and age (days past). Do not suggest a specific remediation — the user decides whether to refresh, re-ingest, or delete.

### 4. Contradictions — important (sometimes blocking)

Two or more pages that state contradictory claims on the same topic. Detect via:

- Same `slug` across two directories (near-duplicate pages not linked via `supersedes:`).
- Same strong noun-phrase subject with contradictory predicates in `## Summary` or `## Key points` — a lightweight text signal, best-effort.
- Explicit `supersedes:` chains where the superseded page is not archived or marked.

Apply the `§10.5` rule: **newer wins unless older has `confidence: high` and newer does not.** For cases the rule resolves cleanly, mark the finding as *important* and report the suggested winner. For ambiguous cases (both `high`, or both `low`, or text-signal rather than structural), mark it *blocking* and ask the user to adjudicate in the report. Never silently pick — the report surfaces both pages and their metadata.

### 5. Orphan pages — important

A page is an orphan if it is BOTH:

- Not linked from `.guild/wiki/index.md` (the LLM-maintained catalog per `§10.1`).
- Not referenced by any other page's `source_refs:` (i.e. no wiki page names its slug).

Pages under `sources/` that only appear in `source_refs:` from their ingesting wiki page are NOT orphans — that is the expected shape. Decision pages that appear in `index.md` under the decisions section are not orphans. A page in `decisions/` that no one links and the index omits is still an orphan.

### 6. Missing concept pages — nit

Walk all page bodies. Count occurrences of noun-phrase tokens that look like concept names (capitalized compound terms, kebab-case technical terms, and terms appearing inside backticks repeatedly). If a term appears across ≥ 3 distinct pages and no `.guild/wiki/concepts/<slug>.md` exists for it, record it as a missing concept candidate.

This check is lossy by design — list candidates, not mandates. The user decides whether a term warrants its own page.

### 7. Decision page shape — blocking

Every page under `.guild/wiki/decisions/` must conform to the ADR-lite shape owned by `guild:decisions` per `§10.3`. Required frontmatter fields beyond `§10.1.1`:

- `date` — ISO-8601 date.
- `asker` — specialist slug who raised the question.
- `task` — task identifier.
- `category` — e.g. `architecture | copy | pricing | data-model`.
- `supersedes` — slug or `null`.
- `confidence` — already covered by `§10.1.1`.

Required body sections: `## Context`, `## Options considered`, `## Decision`, `## Consequences`. A decision page missing any of these is a blocking finding — it either means `guild:wiki-ingest` wrote where `guild:decisions` should have (ownership boundary violation per `§10.1.1` and `§10.3`), or `guild:decisions` drifted from its own template. Report which.

### 8. Directory hygiene — nit

Allowed top-level subdirectories inside `.guild/wiki/` are exactly:

`context/`, `standards/`, `products/`, `entities/`, `concepts/`, `decisions/`, `sources/`.

Any other subdirectory, or a `.md` file outside those categories at the wiki root (aside from `index.md`, `log.md`, `lint-*.md`), is a hygiene nit. The report records the stray path.

## Output

Write `.guild/wiki/lint-<YYYY-MM-DDTHH:MM:SSZ>.md` using the current UTC timestamp. The file uses this structure:

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

## Summary
<one-paragraph roll-up keyed to severity; names the top 3 blockers by page
path and the recommended next step. Never names a specific fix — just
which skill the user should invoke next (e.g. "re-run guild:wiki-ingest
for <slug>", "hand-edit decisions/<slug>.md to add ## Consequences").>
```

Every finding entry includes:

- `path:` — the affected page.
- `severity:` — blocking | important | nit.
- `detail:` — one sentence stating what is wrong (not what to do).
- `references:` — plan anchors that govern the rule (e.g. `§10.1.1`, `§10.3`, `§10.5`).

If a check has zero findings, still include the section with a literal `No findings.` line — downstream tooling (`guild:review`, `guild:verify-done`) expects all eight sections to be present so the report is machine-readable.

## Cadence

Per `guild-plan.md §10.6`, this skill runs on three triggers:

1. **Weekly schedule** — orchestrator (or a host-side scheduler / hook) kicks lint on a cadence. The `§10.6` default is weekly.
2. **Batch threshold** — after any sequence of 5+ ingests in a single session. `guild:wiki-ingest` is expected to surface this in its handoff `followups:` once the session counter crosses 5; the main session then dispatches lint.
3. **Explicit invocation** — the user runs `/guild:wiki lint` or otherwise asks for a wiki audit.

Do not self-trigger between runs. Lint is idempotent: running it twice in a row produces two reports and changes nothing else.

## Non-destructive rule

Lint NEVER auto-edits any file under `.guild/wiki/` or `.guild/raw/`.

- Do not rewrite frontmatter, even when a missing field is trivially inferable.
- Do not delete orphan pages.
- Do not collapse contradictions.
- Do not create a stub concept page for a missing-concept finding.
- Do not purge stale pages whose `expires_at:` has passed.

The only filesystem write this skill performs is the lint report itself under `.guild/wiki/lint-<timestamp>.md`. Every finding is surfaced for the user — they decide whether to run `guild:wiki-ingest` again, hand-edit a page, or ignore the finding.

This mirrors the `§10.6` guarantee that the lint step is advisory, not corrective.

## Handoff

Return the absolute path of the lint report to the caller, plus the counts per severity. Downstream consumers:

- `guild:review` may read the latest report when reviewing a change that touches `.guild/wiki/` — blocking lint findings on pages in the change set should surface in the review.
- `guild:verify-done` may read the latest report when verifying that a memory-related task did not leave the wiki in a broken state — blocking findings introduced since the last clean report are a verification failure.

The handoff receipt must include:

- `changed_files:` — exactly the new `lint-<timestamp>.md` report.
- `evidence:` — pages walked, raw sources walked, blocking / important / nit counts, the report path.
- `assumptions:` — any heuristic choices (e.g. contradiction detection tuning, concept-term extraction threshold) so the user can calibrate.
- `followups:` — `- none` when the report is clean. When findings exist, list the top blockers by page path and the downstream skill the user should invoke. Lint itself never fixes anything — the followups tell the main session where to dispatch next.
