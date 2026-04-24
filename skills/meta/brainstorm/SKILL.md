---
name: guild-brainstorm
description: Socratic clustered-question flow that turns a vague user brief into an approved `.guild/spec/<slug>.md`. Captures the seven planning-contract fields from `guild-plan.md §8.1` — goal, audience, success criteria, non-goals, constraints, autonomy policy, and known risks/rollback — plus an eighth assumptions-vs-blocking-unknowns roll-up. TRIGGER on "let's plan X", "help me scope this feature", "what are we actually building", "start a new Guild task", "I have a vague idea for …", or any `/guild` invocation with a brief shorter than the §8.1 checklist. Supports a `--skip` escape hatch (per §15.2 user-fatigue mitigation) for users who already have a clear spec; in that mode the skill validates the supplied spec and flags gaps instead of asking the full question set. DO NOT TRIGGER for implementation requests (hand off to `guild:execute-plan`), team composition (hand off to `guild:team-compose`), direct code or file edits, or micro-tasks like typo fixes and branch pushes.
when_to_use: First step of the `/guild` lifecycle (`guild-plan.md §8`). Fires when a user invokes `/guild` with a vague brief, or when a specialist downstream needs the user's intent clarified before `guild:team-compose` can run.
type: meta
---

# guild:brainstorm

Implements `guild-plan.md §8` (task lifecycle) and `guild-plan.md §8.1` (planning contract). This is the first step of every `/guild` task — ambiguity is front-loaded here so downstream specialists work from a single, approved spec instead of re-asking the user across every handoff.

## What you do

Run a short Socratic conversation organized into **clusters** — not a flat questionnaire. Each cluster groups related §8.1 fields so the user answers one coherent set at a time (e.g. goal + audience + outcome together, constraints + autonomy + risks together). Reflect back each cluster in one sentence before moving on, so the user can correct drift early. When every §8.1 field has a confirmed answer (or an explicit assumption), write `.guild/spec/<slug>.md` and hand off to `guild:team-compose`.

## Required capture (per §8.1)

The spec is not approved until every item below is either answered or explicitly converted to an assumption:

1. **Goal and user-visible outcome** — what changes for the end user when this is done.
2. **Target audience or operator** — who experiences the outcome or runs the artifact.
3. **Success criteria and acceptance tests** — measurable conditions the task must meet. Vague vibes ("feels better") are rejected.
4. **Non-goals** — explicit list of things the task is *not* doing, to stop scope creep downstream.
5. **Constraints** — time, budget, stack, platform, legal/compliance, brand, security. Anything that bounds the solution space.
6. **Autonomy policy** — what Guild may do without asking, what requires confirmation, what is forbidden. This becomes the specialists' permission contract.
7. **Known risks and rollback/release expectations** — what could go wrong and how the user expects to back out if it does.
8. **Assumptions vs. blocking unknowns** — per §8.1, blocking unknowns must be answered or explicitly converted into assumptions recorded in `.guild/runs/<run-id>/assumptions.md`. Low-significance uncertainty also goes in that file for end-of-task review.

## Output contract

Write `.guild/spec/<slug>.md` with YAML frontmatter + a markdown body. Minimal template:

```markdown
---
type: spec
owner: orchestrator
confidence: medium
source_refs: []
created_at: 2026-04-24
updated_at: 2026-04-24
---

# <Task title>

## Goal & outcome
<one or two sentences>

## Audience / operator
<who>

## Success criteria
- <measurable criterion 1>
- <measurable criterion 2>

## Non-goals
- <explicit out-of-scope 1>

## Constraints
- time: <...>
- stack: <...>
- legal/brand/security: <...>

## Autonomy policy
- may act without asking: <...>
- requires confirmation: <...>
- forbidden: <...>

## Risks & rollback
- <risk> → <rollback plan>

## Assumptions (from brainstorm)
- <assumption, with "user explicitly agreed" or "inferred, low-significance">
```

Blocking unknowns: if the user explicitly chooses to convert a blocking unknown into an assumption rather than answer it, record it in both the spec's **Assumptions** section *and* `.guild/runs/<run-id>/assumptions.md` so it surfaces at `guild:verify-done`. Frontmatter `confidence` drops to `low` whenever ≥ 1 blocking unknown is assumed-through.

## --skip escape hatch

Per `guild-plan.md §15.2` ("user fatigue from Socratic brainstorm"), if the user invokes `/guild ... --skip` *and* supplies a spec (pasted text or a path), **do not run the Socratic flow**. Instead:

1. Parse the supplied spec.
2. Check each of the 8 capture items above. Missing items are listed back to the user in a single consolidated question — not a new full question flow.
3. If the user confirms "proceed anyway" for any gap, record that gap as an assumption (see Output contract) and drop `confidence` to `low`.
4. Write `.guild/spec/<slug>.md` and hand off.

Red flag: do **not** auto-fill missing fields from training-data priors. A missing field is either answered by the user in the consolidated follow-up, or recorded as an explicit assumption — never silently synthesized.

## Handoff

Once the spec is written **and the user has explicitly approved it** (not just "looks fine" — the word "approved" or an equivalent affirmative), invoke `guild:team-compose` with the spec path as its argument. Do not continue into team composition on your own; `guild:team-compose` is a separate skill with its own responsibilities (`guild-plan.md §7`).

Handoff receipt should list: `spec_path`, `assumptions_count`, `blocking_unknowns_converted` (boolean), and `confidence` from the spec frontmatter.
