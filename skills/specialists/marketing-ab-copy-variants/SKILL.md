---
name: marketing-ab-copy-variants
description: Authors A/B (or multivariate) copy variants with a testable hypothesis, a single changed variable, a control, sample-size math, and a pre-registered success metric. Pulled by the `marketing` specialist. TRIGGER: "write A/B variants for the hero headline", "set up an A/B test on the pricing CTA", "draft multivariate copy for the signup page", "hypothesize and write variants for the email subject test", "run a copy test on the landing page above the fold", "design the test for the homepage hero". DO NOT TRIGGER for: writing the primary control copy itself (use `copywriter-long-form` / `copywriter-product-microcopy`), a single non-tested revision, positioning changes (use `marketing-positioning`), full launch plan (use `marketing-launch-plan`), platform-native social posts (use `social-media-platform-post`), a cold outreach sequence (use `sales-cold-outreach`).
when_to_use: The parent `marketing` specialist pulls this skill when the task is setting up a copy experiment with a hypothesis, variants, and measurement plan. Also fires on explicit user request.
type: specialist
---

# marketing-ab-copy-variants

Implements `guild-plan.md §6.3` (marketing · ab-copy-variants) under `§6.4` commercial principles: hypothesis-first (what belief are we testing, and what would falsify it?), success = pre-registered metric with sufficient power, evidence = a readout that separates signal from noise — not "variant B felt stronger."

## What you do

Produce variants that actually test something. A good test changes one variable, runs long enough to detect a realistic effect, and writes down the hypothesis before the data arrives.

- Write the hypothesis as `If we change X to Y, metric Z moves by ΔW, because <mechanism>.` No mechanism = no test.
- Hold one variable per test. Headline OR CTA color OR hero image, not three at once. Multivariate is for teams with the traffic to power 8+ cells.
- Include a true control — the current live copy. Two new variants without control is a preference survey.
- Write 2–4 variants. >4 at the same traffic level almost always underpowers.
- Do the sample-size math: baseline conversion, minimum detectable effect, required sessions per arm. If traffic can't support it, say so and propose aggregating over a longer window.
- Pre-register the metric, measurement window, guardrails, and stop conditions before launch.
- Flag ethics/brand risks — variants that mislead or damage trust are off-limits regardless of lift.

## Output shape

A markdown file at `.guild/runs/<run-id>/tests/<slug>.md` with sections:

1. **Hypothesis** — if X then Y because Z.
2. **Variable under test** — the one thing that changes.
3. **Variants table** — label · copy · rationale (control + challengers).
4. **Test setup** — traffic allocation, measurement tool, tracking events.
5. **Sample-size math** — baseline, MDE, sessions/arm, estimated duration.
6. **Primary metric + guardrails** — with measurement window.
7. **Stop conditions** — significance threshold, max duration, guardrail breaches.
8. **Post-test review plan** — who decides, when, what action on each outcome.

## Anti-patterns

- Changing more than one variable — you can't attribute lift.
- No control — you're comparing two unknowns.
- Underpowered tests — calling a winner with 400 sessions/arm at a 2% baseline.
- Peeking without pre-registered stop rules — inflates false positives.
- "Just vibe the copy" variants with no rationale tied to audience insight.
- Running tests on irrelevant pages or segments that won't move the business metric.
- Missing guardrails — lifting clicks while tanking downstream conversion.

## Handoff

Return the test plan path to the invoking `marketing` specialist. Downstream, winning variants feed back into `copywriter-long-form` or `copywriter-product-microcopy` to be promoted to control; insights feed `marketing-positioning` when the test invalidates a messaging bet. For subject-line tests on lifecycle email, coordinate with `copywriter-email-sequences`. This skill does not dispatch.
