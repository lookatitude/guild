---
name: social-media-engagement-templates
description: Builds a reusable reply / DM / comment template library for community management — tagged by use-case (welcome, feature request, complaint, praise, press inquiry, outage), with personalization slots and escalation rules. Pulled by the `social-media` specialist. TRIGGER: "draft reply templates for community managers", "build a DM template library", "write canned replies for common support tickets on social", "create engagement templates for our CX team", "draft the complaint-reply playbook", "write templates for handling feature requests on Twitter". DO NOT TRIGGER for: a single post (use `social-media-platform-post`), a thread (use `social-media-thread`), calendar planning (use `social-media-content-calendar`), support-ticket macros inside a help desk (that's a support-ops concern, not social), sales outreach or follow-up (sales group), lifecycle email copy (copywriter-email-sequences).
when_to_use: The parent `social-media` specialist pulls this skill when the task is building reusable response patterns for a community/CX team on social surfaces. Also fires on explicit user request.
type: specialist
---

# social-media-engagement-templates

Implements `guild-plan.md §6.2` (social-media · engagement-templates) under `§6.4` writing principles: match brand voice exactly (templates scale voice — good or bad), don't rewrite outbound copy, evidence = a CM can respond to 10 representative inbound messages using the library without sounding like a robot.

## What you do

Build a library of reply, DM, and comment templates tagged by use-case. The library is a scaffold, not a script — every template leaves room for the CM to personalize.

- Start with the top inbound use cases. Ask for historical samples; if unavailable, propose a canonical set (welcome, thanks, praise, complaint, bug report, feature request, press/partner inquiry, outage, out-of-scope).
- Each template: trigger (what kind of message it answers), personalization slots (`{{name}}`, `{{product_area}}`, `{{ticket_link}}`), variant count, escalation rule.
- Tone varies by use-case: complaints get acknowledgment-first, praise gets specific thanks (not generic), press inquiries get routing.
- Include at least 2 variants per use-case so the library doesn't rubber-stamp the feed.
- Define escalation explicitly — when does a CM stop replying and route to eng, legal, exec, security?
- Call out platform differences: public reply vs DM vs hidden reply. What stays public, what goes private.

## Output shape

YAML or markdown table keyed by use-case:

```
- use_case: complaint-bug
  triggers: [user reporting something broken, clear repro]
  channel: reply-then-DM
  variants:
    - "Thanks for flagging this, {{name}} — we can reproduce it. Fix in progress, tracking at {{ticket_link}}."
    - "Appreciate the report, {{name}}. Team's on it; I'll DM when we have an update."
  escalate_when: [data-loss implied, legal wording, >3 users affected]
  escalate_to: engineering-oncall
```

Store at `.guild/runs/<run-id>/social/engagement-<slug>.md` or `.guild/wiki/standards/social-engagement.md`.

## Anti-patterns

- Rubber-stamp tone: every reply starts with "Thanks for reaching out!" — users notice.
- No personalization slots — the CM can't make it their own without rewriting.
- Slow-roll templates that buy time without giving information ("We're looking into it!" with no ETA for weeks).
- Missing escalation rules — the CM handles things they shouldn't.
- Ignoring the channel split (public reply vs DM) — private issues get aired in the timeline.
- One-variant libraries — repetition is visible in the feed within a week.

## Handoff

Return the library path to the invoking `social-media` specialist. If the library surfaces recurring issues (same bug, same confusion), raise followups for the owning engineering or product specialist. If a use-case escalates beyond social (legal, outage comms), hand off to the relevant specialist. This skill does not dispatch.
