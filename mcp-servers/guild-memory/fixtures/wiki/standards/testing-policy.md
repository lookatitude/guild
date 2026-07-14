---
type: standard
owner: plugin-engineer
confidence: high
source_refs:
  - .guild/raw/2026-03-18-testing-summit.md
created_at: 2026-04-05
updated: 2026-04-05
expires_at: null
supersedes: null
sensitivity: internal
---

# Testing policy

Every script under scripts/ ships with a Jest test file under
scripts/__tests__/ that pins deterministic fixtures and asserts on exit codes,
stdout, stderr, and file artifacts. MCP servers follow the same pattern under
mcp-servers/name/__tests__/. Hooks under hooks/__tests__/ verify both the happy
path and edge failures without mutating live project state.
