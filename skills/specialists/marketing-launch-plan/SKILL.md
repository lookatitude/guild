---
name: marketing-launch-plan
description: Plans a product or feature launch across channels with a pre-registered metric stack, asset list, timeline (pre-launch, launch day, sustain), and per-channel owners. Pulled by the `marketing` specialist. TRIGGER: "plan the launch for <feature>", "draft the GTM launch plan", "what's our launch timeline and channel mix", "build the pre-launch → sustain plan", "coordinate the v2 launch across channels", "set up the launch success metrics". DO NOT TRIGGER for: positioning / ICP / category work (use `marketing-positioning`), a single campaign brief commissioning one piece (use `marketing-campaign-brief`), writing the announcement post itself (use `copywriter-long-form` or `social-media-platform-post`), release notes for engineers (use `technical-writer-release-notes`), sales enablement outreach (use `sales-cold-outreach`), A/B copy tests (use `marketing-ab-copy-variants`).
when_to_use: The parent `marketing` specialist pulls this skill when the task is coordinating a multi-channel launch with a timeline and metric pre-registration. Also fires on explicit user request.
type: specialist
---

# marketing-launch-plan

Implements `guild-plan.md §6.3` (marketing · launch-plan) under `§6.4` commercial principles: hypothesis-first (what does "this launch worked" mean before we ship?), success = pre-registered metrics, evidence = channel-level data after the fact — never "felt like a good launch."

## What you do

Produce the launch plan the team executes from — not a brainstorm, not a checklist. Every channel has an owner, a deliverable, a date, and a success metric. Every metric is defined before launch so post-mortems can't be rewritten.

- Anchor to the positioning doc. If one doesn't exist, stop and route to `marketing-positioning` first.
- Set the launch goal in outcome terms: trial signups, pipeline generated, press impressions, community activation. Pick one primary.
- Segment audiences: existing users, new prospects, press/analysts, community, partners. Each gets a distinct angle.
- Plan three phases — pre-launch (teasing, waitlist, briefings), launch day (moment), sustain (weeks 1–4 drumbeat). Launch-day-only plans die on day 2.
- For each channel (email, blog, social, PR, community, paid, partner, in-product), specify asset, owner, ship date, dependency, and success metric.
- Pre-register metrics and the measurement window. Define "good" and "great" thresholds before launch.
- Name the risks: competitor announcement, infra outage, press embargo leak — and the mitigation.

## Output shape

A markdown file at `.guild/runs/<run-id>/launch/<slug>.md` with sections:

1. **Goal** — one primary outcome + 2–3 secondaries, each numeric.
2. **Audiences** — segments + per-segment angle.
3. **Phases** — pre-launch / launch-day / sustain, dated.
4. **Channels table** — channel · asset · owner · ship date · dependency · metric.
5. **Asset checklist** — what must exist by which date.
6. **Success metrics** — primary + guardrails, with measurement window.
7. **Risks + mitigations** — top 3–5.
8. **Post-launch review date** — when we grade the hypothesis.

## Anti-patterns

- Launch-day-only plan — the moment matters less than the sustain drumbeat.
- No metric pre-registration — invites "the launch was a success" handwaving.
- Channel cargo cult — a Product Hunt post for B2B enterprise, a press release for a dev tool, etc. Channel must match audience.
- Asset list with no owners or dates — wishlist, not plan.
- One angle for all audiences — existing users don't need the "what is it" pitch.
- Ignoring dependencies — content shipping before the product is ready, or vice versa.

## Handoff

Return the launch-plan path to the invoking `marketing` specialist. Downstream this commissions `marketing-campaign-brief` (per-campaign), `copywriter-long-form` (announcement), `social-media-platform-post` / `social-media-thread` (social), `technical-writer-release-notes` (engineering changelog), and `sales-cold-outreach` (outbound enablement). If the launch depends on infra or rollout work, the `marketing` specialist hands to `devops` / `backend` — this skill does not dispatch.
