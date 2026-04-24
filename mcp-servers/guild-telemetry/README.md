# guild-telemetry

Optional Guild MCP server that exposes structured queries over a consuming
repo's `.guild/runs/`. Per `guild-plan.md` §13.3 this is optional; Guild works
end-to-end without it via `scripts/trace-summarize.ts` and plain filesystem
reads.

## Why it exists

Reflection, evolve, and audit commands all need to ask telemetry questions
like "which specialist errored in the last week" or "give me the summary of
the most recent run". This server exposes those queries over stdio so other
tools and skills can treat runs as a queryable store rather than a pile of
NDJSON.

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
