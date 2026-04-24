---
name: sales-follow-up-sequence
description: Writes post-meeting and post-proposal follow-up cadences — triggered touches with per-step copy, value-add hooks, disposition rules, and a clean exit path. Pulled by the `sales` specialist. TRIGGER: "write the follow-up sequence after the discovery call", "draft the post-proposal follow-up cadence", "build the nudge sequence for stalled deals", "design the follow-up + break-up emails", "write the post-demo follow-up", "set up the follow-up rules for no-reply after proposal". DO NOT TRIGGER for: cold outreach to brand-new prospects (use `sales-cold-outreach`), lifecycle / drip emails to existing customers (use `copywriter-email-sequences`), the discovery framework itself (use `sales-discovery-framework`), the proposal document (use `sales-proposal-writer`), launch announcements (use `marketing-launch-plan`), re-engagement of dormant product users (use `copywriter-email-sequences`).
when_to_use: The parent `sales` specialist pulls this skill when the task is follow-up after a live sales touchpoint — discovery call, demo, proposal, or stalled deal. Also fires on explicit user request.
type: specialist
---

# sales-follow-up-sequence

Implements `guild-plan.md §6.3` (sales · follow-up-sequence) under `§6.4` commercial principles: hypothesis-first (why will this touch move the deal?), success = reply rate and deal-stage advancement, evidence = cadence-level outcome data — not send volume.

## What you do

Produce the cadence that carries a deal from "call went well" to signed — or to a clean disqualify. Follow-up is where most deals actually die; it's won by adding value per touch, not by "bumping this."

- Anchor to the trigger event: post-discovery, post-demo, post-proposal, stalled (no reply X days). Each has a different rhythm.
- Every touch pays for itself with a new piece of value: a case study tied to the buyer's pain, an answer to an objection, a new data point, a framing that reframes internal blockers.
- Set cadence by stage: post-meeting recap within 24h, early nudges close together, later nudges spaced out. Don't badger, don't vanish.
- Write disposition rules: reply received → route; no reply after N → next touch / break-up; objection raised → objection-specific asset; champion goes dark → multi-thread to exec sponsor.
- Include a graceful break-up email — the "closing the loop" note that often surfaces the real status.
- Handle multi-threading: when to loop in exec sponsor, when to bring in technical contact, when to escalate.
- Respect the buyer's stated timeline — following up weekly on a deal with a Q4 budget cycle is noise.

## Output shape

A markdown file at `.guild/runs/<run-id>/sales/followup-<slug>.md` with sections:

1. **Trigger event** — post-discovery / demo / proposal / stall-N-days.
2. **Cadence table** — step · channel · day · purpose · value-add hook.
3. **Per-step copy** — subject / body / CTA, one block per step.
4. **Disposition rules** — reply / no-reply / objection / champion-dark routing.
5. **Multi-threading rules** — when + who to loop in.
6. **Break-up email** — graceful close-the-loop.
7. **Stop conditions** — deal closed / explicit no / time-elapsed.
8. **Success metrics** — reply rate, stage-advance rate, cycle-time impact.

## Anti-patterns

- Monotonous "bumping this" / "just checking in" nudges — signals rep has nothing to say.
- No value-add per touch — the prospect already has one inbox too many.
- Indefinite follow-up — eroding domain reputation and brand, never closing the loop.
- Single-threaded on a multi-stakeholder deal — champion goes on vacation, deal dies.
- Ignoring the buyer's stated timeline — looks tone-deaf.
- Over-apologizing filler ("sorry to bother you again") — subtracts authority with every send.
- Same cadence for every trigger — post-proposal rhythm ≠ post-discovery rhythm.

## Handoff

Return the sequence path to the invoking `sales` specialist. Downstream, positive replies route back into `sales-proposal-writer` (updated proposal), `sales-discovery-framework` (deeper qualification), or deal-closing workflow; dead deals with product fit route to `copywriter-email-sequences` for a nurture track. If follow-up repeatedly surfaces an objection class, flag back to `marketing-positioning`. This skill does not dispatch.
