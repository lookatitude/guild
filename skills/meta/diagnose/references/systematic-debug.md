---
name: guild-systematic-debug
description: "Guild's first-class debugging discipline — find the root cause before proposing any fix, because symptom patches waste time and breed new bugs. Loaded by engineering and ops specialists (devops, qa, security, backend, mobile) when a bug, test failure, or unexpected behaviour appears. TRIGGER on \"this test is flaky\", \"intermittent failure\", \"wrong output\", \"broken in production\", \"weird behaviour\", \"regression\", \"500s every few hours\", \"passes locally fails in CI\". DO NOT TRIGGER for greenfield design questions, plan-stage discussions, or pure code-review work — those have their own skills."
when_to_use: "Before proposing a fix to any unexpected runtime behaviour — test failure, production bug, flaky test, performance problem, build failure, or integration issue."
type: meta
---

# Systematic Debugging

Random fixes waste time and create new bugs; quick patches mask the real
problem. **Always find the root cause before attempting a fix — a symptom fix
is a failure, not a fix.** This is a first-class Guild engineering discipline:
the four phases below produce the evidence a lane needs before it can claim a
bug is resolved.

## The iron law

```
NO FIX WITHOUT ROOT-CAUSE INVESTIGATION FIRST
```

If Phase 1 is not complete, you may not propose a fix. Use this discipline
**especially** when it feels skippable: under time pressure (emergencies make
guessing tempting), when "one quick fix" seems obvious, when you've already
tried several fixes, or when you don't fully understand the issue. Simple bugs
have root causes too, and systematic work is *faster* than guess-and-check
thrashing — not slower.

## Phase 1 — root-cause investigation

Before touching any fix:

1. **Read the error completely.** Don't skip past it — the stack trace, line
   numbers, file paths, and error codes often contain the solution outright.
2. **Reproduce consistently.** Can you trigger it reliably, and with what
   exact steps? If not reproducible, gather more data — do not guess.
3. **Check recent changes.** `git diff`, recent commits, new dependencies,
   config or environment differences.
4. **Gather evidence across component boundaries.** When the system has
   multiple components (CI → build → sign; API → service → DB), instrument
   *each boundary* — log what data enters and exits, verify config/env
   propagation — then run once to see *where* it breaks before investigating
   the failing component. Don't theorize about which layer is at fault; let
   the evidence point at it.
5. **Trace the data flow.** When the error is deep in the call stack, work
   backward to where the bad value originated — see `root-cause-tracing.md` in
   this directory. Fix at the source, not the symptom.

## Phase 2 — pattern analysis

Find a working example of the same pattern in the codebase. If you're
following a reference implementation, read it **completely** — every line, not
a skim. List *every* difference between the working and broken cases, however
small ("that can't matter" is how root causes hide). Understand the
dependencies, config, and assumptions the broken code relies on.

## Phase 3 — hypothesis and test

State one hypothesis explicitly: "I think X is the root cause because Y." Test
it with the **smallest possible change**, one variable at a time. Did it work?
→ Phase 4. Didn't? → form a *new* hypothesis; do not stack more fixes on top
of the failed one. If you don't understand something, say so and investigate —
don't pretend.

## Phase 4 — implementation

1. **Write a failing test that reproduces the bug first** — use `guild:tdd`.
   The test proves the fix and prevents the regression. No fix without it.
2. **Implement a single fix** at the root cause. One change, no bundled
   refactors, no "while I'm here" improvements.
3. **Verify:** the test passes, no other tests broke, the issue is actually
   gone.
4. **If the fix doesn't work, stop and count.** Tried fewer than 3 fixes →
   return to Phase 1 with the new information. Tried **3 or more** → stop
   fixing and question the architecture.

### When 3+ fixes have failed: question the architecture

If each fix reveals new shared state or coupling somewhere else, each fix needs
"massive refactoring", or each fix spawns a new symptom — that is not a failed
hypothesis, it is a wrong architecture. Stop and ask: is this pattern
fundamentally sound, or are we continuing through inertia? Escalate the
architectural question to the orchestrator/team-lead (and, for a Guild run, it
may loop back to `guild:plan`) before attempting fix #4.

## Red flags — stop and return to Phase 1

"Quick fix now, investigate later" · "just try changing X" · "add several
changes, run tests" · "skip the test, I'll verify manually" · "it's probably
X" · "I don't fully understand but this might work" · proposing fixes before
tracing data flow · "one more fix attempt" after two failures · each fix
revealing a new problem elsewhere. When the operator says things like "stop
guessing", "is that actually happening?", or "we're stuck?", that is the same
signal — return to Phase 1.

## Supporting techniques (this directory)

- **`root-cause-tracing.md`** — trace a bug backward through the call stack to
  its original trigger.
- **`defense-in-depth.md`** — after finding the root cause, add validation at
  every layer the bad data passes through to make the bug structurally
  impossible.
- **`condition-based-waiting.md`** (+ `condition-based-waiting-example.ts`) —
  replace arbitrary `sleep`/`setTimeout` delays with condition polling to kill
  timing-based flakiness.
- **`find-polluter.sh`** — bisect a test suite to find which test leaks
  state/files into the others.

## Integration

- **`guild:tdd`** — for the failing reproduction test in Phase 4.
- **`guild:verify-done`** — verifies the fix holds before the claim is
  trusted.
- **`guild:qa-flaky-test-hunter`** — the QA specialist owns flaky-suite
  strategy; this discipline supplies the per-bug root-cause method.

## When investigation finds no root cause

If systematic investigation genuinely shows the issue is environmental,
timing-dependent, or external: you've completed the process — document what you
investigated, implement appropriate handling (retry, timeout, clear error),
and add monitoring for future investigation. But assume incomplete
investigation first: most "no root cause" verdicts are a Phase 1 that stopped
early.
