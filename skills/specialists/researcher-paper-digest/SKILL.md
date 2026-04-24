---
name: researcher-paper-digest
description: Summarizes a single academic paper or long-form article with a critical read — Problem / Approach / Results / Limitations / Relevance. Output: `.guild/runs/<run-id>/research/digests/<slug>.md`. Pulled by the `researcher` specialist. TRIGGER: "summarize this paper", "digest this arxiv link", "what does this paper say", "give me the TL;DR on this PDF", "break down this research article", "read this whitepaper and summarize". DO NOT TRIGGER for: open-ended topic research spanning multiple sources (use `researcher-deep-dive`), N-way option comparison (use `researcher-comparison-table`), rewriting the paper as marketing copy (copywriter), producing user-facing docs from it (technical-writer), technical blog post from the paper (copywriter-long-form).
when_to_use: The parent `researcher` specialist pulls this skill when a specific paper, preprint, whitepaper, or long article needs a critical summary the team can cite. Also fires on explicit user request.
type: specialist
---

# researcher-paper-digest

Implements `guild-plan.md §6.1` (researcher · paper-digest) under `§6.4` engineering principles: evidence is a digest the team can read in 10 minutes and cite with confidence — not a paraphrase of the abstract.

## What you do

Read the paper critically and produce a structured digest that lets a busy reader decide whether it's worth the full read. Capture what the paper actually claims, what it demonstrates, and where it is weak.

- Identify the **Problem** the paper sets up — in one paragraph, in the reviewer's own words.
- Describe the **Approach** concretely — architecture, dataset, method. Not "they use a neural network" but "they fine-tune a 7B Llama on 50k synthetic traces."
- Summarize **Results** with the headline numbers and the baselines they beat or match.
- Call out **Limitations** — both those the authors admit and those you noticed (dataset size, cherry-picked benchmarks, missing ablations).
- State **Relevance to us** — one paragraph on whether/how this should change what we build.

## Output shape

Markdown file at `.guild/runs/<run-id>/research/digests/<slug>.md`:

1. **Citation** — authors · title · venue/arxiv ID · year · URL.
2. **TL;DR** — 3 bullets.
3. **Problem**.
4. **Approach**.
5. **Results**.
6. **Limitations** — authors' + yours.
7. **Relevance to us**.
8. **Quotes worth keeping** — 2–4 verbatim quotes with page/section refs, for later citation.

Target 150–400 lines of markdown depending on paper length.

## Anti-patterns

- Whole-paper rewrite — a digest that's as long as the paper missed the point.
- No critical read — parroting the abstract as the findings.
- Cherry-picking findings — highlighting only the numbers that support a preferred conclusion.
- Missing limitations — every paper has them; a digest without any is a press release.
- No relevance section — "interesting paper" without a "so what" is notes, not a digest.
- Fabricated quotes or numbers — if you're not sure, say you're not sure.

## Handoff

Return the digest path to the invoking `researcher` specialist. If the digest feeds into a broader comparison, the researcher chains into `researcher-comparison-table`; if it supports a larger topic brief, into `researcher-deep-dive`. This skill does not dispatch.
