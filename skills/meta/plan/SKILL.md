---
name: guild-plan
description: Turns an approved `.guild/spec/<slug>.md` plus the per-phase team file `.guild/team/<slug>.<phase>.yaml` into a per-specialist lane plan at `.guild/plan/<slug>.md`. Each lane carries `task-id`, `owner`, `depends-on:`, `scope`, `success-criteria`, `autonomy-policy`, and a seed `complexity_score`+`tier` (re-scored at dispatch) so `guild:execute-plan` can dispatch parallel-where-possible subagents. FORKS `guild:plan` rather than referencing — writing-plans emits a generic linear implementation plan; `guild:plan` emits specialist lanes tied to a composed team and feeds Guild's dispatch/review loop. TRIGGER on "turn this spec into a plan", "break the work down by specialist", "plan the lanes for this task", "we have a team — now plan the work". DO NOT TRIGGER for: writing the code itself (`guild:execute-plan`), brainstorming a new feature (`guild:brainstorm`), reviewing finished work (`guild:review`), or generic implementation plans outside the Guild lifecycle (use `guild:plan`).
when_to_use: Third step of Guild lifecycle, after guild:team-compose has produced the per-phase team file (.guild/team/<slug>.<phase>.yaml, resolved via resolveTeamFile).
type: meta
---

# guild:plan

Implements the task lifecycle plan step. Runs after `guild:team-compose` has written the per-phase team file (`.guild/team/<slug>.<phase>.yaml`, resolved via `resolveTeamFile`) and before `guild:context-assemble`. Output is an approved per-specialist lane plan that downstream context assembly and execute-plan dispatch consume verbatim.

## Input

Two files, both required:

1. `.guild/spec/<slug>.md` — the approved spec from `guild:brainstorm`. Authoritative source for goal, audience, success criteria, non-goals, constraints, autonomy policy, and risks. Reject planning if any of those seven fields is missing — return control to `guild:brainstorm` instead of silently filling in.
2. The resolved per-phase team file from `guild:team-compose` — **resolved via `resolveTeamFile(guildRoot, slug, readActivePhase(cwd))`** (`scripts/lib/team-file.ts`), which returns `.guild/team/<slug>.<phase>.yaml` (current world) or the legacy `.guild/team/<slug>.yaml` (read-only back-compat). Authoritative source for which specialists own which scope, inter-specialist dependencies, and execution backend (`subagent` vs `agent-team`). **On a `null` return** (no per-phase file and no legacy) → loop back to `guild:team-compose` to run the phase-composition pass; do **not** fabricate a path. **On a legacy hit** (per-phase absent) → emit the one-line deprecation notice once per run: *"single-file team.yaml is legacy; re-compose to adopt per-phase teams."*

Do not infer lanes from chat history outside these two files. If the resolved team file says 4 specialists, you plan 4 lanes; if a user adds scope in chat, loop back to `guild:team-compose` or `guild:brainstorm` rather than expanding the plan unilaterally.

## Output

Write `.guild/plan/<slug>.md`. It carries the right-sized `## PRD` section (or a pointer to the promoted standalone PRD — see `## PRD — always written, right-sized` below) followed by one top-level heading per specialist lane. Each lane is a structured block:

```markdown
---
type: plan
spec: .guild/spec/<slug>.md
team: .guild/team/<slug>.<phase>.yaml   # the RESOLVED path from resolveTeamFile — the per-phase file (or legacy <slug>.yaml on back-compat). NEVER a reconstructed <slug>.yaml (§6 assertion 8: persisted refs carry the resolved path).
backend: subagent  # or: agent-team — mirrors the resolved team file's backend
created_at: 2026-04-24
approved: false
---

# Plan: <task title>

## Lane: architect
- task-id: T1-architect
- owner: architect
- depends-on: []
- spine: true           # T2-backend lists T1-architect in its depends-on — this lane is a spine lane
- consumed-contract:
  - `docs/adr/pricing-service-boundary.md` — pulled by T2-backend (component boundaries it implements against)
  - `docs/diagrams/` component-split diagram — pulled by T2-backend (service boundary shape)
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
- scope: REST contract + data layer for /pricing endpoints, implemented against T1-architect's component boundaries (`docs/adr/pricing-service-boundary.md`) and service-split shape (`docs/diagrams/`).
- success-criteria:
  - OpenAPI spec committed.
  - Unit tests green on the quote calculator.
- autonomy-policy:
  - may act without asking: create new files under `services/pricing/`.
  - requires confirmation: migrations, new third-party dependencies.
  - forbidden: changing auth middleware.
```

Per-lane field rules:

- **task-id** — unique within this plan. Convention: `T<ordinal>-<specialist>`. Downstream handoff receipts reference it.
- **owner** — exact specialist slug from `team.yaml`. One owner per lane; no shared ownership.
- **depends-on** — list of upstream `task-id`s this lane must wait for. Empty list means the lane is eligible for parallel dispatch from run-start. Dependencies must be a strict DAG — no cycles — and must be consistent with `team.yaml`'s `depends-on:` between specialists.
- **scope** — one-to-two sentences. Bounded responsibility for *this* task only; do not restate the specialist's full remit.
- **success-criteria** — measurable, testable bullets. Vague criteria ("improves code quality") are rejected; a reviewer must be able to say "met" or "not met" at `guild:verify-done`.
- **autonomy-policy** — three sub-bullets (may act / requires confirmation / forbidden) derived from the spec's autonomy policy, narrowed to this lane's scope. This becomes the subagent's permission contract during `guild:execute-plan`.
- **complexity_score** — the deterministic auto-score for this lane per the cost-aware-tiering rubric (ADR §2): sum the signal weights (work-type verb 0/+1/+2, blast-radius/file-count, presence of an upstream `depends-on:` contract, security/correctness sensitivity, prior-attempt escalation +1). Seed it here from the team.yaml `default_tier` and the lane's scope; `guild:execute-plan` **re-scores deterministically at dispatch** (same inputs → same tier), so this value is an authoring estimate the dispatch trace either confirms or supersedes — never a silent pin.
- **tier** — the chosen model tier (`cheap | mid | powerful`) the score maps to via the band cutoffs (`models.thresholds`, default `{mid:1, powerful:3}` — ADR §10, bound by pointer). The author MAY pin a tier upward when the auto-score will under-call a security/correctness-sensitive lane (`tier: powerful` with a one-line rationale in `scope`); this is the **per-lane override**, second in the precedence ladder below the `--model-tier` CLI escape hatch (ADR §2/§10). Leaving `tier` to track `complexity_score` is the default — the band map is authoritative unless the author explicitly pins.
- **spine** — `true` when this lane's `task-id` appears in ≥1 other lane's `depends-on:` list; **omit the field entirely** on lanes with no dependents (do not write `spine: false` — its absence on a non-spine lane is itself signal, not a default value to spell out). Compute this deterministically from the DAG you are authoring, not from a role heuristic — architect is the common case (`## Parallelism rules` below) but any lane with downstream dependents qualifies.
- **consumed-contract** — required when `spine: true`; omitted otherwise. One bullet per item a dependent lane's `scope` actually pulls from this lane's receipt (an artifact path, an interface, a schema name, a decision), naming the pulling dependent's `task-id`. See `## Spine lanes — declaration + non-waivable checkpoint` below for why this field exists and what consumes it.

Parallelism rules:

- Architect first when present — downstream lanes typically list the architect's task-id in `depends-on`. This is the common spine-lane shape: mark that lane `spine: true` with a `consumed-contract:` enumeration per `## Spine lanes` below.
- Backend → QA: QA depends on backend's task-id.
- DevOps → QA: staging hookup must precede QA's regression run.
- Content and commercial lanes run in parallel with engineering when they only depend on the spec.

The DAG expressed in `depends-on:` is what `guild:execute-plan` reads to schedule parallel dispatches — authoring the edges wrong here leads to either serialized work that could have parallelized or dispatches that start before their inputs exist.

## Spine lanes — declaration + non-waivable checkpoint

A **spine lane** is any lane whose `task-id` appears in one or more *other* lanes' `depends-on:` — architect is the common case (`## Parallelism rules` above), but any lane with downstream dependents qualifies. The plan MUST declare every spine lane explicitly rather than leave `guild:execute-plan` to infer it from the DAG after the fact:

- Set `spine: true` on the lane block (per-lane field rules above).
- Enumerate `consumed-contract:` on the same lane block — the artifacts, interfaces, schema names, or decisions each dependent's `scope` actually pulls from this lane's receipt, one bullet per item, naming the pulling dependent's `task-id`.

This declaration is authored input, not decoration: it is exactly what `guild:execute-plan`'s **spine-lane verify checkpoint** consumes at dispatch time. That checkpoint's own step 1 ("Enumerate the consumed contract") is written to read this list from the plan rather than reconstruct it from scratch after the spine lane's receipt lands (`skills/meta/execute-plan/SKILL.md §"Spine-lane verify checkpoint"` — bound by pointer; its verification mechanics, ordering chain, and failure handling live there and are not re-spelled here). An incomplete `consumed-contract:` list under-scopes that checkpoint's verification, not just this document — author it as carefully as success-criteria.

**Non-waivable.** The checkpoint execute-plan runs after a spine lane's receipt lands and before any dependent fans out is **NOT waivable by `--auto-approve=all`** — including plans authored under `--rigor=deep --auto-approve=all` and lanes whose own `autonomy-policy` grants broad "may act without asking" latitude. A permissive per-lane `autonomy-policy` governs what that lane's specialist may do unattended; it has no bearing on the cross-lane contract-verification checkpoint execute-plan owns at the fan-out boundary. When any lane in this plan is a spine lane, this non-waivability is a property of the plan, independent of whatever autonomy flags the run carries.

*Evidence: reflection `run-learn-knowledge-convergence-20260529-094021` §P3 — the same run `guild:execute-plan`'s checkpoint traces to.*

## PRD — always written, right-sized (D-P1 / OQ8)

The PRD is **always written, but right-sized** (accepted PRD right-sizing ADR):

- **Default: inline `## PRD` section** inside `.guild/plan/<slug>.md` — placed
  after the frontmatter and before the first `## Lane:` heading. It carries the
  decomposition rationale: the feature list, the user-facing success criteria
  rolled up from the spec, and why the work splits into these lanes.
- **Promote to a standalone `.guild/prd/<slug>.md`** when **any** right-size
  trigger fires:
  1. the plan covers **more than one feature**, OR
  2. the run is **initiative-attached** (an `--initiative` / resolved
     `initiative_default` binds this run to an initiative), OR
  3. the spec's **success-criteria count is >5**.

  On promotion the plan's `## PRD` section is replaced by a one-line pointer
  (`PRD: .guild/prd/<slug>.md`) so downstream consumers always find the PRD
  from the plan. Record which trigger fired in the standalone PRD's
  frontmatter (`right_size_trigger: multi-feature | initiative-attached |
  success-criteria-count`).
- **No new gate.** The PRD — inline or standalone — is approved at the
  existing plan/PRD-approval gate (folded in; there is **no separate G-prd
  gate**). The user-facing gates remain: spec, team, plan/PRD.

Evaluate the triggers deterministically from the approved spec + the run
state — never ask the user whether to promote, and never write the standalone
file when no trigger fires (an unconditional `.guild/prd/<slug>.md` is the
gate-fatigue defect this ADR resolves).

## Plan-impact (DiffUnderstanding — brownfield, plug point P2)

When a brownfield `KnowledgeGraph` index exists
(`.guild/indexes/knowledge-graph.json`), run the **P2 plan-impact** producer
before finalizing lanes (codebase-understanding spec §"Where it sits" plug point P2):

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/learn/diff-learn.ts --cwd <repo-root> \
  --base <merge-base-with-integration-branch> [--head HEAD] [--run-id <id>]
```

This writes `.guild/runs/<run-id>/diff-learn.json`
(`guild.diff_understanding.v1` — bound by pointer to the implementation contract map, row 13; never re-spell the schema). Consume it to sharpen the plan, not to replace judgement:

- `affected_layers` / `affected_nodes` → which specialist lanes the change
  actually touches; scope each lane to its blast radius.
- `blast_radius.risk` (`low|medium|high`) → fold into the lane's
  `autonomy-policy` (high risk ⇒ tighten "requires confirmation").
- `untraced_files` → changed files no graph node explains; call these out as
  scope-gap risks in the relevant lane's `scope` so `guild:verify-done`'s
  scope-check (P3) can reconcile them.

If no graph index exists (greenfield, or deep tier never built), skip silently
— do not block planning and do not fabricate a diff.

## Adversarial review — G-plan (broker, when policy fires)

G-plan is a **skill-internal gate** (adversarial-review spec §Gate ownership): it fires here inside `guild:plan` at the plan→approval boundary, not from a command — which is why it doesn't appear in `build`'s skill row. Wire the **review broker** at this boundary, **not** `guild:codex-review` directly: the broker is the host-agnostic front door, and `guild:codex-review` survives only as the internal Codex adapter the broker dispatches to (adversarial-review spec §The review broker).

After writing the plan with `approved: false` and **before** presenting it to the user for approval, invoke `guild:review-broker`:

```
Skill: guild-review-broker
args: gate=G-plan artifact_path=.guild/plan/<slug>.md run_id=<run-id> author_host=<run author host>
```

The broker is **policy-gated** (adversarial-review spec §The review broker): it fires only when `risk ≥ high`, `review: cross` / `--review=cross` is set, or project config requires it — otherwise it resolves `status: "skipped"` and the gate passes with no reviewer. Self-build runs treat cross-host review as always-on. `author_host` is the host that produced the plan (resolved from the run-start preflight snapshot; `claude` on a Claude-hosted run).

If the broker returns `status: "rework"`, revise the plan using the findings before re-presenting to the user. On `"satisfied"`, `"skipped"`, or `"force_passed"`, proceed to the user-approval gate normally.

The gate runs between plan write and user-approval. It does not replace user approval.

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

## Learning checkpoint (step 7.5 — advisory, no new gate)

After the G-plan review + approval gate and before handoff, fire the per-phase LearningCheckpoint with `phase=planning` and `.guild/plan/<slug>.md` as `evidence_ref`. Invoke `guild:learning-checkpoint` to classify the already-written plan/lanes into the 12-target verdict, then emit via the hook — the full call signature + `GUILD_PHASE` mapping are canonical in `skills/meta/learning-checkpoint/SKILL.md §"How a phase skill fires the checkpoint"` (do not re-spell). It rides this existing boundary, defaults to all-`none` (a near-zero-token no-op), asks no new prompt, and adds no new gate; non-`none` verdicts route only to `.guild/reflections/<run-id>.md`.

## Handoff

Once the plan is written and **user-approved** (frontmatter `approved: true`), hand off to `guild:execute-plan`. Execute-plan creates the `<run-id>`, then invokes `guild:context-assemble` once per specialist lane to build the minimum-viable-context bundle before dispatching the specialist subagent. Do not run context assembly yourself — that's `guild:execute-plan`'s responsibility during per-lane dispatch.

Handoff receipt should list: `plan_path`, `prd_form` (`inline` | `standalone` — with `prd_path` when standalone), `lane_count`, `parallel_eligible_count` (lanes with empty `depends-on:`), `backend` (mirrored from team.yaml), `approved_at` timestamp, and `team_plan_path` — **forwarded verbatim** from `guild:team-compose`'s handoff (the companion `guild.team_plan.v1` at `.guild/runs/<run-id>/team-plan/<phase>.json`, or its fail-soft skip note). Pass it through unchanged so `guild:execute-plan` can wire its `team_result` `team_plan_ref` to it — `guild:plan` neither reads nor regenerates it.
