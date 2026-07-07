/**
 * scripts/__tests__/retry-lane.test.ts
 *
 * TDD suite for scripts/retry-lane.ts (R-016a — the retry executor).
 *
 * Coverage map:
 *  - calcDelayMs: immediate=0 always; linear=base*attempt; exponential=base*2^(attempt-1).
 *  - runWithRetry: max=1 → single attempt (no retry); succeed-on-attempt-k;
 *    exhaustion → throws last error; onExhausted called once before throw;
 *    onAttemptFailed called per non-final failure; injected sleep spy receives
 *    the exact backoff delay sequence (no real waiting).
 *  - RetryOutcome.attempts: reports the attempt the success landed on.
 *  - loadRetryOpts: reads defaults.retry.* from settings.json; tolerant defaults
 *    when absent (maxAttempts=1, backoff="immediate").
 *
 * All timing is via an injected `sleep` spy — tests never actually wait.
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  runWithRetry,
  calcDelayMs,
  loadRetryOpts,
  type RetryOpts,
  type ExhaustionSignal,
  type BackoffStrategy,
} from "../retry-lane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-retry-test-"));
}

function writeSettings(dir: string, content: Record<string, unknown>): void {
  const guildDir = path.join(dir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(path.join(guildDir, "settings.json"), JSON.stringify(content, null, 2));
}

/** A sleep spy that records every delay it was asked to wait, but never waits. */
function makeSleepSpy(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sleep: (ms: number) => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
}

/** A dispatch fn that fails the first `failTimes` calls, then succeeds with `value`. */
function makeFlakyDispatch<T>(failTimes: number, value: T): {
  fn: () => Promise<T>;
  callCount: () => number;
} {
  let calls = 0;
  return {
    callCount: () => calls,
    fn: () => {
      calls += 1;
      if (calls <= failTimes) {
        return Promise.reject(new Error(`fail #${calls}`));
      }
      return Promise.resolve(value);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. calcDelayMs — pure delay computation
// ---------------------------------------------------------------------------

describe("calcDelayMs", () => {
  it("immediate → always 0 regardless of attempt or base", () => {
    expect(calcDelayMs(1, "immediate", 1000)).toBe(0);
    expect(calcDelayMs(5, "immediate", 1000)).toBe(0);
  });

  it("linear → base * attempt", () => {
    expect(calcDelayMs(1, "linear", 1000)).toBe(1000);
    expect(calcDelayMs(2, "linear", 1000)).toBe(2000);
    expect(calcDelayMs(3, "linear", 1000)).toBe(3000);
  });

  it("exponential → base * 2^(attempt-1)", () => {
    expect(calcDelayMs(1, "exponential", 1000)).toBe(1000); // 1000 * 2^0
    expect(calcDelayMs(2, "exponential", 1000)).toBe(2000); // 1000 * 2^1
    expect(calcDelayMs(3, "exponential", 1000)).toBe(4000); // 1000 * 2^2
    expect(calcDelayMs(4, "exponential", 1000)).toBe(8000); // 1000 * 2^3
  });
});

// ---------------------------------------------------------------------------
// 2. runWithRetry — no-retry (max=1)
// ---------------------------------------------------------------------------

describe("runWithRetry — max_attempts=1 (no retry)", () => {
  it("calls dispatch exactly once on success", async () => {
    const { fn, callCount } = makeFlakyDispatch(0, "ok");
    const spy = makeSleepSpy();
    const outcome = await runWithRetry(fn, {
      maxAttempts: 1,
      backoff: "immediate",
      sleep: spy.sleep,
    });
    expect(outcome.result).toBe("ok");
    expect(outcome.attempts).toBe(1);
    expect(callCount()).toBe(1);
    expect(spy.calls).toEqual([]); // no sleeps when no retry
  });

  it("throws immediately (no retry) when max=1 and dispatch fails", async () => {
    const { fn, callCount } = makeFlakyDispatch(1, "never");
    const spy = makeSleepSpy();
    await expect(
      runWithRetry(fn, { maxAttempts: 1, backoff: "linear", sleep: spy.sleep })
    ).rejects.toThrow("fail #1");
    expect(callCount()).toBe(1); // exactly one attempt — no retry
    expect(spy.calls).toEqual([]); // never sleeps
  });
});

// ---------------------------------------------------------------------------
// 3. runWithRetry — succeed on attempt k
// ---------------------------------------------------------------------------

describe("runWithRetry — succeed on attempt k", () => {
  it("retries and succeeds on attempt 3 (fails twice)", async () => {
    const { fn, callCount } = makeFlakyDispatch(2, "third-time");
    const spy = makeSleepSpy();
    const outcome = await runWithRetry(fn, {
      maxAttempts: 5,
      backoff: "linear",
      baseDelayMs: 100,
      sleep: spy.sleep,
    });
    expect(outcome.result).toBe("third-time");
    expect(outcome.attempts).toBe(3);
    expect(callCount()).toBe(3);
    // Two failed attempts → two sleeps, with linear delays for attempts 1 and 2.
    expect(spy.calls).toEqual([100, 200]);
  });

  it("calls onAttemptFailed for each non-final failure", async () => {
    const { fn } = makeFlakyDispatch(2, "ok");
    const spy = makeSleepSpy();
    const failedAttempts: number[] = [];
    await runWithRetry(fn, {
      maxAttempts: 5,
      backoff: "immediate",
      sleep: spy.sleep,
      onAttemptFailed: (attempt) => {
        failedAttempts.push(attempt);
      },
    });
    // attempts 1 and 2 failed; attempt 3 succeeded
    expect(failedAttempts).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 4. runWithRetry — exhaustion
// ---------------------------------------------------------------------------

describe("runWithRetry — exhaustion", () => {
  it("throws the LAST error after exhausting all attempts", async () => {
    const { fn, callCount } = makeFlakyDispatch(99, "never"); // always fails
    const spy = makeSleepSpy();
    await expect(
      runWithRetry(fn, { maxAttempts: 3, backoff: "immediate", sleep: spy.sleep })
    ).rejects.toThrow("fail #3"); // the LAST attempt's error
    expect(callCount()).toBe(3); // exactly maxAttempts attempts
  });

  it("calls onExhausted exactly once, BEFORE throwing, with the correct signal", async () => {
    const { fn } = makeFlakyDispatch(99, "never");
    const spy = makeSleepSpy();
    const signals: ExhaustionSignal[] = [];
    await expect(
      runWithRetry(fn, {
        maxAttempts: 3,
        backoff: "immediate",
        sleep: spy.sleep,
        onExhausted: (signal) => {
          signals.push(signal);
        },
      })
    ).rejects.toThrow("fail #3");
    expect(signals).toHaveLength(1);
    expect(signals[0].attempts).toBe(3);
    expect(signals[0].lastError).toContain("fail #3");
    expect(typeof signals[0].lastAttemptAt).toBe("string");
    // ISO-8601 shape check
    expect(signals[0].lastAttemptAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("awaits an async onExhausted before re-throwing", async () => {
    const { fn } = makeFlakyDispatch(99, "never");
    const spy = makeSleepSpy();
    let exhaustedResolved = false;
    await expect(
      runWithRetry(fn, {
        maxAttempts: 2,
        backoff: "immediate",
        sleep: spy.sleep,
        onExhausted: async () => {
          await Promise.resolve();
          exhaustedResolved = true;
        },
      })
    ).rejects.toThrow();
    expect(exhaustedResolved).toBe(true); // the async callback completed before the throw
  });
});

// ---------------------------------------------------------------------------
// 5. runWithRetry — backoff delay sequences (via injected sleep spy)
// ---------------------------------------------------------------------------

describe("runWithRetry — backoff delay sequences", () => {
  it("exponential: delays follow base*2^(n-1) for each retry", async () => {
    const { fn } = makeFlakyDispatch(3, "ok"); // fails 3 times, succeeds on 4th
    const spy = makeSleepSpy();
    await runWithRetry(fn, {
      maxAttempts: 5,
      backoff: "exponential",
      baseDelayMs: 50,
      sleep: spy.sleep,
    });
    // 3 failures → 3 sleeps before attempts 2, 3, 4
    expect(spy.calls).toEqual([50, 100, 200]);
  });

  it("immediate: never sleeps even across multiple retries", async () => {
    const { fn } = makeFlakyDispatch(3, "ok");
    const spy = makeSleepSpy();
    await runWithRetry(fn, {
      maxAttempts: 5,
      backoff: "immediate",
      baseDelayMs: 1000,
      sleep: spy.sleep,
    });
    expect(spy.calls).toEqual([]); // backoff=immediate → zero sleeps
  });

  it("does NOT sleep after the final (exhausting) failure", async () => {
    const { fn } = makeFlakyDispatch(99, "never");
    const spy = makeSleepSpy();
    await expect(
      runWithRetry(fn, {
        maxAttempts: 3,
        backoff: "linear",
        baseDelayMs: 100,
        sleep: spy.sleep,
      })
    ).rejects.toThrow();
    // 3 attempts → sleeps only between attempts (after attempt 1 and 2), NOT after attempt 3.
    expect(spy.calls).toEqual([100, 200]);
  });
});

// ---------------------------------------------------------------------------
// 6. loadRetryOpts — config reader
// ---------------------------------------------------------------------------

describe("loadRetryOpts", () => {
  it("reads defaults.retry.* from settings.json", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, {
      defaults: { retry: { max_attempts: 4, backoff: "exponential" } },
    });
    const opts = loadRetryOpts(cwd);
    expect(opts.maxAttempts).toBe(4);
    expect(opts.backoff).toBe("exponential");
  });

  it("returns the shipped no-retry default (maxAttempts=1) when settings absent", () => {
    const cwd = makeTmpDir(); // no settings.json → resolveSettings returns built-in DEFAULTS
    const opts = loadRetryOpts(cwd);
    // The shipped DEFAULTS are max_attempts=1 (no retry) + backoff="exponential".
    // maxAttempts=1 means backoff is moot (no retries ever happen) — the safe default.
    expect(opts.maxAttempts).toBe(1);
    expect(["immediate", "linear", "exponential"] as BackoffStrategy[]).toContain(opts.backoff);
  });

  it("maps 'exponential' backoff faithfully when explicitly set", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { defaults: { retry: { max_attempts: 3, backoff: "exponential" } } });
    const opts = loadRetryOpts(cwd);
    expect(opts.maxAttempts).toBe(3);
    expect(opts.backoff).toBe("exponential");
  });

  it("tolerates a missing backoff key (falls back to a valid strategy)", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { defaults: { retry: { max_attempts: 2 } } });
    const opts = loadRetryOpts(cwd);
    expect(opts.maxAttempts).toBe(2);
    // backoff absent in file → resolver fills the shipped default; always a valid strategy.
    expect(["immediate", "linear", "exponential"] as BackoffStrategy[]).toContain(opts.backoff);
  });

  it("clamps maxAttempts to >= 1 even if settings says 0 or negative", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { defaults: { retry: { max_attempts: 0 } } });
    const opts = loadRetryOpts(cwd);
    expect(opts.maxAttempts).toBeGreaterThanOrEqual(1);
  });
});
