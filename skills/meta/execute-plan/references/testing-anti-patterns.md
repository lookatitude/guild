# Testing anti-patterns

**Read this when** writing or changing tests, adding a mock, or feeling
tempted to add a test-only method to production code.

A test must verify what the code does, not what a mock does. Mocks are a means
to isolate the thing under test — never the thing under test. The three iron
laws: **never test mock behaviour**, **never add test-only methods to
production classes**, **never mock a dependency you don't understand**.
Following TDD strictly prevents all of these, because you watch the test fail
against real code before any mock exists.

## 1 — Testing the mock instead of the code

Asserting that a mocked element rendered tells you the mock is present, not
that the component works. The test passes when the mock exists and fails when
it doesn't — it says nothing about real behaviour.

```typescript
// Wrong: verifies the mock exists
expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();

// Right: test the real component, or if it must be mocked for isolation,
// assert on the page's behaviour with the sidebar present — never on the mock
expect(screen.getByRole('navigation')).toBeInTheDocument();
```

**Gate:** before asserting on any mock element, ask "am I testing real
behaviour or just mock existence?" If the latter — delete the assertion or
unmock the component.

## 2 — Test-only methods in production classes

A `destroy()` method that only tests ever call looks like production API,
risks being called in production, violates YAGNI, and confuses object
lifecycle with entity lifecycle.

```typescript
// Wrong: Session.destroy() exists only so afterEach() can call it
// Right: Session has no destroy(); a test utility owns test cleanup
export async function cleanupSession(session: Session) {
  const ws = session.getWorkspaceInfo();
  if (ws) await workspaceManager.destroyWorkspace(ws.id);
}
```

**Gate:** before adding a method to a production class, ask "is this only used
by tests?" If yes, put it in test utilities. Ask "does this class own this
resource's lifecycle?" If no, it's the wrong class.

## 3 — Mocking without understanding the dependency chain

Over-mocking "to be safe" silently removes a side effect the test depends on,
so the test passes for the wrong reason or fails mysteriously.

```typescript
// Wrong: mocking the high-level method removes the config write the
// duplicate-detection test relies on, so the second add never throws.
// Right: mock only the slow/external part (server startup), preserve the
// behaviour the test needs (the config write).
```

**Gate:** before mocking a method, ask what side effects the real method has,
whether the test depends on any of them, and whether you understand what the
test needs. If you're unsure, run the test against the real implementation
first, observe what must happen, then add the minimal mock at the lowest level
that isolates the slow/external bit. Red flags: "I'll mock this to be safe",
"this might be slow, better mock it".

## 4 — Incomplete mocks

A partial mock includes only the fields you happen to know about. Downstream
code that reads a field you omitted fails silently — the test passes but the
integration breaks, giving false confidence.

```typescript
// Wrong: { status, data } — missing metadata downstream code reads
// Right: mirror the COMPLETE real response shape, including metadata
```

**Rule:** mock the complete data structure as it exists in reality, not just
the fields your immediate assertion touches. If you create a mock, you must
understand the entire structure; when uncertain, include every documented
field.

## 5 — Tests as an afterthought

"Implementation complete, no tests written, ready for testing" is not
complete. Testing is part of implementation. TDD would have produced the tests
as the work proceeded; declaring done without them is a process failure that
`guild:verify-done` will fail at check 1.

## When mocks get too complex

Warning signs: mock setup longer than the test logic; mocking everything to
make a test pass; mocks missing methods the real component has; a test that
breaks whenever the mock changes. When you hit them, ask whether you need the
mock at all — an integration test with real components is often simpler than
an elaborate mock, and proves more.

## Quick reference

| Anti-pattern | Fix |
|--------------|-----|
| Assert on mock elements | Test the real component, or unmock it |
| Test-only methods in production | Move them to test utilities |
| Mock without understanding | Understand the dependencies, then mock minimally |
| Incomplete mocks | Mirror the real structure completely |
| Tests as afterthought | TDD — tests first |
| Over-complex mocks | Prefer integration tests with real components |

**Bottom line:** mocks are tools to isolate, not things to test. If TDD
reveals you are testing mock behaviour, you went wrong — test real behaviour,
or question why you are mocking at all.
