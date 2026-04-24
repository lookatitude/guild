---
name: social-media-thread
description: Writes a multi-post thread or carousel — Twitter/X threads, LinkedIn carousels, Threads chains, Instagram carousels — with thread outline, a hook that earns the click, per-post copy, and a closing CTA. Pulled by the `social-media` specialist. TRIGGER: "write a Twitter thread on X", "draft a LinkedIn carousel about Y", "turn this into a 10-post thread", "write a carousel explaining Z", "write a thread walking through the decision", "draft the LinkedIn carousel slides". DO NOT TRIGGER for: single posts (use `social-media-platform-post`), reply/DM templates (use `social-media-engagement-templates`), calendar planning (use `social-media-content-calendar`), long-form blog posts (copywriter-long-form), user-facing tutorial docs (technical-writer-tutorial), sales follow-up sequences (sales-follow-up-sequence).
when_to_use: The parent `social-media` specialist pulls this skill when the task requires more than one post connected in a series. Also fires on explicit user request.
type: specialist
---

# social-media-thread

Implements `guild-plan.md §6.2` (social-media · thread) under `§6.4` writing principles: match platform norms for serial content, don't rewrite adjacent single posts, evidence = a thread whose first post earns the read and last post pays it off.

## What you do

Write a serial piece of social content that stands up across its full length. A thread is not a chopped-up essay; each post must hold alone, and the whole must build.

- Decide the payoff first — what does the reader leave with? If you can't state it in one sentence, don't start.
- Hook post has to do one job: earn the second post. Promise the payoff, don't spoil it.
- Outline every post before drafting. Each post = one idea + one line of earned attention into the next.
- Last post closes: restate the payoff, name the CTA (follow, save, link, reply prompt).
- LinkedIn carousels: slide count, title + body per slide, visual spec per slide, final-slide CTA.
- X/Threads/Bluesky threads: number posts in the draft (1/N), respect platform character limits, avoid orphan sentences mid-thread.

## Output shape

Markdown with:

1. **Platform + goal** — one line.
2. **Payoff** — one sentence on what the reader gets.
3. **Hook** — the first post in full.
4. **Thread outline** — numbered, one line per post.
5. **Per-post copy** — every post written out, numbered (1/N).
6. **Closer + CTA** — final post.
7. **Media plan** — if any post carries an image/video, spec + alt text.

Store at `.guild/runs/<run-id>/social/thread-<slug>.md` if tracked.

## Anti-patterns

- Buried lede: the hook post is a setup instead of a promise.
- Cliffhanger abuse: "you won't believe what happens next" at every post break.
- No CTA — the thread ends and the reader has nowhere to go.
- One idea stretched across ten posts with no progression.
- Carousel slides with title-only and no body text — dies in the feed.
- Mismatched voice between the hook (punchy) and body (formal) — the read breaks.

## Handoff

Return the thread path to the invoking `social-media` specialist. If the payoff deserves long-form treatment, chain into `copywriter-long-form`. If the thread is part of a launch, hand off to `social-media-content-calendar` and coordinate with `marketing-launch-plan`. This skill does not dispatch.
