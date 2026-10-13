#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public entrypoint.
 *
 * Retry lane implementation lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing imports from scripts/retry-lane.
 */

export {
  calcDelayMs,
  runWithRetry,
  loadRetryOpts,
  type BackoffStrategy,
  type SleepFn,
  type ExhaustionSignal,
  type RetryOpts,
  type RetryOutcome,
} from "../src/domains/lifecycle";
