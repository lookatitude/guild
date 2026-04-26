---
type: adr
id: ADR-004
slug: runner-process-group-signaling
phase: P3
spec: .guild/spec/benchmark-factory.md
plan: .guild/plan/benchmark-factory-p3.md
design: benchmark/plans/p3-runner-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-26
supersedes:
  - benchmark/plans/p3-runner-architecture.md §2.2 (the `detached: false` line only)
superseded_by: []
---

# ADR-004 — Runner subprocess: detached + process-group signal escalation

## Status

**Accepted** — 2026-04-26.

This ADR amends the locked
`benchmark/plans/p3-runner-architecture.md §2.2` `spawn` options. The
`detached: false` line is **superseded** by `detached: true` plus
process-group signaling. All other §2.2 options remain unchanged. §2.6's
SIGTERM→5s→SIGKILL timeline is preserved; only the *signaling target*
changes (the process group instead of the immediate child PID).

## Context

`p3-runner-architecture.md §2.2` originally specified
`detached: false`. The reasoning was bound to a single-child model: when
the parent dies, the OS reaps the subprocess; we did not want orphan
`claude` processes outliving the runner.

Security's P3 review
(`benchmark/plans/security-review.md` F3.1, routed via
`.guild/runs/run-2026-04-26-benchmark-factory-p3/handoffs/T6-security.md`
§route: architect — A1) surfaced the failure mode that decision missed:

- `claude` is itself a complex CLI that **spawns sub-processes** (tool
  invocations, MCP servers, anything it shells out to internally).
- With `detached: false`, the parent runner's `child.kill(SIGTERM)` (and
  the 5-second escalation to `SIGKILL`) signal **only the immediate
  child** — the `claude` PID. The OS does **not** propagate signals to
  the child's descendants automatically.
- A grandchild that survives `claude`'s death (because `claude` itself
  did not propagate signals correctly, or because the grandchild is in
  a separate session, or simply because POSIX does not forward signals
  through process trees by default) **escapes the 1h wall-clock cap**.
- The spec's `RunStatus = "timeout"` then becomes a soft constraint
  rather than a hard one: the runner reports `timeout` and exits, but
  CPU + filesystem activity continues unbounded on the operator's
  machine.

This contradicts the spec's §Constraints commitment that "1h wall-clock
cap per run" is enforced; it also contradicts ADR-003's
fresh-fixture-isolation property (a grandchild outliving the runner can
still be writing into `runs/<id>/_workspace/` after the runner has
declared the run finished and started cleanup).

The standard POSIX fix is to put the subprocess in its own process
group (via `detached: true` + `setpgid` semantics — Node's `spawn`
arranges this on POSIX when `detached: true`) and signal the **whole
group** by sending to a negative PID:
`process.kill(-child.pid, "SIGTERM")` then
`process.kill(-child.pid, "SIGKILL")` after the grace window. The OS
then propagates the signal to every descendant in the group.

## Drivers

| ID  | Driver                                                                                       | Source                                                  | Why it matters                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **The 1h wall-clock cap must be a hard constraint, not a soft one.**                         | spec §Constraints, §NFR                                 | Without process groups, a grandchild can run indefinitely; the cap is bypassable. Spec compliance fails.                              |
| D2  | **Fresh-fixture isolation must hold post-cleanup.**                                          | ADR-003 §Decision §3, §Consequences (Positive)          | A grandchild writing into `_workspace/` after cleanup violates ADR-003's "the directory the subprocess produced is the directory the benchmark stores" invariant. |
| D3  | **Operator's machine must not accrue zombie / runaway processes per run.**                   | spec §Audience (single operator); single-machine NFR    | Each leaked grandchild compounds; over many runs the operator's machine degrades silently.                                            |
| D4  | **Implementation must remain a small, self-contained Node API change.**                      | spec §Constraints (no extra runtime deps)               | The fix must not introduce containers, cgroups, or external supervisors. POSIX `setpgid` + group-signal is a Node-native primitive.   |
| D5  | **Parent runner death must not orphan the group.**                                           | F3.1 acceptance criterion; security M10                 | If the runner itself dies (uncaught throw, `SIGINT`), the subprocess group must die with it — otherwise the leak is worse than `detached: false`. |
| D6  | **Cross-platform behaviour: POSIX is in scope for P3; Windows is best-effort.**              | security R7 (Windows is unverified in P3); spec audience | Process-group semantics differ on Windows. POSIX is the supported path; Windows fallback is deferred.                                  |

## Options

### Option A — `detached: true` + process-group signal escalation (recommended)

`spawn(..., {detached: true, ...})` makes Node call `setsid()` (or
`setpgid()`) on POSIX so the child becomes the leader of a new process
group. The runner does **not** call `child.unref()` — the subprocess
remains tied to the parent's event loop for `on("exit")` accounting and
for the parent-death handler.

Signal escalation switches from `child.kill(SIG)` to
`process.kill(-child.pid, SIG)`:

```text
t=0           spawn(claude, …, {detached: true})
t=T_budget    process.kill(-child.pid, "SIGTERM")
              setTimeout(forceKill, 5000)
t=T_budget+5  if exitCode === null:
                process.kill(-child.pid, "SIGKILL")
              status = "timeout"
```

Parent-death handler:

```text
process.on("exit",   () => try { process.kill(-child.pid, "SIGTERM") } catch (ESRCH) {})
process.on("SIGINT", () => try { process.kill(-child.pid, "SIGTERM") } catch (ESRCH) {})
process.on("SIGTERM",() => try { process.kill(-child.pid, "SIGTERM") } catch (ESRCH) {})
```

Windows: the negative-PID syntax is not supported. P3 ships POSIX-only
correctness; Windows operators see best-effort behaviour
(`child.kill()` falls back to single-PID signaling). A future ADR
("ADR-005 — cross-platform runner") layers `taskkill /T /F`.

### Option B — Keep `detached: false`, hope `claude` propagates signals

Status quo. Relies on `claude` (and every tool `claude` invokes)
correctly propagating SIGTERM to its descendants. Verifiable only by
audit of `claude`'s internals; un-auditable from the runner side.
Documented but not enforced.

### Option C — Container or cgroup isolation per run

Wrap each subprocess in a container (Docker/Podman) or a Linux cgroup
v2 with a kill controller. Containers add a runtime dependency; cgroups
are Linux-only and require root or a delegated cgroup. Either way, the
implementation surface is large and platform-specific.

### Option D — External supervisor process

Spawn a small supervisor binary that owns the lifecycle and forwards
signals. Adds a process layer + a binary to ship + a coordination
protocol. Out of scope for a single-binary Node tool.

## Decision

**We choose Option A — `detached: true` + process-group signal
escalation.**

Concrete commitments locked by this decision:

1. **`§2.2` `detached:` flips to `true`.** All other `spawn` options
   (`cwd`, `env`, `stdio`, `shell: false`, `windowsHide`) are
   unchanged. The runner does **not** call `child.unref()` — the
   subprocess remains attached to the parent's event loop for exit
   accounting.
2. **Signal target is the process group**, never the bare child PID.
   The runner sends `process.kill(-child.pid, SIG)` for both SIGTERM
   (at `T_budget`) and SIGKILL (at `T_budget + 5s`). The 5-second
   escalation window from `§2.6` is preserved.
3. **Parent-death handler.** The runner installs handlers for
   `process.on("exit")`, `process.on("SIGINT")`, and
   `process.on("SIGTERM")` that call
   `process.kill(-child.pid, "SIGTERM")` if the child is still alive.
   Each handler swallows `ESRCH` (the group is already gone). This
   guarantees `D5` — runner death never orphans the group.
4. **POSIX-only correctness in P3.** On Windows, the runner falls back
   to `child.kill()` single-PID semantics. The Windows path is
   *unverified*; security R7 already documents this. ADR-005 (future)
   adds `taskkill /T /F`.
5. **`§2.6` timeline is unchanged** in shape: SIGTERM at `T_budget`,
   SIGKILL after 5 seconds. Only the signaling primitive changes.
6. **Backend's M10 acceptance test** (security handoff Q9) is the
   integration evidence: shell-stub spawns a `(sleep 5400) &`
   grandchild; after `T_budget + 5s`, `process.kill(grandchildPid, 0)`
   throws `ESRCH` and `pgrep -f sleep` returns empty.

## Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect the
driver's relative importance.

| Driver                                                                      | Weight | A — group signaling | B — keep `detached:false` | C — container/cgroup | D — external supervisor | Notes                                                                                                                                          |
| --------------------------------------------------------------------------- | -----: | ------------------: | ------------------------: | -------------------: | ----------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 — Hard 1h cap**                                                        |     5  | **5**               | **2**                     | **5**                | **5**                   | A and C and D all enforce hard. B does not.                                                                                                    |
| **D2 — Fresh-fixture isolation post-cleanup**                                |     4  | **5**               | **2**                     | **5**                | **4**                   | A and C close the leak. D depends on supervisor correctness.                                                                                  |
| **D3 — Operator machine hygiene**                                            |     4  | **5**               | **2**                     | **5**                | **4**                   | Same as D2.                                                                                                                                    |
| **D4 — Self-contained Node API change**                                      |     5  | **5**               | **5**                     | **1**                | **2**                   | A is one-flag + a couple of `kill` calls. C adds a runtime dep. D adds a binary + IPC.                                                         |
| **D5 — Runner death does not orphan**                                        |     4  | **4**               | **3**                     | **5**                | **4**                   | A: parent-death handler covers most paths but `SIGKILL` to the runner itself bypasses handlers. C: cgroup OOMs the whole subtree on container exit. |
| **D6 — POSIX-correct, Windows best-effort**                                  |     2  | **4**               | **3**                     | **2**                | **3**                   | A is POSIX-clean; Windows is deferred. C is mostly Linux. D is fine cross-platform but already lost on D4.                                      |
| **Weighted total**                                                          |    —   | **(5·5)+(5·4)+(5·4)+(5·5)+(4·4)+(4·2) = 114** | **(2·5)+(2·4)+(2·4)+(5·5)+(3·4)+(3·2) = 69** | **(5·5)+(5·4)+(5·4)+(1·5)+(5·4)+(2·2) = 94** | **(5·5)+(4·4)+(4·4)+(2·5)+(4·4)+(3·2) = 89** | A wins **114 vs B 69 vs C 94 vs D 89**. A wins on D1+D4 — the only options that close the leak *without* adding a runtime dependency. |

A wins **114 vs. 69 (B) vs. 94 (C) vs. 89 (D)**. A and C tie on
correctness drivers (D1/D2/D3) but A wins decisively on D4
(self-contained change). C's runtime-dependency cost is unjustified at
this scale.

## Consequences

### Positive

- **The 1h cap becomes a hard constraint.** Any descendant of `claude`
  receives SIGTERM at `T_budget` and SIGKILL 5 seconds later regardless
  of how `claude` itself behaves.
- **ADR-003's fresh-fixture invariant holds post-cleanup.** No
  grandchild can be writing into `_workspace/` while the runner is
  running `fs.rm` on it — they are all dead by the time cleanup starts.
- **Operator machine hygiene.** Long benchmark sessions do not leak
  long-running grandchildren that compound across runs.
- **Implementation cost is small.** `detached: true` + two
  `process.kill(-pid, ...)` calls + three `process.on(...)` handlers.
  Roughly a dozen lines of code in `runner.ts`.
- **Forensic guarantee.** The integration test (security Q9) gives
  qa a deterministic acceptance criterion that exercises the worst-case
  grandchild leak.

### Negative — accepted trade

- **Windows is best-effort in P3.** `process.kill(-pid, …)` is not
  meaningful on Windows; the runner falls back to single-PID
  `child.kill()` and inherits the same leak risk B has on Linux. This
  is documented in security R7 and tracked for ADR-005. Acceptable
  because spec's primary platforms are macOS + Linux.
- **`process.on("exit")` handlers cannot signal across `SIGKILL` of the
  runner itself.** If the operator `kill -9`s the runner, the
  parent-death handler does not run, and the orphan group can survive.
  Mitigated by: (a) ADR-005 may layer cgroup isolation later; (b) the
  operator can `pkill -g <group>` manually; (c) this is a recovered
  state, not a steady-state.
- **`detached: true` requires care with stdio.** The `stdio` array
  must remain `["ignore", "pipe", "pipe"]` (per §2.5) so the parent
  still owns the pipes; if any element were `"inherit"`, `detached:
  true` would not detach in the way we want. Backend's M10
  implementation must verify this in code review.
- **Forensic edge: a grandchild that ignores SIGTERM and is killed via
  group-SIGKILL leaves no exit code in `claude`'s own logs.** The
  runner emits a `tool_error` event with `{tool: "process-group",
  reason: "force-kill"}` so the audit trail is intact.

### Negative — rejected trade-off (kept in for the audit trail)

- **We considered keeping `detached: false`** and asking `claude` to
  guarantee signal propagation. Rejected because (i) we cannot audit
  that guarantee from the runner side, (ii) any tool `claude` invokes
  inherits the same audit gap, and (iii) the spec's hard cap is too
  load-bearing to leave to a soft contract.
- **We considered `child.unref()` to detach the parent's hold on the
  child's I/O channels.** Rejected — `unref()` would cause the parent
  event loop to exit before the subprocess is reaped, which breaks
  exit accounting and would race against the artifact-capture step in
  `§3.3`. We need the subprocess attached for `on("exit")`.

### Forward implications (locked by this ADR)

- **P3 backend lane (T2)** — implements M10 from
  `benchmark/plans/security-review.md` per this ADR. Key code shape:
  ```ts
  const child = spawn("claude", argv, {
    cwd: workspaceDir,
    env: sanitisedEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: true,           // ADR-004
    windowsHide: true,
  });
  // do NOT call child.unref()

  const groupKill = (sig: NodeJS.Signals) => {
    try { process.kill(-child.pid!, sig); } catch (e: any) {
      if (e?.code !== "ESRCH") throw e;
    }
  };

  const sigtermAt = setTimeout(() => groupKill("SIGTERM"), tBudgetMs);
  const sigkillAt = setTimeout(() => {
    if (child.exitCode === null) groupKill("SIGKILL");
  }, tBudgetMs + 5_000);

  for (const ev of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(ev, () => groupKill("SIGTERM"));
  }
  ```
  Backend is responsible for clearing both timers on `child.on("exit")`
  per security M11.
- **P3 qa lane** — Q9 (security handoff) is the integration test.
  Shell-stub `(sleep 5400) &`; assert `ESRCH` on the grandchild PID
  after `T_budget + 5s`; assert `pgrep -f sleep` empty.
- **P3 security lane** — F3.1 closes when M10 lands and Q9 passes.
- **Windows correctness** — out of P3. ADR-005 (future) adds
  `taskkill /T /F` and cross-platform runner support per security R7.

## Alternatives considered (and why they lost)

- **B — keep `detached: false`.** Lost on D1 + D2 + D3. The runner
  cannot enforce the hard cap if signals do not reach descendants.
  Score 69 vs A's 114.
- **C — container or cgroup isolation per run.** Tied with A on
  correctness drivers but lost on D4 (runtime dependency / Linux-only).
  Score 94 vs A's 114.
- **D — external supervisor.** Adds a binary + IPC; no operational
  win over A. Score 89 vs A's 114.
- **`prctl(PR_SET_PDEATHSIG)`** (Linux-only kernel-level parent-death
  signaling). Considered as an extra hardening on top of A.
  Out of P3 scope; would be Linux-only and require a native addon.
  Tracked for a future hardening PR.

## Verification

This ADR is **accepted**. `verify-done` for P3 will check:

- ADR-004 file exists at
  `benchmark/plans/adr-004-runner-process-group-signaling.md`.
- Sections present: Status, Context, Drivers, Options, Decision,
  Consequences, Option scoring, Alternatives.
- Status is `accepted` and decision is unambiguous.
- `p3-runner-architecture.md §2.2` has a "Superseded by ADR-004"
  callout pointing to this file.
- Backend's M10 implementation in `runner.ts` matches the §Decision
  code shape (verified by qa Q9 integration test).

## References

- `.guild/spec/benchmark-factory.md` §Constraints — the 1h hard cap
  this ADR makes enforceable in fact, not just in name.
- `benchmark/plans/p3-runner-architecture.md §2.2` — the locked
  spawn-options table; the `detached: false` line is the line this ADR
  supersedes. The supersedes pointer is added inline in §2.2.
- `benchmark/plans/p3-runner-architecture.md §2.6` — signal-escalation
  timeline; preserved unchanged in shape, only the signaling primitive
  changes.
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md §Decision §3`
  — the fresh-fixture isolation invariant this ADR keeps holding
  post-cleanup.
- `benchmark/plans/security-review.md §3 F3.1` — the threat model.
- `benchmark/plans/security-review.md §Mitigation summary table M10` —
  the backend acceptance criterion gated on this ADR.
- `.guild/runs/run-2026-04-26-benchmark-factory-p3/handoffs/T6-security.md`
  §route: architect — A1 — the routed amendment request.
- `guild-plan.md §10.3` — decision-routing rule (this ADR is the
  significant-architectural-decision capture for the runner-subprocess
  signal-escalation amendment).
