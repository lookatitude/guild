# Condition-based waiting

Flaky tests often guess at timing with an arbitrary delay. That creates a race
condition: the test passes on a fast machine and fails under load or in CI.
**Wait for the actual condition you care about, not for a guess at how long it
takes.**

Use this when tests have arbitrary delays (`setTimeout`, `sleep`,
`time.sleep`), are flaky, time out under parallelism, or are waiting for an
async operation. The one exception is testing genuine *timing* behaviour
(debounce, throttle intervals) — and even then, document why the delay is
correct.

## The pattern

```typescript
// Wrong: guessing at timing
await new Promise(r => setTimeout(r, 50));
const result = getResult();

// Right: wait for the condition
await waitFor(() => getResult() !== undefined, 'result to be defined');
const result = getResult();
```

| Wait for… | Pattern |
|-----------|---------|
| an event | `waitFor(() => events.find(e => e.type === 'DONE'), 'DONE event')` |
| a state | `waitFor(() => machine.state === 'ready', 'machine ready')` |
| a count | `waitFor(() => items.length >= 5, '5 items')` |
| a file | `waitFor(() => fs.existsSync(path), 'file to exist')` |
| a compound | `waitFor(() => obj.ready && obj.value > 10, 'ready with value')` |

A generic poller (see `condition-based-waiting-example.ts` for a complete
version with domain helpers):

```typescript
async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const result = condition();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, 10)); // poll every 10ms
  }
}
```

## Common mistakes

Polling every 1ms wastes CPU — poll every ~10ms. No timeout loops forever —
always include one with a clear, named error. Caching state before the loop
reads stale data — call the getter *inside* the loop.

## When an arbitrary delay is genuinely correct

Only after first waiting for the triggering condition, and only when the delay
is based on known timing (not a guess), with a comment explaining why:

```typescript
await waitForEvent(manager, 'TOOL_STARTED');   // 1. wait for the condition
await new Promise(r => setTimeout(r, 200));     // 2. 2 ticks at 100ms — documented, justified
```
