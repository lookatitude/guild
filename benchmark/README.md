# Benchmark Factory

A self-contained `benchmark/` subproject that scores Guild lifecycle runs against fixed cases following the karpathy/autoresearch pattern (fixed cases · repeated runs · raw logs · one comparable primary score · keep/discard learning loops). The factory is a local operator tool — there is no public website in v1, and no automated continuous benchmarking. See `.guild/spec/benchmark-factory.md §Goal & outcome` for the full intent.

## Status

This README ships with **P4 — benchmark factory v1 complete**. P1 + P2 + P3 shipped previously; P4 lands the learning-loop validation, the reflection-applied comparison annotation, and the optional `auth_identity_hash` schema field.

| Phase | Status      | What it covers                                                                                  |
| ----- | ----------- | ----------------------------------------------------------------------------------------------- |
| P1    | shipped     | TS scaffolding, case-loader, artifact-importer, scorer, comparator, CLI `score` and `compare`.  |
| P2    | shipped     | Local React UI under `benchmark/ui/`, `npm run benchmark -- serve` HTTP server (6 routes per ADR-001). |
| P3    | shipped     | Live `claude` CLI runner; 1h cap; fresh-fixture clone (ADR-003); process-group escalation (ADR-004); 16 security mitigations. |
| P4    | this PR     | **benchmark factory v1 complete** — learning-loop validation; reflection-applied comparison annotation; `auth_identity_hash` schema field. |

The architecture for all four phases is fixed in `plans/01-architecture.md §1`; the runner ↔ UI JSON contract is locked in `plans/adr-001-runner-ui-boundary.md`; the P3 runner subprocess + capture contract is `plans/p3-runner-architecture.md` with cwd model in `plans/adr-003-host-repo-vs-fresh-fixture.md` and signal escalation in `plans/adr-004-runner-process-group-signaling.md`; the P3 threat model is `plans/security-review.md`. The P4 learning-loop architecture is `plans/p4-learning-loop-architecture.md`, the orchestrator-pattern decision is `plans/adr-005-learning-loop-orchestrator.md`, the P4 threat model is `plans/security-review-p4.md`, and the operator-facing reference is `plans/06-learning-loop.md`.

## Prerequisites

- **Node ≥ 20.** TypeScript on Node with the `tsx` runner and `vitest` for tests, matching existing Guild conventions (spec §Constraints).
- **`claude` CLI authenticated and on `$PATH`.** Required for **Mode 2 live runs** (P3). Verify with `which claude` before opting in via `GUILD_BENCHMARK_LIVE=1`. **Not required for Mode 1 import-only** — the importer reads pre-existing `.guild/` artifacts and never invokes `claude`.

## Install

```
cd benchmark
npm install
```

`benchmark/` is a fully self-contained subproject (own `package.json`, own `tsconfig.json`, own `node_modules/`). It does **not** import from the repo's root `scripts/`; duplication of small utilities is preferred over coupling (spec §Non-goals; `plans/01-architecture.md §1` self-contained rule).

## CLI

The subcommands shipping today (P1 + P2 + P3 + P4):

```
npm run benchmark -- score   --run-id <id>
npm run benchmark -- compare --baseline <set> --candidate <set>
npm run benchmark -- serve   [--port <n>]
npm run benchmark -- run     --case <slug> [--run-id <id>] [--dry-run] [--cleanup] [--runs-dir <p>] [--cases-dir <p>]
npm run benchmark -- loop    --start    --case <slug> [--baseline-run-id <id>] [--dry-run]
npm run benchmark -- loop    --continue --baseline-run-id <id> --apply <proposal-id> [--dry-run]
npm run benchmark -- loop    --status   --baseline-run-id <id>
```

| Subcommand | What it does | Output |
| ---------- | ------------ | ------ |
| `score`    | Loads a captured (or fixture) `.guild/` tree as a `RunRecord` via `artifact-importer.ts`, computes the six scoring components, writes `score.json`. | `benchmark/runs/<run-id>/score.json` |
| `compare`  | Reads two trial sets, filters on identical `plugin_ref + model_ref` (R2 mitigation; see `plans/01-architecture.md §3` determinism gate), emits per-component deltas plus a per-run pass/fail/timeout breakdown. Logs `compare: skipping <run-id> — no score.json` to stderr for any run with `run.json` but no `score.json`. | `benchmark/runs/_compare/<baseline>__<candidate>.json` |
| `serve`    | Boots HTTP server at `127.0.0.1:3055` (override with `BENCHMARK_PORT` env or `--port <n>`). Exposes the 6 routes ADR-001 §Decision §1 locks; if `benchmark/ui/dist/` exists, also serves the production build of the React app on the same port. `POST /api/runs` is now live and returns `202 Accepted` + `Location` (P3); a second concurrent run returns `409 Conflict` (single-flight). | stdout request log: `<METHOD> <PATH> <STATUS> <DURATION_MS>ms` per request |
| `run`      | **Available (P3) — Mode 2 live runner.** Spawns `claude` against a fresh fixture clone per `plans/p3-runner-architecture.md §2/§3` and `plans/adr-003`. Default-safe: prints the resolved plan and exits 0 unless `GUILD_BENCHMARK_LIVE=1` is set. `--dry-run` is the operator's pre-flight verification path (always plan-only; never spawns). Exit codes per `plans/03-runner.md §"Status mapping"`: `0=pass`, `1=fail`, `124=timeout`, `2=errored`. | `benchmark/runs/<run-id>/{run.json, events.ndjson, metrics.json, score.json, artifacts/.guild/, _subprocess.{stdout,stderr}.log}` |
| `loop`     | **Available (P4).** Two-stage learning-loop orchestrator (`plans/adr-005-learning-loop-orchestrator.md` Option A). `--start` runs a baseline and emits `loop-manifest.json` listing reflection proposals; `--continue --apply <id>` runs the candidate after the operator manually applies + commits a chosen proposal, then emits a reflection-annotated comparison; `--status` is read-only manifest inspection. Both `--start` and `--continue` honour `--dry-run`. Exit codes: `0` ok, `2` invalid args / runtime error / lock contention. The "kept" outcome is read from `comparison.reflection_applied.kept`, not from the exit code. See `plans/06-learning-loop.md` for the full reference. | `benchmark/runs/<baseline-run-id>/loop-manifest.json` (mode `0o600`); reflection-annotated `benchmark/runs/_compare/<baseline>__<candidate>.json` |

One forward-reference subcommand still prints a "deferred to post-v1" stub:

```
npm run benchmark -- export-website  # deferred public website (post-v1)
```

For every artifact the CLI produces — `run.json`, `events.ndjson`, `metrics.json`, `score.json`, `comparison.json`, `artifacts/.guild/...`, `_subprocess.{stdout,stderr}.log`, and `report.md` — the producer/consumer mapping is the table in `plans/01-architecture.md §3`.

## Operator runbook (P3 live runs)

Mode 2 runs the real `claude` CLI. Tokens cost real money; the operator's `~/.claude/` auth context is what `claude` picks up. Walk through these steps in order; do not skip the dry-run.

1. **Verify pre-flight.** Run the dry-run path first, every time:

   ```
   npm run benchmark -- run --case <slug> --dry-run
   ```

   `--dry-run` resolves the full plan (argv, env allowlist keys, cwd, plugin_ref, model_ref, run_id) and exits 0 without spawning. CI safe; never burns tokens.

2. **Inspect the resolved invocation.** Read the dry-run output and confirm:
   - `argv` is a JSON array (never a shell string); the binary is the resolved absolute path of `claude`; the prompt is referenced via `--prompt-file <path>`, never as a positional argument.
   - `env_allowlist` lists keys only (values are never printed; security mitigation M16). `ANTHROPIC_API_KEY` and any `CLAUDE_*` keys you expect are present; `AWS_*`, `GITHUB_TOKEN`, and other unrelated tokens are absent.
   - `cwd` points at `runs/<run-id>/_workspace/` (fresh fixture clone per `plans/adr-003`); never the host repo.
   - `plugin_ref`, `model_ref`, and `run_id` match what you intend. Stop and investigate if anything looks wrong.

3. **Choose model tier.** Default is `claude-opus-4-7`. For exploratory or cheap runs, override:

   ```
   GUILD_BENCHMARK_MODELS_JSON='{"default":"claude-haiku-4-5-20251001"}' \
     npm run benchmark -- run --case <slug> --dry-run
   ```

   Tiers: `claude-haiku-4-5-20251001` (cheapest), `claude-sonnet-4-6` (balanced), `claude-opus-4-7` (highest fidelity, slowest, most expensive). Re-run `--dry-run` after changing the model to confirm the new `model_ref`.

4. **Set the live opt-in.** Mode 2 will not actually spawn `claude` unless `GUILD_BENCHMARK_LIVE=1` is set in your environment. This is the default-safe gate — CI never burns tokens, and accidental invocations land on `--dry-run` semantics.

   ```
   export GUILD_BENCHMARK_LIVE=1
   ```

5. **Run.** Drop `--dry-run` and execute. Watch the runner output for the assigned `run_id`:

   ```
   npm run benchmark -- run --case <slug>
   ```

   The runner is single-flight — a second concurrent invocation against the same `serve` instance returns `409 Conflict` with the in-flight `current_run_id` in the body so you can find it.

6. **Find the run.** When the run completes (`pass` / `fail` / `timeout` / `errored`), inspect the artifacts:
   - `runs/<run-id>/report.md` — operator-readable summary.
   - `runs/<run-id>/score.json` — six-component breakdown + `guild_score`.
   - `runs/<run-id>/run.json` — annotated metadata (`plugin_ref`, `model_ref`, `started_at`, `completed_at`, `status`, redacted `raw_command`).
   - `runs/<run-id>/events.ndjson` — typed `EventLine[]` (matches the importer's zod schema).
   - `runs/<run-id>/artifacts/.guild/` — captured plugin tree, post-run.
   - `runs/<run-id>/artifacts/_subprocess.{stdout,stderr}.log` — forensic raw subprocess output, redacted via the M14 / F4.2 pattern set.
   - `runs/<run-id>/_workspace/` — kept by default for inspection; pass `--cleanup` to remove on success.

7. **Compare two runs.** Diff a baseline trial set against a candidate trial set:

   ```
   npm run benchmark -- compare --baseline <set> --candidate <set>
   ```

   The comparator filters on identical `plugin_ref + model_ref` (R2 mitigation); mismatched runs surface under `excluded_runs` rather than being silently scored together. Output lands at `benchmark/runs/_compare/<baseline>__<candidate>.json`.

8. **Interrupt a long run.** Press Ctrl-C in the runner shell. The runner sends `SIGTERM` to the **process group** (`process.kill(-child.pid, "SIGTERM")` per `plans/adr-004`); after a 5-second grace, `SIGKILL` to the same group. Parent-death handlers cover `exit`, `SIGINT`, and `SIGTERM`. A `kill -9` on the runner itself bypasses the handler and may leave the process group alive — use `pkill -g <group>` to clean up if that happens.

9. **Cost expectations.** Per-run cost depends on the case's prompt size, the model tier, and how many turns `claude` actually takes. Approximate ranges at the time of writing:
   - haiku tier: `<placeholder; operator fills>`
   - sonnet tier: `<placeholder; operator fills>`
   - opus tier: `<placeholder; operator fills>`

   Track real costs from your Anthropic console (`run.json` does not record cost). If your benchmark run goes long enough to hit the 1h cap, you have paid for an hour of model wall-clock — that is the upper bound the spec's `T_budget` enforces.

10. **Known issue — claude argv template.** Per the T2 backend follow-up (`.guild/runs/run-2026-04-26-benchmark-factory-p3/handoffs/T2-backend.md §Followups #1`), the default argv template `claude --print --prompt-file <path> --workdir <ws> --output-format stream-json` was rejected by the real `claude` binary during smoke (`error: unknown option '--prompt-file'`). Verify against your installed `claude` version with `--dry-run` and `claude --help`. The long-term fix is the planned `GUILD_BENCHMARK_ARGV_TEMPLATE` env override (or a `case.yaml` `runner_args:` field) so an operator can tune the flag set without code changes; until that ships, an operator whose `claude` rejects the default template can edit `runner.ts`'s `buildArgv()` locally.

### Loop walk-through (P4)

The learning loop drives a baseline → reflect → apply → candidate cycle through two CLI invocations bridged by `runs/<baseline-run-id>/loop-manifest.json`. The full reference (with citations into `plans/p4-learning-loop-architecture.md` and `plans/security-review-p4.md`) lives in `plans/06-learning-loop.md`. Quick five-step operator path:

1. **Baseline.** Run the case once and emit a manifest listing every reflection proposal:

   ```
   npm run benchmark -- loop --start --case demo-context-drift-evolve [--dry-run]
   ```

   The runner produces the standard P3 layout under `runs/<baseline-run-id>/`. The loop additionally writes `runs/<baseline-run-id>/loop-manifest.json` with `state: "awaiting-apply"` (mode `0o600` per `plans/security-review-p4.md F2.3`).

2. **Review.** Inspect the manifest plus the proposal bodies before applying anything:

   ```
   npm run benchmark -- loop --status --baseline-run-id <baseline-run-id>
   ```

   `--status` is read-only. Output prints each proposal body byte-for-byte from the source `.md` (`plans/security-review-p4.md F1.1` mitigation M1) and a `WARNING:` banner when a proposal references a high-trust subtree like `hooks/`, `commands/`, `.claude/settings*.json`, `.mcp.json`, or `mcp-servers/` (`plans/security-review-p4.md F1.2` mitigation M3).

3. **Apply manually.** This step is operator-driven — the loop never writes plugin source (`plans/adr-005-learning-loop-orchestrator.md §Decision` commitment 5). Create a topic branch, edit the plugin source per the chosen proposal body (treating the proposal as if it were an untrusted PR — see `plans/06-learning-loop.md §Operator caveats R1`), and commit cleanly so `git rev-parse HEAD` advances. The manifest's `source_path` is **advisory only**; verify the full commit diff matches the proposal's intent.

4. **Candidate.** Re-invoke the loop with the chosen proposal-id. The loop validates the manifest (architect's 5 rules from `plans/p4-learning-loop-architecture.md §4.3` plus security's `proposal_id` regex and `baseline_run_id` cross-check from `plans/security-review-p4.md F2.1 / F2.2`), spawns the candidate via `runner.ts`, calls `compare.ts` with the manifest in scope, and atomically updates `manifest.state = "completed"` after the candidate finishes:

   ```
   npm run benchmark -- loop --continue \
     --baseline-run-id <baseline-run-id> \
     --apply <proposal-id> [--dry-run]
   ```

5. **Read outcome.** When `--continue` succeeds, the comparison is at `runs/_compare/<baseline-run-id>__<candidate-run-id>.json` with the optional `reflection_applied` block populated (`plans/p4-learning-loop-architecture.md §3.4`). Read `comparison.reflection_applied.kept` (boolean) for the keep/discard verdict — this is **not** an exit code. ComparePage in the UI shows the keep/discard badge alongside (not in place of) the per-component delta table (`plans/security-review-p4.md F4.1` Q19).

The keep/discard rule is locked in `plans/p4-learning-loop-architecture.md §5`: a reflection is kept when `guild_score_delta.delta >= 2.0` AND every per-component delta is `>= -1.0` (inclusive boundaries). Per-case override via `case.yaml learning_loop:`. Treat `kept: true` as a hint, not a verdict — the operator remains the human-in-the-loop reviewer (`plans/06-learning-loop.md §Operator caveats R9`).

### auth_identity_hash (optional)

P4 adds an optional `auth_identity_hash?: string` field on `RunJson` for forensic correlation across runs that share an authenticated operator identity, **without** leaking the credential. Field shape locked in `plans/security-review-p4.md F3.1`:

- **Env var:** `GUILD_BENCHMARK_AUTH_HINT`.
- **Format:** SHA-256 hex digest, exactly 64 lowercase hex characters (`^[a-f0-9]{64}$`).
- **Source-of-truth:** the env var only. The runner does **not** inspect `claude` CLI auth state, does **not** read `~/.claude/`, does **not** call `claude auth status` (`plans/p4-learning-loop-architecture.md §3.4`).
- **Behaviour on valid input:** populated verbatim into `run.json.auth_identity_hash` (no transformation, no re-hashing).
- **Behaviour on invalid format:** field omitted from `run.json`; runner emits a `tool_error` event with `tool: "auth_hint"`; runner writes a value-free WARNING to its stderr / `_subprocess.stderr.log`. The offending env value is **never logged or persisted**.
- **Behaviour when env unset:** field omitted; no event, no warning (normal path).

How to compute the hash:

```
echo -n "<my-identity-token>" | sha256sum | awk '{print $1}'
# macOS without sha256sum:
echo -n "<my-identity-token>" | shasum -a 256 | awk '{print $1}'
```

The `-n` flag matters — it suppresses the trailing newline so the digest is bit-deterministic across machines.

What the value should **NOT** contain (`plans/06-learning-loop.md §Operator caveats R7 / R8`):

- Real credentials (`sk-...`, `Bearer ...`, OAuth tokens, AWS keys). Even hashing a credential pairs the digest with whatever the credential identifies — choose an opaque token instead.
- Personally-identifying material the operator does not want in routinely-shared artifacts (`run.json` ships in bug reports and the deferred public website export).
- Live session tokens. The hash is **forensic-only** — it does not authenticate, it does not authorise. An operator-equivalent attacker can mis-attribute by setting a different env value; the field is documented at this boundary, not stronger.

Pick something stable and opaque the operator chooses: a per-developer random UUID written to a private notes file, a hash of a stable handle, anything that lets you correlate runs by identity later. The runner does not prescribe.

## Testing

The benchmark factory uses [vitest](https://vitest.dev/). Coverage gate: **80% lines + branches**. Two test trees:

```
cd benchmark      && npm test    # backend (runner, server, scorer, importer, compare)
cd benchmark/ui   && npm test    # UI (React component + page tests)
```

Probe-and-skip pattern. Tests that need an optional dependency (Playwright headless browser, the `claude` CLI binary) probe for the prerequisite at the top of the test file and skip cleanly when it is absent. CI runs the always-on subset. Local development with full dependencies installed runs the complete suite.

`GUILD_BENCHMARK_LIVE=1` opt-in. The integration smoke that actually invokes `claude` (e.g., the M10 / F3.1 process-group escalation test, the schema-convergence test against a live run) is gated behind `GUILD_BENCHMARK_LIVE=1`. **Never set this in CI.** It is operator-only, intended for manual verification on a workstation with `claude` authenticated. Without the flag set, those tests are probe-and-skipped.

P4 loop tests use mocked spawn + synthetic manifests. The loop-orchestration unit tests (`benchmark/tests/loop*.test.ts` per qa T4) reach `loop --start`, `loop --status`, `loop --continue` validation rejects, and the comparator's `reflection_applied` annotation path without invoking `runner.ts` for real — `runBenchmark()` is stubbed and the manifest is hand-fixtured. The `GUILD_BENCHMARK_LIVE=1` smoke gate from P3 still applies for any test that needs a real `claude` invocation; loop tests do not.

UI mocking convention: `vi.stubGlobal('fetch', ...)`. New UI tests should use the same pattern as the existing P2 suite (per the qa P2 follow-up). Avoid `msw` or other heavy mocking layers — `vi.stubGlobal` is sufficient for the read-only API surface and keeps tests fast.

Schema convergence test: `benchmark/tests/runner.schema-convergence.test.ts` (qa T4) pins that the live runner's `events.ndjson` matches the importer's zod `eventSchema` byte-for-byte. This is the test that closes the events-shape divergence flagged in `plans/04-metrics.md §"Events-shape divergence"` at P2.

## Scoring at a glance

The `guild_score ∈ [0, 100]` is a weighted sum over six components. Weights ship with the case YAML (per-case override), not the scorer (R1 mitigation; see `plans/01-architecture.md §4 R1`).

| Component       | Weight | What it measures                                                                                    |
| --------------- | -----: | --------------------------------------------------------------------------------------------------- |
| `outcome`       | 30     | Whether the case's acceptance commands pass on the captured artifacts. Timeouts score 0 (R3).       |
| `delegation`    | 20     | Whether dispatched specialists matched the case's `expected_specialists`.                           |
| `gates`         | 20     | Whether the run cleared each Guild lifecycle gate (`brainstorm` → … → `verify-done`).               |
| `evidence`      | 15     | Whether claims in receipts cite real artifacts.                                                     |
| `loop_response` | 10     | Whether `guild:reflect` proposals from prior runs were applied (P4 surfaces this; P1 wires schema). |
| `efficiency`    |  5     | Wall-clock against the case's per-Case budget (R3 — drift visible without changing the 1h cap).     |

Full per-component definitions, source artifacts, computation, and invariants live in `plans/04-metrics.md`. Aggregation formula and comparison delta semantics are in the same file.

## UI

The React app under `benchmark/ui/` ships in this PR. Architectural contract: `plans/p2-ui-architecture.md` (component tree, state shape, data-fetching pattern). Operator-facing reference: `plans/05-ui.md` (surface-by-surface walk-through). Frontend's implementation notes — final routing / CSS / dev-vs-prod commands — live next to the code in `benchmark/ui/README.md`.

Boot the UI in production mode (single port serving both API and built React app):

```
cd benchmark/ui && npm run build
cd .. && npm run benchmark -- serve
```

Open `http://127.0.0.1:3055`. Override the port with `BENCHMARK_PORT=<n>` or `--port <n>`.

In dev, run the API server (`npm run benchmark -- serve`) on `3055` and Vite's dev server on a separate port (typically `5173`); the dev server proxies `/api/*` to `127.0.0.1:3055`.

### Charts

**Charting library: `recharts@2.13.3`.** Picked for the typed React-component API (the chart shapes are JSX; props flow as data, not imperative SVG mutations), its tree-shakeable export surface (the UI uses `BarChart`, `Bar`, `Cell`, `ResponsiveContainer`, `XAxis`, `YAxis`, `CartesianGrid`, and `Tooltip` — the rest of the library is dropped at build time), the active maintenance cadence on the 2.x line, and the bundle cost (~102 KB gzipped for the shapes used) which sits well within the 500 KB total UI budget (the full UI is currently 160 KB gz). Alternatives considered and rejected: visx is lower-level — more wrapper code per chart for an internal operator tool; uPlot is the smallest option but is not React-first, so we'd ship integration boilerplate; Chart.js is canvas-based, which makes it harder to assert against in `happy-dom`. For a single-operator, internal, function-driven UI, recharts is the right size. Source: `.guild/runs/run-2026-04-26-benchmark-factory-p2/handoffs/T3-frontend.md §Follow-ups → route: technical-writer (1)`.

## What's deferred

- **The deferred public website** — out of v1 (spec §Non-goals). It will consume the same JSON shape locked by ADR-001 §Decision §3, exported via a future `npm run benchmark -- export-website` snapshot. It does not exist in this PR; do not assume any artifact references it.
- **`export-website` subcommand** — post-v1. (`loop` ships in this PR; `run` shipped in P3; `serve` shipped in P2; `score` and `compare` shipped in P1.)
- **Model-override UI, cancel-run button, SSE streaming, and the `GUILD_BENCHMARK_ARGV_TEMPLATE` env doc** — tracked as P3-polish follow-ups; not in this PR.
- **P4-polish — loop hardening.** Manifest HMAC signing (security `D1`); per-run nonce binding manifest to baseline `run.json` (`D2`); diff-based `source_path` enforcement (`D3`); pre-apply hook sanity check (`D4`). All four are deferred-with-reason for v1 single-operator scope (`plans/security-review-p4.md F2.1 / F2.2 / F1.2 / F1.5`). ADR-006 captures the upgrade if multi-operator scope ever lands. A loop walk-through GIF is also deferred to a later product stage.

## Plans

The full planning set — architecture, ADRs, case-suite reference, runner reference, metrics rubric, and forward-reference stubs — is indexed in `plans/00-index.md`.
