# Contributing to Guild

Thanks for taking an interest in Guild. This document is a short, practical
guide to getting set up, understanding the repo layout, and submitting changes.

## Development setup

1. **Clone + install tooling.** Most of Guild is plain Markdown and YAML, but
   the hooks, scripts, and MCP servers run on Node. You'll need:
   - Node 18+ (tested on 20.x) — `brew install node` on macOS.
   - `tmux` (only if you plan to exercise the agent-team launcher).
   - `python3` (already present on macOS; Linux may need `apt install python3`).

2. **Install each sub-project's deps.** Guild's Node sub-projects are
   independent; each has its own `package.json` and `node_modules`:

   ```bash
   (cd hooks && npm install)
   (cd hooks/agent-team && npm install)
   (cd scripts && npm install)
   (cd tests && npm install)
   (cd mcp-servers/guild-memory && npm install)
   (cd mcp-servers/guild-telemetry && npm install)
   ```

3. **Run the test suites.** Five independent Jest projects:

   ```bash
   (cd hooks && npx jest --no-coverage)
   (cd scripts && npx jest --no-coverage)
   (cd tests && npx jest --no-coverage)
   (cd mcp-servers/guild-memory && npx jest --no-coverage)
   (cd mcp-servers/guild-telemetry && npx jest --no-coverage)
   ```

   All tests should pass on a clean checkout.

## Repo layout

- `.claude-plugin/` — plugin + marketplace manifests.
- `skills/` — 106 skills across six tiers (`core`, `meta`, `knowledge`,
  `specialists`, `guild-operations`, `guild-quality`).
- `agents/` — the 2 machinery agents (advisor, developer). - `templates/specialists/` — the 15 domain specialist type templates minted into projects on demand.
- `commands/` — the v2 flat-token command files (`/guild:<verb>`).
- `hooks/` — Claude Code hook scripts + manifest.
- `scripts/` — tooling (evolve loop, flip report, shadow mode,
  description optimizer, rollback walker, trace summarizer,
  agent-team launcher, docs-hygiene scanner, dot-guild migrator).
- `mcp-servers/` — two optional stdio MCP servers.
- `tests/` — cross-cutting harness tests (evolve + shadow).
- `docs/` — user-facing docs, diagrams, and release notes.
- `.claude/agents/` — the **dev-team** of 10 Claude Code subagent
  definitions that built Guild itself (not the shipping specialists).
  Separate from `agents/` at the repo root.

## How to make a change

Guild was built phase-by-phase (P0–P7) using superpowers-style
brainstorm → plan → execute → review gates. Contributions should follow
the same spirit:

1. **Read the relevant docs at `https://guildstack.dev/docs` first** and link to
   the relevant page in your PR description.
2. **Keep changes surgical.** Match the existing file's style (pushy
   descriptions, structured `##` sections, YAML frontmatter where the
   pattern calls for it).
3. **Add tests** for hooks, scripts, and MCP-server changes. Skills
   and agent files use `evals.json` fixtures.
4. **Run all 5 test suites** before opening a PR.
5. **Target `next`, not `main`.** All feature/fix PRs go to the `next`
   integration branch (`gh pr create --base next`) — `main` is the stable
   release channel and only accepts `release/vX.Y.Z` PRs (enforced by the
   `branch-policy` CI gate; full rules in
   `.guild/wiki/standards/release-discipline.md`).
6. **Explain the "why" in the commit message**, not the "what"
   (the diff shows the what).

### Adding a new skill

- Author under the correct tier: `skills/{core,meta,knowledge,specialists,guild-operations,guild-quality}/<slug>/`.
- Required files: `SKILL.md` + `evals.json`.
- `SKILL.md` frontmatter: `name`, `description` (≤ 1024 chars, with
  `TRIGGER` and `DO NOT TRIGGER` clauses), `when_to_use`, and `type`
  matching the tier.
- `evals.json`: ≥ 3 `should_trigger` + ≥ 3 `should_not_trigger` cases.
- Add a one-line comment at the top of the body describing which feature
  area the skill implements.

### Adding a new specialist

Use the `guild:create-specialist` workflow. The 7-step flow
includes adjacent-boundary scans — new specialists must not silently
steal triggers from existing ones.

### Modifying a hook or script

- TypeScript, direct-execution via `tsx` (no build step).
- Log to stderr only — stdout is often consumed by Claude Code.
- Never write to `.guild/wiki/` (that's skill territory; use `guild:wiki-ingest` / `guild:decisions`).
- Always add a Jest test.

## Commit conventions

- First line: short imperative summary (≤ 72 chars).
- Blank line.
- Body: the "why", wrapped at 72.
- Reference the relevant `https://guildstack.dev/docs` page where relevant.

## Pre-merge review

Guild ships with a disciplined review discipline: significant changes
(new skill, new specialist, hook protocol change, MCP server change)
should pass a **code-reviewer** pass before merge. In a consuming
Claude Code session you can use `/ultrareview <PR#>` — locally,
read your diff aloud and ask whether each change would survive
the review and quality gate (see `https://guildstack.dev/docs`).

## Release flow

- Branches are channels: `main` = stable (always green, always releasable),
  `next` = beta/integration (all merged PRs collect and get tested here).
- Releases are cut **from `next`** as a `release/vX.Y.Z` branch → PR into
  `main` → on merge, CI tags and publishes the GitHub Release automatically
  (PR body = release notes). Then `main` is merged back into `next`.
- Tags are `vMAJOR.MINOR.PATCH` (SemVer) with optional `-beta<N>`
  pre-release suffix.
- Update `CHANGELOG.md` as part of the release PR — generate the section with
  `npx tsx scripts/release-changelog.ts --version vX.Y.Z --write` (groups the
  PRs merged since the last tag; `--notes` seeds the PR body), then polish.
- Bump `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`
  `version` to match the tag.
- Full ruleset: `.guild/wiki/standards/release-discipline.md`.

## Reporting issues

- Use GitHub Issues on `lookatitude/guild`.
- Include: Claude Code version, Node version, the triggering prompt or
  command, and the relevant slice of `.guild/runs/<run-id>/events.ndjson`
  if a hook or telemetry issue.

## Security

See [SECURITY.md](SECURITY.md) for the trust model and the process
for reporting security-relevant issues. Short version: use
`/guild audit` before installing a Guild fork; don't open PRs that
add network access to meta-skills or non-researcher specialists
without an explicit `§15.1 #12` discussion.
