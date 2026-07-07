/**
 * Condition-based waiting — reference implementation.
 *
 * Companion to condition-based-waiting.md. Replace arbitrary `setTimeout`
 * delays in tests with a poller that resolves as soon as the condition you
 * actually care about is true, and rejects with a descriptive error on
 * timeout. Eliminates timing-based flakiness without slowing the fast path.
 */

/** Generic condition poller. Resolves with the first truthy result. */
export async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000,
  pollMs = 10,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = condition();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ---- Domain-specific helpers, built on the generic poller ----

interface EventEmitterLike<E> {
  readonly events: readonly E[];
}

/** Wait until an event of the given type has been emitted; return it. */
export async function waitForEvent<E extends { type: string }>(
  source: EventEmitterLike<E>,
  type: E['type'],
  timeoutMs = 5000,
): Promise<E> {
  return waitFor(
    () => source.events.find((e) => e.type === type),
    `event "${type}"`,
    timeoutMs,
  );
}

/** Wait until at least `count` events of the given type exist. */
export async function waitForEventCount<E extends { type: string }>(
  source: EventEmitterLike<E>,
  type: E['type'],
  count: number,
  timeoutMs = 5000,
): Promise<E[]> {
  return waitFor(
    () => {
      const matched = source.events.filter((e) => e.type === type);
      return matched.length >= count ? matched : undefined;
    },
    `${count}× event "${type}"`,
    timeoutMs,
  );
}

/** Wait until an event satisfies an arbitrary predicate; return it. */
export async function waitForEventMatch<E>(
  source: EventEmitterLike<E>,
  predicate: (e: E) => boolean,
  description: string,
  timeoutMs = 5000,
): Promise<E> {
  return waitFor(
    () => source.events.find(predicate),
    description,
    timeoutMs,
  );
}
