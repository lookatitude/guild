---
type: adr
id: ADR-005
slug: windows-process-group-signaling
phase: P3 (v1.3 deferred-cleanup)
spec: .guild/spec/v1.3.0-deferred-cleanup.md
plan: .guild/plan/v1.3.0-deferred-cleanup.md
design: benchmark/plans/p3-runner-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-27
supersedes: []
superseded_by: []
---

# ADR-005 — Windows runner subprocess: `taskkill /T /F` as the analogue of ADR-004's process-group signaling

## Status

**Accepted** — 2026-04-27 as part of v1.3 deferred-cleanup.

This ADR is the **Windows symmetric** of `ADR-004 — Runner subprocess:
detached + process-group signal escalation`. ADR-004 §Drivers D6
explicitly flagged Windows as out of P3 scope ("Cross-platform
behaviour: POSIX is in scope for P3; Windows is best-effort") and
named a future ADR-005 as the place that decision would land. This
file is that ADR.

The decision is **design-only**: the contract is pinned, the code is
not written. ADR-005 ships as documentation in v1.3; backend
implements only when the re-entry trigger fires (see §Re-entry
trigger).

## Context

ADR-004 closed the POSIX path: `spawn(..., { detached: true })` makes
the `claude` subprocess a process-group leader; the runner sends
`process.kill(-child.pid, "SIGTERM")` and `…("SIGKILL")` to the
**negative PID** so the OS forwards the signal to every descendant in
the group. That guarantees the spec's 1h hard cap reaches grandchildren
that `claude` itself spawns (tools, MCP servers, anything `claude`
shells out to).

On Windows, the negative-PID syntax is **not meaningful**:

- Windows has no POSIX process groups in the `setpgid`/`setsid` sense.
  `process.kill(-pid, sig)` is not a portable primitive.
- Node's `child.kill()` on Windows resolves to `TerminateProcess(hPid)`
  on the immediate child handle. Descendants of `claude` are not
  signaled; the same audit gap that ADR-004 closed on POSIX remains
  open on Windows.
- Windows has its own primitive — Job Objects with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, or the `taskkill` CLI with
  the `/T` (tree) and `/F` (force) flags. `taskkill /PID <pid> /T /F`
  walks the descendant tree from `<pid>` and terminates every process
  in it.

ADR-004's §Consequences/Negative explicitly recorded the gap: *"Windows
is best-effort in P3. `process.kill(-pid, …)` is not meaningful on
Windows; the runner falls back to single-PID `child.kill()` and inherits
the same leak risk B has on Linux."* That language committed v1.x to
filing this ADR as a forward decision; FOLLOWUPS F7 carried the
placeholder; this ADR closes F7 by pinning the contract without
implementing it.

The reason v1.3 does **not** implement is operational, not technical:
no operator running the benchmark factory has hit a Windows install
yet. The supported operator base is macOS and Linux. Building, testing,
and live-smoking a Windows code path **before any operator surfaces on
Windows** would (a) add untested code to the runner's hottest path,
(b) require a Windows CI target the project has not provisioned, and
(c) violate `guild-plan.md §2 / Karpathy 4 §2 — Simplicity first`.
Documenting the design now means the day a Windows operator surfaces,
backend implements against a reviewed shape rather than re-litigating
the design.

## Drivers

| ID  | Driver                                                                                       | Source                                                  | Why it matters                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **The 1h wall-clock cap must be a hard constraint on every supported OS, not just POSIX.**   | spec §Constraints (1h cap); ADR-004 §D1                 | The cap is bypassable on Windows today; descendants survive `child.kill()`. Same threat-model as ADR-004 F3.1, just on a different OS. |
| D2  | **The Windows mechanism must match ADR-004's escalation timeline shape.**                    | ADR-004 §Decision §5 (`§2.6` timeline preserved)        | Operators reading the runner code should see one signaling story (SIGTERM at `T_budget`, SIGKILL after 5s) — the *primitive* differs by OS, the *shape* is identical. |
| D3  | **No new runtime dependency.** The fix must be a small Node-native change.                   | spec §Constraints (no extra deps); ADR-004 §D4          | `taskkill.exe` ships with Windows; spawning it is a `child_process.spawn` call, not a new package or container.                      |
| D4  | **Implementation is deferred until a Windows operator hits the runner.**                     | F7 ledger entry; spec §Audience (macOS/Linux primary)   | Building+testing a Windows path before any operator runs there is unjustified scope. Document now; build when warranted.             |
| D5  | **The decision must close ADR-004's forward reference and FOLLOWUPS F7 cleanly.**            | ADR-004 §Consequences/Negative; FOLLOWUPS §F7           | Without this ADR, the ledger keeps "deferred forever" entries — the exact failure mode v1.3 is closing.                              |

## Options considered

| Option | Mechanism | Trade-offs |
| --- | --- | --- |
| **A. `taskkill /PID <child.pid> /T /F` shell-out (recommended)** | When `process.platform === "win32"`, spawn `taskkill.exe` with `/T` (tree-kill: child + descendants) and `/F` (force: skip graceful close-window). Ships with every Windows install since XP. No new dependency, no native addon. | **+** Native to Windows; **+** matches `taskkill` semantics every Windows operator already knows; **+** works without admin rights against the operator's own subtree. **−** Spawns a helper process (one extra PID at signal time); **−** SIGTERM has no clean analogue — `taskkill` without `/F` waits on WM_CLOSE which is a GUI message and irrelevant to a console subprocess (so SIGTERM and SIGKILL collapse to one mechanism on Windows; we keep the timeline shape but the SIGTERM step becomes effectively a `taskkill /T` without `/F`, and SIGKILL becomes `taskkill /T /F`). |
| **B. Job Objects (`CreateJobObject` + `AssignProcessToJobObject` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`)** | Native Win32 primitive. Closing the job handle terminates every process in the job atomically. Equivalent to a Linux cgroup with the kill controller. | **+** Strongest correctness guarantee — the OS owns the kill, no race window; **+** parent-death automatically kills the job because the handle closes when the runner exits; **−** requires an N-API native addon or a Win32-FFI binding; **−** new dependency; **−** Node has no built-in Job Object support; **−** violates D3. |
| **C. PowerShell `Stop-Process -Id <pid> -Force` with descendant walk** | Spawn `powershell.exe -Command "Get-CimInstance Win32_Process \| Where-Object ParentProcessId -eq <pid> \| Stop-Process -Force"` recursively. | **−** Slow startup (PowerShell cold-start ~300ms — adds latency to every kill); **−** PowerShell version skew across Windows 10 / 11 / Server; **−** more moving parts than `taskkill`; **−** `taskkill /T` already does the descendant walk. Strictly worse than A. |
| **D. Status quo — `child.kill()` only on Windows.** | What the runner does today. | **−** Same leak ADR-004 closed on POSIX; **−** the 1h cap is soft on Windows. Rejected on D1. Documented in ADR-004 §Consequences/Negative as the temporary state until ADR-005 lands. |

### Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect importance.

| Driver                                                       | Weight | A — `taskkill /T /F` | B — Job Objects | C — PowerShell walk | D — status quo |
| ------------------------------------------------------------ | -----: | -------------------: | --------------: | ------------------: | -------------: |
| **D1 — Hard 1h cap on Windows**                              |     5  | **5**                | **5**           | **4**               | **2**          |
| **D2 — Match ADR-004 timeline shape**                        |     3  | **4**                | **3**           | **3**               | **3**          |
| **D3 — No new runtime dependency**                           |     5  | **5**                | **1**           | **3**               | **5**          |
| **D4 — Defer-friendly (small contract, future implementation)** |   4  | **5**                | **2**           | **3**               | **5**          |
| **D5 — Closes ADR-004 forward ref + F7 cleanly**             |     3  | **5**                | **5**           | **4**               | **2**          |
| **Weighted total**                                           |    —  | **(5·5)+(3·4)+(5·5)+(4·5)+(3·5) = 97** | **(5·5)+(3·3)+(5·1)+(4·2)+(3·5) = 62** | **(5·4)+(3·3)+(5·3)+(4·3)+(3·4) = 68** | **(5·2)+(3·3)+(5·5)+(4·5)+(3·2) = 70** |

A wins **97 vs. 62 (B) vs. 68 (C) vs. 70 (D)**. A and B tie on D1
(both close the leak); A wins on D3 (no new dep) and D4 (small enough
to be an unimplemented contract). Status quo (D) survives only because
operators do not yet run on Windows; it loses decisively on D1 the
moment the first Windows operator surfaces — which is exactly the
re-entry trigger.

## Decision

**We choose Option A — `taskkill /PID <child.pid> /T /F` shell-out on
Windows, and we do not implement until a Windows operator surfaces.**

Concrete commitments locked by this decision:

1. **Platform branch in the kill helper.** `groupKill(sig)` (per
   ADR-004 §Forward implications) becomes:
   ```text
   if (process.platform === "win32") {
     // ADR-005 — Windows analogue of ADR-004's group signaling.
     // SIGTERM step: taskkill /T (graceful tree close — best-effort).
     // SIGKILL step: taskkill /T /F (force tree kill).
     const flag = sig === "SIGKILL" ? ["/T", "/F"] : ["/T"];
     spawn("taskkill", ["/PID", String(child.pid), ...flag], { stdio: "ignore" });
   } else {
     // ADR-004 — POSIX process-group signaling.
     try { process.kill(-child.pid!, sig); } catch (e: any) {
       if (e?.code !== "ESRCH") throw e;
     }
   }
   ```
   (Code shape is illustrative; backend writes the real version when
   the trigger fires.)
2. **Timeline shape preserved.** SIGTERM at `T_budget`, SIGKILL at
   `T_budget + 5s` — same `§2.6` timeline as ADR-004. On Windows the
   primitive collapses (`taskkill /T` vs `taskkill /T /F`) but the
   *shape operators read in the runner* is identical. This satisfies
   D2.
3. **Parent-death handler.** The same `process.on("exit" | "SIGINT" |
   "SIGTERM")` hooks call `groupKill("SIGTERM")` — they branch
   internally per platform. No platform-specific handler registration.
4. **`detached: true` is unchanged.** ADR-004's `detached: true` flag
   is set on POSIX **and** Windows. On Windows it changes process-group
   semantics minimally (the child is started in a new console — see
   `windowsHide: true`) but does not unlock signal-tree behaviour;
   that remains `taskkill`'s job.
5. **No code in v1.3.** The ADR ships as documentation. The runner's
   Windows path remains "best-effort `child.kill()`" today — same
   state ADR-004 §Consequences/Negative recorded. Backend builds the
   branch above only when the re-entry trigger fires.
6. **Verification when implemented.** When backend builds this:
   - Unit test asserts the platform branch (mocked `process.platform`).
   - Integration test on a Windows runner spawns a child with a
     long-running grandchild; after `T_budget + 5s`, `tasklist /FI
     "PID eq <grandchildPid>"` returns "no tasks" — the Windows
     analogue of ADR-004's `pgrep -f sleep` empty assertion.

## Re-entry trigger

This ADR is **deferred-with-reason**. Implementation begins when **any
one** of the following observable signals fires:

1. **A Windows operator surfaces and runs the benchmark factory** —
   "surfaces" meaning a real operator opens an issue, files a bug, or
   posts a smoke result captured on `process.platform === "win32"`.
   Inferred-evidence (e.g., a colleague mentioning Windows in passing)
   does not flip the trigger; concrete operator artifact does.
2. **CI adds a Windows target** — when the benchmark factory's CI
   matrix grows a `windows-latest` job, the runner needs to pass that
   job, and "best-effort `child.kill()`" stops being acceptable.
3. **A grandchild-leak incident is reported on a Windows install** —
   if any operator reports the bypass-the-1h-cap failure mode on
   Windows (the exact threat-model ADR-004 closed on POSIX),
   implementation moves from deferred to in-flight regardless of (1)
   or (2).

When the trigger fires, the implementing specialist (backend, with
security review) reads this ADR §Decision, implements the platform
branch, and adds the integration test described in §Decision §6.
ADR-005's status flips from `accepted` to `accepted` + a new
`implemented_at` field; FOLLOWUPS F7 closes; no new ADR is required
unless the chosen primitive changes (e.g., Job Objects become
preferable, in which case a new ADR supersedes this one).

If none of the three triggers fires, ADR-005 stays accepted-but-
unimplemented indefinitely — *which is the correct steady state* given
the operator base. The discipline this ADR enforces is: the deferral
has a named, observable end-condition, not "we'll get to it."

## Consequences

### Positive

- **Closes ADR-004's forward reference.** The Windows analogue is
  named, scored, and pinned; ADR-004 §Consequences/Negative no longer
  carries a dangling "tracked for ADR-005" line.
- **Closes FOLLOWUPS F7.** F7's "deferred — no Windows operator" entry
  is replaced by an ADR with a re-entry trigger; the ledger stops
  accumulating.
- **Future implementation cost is small and reviewed.** Backend reads
  this ADR, writes the platform branch, adds the integration test.
  Roughly the same code footprint as ADR-004's POSIX path. The design
  decision is locked; only the implementation is pending.
- **Symmetry with ADR-004.** Operators reading the runner code see
  one signaling story (SIGTERM → 5s → SIGKILL) with two
  platform-specific primitives behind it. The mental model does not
  fracture along OS lines.

### Negative — accepted trade

- **Windows remains best-effort in v1.x.** Until the trigger fires,
  `child.kill()` is the only Windows kill primitive the runner uses;
  the 1h cap remains soft on Windows. This is the same state ADR-004
  §Consequences/Negative recorded for the v1.x window; ADR-005
  formalises why.
- **`taskkill` SIGTERM is approximate.** Unlike POSIX where SIGTERM
  is a clean "polite ask," `taskkill /T` (without `/F`) sends
  WM_CLOSE messages, which a console subprocess will largely ignore.
  In practice on Windows the SIGTERM step is mostly a no-op and the
  SIGKILL step (`/T /F`) does the work. The 5-second grace window
  becomes "5 seconds for the child to exit on its own before we tree-
  kill." Acceptable; matches what every Windows operator already
  expects from `taskkill`.
- **The `taskkill` shell-out spawns a helper PID at signal time.** One
  extra `taskkill.exe` process per kill. Negligible cost, but it does
  mean the runner's process-tree at `T_budget` briefly contains the
  runner + the (dying) `claude` subtree + the `taskkill` helper. Not
  a leak; just a transient.
- **No native parent-death-kills-the-tree guarantee on Windows.** Job
  Objects (Option B) would give that for free; A does not. If the
  operator `taskkill /F`s the runner itself, the parent-death handler
  cannot run, and the orphan subtree survives. Same forensic edge
  ADR-004 §Consequences/Negative recorded for POSIX `kill -9` of the
  runner. Mitigated by the operator running `taskkill /T /F /PID
  <claude-pid>` manually — same recovery story as POSIX `pkill -g`.

### Forward implications (locked by this ADR)

- **Backend (when triggered)** — implements the platform branch in
  `runner.ts` `groupKill` (search `ADR-004` for the current call
  site). The branch is ~6 lines; tests are ~30 lines.
- **qa (when triggered)** — adds the Windows integration test
  described in §Decision §6. Requires a Windows runner in CI, which is
  the trigger #2 above and which qa would have already provisioned.
- **security (when triggered)** — re-runs the F3.1 threat model with
  `process.platform === "win32"` substituted. Expected to close
  identically to POSIX once the platform branch lands.
- **technical-writer (when triggered)** — README §10 gets a Windows
  paragraph noting `taskkill /T /F` is the underlying primitive; the
  operator-tunable `GUILD_BENCHMARK_ARGV_TEMPLATE` story is
  unchanged.

## What this does *not* change

- **ADR-003** — fresh-fixture clone per run. Workspace path semantics
  are POSIX-style (`runs/<id>/_workspace/`) on every OS; Windows
  operators see Windows-style paths after `path.win32.normalize` but
  ADR-003's clone-per-run invariant is unchanged.
- **ADR-004** — POSIX process-group signaling. ADR-005 is **additive**,
  not a supersession. ADR-004's `process.kill(-child.pid, SIG)` path
  remains the canonical POSIX implementation; ADR-005 is the Windows
  branch beside it.
- **ADR-006** — runner prompt via stdin + `--add-dir`. The spawn model
  (`stdio: ["pipe", "pipe", "pipe"]`, prompt piped via stdin) is
  unchanged on every OS. Windows pipe semantics are slightly
  different (named pipes vs. anonymous fds) but Node abstracts that;
  the runner code does not branch on platform for stdio.
- **§2.6 timeline** — SIGTERM at `T_budget`, SIGKILL at `T_budget +
  5s`. Preserved.

## References

- `benchmark/plans/adr-004-runner-process-group-signaling.md` —
  POSIX symmetric. ADR-005 §Drivers cite ADR-004 §D6 directly. ADR-004
  §Consequences/Negative is the forward reference this ADR closes.
- `benchmark/plans/p3-runner-architecture.md §2.2 / §2.6` — the
  spawn-options table and signal-escalation timeline; ADR-005 layers
  the Windows branch into the same shape.
- `benchmark/plans/security-review.md F3.1` — the grandchild-leak
  threat model. ADR-004 closed on POSIX; ADR-005 closes on Windows
  when triggered.
- `benchmark/FOLLOWUPS.md §F7` — the ledger entry this ADR closes.
- `guild-plan.md §10.3` — decision-routing rule (this ADR is the
  significant-architectural-decision capture for the Windows analogue
  of the runner-subprocess signal-escalation amendment).
