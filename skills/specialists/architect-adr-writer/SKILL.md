---
name: architect-adr-writer
description: Writes a full Architecture Decision Record (ADR) with Context / Drivers / Options / Decision / Consequences / Date / Status. Output: `.guild/runs/<run-id>/adr/<slug>.md`. Pulled by the `architect` specialist. TRIGGER: "write an ADR for X", "capture this decision as an ADR", "document the decision to use X over Y", "record this architecture choice", "draft an ADR", "log the decision on the database engine". DO NOT TRIGGER for: greenfield system design (use `architect-systems-design`), scoring unresolved options before a decision exists (use `architect-tradeoff-matrix`), persisting the decision to the project wiki (that is `guild:decisions` — this skill writes the ADR file; the architect agent hands off to `guild:decisions` if the user wants it durable in `wiki/decisions/`).
when_to_use: The parent `architect` specialist pulls this skill when a decision has been made (or is about to be) and needs a durable, auditable record before the team moves on. Also fires on explicit user request.
type: specialist
---

# architect-adr-writer

Implements `guild-plan.md §6.1` (architect · adr-writer) under `§6.4` engineering principles: the ADR is the evidence trail a future reviewer follows to understand *why*, not just *what*.

## What you do

Write one ADR following the classic MADR/Nygard shape, scoped to a single decision. The ADR is short enough to read in under three minutes and specific enough that six months from now a new teammate can reconstruct the reasoning without asking.

- Name the decision in the title as a resolved sentence: "Use Postgres for the events store" not "Events store".
- Include **Status** (Proposed / Accepted / Superseded), **Date** (today), and **Deciders** (roles or names if known).
- Write **Context** as the forces in play — constraints, prior commitments, what made this a decision worth recording.
- List **Drivers** (the 2–5 criteria that actually moved the choice).
- Enumerate **Options considered** with one-line pros/cons — including the rejected ones, by name.
- State the **Decision** as a single declarative sentence plus a short justification tied back to drivers.
- List **Consequences** — positive, negative, and follow-up work created by the choice.

## Output shape

A markdown file at `.guild/runs/<run-id>/adr/<slug>.md`, 60–150 lines. Sections in order:

```
# ADR: <decision sentence>

- Status: Accepted
- Date: YYYY-MM-DD
- Deciders: <roles>

## Context
## Drivers
## Options considered
## Decision
## Consequences
```

## Anti-patterns

- Skipping alternatives — an ADR without rejected options is a press release.
- No date / no status — then nobody knows if it's still in force.
- No consequences — a decision without downsides is a sales pitch, not a record.
- Rewriting history — do not edit an accepted ADR silently; supersede it with a new one and link both.
- Scope creep — one decision per ADR. Two decisions = two files.

## Handoff

Return the ADR path to the invoking `architect` specialist. If the user wants the decision mirrored into the durable project wiki, the architect hands off to `guild:decisions` — this skill writes the per-run artifact; `guild:decisions` owns `wiki/decisions/`. This skill does not itself dispatch.
