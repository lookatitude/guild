# P7 Audit — Guild v1.0.0 release

Date: 2026-04-24
Result: PASS (v1.0.0 ready for tag)

## Shipped in P7
- scripts/agent-team-launcher.ts — tmux launcher for opt-in agent-team backend + 9 tests
- mcp-servers/guild-memory/ — BM25 wiki search MCP (13 tests)
- mcp-servers/guild-telemetry/ — trace-query MCP (13 tests)
- .mcp.json wired
- docs/architecture, specialist-roster, self-evolution, wiki-pattern, context-assembly + README polish
- Polish fixes: /tmp lock cleanup, fallback language, retention note
- docs/phase-gates/dogfood/ — 16-file simulated E2E dogfood trail
- Version bumped 0.0.1 → 1.0.0

## Review history
- Final v1 review caught 2 blockers: bootstrap banner stale labels (Forthcoming P6 on shipping commands) + MCP dep install not documented. Both fixed in 72a55ba.
- 5 important + 5 nit items tracked as v1.1 targets.

## Guild v1.0.0 — cumulative state on main after merge
- 67 skills (T1=1, T2=13, T3=3, T5=50)
- 13 shipping specialists
- 7 slash commands
- 8 Claude Code hook events wired
- 7 tooling scripts + agent-team-launcher
- 2 optional MCP servers
- 5 user docs + README + single source-of-truth plan
- 8 phase gates closed (P0–P7)
- 165 tests passing (hooks 31 + scripts 76 + tests 32 + 2 MCP × 13)

## v1.1 targets
- Run-id convention unification across launcher/hooks/telemetry
- team.yaml schema reconciliation
- Agent-team launcher orchestrator prompt enrichment (bundle path)
- Dep-ID regex expansion in task-created.ts for markdown-table plans
- Live /guild E2E dogfood against consuming repo
- MCP server deps bundling (optional)
- skills/fallback/ population per §5 policy
