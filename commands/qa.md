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
`docs/v2/lifecycle.html §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-011.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the quality skill is invoked — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

Before the quality skill is invoked, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:qa \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js phase \
  --phase=qa \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the SignalScan so the
complete session — class-matrix selection gate, harness execution, and
release/blocker gate — is replayable from the entrypoint. Writes to
`.guild/runs/<run-id>/quality/` — not an initiatives directory (NN#5
unaffected). `--initiative` forwarded only when user-supplied.

## Team decision gate (blocking — team-contracts §4/§5)

Before this phase dispatches **any** participant — worker, advisor, challenger,
or local/cross-host reviewer — a **persisted** team decision must authorize it.
An advisory label is never a bypass, and Guild never auto-approves.

1. **Present the proposal** and let the user answer in the decision vocabulary
   — `approve · add · remove · substitute · edit_dependencies · restructure`
   (the four edit verbs record a `restructure`, never an approve). The review
   prints the proposed team, each participant's necessity rationale, excluded
   roles, obligation coverage, and per-kind gate coverage:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/team-decide.ts review \
  --proposal .guild/runs/<run-id>/team-plan/qa.proposal.v<n>.yaml
```

2. **Restructure loop** — idempotent: each pass produces a NEW proposal version
   (parent hash chained, prior versions preserved) and returns to `pending`; it
   never edits approved bytes and never approves anything:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/team-decide.ts restructure \
  --proposal <parent-proposal> --edits <edits.json> \
  --decided-by user --channel interactive_prompt
```

   It prints the user's edits, the **coverage impact** (obligations that lost
   their last owner), and any edit already satisfied by the parent. It exits
   non-zero on an uncited roster change or a re-introduced cap key — a
   specialist can never be dropped silently.

3. **Gate the dispatch** — run this and **STOP on a non-zero exit**. It reads
   the PERSISTED decision trail under `.guild/runs/<run-id>/team-plan/`; an
   in-memory or agent-asserted approval is never accepted:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/team-decide.ts gate \
  --proposal <proposal> --cwd "$(pwd)"
```

Exit `0` authorizes dispatch and prints the final approved team plus the
backend scheduling waves. Exit `3` **BLOCKS** — no persisted decision, a
restructure rather than an approval, a tampered artifact, or a stale /
hash-mismatched decision after any change to a participant, obligation,
dependency, tier/purpose, capability scope, backend, wave structure,
concurrency, cost posture, or review independence. Renewed user approval is
required; never proceed past a refusal.

Backend capacity shapes **waves**, never the roster: if the backend cannot run
the approved team at once, propose waves or another backend and ask. Never drop
a role to fit a host UI or backend.

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
