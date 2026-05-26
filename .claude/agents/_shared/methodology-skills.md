# Guild Methodology Skills

Guild's dev-team agents invoke first-class **Guild-native** methodology skills before acting. These skills were re-authored clean-room as Guild's own (own-it, zero external dependency) per the v2.x full-internalization decision (`docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md` D4) — the former "fallback fork / REFERENCE-superpowers" tier framing in `guild-plan.md §5` is **superseded**. Each agent invokes the skills below via the `Skill` tool before acting.

| Agent | Required Guild skills |
|---|---|
| plugin-architect | `guild:verify-done`, `guild:review`, `guild:finish-branch` |
| skill-author | `guild:evolve-skill` (mandatory per skill), `guild:tdd`, `guild:verify-done` |
| specialist-agent-writer | `guild:evolve-skill`, `guild:verify-done` |
| command-builder | `guild:tdd`, `guild:verify-done` |
| hook-engineer | `guild:tdd`, `guild:systematic-debug`, `guild:verify-done` |
| tooling-engineer | `guild:tdd`, `guild:systematic-debug`, `guild:verify-done` |
| docs-writer | `guild:verify-done` |
| eval-engineer | `guild:tdd`, `guild:verify-done` |

## Invocation rule

At the start of any task, the agent invokes its listed Guild skills via the `Skill` tool — not by reading their files. If a listed skill is unavailable in the current environment, the agent must stop and report the gap in its handoff `evidence:` field, not silently skip it.

## Why this list

- `guild:verify-done` is universal: evidence before claims on every close-out. Per ADR D4 it **absorbs the folded `verify-claim`** behavior — there is no separate claim-verification skill.
- `guild:writing-skills` is mandatory for anyone authoring Markdown-with-YAML-frontmatter content (skills, agent defs) — the same discipline applies to both.
- `guild:tdd` covers the code-producing agents (hook, tooling, command, eval) and the skill-author (whose "tests" are `evals.json`).
- `guild:systematic-debug` is for the two agents that write executable code (hooks, tooling scripts).
- `guild:review` (which per ADR D4 **absorbs the folded `request-review` + `receive-review`** behavior) and `guild:finish-branch` belong to plugin-architect, which cuts phase gates and closes branches.
