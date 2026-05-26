---
name: guild-context-assemble
description: Assembles per-specialist 3-layer context bundle: Universal (~400 tokens — guild:principles + project-overview + goals) + Role-dependent (~800–1500 — standards + 2–4 entity pages matching role) + Task-dependent (~800–1500 — lane from plan + named refs + upstream contracts + active decisions). Target ~3k tokens, hard cap 6k. TRIGGER: "build the context bundle for <specialist>", "prepare the brief for <role>", "what context does the architect need", "assemble context for backend". DO NOT TRIGGER for: loading all wiki pages, showing the full repo, compressing a single file.
when_to_use: Fourth step of Guild lifecycle, invoked per-specialist by guild:execute-plan before dispatching each lane.
type: meta
---

# guild:context-assemble

Implements `guild-plan.md §9` (context assembly — minimum viable context per specialist). Runs after `guild:plan` has produced an approved `.guild/plan/<slug>.md`, invoked per-lane by `guild:execute-plan` immediately before each specialist dispatch. One bundle per specialist per run.

## The rule

Per `guild-plan.md §9.1`: a specialist's authoritative task brief is the *union* of three layers — nothing more. No project-wide dumps. No sibling-specialist lanes unless the plan declares an upstream contract via `depends-on:`.

| Layer | Content | Size target |
|---|---|---|
| **Universal** | `guild:principles` + `wiki/context/project-overview.md` + `wiki/context/goals.md` | ~400 tokens |
| **Role-dependent** | `wiki/standards/*.md` matching the role (per §9.2 mapping) + 2–4 most-relevant entity pages from `wiki/entities/` matching the task domain | ~800–1500 tokens |
| **Task-dependent** | The specialist's lane block from `.guild/plan/<slug>.md` + named refs (concepts, decisions, products the spec/plan names) + upstream contracts pulled from each `depends-on:` task's completed output + active decisions from `wiki/decisions/` touching the task domain + (when a brownfield graph exists) a bounded KnowledgeGraph retrieval sub-source — see `## Graph retrieval` | ~800–1500 tokens |

Total target: ~3k tokens. Hard cap: 6k (enforced in `## Size budget`).

## Role mapping

Per `guild-plan.md §9.2`. Select standards and typical products by the specialist's role group:

| Role group | Standards loaded | Typical products loaded |
|---|---|---|
| Engineering (architect, backend, frontend, qa, devops, data) | `wiki/standards/coding-standards.md` | `wiki/entities/products/<component>.md` for each component the lane explicitly names |
| Writing (copywriter, tech-writer) | `wiki/standards/writing-voice.md` + `wiki/standards/branding.md` | `wiki/entities/products/<feature>.md` if the deliverable is user-facing |
| Social / SEO (seo, social) | `wiki/standards/writing-voice.md` + `wiki/standards/branding.md` + `wiki/standards/seo-rules.md` | `wiki/entities/products/<feature>.md` if the deliverable is user-facing |
| Commercial (marketing, sales) | `wiki/standards/branding.md` + `wiki/standards/pricing-policy.md` | `wiki/entities/products/*.md` for any product the lane references |

If a standards file listed for a role group does not exist in `wiki/standards/`, skip it silently — do not fabricate or stub. The bundle should reflect what the wiki actually contains at the moment the run starts.

## Output path

Per `guild-plan.md §9.3`: write the bundle to

```
.guild/context/<run-id>/<specialist>-<task-id>.md
```

- `<run-id>` — the run timestamp or run slug owned by `guild:execute-plan` (one directory per run, shared across all lanes in that run so bundles can be diffed together).
- `<specialist>` — the `owner` slug from the lane (matches `agents/<name>.md`).
- `<task-id>` — the lane's `task-id` from `.guild/plan/<slug>.md`.

The bundle is a single markdown file. First section is frontmatter naming the run-id, specialist, task-id, spec path, plan path, and the source paths of every page included (for reproducibility per §9.4). Remaining sections are the three layers in order: Universal, Role-dependent, Task-dependent. `guild:execute-plan` passes this file path as the specialist's primary task brief; it is not merged back into chat before dispatch.

## Size budget

Target ~3k tokens per bundle. Hard cap 6k tokens.

If a bundle exceeds the cap, summarize the lowest-weighted layer — in practice this is the task-dependent ref tail beyond the two highest-priority pages. Summarization rules:

1. Keep the lane block verbatim (it is the specialist's contract).
2. Keep upstream contracts from `depends-on:` tasks verbatim (they are load-bearing for handoff).
3. Collapse additional named refs beyond the two highest-priority pages into 2–3 sentence summaries with the source path retained so the specialist can pull the full page on demand.
4. If still over cap, drop role-dependent entity pages down to 2 (from up to 4), again with source paths retained.
5. Universal layer is never summarized — it is the smallest and most load-bearing.

Record the final token estimate in the bundle's frontmatter so `guild:review` and eval harnesses can audit drift over time.

## Graph retrieval

When a brownfield `KnowledgeGraph` index exists
(`.guild/indexes/knowledge-graph.json`, `guild.knowledge_graph.v1` — bound by
pointer: `docs/knowledge/implementation/contract-map.md §A` row 12; built by
`guild:learn-graph`), the **task-dependent** layer MAY include a
bounded graph sub-source. Rules are fixed by
`docs/knowledge/architecture/codebase-understanding.md §"Relationship to the
wiki and guild-memory"` (cited, never re-spelled here):

- **Grep-first, never dump the graph.** Retrieve via the shipped helper
  `npx tsx plugin/scripts/understand/kg-query.ts --cwd <repo-root>
  --q "<task terms>" [--type file,function,…] --json` (deterministic token
  scoring, hard-capped output). Never read the whole graph file into the
  bundle.
- **Graph sub-cap = 1200 tokens**, inside (not on top of) the task-dependent
  budget. The **6k-token hard cap is unchanged**.
- **`source_priority: [wiki, knowledge_graph, codebase_map]`.** On overflow,
  drop the **lowest-weight graph nodes first — before** any wiki/role
  content is trimmed. Graph content is the first thing to go, never the last.
- **Contradiction rule.** If a graph node contradicts a wiki page, **prefer
  the wiki** unless the graph node has `confidence: high` **and** a direct
  `source_ref`. Record every such contradiction as a `followups:` entry for
  `guild:wiki-lint` (same channel as the ambient-conflict caveat below).
- Skip silently when no graph index exists (greenfield, or the deep tier was
  never built) — never fabricate or stub graph content.
- **Workspace fan-out.** When the root carries a `.guild/workspace.json`
  (`guild.workspace.v1`), wiki/kg recall fans out across the registered
  sub-guilds via the guild-memory `cwd` override — each hit tagged by its
  source sub-guild — instead of reading the (often empty) root wiki alone. See
  `guild:wiki-query`'s `## Federated fan-out` section; no sub-guild knowledge is
  copied into the bundle, and the 6k hard cap is unchanged.

## Ambient context caveat

Per `guild-plan.md §9.1`: Claude Code may still load the user's normal `CLAUDE.md`, enabled skills, MCP servers, and auto memory depending on the execution backend (subagent vs agent-team teammate) and user settings. The bundle is therefore a **context contract**, not a hard isolation boundary.

The specialist prompt must instruct the specialist to privilege the bundle over any ambient context it happens to see. When two sources conflict — e.g. an ambient `CLAUDE.md` standard contradicts `wiki/standards/coding-standards.md` — the bundle wins, and the conflict goes into the specialist's handoff receipt as a `followups:` entry so `guild:wiki-ingest` can reconcile on the next knowledge pass.

This caveat is the reason Guild does not pretend to build an airtight sandbox; it builds a stronger signal in the middle of a noisy channel.

## Handoff

`guild:context-assemble` is invoked once per specialist per run by `guild:execute-plan`. For a plan with four lanes, four bundles are written before the first subagent dispatches.

Handoff receipt per invocation should list: `bundle_path`, `specialist`, `task-id`, `run-id`, `token_estimate`, and `layers_included` (the three layer names each with the count of pages merged in). `guild:execute-plan` reads those receipts to confirm every lane has a bundle before it starts dispatching; a missing bundle blocks the corresponding dispatch.

The bundle path is the primary task brief passed to the subagent (or named explicitly in the agent-team teammate prompt when the subagent's frontmatter `skills`/`mcpServers` do not apply — see §9.3 constraint).
