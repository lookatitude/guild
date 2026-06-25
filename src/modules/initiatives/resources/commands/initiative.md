---
name: initiative
description: "Durable work — opt-in noun. Sub-verbs new|status|list|resume|update|archive|restore|close. A one-off /guild:guild run never creates an initiative; attachment is explicit only."
argument-hint: "new|status|list|resume|update|archive|restore|close [id] [--add-goal \"…\"] [--archived]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:initiative — durable-work noun (opt-in)

The opt-in durable-goal container. `new|status|resume|update|close` are the
primary user-facing lifecycle sub-verbs; `list|archive|restore` are
operational sub-verbs on the same noun.

Full lifecycle: `initiatives/initiative-and-phase-workflows.md`.

## Sub-verbs

| Sub-verb | Drives | Gates | Output |
|---|---|---|---|
| `new` | create a durable goal container | definition-ready gate **I** | `.guild/initiatives/active/<id>/initiative.yaml`, definition-ledger |
| `status` | read initiative progress / work-items / release / doc-sync | **R** | prints state |
| `list` | list active initiatives (default) w/ cross-cut rollup; `--archived` shows all | **R** | prints state |
| `resume` | re-enter at the next work-item | next gate **I** | continues initiative runs |
| `update` | amend the definition-ledger (`--add-goal "…"`) | ledger-change confirm **I** | updated ledger |
| `archive` | move to archived w/o close-gate release path (operational) | archive confirm **I** | `active/<id>/` → archived |
| `restore` | restore archived → active (operational) | restore confirm **I** | archived → `active/<id>/` |
| `close` | requires release evidence + doc-sync reconciliation (D8) | release-readiness + doc-sync gate **I** | `active/<id>/release/**` → archived |

## Opt-in attachment binding

A one-off `/guild:guild` run does **not** create an initiative. An initiative is
attached only when (a) the user runs `/guild:initiative …` explicitly,
(b) `--initiative=<id|new>` is passed, or (c) the brief carries a
durable-goal signal — in which case `/guild:guild` *asks* "attach to an
initiative? [new / existing / one-off]" rather than auto-attaching. One-off
runs are first-class.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the initiative skill is invoked — and before run-trace start — run the
preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` — U6 writes
   `.guild/runs/<id>/resolved-settings.json` + `settings_ref` in `run.yaml`.
4. Proceed to run-trace start.

Ref: `docs/v2/03-lifecycle.md §Run-start preflight` — "before any phase work,
every `/guild:*` command runs the preflight." DRIFT-ANALYSIS CMD-002.

## Run recording

Before the initiative skill is invoked, start a run (SC-B, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js start \
  --command=/guild:initiative \
  --cwd "$(pwd)"
```

`run-class` default (`full`). NN#5 applies to `startRun` itself — the
library does not create `.guild/initiatives/` as a side effect of run
recording. The `initiative` command's OWN skill writes `.guild/initiatives/`
as part of its purpose; those writes are orthogonal to and unaffected by
the run-recording call here. No `--initiative` flag forwarded (the
`initiative` command manages its own id resolution internally).

## Dispatch

Parse `$ARGUMENTS`. Dispatch on the first token to the initiative-layer
sub-verb above, applying the listed default gate. Unknown sub-verb ⇒ print
usage help, invoke no skill, write nothing. Initiative-layer logic and all
`.guild/initiatives/**` writes live in the initiative skill set.
