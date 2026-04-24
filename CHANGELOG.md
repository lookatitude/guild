# Changelog

All notable changes to Guild will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from v1.0.0 onward.

## [Unreleased]

## [1.0.0-beta2] — 2026-04-24

### Fixed

- **Unified run-id convention across all 6 writers.** `capture-telemetry.ts`
  and `maybe-reflect.ts` now prefix `session_id` with `run-` to match the
  agent-team hooks. `scripts/agent-team-launcher.ts` mints
  `run-<iso-timestamp>` and exports it as `GUILD_RUN_ID` into each tmux
  pane so hooks inside the spawned Claude Code instances converge on the
  launcher's session-manifest path.
- **`team.yaml` schema alignment.** The dogfood `team.yaml` under
  `docs/phase-gates/dogfood/team/` now matches the canonical shape
  documented in `skills/meta/team-compose/SKILL.md` and parsed by
  `scripts/agent-team-launcher.ts` (`- name:`, `depends-on:`,
  `implied-by:`). The launcher rejected the earlier out-of-schema file.
- **Agent-team launcher prompts enriched.** Orchestrator pane now
  receives spec / team / plan / context / handoffs paths explicitly.
  Teammate panes receive their context-bundle path, handoff-receipt
  path, and the §9.1 ambient-context caveat. Addresses the
  docs-vs-code gap flagged in the v1 final review (§15.2 risk mitigation).

## [1.0.0-beta1] — 2026-04-24

First public beta. Structurally complete across all 7 plan phases.

### Added

- **13 shipping specialist subagents** across engineering
  (`architect`, `backend`, `researcher`, `devops`, `qa`, `mobile`,
  `security`), content (`copywriter`, `technical-writer`,
  `social-media`, `seo`), and commercial (`marketing`, `sales`)
  groups — each with pushy `TRIGGER` / `DO NOT TRIGGER` clauses and
  scoped T5 skills.
- **67 skills** total: 1 T1 core (`guild-principles`), 13 T2 meta
  (brainstorm, team-compose, plan, context-assemble, execute-plan,
  review, verify-done, decisions, reflect, evolve-skill,
  create-specialist, rollback-skill, audit), 3 T3 knowledge
  (wiki-ingest, wiki-query, wiki-lint), 50 T5 specialist skills
  (2–5 per specialist).
- **7 slash commands** — `/guild`, `/guild:team`,
  `/guild:wiki`, `/guild:evolve`, `/guild:rollback`, `/guild:stats`,
  `/guild:audit`.
- **8 Claude Code hook events wired** — `SessionStart`,
  `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `Stop`,
  `TaskCreated`, `TaskCompleted`, `TeammateIdle`.
- **6 tooling scripts** — `scripts/trace-summarize.ts`,
  `evolve-loop.ts`, `flip-report.ts`, `shadow-mode.ts`,
  `description-optimizer.ts`, `rollback-walker.ts`.
- **Agent-team tmux launcher** — `scripts/agent-team-launcher.ts`
  for the opt-in peer-to-peer backend (§7.3). Safety-gated against
  nested tmux, session collision, and wrong backend type.
- **2 optional stdio MCP servers** — `mcp-servers/guild-memory/`
  (BM25 wiki search for 200+ pages) and
  `mcp-servers/guild-telemetry/` (trace query over `.guild/runs/`).
- **5 user-facing docs** under `docs/` plus README and
  `guild-plan.md` as the single source of truth.
- **165 tests** across 5 suites (hooks 31 + scripts 76 + tests 32 +
  guild-memory 13 + guild-telemetry 13).
- **8 phase gates** (P0–P7) with audit receipts under
  `docs/phase-gates/`.

### Known limitations

- A live `/guild` end-to-end run against a real consuming repo
  has not been performed. Contract-level dogfood trail lives under
  `docs/phase-gates/dogfood/`.
- MCP servers require a one-time `npm install` per server
  (documented in README and bootstrap banner).
- Windows support is untested; macOS + Linux expected to work.
- `skills/fallback/` is intentionally empty per §5 REFERENCE policy
  (Guild cites `superpowers:*` skills directly rather than forking).

### Compatibility

- Requires Claude Code with plugin support.
- Agent-team backend requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  and an available `tmux` binary.
- MCP servers require Node 18+ and a one-time `npm install`.

[Unreleased]: https://github.com/lookatitude/guild/compare/v1.0.0-beta2...HEAD
[1.0.0-beta2]: https://github.com/lookatitude/guild/compare/v1.0.0-beta1...v1.0.0-beta2
[1.0.0-beta1]: https://github.com/lookatitude/guild/releases/tag/v1.0.0-beta1
