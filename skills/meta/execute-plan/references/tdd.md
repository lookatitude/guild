---
name: guild-tdd
description: "Guild's first-class test-first discipline — write the failing test, watch it fail, then write the minimal code that passes. Loaded by engineering specialists (backend, qa, devops, security, mobile) before producing any new runtime behaviour, and the evidence backbone behind the Evidence-over-claims principle. TRIGGER on \"let's implement\", \"fix this bug\", \"add tests for…\", \"refactor this\", \"write the test first\", or any lane that writes new code or changes behaviour. DO NOT TRIGGER for throwaway prototypes, generated code, or configuration-only changes (those want human judgement, not a red-green cycle), nor for design, planning, or review-only work."
when_to_use: "Loaded by engineering specialists before producing new runtime code, and any time a bug fix, feature, or refactor changes behaviour."
type: meta
---

# Test-Driven Development

Write the test first. Watch it fail. Write the minimal code that makes it
pass. **If you did not watch the test fail, you do not know it tests the
right thing** — a test that passed the moment you wrote it proves nothing.

This is a first-class Guild engineering discipline, not an optional add-on:
the red-green-refactor loop is how a specialist lane produces the concrete,
re-runnable `evidence:` its handoff receipt must carry (the Evidence-over-claims
principle). A lane that claims "done" without a test
that first failed has no evidence, and `guild:review` / `guild:verify-done`
will treat the claim as unsupported.

## The iron law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote code before the test? Delete it and start fresh from the test. Not
"keep it as reference", not "adapt it while writing the test", not "look at
it once" — delete means delete. Implementing fresh from the test is the whole
point; reusing the untested code reintroduces the bias the discipline exists
to remove.

The only exceptions — throwaway prototypes, generated code, configuration-only
changes — are decided **with the user**, never assumed. "Skip TDD just this
once" is a rationalization; treat the thought itself as the signal to stop.

## Red → Green → Refactor

### RED — write one failing test

One behaviour, a name that describes that behaviour, exercising real code
(mocks only when a dependency is genuinely unavoidable).

```typescript
test('retries a failing operation three times then succeeds', async () => {
  let attempts = 0;
  const op = () => { attempts++; if (attempts < 3) throw new Error('fail'); return 'ok'; };
  const result = await retryOperation(op);
  expect(result).toBe('ok');
  expect(attempts).toBe(3);
});
```

Avoid: a vague name (`test('retry works')`), and asserting on a mock's call
count instead of the real behaviour — that tests the mock, not the code.

### Verify RED — watch it fail (mandatory, never skip)

Run the test. Confirm it **fails** (not errors), the message is the one you
expected, and it fails because the behaviour is missing — not because of a
typo. A test that passes here is testing existing behaviour: fix the test. A
test that errors: fix the error and re-run until it fails for the right
reason.

### GREEN — minimal code

Write the simplest code that passes the test. No extra options, no
speculative configuration, no "while I'm here" features (YAGNI). Then run the
test again and confirm it passes, every other test still passes, and the
output is pristine — no stray warnings or errors.

### REFACTOR — clean up, stay green

Only after green: remove duplication, improve names, extract helpers. Do not
add behaviour during refactor. Re-run; stay green. Then write the next
failing test.

## Why order matters

Tests written **after** the code pass immediately, and passing immediately
proves nothing: they may test the wrong thing, test the implementation
instead of the behaviour, or miss the edge case you forgot — and you never
watched the test catch a bug. Manual testing is ad-hoc: no record, can't
re-run, easy to forget cases under pressure. Test-first forces edge-case
discovery *before* implementing and gives a systematic, re-runnable artifact.
"I already spent hours on this code" is the sunk-cost fallacy — keeping code
you cannot trust is the actual waste.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. The test costs 30 seconds. |
| "I'll test after" | Tests that pass immediately prove nothing. |
| "Tests-after reach the same goal" | After = "what does this do?"; first = "what *should* this do?" |
| "I already manually tested it" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting hours of work is wasteful" | Sunk cost. Unverified code is technical debt. |
| "Keep it as reference, test first" | You'll adapt it — that's testing after. Delete. |
| "Hard to test" | Listen to the test: hard to test = hard to use. Simplify the design. |
| "TDD will slow me down" | TDD is faster than debugging in production. |

## Red flags — stop and start over

Code before test · test after implementation · test passes immediately ·
can't explain why the test failed · "I'll add tests later" · "just this once"
· "I already manually tested it" · "it's about spirit not ritual" · "keep as
reference" · "deleting is wasteful" · "this case is different because…". Every
one of these means: delete the code, start over from the test.

## When stuck

| Problem | Move |
|---------|------|
| Don't know how to test | Write the wished-for API in the assertion first; if still stuck, escalate to the orchestrator. |
| Test too complicated | The design is too complicated — simplify the interface. |
| Must mock everything | Code too coupled — use dependency injection. |
| Huge test setup | Extract helpers; if still huge, simplify the design. |

## Mocks and anti-patterns

When you reach for a mock or a test-only helper, read
`testing-anti-patterns.md` in this directory first — testing mock behaviour
instead of real behaviour, adding test-only methods to production classes, and
mocking without understanding the dependency chain are the failure modes it
catches.

## Integration

- **Pairs with `guild:systematic-debug`** — a bug fix starts by writing the
  failing test that reproduces the bug (its Phase 4, step 1).
- **Feeds `guild:review` / `guild:verify-done`** — the failing-then-passing
  test run is the `evidence:` a handoff receipt carries; verify-done re-runs
  the spec's defined test as its first check.
- **Loaded under `guild:execute-plan`** — engineering lanes adopt this
  discipline before writing runtime code.

## Verification checklist

Before a lane reports done: every new function has a test; you watched each
test fail first, for the expected reason; you wrote minimal code to pass; all
tests pass with pristine output; tests use real code where practical; edge
cases and errors are covered. Can't check every box? You skipped TDD — start
over.
