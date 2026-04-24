---
name: copywriter-email-sequences
description: Writes lifecycle, onboarding, transactional, re-engagement, and drip email sequences — the sequence plan (triggers, timing, branching) plus per-email subject, preview, and body copy. Pulled by the `copywriter` specialist. TRIGGER: "write the onboarding email sequence", "draft the welcome drip", "write the re-engagement emails for dormant users", "draft the trial-ending sequence", "write the transactional email copy for X", "design the lifecycle email flow". DO NOT TRIGGER for: cold outbound or prospecting sequences (use `sales-cold-outreach`), sales follow-up after a booked call (use `sales-follow-up-sequence`), long-form blog content (use `copywriter-long-form`), in-product strings (use `copywriter-product-microcopy`), launch announcement strategy (marketing-launch-plan), social media posts (social-media-platform-post).
when_to_use: The parent `copywriter` specialist pulls this skill when the task is a triggered email series sent to existing users/customers — not cold prospecting. Also fires on explicit user request.
type: specialist
---

# copywriter-email-sequences

Implements `guild-plan.md §6.2` (copywriter · email-sequences) under `§6.4` writing principles: match existing voice, don't rewrite adjacent campaigns, evidence = a sequence a lifecycle PM can read top-to-bottom and approve.

## What you do

Produce the sequence plan and the copy for every email in it. A sequence is a decision tree, not a list — the plan spells out what triggers each send, what delays it, what branches it, and what stops it.

- Define the entry trigger concretely: `event: signup.completed`, `user.lastLogin > 30d`. Vague triggers ("when inactive") are a bug.
- Specify timing as offsets from the trigger (`+0h`, `+24h`, `+7d`) and goal of each send.
- Branch where behavior matters: opened-but-didn't-click vs never-opened vs completed-action get different next sends.
- Every email: subject (primary), subject A/B variant, preview text, body, single CTA, unsubscribe footer.
- Personalize beyond `{{firstName}}` — use behavior, plan, account age. Generic `your account` copy is a tell.
- State stop conditions: conversion, unsubscribe, hard-bounce, manual suppression.

## Output shape

Markdown with two layers:

1. **Sequence plan** — table of step · delay · trigger · goal · branch-out.
2. **Per-email copy** — one block per step:
   ```
   ### Step 2 · +24h · Onboarding checklist nudge
   Subject: Three things to finish setting up
   Preview: Takes about 4 minutes — here's the shortest path.
   Body: ...
   CTA: Finish setup → {{appUrl}}/onboarding
   ```

Include subject A/B variants where testing makes sense. Store at `.guild/runs/<run-id>/copy/emails-<slug>.md` if tracked.

## Anti-patterns

- Generic "your account" language with no behavioral signal.
- Reusing the same subject line across a sequence — inbox fatigue is instant.
- Missing unsubscribe footer or compliance language (CAN-SPAM / GDPR).
- No stop condition, so users who already converted keep getting nudges.
- Multiple competing CTAs — one primary per email.
- Cold-outreach tone on lifecycle emails (these people already know you).

## Handoff

Return the sequence path to the invoking `copywriter` specialist. Lifecycle/marketing hands off to the ESP for wiring; cold outreach goes to `sales-cold-outreach` (this skill does not cover that). If the sequence surfaces voice drift, chain into `copywriter-voice-guide`. This skill does not dispatch.
