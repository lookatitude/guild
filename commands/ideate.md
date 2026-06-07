---
name: ideate
description: "Ideation — Socratic spec; opt-in --rigor=deep runs the clarify loop"
argument-hint: "[brief] [--skip]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:ideate — phase: Ideation

The **Ideation** phase entrypoint. Runs the Socratic spec flow; the opt-in
`--rigor=deep` profile runs the clarify loop.

Canonical surface: `architecture/command-surface.md §3.1` (Ideation row) and
the verb↔phase edge in `§6` (D-14: `/guild:ideate` → Ideation). Phase concept
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
/guild:ideate "realtime presence"
/guild:ideate "realtime presence" --skip
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

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the brainstorm / clarify loop begins — and before run-trace start —
run the preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` (U6 writes the resolved-settings
   snapshot; all later phases read it back via `readResolvedSettingsSnapshot`).
4. Proceed to run-trace start.

## Run recording

Before the brainstorm / clarify loop begins, start a run (SC-B, §435):

```bash
node plugin/hooks/dist/run-trace.js start \
  --command=/guild:ideate \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node plugin/hooks/dist/run-trace.js phase \
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
2. **`guild:loop-clarify`** — **`--rigor=deep` only**: the L1 architect↔
   researcher clarify loop runs BEFORE brainstorm writes the spec; its
   findings feed brainstorm's Assumptions section.

Input gate: an optional `[brief]`; Init artifacts present (or smart-detect).
Output gate: `.guild/spec/<idea-slug>.md` (+ optional
`.guild/research/<idea-slug>.md`).
Confirmation gates (from **Gates**): spec-approval **I** · G-ideation review
**A**.

Thin phase entrypoint — phase logic and `.guild/` writes live in the phase
skill set.
