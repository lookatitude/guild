# Superpowers Skill Mapping

Dev agents dogfood the same superpowers methodology Guild Tier-4 REFERENCE'es (see `guild-plan.md §5`). Each agent invokes the skills below via the `Skill` tool before acting.

| Agent | Required superpowers skills |
|---|---|
| plugin-architect | `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch` |
| skill-author | `superpowers:writing-skills` (mandatory per skill), `superpowers:test-driven-development`, `superpowers:verification-before-completion` |
| specialist-agent-writer | `superpowers:writing-skills`, `superpowers:verification-before-completion` |
| command-builder | `superpowers:test-driven-development`, `superpowers:verification-before-completion` |
| hook-engineer | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion` |
| tooling-engineer | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion` |
| docs-writer | `superpowers:verification-before-completion` |
| eval-engineer | `superpowers:test-driven-development`, `superpowers:verification-before-completion` |

## Invocation rule

At the start of any task, the agent invokes its listed superpowers skills via the `Skill` tool — not by reading their files. If a listed skill is unavailable in the current environment, the agent must stop and report the gap in its handoff `evidence:` field, not silently skip it.

## Why this list

- `verification-before-completion` is universal: evidence before claims on every close-out.
- `writing-skills` is mandatory for anyone authoring Markdown-with-YAML-frontmatter content (skills, agent defs) — same discipline applies to both.
- `test-driven-development` covers code-producing agents (hook, tooling, command, eval) and the skill-author (whose "tests" are `evals.json`).
- `systematic-debugging` is for the two agents that write executable code (hooks, tooling scripts).
- `requesting-code-review` + `finishing-a-development-branch` belong to plugin-architect, which cuts phase gates and closes branches.