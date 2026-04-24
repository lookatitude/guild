---
name: qa-property-based-tests
description: Authors property-based tests (Hypothesis / fast-check / proptest / QuickCheck) for a target function or module — invariants, generators, shrink strategies. Output: a property-test module plus generator definitions. Pulled by the `qa` specialist. TRIGGER: "write property-based tests for X", "add Hypothesis tests to X", "fast-check properties for X", "author proptest cases for X", "what invariants should we test for X", "add fuzz-style properties for X". DO NOT TRIGGER for: deciding whether the feature needs property tests at all (use `qa-test-strategy`), writing snapshot tests (use `qa-snapshot-tests`), diagnosing flaky tests (use `qa-flaky-test-hunter`), example-based unit tests (owning service group), security fuzzing of untrusted inputs (security-threat-modeling), performance benchmarks (mobile-performance-tuning).
when_to_use: The parent `qa` specialist pulls this skill when the task requires asserting properties over a space of inputs rather than hand-picked examples. Also fires on explicit user request.
type: specialist
---

# qa-property-based-tests

Implements `guild-plan.md §6.1` (qa · property-based-tests) under `§6.4` engineering principles: the property is the spec; a failing shrink is a minimal counterexample the author cannot hand-wave.

## What you do

Pick invariants that hold over the input space of the function under test, build generators that cover the space broadly, and let the framework find the corner case. The output is readable: a human scanning the tests should see what the function promises.

- State each property as a single-line invariant (round-trip, idempotence, commutativity, monotonicity, bounds).
- Build generators that cover edge ranges (empty, boundary, Unicode, very large, NaN) — not only the happy shape.
- Pick enough examples per property (default ≥ 100) and let CI crank it higher nightly.
- Name the property so a failure message is self-describing.
- Record seeds of failing runs — reproducibility is a hard requirement.
- Keep generators fast: complex setup kills the value.

## Output shape

A test module (e.g. `tests/properties/test_<module>.py`, `__tests__/properties/<module>.test.ts`) with:

1. **Generators** — small, composable, reusable across properties.
2. **Properties** — each function-under-test gets named invariants.
3. **Settings** — examples count, timeout, deadline, derandomize / seed policy.
4. **Shrinking** — custom shrinkers only when the default is unhelpful.
5. **Regression list** — hard-coded examples pinned from past failures.

## Anti-patterns

- Weak invariants like "does not throw" — passes trivially.
- Slow generators that crush the examples-per-property budget.
- Shrink strategies tuned to hide real bugs (filtering away valid inputs).
- Copying example-based tests into a `given` loop — that's parameterization, not properties.
- No regression pinning — a found counterexample is lost on next run.
- Non-deterministic generators with no seed — failures don't reproduce.

## Handoff

Return the test module path and generator module path to the invoking `qa` specialist. If properties reveal bugs the service owner must fix, the qa agent hands off to the owning specialist (backend / mobile). This skill does not dispatch.
