/**
 * understand/lib/parity-harness.ts
 *
 * Reusable SQLite-optional parity harness for the Codebase Learning & Recall
 * Acceleration (CLRA) initiative (G14, the cross-cutting conformance gate).
 *
 * Invariant (goals.md §1.3): SQLite is OPTIONAL. The `index: off` path is the
 * SOURCE OF TRUTH; the `index: on` path is a pure acceleration cache that must
 * return BYTE-IDENTICAL answers. Every CLRA goal that touches the index cache
 * (G1–G10, G15) proves this by running its query/extraction through BOTH modes
 * and asserting equality:
 *
 *     expect(runBothIndexModes(myQuery).identical).toBe(true)
 *
 * The harness drives the index-cache knob via the `IndexBlock.enabled` flag
 * (the `index: auto|on|off` setting maps to it — see index-cache.ts §Contract):
 *   - mode "off" → enabled:false → ensure*Index() returns null → caller parses
 *     the canonical JSON / runs in-process (no SQLite, source of truth).
 *   - mode "on"  → enabled:true  → ensure*Index() may populate index.sqlite and
 *     the caller reads from the projection (acceleration).
 *
 * The query function receives an IndexModeContext and decides how to read; the
 * harness only supplies the two configs, records that BOTH modes executed (so a
 * silently-skipped mode is detectable), and deep-compares the two results with a
 * deterministic, key-order-independent equality.
 *
 * Zero runtime deps; never throws on the comparison path.
 */

import {
  DEFAULT_INDEX_BLOCK,
  type IndexBlock,
} from "../../../src/modules/state/workflows/index-cache";

export type IndexMode = "off" | "on";

/** Context handed to a query/extraction for one index mode. */
export interface IndexModeContext {
  /** Which mode this invocation represents. */
  mode: IndexMode;
  /**
   * IndexBlock to pass to ensure*Index(). `enabled` is forced to match `mode`
   * (off → false, on → true). All other fields come from DEFAULT_INDEX_BLOCK
   * merged with any caller overrides.
   */
  config: IndexBlock;
}

/** Outcome of running a function through both index modes. */
export interface ParityOutcome<T> {
  /** Result with index:off (no SQLite, source of truth). */
  off: T;
  /** Result with index:on (SQLite acceleration permitted). */
  on: T;
  /** True iff `off` and `on` are deeply, key-order-independently equal. */
  identical: boolean;
  /**
   * True iff the function was invoked for BOTH modes. Guards against a gate
   * that vacuously passes because one mode was silently skipped.
   */
  ranBoth: boolean;
  /** The modes actually executed, in invocation order: ["off", "on"]. */
  executed: IndexMode[];
}

/** Build an index:off config (SQLite disabled — the source of truth). */
export function offConfig(overrides: Partial<IndexBlock> = {}): IndexBlock {
  return { ...DEFAULT_INDEX_BLOCK, ...overrides, enabled: false };
}

/** Build an index:on config (SQLite acceleration enabled). */
export function onConfig(overrides: Partial<IndexBlock> = {}): IndexBlock {
  return { ...DEFAULT_INDEX_BLOCK, ...overrides, enabled: true };
}

export interface RunBothOptions {
  /**
   * Threshold/field overrides applied to BOTH mode configs (e.g. lowering
   * kg_node_threshold so a small fixture graph still exercises SQLite in the
   * `on` mode). `enabled` is always forced to match the mode and cannot be
   * overridden here.
   */
  overrides?: Partial<IndexBlock>;
}

/**
 * Run `fn` once with index:off and once with index:on, then deep-compare.
 *
 * The function is responsible for actually consulting the index cache (via the
 * supplied `ctx.config`) and returning a comparable result. The harness records
 * that both modes ran and whether the results are identical.
 *
 * Invocation order is fixed (off first, then on) so a caller that wants to
 * assert "off produced no dbPath, on produced a dbPath" can rely on ordering.
 */
export function runBothIndexModes<T>(
  fn: (ctx: IndexModeContext) => T,
  opts: RunBothOptions = {},
): ParityOutcome<T> {
  const executed: IndexMode[] = [];
  const ov = opts.overrides ?? {};

  const off = fn({ mode: "off", config: offConfig(ov) });
  executed.push("off");

  const on = fn({ mode: "on", config: onConfig(ov) });
  executed.push("on");

  return {
    off,
    on,
    identical: deepEqual(off, on),
    ranBoth: executed.length === 2 && executed.includes("off") && executed.includes("on"),
    executed,
  };
}

// ---------------------------------------------------------------------------
// Deterministic, key-order-independent deep equality
// ---------------------------------------------------------------------------

/**
 * Canonicalize a value to a stable string: object keys are sorted recursively
 * so `{a,b}` and `{b,a}` compare equal. Arrays preserve order (order is
 * semantically meaningful for ranked results — a parity check on a ranking
 * MUST catch a reordering). undefined is normalized to null for stability.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

function stableSort(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableSort);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = stableSort(obj[key]);
  }
  return out;
}

/** Deep equality with sorted-key canonicalization. Never throws. */
export function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}
