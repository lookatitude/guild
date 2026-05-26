---
name: guild-execute-plan
description: For each specialist lane in the plan: invoke `guild:context-assemble` to build the bundle, then dispatch each lane via the agent_mode-resolved backend (agent-team / tmux visible panes is primary under tmux; subagent is the fallback for CI / no-tmux). Parallelize lanes when `depends-on:` allows. Collect per-lane handoff receipts at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`. TRIGGER: "execute the plan", "run the lanes", "start specialist work", "dispatch the team". DO NOT TRIGGER for: explaining the plan (guild:plan owns that), reviewing results (guild:review), writing more tests.
when_to_use: Fifth step of Guild lifecycle, after plan approved and per-specialist context bundles staged.
type: meta
---

# guild:execute-plan

Implements `guild-plan.md §8` (task lifecycle — execute step). Runs after `guild:plan` has produced an approved `.guild/plan/<slug>.md` and before `guild:review`. Dispatches every specialist lane per the DAG encoded by the lanes' `depends-on:` edges, and gathers one handoff receipt per lane into a single run directory `guild:review` consumes verbatim.

## Input

Three things, all required:

1. `.guild/plan/<slug>.md` — the approved per-specialist lane plan. Must have frontmatter `approved: true`; if approval is missing, refuse to dispatch and loop back to `guild:plan`'s approval gate.
2. `.guild/team/<slug>.yaml` — the resolved team from `guild:team-compose`. Authoritative for the execution backend (`subagent` vs `agent-team`) and per-specialist agent-definition paths.
3. `.guild/runs/<run-id>/` — a new run directory created at execute-start. `<run-id>` is a timestamp or run slug owned by this skill; every context bundle, handoff receipt, and assumption log roots under it.

Do not re-derive lanes from chat or from the spec. The plan is the single source of truth for what gets dispatched.

## Per-lane flow

Three strict phases per lane. A lane does not advance until the previous phase has produced its artifact:

1. **Context bundle.** Invoke `guild:context-assemble` for the lane; it writes `.guild/context/<run-id>/<specialist>-<task-id>.md` per §9.3. Read back the bundle's handoff receipt to confirm `bundle_path`, `token_estimate`, `layers_included`. A missing bundle blocks the dispatch — do not paper over with chat context.
2. **Dispatch.** Invoke the specialist using the backend selected in `team.yaml`, passing the bundle path as the primary task brief. Routing rules and backend mechanics: see `dispatch.md`.
3. **Receipt.** Confirm the specialist wrote its handoff receipt to `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` per §8.2. A missing or malformed receipt (no `evidence:` field, no `files changed`) → treat the lane as errored, record the failure in the run log, and do not mark it complete.

A specialist dispatched without a bundle violates the context contract (§9); one that completes without a receipt violates the handoff contract (§8.2). Either condition blocks `guild:review`.

## Backend + routing (summary)

The backend is **not** chosen here — it is chosen at `guild:team-compose` time and mirrored into `team.yaml`. This skill reads and honors that choice. Three invariants you enforce at dispatch — full detail (backend table, launcher invocation, self-build routing table, parallelism rules) in `dispatch.md`:

- **Honor the `agent_mode`-resolved backend; team is primary under tmux.** The backend recorded in `team.yaml` comes from the `agent_mode` ladder (ADR D5) — under tmux that is `agent-team` (one **visible pane per specialist**), with `subagent` only as the fallback (CI / no tmux). Whatever the backend, dispatch each lane to its **named specialist agent** — `subagent_type: <name>` (`backend`, `qa`, `devops`, `architect`, …) for subagents, the teammate spawned from that same agent definition for teams — **never `general-purpose`**, which discards the named agent's persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries (a defect). The name is the lane's `owner_role`, resolved against `team.yaml`'s agent-definition paths.
- **Self-build uses the dev-team, not the product specialists.** When the target repo IS the Guild plugin itself, `team.yaml` is composed from the dev-team agents under `.claude/agents/`, routed by changed path (full roster + path table in `dispatch.md`; see also `CLAUDE.md §"Dev team"`). The 14 `guild:` product specialists build *user* products; they are NOT the self-build team.
- **`agent-team` needs explicit user approval + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.** If either is missing, refuse and surface the blocker — never silently fall back to subagents (that would change execution semantics out from under the plan).

Parallelism follows the DAG, not authoring order; scheduling rules and worktree isolation live in `dispatch.md`.

## Codex adversarial review per lane (when `codex_review: true`)

If the run context has `codex_review: true`, invoke `guild:codex-review` after each lane's receipt is confirmed and before the next lane dispatches (or before `guild:review` for the final lane):

```
Skill: guild-codex-review
args: gate=G-lane:<task-id> artifact_path=.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md run_id=<run-id>
```

Substitute `<task-id>` with the lane's task-id (e.g. `T2-backend`); run per-lane in series after the receipt is confirmed. On `status: "rework"`, the lane re-executes — clear its receipt and re-dispatch the specialist with Codex's findings as added context; the re-run counts against `counters.json` key `restart:<lane>` (shared with the L3/L4 cap). On `"satisfied"`, `"skipped"`, or `"force_passed"`, advance normally.

## Receipt collection

This skill does not author receipts — it confirms each exists at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`, is readable, and carries the §8.2 fields (scope, files changed, decisions, assumptions, evidence, risks, follow-ups). `guild:review` and `guild:verify-done` read these receipts instead of rehydrating full conversations (§8.2), so receipt integrity is load-bearing.

**Assumption aggregation.** Before the stop condition, aggregate every receipt's `assumptions:` list into `.guild/runs/<run-id>/assumptions.md` (one section per specialist, verbatim). If no lane reported assumptions, still create the file empty (header only) so `guild:verify-done` can tell "no assumptions" from "aggregation skipped" — it is the single handoff verify-done reads for its check #5.

## Stop condition

Execution is complete when every lane has a non-error receipt under `handoffs/`:

- receipt count equals lane count in the plan;
- every receipt has a populated `evidence:` field (§8.2 — never "looks good");
- no receipt is blocked/errored without a matching error record in the run log.

If any lane errored, halt and surface the failure to the user rather than forwarding to `guild:review` — review cannot compensate for a missing receipt. If every lane is clean, hand off to `guild:review`.

## Handoff

Once the stop condition is met, hand off to `guild:review` with:

- `run_id` — the run directory name.
- `handoffs_dir` — absolute path to `.guild/runs/<run-id>/handoffs/`.
- `plan_path` — the approved plan (`.guild/plan/<slug>.md`).
- `lane_count` — number of receipts collected.
- `backend` — the backend used (`subagent` or `agent-team`), mirrored from `team.yaml`.

`guild:review` runs its 2-stage per-task review (spec-conformance then quality) against the receipts in `handoffs_dir`. Do not run review yourself — it is a separate skill with its own responsibilities.
