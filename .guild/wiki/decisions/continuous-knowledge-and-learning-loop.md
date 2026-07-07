---
type: decision
owner: architect
confidence: high
importance: critical
source_refs: ["CONCEPT-BRIEF.md", "DECISIONS-LOCKED.md"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [concept-integration, templates-and-migration, guild-boundary-config-and-tracking, memory-and-knowledge, knowledge-and-advisory, codebase-understanding, lifecycle-overview]
---

# ADR: Continuous knowledge model + per-phase learning loop (CR-A + CR-C)

## Status

Accepted (2026-05-17). Binding. Inputs: `CONCEPT-BRIEF.md` Concepts 1/7/9 +
review questions 1, 2, 3, 14, 16, 17; `DECISIONS-LOCKED.md` (KnowledgeGraph
= derived index, wiki canonical, filesystem-only G3, DH-1..DH-5, N1, N3,
D5 carve-out, agents-emit-candidates-only).

## Context

Concept 1 requires Guild to continuously extract, classify, label, store, and
keep current one connected knowledge model (memory + wiki + graph + domains +
project concepts + extracted facts + tasks/features/agents/skills),
retrievable for *all* relevant knowledge for a task. Concept 7 requires
learning after **every** meaningful phase across **12 targets**. Concept 9
requires understanding, memory, wiki, agents, skills, task tracking, and
config to be connected parts of one architecture.

The v2 design delivered a canonical wiki + a derived code graph + a
`reflect → evolve` queue, but: knowledge was **not labeled** by
domain/feature/component/concern/status/relevance (only lifetime-categories +
free-text `subject`); task↔agent↔skill↔decision↔knowledge was **not
traversable** (the data-model ER was conceptual-only); retrieval could
**silently drop** decisions/open-questions on budget; and learning fired
**once at Stop over 3 targets**, not per-phase over 12 (9/12 targets
unwired). The locked architecture *forces* physical separation (no unified
graph DB, no embeddings) — so the remedy is a logical label + links + loop
layer, never a new store.

## Decision

### CR-A — one connected knowledge + tracking model

1. **Knowledge Label Schema** — a closed, project-scoped label vocabulary
   `domain / feature / component / concern / status / relevance` applied as
   **additive frontmatter on canonical wiki pages** and **attributes on
   derived graph nodes**. Not a new store (zero drift surface). Closed sets
   live in `.guild/project.yaml -> label_taxonomy:` (human-gated; the D5
   carve-out is intact). `domain`/`component` are **persisted from what the
   brownfield engine stages 4–5 already compute and today discard**
   (near-zero new cost). Per **N3**, `concern` is a **9-value closed enum**:
   `security | performance | reliability | ux | cost | compliance |
   accessibility | privacy | none` (project-extensible only via
   `project.yaml`). It **supersedes the free-text `subject`** as the
   classification axis. `wiki-lint` gains a label-coverage / closed-set /
   stale-label check.
2. **Knowledge Links Index** — a single derived, rebuildable, deletable
   `.guild/indexes/knowledge-links.json` (`guild.knowledge_links.v1`)
   materializing the work↔knowledge↔behavior edges the data-model ER only
   described conceptually. Closed edge-type set: `decided_by, used_for,
   produced, touches, supersedes, learned_from, constrains, opens_question,
   resolves`. Built append-only by the per-phase LearningCheckpoint.
   `context-assemble` reads it as a task-layer source; feature/component-label
   -matched decisions + open-questions are **pinned above droppable graph
   nodes** in the existing overflow order (one ordering rule, not a budget
   increase); any omission is named in an explicit `dropped_for_budget:`
   line (never silent).
3. **Provenance + Initiatives-Registry** — per-run
   `.guild/runs/<run-id>/provenance.json` (`guild.provenance.v1`, every run
   incl. one-off; **N1 retention = 90d one-off / until-archive if
   initiative-attached**) + derived
   `.guild/indexes/initiatives-registry.yaml`
   (`guild.initiatives_registry.v1`).

**Reconciliation (one model, not two):** `knowledge-links.json` is the edge
layer; `provenance.json` is the per-run fact source the edges derive from;
`initiatives-registry.yaml` is the cross-initiative rollup of the same facts.
`KnowledgeGraph` = code/wiki derived index
(file/function/concept/domain/component); knowledge-links = work/decision
derived index (task/run/decision/skill/agent/feature ↔ those) — **no
node-space overlap**. Both projections are deletable with zero data loss and
rebuildable by re-scan (DI-6 discipline verbatim: derived, deletable,
filesystem-canonical, absence ⇒ scan; no MCP, no embeddings, no
SQLite-as-record). Contradiction policy unchanged: prefer wiki; graph only
when `confidence=high` + a direct `source_ref`; log for `wiki-lint`.

### CR-C — one continuous-learning loop, many targets

One learning mechanism: the **per-phase LearningCheckpoint**
(`guild.learning_checkpoint.v1`), inserted as control-pattern **step 7.5** at
the existing review boundary of every phase (Init, Ideation, Planning,
Development, Quality, Operations) + the cross-phase Reflection. It is
**automatic + advisory, riding the existing per-phase review boundary — no
new user gate, no new prompt**. It is a **classification verdict, not an
analysis pass**: it reads artifacts the phase already produced
(receipt/review/`provenance.json`) and emits a fixed enum over **12 targets**
+ one edge-batch; the all-`none` default is a near-zero-token no-op.

```yaml
# .guild/runs/<run-id>/learning/<phase>-<run-id>.yaml  (guild.learning_checkpoint.v1)
learning_checkpoint:
  version: guild.learning_checkpoint.v1
  phase: init|ideation|planning|development|quality|operations|reflection
  run_id: run-...
  observed: ["<short fact>"]
  decisions:                       # the 12 learning targets — per-target verdict
    memory:          none | candidate:<ref>
    wiki:            none | candidate:<ref>
    knowledge_graph: none | refresh:<classifier-state>
    domain_model:    none | re-derive
    agent_def:       none | proposal:<agent>
    skill_def:       none | proposal:<skill>
    agent_template:  none | systemic-proposal
    skill_template:  none | systemic-proposal
    config:          none | proposal:<key>
    task_tracking:   none | update:<work-item>
    workflow_rules:  none | proposal:<rule>
    review_policy:   none | proposal:<gate>
  knowledge_links_batch:           # the closed-edge-type edges this phase contributes
    - {from: "...", to: "...", type: "...", run_id: "..."}
  routed_to: .guild/reflections/<run-id>.md
  evidence_ref: .guild/runs/<run-id>/...
```

**Classification predicate (per target, conservative, machine-checkable).**
"Classification verdict, not analysis pass" is made concrete by a fixed rule:
for each of the 12 targets a phase emits `none` **UNLESS** that target's
deterministic signature fired *during this phase* (a fact already present in
the receipt / review / `provenance.json` the phase produced — never a fresh
analysis). The signature set (one rule per target; absence ⇒ `none`):

| Target | Non-`none` iff (deterministic signature this phase) | Verdict |
|---|---|---|
| `memory` | a `guild:decisions` / `wiki-ingest` **candidate** artifact was emitted this phase (a memory-class candidate exists in the receipt) | `candidate:<ref>` |
| `wiki` | a wiki-class candidate (new/changed durable fact) was emitted this phase | `candidate:<ref>` |
| `knowledge_graph` | a file/function/concept the graph indexes was added/removed/renamed this phase (changed-files set intersects an indexed path) | `refresh:<classifier-state>` |
| `domain_model` | the brownfield engine's stage-4/5 domain/component output for a touched path **differs** from the persisted label (a label mismatch is recorded) | `re-derive` |
| `agent_def` | a per-instance reflection-proposal for a specific agent crossed the existing `guild:reflect` proposal threshold this phase | `proposal:<agent>` |
| `skill_def` | a per-instance reflection-proposal for a specific skill crossed the existing `guild:reflect` proposal threshold this phase | `proposal:<skill>` |
| `agent_template` | the CR-B one-vs-template classifier returned **systemic** for an agent defect this phase (≥3-distinct + same machine-checkable signature) | `systemic-proposal` |
| `skill_template` | the CR-B classifier returned **systemic** for a skill defect this phase | `systemic-proposal` |
| `config` | an explicit config override/exception was recorded this phase (a `defaults:` key or CLI flag deviated from built-in and was logged) | `proposal:<key>` |
| `task_tracking` | a work-item's state changed this phase (a task/feature transitioned, or a new work-item was created in the receipt) | `update:<work-item>` |
| `workflow_rules` | an explicit workflow exception/override was recorded this phase (a gate was skipped/forced, or a phase-order deviation logged) | `proposal:<rule>` |
| `review_policy` | an explicit review-gate override/exception was recorded this phase (a BLOCK overridden with owner-accepted risk, or a gate auto-approved by token) | `proposal:<gate>` |

Each signature is read off an artifact the phase **already wrote** — the
checkpoint computes no new evidence, runs no extra scan, asks no prompt. The
predicate is intentionally conservative: a target stays `none` unless its
signature is unambiguously present, so the all-`none` no-op remains the common
case and verdict rate is deterministic across implementers (closing the
"two engineers, different verdict rates" ambiguity). This predicate adds **no
gate**, changes **no autonomy/promotion path** (D5 + agents-emit-candidates
intact), and is advisory: every non-`none` verdict still only *routes* to the
existing `.guild/reflections/<run-id>.md` queue.

**Unification (three loops → one loop, many targets):** the factory loop is
the `agent_template/skill_template/agent_def/skill_def` columns; the ops loop
is the `config/task_tracking/workflow_rules/review_policy` columns; the
knowledge loop is the `memory/wiki/knowledge_graph/domain_model` columns +
the edge-batch. One loop fires per phase; every non-`none` verdict routes to
the **existing** `.guild/reflections/<run-id>.md` queue → the **existing**
human-gated evolve/decisions/wiki-ingest pipeline. **No new promotion path
is created** — the loop feeds the locked one earlier and attributed-per-phase
instead of once at Stop. No verdict may touch permission/sandbox/runtime
policy (D5 intact). No verdict auto-promotes to wiki (agents-emit-candidates
intact). The `agent_template`/`skill_template` columns invoke the CR-B
classifier (see [templates-and-migration](templates-and-migration.md)).

## Validation criteria (Concepts 1/7/9)

- **VC-K1 (label coverage):** ≥95% of durable `.guild/wiki/**` pages carry a
  `labels:` block with non-empty `domain` + `concern` + `status`; closed sets
  resolve against `project.yaml`; `wiki-lint` reports residue.
- **VC-K2 (connectivity):** for any completed-run task-id, one
  `knowledge-links.json` traversal answers which decisions constrained it,
  which skill/agent ran it, which feature/component it touched, which wiki
  pages describe that component. (Test 3 historical tasks; all 4 reachable.)
- **VC-K3 (retrieval completeness):** for a feature/initiative-scoped task
  the bundle contains every `status:active` decision + every open
  `opens_question` matched by the task's feature/component label, OR an
  explicit `dropped_for_budget:` line naming each omission;
  decisions/open-questions never dropped before role content.
- **VC-K4 (per-phase learning):** every phase that ran has a
  `learning/<phase>-<run-id>.yaml` with a terminal verdict for all 12 targets
  (all-`none` valid); every non-`none` verdict has a matching
  `reflections/<run-id>.md` entry. (Machine-checkable: phases-run ==
  checkpoints.)
- **VC-K5 (loop participation):** a red-team run where a skill AND its
  template are both deficient produces (a) a one-skill proposal AND (b) a
  `skill_template: systemic-proposal`.
- **VC-K6 (currency):** after a feature changes a component, the next run's
  Development checkpoint emits `knowledge_graph: refresh:<state>` +
  `task_tracking: update:<wi>`; stale labels flagged by `wiki-lint`.
- **VC-K7 (G3 + locked-decision safety):** deleting `knowledge-links.json` +
  all `learning/` dirs changes no answer the filesystem scan can't reproduce;
  wiki stays canonical; no checkpoint auto-promotes to wiki; no
  permission/sandbox/runtime policy touched by any verdict.

## Phased plan slice (CR-A + CR-C)

- **P2 — Knowledge model:** label schema; `knowledge-links.json` projection;
  `project.yaml label_taxonomy:`; retrieval overflow rule
  (`memory-and-knowledge.md`, `knowledge-and-advisory.md`,
  `codebase-understanding.md`, `data-model.md`, diagram D-18).
- **P3 — Learning loop:** per-phase LearningCheckpoint step 7.5; 12-target
  enum; edge-batch emission; reflections fed per-phase
  (`lifecycle-overview.md`, `phase-entrypoints.md`,
  `skills-and-self-evolution.md`, diagram D-12). Depends on P1; P2 for the
  edge-batch.

## Consequences

- "One connected model" is satisfied **logically** (one traversable
  label+links graph over canonical+derived stores) without violating the
  locked physical separation.
- Learning becomes phase-attributed and 12-target without adding a user gate
  or a new promotion path.
- Definitional docs receive the definitions only (DH-1/DH-4); diagrams D-12
  and D-18 carry the visual model.
