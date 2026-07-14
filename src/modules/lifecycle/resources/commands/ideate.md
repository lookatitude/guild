---
name: ideate
description: "Ideation — Socratic spec; the L1 clarify loop runs whenever the resolved loops include spec (default --rigor=standard and deep; quick skips it)"
argument-hint: "[brief] [--skip]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:ideate — phase: Ideation

The **Ideation** phase entrypoint. Runs the Socratic spec flow; the L1
clarify loop runs whenever the resolved `loops` include `spec` — true under
the default `--rigor=standard` profile (`loops: spec,plan`) and under
`--rigor=deep` (`loops: all`); `--rigor=quick` (`loops: none`) skips it.

Verb↔phase edge: `/guild:ideate` → Ideation. Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract**. The Tier-2 `defaults:` config folded at
intake is controlled by `P1-config-001` — see `/guild:config` for the schema.

## Usage

```
/guild:ideate "realtime presence"
/guild:ideate "realtime presence" --skip
```

All five global flags + `--dry-run` apply. The `--rigor` profile expansion
(`rigorProfile()` in `scripts/read-guild-config.ts`) decides the L1 loop:
`standard` and `deep` both expand to a `loops` set containing `spec`; only
`quick` turns it off.

## Args & local flags

- Args: `[brief]`
- Local flags:
  - `--skip` — validate a supplied spec instead of asking the full question
    set.

## Gates (default)

- Spec-approval **I**
- G-ideation review **A**

## Output artifact

`.guild/spec/<idea-slug>.md`, `.guild/runs/<run-id>/assumptions.md`,
`.guild/runs/<run-id>/questions.md`,
`.guild/runs/<run-id>/review/spec/*` (G-ideation broker trail), optional
`.guild/research/<idea-slug>.md`.

PCR-Ideation must-exist floor: `.guild/spec/<slug>.md`,
`.guild/runs/<run-id>/assumptions.md`, `.guild/runs/<run-id>/questions.md`,
`.guild/runs/<run-id>/review/spec/*`. Binding:
`docs/v2/03-lifecycle.md §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-005.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the brainstorm / clarify loop begins — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

## Run recording

Before the brainstorm / clarify loop begins, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js start \
  --command=/guild:ideate \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js phase \
  --phase=ideate \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the spec-approval gate
so the complete session is replayable from the entrypoint. `--initiative`
forwarded only when user-supplied (NN#5).

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Ideation phase
by invoking:

1. **`guild:brainstorm`** (`skills/meta/brainstorm`) — the Socratic spec
   producer; writes `.guild/spec/<idea-slug>.md`. `--skip` validates a
   supplied spec (flags gaps) instead of asking the full question set.
2. **`guild:loop-clarify`** — **when the resolved `loops` include `spec`**
   (true under `--rigor=standard`, the default, and `--rigor=deep`; off only
   under `--rigor=quick` / an explicit `--loops` excluding `spec`): the L1
   architect↔researcher clarify loop runs BEFORE brainstorm writes the spec;
   its findings feed brainstorm's Assumptions section.

Input gate: an optional `[brief]`; Init artifacts present (or smart-detect).
Output gate: `.guild/spec/<idea-slug>.md` (+ optional
`.guild/research/<idea-slug>.md`).
Confirmation gates (from **Gates**): spec-approval **I** · G-ideation review
**A**.

Thin phase entrypoint — phase logic and `.guild/` writes live in the phase
skill set.
