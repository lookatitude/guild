---
name: sales-cold-outreach
description: Writes cold outbound sequences (email + LinkedIn) targeted to a named ICP, with per-step copy, cadence, triggers, and a stated value hypothesis per touch. Pulled by the `sales` specialist. TRIGGER: "write a cold outreach sequence to <ICP>", "draft the cold email + LinkedIn cadence for <segment>", "build a prospecting sequence for the new product", "write outbound to VP Finance accounts", "design the 7-touch cold sequence", "draft the LinkedIn connect + follow-up for enterprise accounts". DO NOT TRIGGER for: lifecycle / onboarding / drip emails to existing users (use `copywriter-email-sequences`), post-meeting or post-proposal follow-up (use `sales-follow-up-sequence`), a proposal document (use `sales-proposal-writer`), a discovery-call framework (use `sales-discovery-framework`), a launch plan (use `marketing-launch-plan`).
when_to_use: The parent `sales` specialist pulls this skill when the task is outbound prospecting to cold accounts who have not yet engaged. Also fires on explicit user request.
type: specialist
---

# sales-cold-outreach

Implements `guild-plan.md §6.3` (sales · cold-outreach) under `§6.3`/`§6.4` commercial principles: hypothesis-first (what trigger/pain/value-claim are we betting on per touch?), success = reply rate and qualified meeting rate, evidence = cadence-level data — not "we sent 500 emails."

## What you do

Produce a sequence that a rep can run on Monday. Each touch earns the next one by saying something the prospect hasn't already heard from ten other vendors. "Just checking in" is a waste of a send.

- Anchor to the ICP + trigger: who is this person, why now. If the ICP is vague, stop and route to `marketing-positioning`.
- State the value hypothesis — the single claim each step is making. Different steps can make different claims; none can be empty.
- Set the cadence: email 1 · +2d LinkedIn connect · +3d email 2 · etc. Spell out business-day math and channel mix.
- Per step: channel, subject (for email), first line (personalization anchor), body, single CTA, send time. No meandering PS lines.
- Personalization: tie to a real signal — hiring trend, funding, product launch, stack detection, public quote. Not `{{firstName}}` plus city.
- Include a break-up / bump-out final step. Indefinite follow-up erodes deliverability and brand.
- Reply-handling notes: objection → next-step routing (not a full playbook, but enough to unblock).

## Output shape

A markdown file at `.guild/runs/<run-id>/outbound/<slug>.md` with sections:

1. **ICP + trigger** — persona, company shape, buying signal.
2. **Value hypothesis** — the headline claim we're betting on.
3. **Cadence table** — step · channel · day · purpose · KPI.
4. **Per-step copy** — subject / connect note / body / CTA, one block per step.
5. **Personalization variables** — what the rep fills in and where to source it.
6. **Reply routing** — positive / objection / opt-out next steps.
7. **Deliverability notes** — send windows, volume caps, domain warmup if relevant.
8. **Success metrics** — reply rate, meeting rate, target baseline.

## Anti-patterns

- Generic templates with `{{firstName}}` and nothing else — gets filtered and ignored.
- "Just checking in" / "bumping this" filler steps with no new value.
- No value hypothesis — the rep can't explain why this touch exists.
- Missing opt-out / break-up — sequences that run forever kill domain reputation.
- Claims the product can't back — inflated ROI stats, fake case studies.
- One-channel cadence on a multi-channel buyer — missing the medium they actually read.
- Using lifecycle-email tone (warm, brand-y) on cold outreach — sounds like marketing spam.

## Handoff

Return the sequence path to the invoking `sales` specialist. Downstream, positive replies flow into `sales-discovery-framework`; after a meeting, `sales-follow-up-sequence` takes over; deal-stage asset creation goes to `sales-proposal-writer`. If outreach surfaces a positioning gap, route back to `marketing-positioning`. This skill does not dispatch.
