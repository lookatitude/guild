---
name: guild init
description: "Init — onboard an existing repo or scaffold new-product knowledge; builds wiki + (brownfield) cheap-scan CodebaseMap + architecture-map stub (deep knowledge-graph is lazy + gated, not built at Init)"
argument-hint: "[--deep-scan] [--new]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild init — phase: Init

The **Init** phase entrypoint. Onboards an existing repo or scaffolds
new-product knowledge: builds the wiki and, for a brownfield repo, the
**cheap scan tier only** — the derived `CodebaseMap` plus a
confidence-tagged `architecture-map.md` stub. That pair is Init-DONE. The
deep semantic `KnowledgeGraph` + onboarding tour are **lazy and
ask-before-deep-scan gated** (built later by `guild:understand-engine` when a
plan needs P2/P3), **not** produced at Init.

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

`.guild/init/<slug>.md`, `.guild/wiki/**`, `.guild/raw/**`,
`.guild/settings.json` (the project config surface, scaffolded
fully-documented if absent — see below), and (brownfield, cheap scan tier =
Init-DONE) `.guild/indexes/codebase-map.json` + confidence-tagged
`wiki/concepts/architecture-map.md` stub. `knowledge-graph.json` +
`onboarding-tour.md` are **deferred** — lazy, gated, produced by
`guild:understand-engine`, never at Init.

### Config scaffold (`.guild/settings.json`)

As part of bootstrap, Init scaffolds the project config surface
`.guild/settings.json` **if it does not already exist** (idempotent — never
clobber operator config):

```bash
test -f .guild/settings.json || npx tsx scripts/read-guild-config.ts --scaffold > .guild/settings.json
```

It is written with every option = its default + a self-documenting `_help`
block. CLI flags always override it (precedence ladder
`command-surface.md §4.3/§4.4`). Re-generate or inspect any time with
`/guild config init|show|validate`. If a legacy `.guild/config.yml` is
present, its values are read via the back-compat shim until migrated.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), confirm the deep-scan /
new-product gates per default, then drive the Init phase via the
orchestrator. This command is a thin phase entrypoint — phase logic and all
`.guild/` writes live in the phase skill set, never in this file.
