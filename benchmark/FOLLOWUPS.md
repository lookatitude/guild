# Benchmark factory — followups

Single ledger of items deferred out of v1.1/v1.2 scope. Each entry:
what / why deferred / who owns / where the original decision lives.

Updated 2026-04-27 (v1.2).

## Out of v1.2 — deferred with reason

### F1. `loop --abort` action — CLOSED in v1.2

**Status.** Landed `loopAbort()` in `benchmark/src/loop.ts` + CLI
dispatch in `cli.ts` + 7 unit tests + 3 CLI argv tests. Refuses on
terminal states (`completed`, `aborted`); supports `--dry-run`; clears
the lockfile when present. Mirrors continue/status arg validation.

### F2. `loop --rollback <candidate-id>` helper

**What.** `p4-learning-loop-architecture.md §6.1` forward-references
rollback semantics. v1 default: operator reverts the commit by hand
(`git revert <plugin_ref_after>`).

**Why deferred.** Same as F1 — no demand. Manual revert is well-
understood and zero-novel-surface.

**Owner.** backend + security (rollback-via-tooling adds an attack
surface security would need to threat-model).

### F3. Manifest cryptographic signing / hash-of-artifacts

**What.** `p4-learning-loop-architecture.md §4.3 + §6.2` and
`security-review-p4.md` forward-reference signing for tamper detection.
Not implemented in v1.

**Why deferred.** Security review concluded v1 is OK without signing
because the manifest lives under `~/.guild/runs/` (operator-owned) and
the proposed apply path already gates on operator review. Signing
becomes important in a hosted/multi-operator scenario; v1 is
single-operator.

**Owner.** security T6 (re-evaluate when multi-operator scenarios
emerge).

### F4. `auth_identity_hash` UI surfacing

**What.** P4 added the field to `run.json`. Originally architect
default: never expose in the UI (forensic-only).

**Status (v1.1):** **partially landed** — UI now shows a 7-char prefix
badge on `RunDetailPage` when the field is present, with the full hash
in the `title` attribute. Forensic-only contract preserved (no search,
no filter, no aggregation).

**Owner.** Closed for v1.1. Remaining: a "show me runs by this auth
hash" view → still followup if product wants it; flagged as scope
expansion not bug fix.

### F5. Q6 / Q7 loop security pins — CLOSED in v1.2

**Status.** The two `it.todo` slots in
`benchmark/tests/loop.security.test.ts` are replaced with real
integration tests:

- **Q6.** `pre-existing lockfile causes loopContinue to fail with
  lock-contention error` — pre-seeds the lockfile (simulating
  "another process is mid-continue"), invokes `loopContinue` against a
  real git-init'd host root, asserts the documented "another invocation
  is in flight" error fires.
- **Q7.** Two tests pin the atomic-rename invariant: (a) success path
  leaves no `.tmp` file and writes new content fully; (b) N concurrent
  `writeManifestAtomic` calls against the same path produce a final
  manifest that parses to ONE of the writer payloads in full, never
  partial / never garbled.

`writeManifestAtomic` was newly exported from `loop.ts` for testing.

### F6. F3.4 hard RSS cap on subprocess

**What.** `benchmark/plans/security-review.md F3.4` documents that
runaway memory in a subprocess is bounded by operator-side
`ulimit -v` only. macOS has no portable per-process equivalent; Linux
operators set it themselves.

**Why deferred.** No portable cross-platform solution. Documenting in
runbook + relying on operator OS controls is the v1 stance.

**Owner.** security (re-evaluate if cgroups becomes a portable target,
or accept indefinitely).

### F7. Windows hardening (ADR-005)

**What.** Path normalisation uses `path.posix`; full Windows
hardening (including `taskkill /T /F` for process-group escalation
analogous to ADR-004 on POSIX) is not implemented.

**Why deferred.** Operator base is currently macOS/Linux. Windows is
"best effort" — `adr-004 §Drivers D6` flagged this; no operator on
Windows has hit the problem yet.

**Owner.** mobile/devops (whoever picks up Windows targets) +
architect for ADR-005.

### F8. `export-website` subcommand

**What.** CLI subcommand reserved in `benchmark/src/cli.ts`; exits 2
with "deferred" message.

**Why deferred.** v1 spec explicitly out-of-scope. The benchmark
factory is a local operator tool; no public website in v1.

**Owner.** product (if/when public benchmark site becomes scope).

### F9. Cross-`run_kind` comparator warning — CLOSED in v1.2

**Status.** Landed `Comparison.kind_mix` field counting raw_model vs
guild_lifecycle runs per side. CLI prints a WARNING line when either
side mixes kinds OR the two sides disagree on kind. 3 unit tests pin
the counting (pure-kind, cross-kind, mixed-within-side).

### F10. `events.ndjson` from `claude --print` mode

**What.** `claude --print` does not load plugins, so live runs never
produce a Guild lifecycle `events.ndjson`. Live runs cap at ~30/100
partial. Documented in
`.guild/wiki/decisions/benchmark-runs-raw-claude-not-guild-lifecycle.md`.

**Why deferred.** Architectural — needs an interactive harness that
spawns `claude` with the Guild plugin pre-loaded and feeds the prompt
programmatically. v2 feature.

**Owner.** architect (v2 ADR), backend (implementation when scoped).

### F11. Strip deprecated `run_id` field from 409 body — CLOSED in v1.2

**Status.** Server emits only `current_run_id` on 409 conflict; the
v1.1 deprecated `run_id` alias is gone. Test pins absence explicitly
so a regression flips the suite red.

### F12. Hook-driven `guild:reflect` for dev-team work

**What.** `hooks/maybe-reflect.ts` Stop hook fires after `/guild`
lifecycle Stop. Dev-team work dispatches `general-purpose` agents
directly, so the hook never fires for self-build sessions. v1.1
codified manual `guild:reflect` invocation in
`.guild/wiki/decisions/continuous-knowledge-discipline.md`.

**Why deferred.** Widening the hook to fire on any agent completion
risks noise (every agent dispatch produces a reflection proposal).
Until manual invocation proves too easy to skip, status quo.

**Owner.** hook-engineer (re-evaluate if reflections backlog grows).

### F13. Subprocess-race property test — CLOSED in v1.2

**Status.** Landed `tests/runner.race.property.test.ts`. Exports
`awaitStreamEndBounded` + `STREAM_END_TIMEOUT_MS` from `runner.ts`.
6 tests pin the deadlock-free contract: null stream, already-ended,
already-destroyed, [property] random commit timings × event kinds,
5s safety fallthrough on never-ending streams, [property] N concurrent
awaits all settle when stream ends. The exact pattern that would have
caught v1.1 Bug 2 pre-ship.

## Closed in v1.2

For audit-trail continuity, items closed during the v1.2 release
window:

- ~~F1: `loop --abort` action~~ — closed (loopAbort + CLI dispatch + 10 tests).
- ~~F5: Q6/Q7 concurrent-lock + atomic-rename~~ — closed (3 integration tests in loop.security.test.ts).
- ~~F9: cross-run_kind comparator warning~~ — closed (Comparison.kind_mix + CLI WARNING + 3 tests).
- ~~F11: strip deprecated `run_id` from 409 body~~ — closed.
- ~~F13: subprocess-race property test~~ — closed (runner.race.property.test.ts, 6 tests).
- ~~G1: pre-push hook refusing direct push to main~~ — closed (.githooks/pre-push, GUILD_ALLOW_PUSH_MAIN bypass).

## Closed in v1.1

For audit-trail continuity, items closed during the v1.1 release
window:

- ~~`GUILD_BENCHMARK_LIVE` not enforced~~ — closed (Bug 1, see
  `.guild/wiki/decisions/enforce-live-gate-in-runner.md`).
- ~~`spawnAndWait` deadlock~~ — closed (Bug 2, see ADR-006 +
  `runner.ts` `awaitStreamEndBounded`).
- ~~claude v2.x argv rejections~~ — closed (Bugs 3-5, see
  `benchmark/plans/adr-006-runner-prompt-via-stdin.md`).
- ~~README §10 stale prose~~ — closed (v1.1 README update).
- ~~409 contract `run_id` vs `current_run_id`~~ — closed; deprecated
  alias kept for one release (see F11).
- ~~Comparator silently skips unscored runs~~ — closed; surfaces in
  `comparison.skipped_runs[]` + CLI WARNING line.
- ~~Stale `_benchmark-prompt.txt` write~~ — closed; only writes when
  ARGV_TEMPLATE references `${PROMPT_FILE}`.
- ~~`auth_identity_hash` never displayed~~ — closed (forensic badge
  on RunDetailPage).
- ~~Score components mysterious on raw-claude runs~~ — closed via
  `run_kind: "raw_model" | "guild_lifecycle"` annotation.
- ~~CLAUDE.md "agents not yet populated" stale line~~ — closed.
- ~~No `.guild/wiki/` knowledge layer for Guild repo~~ — closed
  (backfilled 2026-04-27 with 9 decisions, 2 standards, 1 recipe, 1
  reflection).
