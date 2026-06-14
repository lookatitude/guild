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
synthesizes one from `events.ndjson` using the same statistics and section
layout as `scripts/trace-summarize.ts`. Source indicator:

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

1. `GUILD_TELEMETRY_CWD` env var (used in tests) overrides.
2. Per-call `cwd` argument → `<cwd>/.guild/runs/`.
3. Server process cwd → `<cwd>/.guild/runs/`.

## Invariants

- **Read-only.** No `writeFile`, no `appendFile`. `.guild/runs/` is never
  mutated by this server, even when synthesizing summaries.
- **Deterministic.** Runs sort by `run_id`, events by `(run_id, ts)`.
- **Malformed-line tolerant.** Mirroring `scripts/trace-summarize.ts`, bad
  NDJSON lines are skipped silently so queries keep working.

## Wiring

See `.mcp.json` at the repo root — the server is registered via
`npx -y tsx mcp-servers/guild-telemetry/src/index.ts`, stdio transport.

## Tests

```bash
cd mcp-servers/guild-telemetry
npm install
npx jest --no-coverage
```
