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

This is the Quality phase entrypoint `[v2]`. Verb↔phase edge:
`/guild:qa` → Quality. Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract**. The Quality result is the frozen
`guild.quality.v1` contract. Quality budgets are consumed from
`defaults.quality.budget` (set in `.guild/settings.json`; `P1-config-001`).

## Usage

```
/guild:qa
/guild:qa run-2026-05-18-ab12
```

All five global flags + `--dry-run` apply.

## Args & local flags

- Args: `[run-id]`
- Local flags: — (no `--classes=` flag; selection is surfaced + overridable)

## Gates (default)

- Release / blocker gate **I** (a BLOCK→release override is **not** a soft
  gate — it stays human-gated even under `--auto-approve=all`)
- G-quality review **A**

## Output artifact

`.guild/runs/<run-id>/quality/<run-id>.md` (frozen `guild.quality.v1`),
`quality/evidence/*` (per-class harness output), `review/quality/*`
(G-quality broker trail).

PCR-Quality must-exist floor: `.guild/runs/<run-id>/quality/<run-id>.md`,
`quality/evidence/*`, `review/quality/*`. Binding:
`docs/v2/03-lifecycle.md §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-011.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the quality skill is invoked — and before run-trace start — run the
preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` (U6 writes the resolved-settings
   snapshot; all later phases read it back via `readResolvedSettingsSnapshot`).
4. Proceed to run-trace start.

## Run recording

Before the quality skill is invoked, start a run (SC-B, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js start \
  --command=/guild:qa \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js phase \
  --phase=qa \
  --cwd "$(pwd)"
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

Input gate: build receipts present (`.guild/runs/<run-id>/handoffs/*.md`)
**AND a passing `.guild/runs/<run-id>/verify.md`** from the build phase's
`guild:verify-done` gate (Quality↔verify-done invariant 4,
`lifecycle/lifecycle-overview.md §"Ordering"`): Quality runs *after* a
passing verify-done, never instead. `/guild:qa` with no passing `verify.md`
for the run ⇒ **`route-back`** to the Development phase (surface the missing
/ failing verify.md and the route-back — never proceed silently). The only
exception is an explicit operator decision to proceed anyway, which MUST be
recorded in the quality report (`release_decision` rationale names who chose
to proceed without a passing verify.md and why).
Output gate: `.guild/runs/<run-id>/quality/<run-id>.md` (frozen
`guild.quality.v1`; evidence under `quality/evidence/`).
Confirmation gates (from **Gates**): release / blocker gate **I** (a
BLOCK→release override stays human-gated even under `--auto-approve=all`) ·
G-quality review **A**. **Opt-in phase — never auto-entered, never silently
skipped.**

Thin phase entrypoint — phase logic and `.guild/` writes live in the
`guild:quality` skill set.
