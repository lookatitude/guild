---
type: context
owner: architect
confidence: high
importance: high
source_refs: []  # consolidated from plugin/docs/v2/ (711f227); supersedes: field below preserves the lineage
created_at: 2026-05-16
updated_at: 2026-06-21
expires_at: null
supersedes: "docs/v2/README.md"
sensitivity: public
applies_to: [plugin]
related: [architecture-overview, lifecycle-overview]
---

# Guild v2 Architecture

This folder is the v2 design reference for Guild's reconciled phase architecture. The headline of v2 is a single reconciliation: **Guild v2 is one state machine, six phase entrypoints, three lenses (linear / phase / initiative)**. The shipped 7-step linear spine (`guild-plan.md §8`) is re-homed as the implementation of Planning + Development, not deleted and not a peer model.

This v2 doc set **supersedes `guild-plan.md §8`** as the active architecture record. `guild-plan.md` is frozen as the v1 record; it carries a `supersedes:` pointer to `lifecycle-overview.md` (recorded here in prose only — this doc set does not edit `guild-plan.md`). Where the older plan and the checked-in skills/commands/agents disagree, the v2 doc set plus the more-specific checked-in artifacts win.

It reconciles the implementation state now present in the repo: `.claude-plugin`
manifests, 17 registered specialists, 38 meta-tier skills (all on disk under
`skills/meta/`; the former `fallback/` tier no longer exists — its forks were
absorbed into `guild:review` or promoted into `meta/`), the clean-slate command
surface, internal adversarial loops, cross-host reciprocal review, the
Guild-owned brownfield knowledge-graph engine, run-scoped telemetry,
tmux-backed agent teams, advisory memory agents, the factory path for new
skills and agents, and the `src/modules/*` source layer that owns every live
inventory id through `module.manifest.json` and module-local resources.

## Command Surface and Migration

Guild v2 is a clean-slate command redesign (full break, DX-first). Commands are colon-form **`/guild:<verb>`** — the `:` plugin namespace is a Claude Code requirement and **stays**; v2 drops only the redundant `guild-` command prefix (v1 `/guild:guild-wiki` → v2 `/guild:wiki`), never the colon (D1, confirmed by the bare-`/guild` spike). The frozen phase verbs are `init ideate plan build qa ops`, mapping to the phase *concept* names Init / Ideation / Planning / Development / Quality / Operations (the verb↔phase map is stated once, here). The Operations verb is **`ops`**. Lifecycle helpers `status` / `resume`; nouns `wiki <ingest|query|lint>` and `initiative <new|status|resume|update|close>`; maintenance verbs `evolve rollback stats audit fix migrate`. `/guild:guild [brief]` with no recognized subcommand token is the linear smart-detect lens; detection is always surfaced and gated. The `--loops`/`--loop-cap`/`--codex-cap` tuning flags remain supported as power-user flags (parsed at the `read-guild-config.ts` arg-parse switch for `--loops`/`--loop-cap`/`--codex-cap`), with `--rigor={quick|standard|deep}` + `.guild/settings.json` the recommended path; `--codex-review` is replaced by `--review={local|cross|off}`; `--rigor=deep` auto-implies `--review=cross` (the expanded profile, including cross-host Codex review, is printed before the first gate — no separate flag). The full old→new map ships in a dedicated `MIGRATION.md`.

## Reading Order

1. [architecture-overview.md](architecture-overview.md) - component map, state boundaries, invariants, and the one-machine reconciliation.
2. [plugin-module-architecture.md](plugin-module-architecture.md) - current plugin module layout, module ownership manifests, compatibility shims, and packaging validation.
3. [phase-entrypoints.md](../lifecycle/phase-entrypoints.md) - how to start from `init`, `ideate`, `plan`, `build`, `qa`, or `ops`.
4. [lifecycle-overview.md](../lifecycle/lifecycle-overview.md) - every phase, gate, loop, and artifact across the reconciled linear / phase / initiative lenses.
5. [team-composition.md](../team-and-routing/team-composition.md) - how each phase gets a tailored team, backend, skills, tools, advisory agents, and MCP access.
6. [knowledge-and-advisory.md](../knowledge-memory/knowledge-and-advisory.md) - wiki, memory recall, learning, and per-agent advisors.
7. [agent-and-skill-factory.md](../factory/agent-and-skill-factory.md) - how new concise Claude Code-first skills and personas are created, evaluated, shadowed, and registered.
8. [tools-and-mcp.md](../team-and-routing/tools-and-mcp.md) - tool and MCP attachment rules for subagents and tmux agent teams.
9. [adversarial-review.md](../adversarial-review/adversarial-review.md) - built-in challenger behavior, cross-host reciprocal review broker, and review gates.
10. [target-architecture.md](target-architecture.md) - frozen `task_run` / `host_adapter` contracts, graph artifacts, and the portable core.
11. [edge-cases.md](edge-cases.md) - failure modes and advisory defaults.
12. [codebase-understanding.md](codebase-understanding.md) - brownfield reverse-spec engine, knowledge-graph artifacts, refresh policy, internalized (forked, never a runtime dependency). Companion: [knowledge-classification-schema.md](knowledge-classification-schema.md) - the `guild.knowledge_graph.v2` node metadata contract (`category` enum / `importance` / `confidence` / `labels[]` / `topic_path`) read by `kg-query` ranking + `wiki-lint`.
13. [review-checklist.md](../adversarial-review/review-checklist.md) - completion and implementation checklist.
14. [review-trail.md](../adversarial-review/review-trail.md) - adversarial review findings and clean sign-off.
15. `MIGRATION.md` - clean-slate command break: full `/guild:guild-<verb>` → `/guild:<verb>` old→new map (the `:` namespace stays; only the redundant `guild-` prefix is dropped), flag folding, removed entrypoints.
16. [init-config-and-host-open-flow.md](init-config-and-host-open-flow.md) - init/repair + host-open detection flow, the native `/guild:config ui` surface, the `.gitignore` + fail-closed security policy, and the host support matrix (CLI/agents-file native; the 4 app/connector hosts are OPEN blockers). Binds the L1 config-surface-and-inheritance ADR by pointer.

## Diagram Index

Every v2 diagram is paired: an embedded mermaid block in its owning doc is the reviewable truth, with a `.mmd` companion and an exported `.svg` under `diagrams/`. SVG authoring is the single diagram-owner lane's responsibility.

The v2 semantics of the v1-legacy diagrams `01,03,04,05,06,07,08,09,10`
(`.svg`-only, no `.mmd` companion) are fully re-expressed by the paired v2
reconciliation diagrams D-11..D-20 below; the legacy pixels are not
reverse-engineered into mermaid. `02-lifecycle-gates` is authored from the
reconciled state machine + phase→station→command→gate table in
`../lifecycle/lifecycle-overview.md` and ships as both `.mmd` + `.svg` (the
`.mmd` is authoritative).

- `diagrams/01-system-map.svg` — v1-legacy, superseded by **D-15** (system component map). No `.mmd`.
- [Lifecycle and gates](diagrams/02-lifecycle-gates.svg) — `diagrams/02-lifecycle-gates.mmd` — authored from the lifecycle-overview state machine + gate table.
- `diagrams/03-team-composition.svg` — v1-legacy, superseded by **D-15** (system component map). No `.mmd`.
- `diagrams/04-agent-team-tmux.svg` — v1-legacy, superseded by **D-15** (system component map). No `.mmd`.
- `diagrams/05-context-and-handoff.svg` — v1-legacy, superseded by **D-15/D-18** (component map / knowledge layer). No `.mmd`.
- `diagrams/06-adversarial-loops.svg` — v1-legacy, superseded by **D-16** (cross-host review broker). No `.mmd`.
- `diagrams/07-skill-agent-factory.svg` — v1-legacy, superseded by **D-15** (system component map). No `.mmd`.
- `diagrams/08-tools-mcp-routing.svg` — v1-legacy, superseded by **D-17** (`task_run` → router → host-adapter). No `.mmd`.
- `diagrams/09-phase-entrypoints.svg` — v1-legacy, superseded by **D-13** (phase entrypoint contract). No `.mmd`.
- `diagrams/10-knowledge-advisory.svg` — v1-legacy, superseded by **D-18** (knowledge layer). No `.mmd`.

v2 reconciliation diagrams D-11 .. D-20 (each = embedded mermaid in its owning doc + `.mmd` companion + `.svg`; SVG authoring is the single diagram-owner lane's responsibility):

- **D-11** Codebase-understanding flow (7-stage script→LLM pipeline + 4 artifacts + plug points P1/P2/P3; label-persistence + knowledge-links emission on stages 4–5) — [`.svg`](diagrams/11-codebase-understanding.svg) / [`.mmd`](diagrams/11-codebase-understanding.mmd) — owned by `codebase-understanding.md`.
- **D-12** Reconciled lifecycle state machine (6 phases + spine stations + cross-phase loops + opt-in initiative nesting + close gate; Quality/Operations are full `guild:quality`/`guild:operations` skills `[v2]`; the per-phase **step-7.5 LearningCheckpoint** slot on every phase review boundary) — [`.svg`](diagrams/12-reconciled-lifecycle.svg) / [`.mmd`](diagrams/12-reconciled-lifecycle.mmd) — owned by `../lifecycle/lifecycle-overview.md`.
- **D-13** Phase entrypoint contract (each phase's entrypoint, required upstream artifact, backward-then-forward upstream-resolution) — [`.svg`](diagrams/13-phase-entrypoints.svg) / [`.mmd`](diagrams/13-phase-entrypoints.mmd) — owned by `../lifecycle/phase-entrypoints.md`.
- **D-14** Command surface (command→phase map + smart-detect + opt-in initiative wrapper + maintenance verbs) — [`.svg`](diagrams/14-command-surface.svg) / [`.mmd`](diagrams/14-command-surface.mmd) — owned by `../lifecycle/phase-entrypoints.md` (primary), referenced from this Diagram Index.
- **D-15** System component map (orchestrator → meta-skills/gates → context-assembler → `task_run` → host-adapter router → adapters → specialists → receipt → broker → review/verify → reflect → evolve) — [`.svg`](diagrams/15-system-component-map.svg) / [`.mmd`](diagrams/15-system-component-map.mmd) — embedded in `architecture-overview.md`.
- **D-16** Cross-host review broker (placement + independence) — [`.svg`](diagrams/16-cross-host-review-broker.svg) / [`.mmd`](diagrams/16-cross-host-review-broker.mmd) — embedded in `../adversarial-review/cross-host-review-and-loop-control.md`.
- **D-17** `task_run` → router → host-adapter swimlanes + degrade path (`codex-local [v2]` co-equal lane + `codex-cloud` per-run opt-in gate + packet-egress always-ask checkpoint, `cloud_task_packet.v1` `[v2-contract-only]`, never router-default) — [`.svg`](diagrams/17-task-run-host-adapter.svg) / [`.mmd`](diagrams/17-task-run-host-adapter.mmd) — embedded in `target-architecture.md`.
- **D-18** Knowledge layer (wiki canonical vs KnowledgeGraph derived index, BM25 `guild-memory`, context-assembler retrieval budget; the closed `labels:` schema layer + the `knowledge-links.json` work↔knowledge↔behavior projection) — [`.svg`](diagrams/18-knowledge-layer.svg) / [`.mmd`](diagrams/18-knowledge-layer.mmd) — owned by `../knowledge-memory/knowledge-and-advisory.md`.
- **D-19** Provider-neutral mixed-host tmux team (tmux-as-supervisor + symmetric Claude/Codex orchestrator-teammate panes + artifact-bus coordination) — [`.svg`](diagrams/19-mixed-host-tmux-team.svg) / [`.mmd`](diagrams/19-mixed-host-tmux-team.mmd) — owned by `../team-and-routing/claude-code-adapter.md`.
- **D-20** Guild boundary + provenance (the normative `.guild/` ownership map + the PreToolUse Guild-owned-file boundary guard + the `provenance.json` → `initiatives-registry.yaml` / `knowledge-links.json` derived-projection pattern) — [`.svg`](diagrams/20-guild-boundary-and-provenance.svg) / [`.mmd`](diagrams/20-guild-boundary-and-provenance.mmd) — owned by `../knowledge-memory/knowledge-and-advisory.md`.

Observability diagram (paired `.mmd`+`.svg` under `../observability/diagrams/`):

- **O-1** SQLite read-through index `query()` fallback flow (caller → staleness check → [fast index read | filesystem scan + async re-index]; index drawn dashed, "optional read-through; rebuildable; not a contract") — [`.svg`](../observability/diagrams/01-sqlite-read-through-index.svg) / [`.mmd`](../observability/diagrams/01-sqlite-read-through-index.mmd) — owned by `../observability/data-model.md` / `../observability/observability-tracing-replay.md`.

## Binding Principles

- **Phase/spine reconciliation:** Guild v2 is one state machine, six phase entrypoints, three lenses (linear / phase / initiative). The shipped 7-step linear spine (`guild-plan.md §8`) is re-homed as the implementation of Planning + Development — the default forward path, not a peer model. This v2 doc set is the active architecture record; `guild-plan.md` is frozen as the superseded v1 record. See [architecture-overview.md](architecture-overview.md) for the one-machine map and [lifecycle-overview.md](../lifecycle/lifecycle-overview.md) for the phase→station→command→gate table.
- **Command grammar:** commands are colon-form `/guild:<phase|noun|maintenance-verb>` with `[positional] [--flags]`. The `:` plugin namespace **stays** (Claude Code requires it); v2 drops only the redundant `guild-` command prefix (v1 `/guild:guild-wiki` → v2 `/guild:wiki`) — one migration, done inside the clean-slate break and documented in `MIGRATION.md`. Phase verbs are `init ideate plan build qa ops`.
- **External-plugin policy — v2-EPP-1 (G6-amended):** Codex (`openai-codex`) is the **sole permitted external runtime plugin**. It serves as a **co-equal host adapter** (originate / execute / review runs via the neutral `task_run` contract) *plus* the rescue, stop-time-review, and CLI-runtime carve-out surfaces. There is **no fixed surface-count ceiling** on Codex. The external-plugin **exclusivity** rule is unchanged: understand-anything, superpowers, and all other third-party capabilities are forked/internalized under MIT attribution and are **never runtime dependencies**. See [external-plugin-internalization-policy](../research/25-external-plugin-internalization-policy.md).
- The knowledge graph is a derived index over the wiki and the repo — never a replacement for `.guild/wiki/`, and never an external-plugin runtime dependency.
- **One connected knowledge + learning model `[v2]`.** Guild operates as a continuously-learning project-orchestration system: a closed knowledge-label schema on canonical wiki pages + derived graph nodes, a `knowledge-links.json` work↔knowledge↔behavior edge layer, a per-run `provenance.json`, and a derived `initiatives-registry.yaml` are **one model, not two** — every connective addition is a derived/rebuildable/deletable projection (filesystem canonical, no MCP, no embeddings). The single continuous-learning loop is the per-phase **LearningCheckpoint** (classification verdict over 12 targets, no new user gate) feeding the existing reflections→promotion pipeline. Canonical schemas in [target-architecture.md](target-architecture.md) (Artifact Model + sibling-schema registry); the knowledge model in [knowledge-and-advisory.md](../knowledge-memory/knowledge-and-advisory.md); the loop in [lifecycle-overview.md](../lifecycle/lifecycle-overview.md).
- **Canonical templates + `.guild/` boundary `[v2]`.** The plugin ships exactly two canonical, minimal, **read-only** templates — `plugin/templates/skills/SKILL.template.md` (`guild.skill_template.v1`) and `plugin/templates/agents/AGENT.template.md` (`guild.agent_template.v1`). Every project-authored or evolved skill/agent instance lives under the consuming repo's `.guild/skills/` & `.guild/agents/` with `derived_from_template` stamped; Guild never writes Guild-owned files outside `.guild/`. One normative `.guild/` ownership map + a PreToolUse Guild-owned-file boundary guard (reusing the existing approval channel — no new gate) + a `/guild audit` boundary-check enforce it. Canonical strings + the ownership-map pointer in [target-architecture.md](target-architecture.md) and [architecture-overview.md](architecture-overview.md).
- Current checked-in skills, commands, hooks, and agents refine the v2 design where they are more specific than the older plan.
- These docs are documentation-only. They do not change runtime behavior by themselves.
- The execution backend is settings-resolved at run-start intake per the D5 ladder (team/tmux primary when `tmux` is available, `$TMUX` is unset, and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set), resolved once and frozen in the run's resolved-settings snapshot. When `agent_mode != "team"` and tmux is available, the run-start preflight prompts to persist `agent_mode: "team"`.
- Every phase composes its own team and review loop. Init and Ideation are deliberately interactive; Development, Quality, and Operations are autonomous as far as the approved contract allows.
- Every non-trivial design artifact has an adversarial challenger before it becomes authoritative, with cross-host reciprocal review preferred when both Claude and Codex are available.
