# Architecture

Implements `guild-plan.md §3` (current reality after P0–P6).

## Overview

Guild is a Claude Code plugin that turns a single session into a disciplined team of
specialist agents. The shipped architecture has four layers:

- **Session** — the orchestrator (main Claude Code session) dispatching specialists
  through the Agent tool or, opt-in, the experimental agent-team backend.
- **Plugin** — installed content in this repo: `skills/`, `agents/`, `commands/`,
  `hooks/`, `scripts/`, `mcp-servers/`, `.mcp.json`, `.claude-plugin/plugin.json`.
- **Specialists** — 13 subagents defined in `agents/*.md` with `isolation: worktree`,
  each instructed to treat its context bundle as authoritative.
- **Project-local state** — `.guild/` at the consuming repo root. Every mutable
  artifact lives here: raw sources, wiki, telemetry, reflections, evolve workspaces,
  skill-version snapshots, per-run spec/plan/team/context/handoff files.

The bundle written by `guild-context-assemble` is a **strong context contract**,
not a hard isolation boundary — Claude Code still loads ambient `CLAUDE.md`, plugin
skills, and user memory. See `context-assembly.md` §4 for the caveat.

## Directory layout (what actually exists today)

```
guild/
├── .claude-plugin/plugin.json          # plugin manifest
├── .mcp.json                            # optional MCPs: guild-memory, guild-telemetry
├── CLAUDE.md                            # root operating principles
├── README.md
├── guild-plan.md                        # single source of truth
│
├── skills/                              # 67 skills across 5 tiers
│   ├── core/principles/                 # T1 · 1 skill
│   ├── meta/                            # T2 · 13 skills (see below)
│   ├── knowledge/                       # T3 · 3 skills: wiki-ingest, wiki-query, wiki-lint
│   ├── fallback/                        # T4 · empty; superpowers is referenced directly
│   └── specialists/                     # T5 · 50 skills across 13 roles
│
├── agents/                              # 13 specialist definitions (.md)
├── commands/                            # 7 slash commands (.md)
├── hooks/                               # hooks.json + handlers
│   ├── hooks.json
│   ├── bootstrap.sh
│   ├── check-skill-coverage.sh
│   ├── capture-telemetry.ts
│   ├── maybe-reflect.ts
│   └── agent-team/                      # task-created, task-completed, teammate-idle
├── scripts/                             # 7 tooling scripts (tsx)
├── mcp-servers/                         # 2 bundled servers: guild-memory, guild-telemetry
├── tests/                               # cross-cutting fixtures & harnesses
├── templates/                           # specialist and skill scaffolds
└── docs/
    ├── architecture.md  specialist-roster.md  self-evolution.md
    ├── wiki-pattern.md  context-assembly.md
    ├── diagrams/                        # 8 SVGs referenced above
    └── phase-gates/                     # P0–P6 closed gates
```

**Meta skills shipped (T2, 13):** audit · brainstorm · context-assemble ·
create-specialist · decisions · evolve-skill · execute-plan · plan · reflect ·
review · rollback-skill · team-compose · verify-done. `using-guild` from the plan
is not materialized as a separate skill — its role is served by `commands/guild.md`.

**Fallback skills shipped (T4, 5):** tdd · systematic-debug · worktrees ·
request-review · finish-branch. Each is forked from the corresponding
`superpowers:*` skill (v5.0.7, MIT) with attribution under
`skills/fallback/<name>/LICENSE-attribution.md`. Guild ships self-contained —
no runtime dependency on the superpowers plugin. See `guild-plan.md §5`
forking policy.

## Lifecycle flow — the 7-step `/guild` pipeline

Implemented in `commands/guild.md`, each phase delegates to a T2 skill:

```
User intent
 → guild-brainstorm       spec → .guild/spec/<slug>.md
 → guild-team-compose     team → .guild/team/<slug>.yaml
 → guild-plan             lanes → .guild/plan/<slug>.md
 → guild-context-assemble bundles → .guild/context/<run-id>/<specialist>-<task-id>.md
 → guild-execute-plan     dispatch → subagent or agent-team
 → guild-review           2-stage: spec match, then quality
 → guild-verify-done      tests · scope · success-criteria
 → guild-reflect          post-Stop hook, proposals only
```

User-confirmation gates exist after brainstorm (spec approval), team-compose
(team approval), and plan (plan approval). Post-plan the pipeline runs with
minimal interruption. Decisions captured mid-run are routed through
`skills/meta/decisions/SKILL.md` and land in `.guild/wiki/decisions/`.

Parallelism rules (per `guild-plan.md §8`):
- Architect runs first when present — its output is a common dependency.
- Backend → QA (integration tests); DevOps → QA (staging).
- Content and commercial specialists run in parallel with engineering when they
  only need the spec.

## Backend options

Two execution backends, configured per-task in `.guild/team/<slug>.yaml`:

| Backend | Default? | Implementation |
|---|---:|---|
| **Subagents via Agent tool** | Yes | The orchestrator dispatches each specialist through `Agent` / `Task`. Worktree isolation is the default. Lower cost, simpler cleanup. |
| **Agent teams (tmux)** | Opt-in | `scripts/agent-team-launcher.ts` spawns a tmux session with one pane per specialist, exporting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. One team per session; nested teams rejected. |

The launcher is invoked only when `team.yaml` declares `backend: agent-team`.
Hooks `task-created`, `task-completed`, and `teammate-idle` govern ownership,
handoff receipts, and nudges in that mode.

## Hooks inventory (8 events wired)

From `hooks/hooks.json`:

| Event | Handler | Purpose |
|---|---|---|
| `SessionStart` | `hooks/bootstrap.sh` | Inject short Guild status + command list. |
| `UserPromptSubmit` | `hooks/check-skill-coverage.sh` + `hooks/capture-telemetry.ts` | Nudge missing-skill coverage; log NDJSON event. |
| `PostToolUse` (matcher `Agent\|Task\|Write\|Edit\|Bash\|Skill`) | `hooks/capture-telemetry.ts` | Append events to `.guild/runs/<run-id>/events.ndjson`. |
| `SubagentStop` | `hooks/capture-telemetry.ts` | Flush specialist-level telemetry. |
| `Stop` | `hooks/maybe-reflect.ts` | Heuristic gate (≥1 specialist dispatched + ≥1 edit + no error) → `guild-reflect`. |
| `TaskCreated` | `hooks/agent-team/task-created.ts` | Validate ownership, deps, output contract before tasks join the agent-team queue. |
| `TaskCompleted` | `hooks/agent-team/task-completed.ts` | Block completion if handoff receipt is missing changed-files / evidence / assumptions / risks. |
| `TeammateIdle` | `hooks/agent-team/teammate-idle.ts` | Nudge idle teammates who still own open tasks. |

Tests live under `hooks/__tests__/` and `hooks/agent-team/__tests__/`.

## Scripts (7 tooling scripts)

Under `scripts/` — all tsx, Node-stdlib-only, filesystem-and-stdio-only. See
`scripts/README.md` for the shared CLI contract. Plan anchors noted:

| Script | Plan anchor | Role |
|---|---|---|
| `scripts/evolve-loop.ts` | §11.2 | Orchestration wrapper. Snapshots live skill; writes 10-step pipeline plan. |
| `scripts/flip-report.ts` | §11.2 step 6 | Paired-grading aggregator: P→F regressions, F→P fixes, pass_rate/duration/tokens. |
| `scripts/shadow-mode.ts` | §11.2 step 7 | Replays proposed skill against historical traces. Diagnostic, never blocks. |
| `scripts/description-optimizer.ts` | §11.2 step 9 | Deterministic heuristic deriving a ≤1024-char description from `should_trigger` evals. |
| `scripts/rollback-walker.ts` | §11.3 | Enumerates `.guild/skill-versions/<slug>/v*/`; emits version table. Read-only. |
| `scripts/trace-summarize.ts` | P5 | Summarizes `.guild/runs/<run-id>/events.ndjson` for reflection. |
| `scripts/agent-team-launcher.ts` | §7.3 | tmux launcher for the opt-in agent-team backend. |

## MCP servers (optional, bundled)

`.mcp.json` wires two local-only MCPs — both stdio, no network:

- `mcp-servers/guild-memory/` — structured read/search/append over `.guild/wiki/`.
  Needed once the wiki crosses ~200 pages for BM25 search; before that,
  `Read`/`Grep` suffice.
- `mcp-servers/guild-telemetry/` — structured trace query over `.guild/runs/`.

Both are optional. Guild runs end-to-end without them.

## See also

- `specialist-roster.md` — the 13 specialists and their skills.
- `context-assembly.md` — the three-layer context contract.
- `wiki-pattern.md` — the knowledge layer.
- `self-evolution.md` — the evolve + rollback pipeline.
- `guild-plan.md §3` / `§4` — the source architecture and repo layout sections.
