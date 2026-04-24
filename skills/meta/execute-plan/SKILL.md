---
name: guild-execute-plan
description: For each specialist lane in the plan: invoke `guild:context-assemble` to build the bundle, then dispatch the specialist via Agent tool (subagent backend, default) or agent-team teammate spawn (opt-in). Parallelize lanes when `depends-on:` allows. Collect per-lane handoff receipts at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`. TRIGGER: "execute the plan", "run the lanes", "start specialist work", "dispatch the team". DO NOT TRIGGER for: explaining the plan (guild:plan owns that), reviewing results (guild:review), writing more tests.
when_to_use: Fifth step of /guild lifecycle, after plan approved and per-specialist context bundles staged.
type: meta
---

# guild:execute-plan

Implements `guild-plan.md §8` (task lifecycle — execute step). Runs after `guild:plan` has produced an approved `.guild/plan/<slug>.md` and before `guild:review`. Dispatches every specialist lane in the plan, per the DAG encoded by the lanes' `depends-on:` edges, and gathers one handoff receipt per lane into a single run directory that `guild:review` will consume verbatim.

## Input

Two files, both required, plus a fresh run directory:

1. `.guild/plan/<slug>.md` — the approved per-specialist lane plan from `guild:plan`. Must have frontmatter `approved: true`. If approval is missing, refuse to dispatch and loop back to `guild:plan`'s approval gate.
2. `.guild/team/<slug>.yaml` — the resolved team from `guild:team-compose`. Authoritative for the execution backend (`subagent` vs `agent-team`) and for per-specialist agent definition paths.
3. `.guild/runs/<run-id>/` — a new run directory created at execute-start. `<run-id>` is a timestamp or run slug owned by this skill; every context bundle, handoff receipt, and assumption log for this execution is rooted under it.

Do not re-derive lanes from chat or from the spec. The plan is the single source of truth for what gets dispatched.

## Per-lane flow

For each lane, the flow is three strict phases. A lane does not advance to the next phase until the previous one has produced its artifact:

1. **Context bundle.** Invoke `guild:context-assemble` for the lane. It writes `.guild/context/<run-id>/<specialist>-<task-id>.md` per `guild-plan.md §9.3`. Read back the bundle's handoff receipt to confirm `bundle_path`, `token_estimate`, and `layers_included`. A missing bundle blocks the corresponding dispatch — do not paper over with chat context.
2. **Dispatch.** Invoke the specialist using the backend selected in `team.yaml` (see `## Backend choice`). Pass the bundle path as the primary task brief. The specialist's `agents/<name>.md` supplies skills and autonomy policy when running as a subagent; when running as an agent-team teammate, name the bundle and any required skill playbooks explicitly in the teammate prompt per `guild-plan.md §9.3`.
3. **Receipt.** Confirm the specialist wrote its handoff receipt to `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` per `guild-plan.md §8.2`. If the receipt is missing or malformed (no `evidence:` field, no `files changed`), treat the lane as errored — record the failure in the run log and do not mark the lane complete.

Lanes do not skip phases. A specialist that dispatches without a bundle violates the context contract (§9); a specialist that completes without a receipt violates the handoff contract (§8.2). Either condition blocks `guild:review`.

## Backend choice

Per `guild-plan.md §7.3`, Guild supports two execution backends:

| Backend | Default? | Use when | Tradeoff |
|---|---:|---|---|
| **Subagents via Agent tool** | Yes | Work is self-contained; results only need to return to the orchestrator. | Lower token cost, simpler cleanup, fewer coordination failures. |
| **Agent teams** | Opt-in | Teammates need to share findings, challenge each other, coordinate dependencies, or run competing hypotheses. | Experimental; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; higher token cost; one team per session; no nested teams. |

The backend is not chosen by `guild:execute-plan`. It is chosen at `guild:team-compose` time and mirrored into `team.yaml`. This skill reads that choice and honors it. Two hard constraints:

- **User approval is required for `agent-team`.** If `team.yaml` specifies `backend: agent-team`, confirm the user has explicitly approved the opt-in (the approval is recorded in `team.yaml` by `guild:team-compose`). If the environment variable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is not set, refuse to dispatch and surface the blocker to the user rather than silently falling back to subagents — falling back would change the execution semantics out from under the plan.
- **Subagent is the production default.** Unless `team.yaml` explicitly says `agent-team`, dispatch each lane via the Agent tool against `agents/<specialist>.md`.

## Parallelism rules

Read the DAG encoded by each lane's `depends-on:` and schedule dispatches accordingly, per `guild-plan.md §8`:

- **Architect first when present.** If a lane is owned by `architect`, it is typically a common dependency — most downstream lanes list its `task-id` in `depends-on`. Dispatch architect before any lane that depends on it, and hold the dependents until architect's receipt is written.
- **Backend → QA.** QA's integration work depends on backend deliverables. Never dispatch QA before backend's receipt is present.
- **DevOps → QA.** Staging hookup must precede QA's regression run.
- **Content and commercial in parallel with engineering** when the lane only depends on the spec. A copywriter lane with `depends-on: []` dispatches at run-start alongside architect; it does not wait for engineering.
- **Worktree isolation.** When dispatching two or more lanes in parallel, run each in its own git worktree so file edits cannot collide. The specialist's subagent is responsible for worktree entry/exit; `guild:execute-plan` only needs to confirm the worktree was distinct before marking a lane dispatched. Serial lanes may share the main worktree.

The schedule is a function of the DAG, not of authoring order. Lanes with empty `depends-on:` are eligible at run-start; every other lane becomes eligible the moment every task-id it lists has a completed receipt.

## Receipt collection

Per `guild-plan.md §8.2`, every specialist writes its receipt to:

```
.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md
```

The receipt shape — task completed and scope, files changed, decisions made, assumptions used, evidence, open risks and follow-ups — is fixed by §8.2. `guild:execute-plan` does not author receipts; it only confirms each one exists, is readable, and contains the required fields. After every lane completes, the `.guild/runs/<run-id>/handoffs/` directory should contain exactly one receipt file per lane in the plan.

`guild:review` and `guild:verify-done` read these receipts instead of rehydrating full specialist conversations (§8.2), so receipt integrity is load-bearing for every downstream step. A missing or malformed receipt blocks review for that lane; do not advance to `## Stop condition` until every lane has a clean receipt or an explicit error record.

## Stop condition

Execution is complete when every lane in the plan has a non-error receipt under `.guild/runs/<run-id>/handoffs/`. Concretely:

- Lane count under `handoffs/` equals lane count in the plan.
- Every receipt has a populated `evidence:` field (per §8.2 — never "looks good").
- No receipt is tagged as blocked or errored without a matching error record in the run log.

If any lane errored, halt and surface the failure to the user rather than forwarding to `guild:review` — review cannot compensate for a missing receipt. If every lane is clean, hand off to `guild:review`.

## Handoff

Once the stop condition is met, hand off to `guild:review` with:

- `run_id` — the run directory name.
- `handoffs_dir` — absolute path to `.guild/runs/<run-id>/handoffs/`.
- `plan_path` — the approved plan (`.guild/plan/<slug>.md`).
- `lane_count` — number of receipts collected.
- `backend` — the backend used (`subagent` or `agent-team`), mirrored from `team.yaml`.

`guild:review` runs its 2-stage per-task review (spec-conformance then quality) against the receipts in `handoffs_dir`. Do not run review yourself — it is a separate skill with its own responsibilities.
