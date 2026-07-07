---
type: decision
owner: plugin-engineer
confidence: high
importance: high
source_refs:
  - plugin/hooks/capture-telemetry.ts
  - plugin/scripts/emit-loop-event.ts
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
# two-audit-schemas

## Context

Guild has two distinct event-logging subsystems that write structured event data
to disk. Understanding their boundary prevents cross-contamination and
import/path bugs.

## The two schemas

### Plugin NDJSON — `<runDir>/events.ndjson`

- Written by `hooks/capture-telemetry.ts` (hook) and `scripts/emit-loop-event.ts` (loop skills).
- One JSON object per line, `fs.appendFileSync`, no locking.
- Schema: `TelemetryEvent` shape with `ts`, `event`, `tool`, `specialist`,
  `payload_digest`, `ok`, `ms`, and optional `model`, `loop_layer`, `loop_round`,
  `loop_gate`, `loop_terminated`.
- Designed for single-orchestrator low-overhead telemetry; no rotation.

### Benchmark JSONL — `<runDir>/logs/v1.4-events.jsonl`

- Written by `benchmark/src/log-jsonl.ts`'s `appendEvent()`.
- POSIX stable-lockfile + atomic rename; rotation at 10 MiB; per-field redaction.
- Schema: `JsonlEvent` union (`LoopRoundStartEvent`, `LoopRoundEndEvent`,
  `CodexReviewRoundEvent`, …) with `run_id`, `lane_id`, `loop_layer`,
  `round_number`, `cap`, `terminated`, `terminator`, `gate`,
  `terminated_by_satisfied`.
- Designed for high-throughput parallel lane writes from benchmark runner PIDs.

## Why they are separate

The benchmark schema is optimized for multi-process parallel writes with shared
lock coordination and archival rotation. The plugin hook schema is optimized for
minimal-overhead single-process telemetry from Claude Code hook scripts.
Merging them would add the benchmark's 80+ line locking + rotation machinery
into every hook invocation, and couple plugin runtime correctness to the
benchmark build state.

## Decision

Keep both schemas coexisting at different paths. `emit-loop-event.ts` writes to
`events.ndjson` (plugin schema), not to `logs/v1.4-events.jsonl` (benchmark
schema). The benchmark importer (`artifact-importer.ts`) reads `events.ndjson`
as a v1.3 fallback and `logs/v1.4-events.jsonl` as the v1.4 primary.

## Consequences

- Loop skill instructions should always invoke `scripts/emit-loop-event.ts`,
  which appends to `events.ndjson`.
- Benchmark fixture runs produce events under `logs/v1.4-events.jsonl`.
- `artifact-importer.ts` must handle both paths; the fallback logic is the
  canonical bridge between the two schemas.
- New plugin scripts must not import `appendEvent` from `benchmark/src/log-jsonl`
  (see `emit-loop-event-self-contained.md` for the specific failure mode).

**How to apply:** When adding new event emission to the plugin layer, write to
`events.ndjson`. When adding new event types to the benchmark runner, write via
`log-jsonl.ts`'s `appendEvent`. Never cross the schemas.
