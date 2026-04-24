---
name: seo-keyword-research
description: Identifies target keywords with search intent, volume, difficulty, and SERP feature notes; clusters them into topics; produces a content gap analysis against current pages. Pulled by the `seo` specialist. TRIGGER: "do keyword research for X", "find target keywords for the new category", "build a keyword cluster map for Y", "run a content gap analysis", "identify search opportunities for the /pricing topic", "what keywords should we target for the docs hub". DO NOT TRIGGER for: on-page optimization of a specific URL (use `seo-on-page-optimization`), crawl / CWV / indexation audit (use `seo-technical-audit`), internal linking graph (use `seo-internal-linking`), writing the actual content (copywriter-long-form or technical-writer group), paid-search keyword lists (marketing/sales paid media, not organic SEO).
when_to_use: The parent `seo` specialist pulls this skill when the task requires discovering or scoping keywords before content or optimization work. Also fires on explicit user request.
type: specialist
---

# seo-keyword-research

Implements `guild-plan.md §6.2` (seo · keyword-research) under `§6.4` commercial principles: hypothesis-first (what are we betting ranks and converts?), success = measurable outcome (ranking + traffic + conversion), evidence = cited volume/difficulty/intent data, not vibes.

## What you do

Produce a keyword list with intent labeled, clustered into topics, mapped to existing pages or content gaps. Every keyword you recommend should tie back to a business outcome — ranking alone isn't the point.

- Start from the brief: audience, product, page types, existing assets. If the brief is vague, ask before generating.
- For each candidate keyword: search volume, keyword difficulty (KD), intent (informational / navigational / commercial / transactional), SERP features (PAA, featured snippet, video, local pack), seasonality note.
- Cite data source (Ahrefs, Semrush, GSC, Keyword Planner, etc.) — never invent volumes.
- Cluster by intent + topic. A cluster is a group of keywords one page can reasonably rank for.
- Map each cluster to an existing URL or mark as a content gap. Gaps get a proposed page type.
- Flag "fit" — even a high-volume keyword is a bad bet if intent mismatches the product.

## Output shape

Markdown with:

1. **Scope** — what this research covers and excludes.
2. **Method** — tools, date, filters applied.
3. **Keyword table** — keyword · volume · KD · intent · SERP features · cluster · target URL / gap.
4. **Cluster map** — one block per cluster with pillar keyword + supporting terms.
5. **Gap analysis** — clusters without a page; proposed page type and rough brief.
6. **Recommendations** — prioritized: quick wins, strategic bets, don't-chase.

Store at `.guild/runs/<run-id>/seo/keywords-<slug>.md` if tracked.

## Anti-patterns

- Head-term-only lists — "project management" with KD 92 is a vanity list.
- Ignoring intent — ranking for a term the product doesn't serve wastes the traffic.
- Chasing volume without fit — big numbers, wrong audience, zero conversion.
- No source citation for volumes — un-auditable and often wrong.
- One cluster per keyword — that's a list, not a strategy.
- Skipping the gap analysis — research without mapping to action is theater.

## Handoff

Return the keyword deliverable path to the invoking `seo` specialist. Downstream, the SEO specialist typically chains into `seo-on-page-optimization` (for existing pages in the map) or hands to `copywriter-long-form` / `technical-writer-user-manual` (for gap content). For internal-link planning around the new cluster, chain to `seo-internal-linking`. This skill does not dispatch.
