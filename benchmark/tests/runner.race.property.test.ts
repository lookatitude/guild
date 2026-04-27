// runner.race.property.test.ts
//
// v1.2 / F13 — property test pinning the deadlock-free contract that
// `awaitStreamEndBounded` (v1.1 Bug 2 fix) satisfies. The original
// deadlock fired when a stream had already emitted "end" before the
// runner reached `await once(stream, "end")` — the listener never woke
// because the event had already passed. v1.1 wraps the await in this
// helper, which checks `readableEnded`/`destroyed` synchronously and
// races the listener with a 5s safety timeout.
//
// The property: regardless of when "end" / "close" / "error" fires
// relative to the await, the helper resolves within
// STREAM_END_TIMEOUT_MS — never hangs, never throws.
//
// Why a property test (not a unit test): the v1.1 bug was a race-class
// bug. A handful of unit tests with hand-picked timings missed the
// "end-before-await" ordering for 4 phases. fast-check picks orderings
// the author wouldn't have thought to write.

import { Readable } from "node:stream";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  STREAM_END_TIMEOUT_MS,
  awaitStreamEndBounded,
} from "../src/runner.js";

// Construct a Readable that we can control: nothing pushed until the
// orchestrator calls `commitEnd` / `commitError`. Push ordering is
// scheduled via setTimeout/setImmediate to model real I/O.
function controllableStream(): { stream: Readable; commitEnd: () => void; commitError: (e: Error) => void } {
  const stream = new Readable({ read() { /* no-op until commit */ } });
  // Drain + drop bytes — we don't care about the payload, only the
  // lifecycle events.
  stream.on("data", () => { /* swallow */ });
  // Always attach an error listener so a destroy(err) doesn't escape as
  // an unhandled-stream-error event.
  stream.on("error", () => { /* swallow — runner uses the lifecycle, not the err */ });
  return {
    stream,
    commitEnd: (): void => {
      stream.push(null);
    },
    commitError: (e: Error): void => {
      stream.destroy(e);
    },
  };
}

describe("runner / awaitStreamEndBounded — v1.2 F13 property test", () => {
  it("returns immediately for null stream (deadlock-free, < 100ms)", async () => {
    const start = Date.now();
    await awaitStreamEndBounded(null);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("returns immediately when stream is already-ended before await", async () => {
    const { stream, commitEnd } = controllableStream();
    commitEnd();
    // Drain so readableEnded flips to true synchronously when consumed.
    await new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
    });
    const start = Date.now();
    await awaitStreamEndBounded(stream);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("returns immediately when stream is already-destroyed before await", async () => {
    const { stream, commitError } = controllableStream();
    commitError(new Error("simulated close"));
    // Wait for the destroy to settle so `destroyed` flips true.
    await new Promise((resolve) => setImmediate(resolve));
    const start = Date.now();
    await awaitStreamEndBounded(stream);
    expect(Date.now() - start).toBeLessThan(100);
  });

  // The property: for any commit-event timing in [0ms, 200ms], the helper
  // resolves quickly (well under the 5s safety timeout) and never hangs.
  it("[property] resolves within timeout for any commit timing & event kind", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 200 }), // commit delay (ms)
        fc.constantFrom("end", "error"),
        async (delayMs, kind) => {
          const { stream, commitEnd, commitError } = controllableStream();
          // Schedule the commit to fire at +delayMs.
          setTimeout(() => {
            if (kind === "end") commitEnd();
            else commitError(new Error("simulated"));
          }, delayMs);
          const start = Date.now();
          await awaitStreamEndBounded(stream);
          const elapsed = Date.now() - start;
          // Should resolve close to delayMs, definitely under the 5s
          // safety timeout. Allow generous slack for CI jitter.
          return elapsed < STREAM_END_TIMEOUT_MS;
        },
      ),
      { numRuns: 30, verbose: false },
    );
  }, 30_000);

  // The hang-class regression check: even when the stream NEVER ends,
  // the helper falls through via the safety timer at ~5s. We don't
  // wait the full 5s in CI — instead we confirm the contract by
  // resolving early through the `unref-less` setTimeout.
  it("falls through when the stream never emits end/close/error (5s safety)", async () => {
    const { stream } = controllableStream();
    // Don't commit. The helper must still resolve within ~5s + jitter.
    const start = Date.now();
    await awaitStreamEndBounded(stream);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(STREAM_END_TIMEOUT_MS - 500);
    expect(elapsed).toBeLessThan(STREAM_END_TIMEOUT_MS + 2000);
    // Cleanup so vitest doesn't hold the stream open.
    stream.destroy();
  }, 10_000);

  // Stress: N concurrent awaits against the same stream must all settle
  // when the stream ends. This pins the case from v1.1 where two await
  // sites (post-exit drain + redactor finally) raced and both needed to
  // wake.
  it("[property] N concurrent awaits all resolve when the stream ends", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }), // number of concurrent awaits
        fc.integer({ min: 5, max: 100 }), // commit delay (ms)
        async (n, delayMs) => {
          const { stream, commitEnd } = controllableStream();
          const awaits: Promise<void>[] = [];
          for (let i = 0; i < n; i += 1) {
            awaits.push(awaitStreamEndBounded(stream));
          }
          setTimeout(commitEnd, delayMs);
          const start = Date.now();
          await Promise.all(awaits);
          const elapsed = Date.now() - start;
          return elapsed < STREAM_END_TIMEOUT_MS;
        },
      ),
      { numRuns: 20, verbose: false },
    );
  }, 30_000);
});
