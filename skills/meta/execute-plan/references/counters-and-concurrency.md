# Per-lane counters + `counters.json` concurrency (loop-implement detail)

Detail for SKILL.md §"Per-lane counters" and §"`counters.json` concurrency".

This skill calls `incrementCounter(...)` / `resetLaneCounters(...)` /
`readCounters(...)` from `counter-store.ts`; do NOT reimplement counter
persistence.

## Per-lane counters — isolation contract

Counters are keyed by `lane_id` in `counters.json`:

```json
{
  "schema_version": 1,
  "run_id": "run-2026-04-27-v1.4.0-adversarial-loops",
  "counters": {
    "L1": 0,
    "L2": 0,
    "L3:T3a-backend-config": 2,
    "L4:T3a-backend-config": 3,
    "security:T3a-backend-config": 1,
    "restart:T3a-backend-config": 0,
    "L3:T3b-backend-loops": 1,
    "L4:T3b-backend-loops": 1,
    "security:T3b-backend-loops": 0,
    "restart:T3b-backend-loops": 0
  }
}
```

Lane A's counter modifications NEVER touch lane B's keys. Tests pin
parallel-lane non-interference under both happy-path and A-restarts-B-continues
scenarios.

## `counters.json` concurrency

Specialists run in separate OS PIDs (subagent processes; agent-team panes).
Multiple lanes can update `counters.json` concurrently. The write protocol is
owned by T3a-backend-config's `counter-store.ts`:

- **Atomic-rename.** All writes use the write-tmp + rename pattern: write to
  `<runDir>/counters.json.tmp`, fsync, rename to `<runDir>/counters.json`. POSIX
  `rename` is atomic on the same filesystem.
- **Lock reuse.** Concurrent counter-updates serialize on the SAME stable
  lockfile sidecar `.guild/runs/<run-id>/logs/.lock` defined in ADR-009
  §"Stable-lockfile race control architecture". This is the SINGLE coordination
  primitive for ALL per-run shared state (JSONL log + counters.json).
- **Optimistic-retry on conflict.** Read-modify-write retries up to 3 times with
  bounded backoff (10ms, 50ms, 200ms). Failure after the 3rd retry → log a
  `tool_call status: "err"` event, surface to the orchestrator.
- **Crash-resume cleanup.** On startup, orphaned `counters.json.tmp` is deleted
  at lock acquisition; reads proceed against the prior `counters.json`.
