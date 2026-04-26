# Metrics — scoring rubric, aggregation, comparison, API endpoints

This document is the operator-facing reference for how `scorer.ts` computes a `guild_score` from a `RunRecord`, how `compare.ts` derives a `comparison.json` from two trial sets, and which API endpoints the P2 server will expose to surface those JSON files. The data sources every formula reads — `run.json`, `events.ndjson`, `metrics.json`, `score.json`, `artifacts/.guild/...` — are tabulated in `01-architecture.md §3`; this file does not restate that table, it cites it.

Per `01-architecture.md §4 R1`, weights live with the Case YAML (`02-case-suite.md` `scoring_weights:` field), never hard-coded in `scorer.ts`. The default weights below reflect spec §Success P1; per-Case overrides are versioned with the case file.

## Per-component rubric

Each component carries a definition, the source artifacts it reads, the computation in plain English, and the invariants qa pins with property-based tests (T3 success criteria — `01-architecture.md §4 R1`). Backend's TypeScript types in `benchmark/src/types.ts` are the canonical source for shapes; this file describes the *meaning*.

### `outcome` — weight 30

- **Definition.** Did the case's acceptance commands pass on the captured artifacts?
- **Source artifacts.** `run.json.status`; the case's `acceptance_commands` (run by the scorer against `artifacts/.guild/...`). See `01-architecture.md §3` row for `run.json` and `artifacts/.guild/...`.
- **Computation.** All acceptance commands exit 0 → `raw_subscore = max`. Any non-zero → proportional partial credit per backend's formula (TS types are authoritative). **Timeout → 0** (`run.json.status: "timeout"` zeroes `outcome` per `01-architecture.md §4 R3` and spec §Constraints).
- **Invariants.** (a) Timeout always scores 0. (b) Adding a passing acceptance command never decreases `raw_subscore` (monotonicity).

### `delegation` — weight 20

- **Definition.** Did dispatched specialists match the case's `expected_specialists`?
- **Source artifacts.** `events.ndjson` (per-dispatched-specialist event records). See `01-architecture.md §3` row for `events.ndjson` and §2 Stage row.
- **Computation.** Set-similarity between observed dispatches and `expected_specialists`, with backend's exact formula in TS. Over-dispatch (calling specialists not on the expected list) is penalised; under-dispatch likewise.
- **Invariants.** (a) Exact match (observed = expected) is the maximum. (b) Adding a missing expected specialist to the observed set never decreases `raw_subscore`.

### `gates` — weight 20

- **Definition.** Did the run cleanly traverse the Guild lifecycle stages in the order the case expects?
- **Source artifacts.** `events.ndjson` stage-transition records (`01-architecture.md §2` Stage row defines the lifecycle entries the importer parses).
- **Computation.** Per-stage pass/fail, weighted by `expected_stage_order` from the case YAML. Skipped stages and out-of-order stages each lose proportional points.
- **Invariants.** (a) An exact match of `expected_stage_order` with all gates green = max. (b) A regression that fails an earlier stage (e.g. `verify`) but passes later ones still scores ≤ a run that passes the earlier stage.

### `evidence` — weight 15

- **Definition.** Do receipt claims cite real artifacts? An honest "I did X and here is the file proving it" beats a hand-waved "I did X."
- **Source artifacts.** Per-specialist handoff receipts under `artifacts/.guild/runs/<run-id>/handoffs/`. See `01-architecture.md §3` `artifacts/.guild/...` row.
- **Computation.** For each cited artifact path in a receipt, the scorer asserts the path exists under `artifacts/.guild/`. Unverifiable claims are subtracted; verified claims add. Backend's TS formula is authoritative.
- **Invariants.** (a) A receipt that cites only existing artifacts cannot score below a receipt with the same claims plus a hand-waved one. (b) Adding a verified citation never decreases `raw_subscore`.

### `loop_response` — weight 10

- **Definition.** Were `guild:reflect` proposals from prior runs applied? In v1 only the schema is wired; the meaningful signal lights up at P4 when a baseline → reflect → candidate loop runs end-to-end.
- **Source artifacts.** Reflection records inside `artifacts/.guild/...` (P3+); the `Reflection` node in `01-architecture.md §2`.
- **Computation.** Detection in P1 is best-effort against synthetic fixtures (operators can hand-author reflection-applied evidence); the formula stabilises at P4 (`06-learning-loop.md`).
- **Invariants.** (a) Score is monotonic in the count of cited prior reflections that resolved into committed plugin changes. (b) A run with no reflection history does not penalise itself — `raw_subscore` is the neutral baseline, not zero.

### `efficiency` — weight 5

- **Definition.** Wall-clock against the case's per-Case budget. **Not** a function of the global 1h cap (`01-architecture.md §4 R3`) — that's exactly how slow regressions hide under a too-generous cap.
- **Source artifacts.** `metrics.json.wall_clock_ms` and `metrics.json.wall_clock_budget_ms` (the latter sourced from the case YAML's `wall_clock_budget_ms`). See `01-architecture.md §3` row for `metrics.json`.
- **Computation.** A monotone-decreasing function of `wall_clock_ms / wall_clock_budget_ms`. At budget = full credit; well over budget = floor at 0.
- **Invariants.** (a) Lowering wall-clock never decreases `raw_subscore`. (b) Lowering the per-Case budget produces a *strictly lower* `raw_subscore` for the same wall-clock, by design — that's the lever an operator pulls to surface a regression without touching the 1h cap.

## Aggregation — `guild_score`

```
guild_score = Σ (weight_i × raw_subscore_i / max_subscore_i) → [0, 100]
```

Where `weight_i` is the component's weight from the case YAML's `scoring_weights:` (or defaults), `raw_subscore_i` is the value the component formula emits, and `max_subscore_i` is the component's per-formula maximum. The components' weights sum to 100; normalising by `max_subscore_i` keeps the aggregate in `[0, 100]`.

`score.json` records each component's `{ weight, raw_subscore, weighted }` plus the aggregated `guild_score`. The `weight` field captures the weight that was applied at score-time — bumping weights produces new runs at new run-ids, never mutating an existing `score.json` (`01-architecture.md §4 R1` immutability requirement).

Property-based invariants qa pins (T3 success criteria; `01-architecture.md §4 R1` containment iv):

- `Σ(component.weight × raw_subscore / max_subscore) = guild_score` for any weight set.
- `guild_score ∈ [0, 100]` for all valid inputs.
- Replacing any artifact with a strictly improved one never decreases the corresponding component subscore (per-component monotonicity above).

## Comparison delta semantics

`compare.ts` reads two trial sets — `baseline` and `candidate` — and emits `comparison.json` with per-component deltas plus a per-run pass/fail/timeout breakdown.

Determinism gate (`01-architecture.md §3`): the comparator filters on identical `plugin_ref + model_ref` across the two sets. Runs whose refs do not match the comparison's anchored pair are reported under `excluded_runs` rather than silently scored together (`01-architecture.md §4 R2` containment ii). If the included-run count is zero on either side, `compare.ts` refuses to emit a `guild_score` delta and instead emits `status: "no_comparable_runs"` (`§4 R2` iii).

Delta classification (per the spec's "regressions / fixes" surface):

- **Regression** — candidate `guild_score` < baseline `guild_score` by ≥ 1 weighted point on `outcome` or `delegation`.
- **Fix** — candidate `guild_score` > baseline `guild_score` by ≥ 1 weighted point on a component the baseline failed.
- **Neutral** — within the threshold band on every component.

The comparator's exact output path is `benchmark/runs/_compare/<baseline>__<candidate>.json`, confirmed by backend in P1 T2 (`.guild/runs/run-2026-04-26-benchmark-factory-p1/handoffs/T2-backend.md §Decisions made`) and re-confirmed in P2 T2. The full pin — including the run-directory name pattern `<case-slug>-<plugin_ref_short>-<model_ref_hash>-<n>` — is documented in `02-case-suite.md §"Comparator output path and run-directory pattern"`.

P4 introduces an optional `reflection_applied` annotation on `comparison.json` when both runs in the comparison were produced by the learning loop (i.e., `compare.ts` was invoked with the `LoopManifest` in scope per `p4-learning-loop-architecture.md §3.3`). The block carries `proposal_id`, `source_path`, `applied_at`, `plugin_ref_before`, `plugin_ref_after`, a server-computed `kept` boolean (the keep/discard verdict — see `06-learning-loop.md §Keep/discard rule + threshold tuning`), and a pre-computed `delta_summary` with `guild_score_delta` plus `worst_component_delta` + `worst_component`. The field is optional and absent on non-loop comparisons; `schema_version` stays at `1` (backward-compatible). See `06-learning-loop.md §Reflection-applied metadata + UI annotation` for the full field cross-walk and `06-learning-loop.md §Reading the comparison output` for a sample shape.

### Zero-reason taxonomy

When a component cannot be scored from the artifacts, its `raw_subscore` is 0 and `reason` is one of: `missing_artifact` (a required file like `events.ndjson` is absent or unreadable), `timeout` (the run's `status` is `timeout` per R3), `errored` (the run's `status` is `errored`). The precedence rule in `scorer.ts` checks `errored` before missing-events branches. This taxonomy lets the UI render zeros with context — never as silent gaps. Source: P2 T2 backend receipt §Follow-ups → route: technical-writer (5).

### `acceptance_command` event variant

The `EventLine` discriminated union includes an `acceptance_command` variant: `{ts, type: 'acceptance_command', command, exit_code}`. The scorer's `outcome` component matches these against the case's `acceptance_commands` array; an exit code of 0 contributes positively. Source: P2 T2 backend receipt §Follow-ups → route: technical-writer (4).

### Evidence heuristic

A handoff receipt is considered to have evidence when its `## Evidence` section contains ≥ 40 non-whitespace characters. The threshold is intentionally low so a single short bullet still counts. A future stricter parser (require fenced code block, require command + output) is a deliberate follow-up; the heuristic is pinned by tests in `benchmark/tests/artifact-importer.test.ts`. Source: P2 T2 backend receipt §Follow-ups → route: technical-writer (3).

### Events-shape divergence (hook telemetry vs. runner output)

The benchmark runner's `events.ndjson` uses a top-level `type` field (the discriminator on the `EventLine` union). Claude Code's hook telemetry uses a top-level `event` field with a different schema. The two streams are not interchangeable — the artifact-importer's zod `eventSchema` validates only the runner shape.

**Resolved at P3.** The live runner emits `events.ndjson` matching the importer's zod `eventSchema` directly: T2-backend's `runBenchmark` writes per-line records typed against the same `EventLine` discriminated union the importer parses, with the M14 / F4.2 redaction Transform applied per line before bytes hit disk (`benchmark/plans/security-review.md F4.2`). The convergence is pinned by qa's schema-convergence test at `benchmark/tests/runner.schema-convergence.test.ts` (T4 lane), which round-trips a live-runner `events.ndjson` through `parseEventsNdjson` and asserts every line validates. Hook telemetry remains a separate stream and is still detected via probe + ignored at import time per qa's R4 fixture-vs-real test. Source: P2 T2 backend receipt §Follow-ups → route: technical-writer (2); P3 T2 backend receipt §Files written + §Mitigations table M14; P3 T4 qa schema-convergence test (filename pending T4 confirmation — technical-writer post-T4 polish updates the cite if qa lands a different filename).

## API endpoints

Per ADR-001 §Decision §1, the runner ↔ UI boundary is a server JSON shape (Option A — won 90 vs. 71 in `adr-001-runner-ui-boundary.md §Option scoring`). The P2 React UI consumes these endpoints; the deferred public website later snapshots them via `npm run benchmark -- export-website` (ADR-001 §Decision §3). All endpoints bind `127.0.0.1` only, no auth (`adr-001-runner-ui-boundary.md §Decision §4`). Default port `3055`, override via `BENCHMARK_PORT` env var or `--port` flag (P2 T2 §Decisions made).

The six routes below are the contract shipped by the P2 read-server (`benchmark/src/server.ts`). All response shapes are TypeScript interfaces declared in `benchmark/src/types.ts`; the frontend imports them directly. Body examples and error envelopes are taken verbatim from the curl probes in P2 T2 backend receipt §Evidence. Source for the entire table: P2 T2 backend receipt §Follow-ups → route: technical-writer (1).

| Route | Status code(s) | Response shape (`benchmark/src/types.ts`) | Content-type | Body example | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /api/runs` | 200 | `RunsListResponse` | `application/json` | `{"runs":[{"run_id":"sample-pass-001","case_slug":"demo-url-shortener-build","plugin_ref":"abcdef1","status":"pass","guild_score":100,"started_at":"2026-04-26T05:30:00Z"}],"total":1}` | — |
| `GET /api/runs?case=<slug>` | 200 | `RunsListResponse` (rows filtered to `case_slug === <slug>`) | `application/json` | same shape as `GET /api/runs` | — |
| `GET /api/runs/:run_id` | 200 / 400 / 404 | `RunDetailResponse` | `application/json` | `{"run":{...RunJson},"metrics":{...MetricsJson},"score":{...Score},"events":[{"ts":"...","type":"stage_started","stage":"plan"},...]}` | 400 invalid `run_id`; 404 run not found / not yet scored |
| `GET /api/runs/:run_id/artifacts/*` | 200 / 400 / 404 | raw bytes | `text/plain` for `.md` / `.ndjson` / `.txt`; `application/json` for `.json`; else `application/octet-stream` | (file body) | 400 invalid `run_id` or path traversal (`{"error":"path traversal denied"}`); 404 artifact not found |
| `GET /api/comparisons/:baseline/:candidate` | 200 / 400 | `Comparison` | `application/json` | `{"schema_version":1,"baseline":{...TrialSetSummary},"candidate":{...TrialSetSummary},"status":"ok","excluded_runs":[],"per_component_delta":{...},"guild_score_delta":{"baseline":67.13,"candidate":100,"delta":32.87},"generated_at":"..."}` | 400 invalid set id |
| `GET /api/cases` | 200 | `CasesListResponse` | `application/json` | `{"cases":[{"id":"demo-url-shortener-build","title":"...","expected_specialists":["architect","backend","qa","technical-writer"],"expected_stage_order":["brainstorm","team","plan","context","execute","review","verify","reflect"]}]}` | — |
| `POST /api/runs` | **501** | `DeferredResponse` | `application/json` | `{"reason":"deferred to P3","docs":"benchmark/plans/03-runner.md"}` | — (always 501 in P2; handler lands with the P3 runner per `03-runner.md` Mode 2) |

Implementation notes pinned in P2 T2 backend receipt §Decisions made:

- **Joined run-detail returns parsed `EventLine[]`.** The artifact-importer's `parseEventsNdjson` zod schema runs server-side; the UI consumes typed events directly via `RunDetailResponse.events`. Raw `events.ndjson` bytes are not exposed via the artifacts pass-through — `events.ndjson` lives at `<run-dir>/events.ndjson`, sibling to `artifacts/`, not under it. A future `GET /api/runs/:run_id/events.ndjson` shortcut is deferred to P3 unless frontend hits the gap.
- **`?case=<slug>` filter is server-side.** One-line predicate `row.case_slug === slug`; cheaper than fetching all runs and filtering client-side, matches `p2-ui-architecture.md §2.1`'s `/demo/:case_slug` page contract.
- **`/api/comparisons/:baseline/:candidate` is computed on every request without writing.** Server passes `compareSets({ ..., write: false })`, re-reads each side's `score.json`, and returns `Comparison` without touching `_compare/<baseline>__<candidate>.json` on disk. The CLI's `compare` subcommand still writes the artifact (default `write: true`).
- **Path-traversal hardening.** `safeJoinUnder()` normalizes the rest-path, rejects `..` segments, and asserts the resolved target stays under `<runsDir>/<run_id>/artifacts/`. URL-encoded probes (`..%2F..%2F..%2Fetc%2Fpasswd`) return 400 + `{"error":"path traversal denied"}`.
- **`run_id` / set-id whitelist.** `isSafeSetId()` rejects anything outside `[A-Za-z0-9._-]+` plus the strings `.`, `..`, `_compare`. Matches the run-id pattern documented in `02-case-suite.md`.
- **No in-process cache.** Every request re-reads `run.json`, `metrics.json`, `score.json`, `events.ndjson`, and `cases/*.yaml` from disk — honours ADR-001 §Decision §2 thin-read-layer commitment.
- **Static fallback.** When `benchmark/ui/dist/` exists (production build), non-`/api/*` paths are served from there with extension-keyed `Content-Type`; SPA paths without an extension fall back to `dist/index.html`. When `dist/` is absent (dev), non-`/api/*` returns 404 + `{"error":"frontend not built","hint":"cd benchmark/ui && npm run build"}`.

ADR-001 §Decision §2 fixes two non-negotiable properties of these endpoints: **the server is a thin read layer** (no cache, each request re-reads the underlying file; `runs/` directory is the canonical source of truth — D5 NFR), and **the same JSON shape powers the deferred public website** (D4 driver; the deferred public website never runs the server in production, it consumes a static snapshot from `npm run benchmark -- export-website`).

## Risk references

- **R1 — scoring drift.** `01-architecture.md §4 R1`. This document is the rubric whose immutability matters: weights ship in the case YAML (versioned), `score.json` records the applied weight, historical runs are not re-scored. Bumping weights ⇒ new run-ids.
- **R2 — model / plugin churn.** `01-architecture.md §4 R2`. The comparator's filter on identical `plugin_ref + model_ref` is documented in §"Comparison delta semantics" above; mismatched runs surface as `excluded_runs`, not silently scored.
- **R3 — 1h timeout hides slow regressions.** `01-architecture.md §4 R3`. The `efficiency` component is bound to the per-Case `wall_clock_budget_ms`, **not** the global 1h cap, so an operator can lower the budget and surface a regression without changing `timeout_ms`.

## Cross-references

- `01-architecture.md §2` — Score node and Reflection node definitions.
- `01-architecture.md §3` — every artifact under `runs/<run-id>/` with its producer + consumer; the canonical source for which file feeds which component.
- `01-architecture.md §4 R1 / R2 / R3` — risk treatments this document operationalises.
- `01-architecture.md §5` — NFRs (1h cap; single operator; filesystem-only; no network beyond `claude` CLI).
- `adr-001-runner-ui-boundary.md §Decision` — endpoint shape and the four locked commitments (1: endpoints live here; 2: thin read layer; 3: same shape serves deferred website; 4: 127.0.0.1 only, no auth).
- `p2-ui-architecture.md §2.1` — per-route fetch contract; the React app's page-level components map 1:1 onto this file's API endpoints table.
- `02-case-suite.md §"Comparator output path and run-directory pattern"` — the comparator artifact path and the run-id name pattern referenced by `/api/comparisons/:baseline/:candidate`.
- `03-runner.md` — Mode 1 import-only flow that produces the artifacts this rubric consumes; Mode 2 is where `POST /api/runs` flips from 501 to live.
- `.guild/runs/run-2026-04-26-benchmark-factory-p2/handoffs/T2-backend.md` — full curl evidence for every route in the API table above and the source of the five integrated doc strings (zero-reason taxonomy, `acceptance_command` variant, evidence heuristic, events-shape divergence, schema table).
