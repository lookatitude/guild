---
type: adr
id: ADR-008
slug: interactive-claude-harness
phase: P3 (v1.3 deferred-cleanup; design for v2)
spec: .guild/spec/v1.3.0-deferred-cleanup.md
plan: .guild/plan/v1.3.0-deferred-cleanup.md
design: benchmark/plans/p3-runner-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-27
supersedes: []
superseded_by: []
---

# ADR-008 — Interactive `claude` harness for full-lifecycle benchmark runs (v2 design)

## Status

**Accepted (design only)** — 2026-04-27 as part of v1.3 deferred-
cleanup.

This ADR is the **v2 path** past the limitation captured in
`.guild/wiki/decisions/benchmark-runs-raw-claude-not-guild-lifecycle.md`.
v1.3 ships the design; the runner change does **not** ship in v1.3.
Implementation begins when the §Re-entry trigger fires.

## Context

The current runner default (per
`.guild/wiki/decisions/runner-claude-v2.x-default-argv.md` and
`benchmark/plans/adr-006-runner-prompt-via-stdin.md`) invokes:

```text
claude --print --add-dir <ws> [--model <name>]
```

with the prompt piped on stdin. The structural problem this design
addresses: **`claude --print` does not load plugins**. The Guild
plugin's `/guild` lifecycle (brainstorm → team → plan → context →
execute → review → verify → reflect) only runs in interactive
`claude` sessions where the plugin is registered.

Documented consequence (verbatim from
`.guild/wiki/decisions/benchmark-runs-raw-claude-not-guild-lifecycle.md`):

> when the benchmark runner spawns `claude --print --add-dir <ws>`
> and pipes a prompt, the model sees the prompt as a regular request
> — it does not run the Guild lifecycle. No `events.ndjson`, no stage
> emissions, no specialist dispatch records, no gate decisions. The
> scorer is faithful to this: with no `events.ndjson`, the
> `outcome` / `delegation` / `gates` components score 0 (with
> explicit `reason: "missing_artifact"`). Live runs cap at ~30/100
> max (evidence + loop_response + efficiency only).

That decision documented the **partial-scoring stance** for v1.x
(`run_kind: "raw_model"` annotation; comparators warn on cross-kind
mixes). It is the right v1.x stance — it preserves the karpathy
"keep raw logs" principle and refuses to manufacture an
`events.ndjson` from stdout. But it caps the benchmark factory's
ceiling at ~30/100 for any case where the operator wants to score
the *Guild lifecycle's behaviour* (delegation, gating, artifact
correctness) rather than the raw model's behaviour. v2 needs a
mechanism that produces a real `events.ndjson` from a real Guild
lifecycle execution against the same case fixtures the v1.x runner
uses.

The architectural shape this ADR commits to: **spawn `claude` in
interactive mode (no `--print`) with the Guild plugin pre-loaded**,
then drive the prompt-and-completion exchange programmatically over
a PTY. This trades a stdin pipe for a PTY write surface; ADR-006's
"prompt never in argv" invariant is preserved (the prompt is written
to the PTY, not argv); ADR-003's fresh-fixture clone and ADR-004's
process-group signaling continue to apply.

## Drivers

| ID  | Driver                                                                                              | Source                                                                                  | Why it matters                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **`events.ndjson` must be real, not synthesized.**                                                  | spec §"keep raw logs"; runner-not-guild-lifecycle decision §Options/A rejection         | The whole point of the benchmark factory is that artifacts come from the real lifecycle; manufacturing `events.ndjson` from stdout defeats the purpose. |
| D2  | **The Guild plugin must be pre-loaded so `/guild` is recognised.**                                  | runner-not-guild-lifecycle decision §Context                                            | `claude --print` does not load plugins; the harness must use a code path that does.                                                              |
| D3  | **Prompt delivery must remain off the process listing.**                                            | ADR-006 §P3 invariants §1; security-review §F1.5                                        | The "prompt never in argv" invariant survives — the prompt is written to the PTY, not as a positional argument.                                  |
| D4  | **Determinism: same fixture, same prompt, same outcome shape across runs.**                         | ADR-003 §Decision §3 (fresh-fixture invariant)                                          | The harness must clone-per-run identically to ADR-003; the PTY change does not affect cwd or workspace setup.                                    |
| D5  | **The harness must terminate cleanly — interactive `claude` does not exit on EOF.**                 | spec §Constraints (1h cap); ADR-004 §Decision §1 (hard cap)                             | A PTY-driven session needs a "we are done, exit" trigger (sentinel string, idle timeout, or explicit `/exit` command); the 1h cap remains the hard backstop. |
| D6  | **Process-group signaling must still cover descendants.**                                           | ADR-004 §D1, D2, D3                                                                     | Switching the parent-child interface from `child.stdin` to a PTY does not change the threat model for grandchildren; ADR-004 still applies.       |
| D7  | **The harness must be reviewable + testable without a live `claude` install.**                     | spec §Constraints (mocked tests insufficient but necessary)                              | Unit tests must be able to FakeChild a PTY-driven session; live smoke is the integration evidence.                                                |
| D8  | **The harness is v2 — design now, build when the operator case is concrete.**                       | F10 ledger; cluster-2 disposition (user-approved 2026-04-27)                            | Building untested PTY plumbing without an operator case to drive the test cases is premature; design is what ships in v1.3, code in v2.            |

## Options considered

### Option A — PTY-driven interactive harness (recommended for v2)

Spawn `claude` (no `--print`) with the Guild plugin pre-loaded
(via the operator's `~/.claude/plugins/` registration, which is the
same mechanism that loads the plugin for normal interactive use).
Allocate a PTY pair via `node-pty` or the platform's `openpty(3)`
equivalent; wire the master side to the runner; the slave side is
the child's stdio. The runner writes the prompt to the master; reads
the model's response from the master; recognises a completion
sentinel (or `/exit`) and closes the session.

The `events.ndjson` is produced naturally because the Guild plugin's
hooks (`Stop`, `SubagentStop`, lifecycle stage emissions) write to
`<ws>/.guild/runs/<inner-id>/events.ndjson` under the cloned
fixture's `.guild/` tree — exactly the path the v1.x runner already
expects per `01-architecture.md §"Cross-cutting"`.

**Spawn shape change.** Where ADR-006 specifies `stdio: ["pipe",
"pipe", "pipe"]` and pipes the prompt to `child.stdin`, ADR-008
specifies `stdio: pty.slave` (the PTY's slave end) and writes the
prompt to `pty.master`. The change is *the parent-child interface*,
not the cwd, env, signal, or workspace contracts.

### Option B — Embed Guild as a library; call its lifecycle directly

Refactor the Guild plugin so its `/guild` lifecycle can be invoked
as a Node library function rather than as a slash-command in an
interactive `claude` session. The benchmark runner imports the
library, hands it the case prompt, runs the lifecycle in-process,
captures `events.ndjson` directly.

**Why rejected:** requires a major refactor of every Guild plugin
component to be importable as a library — slash commands, hooks,
agents are currently authored as `claude`-plugin artifacts and
dispatched by `claude` itself. Decoupling them is months of work
that touches every specialist's contract; the test surface
explodes; the resulting library would be a parallel implementation
of the lifecycle, not the same code path operators run interactively.
The benchmark would then measure the library, not the production
plugin. Defeats the purpose.

### Option C — Accept the partial-scoring limit forever

Document `~30/100` as the live-run ceiling permanently; never build a
Guild-lifecycle harness; treat raw-model scoring as the only
benchmark signal.

**Why rejected:** defeats the benchmark factory's purpose. The whole
point of the factory (per `01-architecture.md §1`) is to score the
Guild lifecycle's behaviour against fixture cases — delegation
correctness, gate decisions, artifact production. A permanent ~30%
ceiling means three of the four scoring components (`outcome`,
`delegation`, `gates`) never produce a meaningful score, leaving only
`evidence` + `loop_response` + `efficiency`. The v1.x stance is
"document the limit until v2 builds the harness"; making that
permanent contradicts the cluster-2 disposition the user approved
2026-04-27.

### Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect importance.

| Driver                                            | Weight | A — PTY harness (v2) | B — Library refactor | C — accept partial forever |
| ------------------------------------------------- | -----: | -------------------: | -------------------: | -------------------------: |
| **D1 — Real `events.ndjson` (not synthesized)**   |     5  | **5**                | **3**                | **1**                      |
| **D2 — Guild plugin pre-loaded**                  |     5  | **5**                | **5**                | **1**                      |
| **D3 — Prompt off the process listing**           |     4  | **5**                | **5**                | **5**                      |
| **D4 — ADR-003 determinism preserved**            |     4  | **5**                | **4**                | **5**                      |
| **D5 — Clean termination**                        |     4  | **4**                | **5**                | **5**                      |
| **D6 — ADR-004 process-group signaling preserved** |    4  | **5**                | **4**                | **5**                      |
| **D7 — Testable without live `claude`**           |     3  | **4**                | **5**                | **5**                      |
| **D8 — v2 design-now, build-when-concrete**       |     3  | **5**                | **2**                | **3**                      |
| **Weighted total**                                |    —  | **(5·5)+(5·5)+(4·5)+(4·5)+(4·4)+(4·5)+(3·4)+(3·5) = 154** | **(5·3)+(5·5)+(4·5)+(4·4)+(4·5)+(4·4)+(3·5)+(3·2) = 129** | **(5·1)+(5·1)+(4·5)+(4·5)+(4·5)+(4·5)+(3·5)+(3·3) = 109** |

A wins **154 vs. 129 (B) vs. 109 (C)**. A wins decisively on D1
(real artifact, not synthesized) and D8 (small, scoped change to the
spawn interface vs. B's full library refactor).

## Decision

**We choose Option A — PTY-driven interactive harness.** Design ships
in v1.3; implementation is deferred to v2.

Concrete commitments locked by this decision:

1. **The harness is a new spawn mode**, not a replacement of the
   existing default. The current `claude --print --add-dir <ws>`
   path remains the default for `run_kind: "raw_model"` runs.
   ADR-008's harness ships as `run_kind: "guild_lifecycle"` with an
   explicit operator opt-in (env var or case-field; specifics
   reserved for the v2 implementation lane).
2. **Spawn shape (v2).**
   ```text
   const { spawn: ptySpawn } = require("node-pty");  // or equivalent
   const child = ptySpawn("claude", [
     "--add-dir", workspaceDir,
     // NO --print — interactive mode
     // --model <name> if model_ref.default is set
   ], {
     name: "xterm-color",
     cols: 80,
     rows: 24,
     cwd: workspaceDir,           // ADR-003 — fresh-fixture clone
     env: sanitisedEnv,           // §2.4 allowlist (preserved)
     // PTY allocation replaces stdio: ["pipe","pipe","pipe"];
     // node-pty's child handle still supports kill/group-signaling.
   });
   ```
   - `cwd` and `--add-dir` continue to point at the fresh fixture
     (ADR-003 invariant preserved).
   - `env` continues to be the §2.4 sanitised allowlist (unchanged).
   - `detached: true` and process-group signaling continue per
     ADR-004 — `node-pty` exposes the child PID; the runner sends
     `process.kill(-pid, SIG)` (POSIX) / `taskkill /T /F` (Windows,
     when ADR-005 implements) the same way.
3. **Prompt delivery.** The runner writes the prompt to the PTY
   master:
   ```text
   pty.write(promptText);
   pty.write("\r");  // submit
   ```
   - The prompt **never appears in argv** (D3 / ADR-006 §P3
     invariant §1 preserved). The mechanism is different (PTY write
     vs. stdin pipe) but the invariant is identical.
   - PTY echo: the runner sets `pty.setEcho(false)` if the platform
     supports it; otherwise it filters echoed bytes out of the
     captured transcript before writing to
     `_subprocess.stdout.log`.
4. **Completion detection (D5).** The harness terminates the session
   on the first matching sentinel:
   - **Primary:** the Guild plugin's `Stop` lifecycle hook fires and
     writes a final line to `events.ndjson` (the existing v1.x hook
     contract — see `guild-plan.md §13.2`). The harness watches
     the workspace's `.guild/runs/<inner-id>/events.ndjson` (via
     `chokidar` or `fs.watch`); when a `{type: "lifecycle_stop"}`
     line lands, the harness sends `/exit\r` to the PTY and waits
     for the child to exit.
   - **Secondary:** an idle timeout — if no PTY output for 120
     seconds (operator-tunable via `GUILD_BENCHMARK_PTY_IDLE_MS`),
     the harness sends `/exit\r`.
   - **Backstop:** the 1h wall-clock cap from ADR-004 — SIGTERM at
     `T_budget`, SIGKILL at `T_budget + 5s`. Process-group signaling
     ensures every descendant the lifecycle spawned terminates.
5. **`events.ndjson` capture.** The runner reads the file at
   `<ws>/.guild/runs/<inner-id>/events.ndjson` (the path the Guild
   plugin's hooks already write). It does **not** generate this
   file; it copies it from the fresh-fixture workspace into the
   run's `runs/<id>/artifacts/events.ndjson` slot during the
   artifact-capture step (per `01-architecture.md §3`). The scorer's
   existing `outcome` / `delegation` / `gates` components consume it
   unchanged.
6. **`run_kind` annotation.** Runs from the harness annotate as
   `run_kind: "guild_lifecycle"` (the existing v1.x field from the
   runner-not-guild-lifecycle decision). Comparators warning on
   cross-kind mixes (per FOLLOWUPS F9 / v1.2 closure) continue to
   apply: a `raw_model` run and a `guild_lifecycle` run of the same
   case are **not** comparable directly; the warning is correct.
7. **What this ADR does NOT decide.** Implementation specifics
   reserved for the v2 lane:
   - Which PTY library (`node-pty` vs. `tmate`-shaped vs. direct
     `openpty(3)` via N-API).
   - Exact env-var names for opt-in and idle-timeout (the
     `GUILD_BENCHMARK_PTY_IDLE_MS` above is illustrative).
   - The `lifecycle_stop` event-line schema — coordinated with
     `guild-plan.md §13.2` at v2 implementation time.
   - Whether the harness defaults to model-selection-aware idle
     timeouts (longer for slower models).
8. **No code in v1.3.** The runner's spawn path remains the v1.2
   stdin-pipe default. ADR-008 ships as documentation; v2 builds
   per this design.

## Re-entry trigger

This ADR is **deferred-with-reason** at the *implementation* level.
Implementation begins when **any one** of the following observable
signals fires:

1. **v2 release window opens** — the project sets a v2 milestone
   that explicitly includes the interactive-harness lane. ADR-008's
   §Decision becomes the v2 lane brief; backend (with security review
   on the new PTY surface) implements per the §Decision shape.
2. **An operator's case absolutely requires `events.ndjson`** — a
   real case lands where partial scoring (~30/100 cap on `raw_model`
   runs) is unacceptable for the operator's purpose. "Absolutely
   requires" means the operator has filed a concrete case YAML where
   `outcome` / `delegation` / `gates` scoring matters and they
   cannot proceed without it.
3. **A second operator surfaces with the same partial-scoring
   complaint within a single release window** — the F10 ledger
   entry can carry indefinitely if no operator has hit the limit;
   if two operators independently hit it inside one release cycle,
   the deferral cost has flipped above the build cost.

When the trigger fires, the implementing specialist (backend) reads
this ADR §Decision, picks the PTY library (§Decision §7 reserved
choice), implements the spawn-mode branch alongside the existing
ADR-006 default, and adds:

- Unit tests with FakeChild PTY (mocking `node-pty` or equivalent),
  asserting prompt-write, sentinel-detection, idle-timeout, and
  process-group signal propagation.
- Live smoke against real `claude` interactive mode with the Guild
  plugin loaded; assert `run.json.run_kind === "guild_lifecycle"` and
  `events.ndjson` is non-empty and parseable.
- Integration against an existing case fixture (e.g., `smoke-noop`
  or `demo-url-shortener-build`) — same case, both `run_kind`
  modes, scores documented and compared.

If none of the three triggers fires, ADR-008 stays accepted-but-
unimplemented. The discipline this ADR enforces: the deferral has a
concrete v2 milestone or an operator-driven re-entry; "we'll get to
v2 eventually" is not the trigger.

## Consequences

### Positive

- **Closes FOLLOWUPS F10 with a designed-and-pinned shape.** The
  ledger entry flips from "deferred — architectural" to "deferred —
  v2 milestone, design ADR-008." Future architects do not re-design;
  v2 backend implements per this ADR.
- **The ~30/100 ceiling becomes a v1.x property, not a permanent
  property.** Operators reading the runner-not-guild-lifecycle
  decision now have a forward path; the partial-scoring stance is
  preserved as the v1.x answer, ADR-008 is the v2 answer.
- **Preserves every load-bearing v1.x invariant.** ADR-003 fresh-
  fixture, ADR-004 process-group signaling, ADR-006 prompt-not-in-
  argv all carry forward — only the parent-child interface
  primitive changes (PTY in place of stdin pipe). The mental model
  for ops/security stays identical.
- **No code surface in v1.3.** Zero rollback risk; the runner is
  unchanged; tests are unchanged; live smoke is unchanged. ADR-008
  is documentation that v2 will turn into code.

### Negative — accepted trade

- **PTY plumbing adds dependency surface in v2.** `node-pty` (or
  equivalent) is a native addon — same dependency-cost concern that
  ADR-005 §Option B (Job Objects) ran into. The cost is justified
  here because there is no Node-native alternative for PTY
  allocation; for ADR-005, `taskkill` shell-out avoided it. v2's
  security review will need to threat-model the PTY surface (a new
  bidirectional FD pair the runner writes to) — flagged for security
  in the v2 lane.
- **The `lifecycle_stop` sentinel is a coordination point with the
  Guild plugin.** ADR-008 assumes the plugin's `Stop` hook writes a
  recognisable `events.ndjson` line. If the plugin's event schema
  changes, the harness's completion detection breaks. v2 must add an
  integration test that pins the schema; if the schema is in flux,
  the harness watches for *any* event line whose `type` field
  matches a regex like `^(lifecycle_stop|stop|done)$` to reduce
  brittleness.
- **PTY echo / control-character handling is platform-specific.**
  macOS, Linux, and Windows PTYs differ in cooked/raw mode defaults.
  The harness must normalise; the v2 implementation lane should
  document which `termios` flags it sets and why.
- **An interactive `claude` may emit a TUI (cursor moves, ANSI
  escapes) that pollutes the captured transcript.** The harness
  must filter ANSI escapes when writing to
  `_subprocess.stdout.log` (so the post-mortem viewer renders
  cleanly) but preserve the raw byte stream in a separate
  `_subprocess.pty.raw.log` file for forensic completeness. Open
  question for v2; flagged in §Decision §7.
- **The `run_kind` comparator-warning surface gets a real workout.**
  Today's cross-kind warning fires on `raw_model` vs.
  `guild_lifecycle` mixes (v1.2 closure, FOLLOWUPS F9). When ADR-008
  ships, operators will run both kinds against the same fixtures and
  compare them; the warning's UX needs review (a warning that fires
  on every meaningful comparison is noise — v2 may need to
  *suppress* the warning when the operator explicitly asks for a
  cross-kind comparison via a flag).

### Forward implications (for v2 implementation lane)

- **Backend (v2)** — implements per §Decision §1–§7 in `runner.ts`.
  The new code path branches on `run_kind` (or an opt-in env var):
  raw_model → existing stdin-pipe default; guild_lifecycle →
  PTY harness. The two paths share `cwd`, env, signal-escalation,
  and artifact-capture code.
- **security (v2)** — threat-models the PTY write surface. New
  considerations: bidirectional FD pair (the runner can theoretically
  inject keystrokes into a model session that may have privileged
  tool access via the Guild plugin); a malicious `claude` (which the
  threat model already includes) could try to exfiltrate via the PTY
  in a way the stdin-pipe model ruled out. R7 / F-series review
  required.
- **qa (v2)** — adds the test harness. FakeChild for `node-pty`;
  integration tests against real `claude` interactive; cross-platform
  PTY assertion (Windows ConPTY behaves differently from POSIX
  PTY).
- **technical-writer (v2)** — README §10 entry for the opt-in env
  var; a runbook section on `run_kind: "guild_lifecycle"` and what
  operators get from it (real `events.ndjson`, full-component
  scoring).
- **architect (v2)** — superseding ADR if the chosen PTY library or
  the spawn shape diverges materially from §Decision §2; the §
  Decision §7 reserved choices are not yet ADR-worthy but become so
  if v2 picks something exotic.

## What this does *not* change

- **ADR-003** — fresh-fixture clone. cwd remains
  `runs/<id>/_workspace/` for both run-kinds. The `.guild/runs/
  <inner-id>/events.ndjson` path the harness reads is *inside* that
  fixture, not in the host repo.
- **ADR-004** — process-group signaling. SIGTERM/SIGKILL escalation
  via `process.kill(-pid, SIG)` is unchanged. `node-pty` (or
  equivalent) exposes the child PID; the runner signals the group
  the same way.
- **ADR-005** — Windows process-group signaling. `taskkill /T /F`
  remains the Windows analogue when both ADR-005 and ADR-008
  implement.
- **ADR-006** — prompt via stdin (raw_model default). ADR-008 does
  **not** supersede ADR-006; it adds a *second* spawn mode beside
  it. Raw_model runs continue to use the ADR-006 stdin-pipe shape.
  The `run_kind` field disambiguates which spawn shape produced a
  given run.
- **ADR-007** — RSS WARN. The 80%-threshold WARN applies regardless
  of spawn mode; an interactive `claude` session can balloon RSS
  the same way a `--print` session can.
- **§2.4 env allowlist.** Same allowlist for both spawn modes. The
  PTY harness does not introduce any new env-forwarding requirement.
- **The runner-not-guild-lifecycle decision.** Stays accepted as the
  v1.x stance. ADR-008 is the v2 successor *path*; the wiki decision
  documents the v1.x behaviour and ADR-008 documents the v2 shape.
  Both remain durable.

## References

- `.guild/wiki/decisions/benchmark-runs-raw-claude-not-guild-lifecycle.md`
  — the foundation decision. ADR-008's §Context cites it directly;
  ADR-008 is the v2 path past the limitation it documents.
- `.guild/wiki/decisions/runner-claude-v2.x-default-argv.md` — the
  v1.x default-argv decision (mirrors ADR-006). ADR-008's spawn shape
  diverges from this for `run_kind: "guild_lifecycle"` runs.
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md` — the
  fresh-fixture invariant ADR-008 preserves.
- `benchmark/plans/adr-004-runner-process-group-signaling.md` — the
  process-group signaling that continues to apply (with ADR-005 on
  Windows).
- `benchmark/plans/adr-006-runner-prompt-via-stdin.md` — the v1.x
  prompt-delivery ADR. ADR-008 is **additive** to ADR-006, not a
  supersession; the two coexist behind `run_kind`.
- `benchmark/plans/p3-runner-architecture.md §2.2 / §2.5` — the
  spawn-options table and stdio capture sections; v2 implementation
  will add a "PTY mode" subsection beside the existing stdin-pipe
  shape.
- `benchmark/plans/01-architecture.md §3` — the artifact-capture
  protocol; `events.ndjson` is part of the artifact set the scorer
  consumes.
- `benchmark/FOLLOWUPS.md §F10` — the ledger entry this ADR closes
  (design-deferred-implementation).
- `guild-plan.md §10.3` — decision-routing rule (this ADR is the
  significant-architectural-decision capture for the v2 spawn-mode
  branch).
- `guild-plan.md §13.2` — Guild plugin hooks; the `Stop` hook that
  writes the `lifecycle_stop` line ADR-008 §Decision §4 watches for.
