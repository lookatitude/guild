---
type: concept
owner: architect
confidence: high
importance: high
source_refs: ["plugin/.guild/architecture-research-2026-05-10/architecture/11-workflow-operating-model.md"]
created_at: 2026-05-16
updated_at: 2026-06-11
expires_at: null
supersedes: "guild-plan.md §8"
sensitivity: internal
applies_to: [plugin]
related: [lifecycle-overview, phase-entrypoints, initiative-lifecycle-and-release-doc-sync]
---

# Workflow Operating Model

This page is the operating-model lens onto the **one state machine with six
phase entrypoints and three lenses (linear / phase / initiative)**. The
canonical phase machine, normative phase→station→command→gate table, and
embedded D-12 diagram live in
[lifecycle-overview.md](lifecycle-overview.md); this page does not re-invent
them.

## Intent

Guild operates at three nested levels:

1. Project: the repository and its durable knowledge.
2. Initiative: the goal the human cares about across sessions — **OPT-IN**,
   never required.
3. Run: one execution or analysis pass that produces evidence.

**Run vs initiative boundary:** a *run produces evidence*; an *initiative owns
progress*. A run can pass while its initiative stays open. One-off runs are
first-class and create no initiative directory — they live at
`.guild/runs/<run-id>/`. An initiative is only created on a durable-goal
signal, an explicit `--initiative` flag, or a `/guild:initiative …` command,
and the attach choice is always *asked, never silently auto-attached*.

The current repo already has a strong run spine: brainstorm, team-compose,
plan, context-assemble, execute-plan, review, verify, reflect. The v2
architecture re-homes that spine as the implementation of Planning +
Development (not a peer model), adds a project bootstrap layer (Init) before
it, and wraps it with an opt-in initiative layer.

## End-To-End Shape

```mermaid
flowchart TB
  Init["/guild:init"] --> Project["Project knowledge base"]
  Project --> Intake["Session intake"]
  Intake --> Choice{"Initiative attachment? (opt-in initiative, asked never auto)"}
  Choice -->|new| Ideate["Ideation"]
  Choice -->|resume| Resume["Load initiative state"]
  Choice -->|one-off (default)| OneOff["One-off run"]

  Ideate --> Initiative["Initiative record"]
  Resume --> Initiative
  Initiative --> Breakdown["Initiative breakdown"]
  Breakdown --> Spec["Spec or spec set"]
  Spec --> Team["Team routing"]
  Team --> Plan["Plan and task graph"]
  Plan --> Context["Context assembly"]
  Context --> Execute["Execution"]
  Execute --> Review["Review"]
  Review --> Verify["Verify"]
  Verify --> Release["Release readiness"]
  Release --> Docs["Documentation sync"]
  Docs --> Close["Close or continue initiative"]

  Execute --> Run["Run record"]
  Review --> Run
  Verify --> Run
  Run --> Replay["Replay and diagnostics"]
  Run --> Reflect["Reflection"]
  Reflect --> Evolve["Skill/tool evolution"]
  Evolve --> Project
```

## Non-Negotiable Compatibility Rule

The v2 design re-homes the current `/guild` spine; it does not bypass it. The
v1 7-step linear spine is the default forward path inside Planning +
Development, not a deleted or peer model. `guild-plan.md §8` is frozen
as the v1 record and superseded by
[lifecycle-overview.md](lifecycle-overview.md).

Existing sequence to preserve:

1. Config and run ID.
2. Brainstorm produces a spec.
3. Team compose produces `team.yaml`.
4. Plan produces an approved plan.
5. Context assemble writes per-lane bundles.
6. Execute plan writes handoff receipts.
7. Review writes `review.md`.
8. Verify writes `verify.md`.
9. Reflect writes proposals.

New project and initiative phases wrap this sequence:

- Before the sequence: project init and initiative/session intake (initiative
  attach is OPT-IN).
- During the sequence: when (and only when) the run is initiative-attached,
  initiative ID, work item ID, phase, and status axes are carried through
  artifacts. One-off runs carry none of this and pay zero initiative cost.
- After the sequence: work item updates, release readiness, documentation
  sync, replay, and evolution — for attached runs only.

### `--initiative` flag + durable-goal signal (asked, never auto)

The attach prompt is **always asked, never auto-attached**. It fires only on:

- an explicit `--initiative <id>|new` flag, OR
- a `/guild:initiative <new|status|list|resume|update|archive|restore|close>`
  command, OR
- a durable-goal signal in the brief. Proposed seed signal list (the exact
  keyword/intent contract is delegated to the initiative-layer doc as an
  implementation detail): "ongoing", "continue the prior", "over the next
  <period>", "initiative", explicit `--initiative`.

When a signal is detected, `/guild` asks `[ new / existing / one-off ]`. The
default with no signal and no flag is `one_off`: no initiative directory is
created. A per-project rolling continuity *prose* summary for one-off runs is
intentionally out of scope in v2; the structured per-run `provenance.json`
STATE record is unaffected (see Cross-Initiative Continuity below).

## Source Of Truth Rule

Every phase has a durable artifact.

| Phase | Source Artifact | Gate |
|---|---|---|
| Project init | `.guild/project.yaml` plus base wiki pages. | Human confirms generated project model. |
| Ideation | `.guild/initiatives/active/<id>/initiative.yaml` and definition ledger. | Blocking definition gaps resolved or explicitly assumed. |
| Breakdown | Feature/spec map under initiative. | Feature boundaries and acceptance seeds reviewed. |
| Team routing | `.guild/team/<slug>.yaml`. | Roles, gaps, backend, and dependencies accepted. |
| Planning | `.guild/plan/<slug>.md` plus work-item DAG. | Human approval or configured auto-approval. |
| Context | `.guild/context/<run-id>/*.md`. | Every lane has a bounded bundle. |
| Execution | `.guild/runs/<run-id>/handoffs/*.md`. | Every lane has evidence or explicit blocked state. |
| Review | `.guild/runs/<run-id>/review.md`. | No blocking review findings. |
| Verify | `.guild/runs/<run-id>/verify.md`. | Acceptance criteria map to evidence. |
| Release | Initiative release record. | D8 close gate part 1 — release evidence and rollback stance recorded. |
| Docs sync | Initiative docs impact record. | D8 close gate part 2 — docs updated or no-update rationale recorded. |
| Reflect/evolve | Reflection and replay reports. | Promotion requires evals and approval. |

The **D8 close gate = exec + release + docs**: an initiative cannot close
until execution is verified, release readiness is resolved, and documentation
sync is resolved. The close-gate *contract* is frozen `[v2]`; the close-gate
*automation* (definition-ledger + release/docs machinery) is `[v2.x]`. Release
and docs are separate gates, not collapsed into one. See
[../initiatives/initiative-lifecycle-and-release-doc-sync.md](../../../../.guild/wiki/entities/initiative-lifecycle-and-release-doc-sync.md).

## Session Intake

Every `/guild` entry point starts with session intake.

```mermaid
flowchart TD
  Start["User invokes Guild"] --> PriorRun{"Incomplete or stale current run?"}
  PriorRun -->|yes| RunChoice["Ask resume, restart, attach, or ignore"]
  PriorRun -->|no| HasState{"Project has .guild/project.yaml?"}
  RunChoice --> HasState
  HasState -->|no| InitPrompt["Offer /guild:init"]
  HasState -->|yes| Classify["Classify intent"]
  Classify --> Match{"Durable-goal signal or --initiative? (opt-in initiative)"}
  Match -->|signal + one high-confidence match| Attach["Ask, then attach session to initiative"]
  Match -->|signal + multiple matches| Ask["Ask user to choose"]
  Match -->|no signal (default)| NewOrOneOff{"Ask: new initiative or one-off?"}
  NewOrOneOff -->|new| Create["Create initiative shell"]
  NewOrOneOff -->|one-off| OneOff["Run without initiative"]
  Attach --> Load["Load initiative status slice"]
  Create --> Load
  Load --> Phase["Route to phase"]
```

Classification signals (initiative attach is OPT-IN — these only *propose*
an attach prompt, they never silently attach):

- Explicit command/flag: `/guild:init`, `/guild:initiative new|resume`,
  `--initiative <id>|new`, `/guild:fix` (replay).
- Initiative IDs or titles in the prompt.
- Branch name, changed files, or PR title matching an initiative.
- Prior session attachment.
- Open work item next action.
- Durable-goal phrasing: "ongoing", "continue the prior", "over the next
  <period>", "initiative".

With no signal and no flag the default is a one-off run (no initiative dir).
When a signal fires, ask `[ new / existing / one-off ]`; never auto-attach.
Incorrect attachment is worse than one clarifying question.

Incomplete run detection comes before initiative classification. If `.guild/runs/current-run-id` points to a run without `verify.md`, Guild should show the prior run state and ask whether to resume, restart, attach it to an initiative, or leave it as an orphaned run record.

## Phase Map

| Phase | Primary Question | Output | Preferred Loop |
|---|---|---|---|
| Project init | What project is this? | Project knowledge base. | Advisory for new, reverse-engineering team for existing. |
| Ideation | What goal should exist? | Initiative. | Advisory. |
| Breakdown | What must be built or changed? | Feature/spec set. | Advisory plus adversarial gate for high risk. |
| Team routing | Who should do the work? | Team and backend. | Advisory if gaps exist. |
| Planning | How should work happen? | Task graph. | Plan review loop. |
| Context assembly | What does each worker need to know? | Context bundles. | Simple validation. |
| Execution | Can the task graph be completed? | Diffs, artifacts, handoffs. | Implementation loop. |
| Review | Is the output good enough? | Review findings. | Adversarial. |
| Verify | Is the objective met with evidence? | Pass/fail report. | Simple plus adversarial if configured. |
| Release | Has the change reached target users/environment? | Release record. | Checklist and approval. |
| Docs sync | Do docs match current state? | Docs update or no-update record. | Review loop. |
| Reflect/evolve | What did Guild learn? | Proposals, evals, promoted changes. | Shadow replay. |

## Loop Policy

Guild should choose loops explicitly.

```yaml
loop_policy:
  low_risk_local_fix: simple
  ambiguous_product_or_architecture: advisory
  gate_or_high_risk_artifact: adversarial
  advisory_backend_order:
    - tmux_team
    - host_subagents
    - single_agent
  adversarial_backend_order:
    - cross_host_reviewer
    - independent_same_host_reviewer
    - checklist_only
  escalation:
    start_with_low_cost_advisors: true
    escalate_unresolved_blockers_only: true
```

Loop records must name:

- actors
- artifact under review
- max rounds
- stop condition
- escalation condition
- output trail
- final decision

Advisory council records should be persisted even when the council happens in tmux or host subagents:

```yaml
advisory_record:
  schema_version: guild.advisory.v1
  initiative_id: init-example
  phase: ideation
  backend: tmux_team | host_subagents | single_agent
  question: "Which architecture path should this initiative take?"
  advisors:
    - role: product
      model_tier: low_cost
    - role: architecture
      model_tier: low_cost
    - role: escalation_reviewer
      model_tier: high_capability
  recommendation_ref: ".guild/initiatives/active/init-example/artifacts/advisory-001.md"
  unresolved_questions: []
  confidence: medium
```

The record is the durable coordination artifact. The tmux panes or subagent chats are implementation details.

## Backend Defaults

Backend selection is **config-driven**, not hard-coded. The effective backend
is resolved from the Tier-1 `.guild/settings.json → agent_mode`
(`team | agent | subagent | auto`, default `auto` — the D5 dispatch ladder;
the v1 `defaults.agent_team` boolean was removed in v2.0) resolved once at
run-start intake by `runStartPreflight` through the **7-source chain**
`built-in < workspace < workspace-local < project < project-local < rigor < CLI`
and frozen in the resolved-settings snapshot (`snapshot.effective.agent_mode`),
which phases read via `readResolvedSettingsSnapshot`; absent ⇒ `auto`, which
resolves the strongest available backend (tmux team → independent agent →
subagent). The
`agent_mode` ladder and the closed-key `defaults:` schema are canonical in
[`../architecture/command-surface.md`](command-surface.md)
§4.4 and [`../decisions/v2x-command-surface-dispatch-and-internalization.md`](../decisions/v2x-command-surface-dispatch-and-internalization.md)
D5; this page consumes them by pointer. With `agent_mode: auto` (the default),
the ladder resolves the strongest available backend per context:

| Context | `agent_mode: auto` resolution |
|---|---|
| Already inside tmux (`$TMUX` set) | TEAM in-session (new window in the current session). |
| tmux installed, not inside one | TEAM in a new detached session. |
| No tmux, host supports independent agents | AGENT (independent, no tmux). |
| CI or tmux-less environments without independent-agent support | SUBAGENT (the documented fallback). |

Tmux is a coordination surface, not a sandbox. Security boundaries still come from worktrees, permissions, tool policy, and review gates.

## Cross-Initiative Continuity (STATE, not prose log)

Cross-initiative continuity — initiatives → features → tasks → agents → skills
→ decisions → status — is carried as `.guild/` **STATE**, never as a
progress-tracking narrative. The per-run source record is
`.guild/runs/<run-id>/provenance.json` (`guild.provenance.v1`, written at
run-close for **every** run including one-off; retention = 90 days for
one-off, until-archive when initiative-attached). The cross-initiative rollup
is the **derived, rebuildable** `.guild/indexes/initiatives-registry.yaml`
(`guild.initiatives_registry.v1`) — a pure projection of
`runs/**/provenance.json` + `runs/**/learning/*` + wiki + `initiatives/*`;
deleting it loses nothing (rebuilt by re-scan). Both the registry and
`.guild/indexes/knowledge-links.json` are projections of the same provenance
facts (one model, not two). The canonical schemas live in
[`../architecture/target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md)
(`Provenance`, `InitiativesRegistry`, `KnowledgeLinks`); this page references
them by pointer and never re-spells them.

The prose-vs-STATE distinction is fixed: a per-project rolling continuity
**prose** summary for one-off runs is out of scope in v2. That exclusion
applies to narrative progress logs only — it does **not** preclude the
structured STATE above. Structured `provenance.json` + the derived
`initiatives-registry.yaml` are not a prose continuity log; they are
rebuildable index STATE, and they exist for every run.

## Status Axes

> **Supersession note (2026-06-11): v2 keeps four axes.**
> [`docs/v2/initiatives.md`](../../../../docs/v2/initiatives.md) fixes the initiative manifest
> (`guild.initiative.v1`) at the **4-axis model** — `definition_status` /
> `execution_status` / `release_status` / `documentation_status`. The `review_status` and
> `evolution_status` rows below were **folded into that model**: review evidence is
> run-record STATE (`review.md`/`verify.md` of contributing runs) and evolution outcomes
> ride the reflection→evolve queue — neither is initiative-manifest state. The 6-axis
> table is retained below as the historical record only.

Initiative state should not collapse into one field.

| Axis | Values | Answers |
|---|---|---|
| `definition_status` | incomplete, assumed, complete | Do we know what this initiative means? |
| `execution_status` | not_started, active, blocked, done | Is planned work done? |
| `review_status` | not_started, active, blocked, passed | Has output been reviewed? |
| `release_status` | not_released, candidate, released, rollback_required | Has it reached target users or environment? |
| `documentation_status` | not_assessed, update_required, no_update_required, updated, stale | Do docs match shipped state? |
| `evolution_status` | not_assessed, proposal_pending, replaying, promoted, rejected | Did Guild learn from the work? |

Human-facing `status` is derived from these axes.

## Invariants

- A project can have zero or more initiatives; initiatives are OPT-IN.
- A session can attach to one primary initiative; cross-initiative work requires explicit split.
- A run can be attached to an initiative or be one-off; one-off is the default and first-class, with zero initiative cost.
- A run produces evidence; an initiative owns progress. A run can pass while the initiative remains open.
- An initiative cannot close until the D8 close gate is satisfied: execution verified + release readiness resolved + docs sync resolved (contract `[v2]`, automation `[v2.x]`).
- Raw run traces do not automatically become shared project knowledge.
- Reflections are proposals until promoted through wiki ingest or evolve gates.
- Context bundles are contracts, not security boundaries.
- Provider-specific features are capabilities, not core assumptions.
