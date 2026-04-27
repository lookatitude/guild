---
type: reference
phase: P3 (v1.1 fix-pack)
status: current
owner: technical-writer
updated_at: 2026-04-27
---

# 03 — Runner

## Status: P3 + v1.1 fix-pack — current

> **v1.1 update (2026-04-27).** Default argv shape and stdio model
> changed for `claude` v2.x compatibility. See
> `benchmark/plans/adr-006-runner-prompt-via-stdin.md` for the
> decision. Quick summary:
>
> - Prompt is **piped via stdin** (was `--prompt-file <path>`).
> - Workspace access is `--add-dir <ws>` (was `--workdir <ws>`).
> - Default no longer sets `--output-format` (was
>   `--output-format stream-json`); operators can opt back in via
>   `GUILD_BENCHMARK_ARGV_TEMPLATE`.
> - `--model <name>` is auto-injected from `model_ref.default`.
> - `stdio` is `["pipe", "pipe", "pipe"]` (was `["ignore", "pipe", "pipe"]`).
> - `GUILD_BENCHMARK_LIVE=1` is now **enforced** by the runner before
>   any spawn (was advisory in the docs only).
>
> P3 invariants are preserved: prompt never appears in process
> listings, `shell: false` is unchanged, ADR-003 fresh-fixture clone
> and ADR-004 process-group signaling are unchanged. The §"Subprocess
> contract" table below shows the updated values; the architect's
> `p3-runner-architecture.md §§2.2–2.5` carries the same supersession
> callout.

The benchmark runner has two operating modes. **Mode 1 (import-only)** ships in P1 and is still useful for replaying captured artifacts without invoking `claude`. **Mode 2 (live `claude` CLI subprocess)** ships in this PR (P3) per the architect's design at `benchmark/plans/p3-runner-architecture.md`, the cwd model at `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md`, the signal-escalation amendment at `benchmark/plans/adr-004-runner-process-group-signaling.md`, the v1.1 argv update at `benchmark/plans/adr-006-runner-prompt-via-stdin.md`, and the threat-modelled mitigations at `benchmark/plans/security-review.md`.

Both modes write the same on-disk layout under `benchmark/runs/<run-id>/`. That single layout is the canonical store (per the filesystem-only NFR; `01-architecture.md §5`); the P2 server reads it through an API per `adr-001-runner-ui-boundary.md §Decision §1`, and the deferred public website consumes the snapshotted JSON.

## Mode 1 — Import-only (P1, still supported)

In Mode 1 the runner does not invoke `claude`. The operator drops a `.guild/` tree under `benchmark/fixtures/<name>/` and the CLI scores it as if a real `/guild` run had captured it. This mode remains useful when an operator already has a captured run from another machine, when reproducing a historical scoring with a new rubric, or when working in a `claude`-free environment (CI, fresh checkouts).

End-to-end flow:

1. Operator places a captured `.guild/` tree at `benchmark/fixtures/<fixture-name>/.guild/`. (qa owns the `synthetic-{pass,fail,timeout,malformed}/` set; operators authoring real cases drop their own.)
2. Operator runs `npm run benchmark -- score --run-id <id>`.
3. `case-loader.ts` parses the case YAML.
4. `artifact-importer.ts` walks `<fixture-name>/.guild/` and produces an in-memory `RunRecord` plus persists `runs/<run-id>/run.json` and `runs/<run-id>/events.ndjson` (and copies the captured tree into `runs/<run-id>/artifacts/.guild/`).
5. `scorer.ts` consumes the `RunRecord`, computes the six components, writes `runs/<run-id>/metrics.json` and `runs/<run-id>/score.json`.
6. `compare.ts` (when invoked separately via `npm run benchmark -- compare`) reads two trial sets and writes a `comparison.json` whose path is documented in `04-metrics.md`.

Component diagram for this flow is `01-architecture.md §1`; the importer's contract is the same contract the live runner satisfies in Mode 2.

### What Mode 1 does **not** do

- **No subprocess.** `claude` is not on the call graph; the CLI works without `claude` installed (spec §Constraints, §NFRs in `01-architecture.md §5`).
- **No `report.md` synthesis.** The importer leaves `report.md` absent unless the captured fixture already contains one. Mode 2 produces `report.md` directly.
- **No outbound network.** The importer reads local files only; fixtures containing remote URLs in receipts are rejected (`01-architecture.md §5` no-network NFR; qa has a test for this).

### Determinism guarantees in Mode 1

`run.json` carries `plugin_ref` (git commit at the time of the captured run) and a per-specialist `model_ref` map. Both fields are mandatory in the importer's schema; a fixture missing either is rejected (`01-architecture.md §3` determinism gate; §4 R2). The comparator can already filter on identical refs because synthetic fixtures must carry valid placeholder refs.

### Component zeroing on missing artifacts (R-cross)

When an expected artifact is absent (e.g. `events.ndjson` is missing), the importer flags `partial: true` on the `RunRecord` with a `missing_artifacts: [...]` enumeration. The corresponding scoring component drops to `raw_subscore = 0` and carries `reason: "missing_artifact"` in `score.json`. The zero is loud, not silent — UI and comparison surfaces render the reason alongside the number (`01-architecture.md §4` cross-cutting note).

## Mode 2 — Live `claude` CLI subprocess (P3, this PR)

Mode 2 is the live runner. It clones a fresh fixture, spawns `claude` against it, captures the resulting `.guild/` tree, applies write-time redaction to mechanical streams, and writes a canonical `run.json` + `events.ndjson` matching the importer's zod schema.

### When to use it

Use Mode 2 when you want the benchmark to score a run **the plugin actually executed**, against a model and plugin commit you control, on a freshly-cloned fixture that cannot contaminate (or be contaminated by) your working tree. This is the operator path for: validating a candidate plugin commit before merging, comparing two model tiers at the same plugin ref, producing a reflection-loop baseline (P4), and answering "did this change move the score?" with first-hand evidence.

Mode 2 costs real tokens against the operator's Anthropic account. Use Mode 1 when you have the artifacts already; use Mode 2 when you need the run to actually happen.

### Pre-flight: `--dry-run`

`--dry-run` is the operator's "look before you leap" path. It resolves the full subprocess plan — argv, env allowlist (keys only — never values), workspace clone target, plugin_ref, model_ref, run-id — and prints it without spawning. Run this **first**, every time.

```
npm run benchmark -- run --case <slug> --dry-run
```

Inspect the output for:

1. **argv** — a JSON array (never a shell string). The `claude` binary is the resolved absolute path, never the bare string `"claude"`. Per `p3-runner-architecture.md §2.2`, ADR-004, and ADR-006 (v1.1), the prompt is **piped via stdin**, not passed as a positional argument or via `--prompt-file` — security mitigation M5 is preserved by the new mechanism. The default argv shape under v1.1 is `claude --print --add-dir ${RUN_DIR}/_workspace [--model ${MODEL}]`.
2. **env_allowlist** — the keys of every environment variable forwarded to the subprocess. Values are never printed (security mitigation M16). If a key you expect (`ANTHROPIC_API_KEY`, `CLAUDE_*`) is missing, set it in your shell before re-running. If a key you do **not** expect is present, stop — the allowlist constant in `runner.ts` may have been edited.
3. **cwd** — must be `runs/<run-id>/_workspace/` (the fresh fixture clone) per `adr-003-host-repo-vs-fresh-fixture.md §Decision`. The subprocess never sees the host repo.
4. **plugin_ref** — `git rev-parse HEAD` in the host repo at run start.
5. **model_ref** — the per-specialist model map. Default is `{default: "claude-opus-4-7"}` unless overridden via `GUILD_BENCHMARK_MODELS_JSON` env or the case YAML.
6. **run_id** — pattern `<case-slug>-<plugin7>-<modelhash7>-<n>` (n is a 1-indexed repetition counter past existing runs).

`--dry-run` exits 0 and never writes to `runs/`. CI can run it as a smoke without burning tokens.

### `GUILD_BENCHMARK_LIVE=1` env gate

Mode 2 will **not** spawn `claude` unless `GUILD_BENCHMARK_LIVE=1` is set in the environment. Without it, the runner throws a "live execution refused" error before any spawn happens (v1.1 — previously this gate was advisory at the docs layer only; v1.1 enforces it inside `runBenchmark`). This is the default-safe posture: CI never burns tokens, and an operator who runs `npm run benchmark -- run` exploratorily gets a clear refusal rather than a real spawn. Explicit opt-in is the security mitigation against accidental cost or accidental side-effects on the operator's `~/.claude/` auth context.

### Subprocess contract

The full subprocess model is locked in `p3-runner-architecture.md §2` with the signal-escalation amendment in `adr-004-runner-process-group-signaling.md §Decision`. Operator-facing summary of the load-bearing options (do **not** restate the architect's tables — link):

| Option | Value | Reference |
| --- | --- | --- |
| API | `child_process.spawn` (streamed stdio, no shell) | `p3-runner-architecture.md §2.1` |
| `cwd` | `runs/<run-id>/_workspace/` (fresh fixture clone) | `p3-runner-architecture.md §2.2`, `adr-003 §Decision §1` |
| `shell` | `false` (non-negotiable; runtime-asserted) | `p3-runner-architecture.md §2.2`, `security-review.md F1.1` |
| `stdio` | `["pipe", "pipe", "pipe"]` — stdin is the prompt-delivery channel (ADR-006); stdout + stderr tee'd to disk | `p3-runner-architecture.md §2.5`, `adr-006 §Decision` |
| `detached` | `true` (process-group leader; signals reach grandchildren) | `adr-004 §Decision §1` |
| Signal target | `process.kill(-child.pid, SIG)` (whole group) | `adr-004 §Decision §2` |
| Timeout | SIGTERM at `T_budget`, SIGKILL at `T_budget + 5s` | `p3-runner-architecture.md §2.6`, `adr-004 §Decision §5` |
| Env | Default-deny allowlist; nothing inherited from `process.env` | `p3-runner-architecture.md §2.4`, `security-review.md F1.3` |

The `T_budget` default is `3600 * 1000` ms (1h, spec §Constraints). A case YAML may declare a tighter `timeout_seconds`; the runner uses `min(case.timeout_seconds, 3600)` so a case can never extend the global cap. ADR-004 is what makes the cap a hard constraint instead of a soft one — without process-group signaling, a `claude` grandchild can outlive SIGKILL and escape the cap.

### Artifact capture

Capture is a single post-exit pass per `p3-runner-architecture.md §3` and `adr-003-host-repo-vs-fresh-fixture.md §Decision §3`. Every write site applies the 5-rule path-resolution checklist (`p3-runner-architecture.md §3.4` + `security-review.md F2.1`); symlinks are refused at capture time via `lstat` pre-walk and emit a `tool_error` event (`security-review.md F2.2`). The capture flow:

```text
post-exit
  ↓
drain + close stdio tee streams (drain → end → close)        [§2.5]
  ↓
copyTreeSafe(_workspace/.guild/, runs/<id>/artifacts/.guild/) [§3.3 step 2 + ADR-003]
  ├─ refuse symlinks (F2.2)
  ├─ verify each dest under artifactsRoot (F2.1, F2.4)
  └─ errorOnExist: true (F2.6)
  ↓
resolve events.ndjson → runs/<id>/events.ndjson              [§3.3 step 3]
  ↓
write runs/<id>/run.json with annotated fields               [§3.5]
  ↓
clean up _workspace/ (best-effort; --cleanup flag)           [§3.3 step 5]
  ↓
record missing_artifacts + partial: true if anything skipped [§3.3 step 6]
```

The runner-authored forensic logs (`_subprocess.stdout.log`, `_subprocess.stderr.log`) live under `runs/<id>/artifacts/` directly; the captured `.guild/` tree lives at `runs/<id>/artifacts/.guild/`. Different parent directories — no collision (`security-review.md F2.6`). All runner-authored files use the `_` prefix convention.

Mechanical-stream redaction (`security-review.md F4.2` / M15) is applied as a `Transform` between the subprocess's pipes and disk: tokens matching the documented pattern set are scrubbed line-by-line before bytes hit the file. The raw_command audit field is similarly redacted via `redactArgvForAudit` (`security-review.md F4.1` / M14).

### Status mapping

Subprocess outcomes map onto `RunStatus` per `p3-runner-architecture.md §4.1`. Operator-facing condensed view (do **not** restate the architect's full table — link):

| Outcome | `RunStatus` | Exit code (CLI) |
| --- | --- | --- |
| Clean exit, all acceptance commands pass | `pass` | `0` |
| Clean exit, any acceptance command fails | `fail` | `1` |
| SIGTERM/SIGKILL at the 1h cap | `timeout` | `124` |
| Non-zero exit; spawn failure (`ENOENT`); empty `.guild/` after exit; capture I/O error | `errored` | `2` |

CLI exit codes are pinned in `.guild/runs/run-2026-04-26-benchmark-factory-p3/handoffs/T2-backend.md §Files written`. Acceptance commands are observed and recorded by the runner; the scorer evaluates them per `p3-runner-architecture.md §4.2`. There are no retries (`p3-runner-architecture.md §4.3`); a failed run is recorded once and the operator decides whether to re-invoke.

### Operator caveats

These integrate the security review's runbook items (R1–R7) addressed to technical-writer in `.guild/runs/run-2026-04-26-benchmark-factory-p3/handoffs/T6-security.md §route: technical-writer`.

- **Token budget — runs cost money.** Always run `--dry-run` first. Use `claude-haiku-4-5-20251001` for cheap exploratory runs; `claude-sonnet-4-6` for balanced work; reserve `claude-opus-4-7` for high-fidelity benchmarks. Override the per-run model via `GUILD_BENCHMARK_MODELS_JSON='{"default":"claude-haiku-4-5-20251001"}'` (`security-review.md` R6 redaction-list extension protocol).
- **claude argv template — RESOLVED in v1.1.** The original P3 default template (`claude --print --prompt-file <path> --workdir <ws> --output-format stream-json`) was rejected by `claude` v2.x during operator smoke. v1.1 / ADR-006 lands a v2.x-compatible default: `claude --print --add-dir <ws> [--model <name>]` with the prompt piped via stdin. Operators on a fork that needs different flags override via `GUILD_BENCHMARK_ARGV_TEMPLATE` (see README §10). The `${MODEL}` placeholder is the new v1.1 substitution; `${PROMPT_PATH}` is deprecated but still supported for backward-compatible templates. Always run `--dry-run` first to confirm argv against your installed `claude` build.
- **PATH guidance.** Verify `which claude` resolves under an expected install root (`/usr/local/bin`, `~/.bun/bin`, `/opt/homebrew/bin`). The runner records the resolved absolute path in `run.json.raw_command` (post-redaction). Do **not** add `.`, `/tmp/bin`, or world-writable directories to `$PATH` (`security-review.md` R2 + F1.4). The runner refuses to start if the resolved binary lives under `/tmp` or a workspace path (mitigation M4).
- **Long-running runs and interrupts.** Press Ctrl-C in the runner shell; the runner sends SIGTERM to the **process group** (`process.kill(-child.pid, "SIGTERM")` per ADR-004), then SIGKILL after a 5-second grace. Parent-death handlers cover `exit`, `SIGINT`, and `SIGTERM`; a `kill -9` on the runner itself bypasses the handler and may leave a process group alive (`adr-004 §Consequences — Negative — accepted trade`). If that happens, `pkill -g <group>` cleans up.
- **Forensic logs and artifact paths.** `runs/<id>/artifacts/_subprocess.stdout.log` and `runs/<id>/artifacts/_subprocess.stderr.log` capture the raw subprocess output, redacted via the M14 / F4.2 pattern set. `runs/<id>/artifacts/.guild/` is the captured plugin tree, untouched aside from path-resolution refusal (`security-review.md F2.1`) and symlink refusal (`security-review.md F2.2`). `events.ndjson` is at `runs/<id>/events.ndjson`, sibling to `artifacts/`.
- **Fixture cleanup.** `_workspace/` is **kept by default** for inspection. Pass `--cleanup` to remove it post-run. Partial runs (timeout, errored) keep `_workspace/` regardless so an operator can inspect what `claude` wrote (`p3-runner-architecture.md §3.3 step 5` + T2 backend follow-up #4).
- **Operator auth identity.** Benchmark runs use the operator's `~/.claude/` auth context; charge attribution flows to the operator's Anthropic account. Rotating keys does not invalidate prior `run.json` artifacts but they cannot be retroactively re-attributed. To use a sandbox account, invoke with `HOME=/path/to/sandbox/home npm run benchmark` (`security-review.md` R4 / F4.3). P4 ships an optional `auth_identity_hash` field on `run.json` (`^[a-f0-9]{64}$`) sourced from `GUILD_BENCHMARK_AUTH_HINT` only — the runner does **not** inspect `~/.claude/` auth state (`p4-learning-loop-architecture.md §6` / `security-review-p4.md` F2.4 + R5).
- **Case prompt secret guidance.** Case prompts SHOULD NOT contain real secrets. The runner captures prompts verbatim into the audit trail (capture-fidelity invariant, `p3-runner-architecture.md §4.5`). To benchmark secret-handling behaviour, use synthetic markers (`SECRET_PLACEHOLDER_42`). The runner does **not** sanitise operator-authored content; it does redact mechanical output streams (`security-review.md` R5 / F4.5).
- **OOM and resource ceilings.** On Linux, run with `ulimit -v 8388608` to bound subprocess RSS. macOS has no portable per-process equivalent; if the runner OOMs, restart it (`security-review.md` R3 / F3.4). The runner records `process.resourceUsage()` in `run.json.resource_usage` for visibility (M13).
- **Windows is unverified in P3.** Operators on Windows should treat results as best-effort; path normalisation uses `path.posix` for relpath inputs, but full Windows hardening (including `taskkill /T /F` for process-group escalation) is deferred to a future ADR-005 (`security-review.md` R7 / F2.5; `adr-004 §Drivers D6`).

### References

- `benchmark/plans/p3-runner-architecture.md` — subprocess model (§2), artifact capture (§3), status / error / retry (§4), cross-references (§5).
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md` — fresh-fixture clone cwd model.
- `benchmark/plans/adr-004-runner-process-group-signaling.md` — `detached: true` + `process.kill(-pid, SIG)` signal escalation; supersedes the `detached: false` line of `p3-runner-architecture.md §2.2`.
- `benchmark/plans/security-review.md` — 21 findings; mitigations M1–M16; FR1–FR6 closure; R1–R7 runbook items addressed to technical-writer.
- `benchmark/plans/01-architecture.md §3` — per-artifact data flow the runner satisfies.
- `benchmark/plans/04-metrics.md` — what `score.json`, `metrics.json`, and `comparison.json` contain.
- `benchmark/plans/02-case-suite.md` — Case schema fields the runner consumes.
- `.guild/runs/run-2026-04-26-benchmark-factory-p3/handoffs/T2-backend.md` — implementer's pin: argv shape, exit codes, single-flight 409 contract, and the known-issue claude argv follow-up.

## Failure modes

This section does not restate the architecture-level failure-mode treatments — they live in `01-architecture.md §4` (Locus + Containment + Recovery for each of R1–R5 plus the cross-cutting missing-artifact case). Mode 2-specific updates:

- **R3 — 1h timeout hides slow regressions.** Containment is the per-case `wall_clock_budget_ms` budget (driving the `efficiency` component) plus the timeout-as-status convention. The cap itself is now a hard constraint per ADR-004's process-group signaling. See `01-architecture.md §4 R3`.
- **R4 — Synthetic-fixture drift.** The importer's zod schema validates every input directory (fixture or real). Mode 2's `events.ndjson` writer matches the same shape; `04-metrics.md §"Events-shape divergence"` documents the convergence. See `01-architecture.md §4 R4`.
- **R2 — Model / plugin churn.** `run.json` carries `plugin_ref + model_ref`; `compare.ts` filters on identical refs. See `01-architecture.md §4 R2`.

## Cross-references

- `01-architecture.md §1` — component diagram (the dotted line separating P1 from P2 / P3 is now solid).
- `01-architecture.md §3` — every artifact under `runs/<run-id>/` with its producer + consumer.
- `01-architecture.md §4 R3` — timeout handling + per-case budget rationale.
- `01-architecture.md §4 R4` — fixture drift mitigation (importer schema + conformance test).
- `01-architecture.md §5` — NFRs the runner satisfies (1h cap, no network, determinism, opt-in `claude`).
- `adr-001-runner-ui-boundary.md §Decision §2` — the server is a thin read layer over the on-disk paths the runner writes.
- `02-case-suite.md` — Case schema fields (`prompt`, `wall_clock_budget_ms`, `timeout_seconds`) the runner consumes.
- `04-metrics.md` — what `score.json`, `metrics.json`, and `comparison.json` contain; `POST /api/runs` semantics now flipped from 501 to 202 + Location.
