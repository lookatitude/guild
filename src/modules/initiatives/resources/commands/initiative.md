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

Full lifecycle: `docs/v2/initiatives.html` (umbrella workspace canonical
design set — §Registry & directory, §Definition ledger, §The D8 close gate).
Sub-verb implementation: `skills/meta/initiative/SKILL.md`.

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

Before the initiative skill is invoked — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

Ref: `docs/v2/lifecycle.html §Run-start preflight` — "before any phase work,
every `/guild:*` command runs the preflight." DRIFT-ANALYSIS CMD-002.

## Run recording

Before the initiative skill is invoked, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js start \
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

Parse `$ARGUMENTS`. Dispatch the first token (the sub-verb) to
**`guild:initiative`** (`skills/meta/initiative`) — it implements every
sub-verb in the table above (`new|status|list|resume|update|archive|restore|close`),
applying the listed default gate, and owns all `.guild/initiatives/**` reads
and writes. On `close`, the skill runs the deterministic D8 close-gate CLI
(`scripts/initiative-gate.ts close-check`) and refuses to close on a non-zero
exit — see `skills/meta/initiative/SKILL.md §close`. Unknown sub-verb ⇒ print
usage help, invoke no skill, write nothing.
