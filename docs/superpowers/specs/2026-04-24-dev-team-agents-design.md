# Dev Team Agents — Design Spec

**Date:** 2026-04-24
**Status:** Approved (sections 1–5)
**Supersedes:** none
**Source plan:** `guild-plan.md` v0.4

---

## 1. Problem

Guild (`guild-plan.md`) is a ~4–5 week, 7-phase Claude Code plugin build. The repo is currently greenfield (plan, README, LICENSE, diagrams). We need a team of Claude Code subagents — distinct from the 13 shipping Guild specialists inside the plugin — that can actually *build* the plugin end-to-end.

Key distinction: these are **dev-time agents** (lowercase-g "guild for building Guild"), used during implementation. The 13 specialists under `agents/` at the repo root are **shipping artifacts** (the plugin's product, not its builders).

## 2. Approach summary

Eight craft-based dev subagents, project-local under `.claude/agents/`, orchestrated from the main Claude Code session. Each agent:

- owns a disjoint file scope so work can parallelize;
- dogfoods superpowers methodology (TDD, verification-before-completion, writing-skills) — matching the Tier-4 REFERENCE policy Guild itself adopts;
- returns a structured handoff receipt that mirrors the plan's §8.2 specialist-handoff contract, so the team behaves like Guild before Guild exists;
- quotes plan-section anchors rather than re-deriving design.

## 3. Placement

```
.claude/agents/
├── plugin-architect.md
├── skill-author.md
├── specialist-agent-writer.md
├── command-builder.md
├── hook-engineer.md
├── tooling-engineer.md
├── docs-writer.md
├── eval-engineer.md
└── _shared/
    ├── handoff-contract.md
    ├── plan-anchors.md
    └── superpowers-mapping.md
```

Checked into git (shared dev tools). Explicitly separate from `agents/` at the repo root, which is reserved for the plugin's shipping specialists.

## 4. Roster

| # | Agent | Plan anchors | File scope (exclusive owner) | Model |
|---|---|---|---|---|
| 1 | **plugin-architect** | §3, §4, §13.1 | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, repo-root `CLAUDE.md`, top-level scaffolding, release versioning, integration dogfood | opus |
| 2 | **skill-author** | §5, §10.1.1, §11 | `skills/core/*`, `skills/meta/*`, `skills/knowledge/*`, `skills/fallback/*`, `skills/specialists/*` — skill bodies, frontmatter, per-skill `evals.json` | opus |
| 3 | **specialist-agent-writer** | §6, §12 | `agents/*.md` — the 13 shipping Guild specialists with pushy `TRIGGER` / `DO NOT TRIGGER` blocks | opus |
| 4 | **command-builder** | §13.1 | `commands/guild.md`, `commands/guild-team.md`, `commands/guild-evolve.md`, `commands/guild-wiki.md`, `commands/guild-rollback.md`, `commands/guild-stats.md`, `commands/guild-audit.md` | sonnet |
| 5 | **hook-engineer** | §13.2 | `hooks/hooks.json`, `hooks/bootstrap.sh`, `hooks/check-skill-coverage.sh`, `hooks/capture-telemetry.ts`, `hooks/maybe-reflect.ts`, agent-team hook handlers | sonnet |
| 6 | **tooling-engineer** | §11.2, §12, §13.3 | `scripts/` (evolve loop, flip report, description optimizer, rollback walker, shadow-mode harness), `.mcp.json`, `mcp-servers/guild-memory/`, `mcp-servers/guild-telemetry/` | sonnet |
| 7 | **docs-writer** | §3, §6, §9, §10, §11 | `docs/architecture.md`, `docs/specialist-roster.md`, `docs/self-evolution.md`, `docs/wiki-pattern.md`, `docs/context-assembly.md`, README polish | opus |
| 8 | **eval-engineer** | §11.2, §15.2 | `tests/` — trigger-accuracy evals, skill eval fixtures, `wiki-lint` fixtures, end-to-end regression specs, paired-eval harness tests | opus |

**Overlap notes:** `README.md` is scaffolded by plugin-architect, polished later by docs-writer — sequenced, not concurrent. Per-skill `evals.json` lives next to the skill (owned by skill-author); cross-cutting eval fixtures and regression specs live under `tests/` (owned by eval-engineer).

## 5. Shared prompt conventions

Every agent body opens with four fixed blocks, then diverges into role-specific guidance.

### Block 1 — Plan anchors (role-specific)

Explicit list of `guild-plan.md` sections the agent must read before acting. Example for `skill-author`: "Read §5, §10.1.1, §11.2 before authoring. For specialist skills, also read §6.4."

### Block 2 — Superpowers skills to invoke

| Agent | Superpowers skills required |
|---|---|
| plugin-architect | `verification-before-completion`, `requesting-code-review`, `finishing-a-development-branch` |
| skill-author | `writing-skills` (mandatory per skill), `test-driven-development`, `verification-before-completion` |
| specialist-agent-writer | `writing-skills`, `verification-before-completion` |
| command-builder | `test-driven-development`, `verification-before-completion` |
| hook-engineer | `test-driven-development`, `systematic-debugging`, `verification-before-completion` |
| tooling-engineer | `test-driven-development`, `systematic-debugging`, `verification-before-completion` |
| docs-writer | `verification-before-completion` (linked refs resolve, diagrams render) |
| eval-engineer | `test-driven-development` (the work is tests), `verification-before-completion` |

### Block 3 — Handoff contract

Every agent returns a structured closing message to main session:

- `changed_files:` list of paths
- `opens_for:` downstream agents now unblocked
- `assumptions:` things the agent didn't ask about but proceeded on
- `evidence:` test output, file counts, lint results, sample outputs
- `followups:` scoped work the agent saw but didn't do

Shape mirrors plan §8.2. The full schema lives in `.claude/agents/_shared/handoff-contract.md`.

### Block 4 — Quality checklist (role-specific)

Five bullets max per agent. Example for `skill-author`:

- Every skill has frontmatter `name` / `description` / `when_to_use`.
- Description ≤ 1024 chars and triggers on at least 3 phrasings.
- `evals.json` has ≥ 3 positive and ≥ 3 negative cases.
- No drive-by edits outside `skills/`.
- Each skill cites the `guild-plan.md` section it implements.

### Forbidden scopes

Every agent's frontmatter description ends with a pushy `DO NOT TRIGGER for: <list>` matching the plan's §6 / §12 boundary philosophy. Prevents e.g. `skill-author` drifting into writing slash commands or hooks.

## 6. Coordination model

**Orchestration.** Main Claude Code session drives. Each time work is ready, main session invokes `Agent({subagent_type: "<name>", prompt: "<plan-anchor + scope + handoff schema>"})`. Agents are stateless between invocations and never call each other.

**Parallelism.** Within a phase, agents with disjoint file scopes run in parallel — dispatched in a single message with multiple `Agent` calls. Across phases, main session waits for the hard-dep upstream agent to close before kicking downstream.

**Commits.** Agents never commit. Main session commits, so history stays linear and reviewable.

**No worktrees.** File scopes are already disjoint; the only overlap (`README.md`) sequences trivially. Worktree overhead buys nothing here.

## 7. Dependency order / activation graph

Maps the plan's 7 phases to agent activations. Hard deps are solid arrows; soft deps in parentheses.

**P0 — skeleton**
- `plugin-architect` lays down repo layout, `plugin.json`, `marketplace.json`, root `CLAUDE.md`. Unblocks everyone.

**P1 — reliable spine** (per plan §14 P1)
- `skill-author` writes T1 (`guild:principles`) + the T2 spine skills authored in P1: `brainstorm`, `team-compose`, `plan`, `context-assemble`, `execute-plan`, `review`, `verify-done`. Handoff-receipt scaffolding lives inside `execute-plan` / `verify-done`.
- `specialist-agent-writer` writes the first three specialist agent files (architect, backend, copywriter — per plan §14 P1).
- `command-builder` writes `/guild` referring to the T2 skills.
- `eval-engineer` writes trigger-accuracy evals for the P1 T2 skills.

**P2 — wiki + decisions + provenance** (per plan §14 P2)
- `skill-author` writes T3 (`wiki-ingest`, `wiki-query`, `wiki-lint`) + T2 `guild:decisions` (authored here because the wiki targets for decisions land now).
- `command-builder` writes `/guild:wiki`.
- `eval-engineer` writes wiki-lint fixtures.

**P3 — full roster**
- `specialist-agent-writer` writes the remaining 10 specialist agents (researcher, devops, qa, mobile, security, technical-writer, social-media, seo, marketing, sales).
- `skill-author` writes T5 specialist skills (~50 across 13 roles).
- `eval-engineer` writes boundary-collision evals (§15.2 risk #1).

**P4 — agent-team backend**
- `hook-engineer` writes `TaskCreated`, `TaskCompleted`, `TeammateIdle` hooks.
- `command-builder` adds `/guild:team edit --allow-larger`.

**P5 — telemetry + reflection**
- `hook-engineer` wires `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `Stop`, and writes `hooks/capture-telemetry.ts` + `hooks/maybe-reflect.ts` (ownership per §4).
- `tooling-engineer` writes any telemetry-query utilities that live under `scripts/` (e.g., a trace summarizer consumed by `maybe-reflect.ts`).
- `skill-author` writes `guild:reflect` (authored here, per plan §14 P5, since reflection depends on telemetry emission being live).

**P6 — evolution + create-specialist**
- `skill-author` writes `guild:evolve-skill`, `guild:create-specialist`, `guild:rollback-skill`, `guild:audit`.
- `tooling-engineer` writes `scripts/` (eval loop, flip report, description optimizer, shadow mode) and the optional `guild-memory` + `guild-telemetry` MCP servers.
- `command-builder` writes `/guild:evolve`, `/guild:rollback`, `/guild:stats`, `/guild:audit`.
- `eval-engineer` writes shadow-mode fixtures and flip-report unit tests.

**Throughout**
- `docs-writer` runs after each phase spine settles, reconciling docs with reality.
- `plugin-architect` runs integration dogfood and cuts an internal version tag at each phase boundary.

## 8. Integration gates

At each phase boundary, `plugin-architect` runs the gate:

1. End-to-end `/guild` dogfood on the scoped capability (P0: install works; P1: full spine on a synthetic spec; P2: ingest + query + lint; P3: team-compose picks the right team on 25 synthetic specs; P4: one agent-team run; P5: a completed task produces a non-trivial reflection; P6: promote one skill update + create one proposed specialist).
2. `eval-engineer` runs the phase's eval suite.
3. `docs-writer` reconciles docs with reality.

Only after the gate passes does the next phase unlock.

## 9. Out of scope for this task (the team-build itself)

- Any content under the plugin (`skills/`, repo-root `agents/`, `commands/`, `hooks/`, `scripts/`, `docs/<plugin-docs>/`, etc.) — that's what the team *builds*, driven by the implementation plan produced next.
- Executing any of the 8 agents during team construction. Building ≠ running.

## 10. Deferred decisions

- Model choice per code-heavy agent if Sonnet proves insufficient for MCP server authoring — revisit when tooling-engineer hits P6.
- Whether to add a `release-manager` agent — currently absorbed by `plugin-architect`; split only if the role bloats past ~500 lines of prompt.
- Agent-level `tools:` scoping — default to full toolset now; tighten in P5 once telemetry reveals actual usage.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Agent prompts drift from `guild-plan.md` as plan evolves | Plan-anchors block is a literal section list; agents quote, don't paraphrase. Re-run anchor audit when plan version bumps. |
| Main session becomes the bottleneck (serial dispatch across 8 agents) | Dispatch disjoint-scope agents in a single message (parallel Agent calls within a phase). |
| skill-author's scope is enormous (~74 skills) and may need splitting | Revisit after P1; if token pressure shows, split into `meta-skill-author` + `specialist-skill-author`. |
| Handoff receipts become performative rather than useful | eval-engineer writes at least one regression test that consumes a receipt and acts on it — forces the schema to stay load-bearing. |
| Dev agents step on each other via README or shared config | plugin-architect owns `README.md` initially; docs-writer touches it only in designated polish passes at phase boundaries. |

## 12. Deliverables of this task

- 8 subagent definitions under `.claude/agents/`
- 3 shared reference docs under `.claude/agents/_shared/`
- This spec, committed
- An implementation plan produced by `guild:plan`, committed alongside this spec

Running the team to build the plugin is the *next* task, driven by that implementation plan.
