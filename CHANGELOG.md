# Changelog

All notable changes to Guild will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from v1.0.0 onward.

## [Unreleased]

### Added

- **Project contact email** — `guild@lookatitude.com` recorded in
  `plugin.json.author` and `marketplace.json` (owner + plugin author).
- **End-to-end demo story doc** at `docs/demo/E2E-DEMO-STORY.md` —
  source material for the landing-page demo section: brief, 3-layer
  harness, install-time fixes, 9-stage live run with full receipts.

### Fixed

- **README install instructions.** Namespace was `miguelp/guild` (wrong);
  now `lookatitude/guild`. Added the missing `/plugin marketplace add`
  prerequisite. Updated stale "MCP servers require `npm install`"
  copy — they ship pre-bundled in beta3+.

## [1.0.0-beta4] — 2026-04-24

### Fixed

- **Hook + MCP path resolution.** Relative paths in `hooks/hooks.json`
  and `.mcp.json` were being resolved against the user's cwd, not the
  plugin root, causing `bash: hooks/check-skill-coverage.sh: No such
  file or directory` and `Cannot find module
  '/<user-cwd>/hooks/maybe-reflect.ts'` on first launch. Every hook
  command and MCP arg now prefixes `${CLAUDE_PLUGIN_ROOT}` (Claude Code
  substitutes at spawn time).
- **Hook scripts bundled.** All 5 TypeScript hooks now ship as
  self-contained CJS bundles under `hooks/dist/` and
  `hooks/agent-team/dist/` (built with esbuild, target `node18`). They
  run under plain `node` — no `tsx` fetch, no npm-registry hit, no
  runtime dep resolution on first session.
- **Bootstrap banner copy.** `hooks/bootstrap.sh` no longer tells users
  to `npm install` the MCP servers; they ship pre-bundled.

### Validated

- **Live autonomous E2E.** `claude --plugin-dir … --allow-dangerously-skip-permissions
  -p <brief>` against the URL-shortener brief: all 9 lifecycle stages
  green (brainstorm → team-compose → plan → context-assemble →
  execute-plan → review → verify-done → reflect), `npm test` 8/8 pass,
  live `curl` against booted server returns 201/302/401/200 as
  designed. Reflection stage proposed a real `guild:plan` improvement
  (architect-design vs deliverables-list silent drift).

## [1.0.0-beta3] — 2026-04-24

### Added

- **GitHub Pages workflow** — `.github/workflows/pages.yml` deploys the
  landing page at `docs/landing-page/` to
  `https://lookatitude.github.io/guild/` on every push to `main` that
  touches `docs/landing-page/`, `docs/assets/`, or `docs/diagrams/`.
  Landing-page asset refs flattened from `../assets/` / `../diagrams/`
  to `assets/` / `diagrams/` so the deploy-time staging dir resolves
  them correctly.
- **Plugin homepage bumped** from `github.com/lookatitude/guild` to
  `https://lookatitude.github.io/guild/` in `plugin.json`.
- **Pre-flight test harness** at `guild-test-urlshortener/harness/run-tests.sh`
  (separate workspace, symlinks `.claude/plugins/guild` → the Guild repo).
  14 checks across 3 layers: plugin manifest resolution, hook-script smoke,
  MCP-server JSON-RPC handshake. Full green on first run.
- **E2E test report** at `docs/phase-gates/E2E-TEST-REPORT.md` — what the
  harness covers, what it doesn't (live `/guild` dispatch still requires
  a user-initiated Claude Code session), how to reproduce.

### Fixed

Validator + loader bugs surfaced by a real `/plugin install`:

- **`plugin.json.repository` and `.bugs`.** Validator rejects object
  shapes (`{type, url}`); both flattened to plain URL strings.
- **`hooks/hooks.json` shape.** Validator expects all hook events
  wrapped under a top-level `"hooks":` key; was previously flat.
- **`plugin.json.hooks` + `.mcpServers` redundancy.** Plugin loader
  auto-discovers `hooks/hooks.json` and `.mcp.json`; explicit refs in
  `plugin.json` triggered duplicate-load errors. Both fields removed.
- **MCP servers bundled with esbuild.** `mcp-servers/{guild-memory,guild-telemetry}/dist/index.js`
  ships as self-contained CJS. First run no longer triggers `npx -y tsx`
  (which exceeded the MCP startup timeout fetching `tsx` over the network).

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

[Unreleased]: https://github.com/lookatitude/guild/compare/v1.0.0-beta4...HEAD
[1.0.0-beta4]: https://github.com/lookatitude/guild/compare/v1.0.0-beta3...v1.0.0-beta4
[1.0.0-beta3]: https://github.com/lookatitude/guild/compare/v1.0.0-beta2...v1.0.0-beta3
[1.0.0-beta2]: https://github.com/lookatitude/guild/compare/v1.0.0-beta1...v1.0.0-beta2
[1.0.0-beta1]: https://github.com/lookatitude/guild/releases/tag/v1.0.0-beta1
