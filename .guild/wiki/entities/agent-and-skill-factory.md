---
type: concept
owner: architect
confidence: high
importance: critical
source_refs: []  # consolidated from plugin/docs/v2/ (711f227); supersedes: field below preserves the lineage
created_at: 2026-05-16
updated_at: 2026-05-17
expires_at: null
supersedes: "plugin/docs/v2/agent-and-skill-factory.md"
sensitivity: public
applies_to: [plugin]
related: [skill-creator, skills-and-self-evolution]
---

# Agent and Skill Factory

Guild v2 creates new skills and agents only when repeated evidence shows a
stable boundary. The factory is conservative because every new trigger
increases routing complexity.

The `writing-skills` meta-tier fork (`skills/meta/writing-skills/`, §2.7,
MIT-attributed superpowers §13) is the **authoring discipline** the factory
applies to every drafted or evolved `SKILL.md` (RED baseline → minimal skill
→ rationalization counters). It pairs with `guild:evolve-skill` and
`guild:create-specialist`.

**Permission carve-out:** the factory may never mint or evolve a
skill/specialist that edits permission, sandbox, or runtime policy — these
are proposal-only and human-gated. This applies identically to the new
skills: `guild:init` and the 4 superpowers forks are self-evolvable for
body/clarity/examples, but the permission/sandbox/runtime carve-out applies
to them unchanged.

![Skill and agent factory](../architecture/diagrams/07-skill-agent-factory.svg)

## Skill Design Rule

Skills should be short, concise, and Claude Code-first:

- one responsibility per skill;
- clear trigger and do-not-trigger language;
- one compact workflow;
- explicit input and output artifacts;
- no broad persona prose that belongs in `agents/*.md`;
- no hidden dependency on a specific session transcript;
- Codex parity where practical through markdown artifacts and filesystem state.

## When to Create a Skill

Create or evolve a skill when:

- the same procedure repeats across tasks;
- the procedure has verifiable inputs and outputs;
- the role already exists and only needs a sharper capability;
- the change can be tested with positive and negative eval cases;
- the procedure does not need a new persona boundary.

Do not create a skill when the need is one-off, vague, or better handled by a plan assumption.

## Skill Evolution Loop

1. Snapshot the current skill to `.guild/skill-versions/<skill>/v<n>/`.
2. Load or bootstrap eval cases.
3. Run paired agents:
   - A is current skill or no-skill baseline.
   - B is the proposed edit.
4. Grade assertions and compute flip report.
5. Run shadow mode on historical tasks.
6. Promote only when regression rules pass or the user explicitly accepts the tradeoff.
7. Optimize description for trigger accuracy and token budget.
8. Keep rollback snapshots non-destructive.

## When to Create an Agent

Create a new specialist only when all extraction signals pass:

| Signal | Required evidence |
|---|---|
| Recurring cluster | Same skill cluster appears across at least 3 unrelated tasks. |
| Distinct trigger boundary | Existing agents cannot own it without ambiguous routing. |
| Context isolation payoff | The role carries enough domain context to benefit from isolation. |
| Reflections or gaps | At least 3 reflections or team-compose gaps point to the same role. |
| Eval coverage | At least 3 positive and 3 negative cases exist. |

## Agent Creation Workflow

1. Interview for role name, responsibility, typical prompts, example outputs, and dependencies.
2. Draft `.guild/agents/proposed/<role>.md` from the canonical
   `AGENT.template.md`, stamping `derived_from_template:
   guild.agent_template.vN`.
3. Draft 2-5 proposed specialist skills under
   `.guild/skills/proposed-<role>-*/`.
4. Scan existing agents for description overlap.
5. Propose adjacent `DO NOT TRIGGER` clauses.
6. Gate every adjacent-boundary edit through paired evals.
7. Gate the new specialist through paired evals and shadow mode.
8. Register-live into the consuming repo's `.guild/agents/` and
   `.guild/skills/` only after gates pass — never the plugin install dir.
9. Tell the user a Claude Code restart is required before the new specialist is routable by agent definition.

> **`.guild/` instance boundary (binding).** The plugin ships only the
> canonical/base read-only library + the two templates as static plugin
> install state. Every project-authored or evolved agent/skill **instance +
> override** is written to the consuming repo's `.guild/agents/` and
> `.guild/skills/` — never plugin state, never outside `.guild/`. A runtime
> write into plugin state is a v2 defect. The single enforceable boundary
> rule + the PreToolUse signature guard are stated once in
> [`target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md) and the
> ownership-map ADR; cited here by pointer.

## Canonical Agent Template

There is exactly **one** canonical agent skeleton:
`plugin/templates/agents/AGENT.template.md` (`guild.agent_template.v1`),
shipped as **static, read-only plugin install state**; the version string,
`derived_from_template` invariant, and the `.guild/` instance boundary are stated once in
[`target-architecture.md` → Canonical template-version strings](../../../../.guild/wiki/entities/target-architecture.md)
and cited here by pointer. It pins the frontmatter keys + the required
section-heading set only — no body prose. Every project specialist is a
*fill* of this skeleton written to `.guild/agents/`.

The template pins these slots (the 8 Persona-Structure items plus the two
formerly-missing fields, both first-class slots):

- role mission in one paragraph;
- responsibilities;
- trigger and do-not-trigger boundaries;
- constraints;
- expected artifacts; upstream dependencies; downstream handoff expectations;
- allowed tools and MCP requirements by default;
- review posture and evidence standard;
- failure or escalation rules;
- **`operating_style`** — a bounded enum slot (not free prose);
- **`personality`** — a **bounded closed enum** with exactly three axes,
  `{terseness, pushback_posture, escalation_bias}`, **plus one optional
  short prose line** for flavor only. The enum drives routing-safe behavior;
  the prose line is length-capped and **never trigger-bearing**. Free-text
  persona paragraphs are banned (prompt-bloat / routing-ambiguity). The
  canonical enum lives in
  [`target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md);
  cited here, never re-spelled.

Personas should not duplicate long skill instructions. Agents select and
sequence skills; skills encode the repeatable method.

## Agent Template & Migration

A specialist **instance** issue and the agent **template** itself being
wrong are different problems sharing the **same** one-vs-template classifier as skills
(stated canonically in
[`target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md), cited by
pointer):

- A single classifier in `guild:reflect` — and the per-phase
  LearningCheckpoint's `agent_template` column — buckets every agent
  improvement proposal as **specific** (one agent → per-instance evolve
  queue) or **systemic** (the canonical skeleton → `.guild/evolve/template/
  agent/<v>/`).
- A **systemic** verdict requires ALL of: ≥3 distinct agents (or ≥2 in one
  run), the same machine-checkable defect signature, and explicit user
  approval at the **interactive template-change gate** — proposal-only,
  human-gated. This **generalizes the existing ≥3-distinct extraction
  signal** the "When to Create an Agent" table already uses, from *new-role*
  to *template-change*: one threshold, two purposes.
- Migration is lazy + staged: a version bump records the new template + a
  conformance report and mutates **zero** instances. **Additive** =
  lenient-reader no-op (a `vN` instance stays valid under a `vN+1` additive
  template). **Breaking** = per-instance migration through the existing
  `guild:evolve-skill` paired-eval + shadow gate, lazily — never bulk
  find-replace, never auto-applied.

## Continuous-Learning Participation

The factory is not a separate loop. It is wired into the **single
per-phase LearningCheckpoint** (`guild.learning_checkpoint.v1`, stated
canonically in
[`target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md) and cited
by pointer — no new gate, no new prompt):

- The factory's systemic-vs-specific bucketing is **not** a separate loop —
  it is the `agent_def`, `skill_def`, `agent_template`, and `skill_template`
  columns of that one checkpoint. The one-vs-template classifier is what those four
  columns invoke.
- A non-`none` verdict on any of those columns appends to the **existing**
  `.guild/reflections/<run-id>.md` → the **existing** human-gated
  evolve / create-specialist pipeline. No new promotion path is created;
  the loop feeds the existing one *earlier and attributed-per-phase* instead
  of once at Stop.
- No checkpoint verdict may touch permission/sandbox/runtime policy (the
  permission carve-out below is intact) and none auto-promotes to the wiki
  (agents-emit-candidates-only intact).

## Boundary Scan

Boundary scan compares the proposed description to current agent descriptions. A flagged adjacent specialist does not automatically change. It receives a proposed `DO NOT TRIGGER for: <new-domain>` clause, then the clause goes through the same evolve gate as any other trigger change.

High-risk adjacent pairs:

- `frontend` vs `mobile` for React Native or responsive UI.
- `copywriter` vs `marketing` for campaign copy.
- `technical-writer` vs `copywriter` for tutorials and product docs.
- `seo` vs `marketing` for landing-page strategy.
- `researcher` vs `architect` for technical evaluation.
- `security` vs `backend` for auth and integration design.

## Codex Parity

For Codex parity:

- keep skills as markdown playbooks with explicit artifacts;
- keep agent definitions transformable to TOML-style metadata;
- record required tools and MCP servers in team YAML and context bundles;
- avoid runtime-only assumptions about Claude Code frontmatter when agent-team mode is used;
- let Codex review consume the same spec, plan, and receipt files.

## The 4 Superpowers Gap-Forks

Net-new gap capabilities in v2 are the four superpowers forks. They are
forked/internalized (never runtime deps), each ships a
`LICENSE-attribution.md`, and they are self-evolvable for body/clarity/
examples under the same promotion gate and permission carve-out:

> **Status: `[v2]` (to-be-created).** The "Placement" paths below are **not
> yet on disk** — they are v2 build targets for these gap-forks, not existing
> artifacts. Do not read the path column as "already shipped".

| Fork | Placement (`[v2]` — to be created) | Trigger | Pairs with | Attribution |
|---|---|---|---|---|
| `verify-claim` | `skills/fallback/verify-claim/` | before ANY completion/success language; independent VCS-diff before trusting a handoff receipt | `guild:verify-done`, `guild:review` | superpowers v5.0.7 §8, MIT © 2025 Jesse Vincent |
| `writing-skills` | `skills/meta/writing-skills/` | authoring/evolving a skill | `guild:evolve-skill`, `guild:create-specialist`, factory | superpowers §13, MIT |
| `dispatching-parallel-agents` | `skills/meta/dispatching-parallel-agents/` | `guild:execute-plan` fan-out (concurrency-safe, context isolation, merge rules) | `guild:execute-plan` | superpowers §5, MIT |
| `receive-review` | `skills/fallback/receive-review/` | specialist responding to review findings (push back only with technical reasoning) | `guild:request-review` | superpowers §10, MIT |

Tiering (at superpowers-internalization time): `writing-skills` +
`dispatching-parallel-agents` → meta tier; `verify-claim` + `receive-review`
were forked into the then-existing fallback tier. That `fallback/` tier has
since been **promoted into `meta/` / folded into `guild:review`** — so the
live meta-tier count is enumerated from `skills/meta/` (currently **31**),
not a fixed 18+3.
