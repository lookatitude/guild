---
name: guild ideate
description: "Ideation — Socratic spec; opt-in --rigor=deep runs the clarify loop"
argument-hint: "[brief] [--skip]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild ideate — phase: Ideation

The **Ideation** phase entrypoint. Runs the Socratic spec flow; the opt-in
`--rigor=deep` profile runs the clarify loop.

Canonical surface: `architecture/command-surface.md §3.1` (Ideation row) and
the verb↔phase edge in `§6` (D-14: `/guild ideate` → Ideation). Phase concept
binding: `lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding (by pointer — never re-spelled)

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** — bound by pointer through
`docs/knowledge/implementation/contract-map.md §A` row 6 →
`architecture/target-architecture.md §"phase_entry contract"`. The Tier-2
`defaults:` config folded at intake is bound by pointer to
`architecture/command-surface.md §4.4` (`P1-config-001`).

## Usage

```
/guild ideate "realtime presence"
/guild ideate "realtime presence" --skip
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer). `--rigor=deep` runs the clarify loop (semantics by pointer,
`command-surface.md §4.3`).

## Args & local flags

- Args: `[brief]`
- Local flags:
  - `--skip` — validate a supplied spec instead of asking the full question
    set.

## Gates (default)

- Spec-approval **I**
- G-ideation review **A**

## Output artifact

`.guild/spec/<idea-slug>.md`, optional `.guild/research/<idea-slug>.md`.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Ideation phase
(`guild:brainstorm` producer; `--skip` validates a supplied spec). Thin phase
entrypoint — phase logic and `.guild/` writes live in the phase skill set.
