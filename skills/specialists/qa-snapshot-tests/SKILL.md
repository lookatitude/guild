---
name: qa-snapshot-tests
description: Authors snapshot tests with governance — what to snapshot, granularity, update-review policy, and rot prevention. Output: a snapshot test suite plus a short update-review policy doc. Pulled by the `qa` specialist. TRIGGER: "add snapshot tests for X", "snapshot test the rendered X", "author Jest snapshots for X", "write golden-file tests for X", "capture the output shape of X as a snapshot", "set up inline snapshots for X". DO NOT TRIGGER for: test-strategy selection (use `qa-test-strategy`), property-based tests (use `qa-property-based-tests`), flaky-test diagnosis (use `qa-flaky-test-hunter`), UI visual regression via screenshots (mobile / frontend group owns), end-to-end behavior tests (owning service group), API contract specification (backend-api-contract).
when_to_use: The parent `qa` specialist pulls this skill when the task requires locking a rendered or serialized output and enforcing review when it changes. Also fires on explicit user request.
type: specialist
---

# qa-snapshot-tests

Implements `guild-plan.md §6.1` (qa · snapshot-tests) under `§6.4` engineering principles: the snapshot is a cheap spec, but only if every update is reviewed — auto-accepting diffs turns tests into rubber stamps.

## What you do

Lock a serialized or rendered output as a committed artifact, small enough to read in review. Every change is a human decision — never a blind `--updateSnapshot`.

- Snapshot stable, semantic outputs (normalized JSON, serialized AST, component tree) — not raw timestamps, GUIDs, or ordering-sensitive hashes.
- Normalize noise with custom serializers (redact dates, sort keys, strip addresses).
- Keep snapshots small: if a file is 500+ lines, the test proves nothing a reviewer can verify.
- Prefer inline snapshots for small outputs — the test and its expectation live together.
- Document the update policy: who approves updates, what counts as a legitimate change.
- Pin a review checklist so snapshot PRs get human eyes, not a thumb-up.

## Output shape

A test suite plus a short policy doc:

1. **Snapshot tests** — one test per serialized unit, normalized.
2. **Custom serializers** — shared module that scrubs nondeterminism.
3. **Update policy** — `snapshot-policy.md`: when to update, who reviews, what's suspect.
4. **Review checklist** — two-line checklist referenced in PR template.
5. **Rot guard** — a test or lint that flags snapshots untouched for > N months (optional but recommended).

## Anti-patterns

- Auto-updating on diff — the test passes but nobody read the change.
- Massive snapshots — 1000-line dumps that reviewers skim.
- Snapshots as spec — using them as the only proof of behavior that deserves explicit assertions.
- Unnormalized timestamps, GUIDs, or iteration order — flaky by construction.
- Snapshot sprawl — every test is a snapshot; behavior is unreadable.
- No update policy — every dev updates snapshots on local failure.

## Handoff

Return the test suite path and policy doc path to the invoking `qa` specialist. If snapshots keep churning, the qa agent chains into `qa-flaky-test-hunter` (nondeterminism) or back to the owning service to fix the underlying source of churn. This skill does not dispatch.
