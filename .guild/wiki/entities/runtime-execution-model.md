---
type: concept
owner: architect
confidence: high
importance: high
source_refs:
  - plugin/.guild/wiki/entities/runtime-execution-model.md
  - plugin/scripts/lib/settings-resolver.ts
  - plugin/scripts/lib/runstart-preflight.ts
  - plugin/scripts/lib/run-lifecycle.ts
  - .guild/initiatives/active/settings-control-and-tmux/briefing.md §10
  - .guild/initiatives/active/settings-control-and-tmux/decisions.md OD-2,OD-3
applies_to: [plugin]
related:
  - architecture-overview
  - target-architecture
  - edge-cases
  - team-composition
  - cost-tiering-and-context-management
created_at: 2026-05-28
updated_at: 2026-06-01
sensitivity: internal
---

# Runtime and Execution Model

Canonical reference for Guild's multi-agent execution model: the D5 dispatch ladder,
ephemeral §task§agent lifecycle, hook-based coordination, DAG parallelism, handoff
envelope, and the gap analysis + recommended extensions for resumability and cross-host
execution. Distilled from `.guild/research/runtime-execution-model.md` (2026-05-26).

## D5 `agent_mode` Dispatch Ladder

`agent_mode: team | agent | subagent | auto` (default `auto`; resolved from the
7-source settings chain) governs backend selection. The backend is resolved
**once** at run-start intake by `runStartPreflight` and frozen in the
resolved-settings snapshot (`snapshot.effective.agent_mode`); phases read it via
`readResolvedSettingsSnapshot` — they do not re-resolve or re-select per phase
(see §"tmux backend selection is now phase-wide" below). With `auto`, the ladder
resolves in order:

1. `$TMUX` set → **team** (in-session new window, one pane per specialist)
2. tmux installed → **team** (new detached session + attach)
3. Host supports independent agents (`GUILD_INDEPENDENT_AGENTS_SUPPORTED`) → **agent**
4. Else → **subagent** (fallback)

Invariants: one team per session; collision-refuse (not clobber); env gate
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` required for `team` mode. `team.yaml`
records the resolved backend as a mirror for audit only — it is not the
authority. Source of truth: `plugin/scripts/lib/runstart-preflight.ts`,
`settings-resolver.ts`, `run-lifecycle.ts` + ADR D5.

### tmux backend selection is now phase-wide and settings-driven (shipped 2026-06-01)

`agent_mode` is resolved from the full 7-source settings chain
(`built-in < workspace < workspace-local < project < project-local < rigor <
CLI`) at **command intake** (run-start preflight), before `run-trace start`.
All phases in the same run use the
backend recorded in `resolved-settings.json` — mid-run config edits do not change
the backend for the current run (AC-10 invariant). This means backend selection is no
longer deferred to `team-compose` or `execute-plan`; it is settled at session intake
for every `/guild:*` command.

The run-start preflight additionally probes tmux. The prompt condition is
evaluated **every run**:
`needsTmuxPrompt = tmux.available && effective agent_mode != "team"` (OD-3 —
`auto` DOES trigger it). On **yes**, `agent_mode: "team"` is persisted at
workspace scope, so subsequent runs resolve `team` and the condition is false
(no further prompting). On **no** nothing is persisted, so the same condition
holds next run and the prompt **may fire again** — it is not a one-shot flag.
Source: `plugin/scripts/lib/runstart-preflight.ts`.

The `agent_mode` key **inherits** from workspace to child projects via the resolver.
A workspace root that sets `agent_mode: "team"` propagates it to all child projects
that have no override. Source: `plugin/scripts/lib/settings-resolver.ts`.

## §task§agent Lifecycle (Ephemeral)

Sequence: **spawn → work → extract → dismiss**. One agent per task, never shared.
On completion, `learnings[]` are extracted into `guild.handoff.v2` envelope, written
to `.guild/runs/<run-id>/learnings/`, then the agent terminates. No idle agents persist.
This lifecycle is orthogonal to D5 — applies on any backend.
[source: `.guild/research/runtime-execution-model.md §2.2`]

## Hook-Based Coordination

`hooks.json` wires three agent-team events:
- **TaskCreated** (`task-created.ts`): validates owner assignment + output contract +
  depends-on references before enqueue.
- **TaskCompleted** (`task-completed.ts`): validates the `guild.handoff_receipt.v1`
  markdown receipt. A **present but schema-invalid** embedded `guild.handoff.v2`
  block is rejected **unconditionally**; a **missing** block **fails closed** on a
  new / post-effective-date receipt (grandfathered/indeterminate-date receipts
  routed leniently via the OD-4 discriminator — grandfathering applies only to the
  missing case). Extracts learnings; signals §task§agent dismiss. Format
  contract: [`../decisions/communication-format-policy.md`](../../../../.guild/wiki/decisions/communication-format-policy.md)
  §"Handoff contract".
- **TeammateIdle** (`teammate-idle.ts`): nudges stale teammates via stdout message to
  orchestrator; checks receipt absence and in-progress log freshness (10-min stale
  threshold — heuristic, not structured).

Additional hooks: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PreCompact`, `SubagentStop`, `Stop`.

## `guild.handoff.v2` Envelope

The in-flight typed return schema. Fields: `schema_version`, `task_id`, `tier`,
`status` (`done|blocked|escalate`), `summary` (≤100 tokens), `artifacts`, `issues`,
`escalate_reason`, `learnings`, `notes`. Lint rejects free-form bloat.
[source: `.guild/research/runtime-execution-model.md §2.5`]

## DAG Parallelism Model

DAG encoded in each lane's `depends-on:`; `guild:dispatching-parallel-agents` fans out
independent lanes concurrently. Worktree isolation required for parallel writes.
Orchestrator gates dependent lanes until predecessor receipts land. Architect-first rule
when a lane is a common dependency.

## Production Context: tmux vs. Durable Execution

**tmux as agent runtime** is a well-documented 2025 production pattern: each agent runs
in its own tmux pane; `capture-pane` reads output; `send-keys` injects new tasks; one
crashing agent does not cascade. A gateway daemon pattern adds a work-queue (directory
of markdown task files) + launchd scheduling + stall-signal notification.
[source: `.guild/research/runtime-execution-model.md §1.1`]

**Durable execution engines** (Temporal, Restate, LangGraph checkpointer) deliver
stronger guarantees: every external interaction is journaled; on crash the workflow
replays from the last completed step. Not compatible with Guild's zero-infra plugin
model at v2.0. Guild's recommended approach is **filesystem checkpointing** (the
DBOS-style pattern): a `run-state.json` in `.guild/runs/<run-id>/` records DAG
execution state written atomically after each lane completes.
[source: `.guild/research/runtime-execution-model.md §4.1`]

## Gap Analysis and Recommended Extensions

These gaps inform the v2.x roadmap. None are blocking for v2.0 but each has a defined
resolution [source: `.guild/research/runtime-execution-model.md §3–4`]:

### G-1: No Resumability for Long Multi-Wave Programs (Critical)

Guild has no mechanism to resume an interrupted multi-wave execution. No checkpoint of
DAG execution state; no event journal; no replay path.

**Resolution (ADR-RE-1):** `run-state.json` written atomically by `TaskCompleted` hook
after each lane. Schema: `{ run_id, plan_slug, wave, lanes: { [id]: status }, last_checkpoint_at }`.
`/guild:resume` reads it to reconstruct orchestrator context. Resolves G-1 and G-7
(in-memory DAG state).

### G-2: No Failure-Recovery at Orchestrator Level

When a lane fails, `TeammateIdle` nudges but does not retry. No retry policy, backoff,
or lane-level idempotency.

**Resolution (ADR-RE-2):** `retry: { max_attempts, backoff: immediate|linear|exponential }`
in `team.yaml` lane schema (default: `max_attempts: 1`). Retry re-dispatches with same
context bundle + `retry_context` annotation. Destructive/network ops require operator
re-approval across retries (always-ask hard set applies unconditionally).

### G-3: Stall Detection is Heuristic Only

`TeammateIdle` uses a 10-min `mtime` threshold on an in-progress log file. No heartbeat
protocol; no structured progress signal.

**Resolution (ADR-RE-3):** Agents write JSON progress heartbeats to
`.guild/runs/<run-id>/in-progress/<specialist>.json` with `{ timestamp, step, pct_complete }`.
`TeammateIdle` parses structured heartbeats; stale threshold configurable via
`defaults.heartbeat_timeout_ms` (default 600000 ms). Falls back to `mtime` if JSON absent.

### G-4: No Cross-Host Execution Protocol (T3 Blocker)

D5 ladder detects host at session start via env vars. No capability advertisement across
claude/codex/gemini hosts; no task delegation protocol; no reconnect after interruption.

**Resolution (ADR-RE-5):** `host-capability.json` schema at `.guild/hosts/<host-id>/`.
Each host declares: `host_id`, `supported_tiers[]`, `supported_backends[]`,
`agent_api_version`, `tool_permissions[]`. At session start the orchestrator loads
manifests and uses them for per-task routing. Guild's lightweight A2A/ACNBP analog —
no external service.
[source: `.guild/research/runtime-execution-model.md §1.2`, citing Google A2A and arXiv 2506.13590]

### G-5: tmux Is the Only Team Backend (No Portable Abstraction)

The launcher directly calls tmux commands. No abstract `TeamBackend` interface.

**Resolution (ADR-RE-4):** `TeamBackend` interface with `TmuxTeamBackend` (current,
unchanged) and `InProcessTeamBackend` (subagent-style, no tmux, for CI). The D5 ladder
instantiates the correct backend. This decouples D5 from tmux specifics and creates
the seam for `RemoteTeamBackend` (T3).

### G-6: No Multi-Wave Run State Machine

Multi-wave programs span multiple `/guild:build` invocations. No durable state machine
tracking which waves completed, which are in-flight, and what the hand-off state is
between waves.

**Resolution (ADR-RE-6):** `run-manifest.json` at `.guild/runs/<slug>/manifest.json`
(slug-scoped). Records: `program_id`, `plan_slug`, `waves[]` with
`{ wave_index, run_id, status, started_at, completed_at, handoff_summary }`.
`/guild:resume` and `/guild:status` read this.

## Cross-Dependencies

- **Security (prompt-injection-defenses.md):** ADR-RE-5 (capability manifest) introduces
  a new trust boundary — host manifests must be authenticated to prevent capability
  spoofing; cross-host task routing must propagate the always-ask hard set.
- **Observability (observability-trace-schema-v2.md):** ADR-RE-1 (run-state checkpoint)
  and ADR-RE-3 (heartbeat) must write to `.guild/runs/<run-id>/` paths that the telemetry
  hooks can index — consistent with the established run directory layout.
- **T3 cross-host cluster:** ADR-RE-4 (`TeamBackend`) is the direct seam for
  `RemoteTeamBackend`; ADR-RE-5 (capability manifest) is the T3 cluster discovery
  protocol; ADR-RE-6 (multi-wave manifest) must be accessible across hosts.
