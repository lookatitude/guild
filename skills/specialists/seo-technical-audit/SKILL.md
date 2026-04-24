---
name: seo-technical-audit
description: Audits technical SEO health — crawlability, robots/sitemaps, indexation, canonicals, redirects, Core Web Vitals (mobile first), hreflang, HTTPS, JS rendering. Output: severity-tagged findings with owner assignment. Pulled by the `seo` specialist. TRIGGER: "run a technical SEO audit", "audit crawlability and indexation", "check our Core Web Vitals and fix owners", "review canonicals and redirects across the site", "audit robots.txt and sitemaps", "run a technical crawl and report on severity". DO NOT TRIGGER for: keyword discovery (use `seo-keyword-research`), single-page on-page optimization (use `seo-on-page-optimization`), internal-linking strategy (use `seo-internal-linking`), application performance profiling (engineering/devops observability), a11y audit (separate concern, not in roster), security audit (security group), content audits for editorial quality (copywriter group).
when_to_use: The parent `seo` specialist pulls this skill when the task is a site-wide technical-health pass rather than any single-page or content work. Also fires on explicit user request.
type: specialist
---

# seo-technical-audit

Implements `guild-plan.md §6.2` (seo · technical-audit) under `§6.4` commercial principles: hypothesis-first (what's blocking traffic we already earn?), success = measurable (crawl coverage, index share, CWV pass rate), evidence = cited data from crawl/GSC/CrUX, owners named so findings ship.

## What you do

Run a structured technical audit and hand back findings that route to the right owner. A report nobody owns is a report nobody reads — every finding carries severity and a specific owner.

- Run (or request) a fresh crawl. Cite the tool, date, and scope (URLs included/excluded).
- Cover: robots.txt + sitemaps, indexation (GSC coverage), canonical correctness, redirect chains/loops, status codes, duplicate content, hreflang (if international), structured data validity, JS rendering parity (view-source vs rendered), HTTPS, mobile usability, Core Web Vitals on mobile (LCP, INP, CLS).
- Grade every finding: P0 (traffic bleeding now), P1 (will bleed soon), P2 (tech debt).
- Assign an owner per finding — SEO, engineering, devops, content, or specific team. No "team" as owner; name the specialist.
- Call out Core Web Vitals on mobile first — desktop scores flatter; users are mostly mobile.
- Don't ship a report-only deliverable. Each finding needs a next action and a verification step.

## Output shape

Markdown with:

1. **Scope + method** — crawl tool, date, URLs, filters, GSC/CrUX sources.
2. **Executive summary** — top 5 P0/P1 findings, expected traffic impact.
3. **Findings table** — id · area · severity · description · evidence · owner · fix · verify.
4. **Core Web Vitals** — mobile pass rate, worst offenders, cited CrUX data.
5. **Indexation** — coverage report summary, excluded-by-reason breakdown.
6. **Followups** — findings that need deeper investigation.

Store at `.guild/runs/<run-id>/seo/audit-<date>.md` if tracked.

## Anti-patterns

- Report-only deliverable with no ownership — nothing ships.
- Vanity metrics (site-wide avg score) hiding worst-offender pages.
- Ignoring Core Web Vitals on mobile — desktop-only is comfort viewing.
- Generic recommendations ("improve page speed") with no specific URL or fix.
- Re-running a tool's default report verbatim without interpretation.
- Missing hreflang/international audit on multi-locale sites.

## Handoff

Return the audit path to the invoking `seo` specialist. Findings route out: engineering for JS rendering / CWV code fixes, devops for infra (CDN, redirects, HTTPS), content/copywriter for duplicate or thin content, `seo-on-page-optimization` for per-page tactical fixes, `seo-internal-linking` for orphan pages. This skill does not dispatch.
