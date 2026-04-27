---
type: adr
id: ADR-001
slug: runner-ui-boundary
phase: P1
spec: .guild/spec/benchmark-factory.md
plan: .guild/plan/benchmark-factory.md
design: benchmark/plans/01-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-26
supersedes: []
superseded_by: []
---

# ADR-001 — Runner ↔ UI boundary: server JSON shape vs. on-demand filesystem reads

## Status

**Accepted** — 2026-04-26.

This ADR locks the contract the P2 React UI will consume. The decision is
made now (in P1) so that backend's P2 `server.ts` lane and the proposed
`frontend` specialist's lane have a single source of truth before either
starts implementing.

## Context

The benchmark factory writes every run as a directory of JSON / NDJSON /
Markdown files under `benchmark/runs/<run-id>/` (full artifact list:
`01-architecture.md` §3). In P2, a local React UI must consume that data and
expose five surfaces (per spec §Success P2):

1. **Runs table** — case, plugin ref, status, score, duration, timestamp.
2. **Run detail** — stage graph, artifacts, raw failures, metric breakdown.
3. **Compare view** — baseline vs. candidate score deltas + regressions / fixes.
4. **Trigger panel** — case selector, repetitions, plugin ref, timeout.
5. **Demo view** — curated per-case summary.

Two viable shapes can sit between the runner and the UI:

- **Option A — server JSON shape.** A small local HTTP server
  (`npm run benchmark -- serve`) reads the run-directory tree on each
  request and exposes a stable JSON API the UI consumes. The on-disk file
  layout can evolve without breaking the UI; the API is the contract.
- **Option B — on-demand filesystem reads.** The UI is a static SPA shipped
  by Vite's preview server (or `npm run benchmark -- serve` as a static file
  server) and `fetch()`es the JSON files directly from
  `/runs/<run-id>/score.json` etc. The on-disk layout *is* the API.

The same choice will determine how the **deferred public website** (spec
§Non-goals) consumes run data later. The website is out of v1 but is
explicitly named as a future consumer of the same artifacts.

## Drivers

The drivers below are pulled from the spec (§Goal, §Audience, §Constraints,
§Non-goals). Each is named so Options can be scored against it explicitly,
not against vibes.

| ID  | Driver                                                                                                | Source                          | Why it matters                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| D1  | **Single-operator simplicity.** No auth, no concurrent writers, no shared deployment.                  | spec §Audience, §Non-goals      | The choice should not introduce moving parts the operator must reason about. Fewer processes is better.                 |
| D2  | **Runner-internal evolution flexibility.** Backend will iterate on `runner.ts`, `events.ndjson`, and the run-directory layout across P3 and P4. | spec §Success P3, §Success P4   | If the on-disk layout *is* the contract, every internal change is a UI breakage; if the API is the contract, internals can churn. |
| D3  | **P2 frontend specialist's onboarding cost.** The frontend specialist is new to the team (gap-filled at P2 — spec §R5) and consumes whatever P1 locks. | spec §R5                        | A typed, documented JSON API is much cheaper to onboard against than "go read these `.json` files in this directory tree". |
| D4  | **Deferred public-website consumer.** A separate `website/` will later read the same run data without going through the React UI. | spec §Non-goals                 | The chosen shape must work for a consumer that does **not** want to run a Node server (e.g. a static site generator that snapshots JSON). |
| D5  | **Filesystem-only / no DB constraint (NFR).**                                                          | spec §Non-goals, §Constraints   | Whichever option is chosen must not introduce an in-process cache or shadow store that diverges from the on-disk truth. |
| D6  | **No network surface beyond `claude` CLI (NFR).**                                                      | spec §Constraints               | Any HTTP server must bind `127.0.0.1` and never reach out. Both options can satisfy this; called out so neither hides it. |

## Options

### Option A — Server JSON shape

A small Node/Express (or Hono / Fastify — backend's call) server runs as
`npm run benchmark -- serve`, binds `127.0.0.1`, and exposes endpoints like:

```
GET  /api/runs                          → list of run summaries (runs table)
GET  /api/runs/:run_id                  → single run detail (run.json + metrics.json + score.json + events.ndjson, joined)
GET  /api/runs/:run_id/artifacts/*      → raw artifact pass-through
GET  /api/comparisons/:baseline/:candidate → comparison.json (computed on-demand or read if cached)
GET  /api/cases                         → list of case YAMLs (trigger panel)
POST /api/runs                          → enqueue a run (trigger panel; P3+)
```

The UI fetches typed JSON from these endpoints. The on-disk layout under
`benchmark/runs/` stays an internal implementation detail of `server.ts` +
`runner.ts`.

**Lifts directly from the design.** §3 of `01-architecture.md` already lists
every artifact and its consumer; the API shape above is a 1:1 surface over
that table.

### Option B — On-demand filesystem reads

`npm run benchmark -- serve` runs Vite (or any static file server) over
`benchmark/ui/dist/` plus `benchmark/runs/`. The UI does:

```ts
const score = await fetch(`/runs/${runId}/score.json`).then(r => r.json());
const events = await fetch(`/runs/${runId}/events.ndjson`).then(r => r.text());
```

The directory listing for `/runs/` is generated by either a server-side
index endpoint (one tiny exception, breaks the "pure static" claim) or a
manifest file (`runs/_index.json`) the runner refreshes after each run.

The on-disk layout *is* the API. Any change to artifact paths is a UI
breakage; the schema lives in two places (importer + UI consumer types).

## Decision

**We choose Option A — server JSON shape.**

`benchmark/server.ts` will be the single source of truth for the contract
the UI consumes. The on-disk layout under `benchmark/runs/<run-id>/` remains
the canonical store (per the filesystem-only NFR), but the UI never reads
files directly — it goes through the server's typed API.

Concrete commitments locked by this decision:

1. **Endpoint shape lives in `04-metrics.md`** (technical-writer T4 in P1
   stubs the section; backend P2 fills the routes with concrete request /
   response schemas). The endpoints sketched in Option A above are the
   starting point.
2. **The server is a thin read layer.** It does not cache (D5). Each
   request re-reads the underlying file; the `runs/` directory remains the
   source of truth. Cache may be added later if profiling demands it; not
   now (`Simplicity first`).
3. **The same JSON shape powers the deferred public website.** A future
   `npm run benchmark -- export-website` (deferred per spec §Non-goals)
   snapshots the server's responses to static JSON under
   `website/data/benchmarks/`. The website reads those files; it does not
   need to run the server in production. This satisfies D4 without
   requiring the website to ship a Node server.
4. **The server binds `127.0.0.1` only.** No outbound network. No auth.
   (D6 + spec §Constraints.)

## Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect the driver's
relative importance per the spec; explicit so the math is auditable.

| Driver                                          | Weight | Option A — server JSON shape | Option B — on-demand filesystem reads | Notes                                                                                                                                                |
| ----------------------------------------------- | -----: | ---------------------------: | ------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 — Single-operator simplicity**             |     2  | **3**                        | **5**                                 | B wins. A introduces a dedicated server process (one more thing to start, one more port, one more crash class). B is just a file server.            |
| **D2 — Runner-internal evolution flexibility**  |     5  | **5**                        | **2**                                 | A wins decisively. Run-directory layout will churn across P3 (live capture format) and P4 (reflection metadata). API insulates the UI from churn.    |
| **D3 — Frontend onboarding cost**               |     4  | **5**                        | **3**                                 | A wins. A new frontend specialist gets a typed API + endpoint docs in `04-metrics.md`. B requires the frontend to learn the on-disk artifact layout. |
| **D4 — Deferred public-website consumer**       |     3  | **5**                        | **3**                                 | A wins (when paired with `export-website` snapshot). The website consumes the same JSON shape without requiring the server in production.            |
| **D5 — No-DB / filesystem-only NFR**            |     3  | **4**                        | **5**                                 | B wins slightly. A is acceptable as long as it never caches; it remains a read-only proxy. Lock this as a constraint above (commitment #2).          |
| **D6 — No network surface beyond `claude` CLI** |     3  | **4**                        | **5**                                 | B wins slightly. A introduces an HTTP listener; mitigated by `127.0.0.1`-only binding. B's static server has the same listener but smaller surface.  |
| **Weighted total**                              |     —  | **(3·2)+(5·5)+(5·4)+(5·3)+(4·3)+(4·3) = 90** | **(5·2)+(2·5)+(3·4)+(3·3)+(5·3)+(5·3) = 71** | A wins on the two highest-weighted drivers (D2 evolution, D3 onboarding) by enough to outweigh B's edge on D1 + D5 + D6.                  |

Option A wins **90 vs. 71**. The decisive drivers are D2 and D3:
runner-internal evolution flexibility and frontend onboarding cost. Both
are existential for a multi-phase build where the data shape *will* change
between P1 and P4 and where a new specialist arrives at P2 without any P1
context.

## Consequences

### Positive

- **Stable UI contract through P3 / P4 churn.** Backend can refactor
  `runner.ts`, change `events.ndjson` shape, restructure
  `runs/<run-id>/artifacts/`, all without breaking the UI as long as the
  API responses stay shaped the same. This is the entire reason a
  multi-phase build needs a real boundary here.
- **Clean handoff to the P2 frontend specialist.** Frontend gets a typed
  API + `04-metrics.md` endpoint reference instead of a tour of
  `benchmark/runs/`. Onboarding is a documented contract, not a tribal
  knowledge transfer.
- **One contract serves both UI and the deferred public website.** When
  someone later authors `website/`, they consume the snapshotted JSON from
  `npm run benchmark -- export-website` — same shape, no parallel reader
  to maintain.
- **The server is a natural seam for `POST /api/runs`** (the trigger
  panel in P3). Without a server, the UI would have to shell out via some
  other mechanism (a CLI bridge process, a file-watch convention) to start
  a run; that's worse than just adding a route.

### Negative — accepted trade

- **One more process to run.** The operator must now run
  `npm run benchmark -- serve` for the UI to work. Mitigated by: a
  documented one-liner in `benchmark/README.md`; the same `serve` command
  serves both API and the built UI bundle (single port). Cost is real but
  small for a single-operator tool.
- **API surface to maintain.** Backend now owns endpoint contracts in
  addition to artifact shapes. Mitigated by: `04-metrics.md` documents the
  endpoints; the API is intentionally thin (read-through, no business
  logic), so additions are mechanical.
- **Slight redundancy with on-disk artifacts.** Anyone with shell access
  can still read `benchmark/runs/<run-id>/score.json` directly. We accept
  this — the on-disk store remains canonical (D5) and is useful for
  debugging; only the UI is required to go through the API.
- **Light cache pressure on large run sets.** Re-reading every file on
  every request scales linearly with run count. Acceptable for the
  expected single-operator load; if it bites, a small in-memory LRU
  keyed by file `mtime` can be added without changing the API.

### Negative — rejected trade-off (kept in for the audit trail)

- We considered a **WebSocket / SSE push** layer so the UI auto-refreshes
  when a new run lands. **Rejected for P1 / P2.** Operator can hit
  refresh; the cost of a streaming layer outweighs the benefit at this
  scale. Revisit at P3 once the trigger panel exists.

### Forward implications (locked by this ADR)

- **P2 backend lane (out of P1 scope)** — implements `server.ts` per the
  endpoint sketch in §Decision; frontend lane consumes typed responses;
  technical-writer expands `04-metrics.md`'s endpoint section.
- **P3 backend lane (out of P1 scope)** — `runner.ts` writes through the
  same on-disk paths the importer reads in P1; no API change needed.
- **Deferred website (out of v1 scope)** — consumes the snapshot exported
  by a future `npm run benchmark -- export-website`. Same JSON shape.

## Alternatives considered (and why they lost)

- **Option B — on-demand filesystem reads.** Lost on D2 + D3 by enough to
  swamp its D1 / D5 / D6 wins (full scoring above).
- **Hybrid (UI reads filesystem for raw artifacts; API for everything
  else).** Tempting because it lets `artifacts/.guild/...` files stream
  directly. **Rejected** because it splits the contract — every artifact
  type now needs a "is this fetched via API or via static file?" answer,
  and that answer can change. Option A handles raw artifacts via a
  pass-through endpoint (`GET /api/runs/:run_id/artifacts/*`); the cost is
  a few lines of streaming code, the win is one contract.
- **GraphQL instead of REST.** Out of scope for a single-operator local
  tool. The cost of a schema + resolvers is not earned by the surface area
  here. REST endpoints over read-only files is right-sized.
- **Direct DB layer.** Forbidden by spec §Non-goals.

## Verification

This ADR is **accepted**, which means downstream lanes treat it as a fixed
contract. `verify-done` for P1 will check:

- ADR-001 file exists at `benchmark/plans/adr-001-runner-ui-boundary.md`.
- Sections present: Context, Drivers, Options, Decision, Consequences,
  Status (this document supplies all six plus an Option scoring table and
  Alternatives considered).
- Status is `accepted` and decision is unambiguous.
- The decision is referenced by `01-architecture.md` (it is — see §3 + §6
  + §7 of that document).

## References

- `.guild/spec/benchmark-factory.md` — drivers D1–D6 trace to §Audience,
  §Constraints, §Non-goals, §Success P2, §R5.
- `.guild/plan/benchmark-factory.md` — T1-architect lane success criteria.
- `benchmark/plans/01-architecture.md` — §3 artifact table is the
  underlying data contract this ADR exposes through an API.
- `guild-plan.md §10.3` — decision routing rule (this ADR is the
  significant-architectural-decision capture for the runner ↔ UI boundary).
