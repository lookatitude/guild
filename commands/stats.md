---
name: stats
description: "Self-maintenance — show usage + telemetry dashboard. Pure read; never writes. --rebuild-index drops + rebuilds the optional cache; --no-index forces a one-shot filesystem scan."
argument-hint: "[--rebuild-index] [--no-index]"
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /guild:stats — self-maintenance (Guild-on-Guild)

Prints the usage / telemetry dashboard. Telemetry read — **R**, never
writes.


## Args & local flags

- Args: — (no positional)
- `--rebuild-index` — drops + rebuilds the optional read-through cache.
- `--no-index` — forces a one-shot filesystem scan (Invariant FS-CANONICAL:
  the filesystem stays canonical; the index is never authoritative and never
  required).

## Gates

None — **R** (read-only; never writes telemetry).

## Output

Prints the dashboard (task count, completion rate, flip counts, top skills,
top-requested specialists, open reflection backlog, audit-drift summary). No
file written. `--rebuild-index` only rebuilds the optional cache, not
telemetry data.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the telemetry scan begins — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

Before the telemetry read begins, start a lightweight run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:stats \
  --run-class=lightweight \
  --cwd "$(pwd)"
```

`run-class=lightweight`: stats is read-only diagnostic, analogous to status.
Lightweight writes only `run.yaml` + `provenance.json` to `.guild/runs/` —
never touches wiki/decisions/indexes/initiatives. No `--initiative` flag
(NN#5). The "stats never writes data" contract is preserved; only a replay
trace is added.

## Dispatch

Thin telemetry-read entrypoint. Read `.guild/runs/**` (or the optional
`.guild/index.sqlite` read-through cache; `--rebuild-index` /
`--no-index` control the cache only) and print the dashboard. No `.guild/`
data writes.
