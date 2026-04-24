---
name: marketing-campaign-brief
description: Writes a campaign brief that commissions downstream work from copywriter, social-media, and seo — tight goal, audience, message, channels, assets-needed, deadlines, and success criteria. Pulled by the `marketing` specialist. TRIGGER: "write a campaign brief for <campaign>", "brief the copywriter and social-media team on the Q3 push", "draft the creative brief for the webinar promo", "commission a campaign against <theme>", "set up the campaign brief with goals and constraints", "brief the agency on the summer campaign". DO NOT TRIGGER for: overarching positioning (use `marketing-positioning`), full launch plan across phases (use `marketing-launch-plan`), writing the campaign assets themselves (copywriter / social-media / seo groups), A/B copy variant tests (use `marketing-ab-copy-variants`), sales outreach plan (use `sales-cold-outreach`).
when_to_use: The parent `marketing` specialist pulls this skill when the task is commissioning a single, scoped campaign with specific deliverables and deadlines. Also fires on explicit user request.
type: specialist
---

# marketing-campaign-brief

Implements `guild-plan.md §6.3` (marketing · campaign-brief) under `§6.4` commercial principles: hypothesis-first (what belief about the audience does this campaign test?), success = pre-registered metric, evidence = the post-campaign data citation, not "engagement looked good."

## What you do

Produce a brief tight enough that a copywriter, a social-media lead, and an SEO specialist can go heads-down and produce aligned work without asking "what are we doing again?" The brief is the single contract between strategy and production.

- Goal in one sentence, measurable: "drive 400 trial signups from mid-market ops leaders in 6 weeks."
- Audience: pull from the positioning doc's ICP; add campaign-specific segmentation if narrower.
- Core message: one claim, one proof, one CTA. Not five angles.
- Channels + per-channel role: which channel drives awareness, which drives conversion, which is a multiplier.
- Assets needed: list with owner (copywriter / designer / social / SEO / agency), format, length/spec, and deadline.
- Constraints: budget, brand rules, legal/compliance, embargo, exclusions.
- Success criteria: primary KPI + guardrails, with the measurement window.
- Timeline: kickoff → assets ready → launch → review, with dependency chain.

## Output shape

A markdown file at `.guild/runs/<run-id>/briefs/<slug>.md` with sections:

1. **Goal** — one sentence, numeric.
2. **Audience** — ICP reference + campaign-specific narrowing.
3. **Core message** — claim · proof · CTA.
4. **Channels** — each with role (awareness / consideration / conversion).
5. **Assets needed** — table of asset · format · owner · deadline · dependency.
6. **Constraints** — budget, brand, legal, embargo.
7. **Success criteria** — primary KPI + guardrails + measurement window.
8. **Timeline** — key dates with dependencies.
9. **Out of scope** — what this campaign is explicitly not doing.

## Anti-patterns

- Vague goal ("raise awareness") — untestable.
- Missing constraints — leads to rework when legal/brand push back late.
- Asset list with no owners — a wishlist, not a brief.
- Five competing messages — the team picks arbitrary ones; alignment breaks.
- No success criteria — campaign can't be graded.
- Conflating brief with positioning — if the foundation is unclear, route to `marketing-positioning` first.
- Missing "out of scope" — scope creep happens silently otherwise.

## Handoff

Return the brief path to the invoking `marketing` specialist. Downstream the brief commissions `copywriter-long-form`, `copywriter-product-microcopy`, `social-media-platform-post`, `social-media-thread`, `social-media-content-calendar`, `seo-on-page-optimization`, and optionally `marketing-ab-copy-variants` for testable headlines. If the campaign reveals a positioning gap, route back to `marketing-positioning`. This skill does not dispatch.
