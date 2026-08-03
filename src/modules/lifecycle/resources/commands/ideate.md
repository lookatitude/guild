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
`docs/v2/lifecycle.html §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
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

## Team decision gate (blocking — team-contracts §4/§5)

Before this phase dispatches **any** participant — worker, advisor, challenger,
or local/cross-host reviewer — a **persisted** team decision must authorize it.
An advisory label is never a bypass, and Guild never auto-approves.

1. **Present the proposal** and let the user answer in the decision vocabulary
   — `approve · add · remove · substitute · edit_dependencies · restructure`
   (the four edit verbs record a `restructure`, never an approve). The review
   prints the proposed team, each participant's necessity rationale, excluded
   roles, obligation coverage, and per-kind gate coverage:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/team-decide.ts review \
  --proposal .guild/runs/<run-id>/team-plan/ideate.proposal.v<n>.yaml
```

2. **Restructure loop** — idempotent: each pass produces a NEW proposal version
   (parent hash chained, prior versions preserved) and returns to `pending`; it
   never edits approved bytes and never approves anything:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/team-decide.ts restructure \
  --proposal <parent-proposal> --edits <edits.json> \
  --decided-by user --channel interactive_prompt
```

   It prints the user's edits, the **coverage impact** (obligations that lost
   their last owner), and any edit already satisfied by the parent. It exits
   non-zero on an uncited roster change or a re-introduced cap key — a
   specialist can never be dropped silently.

3. **Gate the dispatch** — run this and **STOP on a non-zero exit**. It reads
   the PERSISTED decision trail under `.guild/runs/<run-id>/team-plan/`; an
   in-memory or agent-asserted approval is never accepted:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/team-decide.ts gate \
  --proposal <proposal> --cwd "$(pwd)"
```

Exit `0` authorizes dispatch and prints the final approved team plus the
backend scheduling waves. Exit `3` **BLOCKS** — no persisted decision, a
restructure rather than an approval, a tampered artifact, or a stale /
hash-mismatched decision after any change to a participant, obligation,
dependency, tier/purpose, capability scope, backend, wave structure,
concurrency, cost posture, or review independence. Renewed user approval is
required; never proceed past a refusal.

Backend capacity shapes **waves**, never the roster: if the backend cannot run
the approved team at once, propose waves or another backend and ask. Never drop
a role to fit a host UI or backend.

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
