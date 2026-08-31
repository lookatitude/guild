# scripts/

TypeScript/Node tooling for the Guild plugin. Owned by `tooling-engineer`
(`.guild/agents/tooling-engineer.md`). See `https://guildstack.dev/docs` for
architecture scope and how these scripts wire into the evolve + rollback pipelines.

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
  `guild:wiki-ingest` / `guild:decisions`.

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

| Script | Pipeline stage | Purpose |
|---|---|---|
| `evolve-loop.ts` | evolve | Top-level orchestration wrapper. Snapshots the live skill to `.guild/skill-versions/<slug>/v<N>/`, writes `.guild/evolve/<run-id>/pipeline.md` with the 10-step plan, stops before the promotion gate. Does NOT dispatch subagents or promote. |
| `flip-report.ts` | evolve step 6 | Reads paired grading at `.guild/evolve/<run-id>/grading.json`, computes P→F regressions + F→P fixes, pass_rate / duration / tokens aggregates. Writes `flip-report.md`. |
| `shadow-mode.ts` | evolve step 7 | Replays a proposed skill against historical traces under `.guild/runs/*/events.ndjson`, records divergence rate. Writes `shadow-report.md`. Never blocks. |
| `description-optimizer.ts` | evolve step 9 | Deterministic heuristic (NOT an LLM). Derives a ≤ 1024-char description from the skill's `should_trigger` / `should_not_trigger` evals. Emits `description: <...>` as YAML on stdout. |
| `rollback-walker.ts` | rollback | Enumerates `.guild/skill-versions/<slug>/v*/` and emits a markdown version table. With `--steps <n>`, emits a `proposed_rollback` action as YAML. NEVER mutates skill-versions. |
| `trace-summarize.ts` | telemetry | Summarizes `.guild/runs/<run-id>/events.ndjson` to `summary.md` for post-task reflection. |
| `check-docs-architecture.ts` | docs architecture | Fail-closed drift rail comparing the umbrella architecture spine with module manifests and `guild.inventory.json`. See below. |
| `docs-hygiene/check-symbol-citations.ts` | docs hygiene | **Warn-only.** Flags rotted `file:line (symbol)` citations in the reference docs. See below. |

### `check-docs-architecture.ts`

The module manifests and `guild.inventory.json` are authoritative for five
datasets published in `docs/v2/architecture/architecture-spine.html`: module
kind counts, dependency edges, reverse dependencies (fan-in), owned inventory
per module, and grand inventory totals. This checker derives all five and diffs
them against the document.

```
cd scripts
npx tsx check-docs-architecture.ts \
  [--docs <path>] [--root <plugin-root>] [--if-present] [--print]
```

`--root` selects the plugin root used to load `src/modules/*/module.manifest.json`
and `guild.inventory.json`. The document resolution order is `--docs`, then
`GUILD_UMBRELLA_DOCS`, then `<GUILD_UMBRELLA_ROOT>/docs/v2/architecture/architecture-spine.html`,
then the default `<plugin-root>/../docs/v2/architecture/architecture-spine.html`.
The default deliberately crosses one `../`: in a normal full checkout the plugin
repo sits at `<umbrella>/plugin`, while `docs/v2/` belongs to the umbrella.

The check fails closed with exit `1` for any drift, a missing or unparseable
expected table, or a missing document. `--if-present` is the narrow escape for a
plugin-only checkout: it changes only the missing-document case to `SKIP` with
exit `0`; malformed documents and real drift still fail. Use `--print` to emit
the corrected manifest-derived HTML rows and totals for pasting into the document;
it never edits the document.

### `docs-hygiene/check-symbol-citations.ts`

Line-precision doc citations rot fast: across one drift window every checked
anchor had moved while the cited **symbol** stayed put (finding F-6). This
script makes that rot visible.

```
npx tsx scripts/docs-hygiene/check-symbol-citations.ts \
  --docs-dir <docs tree> --repo-root <root> [--repo-root <root2> …] [--window N] [--quiet]
```

It scans **code spans only** — backticks in Markdown, `<code>` in HTML — because
that is where citations live; scanning prose made every "`settings.json` (JSON)."
sentence a false positive. It reports `MISSING` (symbol gone from the cited
file), `DRIFTED` (symbol exists but >`--window` lines from the anchor, default
25), and `OVERRUN` (line-only citation past EOF). Pass `--repo-root` once per
root when the docs span an umbrella and its sub-repos.

**It always exits 0 when it ran** (1 only for bad input). This is deliberate: the
drift it detects is cosmetic, so wiring it as a blocking gate would red-light CI
on every refactor that shifts a line. Run it on demand or as an advisory step.

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
