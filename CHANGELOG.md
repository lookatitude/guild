# Changelog

All notable changes to Guild will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from v1.0.0 onward.

## [Unreleased]

### Added

- Release-tagging automation at `.github/workflows/release.yml`. When a
  PR from a `release/v*` branch merges to `main`, the workflow creates
  an annotated tag at the merge commit and opens a GitHub Release with
  the PR body as release notes. Idempotent (skips if the tag already
  exists), shape-checked (refuses tags that do not match
  `vMAJOR.MINOR.PATCH[-prerelease]`).

### Changed

- `release-discipline.md` rule 7 added: every release ships an annotated
  tag + GitHub Release. Pre-v1.4 releases backfilled retroactively
  (v1.1.0 / v1.2.0 / v1.3.0 tags + releases created 2026-04-27).

## [1.3.0] — 2026-04-27

Closed 4 deferred items from `benchmark/FOLLOWUPS.md` + locked 3
genuinely-deferred items behind ADRs with explicit re-entry triggers.
F3 (manifest signing) withdrawn during brainstorm. Drove through the
full Guild lifecycle (brainstorm → team-compose → plan →
context-assemble → execute-plan → review → verify → reflect) with a
4-specialist team.

### Added

- **F2 — `loop --rollback` action.** New `loopRollback()` in
  `benchmark/src/loop.ts` with `--dry-run` (default) and `--confirm`
  (live, shells out to `git revert <plugin_ref_after>`); M13 path
  allowlist on `--candidate-id`; new `"rolled-back"` manifest state.
  Refuses on non-`completed` state. 12 unit tests + 4 CLI tests +
  1 fast-check property test (200 numRuns × 2 properties).
- **F4 — `auth_identity_hash` URL filter on RunsListPage.**
  `?auth=<7-char-prefix>` filters the visible row set client-side.
  Display-only (no `<input>`); preserves the v1.1 forensic-only
  contract. Backend confirmed end-to-end wire (artifact-importer +
  server.ts LIST projection + types). 3 UI tests pinning filter-off /
  filter-on-matching / filter-on-no-matches.
- **F12 — hook-driven reflect for dev-team work (opt-in).**
  `hooks/maybe-reflect.ts` widens to fire on `SubagentStop` under
  three guards (all must hold): `GUILD_ENABLE_DEVTEAM_REFLECT=1`
  operator opt-in (default off), session has accumulated ≥ 3
  `SubagentStop` events, `.guild/spec/<slug>.md` exists. 6 jest tests
  cover every guard combination.
- **ADR-007 — RSS-cap-not-portable + 80%-WARN runtime helper.**
  Accepts that no portable per-process hard RSS cap exists; recommends
  runtime stderr WARN at 80% of operator-declared
  `GUILD_BENCHMARK_MAX_RSS_KB` env var. Backend implemented per ADR-007
  §Decision §1-§7: `installRssWarnSampler()` sampled at 1Hz, fired
  once per run on first crossing, platform-normalised (macOS bytes
  divided by 1024 → KB; Linux + Windows passthrough). 14 unit tests
  pin the env contract, sampling cadence, line format, once-per-run
  latch, platform branching. Re-entry trigger: cgroups becomes
  portable / multi-platform sandbox primitive emerges /
  OOM-induced data-loss incident reported.
- **ADR-005 — Windows process-group signaling design.** Windows
  analogue of ADR-004's POSIX `process.kill(-pid, SIG)`. Pins
  `taskkill /PID <pid> /T /F`. **Design-only — not implemented.**
  Re-entry trigger: a Windows operator surfaces / Windows CI lands /
  a Windows grandchild-leak incident is reported.
- **ADR-008 — interactive-claude-harness for v2.** Designs the
  PTY-driven `claude` invocation (no `--print`, plugin pre-loaded)
  past the `~30/100` ceiling on raw-model runs.
  Coexists with ADR-006 behind `run_kind` (additive, not
  supersession). **Design-only — not implemented in v1.3.**
  Re-entry trigger: v2 release window opens / an operator case
  requires `events.ndjson` / ≥ 2 operators surface the
  partial-scoring complaint in one cycle.
- Supersession callout in `benchmark/plans/p4-learning-loop-architecture.md §6.1`
  referencing the new `loop --rollback` action.

### Removed

- **F8 — `export-website` deferred subcommand.** Spec is no public
  site in v1; static site at `docs/website/` is hand-curated.
  Removed `commandDeferred("export-website", ...)` from `cli.ts`,
  the `export-website` row from help text, the
  `package.json` script. `cli.test.ts` flipped from "deferred" to
  exit 1 + "Unknown command".

### Withdrawn

- **F3 — manifest cryptographic signing.** User explicit instruction
  during brainstorm: "do not do F3 manifest signing, remove it from
  the plans." Removed from v1.3 scope. FOLLOWUPS.md F3 marked
  WITHDRAWN with verbatim user instruction + re-entry condition
  (multi-operator scenarios emerge).

### Verified

- 377 vitest passed / 2 skipped (was 343 v1.2 → +34).
- 37 hooks jest passed (was 31 v1.2 → +6).
- 60 UI vitest passed (was 57 v1.2 → +3).
- Total **474 tests passing** (was 431 v1.2 → **+43 net**).
- Both typechecks clean.
- Live operator smoke (release-discipline rule 1):
  `smoke-noop status=pass wall_clock_ms=5988`, claude replied
  `smoke-ok` under v1.3 default argv (no wrapper).

## [1.2.0] — 2026-04-27

Closed 6 deferred items from v1.1's `benchmark/FOLLOWUPS.md`.

### Added

- **F1 — `loop --abort` action.** `loopAbort()` in
  `benchmark/src/loop.ts` flips manifest state to `"aborted"`,
  removes the lockfile. Refuses on terminal states (`completed` →
  irreversible, `aborted` → idempotent error). Supports `--dry-run`.
  7 unit tests + 3 CLI argv tests.
- **F5 — Q6/Q7 concurrent-lock + atomic-rename integration tests.**
  The two `it.todo` slots in `loop.security.test.ts` deferred since
  P3 are now real integration tests (3 tests).
  `writeManifestAtomic` newly exported for testing.
- **F9 — cross-`run_kind` comparator warning.**
  `Comparison.kind_mix` field counts raw_model vs guild_lifecycle
  runs per side; CLI emits a WARNING line on cross-kind sets.
  3 unit tests pin pure-kind / cross-kind / mixed-within-side.
- **F13 — subprocess-race property test.**
  `tests/runner.race.property.test.ts`: 6 tests pin the deadlock-free
  contract that v1.1 Bug 2's `awaitStreamEndBounded()` satisfies.
  Random commit timings × event kinds via fast-check.
  `awaitStreamEndBounded` + `STREAM_END_TIMEOUT_MS` exported from
  `runner.ts`.
- **G1 — pre-push hook refusing direct push to main.**
  `.githooks/pre-push` mechanically enforces the no-direct-commits-to-main
  rule from v1.1. Bypass via `GUILD_ALLOW_PUSH_MAIN=1` (logs a loud
  warning). One-time setup: `git config core.hooksPath .githooks`.

### Removed

- **F11 — deprecated `run_id` alias from 409 body.** Server emits
  only `current_run_id` on 409 conflict; v1.1's deprecated `run_id`
  alias removed. Test pins absence explicitly.

### Verified

- 343 → 374 benchmark vitest tests passed (+31 net for v1.2).
- 31 → 37 hooks jest tests passed (+6 net for v1.2).
- 57 → 60 UI vitest tests passed (+3 net for v1.2).
- Both typechecks clean.
- Live `smoke-noop status=pass wall_clock_ms=5456`.

## [1.1.0] — 2026-04-27

Live operator smoke against v1.0.1 surfaced 5 real bugs that the
static audit + 357-test suite missed. v1.1 closes all of them, adds
9 polish-round gaps, lands ADR-006 for the claude v2.x argv pivot,
and turns on the continuous-knowledge discipline so cross-session
continuity actually works.

### Added

- **`benchmark/cases/smoke-noop.yaml`** — minimal live-smoke case
  checked into the repo (60s, haiku tier). Pre-tag smoke target.
- **`benchmark/FOLLOWUPS.md`** — single ledger of 13 deferred items
  with deferred-with-reason rationale + owner.
- **`Score.run_kind: "raw_model" | "guild_lifecycle"`** annotation —
  partial scoring on raw-`claude --print` runs is now interpretable.
- **`auth_identity_hash` UI badge** on `RunDetailPage` — 7-char
  prefix display when present (forensic-only contract).
- **`Comparison.skipped_runs[]`** — comparator surfaces unscored
  runs in the comparison artifact + CLI WARNING line.
- **Guild self-evolution layer (off-tree, on-disk).** `.guild/wiki/`
  populated with 9 ADR-lite decisions, 2 standards
  (release-discipline, live-smoke-checklist), 1 recipe
  (run-benchmark-live), 1 reflection (`.guild/reflections/v1.1-fix-pack.md`),
  index.md + log.md. Two new auto-memory entries
  (feedback_release_discipline, feedback_continuous_knowledge).
- **`benchmark/plans/adr-006-runner-prompt-via-stdin.md`** — full
  decision documenting the claude v2.x argv pivot, options scored,
  P3 invariants preserved-via-new-mechanism, verification trail.
- **CLAUDE.md "Continuous knowledge" section** — codifies the
  three-trigger discipline (decision capture in real time, manual
  reflection after major work, user-gated promotion).

### Fixed

- **Bug 1 — `GUILD_BENCHMARK_LIVE` was never read.** Doc-promised
  cost-discipline gate was advisory only; runner now refuses to spawn
  unless the env var is exactly `"1"`. Tests pin gate-unset (rejects),
  gate-`"true"` (rejects — common operator mistake), gate-`"1"`
  (passes), `--dry-run` bypass.
- **Bug 2 — `spawnAndWait` deadlock on fast/empty stdio.**
  `awaitStreamEndBounded()` returns immediately when stream is
  already-ended; otherwise listens for `"end"`/`"close"`/`"error"`
  with a 5s safety timeout. Applied at both await sites
  (post-exit drain + redactor finally).
- **Bug 3 — claude v2.x rejects `--output-format stream-json`
  without `--verbose`.** Dropped from default; operators opt back in
  via `GUILD_BENCHMARK_ARGV_TEMPLATE`.
- **Bug 4 — `--model` never passed to spawned claude.**
  `buildArgv()` reads `model_ref.default` and injects
  `--model <name>` into the default argv. ARGV_TEMPLATE gains
  `${MODEL}` placeholder.
- **Bug 5 — claude v2.x rejects `--prompt-file` / `--workdir`
  (ADR-006).** Default argv pivots to
  `claude --print --add-dir <ws> [--model <name>]` with prompt piped
  via stdin. P3 invariants preserved (prompt never in argv,
  `shell: false`, ADR-003 fresh-fixture clone, ADR-004 process-group
  signaling all unchanged). `stdio` becomes `["pipe", "pipe", "pipe"]`.
- **README §10 stale prose** — updated to reflect v1.1 default
  (`--add-dir`, prompt via stdin, `--model` injected).
- **409 contract mismatch** — server returned `run_id`; UI read
  `current_run_id`. v1.1 emits both (canonical `current_run_id` +
  legacy `run_id` alias for one release; alias stripped in v1.2).
- **Stale `_benchmark-prompt.txt` write** on every run — runner now
  only writes the file when ARGV_TEMPLATE references `${PROMPT_FILE}`.
- **CLAUDE.md "agents not yet populated" stale line** — updated to
  reflect the 14 shipping specialists.

### Changed

- **No-direct-commits-to-main discipline.** v1.1 was originally
  direct-pushed and force-pushed back to enforce the rule
  retroactively. Codified in CLAUDE.md "Branch + PR discipline" and
  `.guild/wiki/standards/release-discipline.md` rule 6.

## [1.0.1] — 2026-04-25

Patch release for the public install path after launch.

### Changed

- **Install instructions now use the Claude CLI form** on the landing page and
  README: `claude plugin marketplace add lookatitude/guild`, followed by
  `claude plugin marketplace update guild`, then
  `claude plugin install guild@guild`.

### Fixed

- **Marketplace manifest validation.** Removed unsupported marketplace/plugin
  metadata keys rejected by the Claude Code plugin schema and added the missing
  marketplace description.
- **Agent and command frontmatter parsing.** Quoted long YAML descriptions
  across bundled agents and commands so Claude Code loads their metadata instead
  of silently dropping malformed frontmatter.
- **Install smoke test.** Verified a clean temporary install can add the Guild
  marketplace, update it, and install `guild@guild` with project scope.

## [1.0.0] — 2026-04-25

First stable v1 release. Drops the `-beta` suffix after four iterations
(beta1 → beta4) of pre-flight fixes, install-validator round-trips, and a
live autonomous end-to-end run.

### Added

- **Project contact email** — `guild@lookatitude.com` recorded in
  `plugin.json.author` and `marketplace.json` (owner + plugin author).
- **End-to-end demo story doc** at `docs/demo/E2E-DEMO-STORY.md` —
  source material for the website demo section: brief, 3-layer
  harness, install-time fixes, 9-stage live run with full receipts.
- **5 forked T4 fallback methodology skills** — `guild:tdd`,
  `guild:systematic-debug`, `guild:worktrees`, `guild:request-review`,
  `guild:finish-branch` under `skills/fallback/`. Each is forked
  from the corresponding `superpowers:*` skill at v5.0.7 (MIT,
  © 2025 Jesse Vincent), with attribution at
  `skills/fallback/<name>/LICENSE-attribution.md` and adapted
  cross-references that point at Guild's own meta + fallback skills.
  Guild now ships self-contained — the superpowers plugin is no
  longer a runtime dependency. Implements the original §5 forking
  intent that v1.0.0-beta1 deferred.
- **Self-audit report** at `docs/audit/2026-04-25.md` — first run
  of the static-analysis checks documented in `commands/guild-audit.md`.
  Verdict: PASS, zero blockers.
- **Landing-page social/SEO assets** — Open Graph + Twitter Card meta
  tags, canonical URL, theme color, and a full favicon/manifest set
  (`og-image.png`, `twitter-card.png`, `apple-touch-icon.png`,
  `favicon.svg`, `favicon-32.png`, `favicon-64.png`, `site.webmanifest`,
  source SVGs) under `docs/website/assets/`.
- **Marketplace listing copy** at `docs/plugin-marketplace-copy.md` —
  plugin description + example use cases for the community-listing
  submission.

### Changed

- **§5 forking policy flipped** from REFERENCE to FORK in
  `guild-plan.md`. Updated `docs/architecture.md` T4 description.
- **Skill count** in README: was 67 (1 + 13 + 3 + 0 + 50), now
  **72** (1 + 13 + 3 + **5** + 50).
- **90 citation rewrites** across 21 files: every `superpowers:*`
  reference (excluding upstream-attribution lines under
  `skills/fallback/*/LICENSE-attribution.md` and SKILL.md frontmatter)
  now points at the Guild equivalent — `guild:tdd`, `guild:plan`,
  `guild:verify-done`, etc.

### Fixed

- **README install instructions.** Namespace was `miguelp/guild` (wrong);
  now `lookatitude/guild`. Added the missing `/plugin marketplace add`
  prerequisite. Updated stale "MCP servers require `npm install`"
  copy — they ship pre-bundled in beta3+.
- **Landing-page GitHub link** repointed `miguelp/guild` → `lookatitude/guild`.

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
  website at `docs/website/` to
  `https://lookatitude.github.io/guild/` on every push to `main` that
  touches `docs/website/`, `docs/assets/`, or `docs/diagrams/`.
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
  in beta1 (Guild cited `superpowers:*` skills directly rather than
  forking). Flipped to FORK in [Unreleased] — see entry above.

### Compatibility

- Requires Claude Code with plugin support.
- Agent-team backend requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  and an available `tmux` binary.
- MCP servers require Node 18+ and a one-time `npm install`.

[Unreleased]: https://github.com/lookatitude/guild/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/lookatitude/guild/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/lookatitude/guild/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/lookatitude/guild/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/lookatitude/guild/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/lookatitude/guild/compare/v1.0.0-beta4...v1.0.0
[1.0.0-beta4]: https://github.com/lookatitude/guild/compare/v1.0.0-beta3...v1.0.0-beta4
[1.0.0-beta3]: https://github.com/lookatitude/guild/compare/v1.0.0-beta2...v1.0.0-beta3
[1.0.0-beta2]: https://github.com/lookatitude/guild/compare/v1.0.0-beta1...v1.0.0-beta2
[1.0.0-beta1]: https://github.com/lookatitude/guild/releases/tag/v1.0.0-beta1
