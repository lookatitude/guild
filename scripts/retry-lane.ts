#!/usr/bin/env -S npx tsx
/**
 * scripts/retry-lane.ts
 *
 * R-016a — the retry executor. Wraps a single TS-level lane-dispatch call with
 * bounded retry + backoff, reading `defaults.retry.*` from resolved settings.
 *
 * ── SCOPE (read this before extending) ──
 * `runWithRetry` covers the ONE real TS-level dispatch call site:
 *   RemoteTeamBackend.launch() at agent-team-launcher.ts (transient SSH transport
 *   failures). InProcess / subagent / tmux lane retry is ORCHESTRATOR-PROSE-DRIVEN
 *   via guild:execute-plan (R-016b): the orchestrator (Claude) detects a failed
 *   handoff receipt and re-issues Agent() up to max_attempts — a TS function cannot
 *   wrap an Agent() call. BOTH paths read the SAME defaults.retry.* (loadRetryOpts)
 *   and converge on the SAME run-state checkpoint writer (markLaneDead in
 *   hooks/lib/run-state.ts, reached via the onExhausted callback for SSH or via the
 *   scripts/mark-lane-dead.ts CLI for the prose path). One config, one writer, two
 *   reach mechanisms — never two divergent retry implementations.
 *
 * Purity: retry-lane.ts knows NOTHING about run-state, runDir, or laneId. The
 * caller closes over those and supplies an `onExhausted` callback; this module
 * only calls it. Timing is via an injectable `sleep` so tests never wait.
 *
 * Usage (SSH wrapper at the call site):
 *   import { runWithRetry, loadRetryOpts } from "./retry-lane";
 *   const opts = loadRetryOpts(cwd);
 *   const outcome = await runWithRetry(() => remoteBackend.launch(req), {
 *     ...opts,
 *     onExhausted: async (signal) => { await markLaneDead(runDir, init, laneId, signal, cwd); },
 *   });
 *
 * Contract pointers:
 *   - defaults.retry.* schema: scripts/read-guild-config.ts (DefaultsBlock.retry).
 *   - ExhaustionSignal mirrors hooks/lib/run-state.ts LaneExhaustionSignal field-for-field.
 *   - ledger: audit/reconciliation-ledger.md R-016; OD-5 in decisions.md.
 */

import { resolveSettings } from "./lib/settings-resolver";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Backoff strategy. SINGLE SOURCE OF TRUTH = ADR-RE-2
 * (docs/knowledge/decisions/v2-runtime-and-execution-model.md): `immediate|linear|exponential`.
 * Must stay identical to read-guild-config.ts DefaultsBlock.retry.backoff + config-cmd.ts
 * VALID_VALUES["defaults.retry.backoff"] — the accepted set and the handled set are one list.
 * `immediate` = zero delay between attempts (retry right away).
 */
export type BackoffStrategy = "immediate" | "linear" | "exponential";

/** Injectable async delay. Production uses a real setTimeout-based sleep; tests inject a spy. */
export type SleepFn = (ms: number) => Promise<void>;

/**
 * The exhaustion signal handed to `onExhausted` when all attempts fail.
 * MUST stay field-for-field identical to hooks/lib/run-state.ts LaneExhaustionSignal
 * so the bridge callback `markLaneDead(runDir, init, laneId, signal, cwd)` compiles.
 */
export interface ExhaustionSignal {
  /** Total attempts made (== maxAttempts on exhaustion). */
  attempts: number;
  /** ISO-8601 timestamp of the final (failing) attempt. */
  lastAttemptAt: string;
  /** Best-effort summary of the last error (truncated to 500 chars). */
  lastError?: string;
}

export interface RetryOpts {
  /** ≥1; 1 = a single attempt (no retry). From defaults.retry.max_attempts. */
  maxAttempts: number;
  /** Delay shape between attempts. From defaults.retry.backoff. */
  backoff: BackoffStrategy;
  /** Delay base in ms (default 1000). Ignored when backoff="immediate". */
  baseDelayMs?: number;
  /** Injected sleep (tests). Production: real setTimeout-based sleep. */
  sleep?: SleepFn;
  /**
   * Called once when all attempts are exhausted, AWAITED BEFORE the last error is
   * re-thrown. The caller writes resume.json + run-state here (via markLaneDead).
   * retry-lane.ts itself never touches run-state.
   */
  onExhausted?: (signal: ExhaustionSignal) => void | Promise<void>;
  /** Called after each NON-final failed attempt (per-attempt telemetry). */
  onAttemptFailed?: (attempt: number, error: Error) => void | Promise<void>;
}

export interface RetryOutcome<T> {
  /** The successful return value. */
  result: T;
  /** Which attempt the success landed on (1..maxAttempts). */
  attempts: number;
}

// ── Pure delay computation ──────────────────────────────────────────────────

const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Compute the backoff delay (ms) BEFORE the next attempt.
 * `attempt` is the 1-based index of the attempt that just FAILED (so the delay
 * before attempt 2 uses attempt=1).
 *   - immediate:   always 0 (retry right away)
 *   - linear:      base * attempt
 *   - exponential: base * 2^(attempt-1)
 */
export function calcDelayMs(attempt: number, strategy: BackoffStrategy, baseMs: number): number {
  switch (strategy) {
    case "immediate":
      return 0;
    case "linear":
      return baseMs * attempt;
    case "exponential":
      return baseMs * Math.pow(2, attempt - 1);
    default:
      return 0;
  }
}

// ── Real sleep (production default) ─────────────────────────────────────────

function realSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core: runWithRetry ──────────────────────────────────────────────────────

/**
 * Invoke `dispatchFn`; on a thrown/rejected result, retry up to `maxAttempts`
 * total with the configured backoff delay between attempts. Returns the first
 * success ({ result, attempts }). On exhaustion, calls `onExhausted` (awaited)
 * then re-throws the LAST error — the caller catches and marks the lane dead.
 *
 * NEVER sleeps after the final failing attempt (no wasted wall-clock on the
 * path that ends in exhaustion).
 */
export async function runWithRetry<T>(
  dispatchFn: () => Promise<T>,
  opts: RetryOpts
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts));
  const baseMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;

  let lastError: Error = new Error("runWithRetry: no attempt was made");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await dispatchFn();
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isFinalAttempt = attempt >= maxAttempts;
      if (isFinalAttempt) {
        // Exhausted: signal + re-throw. NO sleep after the final failure.
        const signal: ExhaustionSignal = {
          attempts: maxAttempts,
          lastAttemptAt: new Date().toISOString(),
          lastError: lastError.message.slice(0, 500),
        };
        if (opts.onExhausted) {
          await opts.onExhausted(signal);
        }
        throw lastError;
      }

      // Non-final failure: per-attempt telemetry, then backoff sleep.
      if (opts.onAttemptFailed) {
        await opts.onAttemptFailed(attempt, lastError);
      }
      const delay = calcDelayMs(attempt, opts.backoff, baseMs);
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  // Unreachable (the loop either returns or throws), but satisfies the type checker.
  throw lastError;
}

// ── Config reader: loadRetryOpts ────────────────────────────────────────────

// Accepted set == handled set == ADR-RE-2 enum (single source of truth).
const VALID_BACKOFF: ReadonlySet<string> = new Set(["immediate", "linear", "exponential"]);

/**
 * Read `defaults.retry.*` from resolved settings (full inheritance chain).
 * Tolerant: any missing/invalid value falls back to the safe defaults
 * (maxAttempts=1 = no retry, backoff="immediate" = zero delay). Never throws.
 *
 * NOTE: the read-guild-config DEFAULTS ship retry.backoff="exponential", but this
 * tolerant reader defaults backoff to "immediate" when the key is ABSENT from the
 * resolved config object (a config-load failure thus implies zero-delay, and with
 * the default maxAttempts=1 no retry happens at all). When settings.json is present
 * and valid, the resolved value (incl. the shipped "exponential" default) flows
 * through unchanged.
 */
export function loadRetryOpts(cwd: string): RetryOpts {
  try {
    const { config } = resolveSettings({ cwd });
    // config.defaults.retry is a typed field (DefaultsBlock.retry) but may be absent
    // in a sparse resolved object — read defensively via an unknown cast.
    const retry = (config.defaults as unknown as Record<string, unknown> | undefined)?.["retry"] as
      | Record<string, unknown>
      | undefined;

    let maxAttempts = 1;
    let backoff: BackoffStrategy = "immediate";

    if (retry && typeof retry === "object") {
      const ma = retry["max_attempts"];
      if (typeof ma === "number" && Number.isFinite(ma)) {
        maxAttempts = Math.max(1, Math.floor(ma));
      }
      const bo = retry["backoff"];
      if (typeof bo === "string" && VALID_BACKOFF.has(bo)) {
        backoff = bo as BackoffStrategy;
      }
    }

    return { maxAttempts, backoff };
  } catch {
    // Config resolution failed → safest posture: no retry, zero delay.
    return { maxAttempts: 1, backoff: "immediate" };
  }
}
