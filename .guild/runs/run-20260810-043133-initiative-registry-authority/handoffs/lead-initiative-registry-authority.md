# Initiative registry authority — implementation handoff

## Outcome

The registry rollup now treats validated manifests and filesystem bucket
location as authoritative, preserves cache-only operator facts, retains and
deduplicates live/archived run provenance, and keeps cancellation terminal and
idempotent. The generated distribution mirror and resource digest are synced.

The full plugin suite initially exposed two stale anti-vacuity test fixtures;
those fixtures now derive their mutation targets from the current document and
inventory without weakening the detector.

## Verification

- Registry rollup: 18/18 tests.
- Initiative-focused surface: 60/60 tests.
- Architecture-doc checker: 41/41 tests.
- Full plugin suite: 310 suites passed; 8,448 tests passed; 11 skipped; 1 todo;
  zero failures.
- Inventory check: current.
- Diff check: clean before run-record creation.
- Cross-family G-lane review: satisfied, all five checksum conditions passed.
- Cross-family G-quality review: satisfied, all five checksum conditions passed.

## Open non-blocking notes

- Reopening/restoring an initiative must explicitly clear a cached terminal
  disposition; terminal cancellation is intentionally sticky.
- Invalid manifests remain non-authoritative even when their status field says
  cancelled; repair validation before relying on that state.
- The registry file header still uses older pure-projection wording while the
  function-level authority contract is accurate.

## Change ownership

The implementation lives only in the isolated worktree branch
`codex/full-implementation-convergence`; it has not been committed or promoted.
