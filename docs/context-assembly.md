# Context Assembly

Implements `guild-plan.md §9`. The three-layer context contract that gives each
specialist a tight, reproducible, diffable task brief.

Driver: `skills/meta/context-assemble/SKILL.md`, invoked as phase 4 of the
`/guild` lifecycle.

## The rule — three layers, 3k target, 6k cap

A specialist's authoritative task brief is the **union of three layers**. No
project-wide dumps. No sibling-specialist lanes unless the plan declares an
upstream contract via `depends-on:`.

| Layer | Content | Size |
|---|---|---|
| **Universal** | `guild-principles` + `wiki/context/project-overview.md` + `wiki/context/goals.md` | ~400 tokens |
| **Role-dependent** | `wiki/standards/*.md` for the role + 2–4 most-relevant entity pages | ~800–1500 tokens |
| **Task-dependent** | The specialist's lane from the plan + named refs (concepts, decisions, products) + upstream contracts from `depends-on:` tasks + active decisions touching the task domain | ~800–1500 tokens |

- **Target total:** ~3k tokens.
- **Hard cap:** 6k tokens.
- **Overflow policy:** `guild-context-assemble` summarizes the lowest-weighted
  layer (usually task-dependent refs beyond 2 pages) until the bundle fits.

## Role mapping (§9.2)

Which `standards/` pages load per role group:

| Role group | Standards loaded | Typical products loaded |
|---|---|---|
| Engineering (architect, researcher, backend, devops, qa, mobile, security) | `standards/coding-standards.md` | `products/<component>.md` when explicitly named |
| Writing (copywriter, technical-writer) | `standards/writing-voice.md` + `standards/branding.md` | `products/<feature>.md` if user-facing |
| Social / SEO (social-media, seo) | `standards/writing-voice.md` + `standards/branding.md` + `standards/seo-rules.md` | `products/<feature>.md` if user-facing |
| Commercial (marketing, sales) | `standards/branding.md` + `standards/pricing-policy.md` | `products/*.md` for any referenced product |

Missing `standards/` files are not an error — the bundle assembler skips them
silently and logs the omission to `.guild/runs/<run-id>/context-warnings.md`.

## Output path

`guild-context-assemble` writes **one file per specialist task** before the
Agent dispatch (or tmux teammate spawn):

```
.guild/context/<run-id>/<specialist>-<task-id>.md
```

The invocation passes this file path as the primary task brief. The specialist
then works in its worktree with that context plus the T1/T5 skills listed in
its `agents/<name>.md` frontmatter.

## Ambient-context caveat (§9.1)

The bundle is a **context contract, not a hard isolation boundary.**

Claude Code will still load, independent of Guild's bundle:

- the consuming repo's `CLAUDE.md` (and user-global `~/.claude/CLAUDE.md`)
- plugin skills declared in `.claude-plugin/plugin.json`
- MCP servers declared in `.mcp.json`
- Claude Code auto-memory if enabled

Guild therefore instructs every specialist to **privilege the bundle over
ambient context.** The specialist may cite ambient information but must treat
the bundle as the authoritative task brief. When ambient context contradicts
the bundle, the bundle wins and the contradiction is surfaced in the handoff
receipt.

There is a further wrinkle for the agent-team backend (`guild-plan.md §9.3`):
when a subagent definition is used as an agent-team teammate, the definition's
`skills` and `mcpServers` frontmatter are **not applied the same way** —
teammates load skills and MCPs from the normal project/user/plugin environment.
The tmux launcher (`scripts/agent-team-launcher.ts`) therefore restates the
bundle path and any required skill playbooks explicitly in the spawn prompt.

## Why this matters (§9.4)

- **Short authoritative context** → specialist stays on task, doesn't drift.
- **Reproducible** → rerunning the same task produces the same bundle; evals
  are meaningful.
- **Debuggable** → when an output is wrong, you can diff the context bundle
  against a prior run.
- **Cheap** → no redundant project-wide prose in every specialist invocation.

## See also

- `guild-plan.md §9` — full rationale with size budgets.
- `skills/meta/context-assemble/SKILL.md` — the live assembler.
- `architecture.md` — where context assembly sits in the lifecycle.
- `wiki-pattern.md` — the categories the assembler reads from.
