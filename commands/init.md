---
name: init
description: "Init — onboard an existing repo or scaffold new-product knowledge; builds wiki + (brownfield) cheap-scan CodebaseMap + architecture-map stub (cheap by default). Full learn-* pipeline runs only under --learn or defaults.auto_learn: true (D3); --learn folds in the former --deep-scan."
argument-hint: "[--learn] [--new]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:init — phase: Init

The **Init** phase entrypoint. Onboards an existing repo or scaffolds
new-product knowledge: builds the wiki and, for a brownfield repo, the
**cheap scan tier only** — the derived `CodebaseMap` plus a
confidence-tagged `architecture-map.md` stub. That pair is Init-DONE. The
deep semantic `KnowledgeGraph` + onboarding tour are **lazy**, gated by the
`--learn` flag or `defaults.auto_learn: true` config — built via the
`learn-*` pipeline (same skills as `/guild:learn`), **not** produced at Init
by default.

Canonical surface: `architecture/command-surface.md §3.1` (Init row) and the
verb↔phase edge in `§6` (D-14: `/guild:init` → Init). Phase concept binding:
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
/guild:init
/guild:init --learn
/guild:init --new
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer).

## Args & local flags

- Args: — (no positional)
- Local flags:
  - `--learn` — run the full `learn-*` pipeline now (`guild:learn-map` /
    `learn-graph` / `learn-onboard` / `learn-diff` / `learn-explain`),
    the same skills `/guild:learn` invokes. Also triggered automatically
    when `defaults.auto_learn: true` is set in `.guild/settings.json`.
    Folds in the former `--deep-scan` flag (D3).
  - `--new` — force the new-product scaffold path.

## Gates (default)

- New-product Q&A **I**
- G-init review **A**

Note: `--learn` and `defaults.auto_learn: true` both run the full `learn-*`
pipeline without an extra gate (explicitly requested). The former
ask-before-deep-scan interactive gate is removed (D3).

## Output artifact

`.guild/init/<slug>.md`, `.guild/wiki/**`, `.guild/raw/**`,
`.guild/settings.json` (the project config surface, scaffolded
fully-documented if absent — see below), and (brownfield, cheap scan tier =
Init-DONE) `.guild/indexes/codebase-map.json` + confidence-tagged
`wiki/concepts/architecture-map.md` stub. `knowledge-graph.json` +
`onboarding-tour.md` are **deferred** — lazy, produced only under `--learn` /
`defaults.auto_learn` by the `learn-*` pipeline, never at Init by default.

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
`/guild:config init|show|validate`. If a legacy `.guild/config.yml` is
present, its values are read via the back-compat shim until migrated.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), confirm the new-product
gates per the **Gates** block, then drive the Init phase by
invoking, in order:

1. **`guild:init`** (`skills/meta/init`) — the Init-phase producer:
   bootstraps the wiki, scaffolds `.guild/settings.json` (idempotent), writes
   `.guild/init/<slug>.md`.
2. **`guild:learn-map`** (cheap-scan tier) — brownfield only:
   derives `.guild/indexes/codebase-map.json` + the confidence-tagged
   `wiki/concepts/architecture-map.md` stub. This is **Init-DONE by default**
   (cheap scan only — no deep pipeline unless step 3 triggers).
3. **Full `learn-*` pipeline** — runs **ONLY when** `--learn` is passed
   **OR** `defaults.auto_learn: true` is set in `.guild/settings.json`.
   Invokes the same skills as `/guild:learn` (one implementation, two
   triggers — D3): `guild:learn-map` / `guild:learn-graph` /
   `guild:learn-onboard` / `guild:learn-diff` / `guild:learn-explain`.
   Without this trigger, the deep `KnowledgeGraph` + onboarding tour remain
   lazy and are never produced at Init.

Input gate: a brownfield repo, or `--new` for the greenfield scaffold path.
Output gate (Init-DONE): the **Output artifact** set above is written.
Confirmation gates (from **Gates**): new-product Q&A **I** · G-init review
**A**. (Full learn pipeline runs without extra gate when `--learn` /
`defaults.auto_learn` — explicitly requested.)

Thin phase entrypoint — phase logic and all `.guild/` writes live in the
phase skill set, never in this file.
