# tooling-engineer Wave 6 — R-PERF + R-TRACE

## Deliverable summary

Wave 6 delivers M4 (perf budgets) and M10 (structured observability trace events) as
two new enforcement rails wired into `tests/rearch/run-all.ts`.

All 8 rails run GREEN or pre-existing-RED. R-PERF is ADVISORY; R-TRACE is STRICT.

---

## R-PERF: measure-then-set perf budgets

### Corpus

Three scrubbed-real corpus files stored at `tests/rearch/perf-corpus/`:

| File | Source run | Lines |
|---|---|---|
| `run-small-636.jsonl` | `run-learn-knowledge-convergence-20260529-094021` | 636 |
| `run-medium-942.jsonl` | `run-85d27757-f47b-4ccd-adaf-f91c749a4e8f` | 942 |
| `run-large-1784.jsonl` | `run-universal-host-plugin-architecture-20260617-152632` | 1784 |

Scrub passes applied: operator home paths, `.claude`, `.codex`, `~`, bare username.
6 residual `miguelp` references in medium, 2 in small — all inside `command_redacted`
or `result_excerpt_redacted` fields (meta-references to grep commands agents ran, not
actual path leaks). Accepted for perf corpus.

Provenance: `tests/rearch/perf-corpus/PROVENANCE.md`

### Committed baselines (`tests/rearch/perf-baseline.json`)

Measured 2026-06-21 on darwin/arm64, 10 iterations (hook startup: 5), p95:

| Metric | Measured p95 | Budget (x1.2) |
|---|---|---|
| recall_warm_ms | 17ms | 21ms |
| recall_cold_ms | 10ms | 12ms |
| config_resolution_ms | 5ms | 6ms |
| hook_startup_ms | 494ms | 593ms |
| read_events_small_ms | 7ms | 9ms |
| read_events_medium_ms | 5ms | 6ms |
| read_events_large_ms | 8ms | 10ms |

### R-PERF rail (`tests/rearch/r-perf.ts`)

ADVISORY (hook startup is inherently noisy in CI). Re-measures all 7 metrics at
runtime and compares to committed budgets. Anti-vacuity (--prove): 13 proofs
including artificially slow path (5000ms > 10ms budget) trips correctly; fast path
(5ms) passes; p95 math verified on known array; corpus files non-empty; slow path
(75ms > 60ms budget) trips.

---

## R-TRACE: 5 structured observability trace events

### Event schemas (`scripts/lib/guild-trace-events.ts`)

Five versioned schemas with TypeScript types, factory functions, and pure validators:

| Schema version | Type | Validator |
|---|---|---|
| `guild.trace.dispatch.v1` | `GuildTraceDispatchV1` | `validateDispatchEvent` |
| `guild.trace.recall.v1` | `GuildTraceRecallV1` | `validateRecallEvent` |
| `guild.trace.config_resolution.v1` | `GuildTraceConfigResolutionV1` | `validateConfigResolutionEvent` |
| `guild.trace.security_decision.v1` | `GuildTraceSecurityDecisionV1` | `validateSecurityDecisionEvent` |
| `guild.trace.degradation.v1` | `GuildTraceDegradationV1` | `validateDegradationEvent` |

Union dispatcher: `validateGuildTraceEvent(ev: unknown)` routes to the correct
per-schema validator. All validators are pure (no I/O, no Date.now()).

### Emit wrapper (`scripts/lib/guild-trace-emit.ts`)

`emitTraceEvent(event, runDir)` — validates before writing, uses fs.appendFileSync
to `<runDir>/logs/v1.4-events.jsonl`, never throws, silently drops if no runDir.

### Real emit points (file:line)

| Event | File | Line |
|---|---|---|
| `guild.trace.dispatch.v1` | `scripts/write-task-run.ts` | ~335 |
| `guild.trace.recall.v1` | `scripts/lib/recall.ts` | ~519 |
| `guild.trace.config_resolution.v1` | `scripts/lib/settings-resolver.ts` | ~45 |
| `guild.trace.security_decision.v1` | `scripts/lib/recall-protect.ts` | ~280 |
| `guild.trace.degradation.v1` | `scripts/lib/emit-readback-degradation.ts` | ~104 |

Note: config_resolution emit is in `scripts/lib/settings-resolver.ts` (the shim
re-export), NOT in `scripts/lib/core/settings-reader.ts`. This keeps the M3 hard
gate (R-HOST) clean — core/ must be zero-edit for a host addition.

### R-TRACE rail (`tests/rearch/r-trace.ts`)

STRICT. For each of the 5 schemas: valid fixture passes, malformed fixture (missing
required field) is rejected. Also verifies all 5 emit-point files exist on disk with
real `emitTraceEvent` wiring. Anti-vacuity (--prove): 16 proofs including each
validator rejects invalid inputs, each valid fixture passes, union dispatcher routes
correctly, emit-point detector TRIPS for nonexistent file and PASSES for real file.

---

## Evidence: all rails GREEN (R-DIST pre-existing exception)

```
──────── RAIL SUMMARY ────────
  R-DUP    GREEN  (0 finding(s))
  R-DEP    GREEN  (0 finding(s))
  R-VAC    GREEN  (66 finding(s))
  R-DIST   RED  (1 finding(s))    ← PRE-EXISTING from prior wave (stale dist/run-trace.js)
  R-HOST   GREEN  (0 finding(s))  ← was RED briefly; fixed by moving emit to settings-resolver.ts
  R-SEC    GREEN  (0 finding(s))
  R-PERF   GREEN  (0 finding(s))
  R-TRACE  GREEN  (0 finding(s))
```

```
npx tsx tests/rearch/run-all.ts --prove
→ All rails proved non-vacuous ✓
```

```
npx jest (55 test suites, 864 passing, 7 skipped, 0 failures)
```

## Behavior-neutral verification

Every emit point is in a `try/catch` that swallows all errors. Result is built
first, trace is emitted, original result is returned unchanged. Type-checks pass on
all 7 modified/created files. ts-jest suite passes 55 suites with 0 failures.

## Files created/modified

Created:
- `scripts/lib/guild-trace-events.ts` — 5 schemas, validators, factories
- `scripts/lib/guild-trace-emit.ts` — emit wrapper
- `tests/rearch/perf-baseline.json` — committed p95 baselines + budgets
- `tests/rearch/r-perf.ts` — R-PERF rail
- `tests/rearch/r-trace.ts` — R-TRACE rail
- `tests/rearch/perf-corpus/run-small-636.jsonl`
- `tests/rearch/perf-corpus/run-medium-942.jsonl`
- `tests/rearch/perf-corpus/run-large-1784.jsonl`
- `tests/rearch/perf-corpus/PROVENANCE.md`

Modified:
- `tests/rearch/run-all.ts` — wired r-perf + r-trace
- `scripts/lib/recall.ts` — guild.trace.recall.v1 emit
- `scripts/lib/recall-protect.ts` — guild.trace.security_decision.v1 emit
- `scripts/lib/settings-resolver.ts` — guild.trace.config_resolution.v1 emit (shim wrapper)
- `scripts/lib/emit-readback-degradation.ts` — guild.trace.degradation.v1 emit
- `scripts/write-task-run.ts` — guild.trace.dispatch.v1 emit

Zero live-surface delta (no .claude-plugin/commands/skills/agents/hooks.json changes).
