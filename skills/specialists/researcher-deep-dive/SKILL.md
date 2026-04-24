---
name: researcher-deep-dive
description: Produces a structured research brief on a topic — key findings, sources, confidence-per-claim, open questions. Output: `.guild/runs/<run-id>/research/<slug>.md`. Pulled by the `researcher` specialist. TRIGGER: "research X", "do a deep dive on X", "what's the state of the art on X", "give me a research brief on X", "investigate X and summarize findings", "gather sources on X". DO NOT TRIGGER for: summarizing a single known paper (use `researcher-paper-digest`), N-option side-by-side comparison (use `researcher-comparison-table`), architecture decision capture (architect-adr-writer), scoring two architecture options for a specific project choice (architect-tradeoff-matrix), generating marketing/SEO keyword lists (seo group).
when_to_use: The parent `researcher` specialist pulls this skill when the task requires open-ended investigation of a topic with multiple sources and a confidence-calibrated synthesis. Also fires on explicit user request.
type: specialist
---

# researcher-deep-dive

Implements `guild-plan.md §6.1` (researcher · deep-dive) under `§6.4` engineering principles: evidence is the source list — every non-trivial claim cites a source with a URL and a confidence label.

## What you do

Synthesize what is actually known about a topic from multiple sources, separate claims by confidence, and surface the open questions the team still has to answer. The brief is scannable in five minutes and auditable in thirty.

- Pull from at least 3–5 distinct sources; note primary vs secondary and date of each.
- Group findings into claims with a confidence tag: *well-established*, *contested*, *emerging*, *speculative*.
- Quote exactly when a claim is load-bearing — paraphrase only when safe.
- Distinguish what is known from what is inferred; flag inferences.
- End with explicit open questions the sources do not answer.
- Include a TL;DR at the top (3–5 bullets) the reader can cite directly.

## Output shape

Markdown file at `.guild/runs/<run-id>/research/<slug>.md`:

1. **TL;DR** — 3–5 bullets.
2. **Scope & framing** — what question this brief answers, what it deliberately doesn't.
3. **Key findings** — each finding tagged with confidence and linked sources.
4. **Contested / open questions** — what the sources disagree about.
5. **Sources** — numbered list: title · author · date · URL · primary/secondary.
6. **Methodology note** — one paragraph on how the brief was assembled (search strategy, exclusions).

## Anti-patterns

- Unsourced claims — "it's widely known that…" is not a source.
- One-source synthesis — echoing a single article dressed up as research.
- Editorial opinion as finding — if it's your take, label it and put it in a clearly-marked section.
- No confidence calibration — stapling "research shows" onto contested claims flattens signal.
- No summary — a 20-page brief without a TL;DR won't be read.
- Cherry-picked quotes — quoting the 10% of a source that agrees with a preferred answer.

## Handoff

Return the brief path to the invoking `researcher` specialist. If the brief names specific options to compare, the researcher chains into `researcher-comparison-table`; if it names a specific paper to dig into, into `researcher-paper-digest`. This skill does not dispatch.
