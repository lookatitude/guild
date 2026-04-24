# Superpowers Skill Mapping

Dev agents dogfood the same superpowers methodology Guild Tier-4 REFERENCE'es (see `guild-plan.md §5`). Each agent invokes the skills below via the `Skill` tool before acting.

| Agent | Required superpowers skills |
|---|---|
| plugin-architect | `guild:verify-done`, `guild:request-review`, `guild:finish-branch` |
| skill-author | `guild:evolve-skill` (mandatory per skill), `guild:tdd`, `guild:verify-done` |
| specialist-agent-writer | `guild:evolve-skill`, `guild:verify-done` |
| command-builder | `guild:tdd`, `guild:verify-done` |
| hook-engineer | `guild:tdd`, `guild:systematic-debug`, `guild:verify-done` |
| tooling-engineer | `guild:tdd`, `guild:systematic-debug`, `guild:verify-done` |
| docs-writer | `guild:verify-done` |
| eval-engineer | `guild:tdd`, `guild:verify-done` |

## Invocation rule

At the start of any task, the agent invokes its listed superpowers skills via the `Skill` tool — not by reading their files. If a listed skill is unavailable in the current environment, the agent must stop and report the gap in its handoff `evidence:` field, not silently skip it.

## Why this list

- `verification-before-completion` is universal: evidence before claims on every close-out.
- `writing-skills` is mandatory for anyone authoring Markdown-with-YAML-frontmatter content (skills, agent defs) — same discipline applies to both.
- `test-driven-development` covers code-producing agents (hook, tooling, command, eval) and the skill-author (whose "tests" are `evals.json`).
- `systematic-debugging` is for the two agents that write executable code (hooks, tooling scripts).
- `requesting-code-review` + `finishing-a-development-branch` belong to plugin-architect, which cuts phase gates and closes branches.