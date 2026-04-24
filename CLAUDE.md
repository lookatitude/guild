# Guild — repo orientation

Guild is a Claude Code plugin that ships a team of 13 domain specialists plus a brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision capture, and a self-evolution loop with shadow-mode gating.

**Single source of truth: `guild-plan.md`.** Read it before making design decisions. Do not duplicate it here.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/{core,meta,knowledge,fallback,specialists}/` — 5-tier skill taxonomy (`guild-plan.md §5`).
- `agents/*.md` — 13 shipping specialists (`guild-plan.md §6`). Built by the dev team; not yet populated.
- `commands/*.md` — 7 slash commands (`guild-plan.md §13.1`).
- `hooks/hooks.json` — native Claude Code hooks (`guild-plan.md §13.2`).
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers (`guild-plan.md §13.3`).
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents}/` — authoring scaffolds.
- `docs/phase-gates/` — phase-by-phase integration logs.

## Dev team (`.claude/agents/`)

The plugin is built by 8 dev-team agents, each owning a scoped slice: `plugin-architect`, `skill-author`, `specialist-agent-writer`, `command-builder`, `hook-engineer`, `tooling-engineer`, `docs-writer`, `eval-engineer`. Dispatch through the main session; agents never commit themselves.

## Project-local state

Runtime artifacts live under `.guild/` at the consuming repo's root (never committed by Guild itself). Layout in `guild-plan.md §4`.
