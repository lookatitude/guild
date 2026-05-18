---
name: guild-receive-review
description: Use when a specialist is responding to review findings on its own work — governs how to act on, accept, or push back on a reviewer's findings. The Guild fallback that any specialist loads when answering `guild:request-review` / `guild:review` output and its T5 skill does not cover review-response discipline. TRIGGER on "the reviewer found X", "responding to review feedback", "the review says I should change Y", "I disagree with this review finding". DO NOT TRIGGER for requesting a review in the first place (`guild:request-review`), running the two-stage handoff review (`guild:review`), or final task-close gating (`guild:verify-done`).
when_to_use: After `guild:request-review` / `guild:review` returns findings on a specialist's own work, before the specialist revises or pushes back. Replaces `superpowers:receiving-code-review`.
type: fallback
---

> **Fallback skill** — forked from `superpowers:receiving-code-review` v5.0.7 §10 (MIT, © 2025 Jesse Vincent). Guild-native adaptation, **zero runtime dependency** on superpowers. See `LICENSE-attribution.md`.

# Receiving a Review

## Overview

A review finding is a signal, not an order and not an insult. The two failure modes this skill exists to prevent: (1) reflexively accepting every finding even when it is wrong, and (2) pushing back with anything other than technical reasoning — tone, authority, or fatigue.

**Core principle:** Push back **only with technical reasoning**. If the only argument is "it works on my machine", "I'm sure it's fine", or "this is taking too long", that is not a rebuttal — apply the fix.

**Announce at start:** "I'm using the guild-receive-review skill to act on these review findings."

## Triage each finding

For every finding the reviewer raised, classify it:

| Class | Action |
|---|---|
| **Correct — Critical** | Fix immediately, before any other finding. |
| **Correct — Important** | Fix before declaring the lane done. |
| **Correct — Minor** | Fix now if cheap; otherwise record as a tracked `followup:`. |
| **Wrong / misread** | Push back **with technical reasoning** — cite the code, the test, the spec clause, or the contract pointer that proves the work is correct. Never push back on tone or authority. |
| **Ambiguous** | Ask the reviewer one focused clarifying question; do not guess. |

## Pushing back correctly

A valid rebuttal contains at least one of: the failing/passing test that contradicts the finding, the spec or contract pointer the finding missed, or a concrete code path the reviewer did not account for. A rebuttal that contains none of these is not a rebuttal — apply the fix.

State the rebuttal once, with evidence. Do not re-litigate a finding the reviewer has already answered with technical reasoning of their own.

## After acting

- Re-run the spec's defined checks after applying fixes.
- Summarize, per finding: accepted-and-fixed / pushed-back-with-reasoning / tracked-as-followup. This summary is what the receipt carries forward.

## Red flags

**Never:**
- Accept a finding you can technically prove is wrong just to close the loop.
- Push back with tone, seniority, urgency, or "it's simple".
- Silently drop a Critical or Important finding.

**Always:**
- Back every push-back with code, tests, spec, or a contract pointer.
- Fix Critical findings before anything else.

## Self-evolution

This skill is self-evolvable for body, clarity, and examples under the **same promotion gate and the same permission carve-out as any Guild skill** (`guild:evolve-skill` — `guild-plan.md §11.2`). There is **no special pipeline** for it; it is an ordinary fallback-tier skill.

## Integration

**Pairs with:**
- **guild:request-review** — receive-review is the disciplined response side of the review that `guild:request-review` solicits; together they close the request → respond loop.
