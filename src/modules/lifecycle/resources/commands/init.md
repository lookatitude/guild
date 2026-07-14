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

Verb↔phase edge: `/guild:init` → Init. Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md` (one
state machine, six phase entrypoints).

## Contract binding

Before any producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** (`review.learning_checkpoint: true`).
The Tier-2 `defaults:` config folded at intake is controlled by
`P1-config-001` — see `/guild:config` for the schema.

## Usage

```
/guild:init
/guild:init --learn
/guild:init --new
```

All five global flags + `--dry-run` apply.

## Args & local flags

- Args: — (no positional)
- Local flags:
  - `--learn` — run the full `learn-*` pipeline now (`guild:learn-map` /
    `learn-graph` / `learn-knowledge` (cost-gated knowledge tier) /
    `learn-onboard` / `learn-diff` / `learn-explain`), the same skills
    `/guild:learn` invokes. Also triggered automatically
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

`.guild/guild.yaml`, `.guild/init/<slug>.md`, `.guild/wiki/**`,
`.guild/raw/**`, `.guild/settings.json` (the project config surface,
scaffolded fully-documented if absent — see below), and (brownfield, cheap
scan tier = Init-DONE) `.guild/indexes/codebase-map.json` + confidence-tagged
`wiki/concepts/architecture-map.md` stub. `knowledge-graph.json` +
`onboarding-tour.md` are **deferred** — lazy, produced only under `--learn` /
`defaults.auto_learn` by the `learn-*` pipeline, never at Init by default.

PCR-Init must-exist floor: `.guild/guild.yaml`, `.guild/wiki/index.md`
(scaffold), `.guild/agents/registry.yaml`, `.guild/skills/registry.yaml`,
`.guild/workflows/registry.yaml`, `.guild/loops/registry.yaml`,
`.guild/knowledge/**`, `.guild/memory/**`, `.guild/raw/`,
`.guild/settings.json` (scaffold), `.guild/init/<slug>.md`,
`.guild/initiatives/**`, `.guild/runs/`, `.guild/teams/registry.yaml`,
`.guild/artifacts/**`; brownfield: `.guild/indexes/codebase-map.json`,
`.guild/wiki/architecture-map.md` stub. Workspace roots additionally include
`.guild/workspace.json`, `.guild/workspace/**`, and
`.guild/workspace-knowledge/**`. Binding:
`docs/v2/03-lifecycle.md §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-006.

### Config scaffold (`.guild/settings.json`)

As part of bootstrap, Init scaffolds the project config surface
`.guild/settings.json` **if it does not already exist** (idempotent — never
clobber operator config):

```bash
test -f .guild/settings.json || npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/read-guild-config.ts --scaffold > .guild/settings.json
```

It is written with every option = its default + a self-documenting `_help`
block. CLI flags always override it. Full 7-source resolution precedence
(lowest to highest): `builtin < workspace < workspace-local < project <
project-local < rigor < CLI` (`command-surface.md §4.3/§4.4`; `config.md`
inheritance chain). The scaffold writes the project layer only
(`<cwd>/.guild/settings.json`); workspace-level keys from the root
`.guild/settings.json` are inherited automatically at runtime — Init does NOT
copy or merge them into the child file (preserving workspace-inherits-unless-overridden
semantics, OD-2).

Re-generate or inspect any time with `/guild:config init|show|validate`. If a
legacy `.guild/config.yml` is present, run `/guild:migrate` to convert it to
`settings.json` — `config.yml` is not read at runtime in v2 (the back-compat
reader was removed in v2.0).

## Run-start preflight (settings-control-and-tmux U3/U6)

Before any `.guild/` inspection — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
call `runStartPreflight` yourself.

Since wave 2, `run-trace.js start` (below) is the **sole caller** of
`runStartPreflight` (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`): on `start` the CLI resolves the 7-source
inheritance chain, validates closed keys, probes tmux, detects providers, and
writes `.guild/runs/<id>/resolved-settings.json` (+ a compact `settings_ref` in
`run.yaml`) automatically before the run opens. If this command needs the
resolved config — e.g. the dispatch backend `effective.agent_mode` — read the
snapshot back with `readResolvedSettingsSnapshot(runId, { cwd })`; never
re-resolve.

Note: the config scaffold step (below) writes the project settings layer only —
it runs AFTER the preflight so that a freshly created `settings.json` is
available to subsequent phases, but the preflight itself uses whatever is
already on disk (or inherited from the workspace root).

## Run recording

Before any `.guild/` inspection, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js start \
  --command=/guild:init \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js phase \
  --phase=init \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before slug resolution and
config scaffold so the complete session — including new-product Q&A gates —
is replayable from the entrypoint. `--initiative` forwarded only when
user-supplied (NN#5); the init skill writes `.guild/init/` not
`.guild/initiatives/` — orthogonal and not a NN#5 concern.

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
   triggers — D3): `guild:learn-map` → `guild:learn-graph` →
   `guild:learn-knowledge` (knowledge tier — K1–K6; lazy + cost-gated) →
   `guild:learn-onboard` (`guild:learn-diff` / `guild:learn-explain` are
   change-analysis and query-time skills, not part of the bootstrap sub-set).
   `guild:learn-knowledge` runs here byte-identically to its `/guild:learn
   knowledge` and full `/guild:learn` triggers (SC-8 one-implementation /
   two-triggers) — see `commands/learn.md` "Relation to `/guild:init --learn`".
   Without this trigger, the deep `KnowledgeGraph`, knowledge tier, and
   onboarding tour remain lazy and are never produced at Init.

Input gate: a brownfield repo, or `--new` for the greenfield scaffold path.
Output gate (Init-DONE): the **Output artifact** set above is written.
Confirmation gates (from **Gates**): new-product Q&A **I** · G-init review
**A**. (Full learn pipeline runs without extra gate when `--learn` /
`defaults.auto_learn` — explicitly requested.)

Thin phase entrypoint — phase logic and all `.guild/` writes live in the
phase skill set, never in this file.
