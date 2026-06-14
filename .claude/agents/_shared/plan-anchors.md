# Plan Anchor Index

Each dev agent must read and apply the design contracts for its scope before starting work.
These contracts are captured in the dev-team agents' own bodies and in the skills they invoke;
the authoritative public architecture and design documentation lives at **https://guildstack.dev/docs**.

| Agent | Primary knowledge areas | Secondary areas |
|---|---|---|
| plugin-architect | Architecture (four layers; Claude Code primitive mapping), repo layout, command registration | Roadmap phase gates, gaps/risks surfaced by integration |
| skill-author | Skill taxonomy (T1 core, T2 meta, T3 knowledge, T5 specialists), wiki-page frontmatter schema, self-evolution pipeline | Karpathy principles (for core skill), per-group principle adaptations (for specialist skills) |
| specialist-agent-writer | Specialist roster (17 shipping agents, group assignments), specialist creation workflow | Per-group principle adaptations, cross-group trigger-collision risk |
| command-builder | Slash-command table (which skills each command dispatches), team-composition wiring | Evolution pipeline wiring (`/guild:evolve`, `/guild:rollback`), wiki ops wiring |
| hook-engineer | Authoritative hook list (`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `Stop`, agent-team hooks) | Task lifecycle context (what hooks observe at each phase), how `maybe-reflect.ts` feeds the evolve pipeline |
| tooling-engineer | Evolve pipeline steps (eval loop, paired-subagent dispatch, flip report, benchmark + flip detection, promotion gate), specialist creation workflow scripts, optional MCP servers scope | Wiki scale / guild-memory trigger point, memory write path |
| docs-writer | Architecture (canonical: `https://guildstack.dev/docs/architecture`), specialist roster (canonical: `https://guildstack.dev/docs/specialist-roster`), context assembly, knowledge layer, self-evolution | Roadmap phase being documented, README TL;DR shape |
| eval-engineer | Evolve pipeline (paired-subagent dispatch, grader output, flip reports, description optimizer), risks to catch (trigger collisions, decision noise, overfit evals, stop-hook false positives) | Tier structure (eval organization per tier), specialist creation boundary gates |

## Audit rule

When the plugin architecture changes significantly (command surface, specialist roster, hook list), re-read the relevant agent bodies and the Guild docs site at `https://guildstack.dev/docs`. Any agent whose scope moved must be updated before it runs again.
