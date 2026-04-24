---
name: social-media-content-calendar
description: Builds a content calendar across platforms — dated entries with platform, topic, format, owner, status, cross-pollination notes, and weekly themes. Output: calendar.md or YAML. Pulled by the `social-media` specialist. TRIGGER: "build a content calendar for next month", "plan the social calendar across Twitter/LinkedIn/IG", "draft a 6-week content calendar", "map out launch week social", "plan weekly content themes", "create the editorial calendar for social". DO NOT TRIGGER for: a single post (use `social-media-platform-post`), a thread (use `social-media-thread`), engagement/reply templates (use `social-media-engagement-templates`), blog editorial calendar for long-form (copywriter-long-form handles long-form; this skill is social-native), launch-plan PR/campaign strategy (marketing-launch-plan), SEO content gap mapping (seo-keyword-research).
when_to_use: The parent `social-media` specialist pulls this skill when the task is multi-week, multi-platform planning rather than producing specific posts. Also fires on explicit user request.
type: specialist
---

# social-media-content-calendar

Implements `guild-plan.md §6.2` (social-media · content-calendar) under `§6.4` writing principles: match existing cadence and voice, don't rewrite in-flight content, evidence = a calendar a CM can work from Monday morning without asking follow-ups.

## What you do

Produce a dated, platform-aware calendar that a team can execute. A good calendar balances three things — themes (what we want to be known for), cross-pollination (one source of content feeding multiple posts), and capacity (what the team can actually make).

- Start with themes: 2–4 themes per month, rotated weekly. "Education", "customer proof", "product", "team" are typical.
- Map sources to destinations: one blog post → 1 LinkedIn carousel + 1 X thread + 1 IG post. Cross-pollination is explicit, not implied.
- Schedule by weekday cadence, not hour-by-hour — the calendar is strategic, not a scheduler.
- Every entry carries: date, platform, theme, topic, format (post / thread / carousel / video / reel), owner, status (draft / review / scheduled / live), source link.
- Reserve slots for reactive content — trends, launches, customer stories — don't over-book.
- Call out platform mix: the ratio of X to LinkedIn to IG should reflect audience, not habit.

## Output shape

YAML or markdown calendar:

```
- date: 2026-05-04
  platform: linkedin
  theme: customer-proof
  topic: Acme case study — cut onboarding 5x
  format: carousel
  owner: alex
  status: draft
  source: blog/acme-case-study
  cross_post:
    - date: 2026-05-05
      platform: x
      format: thread
```

Plus a 1-paragraph summary: monthly themes, platform mix, capacity notes, open slots.

Store at `.guild/runs/<run-id>/social/calendar-<range>.md` or `.guild/wiki/products/social-calendar.md`.

## Anti-patterns

- Over-scheduling — 5 posts a day across 3 platforms dies by week 2.
- No cross-pollination — every post starts from scratch, burning the team.
- Missing themes — calendar becomes a random idea dump.
- Rigid to the point of blocking reactive posts — leave slots.
- No owner per entry — everything gets dropped.
- Ignoring platform cadence norms (daily on X, 2–3x weekly on LinkedIn, less on IG unless you have a visual pipeline).

## Handoff

Return the calendar path to the invoking `social-media` specialist. For each scheduled slot, downstream work hands off to `social-media-platform-post` (single posts) or `social-media-thread` (series). If the calendar surfaces a launch moment, coordinate with `marketing-launch-plan`. This skill does not dispatch.
