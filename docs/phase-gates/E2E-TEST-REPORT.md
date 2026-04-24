# Guild v1 end-to-end test report

**Date:** 2026-04-24
**Against:** Guild main at commit `75cc412` (tag `v1.0.0-beta2`)
**Test workspace:** `/Users/miguelp/Projects/guild-test-urlshortener/` (sibling directory, symlinks the plugin at `.claude/plugins/guild → ../guild`)
**Brief:** "Build a URL-shortener microservice: HTTP API, SQLite, blocklist, admin endpoint, property-based tests, Markdown API docs, landing-page hero copy." Full brief at `guild-test-urlshortener/BRIEF.md`.

## Scope

This is the **structural + smoke test** we can run without launching a new Claude Code session. Three layers:

| Layer | What it verifies | How |
|---|---|---|
| **L1 Structural** | The plugin manifest resolves. Every registered command, agent, and skill file actually exists on disk. `hooks.json` refers to real scripts. Both MCP servers have `package.json` + `src/index.ts`. `.mcp.json` registers both. | Python JSON parse + `os.path.isfile` checks. |
| **L2 Hook smoke** | Each of 5 hook scripts runs correctly against a realistic stdin payload, produces the documented side effect, and exits 0. | Pipe fixture payloads via stdin; assert on `events.ndjson` lines, `/tmp` lock behavior, and banner output. |
| **L3 MCP smoke** | Both MCP stdio servers start, complete the JSON-RPC `initialize` handshake, and list their declared tools via `tools/list`. | Pipe a minimal JSON-RPC request stream; `grep` for the expected tool names in the response. |

## What this **does not** verify

- **Live `/guild` invocation.** Requires a real Claude Code session dispatching real Agent calls. Can't be done from inside a subagent.
- **Skills activating via their TRIGGER phrasings.** Claude Code's trigger-matching happens at session load time; the harness validates skill files exist and parse, not that they fire.
- **Agent dispatch with forward-declared T5 skills.** The specialist agents list T5 skills in their `skills:` frontmatter. The files exist; whether Claude Code's loader resolves the reference cleanly at dispatch time is a live-session question.
- **Cross-specialist handoff flow.** The 9-stage contract chain (spec → team → plan → context → handoffs → review → verify → reflect) is contract-verified in `docs/phase-gates/dogfood/` but has never been executed end-to-end.

The harness's role is to catch **pre-flight** issues — things that would break before `/guild` even runs — so the first live session doesn't waste user time on trivial bugs.

## Results — 14/14 green

```
=== L1: Structural ===
  ✓ plugin.json parses + required fields present
  ✓ every command registered in plugin.json resolves
  ✓ every agent registered in plugin.json resolves
  ✓ every skill dir has SKILL.md + evals.json
  ✓ hooks.json references scripts that exist
  ✓ both MCP servers have package.json + src/index.ts
  ✓ .mcp.json registers both servers

=== L2: Hook smoke ===
  ✓ capture-telemetry: appends event to events.ndjson on PostToolUse
  ✓ capture-telemetry: handles UserPromptSubmit + writes prompt field
  ✓ maybe-reflect: gate correctly rejects non-task session
  ✓ bootstrap.sh: prints banner with version from plugin.json
  ✓ check-skill-coverage.sh: nudges once per session (lock works)

=== L3: MCP smoke ===
  ✓ guild-memory: handshake + tools/list lists wiki_search wiki_get wiki_list
  ✓ guild-telemetry: handshake + tools/list lists trace_summary trace_query trace_list_runs

==========================================
RESULT: 14 passed, 0 failed
```

## Findings

### What worked first try

- All 7 commands resolve. All 13 specialist agent files parse. All 67 skill directories have both `SKILL.md` and `evals.json`. Nothing structurally incoherent about the shipped artifact set.
- Hook chain fires cleanly against real payloads. `capture-telemetry.ts` correctly appends NDJSON for both `PostToolUse` and the newer beta2 `UserPromptSubmit` event. `maybe-reflect.ts` correctly refuses to reflect on a non-task session (empty events.ndjson). `check-skill-coverage.sh` fires once and then the session lock prevents re-firing.
- Both MCP servers cold-start in under a second, complete the `initialize` handshake, and list their tools. The `node_modules` install flow (run `npm install` once per server per README) gives the expected minimal green path.

### What needed fixing in the test harness (not Guild)

- **macOS bash 3.2 portability.** Two issues, both in my own harness script, not in Guild:
  - `${name^^}` (bash 4+ uppercase) had to be replaced with `tr '[:lower:]-' '[:upper:]_'`.
  - The `timeout` command isn't on the default macOS `$PATH`. Dropped the timeout — MCP stdio servers exit cleanly on stdin EOF, so the here-string closure is sufficient bounding.
- These are now fixed in `harness/run-tests.sh`. Future runs on a clean macOS checkout should go green first try.

### What remains open (deferred to a live session)

- A live `/guild "build a URL shortener..."` run. This is the one step that can't happen from inside a subagent session — it needs to start in a user's Claude Code terminal with the plugin installed. Install path: clone Guild, then from the test workspace run `/plugin install guild@./.claude/plugins/guild` (or equivalent local-install syntax).

- Once live, the spec in `guild-test-urlshortener/BRIEF.md` becomes the input. The expected lifecycle outputs (9 stages, listed in the BRIEF) are the acceptance criteria.

## How to reproduce

```bash
/Users/miguelp/Projects/guild-test-urlshortener/harness/run-tests.sh
```

Outputs per-layer log files under `guild-test-urlshortener/harness/logs/` for post-hoc inspection.

## Changes to Guild surfaced by this test

**None.** The harness found zero issues in Guild itself. All 14 pre-flight checks passed on the beta2 artifact.

This is the first signal that v1 is genuinely ready to ship once a live `/guild` run confirms the dispatch path. The remaining risk is concentrated in one question: does Claude Code's plugin loader resolve our `.claude-plugin/plugin.json` and all its references cleanly? The harness can't answer that; a user running `/plugin install` can.
