---
type: design
slug: benchmark-factory-p3-runner-architecture
phase: P3
spec: .guild/spec/benchmark-factory.md
plan: .guild/plan/benchmark-factory-p3.md
adr_refs:
  - benchmark/plans/adr-001-runner-ui-boundary.md
  - benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md
status: accepted
owner: architect
created_at: 2026-04-26
---

# Benchmark Factory — P3 Runner Architecture

> **Scope.** This document fixes the subprocess + artifact-capture
> contract the P3 backend implements as `benchmark/src/runner.ts` and
> the P3 security review threat-models. It does **not** supersede
> `01-architecture.md`, `adr-001-runner-ui-boundary.md`, or
> `p2-ui-architecture.md` — all three are accepted and load-bearing. It
> adds a layer beneath them: how the `runner.ts` box in
> `01-architecture.md §1` actually shells out to `claude`, captures the
> resulting `.guild/` tree, and maps subprocess outcomes onto the
> `RunStatus` enum locked in `benchmark/src/types.ts`.

## 1. Where this document sits

| Document                                                  | Decides                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-architecture.md`                                      | Multi-component design across all 4 phases. §1 names `runner.ts` as a P3 forward reference; §3 data-flow table is the contract this runner produces against.                            |
| `adr-001-runner-ui-boundary.md`                           | Server JSON shape (Option A); runner writes the on-disk artifacts the server reads.                                                                                                    |
| `p2-ui-architecture.md`                                   | React app's component tree + state shape; the `RunDetailPage` consumes the `run.json` + `events.ndjson` shapes this runner produces.                                                  |
| `benchmark/src/types.ts`                                  | `RunStatus`, `EventLine`, `RunJson` — locked at P1, extended at P2. The runner's output **must** match these types; the importer's zod schema is the convergence target.               |
| **this document**                                         | Subprocess model (`child_process.spawn`, signal escalation, stdio capture), artifact-capture protocol (fresh-fixture clone per run, path-resolution rules), error/retry taxonomy.       |
| `adr-003-host-repo-vs-fresh-fixture.md`                   | The cwd model the runner uses. Cited from §3 below; Option scoring lives in the ADR.                                                                                                  |
| Future `security-review.md` (T6)                          | Threat model + secrets + path-traversal mitigations layered on top of this design.                                                                                                    |

## 2. Subprocess model

### 2.1 Why `child_process.spawn`

The runner uses `node:child_process.spawn` to launch `claude`. Other
candidates were considered and rejected:

| API           | Why rejected                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execFile`    | Buffers stdout/stderr in memory until exit. A 1h `claude` invocation can produce many MB of output (event stream, model output, tool traces); buffering risks OOM and lateness. |
| `spawnSync`   | Blocks the Node event loop for up to 1h. The parent must run a wall-clock timer and react to it; sync calls cannot. Disqualified by the timeout requirement alone.            |
| `exec`        | Runs through a shell (`/bin/sh -c`). Case prompts are operator-supplied free text; passing them through a shell is a command-injection vector. Disqualified on security grounds. |
| `spawn` (✓)   | Streams stdout/stderr, non-blocking, no shell interpolation when `shell: false`. The right primitive.                                                                          |

### 2.2 Spawn invocation contract

> **Superseded in part by ADR-004 — see flipped `detached` + process-group
> signaling.** The `detached: false` line below is **superseded** by
> `detached: true`; signal escalation in §2.6 then targets the process
> group via `process.kill(-child.pid, SIG)` instead of the bare child
> PID. All other options (`cwd`, `env`, `shell: false`,
> `windowsHide`) are unchanged. See
> `benchmark/plans/adr-004-runner-process-group-signaling.md` for the
> full decision and code shape; backend implements per ADR-004, not the
> historical `detached: false` line preserved below for audit-trail
> continuity.
>
> **Further superseded by ADR-006 (v1.1, 2026-04-27)** — the
> `stdio: ["ignore", "pipe", "pipe"]` line is **superseded** by
> `stdio: ["pipe", "pipe", "pipe"]`. The new stdin pipe is the
> prompt-delivery channel; see ADR-006 for why this preserves §2.3's
> "prompt never in argv" invariant via a different mechanism. All
> other §2.2 options not touched by ADR-004 or ADR-006 remain
> unchanged. Backend implements per ADR-006; the historical
> `["ignore", "pipe", "pipe"]` line below is preserved for audit-trail
> continuity.

```text
child_process.spawn(
  "claude",                  // resolved from $PATH; not an absolute path
  [/* args — backend's call in T2; see 2.3 */],
  {
    cwd: <runs/<id>/_workspace>,   // ADR-003 §Decision §1 — fresh fixture
    env: <sanitised — see 2.4>,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,                   // explicit, even though false is the default
    detached: false,                // SUPERSEDED by ADR-004 → detached: true
    windowsHide: true,              // operator may run on macOS/Linux/Windows
  },
)
```

- **`cwd: _workspace/`** — never the host repo. Locked by ADR-003.
- **`shell: false`** — non-negotiable. The prompt content does not pass
  through a shell at any layer. If the backend wants to feed the prompt
  to `claude`, it does so via a file passed by argv (e.g.,
  `--prompt-file <path>`) or stdin — not via shell substitution.
- **`stdio: ["ignore", "pipe", "pipe"]`** — no parent stdin into the
  subprocess. The runner is non-interactive by design. Stdout and stderr
  are piped so the runner can tee them to disk in real time.
- **`detached: false`** — *Historical reasoning, superseded by ADR-004.*
  Original intent: when the parent dies, the OS reaps the subprocess; we
  did not want orphaned `claude` processes outliving the runner. **This
  reasoning was incomplete:** signals to the immediate child do not
  propagate to grandchildren that `claude` itself spawns. Security's
  F3.1 finding showed the 1h cap is bypassable in the original model.
  ADR-004 flips to `detached: true` and signals the whole process group
  (`process.kill(-child.pid, SIG)`) so SIGTERM/SIGKILL reach every
  descendant; a parent-death handler keeps the group from outliving the
  runner. See `adr-004-runner-process-group-signaling.md` for the
  decision, scoring, and code shape backend implements.

### 2.3 Argv shape (backend confirms)

> **Superseded in part by ADR-006 (v1.1, 2026-04-27).** The default
> argv now reads `claude --print --add-dir <ws> [--model <name>]` with
> the prompt piped via stdin (not `--prompt-file`). `--add-dir`
> replaces `--workdir`. `--output-format stream-json` is no longer in
> the default — operators opt back in via
> `GUILD_BENCHMARK_ARGV_TEMPLATE` per README §10. The invariants below
> remain load-bearing; ADR-006 preserves them via a stdin pipe instead
> of a temp-file path. See `adr-006-runner-prompt-via-stdin.md` for the
> decision.

The exact `claude` argv is backend's call in T2 — it depends on which
`claude` CLI flags expose the data the importer needs. Architect commits
to the following invariants the argv must preserve:

- **Prompt is passed by file or stdin, not as a positional argument** so
  prompt content never appears in `ps`/process listings (security item).
- **Output is structured if at all possible.** If `claude` supports
  `--output-format stream-json` (or equivalent), the runner uses it; the
  parsed stream then becomes the source of `events.ndjson` lines. If no
  structured-output flag exists, the runner falls back to reading
  `_workspace/.guild/runs/<inner-id>/events.ndjson` post-exit (Guild's
  own hooks write this — see `guild-plan.md §13.2`).
- **No interactive flags.** `--print` (or whatever the non-interactive
  equivalent is) is mandatory. The runner has no TTY and refuses to
  spawn `claude` in interactive mode.

The runner records the resolved argv as `run.json.raw_command` (a single
string, joined and quoted) for audit. This satisfies the determinism
gate in `01-architecture.md §3` ("`raw_command`" field).

### 2.4 Environment sanitisation

The subprocess inherits a deliberately reduced env, **not**
`process.env`. The minimum viable allowlist (backend confirms exact
list in T2):

- `PATH` — required to locate `claude` (the same `PATH` the runner
  itself was launched with).
- `HOME` — `claude` reads its auth from `$HOME/.claude/`.
- `XDG_*` — `claude` may write under `$XDG_DATA_HOME` /
  `$XDG_CONFIG_HOME` on Linux.
- `LANG` / `LC_*` — locale; affects formatting of any human output.
- `TZ` — timezone; affects timestamps the model emits.
- `ANTHROPIC_*` / `CLAUDE_*` — anything `claude` reads as configuration.
  Forwarded as-is. Security-review (T6) decides if any specific var
  must be redacted from `_subprocess.stderr.log`.

Everything else is dropped. In particular, anything that looks like a
shell-injected variable (`PS1`, `ZSH_*`, etc.) is not forwarded;
unrelated tool tokens (`GITHUB_TOKEN`, `OPENAI_API_KEY`, …) are dropped.
This list is forward-referenced in the security review for hardening.

### 2.5 Stdio capture

> **Amended by ADR-006 (v1.1, 2026-04-27).** The stdin slot becomes
> active under v1.1 — runner-side writable, used to deliver the prompt
> bytes; closed after the prompt is written. stdin is **not** captured
> (only operator-supplied prompt content goes through it, and that
> content is already on disk in the case YAML). stdout + stderr capture
> is unchanged.

Both pipes are tee'd to disk in real time:

| Pipe   | Destination                                                                  | Encoding                                | Notes                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| stdout | `runs/<id>/artifacts/_subprocess.stdout.log`                                 | UTF-8, line-buffered                    | If `claude` emits structured stream-json, the parser also runs over the same byte stream and produces `runs/<id>/events.ndjson` directly.        |
| stderr | `runs/<id>/artifacts/_subprocess.stderr.log`                                 | UTF-8, line-buffered                    | Forensic only. Errors of interest are also surfaced as `EventLine{type:"tool_error"}` records (see §4).                                         |

Both files are append-only, opened with `O_APPEND` semantics, and
flushed on every newline. On any subprocess-exit code path (clean exit,
SIGTERM-induced exit, SIGKILL-induced exit, spawn failure), the runner
guarantees both streams are drained and closed before writing
`run.json`. This guarantees the post-mortem viewer (the `RawArtifactViewer`
leaf in `p2-ui-architecture.md §2`) always sees a complete log file
regardless of how the run terminated.

The path names `_subprocess.stdout.log` / `_subprocess.stderr.log` are a
**forward reference to security-review.md (T6)**. Security may require
a different convention (e.g., gz compression, redaction pass, alternate
extension); architect notes the FR and proceeds with the descriptive
default.

### 2.6 Signal escalation (1h timeout)

The 1h cap from spec §Constraints is enforced by the parent runner, not
by `claude`. The escalation timeline is locked here:

```text
t=0           spawn(claude, …)
t=T_budget    child.kill("SIGTERM")
              setTimeout(forceKill, 5000)
t=T_budget+5  if still alive: child.kill("SIGKILL")
              status = "timeout"
```

`T_budget` defaults to `3600 * 1000` ms (1h, spec). A Case YAML may
declare a tighter `timeout_seconds` (see `benchmark/src/types.ts §Case`);
the runner uses `min(case.timeout_seconds, 3600)` so a Case can never
extend the global cap. The 5-second SIGTERM→SIGKILL window is fixed
(not Case-configurable) — it is a *cleanup grace period*, not a
benchmark variable.

Behaviour on signal:

- **Clean exit before timeout** → status determined by exit code (§4).
- **SIGTERM-induced exit within 5s** → status = `timeout`. The runner
  still attempts artifact capture (best-effort) and marks
  `partial: true` on `run.json` if capture is incomplete.
- **SIGKILL-induced exit at 5s** → status = `timeout`,
  `partial: true`. Capture is best-effort; some artifacts may be
  half-written. The importer + scorer handle partial-artifact runs per
  `01-architecture.md §"Cross-cutting: missing / partial artifact"`.

**Out of scope (forward reference to security-review.md):** orphaned
grandchildren. If `claude` itself spawns child processes (e.g., to invoke
sub-tools) and those outlive `claude`, the runner does not currently
escalate signals to them. Security-review (T6) decides whether to use
process groups (`detached: true` + `setpgid`) or other isolation
(cgroups, jails). Architect's call: do not add complexity until security
threat-models the surface.

## 3. Artifact-capture protocol

**Mode: fresh-fixture clone per run.** This is the cwd model locked by
**`adr-003-host-repo-vs-fresh-fixture.md`** §Decision. The full Option
scoring lives in that ADR; this section is the *operational* protocol
the backend implements.

### 3.1 Pre-run

1. Read the case (`Case` from `case-loader.ts`) and resolve its
   `fixture` field to an absolute path. The case loader's existing
   schema validation guarantees the fixture path exists and is a
   directory.
2. Compute the workspace path: `runs/<id>/_workspace/` (sibling of
   `runs/<id>/artifacts/`). Confirm it does not already exist; refuse
   to start otherwise (the run-id is supposed to be unique).
3. Recursively copy the fixture into the workspace:
   `fs.cp(fixturePath, workspaceDir, {recursive: true,
   errorOnExist: true, dereference: false, preserveTimestamps: true,
   force: false})`.
   - `dereference: false` — symlinks stay symlinks (security-review
     decides whether to refuse them, see §3.4).
   - `preserveTimestamps: true` — so any time-sensitive code in the
     subprocess sees baseline mtimes, not "now".
4. Verify the workspace contains a `.guild/` directory at the expected
   relative path (the fixture must be a benchmarkable repo). If not,
   abort with `RunStatus = "errored"` and `missing_artifacts:
   ["fixture/.guild"]`.

### 3.2 During the run

The subprocess writes freely under `_workspace/` (per the fresh-fixture
isolation guarantee from ADR-003 — that is the entire point). The runner
does **not** observe writes during the run; there is no file-watcher,
no inotify hook, no streaming capture. The contract is post-exit.

The only writes the runner itself performs during the run are:

- streaming `_subprocess.stdout.log` / `_subprocess.stderr.log` (§2.5);
- streaming `events.ndjson` if (and only if) `claude` is invoked with a
  structured-output flag whose stream the runner is parsing in flight.

Every other artifact path under `runs/<id>/artifacts/` is populated in
§3.3 below.

### 3.3 Post-run capture

After the subprocess exits (clean, SIGTERM, or SIGKILL — every code
path), the runner:

1. **Drains and closes the stdio tee streams** (§2.5).
2. **Captures `.guild/`:** `fs.cp(workspaceDir/.guild,
   runDir/artifacts/.guild, {recursive: true, dereference: false,
   preserveTimestamps: true, errorOnExist: true})`. No diffing — the
   *whole* post-run `.guild/` tree is the artifact, by ADR-003
   §Decision §3.
3. **Resolves `events.ndjson`** to the canonical path
   `runs/<id>/events.ndjson` (the location §3 of `01-architecture.md`
   names) by either:
   - moving / copying the in-flight-parsed events file into place if
     §2.3's structured-output path was taken, OR
   - reading
     `runDir/artifacts/.guild/runs/<inner-run-id>/events.ndjson` and
     copying it to `runs/<id>/events.ndjson`. (The "inner" run-id is
     `claude`'s — it is not the benchmark's `<id>`. A small helper
     enumerates `runs/<id>/artifacts/.guild/runs/` to find it; if more
     than one inner run exists, the runner picks the one whose
     `started_at` falls inside the runner's wall-clock window and logs
     the others as `tool_error` events.)
4. **Writes `run.json`** with the fields defined in
   `benchmark/src/types.ts §RunJson` (see §3.5 for the annotation
   contract).
5. **Cleans up `_workspace/`:** `fs.rm(workspaceDir, {recursive: true,
   force: true})`. Failure to clean is logged to
   `_subprocess.stderr.log` and surfaced as a `tool_error` event but
   does **not** alter `RunStatus` — the run already succeeded if it got
   here, and a leftover workspace is a janitorial concern, not a
   benchmarking one.
6. **Detects partial captures:** the runner checks for the presence of
   each expected artifact (`run.json` itself once written, `events.ndjson`,
   `.guild/runs/<inner>/run.json`, etc.). Anything missing is recorded
   in `run.json.missing_artifacts: []` and the scorer reads
   `partial: true` per `01-architecture.md §Cross-cutting: missing /
   partial artifact`.

### 3.4 Path-resolution rules (security-relevant)

Every captured destination is computed as:

```ts
const target = path.resolve(artifactsRoot, ...rel);
const relCheck = path.relative(artifactsRoot, target);
if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
  // refuse: would write outside artifacts root
}
```

Rules:

1. **Inputs are normalised before resolution.** Each relative path
   coming from the subprocess's tree is `path.normalize`d and any
   leading absolute markers (`/`, `\\`) stripped before being joined
   with `artifactsRoot`.
2. **Verify after resolve.** `path.relative(artifactsRoot, target)` is
   computed and rejected if it begins with `..` or is absolute. This
   catches both `../escape` patterns and absolute targets that
   `path.resolve` would otherwise accept.
3. **Symlinks.** `fs.cp({dereference: false})` preserves symlinks as
   symlinks rather than following them at copy time — but a symlink
   inside the captured tree could still point outside it. Architect's
   default: capture symlinks verbatim, do not follow at capture time;
   any consumer that *reads* a symlink (e.g., the artifact pass-through
   `GET /api/runs/:run_id/artifacts/*`) must apply the same path-resolve
   guard the server already uses (see `benchmark/src/server.ts` —
   `safeJoinUnder`).
4. **Refused captures are logged.** Every path the runner refuses to
   copy emits a `tool_error` `EventLine` with the original relative
   path so forensic analysis is possible without re-running.
5. **Forward reference to `benchmark/plans/security-review.md` (T6).**
   Security-review may require stricter rules — refusing all symlinks
   outright, allowlisting only paths under `.guild/`, content-type
   sniffing, refusing executables. The architect locks the *interface*
   (compute, verify, refuse, log) here; security locks the *policy*.

### 3.5 `run.json` annotation contract

The runner writes `runs/<id>/run.json` exactly once, after capture.
Fields are pulled from `benchmark/src/types.ts §RunJson`; this section
fixes how each is sourced:

| Field                  | Source                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`       | `SCHEMA_VERSION` constant from `types.ts`. Locked.                                                                         |
| `run_id`               | Caller-supplied (CLI `--run-id`) or generated per the trial-set convention (`<case-slug>-<plugin_ref_short>-<model_ref_hash>-<n>`). Backend confirms generator in T2. |
| `case_slug`            | `case.id` from the loaded Case YAML.                                                                                       |
| `plugin_ref`           | The git commit of the **fixture's** plugin checkout — read from a fixture-local metadata file (e.g., `_plugin_ref.txt`) so it is captured at fixture-build time, not subprocess time. Backend confirms file name. |
| `model_ref`            | Per-specialist model map. P3 source: extracted from captured events (`specialist_dispatched` lines that include model metadata) or from runner-config defaults. Backend confirms in T2. The contract: every dispatched specialist appears with a non-empty model id. |
| `started_at`           | ISO-8601 wall-clock at spawn time (parent's clock).                                                                         |
| `completed_at`         | ISO-8601 wall-clock at `child.on("exit")`.                                                                                  |
| `status`               | Result of the error/retry taxonomy below (§4).                                                                              |
| `raw_command`          | argv joined with shell-safe quoting. Audit-only.                                                                            |
| `wall_clock_ms`        | `Date.now()` delta between start and exit (parent measures; subprocess clock not trusted).                                  |
| `wall_clock_budget_ms` | `case.wall_clock_budget_ms` if set, else `case.timeout_seconds * 1000`.                                                    |

**Determinism gate (R2 from `01-architecture.md`).** `plugin_ref` and
`model_ref` are **mandatory** non-empty fields. If the runner cannot
populate either (e.g., fixture missing `_plugin_ref.txt`), it sets
`status: "errored"` with a `missing_artifacts` entry naming what was
missing — never silently emits a run with empty refs.

## 4. Error / retry taxonomy

Every subprocess exit path maps to exactly one `RunStatus` value
(`pass | fail | timeout | errored` per `benchmark/src/types.ts`).

### 4.1 Status mapping

| Subprocess outcome                                                 | `RunStatus` | Notes                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean exit, exit code 0; acceptance commands pass                  | `pass`      | **Acceptance commands are evaluated by the scorer**, not the runner. The runner only emits `acceptance_command` event lines (one per command, with exit code) — see `01-architecture.md §3` and `04-metrics.md` `outcome` component. |
| Clean exit, exit code 0; acceptance commands fail                  | `fail`      | Same separation: runner records, scorer evaluates. The runner sets `status: "pass"` only after the scorer confirms; in P3, the runner sets `status: "fail"` when **any** acceptance command emits a non-zero exit code in the captured events. |
| Timeout (SIGTERM/SIGKILL via the 1h cap)                           | `timeout`   | Even if the subprocess managed to write some artifacts before SIGTERM. `partial: true` may be set on `run.json` if capture is incomplete. **Timeouts score 0 on `outcome`** per `01-architecture.md §R3`.                    |
| Non-zero exit code (not timeout-induced)                           | `errored`   | Includes spawn failures (`ENOENT` for missing `claude` binary), abnormal termination (uncaught signals from inside the subprocess), and any non-zero exit the runner did not itself trigger.                                  |
| I/O error during capture (post-exit, after a clean exit-0)         | `errored`   | The subprocess succeeded but the runner could not capture. `partial: true`, `missing_artifacts: [...]` listing what could not be copied.                                                                                     |
| Spawn never produced any output (no stdout, no stderr, exit 0)     | `errored`   | Indicates a misconfigured `claude` binary on `$PATH` (e.g., a stub returning 0 immediately). Reported as `errored`, not `pass`, because the absence of any event stream means no benchmark signal can be derived.            |
| Empty workspace `.guild/` after a clean exit                       | `errored`   | The runner ran but `claude` produced no Guild artifacts at all. `partial: true`, `missing_artifacts: [".guild"]`.                                                                                                            |

### 4.2 Acceptance commands — runner scope vs scorer scope

To eliminate any ambiguity:

- **Runner's job:** observe and record. If the captured `events.ndjson`
  contains `acceptance_command` lines (Guild's hooks emit these — see
  `EventLine` in `types.ts`), the runner does not re-execute them; it
  passes them through verbatim. The runner only sets `status: "pass"`
  vs `status: "fail"` based on whether *every* recorded
  `acceptance_command` event has `exit_code: 0`.
- **Scorer's job:** weight. The `outcome` component in
  `04-metrics.md` reads the same event lines and translates them into
  the `outcome` weighted score; the runner does not.

This split is locked here so backend's T2 implementation does not
re-execute commands inside the runner (which would change the timing
profile, the cwd, and the security surface for no benefit).

### 4.3 Retries

**No retries in P3.** A failed run is recorded once. The operator
decides whether to re-invoke. This matches:

- the deterministic-replay invariant (spec §Constraints — runs are
  immutable; bumping anything produces a *new* `run-id`);
- ADR-003's fresh-fixture model (a retry inside the runner would have
  to either reuse the contaminated workspace or copy the fixture
  again — neither is what the operator usually wants without saying so);
- `01-architecture.md §R2` (model/plugin churn — silent retries
  inside a single invocation could smear refs across the retry
  boundary).

If the operator wants to retry a flaky run, they re-invoke the runner;
they get a new `run-id` and a clean comparison.

### 4.4 Partial-capture handling

Any captured-incompletely run sets `partial: true` on `run.json`. The
runner enumerates expected artifacts and records anything missing in
`missing_artifacts: []`. The scorer then zeroes affected components per
`01-architecture.md §"Cross-cutting: missing / partial artifact"`. This
is *not* a separate status; a `partial: true` run can be `pass`, `fail`,
`timeout`, or `errored` depending on the underlying subprocess outcome.

### 4.5 Untrusted prompt content

Case prompts are operator-supplied free text and the runner copies them
verbatim into events / receipts. The architect's default: **do not
sanitise.** The downstream consumers (UI, importer) are the safe
rendering surfaces; the on-disk artifacts are the audit trail and must
preserve fidelity. Any sanitisation would mask what `claude` actually
saw and therefore break the determinism gate.

**Forward reference to `benchmark/plans/security-review.md` (T6).** If
security threat-models concrete attack vectors (prompt-injection-driven
filesystem writes, attempts to exfiltrate env vars, attempts to escape
the workspace), it can layer mitigations (allowlist of writable paths,
env redaction in `_subprocess.stderr.log`, output-side sanitisation in
the server's pass-through endpoint). Architect locks the *capture
fidelity* invariant; security threat-models the *interpretation* layer.

## 5. Cross-references

- **`benchmark/plans/adr-001-runner-ui-boundary.md` §Decision** — the
  server reads `runs/<id>/{run.json, events.ndjson, metrics.json,
  score.json, artifacts/.guild/}`. This document fixes how those files
  get *written* by the runner. The on-disk shape is the same shape the
  server (P2) is already coded against in `benchmark/src/server.ts`.
- **`benchmark/plans/01-architecture.md` §1** — component diagram.
  `runner.ts` is the box at the top of the P3 column; this document
  expands that box. The arrow `RUNNER -.-> RUNS` is operationalised
  here (§3).
- **`benchmark/plans/01-architecture.md` §3** — data-flow walkthrough.
  Every artifact named there as "P3: `runner.ts`" is produced by the
  steps in §3 of this document. The contract table is the contract this
  runner satisfies; nothing in this design adds artifacts not in that
  table.
- **`benchmark/plans/p2-ui-architecture.md` §3** — UI's `RunDetailPage`
  consumes `RunJson`, `MetricsJson`, `Score`, `EventLine[]`. This
  runner produces `run.json` and `events.ndjson` exactly to those
  shapes; nothing changes for the UI between P1 (importer-produced) and
  P3 (runner-produced) inputs.
- **`benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md`** — pinned
  decision behind §3's fresh-fixture mode. Option scoring + alternatives
  considered live in the ADR, not here.
- **`benchmark/src/types.ts`** — `RunStatus`, `EventLine`, `RunJson`,
  `Stage`, `Case`, `MetricsJson`. The runner emits values typed exactly
  to these interfaces. The importer's zod schema validates the same
  bytes the runner writes; if they ever disagree, the importer is the
  arbiter (§4 of `01-architecture.md` R4).
- **Forward reference: `benchmark/plans/security-review.md` (T6)** —
  security threat-models the surface this design pins. Specific
  forward-reference points (collected for the security lane's
  convenience):
  - §2.4 environment sanitisation allowlist;
  - §2.5 `_subprocess.{stdout,stderr}.log` filenames + redaction;
  - §2.6 orphaned-grandchildren handling (process groups, cgroups,
    container isolation);
  - §3.4 path-resolution policy (symlinks, allowlists,
    content-type sniffing);
  - §4.5 untrusted prompt content / output-side sanitisation.

## 6. Files added

These are the files this lane (T1-architect for P3) creates. Listed
here so technical-writer (T5) can update `benchmark/plans/00-index.md`
per their lane.

- `benchmark/plans/p3-runner-architecture.md` (this file)
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md`

No implementation code is added by this lane — `runner.ts` itself is
backend's T2 deliverable, against the contract this document fixes.

## 7. Open questions and follow-ups (routed to other lanes)

- **Exact `claude` argv shape.** §2.3 commits to invariants but leaves
  the precise flag set to backend in T2. Backend confirms structured-
  output flag availability and updates this document if the fallback
  path (read `_workspace/.guild/runs/<inner>/events.ndjson` post-exit)
  becomes the only path. → **backend (T2)**.
- **Fixture metadata file for `plugin_ref`.** §3.5 sketches
  `_plugin_ref.txt` as the source for `run.json.plugin_ref`. Backend
  confirms file name + content format in T2; technical-writer (T5)
  documents it in `02-case-suite.md`. → **backend (T2)**, **technical-
  writer (T5)**.
- **Per-specialist `model_ref` extraction.** §3.5 names two candidate
  sources (event metadata vs runner-config defaults). Backend picks one
  in T2 and documents the extraction rule. The architect's hard
  invariant: every dispatched specialist appears in `model_ref` with a
  non-empty model id. → **backend (T2)**.
- **Orphaned-grandchildren containment.** §2.6 declares this out of
  P3 architecture scope, forward-referenced to security. → **security
  (T6)** — recommend or reject process-group isolation; if recommended,
  ADR-004 captures the change and backend implements.
- **`_subprocess.{stdout,stderr}.log` retention.** No retention policy
  is specified; logs accumulate per run-id under `artifacts/`. If
  operators routinely produce thousands of runs, disk pressure becomes
  real. Out of P3 scope; flag for ops-runbook authorship later. →
  **followup**.
