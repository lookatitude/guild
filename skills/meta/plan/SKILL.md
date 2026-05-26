---
name: guild-plan
description: Turns an approved `.guild/spec/<slug>.md` plus `.guild/team/<slug>.yaml` into a per-specialist lane plan at `.guild/plan/<slug>.md`. Each lane carries `task-id`, `owner`, `depends-on:`, `scope`, `success-criteria`, `autonomy-policy`, and a seed `complexity_score`+`tier` (re-scored at dispatch) so `guild:execute-plan` can dispatch parallel-where-possible subagents per `guild-plan.md §8`. FORKS `guild:plan` rather than referencing — writing-plans emits a generic linear implementation plan; `guild:plan` emits specialist lanes tied to a composed team and feeds Guild's dispatch/review loop. TRIGGER on "turn this spec into a plan", "break the work down by specialist", "what does each role do on this spec", "plan the lanes for this task", "we have a team — now plan the work". DO NOT TRIGGER for: writing the code itself (`guild:execute-plan`), brainstorming a new feature (`guild:brainstorm`), reviewing finished work (`guild:review`), or generic implementation plans outside the Guild lifecycle (use `guild:plan`).
when_to_use: Third step of Guild lifecycle, after guild:team-compose has produced .guild/team/<slug>.yaml.
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
- complexity_score: 3   # deterministic auto-score (ADR §2 rubric); ≥3 → powerful
- tier: powerful        # cheap|mid|powerful — chosen tier for this lane
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
- complexity_score: 1   # draft/extract work-type → mid band
- tier: mid             # may be overridden upward by execute-plan's re-score
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
- **complexity_score** — the deterministic auto-score for this lane per the cost-aware-tiering rubric (`docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §2`): sum the signal weights (work-type verb 0/+1/+2, blast-radius/file-count, presence of an upstream `depends-on:` contract, security/correctness sensitivity, prior-attempt escalation +1). Seed it here from the team.yaml `default_tier` and the lane's scope; `guild:execute-plan` **re-scores deterministically at dispatch** (same inputs → same tier), so this value is an authoring estimate the dispatch trace either confirms or supersedes — never a silent pin.
- **tier** — the chosen model tier (`cheap | mid | powerful`) the score maps to via the band cutoffs (`models.thresholds`, default `{mid:1, powerful:3}` — ADR §10, bound by pointer). The author MAY pin a tier upward when the auto-score will under-call a security/correctness-sensitive lane (`tier: powerful` with a one-line rationale in `scope`); this is the **per-lane override**, second in the precedence ladder below the `--model-tier` CLI escape hatch (ADR §2/§10). Leaving `tier` to track `complexity_score` is the default — the band map is authoritative unless the author explicitly pins.

Parallelism rules from `guild-plan.md §8`:

- Architect first when present — downstream lanes typically list the architect's task-id in `depends-on`.
- Backend → QA: QA depends on backend's task-id.
- DevOps → QA: staging hookup must precede QA's regression run.
- Content and commercial lanes run in parallel with engineering when they only depend on the spec.

The DAG expressed in `depends-on:` is what `guild:execute-plan` reads to schedule parallel dispatches — authoring the edges wrong here leads to either serialized work that could have parallelized or dispatches that start before their inputs exist.

## Plan-impact (DiffUnderstanding — brownfield, plug point P2)

When a brownfield `KnowledgeGraph` index exists
(`.guild/indexes/knowledge-graph.json`), run the **P2 plan-impact** producer
before finalizing lanes (`docs/knowledge/architecture/codebase-understanding.md
§"Where it sits"` plug point P2):

```
npx tsx plugin/scripts/understand/diff-understanding.ts --cwd <repo-root> \
  --base <merge-base-with-integration-branch> [--head HEAD] [--run-id <id>]
```

This writes `.guild/runs/<run-id>/diff-understanding.json`
(`guild.diff_understanding.v1` — bound by pointer:
`docs/knowledge/implementation/contract-map.md §A` row 13; never re-spell the
schema). Consume it to sharpen the plan, not to replace judgement:

- `affected_layers` / `affected_nodes` → which specialist lanes the change
  actually touches; scope each lane to its blast radius.
- `blast_radius.risk` (`low|medium|high`) → fold into the lane's
  `autonomy-policy` (high risk ⇒ tighten "requires confirmation").
- `untraced_files` → changed files no graph node explains; call these out as
  scope-gap risks in the relevant lane's `scope` so `guild:verify-done`'s
  scope-check (P3) can reconcile them.

If no graph index exists (greenfield, or deep tier never built), skip silently
— do not block planning and do not fabricate a diff.

## Codex adversarial review (when `codex_review: true`)

If the run context has `codex_review: true`, invoke `guild:codex-review` after writing the plan with `approved: false` and **before** presenting the plan to the user for approval:

```
Skill: guild-codex-review
args: gate=G-plan artifact_path=.guild/plan/<slug>.md run_id=<run-id>
```

If `guild:codex-review` returns `status: "rework"`, revise the plan using Codex's findings before re-presenting to the user. If `status: "satisfied"`, `"skipped"`, or `"force_passed"`, proceed to the user-approval gate normally.

The Codex gate runs between plan write and user-approval. It does not replace user approval.

## Approval gate

The plan is **not** handed off to `guild:context-assemble` or `guild:execute-plan` until the user has explicitly approved it. The approval gate is non-negotiable:

- Write the plan with frontmatter `approved: false`.
- Present the plan to the user in a single message — list every lane's task-id, owner, depends-on, scope one-liner, and success criteria.
- Wait for an explicit affirmative ("approved", "go", "ship it" — not "sounds fine" or "ok").
- Flip `approved: true` in the frontmatter and record the approval timestamp.
- Only then emit the handoff to `guild:context-assemble`.

If the user requests changes at the approval gate, edit the plan in place (not a new file) and re-present. The approval gate exists precisely because downstream dispatch runs parallel specialists — a plan error discovered mid-execution is far more expensive to unwind than one caught here.

## Distinction from guild:plan

Guild's `plan` skill deliberately shadows `guild:plan` and forks rather than references it. `guild:plan` produces a generic, specialist-agnostic implementation plan: a linear sequence of steps a single implementer would follow, optimized for a solo coding session. `guild:plan` produces a specialist-lane plan: one lane per role from the composed team, with explicit `depends-on:` edges that feed `guild:execute-plan`'s parallel dispatch, per-lane success criteria that feed `guild:review` and `guild:verify-done`, and per-lane autonomy policies that feed each subagent's permission contract. Use `guild:plan` for solo implementation work outside the Guild lifecycle; use `guild:plan` whenever a Guild team has been composed and the next step is dispatching specialists. Choosing wrong either wastes the team composition (solo plan ignores lanes) or over-structures a solo task (lanes without specialists are empty overhead).

## Handoff

Once the plan is written and **user-approved** (frontmatter `approved: true`), hand off to `guild:execute-plan`. Execute-plan creates the `<run-id>`, then invokes `guild:context-assemble` once per specialist lane to build the minimum-viable-context bundle (`guild-plan.md §9`) before dispatching the specialist subagent. Do not run context assembly yourself — that's `guild:execute-plan`'s responsibility during per-lane dispatch.

Handoff receipt should list: `plan_path`, `lane_count`, `parallel_eligible_count` (lanes with empty `depends-on:`), `backend` (mirrored from team.yaml), and `approved_at` timestamp.
