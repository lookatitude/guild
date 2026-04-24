---
name: sales-discovery-framework
description: Designs a discovery-call framework — stage-gated question sets, qualification scoring, disqualification criteria, and next-step decision rules. Pulled by the `sales` specialist. TRIGGER: "design the discovery call framework", "build the discovery questions and scoring", "write a MEDDIC/SPICED/BANT-style qualification guide", "draft the qualification + disqualify criteria", "set up the discovery script for the AE team", "what should reps ask on discovery calls". DO NOT TRIGGER for: cold outreach to book the call (use `sales-cold-outreach`), post-meeting follow-up (use `sales-follow-up-sequence`), the proposal after qualification (use `sales-proposal-writer`), product demo script (separate concern — treat as product enablement), positioning or ICP work (use `marketing-positioning`).
when_to_use: The parent `sales` specialist pulls this skill when the task is designing how reps run discovery calls and qualify (or disqualify) deals. Also fires on explicit user request.
type: specialist
---

# sales-discovery-framework

Implements `guild-plan.md §6.3` (sales · discovery-framework) under `§6.4` commercial principles: hypothesis-first (what must be true for this deal to close?), success = qualified-pipeline rate and disqualify rate, evidence = call notes citing specific answers — not rep gut feel.

## What you do

Produce the framework a rep uses to decide within 30–45 minutes whether this deal is real, and if so, what the next commit should be. A good framework surfaces disqualification as fast as it surfaces fit — the worst deal is the one that lingers at 20% for 9 months.

- Pick or adapt a qualification spine (MEDDIC, SPICED, BANT, custom) and make the choice explicit — don't hybridize without saying so.
- Map questions to spine dimensions: pain, impact, decision process, criteria, champion, budget, timing, competition.
- Write open questions that require a story, not yes/no. "What triggered this evaluation?" beats "Are you evaluating solutions?"
- Stage-gate: which answers must be captured by end-of-call to advance; which are nice-to-have for follow-up.
- Define scoring — numeric or tiered — per dimension, so call reviews aren't vibes.
- Write the disqualify criteria concretely: no budget this year, no executive sponsor, wrong use case, active competitor lock-in.
- Write next-step rules: `if score ≥ X and champion identified → schedule technical deep-dive; if score < Y → politely disqualify with warm-nurture path.`

## Output shape

A markdown file at `.guild/runs/<run-id>/sales/discovery-<slug>.md` with sections:

1. **Framework choice** — which spine and why.
2. **Question sets** — grouped by dimension, each with phrasing + what a good answer looks like.
3. **Scoring rubric** — per dimension, tiered or numeric.
4. **Stage gates** — what must be captured to advance.
5. **Disqualify criteria** — explicit, named.
6. **Next-step decision rules** — if/then routing based on score + signals.
7. **Rep cheat-sheet** — one-page version to run the call from.
8. **Common objections + reframes** — top 3–5.

## Anti-patterns

- Feature-dump script — reps monologue instead of discovering.
- Yes/no questions that collect no story — "Do you have budget?" gets a useless answer.
- No disqualify path — deals never leave the pipeline, forecasts stay fantasy.
- Leading questions ("You'd want faster deploys, right?") — invalidates the signal.
- Scoring with no thresholds — "qualification" is a vibe check.
- One framework for every segment — enterprise and PLG need different spines.
- Missing champion/power distinction — champion-without-power is a common failure mode.

## Handoff

Return the framework path to the invoking `sales` specialist. Downstream, qualified deals hand to `sales-proposal-writer`; post-call comms hand to `sales-follow-up-sequence`; un-qualified deals route to a nurture track (typically `copywriter-email-sequences`). If discovery repeatedly exposes ICP mismatch, flag back to `marketing-positioning`. This skill does not dispatch.
