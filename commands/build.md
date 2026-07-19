---
name: build
description: "Development — context-assemble + dispatch lanes. Backend (agent_mode/tmux) is resolved once at intake via the run-start preflight snapshot — not selected per-phase. Snapshot effective.agent_mode drives lane dispatch (team / agent / subagent)."
argument-hint: "[lane-id]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:build — phase: Development

The **Development** phase entrypoint. Assembles per-specialist context and
dispatches lanes. The backend (`agent_mode`) is resolved once at command
intake via the run-start preflight snapshot — it is not selected per-phase.
`snapshot.effective.agent_mode` (team / agent / subagent) drives lane
dispatch; `execute-plan` reads it from the locked-in snapshot rather than
re-resolving. An optional positional `[lane-id]` re-runs a single lane.

Verb↔phase edge: `/guild:build` → Development. Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract**. The run executes under the
`task_run.autonomy_policy` recorded in the approved plan (the autonomy
contract was set at plan approval; **no new gate**).

## Usage

```
/guild:build
/guild:build lane-backend-001
```

All five global flags + `--dry-run` apply.

## Args & local flags

- Args: `[lane-id]` (re-run one lane)
- Local flags:
  - `--model-tier=cheap|mid|powerful` — top-precedence tiering override;
    forces every lane in this run to the given model tier regardless of
    per-lane plan overrides or the `models:` settings block. Precedence:
    `--model-tier` > per-lane `model_tier:` > `settings.json models:` > built-in.
    Ref: `docs/v2/config-surfaces.html §5`. DRIFT-ANALYSIS CMD-008.

## Gates (default)

- Autonomy contract (set at plan approval) **A**
- G-lane review **A** (per lane, via `guild:review-broker`; policy-gated —
  fires when `risk ≥ high` OR `--review=cross` OR project config requires it)
- Destructive / network ops **I always** (immutable always-ask hard set —
  never relaxed by `--auto-approve`)

## Output artifact

`.guild/context/<run-id>/<specialist>-<task-id>.md` (per-lane context
bundles), `.guild/runs/<run-id>/handoffs/*.md` (`guild.handoff_receipt.v1`),
`.guild/runs/<run-id>/assumptions.md`, `.guild/runs/<run-id>/review.md`,
`.guild/runs/<run-id>/review/G-lane:<task-id>/` (G-lane broker trail per lane),
`.guild/runs/<run-id>/agent-bus/events.ndjson`,
`.guild/runs/<run-id>/verify.md` (`guild:verify-done`), changed files.

PCR-Development must-exist floor: `.guild/context/<run-id>/…`,
`.guild/runs/<run-id>/handoffs/…`, `assumptions.md`, `review.md`,
`agent-bus/events.ndjson`. Binding:
`docs/v2/lifecycle.html §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-007.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before context-assemble begins for the first lane — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

**Backend selection is phase-wide, not phase-local.** `execute-plan` reads
`snapshot.effective.agent_mode` via `readResolvedSettingsSnapshot(runId,
{ cwd })` to determine the dispatch mode (team / agent / subagent). It does
not re-resolve settings or re-select the backend mid-run.

## Run recording

Before context-assemble begins for the first lane, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:build \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js phase \
  --phase=build \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before any lane work so the
complete session — context assembly, dispatch, and reviews — is replayable
from the entrypoint. `--initiative` forwarded only when user-supplied
explicitly; never auto-detected from `.guild/initiatives/` (NN#5).

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Development
phase under the recorded `task_run.autonomy_policy`. **Per lane** (parallel
where `depends-on:` allows; `[lane-id]` re-runs one), invoke in order:

1. **`guild:context-assemble`** (`skills/meta/context-assemble`) — build the
   specialist's 3-layer context bundle (~3k tokens, hard cap 6k).
2. **`guild:execute-plan`** (`skills/meta/execute-plan`) — dispatch the
   specialist using the backend locked in at intake
   (`snapshot.effective.agent_mode` from `readResolvedSettingsSnapshot`) and
   collect the handoff receipt at
   `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`. Each lane runs as
   an **ephemeral one-agent-per-task §task§agent** — spawn at the resolved tier
   → work → extract `guild.handoff.v2` learnings → dismiss; no agent is shared
   across tasks or left idle (orthogonal to the `agent_mode` backend ladder).
   Full lifecycle bound by pointer to `execute-plan §"§task§agent lifecycle"`
   (CMD-003).
2b. **G-lane gate** (`guild:review-broker`, gate `G-lane`) — fires after
    `guild:execute-plan` writes each lane's handoff receipt and before the
    next lane dispatches (or before `guild:review` for the final lane).
    Policy-gated (`risk ≥ high` OR `--review=cross` OR project config);
    resolves `status: skipped` when the gate does not require review. Loop
    until the broker emits `## SATISFIED` on its own line; round cap
    `codex_cap` (default 5); on cap hit, surface force-pass / extend-cap /
    rework to the user. Trail under `.guild/runs/<run-id>/review/G-lane:<task-id>/`
    (packet-<round>.md, result-<round>.json, trail.md). Per
    `docs/v2/adversarial-review.html §Gate ownership` — G-lane is the sole
    command-visible gate for the Development phase; G-spec and G-plan are
    skill-internal. Ref: DRIFT-ANALYSIS CMD-001.
3. **`guild:review`** (`skills/meta/review`) — two-stage per-lane review
   (spec-compliance, then quality) of the handoff receipt; writes
   `.guild/runs/<run-id>/review.md`.

`--rigor=deep` additionally runs **`guild:loop-implement`** (the L3 / L4 /
security-review per-lane adversarial loop) around the lane's primary writer.

Input gate: an approved `.guild/plan/<slug>.md` + the current phase's
`.guild/team/<slug>.<phase>.yaml` (legacy `<slug>.yaml` honored when no
per-phase file exists).
Output gate: handoff receipts, `assumptions.md`, `review.md`, `verify.md`,
changed files.
Confirmation gates (from **Gates**): autonomy contract (set at plan approval)
**A** · G-lane review **A** · destructive / network ops **I always** (never
relaxed by `--auto-approve`).

Thin phase entrypoint — phase logic and `.guild/` writes live in the phase
skill set.
