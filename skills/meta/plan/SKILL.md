---
name: guild-plan
description: Turns an approved `.guild/spec/<slug>.md` plus `.guild/team/<slug>.yaml` into a per-specialist lane plan at `.guild/plan/<slug>.md`. Each lane carries `task-id`, `owner`, `depends-on:`, `scope`, `success-criteria`, and `autonomy-policy` so `guild:execute-plan` can dispatch parallel-where-possible subagents per `guild-plan.md §8`. FORKS `superpowers:writing-plans` rather than referencing — writing-plans emits a generic linear implementation plan; `guild:plan` emits specialist lanes tied to a composed team and feeds Guild's dispatch/review loop. TRIGGER on "turn this spec into a plan", "break the work down by specialist", "what does each role do on this spec", "plan the lanes for this task", "we have a team — now plan the work". DO NOT TRIGGER for: writing the code itself (`guild:execute-plan`), brainstorming a new feature (`guild:brainstorm`), reviewing finished work (`guild:review`), or generic implementation plans outside the Guild lifecycle (use `superpowers:writing-plans`).
when_to_use: Third step of /guild lifecycle, after guild:team-compose has produced .guild/team/<slug>.yaml.
type: meta
---

# guild:plan

Implements `guild-plan.md §8` (task lifecycle — plan step). Runs after `guild:team-compose` has written `.guild/team/<slug>.yaml` and before `guild:context-assemble`. Output is an approved per-specialist lane plan that downstream context assembly and execute-plan dispatch consume verbatim.

## Input

Two files, both required:

1. `.guild/spec/<slug>.md` — the approved spec from `guild:brainstorm`. Authoritative source for goal, audience, success criteria, non-goals, constraints, autonomy policy, and risks (`guild-plan.md §8.1`). Reject planning if any of those seven fields is missing — return control to `guild:brainstorm` instead of silently filling in.
2. `.guild/team/<slug>.yaml` — the resolved team from `guild:team-compose`. Authoritative source for which specialists own which scope, inter-specialist dependencies, and execution backend (`subagent` vs `agent-team`).

Do not infer lanes from chat history outside these two files. If the team.yaml says 4 specialists, you plan 4 lanes; if a user adds scope in chat, loop back to `guild:team-compose` or `guild:brainstorm` rather than expanding the plan unilaterally.

## Output

Write `.guild/plan/<slug>.md`. One top-level heading per specialist lane. Each lane is a structured block:

```markdown
---
type: plan
spec: .guild/spec/<slug>.md
team: .guild/team/<slug>.yaml
backend: subagent  # or: agent-team — mirrors team.yaml
created_at: 2026-04-24
approved: false
---

# Plan: <task title>

## Lane: architect
- task-id: T1-architect
- owner: architect
- depends-on: []
- scope: System boundaries, component split, tradeoff matrix for the pricing service.
- success-criteria:
  - `docs/adr/pricing-service-boundary.md` produced and reviewed.
  - Component split diagram committed under `docs/diagrams/`.
- autonomy-policy:
  - may act without asking: propose component boundaries, write ADR draft.
  - requires confirmation: any breaking change to existing service boundaries.
  - forbidden: editing production code.

## Lane: backend
- task-id: T2-backend
- owner: backend
- depends-on: [T1-architect]
- scope: REST contract + data layer for /pricing endpoints.
- success-criteria:
  - OpenAPI spec committed.
  - Unit tests green on the quote calculator.
- autonomy-policy:
  - may act without asking: create new files under `services/pricing/`.
  - requires confirmation: migrations, new third-party dependencies.
  - forbidden: changing auth middleware.
```

Per-lane field rules:

- **task-id** — unique within this plan. Convention: `T<ordinal>-<specialist>`. Downstream receipts (`guild-plan.md §8.2`) reference it.
- **owner** — exact specialist slug from `team.yaml`. One owner per lane; no shared ownership.
- **depends-on** — list of upstream `task-id`s this lane must wait for. Empty list means the lane is eligible for parallel dispatch from run-start. Dependencies must be a strict DAG — no cycles — and must be consistent with `team.yaml`'s `depends-on:` between specialists.
- **scope** — one-to-two sentences. Bounded responsibility for *this* task only; do not restate the specialist's full remit.
- **success-criteria** — measurable, testable bullets. Vague criteria ("improves code quality") are rejected; a reviewer must be able to say "met" or "not met" at `guild:verify-done`.
- **autonomy-policy** — three sub-bullets (may act / requires confirmation / forbidden) derived from the spec's autonomy policy, narrowed to this lane's scope. This becomes the subagent's permission contract during `guild:execute-plan`.

Parallelism rules from `guild-plan.md §8`:

- Architect first when present — downstream lanes typically list the architect's task-id in `depends-on`.
- Backend → QA: QA depends on backend's task-id.
- DevOps → QA: staging hookup must precede QA's regression run.
- Content and commercial lanes run in parallel with engineering when they only depend on the spec.

The DAG expressed in `depends-on:` is what `guild:execute-plan` reads to schedule parallel dispatches — authoring the edges wrong here leads to either serialized work that could have parallelized or dispatches that start before their inputs exist.

## Approval gate

The plan is **not** handed off to `guild:context-assemble` or `guild:execute-plan` until the user has explicitly approved it. The approval gate is non-negotiable:

- Write the plan with frontmatter `approved: false`.
- Present the plan to the user in a single message — list every lane's task-id, owner, depends-on, scope one-liner, and success criteria.
- Wait for an explicit affirmative ("approved", "go", "ship it" — not "sounds fine" or "ok").
- Flip `approved: true` in the frontmatter and record the approval timestamp.
- Only then emit the handoff to `guild:context-assemble`.

If the user requests changes at the approval gate, edit the plan in place (not a new file) and re-present. The approval gate exists precisely because downstream dispatch runs parallel specialists — a plan error discovered mid-execution is far more expensive to unwind than one caught here.

## Distinction from superpowers:writing-plans

Guild's `plan` skill deliberately shadows `superpowers:writing-plans` and forks rather than references it. `superpowers:writing-plans` produces a generic, specialist-agnostic implementation plan: a linear sequence of steps a single implementer would follow, optimized for a solo coding session. `guild:plan` produces a specialist-lane plan: one lane per role from the composed team, with explicit `depends-on:` edges that feed `guild:execute-plan`'s parallel dispatch, per-lane success criteria that feed `guild:review` and `guild:verify-done`, and per-lane autonomy policies that feed each subagent's permission contract. Use `superpowers:writing-plans` for solo implementation work outside the Guild lifecycle; use `guild:plan` whenever a Guild team has been composed and the next step is dispatching specialists. Choosing wrong either wastes the team composition (solo plan ignores lanes) or over-structures a solo task (lanes without specialists are empty overhead).

## Handoff

Once the plan is written and **user-approved** (frontmatter `approved: true`), hand off to `guild:context-assemble`. That skill is responsible for building one minimum-viable-context bundle per specialist lane (`guild-plan.md §9`) before `guild:execute-plan` dispatches any subagents. Do not run context assembly yourself — `guild:context-assemble` is a separate skill with its own responsibilities.

Handoff receipt should list: `plan_path`, `lane_count`, `parallel_eligible_count` (lanes with empty `depends-on:`), `backend` (mirrored from team.yaml), and `approved_at` timestamp.
