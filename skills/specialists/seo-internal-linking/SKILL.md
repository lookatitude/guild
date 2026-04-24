---
name: seo-internal-linking
description: Plans an internal-link structure — link graph across pillars/clusters, anchor-text variance, orphan-page fixes, sitewide nav vs in-content links, link-equity flow. Output: link graph + recommendations. Pulled by the `seo` specialist. TRIGGER: "plan our internal linking structure", "fix orphan pages", "map the internal-link graph for the blog hub", "recommend internal links between the new cluster pages", "audit and redesign the internal-link structure", "route link equity to our priority pages". DO NOT TRIGGER for: backlink/external-link strategy (that's off-site SEO, outside this roster), keyword discovery (use `seo-keyword-research`), single-page on-page links as part of a broader on-page pass (use `seo-on-page-optimization`), technical crawl audit (use `seo-technical-audit`), information architecture redesign of a product app (that's product/design, not SEO), blog editorial planning (copywriter-long-form).
when_to_use: The parent `seo` specialist pulls this skill when the task is planning how pages link to each other across a site or hub. Also fires on explicit user request.
type: specialist
---

# seo-internal-linking

Implements `guild-plan.md §6.2` (seo · internal-linking) under `§6.4` commercial principles: hypothesis-first (which pages should rank, which should route?), success = measurable (orphan count, avg links-per-priority-page, crawl depth), evidence = a cited graph, not anecdotes.

## What you do

Plan the internal-link graph so crawl and link equity route to the pages that matter. Internal linking is content-strategy-with-footnotes — every link encodes a claim about what's important.

- Start from the target list: which pages should rank / convert / act as hubs. If this isn't clear, get it before graphing.
- Pull the current crawl. Identify pillars (pages you want to rank), supporting pages, orphans (0 inbound internal links), and link-equity sinks.
- Draw the graph: pillar → supporting pages (both directions), cross-links between siblings, and upstream links from nav/footer where appropriate.
- Anchor-text strategy: descriptive and varied. Partial-match and topical variants beat exact-match spam.
- Fix orphans with 2–3 inbound links each. Don't inflate — a link added for inflation reads like one.
- Nav vs in-content vs footer: footer and nav apply everywhere; in-content links are targeted. Use the right tool.

## Output shape

Markdown with:

1. **Targets** — priority pages and their clusters.
2. **Current state** — orphan count, avg inbound links per priority page, crawl-depth distribution.
3. **Link graph** — mermaid or table: source → anchor → destination.
4. **Recommendations** — additions (source · anchor · destination) and removals (over-optimized or confusing).
5. **Anchor-text plan** — per priority page: allowed anchor variants.
6. **Followups** — structural issues (taxonomy, navigation) too large for this pass.

Store at `.guild/runs/<run-id>/seo/internal-links-<slug>.md` if tracked.

## Anti-patterns

- Exact-match anchor over-optimization — 40 inbound links all reading "best CRM software" is a flag, not a boost.
- Orphaned content left orphaned — it's the simplest fix and the one most often skipped.
- PageRank-hoarding silos — refusing to link between related topics because of a 2010-era siloing myth.
- Sitewide-link abuse — putting every priority page in the footer nav, diluting both the nav and the signal.
- Linking for link's sake — adding "learn more" to every paragraph.
- No graph, just a wish list — recommendations without a visible structure can't be evaluated.

## Handoff

Return the plan path to the invoking `seo` specialist. Implementations that touch many pages hand off to content owners (copywriter/technical-writer) for the actual edits. Orphan content without a clear keeper route to the content owner with a kill-or-redirect recommendation. If crawl-depth issues surface, chain to `seo-technical-audit`. This skill does not dispatch.
