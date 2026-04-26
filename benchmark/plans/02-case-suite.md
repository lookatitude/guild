# Case suite — schema, demos, authoring

A **Case** is the unit of benchmark input. It fixes the prompt, the fixture repo to run inside, the specialists and stage order the run is expected to produce, the acceptance commands that decide whether the work was actually done, the per-component scoring weights, and the wall-clock budget. Case files live under `benchmark/cases/*.yaml` and are loaded and schema-validated by `case-loader.ts` (Case-node definition: `01-architecture.md §2`). Backend authors the schema and the two demo cases in T2; this document is the operator-facing reference.

## Where Cases sit in the data graph

The spec freezes the graph as `Case → Trial Set → Run → Stage → Artifact → Metric → Score → Reflection`. The Case is the root: every Run is captured against exactly one Case, and a Trial Set is the group of Runs over the same Case at the same `plugin_ref + model_ref`. Per-node producer / consumer roles are tabulated in `01-architecture.md §2`; this file documents the Case row only.

## Self-contained rule (R/W constraint on case authors)

`benchmark/` is self-contained. Cases must not reference paths or scripts outside `benchmark/` (spec §Non-goals; `01-architecture.md §1` self-contained rule). A case's `fixture_path` is always relative to `benchmark/fixtures/`. A case's `acceptance_commands` run inside the fixture's working directory. Backend's static-import lint enforces this at the source level; case YAMLs honour the same boundary.

## Schema — field-by-field

Each Case file is YAML and validates against the schema declared in `case-loader.ts`. The fields below are the canonical contract; default values are noted explicitly so an authoring operator can leave them off.

| Field                  | Type                          | Required | Default     | Description                                                                                                                                                                                     |
| ---------------------- | ----------------------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`       | integer                       | yes      | `1`         | Schema version. Bumping this is a breaking change to the case file format. Recommended by architect (`01-architecture.md §6`) so future format changes are detectable. Backend pins exact value in T2. |
| `slug`                 | string (kebab-case)           | yes      | —           | Stable identifier for the case. Becomes the prefix of every Run directory name (see `01-architecture.md §3` trial-set directory convention).                                                    |
| `description`          | string                        | yes      | —           | One-paragraph operator-facing description of what the case exercises.                                                                                                                           |
| `prompt`               | string (block scalar)         | yes      | —           | The literal prompt the runner will pass to `claude` in P3. In P1 (import-only) the prompt is informational — it's recorded into `run.json.raw_command` for traceability.                        |
| `fixture_path`         | string                        | yes      | —           | Relative path under `benchmark/fixtures/` containing the working repo the run executes inside. Importer reads `<fixture_path>/.guild/` as the captured Run artifacts in P1.                     |
| `expected_specialists` | array<string>                 | yes      | —           | The set of specialists the run is expected to dispatch. Drives the `delegation` component (`04-metrics.md`).                                                                                    |
| `expected_stage_order` | array<string>                 | yes      | —           | The Guild lifecycle stages, in expected order. Drives the `gates` component. Stage names match the §2 `Stage` row in `01-architecture.md`.                                                      |
| `acceptance_commands`  | array<string>                 | yes      | —           | Shell commands run inside the captured working directory after a Run. Pass = exit 0. Drives the `outcome` component (timeout → 0 per R3; see `01-architecture.md §4 R3`).                       |
| `scoring_weights`      | object<string, number>        | no       | spec defaults | Per-Case override of component weights (`outcome 30 · delegation 20 · gates 20 · evidence 15 · loop_response 10 · efficiency 5`). Versioned with the case file (R1; `01-architecture.md §4 R1`). |
| `wall_clock_budget_ms` | integer                       | no       | —           | Per-Case wall-clock budget for `efficiency`. Drift detection (R3) without changing the global 1h cap. Lower this in the YAML to make a slow regression visible.                                |
| `timeout_ms`           | integer                       | no       | `3_600_000` | Hard wall-clock cap. Defaults to 1 hour per spec §Constraints. Runner emits `run.json.status: "timeout"` and scores 0 on `outcome` if exceeded (`01-architecture.md §4 R3`).                    |

Two notes the schema cannot enforce by itself but cases must obey:

- **`expected_stage_order`** must be a subset (in order) of the lifecycle stages catalogued in `01-architecture.md §2` Stage row. Cases that name a stage Guild does not emit will fail the `gates` invariant when scored.
- **`acceptance_commands`** must be deterministic — same fixture, same captured artifacts ⇒ same exit code. Non-determinism in the acceptance step shows up as score noise and is not the scorer's responsibility to absorb.

### Versioning the weights (R1 mitigation)

Bumping `scoring_weights:` is a versioned change. Per `01-architecture.md §4 R1`:

1. Weights live with the Case YAML, never hard-coded in `scorer.ts`.
2. `score.json` records the weight that was applied, so any later audit can detect rubric changes.
3. Bumping weights produces **new** runs at **new** run-ids; old `score.json` files are immutable.
4. Recovery from a bad weight bump is to revert the Case YAML and re-execute (do **not** re-score historical runs against the new weights).

## Two shipping demo cases

Both case YAMLs are authored by backend in T2. They cover the two end-to-end Guild flows v1 must benchmark (spec §Success P3).

### `demo-url-shortener-build`

- **Purpose.** Exercises a clean *build* path — a non-trivial multi-component implementation task that should produce a working URL shortener inside the fixture repo. Validates that Guild's plan / context-assemble / execute / verify pipeline lands a real, runnable artifact.
- **Expected specialists.** A typical multi-component build — backend for the API, qa for the test suite, technical-writer for the README. Exact list pinned in the YAML.
- **Acceptance commands.** Run the suite generated inside the fixture, assert the public endpoint contract responds correctly. Pin those in the YAML.

### `demo-context-drift-evolve`

- **Purpose.** Exercises the *evolve* path — drives `guild:reflect` to surface a context-drift symptom, then validates that the proposed plugin change improves the score on the next run. This is the case the P4 learning-loop validation will use as its baseline / candidate harness (see `06-learning-loop.md`).
- **Expected specialists.** Includes `guild:reflect` in the lifecycle. The `loop_response` component (weight 10) is the discriminating signal.
- **Acceptance commands.** Reflection-aware — assert that a captured reflection artifact exists and that its proposal text references context-assembly.

## Authoring a new case — worked example

Below is a hypothetical third case, `demo-flaky-test-quarantine`, sized to exercise qa's quarantine flow. Operators creating their own cases can use this as a template; backend's case-loader will reject anything that fails schema validation.

```yaml
schema_version: 1
slug: demo-flaky-test-quarantine
description: |
  Drive Guild through diagnosing a flaky test in the fixture repo and producing
  a quarantine PR. Validates that qa is dispatched, that gates fire in order,
  and that the receipt evidences a concrete root-cause hypothesis.
prompt: |
  The test suite under fixture/ has one intermittent failure. Diagnose the root
  cause, propose a quarantine, and produce a PR description that names the
  failure mode and the next investigation step.
fixture_path: synthetic-flaky-suite
expected_specialists:
  - qa
  - backend
expected_stage_order:
  - brainstorm
  - team-compose
  - plan
  - context-assemble
  - execute
  - review
  - verify
  - reflect
acceptance_commands:
  - test -f .guild/runs/$(ls .guild/runs/ | tail -1)/handoffs/qa.md
  - grep -q "root.cause" .guild/runs/$(ls .guild/runs/ | tail -1)/handoffs/qa.md
scoring_weights:
  outcome: 25
  delegation: 25
  gates: 20
  evidence: 15
  loop_response: 10
  efficiency: 5
wall_clock_budget_ms: 900000
timeout_ms: 3600000
```

When choosing values:

- **`expected_specialists`** — list only specialists the case genuinely needs. Listing a specialist that should not be dispatched costs `delegation` points unfairly; underlisting hides regressions.
- **`expected_stage_order`** — match the lifecycle order in `01-architecture.md §2`. Cases that skip stages (e.g. omit `reflect`) must be explicit; the `gates` component does not infer.
- **`acceptance_commands`** — cheap, deterministic, side-effect-free. Read artifacts; do not mutate the fixture. Exit 0 = pass; non-zero = fail; timeout = `run.json.status: "timeout"` per R3.
- **`scoring_weights`** — bump only when the Case genuinely emphasizes a component differently. Weight changes are versioned (R1).
- **`wall_clock_budget_ms`** — tight enough that a 2× regression loses `efficiency` points without tripping `timeout_ms`. Per `01-architecture.md §4 R3`, this is how you make slow regressions visible without changing the global 1h cap.

## Comparator output path and run-directory pattern

Both pins below were confirmed by backend in P1 T2 (see `.guild/runs/run-2026-04-26-benchmark-factory-p1/handoffs/T2-backend.md §Decisions made`) and re-confirmed by backend in P2 T2 (see `.guild/runs/run-2026-04-26-benchmark-factory-p2/handoffs/T2-backend.md §Decisions made`). They close the architect's `01-architecture.md §6` open question.

### Comparator output path

```
benchmark/runs/_compare/<baseline>__<candidate>.json
```

The `_compare/` prefix sits well outside the `<case-slug>-…-<n>` run-id namespace, so the comparator's `collectRunsForSet` skip-rule (`entry.name === "_compare"`) is unambiguous (P1 T2 §Decisions made). The CLI's `compare` subcommand writes the artifact by default; the P2 server explicitly opts out via `compareSets({ ..., write: false })` so a GET against `/api/comparisons/:baseline/:candidate` never churns disk artifacts (P2 T2 §Decisions made). `--output <path>` overrides the default for ad-hoc placements.

### Run-directory name pattern

```
<case-slug>-<plugin_ref_short>-<model_ref_hash>-<n>
```

Sub-format (P1 T2 §Decisions made):

- `<case-slug>` — the Case YAML's `slug` field, kebab-case.
- `<plugin_ref_short>` — first 7 characters of the plugin commit SHA.
- `<model_ref_hash>` — `h` + 4 hex characters derived from the JSON-stringified, sorted `model_ref` map. The operator computes this in P1; P3's runner generates it automatically.
- `<n>` — 1-indexed repetition counter.

The shape is human-readable (an operator can spot case + plugin + repetition at a glance from `ls runs/`) and the comparator's `entry.name.startsWith(\`${setId}-\`)` set-grouping rule trivially recovers the trial set without a separate index. The P1 importer accepts whatever `--run-id` the operator passes — the importer does not re-derive the slug — so any case-authoring workflow that violates the pattern silently breaks comparator grouping. Cases that ship in this repo are validated against this pattern by qa fixtures (`benchmark/tests/`).

### Server hostname and port

The P2 read-server (P2 T2 §Decisions made) binds `127.0.0.1` only on a default port `3055`, overrideable via `BENCHMARK_PORT` env var or `--port <n>` flag. The CLI rejects out-of-range ports with a usage error. Cases do not need to know this — the server reads runs and cases from disk — but operators authoring cases against a running server inspect `127.0.0.1:3055/api/cases` to confirm a new case YAML loads.

## Cross-references

- `01-architecture.md §2` — Case node definition and the full graph.
- `01-architecture.md §3` — every artifact a Run produces, mapped to producer + consumer.
- `01-architecture.md §4 R1` — weights miscalibration and how versioned weights mitigate it.
- `01-architecture.md §4 R2` — `plugin_ref + model_ref` filter that comparator applies across Trial Sets.
- `01-architecture.md §6` — open questions that affect this file (schema versioning; trial-set name format).
- `.guild/spec/benchmark-factory.md §Constraints` — 1h timeout, determinism policy, model resolution.
