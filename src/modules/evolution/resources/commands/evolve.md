---
name: evolve
description: "Self-maintenance — run the evolve pipeline on one skill/instance. --auto runs unattended (promotion gate still respected). Dispatches to guild:evolve-skill."
argument-hint: "<id> [--auto]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:evolve — self-maintenance (Guild-on-Guild)

Kicks off skill evolution. Maps to skill `guild:evolve-skill`.

## Canonical grammar

```
/guild:evolve <id> [--auto]
```

- **`<id>` (positional, required)** — the skill or evolvable instance to
  evolve. This is the **same single positional** the legacy `[skill]` form
  named; it is **widened, not duplicated** — `<id>` covers a base skill name
  and an instance id.
- **`--auto`** — run the promotion pipeline unattended; the promotion gate
  is still respected (gate criteria must pass, no regression), unchanged.

## Gates

Promotion gate **I** (manual) / **A** (`--auto`, gate-respected). Never
auto-edits a skill without passing the promotion gate; rejected attempts are
archived, not deleted.

## Output

`.guild/evolve/<run-id>/**`, version bump on promote.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the evolve-skill pipeline runs — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

Before the evolve-skill is invoked, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:evolve \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the promotion gate so
the complete session — shadow evaluation and promotion decision — is
replayable from the entrypoint. Writes to
`.guild/evolve/` — not `.guild/initiatives/` (NN#5 unaffected). No
`--initiative` flag.

## Dispatch

```
Skill: guild:evolve-skill
args: $ARGUMENTS
```

If `<id>` is omitted, reject (id required). Pipeline logic and `.guild/` writes
live in the `guild:evolve-skill` skill.
