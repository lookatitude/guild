---
type: design
slug: benchmark-factory-architecture
phase: P1
spec: .guild/spec/benchmark-factory.md
plan: .guild/plan/benchmark-factory.md
adr_refs:
  - benchmark/plans/adr-001-runner-ui-boundary.md
status: accepted
owner: architect
created_at: 2026-04-26
---

# Benchmark Factory — Architecture (P1)

> **Scope of this document.** This is the multi-component design for the
> `benchmark/` subsystem across all four shipping phases (P1–P4). P1 is the
> **import-only** slice: only the components below the dotted line in §1
> physically ship in this PR. Components above the line (`runner`, `server`,
> `ui`) are sketched here so that the JSON contracts they will consume are
> locked at the boundary now — downstream phases fill in the implementations
> against the contracts this document fixes.

## 1. Component diagram

```mermaid
flowchart TD
    subgraph external [external prerequisites]
        CLAUDE_CLI["claude CLI<br/>(authenticated, on PATH)"]
        REPO[".guild/<br/>(real artifacts<br/>captured from a host repo)"]
    end

    subgraph p3p4 ["P3 / P4 — runner + ui (sketched, not built in P1)"]
        RUNNER["runner.ts<br/>(P3: shells claude CLI,<br/>captures .guild/ → runs/&lt;id&gt;/artifacts/)"]
        SERVER["server.ts<br/>(P2: HTTP API for UI;<br/>see ADR-001)"]
        UI["ui/ — React + Vite<br/>(P2: runs / detail / compare /<br/>trigger / demo views)"]
    end

    subgraph p1 ["P1 — ships in this PR"]
        CLI["cli.ts<br/>(score | compare entry)"]
        CASE_LOADER["case-loader.ts<br/>(YAML → Case, schema-validate)"]
        CASE_FILES[("benchmark/cases/*.yaml")]
        IMPORTER["artifact-importer.ts<br/>(.guild/ tree → RunRecord)"]
        SCORER["scorer.ts<br/>(6 components → guild_score)"]
        COMPARATOR["compare.ts<br/>(baseline vs. candidate)"]
        FIXTURES[("benchmark/fixtures/<br/>synthetic-{pass,fail,<br/>timeout,malformed}/")]
        RUNS[("benchmark/runs/&lt;run-id&gt;/<br/>run.json events.ndjson<br/>metrics.json score.json<br/>comparison.json artifacts/.guild/<br/>report.md")]
    end

    REPO -.->|operator copies fixture<br/>tree once for P1| FIXTURES
    CLAUDE_CLI -.->|invoked by runner in P3| RUNNER
    CASE_FILES --> CASE_LOADER
    CASE_LOADER --> CLI
    FIXTURES -->|P1 reads fixtures<br/>as if they were a captured run| IMPORTER
    RUNNER -.->|P3 produces<br/>runs/&lt;id&gt;/artifacts/.guild/<br/>and run.json + events.ndjson| RUNS
    IMPORTER --> RUNS
    IMPORTER --> SCORER
    SCORER --> RUNS
    CLI --> SCORER
    CLI --> COMPARATOR
    COMPARATOR --> RUNS
    RUNS -.->|P2 reads via<br/>server.ts (ADR-001)| SERVER
    SERVER -.-> UI
```

**Lane ownership.** `cli.ts`, `case-loader.ts`, `artifact-importer.ts`,
`scorer.ts`, `compare.ts`, the case YAML schema, and the two demo case files
are authored by **backend** in T2. **qa** owns the synthetic fixtures and the
vitest suite. **technical-writer** owns `benchmark/README.md` and
`benchmark/plans/02–06-*.md`. The `runner.ts`, `server.ts`, and `ui/` boxes
are forward references — `frontend` joins at P2 (server + ui), backend extends
itself at P3 (runner). This document is the contract those later lanes
implement against.

**Self-contained rule (spec §Constraints).** No box in the P1 subgraph imports
from root `scripts/`. Duplication of small utilities (e.g. trace
summarisation) is preferred over coupling. The benchmark factory has its own
`package.json`, its own `tsconfig.json`, and its own `node_modules/`. Backend
will enforce this with a static-import rule documented in `02-case-suite.md`.

## 2. The benchmark graph (Case → Reflection)

The spec freezes the data graph as:

```
Case → Trial Set → Run → Stage → Artifact → Metric → Score → Reflection
```

| Node          | Definition (this design)                                                                                                                                                                                                        | Producer                                                                  | Consumer                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Case**      | A YAML file under `benchmark/cases/*.yaml` fixing prompt, fixture repo, expected specialists, expected stage order, acceptance commands, scoring weights, timeout. Schema-validated on load.                                      | Operator (hand-authored); `case-loader.ts` parses + validates.            | `cli.ts` (resolves which case to score / compare against).              |
| **Trial Set** | A logical group of Runs over the same Case. Identified by directory convention `runs/<case-slug>-<plugin_ref>-<model_ref_hash>/` and surfaced via the comparator (`baseline` and `candidate` are each Trial Sets).                | Operator (chooses what to lump together); `compare.ts` reads.             | `compare.ts` (diffs two sets); P2 UI `compare view`.                    |
| **Run**       | One execution. P1 = synthetic / imported only. P3 = real `claude` invocation. Identified by `run-id`. State lives at `runs/<run-id>/run.json`.                                                                                    | P1: `artifact-importer.ts` (synthesises from fixture tree). P3: `runner.ts`. | `scorer.ts`; P2 UI `run detail view`.                                   |
| **Stage**     | A Guild lifecycle stage entry: `brainstorm / team-compose / plan / context-assemble / execute / review / verify / reflect`. Persisted as records in `events.ndjson` (one line per stage transition + per dispatched specialist).   | `artifact-importer.ts` (parses captured `.guild/` tree).                  | `scorer.ts` (`delegation`, `gates`, `loop_response` components).         |
| **Artifact**  | Any file produced by a Guild run inside `runs/<run-id>/artifacts/.guild/` — receipts, plans, context bundles, wiki edits, decisions. Captured verbatim; never re-interpreted.                                                     | P1: copied from fixture by importer. P3: `runner.ts` rsyncs from host repo. | `scorer.ts` (`evidence` component reads receipts; other components cite). |
| **Metric**    | A derived numeric measurement written to `metrics.json` (e.g. wall-clock, gate-pass count, dispatched-vs-expected specialist count). **Derived only from artifacts** — never from unsupported claims. One file per Run.            | `scorer.ts` (computes from `RunRecord`).                                  | `scorer.ts` (consumed by 6 component formulas); P2 UI `run detail`.     |
| **Score**     | The 6 components (`outcome 30 · delegation 20 · gates 20 · evidence 15 · loop_response 10 · efficiency 5`) plus the aggregated `guild_score ∈ [0, 100]`. Persisted to `score.json`. Each component carries its weight + raw subscore. | `scorer.ts`.                                                              | `compare.ts`; P2 UI `runs table`, `run detail`, `compare view`.         |
| **Reflection**| The `guild:reflect` proposal — what the plugin should change to do better next time. P4 will execute baseline + candidate around an applied reflection to test keep/discard.                                                       | Captured artifact (P3+); `report.md` summarises.                          | P4 learning-loop validation; documented in `plans/06-learning-loop.md`. |

## 3. Data-flow walkthrough — every artifact under `benchmark/runs/<run-id>/`

Every file in a run directory has exactly one producer and a small set of
consumers. Backend's contracts in T2 must match this table; downstream phases
extend it but do not violate it.

| Artifact path                              | Producer (lane / phase)                              | Consumer(s)                                                                                                | P1?  | Notes                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.json`                                 | P1: `artifact-importer.ts` (backend). P3: `runner.ts` (backend). | `scorer.ts`, `compare.ts`, P2 `server.ts`, P2 UI `runs table` + `run detail`.                              | P1   | Holds: `run_id`, `case_slug`, `plugin_ref` (git commit), per-specialist `model_ref` map, `started_at`, `completed_at`, `status` (`pass` / `fail` / `timeout` / `errored`), `raw_command`. **Determinism** filter key. |
| `events.ndjson`                            | P1: `artifact-importer.ts`. P3: `runner.ts` (streams).            | `scorer.ts` (delegation + gates + loop_response); P2 UI `run detail` (stage graph).                       | P1   | One JSON object per line. Stage transitions, dispatched specialists, gate results. Append-only.                                                                                       |
| `metrics.json`                             | `scorer.ts` (backend).                                            | `scorer.ts` (the 6 component formulas read derived metrics from here); P2 UI `run detail` (metric breakdown). | P1   | Pure function of the captured artifacts. Never carries a value not derivable from `events.ndjson` + `artifacts/.guild/`.                                                              |
| `score.json`                               | `scorer.ts` (backend).                                            | `compare.ts`; P2 UI `runs table` + `run detail` + `compare view`.                                          | P1   | 6 components × `{ weight, raw_subscore, weighted }` + `guild_score`. Schema documented in `04-metrics.md` (T4-technical-writer).                                                       |
| `comparison.json`                          | `compare.ts` (backend).                                           | P2 UI `compare view`. CLI prints summary to stdout.                                                        | P1   | Per-component delta + per-run pass/fail/timeout breakdown. Lives **at the trial-set level**, not the per-run level — by convention written to `runs/_compare/<baseline>__<candidate>.json` (backend confirms exact path in T2). |
| `artifacts/.guild/...`                     | P1: copied from `benchmark/fixtures/` by importer. P3: rsync from host repo by `runner.ts`. | `artifact-importer.ts` (parses → `RunRecord`); P2 UI `run detail` (raw failures).                          | P1   | Verbatim subset of the host repo's `.guild/` after the run. Used as the source of truth for every metric.                                                                              |
| `report.md`                                | `runner.ts` (P3) — Markdown rendered from `score.json` + `events.ndjson`. | Operator (reads). P2 UI `demo view` (renders). Public website (deferred — same source).                    | P3   | **Forward-reference contract.** P1 does not produce this file; the importer leaves it absent. The Markdown shape is sketched in `04-metrics.md` so backend can match it later.         |

**Determinism gate (spec §Constraints).** Every `run.json` carries
`plugin_ref` + per-specialist `model_ref`. `compare.ts` filters on identical
refs across baseline and candidate; runs with mismatched refs are surfaced as
**excluded** in `comparison.json` rather than silently scored together.
Historical runs are never re-scored — bumping weights produces *new* runs at
*new* `<run-id>`s, leaving the original `score.json` untouched.

**Trial-set directory convention.**
`benchmark/runs/<case-slug>-<plugin_ref_short>-<model_ref_hash>-<n>/` per run,
where `<n>` distinguishes repetitions. The comparator groups by everything
left of the trailing `-<n>`. Backend may refine the exact pattern in T2; the
*shape* (case + plugin + model in the name) is locked here.

## 4. Failure modes (and where each is contained)

These five risks come from the spec's risk register (§Risks & rollback). Each
maps to a specific component in §1 — no risk is left without a containment
locus. Backend implements the listed enforcement; qa writes the test that
proves it.

### R1 — Scoring drift (weights miscalibrated)

- **What goes wrong.** Component weights drift over time, `guild_score`
  rewards theatre over substance, baseline → candidate comparisons become
  meaningless because the rubric changed.
- **Locus.** `scorer.ts` + the per-Case `scoring_weights:` block in the case
  YAML. Weights live with the Case, not the scorer; they are versioned with
  the case file.
- **Containment.** (i) Weights are loaded *from the Case*, never hard-coded
  in `scorer.ts`. (ii) `score.json` records the weight that was applied, so
  any later audit can detect rubric changes. (iii) Bumping weights produces
  new runs at new run-ids; old `score.json` files are immutable. (iv)
  qa's property-based test (T3) asserts `Σ(component.weight × subscore) =
  guild_score` for any weight set, which makes a mis-applied weight loud.
- **Recovery.** Revert the Case YAML; re-execute (do not re-score) any runs
  the operator wants to re-bench under the old rubric.

### R2 — Model / plugin churn (drifting baselines)

- **What goes wrong.** Operator compares a baseline run captured against
  plugin commit A + Sonnet to a candidate against plugin commit B + Opus,
  attributes the score delta to plugin changes when it is really a model
  change.
- **Locus.** `run.json` (`plugin_ref`, per-specialist `model_ref`) +
  `compare.ts` (filter on identical refs).
- **Containment.** (i) `run.json` carries `plugin_ref` + per-specialist
  `model_ref` — both are mandatory fields in the schema, importer rejects a
  fixture missing either. (ii) `comparison.json` lists `excluded_runs` for
  any run whose refs do not match the comparison set. (iii) `compare.ts`
  refuses to emit a `guild_score` delta if the included-run count is zero on
  either side; instead it emits `status: "no_comparable_runs"`. (iv)
  `04-metrics.md` (T4) documents the filter rule for operators.
- **Recovery.** Re-execute under the desired ref combination; never patch
  historical `run.json` to "fix" a ref.

### R3 — 1h timeout hides slow regressions

- **What goes wrong.** A regression triples wall-clock time but stays under
  the 1h cap; it does not register as a failure even though the system is
  meaningfully slower.
- **Locus.** Runner status enum (`run.json.status`) + `efficiency` component
  in `scorer.ts` + (P2) trend view in the UI.
- **Containment.** (i) `status` is a first-class enum: `pass` / `fail` /
  `timeout` / `errored`. (ii) **Timeouts score 0 on `outcome`** (spec §NFR).
  (iii) `efficiency` (weight 5) is a function of wall-clock against a
  per-Case budget declared in the Case YAML, **not** of the global 1h cap —
  so a regression that doubles time but stays under 1h still loses
  `efficiency` points. (iv) P2 UI must surface a timeout-rate trend chart;
  this design pre-locks the contract by guaranteeing `run.json.status` is
  available and `metrics.json` carries `wall_clock_ms` and
  `wall_clock_budget_ms`.
- **Recovery.** Lower the per-Case budget in the Case YAML; new runs lose
  efficiency points, regression becomes visible without changing the cap.

### R4 — Synthetic-fixture drift

- **What goes wrong.** `benchmark/fixtures/synthetic-*/.guild/` directory
  shapes diverge from real `.guild/` artifacts produced by an actual `/guild`
  run. P1 tests pass against fixtures, P3 falls over against real data.
- **Locus.** `artifact-importer.ts` schema validator + qa's
  fixture-vs-real conformance test (T3 success criterion).
- **Containment.** (i) `artifact-importer.ts` validates **every input
  directory** — fixture or real — against a single shared schema. (ii) qa's
  T3 suite includes a conformance test that imports one real
  `.guild/runs/<id>/` from this repo's working copy and asserts it conforms
  to the same schema; failure messages enumerate divergent fields. (iii) The
  schema is owned by `artifact-importer.ts` (single source of truth) — qa
  reads it, does not duplicate it.
- **Recovery.** When `.guild/` shape evolves, update the importer schema in
  one place; qa's conformance test catches whichever fixtures lag.

### R5 — Frontend specialist gap (P1 boundary contract)

- **What goes wrong.** No Guild specialist covers React / UI engineering at
  P1, so the P2 UI lane has no committed contract to consume — frontend
  arrives at P2 and discovers the runner output shape is ambiguous, blocks.
- **Locus.** ADR-001 (this design's adjunct) — locks the **runner ↔ UI
  boundary** as a stable JSON contract owned by P1.
- **Containment.** (i) ADR-001 picks server-JSON-API vs.
  on-demand-filesystem-reads and freezes the choice at `status: accepted`
  before P2 starts. (ii) The artifact table in §3 is the *contract* the UI
  consumes — every field a UI surface needs is named, with its producer.
  (iii) The deferred public website consumes the same JSON shape (spec
  §Non-goals); ADR-001's Consequences section calls this out so the chosen
  option works for both consumers.
- **Recovery.** P1 → P2 handoff is the failure point. If the contract turns
  out to be wrong, ADR-002 supersedes ADR-001 in P2; existing runs are not
  re-scored, only re-rendered.

### Cross-cutting: missing / partial artifact (component zeroing)

The spec brief named "missing artifact" and "score-component zeroing" as a
failure mode. Treatment:

- **Missing artifact** (e.g. a captured run with no `events.ndjson`) →
  `artifact-importer.ts` records a `partial: true` flag on the `RunRecord`,
  with `missing_artifacts: [...]` listing what was absent.
- **Score-component zeroing** → any component whose source artifact is missing
  scores `raw_subscore = 0`, contributes `0 × weight` to `guild_score`, and
  carries `reason: "missing_artifact"` in `score.json` so the UI can render
  the zero with context (not just as a numeric loss).
- **Neither path silently absorbs the gap.** Both surface in `score.json`
  and propagate to `comparison.json` for visibility in P2's compare view.

## 5. Non-functional requirements

These are the constraints `verify-done` will check P1 against. Backend in T2
implements; qa in T3 tests; technical-writer in T4 documents.

| NFR                                                                                  | Source                              | How this design satisfies it                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1-hour wall-clock cap per run.** Timeouts are first-class status (not errors).     | spec §Constraints, §NFR             | `run.json.status` enum carries `timeout`. `outcome` component scores 0 on timeout. P2 trend view will surface timeout-rate (contract locked here). P1 tests cover the timeout-status fixture (`synthetic-timeout/`).                                                   |
| **Single local operator. No multi-user UI. No auth.**                                | spec §Audience, §Non-goals          | No server in P1. P2 `server.ts` (per ADR-001) binds to `localhost` only, no auth layer. No shared state, no concurrent-write contention to design around.                                                                                                              |
| **Filesystem only — JSON / NDJSON / Markdown. No DB.**                               | spec §Non-goals, §Constraints       | Every artifact in §3 is a file. No process holds long-lived state across CLI invocations. P2 server is a thin read layer over the filesystem (per ADR-001 decision); it does **not** introduce a DB or cache that could go stale.                                       |
| **No network outside `claude` CLI.**                                                 | spec §Constraints                   | P1 has no network surface — the importer reads local files only. P3 `runner.ts` shells out to a single binary on `$PATH` (`claude`) and does not open sockets itself. P2 `server.ts` binds `127.0.0.1`. The importer must reject fixtures containing remote URLs in receipts (qa flags as a test case). |
| **Self-contained from root `scripts/` — duplication preferred over coupling.**       | spec §Non-goals, §Constraints       | `benchmark/` is its own npm project (`package.json`, `tsconfig.json`, `node_modules/`). No `import` or `require` paths cross out of `benchmark/`. Backend will document this rule in `02-case-suite.md`; qa will add a static-import lint to the vitest suite.        |
| **Determinism — runs annotated with `plugin_ref` + per-specialist `model_ref`.**     | spec §Constraints, §Success P3      | Even though P3 wires the live capture, the *schema* for `run.json` is locked here: both fields are mandatory in the importer's schema in P1. Synthetic fixtures must carry valid placeholder refs; the comparator filter rule is built against these from day one.    |
| **Public website deferred — same JSON contract serves it later.**                    | spec §Non-goals                     | ADR-001's Consequences explicitly addresses the deferred-website consumer. The artifact table in §3 is the contract; whoever later authors `website/` reads the same `score.json` + `comparison.json` files.                                                          |
| **No `claude` CLI invocation in P1; no CI execution of `claude` ever.**              | spec §Autonomy policy, §Non-goals   | P1 components in §1 do not depend on `claude` being installed. P3 `runner.ts` is the only path that shells out, and qa's autonomy policy forbids tests from invoking it.                                                                                              |

## 6. Open questions and follow-ups (routed to other lanes)

- **Comparator's exact output path.** §3 sketches
  `runs/_compare/<baseline>__<candidate>.json`. Final path is backend's call
  in T2; this document only requires that the path be **deterministic** and
  **documented in `04-metrics.md`** so the P2 UI can locate it. → backend
  (T2), technical-writer (T4).
- **Trial-set grouping rule.** §3 fixes the *shape* of the run-id directory
  (`<case-slug>-<plugin_ref>-<model_ref_hash>-<n>`). The exact length of
  `<plugin_ref_short>` and the hash function for `<model_ref_hash>` are
  backend's call. → backend (T2).
- **Schema versioning for case YAML.** Spec asks weights to be versioned but
  does not pin a schema-version field. Recommend adding
  `schema_version: 1` at the top of every case YAML so future breaking
  changes are detectable. → backend (T2) to implement; technical-writer (T4)
  to document in `02-case-suite.md`.
- **Reflection capture path (P4 forward-reference).** `report.md` shape is
  sketched in §3 but the *reflection-applied* metadata that P4 needs (which
  reflection was applied between baseline and candidate?) is not yet
  designed. Flag for the P4 plan; not blocking P1. → architect (P4).
- **No visual / UX design specialist on the Guild roster.** §1 names UI
  surfaces in the abstract; visual decisions (layout, colour, interaction
  model) are out of scope for architect. Will need to be either covered by
  `frontend` at P2 with explicit scope cap or flagged as a roster gap. →
  main session (followup), `frontend` lane at P2.

## 7. Cross-references

- **Spec.** `.guild/spec/benchmark-factory.md` — full goal / non-goals /
  constraints / risks. This document is the multi-component design that
  satisfies §Success P1 + lands the contracts §Success P2–P4 will consume.
- **Plan.** `.guild/plan/benchmark-factory.md` — P1 lane decomposition,
  DAG, and per-lane success criteria.
- **ADR.** `benchmark/plans/adr-001-runner-ui-boundary.md` — locks the JSON
  contract the P2 UI consumes (and the deferred public website later).
- **Karpathy autoresearch pattern.** `karpathy/autoresearch program.md` —
  source pattern: fixed cases · repeated runs · raw logs · one comparable
  primary score · keep/discard learning loops. The benchmark factory is this
  pattern applied to Guild itself.
- **Guild plan §10.3 (decision routing).** Any medium-significance question
  raised while implementing this design must be captured as an ADR-lite
  under `.guild/wiki/decisions/`, not silently embedded.
