---
name: social-media-platform-post
description: Writes a single platform-native post — Twitter/X, LinkedIn, Instagram, Threads, Bluesky — with post copy matched to platform norms, a media plan (image/video spec), and hashtag set. Pulled by the `social-media` specialist. TRIGGER: "write a tweet about X", "draft a LinkedIn post on Y", "write an Instagram caption for the product shot", "draft a Threads post announcing Z", "write a platform-native post for X", "draft the Bluesky post". DO NOT TRIGGER for: multi-post threads or carousels (use `social-media-thread`), reply/DM templates for community management (use `social-media-engagement-templates`), multi-week calendar planning (use `social-media-content-calendar`), long-form blog copy (copywriter-long-form), launch announcement strategy (marketing-launch-plan), SEO meta/title tags (seo-on-page-optimization).
when_to_use: The parent `social-media` specialist pulls this skill when the task is one post for one platform. Also fires on explicit user request.
type: specialist
---

# social-media-platform-post

Implements `guild-plan.md §6.2` (social-media · platform-post) under `§6.4` writing principles: match the platform's native voice and the brand voice simultaneously, don't rewrite other channels, evidence = a post that reads right to someone who only uses that platform.

## What you do

Write one post for one platform, styled to that platform's norms. Cross-posting identical copy across Twitter, LinkedIn, and Instagram is the tell of a team who doesn't use the platforms.

- Read the ask: platform, goal (awareness / engagement / click / save), audience segment, constraints.
- Match platform norms: X = punchy, thread-friendly; LinkedIn = POV + whitespace; IG = caption + visual-led; Threads = conversational; Bluesky = native-web tone.
- Hook in line one. If the first 5 words don't earn the scroll-stop, rewrite them.
- One idea per post. Multiple ideas belong in a thread (see `social-media-thread`).
- Media plan: image/video spec, alt text, aspect ratio, any on-frame text.
- Hashtags: platform-appropriate count (IG: 3–10 focused, LinkedIn: 2–4, X: 0–2), niche > broad.
- Call out posting window and whether a reply/pinned-comment is part of the plan.

## Output shape

Markdown block per post:

```
### [Platform] · [Goal]
Hook: <first line>
Body: <post copy>
CTA: <action or "-">
Media: <image/video spec + alt text>
Hashtags: <#a #b #c>
Best time: <window>
Follow-up: <pinned reply / none>
```

Store at `.guild/runs/<run-id>/social/post-<slug>.md` if tracked.

## Anti-patterns

- Cross-posting identical copy across platforms — reads as generic everywhere.
- Missing platform norms: LinkedIn "hacks" (huge line breaks, bait hooks) on X, or X brevity on LinkedIn.
- Generic hashtags (`#marketing #growth #startup`) that add zero discoverability.
- No alt text on image posts — accessibility and reach both suffer.
- Buried CTA inside a wall of body copy.
- Trying to be funny in a brand voice that isn't — voice mismatch travels further than the joke.

## Handoff

Return the post path to the invoking `social-media` specialist. If the ask expands to a series, chain into `social-media-thread`. If it feeds a campaign, hand off to `social-media-content-calendar`. For community-management templates, chain into `social-media-engagement-templates`. This skill does not dispatch.
