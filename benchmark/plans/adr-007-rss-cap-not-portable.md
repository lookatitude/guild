---
type: adr
id: ADR-007
slug: rss-cap-not-portable
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

# ADR-007 — No portable per-process RSS cap; runtime WARN at 80% threshold instead

## Status

**Accepted** — 2026-04-27 as part of v1.3 deferred-cleanup.

This ADR closes `benchmark/FOLLOWUPS.md §F6` (and security-review
F3.4 `D — OOM via subprocess memory balloon`) by pinning the v1.x
position: there is **no portable hard cap** the runner can enforce
on the `claude` subprocess's resident set size, and shipping a non-
portable one would buy a partial guarantee at the cost of an OS-
specific code path. v1.3 recommends a **runtime WARN at 80% of an
operator-declared threshold** as the soft signal; backend (T2)
implements per this recommendation.

## Context

`benchmark/plans/security-review.md §F3.4` is verbatim:

> **Mitigation** | Document operator runbook: "On Linux, run with
> `ulimit -v 8388608` (8GB virtual address space) to bound subprocess
> RSS; on macOS, equivalent via `launchctl limit maxproc` or per-
> process `setrlimit` is unsupported by Node directly (no native
> API). The runner does not enforce this; operator-environment
> concern." `process.spawn`'s `options.maxBuffer` does not apply to
> streamed (piped) stdio, so it is not a usable bound here."
> **Acceptance criterion** | Runbook entry only.

`benchmark/plans/03-runner.md §"OOM and resource ceilings"` (the
operator-facing prose for the same concern) closes with:

> The runner records `process.resourceUsage()` in
> `run.json.resource_usage` for visibility (M13).

So the v1.x runner already captures `process.resourceUsage()` (see
`benchmark/src/runner.ts §M13`, ~line 682) at run-end and writes it
to `run.json.resource_usage`. That field includes `maxRSS` (max
resident-set-size in kilobytes on Linux, **bytes** on macOS — a
known platform inconsistency in Node's wrapper around POSIX
`getrusage(2)`). The capture is **post-mortem**: it tells the
operator what the run *did* use, not what it *is* using mid-run.

What v1.x does **not** have is any signal that fires *during* a run
when memory is climbing toward an operator-declared ceiling. The
failure mode F3.4 is concerned with — `claude` balloons RSS,
the OS OOM-killer selects the parent runner first, run state is lost
mid-capture — is not preventable by post-mortem reporting. It needs
either:

- an enforced hard cap (no portable mechanism exists), or
- a soft real-time signal the operator can act on (recommended below).

### Why no hard cap

| Mechanism | Why it doesn't ship in v1.x |
| --- | --- |
| `setrlimit(RLIMIT_AS)` / `ulimit -v` | POSIX-only; Linux behaviour is reliable but macOS implementation of `RLIMIT_AS` is partial. Setting it from Node requires a native addon (Node has no portable `setrlimit` binding). Even when set, the limit is per-process, not per-process-tree — `claude`'s grandchildren can each hit the limit individually. Linux-only as an *operator-side advisory* (the existing runbook entry); not enforceable from inside the runner. |
| Linux cgroup v2 with `memory.max` | Linux-only. Requires either root or a delegated cgroup hierarchy (`systemd-run --user --scope -p MemoryMax=…`). Adding cgroup setup to the runner introduces a Linux-only privileged path that fails on macOS and Windows; violates the cross-platform-where-cheap principle ADR-004 already adopted. F6 ledger entry already names this as the "re-evaluate when cgroups becomes a portable target" condition. |
| macOS resource limits (`launchctl`, `setrlimit`) | `setrlimit(RLIMIT_AS)` on macOS does not enforce reliably for arbitrary processes; `launchctl limit` is system-wide, not per-process; `launchd` job specs are operator-side, not runner-controllable. No usable per-process-tree primitive. |
| Windows Job Objects with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` | Windows-only. Requires a native addon (Node has no built-in Job Object support — same dependency cost ADR-005 §Option B rejected). Even if shipped, would only fire on Windows; macOS and Linux operators are unprotected. Not portable. |
| `process.spawn`'s `options.maxBuffer` | Node-native but **does not apply** to streamed/piped stdio — and the runner pipes stdout + stderr per ADR-006 / `p3-runner-architecture.md §2.5`. Already noted in security-review F3.4 as not usable. |

The pattern: every mechanism that *would* enforce a hard cap is
single-OS, requires a native binding, or fails to apply to the
runner's actual stdio shape. Picking one would buy a partial
guarantee on one OS at the cost of branching the runner's hottest
path. Not worth it for a `Low`-severity threat (F3.4 is rated `Low`
in security-review precisely because it is operator-machine
concern, single-user, not a security boundary).

### Why a soft signal is worth shipping

The post-mortem `run.json.resource_usage` field tells the operator
what happened *after* a run. The operator's actionable window — the
moment to abort the run, free memory, restart the runner, lower the
case's expected memory footprint — is *during* the run, before the
OOM-killer fires.

A single stderr `warn:` line, fired once per run when the runner
observes RSS crossing an operator-declared threshold, gives that
window without:

- adding a runtime dependency (uses `process.resourceUsage()` which
  is already captured),
- adding a per-platform code branch (Node abstracts the
  `getrusage(2)` call; the unit conversion gotcha is the only
  portability cost — see §Decision §3),
- changing the runner's spawn shape (no `setrlimit`, no cgroup, no
  Job Object),
- forcing operators to set anything (the WARN only fires when the
  operator opts in by setting `GUILD_BENCHMARK_MAX_RSS_KB`).

It is the smallest patch that turns the F3.4 mitigation from "we
captured it post-mortem" into "we told the operator while they could
still act." Per `guild-plan.md §2 / Karpathy 4 §2` (Simplicity first),
this is the right size of fix for the threat severity.

## Drivers

| ID  | Driver                                                                                                  | Source                                                | Why it matters                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **No portable hard-cap primitive exists across macOS / Linux / Windows for v1.x.**                      | security-review §F3.4; F6 ledger entry                | Frames the deferral; lets the ADR cite the survey and not relitigate per release.                                                                              |
| D2  | **Operator must have a real-time signal, not just a post-mortem field.**                                | operator-runbook gap; F3.4 acceptance criterion       | The post-mortem `resource_usage` is necessary but not sufficient — operator action requires a mid-run signal.                                                  |
| D3  | **Implementation must use Node-native primitives only — no native addons, no spawn-shape changes.**     | spec §Constraints (no extra deps); ADR-004 §D4        | Same constraint that scoped ADR-004; consistency matters, and `process.resourceUsage()` is already captured at run-end.                                         |
| D4  | **Operator opts in; project does not project-default a memory ceiling.**                                | wiki/decisions/operators-control-model-selection.md   | Same principle as the model-selection decision — the operator's environment dictates resources; the project does not auto-pin.                                |
| D5  | **The mechanism must be re-entry-friendly: replaceable by a hard cap when one becomes portable.**       | F6 re-entry condition                                 | When cgroups (or another primitive) becomes portable, ADR-007 supersedes cleanly without the soft-signal codepath ossifying into a contract operators rely on. |
| D6  | **The signal must not be noisy.** One line per run, not per polling tick.                              | guild-plan §2 simplicity-first; operator-runbook UX   | A WARN that fires every second floods stderr and trains operators to ignore it. Once-per-run, on first crossing, is enough.                                    |

## Options considered

| Option | Mechanism | Trade-offs |
| --- | --- | --- |
| **A. Operator runs with `ulimit -v` (status quo + runbook only)** | The runbook tells the operator to set `ulimit -v 8388608` on Linux before launching the runner. macOS operators have no equivalent. | **+** Zero runner code; **+** Linux operators get a hard cap (process-level, not tree-level — partial). **−** macOS operators get nothing; **−** the runner has no in-product signal — a partial-data run from the OOM-killer looks identical to a normal failure to the operator; **−** acceptance criterion in F3.4 is "runbook entry only," which is what we have today and which F6 explicitly flags as insufficient. |
| **B. cgroups-based hard cap (Linux only)** | Wrap the spawn in `systemd-run --user --scope -p MemoryMax=8G claude …` or call `cgroup_create` directly. | **+** True hard cap on Linux; **−** Linux-only; **−** `systemd-run` requires user-level systemd which is not universal (Alpine/musl, BSD-derived containers); **−** the cgroup primitive surface is large and would need its own ADR; **−** macOS and Windows operators get nothing; **−** violates D3 (cross-platform). Ruled out for v1.x; left to F6's "re-evaluate when cgroups becomes a portable target" trigger. |
| **C. Runtime WARN at 80% of operator-declared threshold (recommended)** | New env var `GUILD_BENCHMARK_MAX_RSS_KB`. When set, the runner samples `process.resourceUsage().maxRSS` periodically (e.g., once per second on a `setInterval`, or piggyback on an existing event loop tick), normalises to KB across platforms, and emits *one* stderr line of the form `warn: rss approaching declared cap — observed ${kb} KB ≥ 80% of GUILD_BENCHMARK_MAX_RSS_KB=${cap}` the **first time** the ratio crosses 80%. Subsequent crossings within the same run do not re-warn. | **+** Cross-platform — Node abstracts `getrusage(2)`; **+** zero new deps; **+** opt-in (D4 satisfied); **+** quiet by design (D6 — one line per run); **+** uses the same `process.resourceUsage()` already captured at run-end (D3). **−** Soft signal, not a hard cap — the OOM-killer can still fire between the WARN and an operator response; **−** `maxRSS` unit differs by platform (KB on Linux/Windows, bytes on macOS); the runner must normalise; **−** uses parent-process `resourceUsage()` which on POSIX is *inclusive of waited-on children's reaped resources* — accurate post-exit, less granular mid-run for live grandchildren. |
| **D. Self-aborting WARN (warn AND `groupKill("SIGTERM")` at 80%)** | Like C but escalate to terminating the run when the threshold crosses. | **−** Removes operator agency — the project decides when to abort, not the operator; violates D4; **−** a one-second sampling window is too coarse to be a reliable kill trigger (RSS spikes and recovers); **−** turning a WARN into a silent run-killer trains operators to mistrust the project's resource decisions. Rejected. |

### Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect importance.

| Driver                                                        | Weight | A — runbook only | B — cgroups | C — runtime WARN @ 80% | D — self-aborting WARN |
| ------------------------------------------------------------- | -----: | ---------------: | ----------: | ---------------------: | ---------------------: |
| **D1 — Acknowledge no portable hard cap**                     |     4  | **5**            | **2**       | **5**                  | **3**                  |
| **D2 — Real-time operator signal**                            |     5  | **1**            | **5**       | **4**                  | **5**                  |
| **D3 — Node-native, no addons**                               |     5  | **5**            | **2**       | **5**                  | **5**                  |
| **D4 — Operator opts in**                                     |     4  | **5**            | **3**       | **5**                  | **2**                  |
| **D5 — Re-entry-friendly (replaceable)**                      |     3  | **5**            | **2**       | **5**                  | **3**                  |
| **D6 — Quiet (one line per run)**                             |     3  | **5**            | **5**       | **5**                  | **4**                  |
| **Weighted total**                                            |    —  | **(4·5)+(5·1)+(5·5)+(4·5)+(3·5)+(3·5) = 100** | **(4·2)+(5·5)+(5·2)+(4·3)+(3·2)+(3·5) = 76** | **(4·5)+(5·4)+(5·5)+(4·5)+(3·5)+(3·5) = 115** | **(4·3)+(5·5)+(5·5)+(4·2)+(3·3)+(3·4) = 91** |

C wins **115 vs. 100 (A) vs. 91 (D) vs. 76 (B)**. C beats A on the
real-time-signal driver D2 (the gap that motivates this ADR); C beats
D on operator-agency D4; C beats B on cross-platformness D3 and on
re-entry-friendliness D5. C is the recommendation.

## Decision

**We choose Option C — runtime WARN at 80% of an operator-declared
RSS threshold.** No hard cap; runbook documentation continues for
operators who *also* want a Linux-side `ulimit -v`.

Concrete commitments locked by this decision:

1. **Env var contract.** A new env var
   `GUILD_BENCHMARK_MAX_RSS_KB` is read at runner start.
   - Unset or non-positive integer → no WARN sampling fires; runner
     behaviour is unchanged from v1.2.
   - Set to a positive integer → runner samples RSS during the run;
     emits the WARN at the first crossing of `0.80 * cap`.
   - Operator-declared in **kilobytes** to match Linux/Windows
     `getrusage` units; the runner normalises macOS bytes → KB
     internally so the comparison is unit-clean (see §3 below).
2. **Sampling cadence.** Once per second via
   `setInterval(check, 1000)`, started after spawn and cleared in the
   same `finally` block that clears the SIGTERM/SIGKILL timers (per
   ADR-004 §M11). Once the WARN has fired, the interval clears
   itself — there is no need to keep sampling after the first
   crossing.
3. **Platform normalisation.** `process.resourceUsage().maxRSS`
   returns KB on Linux/Windows and **bytes** on macOS (Node's wrapper
   around `getrusage(2)`; documented inconsistency). The runner
   normalises:
   ```text
   const raw = process.resourceUsage().maxRSS;
   const kb = process.platform === "darwin" ? Math.floor(raw / 1024) : raw;
   ```
   The same normalisation applies to whatever the runner already
   writes to `run.json.resource_usage` — backend should verify the
   existing post-mortem field is consistent (this ADR does not change
   that field, but flags the audit so the WARN unit and the
   captured-field unit agree).
4. **WARN line format.** A single line on stderr:
   ```text
   warn: rss approaching declared cap — observed <kb> KB ≥ 80% of GUILD_BENCHMARK_MAX_RSS_KB=<cap>
   ```
   Plain `warn:` prefix; no JSON; no event-emission. The runner does
   **not** write a `tool_error` event for this — it is operator-facing
   noise, not a benchmark-relevant artifact. (If the operator wants a
   forensic record, the post-mortem `run.json.resource_usage` already
   captures the peak.)
5. **Once per run, not once per crossing.** A boolean
   `rssWarnFired = false` guards the emission. Once the WARN has
   fired, subsequent samples do not re-emit. This is the D6 quietness
   commitment.
6. **`process.resourceUsage()` granularity caveat.** The runner uses
   the **parent-process** `resourceUsage()` because Node has no per-
   child API for live processes (only the parent's `getrusage(2)`,
   which on POSIX is *inclusive of waited-on children's reaped
   resources*). For a live `claude` subprocess, this means the WARN
   measures the runner-plus-reaped-children footprint, not the live-
   `claude` footprint. In practice the runner itself uses very little
   memory (it is mostly idle waiting on the subprocess), so the
   parent's `maxRSS` is dominated by `claude`'s once `claude` exits;
   for an OOM event mid-run, the parent's value lags the child's.
   Backend should document this caveat in the runbook update so
   operators understand the WARN may fire late on long-tail spikes.
7. **Tests.** Backend's T2 lane includes:
   - **Unit:** mock `process.resourceUsage` to step through values
     [60%, 70%, 79%, 80%, 90%]; assert exactly one stderr line at
     the 80% step, none on subsequent steps.
   - **Unit:** unset `GUILD_BENCHMARK_MAX_RSS_KB` → no WARN, no
     interval registered.
   - **Unit:** `GUILD_BENCHMARK_MAX_RSS_KB=0` or negative → treated
     as unset.
   - **Platform:** mock `process.platform = "darwin"` and assert the
     bytes-to-KB normalisation; same with `"linux"` and assert no
     conversion.
8. **Documentation.** README §10 (operator-tunable env vars) gains
   a `GUILD_BENCHMARK_MAX_RSS_KB` entry. The runbook section on
   "OOM and resource ceilings" in `03-runner.md` gets a paragraph
   noting the WARN exists and how to interpret it.

## Re-entry trigger

This ADR is **deferred-with-reason** at the *hard-cap* level — the
WARN ships, but a portable hard cap remains deferred. Implementation
of a hard cap begins when **any one** of the following observable
signals fires:

1. **cgroups becomes a portable target** — concretely, when Node ships
   a built-in or stable `node:cgroup` API, or when the operator base
   migrates to systemd-user-scope-enabled environments uniformly
   enough that `systemd-run --user --scope -p MemoryMax=…` is the
   default invocation path. This is the F6 ledger trigger as
   originally written; ADR-007 inherits it.
2. **A multi-platform sandbox primitive emerges** — concretely, a
   single API that bounds RSS portably across macOS, Linux, and
   Windows. Examples that *would* qualify: a Node-bundled WASI
   sandbox with memory limits; a `child_process.spawn` option that
   compiles down to per-OS primitives transparently. None exists at
   time of writing.
3. **An OOM-induced data-loss incident is reported** — if any
   operator reports a run that lost state because the OS OOM-killer
   selected the parent runner before the WARN could fire, the
   severity classification of F3.4 escalates from `Low` to at least
   `Medium`, and the cost of "no hard cap" outweighs the cost of a
   non-portable one. Pick the best-available platform-specific
   primitive at that point.

When the trigger fires, the implementing specialist (security to
re-rate, then backend to implement) reads this ADR, picks the
mechanism, supersedes ADR-007 with a new ADR documenting the chosen
primitive. The WARN code (Option C) stays in place as a
defence-in-depth signal even after a hard cap lands — a hard cap
without a real-time signal is hostile UX (the operator sees a SIGKILL
from the kernel and no warning).

If none of the three triggers fires, ADR-007 stays accepted-but-
hard-cap-deferred indefinitely. The discipline this ADR enforces:
the deferral has a named, observable end-condition; the soft signal
ships now so the deferral does not leave operators without any
real-time visibility.

## Consequences

### Positive

- **Closes FOLLOWUPS F6 with a real outcome, not a "deferred forever"
  entry.** The ledger entry flips from "no portable solution → no
  action" to "no portable hard cap → soft signal shipped, hard cap
  re-entry triggered."
- **Operator gets a real-time signal for the first time.** Today the
  operator only sees `run.json.resource_usage` post-mortem; with the
  WARN, they see the trajectory mid-run while they can still abort.
- **No new dependency, no new platform branch.** `process.
  resourceUsage()` is Node-native; the platform-conditional unit
  conversion is a one-liner. The runner's spawn shape from ADR-006 /
  §2.2 is unchanged.
- **Audits cleanly.** The WARN is a single stderr line with a fixed
  prefix; security-review M5 (redaction) does not flag it (no secret
  content); the post-mortem field is unchanged so existing dashboards
  and `comparator` logic continue working.
- **Re-entry-friendly.** When a portable hard cap arrives, the WARN
  stays; the new ADR layers on top without rewriting Option C.

### Negative — accepted trade

- **Soft signal, not a hard guarantee.** An operator who ignores the
  WARN (or whose run is OOM-killed before sampling can catch it) gets
  the same data-loss F3.4 documents. The WARN narrows the window; it
  does not close it. Acceptable for a `Low`-severity threat where the
  alternative is a Linux-only or macOS-only hard cap.
- **`process.resourceUsage()` measures the parent process, not live
  children.** On POSIX it includes reaped children — accurate
  post-exit, lagging mid-run. A `claude` that balloons fast can OOM
  the system before the parent's `maxRSS` reflects it. Operators with
  truly tight memory budgets should *also* set `ulimit -v` on Linux
  per the existing runbook entry; the WARN complements it, does not
  replace it.
- **`maxRSS` unit-platform inconsistency is a foot-gun if anyone
  bypasses the normalisation.** If a future code path reads
  `process.resourceUsage().maxRSS` directly without the platform
  conversion, the comparison silently breaks on macOS (off by 1024×).
  Backend's tests in §Decision §7 pin this; backend must keep the
  conversion centralised in one helper.
- **Operator must opt in.** If `GUILD_BENCHMARK_MAX_RSS_KB` is unset,
  the WARN never fires and v1.x behaviour is unchanged. Operators
  who set nothing are no better off than today. This is a deliberate
  D4 choice; the project does not project-default a memory ceiling.
- **Sampling adds a `setInterval` to the runner's event loop.** One
  second cadence, one boolean check per tick, one
  `process.resourceUsage()` call per tick — negligible CPU. The
  interval clears itself once the WARN has fired (or in the runner's
  exit `finally` block). Verified by the `unref`-friendly cleanup
  ADR-004 §M11 already requires for the SIGTERM/SIGKILL timers.

### Forward implications (locked by this ADR)

- **Backend (T2)** — implements the WARN per §Decision §1–§7 in
  `runner.ts`. The interval registration sits alongside ADR-004's
  SIGTERM/SIGKILL timers; the same `finally` block clears all three.
  Code shape:
  ```text
  const cap = Number(process.env.GUILD_BENCHMARK_MAX_RSS_KB);
  let rssWarnFired = false;
  let rssInterval: NodeJS.Timeout | null = null;
  if (Number.isFinite(cap) && cap > 0) {
    rssInterval = setInterval(() => {
      if (rssWarnFired) return;
      const raw = process.resourceUsage().maxRSS;
      const kb = process.platform === "darwin" ? Math.floor(raw / 1024) : raw;
      if (kb >= 0.80 * cap) {
        process.stderr.write(`warn: rss approaching declared cap — observed ${kb} KB >= 80% of GUILD_BENCHMARK_MAX_RSS_KB=${cap}\n`);
        rssWarnFired = true;
        if (rssInterval) clearInterval(rssInterval);
      }
    }, 1000);
  }
  // … in the finally block alongside sigtermTimer / sigkillTimer cleanup:
  if (rssInterval) clearInterval(rssInterval);
  ```
- **qa** — the unit tests in §Decision §7 are part of T2's success
  criteria.
- **technical-writer** — runbook update in `03-runner.md §"OOM and
  resource ceilings"` and README §10 entry, per §Decision §8.
- **security** — re-rates F3.4 acceptance criterion. With the WARN,
  the criterion shifts from "runbook entry only" to "runbook entry +
  runtime soft signal." The severity (`Low`) does not change; the
  closure shape does.

## What this does *not* change

- **`run.json.resource_usage` post-mortem field.** Already captured
  at run-end via M13 (`runner.ts` line ~682). Unchanged. The WARN is
  a *real-time complement* to this field, not a replacement.
- **ADR-003** — fresh-fixture clone. Workspace memory consumption is
  not directly bounded by the workspace clone; ADR-003 is unaffected.
- **ADR-004** — process-group signaling. The SIGTERM/SIGKILL
  timeline in §2.6 is unchanged. The 80%-WARN sits *beside* the
  signal escalation; it does not trigger SIGTERM (per §Decision §D
  rejection — the operator decides to abort, not the runner).
- **ADR-006** — prompt via stdin. The spawn shape (`stdio: ["pipe",
  "pipe", "pipe"]`, prompt piped via stdin) is unchanged.
- **§2.4 env allowlist.** `GUILD_BENCHMARK_MAX_RSS_KB` is a *runner*
  env var (read by the parent), not a subprocess env var (forwarded
  to `claude`). It is not added to the `claude` child's env; the
  child sees the same allowlist as today.
- **operators-control-model-selection decision.** Operators
  declaring `GUILD_BENCHMARK_MAX_RSS_KB` is the same shape as
  operators declaring a model — operator chooses, project does not
  project-default.

## References

- `benchmark/plans/security-review.md §F3.4` — the threat the WARN
  partially mitigates.
- `benchmark/plans/security-review.md §"Mitigation summary table M13"`
  — the post-mortem `resource_usage` capture this ADR builds on.
- `benchmark/plans/03-runner.md §"OOM and resource ceilings"` — the
  operator-facing runbook prose updated by §Decision §8.
- `benchmark/src/runner.ts ~line 682` — the existing
  `process.resourceUsage()` capture site.
- `benchmark/FOLLOWUPS.md §F6` — the ledger entry this ADR closes.
- `.guild/wiki/decisions/operators-control-model-selection.md` — the
  precedent for "operator-declared, never project-defaulted"
  resource controls.
- `guild-plan.md §10.3` — decision-routing rule (this ADR is the
  significant-architectural-decision capture for the runtime memory-
  warning surface).
