# Guild Diagnose — 2026-06-26 (evolve run left open)

## Input
- args: (none)
- selected_run_ids: run-d2b40cdd (status, latest), run-c3cebfb1 (evolve), run-df41d54d (evolve)
- operator_context: (none — inferred from telemetry)
- codex_review: false (no --review=cross; config not forcing)

## Evidence
- files_read: .guild/runs/current-run-id; run.yaml + logs/v1.4-events.jsonl + events.ndjson for the 3 latest runs; hooks/run-trace-start.ts; hooks/lib/run-trace.ts (startRunOnly/buildStartRunOpts)
- event_counts: d2b40cdd=521 v1.4 / 256 ndjson (status, closed, healthy); c3cebfb1=54/30 (evolve, closed); df41d54d=22/11 (evolve, OPEN)
- run-lifecycle scan: of the 3 runs carrying run.yaml → 1 open, 2 closed (the other ~198 run dirs predate run.yaml / are host-adapter dirs)
- missing_expected_artifacts: run-df41d54d/provenance.json absent (both closed runs have it); run.yaml status never flipped to closed
- errors: run-df41d54d error rows = 0 (no failure; last event 00:04:17, ~10 min after start at 23:54:42, then silence). A NEW evolve run (c3cebfb1) started 00:09:06 — ~5 min later — superseding it.
- post-rename health: the current /guild:status run (d2b40cdd) has full PreToolUse/PostToolUse telemetry → hooks + telemetry intact after the understand→learn rename.

## Diagnosis
- category: run-finalization gap (lifecycle/telemetry hygiene; not in the rigid taxonomy — closest published category is the run-lifecycle side of `telemetry-scope`)
- confidence: high (for the symptom + mechanism); the run is orphaned-open, NOT errored
- root_cause: `/guild:evolve` (run df41d54d) started a run via `startRunOnly` (writes run.yaml `status:open` + the current-run-id sentinel) but its session was interrupted (this session was compacted / a second evolve started) before the run was closed. Closing is tied to a session-end / explicit close that never fired, AND `startRun` does NOT finalize a stale prior open run when the next run begins (`hooks/lib/run-trace.ts:344 startRunOnly` → `lifecycle.startRun`, no close-prior step) — so the orphan persists.
- evidence: hooks/lib/run-trace.ts:344-403 (startRunOnly/buildStartRunOpts — no close-prior); .guild/runs/run-df41d54d-.../run.yaml (status: open, no provenance.json); the c3cebfb1 evolve start ~5 min after df41d54d's last event.
- impact: LOW. `current-run-id` points at the latest run (d2b40cdd), so `/guild:status` is not misled. Effect is one orphaned open run + a missing provenance sidecar — cosmetic telemetry hygiene; the benchmark may mis-count an un-terminated run.

## Fix Plan
1. **(Primary, smallest — data cleanup, no code change)** Finalize run-df41d54d: flip run.yaml `status: open → closed` and backfill `provenance.json` by running the existing close path (`run-trace.js`/`emitRunClosed`) against that run id, OR a minimal in-place edit of run.yaml.
   - files to edit: `.guild/runs/run-df41d54d-.../run.yaml` (+ new `provenance.json`)
   - behavior change: the orphaned run gets its terminal status; telemetry/benchmark see a complete record.
   - risk/blast radius: NONE (single historical run dir; no code, no live path).
   - validation: re-run the open/closed scan → 0 open; `guild-telemetry trace_list_runs` shows it closed.
   - rollback: restore the prior run.yaml (git not tracking .guild/runs, so keep a copy of the 1 changed line).

2. **(Optional follow-up — root cause, HIGH-TRUST surface `hooks/`)** Make `startRun` finalize a stale prior open run on new-run start (idempotent close-prior), so an interrupted session self-heals on the next command.
   - files to edit: `hooks/lib/run-trace.ts` (startRun/lifecycle) + rebuild `hooks/dist` + a ts-jest test.
   - behavior change: starting run N closes any still-open prior run owned by the same root before claiming the sentinel.
   - risk/blast radius: MEDIUM — touches the hook run-trace path (runs on every command); needs the dist rebuild (source edits are a no-op until `npm run build` in hooks/) + a real-path test.
   - validation: `npm run build` in hooks/ + jest run-trace suites + grep dist; simulate two back-to-back starts → prior auto-closes.
   - rollback: revert the run-trace.ts commit + rebuild.

## Approval Gate
status: approved (approve-1 — cleanup only; fix #2 deferred)

- files changed: .guild/runs/run-df41d54d-.../run.yaml (status open→closed), + provenance.json (backfilled)
- checks run: open/closed scan (open=0); provenance.json present
- results: PASS
- residual gaps: fix #2 (startRun close-prior on new-run-start, hooks/) NOT applied — deferred as a separate reviewed change
