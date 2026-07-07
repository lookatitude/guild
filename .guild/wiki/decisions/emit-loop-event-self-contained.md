---
type: decision
owner: plugin-engineer
confidence: high
importance: medium
source_refs:
  - plugin/scripts/emit-loop-event.ts
  - plugin/hooks/capture-telemetry.ts
created_at: 2026-05-02
updated_at: 2026-05-02
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-05-02
asker: user
task: guild-residual-closeout-p0-telemetry
category: architecture
---
# emit-loop-event-self-contained

## Context

`scripts/emit-loop-event.ts` was initially written as a standalone script, then
auto-refactored to import `appendEvent`, `isSafeLaneId`, `isSafeRunId`, and typed
event shapes from `../benchmark/src/log-jsonl.js`. The refactored version
produced silent failures with exit 0 and no events written.

## Root cause

Two independent failures in the benchmark-import approach:

1. **tsx import resolution.** When `npx tsx scripts/emit-loop-event.ts` runs,
   tsx resolves imports relative to the script's location. The path
   `../benchmark/src/log-jsonl.js` resolves as `.js` extension which tsx cannot
   find without a built output file — the benchmark TypeScript source is
   `log-jsonl.ts`, not `.js`. The failure is silent because tsx treats unresolved
   module imports as non-fatal when `process.exit(0)` is the error handler
   throughout the script.

2. **Wrong output path.** Even if the import had succeeded, `appendEvent` writes
   to `<runDir>/logs/v1.4-events.jsonl` (the benchmark's locking, rotating JSONL
   path), not to `<runDir>/events.ndjson` (the plugin hook's path). Events
   emitted by `emit-loop-event.ts` would land in a different file than events
   emitted by `capture-telemetry.ts`, making the two sources silently
   incompatible.

## Options considered

- Fix tsx resolution by using `.ts` extension in the import path and ensuring tsx
  can trace through the benchmark tsconfig.
- Write a thin re-export bridge in `scripts/` that re-exposes only the needed
  functions with a `.ts` extension.
- Make `emit-loop-event.ts` self-contained: inline `RUN_ID_RE`, `LANE_ID_RE`,
  `isSafeRunId`, `isSafeLaneId`, and use `fs.appendFileSync` directly.

## Decision

Make `emit-loop-event.ts` self-contained and write to `events.ndjson` — because
scripts in `scripts/` should not depend on the benchmark build state, and the
plugin event schema must stay in `events.ndjson` for hook telemetry queries to
remain unified.

## Consequences

`emit-loop-event.ts` duplicates three small validators (`isSafeRunId`,
`isSafeLaneId`, regex literals) from `benchmark/src/log-jsonl.ts`. This is
intentional — the validators are stable, the duplication is cheaper than the
coupling. If the regex contracts change in the benchmark, they must be manually
synced here.

**How to apply:** Any new script under `scripts/` that needs to append events
to the plugin audit log should write directly to `events.ndjson` via
`fs.appendFileSync`, not import from `benchmark/src/`.
