---
type: decision
owner: architect
confidence: high
importance: high
source_refs: ["CONCEPT-BRIEF.md", "DECISIONS-LOCKED.md"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [continuous-knowledge-and-learning-loop, templates-and-migration, guild-boundary-config-and-tracking, phase-spine-reconciliation, di1-di6-contracts]
---

# ADR: Cross-cutting concept integration — the 11 concepts made explicit and enforceable

## Status

Accepted (2026-05-17). Umbrella decision; binding. HOW-only debate.
Inputs: `CONCEPT-BRIEF.md` (11 concepts, 17 review questions, expected
output) and `DECISIONS-LOCKED.md` (DH-1..DH-5, G3, G4, G5, N1/N2/N3,
DI-1..DI-6, the do-not-reopen invariants).

## Context

Guild is not only an orchestration plugin: it must continuously understand
the project, classify and label knowledge, store and retrieve it, and evolve
its own operating model. The v2 doc set delivered three strong pieces — a
canonical wiki, a derived code graph, and a `reflect → evolve` queue — but
the *connective tissue* that makes them **one connected model** was absent
or prose-only. The 11 CONCEPT-BRIEF requirements demand that understanding,
memory, wiki, agents, skills, task tracking, and configuration be connected
parts of the same architecture (Concept 9).

Per DH-4 the gap analysis, phased plan, and validation criteria live in this
ADR (and its three siblings), **never** scattered into the definitional docs;
the definitional docs receive concept *definitions* only (DH-1). Per DH-2,
every one of the 11 concept mechanisms is `[v2]` — no `[v2.x]` deferral for
any concept machinery (this does not retag the pre-existing unrelated
deferrals: Codex-cloud build, hard-$ enforcement, D8 close automation,
replay). Per DH-5, "superpowers" / "understand everything" are concept
references only — implemented Guild-native, never copied (consistent with the
v2-EPP-1 exclusivity rule).

## Decision

Resolve every cross-cutting concept with four canonical statements
(CR-A..CR-D). All later design defers to them; any cross-lane overlap
resolves to them.

- **CR-A — one connected knowledge + tracking model.** One logical knowledge
  model over the locked physical separation (wiki canonical, KnowledgeGraph
  derived, filesystem-only). Three Guild-native connective additions: the
  closed **Knowledge Label Schema** (additive frontmatter + graph node
  attrs), the **Knowledge Links Index**
  (`.guild/indexes/knowledge-links.json`, derived edge layer), and the
  **Provenance + Initiatives-Registry** projection
  (`.guild/runs/<run-id>/provenance.json` +
  `.guild/indexes/initiatives-registry.yaml`). One model, not two:
  `knowledge-links.json` is the edge layer; `provenance.json` is the per-run
  fact source; `initiatives-registry.yaml` is the cross-initiative rollup —
  all derived, deletable, rebuildable (DI-6 discipline). Detailed in
  [continuous-knowledge-and-learning-loop](continuous-knowledge-and-learning-loop.md).
- **CR-B — one template + instance + classifier + migration model.** The
  plugin ships exactly two canonical, minimal/contractual, read-only
  templates as static plugin state
  (`guild.skill_template.v1`, `guild.agent_template.v1`). Every
  project-authored/evolved instance is written under the consuming repo's
  `.guild/{skills,agents}/` with `derived_from_template` stamped — never into
  plugin state. One classifier (specific vs systemic), lazy/staged migration.
  Detailed in [templates-and-migration](templates-and-migration.md).
- **CR-C — one continuous-learning loop, many targets.** A per-phase
  **LearningCheckpoint** at control-pattern step 7.5, automatic + advisory,
  riding the existing per-phase review boundary (no new user gate), emitting a
  12-target classification verdict + an edge-batch. Detailed in
  [continuous-knowledge-and-learning-loop](continuous-knowledge-and-learning-loop.md).
- **CR-D — one `.guild/` ownership + config + boundary-enforcement model.**
  One ownership map (the normative table lives in
  [guild-boundary-config-and-tracking](guild-boundary-config-and-tracking.md)),
  one optional closed-key `defaults:` config block, one PreToolUse
  Guild-owned-file boundary guard + a `/guild:audit` boundary-check (no new
  gate — reuses the existing always-ask channel).

DH-1..DH-5 are applied across the whole definitional set: definitional docs
read as freshly authored v2 (no iteration archaeology), all concept
machinery is `[v2]`, the plugin ships static read-only base assets while
project state lives under `.guild/`, plan/criteria live in these ADRs, and
the concept brief (not upstream implementations) is the binding spec.

## Consolidated gap analysis (Concepts 1–9 × Questions 1–17)

| Gap | Concept(s) | Q | State | Decided Guild-native resolution |
|---|---|---|---|---|
| G-K1 | 1 | 1 | MISSING — no label taxonomy | CR-A.1 Knowledge Label Schema |
| G-K2 | 1, 9 | 2 | WEAK — task/agent/skill/decision↔knowledge not traversable | CR-A.2 Knowledge Links Index |
| G-K3 | 1 | 3 | PARTIAL — retrieval can silently drop decisions/open-questions | Links read as task-layer source; decisions/open-questions pinned above droppable graph nodes; explicit `dropped_for_budget:` |
| G-K4 | 7, 9 | 14 | WEAK — learning run-terminal, not phase-terminal | CR-C per-phase LearningCheckpoint |
| G-K5 | 7 | 16 | FAIL — 9/12 learning targets unwired | CR-C wires all 12 columns; CR-A.2 wires work-edges |
| G-K6 | 1 | 1 | WEAK — no re-label/re-link on feature/task change | LearningCheckpoint `knowledge_graph: refresh` + `task_tracking: update`; wiki-lint stale-label check |
| G-K7 | 1 | 3 | WEAK — no retrieval-completeness contract | VC-K3 retrieval-completeness assertion |
| G-F1 | 2 | 4 | WEAK→MISSING — no canonical skill template artifact | CR-B `SKILL.template.md` |
| G-F2 | 2 | 5 | MISSING — no one-skill-vs-template classifier | CR-B single classifier |
| G-F3 | 2 | 6 | MISSING — no template-change → migrate flow | CR-B lazy/staged migration |
| G-F4 | 3 | 7 | WEAK — no agent template; operating_style/personality not first-class | CR-B `AGENT.template.md` (5 fields, bounded enums) |
| G-F5 | 3 | 8 | MISSING — no one-agent-vs-template classifier | CR-B same classifier, agent side |
| G-F6 | 3 | 9 | MISSING — no agent-template-change → migrate flow | CR-B same migration flow, agent side |
| G-F7 | 8 | 15 | WEAK — UA concepts severed from factory/evolution | CR-B factory reads knowledge-graph/reflections as durable evidence (read-only) |
| G-F8/G-O5 | 5 | 12 | HIGH — `create-specialist` writes plugin state | CR-B + CR-D: retarget to `.guild/{agents,skills}/` (v2 defect-fix) |
| G-O1 | 4 | 10, 11 | PARTIAL — config covers ~3/8 dimensions | CR-D Tier-2 closed `defaults:` block |
| G-O2 | 4 | 10 | WEAK — settings.json/project.yaml split undefined | CR-D split rule; `share_mode` → `settings.json` |
| G-O3 | 5 | 12 | MISSING — no normative ownership map | CR-D normative table (this ADR set) |
| G-O4 | 5 | 12 | MISSING — boundary unenforceable | CR-D PreToolUse guard + audit boundary-check |
| G-O6 | 6 | 13 | MISSING — no cross-initiative registry | CR-A.3 `initiatives-registry.yaml` + existing `/guild:status` surfaces |
| G-O7 | 6 | 13 | CONFLICT vs G4/OQ10 | OQ10→NO was the prose summary; Concept 6 wants STATE — append-only `provenance.json` at run-close, no gate, no initiative dir for one-off |
| G-O8 | 6 | 13 | MISSING — "what changed since last run" | Computed on demand by `/guild:status` (zero stored bytes) |
| G-O9 | 6 | 13 | WEAK — cross-initiative promotion backlog | Derived view over `reflections/` (zero stored bytes) |

**Q16 (which components fail the loop):** today the loop is
`run → reflect(once) → queue → evolve-skill`. Non-participants now wired by
CR-C: agent definitions, agent+skill templates, project config,
task/progress tracking for one-off runs, workflow rules / review policy,
domain model, the KnowledgeGraph work-edges. 9/12 → 12/12.

**Q17 (design changes to make concepts explicit + enforceable):** CR-A
(label schema + links index), CR-B (template artifacts + classifier +
migration), CR-C (per-phase checkpoint), CR-D (config schema + ownership
map + PreToolUse guard) — all `[v2]`, all inside the locked rails, all
reusing the existing reflections→promotion pipeline and the DI-6
derived-index discipline.

## Phased implementation plan (design-ready, no code; all `[v2]`)

| Phase | Scope | Depends on |
|---|---|---|
| P1 — Contracts & ownership | Template-version strings; ownership map + config schema; `ops` verb; EPP/grammar | — (unblocks all) |
| P2 — Knowledge model (CR-A) | Label schema; `knowledge-links.json`; `project.yaml label_taxonomy:`; retrieval overflow rule | P1 |
| P3 — Learning loop (CR-C) | Per-phase LearningCheckpoint step 7.5; 12-target enum; edge-batch; reflections fed per-phase | P1 (P2 for edge-batch) |
| P4 — Templates & migration (CR-B) | `SKILL.template.md`, `AGENT.template.md`; classifier; template-change gate; lazy/staged migration | P1, P3 |
| P5 — Boundary, config, tracking (CR-D) | PreToolUse guard; `/guild:audit` boundary-check; `provenance.json`; `initiatives-registry.yaml`; config fold-at-intake | P1 |
| P6 — Hygiene sweep (DH-1) | Kill-list + frontmatter normalization across the definitional set | runs alongside P2–P5 |
| P7 — Validation | Run the consolidated VC-* as the done-gate | P2–P6 |

Dependency summary: P1 → all; P2 → P3 edge-batch; P3 → P4 classifier; P5
independent; P6 interleaved; P7 last. No concept mechanism is `[v2.x]`.

## Consequences

- The definitional docs gain concept *definitions* only; gap analysis, plan,
  and validation criteria live here and in the three sibling ADRs.
- The only new user-facing gate introduced across all four CRs is the
  interactive **template-change gate** (CR-B); every other mechanism rides an
  existing surface.
- No locked decision is reopened: wiki stays canonical, the graph stays
  derived, filesystem-only is preserved, the permission/sandbox/runtime
  carve-out (D5) is intact, and "agents emit candidates; only
  decisions/wiki-ingest promote" holds.
- See [continuous-knowledge-and-learning-loop](continuous-knowledge-and-learning-loop.md),
  [templates-and-migration](templates-and-migration.md), and
  [guild-boundary-config-and-tracking](guild-boundary-config-and-tracking.md)
  for the per-area decisions and validation criteria.
