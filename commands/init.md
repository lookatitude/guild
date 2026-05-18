---
name: guild init
description: "Init — onboard an existing repo or scaffold new-product knowledge; builds wiki + (brownfield) knowledge-graph index"
argument-hint: "[--deep-scan] [--new]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild init — phase: Init

The **Init** phase entrypoint. Onboards an existing repo or scaffolds
new-product knowledge: builds the wiki and, for a brownfield repo, the
derived knowledge-graph index.

Canonical surface: `architecture/command-surface.md §3.1` (Init row) and the
verb↔phase edge in `§6` (D-14: `/guild init` → Init). Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md` (one
state machine, six phase entrypoints).

## Contract binding (by pointer — never re-spelled)

Before any producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** — bound by pointer through
`docs/knowledge/implementation/contract-map.md §A` row 6 →
`architecture/target-architecture.md §"phase_entry contract"`
(`review.learning_checkpoint: true`). The Tier-2 `defaults:` config folded at
intake is bound by pointer to `architecture/command-surface.md §4.4`
(`P1-config-001`) — not re-spelled here.

## Usage

```
/guild init
/guild init --deep-scan
/guild init --new
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer).

## Args & local flags

- Args: — (no positional)
- Local flags:
  - `--deep-scan` — run the deep codebase scan now (else the
    ask-before-deep-scan gate is surfaced).
  - `--new` — force the new-product scaffold path.

## Gates (default)

- Ask-before-deep-scan **I**
- New-product Q&A **I**
- G-init review **A**

## Output artifact

`.guild/init/<slug>.md`, `.guild/wiki/**`, `.guild/raw/**`, and (brownfield)
`.guild/indexes/codebase-map.json`, `knowledge-graph.json`,
`wiki/concepts/architecture-map.md`.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), confirm the deep-scan /
new-product gates per default, then drive the Init phase via the
orchestrator. This command is a thin phase entrypoint — phase logic and all
`.guild/` writes live in the phase skill set, never in this file.
