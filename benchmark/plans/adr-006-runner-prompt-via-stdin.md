---
type: adr
id: ADR-006
slug: runner-prompt-via-stdin
phase: P3 (v1.1 fix-pack)
spec: .guild/spec/benchmark-factory.md
plan: benchmark/plans/03-runner.md
design: benchmark/plans/p3-runner-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-27
supersedes:
  - benchmark/plans/p3-runner-architecture.md §2.2 (`stdio: ["ignore", "pipe", "pipe"]` line)
  - benchmark/plans/p3-runner-architecture.md §2.3 (`--prompt-file` invariant)
  - benchmark/plans/03-runner.md §"Argv shape" (default argv reference)
superseded_by: []
---

# ADR-006 — Runner: prompt via stdin + `--add-dir` for claude v2.x compatibility

## Status

**Accepted** — 2026-04-27 as part of v1.1 fix-pack.

This ADR amends `benchmark/plans/p3-runner-architecture.md §§2.2 / 2.3`
and `benchmark/plans/03-runner.md` to match the actual `claude` v2.x CLI
surface. P3's locked invariants from §2.3 — *prompt never appears in
process listings*, *no shell interpolation*, *non-interactive only* —
are **preserved**. The mechanism by which they are preserved changes.

## Context

P3's runner default argv was specified as:

```text
claude --print --output-format stream-json --prompt-file <path> --workdir <ws>
```

with `stdio: ["ignore", "pipe", "pipe"]`. That shape was written against
an earlier `claude` CLI surface and validated only via unit tests with a
mocked spawn. The first **live operator smoke** against `claude` v2.x
(`/Users/miguelp/.local/bin/claude`, version observed during v1.1 work)
exposed three CLI-level incompatibilities:

1. `--prompt-file <path>` — **rejected.** v2.x reads the prompt from
   stdin (or as a positional argument) under `--print`. There is no
   `--prompt-file` flag.
2. `--workdir <ws>` — **rejected.** v2.x uses `--add-dir <ws>` to grant
   the model tool-level access to a working directory; cwd is taken from
   the spawn invocation itself, not from a flag.
3. `--output-format stream-json` — **rejected** unless paired with
   `--verbose`. The default human-readable output format (no flag) is
   what works out-of-the-box; the structured stream is opt-in.

Operator smoke evidence (run `smoke-noop-5de7eb0-9a78391-1`,
`runs/.../artifacts/_subprocess.stderr.log`):

```text
error: unknown option '--prompt-file'
error: unknown option '--workdir'
error: --output-format stream-json requires --verbose
```

These rejections fired during argv parsing — `claude` exited before
reading any prompt — so the runner saw `exit=1`, no captured stdout, no
chance to score.

A second issue was exposed by the same smoke: `spawnAndWait` deadlocked
on fast-exit subprocesses because it awaited `once(stream, "end")`
**after** `once(child, "exit")`. For a child whose stdio drained before
exit, the `"end"` event had already fired and the post-exit listener
never resolved. Documented in `benchmark/src/runner.ts §spawnAndWait`
(see `awaitStreamEndBounded` helper).

## Decision

The runner's **default argv** (when the operator does not override via
the `GUILD_BENCHMARK_ARGV_TEMPLATE` env var) becomes:

```text
claude --print --add-dir ${RUN_DIR}/_workspace [--model ${MODEL}]
```

with the prompt **piped on stdin**. Specifically:

| What                   | New (v1.1, this ADR)                                   | Old (P3 baseline)                                   |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Workspace access       | `--add-dir ${RUN_DIR}/_workspace`                      | `--workdir ${RUN_DIR}/_workspace`                   |
| Prompt delivery        | piped via `child.stdin.write(prompt); child.stdin.end()` | `--prompt-file ${PROMPT_PATH}`                      |
| Output format          | (no flag — claude's default)                           | `--output-format stream-json`                       |
| Model selection        | `--model ${MODEL}` substituted from `model_ref.default` (when present) | not in default; operator-injected only |
| `stdio` shape          | `["pipe", "pipe", "pipe"]`                             | `["ignore", "pipe", "pipe"]`                        |

cwd remains `runs/<id>/_workspace/` (ADR-003). `shell: false`,
`detached: true` + process-group signaling (ADR-004), and the env
allowlist from §2.4 are unchanged.

Operators who need structured output **and** are running a `claude`
build that supports it can set `GUILD_BENCHMARK_ARGV_TEMPLATE` to inject
`--verbose --output-format stream-json` per the operator-tunable argv
escape hatch in `benchmark/README.md §10`. The default does not enforce
structured output any more.

## P3 invariants — preserved

The §2.3 invariants survive the mechanism change:

1. **Prompt never in process listings.** `child.stdin.write(prompt)`
   keeps the bytes off `argv`. `ps`/`/proc/<pid>/cmdline` show only
   `claude --print --add-dir <ws> [--model <name>]`, never the prompt
   content. The unit test `runner.security.test.ts §"v1.1 / ADR-006:
   prompt content is piped to child.stdin"` pins this.
2. **No shell interpolation.** `shell: false` is unchanged. The prompt
   is delivered through a Node-owned pipe (the writable side of the
   child's stdin file descriptor), not via `/bin/sh -c`.
3. **Non-interactive only.** `--print` is still mandatory in the
   default argv. The runner has no TTY; `child.stdin.end()` fires after
   the prompt is written, so claude sees EOF and cannot block on
   further input.

## Why stdin (not a temp file)

ADR was a real choice between three options:

| Option                                | Trade-offs                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. stdin pipe (chosen)**            | Bytes never touch the filesystem. No temp-file lifecycle to manage. EPIPE-tolerant write keeps the runner stable if claude rejects argv before reading. Standard Unix pattern. Works on every OS.                                                                                                                                                                                                          |
| B. Temp file + positional arg         | Would need a per-run temp path, cleanup on every exit code path (including SIGKILL), and a redact pass if the prompt itself contains secrets. Adds a filesystem touchpoint to the security surface. The temp file would need to live under `runs/<id>/` (otherwise it leaks across runs); at that point, it becomes another captured artifact.                                                            |
| C. Positional arg (`claude --print "$prompt"`) | Puts the prompt in argv → directly violates §2.3 invariant #1. Rejected on security grounds. (Note: claude v2.x does accept positional prompts under `--print`, but only at the cost of process-listing exposure.)                                                                                                                                                                                  |

## What this does *not* change

- **ADR-003** — fresh-fixture clone per run. `cwd` and `--add-dir`
  point at the same path: `runs/<id>/_workspace/`.
- **ADR-004** — detached: true + process-group SIGTERM/SIGKILL. The
  signal escalation timeline in §2.6 is untouched.
- **§2.4 env sanitisation.** Same allowlist; same redaction policy.
- **§2.5 stdio capture.** stdout + stderr are still tee'd to
  `_subprocess.stdout.log` / `_subprocess.stderr.log`. The new stdin
  pipe is *write-only from the runner's side* and is not captured —
  only the operator-supplied prompt content goes through it, and that
  content is already written to disk in the case YAML.
- **§4 status mapping.** `pass` / `fail` / `timeout` / `error` taxonomy
  is unchanged. exit=0 → pass, non-zero → fail (modulo timeout
  override).

## Operator-facing impact

- The `GUILD_BENCHMARK_ARGV_TEMPLATE` escape hatch (`benchmark/README.md
  §10`) gains a new placeholder: `${MODEL}`. When the case's
  `model_ref.default` is set and the operator does not override
  `ARGV_TEMPLATE`, the runner injects `--model <name>` automatically.
- The previous `${PROMPT_PATH}` placeholder is **deprecated**. It still
  works for operator-overridden templates that pin a `--prompt-file`-
  flavoured CLI (some forks may keep that flag), but it is no longer in
  the default. The template engine resolves `${PROMPT_PATH}` to a path
  pointing at a per-run prompt file the runner writes for backward-
  compatible templates only — when the operator does not reference
  `${PROMPT_PATH}`, the runner skips the temp-file write and uses
  stdin.
- The `GUILD_BENCHMARK_LIVE=1` gate (introduced in v1.1 alongside this
  ADR) is **enforced inside `runBenchmark`** before any spawn happens.
  Tests that exercise the spawn path satisfy the gate via
  `tests/_setup.ts`; tests that exercise the gate's negative path delete
  the env var in their own `beforeEach`.

## Verification

1. **Unit** — `runner.unit.test.ts` asserts the new default argv shape
   (`--add-dir`, no `--prompt-file`, no `--workdir`, no
   `--output-format`), the `${MODEL}` substitution, and the
   `GUILD_BENCHMARK_LIVE` gate's positive + negative branches.
2. **Security regression** — `runner.security.test.ts §"v1.1 / ADR-006:
   prompt content is piped to child.stdin"` confirms the prompt bytes
   are written to the FakeChild's stdin and **not** present in argv.
3. **Live smoke** — operator ran `smoke-noop` against the real `claude`
   v2.x CLI under v1.1 default argv (no `ARGV_TEMPLATE` override).
   Result: `status=pass`, `wall_clock_ms ≈ 8786`, claude responded with
   "smoke-ok" → captured to `_subprocess.stdout.log`.
4. **End-to-end demo** — `demo-url-shortener-build` ran live against
   real `claude` v2.x with `--model haiku`. Result: `status=pass`
   (`wall_clock_ms ≈ 35540`), prompt delivered, response captured,
   `score.json` written with `guild_score=30/100` (partial — missing
   `events.ndjson` because raw `claude --print` does not run the Guild
   lifecycle, which is expected: the partial-artifact path in
   `01-architecture.md §"Cross-cutting"` handles this correctly).

## Consequences

- **+** Default argv works out-of-the-box on `claude` v2.x without
  operator override. The benchmark factory is now usable end-to-end on
  the same `claude` shipped to operators.
- **+** Two real cases (`smoke-noop`, `demo-url-shortener-build`) run
  green from CLI through scorer. Previously they failed at argv parse.
- **+** The deadlock-on-fast-exit failure mode is gone (see
  `awaitStreamEndBounded` in `runner.ts`). A clean exit no longer hangs
  the runner waiting for an `"end"` event that already fired.
- **−** Operators who relied on `--output-format stream-json` in the
  default need to opt back in via `ARGV_TEMPLATE`. Captured by README
  §10's v1.1 note.
- **−** A future `claude` major version may break this default again.
  The `ARGV_TEMPLATE` escape hatch absorbs that — operators set their
  own argv shape and the runner stops trying to be smart about it.

## References

- `benchmark/src/runner.ts` — implementation (search `ADR-006`,
  `awaitStreamEndBounded`, `ENV_LIVE`, `${MODEL}` substitution).
- `benchmark/tests/runner.unit.test.ts` — `// v1.1 / ADR-006` blocks.
- `benchmark/tests/runner.security.test.ts` — `// v1.1 / ADR-006`
  stdin-piping assertion.
- `benchmark/README.md §10 "Operator-tunable argv"` — operator-facing
  docs for `${MODEL}` and the v1.1 default change.
- ADR-003, ADR-004 — referenced as still-active constraints layered
  beneath this one.
