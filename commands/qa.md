---
name: qa
description: "Quality — full guild:quality skill [v2]: auto-selects E2E/smoke/a11y/perf/integration from CodebaseMap + plan signals (selection matrix surfaced before execution as [proceed] / [edit-selection] / [explain-signals], overridable, never silent — there is no --classes= flag), executes discovered harnesses under the run sandbox + budgets; qa-test-strategy producer vs security+architect G-quality challenger; opt-in phase, never auto-entered"
argument-hint: "[run-id]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:qa — phase: Quality `[v2]`

The **Quality** phase entrypoint — the full `guild:quality` skill `[v2]`
(promoted from the v1 gap-report-only `verify-done` extension). It
auto-selects the E2E/smoke/a11y/perf/integration class matrix from
`CodebaseMap` + plan signals (the matrix is **surfaced before execution as
`[proceed] / [edit-selection] / [explain-signals]`, overridable, never
silent — there is no `--classes=` flag**) and executes the discovered
harnesses under the run sandbox + budgets. Producer `qa-test-strategy` vs
`security+architect` G-quality challenger. **Opt-in phase — never
auto-entered, never silently skipped** (`command-surface.md §6` edge-label
caveat).

Promotion behaviour is canonical in `architecture/command-surface.md §3.1`
(Quality `[v2]` row) — bound by pointer, not re-spelled. Verb↔phase edge:
`§6` (D-14: `/guild:qa` → Quality). Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding (by pointer — never re-spelled)

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** — bound by pointer through
`docs/knowledge/implementation/contract-map.md §A` row 6 →
`architecture/target-architecture.md §"phase_entry contract"`. The Quality
result is the frozen `guild.quality.v1` contract — bound by pointer to
`contract-map.md §A` row 7 → `target-architecture.md §588–637`. Quality
budgets are consumed by pointer from `defaults.quality.budget`
(`command-surface.md §4.4`, `P1-config-001`) — not re-spelled.

## Usage

```
/guild:qa
/guild:qa run-2026-05-18-ab12
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer).

## Args & local flags

- Args: `[run-id]`
- Local flags: — (no `--classes=` flag; selection is surfaced + overridable)

## Gates (default)

- Release / blocker gate **I** (a BLOCK→release override is **not** a soft
  gate — it stays human-gated even under `--auto-approve=all`;
  `MIGRATION.md §6`, by pointer)
- G-quality review **A**

## Output artifact

`.guild/runs/<run-id>/quality/<run-id>.md` (frozen `guild.quality.v1`;
evidence under `quality/evidence/`).

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the quality skill is invoked — and before run-trace start — run the
preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` (U6 writes the resolved-settings
   snapshot; all later phases read it back via `readResolvedSettingsSnapshot`).
4. Proceed to run-trace start.

## Run recording

Before the quality skill is invoked, start a run (SC-B, §435):

```bash
node plugin/hooks/dist/run-trace.js start \
  --command=/guild:qa \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

`run-class` default (`full`). Records the run before the SignalScan so the
complete session — class-matrix selection gate, harness execution, and
release/blocker gate — is replayable from the entrypoint. Writes to
`.guild/runs/<run-id>/quality/` — not an initiatives directory (NN#5
unaffected). `--initiative` forwarded only when user-supplied.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Quality phase
by invoking:

1. **`guild:quality`** (`skills/guild:guild-quality`) — the full `[v2]` skill:
   SignalScan → SelectMatrix (surface the selection matrix `[proceed] /
   [edit-selection] / [explain-signals]`, overridable, never silent) →
   RunChecks under the run sandbox + canonical budget → advisory G-quality
   challenger trail → the COMPUTED `ReleaseGate` recommendation.

Input gate: build receipts present (`.guild/runs/<run-id>/handoffs/*.md`).
Output gate: `.guild/runs/<run-id>/quality/<run-id>.md` (frozen
`guild.quality.v1`; evidence under `quality/evidence/`).
Confirmation gates (from **Gates**): release / blocker gate **I** (a
BLOCK→release override stays human-gated even under `--auto-approve=all`) ·
G-quality review **A**. **Opt-in phase — never auto-entered, never silently
skipped.**

Thin phase entrypoint — phase logic and `.guild/` writes live in the
`guild:quality` skill set.
