---
name: initiative
description: "Durable work — opt-in noun. Sub-verbs new|status|list|resume|update|archive|restore|close. A one-off /guild:guild run never creates an initiative; attachment is explicit only."
argument-hint: "new|status|list|resume|update|archive|restore|close [id] [--add-goal \"…\"]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:initiative — durable-work noun (opt-in)

The opt-in durable-goal container. `new|status|resume|update|close` are the
primary user-facing lifecycle sub-verbs; `list|archive|restore` are
operational sub-verbs on the same noun.

Canonical surface: `architecture/command-surface.md §3.4` (full set) + `§1`
(noun grammar). Full lifecycle:
`initiatives/initiative-and-phase-workflows.md`.

## Sub-verbs (cited — `command-surface.md §3.4`)

| Sub-verb | Drives | Gates | Output |
|---|---|---|---|
| `new` | create a durable goal container | definition-ready gate **I** | `.guild/initiatives/active/<id>/initiative.yaml`, definition-ledger |
| `status` | read initiative progress / work-items / release / doc-sync | **R** | prints state |
| `list` | list all initiatives (active + archived) w/ cross-cut rollup | **R** | prints state |
| `resume` | re-enter at the next work-item | next gate **I** | continues initiative runs |
| `update` | amend the definition-ledger (`--add-goal "…"`) | ledger-change confirm **I** | updated ledger |
| `archive` | move to archived w/o close-gate release path (operational) | archive confirm **I** | `active/<id>/` → archived |
| `restore` | restore archived → active (operational) | restore confirm **I** | archived → `active/<id>/` |
| `close` | requires release evidence + doc-sync reconciliation (D8) | release-readiness + doc-sync gate **I** | `active/<id>/release/**` → archived |

## Opt-in attachment binding (cited — `command-surface.md §3.4`)

A one-off `/guild:guild` run does **not** create an initiative. An initiative is
attached only when (a) the user runs `/guild:initiative …` explicitly,
(b) `--initiative=<id|new>` is passed, or (c) the brief carries a
durable-goal signal — in which case `/guild:guild` *asks* "attach to an
initiative? [new / existing / one-off]" rather than auto-attaching. One-off
runs are first-class.

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
