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

   All 165 tests should pass on a clean checkout.

## Repo layout

- `guild-plan.md` — **single source of truth**. Every skill, agent,
  command, hook, script, and doc cites it. If you're adding behavior that
  isn't in §1–§16, open a discussion first.
- `.claude-plugin/` — plugin + marketplace manifests.
- `skills/` — 67 skills in five tiers (`core`, `meta`, `knowledge`,
  `fallback`, `specialists`).
- `agents/` — the 13 shipping specialist subagent definitions.
- `commands/` — the 7 slash command files.
- `hooks/` — Claude Code hook scripts + manifest.
- `scripts/` — tooling (evolve loop, flip report, shadow mode,
  description optimizer, rollback walker, trace summarizer,
  agent-team launcher).
- `mcp-servers/` — two optional stdio MCP servers.
- `tests/` — cross-cutting harness tests (evolve + shadow).
- `docs/` — user-facing docs + phase-gate history + diagrams.
- `.claude/agents/` — the **dev-team** of 8 Claude Code subagent
  definitions that built Guild itself (not the shipping specialists).
  Separate from `agents/` at the repo root.

## How to make a change

Guild was built phase-by-phase (P0–P7) using superpowers-style
brainstorm → plan → execute → review gates. Contributions should follow
the same spirit:

1. **Read the relevant `guild-plan.md` section first** and link to it
   in your PR description.
2. **Keep changes surgical.** Match the existing file's style (pushy
   descriptions, structured `##` sections, YAML frontmatter where the
   pattern calls for it).
3. **Add tests** for hooks, scripts, and MCP-server changes. Skills
   and agent files use `evals.json` fixtures.
4. **Run all 5 test suites** before opening a PR.
5. **Explain the "why" in the commit message**, not the "what"
   (the diff shows the what).

### Adding a new skill

- Author under the correct tier: `skills/{core,meta,knowledge,fallback,specialists}/<slug>/`.
- Required files: `SKILL.md` + `evals.json`.
- `SKILL.md` frontmatter: `name`, `description` (≤ 1024 chars, with
  `TRIGGER` and `DO NOT TRIGGER` clauses), `when_to_use`, and `type`
  matching the tier.
- `evals.json`: ≥ 3 `should_trigger` + ≥ 3 `should_not_trigger` cases.
- Cite the `guild-plan.md §N` section the skill implements at the top
  of the body.

### Adding a new specialist

Use the `guild:create-specialist` workflow (§12). The 7-step flow
includes adjacent-boundary scans — new specialists must not silently
steal triggers from existing ones.

### Modifying a hook or script

- TypeScript, direct-execution via `tsx` (no build step).
- Log to stderr only — stdout is often consumed by Claude Code.
- Never write to `.guild/wiki/` (that's skill territory; see §10.5.1).
- Always add a Jest test.

## Commit conventions

- First line: short imperative summary (≤ 72 chars).
- Blank line.
- Body: the "why", wrapped at 72.
- Reference `guild-plan.md §N` anchors where relevant.

## Pre-merge review

Guild ships with a disciplined review discipline: significant changes
(new skill, new specialist, hook protocol change, MCP server change)
should pass a **code-reviewer** pass before merge. In a consuming
Claude Code session you can use `/ultrareview <PR#>` — locally,
read your diff aloud and ask whether each change would survive
[the v1 final review](docs/phase-gates/P7.md) flow.

## Release flow

- `main` is always green.
- Tags are `vMAJOR.MINOR.PATCH` (SemVer) with optional `-beta<N>`
  pre-release suffix.
- Update `CHANGELOG.md` as part of the release PR.
- Bump `.claude-plugin/plugin.json` `version` to match the tag.

## Reporting issues

- Use GitHub Issues on `lookatitude/guild`.
- Include: Claude Code version, Node version, the triggering prompt or
  command, and the relevant slice of `.guild/runs/<run-id>/events.ndjson`
  if a hook or telemetry issue.

## Security

See [SECURITY.md](SECURITY.md) for the trust model and the process
for reporting security-relevant issues. Short version: use
`/guild:audit` before installing a Guild fork; don't open PRs that
add network access to meta-skills or non-researcher specialists
without an explicit `§15.1 #12` discussion.
