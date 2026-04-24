# Plan Anchor Index

Each dev agent must read these `guild-plan.md` sections before starting work. Quote anchors; do not paraphrase.

| Agent | Primary anchors | Secondary anchors |
|---|---|---|
| plugin-architect | §3 (architecture), §4 (repo layout), §13.1 (commands registration) | §14 (roadmap phase gates), §15 (gaps/risks) |
| skill-author | §5 (skill taxonomy), §10.1.1 (wiki page frontmatter), §11 (self-evolution pipeline) | §2 (Karpathy principles — for core skill), §6.4 (per-group principle adaptations — for specialist skills) |
| specialist-agent-writer | §6 (specialist roster), §12 (specialist creation) | §6.4 (principle adaptations), §15.2 (boundary-collision risk) |
| command-builder | §13.1 (slash commands) | §7 (team composition — /guild:team), §11 (evolution — /guild:evolve, /guild:rollback) |
| hook-engineer | §13.2 (hooks) | §8 (task lifecycle — what hooks observe), §11 (evolution — what telemetry feeds) |
| tooling-engineer | §11.2 (evolve pipeline steps), §12 (create-specialist), §13.3 (MCP servers) | §10.5 (wiki scale — guild-memory trigger), §10.5.1 (memory write path) |
| docs-writer | §3 (architecture), §6 (specialists), §9 (context assembly), §10 (knowledge layer), §11 (evolution) | §14 (roadmap — what ships in which phase), §16 (TL;DR for README polish) |
| eval-engineer | §11.2 (eval loop + flip reports), §15.2 (risks — trigger collisions, decision noise, overfit evals) | §5 (taxonomy — eval structure per tier), §12 (boundary gates) |

## Audit rule

When `guild-plan.md` version bumps (check first line: `**Status:** ...`), re-read this index and every agent file it references. Any agent whose anchors moved must be updated before it runs again.