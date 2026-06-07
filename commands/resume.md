---
name: resume
description: "Orchestrator — continue the active run from the next pending gate. --restart clears run state and re-runs from Init/Ideation (confirm-before-clear)."
argument-hint: "[--no-index] [--restart]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:resume — lifecycle helper

Continues the active run from the next pending gate. **No phase** — acts on
the active run.

Canonical surface: `architecture/command-surface.md §3.2` (resume row) +
`§4.1`. `--restart` replaces the v1 first-word `$ARGUMENTS` `--restart` hack.

## Args & local flags

- Args: — (no positional)
- `--no-index` — per-invocation filesystem-scan bypass of the optional
  read-through cache (Invariant FS-CANONICAL, by pointer
  `command-surface.md §5.3`).
- `--restart` — clears run state and re-runs from Init/Ideation
  (**confirm-before-clear I**).

## Gates

Resumes at the next **I** gate. `--restart` adds a confirm-before-clear **I**
gate.

## Output

Continues the active run's phase artifacts (no new artifact kind introduced).

## Run-start preflight (settings-control-and-tmux U3/U6)

Before locating the next pending gate — run the preflight
(`scripts/lib/runstart-preflight.ts`; canonical contract in `guild.md
§Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. `resume` continues an existing run: the snapshot for the active run is
   already on disk (written at the original run-start). Read it back with
   `readResolvedSettingsSnapshot(runId, { cwd })` rather than overwriting it.
   The preflight result is used only for the tmux/provider check — it does not
   replace the locked-in snapshot for the resumed run.
4. **Re-enter resumable dead lanes (R-016).** Before locating the next pending
   gate, list any resumable dead lanes for the active run:
   `npx tsx ${PLUGIN_ROOT}/scripts/resume-lanes.ts <runDir> --json` (the
   `--json` flag is required for the parseable bare array; without it the CLI
   prints a human table — scans
   `<runDir>/lanes/*/resume.json`, applies the `guild.lane_resume.v1` version
   guard, honors `defaults.resume.enabled`). For each returned lane, re-enter it
   via `guild:execute-plan`'s `## Resuming dead lanes (R-016)` path — a fresh
   dispatch from the checkpoint with a fresh retry budget (prior attempts are
   preserved in the checkpoint for audit, not subtracted). An empty list ⇒ skip
   straight to the next step (exactly today's behavior).
5. Proceed to gate continuation.

## Dispatch

Thin orchestrator-continue entrypoint. **First** re-enter any resumable dead
lanes (R-016, step 4 above) via `guild:execute-plan`'s `## Resuming dead lanes`
path; **then** locate the next pending gate (filesystem scan, or the optional
cache unless `--no-index`) and resume. On `--restart`, confirm, clear run state,
and re-enter from Init/Ideation. Phase logic and `.guild/` writes live in the
phase skill set.
