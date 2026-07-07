---
name: fix
description: "Maintenance — diagnose a failed/suspicious Guild run, produce a fix plan, and optionally apply approved fixes. The v2 surface of the v1 diagnose command (verb rename diagnose→fix; --codex-review→--review=cross). Requires an explicit edit-approval gate."
argument-hint: "[run-id | \"symptom\"] [--review=cross]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:fix — maintenance verb (the v2 diagnose entry)

The v2 maintenance entry for diagnosing Guild's own runtime failures and
applying gated fixes. This is the **renamed v2 surface of the v1 diagnose
command** — verb rename diagnose→`fix`; flag-migrated
`--codex-review` → `--review=cross`. The `guild:diagnose` skill is retained
internally; only the command verb changed (`command-clean-slate.md #5`). The
v1→v2 mapping details are in the [migration guide](https://guildstack.dev/docs/migration-v1-to-v2).

Maps to skill `guild:diagnose`.

## Usage

```
/guild:fix
/guild:fix run-2026-05-18-ab12
/guild:fix "hooks not firing after a /guild:guild run"
/guild:fix run-2026-05-18-ab12 --review=cross
```

Arguments are optional. A run id diagnoses that run first; free text is the
observed symptom; neither ⇒ inspect the most recent `.guild/runs/*`.

## Args & local flags

- Args: `[run-id | "symptom"]`
- `--review=cross` — routes the G-diagnose gate through `guild:review-broker`
  for cross-host (Claude↔Codex) adversarial review of the diagnosis / fix
  plan (replaces v1 `--codex-review`). The broker is invoked inside
  `guild:diagnose` (skill-internal gate — not the command layer).

## Gates

- Explicit edit-approval **I** (no file is edited before approval)
- G-diagnose review **A** (when `--review=cross` active; skill-internal,
  invoked inside `guild:diagnose` via `guild:review-broker`)

## Output

`.guild/` diagnosis + fix-plan.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the diagnose skill is invoked — and before run-trace start — run the
preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` — U6 writes
   `.guild/runs/<id>/resolved-settings.json` + `settings_ref` in `run.yaml`.
4. Proceed to run-trace start.

## Run recording

Before the diagnose skill is invoked, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:fix \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before telemetry scan so the
complete session — diagnosis, fix plan, and the explicit edit-approval gate —
is replayable from the entrypoint. No `--initiative` flag (fix runs are
one-off; NN#5).

## Dispatch

```
Skill: guild:diagnose
args: $ARGUMENTS
```

The skill reads recent `.guild/runs` telemetry, produces a diagnosis + fix
plan, asks for explicit user approval before editing any file, applies only
approved scoped fixes, and reports changed files + the diagnosis report path.
