---
name: researcher-comparison-table
description: Produces an N-option comparison table — libraries, vendors, frameworks, models — with named axes, cell rationale, and takeaways. Output: markdown table + 3–5 bullet takeaways + source list. Pulled by the `researcher` specialist. TRIGGER: "compare these five libraries", "side-by-side of X vs Y vs Z", "give me a comparison table of the top options for X", "evaluate these vendors for X", "which of these frameworks fits us best", "benchmark these options on cost and features". DO NOT TRIGGER for: scoring two *project-internal* architecture options for this codebase (use `architect-tradeoff-matrix`), open-ended topic research with multiple sources (use `researcher-deep-dive`), summarizing a single paper (use `researcher-paper-digest`), generating copy for a comparison landing page (copywriter-long-form or seo).
when_to_use: The parent `researcher` specialist pulls this skill when the task is a structured comparison of named external options (3+), and a reusable table is the right artifact. Also fires on explicit user request.
type: specialist
---

# researcher-comparison-table

Implements `guild-plan.md §6.1` (researcher · comparison-table) under `§6.4` engineering principles: evidence is a table whose every cell cites a source — no opinion cells, no unsourced "best" claims.

## What you do

Reduce "which of these 3–8 things should we pick?" to a scannable table, with axes chosen for the actual decision, every cell tied to a source, and a short set of takeaways — not a ranking disguised as analysis.

- Pick 4–8 axes that matter for the actual call — feature support, pricing tier, license, community size, benchmarks, maturity, ecosystem, lock-in.
- Make sure the options are comparable — listing a paid SaaS next to an OSS library is apples-to-oranges unless you call out the category mismatch.
- Cite every cell — version number and source URL for each claim. "Supports X" with no source is folklore.
- Keep the table narrow enough to render — if you need 12 axes, split into two tables.
- Takeaways at the bottom, not a single "winner" — the right pick depends on which axes the reader weights.
- Disclose vendor bias when you see it — a comparison sourced only from one vendor's own marketing is not a comparison.

## Output shape

Markdown fragment (inline return, optionally persisted at `.guild/runs/<run-id>/research/comparisons/<slug>.md`):

1. **Scope** — what question, what options, what's deliberately out.
2. **Table** — rows = options, columns = axes, cells = short fact + source footnote.
3. **Versions / dates checked** — one row per option with version and check-date.
4. **Takeaways** — 3–5 bullets keyed to reader priorities ("if cost dominates → X; if ecosystem → Y").
5. **Sources** — numbered footnote list.

## Anti-patterns

- Apples-to-oranges — comparing a managed service, an OSS library, and a language feature in the same table without flagging the category mismatch.
- Unweighted scoring pretending to be objective — a numeric total without axis weights reads neutral but smuggles in a preference.
- Hiding vendor bias — sourcing only from the leader's own docs; not disclosing sponsored content.
- Stale versions — comparing last year's version of one tool to this year's of another.
- Missing axes — leaving out the axis where your preferred option scores badly.
- Single "winner" call — a comparison table's job is to let the reader decide, not to pick for them.

## Handoff

Return the table (inline or as a file path) to the invoking `researcher` specialist. The researcher may chain into `researcher-deep-dive` if a specific option needs broader investigation, or into `researcher-paper-digest` if a named paper backs one of the options. This skill does not dispatch.
