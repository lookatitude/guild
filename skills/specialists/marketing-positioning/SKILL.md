---
name: marketing-positioning
description: Authors a positioning statement — ICP, category frame, unique value, competitive alternatives, and a sharp "not-for" list. Pulled by the `marketing` specialist. TRIGGER: "write our positioning", "sharpen the positioning statement", "define the ICP and value props", "position us against <competitor>", "what category do we compete in", "draft the messaging house / positioning doc". DO NOT TRIGGER for: writing the actual page or ad copy (use `copywriter-long-form` / `copywriter-product-microcopy`), a platform-native post (use `social-media-platform-post`), keyword research (use `seo-keyword-research`), a launch timeline (use `marketing-launch-plan`), a campaign brief that commissions work (use `marketing-campaign-brief`), sales outreach copy (use `sales-cold-outreach`).
when_to_use: The parent `marketing` specialist pulls this skill when the task requires establishing or revising strategic positioning before downstream copy, launch, or GTM work. Also fires on explicit user request.
type: specialist
---

# marketing-positioning

Implements `guild-plan.md §6.3` (marketing · positioning) under `§6.4` commercial principles: hypothesis-first (which ICP + category bet are we making?), success = measurable outcome (conversion, segment win rate), evidence = customer quotes, win/loss data, category analysis — not adjectives.

## What you do

Produce a positioning statement tight enough that every downstream asset — site copy, launch, sales deck, campaigns — can be traced back to one source of truth. Positioning is a bet, not a description. Name the bet.

- Define the ICP with firmographic + behavioral precision: role, company stage, trigger event, status quo pain. "SMBs" is not an ICP.
- Name the market category explicitly — the frame the buyer uses to compare. Category choice determines competitive set.
- List competitive alternatives, including status-quo ("doing nothing in a spreadsheet"), not just named vendors.
- State the unique value as a capability + outcome pair, not a feature list. "Auto-reconciles in under a minute" beats "AI-powered reconciliation."
- Provide proof: customer quotes, benchmark numbers, third-party data. Un-cited claims are vapor.
- Write a "not-for" list — who this is explicitly wrong for. Vague ICPs dilute every message downstream.

## Output shape

A markdown file at `.guild/runs/<run-id>/positioning/<slug>.md` with sections:

1. **For whom** — ICP with firmographic + trigger + status quo.
2. **The problem** — the pain the ICP feels today, cited.
3. **Category** — the frame / market we compete in and why.
4. **Unique value** — capability → outcome, 2–4 items, each provable.
5. **Competitive alternatives** — named vendors + status quo, with our frame vs each.
6. **Proof** — quotes, data points, case studies with source.
7. **Not for** — who this is explicitly wrong for.
8. **Open bets** — positioning hypotheses still unvalidated.

Keep under ~300 lines. If it sprawls, the positioning is still fuzzy.

## Anti-patterns

- Feature-led positioning: "We have SSO and webhooks" is not a position.
- Vague ICP: "growing teams" is untargetable.
- Category avoidance: "we're a new kind of thing" leaves the buyer with no frame.
- Superlative soup: "best-in-class, enterprise-grade, AI-native" — zero information.
- No "not-for": signals the team wants to sell to everyone, which means no one.
- Un-cited proof: "customers love it" without a quote or number.
- Confusing positioning with a tagline — the tagline is downstream output.

## Handoff

Return the positioning doc path to the invoking `marketing` specialist. Downstream this seeds `marketing-launch-plan`, `marketing-campaign-brief`, `copywriter-voice-guide`, `sales-cold-outreach`, and `sales-discovery-framework`. If the positioning exposes a product gap, flag back to the `marketing` specialist for routing — this skill does not dispatch.
