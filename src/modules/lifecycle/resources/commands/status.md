---
name: status
description: "Orchestrator — read current run state, furthest phase, next gate, blockers. Read-only; never writes."
argument-hint: "[--no-index]"
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /guild:status — lifecycle helper (read-only)

Reads the active run state: current run, furthest phase, next gate, and
blockers. **No phase** — acts on the active run. Read-only **R**, writes no
file.

Also surfaces the per-phase active team (resolved via
`resolveTeamFile(root, slug, null)` — consults `.current` then legacy;
reports "none for this phase" if absent).

## Args & local flags

- Args: — (no positional)
- `--no-index` — per-invocation bypass of the optional read-through cache,
  forcing a one-shot filesystem scan (Invariant FS-CANONICAL: the filesystem
  stays canonical; the index is never authoritative and never required).

## Gates

None — **R** (read-only).

## Output

Prints state (no file written).

## Run-start preflight (settings-control-and-tmux U3/U6)

At the very top — before any filesystem scan and before the lightweight
run-trace — the run-trace CLI runs this preflight for you; you do **not** call
`runStartPreflight` yourself.

Since wave 2 the run-trace CLI is the **sole caller** of `runStartPreflight`
(`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`): it resolves the 7-source inheritance chain,
validates closed keys, probes tmux, and detects providers. `status` uses the
lightweight run-trace path (start-and-close at once), so the resolved snapshot
is not persisted for lightweight runs — but the tmux/provider resolution stays
consistent with other commands. Read any resolved config for an existing run
with `readResolvedSettingsSnapshot(runId, { cwd })`.

## Run recording

At the very top of the command body — before any filesystem scan — record a
lightweight status run (SC-B OQ6, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js status \
  --cwd "$(pwd)"
```

This uses the dedicated `status` sub-command of `run-trace.js`, which calls
`recordStatusLightweight`. Gate: if `settings.json record_status_runs: false`,
the call is a no-op (pure-read path restored). On the recorded path, writes
only `run.yaml` + `provenance.json` to `.guild/runs/` — never touches
wiki/decisions/indexes/initiatives. The "status is read-only" contract is
preserved; only a lightweight replay trace is added. No `--initiative` flag;
no `--run-class` flag (the `status` sub-command forces `lightweight`
internally via B3).

## Dispatch

Thin orchestrator-read entrypoint. Resolve run state by filesystem scan
(or the optional `.guild/index.sqlite` read-through cache unless
`--no-index`), then print furthest phase, next pending gate, blockers, and
the per-phase active team (resolved via `resolveTeamFile(root, slug, null)` —
consults `.current` then legacy; reports "none for this phase" if absent).
When the resolver returns a legacy `<slug>.yaml` (no per-phase file exists),
surface once: *"single-file team.yaml is legacy; re-compose to adopt
per-phase teams."* (status is read-only — surfaces the notice, never acts on
it). No `.guild/` data writes.
