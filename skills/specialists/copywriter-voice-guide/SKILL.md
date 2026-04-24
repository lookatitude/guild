---
name: copywriter-voice-guide
description: Authors or refreshes a brand voice guide — principles, do/don't examples, sample rewrites, tone-by-surface matrix. Output is a `voice.md` the whole team writes against. Pulled by the `copywriter` specialist. TRIGGER: "write our brand voice guide", "define the voice and tone", "create the voice doc for the product", "document how we sound in emails vs support vs marketing", "refresh our tone guidelines", "write the voice principles". DO NOT TRIGGER for: writing a specific long-form piece (use `copywriter-long-form`), writing in-product strings (use `copywriter-product-microcopy`), email sequence copy (use `copywriter-email-sequences`), positioning / category narrative (marketing-positioning), style-guide for engineering docs (technical-writer group).
when_to_use: The parent `copywriter` specialist pulls this skill when the task is creating or refreshing the voice standard that other writing skills match against. Also fires on explicit user request.
type: specialist
---

# copywriter-voice-guide

Implements `guild-plan.md §6.2` (copywriter · voice-guide) under `§6.4` writing principles: evidence = concrete before/after samples a writer can imitate, not adjectives that sound good in a slide.

## What you do

Write a voice guide short enough that a new hire reads it on day one and uses it on day two. The guide is the source of truth other writing skills pull from — make it specific enough to decide close calls.

- Pull existing voice samples from live product copy, top-performing posts, and CEO comms before proposing principles. Voice is discovered, not invented.
- State 3–5 principles, each one sentence, each with a concrete example.
- Show do/don't pairs — the "don't" must be a believable mistake, not a strawman.
- Ship a tone-by-surface matrix: marketing page vs in-product vs support vs legal. The voice doesn't change; the tone does.
- Include sample rewrites — take an off-voice sentence and fix it. Rewrites teach, adjectives don't.
- Place the output at `.guild/wiki/standards/writing-voice.md` if wiki is active, so other skills can read it.

## Output shape

A markdown file with:

1. **Who we sound like** — one paragraph.
2. **Principles** — 3–5 named principles, each with an example.
3. **Tone by surface** — matrix: marketing · product · support · legal · social.
4. **Do / don't** — pairs grouped by category (word choice, sentence length, formality).
5. **Sample rewrites** — 5–8 before/after pairs.
6. **Edge cases** — errors, destructive actions, apologies, outages.

Keep under ~400 lines. Longer guides get ignored.

## Anti-patterns

- Vague adjectives: "friendly but professional, confident but humble" — could describe any brand.
- No examples — principles without samples are unenforceable.
- Prescriptive to the point of paralysis: banning every adverb kills voice instead of sharpening it.
- Copying a competitor's voice guide. The point is differentiation.
- Skipping edge cases (errors, legal, outages) — that's exactly where voice breaks down.
- One-time artifact with no update path — voice guides drift; name an owner.

## Handoff

Return the voice-guide path (prefer `.guild/wiki/standards/writing-voice.md`). Downstream writing skills (`copywriter-long-form`, `copywriter-product-microcopy`, `copywriter-email-sequences`, `technical-writer-*`, `social-media-*`) read this file. If the guide surfaces brand positioning questions, chain to `marketing-positioning`. This skill does not dispatch.
