---
name: qa-flaky-test-hunter
description: Diagnoses flaky tests — classifies the cause (timing / ordering / resource / external), quarantines the test safely, and lays out a fix plan. Output: per-test flakiness report, quarantine list, and remediation plan. Pulled by the `qa` specialist. TRIGGER: "this test is flaky", "diagnose why X keeps failing intermittently", "hunt down the flaky tests in X", "why does X pass locally but fail on CI", "quarantine the flaky tests in X", "investigate the intermittent failures in X". DO NOT TRIGGER for: picking test shapes for a new feature (use `qa-test-strategy`), authoring property-based tests (use `qa-property-based-tests`), writing snapshot tests (use `qa-snapshot-tests`), fixing an application bug exposed by a test (owning service group), CI runner capacity tuning (devops-infrastructure-as-code), observability of prod flakiness (devops-observability-setup).
when_to_use: The parent `qa` specialist pulls this skill when the task requires investigating intermittent test failures, classifying them, and returning a remediation plan. Also fires on explicit user request.
type: specialist
---

# qa-flaky-test-hunter

Implements `guild-plan.md §6.1` (qa · flaky-test-hunter) under `§6.4` engineering principles: flaky tests rot the signal of the whole suite; diagnosis-before-fix prevents both silent data loss and hidden bugs.

## What you do

Treat flakiness as a diagnosable phenomenon, not a nuisance to retry. Classify each flaky test, quarantine responsibly with an expiry, and hand back a concrete fix plan — never "we added a retry."

- Reproduce with a tight loop (`--repeat 50` / `--count` / stress harness) to confirm flakiness.
- Classify: timing (sleep / race), ordering (shared state / test order), resource (port / file / DB), external (network / clock / third-party), nondeterminism (unsorted output, hashing).
- Inspect test isolation: shared mutable state between tests is a top cause.
- Quarantine with an expiry date and an owner — never "quarantine and forget."
- Write the fix plan: what change eliminates the cause, not masks it.
- If blocked on environment, flag that explicitly — don't call it fixed.

## Output shape

A `flakiness-report.md` containing:

1. **Per-test entries** — test id · reproduction command · classification · evidence.
2. **Quarantine list** — tests moved out of the blocking suite, each with expiry + owner.
3. **Fix plan** — ordered list of remediations, smallest first.
4. **Prevention** — policy changes (e.g. ban `sleep`, require DB cleanup in fixtures).
5. **Metrics** — before/after flake rate from CI telemetry if available.

## Anti-patterns

- Blanket retries — hides the bug and trains devs to ignore failures.
- Deleting tests without diagnosis — you lose the symptom and the signal.
- Quarantine with no expiry — tests rot indefinitely and bitrot becomes the norm.
- `sleep(ms)` as the fix — replaces one race with a slower one.
- Hiding time bombs — a test that fails only on Feb 29 is still broken.
- Fixing symptoms (adding assertions) without finding the race.

## Handoff

Return the report path and quarantine list to the invoking `qa` specialist. If a fix lives in application code, the qa agent hands off to the owning service specialist (backend / mobile). If the root cause is CI infrastructure, handoff chains to `devops-infrastructure-as-code` or `devops-observability-setup`. This skill does not dispatch.
