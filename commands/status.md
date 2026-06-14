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
run-trace — run the preflight (`scripts/lib/runstart-preflight.ts`; canonical
contract in `guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. `status` uses the lightweight run-trace path (not `startRun`); pass
   `result.snapshot` to the lightweight recorder if/when the lightweight path
   supports it — otherwise this step is a no-op for `status` (the snapshot is
   not written for lightweight runs). The preflight still fires so the tmux
   prompt and provider detection are consistent with other commands.
4. Proceed to the lightweight run-trace.

## Run recording

At the very top of the command body — before any filesystem scan — record a
lightweight status run (SC-B OQ6, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js status \
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
