---
name: copywriter-long-form
description: Writes long-form marketing copy — blog posts, case studies, thought-leadership pieces, landing-page longform — with a clear angle, an intro-body-CTA arc, and H1/H2 scaffolding a reader can scan. Pulled by the `copywriter` specialist. TRIGGER: "write a blog post about X", "draft a case study on X", "write a long-form piece on X", "turn this into a 1200-word article", "write the thought-leadership piece", "draft the landing page long-form". DO NOT TRIGGER for: in-product strings / buttons / error messages (use `copywriter-product-microcopy`), lifecycle or onboarding emails (use `copywriter-email-sequences`), defining the brand voice itself (use `copywriter-voice-guide`), user-facing product documentation (technical-writer-user-manual), how-to walkthroughs (technical-writer-tutorial), platform-native social posts (social-media-platform-post), launch positioning / GTM narratives (marketing-positioning), cold outreach sequences (sales-cold-outreach).
when_to_use: The parent `copywriter` specialist pulls this skill when the task needs a standalone long-form asset with a defined angle and structure. Also fires on explicit user request.
type: specialist
---

# copywriter-long-form

Implements `guild-plan.md §6.2` (copywriter · long-form) under `§6.4` writing principles: match existing voice, don't rewrite adjacent prose, evidence = a scannable sample the user can skim in under a minute.

## What you do

Produce one long-form piece built around a single angle the reader can repeat after closing the tab. The draft is ready to review, not ready to publish — expect a voice pass and a fact-check loop before it ships.

- Lead with the angle in one sentence before you start writing. If it doesn't survive contact with the outline, the piece has no point of view yet.
- Pull voice from `.guild/wiki/standards/writing-voice.md` and `standards/branding.md` if they exist; match their tone rather than re-inventing one.
- Structure with a working H1, 3–6 H2s, and short H3s only where a scan would miss them otherwise.
- Intro earns the read (stakes, not throat-clearing). Body pays off the angle with evidence. CTA asks for one next action.
- Cite sources inline where a claim would otherwise sound made up.

## Output shape

A markdown file with:

1. **Frontmatter** (optional) — angle, audience, CTA target.
2. **H1** — headline the reader would click.
3. **Intro** — 2–4 short paragraphs; stakes + promise.
4. **H2 sections** — each advances the angle; no filler.
5. **Conclusion + CTA** — one action the reader can take.

Store at `.guild/runs/<run-id>/copy/<slug>.md` if tracked. Keep the whole piece under ~1500 words unless the brief explicitly calls for more.

## Anti-patterns

- Padding: "In today's fast-paced world" and similar openers add length, not value.
- No angle: a piece that could be written by anyone about anything is a piece nobody reads.
- Off-voice: borrowing a tone from a competitor instead of matching the brand's existing voice.
- Stacked H2s with no H3/paragraph breathing room — scannability dies fast.
- CTA roulette: three competing asks at the end. Pick one.
- Rewriting adjacent page copy the brief didn't ask about.

## Handoff

Return the draft path to the invoking `copywriter` specialist. Downstream, the copywriter typically chains into `copywriter-voice-guide` if the voice is unclear, or hands off to `seo-on-page-optimization` once the draft is locked. For user-facing product docs or how-tos, the copywriter hands off to `technical-writer`. This skill does not dispatch.
