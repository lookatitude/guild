---
name: resume
description: "Orchestrator — continue the active run from the next pending gate. --restart clears run state and re-runs from Init/Ideation (confirm-before-clear)."
argument-hint: "[--no-index] [--restart]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:resume — lifecycle helper

Continues the active run from the next pending gate. **No phase** — acts on
the active run.

`--restart` replaces the v1 first-word `$ARGUMENTS` `--restart` hack.

## Args & local flags

- Args: — (no positional)
- `--no-index` — per-invocation filesystem-scan bypass of the optional
  read-through cache (Invariant FS-CANONICAL: filesystem is always the
  authoritative source).
- `--restart` — clears run state and re-runs from Init/Ideation
  (**confirm-before-clear I**).

## Gates

Resumes at the next **I** gate. `--restart` adds a confirm-before-clear **I**
gate.

## Output

Continues the active run's phase artifacts (no new artifact kind introduced).

## Run-start preflight (settings-control-and-tmux U3/U6)

`resume` continues an existing run, so its resolved-settings snapshot is
already on disk — `run-trace.js start` wrote it at the original run-start (since
wave 2 the run-trace CLI is the **sole caller** of `runStartPreflight`;
`scripts/lib/runstart-preflight.ts`; canonical contract in `guild.md §Run-start
preflight`). Do **not** re-run the preflight or overwrite the snapshot for the
resumed run: read it back with `readResolvedSettingsSnapshot(runId, { cwd })`.

**Re-enter resumable dead lanes (R-016).** Before locating the next pending
gate, list any resumable dead lanes for the active run:
`npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/resume-lanes.ts <runDir> --json` (the
`--json` flag is required for the parseable bare array; without it the CLI
prints a human table — scans
`<runDir>/lanes/*/resume.json`, applies the `guild.lane_resume.v1` version
guard, honors `defaults.resume.enabled`). For each returned lane, re-enter it
via `guild:execute-plan`'s `## Resuming dead lanes (R-016)` path — a fresh
dispatch from the checkpoint with a fresh retry budget (prior attempts are
preserved in the checkpoint for audit, not subtracted). An empty list ⇒ skip
straight to the next step (exactly today's behavior). Then proceed to gate
continuation.

## Dispatch

Thin orchestrator-continue entrypoint. **First** re-enter any resumable dead
lanes (R-016, step 4 above) via `guild:execute-plan`'s `## Resuming dead lanes`
path; **then** locate the next pending gate (filesystem scan, or the optional
cache unless `--no-index`) and resume. On `--restart`, confirm, clear run state,
and re-enter from Init/Ideation. Phase logic and `.guild/` writes live in the
phase skill set.
