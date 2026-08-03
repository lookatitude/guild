# guild-telemetry

Optional Guild MCP server that exposes structured queries over a consuming
repo's `.guild/runs/`. This server is optional; Guild works end-to-end without
it via `scripts/trace-summarize.ts` and plain filesystem reads.

## Why it exists

Reflection, evolve, and audit commands all need to ask telemetry questions
like "which specialist errored in the last week" or "give me the summary of
the most recent run". This server exposes those queries over stdio so other
tools and skills can treat runs as a queryable store rather than a pile of
NDJSON.

## Run-artifact read order (ADR-OBS-4)

Post telemetry-split, the plugin **records** every run to its v1.4 JSONL live
log. This server reads that artifact by format (it imports no recorder code):

1. **Primary:** `<runDir>/logs/v1.4-events.jsonl` — the format the plugin emits.
2. **Fallback:** `<runDir>/events.ndjson` — legacy pre-split runs.

v1.4 events are normalized additively (e.g. `status` → `ok`, `latency_ms` → `ms`,
`hook_name` → `tool`) so every tool works against both shapes unchanged.

## Tools

### `trace_summary`

```
trace_summary { run_id: string, cwd?: string }
```

Returns the stored `summary.md` for a run if it already exists, otherwise
synthesizes one from `logs/v1.4-events.jsonl` (falling back to legacy
`events.ndjson`) using the same statistics and section layout as
`scripts/trace-summarize.ts`. Source indicator:

- `source: "file"` — returned `summary.md` verbatim.
- `source: "synthesized"` — rebuilt from events in memory (no write).

### `trace_query`

```
trace_query {
  run_id?: string,
  event?: string,
  specialist?: string,
  since?: string,
  limit?: number,
  cwd?: string
}
```

Filter events across one or all runs. Each returned event is annotated with
its `run_id` so consumers can scan across runs. Sorted by `run_id` then `ts`
for deterministic output.

### `trace_list_runs`

```
trace_list_runs { since?: string, limit?: number, cwd?: string }
```

List known runs with `event_count`, `started_at`, and `ended_at`. `since`
filters on the run's `ended_at` (falling back to `started_at` if a run has
no events yet).

### `trace_cost_rollup` (ADR-OBS-4)

```
trace_cost_rollup { run_id?: string, since?: string, cwd?: string }
```

Aggregate `guild.trace_event.v2` token usage across recorded events, merging
both token sources — the v2 `tokens` object (`{input,output,cached}`) and the
v1.4 `tool_call` `tokens_in`/`tokens_out` scalars. Returns run-wide `totals`
plus `by_tier`, `by_model`, and `by_specialist` breakdowns (each row is
`{key, input, output, cached, total}`), sorted by `total` descending then key.
Events with no token fields are skipped; `llm_event_count` reports how many
contributed. Omit `run_id` to roll up across all runs.

## cwd resolution

1. Explicit per-call `cwd` argument → `<cwd>/.guild/runs/` (wins — required so
   a long-lived server can fan out across federated child repos by cwd).
2. `GUILD_TELEMETRY_CWD` env var (used in tests, when no `cwd` is given).
3. Server process cwd → `<cwd>/.guild/runs/`.

### `--no-cwd-fallback` (hosts that launch the server outside the project)

A Codex plugin install must declare `cwd: "."` so Codex can resolve the server
path (measured on codex 0.146.0: `${CLAUDE_PLUGIN_ROOT}`-prefixed, bare-relative
and `./`-relative args all fail to start without a cwd; only an absolute path
works, and that cannot be published from a version-keyed cache root). That cwd is
the PLUGIN payload root, and Codex passes the child a scrubbed env with no
workspace signal at all — so step 3 above would resolve to the *plugin's own*
`.guild/`, serving Guild's bundled data instead of the consumer's.

The generated Codex manifest therefore passes `--no-cwd-fallback` alongside
`cwd: "."`. In that mode:

- step 3 is **removed** — no process-cwd default;
- the per-call `cwd` and the env override **must be ABSOLUTE** (a relative value
  would resolve against the payload, which is the same leak);
- calls without a usable root fail closed with `isError: true` and an actionable
  message, and the server's `instructions` plus every tool's `cwd` description
  say REQUIRED.

Unflagged behavior is unchanged: Claude Code and a dev checkout both launch the
server inside the consuming project, where step 3 is correct.

## Invariants

- **Read-only.** No `writeFile`, no `appendFile`. `.guild/runs/` is never
  mutated by this server, even when synthesizing summaries.
- **Deterministic.** Runs sort by `run_id`, events by `(run_id, ts)`.
- **Malformed-line tolerant.** Mirroring `scripts/trace-summarize.ts`, bad
  NDJSON lines are skipped silently so queries keep working.

## Wiring

See `.mcp.json` at the repo root — the server is registered via
`node ${CLAUDE_PLUGIN_ROOT}/mcp-servers/guild-telemetry/dist/index.js`, stdio
transport. `npm run build` (esbuild, bundled/self-contained) produces that
`dist/index.js`; `npx tsx src/index.ts` is only for local development.

## Tests

```bash
cd mcp-servers/guild-telemetry
npm install
npx jest --no-coverage
```
