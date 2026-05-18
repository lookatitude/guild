---
name: guild fix
description: "Maintenance — diagnose a failed/suspicious Guild run, produce a fix plan, and optionally apply approved fixes. The v2 surface of the v1 diagnose command (verb rename diagnose→fix; --codex-review→--review=cross). Requires an explicit edit-approval gate."
argument-hint: "[run-id | \"symptom\"] [--review=cross]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild fix — maintenance verb (the v2 diagnose entry)

The v2 maintenance entry for diagnosing Guild's own runtime failures and
applying gated fixes. This is the **renamed v2 surface of the v1 diagnose
command** — verb rename diagnose→`fix`; flag-migrated
`--codex-review` → `--review=cross`. The `guild:diagnose` skill is retained
internally; only the command verb changed (`command-clean-slate.md #5`). The
exact v1→v2 mapping and the byte-exact redirect string for the removed v1
name live in `MIGRATION.md §2.1/§2.2`.

Canonical surface: `architecture/command-surface.md §3.3` (fix row). Maps to
skill `guild:diagnose`.

## Usage

```
/guild fix
/guild fix run-2026-05-18-ab12
/guild fix "hooks not firing after a /guild run"
/guild fix run-2026-05-18-ab12 --review=cross
```

Arguments are optional. A run id diagnoses that run first; free text is the
observed symptom; neither ⇒ inspect the most recent `.guild/runs/*`.

## Args & local flags

- Args: `[run-id | "symptom"]`
- `--review=cross` — request cross-host (Claude↔Codex) adversarial review of
  the diagnosis / fix plan (replaces v1 `--codex-review`).

## Gates

- Explicit edit-approval **I** (no file is edited before approval)
- `--review` for cross-host review

## Output

`.guild/` diagnosis + fix-plan.

## Dispatch

```
Skill: guild:diagnose
args: $ARGUMENTS
```

The skill reads recent `.guild/runs` telemetry, produces a diagnosis + fix
plan, asks for explicit user approval before editing any file, applies only
approved scoped fixes, and reports changed files + the diagnosis report path.
