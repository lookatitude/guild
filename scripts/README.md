# scripts/

TypeScript/Node tooling for the Guild plugin. Owned by `tooling-engineer`
(`.claude/agents/tooling-engineer.md`). See `guild-plan.md §13.3` for scope
and §11.2 / §11.3 for how these scripts wire into the evolve + rollback
pipelines.

All scripts use the `tsx` loader (`#!/usr/bin/env -S npx tsx`) and depend
only on Node stdlib plus test-only devDependencies from `scripts/package.json`.

## Shared CLI convention

Every script under `scripts/` follows the same contract. Follow it when adding
new scripts.

### Flags

| Flag | Type | Notes |
|---|---|---|
| `--run-id <id>` | string | Identifier for the run context (evolve run, telemetry run, etc.). Required wherever a run-scoped artifact is read or written. |
| `--cwd <path>` | string | Repo root. Defaults to `.`. All `.guild/` paths are resolved relative to this. |
| `--out <path>` | string | Optional explicit output path. Overrides the domain default. |
| `--skill <slug>` | string | Skill slug (e.g. `guild-brainstorm`). Required for skill-scoped scripts. |

If a required flag is missing, the script exits `1` and logs a diagnostic to
stderr. Do not accept positional arguments.

### Output layout

- Default destination: `.guild/<domain>/<run-id>/<name>.md`
  (e.g. `.guild/evolve/<run-id>/flip-report.md`,
  `.guild/runs/<run-id>/summary.md`).
- Skill version snapshots live under `.guild/skill-versions/<slug>/v<N>/`.
- Scripts that only emit structured data (no file writes) write it to **stdout**.
- Scripts never write to `.guild/wiki/` — memory writes go through
  `guild:wiki-ingest` / `guild:decisions` per `guild-plan.md §10.5.1`.

### Stdout vs stderr

- **stdout** — structured data only (JSON, YAML, or markdown table). Pipe-able.
- **stderr** — human-readable diagnostics, warnings, and status messages.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Bad input (missing flag, file not found, malformed JSON, invalid range). |
| `2` | Internal error (unexpected filesystem failure, unhandled exception). |

Shadow-mode always exits `0` — it is diagnostic and never blocks the pipeline.

### Determinism

Scripts must produce deterministic output given the same inputs. Timestamps
are the exception — `evolve-loop.ts` stamps `created_at` from `Date.now()` in
its snapshot meta. Tests should assert on structure, not timestamps.

## Scripts in this directory

| Script | Plan anchor | Purpose |
|---|---|---|
| `evolve-loop.ts` | §11.2 | Top-level orchestration wrapper. Snapshots the live skill to `.guild/skill-versions/<slug>/v<N>/`, writes `.guild/evolve/<run-id>/pipeline.md` with the 10-step plan, stops before the promotion gate. Does NOT dispatch subagents or promote. |
| `flip-report.ts` | §11.2 step 6 | Reads paired grading at `.guild/evolve/<run-id>/grading.json`, computes P→F regressions + F→P fixes, pass_rate / duration / tokens aggregates. Writes `flip-report.md`. |
| `shadow-mode.ts` | §11.2 step 7 | Replays a proposed skill against historical traces under `.guild/runs/*/events.ndjson`, records divergence rate. Writes `shadow-report.md`. Never blocks. |
| `description-optimizer.ts` | §11.2 step 9 | Deterministic heuristic (NOT an LLM). Derives a ≤ 1024-char description from the skill's `should_trigger` / `should_not_trigger` evals. Emits `description: <...>` as YAML on stdout. |
| `rollback-walker.ts` | §11.3 | Enumerates `.guild/skill-versions/<slug>/v*/` and emits a markdown version table. With `--steps <n>`, emits a `proposed_rollback` action as YAML. NEVER mutates skill-versions. |
| `trace-summarize.ts` | P5 | Summarizes `.guild/runs/<run-id>/events.ndjson` to `summary.md` for post-task reflection. |

## Testing

Tests live under `scripts/__tests__/` and run via Jest:

```
cd scripts && npx jest --no-coverage --silent
```

Fixtures live under `scripts/fixtures/`. Add a fixture per edge case you care
about — tests should copy from `fixtures/` into a tmpdir rather than mutating
the fixtures in place.

## Security

- No network IO. All scripts are local filesystem + stdio only.
- No shell-out to arbitrary binaries. `evolve-loop.ts` emits command-line
  strings in `pipeline.md` for the orchestrator to run; it does not invoke
  `child_process.exec`.
- No dependencies beyond Node stdlib at runtime. Test-only devDeps are listed
  in `scripts/package.json`.
