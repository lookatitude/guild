# Benchmark Factory — UI

Local React + Vite app for the Guild benchmark factory's operator surfaces.
Consumes the six routes locked in
[`benchmark/plans/adr-001-runner-ui-boundary.md`](../plans/adr-001-runner-ui-boundary.md)
and shaped in
[`benchmark/plans/p2-ui-architecture.md`](../plans/p2-ui-architecture.md).

## Dev

```sh
# 1. Boot the local read-server (binds 127.0.0.1:3055 by default)
cd benchmark && npm install && npm run benchmark -- serve

# 2. In another terminal, boot the Vite dev server (default :5173)
cd benchmark/ui && npm install && npm run dev
```

The dev server proxies `/api/*` to `http://127.0.0.1:3055` per `vite.config.ts`,
so the UI fetches `/api/runs` etc. without CORS plumbing.

## Build

```sh
cd benchmark/ui && npm run build
```

Produces `benchmark/ui/dist/`. In production mode, `npm run benchmark -- serve`
serves `dist/` as a static fallback for non-`/api/*` paths on the same port,
with SPA fallback to `index.html` so client-side routing works.

## Typecheck

```sh
cd benchmark/ui && npm run typecheck
```

## Env

- `VITE_API_BASE` (optional) — override the API base URL at build time.
  Default: `/api` (proxied via `vite.config.ts` in dev; same-origin in prod).
- `BENCHMARK_PORT` (server-side) — backend listens on this port; default `3055`.
  If you change it, also update the proxy `target` in `vite.config.ts`.

## Surface map

| Route             | Component             | Endpoint(s) consumed                                                    |
| ----------------- | --------------------- | ----------------------------------------------------------------------- |
| `/`               | `RunsListPage`        | `GET /api/runs`                                                         |
| `/runs/:run_id`   | `RunDetailPage`       | `GET /api/runs/:run_id`, `GET /api/runs/:run_id/artifacts/*`            |
| `/compare`        | `ComparePage`         | `GET /api/comparisons/:baseline/:candidate` (params from URL search)    |
| `/cases`          | `TriggerPanelPage`    | `GET /api/cases` + `POST /api/runs` (live in P3 — see "Live-run flow")  |
| `/demo/:slug`     | `DemoPage`            | `GET /api/runs?case=<slug>` + `GET /api/runs/:run_id` (curated)         |

All response shapes are imported from `benchmark/src/types.ts`
(`RunsListResponse`, `RunDetailResponse`, `Comparison`, `CasesListResponse`,
`DeferredResponse`).

## State + data fetching

No state-management library and no data-fetching library — per
`p2-ui-architecture.md §3` and `§4`. Server state flows through a hand-rolled
[`useFetch<T>`](src/hooks/useFetch.ts) (`useState` + `useEffect` +
`AbortController`); local UI state uses `useState`; cross-route state lives in
URL search params (`useSearchParams`). The four ADR-002 trigger conditions in
`p2-ui-architecture.md §4.1` are not present in P2.

## Charts

Default: **recharts** (~30 KB gz for the chart shapes used in v1). Picked for
its typed React-component API (no imperative SVG rebuild on data change),
tree-shakeable so we only pay for `BarChart` + `Bar` + `ResponsiveContainer` +
the two axis components, maintained, and the bundle cost sits well within the
500 KB total UI budget. Alternatives considered: visx (lower-level; would force
us to write more wrapper code for an internal tool), uPlot (smallest, but not
React-first; integration boilerplate), Chart.js (canvas-based; harder to test
in happy-dom). Single-operator, internal, function-driven UI — recharts is the
right size. Rationale also surfaced in the root benchmark README's "Charts"
subsection (technical-writer integrates).

## Critical UI contracts

- **Status pills.** All four `RunStatus` values (`pass` / `fail` / `timeout` /
  `errored`) render with their own pill (no green for `timeout`; `timeout` has
  its own muted color). The runs table never filters by status — failures and
  timeouts are visible by default.
- **Loud zeros.** When a `ComponentScore.raw_subscore` is `0`, the
  `MetricBreakdown` renders the `reason` field
  (`missing_artifact` / `timeout` / `errored`) inline so the operator sees
  *why* the component zeroed.
- **Outbound network.** The UI fetches `/api/*` only. In dev the proxy targets
  `http://127.0.0.1:3055`; in prod the same-origin server handles it. No
  third-party endpoints are reached.

## Reflection annotation (P4)

`ComparePage` renders a reflection annotation above the per-component delta
table when the comparison carries a `reflection_applied` block (set by
`compare.ts` when called with a loop manifest — see
[`benchmark/plans/p4-learning-loop-architecture.md` §3.4](../plans/p4-learning-loop-architecture.md)).
The annotation shows the proposal id + source path + applied timestamp
(`data-testid="reflection-badge"`), a `plugin_ref_before → plugin_ref_after`
line (`data-testid="plugin-ref-delta"`), and a `kept` / `discarded` outcome
badge (`data-testid="keep-discard-badge"`, `data-kept={kept}`); when discarded,
the worst-component delta from `delta_summary` is surfaced inline so the
operator sees why. When `reflection_applied` is absent, the page renders
identical to P3.

## Live-run flow (P3)

The trigger panel's `Run` button is live in P3. Click it and the UI POSTs
`{case_slug}` to `/api/runs`; on `202 Accepted` the response carries the new
`run_id` (and a `Location: /api/runs/<run_id>` header), and the UI navigates to
`/runs/<run_id>`. The run-detail page calls a small `useRunStatus(runId)` hook
that wraps `useFetch` and polls `GET /api/runs/<id>` every 2 seconds until
`run.status` is terminal (`pass | fail | timeout | errored`); it stops polling
on terminal status or unmount. A `Run in progress…` banner is shown while
polling. Concurrent POSTs are rejected by the backend with `409 Conflict` —
the UI surfaces an inline message linking to the in-flight run; `400` shape
errors and network failures are surfaced inline as well. Polling was picked
over SSE — zero added backend surface, no backpressure semantics, fits the
single-operator local-tool frame.

## Bundle budget

Target: `dist/` ≤ 500 KB gzipped. Verify with:

```sh
cd benchmark/ui && npm run build && du -sh dist/
for f in dist/assets/*.js dist/assets/*.css; do
  printf "%-40s gz=%6d\n" "$f" "$(gzip -c "$f" | wc -c)"
done
```

Current breakdown (P2 baseline): ~160 KB gzipped total — react chunk ~54 KB,
recharts chunk ~102 KB, app + CSS ~8 KB.

## Files this lane owns

`benchmark/ui/**` (this directory). Does not touch `benchmark/src/` (backend's
lane), `benchmark/tests/` / `benchmark/cases/` / `benchmark/fixtures/` (qa's
lane), or `benchmark/plans/*.md` / `benchmark/README.md` (technical-writer's
lane). Type imports from `benchmark/src/types.ts` are read-only.
